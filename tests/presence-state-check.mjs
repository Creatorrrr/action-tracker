#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createPresenceState,
  estimateMotionFramePresenceConfidence,
  updatePresenceState,
} from "../src/presence-state.js";

const state = createPresenceState({
  presentHoldFrames: 2,
  absentHoldFrames: 2,
});

let snapshot = updatePresenceState(state, makeFrame(1));
assert.equal(snapshot.status, "entering");
assert.equal(snapshot.shouldUpdateAvatar, true);
snapshot = updatePresenceState(state, makeFrame(1));
assert.equal(snapshot.status, "present");
assert.equal(snapshot.shouldUpdateAvatar, true);
snapshot = updatePresenceState(state, makeFrame(0));
assert.equal(snapshot.status, "exiting");
assert.equal(snapshot.shouldUpdateAvatar, true);
snapshot = updatePresenceState(state, makeFrame(0));
assert.equal(snapshot.status, "absent");
assert.equal(snapshot.shouldUpdateAvatar, false);
snapshot = updatePresenceState(state, makeFrame(1));
assert.equal(snapshot.status, "entering");
snapshot = updatePresenceState(state, makeFrame(1));
assert.equal(snapshot.status, "present");
assert.equal(snapshot.transitions >= 4, true);

assert.equal(estimateMotionFramePresenceConfidence(makeFrame(0.5, 0.4)), 0.4);
assert.equal(estimateMotionFramePresenceConfidence(makeFrame(0.5, 0.9)), 0.5);
assert.equal(estimateMotionFramePresenceConfidence({ poseLandmarks: [] }), 0);

console.log("Presence state check passed.");

function makeFrame(confidence, detectorScore = Number.NaN) {
  const landmark = { x: 0.5, y: 0.5, z: 0, visibility: confidence, presence: confidence };
  return {
    poseLandmarks: Array.from({ length: 33 }, () => ({ ...landmark })),
    poseWorldLandmarks: Array.from({ length: 33 }, () => ({ ...landmark })),
    sourceMeta: Number.isFinite(detectorScore) ? { detectorScore } : {},
  };
}
