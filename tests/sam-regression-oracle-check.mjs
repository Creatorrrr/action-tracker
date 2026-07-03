#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSamRegressionOracle } from "../scripts/sam-regression-oracle.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(os.tmpdir(), "action-tracker-sam-oracle-"));

const passingReport = createReport();
const passingOracle = evaluateSamRegressionOracle(passingReport);
assert.equal(passingOracle.status, "passed");
assert.equal(passingOracle.failureCount, 0);

const degradedTargetReport = createReport({
  summary: {
    targetAngle: {
      p95: 90,
    },
  },
});
const degradedTargetOracle = evaluateSamRegressionOracle(degradedTargetReport);
assert.equal(degradedTargetOracle.status, "failed");
assert.ok(degradedTargetOracle.failures.some((check) => check.metric === "targetAngle.p95"));

const degradedFacingReport = createReport({
  summary: {
    facingAgreement: {
      backSideAgreementRatio: 0.4,
    },
  },
});
const degradedFacingOracle = evaluateSamRegressionOracle(degradedFacingReport);
assert.equal(degradedFacingOracle.status, "failed");
assert.ok(degradedFacingOracle.failures.some((check) => check.metric === "facingAgreement.backSideAgreementRatio"));

const missingOcclusionReport = createReport({
  summary: {
    occlusionArmTargetAngle: {
      count: 0,
      p95: 0,
      max: 0,
    },
  },
});
assert.equal(evaluateSamRegressionOracle(missingOcclusionReport).status, "failed");
assert.equal(
  evaluateSamRegressionOracle(missingOcclusionReport, { allowMissingOcclusion: true }).status,
  "passed",
);

const passPath = path.join(tempDir, "pass.json");
const failPath = path.join(tempDir, "fail.json");
const outputPath = path.join(tempDir, "oracle-output.json");
await writeFile(passPath, `${JSON.stringify(passingReport, null, 2)}\n`);
await writeFile(failPath, `${JSON.stringify(degradedTargetReport, null, 2)}\n`);

const passResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-regression-oracle.mjs"),
  "--report",
  passPath,
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});
assert.equal(passResult.status, 0, passResult.stderr || passResult.stdout);
assert.equal(JSON.parse(await readFile(outputPath, "utf8")).status, "passed");

const failResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-regression-oracle.mjs"),
  "--report",
  failPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});
assert.equal(failResult.status, 1);
assert.match(failResult.stdout, /"status": "failed"/);
assert.match(failResult.stdout, /targetAngle\.p95/);

console.log("SAM regression oracle check passed.");

function createReport(overrides = {}) {
  const base = {
    summary: {
      liveFrames: 120,
      offlineFrames: 120,
      pairedFrames: 120,
      pairedRatio: 1,
      timestampDelta: {
        count: 120,
        p95: 0,
        max: 0,
      },
      targetAngle: {
        count: 960,
        mean: 18,
        p95: 43,
        max: 72,
        weightedMean: 16,
        weightedP95: 41,
      },
      occlusionArmTargetAngle: {
        count: 32,
        mean: 31,
        p95: 70,
        max: 71,
        weightedMean: 30,
        weightedP95: 70,
      },
      hingeFlex: {
        count: 480,
        mean: 20,
        p95: 45,
        max: 70,
      },
      facingAgreement: {
        count: 120,
        matched: 118,
        agreementRatio: 0.983333,
        backSideCount: 40,
        backSideMatched: 38,
        backSideAgreementRatio: 0.95,
        yawError: {
          count: 120,
          p95: 27,
          max: 45,
        },
      },
    },
  };

  return deepMerge(base, overrides);
}

function deepMerge(base, overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return overrides ?? base;
  }

  const merged = { ...base };

  for (const [key, value] of Object.entries(overrides)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = deepMerge(base?.[key] ?? {}, value);
    } else {
      merged[key] = value;
    }
  }

  return merged;
}
