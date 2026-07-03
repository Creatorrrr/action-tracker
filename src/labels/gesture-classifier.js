const VISIBILITY_THRESHOLD = 0.25;
const BEHIND_BACK_EPSILON = 0.08;
const CROSSED_ARM_EPSILON = 0.05;
const FORWARD_EPSILON = -0.12;
const HALF_FORWARD_EPSILON = -0.04;

const POSE = Object.freeze({
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
});

export {
  classifyArmGesture,
  estimateBodyBasis,
};

function classifyArmGesture(frameOrLandmarks) {
  const world = Array.isArray(frameOrLandmarks)
    ? frameOrLandmarks
    : Array.isArray(frameOrLandmarks?.poseWorldLandmarks)
      ? frameOrLandmarks.poseWorldLandmarks
      : [];
  const image = !Array.isArray(frameOrLandmarks) && Array.isArray(frameOrLandmarks?.poseLandmarks)
    ? frameOrLandmarks.poseLandmarks
    : [];
  const bodyBasis = estimateBodyBasis(world);
  const leftWristWorld = point(world[POSE.leftWrist]);
  const rightWristWorld = point(world[POSE.rightWrist]);
  const leftWristImage = point(image[POSE.leftWrist]);
  const rightWristImage = point(image[POSE.rightWrist]);

  if (!bodyBasis || !leftWristWorld || !rightWristWorld) {
    return {
      arms: "unknown",
      leftArm: "unknown",
      rightArm: "unknown",
      crossedArms: false,
      behindBack: false,
      confidence: 0,
    };
  }

  const leftDepth = dot(subtract(leftWristWorld, bodyBasis.shoulderMid), bodyBasis.forward);
  const rightDepth = dot(subtract(rightWristWorld, bodyBasis.shoulderMid), bodyBasis.forward);
  const leftLateral = dot(subtract(leftWristWorld, bodyBasis.shoulderMid), bodyBasis.across);
  const rightLateral = dot(subtract(rightWristWorld, bodyBasis.shoulderMid), bodyBasis.across);
  const leftBehind = leftDepth > BEHIND_BACK_EPSILON;
  const rightBehind = rightDepth > BEHIND_BACK_EPSILON;
  const leftCrossed = leftLateral < -CROSSED_ARM_EPSILON;
  const rightCrossed = rightLateral > CROSSED_ARM_EPSILON;
  const crossedArms = leftCrossed && rightCrossed;
  const behindBack = leftBehind && rightBehind;
  let arms = "visible";

  if (behindBack) {
    arms = "behind-back";
  } else if (crossedArms) {
    arms = "crossed";
  } else if (isPalmsNearHead(image)) {
    arms = "palms-near-head";
  } else if (leftDepth < FORWARD_EPSILON && rightDepth < FORWARD_EPSILON) {
    arms = "forward";
  } else if (leftDepth < HALF_FORWARD_EPSILON && rightDepth < HALF_FORWARD_EPSILON) {
    arms = "half-forward";
  } else if (isArmsDown(image)) {
    arms = "down";
  } else if (isChestRaised(image)) {
    arms = "chest-raised";
  }

  return {
    arms,
    leftArm: leftBehind ? "behind-back" : leftCrossed ? "crossed" : "visible",
    rightArm: rightBehind ? "behind-back" : rightCrossed ? "crossed" : "visible",
    crossedArms,
    behindBack,
    leftDepth: round(leftDepth, 6),
    rightDepth: round(rightDepth, 6),
    leftLateral: round(leftLateral, 6),
    rightLateral: round(rightLateral, 6),
    confidence: Math.min(
      bodyBasis.confidence,
      leftWristWorld.visibility,
      rightWristWorld.visibility,
      leftWristImage?.visibility ?? 1,
      rightWristImage?.visibility ?? 1,
    ),
  };
}

function estimateBodyBasis(world) {
  const leftShoulder = point(world[POSE.leftShoulder]);
  const rightShoulder = point(world[POSE.rightShoulder]);
  const leftHip = point(world[POSE.leftHip]);
  const rightHip = point(world[POSE.rightHip]);

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  const across = normalize(subtract(leftShoulder, rightShoulder));
  const up = normalize(subtract(shoulderMid, hipMid));
  const forward = normalize(cross(up, across));
  const yawDeg = normalizeAngleDeg(Math.atan2(-forward.x, forward.z) * (180 / Math.PI));
  const confidence = Math.min(
    leftShoulder.visibility,
    rightShoulder.visibility,
    leftHip.visibility,
    rightHip.visibility,
  );

  return {
    shoulderMid,
    hipMid,
    across,
    up,
    forward,
    yawDeg,
    confidence,
  };
}

function isPalmsNearHead(image) {
  const leftWrist = point(image[POSE.leftWrist]);
  const rightWrist = point(image[POSE.rightWrist]);
  const leftShoulder = point(image[POSE.leftShoulder]);
  const rightShoulder = point(image[POSE.rightShoulder]);
  const nose = point(image[POSE.nose]);

  if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder || !nose) {
    return false;
  }

  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const nearHeadY = Math.max(leftWrist.y, rightWrist.y) <= shoulderMidY + shoulderWidth * 0.35;
  const aroundHeadX = leftWrist.x >= nose.x - shoulderWidth * 0.95 &&
    rightWrist.x <= nose.x + shoulderWidth * 0.95;

  return nearHeadY && aroundHeadX;
}

function isArmsDown(image) {
  const leftWrist = point(image[POSE.leftWrist]);
  const rightWrist = point(image[POSE.rightWrist]);
  const leftHip = point(image[POSE.leftHip]);
  const rightHip = point(image[POSE.rightHip]);
  const leftShoulder = point(image[POSE.leftShoulder]);
  const rightShoulder = point(image[POSE.rightShoulder]);

  if (!leftWrist || !rightWrist || !leftHip || !rightHip || !leftShoulder || !rightShoulder) {
    return false;
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const threshold = shoulderY + (hipY - shoulderY) * 0.45;
  return leftWrist.y >= threshold && rightWrist.y >= threshold;
}

function isChestRaised(image) {
  const leftWrist = point(image[POSE.leftWrist]);
  const rightWrist = point(image[POSE.rightWrist]);
  const leftShoulder = point(image[POSE.leftShoulder]);
  const rightShoulder = point(image[POSE.rightShoulder]);
  const leftHip = point(image[POSE.leftHip]);
  const rightHip = point(image[POSE.rightHip]);

  if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return false;
  }

  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const upper = shoulderY + (hipY - shoulderY) * 0.15;
  const lower = shoulderY + (hipY - shoulderY) * 0.55;
  return leftWrist.y >= upper && leftWrist.y <= lower && rightWrist.y >= upper && rightWrist.y <= lower;
}

function point(landmark) {
  if (!landmark || !Number.isFinite(Number(landmark.x)) || !Number.isFinite(Number(landmark.y))) {
    return null;
  }

  const visibility = Math.min(
    Number.isFinite(Number(landmark.visibility)) ? Number(landmark.visibility) : 1,
    Number.isFinite(Number(landmark.presence)) ? Number(landmark.presence) : 1,
  );

  if (visibility < VISIBILITY_THRESHOLD) {
    return null;
  }

  return {
    x: Number(landmark.x),
    y: Number(landmark.y),
    z: Number(landmark.z ?? 0),
    visibility,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  };
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 0.000001) {
    return { x: 0, y: 0, z: 0 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
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

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}
