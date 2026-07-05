const MIN_VECTOR_LENGTH = 0.000001;
const DEFAULT_LOW_CONFIDENCE = 0.35;
const DEFAULT_TRANSITION_FRAMES = 2;
const DEFAULT_FRAME_INTERVAL_MS = 1000 / 30;
const DEFAULT_MAX_YAW_RATE_DEG_PER_SEC = 1800;
const DEFAULT_REACQUIRE_STABLE_FRAMES = 2;
const DEFAULT_UNRELIABLE_YAW_JUMP_DEG = 120;
const DEFAULT_REACQUIRE_MATCH_DEG = 45;
const FRONT_FACE_CONFIDENCE = 0.55;
const SIDE_ORDER_MIN_DELTA = 0.025;

export {
  classifyFacingYaw,
  estimateFacingState,
  estimateFacingYaw,
  normalizeFacingState,
  normalizeAngleDeg,
  toLegacyFacing,
  updateFacingState,
};

function estimateFacingState(points, previousFacing = undefined, options = {}) {
  const estimate = estimateFacingYaw(points, options);
  return updateFacingState(previousFacing, estimate, options);
}

function estimateFacingYaw(points, options = {}) {
  const lowConfidence = Number(options.lowConfidence ?? DEFAULT_LOW_CONFIDENCE);
  const leftShoulder = points?.leftShoulder;
  const rightShoulder = points?.rightShoulder;
  const leftHip = points?.leftHip;
  const rightHip = points?.rightHip;
  const faceConfidence = maxVisibility(points?.nose, points?.leftEar, points?.rightEar);
  const sideOrder = estimateSideOrder(points);

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return {
      yawDeg: 0,
      state: "unknown",
      confidence: 0,
      sideOrderSign: sideOrder.sign,
      sideOrderConfidence: sideOrder.confidence,
      reason: "missing_torso",
    };
  }

  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  const across = normalize(subtract(leftShoulder, rightShoulder));
  const up = normalize(subtract(shoulderMid, hipMid));
  const confidence = Math.min(
    leftShoulder.visibility ?? 1,
    rightShoulder.visibility ?? 1,
    leftHip.visibility ?? 1,
    rightHip.visibility ?? 1,
  );

  if (!across || !up || confidence < lowConfidence) {
    return {
      yawDeg: 0,
      state: "unknown",
      confidence,
      sideOrderSign: sideOrder.sign,
      sideOrderConfidence: sideOrder.confidence,
      reason: confidence < lowConfidence ? "low_confidence" : "degenerate_torso",
    };
  }

  const forward = normalize(cross(up, across));

  if (!forward) {
    return {
      yawDeg: 0,
      state: "unknown",
      confidence,
      sideOrderSign: sideOrder.sign,
      sideOrderConfidence: sideOrder.confidence,
      reason: "degenerate_forward",
    };
  }

  const yawDeg = normalizeAngleDeg(Math.atan2(-forward.x, forward.z) * (180 / Math.PI));

  return {
    yawDeg,
    state: classifyFacingYaw(yawDeg),
    confidence,
    forward,
    faceConfidence,
    faceVisible: faceConfidence >= FRONT_FACE_CONFIDENCE,
    sideOrderSign: sideOrder.sign,
    sideOrderConfidence: sideOrder.confidence,
    reason: "ok",
  };
}

function updateFacingState(previousFacing, estimate, options = {}) {
  const hasPrevious = previousFacing !== undefined && previousFacing !== null;
  const previous = normalizeFacingState(previousFacing);
  const minTransitionFrames = Math.max(1, Math.trunc(Number(options.minTransitionFrames ?? DEFAULT_TRANSITION_FRAMES)));
  const lowConfidence = Number(options.lowConfidence ?? DEFAULT_LOW_CONFIDENCE);
  const timestamp = Number(options.timestamp ?? estimate?.timestamp);
  const previousTimestamp = Number(previous.timestamp);
  const elapsedMs = Number.isFinite(timestamp) && Number.isFinite(previousTimestamp)
    ? Math.max(1, timestamp - previousTimestamp)
    : DEFAULT_FRAME_INTERVAL_MS;
  const reliableEstimate = estimate?.confidence >= lowConfidence && estimate?.state !== "unknown";
  const reacquireStableFrames = Math.max(
    1,
    Math.trunc(Number(options.reacquireStableFrames ?? DEFAULT_REACQUIRE_STABLE_FRAMES)),
  );
  const unreliableYawJumpDeg = Math.max(
    1,
    Number(options.unreliableYawJumpDeg ?? DEFAULT_UNRELIABLE_YAW_JUMP_DEG),
  );
  const reacquireMatchDeg = Math.max(
    1,
    Number(options.reacquireMatchDeg ?? DEFAULT_REACQUIRE_MATCH_DEG),
  );
  const rawEstimateYawDeg = Number(estimate?.yawDeg);
  const previousRecoveryTargetYawDeg = optionalNumber(previous.recoveryTargetYawDeg);
  const useRecoveryHypothesis = reliableEstimate &&
    Number.isFinite(rawEstimateYawDeg) &&
    Number.isFinite(previousRecoveryTargetYawDeg) &&
    Math.abs(unwrapAngleDeg(rawEstimateYawDeg, previousRecoveryTargetYawDeg) - previousRecoveryTargetYawDeg) <= reacquireMatchDeg;
  const observedYaw = reliableEstimate
    ? useRecoveryHypothesis
      ? normalizeAngleDeg(rawEstimateYawDeg)
      : chooseYawHypothesis(rawEstimateYawDeg, previous, estimate, hasPrevious)
    : previous.yawDeg;
  const unwrappedObservedYaw = reliableEstimate
    ? unwrapAngleDeg(observedYaw, previous.unwrappedYawDeg)
    : previous.unwrappedYawDeg;
  const rawYawDeltaDeg = reliableEstimate
    ? unwrappedObservedYaw - previous.unwrappedYawDeg
    : 0;
  const observedSideOrderSign = reliableEstimate && Number.isFinite(Number(estimate?.sideOrderSign))
    ? Math.sign(Number(estimate.sideOrderSign))
    : previous.sideOrderSign;
  const observedSideOrderConfidence = Number.isFinite(Number(estimate?.sideOrderConfidence))
    ? Number(estimate.sideOrderConfidence)
    : previous.sideOrderConfidence;
  const sideOrderFlip = reliableEstimate &&
    observedSideOrderConfidence >= lowConfidence &&
    Math.abs(previous.sideOrderSign) === 1 &&
    Math.abs(observedSideOrderSign) === 1 &&
    previous.sideOrderSign !== observedSideOrderSign;
  const rawYawJump = !useRecoveryHypothesis && Math.abs(rawYawDeltaDeg) > unreliableYawJumpDeg;
  const unstableYawCandidate = hasPrevious && reliableEstimate && !useRecoveryHypothesis && (rawYawJump || sideOrderFlip);
  const previousUnstableCandidate = optionalNumber(previous.unstableYawCandidateDeg);
  const unstableCandidateMatches = unstableYawCandidate &&
    Number.isFinite(previousUnstableCandidate) &&
    Math.abs(unwrappedObservedYaw - previousUnstableCandidate) <= reacquireMatchDeg;
  const unstableYawCandidateFrames = unstableYawCandidate
    ? unstableCandidateMatches
      ? previous.unstableYawCandidateFrames + 1
      : 1
    : 0;
  const acceptUnstableYawCandidate = unstableYawCandidate &&
    unstableYawCandidateFrames >= reacquireStableFrames;
  const holdYawUnreliable = !reliableEstimate || (unstableYawCandidate && !acceptUnstableYawCandidate);
  const maxYawRateDegPerSec = Number(options.maxYawRateDegPerSec ?? DEFAULT_MAX_YAW_RATE_DEG_PER_SEC);
  const maxYawDeltaDeg = Math.max(1, (elapsedMs / 1000) * maxYawRateDegPerSec);
  const limitedYawDeltaDeg = holdYawUnreliable ? 0 : clamp(rawYawDeltaDeg, -maxYawDeltaDeg, maxYawDeltaDeg);
  const unwrappedYawDeg = hasPrevious
    ? previous.unwrappedYawDeg + limitedYawDeltaDeg
    : Number.isFinite(Number(estimate?.yawDeg))
      ? Number(estimate.yawDeg)
      : previous.unwrappedYawDeg;
  const yawDeg = normalizeAngleDeg(unwrappedYawDeg);
  const candidateState = reliableEstimate && !holdYawUnreliable
    ? classifyFacingYaw(yawDeg)
    : previous.state;
  const initialState = hasPrevious ? previous.state : candidateState;
  const sideOrderSign = holdYawUnreliable ? previous.sideOrderSign : observedSideOrderSign;
  const sideOrderConfidence = observedSideOrderConfidence;
  const effectiveMinTransitionFrames = sideOrderFlip
    ? Math.max(minTransitionFrames, DEFAULT_TRANSITION_FRAMES + 1)
    : minTransitionFrames;
  const candidateFrames = candidateState === previous.state
    ? 0
    : candidateState === previous.candidateState
      ? previous.candidateFrames + 1
      : 1;
  const shouldSwitch = candidateState !== previous.state &&
    (candidateFrames >= effectiveMinTransitionFrames || previous.state === "unknown" || !hasPrevious);
  const state = shouldSwitch ? candidateState : initialState;
  const recoveringFromUnreliableYaw = !holdYawUnreliable &&
    reliableEstimate &&
    previous.unreliableYawFrames > 0 &&
    acceptUnstableYawCandidate;
  const yawReliable = reliableEstimate && !holdYawUnreliable;
  const yawReliabilityReason = yawReliable
    ? recoveringFromUnreliableYaw
      ? "recovered"
      : "stable"
    : unstableYawCandidate
      ? "unstable_yaw_candidate"
      : estimate?.reason ?? "unreliable";
  const lastReliableYawDeg = yawReliable
    ? unwrappedYawDeg
    : Number.isFinite(Number(previous.lastReliableYawDeg))
      ? previous.lastReliableYawDeg
      : previous.unwrappedYawDeg;
  const recoveryTargetYawDeg = resolveRecoveryTargetYaw({
    acceptUnstableYawCandidate,
    holdYawUnreliable,
    previousRecoveryTargetYawDeg,
    unwrappedObservedYaw,
    unwrappedYawDeg,
    useRecoveryHypothesis,
  });

  return {
    state,
    legacyState: toLegacyFacing(state),
    yawDeg: round(yawDeg, 3),
    unwrappedYawDeg: round(unwrappedYawDeg, 3),
    rawYawDeg: Number.isFinite(Number(estimate?.yawDeg)) ? round(Number(estimate.yawDeg), 3) : previous.rawYawDeg,
    rawYawDeltaDeg: round(rawYawDeltaDeg, 3),
    limitedYawDeltaDeg: round(limitedYawDeltaDeg, 3),
    rawYawJump,
    yawFlipCount: previous.yawFlipCount + (rawYawJump ? 1 : 0),
    sideOrderSign,
    sideOrderConfidence: round(sideOrderConfidence, 3),
    sideOrderFlip,
    yawReliable,
    yawReliabilityReason,
    unreliableYawFrames: holdYawUnreliable ? previous.unreliableYawFrames + 1 : 0,
    stableYawFrames: yawReliable ? previous.stableYawFrames + 1 : 0,
    recoveringFromUnreliableYaw,
    lastReliableYawDeg: round(lastReliableYawDeg, 3),
    recoveryTargetYawDeg: Number.isFinite(recoveryTargetYawDeg) ? round(recoveryTargetYawDeg, 3) : null,
    unstableYawCandidateDeg: holdYawUnreliable && unstableYawCandidate
      ? round(unwrappedObservedYaw, 3)
      : null,
    unstableYawCandidateFrames: holdYawUnreliable && unstableYawCandidate ? unstableYawCandidateFrames : 0,
    confidence: round(Number.isFinite(Number(estimate?.confidence)) ? Number(estimate.confidence) : previous.confidence, 3),
    candidateState: shouldSwitch ? state : candidateState,
    candidateFrames: shouldSwitch ? 0 : candidateFrames,
    reason: estimate?.reason ?? "unknown",
    timestamp: Number.isFinite(timestamp) ? timestamp : previous.timestamp,
  };
}

function normalizeFacingState(value) {
  if (value && typeof value === "object") {
    const state = normalizeFacingToken(value.state ?? value.legacyState);
    return {
      state,
      legacyState: toLegacyFacing(state),
      yawDeg: Number.isFinite(Number(value.yawDeg)) ? Number(value.yawDeg) : 0,
      unwrappedYawDeg: Number.isFinite(Number(value.unwrappedYawDeg))
        ? Number(value.unwrappedYawDeg)
        : Number.isFinite(Number(value.yawDeg))
          ? Number(value.yawDeg)
          : 0,
      rawYawDeg: Number.isFinite(Number(value.rawYawDeg))
        ? Number(value.rawYawDeg)
        : Number.isFinite(Number(value.yawDeg))
          ? Number(value.yawDeg)
          : 0,
      rawYawDeltaDeg: Number.isFinite(Number(value.rawYawDeltaDeg)) ? Number(value.rawYawDeltaDeg) : 0,
      limitedYawDeltaDeg: Number.isFinite(Number(value.limitedYawDeltaDeg)) ? Number(value.limitedYawDeltaDeg) : 0,
      rawYawJump: Boolean(value.rawYawJump),
      yawFlipCount: Math.max(0, Math.trunc(Number(value.yawFlipCount ?? 0))),
      sideOrderSign: Number.isFinite(Number(value.sideOrderSign)) ? Math.sign(Number(value.sideOrderSign)) : 0,
      sideOrderConfidence: Number.isFinite(Number(value.sideOrderConfidence)) ? Number(value.sideOrderConfidence) : 0,
      sideOrderFlip: Boolean(value.sideOrderFlip),
      yawReliable: value.yawReliable !== false,
      yawReliabilityReason: typeof value.yawReliabilityReason === "string" ? value.yawReliabilityReason : "stable",
      unreliableYawFrames: Math.max(0, Math.trunc(Number(value.unreliableYawFrames ?? 0))),
      stableYawFrames: Math.max(0, Math.trunc(Number(value.stableYawFrames ?? 0))),
      recoveringFromUnreliableYaw: Boolean(value.recoveringFromUnreliableYaw),
      lastReliableYawDeg: Number.isFinite(Number(value.lastReliableYawDeg))
        ? Number(value.lastReliableYawDeg)
        : Number.isFinite(Number(value.unwrappedYawDeg))
          ? Number(value.unwrappedYawDeg)
          : 0,
      unstableYawCandidateDeg: optionalNumber(value.unstableYawCandidateDeg) !== null
        ? optionalNumber(value.unstableYawCandidateDeg)
        : null,
      unstableYawCandidateFrames: Math.max(0, Math.trunc(Number(value.unstableYawCandidateFrames ?? 0))),
      recoveryTargetYawDeg: optionalNumber(value.recoveryTargetYawDeg) !== null
        ? optionalNumber(value.recoveryTargetYawDeg)
        : null,
      confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
      candidateState: normalizeFacingToken(value.candidateState ?? state),
      candidateFrames: Math.max(0, Math.trunc(Number(value.candidateFrames ?? 0))),
      reason: typeof value.reason === "string" ? value.reason : "previous",
      timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : 0,
    };
  }

  const state = normalizeFacingToken(value);

  return {
    state,
    legacyState: toLegacyFacing(state),
    yawDeg: state === "back" ? 180 : 0,
    unwrappedYawDeg: state === "back" ? 180 : 0,
    rawYawDeg: state === "back" ? 180 : 0,
    rawYawDeltaDeg: 0,
    limitedYawDeltaDeg: 0,
    rawYawJump: false,
    yawFlipCount: 0,
    sideOrderSign: 0,
    sideOrderConfidence: 0,
    sideOrderFlip: false,
    yawReliable: false,
    yawReliabilityReason: "fallback",
    unreliableYawFrames: 0,
    stableYawFrames: 0,
    recoveringFromUnreliableYaw: false,
    lastReliableYawDeg: state === "back" ? 180 : 0,
    unstableYawCandidateDeg: null,
    unstableYawCandidateFrames: 0,
    recoveryTargetYawDeg: null,
    confidence: 0,
    candidateState: state,
    candidateFrames: 0,
    reason: "fallback",
    timestamp: 0,
  };
}

function normalizeFacingToken(value) {
  const normalized = String(value ?? "front").trim().toLowerCase();

  if (normalized === "back") {
    return "back";
  }
  if (normalized === "side-left" || normalized === "left") {
    return "side-left";
  }
  if (normalized === "side-right" || normalized === "right") {
    return "side-right";
  }
  if (normalized === "side") {
    return "side-left";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return "front";
}

function classifyFacingYaw(yawDeg) {
  const normalizedYaw = normalizeAngleDeg(yawDeg);
  const absYaw = Math.abs(normalizedYaw);

  if (absYaw < 60) {
    return "front";
  }
  if (absYaw > 120) {
    return "back";
  }
  return normalizedYaw >= 0 ? "side-left" : "side-right";
}

function toLegacyFacing(state) {
  if (state === "back") {
    return "back";
  }
  if (state === "side-left" || state === "side-right") {
    return "side";
  }
  if (state === "unknown") {
    return "unknown";
  }
  return "front";
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length < MIN_VECTOR_LENGTH) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function normalizeAngleDeg(value) {
  let normalized = Number(value) % 360;

  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized < -180) {
    normalized += 360;
  }

  return normalized;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function chooseYawHypothesis(rawYawDeg, previous, estimate, hasPrevious) {
  if (!hasPrevious || previous.state === "unknown") {
    return normalizeAngleDeg(rawYawDeg);
  }

  const sideOrderFlip =
    Number(estimate?.sideOrderConfidence ?? 0) >= DEFAULT_LOW_CONFIDENCE &&
    Math.abs(previous.sideOrderSign) === 1 &&
    Math.abs(estimate?.sideOrderSign) === 1 &&
    previous.sideOrderSign !== Math.sign(Number(estimate.sideOrderSign));

  if (sideOrderFlip) {
    return normalizeAngleDeg(rawYawDeg);
  }

  const hypotheses = [
    normalizeAngleDeg(rawYawDeg),
    normalizeAngleDeg(rawYawDeg + 180),
  ];
  const faceVisible = Boolean(estimate?.faceVisible);
  const scored = hypotheses.map((yawDeg) => {
    const unwrapped = unwrapAngleDeg(yawDeg, previous.unwrappedYawDeg);
    const continuityPenalty = Math.abs(unwrapped - previous.unwrappedYawDeg);
    const state = classifyFacingYaw(yawDeg);
    const facePenalty = faceVisible && state === "back" ? 90 : 0;
    return {
      yawDeg,
      score: continuityPenalty + facePenalty,
    };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored[0].yawDeg;
}

function resolveRecoveryTargetYaw({
  acceptUnstableYawCandidate,
  holdYawUnreliable,
  previousRecoveryTargetYawDeg,
  unwrappedObservedYaw,
  unwrappedYawDeg,
  useRecoveryHypothesis,
}) {
  if (acceptUnstableYawCandidate && Number.isFinite(unwrappedObservedYaw)) {
    return unwrappedObservedYaw;
  }

  if (!Number.isFinite(previousRecoveryTargetYawDeg)) {
    return null;
  }

  if (holdYawUnreliable) {
    return previousRecoveryTargetYawDeg;
  }

  if (
    useRecoveryHypothesis &&
    Math.abs(unwrappedYawDeg - previousRecoveryTargetYawDeg) > 1
  ) {
    return previousRecoveryTargetYawDeg;
  }

  return null;
}

function unwrapAngleDeg(yawDeg, referenceYawDeg = 0) {
  const normalized = normalizeAngleDeg(yawDeg);
  const reference = Number.isFinite(Number(referenceYawDeg)) ? Number(referenceYawDeg) : 0;
  return reference + normalizeAngleDeg(normalized - normalizeAngleDeg(reference));
}

function estimateSideOrder(points) {
  const leftShoulder = points?.imageLeftShoulder ?? points?.leftShoulder;
  const rightShoulder = points?.imageRightShoulder ?? points?.rightShoulder;
  const leftHip = points?.imageLeftHip ?? points?.leftHip;
  const rightHip = points?.imageRightHip ?? points?.rightHip;
  const pairs = [
    [leftShoulder, rightShoulder],
    [leftHip, rightHip],
  ];
  const deltas = [];
  const confidences = [];

  for (const [left, right] of pairs) {
    if (
      !left ||
      !right ||
      !Number.isFinite(Number(left.x)) ||
      !Number.isFinite(Number(right.x))
    ) {
      continue;
    }

    const delta = Number(left.x) - Number(right.x);

    if (Math.abs(delta) >= SIDE_ORDER_MIN_DELTA) {
      deltas.push(delta);
    }

    confidences.push(Math.min(left.visibility ?? 1, right.visibility ?? 1));
  }

  const signedMagnitude = deltas.reduce((sum, delta) => sum + Math.sign(delta) * Math.abs(delta), 0);

  return {
    sign: Math.abs(signedMagnitude) >= SIDE_ORDER_MIN_DELTA ? Math.sign(signedMagnitude) : 0,
    confidence: confidences.length > 0 ? Math.min(...confidences) : 0,
  };
}

function maxVisibility(...points) {
  const values = points
    .map((point) => Number(point?.visibility))
    .filter(Number.isFinite);

  return values.length > 0 ? Math.max(...values) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}
