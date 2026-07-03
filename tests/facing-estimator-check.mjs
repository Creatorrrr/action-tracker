#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  classifyFacingYaw,
  estimateFacingState,
  estimateFacingYaw,
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
const states = [0, 45, 90, 135, 180].map((yawDeg) => {
  state = estimateFacingState(createPoints(yawDeg), state);
  return state.legacyState;
});
assert.deepEqual(states, ["front", "front", "front", "front", "back"]);

const held = estimateFacingState(createPoints(180, 0.1), state);
assert.equal(held.legacyState, "back");
assert.equal(held.reason, "low_confidence");

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
