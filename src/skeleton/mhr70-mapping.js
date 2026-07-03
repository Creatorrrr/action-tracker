const MEDIAPIPE_POSE_LANDMARK_COUNT = 33;
const MHR70_JOINT_COUNT = 70;

const MHR70_JOINT_NAMES = Object.freeze([
  "nose",
  "left_eye_proxy_a",
  "right_eye_proxy_a",
  "left_eye_proxy_b",
  "left_eye_proxy_c",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
  "left_foot_index",
  "unused_16",
  "left_heel",
  "right_heel",
  "unused_19",
  "right_foot_index",
  "unused_21",
  "unused_22",
  "unused_23",
  "right_thumb_proxy",
  "unused_25",
  "unused_26",
  "unused_27",
  "right_index_proxy",
  "unused_29",
  "unused_30",
  "unused_31",
  "unused_32",
  "unused_33",
  "unused_34",
  "unused_35",
  "unused_36",
  "unused_37",
  "unused_38",
  "unused_39",
  "right_pinky_proxy",
  "right_wrist_proxy",
  "unused_42",
  "unused_43",
  "unused_44",
  "left_thumb_proxy",
  "unused_46",
  "unused_47",
  "unused_48",
  "left_index_proxy",
  "unused_50",
  "unused_51",
  "unused_52",
  "unused_53",
  "unused_54",
  "unused_55",
  "unused_56",
  "unused_57",
  "unused_58",
  "unused_59",
  "unused_60",
  "left_pinky_proxy",
  "left_wrist_proxy",
  "unused_63",
  "unused_64",
  "unused_65",
  "unused_66",
  "unused_67",
  "unused_68",
  "unused_69",
]);

const MHR70_TO_MEDIAPIPE33 = Object.freeze({
  0: 0,
  1: 1,
  2: 1,
  3: 1,
  4: 2,
  5: 2,
  6: 2,
  7: 3,
  8: 4,
  11: 5,
  12: 6,
  13: 7,
  14: 8,
  15: 62,
  16: 41,
  17: 61,
  18: 40,
  19: 49,
  20: 28,
  21: 45,
  22: 24,
  23: 9,
  24: 10,
  25: 11,
  26: 12,
  27: 13,
  28: 14,
  29: 17,
  30: 20,
  31: 15,
  32: 18,
});

const MHR70_MAPPING_NOTES = Object.freeze({
  wrist: "MediaPipe wrist landmarks are mapped from the closest available MHR70 hand/wrist proxy joints observed in SAM-3D-Body output.",
  fingers: "MediaPipe pinky/index/thumb landmarks are approximated from MHR70 hand proxy joints, not full 21-point hand landmarks.",
  axes: "MHR70 world coordinates are kept native by default; axisAudit records the observed y-down and z-camera-negative ratios for each conversion.",
});

export {
  MEDIAPIPE_POSE_LANDMARK_COUNT,
  MHR70_JOINT_COUNT,
  MHR70_JOINT_NAMES,
  MHR70_MAPPING_NOTES,
  MHR70_TO_MEDIAPIPE33,
  auditMhr70AxisFrame,
  buildMhr70WorldVisibilityCaps,
  mapMhr70ToMediaPipe33,
  summarizeMhr70AxisAudit,
};

function mapMhr70ToMediaPipe33(joints, options = {}) {
  if (!Array.isArray(joints) || joints.length !== MHR70_JOINT_COUNT) {
    throw new Error(`${options.label ?? "MHR70 joints"} requires ${MHR70_JOINT_COUNT} joints.`);
  }

  const landmarks = Array.from({ length: MEDIAPIPE_POSE_LANDMARK_COUNT }, () => null);
  const center = options.screenSpace ? null : midpointRawJoint(joints[9], joints[10]);
  const visibilityCaps = Array.isArray(options.visibilityCaps) ? options.visibilityCaps : [];

  for (const [mediaPipeIndex, mhrIndex] of Object.entries(MHR70_TO_MEDIAPIPE33)) {
    const mpIndex = Number(mediaPipeIndex);
    landmarks[mpIndex] = toMhr70Landmark(joints[Number(mhrIndex)], {
      ...options,
      center,
      index: Number(mhrIndex),
      visibilityCap: visibilityCaps[mpIndex],
    });
  }

  const mouth = midpointLandmark(landmarks[0], landmarks[2], landmarks[5]);
  landmarks[9] = mouth;
  landmarks[10] = mouth ? { ...mouth } : null;

  for (let index = 0; index < landmarks.length; index += 1) {
    if (!landmarks[index]) {
      landmarks[index] = nearestFallbackLandmark(landmarks, index);
    }
  }

  return landmarks;
}

function buildMhr70WorldVisibilityCaps(imageJoints, options = {}) {
  const caps = Array.from({ length: MEDIAPIPE_POSE_LANDMARK_COUNT }, () => 1);

  if (!Array.isArray(imageJoints)) {
    return caps;
  }

  const imageWidth = Number(options.imageWidth);
  const imageHeight = Number(options.imageHeight);
  const hasSize = imageWidth > 0 && imageHeight > 0;

  for (const [mediaPipeIndex, mhrIndex] of Object.entries(MHR70_TO_MEDIAPIPE33)) {
    const joint = imageJoints[Number(mhrIndex)];

    if (!Array.isArray(joint)) {
      continue;
    }

    const rawX = normalizeCoordinate(joint[0], 0);
    const rawY = normalizeCoordinate(joint[1], 0);
    const x = hasSize ? rawX / imageWidth : rawX;
    const y = hasSize ? rawY / imageHeight : rawY;
    const insideLooseBounds = x >= -0.2 && x <= 1.2 && y >= -0.2 && y <= 1.2;

    if (!insideLooseBounds) {
      caps[Number(mediaPipeIndex)] = 0.3;
    }
  }

  return caps;
}

function auditMhr70AxisFrame(worldJoints) {
  if (!Array.isArray(worldJoints) || worldJoints.length < MHR70_JOINT_COUNT) {
    return null;
  }

  const nose = worldJoints[0];
  const leftShoulder = worldJoints[5];
  const rightShoulder = worldJoints[6];
  const leftHip = worldJoints[9];
  const rightHip = worldJoints[10];
  const leftAnkle = worldJoints[13];
  const rightAnkle = worldJoints[14];

  if (![nose, leftShoulder, rightShoulder, leftHip, rightHip, leftAnkle, rightAnkle].every(Array.isArray)) {
    return null;
  }

  const hipMid = midpointRawJoint(leftHip, rightHip);
  const shoulderMid = midpointRawJoint(leftShoulder, rightShoulder);
  const ankleMid = midpointRawJoint(leftAnkle, rightAnkle);
  const up = subtractRaw(shoulderMid, hipMid);
  const across = subtractRaw(leftShoulder, rightShoulder);
  const forward = crossRaw(up, across);
  const noseDirection = subtractRaw(nose, hipMid);
  const forwardLength = magnitudeRaw(forward);
  const noseDirectionLength = magnitudeRaw(noseDirection);

  return {
    yDown: normalizeCoordinate(nose[1], 0) < normalizeCoordinate(ankleMid[1], 0),
    zCameraNegative: normalizeCoordinate(nose[2], 0) - normalizeCoordinate(hipMid[2], 0) < 0,
    forwardNoseDot: forwardLength > 0 && noseDirectionLength > 0
      ? dotRaw(forward, noseDirection) / (forwardLength * noseDirectionLength)
      : 0,
  };
}

function summarizeMhr70AxisAudit(samples) {
  const valid = Array.isArray(samples) ? samples.filter(Boolean) : [];

  if (valid.length === 0) {
    return {
      samples: 0,
      yDownRatio: 0,
      zCameraNegativeRatio: 0,
      forwardNoseDotMean: 0,
      worldAxisX: "native",
      worldAxisY: "native",
      worldAxisZ: "native",
    };
  }

  return {
    samples: valid.length,
    yDownRatio: round(valid.filter((sample) => sample.yDown).length / valid.length, 6),
    zCameraNegativeRatio: round(valid.filter((sample) => sample.zCameraNegative).length / valid.length, 6),
    forwardNoseDotMean: round(valid.reduce((sum, sample) => sum + sample.forwardNoseDot, 0) / valid.length, 6),
    worldAxisX: "native",
    worldAxisY: "native",
    worldAxisZ: "native",
  };
}

function toMhr70Landmark(joint, options = {}) {
  if (!Array.isArray(joint)) {
    throw new Error(`Invalid MHR70 joint at index ${options.index ?? "unknown"}.`);
  }

  const visibility = clamp(Math.min(
    normalizeVisibility(joint[3]),
    normalizeVisibility(options.visibility),
    Number.isFinite(Number(options.visibilityCap)) ? Number(options.visibilityCap) : 1,
  ), 0, 1);

  if (options.screenSpace) {
    const imageWidth = Number(options.imageWidth);
    const imageHeight = Number(options.imageHeight);
    const rawX = normalizeCoordinate(joint[0], 0);
    const rawY = normalizeCoordinate(joint[1], 0);
    const hasSize = imageWidth > 0 && imageHeight > 0;
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

function midpointRawJoint(...joints) {
  const valid = joints.filter((joint) => Array.isArray(joint));

  if (valid.length === 0) {
    return [0, 0, 0];
  }

  return [
    valid.reduce((sum, joint) => sum + normalizeCoordinate(joint[0], 0), 0) / valid.length,
    valid.reduce((sum, joint) => sum + normalizeCoordinate(joint[1], 0), 0) / valid.length,
    valid.reduce((sum, joint) => sum + normalizeCoordinate(joint[2], 0), 0) / valid.length,
  ];
}

function midpointLandmark(...landmarks) {
  const valid = landmarks.filter(Boolean);

  if (valid.length === 0) {
    return null;
  }

  const visibility = Math.min(...valid.map((landmark) => landmark.visibility ?? 1));

  return {
    x: valid.reduce((sum, landmark) => sum + landmark.x, 0) / valid.length,
    y: valid.reduce((sum, landmark) => sum + landmark.y, 0) / valid.length,
    z: valid.reduce((sum, landmark) => sum + (landmark.z ?? 0), 0) / valid.length,
    visibility,
    presence: visibility,
  };
}

function nearestFallbackLandmark(landmarks, index) {
  const fallbackOrder = [0, 11, 12, 23, 24, 15, 16, 27, 28];
  const sourceIndex = fallbackOrder.find((candidate) => landmarks[candidate]) ?? landmarks.findIndex(Boolean);
  const source = landmarks[sourceIndex] ?? { x: 0, y: 0, z: 0, visibility: 0 };

  return {
    ...source,
    visibility: Math.min(source.visibility ?? 1, 0.01),
    presence: 0,
  };
}

function subtractRaw(a, b) {
  return [
    normalizeCoordinate(a[0], 0) - normalizeCoordinate(b[0], 0),
    normalizeCoordinate(a[1], 0) - normalizeCoordinate(b[1], 0),
    normalizeCoordinate(a[2], 0) - normalizeCoordinate(b[2], 0),
  ];
}

function crossRaw(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotRaw(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function magnitudeRaw(value) {
  return Math.hypot(value[0], value[1], value[2]);
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

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
