function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isDetectorReference(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function detectorIdsToWireValue(detectorIds) {
  return detectorIds.join(",");
}

function normalizeConfigurationKey(value) {
  return String(value ?? "");
}

function createGenerationError(message, generation, telemetry, details = {}) {
  const error = new Error(message);
  error.code = "VIDEO_TRACKER_GENERATION_ERROR";
  error.bodyTrackerGenerationMeta = {
    bodyTrackerGeneration: Number.isSafeInteger(generation) ? generation : null,
    bodyTrackerResetCount: details.resetDetectors?.length ?? 0,
    bodyTrackerResetDetectors: detectorIdsToWireValue(details.resetDetectors ?? []),
    bodyTrackerResetDurationMs: details.resetDurationMs ?? 0,
    bodyTrackerSeededDetectors: detectorIdsToWireValue(details.seededDetectors ?? []),
    ...telemetry,
  };
  return error;
}

function assertInputGeneration(inputGeneration) {
  if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
    throw new TypeError("inputGeneration must be a non-negative safe integer");
  }
}

function safeDurationMs(now, startedAt) {
  const endedAt = Number(now());
  return Number.isFinite(endedAt) ? Math.max(0, endedAt - startedAt) : 0;
}

function requestMediaPlayback(media) {
  if (typeof media?.play !== "function") {
    return false;
  }

  try {
    const playback = media.play();
    playback?.catch?.(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps source media frozen while the first frame of an input generation is
 * prepared, detected, and applied. The state machine owns the applied
 * generation independently from detector preparation so a worker response or
 * an apply failure cannot make an unapplied generation look complete.
 */
export function createInputGenerationPlaybackGate({ now = defaultNow } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  let activeGate = null;
  let appliedGeneration = null;
  let lastRelease = null;

  function buildFrameMeta(inputGeneration, resumeReason = "applied") {
    const isActiveGeneration = activeGate?.inputGeneration === inputGeneration;
    return {
      bodyTrackerPlaybackGated: isActiveGeneration,
      bodyTrackerPlaybackGateGeneration: isActiveGeneration ? inputGeneration : null,
      bodyTrackerPlaybackGateDurationMs: isActiveGeneration
        ? safeDurationMs(now, activeGate.startedAt)
        : 0,
      bodyTrackerPlaybackGateResumeReason: isActiveGeneration
        ? String(resumeReason || "applied")
        : "",
      bodyTrackerPlaybackGateResumeRequested: false,
      bodyTrackerPlaybackGateWasPlaying: Boolean(
        isActiveGeneration && activeGate.wasPlaying,
      ),
      bodyTrackerBoundaryActive: Boolean(
        isActiveGeneration && activeGate.boundaryOwned,
      ),
      bodyTrackerBoundaryNominated: Boolean(
        isActiveGeneration && activeGate.boundaryNominated,
      ),
      bodyTrackerBoundaryGeneration:
        isActiveGeneration && activeGate.boundaryOwned ? inputGeneration : null,
      bodyTrackerBoundaryReason:
        isActiveGeneration && activeGate.boundaryOwned
          ? activeGate.boundaryReason
          : "",
      bodyTrackerBoundarySourcePtsSec:
        isActiveGeneration && activeGate.boundaryNominated
          ? activeGate.boundarySourcePtsSec
          : null,
    };
  }

  function releaseActive({
    inputGeneration = null,
    reason = "released",
    resume = true,
    applied = false,
  } = {}) {
    if (inputGeneration !== null) {
      assertInputGeneration(inputGeneration);
    }
    if (!activeGate || (
      inputGeneration !== null && activeGate.inputGeneration !== inputGeneration
    )) {
      return null;
    }

    const releasedGate = activeGate;
    activeGate = null;
    const durationMs = safeDurationMs(now, releasedGate.startedAt);
    // Exact video boundaries may resume only after their frame reached the
    // product's avatar state. Error/stale/manual releases fail closed; the app
    // either supersedes them atomically or stops the input.
    const shouldResume = Boolean(
      resume &&
      releasedGate.wasPlaying &&
      (!releasedGate.boundaryOwned || applied),
    );
    const resumeRequested = shouldResume
      ? requestMediaPlayback(releasedGate.media)
      : false;

    if (applied) {
      appliedGeneration = releasedGate.inputGeneration;
    }

    lastRelease = {
      bodyTrackerPlaybackGated: true,
      bodyTrackerPlaybackGateActive: false,
      bodyTrackerPlaybackGateGeneration: releasedGate.inputGeneration,
      bodyTrackerPlaybackGateDurationMs: durationMs,
      bodyTrackerPlaybackGateResumeReason: String(reason || "released"),
      bodyTrackerPlaybackGateResumeRequested: resumeRequested,
      bodyTrackerPlaybackGateWasPlaying: releasedGate.wasPlaying,
      bodyTrackerAppliedGeneration: appliedGeneration,
      bodyTrackerBoundaryActive: false,
      bodyTrackerBoundaryNominated: releasedGate.boundaryNominated,
      bodyTrackerBoundaryGeneration: releasedGate.boundaryOwned
        ? releasedGate.inputGeneration
        : null,
      bodyTrackerBoundaryReason: releasedGate.boundaryReason,
      bodyTrackerBoundarySourcePtsSec: releasedGate.boundarySourcePtsSec,
    };
    return { ...lastRelease };
  }

  function begin({ inputGeneration, media, resumeAfterApply = false } = {}) {
    assertInputGeneration(inputGeneration);

    if (activeGate?.inputGeneration === inputGeneration) {
      return buildFrameMeta(inputGeneration);
    }
    if (activeGate && inputGeneration < activeGate.inputGeneration) {
      throw new RangeError(
        `inputGeneration ${inputGeneration} is older than active generation ${activeGate.inputGeneration}`,
      );
    }
    if (inputGeneration === appliedGeneration) {
      return buildFrameMeta(inputGeneration);
    }
    if (appliedGeneration !== null && inputGeneration < appliedGeneration) {
      throw new RangeError(
        `inputGeneration ${inputGeneration} is older than applied generation ${appliedGeneration}`,
      );
    }

    // This path is defensive: app generation advancement normally releases
    // the old gate first. If a caller begins a newer generation directly,
    // inherit its playback intent without briefly resuming between gates.
    let inheritedWasPlaying = false;
    if (activeGate) {
      inheritedWasPlaying = activeGate.wasPlaying;
      releaseActive({
        inputGeneration: activeGate.inputGeneration,
        reason: "superseded-generation",
        resume: false,
      });
    }

    const wasPlaying = Boolean(
      inheritedWasPlaying || resumeAfterApply || (media && media.paused === false),
    );
    const startedAt = Number(now());
    if (typeof media?.pause === "function") {
      media.pause();
    }
    activeGate = {
      inputGeneration,
      media,
      startedAt: Number.isFinite(startedAt) ? startedAt : 0,
      wasPlaying,
      boundaryOwned: false,
      boundaryNominated: false,
      boundaryReason: "",
      boundarySourcePtsSec: null,
    };
    return buildFrameMeta(inputGeneration);
  }

  function reserveBoundary({
    inputGeneration,
    media,
    boundaryReason,
    resumeAfterApply = false,
  } = {}) {
    begin({ inputGeneration, media, resumeAfterApply });
    if (activeGate?.inputGeneration !== inputGeneration) {
      return buildFrameMeta(inputGeneration);
    }

    activeGate.boundaryOwned = true;
    activeGate.boundaryReason = String(boundaryReason ?? "").trim() || "boundary";
    return buildFrameMeta(inputGeneration);
  }

  function nominateBoundary({
    inputGeneration,
    media,
    boundaryReason,
    boundarySourcePtsSec,
    resumeAfterApply = false,
  } = {}) {
    assertInputGeneration(inputGeneration);
    if (
      activeGate?.inputGeneration === inputGeneration &&
      activeGate.boundaryNominated
    ) {
      return {
        ...buildFrameMeta(inputGeneration),
        bodyTrackerBoundaryAccepted: false,
      };
    }

    reserveBoundary({
      inputGeneration,
      media,
      boundaryReason,
      resumeAfterApply,
    });
    if (activeGate?.inputGeneration !== inputGeneration) {
      return {
        ...buildFrameMeta(inputGeneration),
        bodyTrackerBoundaryAccepted: false,
      };
    }

    const sourcePtsSec = Number(boundarySourcePtsSec);
    activeGate.boundaryNominated = true;
    activeGate.boundarySourcePtsSec =
      Number.isFinite(sourcePtsSec) && sourcePtsSec >= 0 ? sourcePtsSec : null;
    return {
      ...buildFrameMeta(inputGeneration),
      bodyTrackerBoundaryAccepted: true,
    };
  }

  function blocksOrdinaryFrame(inputGeneration) {
    assertInputGeneration(inputGeneration);
    return Boolean(
      activeGate?.inputGeneration === inputGeneration && activeGate.boundaryOwned,
    );
  }

  function requestResume(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (activeGate?.inputGeneration !== inputGeneration) {
      return false;
    }
    activeGate.wasPlaying = true;
    return true;
  }

  function completeApplied(inputGeneration) {
    assertInputGeneration(inputGeneration);
    return releaseActive({
      inputGeneration,
      reason: "applied",
      resume: true,
      applied: true,
    });
  }

  function release(inputGeneration, reason, { resume = true } = {}) {
    return releaseActive({
      inputGeneration,
      reason,
      resume,
      applied: false,
    });
  }

  function getStatus() {
    return {
      bodyTrackerAppliedGeneration: appliedGeneration,
      bodyTrackerPlaybackGateActive: Boolean(activeGate),
      bodyTrackerPlaybackGateGeneration: activeGate?.inputGeneration ??
        lastRelease?.bodyTrackerPlaybackGateGeneration ?? null,
      bodyTrackerPlaybackGateDurationMs: activeGate
        ? safeDurationMs(now, activeGate.startedAt)
        : lastRelease?.bodyTrackerPlaybackGateDurationMs ?? 0,
      bodyTrackerPlaybackGateResumeReason:
        activeGate ? "" : lastRelease?.bodyTrackerPlaybackGateResumeReason ?? "",
      bodyTrackerPlaybackGateResumeRequested:
        activeGate ? false : lastRelease?.bodyTrackerPlaybackGateResumeRequested ?? false,
      bodyTrackerPlaybackGateWasPlaying: activeGate?.wasPlaying ??
        lastRelease?.bodyTrackerPlaybackGateWasPlaying ?? false,
      bodyTrackerBoundaryActive: Boolean(activeGate?.boundaryOwned),
      bodyTrackerBoundaryNominated: activeGate
        ? activeGate.boundaryNominated
        : lastRelease?.bodyTrackerBoundaryNominated ?? false,
      bodyTrackerBoundaryGeneration: activeGate?.boundaryOwned
        ? activeGate.inputGeneration
        : lastRelease?.bodyTrackerBoundaryGeneration ?? null,
      bodyTrackerBoundaryReason: activeGate?.boundaryReason ??
        lastRelease?.bodyTrackerBoundaryReason ?? "",
      bodyTrackerBoundarySourcePtsSec: activeGate?.boundarySourcePtsSec ??
        lastRelease?.bodyTrackerBoundarySourcePtsSec ?? null,
    };
  }

  return {
    begin,
    reserveBoundary,
    nominateBoundary,
    blocksOrdinaryFrame,
    requestResume,
    buildFrameMeta,
    completeApplied,
    release,
    getStatus,
  };
}

/**
 * Owns one complete set of stateful MediaPipe VIDEO landmarkers. A generation
 * can observe either the old complete set or the new complete set, never a
 * partially recreated mix. Same-configuration generations keep the loaded
 * detector instances and run explicit temporal-state reset operations; a real
 * configuration change recreates, resets, and commits one complete candidate
 * set atomically.
 */
export function createAtomicVideoTrackerGenerationOwner({ now = defaultNow } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  let currentEntries = null;
  let currentConfigurationKey = "";
  let preparedGeneration = null;
  let latestRequestedGeneration = null;
  let prepareTail = Promise.resolve();
  let cumulativeResets = 0;
  let resetErrors = 0;
  let recreateErrors = 0;
  let closeErrors = 0;
  let detectorEpoch = 0;
  let lastGeneration = null;

  function getTelemetry() {
    return {
      bodyTrackerCumulativeResets: cumulativeResets,
      bodyTrackerResetErrors: resetErrors,
      bodyTrackerLastGeneration: lastGeneration,
      bodyTrackerDetectorEpoch: detectorEpoch,
      bodyTrackerRecreateErrors: recreateErrors,
      bodyTrackerCloseErrors: closeErrors,
    };
  }

  function fail(message, generation, details = {}) {
    recreateErrors += 1;
    throw createGenerationError(message, generation, getTelemetry(), details);
  }

  function createStaleGenerationError(inputGeneration) {
    const error = createGenerationError(
      `Stale VIDEO tracker generation ${inputGeneration} is older than ${latestRequestedGeneration}.`,
      inputGeneration,
      getTelemetry(),
    );
    error.code = "VIDEO_TRACKER_GENERATION_STALE";
    return error;
  }

  function normalizeDetectors(detectors, generation, { requireCreate = false } = {}) {
    if (!Array.isArray(detectors) || detectors.length === 0) {
      fail("At least one VIDEO tracker detector is required.", generation);
    }

    const seen = new Set();
    return detectors.map((entry, index) => {
      const id = String(entry?.id ?? "").trim();
      const detector = entry?.detector;
      const create = entry?.create;

      if (!id) {
        fail(`VIDEO tracker detector ${index} requires a stable id.`, generation);
      }
      if (requireCreate) {
        if (typeof create !== "function") {
          fail(`VIDEO tracker detector ${id} requires a create() factory.`, generation);
        }
      } else if (!isDetectorReference(detector)) {
        fail(`VIDEO tracker detector ${id} requires an instance.`, generation);
      }
      const uniquenessKey = requireCreate ? id : detector;
      if (seen.has(uniquenessKey)) {
        fail(`VIDEO tracker detector ${id} was provided more than once.`, generation);
      }

      seen.add(uniquenessKey);
      return requireCreate ? { id, create } : { id, detector };
    });
  }

  function normalizeStateResets(detectorStateResets, generation) {
    if (detectorStateResets === undefined || detectorStateResets === null) {
      return [];
    }
    if (!Array.isArray(detectorStateResets) || detectorStateResets.length === 0) {
      fail("VIDEO tracker detectorStateResets must contain at least one reset operation.", generation);
    }

    const seen = new Set();
    return detectorStateResets.map((entry, index) => {
      const id = String(entry?.id ?? "").trim();
      const reset = entry?.reset;
      if (!id) {
        fail(`VIDEO tracker state reset ${index} requires a stable id.`, generation);
      }
      if (seen.has(id)) {
        fail(`VIDEO tracker state reset ${id} was provided more than once.`, generation);
      }
      if (typeof reset !== "function") {
        fail(`VIDEO tracker state reset ${id} requires a reset() operation.`, generation);
      }
      seen.add(id);
      return { id, reset };
    });
  }

  function closeEntries(entries) {
    const closed = new Set();
    for (const { detector } of entries ?? []) {
      if (!isDetectorReference(detector) || closed.has(detector)) {
        continue;
      }
      closed.add(detector);
      try {
        detector.close?.();
      } catch {
        closeErrors += 1;
      }
    }
  }

  function buildReport({
    generation,
    resetDetectors = [],
    recreateDetectors = [],
    seededDetectors = [],
    startedAt,
    strategy,
  }) {
    const durationMs = safeDurationMs(now, startedAt);
    return {
      bodyTrackerGeneration: generation,
      bodyTrackerResetStrategy: strategy,
      bodyTrackerResetCount: resetDetectors.length,
      bodyTrackerResetDetectors: detectorIdsToWireValue(resetDetectors),
      bodyTrackerResetDurationMs: resetDetectors.length > 0 ? durationMs : 0,
      bodyTrackerSeededDetectors: detectorIdsToWireValue(seededDetectors),
      bodyTrackerRecreateCount: recreateDetectors.length,
      bodyTrackerRecreateDetectors: detectorIdsToWireValue(recreateDetectors),
      bodyTrackerRecreateDurationMs: recreateDetectors.length > 0 ? durationMs : 0,
      ...getTelemetry(),
    };
  }

  async function resetEntryState(
    entries,
    normalizedStateResets,
    inputGeneration,
    startedAt,
  ) {
    const entriesById = new Map(
      entries.map(({ id, detector }) => [id, detector]),
    );
    for (const { id } of normalizedStateResets) {
      if (!entriesById.has(id)) {
        resetErrors += 1;
        throw createGenerationError(
          `VIDEO tracker state reset ${id} does not match an installed detector.`,
          inputGeneration,
          getTelemetry(),
          {
            resetDetectors: normalizedStateResets.map((entry) => entry.id),
            resetDurationMs: safeDurationMs(now, startedAt),
          },
        );
      }
    }

    try {
      for (const { id, reset } of normalizedStateResets) {
        await reset(entriesById.get(id));
      }
    } catch (cause) {
      resetErrors += 1;
      const resetIds = normalizedStateResets.map(({ id }) => id);
      const error = createGenerationError(
        `Failed to reset VIDEO tracker state for generation ${inputGeneration}: ${cause?.message ?? String(cause)}`,
        inputGeneration,
        getTelemetry(),
        {
          resetDetectors: resetIds,
          resetDurationMs: safeDurationMs(now, startedAt),
        },
      );
      error.cause = cause;
      throw error;
    }
    return normalizedStateResets.map(({ id }) => id);
  }

  function installInitial({ detectors, configurationKey = "" } = {}) {
    const normalizedDetectors = normalizeDetectors(detectors, null);
    const previousEntries = currentEntries;
    currentEntries = normalizedDetectors;
    currentConfigurationKey = normalizeConfigurationKey(configurationKey);
    preparedGeneration = null;
    latestRequestedGeneration = null;
    lastGeneration = null;
    detectorEpoch += 1;
    closeEntries(previousEntries);
    return getTelemetry();
  }

  async function prepareNow({
    inputGeneration,
    detectorFactories,
    detectorStateResets,
    configurationKey = "",
  } = {}) {
    if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
      fail("VIDEO tracker inputGeneration must be a non-negative safe integer.", inputGeneration);
    }
    if (!currentEntries) {
      fail("An initial VIDEO tracker detector set must be installed first.", inputGeneration);
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      throw createStaleGenerationError(inputGeneration);
    }

    const requestedConfigurationKey = normalizeConfigurationKey(configurationKey);
    const startedAt = now();
    if (
      preparedGeneration === inputGeneration &&
      currentConfigurationKey === requestedConfigurationKey
    ) {
      return buildReport({
        generation: inputGeneration,
        startedAt,
        strategy: "reuse",
      });
    }

    if (
      preparedGeneration === null &&
      currentConfigurationKey === requestedConfigurationKey &&
      (detectorStateResets === undefined || detectorStateResets === null)
    ) {
      preparedGeneration = inputGeneration;
      lastGeneration = inputGeneration;
      return buildReport({
        generation: inputGeneration,
        seededDetectors: currentEntries.map(({ id }) => id),
        startedAt,
        strategy: "fresh-bind",
      });
    }

    const normalizedStateResets = normalizeStateResets(
      detectorStateResets,
      inputGeneration,
    );
    if (
      currentConfigurationKey === requestedConfigurationKey &&
      normalizedStateResets.length > 0
    ) {
      const resetIds = await resetEntryState(
        currentEntries,
        normalizedStateResets,
        inputGeneration,
        startedAt,
      );
      cumulativeResets += resetIds.length;
      detectorEpoch += 1;
      if (inputGeneration !== latestRequestedGeneration) {
        const error = createGenerationError(
          `VIDEO tracker generation ${inputGeneration} was superseded by ${latestRequestedGeneration} after its state reset.`,
          inputGeneration,
          getTelemetry(),
          {
            resetDetectors: resetIds,
            resetDurationMs: safeDurationMs(now, startedAt),
          },
        );
        error.code = "VIDEO_TRACKER_GENERATION_SUPERSEDED";
        throw error;
      }

      preparedGeneration = inputGeneration;
      lastGeneration = inputGeneration;
      return buildReport({
        generation: inputGeneration,
        resetDetectors: resetIds,
        startedAt,
        strategy: "temporal-state-reset",
      });
    }

    const normalizedFactories = normalizeDetectors(
      detectorFactories,
      inputGeneration,
      { requireCreate: true },
    );
    const results = await Promise.allSettled(
      normalizedFactories.map(({ create }) => Promise.resolve().then(create)),
    );
    const candidates = [];
    const failures = [];
    results.forEach((result, index) => {
      const { id } = normalizedFactories[index];
      if (result.status === "fulfilled" && isDetectorReference(result.value)) {
        candidates.push({ id, detector: result.value });
      } else {
        failures.push({
          id,
          cause: result.status === "rejected"
            ? result.reason
            : new Error("factory returned an invalid detector"),
        });
      }
    });

    if (failures.length > 0) {
      closeEntries(candidates);
      recreateErrors += failures.length;
      const failureSummary = failures
        .map(({ id, cause }) => `${id}: ${cause?.message ?? String(cause)}`)
        .join("; ");
      const error = createGenerationError(
        `Failed to recreate VIDEO trackers for generation ${inputGeneration}: ${failureSummary}`,
        inputGeneration,
        getTelemetry(),
        { resetDurationMs: Math.max(0, now() - startedAt) },
      );
      error.cause = failures[0].cause;
      throw error;
    }

    let resetIds = [];
    if (normalizedStateResets.length > 0) {
      try {
        resetIds = await resetEntryState(
          candidates,
          normalizedStateResets,
          inputGeneration,
          startedAt,
        );
      } catch (error) {
        closeEntries(candidates);
        throw error;
      }
    }

    if (inputGeneration !== latestRequestedGeneration) {
      closeEntries(candidates);
      const error = createGenerationError(
        `VIDEO tracker generation ${inputGeneration} was superseded by ${latestRequestedGeneration}.`,
        inputGeneration,
        getTelemetry(),
        {
          resetDetectors: resetIds,
          resetDurationMs: safeDurationMs(now, startedAt),
        },
      );
      error.code = "VIDEO_TRACKER_GENERATION_SUPERSEDED";
      throw error;
    }

    const oldEntries = currentEntries;
    currentEntries = candidates;
    currentConfigurationKey = requestedConfigurationKey;
    preparedGeneration = inputGeneration;
    lastGeneration = inputGeneration;
    detectorEpoch += 1;
    const recreatedIds = candidates.map(({ id }) => id);
    cumulativeResets += recreatedIds.length + resetIds.length;
    closeEntries(oldEntries);
    return buildReport({
      generation: inputGeneration,
      resetDetectors: resetIds,
      recreateDetectors: recreatedIds,
      startedAt,
      strategy: "detector-recreate",
    });
  }

  function reserve(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return false;
    }
    latestRequestedGeneration = inputGeneration;
    return true;
  }

  function prepare(options) {
    const inputGeneration = options?.inputGeneration;
    if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
      return Promise.reject(createGenerationError(
        "VIDEO tracker inputGeneration must be a non-negative safe integer.",
        inputGeneration,
        getTelemetry(),
      ));
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return Promise.reject(createStaleGenerationError(inputGeneration));
    }
    reserve(inputGeneration);
    const operation = prepareTail.then(() => prepareNow(options));
    prepareTail = operation.catch(() => undefined);
    return operation;
  }

  function getPreparedSet(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (!currentEntries || preparedGeneration !== inputGeneration) {
      throw createGenerationError(
        `VIDEO tracker detector set is not prepared for generation ${inputGeneration}.`,
        inputGeneration,
        getTelemetry(),
      );
    }
    return Object.fromEntries(
      currentEntries.map(({ id, detector }) => [id, detector]),
    );
  }

  function dispose() {
    const entries = currentEntries;
    currentEntries = null;
    preparedGeneration = null;
    latestRequestedGeneration = null;
    lastGeneration = null;
    closeEntries(entries);
  }

  return {
    installInitial,
    reserve,
    prepare,
    getPreparedSet,
    getTelemetry,
    dispose,
  };
}

/**
 * Owns exactly two already-created, already-prewarmed VIDEO detector sets for
 * the worker runtime. A slot becomes dirty as soon as a product generation is
 * bound to it. The next generation can therefore swap to the other clean slot
 * without touching detector options; once both slots are dirty, the inactive
 * slot is synchronously reset before it can be leased again.
 *
 * This is intentionally a separate owner from
 * createAtomicVideoTrackerGenerationOwner so the main-thread fallback keeps
 * its existing single-instance lifecycle.
 */
export function createPrewarmedVideoTrackerGenerationOwner({ now = defaultNow } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  const requiredPoolSize = 2;
  const fallbackResetStrategy = "synchronous-dirty-standby-reset";
  let slots = null;
  let currentConfigurationKey = "";
  let currentSlotIndex = null;
  let preparedGeneration = null;
  let latestRequestedGeneration = null;
  let prepareTail = Promise.resolve();
  let cumulativeResets = 0;
  let resetErrors = 0;
  let recreateErrors = 0;
  let closeErrors = 0;
  let detectorEpoch = 0;
  let lastGeneration = null;
  let prewarmedSwapCount = 0;
  let dirtyLeaseCount = 0;
  let fallbackResetCount = 0;
  let installedPrewarmedCount = 0;
  let installedPrimeDurationsMs = [];
  const closedDetectors = new Set();

  function getTelemetry() {
    return {
      bodyTrackerCumulativeResets: cumulativeResets,
      bodyTrackerResetErrors: resetErrors,
      bodyTrackerLastGeneration: lastGeneration,
      bodyTrackerDetectorEpoch: detectorEpoch,
      bodyTrackerRecreateErrors: recreateErrors,
      bodyTrackerCloseErrors: closeErrors,
      bodyTrackerPoolSize: slots?.length ?? 0,
      bodyTrackerPoolCleanCount: slots?.filter((slot) => slot.clean).length ?? 0,
      bodyTrackerPoolPrewarmedCount: installedPrewarmedCount,
      bodyTrackerPoolPrimeDurationMs: installedPrimeDurationsMs.reduce(
        (total, durationMs) => total + durationMs,
        0,
      ),
      bodyTrackerPoolPrimeSlot0DurationMs: installedPrimeDurationsMs[0] ?? 0,
      bodyTrackerPoolPrimeSlot1DurationMs: installedPrimeDurationsMs[1] ?? 0,
      bodyTrackerPrewarmedSwapCount: prewarmedSwapCount,
      bodyTrackerDirtyLeaseCount: dirtyLeaseCount,
      bodyTrackerFallbackResetCount: fallbackResetCount,
      bodyTrackerPoolStrategy: "two-slot-prewarmed-video",
      bodyTrackerFallbackResetStrategy: fallbackResetStrategy,
    };
  }

  function fail(message, generation, details = {}) {
    recreateErrors += 1;
    throw createGenerationError(message, generation, getTelemetry(), details);
  }

  function createStaleGenerationError(inputGeneration) {
    const error = createGenerationError(
      `Stale prewarmed VIDEO tracker generation ${inputGeneration} is older than ${latestRequestedGeneration}.`,
      inputGeneration,
      getTelemetry(),
    );
    error.code = "VIDEO_TRACKER_GENERATION_STALE";
    return error;
  }

  function normalizePool(candidateSlots) {
    if (!Array.isArray(candidateSlots) || candidateSlots.length !== requiredPoolSize) {
      fail(`Prewarmed VIDEO tracker pool requires exactly ${requiredPoolSize} slots.`, null);
    }

    const seenSlotIds = new Set();
    const seenDetectors = new Set();
    let expectedDetectorIds = null;
    let expectedDelegate = null;
    return candidateSlots.map((candidate, slotIndex) => {
      const slotId = String(candidate?.slotId ?? `slot-${slotIndex}`).trim();
      const delegate = String(candidate?.delegate ?? "").trim().toUpperCase();
      if (!slotId || seenSlotIds.has(slotId)) {
        fail(`Prewarmed VIDEO tracker slot ${slotIndex} requires a unique id.`, null);
      }
      if (!delegate) {
        fail(`Prewarmed VIDEO tracker slot ${slotId} requires its resolved delegate.`, null);
      }
      if (candidate?.prewarmed !== true) {
        fail(`Prewarmed VIDEO tracker slot ${slotId} was not prewarmed.`, null);
      }
      const primeDurationMs = Number(candidate?.primeDurationMs);
      if (!Number.isFinite(primeDurationMs) || primeDurationMs < 0) {
        fail(`Prewarmed VIDEO tracker slot ${slotId} requires its prime duration.`, null);
      }
      if (expectedDelegate !== null && delegate !== expectedDelegate) {
        fail(
          `Prewarmed VIDEO tracker slot ${slotId} delegate ${delegate} does not match ${expectedDelegate}.`,
          null,
        );
      }

      const detectors = candidate?.detectors;
      if (!Array.isArray(detectors) || detectors.length === 0) {
        fail(`Prewarmed VIDEO tracker slot ${slotId} requires detector entries.`, null);
      }
      const seenIds = new Set();
      const entries = detectors.map((entry, detectorIndex) => {
        const id = String(entry?.id ?? "").trim();
        const detector = entry?.detector;
        if (!id || seenIds.has(id)) {
          fail(
            `Prewarmed VIDEO tracker slot ${slotId} detector ${detectorIndex} requires a unique id.`,
            null,
          );
        }
        if (!isDetectorReference(detector) || seenDetectors.has(detector)) {
          fail(
            `Prewarmed VIDEO tracker slot ${slotId} detector ${id} requires a unique instance.`,
            null,
          );
        }
        seenIds.add(id);
        seenDetectors.add(detector);
        return { id, detector };
      });
      const detectorIds = entries.map(({ id }) => id).sort();
      if (
        expectedDetectorIds !== null &&
        detectorIds.join("\u0000") !== expectedDetectorIds.join("\u0000")
      ) {
        fail(`Prewarmed VIDEO tracker slot ${slotId} detector ids do not match the pool.`, null);
      }

      seenSlotIds.add(slotId);
      expectedDelegate ??= delegate;
      expectedDetectorIds ??= detectorIds;
      return {
        slotId,
        delegate,
        entries,
        clean: true,
        primeDurationMs,
      };
    });
  }

  function normalizeStateResets(detectorStateResets, generation) {
    if (!Array.isArray(detectorStateResets) || detectorStateResets.length === 0) {
      fail(
        "Prewarmed VIDEO tracker fallback requires detectorStateResets.",
        generation,
      );
    }

    const seen = new Set();
    return detectorStateResets.map((entry, index) => {
      const id = String(entry?.id ?? "").trim();
      const reset = entry?.reset;
      if (!id || seen.has(id)) {
        fail(`Prewarmed VIDEO tracker state reset ${index} requires a unique id.`, generation);
      }
      if (typeof reset !== "function") {
        fail(`Prewarmed VIDEO tracker state reset ${id} requires reset().`, generation);
      }
      seen.add(id);
      return { id, reset };
    });
  }

  function detectorSetFromSlots(candidateSlots) {
    return new Set(
      (candidateSlots ?? []).flatMap((slot) => slot.entries.map(({ detector }) => detector)),
    );
  }

  function closeSlots(candidateSlots, protectedDetectors = new Set()) {
    for (const slot of candidateSlots ?? []) {
      for (const { detector } of slot.entries ?? []) {
        if (
          !isDetectorReference(detector) ||
          protectedDetectors.has(detector) ||
          closedDetectors.has(detector)
        ) {
          continue;
        }
        closedDetectors.add(detector);
        try {
          detector.close?.();
        } catch {
          closeErrors += 1;
        }
      }
    }
  }

  function installPrewarmedPool({ poolSlots, configurationKey = "" } = {}) {
    const nextSlots = normalizePool(poolSlots);
    const previousSlots = slots;
    slots = nextSlots;
    currentConfigurationKey = normalizeConfigurationKey(configurationKey);
    currentSlotIndex = null;
    preparedGeneration = null;
    latestRequestedGeneration = null;
    lastGeneration = null;
    prewarmedSwapCount = 0;
    dirtyLeaseCount = 0;
    fallbackResetCount = 0;
    installedPrewarmedCount = nextSlots.length;
    installedPrimeDurationsMs = nextSlots.map(({ primeDurationMs }) => primeDurationMs);
    detectorEpoch += 1;
    closeSlots(previousSlots, detectorSetFromSlots(nextSlots));
    return getTelemetry();
  }

  async function resetSlot(slot, detectorStateResets, inputGeneration, startedAt) {
    const normalizedResets = normalizeStateResets(detectorStateResets, inputGeneration);
    const entriesById = new Map(
      slot.entries.map(({ id, detector }) => [id, detector]),
    );
    for (const { id } of normalizedResets) {
      if (!entriesById.has(id)) {
        resetErrors += 1;
        throw createGenerationError(
          `Prewarmed VIDEO tracker reset ${id} does not match slot ${slot.slotId}.`,
          inputGeneration,
          getTelemetry(),
          {
            resetDetectors: normalizedResets.map((entry) => entry.id),
            resetDurationMs: safeDurationMs(now, startedAt),
          },
        );
      }
    }

    try {
      for (const { id, reset } of normalizedResets) {
        await reset(entriesById.get(id));
      }
    } catch (cause) {
      resetErrors += 1;
      const resetIds = normalizedResets.map(({ id }) => id);
      const error = createGenerationError(
        `Failed to reset prewarmed VIDEO tracker slot ${slot.slotId}: ${cause?.message ?? String(cause)}`,
        inputGeneration,
        getTelemetry(),
        {
          resetDetectors: resetIds,
          resetDurationMs: safeDurationMs(now, startedAt),
        },
      );
      error.cause = cause;
      throw error;
    }

    return normalizedResets.map(({ id }) => id);
  }

  function buildReport({ generation, resetDetectors = [], seededDetectors = [], startedAt, strategy }) {
    const durationMs = safeDurationMs(now, startedAt);
    return {
      bodyTrackerGeneration: generation,
      bodyTrackerResetStrategy: strategy,
      bodyTrackerResetCount: resetDetectors.length,
      bodyTrackerResetDetectors: detectorIdsToWireValue(resetDetectors),
      bodyTrackerResetDurationMs: resetDetectors.length > 0 ? durationMs : 0,
      bodyTrackerSeededDetectors: detectorIdsToWireValue(seededDetectors),
      bodyTrackerRecreateCount: 0,
      bodyTrackerRecreateDetectors: "",
      bodyTrackerRecreateDurationMs: 0,
      ...getTelemetry(),
    };
  }

  async function prepareNow({
    inputGeneration,
    detectorStateResets,
    configurationKey = "",
  } = {}) {
    if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
      fail(
        "Prewarmed VIDEO tracker inputGeneration must be a non-negative safe integer.",
        inputGeneration,
      );
    }
    if (!slots) {
      fail("A prewarmed VIDEO tracker pool must be installed first.", inputGeneration);
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      throw createStaleGenerationError(inputGeneration);
    }

    const requestedConfigurationKey = normalizeConfigurationKey(configurationKey);
    if (requestedConfigurationKey !== currentConfigurationKey) {
      fail(
        "Prewarmed VIDEO tracker generation configuration does not match its installed pool.",
        inputGeneration,
      );
    }

    const startedAt = now();
    if (preparedGeneration === inputGeneration && currentSlotIndex !== null) {
      return buildReport({
        generation: inputGeneration,
        startedAt,
        strategy: "reuse",
      });
    }

    let slotIndex = slots.findIndex((slot, index) => (
      slot.clean && index !== currentSlotIndex
    ));
    let resetIds = [];
    let strategy = currentSlotIndex === null
      ? "prewarmed-clean-bind"
      : "prewarmed-clean-swap";

    if (slotIndex < 0) {
      slotIndex = currentSlotIndex === null
        ? 0
        : (currentSlotIndex + 1) % slots.length;
      const fallbackSlot = slots[slotIndex];
      resetIds = await resetSlot(
        fallbackSlot,
        detectorStateResets,
        inputGeneration,
        startedAt,
      );
      fallbackSlot.clean = true;
      cumulativeResets += resetIds.length;
      fallbackResetCount += 1;
      strategy = fallbackResetStrategy;
    }

    if (inputGeneration !== latestRequestedGeneration) {
      const error = createGenerationError(
        `Prewarmed VIDEO tracker generation ${inputGeneration} was superseded by ${latestRequestedGeneration}.`,
        inputGeneration,
        getTelemetry(),
        {
          resetDetectors: resetIds,
          resetDurationMs: safeDurationMs(now, startedAt),
        },
      );
      error.code = "VIDEO_TRACKER_GENERATION_SUPERSEDED";
      throw error;
    }

    const nextSlot = slots[slotIndex];
    if (!nextSlot.clean) {
      // This count measures actual dirty leases. Throwing before mutation keeps
      // it at zero for every valid execution.
      throw createGenerationError(
        `Prewarmed VIDEO tracker refused dirty slot ${nextSlot.slotId}.`,
        inputGeneration,
        getTelemetry(),
      );
    }

    if (currentSlotIndex !== null && resetIds.length === 0) {
      prewarmedSwapCount += 1;
    }
    currentSlotIndex = slotIndex;
    nextSlot.clean = false;
    preparedGeneration = inputGeneration;
    lastGeneration = inputGeneration;
    detectorEpoch += 1;
    return buildReport({
      generation: inputGeneration,
      resetDetectors: resetIds,
      seededDetectors: resetIds.length === 0
        ? nextSlot.entries.map(({ id }) => id)
        : [],
      startedAt,
      strategy,
    });
  }

  function reserve(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return false;
    }
    latestRequestedGeneration = inputGeneration;
    return true;
  }

  function prepare(options) {
    const inputGeneration = options?.inputGeneration;
    if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
      return Promise.reject(createGenerationError(
        "Prewarmed VIDEO tracker inputGeneration must be a non-negative safe integer.",
        inputGeneration,
        getTelemetry(),
      ));
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return Promise.reject(createStaleGenerationError(inputGeneration));
    }
    reserve(inputGeneration);
    const operation = prepareTail.then(() => prepareNow(options));
    prepareTail = operation.catch(() => undefined);
    return operation;
  }

  function getPreparedSet(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (
      !slots ||
      currentSlotIndex === null ||
      preparedGeneration !== inputGeneration
    ) {
      throw createGenerationError(
        `Prewarmed VIDEO tracker detector set is not prepared for generation ${inputGeneration}.`,
        inputGeneration,
        getTelemetry(),
      );
    }
    return Object.fromEntries(
      slots[currentSlotIndex].entries.map(({ id, detector }) => [id, detector]),
    );
  }

  function dispose() {
    const previousSlots = slots;
    slots = null;
    currentSlotIndex = null;
    preparedGeneration = null;
    latestRequestedGeneration = null;
    lastGeneration = null;
    installedPrewarmedCount = 0;
    installedPrimeDurationsMs = [];
    closeSlots(previousSlots);
  }

  return {
    installPrewarmedPool,
    reserve,
    prepare,
    getPreparedSet,
    getTelemetry,
    dispose,
  };
}

/**
 * Owns stateless MediaPipe IMAGE detectors across input generations. Detector
 * instances are replaced atomically only when their real configuration
 * changes; an input-generation change merely rebinds the already-installed
 * set. This keeps generation fencing independent from expensive graph setup.
 */
export function createStatelessImageTrackerGenerationOwner({ now = defaultNow } = {}) {
  if (typeof now !== "function") {
    throw new TypeError("now must be a function");
  }

  let currentEntries = null;
  let currentConfigurationKey = "";
  let preparedGeneration = null;
  let latestRequestedGeneration = null;
  let prepareTail = Promise.resolve();
  let configurationTail = Promise.resolve();
  let latestConfigurationRequest = 0;
  let cumulativeResets = 0;
  let recreateErrors = 0;
  let closeErrors = 0;
  let detectorEpoch = 0;
  let lastGeneration = null;
  let disposed = false;

  function getTelemetry() {
    return {
      bodyTrackerCumulativeResets: cumulativeResets,
      bodyTrackerResetErrors: recreateErrors,
      bodyTrackerLastGeneration: lastGeneration,
      bodyTrackerDetectorEpoch: detectorEpoch,
      bodyTrackerRecreateErrors: recreateErrors,
      bodyTrackerCloseErrors: closeErrors,
    };
  }

  function createStaleGenerationError(inputGeneration) {
    const error = createGenerationError(
      `Stale stateless IMAGE tracker generation ${inputGeneration} is older than ${latestRequestedGeneration}.`,
      inputGeneration,
      getTelemetry(),
    );
    // Keep the established code stable for app-side transition classification.
    error.code = "VIDEO_TRACKER_GENERATION_STALE";
    return error;
  }

  function createDisposedError(generation = null) {
    const error = createGenerationError(
      "Stateless IMAGE tracker generation owner is disposed.",
      generation,
      getTelemetry(),
    );
    error.code = "VIDEO_TRACKER_GENERATION_DISPOSED";
    return error;
  }

  function normalizeFactories(detectorFactories, generation = null) {
    if (!Array.isArray(detectorFactories) || detectorFactories.length === 0) {
      throw createGenerationError(
        "At least one stateless IMAGE tracker detector factory is required.",
        generation,
        getTelemetry(),
      );
    }

    const seenIds = new Set();
    return detectorFactories.map((entry, index) => {
      const id = String(entry?.id ?? "").trim();
      const create = entry?.create;
      if (!id) {
        throw createGenerationError(
          `Stateless IMAGE tracker detector ${index} requires a stable id.`,
          generation,
          getTelemetry(),
        );
      }
      if (seenIds.has(id)) {
        throw createGenerationError(
          `Stateless IMAGE tracker detector ${id} was provided more than once.`,
          generation,
          getTelemetry(),
        );
      }
      if (typeof create !== "function") {
        throw createGenerationError(
          `Stateless IMAGE tracker detector ${id} requires a create() factory.`,
          generation,
          getTelemetry(),
        );
      }
      seenIds.add(id);
      return { id, create };
    });
  }

  function closeEntries(entries) {
    const closed = new Set();
    for (const { detector } of entries ?? []) {
      if (!isDetectorReference(detector) || closed.has(detector)) {
        continue;
      }
      closed.add(detector);
      try {
        detector.close?.();
      } catch {
        closeErrors += 1;
      }
    }
  }

  function buildReport({
    generation = null,
    resetDetectors = [],
    seededDetectors = [],
    startedAt,
    strategy,
  }) {
    const durationMs = safeDurationMs(now, startedAt);
    return {
      bodyTrackerGeneration: generation,
      bodyTrackerResetStrategy: strategy,
      bodyTrackerResetCount: resetDetectors.length,
      bodyTrackerResetDetectors: detectorIdsToWireValue(resetDetectors),
      bodyTrackerResetDurationMs: durationMs,
      bodyTrackerSeededDetectors: detectorIdsToWireValue(seededDetectors),
      bodyTrackerRecreateCount: resetDetectors.length,
      bodyTrackerRecreateDetectors: detectorIdsToWireValue(resetDetectors),
      bodyTrackerRecreateDurationMs: durationMs,
      ...getTelemetry(),
    };
  }

  async function installConfigurationNow({
    configurationKey = "",
    detectorFactories,
    requestId,
  } = {}) {
    if (disposed) {
      throw createDisposedError();
    }

    const requestedConfigurationKey = normalizeConfigurationKey(configurationKey);
    const startedAt = Number(now());
    if (currentEntries && requestedConfigurationKey === currentConfigurationKey) {
      return buildReport({
        resetDetectors: [],
        seededDetectors: currentEntries.map(({ id }) => id),
        startedAt,
        strategy: "configuration-reuse",
      });
    }

    const normalizedFactories = normalizeFactories(detectorFactories);
    const results = await Promise.allSettled(
      normalizedFactories.map(({ create }) => Promise.resolve().then(create)),
    );
    const candidates = [];
    const failures = [];
    results.forEach((result, index) => {
      const { id } = normalizedFactories[index];
      if (result.status === "fulfilled" && isDetectorReference(result.value)) {
        candidates.push({ id, detector: result.value });
        return;
      }
      failures.push({
        id,
        cause: result.status === "rejected"
          ? result.reason
          : new Error("factory returned an invalid detector"),
      });
    });

    if (failures.length > 0) {
      closeEntries(candidates);
      recreateErrors += failures.length;
      const summary = failures
        .map(({ id, cause }) => `${id}: ${cause?.message ?? String(cause)}`)
        .join("; ");
      const error = createGenerationError(
        `Failed to install stateless IMAGE tracker configuration: ${summary}`,
        null,
        getTelemetry(),
        { resetDurationMs: safeDurationMs(now, startedAt) },
      );
      error.cause = failures[0].cause;
      throw error;
    }

    if (disposed || requestId !== latestConfigurationRequest) {
      closeEntries(candidates);
      if (disposed) {
        throw createDisposedError();
      }
      const error = createGenerationError(
        "Stateless IMAGE tracker configuration install was superseded.",
        null,
        getTelemetry(),
        { resetDurationMs: safeDurationMs(now, startedAt) },
      );
      error.code = "VIDEO_TRACKER_GENERATION_SUPERSEDED";
      throw error;
    }

    const previousEntries = currentEntries;
    currentEntries = candidates;
    currentConfigurationKey = requestedConfigurationKey;
    preparedGeneration = null;
    detectorEpoch += 1;
    const installedIds = candidates.map(({ id }) => id);
    if (previousEntries) {
      cumulativeResets += installedIds.length;
    }
    closeEntries(previousEntries);
    return buildReport({
      resetDetectors: previousEntries ? installedIds : [],
      seededDetectors: previousEntries ? [] : installedIds,
      startedAt,
      strategy: previousEntries ? "configuration-replace" : "configuration-install",
    });
  }

  function installConfiguration(options = {}) {
    if (disposed) {
      return Promise.reject(createDisposedError());
    }
    const requestId = ++latestConfigurationRequest;
    const operation = configurationTail.then(() => installConfigurationNow({
      ...options,
      requestId,
    }));
    configurationTail = operation.catch(() => undefined);
    return operation;
  }

  function reserve(inputGeneration) {
    assertInputGeneration(inputGeneration);
    if (disposed) {
      throw createDisposedError(inputGeneration);
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return false;
    }
    latestRequestedGeneration = inputGeneration;
    return true;
  }

  function prepareNow({ inputGeneration, configurationKey = "" } = {}) {
    if (disposed) {
      throw createDisposedError(inputGeneration);
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      throw createStaleGenerationError(inputGeneration);
    }
    if (!currentEntries) {
      throw createGenerationError(
        "A stateless IMAGE tracker configuration must be installed first.",
        inputGeneration,
        getTelemetry(),
      );
    }

    const requestedConfigurationKey = normalizeConfigurationKey(configurationKey);
    if (requestedConfigurationKey !== currentConfigurationKey) {
      throw createGenerationError(
        "Stateless IMAGE tracker generation configuration does not match the installed detector set.",
        inputGeneration,
        getTelemetry(),
      );
    }

    const startedAt = Number(now());
    const repeated = preparedGeneration === inputGeneration;
    const hadPreparedGeneration = lastGeneration !== null;
    preparedGeneration = inputGeneration;
    lastGeneration = inputGeneration;
    return buildReport({
      generation: inputGeneration,
      resetDetectors: [],
      seededDetectors: repeated ? [] : currentEntries.map(({ id }) => id),
      startedAt,
      strategy: repeated
        ? "reuse"
        : !hadPreparedGeneration
          ? "fresh-bind"
          : "stateless-rebind",
    });
  }

  function prepare(options = {}) {
    const inputGeneration = options?.inputGeneration;
    if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
      return Promise.reject(createGenerationError(
        "Stateless IMAGE tracker inputGeneration must be a non-negative safe integer.",
        inputGeneration,
        getTelemetry(),
      ));
    }
    if (
      latestRequestedGeneration !== null &&
      inputGeneration < latestRequestedGeneration
    ) {
      return Promise.reject(createStaleGenerationError(inputGeneration));
    }
    try {
      reserve(inputGeneration);
    } catch (error) {
      return Promise.reject(error);
    }
    const operation = prepareTail.then(() => prepareNow(options));
    prepareTail = operation.catch(() => undefined);
    return operation;
  }

  function getPreparedSet(inputGeneration, configurationKey = currentConfigurationKey) {
    assertInputGeneration(inputGeneration);
    if (disposed) {
      throw createDisposedError(inputGeneration);
    }
    if (normalizeConfigurationKey(configurationKey) !== currentConfigurationKey) {
      throw createGenerationError(
        "Stateless IMAGE tracker response configuration does not match the installed detector set.",
        inputGeneration,
        getTelemetry(),
      );
    }
    if (
      !currentEntries ||
      preparedGeneration !== inputGeneration ||
      inputGeneration !== latestRequestedGeneration
    ) {
      throw createGenerationError(
        `Stateless IMAGE tracker detector set is not prepared for generation ${inputGeneration}.`,
        inputGeneration,
        getTelemetry(),
      );
    }
    return Object.fromEntries(
      currentEntries.map(({ id, detector }) => [id, detector]),
    );
  }

  function dispose() {
    if (disposed) {
      return getTelemetry();
    }
    disposed = true;
    latestConfigurationRequest += 1;
    const entries = currentEntries;
    currentEntries = null;
    currentConfigurationKey = "";
    preparedGeneration = null;
    latestRequestedGeneration = null;
    lastGeneration = null;
    closeEntries(entries);
    return getTelemetry();
  }

  return {
    installConfiguration,
    reserve,
    prepare,
    getPreparedSet,
    getTelemetry,
    dispose,
  };
}
