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
  resolveHandOrientationBasis,
  resolveHandPalmNormal,
  resolvePoseHandOrientationBasis,
};

function resolvePoseHandOrientationBasis({
  wrist,
  indexBase,
  pinkyBase,
  side,
  normalSigns = DEFAULT_PALM_NORMAL_SIGNS,
  reflectionParity = 1,
} = {}) {
  const orientation = resolveHandPalmNormal({
    wrist,
    indexBase,
    pinkyBase,
    side,
    normalSigns,
  });
  const palmCenter = midpoint(indexBase, pinkyBase);
  const primary = isPoint(wrist) && palmCenter
    ? normalize(subtract(palmCenter, wrist))
    : null;
  const parity = normalizeNormalSign(reflectionParity, 1);
  const normal = orientation.normal
    ? scaleVector(orientation.normal, parity)
    : null;

  return {
    ...orientation,
    normal,
    primary,
    primaryValid: Boolean(primary),
    valid: Boolean(primary && normal),
    source: primary && normal ? "pose-world-basis" : "none",
    reflectionParity: parity,
  };
}

function resolveHandOrientationBasis({
  imagePoints,
  worldPoints,
  side,
  normalSigns = DEFAULT_PALM_NORMAL_SIGNS,
  reflectionParity = 1,
} = {}) {
  const parity = normalizeNormalSign(reflectionParity, 1);
  const worldBasis = buildHandOrientationBasis(
    worldPoints,
    side,
    normalSigns,
    "world-basis",
    parity,
  );

  if (worldBasis.valid) {
    return worldBasis;
  }

  const imageBasis = buildHandOrientationBasis(
    imagePoints,
    side,
    normalSigns,
    "image-basis",
    parity,
  );

  if (imageBasis.primaryValid) {
    return imageBasis;
  }

  return {
    ...imageBasis,
    normal: null,
    rawNormal: null,
    valid: false,
    source: "none",
  };
}

function buildHandOrientationBasis(points, side, normalSigns, source, reflectionParity) {
  const wrist = points?.[0];
  const middleBase = points?.[9];
  const orientation = resolveHandPalmNormal({
    wrist,
    indexBase: points?.[5],
    pinkyBase: points?.[17],
    side,
    normalSigns,
  });
  const primary = isPoint(wrist) && isPoint(middleBase)
    ? normalize(subtract(middleBase, wrist))
    : null;
  const normal = orientation.normal
    ? scaleVector(orientation.normal, reflectionParity)
    : null;
  const primaryValid = Boolean(primary);

  return {
    ...orientation,
    normal,
    primary,
    primaryValid,
    valid: primaryValid && Boolean(normal),
    source,
    reflectionParity,
  };
}

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

function midpoint(a, b) {
  if (!isPoint(a) || !isPoint(b)) {
    return null;
  }

  return {
    x: (Number(a.x) + Number(b.x)) * 0.5,
    y: (Number(a.y) + Number(b.y)) * 0.5,
    z: (Number(a.z) + Number(b.z)) * 0.5,
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
