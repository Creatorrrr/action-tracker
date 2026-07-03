#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeMotionRecording,
  parseMotionRecordingJsonl,
} from "../src/motion-frame.js";
import { buildPosePoints } from "../src/solver/pose-solver.js";
import {
  DEPTH_CALIBRATION_SEGMENTS,
  bodyScale2D,
  normalizeDepthCalibrationReferenceProfile,
  segmentLengthRatio,
} from "../src/depth-calibration.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const DEFAULT_MIN_VISIBILITY = 0.5;

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

export {
  buildSamCalibrationProfile,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const recording = await loadRecording(args.input);
  const profile = buildSamCalibrationProfile(recording, {
    sourceRecording: args.input,
    minVisibility: args.minVisibility,
    ratioScale: args.ratioScale,
  });

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: profile.summary.segmentCount > 0 ? "passed" : "failed",
    outputPath: args.output || "",
    frameCount: profile.frameCount,
    usedFrames: profile.summary.usedFrames,
    segmentCount: profile.summary.segmentCount,
    gatedSegmentCount: profile.summary.gatedSegmentCount,
  }, null, 2));

  if (profile.summary.segmentCount === 0) {
    process.exitCode = 1;
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    input: "",
    output: "",
    minVisibility: DEFAULT_MIN_VISIBILITY,
    ratioScale: 1,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--input") {
      parsed.input = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--min-visibility") {
      parsed.minVisibility = Number(rawArgs[++index] ?? parsed.minVisibility);
    } else if (arg === "--ratio-scale") {
      parsed.ratioScale = Number(rawArgs[++index] ?? parsed.ratioScale);
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.minVisibility) || parsed.minVisibility < 0 || parsed.minVisibility > 1) {
    throw new Error("--min-visibility must be a number between 0 and 1.");
  }
  if (!Number.isFinite(parsed.ratioScale) || parsed.ratioScale <= 0) {
    throw new Error("--ratio-scale must be a positive number.");
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

function buildSamCalibrationProfile(recording, options = {}) {
  const normalizedRecording = normalizeMotionRecording(recording);
  const minVisibility = Number(options.minVisibility ?? DEFAULT_MIN_VISIBILITY);
  const ratioScale = Number(options.ratioScale ?? 1);
  const samplesBySegment = Object.fromEntries(
    DEPTH_CALIBRATION_SEGMENTS.map((segment) => [segment.name, []]),
  );
  let usedFrames = 0;

  for (const frame of normalizedRecording.frames) {
    const points = buildPosePoints(frame);
    const scale = bodyScale2D(points);
    let frameUsed = false;

    if (!Number.isFinite(scale) || scale <= 0.0001) {
      continue;
    }

    for (const segment of DEPTH_CALIBRATION_SEGMENTS) {
      if (!segmentVisible(points, segment, minVisibility)) {
        continue;
      }

      const ratio = segmentLengthRatio(points, segment, scale);

      if (!Number.isFinite(ratio) || ratio <= 0) {
        continue;
      }

      samplesBySegment[segment.name].push(ratio);
      frameUsed = true;
    }

    if (frameUsed) {
      usedFrames += 1;
    }
  }

  const segmentRatios = {};

  for (const segment of DEPTH_CALIBRATION_SEGMENTS) {
    const samples = samplesBySegment[segment.name] ?? [];

    if (samples.length === 0) {
      continue;
    }

    const sorted = samples.slice().sort((a, b) => a - b);
    const robustSamples = trimCentralRange(sorted, 0.1, 0.9);

    segmentRatios[segment.name] = {
      ratio: round(percentile(robustSamples, 0.5) * ratioScale, 6),
      cv: round(coefficientOfVariation(robustSamples), 6),
      samples: samples.length,
      group: segment.group,
      gated: Boolean(segment.gated),
      source: "external-profile",
    };
  }

  const normalizedProfile = normalizeDepthCalibrationReferenceProfile({
    version: 1,
    extractor: "sam-3d-body",
    sourceRecording: options.sourceRecording ?? "",
    createdAt: new Date().toISOString(),
    segmentRatios,
  });

  return {
    version: 1,
    extractor: "sam-3d-body",
    sourceRecording: options.sourceRecording ?? "",
    createdAt: normalizedProfile.createdAt,
    frameCount: normalizedRecording.frames.length,
    minVisibility,
    ratioScale,
    segmentRatios: normalizedProfile.segmentRatios,
    summary: {
      usedFrames,
      segmentCount: normalizedProfile.segmentCount,
      gatedSegmentCount: DEPTH_CALIBRATION_SEGMENTS
        .filter((segment) => segment.gated && normalizedProfile.referenceRatios[segment.name])
        .length,
    },
  };
}

function segmentVisible(points, segment, minVisibility) {
  const from = points?.[segment.from];
  const to = points?.[segment.to];

  if (!from || !to) {
    return false;
  }

  return Math.min(from.visibility ?? 1, to.visibility ?? 1) >= minVisibility;
}

function coefficientOfVariation(values) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);

  if (valid.length < 2) {
    return 0;
  }

  const center = percentile(valid, 0.5);
  const average = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance = valid.reduce((sum, value) => sum + (value - average) ** 2, 0) / valid.length;

  return center > 0 ? Math.sqrt(variance) / center : 0;
}

function trimCentralRange(sortedValues, lowerPercentile, upperPercentile) {
  if (sortedValues.length < 20) {
    return sortedValues;
  }

  const start = Math.floor(sortedValues.length * lowerPercentile);
  const end = Math.max(start + 1, Math.ceil(sortedValues.length * upperPercentile));

  return sortedValues.slice(start, end);
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );

  return sortedValues[index];
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sam-calibration-profile.mjs --input output/external/sam-3d-body/<clip>/recording.jsonl --output output/external/sam-3d-body/<clip>/calibration-profile.json

Reads an action-tracker motion recording converted from SAM-3D-Body MHR70 data
and writes an external segment-ratio profile for dynamic depth calibration. Use
--ratio-scale to add conservative length padding when clamp ratio is too high.
`);
}
