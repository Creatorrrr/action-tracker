#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MEDIAPIPE_POSE_LANDMARK_COUNT = 33;
const DEFAULT_FRAME_COUNT = 9;

const LANDMARK_INDEX = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

const SCENARIOS = new Set([
  "identity",
  "left-elbow-flex",
  "turn-180",
  "upper-body",
  "left-wrist-occlusion",
  "lost-and-reacquired",
]);

export {
  LANDMARK_INDEX,
  MEDIAPIPE_POSE_LANDMARK_COUNT,
  SCENARIOS,
  createSyntheticMotionFrame,
  createSyntheticSequence,
  writeSyntheticFixtures,
};

function createSyntheticSequence({
  scenario = "identity",
  frames = DEFAULT_FRAME_COUNT,
  fps = 30,
} = {}) {
  if (!SCENARIOS.has(scenario)) {
    throw new Error(`Unknown synthetic scenario: ${scenario}`);
  }

  const frameCount = Math.max(1, Math.trunc(frames));
  const sequenceFrames = Array.from({ length: frameCount }, (_, index) => {
    const progress = frameCount === 1 ? 0 : index / (frameCount - 1);

    return createSyntheticMotionFrame({
      scenario,
      progress,
      timestamp: (index / fps) * 1000,
    });
  });

  return {
    version: 1,
    source: "synthetic-mediapipe33",
    scenario,
    fps,
    frames: sequenceFrames,
  };
}

function createSyntheticMotionFrame({
  scenario = "identity",
  progress = 0,
  timestamp = 0,
} = {}) {
  if (!SCENARIOS.has(scenario)) {
    throw new Error(`Unknown synthetic scenario: ${scenario}`);
  }

  const clampedProgress = clamp01(progress);
  const yawDeg = scenario === "turn-180" ? 180 * clampedProgress : 0;
  const leftElbowFlexDeg = scenario === "left-elbow-flex" ? 15 + 130 * clampedProgress : 15;
  const upperBodyOnly = scenario === "upper-body";
  const leftWristOccluded = scenario === "left-wrist-occlusion" && clampedProgress >= 0.35;
  const lostTracking = scenario === "lost-and-reacquired" &&
    clampedProgress >= 0.34 &&
    clampedProgress <= 0.66;
  const worldPoints = createBaseSkeleton({
    leftElbowFlexDeg,
    yawDeg,
    upperBodyOnly,
    leftWristOccluded,
    lostTracking,
  });
  const poseLandmarks = projectWorldPoints(worldPoints);
  const poseWorldLandmarks = worldPoints.map((point) => (
    point ? roundLandmark(point) : hiddenWorldLandmark()
  ));

  return {
    version: 1,
    timestamp,
    mirrored: false,
    poseLandmarks,
    poseWorldLandmarks,
    sourceMeta: {
      inputKind: "synthetic",
      scenario,
      progress: round(clampedProgress, 6),
    },
    expected: {
      facing: yawDeg < 45 ? "front" : yawDeg > 135 ? "back" : "side",
      mode: lostTracking ? "lost" : upperBodyOnly ? "upper-body" : "full-body",
      yawDeg: round(yawDeg, 3),
      lostTracking,
      joints: {
        leftElbow: {
          flexDeg: round(leftElbowFlexDeg, 3),
          occluded: leftWristOccluded,
        },
      },
    },
  };
}

function createBaseSkeleton({
  leftElbowFlexDeg,
  yawDeg,
  upperBodyOnly,
  leftWristOccluded,
  lostTracking,
}) {
  const points = Array.from({ length: MEDIAPIPE_POSE_LANDMARK_COUNT }, () => null);
  const shoulderY = 1.45;
  const hipY = 0.92;
  const kneeY = 0.42;
  const ankleY = 0.02;
  const leftX = -0.28;
  const rightX = 0.28;
  const shoulderZ = 2.1;
  const hipZ = 2.05;
  const faceVisibility = yawDeg > 135 ? 0.1 : 0.95;

  set(points, "leftShoulder", leftX, shoulderY, shoulderZ);
  set(points, "rightShoulder", rightX, shoulderY, shoulderZ);
  set(points, "leftHip", leftX * 0.78, hipY, hipZ, upperBodyOnly ? 0.15 : 0.95);
  set(points, "rightHip", rightX * 0.78, hipY, hipZ, upperBodyOnly ? 0.15 : 0.95);
  set(points, "nose", 0, 1.83, 1.98, faceVisibility);
  set(points, "leftEar", -0.12, 1.78, 2.02, faceVisibility);
  set(points, "rightEar", 0.12, 1.78, 2.02, faceVisibility);
  set(points, "leftEye", -0.05, 1.84, 1.96, faceVisibility);
  set(points, "rightEye", 0.05, 1.84, 1.96, faceVisibility);
  set(points, "leftEyeInner", -0.025, 1.835, 1.955, faceVisibility);
  set(points, "leftEyeOuter", -0.075, 1.835, 1.965, faceVisibility);
  set(points, "rightEyeInner", 0.025, 1.835, 1.955, faceVisibility);
  set(points, "rightEyeOuter", 0.075, 1.835, 1.965, faceVisibility);
  set(points, "mouthLeft", -0.05, 1.72, 1.95, faceVisibility);
  set(points, "mouthRight", 0.05, 1.72, 1.95, faceVisibility);

  const leftShoulder = points[LANDMARK_INDEX.leftShoulder];
  const leftUpperArm = 0.38;
  const leftForeArm = 0.36;
  const leftElbow = {
    x: leftShoulder.x - leftUpperArm * 0.82,
    y: leftShoulder.y - leftUpperArm * 0.55,
    z: leftShoulder.z,
    visibility: 0.95,
  };
  const elbowRad = degToRad(leftElbowFlexDeg);
  const upperFromElbow = normalize2d({
    x: leftShoulder.x - leftElbow.x,
    y: leftShoulder.y - leftElbow.y,
  });
  const extendedForearm = {
    x: -upperFromElbow.x,
    y: -upperFromElbow.y,
  };
  const bentForearm = rotate2d(extendedForearm, -elbowRad);
  const leftWrist = {
    x: leftElbow.x + bentForearm.x * leftForeArm,
    y: leftElbow.y + bentForearm.y * leftForeArm,
    z: leftElbow.z + (leftWristOccluded ? 0.26 : 0),
    visibility: leftWristOccluded ? 0.18 : 0.95,
  };
  points[LANDMARK_INDEX.leftElbow] = leftElbow;
  points[LANDMARK_INDEX.leftWrist] = leftWrist;
  setHandTips(points, "left", leftWrist);

  const rightShoulder = points[LANDMARK_INDEX.rightShoulder];
  const rightElbow = {
    x: rightShoulder.x + 0.31,
    y: rightShoulder.y - 0.21,
    z: rightShoulder.z,
    visibility: 0.95,
  };
  const rightWrist = {
    x: rightElbow.x + 0.32,
    y: rightElbow.y - 0.09,
    z: rightElbow.z,
    visibility: 0.95,
  };
  points[LANDMARK_INDEX.rightElbow] = rightElbow;
  points[LANDMARK_INDEX.rightWrist] = rightWrist;
  setHandTips(points, "right", rightWrist);

  set(points, "leftKnee", leftX * 0.7, kneeY, hipZ, upperBodyOnly ? 0.05 : 0.95);
  set(points, "rightKnee", rightX * 0.7, kneeY, hipZ, upperBodyOnly ? 0.05 : 0.95);
  set(points, "leftAnkle", leftX * 0.72, ankleY, hipZ + 0.04, upperBodyOnly ? 0.05 : 0.95);
  set(points, "rightAnkle", rightX * 0.72, ankleY, hipZ + 0.04, upperBodyOnly ? 0.05 : 0.95);
  set(points, "leftHeel", leftX * 0.72, ankleY - 0.04, hipZ + 0.11, upperBodyOnly ? 0.05 : 0.95);
  set(points, "rightHeel", rightX * 0.72, ankleY - 0.04, hipZ + 0.11, upperBodyOnly ? 0.05 : 0.95);
  set(points, "leftFootIndex", leftX * 0.72, ankleY - 0.02, hipZ - 0.16, upperBodyOnly ? 0.05 : 0.95);
  set(points, "rightFootIndex", rightX * 0.72, ankleY - 0.02, hipZ - 0.16, upperBodyOnly ? 0.05 : 0.95);

  return points.map((point) => {
    if (!point) {
      return point;
    }

    const visiblePoint = lostTracking
      ? { ...point, visibility: Math.min(point.visibility, 0.05) }
      : point;

    return rotateYaw(visiblePoint, yawDeg);
  });
}

function setHandTips(points, side, wrist) {
  const sign = side === "left" ? -1 : 1;
  const visibility = wrist.visibility;
  set(points, `${side}Pinky`, wrist.x + sign * 0.035, wrist.y - 0.025, wrist.z, visibility);
  set(points, `${side}Index`, wrist.x + sign * 0.05, wrist.y - 0.015, wrist.z - 0.01, visibility);
  set(points, `${side}Thumb`, wrist.x + sign * 0.015, wrist.y + 0.025, wrist.z - 0.02, visibility);
}

function projectWorldPoints(points) {
  return points.map((point) => {
    if (!point) {
      return hiddenImageLandmark();
    }

    const depth = Math.max(0.5, point.z);
    return {
      x: round(0.5 + point.x / (depth * 2.2), 6),
      y: round(0.78 - point.y / 2.6, 6),
      z: round((point.z - 2.05) / 2.2, 6),
      visibility: round(clamp01(point.visibility), 6),
      presence: round(clamp01(point.visibility), 6),
    };
  });
}

async function writeSyntheticFixtures(outputDir = "tests/fixtures/synthetic") {
  await mkdir(outputDir, { recursive: true });

  const scenarios = Array.from(SCENARIOS);
  const written = [];

  for (const scenario of scenarios) {
    const sequence = createSyntheticSequence({ scenario });
    const outputPath = path.join(outputDir, `${scenario}.json`);
    await writeFile(outputPath, `${JSON.stringify(sequence, null, 2)}\n`);
    written.push(outputPath);
  }

  return written;
}

function set(points, name, x, y, z, visibility = 0.95) {
  points[LANDMARK_INDEX[name]] = { x, y, z, visibility };
}

function rotateYaw(point, yawDeg) {
  const yaw = degToRad(yawDeg);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const centeredZ = point.z - 2.05;

  return {
    x: round(point.x * cos + centeredZ * sin, 6),
    y: round(point.y, 6),
    z: round(2.05 - point.x * sin + centeredZ * cos, 6),
    visibility: point.visibility,
  };
}

function roundLandmark(point) {
  return {
    x: round(point.x, 6),
    y: round(point.y, 6),
    z: round(point.z, 6),
    visibility: round(clamp01(point.visibility), 6),
  };
}

function hiddenWorldLandmark() {
  return { x: 0, y: 0, z: 0, visibility: 0 };
}

function hiddenImageLandmark() {
  return { x: 0, y: 0, z: 0, visibility: 0, presence: 0 };
}

function degToRad(deg) {
  return (deg / 180) * Math.PI;
}

function normalize2d(vector) {
  const length = Math.hypot(vector.x, vector.y) || 1;

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function rotate2d(vector, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

const invokedScriptUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === invokedScriptUrl) {
  const outputDir = process.argv[2] ?? path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "tests",
    "fixtures",
    "synthetic",
  );
  const written = await writeSyntheticFixtures(outputDir);
  for (const file of written) {
    console.log(file);
  }
}
