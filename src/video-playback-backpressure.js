const DEFAULT_MAX_HOLD_MS = 80;
const DEFAULT_PENDING_HYSTERESIS_MS = 20;

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultSetTimer(callback, delayMs) {
  return globalThis.setTimeout(callback, delayMs);
}

function defaultClearTimer(timerId) {
  globalThis.clearTimeout(timerId);
}

function assertFunction(value, name) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeNow(now) {
  return finiteNumber(now()) ?? 0;
}

function samePending(owner, pending) {
  return Boolean(
    owner &&
      pending &&
      owner.generation === pending.generation &&
      owner.pendingId === pending.pendingId
  );
}

function createTelemetry() {
  return {
    episodes: 0,
    pauseCount: 0,
    resumeCount: 0,
    cancelCount: 0,
    deadlineBypasses: 0,
    replacementsWhileHeld: 0,
    blockedPlayAttempts: 0,
    resumeErrors: 0,
    controlErrors: 0,
    resumeSuppressions: 0,
    hysteresisStarts: 0,
    avoidedPauseCount: 0,
    sustainedPauseCount: 0,
    settledResumeCount: 0,
    totalHoldMs: 0,
    maxHoldMs: 0,
    lastHoldMs: 0,
    lastReleaseReason: "",
  };
}

/**
 * Owns transient playback pauses for an active file-video Body backlog.
 *
 * The latest-frame pump remains the sole owner of frame envelopes. This
 * controller only reacts to immutable pending transitions and never creates,
 * duplicates, or reorders a MotionFrame.
 */
export function createVideoPlaybackBackpressureController({
  maxHoldMs = DEFAULT_MAX_HOLD_MS,
  pendingHysteresisMs = DEFAULT_PENDING_HYSTERESIS_MS,
  now = defaultNow,
  setTimer = defaultSetTimer,
  clearTimer = defaultClearTimer,
  getRuntimeContext,
  cancelScheduledFrame,
  scheduleFrame,
  onError = () => undefined,
} = {}) {
  if (!Number.isFinite(maxHoldMs) || maxHoldMs <= 0) {
    throw new TypeError("maxHoldMs must be a positive finite number");
  }
  if (!Number.isFinite(pendingHysteresisMs) || pendingHysteresisMs <= 0) {
    throw new TypeError("pendingHysteresisMs must be a positive finite number");
  }
  assertFunction(now, "now");
  assertFunction(setTimer, "setTimer");
  assertFunction(clearTimer, "clearTimer");
  assertFunction(getRuntimeContext, "getRuntimeContext");
  assertFunction(cancelScheduledFrame, "cancelScheduledFrame");
  assertFunction(scheduleFrame, "scheduleFrame");
  assertFunction(onError, "onError");

  let nextOwnerToken = 1;
  let activeOwner = null;
  let bypassOwner = null;
  let telemetry = createTelemetry();
  let telemetryStartedAt = safeNow(now);

  function reportError(error, phase) {
    const normalized = error instanceof Error
      ? error
      : new Error(String(error ?? "unknown video backpressure error"));
    normalized.videoPlaybackBackpressurePhase = phase;
    try {
      onError(normalized, phase);
    } catch {
      // Error reporting must never corrupt pump ownership.
    }
  }

  function noteControlError(error, phase) {
    telemetry.controlErrors += 1;
    reportError(error, phase);
  }

  function getContext() {
    try {
      return getRuntimeContext() ?? {};
    } catch (error) {
      noteControlError(error, "runtime-context");
      return {};
    }
  }

  function contextMatchesPending(context, pending, { requirePlaying = false } = {}) {
    const media = context.media;
    return Boolean(
      context.active === true &&
        context.inputKind === "video" &&
        context.pumpMode === "rvfc" &&
        context.boundaryActive !== true &&
        context.generation === pending.generation &&
        media &&
        media.ended !== true &&
        (!requirePlaying || media.paused === false)
    );
  }

  function clearOwnerTimer(owner, key, phase) {
    if (owner?.[key] == null) return;
    try {
      clearTimer(owner[key]);
    } catch (error) {
      noteControlError(error, phase);
    }
    owner[key] = null;
  }

  function clearOwnerTimers(owner) {
    clearOwnerTimer(owner, "hysteresisTimerId", "clear-hysteresis");
    clearOwnerTimer(owner, "deadlineTimerId", "clear-deadline");
  }

  function finishActive(reason) {
    if (!activeOwner) return null;
    const owner = activeOwner;
    activeOwner = null;
    clearOwnerTimers(owner);
    const endedAt = safeNow(now);
    const measuredFrom = owner.pausedByController
      ? Math.max(owner.pauseStartedAt, telemetryStartedAt)
      : null;
    const holdMs = measuredFrom === null ? 0 : Math.max(0, endedAt - measuredFrom);
    if (owner.pausedByController) {
      telemetry.totalHoldMs += holdMs;
      telemetry.maxHoldMs = Math.max(telemetry.maxHoldMs, holdMs);
      telemetry.lastHoldMs = holdMs;
    }
    telemetry.lastReleaseReason = String(reason || "released");
    return owner;
  }

  function canResumeOwner(owner) {
    const context = getContext();
    return contextMatchesPending(context, owner) && context.media === owner.media;
  }

  function requestResume(owner, reason) {
    if (
      !owner?.pausedByController ||
      !owner.wasPlaying ||
      !canResumeOwner(owner)
    ) {
      telemetry.resumeSuppressions += 1;
      return false;
    }

    try {
      scheduleFrame();
    } catch (error) {
      noteControlError(error, "schedule-resume-frame");
      return false;
    }

    let playback;
    try {
      playback = owner.media.play();
      telemetry.resumeCount += 1;
    } catch (error) {
      telemetry.resumeErrors += 1;
      try {
        cancelScheduledFrame();
      } catch (cancelError) {
        noteControlError(cancelError, "cancel-after-play-error");
      }
      reportError(error, `play-${reason}`);
      return false;
    }

    playback?.catch?.((error) => {
      telemetry.resumeErrors += 1;
      try {
        cancelScheduledFrame();
      } catch (cancelError) {
        noteControlError(cancelError, "cancel-after-play-rejection");
      }
      reportError(error, `play-${reason}`);
    });
    return true;
  }

  function releaseAndResume(reason) {
    const owner = finishActive(reason);
    return owner ? requestResume(owner, reason) : false;
  }

  function enterDeadlineBypass(owner) {
    if (activeOwner?.ownerToken !== owner.ownerToken) return false;
    const released = finishActive("deadline");
    bypassOwner = {
      generation: released.generation,
      pendingId: released.pendingId,
      sourcePtsSec: released.sourcePtsSec,
      wasPlaying: released.wasPlaying,
      promoted: released.promoted,
    };
    telemetry.deadlineBypasses += 1;
    if (released.pausedByController) {
      requestResume(released, "deadline");
    }
    return true;
  }

  function armDeadline(owner) {
    const delayMs = Math.max(0, owner.deadlineMonotonicMs - safeNow(now));
    try {
      owner.deadlineTimerId = setTimer(
        () => enterDeadlineBypass(owner),
        delayMs,
      );
    } catch (error) {
      noteControlError(error, "arm-deadline");
      enterDeadlineBypass(owner);
    }
  }

  function cancelIneligibleOwner(owner, reason) {
    if (activeOwner?.ownerToken !== owner.ownerToken) return false;
    finishActive(reason);
    telemetry.cancelCount += 1;
    return false;
  }

  function sustainPending(owner) {
    if (activeOwner?.ownerToken !== owner.ownerToken) return false;
    owner.hysteresisTimerId = null;
    const context = getContext();
    if (
      !contextMatchesPending(context, owner, { requirePlaying: true }) ||
      context.media !== owner.media
    ) {
      return cancelIneligibleOwner(owner, "hysteresis-ineligible");
    }

    try {
      cancelScheduledFrame();
    } catch (error) {
      noteControlError(error, "cancel-prearmed-frame");
      return cancelIneligibleOwner(owner, "cancel-prearmed-frame-error");
    }

    try {
      owner.media.pause();
    } catch (error) {
      try {
        scheduleFrame();
      } catch (scheduleError) {
        noteControlError(scheduleError, "schedule-after-pause-error");
      }
      noteControlError(error, "pause");
      return cancelIneligibleOwner(owner, "pause-error");
    }

    owner.phase = "held";
    owner.pausedByController = true;
    owner.pauseStartedAt = safeNow(now);
    telemetry.episodes += 1;
    telemetry.pauseCount += 1;
    telemetry.sustainedPauseCount += 1;
    return true;
  }

  function armHysteresis(owner) {
    const delayMs = Math.max(
      0,
      Math.min(
        pendingHysteresisMs,
        owner.deadlineMonotonicMs - safeNow(now),
      ),
    );
    try {
      owner.hysteresisTimerId = setTimer(
        () => sustainPending(owner),
        delayMs,
      );
    } catch (error) {
      noteControlError(error, "arm-hysteresis");
      cancelIneligibleOwner(owner, "arm-hysteresis-error");
    }
  }

  function acquire(pending) {
    if (activeOwner || bypassOwner) return false;
    const context = getContext();
    if (!contextMatchesPending(context, pending, { requirePlaying: true })) {
      return false;
    }

    const deadlineMonotonicMs = finiteNumber(pending.pendingDeadlineMonotonicMs);
    const currentTime = safeNow(now);
    if (deadlineMonotonicMs === null || deadlineMonotonicMs <= currentTime) {
      bypassOwner = {
        generation: pending.generation,
        pendingId: pending.pendingId,
        sourcePtsSec: pending.sourcePtsSec,
        wasPlaying: true,
        promoted: false,
      };
      telemetry.deadlineBypasses += 1;
      telemetry.lastReleaseReason = "deadline-before-acquire";
      return true;
    }

    const owner = {
      ownerToken: nextOwnerToken++,
      generation: pending.generation,
      pendingId: pending.pendingId,
      sourcePtsSec: pending.sourcePtsSec,
      deadlineMonotonicMs: Math.min(
        deadlineMonotonicMs,
        currentTime + maxHoldMs,
      ),
      media: context.media,
      wasPlaying: true,
      startedAt: currentTime,
      pauseStartedAt: null,
      pausedByController: false,
      promoted: false,
      phase: "hysteresis",
      hysteresisTimerId: null,
      deadlineTimerId: null,
    };
    activeOwner = owner;
    telemetry.hysteresisStarts += 1;
    // The absolute callback deadline is armed first so a short remaining
    // budget fails open without briefly controlling media at the same instant.
    armDeadline(owner);
    if (activeOwner?.ownerToken === owner.ownerToken) {
      armHysteresis(owner);
    }
    return true;
  }

  function handleReplacement(transition) {
    if (samePending(activeOwner, transition.replaced)) {
      telemetry.replacementsWhileHeld += 1;
      activeOwner.pendingId = transition.pending.pendingId;
      activeOwner.sourcePtsSec = transition.pending.sourcePtsSec;
      return true;
    }
    if (samePending(bypassOwner, transition.replaced)) {
      bypassOwner.pendingId = transition.pending.pendingId;
      bypassOwner.sourcePtsSec = transition.pending.sourcePtsSec;
      return true;
    }
    return false;
  }

  function handleTransition(transition) {
    const type = String(transition?.type ?? "");
    const pending = transition?.pending;
    if (!pending || !Number.isSafeInteger(pending.generation)) return false;

    if (type === "pending-queued") {
      return acquire(pending);
    }
    if (type === "pending-replaced") {
      return handleReplacement(transition);
    }
    if (type === "pending-promoted") {
      if (samePending(activeOwner, pending)) {
        activeOwner.promoted = true;
        if (!activeOwner.pausedByController) {
          finishActive("promoted-within-hysteresis");
          telemetry.avoidedPauseCount += 1;
          return true;
        }
        activeOwner.phase = "promoted-held";
        return true;
      }
      if (samePending(bypassOwner, pending)) {
        bypassOwner.promoted = true;
        return true;
      }
      return false;
    }
    if (type === "pending-settled") {
      if (samePending(activeOwner, pending)) {
        const wasHeld = activeOwner.pausedByController;
        const resumed = releaseAndResume("pending-settled");
        if (wasHeld) {
          telemetry.settledResumeCount += 1;
        }
        return resumed || wasHeld;
      }
      if (samePending(bypassOwner, pending)) {
        bypassOwner = null;
        return true;
      }
      return false;
    }
    if (type === "pending-dropped") {
      if (samePending(activeOwner, pending)) {
        const owner = finishActive(transition.reason || "pending-dropped");
        telemetry.cancelCount += 1;
        if (owner.pausedByController) {
          requestResume(owner, transition.reason || "pending-dropped");
        }
        return true;
      }
      if (samePending(bypassOwner, pending)) {
        bypassOwner = null;
        return true;
      }
    }
    return false;
  }

  function cancel(reason = "cancelled") {
    const owner = finishActive(reason);
    const bypass = bypassOwner;
    bypassOwner = null;
    if (!owner && !bypass) {
      return {
        cancelled: false,
        wasPlaying: false,
        generation: null,
      };
    }
    telemetry.cancelCount += 1;
    return {
      cancelled: true,
      wasPlaying: Boolean(owner?.wasPlaying ?? bypass?.wasPlaying),
      generation: owner?.generation ?? bypass?.generation ?? null,
      sourcePtsSec: owner?.sourcePtsSec ?? bypass?.sourcePtsSec ?? null,
      reason: String(reason || "cancelled"),
    };
  }

  function blockPlayAttempt(media, generation) {
    if (
      !activeOwner ||
      !activeOwner.pausedByController ||
      activeOwner.media !== media ||
      activeOwner.generation !== generation
    ) {
      return false;
    }
    telemetry.blockedPlayAttempts += 1;
    try {
      media.pause();
    } catch (error) {
      noteControlError(error, "block-play");
    }
    return true;
  }

  function resetTelemetry() {
    telemetry = createTelemetry();
    telemetryStartedAt = safeNow(now);
  }

  function getStatus() {
    const currentTime = safeNow(now);
    return {
      active: Boolean(activeOwner),
      bypassActive: Boolean(bypassOwner),
      hysteresisActive: activeOwner?.phase === "hysteresis",
      pausedByController: Boolean(activeOwner?.pausedByController),
      promoted: Boolean(activeOwner?.promoted ?? bypassOwner?.promoted),
      generation: activeOwner?.generation ?? bypassOwner?.generation ?? null,
      pendingId: activeOwner?.pendingId ?? bypassOwner?.pendingId ?? null,
      sourcePtsSec:
        activeOwner?.sourcePtsSec ?? bypassOwner?.sourcePtsSec ?? null,
      deadlineMonotonicMs: activeOwner?.deadlineMonotonicMs ?? null,
      currentHoldMs: activeOwner
        ? activeOwner.pausedByController
          ? Math.max(
            0,
            currentTime - Math.max(activeOwner.pauseStartedAt, telemetryStartedAt),
          )
          : 0
        : 0,
      maxConfiguredHoldMs: maxHoldMs,
      configuredHysteresisMs: pendingHysteresisMs,
      ...telemetry,
    };
  }

  return {
    handleTransition,
    blockPlayAttempt,
    cancel,
    resetTelemetry,
    getStatus,
  };
}
