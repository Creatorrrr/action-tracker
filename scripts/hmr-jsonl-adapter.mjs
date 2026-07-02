#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MOTION_FRAME_VERSION,
  MOTION_RECORDING_VERSION,
  normalizeExternalMotionRecording,
  parseMotionRecordingJsonl,
  serializeMotionRecordingJsonl,
} from "../src/motion-frame.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const MEDIAPIPE_POSE_LANDMARK_COUNT = 33;
const COCO17_TO_MEDIAPIPE33 = Object.freeze({
  0: 0,
  1: 2,
  2: 5,
  3: 7,
  4: 8,
  5: 11,
  6: 12,
  7: 13,
  8: 14,
  9: 15,
  10: 16,
  11: 23,
  12: 24,
  13: 25,
  14: 26,
  15: 27,
  16: 28,
});

if (!args.input || args.help) {
  printUsage();
  process.exitCode = args.help ? 0 : 1;
} else {
  const sourceText = await readFile(path.resolve(projectRoot, args.input), "utf8");
  const recording = parseInputRecording(sourceText, args.input, {
    jointFormat: args.jointFormat,
  });
  const normalizedRecording = normalizeExternalMotionRecording(recording);
  const jsonl = serializeMotionRecordingJsonl(normalizedRecording);
  const summary = buildSummary(normalizedRecording, args.output);

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, jsonl);
    summary.outputPath = path.relative(projectRoot, outputPath);
    summary.outputBytes = Buffer.byteLength(jsonl);
  }

  if (args.stdout) {
    process.stdout.write(jsonl);
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    input: "",
    output: "",
    jointFormat: "",
    stdout: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--input") {
      parsed.input = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--joint-format") {
      parsed.jointFormat = rawArgs[++index] ?? "";
    } else if (arg === "--stdout") {
      parsed.stdout = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function parseInputRecording(sourceText, inputPath, options = {}) {
  const trimmed = sourceText.trim();

  if (!trimmed) {
    throw new Error("External HMR recording input is empty.");
  }

  if (inputPath.endsWith(".jsonl") || trimmed.startsWith("{\"type\":\"action-tracker-motion-recording\"")) {
    return parseMotionRecordingJsonl(sourceText);
  }

  const parsed = JSON.parse(sourceText);

  if (isMotionRecordingShape(parsed)) {
    return parsed;
  }

  return convertJointArrayRecording(parsed, {
    jointFormat: options.jointFormat,
  });
}

function buildSummary(recording, outputPath) {
  const frames = recording.frames ?? [];
  const firstFrame = frames[0] ?? null;
  const lastFrame = frames.at(-1) ?? null;

  return {
    status: "passed",
    sourceType: recording.source?.type ?? recording.source?.kind ?? "",
    extractor: recording.source?.extractor ?? recording.source?.detector ?? "",
    frameCount: frames.length,
    firstTimestamp: firstFrame?.timestamp ?? null,
    lastTimestamp: lastFrame?.timestamp ?? null,
    poseLandmarksPerFrame: firstFrame?.poseLandmarks?.length ?? 0,
    poseWorldLandmarksPerFrame: firstFrame?.poseWorldLandmarks?.length ?? 0,
    framesWithLeftHand: frames.filter((frame) => Array.isArray(frame.leftHandLandmarks)).length,
    framesWithRightHand: frames.filter((frame) => Array.isArray(frame.rightHandLandmarks)).length,
    outputPath: outputPath || "",
  };
}

function isMotionRecordingShape(value) {
  return value?.version === MOTION_RECORDING_VERSION && Array.isArray(value.frames);
}

function convertJointArrayRecording(input, options = {}) {
  const frames = Array.isArray(input?.frames)
    ? input.frames
    : Array.isArray(input?.results)
      ? input.results
      : [];
  const jointFormat = normalizeJointFormat(
    options.jointFormat
      || input?.jointFormat
      || input?.format
      || input?.source?.jointFormat
      || input?.source?.format,
  );

  if (frames.length === 0) {
    throw new Error("External HMR joint-array input requires a non-empty frames array.");
  }

  return {
    version: MOTION_RECORDING_VERSION,
    createdAt: input?.createdAt ?? new Date().toISOString(),
    source: {
      type: "external-hmr",
      extractor: normalizeExtractor(input?.source?.extractor ?? input?.extractor ?? input?.source?.detector),
      jointFormat,
      videoRef: input?.source?.videoRef ?? input?.videoRef ?? undefined,
      fps: Number.isFinite(input?.fps) ? input.fps : input?.source?.fps,
    },
    droppedFrames: input?.droppedFrames ?? 0,
    frames: frames.map((frame, index) => convertJointArrayFrame(frame, index, jointFormat, input)),
  };
}

function convertJointArrayFrame(frame, index, jointFormat, input) {
  const worldJoints = extractJointArray(frame, [
    "poseWorldLandmarks",
    "worldLandmarks",
    "worldJoints",
    "joints3d",
    "joints3D",
    "smplJoints",
    "keypoints3d",
    "keypoints3D",
  ]);
  const imageJoints = extractJointArray(frame, [
    "poseLandmarks",
    "landmarks",
    "imageJoints",
    "joints2d",
    "joints2D",
    "keypoints2d",
    "keypoints2D",
  ]) ?? worldJoints;

  if (!worldJoints) {
    throw new Error(`frames[${index}] requires world joint arrays such as joints3d, worldJoints, or poseWorldLandmarks.`);
  }

  const poseWorldLandmarks = convertJointList(worldJoints, jointFormat, { screenSpace: false, label: `frames[${index}].world` });
  const poseLandmarks = convertJointList(imageJoints, jointFormat, { screenSpace: true, label: `frames[${index}].image` });
  const timestamp = Number.isFinite(frame?.timestamp)
    ? frame.timestamp
    : Number.isFinite(frame?.timeMs)
      ? frame.timeMs
      : Number.isFinite(frame?.frameIndex)
        ? frame.frameIndex * 1000 / Math.max(1, Number(input?.fps ?? input?.source?.fps ?? 30))
        : index * 1000 / Math.max(1, Number(input?.fps ?? input?.source?.fps ?? 30));

  return {
    version: MOTION_FRAME_VERSION,
    timestamp,
    mirrored: Boolean(frame?.mirrored ?? input?.mirrored),
    poseLandmarks,
    poseWorldLandmarks,
    leftHandLandmarks: null,
    leftHandWorldLandmarks: null,
    rightHandLandmarks: null,
    rightHandWorldLandmarks: null,
    sourceMeta: {
      extractor: normalizeExtractor(input?.source?.extractor ?? input?.extractor ?? input?.source?.detector),
      jointFormat,
      sourceJointCount: worldJoints.length,
      frameIndex: Number.isFinite(frame?.frameIndex) ? frame.frameIndex : index,
      mapping: `${jointFormat}-to-mediapipe33`,
    },
  };
}

function convertJointList(joints, jointFormat, options = {}) {
  if (jointFormat === "mediapipe33") {
    if (joints.length !== MEDIAPIPE_POSE_LANDMARK_COUNT) {
      throw new Error(`${options.label} requires 33 joints for mediapipe33 format.`);
    }

    return joints.map((joint, index) => toLandmark(joint, { index, screenSpace: options.screenSpace }));
  }

  if (jointFormat === "coco17") {
    if (joints.length !== 17) {
      throw new Error(`${options.label} requires 17 joints for coco17 format.`);
    }

    return coco17ToMediaPipe33(joints, { screenSpace: options.screenSpace });
  }

  throw new Error(`Unsupported external HMR joint format: ${jointFormat}`);
}

function coco17ToMediaPipe33(joints, options = {}) {
  const landmarks = Array.from({ length: MEDIAPIPE_POSE_LANDMARK_COUNT }, () => null);

  for (const [cocoIndex, mediaPipeIndex] of Object.entries(COCO17_TO_MEDIAPIPE33)) {
    landmarks[mediaPipeIndex] = toLandmark(joints[Number(cocoIndex)], {
      index: Number(cocoIndex),
      screenSpace: options.screenSpace,
    });
  }

  landmarks[1] = midpointLandmark(landmarks[0], landmarks[2]);
  landmarks[3] = landmarks[7];
  landmarks[4] = midpointLandmark(landmarks[0], landmarks[5]);
  landmarks[6] = landmarks[8];
  landmarks[9] = midpointLandmark(landmarks[0], landmarks[2], landmarks[5]);
  landmarks[10] = landmarks[9];
  landmarks[17] = landmarks[15];
  landmarks[18] = landmarks[16];
  landmarks[19] = landmarks[15];
  landmarks[20] = landmarks[16];
  landmarks[21] = landmarks[15];
  landmarks[22] = landmarks[16];
  landmarks[29] = landmarks[27];
  landmarks[30] = landmarks[28];
  landmarks[31] = landmarks[27];
  landmarks[32] = landmarks[28];

  for (let index = 0; index < landmarks.length; index += 1) {
    if (!landmarks[index]) {
      landmarks[index] = nearestFallbackLandmark(landmarks, index);
    }
  }

  return landmarks;
}

function extractJointArray(frame, keys) {
  for (const key of keys) {
    const value = frame?.[key];

    if (Array.isArray(value) && value.length > 0) {
      return value;
    }
  }

  return null;
}

function toLandmark(joint, options = {}) {
  if (Array.isArray(joint)) {
    return {
      x: normalizeCoordinate(joint[0], 0),
      y: normalizeCoordinate(joint[1], 0),
      z: normalizeCoordinate(joint[2], 0),
      visibility: normalizeVisibility(joint[3]),
    };
  }

  if (joint && typeof joint === "object") {
    return {
      x: normalizeCoordinate(joint.x ?? joint[0], 0),
      y: normalizeCoordinate(joint.y ?? joint[1], 0),
      z: normalizeCoordinate(joint.z ?? joint[2], 0),
      visibility: normalizeVisibility(joint.visibility ?? joint.confidence ?? joint.score),
    };
  }

  throw new Error(`Invalid joint at index ${options.index ?? "unknown"}.`);
}

function midpointLandmark(...landmarks) {
  const valid = landmarks.filter(Boolean);

  if (valid.length === 0) {
    return null;
  }

  return {
    x: valid.reduce((sum, landmark) => sum + landmark.x, 0) / valid.length,
    y: valid.reduce((sum, landmark) => sum + landmark.y, 0) / valid.length,
    z: valid.reduce((sum, landmark) => sum + (landmark.z ?? 0), 0) / valid.length,
    visibility: Math.min(...valid.map((landmark) => landmark.visibility ?? 1)),
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

function normalizeJointFormat(value) {
  const normalized = String(value || "mediapipe33").trim().toLowerCase().replace(/[_\s-]/g, "");

  if (normalized === "mediapipe" || normalized === "mediapipe33" || normalized === "mp33") {
    return "mediapipe33";
  }

  if (normalized === "coco" || normalized === "coco17" || normalized === "openpose17") {
    return "coco17";
  }

  throw new Error(`Unsupported --joint-format ${value}`);
}

function normalizeExtractor(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "external";
}

function normalizeCoordinate(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeVisibility(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 1;
}

function printUsage() {
  console.log(`Usage:
  node scripts/hmr-jsonl-adapter.mjs --input external-recording.json --output output/external-recording.jsonl
  node scripts/hmr-jsonl-adapter.mjs --input coco17-joints.json --joint-format coco17 --output output/external-recording.jsonl
  node scripts/hmr-jsonl-adapter.mjs external-recording.jsonl --stdout > normalized.jsonl

Input may use the action-tracker recording shape with source.type "external-hmr"
or a generic external joint-array shape with frames[].joints3d/worldJoints and
optional frames[].joints2d/imageJoints. Supported joint formats are mediapipe33
and coco17. The adapter validates 33 pose landmarks, 33 pose world landmarks,
optional 21-point hands, scalar metadata only, and then writes replayable motion
recording JSONL.
`);
}
