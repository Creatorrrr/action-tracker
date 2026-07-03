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

const labeledIdentityReport = compareRecordings(identityRecording, identityRecording, {
  labels: labelsFromSyntheticRecording(identityRecording),
});
assert.equal(labeledIdentityReport.summary.facingAgreement.count, identityRecording.frames.length);
assert.equal(labeledIdentityReport.summary.facingAgreement.agreementRatio, 1);
assert.equal(labeledIdentityReport.summary.facingAgreement.yawError.max, 0);

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
assert.equal(sourceTimeReport.summary.pairedRatio, 1);
assert.equal(sourceTimeReport.summary.targetAngle.weightedMean, 0);

const shiftedLive = withTimestampOffset(identityRecording, 100);
const shiftedNoOffsetReport = compareRecordings(shiftedLive, identityRecording, {
  maxTimestampDeltaMs: 10,
});
assert.ok(shiftedNoOffsetReport.summary.pairedFrames < identityRecording.frames.length);
const shiftedAutoOffsetReport = compareRecordings(shiftedLive, identityRecording, {
  maxTimestampDeltaMs: 10,
  offsetMs: "auto",
});
assert.equal(shiftedAutoOffsetReport.estimatedOffsetMs, 100);
assert.equal(shiftedAutoOffsetReport.summary.pairedFrames, identityRecording.frames.length);
assert.equal(shiftedAutoOffsetReport.summary.timestampDelta.max, 0);

const denseFlex = createSyntheticRecording("left-elbow-flex", { frames: 9, fps: 30 });
const sparseFlex = createSyntheticRecording("left-elbow-flex", { frames: 3, fps: 7.5 });
const nearestSparseReport = compareRecordings(denseFlex, sparseFlex, {
  maxTimestampDeltaMs: 10,
});
assert.ok(nearestSparseReport.summary.pairedFrames < denseFlex.frames.length);
const interpolatedSparseReport = compareRecordings(denseFlex, sparseFlex, {
  maxTimestampDeltaMs: 10,
  interpolate: "offline",
});
assert.equal(interpolatedSparseReport.interpolate, "offline");
assert.equal(interpolatedSparseReport.summary.pairedFrames, denseFlex.frames.length);
assert.equal(interpolatedSparseReport.summary.pairedRatio, 1);
assert.equal(interpolatedSparseReport.summary.offlineUsedFrames, sparseFlex.frames.length);
assert.ok(interpolatedSparseReport.summary.pairedRatio > nearestSparseReport.summary.pairedRatio);

const loopedLive = createMotionRecording({
  source: identityRecording.source,
  createdAt: identityRecording.createdAt,
  frames: [
    ...identityRecording.frames.slice(4),
    ...identityRecording.frames.slice(0, 4),
  ],
});
const loopedReport = compareRecordings(loopedLive, identityRecording, {
  maxTimestampDeltaMs: 1,
});
assert.equal(loopedReport.summary.pairedFrames, identityRecording.frames.length);
assert.equal(loopedReport.summary.pairedRatio, 1);

const repeatedLive = repeatRecordingWithTimestampOffset(identityRecording, 300);
const repeatedNoWrapReport = compareRecordings(repeatedLive, identityRecording, {
  maxTimestampDeltaMs: 1,
});
assert.equal(repeatedNoWrapReport.summary.pairedFrames, identityRecording.frames.length);
const repeatedWrapReport = compareRecordings(repeatedLive, identityRecording, {
  maxTimestampDeltaMs: 1,
  timestampWrap: "offline-duration",
});
assert.equal(repeatedWrapReport.timestampWrap, "offline-duration");
assert.equal(repeatedWrapReport.summary.pairedFrames, repeatedLive.frames.length);
assert.equal(repeatedWrapReport.summary.pairedRatio, 1);

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

function createSyntheticRecording(scenario, options = {}) {
  const sequence = createSyntheticSequence({
    scenario,
    frames: options.frames ?? 9,
    fps: options.fps ?? 30,
  });

  return createMotionRecording({
    source: {
      type: "synthetic",
      scenario,
    },
    frames: sequence.frames,
    createdAt: "2026-07-02T00:00:00.000Z",
  });
}

function withTimestampOffset(recording, timestampOffsetMs) {
  return createMotionRecording({
    source: recording.source,
    createdAt: recording.createdAt,
    droppedFrames: recording.droppedFrames,
    frames: recording.frames.map((frame) => ({
      ...frame,
      timestamp: frame.timestamp + timestampOffsetMs,
    })),
  });
}

function repeatRecordingWithTimestampOffset(recording, timestampOffsetMs) {
  return createMotionRecording({
    source: recording.source,
    createdAt: recording.createdAt,
    droppedFrames: recording.droppedFrames,
    frames: [
      ...recording.frames,
      ...recording.frames.map((frame) => ({
        ...frame,
        timestamp: frame.timestamp + timestampOffsetMs,
      })),
    ],
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

function labelsFromSyntheticRecording(recording) {
  return {
    version: 1,
    frames: recording.frames.map((frame, index) => ({
      index,
      timestamp: frame.timestamp,
      facingState: frame.expected?.facing ?? "front",
      facingYawDeg: frame.expected?.yawDeg ?? 0,
    })),
  };
}
