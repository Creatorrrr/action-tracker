#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  computePlaneNormal,
  resolveAvatarYawDeg,
  resolveHandPalmNormal,
} from "../src/retarget-orientation.js";
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
