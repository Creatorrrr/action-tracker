#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMotionRecordingJsonl } from "../src/motion-frame.js";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultVideo = "output/test-videos/shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4";
const defaultOutput = "output/reports/root-yaw-recovery-latest.json";
const defaultMotionOutput = "output/reports/root-yaw-recovery-motion-latest.json";
const defaultRecordingOutput = "output/reports/root-yaw-recovery-recording-latest.jsonl";
const defaultModel = "Xbot=assets/models/Xbot.glb";

const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(projectRoot, args.output ?? defaultOutput);
const motionOutputPath = path.resolve(projectRoot, args.motionOutput ?? defaultMotionOutput);
const recordingOutputPath = path.resolve(projectRoot, args.recordingOutput ?? defaultRecordingOutput);
const videoPath = args.video ?? defaultVideo;
const model = args.model ?? defaultModel;
const windowStartSec = Number(args.windowStartSec ?? 8.5);
const windowEndSec = Number(args.windowEndSec ?? 11.5);
const thresholds = {
  maxRootYawTargetP90Deg: Number(args.maxRootYawTargetP90Deg ?? 45),
  maxRootYawTargetMedianDeg: Number(args.maxRootYawTargetMedianDeg ?? 20),
  minWindowSamples: Math.max(1, Math.trunc(Number(args.minWindowSamples ?? 6))),
  minRecoveringSamples: Math.max(0, Math.trunc(Number(args.minRecoveringSamples ?? 0))),
  minStableAfterUnreliableSamples: Math.max(0, Math.trunc(Number(args.minStableAfterUnreliableSamples ?? 1))),
  minRootYawRecoveryTelemetrySamples: Math.max(0, Math.trunc(Number(args.minRootYawRecoveryTelemetrySamples ?? 1))),
};

if (!args.skipRun) {
  const agreementArgs = [
    "scripts/avatar-motion-agreement-check.mjs",
    "--video",
    videoPath,
    "--only-models",
    "--model",
    model,
    "--output",
    path.relative(projectRoot, motionOutputPath),
    "--recording-output",
    path.relative(projectRoot, recordingOutputPath),
    "--min-pose-frames",
    String(args.minPoseFrames ?? 260),
    "--warmup-pose-frames",
    String(args.warmupPoseFrames ?? 20),
    "--timeout-ms",
    String(args.timeoutMs ?? 240000),
    "--debug-overlay",
    "off",
    "--measurement-only",
  ];

  const result = spawnSync(process.execPath, agreementArgs, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
}

const motionReport = JSON.parse(await readFile(motionOutputPath, "utf8"));
const recording = parseMotionRecordingJsonl(await readFile(recordingOutputPath, "utf8"));
const modelReport = motionReport.models?.[0] ?? motionReport.videos?.[0]?.models?.[0] ?? {};
const rootYaw = modelReport.report?.body?.sourceAvatarDivergence?.rootYaw ?? {};
const solverWindow = summarizeSolverWindow(recording, windowStartSec, windowEndSec);
const failures = [];
const warnings = [];

if (Number(rootYaw.count ?? 0) <= 0) {
  failures.push("root yaw summary has no rows");
}

const rootYawTargetCount = Number(rootYaw.targetError?.count);
const rootYawTargetP90Deg = Number(rootYaw.targetError?.p90ErrorDeg);
const rootYawTargetMedianDeg = Number(rootYaw.targetError?.medianErrorDeg);
const rootYawRecoveryTelemetryCount = Number(rootYaw.recoveringCount ?? 0) +
  Number(rootYaw.stableAfterUnreliableCount ?? 0);

if (!Number.isFinite(rootYawTargetCount) || rootYawTargetCount <= 0) {
  failures.push("root yaw target error summary has no rows");
}

if (!Number.isFinite(rootYawTargetP90Deg)) {
  failures.push("root yaw target p90 is unavailable");
} else if (rootYawTargetP90Deg > thresholds.maxRootYawTargetP90Deg) {
  failures.push(
    `root yaw target p90 ${formatNumber(rootYawTargetP90Deg)}deg > ${thresholds.maxRootYawTargetP90Deg}deg`,
  );
}

if (!Number.isFinite(rootYawTargetMedianDeg)) {
  failures.push("root yaw target median is unavailable");
} else if (rootYawTargetMedianDeg > thresholds.maxRootYawTargetMedianDeg) {
  failures.push(
    `root yaw target median ${formatNumber(rootYawTargetMedianDeg)}deg > ${thresholds.maxRootYawTargetMedianDeg}deg`,
  );
}

if (rootYawRecoveryTelemetryCount < thresholds.minRootYawRecoveryTelemetrySamples) {
  failures.push(
    `browser root yaw recovery telemetry samples ${rootYawRecoveryTelemetryCount} < ` +
    `${thresholds.minRootYawRecoveryTelemetrySamples}`,
  );
}

if (solverWindow.count < thresholds.minWindowSamples) {
  failures.push(
    `solver window sample count ${solverWindow.count} < ${thresholds.minWindowSamples}`,
  );
}

if (solverWindow.recoveringCount < thresholds.minRecoveringSamples) {
  failures.push(
    `solver recovering samples ${solverWindow.recoveringCount} < ${thresholds.minRecoveringSamples}`,
  );
}

if (solverWindow.stableAfterUnreliableCount < thresholds.minStableAfterUnreliableSamples) {
  failures.push(
    `solver stable-after-unreliable samples ${solverWindow.stableAfterUnreliableCount} < ` +
    `${thresholds.minStableAfterUnreliableSamples}`,
  );
}

if (solverWindow.unreliableCount <= 0) {
  warnings.push("no unreliable yaw samples observed in the target window");
}

if (Number(rootYaw.recoveringCount ?? 0) <= 0) {
  warnings.push("browser report did not capture an explicit root yaw recovery sample");
}

const output = {
  status: failures.length === 0 ? "passed" : "failed",
  video: videoPath,
  model,
  thresholds,
  motionReport: path.relative(projectRoot, motionOutputPath),
  recording: path.relative(projectRoot, recordingOutputPath),
  rootYaw,
  solverWindow,
  warnings,
  failures,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

console.log(
  `Root yaw recovery ${output.status}: p90 ${formatNullable(rootYaw.targetError?.p90ErrorDeg)}deg, ` +
  `median ${formatNullable(rootYaw.targetError?.medianErrorDeg)}deg, ` +
  `window recovering ${solverWindow.recoveringCount}/${solverWindow.count}, ` +
  `stable-after-unreliable ${solverWindow.stableAfterUnreliableCount}.`,
);
for (const warning of warnings) {
  console.warn(`  warning: ${warning}`);
}
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`  failure: ${failure}`);
  }
}
console.log(`Report: ${path.relative(projectRoot, outputPath)}`);

process.exit(failures.length === 0 ? 0 : 1);

function summarizeSolverWindow(recording, startSec, endSec) {
  const rows = [];
  let previousState = {};
  let previousVideoTime = null;

  for (const frame of recording.frames ?? []) {
    const videoTime = Number(frame.sourceMeta?.videoTime);

    if (Number.isFinite(previousVideoTime) && Number.isFinite(videoTime) && videoTime + 0.25 < previousVideoTime) {
      previousState = {};
    }

    const solved = solvePoseFrame(frame, previousState, { timestamp: frame.timestamp });
    previousState = solved.state ?? {};

    if (Number.isFinite(videoTime) && videoTime >= startSec && videoTime <= endSec) {
      rows.push({
        videoTime,
        yawDeg: solved.meta.facingYawDeg,
        unwrappedYawDeg: solved.meta.facingUnwrappedYawDeg,
        rawYawDeg: solved.meta.facingRawYawDeg,
        rawYawJump: solved.meta.facingRawYawJump,
        sideOrderFlip: solved.meta.facingSideOrderFlip,
        reliable: solved.meta.facingYawReliable,
        reliabilityReason: solved.meta.facingYawReliabilityReason,
        unreliableFrames: solved.meta.facingUnreliableYawFrames,
        recovering: solved.meta.facingRecoveringFromUnreliableYaw,
        recoveryTargetYawDeg: solved.meta.facingRecoveryTargetYawDeg,
      });
    }

    previousVideoTime = videoTime;
  }

  const yawValues = rows
    .map((row) => Number(row.unwrappedYawDeg))
    .filter(Number.isFinite);

  return {
    windowStartSec: startSec,
    windowEndSec: endSec,
    count: rows.length,
    unreliableCount: rows.filter((row) => row.reliable === false).length,
    recoveringCount: rows.filter((row) => row.recovering).length,
    rawJumpCount: rows.filter((row) => row.rawYawJump).length,
    sideOrderFlipCount: rows.filter((row) => row.sideOrderFlip).length,
    stableAfterUnreliableCount: countStableAfterUnreliable(rows),
    maxUnreliableFrames: Math.max(0, ...rows.map((row) => Number(row.unreliableFrames) || 0)),
    reliabilityReasons: countBy(rows.map((row) => row.reliabilityReason).filter(Boolean)),
    firstYawDeg: yawValues.length > 0 ? round(yawValues[0], 3) : null,
    lastYawDeg: yawValues.length > 0 ? round(yawValues.at(-1), 3) : null,
    rows: rows.slice(0, 40),
  };
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--video") {
      parsed.video = rawArgs[++index];
    } else if (arg === "--model") {
      parsed.model = rawArgs[++index];
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index];
    } else if (arg === "--motion-output") {
      parsed.motionOutput = rawArgs[++index];
    } else if (arg === "--recording-output") {
      parsed.recordingOutput = rawArgs[++index];
    } else if (arg === "--window-start-sec") {
      parsed.windowStartSec = Number(rawArgs[++index]);
    } else if (arg === "--window-end-sec") {
      parsed.windowEndSec = Number(rawArgs[++index]);
    } else if (arg === "--min-pose-frames") {
      parsed.minPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--warmup-pose-frames") {
      parsed.warmupPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(rawArgs[++index]);
    } else if (arg === "--max-root-yaw-target-p90-deg") {
      parsed.maxRootYawTargetP90Deg = Number(rawArgs[++index]);
    } else if (arg === "--max-root-yaw-target-median-deg") {
      parsed.maxRootYawTargetMedianDeg = Number(rawArgs[++index]);
    } else if (arg === "--min-window-samples") {
      parsed.minWindowSamples = Number(rawArgs[++index]);
    } else if (arg === "--min-recovering-samples") {
      parsed.minRecoveringSamples = Number(rawArgs[++index]);
    } else if (arg === "--min-stable-after-unreliable-samples") {
      parsed.minStableAfterUnreliableSamples = Number(rawArgs[++index]);
    } else if (arg === "--min-root-yaw-recovery-telemetry-samples") {
      parsed.minRootYawRecoveryTelemetrySamples = Number(rawArgs[++index]);
    } else if (arg === "--skip-run") {
      parsed.skipRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    }
  }

  return parsed;
}

function printUsageAndExit() {
  console.log(`Usage: node scripts/root-yaw-recovery-smoke.mjs [options]

Options:
  --video <path>                         Video path. Default: ${defaultVideo}
  --model <Label=path>                   Model to validate. Default: ${defaultModel}
  --output <path>                        Root yaw smoke JSON output.
  --motion-output <path>                 Raw motion agreement JSON output.
  --recording-output <path>              Motion recording JSONL output.
  --window-start-sec <n>                 Solver analysis window start. Default 8.5.
  --window-end-sec <n>                   Solver analysis window end. Default 11.5.
  --min-recovering-samples <n>           Required explicit solver recovery samples. Default 0.
  --min-stable-after-unreliable-samples <n>
                                           Required stable reacquire samples after unreliable hold. Default 1.
  --min-root-yaw-recovery-telemetry-samples <n>
                                           Required browser report recovery telemetry samples. Default 1.
  --skip-run                             Reuse existing motion/recording outputs.
`);
  process.exit(0);
}

function countStableAfterUnreliable(rows) {
  let count = 0;
  let previousWasUnreliable = false;

  for (const row of rows) {
    if (previousWasUnreliable && row.reliable === true) {
      count += 1;
    }

    previousWasUnreliable = row.reliable === false;
  }

  return count;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatNullable(value) {
  return Number.isFinite(Number(value)) ? formatNumber(value) : "n/a";
}

function formatNumber(value) {
  return Number(value).toFixed(3);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}
