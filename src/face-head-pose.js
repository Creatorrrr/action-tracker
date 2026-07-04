const DEFAULT_TRACKING_GRACE_MS = 400;
const DEFAULT_REACQUIRE_BLEND_MS = 260;
const TRANSLATION_LAYOUT_RATIO = 4;
const TRANSLATION_LAYOUT_EPSILON = 0.0001;

export function createFaceHeadPoseTrackerState() {
  return {
    baseQuaternion: null,
    lastQuaternion: null,
    lastSeenAt: null,
    missingSinceAt: null,
    reacquiredAt: null,
    resetCount: 0,
    reacquireCount: 0,
  };
}

export function resetFaceHeadPoseTrackerState(state) {
  state.baseQuaternion = null;
  state.lastQuaternion = null;
  state.lastSeenAt = null;
  state.missingSinceAt = null;
  state.reacquiredAt = null;
  state.resetCount += 1;
}

export function updateFaceHeadPoseTracker(
  state,
  sourceQuaternion,
  timestampMs = 0,
  {
    trackingGraceMs = DEFAULT_TRACKING_GRACE_MS,
    reacquireBlendMs = DEFAULT_REACQUIRE_BLEND_MS,
  } = {},
) {
  const now = Number.isFinite(timestampMs) ? timestampMs : 0;

  if (!isQuaternionLike(sourceQuaternion)) {
    if (state.missingSinceAt === null) {
      state.missingSinceAt = now;
    }

    const lastSeenAt = Number.isFinite(state.lastSeenAt) ? state.lastSeenAt : null;
    const gapMs = lastSeenAt === null ? Infinity : Math.max(0, now - lastSeenAt);
    const withinGrace = gapMs <= trackingGraceMs && isQuaternionLike(state.lastQuaternion);

    return {
      status: withinGrace ? "holding" : "missing",
      apply: withinGrace,
      tracked: false,
      withinGrace,
      sourceQuaternion: withinGrace ? cloneQuaternion(state.lastQuaternion) : null,
      gapMs,
      reacquireBlend: withinGrace ? 1 : 0,
    };
  }

  const normalizedSource = normalizeQuaternion(sourceQuaternion);

  if (!isQuaternionLike(state.baseQuaternion)) {
    state.baseQuaternion = cloneQuaternion(normalizedSource);
    state.lastQuaternion = cloneQuaternion(normalizedSource);
    state.lastSeenAt = now;
    state.missingSinceAt = null;
    state.reacquiredAt = null;

    return {
      status: "initialized",
      apply: false,
      tracked: true,
      withinGrace: false,
      sourceQuaternion: cloneQuaternion(normalizedSource),
      gapMs: 0,
      reacquireBlend: 0,
    };
  }

  const wasMissing = state.missingSinceAt !== null;
  const previousLastSeenAt = Number.isFinite(state.lastSeenAt) ? state.lastSeenAt : now;
  const gapMs = Math.max(0, now - previousLastSeenAt);
  let status = "tracked";

  if (wasMissing && gapMs > trackingGraceMs) {
    state.reacquiredAt = now;
    state.reacquireCount += 1;
    status = "reacquired";
  }

  state.lastQuaternion = cloneQuaternion(normalizedSource);
  state.lastSeenAt = now;
  state.missingSinceAt = null;

  const reacquireBlend = Number.isFinite(state.reacquiredAt)
    ? clamp01((now - state.reacquiredAt) / Math.max(1, reacquireBlendMs))
    : 1;

  if (reacquireBlend >= 1) {
    state.reacquiredAt = null;
  }

  return {
    status,
    apply: true,
    tracked: true,
    withinGrace: false,
    sourceQuaternion: cloneQuaternion(normalizedSource),
    gapMs,
    reacquireBlend,
  };
}

export function readFaceTransformQuaternion(transformMatrix, {
  preferredLayout = "column-major",
} = {}) {
  if (!Array.isArray(transformMatrix) || transformMatrix.length !== 16) {
    return invalidFaceTransform("invalid-length");
  }

  if (transformMatrix.some((entry) => !Number.isFinite(entry))) {
    return invalidFaceTransform("non-finite");
  }

  const diagnostics = analyzeFaceTransformMatrixLayout(transformMatrix);
  const layout = diagnostics.layout === "ambiguous" ? preferredLayout : diagnostics.layout;
  const rotation = layout === "row-major"
    ? rowMajorRotation(transformMatrix)
    : columnMajorRotation(transformMatrix);

  return {
    valid: true,
    layout,
    diagnostics,
    quaternion: quaternionFromRotationMatrix(rotation),
  };
}

export function analyzeFaceTransformMatrixLayout(transformMatrix) {
  const rowTranslationMagnitude = vectorLength(
    transformMatrix[3],
    transformMatrix[7],
    transformMatrix[11],
  );
  const columnTranslationMagnitude = vectorLength(
    transformMatrix[12],
    transformMatrix[13],
    transformMatrix[14],
  );
  let layout = "ambiguous";

  if (
    columnTranslationMagnitude > TRANSLATION_LAYOUT_EPSILON &&
    columnTranslationMagnitude >= rowTranslationMagnitude * TRANSLATION_LAYOUT_RATIO
  ) {
    layout = "column-major";
  } else if (
    rowTranslationMagnitude > TRANSLATION_LAYOUT_EPSILON &&
    rowTranslationMagnitude >= columnTranslationMagnitude * TRANSLATION_LAYOUT_RATIO
  ) {
    layout = "row-major";
  }

  return {
    layout,
    rowTranslationMagnitude,
    columnTranslationMagnitude,
    rowTranslation: [transformMatrix[3], transformMatrix[7], transformMatrix[11]],
    columnTranslation: [transformMatrix[12], transformMatrix[13], transformMatrix[14]],
  };
}

export function computeFaceHeadDelta({
  baseQuaternion,
  sourceQuaternion,
  mirrored = false,
  maxAngleRad = Math.PI,
} = {}) {
  if (!isQuaternionLike(baseQuaternion) || !isQuaternionLike(sourceQuaternion)) {
    return {
      valid: false,
      eulerRad: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
    };
  }

  const relativeQuaternion = multiplyQuaternions(
    invertQuaternion(normalizeQuaternion(baseQuaternion)),
    normalizeQuaternion(sourceQuaternion),
  );
  const euler = eulerYXZFromQuaternion(relativeQuaternion);
  const pitch = clamp(euler.x, -maxAngleRad, maxAngleRad);
  const yaw = clamp(mirrored ? -euler.y : euler.y, -maxAngleRad, maxAngleRad);
  const roll = clamp(mirrored ? -euler.z : euler.z, -maxAngleRad, maxAngleRad);

  return {
    valid: true,
    eulerRad: { x: pitch, y: yaw, z: roll },
    quaternion: quaternionFromEulerYXZ({ x: pitch, y: yaw, z: roll }),
  };
}

export function quaternionFromEulerYXZ({ x = 0, y = 0, z = 0 } = {}) {
  const c1 = Math.cos(x / 2);
  const c2 = Math.cos(y / 2);
  const c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2);
  const s2 = Math.sin(y / 2);
  const s3 = Math.sin(z / 2);

  return normalizeQuaternion({
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  });
}

export function eulerYXZFromQuaternion(quaternion) {
  const q = normalizeQuaternion(quaternion);
  const matrix = rotationMatrixFromQuaternion(q);
  const m11 = matrix[0];
  const m13 = matrix[2];
  const m21 = matrix[3];
  const m22 = matrix[4];
  const m23 = matrix[5];
  const m31 = matrix[6];
  const m33 = matrix[8];
  const x = Math.asin(-clamp(m23, -1, 1));

  if (Math.abs(m23) < 0.9999999) {
    return {
      x,
      y: Math.atan2(m13, m33),
      z: Math.atan2(m21, m22),
    };
  }

  return {
    x,
    y: Math.atan2(-m31, m11),
    z: 0,
  };
}

export function cloneQuaternion(quaternion) {
  return {
    x: quaternion.x,
    y: quaternion.y,
    z: quaternion.z,
    w: quaternion.w,
  };
}

function invalidFaceTransform(reason) {
  return {
    valid: false,
    reason,
    layout: "invalid",
    diagnostics: null,
    quaternion: null,
  };
}

function columnMajorRotation(values) {
  return [
    values[0], values[4], values[8],
    values[1], values[5], values[9],
    values[2], values[6], values[10],
  ];
}

function rowMajorRotation(values) {
  return [
    values[0], values[1], values[2],
    values[4], values[5], values[6],
    values[8], values[9], values[10],
  ];
}

function quaternionFromRotationMatrix(matrix) {
  const m11 = matrix[0];
  const m12 = matrix[1];
  const m13 = matrix[2];
  const m21 = matrix[3];
  const m22 = matrix[4];
  const m23 = matrix[5];
  const m31 = matrix[6];
  const m32 = matrix[7];
  const m33 = matrix[8];
  const trace = m11 + m22 + m33;
  let x;
  let y;
  let z;
  let w;

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m32 - m23) * s;
    y = (m13 - m31) * s;
    z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    w = (m32 - m23) / s;
    x = 0.25 * s;
    y = (m12 + m21) / s;
    z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    w = (m13 - m31) / s;
    x = (m12 + m21) / s;
    y = 0.25 * s;
    z = (m23 + m32) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
    w = (m21 - m12) / s;
    x = (m13 + m31) / s;
    y = (m23 + m32) / s;
    z = 0.25 * s;
  }

  return normalizeQuaternion({ x, y, z, w });
}

function rotationMatrixFromQuaternion(quaternion) {
  const { x, y, z, w } = quaternion;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  return [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
}

function multiplyQuaternions(a, b) {
  return normalizeQuaternion({
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}

function invertQuaternion(quaternion) {
  const lengthSq = quaternion.x * quaternion.x +
    quaternion.y * quaternion.y +
    quaternion.z * quaternion.z +
    quaternion.w * quaternion.w;

  if (lengthSq <= 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: -quaternion.x / lengthSq,
    y: -quaternion.y / lengthSq,
    z: -quaternion.z / lengthSq,
    w: quaternion.w / lengthSq,
  };
}

function normalizeQuaternion(quaternion) {
  if (!isQuaternionLike(quaternion)) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (length <= 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

function isQuaternionLike(value) {
  return Number.isFinite(value?.x) &&
    Number.isFinite(value?.y) &&
    Number.isFinite(value?.z) &&
    Number.isFinite(value?.w);
}

function vectorLength(x, y, z) {
  return Math.hypot(Number(x) || 0, Number(y) || 0, Number(z) || 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}
