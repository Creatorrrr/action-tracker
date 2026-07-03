import {
  estimateFacingState,
  toLegacyFacing,
} from "./facing-estimator.js";

const SOLVER_VERSION = 1;
const MIN_DIRECTION_LENGTH = 0.000001;
const FULL_CONFIDENCE_VISIBILITY = 0.72;
const LOW_CONFIDENCE_VISIBILITY = 0.35;
const HINGE_RELIABLE_CONFIDENCE = 0.5;
const HINGE_LIMIT_EPSILON_DEG = 2;

const POSE = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

const BODY_TARGETS = [
  { bone: "Hips", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine1", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine2", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Neck", from: "shoulderMid", to: "headAimBase", group: "head" },
  { bone: "Head", from: "headAimBase", to: "headCrown", group: "head" },
  { bone: "LeftShoulder", from: "shoulderMid", to: "leftShoulder", group: "shoulder" },
  { bone: "RightShoulder", from: "shoulderMid", to: "rightShoulder", group: "shoulder" },
  { bone: "LeftArm", from: "leftShoulder", to: "leftElbow", group: "arms" },
  { bone: "LeftForeArm", from: "leftElbow", to: "leftWrist", group: "arms", hinge: "leftElbow" },
  { bone: "RightArm", from: "rightShoulder", to: "rightElbow", group: "arms" },
  { bone: "RightForeArm", from: "rightElbow", to: "rightWrist", group: "arms", hinge: "rightElbow" },
  { bone: "LeftUpLeg", from: "leftHip", to: "leftKnee", group: "legs" },
  { bone: "LeftLeg", from: "leftKnee", to: "leftAnkle", group: "legs", hinge: "leftKnee" },
  { bone: "LeftFoot", from: "leftAnkle", to: "leftFootIndex", group: "feet" },
  { bone: "RightUpLeg", from: "rightHip", to: "rightKnee", group: "legs" },
  { bone: "RightLeg", from: "rightKnee", to: "rightAnkle", group: "legs", hinge: "rightKnee" },
  { bone: "RightFoot", from: "rightAnkle", to: "rightFootIndex", group: "feet" },
];

const HINGES = [
  {
    name: "leftElbow",
    group: "arms",
    parent: "leftShoulder",
    joint: "leftElbow",
    child: "leftWrist",
    minFlexDeg: 0,
    maxFlexDeg: 155,
  },
  {
    name: "rightElbow",
    group: "arms",
    parent: "rightShoulder",
    joint: "rightElbow",
    child: "rightWrist",
    minFlexDeg: 0,
    maxFlexDeg: 155,
  },
  {
    name: "leftKnee",
    group: "legs",
    parent: "leftHip",
    joint: "leftKnee",
    child: "leftAnkle",
    minFlexDeg: 0,
    maxFlexDeg: 165,
  },
  {
    name: "rightKnee",
    group: "legs",
    parent: "rightHip",
    joint: "rightKnee",
    child: "rightAnkle",
    minFlexDeg: 0,
    maxFlexDeg: 165,
  },
];

export {
  BODY_TARGETS,
  HINGES,
  LOW_CONFIDENCE_VISIBILITY,
  POSE,
  SOLVER_VERSION,
  buildPosePoints,
  estimateFacing,
  estimateTrackingMode,
  retargetConfidence,
  solveHinges,
  solvePoseFrame,
  solvePoseTargetsFromPoints,
};

function solvePoseFrame(motionFrame, previousState = {}) {
  const points = buildPosePoints(motionFrame);

  return solvePoseTargetsFromPoints(points, previousState, {
    timestamp: Number(motionFrame?.timestamp ?? 0),
  });
}

function solvePoseTargetsFromPoints(points, previousState = {}, options = {}) {
  const mode = estimateTrackingMode(points);
  const facingState = estimateFacingState(points, previousState.facing, {
    lowConfidence: LOW_CONFIDENCE_VISIBILITY,
  });
  const facing = toLegacyFacing(facingState.state);
  const targets = BODY_TARGETS.map((target) => solveTarget(target, points))
    .filter(Boolean);
  const hinges = solveHinges(points);
  const hingeViolations = hinges.filter((hinge) => hinge.violation).length;
  const hingeLimitWarnings = hinges.filter((hinge) => hinge.limitWarning).length;

  return {
    version: SOLVER_VERSION,
    timestamp: Number(options.timestamp ?? 0),
    rotations: {},
    targets,
    hinges,
    state: {
      facing: facingState,
      mode,
    },
    meta: {
      facing,
      facingDetail: facingState.state,
      facingYawDeg: facingState.yawDeg,
      facingConfidence: facingState.confidence,
      facingReason: facingState.reason,
      mode,
      targetCount: targets.length,
      lowConfidenceTargets: targets.filter((target) => target.confidence <= LOW_CONFIDENCE_VISIBILITY).length,
      hingeCount: hinges.length,
      hingeViolations,
      hingeLimitWarnings,
      lowConfidenceHinges: hinges.filter((hinge) => hinge.confidence < HINGE_RELIABLE_CONFIDENCE).length,
    },
  };
}

function buildPosePoints(motionFrame) {
  const landmarks = motionFrame?.poseWorldLandmarks ?? motionFrame?.poseLandmarks ?? [];
  const points = {
    nose: pointFromLandmark(landmarks[POSE.nose]),
    leftEar: pointFromLandmark(landmarks[POSE.leftEar]),
    rightEar: pointFromLandmark(landmarks[POSE.rightEar]),
    leftShoulder: pointFromLandmark(landmarks[POSE.leftShoulder]),
    rightShoulder: pointFromLandmark(landmarks[POSE.rightShoulder]),
    leftElbow: pointFromLandmark(landmarks[POSE.leftElbow]),
    rightElbow: pointFromLandmark(landmarks[POSE.rightElbow]),
    leftWrist: pointFromLandmark(landmarks[POSE.leftWrist]),
    rightWrist: pointFromLandmark(landmarks[POSE.rightWrist]),
    leftHip: pointFromLandmark(landmarks[POSE.leftHip]),
    rightHip: pointFromLandmark(landmarks[POSE.rightHip]),
    leftKnee: pointFromLandmark(landmarks[POSE.leftKnee]),
    rightKnee: pointFromLandmark(landmarks[POSE.rightKnee]),
    leftAnkle: pointFromLandmark(landmarks[POSE.leftAnkle]),
    rightAnkle: pointFromLandmark(landmarks[POSE.rightAnkle]),
    leftHeel: pointFromLandmark(landmarks[POSE.leftHeel]),
    rightHeel: pointFromLandmark(landmarks[POSE.rightHeel]),
    leftFootIndex: pointFromLandmark(landmarks[POSE.leftFootIndex]),
    rightFootIndex: pointFromLandmark(landmarks[POSE.rightFootIndex]),
  };

  points.shoulderMid = midpoint(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint(points.leftHip, points.rightHip);
  points.headAimBase = midpoint(points.leftEar, points.rightEar) ?? points.nose;
  points.headCrown = points.nose
    ? {
        ...points.nose,
        y: points.nose.y + 0.12,
      }
    : null;

  return points;
}

function solveTarget(target, points) {
  const from = points[target.from];
  const to = points[target.to];

  if (!from || !to) {
    return null;
  }

  const direction = normalize(subtract(to, from));

  if (!direction) {
    return null;
  }

  return {
    bone: target.bone,
    group: target.group,
    from: target.from,
    to: target.to,
    hinge: target.hinge ?? null,
    direction,
    length: round(distance(from, to), 6),
    confidence: round(retargetConfidence(from, to), 6),
  };
}

function solveHinges(points) {
  return HINGES.map((hinge) => solveHinge(hinge, points));
}

function solveHinge(hinge, points) {
  const parent = points[hinge.parent];
  const joint = points[hinge.joint];
  const child = points[hinge.child];
  const confidence = round(retargetConfidence(parent, joint, child), 6);
  const base = {
    name: hinge.name,
    group: hinge.group,
    parent: hinge.parent,
    joint: hinge.joint,
    child: hinge.child,
    minFlexDeg: hinge.minFlexDeg,
    maxFlexDeg: hinge.maxFlexDeg,
    angleModel: "unsigned_3point_inner_angle",
    signedFlexionSupported: false,
    confidence,
    violation: false,
    limitWarning: false,
    reason: "ok",
  };

  if (!parent || !joint || !child) {
    return {
      ...base,
      flexDeg: null,
      innerAngleDeg: null,
      confidence: 0,
      reason: "missing",
    };
  }

  const parentVector = subtract(parent, joint);
  const childVector = subtract(child, joint);
  const parentLength = magnitude(parentVector);
  const childLength = magnitude(childVector);

  if (parentLength < MIN_DIRECTION_LENGTH || childLength < MIN_DIRECTION_LENGTH) {
    return {
      ...base,
      flexDeg: null,
      innerAngleDeg: null,
      reason: "degenerate",
    };
  }

  const dot = parentVector.x * childVector.x +
    parentVector.y * childVector.y +
    parentVector.z * childVector.z;
  const innerAngleDeg = radToDeg(Math.acos(clamp(dot / (parentLength * childLength), -1, 1)));
  const flexDeg = 180 - innerAngleDeg;
  const reliable = confidence >= HINGE_RELIABLE_CONFIDENCE;
  const violation = reliable && flexDeg < hinge.minFlexDeg - HINGE_LIMIT_EPSILON_DEG;
  const limitWarning = reliable && !violation && flexDeg > hinge.maxFlexDeg + HINGE_LIMIT_EPSILON_DEG;

  return {
    ...base,
    flexDeg: round(flexDeg, 3),
    innerAngleDeg: round(innerAngleDeg, 3),
    violation,
    limitWarning,
    reason: reliable ? (violation ? "hinge_min_limit" : limitWarning ? "limit_warning" : "ok") : "low_confidence",
  };
}

function estimateTrackingMode(points) {
  const shoulderConfidence = averageVisibility(points.leftShoulder, points.rightShoulder);
  const hipConfidence = averageVisibility(points.leftHip, points.rightHip);

  if (shoulderConfidence < LOW_CONFIDENCE_VISIBILITY) {
    return "lost";
  }

  if (hipConfidence < LOW_CONFIDENCE_VISIBILITY) {
    return "upper-body";
  }

  return "full-body";
}

function estimateFacing(points, fallback = "front") {
  return toLegacyFacing(estimateFacingState(points, fallback, {
    lowConfidence: LOW_CONFIDENCE_VISIBILITY,
  }).state);
}

function retargetConfidence(...points) {
  const visibilities = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  if (visibilities.length === 0) {
    return 1;
  }

  const visibility = Math.min(...visibilities);

  if (visibility >= FULL_CONFIDENCE_VISIBILITY) {
    return 1;
  }

  return Math.max(0, Math.min(
    1,
    (visibility - LOW_CONFIDENCE_VISIBILITY) /
      (FULL_CONFIDENCE_VISIBILITY - LOW_CONFIDENCE_VISIBILITY),
  ));
}

function pointFromLandmark(landmark) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: Number.isFinite(landmark.visibility) ? landmark.visibility : 1,
  };
}

function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function averageVisibility(...points) {
  const values = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length < MIN_DIRECTION_LENGTH) {
    return null;
  }

  return {
    x: round(vector.x / length, 6),
    y: round(vector.y / length, 6),
    z: round(vector.z / length, 6),
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function radToDeg(rad) {
  return (rad / Math.PI) * 180;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
