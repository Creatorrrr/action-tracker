#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  compareRetargetReports,
  renderRetargetComparisonHtml,
} from "../scripts/retarget-mode-compare.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const legacyReport = report("legacy", {
  angularP90: 42,
  angularMax: 90,
  palm: 0.25,
  root: 18,
  solver: 0.3,
});
const strictReport = report("strict", {
  angularP90: 21,
  angularMax: 44,
  palm: 0,
  root: 5,
  solver: 0.34,
});
const comparison = compareRetargetReports(legacyReport, strictReport, {
  legacyPath: "legacy.json",
  strictPath: "strict.json",
});

assert.equal(comparison.comparisonType, "retarget-mode-report-comparison");
assert.equal(comparison.summary.pairCount, 1);
assert.equal(comparison.summary.strictImprovedAngularP90, true);
assert.equal(comparison.summary.strictImprovedAngularMax, true);
assert.equal(comparison.summary.strictImprovedPalmInversion, true);
assert.equal(comparison.summary.strictImprovedRootYaw, true);
assert.equal(comparison.summary.strictPoseSolverWithinBudget, true);
assert.equal(comparison.summary.passed, true);
assert.equal(comparison.pairs[0].deltas.angularP90Deg, -21);
assert.equal(comparison.pairs[0].deltas.palmInversionRatio, -0.25);

const palmRegression = compareRetargetReports(
  legacyReport,
  report("strict", {
    angularP90: 20,
    angularMax: 40,
    palm: 0.5,
    root: 4,
    solver: 0.3,
  }),
);

assert.equal(palmRegression.summary.strictImprovedAngularP90, true);
assert.equal(palmRegression.summary.strictImprovedPalmInversion, false);
assert.equal(palmRegression.summary.passed, false);

const rootRegression = compareRetargetReports(
  legacyReport,
  report("strict", {
    angularP90: 20,
    angularMax: 40,
    palm: 0,
    root: 22,
    solver: 0.3,
  }),
);

assert.equal(rootRegression.summary.strictImprovedAngularP90, true);
assert.equal(rootRegression.summary.strictImprovedRootYaw, false);
assert.equal(rootRegression.summary.passed, false);

const html = renderRetargetComparisonHtml(comparison);
assert.match(html, /Retarget Mode Comparison/);
assert.match(html, /Strict Angular P90/);

const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-retarget-compare-"));
const legacyPath = path.join(tempDir, "legacy.json");
const strictPath = path.join(tempDir, "strict.json");
const outputPath = path.join(tempDir, "comparison.json");

await writeFile(legacyPath, `${JSON.stringify(legacyReport)}\n`);
await writeFile(strictPath, `${JSON.stringify(strictReport)}\n`);

const cli = spawnSync(process.execPath, [
  "scripts/retarget-mode-compare.mjs",
  "--legacy",
  legacyPath,
  "--strict",
  strictPath,
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});

assert.equal(cli.status, 0, cli.stderr || cli.stdout);
const cliOutput = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(cliOutput.summary.strictImprovedAngularP90, true);

console.log("Retarget mode compare check passed.");

function report(mode, values) {
  return {
    generatedAt: "2026-07-04T00:00:00.000Z",
    models: [
      {
        label: "Xbot",
        videoLabel: "synthetic",
        summary: {
          avatarRetargetMode: mode,
          framesWithPose: 100,
          overallPercent: 99,
          sourceAvatarAngularP90Deg: values.angularP90,
          sourceAvatarAngularMaxDeg: values.angularMax,
          sourceAvatarPalmInversionRatio: values.palm,
          sourceAvatarRootYawTargetP90Deg: values.root,
          poseSolverP95Ms: values.solver,
        },
        failures: [],
        warnings: [],
      },
    ],
  };
}
