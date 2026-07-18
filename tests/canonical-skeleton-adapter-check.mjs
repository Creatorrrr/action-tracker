import assert from "node:assert/strict";

import {
  CANONICAL_HINGE_DISTAL_SHARE,
  CANONICAL_HINGE_JOINT_SHARE,
  CANONICAL_SKELETON_ADAPTER_VERSION,
  MEDIAPIPE_ELBOW_FLEX_BIAS_DEG,
  MEDIAPIPE_ELBOW_BIAS_FADE_END_DEG,
  MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG,
  MEDIAPIPE_KNEE_FLEX_BIAS_DEG,
  adaptCanonicalSkeletonFrame,
} from "../src/canonical-skeleton-adapter.js";
import { evaluateHingeFlexion } from "../src/retarget/anatomical-constraints.js";

const landmarks = Array.from({ length: 33 }, () => ({
  x: 0,
  y: 0,
  z: 0,
  visibility: 1,
}));
landmarks[11] = { x: -1, y: 0, z: 0, visibility: 1 };
landmarks[13] = { x: 0, y: 0.15, z: 0, visibility: 1 };
landmarks[15] = { x: 1, y: 0, z: 0, visibility: 1 };
landmarks[17] = { x: 1.1, y: 0.1, z: 0, visibility: 1 };
landmarks[19] = { x: 1.2, y: 0.2, z: 0, visibility: 1 };
landmarks[21] = { x: 1.3, y: 0.3, z: 0, visibility: 1 };
const imageLandmarks = landmarks.map((landmark) => ({
  x: 0.5 + landmark.x * 0.1,
  y: 0.5 + landmark.y * 0.1,
  z: landmark.z * 0.2,
  visibility: landmark.visibility,
}));

const sourceFrame = {
  timestamp: 123,
  poseLandmarks: imageLandmarks,
  poseWorldLandmarks: landmarks,
  sourceMeta: {
    sourcePtsSec: 1.25,
  },
};
const originalWrist = { ...sourceFrame.poseWorldLandmarks[15] };
const originalElbow = { ...sourceFrame.poseWorldLandmarks[13] };
const originalImageWrist = { ...sourceFrame.poseLandmarks[15] };
const originalImageElbow = { ...sourceFrame.poseLandmarks[13] };
const originalIndexOffset = subtract(
  sourceFrame.poseWorldLandmarks[19],
  sourceFrame.poseWorldLandmarks[15],
);
const rawFlexion = hingeFlexion(sourceFrame.poseWorldLandmarks, 11, 13, 15, 155);
const adapted = adaptCanonicalSkeletonFrame(sourceFrame);
const flexion = hingeFlexion(adapted.poseWorldLandmarks, 11, 13, 15, 155);

assert.notEqual(adapted, sourceFrame);
assert.notEqual(adapted.poseWorldLandmarks, sourceFrame.poseWorldLandmarks);
assert.deepEqual(sourceFrame.poseWorldLandmarks[15], originalWrist);
assert.deepEqual(sourceFrame.poseWorldLandmarks[13], originalElbow);
assert.deepEqual(sourceFrame.poseLandmarks[15], originalImageWrist);
assert.deepEqual(sourceFrame.poseLandmarks[13], originalImageElbow);
assert.ok(
  Math.abs(flexion.flexDeg - (rawFlexion.flexDeg + MEDIAPIPE_ELBOW_FLEX_BIAS_DEG)) < 0.001,
);
assert.ok(
  distance(adapted.poseWorldLandmarks[13], originalElbow) >
    distance(adapted.poseWorldLandmarks[15], originalWrist),
);
assert.deepEqual(
  roundedVector(subtract(adapted.poseWorldLandmarks[19], adapted.poseWorldLandmarks[15])),
  roundedVector(originalIndexOffset),
);
assert.notDeepEqual(adapted.poseLandmarks[13], originalImageElbow);
assert.deepEqual(adapted.poseLandmarks[15], originalImageWrist);
assert.deepEqual(adapted.poseLandmarks[23], sourceFrame.poseLandmarks[23]);
assert.deepEqual(adapted.poseLandmarks[24], sourceFrame.poseLandmarks[24]);
const worldToScreenScale = adapted.sourceMeta.canonicalWorldToScreenScale;
assert.ok(worldToScreenScale > 0);
assert.ok(Math.abs(
  (adapted.poseLandmarks[13].x - originalImageElbow.x) * 2 -
  (adapted.poseWorldLandmarks[13].x - originalElbow.x) * worldToScreenScale
) < 1e-9);
assert.ok(Math.abs(
  (adapted.poseLandmarks[13].y - originalImageElbow.y) * 2 -
  (adapted.poseWorldLandmarks[13].y - originalElbow.y) * worldToScreenScale
) < 1e-9);
assert.equal(adapted.sourceMeta.sourcePtsSec, 1.25);
assert.equal(adapted.sourceMeta.canonicalSkeletonAdapter, CANONICAL_SKELETON_ADAPTER_VERSION);
assert.equal(adapted.sourceMeta.canonicalElbowFlexBiasDeg, MEDIAPIPE_ELBOW_FLEX_BIAS_DEG);
assert.equal(
  adapted.sourceMeta.canonicalElbowBiasFadeStartDeg,
  MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG,
);
assert.equal(
  adapted.sourceMeta.canonicalElbowBiasFadeEndDeg,
  MEDIAPIPE_ELBOW_BIAS_FADE_END_DEG,
);
assert.equal(adapted.sourceMeta.canonicalKneeFlexBiasDeg, MEDIAPIPE_KNEE_FLEX_BIAS_DEG);
assert.equal(adapted.sourceMeta.canonicalHingeJointShare, CANONICAL_HINGE_JOINT_SHARE);
assert.equal(adapted.sourceMeta.canonicalHingeDistalShare, CANONICAL_HINGE_DISTAL_SHARE);
assert.equal(adapted.sourceMeta.canonicalHingeAdjustedCount, 1);
assert.equal(adapted.sourceMeta.canonicalScreenCorrectionCount, 1);
assert.equal(adapted.sourceMeta.canonicalScreenCorrectionScope, "elbow-joint-only");
assert.ok(adapted.sourceMeta.canonicalScreenMaxDelta > 0);

const sameInputMirroredFlag = adaptCanonicalSkeletonFrame({
  ...sourceFrame,
  mirrored: true,
});
assert.deepEqual(sameInputMirroredFlag.poseLandmarks, adapted.poseLandmarks);
assert.deepEqual(sameInputMirroredFlag.poseWorldLandmarks, adapted.poseWorldLandmarks);

const mirroredFrame = {
  ...sourceFrame,
  mirrored: true,
  poseLandmarks: sourceFrame.poseLandmarks.map((landmark) => ({
    ...landmark,
    x: 1 - landmark.x,
  })),
  poseWorldLandmarks: sourceFrame.poseWorldLandmarks.map((landmark) => ({
    ...landmark,
    x: -landmark.x,
  })),
};
const mirrored = adaptCanonicalSkeletonFrame(mirroredFrame);
for (const index of [11, 13, 15, 17, 19, 21]) {
  assert.ok(Math.abs(mirrored.poseWorldLandmarks[index].x + adapted.poseWorldLandmarks[index].x) < 1e-9);
  assert.ok(Math.abs(mirrored.poseWorldLandmarks[index].y - adapted.poseWorldLandmarks[index].y) < 1e-9);
  assert.ok(Math.abs(mirrored.poseWorldLandmarks[index].z - adapted.poseWorldLandmarks[index].z) < 1e-9);
  assert.ok(Math.abs(mirrored.poseLandmarks[index].x + adapted.poseLandmarks[index].x - 1) < 1e-9);
  assert.ok(Math.abs(mirrored.poseLandmarks[index].y - adapted.poseLandmarks[index].y) < 1e-9);
}

const collinearLandmarks = landmarks.map((landmark) => ({ ...landmark }));
collinearLandmarks[13] = { ...collinearLandmarks[13], y: 0 };
const collinearFrame = { timestamp: 789, poseWorldLandmarks: collinearLandmarks };
assert.equal(adaptCanonicalSkeletonFrame(collinearFrame), collinearFrame);

const missingWorldFrame = { timestamp: 456, poseLandmarks: [] };
assert.equal(adaptCanonicalSkeletonFrame(missingWorldFrame), missingWorldFrame);

const raw80 = hingeFrame(80);
const adapted80 = adaptCanonicalSkeletonFrame(raw80);
assert.ok(Math.abs(leftElbowFlexion(adapted80) - 96) < 0.001);

const raw100 = hingeFrame(100);
const adapted100 = adaptCanonicalSkeletonFrame(raw100);
assert.ok(Math.abs(leftElbowFlexion(adapted100) - 108) < 0.001);

const raw120 = hingeFrame(120);
const raw120Snapshot = structuredClone(raw120.poseWorldLandmarks);
const adapted120 = adaptCanonicalSkeletonFrame(raw120);
assert.equal(adapted120, raw120);
assert.deepEqual(raw120.poseWorldLandmarks, raw120Snapshot);

const belowFadeStart = leftElbowFlexion(adaptCanonicalSkeletonFrame(hingeFrame(89.999)));
const aboveFadeStart = leftElbowFlexion(adaptCanonicalSkeletonFrame(hingeFrame(90.001)));
const belowFadeEnd = leftElbowFlexion(adaptCanonicalSkeletonFrame(hingeFrame(109.999)));
const unchangedAtFadeEnd = adaptCanonicalSkeletonFrame(hingeFrame(110));
assert.ok(Math.abs(belowFadeStart - aboveFadeStart) < 0.01);
assert.ok(Math.abs(belowFadeEnd - 110) < 0.01);
assert.equal(unchangedAtFadeEnd.sourceMeta, undefined);

console.log("Canonical skeleton adapter check passed");

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function roundedVector(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, Number(entry.toFixed(9))]),
  );
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function hingeFlexion(landmarkList, parentIndex, jointIndex, childIndex, maxFlexDeg) {
  return evaluateHingeFlexion({
    name: "testHinge",
    parent: landmarkList[parentIndex],
    joint: landmarkList[jointIndex],
    child: landmarkList[childIndex],
    minFlexDeg: 0,
    softMaxFlexDeg: maxFlexDeg,
    maxFlexDeg,
  });
}

function hingeFrame(flexDeg) {
  const hingeLandmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1,
  }));
  const angle = flexDeg * Math.PI / 180;
  hingeLandmarks[11] = { x: -1, y: 0, z: 0, visibility: 1 };
  hingeLandmarks[13] = { x: 0, y: 0, z: 0, visibility: 1 };
  hingeLandmarks[15] = {
    x: Math.cos(angle),
    y: Math.sin(angle),
    z: 0,
    visibility: 1,
  };
  hingeLandmarks[17] = { ...hingeLandmarks[15], x: hingeLandmarks[15].x + 0.1 };
  hingeLandmarks[19] = { ...hingeLandmarks[15], x: hingeLandmarks[15].x + 0.2 };
  hingeLandmarks[21] = { ...hingeLandmarks[15], x: hingeLandmarks[15].x + 0.3 };
  return { poseWorldLandmarks: hingeLandmarks };
}

function leftElbowFlexion(frame) {
  return hingeFlexion(frame.poseWorldLandmarks, 11, 13, 15, 155).flexDeg;
}
