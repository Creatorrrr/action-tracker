const DEFAULT_DEADLINE_MS = 80;
const DEFAULT_HISTORY_LIMIT = 64;
const DEFAULT_SOURCE_PTS_EPSILON_SEC = 0.000001;

const TERMINAL_OBSERVATION = "observation";
const TERMINAL_NULL_OBSERVATION = "null-observation";
const TERMINAL_DROP = "drop";
const TERMINAL_CANCELLATION = "cancellation";
const TERMINAL_DEADLINE_MISS = "deadline-miss";

/**
 * Owns the source-time identity and bounded maturation of admitted Face work.
 *
 * Registration happens before the inference pump takes ownership. A Body
 * frame then selects the newest admitted, non-future slot exactly once and
 * waits only until that slot's original callback deadline. Terminal entries
 * are immutable, so completion order cannot change a later avatar decision.
 */
export function createFaceObservationMaturationLedger({
  deadlineMs = DEFAULT_DEADLINE_MS,
  historyLimit = DEFAULT_HISTORY_LIMIT,
  sourcePtsEpsilonSec = DEFAULT_SOURCE_PTS_EPSILON_SEC,
  now = defaultNow,
  schedule = defaultSchedule,
  cancelSchedule = defaultCancelSchedule,
} = {}) {
  assertPositiveFinite(deadlineMs, "Face maturation deadlineMs");
  assertPositiveSafeInteger(historyLimit, "Face maturation historyLimit");
  assertNonNegativeFinite(
    sourcePtsEpsilonSec,
    "Face maturation sourcePtsEpsilonSec",
  );
  assertFunction(now, "Face maturation now");
  assertFunction(schedule, "Face maturation schedule");
  assertFunction(cancelSchedule, "Face maturation cancelSchedule");

  let activeGeneration = 0;
  let activeWaits = 0;
  let telemetry = createTelemetry();
  const entries = new Map();
  const entriesByToken = new WeakMap();
  const lastRegistrationByGeneration = new Map();

  function createTelemetry() {
    return {
      registrations: 0,
      waits: 0,
      totalWaitMs: 0,
      maxWaitMs: 0,
      maxPending: 0,
      maxWaits: 0,
      deadlineMisses: 0,
      lateDiscards: 0,
      terminalRejections: 0,
      drops: 0,
      cancellations: 0,
      terminalCounts: createTerminalCounts(),
    };
  }

  function createTerminalCounts() {
    return {
      observation: 0,
      nullObservation: 0,
      drop: 0,
      cancellation: 0,
      deadlineMiss: 0,
    };
  }

  function register({
    generation,
    slotIndex,
    sourcePtsSec,
    callbackMonotonicMs,
  } = {}) {
    assertGeneration(generation);
    assertSlotIndex(slotIndex);
    assertNonNegativeFinite(sourcePtsSec, "Face maturation sourcePtsSec");
    assertNonNegativeFinite(
      callbackMonotonicMs,
      "Face maturation callbackMonotonicMs",
    );
    if (generation !== activeGeneration) {
      throw new RangeError(
        `Face maturation rejected generation ${generation}; active generation is ${activeGeneration}.`,
      );
    }

    const previous = lastRegistrationByGeneration.get(generation) ?? null;
    if (
      previous &&
      (
        slotIndex <= previous.slotIndex ||
        sourcePtsSec <= previous.sourcePtsSec + sourcePtsEpsilonSec
      )
    ) {
      throw new RangeError(
        "Face maturation slots and source PTS must advance exactly once within a generation.",
      );
    }

    const key = createEntryKey(generation, slotIndex);
    if (entries.has(key)) {
      throw new Error(`Face maturation slot ${key} was already registered.`);
    }

    const token = Object.freeze({
      generation,
      slotIndex,
      sourcePtsSec,
      callbackMonotonicMs,
      deadlineMonotonicMs: callbackMonotonicMs + deadlineMs,
    });
    const entry = {
      key,
      token,
      generation,
      slotIndex,
      sourcePtsSec,
      callbackMonotonicMs,
      deadlineMonotonicMs: token.deadlineMonotonicMs,
      state: "pending",
      terminal: null,
      terminalReason: "",
      observation: null,
      terminalMonotonicMs: null,
      waiters: new Set(),
    };
    entries.set(key, entry);
    entriesByToken.set(token, entry);
    lastRegistrationByGeneration.set(generation, {
      slotIndex,
      sourcePtsSec,
    });
    telemetry.registrations += 1;
    telemetry.maxPending = Math.max(telemetry.maxPending, countPending());
    trimHistory();
    return token;
  }

  function settle(token, observation) {
    const entry = requireEntry(token);
    if (entry.state !== "pending") {
      telemetry.terminalRejections += 1;
      if (entry.terminal === TERMINAL_DEADLINE_MISS) {
        telemetry.lateDiscards += 1;
      }
      return false;
    }
    if (expirePastDeadline(entry)) {
      telemetry.lateDiscards += 1;
      return false;
    }
    if (
      !observation ||
      typeof observation !== "object" ||
      !Object.prototype.hasOwnProperty.call(observation, "face")
    ) {
      throw new TypeError(
        "Face maturation observation must explicitly contain a face value, including null.",
      );
    }

    const fixedObservation = freezeObservation(observation);
    const terminal = fixedObservation.face === null
      ? TERMINAL_NULL_OBSERVATION
      : TERMINAL_OBSERVATION;
    terminalize(entry, terminal, terminal, fixedObservation);
    return true;
  }

  function drop(token, reason = "dropped") {
    const entry = requireEntry(token);
    if (entry.state !== "pending") {
      return false;
    }
    if (expirePastDeadline(entry)) {
      return false;
    }
    terminalize(entry, TERMINAL_DROP, normalizeReason(reason), null);
    return true;
  }

  function cancelPending({ generation = null, reason = "cancelled" } = {}) {
    if (generation !== null) {
      assertGeneration(generation);
    }
    let cancelled = 0;
    for (const entry of entries.values()) {
      if (
        entry.state === "pending" &&
        (generation === null || entry.generation === generation)
      ) {
        if (entry.waiters.size > 0 && expirePastDeadline(entry)) {
          continue;
        }
        terminalize(
          entry,
          TERMINAL_CANCELLATION,
          normalizeReason(reason),
          null,
        );
        cancelled += 1;
      }
    }
    return cancelled;
  }

  async function waitForEligible({
    generation,
    bodySourcePtsSec,
    applicationLagMs,
  } = {}) {
    assertGeneration(generation);
    assertNonNegativeFinite(
      bodySourcePtsSec,
      "Face maturation bodySourcePtsSec",
    );
    assertNonNegativeFinite(
      applicationLagMs,
      "Face maturation applicationLagMs",
    );

    const cutoffSourcePtsSec = bodySourcePtsSec - applicationLagMs / 1000;
    if (generation !== activeGeneration) {
      return createUnavailableSnapshot({
        generation,
        bodySourcePtsSec,
        cutoffSourcePtsSec,
        reason: "generation-mismatch",
      });
    }

    let selected = null;
    let hasFuture = false;
    for (const entry of entries.values()) {
      if (entry.generation !== generation) {
        continue;
      }
      if (
        entry.sourcePtsSec >
        cutoffSourcePtsSec + sourcePtsEpsilonSec
      ) {
        hasFuture = true;
        continue;
      }
      if (
        !selected ||
        entry.sourcePtsSec > selected.sourcePtsSec ||
        (
          Math.abs(entry.sourcePtsSec - selected.sourcePtsSec) <=
            sourcePtsEpsilonSec &&
          entry.slotIndex > selected.slotIndex
        )
      ) {
        selected = entry;
      }
    }

    if (!selected) {
      return createUnavailableSnapshot({
        generation,
        bodySourcePtsSec,
        cutoffSourcePtsSec,
        reason: hasFuture ? "future-only" : "no-admitted-slot",
      });
    }

    if (selected.state !== "pending") {
      return createEntrySnapshot(selected, {
        bodySourcePtsSec,
        cutoffSourcePtsSec,
        waited: false,
        waitMs: 0,
      });
    }
    if (expirePastDeadline(selected)) {
      return createEntrySnapshot(selected, {
        bodySourcePtsSec,
        cutoffSourcePtsSec,
        waited: false,
        waitMs: 0,
      });
    }

    return waitForTerminal(selected, {
      bodySourcePtsSec,
      cutoffSourcePtsSec,
    });
  }

  function waitForTerminal(entry, selectionMeta) {
    const startedAt = readNow();
    const remainingMs = Math.max(0, entry.deadlineMonotonicMs - startedAt);
    if (remainingMs <= 0) {
      terminalize(
        entry,
        TERMINAL_DEADLINE_MISS,
        TERMINAL_DEADLINE_MISS,
        null,
      );
      return Promise.resolve(createEntrySnapshot(entry, {
        ...selectionMeta,
        waited: false,
        waitMs: 0,
      }));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        startedAt,
        timerId: null,
        selectionMeta,
        resolve,
      };
      entry.waiters.add(waiter);
      activeWaits += 1;
      telemetry.maxWaits = Math.max(telemetry.maxWaits, activeWaits);
      try {
        scheduleWaiterDeadline(entry, waiter);
      } catch (error) {
        entry.waiters.delete(waiter);
        activeWaits = Math.max(0, activeWaits - 1);
        terminalize(
          entry,
          TERMINAL_DROP,
          "deadline-schedule-error",
          null,
        );
        reject(error);
      }
    });
  }

  function scheduleWaiterDeadline(entry, waiter) {
    const remainingMs = entry.deadlineMonotonicMs - readNow();
    if (remainingMs <= 0) {
      terminalize(
        entry,
        TERMINAL_DEADLINE_MISS,
        TERMINAL_DEADLINE_MISS,
        null,
      );
      return;
    }
    waiter.timerId = schedule(() => {
      waiter.timerId = null;
      if (!entry.waiters.has(waiter)) {
        return;
      }
      // Timers may fire early because of host rounding. The monotonic clock,
      // not timer delivery, owns the original callback + deadline fence.
      if (readNow() < entry.deadlineMonotonicMs) {
        try {
          scheduleWaiterDeadline(entry, waiter);
        } catch {
          terminalize(
            entry,
            TERMINAL_DROP,
            "deadline-schedule-error",
            null,
          );
        }
        return;
      }
      terminalize(
        entry,
        TERMINAL_DEADLINE_MISS,
        TERMINAL_DEADLINE_MISS,
        null,
      );
    }, remainingMs);
  }

  function advanceGeneration(nextGeneration) {
    assertGeneration(nextGeneration);
    if (nextGeneration < activeGeneration) {
      throw new RangeError("Face maturation generation cannot move backwards.");
    }
    activeGeneration = nextGeneration;
    for (const entry of entries.values()) {
      if (entry.state === "pending" && entry.generation !== nextGeneration) {
        if (entry.waiters.size > 0 && expirePastDeadline(entry)) {
          continue;
        }
        terminalize(
          entry,
          TERMINAL_CANCELLATION,
          "generation-advanced",
          null,
        );
      }
    }
    for (const generation of lastRegistrationByGeneration.keys()) {
      if (generation !== nextGeneration) {
        lastRegistrationByGeneration.delete(generation);
      }
    }
    trimHistory();
    return activeGeneration;
  }

  function resetTelemetry() {
    telemetry = createTelemetry();
    telemetry.maxPending = countPending();
    telemetry.maxWaits = activeWaits;
  }

  function getStatus() {
    const currentByTerminal = createTerminalCounts();
    for (const entry of entries.values()) {
      incrementTerminalCount(currentByTerminal, entry.terminal);
    }
    return {
      activeGeneration,
      deadlineMs,
      historyLimit,
      entries: entries.size,
      pending: countPending(),
      currentWaits: activeWaits,
      ...telemetry,
      averageWaitMs: telemetry.waits > 0
        ? telemetry.totalWaitMs / telemetry.waits
        : 0,
      terminalCounts: { ...telemetry.terminalCounts },
      currentByTerminal,
    };
  }

  function terminalize(entry, terminal, reason, observation) {
    if (entry.state !== "pending") {
      return false;
    }
    entry.state = "terminal";
    entry.terminal = terminal;
    entry.terminalReason = reason;
    entry.observation = observation;
    entry.terminalMonotonicMs = readNow();

    if (terminal === TERMINAL_DEADLINE_MISS) {
      telemetry.deadlineMisses += 1;
    } else if (terminal === TERMINAL_DROP) {
      telemetry.drops += 1;
    } else if (terminal === TERMINAL_CANCELLATION) {
      telemetry.cancellations += 1;
    }
    incrementTerminalCount(telemetry.terminalCounts, terminal);

    for (const waiter of [...entry.waiters]) {
      finishWaiter(entry, waiter);
    }
    trimHistory();
    return true;
  }

  function finishWaiter(entry, waiter) {
    if (!entry.waiters.delete(waiter)) {
      return false;
    }
    if (waiter.timerId !== null) {
      try {
        cancelSchedule(waiter.timerId);
      } catch {
        // The terminal state still owns the slot even if host timer cleanup
        // reports a best-effort failure.
      }
      waiter.timerId = null;
    }
    activeWaits = Math.max(0, activeWaits - 1);
    const waitMs = Math.max(0, readNow() - waiter.startedAt);
    telemetry.waits += 1;
    telemetry.totalWaitMs += waitMs;
    telemetry.maxWaitMs = Math.max(telemetry.maxWaitMs, waitMs);
    waiter.resolve(createEntrySnapshot(entry, {
      ...waiter.selectionMeta,
      waited: true,
      waitMs,
    }));
    return true;
  }

  function expirePastDeadline(entry) {
    if (
      entry.state === "pending" &&
      readNow() >= entry.deadlineMonotonicMs
    ) {
      terminalize(
        entry,
        TERMINAL_DEADLINE_MISS,
        TERMINAL_DEADLINE_MISS,
        null,
      );
      return true;
    }
    return false;
  }

  function trimHistory() {
    while (entries.size > historyLimit) {
      let removableKey = null;
      for (const [key, entry] of entries) {
        if (entry.state === "terminal" && entry.waiters.size === 0) {
          removableKey = key;
          break;
        }
      }
      if (removableKey === null) {
        break;
      }
      entries.delete(removableKey);
    }
  }

  function createEntrySnapshot(entry, {
    bodySourcePtsSec,
    cutoffSourcePtsSec,
    waited,
    waitMs,
  }) {
    return Object.freeze({
      found: true,
      generation: entry.generation,
      slotIndex: entry.slotIndex,
      sourcePtsSec: entry.sourcePtsSec,
      callbackMonotonicMs: entry.callbackMonotonicMs,
      deadlineMonotonicMs: entry.deadlineMonotonicMs,
      bodySourcePtsSec,
      cutoffSourcePtsSec,
      terminal: entry.terminal,
      reason: entry.terminalReason,
      observation: entry.observation,
      waited,
      waitMs,
    });
  }

  function createUnavailableSnapshot({
    generation,
    bodySourcePtsSec,
    cutoffSourcePtsSec,
    reason,
  }) {
    return Object.freeze({
      found: false,
      generation,
      slotIndex: null,
      sourcePtsSec: null,
      callbackMonotonicMs: null,
      deadlineMonotonicMs: null,
      bodySourcePtsSec,
      cutoffSourcePtsSec,
      terminal: "unavailable",
      reason,
      observation: null,
      waited: false,
      waitMs: 0,
    });
  }

  function requireEntry(token) {
    if (!token || typeof token !== "object") {
      throw new TypeError("Face maturation token must be an object.");
    }
    const entry = entriesByToken.get(token);
    if (!entry || entry.token !== token) {
      throw new Error("Face maturation token is unknown or inconsistent.");
    }
    return entry;
  }

  function countPending() {
    let pending = 0;
    for (const entry of entries.values()) {
      if (entry.state === "pending") {
        pending += 1;
      }
    }
    return pending;
  }

  function readNow() {
    const value = Number(now());
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError("Face maturation monotonic clock must be non-negative and finite.");
    }
    return value;
  }

  return Object.freeze({
    register,
    settle,
    drop,
    cancelPending,
    waitForEligible,
    advanceGeneration,
    resetTelemetry,
    getStatus,
    getGeneration: () => activeGeneration,
  });
}

function incrementTerminalCount(counts, terminal) {
  if (terminal === TERMINAL_OBSERVATION) {
    counts.observation += 1;
  } else if (terminal === TERMINAL_NULL_OBSERVATION) {
    counts.nullObservation += 1;
  } else if (terminal === TERMINAL_DROP) {
    counts.drop += 1;
  } else if (terminal === TERMINAL_CANCELLATION) {
    counts.cancellation += 1;
  } else if (terminal === TERMINAL_DEADLINE_MISS) {
    counts.deadlineMiss += 1;
  }
}

function createEntryKey(generation, slotIndex) {
  return `${generation}:${slotIndex}`;
}

function normalizeReason(reason) {
  const normalized = String(reason ?? "").trim();
  return normalized || "unspecified";
}

function freezeObservation(observation) {
  const fixedFace = observation.face && typeof observation.face === "object"
    ? Object.freeze(
      Array.isArray(observation.face)
        ? [...observation.face]
        : { ...observation.face },
    )
    : observation.face;
  const fixedSourceMeta = observation.sourceMeta &&
      typeof observation.sourceMeta === "object"
    ? Object.freeze({ ...observation.sourceMeta })
    : observation.sourceMeta;
  return Object.freeze({
    ...observation,
    face: fixedFace,
    sourceMeta: fixedSourceMeta,
  });
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function.`);
  }
}

function assertGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError(
      "Face maturation generation must be a non-negative safe integer.",
    );
  }
}

function assertSlotIndex(slotIndex) {
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) {
    throw new RangeError(
      "Face maturation slotIndex must be a non-negative safe integer.",
    );
  }
}

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function assertPositiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be positive and finite.`);
  }
}

function assertNonNegativeFinite(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be non-negative and finite.`);
  }
}

function defaultNow() {
  if (typeof globalThis.performance?.now === "function") {
    return globalThis.performance.now();
  }
  return Date.now();
}

function defaultSchedule(callback, delayMs) {
  return setTimeout(callback, delayMs);
}

function defaultCancelSchedule(timerId) {
  clearTimeout(timerId);
}
