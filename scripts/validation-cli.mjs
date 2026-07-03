#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS, createSyntheticSequence } from "./generate-synthetic-landmarks.mjs";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = new Set(["synthetic", "agreement", "clips", "all"]);
const SYNTHETIC_OCCLUSION_SPIKE_THRESHOLD_DEG_PER_SEC = 180;
const SYNTHETIC_MAX_STATIC_JITTER_RMS_DEG_PER_SEC = 2;
const VALID_FACING_LABELS = new Set(["front", "side", "back"]);
const VALID_MODE_LABELS = new Set(["full-body", "upper-body", "lost"]);
const VALID_BODY_REGIONS = new Set(["full-body", "upper-body", "head-shoulders", "torso-up"]);
const VALID_RECOVERY_MODES = new Set(["full-body", "upper-body", "lost", "rest"]);
const CLIP_LABEL_SCHEMA = Object.freeze({
  expectedFacing: validateFacingLabel,
  expectedMode: validateModeLabel,
  staticPoseInterval: validateIntervalLabel,
  expectedFacingTimeline: validateFacingTimelineLabel,
  turnStartMs: validateNonNegativeNumberLabel,
  turnEndMs: validateNonNegativeNumberLabel,
  occludedJoints: validateStringArrayLabel,
  occlusionIntervals: validateIntervalArrayLabel,
  maxAngularVelocityDegPerSec: validatePositiveNumberLabel,
  jointFlexionTimeline: validateJointFlexionTimelineLabel,
  hingeLimits: validateHingeLimitsLabel,
  visibleBodyRegion: validateBodyRegionLabel,
  hiddenJoints: validateStringArrayLabel,
  headRotationTimeline: validateHeadRotationTimelineLabel,
  torsoStaticInterval: validateIntervalLabel,
  lostIntervals: validateIntervalArrayLabel,
  reacquiredAtMs: validateNonNegativeNumberLabel,
  expectedRecoveryMode: validateRecoveryModeLabel,
});

if (isMainModule()) {
  await main();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selectedSuites = expandSuites(args.suite);
  const results = [];

  for (const suite of selectedSuites) {
    results.push(await runSuite(suite, args));
  }

  const failed = results.filter((result) => result.status === "failed");
  const unavailable = results.filter((result) => result.status === "unavailable");

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    selectedSuites,
    results,
  }, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  } else if (unavailable.length > 0 && args.strictUnavailable) {
    process.exitCode = 1;
  }
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function parseArgs(rawArgs) {
  const parsed = {
    suite: "all",
    clipManifest: "",
    strictUnavailable: false,
    passthrough: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--suite") {
      parsed.suite = rawArgs[++index] ?? "all";
    } else if (arg === "--clip-manifest") {
      parsed.clipManifest = rawArgs[++index] ?? "";
    } else if (arg === "--strict-unavailable") {
      parsed.strictUnavailable = true;
    } else if (arg === "--") {
      parsed.passthrough.push(...rawArgs.slice(index + 1));
      break;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      parsed.passthrough.push(arg);
    }
  }

  if (!SUITES.has(parsed.suite)) {
    throw new Error(`Unknown validation suite: ${parsed.suite}`);
  }

  return parsed;
}

function expandSuites(suite) {
  if (suite === "all") {
    return ["synthetic", "clips", "agreement"];
  }

  return [suite];
}

async function runSuite(suite, options) {
  const startedAt = Date.now();

  try {
    if (suite === "synthetic") {
      const result = await runCommandSuite({
        suite,
        command: process.execPath,
        args: ["tests/solver-synthetic-check.mjs"],
        startedAt,
      });

      if (result.status === "passed") {
        result.metrics = buildSyntheticMetrics();
        result.qualityGates = buildSyntheticQualityGates(result.metrics);

        if (!result.qualityGates.passed) {
          result.status = "failed";
        }
      }

      return result;
    }

    if (suite === "agreement") {
      const reportPath = resolveAgreementReportPath(options.passthrough);
      const commandArgs = buildAgreementArgs(options.passthrough, reportPath);
      const result = await runCommandSuite({
        suite,
        command: process.execPath,
        args: ["scripts/avatar-motion-agreement-check.mjs", ...commandArgs],
        startedAt,
      });

      if (result.status === "passed" && reportPath) {
        result.reportPath = path.relative(projectRoot, reportPath);
        result.metrics = await buildAgreementMetrics(reportPath);
        result.qualityGates = buildAgreementQualityGates(result.metrics);

        if (!result.qualityGates.passed) {
          result.status = "failed";
        }
      }

      return result;
    }

    if (suite === "clips") {
      return await runClipSuite(startedAt, options);
    }
  } catch (error) {
    return {
      suite,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: error.message,
    };
  }

  return {
    suite,
    status: "failed",
    durationMs: Date.now() - startedAt,
    error: `Unhandled suite: ${suite}`,
  };
}

function resolveAgreementReportPath(passthrough) {
  const outputValue = readPassthroughOption(passthrough, "--output");

  if (outputValue === "") {
    return null;
  }

  return path.resolve(
    projectRoot,
    outputValue ?? "output/reports/validation-agreement-latest.json",
  );
}

function buildAgreementArgs(passthrough, reportPath) {
  if (hasPassthroughOption(passthrough, "--output")) {
    return passthrough;
  }

  return [
    ...passthrough,
    "--output",
    path.relative(projectRoot, reportPath),
  ];
}

function hasPassthroughOption(passthrough, optionName) {
  return passthrough.includes(optionName);
}

function readPassthroughOption(passthrough, optionName) {
  const index = passthrough.indexOf(optionName);

  if (index === -1) {
    return undefined;
  }

  return passthrough[index + 1] ?? "";
}

async function runCommandSuite({ suite, command, args, startedAt }) {
  const result = await spawnCommand(command, args);

  return {
    suite,
    status: result.exitCode === 0 ? "passed" : "failed",
    durationMs: Date.now() - startedAt,
    command: [command, ...args].join(" "),
    exitCode: result.exitCode,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
  };
}

async function runClipSuite(startedAt, options = {}) {
  const manifestPath = options.clipManifest
    ? path.resolve(projectRoot, options.clipManifest)
    : path.join(projectRoot, "tests/fixtures/clip-family/manifest.json");

  if (!existsSync(manifestPath)) {
    return {
      suite: "clips",
      status: "unavailable",
      durationMs: Date.now() - startedAt,
      manifestPath: path.relative(projectRoot, manifestPath),
      reason: "clip-family manifest has not been created yet",
    };
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const schema = validateClipManifest(manifest);
  const clips = Array.isArray(manifest.clips) ? manifest.clips : [];

  if (schema.errors.length > 0) {
    return {
      suite: "clips",
      status: "failed",
      durationMs: Date.now() - startedAt,
      manifestPath: path.relative(projectRoot, manifestPath),
      errors: schema.errors,
    };
  }

  return {
    suite: "clips",
    status: clips.length > 0 ? "passed" : "unavailable",
    durationMs: Date.now() - startedAt,
    manifestPath: path.relative(projectRoot, manifestPath),
    clipCount: clips.length,
    scenarioCount: schema.scenarioCount,
    coveredScenarioCount: schema.coveredScenarioCount,
    missingScenarioIds: schema.missingScenarioIds,
    scenarioCoverage: schema.scenarioCoverage,
    labelSchemaVersion: manifest.labelSchemaVersion,
    labelSchemaLabelCount: Object.keys(CLIP_LABEL_SCHEMA).length,
    reason: clips.length > 0 ? "" : "clip-family manifest contains no clips",
  };
}

async function buildAgreementMetrics(reportPath) {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const models = Array.isArray(report.models)
    ? report.models
    : (report.videos ?? []).flatMap((video) => video.models ?? []);
  const modelMetrics = models.map((model) => summarizeAgreementModel(model));

  return {
    videoCount: Array.isArray(report.videoPaths) ? report.videoPaths.length : 0,
    modelCount: modelMetrics.length,
    failureCount: Array.isArray(report.failures) ? report.failures.length : 0,
    warningCount: Array.isArray(report.warnings) ? report.warnings.length : 0,
    minOverallPercent: minNumber(modelMetrics.map((metric) => metric.overallPercent)),
    maxFrameAgeP95Ms: maxNumber(modelMetrics.map((metric) => metric.frameAgeP95Ms)),
    maxDetectP95Ms: maxNumber(modelMetrics.map((metric) => metric.detectP95Ms)),
    maxPoseSolverP95Ms: maxNumber(modelMetrics.map((metric) => metric.poseSolverP95Ms)),
    maxHingeViolationFrames: maxNumber(modelMetrics.map((metric) => metric.hingeViolationFrames)),
    maxHingeLimitWarningFrames: maxNumber(modelMetrics.map((metric) => metric.hingeLimitWarningFrames)),
    maxFacingChanges: maxNumber(modelMetrics.map((metric) => metric.facingChanges)),
    maxModeChanges: maxNumber(modelMetrics.map((metric) => metric.modeChanges)),
    maxReplayScoreDelta: maxNumber(modelMetrics.map((metric) => metric.replayScoreDelta)),
    allJsonlReplayLineCountsMatch: modelMetrics.every((metric) => metric.jsonlReplayLineCountMatches),
    models: modelMetrics,
  };
}

function summarizeAgreementModel(model) {
  const summary = model.summary ?? {};
  const replay = summary.recordingReplay ?? {};
  const recordingFrameCount = replay.recordingFrameCount ?? null;
  const recordingJsonlLineCount = replay.recordingJsonlLineCount ?? null;

  return {
    label: model.label ?? "",
    videoLabel: model.videoLabel ?? "",
    overallPercent: summary.overallPercent ?? null,
    directionPercent: percent(summary.components?.direction),
    projectionPercent: percent(summary.components?.projection),
    frameAgeP95Ms: summary.appFrameAgeP95Ms ?? null,
    frameCallbackLagP95Ms: summary.appFrameCallbackLagP95Ms ?? null,
    detectP95Ms: summary.appDetectP95Ms ?? null,
    frameTotalP95Ms: summary.appFrameTotalP95Ms ?? null,
    poseSolverP95Ms: summary.poseSolverP95Ms ?? null,
    poseSolverMode: summary.poseSolverMode ?? null,
    poseSolverFacing: summary.poseSolverFacing ?? null,
    hingeViolationFrames: summary.poseSolverHingeViolationFrames ?? null,
    hingeLimitWarningFrames: summary.poseSolverHingeLimitWarningFrames ?? null,
    hingeLimitWarningByName: summary.poseSolverHingeLimitWarningByName ?? null,
    maxHingeFlexDegByName: summary.poseSolverMaxHingeFlexDegByName ?? null,
    maxHingeOverflowDegByName: summary.poseSolverMaxHingeOverflowDegByName ?? null,
    facingChanges: summary.poseSolverFacingChanges ?? null,
    modeChanges: summary.poseSolverModeChanges ?? null,
    staleFrameCallbacks: summary.pumpStaleFrameCallbacks ?? null,
    detectorDelegatePose: summary.detectorDelegatePose ?? null,
    detectorDelegateAttempts: summary.detectorDelegateAttempts ?? null,
    detectorDelegateFallbackReasons: summary.detectorDelegateFallbackReasons ?? null,
    detectorDelegateLastFallbackReason: summary.detectorDelegateLastFallbackReason ?? null,
    recordingFrameCount,
    recordingJsonlLineCount,
    jsonlReplayLineCountMatches: (
      Number.isFinite(recordingFrameCount) &&
      Number.isFinite(recordingJsonlLineCount) &&
      recordingJsonlLineCount === recordingFrameCount + 1
    ),
    replayScoreDelta: replay.scoreDelta ?? null,
  };
}

function buildAgreementQualityGates(metrics) {
  const gates = {
    maxFrameAgeP95Ms: 66,
    maxPoseSolverP95Ms: 2,
    maxHingeViolationFrames: 0,
    requireJsonlReplayLineCountMatch: true,
  };
  const failures = [];

  if (
    Number.isFinite(metrics.maxFrameAgeP95Ms) &&
    metrics.maxFrameAgeP95Ms > gates.maxFrameAgeP95Ms
  ) {
    failures.push(`frame age p95 ${metrics.maxFrameAgeP95Ms.toFixed(2)}ms > ${gates.maxFrameAgeP95Ms}ms`);
  }

  if (
    Number.isFinite(metrics.maxPoseSolverP95Ms) &&
    metrics.maxPoseSolverP95Ms > gates.maxPoseSolverP95Ms
  ) {
    failures.push(`pose solver p95 ${metrics.maxPoseSolverP95Ms.toFixed(2)}ms > ${gates.maxPoseSolverP95Ms}ms`);
  }

  if (
    Number.isFinite(metrics.maxHingeViolationFrames) &&
    metrics.maxHingeViolationFrames > gates.maxHingeViolationFrames
  ) {
    failures.push(`unsigned hinge min-limit diagnostic frames ${metrics.maxHingeViolationFrames} > 0`);
  }

  if (gates.requireJsonlReplayLineCountMatch && !metrics.allJsonlReplayLineCountsMatch) {
    failures.push("JSONL replay line counts do not match recording frame counts + 1");
  }

  return {
    passed: failures.length === 0,
    gates,
    failures,
  };
}

function buildSyntheticMetrics() {
  const scenarios = Array.from(SCENARIOS).sort();
  const scenarioMetrics = scenarios.map((scenario) => buildSyntheticScenarioMetrics(scenario));
  const frameCount = scenarioMetrics.reduce((total, metric) => total + metric.frameCount, 0);

  return {
    scenarioCount: scenarioMetrics.length,
    frameCount,
    maxHingeViolationCount: Math.max(...scenarioMetrics.map((metric) => metric.hingeViolations)),
    maxHingeLimitWarningCount: Math.max(...scenarioMetrics.map((metric) => metric.hingeLimitWarnings)),
    maxFacingChanges: Math.max(...scenarioMetrics.map((metric) => metric.facingChanges)),
    maxModeChanges: Math.max(...scenarioMetrics.map((metric) => metric.modeChanges)),
    maxLowConfidenceHinges: Math.max(...scenarioMetrics.map((metric) => metric.lowConfidenceHingeFrames)),
    maxTargetAngularVelocityDegPerSec: maxNumber(scenarioMetrics.map((metric) => metric.maxTargetAngularVelocityDegPerSec)),
    maxReliableTargetAngularVelocityDegPerSec: maxNumber(scenarioMetrics.map((metric) => metric.maxReliableTargetAngularVelocityDegPerSec)),
    maxStaticJitterRmsDegPerSec: maxNumber(scenarioMetrics.map((metric) => metric.jitterRmsDegPerSec)),
    maxReliableOcclusionSpikeCount: maxNumber(scenarioMetrics.map((metric) => metric.reliableOcclusionSpikeCount)),
    maxSuppressedLowConfidenceSpikeCount: maxNumber(scenarioMetrics.map((metric) => metric.suppressedLowConfidenceSpikeCount)),
    maxModeChatterEvents: maxNumber(scenarioMetrics.map((metric) => metric.modeChatterEvents)),
    maxFacingChatterEvents: maxNumber(scenarioMetrics.map((metric) => metric.facingChatterEvents)),
    scenarios: scenarioMetrics,
  };
}

function buildSyntheticQualityGates(metrics) {
  const gates = {
    maxHingeViolationCount: 0,
    maxHingeLimitWarningCount: 0,
    maxReliableOcclusionSpikeCount: 0,
    maxModeChatterEvents: 0,
    maxFacingChatterEvents: 0,
    maxStaticJitterRmsDegPerSec: SYNTHETIC_MAX_STATIC_JITTER_RMS_DEG_PER_SEC,
  };
  const failures = [];

  if (metrics.maxHingeViolationCount > gates.maxHingeViolationCount) {
    failures.push(`synthetic unsigned hinge min-limit diagnostics ${metrics.maxHingeViolationCount} > 0`);
  }

  if (metrics.maxHingeLimitWarningCount > gates.maxHingeLimitWarningCount) {
    failures.push(`synthetic soft hinge warnings ${metrics.maxHingeLimitWarningCount} > 0`);
  }

  if (metrics.maxReliableOcclusionSpikeCount > gates.maxReliableOcclusionSpikeCount) {
    failures.push(`reliable occlusion spikes ${metrics.maxReliableOcclusionSpikeCount} > 0`);
  }

  if (metrics.maxModeChatterEvents > gates.maxModeChatterEvents) {
    failures.push(`mode chatter events ${metrics.maxModeChatterEvents} > 0`);
  }

  if (metrics.maxFacingChatterEvents > gates.maxFacingChatterEvents) {
    failures.push(`facing chatter events ${metrics.maxFacingChatterEvents} > 0`);
  }

  if (
    Number.isFinite(metrics.maxStaticJitterRmsDegPerSec) &&
    metrics.maxStaticJitterRmsDegPerSec > gates.maxStaticJitterRmsDegPerSec
  ) {
    failures.push(
      `static jitter RMS ${metrics.maxStaticJitterRmsDegPerSec.toFixed(3)}deg/s > ${gates.maxStaticJitterRmsDegPerSec}deg/s`,
    );
  }

  return {
    passed: failures.length === 0,
    gates,
    failures,
  };
}

function buildSyntheticScenarioMetrics(scenario) {
  const sequence = createSyntheticSequence({ scenario, frames: 9 });
  let previousState = {};
  let previousFacing = null;
  let previousMode = null;
  let facingChanges = 0;
  let modeChanges = 0;
  let hingeViolations = 0;
  let hingeLimitWarnings = 0;
  let lowConfidenceHingeFrames = 0;
  let leftElbowMaeTotal = 0;
  let leftElbowMaeCount = 0;
  let firstFacing = null;
  let lastFacing = null;
  let firstMode = null;
  let lastMode = null;
  let previousTimestamp = null;
  let previousTargets = new Map();
  const targetVelocities = [];
  const reliableTargetVelocities = [];
  const targetVelocityRows = [];
  const facingStates = [];
  const modeStates = [];

  for (const frame of sequence.frames) {
    const solved = solvePoseFrame(frame, previousState);
    previousState = solved.state;
    firstFacing ??= solved.meta.facing;
    firstMode ??= solved.meta.mode;
    lastFacing = solved.meta.facing;
    lastMode = solved.meta.mode;
    facingStates.push(solved.meta.facing);
    modeStates.push(solved.meta.mode);

    if (previousFacing && previousFacing !== solved.meta.facing) {
      facingChanges += 1;
    }

    if (previousMode && previousMode !== solved.meta.mode) {
      modeChanges += 1;
    }

    previousFacing = solved.meta.facing;
    previousMode = solved.meta.mode;
    hingeViolations += solved.meta.hingeViolations;
    hingeLimitWarnings += solved.meta.hingeLimitWarnings;
    recordTargetVelocities({
      solved,
      targetVelocities,
      reliableTargetVelocities,
      targetVelocityRows,
      previousTargets,
      previousTimestamp,
      timestamp: frame.timestamp,
    });
    previousTargets = new Map(solved.targets.map((target) => [target.bone, target]));
    previousTimestamp = frame.timestamp;

    if (solved.hinges.some((hinge) => hinge.confidence < 0.5)) {
      lowConfidenceHingeFrames += 1;
    }

    const expectedLeftElbow = frame.expected?.joints?.leftElbow;
    const solvedLeftElbow = solved.hinges.find((hinge) => hinge.name === "leftElbow");

    if (
      expectedLeftElbow &&
      solvedLeftElbow &&
      Number.isFinite(expectedLeftElbow.flexDeg) &&
      Number.isFinite(solvedLeftElbow.flexDeg) &&
      solvedLeftElbow.confidence >= 0.5
    ) {
      leftElbowMaeTotal += Math.abs(solvedLeftElbow.flexDeg - expectedLeftElbow.flexDeg);
      leftElbowMaeCount += 1;
    }
  }

  const reliableOcclusionSpikeCount = targetVelocityRows.filter((row) => (
    row.velocityDegPerSec > SYNTHETIC_OCCLUSION_SPIKE_THRESHOLD_DEG_PER_SEC &&
    row.occluded &&
    row.reliable
  )).length;
  const suppressedLowConfidenceSpikeCount = targetVelocityRows.filter((row) => (
    row.velocityDegPerSec > SYNTHETIC_OCCLUSION_SPIKE_THRESHOLD_DEG_PER_SEC &&
    row.occluded &&
    !row.reliable
  )).length;

  return {
    scenario,
    frameCount: sequence.frames.length,
    facingStart: firstFacing,
    facingEnd: lastFacing,
    facingChanges,
    modeStart: firstMode,
    modeEnd: lastMode,
    modeChanges,
    hingeViolations,
    hingeLimitWarnings,
    lowConfidenceHingeFrames,
    maxTargetAngularVelocityDegPerSec: round(maxNumber(targetVelocities) ?? 0, 3),
    maxReliableTargetAngularVelocityDegPerSec: round(maxNumber(reliableTargetVelocities) ?? 0, 3),
    reliableOcclusionSpikeCount,
    suppressedLowConfidenceSpikeCount,
    targetVelocityRmsDegPerSec: round(rms(reliableTargetVelocities), 3),
    jitterRmsDegPerSec: scenario === "identity"
      ? round(rms(reliableTargetVelocities), 3)
      : null,
    modeChatterEvents: countStateChatter(modeStates),
    facingChatterEvents: countStateChatter(facingStates),
    leftElbowMaeDeg: leftElbowMaeCount > 0
      ? round(leftElbowMaeTotal / leftElbowMaeCount, 3)
      : null,
  };
}

function recordTargetVelocities({
  solved,
  targetVelocities,
  reliableTargetVelocities,
  targetVelocityRows,
  previousTargets,
  previousTimestamp,
  timestamp,
}) {
  if (!Number.isFinite(previousTimestamp)) {
    return;
  }

  const elapsedSeconds = (timestamp - previousTimestamp) / 1000;

  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return;
  }

  for (const target of solved.targets) {
    const previousTarget = previousTargets.get(target.bone);

    if (!previousTarget) {
      continue;
    }

    const angleDeg = directionAngleDeg(previousTarget.direction, target.direction);
    const velocity = angleDeg / elapsedSeconds;
    const reliable = previousTarget.confidence >= 0.5 && target.confidence >= 0.5;
    const occluded = previousTarget.confidence < 0.5 || target.confidence < 0.5;

    targetVelocities.push(velocity);
    targetVelocityRows.push({
      bone: target.bone,
      group: target.group,
      velocityDegPerSec: velocity,
      previousConfidence: previousTarget.confidence,
      confidence: target.confidence,
      reliable,
      occluded,
    });

    if (reliable) {
      reliableTargetVelocities.push(velocity);
    }
  }
}

function countStateChatter(states) {
  let chatter = 0;
  let index = 0;

  while (index < states.length) {
    const state = states[index];
    let end = index + 1;

    while (end < states.length && states[end] === state) {
      end += 1;
    }

    const previous = index > 0 ? states[index - 1] : null;
    const next = end < states.length ? states[end] : null;

    if (previous && next && previous === next && previous !== state && end - index <= 1) {
      chatter += 1;
    }

    index = end;
  }

  return chatter;
}

export function validateClipManifest(manifest) {
  const errors = [];
  const scenarios = Array.isArray(manifest?.scenarios) ? manifest.scenarios : [];
  const clips = Array.isArray(manifest?.clips) ? manifest.clips : [];
  const scenarioMap = new Map();

  if (!manifest || typeof manifest !== "object") {
    return {
      errors: ["manifest must be a JSON object"],
      scenarioCount: 0,
      coveredScenarioCount: 0,
      missingScenarioIds: [],
      scenarioCoverage: {},
    };
  }

  if (manifest.version !== 1) {
    errors.push("version must be 1");
  }

  if (manifest.labelSchemaVersion !== 1) {
    errors.push("labelSchemaVersion must be 1");
  }

  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0) {
    errors.push("scenarios must be a non-empty array");
  } else {
    for (const [index, scenario] of manifest.scenarios.entries()) {
      if (!scenario?.id || typeof scenario.id !== "string") {
        errors.push(`scenarios[${index}].id must be a string`);
      } else if (scenarioMap.has(scenario.id)) {
        errors.push(`scenarios[${index}].id duplicates ${scenario.id}`);
      } else {
        scenarioMap.set(scenario.id, scenario);
      }

      if (!scenario?.description || typeof scenario.description !== "string") {
        errors.push(`scenarios[${index}].description must be a string`);
      }

      if (!Array.isArray(scenario.requiredLabels) || scenario.requiredLabels.length === 0) {
        errors.push(`scenarios[${index}].requiredLabels must be a non-empty array`);
      } else {
        for (const label of scenario.requiredLabels) {
          if (!CLIP_LABEL_SCHEMA[label]) {
            errors.push(`scenarios[${index}].requiredLabels contains unknown label ${label}`);
          }
        }
      }
    }
  }

  if (!Array.isArray(manifest.clips)) {
    errors.push("clips must be an array");
  } else {
    for (const [index, clip] of manifest.clips.entries()) {
      if (!clip?.id || typeof clip.id !== "string") {
        errors.push(`clips[${index}].id must be a string`);
      }

      if (!clip?.scenario || typeof clip.scenario !== "string") {
        errors.push(`clips[${index}].scenario must be a string`);
      } else if (!scenarioMap.has(clip.scenario)) {
        errors.push(`clips[${index}].scenario references unknown scenario ${clip.scenario}`);
      }

      if (!clip?.path || typeof clip.path !== "string") {
        errors.push(`clips[${index}].path must be a string`);
      } else if (!clipPathExists(clip.path)) {
        errors.push(`clips[${index}].path does not exist: ${clip.path}`);
      }

      if (!clip?.labels || typeof clip.labels !== "object" || Array.isArray(clip.labels)) {
        errors.push(`clips[${index}].labels must be an object`);
      } else if (scenarioMap.has(clip.scenario)) {
        const requiredLabels = scenarioMap.get(clip.scenario).requiredLabels ?? [];
        for (const label of requiredLabels) {
          if (!Object.hasOwn(clip.labels, label)) {
            errors.push(`clips[${index}].labels missing required label ${label}`);
          }
        }
        errors.push(...validateClipLabels(clip.labels, requiredLabels, `clips[${index}].labels`));
      }
    }
  }

  const scenarioCoverage = Object.fromEntries(
    scenarios
      .filter((scenario) => scenario?.id)
      .map((scenario) => [
        scenario.id,
        clips.filter((clip) => clip?.scenario === scenario.id).length,
      ]),
  );
  const missingScenarioIds = Object.entries(scenarioCoverage)
    .filter(([, count]) => count === 0)
    .map(([id]) => id);

  if (clips.length > 0 && missingScenarioIds.length > 0) {
    errors.push(`clips missing coverage for scenarios: ${missingScenarioIds.join(", ")}`);
  }

  return {
    errors,
    scenarioCount: scenarios.length,
    coveredScenarioCount: Object.values(scenarioCoverage).filter((count) => count > 0).length,
    missingScenarioIds,
    scenarioCoverage,
  };
}

export function validateClipLabels(labels, requiredLabels, prefix = "labels") {
  const errors = [];

  for (const label of requiredLabels ?? []) {
    if (!Object.hasOwn(labels ?? {}, label)) {
      continue;
    }

    const validator = CLIP_LABEL_SCHEMA[label];

    if (!validator) {
      errors.push(`${prefix}.${label} has no label schema validator`);
      continue;
    }

    errors.push(...validator(labels[label], `${prefix}.${label}`));
  }

  if (Object.hasOwn(labels ?? {}, "turnStartMs") && Object.hasOwn(labels ?? {}, "turnEndMs")) {
    const start = Number(labels.turnStartMs);
    const end = Number(labels.turnEndMs);

    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      errors.push(`${prefix}.turnEndMs must be >= turnStartMs`);
    }
  }

  return errors;
}

function validateFacingLabel(value, label) {
  return VALID_FACING_LABELS.has(value) ? [] : [`${label} must be one of ${[...VALID_FACING_LABELS].join(", ")}`];
}

function validateModeLabel(value, label) {
  return VALID_MODE_LABELS.has(value) ? [] : [`${label} must be one of ${[...VALID_MODE_LABELS].join(", ")}`];
}

function validateBodyRegionLabel(value, label) {
  return VALID_BODY_REGIONS.has(value) ? [] : [`${label} must be one of ${[...VALID_BODY_REGIONS].join(", ")}`];
}

function validateRecoveryModeLabel(value, label) {
  return VALID_RECOVERY_MODES.has(value) ? [] : [`${label} must be one of ${[...VALID_RECOVERY_MODES].join(", ")}`];
}

function validateNonNegativeNumberLabel(value, label) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 ? [] : [`${label} must be a non-negative number`];
}

function validatePositiveNumberLabel(value, label) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? [] : [`${label} must be a positive number`];
}

function validateStringArrayLabel(value, label) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim())) {
    return [`${label} must be a non-empty string array`];
  }

  return [];
}

function validateIntervalLabel(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [`${label} must be an interval object`];
  }

  const start = Number(value.startMs);
  const end = Number(value.endMs);

  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(end) || end < start) {
    return [`${label} must have non-negative startMs and endMs >= startMs`];
  }

  return [];
}

function validateIntervalArrayLabel(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${label} must be a non-empty interval array`];
  }

  return value.flatMap((entry, index) => validateIntervalLabel(entry, `${label}[${index}]`));
}

function validateFacingTimelineLabel(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${label} must be a non-empty facing timeline array`];
  }

  return value.flatMap((entry, index) => {
    const prefix = `${label}[${index}]`;
    const errors = [];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [`${prefix} must be an object`];
    }

    if (!Number.isFinite(Number(entry.atMs)) || Number(entry.atMs) < 0) {
      errors.push(`${prefix}.atMs must be a non-negative number`);
    }

    errors.push(...validateFacingLabel(entry.facing, `${prefix}.facing`));
    return errors;
  });
}

function validateJointFlexionTimelineLabel(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${label} must be a non-empty joint flexion timeline array`];
  }

  return value.flatMap((entry, index) => {
    const prefix = `${label}[${index}]`;
    const errors = [];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [`${prefix} must be an object`];
    }

    if (!entry.joint || typeof entry.joint !== "string") {
      errors.push(`${prefix}.joint must be a string`);
    }

    if (!Number.isFinite(Number(entry.atMs)) || Number(entry.atMs) < 0) {
      errors.push(`${prefix}.atMs must be a non-negative number`);
    }

    if (!Number.isFinite(Number(entry.flexDeg))) {
      errors.push(`${prefix}.flexDeg must be a number`);
    }

    return errors;
  });
}

function validateHingeLimitsLabel(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
    return [`${label} must be a non-empty object keyed by hinge name`];
  }

  return Object.entries(value).flatMap(([hingeName, limits]) => {
    const prefix = `${label}.${hingeName}`;
    const errors = [];

    if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
      return [`${prefix} must be an object`];
    }

    const min = Number(limits.minFlexDeg);
    const max = Number(limits.maxFlexDeg);

    if (!Number.isFinite(min)) {
      errors.push(`${prefix}.minFlexDeg must be a number`);
    }

    if (!Number.isFinite(max)) {
      errors.push(`${prefix}.maxFlexDeg must be a number`);
    }

    if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
      errors.push(`${prefix}.maxFlexDeg must be >= minFlexDeg`);
    }

    return errors;
  });
}

function validateHeadRotationTimelineLabel(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    return [`${label} must be a non-empty head rotation timeline array`];
  }

  return value.flatMap((entry, index) => {
    const prefix = `${label}[${index}]`;
    const errors = [];

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [`${prefix} must be an object`];
    }

    if (!Number.isFinite(Number(entry.atMs)) || Number(entry.atMs) < 0) {
      errors.push(`${prefix}.atMs must be a non-negative number`);
    }

    for (const key of ["pitchDeg", "yawDeg", "rollDeg"]) {
      if (!Number.isFinite(Number(entry[key]))) {
        errors.push(`${prefix}.${key} must be a number`);
      }
    }

    return errors;
  });
}

function clipPathExists(clipPath) {
  if (/^https?:\/\//i.test(clipPath)) {
    return true;
  }

  return existsSync(path.resolve(projectRoot, clipPath));
}

function spawnCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function tail(value, maxLength = 2000) {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return value.slice(value.length - maxLength);
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percent(value) {
  return Number.isFinite(value) ? round(value * 100, 3) : null;
}

function directionAngleDeg(a, b) {
  if (!a || !b) {
    return 0;
  }

  const dot = (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
  const aLength = Math.hypot(a.x, a.y, a.z);
  const bLength = Math.hypot(b.x, b.y, b.z);

  if (aLength <= 0 || bLength <= 0) {
    return 0;
  }

  const cosine = Math.max(-1, Math.min(1, dot / (aLength * bLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function rms(values) {
  const finite = values.filter(Number.isFinite);

  if (finite.length === 0) {
    return 0;
  }

  const meanSquare = finite.reduce((sum, value) => sum + value * value, 0) / finite.length;
  return Math.sqrt(meanSquare);
}

function minNumber(values) {
  const finite = values.filter(Number.isFinite);

  return finite.length > 0 ? Math.min(...finite) : null;
}

function maxNumber(values) {
  const finite = values.filter(Number.isFinite);

  return finite.length > 0 ? Math.max(...finite) : null;
}

function printUsage() {
  console.log(`Usage:
  node scripts/validation-cli.mjs --suite synthetic
  node scripts/validation-cli.mjs --suite clips --clip-manifest output/local-clip-manifest.json
  node scripts/validation-cli.mjs --suite agreement -- --only-models --model Xbot=assets/models/Xbot.glb
  node scripts/validation-cli.mjs --suite all

Suites:
  synthetic   Run the deterministic solver synthetic fixture check.
  agreement   Run the browser avatar motion agreement gate.
  clips       Inspect clip-family manifest availability.
  all         Run synthetic, clips, and agreement in order.

Options:
  --suite <name>            Validation suite. Default all.
  --clip-manifest <path>    Clip-family manifest path for clips suite.
  --strict-unavailable      Treat unavailable suites as command failure.
  --                         Remaining arguments pass to agreement suite.
`);
}
