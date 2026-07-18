#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cloneAppliedAvatarStateSnapshot,
  compareSamePoseAppliedAvatarStates,
  endpointHeightNormalizedError,
  quaternionSignInvariantAngleDeg,
} from "../src/avatar-applied-state.js";

const identity = [0, 0, 0, 1];
const negativeIdentity = [0, 0, 0, -1];

assert.ok(quaternionSignInvariantAngleDeg(identity, negativeIdentity) < 1e-9);
assert.ok(Math.abs(
  quaternionSignInvariantAngleDeg(identity, axisAngleQuaternion([0, 0, 1], 12)) - 12,
) < 1e-9);
assert.equal(quaternionSignInvariantAngleDeg(identity, null), null);
assert.equal(quaternionSignInvariantAngleDeg(identity, [null, 0, 0, 1]), null);
assert.ok(Math.abs(endpointHeightNormalizedError([0, 0, 0], [0.02, 0, 0], 2) - 0.01) < 1e-12);
assert.equal(endpointHeightNormalizedError([0, 0, 0], null, 2), null);

const reference = appliedStateFixture();
const identical = cloneAppliedAvatarStateSnapshot(reference);

for (const bone of Object.values(identical.bones)) {
  bone.localQuaternion = bone.localQuaternion.map((component) => -component);
}

const identicalComparison = compareSamePoseAppliedAvatarStates(reference, identical);
assert.equal(identicalComparison.passed, true);
assert.equal(identicalComparison.quaternion.expectedCount, 20);
assert.equal(identicalComparison.quaternion.comparedCount, 20);
assert.equal(identicalComparison.quaternion.coverage, 1);
assert.ok(identicalComparison.quaternion.p95Deg < 1e-9);
assert.ok(identicalComparison.quaternion.maxDeg < 1e-9);
assert.equal(identicalComparison.endpoint.expectedCount, 5);
assert.equal(identicalComparison.endpoint.comparedCount, 5);
assert.equal(identicalComparison.endpoint.coverage, 1);
assert.equal(identicalComparison.endpoint.p95HeightRatio, 0);
assert.equal(identicalComparison.endpoint.maxHeightRatio, 0);

const perturbed = cloneAppliedAvatarStateSnapshot(reference);
perturbed.bones.Bone20.localQuaternion = axisAngleQuaternion([0, 1, 0], 10);
perturbed.fkEndpoints.Head.modelLocalPosition[0] += 0.08;
const perturbedComparison = compareSamePoseAppliedAvatarStates(reference, perturbed);

assert.equal(perturbedComparison.passed, false);
assert.ok(perturbedComparison.quaternion.p95Deg < 1e-9);
assert.ok(Math.abs(perturbedComparison.quaternion.maxDeg - 10) < 1e-9);
assert.ok(Math.abs(perturbedComparison.endpoint.p95HeightRatio - 0.04) < 1e-12);
assert.ok(Math.abs(perturbedComparison.endpoint.maxHeightRatio - 0.04) < 1e-12);

const missing = cloneAppliedAvatarStateSnapshot(reference);
delete missing.bones.Bone20;
delete missing.fkEndpoints.Head;
const missingComparison = compareSamePoseAppliedAvatarStates(reference, missing);

assert.equal(missingComparison.passed, false);
assert.equal(missingComparison.quaternion.coverage, 19 / 20);
assert.equal(missingComparison.endpoint.coverage, 4 / 5);
assert.equal(missingComparison.quaternion.missingCount, 1);
assert.equal(missingComparison.endpoint.missingCount, 1);

const clone = cloneAppliedAvatarStateSnapshot(reference);
clone.bones.Bone01.localQuaternion[3] = 0;
clone.fkEndpoints.LeftHand.worldPosition[0] = 999;
assert.equal(reference.bones.Bone01.localQuaternion[3], 1);
assert.equal(reference.fkEndpoints.LeftHand.worldPosition[0], -0.5);

const rendererSource = readFileSync(new URL("../src/avatar-renderer.js", import.meta.url), "utf8");
const updateSource = sourceBetween(rendererSource, "  function update({", "  function getBodyValidationSnapshot(");
const captureSource = sourceBetween(
  rendererSource,
  "  function captureAppliedAvatarState(",
  "  function getAppliedAvatarStateSnapshot(",
);

assert.ok(updateSource.indexOf("applyPose(") < updateSource.indexOf("captureAppliedAvatarState({"));
assert.ok(updateSource.indexOf("applyFaceHeadPose(") < updateSource.indexOf("captureAppliedAvatarState({"));
assert.ok(updateSource.indexOf("applyHands(") < updateSource.indexOf("captureAppliedAvatarState({"));
assert.ok(updateSource.indexOf("applyFaceExpressions(") < updateSource.indexOf("captureAppliedAvatarState({"));
assert.match(captureSource, /localQuaternion:\s*quaternionToArray\(bone\.quaternion\)/);
assert.match(captureSource, /modelLocalPosition:/);
assert.match(captureSource, /worldPosition:/);
assert.doesNotMatch(captureSource, /lastStrictRetargetFrame/);
assert.doesNotMatch(
  captureSource,
  /(?:bone|model)\.(?:position|quaternion|scale)\.(?:copy|set|slerp|multiply)\(/,
);
assert.match(rendererSource, /getMotionStateSnapshot\(\)[\s\S]*?appliedAvatarState:\s*getAppliedAvatarStateSnapshot\(\)/);
assert.match(rendererSource, /\n\s+getAppliedAvatarStateSnapshot,\n/);

console.log("Avatar applied state check passed.");

function appliedStateFixture() {
  const bones = {};
  for (let index = 1; index <= 20; index += 1) {
    bones[`Bone${String(index).padStart(2, "0")}`] = {
      localQuaternion: identity.slice(),
    };
  }

  return {
    version: 1,
    modelHeight: 2,
    bones,
    fkEndpoints: {
      LeftHand: endpoint("leftWrist", [-0.5, 1.2, 0]),
      RightHand: endpoint("rightWrist", [0.5, 1.2, 0]),
      LeftFoot: endpoint("leftAnkle", [-0.2, 0.1, 0]),
      RightFoot: endpoint("rightAnkle", [0.2, 0.1, 0]),
      Head: endpoint("head", [0, 1.8, 0]),
    },
  };
}

function endpoint(joint, position) {
  return {
    joint,
    modelLocalPosition: position.slice(),
    worldPosition: position.slice(),
  };
}

function axisAngleQuaternion(axis, degrees) {
  const length = Math.hypot(...axis);
  const halfAngle = (degrees * Math.PI) / 360;
  const scale = Math.sin(halfAngle) / length;
  return [axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(halfAngle)];
}

function sourceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source start: ${start}`);
  assert.ok(endIndex > startIndex, `missing source end: ${end}`);
  return source.slice(startIndex, endIndex);
}
