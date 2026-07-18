#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createCausalFingerFlexState,
  createCausalFingerRootState,
  measureParentRelativeFingerFlex,
  predictCausalFingerFlexGap,
  resetCausalFingerFlexState,
  resetCausalFingerRootState,
  resolvePalmLocalFingerRootDirection,
  resolveFingerFlexObservation,
  updateCausalFingerFlex,
  updateCausalFingerRootDirection,
} from "../src/retarget/causal-finger-flex.js";

const straight = buildIndexFinger([
  point(0, 0),
  point(1, 0),
  point(2, 0),
  point(3, 0),
]);
const straightPip = measureParentRelativeFingerFlex({
  points: straight,
  fingerName: "Index",
  segmentIndex: 1,
});
assert.equal(straightPip.valid, true);
assert.ok(Math.abs(straightPip.flexDeg) < 1e-9);
assert.deepEqual(
  [straightPip.parentIndex, straightPip.jointIndex, straightPip.childIndex],
  [5, 6, 7],
);

const bent = buildIndexFinger([
  point(0, 0),
  point(1, 0),
  point(1, 1),
  point(0, 1),
]);
const bentPip = measureParentRelativeFingerFlex({
  points: bent,
  fingerName: "Index",
  segmentIndex: 1,
});
const bentDip = measureParentRelativeFingerFlex({
  points: bent,
  fingerName: "Index",
  segmentIndex: 2,
});
assert.ok(Math.abs(bentPip.flexDeg - 90) < 1e-9);
assert.ok(Math.abs(bentDip.flexDeg - 90) < 1e-9);

const calibratedPip = resolveFingerFlexObservation({
  points: bent,
  fingerName: "Index",
  segmentIndex: 1,
}, { flexScale: 0.55 });
assert.equal(calibratedPip.rawFlexDeg, 90);
assert.ok(Math.abs(calibratedPip.calibratedFlexDeg - 49.5) < 1e-9);
assert.ok(Math.abs(calibratedPip.targetFlexDeg - 49.5) < 1e-9);

const coupledDip = resolveFingerFlexObservation({
  points: bent,
  fingerName: "Index",
  segmentIndex: 2,
  proximalFlexDeg: 40,
  confidence: 1,
});
assert.equal(coupledDip.valid, true);
assert.equal(coupledDip.dipCoupled, true);
assert.equal(coupledDip.dipCouplingLimitDeg, 49);
assert.equal(coupledDip.targetFlexDeg, 49);

const thumbBent = buildThumb([
  point(0, 0),
  point(1, 0),
  point(1, 1),
  point(0, 1),
]);
const thumbIp = resolveFingerFlexObservation({
  points: thumbBent,
  fingerName: "Thumb",
  segmentIndex: 2,
  proximalFlexDeg: 0,
});
assert.equal(thumbIp.dipCoupled, false);
assert.equal(thumbIp.targetFlexDeg, 90);

const rootDirectionPoints = Array.from({ length: 21 }, () => point(0, 0, 0));
const sourceFlexRad = 30 * Math.PI / 180;
const sourceSpreadRad = 20 * Math.PI / 180;
rootDirectionPoints[5] = point(0, 0, 0);
rootDirectionPoints[6] = point(
  Math.cos(sourceFlexRad) * Math.cos(sourceSpreadRad),
  Math.cos(sourceFlexRad) * Math.sin(sourceSpreadRad),
  Math.sin(sourceFlexRad),
);
const calibratedRootDirection = resolvePalmLocalFingerRootDirection({
  points: rootDirectionPoints,
  fingerName: "Index",
  palmPrimary: point(1, 0, 0),
  palmNormal: point(0, 0, 1),
}, {
  flexScale: 0.5,
  flexOffsetDeg: -5,
  spreadScale: 0.5,
});
assert.equal(calibratedRootDirection.valid, true);
assert.ok(Math.abs(calibratedRootDirection.rawFlexDeg - 30) < 1e-9);
assert.ok(Math.abs(calibratedRootDirection.rawSpreadDeg - 20) < 1e-9);
assert.ok(Math.abs(calibratedRootDirection.flexDeg - 10) < 1e-9);
assert.ok(Math.abs(calibratedRootDirection.spreadDeg - 10) < 1e-9);
assert.ok(Math.abs(Math.hypot(
  calibratedRootDirection.direction.x,
  calibratedRootDirection.direction.y,
  calibratedRootDirection.direction.z,
) - 1) < 1e-9);

const backwardRootDirectionPoints = Array.from(
  { length: 21 },
  () => point(0, 0, 0),
);
const backwardFlexRad = 150 * Math.PI / 180;
const backwardSpreadRad = 20 * Math.PI / 180;
backwardRootDirectionPoints[5] = point(0, 0, 0);
backwardRootDirectionPoints[6] = point(
  Math.cos(backwardFlexRad) * Math.cos(backwardSpreadRad),
  Math.cos(backwardFlexRad) * Math.sin(backwardSpreadRad),
  Math.sin(backwardFlexRad),
);
const backwardRootDirection = resolvePalmLocalFingerRootDirection({
  points: backwardRootDirectionPoints,
  fingerName: "Index",
  palmPrimary: point(1, 0, 0),
  palmNormal: point(0, 0, 1),
}, {
  minimumFlexDeg: -180,
  maximumFlexDeg: 180,
});
assert.equal(backwardRootDirection.valid, true);
assert.ok(Math.abs(backwardRootDirection.rawFlexDeg - 150) < 1e-9);
assert.ok(Math.abs(backwardRootDirection.rawSpreadDeg - 20) < 1e-9);
assert.ok(Math.abs(backwardRootDirection.flexDeg - 150) < 1e-9);
assert.ok(Math.abs(backwardRootDirection.spreadDeg - 20) < 1e-9);
assert.ok(directionError(
  backwardRootDirection.direction,
  backwardRootDirectionPoints[6],
) < 1e-9);

const thumbOppositionPoints = Array.from(
  { length: 21 },
  () => point(0, 0, 0),
);
thumbOppositionPoints[1] = point(0, 0, 0);
thumbOppositionPoints[2] = point(-0.8, 0.3, 0.5);
const thumbOpposition = resolvePalmLocalFingerRootDirection({
  points: thumbOppositionPoints,
  fingerName: "Thumb",
  palmPrimary: point(1, 0, 0),
  palmNormal: point(0, 0, 1),
}, {
  minimumFlexDeg: -180,
  maximumFlexDeg: 180,
  minimumSpreadDeg: -180,
  maximumSpreadDeg: 180,
});
const expectedThumbOppositionFlexDeg = Math.atan2(
  0.5,
  Math.hypot(-0.8, 0.3),
) * 180 / Math.PI;
const expectedThumbOppositionSpreadDeg = Math.atan2(0.3, -0.8) * 180 / Math.PI;
assert.equal(thumbOpposition.valid, true);
assert.ok(Math.abs(
  thumbOpposition.rawFlexDeg - expectedThumbOppositionFlexDeg,
) < 1e-9);
assert.ok(Math.abs(
  thumbOpposition.rawSpreadDeg - expectedThumbOppositionSpreadDeg,
) < 1e-9);
assert.ok(thumbOpposition.rawSpreadDeg > 90);
assert.ok(directionError(
  thumbOpposition.direction,
  normalizeDirection(thumbOppositionPoints[2]),
) < 1e-9);

const rootBasis = {
  palmPrimary: point(1, 0, 0),
  palmNormal: point(0, 0, 1),
};
const causalRoot = createCausalFingerRootState();
const invalidRootPts = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", 0, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: null,
});
assert.equal(invalidRootPts.status, "invalid-source-pts-hold");
assert.equal(invalidRootPts.apply, false);
assert.deepEqual(causalRoot, createCausalFingerRootState());
let rootResult = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", 0, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
  confidence: 1,
});
assert.equal(rootResult.status, "initialized-direct");
assert.equal(rootResult.direct, true);
assert.equal(rootResult.flexDeg, 0);
assert.equal(rootResult.spreadDeg, 0);

// A high-quality change at the clear boundary remains immediate. There is no
// EMA or source-frame delay on the normal path.
rootResult = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", 35, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 1_016_667,
  confidence: 1,
});
assert.equal(rootResult.status, "direct");
assert.equal(rootResult.direct, true);
assert.ok(Math.abs(rootResult.flexDeg - 35) < 1e-9);
assert.ok(Math.abs(rootResult.appliedDeltaDeg - 35) < 1e-9);

// Repeat, stale, predicted, and low-quality samples can reconstruct the
// accepted angles, but none can advance exact detector evidence or pending
// confirmation state.
for (const sample of [
  { sourcePtsUs: 1_016_667, provenance: "detected", status: "repeated-source-hold" },
  { sourcePtsUs: 1_016_666, provenance: "detected", status: "stale-source-hold" },
  { sourcePtsUs: 2_000_000, provenance: "predicted", status: "predicted-hold" },
]) {
  const before = structuredClone(causalRoot);
  const heldRoot = updateCausalFingerRootDirection(causalRoot, {
    points: buildFingerRoot("Index", -20, 40),
    fingerName: "Index",
    palmPrimary: point(0, 1, 0),
    palmNormal: point(0, 0, 1),
    sourcePtsUs: sample.sourcePtsUs,
    confidence: 1,
    provenance: sample.provenance,
  });
  assert.equal(heldRoot.status, sample.status);
  assert.equal(heldRoot.held, true);
  assert.ok(Math.abs(heldRoot.flexDeg - 35) < 1e-9);
  assert.ok(directionError(
    heldRoot.direction,
    point(0, Math.cos(35 * Math.PI / 180), Math.sin(35 * Math.PI / 180)),
  ) < 1e-9);
  assert.deepEqual(causalRoot, before);
}

const beforeLowQualityRoot = structuredClone(causalRoot);
const lowQualityRoot = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", 0, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 1_033_334,
  confidence: 0.1,
});
assert.equal(lowQualityRoot.status, "low-quality-hold");
assert.deepEqual(causalRoot, beforeLowQualityRoot);

// A large reacquired target requires two consistent unique detector PTS. The
// two-second gap still grants at most a single 1/30 s, 18-degree step.
const firstLargeRoot = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", -35, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 3_016_667,
  confidence: 1,
});
assert.equal(firstLargeRoot.status, "confirmation-hold");
assert.equal(firstLargeRoot.confirmationCount, 1);
assert.ok(Math.abs(firstLargeRoot.flexDeg - 35) < 1e-9);

const confirmedLargeRoot = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", -34, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 3_033_334,
  confidence: 1,
});
assert.equal(confirmedLargeRoot.status, "confirmed-rate-limited");
assert.equal(confirmedLargeRoot.confirmed, true);
assert.equal(confirmedLargeRoot.rateLimited, true);
assert.ok(confirmedLargeRoot.appliedDeltaDeg <= 18 + 1e-8);
assert.ok(Math.abs(confirmedLargeRoot.appliedDeltaDeg - 18) < 1e-8);

// Once confirmed, a consistent target continues causally without requiring a
// new two-sample window; repeat PTS still cannot move it.
const afterConfirmedSnapshot = structuredClone(causalRoot);
const repeatedConfirmedRoot = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", -34, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 3_033_334,
  confidence: 1,
});
assert.equal(repeatedConfirmedRoot.status, "repeated-source-hold");
assert.deepEqual(causalRoot, afterConfirmedSnapshot);
const trackedConfirmedRoot = updateCausalFingerRootDirection(causalRoot, {
  points: buildFingerRoot("Index", -33, 0),
  fingerName: "Index",
  ...rootBasis,
  sourcePtsUs: 3_050_001,
  confidence: 1,
});
assert.equal(trackedConfirmedRoot.confirmed, true);
assert.ok(trackedConfirmedRoot.appliedDeltaDeg <= 9.001);

// A small clear target after the same long gap stays direct rather than being
// penalized by the rate limiter.
const directAfterGapState = createCausalFingerRootState();
updateCausalFingerRootDirection(directAfterGapState, {
  points: buildFingerRoot("Middle", 0, 0),
  fingerName: "Middle",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
});
const directAfterGap = updateCausalFingerRootDirection(directAfterGapState, {
  points: buildFingerRoot("Middle", 30, 0),
  fingerName: "Middle",
  ...rootBasis,
  sourcePtsUs: 3_000_000,
});
assert.equal(directAfterGap.status, "direct");
assert.equal(directAfterGap.rateLimited, false);
assert.ok(Math.abs(directAfterGap.flexDeg - 30) < 1e-9);

// Near-zero primary-component candidates are ambiguous even when their
// angular history is otherwise plausible. Inconsistent unique candidates
// reset to one piece of evidence and cannot confirm.
const ambiguousRootState = createCausalFingerRootState();
updateCausalFingerRootDirection(ambiguousRootState, {
  points: buildFingerRoot("Ring", 0, 0),
  fingerName: "Ring",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
});
const ambiguousFirst = updateCausalFingerRootDirection(ambiguousRootState, {
  points: buildFingerRoot("Ring", 0, 89),
  fingerName: "Ring",
  ...rootBasis,
  sourcePtsUs: 1_016_667,
});
assert.equal(ambiguousFirst.status, "confirmation-hold");
assert.equal(ambiguousFirst.primaryAmbiguous, true);
assert.equal(ambiguousFirst.confirmationCount, 1);
const ambiguousInconsistent = updateCausalFingerRootDirection(ambiguousRootState, {
  points: buildFingerRoot("Ring", 30, 89),
  fingerName: "Ring",
  ...rootBasis,
  sourcePtsUs: 1_033_334,
});
assert.equal(ambiguousInconsistent.status, "confirmation-hold");
assert.equal(ambiguousInconsistent.confirmationCount, 1);
assert.equal(ambiguousInconsistent.confirmed, false);
assert.equal(ambiguousRootState.acceptedFlexDeg, 0);
assert.equal(ambiguousRootState.acceptedSpreadDeg, 0);

const uninitializedAmbiguous = createCausalFingerRootState();
const uninitializedAmbiguousFirst = updateCausalFingerRootDirection(
  uninitializedAmbiguous,
  {
    points: buildFingerRoot("Pinky", 0, 89),
    fingerName: "Pinky",
    ...rootBasis,
    sourcePtsUs: 1_000_000,
  },
);
assert.equal(uninitializedAmbiguousFirst.apply, false);
assert.equal(uninitializedAmbiguousFirst.confirmationCount, 1);
const uninitializedAmbiguousConfirmed = updateCausalFingerRootDirection(
  uninitializedAmbiguous,
  {
    points: buildFingerRoot("Pinky", 1, 88),
    fingerName: "Pinky",
    ...rootBasis,
    sourcePtsUs: 1_016_667,
  },
);
assert.equal(uninitializedAmbiguousConfirmed.status, "initialized-confirmed");
assert.equal(uninitializedAmbiguousConfirmed.apply, true);
assert.equal(uninitializedAmbiguousConfirmed.confirmed, true);

// State ownership and reset are local.
assert.ok(Math.abs(directAfterGapState.acceptedFlexDeg - 30) < 1e-9);
assert.notEqual(causalRoot.acceptedFlexDeg, directAfterGapState.acceptedFlexDeg);

// Thumb now uses the same exact-PTS causal owner. Its initial negative-primary
// opposition remains immediate and numerically identical to the accepted
// spatial decomposition rather than becoming non-thumb primary ambiguity.
const thumbOppositionState = createCausalFingerRootState();
const temporalThumbOpposition = updateCausalFingerRootDirection(thumbOppositionState, {
  points: thumbOppositionPoints,
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
  confidence: 1,
}, {
  minimumFlexDeg: -180,
  maximumFlexDeg: 180,
  minimumSpreadDeg: -180,
  maximumSpreadDeg: 180,
});
assert.equal(temporalThumbOpposition.status, "initialized-direct");
assert.equal(temporalThumbOpposition.direct, true);
assert.equal(temporalThumbOpposition.primaryAmbiguous, false);
assert.ok(Math.abs(temporalThumbOpposition.flexDeg - thumbOpposition.flexDeg) < 1e-9);
assert.ok(Math.abs(temporalThumbOpposition.spreadDeg - thumbOpposition.spreadDeg) < 1e-9);
assert.ok(directionError(
  temporalThumbOpposition.direction,
  thumbOpposition.direction,
) < 1e-9);

// Repeated, stale, predicted, and low-quality Thumb samples may reconstruct the
// current-basis hold, but cannot advance accepted angles or confirmation.
for (const sample of [
  { sourcePtsUs: 1_000_000, provenance: "detected", confidence: 1, status: "repeated-source-hold" },
  { sourcePtsUs: 999_999, provenance: "detected", confidence: 1, status: "stale-source-hold" },
  { sourcePtsUs: 2_000_000, provenance: "predicted", confidence: 1, status: "predicted-hold" },
  { sourcePtsUs: 1_016_667, provenance: "detected", confidence: 0.1, status: "low-quality-hold" },
]) {
  const before = structuredClone(thumbOppositionState);
  const heldThumb = updateCausalFingerRootDirection(thumbOppositionState, {
    points: buildFingerRoot("Thumb", -40, 20),
    fingerName: "Thumb",
    ...rootBasis,
    sourcePtsUs: sample.sourcePtsUs,
    provenance: sample.provenance,
    confidence: sample.confidence,
  });
  assert.equal(heldThumb.status, sample.status);
  assert.equal(heldThumb.held, true);
  assert.deepEqual(thumbOppositionState, before);
}

// Initial acquisition and a clear normal Thumb change remain zero-delay.
const directThumbState = createCausalFingerRootState();
const initialThumb = updateCausalFingerRootDirection(directThumbState, {
  points: buildFingerRoot("Thumb", 0, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
  confidence: 1,
});
assert.equal(initialThumb.status, "initialized-direct");
const directThumb = updateCausalFingerRootDirection(directThumbState, {
  points: buildFingerRoot("Thumb", 30, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_016_667,
  confidence: 1,
});
assert.equal(directThumb.status, "direct");
assert.equal(directThumb.rateLimited, false);
assert.ok(Math.abs(directThumb.flexDeg - 30) < 1e-9);

// A large Thumb reacquisition requires two consistent unique detector PTS and
// cannot gain a larger step from a long gap. Quality 1 preserves the existing
// 540 deg/s * 1/30 s = 18 degree confirmed recovery bound.
const largeThumbState = createCausalFingerRootState();
updateCausalFingerRootDirection(largeThumbState, {
  points: buildFingerRoot("Thumb", 0, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
  confidence: 1,
});
const firstLargeThumb = updateCausalFingerRootDirection(largeThumbState, {
  points: buildFingerRoot("Thumb", 80, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 3_016_667,
  confidence: 1,
});
assert.equal(firstLargeThumb.status, "confirmation-hold");
assert.equal(firstLargeThumb.confirmationCount, 1);
assert.equal(largeThumbState.acceptedFlexDeg, 0);
const confirmedLargeThumb = updateCausalFingerRootDirection(largeThumbState, {
  points: buildFingerRoot("Thumb", 79, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 3_033_334,
  confidence: 1,
});
assert.equal(confirmedLargeThumb.status, "confirmed-rate-limited");
assert.equal(confirmedLargeThumb.confirmed, true);
assert.ok(Math.abs(confirmedLargeThumb.maximumStepDeg - 18) < 1e-8);
assert.ok(Math.abs(confirmedLargeThumb.appliedDeltaDeg - 18) < 1e-8);

// Accepted lower confidence can only reduce the confirmed maximum step.
const boundedConfidenceThumbState = createCausalFingerRootState();
updateCausalFingerRootDirection(boundedConfidenceThumbState, {
  points: buildFingerRoot("Thumb", 0, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
  confidence: 1,
});
updateCausalFingerRootDirection(boundedConfidenceThumbState, {
  points: buildFingerRoot("Thumb", 80, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 3_016_667,
  confidence: 0.6,
});
const boundedConfidenceThumb = updateCausalFingerRootDirection(
  boundedConfidenceThumbState,
  {
    points: buildFingerRoot("Thumb", 79, 0),
    fingerName: "Thumb",
    ...rootBasis,
    sourcePtsUs: 3_033_334,
    confidence: 0.6,
  },
);
assert.equal(boundedConfidenceThumb.status, "confirmed-rate-limited");
assert.ok(Math.abs(boundedConfidenceThumb.maximumStepDeg - 10.8) < 1e-8);
assert.ok(Math.abs(boundedConfidenceThumb.appliedDeltaDeg - 10.8) < 1e-8);
assert.ok(
  boundedConfidenceThumb.appliedDeltaDeg < confirmedLargeThumb.appliedDeltaDeg,
);

// Inconsistent unique Thumb candidates restart confirmation rather than
// accepting either large target.
const inconsistentThumbState = createCausalFingerRootState();
updateCausalFingerRootDirection(inconsistentThumbState, {
  points: buildFingerRoot("Thumb", 0, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_000_000,
});
updateCausalFingerRootDirection(inconsistentThumbState, {
  points: buildFingerRoot("Thumb", 80, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_016_667,
});
const inconsistentThumb = updateCausalFingerRootDirection(inconsistentThumbState, {
  points: buildFingerRoot("Thumb", -80, 0),
  fingerName: "Thumb",
  ...rootBasis,
  sourcePtsUs: 1_033_334,
});
assert.equal(inconsistentThumb.status, "confirmation-hold");
assert.equal(inconsistentThumb.confirmationCount, 1);
assert.equal(inconsistentThumb.confirmed, false);
assert.equal(inconsistentThumbState.acceptedFlexDeg, 0);

// Independent Thumb states cannot consume one another's evidence, and reset
// clears accepted plus pending exact-PTS history.
assert.ok(Math.abs(directThumbState.acceptedFlexDeg - 30) < 1e-9);
assert.equal(inconsistentThumbState.acceptedFlexDeg, 0);
resetCausalFingerRootState(inconsistentThumbState);
assert.deepEqual(inconsistentThumbState, createCausalFingerRootState());
resetCausalFingerRootState(directAfterGapState);
assert.deepEqual(directAfterGapState, createCausalFingerRootState());

const overflexed = buildIndexFinger([
  point(0, 0),
  point(1, 0),
  point(1 + Math.cos(150 * Math.PI / 180), Math.sin(150 * Math.PI / 180)),
  point(0, 1),
]);
const constrainedPip = resolveFingerFlexObservation({
  points: overflexed,
  fingerName: "Index",
  segmentIndex: 1,
});
assert.equal(constrainedPip.hardViolation, true);
assert.equal(constrainedPip.targetFlexDeg, 115);
assert.ok(constrainedPip.quality < 0.45);

const causal = createCausalFingerFlexState();
let timestamp = 1;
let result = updateCausalFingerFlex(causal, {
  points: bent,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
  confidence: 1,
  legacyLocalDeltaDeg: 100,
});
assert.equal(result.status, "initialized-rate-limited");
assert.ok(Math.abs(result.flexDeg - 9) < 1e-9);
assert.equal(result.rateLimited, true);

for (let index = 0; index < 4; index += 1) {
  const previousFlexDeg = result.flexDeg;
  timestamp += 1 / 60;
  result = updateCausalFingerFlex(causal, {
    points: bent,
    fingerName: "Index",
    segmentIndex: 1,
    sourcePtsSec: timestamp,
    confidence: 1,
    legacyLocalDeltaDeg: 100,
  });
  assert.ok(result.flexDeg - previousFlexDeg <= 9 + 1e-8);
}
assert.equal(result.useHinge, true);
assert.ok(result.correctionWeight > 0.9);

const repeatedFlexDeg = result.flexDeg;
const repeatedCount = causal.observationCount;
const repeated = updateCausalFingerFlex(causal, {
  points: straight,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
  confidence: 1,
  legacyLocalDeltaDeg: 0,
});
assert.equal(repeated.status, "repeated-source-hold");
assert.equal(repeated.repeated, true);
assert.equal(repeated.flexDeg, repeatedFlexDeg);
assert.equal(causal.observationCount, repeatedCount);

const stale = updateCausalFingerFlex(causal, {
  points: straight,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp - 0.1,
});
assert.equal(stale.status, "stale-source-hold");
assert.equal(stale.stale, true);
assert.equal(stale.flexDeg, repeatedFlexDeg);

// Once the causal target has settled, reliable bend continues to own the
// distal hinge even when the old absolute target itself no longer jumps.
for (let index = 0; index < 8; index += 1) {
  timestamp += 1 / 60;
  result = updateCausalFingerFlex(causal, {
    points: bent,
    fingerName: "Index",
    segmentIndex: 1,
    sourcePtsSec: timestamp,
    confidence: 1,
    legacyLocalDeltaDeg: 5,
  });
}
assert.equal(result.flexDeg, 90);
assert.equal(result.rateLimited, false);
assert.ok(result.correctionWeight > 0.9);
assert.equal(result.useHinge, true);

timestamp += 1 / 60;
const straightSettled = updateCausalFingerFlex(createCausalFingerFlexState(), {
  points: straight,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
  confidence: 1,
  legacyLocalDeltaDeg: 0,
});
assert.equal(straightSettled.flexDeg, 0);
assert.equal(straightSettled.correctionWeight, 1);
assert.equal(straightSettled.useHinge, true);

const heldFlexDeg = result.flexDeg;
const causalSnapshot = structuredClone(causal);
const projectedHold = predictCausalFingerFlexGap(causal, {
  sourcePtsSec: timestamp + 0.2,
}, {
  missingGraceSec: 0.25,
  resetAfterSec: 1.25,
  missingDecayDegPerSec: 60,
});
assert.equal(projectedHold.status, "missing-gap-hold");
assert.equal(projectedHold.flexDeg, heldFlexDeg);
assert.deepEqual(causal, causalSnapshot);

const projectedDecay = predictCausalFingerFlexGap(causal, {
  sourcePtsSec: timestamp + 0.75,
}, {
  missingGraceSec: 0.25,
  resetAfterSec: 1.25,
  missingDecayDegPerSec: 60,
});
assert.equal(projectedDecay.status, "missing-gap-decay");
const projectedDecayGapSec = timestamp + 0.75 - causal.lastObservationPtsSec;
const expectedProjectedDecay = Math.max(
  0,
  heldFlexDeg - (projectedDecayGapSec - 0.25) * 60,
);
assert.ok(Math.abs(projectedDecay.flexDeg - expectedProjectedDecay) < 1e-8);
assert.deepEqual(causal, causalSnapshot);

const projectedReset = predictCausalFingerFlexGap(causal, {
  sourcePtsSec: timestamp + 1.25,
}, {
  missingGraceSec: 0.25,
  resetAfterSec: 1.25,
});
assert.equal(projectedReset.status, "missing-gap-reset");
assert.equal(projectedReset.apply, false);
assert.deepEqual(causal, causalSnapshot);

timestamp += 0.1;
const lowQuality = updateCausalFingerFlex(causal, {
  points: bent,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
  confidence: 0.1,
});
assert.equal(lowQuality.status, "missing-hold");
assert.equal(lowQuality.flexDeg, heldFlexDeg);

timestamp += 0.2;
const decayed = updateCausalFingerFlex(causal, {
  points: null,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
});
assert.equal(decayed.status, "missing-decay");
assert.ok(decayed.flexDeg < heldFlexDeg);
assert.ok(decayed.flexDeg >= 0);

timestamp += 0.35;
const reset = updateCausalFingerFlex(causal, {
  points: null,
  fingerName: "Index",
  segmentIndex: 1,
  sourcePtsSec: timestamp,
});
assert.equal(reset.status, "missing-reset");
assert.equal(reset.apply, false);
assert.equal(causal.initialized, false);
assert.equal(causal.lastFlexDeg, 0);

resetCausalFingerFlexState(causal);
assert.deepEqual(causal, createCausalFingerFlexState());

const unsupported = measureParentRelativeFingerFlex({
  points: bent,
  fingerName: "Index",
  segmentIndex: 0,
});
assert.equal(unsupported.valid, false);
assert.equal(unsupported.reason, "unsupported-segment");

console.log("causal finger flex checks passed");

function buildIndexFinger(joints) {
  const points = Array.from({ length: 21 }, () => point(0, 0));
  [5, 6, 7, 8].forEach((landmarkIndex, index) => {
    points[landmarkIndex] = joints[index];
  });
  return points;
}

function buildThumb(joints) {
  const points = Array.from({ length: 21 }, () => point(0, 0));
  [1, 2, 3, 4].forEach((landmarkIndex, index) => {
    points[landmarkIndex] = joints[index];
  });
  return points;
}

function buildFingerRoot(fingerName, flexDeg, spreadDeg) {
  const indices = {
    Thumb: [1, 2],
    Index: [5, 6],
    Middle: [9, 10],
    Ring: [13, 14],
    Pinky: [17, 18],
  }[fingerName];
  const flexRad = flexDeg * Math.PI / 180;
  const spreadRad = spreadDeg * Math.PI / 180;
  const points = Array.from({ length: 21 }, () => point(0, 0, 0));
  points[indices[0]] = point(0, 0, 0);
  points[indices[1]] = point(
    Math.cos(flexRad) * Math.cos(spreadRad),
    Math.cos(flexRad) * Math.sin(spreadRad),
    Math.sin(flexRad),
  );
  return points;
}

function point(x, y, z = 0, confidence = 1) {
  return {
    x,
    y,
    z,
    visibility: confidence,
    presence: confidence,
  };
}

function directionError(actual, expected) {
  return Math.hypot(
    actual.x - expected.x,
    actual.y - expected.y,
    actual.z - expected.z,
  );
}

function normalizeDirection(direction) {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  return {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length,
  };
}
