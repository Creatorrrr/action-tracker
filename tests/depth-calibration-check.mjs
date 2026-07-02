#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
  DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
  DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS,
  DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS,
  DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS,
  DEPTH_CALIBRATION_SHOULDER_WIDTH_TO_TORSO_SCALE,
  DEPTH_CALIBRATION_SEGMENTS,
  bodyScale2D,
  depthCalibrationCoverage,
  lengthConsistencyRow,
  normalizeDepthCalibrationMode,
  resolveDepthCalibrationMinSegments,
  solveDistalDepth,
  summarizeLengthConsistency,
} from "../src/depth-calibration.js";

assert.equal(normalizeDepthCalibrationMode("dynamic"), "dynamic");
assert.equal(normalizeDepthCalibrationMode("static"), "static");
assert.equal(normalizeDepthCalibrationMode("unexpected"), "dynamic");

const parent = { x: 0, y: 0, z: 0 };
const child = { x: 3, y: 4, z: 0 };

const solved = solveDistalDepth({
  parent,
  child,
  rawChild: { ...child, z: 2 },
  targetLength: 13,
  smoothingAlpha: 1,
});
assert.equal(solved.solved, true);
assert.equal(solved.clamped, false);
assert.equal(solved.signSource, "raw");
assert.ok(Math.abs(solved.z - 12) < 0.000001);

const flatSolved = solveDistalDepth({
  parent,
  child,
  rawChild: { ...child, z: 1 },
  targetLength: 5,
  smoothingAlpha: 1,
});
assert.equal(flatSolved.solved, true);
assert.ok(Math.abs(flatSolved.z) < 0.000001);

const clamped = solveDistalDepth({
  parent,
  child,
  rawChild: { ...child, z: -1 },
  targetLength: 4,
  smoothingAlpha: 1,
});
assert.equal(clamped.clamped, true);
assert.ok(Math.abs(clamped.z) < 0.000001);

const previousSign = solveDistalDepth({
  parent,
  child,
  rawChild: { ...child, z: 0 },
  previousDz: -6,
  targetLength: 10,
  smoothingAlpha: 1,
});
assert.equal(previousSign.signSource, "previous");
assert.ok(previousSign.z < 0);

const ambiguousPreviousSign = solveDistalDepth({
  parent,
  child: { x: 9.5, y: 0, z: 0 },
  rawChild: { x: 9.5, y: 0, z: 2 },
  previousDz: -6,
  targetLength: 10,
  smoothingAlpha: 1,
});
assert.equal(ambiguousPreviousSign.signSource, "previous-ambiguous");
assert.ok(ambiguousPreviousSign.z < 0);

const segment = DEPTH_CALIBRATION_SEGMENTS.find((item) => item.name === "leftUpperArm");
const points = {
  leftShoulder: { x: 0, y: 0, z: 0 },
  leftElbow: { x: 3, y: 4, z: 12 },
};
const row = lengthConsistencyRow({
  segment,
  points,
  referenceRatio: 13,
  scale: 1,
});
assert.ok(row.relativeLengthError <= DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD);
assert.equal(row.matched, true);

const summary = summarizeLengthConsistency([
  row,
  {
    ...row,
    name: "leftForeArm",
    actualLength: 12.5,
    targetLength: 13,
    relativeLengthError: 0.038,
    matched: true,
  },
]);
assert.equal(summary.score, 1);
assert.ok(summary.meanSegmentCv >= 0);

const upperBodyScale = bodyScale2D({
  leftShoulder: { x: -0.5, y: 1, z: 0 },
  rightShoulder: { x: 0.5, y: 1, z: 0 },
  shoulderMid: { x: 0, y: 1, z: 0 },
});
assert.equal(upperBodyScale, DEPTH_CALIBRATION_SHOULDER_WIDTH_TO_TORSO_SCALE);

const upperBodyCoverage = depthCalibrationCoverage({
  leftShoulder: { x: -1, y: 1, z: 0 },
  leftElbow: { x: -1.4, y: 0.2, z: 0.1 },
  leftWrist: { x: -1.6, y: -0.4, z: 0.2 },
  rightShoulder: { x: 1, y: 1, z: 0 },
  rightElbow: { x: 1.4, y: 0.2, z: 0.1 },
  rightWrist: { x: 1.6, y: -0.4, z: 0.2 },
  shoulderMid: { x: 0, y: 1, z: 0 },
});
assert.equal(upperBodyCoverage.validSegments, 4);
assert.equal(upperBodyCoverage.lowerBodySegments, 0);
assert.equal(resolveDepthCalibrationMinSegments(upperBodyCoverage), DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS);

const fullBodyCoverage = depthCalibrationCoverage({
  leftShoulder: { x: -1, y: 1, z: 0 },
  leftElbow: { x: -1.4, y: 0.2, z: 0.1 },
  leftWrist: { x: -1.6, y: -0.4, z: 0.2 },
  rightShoulder: { x: 1, y: 1, z: 0 },
  rightElbow: { x: 1.4, y: 0.2, z: 0.1 },
  rightWrist: { x: 1.6, y: -0.4, z: 0.2 },
  leftHip: { x: -0.6, y: -1, z: 0 },
  leftKnee: { x: -0.7, y: -2, z: 0.1 },
  leftAnkle: { x: -0.8, y: -3, z: 0.1 },
  rightHip: { x: 0.6, y: -1, z: 0 },
  rightKnee: { x: 0.7, y: -2, z: 0.1 },
  rightAnkle: { x: 0.8, y: -3, z: 0.1 },
  shoulderMid: { x: 0, y: 1, z: 0 },
  hipMid: { x: 0, y: -1, z: 0 },
});
assert.ok(fullBodyCoverage.lowerBodySegments > 0);
assert.equal(resolveDepthCalibrationMinSegments(fullBodyCoverage), DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS);

const clampedSummary = summarizeLengthConsistency([
  row,
  {
    ...row,
    actualLength: 20,
    targetLength: 20,
    relativeLengthError: 0,
    clamped: true,
    matched: true,
  },
]);
assert.equal(clampedSummary.score, 1);
assert.equal(clampedSummary.cvEligibleCount, 1);
assert.equal(clampedSummary.p95SegmentCv, 0);

const robustCvSummary = summarizeLengthConsistency([
  ...Array.from({ length: 39 }, () => row),
  {
    ...row,
    actualLength: 20,
    targetLength: 13,
    relativeLengthError: 7 / 13,
    matched: false,
  },
]);
assert.ok(robustCvSummary.score >= 0.95);
assert.ok(robustCvSummary.p95SegmentCv < 0.01);
assert.equal(robustCvSummary.cvReliableSegmentCount, 0);
assert.equal(robustCvSummary.cvSparseSegmentCount, 1);
assert.equal(robustCvSummary.segmentCvs[0].reliable, false);

const reliableCvSummary = summarizeLengthConsistency(
  Array.from({ length: DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES }, (_, index) => ({
    ...row,
    actualLength: index % 2 === 0 ? 13 : 14,
    targetLength: 13,
    relativeLengthError: index % 2 === 0 ? 0 : 1 / 13,
    matched: true,
  })),
);
assert.equal(reliableCvSummary.cvReliableSegmentCount, 1);
assert.equal(reliableCvSummary.cvSparseSegmentCount, 0);
assert.equal(reliableCvSummary.segmentCvs[0].reliable, true);
assert.ok(reliableCvSummary.p95SegmentCv > 0);
assert.ok(DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS > 0);

console.log("Depth calibration check passed.");
