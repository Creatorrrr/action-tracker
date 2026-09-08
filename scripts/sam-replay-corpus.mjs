#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseMotionRecordingJsonl } from "../src/motion-frame.js";
import { createSamReferenceFrame } from "../src/pose/sam-reference.js";
import { preparePoseObservation } from "../src/pose/observation-adapter.js";
import { pairSourceFrames, directionErrorDeg, summarizeSamples } from "./lib/sam-pairing.mjs";

// Usage: node scripts/sam-replay-corpus.mjs CLIP RAW.jsonl OUTPUT_PREFIX
const [clipId, recordingPath, outputPrefix] = process.argv.slice(2);
if (!clipId || !recordingPath || !outputPrefix) throw new Error("Expected CLIP RAW.jsonl OUTPUT_PREFIX");
const teacherPath = `sam-3d-body-skeletons/${clipId}/skeletons_mhr70.jsonl`;
const manifestPath = "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl";
const inputs = await Promise.all([recordingPath, teacherPath, manifestPath].map(p => readFile(p, "utf8")));
const parseLines = text => text.trim().split(/\r?\n/).map(JSON.parse);
const liveFrames = parseMotionRecordingJsonl(inputs[0]).frames;
const rows = parseLines(inputs[1]);
const decoderRows = parseLines(inputs[2]).filter(r => r.clipId === clipId);
if (rows.length !== decoderRows.length) throw new Error("SAM and decoder counts differ");
if (liveFrames.some(f => f.sourceMeta.videoFileName !== `${clipId}.mp4`)) throw new Error("Recording belongs to another clip");
const teacherFrames = rows.map((row, i) => createSamReferenceFrame(row, { clipId, decoderFrame: decoderRows[i] }));
const alignment = pairSourceFrames(liveFrames, decoderRows, teacherFrames);
const segments = { leftUpperArm: [11,13], leftForearm: [13,15], rightUpperArm: [12,14], rightForearm: [14,16],
  leftUpperLeg: [23,25], leftLowerLeg: [25,27], rightUpperLeg: [24,26], rightLowerLeg: [26,28] };
const detectorErrors = Object.fromEntries(Object.keys(segments).map(name => [name, []]));
for (const pair of alignment.pairs.filter(p => p.referenceObserved)) {
  const live = preparePoseObservation(liveFrames[pair.liveIndex], { mode: "canonical-world" }).canonicalPose.landmarks;
  const reference = teacherFrames[pair.teacherIndex].canonicalPose.landmarks;
  for (const [name, [a,b]] of Object.entries(segments)) detectorErrors[name].push(directionErrorDeg(live[a],live[b],reference[a],reference[b]));
}
const report = {
  generatedAt: new Date().toISOString(), clipId,
  inputs: [recordingPath, teacherPath, manifestPath].map((p,i) => ({ path: p, sha256: createHash("sha256").update(inputs[i]).digest("hex") })),
  alignment, rawDetectorDirectionErrorDeg: Object.fromEntries(Object.entries(detectorErrors).map(([k,v]) => [k,summarizeSamples(v)])),
  handObservationAgeMs: Object.fromEntries(["Left", "Right"].map(side => [side, {
    age: summarizeSamples(liveFrames.map(f=>f.sourceMeta[`hand${side}ObservationAgeMs`])),
    worldPresentFrames: liveFrames.filter(f=>f[`${side.toLowerCase()}HandWorldLandmarks`]?.length === 21).length,
    predictedFrames: liveFrames.filter(f=>f.sourceMeta[`hand${side}Predicted`]).length,
    fresh100msFrames: liveFrames.filter(f=>f[`${side.toLowerCase()}HandWorldLandmarks`]?.length === 21 &&
      !f.sourceMeta[`hand${side}Predicted`] && Number.isFinite(f.sourceMeta[`hand${side}ObservationAgeMs`]) &&
      f.sourceMeta[`hand${side}ObservationAgeMs`] <= 100).length,
  }])),
};
// Original observations stay in their hashed JSONL. The browser payload omits
// only unused raw SAM mesh/camera data; it retains the exact canonical joints.
const browserTeacher = teacherFrames.map(({ rawSamObservation, ...frame }) => frame);
await mkdir(path.dirname(outputPrefix), { recursive: true });
await writeFile(`${outputPrefix}-alignment.json`, JSON.stringify(report, null, 2)+"\n");
await writeFile(`${outputPrefix}-corpus.json`, JSON.stringify({ clipId, alignment, liveFrames, teacherFrames: browserTeacher })+"\n");
console.log(JSON.stringify({ clipId, live: alignment.liveCount, pairs: alignment.matchedCount,
  unpaired: alignment.unmatched.length, fallback: alignment.fallback.length, sourceCoverage: alignment.decoderExactCoverage }));
