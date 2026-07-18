#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  computePlaneNormal,
  resolveAvatarYawDeg,
  resolveHandOrientationBasis,
  resolveHandPalmNormal,
  resolvePoseHandOrientationBasis,
} from "../src/retarget-orientation.js";
import {
  createCausalQuaternionTargetState,
  resetCausalQuaternionTargetState,
  transportCausalQuaternionTargetState,
  transportCausalQuaternionTargetStateByDelta,
  updateCausalQuaternionTarget,
} from "../src/retarget/causal-quaternion-target.js";
import {
  POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC,
  POSE_HAND_MIN_INNOVATION_CONFIDENCE,
  evaluatePoseHandInnovation,
} from "../src/retarget/pose-hand-innovation-gate.js";
import {
  HAND_FINGERS,
  estimateFingerCurlStrength,
  estimateHandPalmCenter,
  getFingerSegmentCount,
  resolveFingerSegmentPoints,
} from "../src/hand-retargeting.js";

const wrist = { x: 0, y: 0, z: 0 };
const indexBase = { x: 1, y: 0, z: 0 };
const pinkyBase = { x: 0, y: 1, z: 0 };

const rawNormal = computePlaneNormal(wrist, indexBase, pinkyBase);
assert.deepEqual(roundVector(rawNormal), { x: 0, y: 0, z: 1 });

const leftPalm = resolveHandPalmNormal({ wrist, indexBase, pinkyBase, side: "Left" });
assert.equal(leftPalm.valid, true);
assert.equal(leftPalm.sign, 1);
assert.deepEqual(roundVector(leftPalm.rawNormal), { x: 0, y: 0, z: 1 });
assert.deepEqual(roundVector(leftPalm.normal), { x: 0, y: 0, z: 1 });

const rightPalm = resolveHandPalmNormal({ wrist, indexBase, pinkyBase, side: "Right" });
assert.equal(rightPalm.valid, true);
assert.equal(rightPalm.sign, -1);
assert.deepEqual(roundVector(rightPalm.normal), { x: 0, y: 0, z: -1 });

const customPalm = resolveHandPalmNormal({
  wrist,
  indexBase,
  pinkyBase,
  side: "Left",
  normalSigns: { Left: -1 },
});
assert.equal(customPalm.sign, -1);
assert.deepEqual(roundVector(customPalm.normal), { x: 0, y: 0, z: -1 });

const leftPalmFacingCamera = resolveHandPalmNormal({
  wrist,
  indexBase: { x: -0.2, y: 1, z: 0 },
  pinkyBase: { x: 0.2, y: 1, z: 0 },
  side: "Left",
});
const rightPalmFacingCamera = resolveHandPalmNormal({
  wrist,
  indexBase: { x: 0.2, y: 1, z: 0 },
  pinkyBase: { x: -0.2, y: 1, z: 0 },
  side: "Right",
});
assert.deepEqual(roundVector(leftPalmFacingCamera.rawNormal), { x: 0, y: 0, z: -1 });
assert.deepEqual(roundVector(rightPalmFacingCamera.rawNormal), { x: 0, y: 0, z: 1 });
assert.deepEqual(roundVector(leftPalmFacingCamera.normal), { x: 0, y: 0, z: -1 });
assert.deepEqual(roundVector(rightPalmFacingCamera.normal), { x: 0, y: 0, z: -1 });

assert.equal(resolveHandPalmNormal({ wrist, side: "Left" }).valid, false);
assert.equal(resolveAvatarYawDeg(90), -90);
assert.equal(resolveAvatarYawDeg(-90), 90);
assert.equal(resolveAvatarYawDeg(180), -180);
assert.equal(resolveAvatarYawDeg(270), 90);
assert.equal(resolveAvatarYawDeg(90, 1), 90);
assert.equal(resolveAvatarYawDeg(Number.NaN), null);

const imageBasisPoints = buildHandPoints();
const worldBasisPoints = buildHandPoints();
worldBasisPoints[9] = { x: 1, y: 0, z: 0 };
worldBasisPoints[5] = { x: 1, y: 0, z: 0 };
worldBasisPoints[17] = { x: 0, y: 1, z: 0 };
const worldBasis = resolveHandOrientationBasis({
  imagePoints: imageBasisPoints,
  worldPoints: worldBasisPoints,
  side: "Left",
});
assert.equal(worldBasis.valid, true);
assert.equal(worldBasis.source, "world-basis");
assert.deepEqual(roundVector(worldBasis.primary), { x: 1, y: 0, z: 0 });
assert.deepEqual(roundVector(worldBasis.normal), { x: 0, y: 0, z: 1 });

const reflectedWorldBasisPoints = worldBasisPoints.map((point) => (
  point ? { ...point, x: -point.x } : point
));
const reflectedWorldBasis = resolveHandOrientationBasis({
  imagePoints: reflectedWorldBasisPoints,
  worldPoints: reflectedWorldBasisPoints,
  side: "Left",
  reflectionParity: -1,
});
assert.equal(reflectedWorldBasis.valid, true);
assert.deepEqual(roundVector(reflectedWorldBasis.primary), { x: -1, y: 0, z: 0 });
assert.deepEqual(
  roundVector(reflectedWorldBasis.normal),
  { x: 0, y: 0, z: 1 },
  "reflected detector coordinates must preserve the anatomical palm-normal parity",
);

const incompleteWorldPoints = worldBasisPoints.slice();
incompleteWorldPoints[9] = null;
const imageFallbackBasis = resolveHandOrientationBasis({
  imagePoints: imageBasisPoints,
  worldPoints: incompleteWorldPoints,
  side: "Left",
});
assert.equal(imageFallbackBasis.valid, true);
assert.equal(imageFallbackBasis.source, "image-basis");
assert.deepEqual(roundVector(imageFallbackBasis.primary), { x: 0, y: 1, z: 0 });

const degenerateWorldPoints = worldBasisPoints.slice();
degenerateWorldPoints[5] = { x: 1, y: 0, z: 0 };
degenerateWorldPoints[17] = { x: 2, y: 0, z: 0 };
const degenerateWorldFallback = resolveHandOrientationBasis({
  imagePoints: imageBasisPoints,
  worldPoints: degenerateWorldPoints,
  side: "Left",
});
assert.equal(degenerateWorldFallback.valid, true);
assert.equal(degenerateWorldFallback.source, "image-basis");

const invalidImagePrimaryPoints = imageBasisPoints.slice();
invalidImagePrimaryPoints[9] = null;
const noBasis = resolveHandOrientationBasis({
  imagePoints: invalidImagePrimaryPoints,
  worldPoints: null,
  side: "Left",
});
assert.equal(noBasis.valid, false);
assert.equal(noBasis.source, "none");
assert.equal(noBasis.normal, null);
assert.equal(noBasis.rawNormal, null);

const posePalm = resolvePoseHandOrientationBasis({
  wrist: { x: 0, y: 0, z: 0 },
  indexBase: { x: -0.2, y: 1, z: 0 },
  pinkyBase: { x: 0.2, y: 1, z: 0 },
  side: "Left",
});
assert.equal(posePalm.valid, true);
assert.equal(posePalm.source, "pose-world-basis");
assert.deepEqual(roundVector(posePalm.primary), { x: 0, y: 1, z: 0 });
assert.deepEqual(roundVector(posePalm.normal), { x: 0, y: 0, z: -1 });

const mirroredPosePalm = resolvePoseHandOrientationBasis({
  wrist: { x: 0, y: 0, z: 0 },
  indexBase: { x: 0.2, y: 1, z: 0 },
  pinkyBase: { x: -0.2, y: 1, z: 0 },
  side: "Left",
  reflectionParity: -1,
});
assert.equal(mirroredPosePalm.valid, true);
assert.deepEqual(roundVector(mirroredPosePalm.primary), { x: 0, y: 1, z: 0 });
assert.deepEqual(roundVector(mirroredPosePalm.normal), { x: 0, y: 0, z: -1 });

const degeneratePosePalm = resolvePoseHandOrientationBasis({
  wrist: { x: 0, y: 0, z: 0 },
  indexBase: { x: 0, y: 1, z: 0 },
  pinkyBase: { x: 0, y: 2, z: 0 },
  side: "Left",
});
assert.equal(degeneratePosePalm.valid, false);
assert.equal(degeneratePosePalm.source, "none");



assert.equal(POSE_HAND_MIN_INNOVATION_CONFIDENCE, 0.5);
assert.equal(POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC, 420);
const lowConfidenceFastInnovation = evaluatePoseHandInnovation({
  previousRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 30),
  previousTimestampMs: 0,
  timestampMs: 1000 / 30,
  confidence: 0.49,
});
assert.equal(lowConfidenceFastInnovation.hold, true);
assert.equal(lowConfidenceFastInnovation.reason, "low-confidence-rate");
assert.ok(Math.abs(lowConfidenceFastInnovation.innovationDeg - 30) <= 0.000001);
assert.ok(
  Math.abs(lowConfidenceFastInnovation.innovationRateDegPerSec - 900) <= 0.000001,
);

const thresholdConfidenceInnovation = evaluatePoseHandInnovation({
  previousRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 30),
  previousTimestampMs: 0,
  timestampMs: 1000 / 30,
  confidence: 0.5,
});
assert.equal(thresholdConfidenceInnovation.hold, false);

const lowConfidenceBoundedInnovation = evaluatePoseHandInnovation({
  previousRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 16),
  previousTimestampMs: 0,
  timestampMs: 40,
  confidence: 0.2,
});
assert.equal(lowConfidenceBoundedInnovation.hold, false);
assert.ok(
  lowConfidenceBoundedInnovation.innovationRateDegPerSec <
    POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC,
);

const lowConfidenceUnsupportedByArmChain = evaluatePoseHandInnovation({
  previousRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 20),
  previousTimestampMs: 0,
  timestampMs: 40,
  confidence: 0.2,
});
assert.equal(lowConfidenceUnsupportedByArmChain.hold, true);

const unavailableInnovation = evaluatePoseHandInnovation({
  previousRotation: null,
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  previousTimestampMs: 0,
  timestampMs: 16,
  confidence: 0.1,
});
assert.equal(unavailableInnovation.hold, false);
assert.equal(unavailableInnovation.reason, "rotation-unavailable");

const repeatedSourceInnovation = evaluatePoseHandInnovation({
  previousRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  candidateRotation: axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  previousTimestampMs: 16,
  timestampMs: 16,
  confidence: 0.1,
});
assert.equal(repeatedSourceInnovation.hold, false);
assert.equal(repeatedSourceInnovation.reason, "source-delta-unavailable");

const causalHandState = createCausalQuaternionTargetState();
const initialHandTarget = updateCausalQuaternionTarget(
  causalHandState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  0,
);
assert.equal(initialHandTarget.status, "initialized");
assert.equal(initialHandTarget.apply, true);

const firstJump = updateCausalQuaternionTarget(
  causalHandState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  16,
);
const secondJump = updateCausalQuaternionTarget(
  causalHandState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  32,
);
const continuedJump = updateCausalQuaternionTarget(
  causalHandState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  48,
);
assert.equal(firstJump.status, "jump-hold");
assert.equal(firstJump.pendingCount, 1);
assert.equal(secondJump.status, "jump-confirmed-rate-limited");
assert.equal(secondJump.pendingCount, 0);
assert.ok(secondJump.appliedDeltaDeg > 17 && secondJump.appliedDeltaDeg < 18);
assert.equal(continuedJump.status, "tracked-rate-limited");
assert.equal(continuedJump.pendingCount, 0);
assert.ok(continuedJump.appliedDeltaDeg > 17 && continuedJump.appliedDeltaDeg < 18);

const missingHandTarget = updateCausalQuaternionTarget(causalHandState, null, 100);
const expiredHandTarget = updateCausalQuaternionTarget(causalHandState, null, 300);
assert.equal(missingHandTarget.status, "missing-hold");
assert.equal(missingHandTarget.apply, true);
assert.equal(expiredHandTarget.status, "missing");
assert.equal(expiredHandTarget.apply, false);

const lastObservedAt = causalHandState.lastObservationAt;
assert.equal(
  transportCausalQuaternionTargetState(
    causalHandState,
    axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 45),
    320,
  ),
  true,
);
assert.equal(causalHandState.lastObservationAt, lastObservedAt);
assert.deepEqual(
  roundQuaternion(causalHandState.acceptedTargetRotation),
  roundQuaternion(axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 45)),
);

resetCausalQuaternionTargetState(causalHandState);
assert.equal(causalHandState.lastRotation, null);
assert.equal(causalHandState.acceptedTargetRotation, null);
assert.equal(causalHandState.pendingCount, 0);

const transportedJumpState = createCausalQuaternionTargetState();
updateCausalQuaternionTarget(
  transportedJumpState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  0,
);
const transportedJumpHold = updateCausalQuaternionTarget(
  transportedJumpState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  16,
);
assert.equal(transportedJumpHold.status, "jump-hold");
assert.equal(
  transportCausalQuaternionTargetState(
    transportedJumpState,
    axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
    16,
    { preservePending: true },
  ),
  true,
);
assert.equal(transportedJumpState.pendingCount, 1);
assert.ok(transportedJumpState.pendingRotation);
const transportedJumpConfirmed = updateCausalQuaternionTarget(
  transportedJumpState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
  32,
);
assert.equal(transportedJumpConfirmed.status, "jump-confirmed-rate-limited");

const parentTransportedJumpState = createCausalQuaternionTargetState();
updateCausalQuaternionTarget(
  parentTransportedJumpState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 0),
  0,
);
assert.equal(
  updateCausalQuaternionTarget(
    parentTransportedJumpState,
    axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 120),
    16,
  ).status,
  "jump-hold",
);
assert.equal(
  transportCausalQuaternionTargetStateByDelta(
    parentTransportedJumpState,
    axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 30),
  ),
  true,
);
assert.deepEqual(
  roundQuaternion(parentTransportedJumpState.acceptedTargetRotation),
  roundQuaternion(axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 30)),
);
assert.deepEqual(
  roundQuaternion(parentTransportedJumpState.pendingRotation),
  roundQuaternion(axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 150)),
);
const parentTransportedJumpConfirmed = updateCausalQuaternionTarget(
  parentTransportedJumpState,
  axisAngleQuaternion({ x: 0, y: 0, z: 1 }, 150),
  32,
);
assert.equal(parentTransportedJumpConfirmed.status, "jump-confirmed-rate-limited");

const handPoints = Array.from({ length: 21 }, (_, index) => ({ index }));
assert.deepEqual([...HAND_FINGERS.Thumb], [1, 2, 3, 4]);

const thumbBaseSegment = resolveFingerSegmentPoints(handPoints, "Thumb", 0);
assert.equal(thumbBaseSegment.fromIndex, 1);
assert.equal(thumbBaseSegment.toIndex, 2);
assert.equal(thumbBaseSegment.jointKind, "thumb-cmc");

const thumbMiddleSegment = resolveFingerSegmentPoints(handPoints, "Thumb", 1);
assert.equal(thumbMiddleSegment.fromIndex, 2);
assert.equal(thumbMiddleSegment.toIndex, 3);
assert.equal(thumbMiddleSegment.jointKind, "thumb-mcp");

const thumbTipSegment = resolveFingerSegmentPoints(handPoints, "Thumb", 2);
assert.equal(thumbTipSegment.fromIndex, 3);
assert.equal(thumbTipSegment.toIndex, 4);
assert.equal(thumbTipSegment.jointKind, "thumb-ip");
assert.equal(resolveFingerSegmentPoints(handPoints, "Thumb", 3), null);
assert.equal(getFingerSegmentCount("Thumb"), 3);

const indexBaseSegment = resolveFingerSegmentPoints(handPoints, "Index", 0);
assert.equal(indexBaseSegment.fromIndex, 5);
assert.equal(indexBaseSegment.toIndex, 6);
assert.equal(indexBaseSegment.jointKind, "mcp");

const indexDipSegment = resolveFingerSegmentPoints(handPoints, "Index", 2);
assert.equal(indexDipSegment.fromIndex, 7);
assert.equal(indexDipSegment.toIndex, 8);
assert.equal(indexDipSegment.jointKind, "dip");
assert.equal(resolveFingerSegmentPoints(handPoints, "Index", 3), null);
assert.equal(getFingerSegmentCount("Index"), 3);

const openHandPoints = buildHandPoints({
  Index: [
    { x: 0.2, y: 1, z: 0 },
    { x: 0.2, y: 1.55, z: 0 },
    { x: 0.2, y: 2.05, z: 0 },
    { x: 0.2, y: 2.55, z: 0 },
  ],
});
const curledHandPoints = buildHandPoints({
  Index: [
    { x: 0.2, y: 1, z: 0 },
    { x: 0.42, y: 0.62, z: 0 },
    { x: 0.08, y: 0.38, z: 0 },
    { x: -0.08, y: 0.72, z: 0 },
  ],
});
const palmCenter = estimateHandPalmCenter(openHandPoints);

assert.deepEqual(roundVector(palmCenter), { x: -0.08, y: 0.76, z: 0 });
assert.equal(estimateFingerCurlStrength(openHandPoints, "Index"), 0);
assert.ok(estimateFingerCurlStrength(curledHandPoints, "Index") > 0.85);
assert.equal(estimateFingerCurlStrength([], "Index"), 0);

console.log("Retarget orientation check passed.");

function buildHandPoints(overrides = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const base = {
    0: { x: 0, y: 0, z: 0 },
    5: { x: 0.2, y: 1, z: 0 },
    9: { x: 0, y: 1.1, z: 0 },
    13: { x: -0.2, y: 1, z: 0 },
    17: { x: -0.4, y: 0.7, z: 0 },
  };

  for (const [index, point] of Object.entries(base)) {
    points[Number(index)] = point;
  }

  for (const [fingerName, fingerPoints] of Object.entries(overrides)) {
    const indices = HAND_FINGERS[fingerName];

    fingerPoints.forEach((point, index) => {
      points[indices[index]] = point;
    });
  }

  return points;
}


function roundVector(vector) {
  return {
    x: round(vector.x),
    y: round(vector.y),
    z: round(vector.z),
  };
}

function round(value) {
  const rounded = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function axisAngleQuaternion(axis, angleDeg) {
  const half = angleDeg * Math.PI / 360;
  const sine = Math.sin(half);
  return {
    x: axis.x * sine,
    y: axis.y * sine,
    z: axis.z * sine,
    w: Math.cos(half),
  };
}

function roundQuaternion(quaternion) {
  return {
    x: round(quaternion.x),
    y: round(quaternion.y),
    z: round(quaternion.z),
    w: round(quaternion.w),
  };
}
