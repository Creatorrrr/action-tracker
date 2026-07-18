#!/usr/bin/env node
import assert from "node:assert/strict";

import {
  createAtomicVideoTrackerGenerationOwner,
  createInputGenerationPlaybackGate,
  createPrewarmedVideoTrackerGenerationOwner,
  createStatelessImageTrackerGenerationOwner,
} from "../src/tracking-input-generation.js";
import { createVideoPlaybackBackpressureController } from "../src/video-playback-backpressure.js";
import {
  createMotionFrame,
  serializeMotionFrame,
} from "../src/motion-frame.js";

function createDetector(id, { closeThrows = false } = {}) {
  return {
    id,
    closeCalls: 0,
    close() {
      this.closeCalls += 1;
      if (closeThrows) {
        throw new Error(`${id} close failure`);
      }
    },
  };
}

function createVideoDetector(id, { onSetOptions = null } = {}) {
  return {
    ...createDetector(id),
    setOptionsCalls: [],
    async setOptions(options) {
      const snapshot = { ...options };
      this.setOptionsCalls.push(snapshot);
      await onSetOptions?.(snapshot, this);
    },
  };
}

function createPoseStateResets() {
  return [{
    id: "pose",
    reset: async (detector) => {
      await detector.setOptions({ runningMode: "IMAGE" });
      await detector.setOptions({ runningMode: "VIDEO" });
    },
  }];
}

function createPrewarmedPosePoolSlots(current, standby, delegate = "GPU") {
  return [
    {
      slotId: "current",
      delegate,
      prewarmed: true,
      primeDurationMs: 12,
      detectors: [{ id: "pose", detector: current }],
    },
    {
      slotId: "standby",
      delegate,
      prewarmed: true,
      primeDurationMs: 8,
      detectors: [{ id: "pose", detector: standby }],
    },
  ];
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

let clock = 0;
const owner = createStatelessImageTrackerGenerationOwner({ now: () => clock++ });
const initialPose = createDetector("initial-pose");
let initialFactoryCalls = 0;
const initialInstall = await owner.installConfiguration({
  configurationKey: "pose-a",
  detectorFactories: [
    {
      id: "pose",
      create: () => {
        initialFactoryCalls += 1;
        return initialPose;
      },
    },
  ],
});
assert.equal(initialInstall.bodyTrackerResetStrategy, "configuration-install");
assert.equal(initialInstall.bodyTrackerSeededDetectors, "pose");
assert.equal(initialInstall.bodyTrackerRecreateCount, 0);
assert.equal(initialFactoryCalls, 1);

const seeded = await owner.prepare({
  inputGeneration: 0,
  configurationKey: "pose-a",
});
assert.equal(seeded.bodyTrackerResetStrategy, "fresh-bind");
assert.equal(seeded.bodyTrackerSeededDetectors, "pose");
assert.equal(seeded.bodyTrackerRecreateCount, 0);
assert.equal(owner.getPreparedSet(0).pose, initialPose);

const sameGeneration = await owner.prepare({
  inputGeneration: 0,
  configurationKey: "pose-a",
});
assert.equal(sameGeneration.bodyTrackerResetStrategy, "reuse");
assert.equal(initialPose.closeCalls, 0);

const rebound = await owner.prepare({
  inputGeneration: 1,
  configurationKey: "pose-a",
});
assert.equal(rebound.bodyTrackerResetStrategy, "stateless-rebind");
assert.equal(initialFactoryCalls, 1, "generation rebind must not call a detector factory");
assert.equal(initialPose.closeCalls, 0, "generation rebind must not close the detector");
assert.equal(owner.getPreparedSet(1, "pose-a").pose, initialPose);

const sameConfiguration = await owner.installConfiguration({
  configurationKey: "pose-a",
  detectorFactories: [{
    id: "pose",
    create: () => {
      throw new Error("same configuration factory must not run");
    },
  }],
});
assert.equal(sameConfiguration.bodyTrackerResetStrategy, "configuration-reuse");
assert.equal(initialPose.closeCalls, 0);

const replacementReady = deferred();
const replacementPose = createDetector("replacement-pose");
const replacing = owner.installConfiguration({
  configurationKey: "pose-b",
  detectorFactories: [{ id: "pose", create: () => replacementReady.promise }],
});
await Promise.resolve();
assert.equal(
  owner.getPreparedSet(1, "pose-a").pose,
  initialPose,
  "configuration candidates must not replace the live detector before commit",
);
replacementReady.resolve(replacementPose);
const replaced = await replacing;
assert.equal(replaced.bodyTrackerResetStrategy, "configuration-replace");
assert.equal(replaced.bodyTrackerRecreateDetectors, "pose");
assert.equal(initialPose.closeCalls, 1);
assert.throws(() => owner.getPreparedSet(1, "pose-b"), /not prepared/);

const failedCandidatePose = createDetector("failed-candidate-pose");
await assert.rejects(
  owner.installConfiguration({
    configurationKey: "pose-c",
    detectorFactories: [
      { id: "pose", create: () => failedCandidatePose },
      { id: "aux", create: () => Promise.reject(new Error("synthetic install failure")) },
    ],
  }),
  /Failed to install stateless IMAGE tracker configuration/,
);
assert.equal(failedCandidatePose.closeCalls, 1, "partial candidates must be closed");
const preparedReplacement = await owner.prepare({
  inputGeneration: 2,
  configurationKey: "pose-b",
});
assert.equal(preparedReplacement.bodyTrackerRecreateErrors, 1);
assert.equal(owner.getPreparedSet(2, "pose-b").pose, replacementPose);
assert.throws(
  () => owner.getPreparedSet(2, "pose-a"),
  /response configuration does not match/,
);

assert.equal(
  owner.reserve(4),
  true,
  "message receipt must reserve a newer generation before serialized work",
);
await assert.rejects(
  owner.prepare({ inputGeneration: 3, configurationKey: "pose-b" }),
  /Stale stateless IMAGE tracker generation/,
);
assert.equal(owner.reserve(3), false);
const finalPrepare = await owner.prepare({
  inputGeneration: 4,
  configurationKey: "pose-b",
});
assert.equal(finalPrepare.bodyTrackerResetStrategy, "stateless-rebind");
assert.equal(owner.getPreparedSet(4, "pose-b").pose, replacementPose);

await assert.rejects(
  owner.prepare({ inputGeneration: Number.NaN }),
  /non-negative safe integer/,
);

const serializedRebind = serializeMotionFrame(createMotionFrame({
  sourceMeta: finalPrepare,
}));
assert.equal(serializedRebind.sourceMeta.bodyTrackerResetDetectors, "");
assert.equal(serializedRebind.sourceMeta.bodyTrackerRecreateCount, 0);

owner.dispose();
owner.dispose();
assert.equal(replacementPose.closeCalls, 1, "dispose must close a detector exactly once");
await assert.rejects(
  owner.prepare({ inputGeneration: 5, configurationKey: "pose-b" }),
  /disposed/,
);

const videoOwner = createAtomicVideoTrackerGenerationOwner({ now: () => clock++ });
const videoInitialPose = createVideoDetector("video-initial-pose");
videoOwner.installInitial({
  configurationKey: "video-pose-a",
  detectors: [{ id: "pose", detector: videoInitialPose }],
});

const videoSeeded = await videoOwner.prepare({
  inputGeneration: 10,
  configurationKey: "video-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(videoSeeded.bodyTrackerResetStrategy, "temporal-state-reset");
assert.equal(videoSeeded.bodyTrackerResetCount, 1);
assert.equal(videoSeeded.bodyTrackerResetDetectors, "pose");
assert.equal(videoSeeded.bodyTrackerRecreateCount, 0);
assert.deepEqual(
  videoInitialPose.setOptionsCalls,
  [{ runningMode: "IMAGE" }, { runningMode: "VIDEO" }],
  "first generation must reset Pose state without consuming pixels",
);
assert.equal(videoInitialPose.closeCalls, 0);
assert.equal(videoOwner.getPreparedSet(10).pose, videoInitialPose);

const videoSameGeneration = await videoOwner.prepare({
  inputGeneration: 10,
  configurationKey: "video-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(videoSameGeneration.bodyTrackerResetStrategy, "reuse");
assert.equal(videoSameGeneration.bodyTrackerResetCount, 0);
assert.equal(videoInitialPose.setOptionsCalls.length, 2);

const [videoReset, videoResetReuse] = await Promise.all([
  videoOwner.prepare({
    inputGeneration: 11,
    configurationKey: "video-pose-a",
    detectorStateResets: createPoseStateResets(),
  }),
  videoOwner.prepare({
    inputGeneration: 11,
    configurationKey: "video-pose-a",
    detectorStateResets: createPoseStateResets(),
  }),
]);
assert.equal(videoReset.bodyTrackerResetStrategy, "temporal-state-reset");
assert.equal(videoReset.bodyTrackerResetCount, 1);
assert.equal(videoResetReuse.bodyTrackerResetStrategy, "reuse");
assert.equal(videoResetReuse.bodyTrackerResetCount, 0);
assert.equal(videoInitialPose.setOptionsCalls.length, 4);
assert.equal(videoInitialPose.closeCalls, 0);
assert.equal(videoOwner.getPreparedSet(11).pose, videoInitialPose);

const videoReplacementPose = createVideoDetector("video-replacement-pose");
let videoReplacementFactoryCalls = 0;
const videoRecreated = await videoOwner.prepare({
  inputGeneration: 12,
  configurationKey: "video-pose-b",
  detectorStateResets: createPoseStateResets(),
  detectorFactories: [{
    id: "pose",
    create: () => {
      videoReplacementFactoryCalls += 1;
      return videoReplacementPose;
    },
  }],
});
assert.equal(videoRecreated.bodyTrackerResetStrategy, "detector-recreate");
assert.equal(videoRecreated.bodyTrackerRecreateDetectors, "pose");
assert.equal(videoRecreated.bodyTrackerResetDetectors, "pose");
assert.equal(videoReplacementFactoryCalls, 1);
assert.equal(videoInitialPose.closeCalls, 1);
assert.deepEqual(
  videoReplacementPose.setOptionsCalls,
  [{ runningMode: "IMAGE" }, { runningMode: "VIDEO" }],
);
assert.equal(videoOwner.getPreparedSet(12).pose, videoReplacementPose);

const videoReuse = await videoOwner.prepare({
  inputGeneration: 12,
  configurationKey: "video-pose-b",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(videoReuse.bodyTrackerResetStrategy, "reuse");
assert.equal(videoReplacementFactoryCalls, 1);
assert.equal(videoReplacementPose.setOptionsCalls.length, 2);

assert.equal(videoOwner.reserve(14), true);
await assert.rejects(
  videoOwner.prepare({
    inputGeneration: 13,
    configurationKey: "video-pose-b",
    detectorStateResets: createPoseStateResets(),
    detectorFactories: [{ id: "pose", create: () => createDetector("stale") }],
  }),
  /Stale VIDEO tracker generation/,
);

const videoRestarted = await videoOwner.prepare({
  inputGeneration: 14,
  configurationKey: "video-pose-b",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(videoRestarted.bodyTrackerResetStrategy, "temporal-state-reset");
assert.equal(videoReplacementPose.closeCalls, 0);
assert.equal(videoOwner.getPreparedSet(14).pose, videoReplacementPose);

videoOwner.dispose();
assert.equal(videoReplacementPose.closeCalls, 1);

const resetFailureOwner = createAtomicVideoTrackerGenerationOwner();
const resetFailurePose = createVideoDetector("reset-failure-pose", {
  onSetOptions: ({ runningMode }) => {
    if (runningMode === "VIDEO") {
      throw new Error("reset transition failed");
    }
  },
});
resetFailureOwner.installInitial({
  configurationKey: "reset-failure",
  detectors: [{ id: "pose", detector: resetFailurePose }],
});
let resetFailureFactoryCalls = 0;
await assert.rejects(
  resetFailureOwner.prepare({
    inputGeneration: 0,
    configurationKey: "reset-failure",
    detectorStateResets: createPoseStateResets(),
    detectorFactories: [{
      id: "pose",
      create: () => {
        resetFailureFactoryCalls += 1;
        return createVideoDetector("must-not-recreate");
      },
    }],
  }),
  /Failed to reset VIDEO tracker state/,
);
assert.equal(resetFailureFactoryCalls, 0, "reset failure must not recreate");
assert.equal(resetFailurePose.closeCalls, 0, "reset failure keeps the existing instance");
assert.throws(() => resetFailureOwner.getPreparedSet(0), /not prepared/);
assert.equal(resetFailureOwner.getTelemetry().bodyTrackerResetErrors, 1);
resetFailureOwner.dispose();
assert.equal(resetFailurePose.closeCalls, 1);

const supersededResetOwner = createAtomicVideoTrackerGenerationOwner();
const resetReachedVideo = deferred();
let holdFirstVideoReset = true;
const supersededResetPose = createVideoDetector("superseded-reset-pose", {
  onSetOptions: async ({ runningMode }) => {
    if (runningMode === "VIDEO" && holdFirstVideoReset) {
      await resetReachedVideo.promise;
    }
  },
});
supersededResetOwner.installInitial({
  configurationKey: "superseded-reset",
  detectors: [{ id: "pose", detector: supersededResetPose }],
});
const supersededPreparation = supersededResetOwner.prepare({
  inputGeneration: 1,
  configurationKey: "superseded-reset",
  detectorStateResets: createPoseStateResets(),
});
await Promise.resolve();
await Promise.resolve();
assert.equal(supersededResetOwner.reserve(2), true);
holdFirstVideoReset = false;
resetReachedVideo.resolve();
await assert.rejects(supersededPreparation, /superseded by 2 after its state reset/);
assert.equal(supersededResetPose.closeCalls, 0);
const preparedAfterSupersession = await supersededResetOwner.prepare({
  inputGeneration: 2,
  configurationKey: "superseded-reset",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(preparedAfterSupersession.bodyTrackerResetStrategy, "temporal-state-reset");
assert.equal(supersededResetOwner.getPreparedSet(2).pose, supersededResetPose);
supersededResetOwner.dispose();
assert.equal(supersededResetPose.closeCalls, 1);

const prewarmedPoolOwner = createPrewarmedVideoTrackerGenerationOwner({
  now: () => clock++,
});
const prewarmedCurrentPose = createVideoDetector("prewarmed-current-pose");
const prewarmedStandbyPose = createVideoDetector("prewarmed-standby-pose");
const installedPool = prewarmedPoolOwner.installPrewarmedPool({
  configurationKey: "prewarmed-pose-a",
  poolSlots: createPrewarmedPosePoolSlots(
    prewarmedCurrentPose,
    prewarmedStandbyPose,
  ),
});
assert.equal(installedPool.bodyTrackerPoolSize, 2);
assert.equal(installedPool.bodyTrackerPoolCleanCount, 2);
assert.equal(installedPool.bodyTrackerPoolPrewarmedCount, 2);
assert.equal(installedPool.bodyTrackerPoolPrimeDurationMs, 20);
assert.equal(installedPool.bodyTrackerPoolPrimeSlot0DurationMs, 12);
assert.equal(installedPool.bodyTrackerPoolPrimeSlot1DurationMs, 8);
assert.equal(installedPool.bodyTrackerDirtyLeaseCount, 0);

const firstCleanLease = await prewarmedPoolOwner.prepare({
  inputGeneration: 20,
  configurationKey: "prewarmed-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(firstCleanLease.bodyTrackerResetStrategy, "prewarmed-clean-bind");
assert.equal(firstCleanLease.bodyTrackerResetCount, 0);
assert.equal(firstCleanLease.bodyTrackerPoolCleanCount, 1);
assert.equal(firstCleanLease.bodyTrackerPrewarmedSwapCount, 0);
assert.equal(prewarmedPoolOwner.getPreparedSet(20).pose, prewarmedCurrentPose);
assert.equal(
  prewarmedCurrentPose.setOptionsCalls.length,
  0,
  "first generation must bind the primed current slot without setOptions",
);

const secondCleanLease = await prewarmedPoolOwner.prepare({
  inputGeneration: 21,
  configurationKey: "prewarmed-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(secondCleanLease.bodyTrackerResetStrategy, "prewarmed-clean-swap");
assert.equal(secondCleanLease.bodyTrackerResetCount, 0);
assert.equal(secondCleanLease.bodyTrackerPoolCleanCount, 0);
assert.equal(secondCleanLease.bodyTrackerPrewarmedSwapCount, 1);
assert.equal(prewarmedPoolOwner.getPreparedSet(21).pose, prewarmedStandbyPose);
assert.equal(
  prewarmedStandbyPose.setOptionsCalls.length,
  0,
  "second generation must swap to the clean primed standby without setOptions",
);

const thirdFallbackLease = await prewarmedPoolOwner.prepare({
  inputGeneration: 22,
  configurationKey: "prewarmed-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(
  thirdFallbackLease.bodyTrackerResetStrategy,
  "synchronous-dirty-standby-reset",
);
assert.equal(thirdFallbackLease.bodyTrackerResetCount, 1);
assert.equal(thirdFallbackLease.bodyTrackerFallbackResetCount, 1);
assert.equal(thirdFallbackLease.bodyTrackerDirtyLeaseCount, 0);
assert.equal(prewarmedPoolOwner.getPreparedSet(22).pose, prewarmedCurrentPose);
assert.deepEqual(
  prewarmedCurrentPose.setOptionsCalls,
  [{ runningMode: "IMAGE" }, { runningMode: "VIDEO" }],
  "third generation must synchronously clean the inactive dirty slot before lease",
);
assert.equal(prewarmedStandbyPose.setOptionsCalls.length, 0);

const repeatedThirdLease = await prewarmedPoolOwner.prepare({
  inputGeneration: 22,
  configurationKey: "prewarmed-pose-a",
  detectorStateResets: createPoseStateResets(),
});
assert.equal(repeatedThirdLease.bodyTrackerResetStrategy, "reuse");
assert.equal(prewarmedCurrentPose.setOptionsCalls.length, 2);
assert.equal(prewarmedPoolOwner.getTelemetry().bodyTrackerDirtyLeaseCount, 0);

prewarmedPoolOwner.dispose();
prewarmedPoolOwner.dispose();
assert.equal(prewarmedCurrentPose.closeCalls, 1);
assert.equal(prewarmedStandbyPose.closeCalls, 1);

function createPlaybackMedia({ paused = false } = {}) {
  return {
    paused,
    pauseCalls: 0,
    playCalls: 0,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      this.paused = false;
      return Promise.resolve();
    },
  };
}

let playbackClock = 100;
const playbackGate = createInputGenerationPlaybackGate({
  now: () => playbackClock,
});
const playbackMedia = createPlaybackMedia();

const firstGate = playbackGate.begin({
  inputGeneration: 0,
  media: playbackMedia,
});
assert.equal(firstGate.bodyTrackerPlaybackGated, true);
assert.equal(firstGate.bodyTrackerPlaybackGateGeneration, 0);
assert.equal(playbackMedia.pauseCalls, 1, "fresh generation must pause synchronously");
assert.equal(playbackMedia.paused, true);

playbackClock = 112;
const repeatedBegin = playbackGate.begin({
  inputGeneration: 0,
  media: playbackMedia,
});
assert.equal(repeatedBegin.bodyTrackerPlaybackGateDurationMs, 12);
assert.equal(playbackMedia.pauseCalls, 1, "same in-flight generation reuses its gate");

playbackClock = 118;
const appliedRelease = playbackGate.completeApplied(0);
assert.equal(appliedRelease.bodyTrackerPlaybackGateResumeReason, "applied");
assert.equal(appliedRelease.bodyTrackerPlaybackGateDurationMs, 18);
assert.equal(appliedRelease.bodyTrackerPlaybackGateResumeRequested, true);
assert.equal(playbackMedia.playCalls, 1);
assert.equal(playbackGate.getStatus().bodyTrackerAppliedGeneration, 0);

const sameAppliedGeneration = playbackGate.begin({
  inputGeneration: 0,
  media: playbackMedia,
});
assert.equal(sameAppliedGeneration.bodyTrackerPlaybackGated, false);
assert.equal(playbackMedia.pauseCalls, 1, "an applied generation must not gate again");
assert.throws(
  () => playbackGate.begin({ inputGeneration: -1, media: playbackMedia }),
  /non-negative safe integer/,
);

playbackClock = 130;
playbackGate.begin({ inputGeneration: 1, media: playbackMedia });
playbackClock = 137;
const errorRelease = playbackGate.release(1, "error");
assert.equal(errorRelease.bodyTrackerPlaybackGateResumeReason, "error");
assert.equal(errorRelease.bodyTrackerPlaybackGateDurationMs, 7);
assert.equal(playbackGate.getStatus().bodyTrackerAppliedGeneration, 0);
assert.equal(playbackMedia.playCalls, 2);

assert.equal(playbackGate.completeApplied(99), null);
assert.equal(
  playbackGate.getStatus().bodyTrackerAppliedGeneration,
  0,
  "a completion without its matching active gate must fail closed",
);

playbackClock = 140;
playbackGate.begin({ inputGeneration: 1, media: playbackMedia });
assert.equal(playbackMedia.pauseCalls, 3, "failed apply must gate the next same-generation frame");
assert.throws(
  () => playbackGate.begin({ inputGeneration: 0, media: playbackMedia }),
  /older than active generation/,
);
const staleRelease = playbackGate.release(1, "stale-result");
assert.equal(staleRelease.bodyTrackerPlaybackGateResumeReason, "stale-result");
assert.equal(playbackGate.getStatus().bodyTrackerAppliedGeneration, 0);

playbackClock = 150;
playbackGate.begin({ inputGeneration: 2, media: playbackMedia });
const stopRelease = playbackGate.release(2, "input-stop", { resume: false });
assert.equal(stopRelease.bodyTrackerPlaybackGateResumeReason, "input-stop");
assert.equal(stopRelease.bodyTrackerPlaybackGateResumeRequested, false);
assert.equal(playbackMedia.paused, true, "stop release must not restart playback");

playbackMedia.paused = false;
playbackClock = 160;
playbackGate.begin({ inputGeneration: 3, media: playbackMedia });
const supersededRelease = playbackGate.release(3, "superseding-generation");
assert.equal(supersededRelease.bodyTrackerPlaybackGateResumeReason, "superseding-generation");
assert.equal(supersededRelease.bodyTrackerPlaybackGateResumeRequested, true);
assert.equal(playbackMedia.paused, false);

playbackClock = 170;
playbackGate.begin({ inputGeneration: 4, media: playbackMedia });
playbackClock = 171;
const rolledGate = playbackGate.begin({ inputGeneration: 5, media: playbackMedia });
assert.equal(rolledGate.bodyTrackerPlaybackGated, true);
assert.equal(rolledGate.bodyTrackerPlaybackGateGeneration, 5);
assert.equal(playbackMedia.paused, true);
assert.equal(
  playbackMedia.playCalls,
  4,
  "direct supersession must not briefly resume between generation gates",
);
playbackGate.release(5, "input-stop", { resume: false });

const boundaryMedia = createPlaybackMedia({ paused: true });
const boundaryGate = createInputGenerationPlaybackGate();
const reservedBoundary = boundaryGate.reserveBoundary({
  inputGeneration: 20,
  media: boundaryMedia,
  boundaryReason: "video-start",
  resumeAfterApply: true,
});
assert.equal(reservedBoundary.bodyTrackerBoundaryActive, true);
assert.equal(reservedBoundary.bodyTrackerPlaybackGateWasPlaying, true);
assert.equal(boundaryMedia.playCalls, 0, "start intent must not play before apply");
assert.equal(boundaryGate.blocksOrdinaryFrame(20), true);

const nominatedBoundary = boundaryGate.nominateBoundary({
  inputGeneration: 20,
  media: boundaryMedia,
  boundaryReason: "video-start",
  boundarySourcePtsSec: 0,
  resumeAfterApply: true,
});
assert.equal(nominatedBoundary.bodyTrackerBoundaryAccepted, true);
assert.equal(nominatedBoundary.bodyTrackerBoundarySourcePtsSec, 0);
assert.equal(
  boundaryGate.nominateBoundary({
    inputGeneration: 20,
    media: boundaryMedia,
    boundaryReason: "video-start",
    boundarySourcePtsSec: 0,
  }).bodyTrackerBoundaryAccepted,
  false,
  "one generation owns exactly one nominated boundary",
);

boundaryGate.reserveBoundary({
  inputGeneration: 21,
  media: boundaryMedia,
  boundaryReason: "seek",
});
assert.equal(boundaryMedia.playCalls, 0, "direct supersede must transfer intent atomically");
assert.equal(boundaryGate.getStatus().bodyTrackerBoundaryGeneration, 21);
boundaryGate.nominateBoundary({
  inputGeneration: 21,
  media: boundaryMedia,
  boundaryReason: "seek",
  boundarySourcePtsSec: 1.25,
});
boundaryGate.completeApplied(21);
assert.equal(boundaryMedia.playCalls, 1, "only matching avatar apply resumes playback");
assert.equal(boundaryGate.blocksOrdinaryFrame(21), false);

const failedBoundaryMedia = createPlaybackMedia({ paused: true });
const failedBoundaryGate = createInputGenerationPlaybackGate();
failedBoundaryGate.nominateBoundary({
  inputGeneration: 30,
  media: failedBoundaryMedia,
  boundaryReason: "video-start",
  boundarySourcePtsSec: 0,
  resumeAfterApply: true,
});
failedBoundaryGate.release(30, "error");
assert.equal(
  failedBoundaryMedia.playCalls,
  0,
  "an unapplied exact boundary must fail closed without starting playback",
);
assert.equal(failedBoundaryMedia.paused, true);

const externallyStartedMedia = createPlaybackMedia({ paused: true });
const externallyStartedGate = createInputGenerationPlaybackGate();
externallyStartedGate.nominateBoundary({
  inputGeneration: 31,
  media: externallyStartedMedia,
  boundaryReason: "seek",
  boundarySourcePtsSec: 0,
});
assert.equal(externallyStartedGate.requestResume(31), true);
externallyStartedGate.completeApplied(31);
assert.equal(
  externallyStartedMedia.playCalls,
  1,
  "a play request received during a frozen gate must resume after apply",
);

function createBackpressureMedia() {
  return {
    paused: false,
    ended: false,
    pauseCalls: 0,
    playCalls: 0,
    rejectPlay: false,
    pause() {
      this.pauseCalls += 1;
      this.paused = true;
    },
    play() {
      this.playCalls += 1;
      if (this.rejectPlay) {
        return Promise.reject(new Error("synthetic play rejection"));
      }
      this.paused = false;
      return Promise.resolve();
    },
  };
}

function createBackpressureTimerHarness() {
  let clock = 100;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => clock,
    setNow(value) {
      clock = value;
    },
    setTimer(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { callback, dueAt: clock + delayMs });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    runDue() {
      for (const [id, timer] of [...timers]) {
        if (timer.dueAt <= clock) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get size() {
      return timers.size;
    },
  };
}

function pendingTransition(type, pendingId, generation, deadline, extra = {}) {
  return {
    type,
    pending: {
      pendingId,
      generation,
      sourcePtsSec: pendingId / 10,
      pendingDeadlineMonotonicMs: deadline,
    },
    ...extra,
  };
}

async function checkFileVideoBackpressureLifecycle() {
  const timers = createBackpressureTimerHarness();
  const media = createBackpressureMedia();
  const runtime = {
    active: true,
    inputKind: "video",
    pumpMode: "rvfc",
    boundaryActive: false,
    generation: 0,
    media,
  };
  let cancelFrameCalls = 0;
  let scheduleFrameCalls = 0;
  const errors = [];
  const controller = createVideoPlaybackBackpressureController({
    maxHoldMs: 80,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    getRuntimeContext: () => runtime,
    cancelScheduledFrame: () => {
      cancelFrameCalls += 1;
    },
    scheduleFrame: () => {
      scheduleFrameCalls += 1;
    },
    onError: (error, phase) => errors.push({ error, phase }),
  });

  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 1, 0, 180)),
    true,
  );
  assert.equal(cancelFrameCalls, 0, "hysteresis must not cancel rVFC early");
  assert.equal(media.pauseCalls, 0, "hysteresis must not pause media early");
  assert.equal(media.playCalls, 0);
  assert.equal(scheduleFrameCalls, 0);
  assert.equal(controller.getStatus().active, true);
  assert.equal(controller.getStatus().hysteresisActive, true);
  assert.equal(timers.size, 2, "hysteresis and absolute deadline must both be armed");

  timers.setNow(119);
  timers.runDue();
  assert.equal(cancelFrameCalls, 0);
  assert.equal(media.pauseCalls, 0);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-promoted", 1, 0, 180)),
    true,
  );
  assert.equal(controller.getStatus().active, false);
  assert.equal(controller.getStatus().avoidedPauseCount, 1);
  assert.equal(scheduleFrameCalls, 0);
  assert.equal(media.playCalls, 0);
  assert.equal(timers.size, 0);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-settled", 1, 0, 180)),
    false,
    "an early promotion has no paused owner to resume",
  );

  timers.setNow(130);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 2, 0, 210)),
    true,
  );
  assert.equal(cancelFrameCalls, 0);
  assert.equal(media.pauseCalls, 0);
  timers.setNow(149);
  timers.runDue();
  assert.equal(cancelFrameCalls, 0);
  assert.equal(media.pauseCalls, 0);
  timers.setNow(150);
  timers.runDue();
  assert.equal(cancelFrameCalls, 1, "sustained pending must cancel prearmed rVFC once");
  assert.equal(media.pauseCalls, 1, "sustained pending must pause once");
  assert.equal(controller.getStatus().pausedByController, true);
  assert.equal(controller.getStatus().sustainedPauseCount, 1);
  assert.equal(timers.size, 1, "the original absolute deadline remains armed");

  media.paused = false;
  assert.equal(controller.blockPlayAttempt(media, 0), true);
  assert.equal(media.paused, true, "external play must remain blocked while held");
  timers.setNow(155);
  controller.resetTelemetry();
  assert.equal(controller.getStatus().active, true, "telemetry reset must preserve ownership");
  assert.equal(timers.size, 1, "telemetry reset must preserve the absolute deadline");

  timers.setNow(160);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-promoted", 2, 0, 210)),
    true,
  );
  assert.equal(controller.getStatus().active, true);
  assert.equal(controller.getStatus().promoted, true);
  assert.equal(media.playCalls, 0, "promotion alone must remain paused");
  assert.equal(scheduleFrameCalls, 0);

  timers.setNow(170);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-settled", 2, 0, 210)),
    true,
  );
  assert.equal(controller.getStatus().active, false);
  assert.equal(scheduleFrameCalls, 1);
  assert.equal(media.playCalls, 1);
  assert.equal(controller.getStatus().settledResumeCount, 1);
  assert.equal(controller.getStatus().lastHoldMs, 15);
  assert.equal(timers.size, 0);

  timers.setNow(180);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 3, 0, 260)),
    true,
  );
  timers.setNow(185);
  const replacement = pendingTransition("pending-replaced", 4, 0, 300, {
    replaced: {
      pendingId: 3,
      generation: 0,
      sourcePtsSec: 0.3,
      pendingDeadlineMonotonicMs: 260,
    },
  });
  assert.equal(controller.handleTransition(replacement), true);
  assert.equal(controller.getStatus().pendingId, 4);
  assert.equal(
    controller.getStatus().deadlineMonotonicMs,
    260,
    "replacement must retain the original callback absolute deadline",
  );

  timers.setNow(200);
  timers.runDue();
  assert.equal(cancelFrameCalls, 2);
  assert.equal(media.pauseCalls, 3);
  timers.setNow(210);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-promoted", 4, 0, 300)),
    true,
  );
  assert.equal(controller.getStatus().active, true);
  assert.equal(media.playCalls, 1, "held promotion must wait for settlement");

  timers.setNow(261);
  timers.runDue();
  assert.equal(controller.getStatus().active, false);
  assert.equal(controller.getStatus().bypassActive, true);
  assert.equal(controller.getStatus().deadlineBypasses, 1);
  assert.equal(scheduleFrameCalls, 2);
  assert.equal(media.playCalls, 2, "absolute deadline must fail open once");
  assert.equal(
    controller.handleTransition(pendingTransition("pending-settled", 4, 0, 300)),
    true,
  );
  assert.equal(controller.getStatus().bypassActive, false);
  assert.equal(media.playCalls, 2, "settlement after deadline must not replay twice");

  timers.setNow(270);
  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 5, 0, 350)),
    true,
  );
  const seekRelease = controller.cancel("seek");
  assert.equal(seekRelease.wasPlaying, true, "seek must transfer prior play intent");
  assert.equal(media.playCalls, 2, "generation cancellation must never play directly");
  timers.setNow(351);
  timers.runDue();
  assert.equal(media.playCalls, 2, "stale deadline must be inert after cancellation");

  runtime.inputKind = "camera";
  media.paused = false;
  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 6, 0, 430)),
    false,
    "camera input must retain latest-wins without playback backpressure",
  );
  runtime.inputKind = "video";
  runtime.pumpMode = "raf";
  assert.equal(
    controller.handleTransition(pendingTransition("pending-queued", 7, 0, 430)),
    false,
    "RAF input must not acquire rVFC playback ownership",
  );

  runtime.pumpMode = "rvfc";
  media.paused = false;
  media.rejectPlay = true;
  timers.setNow(370);
  controller.handleTransition(pendingTransition("pending-queued", 8, 0, 450));
  timers.setNow(390);
  timers.runDue();
  controller.handleTransition(pendingTransition("pending-promoted", 8, 0, 450));
  controller.handleTransition(pendingTransition("pending-settled", 8, 0, 450));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.getStatus().resumeErrors, 1);
  assert.equal(errors.at(-1)?.phase, "play-pending-settled");
  assert.equal(cancelFrameCalls, 4, "play rejection must cancel its replacement rVFC");
}

await checkFileVideoBackpressureLifecycle();

console.log("tracking input generation checks passed");
