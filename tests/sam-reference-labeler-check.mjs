#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMotionRecording, serializeMotionRecordingJsonl } from "../src/motion-frame.js";
import { labelSamReferenceRecording } from "../scripts/sam-reference-labeler.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-sam-labels-"));
const recording = createMotionRecording({
  source: { type: "external-hmr", extractor: "sam3d-body", jointFormat: "mhr70" },
  frames: [
    createFrame({ timestamp: 0, pose: "front" }),
    createFrame({ timestamp: 33.333, pose: "back" }),
    createFrame({ timestamp: 66.667, pose: "front", crossed: true }),
    createFrame({ timestamp: 100, pose: "front", behindLeft: true, lowConf2d: true }),
    createFrame({ timestamp: 133.333, pose: "front", upperBodyOnly: true }),
  ],
});

const labels = labelSamReferenceRecording(recording, { sourceRecording: "synthetic.jsonl" });
assert.equal(labels.version, 1);
assert.equal(labels.frames.length, 5);
assert.equal(labels.frames[0].facingState, "front");
assert.equal(labels.frames[1].facingState, "back");
assert.equal(labels.frames[2].crossedArms, true);
assert.equal(labels.frames[3].leftArm, "behind-back");
assert.equal(labels.frames[3].lowConf2d, true);
assert.equal(labels.frames[4].bodyCoverage, "upper-body");
assert.ok(labels.windows.some((window) => window.kind === "back-facing" && window.startIndex === 1 && window.endIndex === 1));
assert.ok(labels.windows.some((window) => window.kind === "crossed-arms" && window.startIndex === 2));
assert.ok(labels.windows.some((window) => window.kind === "left-behind-back" && window.startIndex === 3));
assert.ok(labels.windows.some((window) => window.kind === "upper-body" && window.startIndex === 4));

const inputPath = path.join(tempDir, "recording.jsonl");
const outputPath = path.join(tempDir, "labels.json");
await writeFile(inputPath, serializeMotionRecordingJsonl(recording));
const cliResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-reference-labeler.mjs"),
  "--input",
  inputPath,
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
const cliSummary = JSON.parse(cliResult.stdout);
assert.equal(cliSummary.status, "passed");
assert.equal(cliSummary.frameCount, 5);
const cliLabels = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(cliLabels.windows.length, labels.windows.length);

console.log("SAM reference labeler check passed.");

function createFrame({
  timestamp,
  pose,
  crossed = false,
  behindLeft = false,
  lowConf2d = false,
  upperBodyOnly = false,
}) {
  const poseWorldLandmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: -1,
    z: 0,
    visibility: 0.01,
    presence: 0.01,
  }));
  const poseLandmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: lowConf2d ? 0.05 : 0.9,
    presence: lowConf2d ? 0.05 : 0.9,
  }));
  const leftSign = pose === "back" ? -1 : 1;
  const rightSign = -leftSign;

  set(poseWorldLandmarks, 11, 0.4 * leftSign, -1.5, 0, 0.9);
  set(poseWorldLandmarks, 12, 0.4 * rightSign, -1.5, 0, 0.9);
  set(poseWorldLandmarks, 13, 0.68 * leftSign, -1.1, 0.02, 0.9);
  set(poseWorldLandmarks, 14, 0.68 * rightSign, -1.1, 0.02, 0.9);
  set(poseWorldLandmarks, 23, 0.22 * leftSign, -1, 0, 0.9);
  set(poseWorldLandmarks, 24, 0.22 * rightSign, -1, 0, 0.9);
  set(poseWorldLandmarks, 25, 0.24 * leftSign, -0.5, 0, upperBodyOnly ? 0.1 : 0.9);
  set(poseWorldLandmarks, 26, 0.24 * rightSign, -0.5, 0, upperBodyOnly ? 0.1 : 0.9);
  set(poseWorldLandmarks, 27, 0.25 * leftSign, 0, 0, upperBodyOnly ? 0.1 : 0.9);
  set(poseWorldLandmarks, 28, 0.25 * rightSign, 0, 0, upperBodyOnly ? 0.1 : 0.9);
  set(poseWorldLandmarks, 15, crossed ? -0.2 : 0.9 * leftSign, -0.8, behindLeft ? 0.2 : 0.02, 0.9);
  set(poseWorldLandmarks, 16, crossed ? 0.2 : 0.9 * rightSign, -0.8, 0.02, 0.9);
  set(poseWorldLandmarks, 0, 0, -1.8, -0.1, 0.9);

  return {
    version: 1,
    timestamp,
    mirrored: false,
    poseLandmarks,
    poseWorldLandmarks,
    leftHandLandmarks: null,
    leftHandWorldLandmarks: null,
    rightHandLandmarks: null,
    rightHandWorldLandmarks: null,
    sourceMeta: {
      videoTime: timestamp / 1000,
    },
    face: null,
  };
}

function set(landmarks, index, x, y, z, visibility) {
  landmarks[index] = {
    x,
    y,
    z,
    visibility,
    presence: visibility,
  };
}
