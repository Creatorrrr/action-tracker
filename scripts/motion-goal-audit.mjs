#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateClipManifest } from "./validation-cli.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FRAME_AGE_P95_MS = 66;
const MAX_SOLVER_P95_MS = 2;
const MIN_MOTION_OVERALL_PERCENT = 95;
const REQUIRED_REAL_CLIP_SCENARIOS = [
  "front_still_baseline",
  "turn_180",
  "arm_behind_back_occlusion",
  "crossed_arms_elbow_flex",
  "upper_body_only",
  "head_pitch_yaw",
  "lost_and_reacquired",
];
const REPORT_PRODUCER_FILES = [
  "src/app.js",
  "src/avatar-renderer.js",
  "src/depth-calibration.js",
  "src/motion-frame.js",
  "src/motion-worker.js",
  "src/solver/pose-solver.js",
  "scripts/avatar-motion-agreement-check.mjs",
  "scripts/frame-pump-performance-check.mjs",
  "scripts/motion-status-hud-smoke.mjs",
  "scripts/validation-cli.mjs",
];
const REPORT_ARTIFACTS = [
  { key: "hudCpu", path: "output/reports/motion-status-hud-smoke-latest.json" },
  { key: "hudGpu", path: "output/reports/motion-status-hud-smoke-gpu-latest.json" },
  { key: "pumpReport", path: "output/reports/frame-pump-comparison-latest.json" },
  { key: "validationAgreement", path: "output/reports/validation-agreement-latest.json" },
  { key: "fullMotionAgreement", path: "output/reports/avatar-motion-agreement-latest.json" },
];

async function main() {
  const checks = [];
  const externalBlockers = [];
  const sourceFreshnessCutoff = await latestMtime(REPORT_PRODUCER_FILES);
  const [
    gitignore,
    appSource,
    packageJson,
    clipManifest,
    ...reportArtifacts
  ] = await Promise.all([
    readTextArtifact(".gitignore"),
    readTextArtifact("src/app.js"),
    readJsonArtifact("package.json"),
    readJsonArtifact("tests/fixtures/clip-family/manifest.json"),
    ...REPORT_ARTIFACTS.map((artifact) => readJsonArtifact(artifact.path, artifact.key)),
  ]);
  const reports = Object.fromEntries(reportArtifacts.map((artifact) => [artifact.key, artifact]));

  auditRequiredProjectArtifacts({ checks, artifacts: [gitignore, appSource, packageJson, clipManifest] });
  auditGeneratedReportArtifacts({ checks, artifacts: reportArtifacts, sourceFreshnessCutoff });
  auditPlanArtifacts({ checks, gitignore: gitignore.data ?? "", packageJson: packageJson.data ?? {} });
  auditP0({
    checks,
    appSource: appSource.data ?? "",
    hudCpu: reports.hudCpu?.data ?? {},
    hudGpu: reports.hudGpu?.data ?? {},
    pumpReport: reports.pumpReport?.data ?? {},
  });
  auditP1P2({
    checks,
    externalBlockers,
    clipManifest: clipManifest.data ?? null,
    validationAgreement: reports.validationAgreement?.data ?? {},
    fullMotionAgreement: reports.fullMotionAgreement?.data ?? {},
  });
  auditExternalHmr({ checks, externalBlockers });

  const failedChecks = checks.filter((check) => check.status === "failed");
  const resultStatus = failedChecks.length > 0
    ? "failed"
    : externalBlockers.length > 0
      ? "passed_with_external_blockers"
      : "passed";

  const result = {
    generatedAt: new Date().toISOString(),
    status: resultStatus,
    summary: {
      checkCount: checks.length,
      failedCount: failedChecks.length,
      externalBlockerCount: externalBlockers.length,
    },
    checks,
    externalBlockers,
  };

  console.log(JSON.stringify(result, null, 2));

  if (failedChecks.length > 0) {
    process.exitCode = 1;
  }
}

function auditRequiredProjectArtifacts({ checks, artifacts }) {
  for (const artifact of artifacts) {
    addCheck(checks, {
      id: `artifact.project.${artifact.relativePath}`,
      passed: artifact.error === "",
      evidence: artifact.error
        ? `Required project artifact ${artifact.relativePath} could not be read: ${artifact.error}`
        : `Required project artifact ${artifact.relativePath} is readable`,
    });
  }
}

function auditGeneratedReportArtifacts({ checks, artifacts, sourceFreshnessCutoff }) {
  for (const artifact of artifacts) {
    const reportId = `artifact.report.${artifact.relativePath}`;

    addCheck(checks, {
      id: `${reportId}.present`,
      passed: artifact.error === "",
      evidence: artifact.error
        ? `Generated report ${artifact.relativePath} could not be read: ${artifact.error}`
        : `Generated report ${artifact.relativePath} is readable`,
    });

    if (artifact.error) {
      continue;
    }

    const generatedAt = Date.parse(artifact.data?.generatedAt ?? "");
    const hasGeneratedAt = Number.isFinite(generatedAt);

    addCheck(checks, {
      id: `${reportId}.generatedAt`,
      passed: hasGeneratedAt,
      evidence: hasGeneratedAt
        ? `Generated report ${artifact.relativePath} has generatedAt ${artifact.data.generatedAt}`
        : `Generated report ${artifact.relativePath} is missing a parseable generatedAt timestamp`,
    });

    if (!hasGeneratedAt || !Number.isFinite(sourceFreshnessCutoff)) {
      continue;
    }

    addCheck(checks, {
      id: `${reportId}.fresh`,
      passed: generatedAt + 1000 >= sourceFreshnessCutoff,
      evidence: `Generated report ${artifact.relativePath} should be newer than the latest motion source/report producer mtime`,
      details: {
        generatedAt: artifact.data.generatedAt,
        latestSourceMtime: new Date(sourceFreshnessCutoff).toISOString(),
      },
    });
  }
}

function auditPlanArtifacts({ checks, gitignore, packageJson }) {
  addCheck(checks, {
    id: "P0.1.local-output-hygiene",
    passed: gitignore.includes("output/") && gitignore.includes(".playwright"),
    evidence: ".gitignore ignores generated browser/check artifacts including output/",
  });
  addCheck(checks, {
    id: "plan.goal-plan-present",
    passed: existsSync(path.join(projectRoot, "GOAL_PLAN.md")),
    evidence: "GOAL_PLAN.md exists",
  });
  addCheck(checks, {
    id: "plan.status-doc-present",
    passed: existsSync(path.join(projectRoot, "docs/MOTION_GOAL_STATUS.md")),
    evidence: "docs/MOTION_GOAL_STATUS.md exists",
  });
  addCheck(checks, {
    id: "plan.audit-script-registered",
    passed: packageJson.scripts?.["goal:audit"] === "node scripts/motion-goal-audit.mjs",
    evidence: "package.json exposes npm run goal:audit",
  });
}

function auditP0({ checks, appSource, hudCpu, hudGpu, pumpReport }) {
  const cpuDelegates = hudCpu.payload?.appPerformance?.detectorDelegates;
  const gpuDelegates = hudGpu.payload?.appPerformance?.detectorDelegates;
  const rvfc = pumpReport.runs?.rvfc ?? {};

  addCheck(checks, {
    id: "P0.2.cpu-delegate-telemetry",
    passed: (
      hudCpu.status === "passed" &&
      cpuDelegates?.requested === "CPU" &&
      cpuDelegates?.pose === "CPU" &&
      cpuDelegates?.hand === "CPU" &&
      arrayIncludes(cpuDelegates?.attempted?.pose, "CPU") &&
      arrayIncludes(cpuDelegates?.attempted?.hand, "CPU")
    ),
    evidence: "motion-status-hud-smoke-latest.json reports CPU pose/hand delegates and attempts",
    details: cpuDelegates,
  });

  addCheck(checks, {
    id: "P0.2.gpu-delegate-telemetry",
    passed: (
      hudGpu.status === "passed" &&
      gpuDelegates?.requested === "GPU" &&
      ["GPU", "CPU"].includes(gpuDelegates?.pose) &&
      ["GPU", "CPU"].includes(gpuDelegates?.hand) &&
      arrayIncludes(gpuDelegates?.attempted?.pose, "GPU") &&
      arrayIncludes(gpuDelegates?.attempted?.hand, "GPU") &&
      fallbackReasonsMatchActiveDelegates(gpuDelegates)
    ),
    evidence: "motion-status-hud-smoke-gpu-latest.json reports GPU request/attempts and valid fallback telemetry",
    details: {
      delegates: gpuDelegates,
      detectP95Ms: hudGpu.payload?.appPerformance?.samples?.detect?.p95Ms,
      frameAgeP95Ms: hudGpu.payload?.appPerformance?.samples?.frameAge?.p95Ms,
    },
  });

  addCheck(checks, {
    id: "P0.3.rvfc-frame-age-gate",
    passed: (
      pumpReport.passed === true &&
      Number.isFinite(rvfc.appFrameAgeP95Ms) &&
      rvfc.appFrameAgeP95Ms <= MAX_FRAME_AGE_P95_MS &&
      rvfc.pumpDuplicateFrames === 0
    ),
    evidence: "frame-pump-comparison-latest.json passes rVFC frame-age and duplicate-frame gate",
    details: {
      frameAgeP95Ms: rvfc.appFrameAgeP95Ms,
      detectP95Ms: rvfc.appDetectP95Ms,
      staleFrameCallbacks: rvfc.pumpStaleFrameCallbacks,
      duplicateFrames: rvfc.pumpDuplicateFrames,
    },
  });

  addCheck(checks, {
    id: "P0.4.validation-opt-in-source-contract",
    passed: (
      appSource.includes("enabled: getInitialValidationEnabled()") &&
      /function\s+getInitialValidationEnabled\s*\(\s*\)\s*\{\s*return\s+isTruthyQueryFlag\("validation"\)/.test(appSource)
    ),
    evidence: "src/app.js enables runtime validation sampling only from the validation query flag",
  });
}

function auditP1P2({ checks, externalBlockers, clipManifest, validationAgreement, fullMotionAgreement }) {
  const clipSchema = validateClipManifest(clipManifest);
  const clips = Array.isArray(clipManifest?.clips) ? clipManifest.clips : [];
  const coveredScenarioIds = new Set(clips.map((clip) => clip.scenario));
  const validationModel = validationAgreement.models?.[0];
  const validationSummary = validationModel?.summary ?? {};
  const fullModels = Array.isArray(fullMotionAgreement.models) ? fullMotionAgreement.models : [];

  addCheck(checks, {
    id: "P1.1-P2.1.solver-and-synthetic-contract",
    passed: (
      existsSync(path.join(projectRoot, "src/solver/pose-solver.js")) &&
      existsSync(path.join(projectRoot, "tests/solver-synthetic-check.mjs")) &&
      existsSync(path.join(projectRoot, "tests/fixtures/synthetic"))
    ),
    evidence: "pure solver boundary and synthetic fixture/check artifacts exist",
  });

  addCheck(checks, {
    id: "P2.2.clip-manifest-schema",
    passed: (
      clipSchema.errors.length === 0 &&
      clipSchema.scenarioCount >= REQUIRED_REAL_CLIP_SCENARIOS.length &&
      REQUIRED_REAL_CLIP_SCENARIOS.every((scenarioId) => clipSchema.scenarioCoverage?.[scenarioId] === 0 || Number.isFinite(clipSchema.scenarioCoverage?.[scenarioId]))
    ),
    evidence: "clip-family manifest schema validates and declares required real-world scenarios",
    details: {
      scenarioCount: clipSchema.scenarioCount,
      coveredScenarioCount: clipSchema.coveredScenarioCount,
      errors: clipSchema.errors,
    },
  });

  for (const scenarioId of REQUIRED_REAL_CLIP_SCENARIOS) {
    if (!coveredScenarioIds.has(scenarioId)) {
      externalBlockers.push({
        id: `P2.2.real-clip-missing.${scenarioId}`,
        status: "blocked_external_input",
        evidence: `tests/fixtures/clip-family/manifest.json has no clip for ${scenarioId}`,
        requiredInput: "User-provided or approved real video clip plus labels matching the clip-family schema",
      });
    }
  }

  addCheck(checks, {
    id: "P2.3.validation-agreement-gate",
    passed: (
      Array.isArray(validationAgreement.failures) &&
      validationAgreement.failures.length === 0 &&
      validationSummary.overallPercent >= MIN_MOTION_OVERALL_PERCENT &&
      validationSummary.appFrameAgeP95Ms <= MAX_FRAME_AGE_P95_MS &&
      validationSummary.poseSolverP95Ms <= MAX_SOLVER_P95_MS &&
      validationSummary.poseSolverHingeViolationFrames === 0 &&
      validationSummary.recordingReplay?.recordingJsonlLineCount === validationSummary.recordingReplay?.recordingFrameCount + 1
    ),
    evidence: "validation-agreement-latest.json passes agreement, frame-age, solver, unsigned hinge min-limit diagnostic, and JSONL replay gates",
    details: summarizeAgreement(validationModel),
  });

  addCheck(checks, {
    id: "P2.3.full-model-motion-gate",
    passed: (
      fullModels.length >= 3 &&
      fullModels.every((model) => {
        const summary = model.summary ?? {};
        return (
          model.failures?.length === 0 &&
          summary.overallPercent >= MIN_MOTION_OVERALL_PERCENT &&
          summary.poseSolverP95Ms <= MAX_SOLVER_P95_MS &&
          summary.poseSolverHingeViolationFrames === 0 &&
          summary.recordingReplay?.recordingJsonlLineCount === summary.recordingReplay?.recordingFrameCount + 1
        );
      })
    ),
    evidence: "avatar-motion-agreement-latest.json passes Xbot/Soldier/Polydancer motion, unsigned hinge min-limit diagnostic, and JSONL replay gates",
    details: fullModels.map(summarizeAgreement),
  });

  addCheck(checks, {
    id: "P2.4.symptom-metrics-present",
    passed: (
      Number.isFinite(validationSummary.appFrameAgeP95Ms) &&
      Number.isFinite(validationSummary.poseSolverHingeViolationFrames) &&
      Number.isFinite(validationSummary.poseSolverHingeLimitWarningFrames) &&
      validationSummary.poseSolverHingeLimitWarningByName &&
      Number.isFinite(validationSummary.poseSolverFacingChanges) &&
      Number.isFinite(validationSummary.poseSolverModeChanges) &&
      Number.isFinite(validationSummary.pumpStaleFrameCallbacks)
    ),
    evidence: "agreement report preserves frame-age, unsigned hinge diagnostics, facing/mode, stale callback, and warning-breakdown metrics",
    details: {
      frameAgeP95Ms: validationSummary.appFrameAgeP95Ms,
      unsignedHingeMinLimitFrames: validationSummary.poseSolverHingeViolationFrames,
      hingeLimitWarningFrames: validationSummary.poseSolverHingeLimitWarningFrames,
      hingeLimitWarningByName: validationSummary.poseSolverHingeLimitWarningByName,
      facingChanges: validationSummary.poseSolverFacingChanges,
      modeChanges: validationSummary.poseSolverModeChanges,
      staleFrameCallbacks: validationSummary.pumpStaleFrameCallbacks,
    },
  });

  const scenarioToP1 = {
    crossed_arms_elbow_flex: "P1.2.real-crossed-arms-hinge",
    turn_180: "P1.3.real-facing-transition",
    arm_behind_back_occlusion: "P1.4.real-occlusion-hold-decay",
    upper_body_only: "P1.5.real-upper-body-mode",
    front_still_baseline: "P1.6.real-jitter-latency-filter-tuning",
    lost_and_reacquired: "P4.3.real-lost-reacquired-recovery",
  };

  for (const [scenarioId, blockerId] of Object.entries(scenarioToP1)) {
    if (!coveredScenarioIds.has(scenarioId)) {
      externalBlockers.push({
        id: blockerId,
        status: "blocked_external_input",
        evidence: `${scenarioId} clip/labels are absent, so the real-world acceptance gate cannot be promoted beyond synthetic/agreement evidence`,
        requiredInput: "A real labeled clip for the named scenario",
      });
    }
  }

  if (clips.length === 0) {
    externalBlockers.push({
      id: "P1.7.legacy-solver-removal",
      status: "deferred",
      evidence: "legacy renderer aim path should not be removed before real clip-family gates pass",
      requiredInput: "Green real clip-family validation across P1 failure scenarios",
    });
  }
}

function auditExternalHmr({ checks, externalBlockers }) {
  addCheck(checks, {
    id: "P5.2-P5.3.synthetic-hmr-and-comparison-artifacts",
    passed: (
      existsSync(path.join(projectRoot, "scripts/hmr-jsonl-adapter.mjs")) &&
      existsSync(path.join(projectRoot, "scripts/motion-recording-compare.mjs")) &&
      existsSync(path.join(projectRoot, "output/reports/live-vs-offline-synthetic-turn.html"))
    ),
    evidence: "external HMR adapter and live-vs-offline comparison artifacts exist for synthetic recordings",
  });

  externalBlockers.push({
    id: "P5.2.real-offline-hmr-sample",
    status: "blocked_external_input",
    evidence: "No user-provided offline HMR sample is present for replay/acceptance promotion",
    requiredInput: "A real WHAM/GVHMR/GEM-X/SAM-3D-Body style output mapped through the JSONL adapter",
  });
}

function summarizeAgreement(model) {
  const summary = model?.summary ?? {};
  const replay = summary.recordingReplay ?? {};

  return {
    label: model?.label ?? "",
    overallPercent: round(summary.overallPercent),
    frameAgeP95Ms: round(summary.appFrameAgeP95Ms),
    detectP95Ms: round(summary.appDetectP95Ms),
    solverP95Ms: round(summary.poseSolverP95Ms),
    unsignedHingeMinLimitFrames: summary.poseSolverHingeViolationFrames,
    softHingeWarningFrames: summary.poseSolverHingeLimitWarningFrames,
    jsonlLines: replay.recordingJsonlLineCount,
    expectedJsonlLines: Number.isFinite(replay.recordingFrameCount) ? replay.recordingFrameCount + 1 : null,
  };
}

function addCheck(checks, { id, passed, evidence, details = undefined }) {
  checks.push({
    id,
    status: passed ? "passed" : "failed",
    evidence,
    ...(details === undefined ? {} : { details }),
  });
}

function fallbackReasonsMatchActiveDelegates(delegates) {
  if (!delegates || typeof delegates !== "object") {
    return false;
  }

  for (const detectorKey of ["pose", "hand"]) {
    if (delegates[detectorKey] === "CPU" && delegates.requested === "GPU" && !delegates.fallbackReasons?.[detectorKey]) {
      return false;
    }
  }

  return true;
}

function arrayIncludes(value, expected) {
  return Array.isArray(value) && value.includes(expected);
}

async function readJsonArtifact(relativePath, key = relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  try {
    return {
      key,
      relativePath,
      data: JSON.parse(await readFile(absolutePath, "utf8")),
      error: "",
    };
  } catch (error) {
    return {
      key,
      relativePath,
      data: null,
      error: error.message,
    };
  }
}

async function readTextArtifact(relativePath, key = relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);

  try {
    return {
      key,
      relativePath,
      data: await readFile(absolutePath, "utf8"),
      error: "",
    };
  } catch (error) {
    return {
      key,
      relativePath,
      data: "",
      error: error.message,
    };
  }
}

async function latestMtime(relativePaths) {
  const mtimes = await Promise.all(relativePaths.map(async (relativePath) => {
    try {
      return (await stat(path.join(projectRoot, relativePath))).mtimeMs;
    } catch {
      return null;
    }
  }));
  const finite = mtimes.filter(Number.isFinite);

  return finite.length > 0 ? Math.max(...finite) : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

await main();
