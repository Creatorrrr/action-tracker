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
const hingeRows = [];

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
  for (const hinge of solved.hinges ?? []) {
    hingeRows.push({
      name: hinge.name,
      group: hinge.group,
      flexDeg: hinge.flexDeg,
      violation: Boolean(hinge.violation),
      limitWarning: Boolean(hinge.limitWarning),
    });
  }
}

const hardFrames = rows.filter((row) => row.anatomyHardViolations > 0).length;
const softFrames = rows.filter((row) => row.anatomySoftViolations > 0).length;
const lowerReliableFrames = rows.filter((row) => row.lowerBodyReliable).length;
const constrainedFrames = rows.filter((row) => row.constrainedTargets > 0).length;
const elbowFlexion = hingeRows
  .filter((row) => row.group === "arms")
  .map((row) => row.flexDeg)
  .filter(Number.isFinite);
const kneeFlexion = hingeRows
  .filter((row) => row.group === "legs")
  .map((row) => row.flexDeg)
  .filter(Number.isFinite);

console.log(JSON.stringify({
  input,
  frames: rows.length,
  hardFrames,
  softFrames,
  constrainedFrames,
  lowerReliableFrames,
  lowerReliableRatio: rows.length ? lowerReliableFrames / rows.length : 0,
  hingeViolations: hingeRows.filter((row) => row.violation).length,
  hingeLimitWarnings: hingeRows.filter((row) => row.limitWarning).length,
  elbowFlexionP90Deg: percentile(elbowFlexion, 0.9),
  elbowFlexionMaxDeg: maxFinite(elbowFlexion),
  kneeFlexionP90Deg: percentile(kneeFlexion, 0.9),
  kneeFlexionMaxDeg: maxFinite(kneeFlexion),
}, null, 2));

function percentile(values, ratio) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return round(sorted[index]);
}

function maxFinite(values) {
  return values.length > 0 ? round(Math.max(...values)) : null;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
