export const DEFAULT_HAND_DETECTION_INTERVAL_MS = 50;
export const DEFAULT_BODY_DETECTION_RATE_HZ = 30;
export const HAND_OBSERVATION_SIDES = Object.freeze(["Left", "Right"]);

// Integer source-time arithmetic keeps exact and six-decimal 29.97/30 fps
// boundaries from falling below a floating-point 1 / rate comparison. Browser
// mediaTime is commonly serialized at microsecond precision, so matching that
// precision avoids accidentally turning quantized 30 fps into 20 fps.
const SOURCE_PTS_TICKS_PER_SECOND = 1_000_000;

/**
 * Causally admit source work under a fixed maximum rate.
 *
 * The caller owns the last admitted PTS. A rewind is admitted immediately so
 * the caller's generation/timeline reset remains authoritative. Invalid PTS is
 * rejected rather than replaced with a wall-clock timestamp.
 */
export function decideSourcePtsAdmission({
  sourcePtsSec,
  lastAdmittedSourcePtsSec,
  maxRateHz = DEFAULT_BODY_DETECTION_RATE_HZ,
} = {}) {
  if (!Number.isFinite(maxRateHz) || maxRateHz <= 0) {
    throw new TypeError("maxRateHz must be a positive finite number");
  }

  const sourcePtsTicks = sourcePtsToTicks(sourcePtsSec);
  if (sourcePtsTicks === null) {
    return {
      shouldAdmit: false,
      elapsedTicks: null,
      minimumIntervalTicks: null,
      reason: "invalid-source-pts",
    };
  }

  const lastAdmittedTicks = sourcePtsToTicks(lastAdmittedSourcePtsSec);
  if (lastAdmittedTicks === null) {
    return {
      shouldAdmit: true,
      elapsedTicks: null,
      minimumIntervalTicks: minimumSourceIntervalTicks(maxRateHz),
      reason: "first-frame",
    };
  }

  const elapsedTicks = sourcePtsTicks - lastAdmittedTicks;
  const minimumIntervalTicks = minimumSourceIntervalTicks(maxRateHz);
  if (elapsedTicks < 0) {
    return {
      shouldAdmit: true,
      elapsedTicks: 0,
      minimumIntervalTicks,
      reason: "clock-rewind",
    };
  }

  if (elapsedTicks >= minimumIntervalTicks) {
    return {
      shouldAdmit: true,
      elapsedTicks,
      minimumIntervalTicks,
      reason: "rate-budget-elapsed",
    };
  }

  return {
    shouldAdmit: false,
    elapsedTicks,
    minimumIntervalTicks,
    reason: "rate-budget",
  };
}

/**
 * Admit at most one frame from each fixed source-time slot.
 *
 * Unlike a last-admitted + interval schedule, a delayed callback does not move
 * the phase of every later admission. If one or more slots had no callback,
 * the caller admits only the current slot and never replays the missed work.
 * Resetting lastAdmittedSlotIndex on an input-generation change keeps the
 * otherwise absolute source-time grid generation-safe.
 */
export function decideSourcePtsSlotAdmission({
  sourcePtsSec,
  lastAdmittedSlotIndex = null,
  maxRateHz = DEFAULT_BODY_DETECTION_RATE_HZ,
} = {}) {
  if (!Number.isFinite(maxRateHz) || maxRateHz <= 0) {
    throw new TypeError("maxRateHz must be a positive finite number");
  }
  if (
    lastAdmittedSlotIndex !== null &&
    !Number.isSafeInteger(lastAdmittedSlotIndex)
  ) {
    throw new TypeError("lastAdmittedSlotIndex must be a safe integer or null");
  }

  const sourcePtsTicks = sourcePtsToTicks(sourcePtsSec);
  const slotIntervalTicks = minimumSourceIntervalTicks(maxRateHz);
  if (sourcePtsTicks === null) {
    return {
      shouldAdmit: false,
      slotIndex: null,
      slotIntervalTicks,
      skippedSlotCount: 0,
      reason: "invalid-source-pts",
    };
  }

  const slotIndex = Math.floor(sourcePtsTicks / slotIntervalTicks);
  if (lastAdmittedSlotIndex === null) {
    return {
      shouldAdmit: true,
      slotIndex,
      slotIntervalTicks,
      skippedSlotCount: 0,
      reason: "first-slot",
    };
  }
  if (slotIndex < lastAdmittedSlotIndex) {
    return {
      shouldAdmit: true,
      slotIndex,
      slotIntervalTicks,
      skippedSlotCount: 0,
      reason: "clock-rewind",
    };
  }
  if (slotIndex === lastAdmittedSlotIndex) {
    return {
      shouldAdmit: false,
      slotIndex,
      slotIntervalTicks,
      skippedSlotCount: 0,
      reason: "source-slot-already-admitted",
    };
  }

  return {
    shouldAdmit: true,
    slotIndex,
    slotIntervalTicks,
    skippedSlotCount: Math.max(0, slotIndex - lastAdmittedSlotIndex - 1),
    reason: "source-slot-advanced",
  };
}

function sourcePtsToTicks(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const ticks = Math.round(value * SOURCE_PTS_TICKS_PER_SECOND);
  return Number.isSafeInteger(ticks) ? ticks : null;
}

function minimumSourceIntervalTicks(maxRateHz) {
  return Math.max(1, Math.floor(SOURCE_PTS_TICKS_PER_SECOND / maxRateHz));
}

/**
 * Decide whether a cached detector should run for the supplied source time.
 *
 * The caller owns the cache and last-run timestamp. This helper deliberately
 * does not read a wall or monotonic clock, so each decision is causal and
 * reproducible from the current frame envelope alone.
 */
export function shouldRunCadencedDetection({
  timestampMs,
  lastRunTimestampMs,
  intervalMs = DEFAULT_HAND_DETECTION_INTERVAL_MS,
  hasCachedResult,
} = {}) {
  if (!Number.isFinite(timestampMs)) {
    throw new TypeError("timestampMs must be finite");
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new TypeError("intervalMs must be a non-negative finite number");
  }

  if (!Number.isFinite(lastRunTimestampMs)) {
    return {
      shouldRun: true,
      ageMs: null,
      reason: "first-frame",
    };
  }

  const ageMs = timestampMs - lastRunTimestampMs;
  if (ageMs < 0) {
    return {
      shouldRun: true,
      ageMs: 0,
      reason: "clock-rewind",
    };
  }

  if (!hasCachedResult) {
    return {
      shouldRun: true,
      ageMs,
      reason: "no-cached-result",
    };
  }

  if (ageMs >= intervalMs) {
    return {
      shouldRun: true,
      ageMs,
      reason: "interval-elapsed",
    };
  }

  return {
    shouldRun: false,
    ageMs,
    reason: "cached-result-fresh",
  };
}

/**
 * Merge a detector observation without discarding the opposite hand when the
 * current inference is null or partial. Each side keeps its own source PTS and
 * miss count so expiry remains causal and one hand cannot refresh the other.
 */
export function mergeHandObservationCache(previousCache, {
  frame,
  generation,
  sourcePtsSec,
  completedAt = null,
  attemptedSides = null,
} = {}) {
  if (!Number.isFinite(generation) || !Number.isFinite(sourcePtsSec)) {
    return {
      cache: null,
      observedSides: [],
      heldSides: [],
      reason: "invalid-observation",
    };
  }

  const previous = previousCache?.generation === generation
    ? previousCache
    : null;
  const sides = {};
  const observedSides = [];
  const heldSides = [];
  const attempted = normalizeAttemptedHandSides(
    attemptedSides ??
      frame?.sourceMeta?.handRequestedSides ??
      frame?.sourceMeta?.handRequestedSide,
  );

  for (const side of HAND_OBSERVATION_SIDES) {
    const key = side.toLowerCase();
    const landmarks = validHandLandmarks(frame?.[`${key}HandLandmarks`]);
    const worldLandmarks = validHandLandmarks(frame?.[`${key}HandWorldLandmarks`]);

    if (landmarks) {
      sides[side] = {
        landmarks,
        worldLandmarks,
        sourcePtsSec,
        sourceMeta: frame?.sourceMeta ?? null,
        missedDetections: 0,
      };
      observedSides.push(side);
      continue;
    }

    const held = previous?.sides?.[side];
    if (held) {
      sides[side] = {
        ...held,
        missedDetections: Math.max(0, Number(held.missedDetections) || 0) +
          (attempted.has(side) ? 1 : 0),
      };
      heldSides.push(side);
    }
  }

  const cache = buildHandObservationCache({
    generation,
    sides,
    completedAt,
  });

  return {
    cache,
    observedSides,
    heldSides,
    reason: observedSides.length > 0
      ? heldSides.length > 0 ? "partial-observation" : "observed"
      : cache ? "held-null-observation" : "empty-observation",
  };
}

/**
 * Resolve only observations that are not from the future and have not passed
 * the caller's fixed causal hold window. Stale sides are pruned independently.
 */
export function resolveHandObservationCache(cache, {
  generation,
  sourcePtsSec,
  maxAgeMs,
} = {}) {
  if (
    !cache ||
    cache.generation !== generation ||
    !Number.isFinite(sourcePtsSec) ||
    !Number.isFinite(maxAgeMs) ||
    maxAgeMs < 0
  ) {
    return emptyResolvedHandCache(
      cache?.generation !== generation ? "generation-mismatch" : "cache-unavailable",
    );
  }

  const retainedSides = {};
  const handResults = emptyHandResults();
  const usedSides = [];
  const trackedSides = [];
  const heldSides = [];
  const expiredSides = [];
  const futureSides = [];
  const ageMsBySide = {};
  const sourcePtsSecBySide = {};
  const missedDetectionsBySide = {};
  const sourceMetaBySide = {};

  for (const side of HAND_OBSERVATION_SIDES) {
    const observation = cache.sides?.[side];
    if (!observation || !Number.isFinite(observation.sourcePtsSec)) {
      continue;
    }

    const ageMs = (sourcePtsSec - observation.sourcePtsSec) * 1000;
    if (ageMs < -0.001) {
      retainedSides[side] = observation;
      futureSides.push(side);
      continue;
    }
    if (ageMs > maxAgeMs) {
      expiredSides.push(side);
      continue;
    }

    retainedSides[side] = observation;
    usedSides.push(side);
    ageMsBySide[side] = Math.max(0, ageMs);
    sourcePtsSecBySide[side] = observation.sourcePtsSec;
    missedDetectionsBySide[side] = Math.max(
      0,
      Math.trunc(Number(observation.missedDetections) || 0),
    );
    sourceMetaBySide[side] = observation.sourceMeta ?? null;

    const key = side.toLowerCase();
    handResults[`${key}HandLandmarks`] = observation.landmarks;
    handResults[`${key}HandWorldLandmarks`] = observation.worldLandmarks;
    if (missedDetectionsBySide[side] > 0) {
      heldSides.push(side);
    } else {
      trackedSides.push(side);
    }
  }

  return {
    cache: buildHandObservationCache({
      generation,
      sides: retainedSides,
      completedAt: cache.completedAt,
    }),
    handResults,
    usedSides,
    trackedSides,
    heldSides,
    expiredSides,
    futureSides,
    ageMsBySide,
    sourcePtsSecBySide,
    missedDetectionsBySide,
    sourceMetaBySide,
    reason: usedSides.length > 0 ? "resolved" : "no-current-observation",
  };
}

function buildHandObservationCache({ generation, sides, completedAt }) {
  const entries = Object.entries(sides ?? {});
  if (entries.length === 0) {
    return null;
  }

  return {
    version: 1,
    generation,
    sides: Object.fromEntries(entries),
    sourcePtsSec: Math.max(...entries.map(([, value]) => value.sourcePtsSec)),
    completedAt: Number.isFinite(completedAt) ? completedAt : null,
  };
}

function emptyResolvedHandCache(reason) {
  return {
    cache: null,
    handResults: emptyHandResults(),
    usedSides: [],
    trackedSides: [],
    heldSides: [],
    expiredSides: [],
    futureSides: [],
    ageMsBySide: {},
    sourcePtsSecBySide: {},
    missedDetectionsBySide: {},
    sourceMetaBySide: {},
    reason,
  };
}

function emptyHandResults() {
  return {
    leftHandLandmarks: null,
    rightHandLandmarks: null,
    leftHandWorldLandmarks: null,
    rightHandWorldLandmarks: null,
  };
}

function validHandLandmarks(value) {
  return Array.isArray(value) && value.length === 21 ? value : null;
}

function normalizeAttemptedHandSides(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",").map((side) => side.trim()).filter(Boolean)
      : value
        ? [value]
        : HAND_OBSERVATION_SIDES;
  return new Set(values.filter((side) => HAND_OBSERVATION_SIDES.includes(side)));
}
