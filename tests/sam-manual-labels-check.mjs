#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileManualLabels,
  crossCheckManualAgainstAutoLabels,
  findManualFrameForTimestamp,
} from "../src/labels/manual-labels.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-manual-labels-"));

const spec = {
  version: 1,
  clip: "unit",
  fps: 10,
  durationSec: 4,
  guardBandSec: 0.2,
  globalConditions: {
    occlusionChanges: [
      { fromSec: 0, occlusion: "table-knee" },
      { fromSec: 3, occlusion: "table-waist" },
    ],
  },
  segments: [
    { t0: 0, t1: 1, phase: "hold", presence: "present", facing: "front", arms: "crossed", fingers: "idle" },
    { t0: 1, t1: 2, phase: "transition", presence: "present", facing: "turning", arms: "down", fingers: "unknown" },
    { t0: 2, t1: 3, phase: "hold", presence: "absent", arms: "none", fingers: "none" },
    { t0: 3, t1: 4, phase: "hold", presence: "present", facing: "front", arms: "palms-near-head", fingers: "moving", handsOutOfFrame: true },
  ],
};

const labels = compileManualLabels(spec);
assert.equal(labels.frames.length, 40);
assert.equal(labels.summary.segmentCount, 4);
assert.equal(labels.summary.byPresence.present, 3);
assert.equal(labels.summary.byPresence.absent, 1);
assert.ok(labels.windows.some((window) => window.kind === "manual:arms:crossed:hold"));
assert.ok(labels.windows.some((window) => window.kind === "manual:reference-invalid:absent"));
assert.ok(labels.windows.some((window) => window.kind === "manual:reference-invalid:hands-out-of-frame"));

const crossed = labels.windows.find((window) => window.kind === "manual:arms:crossed:hold");
assert.equal(crossed.startMs, 200);
assert.equal(crossed.endMs, 800);

const transition = labels.windows.find((window) => window.kind === "manual:presence:present:transition");
assert.equal(transition.startMs, 1000);
assert.equal(transition.endMs, 2000);

const frame = findManualFrameForTimestamp(labels, 2500);
assert.equal(frame.presence, "absent");
assert.equal(frame.referenceValid, false);

const crossCheck = crossCheckManualAgainstAutoLabels(labels, {
  windows: [
    { kind: "crossed-arms", startMs: 0, endMs: 1000 },
    { kind: "back-facing", startMs: 2000, endMs: 3000 },
  ],
});
assert.ok(crossCheck.checks.find((check) => check.name === "crossed-arms").iou > 0.5);

const inputPath = path.join(tempDir, "manual.json");
const outputPath = path.join(tempDir, "compiled.json");
const reportPath = path.join(tempDir, "report.json");
await writeFile(inputPath, `${JSON.stringify(spec, null, 2)}\n`);

const cliResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-manual-labels.mjs"),
  "--input",
  inputPath,
  "--output",
  outputPath,
  "--report",
  reportPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});
assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
const cliLabels = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(cliLabels.frames.length, labels.frames.length);
const cliReport = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(cliReport.status, "passed");

console.log("SAM manual labels check passed.");
