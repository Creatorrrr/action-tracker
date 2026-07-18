const MIN_VECTOR_LENGTH = 1e-6;
const SAME_DIRECTION_EPSILON = 1e-8;
const DEFAULT_ANTIPODAL_ENTER_DOT = -0.94;
const DEFAULT_ANTIPODAL_EXIT_DOT = -0.86;
const DEFAULT_SEMANTIC_MIN_PROJECTION = 0.2;
const DEFAULT_SEMANTIC_FULL_PROJECTION = 0.55;

export {
  resolveCausalSecondaryActivation,
  stabilizeCausalSecondaryAxis,
};

/**
 * Limits the two-axis solver to the near-antipodal region where the ordinary
 * shortest-arc aim has an underdetermined rotation axis. Separate enter/exit
 * thresholds prevent mode chatter without changing normal one-axis aiming.
 */
function resolveCausalSecondaryActivation({
  primary,
  restPrimary,
  previousActive = false,
  enterDot = DEFAULT_ANTIPODAL_ENTER_DOT,
  exitDot = DEFAULT_ANTIPODAL_EXIT_DOT,
} = {}) {
  const currentPrimary = normalizeVector(primary);
  const normalizedRestPrimary = normalizeVector(restPrimary);

  if (!currentPrimary || !normalizedRestPrimary) {
    return {
      valid: false,
      active: false,
      alignment: null,
    };
  }

  const resolvedEnterDot = finiteClampedDot(enterDot, DEFAULT_ANTIPODAL_ENTER_DOT);
  const resolvedExitDot = Math.max(
    resolvedEnterDot,
    finiteClampedDot(exitDot, DEFAULT_ANTIPODAL_EXIT_DOT),
  );
  const alignment = clamp(dotVectors(currentPrimary, normalizedRestPrimary), -1, 1);

  return {
    valid: true,
    active: previousActive
      ? alignment < resolvedExitDot
      : alignment <= resolvedEnterDot,
    alignment,
  };
}

/**
 * Carries a bone's secondary axis along the shortest rotation of its primary
 * axis. A reliable semantic pole (for example torso-up) becomes the absolute
 * gauge; near pole degeneracy the transported rest gauge takes over smoothly.
 * The returned state contains only the current sample, so callers own
 * reset/lifetime semantics.
 */
function stabilizeCausalSecondaryAxis({
  primary,
  seedSecondary = null,
  semanticSecondary = null,
  semanticMinProjection = DEFAULT_SEMANTIC_MIN_PROJECTION,
  semanticFullProjection = DEFAULT_SEMANTIC_FULL_PROJECTION,
  previousState = null,
} = {}) {
  const currentPrimary = normalizeVector(primary);

  if (!currentPrimary) {
    return invalidResult(previousState);
  }

  const previousPrimary = normalizeVector(previousState?.primary);
  const previousSecondary = previousPrimary
    ? projectOntoNormalPlane(previousState?.secondary, previousPrimary)
    : null;
  const seed = projectOntoNormalPlane(seedSecondary, currentPrimary);
  const transportedSecondary = previousPrimary && previousSecondary
    ? transportSecondaryAxis(previousPrimary, currentPrimary, previousSecondary)
    : seed;
  const semantic = projectOntoNormalPlaneWithReliability(semanticSecondary, currentPrimary);
  const minimumProjection = finiteProjectionThreshold(
    semanticMinProjection,
    DEFAULT_SEMANTIC_MIN_PROJECTION,
  );
  const fullProjection = Math.max(
    minimumProjection + SAME_DIRECTION_EPSILON,
    finiteProjectionThreshold(
      semanticFullProjection,
      DEFAULT_SEMANTIC_FULL_PROJECTION,
    ),
  );
  const semanticWeight = semantic
    ? smoothstep(minimumProjection, fullProjection, semantic.reliability)
    : 0;
  const secondary = semantic?.secondary && !transportedSecondary
    ? semantic.secondary
    : semantic?.secondary && semanticWeight > 0
      ? interpolateSecondaryAroundPrimary(
          transportedSecondary,
          semantic.secondary,
          currentPrimary,
          semanticWeight,
        )
      : transportedSecondary;

  if (!secondary) {
    return invalidResult(previousState);
  }

  const state = {
    primary: cloneVector(currentPrimary),
    secondary: cloneVector(secondary),
  };

  return {
    valid: true,
    primary: cloneVector(currentPrimary),
    secondary: cloneVector(secondary),
    state,
    source: semantic?.secondary && !transportedSecondary
      ? "semantic"
      : semanticWeight >= 1 - SAME_DIRECTION_EPSILON
        ? "semantic"
        : semanticWeight > 0
          ? "semantic-blend"
          : previousPrimary && previousSecondary
            ? "transported"
            : "seed",
    semanticReliability: semantic?.reliability ?? 0,
    semanticWeight,
  };
}

function projectOntoNormalPlaneWithReliability(value, normal) {
  const vector = normalizeVector(value);
  const normalizedNormal = normalizeVector(normal);

  if (!vector || !normalizedNormal) {
    return null;
  }

  const projected = subtractVectors(
    vector,
    multiplyVector(normalizedNormal, dotVectors(vector, normalizedNormal)),
  );
  const reliability = Math.hypot(projected.x, projected.y, projected.z);
  const secondary = normalizeVector(projected);

  return secondary
    ? { secondary, reliability: clamp(reliability, 0, 1) }
    : null;
}

function interpolateSecondaryAroundPrimary(from, to, primary, weight) {
  const normalizedFrom = projectOntoNormalPlane(from, primary);
  const normalizedTo = projectOntoNormalPlane(to, primary);

  if (!normalizedFrom || !normalizedTo) {
    return normalizedFrom ?? normalizedTo;
  }

  const cosine = clamp(dotVectors(normalizedFrom, normalizedTo), -1, 1);
  const sine = dotVectors(primary, crossVectors(normalizedFrom, normalizedTo));
  const angle = Math.atan2(sine, cosine) * clamp(weight, 0, 1);
  const cosineStep = Math.cos(angle);
  const sineStep = Math.sin(angle);
  const rotated = addVectors(
    multiplyVector(normalizedFrom, cosineStep),
    multiplyVector(crossVectors(primary, normalizedFrom), sineStep),
  );

  return projectOntoNormalPlane(rotated, primary);
}

function transportSecondaryAxis(previousPrimary, currentPrimary, previousSecondary) {
  const alignment = clamp(dotVectors(previousPrimary, currentPrimary), -1, 1);

  if (alignment >= 1 - SAME_DIRECTION_EPSILON || alignment <= -1 + SAME_DIRECTION_EPSILON) {
    return projectOntoNormalPlane(previousSecondary, currentPrimary);
  }

  const cross = crossVectors(previousPrimary, currentPrimary);
  const quaternion = normalizeQuaternion({
    x: cross.x,
    y: cross.y,
    z: cross.z,
    w: 1 + alignment,
  });

  if (!quaternion) {
    return projectOntoNormalPlane(previousSecondary, currentPrimary);
  }

  return projectOntoNormalPlane(
    rotateVectorByQuaternion(previousSecondary, quaternion),
    currentPrimary,
  );
}

function projectOntoNormalPlane(value, normal) {
  const vector = vectorFrom(value);
  const normalizedNormal = normalizeVector(normal);

  if (!vector || !normalizedNormal) {
    return null;
  }

  const projected = subtractVectors(
    vector,
    multiplyVector(normalizedNormal, dotVectors(vector, normalizedNormal)),
  );

  return normalizeVector(projected);
}

function rotateVectorByQuaternion(vector, quaternion) {
  const qVector = { x: quaternion.x, y: quaternion.y, z: quaternion.z };
  const uv = crossVectors(qVector, vector);
  const uuv = crossVectors(qVector, uv);

  return addVectors(
    vector,
    addVectors(
      multiplyVector(uv, 2 * quaternion.w),
      multiplyVector(uuv, 2),
    ),
  );
}

function normalizeQuaternion(value) {
  const length = Math.hypot(value.x, value.y, value.z, value.w);

  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) {
    return null;
  }

  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function invalidResult(previousState) {
  return {
    valid: false,
    primary: null,
    secondary: null,
    state: previousState ?? null,
    source: "unavailable",
    semanticReliability: 0,
    semanticWeight: 0,
  };
}

function normalizeVector(value) {
  const vector = vectorFrom(value);

  if (!vector) {
    return null;
  }

  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function vectorFrom(value) {
  if (Array.isArray(value) && value.length >= 3) {
    const vector = {
      x: Number(value[0]),
      y: Number(value[1]),
      z: Number(value[2]),
    };
    return finiteVector(vector) ? vector : null;
  }

  if (value && typeof value === "object") {
    const vector = {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
    };
    return finiteVector(vector) ? vector : null;
  }

  return null;
}

function finiteVector(value) {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function cloneVector(value) {
  return { x: value.x, y: value.y, z: value.z };
}

function dotVectors(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVectors(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function addVectors(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVectors(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function multiplyVector(value, scalar) {
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteClampedDot(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, -1, 1) : fallback;
}

function finiteProjectionThreshold(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : fallback;
}

function smoothstep(edge0, edge1, value) {
  const ratio = clamp((value - edge0) / Math.max(SAME_DIRECTION_EPSILON, edge1 - edge0), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}
