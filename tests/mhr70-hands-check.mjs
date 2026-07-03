#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  MEDIAPIPE_HAND_LANDMARK_COUNT,
  MHR70_HAND_TO_MEDIAPIPE21,
  mapMhr70ToMediaPipeHand,
} from "../src/skeleton/mhr70-hands.js";
import { MHR70_JOINT_COUNT, MHR70_JOINT_NAMES } from "../src/skeleton/mhr70-mapping.js";

assert.equal(MHR70_HAND_TO_MEDIAPIPE21.left.length, MEDIAPIPE_HAND_LANDMARK_COUNT);
assert.equal(MHR70_HAND_TO_MEDIAPIPE21.right.length, MEDIAPIPE_HAND_LANDMARK_COUNT);
assert.equal(MHR70_JOINT_NAMES[MHR70_HAND_TO_MEDIAPIPE21.left[0]], "left_wrist");
assert.equal(MHR70_JOINT_NAMES[MHR70_HAND_TO_MEDIAPIPE21.right[0]], "right_wrist");
assert.equal(MHR70_JOINT_NAMES[MHR70_HAND_TO_MEDIAPIPE21.left[8]], "left_forefinger4");
assert.equal(MHR70_JOINT_NAMES[MHR70_HAND_TO_MEDIAPIPE21.right[20]], "right_pinky_finger4");

const world = createMhr70WorldJoints();
const image = createMhr70ImageJoints();
const leftWorld = mapMhr70ToMediaPipeHand(world, "left", { screenSpace: false, visibility: 0.75 });
const rightWorld = mapMhr70ToMediaPipeHand(world, "right", { screenSpace: false, visibility: 0.75 });
assert.equal(leftWorld.length, 21);
assert.equal(rightWorld.length, 21);
assert.equal(leftWorld[0].x, 0);
assert.equal(leftWorld[0].y, 0);
assert.equal(leftWorld[0].z, 0);
assert.ok(leftWorld[8].x > leftWorld[0].x);
assert.ok(rightWorld[8].x < rightWorld[0].x);
assert.equal(leftWorld[8].visibility, 0.75);

image[46] = [1400, 850, 0, 0.9];
const leftScreen = mapMhr70ToMediaPipeHand(image, "left", {
  screenSpace: true,
  imageWidth: 1000,
  imageHeight: 2000,
  visibility: 0.8,
});
assert.equal(leftScreen.length, 21);
assert.equal(leftScreen[0].x, 0.93);
assert.equal(leftScreen[0].y, 0.425);
assert.equal(leftScreen[8].x, 1);
assert.equal(leftScreen[8].visibility, 0.05);

console.log("MHR70 hands check passed.");

function createMhr70WorldJoints() {
  const joints = Array.from({ length: MHR70_JOINT_COUNT }, () => [0, -1, 0, 0.9]);
  const set = (index, x, y, z = 0) => {
    joints[index] = [x, y, z, 0.9];
  };

  set(41, -0.9, -0.7, 0);
  set(40, -0.96, -0.66, 0.03);
  set(39, -0.98, -0.64, 0.04);
  set(38, -1.0, -0.62, 0.05);
  set(37, -1.02, -0.6, 0.06);
  set(28, -0.92, -0.68, 0.02);
  set(27, -0.96, -0.66, 0.03);
  set(26, -1.0, -0.64, 0.04);
  set(25, -1.04, -0.62, 0.05);

  set(62, 0.9, -0.7, 0);
  set(61, 0.96, -0.66, 0.03);
  set(60, 0.98, -0.64, 0.04);
  set(59, 1.0, -0.62, 0.05);
  set(58, 1.02, -0.6, 0.06);
  set(49, 0.92, -0.68, 0.02);
  set(48, 0.96, -0.66, 0.03);
  set(47, 1.0, -0.64, 0.04);
  set(46, 1.04, -0.62, 0.05);

  return joints;
}

function createMhr70ImageJoints() {
  const joints = Array.from({ length: MHR70_JOINT_COUNT }, () => [500, 1000, 0, 0.9]);
  const set = (index, x, y) => {
    joints[index] = [x, y, 0, 0.9];
  };

  set(62, 930, 850);
  set(49, 950, 880);
  set(48, 980, 870);
  set(47, 1010, 860);
  set(46, 1040, 850);
  set(41, 70, 850);
  set(28, 50, 880);
  set(27, 20, 870);
  set(26, -10, 860);
  set(25, -40, 850);

  return joints;
}
