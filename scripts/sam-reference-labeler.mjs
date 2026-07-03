#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeMotionRecording,
  parseMotionRecordingJsonl,
} from "../src/motion-frame.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const VISIBILITY_THRESHOLD = 0.35;
const BEHIND_BACK_EPSILON = 0.08;
const CROSSED_ARM_EPSILON = 0.05;
const POSE = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

export {
  labelSamReferenceFrame,
  labelSamReferenceRecording,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const recording = await loadRecording(args.input);
  const labels = labelSamReferenceRecording(recording, {
    sourceRecording: args.input,
  });

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(labels, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: "passed",
    outputPath: args.output || "",
    frameCount: labels.frames.length,
    windowCount: labels.windows.length,
    summary: labels.summary,
  }, null, 2));
}

function parseArgs(rawArgs) {
  const parsed = {
    input: "",
    output: "",
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--input") {
      parsed.input = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
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

async function loadRecording(inputPath) {
  const absolutePath = path.resolve(projectRoot, inputPath);
  const source = await readFile(absolutePath, "utf8");
  const parsed = inputPath.endsWith(".jsonl")
    ? parseMotionRecordingJsonl(source)
    : JSON.parse(source);

  return normalizeMotionRecording(parsed);
}

function labelSamReferenceRecording(recording, options = {}) {
  const normalizedRecording = normalizeMotionRecording(recording);
  const frames = normalizedRecording.frames.map((frame, index) => labelSamReferenceFrame(frame, index));
  const windows = buildWindows(frames);

  return {
    version: 1,
    sourceRecording: options.sourceRecording ?? "",
    frameCount: frames.length,
    frames,
    windows,
    summary: summarizeLabels(frames, windows),
  };
}

function labelSamReferenceFrame(frame, index = 0) {
  const world = Array.isArray(frame?.poseWorldLandmarks) ? frame.poseWorldLandmarks : [];
  const image = Array.isArray(frame?.poseLandmarks) ? frame.poseLandmarks : [];
  const bodyBasis = estimateBodyBasis(world);
  const facingYawDeg = bodyBasis ? bodyBasis.yawDeg : 0;
  const facingState = classifyFacingYaw(facingYawDeg, bodyBasis?.confidence ?? 0);
  const lowConf2dCount = image.filter((landmark) => !isVisible(landmark)).length;
  const lowConf2d = image.length > 0 && lowConf2dCount / image.length >= 0.25;
  const bodyCoverage = classifyBodyCoverage(world);
  const armLabels = classifyArms(world, bodyBasis);

  return {
    index,
    timestamp: Number(frame?.timestamp ?? 0),
    videoTime: Number.isFinite(Number(frame?.sourceMeta?.videoTime))
      ? Number(frame.sourceMeta.videoTime)
      : Number(frame?.timestamp ?? 0) / 1000,
    facingYawDeg: round(facingYawDeg, 3),
    facingState,
    facingConfidence: round(bodyBasis?.confidence ?? 0, 3),
    leftArm: armLabels.leftArm,
    rightArm: armLabels.rightArm,
    crossedArms: armLabels.crossedArms,
    bodyCoverage,
    lowConf2d,
    lowConf2dCount,
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

function classifyFacingYaw(yawDeg, confidence) {
  if (confidence < VISIBILITY_THRESHOLD) {
    return "unknown";
  }

  const absYaw = Math.abs(normalizeAngleDeg(yawDeg));

  if (absYaw < 60) {
    return "front";
  }
  if (absYaw > 120) {
    return "back";
  }

  return yawDeg >= 0 ? "side-left" : "side-right";
}

function classifyArms(world, bodyBasis) {
  const leftWrist = point(world[POSE.leftWrist]);
  const rightWrist = point(world[POSE.rightWrist]);

  if (!bodyBasis || !leftWrist || !rightWrist) {
    return {
      leftArm: "unknown",
      rightArm: "unknown",
      crossedArms: false,
    };
  }

  const leftDepth = dot(subtract(leftWrist, bodyBasis.shoulderMid), bodyBasis.forward);
  const rightDepth = dot(subtract(rightWrist, bodyBasis.shoulderMid), bodyBasis.forward);
  const leftLateral = dot(subtract(leftWrist, bodyBasis.shoulderMid), bodyBasis.across);
  const rightLateral = dot(subtract(rightWrist, bodyBasis.shoulderMid), bodyBasis.across);
  const leftBehind = leftDepth > BEHIND_BACK_EPSILON;
  const rightBehind = rightDepth > BEHIND_BACK_EPSILON;
  const leftCrossed = leftLateral < -CROSSED_ARM_EPSILON;
  const rightCrossed = rightLateral > CROSSED_ARM_EPSILON;
  const crossedArms = leftCrossed && rightCrossed;

  return {
    leftArm: leftBehind ? "behind-back" : leftCrossed ? "crossed" : "visible",
    rightArm: rightBehind ? "behind-back" : rightCrossed ? "crossed" : "visible",
    crossedArms,
  };
}

function classifyBodyCoverage(world) {
  const upperVisible = [
    world[POSE.leftShoulder],
    world[POSE.rightShoulder],
    world[POSE.leftElbow],
    world[POSE.rightElbow],
  ].filter(isVisible).length;
  const hipVisible = [world[POSE.leftHip], world[POSE.rightHip]].filter(isVisible).length;
  const lowerVisible = [
    world[POSE.leftKnee],
    world[POSE.rightKnee],
    world[POSE.leftAnkle],
    world[POSE.rightAnkle],
  ].filter(isVisible).length;

  if (upperVisible >= 3 && hipVisible >= 2 && lowerVisible >= 3) {
    return "full";
  }
  if (upperVisible >= 3 && hipVisible >= 1) {
    return "upper-body";
  }
  if (upperVisible > 0 || hipVisible > 0 || lowerVisible > 0) {
    return "partial";
  }
  return "lost";
}

function buildWindows(frames) {
  const windowKinds = [
    ["back-facing", (frame) => frame.facingState === "back"],
    ["side-facing", (frame) => frame.facingState === "side-left" || frame.facingState === "side-right"],
    ["crossed-arms", (frame) => frame.crossedArms],
    ["left-behind-back", (frame) => frame.leftArm === "behind-back"],
    ["right-behind-back", (frame) => frame.rightArm === "behind-back"],
    ["low-conf-2d", (frame) => frame.lowConf2d],
    ["upper-body", (frame) => frame.bodyCoverage === "upper-body"],
  ];
  const windows = [];

  for (const [kind, predicate] of windowKinds) {
    let start = null;

    frames.forEach((frame, index) => {
      if (predicate(frame)) {
        start ??= index;
      }

      const atEnd = index === frames.length - 1;
      const closes = start !== null && (!predicate(frame) || atEnd);

      if (closes) {
        const endIndex = predicate(frame) && atEnd ? index : index - 1;
        windows.push({
          kind,
          startIndex: start,
          endIndex,
          startMs: round(frames[start].timestamp, 3),
          endMs: round(frames[endIndex].timestamp, 3),
          frameCount: endIndex - start + 1,
        });
        start = null;
      }
    });
  }

  return windows.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind));
}

function summarizeLabels(frames, windows) {
  const countByFacing = countBy(frames, "facingState");
  const countByCoverage = countBy(frames, "bodyCoverage");

  return {
    facing: countByFacing,
    coverage: countByCoverage,
    lowConf2dFrames: frames.filter((frame) => frame.lowConf2d).length,
    crossedArmFrames: frames.filter((frame) => frame.crossedArms).length,
    behindBackFrames: frames.filter((frame) =>
      frame.leftArm === "behind-back" || frame.rightArm === "behind-back"
    ).length,
    windowsByKind: countBy(windows, "kind"),
  };
}

function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function point(landmark) {
  if (!landmark || !Number.isFinite(Number(landmark.x)) || !Number.isFinite(Number(landmark.y))) {
    return null;
  }

  return {
    x: Number(landmark.x),
    y: Number(landmark.y),
    z: Number(landmark.z ?? 0),
    visibility: Number.isFinite(Number(landmark.visibility)) ? Number(landmark.visibility) : 1,
  };
}

function isVisible(landmark) {
  return Boolean(landmark) &&
    Number.isFinite(Number(landmark.x)) &&
    Number.isFinite(Number(landmark.y)) &&
    Number(landmark.visibility ?? 1) >= VISIBILITY_THRESHOLD &&
    Number(landmark.presence ?? 1) >= VISIBILITY_THRESHOLD;
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

function printUsage() {
  console.log(`Usage:
  node scripts/sam-reference-labeler.mjs --input output/external/sam-3d-body/<clip>/recording.jsonl --output output/external/sam-3d-body/<clip>/labels.json

Reads an action-tracker motion recording converted from SAM-3D-Body MHR70 data
and writes frame/window labels for facing, crossed/behind-back arms, body
coverage, and low-confidence 2D intervals.
`);
}
