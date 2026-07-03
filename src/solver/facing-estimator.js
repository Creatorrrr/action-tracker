const MIN_VECTOR_LENGTH = 0.000001;
const DEFAULT_LOW_CONFIDENCE = 0.35;
const DEFAULT_TRANSITION_FRAMES = 2;

export {
  classifyFacingYaw,
  estimateFacingState,
  estimateFacingYaw,
  normalizeFacingState,
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

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return {
      yawDeg: 0,
      state: "unknown",
      confidence: 0,
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
      reason: confidence < lowConfidence ? "low_confidence" : "degenerate_torso",
    };
  }

  const forward = normalize(cross(up, across));

  if (!forward) {
    return {
      yawDeg: 0,
      state: "unknown",
      confidence,
      reason: "degenerate_forward",
    };
  }

  const yawDeg = normalizeAngleDeg(Math.atan2(-forward.x, forward.z) * (180 / Math.PI));

  return {
    yawDeg,
    state: classifyFacingYaw(yawDeg),
    confidence,
    forward,
    reason: "ok",
  };
}

function updateFacingState(previousFacing, estimate, options = {}) {
  const hasPrevious = previousFacing !== undefined && previousFacing !== null;
  const previous = normalizeFacingState(previousFacing);
  const minTransitionFrames = Math.max(1, Math.trunc(Number(options.minTransitionFrames ?? DEFAULT_TRANSITION_FRAMES)));
  const lowConfidence = Number(options.lowConfidence ?? DEFAULT_LOW_CONFIDENCE);
  const candidateState = estimate?.confidence >= lowConfidence && estimate?.state !== "unknown"
    ? estimate.state
    : previous.state;
  const initialState = hasPrevious ? previous.state : candidateState;
  const candidateFrames = candidateState === previous.state
    ? 0
    : candidateState === previous.candidateState
      ? previous.candidateFrames + 1
      : 1;
  const shouldSwitch = candidateState !== previous.state &&
    (candidateFrames >= minTransitionFrames || previous.state === "unknown" || !hasPrevious);
  const state = shouldSwitch ? candidateState : initialState;

  return {
    state,
    legacyState: toLegacyFacing(state),
    yawDeg: round(Number.isFinite(Number(estimate?.yawDeg)) ? Number(estimate.yawDeg) : previous.yawDeg, 3),
    confidence: round(Number.isFinite(Number(estimate?.confidence)) ? Number(estimate.confidence) : previous.confidence, 3),
    candidateState: shouldSwitch ? state : candidateState,
    candidateFrames: shouldSwitch ? 0 : candidateFrames,
    reason: estimate?.reason ?? "unknown",
  };
}

function normalizeFacingState(value) {
  if (value && typeof value === "object") {
    const state = normalizeFacingToken(value.state ?? value.legacyState);
    return {
      state,
      legacyState: toLegacyFacing(state),
      yawDeg: Number.isFinite(Number(value.yawDeg)) ? Number(value.yawDeg) : 0,
      confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0,
      candidateState: normalizeFacingToken(value.candidateState ?? state),
      candidateFrames: Math.max(0, Math.trunc(Number(value.candidateFrames ?? 0))),
      reason: typeof value.reason === "string" ? value.reason : "previous",
    };
  }

  const state = normalizeFacingToken(value);

  return {
    state,
    legacyState: toLegacyFacing(state),
    yawDeg: state === "back" ? 180 : 0,
    confidence: 0,
    candidateState: state,
    candidateFrames: 0,
    reason: "fallback",
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

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}
