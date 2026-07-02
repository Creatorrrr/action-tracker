export const DEPTH_CALIBRATION_MODE_DYNAMIC = 'dynamic';
export const DEPTH_CALIBRATION_MODE_STATIC = 'static';
export const DEPTH_CALIBRATION_TARGET_SCORE = 0.95;
export const DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD = 0.08;
export const DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD = 0.08;
export const DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS = 0.6;
export const DEPTH_CALIBRATION_WARMUP_FRAMES = 30;
export const DEPTH_CALIBRATION_MIN_SEGMENT_SAMPLES = 8;
export const DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES = 60;
export const DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS = 4;
export const DEPTH_CALIBRATION_CLAMP_WARNING_RATIO = 0.2;
export const DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS = 6;
export const DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS = 4;
export const DEPTH_CALIBRATION_SHOULDER_WIDTH_TO_TORSO_SCALE = 2.5;
export const DEPTH_CALIBRATION_AMBIGUOUS_DEPTH_SIGN_DXY_RATIO = 0.92;

export const DEPTH_CALIBRATION_SEGMENTS = [
  { name: 'torso', group: 'torso', from: 'hipMid', to: 'shoulderMid', gated: true },
  { name: 'leftUpperArm', group: 'arms', from: 'leftShoulder', to: 'leftElbow', gated: true },
  { name: 'leftForeArm', group: 'arms', from: 'leftElbow', to: 'leftWrist', gated: true },
  { name: 'rightUpperArm', group: 'arms', from: 'rightShoulder', to: 'rightElbow', gated: true },
  { name: 'rightForeArm', group: 'arms', from: 'rightElbow', to: 'rightWrist', gated: true },
  { name: 'leftUpperLeg', group: 'legs', from: 'leftHip', to: 'leftKnee', gated: true },
  { name: 'leftLowerLeg', group: 'legs', from: 'leftKnee', to: 'leftAnkle', gated: true },
  { name: 'rightUpperLeg', group: 'legs', from: 'rightHip', to: 'rightKnee', gated: true },
  { name: 'rightLowerLeg', group: 'legs', from: 'rightKnee', to: 'rightAnkle', gated: true },
  { name: 'neck', group: 'torso', from: 'shoulderMid', to: 'headAimBase', gated: false },
  { name: 'leftFoot', group: 'legs', from: 'leftAnkle', to: 'leftFootIndex', gated: false },
  { name: 'rightFoot', group: 'legs', from: 'rightAnkle', to: 'rightFootIndex', gated: false },
];

export const DEPTH_CALIBRATION_SOLVE_STEPS = [
  { segmentName: 'leftUpperArm', parent: 'leftShoulder', child: 'leftElbow' },
  { segmentName: 'leftForeArm', parent: 'leftElbow', child: 'leftWrist' },
  { segmentName: 'rightUpperArm', parent: 'rightShoulder', child: 'rightElbow' },
  { segmentName: 'rightForeArm', parent: 'rightElbow', child: 'rightWrist' },
  { segmentName: 'leftUpperLeg', parent: 'leftHip', child: 'leftKnee' },
  { segmentName: 'leftLowerLeg', parent: 'leftKnee', child: 'leftAnkle' },
  { segmentName: 'rightUpperLeg', parent: 'rightHip', child: 'rightKnee' },
  { segmentName: 'rightLowerLeg', parent: 'rightKnee', child: 'rightAnkle' },
];

export function normalizeDepthCalibrationMode(value) {
  return value === DEPTH_CALIBRATION_MODE_STATIC
    ? DEPTH_CALIBRATION_MODE_STATIC
    : DEPTH_CALIBRATION_MODE_DYNAMIC;
}

export function bodyScale2D(points) {
  const torso = distance2D(points?.shoulderMid, points?.hipMid);
  const shoulders = distance2D(points?.leftShoulder, points?.rightShoulder);
  const hips = distance2D(points?.leftHip, points?.rightHip);

  const upperBodyScale = shoulders * DEPTH_CALIBRATION_SHOULDER_WIDTH_TO_TORSO_SCALE;

  return Math.max(torso, upperBodyScale, hips, 0.0001);
}

export function distance2D(a, b) {
  if (!a || !b) {
    return 0;
  }

  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distance3D(a, b) {
  if (!a || !b) {
    return 0;
  }

  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

export function segmentLengthRatio(points, segment, scale = bodyScale2D(points)) {
  const from = points?.[segment.from];
  const to = points?.[segment.to];

  if (!from || !to || scale < 0.0001) {
    return null;
  }

  const length = distance3D(from, to);

  if (length < 0.0001) {
    return null;
  }

  return length / scale;
}

export function depthCalibrationCoverage(points, segments = DEPTH_CALIBRATION_SEGMENTS) {
  const scale = bodyScale2D(points);
  const coverage = {
    validSegments: 0,
    upperBodySegments: 0,
    lowerBodySegments: 0,
  };

  for (const segment of segments) {
    if (!segment.gated) {
      continue;
    }

    const ratio = segmentLengthRatio(points, segment, scale);

    if (!Number.isFinite(ratio) || ratio <= 0) {
      continue;
    }

    coverage.validSegments += 1;

    if (segment.group === 'legs') {
      coverage.lowerBodySegments += 1;
    } else {
      coverage.upperBodySegments += 1;
    }
  }

  return coverage;
}

export function resolveDepthCalibrationMinSegments(coverage = {}) {
  return (coverage.lowerBodySegments ?? 0) > 0
    ? DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS
    : DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS;
}

export function solveDistalDepth({
  parent,
  child,
  rawChild = child,
  targetLength,
  previousDz = 0,
  smoothingAlpha = 1,
  signEpsilon = 0.01,
} = {}) {
  if (!parent || !child || !Number.isFinite(targetLength) || targetLength <= 0) {
    return {
      z: child?.z ?? 0,
      dz: 0,
      solved: false,
      clamped: false,
      smoothnessDelta: 0,
      signSource: 'none',
    };
  }

  const dxy = distance2D(parent, child);
  const effectiveLength = Math.max(targetLength, dxy);
  const rawDz = Number.isFinite(rawChild?.z) ? rawChild.z - parent.z : child.z - parent.z;
  const signChoice = chooseDepthSign(rawDz, previousDz, signEpsilon, {
    preferPrevious: dxy >= targetLength * DEPTH_CALIBRATION_AMBIGUOUS_DEPTH_SIGN_DXY_RATIO,
  });

  if (signChoice.sign === 0) {
    const dz = child.z - parent.z;

    return {
      z: child.z,
      dz,
      solved: false,
      clamped: dxy > targetLength,
      smoothnessDelta: 0,
      signSource: signChoice.source,
    };
  }

  const targetDz = signChoice.sign * Math.sqrt(Math.max(effectiveLength * effectiveLength - dxy * dxy, 0));
  const targetZ = parent.z + targetDz;
  const alpha = clamp01(smoothingAlpha);
  const z = child.z + (targetZ - child.z) * alpha;
  const dz = z - parent.z;

  return {
    z,
    dz,
    solved: true,
    clamped: dxy > targetLength,
    smoothnessDelta: Math.abs(z - targetZ),
    signSource: signChoice.source,
  };
}

export function lengthConsistencyRow({
  segment,
  points,
  referenceRatio,
  scale = bodyScale2D(points),
  smoothnessDelta = 0,
  clamped = false,
} = {}) {
  const from = points?.[segment?.from];
  const to = points?.[segment?.to];

  if (!segment || !from || !to || !Number.isFinite(referenceRatio) || referenceRatio <= 0 || scale < 0.0001) {
    return null;
  }

  const nominalTargetLength = referenceRatio * scale;
  const actualLength = distance3D(from, to);
  const targetLength = clamped && actualLength > nominalTargetLength
    ? actualLength
    : nominalTargetLength;
  const relativeLengthError = targetLength > 0
    ? Math.abs(actualLength - targetLength) / targetLength
    : 0;
  const smoothnessOk = !Number.isFinite(smoothnessDelta)
    || smoothnessDelta <= DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD * scale;

  return {
    name: segment.name,
    group: segment.group,
    gated: Boolean(segment.gated),
    actualLength,
    targetLength,
    nominalTargetLength,
    referenceRatio,
    relativeLengthError,
    smoothnessDelta,
    smoothnessOk,
    clamped: Boolean(clamped),
    matched: relativeLengthError <= DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD && smoothnessOk,
  };
}

export function summarizeLengthConsistency(rows) {
  const validRows = rows.filter((row) => Number.isFinite(row?.relativeLengthError));
  const gatedRows = validRows.filter((row) => row.gated);
  const matchedRows = gatedRows.filter((row) => row.matched);
  const cvEligibleRows = gatedRows.filter((row) => !row.clamped);
  const segmentCvRows = Object.values(groupBy(cvEligibleRows, (row) => row.name))
    .map((segmentRows) => ({
      name: segmentRows[0]?.name ?? '',
      group: segmentRows[0]?.group ?? '',
      count: segmentRows.length,
      cv: coefficientOfVariation(segmentRows.map((row) => row.actualLength / Math.max(row.targetLength, 0.0001))),
    }))
    .filter((row) => Number.isFinite(row.cv))
    .map((row) => ({
      ...row,
      reliable: row.count >= DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
    }));
  const reliableSegmentCvRows = segmentCvRows.filter((row) => row.reliable);
  const segmentCvs = reliableSegmentCvRows.map((row) => row.cv).sort((a, b) => a - b);
  const errors = gatedRows.map((row) => row.relativeLengthError).sort((a, b) => a - b);
  const clampedRows = gatedRows.filter((row) => row.clamped);

  return {
    count: gatedRows.length,
    matchedCount: matchedRows.length,
    score: gatedRows.length > 0 ? matchedRows.length / gatedRows.length : 0,
    meanRelativeLengthError: average(errors),
    p95RelativeLengthError: percentile(errors, 0.95),
    maxRelativeLengthError: errors.length > 0 ? errors[errors.length - 1] : 0,
    meanSegmentCv: average(segmentCvs),
    p95SegmentCv: percentile(segmentCvs, 0.95),
    cvEligibleCount: cvEligibleRows.length,
    cvReliableSegmentCount: reliableSegmentCvRows.length,
    cvSparseSegmentCount: segmentCvRows.length - reliableSegmentCvRows.length,
    cvMinSegmentSamples: DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
    clampedRatio: gatedRows.length > 0 ? clampedRows.length / gatedRows.length : 0,
    segmentCvs: segmentCvRows,
  };
}

function chooseDepthSign(rawDz, previousDz, epsilon, options = {}) {
  const previousSign = Number.isFinite(previousDz) && Math.abs(previousDz) > epsilon
    ? Math.sign(previousDz)
    : 0;

  if (Number.isFinite(rawDz) && Math.abs(rawDz) > epsilon) {
    const rawSign = Math.sign(rawDz);

    if (options.preferPrevious && previousSign !== 0 && previousSign !== rawSign) {
      return { sign: previousSign, source: 'previous-ambiguous' };
    }

    return { sign: rawSign, source: 'raw' };
  }

  if (previousSign !== 0) {
    return { sign: previousSign, source: 'previous' };
  }

  return { sign: 0, source: 'none' };
}

function coefficientOfVariation(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);

  if (valid.length < 2) {
    return 0;
  }

  const sorted = valid.slice().sort((a, b) => a - b);
  const robustValues = trimCentralRange(sorted, 0.1, 0.9);
  const center = percentile(robustValues, 0.5);
  const avg = average(robustValues);
  const variance = robustValues.reduce((sum, value) => sum + (value - avg) ** 2, 0) / robustValues.length;

  return center > 0 ? Math.sqrt(variance) / center : 0;
}

function trimCentralRange(sortedValues, lowerPercentile, upperPercentile) {
  if (sortedValues.length < 20) {
    return sortedValues;
  }

  const start = Math.floor(sortedValues.length * lowerPercentile);
  const end = Math.max(start + 1, Math.ceil(sortedValues.length * upperPercentile));

  return sortedValues.slice(start, end);
}

function groupBy(items, keyFn) {
  return items.reduce((result, item) => {
    const key = keyFn(item);
    result[key] = result[key] ?? [];
    result[key].push(item);
    return result;
  }, {});
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));

  if (valid.length === 0) {
    return 0;
  }

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function percentile(sortedValues, percentileValue) {
  const values = sortedValues.filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * percentileValue) - 1),
  );

  return values[index];
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}
