#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  computeFaceHeadDelta,
  createFaceHeadPoseTrackerState,
  quaternionFromEulerYXZ,
  readFaceTransformQuaternion,
  updateFaceHeadPoseTracker,
} from "../src/face-head-pose.js";

const yaw30 = degToRad(30);
const pitch12 = degToRad(12);
const sourceQuaternion = quaternionFromEulerYXZ({ x: pitch12, y: yaw30, z: 0 });
const columnMajorMatrix = composeColumnMajorTransform({
  quaternion: sourceQuaternion,
  translation: { x: 0, y: 1.2, z: -42 },
});
const columnMajor = readFaceTransformQuaternion(columnMajorMatrix);

assert.equal(columnMajor.valid, true);
assert.equal(columnMajor.layout, "column-major");
assert.equal(roundDeg(eulerFromQuaternion(columnMajor.quaternion).y), 30);
assert.equal(roundDeg(eulerFromQuaternion(columnMajor.quaternion).x), 12);

const rowMajor = readFaceTransformQuaternion(toRowMajorArray(columnMajorMatrix));
assert.equal(rowMajor.valid, true);
assert.equal(rowMajor.layout, "row-major");
assert.equal(roundDeg(eulerFromQuaternion(rowMajor.quaternion).y), 30);
assert.equal(roundDeg(eulerFromQuaternion(rowMajor.quaternion).x), 12);

const baseQuaternion = { x: 0, y: 0, z: 0, w: 1 };
const unmirroredDelta = computeFaceHeadDelta({
  baseQuaternion,
  sourceQuaternion,
  mirrored: false,
  maxAngleRad: Math.PI,
});
assert.equal(roundDeg(unmirroredDelta.eulerRad.y), 30);
assert.equal(roundDeg(unmirroredDelta.eulerRad.x), 12);

const mirroredDelta = computeFaceHeadDelta({
  baseQuaternion,
  sourceQuaternion,
  mirrored: true,
  maxAngleRad: Math.PI,
});
assert.equal(roundDeg(mirroredDelta.eulerRad.y), -30);
assert.equal(roundDeg(mirroredDelta.eulerRad.x), 12);

const tracker = createFaceHeadPoseTrackerState();
let update = updateFaceHeadPoseTracker(tracker, baseQuaternion, 0);
assert.equal(update.status, "initialized");
assert.equal(update.apply, false);

update = updateFaceHeadPoseTracker(tracker, sourceQuaternion, 100);
assert.equal(update.status, "tracked");
assert.equal(update.apply, true);
assert.equal(update.reacquireBlend, 1);

update = updateFaceHeadPoseTracker(tracker, null, 250, { trackingGraceMs: 400 });
assert.equal(update.status, "holding");
assert.equal(update.apply, true);
assert.equal(update.withinGrace, true);

update = updateFaceHeadPoseTracker(tracker, null, 800, { trackingGraceMs: 400 });
assert.equal(update.status, "missing");
assert.equal(update.apply, false);
assert.equal(update.withinGrace, false);
assert.equal(quaternionAngle(tracker.baseQuaternion, baseQuaternion) < 0.000001, true);

update = updateFaceHeadPoseTracker(tracker, sourceQuaternion, 900, {
  trackingGraceMs: 400,
  reacquireBlendMs: 260,
});
assert.equal(update.status, "reacquired");
assert.equal(update.apply, true);
assert.equal(update.reacquireBlend, 0);
assert.equal(tracker.reacquireCount, 1);
assert.equal(quaternionAngle(tracker.baseQuaternion, baseQuaternion) < 0.000001, true);

update = updateFaceHeadPoseTracker(tracker, sourceQuaternion, 1030, {
  trackingGraceMs: 400,
  reacquireBlendMs: 260,
});
assert.equal(update.status, "tracked");
assert.equal(update.reacquireBlend > 0.49 && update.reacquireBlend < 0.51, true);

console.log("Face head pose check passed.");

function eulerFromQuaternion(quaternion) {
  const delta = computeFaceHeadDelta({
    baseQuaternion: { x: 0, y: 0, z: 0, w: 1 },
    sourceQuaternion: quaternion,
    mirrored: false,
    maxAngleRad: Math.PI,
  });

  return delta.eulerRad;
}

function roundDeg(value) {
  return Math.round(value * 180 / Math.PI);
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function quaternionAngle(a, b) {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, Math.max(-1, dot)));
}

function composeColumnMajorTransform({ quaternion, translation }) {
  const { x, y, z, w } = quaternion;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    1 - (yy + zz), xy + wz, xz - wy, 0,
    xy - wz, 1 - (xx + zz), yz + wx, 0,
    xz + wy, yz - wx, 1 - (xx + yy), 0,
    translation.x, translation.y, translation.z, 1,
  ];
}

function toRowMajorArray(matrix) {
  const e = matrix;

  return [
    e[0], e[4], e[8], e[12],
    e[1], e[5], e[9], e[13],
    e[2], e[6], e[10], e[14],
    e[3], e[7], e[11], e[15],
  ];
}
