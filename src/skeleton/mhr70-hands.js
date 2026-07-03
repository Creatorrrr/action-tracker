import { MHR70_JOINT_COUNT, MHR70_JOINT_NAMES } from "./mhr70-mapping.js";

const MEDIAPIPE_HAND_LANDMARK_COUNT = 21;
const MHR70_HAND_TO_MEDIAPIPE21 = Object.freeze({
  left: Object.freeze([
    62,
    45, 44, 43, 42,
    49, 48, 47, 46,
    53, 52, 51, 50,
    57, 56, 55, 54,
    61, 60, 59, 58,
  ]),
  right: Object.freeze([
    41,
    24, 23, 22, 21,
    28, 27, 26, 25,
    32, 31, 30, 29,
    36, 35, 34, 33,
    40, 39, 38, 37,
  ]),
});

export {
  MEDIAPIPE_HAND_LANDMARK_COUNT,
  MHR70_HAND_TO_MEDIAPIPE21,
  mapMhr70ToMediaPipeHand,
};

function mapMhr70ToMediaPipeHand(joints, side, options = {}) {
  const normalizedSide = String(side ?? "").toLowerCase();
  const mapping = MHR70_HAND_TO_MEDIAPIPE21[normalizedSide];

  if (!Array.isArray(joints) || joints.length !== MHR70_JOINT_COUNT) {
    throw new Error(`${options.label ?? "MHR70 joints"} requires ${MHR70_JOINT_COUNT} joints.`);
  }
  if (!mapping) {
    throw new Error(`Unsupported MHR70 hand side: ${side}`);
  }

  const wrist = joints[mapping[0]];
  const center = options.screenSpace ? null : wrist;
  const detectorVisibility = normalizeVisibility(options.visibility);

  return mapping.map((mhrIndex, handIndex) => toHandLandmark(joints[mhrIndex], {
    ...options,
    center,
    mhrIndex,
    handIndex,
    visibility: detectorVisibility,
  }));
}

function toHandLandmark(joint, options = {}) {
  if (!Array.isArray(joint)) {
    const jointName = MHR70_JOINT_NAMES[options.mhrIndex] ?? `joint_${options.mhrIndex}`;
    throw new Error(`Invalid MHR70 ${jointName} for hand landmark ${options.handIndex}.`);
  }

  const visibility = Math.min(
    normalizeVisibility(joint[3]),
    normalizeVisibility(options.visibility),
  );

  if (options.screenSpace) {
    const imageWidth = Number(options.imageWidth);
    const imageHeight = Number(options.imageHeight);
    const hasSize = imageWidth > 0 && imageHeight > 0;
    const rawX = normalizeCoordinate(joint[0], 0);
    const rawY = normalizeCoordinate(joint[1], 0);
    const x = hasSize ? rawX / imageWidth : rawX;
    const y = hasSize ? rawY / imageHeight : rawY;
    const insideLooseBounds = x >= -0.2 && x <= 1.2 && y >= -0.2 && y <= 1.2;
    const screenVisibility = insideLooseBounds ? visibility : Math.min(visibility, 0.05);

    return {
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      z: 0,
      visibility: screenVisibility,
      presence: screenVisibility,
    };
  }

  const center = Array.isArray(options.center) ? options.center : [0, 0, 0];

  return {
    x: normalizeCoordinate(joint[0], 0) - normalizeCoordinate(center[0], 0),
    y: normalizeCoordinate(joint[1], 0) - normalizeCoordinate(center[1], 0),
    z: normalizeCoordinate(joint[2], 0) - normalizeCoordinate(center[2], 0),
    visibility,
    presence: visibility,
  };
}

function normalizeCoordinate(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeVisibility(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
