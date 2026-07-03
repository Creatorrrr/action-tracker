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
  minFacingAgreement: 0.95,
  minBackSideFacingAgreement: 0.9,
  maxYawP95Deg: 35,
  maxOcclusionArmP95Deg: 75,
  maxOcclusionArmMaxDeg: 120,
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
    } else if (arg === "--min-facing-agreement") {
      parsed.thresholds.minFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--min-back-side-facing-agreement") {
      parsed.thresholds.minBackSideFacingAgreement = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-yaw-p95-deg") {
      parsed.thresholds.maxYawP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-occlusion-arm-p95-deg") {
      parsed.thresholds.maxOcclusionArmP95Deg = numberArg(rawArgs[++index], arg);
    } else if (arg === "--max-occlusion-arm-max-deg") {
      parsed.thresholds.maxOcclusionArmMaxDeg = numberArg(rawArgs[++index], arg);
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
  const summary = report?.summary ?? {};
  const checks = [
    minCheck("pairedRatio", summary.pairedRatio, thresholds.minPairedRatio),
    minCountCheck("pairedFrames", summary.pairedFrames, 1),
    maxCheck("timestampDelta.p95", summary.timestampDelta?.p95, thresholds.maxTimestampP95Ms),
    minCountCheck("targetAngle.count", summary.targetAngle?.count, 1),
    maxCheck("targetAngle.p95", summary.targetAngle?.p95, thresholds.maxTargetP95Deg),
    maxCheck("targetAngle.weightedP95", summary.targetAngle?.weightedP95, thresholds.maxTargetWeightedP95Deg),
    maxCheck("targetAngle.max", summary.targetAngle?.max, thresholds.maxTargetMaxDeg),
    minCountCheck("hingeFlex.count", summary.hingeFlex?.count, 1),
    maxCheck("hingeFlex.p95", summary.hingeFlex?.p95, thresholds.maxHingeP95Deg),
  ];
  const facing = summary.facingAgreement ?? {};
  const occlusion = summary.occlusionArmTargetAngle ?? {};

  if (Number(facing.count ?? 0) > 0 || !options.allowMissingFacing) {
    checks.push(
      minCountCheck("facingAgreement.count", facing.count, 1),
      minCheck("facingAgreement.agreementRatio", facing.agreementRatio, thresholds.minFacingAgreement),
      minCountCheck("facingAgreement.backSideCount", facing.backSideCount, 1),
      minCheck(
        "facingAgreement.backSideAgreementRatio",
        facing.backSideAgreementRatio,
        thresholds.minBackSideFacingAgreement,
      ),
      maxCheck("facingAgreement.yawError.p95", facing.yawError?.p95, thresholds.maxYawP95Deg),
    );
  }

  if (Number(occlusion.count ?? 0) > 0 || !options.allowMissingOcclusion) {
    checks.push(
      minCountCheck("occlusionArmTargetAngle.count", occlusion.count, 1),
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
