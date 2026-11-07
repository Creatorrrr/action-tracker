import assert from 'node:assert/strict';
import { buildCanonicalPose } from '../src/pose/canonical-pose.js';
import { reprojectCanonicalPose } from '../src/pose/reprojection-pose.js';

// Known orthographic camera, independent of the fitter: image-height units,
// uniform scale 3, translated detector coordinates, nonzero depth.
const world = Array.from({ length: 33 }, (_, i) => ({
  x: 0.4 + Math.sin(i) * 0.3, y: -0.6 + i * 0.03, z: 0.2 + i * 0.002, visibility: 1,
}));
function observation(width, height, mirrored = false) {
  return { mirrored, sourceMeta: { sourcePtsSec: 1 }, rawPoseObservation: {
    version: 1, provenance: 'detector-output', sourcePtsSec: 1, poseWorldLandmarks: world,
    poseLandmarks: world.map(p => ({ x: 0.5 + (p.x - 0.2) / 3 / (width / height),
      y: 0.5 + (p.y + 0.1) / 3, z: 0, visibility: 1 })),
  } };
}
for (const [width, height] of [[1080, 1080], [1920, 1080], [1080, 1920]]) for (const mirrored of [false, true]) {
  const frame = observation(width, height, mirrored), before = structuredClone(frame);
  const expected = buildCanonicalPose(frame), actual = reprojectCanonicalPose(frame, { width, height });
  assert.ok(Math.abs(actual.geometryCorrection.scale - 3) < 1e-12);
  for (let i = 0; i < 33; i++) for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual.landmarks[i][axis] - expected.landmarks[i][axis]) < 1e-12);
  }
  assert.deepEqual(frame, before, 'Experimental projection must not mutate raw observations');
  assert.equal(actual.sourcePtsSec, 1);
}
const frame = observation(1920, 1080);
assert.deepEqual(reprojectCanonicalPose(frame), buildCanonicalPose(frame));
assert.deepEqual(reprojectCanonicalPose(frame, { width: 1920, height: 0 }), buildCanonicalPose(frame));
const degenerate = structuredClone(frame);
degenerate.rawPoseObservation.poseLandmarks.forEach(p => { p.x = 0.5; p.y = 0.5; });
assert.deepEqual(reprojectCanonicalPose(degenerate, { width: 1920, height: 1080 }), buildCanonicalPose(degenerate));
const sparse = structuredClone(frame);
sparse.rawPoseObservation.poseLandmarks.forEach(p => { p.visibility = 0; });
assert.deepEqual(reprojectCanonicalPose(sparse, { width: 1920, height: 1080 }), buildCanonicalPose(sparse));
console.log('Experimental reprojection: known camera, aspect/mirror invariance, immutable raw and degenerate fallback passed.');
