#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = "output/reports/head-pose-smoke-latest.json";
const defaultMotionOutput = "output/reports/head-pose-smoke-motion-latest.json";

const args = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(projectRoot, args.output ?? defaultOutput);
const motionOutputPath = path.resolve(projectRoot, args.motionOutput ?? defaultMotionOutput);
const models = args.models.length > 0
  ? args.models
  : ["Xbot=assets/models/Xbot.glb"];
const agreementArgs = [
  "scripts/avatar-motion-agreement-check.mjs",
  "--only-models",
  "--measurement-only",
  "--debug-overlay",
  "off",
  "--min-pose-frames",
  String(args.minPoseFrames ?? 80),
  "--warmup-pose-frames",
  String(args.warmupPoseFrames ?? 20),
  "--timeout-ms",
  String(args.timeoutMs ?? 180000),
  "--output",
  path.relative(projectRoot, motionOutputPath),
];

for (const model of models) {
  agreementArgs.push("--model", model);
}

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

const motionReport = JSON.parse(await readFile(motionOutputPath, "utf8"));
const modelReports = (motionReport.videos ?? [])
  .flatMap((video) => (video.models ?? []).map((model) => summarizeModel(video, model)));
const failedModels = modelReports.filter((model) => !model.passed);
const output = {
  status: failedModels.length === 0 ? "passed" : "failed",
  thresholds: {
    minSignMatchRate: 0.9,
    minYawCorrelation: 0.8,
    maxJumpCount: 0,
    maxBoneAngularVelocityDegPerSec: 600,
    minHeadRestForwardDot: 0.75,
  },
  motionReport: path.relative(projectRoot, motionOutputPath),
  models: modelReports,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

for (const model of modelReports) {
  const face = model.faceHeadPose;
  const faceSummary = face.yawPairCount > 0
    ? `sign ${(face.signMatchRate ?? 0).toFixed(2)}, corr ${formatNullable(face.yawCorrelation)}, jumps ${face.jumpCount}`
    : "face yaw unavailable";
  console.log(`${model.label}: ${model.passed ? "passed" : "failed"} (${faceSummary}, head rest dot ${formatNullable(model.headRestForwardDot)})`);

  for (const warning of model.warnings) {
    console.warn(`  warning: ${warning}`);
  }
}

console.log(`Head pose smoke ${output.status}. Report: ${path.relative(projectRoot, outputPath)}`);
process.exit(failedModels.length === 0 ? 0 : 1);

function summarizeModel(video, model) {
  const report = model.report ?? {};
  const face = report.body?.faceHeadPose ?? {};
  const headRestForwardDot = Number(report.rig?.boneOrientation?.byBone?.Head?.restForwardDot);
  const headSegment = report.body?.bySegment?.head ?? null;
  const warnings = [];
  let passed = true;

  if (face.yawPairCount >= 3 && face.signComparableCount >= 3) {
    if (!Number.isFinite(face.signMatchRate) || face.signMatchRate < 0.9) {
      passed = false;
      warnings.push(`face/bone yaw sign match below 0.9 (${formatNullable(face.signMatchRate)})`);
    }

    if (Number.isFinite(face.yawCorrelation) && face.yawCorrelation < 0.8) {
      passed = false;
      warnings.push(`face/bone yaw correlation below 0.8 (${formatNullable(face.yawCorrelation)})`);
    } else if (!Number.isFinite(face.yawCorrelation)) {
      warnings.push("face/bone yaw correlation unavailable, likely low yaw variance in sample");
    }
  } else {
    warnings.push("not enough comparable face/bone yaw samples; treating as diagnostic-only for this clip");
  }

  if ((face.jumpCount ?? 0) > 0) {
    passed = false;
    warnings.push(`face head jump count is ${face.jumpCount}`);
  }

  if (
    Number.isFinite(face.maxBoneAngularVelocityDegPerSec) &&
    face.maxBoneAngularVelocityDegPerSec > 600
  ) {
    passed = false;
    warnings.push(`head angular velocity exceeds 600deg/s (${face.maxBoneAngularVelocityDegPerSec.toFixed(1)})`);
  }

  if (Number.isFinite(headRestForwardDot) && headRestForwardDot < 0.75) {
    passed = false;
    warnings.push(`Head rest forward dot below 0.75 (${headRestForwardDot.toFixed(3)})`);
  }

  return {
    videoLabel: video.label ?? video.path ?? "",
    label: model.label,
    modelPath: model.modelPath,
    passed,
    warnings,
    faceHeadPose: face,
    headRestForwardDot: Number.isFinite(headRestForwardDot) ? headRestForwardDot : null,
    headSegment,
  };
}

function parseArgs(rawArgs) {
  const parsed = {
    models: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--model") {
      parsed.models.push(rawArgs[++index] ?? "");
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--motion-output") {
      parsed.motionOutput = rawArgs[++index] ?? "";
    } else if (arg === "--min-pose-frames") {
      parsed.minPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--warmup-pose-frames") {
      parsed.warmupPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(rawArgs[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printUsageAndExit();
    }
  }

  parsed.models = parsed.models.filter(Boolean);
  return parsed;
}

function printUsageAndExit() {
  console.log(`Usage: node scripts/head-pose-smoke.mjs [options]

Options:
  --model <Label=path>          Model to validate. Repeatable.
  --output <path>               Head pose smoke JSON output.
  --motion-output <path>        Raw motion agreement JSON output.
  --min-pose-frames <n>         Minimum pose frames. Default 80.
  --warmup-pose-frames <n>      Warmup pose frames. Default 20.
  --timeout-ms <n>              Browser timeout. Default 180000.
`);
  process.exit(0);
}

function formatNullable(value) {
  return Number.isFinite(value) ? Number(value).toFixed(3) : "n/a";
}
