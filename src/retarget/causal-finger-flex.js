import { HAND_FINGERS } from "../hand-retargeting.js";
import { constrainFingerFlexionDeg } from "./anatomical-constraints.js";

const EPSILON = 1e-6;
const SOURCE_PTS_EPSILON_SEC = 1e-6;

export const DEFAULT_CAUSAL_FINGER_FLEX_OPTIONS = Object.freeze({
  maxRateDegPerSec: 540,
  minDeltaSec: 1 / 60,
  maxDeltaSec: 0.15,
  missingGraceSec: 0.18,
  resetAfterSec: 0.5,
  missingDecayDegPerSec: 240,
  minimumObservationQuality: 0.45,
  minimumCorrectionQuality: 0.55,
  legacyRiskStartDeg: 35,
  legacyRiskFullDeg: 75,
  flexActivationStartDeg: 8,
  flexActivationFullDeg: 30,
  flexScale: 1,
  dipCouplingScale: 0.85,
  dipCouplingOffsetDeg: 15,
});

export const DEFAULT_CAUSAL_FINGER_ROOT_OPTIONS = Object.freeze({
  clearChangeDeg: 35,
  confirmationConsistencyDeg: 12,
  confirmationSamples: 2,
  maximumPrimaryAmbiguity: 0.12,
  minimumObservationQuality: 0.55,
  maxRateDegPerSec: 540,
  maxDeltaSec: 1 / 30,
});

/**
 * One instance owns one non-thumb finger root. Exact integer microseconds are
 * kept separately from the accepted angles so predicted/repeated samples can
 * reconstruct the hold in a moving palm basis without becoming observations.
 */
export function createCausalFingerRootState() {
  return {
    initialized: false,
    acceptedFlexDeg: 0,
    acceptedSpreadDeg: 0,
    lastAcceptedSourcePtsUs: null,
    lastDetectedSourcePtsUs: null,
    pending: null,
    confirmedTarget: null,
  };
}

export function resetCausalFingerRootState(state) {
  if (!state || typeof state !== "object") {
    return;
  }

  state.initialized = false;
  state.acceptedFlexDeg = 0;
  state.acceptedSpreadDeg = 0;
  state.lastAcceptedSourcePtsUs = null;
  state.lastDetectedSourcePtsUs = null;
  state.pending = null;
  state.confirmedTarget = null;
}

/**
 * State is intentionally one distal joint per instance. The caller should
 * keep one state for each side/finger/segment so one noisy finger cannot
 * consume another finger's source-PTS history.
 */
export function createCausalFingerFlexState() {
  return {
    initialized: false,
    lastFlexDeg: 0,
    lastSourcePtsSec: null,
    lastObservationPtsSec: null,
    observationCount: 0,
    lastResult: null,
  };
}

export function resetCausalFingerFlexState(state) {
  if (!state || typeof state !== "object") {
    return;
  }

  state.initialized = false;
  state.lastFlexDeg = 0;
  state.lastSourcePtsSec = null;
  state.lastObservationPtsSec = null;
  state.observationCount = 0;
  state.lastResult = null;
}

/**
 * Projects the last observed flex to a newer source PTS without advancing the
 * observation state. The renderer can therefore pose a detector gap while
 * still accepting the next hand result by its original capture PTS.
 */
export function predictCausalFingerFlexGap(
  state,
  { sourcePtsSec } = {},
  options = {},
) {
  if (!state || typeof state !== "object") {
    return invalidUpdate("invalid-state");
  }

  const now = finiteSourcePts(sourcePtsSec);
  const lastObservationPtsSec = finiteSourcePts(state.lastObservationPtsSec);
  if (now === null) {
    return invalidUpdate("invalid-source-pts");
  }
  if (!state.initialized || lastObservationPtsSec === null) {
    return {
      ...invalidUpdate("missing-uninitialized"),
      sourcePtsSec: now,
      gapSec: Infinity,
    };
  }
  if (now < lastObservationPtsSec - SOURCE_PTS_EPSILON_SEC) {
    return {
      ...invalidUpdate("stale-gap-source"),
      sourcePtsSec: now,
      gapSec: 0,
      stale: true,
    };
  }

  const resolvedOptions = resolveOptions(options);
  const gapSec = Math.max(0, now - lastObservationPtsSec);
  if (gapSec >= resolvedOptions.resetAfterSec) {
    return {
      ...invalidUpdate("missing-gap-reset"),
      sourcePtsSec: now,
      gapSec,
    };
  }
  if (gapSec <= resolvedOptions.missingGraceSec) {
    return cloneUpdateResult({
      ...baseHeldResult(state, "missing-gap-hold", now),
      gapSec,
      correctionWeight: 1,
      useHinge: true,
    });
  }

  const decaySec = gapSec - resolvedOptions.missingGraceSec;
  const flexDeg = moveToward(
    finiteOr(state.lastFlexDeg, 0),
    0,
    resolvedOptions.missingDecayDegPerSec * decaySec,
  );
  return cloneUpdateResult({
    ...baseHeldResult(state, "missing-gap-decay", now),
    flexDeg,
    targetFlexDeg: 0,
    gapSec,
    correctionWeight: 1,
    useHinge: true,
  });
}

/**
 * Measures flexion at a joint from the two adjacent phalanges. Segment 1 is
 * PIP (or thumb MCP), and segment 2 is DIP (or thumb IP). Segment 0 remains an
 * absolute palm-relative aim because it also carries finger spread/abduction.
 */
export function measureParentRelativeFingerFlex({
  points,
  fingerName,
  segmentIndex,
} = {}) {
  const indices = HAND_FINGERS[fingerName];

  if (!indices || !Number.isInteger(segmentIndex) || segmentIndex < 1 || segmentIndex > 2) {
    return invalidMeasurement("unsupported-segment");
  }
  if (!Array.isArray(points)) {
    return invalidMeasurement("missing-points");
  }

  const parent = readPoint(points[indices[segmentIndex - 1]]);
  const joint = readPoint(points[indices[segmentIndex]]);
  const child = readPoint(points[indices[segmentIndex + 1]]);

  if (!parent || !joint || !child) {
    return invalidMeasurement("missing-joint-triplet");
  }

  const proximal = subtract(joint, parent);
  const distal = subtract(child, joint);
  const proximalLength = magnitude(proximal);
  const distalLength = magnitude(distal);

  if (proximalLength < EPSILON || distalLength < EPSILON) {
    return invalidMeasurement("degenerate-joint-triplet");
  }

  const cosine = clamp(
    dot(proximal, distal) / (proximalLength * distalLength),
    -1,
    1,
  );
  const flexDeg = Math.acos(cosine) * 180 / Math.PI;
  const lengthBalance = Math.min(proximalLength, distalLength) /
    Math.max(proximalLength, distalLength);
  const landmarkConfidence = Math.min(
    readPointConfidence(points[indices[segmentIndex - 1]]),
    readPointConfidence(points[indices[segmentIndex]]),
    readPointConfidence(points[indices[segmentIndex + 1]]),
  );

  return {
    valid: true,
    reason: null,
    flexDeg,
    proximalLength,
    distalLength,
    lengthBalance,
    landmarkConfidence,
    parentIndex: indices[segmentIndex - 1],
    jointIndex: indices[segmentIndex],
    childIndex: indices[segmentIndex + 1],
  };
}

/**
 * Converts a finger-root direction into an orthonormal palm-local flex/spread
 * pair, applies a source-format calibration, and reconstructs a unit vector
 * in the same source basis. The returned direction can then use the existing
 * hand-basis transport without leaking source-specific axes into the rig.
 */
export function resolvePalmLocalFingerRootDirection({
  points,
  fingerName,
  palmPrimary,
  palmNormal,
} = {}, options = {}) {
  const indices = HAND_FINGERS[fingerName];
  if (!indices || !Array.isArray(points)) {
    return invalidFingerRootDirection("missing-finger-root-points");
  }

  const root = readPoint(points[indices[0]]);
  const child = readPoint(points[indices[1]]);
  const primaryInput = readPoint(palmPrimary);
  const normalInput = readPoint(palmNormal);
  if (!root || !child || !primaryInput || !normalInput) {
    return invalidFingerRootDirection("missing-finger-root-basis");
  }

  const basis = resolvePalmLocalBasis(primaryInput, normalInput);
  const direction = normalizeVector(subtract(child, root));
  if (!basis || !direction) {
    return invalidFingerRootDirection("degenerate-finger-root-basis");
  }

  const { primary, normal, lateral } = basis;

  const primaryComponent = dot(direction, primary);
  const lateralComponent = dot(direction, lateral);
  const normalComponent = dot(direction, normal);
  const hemisphere = primaryComponent < 0 ? -1 : 1;
  const planarComponent = Math.hypot(
    primaryComponent,
    lateralComponent,
  );
  const signedPlanarComponent = hemisphere * planarComponent;
  const preserveThumbOpposition = fingerName === "Thumb";
  const rawFlexDeg = Math.atan2(
    normalComponent,
    preserveThumbOpposition ? planarComponent : signedPlanarComponent,
  ) * 180 / Math.PI;
  const rawSpreadDeg = Math.atan2(
    preserveThumbOpposition
      ? lateralComponent
      : hemisphere * lateralComponent,
    preserveThumbOpposition
      ? primaryComponent
      : Math.abs(primaryComponent),
  ) * 180 / Math.PI;
  const flexDeg = clamp(
    rawFlexDeg * positiveFiniteOr(options.flexScale, 1) + finiteOr(options.flexOffsetDeg, 0),
    finiteOr(options.minimumFlexDeg, -45),
    finiteOr(options.maximumFlexDeg, 80),
  );
  const spreadDeg = clamp(
    rawSpreadDeg * positiveFiniteOr(options.spreadScale, 1) + finiteOr(options.spreadOffsetDeg, 0),
    finiteOr(options.minimumSpreadDeg, -75),
    finiteOr(options.maximumSpreadDeg, 75),
  );
  const reconstructed = reconstructPalmLocalDirection(basis, flexDeg, spreadDeg);

  return {
    valid: Boolean(reconstructed),
    reason: reconstructed ? null : "unresolvable-finger-root-direction",
    fingerName,
    rawFlexDeg,
    rawSpreadDeg,
    flexDeg,
    spreadDeg,
    primaryComponent,
    lateralComponent,
    normalComponent,
    direction: reconstructed,
  };
}

/**
 * Applies exact-PTS temporal ownership to every calibrated finger-root
 * direction. Thumb retains its opposition-specific spatial decomposition and
 * skips the non-thumb near-zero-primary ambiguity check. Clear detector changes
 * remain zero-latency; a large or applicable hemisphere-ambiguous observation
 * needs two consistent unique PTS values before it can move the accepted
 * target. Once confirmed, the target advances on the unit sphere at a
 * source-PTS-causal rate whose dt is capped at one 30 Hz frame.
 */
export function updateCausalFingerRootDirection(
  state,
  {
    points = null,
    fingerName,
    palmPrimary = null,
    palmNormal = null,
    sourcePtsUs = null,
    confidence = 1,
    provenance = "detected",
  } = {},
  options = {},
) {
  if (!state || typeof state !== "object") {
    return invalidFingerRootUpdate("invalid-state");
  }
  if (!HAND_FINGERS[fingerName]) {
    return invalidFingerRootUpdate("unsupported-finger", { fingerName });
  }

  const basis = resolvePalmLocalBasis(palmPrimary, palmNormal);
  const resolvedOptions = resolveFingerRootOptions(options);
  const observation = resolvePalmLocalFingerRootDirection({
    points,
    fingerName,
    palmPrimary,
    palmNormal,
  }, options);
  const predicted = provenance === "predicted";
  const exactSourcePtsUs = finiteExactSourcePtsUs(sourcePtsUs);

  if (predicted) {
    return holdFingerRootResult(state, basis, "predicted-hold", {
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      predicted: true,
      observation,
    });
  }
  if (exactSourcePtsUs === null) {
    return holdFingerRootResult(state, basis, "invalid-source-pts-hold", {
      fingerName,
      observation,
    });
  }

  const lastDetectedSourcePtsUs = finiteExactSourcePtsUs(
    state.lastDetectedSourcePtsUs,
  );
  if (
    lastDetectedSourcePtsUs !== null &&
    exactSourcePtsUs < lastDetectedSourcePtsUs
  ) {
    return holdFingerRootResult(state, basis, "stale-source-hold", {
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      stale: true,
      observation,
    });
  }
  if (
    lastDetectedSourcePtsUs !== null &&
    exactSourcePtsUs === lastDetectedSourcePtsUs
  ) {
    return holdFingerRootResult(state, basis, "repeated-source-hold", {
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      repeated: true,
      observation,
    });
  }

  const quality = clamp(finiteOr(confidence, 0), 0, 1);
  if (
    !observation.valid ||
    quality < resolvedOptions.minimumObservationQuality
  ) {
    return holdFingerRootResult(state, basis, "low-quality-hold", {
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      quality,
      observation,
    });
  }

  const candidate = {
    flexDeg: observation.flexDeg,
    spreadDeg: observation.spreadDeg,
  };
  // A negative or near-zero primary component is legitimate Thumb opposition.
  // Non-thumb roots still require temporal confirmation around that ambiguous
  // palm hemisphere boundary.
  const primaryAmbiguous = fingerName !== "Thumb" &&
    Math.abs(observation.primaryComponent) <=
      resolvedOptions.maximumPrimaryAmbiguity;
  const targetDeltaDeg = state.initialized
    ? palmLocalAngleDistanceDeg(
        state.acceptedFlexDeg,
        state.acceptedSpreadDeg,
        candidate.flexDeg,
        candidate.spreadDeg,
      )
    : 0;
  const clear = !primaryAmbiguous && (
    !state.initialized ||
    targetDeltaDeg <= resolvedOptions.clearChangeDeg + EPSILON
  );

  if (clear && !state.confirmedTarget) {
    const wasInitialized = state.initialized;
    state.lastDetectedSourcePtsUs = exactSourcePtsUs;
    acceptFingerRootAngles(state, candidate, exactSourcePtsUs);
    state.pending = null;
    return buildAppliedFingerRootResult(state, basis, observation, {
      status: wasInitialized ? "direct" : "initialized-direct",
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      quality,
      direct: true,
      targetDeltaDeg,
      appliedDeltaDeg: targetDeltaDeg,
    });
  }

  const confirmedTarget = state.confirmedTarget;
  if (
    confirmedTarget &&
    palmLocalAngleDistanceDeg(
      confirmedTarget.flexDeg,
      confirmedTarget.spreadDeg,
      candidate.flexDeg,
      candidate.spreadDeg,
    ) <= resolvedOptions.confirmationConsistencyDeg + EPSILON
  ) {
    state.lastDetectedSourcePtsUs = exactSourcePtsUs;
    state.confirmedTarget = { ...candidate };
    state.pending = null;
    return advanceConfirmedFingerRootTarget(
      state,
      basis,
      observation,
      exactSourcePtsUs,
      quality,
      resolvedOptions,
      { status: "confirmed-tracked", primaryAmbiguous },
    );
  }

  if (clear) {
    state.lastDetectedSourcePtsUs = exactSourcePtsUs;
    acceptFingerRootAngles(state, candidate, exactSourcePtsUs);
    state.pending = null;
    state.confirmedTarget = null;
    return buildAppliedFingerRootResult(state, basis, observation, {
      status: "direct",
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      quality,
      direct: true,
      targetDeltaDeg,
      appliedDeltaDeg: targetDeltaDeg,
    });
  }

  const pending = state.pending;
  const consistentPending = pending &&
    palmLocalAngleDistanceDeg(
      pending.flexDeg,
      pending.spreadDeg,
      candidate.flexDeg,
      candidate.spreadDeg,
    ) <= resolvedOptions.confirmationConsistencyDeg + EPSILON;
  const confirmationCount = consistentPending
    ? Math.min(
        resolvedOptions.confirmationSamples,
        Math.max(1, Math.trunc(pending.confirmationCount || 1)) + 1,
      )
    : 1;

  state.lastDetectedSourcePtsUs = exactSourcePtsUs;
  state.pending = {
    ...candidate,
    confirmationCount,
    firstSourcePtsUs: consistentPending
      ? pending.firstSourcePtsUs
      : exactSourcePtsUs,
    lastSourcePtsUs: exactSourcePtsUs,
  };
  state.confirmedTarget = null;

  if (confirmationCount < resolvedOptions.confirmationSamples) {
    return holdFingerRootResult(state, basis, "confirmation-hold", {
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      quality,
      held: true,
      primaryAmbiguous,
      targetDeltaDeg,
      confirmationCount,
      confirmationRequired: resolvedOptions.confirmationSamples,
      observation,
    });
  }

  state.pending = null;
  if (!state.initialized) {
    acceptFingerRootAngles(state, candidate, exactSourcePtsUs);
    return buildAppliedFingerRootResult(state, basis, observation, {
      status: "initialized-confirmed",
      fingerName,
      sourcePtsUs: exactSourcePtsUs,
      quality,
      confirmed: true,
      primaryAmbiguous,
      confirmationCount,
      confirmationRequired: resolvedOptions.confirmationSamples,
      targetDeltaDeg,
    });
  }

  state.confirmedTarget = { ...candidate };
  return advanceConfirmedFingerRootTarget(
    state,
    basis,
    observation,
    exactSourcePtsUs,
    quality,
    resolvedOptions,
    {
      status: "confirmed",
      primaryAmbiguous,
      confirmationCount,
      confirmationRequired: resolvedOptions.confirmationSamples,
    },
  );
}

/**
 * Resolves the spatial (non-temporal) distal target. Non-thumb DIP flex is
 * coupled to the already-resolved PIP target so detector noise cannot fold the
 * fingertip independently of its parent.
 */
export function resolveFingerFlexObservation({
  points,
  fingerName,
  segmentIndex,
  proximalFlexDeg = null,
  confidence = 1,
} = {}, options = {}) {
  const resolvedOptions = resolveOptions(options);
  const measurement = measureParentRelativeFingerFlex({
    points,
    fingerName,
    segmentIndex,
  });

  if (!measurement.valid) {
    return {
      ...measurement,
      fingerName: fingerName ?? null,
      segmentIndex: Number.isInteger(segmentIndex) ? segmentIndex : null,
      quality: 0,
      targetFlexDeg: null,
    };
  }

  const calibratedFlexDeg = measurement.flexDeg * resolvedOptions.flexScale;
  const constraint = constrainFingerFlexionDeg({
    fingerName,
    segmentIndex,
    flexDeg: calibratedFlexDeg,
  });
  let targetFlexDeg = constraint.clampedFlexDeg;
  let dipCoupled = false;
  let dipCouplingLimitDeg = null;

  if (
    fingerName !== "Thumb" &&
    segmentIndex === 2 &&
    isFiniteNumber(proximalFlexDeg)
  ) {
    dipCouplingLimitDeg = Math.max(
      0,
      Number(proximalFlexDeg) * resolvedOptions.dipCouplingScale +
        resolvedOptions.dipCouplingOffsetDeg,
    );
    const coupled = Math.min(targetFlexDeg, dipCouplingLimitDeg);
    dipCoupled = coupled < targetFlexDeg - EPSILON;
    targetFlexDeg = coupled;
  }

  const detectorConfidence = clamp(finiteOr(confidence, 0), 0, 1);
  const geometryQuality = 0.55 + 0.45 * smoothstep(0.2, 0.65, measurement.lengthBalance);
  const quality = clamp(
    Math.min(detectorConfidence, measurement.landmarkConfidence) *
      geometryQuality *
      constraint.confidenceScale,
    0,
    1,
  );

  return {
    ...measurement,
    ...constraint,
    valid: true,
    reason: quality >= resolvedOptions.minimumObservationQuality
      ? null
      : "low-observation-quality",
    fingerName,
    segmentIndex,
    rawFlexDeg: measurement.flexDeg,
    calibratedFlexDeg,
    targetFlexDeg,
    quality,
    detectorConfidence,
    geometryQuality,
    dipCoupled,
    dipCouplingLimitDeg,
  };
}

/**
 * Produces a source-PTS-causal distal flex target and a conservative blend
 * weight. Reliable observable flex owns the distal hinge continuously, while
 * `legacyLocalDeltaDeg` raises correction weight sooner when the old absolute
 * aim develops tail-risk motion.
 */
export function updateCausalFingerFlex(
  state,
  {
    points = null,
    fingerName,
    segmentIndex,
    sourcePtsSec,
    proximalFlexDeg = null,
    confidence = 1,
    legacyLocalDeltaDeg = null,
  } = {},
  options = {},
) {
  if (!state || typeof state !== "object") {
    return invalidUpdate("invalid-state");
  }

  const now = finiteSourcePts(sourcePtsSec);

  if (now === null) {
    return invalidUpdate("invalid-source-pts");
  }

  const previousSourcePtsSec = finiteSourcePts(state.lastSourcePtsSec);

  if (previousSourcePtsSec !== null && now < previousSourcePtsSec - SOURCE_PTS_EPSILON_SEC) {
    return holdPreviousResult(state, "stale-source-hold", now, {
      stale: true,
    });
  }
  if (
    previousSourcePtsSec !== null &&
    Math.abs(now - previousSourcePtsSec) <= SOURCE_PTS_EPSILON_SEC
  ) {
    return holdPreviousResult(state, "repeated-source-hold", now, {
      repeated: true,
    });
  }

  const resolvedOptions = resolveOptions(options);
  const observation = resolveFingerFlexObservation({
    points,
    fingerName,
    segmentIndex,
    proximalFlexDeg,
    confidence,
  }, resolvedOptions);

  if (!observation.valid || observation.quality < resolvedOptions.minimumObservationQuality) {
    return updateMissingFingerFlex(
      state,
      now,
      observation.reason ?? "missing-observation",
      resolvedOptions,
      { observation },
    );
  }

  const lastObservationPtsSec = finiteSourcePts(state.lastObservationPtsSec);
  const observationGapSec = lastObservationPtsSec === null
    ? null
    : Math.max(0, now - lastObservationPtsSec);
  const reacquired = observationGapSec !== null &&
    observationGapSec > resolvedOptions.missingGraceSec;
  const resetGap = observationGapSec !== null &&
    observationGapSec >= resolvedOptions.resetAfterSec;
  const deltaSec = clamp(
    previousSourcePtsSec === null ? resolvedOptions.minDeltaSec : now - previousSourcePtsSec,
    resolvedOptions.minDeltaSec,
    resolvedOptions.maxDeltaSec,
  );
  const previousFlexDeg = state.initialized && !resetGap
    ? finiteOr(state.lastFlexDeg, 0)
    : 0;
  const maximumStepDeg = resolvedOptions.maxRateDegPerSec * deltaSec;
  const targetDeltaDeg = observation.targetFlexDeg - previousFlexDeg;
  const flexDeg = previousFlexDeg + clamp(
    targetDeltaDeg,
    -maximumStepDeg,
    maximumStepDeg,
  );
  const appliedDeltaDeg = Math.abs(flexDeg - previousFlexDeg);
  const rateLimited = Math.abs(targetDeltaDeg) > maximumStepDeg + EPSILON;
  const legacyRisk = isFiniteNumber(legacyLocalDeltaDeg)
    ? smoothstep(
        resolvedOptions.legacyRiskStartDeg,
        resolvedOptions.legacyRiskFullDeg,
        Math.abs(Number(legacyLocalDeltaDeg)),
      )
    : 0;
  const causalRisk = rateLimited
    ? smoothstep(0, resolvedOptions.legacyRiskFullDeg, Math.abs(targetDeltaDeg))
    : 0;
  const flexActivation = smoothstep(
    resolvedOptions.flexActivationStartDeg,
    resolvedOptions.flexActivationFullDeg,
    flexDeg,
  );
  const qualityGate = observation.quality >= resolvedOptions.minimumCorrectionQuality
    ? observation.quality
    : 0;
  // PIP/DIP are modeled as one-DOF hinges in strict retargeting. Once the
  // observation passes the correction-quality gate, blending back toward the
  // old absolute aim reintroduces source-basis roll and defeats that model.
  // The causal rate limiter owns temporal continuity instead.
  const stableFlexCorrection = qualityGate > 0 ? 1 : 0;
  const correctionWeight = clamp(
    Math.max(
      legacyRisk * qualityGate,
      causalRisk * 0.65,
      stableFlexCorrection,
    ),
    0,
    1,
  );
  const statusBase = !state.initialized
    ? "initialized"
    : resetGap
      ? "reacquired-reset"
      : reacquired
        ? "reacquired"
        : "tracked";
  const result = {
    apply: true,
    useHinge: correctionWeight > EPSILON,
    tracked: true,
    status: rateLimited ? `${statusBase}-rate-limited` : statusBase,
    fingerName,
    segmentIndex,
    sourcePtsSec: now,
    flexDeg,
    targetFlexDeg: observation.targetFlexDeg,
    rawFlexDeg: observation.rawFlexDeg,
    calibratedFlexDeg: observation.calibratedFlexDeg,
    appliedDeltaDeg,
    correctionWeight,
    legacyRisk,
    causalRisk,
    flexActivation,
    stableFlexCorrection,
    rateLimited,
    repeated: false,
    stale: false,
    observationGapSec,
    observation,
  };

  state.initialized = true;
  state.lastFlexDeg = flexDeg;
  state.lastSourcePtsSec = now;
  state.lastObservationPtsSec = now;
  state.observationCount = Math.max(0, Math.trunc(state.observationCount || 0)) + 1;
  state.lastResult = result;

  return cloneUpdateResult(result);
}

function updateMissingFingerFlex(state, now, reason, options, details = {}) {
  const lastObservationPtsSec = finiteSourcePts(state.lastObservationPtsSec);
  const gapSec = lastObservationPtsSec === null
    ? Infinity
    : Math.max(0, now - lastObservationPtsSec);
  const previousSourcePtsSec = finiteSourcePts(state.lastSourcePtsSec);
  const deltaSec = clamp(
    previousSourcePtsSec === null ? options.minDeltaSec : now - previousSourcePtsSec,
    options.minDeltaSec,
    options.maxDeltaSec,
  );

  state.lastSourcePtsSec = now;

  if (!state.initialized) {
    const result = {
      ...invalidUpdate(reason),
      sourcePtsSec: now,
      gapSec,
      ...details,
    };
    state.lastResult = result;
    return cloneUpdateResult(result);
  }

  if (gapSec <= options.missingGraceSec) {
    const result = {
      ...baseHeldResult(state, "missing-hold", now),
      gapSec,
      correctionWeight: 1,
      useHinge: true,
      ...details,
    };
    state.lastResult = result;
    return cloneUpdateResult(result);
  }

  if (gapSec >= options.resetAfterSec) {
    const observationCount = state.observationCount;
    resetCausalFingerFlexState(state);
    state.lastSourcePtsSec = now;
    state.observationCount = observationCount;
    const result = {
      ...invalidUpdate("missing-reset"),
      sourcePtsSec: now,
      gapSec,
      ...details,
    };
    state.lastResult = result;
    return cloneUpdateResult(result);
  }

  const flexDeg = moveToward(
    finiteOr(state.lastFlexDeg, 0),
    0,
    options.missingDecayDegPerSec * deltaSec,
  );
  const result = {
    ...baseHeldResult(state, "missing-decay", now),
    flexDeg,
    targetFlexDeg: 0,
    gapSec,
    correctionWeight: 1,
    useHinge: true,
    ...details,
  };

  state.lastFlexDeg = flexDeg;
  state.lastResult = result;
  return cloneUpdateResult(result);
}

function holdPreviousResult(state, status, sourcePtsSec, flags = {}) {
  if (!state.lastResult) {
    return {
      ...invalidUpdate(status),
      sourcePtsSec,
      ...flags,
    };
  }

  return cloneUpdateResult({
    ...state.lastResult,
    status,
    sourcePtsSec,
    appliedDeltaDeg: 0,
    rateLimited: false,
    ...flags,
  });
}

function baseHeldResult(state, status, sourcePtsSec) {
  const previous = state.lastResult ?? {};

  return {
    ...previous,
    apply: true,
    tracked: false,
    status,
    sourcePtsSec,
    flexDeg: finiteOr(state.lastFlexDeg, 0),
    appliedDeltaDeg: 0,
    rateLimited: false,
    repeated: false,
    stale: false,
  };
}

function resolvePalmLocalBasis(palmPrimary, palmNormal) {
  const primaryInput = readPoint(palmPrimary);
  const normalInput = readPoint(palmNormal);
  if (!primaryInput || !normalInput) {
    return null;
  }

  const normal = normalizeVector(normalInput);
  const primaryProjected = normal
    ? subtract(primaryInput, scaleVector(normal, dot(primaryInput, normal)))
    : null;
  const primary = normalizeVector(primaryProjected);
  const lateral = primary && normal
    ? normalizeVector(cross(normal, primary))
    : null;

  return primary && normal && lateral
    ? { primary, normal, lateral }
    : null;
}

function reconstructPalmLocalDirection(basis, flexDeg, spreadDeg) {
  if (!basis || !isFiniteNumber(flexDeg) || !isFiniteNumber(spreadDeg)) {
    return null;
  }

  const flexRad = Number(flexDeg) * Math.PI / 180;
  const spreadRad = Number(spreadDeg) * Math.PI / 180;
  const planarScale = Math.cos(flexRad);
  const { primary, normal, lateral } = basis;

  return normalizeVector({
    x: primary.x * planarScale * Math.cos(spreadRad) +
      lateral.x * planarScale * Math.sin(spreadRad) +
      normal.x * Math.sin(flexRad),
    y: primary.y * planarScale * Math.cos(spreadRad) +
      lateral.y * planarScale * Math.sin(spreadRad) +
      normal.y * Math.sin(flexRad),
    z: primary.z * planarScale * Math.cos(spreadRad) +
      lateral.z * planarScale * Math.sin(spreadRad) +
      normal.z * Math.sin(flexRad),
  });
}

function resolveFingerRootOptions(options) {
  const defaults = DEFAULT_CAUSAL_FINGER_ROOT_OPTIONS;

  return {
    clearChangeDeg: nonnegativeFiniteOr(
      options.clearChangeDeg,
      defaults.clearChangeDeg,
    ),
    confirmationConsistencyDeg: nonnegativeFiniteOr(
      options.confirmationConsistencyDeg,
      defaults.confirmationConsistencyDeg,
    ),
    confirmationSamples: Math.max(
      2,
      Math.trunc(positiveFiniteOr(
        options.confirmationSamples,
        defaults.confirmationSamples,
      )),
    ),
    maximumPrimaryAmbiguity: clamp(
      nonnegativeFiniteOr(
        options.maximumPrimaryAmbiguity,
        defaults.maximumPrimaryAmbiguity,
      ),
      0,
      1,
    ),
    minimumObservationQuality: clamp(
      finiteOr(
        options.minimumObservationQuality,
        defaults.minimumObservationQuality,
      ),
      0,
      1,
    ),
    maxRateDegPerSec: positiveFiniteOr(
      options.maxRateDegPerSec,
      defaults.maxRateDegPerSec,
    ),
    maxDeltaSec: positiveFiniteOr(
      options.maxDeltaSec,
      defaults.maxDeltaSec,
    ),
  };
}

function finiteExactSourcePtsUs(value) {
  if (value === null || value === "" || typeof value === "boolean") {
    return null;
  }
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function acceptFingerRootAngles(state, angles, sourcePtsUs) {
  state.initialized = true;
  state.acceptedFlexDeg = Number(angles.flexDeg);
  state.acceptedSpreadDeg = Number(angles.spreadDeg);
  state.lastAcceptedSourcePtsUs = sourcePtsUs;
}

function advanceConfirmedFingerRootTarget(
  state,
  basis,
  observation,
  sourcePtsUs,
  quality,
  options,
  details = {},
) {
  const target = state.confirmedTarget;
  const previous = {
    flexDeg: state.acceptedFlexDeg,
    spreadDeg: state.acceptedSpreadDeg,
  };
  const targetDeltaDeg = palmLocalAngleDistanceDeg(
    previous.flexDeg,
    previous.spreadDeg,
    target.flexDeg,
    target.spreadDeg,
  );
  const previousPtsUs = finiteExactSourcePtsUs(state.lastAcceptedSourcePtsUs);
  const deltaSec = previousPtsUs === null
    ? options.maxDeltaSec
    : clamp((sourcePtsUs - previousPtsUs) / 1e6, 0, options.maxDeltaSec);
  // Confirmed recovery is confidence-bounded without changing the established
  // quality=1 rate. Low-quality samples below the observation threshold never
  // reach this path, while accepted lower-confidence evidence can only reduce
  // the maximum causal step.
  const maximumStepDeg = options.maxRateDegPerSec * deltaSec *
    clamp(quality, 0, 1);
  const rateLimited = targetDeltaDeg > maximumStepDeg + EPSILON;
  const accepted = rateLimited
    ? movePalmLocalAnglesToward(previous, target, maximumStepDeg)
    : { ...target };
  const appliedDeltaDeg = palmLocalAngleDistanceDeg(
    previous.flexDeg,
    previous.spreadDeg,
    accepted.flexDeg,
    accepted.spreadDeg,
  );

  acceptFingerRootAngles(state, accepted, sourcePtsUs);
  if (!rateLimited) {
    state.confirmedTarget = null;
  }

  return buildAppliedFingerRootResult(state, basis, observation, {
    ...details,
    status: rateLimited
      ? `${details.status ?? "confirmed"}-rate-limited`
      : details.status ?? "confirmed",
    fingerName: observation.fingerName,
    sourcePtsUs,
    quality,
    confirmed: true,
    rateLimited,
    targetFlexDeg: target.flexDeg,
    targetSpreadDeg: target.spreadDeg,
    targetDeltaDeg,
    appliedDeltaDeg,
    maximumStepDeg,
  });
}

function buildAppliedFingerRootResult(state, basis, observation, details = {}) {
  const direction = reconstructPalmLocalDirection(
    basis,
    state.acceptedFlexDeg,
    state.acceptedSpreadDeg,
  );
  if (!direction) {
    return invalidFingerRootUpdate("unresolvable-current-basis", {
      ...details,
      observation,
    });
  }

  return {
    ...baseFingerRootResult(details.status ?? "applied"),
    ...details,
    apply: true,
    direction,
    flexDeg: state.acceptedFlexDeg,
    spreadDeg: state.acceptedSpreadDeg,
    targetFlexDeg: isFiniteNumber(details.targetFlexDeg)
      ? Number(details.targetFlexDeg)
      : observation.flexDeg,
    targetSpreadDeg: isFiniteNumber(details.targetSpreadDeg)
      ? Number(details.targetSpreadDeg)
      : observation.spreadDeg,
    observation,
  };
}

function holdFingerRootResult(state, basis, status, details = {}) {
  const initialized = Boolean(state?.initialized);
  const direction = initialized
    ? reconstructPalmLocalDirection(
        basis,
        state.acceptedFlexDeg,
        state.acceptedSpreadDeg,
      )
    : null;

  return {
    ...baseFingerRootResult(status),
    ...details,
    held: true,
    apply: Boolean(direction),
    direction,
    flexDeg: initialized ? finiteOr(state.acceptedFlexDeg, 0) : null,
    spreadDeg: initialized ? finiteOr(state.acceptedSpreadDeg, 0) : null,
    targetFlexDeg: initialized ? finiteOr(state.acceptedFlexDeg, 0) : null,
    targetSpreadDeg: initialized ? finiteOr(state.acceptedSpreadDeg, 0) : null,
    confirmationCount: Math.max(
      0,
      Math.trunc(details.confirmationCount ?? state?.pending?.confirmationCount ?? 0),
    ),
  };
}

function invalidFingerRootUpdate(status, details = {}) {
  return {
    ...baseFingerRootResult(status),
    ...details,
  };
}

function baseFingerRootResult(status) {
  return {
    apply: false,
    status,
    fingerName: null,
    sourcePtsUs: null,
    direction: null,
    flexDeg: null,
    spreadDeg: null,
    targetFlexDeg: null,
    targetSpreadDeg: null,
    quality: 0,
    direct: false,
    held: false,
    confirmed: false,
    rateLimited: false,
    predicted: false,
    repeated: false,
    stale: false,
    primaryAmbiguous: false,
    targetDeltaDeg: 0,
    appliedDeltaDeg: 0,
    maximumStepDeg: 0,
    confirmationCount: 0,
    confirmationRequired: DEFAULT_CAUSAL_FINGER_ROOT_OPTIONS.confirmationSamples,
    observation: null,
  };
}

function movePalmLocalAnglesToward(previous, target, maximumStepDeg) {
  const from = canonicalPalmLocalDirection(
    previous.flexDeg,
    previous.spreadDeg,
  );
  const to = canonicalPalmLocalDirection(target.flexDeg, target.spreadDeg);
  const angleDeg = vectorAngleDeg(from, to);
  if (angleDeg <= maximumStepDeg + EPSILON || angleDeg <= EPSILON) {
    return { ...target };
  }
  if (maximumStepDeg <= 0) {
    return { ...previous };
  }

  return decomposeCanonicalPalmLocalDirection(
    slerpUnitVectors(from, to, maximumStepDeg / angleDeg),
  );
}

function palmLocalAngleDistanceDeg(
  leftFlexDeg,
  leftSpreadDeg,
  rightFlexDeg,
  rightSpreadDeg,
) {
  return vectorAngleDeg(
    canonicalPalmLocalDirection(leftFlexDeg, leftSpreadDeg),
    canonicalPalmLocalDirection(rightFlexDeg, rightSpreadDeg),
  );
}

function canonicalPalmLocalDirection(flexDeg, spreadDeg) {
  const flexRad = Number(flexDeg) * Math.PI / 180;
  const spreadRad = Number(spreadDeg) * Math.PI / 180;
  const planarScale = Math.cos(flexRad);

  return normalizeVector({
    x: planarScale * Math.cos(spreadRad),
    y: planarScale * Math.sin(spreadRad),
    z: Math.sin(flexRad),
  });
}

function decomposeCanonicalPalmLocalDirection(direction) {
  const unit = normalizeVector(direction);
  const hemisphere = unit.x < 0 ? -1 : 1;

  return {
    flexDeg: Math.atan2(
      unit.z,
      hemisphere * Math.hypot(unit.x, unit.y),
    ) * 180 / Math.PI,
    spreadDeg: Math.atan2(
      hemisphere * unit.y,
      Math.abs(unit.x),
    ) * 180 / Math.PI,
  };
}

function slerpUnitVectors(from, to, amount) {
  const cosine = clamp(dot(from, to), -1, 1);
  const angle = Math.acos(cosine);
  if (angle <= EPSILON) {
    return { ...to };
  }

  const sine = Math.sin(angle);
  if (Math.abs(sine) <= EPSILON) {
    const fallbackAxis = Math.abs(from.x) < 0.9
      ? normalizeVector(cross(from, { x: 1, y: 0, z: 0 }))
      : normalizeVector(cross(from, { x: 0, y: 1, z: 0 }));
    const theta = angle * clamp(amount, 0, 1);
    return normalizeVector({
      x: from.x * Math.cos(theta) + fallbackAxis.x * Math.sin(theta),
      y: from.y * Math.cos(theta) + fallbackAxis.y * Math.sin(theta),
      z: from.z * Math.cos(theta) + fallbackAxis.z * Math.sin(theta),
    });
  }

  const clampedAmount = clamp(amount, 0, 1);
  const fromScale = Math.sin((1 - clampedAmount) * angle) / sine;
  const toScale = Math.sin(clampedAmount * angle) / sine;
  return normalizeVector({
    x: from.x * fromScale + to.x * toScale,
    y: from.y * fromScale + to.y * toScale,
    z: from.z * fromScale + to.z * toScale,
  });
}

function vectorAngleDeg(left, right) {
  if (!left || !right) {
    return Infinity;
  }
  return Math.acos(clamp(dot(left, right), -1, 1)) * 180 / Math.PI;
}

function resolveOptions(options) {
  const defaults = DEFAULT_CAUSAL_FINGER_FLEX_OPTIONS;
  const minDeltaSec = positiveFiniteOr(options.minDeltaSec, defaults.minDeltaSec);
  const maxDeltaSec = Math.max(
    minDeltaSec,
    positiveFiniteOr(options.maxDeltaSec, defaults.maxDeltaSec),
  );
  const missingGraceSec = nonnegativeFiniteOr(
    options.missingGraceSec,
    defaults.missingGraceSec,
  );

  return {
    maxRateDegPerSec: positiveFiniteOr(options.maxRateDegPerSec, defaults.maxRateDegPerSec),
    minDeltaSec,
    maxDeltaSec,
    missingGraceSec,
    resetAfterSec: Math.max(
      missingGraceSec,
      nonnegativeFiniteOr(options.resetAfterSec, defaults.resetAfterSec),
    ),
    missingDecayDegPerSec: nonnegativeFiniteOr(
      options.missingDecayDegPerSec,
      defaults.missingDecayDegPerSec,
    ),
    minimumObservationQuality: clamp(
      finiteOr(options.minimumObservationQuality, defaults.minimumObservationQuality),
      0,
      1,
    ),
    minimumCorrectionQuality: clamp(
      finiteOr(options.minimumCorrectionQuality, defaults.minimumCorrectionQuality),
      0,
      1,
    ),
    legacyRiskStartDeg: nonnegativeFiniteOr(options.legacyRiskStartDeg, defaults.legacyRiskStartDeg),
    legacyRiskFullDeg: nonnegativeFiniteOr(options.legacyRiskFullDeg, defaults.legacyRiskFullDeg),
    flexActivationStartDeg: nonnegativeFiniteOr(
      options.flexActivationStartDeg,
      defaults.flexActivationStartDeg,
    ),
    flexActivationFullDeg: nonnegativeFiniteOr(
      options.flexActivationFullDeg,
      defaults.flexActivationFullDeg,
    ),
    flexScale: positiveFiniteOr(options.flexScale, defaults.flexScale),
    dipCouplingScale: nonnegativeFiniteOr(options.dipCouplingScale, defaults.dipCouplingScale),
    dipCouplingOffsetDeg: nonnegativeFiniteOr(
      options.dipCouplingOffsetDeg,
      defaults.dipCouplingOffsetDeg,
    ),
  };
}

function readPoint(value) {
  if (!isFiniteNumber(value?.x) || !isFiniteNumber(value?.y)) {
    return null;
  }

  return {
    x: Number(value.x),
    y: Number(value.y),
    z: isFiniteNumber(value?.z) ? Number(value.z) : 0,
  };
}

function readPointConfidence(value) {
  const candidates = [value?.visibility, value?.presence]
    .filter(isFiniteNumber)
    .map(Number);

  return candidates.length > 0 ? clamp(Math.min(...candidates), 0, 1) : 1;
}

function invalidMeasurement(reason) {
  return {
    valid: false,
    reason,
    flexDeg: null,
    proximalLength: null,
    distalLength: null,
    lengthBalance: 0,
    landmarkConfidence: 0,
    parentIndex: null,
    jointIndex: null,
    childIndex: null,
  };
}

function invalidFingerRootDirection(reason) {
  return {
    valid: false,
    reason,
    fingerName: null,
    rawFlexDeg: null,
    rawSpreadDeg: null,
    flexDeg: null,
    spreadDeg: null,
    primaryComponent: null,
    lateralComponent: null,
    normalComponent: null,
    direction: null,
  };
}

function invalidUpdate(reason) {
  return {
    apply: false,
    useHinge: false,
    tracked: false,
    status: reason,
    sourcePtsSec: null,
    flexDeg: null,
    targetFlexDeg: null,
    rawFlexDeg: null,
    calibratedFlexDeg: null,
    appliedDeltaDeg: 0,
    correctionWeight: 0,
    legacyRisk: 0,
    causalRisk: 0,
    flexActivation: 0,
    stableFlexCorrection: 0,
    rateLimited: false,
    repeated: false,
    stale: false,
    observationGapSec: null,
    observation: null,
  };
}

function cloneUpdateResult(result) {
  return {
    ...result,
    observation: result.observation ? { ...result.observation } : result.observation,
  };
}

function finiteSourcePts(value) {
  return isFiniteNumber(value) ? Number(value) : null;
}

function isFiniteNumber(value) {
  return value !== null && value !== "" && Number.isFinite(Number(value));
}

function finiteOr(value, fallback) {
  return isFiniteNumber(value) ? Number(value) : fallback;
}

function positiveFiniteOr(value, fallback) {
  const resolved = finiteOr(value, fallback);
  return resolved > 0 ? resolved : fallback;
}

function nonnegativeFiniteOr(value, fallback) {
  const resolved = finiteOr(value, fallback);
  return resolved >= 0 ? resolved : fallback;
}

function subtract(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function scaleVector(vector, scale) {
  return {
    x: vector.x * scale,
    y: vector.y * scale,
    z: vector.z * scale,
  };
}

function normalizeVector(vector) {
  if (!vector) {
    return null;
  }
  const length = magnitude(vector);
  if (length < EPSILON) {
    return null;
  }
  return scaleVector(vector, 1 / length);
}

function moveToward(value, target, maximumDelta) {
  const delta = target - value;
  return value + clamp(delta, -maximumDelta, maximumDelta);
}

function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0 + EPSILON) {
    return value >= edge1 ? 1 : 0;
  }

  const amount = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
