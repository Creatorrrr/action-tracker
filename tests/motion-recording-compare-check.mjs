#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMotionRecording, serializeMotionRecordingJsonl } from "../src/motion-frame.js";
import { compareRecordings, loadRecording, renderComparisonHtml } from "../scripts/motion-recording-compare.mjs";
import { createSyntheticSequence } from "../scripts/generate-synthetic-landmarks.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-compare-"));

const identityRecording = createSyntheticRecording("identity");
const turnRecording = createSyntheticRecording("turn-180");

const identicalReport = compareRecordings(identityRecording, identityRecording);
assert.equal(identicalReport.summary.liveFrames, identityRecording.frames.length);
assert.equal(identicalReport.summary.pairedFrames, identityRecording.frames.length);
assert.equal(identicalReport.summary.targetAngle.max, 0);
assert.equal(identicalReport.summary.hingeFlex.max, 0);
assert.equal(identicalReport.timeline.length, identityRecording.frames.length);
assert.equal(identicalReport.timeline[0].targetAngleMaxDeg, 0);

const differentReport = compareRecordings(identityRecording, turnRecording);
assert.equal(differentReport.summary.pairedFrames, identityRecording.frames.length);
assert.ok(
  differentReport.summary.targetAngle.max > 30,
  `expected synthetic turn recording to produce target deltas, got ${differentReport.summary.targetAngle.max}`,
);
const differentHtml = renderComparisonHtml(differentReport);
assert.ok(differentHtml.includes("Live vs Offline Motion Comparison"));
assert.ok(differentHtml.includes("Target Angle Delta Timeline"));
assert.ok(differentHtml.includes("<polyline"));

const sourceTimedLive = withVideoTime(identityRecording, 10_000);
const sourceTimedOffline = withVideoTime(identityRecording, 0);
const runtimeTimestampReport = compareRecordings(sourceTimedLive, sourceTimedOffline);
assert.equal(runtimeTimestampReport.summary.pairedFrames, 0);
const sourceTimeReport = compareRecordings(sourceTimedLive, sourceTimedOffline, {
  timestampSource: "sourceMeta.videoTime",
});
assert.equal(sourceTimeReport.timestampSource, "sourceMeta.videoTime");
assert.equal(sourceTimeReport.summary.pairedFrames, identityRecording.frames.length);
assert.equal(sourceTimeReport.summary.targetAngle.max, 0);

const livePath = path.join(tempDir, "live.jsonl");
const offlinePath = path.join(tempDir, "offline.jsonl");
const reportPath = path.join(tempDir, "report.json");
const htmlPath = path.join(tempDir, "report.html");
await writeFile(livePath, serializeMotionRecordingJsonl(identityRecording));
await writeFile(offlinePath, serializeMotionRecordingJsonl(identityRecording));

const loaded = await loadRecording(livePath);
assert.equal(loaded.frames.length, identityRecording.frames.length);

const cliResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/motion-recording-compare.mjs"),
  "--live",
  livePath,
  "--offline",
  offlinePath,
  "--output",
  reportPath,
  "--html",
  htmlPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);

const cliReport = JSON.parse(await readFile(reportPath, "utf8"));
assert.equal(cliReport.summary.pairedFrames, identityRecording.frames.length);
assert.equal(cliReport.summary.targetAngle.max, 0);
assert.equal(cliReport.summary.hingeFlex.max, 0);
assert.equal(cliReport.timeline.length, identityRecording.frames.length);

const cliHtml = await readFile(htmlPath, "utf8");
assert.ok(cliHtml.includes("Hinge Flex Delta Timeline"));
assert.ok(cliHtml.includes("Targets By Bone"));

console.log("Motion recording compare check passed.");

function createSyntheticRecording(scenario) {
  const sequence = createSyntheticSequence({ scenario, frames: 9, fps: 30 });

  return createMotionRecording({
    source: {
      type: "synthetic",
      scenario,
    },
    frames: sequence.frames,
    createdAt: "2026-07-02T00:00:00.000Z",
  });
}

function withVideoTime(recording, timestampOffsetMs) {
  return createMotionRecording({
    source: recording.source,
    createdAt: recording.createdAt,
    droppedFrames: recording.droppedFrames,
    frames: recording.frames.map((frame, index) => ({
      ...frame,
      timestamp: frame.timestamp + timestampOffsetMs,
      sourceMeta: {
        ...frame.sourceMeta,
        videoTime: index / 30,
      },
    })),
  });
}
