import assert from "node:assert/strict";
import {
  HAND_ROI_SLOT_SIZE,
  buildHandRoiDrawPlan,
  buildPoseGuidedHandRois,
  mapPackedHandLandmarksToSource,
  mapSquareHandLandmarksToSource,
  selectPackedHandRoi,
  stabilizePoseGuidedHandRoi,
} from "../src/hand-roi.js";

function poseLandmarks() {
  return Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 1,
  }));
}

const pose = poseLandmarks();
Object.assign(pose[13], { x: 0.38, y: 0.55 });
Object.assign(pose[15], { x: 0.28, y: 0.5 });
Object.assign(pose[17], { x: 0.23, y: 0.48 });
Object.assign(pose[19], { x: 0.21, y: 0.5 });
Object.assign(pose[21], { x: 0.24, y: 0.53 });
Object.assign(pose[14], { x: 0.62, y: 0.55 });
Object.assign(pose[16], { x: 0.72, y: 0.5 });
Object.assign(pose[18], { x: 0.77, y: 0.48 });
Object.assign(pose[20], { x: 0.79, y: 0.5 });
Object.assign(pose[22], { x: 0.76, y: 0.53 });

const rois = buildPoseGuidedHandRois(pose, 640, 360);
assert.equal(rois.length, 2);
assert.deepEqual(rois.map(({ side, slotIndex }) => ({ side, slotIndex })), [
  { side: "Left", slotIndex: 0 },
  { side: "Right", slotIndex: 1 },
]);
for (const roi of rois) {
  assert.equal(roi.width, roi.height);
  assert.ok(roi.width > 0);
}

const edgePose = poseLandmarks();
Object.assign(edgePose[13], { x: 0.08, y: 0.08 });
Object.assign(edgePose[15], { x: 0.01, y: 0.01 });
Object.assign(edgePose[17], { x: -0.01, y: 0 });
Object.assign(edgePose[19], { x: 0, y: -0.01 });
Object.assign(edgePose[21], { x: 0.02, y: 0 });
edgePose[14].visibility = 0;
edgePose[16].visibility = 0;
const edgeRois = buildPoseGuidedHandRois(edgePose, 640, 360);
assert.equal(edgeRois.length, 1);
assert.equal(edgeRois[0].side, "Left");
assert.ok(edgeRois[0].x < 0);
assert.ok(edgeRois[0].y < 0);
const edgeDrawPlan = buildHandRoiDrawPlan(edgeRois[0]);
assert.ok(edgeDrawPlan);
assert.equal(edgeDrawPlan.sourceX, 0);
assert.equal(edgeDrawPlan.sourceY, 0);
assert.ok(edgeDrawPlan.destinationX > 0);
assert.ok(edgeDrawPlan.destinationY > 0);
assert.ok(edgeDrawPlan.destinationWidth < HAND_ROI_SLOT_SIZE);
assert.ok(edgeDrawPlan.destinationHeight < HAND_ROI_SLOT_SIZE);
assert.ok(edgeDrawPlan.paddingRatio > 0);
assert.ok(edgeDrawPlan.visibleRatio < 1);

const missingPose = poseLandmarks();
missingPose[13].visibility = 0.1;
missingPose[14].visibility = 0.1;
assert.deepEqual(buildPoseGuidedHandRois(missingPose, 640, 360), []);

const rightRoi = rois[1];
const sourcePoint = {
  x: (rightRoi.x + rightRoi.width * 0.25) / rightRoi.sourceWidth,
  y: (rightRoi.y + rightRoi.height * 0.75) / rightRoi.sourceHeight,
};
const packedPoint = {
  x: (HAND_ROI_SLOT_SIZE + HAND_ROI_SLOT_SIZE * 0.25) /
    (HAND_ROI_SLOT_SIZE * 2),
  y: 0.75,
  z: 0.1,
};
const selected = selectPackedHandRoi([packedPoint], rois);
assert.equal(selected.side, "Right");
const [roundTrip] = mapPackedHandLandmarksToSource([packedPoint], selected);
assert.ok(Math.abs(roundTrip.x - sourcePoint.x) < 1e-9);
assert.ok(Math.abs(roundTrip.y - sourcePoint.y) < 1e-9);
assert.ok(Number.isFinite(roundTrip.z));

const [squareRoundTrip] = mapSquareHandLandmarksToSource([
  { x: 0.25, y: 0.75, z: 0.1 },
], rightRoi);
assert.ok(Math.abs(squareRoundTrip.x - sourcePoint.x) < 1e-9);
assert.ok(Math.abs(squareRoundTrip.y - sourcePoint.y) < 1e-9);
assert.ok(Number.isFinite(squareRoundTrip.z));

const episodeStart = stabilizePoseGuidedHandRoi(rightRoi);
assert.equal(episodeStart.reason, "episode-start");
assert.equal(episodeStart.transformChanged, false);
assert.ok(episodeStart.roi.width > rightRoi.width);
const smallMove = {
  ...rightRoi,
  x: rightRoi.x + episodeStart.roi.width * 0.03,
};
const stableEpisode = stabilizePoseGuidedHandRoi(smallMove, episodeStart.roi);
assert.equal(stableEpisode.reason, "episode-stable");
assert.equal(stableEpisode.transformChanged, false);
assert.equal(stableEpisode.roi, episodeStart.roi);
const bandMove = {
  ...rightRoi,
  x: rightRoi.x + episodeStart.roi.width * 0.25,
};
const bandEpisode = stabilizePoseGuidedHandRoi(bandMove, episodeStart.roi);
assert.equal(bandEpisode.reason, "episode-hysteresis-band");
assert.equal(bandEpisode.transformChanged, false);
const largeMove = {
  ...rightRoi,
  x: rightRoi.x + episodeStart.roi.width * 0.38,
};
const movedEpisode = stabilizePoseGuidedHandRoi(largeMove, episodeStart.roi);
assert.equal(movedEpisode.reason, "candidate-left-outer-band");
assert.equal(movedEpisode.transformChanged, true);
assert.notEqual(movedEpisode.roi.x, episodeStart.roi.x);
const forcedEpisode = stabilizePoseGuidedHandRoi(
  smallMove,
  episodeStart.roi,
  { forceRecommit: true },
);
assert.equal(forcedEpisode.reason, "forced-reacquire");
assert.equal(forcedEpisode.transformChanged, true);
assert.ok(forcedEpisode.roi.width > episodeStart.roi.width);
const heldPoseGap = stabilizePoseGuidedHandRoi(null, episodeStart.roi, {
  reusePrevious: true,
});
assert.equal(heldPoseGap.reason, "held-pose-gap");
assert.equal(heldPoseGap.roi, episodeStart.roi);
assert.equal(stabilizePoseGuidedHandRoi(null).roi, null);

console.log("Hand ROI check passed");
