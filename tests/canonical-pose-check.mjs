import assert from "node:assert/strict";
import { createSyntheticMotionFrame } from "../scripts/generate-synthetic-landmarks.mjs";
import { buildCanonicalPose, buildCanonicalPosePoints, canonicalFrameTimestampMs } from "../src/pose/canonical-pose.js";
import { preparePoseObservation } from "../src/pose/observation-adapter.js";
import { createSamReferenceFrame } from "../src/pose/sam-reference.js";
import { createMotionRecording, serializeMotionRecordingJsonl, parseMotionRecordingJsonl,
  normalizeExternalMotionRecording } from "../src/motion-frame.js";
import { buildPosePoints, solvePoseFrame } from "../src/solver/pose-solver.js";
import { decoderPtsMicroseconds, pairSourceFrames } from "../scripts/lib/sam-pairing.mjs";

const frame = createSyntheticMotionFrame({ scenario: "identity" });
// Synthetic fixtures are Y-up; detector observations are camera Y-down.
frame.poseWorldLandmarks = frame.poseWorldLandmarks.map((p) => ({ ...p, y: -p.y, z: -p.z }));
const original = structuredClone(frame);
const candidate = preparePoseObservation(frame, { mode: "canonical-world" });
assert.deepEqual(frame, original, "preparing a pose must not mutate detector output");
const padded = structuredClone(frame);
padded.poseLandmarks = padded.poseLandmarks.map((p) => ({ ...p, x: p.x * 0.2 + 0.4, y: p.y * 0.7 + 0.1 }));
assert.deepEqual(buildCanonicalPose(padded).landmarks, candidate.canonicalPose.landmarks,
  "padding and image aspect must not change world geometry");
const translated = structuredClone(frame);
translated.poseWorldLandmarks = translated.poseWorldLandmarks.map((p) => ({ ...p, x: p.x + 4, y: p.y - 5, z: p.z + 8 }));
for (let i = 0; i < 33; i++) for (const axis of ["x", "y", "z"]) {
  assert.ok(Math.abs(buildCanonicalPose(translated).landmarks[i][axis] - candidate.canonicalPose.landmarks[i][axis]) < 1e-12);
}
const mirror = buildCanonicalPose({ ...frame, mirrored: !frame.mirrored });
for (let i = 0; i < 33; i++) {
  assert.equal(mirror.landmarks[i].x, -candidate.canonicalPose.landmarks[i].x || 0);
  assert.equal(mirror.landmarks[i].z, candidate.canonicalPose.landmarks[i].z);
}
assert.equal(buildCanonicalPose({ ...frame, poseWorldLandmarks: null }).status, "unavailable");
assert.equal(buildCanonicalPose({ ...frame, sourceMeta: { canonicalSkeletonAdapter: "old" } }).status, "unavailable");
assert.deepEqual(buildPosePoints(candidate), buildCanonicalPosePoints(candidate), "offline and product must share the point builder");
assert.equal(buildPosePoints(candidate).spineMid.derived, "linear-torso-prior");
assert.ok(solvePoseFrame(candidate).targets.length >= 16);
assert.equal(canonicalFrameTimestampMs({ timestamp: 9000, sourceMeta: { inputKind: "video", sourcePtsSec: 0 } }), 0);
assert.equal(solvePoseFrame({ ...candidate, timestamp: 9000, sourceMeta: { inputKind: "video", sourcePtsSec: 1.5 } }).timestamp, 1500);
assert.equal(canonicalFrameTimestampMs({ timestamp: 9000, sourceMeta: { inputKind: "camera", sourcePtsSec: 1.5, callbackMonotonicMs: 8000 } }), 8000);
const legacy = preparePoseObservation(frame, { mode: "legacy-hybrid" });
assert.deepEqual(legacy.rawPoseObservation.poseWorldLandmarks, original.poseWorldLandmarks);
const restored = preparePoseObservation(legacy, { mode: "canonical-world" });
assert.deepEqual(restored.canonicalPose.landmarks, candidate.canonicalPose.landmarks,
  "canonical replay must read preserved detector observations, not fixed flex corrections");
const returnedToLegacy = preparePoseObservation(restored, { mode: "legacy-hybrid" });
assert.deepEqual(returnedToLegacy.poseWorldLandmarks, legacy.poseWorldLandmarks);
assert.deepEqual(returnedToLegacy.poseLandmarks, legacy.poseLandmarks);
assert.deepEqual(preparePoseObservation(legacy, { mode: "legacy-hybrid" }).poseWorldLandmarks, legacy.poseWorldLandmarks,
  "legacy replay must apply its bias exactly once from raw");
assert.equal(restored.sourceMeta.canonicalSkeletonAdapter, undefined, "canonical mode must not retain stale legacy correction metadata");
const recording = createMotionRecording({ frames: [candidate, legacy] });
const roundtrip = parseMotionRecordingJsonl(serializeMotionRecordingJsonl(recording));
assert.deepEqual(roundtrip.frames[0].canonicalPose, candidate.canonicalPose);
assert.deepEqual(roundtrip.frames[1].rawPoseObservation, JSON.parse(JSON.stringify(legacy.rawPoseObservation)));
roundtrip.frames[0].rawPoseObservation.poseWorldLandmarks[0].x += 99;
assert.deepEqual(frame, original, "recording data must not alias detector arrays");

const decoderFrame = { clipId: "test", sourceFrameIndex: 0, ptsTicks: "512", timeBase: { numerator: 1, denominator: 15360 }, loopEpoch: 0 };
const joints = Array.from({ length: 70 }, (_, i) => [i * 0.01, -i * 0.02, i * 0.03]);
const row = { frame_index: 0, timestamp_sec: 0, image_size: { width: 720, height: 1280 }, persons: [{
  person_id: 7, keypoints_mhr70_3d: joints, keypoints_mhr70_2d: joints.map(() => [800, -20]),
  pred_cam_t: [1, 2, 3], mhr_joint_coords_127_3d: Array.from({ length: 127 }, () => [1, 2, 3]),
}] };
const teacher = createSamReferenceFrame(row, { decoderFrame, clipId: "test" });
assert.equal(teacher.timestamp, 1000 / 30);
assert.equal(teacher.sourceMeta.ptsTicks, "512");
assert.equal(teacher.sourceMeta.personId, 7);
assert.ok(teacher.poseLandmarks[0].x > 1, "off-screen reference joints must not be clamped");
assert.equal(Object.keys(teacher.canonicalPose.jointsMhr70).length, 70);
assert.deepEqual(teacher.rawSamObservation.person.pred_cam_t, [1, 2, 3]);
const missing = createSamReferenceFrame({ ...row, persons: [] }, { decoderFrame, clipId: "test" });
assert.equal(missing.canonicalPose.status, "unavailable");
assert.equal(missing.poseWorldLandmarks, null);
assert.throws(() => createSamReferenceFrame(row, { decoderFrame: { ...decoderFrame, sourceFrameIndex: 1 }, clipId: "test" }), /exact/);
const teacherRecording = normalizeExternalMotionRecording(createMotionRecording({
  source: { type: "external-hmr", extractor: "sam3d-body" }, frames: [teacher, missing],
}));
assert.equal(teacherRecording.frames.length, 2, "missing person frames must remain in the time axis");
assert.equal(teacherRecording.frames[0].rawSamObservation.person.mhr_joint_coords_127_3d.length, 127);
assert.equal(decoderPtsMicroseconds(decoderFrame), 33333);
const rvfcFrame = {
  rawPoseObservation: { provenance: "detector-output", sourcePtsSec: 0.033333 },
  sourceMeta: { sourcePtsSec: 0.033333, sourcePtsSource: "rvfc-media-time" },
};
assert.equal(pairSourceFrames([rvfcFrame], [decoderFrame], [teacher]).matchedCount, 1);
assert.equal(pairSourceFrames([{ ...rvfcFrame, sourceMeta: { ...rvfcFrame.sourceMeta, sourcePtsSource: "video-current-time-rvfc-fallback" } }],
  [decoderFrame], [teacher]).matchedCount, 0, "seek currentTime must not masquerade as decoded frame PTS");
assert.equal(pairSourceFrames([{ ...rvfcFrame, rawPoseObservation: { ...rvfcFrame.rawPoseObservation, sourcePtsSec: .033334 },
  sourceMeta: { ...rvfcFrame.sourceMeta, sourcePtsSec: .033334 } }], [decoderFrame], [teacher]).matchedCount, 0,
  "must not silently pair a nearby timestamp");
assert.throws(() => pairSourceFrames([rvfcFrame, rvfcFrame], [decoderFrame], [teacher]), /Duplicate/);
assert.throws(() => pairSourceFrames([{ ...rvfcFrame, rawPoseObservation: { provenance: "adapted-only" } }], [decoderFrame], [teacher]), /raw detector/);
console.log("Canonical pose, raw replay and exact SAM reference checks passed");
