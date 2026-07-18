#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
  DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
  DEPTH_CALIBRATION_MIN_OBSERVED_CV_SEGMENTS_WITH_PROFILE,
  DEPTH_CALIBRATION_MIN_FULL_BODY_SEGMENTS,
  DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS,
  DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS,
  DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE,
  DEPTH_CALIBRATION_SHOULDER_WIDTH_TO_TORSO_SCALE,
  DEPTH_CALIBRATION_SEGMENTS,
  bodyScale2D,
  depthCalibrationCoverage,
  evaluateDepthCalibrationSegmentGate,
  estimateCalibrationPoseQuality,
  lengthConsistencyRow,
  normalizeDepthCalibrationMode,
  resolveDepthCalibrationMinSegments,
  solveCalibratedSegmentVector,
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

const rawPairSign = solveDistalDepth({
  parent: { x: 0, y: 0, z: 3 },
  child: { x: 3, y: 4, z: 2 },
  rawParent: { x: 0, y: 0, z: 0 },
  rawChild: { x: 3, y: 4, z: 2 },
  targetLength: 13,
  smoothingAlpha: 1,
});
assert.equal(rawPairSign.signSource, "raw");
assert.ok(Math.abs(rawPairSign.z - 15) < 0.000001);

const missingRawParentFallback = solveDistalDepth({
  parent: { x: 0, y: 0, z: 3 },
  child: { x: 3, y: 4, z: 2 },
  rawChild: { x: 3, y: 4, z: 2 },
  targetLength: 13,
  smoothingAlpha: 1,
});
assert.equal(missingRawParentFallback.signSource, "raw");
assert.ok(Math.abs(missingRawParentFallback.z + 9) < 0.000001);

const nonfiniteRawParentFallback = solveDistalDepth({
  parent: { x: 0, y: 0, z: 3 },
  child: { x: 3, y: 4, z: 2 },
  rawParent: { x: 0, y: 0, z: Number.NaN },
  rawChild: { x: 3, y: 4, z: 2 },
  targetLength: 13,
  smoothingAlpha: 1,
});
assert.deepEqual(nonfiniteRawParentFallback, missingRawParentFallback);

const vectorParent = { x: 10, y: -5, z: 7 };
const vectorRawParent = { x: 100, y: 200, z: -30 };
const vectorRawChild = { x: 103, y: 204, z: -18 };
const vectorInputsBefore = structuredClone({
  parent: vectorParent,
  rawParent: vectorRawParent,
  rawChild: vectorRawChild,
});
const calibratedVector = solveCalibratedSegmentVector({
  parent: vectorParent,
  rawParent: vectorRawParent,
  rawChild: vectorRawChild,
  targetLength: 26,
});
assert.deepEqual(
  {
    x: calibratedVector.x,
    y: calibratedVector.y,
    z: calibratedVector.z,
    dx: calibratedVector.dx,
    dy: calibratedVector.dy,
    dz: calibratedVector.dz,
  },
  { x: 16, y: 3, z: 31, dx: 6, dy: 8, dz: 24 },
);
assert.equal(calibratedVector.solved, true);
assert.equal(calibratedVector.source, "raw-calibrated-vector");
assert.equal(calibratedVector.fallbackReason, null);
assert.equal(calibratedVector.rawLength, 13);
assert.equal(calibratedVector.targetLength, 26);
assert.equal(calibratedVector.clamped, false);
assert.equal(calibratedVector.smoothnessDelta, 0);
assert.deepEqual(
  { parent: vectorParent, rawParent: vectorRawParent, rawChild: vectorRawChild },
  vectorInputsBefore,
  "calibrated vector solve must not mutate caller-owned points",
);

const translatedVector = solveCalibratedSegmentVector({
  parent: vectorParent,
  rawParent: { x: 1100, y: -300, z: 70 },
  rawChild: { x: 1103, y: -296, z: 82 },
  targetLength: 26,
});
assert.deepEqual(translatedVector, calibratedVector);

const mirroredVector = solveCalibratedSegmentVector({
  parent: { x: -10, y: -5, z: 7 },
  rawParent: { x: -100, y: 200, z: -30 },
  rawChild: { x: -103, y: 204, z: -18 },
  targetLength: 26,
});
assert.equal(mirroredVector.x, -calibratedVector.x);
assert.equal(mirroredVector.dx, -calibratedVector.dx);
assert.equal(mirroredVector.y, calibratedVector.y);
assert.equal(mirroredVector.z, calibratedVector.z);

const upperArmVector = solveCalibratedSegmentVector({
  parent: { x: 0, y: 0, z: 0 },
  rawParent: { x: 0, y: 0, z: 0 },
  rawChild: { x: 3, y: 4, z: 12 },
  targetLength: 13,
});
const foreArmVector = solveCalibratedSegmentVector({
  parent: upperArmVector,
  rawParent: { x: 3, y: 4, z: 12 },
  rawChild: { x: 3, y: 7, z: 16 },
  targetLength: 10,
});
assert.deepEqual(
  { x: upperArmVector.x, y: upperArmVector.y, z: upperArmVector.z },
  { x: 3, y: 4, z: 12 },
);
assert.deepEqual(
  { x: foreArmVector.x, y: foreArmVector.y, z: foreArmVector.z },
  { x: 3, y: 10, z: 20 },
);
assert.ok(Math.abs(Math.hypot(
  foreArmVector.x - upperArmVector.x,
  foreArmVector.y - upperArmVector.y,
  foreArmVector.z - upperArmVector.z,
) - 10) < 0.000001);

const vectorFailures = [
  {
    expected: "invalid-parent",
    input: { parent: null, rawParent: { x: 0, y: 0, z: 0 }, rawChild: { x: 1, y: 0, z: 0 }, targetLength: 1 },
  },
  {
    expected: "invalid-parent",
    input: { parent: { x: Number.NaN, y: 0, z: 0 }, rawParent: { x: 0, y: 0, z: 0 }, rawChild: { x: 1, y: 0, z: 0 }, targetLength: 1 },
  },
  {
    expected: "invalid-raw-parent",
    input: { parent: { x: 0, y: 0, z: 0 }, rawParent: { x: 0, y: Number.NaN, z: 0 }, rawChild: { x: 1, y: 0, z: 0 }, targetLength: 1 },
  },
  {
    expected: "invalid-raw-child",
    input: { parent: { x: 0, y: 0, z: 0 }, rawParent: { x: 0, y: 0, z: 0 }, rawChild: { x: 1, y: 0, z: Infinity }, targetLength: 1 },
  },
  {
    expected: "invalid-target-length",
    input: { parent: { x: 0, y: 0, z: 0 }, rawParent: { x: 0, y: 0, z: 0 }, rawChild: { x: 1, y: 0, z: 0 }, targetLength: 0 },
  },
  {
    expected: "invalid-target-length",
    input: { parent: { x: 0, y: 0, z: 0 }, rawParent: { x: 0, y: 0, z: 0 }, rawChild: { x: 1, y: 0, z: 0 }, targetLength: Number.NaN },
  },
  {
    expected: "degenerate-raw-direction",
    input: { parent: { x: 3, y: 4, z: 5 }, rawParent: { x: 1, y: 2, z: 3 }, rawChild: { x: 1, y: 2, z: 3 }, targetLength: 10 },
  },
];

for (const { expected, input } of vectorFailures) {
  const failed = solveCalibratedSegmentVector(input);
  assert.equal(failed.solved, false);
  assert.equal(failed.source, "none");
  assert.equal(failed.fallbackReason, expected);
  assert.equal(failed.clamped, false);
  for (const key of ["x", "y", "z", "dx", "dy", "dz", "rawLength", "targetLength", "smoothnessDelta"]) {
    assert.equal(Number.isFinite(failed[key]), true, `${expected} ${key} must remain finite`);
  }
}

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
assert.equal(Number.isFinite(clamped.z), true);
assert.equal(Number.isFinite(clamped.dz), true);

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

const avatarRendererSource = readFileSync(
  new URL("../src/avatar-renderer.js", import.meta.url),
  "utf8",
);
const depthCalibrationSource = readFileSync(
  new URL("../src/depth-calibration.js", import.meta.url),
  "utf8",
);
const armChainSource = avatarRendererSource.slice(
  avatarRendererSource.indexOf("function solveCalibratedArmVectorChains"),
  avatarRendererSource.indexOf("function buildPosePoints"),
);
const depthRefinementSource = avatarRendererSource.slice(
  avatarRendererSource.indexOf("function refineDepthFromSegmentLengths"),
  avatarRendererSource.indexOf("function updateDepthCalibrationRows"),
);

assert.equal(avatarRendererSource.includes("raw-relative"), false);
assert.equal(depthCalibrationSource.includes("raw-relative"), false);
assert.ok(armChainSource.includes("POSE.leftShoulder, POSE.leftElbow, POSE.leftWrist"));
assert.ok(armChainSource.includes("POSE.rightShoulder, POSE.rightElbow, POSE.rightWrist"));
assert.ok(armChainSource.includes("const gateOpen = isFinitePosePoint3D(parent)"));
assert.ok(armChainSource.includes("currentWorldPoints.every((point) => isFinitePosePoint3D(point))"));
assert.ok(armChainSource.includes("rawChainPoints.every((point) => isFinitePosePoint3D(point))"));
assert.equal(armChainSource.includes("Number.isFinite(point.visibility)"), false);
assert.equal(armChainSource.includes("point.visibility >= RETARGET_FULL_CONFIDENCE_VISIBILITY"), false);
assert.ok(armChainSource.includes("if (!gateOpen)"));
assert.ok(armChainSource.includes("parent: upper"));
assert.ok(armChainSource.includes("if (!upper.solved || !fore?.solved)"));
assert.ok(
  armChainSource.indexOf("if (!upper.solved || !fore?.solved)")
    < armChainSource.indexOf("solutions.set(chain.upperSegment, upper)"),
  "both links must solve before either side result becomes visible to the caller",
);
assert.ok(depthRefinementSource.includes("child.x = calibratedArmVector.x;"));
assert.ok(depthRefinementSource.includes("child.y = calibratedArmVector.y;"));
assert.ok(depthRefinementSource.includes("child.z = calibratedArmVector.z;"));
assert.equal(depthRefinementSource.includes("points[step.child] ="), false);
assert.ok(depthRefinementSource.includes("...(useRawPairSign ? { rawParent: rawPoints[step.parent] } : {}),"));

const callerOwnedPoint = { x: 0, y: 0, z: 0, visibility: 0.91, presence: 0.88, tag: "owned" };
callerOwnedPoint.x = calibratedVector.x;
callerOwnedPoint.y = calibratedVector.y;
callerOwnedPoint.z = calibratedVector.z;
assert.deepEqual(
  { visibility: callerOwnedPoint.visibility, presence: callerOwnedPoint.presence, tag: callerOwnedPoint.tag },
  { visibility: 0.91, presence: 0.88, tag: "owned" },
);

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

const tPoseQuality = estimateCalibrationPoseQuality({
  leftShoulder: { x: -0.3, y: 1, z: 0, visibility: 0.95 },
  leftElbow: { x: -0.75, y: 1.02, z: 0.02, visibility: 0.95 },
  leftWrist: { x: -1.15, y: 1.01, z: 0.03, visibility: 0.95 },
  rightShoulder: { x: 0.3, y: 1, z: 0, visibility: 0.95 },
  rightElbow: { x: 0.75, y: 0.98, z: -0.02, visibility: 0.95 },
  rightWrist: { x: 1.15, y: 0.99, z: -0.03, visibility: 0.95 },
  leftHip: { x: -0.25, y: 0, z: 0, visibility: 0.95 },
  rightHip: { x: 0.25, y: 0, z: 0, visibility: 0.95 },
  shoulderMid: { x: 0, y: 1, z: 0, visibility: 0.95 },
  hipMid: { x: 0, y: 0, z: 0, visibility: 0.95 },
});
assert.equal(tPoseQuality.passed, true);
assert.ok(tPoseQuality.score >= DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE);
assert.ok(tPoseQuality.coverage.upperBodySegments >= DEPTH_CALIBRATION_MIN_UPPER_BODY_SEGMENTS);
assert.deepEqual(tPoseQuality.reasons, []);

const armsDownQuality = estimateCalibrationPoseQuality({
  leftShoulder: { x: -0.3, y: 1, z: 0, visibility: 0.95 },
  leftElbow: { x: -0.42, y: 0.45, z: 0.02, visibility: 0.95 },
  leftWrist: { x: -0.45, y: -0.05, z: 0.03, visibility: 0.95 },
  rightShoulder: { x: 0.3, y: 1, z: 0, visibility: 0.95 },
  rightElbow: { x: 0.42, y: 0.45, z: -0.02, visibility: 0.95 },
  rightWrist: { x: 0.45, y: -0.05, z: -0.03, visibility: 0.95 },
  shoulderMid: { x: 0, y: 1, z: 0, visibility: 0.95 },
});
assert.equal(armsDownQuality.passed, false);
assert.ok(armsDownQuality.score < DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE);
assert.ok(armsDownQuality.reasons.includes("arms_not_open"));
assert.ok(armsDownQuality.reasons.includes("arms_not_level"));

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

const observedOnlySegmentGate = evaluateDepthCalibrationSegmentGate({
  cvReliableSegmentCount: DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS,
  externalReferenceSegmentCount: 0,
});
assert.equal(observedOnlySegmentGate.profileAssisted, false);
assert.equal(observedOnlySegmentGate.reliableSegmentsPassed, true);

const profileOnlySegmentGate = evaluateDepthCalibrationSegmentGate({
  cvReliableSegmentCount: 0,
  externalReferenceSegmentCount: 12,
});
assert.equal(profileOnlySegmentGate.profileAssisted, true);
assert.equal(profileOnlySegmentGate.observableReliableSegmentCount, 12);
assert.equal(profileOnlySegmentGate.observedRequirementMet, false);
assert.equal(profileOnlySegmentGate.reliableSegmentsPassed, false);

const profileObservedSegmentGate = evaluateDepthCalibrationSegmentGate({
  cvReliableSegmentCount: DEPTH_CALIBRATION_MIN_OBSERVED_CV_SEGMENTS_WITH_PROFILE,
  externalReferenceSegmentCount: 12,
});
assert.equal(profileObservedSegmentGate.profileAssisted, true);
assert.equal(profileObservedSegmentGate.observedRequirementMet, true);
assert.equal(profileObservedSegmentGate.reliableSegmentsPassed, true);

console.log("Depth calibration check passed.");
