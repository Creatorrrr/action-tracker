#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportDir = path.resolve(projectRoot, "output/reports");
const modes = ["raf", "rvfc"];
const defaults = {
  model: "Xbot=assets/models/Xbot.glb",
  minPoseFrames: "180",
  warmupPoseFrames: "90",
  timeoutMs: "240000",
  debugOverlay: "on",
};

await main();

async function main() {
  await mkdir(reportDir, { recursive: true });

  const runs = [];

  for (const mode of modes) {
    const outputPath = path.join(reportDir, `frame-pump-${mode}-latest.json`);
    await runMotionCheck(mode, outputPath);
    const report = JSON.parse(await readFile(outputPath, "utf8"));
    runs.push({
      mode,
      outputPath: path.relative(projectRoot, outputPath),
      report,
      summary: extractRunSummary(report),
    });
  }

  const comparison = buildComparison(runs);
  const comparisonPath = path.join(reportDir, "frame-pump-comparison-latest.json");
  await writeFile(comparisonPath, `${JSON.stringify(comparison, null, 2)}\n`);

  printComparison(comparison, path.relative(projectRoot, comparisonPath));

  if (!comparison.passed) {
    process.exitCode = 1;
  }
}

function runMotionCheck(mode, outputPath) {
  const args = [
    "scripts/avatar-motion-agreement-check.mjs",
    "--only-models",
    "--model",
    defaults.model,
    "--pump",
    mode,
    "--debug-overlay",
    defaults.debugOverlay,
    "--min-pose-frames",
    defaults.minPoseFrames,
    "--warmup-pose-frames",
    defaults.warmupPoseFrames,
    "--timeout-ms",
    defaults.timeoutMs,
    "--output",
    path.relative(projectRoot, outputPath),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`frame pump ${mode} run failed with exit code ${code}`));
      }
    });
  });
}

function extractRunSummary(report) {
  const model = report.models?.[0];
  const summary = model?.summary ?? {};

  return {
    modelLabel: model?.label ?? "",
    failures: model?.failures ?? [],
    warnings: model?.warnings ?? [],
    overallScore: summary.overallScore ?? 0,
    framesWithPose: summary.framesWithPose ?? 0,
    pumpMode: summary.pumpMode,
    pumpRequestedMode: summary.pumpRequestedMode,
    pumpCallbacks: summary.pumpCallbacks ?? 0,
    pumpProcessedFrames: summary.pumpProcessedFrames ?? 0,
    pumpDuplicateFrames: summary.pumpDuplicateFrames ?? 0,
    appDetectP95Ms: summary.appDetectP95Ms ?? 0,
    appProcessP95Ms: summary.appProcessP95Ms ?? 0,
    appDrawP95Ms: summary.appDrawP95Ms ?? 0,
    appFrameTotalP95Ms: summary.appFrameTotalP95Ms ?? 0,
    appCallbackFps: summary.appCallbackFps ?? 0,
    appDetectionFps: summary.appDetectionFps ?? 0,
  };
}

function buildComparison(runs) {
  const raf = runs.find((run) => run.mode === "raf")?.summary;
  const rvfc = runs.find((run) => run.mode === "rvfc")?.summary;
  const failures = [];

  if (!raf || !rvfc) {
    failures.push("missing raf or rvfc run summary");
  }

  if (rvfc && rvfc.pumpMode !== "rvfc") {
    failures.push(`rvfc run used ${rvfc.pumpMode || "unknown"} pump`);
  }

  if (rvfc && rvfc.overallScore < 0.95) {
    failures.push(`rvfc motion agreement ${(rvfc.overallScore * 100).toFixed(1)}% < 95%`);
  }

  const callbackReduction = reductionRatio(raf?.pumpCallbacks, rvfc?.pumpCallbacks);
  const duplicateReduction = reductionRatio(raf?.pumpDuplicateFrames, rvfc?.pumpDuplicateFrames);
  const frameTotalRatio = safeRatio(rvfc?.appFrameTotalP95Ms, raf?.appFrameTotalP95Ms);
  const frameTotalReduction = reductionRatio(raf?.appFrameTotalP95Ms, rvfc?.appFrameTotalP95Ms);
  const detectReduction = reductionRatio(raf?.appDetectP95Ms, rvfc?.appDetectP95Ms);
  const hasCallbackWin = Number.isFinite(callbackReduction) && callbackReduction >= 0.2;
  const hasDuplicateWin = Number.isFinite(duplicateReduction) && duplicateReduction >= 0.5;
  const hasLatencyWin = (
    (Number.isFinite(frameTotalReduction) && frameTotalReduction >= 0.1) ||
    (Number.isFinite(detectReduction) && detectReduction >= 0.1)
  );

  if (!hasCallbackWin && !hasDuplicateWin && !hasLatencyWin) {
    failures.push(
      `rvfc did not reduce callbacks, duplicate frames, or p95 latency enough `
      + `(callback reduction ${formatPercent(callbackReduction)}, duplicate reduction ${formatPercent(duplicateReduction)}, `
      + `frame p95 reduction ${formatPercent(frameTotalReduction)}, detect p95 reduction ${formatPercent(detectReduction)})`,
    );
  }

  if (Number.isFinite(frameTotalRatio) && frameTotalRatio > 1.25) {
    failures.push(
      `rvfc frame p95 regressed ${(frameTotalRatio * 100).toFixed(1)}% of raf (>125%)`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    gates: {
      minCallbackReduction: 0.2,
      minDuplicateReduction: 0.5,
      minLatencyP95Reduction: 0.1,
      maxFrameTotalP95RegressionRatio: 1.25,
      minMotionAgreement: 0.95,
    },
    passed: failures.length === 0,
    failures,
    runs: Object.fromEntries(runs.map((run) => [run.mode, {
      outputPath: run.outputPath,
      ...run.summary,
    }])),
    comparison: {
      callbackReduction,
      duplicateReduction,
      frameTotalP95Reduction: frameTotalReduction,
      detectP95Reduction: detectReduction,
      frameTotalP95Ratio: frameTotalRatio,
      detectP95DeltaMs: (rvfc?.appDetectP95Ms ?? 0) - (raf?.appDetectP95Ms ?? 0),
      processP95DeltaMs: (rvfc?.appProcessP95Ms ?? 0) - (raf?.appProcessP95Ms ?? 0),
    },
  };
}

function reductionRatio(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) {
    return null;
  }

  return (before - after) / before;
}

function safeRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return numerator / denominator;
}

function printComparison(comparison, relativePath) {
  const raf = comparison.runs.raf;
  const rvfc = comparison.runs.rvfc;

  console.log("Frame pump performance comparison:");
  console.log(`- RAF callbacks=${raf.pumpCallbacks}, duplicates=${raf.pumpDuplicateFrames}, frame p95=${formatMs(raf.appFrameTotalP95Ms)}, motion=${formatPercent(raf.overallScore)}`);
  console.log(`- rVFC callbacks=${rvfc.pumpCallbacks}, duplicates=${rvfc.pumpDuplicateFrames}, frame p95=${formatMs(rvfc.appFrameTotalP95Ms)}, motion=${formatPercent(rvfc.overallScore)}`);
  console.log(`- callback reduction=${formatPercent(comparison.comparison.callbackReduction)}, duplicate reduction=${formatPercent(comparison.comparison.duplicateReduction)}`);
  console.log(`- frame p95 reduction=${formatPercent(comparison.comparison.frameTotalP95Reduction)}, detect p95 reduction=${formatPercent(comparison.comparison.detectP95Reduction)}`);
  console.log(`Report: ${relativePath}`);

  if (comparison.passed) {
    console.log("Frame pump performance check passed.");
  } else {
    console.error(`Frame pump performance check failed with ${comparison.failures.length} issue(s):`);
    for (const failure of comparison.failures) {
      console.error(`- ${failure}`);
    }
  }
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "n/a";
}
