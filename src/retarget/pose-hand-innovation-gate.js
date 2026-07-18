const MIN_QUATERNION_LENGTH = 1e-8;

export const POSE_HAND_MIN_INNOVATION_CONFIDENCE = 0.5;
// A low-confidence palm basis must not outrun the proximal arm chain that
// transports it. Reusing that physical ceiling prevents a noisy distal basis
// from introducing motion the observed shoulder/elbow chain cannot support.
export const POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC = 420;

/**
 * Rejects only fast pose-world Hand innovations whose three distal landmarks
 * are collectively low-confidence. The caller transports the previous world
 * rotation with the parent before invoking this function, so the measured
 * innovation belongs to the Hand observation rather than torso motion.
 */
export function evaluatePoseHandInnovation({
  previousRotation,
  candidateRotation,
  previousTimestampMs,
  timestampMs,
  confidence,
  minimumConfidence = POSE_HAND_MIN_INNOVATION_CONFIDENCE,
  maximumLowConfidenceRateDegPerSec =
    POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC,
} = {}) {
  const previous = normalizeQuaternion(previousRotation);
  const candidate = normalizeQuaternion(candidateRotation);
  const resolvedConfidence = normalizeConfidence(confidence);
  const confidenceThreshold = finiteNonnegative(
    minimumConfidence,
    POSE_HAND_MIN_INNOVATION_CONFIDENCE,
  );
  const rateThreshold = finiteNonnegative(
    maximumLowConfidenceRateDegPerSec,
    POSE_HAND_MAX_LOW_CONFIDENCE_INNOVATION_DEG_PER_SEC,
  );
  const previousTime = Number(previousTimestampMs);
  const currentTime = Number(timestampMs);
  const deltaMs = Number.isFinite(previousTime) && Number.isFinite(currentTime)
    ? currentTime - previousTime
    : null;

  if (!previous || !candidate) {
    return innovationResult({
      confidence: resolvedConfidence,
      confidenceThreshold,
      rateThreshold,
      deltaMs,
      reason: "rotation-unavailable",
    });
  }

  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    return innovationResult({
      confidence: resolvedConfidence,
      confidenceThreshold,
      rateThreshold,
      deltaMs,
      reason: "source-delta-unavailable",
    });
  }

  const innovationDeg = quaternionAngleDeg(previous, candidate);
  const innovationRateDegPerSec = innovationDeg * 1000 / deltaMs;
  const lowConfidence = resolvedConfidence < confidenceThreshold;
  const hold = lowConfidence && innovationRateDegPerSec > rateThreshold;

  return innovationResult({
    hold,
    confidence: resolvedConfidence,
    confidenceThreshold,
    lowConfidence,
    rateThreshold,
    deltaMs,
    innovationDeg,
    innovationRateDegPerSec,
    reason: hold ? "low-confidence-rate" : "accepted",
  });
}

function innovationResult({
  hold = false,
  confidence,
  confidenceThreshold,
  lowConfidence = false,
  rateThreshold,
  deltaMs = null,
  innovationDeg = null,
  innovationRateDegPerSec = null,
  reason,
}) {
  return {
    hold,
    reason,
    confidence,
    confidenceThreshold,
    lowConfidence,
    maximumLowConfidenceRateDegPerSec: rateThreshold,
    deltaMs: Number.isFinite(deltaMs) ? deltaMs : null,
    innovationDeg: Number.isFinite(innovationDeg) ? innovationDeg : null,
    innovationRateDegPerSec: Number.isFinite(innovationRateDegPerSec)
      ? innovationRateDegPerSec
      : null,
  };
}

function normalizeQuaternion(value) {
  if (!value) {
    return null;
  }

  const quaternion = Array.isArray(value)
    ? {
        x: Number(value[0]),
        y: Number(value[1]),
        z: Number(value[2]),
        w: Number(value[3]),
      }
    : {
        x: Number(value.x),
        y: Number(value.y),
        z: Number(value.z),
        w: Number(value.w),
      };
  const length = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w,
  );

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

function quaternionAngleDeg(left, right) {
  const dot = Math.abs(
    left.x * right.x +
    left.y * right.y +
    left.z * right.z +
    left.w * right.w,
  );
  return 2 * Math.acos(clamp(dot, -1, 1)) * 180 / Math.PI;
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 1;
}

function finiteNonnegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
