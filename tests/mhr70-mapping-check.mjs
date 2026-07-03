#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  MEDIAPIPE_POSE_LANDMARK_COUNT,
  MHR70_JOINT_COUNT,
  MHR70_JOINT_NAMES,
  MHR70_MAPPING_NOTES,
  MHR70_TO_MEDIAPIPE33,
  auditMhr70AxisFrame,
  buildMhr70WorldVisibilityCaps,
  mapMhr70ToMediaPipe33,
  summarizeMhr70AxisAudit,
} from "../src/skeleton/mhr70-mapping.js";

assert.equal(MHR70_JOINT_NAMES.length, MHR70_JOINT_COUNT);
assert.ok(MHR70_MAPPING_NOTES.wrist.includes("left_wrist"));
assert.equal(MHR70_JOINT_NAMES[3], "left_ear");
assert.equal(MHR70_JOINT_NAMES[4], "right_ear");
assert.equal(MHR70_JOINT_NAMES[41], "right_wrist");
assert.equal(MHR70_JOINT_NAMES[62], "left_wrist");

for (const [mediaPipeIndex, mhrIndex] of Object.entries(MHR70_TO_MEDIAPIPE33)) {
  assert.ok(Number(mediaPipeIndex) >= 0 && Number(mediaPipeIndex) < MEDIAPIPE_POSE_LANDMARK_COUNT);
  assert.ok(Number(mhrIndex) >= 0 && Number(mhrIndex) < MHR70_JOINT_COUNT);
}

assert.equal(MHR70_TO_MEDIAPIPE33[11], 5);
assert.equal(MHR70_TO_MEDIAPIPE33[12], 6);
assert.equal(MHR70_TO_MEDIAPIPE33[15], 62);
assert.equal(MHR70_TO_MEDIAPIPE33[16], 41);
assert.equal(MHR70_TO_MEDIAPIPE33[31], 15);
assert.equal(MHR70_TO_MEDIAPIPE33[32], 18);

const worldJoints = createWorldJoints();
const imageJoints = createImageJoints();
imageJoints[62] = [1500, 850, 0, 0.9];
const caps = buildMhr70WorldVisibilityCaps(imageJoints, { imageWidth: 1000, imageHeight: 2000 });
assert.equal(caps[15], 0.3);
assert.equal(caps[16], 1);

const screenLandmarks = mapMhr70ToMediaPipe33(imageJoints, {
  screenSpace: true,
  imageWidth: 1000,
  imageHeight: 2000,
  visibility: 0.8,
});
assert.equal(screenLandmarks.length, MEDIAPIPE_POSE_LANDMARK_COUNT);
assert.equal(screenLandmarks[11].visibility, 0.8);
assert.equal(screenLandmarks[15].visibility, 0.05);
assert.ok(screenLandmarks[7].x > screenLandmarks[8].x);

const worldLandmarks = mapMhr70ToMediaPipe33(worldJoints, {
  screenSpace: false,
  visibility: 0.8,
  visibilityCaps: caps,
});
assert.equal(worldLandmarks.length, MEDIAPIPE_POSE_LANDMARK_COUNT);
assert.equal(worldLandmarks[11].x, 0.4);
assert.equal(worldLandmarks[12].x, -0.4);
assert.ok(worldLandmarks[7].x > worldLandmarks[8].x);
assert.equal(worldLandmarks[15].visibility, 0.3);
assert.equal(worldLandmarks[16].visibility, 0.8);

const axisFrame = auditMhr70AxisFrame(worldJoints);
assert.equal(axisFrame.yDown, true);
assert.equal(axisFrame.zCameraNegative, true);
const axisSummary = summarizeMhr70AxisAudit([axisFrame, axisFrame]);
assert.equal(axisSummary.samples, 2);
assert.equal(axisSummary.yDownRatio, 1);
assert.equal(axisSummary.zCameraNegativeRatio, 1);
assert.equal(axisSummary.worldAxisZ, "native");

console.log("MHR70 mapping check passed.");

function createWorldJoints() {
  const joints = Array.from({ length: MHR70_JOINT_COUNT }, () => [0, -1, 0, 0.9]);
  const set = (index, x, y, z = 0) => {
    joints[index] = [x, y, z, 0.9];
  };

  set(0, 0, -1.7, -0.1);
  set(3, 0.18, -1.68, -0.08);
  set(4, -0.18, -1.68, -0.08);
  set(5, 0.4, -1.5, 0);
  set(6, -0.4, -1.5, 0);
  set(7, 0.7, -1.05, 0.05);
  set(8, -0.7, -1.05, 0.05);
  set(9, 0.2, -1, 0);
  set(10, -0.2, -1, 0);
  set(11, 0.24, -0.5, 0.05);
  set(12, -0.24, -0.5, 0.05);
  set(13, 0.25, 0, 0);
  set(14, -0.25, 0, 0);
  set(41, -0.9, -0.7, 0);
  set(62, 0.9, -0.7, 0);
  return joints;
}

function createImageJoints() {
  const joints = Array.from({ length: MHR70_JOINT_COUNT }, () => [500, 1000, 0, 0.9]);
  const set = (index, x, y) => {
    joints[index] = [x, y, 0, 0.9];
  };

  set(0, 500, 220);
  set(3, 700, 260);
  set(4, 300, 260);
  set(5, 900, 500);
  set(6, 100, 500);
  set(9, 700, 1100);
  set(10, 300, 1100);
  set(41, 70, 850);
  set(62, 930, 850);
  return joints;
}
