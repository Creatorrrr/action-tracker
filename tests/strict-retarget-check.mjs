#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  RETARGET_MODE_LEGACY,
  RETARGET_MODE_STRICT,
  buildSourceAvatarDivergenceSummary,
  buildStrictRetargetFrame,
  normalizeAvatarRetargetMode,
} from "../src/retarget/skeleton-fk-retarget.js";

assert.equal(normalizeAvatarRetargetMode("strict"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("skeleton-direct"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("default"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("unknown"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("legacy"), RETARGET_MODE_LEGACY);

const identityPose = solvedPose([
  target("LeftArm", "arms", { x: 1, y: 0, z: 0 }),
  target("RightArm", "arms", { x: -1, y: 0, z: 0 }),
]);
const identityFrame = buildStrictRetargetFrame({
  solvedPose: identityPose,
  rigBasis: {
    bones: {
      LeftArm: { restAxis: [1, 0, 0] },
      RightArm: { restAxis: [-1, 0, 0] },
    },
  },
});

assert.equal(identityFrame.mode, RETARGET_MODE_STRICT);
assert.equal(identityFrame.diagnostics.boneCount, 2);
assert.deepEqual(roundVector(identityFrame.bones.LeftArm.sourceDirection), { x: 1, y: 0, z: 0 });
assert.deepEqual(roundQuaternion(identityFrame.bones.LeftArm.localRotation), { x: 0, y: 0, z: 0, w: 1 });

const turnedPose = solvedPose([
  target("LeftArm", "arms", { x: 0, y: 0, z: 1 }),
], {
  facingYawDeg: 180,
  facingUnwrappedYawDeg: 180,
  facingYawReliable: true,
  facingYawReliabilityReason: "recovered",
  facingRecoveringFromUnreliableYaw: true,
  facingRecoveryTargetYawDeg: 180,
});
const turnedFrame = buildStrictRetargetFrame({
  solvedPose: turnedPose,
  rigBasis: {
    bones: {
      LeftArm: { restAxis: [1, 0, 0] },
    },
  },
});
const rotatedAxis = rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, turnedFrame.bones.LeftArm.localRotation);

assert.equal(turnedFrame.root.yawDeg, -180);
assert.equal(turnedFrame.root.yawReliable, true);
assert.equal(turnedFrame.root.yawReliabilityReason, "recovered");
assert.equal(turnedFrame.root.recoveringFromUnreliableYaw, true);
assert.equal(turnedFrame.root.recoveryTargetYawDeg, 180);
assert.deepEqual(roundVector(rotatedAxis), { x: 0, y: 0, z: 1 });

const crossedArmsPose = solvedPose([
  target("LeftForeArm", "arms", { x: -0.8, y: 0.1, z: 0.6 }, {
    directionTorsoLocal: { x: 0.8, y: 0.1, z: -0.6 },
  }),
]);
const crossedFrame = buildStrictRetargetFrame({
  solvedPose: crossedArmsPose,
  rigBasis: {
    bones: {
      LeftForeArm: { restAxis: [1, 0, 0] },
    },
  },
});

assert.equal(crossedFrame.bones.LeftForeArm.usedTorsoLocalDirection, false);
assert.deepEqual(
  roundVector(crossedFrame.bones.LeftForeArm.sourceDirection),
  roundVector({ x: -0.8, y: 0.1, z: 0.6 }),
);

const divergence = buildSourceAvatarDivergenceSummary({
  retargetMode: "strict",
  segments: [
    { name: "leftUpperArm", group: "arms", bone: "LeftArm", errorDeg: 12 },
    { name: "rightUpperArm", group: "arms", bone: "RightArm", errorDeg: 42 },
  ],
  handOrientation: {
    Left: {
      side: "Left",
      tracked: true,
      source: "worldLandmarks",
      rawPalmNormal: [0, 0, 1],
      targetPalmNormal: [0, 0, -1],
      avatarPalmNormal: [0, 0, -1],
    },
    Right: {
      side: "Right",
      tracked: true,
      source: "worldLandmarks",
      rawPalmNormal: [0, 0, 1],
      targetPalmNormal: [0, 0, 1],
      avatarPalmNormal: [0, 0, -1],
    },
  },
  rootMotion: {
    yawOffsetDeg: -90,
    orientationMetrics: {
      avatarTargetYawDeg: -90,
      solverUnwrappedYawDeg: 90,
      solverRawYawJump: false,
      solverSideOrderFlip: false,
      solverYawReliable: true,
      solverYawReliabilityReason: "stable",
      solverRecoveringFromUnreliableYaw: false,
    },
  },
});

assert.equal(divergence.retargetMode, RETARGET_MODE_STRICT);
assert.equal(divergence.angularErrorDeg.count, 2);
assert.equal(divergence.angularErrorDeg.max, 42);
assert.equal(divergence.handPalm.inversionCount, 1);
assert.equal(divergence.handPalm.bySide[0].rawPalmDot, -1);
assert.equal(divergence.handPalm.bySide[0].palmDot, 1);
assert.equal(divergence.handPalm.bySide[1].palmDot, -1);
assert.equal(divergence.rootYaw.targetYawDeg, -90);
assert.equal(divergence.rootYaw.reliable, true);
assert.equal(divergence.rootYaw.reliabilityReason, "stable");

console.log("Strict retarget check passed.");

function solvedPose(targets, meta = {}) {
  return {
    timestamp: 0,
    targets,
    meta: {
      mode: "full-body",
      facing: "front",
      facingDetail: "front",
      facingYawDeg: 0,
      facingUnwrappedYawDeg: 0,
      ...meta,
    },
  };
}

function target(bone, group, direction, extras = {}) {
  return {
    bone,
    group,
    from: `${bone}:from`,
    to: `${bone}:to`,
    confidence: 1,
    direction,
    ...extras,
  };
}

function rotateVectorByQuaternion(vector, quaternion) {
  const x = vector.x;
  const y = vector.y;
  const z = vector.z;
  const qx = quaternion.x;
  const qy = quaternion.y;
  const qz = quaternion.z;
  const qw = quaternion.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

function roundVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: round(vector.x / length),
    y: round(vector.y / length),
    z: round(vector.z / length),
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

function round(value) {
  const rounded = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}
