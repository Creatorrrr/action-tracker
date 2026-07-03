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

const profiledOracle = evaluateSamRegressionOracle(passingReport, {
  profile: {
    name: "profiled-unit",
    thresholds: {
      minOfflineUsageRatio: 0.45,
    },
    checks: [
      { metric: "manualLabelsProvided", operator: "===", expected: true, grade: "gate" },
      { metric: "summary.validPairedRatio", operator: ">=", expected: 0.9, grade: "gate" },
      { metric: "summary.presenceAgreement.absentSuppressionRatio", operator: ">=", expected: 0.9, grade: "watch" },
    ],
  },
});
assert.equal(profiledOracle.status, "passed");
assert.equal(profiledOracle.profile, "profiled-unit");
assert.equal(profiledOracle.warningCount, 1);
assert.ok(profiledOracle.warnings.some((check) => check.metric === "summary.presenceAgreement.absentSuppressionRatio"));

const profiledGateFailure = evaluateSamRegressionOracle(passingReport, {
  profile: {
    checks: [
      { metric: "summary.validPairedRatio", operator: ">=", expected: 1.1, grade: "gate" },
    ],
  },
});
assert.equal(profiledGateFailure.status, "failed");
assert.ok(profiledGateFailure.failures.some((check) => check.metric === "summary.validPairedRatio"));

const stabilityOracle = evaluateSamRegressionOracle(passingReport, {
  thresholds: {
    maxYawDeltaP95Deg: 20,
    maxYawFlipsPerMinute: 0,
    maxSideSwapRatio: 0,
    maxImplausibleFrameRatio: 0,
    maxImplausibleRatioP95: 0,
  },
});
assert.equal(stabilityOracle.status, "passed");

const degradedYawStabilityReport = createReport({
  summary: {
    facingAgreement: {
      yawDelta: {
        p95: 140,
      },
      yawFlipsPerMinute: 30,
    },
  },
});
const degradedYawStabilityOracle = evaluateSamRegressionOracle(degradedYawStabilityReport, {
  thresholds: {
    maxYawDeltaP95Deg: 90,
    maxYawFlipsPerMinute: 12,
  },
});
assert.equal(degradedYawStabilityOracle.status, "failed");
assert.ok(degradedYawStabilityOracle.failures.some((check) => check.metric === "facingAgreement.yawDelta.p95"));
assert.ok(
  degradedYawStabilityOracle.failures.some((check) => check.metric === "facingAgreement.yawFlipsPerMinute"),
);

const degradedSideSwapReport = createReport({
  summary: {
    sideConsistency: {
      sideSwapRatio: 0.2,
    },
  },
});
const degradedSideSwapOracle = evaluateSamRegressionOracle(degradedSideSwapReport, {
  thresholds: {
    maxSideSwapRatio: 0.05,
  },
});
assert.equal(degradedSideSwapOracle.status, "failed");
assert.ok(degradedSideSwapOracle.failures.some((check) => check.metric === "sideConsistency.sideSwapRatio"));

const degradedImplausibilityReport = createReport({
  summary: {
    implausibility: {
      implausibleFrameRatio: 0.4,
      implausibleRatio: {
        p95: 0.35,
      },
    },
  },
});
const degradedImplausibilityOracle = evaluateSamRegressionOracle(degradedImplausibilityReport, {
  thresholds: {
    maxImplausibleFrameRatio: 0.25,
    maxImplausibleRatioP95: 0.3,
  },
});
assert.equal(degradedImplausibilityOracle.status, "failed");
assert.ok(
  degradedImplausibilityOracle.failures.some((check) => check.metric === "implausibility.implausibleFrameRatio"),
);
assert.ok(
  degradedImplausibilityOracle.failures.some((check) => check.metric === "implausibility.implausibleRatio.p95"),
);

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

const degradedStableFacingReport = createReport({
  summary: {
    facingAgreement: {
      agreementRatio: 0.98,
      stableAgreementRatio: 0.3,
    },
  },
});
const degradedStableFacingOracle = evaluateSamRegressionOracle(degradedStableFacingReport);
assert.equal(degradedStableFacingOracle.status, "failed");
assert.ok(degradedStableFacingOracle.failures.some((check) => check.metric === "facingAgreement.stableAgreementRatio"));

const degradedBracketGapReport = createReport({
  summary: {
    interpolationBracketGap: {
      p95: 400,
      max: 410,
    },
  },
});
const degradedBracketGapOracle = evaluateSamRegressionOracle(degradedBracketGapReport);
assert.equal(degradedBracketGapOracle.status, "failed");
assert.ok(degradedBracketGapOracle.failures.some((check) => check.metric === "interpolationBracketGap.p95"));

const missingBracketGapReport = createReport({
  summary: {
    interpolationBracketGap: undefined,
  },
});
const missingBracketGapOracle = evaluateSamRegressionOracle(missingBracketGapReport);
assert.equal(missingBracketGapOracle.status, "failed");
assert.ok(missingBracketGapOracle.failures.some((check) => check.metric === "interpolationBracketGap.count"));

const degradedProvenanceReport = createReport({
  interpolate: "none",
});
const degradedProvenanceOracle = evaluateSamRegressionOracle(degradedProvenanceReport);
assert.equal(degradedProvenanceOracle.status, "failed");
assert.ok(degradedProvenanceOracle.failures.some((check) => check.metric === "interpolate"));
assert.equal(evaluateSamRegressionOracle(degradedProvenanceReport, { skipProvenance: true }).status, "passed");

const sparseOcclusionReport = createReport({
  summary: {
    occlusionArmTargetAngle: {
      count: 8,
      p95: 0,
      max: 0,
    },
  },
});
assert.equal(evaluateSamRegressionOracle(sparseOcclusionReport).status, "failed");
assert.ok(
  evaluateSamRegressionOracle(sparseOcclusionReport)
    .failures
    .some((check) => check.metric === "occlusionArmTargetAngle.count"),
);

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
const profilePath = path.join(tempDir, "profile.json");
const outputPath = path.join(tempDir, "oracle-output.json");
await writeFile(passPath, `${JSON.stringify(passingReport, null, 2)}\n`);
await writeFile(failPath, `${JSON.stringify(degradedTargetReport, null, 2)}\n`);
await writeFile(profilePath, `${JSON.stringify({
  name: "cli-profile",
  checks: [
    { metric: "manualLabelsProvided", operator: "===", expected: true, grade: "gate" },
  ],
}, null, 2)}\n`);

const passResult = spawnSync(process.execPath, [
  path.join(projectRoot, "scripts/sam-regression-oracle.mjs"),
  "--report",
  passPath,
  "--profile",
  profilePath,
  "--output",
  outputPath,
], {
  cwd: projectRoot,
  encoding: "utf8",
});
assert.equal(passResult.status, 0, passResult.stderr || passResult.stdout);
assert.equal(JSON.parse(await readFile(outputPath, "utf8")).status, "passed");
assert.equal(JSON.parse(await readFile(outputPath, "utf8")).profile, "cli-profile");

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
    comparisonType: "live-vs-offline-motion-recording",
    maxTimestampDeltaMs: 25,
    timestampSource: "sourceMeta.videoTime",
    interpolate: "offline",
    liveTargetStabilization: true,
    offlineTargetStabilization: false,
    offsetMs: "auto",
    estimatedOffsetMs: 5,
    labelsProvided: true,
    labelFrameCount: 120,
    labelWindowCount: 4,
    manualLabelsProvided: true,
    manualLabelFrameCount: 120,
    manualLabelWindowCount: 8,
    summary: {
      liveFrames: 120,
      offlineFrames: 120,
      pairedFrames: 120,
      pairedRatio: 1,
      validPairedRatio: 0.95,
      excludedPairs: 12,
      offlineUsageRatio: 0.5,
      timestampDelta: {
        count: 120,
        p95: 0,
        max: 0,
      },
      interpolationBracketGap: {
        count: 120,
        p95: 17,
        max: 20,
      },
      targetAngle: {
        count: 960,
        mean: 18,
        p95: 43,
        max: 72,
        weightedMean: 16,
        weightedP95: 41,
        weightSum: 900,
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
        stableAgreementRatio: 0.7,
        yawStateAgreementRatio: 0.83,
        yawToleranceAgreementRatio: 0.97,
        backSideCount: 40,
        backSideMatched: 38,
        backSideAgreementRatio: 0.95,
        stableBackSideAgreementRatio: 0.45,
        yawBackSideAgreementRatio: 0.75,
        yawError: {
          count: 120,
          p95: 27,
          max: 45,
        },
        yawDelta: {
          count: 119,
          mean: 3,
          p95: 10,
          max: 12,
          weightedMean: 3,
          weightedP95: 10,
          weightSum: 119,
        },
        yawFlipCount: 0,
        yawFlipsPerMinute: 0,
      },
      sideConsistency: {
        count: 240,
        swapped: 0,
        sideSwapRatio: 0,
        swapMargin: {
          count: 240,
          mean: -1,
          p95: -0.2,
          max: 0,
          weightedMean: -1,
          weightedP95: -0.2,
          weightSum: 240,
        },
        byKind: {
          wrist: {
            count: 120,
            swapped: 0,
            sideSwapRatio: 0,
          },
          ankle: {
            count: 120,
            swapped: 0,
            sideSwapRatio: 0,
          },
        },
      },
      implausibility: {
        count: 120,
        framesWithImplausibleTargets: 0,
        implausibleFrameRatio: 0,
        implausibleTargets: {
          count: 120,
          mean: 0,
          p95: 0,
          max: 0,
          weightedMean: 0,
          weightedP95: 0,
          weightSum: 120,
        },
        implausibleRatio: {
          count: 120,
          mean: 0,
          p95: 0,
          max: 0,
          weightedMean: 0,
          weightedP95: 0,
          weightSum: 120,
        },
      },
      presenceAgreement: {
        expectedAbsentFrames: 12,
        absentSuppressionRatio: 0.5,
      },
      gestureAgreement: {
        samVsManualRatio: 0.8,
        trackerVsManualRatio: 0.8,
        trackerVsSamRatio: 1,
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
