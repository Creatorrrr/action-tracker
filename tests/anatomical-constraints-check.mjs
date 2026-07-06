#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  ANATOMICAL_CONSTRAINTS,
  FINGER_CONSTRAINTS,
  clampDegrees,
  constrainHingeChildDirection,
  constrainFlexionDeg,
  createAnatomyState,
  evaluateHingeFlexion,
  evaluateLowerBodyReliability,
  evaluateTargetCone,
} from "../src/retarget/anatomical-constraints.js";

assert.equal(ANATOMICAL_CONSTRAINTS.LeftForeArm.kind, "hinge");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftLeg.kind, "hinge");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftArm.kind, "swing-cone");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftUpLeg.kind, "swing-cone");
assert.equal(FINGER_CONSTRAINTS.Thumb.length, 4);
assert.equal(FINGER_CONSTRAINTS.default.length, 4);

assert.equal(clampDegrees(170, -5, 155), 155);
assert.equal(clampDegrees(-20, -5, 155), -5);
assert.equal(clampDegrees(90, -5, 155), 90);
assert.equal(clampDegrees(null, -5, 155), -5);
assert.equal(clampDegrees("", -5, 155), -5);

const elbow = evaluateHingeFlexion({
  name: "leftElbow",
  parent: v(0, 0, 0),
  joint: v(1, 0, 0),
  child: v(1, -1, 0),
  minFlexDeg: -5,
  softMaxFlexDeg: 145,
  maxFlexDeg: 155,
});
assert.ok(elbow.flexDeg > 80 && elbow.flexDeg < 100);
assert.equal(elbow.hardViolation, false);

const impossibleKnee = constrainFlexionDeg({
  flexDeg: 178,
  minFlexDeg: -5,
  softMaxFlexDeg: 140,
  maxFlexDeg: 155,
});
assert.equal(impossibleKnee.clampedFlexDeg, 155);
assert.equal(impossibleKnee.hardViolation, true);
assert.equal(impossibleKnee.confidenceScale < 1, true);

const nullFlexion = constrainFlexionDeg({
  flexDeg: null,
  minFlexDeg: -5,
  softMaxFlexDeg: 140,
  maxFlexDeg: 155,
});
assert.deepEqual(nullFlexion, {
  flexDeg: null,
  clampedFlexDeg: null,
  hardViolation: false,
  softViolation: false,
  overflowDeg: 0,
  confidenceScale: 0,
  reason: "invalid_flexion",
});

const emptyStringFlexion = constrainFlexionDeg({
  flexDeg: "",
  minFlexDeg: -5,
  softMaxFlexDeg: 140,
  maxFlexDeg: 155,
});
assert.deepEqual(emptyStringFlexion, {
  flexDeg: null,
  clampedFlexDeg: null,
  hardViolation: false,
  softViolation: false,
  overflowDeg: 0,
  confidenceScale: 0,
  reason: "invalid_flexion",
});

const clampedKneeDirection = constrainHingeChildDirection({
  parent: v(0, 1, 0),
  joint: v(0, 0, 0),
  child: v(0, 1, 0.05),
  clampedFlexDeg: 155,
});
assert.ok(clampedKneeDirection);
assert.equal(round(clampedKneeDirection.y) < 1, true);

const shoulderCone = evaluateTargetCone({
  bone: "LeftArm",
  directionTorsoLocal: { x: -0.98, y: 0.02, z: 0.02 },
  constraint: ANATOMICAL_CONSTRAINTS.LeftArm,
});
assert.equal(shoulderCone.violation, true);
assert.equal(shoulderCone.reason, "cross_body_limit");

const lowerReliable = evaluateLowerBodyReliability({
  points: {
    leftHip: p(0.4, 0.6, 0, 0.99),
    rightHip: p(0.6, 0.6, 0, 0.99),
    leftKnee: p(0.42, 0.35, 0, 0.98),
    rightKnee: p(0.58, 0.35, 0, 0.98),
    leftAnkle: p(0.43, 0.1, 0, 0.98),
    rightAnkle: p(0.57, 0.1, 0, 0.98),
  },
  previous: createAnatomyState(),
  timestamp: 1000,
});
assert.equal(lowerReliable.reliable, true);

const lowerUnreliableAnkle = evaluateLowerBodyReliability({
  points: {
    leftHip: p(0.4, 0.6, 0, 0.99),
    rightHip: p(0.6, 0.6, 0, 0.99),
    leftKnee: p(0.42, 0.35, 0, 0.98),
    rightKnee: p(0.58, 0.35, 0, 0.98),
    leftAnkle: p(0.43, 0.1, 0, 0.1),
    rightAnkle: p(0.57, 0.1, 0, 0.98),
  },
  previous: createAnatomyState(),
  timestamp: 1000,
});
assert.equal(lowerUnreliableAnkle.reliable, false);

const lowerUnreliableSymmetry = evaluateLowerBodyReliability({
  points: {
    leftHip: p(0.4, 0.6, 0, 0.99),
    rightHip: p(0.6, 0.6, 0, 0.99),
    leftKnee: p(0.42, 0.35, 0, 0.98),
    rightKnee: p(0.58, -0.2, 0, 0.98),
    leftAnkle: p(0.43, 0.1, 0, 0.98),
    rightAnkle: p(0.57, -0.9, 0, 0.98),
  },
  previous: createAnatomyState(),
  timestamp: 1000,
});
assert.equal(lowerUnreliableSymmetry.reliable, false);
assert.equal(lowerUnreliableSymmetry.reason, "asymmetric_leg_length");
assert.equal(lowerUnreliableSymmetry.legLengthSymmetry < 0.62, true);

const invalidHinge = evaluateHingeFlexion({
  name: "invalidElbow",
  parent: { x: 0, y: 0 },
  joint: v(1, 0, 0),
  child: v(1, -1, 0),
  minFlexDeg: -5,
  softMaxFlexDeg: 145,
  maxFlexDeg: 155,
});
assert.notEqual(invalidHinge.reason, "ok");
assert.equal(invalidHinge.flexDeg, null);

const nullCoordinateHinge = evaluateHingeFlexion({
  name: "nullCoordinateElbow",
  parent: { x: 0, y: 0, z: null },
  joint: v(1, 0, 0),
  child: v(1, -1, 0),
  minFlexDeg: -5,
  softMaxFlexDeg: 145,
  maxFlexDeg: 155,
});
assert.notEqual(nullCoordinateHinge.reason, "ok");
assert.equal(nullCoordinateHinge.flexDeg, null);

const emptyStringCoordinateHinge = evaluateHingeFlexion({
  name: "emptyStringCoordinateElbow",
  parent: { x: 0, y: 0, z: "" },
  joint: v(1, 0, 0),
  child: v(1, -1, 0),
  minFlexDeg: -5,
  softMaxFlexDeg: 145,
  maxFlexDeg: 155,
});
assert.notEqual(emptyStringCoordinateHinge.reason, "ok");
assert.equal(emptyStringCoordinateHinge.flexDeg, null);

const invalidHingeDirection = constrainHingeChildDirection({
  parent: { x: 0, y: 1, z: null },
  joint: v(0, 0, 0),
  child: v(0, 1, 0.05),
  clampedFlexDeg: 155,
});
assert.equal(invalidHingeDirection, null);

const nullFlexHingeDirection = constrainHingeChildDirection({
  parent: v(0, 1, 0),
  joint: v(0, 0, 0),
  child: v(0, 1, 0.05),
  clampedFlexDeg: null,
});
assert.equal(nullFlexHingeDirection, null);

const emptyStringFlexHingeDirection = constrainHingeChildDirection({
  parent: v(0, 1, 0),
  joint: v(0, 0, 0),
  child: v(0, 1, 0.05),
  clampedFlexDeg: "",
});
assert.equal(emptyStringFlexHingeDirection, null);

assertRangeImmutable(ANATOMICAL_CONSTRAINTS.Head.pitch);
assertRangeImmutable(FINGER_CONSTRAINTS.default[0].flexDeg);
assertRangeImmutable(FINGER_CONSTRAINTS.Thumb[0].abductDeg);

console.log("Anatomical constraints check passed.");

function v(x, y, z) {
  return { x, y, z };
}

function p(x, y, z, visibility) {
  return { x, y, z, visibility, presence: visibility };
}

function round(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertRangeImmutable(range) {
  const before = [...range];
  let threw = false;

  try {
    range[0] = 999;
  } catch {
    threw = true;
  }

  assert.equal(threw || range[0] === before[0], true);
  assert.deepEqual([...range], before);
}
