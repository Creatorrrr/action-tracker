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
export const DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE = 0.8;

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

export function normalizeDepthCalibrationReferenceProfile(profile, segments = DEPTH_CALIBRATION_SEGMENTS) {
  const sourceRatios = profile?.segmentRatios ?? profile?.referenceRatios ?? {};
  const segmentRatios = {};
  const referenceRatios = {};

  for (const segment of segments) {
    const source = sourceRatios[segment.name];
    const ratio = Number(
      typeof source === 'number'
        ? source
        : source?.ratio ?? source?.referenceRatio,
    );

    if (!Number.isFinite(ratio) || ratio <= 0) {
      continue;
    }

    segmentRatios[segment.name] = {
      ratio,
      cv: Number.isFinite(Number(source?.cv)) ? Number(source.cv) : null,
      samples: Number.isFinite(Number(source?.samples)) ? Number(source.samples) : 0,
      group: source?.group ?? segment.group,
      gated: Boolean(source?.gated ?? segment.gated),
      source: source?.source ?? 'external-profile',
    };
    referenceRatios[segment.name] = ratio;
  }

  return {
    version: 1,
    source: profile?.source ?? profile?.sourceRecording ?? '',
    extractor: profile?.extractor ?? 'external-profile',
    createdAt: profile?.createdAt ?? null,
    segmentRatios,
    referenceRatios,
    segmentCount: Object.keys(referenceRatios).length,
  };
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

export function estimateCalibrationPoseQuality(points) {
  const coverage = depthCalibrationCoverage(points);
  const shoulderWidth = distance2D(points?.leftShoulder, points?.rightShoulder);
  const emptyResult = {
    score: 0,
    passed: false,
    targetScore: DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE,
    coverage,
    requiredUpperBodySegments: DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS,
    shoulderWidth,
    coverageScore: 0,
    armScore: 0,
    levelScore: 0,
    symmetryScore: 0,
    visibilityScore: 0,
    leftArm: scoreCalibrationArm(null, 'left', shoulderWidth),
    rightArm: scoreCalibrationArm(null, 'right', shoulderWidth),
    reasons: ['missing_shoulders'],
  };

  if (!Number.isFinite(shoulderWidth) || shoulderWidth < 0.0001) {
    return emptyResult;
  }

  const leftArm = scoreCalibrationArm(points, 'left', shoulderWidth);
  const rightArm = scoreCalibrationArm(points, 'right', shoulderWidth);
  const armScore = average([leftArm.score, rightArm.score]);
  const levelScore = average([leftArm.levelScore, rightArm.levelScore]);
  const visibilityScore = average([leftArm.visibilityScore, rightArm.visibilityScore]);
  const coverageScore = clamp01(
    (coverage.upperBodySegments - 2) / Math.max(1, DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS - 2),
  );
  const symmetryScore = leftArm.present && rightArm.present
    ? 1 - clamp01(Math.abs(leftArm.wristSpreadRatio - rightArm.wristSpreadRatio) / 0.5)
    : 0;
  const score = clamp01(
    coverageScore * 0.25
      + armScore * 0.45
      + levelScore * 0.15
      + symmetryScore * 0.1
      + visibilityScore * 0.05,
  );
  const reasons = [];

  if (coverage.upperBodySegments < DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS) {
    reasons.push('upper_body_coverage');
  }

  if (!leftArm.present) {
    reasons.push('left_arm_missing');
  }

  if (!rightArm.present) {
    reasons.push('right_arm_missing');
  }

  if (leftArm.openScore < 0.7 || rightArm.openScore < 0.7) {
    reasons.push('arms_not_open');
  }

  if (leftArm.levelScore < 0.65 || rightArm.levelScore < 0.65) {
    reasons.push('arms_not_level');
  }

  if (visibilityScore < 0.65) {
    reasons.push('low_visibility');
  }

  if (symmetryScore < 0.65) {
    reasons.push('asymmetric_arms');
  }

  const passed = score >= DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE
    && coverage.upperBodySegments >= DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS
    && leftArm.passed
    && rightArm.passed;

  return {
    score,
    passed,
    targetScore: DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE,
    coverage,
    requiredUpperBodySegments: DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS,
    shoulderWidth,
    coverageScore,
    armScore,
    levelScore,
    symmetryScore,
    visibilityScore,
    leftArm,
    rightArm,
    reasons: passed ? [] : reasons,
  };
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

function scoreCalibrationArm(points, side, shoulderWidth) {
  const names = side === 'left'
    ? { shoulder: 'leftShoulder', elbow: 'leftElbow', wrist: 'leftWrist' }
    : { shoulder: 'rightShoulder', elbow: 'rightElbow', wrist: 'rightWrist' };
  const shoulder = points?.[names.shoulder];
  const elbow = points?.[names.elbow];
  const wrist = points?.[names.wrist];
  const direction = side === 'left' ? -1 : 1;
  const empty = {
    present: false,
    score: 0,
    passed: false,
    openScore: 0,
    levelScore: 0,
    orderScore: 0,
    extensionScore: 0,
    visibilityScore: 0,
    elbowSpreadRatio: 0,
    wristSpreadRatio: 0,
    elbowLevelError: 1,
    wristLevelError: 1,
  };

  if (!shoulder || !elbow || !wrist || !Number.isFinite(shoulderWidth) || shoulderWidth < 0.0001) {
    return empty;
  }

  const elbowSpreadRatio = direction * (elbow.x - shoulder.x) / shoulderWidth;
  const wristSpreadRatio = direction * (wrist.x - shoulder.x) / shoulderWidth;
  const elbowLevelError = Math.abs(elbow.y - shoulder.y) / shoulderWidth;
  const wristLevelError = Math.abs(wrist.y - shoulder.y) / shoulderWidth;
  const openScore = Math.min(
    ramp(elbowSpreadRatio, 0.25, 0.7),
    ramp(wristSpreadRatio, 0.75, 1.2),
  );
  const orderScore = elbowSpreadRatio > 0.12 && wristSpreadRatio > elbowSpreadRatio + 0.05 ? 1 : 0;
  const levelScore = average([
    inverseRamp(elbowLevelError, 0.2, 0.55),
    inverseRamp(wristLevelError, 0.25, 0.65),
  ]);
  const extensionScore = ramp(distance2D(shoulder, wrist) / shoulderWidth, 0.75, 1.25);
  const visibility = minVisibility(shoulder, elbow, wrist);
  const visibilityScore = ramp(visibility, 0.2, 0.7);
  const score = clamp01(
    openScore * 0.35
      + levelScore * 0.3
      + orderScore * 0.15
      + extensionScore * 0.1
      + visibilityScore * 0.1,
  );

  return {
    present: true,
    score,
    passed: score >= 0.75 && openScore >= 0.7 && levelScore >= 0.65 && visibilityScore >= 0.6,
    openScore,
    levelScore,
    orderScore,
    extensionScore,
    visibilityScore,
    elbowSpreadRatio,
    wristSpreadRatio,
    elbowLevelError,
    wristLevelError,
  };
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

function ramp(value, start, end) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (end <= start) {
    return value >= end ? 1 : 0;
  }

  return clamp01((value - start) / (end - start));
}

function inverseRamp(value, pass, fail) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (fail <= pass) {
    return value <= pass ? 1 : 0;
  }

  return 1 - clamp01((value - pass) / (fail - pass));
}

function minVisibility(...points) {
  const values = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? Math.min(...values) : 1;
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
