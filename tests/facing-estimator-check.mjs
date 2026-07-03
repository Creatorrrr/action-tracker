#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  classifyFacingYaw,
  estimateFacingState,
  estimateFacingYaw,
  normalizeAngleDeg,
  toLegacyFacing,
} from "../src/solver/facing-estimator.js";

assert.equal(classifyFacingYaw(0), "front");
assert.equal(classifyFacingYaw(59.9), "front");
assert.equal(classifyFacingYaw(90), "side-left");
assert.equal(classifyFacingYaw(-90), "side-right");
assert.equal(classifyFacingYaw(180), "back");
assert.equal(toLegacyFacing("side-left"), "side");
assert.equal(toLegacyFacing("side-right"), "side");

const frontEstimate = estimateFacingYaw(createPoints(0));
assert.equal(frontEstimate.state, "front");
assert.ok(Math.abs(frontEstimate.yawDeg) <= 0.001);
assert.ok(frontEstimate.confidence >= 0.9);

const sideEstimate = estimateFacingYaw(createPoints(90));
assert.equal(sideEstimate.state, "side-right");
assert.ok(Math.abs(Math.abs(sideEstimate.yawDeg) - 90) <= 0.001);

const backEstimate = estimateFacingYaw(createPoints(180));
assert.equal(backEstimate.state, "back");
assert.ok(Math.abs(Math.abs(backEstimate.yawDeg) - 180) <= 0.001);

let state;
const gradualStates = [0, 45, 90, 135, 180].map((yawDeg, index) => {
  state = estimateFacingState(createPoints(yawDeg), state, { timestamp: index * 33.333 });
  return state.legacyState;
});
assert.deepEqual(gradualStates, ["front", "front", "front", "front", "back"]);
assert.ok(Math.abs(Math.abs(state.unwrappedYawDeg) - 180) <= 0.001);

const held = estimateFacingState(createPoints(180, 0.1), state);
assert.equal(held.legacyState, "back");
assert.equal(held.reason, "low_confidence");

let suddenState = estimateFacingState(createPoints(0), undefined, { timestamp: 0 });
suddenState = estimateFacingState(createPoints(180), suddenState, {
  timestamp: 33.333,
  maxYawRateDegPerSec: 360,
});
assert.equal(suddenState.legacyState, "front");
assert.ok(Math.abs(normalizeAngleDeg(suddenState.yawDeg)) > 1);
assert.ok(Math.abs(normalizeAngleDeg(suddenState.yawDeg)) <= 12.1);
assert.equal(Math.abs(suddenState.rawYawDeg), 180);
assert.equal(suddenState.rawYawJump, true);
assert.equal(suddenState.yawFlipCount, 1);
assert.equal(suddenState.sideOrderFlip, true);
assert.equal(Math.abs(suddenState.sideOrderSign), 1);

console.log("Facing estimator check passed.");

function createPoints(yawDeg, visibility = 0.95) {
  const yawRad = yawDeg * Math.PI / 180;
  const rotate = (point) => ({
    x: point.x * Math.cos(yawRad) + point.z * Math.sin(yawRad),
    y: point.y,
    z: -point.x * Math.sin(yawRad) + point.z * Math.cos(yawRad),
    visibility,
  });
  const leftShoulder = rotate({ x: -0.28, y: 1.45, z: 2.1 });
  const rightShoulder = rotate({ x: 0.28, y: 1.45, z: 2.1 });
  const leftHip = rotate({ x: -0.218, y: 0.92, z: 2.05 });
  const rightHip = rotate({ x: 0.218, y: 0.92, z: 2.05 });

  return {
    leftShoulder,
    rightShoulder,
    leftHip,
    rightHip,
    shoulderMid: midpoint(leftShoulder, rightShoulder),
    hipMid: midpoint(leftHip, rightHip),
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}
