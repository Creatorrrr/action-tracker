#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMotionRecording, serializeMotionRecordingJsonl } from "../src/motion-frame.js";
import { normalizeDepthCalibrationReferenceProfile } from "../src/depth-calibration.js";
import { createSyntheticSequence } from "../scripts/generate-synthetic-landmarks.mjs";
import { buildSamCalibrationProfile } from "../scripts/sam-calibration-profile.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-sam-profile-"));
const sequence = createSyntheticSequence({ scenario: "identity", frames: 12, fps: 30 });
const recording = createMotionRecording({
  source: {
    type: "synthetic",
    extractor: "sam-3d-body",
  },
  frames: sequence.frames,
  createdAt: "2026-07-03T00:00:00.000Z",
});

const profile = buildSamCalibrationProfile(recording, {
  sourceRecording: "synthetic.jsonl",
});
const paddedProfile = buildSamCalibrationProfile(recording, {
  sourceRecording: "synthetic.jsonl",
  ratioScale: 1.2,
});
assert.equal(profile.version, 1);
assert.equal(profile.extractor, "sam-3d-body");
assert.equal(profile.frameCount, sequence.frames.length);
assert.ok(profile.summary.usedFrames > 0);
assert.ok(profile.summary.gatedSegmentCount >= 6);
assert.ok(profile.segmentRatios.torso.ratio > 0);
assert.ok(profile.segmentRatios.leftUpperArm.samples > 0);
assert.equal(paddedProfile.ratioScale, 1.2);
assert.ok(paddedProfile.segmentRatios.torso.ratio > profile.segmentRatios.torso.ratio);

const normalized = normalizeDepthCalibrationReferenceProfile(profile);
assert.equal(normalized.segmentCount, Object.keys(profile.segmentRatios).length);
assert.equal(normalized.referenceRatios.torso, profile.segmentRatios.torso.ratio);
assert.equal(normalized.segmentRatios.leftUpperArm.source, "external-profile");

const inputPath = path.join(tempDir, "recording.jsonl");
const outputPath = path.join(tempDir, "profile.json");
await writeFile(inputPath, serializeMotionRecordingJsonl(recording));

const cliResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-calibration-profile.mjs"),
  "--input",
  inputPath,
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);

const cliProfile = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(cliProfile.summary.gatedSegmentCount, profile.summary.gatedSegmentCount);
assert.ok(cliProfile.segmentRatios.rightLowerLeg.ratio > 0);

console.log("SAM calibration profile check passed.");
