#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  RETARGET_MODE_LEGACY,
  RETARGET_MODE_STRICT,
  buildSourceAvatarDivergenceSummary,
  buildStrictRetargetFrame,
  normalizeAvatarRetargetMode,
} from "../src/retarget/skeleton-fk-retarget.js";
import {
  resolveCausalSecondaryActivation,
  stabilizeCausalSecondaryAxis,
} from "../src/retarget/causal-secondary-axis.js";
import {
  deriveRigSecondaryAxisLocal,
  limitCausalRigLocalRotation,
  resolveBasisTransportRotation,
  solveRigAdaptiveHingeLocalRotation,
  solveRigEndpointPreservingHingeLocalRotation,
  solveRigHingeLocalRotation,
  solveRigLocalRotation,
} from "../src/retarget/rig-local-rotation.js";
import { ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC } from "../src/solver/pose-solver.js";
import {
  createPlantedFootContactState,
  releasePlantedFootContact,
  resolveBoundedTwoBoneRootCorrection,
  solveSignedPoleTwoBone,
  updatePlantedFootContact,
} from "../src/retarget/planted-foot-ik.js";

assert.equal(normalizeAvatarRetargetMode("strict"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("skeleton-direct"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("default"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("unknown"), RETARGET_MODE_STRICT);
assert.equal(normalizeAvatarRetargetMode("legacy"), RETARGET_MODE_LEGACY);


assert.equal(ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC, 420);

const causalPreviousRotation = { x: 0, y: 0, z: 0, w: 1 };
const causalQuarterTurn = quaternionFromAxisAngle(
  { x: 0, y: 1, z: 0 },
  degToRad(90),
);
const causalFrameDeltaMs = 1000 / 30;
const boundedQuarterTurn = limitCausalRigLocalRotation({
  previousLocalRotation: causalPreviousRotation,
  currentLocalRotation: causalQuarterTurn,
  deltaMs: causalFrameDeltaMs,
  maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
});

assert.equal(boundedQuarterTurn.valid, true);
assert.equal(boundedQuarterTurn.rateLimited, true);
assert.ok(Math.abs(boundedQuarterTurn.rawDeltaDeg - 90) <= 0.000001);
assert.ok(Math.abs(boundedQuarterTurn.maximumStepDeg - 14) <= 0.000001);
assert.ok(Math.abs(boundedQuarterTurn.appliedDeltaDeg - 14) <= 0.000001);
assert.ok(
  Math.abs(
    quaternionAngleDeg(causalPreviousRotation, boundedQuarterTurn.localRotation) - 14,
  ) <= 0.000001,
  "a 90-degree target at 30fps must be bounded by the existing 420-degree-per-second contract",
);

const causalSubLimitTarget = quaternionFromAxisAngle(
  { x: 1, y: 0, z: 0 },
  degToRad(10),
);
const causalSubLimit = limitCausalRigLocalRotation({
  previousLocalRotation: causalPreviousRotation,
  currentLocalRotation: causalSubLimitTarget,
  deltaMs: causalFrameDeltaMs,
  maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
});
assert.equal(causalSubLimit.valid, true);
assert.equal(causalSubLimit.rateLimited, false);
assert.ok(quaternionAngleDeg(causalSubLimit.localRotation, causalSubLimitTarget) <= 0.000001);

const causalFirstObservation = limitCausalRigLocalRotation({
  previousLocalRotation: null,
  currentLocalRotation: causalQuarterTurn,
  deltaMs: causalFrameDeltaMs,
  maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
});
assert.equal(causalFirstObservation.valid, true);
assert.equal(causalFirstObservation.mode, "initialized");
assert.equal(causalFirstObservation.rateLimited, false);
assert.ok(
  quaternionAngleDeg(causalFirstObservation.localRotation, causalQuarterTurn) <= 0.000001,
);

const causalInvalidPrevious = limitCausalRigLocalRotation({
  previousLocalRotation: { x: 0, y: 0, z: 0, w: 0 },
  currentLocalRotation: causalQuarterTurn,
  deltaMs: causalFrameDeltaMs,
  maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
});
assert.equal(causalInvalidPrevious.valid, true);
assert.equal(causalInvalidPrevious.mode, "initialized");
assert.ok(quaternionAngleDeg(causalInvalidPrevious.localRotation, causalQuarterTurn) <= 0.000001);

const boundedAntipodalAlias = limitCausalRigLocalRotation({
  previousLocalRotation: causalPreviousRotation,
  currentLocalRotation: negateQuaternion(causalQuarterTurn),
  deltaMs: causalFrameDeltaMs,
  maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
});
assert.equal(boundedAntipodalAlias.valid, true);
assert.ok(
  quaternionAngleDeg(
    boundedQuarterTurn.localRotation,
    boundedAntipodalAlias.localRotation,
  ) <= 0.00001,
  "q/-q target aliases must produce the same bounded physical rotation",
);

for (const [options, reason] of [
  [{
    currentLocalRotation: { x: 0, y: 0, z: 0, w: 0 },
    deltaMs: causalFrameDeltaMs,
    maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
  }, "invalid-current-local-rotation"],
  [{
    currentLocalRotation: causalQuarterTurn,
    deltaMs: 0,
    maxAngularVelocityDegPerSec: ARM_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
  }, "invalid-delta-ms"],
  [{
    currentLocalRotation: causalQuarterTurn,
    deltaMs: causalFrameDeltaMs,
    maxAngularVelocityDegPerSec: Number.NaN,
  }, "invalid-max-angular-velocity"],
]) {
  const invalidCausalRotation = limitCausalRigLocalRotation(options);
  assert.equal(invalidCausalRotation.valid, false);
  assert.equal(invalidCausalRotation.mode, "unavailable");
  assert.equal(invalidCausalRotation.reason, reason);
  assert.equal(invalidCausalRotation.localRotation, null);
}

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
assert.equal(identityFrame.bones.LeftArm.localRotation, null);
assert.equal(identityFrame.bones.LeftArm.localRotationDeferred, true);
assert.equal(
  identityFrame.bones.LeftArm.localRotationDeferredReason,
  "requires-current-parent-world-rotation",
);

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
assert.equal(turnedFrame.root.yawDeg, -180);
assert.equal(turnedFrame.root.yawReliable, true);
assert.equal(turnedFrame.root.yawReliabilityReason, "recovered");
assert.equal(turnedFrame.root.recoveringFromUnreliableYaw, true);
assert.equal(turnedFrame.root.recoveryTargetYawDeg, 180);
assert.equal(turnedFrame.bones.LeftArm.localRotation, null);
assert.equal(turnedFrame.bones.LeftArm.localRotationDeferred, true);

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

const constrainedPose = solvedPose([
  target("LeftLeg", "legs", { x: 0, y: -1, z: 0 }, {
    constrainedDirection: { x: 0, y: -0.7, z: 0.7 },
    anatomy: {
      reason: "hinge_flexion_limit",
      hardViolation: true,
      confidenceScale: 0.35,
    },
  }),
]);
const constrainedFrame = buildStrictRetargetFrame({
  solvedPose: constrainedPose,
  rigBasis: {
    bones: {
      LeftLeg: { restAxis: [0, -1, 0] },
    },
  },
});
assert.deepEqual(
  roundVector(constrainedFrame.bones.LeftLeg.sourceDirection),
  roundVector({ x: 0, y: -0.7, z: 0.7 }),
);
assert.equal(constrainedFrame.diagnostics.anatomyConstrainedBones.includes("LeftLeg"), true);
assert.equal(constrainedFrame.diagnostics.anatomyHardViolations, 1);
assert.equal(constrainedFrame.bones.LeftLeg.anatomy.reason, "hinge_flexion_limit");

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

const nearAntipodalPrimaryA = normalizeVector({
  x: -Math.cos(degToRad(5)),
  y: Math.sin(degToRad(5)),
  z: 0,
});
const nearAntipodalPrimaryB = normalizeVector({
  x: -Math.cos(degToRad(5)),
  y: 0,
  z: Math.sin(degToRad(5)),
});
const restPrimary = { x: 1, y: 0, z: 0 };
const restSecondary = { x: 0, y: 1, z: 0 };
const primaryInputDeltaDeg = vectorAngleDeg(nearAntipodalPrimaryA, nearAntipodalPrimaryB);
const unstableBranchDeltaDeg = quaternionAngleDeg(
  quaternionFromUnitVectorsForTest(restPrimary, nearAntipodalPrimaryA),
  quaternionFromUnitVectorsForTest(restPrimary, nearAntipodalPrimaryB),
);

assert.ok(vectorAngleDeg(restPrimary, nearAntipodalPrimaryA) >= 170);
assert.ok(vectorAngleDeg(restPrimary, nearAntipodalPrimaryB) >= 170);
assert.ok(primaryInputDeltaDeg <= 11, `expected <= 11 degree input delta, received ${primaryInputDeltaDeg}`);
assert.ok(unstableBranchDeltaDeg >= 170, `fixture must exercise the antipodal branch, received ${unstableBranchDeltaDeg}`);

const ordinaryAimActivation = resolveCausalSecondaryActivation({
  primary: normalizeVector({ x: -0.8, y: 0.6, z: 0 }),
  restPrimary,
});
const antipodalActivation = resolveCausalSecondaryActivation({
  primary: nearAntipodalPrimaryA,
  restPrimary,
});
const hysteresisHold = resolveCausalSecondaryActivation({
  primary: normalizeVector({ x: -0.9, y: Math.sqrt(1 - 0.9 ** 2), z: 0 }),
  restPrimary,
  previousActive: true,
});
const hysteresisRelease = resolveCausalSecondaryActivation({
  primary: normalizeVector({ x: -0.8, y: 0.6, z: 0 }),
  restPrimary,
  previousActive: true,
});

assert.equal(ordinaryAimActivation.active, false, "ordinary poses must keep the one-axis solver");
assert.equal(antipodalActivation.active, true, "near-antipodal poses must enable causal transport");
assert.equal(hysteresisHold.active, true, "an active transport must survive the enter-threshold boundary");
assert.equal(hysteresisRelease.active, false, "transport must release after clearing the wider exit threshold");

const entryOneAxisQuaternion = quaternionFromUnitVectorsForTest(restPrimary, nearAntipodalPrimaryA);
const entryCurrentSecondary = rotateVectorByQuaternion(restSecondary, entryOneAxisQuaternion);
const transportedA = stabilizeCausalSecondaryAxis({
  primary: nearAntipodalPrimaryA,
  seedSecondary: entryCurrentSecondary,
});
const transportedB = stabilizeCausalSecondaryAxis({
  primary: nearAntipodalPrimaryB,
  previousState: transportedA.state,
});
const transportedQuaternionA = quaternionFromBasis(transportedA.primary, transportedA.secondary);
const transportedQuaternionB = quaternionFromBasis(transportedB.primary, transportedB.secondary);
const transportedDeltaDeg = quaternionAngleDeg(transportedQuaternionA, transportedQuaternionB);

assert.equal(transportedA.valid, true);
assert.equal(transportedB.valid, true);
assert.equal(transportedA.source, "seed");
assert.equal(transportedB.source, "transported");
assert.ok(
  quaternionAngleDeg(entryOneAxisQuaternion, transportedQuaternionA) <= 0.1,
  "entering causal transport must preserve the current one-axis orientation",
);
assert.ok(transportedDeltaDeg <= 25, `parallel transport must avoid the antipodal branch, received ${transportedDeltaDeg}`);
assert.ok(
  vectorAngleDeg(rotateVectorByQuaternion(restPrimary, transportedQuaternionA), nearAntipodalPrimaryA) <= 0.1,
  "transported basis must preserve the first primary aim",
);
assert.ok(
  vectorAngleDeg(rotateVectorByQuaternion(restPrimary, transportedQuaternionB), nearAntipodalPrimaryB) <= 0.1,
  "transported basis must preserve the second primary aim",
);

const resetFromCurrent = stabilizeCausalSecondaryAxis({
  primary: nearAntipodalPrimaryB,
  seedSecondary: transportedB.secondary,
});
const invalidSeed = stabilizeCausalSecondaryAxis({
  primary: nearAntipodalPrimaryB,
  seedSecondary: nearAntipodalPrimaryB,
});

assert.equal(resetFromCurrent.valid, true);
assert.equal(invalidSeed.valid, false);
assert.ok(
  quaternionAngleDeg(
    quaternionFromBasis(transportedB.primary, transportedB.secondary),
    quaternionFromBasis(resetFromCurrent.primary, resetFromCurrent.secondary),
  ) <= 0.1,
  "re-entering must preserve the current transported orientation",
);

const semanticPole = stabilizeCausalSecondaryAxis({
  primary: { x: 1, y: 0, z: 0 },
  seedSecondary: { x: 0, y: 1, z: 0 },
  semanticSecondary: { x: 0, y: 0, z: 1 },
});
const degenerateSemanticPole = stabilizeCausalSecondaryAxis({
  primary: { x: 1, y: 0, z: 0 },
  seedSecondary: { x: 0, y: 1, z: 0 },
  semanticSecondary: normalizeVector({ x: 1, y: 0.01, z: 0 }),
});

assert.equal(semanticPole.valid, true);
assert.equal(semanticPole.source, "semantic");
assert.ok(semanticPole.semanticWeight >= 0.999999);
assert.ok(
  vectorAngleDeg(semanticPole.secondary, { x: 0, y: 0, z: 1 }) <= 0.000001,
  "a reliable torso pole must define the absolute secondary axis",
);
assert.equal(degenerateSemanticPole.valid, true);
assert.equal(degenerateSemanticPole.source, "seed");
assert.equal(degenerateSemanticPole.semanticWeight, 0);
assert.ok(
  vectorAngleDeg(degenerateSemanticPole.secondary, { x: 0, y: 1, z: 0 }) <= 0.000001,
  "a pole parallel to the primary must retain the causal fallback",
);

const ordinaryParentWorld = quaternionFromAxisAngle(
  normalizeVector({ x: 0.2, y: 1, z: -0.1 }),
  degToRad(37),
);
const ordinaryRestLocal = quaternionFromAxisAngle(
  normalizeVector({ x: 0.1, y: -0.2, z: 1 }),
  degToRad(22),
);
const ordinaryRestPrimary = normalizeVector({ x: 1, y: 0.25, z: -0.1 });
const ordinaryTargetWorld = normalizeVector({ x: 0.2, y: 0.8, z: -0.4 });
const ordinaryTargetParent = rotateVectorByQuaternion(
  ordinaryTargetWorld,
  invertQuaternion(ordinaryParentWorld),
);
const ordinaryRestPrimaryParent = rotateVectorByQuaternion(
  ordinaryRestPrimary,
  ordinaryRestLocal,
);
const expectedOrdinaryLocal = multiplyQuaternions(
  quaternionFromUnitVectorsForTest(ordinaryRestPrimaryParent, ordinaryTargetParent),
  ordinaryRestLocal,
);
const ordinarySolved = solveRigLocalRotation({
  parentWorldRotation: ordinaryParentWorld,
  restLocalRotation: ordinaryRestLocal,
  restPrimaryAxisLocal: ordinaryRestPrimary,
  targetPrimaryWorld: ordinaryTargetWorld,
});

assert.equal(ordinarySolved.valid, true);
assert.equal(ordinarySolved.mode, "primary-swing");
assert.ok(
  quaternionAngleDeg(ordinarySolved.localRotation, expectedOrdinaryLocal) <= 0.000001,
  "primary-only solve must preserve the renderer's shortest-arc swing semantics",
);

const yaw90Parent = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, degToRad(90));
const yaw90RestLocal = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, degToRad(31));
const yaw90RestPrimary = { x: 1, y: 0, z: 0 };
const yaw90RestTargetWorld = rotateVectorByQuaternion(
  yaw90RestPrimary,
  multiplyQuaternions(yaw90Parent, yaw90RestLocal),
);
const yaw90RestSolved = solveRigLocalRotation({
  parentWorldRotation: yaw90Parent,
  restLocalRotation: yaw90RestLocal,
  restPrimaryAxisLocal: yaw90RestPrimary,
  targetPrimaryWorld: yaw90RestTargetWorld,
});

assert.equal(yaw90RestSolved.valid, true);
assert.ok(
  quaternionAngleDeg(yaw90RestSolved.localRotation, yaw90RestLocal) <= 0.1,
  "a rest target under a yawed parent must recover the absolute rest-local quaternion",
);

const noncanonicalPrimary = normalizeVector({ x: 1, y: 1, z: 0 });
const noncanonicalSecondary = normalizeVector({ x: 1, y: -1, z: 1 });
const nonidentityRest = quaternionFromAxisAngle(
  normalizeVector({ x: 0.3, y: 0.8, z: -0.4 }),
  degToRad(43),
);
const nonidentityParent = quaternionFromAxisAngle(
  normalizeVector({ x: -0.2, y: 1, z: 0.1 }),
  degToRad(-35),
);
const desiredNonidentityLocal = quaternionFromAxisAngle(
  normalizeVector({ x: 0.2, y: 0.8, z: 0.5 }),
  degToRad(73),
);
const desiredNonidentityWorld = multiplyQuaternions(
  nonidentityParent,
  desiredNonidentityLocal,
);
const nonidentityTargetPrimary = rotateVectorByQuaternion(
  noncanonicalPrimary,
  desiredNonidentityWorld,
);
const nonidentityTargetSecondary = rotateVectorByQuaternion(
  noncanonicalSecondary,
  desiredNonidentityWorld,
);
const nonidentitySolved = solveRigLocalRotation({
  parentWorldRotation: nonidentityParent,
  restLocalRotation: nonidentityRest,
  restPrimaryAxisLocal: noncanonicalPrimary,
  restSecondaryAxisLocal: noncanonicalSecondary,
  targetPrimaryWorld: nonidentityTargetPrimary,
  targetSecondaryWorld: nonidentityTargetSecondary,
});
const nonidentitySolvedWorld = multiplyQuaternions(
  nonidentityParent,
  nonidentitySolved.localRotation,
);

assert.equal(nonidentitySolved.valid, true);
assert.equal(nonidentitySolved.mode, "full-basis");
assert.ok(
  quaternionAngleDeg(nonidentitySolved.localRotation, desiredNonidentityLocal) <= 0.1,
  "full-basis solve must recover a non-identity absolute local rotation",
);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(noncanonicalPrimary, nonidentitySolvedWorld),
    nonidentityTargetPrimary,
  ) <= 0.1,
  "noncanonical primary must reconstruct in world space",
);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(noncanonicalSecondary, nonidentitySolvedWorld),
    nonidentityTargetSecondary,
  ) <= 0.1,
  "noncanonical secondary must reconstruct in world space",
);


const fixedWorldTarget = normalizeVector({ x: 0.25, y: 0.6, z: 0.75 });
const changedParentA = { x: 0, y: 0, z: 0, w: 1 };
const changedParentB = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, degToRad(60));
const changedParentSolveA = solveRigLocalRotation({
  parentWorldRotation: changedParentA,
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  targetPrimaryWorld: fixedWorldTarget,
});
const changedParentSolveB = solveRigLocalRotation({
  parentWorldRotation: changedParentB,
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  targetPrimaryWorld: fixedWorldTarget,
});

for (const [parent, solved] of [
  [changedParentA, changedParentSolveA],
  [changedParentB, changedParentSolveB],
]) {
  const reconstructed = rotateVectorByQuaternion(
    { x: 1, y: 0, z: 0 },
    multiplyQuaternions(parent, solved.localRotation),
  );
  assert.ok(
    vectorAngleDeg(reconstructed, fixedWorldTarget) <= 0.1,
    "the same world target must reconstruct after a current-parent change",
  );
}
assert.ok(
  quaternionAngleDeg(changedParentSolveA.localRotation, changedParentSolveB.localRotation) >= 20,
  "a changed parent basis must produce a different absolute local quaternion",
);

for (const mirroredFixture of [
  {
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    targetPrimaryWorld: normalizeVector({ x: 0.3, y: 0.8, z: 0.5 }),
  },
  {
    restPrimaryAxisLocal: { x: -1, y: 0, z: 0 },
    targetPrimaryWorld: normalizeVector({ x: -0.3, y: 0.8, z: 0.5 }),
  },
]) {
  const mirroredSolved = solveRigLocalRotation({
    parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    ...mirroredFixture,
  });
  assert.equal(mirroredSolved.valid, true);
  assert.ok(
    vectorAngleDeg(
      rotateVectorByQuaternion(
        mirroredFixture.restPrimaryAxisLocal,
        mirroredSolved.localRotation,
      ),
      mirroredFixture.targetPrimaryWorld,
    ) <= 0.1,
    "mirrored positive/negative rest axes must preserve their world aim",
  );
}

const antipodalRigSolveA = solveRigLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: restPrimary,
  restSecondaryAxisLocal: restSecondary,
  targetPrimaryWorld: transportedA.primary,
  targetSecondaryWorld: transportedA.secondary,
});
const antipodalRigSolveB = solveRigLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: restPrimary,
  restSecondaryAxisLocal: restSecondary,
  targetPrimaryWorld: transportedB.primary,
  targetSecondaryWorld: transportedB.secondary,
  previousLocalRotation: antipodalRigSolveA.localRotation,
});

assert.equal(antipodalRigSolveA.mode, "full-basis");
assert.equal(antipodalRigSolveB.mode, "full-basis");
assert.ok(
  quaternionAngleDeg(antipodalRigSolveA.localRotation, antipodalRigSolveB.localRotation) <= 25,
  "a causal secondary basis must keep the rig-local solve continuous near antipodal aim",
);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(restPrimary, antipodalRigSolveB.localRotation),
    transportedB.primary,
  ) <= 0.1,
  "near-antipodal full-basis solve must preserve the primary target",
);

const negativeHemisphereReference = negateQuaternion(antipodalRigSolveB.localRotation);
const signEquivalentSolved = solveRigLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: -1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: restPrimary,
  restSecondaryAxisLocal: restSecondary,
  targetPrimaryWorld: transportedB.primary,
  targetSecondaryWorld: transportedB.secondary,
  previousLocalRotation: negativeHemisphereReference,
});

assert.ok(
  quaternionDot(signEquivalentSolved.localRotation, negativeHemisphereReference) >= 0.999999,
  "physically equivalent q/-q inputs must return the hemisphere nearest previousLocalRotation",
);
assert.ok(
  quaternionAngleDeg(signEquivalentSolved.localRotation, antipodalRigSolveB.localRotation) <= 0.000001,
  "hemisphere canonicalization must not change the physical rotation",
);

const degenerateSecondaryFallback = solveRigLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: restPrimary,
  restSecondaryAxisLocal: restSecondary,
  targetPrimaryWorld: ordinaryTargetWorld,
  targetSecondaryWorld: ordinaryTargetWorld,
});
assert.equal(
  degenerateSecondaryFallback.mode,
  "primary-swing",
  "a degenerate optional secondary must preserve ordinary primary-swing behavior",
);

const identityBasisTransport = resolveBasisTransportRotation({
  sourcePrimary: { x: 1, y: 0, z: 0 },
  sourceSecondary: { x: 0, y: 1, z: 0 },
  targetPrimary: { x: 1, y: 0, z: 0 },
  targetSecondary: { x: 0, y: 1, z: 0 },
});
assert.equal(identityBasisTransport.valid, true);
assert.ok(
  quaternionAngleDeg(
    identityBasisTransport.rotation,
    { x: 0, y: 0, z: 0, w: 1 },
  ) <= 0.000001,
  "identical palm bases must not rotate finger articulation",
);

const quarterTurnBasisTransport = resolveBasisTransportRotation({
  sourcePrimary: { x: 1, y: 0, z: 0 },
  sourceSecondary: { x: 0, y: 1, z: 0 },
  targetPrimary: { x: 0, y: 1, z: 0 },
  targetSecondary: { x: -1, y: 0, z: 0 },
});
assert.equal(quarterTurnBasisTransport.valid, true);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(
      { x: 1, y: 0, z: 0 },
      quarterTurnBasisTransport.rotation,
    ),
    { x: 0, y: 1, z: 0 },
  ) <= 0.000001,
  "basis transport must carry the detector primary into the avatar primary",
);

const detectorGlobalRotation = quaternionFromAxisAngle(
  normalizeVector({ x: 0.3, y: 0.7, z: -0.2 }),
  degToRad(73),
);
const detectorSegment = normalizeVector({ x: 0.25, y: 0.88, z: -0.4 });
const rotatedDetectorPrimary = rotateVectorByQuaternion(
  { x: 1, y: 0, z: 0 },
  detectorGlobalRotation,
);
const rotatedDetectorSecondary = rotateVectorByQuaternion(
  { x: 0, y: 1, z: 0 },
  detectorGlobalRotation,
);
const rotatedDetectorSegment = rotateVectorByQuaternion(
  detectorSegment,
  detectorGlobalRotation,
);
const invariantBasisTransport = resolveBasisTransportRotation({
  sourcePrimary: rotatedDetectorPrimary,
  sourceSecondary: rotatedDetectorSecondary,
  targetPrimary: { x: 1, y: 0, z: 0 },
  targetSecondary: { x: 0, y: 1, z: 0 },
});
assert.equal(invariantBasisTransport.valid, true);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(rotatedDetectorSegment, invariantBasisTransport.rotation),
    detectorSegment,
  ) <= 0.000001,
  "global detector palm rotation must cancel before finger articulation is applied",
);

const invalidBasisTransport = resolveBasisTransportRotation({
  sourcePrimary: { x: 1, y: 0, z: 0 },
  sourceSecondary: { x: 2, y: 0, z: 0 },
  targetPrimary: { x: 1, y: 0, z: 0 },
  targetSecondary: { x: 0, y: 1, z: 0 },
});
assert.equal(invalidBasisTransport.valid, false);
assert.equal(invalidBasisTransport.reason, "invalid-source-basis");

const xbotRigAxis = deriveRigSecondaryAxisLocal({
  primaryAxisLocal: { x: 1, y: 0, z: 0 },
  boneRestWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  semanticSecondaryWorld: { x: 0, y: 1, z: 0 },
});
assert.equal(xbotRigAxis.valid, true);
assert.deepEqual(roundVector(xbotRigAxis.secondaryAxisLocal), { x: 0, y: 1, z: 0 });
assert.deepEqual(roundVector(xbotRigAxis.hingeAxisLocal), { x: 0, y: 0, z: 1 });

const soldierLeftWorld = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, degToRad(90));
const soldierRightWorld = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, degToRad(-90));
const soldierLeftRigAxis = deriveRigSecondaryAxisLocal({
  primaryAxisLocal: { x: 0, y: 1, z: 0 },
  boneRestWorldRotation: soldierLeftWorld,
  semanticSecondaryWorld: { x: 0, y: 1, z: 0 },
});
const soldierRightRigAxis = deriveRigSecondaryAxisLocal({
  primaryAxisLocal: { x: 0, y: 1, z: 0 },
  boneRestWorldRotation: soldierRightWorld,
  semanticSecondaryWorld: { x: 0, y: 1, z: 0 },
});

for (const [worldRotation, rigAxis] of [
  [soldierLeftWorld, soldierLeftRigAxis],
  [soldierRightWorld, soldierRightRigAxis],
]) {
  assert.equal(rigAxis.valid, true);
  assert.ok(
    vectorAngleDeg(
      rotateVectorByQuaternion(rigAxis.secondaryAxisLocal, worldRotation),
      { x: 0, y: 1, z: 0 },
    ) <= 0.000001,
    "Soldier pre-rotations must still resolve a shared avatar-up secondary",
  );
}
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(soldierLeftRigAxis.hingeAxisLocal, soldierLeftWorld),
    multiplyVector(
      rotateVectorByQuaternion(soldierRightRigAxis.hingeAxisLocal, soldierRightWorld),
      -1,
    ),
  ) <= 0.000001,
  "Soldier left/right hinge axes must mirror in world space",
);

const polydancerWorld = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, degToRad(180));
const polydancerRigAxis = deriveRigSecondaryAxisLocal({
  primaryAxisLocal: { x: -1, y: 0, z: 0 },
  boneRestWorldRotation: polydancerWorld,
  semanticSecondaryWorld: { x: 0, y: 1, z: 0 },
});
assert.equal(polydancerRigAxis.valid, true);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion(polydancerRigAxis.secondaryAxisLocal, polydancerWorld),
    { x: 0, y: 1, z: 0 },
  ) <= 0.000001,
  "VRM0 yaw normalization must preserve the semantic avatar-up secondary",
);

const chainUpperPrimary = normalizeVector({ x: 0.62, y: 0.7, z: -0.35 });
const chainUpperSecondary = normalizeVector({ x: -0.18, y: 0.55, z: 0.82 });
const chainLowerPrimary = normalizeVector({ x: 0.2, y: -0.42, z: -0.88 });
const chainUpperSolve = solveRigLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: chainUpperPrimary,
  targetSecondaryWorld: chainUpperSecondary,
});
const chainLowerSolve = solveRigLocalRotation({
  parentWorldRotation: chainUpperSolve.localRotation,
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  targetPrimaryWorld: chainLowerPrimary,
});
const chainLowerWorld = multiplyQuaternions(
  chainUpperSolve.localRotation,
  chainLowerSolve.localRotation,
);

assert.equal(chainUpperSolve.mode, "full-basis");
assert.equal(chainLowerSolve.mode, "primary-swing");
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, chainUpperSolve.localRotation),
    chainUpperPrimary,
  ) <= 0.1,
  "the parent full-basis solve must preserve the upper segment direction",
);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, chainLowerWorld),
    chainLowerPrimary,
  ) <= 0.1,
  "the child primary solve must preserve its world endpoint direction after parent twist",
);

const zeroFlexRest = quaternionFromAxisAngle(
  normalizeVector({ x: 0.3, y: -0.4, z: 0.8 }),
  degToRad(38),
);
const zeroFlexSolved = solveRigHingeLocalRotation({
  restLocalRotation: zeroFlexRest,
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  flexDeg: 0,
});

assert.equal(zeroFlexSolved.valid, true);
assert.equal(zeroFlexSolved.mode, "hinge-flexion");
assert.equal(zeroFlexSolved.flexDeg, 0);
assert.deepEqual(roundVector(zeroFlexSolved.hingeAxisLocal), { x: 0, y: 0, z: 1 });
assert.ok(
  quaternionAngleDeg(zeroFlexSolved.localRotation, zeroFlexRest) <= 0.000001,
  "zero hinge flexion must return the absolute rest-local rotation",
);

const hingePrimary = normalizeVector({ x: 1, y: 1, z: 0 });
const hingeSecondary = normalizeVector({ x: -1, y: 1, z: 0.5 });
const hingeAxis = normalizeVector(crossVectors(hingePrimary, hingeSecondary));
const nonidentityHingeRest = quaternionFromAxisAngle(
  normalizeVector({ x: -0.2, y: 0.7, z: 0.4 }),
  degToRad(47),
);
const nonidentityHingeSolved = solveRigHingeLocalRotation({
  restLocalRotation: nonidentityHingeRest,
  restPrimaryAxisLocal: hingePrimary,
  restSecondaryAxisLocal: hingeSecondary,
  flexDeg: 63,
});
const expectedNonidentityHinge = multiplyQuaternions(
  nonidentityHingeRest,
  quaternionFromAxisAngle(hingeAxis, degToRad(63)),
);
const nonidentityRestPrimaryParent = rotateVectorByQuaternion(
  hingePrimary,
  nonidentityHingeRest,
);
const nonidentityBentPrimaryParent = rotateVectorByQuaternion(
  hingePrimary,
  nonidentityHingeSolved.localRotation,
);

assert.equal(nonidentityHingeSolved.valid, true);
assert.equal(nonidentityHingeSolved.flexDeg, 63);
assert.ok(
  vectorAngleDeg(nonidentityHingeSolved.hingeAxisLocal, hingeAxis) <= 0.000001,
  "the hinge axis must come from the rig-local primary/secondary cross product",
);
assert.ok(
  quaternionAngleDeg(nonidentityHingeSolved.localRotation, expectedNonidentityHinge) <= 0.000001,
  "non-identity rest must use restLocalRotation * axisAngle(hinge,+flex)",
);
assert.ok(
  Math.abs(vectorAngleDeg(nonidentityRestPrimaryParent, nonidentityBentPrimaryParent) - 63) <= 0.000001,
  "a bone-local hinge must reconstruct the requested flex after a non-identity rest transform",
);

const mirroredFlexDeg = 52;
const leftMirroredHinge = solveRigHingeLocalRotation({
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  flexDeg: mirroredFlexDeg,
});
const rightMirroredHinge = solveRigHingeLocalRotation({
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: -1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  flexDeg: mirroredFlexDeg,
});
const leftMirroredBent = rotateVectorByQuaternion(
  { x: 1, y: 0, z: 0 },
  leftMirroredHinge.localRotation,
);
const rightMirroredBent = rotateVectorByQuaternion(
  { x: -1, y: 0, z: 0 },
  rightMirroredHinge.localRotation,
);

assert.deepEqual(roundVector(leftMirroredHinge.hingeAxisLocal), { x: 0, y: 0, z: 1 });
assert.deepEqual(roundVector(rightMirroredHinge.hingeAxisLocal), { x: 0, y: 0, z: -1 });
assert.ok(
  Math.abs(vectorAngleDeg({ x: 1, y: 0, z: 0 }, leftMirroredBent) - mirroredFlexDeg) <= 0.000001,
  "left positive flex must bend by the requested semantic angle",
);
assert.ok(
  Math.abs(vectorAngleDeg({ x: -1, y: 0, z: 0 }, rightMirroredBent) - mirroredFlexDeg) <= 0.000001,
  "right positive flex must bend by the requested semantic angle",
);
assert.ok(leftMirroredBent.y > 0 && rightMirroredBent.y > 0);
assert.ok(Math.abs(leftMirroredBent.x + rightMirroredBent.x) <= 0.000001);
assert.ok(Math.abs(leftMirroredBent.y - rightMirroredBent.y) <= 0.000001);

for (const {
  primary,
  upperDirection,
  bentPrimary,
  expectedHinge,
} of [
  {
    primary: { x: 1, y: 0, z: 0 },
    upperDirection: { x: 1, y: 0, z: 0 },
    bentPrimary: leftMirroredBent,
    expectedHinge: leftMirroredHinge,
  },
  {
    primary: { x: -1, y: 0, z: 0 },
    upperDirection: { x: -1, y: 0, z: 0 },
    bentPrimary: rightMirroredBent,
    expectedHinge: rightMirroredHinge,
  },
]) {
  const shoulderFacing = multiplyVector(upperDirection, -1);
  const bendTangent = normalizeVector(subtractVectors(
    shoulderFacing,
    multiplyVector(bentPrimary, dotVectors(shoulderFacing, bentPrimary)),
  ));
  const bendBasisSolve = solveRigLocalRotation({
    parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: primary,
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    targetPrimaryWorld: bentPrimary,
    targetSecondaryWorld: bendTangent,
  });

  assert.equal(bendBasisSolve.valid, true);
  assert.equal(bendBasisSolve.mode, "full-basis");
  assert.ok(
    vectorAngleDeg(
      rotateVectorByQuaternion(primary, bendBasisSolve.localRotation),
      bentPrimary,
    ) <= 0.000001,
    "forearm bend-tangent basis must preserve the tracked wrist direction",
  );
  assert.ok(
    quaternionAngleDeg(bendBasisSolve.localRotation, expectedHinge.localRotation) <= 0.00001,
    "forearm bend tangent must recover the rig-local semantic hinge rotation",
  );
}

const negativeHingeReference = negateQuaternion(nonidentityHingeSolved.localRotation);
const signEquivalentHinge = solveRigHingeLocalRotation({
  restLocalRotation: negateQuaternion(nonidentityHingeRest),
  restPrimaryAxisLocal: hingePrimary,
  restSecondaryAxisLocal: hingeSecondary,
  flexDeg: 63,
  previousLocalRotation: negativeHingeReference,
});

assert.ok(
  quaternionDot(signEquivalentHinge.localRotation, negativeHingeReference) >= 0.999999,
  "hinge q/-q inputs must return the hemisphere nearest previousLocalRotation",
);
assert.ok(
  quaternionAngleDeg(signEquivalentHinge.localRotation, nonidentityHingeSolved.localRotation) <= 0.000001,
  "hinge hemisphere canonicalization must preserve the physical rotation",
);

const adaptiveAlignedFlexDeg = 60;
const adaptiveAlignedHinge = solveRigHingeLocalRotation({
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  flexDeg: adaptiveAlignedFlexDeg,
});
const adaptiveAlignedTarget = rotateVectorByQuaternion(
  { x: 1, y: 0, z: 0 },
  adaptiveAlignedHinge.localRotation,
);
const adaptiveAlignedSolve = solveRigAdaptiveHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveAlignedTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeConfidence: 1,
});

assert.equal(adaptiveAlignedSolve.valid, true);
assert.equal(adaptiveAlignedSolve.mode, "adaptive-hinge");
assert.ok(adaptiveAlignedSolve.hingeWeight >= 0.999999);
assert.ok(adaptiveAlignedSolve.hingeDirectionErrorDeg <= 0.000001);
assert.ok(adaptiveAlignedSolve.appliedPrimaryErrorDeg <= 0.000001);

const adaptiveConflictingTarget = { x: 0, y: 0, z: 1 };
const adaptiveConflictingSolve = solveRigAdaptiveHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveConflictingTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeConfidence: 1,
});

assert.equal(adaptiveConflictingSolve.valid, true);
assert.equal(adaptiveConflictingSolve.mode, "primary-swing");
assert.equal(adaptiveConflictingSolve.hingeWeight, 0);
assert.ok(adaptiveConflictingSolve.hingeDirectionErrorDeg >= 30);
assert.ok(adaptiveConflictingSolve.appliedPrimaryErrorDeg <= 0.000001);

const endpointPreservingAligned = solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveAlignedTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeReliableFlexStartDeg: 0,
  hingeReliableFlexFullDeg: adaptiveAlignedFlexDeg,
  hingeFullWeightCorrectionDeg: 30,
  hingeZeroWeightCorrectionDeg: 90,
});
assert.equal(endpointPreservingAligned.valid, true);
assert.equal(endpointPreservingAligned.mode, "endpoint-preserving-hinge");
assert.ok(endpointPreservingAligned.hingeCorrectionDeg <= 0.000001);
assert.ok(endpointPreservingAligned.hingeFlexReliability >= 0.999999);
assert.ok(endpointPreservingAligned.appliedPrimaryErrorDeg <= 0.000001);
assert.ok(
  quaternionAngleDeg(
    endpointPreservingAligned.localRotation,
    adaptiveAlignedHinge.localRotation,
  ) <= 0.000001,
  "an already aligned hinge must not receive an extra correction",
);

const endpointParentWorld = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, degToRad(27));
const endpointHingeWorld = multiplyQuaternions(
  endpointParentWorld,
  adaptiveAlignedHinge.localRotation,
);
const endpointHingePrimary = rotateVectorByQuaternion(
  { x: 1, y: 0, z: 0 },
  endpointHingeWorld,
);
const endpointCorrectionAxis = normalizeVector(crossVectors(
  endpointHingePrimary,
  { x: 0, y: 0, z: 1 },
));
const endpointIntermediateTarget = rotateVectorByQuaternion(
  endpointHingePrimary,
  quaternionFromAxisAngle(endpointCorrectionAxis, degToRad(60)),
);
const endpointPreservingIntermediate = solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation: endpointParentWorld,
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: endpointIntermediateTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeReliableFlexStartDeg: 0,
  hingeReliableFlexFullDeg: adaptiveAlignedFlexDeg,
  hingeFullWeightCorrectionDeg: 30,
  hingeZeroWeightCorrectionDeg: 90,
});
const endpointPreservingWorld = multiplyQuaternions(
  endpointParentWorld,
  endpointPreservingIntermediate.localRotation,
);
assert.equal(endpointPreservingIntermediate.valid, true);
assert.equal(endpointPreservingIntermediate.mode, "endpoint-preserving-hinge");
assert.ok(Math.abs(endpointPreservingIntermediate.hingeCorrectionDeg - 60) <= 0.000001);
assert.ok(Math.abs(endpointPreservingIntermediate.hingeWeight - 0.5) <= 0.000001);
assert.ok(endpointPreservingIntermediate.hingeFlexReliability >= 0.999999);
assert.ok(endpointPreservingIntermediate.appliedPrimaryErrorDeg <= 0.000001);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, endpointPreservingWorld),
    endpointIntermediateTarget,
  ) <= 0.000001,
  "an intermediate endpoint-preserving blend must align the rig primary under a rotated parent",
);

const endpointUnobservableFlex = solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveAlignedTarget,
  flexDeg: 30,
});
assert.equal(endpointUnobservableFlex.valid, true);
assert.equal(endpointUnobservableFlex.mode, "primary-swing");
assert.equal(endpointUnobservableFlex.hingeWeight, 0);
assert.equal(endpointUnobservableFlex.hingeFlexReliability, 0);
assert.equal(endpointUnobservableFlex.hingeReason, "unobservable-hinge-flex");
assert.ok(endpointUnobservableFlex.appliedPrimaryErrorDeg <= 0.000001);

const endpointConfidenceContinuity = [0.499, 0.5].map((hingeConfidence) =>
  solveRigEndpointPreservingHingeLocalRotation({
    parentWorldRotation: endpointParentWorld,
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    targetPrimaryWorld: endpointIntermediateTarget,
    flexDeg: adaptiveAlignedFlexDeg,
    hingeConfidence,
    hingeReliableFlexStartDeg: 0,
    hingeReliableFlexFullDeg: adaptiveAlignedFlexDeg,
    hingeFullWeightCorrectionDeg: 30,
    hingeZeroWeightCorrectionDeg: 90,
  })
);
assert.ok(
  Math.abs(
    endpointConfidenceContinuity[1].hingeWeight -
    endpointConfidenceContinuity[0].hingeWeight,
  ) <= 0.000501,
);
assert.ok(
  quaternionAngleDeg(
    endpointConfidenceContinuity[0].localRotation,
    endpointConfidenceContinuity[1].localRotation,
  ) < 0.1,
  "a 0.499 to 0.500 confidence crossing must not create a discrete hinge twist jump",
);

const endpointOpposedTarget = multiplyVector(endpointHingePrimary, -1);
const endpointPreservingOpposed = solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation: endpointParentWorld,
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: endpointOpposedTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeReliableFlexStartDeg: 0,
  hingeReliableFlexFullDeg: adaptiveAlignedFlexDeg,
});
const endpointOpposedWorld = multiplyQuaternions(
  endpointParentWorld,
  endpointPreservingOpposed.localRotation,
);
assert.equal(endpointPreservingOpposed.mode, "primary-swing");
assert.equal(endpointPreservingOpposed.hingeWeight, 0);
assert.equal(endpointPreservingOpposed.hingeReason, "hinge-correction-opposed");
assert.ok(endpointPreservingOpposed.hingeCorrectionDeg >= 179.999);
assert.ok(
  vectorAngleDeg(
    rotateVectorByQuaternion({ x: 1, y: 0, z: 0 }, endpointOpposedWorld),
    endpointOpposedTarget,
  ) <= 0.000001,
  "an opposed hinge prior must fall back without losing the observed endpoint",
);

const nearAntipodalEndpointSolves = [0.002, 0.001].map((epsilon) =>
  solveRigEndpointPreservingHingeLocalRotation({
    parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    targetPrimaryWorld: normalizeVector({ x: epsilon, y: -1, z: 0 }),
    flexDeg: 90,
  })
);
assert.ok(nearAntipodalEndpointSolves.every((solved) => solved.mode === "primary-swing"));
assert.ok(nearAntipodalEndpointSolves.every((solved) => solved.hingeWeight === 0));
assert.ok(
  quaternionAngleDeg(
    nearAntipodalEndpointSolves[0].localRotation,
    nearAntipodalEndpointSolves[1].localRotation,
  ) < 0.1,
  "a sub-degree target perturbation near an opposed hinge must not create a 180-degree quaternion branch",
);

const endpointPreservingInvalidHinge = solveRigEndpointPreservingHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveConflictingTarget,
  flexDeg: null,
});
assert.equal(endpointPreservingInvalidHinge.valid, true);
assert.equal(endpointPreservingInvalidHinge.mode, "primary-swing");
assert.equal(endpointPreservingInvalidHinge.hingeReason, "invalid-flex-deg");
assert.ok(endpointPreservingInvalidHinge.appliedPrimaryErrorDeg <= 0.000001);

const adaptiveLowConfidenceSolve = solveRigAdaptiveHingeLocalRotation({
  parentWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
  restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
  restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
  restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  targetPrimaryWorld: adaptiveAlignedTarget,
  flexDeg: adaptiveAlignedFlexDeg,
  hingeConfidence: 0,
});

assert.equal(adaptiveLowConfidenceSolve.valid, true);
assert.equal(adaptiveLowConfidenceSolve.mode, "primary-swing");
assert.equal(adaptiveLowConfidenceSolve.hingeWeight, 0);
assert.ok(adaptiveLowConfidenceSolve.appliedPrimaryErrorDeg <= 0.000001);

for (const [options, expectedReason] of [
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 0 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    flexDeg: 30,
  }, "invalid-rest-local-rotation"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 0, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    flexDeg: 30,
  }, "invalid-rest-primary-axis"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: null,
    flexDeg: 30,
  }, "invalid-rest-secondary-axis"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 2, y: 0, z: 0 },
    flexDeg: 30,
  }, "degenerate-rest-hinge-basis"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    flexDeg: Number.NaN,
  }, "invalid-flex-deg"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
  }, "invalid-flex-deg"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    flexDeg: -0.01,
  }, "flex-deg-out-of-range"],
  [{
    restLocalRotation: { x: 0, y: 0, z: 0, w: 1 },
    restPrimaryAxisLocal: { x: 1, y: 0, z: 0 },
    restSecondaryAxisLocal: { x: 0, y: 1, z: 0 },
    flexDeg: 180.01,
  }, "flex-deg-out-of-range"],
]) {
  const invalidHinge = solveRigHingeLocalRotation(options);
  assert.equal(invalidHinge.valid, false);
  assert.equal(invalidHinge.mode, "unavailable");
  assert.equal(invalidHinge.reason, expectedReason);
  assert.equal(invalidHinge.localRotation, null);
}

let contactState = createPlantedFootContactState("Left");
const stationaryContactSample = (timestampMs, extras = {}) => ({
  timestampMs,
  rawWorld: { x: 0.2, y: 0.04, z: 0.1 },
  floorY: 0.04,
  rigFloorY: 0.04,
  avatarHeight: 2,
  confidence: 0.9,
  enabled: true,
  ...extras,
});

contactState = updatePlantedFootContact(contactState, stationaryContactSample(0));
contactState = updatePlantedFootContact(contactState, stationaryContactSample(40));
assert.equal(contactState.phase, "candidate");
assert.equal(contactState.candidateSamples, 1);
contactState = updatePlantedFootContact(contactState, stationaryContactSample(80));
assert.equal(contactState.phase, "candidate");
contactState = updatePlantedFootContact(contactState, stationaryContactSample(140));
assert.equal(contactState.phase, "planted", "100ms and three causal samples must confirm contact");
assert.ok(Math.abs(contactState.anchorWorld.x - 0.2) <= 0.000001);
assert.ok(Math.abs(contactState.anchorWorld.y - 0.04) <= 0.000001);
assert.ok(Math.abs(contactState.anchorWorld.z - 0.1) <= 0.000001);

const unownedPlantRelease = releasePlantedFootContact(
  contactState,
  "ik-unreachable",
  150,
  { rawWorld: contactState.previousRawWorld },
);
assert.equal(
  unownedPlantRelease.directionBlend,
  1,
  "an anchor that never reached IK ownership must fail closed without freezing the raw direction owner",
);

const ownedPlantRelease = releasePlantedFootContact(
  { ...contactState, ikApplied: true },
  "foot-motion",
  150,
  { rawWorld: contactState.previousRawWorld },
);
assert.equal(ownedPlantRelease.directionBlend, 0);

const driftRelease = updatePlantedFootContact(
  { ...contactState, ikApplied: true },
  stationaryContactSample(180, {
    rawWorld: { x: 0.221, y: 0.04, z: 0.1 },
  }),
);
assert.equal(
  driftRelease.phase,
  "moving",
  "a planted chain must not freeze raw ground-plane motion beyond its correction trust region",
);
assert.equal(driftRelease.releaseReason, "anchor-drift");
assert.ok(driftRelease.groundPlaneAnchorDriftHeightRatio > 0.01);
assert.equal(driftRelease.directionBlend, 0);

contactState = updatePlantedFootContact(
  { ...contactState, ikApplied: true },
  stationaryContactSample(180, {
    rawWorld: { x: 0.2, y: 0.22, z: 0.1 },
  }),
);
assert.equal(contactState.phase, "moving", "a lifted foot must release in the same frame");
assert.equal(contactState.releaseReason, "foot-lift");
assert.equal(contactState.anchorWorld, null);
assert.equal(contactState.directionBlend, 0);

contactState = updatePlantedFootContact(contactState, stationaryContactSample(220, {
  rawWorld: { x: 0.2, y: 0.22, z: 0.1 },
}));
assert.ok(contactState.directionBlend > 0 && contactState.directionBlend < 1);

let translatingCandidate = createPlantedFootContactState("Left");
translatingCandidate = updatePlantedFootContact(
  translatingCandidate,
  stationaryContactSample(0, { rawWorld: { x: 0.1856, y: 0.04, z: 0.1 } }),
);
translatingCandidate = updatePlantedFootContact(
  translatingCandidate,
  stationaryContactSample(40, { rawWorld: { x: 0.1996, y: 0.04, z: 0.1 } }),
);
translatingCandidate = updatePlantedFootContact(
  translatingCandidate,
  stationaryContactSample(80, { rawWorld: { x: 0.2136, y: 0.04, z: 0.1 } }),
);
translatingCandidate = updatePlantedFootContact(
  translatingCandidate,
  stationaryContactSample(150, { rawWorld: { x: 0.2386, y: 0.04, z: 0.1 } }),
);
assert.equal(translatingCandidate.phase, "moving");
assert.equal(translatingCandidate.releaseReason, "anchor-drift");
assert.equal(
  translatingCandidate.directionBlend,
  1,
  "a translating candidate must fail closed before it ever takes IK ownership",
);

let gapState = createPlantedFootContactState("Right");
gapState = updatePlantedFootContact(gapState, stationaryContactSample(0));
gapState = updatePlantedFootContact(gapState, stationaryContactSample(40));
gapState = updatePlantedFootContact(gapState, stationaryContactSample(151));
assert.equal(gapState.phase, "moving");
assert.equal(gapState.releaseReason, "timestamp-gap");
assert.equal(gapState.candidateSamples, 0);

const positivePoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0.6, y: -0.8, z: 0 },
  end: { x: 0, y: -1.6, z: 0 },
  target: { x: 0, y: -1.6, z: 0 },
  fallbackPole: { x: -1, y: 0, z: 0 },
  maxReachError: 0.01,
});
const negativePoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: -0.6, y: -0.8, z: 0 },
  end: { x: 0, y: -1.6, z: 0 },
  target: { x: 0, y: -1.6, z: 0 },
  maxReachError: 0.01,
});

assert.equal(positivePoleSolve.valid, true);
assert.equal(positivePoleSolve.reachable, true);
assert.equal(positivePoleSolve.poleSource, "source-knee");
assert.equal(negativePoleSolve.valid, true);
assert.ok(positivePoleSolve.kneeTarget.x > 0.5, "the signed source pole must keep the positive knee branch");
assert.ok(negativePoleSolve.kneeTarget.x < -0.5, "the mirrored signed pole must keep the negative knee branch");

const previousPoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0, y: -1, z: 1e-12 },
  end: { x: 0, y: -2, z: 0 },
  target: { x: 0, y: -1.99, z: 0 },
  previousPole: { x: 1, y: 0, z: 0 },
  fallbackPole: { x: -1, y: 0, z: 0 },
  maxReachError: 0.01,
});
assert.equal(previousPoleSolve.valid, true);
assert.equal(previousPoleSolve.poleSource, "previous-pole");
assert.ok(previousPoleSolve.kneeTarget.x > 0, "near-straight contact must retain the previous pole sign");

const positiveFallbackPoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0, y: -1, z: 1e-12 },
  end: { x: 0, y: -2, z: 0 },
  target: { x: 0, y: -1.99, z: 0 },
  fallbackPole: { x: 1, y: -1, z: 0 },
  maxReachError: 0.01,
});
const negativeFallbackPoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0, y: -1, z: -1e-12 },
  end: { x: 0, y: -2, z: 0 },
  target: { x: 0, y: -1.99, z: 0 },
  fallbackPole: { x: -1, y: -1, z: 0 },
  maxReachError: 0.01,
});
assert.equal(positiveFallbackPoleSolve.valid, true);
assert.equal(positiveFallbackPoleSolve.reachable, true);
assert.equal(positiveFallbackPoleSolve.poleSource, "fallback-pole");
assert.ok(positiveFallbackPoleSolve.kneeTarget.x > 0, "the rig fallback must preserve the positive knee branch");
assert.equal(negativeFallbackPoleSolve.valid, true);
assert.equal(negativeFallbackPoleSolve.reachable, true);
assert.equal(negativeFallbackPoleSolve.poleSource, "fallback-pole");
assert.ok(negativeFallbackPoleSolve.kneeTarget.x < 0, "the mirrored rig fallback must preserve the negative knee branch");

const collinearFallbackPoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0, y: -1, z: 1e-12 },
  end: { x: 0, y: -2, z: 0 },
  target: { x: 0, y: -1.99, z: 0 },
  fallbackPole: { x: 0, y: -1, z: 0 },
  maxReachError: 0.01,
});
assert.equal(collinearFallbackPoleSolve.valid, false);
assert.equal(collinearFallbackPoleSolve.reason, "degenerate-pole");

const invalidFallbackPoleSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0, y: -1, z: 1e-12 },
  end: { x: 0, y: -2, z: 0 },
  target: { x: 0, y: -1.99, z: 0 },
  fallbackPole: { x: Number.NaN, y: 0, z: 0 },
  maxReachError: 0.01,
});
assert.equal(invalidFallbackPoleSolve.valid, false);
assert.equal(invalidFallbackPoleSolve.reason, "degenerate-pole");

const unequalLengthSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0.6, y: -0.8, z: 0 },
  end: { x: 0.6, y: -1.4, z: 0 },
  target: { x: 0, y: -1.2, z: 0 },
  maxReachError: 0.01,
});
assert.equal(unequalLengthSolve.valid, true);
assert.equal(unequalLengthSolve.reachable, true);
assert.ok(Math.abs(unequalLengthSolve.upperLength - 1) <= 0.000001);
assert.ok(Math.abs(unequalLengthSolve.lowerLength - 0.6) <= 0.000001);

const unreachableSolve = solveSignedPoleTwoBone({
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0.6, y: -0.8, z: 0 },
  end: { x: 0, y: -1.6, z: 0 },
  target: { x: 0, y: -3, z: 0 },
  maxReachError: 0.01,
});
assert.equal(unreachableSolve.valid, true);
assert.equal(unreachableSolve.reachable, false, "an unreachable anchor must fail closed in the renderer");
assert.ok(unreachableSolve.reachError > 0.9);

const boundedRootCorrectionFixture = {
  root: { x: 0, y: 0, z: 0 },
  mid: { x: 0.6, y: -0.8, z: 0 },
  end: { x: 0, y: -1.6, z: 0 },
  target: { x: 0, y: -2.005, z: 0 },
  maxReachError: 0.0004,
};
const boundedRootCorrectionSolve = solveSignedPoleTwoBone(boundedRootCorrectionFixture);
const boundedRootCorrection = resolveBoundedTwoBoneRootCorrection({
  solution: boundedRootCorrectionSolve,
  anchorWorld: boundedRootCorrectionFixture.target,
  maxCorrection: 0.02,
});

assert.equal(boundedRootCorrectionSolve.valid, true);
assert.equal(boundedRootCorrectionSolve.reachable, false);
assert.ok(boundedRootCorrection);
assert.ok(boundedRootCorrection.y < 0, "the root correction must move toward the lower planted anchor");
assert.ok(vectorLength(boundedRootCorrection) <= 0.02);
assert.ok(
  vectorDistance(
    boundedRootCorrection,
    subtractVectors(
      boundedRootCorrectionFixture.target,
      boundedRootCorrectionSolve.ankleTarget,
    ),
  ) <= 0.000000001,
  "the bounded correction must be exactly anchorWorld minus the solver's clamped ankleTarget",
);

const correctedRootSolve = solveSignedPoleTwoBone({
  ...boundedRootCorrectionFixture,
  root: addVectors(boundedRootCorrectionFixture.root, boundedRootCorrection),
  mid: addVectors(boundedRootCorrectionFixture.mid, boundedRootCorrection),
  end: addVectors(boundedRootCorrectionFixture.end, boundedRootCorrection),
});
assert.equal(correctedRootSolve.valid, true);
assert.equal(correctedRootSolve.reachable, true);
assert.ok(correctedRootSolve.reachError <= 0.000000001);
assert.ok(
  vectorDistance(correctedRootSolve.ankleTarget, boundedRootCorrectionFixture.target) <= 0.000000001,
  "translating the chain by anchor minus clamped ankleTarget must make the exact anchor reachable",
);

assert.equal(resolveBoundedTwoBoneRootCorrection({
  solution: positivePoleSolve,
  anchorWorld: positivePoleSolve.ankleTarget,
  maxCorrection: 0.02,
}), null, "an already reachable solve must not move the root");
assert.equal(resolveBoundedTwoBoneRootCorrection({
  solution: collinearFallbackPoleSolve,
  anchorWorld: { x: 0, y: -1.99, z: 0 },
  maxCorrection: 0.02,
}), null, "an invalid solve must fail closed");
assert.equal(resolveBoundedTwoBoneRootCorrection({
  solution: unreachableSolve,
  anchorWorld: { x: 0, y: -3, z: 0 },
  maxCorrection: 0.02,
}), null, "a correction outside the existing contact trust region must fail closed");

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

function quaternionFromUnitVectorsForTest(from, to) {
  const source = normalizeVector(from);
  const target = normalizeVector(to);
  const dot = Math.min(1, Math.max(-1, dotVectors(source, target)));
  const cross = crossVectors(source, target);
  return normalizeQuaternion({
    x: cross.x,
    y: cross.y,
    z: cross.z,
    w: 1 + dot,
  });
}

function quaternionFromAxisAngle(axis, angle) {
  const normalizedAxis = normalizeVector(axis);
  const half = angle / 2;
  const scale = Math.sin(half);
  return normalizeQuaternion({
    x: normalizedAxis.x * scale,
    y: normalizedAxis.y * scale,
    z: normalizedAxis.z * scale,
    w: Math.cos(half),
  });
}

function multiplyQuaternions(left, right) {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function invertQuaternion(value) {
  const normalized = normalizeQuaternion(value);
  return {
    x: -normalized.x,
    y: -normalized.y,
    z: -normalized.z,
    w: normalized.w,
  };
}

function negateQuaternion(value) {
  return { x: -value.x, y: -value.y, z: -value.z, w: -value.w };
}

function quaternionDot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w;
}

function quaternionFromBasis(primary, secondary) {
  const xAxis = normalizeVector(primary);
  const yAxis = normalizeVector(subtractVectors(
    secondary,
    multiplyVector(xAxis, dotVectors(secondary, xAxis)),
  ));
  const zAxis = normalizeVector(crossVectors(xAxis, yAxis));
  const m11 = xAxis.x;
  const m12 = yAxis.x;
  const m13 = zAxis.x;
  const m21 = xAxis.y;
  const m22 = yAxis.y;
  const m23 = zAxis.y;
  const m31 = xAxis.z;
  const m32 = yAxis.z;
  const m33 = zAxis.z;
  const trace = m11 + m22 + m33;
  let quaternion;

  if (trace > 0) {
    const scale = 2 * Math.sqrt(trace + 1);
    quaternion = {
      x: (m32 - m23) / scale,
      y: (m13 - m31) / scale,
      z: (m21 - m12) / scale,
      w: scale / 4,
    };
  } else if (m11 > m22 && m11 > m33) {
    const scale = 2 * Math.sqrt(1 + m11 - m22 - m33);
    quaternion = {
      x: scale / 4,
      y: (m12 + m21) / scale,
      z: (m13 + m31) / scale,
      w: (m32 - m23) / scale,
    };
  } else if (m22 > m33) {
    const scale = 2 * Math.sqrt(1 + m22 - m11 - m33);
    quaternion = {
      x: (m12 + m21) / scale,
      y: scale / 4,
      z: (m23 + m32) / scale,
      w: (m13 - m31) / scale,
    };
  } else {
    const scale = 2 * Math.sqrt(1 + m33 - m11 - m22);
    quaternion = {
      x: (m13 + m31) / scale,
      y: (m23 + m32) / scale,
      z: scale / 4,
      w: (m21 - m12) / scale,
    };
  }

  return normalizeQuaternion(quaternion);
}

function quaternionAngleDeg(a, b) {
  const left = normalizeQuaternion(a);
  const right = normalizeQuaternion(b);
  const dot = Math.abs(
    left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w,
  );
  return radToDeg(2 * Math.acos(Math.min(1, Math.max(-1, dot))));
}

function vectorAngleDeg(a, b) {
  const left = normalizeVector(a);
  const right = normalizeVector(b);
  return radToDeg(Math.acos(Math.min(1, Math.max(-1, dotVectors(left, right)))));
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function normalizeVector(value) {
  const length = Math.hypot(value.x, value.y, value.z) || 1;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}

function dotVectors(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function subtractVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function vectorDistance(a, b) {
  return vectorLength(subtractVectors(a, b));
}

function vectorLength(value) {
  return Math.hypot(value.x, value.y, value.z);
}

function multiplyVector(value, scalar) {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function radToDeg(value) {
  return value * 180 / Math.PI;
}

function roundVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: round(vector.x / length),
    y: round(vector.y / length),
    z: round(vector.z / length),
  };
}

function round(value) {
  const rounded = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}
