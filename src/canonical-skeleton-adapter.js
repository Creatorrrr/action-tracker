import {
  constrainHingeChildDirection,
  evaluateHingeFlexion,
} from "./retarget/anatomical-constraints.js";

export const CANONICAL_SKELETON_ADAPTER_VERSION = "mediapipe33-joint-center-v4-elbow-screen";
export const MEDIAPIPE_ELBOW_FLEX_BIAS_DEG = 16;
export const MEDIAPIPE_KNEE_FLEX_BIAS_DEG = 11;
export const MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG = 90;
export const MEDIAPIPE_ELBOW_BIAS_FADE_END_DEG = 110;
export const CANONICAL_HINGE_JOINT_SHARE = 0.75;
export const CANONICAL_HINGE_DISTAL_SHARE = 1 - CANONICAL_HINGE_JOINT_SHARE;

const HINGE_SOLVE_EPSILON = 0.000001;
const HINGE_SOLVE_ITERATIONS = 48;
const HINGE_SOLVE_MAX_HEIGHT_RATIO = 8;

const HINGE_SPECS = Object.freeze([
  Object.freeze({
    name: "leftElbow",
    parentIndex: 11,
    jointIndex: 13,
    distalIndices: Object.freeze([15, 17, 19, 21]),
    flexBiasDeg: MEDIAPIPE_ELBOW_FLEX_BIAS_DEG,
    maxFlexDeg: 155,
  }),
  Object.freeze({
    name: "rightElbow",
    parentIndex: 12,
    jointIndex: 14,
    distalIndices: Object.freeze([16, 18, 20, 22]),
    flexBiasDeg: MEDIAPIPE_ELBOW_FLEX_BIAS_DEG,
    maxFlexDeg: 155,
  }),
  Object.freeze({
    name: "leftKnee",
    parentIndex: 23,
    jointIndex: 25,
    distalIndices: Object.freeze([27, 29, 31]),
    flexBiasDeg: MEDIAPIPE_KNEE_FLEX_BIAS_DEG,
    maxFlexDeg: 165,
  }),
  Object.freeze({
    name: "rightKnee",
    parentIndex: 24,
    jointIndex: 26,
    distalIndices: Object.freeze([28, 30, 32]),
    flexBiasDeg: MEDIAPIPE_KNEE_FLEX_BIAS_DEG,
    maxFlexDeg: 165,
  }),
]);
const SCREEN_PROJECTED_JOINT_INDICES = new Set(
  HINGE_SPECS
    .filter((spec) => spec.name.includes("Elbow"))
    .map((spec) => spec.jointIndex),
);

/**
 * Converts MediaPipe's surface-landmark limb geometry to the canonical
 * joint-center convention used by the teacher skeleton and retargeter.
 *
 * The correction is symmetric across sides. Most of the surface-to-center
 * displacement is assigned to the elbow/knee itself while a smaller residual
 * rigidly translates the distal chain. This preserves wrist/ankle endpoints
 * far better than rotating the entire distal chain around a surface landmark.
 * It is frame-local and causal with no lag.
 */
export function adaptCanonicalSkeletonFrame(motionFrame, options = {}) {
  const worldLandmarks = motionFrame?.poseWorldLandmarks;
  if (!Array.isArray(worldLandmarks) || worldLandmarks.length < 33) {
    return motionFrame;
  }

  const uniformFlexBiasDeg = optionalFiniteNonNegative(options.flexBiasDeg);
  const elbowFlexBiasDeg = finiteNonNegative(
    options.elbowFlexBiasDeg,
    uniformFlexBiasDeg ?? MEDIAPIPE_ELBOW_FLEX_BIAS_DEG,
  );
  const kneeFlexBiasDeg = finiteNonNegative(
    options.kneeFlexBiasDeg,
    uniformFlexBiasDeg ?? MEDIAPIPE_KNEE_FLEX_BIAS_DEG,
  );
  const jointShare = clamp01(
    options.jointShare,
    CANONICAL_HINGE_JOINT_SHARE,
  );
  const adaptedWorldLandmarks = worldLandmarks.map(cloneLandmark);
  let adjustedCount = 0;

  for (const spec of HINGE_SPECS) {
    const flexBiasDeg = spec.name.includes("Elbow")
      ? elbowFlexBiasDeg
      : kneeFlexBiasDeg;
    if (calibrateHinge(adaptedWorldLandmarks, spec, flexBiasDeg, jointShare)) {
      adjustedCount += 1;
    }
  }

  if (adjustedCount === 0) {
    return motionFrame;
  }

  const screenProjection = projectWorldCorrectionsToImageLandmarks({
    imageLandmarks: motionFrame.poseLandmarks,
    originalWorldLandmarks: worldLandmarks,
    adaptedWorldLandmarks,
  });

  return {
    ...motionFrame,
    poseLandmarks: screenProjection.landmarks ?? motionFrame.poseLandmarks,
    poseWorldLandmarks: adaptedWorldLandmarks,
    sourceMeta: {
      ...(motionFrame.sourceMeta ?? {}),
      canonicalSkeletonAdapter: CANONICAL_SKELETON_ADAPTER_VERSION,
      canonicalElbowFlexBiasDeg: elbowFlexBiasDeg,
      canonicalElbowBiasFadeStartDeg: MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG,
      canonicalElbowBiasFadeEndDeg: MEDIAPIPE_ELBOW_BIAS_FADE_END_DEG,
      canonicalKneeFlexBiasDeg: kneeFlexBiasDeg,
      canonicalHingeJointShare: jointShare,
      canonicalHingeDistalShare: 1 - jointShare,
      canonicalHingeAdjustedCount: adjustedCount,
      canonicalScreenCorrectionCount: screenProjection.correctedCount,
      canonicalScreenCorrectionScope: "elbow-joint-only",
      canonicalWorldToScreenScale: screenProjection.worldToScreenScale,
      canonicalScreenMaxDelta: screenProjection.maxDelta,
    },
  };
}

function projectWorldCorrectionsToImageLandmarks({
  imageLandmarks,
  originalWorldLandmarks,
  adaptedWorldLandmarks,
}) {
  const worldToScreenScale = resolveWorldToScreenScale(
    imageLandmarks,
    originalWorldLandmarks,
  );
  if (
    !Array.isArray(imageLandmarks) ||
    imageLandmarks.length < 33 ||
    !(worldToScreenScale > HINGE_SOLVE_EPSILON)
  ) {
    return {
      landmarks: null,
      correctedCount: 0,
      worldToScreenScale: null,
      maxDelta: 0,
    };
  }

  const projected = imageLandmarks.map(cloneLandmark);
  let correctedCount = 0;
  let maxDelta = 0;
  for (let index = 0; index < adaptedWorldLandmarks.length; index += 1) {
    if (!SCREEN_PROJECTED_JOINT_INDICES.has(index)) {
      continue;
    }
    const image = projected[index];
    const original = originalWorldLandmarks[index];
    const adapted = adaptedWorldLandmarks[index];
    if (!hasFiniteImagePoint(image) || !hasFinitePoint(original) || !hasFinitePoint(adapted)) {
      continue;
    }

    const deltaX = adapted.x - original.x;
    const deltaY = adapted.y - original.y;
    const worldDelta = Math.hypot(
      deltaX,
      deltaY,
      adapted.z - original.z,
    );
    if (!(worldDelta > HINGE_SOLVE_EPSILON)) {
      continue;
    }

    const imageDeltaX = deltaX * worldToScreenScale * 0.5;
    const imageDeltaY = deltaY * worldToScreenScale * 0.5;
    projected[index] = {
      ...image,
      x: image.x + imageDeltaX,
      y: image.y + imageDeltaY,
    };
    correctedCount += 1;
    maxDelta = Math.max(maxDelta, Math.hypot(imageDeltaX, imageDeltaY));
  }

  return {
    landmarks: correctedCount > 0 ? projected : null,
    correctedCount,
    worldToScreenScale,
    maxDelta,
  };
}

function resolveWorldToScreenScale(imageLandmarks, worldLandmarks) {
  if (!Array.isArray(imageLandmarks) || !Array.isArray(worldLandmarks)) {
    return null;
  }
  const imageShoulderMid = midpointPoint(imageLandmarks[11], imageLandmarks[12]);
  const imageHipMid = midpointPoint(imageLandmarks[23], imageLandmarks[24]);
  const worldShoulderMid = midpointPoint(worldLandmarks[11], worldLandmarks[12]);
  const worldHipMid = midpointPoint(worldLandmarks[23], worldLandmarks[24]);
  if (
    !hasFiniteImagePoint(imageShoulderMid) ||
    !hasFiniteImagePoint(imageHipMid) ||
    !hasFinitePoint(worldShoulderMid) ||
    !hasFinitePoint(worldHipMid)
  ) {
    return null;
  }
  const imageTorsoLength = Math.hypot(
    (imageShoulderMid.x - imageHipMid.x) * 2,
    (imageShoulderMid.y - imageHipMid.y) * 2,
  );
  const worldTorsoLength = distance(worldShoulderMid, worldHipMid);
  if (!(imageTorsoLength > HINGE_SOLVE_EPSILON) || !(worldTorsoLength > HINGE_SOLVE_EPSILON)) {
    return null;
  }
  return imageTorsoLength / worldTorsoLength;
}

function midpointPoint(a, b) {
  if (!a || !b) {
    return null;
  }
  return {
    x: (Number(a.x) + Number(b.x)) * 0.5,
    y: (Number(a.y) + Number(b.y)) * 0.5,
    z: (Number(a.z ?? 0) + Number(b.z ?? 0)) * 0.5,
  };
}

function calibrateHinge(landmarks, spec, flexBiasDeg, jointShare) {
  const parent = landmarks[spec.parentIndex];
  const joint = landmarks[spec.jointIndex];
  const childIndex = spec.distalIndices[0];
  const child = landmarks[childIndex];
  if (!hasFinitePoint(parent) || !hasFinitePoint(joint) || !hasFinitePoint(child)) {
    return false;
  }

  const raw = evaluateHingeFlexion({
    name: spec.name,
    parent,
    joint,
    child,
    minFlexDeg: 0,
    softMaxFlexDeg: spec.maxFlexDeg,
    maxFlexDeg: spec.maxFlexDeg,
  });
  if (!Number.isFinite(raw.flexDeg)) {
    return false;
  }

  const effectiveFlexBiasDeg = spec.name.includes("Elbow")
    ? flexBiasDeg * elbowBiasGain(raw.flexDeg)
    : flexBiasDeg;
  if (!(effectiveFlexBiasDeg > HINGE_SOLVE_EPSILON)) {
    return false;
  }

  const calibratedFlexDeg = Math.min(
    spec.maxFlexDeg,
    Math.max(0, raw.flexDeg + effectiveFlexBiasDeg),
  );
  const jointOnlyPosition = solveJointPositionForFlex({
    parent,
    joint,
    child,
    flexDeg: calibratedFlexDeg,
  });
  if (!jointOnlyPosition) {
    return false;
  }

  const calibratedJoint = mixPoint(joint, jointOnlyPosition, jointShare);
  const childDirection = constrainHingeChildDirection({
    parent,
    joint: calibratedJoint,
    child,
    clampedFlexDeg: calibratedFlexDeg,
  });
  if (!childDirection) {
    return false;
  }

  const childLength = distance(calibratedJoint, child);
  if (!(childLength > 0)) {
    return false;
  }

  const delta = {
    x: calibratedJoint.x + childDirection.x * childLength - child.x,
    y: calibratedJoint.y + childDirection.y * childLength - child.y,
    z: calibratedJoint.z + childDirection.z * childLength - child.z,
  };

  landmarks[spec.jointIndex] = {
    ...joint,
    x: calibratedJoint.x,
    y: calibratedJoint.y,
    z: calibratedJoint.z,
  };

  for (const index of spec.distalIndices) {
    const landmark = landmarks[index];
    if (!hasFinitePoint(landmark)) {
      continue;
    }
    landmarks[index] = {
      ...landmark,
      x: landmark.x + delta.x,
      y: landmark.y + delta.y,
      z: landmark.z + delta.z,
    };
  }

  return true;
}

function elbowBiasGain(rawFlexDeg) {
  const progress = clamp01(
    (Number(rawFlexDeg) - MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG) /
      (MEDIAPIPE_ELBOW_BIAS_FADE_END_DEG - MEDIAPIPE_ELBOW_BIAS_FADE_START_DEG),
    0,
  );
  const smoothProgress = progress * progress * (3 - 2 * progress);
  return 1 - smoothProgress;
}

function solveJointPositionForFlex({ parent, joint, child, flexDeg }) {
  const chord = subtract(child, parent);
  const chordLengthSquared = dot(chord, chord);
  const chordLength = Math.sqrt(chordLengthSquared);
  if (!(chordLength > HINGE_SOLVE_EPSILON)) {
    return null;
  }

  const projectionRatio = dot(subtract(joint, parent), chord) / chordLengthSquared;
  if (!(projectionRatio > HINGE_SOLVE_EPSILON && projectionRatio < 1 - HINGE_SOLVE_EPSILON)) {
    return null;
  }

  const projection = addScaled(parent, chord, projectionRatio);
  const planeDirection = normalize(subtract(joint, projection));
  const initialHeight = distance(joint, projection);
  if (!planeDirection || !(initialHeight > HINGE_SOLVE_EPSILON)) {
    return null;
  }

  const targetFlexDeg = Number(flexDeg);
  const initialFlexDeg = flexAtJointHeight({
    parent,
    projection,
    planeDirection,
    child,
    height: initialHeight,
  });
  if (!Number.isFinite(targetFlexDeg) || !Number.isFinite(initialFlexDeg)) {
    return null;
  }
  if (targetFlexDeg <= initialFlexDeg + HINGE_SOLVE_EPSILON) {
    return addScaled(projection, planeDirection, initialHeight);
  }

  let low = initialHeight;
  let high = Math.max(initialHeight * 2, chordLength * 0.25);
  const maxHeight = chordLength * HINGE_SOLVE_MAX_HEIGHT_RATIO;
  let highFlexDeg = flexAtJointHeight({
    parent,
    projection,
    planeDirection,
    child,
    height: high,
  });

  while (Number.isFinite(highFlexDeg) && highFlexDeg < targetFlexDeg && high < maxHeight) {
    low = high;
    high = Math.min(maxHeight, high * 2);
    highFlexDeg = flexAtJointHeight({
      parent,
      projection,
      planeDirection,
      child,
      height: high,
    });
  }
  if (!Number.isFinite(highFlexDeg) || highFlexDeg < targetFlexDeg) {
    return null;
  }

  for (let iteration = 0; iteration < HINGE_SOLVE_ITERATIONS; iteration += 1) {
    const midpoint = (low + high) / 2;
    const midpointFlexDeg = flexAtJointHeight({
      parent,
      projection,
      planeDirection,
      child,
      height: midpoint,
    });
    if (!Number.isFinite(midpointFlexDeg)) {
      return null;
    }
    if (midpointFlexDeg < targetFlexDeg) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }

  return addScaled(projection, planeDirection, (low + high) / 2);
}

function flexAtJointHeight({ parent, projection, planeDirection, child, height }) {
  const candidateJoint = addScaled(projection, planeDirection, height);
  return evaluateHingeFlexion({
    name: "jointCenterSolve",
    parent,
    joint: candidateJoint,
    child,
    minFlexDeg: 0,
    softMaxFlexDeg: 175,
    maxFlexDeg: 175,
  }).flexDeg;
}

function cloneLandmark(landmark) {
  return landmark && typeof landmark === "object"
    ? { ...landmark }
    : landmark ?? null;
}

function hasFinitePoint(point) {
  return Number.isFinite(Number(point?.x)) &&
    Number.isFinite(Number(point?.y)) &&
    Number.isFinite(Number(point?.z));
}

function hasFiniteImagePoint(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(value) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (!(length > HINGE_SOLVE_EPSILON)) {
    return null;
  }
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
  };
}

function addScaled(origin, direction, scale) {
  return {
    x: origin.x + direction.x * scale,
    y: origin.y + direction.y * scale,
    z: origin.z + direction.z * scale,
  };
}

function mixPoint(from, to, amount) {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: from.z + (to.z - from.z) * amount,
  };
}

function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function optionalFiniteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clamp01(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(1, Math.max(0, number))
    : fallback;
}
