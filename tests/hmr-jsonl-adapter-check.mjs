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
const mhr70InputPath = path.join(tempDir, "sam-mhr70.jsonl");
const mhr70OutputPath = path.join(tempDir, "sam-recording.jsonl");

await writeFile(inputPath, `${JSON.stringify(createCoco17Input(), null, 2)}\n`);
await writeFile(mhr70InputPath, createSamMhr70Jsonl());

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

const mhr70Result = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/hmr-jsonl-adapter.mjs"),
  "--input",
  mhr70InputPath,
  "--joint-format",
  "mhr70",
  "--output",
  mhr70OutputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(mhr70Result.status, 0, mhr70Result.stderr || mhr70Result.stdout);

const mhr70Summary = JSON.parse(mhr70Result.stdout);
assert.equal(mhr70Summary.status, "passed");
assert.equal(mhr70Summary.sourceType, "external-hmr");
assert.equal(mhr70Summary.extractor, "sam3d-body");
assert.equal(mhr70Summary.frameCount, 2);
assert.equal(mhr70Summary.poseLandmarksPerFrame, 33);
assert.equal(mhr70Summary.poseWorldLandmarksPerFrame, 33);

const mhr70Recording = parseMotionRecordingJsonl(await readFile(mhr70OutputPath, "utf8"));
assert.equal(mhr70Recording.source.type, "external-hmr");
assert.equal(mhr70Recording.source.extractor, "sam3d-body");
assert.equal(mhr70Recording.source.jointFormat, "mhr70");
assert.equal(mhr70Recording.source.mapping, "mhr70-to-mediapipe33");
assert.equal(mhr70Recording.source.axisAuditSamples, 2);
assert.equal(mhr70Recording.source.worldAxisZ, "native");
assert.equal(mhr70Recording.frames.length, 2);
assert.equal(mhr70Recording.frames[0].poseLandmarks[11].x, 0.9);
assert.equal(mhr70Recording.frames[0].poseLandmarks[11].y, 0.25);
assert.equal(mhr70Recording.frames[0].poseWorldLandmarks[11].x, 0.4);
assert.equal(mhr70Recording.frames[0].poseWorldLandmarks[12].x, -0.4);
assert.equal(mhr70Recording.frames[0].poseWorldLandmarks[11].y, -0.5);
assert.equal(mhr70Recording.frames[0].poseWorldLandmarks[23].x, 0.2);
assert.equal(mhr70Recording.frames[0].sourceMeta.mapping, "mhr70-to-mediapipe33");
assert.equal(mhr70Recording.frames[0].sourceMeta.worldAxisZ, "native");
assert.equal(mhr70Recording.frames[0].sourceMeta.axisAuditYDown, true);
assert.equal(mhr70Recording.frames[0].sourceMeta.axisAuditZCameraNegative, true);
assert.equal(mhr70Recording.frames[0].sourceMeta.sourceFrameIndex, 0);
assert.equal(mhr70Recording.frames[1].timestamp, 16.666666666666668);

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

function createSamMhr70Jsonl() {
  return [
    createSamMhr70Frame(0, 0, 0),
    createSamMhr70Frame(1, 1 / 60, 0.02),
  ].map((frame) => JSON.stringify(frame)).join("\n") + "\n";
}

function createSamMhr70Frame(frameIndex, timestampSec, offsetX) {
  const world = createMhr70WorldJoints(offsetX);
  const image = createMhr70ImageJoints();

  return {
    video: "sample.mp4",
    frame_index: frameIndex,
    timestamp_sec: timestampSec,
    image_size: { width: 1000, height: 2000 },
    person_count: 1,
    persons: [{
      person_id: 0,
      detector_score: 0.9,
      keypoints_mhr70_2d: image,
      keypoints_mhr70_3d: world,
    }],
  };
}

function createMhr70WorldJoints(offsetX) {
  const joints = Array.from({ length: 70 }, () => [offsetX, -1, 0, 0.9]);
  const set = (index, x, y, z = 0) => {
    joints[index] = [x + offsetX, y, z, 0.9];
  };

  set(0, 0, -1.7, -0.1);
  set(1, 0.08, -1.78, -0.1);
  set(2, -0.08, -1.78, -0.1);
  set(3, 0.14, -1.76, -0.08);
  set(4, -0.14, -1.76, -0.08);
  set(5, 0.4, -1.5, 0);
  set(6, -0.4, -1.5, 0);
  set(7, 0.7, -1.05, 0.05);
  set(8, -0.7, -1.05, 0.05);
  set(9, 0.2, -1, 0);
  set(10, -0.2, -1, 0);
  set(11, 0.24, -0.5, 0.05);
  set(12, -0.24, -0.5, 0.05);
  set(13, 0.25, 0, 0);
  set(14, -0.25, 0, 0);
  set(15, 0.28, 0.08, 0.12);
  set(17, 0.24, 0.06, -0.08);
  set(18, -0.28, 0.08, 0.12);
  set(20, -0.24, 0.06, -0.08);
  set(24, -0.86, -0.65, 0.04);
  set(28, -0.92, -0.68, 0.02);
  set(40, -0.96, -0.66, 0);
  set(41, -0.9, -0.7, 0);
  set(45, 0.86, -0.65, 0.04);
  set(49, 0.92, -0.68, 0.02);
  set(61, 0.96, -0.66, 0);
  set(62, 0.9, -0.7, 0);
  set(69, 0, -1.56, 0);

  return joints;
}

function createMhr70ImageJoints() {
  const joints = Array.from({ length: 70 }, () => [500, 1000, 0, 0.9]);
  const set = (index, x, y) => {
    joints[index] = [x, y, 0, 0.9];
  };

  set(0, 500, 220);
  set(1, 540, 180);
  set(2, 460, 180);
  set(3, 580, 190);
  set(4, 420, 190);
  set(5, 900, 500);
  set(6, 100, 500);
  set(7, 940, 820);
  set(8, 60, 820);
  set(9, 700, 1100);
  set(10, 300, 1100);
  set(11, 720, 1450);
  set(12, 280, 1450);
  set(13, 740, 1850);
  set(14, 260, 1850);
  set(15, 760, 1920);
  set(17, 720, 1880);
  set(18, 240, 1920);
  set(20, 280, 1880);
  set(24, 80, 900);
  set(28, 50, 880);
  set(40, 40, 860);
  set(41, 70, 850);
  set(45, 920, 900);
  set(49, 950, 880);
  set(61, 960, 860);
  set(62, 930, 850);
  set(69, 500, 420);

  return joints;
}
