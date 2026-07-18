const DEFAULT_GENERATION = 0;

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

/**
 * Runs at most one frame at a time while retaining only the newest queued frame.
 *
 * The pump owns every accepted envelope until it calls dispose exactly once.
 * Envelopes without a generation are stamped in place so their identity and
 * timing metadata are preserved across consume/apply/dispose.
 */
export function createLatestFramePump({ consume, apply, dispose, onTransition } = {}) {
  assertFunction(consume, "consume");
  assertFunction(apply, "apply");
  assertFunction(dispose, "dispose");
  if (onTransition != null) {
    assertFunction(onTransition, "onTransition");
  }

  let generation = DEFAULT_GENERATION;
  let pendingEntry = null;
  let nextPendingId = 1;
  let inFlight = false;
  const disposedEnvelopes = new WeakSet();
  let telemetry = createTelemetry();

  function createTelemetry() {
    return {
      offered: 0,
      started: 0,
      applied: 0,
      overloadDrops: 0,
      staleQueuedDrops: 0,
      staleResultDrops: 0,
      consumeErrors: 0,
      applyErrors: 0,
      disposeErrors: 0,
      queuedTransitions: 0,
      replacedTransitions: 0,
      promotedTransitions: 0,
      settledTransitions: 0,
      droppedTransitions: 0,
      transitionErrors: 0,
      maxQueueDepth: 0,
    };
  }

  function createPendingMeta(envelope) {
    const sourcePtsSec = Number(envelope.sourcePtsSec);
    const callbackMonotonicMs = Number(envelope.callbackMonotonicMs);
    const pendingDeadlineMonotonicMs = Number(
      envelope.pendingDeadlineMonotonicMs,
    );
    return Object.freeze({
      pendingId: nextPendingId++,
      generation: envelope.generation,
      sourcePtsSec: Number.isFinite(sourcePtsSec) ? sourcePtsSec : null,
      callbackMonotonicMs: Number.isFinite(callbackMonotonicMs)
        ? callbackMonotonicMs
        : null,
      pendingDeadlineMonotonicMs: Number.isFinite(pendingDeadlineMonotonicMs)
        ? pendingDeadlineMonotonicMs
        : null,
    });
  }

  function emitTransition(type, details = {}) {
    if (!onTransition) return;
    const transition = Object.freeze({
      type,
      pumpGeneration: generation,
      ...details,
    });
    try {
      onTransition(transition);
    } catch {
      telemetry.transitionErrors += 1;
    }
  }

  function isCurrent(envelope) {
    return envelope.generation === generation;
  }

  function disposeEnvelope(envelope, reason) {
    if (disposedEnvelopes.has(envelope)) return;
    disposedEnvelopes.add(envelope);
    try {
      dispose(envelope, reason);
    } catch {
      telemetry.disposeErrors += 1;
    }
  }

  function noteQueueDepth() {
    if (pendingEntry) {
      telemetry.maxQueueDepth = Math.max(telemetry.maxQueueDepth, 1);
    }
  }

  function dropPending(reason = "stale-queued") {
    if (!pendingEntry) return false;
    const dropped = pendingEntry;
    pendingEntry = null;
    telemetry.staleQueuedDrops += 1;
    telemetry.droppedTransitions += 1;
    emitTransition("pending-dropped", {
      pending: dropped.meta,
      reason,
    });
    disposeEnvelope(dropped.envelope, reason);
    return true;
  }

  async function run(envelope, promotedMeta = null) {
    inFlight = true;
    telemetry.started += 1;

    let result;
    let consumeFailed = false;
    let settleReason = "apply-rejected";
    try {
      result = await consume(envelope);
    } catch {
      consumeFailed = true;
      telemetry.consumeErrors += 1;
    }

    if (consumeFailed) {
      settleReason = "consume-error";
      disposeEnvelope(envelope, "consume-error");
    } else if (!isCurrent(envelope)) {
      settleReason = "stale-result";
      telemetry.staleResultDrops += 1;
      disposeEnvelope(envelope, "stale-result");
    } else {
      disposeEnvelope(envelope, "consumed");
      try {
        // There is no await between the generation check and apply invocation,
        // so a stale generation can never enter apply.
        const wasApplied = await apply(result, envelope);
        if (wasApplied !== false) {
          telemetry.applied += 1;
          settleReason = "applied";
        }
      } catch {
        settleReason = "apply-error";
        telemetry.applyErrors += 1;
      }
    }

    inFlight = false;
    if (promotedMeta) {
      telemetry.settledTransitions += 1;
      emitTransition("pending-settled", {
        pending: promotedMeta,
        reason: settleReason,
      });
    }
    startPendingIfIdle();
  }

  function startPendingIfIdle() {
    if (inFlight || !pendingEntry) return;

    const next = pendingEntry;
    pendingEntry = null;
    if (!isCurrent(next.envelope)) {
      telemetry.staleQueuedDrops += 1;
      telemetry.droppedTransitions += 1;
      emitTransition("pending-dropped", {
        pending: next.meta,
        reason: "stale-queued",
      });
      disposeEnvelope(next.envelope, "stale-queued");
      startPendingIfIdle();
      return;
    }

    telemetry.promotedTransitions += 1;
    emitTransition("pending-promoted", { pending: next.meta });
    void run(next.envelope, next.meta);
  }

  function offer(envelope) {
    if (!envelope || typeof envelope !== "object") {
      throw new TypeError("envelope must be an object");
    }

    telemetry.offered += 1;
    if (envelope.generation == null) {
      envelope.generation = generation;
    }

    if (!isCurrent(envelope)) {
      telemetry.staleQueuedDrops += 1;
      disposeEnvelope(envelope, "stale-queued");
      return false;
    }

    if (!inFlight) {
      void run(envelope);
      return true;
    }

    const queued = {
      envelope,
      meta: createPendingMeta(envelope),
    };
    if (pendingEntry) {
      const superseded = pendingEntry;
      pendingEntry = queued;
      telemetry.overloadDrops += 1;
      telemetry.replacedTransitions += 1;
      emitTransition("pending-replaced", {
        pending: queued.meta,
        replaced: superseded.meta,
        reason: "overload",
      });
      disposeEnvelope(superseded.envelope, "overload");
    } else {
      pendingEntry = queued;
      telemetry.queuedTransitions += 1;
      emitTransition("pending-queued", { pending: queued.meta });
    }

    noteQueueDepth();
    startPendingIfIdle();
    return true;
  }

  function advanceGeneration(reason = "generation-advanced") {
    generation += 1;
    dropPending(reason);
    return generation;
  }

  function clearPending(reason = "pending-cleared") {
    return dropPending(reason);
  }

  function resetTelemetry() {
    telemetry = createTelemetry();
    // Preserve the max >= current queue depth invariant without changing the
    // pending or in-flight work itself.
    telemetry.maxQueueDepth = pendingEntry ? 1 : 0;
  }

  function getStatus() {
    return {
      generation,
      ...telemetry,
      queueDepth: pendingEntry ? 1 : 0,
      inFlight,
    };
  }

  return {
    offer,
    advanceGeneration,
    clearPending,
    resetTelemetry,
    getStatus,
    getGeneration: () => generation,
  };
}
