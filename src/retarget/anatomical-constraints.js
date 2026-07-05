const EPSILON = 0.000001;
const LOWER_BODY_MIN_VISIBILITY = 0.5;
const LOWER_BODY_AVERAGE_VISIBILITY = 0.72;

export const ANATOMICAL_CONSTRAINTS = deepFreeze({
  Hips: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 35, maxTwistDeg: 30 }),
  Spine: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 28, maxTwistDeg: 24 }),
  Spine1: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 24, maxTwistDeg: 22 }),
  Spine2: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 24, maxTwistDeg: 22 }),
  Neck: Object.freeze({ kind: "head-neck", group: "head", pitch: [-35, 40], yaw: [-50, 50], roll: [-30, 30] }),
  Head: Object.freeze({ kind: "head-neck", group: "head", pitch: [-50, 60], yaw: [-75, 75], roll: [-45, 45] }),
  LeftShoulder: Object.freeze({ kind: "shoulder-girdle", group: "shoulder", maxSwingDeg: 32, maxTwistDeg: 25 }),
  RightShoulder: Object.freeze({ kind: "shoulder-girdle", group: "shoulder", maxSwingDeg: 32, maxTwistDeg: 25 }),
  LeftArm: Object.freeze({
    kind: "swing-cone",
    group: "arms",
    side: "left",
    maxRestSwingDeg: 155,
    maxTwistDeg: 80,
    crossBodyLimit: -0.92,
  }),
  RightArm: Object.freeze({
    kind: "swing-cone",
    group: "arms",
    side: "right",
    maxRestSwingDeg: 155,
    maxTwistDeg: 80,
    crossBodyLimit: 0.92,
  }),
  LeftForeArm: Object.freeze({
    kind: "hinge",
    group: "arms",
    joint: "leftElbow",
    minFlexDeg: -5,
    softMaxFlexDeg: 145,
    maxFlexDeg: 155,
    lateralToleranceDeg: 18,
    maxTwistDeg: 70,
  }),
  RightForeArm: Object.freeze({
    kind: "hinge",
    group: "arms",
    joint: "rightElbow",
    minFlexDeg: -5,
    softMaxFlexDeg: 145,
    maxFlexDeg: 155,
    lateralToleranceDeg: 18,
    maxTwistDeg: 70,
  }),
  LeftHand: Object.freeze({ kind: "wrist", group: "hands", side: "left", maxSwingDeg: 95, maxTwistDeg: 80 }),
  RightHand: Object.freeze({ kind: "wrist", group: "hands", side: "right", maxSwingDeg: 95, maxTwistDeg: 80 }),
  LeftUpLeg: Object.freeze({
    kind: "swing-cone",
    group: "legs",
    side: "left",
    maxRestSwingDeg: 135,
    maxTwistDeg: 45,
    adductionLimit: -0.82,
  }),
  RightUpLeg: Object.freeze({
    kind: "swing-cone",
    group: "legs",
    side: "right",
    maxRestSwingDeg: 135,
    maxTwistDeg: 45,
    adductionLimit: 0.82,
  }),
  LeftLeg: Object.freeze({
    kind: "hinge",
    group: "legs",
    joint: "leftKnee",
    minFlexDeg: -5,
    softMaxFlexDeg: 140,
    maxFlexDeg: 155,
    lateralToleranceDeg: 12,
    maxTwistDeg: 24,
  }),
  RightLeg: Object.freeze({
    kind: "hinge",
    group: "legs",
    joint: "rightKnee",
    minFlexDeg: -5,
    softMaxFlexDeg: 140,
    maxFlexDeg: 155,
    lateralToleranceDeg: 12,
    maxTwistDeg: 24,
  }),
  LeftFoot: Object.freeze({
    kind: "ankle",
    group: "feet",
    side: "left",
    dorsiflexDeg: 22,
    plantarFlexDeg: 62,
    inversionDeg: 35,
    eversionDeg: 25,
    maxTwistDeg: 40,
  }),
  RightFoot: Object.freeze({
    kind: "ankle",
    group: "feet",
    side: "right",
    dorsiflexDeg: 22,
    plantarFlexDeg: 62,
    inversionDeg: 35,
    eversionDeg: 25,
    maxTwistDeg: 40,
  }),
});

export const FINGER_CONSTRAINTS = deepFreeze({
  Thumb: Object.freeze([
    Object.freeze({ kind: "thumb-cmc", flexDeg: [0, 55], abductDeg: [0, 65], oppositionTwistDeg: 60 }),
    Object.freeze({ kind: "thumb-mcp", flexDeg: [-10, 70], softFlexDeg: [0, 60] }),
    Object.freeze({ kind: "thumb-ip", flexDeg: [-10, 95], softFlexDeg: [0, 85] }),
    Object.freeze({ kind: "thumb-tip", flexDeg: [-10, 95], softFlexDeg: [0, 85] }),
  ]),
  default: Object.freeze([
    Object.freeze({ kind: "mcp", flexDeg: [-10, 105], softFlexDeg: [0, 90], abductDeg: [-40, 40] }),
    Object.freeze({ kind: "pip", flexDeg: [-5, 115], softFlexDeg: [0, 105] }),
    Object.freeze({ kind: "dip", flexDeg: [-5, 95], softFlexDeg: [0, 85] }),
    Object.freeze({ kind: "tip", flexDeg: [-5, 95], softFlexDeg: [0, 85] }),
  ]),
});

export function createAnatomyState() {
  return {
    targets: {},
    lowerBody: {
      reliable: false,
      lastReliableAt: null,
    },
  };
}

export function clampDegrees(value, min, max) {
  if (!isFiniteNumber(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function constrainFlexionDeg({ flexDeg, minFlexDeg, softMaxFlexDeg, maxFlexDeg }) {
  if (!isFiniteNumber(flexDeg)) {
    return invalidFlexionResult();
  }

  const clampedFlexDeg = clampDegrees(flexDeg, minFlexDeg, maxFlexDeg);
  const hardViolation = clampedFlexDeg !== flexDeg;
  const softViolation = flexDeg > softMaxFlexDeg || flexDeg < minFlexDeg;
  const overflowDeg = Math.max(0, flexDeg - softMaxFlexDeg, minFlexDeg - flexDeg);

  return {
    flexDeg: round(flexDeg),
    clampedFlexDeg: round(clampedFlexDeg),
    hardViolation,
    softViolation,
    overflowDeg: round(overflowDeg),
    confidenceScale: hardViolation ? 0.35 : softViolation ? 0.7 : 1,
  };
}

export function constrainHingeChildDirection({ parent, joint, child, clampedFlexDeg }) {
  if (!parent || !joint || !child || !isFiniteNumber(clampedFlexDeg)) {
    return null;
  }
  if (!hasValidCoordinates(parent) || !hasValidCoordinates(joint) || !hasValidCoordinates(child)) {
    return null;
  }

  const parentDirection = normalize(subtract(parent, joint));
  const childDirection = normalize(subtract(child, joint));
  if (!parentDirection || !childDirection) {
    return null;
  }

  const rawAxis = normalize(cross(parentDirection, childDirection)) ?? choosePerpendicularAxis(parentDirection);
  const innerAngleRad = degToRad(180 - clampDegrees(clampedFlexDeg, -5, 175));
  const candidateA = normalize(rotateAroundAxis(parentDirection, rawAxis, innerAngleRad));
  const candidateB = normalize(rotateAroundAxis(parentDirection, rawAxis, -innerAngleRad));

  if (!candidateA) {
    return childDirection;
  }
  if (!candidateB) {
    return candidateA;
  }

  return dot(candidateA, childDirection) >= dot(candidateB, childDirection)
    ? candidateA
    : candidateB;
}

export function evaluateHingeFlexion({ name, parent, joint, child, minFlexDeg, softMaxFlexDeg, maxFlexDeg }) {
  if (!parent || !joint || !child) {
    return invalidHingeResult(name, "missing");
  }
  if (!hasRequiredCoordinates(parent) || !hasRequiredCoordinates(joint) || !hasRequiredCoordinates(child)) {
    return invalidHingeResult(name, "missing");
  }
  if (!hasFiniteCoordinates(parent) || !hasFiniteCoordinates(joint) || !hasFiniteCoordinates(child)) {
    return invalidHingeResult(name, "degenerate");
  }

  const parentVector = subtract(parent, joint);
  const childVector = subtract(child, joint);
  const parentLength = magnitude(parentVector);
  const childLength = magnitude(childVector);

  if (parentLength < EPSILON || childLength < EPSILON) {
    return invalidHingeResult(name, "degenerate");
  }

  const innerAngleDeg = radToDeg(Math.acos(clamp(dot(parentVector, childVector) / (parentLength * childLength), -1, 1)));
  const flexDeg = 180 - innerAngleDeg;

  return {
    name,
    innerAngleDeg: round(innerAngleDeg),
    ...constrainFlexionDeg({ flexDeg, minFlexDeg, softMaxFlexDeg, maxFlexDeg }),
    reason: "ok",
  };
}

export function evaluateTargetCone({ bone, directionTorsoLocal, constraint }) {
  if (!directionTorsoLocal || !constraint) {
    return { bone, violation: false, reason: "missing" };
  }

  const direction = normalize(directionTorsoLocal);
  if (!direction) {
    return { bone, violation: false, reason: "degenerate", confidenceScale: 1 };
  }

  if (exceedsSideLimit(direction.x, constraint.crossBodyLimit, constraint.side)) {
    return { bone, violation: true, reason: "cross_body_limit", confidenceScale: 0.55 };
  }
  if (exceedsSideLimit(direction.x, constraint.adductionLimit, constraint.side)) {
    return { bone, violation: true, reason: "adduction_limit", confidenceScale: 0.55 };
  }

  return { bone, violation: false, reason: "ok", confidenceScale: 1 };
}

export function evaluateLowerBodyReliability({ points, previous = createAnatomyState(), timestamp = 0 } = {}) {
  const names = ["leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];
  const visibilities = names.map((name) => visibility(points?.[name])).filter(Number.isFinite);
  const average = visibilities.reduce((sum, value) => sum + value, 0) / Math.max(1, visibilities.length);
  const minimum = visibilities.length > 0 ? Math.min(...visibilities) : 0;
  const hasAllLandmarks = visibilities.length === names.length;
  const reliable = hasAllLandmarks &&
    average >= LOWER_BODY_AVERAGE_VISIBILITY &&
    minimum >= LOWER_BODY_MIN_VISIBILITY;

  return {
    reliable,
    confidence: round(average),
    minVisibility: round(minimum),
    reason: lowerBodyReliabilityReason({ reliable, hasAllLandmarks, average, minimum }),
    lastReliableAt: reliable ? timestamp : previous?.lowerBody?.lastReliableAt ?? null,
  };
}

export function constrainPoseTargets({ targets = [], anatomy = {} } = {}) {
  return targets.map((target) => {
    const diagnostic = anatomy.targets?.[target.bone];
    const confidenceScale = Number.isFinite(Number(diagnostic?.confidenceScale)) ? Number(diagnostic.confidenceScale) : 1;

    return {
      ...target,
      constrainedDirection: diagnostic?.constrainedDirection ?? target.constrainedDirection ?? target.direction,
      rawDirection: target.rawDirection ?? target.direction,
      confidence: round(Number(target.confidence ?? 1) * confidenceScale),
      anatomy: diagnostic ?? null,
    };
  });
}

function exceedsSideLimit(x, limit, side) {
  const number = Number(limit);
  if (!Number.isFinite(number)) {
    return false;
  }
  if (side === "left") {
    return Number(x) < number;
  }
  if (side === "right") {
    return Number(x) > number;
  }
  return false;
}

function invalidHingeResult(name, reason) {
  return {
    name,
    flexDeg: null,
    clampedFlexDeg: null,
    hardViolation: false,
    softViolation: false,
    overflowDeg: 0,
    confidenceScale: 1,
    reason,
  };
}

function invalidFlexionResult() {
  return {
    flexDeg: null,
    clampedFlexDeg: null,
    hardViolation: false,
    softViolation: false,
    overflowDeg: 0,
    confidenceScale: 0,
    reason: "invalid_flexion",
  };
}

function lowerBodyReliabilityReason({ reliable, hasAllLandmarks, average, minimum }) {
  if (reliable) {
    return "ok";
  }
  if (!hasAllLandmarks) {
    return "missing_landmark";
  }
  if (minimum < LOWER_BODY_MIN_VISIBILITY) {
    return "low_landmark_visibility";
  }
  if (average < LOWER_BODY_AVERAGE_VISIBILITY) {
    return "low_average_visibility";
  }
  return "low_visibility";
}

function hasRequiredCoordinates(point) {
  return point?.x !== undefined && point?.y !== undefined && point?.z !== undefined;
}

function hasFiniteCoordinates(point) {
  return isFiniteNumber(point.x) && isFiniteNumber(point.y) && isFiniteNumber(point.z);
}

function hasValidCoordinates(point) {
  return hasRequiredCoordinates(point) && hasFiniteCoordinates(point);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function visibility(point) {
  return Number(point?.visibility ?? point?.presence);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  if (!Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(vector) {
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length < EPSILON) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function choosePerpendicularAxis(direction) {
  const basis = Math.abs(direction.y) < 0.8
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  return normalize(cross(direction, basis));
}

function rotateAroundAxis(vector, axis, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const axisDot = dot(axis, vector);

  return {
    x: vector.x * cos + (axis.y * vector.z - axis.z * vector.y) * sin + axis.x * axisDot * (1 - cos),
    y: vector.y * cos + (axis.z * vector.x - axis.x * vector.z) * sin + axis.y * axisDot * (1 - cos),
    z: vector.z * cos + (axis.x * vector.y - axis.y * vector.x) * sin + axis.z * axisDot * (1 - cos),
  };
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function radToDeg(value) {
  return value * 180 / Math.PI;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  const rounded = Math.round(number * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
