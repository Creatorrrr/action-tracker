import assert from 'node:assert/strict';
import { palmFrameFromPoints, hand21PalmFrame, comparePalmFrames, handObservationTiming,
  selectConsistentPalmBasis } from '../src/pose/palm-frame.js';
import { appliedAvatarRegionFrame, summarizeBodyRegions, scoreRecordedHandObservations } from '../scripts/lib/sam-body-regions.mjs';

const points = { wrist: { x: 0, y: 0, z: 0 }, index: { x: -1, y: 2, z: 0 },
  middle: { x: 0, y: 2, z: 0 }, pinky: { x: 1, y: 2, z: 0 }, side: 'Left' };
const basis = palmFrameFromPoints(points);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const transformed = transform => palmFrameFromPoints({ ...points,
  ...Object.fromEntries(['wrist', 'index', 'middle', 'pinky'].map(key => [key, transform(points[key])])) });
close(comparePalmFrames(basis, basis).rotationDeg, 0);
const rotated = transformed(p => ({ x: -p.y, y: p.x, z: p.z }));
close(comparePalmFrames(basis, rotated).rotationDeg, 90);
close(comparePalmFrames(basis, rotated).primaryDeg, 90);
close(comparePalmFrames(basis, rotated).normalDeg, 0);
const flipped = transformed(p => ({ x: -p.x, y: p.y, z: -p.z }));
close(comparePalmFrames(basis, flipped).normalDeg, 180);
close(comparePalmFrames(basis, flipped).rotationDeg, 180);
close(comparePalmFrames(basis, transformed(p => ({ x: 3 * p.x + 10, y: 3 * p.y - 5, z: 3 * p.z }))).rotationDeg, 0);
assert.equal(palmFrameFromPoints({ ...points, pinky: points.index }), null);
assert.equal(palmFrameFromPoints({ ...points, wrist: null }), null);
assert.equal(palmFrameFromPoints({ ...points, index: { x: NaN, y: 1, z: 0 } }), null);
assert.equal(comparePalmFrames(basis, null).normalDeg, null);

const hand = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
for (const [index, key] of [[0, 'wrist'], [5, 'index'], [9, 'middle'], [17, 'pinky']]) {
  const p = points[key]; hand[index] = { x: p.x, y: -p.y, z: -p.z };
}
const frame = { leftHandWorldLandmarks: hand };
close(comparePalmFrames(basis, hand21PalmFrame(frame, 'Left')).rotationDeg, 0);
const curled = structuredClone(frame);
for (const i of [1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20]) curled.leftHandWorldLandmarks[i] = { x: 99, y: 90, z: -80 };
close(comparePalmFrames(hand21PalmFrame(frame, 'Left'), hand21PalmFrame(curled, 'Left')).rotationDeg, 0);
const mirrored = hand21PalmFrame({ ...frame, mirrored: true }, 'Left');
close(mirrored.normal.z, basis.normal.z); // A reflection's cross-product parity must be corrected.
assert.equal(hand21PalmFrame(frame, 'Right'), null);
const timed = (pts, observed, extra = {}) => handObservationTiming({ sourceMeta: {
  sourcePtsSec: pts, handLeftObservedSourcePtsSec: observed, ...extra } }, 'Left');
assert.equal(timed(1.2, 1.1).fresh100ms, true);
assert.equal(timed(1.200001, 1.1).fresh100ms, false);
assert.equal(timed(1, 1.000001).causal, false);
assert.equal(timed(1, 1).sameFrame, true);
assert.equal(timed(1, 1, { handLeftPredicted: true }).fresh100ms, false);
assert.equal(timed(1, undefined).ageMs, null);
assert.equal(timed(1, 0, { hands: 'mhr70-to-mediapipe21' }).sameFrame, true);
const pose = { ...basis, valid: true };
assert.equal(selectConsistentPalmBasis(pose, flipped, timed(1, 1)), pose);
assert.equal(selectConsistentPalmBasis(pose, basis, timed(1, 0)), pose);
assert.equal(selectConsistentPalmBasis(pose, basis, timed(1, 1)).hand21Accepted, true);

const reference = { timing: { sourcePtsSec: 1 }, modelHeight: 2,
  palms: { Left: { world: basis, modelLocal: basis } } };
const actual = structuredClone(reference);
actual.palms.Left.world = flipped;
actual.palms.Left.modelLocal.center.x += 0.1;
const row = { ptsUs: 1000000, appliedAvatarState: actual };
const errors = appliedAvatarRegionFrame(row, reference, frame);
close(errors.metrics.directionDeg.leftPalmNormal, 180);
close(errors.metrics.palmFrameDeg.Left, 180);
close(errors.metrics.fkLocalPctH.LeftPalm, 5);
assert.equal(errors.metrics.palmFrameDeg.Right, null);
const summary = summarizeBodyRegions([errors], { expectedFrameCount: 2 });
assert.equal(summary.regions.leftPalm.metrics.palmFrameDeg.coverage.completeFrames, 1);
assert.equal(summary.regions.rightPalm.metrics.palmFrameDeg.coverage.completeFrames, 0);
assert.equal(summary.regions.leftPalm.metrics.palmFrameDeg.diagnostic.withinRatio, 0);
assert.equal(summary.upperLower.palmFrameDeg, undefined);
assert.equal(appliedAvatarRegionFrame(row, reference).metrics.palmFrameDeg.Left, null);
// Hand observations must be evaluated at their own PTS, not at delivery time.
const handFrame = (pts, observed, withHand = true) => ({ mirrored: false,
  ...(withHand ? { leftHandWorldLandmarks: hand } : {}), sourceMeta: {
    sourcePtsSec: pts, sourcePtsSource: 'rvfc-media-time', handLeftObservedSourcePtsSec: observed } });
const movedHand = hand.map(p => ({ x: -p.y, y: p.x, z: p.z }));
const teacherHand = (pts, world) => ({ mirrored: false, sourceMeta: { sourcePtsSec: pts },
  canonicalPose: { status: 'observed' }, leftHandWorldLandmarks: world });
const handCorpus = { liveFrames: [handFrame(0.1, null, false), handFrame(0.2, 0.1), handFrame(0.3, 0.1)],
  teacherFrames: [teacherHand(0.1, hand), teacherHand(0.2, movedHand), teacherHand(0.3, movedHand)] };
const atSource = scoreRecordedHandObservations(handCorpus).Left;
assert.equal(atSource.uniqueRecordedObservations, 1);
assert.equal(atSource.duplicateDeliveries, 1);
assert.equal(atSource.exactScoredObservations, 1);
close(atSource.rotationDeg.p95, 0);
close(atSource.firstDeliveryAgeMs.p95, 100);
assert.equal(atSource.rows[0].ptsUs, 100000);
const badOrigin = structuredClone(handCorpus);
badOrigin.liveFrames[0].sourceMeta.sourcePtsSource = 'current-time-fallback';
assert.equal(scoreRecordedHandObservations(badOrigin).Left.rejected.sourcePtsNotVerified, 1);
const conflict = structuredClone(handCorpus);
conflict.liveFrames[2].leftHandWorldLandmarks = movedHand;
const rejected = scoreRecordedHandObservations(conflict).Left;
assert.equal(rejected.rejected.conflictingObservations, 1);
assert.equal(rejected.rotationDeg.p95, null);
assert.equal(rejected.conditionalCoverage, 0);
console.log('Palm geometry, signed rotations, timing, curl isolation and missing coverage checks passed.');
