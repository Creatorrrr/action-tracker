#!/usr/bin/env node
import fs from "node:fs";
import { parseMotionRecordingJsonl } from "../src/motion-frame.js";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const input = process.argv[2];

if (!input) {
  console.error("Usage: node scripts/anatomy-constraint-smoke.mjs <recording.jsonl>");
  process.exit(2);
}

const text = fs.readFileSync(input, "utf8");
const recording = parseMotionRecordingJsonl(text);
const state = {};
const rows = [];

for (const frame of recording.frames) {
  const solved = solvePoseFrame(frame.motionFrame ?? frame, state);
  Object.assign(state, solved.state);
  rows.push({
    timestamp: solved.timestamp,
    anatomyHardViolations: solved.meta.anatomyHardViolations ?? 0,
    anatomySoftViolations: solved.meta.anatomySoftViolations ?? 0,
    lowerBodyReliable: Boolean(solved.meta.anatomyLowerBodyReliable),
    constrainedTargets: solved.meta.anatomyConstrainedTargets ?? 0,
  });
}

const hardFrames = rows.filter((row) => row.anatomyHardViolations > 0).length;
const softFrames = rows.filter((row) => row.anatomySoftViolations > 0).length;
const lowerReliableFrames = rows.filter((row) => row.lowerBodyReliable).length;

console.log(JSON.stringify({
  input,
  frames: rows.length,
  hardFrames,
  softFrames,
  lowerReliableFrames,
  lowerReliableRatio: rows.length ? lowerReliableFrames / rows.length : 0,
}, null, 2));
