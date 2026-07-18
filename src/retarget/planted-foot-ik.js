const MIN_VECTOR_LENGTH = 1e-8;

const DEFAULT_CONTACT_OPTIONS = Object.freeze({
  confirmMs: 100,
  confirmSamples: 3,
  maxGapMs: 100,
  enterSpeedHeightPerSec: 0.18,
  enterVerticalSpeedHeightPerSec: 0.14,
  exitSpeedHeightPerSec: 0.45,
  enterHeightRatio: 0.045,
  exitHeightRatio: 0.075,
  maxRigFloorHeightRatio: 0.08,
  exitRigFloorHeightRatio: 0.1,
  maxGroundPlaneAnchorDriftHeightRatio: 0.01,
  enterConfidence: 0.55,
  exitConfidence: 0.35,
  speedSmoothing: 0.45,
  releaseBlendMs: 180,
});

export {
  DEFAULT_CONTACT_OPTIONS,
  createPlantedFootContactState,
  releasePlantedFootContact,
  resetPlantedFootContactState,
  resolveBoundedTwoBoneRootCorrection,
  solveSignedPoleTwoBone,
  updatePlantedFootContact,
};

function createPlantedFootContactState(side = null, reason = "initial") {
  return {
    version: 1,
    side,
    phase: "moving",
    candidateSinceMs: null,
    candidateSamples: 0,
    candidatePositionSum: null,
    plantedAtMs: null,
    anchorWorld: null,
    previousRawWorld: null,
    previousTimestampMs: null,
    instantaneousSpeedHeightPerSec: null,
    verticalSpeedHeightPerSec: null,
    smoothedSpeedHeightPerSec: null,
    heightAboveFloorRatio: null,
    rigFloorHeightRatio: null,
    groundPlaneAnchorDriftHeightRatio: null,
    confidence: 0,
    poleWorld: null,
    releasedAtMs: null,
    releaseReason: reason,
    directionBlend: 1,
    owner: "direction",
    ikApplied: false,
    ikReachable: null,
    endpointResidualRatio: null,
    reachErrorRatio: null,
    bendDeg: null,
    poleSource: null,
    lastAppliedWorld: null,
  };
}

function resetPlantedFootContactState(previous = null, reason = "reset") {
  return createPlantedFootContactState(previous?.side ?? null, reason);
}

function releasePlantedFootContact(previous, reason, timestampMs, observation = {}) {
  const state = previous ?? createPlantedFootContactState();
  const timestamp = finiteNumber(timestampMs);
  const wasConstrained = Boolean(state.ikApplied);

  return {
    ...state,
    phase: "moving",
    candidateSinceMs: null,
    candidateSamples: 0,
    candidatePositionSum: null,
    plantedAtMs: null,
    anchorWorld: null,
    previousRawWorld: cloneVector(observation.rawWorld) ?? state.previousRawWorld,
    previousTimestampMs: timestamp ?? state.previousTimestampMs,
    instantaneousSpeedHeightPerSec: optionalFiniteNumber(
      observation.instantaneousSpeedHeightPerSec,
      state.instantaneousSpeedHeightPerSec,
    ),
    verticalSpeedHeightPerSec: optionalFiniteNumber(
      observation.verticalSpeedHeightPerSec,
      state.verticalSpeedHeightPerSec,
    ),
    smoothedSpeedHeightPerSec: optionalFiniteNumber(
      observation.smoothedSpeedHeightPerSec,
      state.smoothedSpeedHeightPerSec,
    ),
    heightAboveFloorRatio: optionalFiniteNumber(
      observation.heightAboveFloorRatio,
      state.heightAboveFloorRatio,
    ),
    rigFloorHeightRatio: optionalFiniteNumber(
      observation.rigFloorHeightRatio,
      state.rigFloorHeightRatio,
    ),
    groundPlaneAnchorDriftHeightRatio: optionalFiniteNumber(
      observation.groundPlaneAnchorDriftHeightRatio,
      state.groundPlaneAnchorDriftHeightRatio,
    ),
    confidence: optionalFiniteNumber(observation.confidence, state.confidence) ?? 0,
    releasedAtMs: wasConstrained && timestamp !== null ? timestamp : state.releasedAtMs,
    releaseReason: reason,
    directionBlend: wasConstrained ? 0 : state.directionBlend,
    owner: "direction",
    ikApplied: false,
    ikReachable: null,
    endpointResidualRatio: null,
    reachErrorRatio: null,
    bendDeg: null,
    poleSource: null,
  };
}

function updatePlantedFootContact(previous, sample = {}, options = {}) {
  const config = normalizeContactOptions(options);
  const state = previous ?? createPlantedFootContactState(sample.side ?? null);
  const timestampMs = finiteNumber(sample.timestampMs);
  const rawWorld = toVector(sample.rawWorld);
  const floorY = finiteNumber(sample.floorY);
  const rigFloorY = finiteNumber(sample.rigFloorY);
  const avatarHeight = finiteNumber(sample.avatarHeight);
  const confidence = clamp01(Number(sample.confidence ?? 0));
  const enabled = sample.enabled !== false;

  if (
    timestampMs === null ||
    !rawWorld ||
    floorY === null ||
    rigFloorY === null ||
    avatarHeight === null ||
    avatarHeight <= MIN_VECTOR_LENGTH
  ) {
    return resetPlantedFootContactState(state, "invalid-observation");
  }

  const previousTimestampMs = finiteNumber(state.previousTimestampMs);
  const deltaMs = previousTimestampMs === null ? null : timestampMs - previousTimestampMs;
  const previousRawWorld = toVector(state.previousRawWorld);
  const timestampDiscontinuity = deltaMs !== null && (deltaMs <= 0 || deltaMs > config.maxGapMs);
  const instantaneousSpeedHeightPerSec = deltaMs !== null && deltaMs > 0 && previousRawWorld
    ? distance(rawWorld, previousRawWorld) / avatarHeight / (deltaMs / 1000)
    : null;
  const verticalSpeedHeightPerSec = deltaMs !== null && deltaMs > 0 && previousRawWorld
    ? Math.abs(rawWorld.y - previousRawWorld.y) / avatarHeight / (deltaMs / 1000)
    : null;
  const previousSmoothedSpeed = finiteNumber(state.smoothedSpeedHeightPerSec);
  const smoothedSpeedHeightPerSec = instantaneousSpeedHeightPerSec === null
    ? previousSmoothedSpeed
    : previousSmoothedSpeed === null
      ? instantaneousSpeedHeightPerSec
      : lerp(previousSmoothedSpeed, instantaneousSpeedHeightPerSec, config.speedSmoothing);
  const heightAboveFloorRatio = Math.max(0, (rawWorld.y - floorY) / avatarHeight);
  const rigFloorHeightRatio = (rawWorld.y - rigFloorY) / avatarHeight;
  const anchorWorld = toVector(state.anchorWorld);
  const groundPlaneAnchorDriftHeightRatio = anchorWorld
    ? groundPlaneDistance(rawWorld, anchorWorld) / avatarHeight
    : null;
  const observation = {
    rawWorld,
    instantaneousSpeedHeightPerSec,
    verticalSpeedHeightPerSec,
    smoothedSpeedHeightPerSec,
    heightAboveFloorRatio,
    rigFloorHeightRatio,
    groundPlaneAnchorDriftHeightRatio,
    confidence,
  };

  if (timestampDiscontinuity) {
    return releasePlantedFootContact(state, "timestamp-gap", timestampMs, observation);
  }

  if (!enabled) {
    return releasePlantedFootContact(state, sample.disabledReason ?? "contact-disabled", timestampMs, observation);
  }

  if (state.phase === "planted") {
    const exitReason = resolvePlantedExitReason({
      confidence,
      heightAboveFloorRatio,
      rigFloorHeightRatio,
      groundPlaneAnchorDriftHeightRatio,
      instantaneousSpeedHeightPerSec,
      smoothedSpeedHeightPerSec,
    }, config);

    if (exitReason) {
      return releasePlantedFootContact(state, exitReason, timestampMs, observation);
    }

    return {
      ...state,
      previousRawWorld: cloneVector(rawWorld),
      previousTimestampMs: timestampMs,
      instantaneousSpeedHeightPerSec,
      verticalSpeedHeightPerSec,
      smoothedSpeedHeightPerSec,
      heightAboveFloorRatio,
      rigFloorHeightRatio,
      groundPlaneAnchorDriftHeightRatio,
      confidence,
      directionBlend: 1,
      owner: "planted-foot-ik",
      ikApplied: Boolean(state.ikApplied),
      ikReachable: null,
      endpointResidualRatio: null,
    };
  }

  const directionBlend = releaseDirectionBlend(state.releasedAtMs, timestampMs, config.releaseBlendMs);
  const enterEligible = confidence >= config.enterConfidence &&
    heightAboveFloorRatio <= config.enterHeightRatio &&
    rigFloorHeightRatio <= config.maxRigFloorHeightRatio &&
    smoothedSpeedHeightPerSec !== null &&
    smoothedSpeedHeightPerSec <= config.enterSpeedHeightPerSec &&
    verticalSpeedHeightPerSec !== null &&
    verticalSpeedHeightPerSec <= config.enterVerticalSpeedHeightPerSec;

  if (!enterEligible) {
    return {
      ...state,
      phase: "moving",
      candidateSinceMs: null,
      candidateSamples: 0,
      candidatePositionSum: null,
      previousRawWorld: cloneVector(rawWorld),
      previousTimestampMs: timestampMs,
      instantaneousSpeedHeightPerSec,
      verticalSpeedHeightPerSec,
      smoothedSpeedHeightPerSec,
      heightAboveFloorRatio,
      rigFloorHeightRatio,
      groundPlaneAnchorDriftHeightRatio: null,
      confidence,
      directionBlend,
      owner: "direction",
      ikApplied: false,
      ikReachable: null,
      endpointResidualRatio: null,
    };
  }

  const candidateSinceMs = state.phase === "candidate" && finiteNumber(state.candidateSinceMs) !== null
    ? Number(state.candidateSinceMs)
    : timestampMs;
  const candidateSamples = state.phase === "candidate"
    ? Math.max(0, Math.trunc(Number(state.candidateSamples) || 0)) + 1
    : 1;
  const candidatePositionSum = state.phase === "candidate" && toVector(state.candidatePositionSum)
    ? add(state.candidatePositionSum, rawWorld)
    : cloneVector(rawWorld);
  const confirmed = timestampMs - candidateSinceMs >= config.confirmMs &&
    candidateSamples >= config.confirmSamples;

  if (confirmed) {
    const candidateAnchorWorld = scale(candidatePositionSum, 1 / candidateSamples);
    const candidateGroundPlaneDriftHeightRatio = groundPlaneDistance(
      rawWorld,
      candidateAnchorWorld,
    ) / avatarHeight;

    if (candidateGroundPlaneDriftHeightRatio > config.maxGroundPlaneAnchorDriftHeightRatio) {
      return releasePlantedFootContact(state, "anchor-drift", timestampMs, {
        ...observation,
        groundPlaneAnchorDriftHeightRatio: candidateGroundPlaneDriftHeightRatio,
      });
    }

    return {
      ...state,
      phase: "planted",
      candidateSinceMs: null,
      candidateSamples: 0,
      candidatePositionSum: null,
      plantedAtMs: timestampMs,
      anchorWorld: candidateAnchorWorld,
      previousRawWorld: cloneVector(rawWorld),
      previousTimestampMs: timestampMs,
      instantaneousSpeedHeightPerSec,
      verticalSpeedHeightPerSec,
      smoothedSpeedHeightPerSec,
      heightAboveFloorRatio,
      rigFloorHeightRatio,
      groundPlaneAnchorDriftHeightRatio: candidateGroundPlaneDriftHeightRatio,
      confidence,
      releaseReason: null,
      directionBlend: 1,
      owner: "planted-foot-ik",
      ikApplied: false,
      ikReachable: null,
      endpointResidualRatio: null,
    };
  }

  return {
    ...state,
    phase: "candidate",
    candidateSinceMs,
    candidateSamples,
    candidatePositionSum,
    previousRawWorld: cloneVector(rawWorld),
    previousTimestampMs: timestampMs,
    instantaneousSpeedHeightPerSec,
    verticalSpeedHeightPerSec,
    smoothedSpeedHeightPerSec,
    heightAboveFloorRatio,
    rigFloorHeightRatio,
    groundPlaneAnchorDriftHeightRatio: null,
    confidence,
    directionBlend,
    owner: "direction",
    ikApplied: false,
    ikReachable: null,
    endpointResidualRatio: null,
  };
}

function resolveBoundedTwoBoneRootCorrection(options = {}) {
  const solution = options.solution;
  const anchorWorld = toVector(options.anchorWorld);
  const ankleTarget = toVector(solution?.ankleTarget);
  const maxCorrection = finiteNumber(options.maxCorrection);

  if (
    solution?.valid !== true ||
    solution?.reachable !== false ||
    !anchorWorld ||
    !ankleTarget ||
    maxCorrection === null ||
    maxCorrection <= MIN_VECTOR_LENGTH
  ) {
    return null;
  }

  const correction = subtract(anchorWorld, ankleTarget);
  const correctionDistance = length(correction);

  if (
    correctionDistance <= MIN_VECTOR_LENGTH ||
    correctionDistance > maxCorrection
  ) {
    return null;
  }

  return correction;
}

function solveSignedPoleTwoBone(options = {}) {
  const root = toVector(options.root);
  const mid = toVector(options.mid);
  const end = toVector(options.end);
  const target = toVector(options.target);

  if (!root || !mid || !end || !target) {
    return invalidTwoBoneResult("invalid-point");
  }

  const upperLength = distance(root, mid);
  const lowerLength = distance(mid, end);
  const targetVector = subtract(target, root);
  const targetDistance = length(targetVector);

  if (
    upperLength <= MIN_VECTOR_LENGTH ||
    lowerLength <= MIN_VECTOR_LENGTH ||
    targetDistance <= MIN_VECTOR_LENGTH
  ) {
    return invalidTwoBoneResult("degenerate-chain", {
      upperLength,
      lowerLength,
      targetDistance,
    });
  }

  const axis = scale(targetVector, 1 / targetDistance);
  const maxBendDeg = clamp(Number(options.maxBendDeg ?? 155), 0, 179.9);
  const minBendDeg = clamp(Number(options.minBendDeg ?? 1), 0, maxBendDeg);
  const epsilon = Math.max(MIN_VECTOR_LENGTH, (upperLength + lowerLength) * 1e-5);
  const maxDistance = Math.max(epsilon, Math.sqrt(Math.max(0,
    upperLength * upperLength +
    lowerLength * lowerLength +
    2 * upperLength * lowerLength * Math.cos(degToRad(minBendDeg)),
  )));
  const minDistanceForBend = Math.sqrt(Math.max(0,
    upperLength * upperLength +
    lowerLength * lowerLength +
    2 * upperLength * lowerLength * Math.cos(degToRad(maxBendDeg)),
  ));
  const minDistance = Math.min(
    maxDistance,
    Math.max(Math.abs(upperLength - lowerLength) + epsilon, minDistanceForBend),
  );
  const solvedDistance = clamp(targetDistance, minDistance, maxDistance);
  const reachError = Math.abs(targetDistance - solvedDistance);
  const maxReachError = Math.max(0, Number(options.maxReachError ?? epsilon * 2));
  const reachable = reachError <= maxReachError;
  const ankleTarget = add(root, scale(axis, solvedDistance));
  const pole = resolvePoleDirection({
    root,
    mid,
    axis,
    previousPole: options.previousPole,
    fallbackPole: options.fallbackPole,
    minimumSourcePoleLength: upperLength * 0.02,
  });

  if (!pole.direction) {
    return invalidTwoBoneResult("degenerate-pole", {
      upperLength,
      lowerLength,
      targetDistance,
      solvedDistance,
      reachError,
      reachable,
    });
  }

  const along = (
    upperLength * upperLength -
    lowerLength * lowerLength +
    solvedDistance * solvedDistance
  ) / (2 * solvedDistance);
  const poleDistance = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
  const kneeTarget = add(
    add(root, scale(axis, along)),
    scale(pole.direction, poleDistance),
  );
  const upperDirection = normalize(subtract(kneeTarget, root));
  const lowerDirection = normalize(subtract(ankleTarget, kneeTarget));
  const planeNormal = normalize(cross(axis, pole.direction));
  const bendCosine = clamp(
    (solvedDistance * solvedDistance - upperLength * upperLength - lowerLength * lowerLength) /
      (2 * upperLength * lowerLength),
    -1,
    1,
  );

  if (!upperDirection || !lowerDirection || !planeNormal) {
    return invalidTwoBoneResult("degenerate-solution", {
      upperLength,
      lowerLength,
      targetDistance,
      solvedDistance,
      reachError,
      reachable,
    });
  }

  return {
    valid: true,
    reason: "ok",
    reachable,
    upperLength,
    lowerLength,
    targetDistance,
    solvedDistance,
    reachError,
    bendDeg: radToDeg(Math.acos(bendCosine)),
    poleSource: pole.source,
    poleDirection: pole.direction,
    planeNormal,
    kneeTarget,
    ankleTarget,
    upperDirection,
    lowerDirection,
  };
}

function resolvePlantedExitReason(observation, config) {
  if (observation.confidence < config.exitConfidence) {
    return "low-confidence";
  }

  if (observation.heightAboveFloorRatio > config.exitHeightRatio) {
    return "foot-lift";
  }

  if (observation.rigFloorHeightRatio > config.exitRigFloorHeightRatio) {
    return "rig-floor-lift";
  }

  if (
    observation.groundPlaneAnchorDriftHeightRatio !== null &&
    observation.groundPlaneAnchorDriftHeightRatio > config.maxGroundPlaneAnchorDriftHeightRatio
  ) {
    return "anchor-drift";
  }

  if (
    observation.instantaneousSpeedHeightPerSec !== null &&
    observation.instantaneousSpeedHeightPerSec > config.exitSpeedHeightPerSec
  ) {
    return "foot-motion";
  }

  if (
    observation.smoothedSpeedHeightPerSec !== null &&
    observation.smoothedSpeedHeightPerSec > config.exitSpeedHeightPerSec
  ) {
    return "foot-motion";
  }

  return null;
}

function resolvePoleDirection({
  root,
  mid,
  axis,
  previousPole,
  fallbackPole,
  minimumSourcePoleLength = MIN_VECTOR_LENGTH,
}) {
  const rawProjected = projectPerpendicular(subtract(mid, root), axis);
  const previousProjected = toVector(previousPole)
    ? projectPerpendicular(toVector(previousPole), axis)
    : null;
  const fallbackProjected = toVector(fallbackPole)
    ? projectPerpendicular(toVector(fallbackPole), axis)
    : null;
  const previousDirection = previousProjected && length(previousProjected) > MIN_VECTOR_LENGTH
    ? normalize(previousProjected)
    : null;

  if (length(rawProjected) >= Math.max(MIN_VECTOR_LENGTH, minimumSourcePoleLength)) {
    let direction = normalize(rawProjected);

    if (previousDirection && dot(direction, previousDirection) < 0) {
      direction = scale(direction, -1);
    }

    return { source: "source-knee", direction };
  }

  if (previousDirection) {
    return { source: "previous-pole", direction: previousDirection };
  }

  if (fallbackProjected && length(fallbackProjected) > MIN_VECTOR_LENGTH) {
    return { source: "fallback-pole", direction: normalize(fallbackProjected) };
  }

  return { source: "none", direction: null };
}

function normalizeContactOptions(options) {
  return {
    confirmMs: nonNegative(options.confirmMs, DEFAULT_CONTACT_OPTIONS.confirmMs),
    confirmSamples: Math.max(1, Math.trunc(nonNegative(
      options.confirmSamples,
      DEFAULT_CONTACT_OPTIONS.confirmSamples,
    ))),
    maxGapMs: Math.max(1, nonNegative(options.maxGapMs, DEFAULT_CONTACT_OPTIONS.maxGapMs)),
    enterSpeedHeightPerSec: nonNegative(
      options.enterSpeedHeightPerSec,
      DEFAULT_CONTACT_OPTIONS.enterSpeedHeightPerSec,
    ),
    enterVerticalSpeedHeightPerSec: nonNegative(
      options.enterVerticalSpeedHeightPerSec,
      DEFAULT_CONTACT_OPTIONS.enterVerticalSpeedHeightPerSec,
    ),
    exitSpeedHeightPerSec: nonNegative(
      options.exitSpeedHeightPerSec,
      DEFAULT_CONTACT_OPTIONS.exitSpeedHeightPerSec,
    ),
    enterHeightRatio: nonNegative(options.enterHeightRatio, DEFAULT_CONTACT_OPTIONS.enterHeightRatio),
    exitHeightRatio: nonNegative(options.exitHeightRatio, DEFAULT_CONTACT_OPTIONS.exitHeightRatio),
    maxRigFloorHeightRatio: nonNegative(
      options.maxRigFloorHeightRatio,
      DEFAULT_CONTACT_OPTIONS.maxRigFloorHeightRatio,
    ),
    exitRigFloorHeightRatio: nonNegative(
      options.exitRigFloorHeightRatio,
      DEFAULT_CONTACT_OPTIONS.exitRigFloorHeightRatio,
    ),
    maxGroundPlaneAnchorDriftHeightRatio: nonNegative(
      options.maxGroundPlaneAnchorDriftHeightRatio,
      DEFAULT_CONTACT_OPTIONS.maxGroundPlaneAnchorDriftHeightRatio,
    ),
    enterConfidence: clamp01(Number(options.enterConfidence ?? DEFAULT_CONTACT_OPTIONS.enterConfidence)),
    exitConfidence: clamp01(Number(options.exitConfidence ?? DEFAULT_CONTACT_OPTIONS.exitConfidence)),
    speedSmoothing: clamp01(Number(options.speedSmoothing ?? DEFAULT_CONTACT_OPTIONS.speedSmoothing)),
    releaseBlendMs: nonNegative(options.releaseBlendMs, DEFAULT_CONTACT_OPTIONS.releaseBlendMs),
  };
}

function releaseDirectionBlend(releasedAtMs, timestampMs, releaseBlendMs) {
  const releasedAt = finiteNumber(releasedAtMs);

  if (releasedAt === null || releaseBlendMs <= 0) {
    return 1;
  }

  return clamp((timestampMs - releasedAt) / releaseBlendMs, 0, 1);
}

function invalidTwoBoneResult(reason, details = {}) {
  return {
    valid: false,
    reason,
    reachable: false,
    poleDirection: null,
    kneeTarget: null,
    ankleTarget: null,
    upperDirection: null,
    lowerDirection: null,
    ...details,
  };
}

function projectPerpendicular(vector, axis) {
  return subtract(vector, scale(axis, dot(vector, axis)));
}

function choosePerpendicular(axis) {
  const candidates = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ].sort((left, right) => Math.abs(dot(left, axis)) - Math.abs(dot(right, axis)));

  return normalize(projectPerpendicular(candidates[0], axis));
}

function toVector(value) {
  if (!value) {
    return null;
  }

  const x = finiteNumber(value.x ?? value[0]);
  const y = finiteNumber(value.y ?? value[1]);
  const z = finiteNumber(value.z ?? value[2]);

  if (x === null || y === null || z === null) {
    return null;
  }

  return { x, y, z };
}

function cloneVector(value) {
  const vector = toVector(value);
  return vector ? { ...vector } : null;
}

function add(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtract(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scale(value, scalar) {
  return {
    x: value.x * scalar,
    y: value.y * scalar,
    z: value.z * scalar,
  };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function length(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function distance(left, right) {
  return length(subtract(left, right));
}

function groundPlaneDistance(left, right) {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function normalize(value) {
  const magnitude = length(value);
  return magnitude > MIN_VECTOR_LENGTH ? scale(value, 1 / magnitude) : null;
}

function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

function finiteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function optionalFiniteNumber(value, fallback = null) {
  const numeric = finiteNumber(value);
  return numeric !== null ? numeric : finiteNumber(fallback);
}

function nonNegative(value, fallback) {
  const numeric = finiteNumber(value);
  return numeric === null ? fallback : Math.max(0, numeric);
}

function clamp01(value) {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function radToDeg(value) {
  return value * 180 / Math.PI;
}
