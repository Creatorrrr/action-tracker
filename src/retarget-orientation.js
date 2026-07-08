const MIN_VECTOR_LENGTH = 0.000001;
const DEFAULT_AVATAR_YAW_SIGN = -1;
const DEFAULT_PALM_NORMAL_SIGNS = Object.freeze({
  Left: 1,
  Right: -1,
});

export {
  DEFAULT_AVATAR_YAW_SIGN,
  DEFAULT_PALM_NORMAL_SIGNS,
  computePlaneNormal,
  resolveAvatarYawDeg,
  resolveHandPalmNormal,
};

function resolveHandPalmNormal({ wrist, indexBase, pinkyBase, side, normalSigns = DEFAULT_PALM_NORMAL_SIGNS } = {}) {
  const rawNormal = computePlaneNormal(wrist, indexBase, pinkyBase);
  const sign = normalizeNormalSign(normalSigns?.[side], -1);

  if (!rawNormal) {
    return {
      normal: null,
      rawNormal: null,
      sign,
      side: normalizeSide(side),
      valid: false,
    };
  }

  return {
    normal: scaleVector(rawNormal, sign),
    rawNormal,
    sign,
    side: normalizeSide(side),
    valid: true,
  };
}

function computePlaneNormal(origin, first, second) {
  if (!isPoint(origin) || !isPoint(first) || !isPoint(second)) {
    return null;
  }

  const firstVector = subtract(first, origin);
  const secondVector = subtract(second, origin);
  return normalize(cross(firstVector, secondVector));
}

function resolveAvatarYawDeg(sourceYawDeg, sign = DEFAULT_AVATAR_YAW_SIGN) {
  const yaw = Number(sourceYawDeg);
  const yawSign = normalizeNormalSign(sign, DEFAULT_AVATAR_YAW_SIGN);

  if (!Number.isFinite(yaw)) {
    return null;
  }

  return normalizeAngleDeg(yaw * yawSign);
}

function normalizeSide(side) {
  return side === "Left" || side === "Right" ? side : "Unknown";
}

function normalizeNormalSign(value, fallback) {
  const sign = Math.sign(Number(value));
  return sign === 0 ? fallback : sign;
}

function isPoint(point) {
  return Boolean(
    point &&
    Number.isFinite(Number(point.x)) &&
    Number.isFinite(Number(point.y)) &&
    Number.isFinite(Number(point.z)),
  );
}

function subtract(a, b) {
  return {
    x: Number(a.x) - Number(b.x),
    y: Number(a.y) - Number(b.y),
    z: Number(a.z) - Number(b.z),
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

function scaleVector(vector, sign) {
  return {
    x: vector.x * sign,
    y: vector.y * sign,
    z: vector.z * sign,
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
