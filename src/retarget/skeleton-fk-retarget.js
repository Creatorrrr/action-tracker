const RETARGET_MODE_LEGACY = "legacy";
const RETARGET_MODE_STRICT = "strict";
const RETARGET_MODE_ALIASES = Object.freeze({
  legacy: RETARGET_MODE_LEGACY,
  default: RETARGET_MODE_LEGACY,
  retarget: RETARGET_MODE_LEGACY,
  normal: RETARGET_MODE_LEGACY,
  strict: RETARGET_MODE_STRICT,
  "skeleton-direct": RETARGET_MODE_STRICT,
  skeleton: RETARGET_MODE_STRICT,
  fk: RETARGET_MODE_STRICT,
});
const MIN_VECTOR_LENGTH = 0.000001;

export {
  RETARGET_MODE_LEGACY,
  RETARGET_MODE_STRICT,
  buildStrictRetargetFrame,
  buildSourceAvatarDivergenceSummary,
  normalizeAvatarRetargetMode,
};

function normalizeAvatarRetargetMode(value, fallback = RETARGET_MODE_LEGACY) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return RETARGET_MODE_ALIASES[normalized] ?? fallback;
}

function buildStrictRetargetFrame({ points = {}, solvedPose = null, previousState = {}, rigBasis = {}, yawSign = -1 } = {}) {
  const root = buildRootFrame(points, solvedPose, previousState, yawSign);
  const bones = {};
  const targets = Array.isArray(solvedPose?.targets) ? solvedPose.targets : [];
  let lowConfidenceBones = 0;

  for (const target of targets) {
    const sourceDirection = normalizeVector(target?.direction);

    if (!target?.bone || !sourceDirection) {
      continue;
    }

    const rig = rigBasis?.bones?.[target.bone] ?? rigBasis?.[target.bone] ?? {};
    const restAxis = normalizeVector(arrayOrVector(rig.restAxis ?? rig.axisLocal));
    const localRotation = restAxis
      ? quaternionFromUnitVectors(restAxis, sourceDirection)
      : null;
    const confidence = clamp01(Number(target.confidence ?? 1));

    if (confidence < 0.5) {
      lowConfidenceBones += 1;
    }

    bones[target.bone] = {
      bone: target.bone,
      group: target.group ?? "unknown",
      from: target.from ?? null,
      to: target.to ?? null,
      confidence,
      sourceDirection,
      localRotation,
      usedTorsoLocalDirection: false,
      occlusionState: target.occlusionState ?? "tracking",
      rawDirection: normalizeVector(target.rawDirection) ?? sourceDirection,
    };
  }

  return {
    version: 1,
    mode: RETARGET_MODE_STRICT,
    timestamp: Number(solvedPose?.timestamp ?? 0),
    root,
    bones,
    diagnostics: {
      boneCount: Object.keys(bones).length,
      lowConfidenceBones,
      yawJumpDeg: root.yawDeltaDeg,
      yawDirectionMismatch: false,
      heldBones: Object.values(bones).filter((bone) => bone.occlusionState === "hold").map((bone) => bone.bone),
      safetyClampedBones: [],
    },
    state: {
      rootYawDeg: root.yawDeg,
      rootYawUnwrappedDeg: root.yawUnwrappedDeg,
    },
  };
}

function buildSourceAvatarDivergenceSummary({ segments = [], handOrientation = {}, rootMotion = null, retargetMode = RETARGET_MODE_LEGACY } = {}) {
  const validSegments = segments.filter((segment) => Number.isFinite(Number(segment.errorDeg)));
  const palmRows = Object.values(handOrientation ?? {})
    .filter(Boolean)
    .map((hand) => {
      const raw = arrayOrVector(hand.rawPalmNormal);
      const target = arrayOrVector(hand.targetPalmNormal) ?? raw;
      const avatar = arrayOrVector(hand.avatarPalmNormal);
      const dot = target && avatar ? dotVectors(target, avatar) : null;
      const rawDot = raw && avatar ? dotVectors(raw, avatar) : null;
      return {
        side: hand.side ?? "Unknown",
        tracked: Boolean(hand.tracked),
        source: hand.source ?? "none",
        palmDot: Number.isFinite(dot) ? round(dot, 6) : null,
        rawPalmDot: Number.isFinite(rawDot) ? round(rawDot, 6) : null,
        inverted: Number.isFinite(dot) ? dot < 0 : null,
      };
    });
  const segmentErrors = validSegments.map((segment) => Number(segment.errorDeg));
  const palmDots = palmRows.map((row) => Number(row.palmDot)).filter(Number.isFinite);

  return {
    retargetMode: normalizeAvatarRetargetMode(retargetMode),
    segmentCount: validSegments.length,
    angularErrorDeg: summarizeValues(segmentErrors),
    worstSegments: validSegments
      .slice()
      .sort((a, b) => Number(b.errorDeg) - Number(a.errorDeg))
      .slice(0, 8)
      .map((segment) => ({
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: round(segment.errorDeg, 3),
      })),
    rootYaw: {
      yawOffsetDeg: Number.isFinite(Number(rootMotion?.yawOffsetDeg))
        ? round(rootMotion.yawOffsetDeg, 3)
        : null,
      targetYawDeg: Number.isFinite(Number(rootMotion?.orientationMetrics?.avatarTargetYawDeg))
        ? round(rootMotion.orientationMetrics.avatarTargetYawDeg, 3)
        : null,
      solverYawDeg: Number.isFinite(Number(rootMotion?.orientationMetrics?.solverUnwrappedYawDeg))
        ? round(rootMotion.orientationMetrics.solverUnwrappedYawDeg, 3)
        : null,
      rawJump: Boolean(rootMotion?.orientationMetrics?.solverRawYawJump),
      sideOrderFlip: Boolean(rootMotion?.orientationMetrics?.solverSideOrderFlip),
    },
    handPalm: {
      count: palmRows.length,
      tracked: palmRows.filter((row) => row.tracked).length,
      inversionCount: palmRows.filter((row) => row.inverted === true).length,
      dot: summarizeValues(palmDots),
      bySide: palmRows,
    },
  };
}

function buildRootFrame(points, solvedPose, previousState, yawSign) {
  const rawYaw = Number(
    solvedPose?.meta?.facingUnwrappedYawDeg ??
    solvedPose?.meta?.facingYawDeg ??
    estimateYawFromBodyFrame(points),
  );
  const previousYaw = Number(previousState?.rootYawUnwrappedDeg);
  const unwrappedYaw = Number.isFinite(rawYaw)
    ? unwrapAngleDeg(rawYaw, previousYaw)
    : Number.isFinite(previousYaw)
      ? previousYaw
      : 0;
  const signedYaw = normalizeAngleDeg(unwrappedYaw * normalizeSign(yawSign, -1));
  const delta = Number.isFinite(previousYaw) ? unwrappedYaw - previousYaw : 0;

  return {
    yawDeg: signedYaw,
    yawUnwrappedDeg: unwrappedYaw,
    sourceYawDeg: Number.isFinite(rawYaw) ? normalizeAngleDeg(rawYaw) : null,
    yawSign: normalizeSign(yawSign, -1),
    yawDeltaDeg: round(delta, 3),
    mode: solvedPose?.meta?.mode ?? "unknown",
    facing: solvedPose?.meta?.facingDetail ?? solvedPose?.meta?.facing ?? "unknown",
  };
}

function estimateYawFromBodyFrame(points) {
  const leftShoulder = points?.leftShoulder;
  const rightShoulder = points?.rightShoulder;
  const leftHip = points?.leftHip;
  const rightHip = points?.rightHip;
  const lateral = normalizeVector(
    subtractVectors(leftShoulder ?? leftHip, rightShoulder ?? rightHip),
  );

  if (!lateral) {
    return null;
  }

  return radToDeg(Math.atan2(lateral.z, lateral.x));
}

function quaternionFromUnitVectors(from, to) {
  const source = normalizeVector(from);
  const target = normalizeVector(to);

  if (!source || !target) {
    return null;
  }

  const dot = clamp(dotVectors(source, target), -1, 1);

  if (dot < -0.999999) {
    const axis = chooseOrthogonalAxis(source);
    return quaternionFromAxisAngle(axis, Math.PI);
  }

  const cross = crossVectors(source, target);
  const quaternion = {
    x: cross.x,
    y: cross.y,
    z: cross.z,
    w: 1 + dot,
  };

  return normalizeQuaternion(quaternion);
}

function quaternionFromAxisAngle(axis, angle) {
  const normalizedAxis = normalizeVector(axis);

  if (!normalizedAxis) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  const half = angle / 2;
  const scale = Math.sin(half);
  return {
    x: normalizedAxis.x * scale,
    y: normalizedAxis.y * scale,
    z: normalizedAxis.z * scale,
    w: Math.cos(half),
  };
}

function normalizeQuaternion(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);

  if (!Number.isFinite(length) || length < MIN_VECTOR_LENGTH) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

function chooseOrthogonalAxis(vector) {
  const reference = Math.abs(vector.x) < 0.9
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 1, z: 0 };
  return normalizeVector(crossVectors(vector, reference));
}

function summarizeValues(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (sorted.length === 0) {
    return {
      count: 0,
      mean: 0,
      p50: 0,
      p95: 0,
      max: 0,
    };
  }

  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length, 3),
    p50: round(percentile(sorted, 0.5), 3),
    p95: round(percentile(sorted, 0.95), 3),
    max: round(sorted[sorted.length - 1], 3),
  };
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * fraction) - 1));
  return sortedValues[index];
}

function arrayOrVector(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return {
      x: Number(value[0]),
      y: Number(value[1]),
      z: Number(value[2]),
    };
  }

  if (
    value &&
    Number.isFinite(Number(value.x)) &&
    Number.isFinite(Number(value.y)) &&
    Number.isFinite(Number(value.z))
  ) {
    return {
      x: Number(value.x),
      y: Number(value.y),
      z: Number(value.z),
    };
  }

  return null;
}

function subtractVectors(a, b) {
  const left = arrayOrVector(a);
  const right = arrayOrVector(b);

  if (!left || !right) {
    return null;
  }

  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function normalizeVector(value) {
  const vector = arrayOrVector(value);

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(Number(value), 0, 1);
}

function normalizeSign(value, fallback) {
  const sign = Math.sign(Number(value));
  return sign === 0 ? fallback : sign;
}

function normalizeAngleDeg(value) {
  let angle = Number(value) % 360;

  if (angle > 180) {
    angle -= 360;
  }
  if (angle < -180) {
    angle += 360;
  }

  return angle;
}

function unwrapAngleDeg(value, previousValue) {
  const normalized = normalizeAngleDeg(value);

  if (!Number.isFinite(previousValue)) {
    return normalized;
  }

  let candidate = normalized;

  while (candidate - previousValue > 180) {
    candidate -= 360;
  }
  while (candidate - previousValue < -180) {
    candidate += 360;
  }

  return candidate;
}

function radToDeg(value) {
  return Number(value) * 180 / Math.PI;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  const rounded = Math.round(Number(value) * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}
