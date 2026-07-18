export const AVATAR_APPLIED_STATE_VERSION = 1;

export const SAME_POSE_DEFAULT_THRESHOLDS = Object.freeze({
  quaternionDeg: 0.1,
  endpointHeightRatio: 0.00001,
  coverage: 1,
});

const MIN_QUATERNION_LENGTH = 1e-12;
const MIN_AVATAR_HEIGHT = 1e-12;

export function cloneAppliedAvatarStateSnapshot(snapshot) {
  return clonePlainValue(snapshot);
}

export function quaternionSignInvariantAngleDeg(reference, candidate) {
  const normalizedReference = normalizeQuaternion(reference);
  const normalizedCandidate = normalizeQuaternion(candidate);

  if (!normalizedReference || !normalizedCandidate) {
    return null;
  }

  const dot = Math.abs(
    normalizedReference[0] * normalizedCandidate[0] +
    normalizedReference[1] * normalizedCandidate[1] +
    normalizedReference[2] * normalizedCandidate[2] +
    normalizedReference[3] * normalizedCandidate[3]
  );
  const clampedDot = Math.min(1, Math.max(-1, dot));
  return (2 * Math.acos(clampedDot) * 180) / Math.PI;
}

export function endpointHeightNormalizedError(reference, candidate, avatarHeight) {
  const referencePoint = normalizeVector3(reference);
  const candidatePoint = normalizeVector3(candidate);
  const height = Number(avatarHeight);

  if (!referencePoint || !candidatePoint || !Number.isFinite(height) || height <= MIN_AVATAR_HEIGHT) {
    return null;
  }

  return Math.hypot(
    referencePoint[0] - candidatePoint[0],
    referencePoint[1] - candidatePoint[1],
    referencePoint[2] - candidatePoint[2],
  ) / height;
}

export function compareSamePoseAppliedAvatarStates(reference, candidate, options = {}) {
  const thresholds = {
    quaternionDeg: finiteOrDefault(options.quaternionDeg, SAME_POSE_DEFAULT_THRESHOLDS.quaternionDeg),
    endpointHeightRatio: finiteOrDefault(
      options.endpointHeightRatio,
      SAME_POSE_DEFAULT_THRESHOLDS.endpointHeightRatio,
    ),
    coverage: finiteOrDefault(options.coverage, SAME_POSE_DEFAULT_THRESHOLDS.coverage),
  };
  const quaternionRows = compareBoneQuaternions(reference?.bones, candidate?.bones);
  const avatarHeight = resolveAvatarHeight(reference, candidate);
  const endpointRows = compareEndpoints(reference?.fkEndpoints, candidate?.fkEndpoints, avatarHeight);
  const quaternion = summarizeComparisonRows(quaternionRows, "errorDeg", "p95Deg", "maxDeg");
  const endpoint = summarizeComparisonRows(
    endpointRows,
    "heightNormalizedError",
    "p95HeightRatio",
    "maxHeightRatio",
  );
  const quaternionWithinThreshold = quaternion.comparedCount > 0 &&
    quaternion.coverage >= thresholds.coverage &&
    quaternion.maxDeg <= thresholds.quaternionDeg;
  const endpointWithinThreshold = endpoint.comparedCount > 0 &&
    endpoint.coverage >= thresholds.coverage &&
    endpoint.maxHeightRatio <= thresholds.endpointHeightRatio;

  return {
    version: AVATAR_APPLIED_STATE_VERSION,
    passed: quaternionWithinThreshold && endpointWithinThreshold,
    thresholds,
    quaternion: {
      ...quaternion,
      unit: "degrees",
      rows: quaternionRows,
      withinThreshold: quaternionWithinThreshold,
    },
    endpoint: {
      ...endpoint,
      unit: "avatar-height-ratio",
      coordinateSpace: "model-local",
      avatarHeight,
      rows: endpointRows,
      withinThreshold: endpointWithinThreshold,
    },
    coverage: {
      bones: quaternion.coverage,
      endpoints: endpoint.coverage,
    },
  };
}

function compareBoneQuaternions(referenceBones, candidateBones) {
  return Object.entries(referenceBones ?? {})
    .filter(([, bone]) => normalizeQuaternion(bone?.localQuaternion))
    .map(([bone, reference]) => {
      const candidateQuaternion = candidateBones?.[bone]?.localQuaternion;
      const errorDeg = quaternionSignInvariantAngleDeg(reference.localQuaternion, candidateQuaternion);

      return {
        bone,
        matched: errorDeg !== null,
        errorDeg,
      };
    });
}

function compareEndpoints(referenceEndpoints, candidateEndpoints, avatarHeight) {
  return Object.entries(referenceEndpoints ?? {})
    .filter(([, endpoint]) => normalizeVector3(endpoint?.modelLocalPosition))
    .map(([endpoint, reference]) => {
      const candidatePosition = candidateEndpoints?.[endpoint]?.modelLocalPosition;
      const heightNormalizedError = endpointHeightNormalizedError(
        reference.modelLocalPosition,
        candidatePosition,
        avatarHeight,
      );

      return {
        endpoint,
        joint: reference.joint ?? null,
        matched: heightNormalizedError !== null,
        heightNormalizedError,
      };
    });
}

function summarizeComparisonRows(rows, valueKey, p95Key, maxKey) {
  const values = rows
    .map((row) => row[valueKey])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const expectedCount = rows.length;
  const comparedCount = values.length;
  const coverage = expectedCount > 0 ? comparedCount / expectedCount : 0;

  return {
    expectedCount,
    comparedCount,
    missingCount: expectedCount - comparedCount,
    coverage,
    [p95Key]: percentileFromSorted(values, 0.95),
    [maxKey]: values.length > 0 ? values[values.length - 1] : null,
  };
}

function percentileFromSorted(sortedValues, percentile) {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentile) - 1),
  );
  return sortedValues[index];
}

function resolveAvatarHeight(reference, candidate) {
  const referenceHeight = Number(reference?.modelHeight);
  if (Number.isFinite(referenceHeight) && referenceHeight > MIN_AVATAR_HEIGHT) {
    return referenceHeight;
  }

  const candidateHeight = Number(candidate?.modelHeight);
  return Number.isFinite(candidateHeight) && candidateHeight > MIN_AVATAR_HEIGHT
    ? candidateHeight
    : null;
}

function normalizeQuaternion(value) {
  const components = normalizeFiniteTuple(value, ["x", "y", "z", "w"], 4);
  if (!components) {
    return null;
  }

  const length = Math.hypot(...components);
  if (length <= MIN_QUATERNION_LENGTH) {
    return null;
  }

  return components.map((component) => component / length);
}

function normalizeVector3(value) {
  return normalizeFiniteTuple(value, ["x", "y", "z"], 3);
}

function normalizeFiniteTuple(value, keys, length) {
  const rawComponents = Array.isArray(value)
    ? value.slice(0, length)
    : keys.map((key) => value?.[key]);

  if (
    rawComponents.length !== length ||
    rawComponents.some((component) => component === null || component === undefined || component === "")
  ) {
    return null;
  }

  const components = rawComponents.map(Number);

  return components.every(Number.isFinite)
    ? components
    : null;
}

function finiteOrDefault(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function clonePlainValue(value) {
  if (Array.isArray(value)) {
    return value.map(clonePlainValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, clonePlainValue(entry)]),
    );
  }

  return value ?? null;
}
