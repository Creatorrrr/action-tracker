#!/usr/bin/env node
import assert from "node:assert/strict";
import { classifyArmGesture } from "../src/labels/gesture-classifier.js";

assert.equal(classifyArmGesture(makeFrame({ leftWrist: [-0.7, -0.9, 0], rightWrist: [0.7, -0.9, 0] })).arms, "crossed");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.35, -0.9, 0.2], rightWrist: [-0.35, -0.9, 0.2] })).arms, "behind-back");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.4, -1.45, 0], rightWrist: [-0.4, -1.45, 0], imageWristY: 0.2 })).arms, "palms-near-head");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.45, -1.0, -0.2], rightWrist: [-0.45, -1.0, -0.2], imageWristY: 0.5 })).arms, "forward");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.45, -1.0, -0.06], rightWrist: [-0.45, -1.0, -0.06], imageWristY: 0.5 })).arms, "half-forward");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.35, -0.65, 0], rightWrist: [-0.35, -0.65, 0], imageWristY: 0.75 })).arms, "down");
assert.equal(classifyArmGesture(makeFrame({ leftWrist: [0.3, -1.0, 0], rightWrist: [-0.3, -1.0, 0], imageWristY: 0.5 })).arms, "chest-raised");

console.log("Gesture classifier check passed.");

function makeFrame(options = {}) {
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: -1, z: 0, visibility: 1, presence: 1 }));
  const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1, presence: 1 }));
  const leftWrist = options.leftWrist ?? [0.45, -0.65, 0];
  const rightWrist = options.rightWrist ?? [-0.45, -0.65, 0];
  const imageWristY = options.imageWristY ?? 0.75;

  set(world, 11, [0.4, -1.5, 0]);
  set(world, 12, [-0.4, -1.5, 0]);
  set(world, 23, [0.2, -1.0, 0]);
  set(world, 24, [-0.2, -1.0, 0]);
  set(world, 15, leftWrist);
  set(world, 16, rightWrist);

  set(image, 0, [0.5, 0.16, 0]);
  set(image, 11, [0.35, 0.35, 0]);
  set(image, 12, [0.65, 0.35, 0]);
  set(image, 23, [0.4, 0.85, 0]);
  set(image, 24, [0.6, 0.85, 0]);
  set(image, 15, [0.35, imageWristY, 0]);
  set(image, 16, [0.65, imageWristY, 0]);

  return {
    poseWorldLandmarks: world,
    poseLandmarks: image,
  };
}

function set(landmarks, index, values) {
  landmarks[index] = {
    x: values[0],
    y: values[1],
    z: values[2],
    visibility: 1,
    presence: 1,
  };
}
