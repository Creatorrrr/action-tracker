const HAND_LANDMARK_COUNT = 21;
const EPSILON = 1e-6;
const FUTURE_TOLERANCE_SEC = 1e-6;
const DEFAULT_MINIMUM_POSE_CONFIDENCE = 0.2;
const MINIMUM_SCALE = 0.45;
const MAXIMUM_SCALE = 2.25;

export const DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS = 1250;

const SIDE_POSE_ANCHORS = Object.freeze({
  Left: Object.freeze({ wrist: 15, pinky: 17, index: 19, thumb: 21 }),
  Right: Object.freeze({ wrist: 16, pinky: 18, index: 20, thumb: 22 }),
});

const PROXY_DEFINITIONS = Object.freeze([
  Object.freeze({ name: "index", weight: 1 }),
  Object.freeze({ name: "pinky", weight: 1 }),
  Object.freeze({ name: "thumb", weight: 0.6 }),
]);

const MODE_OPTIONS = Object.freeze({
  similarity: Object.freeze({ maximumAgeSec: 1.25, confidenceScale: 1 }),
  "single-proxy": Object.freeze({ maximumAgeSec: 0.9, confidenceScale: 0.6 }),
  translation: Object.freeze({ maximumAgeSec: 0.65, confidenceScale: 0.35 }),
});

/**
 * Transport a detector-observed hand through the body pose's change between
 * two source PTS values. The operation is deterministic and causal: only the
 * completed observation and the current pose frame are read.
 *
 * Pose proxies estimate palm translation/rotation/scale. Finger articulation
 * remains detector-owned, so no detector fingertip is snapped to a coarse
 * pose proxy. World landmarks are intentionally omitted because their stale
 * palm frame cannot be mixed with the transported image landmarks.
 */
export function transportPoseGuidedHandLandmarks({
  side,
  observedLandmarks,
  observedPoseLandmarks,
  poseLandmarks,
  observedSourcePtsSec,
  sourcePtsSec,
  observedAspectRatio = 1,
  aspectRatio = observedAspectRatio,
  generation = null,
  observedGeneration = generation,
  maxAgeMs = DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS,
  minimumPoseConfidence = DEFAULT_MINIMUM_POSE_CONFIDENCE,
} = {}) {
  const definition = SIDE_POSE_ANCHORS[side];
  if (!definition) {
    return invalidResult("unsupported-side");
  }
  if (
    Number.isFinite(generation) &&
    Number.isFinite(observedGeneration) &&
    generation !== observedGeneration
  ) {
    return invalidResult("generation-mismatch");
  }
  if (!isHandLandmarkList(observedLandmarks)) {
    return invalidResult("invalid-observed-hand");
  }
  if (!Array.isArray(observedPoseLandmarks) || !Array.isArray(poseLandmarks)) {
    return invalidResult("invalid-pose-landmarks");
  }

  const observationPts = finiteNumber(observedSourcePtsSec);
  const currentPts = finiteNumber(sourcePtsSec);
  const configuredMaximumAgeMs = finiteNumber(maxAgeMs);
  const sourceAspect = positiveFiniteOr(observedAspectRatio, 1);
  const targetAspect = positiveFiniteOr(aspectRatio, sourceAspect);
  if (observationPts === null || currentPts === null) {
    return invalidResult("invalid-source-pts");
  }
  if (configuredMaximumAgeMs === null || configuredMaximumAgeMs <= 0) {
    return invalidResult("invalid-max-age");
  }

  const ageSec = currentPts - observationPts;
  if (ageSec < -FUTURE_TOLERANCE_SEC) {
    return invalidResult("future-observation", { ageSec });
  }

  const sourcePose = readPoseAnchors(
    observedPoseLandmarks,
    definition,
    minimumPoseConfidence,
    sourceAspect,
  );
  const targetPose = readPoseAnchors(
    poseLandmarks,
    definition,
    minimumPoseConfidence,
    targetAspect,
  );
  if (!sourcePose.wrist || !targetPose.wrist) {
    return invalidResult("missing-wrist-anchor", { ageSec });
  }

  const proxyPairs = buildProxyPairs(sourcePose, targetPose);
  let fit = fitSimilarity(proxyPairs);
  if (
    fit &&
    proxyPairs.length >= 2 &&
    (fit.residual > 0.55 || fit.scaleClampRatio > 1.5)
  ) {
    fit = fitSimilarity([selectBestProxyPair(proxyPairs)]);
  }
  if (!fit) {
    fit = translationFit();
  }

  const mode = fit.proxyCount >= 2
    ? "similarity"
    : fit.proxyCount === 1
      ? "single-proxy"
      : "translation";
  const modeOptions = MODE_OPTIONS[mode];
  const configuredMaximumAgeSec = configuredMaximumAgeMs / 1000;
  const maximumAgeSec = Math.min(
    configuredMaximumAgeSec,
    modeOptions.maximumAgeSec,
  );
  if (ageSec >= maximumAgeSec) {
    return invalidResult("expired-observation", {
      ageSec,
      mode,
    });
  }

  const handWrist = readPoint(observedLandmarks[0]);
  const sourcePoseWrist = sourcePose.wrist.metric;
  const targetPoseWrist = targetPose.wrist.metric;
  const transported = observedLandmarks.map((landmark) => {
    const point = toMetric(readPoint(landmark), sourceAspect);
    const local = subtract2d(point, sourcePoseWrist);
    const transformed = add2d(
      targetPoseWrist,
      scale2d(rotate2d(local, fit.cos, fit.sin), fit.scale),
    );
    return {
      x: transformed.x,
      y: transformed.y * targetAspect,
      // Hand image depth is wrist-local; pose z uses a different origin.
      z: handWrist.z + fit.scale * (Number(landmark.z ?? 0) - handWrist.z),
    };
  });

  const wristConfidence = Math.min(
    sourcePose.wrist.confidence,
    targetPose.wrist.confidence,
  );
  const proxyConfidence = fit.proxyCount > 0
    ? fit.proxyConfidence
    : wristConfidence;
  const geometryQuality = clamp(1 - fit.residual / 0.55, 0, 1);
  const ageWeight = 1 - smoothstep(0.5, maximumAgeSec, Math.max(0, ageSec));
  const confidence = clamp(
    Math.min(wristConfidence, proxyConfidence) *
      geometryQuality *
      modeOptions.confidenceScale *
      ageWeight,
    0,
    1,
  );
  const landmarks = transported.map((point) => ({
    ...point,
    visibility: confidence,
    presence: confidence,
  }));

  return {
    valid: true,
    reason: null,
    side,
    mode,
    landmarks,
    worldLandmarks: null,
    ageMs: Math.max(0, ageSec * 1000),
    confidence,
    observedSourcePtsSec: observationPts,
    sourcePtsSec: currentPts,
    scale: fit.scale,
    rotationRad: fit.rotationRad,
    residual: fit.residual,
    proxyCount: fit.proxyCount,
    usedPoseIndices: [
      definition.wrist,
      ...fit.proxyNames.map((name) => definition[name]),
    ],
  };
}

function readPoseAnchors(landmarks, definition, minimumConfidence, aspectRatio) {
  return Object.fromEntries(
    Object.entries(definition).map(([name, index]) => {
      const point = readPosePoint(landmarks[index], minimumConfidence);
      return [name, point
        ? {
            metric: toMetric(point, aspectRatio),
            confidence: pointConfidence(landmarks[index]) ?? 1,
            index,
          }
        : null];
    }),
  );
}

function buildProxyPairs(sourcePose, targetPose) {
  const pairs = [];
  for (const definition of PROXY_DEFINITIONS) {
    const source = sourcePose[definition.name];
    const target = targetPose[definition.name];
    if (!source || !target || !sourcePose.wrist || !targetPose.wrist) {
      continue;
    }
    const sourceVector = subtract2d(source.metric, sourcePose.wrist.metric);
    const targetVector = subtract2d(target.metric, targetPose.wrist.metric);
    if (
      magnitude2d(sourceVector) < 1e-4 ||
      magnitude2d(targetVector) < 1e-4
    ) {
      continue;
    }
    const confidence = Math.min(source.confidence, target.confidence);
    pairs.push({
      name: definition.name,
      source: sourceVector,
      target: targetVector,
      weight: definition.weight * confidence,
      confidence,
    });
  }
  return pairs;
}

function fitSimilarity(pairs) {
  const usablePairs = pairs.filter(Boolean);
  if (usablePairs.length === 0) {
    return null;
  }

  let dotSum = 0;
  let crossSum = 0;
  let denominator = 0;
  let totalWeight = 0;
  let confidenceSum = 0;
  for (const pair of usablePairs) {
    dotSum += pair.weight * dot2d(pair.source, pair.target);
    crossSum += pair.weight * cross2d(pair.source, pair.target);
    denominator += pair.weight * dot2d(pair.source, pair.source);
    totalWeight += pair.weight;
    confidenceSum += pair.weight * pair.confidence;
  }
  if (denominator < EPSILON || totalWeight < EPSILON) {
    return null;
  }

  const rotationMagnitude = Math.hypot(dotSum, crossSum);
  if (rotationMagnitude < EPSILON) {
    return null;
  }
  const rawScale = rotationMagnitude / denominator;
  const resolvedScale = clamp(rawScale, MINIMUM_SCALE, MAXIMUM_SCALE);
  const cos = dotSum / rotationMagnitude;
  const sin = crossSum / rotationMagnitude;
  let residualSum = 0;
  let targetSpanSum = 0;
  for (const pair of usablePairs) {
    const predicted = scale2d(
      rotate2d(pair.source, cos, sin),
      resolvedScale,
    );
    residualSum += pair.weight * squaredMagnitude2d(
      subtract2d(pair.target, predicted),
    );
    targetSpanSum += pair.weight * magnitude2d(pair.target);
  }
  const rootMeanSquareError = Math.sqrt(residualSum / totalWeight);
  const targetPalmSpan = Math.max(EPSILON, targetSpanSum / totalWeight);

  return {
    proxyCount: usablePairs.length,
    proxyNames: usablePairs.map((pair) => pair.name),
    scale: resolvedScale,
    scaleClampRatio: Math.max(
      rawScale / resolvedScale,
      resolvedScale / Math.max(EPSILON, rawScale),
    ),
    cos,
    sin,
    rotationRad: Math.atan2(sin, cos),
    residual: rootMeanSquareError / targetPalmSpan,
    proxyConfidence: confidenceSum / totalWeight,
  };
}

function translationFit() {
  return {
    proxyCount: 0,
    proxyNames: [],
    scale: 1,
    scaleClampRatio: 1,
    cos: 1,
    sin: 0,
    rotationRad: 0,
    residual: 0,
    proxyConfidence: 1,
  };
}

function selectBestProxyPair(pairs) {
  return pairs.slice().sort((a, b) => (
    b.weight * magnitude2d(b.source) -
    a.weight * magnitude2d(a.source)
  ))[0] ?? null;
}

function readPosePoint(value, minimumConfidence) {
  const point = readPoint(value);
  if (!point) {
    return null;
  }
  const confidence = pointConfidence(value);
  return confidence !== null && confidence < minimumConfidence ? null : point;
}

function isHandLandmarkList(value) {
  return Array.isArray(value) &&
    value.length === HAND_LANDMARK_COUNT &&
    value.every((point) => Boolean(readPoint(point)));
}

function readPoint(value) {
  if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y)) {
    return null;
  }
  return {
    x: Number(value.x),
    y: Number(value.y),
    z: Number.isFinite(value.z) ? Number(value.z) : 0,
  };
}

function pointConfidence(value) {
  const values = [value?.visibility, value?.presence]
    .filter(Number.isFinite)
    .map(Number);
  return values.length > 0 ? clamp(Math.min(...values), 0, 1) : null;
}

function toMetric(point, aspectRatio) {
  return { x: point.x, y: point.y / aspectRatio };
}

function rotate2d(vector, cos, sin) {
  return {
    x: cos * vector.x - sin * vector.y,
    y: sin * vector.x + cos * vector.y,
  };
}

function add2d(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

function subtract2d(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function scale2d(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar };
}

function dot2d(a, b) {
  return a.x * b.x + a.y * b.y;
}

function cross2d(a, b) {
  return a.x * b.y - a.y * b.x;
}

function magnitude2d(vector) {
  return Math.hypot(vector.x, vector.y);
}

function squaredMagnitude2d(vector) {
  return vector.x * vector.x + vector.y * vector.y;
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) {
    return value >= edge1 ? 1 : 0;
  }
  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function positiveFiniteOr(value, fallback) {
  const resolved = finiteNumber(value);
  return resolved !== null && resolved > 0 ? resolved : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function invalidResult(reason, details = {}) {
  return {
    valid: false,
    reason,
    mode: details.mode ?? null,
    landmarks: null,
    worldLandmarks: null,
    ageMs: Number.isFinite(details.ageSec) ? details.ageSec * 1000 : null,
    confidence: 0,
    observedSourcePtsSec: null,
    sourcePtsSec: null,
    scale: null,
    rotationRad: null,
    residual: null,
    proxyCount: 0,
    usedPoseIndices: [],
  };
}
