#!/usr/bin/env node
import assert from "node:assert/strict";
import { validateClipManifest } from "../scripts/validation-cli.mjs";

const validManifest = {
  version: 1,
  labelSchemaVersion: 1,
  scenarios: [
    {
      id: "turn_180",
      description: "turn fixture",
      requiredLabels: ["expectedFacingTimeline", "turnStartMs", "turnEndMs"],
    },
    {
      id: "crossed_arms_elbow_flex",
      description: "hinge fixture",
      requiredLabels: ["jointFlexionTimeline", "hingeLimits"],
    },
  ],
  clips: [
    {
      id: "turn",
      scenario: "turn_180",
      path: "https://example.test/turn.mp4",
      labels: {
        expectedFacingTimeline: [
          { atMs: 0, facing: "front" },
          { atMs: 800, facing: "side" },
          { atMs: 1200, facing: "back" },
        ],
        turnStartMs: 300,
        turnEndMs: 1200,
      },
    },
    {
      id: "fold",
      scenario: "crossed_arms_elbow_flex",
      path: "https://example.test/fold.mp4",
      labels: {
        jointFlexionTimeline: [
          { joint: "leftElbow", atMs: 0, flexDeg: 20 },
          { joint: "leftElbow", atMs: 700, flexDeg: 140 },
        ],
        hingeLimits: {
          leftElbow: { minFlexDeg: 0, maxFlexDeg: 155 },
        },
      },
    },
  ],
};

const validResult = validateClipManifest(validManifest);
assert.deepEqual(validResult.errors, []);
assert.equal(validResult.coveredScenarioCount, 2);

const invalidManifest = {
  ...validManifest,
  clips: [
    {
      id: "bad-turn",
      scenario: "turn_180",
      path: "https://example.test/bad-turn.mp4",
      labels: {
        expectedFacingTimeline: [
          { atMs: -1, facing: "upside-down" },
        ],
        turnStartMs: 1000,
        turnEndMs: 100,
      },
    },
  ],
};

const invalidResult = validateClipManifest(invalidManifest);
assert.ok(invalidResult.errors.some((error) => error.includes("expectedFacingTimeline[0].atMs")));
assert.ok(invalidResult.errors.some((error) => error.includes("expectedFacingTimeline[0].facing")));
assert.ok(invalidResult.errors.some((error) => error.includes("turnEndMs must be >= turnStartMs")));

const unknownLabelResult = validateClipManifest({
  version: 1,
  labelSchemaVersion: 1,
  scenarios: [
    {
      id: "unknown",
      description: "unknown label fixture",
      requiredLabels: ["notARealLabel"],
    },
  ],
  clips: [],
});
assert.ok(unknownLabelResult.errors.some((error) => error.includes("unknown label notARealLabel")));

console.log("Clip manifest check passed.");
