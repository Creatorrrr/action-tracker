#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

export const DEFAULT_SAM_ORACLE_THRESHOLDS = Object.freeze({
  minPairedRatio: 0.95,
  maxTimestampP95Ms: 25,
  maxTargetP95Deg: 50,
  maxTargetWeightedP95Deg: 50,
  maxTargetMaxDeg: 180,
  maxHingeP95Deg: 55,
  minOfflineUsageRatio: 0.35,
  maxBracketGapP95Ms: 50,
  maxBracketGapMaxMs: 250,
  minTargetWeightSum: 1,
  minFacingAgreement: 0.95,
  minStableFacingAgreement: 0.6,
  minYawStateFacingAgreement: 0.78,
  minYawToleranceFacingAgreement: 0.93,
  minBackSideFacingAgreement: 0.9,
  minStableBackSideFacingAgreement: 0.4,
  minYawBackSideFacingAgreement: 0.7,
  maxYawP95Deg: 35,
  minOcclusionCount: 16,
  maxOcclusionArmP95Deg: 75,
  maxOcclusionArmMaxDeg: 120,
  maxPairingDeltaMs: 25,
  maxEstimatedOffsetAbsMs: 500,
});

const DEFAULT_SAM_ORACLE_EXPECTATIONS = Object.freeze({
  comparisonType: "live-vs-offline-motion-recording",
  timestampSource: "sourceMeta.videoTime",
  interpolate: "offline",
  offsetMode: "auto",
  liveTargetStabilization: true,
  offlineTargetStabilization: false,
  labelsProvided: true,
});

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

export {
  evaluateSamRegressionOracle,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.report || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const reportPath = path.resolve(projectRoot, args.report);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const oracle = evaluateSamRegressionOracle(report, {
    thresholds: args.thresholds,
    expectations: args.expectations,
    skipProvenance: args.skipProvenance,
    allowMissingFacing: args.allowMissingFacing,
    allowMissingOcclusion: args.allowMissingOcclusion,
  });

  const output = {
    ...oracle,
    reportPath: args.report,
  };

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  }

  console.log(JSON.stringify(output, null, 2));

  if (oracle.status !== "passed") {
    process.exitCode = 1;
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    report: "",
    output: "",
    thresholds: { ...DEFAULT_SAM_ORACLE_THRESHOLDS },
    expectations: { ...DEFAULT_SAM_ORACLE_EXPECTATIONS },
    skipProvenance: false,
    allowMissingFacing: false,
    allowMissingOcclusion: false,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--report") {
      parsed.report = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--min-paired-ratio") {
      parsed.thresholds.minPairedRatio = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-timestamp-p95-ms") {
      parsed.thresholds.maxTimestampP95Ms = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-target-p95-deg") {
      parsed.thresholds.maxTargetP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-target-weighted-p95-deg") {
      parsed.thresholds.maxTargetWeightedP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-target-max-deg") {
      parsed.thresholds.maxTargetMaxDeg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-hinge-p95-deg") {
      parsed.thresholds.maxHingeP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-offline-usage-ratio") {
      parsed.thresholds.minOfflineUsageRatio = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-bracket-gap-p95-ms") {
      parsed.thresholds.maxBracketGapP95Ms = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-bracket-gap-max-ms") {
      parsed.thresholds.maxBracketGapMaxMs = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-target-weight-sum") {
      parsed.thresholds.minTargetWeightSum = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-facing-agreement") {
      parsed.thresholds.minFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-stable-facing-agreement") {
      parsed.thresholds.minStableFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-yaw-state-facing-agreement") {
      parsed.thresholds.minYawStateFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-yaw-tolerance-facing-agreement") {
      parsed.thresholds.minYawToleranceFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-back-side-facing-agreement") {
      parsed.thresholds.minBackSideFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-stable-back-side-facing-agreement") {
      parsed.thresholds.minStableBackSideFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-yaw-back-side-facing-agreement") {
      parsed.thresholds.minYawBackSideFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-yaw-p95-deg") {
      parsed.thresholds.maxYawP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-occlusion-count") {
      parsed.thresholds.minOcclusionCount = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-occlusion-arm-p95-deg") {
      parsed.thresholds.maxOcclusionArmP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-occlusion-arm-max-deg") {
      parsed.thresholds.maxOcclusionArmMaxDeg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-pairing-delta-ms") {
      parsed.thresholds.maxPairingDeltaMs = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-estimated-offset-abs-ms") {
      parsed.thresholds.maxEstimatedOffsetAbsMs = numberArg(rawArgs[++index], arg);
    } else if (arg === "--expect-timestamp-source") {
      parsed.expectations.timestampSource = rawArgs[++index] ?? parsed.expectations.timestampSource;
    } else if (arg === "--expect-interpolate") {
      parsed.expectations.interpolate = rawArgs[++index] ?? parsed.expectations.interpolate;
    } else if (arg === "--expect-offset-mode") {
      parsed.expectations.offsetMode = rawArgs[++index] ?? parsed.expectations.offsetMode;
    } else if (arg === "--skip-provenance") {
      parsed.skipProvenance = true;
    } else if (arg === "--allow-missing-facing") {
      parsed.allowMissingFacing = true;
    } else if (arg === "--allow-missing-occlusion") {
      parsed.allowMissingOcclusion = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (!parsed.report) {
      parsed.report = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function numberArg(value, flag) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a finite number.`);
  }

  return parsed;
}

function evaluateSamRegressionOracle(report, options = {}) {
  const thresholds = {
    ...DEFAULT_SAM_ORACLE_THRESHOLDS,
    ...(options.thresholds ?? {}),
  };
  const expectations = {
    ...DEFAULT_SAM_ORACLE_EXPECTATIONS,
    ...(options.expectations ?? {}),
  };
  const summary = report?.summary ?? {};
  const checks = [
    minCheck("pairedRatio", summary.pairedRatio, thresholds.minPairedRatio),
    minCountCheck("pairedFrames", summary.pairedFrames, 1),
    minCheck("offlineUsageRatio", summary.offlineUsageRatio, thresholds.minOfflineUsageRatio),
    maxCheck("timestampDelta.p95", summary.timestampDelta?.p95, thresholds.maxTimestampP95Ms),
    minCountCheck("targetAngle.count", summary.targetAngle?.count, 1),
    minCheck("targetAngle.weightSum", summary.targetAngle?.weightSum, thresholds.minTargetWeightSum),
    maxCheck("targetAngle.p95", summary.targetAngle?.p95, thresholds.maxTargetP95Deg),
    maxCheck("targetAngle.weightedP95", summary.targetAngle?.weightedP95, thresholds.maxTargetWeightedP95Deg),
    maxCheck("targetAngle.max", summary.targetAngle?.max, thresholds.maxTargetMaxDeg),
    minCountCheck("hingeFlex.count", summary.hingeFlex?.count, 1),
    maxCheck("hingeFlex.p95", summary.hingeFlex?.p95, thresholds.maxHingeP95Deg),
    minCountCheck("interpolationBracketGap.count", summary.interpolationBracketGap?.count, 1),
    maxCheck("interpolationBracketGap.p95", summary.interpolationBracketGap?.p95, thresholds.maxBracketGapP95Ms),
    maxCheck("interpolationBracketGap.max", summary.interpolationBracketGap?.max, thresholds.maxBracketGapMaxMs),
  ];
  const facing = summary.facingAgreement ?? {};
  const occlusion = summary.occlusionArmTargetAngle ?? {};

  if (!options.skipProvenance) {
    checks.push(...buildProvenanceChecks(report, thresholds, expectations));
  }

  if (Number(facing.count ?? 0) > 0 || !options.allowMissingFacing) {
    checks.push(
      minCountCheck("facingAgreement.count", facing.count, 1),
      minCheck("facingAgreement.agreementRatio", facing.agreementRatio, thresholds.minFacingAgreement),
      minCheck(
        "facingAgreement.stableAgreementRatio",
        facing.stableAgreementRatio,
        thresholds.minStableFacingAgreement,
      ),
      minCheck(
        "facingAgreement.yawStateAgreementRatio",
        facing.yawStateAgreementRatio,
        thresholds.minYawStateFacingAgreement,
      ),
      minCheck(
        "facingAgreement.yawToleranceAgreementRatio",
        facing.yawToleranceAgreementRatio,
        thresholds.minYawToleranceFacingAgreement,
      ),
      minCountCheck("facingAgreement.backSideCount", facing.backSideCount, 1),
      minCheck(
        "facingAgreement.backSideAgreementRatio",
        facing.backSideAgreementRatio,
        thresholds.minBackSideFacingAgreement,
      ),
      minCheck(
        "facingAgreement.stableBackSideAgreementRatio",
        facing.stableBackSideAgreementRatio,
        thresholds.minStableBackSideFacingAgreement,
      ),
      minCheck(
        "facingAgreement.yawBackSideAgreementRatio",
        facing.yawBackSideAgreementRatio,
        thresholds.minYawBackSideFacingAgreement,
      ),
      maxCheck("facingAgreement.yawError.p95", facing.yawError?.p95, thresholds.maxYawP95Deg),
    );
  }

  if (Number(occlusion.count ?? 0) > 0 || !options.allowMissingOcclusion) {
    checks.push(
      minCountCheck("occlusionArmTargetAngle.count", occlusion.count, thresholds.minOcclusionCount),
      maxCheck("occlusionArmTargetAngle.p95", occlusion.p95, thresholds.maxOcclusionArmP95Deg),
      maxCheck("occlusionArmTargetAngle.max", occlusion.max, thresholds.maxOcclusionArmMaxDeg),
    );
  }

  const failedChecks = checks.filter((check) => !check.passed);

  return {
    status: failedChecks.length === 0 ? "passed" : "failed",
    generatedAt: new Date().toISOString(),
    oracleType: "sam-3d-body-regression",
    thresholds,
    checks,
    failureCount: failedChecks.length,
    failures: failedChecks,
  };
}

function buildProvenanceChecks(report, thresholds, expectations = {}) {
  const checks = [
    equalCheck("comparisonType", report?.comparisonType, expectations.comparisonType),
    maxCheck("maxTimestampDeltaMs", report?.maxTimestampDeltaMs, thresholds.maxPairingDeltaMs),
    equalCheck("liveTargetStabilization", report?.liveTargetStabilization, expectations.liveTargetStabilization),
    equalCheck("offlineTargetStabilization", report?.offlineTargetStabilization, expectations.offlineTargetStabilization),
    equalCheck("labelsProvided", report?.labelsProvided, expectations.labelsProvided),
    minCountCheck("labelFrameCount", report?.labelFrameCount, 1),
    minCountCheck("labelWindowCount", report?.labelWindowCount, 1),
    maxCheck("estimatedOffsetAbsMs", Math.abs(Number(report?.estimatedOffsetMs)), thresholds.maxEstimatedOffsetAbsMs),
  ];

  if (expectations.timestampSource !== "any") {
    checks.push(equalCheck("timestampSource", report?.timestampSource, expectations.timestampSource));
  }
  if (expectations.interpolate !== "any") {
    checks.push(equalCheck("interpolate", report?.interpolate, expectations.interpolate));
  }
  if (expectations.offsetMode !== "any") {
    checks.push(equalCheck("offsetMs", report?.offsetMs, expectations.offsetMode));
  }

  return checks;
}

function minCountCheck(metric, actual, expected) {
  return minCheck(metric, actual, expected, { integer: true });
}

function minCheck(metric, actual, expected, options = {}) {
  const value = Number(actual);
  const threshold = Number(expected);
  const passed = Number.isFinite(value) && value >= threshold;

  return {
    metric,
    actual: Number.isFinite(value) ? round(value, options.integer ? 0 : 6) : null,
    operator: ">=",
    expected: threshold,
    passed,
  };
}

function maxCheck(metric, actual, expected) {
  const value = Number(actual);
  const threshold = Number(expected);
  const passed = Number.isFinite(value) && value <= threshold;

  return {
    metric,
    actual: Number.isFinite(value) ? round(value, 6) : null,
    operator: "<=",
    expected: threshold,
    passed,
  };
}

function equalCheck(metric, actual, expected) {
  const passed = actual === expected;

  return {
    metric,
    actual: actual ?? null,
    operator: "===",
    expected,
    passed,
  };
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sam-regression-oracle.mjs --report output/reports/tracker-vs-sam-jujae-v2.json

Validates a SAM-3D-Body tracker comparison report produced by
scripts/motion-recording-compare.mjs. Defaults target the jujae regression
clip with sourceMeta.videoTime pairing, SAM labels, and offline interpolation.
Use threshold flags only when establishing a new labeled clip baseline.
`);
}
