#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  MOTION_FRAME_VERSION,
  MOTION_RECORDING_JSONL_FRAME_TYPE,
  MOTION_RECORDING_JSONL_TYPE,
  MOTION_RECORDING_VERSION,
  createMotionFrame,
  createMotionRecording,
  isExternalMotionRecording,
  motionFrameToHandResults,
  motionFrameToPoseResults,
  normalizeExternalMotionRecording,
  normalizeMotionRecording,
  normalizeFace,
  parseMotionRecordingJsonl,
  serializeMotionFrame,
  serializeMotionRecordingJsonl,
} from "../src/motion-frame.js";

function landmarks(count, xOffset = 0) {
  return Array.from({ length: count }, (_, index) => ({
    x: xOffset + index / 1000,
    y: 0.25 + index / 1000,
    z: index / 10000,
    visibility: 0.9,
  }));
}

const pose = landmarks(33, 0.1);
const world = landmarks(33, -0.1);
const leftHand = landmarks(21, 0.2);
const rightHand = landmarks(21, 0.7);
const leftHandWorld = landmarks(21, -0.2);
const rightHandWorld = landmarks(21, -0.7);
const faceLandmarks = landmarks(478, 0.3);
const rawFace = {
  faceLandmarks: [faceLandmarks],
  faceBlendshapes: [
    {
      categories: [
        { categoryName: "eyeBlinkLeft", score: 0.75 },
        { categoryName: "jawOpen", score: 1.25 },
        { categoryName: "badScore", score: Number.NaN },
        { categoryName: "", score: 0.4 },
        { categoryName: "unknownShape", score: -0.2 },
      ],
    },
  ],
  facialTransformationMatrixes: [
    { data: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1]) },
  ],
  sourceMeta: {
    detector: "face",
    ignoredObject: { unsafe: true },
  },
};
const frame = createMotionFrame({
  timestamp: 123.5,
  mirrored: false,
  poseResults: {
    landmarks: [pose],
    worldLandmarks: [world],
  },
  handResults: {
    landmarks: [leftHand, rightHand],
    worldLandmarks: [leftHandWorld, rightHandWorld],
    handedness: [
      [{ categoryName: "Right", score: 0.9 }],
      [{ categoryName: "Left", score: 0.8 }],
    ],
  },
  sourceMeta: {
    inputKind: "video",
    videoFileName: "sample.mp4",
    videoTime: 1.25,
    ignoredObject: { unsafe: true },
  },
  face: rawFace,
  faceOptions: {
    includeLandmarks: true,
  },
});

assert.equal(frame.version, MOTION_FRAME_VERSION);
assert.equal(frame.timestamp, 123.5);
assert.equal(frame.poseLandmarks, pose);
assert.equal(frame.poseWorldLandmarks, world);
assert.equal(frame.leftHandLandmarks, leftHand);
assert.equal(frame.rightHandLandmarks, rightHand);
assert.equal(frame.leftHandWorldLandmarks, leftHandWorld);
assert.equal(frame.rightHandWorldLandmarks, rightHandWorld);
assert.deepEqual(frame.sourceMeta, {
  inputKind: "video",
  videoFileName: "sample.mp4",
  videoTime: 1.25,
});
assert.deepEqual(
  {
    ...frame.face,
    transformMatrix: frame.face.transformMatrix.map((value) => Number(value.toFixed(6))),
  },
  {
    version: 1,
    blendShapes: [
      { name: "eyeBlinkLeft", score: 0.75 },
      { name: "jawOpen", score: 1 },
      { name: "unknownShape", score: 0 },
    ],
    transformMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1],
    landmarks: faceLandmarks,
    sourceMeta: { detector: "face" },
  },
);

const serialized = serializeMotionFrame(frame);
assert.notEqual(serialized.poseLandmarks, pose);
assert.deepEqual(serialized.poseLandmarks[0], pose[0]);
serialized.poseLandmarks[0].x = 99;
assert.notEqual(frame.poseLandmarks[0].x, 99);
serialized.face.blendShapes[0].score = 0;
assert.equal(frame.face.blendShapes[0].score, 0.75);
serialized.leftHandWorldLandmarks[0].x = 99;
assert.notEqual(frame.leftHandWorldLandmarks[0].x, 99);
serialized.face.landmarks[0].x = 99;
assert.notEqual(frame.face.landmarks[0].x, 99);

const poseResults = motionFrameToPoseResults(serialized);
assert.equal(poseResults.landmarks.length, 1);
assert.equal(poseResults.worldLandmarks.length, 1);

const handResults = motionFrameToHandResults(serialized);
assert.equal(handResults.landmarks.length, 2);
assert.equal(handResults.worldLandmarks.length, 2);
assert.equal(handResults.handedness[0][0].categoryName, "Left");
assert.equal(handResults.handedness[1][0].categoryName, "Right");

const recording = createMotionRecording({
  source: { inputKind: "video", videoFileName: "sample.mp4", videoRef: "sample.mp4" },
  frames: [frame],
  createdAt: "2026-07-02T00:00:00.000Z",
  droppedFrames: 2,
});
assert.equal(recording.version, MOTION_RECORDING_VERSION);
assert.equal(recording.frames.length, 1);
assert.equal(recording.droppedFrames, 2);
assert.deepEqual(normalizeMotionRecording(recording), recording);
assert.throws(() => normalizeMotionRecording({ version: 99, frames: [] }), /version 1/);

const recordingJsonl = serializeMotionRecordingJsonl(recording);
const recordingJsonlLines = recordingJsonl.trim().split("\n").map((line) => JSON.parse(line));
assert.equal(recordingJsonlLines.length, 2);
assert.equal(recordingJsonlLines[0].type, MOTION_RECORDING_JSONL_TYPE);
assert.equal(recordingJsonlLines[0].frameCount, 1);
assert.equal(recordingJsonlLines[0].source.videoRef, "sample.mp4");
assert.equal(recordingJsonlLines[1].type, MOTION_RECORDING_JSONL_FRAME_TYPE);
assert.deepEqual(parseMotionRecordingJsonl(recordingJsonl), recording);
assert.throws(
  () => parseMotionRecordingJsonl(`${JSON.stringify({ ...recordingJsonlLines[0], frameCount: 2 })}\n${JSON.stringify(recordingJsonlLines[1])}\n`),
  /frameCount 2 does not match 1/,
);
assert.throws(
  () => serializeMotionRecordingJsonl({
    ...recording,
    source: { ...recording.source, rawVideoBytes: "not allowed" },
  }),
  /raw video or model binary/i,
);

const externalRecording = normalizeExternalMotionRecording({
  version: MOTION_RECORDING_VERSION,
  createdAt: "2026-06-18T00:00:00.000Z",
  source: {
    type: "external-hmr",
    extractor: "gemx",
    jointCount: 77,
    ignoredObject: { unsafe: true },
  },
  frames: [
    {
      version: MOTION_FRAME_VERSION,
      timestamp: 250,
      mirrored: false,
      poseLandmarks: pose,
      poseWorldLandmarks: world,
      leftHandLandmarks: leftHand,
      leftHandWorldLandmarks: leftHandWorld,
      rightHandLandmarks: null,
      rightHandWorldLandmarks: null,
      sourceMeta: {
        extractor: "gemx",
        sourceJointCount: 77,
        mapping: "gemx77-to-mediapipe33",
        ignoredObject: { unsafe: true },
      },
    },
  ],
});
assert.equal(isExternalMotionRecording(externalRecording), true);
assert.deepEqual(externalRecording.source, {
  type: "external-hmr",
  extractor: "gemx",
  jointCount: 77,
});
assert.equal(externalRecording.frames[0].poseLandmarks.length, 33);
assert.equal(externalRecording.frames[0].poseWorldLandmarks.length, 33);
assert.equal(externalRecording.frames[0].leftHandWorldLandmarks.length, 21);
assert.deepEqual(externalRecording.frames[0].sourceMeta, {
  extractor: "gemx",
  sourceJointCount: 77,
  mapping: "gemx77-to-mediapipe33",
});
assert.throws(
  () => normalizeExternalMotionRecording({
    ...externalRecording,
    frames: [{ ...externalRecording.frames[0], poseWorldLandmarks: null }],
  }),
  /poseWorldLandmarks/,
);
assert.throws(
  () => normalizeExternalMotionRecording({
    ...externalRecording,
    frames: [{ ...externalRecording.frames[0], poseLandmarks: pose.slice(0, 32) }],
  }),
  /33 poseLandmarks/,
);
assert.throws(
  () => normalizeExternalMotionRecording({
    ...externalRecording,
    source: { ...externalRecording.source, rawVideoBytes: "not allowed" },
  }),
  /raw video or model binary/i,
);

assert.equal(createMotionFrame({ face: null }).face, null);
assert.equal(normalizeFace({ faceBlendshapes: [] }), null);
assert.equal(normalizeFace({ faceLandmarks: [faceLandmarks] }), null);
assert.equal(normalizeFace({ faceLandmarks: [faceLandmarks] }, { includeLandmarks: true }).landmarks.length, 478);
assert.deepEqual(normalizeFace({
  version: 1,
  blendShapes: [{ name: "mouthSmileLeft", score: 0.5 }],
  transformMatrix: Array.from({ length: 16 }, (_, index) => index),
}).blendShapes, [{ name: "mouthSmileLeft", score: 0.5 }]);

console.log("Motion frame check passed.");
