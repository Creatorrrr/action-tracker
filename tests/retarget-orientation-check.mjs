#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  computePlaneNormal,
  resolveAvatarYawDeg,
  resolveHandPalmNormal,
} from "../src/retarget-orientation.js";

const wrist = { x: 0, y: 0, z: 0 };
const indexBase = { x: 1, y: 0, z: 0 };
const pinkyBase = { x: 0, y: 1, z: 0 };

const rawNormal = computePlaneNormal(wrist, indexBase, pinkyBase);
assert.deepEqual(roundVector(rawNormal), { x: 0, y: 0, z: 1 });

const leftPalm = resolveHandPalmNormal({ wrist, indexBase, pinkyBase, side: "Left" });
assert.equal(leftPalm.valid, true);
assert.equal(leftPalm.sign, -1);
assert.deepEqual(roundVector(leftPalm.rawNormal), { x: 0, y: 0, z: 1 });
assert.deepEqual(roundVector(leftPalm.normal), { x: 0, y: 0, z: -1 });

const rightPalm = resolveHandPalmNormal({ wrist, indexBase, pinkyBase, side: "Right" });
assert.equal(rightPalm.valid, true);
assert.equal(rightPalm.sign, -1);
assert.deepEqual(roundVector(rightPalm.normal), { x: 0, y: 0, z: -1 });

const customPalm = resolveHandPalmNormal({
  wrist,
  indexBase,
  pinkyBase,
  side: "Left",
  normalSigns: { Left: 1 },
});
assert.equal(customPalm.sign, 1);
assert.deepEqual(roundVector(customPalm.normal), { x: 0, y: 0, z: 1 });

assert.equal(resolveHandPalmNormal({ wrist, side: "Left" }).valid, false);
assert.equal(resolveAvatarYawDeg(90), -90);
assert.equal(resolveAvatarYawDeg(-90), 90);
assert.equal(resolveAvatarYawDeg(180), -180);
assert.equal(resolveAvatarYawDeg(270), 90);
assert.equal(resolveAvatarYawDeg(90, 1), 90);
assert.equal(resolveAvatarYawDeg(Number.NaN), null);

console.log("Retarget orientation check passed.");

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
