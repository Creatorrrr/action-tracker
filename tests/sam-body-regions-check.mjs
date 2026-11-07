import assert from "node:assert/strict";
import { BODY_REGIONS, rawDetectorRegionFrame, appliedAvatarRegionFrame, summarizeBodyRegions } from "../scripts/lib/sam-body-regions.mjs";
import { createSyntheticMotionFrame } from "../scripts/generate-synthetic-landmarks.mjs";
import { captureRawPoseObservation, buildCanonicalPose, buildCanonicalPosePoints } from "../src/pose/canonical-pose.js";

const directionNames = [...new Set(Object.values(BODY_REGIONS).flatMap(region => region.directions))];
const zeroDirections = () => Object.fromEntries(directionNames.map(name => [name, 0]));
const frame = (index, directions = {}) => ({ ptsUs: index * 100000, teacherIndex: index, liveIndex: index,
  metrics: { directionDeg: { ...zeroDirections(), ...directions } } });
const summarizeDirections = (frames, options = {}) => summarizeBodyRegions(frames, { metricNames: ["directionDeg"], ...options });

// A good torso and three good leg segments must not hide one failing leg.
const mixed = summarizeDirections([frame(0, { leftLowerLeg: 80 })]);
assert.equal(mixed.regions.upperBody.metrics.directionDeg.diagnostic.withinRatio, 1);
assert.equal(mixed.regions.lowerBody.metrics.directionDeg.samples.mean, 20);
assert.equal(mixed.regions.lowerBody.metrics.directionDeg.frameWorst.p95, 80);
assert.equal(mixed.regions.lowerBody.metrics.directionDeg.diagnostic.withinRatio, 0);
assert.equal(mixed.upperLower.directionDeg.counts.upperWithinLowerOver, 1);
assert.equal(mixed.regions.leftLeg.metrics.directionDeg.diagnostic.overFrames, 1);
assert.equal(mixed.regions.rightLeg.metrics.directionDeg.diagnostic.withinFrames, 1);

// The same linear torso target appears six times in old summaries. It contributes
// one sample here and cannot dilute an arm error or masquerade as vertebral data.
const duplicates = summarizeDirections([frame(0, { torso: 10, hips: 180, spine: 180, spine1: 180, spine2: 180, chest: 180 })]);
assert.equal(duplicates.regions.torso.metrics.directionDeg.samples.count, 1);
assert.equal(duplicates.regions.torso.metrics.directionDeg.samples.mean, 10);
assert.equal(duplicates.regions.upperBody.metrics.directionDeg.samples.count, 7);
assert.equal(duplicates.regions.pelvis.metrics.directionDeg.status, "not-applicable");

// Two disjoint bad frames: each member's P95 and the pooled-sample P95 are 0,
// but the P95 of the actual per-frame maximum is 100. Summary-only pooling fails.
const separated = summarizeDirections(Array.from({ length: 20 }, (_, index) => frame(index, {
  leftUpperArm: index === 0 ? 100 : 0,
  leftForeArm: index === 1 ? 100 : 0,
})));
const arm = separated.regions.leftArm.metrics.directionDeg;
assert.equal(arm.byMember.leftUpperArm.p95, 0);
assert.equal(arm.byMember.leftForeArm.p95, 0);
assert.equal(arm.samples.p95, 0);
assert.equal(arm.frameWorst.p95, 100);
assert.equal(arm.diagnostic.overFrames, 2);

// Same-time classification matters: upper and lower may fail on different frames.
const alternating = summarizeDirections([frame(0, { leftLowerLeg: 80 }), frame(1, { leftForeArm: 80 })]);
assert.deepEqual(alternating.upperLower.directionDeg.counts, {
  bothWithin: 0, upperWithinLowerOver: 1, upperOverLowerWithin: 1, bothOver: 0, unscorable: 0,
});
assert.equal(alternating.upperLower.directionDeg.examples.upperWithinLowerOver[0].ptsUs, 0);

// Null/NaN/out-of-range members and whole missing frames stay in the denominator.
const missing = summarizeDirections([frame(0), frame(1, { leftLowerLeg: null })], { expectedFrameCount: 3 });
const leg = missing.regions.lowerBody.metrics.directionDeg;
assert.equal(leg.coverage.expectedSamples, 12);
assert.equal(leg.coverage.measuredSamples, 7);
assert.equal(leg.coverage.completeFrames, 1);
assert.equal(leg.coverage.missingFrames, 2);
assert.equal(leg.diagnostic.withinRatio, 1 / 3);
assert.equal(missing.upperLower.directionDeg.counts.unscorable, 2);
for (const invalid of [NaN, Infinity, -1, 181, "0"]) {
  assert.equal(summarizeDirections([frame(0, { leftLowerLeg: invalid })]).regions.leftLeg.metrics.directionDeg.coverage.completeFrames, 0);
}
assert.equal(summarizeDirections([]).regions.leftLeg.metrics.directionDeg.samples.p95, null);
assert.equal(summarizeDirections([]).regions.leftLeg.metrics.directionDeg.diagnostic.withinRatio, null);
assert.throws(() => summarizeDirections([frame(0), frame(0)]), /Duplicate/);
assert.throws(() => summarizeDirections([frame(1), frame(0)]), /non-monotonic/);
assert.throws(() => summarizeDirections([frame(0)], { expectedFrameCount: 0 }), /expected/);

// Rotation uses q/-q equivalence. FK uses reference height and preserves a
// separate world-space error; missing reference data cannot be replaced by 0.
const state = () => ({ timing: { sourcePtsSec: 0.1 }, modelHeight: 2,
  bones: { LeftArm: { localQuaternion: [0, 0, 0, 1] } },
  fkEndpoints: { LeftHand: { modelLocalPosition: [0, 0, 0], worldPosition: [0, 0, 0] } } });
const reference = state(), candidate = state();
candidate.bones.LeftArm.localQuaternion = [0, 0, 0, -1];
candidate.fkEndpoints.LeftHand = { modelLocalPosition: [0.1, 0, 0], worldPosition: [1, 0, 0] };
const row = { ptsUs: 100000, teacherIndex: 1, liveIndex: 1, directionErrorDeg: zeroDirections(), appliedAvatarState: candidate };
const applied = appliedAvatarRegionFrame(row, reference);
assert.equal(applied.metrics.localRotationDeg.LeftArm, 0);
assert.equal(applied.metrics.localRotationDeg.LeftForeArm, null);
assert.equal(applied.metrics.fkLocalPctH.LeftHand, 5);
assert.equal(applied.metrics.fkWorldPctH.LeftHand, 50);
const appliedSummary = summarizeBodyRegions([applied]);
assert.equal(appliedSummary.regions.leftArm.metrics.localRotationDeg.coverage.completeFrames, 0);
assert.equal(appliedSummary.regions.leftArm.metrics.directionDeg.frameWorst.p95, 0);
assert.equal(appliedSummary.regions.leftArm.metrics.fkLocalPctH.frameWorst.p95, 5);
assert.equal(appliedAvatarRegionFrame(row, undefined).metrics.fkLocalPctH.LeftHand, null);
const absentState = appliedAvatarRegionFrame({ ...row, appliedAvatarState: undefined }, reference);
assert.equal(summarizeBodyRegions([absentState]).regions.upperBody.metrics.directionDeg.coverage.completeFrames, 0);
assert.throws(() => appliedAvatarRegionFrame({ ...row, ptsUs: 100001 }, reference), /PTS/);
assert.throws(() => appliedAvatarRegionFrame(row, { ...reference, timing: { sourcePtsSec: 0.2 } }), /PTS/);

// Raw detector and teacher use identical canonical geometry, independent of
// padding/2D input. Low visibility must not silently remove difficult samples.
const live = createSyntheticMotionFrame({ scenario: "identity" });
live.sourceMeta = { sourcePtsSec: 0.1, sourcePtsSource: "rvfc-media-time" };
live.rawPoseObservation = captureRawPoseObservation(live);
const teacher = { ...live, canonicalPose: buildCanonicalPose(live) };
const pair = { ptsUs: 100000, teacherIndex: 1, liveIndex: 1 };
const raw = rawDetectorRegionFrame(live, teacher, pair);
const headPoints = buildCanonicalPosePoints(teacher);
const headVector = Object.fromEntries(['x', 'y', 'z'].map(axis => [axis, headPoints.headCrown[axis] - headPoints.headAimBase[axis]]));
const headSize = Math.hypot(...Object.values(headVector));
candidate.headCrownAxisWorld = Object.fromEntries(Object.entries(headVector).map(([axis, value]) => [axis, value / headSize]));
const cranial = appliedAvatarRegionFrame({ ...row, directionErrorDeg: { head: 90 }, appliedAvatarState: candidate }, reference, teacher);
assert.ok(cranial.metrics.headAxisDeg.HeadCrownAxis < 1e-5, 'Cranial readback must use actual bone origins independently of the old proxy score');
assert.equal(cranial.metrics.directionDeg.head, 90);
assert.equal(appliedAvatarRegionFrame(row, reference).metrics.headAxisDeg.HeadCrownAxis, null);
assert.ok(raw.metrics.directionDeg.leftUpperArm < 0.00001);
const distortedImage = { ...live, poseLandmarks: live.poseLandmarks.map(p => ({ ...p, x: p.x * 0.1 })) };
assert.deepEqual(rawDetectorRegionFrame(distortedImage, teacher, pair), raw);
const lowConfidence = structuredClone(live);
for (const point of lowConfidence.rawPoseObservation.poseWorldLandmarks) point.visibility = 0;
assert.deepEqual(rawDetectorRegionFrame(lowConfidence, teacher, pair).metrics, raw.metrics);
assert.throws(() => rawDetectorRegionFrame({ ...live, rawPoseObservation: undefined }, teacher, pair), /raw detector/);
assert.throws(() => rawDetectorRegionFrame({ ...live, sourceMeta: { ...live.sourceMeta, sourcePtsSource: "currentTime" } }, teacher, pair), /rVFC/);
assert.throws(() => rawDetectorRegionFrame(live, teacher, { ...pair, ptsUs: 100001 }), /PTS/);

console.log("Regional SAM accuracy checks passed: per-side failures, unique torso, real frame P95, coverage, exact PTS, raw/rotation/FK separation");
