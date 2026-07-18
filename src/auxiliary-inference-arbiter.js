export const AUXILIARY_INFERENCE_LANES = Object.freeze({
  FACE: "face",
  HAND_LEFT: "hand-left",
  HAND_RIGHT: "hand-right",
});

const FIXED_LANES = Object.freeze([
  AUXILIARY_INFERENCE_LANES.FACE,
  AUXILIARY_INFERENCE_LANES.HAND_LEFT,
  AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
]);
const FIXED_CAPACITY = 2;
const FIXED_MAX_QUEUE_DEPTH = FIXED_LANES.length - FIXED_CAPACITY;

/**
 * Owns admission across the three independent CPU inference lanes.
 *
 * Each caller already has a capacity-one latest-frame pump, so two active
 * leases can leave only the third distinct lane waiting. The owner preserves
 * that structural bound instead of pretending to provide a general-purpose
 * priority queue. When both Hand lanes are active, that sole waiter is Face.
 */
export function createAuxiliaryInferenceArbiter({
  capacity = FIXED_CAPACITY,
  now = defaultNow,
} = {}) {
  if (capacity !== FIXED_CAPACITY) {
    throw new RangeError(`Auxiliary inference capacity must remain ${FIXED_CAPACITY}.`);
  }
  if (typeof now !== "function") {
    throw new TypeError("Auxiliary inference now must be a function.");
  }

  let generation = 0;
  let requestSequence = 0;
  let queue = [];
  const activeByLane = new Map();
  const queuedByLane = new Map();
  let telemetry = createTelemetry();

  function createTelemetry() {
    return {
      attempts: 0,
      grants: 0,
      releases: 0,
      staleRejections: 0,
      duplicateLaneRejections: 0,
      queueOverflowRejections: 0,
      generationCancellations: 0,
      waitedGrants: 0,
      totalWaitMs: 0,
      maxWaitMs: 0,
      maxActive: 0,
      maxQueued: 0,
      byLane: Object.fromEntries(FIXED_LANES.map((lane) => [lane, {
        attempts: 0,
        grants: 0,
        releases: 0,
        rejections: 0,
        cancellations: 0,
        waitedGrants: 0,
        totalWaitMs: 0,
        maxWaitMs: 0,
      }])),
    };
  }

  function acquire({ lane, generation: requestGeneration, sourcePtsSec } = {}) {
    assertLane(lane);
    assertGeneration(requestGeneration);
    assertSourcePtsSec(sourcePtsSec);

    telemetry.attempts += 1;
    telemetry.byLane[lane].attempts += 1;

    if (requestGeneration !== generation) {
      telemetry.staleRejections += 1;
      telemetry.byLane[lane].rejections += 1;
      return Promise.resolve(null);
    }
    if (activeByLane.has(lane) || queuedByLane.has(lane)) {
      telemetry.duplicateLaneRejections += 1;
      telemetry.byLane[lane].rejections += 1;
      return Promise.resolve(null);
    }

    let resolveRequest;
    const promise = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const request = {
      id: ++requestSequence,
      lane,
      generation: requestGeneration,
      sourcePtsSec,
      enqueuedAt: readNow(now),
      waited: activeByLane.size >= capacity,
      sequence: requestSequence,
      resolve: resolveRequest,
    };

    if (activeByLane.size >= capacity && queue.length >= FIXED_MAX_QUEUE_DEPTH) {
      telemetry.queueOverflowRejections += 1;
      telemetry.byLane[lane].rejections += 1;
      resolveRequest(null);
      return promise;
    }

    queue.push(request);
    queuedByLane.set(lane, request);
    drain();
    telemetry.maxQueued = Math.max(telemetry.maxQueued, queue.length);
    return promise;
  }

  function drain() {
    while (activeByLane.size < capacity && queue.length > 0) {
      const request = queue.shift();
      queuedByLane.delete(request.lane);
      if (request.generation !== generation) {
        cancelRequest(request);
        continue;
      }

      const grantedAt = readNow(now);
      const waitMs = request.waited
        ? Math.max(0, grantedAt - request.enqueuedAt)
        : 0;
      const lease = createLease(request);
      activeByLane.set(request.lane, lease);
      telemetry.grants += 1;
      telemetry.byLane[request.lane].grants += 1;
      if (request.waited) {
        telemetry.waitedGrants += 1;
        telemetry.byLane[request.lane].waitedGrants += 1;
      }
      telemetry.totalWaitMs += waitMs;
      telemetry.maxWaitMs = Math.max(telemetry.maxWaitMs, waitMs);
      telemetry.byLane[request.lane].totalWaitMs += waitMs;
      telemetry.byLane[request.lane].maxWaitMs = Math.max(
        telemetry.byLane[request.lane].maxWaitMs,
        waitMs,
      );
      telemetry.maxActive = Math.max(telemetry.maxActive, activeByLane.size);
      request.resolve(lease);
    }
  }

  function createLease(request) {
    let released = false;
    let lease;
    lease = Object.freeze({
      lane: request.lane,
      generation: request.generation,
      sourcePtsSec: request.sourcePtsSec,
      release() {
        if (released) {
          return false;
        }
        const current = activeByLane.get(request.lane);
        if (current !== lease) {
          return false;
        }
        released = true;
        activeByLane.delete(request.lane);
        telemetry.releases += 1;
        telemetry.byLane[request.lane].releases += 1;
        drain();
        return true;
      },
    });
    return lease;
  }

  function advanceGeneration(nextGeneration) {
    assertGeneration(nextGeneration);
    if (nextGeneration < generation) {
      throw new RangeError("Auxiliary inference generation cannot move backwards.");
    }
    generation = nextGeneration;
    const staleQueue = queue.filter(
      (request) => request.generation !== generation,
    );
    queue = queue.filter((request) => request.generation === generation);
    for (const request of staleQueue) {
      queuedByLane.delete(request.lane);
      cancelRequest(request);
    }
    drain();
    return generation;
  }

  function cancelRequest(request) {
    telemetry.generationCancellations += 1;
    telemetry.byLane[request.lane].cancellations += 1;
    request.resolve(null);
  }

  function resetTelemetry() {
    telemetry = createTelemetry();
    telemetry.maxActive = activeByLane.size;
    telemetry.maxQueued = queue.length;
  }

  function getStatus() {
    return {
      capacity,
      maximumQueueDepth: FIXED_MAX_QUEUE_DEPTH,
      generation,
      active: activeByLane.size,
      queued: queue.length,
      ...telemetry,
      averageWaitMs: telemetry.grants > 0
        ? telemetry.totalWaitMs / telemetry.grants
        : 0,
      activeByLane: Object.fromEntries(
        FIXED_LANES.map((lane) => [lane, activeByLane.has(lane)]),
      ),
      queuedByLane: Object.fromEntries(
        FIXED_LANES.map((lane) => [lane, queuedByLane.has(lane)]),
      ),
      byLane: Object.fromEntries(
        FIXED_LANES.map((lane) => {
          const laneTelemetry = telemetry.byLane[lane];
          return [lane, {
            ...laneTelemetry,
            averageWaitMs: laneTelemetry.grants > 0
              ? laneTelemetry.totalWaitMs / laneTelemetry.grants
              : 0,
          }];
        }),
      ),
    };
  }

  return {
    acquire,
    advanceGeneration,
    resetTelemetry,
    getStatus,
    getGeneration: () => generation,
  };
}

function assertLane(lane) {
  if (!FIXED_LANES.includes(lane)) {
    throw new RangeError(`Unknown auxiliary inference lane: ${String(lane)}.`);
  }
}

function assertGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError("Auxiliary inference generation must be a non-negative safe integer.");
  }
}

function assertSourcePtsSec(sourcePtsSec) {
  if (!Number.isFinite(sourcePtsSec) || sourcePtsSec < 0) {
    throw new RangeError("Auxiliary inference sourcePtsSec must be a non-negative finite number.");
  }
}

function readNow(now) {
  const value = Number(now());
  if (!Number.isFinite(value)) {
    throw new Error("Auxiliary inference clock returned a non-finite value.");
  }
  return value;
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}
