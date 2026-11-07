import assert from 'node:assert/strict';
import { detectLetterboxContent, restorePoseImageCoordinates } from '../src/pose/letterbox-input.js';
import { serializeMotionFrame } from '../src/motion-frame.js';
const width = 100, height = 100;
const picture = (left, top, right, bottom) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) data[(y * width + x) * 4] = 180;
  return { data, width, height };
};
const full = { x: 0, y: 0, width: 1, height: 1 };
assert.deepEqual(detectLetterboxContent(picture(30, 0, 69, 99)), { x: 0.28, y: 0, width: 0.44, height: 1 });
assert.deepEqual(detectLetterboxContent(picture(0, 30, 99, 69)), { x: 0, y: 0.28, width: 1, height: 0.44 });
assert.deepEqual(detectLetterboxContent(picture(0, 0, 99, 99)), full);
assert.deepEqual(detectLetterboxContent(picture(30, 0, 99, 99)), full); // Never crop a one-sided dark area.
assert.deepEqual(detectLetterboxContent(picture(40, 0, 69, 99)), full); // Asymmetric content.
assert.deepEqual(detectLetterboxContent(picture(100, 100, 100, 100)), full); // All black.
const world = [{ x: 0.1, y: 0.2, z: 0.3 }];
const frame = { version: 1, poseLandmarks: [{ x: 0.25, y: 0.5, z: -0.2 }], poseWorldLandmarks: world,
  sourceMeta: { sourcePtsSec: 1, bodyInputCropX: 0.3, bodyInputCropY: 0, bodyInputCropWidth: 0.4, bodyInputCropHeight: 1 } };
const mapped = restorePoseImageCoordinates(frame);
assert.deepEqual(mapped.poseLandmarks, [{ x: 0.4, y: 0.5, z: -0.08000000000000002 }]);
assert.equal(mapped.poseWorldLandmarks, world);
assert.equal(mapped.sourceMeta.sourcePtsSec, 1);
assert.deepEqual(JSON.parse(mapped.sourceMeta.detectorCropPoseLandmarksJson), frame.poseLandmarks);
assert.equal(restorePoseImageCoordinates(mapped), mapped);
assert.equal(restorePoseImageCoordinates({ poseLandmarks: world }).poseLandmarks, world);
assert.deepEqual(restorePoseImageCoordinates(serializeMotionFrame(frame)).poseLandmarks, mapped.poseLandmarks);
assert.equal(serializeMotionFrame(mapped).sourceMeta.detectorCropPoseLandmarksJson, mapped.sourceMeta.detectorCropPoseLandmarksJson);
console.log('Letterbox border rejection and exact source image coordinate restoration checks passed.');
