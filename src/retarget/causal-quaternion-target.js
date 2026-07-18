const MIN_QUATERNION_LENGTH = 1e-8;
const DEFAULT_TRACKING_GRACE_MS = 180;
const DEFAULT_JUMP_THRESHOLD_DEG = 105;
const DEFAULT_PENDING_CONSISTENCY_DEG = 25;
const DEFAULT_JUMP_CONFIRMATION_FRAMES = 2;
const DEFAULT_MAX_ANGULAR_VELOCITY_DEG_PER_SEC = 1080;

export function createCausalQuaternionTargetState() {
  return {
    lastRotation: null,
    acceptedTargetRotation: null,
    lastFrameAt: null,
    lastObservationAt: null,
    pendingRotation: null,
    pendingCount: 0,
  };
}

export function resetCausalQuaternionTargetState(state) {
  state.lastRotation = null;
  state.acceptedTargetRotation = null;
  state.lastFrameAt = null;
  state.lastObservationAt = null;
  state.pendingRotation = null;
  state.pendingCount = 0;
}

export function transportCausalQuaternionTargetState(
  state,
  transportedRotation,
  timestampMs = 0,
  { preservePending = false } = {},
) {
  const rotation = normalizeQuaternion(transportedRotation);

  if (!rotation) {
    return false;
  }

  state.lastRotation = cloneQuaternion(rotation);
  state.acceptedTargetRotation = cloneQuaternion(rotation);
  state.lastFrameAt = Number.isFinite(timestampMs) ? timestampMs : 0;
  if (!preservePending) {
    state.pendingRotation = null;
    state.pendingCount = 0;
  }
  return true;
}

export function transportCausalQuaternionTargetStateByDelta(state, deltaRotation) {
  const delta = normalizeQuaternion(deltaRotation);

  if (!delta) {
    return false;
  }

  for (const key of ["lastRotation", "acceptedTargetRotation", "pendingRotation"]) {
    const rotation = normalizeQuaternion(state[key]);

    if (rotation) {
      state[key] = multiplyQuaternions(delta, rotation);
    }
  }

  return true;
}

export function updateCausalQuaternionTarget(
  state,
  candidate,
  timestampMs = 0,
  {
    trackingGraceMs = DEFAULT_TRACKING_GRACE_MS,
    jumpThresholdDeg = DEFAULT_JUMP_THRESHOLD_DEG,
    pendingConsistencyDeg = DEFAULT_PENDING_CONSISTENCY_DEG,
    jumpConfirmationFrames = DEFAULT_JUMP_CONFIRMATION_FRAMES,
    maxAngularVelocityDegPerSec = DEFAULT_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
  } = {},
) {
  const now = Number.isFinite(timestampMs) ? timestampMs : 0;
  const normalizedCandidate = normalizeQuaternion(candidate);

  if (!normalizedCandidate) {
    const gapMs = Number.isFinite(state.lastObservationAt)
      ? Math.max(0, now - state.lastObservationAt)
      : Infinity;
    const withinGrace = Boolean(
      state.lastRotation && gapMs <= Math.max(0, trackingGraceMs),
    );

    state.lastFrameAt = now;
    state.pendingRotation = null;
    state.pendingCount = 0;
    return {
      apply: withinGrace,
      tracked: false,
      withinGrace,
      status: withinGrace ? "missing-hold" : "missing",
      rotation: withinGrace ? cloneQuaternion(state.lastRotation) : null,
      gapMs,
      rawDeltaDeg: null,
      appliedDeltaDeg: 0,
      pendingCount: 0,
    };
  }

  state.lastObservationAt = now;

  if (!state.lastRotation) {
    state.lastRotation = cloneQuaternion(normalizedCandidate);
    state.acceptedTargetRotation = cloneQuaternion(normalizedCandidate);
    state.lastFrameAt = now;
    return {
      apply: true,
      tracked: true,
      withinGrace: false,
      status: "initialized",
      rotation: cloneQuaternion(state.lastRotation),
      gapMs: 0,
      rawDeltaDeg: 0,
      appliedDeltaDeg: 0,
      pendingCount: 0,
    };
  }

  const acceptedTarget = state.acceptedTargetRotation ?? state.lastRotation;
  const rawDeltaDeg = quaternionAngleDeg(acceptedTarget, normalizedCandidate);
  const jumpThreshold = finiteNonnegative(jumpThresholdDeg, DEFAULT_JUMP_THRESHOLD_DEG);
  let status = "tracked";

  if (rawDeltaDeg > jumpThreshold) {
    const pendingDeltaDeg = state.pendingRotation
      ? quaternionAngleDeg(state.pendingRotation, normalizedCandidate)
      : Infinity;
    const consistencyThreshold = finiteNonnegative(
      pendingConsistencyDeg,
      DEFAULT_PENDING_CONSISTENCY_DEG,
    );

    if (pendingDeltaDeg <= consistencyThreshold) {
      state.pendingCount += 1;
      state.pendingRotation = cloneQuaternion(normalizedCandidate);
    } else {
      state.pendingRotation = cloneQuaternion(normalizedCandidate);
      state.pendingCount = 1;
    }

    const confirmationFrames = Math.max(
      1,
      Math.trunc(
        finiteNonnegative(
          jumpConfirmationFrames,
          DEFAULT_JUMP_CONFIRMATION_FRAMES,
        ),
      ),
    );

    if (state.pendingCount < confirmationFrames) {
      state.lastFrameAt = now;
      return {
        apply: true,
        tracked: false,
        withinGrace: true,
        status: "jump-hold",
        rotation: cloneQuaternion(state.lastRotation),
        gapMs: 0,
        rawDeltaDeg,
        appliedDeltaDeg: 0,
        pendingCount: state.pendingCount,
      };
    }

    state.acceptedTargetRotation = cloneQuaternion(state.pendingRotation);
    status = "jump-confirmed";
  } else {
    state.acceptedTargetRotation = cloneQuaternion(normalizedCandidate);
  }

  state.pendingRotation = null;
  state.pendingCount = 0;
  const frameDeltaMs = Number.isFinite(state.lastFrameAt)
    ? Math.max(1, now - state.lastFrameAt)
    : 1000 / 60;
  const maxVelocity = finiteNonnegative(
    maxAngularVelocityDegPerSec,
    DEFAULT_MAX_ANGULAR_VELOCITY_DEG_PER_SEC,
  );
  const maximumStepDeg = maxVelocity * frameDeltaMs / 1000;
  const target = state.acceptedTargetRotation;
  const targetDeltaDeg = quaternionAngleDeg(state.lastRotation, target);
  const blend = targetDeltaDeg > maximumStepDeg && maximumStepDeg > 0
    ? maximumStepDeg / targetDeltaDeg
    : 1;
  const nextRotation = slerpQuaternions(state.lastRotation, target, blend);
  const appliedDeltaDeg = quaternionAngleDeg(state.lastRotation, nextRotation);

  state.lastRotation = cloneQuaternion(nextRotation);
  state.lastFrameAt = now;
  return {
    apply: true,
    tracked: true,
    withinGrace: false,
    status: blend < 1 ? `${status}-rate-limited` : status,
    rotation: cloneQuaternion(state.lastRotation),
    gapMs: 0,
    rawDeltaDeg,
    appliedDeltaDeg,
    pendingCount: 0,
  };
}

function normalizeQuaternion(value) {
  if (!value) {
    return null;
  }

  const quaternion = Array.isArray(value)
    ? { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]), w: Number(value[3]) }
    : { x: Number(value.x), y: Number(value.y), z: Number(value.z), w: Number(value.w) };
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(length) || length < MIN_QUATERNION_LENGTH) {
    return null;
  }

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

function cloneQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function quaternionAngleDeg(left, right) {
  const dot = Math.abs(
    left.x * right.x +
    left.y * right.y +
    left.z * right.z +
    left.w * right.w,
  );
  return 2 * Math.acos(clamp(dot, -1, 1)) * 180 / Math.PI;
}

function slerpQuaternions(left, right, weight) {
  const amount = clamp(weight, 0, 1);
  let target = right;
  let cosine = (
    left.x * right.x +
    left.y * right.y +
    left.z * right.z +
    left.w * right.w
  );

  if (cosine < 0) {
    target = { x: -right.x, y: -right.y, z: -right.z, w: -right.w };
    cosine = -cosine;
  }

  if (cosine > 0.9995) {
    return normalizeQuaternion({
      x: left.x + amount * (target.x - left.x),
      y: left.y + amount * (target.y - left.y),
      z: left.z + amount * (target.z - left.z),
      w: left.w + amount * (target.w - left.w),
    });
  }

  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const leftWeight = Math.sin((1 - amount) * angle) / sine;
  const rightWeight = Math.sin(amount * angle) / sine;

  return normalizeQuaternion({
    x: left.x * leftWeight + target.x * rightWeight,
    y: left.y * leftWeight + target.y * rightWeight,
    z: left.z * leftWeight + target.z * rightWeight,
    w: left.w * leftWeight + target.w * rightWeight,
  });
}

function multiplyQuaternions(left, right) {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function finiteNonnegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
