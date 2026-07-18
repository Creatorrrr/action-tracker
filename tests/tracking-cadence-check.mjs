import assert from "node:assert/strict";
import {
  DEFAULT_BODY_DETECTION_RATE_HZ,
  DEFAULT_HAND_DETECTION_INTERVAL_MS,
  decideSourcePtsAdmission,
  decideSourcePtsSlotAdmission,
  mergeHandObservationCache,
  resolveHandObservationCache,
  shouldRunCadencedDetection,
} from "../src/tracking-cadence.js";
import {
  DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS,
  transportPoseGuidedHandLandmarks,
} from "../src/pose-guided-hand-fallback.js";
import { createFaceObservationMaturationLedger } from "../src/face-observation-maturation.js";

assert.equal(DEFAULT_HAND_DETECTION_INTERVAL_MS, 50);
assert.equal(DEFAULT_BODY_DETECTION_RATE_HZ, 30);
assert.equal(DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS, 1250);

assert.deepEqual(
  decideSourcePtsAdmission({
    sourcePtsSec: 0,
    lastAdmittedSourcePtsSec: null,
  }),
  {
    shouldAdmit: true,
    elapsedTicks: null,
    minimumIntervalTicks: 33_333,
    reason: "first-frame",
  },
  "the first exact source PTS must be admitted",
);

assert.deepEqual(
  decideSourcePtsAdmission({
    sourcePtsSec: 0.5,
    lastAdmittedSourcePtsSec: 1,
  }),
  {
    shouldAdmit: true,
    elapsedTicks: 0,
    minimumIntervalTicks: 33_333,
    reason: "clock-rewind",
  },
  "a rewind must be admitted so the caller can perform its timeline reset",
);

assert.equal(
  decideSourcePtsAdmission({ sourcePtsSec: Number.NaN }).reason,
  "invalid-source-pts",
  "invalid source timing must fail closed without a fabricated PTS",
);

function admittedIndicesForRate(frameRate, frameCount) {
  const admitted = [];
  let lastAdmittedSourcePtsSec = null;
  for (let index = 0; index < frameCount; index += 1) {
    const sourcePtsSec = index / frameRate;
    const decision = decideSourcePtsAdmission({
      sourcePtsSec,
      lastAdmittedSourcePtsSec,
    });
    if (decision.shouldAdmit) {
      admitted.push(index);
      lastAdmittedSourcePtsSec = sourcePtsSec;
    }
  }
  return admitted;
}

function admittedIndicesForQuantizedRate(frameRate, frameCount) {
  const admitted = [];
  let lastAdmittedSourcePtsSec = null;
  for (let index = 0; index < frameCount; index += 1) {
    const sourcePtsSec = Number((index / frameRate).toFixed(6));
    const decision = decideSourcePtsAdmission({
      sourcePtsSec,
      lastAdmittedSourcePtsSec,
    });
    if (decision.shouldAdmit) {
      admitted.push(index);
      lastAdmittedSourcePtsSec = sourcePtsSec;
    }
  }
  return admitted;
}

assert.deepEqual(
  admittedIndicesForRate(60, 10),
  [0, 2, 4, 6, 8],
  "60 fps source work must be admitted every other exact PTS",
);

for (const frameRate of [24, 30_000 / 1_001, 30]) {
  assert.deepEqual(
    admittedIndicesForRate(frameRate, 12),
    Array.from({ length: 12 }, (_, index) => index),
    `${frameRate} fps exact source work must not be intentionally downsampled`,
  );
}

assert.deepEqual(
  admittedIndicesForQuantizedRate(60, 10),
  [0, 2, 4, 6, 8],
  "six-decimal 60 fps mediaTime must still be admitted every other PTS",
);
for (const frameRate of [30_000 / 1_001, 30]) {
  assert.deepEqual(
    admittedIndicesForQuantizedRate(frameRate, 12),
    Array.from({ length: 12 }, (_, index) => index),
    `six-decimal ${frameRate} fps mediaTime must not be downsampled`,
  );
}

assert.deepEqual(
  decideSourcePtsSlotAdmission({
    sourcePtsSec: 0.133333,
    lastAdmittedSlotIndex: 0,
    maxRateHz: 10,
  }),
  {
    shouldAdmit: true,
    slotIndex: 1,
    slotIntervalTicks: 100_000,
    skippedSlotCount: 0,
    reason: "source-slot-advanced",
  },
  "fixed source slots must use the source clock rather than the prior callback",
);
assert.equal(
  decideSourcePtsSlotAdmission({
    sourcePtsSec: 0.166667,
    lastAdmittedSlotIndex: 1,
    maxRateHz: 10,
  }).reason,
  "source-slot-already-admitted",
  "only one frame may consume a fixed source slot",
);
assert.equal(
  decideSourcePtsSlotAdmission({
    sourcePtsSec: Number.NaN,
    maxRateHz: 10,
  }).reason,
  "invalid-source-pts",
  "slot admission must fail closed without exact source time",
);
assert.equal(
  decideSourcePtsSlotAdmission({
    sourcePtsSec: 0.5,
    lastAdmittedSlotIndex: 9,
    maxRateHz: 10,
  }).reason,
  "clock-rewind",
  "a generation/timeline rewind must re-enter the source-time grid",
);

function simulateFixedFaceSlots(frameRate, { omitFrameIndex = -1 } = {}) {
  const sourceFrames = [];
  const bodyFrames = [];
  const faceAdmissions = [];
  let lastBodySourcePtsSec = null;
  let lastFaceSlotIndex = null;

  for (let index = 0; ; index += 1) {
    const sourcePtsSec = Number((index / frameRate).toFixed(6));
    if (sourcePtsSec >= 10) break;
    if (index === omitFrameIndex) continue;

    const faceDecision = decideSourcePtsSlotAdmission({
      sourcePtsSec,
      lastAdmittedSlotIndex: lastFaceSlotIndex,
      maxRateHz: 10,
    });
    if (faceDecision.shouldAdmit) {
      lastFaceSlotIndex = faceDecision.slotIndex;
      faceAdmissions.push({
        sourcePtsSec,
        slotIndex: faceDecision.slotIndex,
      });
    }

    const bodyDecision = decideSourcePtsAdmission({
      sourcePtsSec,
      lastAdmittedSourcePtsSec: lastBodySourcePtsSec,
      maxRateHz: 30,
    });
    if (bodyDecision.shouldAdmit) {
      lastBodySourcePtsSec = sourcePtsSec;
      bodyFrames.push(sourcePtsSec);
    }
    sourceFrames.push({
      sourcePtsSec,
      bodyAdmitted: bodyDecision.shouldAdmit,
      faceAdmitted: faceDecision.shouldAdmit,
    });
  }

  return { sourceFrames, bodyFrames, faceAdmissions };
}

for (const frameRate of [30_000 / 1_001, 30, 60]) {
  const normal = simulateFixedFaceSlots(frameRate);
  assert.equal(
    normal.faceAdmissions.length,
    100,
    `${frameRate} fps must admit exactly 100 Face slots in [0, 10)`,
  );
  assert.equal(
    new Set(normal.faceAdmissions.map((entry) => entry.slotIndex)).size,
    normal.faceAdmissions.length,
    `${frameRate} fps must never replay or duplicate a Face source slot`,
  );

  const omitted = simulateFixedFaceSlots(frameRate, {
    omitFrameIndex: Math.round(frameRate * 5),
  });
  assert.equal(
    omitted.faceAdmissions.length,
    100,
    `${frameRate} fps must consume a missed slot only when the next real callback arrives`,
  );
  const slot50 = omitted.faceAdmissions.find((entry) => entry.slotIndex === 50);
  const slot51 = omitted.faceAdmissions.find((entry) => entry.slotIndex === 51);
  assert.ok(slot50 && slot51);
  assert.ok(
    slot51.sourcePtsSec - slot50.sourcePtsSec <= 0.084,
    `${frameRate} fps must return to the fixed phase after one omitted callback`,
  );
}

function maximumCausalFaceAgeMs({ omitFrameIndex = -1 } = {}) {
  const { sourceFrames } = simulateFixedFaceSlots(30, {
    omitFrameIndex,
  });
  const availableObservations = [];
  let pendingObservation = null;
  let maximumAgeMs = 0;

  for (const sourceFrame of sourceFrames) {
    if (sourceFrame.faceAdmitted) {
      pendingObservation = sourceFrame.sourcePtsSec;
    }
    if (!sourceFrame.bodyAdmitted) continue;

    const bodySourcePtsSec = sourceFrame.sourcePtsSec;
    if (pendingObservation !== null) {
      // A Face offer from this same callback cannot be used by the same body
      // source frame. Promote it only after this body selection.
      if (pendingObservation < bodySourcePtsSec) {
        availableObservations.push(pendingObservation);
        pendingObservation = null;
      }
    }
    const cutoffSourcePtsSec = bodySourcePtsSec - 1 / 30;
    const selected = availableObservations
      .filter((sourcePtsSec) => sourcePtsSec <= cutoffSourcePtsSec + 0.000001)
      .at(-1);
    if (selected !== undefined) {
      assert.ok(selected <= bodySourcePtsSec, "a selected Face observation must never be future");
      maximumAgeMs = Math.max(
        maximumAgeMs,
        (bodySourcePtsSec - selected) * 1000,
      );
    }
  }

  return maximumAgeMs;
}

assert.ok(
  maximumCausalFaceAgeMs() <= 100.001,
  "normal 30 fps Face observations must remain at most 100 ms old",
);
assert.ok(
  maximumCausalFaceAgeMs({ omitFrameIndex: 150 }) <= 133.334,
  "one omitted 30 fps callback must keep the prior Face observation below 150 ms",
);

function createManualMaturationClock(startMs = 0) {
  let currentMs = startMs;
  let nextTimerId = 0;
  const timers = new Map();

  function findEarliestTimer(maxDueMs = Number.POSITIVE_INFINITY) {
    return [...timers.entries()]
      .filter(([, timer]) => timer.dueMs <= maxDueMs)
      .sort((left, right) =>
        left[1].dueMs - right[1].dueMs || left[0] - right[0]
      )[0] ?? null;
  }

  return {
    now: () => currentMs,
    schedule(callback, delayMs) {
      const timerId = ++nextTimerId;
      timers.set(timerId, {
        callback,
        dueMs: currentMs + Math.max(0, delayMs),
      });
      return timerId;
    },
    cancelSchedule(timerId) {
      timers.delete(timerId);
    },
    advance(deltaMs) {
      const targetMs = currentMs + deltaMs;
      let timer = findEarliestTimer(targetMs);
      while (timer) {
        const [timerId, scheduled] = timer;
        timers.delete(timerId);
        currentMs = scheduled.dueMs;
        scheduled.callback();
        timer = findEarliestTimer(targetMs);
      }
      currentMs = targetMs;
    },
    fireNextEarly() {
      const timer = findEarliestTimer();
      if (!timer) return false;
      const [timerId, scheduled] = timer;
      timers.delete(timerId);
      scheduled.callback();
      return true;
    },
    timerCount: () => timers.size,
  };
}

function createTestFaceMaturationLedger(clock, options = {}) {
  return createFaceObservationMaturationLedger({
    deadlineMs: 80,
    historyLimit: options.historyLimit ?? 8,
    now: clock.now,
    schedule: clock.schedule,
    cancelSchedule: clock.cancelSchedule,
  });
}

const faceLagMs = 1000 / 30;
const settledFirstClock = createManualMaturationClock(100);
const settledFirstLedger = createTestFaceMaturationLedger(settledFirstClock);
settledFirstLedger.advanceGeneration(1);
const settledFirstToken = settledFirstLedger.register({
  generation: 1,
  slotIndex: 3,
  sourcePtsSec: 0.3,
  callbackMonotonicMs: 100,
});
assert.equal(Object.isFrozen(settledFirstToken), true);
assert.equal(
  settledFirstLedger.settle(settledFirstToken, {
    face: { source: "slot-3" },
  }),
  true,
);
const settledBeforeBody = await settledFirstLedger.waitForEligible({
  generation: 1,
  bodySourcePtsSec: 0.333333,
  applicationLagMs: faceLagMs,
});
assert.equal(Object.isFrozen(settledBeforeBody), true);
assert.equal(Object.isFrozen(settledBeforeBody.observation), true);

const bodyFirstClock = createManualMaturationClock(100);
const bodyFirstLedger = createTestFaceMaturationLedger(bodyFirstClock);
bodyFirstLedger.advanceGeneration(1);
const bodyFirstToken = bodyFirstLedger.register({
  generation: 1,
  slotIndex: 3,
  sourcePtsSec: 0.3,
  callbackMonotonicMs: 100,
});
const bodyBeforeSettlePromise = bodyFirstLedger.waitForEligible({
  generation: 1,
  bodySourcePtsSec: 0.333333,
  applicationLagMs: faceLagMs,
});
assert.equal(bodyFirstLedger.getStatus().currentWaits, 1);
assert.equal(
  bodyFirstLedger.settle(bodyFirstToken, {
    face: { source: "slot-3" },
  }),
  true,
);
const bodyBeforeSettle = await bodyBeforeSettlePromise;
assert.deepEqual(
  [
    bodyBeforeSettle.generation,
    bodyBeforeSettle.slotIndex,
    bodyBeforeSettle.sourcePtsSec,
    bodyBeforeSettle.terminal,
    bodyBeforeSettle.observation,
  ],
  [
    settledBeforeBody.generation,
    settledBeforeBody.slotIndex,
    settledBeforeBody.sourcePtsSec,
    settledBeforeBody.terminal,
    settledBeforeBody.observation,
  ],
  "Face completion order must not change the exact selected source slot",
);
assert.equal(bodyBeforeSettle.waited, true);
assert.equal(bodyFirstClock.timerCount(), 0, "settlement must cancel its deadline timer");

const nullClock = createManualMaturationClock(200);
const nullLedger = createTestFaceMaturationLedger(nullClock);
const nullToken = nullLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 200,
});
assert.equal(nullLedger.settle(nullToken, { face: null }), true);
const nullSelection = await nullLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.033333,
  applicationLagMs: faceLagMs,
});
assert.equal(nullSelection.terminal, "null-observation");
assert.equal(nullSelection.observation.face, null);

const futureClock = createManualMaturationClock(300);
const futureLedger = createTestFaceMaturationLedger(futureClock);
futureLedger.register({
  generation: 0,
  slotIndex: 1,
  sourcePtsSec: 0.1,
  callbackMonotonicMs: 300,
});
const futureSelection = await futureLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.1,
  applicationLagMs: faceLagMs,
});
assert.equal(futureSelection.found, false);
assert.equal(futureSelection.reason, "future-only");
assert.equal(futureLedger.getStatus().currentWaits, 0);

const newestClock = createManualMaturationClock(400);
const newestLedger = createTestFaceMaturationLedger(newestClock);
const olderToken = newestLedger.register({
  generation: 0,
  slotIndex: 1,
  sourcePtsSec: 0.1,
  callbackMonotonicMs: 400,
});
newestLedger.settle(olderToken, { face: { source: "older" } });
const newestToken = newestLedger.register({
  generation: 0,
  slotIndex: 2,
  sourcePtsSec: 0.2,
  callbackMonotonicMs: 400,
});
const newestPromise = newestLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.233333,
  applicationLagMs: faceLagMs,
});
assert.equal(
  newestLedger.getStatus().currentWaits,
  1,
  "Body must wait for the newest admitted causal slot instead of falling back",
);
newestLedger.settle(newestToken, { face: { source: "newest" } });
assert.equal((await newestPromise).slotIndex, 2);

const deadlineClock = createManualMaturationClock(0);
const deadlineLedger = createTestFaceMaturationLedger(deadlineClock);
const deadlineToken = deadlineLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 0,
});
const deadlinePromise = deadlineLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.033333,
  applicationLagMs: faceLagMs,
});
assert.equal(deadlineClock.fireNextEarly(), true);
assert.equal(
  deadlineLedger.getStatus().pending,
  1,
  "an early host timer must not seal before callback + 80 ms",
);
assert.equal(deadlineClock.timerCount(), 1);
deadlineClock.advance(80);
const deadlineSelection = await deadlinePromise;
assert.equal(deadlineSelection.terminal, "deadline-miss");
assert.equal(deadlineSelection.waitMs, 80);
assert.equal(deadlineLedger.getStatus().deadlineMisses, 1);
assert.equal(deadlineLedger.getStatus().currentWaits, 0);
assert.equal(deadlineClock.timerCount(), 0);
assert.equal(
  deadlineLedger.settle(deadlineToken, { face: { source: "late" } }),
  false,
  "a late worker result must never mutate a deadline terminal",
);
assert.equal(deadlineLedger.getStatus().lateDiscards, 1);

const absoluteClock = createManualMaturationClock(0);
const absoluteLedger = createTestFaceMaturationLedger(absoluteClock);
const absoluteSettleToken = absoluteLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 0,
});
absoluteClock.advance(81);
assert.equal(
  absoluteLedger.settle(absoluteSettleToken, { face: { source: "late" } }),
  false,
  "settle must enforce the admission callback deadline without a Body waiter",
);
assert.equal(absoluteLedger.getStatus().deadlineMisses, 1);
assert.equal(absoluteLedger.getStatus().lateDiscards, 1);

const absoluteDropClock = createManualMaturationClock(0);
const absoluteDropLedger = createTestFaceMaturationLedger(absoluteDropClock);
const absoluteDropToken = absoluteDropLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 0,
});
absoluteDropClock.advance(81);
assert.equal(absoluteDropLedger.drop(absoluteDropToken, "overload"), false);
assert.equal(
  absoluteDropLedger.getStatus().deadlineMisses,
  1,
  "drop must not bypass an already elapsed absolute deadline",
);

const cancellationClock = createManualMaturationClock(500);
const cancellationLedger = createTestFaceMaturationLedger(cancellationClock);
const cancellationToken = cancellationLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 500,
});
const cancellationPromise = cancellationLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.033333,
  applicationLagMs: faceLagMs,
});
cancellationLedger.advanceGeneration(1);
const cancellationSelection = await cancellationPromise;
assert.equal(cancellationSelection.terminal, "cancellation");
assert.equal(cancellationLedger.getStatus().currentWaits, 0);
assert.equal(cancellationClock.timerCount(), 0);
assert.equal(cancellationLedger.settle(cancellationToken, { face: null }), false);
assert.equal(
  cancellationLedger.getStatus().lateDiscards,
  0,
  "a generation-cancelled result rejection is not an absolute-deadline miss",
);
assert.equal(cancellationLedger.getStatus().terminalRejections, 1);

const dropClock = createManualMaturationClock(600);
const dropLedger = createTestFaceMaturationLedger(dropClock);
const dropToken = dropLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 600,
});
const dropPromise = dropLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.033333,
  applicationLagMs: faceLagMs,
});
assert.equal(dropLedger.drop(dropToken, "overload"), true);
const dropSelection = await dropPromise;
assert.equal(dropSelection.terminal, "drop");
assert.equal(dropSelection.reason, "overload");

const resetClock = createManualMaturationClock(700);
const resetLedger = createTestFaceMaturationLedger(resetClock);
const resetToken = resetLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 700,
});
const resetWait = resetLedger.waitForEligible({
  generation: 0,
  bodySourcePtsSec: 0.033333,
  applicationLagMs: faceLagMs,
});
resetLedger.resetTelemetry();
assert.equal(resetLedger.getStatus().entries, 1);
assert.equal(resetLedger.getStatus().pending, 1);
assert.equal(resetLedger.getStatus().currentWaits, 1);
assert.equal(resetLedger.getStatus().maxWaits, 1);
resetLedger.settle(resetToken, { face: null });
await resetWait;
assert.equal(resetLedger.getStatus().waits, 1);

const trimClock = createManualMaturationClock(800);
const trimLedger = createTestFaceMaturationLedger(trimClock, { historyLimit: 1 });
trimLedger.register({
  generation: 0,
  slotIndex: 0,
  sourcePtsSec: 0,
  callbackMonotonicMs: 800,
});
trimLedger.register({
  generation: 0,
  slotIndex: 1,
  sourcePtsSec: 0.1,
  callbackMonotonicMs: 800,
});
assert.throws(
  () => trimLedger.register({
    generation: 0,
    slotIndex: 1,
    sourcePtsSec: 0.1,
    callbackMonotonicMs: 800,
  }),
  /advance exactly once/,
  "duplicate slot registration must fail before inference ownership changes",
);
assert.equal(trimLedger.getStatus().entries, 2);
assert.equal(
  trimLedger.getStatus().pending,
  2,
  "bounded history must retain every pending entry even above its terminal limit",
);
assert.equal(trimLedger.cancelPending({ reason: "test-dispose" }), 2);
assert.equal(trimLedger.getStatus().entries, 1);
assert.equal(trimLedger.getStatus().currentWaits, 0);

assert.deepEqual(
  shouldRunCadencedDetection({
    timestampMs: 1_000,
    lastRunTimestampMs: null,
    hasCachedResult: false,
  }),
  { shouldRun: true, ageMs: null, reason: "first-frame" },
  "the first frame must run",
);

assert.deepEqual(
  shouldRunCadencedDetection({
    timestampMs: 1_099,
    lastRunTimestampMs: 1_000,
    intervalMs: 100,
    hasCachedResult: true,
  }),
  { shouldRun: false, ageMs: 99, reason: "cached-result-fresh" },
  "a cached result younger than the cadence should be reused with its age",
);

assert.deepEqual(
  shouldRunCadencedDetection({
    timestampMs: 1_100,
    lastRunTimestampMs: 1_000,
    intervalMs: 100,
    hasCachedResult: true,
  }),
  { shouldRun: true, ageMs: 100, reason: "interval-elapsed" },
  "the interval boundary must run",
);

assert.deepEqual(
  shouldRunCadencedDetection({
    timestampMs: 900,
    lastRunTimestampMs: 1_000,
    hasCachedResult: true,
  }),
  { shouldRun: true, ageMs: 0, reason: "clock-rewind" },
  "a source timestamp rewind must run so the caller can reset its cadence",
);

assert.deepEqual(
  shouldRunCadencedDetection({
    timestampMs: 1_050,
    lastRunTimestampMs: 1_000,
    intervalMs: 100,
    hasCachedResult: false,
  }),
  { shouldRun: true, ageMs: 50, reason: "no-cached-result" },
  "the current frame cannot wait for a future cached result",
);

const fixedInput = {
  timestampMs: 5_050,
  lastRunTimestampMs: 5_000,
  intervalMs: 100,
  hasCachedResult: true,
};
assert.deepEqual(
  shouldRunCadencedDetection(fixedInput),
  shouldRunCadencedDetection(fixedInput),
  "a decision must depend only on supplied timestamps and cache state",
);

const hand = (offset) => Array.from({ length: 21 }, (_, index) => ({
  x: offset + index / 100,
  y: index / 200,
  z: 0,
}));
let handCache = null;
let merged = mergeHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1,
  frame: {
    leftHandLandmarks: hand(0),
    leftHandWorldLandmarks: hand(1),
    sourceMeta: { handDetectionInputMode: "test" },
  },
});
handCache = merged.cache;
assert.deepEqual(merged.observedSides, ["Left"]);

merged = mergeHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1.1,
  frame: {},
  attemptedSides: ["Left"],
});
handCache = merged.cache;
assert.equal(merged.reason, "held-null-observation");
assert.equal(handCache.sides.Left.missedDetections, 1);

let resolved = resolveHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1.4,
  maxAgeMs: 500,
});
assert.deepEqual(resolved.usedSides, ["Left"]);
assert.deepEqual(resolved.heldSides, ["Left"]);
assert.ok(Math.abs(resolved.ageMsBySide.Left - 400) < 1e-9);
assert.equal(resolved.handResults.leftHandLandmarks.length, 21);

merged = mergeHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1.45,
  frame: {
    rightHandLandmarks: hand(2),
    rightHandWorldLandmarks: hand(3),
  },
  attemptedSides: ["Right"],
});
handCache = merged.cache;
assert.deepEqual(merged.observedSides, ["Right"]);
assert.deepEqual(merged.heldSides, ["Left"]);
assert.equal(
  handCache.sides.Left.missedDetections,
  1,
  "an unrequested side must retain its prior miss count",
);

resolved = resolveHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1.55,
  maxAgeMs: 500,
});
assert.deepEqual(resolved.usedSides, ["Right"]);
assert.deepEqual(resolved.expiredSides, ["Left"]);
assert.equal(resolved.handResults.leftHandLandmarks, null);
assert.equal(resolved.handResults.rightHandLandmarks.length, 21);

const future = resolveHandObservationCache(handCache, {
  generation: 3,
  sourcePtsSec: 1.4,
  maxAgeMs: 500,
});
assert.deepEqual(future.futureSides, ["Right"]);
assert.ok(future.cache?.sides?.Right, "a future observation must be retained for the next causal frame");

const reset = resolveHandObservationCache(handCache, {
  generation: 4,
  sourcePtsSec: 1.6,
  maxAgeMs: 500,
});
assert.equal(reset.cache, null);
assert.equal(reset.reason, "generation-mismatch");

const observedPose = Array.from({ length: 33 }, () => ({
  x: 0.5,
  y: 0.5,
  z: 0,
  visibility: 0,
}));
Object.assign(observedPose[15], { x: 0.2, y: 0.2, visibility: 1 });
Object.assign(observedPose[19], { x: 0.3, y: 0.2, visibility: 1 });
Object.assign(observedPose[17], { x: 0.2, y: 0.3, visibility: 1 });
Object.assign(observedPose[21], { x: 0.25, y: 0.15, visibility: 1 });
const currentPose = structuredClone(observedPose);
Object.assign(currentPose[15], { x: 0.6, y: 0.4, visibility: 1 });
Object.assign(currentPose[19], { x: 0.6, y: 0.6, visibility: 1 });
Object.assign(currentPose[17], { x: 0.4, y: 0.4, visibility: 1 });
Object.assign(currentPose[21], { x: 0.7, y: 0.5, visibility: 1 });
const observedHand = Array.from({ length: 21 }, (_, index) => ({
  x: 0.21 + index * 0.001,
  y: 0.22 + index * 0.0005,
  z: 0.01 + index * 0.001,
}));
const predictedHand = transportPoseGuidedHandLandmarks({
  side: "Left",
  observedLandmarks: observedHand,
  observedPoseLandmarks: observedPose,
  poseLandmarks: currentPose,
  observedSourcePtsSec: 1,
  sourcePtsSec: 1.5,
  generation: 7,
  observedGeneration: 7,
});
assert.equal(predictedHand.valid, true);
assert.equal(predictedHand.mode, "similarity");
assert.equal(predictedHand.landmarks.length, 21);
assert.equal(predictedHand.worldLandmarks, null);
assert.ok(Math.abs(predictedHand.scale - 2) < 1e-9);
assert.ok(Math.abs(predictedHand.rotationRad - Math.PI / 2) < 1e-9);
assert.ok(Math.abs(predictedHand.landmarks[0].x - 0.56) < 1e-9);
assert.ok(Math.abs(predictedHand.landmarks[0].y - 0.42) < 1e-9);
assert.ok(Math.abs(predictedHand.landmarks[1].z - 0.012) < 1e-9);
assert.ok(predictedHand.confidence > 0);
assert.deepEqual(
  transportPoseGuidedHandLandmarks({
    side: "Left",
    observedLandmarks: observedHand,
    observedPoseLandmarks: observedPose,
    poseLandmarks: currentPose,
    observedSourcePtsSec: 1,
    sourcePtsSec: 1.5,
    generation: 7,
    observedGeneration: 7,
  }),
  predictedHand,
  "pose-guided fallback must be deterministic for a fixed source-PTS pair",
);
assert.equal(transportPoseGuidedHandLandmarks({
  side: "Left",
  observedLandmarks: observedHand,
  observedPoseLandmarks: observedPose,
  poseLandmarks: currentPose,
  observedSourcePtsSec: 1,
  sourcePtsSec: 0.9,
}).reason, "future-observation");
assert.equal(transportPoseGuidedHandLandmarks({
  side: "Left",
  observedLandmarks: observedHand,
  observedPoseLandmarks: observedPose,
  poseLandmarks: currentPose,
  observedSourcePtsSec: 1,
  sourcePtsSec: 2.25,
}).reason, "expired-observation");
assert.equal(transportPoseGuidedHandLandmarks({
  side: "Left",
  observedLandmarks: observedHand,
  observedPoseLandmarks: observedPose,
  poseLandmarks: currentPose,
  observedSourcePtsSec: 1,
  sourcePtsSec: 1.5,
  generation: 8,
  observedGeneration: 7,
}).reason, "generation-mismatch");

console.log("Tracking cadence check passed");
