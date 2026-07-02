#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMotionRecordingJsonl } from "../src/motion-frame.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-hmr-adapter-"));
const inputPath = path.join(tempDir, "coco17.json");
const outputPath = path.join(tempDir, "recording.jsonl");

await writeFile(inputPath, `${JSON.stringify(createCoco17Input(), null, 2)}\n`);

const result = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/hmr-jsonl-adapter.mjs"),
  "--input",
  inputPath,
  "--joint-format",
  "coco17",
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);

const summary = JSON.parse(result.stdout);
assert.equal(summary.status, "passed");
assert.equal(summary.sourceType, "external-hmr");
assert.equal(summary.extractor, "wham");
assert.equal(summary.frameCount, 2);
assert.equal(summary.poseLandmarksPerFrame, 33);
assert.equal(summary.poseWorldLandmarksPerFrame, 33);

const recording = parseMotionRecordingJsonl(await readFile(outputPath, "utf8"));
assert.equal(recording.source.type, "external-hmr");
assert.equal(recording.source.extractor, "wham");
assert.equal(recording.source.jointFormat, "coco17");
assert.equal(recording.frames.length, 2);
assert.equal(recording.frames[0].poseLandmarks.length, 33);
assert.equal(recording.frames[0].poseWorldLandmarks.length, 33);
assert.equal(recording.frames[0].poseWorldLandmarks[11].x, 0.5);
assert.equal(recording.frames[0].poseWorldLandmarks[12].x, -0.5);
assert.equal(recording.frames[0].sourceMeta.mapping, "coco17-to-mediapipe33");
assert.equal(recording.frames[1].timestamp, 33.333333333333336);

console.log("HMR JSONL adapter check passed.");

function createCoco17Input() {
  return {
    source: {
      type: "hmr",
      extractor: "wham",
      videoRef: "sample.mp4",
      fps: 30,
    },
    jointFormat: "coco17",
    frames: [
      {
        frameIndex: 0,
        joints3d: createCoco17Joints(0),
        joints2d: createCoco17Joints(0).map(([x, y, z, visibility]) => [0.5 + x * 0.1, 0.5 - y * 0.1, z, visibility]),
      },
      {
        frameIndex: 1,
        joints3d: createCoco17Joints(0.05),
        joints2d: createCoco17Joints(0.05).map(([x, y, z, visibility]) => [0.5 + x * 0.1, 0.5 - y * 0.1, z, visibility]),
      },
    ],
  };
}

function createCoco17Joints(offsetX) {
  return [
    [0 + offsetX, 1.8, 0, 1],
    [0.08 + offsetX, 1.86, 0, 1],
    [-0.08 + offsetX, 1.86, 0, 1],
    [0.14 + offsetX, 1.82, 0, 1],
    [-0.14 + offsetX, 1.82, 0, 1],
    [0.5 + offsetX, 1.45, 0, 1],
    [-0.5 + offsetX, 1.45, 0, 1],
    [0.78 + offsetX, 1.0, 0, 1],
    [-0.78 + offsetX, 1.0, 0, 1],
    [0.92 + offsetX, 0.55, 0, 1],
    [-0.92 + offsetX, 0.55, 0, 1],
    [0.32 + offsetX, 0.8, 0, 1],
    [-0.32 + offsetX, 0.8, 0, 1],
    [0.36 + offsetX, 0.3, 0, 1],
    [-0.36 + offsetX, 0.3, 0, 1],
    [0.38 + offsetX, 0, 0.02, 1],
    [-0.38 + offsetX, 0, 0.02, 1],
  ];
}
