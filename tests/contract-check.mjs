#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeBoundedFrameSize } from "../src/bounded-frame-snapshot.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const files = {
  readme: "README.md",
  packageJson: "package.json",
  html: "index.html",
  css: "styles.css",
  app: "src/app.js",
  auxiliaryInferenceArbiter: "src/auxiliary-inference-arbiter.js",
  faceObservationMaturation: "src/face-observation-maturation.js",
  boundedFrameSnapshot: "src/bounded-frame-snapshot.js",
  avatarRenderer: "src/avatar-renderer.js",
  faceHeadPose: "src/face-head-pose.js",
  retargetOrientation: "src/retarget-orientation.js",
  handRetargeting: "src/hand-retargeting.js",
  strictRetarget: "src/retarget/skeleton-fk-retarget.js",
  depthCalibration: "src/depth-calibration.js",
  motionFrame: "src/motion-frame.js",
  motionWorker: "src/motion-worker.js",
  faceWorker: "src/face-worker.js",
  latestFramePump: "src/latest-frame-pump.js",
  trackingInputGeneration: "src/tracking-input-generation.js",
  videoPlaybackBackpressure: "src/video-playback-backpressure.js",
  handWorker: "src/hand-worker.js",
  motionForwarding: "src/motion-forwarding.js",
  presenceState: "src/presence-state.js",
  manualLabels: "src/labels/manual-labels.js",
  gestureClassifier: "src/labels/gesture-classifier.js",
  poseSolver: "src/solver/pose-solver.js",
  vrmHumanoidMapping: "src/vrm-humanoid-mapping.js",
  vrmExpressionMapping: "src/vrm-expression-mapping.js",
  vrmRenderingCompat: "src/vrm-rendering-compat.js",
  mhr70Hands: "src/skeleton/mhr70-hands.js",
  avatarModel: "assets/models/Xbot.glb",
  claudeSettings: ".claude/settings.json",
  claudeCodexCommand: ".claude/commands/codex-consult.md",
  claudeCodexScript: "scripts/claude-codex-consult.sh",
  avatarPerformanceScript: "scripts/avatar-performance-check.mjs",
  avatarMotionAgreementScript: "scripts/avatar-motion-agreement-check.mjs",
  framePumpPerformanceScript: "scripts/frame-pump-performance-check.mjs",
  syntheticGeneratorScript: "scripts/generate-synthetic-landmarks.mjs",
  validationCliScript: "scripts/validation-cli.mjs",
  hmrJsonlAdapterScript: "scripts/hmr-jsonl-adapter.mjs",
  motionRecordingCompareScript: "scripts/motion-recording-compare.mjs",
  retargetModeCompareScript: "scripts/retarget-mode-compare.mjs",
  samManualLabelsScript: "scripts/sam-manual-labels.mjs",
  samReferenceLabelerScript: "scripts/sam-reference-labeler.mjs",
  samRegressionOracleScript: "scripts/sam-regression-oracle.mjs",
  motionStatusHudSmokeScript: "scripts/motion-status-hud-smoke.mjs",
  headPoseSmokeScript: "scripts/head-pose-smoke.mjs",
  rootYawRecoverySmokeScript: "scripts/root-yaw-recovery-smoke.mjs",
  motionGoalAuditScript: "scripts/motion-goal-audit.mjs",
  avatarVrmPerformanceScript: "scripts/avatar-vrm-performance-check.mjs",
  avatarVrmRenderingCompatCheck: "tests/avatar-vrm-rendering-compat-check.mjs",
  avatarVrmHumanoidCheck: "tests/avatar-vrm-humanoid-check.mjs",
  avatarVrmExpressionCheck: "tests/avatar-vrm-expression-check.mjs",
  retargetOrientationCheck: "tests/retarget-orientation-check.mjs",
  faceHeadPoseCheck: "tests/face-head-pose-check.mjs",
  strictRetargetCheck: "tests/strict-retarget-check.mjs",
  depthCalibrationCheck: "tests/depth-calibration-check.mjs",
  motionFrameCheck: "tests/motion-frame-check.mjs",
  motionForwardingCheck: "tests/motion-forwarding-check.mjs",
  presenceStateCheck: "tests/presence-state-check.mjs",
  facingEstimatorCheck: "tests/facing-estimator-check.mjs",
  solverSyntheticCheck: "tests/solver-synthetic-check.mjs",
  samManualLabelsCheck: "tests/sam-manual-labels-check.mjs",
  motionRecordingCompareCheck: "tests/motion-recording-compare-check.mjs",
  retargetModeCompareCheck: "tests/retarget-mode-compare-check.mjs",
  mhr70MappingCheck: "tests/mhr70-mapping-check.mjs",
  mhr70HandsCheck: "tests/mhr70-hands-check.mjs",
  gestureClassifierCheck: "tests/gesture-classifier-check.mjs",
  samReferenceLabelerCheck: "tests/sam-reference-labeler-check.mjs",
  samRegressionOracleCheck: "tests/sam-regression-oracle-check.mjs",
  hmrJsonlAdapterCheck: "tests/hmr-jsonl-adapter-check.mjs",
  clipManifestCheck: "tests/clip-manifest-check.mjs",
  trackingInputGenerationCheck: "tests/tracking-input-generation-check.mjs",
  clipFamilyManifest: "tests/fixtures/clip-family/manifest.json",
};

const mediaPipeVersion = "0.10.35";
const threeVersion = "0.184.0";
const threeVrmVersion = "3.5.4";
const appRuntimeToken = "20260717-face-gap-release-1";
const auxiliaryInferenceArbiterRuntimeToken = "20260716-capacity2-bounded-wait-2";
const faceObservationMaturationRuntimeToken =
  "20260716-face-source-slot-maturation-1";
const boundedFrameSnapshotRuntimeToken = "20260716-face512-1";
const motionRecordingRuntimeToken = "20260716-recording-chunks-1";
const avatarRuntimeToken = "20260717-face-gap-release-1";
const rigLocalRotationRuntimeToken =
  "20260715-causal-arm-local-rate-1";
const trackingCadenceRuntimeToken = "20260716-face-slots-1";
const retargetOrientationRuntimeToken = "20260715-palm-local-fingers-1";
const handRetargetingRuntimeToken = "20260708-fist-curl-1";
const handSideRuntimeToken = "20260708-single-hand-side-1";
const motionWorkerRuntimeToken = "20260717-prewarmed-pose-pool-1";
const faceWorkerRuntimeToken = "20260716-cpu-face-1";
const latestFramePumpRuntimeToken = "20260716-pending-settlement-1";
const trackingInputGenerationRuntimeToken = "20260717-prewarmed-pose-pool-1";
const videoPlaybackBackpressureRuntimeToken =
  "20260716-body-tail-hysteresis-1";
const handWorkerRuntimeToken = "20260715-current-pose-image-roi-1";

const requiredTrackerDomIds = [
  "camera-status",
  "model-status",
  "camera-video",
  "overlay-canvas",
  "error-message",
  "start-button",
  "stop-button",
  "video-file-input",
  "avatar-file-input",
  "avatar-default-button",
  "model-select",
  "mirror-toggle",
  "face-tracking-toggle",
  "avatar-skeleton-toggle",
  "fps-value",
  "pose-count",
  "left-hand-count",
  "right-hand-count",
  "motion-status-facing",
  "motion-status-mode",
  "motion-status-quality",
  "motion-status-delegate",
  "motion-status-fps",
  "motion-status-frame-age",
  "motion-status-solver",
  "motion-status-drops",
  "motion-status-calibration",
  "motion-status-calibration-guide",
  "motion-status-calibrate",
];

const requiredAvatarDomIds = [
  "avatar-canvas",
  "avatar-view-reset",
  "avatar-status",
  "avatar-bone-count",
  "avatar-face-status",
  "avatar-expression-status",
];

const requiredFingerBaseBones = [
  "mixamorig:LeftHandThumb1",
  "mixamorig:LeftHandIndex1",
  "mixamorig:LeftHandMiddle1",
  "mixamorig:LeftHandRing1",
  "mixamorig:LeftHandPinky1",
  "mixamorig:RightHandThumb1",
  "mixamorig:RightHandIndex1",
  "mixamorig:RightHandMiddle1",
  "mixamorig:RightHandRing1",
  "mixamorig:RightHandPinky1",
];

const requiredAvatarBones = [
  "Hips",
  "Spine",
  "Spine1",
  "Spine2",
  "Neck",
  "Head",
  "LeftArm",
  "LeftForeArm",
  "LeftHand",
  "RightArm",
  "RightForeArm",
  "RightHand",
  "LeftUpLeg",
  "LeftLeg",
  "LeftFoot",
  "RightUpLeg",
  "RightLeg",
  "RightFoot",
  "LeftHandThumb1",
  "LeftHandIndex1",
  "LeftHandMiddle1",
  "LeftHandRing1",
  "LeftHandPinky1",
  "RightHandThumb1",
  "RightHandIndex1",
  "RightHandMiddle1",
  "RightHandRing1",
  "RightHandPinky1",
];

async function readProjectFile(relativePath) {
  try {
    return await readFile(path.join(projectRoot, relativePath), "utf8");
  } catch (error) {
    failures.push(`${relativePath}: unable to read file (${error.code ?? error.message})`);
    return "";
  }
}

async function readProjectBytes(relativePath) {
  try {
    return await readFile(path.join(projectRoot, relativePath));
  } catch (error) {
    failures.push(`${relativePath}: unable to read binary file (${error.code ?? error.message})`);
    return null;
  }
}

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function checkPattern(source, pattern, message) {
  check(pattern.test(source), message);
}

function checkRuntimeCacheContract(
  html,
  app,
  avatarRenderer,
  motionWorker,
  faceWorker,
  handWorker,
) {
  checkPattern(
    html,
    new RegExp(`<script\\b[^>]+src\\s*=\\s*["']\\.\\/src\\/app\\.js\\?v=${escapeRegExp(appRuntimeToken)}["']`),
    "index.html: app module cache token must include the latest runtime fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/avatar-renderer\\.js\\?v=${escapeRegExp(avatarRuntimeToken)}["']`),
    "src/app.js: avatar-renderer import cache token must include the latest avatar retarget fix",
  );
  checkPattern(
    avatarRenderer,
    new RegExp(`from\\s*["']\\.\\/retarget\\/rig-local-rotation\\.js\\?v=${escapeRegExp(rigLocalRotationRuntimeToken)}["']`),
    "src/avatar-renderer.js: rig-local rotation import cache token must include the latest causal arm local-rate fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/tracking-cadence\\.js\\?v=${escapeRegExp(trackingCadenceRuntimeToken)}["']`),
    "src/app.js: tracking-cadence import cache token must include the source-PTS admission fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/bounded-frame-snapshot\\.js\\?v=${escapeRegExp(boundedFrameSnapshotRuntimeToken)}["']`),
    "src/app.js: bounded Face snapshot import must include the latest cache token",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/auxiliary-inference-arbiter\\.js\\?v=${escapeRegExp(auxiliaryInferenceArbiterRuntimeToken)}["']`),
    "src/app.js: auxiliary inference owner import must include the capacity-two cache token",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/face-observation-maturation\\.js\\?v=${escapeRegExp(faceObservationMaturationRuntimeToken)}["']`),
    "src/app.js: Face maturation owner import must include the source-slot cache token",
  );
  checkPattern(
    avatarRenderer,
    new RegExp(`from\\s*["']\\.\\/retarget-orientation\\.js\\?v=${escapeRegExp(retargetOrientationRuntimeToken)}["']`),
    "src/avatar-renderer.js: retarget-orientation import cache token must include the latest orientation fix",
  );
  checkPattern(
    avatarRenderer,
    new RegExp(`from\\s*["']\\.\\/hand-retargeting\\.js\\?v=${escapeRegExp(handRetargetingRuntimeToken)}["']`),
    "src/avatar-renderer.js: hand-retargeting import cache token must include the thumb segment fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/motion-frame\\.js\\?v=${escapeRegExp(motionRecordingRuntimeToken)}["']`),
    "src/app.js: motion-frame import cache token must include bounded recording export",
  );
  checkPattern(
    app,
    new RegExp(`new\\s+URL\\s*\\(\\s*["']\\.\\/motion-worker\\.js\\?v=${escapeRegExp(motionWorkerRuntimeToken)}["']\\s*,\\s*import\\.meta\\.url\\s*\\)`),
    "src/app.js: motion-worker cache token must include the latest tracking runtime fix",
  );
  checkPattern(
    app,
    new RegExp(`new\\s+URL\\s*\\(\\s*["']\\.\\/face-worker\\.js\\?v=${escapeRegExp(faceWorkerRuntimeToken)}["']\\s*,\\s*import\\.meta\\.url\\s*\\)`),
    "src/app.js: face-worker cache token must include the latest Face runtime fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/tracking-input-generation\\.js\\?v=${escapeRegExp(trackingInputGenerationRuntimeToken)}["']`),
    "src/app.js: tracker-generation helper cache token must include the latest body runtime fix",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/latest-frame-pump\\.js\\?v=${escapeRegExp(latestFramePumpRuntimeToken)}["']`),
    "src/app.js: latest-frame pump import must include the pending-transition cache token",
  );
  checkPattern(
    app,
    new RegExp(`from\\s*["']\\.\\/video-playback-backpressure\\.js\\?v=${escapeRegExp(videoPlaybackBackpressureRuntimeToken)}["']`),
    "src/app.js: file-video backpressure import must include the latest runtime token",
  );
  checkPattern(
    motionWorker,
    new RegExp(`from\\s*["']\\.\\/motion-frame\\.js\\?v=${escapeRegExp(handSideRuntimeToken)}["']`),
    "src/motion-worker.js: motion-frame import cache token must include the camera hand-side fix",
  );
  checkPattern(
    motionWorker,
    new RegExp(`from\\s*["']\\.\\/tracking-input-generation\\.js\\?v=${escapeRegExp(trackingInputGenerationRuntimeToken)}["']`),
    "src/motion-worker.js: tracker-generation helper cache token must include the latest body runtime fix",
  );
  checkPattern(
    app,
    new RegExp(`new\\s+URL\\s*\\(\\s*["']\\.\\/hand-worker\\.js\\?v=${escapeRegExp(handWorkerRuntimeToken)}["']\\s*,\\s*import\\.meta\\.url\\s*\\)`),
    "src/app.js: hand-worker cache token must include the split worker runtime",
  );
  checkPattern(
    handWorker,
    new RegExp(`from\\s*["']\\.\\/motion-frame\\.js\\?v=${escapeRegExp(handSideRuntimeToken)}["']`),
    "src/hand-worker.js: motion-frame import cache token must include the camera hand-side fix",
  );
}

function sourceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = start >= 0 ? source.indexOf(endNeedle, start + startNeedle.length) : -1;

  if (start < 0 || end < 0) {
    return "";
  }

  return source.slice(start, end);
}

function checkBodyTailHysteresisContract(
  app,
  latestFramePump,
  videoPlaybackBackpressure,
) {
  const pumpRun = sourceBetween(
    latestFramePump,
    "async function run(",
    "function startPendingIfIdle(",
  );
  checkPattern(
    pumpRun,
    /inFlight\s*=\s*false[\s\S]*settledTransitions\s*\+=\s*1[\s\S]*emitTransition\(\s*["']pending-settled["']/,
    `${files.latestFramePump}: promoted work must emit immutable settlement after consume/apply/dispose completes`,
  );

  const acquire = sourceBetween(
    videoPlaybackBackpressure,
    "function acquire(",
    "function handleReplacement(",
  );
  check(
    acquire.indexOf("armDeadline(owner)") >= 0 &&
      acquire.indexOf("armDeadline(owner)") < acquire.indexOf("armHysteresis(owner)"),
    `${files.videoPlaybackBackpressure}: acquisition must preserve the absolute deadline before arming hysteresis`,
  );
  check(
    !acquire.includes("cancelScheduledFrame()") && !acquire.includes(".pause()"),
    `${files.videoPlaybackBackpressure}: acquisition must not control callbacks or media before hysteresis expires`,
  );

  const replacement = sourceBetween(
    videoPlaybackBackpressure,
    "function handleReplacement(",
    "function handleTransition(",
  );
  check(
    !/deadlineMonotonicMs\s*=/.test(replacement),
    `${files.videoPlaybackBackpressure}: replacement must preserve the original callback absolute deadline`,
  );
  checkPattern(
    videoPlaybackBackpressure,
    /DEFAULT_PENDING_HYSTERESIS_MS\s*=\s*20[\s\S]*function\s+sustainPending\([^)]*\)[\s\S]*cancelScheduledFrame\(\)[\s\S]*owner\.media\.pause\(\)[\s\S]*pending-promoted[\s\S]*promoted-held[\s\S]*pending-settled[\s\S]*releaseAndResume\(\s*["']pending-settled["']\s*\)/,
    `${files.videoPlaybackBackpressure}: sustained pending must pause once and resume only after promoted settlement`,
  );

  const bodyPump = sourceBetween(
    app,
    "function getLatestFramePump()",
    "function advanceDetectionGeneration(",
  );
  const applyFenceIndex = bodyPump.indexOf("rejectPostInferenceStaleBodyFrame");
  const handTransferIndex = bodyPump.indexOf("result.handFrameSource");
  const outputApplyIndex = bodyPump.indexOf("applyDetectionFrameResult");
  check(
    applyFenceIndex >= 0 &&
      handTransferIndex > applyFenceIndex &&
      outputApplyIndex > handTransferIndex,
    "src/app.js: post-inference deadline fence must precede Hand transfer and all avatar/record/output application",
  );
  checkPattern(
    app,
    /function\s+rejectPostInferenceStaleBodyFrame\([^)]*\)[\s\S]*boundaryNominated[\s\S]*pendingDeadlineMonotonicMs[\s\S]*postInferenceStaleDrops\s*\+=\s*1[\s\S]*bodyPostInferenceStaleReason/,
    "src/app.js: ordinary stale Body results must be rejected with reportable source provenance while boundaries remain excluded",
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectFingerAimLimitDegrees(source, groupName) {
  const match = new RegExp(`${groupName}\\s*:\\s*Object\\.freeze\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)`).exec(source);

  if (!match) {
    return [];
  }

  return [...match[1].matchAll(/\{\s*maxAngleDeg\s*:\s*([0-9.]+)\s*,\s*maxTwistDeg\s*:\s*([0-9.]+)\s*\}/g)]
    .map(([, maxAngleDeg, maxTwistDeg]) => ({
      maxAngleDeg: Number(maxAngleDeg),
      maxTwistDeg: Number(maxTwistDeg),
    }));
}

function checkFingerAimLimitContract(avatarRenderer) {
  const thumbLimits = collectFingerAimLimitDegrees(avatarRenderer, "Thumb");
  const defaultLimits = collectFingerAimLimitDegrees(avatarRenderer, "Default");

  check(thumbLimits.length >= 3, `${files.avatarRenderer}: expected thumb finger aim limits for all driven thumb segments`);
  check(defaultLimits.length >= 3, `${files.avatarRenderer}: expected default finger aim limits for all driven finger segments`);
  checkPattern(
    avatarRenderer,
    /function\s+getFingerAimConstraint\s*\([^)]*\)[\s\S]*FINGER_AIM_CONSTRAINTS_DEG[\s\S]*THREE\.MathUtils\.degToRad\s*\(\s*constraint\.maxAngleDeg\s*\)[\s\S]*THREE\.MathUtils\.degToRad\s*\(\s*constraint\.maxTwistDeg\s*\)/,
    `${files.avatarRenderer}: expected finger aim constraints to use shared degree limits`,
  );

  const minimums = [
    [thumbLimits, 0, "thumb base", 110, 60],
    [thumbLimits, 1, "thumb middle", 95, 34],
    [thumbLimits, 2, "thumb distal", 95, 30],
    [defaultLimits, 0, "finger base", 110, 34],
    [defaultLimits, 1, "finger middle", 110, 26],
    [defaultLimits, 2, "finger distal", 95, 22],
  ];

  for (const [limits, index, label, minAngleDeg, minTwistDeg] of minimums) {
    const limit = limits[index];

    check(
      limit?.maxAngleDeg >= minAngleDeg,
      `${files.avatarRenderer}: ${label} maxAngleDeg must allow clenched-fist curl (expected >= ${minAngleDeg})`,
    );
    check(
      limit?.maxTwistDeg >= minTwistDeg,
      `${files.avatarRenderer}: ${label} maxTwistDeg must preserve fist-side splay (expected >= ${minTwistDeg})`,
    );
  }
}

function hasId(html, id) {
  return new RegExp(`\\bid\\s*=\\s*["']${escapeRegExp(id)}["']`, "i").test(html);
}

function parseJson(relativePath, source) {
  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    failures.push(`${relativePath}: invalid JSON (${error.message})`);
    return null;
  }
}

function parseImportMap(html) {
  const match = html.match(
    /<script\b(?=[^>]*\btype\s*=\s*["']importmap["'])[^>]*>([\s\S]*?)<\/script>/i,
  );

  if (!match) {
    failures.push("index.html: missing import map script");
    return null;
  }

  return parseJson("index.html import map", match[1]);
}

function parseGlbJson(buffer, relativePath) {
  if (!buffer) {
    return null;
  }

  check(buffer.length >= 20, `${relativePath}: expected a non-empty GLB file`);

  if (buffer.length < 20) {
    return null;
  }

  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);

  check(magic === "glTF", `${relativePath}: expected glTF binary magic`);
  check(version === 2, `${relativePath}: expected glTF 2.0 binary`);
  check(
    declaredLength === buffer.length,
    `${relativePath}: GLB declared length ${declaredLength} does not match file size ${buffer.length}`,
  );

  if (magic !== "glTF" || version !== 2) {
    return null;
  }

  let offset = 12;

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("utf8", offset + 4, offset + 8);
    offset += 8;

    if (offset + chunkLength > buffer.length) {
      failures.push(`${relativePath}: GLB chunk ${chunkType} overruns file length`);
      return null;
    }

    if (chunkType === "JSON") {
      const jsonSource = buffer
        .toString("utf8", offset, offset + chunkLength)
        .replace(/\u0000+$/g, "")
        .trim();
      return parseJson(`${relativePath} JSON chunk`, jsonSource);
    }

    offset += chunkLength;
  }

  failures.push(`${relativePath}: missing JSON chunk`);
  return null;
}

function checkSyntax(relativePath) {
  const result = spawnSync(process.execPath, ["--check", path.join(projectRoot, relativePath)], {
    encoding: "utf8",
  });

  check(
    result.status === 0,
    `${relativePath}: node --check failed ${(result.stderr || result.stdout || "").trim()}`,
  );
}

function checkPackageContract(packageJson) {
  check(
    packageJson?.scripts?.check === "node tests/contract-check.mjs && node tests/canonical-skeleton-adapter-check.mjs && node tests/avatar-vrm-rendering-compat-check.mjs && node tests/avatar-vrm-humanoid-check.mjs && node tests/avatar-vrm-expression-check.mjs && node tests/avatar-applied-state-check.mjs && node tests/latest-frame-pump-check.mjs && node tests/tracking-input-generation-check.mjs && node tests/tracking-cadence-check.mjs && node tests/tracking-runtime-options-check.mjs && node tests/hand-roi-check.mjs && node tests/retarget-orientation-check.mjs && node tests/face-head-pose-check.mjs && node tests/causal-finger-flex-check.mjs && node tests/strict-retarget-check.mjs && node tests/depth-calibration-check.mjs && node tests/motion-frame-check.mjs && node tests/motion-forwarding-check.mjs && node tests/presence-state-check.mjs && node tests/facing-estimator-check.mjs && node tests/solver-synthetic-check.mjs && node tests/sam-manual-labels-check.mjs && node tests/motion-recording-compare-check.mjs && node tests/retarget-mode-compare-check.mjs && node tests/mhr70-mapping-check.mjs && node tests/mhr70-hands-check.mjs && node tests/gesture-classifier-check.mjs && node tests/sam-reference-labeler-check.mjs && node tests/sam-calibration-profile-check.mjs && node tests/sam-regression-oracle-check.mjs && node tests/hmr-jsonl-adapter-check.mjs && node tests/clip-manifest-check.mjs",
    "package.json: check script must run the contract, rendering, applied-state, latest-frame pump, tracker generation, tracking cadence, retarget, solver, recording, and SAM regression checks",
  );
  check(
    packageJson?.scripts?.start === "python3 -m http.server 8000 --bind 127.0.0.1",
    "package.json: start script must remain the local static server",
  );
  check(
    packageJson?.scripts?.["perf:avatar"] === "node scripts/avatar-performance-check.mjs",
    "package.json: perf:avatar script must run the avatar performance check",
  );
  check(
    packageJson?.scripts?.["perf:pump"] === "node scripts/frame-pump-performance-check.mjs",
    "package.json: perf:pump script must run the frame pump performance check",
  );
  check(
    packageJson?.scripts?.["motion:avatar"] === "node scripts/avatar-motion-agreement-check.mjs",
    "package.json: motion:avatar script must run the browser motion agreement check",
  );
  check(
    packageJson?.scripts?.["validate:all"] === "node scripts/validation-cli.mjs --suite all",
    "package.json: validate:all script must run the consolidated validation CLI",
  );
  check(
    packageJson?.scripts?.["hmr:jsonl"] === "node scripts/hmr-jsonl-adapter.mjs",
    "package.json: hmr:jsonl script must run the external HMR JSONL adapter",
  );
  check(
    packageJson?.scripts?.["compare:recordings"] === "node scripts/motion-recording-compare.mjs",
    "package.json: compare:recordings script must run the live/offline recording comparison CLI",
  );
  check(
    packageJson?.scripts?.["compare:retarget"] === "node scripts/retarget-mode-compare.mjs",
    "package.json: compare:retarget script must run the retarget mode report comparison CLI",
  );
  check(
    packageJson?.scripts?.["sam:labels"] === "node scripts/sam-reference-labeler.mjs",
    "package.json: sam:labels script must run the SAM reference labeler",
  );
  check(
    packageJson?.scripts?.["sam:manual"] === "node scripts/sam-manual-labels.mjs",
    "package.json: sam:manual script must run the manual label compiler",
  );
  check(
    packageJson?.scripts?.["sam:profile"] === "node scripts/sam-calibration-profile.mjs",
    "package.json: sam:profile script must run the SAM calibration profile generator",
  );
  check(
    packageJson?.scripts?.["sam:oracle"] === "node scripts/sam-regression-oracle.mjs",
    "package.json: sam:oracle script must run the SAM regression oracle",
  );
  check(
    packageJson?.scripts?.["sam:oracle:csi"] === "node scripts/sam-regression-oracle.mjs --profile tests/fixtures/sam-oracle-profiles/csi-pose.json --report output/reports/tracker-vs-sam-csi-pose-strict-direct-v4.json --output output/reports/tracker-vs-sam-csi-pose-strict-direct-v4-oracle.json",
    "package.json: sam:oracle:csi script must run the csi-pose SAM oracle profile",
  );
  check(
    packageJson?.scripts?.["smoke:hud"] === "node scripts/motion-status-hud-smoke.mjs",
    "package.json: smoke:hud script must run the browser Motion State HUD smoke check",
  );
  check(
    packageJson?.scripts?.["smoke:hud:gpu"] === "node scripts/motion-status-hud-smoke.mjs --delegate gpu --output output/reports/motion-status-hud-smoke-gpu-latest.json --screenshot output/reports/motion-status-hud-smoke-gpu-latest.png",
    "package.json: smoke:hud:gpu script must run the browser Motion State HUD smoke check with GPU requested",
  );
  check(
    packageJson?.scripts?.["smoke:head"] === "node scripts/head-pose-smoke.mjs",
    "package.json: smoke:head script must run the browser head pose smoke check",
  );
  check(
    packageJson?.scripts?.["smoke:root-yaw"] === "node scripts/root-yaw-recovery-smoke.mjs",
    "package.json: smoke:root-yaw script must run the browser root yaw recovery smoke check",
  );
  check(
    packageJson?.scripts?.["goal:audit"] === "node scripts/motion-goal-audit.mjs",
    "package.json: goal:audit script must run the motion goal audit",
  );

  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencyNames = Object.keys(packageJson?.[field] ?? {});
    check(
      dependencyNames.length === 0,
      `package.json: expected dependency-free package, found ${field}: ${dependencyNames.join(", ")}`,
    );
  }
}

function checkReadmeContract(readme) {
  const readmeChecks = [
    ["local Xbot model", /\bassets\/models\/Xbot\.glb\b|\bXbot\.glb\b[\s\S]*\blocal\b/i],
    ["three.js source attribution", /three\.js[\s\S]*examples\/models\/gltf\/Xbot\.glb/i],
    ["MIT license attribution", /\bMIT\b[\s\S]*three\.js|three\.js[\s\S]*\bMIT\b/i],
    ["side-by-side avatar viewport", /side-by-side[\s\S]*3D avatar viewport/i],
    ["browser WebGL requirement", /\bWebGL\b/i],
    ["camera requirement", /camera[\s\S]*(permission|access)/i],
    ["video-file testing", /video-file testing|uploaded test video|Test video/i],
    ["body validation debug report", /motionTrackerDebug\.getBodyValidationReport|Body Validation/i],
    ["avatar skeleton toggle", /Avatar skeleton/i],
    ["visual skeleton match documentation", /Visual skeleton match[\s\S]*projected/i],
    ["strict validation documentation", /Strict validation[\s\S]*95%/i],
    ["depth validation documentation", /Depth validation[\s\S]*depth-scale/i],
    ["SAM regression oracle documentation", /SAM Regression Oracle[\s\S]*sam:oracle/i],
    ["avatar orbit inspection documentation", /orbit inspection[\s\S]*Reset/i],
    ["approximate retargeting limitation", /approximate[\s\S]*retarget/i],
    ["not production mocap", /not[\s\S]*production[\s\S]*(motion-capture|mocap)[\s\S]*solver/i],
  ];

  for (const [label, pattern] of readmeChecks) {
    checkPattern(readme, pattern, `README.md: missing avatar documentation - ${label}`);
  }
}

function checkHtmlContract(html) {
  for (const id of [...requiredTrackerDomIds, ...requiredAvatarDomIds]) {
    check(hasId(html, id), `index.html: missing required DOM id #${id}`);
  }

  const mirrorToggleInput = html.match(/<input\b(?=[^>]*\bid\s*=\s*["']mirror-toggle["'])[^>]*>/i)?.[0] ?? "";
  check(
    mirrorToggleInput && !/\bchecked\b/i.test(mirrorToggleInput),
    "index.html: mirror input toggle should default to unchecked",
  );

  checkPattern(
    html,
    /<script\b(?=[^>]*\btype\s*=\s*["']module["'])(?=[^>]*\bsrc\s*=\s*["']\.\/src\/app\.js(?:\?[^"']+)?["'])[^>]*>\s*<\/script>/i,
    "index.html: missing module script tag for ./src/app.js",
  );

  const importMap = parseImportMap(html);
  check(
    importMap?.imports?.three ===
      `https://cdn.jsdelivr.net/npm/three@${threeVersion}/build/three.module.js`,
    "index.html: import map must pin three to the expected CDN module URL",
  );
  check(
    importMap?.imports?.["three/addons/"] ===
      `https://cdn.jsdelivr.net/npm/three@${threeVersion}/examples/jsm/`,
    "index.html: import map must pin three/addons/ to the expected CDN URL",
  );
  check(
    importMap?.imports?.["@pixiv/three-vrm"] ===
      `https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@${threeVrmVersion}/lib/three-vrm.module.js`,
    "index.html: import map must pin @pixiv/three-vrm to the expected CDN module URL",
  );
}

function checkClaudeCodexBridge(settingsJson, commandSource, scriptSource, readmeSource) {
  const settings = parseJson(files.claudeSettings, settingsJson);

  check(
    settings?.permissions?.defaultMode === "auto",
    `${files.claudeSettings}: expected permissions.defaultMode to be auto`,
  );
  checkPattern(
    commandSource,
    /description:\s*Ask Codex CLI for a second engineering opinion/,
    `${files.claudeCodexCommand}: expected Claude command description`,
  );
  checkPattern(
    commandSource,
    /3600000/,
    `${files.claudeCodexCommand}: expected long Bash timeout guidance`,
  );
  checkPattern(
    commandSource,
    /Do not add budget, token, or reasoning caps/,
    `${files.claudeCodexCommand}: expected no-budget-cap instruction`,
  );
  checkPattern(
    scriptSource,
    /DEFAULT_CODEX_MODEL="gpt-5\.5"/,
    `${files.claudeCodexScript}: expected default latest model`,
  );
  checkPattern(
    scriptSource,
    /DEFAULT_CODEX_REASONING_EFFORT="xhigh"/,
    `${files.claudeCodexScript}: expected xhigh default reasoning effort`,
  );
  checkPattern(
    scriptSource,
    /DEFAULT_CODEX_APPROVAL_POLICY="on-request"/,
    `${files.claudeCodexScript}: expected automatic approval judgment policy`,
  );
  checkPattern(
    scriptSource,
    /DEFAULT_CODEX_SANDBOX="workspace-write"/,
    `${files.claudeCodexScript}: expected workspace-write sandbox default`,
  );
  checkPattern(
    scriptSource,
    /--full-auto/,
    `${files.claudeCodexScript}: expected full-auto Codex invocation`,
  );
  checkPattern(
    scriptSource,
    /The wrapper intentionally does not set token, budget, or reasoning caps/,
    `${files.claudeCodexScript}: expected no budget cap usage text`,
  );
  checkPattern(
    readmeSource,
    /Claude Code Codex Consultation/,
    `${files.readme}: expected Claude Code Codex consultation docs`,
  );
}

function checkTrackerAppContract(app) {
  const requiredAssetUrls = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediaPipeVersion}/vision_bundle.mjs`,
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediaPipeVersion}/wasm`,
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task",
  ];

  for (const url of requiredAssetUrls) {
    check(app.includes(url), `src/app.js: missing required MediaPipe asset URL ${url}`);
  }

  const mainThreadDetectorFactories = sourceBetween(
    app,
    "function createMainThreadDetectorFactories(",
    "async function createMainThreadDetectorSet(",
  );
  check(
    /const\s+MEDIAPIPE_BODY_RUNNING_MODE\s*=\s*["']VIDEO["']/.test(app) &&
      /const\s+MEDIAPIPE_FACE_RUNNING_MODE\s*=\s*["']IMAGE["']/.test(app) &&
      /id:\s*["']pose["'][\s\S]*runningMode:\s*MEDIAPIPE_BODY_RUNNING_MODE[\s\S]*id:\s*["']face["'][\s\S]*runningMode:\s*MEDIAPIPE_FACE_RUNNING_MODE/.test(
        mainThreadDetectorFactories,
      ),
    "src/app.js: expected stateful VIDEO Body and unchanged IMAGE Face running modes",
  );
  const startCameraSource = sourceBetween(app, "async function startCamera(", "async function startVideoFile(");
  const startVideoFileSource = sourceBetween(app, "async function startVideoFile(", "function stopCamera(");
  const offerFrameSource = sourceBetween(
    app,
    "function offerFrameForDetection(",
    "function shouldCaptureHandSnapshot(",
  );

  const staleCheckIndex = offerFrameSource.indexOf("shouldSkipStaleVideoFrameCallback");
  const duplicateCheckIndex = offerFrameSource.indexOf("state.detectionPump.duplicateFrames");
  const admissionIndex = offerFrameSource.indexOf("decideSourcePtsAdmission");
  const bodySnapshotIndex = offerFrameSource.indexOf("captureDetectionFrameSnapshot");
  const latestFrameOfferIndex = offerFrameSource.indexOf("getLatestFramePump().offer");
  check(
    staleCheckIndex >= 0 &&
      duplicateCheckIndex > staleCheckIndex &&
      admissionIndex > duplicateCheckIndex &&
      bodySnapshotIndex > admissionIndex &&
      latestFrameOfferIndex > bodySnapshotIndex,
    "src/app.js: exact source-PTS admission must follow stale/duplicate checks and precede snapshots and pump offer",
  );

  const lifecycleChecks = [
    ["defines startCamera", /async\s+function\s+startCamera\s*\(/],
    ["defines startVideoFile", /async\s+function\s+startVideoFile\s*\(/],
    ["defines stopCamera", /function\s+stopCamera\s*\(/],
    [
      "start button starts the camera",
      /startButton\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?startCamera\s*\(/,
    ],
    [
      "stop button stops the camera",
      /stopButton\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?stopCamera\s*\(/,
    ],
    [
      "video file input starts file tracking",
      /videoFileInput\?\.\s*addEventListener\(\s*["']change["'][\s\S]*?startVideoFile\s*\(/,
    ],
    [
      "video file input can reselect the same file",
      /videoFileInput\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?videoFileInput\.value\s*=\s*["']["']/,
    ],
    ["requests camera stream", /navigator\.mediaDevices\?\.\s*getUserMedia/],
    ["assigns camera stream to video", /video\.srcObject\s*=\s*stream/],
    ["creates a local video file URL", /URL\.createObjectURL\s*\(\s*file\s*\)/],
    ["assigns video file URL to video", /video\.src\s*=\s*objectUrl/],
    ["defines mirror preference helper", /function\s+setMirrorPreference\s*\(\s*mirrored\s*\)/],
    ["allows video file replacement while active", /videoFileInput\.disabled\s*=\s*missingRequiredDom\s*\|\|\s*state\.starting/],
    ["enables video controls for file replay", /video\.controls\s*=\s*true/],
    ["loops video files for repeatable checks", /video\.loop\s*=\s*true/],
    ["revokes video file URL", /URL\.revokeObjectURL\s*\(\s*state\.videoFileUrl\s*\)/],
    ["starts video playback", /video\.play\s*\(\s*\)/],
    ["supports requestVideoFrameCallback latest-frame producer", /requestVideoFrameCallback\s*\(\s*\([^)]*timestamp[\s\S]*offerVideoFrameForDetection/],
    ["reports active frame cadence independently of report-read delay", /function\s+getAppPerformanceReport\s*\([^)]*\)[\s\S]*activeFrameRateFromIntervals\s*\([\s\S]*fps:\s*\{[\s\S]*callback:\s*callbackRate[\s\S]*detection:\s*detectionRate/],
    ["feeds requestAnimationFrame through the bounded snapshot producer when supported", /requestAnimationFrame\s*\(\s*\([^)]*timestamp[\s\S]*offerAnimationFrameForDetection/],
    ["parses detection pump flag", /function\s+getInitialDetectionPumpMode\s*\([^)]*\)[\s\S]*URLSearchParams[\s\S]*["']pump["']/],
    ["defaults tracking worker on unless explicitly disabled", /function\s+getInitialTrackingWorkerEnabled\s*\([^)]*\)[\s\S]*isWorkerRuntimeEnabled\([^,]+,\s*["']tracking-worker["']\)/],
    ["defaults independent hand worker on unless explicitly disabled", /function\s+getInitialHandWorkerEnabled\s*\([^)]*\)[\s\S]*isWorkerRuntimeEnabled\([^,]+,\s*["']hand-worker["']\)/],
    ["parses avatar smoothing flag", /function\s+getInitialAvatarSmoothingMode\s*\([^)]*\)[\s\S]*URLSearchParams[\s\S]*["']smoothing["']/],
    ["defaults avatar smoothing to retarget", /function\s+getInitialAvatarSmoothingMode\s*\([^)]*\)[\s\S]*value\s*\?\?\s*AVATAR_SMOOTHING_MODE_RETARGET[\s\S]*AVATAR_SMOOTHING_MODE_ALIASES\[normalized\]\s*\?\?\s*AVATAR_SMOOTHING_MODE_RETARGET/],
    ["parses avatar retarget mode flag", /function\s+getInitialAvatarRetargetMode\s*\([^)]*\)[\s\S]*["']avatar-retarget["'][\s\S]*["']retarget-mode["']/],
    ["defaults avatar retarget mode to strict", /function\s+normalizeAvatarRetargetMode\s*\([^)]*\)[\s\S]*value\s*\?\?\s*AVATAR_RETARGET_MODE_STRICT/],
    ["defaults face tracking on unless explicitly disabled", /function\s+getInitialFaceTrackingEnabled\s*\([^)]*\)\s*\{[\s\S]*!isFalsyQueryFlag\(["']face-tracking["']\)[\s\S]*getInitialFaceLandmarksEnabled\(\s*\)/],
    ["parses face landmark opt-in flag", /function\s+getInitialFaceLandmarksEnabled\s*\([^)]*\)[\s\S]*["']face-landmarks["']/],
    ["parses explicit face tracking off flag", /function\s+isFalsyQueryFlag\s*\([^)]*\)[\s\S]*["']off["'][\s\S]*["']none["']/],
    ["wires face tracking toggle", /faceTrackingToggle\?\.\s*addEventListener\(\s*["']change["'][\s\S]*?setFaceTrackingEnabled/],
    ["creates module tracking worker from local file", /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*["']\.\/motion-worker\.js(?:\?[^"']+)?["']\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*["']module["']\s*\}/],
    ["falls back to main-thread detection after worker failure", /trackingWorker[\s\S]*fallbackReason[\s\S]*detectMotionFrameOnMainThread/],
    ["loads main-thread pose lazily only when the worker is unavailable", /const\s+workerReady\s*=\s*await\s+ensureTrackingWorkerReady\([^)]*\)[\s\S]*if\s*\(\s*!workerReady\s*\)\s*\{[\s\S]*ensureMainThreadModelsReady/],
    ["ensures lazy main-thread models before fallback detection", /async\s+function\s+detectMotionFrameOnMainThread\([^)]*\)\s*\{[\s\S]*await\s+ensureMainThreadModelsReady/],
    ["does not treat an explicitly disabled tracking worker as ready", /function\s+isTrackingWorkerReadyFor\([^)]*\)\s*\{\s*if\s*\(\s*!state\.trackingWorker\.requested\s*\)\s*\{\s*return\s+false/],
    ["configures hand worker independently from body worker", /function\s+configureHandWorkerRuntime\([^)]*\)\s*\{\s*const\s+requested\s*=\s*getInitialHandWorkerEnabled\(\)/],
    ["owns one lifecycle and pending map per hand side", /handWorker:\s*\{[\s\S]*sides:\s*Object\.fromEntries\([\s\S]*createHandWorkerSideRuntime\(side\)[\s\S]*function\s+createHandWorkerSideRuntime\([^)]*\)[\s\S]*pendingRequests:\s*new\s+Map\(\)/],
    ["creates a dedicated module worker for each hand side", /function\s+getOrCreateHandWorker\(side\)[\s\S]*new\s+Worker\s*\([\s\S]*hand-worker\.js\?v=[^"']+[\s\S]*handleHandWorkerMessage\(side,\s*event\)/],
    ["uses separate capacity-one fan-out and side pumps", /function\s+getHandFrameFanOutPump\([^)]*\)[\s\S]*createLatestFramePump\([\s\S]*function\s+getHandSideFramePump\(side\)[\s\S]*createLatestFramePump\(/],
    ["clones the frozen hand frame before independent side offers", /function\s+fanOutHandFrameEnvelope\([^)]*\)[\s\S]*await\s+createImageBitmap\(envelope\.imageBitmap\)[\s\S]*offerHandSideEnvelope/],
    ["posts one requested side per hand detect", /postHandWorkerRequest\(side,\s*["']detect["'][\s\S]*requestedSide:\s*side/],
    ["validates response and frame side provenance", /result\.handWorkerSide\s*!==\s*side[\s\S]*frame\.sourceMeta\?\.handWorkerSide\s*!==\s*side/],
    ["merges each side result without an opposite-side barrier", /mergeHandObservationCache\([^)]*,\s*\{[\s\S]*attemptedSides:\s*\[side\]/],
    ["advances body fan-out and both side generations together", /function\s+advanceDetectionGeneration\(reason,\s*options\s*=\s*\{\}\)[\s\S]*getLatestFramePump\(\)\.advanceGeneration\(reason\)[\s\S]*getHandFrameFanOutPump\(\)\.advanceGeneration\(reason\)[\s\S]*getHandSideFramePump\(side\)\.advanceGeneration\(reason\)/],
    ["resets source-PTS admission at generation boundaries", /function\s+advanceDetectionGeneration\(reason,\s*options\s*=\s*\{\}\)[\s\S]*lastAdmittedSourcePtsSec\s*=\s*null[\s\S]*lastBodyCadenceAdmissionReason\s*=\s*["']["']/],
    ["resets source-PTS admission and cadence telemetry for a performance session", /function\s+resetAppPerformance\([^)]*\)[\s\S]*lastAdmittedSourcePtsSec\s*=\s*null[\s\S]*bodyCadenceSkips\s*=\s*0/],
    ["reports intentional body cadence separately from overload and stale drops", /function\s+getAppPerformanceReport\([^)]*\)[\s\S]*bodyCadenceSkips:[\s\S]*overloadDrops:[\s\S]*staleQueuedDrops:/],
    ["records body cadence, overload, and stale provenance in source metadata", /function\s+getCurrentMotionSourceMeta\([^)]*\)[\s\S]*bodyCadenceAdmissionReason:[\s\S]*bodyCadenceSkips:[\s\S]*bodyOverloadDrops:[\s\S]*bodyStaleCallbackDrops:/],
    ["keeps optional face failure from blocking main-thread pose readiness", /function\s+isMainThreadTrackingReadyFor\([^)]*\)[\s\S]*state\.faceTracking\.status\s*===\s*["']failed["']/],
    ["loads fallback pose before dropping a transferred failed frame", /isFrozenDetectionFrameSource\(frameSource\)[\s\S]*await\s+ensureMainThreadModelsReady[\s\S]*workerFallbackFrameDrops/],
    ["cancels detection frames", /cancelAnimationFrame\s*\(\s*state\.animationFrameId\s*\)/],
    ["cancels video frame requests", /cancelVideoFrameCallback\s*\(\s*state\.videoFrameRequestId\s*\)/],
    ["stops media tracks", /track\.stop\s*\(\s*\)/],
    ["pauses video on stop", /video\.pause\s*\(\s*\)/],
    ["clears video stream on stop", /video\.srcObject\s*=\s*null/],
    ["stops on beforeunload", /window\.addEventListener\(\s*["']beforeunload["'][\s\S]*?stopCamera\s*\(/],
    ["stops on pagehide", /window\.addEventListener\(\s*["']pagehide["'][\s\S]*?stopCamera\s*\(/],
  ];

  for (const [label, pattern] of lifecycleChecks) {
    checkPattern(app, pattern, `src/app.js: camera lifecycle contract missing - ${label}`);
  }
  checkPattern(
    startCameraSource,
    /setMirrorPreference\s*\(\s*false\s*\)[\s\S]*?applyMirrorPreference\s*\(\s*\)/,
    "src/app.js: camera lifecycle contract missing - uses unmirrored preview for camera input",
  );
  checkPattern(
    startVideoFileSource,
    /setMirrorPreference\s*\(\s*false\s*\)[\s\S]*?applyMirrorPreference\s*\(\s*\)/,
    "src/app.js: camera lifecycle contract missing - uses unmirrored replay for video file input",
  );

  const drawingChecks = [
    ["pose connection array", /const\s+POSE_CONNECTIONS\s*=\s*\[/],
    ["hand connection array", /const\s+HAND_CONNECTIONS\s*=\s*\[/],
    ["drawConnections function", /function\s+drawConnections\s*\(/],
    ["pose drawConnections call", /drawConnections\s*\(\s*bodyLandmarks\s*,\s*POSE_CONNECTIONS/],
    ["hand drawConnections call", /drawConnections\s*\(\s*landmarks\s*,\s*HAND_CONNECTIONS/],
    ["canvas line drawing", /context\.moveTo\s*\([\s\S]*?context\.lineTo\s*\([\s\S]*?context\.stroke\s*\(/],
  ];

  for (const [label, pattern] of drawingChecks) {
    checkPattern(app, pattern, `src/app.js: drawing connection contract missing - ${label}`);
  }
}

function checkAvatarAppContract(app) {
  for (const id of requiredAvatarDomIds) {
    check(app.includes(`"${id}"`) || app.includes(`'${id}'`), `src/app.js: missing avatar element id ${id}`);
  }

  const avatarChecks = [
    [
      "imports avatar renderer factory",
      /import\s*\{\s*createAvatarRenderer\s*\}\s*from\s*["']\.\/avatar-renderer\.js(?:\?[^"']+)?["']/,
    ],
    ["defines local avatar model URL", /const\s+AVATAR_MODEL_URL\s*=\s*["']\.\/assets\/models\/Xbot\.glb["']/],
    ["tracks avatar renderer state", /avatarRenderer\s*:\s*null/],
    ["tracks avatar init promise", /avatarInitPromise\s*:\s*null/],
    [
      "keeps avatar required IDs separate",
      /const\s+AVATAR_ELEMENT_KEYS\s*=\s*\[[\s\S]*["']avatarCanvas["'][\s\S]*["']avatarStatus["'][\s\S]*["']avatarBoneCount["'][\s\S]*["']avatarFaceStatus["'][\s\S]*["']avatarExpressionStatus["'][\s\S]*\]/,
    ],
    ["initializes avatar during boot", /function\s+boot\s*\(\s*\)[\s\S]*?initAvatarRenderer\s*\(\s*\)/],
    [
      "passes canvas status bone count and selected model URL",
      /const\s+modelUrl\s*=\s*getSelectedAvatarModelUrl\s*\(\s*\)[\s\S]*?createAvatarRenderer\s*\(\s*\{[\s\S]*?canvas\s*:\s*state\.elements\.avatarCanvas[\s\S]*?statusElement\s*:\s*state\.elements\.avatarStatus[\s\S]*?boneCountElement\s*:\s*state\.elements\.avatarBoneCount[\s\S]*?modelUrl\s*,[\s\S]*?\}\s*\)/,
    ],
    ["passes avatar smoothing mode", /createAvatarRenderer\s*\(\s*\{[\s\S]*smoothingMode\s*:\s*state\.avatarSmoothingMode/],
    ["tracks uploaded avatar object URL", /avatarFileUrl\s*:\s*["']["'][\s\S]*avatarFileName\s*:\s*["']["']/],
    ["wires avatar file input", /avatarFileInput\?\.\s*addEventListener\(\s*["']change["'][\s\S]*?useAvatarModelFile\s*\(/],
    ["wires default avatar button", /avatarDefaultButton\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?useDefaultAvatarModel\s*\(/],
    ["creates uploaded avatar object URL", /function\s+useAvatarModelFile\s*\([^)]*\)[\s\S]*URL\.createObjectURL\s*\(\s*file\s*\)/],
    ["revokes uploaded avatar object URL", /function\s+releaseAvatarFileUrl\s*\([^)]*\)[\s\S]*URL\.revokeObjectURL\s*\(\s*state\.avatarFileUrl\s*\)/],
    ["falls back to default avatar model", /function\s+getSelectedAvatarModelUrl\s*\([^)]*\)[\s\S]*state\.avatarFileUrl\s*\|\|\s*AVATAR_MODEL_URL/],
    ["catches avatar init failure", /state\.avatarRenderer\s*\.\s*init\s*\(\s*\)[\s\S]*?\.catch\s*\(/],
    [
      "updates avatar from detection frame",
      /runDetectionFrame\s*\(\s*timestamp[\s\S]*?\)[\s\S]*?const\s+motionFrame\s*=\s*createMotionFrame\s*\([\s\S]*?processMotionFrame\s*\(\s*motionFrame/,
    ],
    [
      "passes normalized motion frame to avatar update",
      /state\.avatarRenderer\.update\s*\(\s*\{[\s\S]*?motionFrame[\s\S]*?mirrored\s*:\s*motionFrame\.mirrored[\s\S]*?timestamp\s*:\s*motionFrame\.timestamp[\s\S]*?\}\s*\)/,
    ],
    ["syncs avatar skeleton debug option", /function\s+syncAvatarDebugOptions\s*\(\s*\)[\s\S]*?setSkeletonVisible/],
    ["records body validation after avatar update", /function\s+processMotionFrame\s*\([^)]*\)[\s\S]*?const\s+processedFrame\s*=\s*\{[\s\S]*?updateAvatarRendererFromMotionFrame\s*\(\s*processedFrame\s*\)[\s\S]*?recordBodyValidation\s*\(\s*processedFrame\s*\)/],
    ["wires avatar view reset button", /avatarViewReset[\s\S]*?addEventListener\(\s*["']click["'][\s\S]*?resetView/],
    ["wires motion status calibration button", /motionStatusCalibrateButton\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?resetDepthCalibrationFromUi\s*\(\s*\)/],
    ["owns an exact frozen avatar boundary after video seek", /video\?\.\s*addEventListener\(\s*["']seeked["']\s*,\s*handleVideoBoundarySeeked\s*\)[\s\S]*function\s+handleVideoBoundarySeeked\(\)[\s\S]*nominateVideoGenerationBoundary\(\s*["']seek["']\s*\)/],
    ["detects video timeline rewind before duplicate frame skip", /const\s+videoTime\s*=\s*optionalFiniteNumber\(sourceTiming\.sourcePtsSec\)[\s\S]*?video\.currentTime[\s\S]*?shouldResetVideoTimeline\(videoTime\)[\s\S]*?resetVideoTimelineState\(\s*["']rewind["']\s*\)[\s\S]*?videoTime\s*===\s*state\.lastVideoTime/],
    ["resets avatar pose while preserving calibration for timeline discontinuities", /function\s+resetVideoTimelineState\s*\([^)]*\)[\s\S]*?lastTimelineResetReason\s*=\s*reason[\s\S]*?state\.lastVideoTime\s*=\s*-1[\s\S]*?resetPresenceTracking\(\s*\)[\s\S]*?resetAvatarPose\(\s*\{[\s\S]*?preserveCalibration\s*:\s*true/],
    ["reports body match rate against fixed threshold", /const\s+BODY_MATCH_THRESHOLD_DEG\s*=\s*30[\s\S]*matchRate/],
    ["records projected visual body validation", /getProjectedBodyPoseSnapshot[\s\S]*visualJoints/],
    ["records projected segment agreement", /projectedSegmentOverall[\s\S]*projectionByGroup/],
    ["defines strict validation thresholds", /const\s+BODY_STRICT_JOINT_THRESHOLD\s*=[\s\S]*BODY_STRICT_MIN_SEGMENT_LENGTH[\s\S]*BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG[\s\S]*BODY_STRICT_TEMPORAL_ERROR_THRESHOLD/],
    ["builds strict validation report", /function\s+buildStrictValidationReport\s*\([^)]*\)[\s\S]*strictValidation|strictValidation\s*=\s*buildStrictValidationReport\s*\(/],
    ["builds depth validation report", /function\s+buildDepthValidationReport\s*\([^)]*\)[\s\S]*mediapipe_relative_depth/],
    ["includes depth length consistency in depth validation", /function\s+buildDepthValidationReport\s*\([^)]*\)[\s\S]*lengthConsistency\s*:\s*summarizeLengthConsistency/],
    ["builds depth calibration report", /function\s+buildDepthCalibrationReport\s*\([^)]*\)[\s\S]*dynamic_depth_solver_segment_length_consistency/],
    ["marks depth validation self-reference", /selfReferential[\s\S]*retarget residual/],
    ["exposes avatar depth scale debug API", /getAvatarDepthScale[\s\S]*setAvatarDepthScale/],
    ["exposes dynamic depth calibration debug API", /getDepthCalibrationReport[\s\S]*setDepthCalibrationMode/],
    ["exposes avatar performance debug API", /getAvatarPerformanceReport[\s\S]*clearAvatarPerformanceSamples/],
    ["exposes app performance debug API", /getAppPerformanceReport[\s\S]*clearAppPerformanceSamples[\s\S]*getDetectionPumpStatus/],
    ["exposes VRM runtime report debug API", /getVrmRuntimeReport/],
    ["exposes VRM spring-bone toggle debug API", /setVrmSpringBoneEnabled/],
    ["reports detector delegate fallback telemetry", /detectorDelegates[\s\S]*fallbackReasons[\s\S]*recordDetectorDelegateAttempt/],
    ["exposes motion status HUD debug API", /getMotionStatusHudSnapshot/],
    ["updates motion status HUD from detection metrics", /function\s+updateDetectionMetrics\s*\([^)]*\)[\s\S]*maybeUpdateMotionStatusHud\s*\(\s*\)/],
    ["reports depth calibration readiness in HUD", /motionStatusCalibration[\s\S]*resolveDepthCalibrationLabel[\s\S]*resolveDepthCalibrationGuideLabel/],
    ["uses calibration pose quality in HUD guide", /function\s+resolveDepthCalibrationGuideLabel\s*\([^)]*\)[\s\S]*poseQuality[\s\S]*resolveCalibrationPoseQualityGuide/],
    ["derives motion status quality from solver state", /function\s+resolveMotionQuality\s*\([^)]*\)[\s\S]*hinge-fail[\s\S]*low-confidence/],
    ["reports stale rVFC callback drops", /staleFrameCallbacks[\s\S]*frameCallbackLag/],
    ["exposes tracking worker debug API", /getTrackingWorkerStatus/],
    ["exposes debug overlay toggle", /setDebugOverlayEnabled[\s\S]*getDebugOverlayEnabled/],
    ["exposes tracked channel report debug API", /getTrackedChannelReport[\s\S]*faceLandmarkCount[\s\S]*worldLandmarkCount/],
    ["reports expression coverage groups", /expressionCoverageGroups[\s\S]*buildExpressionCoverageGroups/],
    ["exposes avatar view debug API", /getAvatarViewState[\s\S]*resetAvatarView/],
    ["checks strict segment agreement", /function\s+buildStrictSegmentRows\s*\([^)]*\)[\s\S]*angleErrorDeg[\s\S]*lengthErrorRatio/],
    ["checks strict side-order agreement", /function\s+buildStrictSideOrderRows\s*\([^)]*\)[\s\S]*sourceDelta[\s\S]*avatarDelta/],
    ["checks strict temporal agreement", /function\s+buildStrictTemporalRows\s*\([^)]*\)[\s\S]*sourceMotion[\s\S]*motionRatio/],
    ["exposes motion tracker debug API", /globalThis\.motionTrackerDebug\s*=\s*\{[\s\S]*?getBodyValidationReport[\s\S]*?getBodyValidationProgress[\s\S]*?processValidationMotionFrame[\s\S]*?clearBodyValidation/],
    ["exposes constant-time body validation progress", /function\s+getBodyValidationProgress\s*\([^)]*\)\s*\{[\s\S]*?framesWithPose:\s*state\.bodyValidation\.framesWithPose/],
    ["exposes motion recording debug API", /startMotionRecording[\s\S]*stopMotionRecording[\s\S]*getMotionRecording[\s\S]*getMotionRecordingJsonl[\s\S]*getMotionRecordingJsonlChunk[\s\S]*loadMotionRecording[\s\S]*loadMotionRecordingJsonl/],
    ["exposes motion forwarding debug API", /connectMotionForwarding[\s\S]*disconnectMotionForwarding[\s\S]*getMotionForwardingStatus/],
    ["exposes face tracking debug API", /setFaceTrackingEnabled[\s\S]*getFaceTrackingStatus[\s\S]*getFaceTrackingEnabled/],
    ["resets avatar pose on camera stop", /function\s+stopCamera\s*\([^)]*\)[\s\S]*?resetAvatarPose\s*\(\s*\)/],
    ["calls avatar resetPose API", /state\.avatarRenderer\?\.\s*resetPose\s*\(\s*options\s*\)/],
    ["disposes avatar on beforeunload", /window\.addEventListener\(\s*["']beforeunload["'][\s\S]*?disposeAvatarRenderer\s*\(/],
    ["disposes avatar on pagehide", /window\.addEventListener\(\s*["']pagehide["'][\s\S]*?disposeAvatarRenderer\s*\(/],
    ["calls avatar dispose API", /state\.avatarRenderer\?\.\s*dispose\s*\(\s*\)/],
  ];

  for (const [label, pattern] of avatarChecks) {
    checkPattern(app, pattern, `src/app.js: avatar integration contract missing - ${label}`);
  }
}

function checkAvatarRendererContract(avatarRenderer) {
  const rendererChecks = [
    ["imports Three.js bare specifier", /import\s+\*\s+as\s+THREE\s+from\s+["']three["']/],
    [
      "imports GLTFLoader add-on",
      /import\s*\{\s*GLTFLoader\s*\}\s*from\s*["']three\/addons\/loaders\/GLTFLoader\.js["']/,
    ],
    [
      "imports three-vrm runtime helpers",
      /import\s*\{\s*VRMLoaderPlugin\s*,\s*VRMUtils\s*\}\s*from\s*["']@pixiv\/three-vrm["']/,
    ],
    ["registers three-vrm loader plugin", /new\s+VRMLoaderPlugin\s*\(\s*parser\s*\)/],
    ["removes unnecessary VRM vertices", /VRMUtils\.removeUnnecessaryVertices\s*\(/],
    ["combines VRM skeletons", /VRMUtils\.combineSkeletons\s*\(/],
    ["defines local default model URL", /const\s+DEFAULT_MODEL_URL\s*=\s*["']\.\/assets\/models\/Xbot\.glb["']/],
    ["keeps default Xbot model camera-facing without extra yaw", /const\s+DEFAULT_XBOT_MODEL_YAW_RAD\s*=\s*0[\s\S]*function\s+getNonVrmInitialModelYawRad/],
    ["normalizes reversed non-VRM rig sides in model space before caching rest pose", /await\s+discoverBones\s*\(\s*\)[\s\S]*normalizeNonVrmRigFrontAxis\s*\(\s*\)[\s\S]*cacheRestPose\s*\(\s*\)[\s\S]*function\s+normalizeNonVrmRigFrontAxis\s*\([^)]*\)[\s\S]*beforeAlignment\s*<\s*NON_VRM_FRONT_AXIS_FLIP_THRESHOLD[\s\S]*model\.rotation\.y\s*\+=\s*Math\.PI/],
    ["keeps the camera in canonical view after model-space front-axis normalization", /function\s+getDefaultViewYaw\s*\([^)]*\)\s*\{\s*return\s+0;\s*\}/],
    ["defines conservative runtime depth scale default", /const\s+DEFAULT_LANDMARK_DEPTH_SCALE\s*=\s*0\.45/],
    ["defaults avatar retargeting to strict mode", /activeRetargetMode\s*=\s*normalizeAvatarRetargetMode\(\s*options\.retargetMode,\s*RETARGET_MODE_STRICT\s*\)/],
    ["imports dynamic depth calibration helpers", /from\s+["']\.\/depth-calibration\.js(?:\?v=[^"']+)?["']/],
    ["imports VRM expression helpers", /from\s+["']\.\/vrm-expression-mapping\.js["']/],
    ["uses VRM render compatibility sanitizer", /sanitizeZeroAlphaVertexColors/],
    ["reports VRM render compatibility diagnostics", /renderCompatibility/],
    ["defines motion-gated VRM spring-bone thresholds", /VRM_SPRING_MOTION_THRESHOLD[\s\S]*VRM_SPRING_SETTLE_MS[\s\S]*VRM_SPRING_MOTION_BONES/],
    ["disables three-vrm humanoid auto-updates for raw-bone retargeting", /activeVrm\.humanoid\.autoUpdateHumanBones\s*=\s*false/],
    ["reports three-vrm humanoid auto-update state", /humanoidAutoUpdate/],
    ["updates active VRM spring bones before render", /activeVrm\.springBoneManager\?\.\s*update\?\.\s*\(\s*springDeltaSec\s*\)/],
    ["records VRM runtime update delta before render", /activeVrmRuntime\.lastUpdateDeltaSec\s*=\s*deltaSec/],
    ["includes VRM runtime update in render performance samples", /const\s+startedAt\s*=\s*nowMs\s*\(\s*\)[\s\S]*?updateVrmRuntimeBeforeRender\s*\(\s*timestampMs\s*\)[\s\S]*?renderer\.render\s*\(\s*scene\s*,\s*camera\s*\)/],
    ["records VRM runtime update failure without relabeling the spring toggle", /catch\s*\(\s*error\s*\)\s*\{[\s\S]*?activeVrmRuntime\.runtimeUpdateFailed\s*=\s*true[\s\S]*?updateError/],
    ["gates VRM spring physics by avatar body motion", /function\s+updateVrmSpringMotionActivity\s*\([^)]*\)[\s\S]*?measureVrmSpringDriverMotion\s*\(\s*\)[\s\S]*?VRM_SPRING_MOTION_THRESHOLD[\s\S]*?springPhysicsActive/],
    ["resets VRM spring bones after idle motion settles", /else\s+if\s*\(\s*!vrmSpringMotion\.idleResetDone\s*\)[\s\S]*?springBoneManager\?\.\s*reset\?\.\s*\(\s*\)[\s\S]*?springIdleResetCount/],
    ["keeps non-spring VRM runtime updates active when spring bones are disabled", /function\s+updateActiveVrmRuntime\s*\([^)]*\)\s*\{[\s\S]*?activeVrm\.lookAt\?\.\s*update\?\.\s*\(\s*deltaSec\s*\)[\s\S]*?activeVrm\.nodeConstraintManager\?\.\s*update\?\.\s*\(\s*\)[\s\S]*?shouldUpdateVrmSpringBones\s*\(\s*springActivity\s*\)[\s\S]*?activeVrm\.springBoneManager\?\.\s*update\?\.\s*\(\s*springDeltaSec\s*\)/],
    ["keeps VRM spring-bone toggle separate from non-spring runtime updates", /function\s+shouldUpdateVrmSpringBones\s*\([^)]*\)\s*\{[\s\S]*?activeVrmRuntime\.springBoneEnabled[\s\S]*?springActivity\.active/],
    ["preserves app-owned VRM raw bones and expression morph targets during runtime updates", /App retargeting owns raw bone quaternions and expression morph targets[\s\S]*?activeVrm\.materials/],
    ["exposes VRM runtime report API", /function\s+getVrmRuntimeReport\s*\(/],
    ["exposes VRM spring-bone toggle API", /function\s+setVrmSpringBoneEnabled\s*\(/],
    ["guards VRM spring-bone toggle without an active VRM", /function\s+setVrmSpringBoneEnabled\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!activeVrm\s*\)\s*\{[\s\S]*?return\s+getVrmRuntimeReport\s*\(\s*\)/],
    ["resets VRM spring-bone timing when toggled", /function\s+setVrmSpringBoneEnabled\s*\([^)]*\)\s*\{[\s\S]*?lastVrmRenderUpdateTime\s*=\s*0/],
    ["defines runtime performance budgets", /const\s+PERFORMANCE_BUDGETS_MS\s*=\s*\{[\s\S]*updateMedian\s*:\s*1\.5[\s\S]*validationP95\s*:\s*2/],
    ["defines face apply performance budget", /faceApplyP95\s*:\s*0\.5/],
    ["defines pose solver performance budget", /poseSolverP95\s*:\s*2/],
    ["defines group-specific smoothing", /const\s+RETARGET_SMOOTHING_MS\s*=\s*\{[\s\S]*upperArm[\s\S]*foreArm[\s\S]*finger/],
    ["normalizes smoothing modes", /function\s+normalizeAvatarSmoothingMode\s*\([^)]*\)[\s\S]*retarget[\s\S]*strong/],
    ["defaults renderer smoothing to retarget", /function\s+normalizeAvatarSmoothingMode\s*\([^)]*\)[\s\S]*value\s*\?\?\s*AVATAR_SMOOTHING_MODE_RETARGET[\s\S]*AVATAR_SMOOTHING_ALIASES\[normalized\]\s*\?\?\s*AVATAR_SMOOTHING_MODE_RETARGET/],
    ["reports retarget smoothing mode", /retargetSmoothing\s*:\s*\{[\s\S]*mode\s*:\s*activeSmoothingMode/],
    ["accepts source PTS zero on a nullable causal update clock", /let\s+lastUpdateTime\s*=\s*null[\s\S]*function\s+updateDelta\s*\(\s*timestamp\s*\)[\s\S]*Number\.isFinite\(timestamp\)\s*&&\s*timestamp\s*>=\s*0[\s\S]*Number\.isFinite\(lastUpdateTime\)[\s\S]*FIRST_UPDATE_DELTA_MS/],
    ["keeps metadata-free timestamp zero on the monotonic fallback clock", /function\s+resolveCausalSourceTimestampMs\s*\([^)]*\)[\s\S]*usesVideoClock\s*&&\s*Number\.isFinite\(sourcePtsSec\)[\s\S]*sourcePtsSec\s*\*\s*1000[\s\S]*callbackMonotonicMs\s*>=\s*0[\s\S]*fallback\s*>\s*0[\s\S]*nowMs\s*\(\s*\)/],
    ["resetPose clears both solver states and the nullable causal clock", /function\s+resetPose\s*\(\s*options\s*=\s*\{\}\s*\)[\s\S]*?resetPoseSolverState\(poseSolverState\)[\s\S]*?resetPoseSolverState\(strictPoseSolverState\)[\s\S]*?lastUpdateTime\s*=\s*null[\s\S]*?function\s+resetPoseSolverState\s*\([^)]*\)[\s\S]*?targetState\.facing\s*=\s*undefined[\s\S]*?function\s+setRetargetMode\s*\([^)]*\)[\s\S]*?strictPoseSolverState\.facing\s*=\s*undefined/],
    ["resetPose can preserve calibration for timeline loops", /function\s+resetPose\s*\(\s*options\s*=\s*\{\}\s*\)[\s\S]*?preserveCalibration[\s\S]*?resetRootMotion\(!preserveCalibration\)/],
    ["exports createAvatarRenderer", /export\s+function\s+createAvatarRenderer\s*\(/],
    ["accepts injected model URL", /const\s+modelUrl\s*=\s*options\.modelUrl\s*\?\?\s*DEFAULT_MODEL_URL/],
    ["loads the configured model URL", /loader\.loadAsync\s*\(\s*modelUrl\s*\)/],
    [
      "guards update before ready or after failure",
      /function\s+update\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!ready\s*\|\|\s*failed\s*\|\|\s*disposed\s*\)\s*\{[\s\S]*?return\s*;/,
    ],
    [
      "drives all retarget paths from one causal frame clock while preserving capture time",
      /function\s+update\s*\([^)]*\)[\s\S]*?const\s+frameTimestamp\s*=\s*frame\?\.timestamp\s*\?\?\s*timestamp[\s\S]*?const\s+causalFrameTimestampMs\s*=\s*resolveCausalSourceTimestampMs\([\s\S]*?updateDelta\(\s*causalFrameTimestampMs\s*\)[\s\S]*?applyPose\([\s\S]*?causalFrameTimestampMs\s*,\s*\)[\s\S]*?applyFaceHeadPose\([^;]*causalFrameTimestampMs\s*\)[\s\S]*?applyPoseOwnedHandOrientations\([\s\S]*?causalFrameTimestampMs\s*,?\s*\)[\s\S]*?captureAppliedAvatarState\(\s*\{[\s\S]*?sourceTimestampMs\s*:\s*frameTimestamp/,
    ],
    [
      "shares the causal pose cache clock across body and depth validation snapshots",
      /function\s+getBodyValidationSnapshotInternal\s*\([^)]*\)[\s\S]*?const\s+causalFrameTimestampMs\s*=\s*resolveCausalSourceTimestampMs\(\s*frame\?\.sourceMeta\s*,\s*frameTimestamp\s*,?\s*\)[\s\S]*?getPoseFramePoints\([\s\S]*?causalFrameTimestampMs\s*,[\s\S]*?timestamp\s*:\s*frameTimestamp[\s\S]*?function\s+getDepthValidationSnapshotInternal\s*\([^)]*\)[\s\S]*?const\s+causalFrameTimestampMs\s*=\s*resolveCausalSourceTimestampMs\(\s*frame\?\.sourceMeta\s*,\s*frameTimestamp\s*,?\s*\)[\s\S]*?getPoseFramePoints\([\s\S]*?causalFrameTimestampMs\s*,[\s\S]*?timestamp\s*:\s*frameTimestamp/,
    ],
    ["initializes solver facing and recovery timestamps without fabricated samples", /const\s+poseSolverState\s*=\s*\{\s*facing\s*:\s*undefined[\s\S]*?const\s+strictPoseSolverState\s*=\s*\{\s*facing\s*:\s*undefined[\s\S]*?const\s+trackingRecovery\s*=\s*\{[\s\S]*?lastLostAt\s*:\s*null[\s\S]*?reacquiredAt\s*:\s*null/],
    [
      "returns public renderer API",
      /const\s+api\s*=\s*\{[\s\S]*?\binit\b[\s\S]*?\bupdate\b[\s\S]*?\bgetBodyValidationSnapshot\b[\s\S]*?\bsetSkeletonVisible\b[\s\S]*?\bgetPerformanceSnapshot\b[\s\S]*?\bresetPose\b[\s\S]*?\bresize\b[\s\S]*?\bdispose\b[\s\S]*?\};/,
    ],
    ["imports RoomEnvironment", /import\s*\{\s*RoomEnvironment\s*\}\s*from\s*["']three\/addons\/environments\/RoomEnvironment\.js["']/],
    ["uses ACES tone mapping", /renderer\.toneMapping\s*=\s*THREE\.ACESFilmicToneMapping/],
    ["uses low-cost environment lighting", /new\s+RoomEnvironment\s*\(\s*renderer\s*\)[\s\S]*PMREMGenerator[\s\S]*scene\.environment/],
    ["creates contact shadow", /function\s+createContactShadow\s*\([^)]*\)[\s\S]*AvatarContactShadow/],
    ["creates Three.js skeleton helper", /new\s+THREE\.SkeletonHelper\s*\(\s*model\s*\)/],
    ["defines skeleton visibility setter", /function\s+setSkeletonVisible\s*\(\s*value\s*\)/],
    ["defines visual skeleton joints", /const\s+BODY_VISUAL_JOINTS\s*=\s*\[[\s\S]*?leftShoulder[\s\S]*?rightAnkle/],
    ["exposes projected body pose snapshot", /function\s+getProjectedBodyPoseSnapshot\s*\([^)]*\)/],
    ["exposes depth validation snapshot", /function\s+getDepthValidationSnapshot\s*\([^)]*\)/],
    ["defines orbit camera application", /function\s+applyOrbitCamera\s*\(\s*\)[\s\S]*setFromSpherical[\s\S]*lookAt/],
    ["defines orbit pointer controls", /function\s+attachOrbitControls\s*\(\s*\)[\s\S]*pointerdown[\s\S]*wheel[\s\S]*dblclick/],
    ["exposes avatar view reset", /function\s+resetView\s*\(\s*\)[\s\S]*resetOrbitCamera[\s\S]*getViewState/],
    ["reports rest pose diagnostics", /restPose\s*:\s*buildRestPoseDiagnostics\s*\(\s*\)/],
    ["reports bone orientation diagnostics", /boneOrientation\s*:\s*buildBoneOrientationDiagnostics\s*\(\s*\)/],
    ["reports optional eye bone diagnostics", /eyeBones\s*:\s*\{[\s\S]*LeftEye[\s\S]*RightEye/],
    ["reads MediaPipe world landmarks", /function\s+extractWorldPoseLandmarks\s*\([^)]*\)[\s\S]*worldLandmarks/],
    ["exposes depth scale setter", /function\s+setDepthScale\s*\([^)]*\)[\s\S]*normalizeDepthScale/],
    ["exposes depth calibration controls", /function\s+setDepthCalibrationMode\s*\([^)]*\)[\s\S]*resetDepthCalibration/],
    ["applies dynamic depth calibration before retargeting", /function\s+applyPose\s*\([^)]*\)[\s\S]*getPoseFramePoints[\s\S]*applyAimToBone/],
    ["uses adaptive upper-body depth calibration coverage", /depthCalibrationCoverage[\s\S]*resolveDepthCalibrationMinSegments[\s\S]*minimumReferenceSegments/],
    ["falls back to shoulder-width world depth context", /screenShoulderWidth[\s\S]*worldShoulderWidth[\s\S]*worldToScreenScale/],
    ["defines body validation segments", /const\s+BODY_VALIDATION_SEGMENTS\s*=\s*\[[\s\S]*?leftUpperArm[\s\S]*?rightLowerLeg/],
    ["reports head direction validation segment", /const\s+BODY_VALIDATION_SEGMENTS\s*=\s*\[[\s\S]*?name\s*:\s*["']head["'][\s\S]*?bone\s*:\s*["']Head["'][\s\S]*?from\s*:\s*["']headAimBase["'][\s\S]*?to\s*:\s*["']headCrown["']/],
    ["exposes body validation snapshot", /function\s+getBodyValidationSnapshot\s*\([^)]*\)/],
    ["defines body retarget hooks", /const\s+BODY_RETARGETS\s*=\s*\[[\s\S]*?bone\s*:\s*["']LeftArm["'][\s\S]*?bone\s*:\s*["']RightLeg["']/],
    ["uses deadzoned virtual torso points", /SPINE_WAVE_TWIST_DEADZONE[\s\S]*function\s+assignSpineWavePoints\s*\([^)]*\)[\s\S]*applySignedDeadzone[\s\S]*active\s*:/],
    ["derives clavicle proxies from arm evidence", /CLAVICLE_ELEVATION_START[\s\S]*function\s+assignClaviclePoints\s*\([^)]*\)[\s\S]*virtualJoint[\s\S]*shoulder_arm_proxy/],
    ["aims pose-fallback head at virtual crown", /bone\s*:\s*["']Head["'][\s\S]*to\s*:\s*["']headCrown["'][\s\S]*function\s+estimateHeadCrown/],
    ["uses nose offset for pose-fallback head aim", /const\s+HEAD_CROWN_NOSE_OFFSET_BLEND[\s\S]*function\s+estimateHeadCrown\s*\([^)]*\)[\s\S]*noseOffset[\s\S]*headDirection\.addScaledVector\(\s*noseOffset\s*,\s*HEAD_CROWN_NOSE_OFFSET_BLEND\s*\)/],
    ["applies body retargets", /for\s*\(\s*const\s+target\s+of\s+BODY_RETARGETS\s*\)[\s\S]*?applyAimToBone\s*\(\s*target\.bone/],
    ["keeps head secondary aim active in strict retargeting", /const\s+secondaryWorld\s*=\s*strictModeActive[\s\S]*?\?\s*profile[\s\S]*?resolveBodySecondaryAxis\(target,\s*points\)[\s\S]*?applyAimToBone\(\s*target\.bone[\s\S]*?secondaryWorld/],
    ["declares strict Foot-only rest-angle limits", /const\s+STRICT_REST_ANGLE_LIMIT_BONES\s*=\s*new\s+Set\s*\(\s*\[[\s\S]*?["']LeftFoot["'][\s\S]*?["']RightFoot["'][\s\S]*?\]\s*\)/],
    ["keeps strict non-profile body bones uncapped except declared Foot maxAngle", /function\s+resolveBodyRetargetLimits\s*\([^)]*\)[\s\S]*strictModeActive\s*&&\s*!profile[\s\S]*STRICT_REST_ANGLE_LIMIT_BONES\.has\(\s*target\.bone\s*\)[\s\S]*\?\s*target\.maxAngle\s*:\s*undefined[\s\S]*maxTwist\s*:\s*undefined/],
    ["keeps profile body retarget caps for head and neck", /function\s+resolveBodyRetargetLimits\s*\([^)]*\)[\s\S]*maxAngle\s*:\s*target\.maxAngle\s*\*\s*\(profile\?\.maxAngleScale\s*\?\?\s*1\)[\s\S]*maxTwist\s*:\s*profile\s*\?\s*target\.maxTwist\s*\*\s*\(profile\.maxTwistScale\s*\?\?\s*1\)\s*:\s*undefined/],
    ["gates retargeting by landmark visibility", /function\s+retargetConfidence\s*\([^)]*\)[\s\S]*RETARGET_FULL_CONFIDENCE_VISIBILITY/],
    ["computes limb plane normals", /function\s+computeLimbPlaneNormals\s*\([^)]*\)[\s\S]*limbPlaneNormal/],
    ["uses limb plane normals as body secondary axes", /computeLimbPlaneNormals\s*\(\s*points\s*\)[\s\S]*limbPlaneNormals\[target\.bone\]/],
    ["prefers head parent axis over child nodes", /function\s+inferBoneAxisLocal\s*\([^)]*\)[\s\S]*resolvedBaseName\s*===\s*["']Head["'][\s\S]*preferOwnPositionForAxis[\s\S]*childBone/],
    ["keeps secondary aim rest basis in dedicated temp vectors", /const\s+tmpVectorG\s*=\s*new\s+THREE\.Vector3\(\)[\s\S]*const\s+tmpVectorH\s*=\s*new\s+THREE\.Vector3\(\)[\s\S]*function\s+applyAimWithSecondary[\s\S]*const\s+restDirectionLocal\s*=\s*tmpVectorG[\s\S]*const\s+restSecondaryLocal\s*=\s*tmpVectorH/],
    ["computes palm normal as part of the coherent hand basis", /resolveHandOrientationBasis[\s\S]*handBasis\.normal/],
    ["uses one coherent world or image basis for wrist aim", /worldLandmarks[\s\S]*worldPoints[\s\S]*resolveHandOrientationBasis\(\{[\s\S]*imagePoints\s*:\s*points[\s\S]*worldPoints[\s\S]*handBasis\.primary[\s\S]*secondaryWorld\s*:\s*palmNormal/],
    ["reports hand orientation diagnostics", /handOrientation[\s\S]*rawPalmNormal[\s\S]*avatarPalmNormal/],
    ["imports finger curl helpers", /estimateFingerCurlStrength[\s\S]*estimateHandPalmCenter[\s\S]*from\s+["']\.\/hand-retargeting\.js(?:\?[^"']+)?["']/],
    ["defines segment-specific fist curl bias", /const\s+FIST_CURL_BIAS_BY_SEGMENT\s*=\s*Object\.freeze\(\s*\{[\s\S]*Thumb[\s\S]*Default/],
    ["applies measured fist curl bias before finger aim", /estimateHandPalmCenter\s*\(\s*articulationPoints\s*\)[\s\S]*estimateFingerCurlStrength\s*\(\s*articulationPoints\s*,\s*fingerName\s*\)[\s\S]*applyFingerFistCurlBias\s*\(/],
    ["maps solver yaw to avatar yaw explicitly", /resolveAvatarYawDeg[\s\S]*avatarTargetYawDeg[\s\S]*avatarYawSign/],
    ["limits parent-relative twist", /function\s+limitTwistFromRest\s*\([^)]*\)[\s\S]*extractTwist/],
    ["stabilizes root facing before yaw changes", /ROOT_ORIENTATION_SWITCH_FRAMES[\s\S]*candidateFacingFrames[\s\S]*function\s+updateStableRootFacing/],
    ["defines avatar-proportion source normalization segments", /const\s+SOURCE_PROPORTION_NORMALIZATION_SEGMENTS\s*=\s*Object\.freeze\(\s*\[[\s\S]*leftUpperArm[\s\S]*leftForeArm[\s\S]*rightUpperArm[\s\S]*rightForeArm/],
    ["caches avatar rest proportions without mutating bones", /function\s+cacheAvatarProportionReference\s*\([^)]*\)[\s\S]*buildAvatarProportionReferencePoints\s*\(\s*\)[\s\S]*referenceRatios[\s\S]*proportionCalibration\.frozen\s*=/],
    ["normalizes source skeleton to avatar proportions before solving", /function\s+applyPose\s*\([^)]*\)[\s\S]*const\s+\{\s*points\s*:\s*sourcePoints[\s\S]*normalizePosePointsToAvatarProportions\s*\(\s*sourcePoints\s*\)[\s\S]*solvePoseTargetsFromPoints\s*\(\s*points/],
    ["normalizes distal pose points instead of avatar bone positions", /function\s+normalizePosePointsToAvatarProportions\s*\([^)]*\)[\s\S]*bodyScale2D\s*\(\s*sourcePoints\s*\)[\s\S]*copyDerivedPointMetadata[\s\S]*rebuildDerivedPosePoints\s*\(/],
    ["reports source-proportion normalization diagnostics", /sourceProportions\s*:\s*\{[\s\S]*referenceSegments[\s\S]*normalizedSegments[\s\S]*lastInputScale/],
    ["exposes avatar performance snapshot", /function\s+getPerformanceSnapshot\s*\([^)]*\)[\s\S]*PERFORMANCE_BUDGETS_MS/],
    ["reports pose solver timing", /poseSolverMs[\s\S]*samples\s*:\s*\{[\s\S]*poseSolver\s*:\s*summarizePerformanceSamples/],
    ["reports pose solver hinge metrics", /hingeViolations[\s\S]*hingeLimitWarnings[\s\S]*lowConfidenceHinges[\s\S]*solvedPose\.hinges\.map/],
    ["reports pose solver aggregate metrics", /poseSolverMetrics[\s\S]*hingeViolationFrames[\s\S]*hingeLimitWarningFrames[\s\S]*facingChanges[\s\S]*modeChanges/],
    ["reports face head pose telemetry", /faceHeadPose\s*:\s*getFaceHeadPoseSnapshot\(\)[\s\S]*function\s+getFaceHeadPoseSnapshot\s*\(\s*\)[\s\S]*faceEulerDeg[\s\S]*boneAngularVelocityDegPerSec[\s\S]*jumpCount/],
    ["reports hinge warning breakdown by name", /hingeLimitWarningByName[\s\S]*maxHingeFlexDegByName[\s\S]*maxHingeOverflowDegByName/],
    ["defines lost tracking recovery timing", /RETARGET_LOST_TRACKING_HOLD_MS[\s\S]*RETARGET_LOST_TRACKING_DECAY_MS[\s\S]*RETARGET_REACQUIRE_BLEND_MS/],
    ["eases lost tracking body pose to rest", /function\s+applyLostTrackingBodyPose\s*\([^)]*\)[\s\S]*applyOccludedBodyBone[\s\S]*RETARGET_LOST_TRACKING_HOLD_MS/],
    ["blends retarget after reacquiring pose with nullable timestamp sentinels", /function\s+resetTrackingRecoveryState\s*\([^)]*\)[\s\S]*lastLostAt\s*=\s*null[\s\S]*reacquiredAt\s*=\s*null[\s\S]*function\s+updateTrackingRecoveryState\s*\([^)]*\)[\s\S]*reacquiredAt\s*=\s*null[\s\S]*Number\.isFinite\(trackingRecovery\.reacquiredAt\)[\s\S]*RETARGET_REACQUIRE_BLEND_MS[\s\S]*reacquiredAt\s*=\s*null/],
    ["composes face transform delta onto the body-owned head pose", /function\s+applyFaceHeadPose\s*\([^)]*\)[\s\S]*faceTransformQuaternion[\s\S]*updateFaceHeadPoseTracker[\s\S]*computeFaceHeadDelta[\s\S]*applyBodyRelativeFaceHeadDelta\([\s\S]*?["']Head["']/],
    ["holds face head base through short gaps and causally releases long gaps", /face-head-pose\.js\?v=20260717-face-gap-release-1[\s\S]*FACE_HEAD_TRACKING_GRACE_MS[\s\S]*FACE_HEAD_REACQUIRE_BLEND_MS[\s\S]*updateFaceHeadPoseTracker\(faceHeadPose[\s\S]*tracker\.releaseToIdentity[\s\S]*smoothingAlpha\(delta,\s*FACE_HEAD_POSE_SMOOTHING_MS\)[\s\S]*releaseBodyRelativeFaceHeadDelta\(\s*['"]Head['"]/],
    ["smooths strict head and neck retargets", /const\s+targetAlpha\s*=\s*strictModeActive[\s\S]*\?\s*profile[\s\S]*alpha\s*\*\s*reacquireBlend[\s\S]*profile\.strengthScale/],
    ["reports rest forward dot diagnostics", /restForwardDot\s*:\s*bone\s*&&\s*secondaryAxisLocal\s*\?\s*computeRestSecondaryForwardDot/],
    ["smooths strict root yaw", /ROOT_ORIENTATION_MAX_YAW_RATE_DEG_PER_SEC[\s\S]*function\s+applyStrictRootOrientation[\s\S]*strictYawSmoothingAlpha[\s\S]*rootMotion\.yawOffset\s*\+=\s*yawStep/],
    ["applies face expressions after hand retargeting", /applyHands\s*\([\s\S]*?\)[\s\S]*?applyFaceExpressions\s*\(/],
    ["reports expression diagnostics", /expressionPresetCount[\s\S]*resolvedMorphTargetCount[\s\S]*missingPresets/],
    ["imports hand retargeting helpers", /from\s+["']\.\/hand-retargeting\.js(?:\?[^"']+)?["']/],
    [
      "builds side-specific finger chains",
      /for\s*\(\s*const\s+side\s+of\s+\[\s*["']Left["']\s*,\s*["']Right["']\s*\]\s*\)[\s\S]*?\$\{side\}Hand\$\{fingerName\}\$\{segment\}/,
    ],
    ["applies hand landmark retargeting", /resolveFingerSegmentPoints\s*\(\s*articulationPoints\s*,\s*fingerName\s*,\s*i\s*\)/],
    ["has failure handler", /function\s+fail\s*\(\s*error\s*\)/],
    ["marks renderer failed", /function\s+fail\s*\(\s*error\s*\)[\s\S]*?failed\s*=\s*true/],
    ["reports failed status", /setStatus\s*\(\s*`Failed:/],
    ["clears bone count on failure", /function\s+fail\s*\(\s*error\s*\)[\s\S]*?setBoneCount\s*\(\s*0\s*\)/],
    [
      "disposes model resources on failure",
      /function\s+fail\s*\(\s*error\s*\)[\s\S]*?disposeModelResources\s*\(\s*model\s*\)[\s\S]*?renderer\?\.\s*dispose\?\.\s*\(\s*\)/,
    ],
  ];

  for (const [label, pattern] of rendererChecks) {
    checkPattern(avatarRenderer, pattern, `src/avatar-renderer.js: contract missing - ${label}`);
  }

  check(
    !/ARM_JOINT_CONNECTOR|AvatarArmJointConnector|armJointConnectors|jointConnectors\s*:/.test(avatarRenderer),
    "src/avatar-renderer.js: visual arm joint connector overlay must not be present; fix the rig/retarget path instead of hiding gaps with primitives",
  );
  check(
    !/bone\.position\.copy\(\s*rest\.position\s*\)\.multiplyScalar/.test(avatarRenderer),
    "src/avatar-renderer.js: proportion calibration must not mutate avatar bone positions; normalize the source skeleton instead",
  );

  checkFingerAimLimitContract(avatarRenderer);

  check(
    !/activeVrm\.update\s*\(/.test(avatarRenderer),
    "src/avatar-renderer.js: VRM runtime updates must not call activeVrm.update() because it clears app-owned expression morph targets",
  );
  check(
    !/activeVrm\.humanoid\?\.\s*update\?\.\s*\(/.test(avatarRenderer),
    "src/avatar-renderer.js: VRM runtime updates must not call activeVrm.humanoid.update() because it overwrites app-owned raw-bone retargeting",
  );

  for (const bone of requiredAvatarBones) {
    checkPattern(
      avatarRenderer,
      new RegExp(`["']${escapeRegExp(bone)}["']`),
      `src/avatar-renderer.js: REQUIRED_BONES missing ${bone}`,
    );
  }
}

function checkHandRetargetingContract(handRetargeting) {
  const helperChecks = [
    ["exports finger landmark mappings", /export\s+const\s+HAND_FINGERS\s*=/],
    ["defines generic finger segment mappings", /const\s+FINGER_SEGMENTS\s*=\s*Object\.freeze\(\s*\[[\s\S]*?fallbackFrom/],
    ["defines thumb-specific segment mappings", /const\s+THUMB_FINGER_SEGMENTS\s*=\s*Object\.freeze\(\s*\[[\s\S]*?from\s*:\s*0[\s\S]*?to\s*:\s*1[\s\S]*?from\s*:\s*1[\s\S]*?to\s*:\s*2[\s\S]*?from\s*:\s*2[\s\S]*?to\s*:\s*3/],
    ["resolves segment points", /export\s+function\s+resolveFingerSegmentPoints\s*\(/],
    ["exposes segment count", /export\s+function\s+getFingerSegmentCount\s*\(/],
    ["estimates palm center", /export\s+function\s+estimateHandPalmCenter\s*\(/],
    ["estimates measured finger curl", /export\s+function\s+estimateFingerCurlStrength\s*\(/],
    ["keeps thumb segments on anatomical thumb joints", /fingerName\s*===\s*["']Thumb["'][\s\S]*THUMB_FINGER_SEGMENTS/],
    ["resolves wrist landmark token", /token\s*===\s*["']wrist["'][\s\S]*return\s+0/],
  ];

  for (const [label, pattern] of helperChecks) {
    checkPattern(handRetargeting, pattern, `${files.handRetargeting}: contract missing - ${label}`);
  }

  const fingerLandmarkMappings = {
    Thumb: [1, 2, 3, 4],
    Index: [5, 6, 7, 8],
    Middle: [9, 10, 11, 12],
    Ring: [13, 14, 15, 16],
    Pinky: [17, 18, 19, 20],
  };

  for (const [fingerName, indices] of Object.entries(fingerLandmarkMappings)) {
    checkPattern(
      handRetargeting,
      new RegExp(`${fingerName}\\s*:\\s*Object\\.freeze\\(\\s*\\[\\s*${indices.join("\\s*,\\s*")}\\s*\\]\\s*\\)`),
      `${files.handRetargeting}: missing ${fingerName} MediaPipe finger landmark mapping`,
    );
  }
}

function checkCssContract(css) {
  const responsiveChecks = [
    ["content grid layout", /\.content-grid\s*\{[\s\S]*?grid-template-columns\s*:/],
    ["visual workspace grid", /\.visual-workspace\s*\{[\s\S]*?display\s*:\s*grid[\s\S]*?grid-template-columns\s*:\s*repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/],
    ["camera and avatar shared stage aspect ratio", /\.camera-stage\s*,\s*\.avatar-stage\s*\{[\s\S]*?aspect-ratio\s*:\s*16\s*\/\s*9/],
    ["avatar canvas fills viewport", /#camera-video\s*,\s*#overlay-canvas\s*,\s*#avatar-canvas\s*\{[\s\S]*?position\s*:\s*absolute[\s\S]*?width\s*:\s*100%[\s\S]*?height\s*:\s*100%/],
    ["avatar canvas render rule", /#avatar-canvas\s*\{[\s\S]*?display\s*:\s*block/],
    ["avatar canvas orbit cursor", /#avatar-canvas\s*\{[\s\S]*?cursor\s*:\s*grab[\s\S]*?touch-action\s*:\s*none/],
    ["avatar view reset button", /\.avatar-view-reset\s*\{[\s\S]*?position\s*:\s*absolute[\s\S]*?z-index\s*:\s*3/],
    ["avatar status list grid", /\.avatar-status-list\s*\{[\s\S]*?grid-template-columns\s*:\s*repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/],
    ["motion status HUD grid", /\.motion-status-grid\s*\{[\s\S]*?grid-template-columns\s*:\s*repeat\(\s*2\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)/],
    ["motion status calibration action", /\.motion-status-actions\s*\{[\s\S]*?margin-top[\s\S]*?\.motion-status-calibrate\s*\{[\s\S]*?width\s*:\s*100%/],
    ["control rail grid", /\.control-rail\s*\{[\s\S]*?display\s*:\s*grid/],
    ["video file input styling", /\.file-field\s+input\s*\{[\s\S]*?border\s*:\s*1px\s+solid\s+var\(--panel-line\)/],
    ["stacked debug toggle spacing", /\.toggle\s*\+\s*\.toggle\s*\{[\s\S]*?margin-top\s*:/],
    ["tablet breakpoint", /@media\s*\(\s*max-width\s*:\s*920px\s*\)/],
    ["avatar stack breakpoint", /@media\s*\(\s*max-width\s*:\s*760px\s*\)[\s\S]*?\.visual-workspace\s*\{[\s\S]*?grid-template-columns\s*:\s*1fr/],
    ["mobile breakpoint", /@media\s*\(\s*max-width\s*:\s*680px\s*\)/],
    ["mobile camera and avatar stage sizing", /@media\s*\(\s*max-width\s*:\s*680px\s*\)[\s\S]*?\.camera-stage\s*,\s*\.avatar-stage\s*\{[\s\S]*?aspect-ratio\s*:\s*4\s*\/\s*3/],
  ];

  for (const [label, pattern] of responsiveChecks) {
    checkPattern(css, pattern, `styles.css: responsive/avatar CSS contract missing - ${label}`);
  }
}

function checkAvatarModelContract(modelJson) {
  if (!modelJson) {
    return;
  }

  const nodeNames = new Set((modelJson.nodes ?? []).map((node) => node?.name).filter(Boolean));

  check(modelJson?.asset?.version === "2.0", "assets/models/Xbot.glb: JSON asset version must be 2.0");
  check(Array.isArray(modelJson.nodes) && modelJson.nodes.length > 0, "assets/models/Xbot.glb: expected nodes");
  check(Array.isArray(modelJson.skins) && modelJson.skins.length > 0, "assets/models/Xbot.glb: expected at least one skin");

  for (const bone of requiredFingerBaseBones) {
    check(nodeNames.has(bone), `assets/models/Xbot.glb: missing required finger bone ${bone}`);
  }
}

function checkAuxiliaryInferenceArbiterContract(app, arbiter) {
  checkPattern(
    arbiter,
    /FIXED_CAPACITY\s*=\s*2[\s\S]*FIXED_MAX_QUEUE_DEPTH\s*=\s*FIXED_LANES\.length\s*-\s*FIXED_CAPACITY/,
    `${files.auxiliaryInferenceArbiter}: owner must fix two permits and one possible third-lane wait`,
  );
  check(
    !arbiter.includes("LANE_PRIORITY") && !/queue\.sort\s*\(/.test(arbiter),
    `${files.auxiliaryInferenceArbiter}: the sole structural third-lane wait must not masquerade as a generic priority queue`,
  );
  checkPattern(
    arbiter,
    /activeByLane\s*=\s*new Map\(\)[\s\S]*queuedByLane\s*=\s*new Map\(\)[\s\S]*activeByLane\.has\(lane\)\s*\|\|\s*queuedByLane\.has\(lane\)/,
    `${files.auxiliaryInferenceArbiter}: each fixed lane must own at most one active or queued acquisition`,
  );
  checkPattern(
    arbiter,
    /function\s+drain\([^)]*\)[\s\S]*activeByLane\.size\s*<\s*capacity[\s\S]*queue\.shift\(\)[\s\S]*function\s+createLease[\s\S]*release\(\)[\s\S]*activeByLane\.delete[\s\S]*drain\(\)/,
    `${files.auxiliaryInferenceArbiter}: leases must release idempotently and synchronously drain the sole bounded third-lane wait`,
  );
  checkPattern(
    arbiter,
    /byLane:[\s\S]*waitedGrants:\s*0[\s\S]*totalWaitMs:\s*0[\s\S]*maxWaitMs:\s*0[\s\S]*averageWaitMs:/,
    `${files.auxiliaryInferenceArbiter}: aggregate and each fixed lane must expose honest bounded wait telemetry`,
  );
  checkPattern(
    arbiter,
    /function\s+advanceGeneration\([^)]*\)[\s\S]*staleQueue[\s\S]*cancelRequest[\s\S]*function\s+resetTelemetry\([^)]*\)[\s\S]*maxActive\s*=\s*activeByLane\.size[\s\S]*maxQueued\s*=\s*queue\.length/,
    `${files.auxiliaryInferenceArbiter}: generation cancellation and telemetry reset must preserve real active ownership`,
  );
  checkPattern(
    app,
    /const\s+auxiliaryInferenceArbiter\s*=\s*createAuxiliaryInferenceArbiter\(\)/,
    `${files.app}: Face and both Hand lanes must share one auxiliary inference owner`,
  );
  checkPattern(
    app,
    /async\s+function\s+consumeFaceFrame\([^)]*\)[\s\S]*await\s+prepareFaceWorkerGeneration[\s\S]*auxiliaryInferenceArbiter\.acquire\(\{[\s\S]*AUXILIARY_INFERENCE_LANES\.FACE[\s\S]*MAX_PENDING_FRAME_AGE_MS[\s\S]*state\.faceWorker\.requests\s*\+=\s*1[\s\S]*postFaceWorkerRequest\([\s\S]*finally\s*\{\s*lease\.release\(\)/,
    `${files.app}: Face detect must acquire after prepare, recheck age, and release after the worker request settles`,
  );
  checkPattern(
    app,
    /async\s+function\s+detectHandSideFrame\([^)]*\)[\s\S]*const\s+ageMs[\s\S]*ageMs\s*>\s*MAX_PENDING_FRAME_AGE_MS[\s\S]*const\s+handRequestStartedAt\s*=\s*nowMs\(\);\s*const\s+lease\s*=\s*await\s+auxiliaryInferenceArbiter\.acquire\(\{[\s\S]*HAND_LEFT[\s\S]*HAND_RIGHT[\s\S]*const\s+acquiredAgeMs[\s\S]*acquiredAgeMs\s*>\s*MAX_PENDING_FRAME_AGE_MS[\s\S]*getHandSideFramePump\(side\)\.getGeneration\(\)[\s\S]*runtime\.requests\s*\+=\s*1[\s\S]*postHandWorkerRequest\([\s\S]*recordHandSideResponseTelemetry\(side,\s*response,\s*handRequestStartedAt,\s*envelope\)[\s\S]*finally\s*\{\s*lease\.release\(\)/,
    `${files.app}: each Hand side must time from before acquisition, enforce the common pending age on both sides, and release after the worker request settles`,
  );
  checkPattern(
    app,
    /const\s+inputGeneration\s*=\s*getLatestFramePump\(\)\.advanceGeneration\(reason\);\s*bodyGenerationPreparations\.clear\(\);\s*auxiliaryInferenceArbiter\.advanceGeneration\(inputGeneration\)/,
    `${files.app}: auxiliary queued work must advance with the exact Body generation`,
  );
  checkPattern(
    app,
    /function\s+resetAppPerformance\([^)]*\)[\s\S]*getLatestFramePump\(\)\.resetTelemetry\(\);[\s\S]*auxiliaryInferenceArbiter\.resetTelemetry\(\);[\s\S]*function\s+getAppPerformanceReport\([^)]*\)[\s\S]*auxiliaryInference:\s*auxiliaryInferenceArbiter\.getStatus\(\)/,
    `${files.app}: measurement reset and report must expose but never reset live auxiliary ownership`,
  );
}

function checkFaceObservationMaturationContract(app, maturation) {
  checkPattern(
    maturation,
    /function\s+register\([^)]*\)[\s\S]*generation\s*!==\s*activeGeneration[\s\S]*lastRegistrationByGeneration[\s\S]*Object\.freeze\(\{[\s\S]*generation[\s\S]*slotIndex[\s\S]*sourcePtsSec[\s\S]*callbackMonotonicMs[\s\S]*deadlineMonotonicMs[\s\S]*entriesByToken\.set/,
    `${files.faceObservationMaturation}: registration must create one immutable active-generation source-slot identity`,
  );
  checkPattern(
    maturation,
    /function\s+settle\([^)]*\)[\s\S]*expirePastDeadline\(entry\)[\s\S]*freezeObservation\(observation\)[\s\S]*TERMINAL_NULL_OBSERVATION[\s\S]*terminalize\(entry[\s\S]*function\s+drop\([^)]*\)[\s\S]*expirePastDeadline\(entry\)[\s\S]*TERMINAL_DROP/,
    `${files.faceObservationMaturation}: settle and drop must enforce the admission deadline while preserving explicit null`,
  );
  checkPattern(
    maturation,
    /async\s+function\s+waitForEligible\([^)]*\)[\s\S]*cutoffSourcePtsSec[\s\S]*for\s*\(const\s+entry\s+of\s+entries\.values\(\)\)[\s\S]*entry\.sourcePtsSec\s*>[\s\S]*selected\s*=\s*entry[\s\S]*if\s*\(!selected\)[\s\S]*future-only[\s\S]*waitForTerminal\(selected/,
    `${files.faceObservationMaturation}: Body selection must bind only the newest admitted non-future slot`,
  );
  checkPattern(
    maturation,
    /function\s+scheduleWaiterDeadline\([^)]*\)[\s\S]*deadlineMonotonicMs\s*-\s*readNow\(\)[\s\S]*readNow\(\)\s*<\s*entry\.deadlineMonotonicMs[\s\S]*scheduleWaiterDeadline\(entry,\s*waiter\)[\s\S]*TERMINAL_DEADLINE_MISS/,
    `${files.faceObservationMaturation}: an early timer must reschedule against the original absolute deadline`,
  );
  checkPattern(
    maturation,
    /function\s+terminalize\([^)]*\)[\s\S]*entry\.state\s*=\s*["']terminal["'][\s\S]*for\s*\(const\s+waiter[\s\S]*finishWaiter\(entry,\s*waiter\)[\s\S]*function\s+finishWaiter\([^)]*\)[\s\S]*entry\.waiters\.delete\(waiter\)[\s\S]*cancelSchedule\(waiter\.timerId\)/,
    `${files.faceObservationMaturation}: every terminal transition must release waiters and cancel their timers`,
  );
  checkPattern(
    maturation,
    /function\s+advanceGeneration\([^)]*\)[\s\S]*TERMINAL_CANCELLATION[\s\S]*function\s+resetTelemetry\([^)]*\)[\s\S]*telemetry\s*=\s*createTelemetry\(\)[\s\S]*maxPending\s*=\s*countPending\(\)[\s\S]*function\s+trimHistory\([^)]*\)[\s\S]*entry\.state\s*===\s*["']terminal["']\s*&&\s*entry\.waiters\.size\s*===\s*0/,
    `${files.faceObservationMaturation}: generation, telemetry reset, and trimming must preserve live ownership`,
  );
  checkPattern(
    maturation,
    /function\s+getStatus\([^)]*\)[\s\S]*pending:\s*countPending\(\)[\s\S]*currentWaits:\s*activeWaits[\s\S]*averageWaitMs[\s\S]*terminalCounts[\s\S]*currentByTerminal/,
    `${files.faceObservationMaturation}: status must expose bounded wait and per-terminal telemetry`,
  );

  checkPattern(
    app,
    /createFaceObservationMaturationLedger\(\{[\s\S]*deadlineMs:\s*MAX_PENDING_FRAME_AGE_MS[\s\S]*sourcePtsEpsilonSec:\s*FACE_SOURCE_PTS_EPSILON_SEC/,
    `${files.app}: Face maturation must share the fixed 80 ms pending fence`,
  );
  checkPattern(
    app,
    /function\s+offerFaceSnapshotForDetection\([^)]*\)[\s\S]*faceObservationMaturationLedger\.register\(\{[\s\S]*slotIndex:\s*admission\.slotIndex[\s\S]*callbackMonotonicMs:\s*callbackReceivedMonotonicMs[\s\S]*getFaceFramePump\(\)\.offer\(\{[\s\S]*faceObservationMaturationToken/,
    `${files.app}: a Face source slot must register before pump ownership and travel with its envelope`,
  );
  checkPattern(
    app,
    /createLatestFramePump\(\{\s*consume:\s*consumeFaceFrame[\s\S]*dispose:\s*\(envelope,\s*reason\)[\s\S]*reason\s*!==\s*["']consumed["'][\s\S]*dropFaceObservationEnvelope\(envelope,\s*reason\)/,
    `${files.app}: every non-consumed Face pump disposal must seal its exact slot`,
  );
  checkPattern(
    app,
    /function\s+applyFaceFrameResult\([^)]*\)[\s\S]*if\s*\(!result\)[\s\S]*dropFaceObservationEnvelope\(envelope,\s*["']face-result-unavailable["']\)[\s\S]*face-runtime-inactive[\s\S]*face-result-rejected[\s\S]*faceObservationMaturationLedger\.settle\([\s\S]*catch\s*\(error\)[\s\S]*face-apply-error/,
    `${files.app}: consumed Face null, invalid, inactive, late, and exception paths must terminalize internally`,
  );
  checkPattern(
    app,
    /recordAppPerformanceSample\(["']detectMs["'],\s*nowMs\(\)\s*-\s*detectStartedAt\)[\s\S]*await\s+faceObservationMaturationLedger\.waitForEligible\(\{[\s\S]*applicationLagMs:\s*FACE_OBSERVATION_DELAY_MS[\s\S]*assertCurrentBodyInputGeneration\(inputGeneration\)[\s\S]*const\s+result\s*=\s*\{[\s\S]*faceSelection/,
    `${files.app}: Body detect timing must close before bounded Face wait and fence generation afterward`,
  );
  const faceMergeSource = sourceBetween(
    app,
    "function mergeCachedFaceIntoBodyFrame(",
    "function getLatestFramePump()",
  );
  check(
    faceMergeSource.includes("faceSelection") &&
      faceMergeSource.includes("faceSelection.observation") &&
      !faceMergeSource.includes("facePipeline.observations") &&
      !faceMergeSource.includes("faceMaturationWaitMs") &&
      !faceMergeSource.includes("faceMaturationWaited"),
    `${files.app}: avatar merge must use only the fixed selection and keep scheduling telemetry out of recordings`,
  );
  checkPattern(
    app,
    /mergeCachedFaceIntoBodyFrame\([\s\S]*result\.faceSelection[\s\S]*const\s+avatarStateApplied\s*=\s*processMotionFrame[\s\S]*if\s*\(applied\)[\s\S]*offerHandFrameAfterBody/,
    `${files.app}: fixed Face selection must reach actual avatar apply before Hand dispatch`,
  );
  checkPattern(
    app,
    /faceObservationMaturationLedger\.advanceGeneration\(inputGeneration\);\s*getFaceFramePump\(\)\.advanceGeneration\(reason\)[\s\S]*function\s+resetAppPerformance\([^)]*\)[\s\S]*faceObservationMaturationLedger\.resetTelemetry\(\)[\s\S]*function\s+getFaceTrackingStatus\([^)]*\)[\s\S]*maturation:\s*faceObservationMaturationLedger\.getStatus\(\)|function\s+getFaceTrackingStatus\([^)]*\)[\s\S]*const\s+maturation\s*=\s*faceObservationMaturationLedger\.getStatus\(\)[\s\S]*maturation,/,
    `${files.app}: generation, telemetry reset, and public status must share the ledger owner`,
  );
}

function checkBoundedFrameSnapshotContract(app, boundedFrameSnapshot) {
  const cases = [
    { input: [1920, 1080, 512], expected: [512, 288], label: "landscape" },
    { input: [1080, 1920, 512], expected: [288, 512], label: "portrait" },
    { input: [640, 640, 512], expected: [512, 512], label: "square" },
    { input: [320, 180, 512], expected: [320, 180], label: "no upscale" },
    { input: [641, 360, 512], expected: [512, 288], label: "bounded rounding" },
  ];

  for (const { input, expected, label } of cases) {
    const result = computeBoundedFrameSize(...input);
    check(
      result.width === expected[0] && result.height === expected[1],
      `${files.boundedFrameSnapshot}: ${label} size must be ${expected.join("x")}`,
    );
    check(
      Math.max(result.width, result.height) <= input[2],
      `${files.boundedFrameSnapshot}: ${label} must remain within its maximum dimension`,
    );
  }

  for (const input of [[0, 1080, 512], [1920, 0, 512], [1920, 1080, 0]]) {
    let rejected = false;
    try {
      computeBoundedFrameSize(...input);
    } catch (error) {
      rejected = error instanceof RangeError;
    }
    check(rejected, `${files.boundedFrameSnapshot}: invalid dimensions must fail closed`);
  }

  checkPattern(
    boundedFrameSnapshot,
    /function\s+computeBoundedFrameSize\([^)]*\)[\s\S]*Math\.min\(1,\s*limit\s*\/\s*Math\.max\(width,\s*height\)\)[\s\S]*Math\.round\(width\s*\*\s*scale\)[\s\S]*Math\.round\(height\s*\*\s*scale\)/,
    `${files.boundedFrameSnapshot}: bounded size helper must preserve aspect and forbid upscaling`,
  );

  const bodyCapture = sourceBetween(
    app,
    "function captureDetectionFrameSnapshot(video)",
    "function captureFaceDetectionFrameSnapshot(video)",
  );
  const faceCapture = sourceBetween(
    app,
    "function captureFaceDetectionFrameSnapshot(video)",
    "function supportsDetectionFrameSnapshot()",
  );
  const faceOffer = sourceBetween(
    app,
    "function offerFaceSnapshotForDetection(",
    "async function consumeFaceFrame(",
  );

  checkPattern(
    app,
    /const\s+MAX_INFERENCE_FRAME_DIMENSION\s*=\s*640;[\s\S]*const\s+FACE_MAX_INFERENCE_FRAME_DIMENSION\s*=\s*512;/,
    `${files.app}: body/Hand must remain 640px while Face is bounded to 512px`,
  );
  checkPattern(
    bodyCapture,
    /computeBoundedFrameSize\([\s\S]*MAX_INFERENCE_FRAME_DIMENSION[\s\S]*detectionSnapshotCanvas/,
    `${files.app}: body and Hand snapshots must retain their dedicated 640px canvas`,
  );
  checkPattern(
    faceCapture,
    /computeBoundedFrameSize\([\s\S]*FACE_MAX_INFERENCE_FRAME_DIMENSION[\s\S]*faceDetectionSnapshotCanvas[\s\S]*transferToImageBitmap/,
    `${files.app}: Face snapshots must use a distinct persistent bounded canvas`,
  );
  checkPattern(
    faceOffer,
    /frameSource\s*=\s*captureFaceDetectionFrameSnapshot\(state\.elements\.video\)[\s\S]*getFaceFramePump\(\)\.offer/,
    `${files.app}: only the Face pump must receive the bounded Face bitmap`,
  );
  check(
    !faceCapture.includes("detectionSnapshotCanvas") &&
      !bodyCapture.includes("faceDetectionSnapshotCanvas"),
    `${files.app}: Face and body/Hand snapshot canvases must not share ownership`,
  );
}

function checkBoundedMotionRecordingExportContract(
  app,
  motionFrame,
  agreementRunner,
) {
  checkPattern(
    motionFrame,
    /MOTION_RECORDING_JSONL_MAX_CHUNK_FRAMES\s*=\s*16[\s\S]*function\s+serializeMotionRecordingJsonlChunk\([^)]*[\s\S]*cursor[\s\S]*maxFrames[\s\S]*nextCursor[\s\S]*frameLines[\s\S]*done/,
    `${files.motionFrame}: JSONL export must use bounded monotonic frame chunks`,
  );
  checkPattern(
    motionFrame,
    /function\s+assertMotionRecordingChunkRange\([^)]*\)[\s\S]*Number\.isSafeInteger\(cursor\)[\s\S]*cursor\s*>\s*frameCount[\s\S]*maxFrames\s*>\s*MOTION_RECORDING_JSONL_MAX_CHUNK_FRAMES/,
    `${files.motionFrame}: chunk cursors and frame budgets must fail closed`,
  );
  checkPattern(
    app,
    /function\s+stopMotionRecording\(\{\s*returnRecording\s*=\s*true\s*\}\s*=\s*\{\}\)[\s\S]*lastRecording\s*=\s*buildCurrentMotionRecordingSnapshot\(\)[\s\S]*returnRecording\s*\?\s*getMotionRecording\(\)\s*:\s*getMotionRecordingStatus\(\)/,
    `${files.app}: recorder stop must preserve the full default API and expose an O(1) status path`,
  );
  checkPattern(
    app,
    /function\s+buildCurrentMotionRecordingSnapshot\([^)]*\)[\s\S]*version:\s*MOTION_RECORDING_VERSION[\s\S]*recordingId:[\s\S]*frames:\s*state\.motionRecording\.frames/,
    `${files.app}: fast stop must retain the already-serialized frame array without mapping it`,
  );
  checkPattern(
    app,
    /function\s+getMotionRecordingJsonlChunk\([^)]*\)[\s\S]*state\.motionRecording\.active[\s\S]*throw new Error\(["']Stop motion recording[\s\S]*recordingId:\s*recording\.recordingId[\s\S]*serializeMotionRecordingJsonlChunk/,
    `${files.app}: live chunk export must require a stopped, identity-stable recording`,
  );

  const completionIndex = agreementRunner.indexOf("const recording = shouldRecordMotion");
  const fastStopIndex = agreementRunner.indexOf(
    "stopMotionRecording?.({ returnRecording: false })",
  );
  const chunkReadIndex = agreementRunner.indexOf(
    "readMotionRecordingJsonlWithoutBlockingTracker(client, recording)",
  );
  const livePayloadIndex = agreementRunner.indexOf("const livePayload", chunkReadIndex);
  check(
    completionIndex >= 0 &&
      fastStopIndex > completionIndex &&
      chunkReadIndex > fastStopIndex &&
      livePayloadIndex > chunkReadIndex,
    `${files.avatarMotionAgreementScript}: measurement completion and report order must stay fixed around bounded export`,
  );
  checkPattern(
    agreementRunner,
    /function\s+readMotionRecordingJsonlWithoutBlockingTracker\([^)]*\)[\s\S]*getMotionRecordingJsonlChunk[\s\S]*const\s+maxFrames\s*=\s*16[\s\S]*chunk\.recordingId\s*!==\s*expectedRecordingId[\s\S]*chunk\.frameCount\s*!==\s*expectedFrameCount[\s\S]*chunk\.nextCursor\s*<=\s*cursor[\s\S]*chunks\.join\(["']["']\)/,
    `${files.avatarMotionAgreementScript}: runner must validate identity, frame count, and cursor progress for bounded chunks`,
  );
  checkPattern(
    agreementRunner,
    /if\s*\(!supportsChunkExport\)[\s\S]*getMotionRecordingJsonl\?\.\(\)[\s\S]*const\s+expectedRecordingId/,
    `${files.avatarMotionAgreementScript}: eager export may be used only when the chunk API is absent`,
  );
  checkPattern(
    agreementRunner,
    /const\s+recordingFrameCount\s*=\s*recording\?\.frameCount\s*\?\?\s*recording\?\.frames\?\.length/,
    `${files.avatarMotionAgreementScript}: replay checks must consume lightweight stop frameCount`,
  );
}

const [
  readme,
  packageSource,
  html,
  css,
  app,
  auxiliaryInferenceArbiter,
  faceObservationMaturation,
  boundedFrameSnapshot,
  avatarRenderer,
  faceHeadPose,
  retargetOrientation,
  handRetargeting,
  strictRetarget,
  depthCalibration,
  motionFrame,
  motionWorker,
  faceWorker,
  latestFramePump,
  trackingInputGeneration,
  videoPlaybackBackpressure,
  handWorker,
  motionForwarding,
  poseSolver,
  avatarMotionAgreementScript,
  syntheticGeneratorScript,
  validationCliScript,
  hmrJsonlAdapterScript,
  motionRecordingCompareScript,
  retargetModeCompareScript,
  samRegressionOracleScript,
  motionStatusHudSmokeScript,
  headPoseSmokeScript,
  rootYawRecoverySmokeScript,
  motionGoalAuditScript,
  vrmHumanoidMapping,
  vrmExpressionMapping,
  vrmRenderingCompat,
  clipFamilyManifestSource,
  avatarModelBytes,
  claudeSettings,
  claudeCodexCommand,
  claudeCodexScript,
] =
  await Promise.all([
    readProjectFile(files.readme),
    readProjectFile(files.packageJson),
    readProjectFile(files.html),
    readProjectFile(files.css),
    readProjectFile(files.app),
    readProjectFile(files.auxiliaryInferenceArbiter),
    readProjectFile(files.faceObservationMaturation),
    readProjectFile(files.boundedFrameSnapshot),
    readProjectFile(files.avatarRenderer),
    readProjectFile(files.faceHeadPose),
    readProjectFile(files.retargetOrientation),
    readProjectFile(files.handRetargeting),
    readProjectFile(files.strictRetarget),
    readProjectFile(files.depthCalibration),
    readProjectFile(files.motionFrame),
    readProjectFile(files.motionWorker),
    readProjectFile(files.faceWorker),
    readProjectFile(files.latestFramePump),
    readProjectFile(files.trackingInputGeneration),
    readProjectFile(files.videoPlaybackBackpressure),
    readProjectFile(files.handWorker),
    readProjectFile(files.motionForwarding),
    readProjectFile(files.poseSolver),
    readProjectFile(files.avatarMotionAgreementScript),
    readProjectFile(files.syntheticGeneratorScript),
    readProjectFile(files.validationCliScript),
    readProjectFile(files.hmrJsonlAdapterScript),
    readProjectFile(files.motionRecordingCompareScript),
    readProjectFile(files.retargetModeCompareScript),
    readProjectFile(files.samRegressionOracleScript),
    readProjectFile(files.motionStatusHudSmokeScript),
    readProjectFile(files.headPoseSmokeScript),
    readProjectFile(files.rootYawRecoverySmokeScript),
    readProjectFile(files.motionGoalAuditScript),
    readProjectFile(files.vrmHumanoidMapping),
    readProjectFile(files.vrmExpressionMapping),
    readProjectFile(files.vrmRenderingCompat),
    readProjectFile(files.clipFamilyManifest),
    readProjectBytes(files.avatarModel),
    readProjectFile(files.claudeSettings),
    readProjectFile(files.claudeCodexCommand),
    readProjectFile(files.claudeCodexScript),
  ]);

const packageJson = parseJson(files.packageJson, packageSource);
const clipFamilyManifest = parseJson(files.clipFamilyManifest, clipFamilyManifestSource);
const avatarModelJson = parseGlbJson(avatarModelBytes, files.avatarModel);

checkPackageContract(packageJson);
checkReadmeContract(readme);
checkHtmlContract(html);
checkRuntimeCacheContract(
  html,
  app,
  avatarRenderer,
  motionWorker,
  faceWorker,
  handWorker,
);
checkAuxiliaryInferenceArbiterContract(app, auxiliaryInferenceArbiter);
checkFaceObservationMaturationContract(app, faceObservationMaturation);
checkBoundedFrameSnapshotContract(app, boundedFrameSnapshot);
checkBoundedMotionRecordingExportContract(
  app,
  motionFrame,
  avatarMotionAgreementScript,
);
checkBodyTailHysteresisContract(
  app,
  latestFramePump,
  videoPlaybackBackpressure,
);
checkClaudeCodexBridge(claudeSettings, claudeCodexCommand, claudeCodexScript, readme);
checkTrackerAppContract(app);
checkAvatarAppContract(app);
checkAvatarRendererContract(avatarRenderer);
checkHandRetargetingContract(handRetargeting);
checkCssContract(css);
checkAvatarModelContract(avatarModelJson);
check(faceHeadPose.includes("readFaceTransformQuaternion"), `${files.faceHeadPose}: expected face transform quaternion reader`);
check(faceHeadPose.includes("analyzeFaceTransformMatrixLayout"), `${files.faceHeadPose}: expected transform matrix layout diagnostics`);
check(faceHeadPose.includes("updateFaceHeadPoseTracker"), `${files.faceHeadPose}: expected face head tracking lifecycle helper`);
check(faceHeadPose.includes("computeFaceHeadDelta"), `${files.faceHeadPose}: expected face head delta helper`);
check(retargetOrientation.includes("resolveHandPalmNormal"), `${files.retargetOrientation}: expected hand palm normal resolver`);
check(retargetOrientation.includes("resolveAvatarYawDeg"), `${files.retargetOrientation}: expected avatar yaw resolver`);
check(retargetOrientation.includes("DEFAULT_PALM_NORMAL_SIGNS"), `${files.retargetOrientation}: expected explicit palm normal signs`);
check(strictRetarget.includes("buildStrictRetargetFrame"), `${files.strictRetarget}: expected strict retarget frame builder`);
check(strictRetarget.includes("buildSourceAvatarDivergenceSummary"), `${files.strictRetarget}: expected source/avatar divergence summary builder`);
check(strictRetarget.includes("RETARGET_MODE_STRICT"), `${files.strictRetarget}: expected strict retarget mode constant`);
check(vrmHumanoidMapping.includes("parseVrmHumanoid"), `${files.vrmHumanoidMapping}: expected VRM humanoid parser`);
check(vrmHumanoidMapping.includes("createVrmHumanoidMapping"), `${files.vrmHumanoidMapping}: expected VRM humanoid mapper`);
check(vrmExpressionMapping.includes("parseVrmExpressionMetadata"), `${files.vrmExpressionMapping}: expected VRM expression parser`);
check(vrmExpressionMapping.includes("mapMediaPipeBlendShapesToVrmPresets"), `${files.vrmExpressionMapping}: expected MediaPipe blendshape mapper`);
check(vrmRenderingCompat.includes("describeVertexColorAlpha"), `${files.vrmRenderingCompat}: expected vertex color alpha diagnostics`);
check(depthCalibration.includes("solveDistalDepth"), `${files.depthCalibration}: expected depth solver`);
check(depthCalibration.includes("DEPTH_CALIBRATION_TARGET_SCORE"), `${files.depthCalibration}: expected depth calibration target`);
check(depthCalibration.includes("estimateCalibrationPoseQuality"), `${files.depthCalibration}: expected calibration pose quality helper`);
check(motionFrame.includes("createMotionFrame"), `${files.motionFrame}: expected motion frame factory`);
check(motionFrame.includes("createMotionRecording"), `${files.motionFrame}: expected motion recording factory`);
check(motionFrame.includes("serializeMotionRecordingJsonl"), `${files.motionFrame}: expected motion recording JSONL serializer`);
check(motionFrame.includes("serializeMotionRecordingJsonlChunk"), `${files.motionFrame}: expected bounded motion recording JSONL serializer`);
check(motionFrame.includes("parseMotionRecordingJsonl"), `${files.motionFrame}: expected motion recording JSONL parser`);
check(motionFrame.includes("normalizeExternalMotionRecording"), `${files.motionFrame}: expected external HMR recording normalizer`);
check(motionFrame.includes("isExternalMotionRecording"), `${files.motionFrame}: expected external HMR recording detector`);
check(motionFrame.includes("leftHandWorldLandmarks"), `${files.motionFrame}: expected hand world landmarks in motion frames`);
check(motionFrame.includes("extractFaceLandmarks"), `${files.motionFrame}: expected optional face landmark extraction`);
check(
  trackingInputGeneration.includes("createStatelessImageTrackerGenerationOwner"),
  `${files.trackingInputGeneration}: expected stateless IMAGE tracker generation owner`,
);
check(
  trackingInputGeneration.includes("createAtomicVideoTrackerGenerationOwner"),
  `${files.trackingInputGeneration}: expected atomic VIDEO tracker generation owner`,
);
check(
  /function\s+installConfigurationNow\([^)]*\)[\s\S]*Promise\.allSettled[\s\S]*currentEntries\s*=\s*candidates[\s\S]*closeEntries\(previousEntries\)/.test(trackingInputGeneration),
  `${files.trackingInputGeneration}: configuration changes must install one complete detector set atomically`,
);
check(
  /function\s+prepareNow\([^)]*\)[\s\S]*preparedGeneration\s*=\s*inputGeneration[\s\S]*["']stateless-rebind["']/.test(trackingInputGeneration) &&
    !/\.setOptions\s*\(/.test(trackingInputGeneration),
  `${files.trackingInputGeneration}: same-configuration IMAGE generations must rebind without detector recreation`,
);
check(
  /inputGeneration:\s*envelope\.generation/.test(app),
  `${files.app}: latest-frame envelope generation must cross the async detection boundary explicitly`,
);
check(
  /async\s+function\s+detectMotionFrameOnMainThread\([^)]*\)[\s\S]*assertCurrentBodyInputGeneration\s*\(\s*inputGeneration\s*\)[\s\S]*await\s+prepareBodyTrackerGeneration\s*\(\s*inputGeneration\s*,\s*\{\s*runtime:\s*["']main-thread["']\s*\}/.test(app),
  `${files.app}: main-thread detection must reject stale input before preparing a detector generation`,
);
check(
  /bodyTrackerGenerationMeta\s*=\s*await\s+prepareBodyTrackerGeneration\s*\(\s*inputGeneration\s*,\s*\{\s*runtime:\s*["']main-thread["']\s*\}[\s\S]*assertCurrentBodyInputGeneration\s*\(\s*inputGeneration\s*\)[\s\S]*poseLandmarker\.detectForVideo\(\s*frameSource,\s*frameTimestamp\s*,?\s*\)/.test(app),
  `${files.app}: main-thread Body detection must recheck generation and use VIDEO with the supplied monotonic timestamp`,
);
check(
  /function\s+detectFaceForVideo\([^)]*\)[\s\S]*faceLandmarker\.detect\(frameSource\)/.test(app) &&
    !/faceLandmarker\.detectForVideo\(/.test(app),
  `${files.app}: main-thread Face fallback must remain stateless IMAGE detection`,
);
check(motionWorker.includes("self.addEventListener"), `${files.motionWorker}: expected worker message listener`);
check(motionWorker.includes("PoseLandmarker"), `${files.motionWorker}: expected pose landmarker in worker`);
check(motionWorker.includes("createMotionFrame"), `${files.motionWorker}: expected worker to emit motion frames`);
check(/FilesetResolver\.forVisionTasks\s*\(\s*wasmAssetPath\s*,\s*true\s*\)/.test(motionWorker), `${files.motionWorker}: expected module-worker wasm fileset mode`);
check(motionWorker.includes("installMediaPipeModuleFactoryImportBridge"), `${files.motionWorker}: expected module-worker ModuleFactory import bridge`);
check(!motionWorker.includes("FaceLandmarker"), `${files.motionWorker}: body worker must not own Face inference`);
check(
  /function\s+prewarmPoseVideoDetector\([^)]*\)[\s\S]*new\s+OffscreenCanvas\([\s\S]*fillStyle\s*=\s*["']#000000["'][\s\S]*fillRect\([\s\S]*const\s+primeResult\s*=\s*poseLandmarker\.detectForVideo\(canvas,\s*0\)[\s\S]*primeResult\?\.landmarks\?\.length[\s\S]*primeResult\?\.worldLandmarks\?\.length[\s\S]*unexpectedly detected a pose/.test(motionWorker),
  `${files.motionWorker}: both Pose VIDEO slots must use a neutral worker-local OffscreenCanvas prime`,
);
check(!motionWorker.includes("getImageData"), `${files.motionWorker}: body worker must avoid synchronous CPU pixel readback`);
check(motionWorker.includes('bodyInputMode: "image-bitmap"'), `${files.motionWorker}: expected direct transferred ImageBitmap telemetry`);
check(
  /poseLandmarker\.detectForVideo\(imageBitmap,\s*timestamp\)[\s\S]*finally\s*\{[\s\S]*closeImageBitmap\(imageBitmap\)/.test(motionWorker),
  `${files.motionWorker}: Pose VIDEO detection must consume the bitmap and supplied timestamp, then close it`,
);
check(motionWorker.includes("fallbackReasons"), `${files.motionWorker}: expected worker delegate fallback reasons`);
check(motionWorker.includes("recordDetectorDelegateAttempt"), `${files.motionWorker}: expected worker delegate attempt telemetry`);
check(
  /messageTail\s*=\s*messageTail\.then/.test(motionWorker),
  `${files.motionWorker}: tracking worker messages must execute through one promise tail`,
);
check(
  /message\.type\s*===\s*["']prepare-generation["'][\s\S]*bodyTrackerGenerationOwner\.reserve\(message\.inputGeneration\)[\s\S]*messageTail\s*=\s*messageTail\.then/.test(motionWorker),
  `${files.motionWorker}: a newer generation must supersede in-progress candidates at message receipt time`,
);
check(
  /createPrewarmedVideoTrackerGenerationOwner\(\)[\s\S]*createInitialPoseDetectorPool\(nextConfiguration\)[\s\S]*bodyTrackerGenerationOwner\.installPrewarmedPool\s*\(\s*\{[\s\S]*poolSlots:\s*initialPoolSlots/.test(motionWorker) &&
    /createLandmarkerWithDelegate\(\s*["']pose["'][\s\S]*const\s+effectiveDelegate\s*=\s*detectorDelegates\.pose[\s\S]*createLandmarkerWithDelegate\(\s*["']poseStandby["'][\s\S]*effectiveDelegate,\s*\{\s*allowFallback:\s*false\s*\}/.test(motionWorker) &&
    /async\s+function\s+prepareGeneration\([^)]*\)[\s\S]*bodyTrackerGenerationOwner\.prepare\s*\(\s*\{[\s\S]*inputGeneration[\s\S]*configurationKey:\s*requestedConfigurationKey[\s\S]*detectorStateResets:\s*createPoseDetectorStateResets\(\)/.test(motionWorker),
  `${files.motionWorker}: worker Pose VIDEO generations must use two sequentially primed same-delegate slots with explicit fallback reset`,
);
check(
  /function\s+createPoseDetectorStateResets\([^)]*\)[\s\S]*id:\s*["']pose["'][\s\S]*setOptions\(\{\s*runningMode:\s*MEDIAPIPE_BODY_RESET_RUNNING_MODE[\s\S]*setOptions\(\{\s*runningMode:\s*MEDIAPIPE_BODY_RUNNING_MODE/.test(motionWorker) &&
    /function\s+createMainThreadPoseStateResets\([^)]*\)[\s\S]*id:\s*["']pose["'][\s\S]*setOptions\(\{\s*runningMode:\s*MEDIAPIPE_BODY_RESET_RUNNING_MODE[\s\S]*setOptions\(\{\s*runningMode:\s*MEDIAPIPE_BODY_RUNNING_MODE/.test(app),
  `${files.motionWorker}: worker fallback and unchanged main Body owner must reset only Pose through IMAGE then VIDEO setOptions`,
);
check(
  /export\s+function\s+createPrewarmedVideoTrackerGenerationOwner\([^)]*\)[\s\S]*requiredPoolSize\s*=\s*2/.test(trackingInputGeneration) &&
    trackingInputGeneration.includes('"prewarmed-clean-bind"') &&
    trackingInputGeneration.includes('"prewarmed-clean-swap"') &&
    trackingInputGeneration.includes('"synchronous-dirty-standby-reset"') &&
    /bodyTrackerPoolSize[\s\S]*bodyTrackerPoolPrimeDurationMs[\s\S]*bodyTrackerPrewarmedSwapCount[\s\S]*bodyTrackerDirtyLeaseCount[\s\S]*bodyTrackerFallbackResetCount/.test(trackingInputGeneration),
  `${files.trackingInputGeneration}: worker pool must expose clean-swap, bounded fallback, prime-cost, and dirty-lease telemetry`,
);
check(
  /message\.type\s*===\s*["']init["'][\s\S]*await\s+initModels\(message\)[\s\S]*type:\s*["']ready["'][\s\S]*bodyTrackerGenerationMeta:\s*bodyTrackerGenerationOwner\.getTelemetry\(\)/.test(motionWorker) &&
    /await\s+createInitialPoseDetectorPool\(nextConfiguration\)[\s\S]*installPrewarmedPool/.test(motionWorker) &&
    /function\s+prewarmPoseVideoDetector\([^)]*\)[\s\S]*detectForVideo\(canvas,\s*0\)[\s\S]*function\s+closePoseDetectorPool/.test(motionWorker) &&
    !/function\s+prewarmPoseVideoDetector\([^)]*\)[\s\S]*createMotionFrame/.test(motionWorker.slice(
      motionWorker.indexOf("function prewarmPoseVideoDetector"),
      motionWorker.indexOf("function closePoseDetectorPool"),
    )),
  `${files.motionWorker}: ready must follow both primes and the detector-local warmup timestamp must not enter MotionFrame telemetry`,
);
check(
  /currentConfigurationKey\s*===\s*requestedConfigurationKey[\s\S]*resetEntryState\(\s*currentEntries[\s\S]*strategy:\s*["']temporal-state-reset["']/.test(trackingInputGeneration) &&
    /Promise\.allSettled[\s\S]*resetEntryState\(\s*candidates[\s\S]*currentEntries\s*=\s*candidates[\s\S]*closeEntries\(oldEntries\)/.test(trackingInputGeneration),
  `${files.trackingInputGeneration}: same-config generations must reset in place while config changes reset and atomically commit a complete candidate set`,
);
check(
  /type:\s*["']result["'][\s\S]*inputGeneration:\s*message\.inputGeneration[\s\S]*configurationKey:\s*loadedConfigurationKey[\s\S]*frame/.test(motionWorker) &&
    /if\s*\(sourceMeta\?\.inputGeneration\s*!==\s*inputGeneration\)[\s\S]*if\s*\(!configurationKey\s*\|\|\s*configurationKey\s*!==\s*loadedConfigurationKey\)/.test(motionWorker),
  `${files.motionWorker}: result envelopes and detect requests must validate generation and configuration explicitly`,
);
check(faceWorker.includes("FaceLandmarker"), `${files.faceWorker}: expected independent Face landmarker`);
check(!faceWorker.includes("PoseLandmarker"), `${files.faceWorker}: Face worker must not own Pose inference`);
check(
  /const\s+MEDIAPIPE_FACE_PREFERRED_DELEGATE\s*=\s*["']CPU["'][\s\S]*postFaceWorkerRequest\(\s*["']init["'][\s\S]*delegate:\s*MEDIAPIPE_FACE_PREFERRED_DELEGATE/.test(app),
  `${files.app}: only the independent Face worker must explicitly prefer CPU`,
);
check(
  /function\s+prepareGeneration\(\{\s*inputGeneration\s*,\s*configurationKey\s*\}\s*=\s*\{\}\)[\s\S]*assertConfigurationKey\(configurationKey\)/.test(faceWorker) &&
    /type:\s*["']generation-ready["'][\s\S]*configurationKey:\s*loadedConfigurationKey/.test(faceWorker),
  `${files.faceWorker}: generation prepare must validate and echo the loaded configuration`,
);
check(
  /function\s+detectFaceFrame\(\{[\s\S]*sourcePtsSec[\s\S]*configurationKey[\s\S]*assertConfigurationKey\(configurationKey\)[\s\S]*requestSourcePtsSec[\s\S]*metadataSourcePtsSec[\s\S]*FACE_SOURCE_PTS_MISMATCH[\s\S]*configurationKey:\s*loadedConfigurationKey[\s\S]*sourcePtsSec:\s*requestSourcePtsSec/.test(faceWorker),
  `${files.faceWorker}: detect must validate and echo exact generation, configuration, and source PTS`,
);
check(
  /postFaceWorkerRequest\(\s*["']detect["'][\s\S]*sourcePtsSec:\s*envelope\.sourcePtsSec[\s\S]*configurationKey:\s*state\.faceWorker\.configurationKey/.test(app) &&
    /response\.configurationKey\s*!==\s*state\.faceWorker\.configurationKey[\s\S]*FACE_RESPONSE_MISMATCH/.test(app) &&
    /result\.configurationKey\s*!==\s*state\.faceWorker\.configurationKey[\s\S]*faceTrackerConfigurationKey[\s\S]*responseMetaSourcePtsSec/.test(app) &&
    /type:\s*["']result["'][\s\S]*inputGeneration:\s*result\.inputGeneration[\s\S]*configurationKey:\s*result\.configurationKey[\s\S]*sourcePtsSec:\s*result\.sourcePtsSec/.test(faceWorker),
  `${files.app}: Face requests and cache insertion must fence configuration and both PTS envelopes`,
);
check(
  /catch\s*\(error\)\s*\{\s*if\s*\(\s*managedByLatestFramePump\s*&&\s*inputGeneration\s*!==\s*getLatestFramePump\(\)\.getGeneration\(\)\s*&&\s*isBodyInputGenerationTransitionError\(error\)[\s\S]*return\s+null;[\s\S]*state\.detectionPump\.errors\s*\+=\s*1/.test(app),
  `${files.app}: only superseded managed-generation exceptions may bypass runtime error accounting`,
);
check(
  /function\s+disposeTrackingWorker\([^)]*\)[\s\S]*const\s+worker\s*=\s*state\.trackingWorker\.worker[\s\S]*state\.trackingWorker\.worker\s*=\s*null[\s\S]*closeDetachedTrackingWorker\(worker/.test(app) &&
    /function\s+closeDetachedTrackingWorker\([^)]*\)[\s\S]*removeEventListener\(\s*["']message["']\s*,\s*handleTrackingWorkerMessage\s*\)[\s\S]*message\.type\s*===\s*["']closed["'][\s\S]*TRACKING_WORKER_CLOSE_TIMEOUT_MS[\s\S]*worker\.postMessage\(\{\s*type:\s*["']close["']/.test(app),
  `${files.app}: detached Body workers must close by ACK or timeout before termination`,
);
check(
  /function\s+disposeTrackingWorker\([^)]*\)[\s\S]*resetBodyTrackerPoolTelemetry\(\)/.test(app) &&
    /function\s+resetBodyTrackerPoolTelemetry\([^)]*\)[\s\S]*poolSize\s*=\s*0[\s\S]*poolPrewarmedCount\s*=\s*0[\s\S]*poolPrimeDurationMs\s*=\s*0[\s\S]*prewarmedSwapCount\s*=\s*0[\s\S]*dirtyLeaseCount\s*=\s*0[\s\S]*fallbackResetCount\s*=\s*0[\s\S]*poolStrategy\s*=\s*["']["']/.test(app),
  `${files.app}: leaving the Body worker runtime must clear worker-only pool telemetry`,
);
check(
  /function\s+closeDetachedFaceWorker\([^)]*\)[\s\S]*message\.type\s*===\s*["']closed["'][\s\S]*FACE_WORKER_CLOSE_TIMEOUT_MS[\s\S]*worker\.postMessage\(\{\s*type:\s*["']close["']/.test(app) &&
    /state\.faceWorker\.worker\s*!==\s*worker[\s\S]*state\.faceWorker\.lifecycleEpoch\s*!==\s*lifecycleEpoch/.test(app),
  `${files.app}: detached Face workers must close by ACK or timeout without failing a replacement worker`,
);
check(
  /const\s+FACE_DETECTION_RATE_HZ\s*=\s*10[\s\S]*const\s+FACE_OBSERVATION_DELAY_MS\s*=\s*1000\s*\/\s*30[\s\S]*const\s+FACE_OBSERVATION_MAX_AGE_MS\s*=\s*150/.test(app),
  `${files.app}: fixed Face work must use a one-frame causal window at 10 Hz without loosening max age`,
);
check(
  /const\s+accepted\s*=\s*getLatestFramePump\(\)\.offer\(bodyEnvelope\)[\s\S]*if\s*\(accepted\)[\s\S]*offerFaceSnapshotForDetection\(\{/.test(app) &&
    /if\s*\(\s*!bodyAdmission\.shouldAdmit\s*\)[\s\S]*bodyAdmission\.reason\s*===\s*["']rate-budget["'][\s\S]*bodyCadenceSkips\s*\+=\s*1[\s\S]*offerFaceSnapshotForDetection\(\{[\s\S]*return;/.test(app) &&
    /function\s+clearFaceObservationState\([^)]*\)[\s\S]*lastAdmittedSlotIndex\s*=\s*null[\s\S]*function\s+offerFaceSnapshotForDetection\([^)]*\)[\s\S]*decideSourcePtsSlotAdmission\(\{[\s\S]*lastAdmittedSlotIndex:\s*state\.facePipeline\.lastAdmittedSlotIndex[\s\S]*maxRateHz:\s*FACE_DETECTION_RATE_HZ[\s\S]*state\.facePipeline\.lastAdmittedSlotIndex\s*=\s*admission\.slotIndex[\s\S]*getFaceFramePump\(\)\.offer/.test(app) &&
    !app.includes("faceFrameEnvelope"),
  `${files.app}: Face inference must consume generation-reset fixed source slots even when body intentionally downsamples`,
);
check(
  !/function\s+resetAppPerformance\([^)]*\)[\s\S]*clearFaceObservationState\(\)[\s\S]*function\s+recordDetectionCallback/.test(app),
  `${files.app}: resetting telemetry must not reset causal Face observations or source-slot phase`,
);
check(
  /function\s+postFaceWorkerRequest\([^)]*\)[\s\S]*const\s+request\s*=\s*new\s+Promise[\s\S]*worker\.postMessage\([^;]+;[\s\S]*catch\s*\(error\)[\s\S]*throw\s+error;[\s\S]*return\s+request;/.test(app) &&
    /let\s+transferred\s*=\s*false[\s\S]*postFaceWorkerRequest\([\s\S]*transferred\s*=\s*true[\s\S]*if\s*\(!transferred\)[\s\S]*closeDetectionFrameSource\(imageBitmap\)/.test(app),
  `${files.app}: synchronous Face postMessage failure must preserve bitmap ownership for caller cleanup`,
);
check(
  /async\s+function\s+detectMotionFrameInWorker\([^)]*\)[\s\S]*await\s+prepareBodyTrackerGeneration\s*\(\s*inputGeneration\s*,\s*\{\s*runtime:\s*["']worker["']\s*\}[\s\S]*createImageBitmap\(frameSource\)[\s\S]*postTrackingWorkerRequest\(\s*["']detect["']/.test(app),
  `${files.app}: worker generation prepare must finish before bitmap creation and transfer`,
);
check(
  /await\s+nominateVideoGenerationBoundary\(\s*["']video-start["']\s*,\s*\{\s*resumeAfterApply:\s*true[\s\S]*scheduleDetectionFrame\(\)/.test(app) &&
    /function\s+releaseActive\([^)]*\)[\s\S]*const\s+shouldResume\s*=\s*Boolean\([\s\S]*resume\s*&&[\s\S]*releasedGate\.wasPlaying\s*&&[\s\S]*!releasedGate\.boundaryOwned\s*\|\|\s*applied/.test(trackingInputGeneration),
  `${files.app}: video start must carry playback intent through the frozen boundary and resume only on gate release`,
);
check(
  /const\s+bodyGenerationPreparations\s*=\s*new\s+Map\(\)[\s\S]*function\s+prepareBodyTrackerGeneration\([^)]*\)[\s\S]*bodyGenerationPreparations\.get\(preparationKey\)[\s\S]*bodyGenerationPreparations\.set\(preparationKey,\s*preparation\)/.test(app) &&
    /function\s+advanceDetectionGeneration\([^)]*\)[\s\S]*bodyGenerationPreparations\.clear\(\)/.test(app),
  `${files.app}: one cached preparation outcome must own each generation/runtime/configuration and only generation advance may supersede it`,
);
check(
  /async\s+function\s+nominateVideoGenerationBoundary\([^)]*\)[\s\S]*await\s+prepareBodyTrackerGeneration\(inputGeneration\)[\s\S]*const\s+callbackReceivedAt[\s\S]*buildDetectionSourceTiming\([\s\S]*captureDetectionFrameSnapshot\(video\)/.test(app),
  `${files.app}: boundary preparation must finish before source timing construction and snapshot capture`,
);
check(
  /async\s+function\s+handleVideoBoundarySeeking\([^)]*\)[\s\S]*await\s+prepareBodyTrackerGeneration\(boundaryInputGeneration\)/.test(app) &&
    /async\s+function\s+handleVideoBoundarySeeked\([^)]*\)[\s\S]*await\s+nominateVideoGenerationBoundary\(\s*["']seek["']\s*\)/.test(app) &&
    /async\s+function\s+completeDetectionConfigurationGeneration\([^)]*\)[\s\S]*await\s+nominateVideoGenerationBoundary\(transition\.reason\)/.test(app),
  `${files.app}: seek and active configuration boundaries must await the shared preparation before nomination`,
);
check(
  /function\s+offerFrameForDetection\([^)]*\)[\s\S]*rewindSourcePtsSec\s*=\s*resolveDetectionSourcePts\([\s\S]*shouldPromoteVideoRewindAtProducer\(rewindSourcePtsSec\)[\s\S]*nominateVideoGenerationBoundary\(\s*["']rewind["']\s*,\s*\{[\s\S]*timestamp:\s*callbackTimestamp[\s\S]*callbackReceivedAt[\s\S]*videoFrameMetadata:\s*metadata[\s\S]*\}\)[\s\S]*const\s+sourceTiming\s*=\s*buildDetectionSourceTiming/.test(app) &&
    !/nominateVideoGenerationBoundary\(\s*["']rewind["']\s*,\s*\{[^}]*sourceTiming\s*[,}]/.test(app),
  `${files.app}: rewind must preserve original callback timing while deferring generation source timing until preparation`,
);
check(
  !/createPoseDetectorStateResets\([^)]*\)[\s\S]*\.(?:detect|detectForVideo)\s*\(/.test(motionWorker.slice(
    motionWorker.indexOf("function createPoseDetectorStateResets"),
    motionWorker.indexOf("async function createInitialPoseDetectorPool"),
  )) &&
    !/createMainThreadPoseStateResets\([^)]*\)[\s\S]*\.(?:detect|detectForVideo)\s*\(/.test(app.slice(
      app.indexOf("function createMainThreadPoseStateResets"),
      app.indexOf("async function createMainThreadDetectorSet"),
    )),
  `${files.app}: Body state reset must not run seed, dummy, or discarded inference`,
);
check(
  /const\s+inputGeneration\s*=\s*getLatestFramePump\(\)\.advanceGeneration\(reason\)[\s\S]*mainThreadBodyTrackerGenerationOwner\.reserve\(inputGeneration\)[\s\S]*reserveTrackingWorkerGeneration\(inputGeneration\)/.test(app),
  `${files.app}: generation advance must supersede main and worker candidates synchronously`,
);
check(
  /avatarReady:\s*false[\s\S]*state\.avatarRenderer[\s\S]*\.init\(\)[\s\S]*state\.avatarReady\s*=\s*Boolean\([\s\S]*getModelDiagnostics\?\.\(\)\?\.ready/.test(app) &&
    /function\s+processMotionFrame\([^)]*\)[\s\S]*const\s+avatarStateApplied\s*=\s*presence\.shouldUpdateAvatar[\s\S]*:\s*state\.avatarReady/.test(app) &&
    /function\s+applyDetectionFrameResult\([^)]*\)[\s\S]*const\s+avatarStateApplied\s*=\s*processMotionFrame\([\s\S]*if\s*\(\s*!avatarStateApplied\s*\)[\s\S]*playbackGateMeta\?\.bodyTrackerPlaybackGated[\s\S]*return\s+false;[\s\S]*state\.detectionPump\.outputFrames\s*\+=\s*1[\s\S]*applied\s*=\s*true[\s\S]*if\s*\(applied\)[\s\S]*offerHandFrameAfterBody/.test(app),
  `${files.app}: output accounting, playback completion, and Hand dispatch must depend on accepted actual avatar state`,
);
check(
  /function\s+updateAvatarRendererFromMotionFrame\([^)]*\)[\s\S]*avatarRenderer\.update\([\s\S]*getAppliedAvatarStateSnapshot\?\.\(\)[\s\S]*matchingAppliedAvatarState\(motionFrame,\s*appliedAvatarState\)/.test(app),
  `${files.app}: an avatar update must verify a captured state with the same source PTS`,
);
check(
  /async\s+function\s+setFaceTrackingEnabled\([^)]*\)[\s\S]*beginDetectionConfigurationGeneration\(["']face-tracking-change["']\)[\s\S]*await\s+ensureModelsLoaded\(\)[\s\S]*completeDetectionConfigurationGeneration\(transition\)/.test(app),
  `${files.app}: active face reconfiguration must freeze and advance before worker init`,
);
check(
  /function\s+beginDetectionConfigurationGeneration\([^)]*\)[\s\S]*preservePlaybackGate[\s\S]*bodyTrackerPlaybackGate\.reserveBoundary[\s\S]*function\s+completeDetectionConfigurationGeneration\([^)]*\)[\s\S]*nominateVideoGenerationBoundary/.test(app),
  `${files.app}: active video configuration changes must transfer the exact boundary atomically`,
);
check(
  /if\s*\(state\.inputKind\s*===\s*["']video["']\)\s*\{\s*bodyTrackerPlaybackGate\.begin/.test(app),
  `${files.app}: detector generation gating must never pause a live camera element`,
);
check(
  /video\?\.\s*addEventListener\(\s*["']play["']\s*,\s*handleVideoPlayWhileGenerationGated\s*\)[\s\S]*function\s+handleVideoPlayWhileGenerationGated\([^)]*\)[\s\S]*bodyTrackerPlaybackGate\.getStatus\(\)\.bodyTrackerPlaybackGateActive[\s\S]*bodyTrackerPlaybackGate\.requestResume[\s\S]*event\.currentTarget\?\.pause/.test(app),
  `${files.app}: external play calls must not bypass a frozen input generation`,
);
check(
  /bodyTrackerResetCount[\s\S]*bodyTrackerResetDetectors[\s\S]*bodyTrackerResetDurationMs[\s\S]*bodyTrackerSeededDetectors/.test(trackingInputGeneration),
  `${files.trackingInputGeneration}: reset provenance metadata must remain complete`,
);
check(
  /bodyTrackerResetDetectors:\s*detectorIdsToWireValue[\s\S]*bodyTrackerSeededDetectors:\s*detectorIdsToWireValue/.test(trackingInputGeneration) &&
    /function\s+parseBodyTrackerDetectorWireValue/.test(app),
  `${files.trackingInputGeneration}: detector provenance must use primitive wire values parsed by the app`,
);
check(handWorker.includes("self.addEventListener"), `${files.handWorker}: expected worker message listener`);
check(handWorker.includes("HandLandmarker"), `${files.handWorker}: expected hand landmarker in independent worker`);
check(handWorker.includes("createMotionFrame"), `${files.handWorker}: expected hand worker to emit fixed-side motion frames`);
check(/HAND_LANDMARKER_RUNNING_MODE\s*=\s*["']IMAGE["']/.test(handWorker), `${files.handWorker}: pose-guided moving crops must use stateless IMAGE detection`);
check(/FilesetResolver\.forVisionTasks\s*\(\s*wasmAssetPath\s*,\s*true\s*\)/.test(handWorker), `${files.handWorker}: expected module-worker wasm fileset mode`);
check(handWorker.includes("installMediaPipeModuleFactoryImportBridge"), `${files.handWorker}: expected module-worker ModuleFactory import bridge`);
check(handWorker.includes("OffscreenCanvas"), `${files.handWorker}: expected transferred frames to use OffscreenCanvas`);
check(!handWorker.includes("getImageData"), `${files.handWorker}: hand worker must avoid synchronous CPU pixel readback`);
check(handWorker.includes("buildPoseGuidedHandRois"), `${files.handWorker}: expected pose-guided hand ROI input`);
check(handWorker.includes("mapSquareHandLandmarksToSource"), `${files.handWorker}: expected full-square ROI landmarks to map back to source coordinates`);
check(/\bworkerSide\b/.test(handWorker), `${files.handWorker}: side protocol init must accept workerSide`);
check(/\brequestedSide\b/.test(handWorker), `${files.handWorker}: side protocol detect must accept requestedSide`);
check(/\bhandWorkerSide\b/.test(handWorker), `${files.handWorker}: every side protocol response must expose handWorkerSide`);
check(
  /sourceMeta[\s\S]*handWorkerSide|handWorkerSide[\s\S]*sourceMeta/.test(handWorker),
  `${files.handWorker}: side detection source metadata must expose handWorkerSide provenance`,
);
check(motionForwarding.includes("createMotionForwarder"), `${files.motionForwarding}: expected motion forwarding client`);
check(motionForwarding.includes("action-tracker-motion-frame"), `${files.motionForwarding}: expected stable forwarding payload type`);
check(poseSolver.includes("solveHinges"), `${files.poseSolver}: expected hinge metric solver`);
check(poseSolver.includes("hingeViolations"), `${files.poseSolver}: expected hinge violation reporting`);
check(poseSolver.includes("estimateTrackingMode"), `${files.poseSolver}: expected upper-body mode estimator`);
check(avatarMotionAgreementScript.includes("--tracking-worker"), `${files.avatarMotionAgreementScript}: expected tracking worker query flag support`);
check(avatarMotionAgreementScript.includes('"tracking-worker"'), `${files.avatarMotionAgreementScript}: expected tracking-worker URL parameter`);
check(avatarMotionAgreementScript.includes("getBodyValidationProgress"), `${files.avatarMotionAgreementScript}: runtime completion polling must use the bounded validation progress snapshot`);
check(avatarMotionAgreementScript.includes("trackingWorkerRequested"), `${files.avatarMotionAgreementScript}: expected tracking worker requested summary field`);
check(avatarMotionAgreementScript.includes("trackingWorkerFallbackReason"), `${files.avatarMotionAgreementScript}: expected tracking worker fallback reason summary field`);
check(avatarMotionAgreementScript.includes("--smoothing"), `${files.avatarMotionAgreementScript}: expected smoothing query flag support`);
check(avatarMotionAgreementScript.includes('"smoothing"'), `${files.avatarMotionAgreementScript}: expected smoothing URL parameter`);
check(avatarMotionAgreementScript.includes("avatarSmoothingMode"), `${files.avatarMotionAgreementScript}: expected smoothing summary field`);
check(avatarMotionAgreementScript.includes("--avatar-retarget"), `${files.avatarMotionAgreementScript}: expected avatar retarget query flag support`);
check(avatarMotionAgreementScript.includes('"avatar-retarget"'), `${files.avatarMotionAgreementScript}: expected avatar-retarget URL parameter`);
check(avatarMotionAgreementScript.includes("avatarRetargetMode"), `${files.avatarMotionAgreementScript}: expected avatar retarget summary field`);
check(avatarMotionAgreementScript.includes("--delegate"), `${files.avatarMotionAgreementScript}: expected delegate query flag support`);
check(avatarMotionAgreementScript.includes("normalizeDelegateArg"), `${files.avatarMotionAgreementScript}: expected delegate normalization`);
check(avatarMotionAgreementScript.includes("detectorDelegateAttempts"), `${files.avatarMotionAgreementScript}: expected delegate attempt summary field`);
check(avatarMotionAgreementScript.includes("detectorDelegateFallbackReasons"), `${files.avatarMotionAgreementScript}: expected delegate fallback reason summary field`);
check(avatarMotionAgreementScript.includes("pumpStaleFrameCallbacks"), `${files.avatarMotionAgreementScript}: expected stale callback summary field`);
check(avatarMotionAgreementScript.includes("poseSolverHingeViolationFrames"), `${files.avatarMotionAgreementScript}: expected aggregate hinge violation summary field`);
check(/if\s*\(\s*keyframeLabels\.length\s*===\s*0\s*\)\s*\{[\s\S]*?await\s+waitForExpression/.test(avatarMotionAgreementScript), `${files.avatarMotionAgreementScript}: expected measurement-only runs to wait for minimum pose frames`);
check(syntheticGeneratorScript.includes("left-elbow-flex"), `${files.syntheticGeneratorScript}: expected elbow flex synthetic scenario`);
check(syntheticGeneratorScript.includes("left-wrist-occlusion"), `${files.syntheticGeneratorScript}: expected wrist occlusion synthetic scenario`);
check(validationCliScript.includes("buildSyntheticMetrics"), `${files.validationCliScript}: expected synthetic metric summary`);
check(validationCliScript.includes("maxReliableTargetAngularVelocityDegPerSec"), `${files.validationCliScript}: expected synthetic target angular velocity metric`);
check(validationCliScript.includes("jitterRmsDegPerSec"), `${files.validationCliScript}: expected synthetic jitter RMS metric`);
check(validationCliScript.includes("maxReliableOcclusionSpikeCount"), `${files.validationCliScript}: expected reliable occlusion spike metric`);
check(validationCliScript.includes("maxModeChatterEvents"), `${files.validationCliScript}: expected mode chatter metric`);
check(validationCliScript.includes("buildSyntheticQualityGates"), `${files.validationCliScript}: expected synthetic quality gates`);
check(validationCliScript.includes("buildAgreementMetrics"), `${files.validationCliScript}: expected agreement metric summary`);
check(validationCliScript.includes("buildAgreementQualityGates"), `${files.validationCliScript}: expected agreement quality gates`);
check(validationCliScript.includes("validateClipManifest"), `${files.validationCliScript}: expected clip manifest schema validation`);
check(validationCliScript.includes("validateClipLabels"), `${files.validationCliScript}: expected clip label schema validation`);
check(validationCliScript.includes("CLIP_LABEL_SCHEMA"), `${files.validationCliScript}: expected typed clip label schema`);
check(validationCliScript.includes("missingScenarioIds"), `${files.validationCliScript}: expected clip scenario coverage reporting`);
check(validationCliScript.includes("labels missing required label"), `${files.validationCliScript}: expected clip required label validation`);
check(validationCliScript.includes("clipPathExists"), `${files.validationCliScript}: expected clip path existence validation`);
check(hmrJsonlAdapterScript.includes("normalizeExternalMotionRecording"), `${files.hmrJsonlAdapterScript}: expected external HMR recording validation`);
check(hmrJsonlAdapterScript.includes("serializeMotionRecordingJsonl"), `${files.hmrJsonlAdapterScript}: expected external HMR JSONL serialization`);
check(hmrJsonlAdapterScript.includes("parseMotionRecordingJsonl"), `${files.hmrJsonlAdapterScript}: expected JSONL input support`);
check(hmrJsonlAdapterScript.includes("convertJointArrayRecording"), `${files.hmrJsonlAdapterScript}: expected generic HMR joint-array conversion`);
check(hmrJsonlAdapterScript.includes("COCO17_TO_MEDIAPIPE33"), `${files.hmrJsonlAdapterScript}: expected coco17 to MediaPipe 33 mapping`);
check(hmrJsonlAdapterScript.includes("--joint-format"), `${files.hmrJsonlAdapterScript}: expected joint format CLI option`);
check(motionRecordingCompareScript.includes("compareRecordings"), `${files.motionRecordingCompareScript}: expected live/offline comparison function`);
check(motionRecordingCompareScript.includes("solvePoseFrame"), `${files.motionRecordingCompareScript}: expected solver-backed comparison`);
check(motionRecordingCompareScript.includes("targetAngle"), `${files.motionRecordingCompareScript}: expected target angle delta summary`);
check(motionRecordingCompareScript.includes("hingeFlex"), `${files.motionRecordingCompareScript}: expected hinge flexion delta summary`);
check(motionRecordingCompareScript.includes("renderComparisonHtml"), `${files.motionRecordingCompareScript}: expected static HTML comparison report renderer`);
check(motionRecordingCompareScript.includes("--html"), `${files.motionRecordingCompareScript}: expected HTML output option`);
check(retargetModeCompareScript.includes("compareRetargetReports"), `${files.retargetModeCompareScript}: expected retarget report comparison function`);
check(retargetModeCompareScript.includes("renderRetargetComparisonHtml"), `${files.retargetModeCompareScript}: expected retarget comparison HTML renderer`);
check(retargetModeCompareScript.includes("strictImprovedAngularP90"), `${files.retargetModeCompareScript}: expected strict angular improvement summary`);
check(retargetModeCompareScript.includes("strictImprovedAngularMax"), `${files.retargetModeCompareScript}: expected strict angular max improvement summary`);
check(retargetModeCompareScript.includes("strictImprovedPalmInversion"), `${files.retargetModeCompareScript}: expected strict palm improvement summary`);
check(retargetModeCompareScript.includes("strictImprovedRootYaw"), `${files.retargetModeCompareScript}: expected strict root yaw improvement summary`);
check(samRegressionOracleScript.includes("evaluateSamRegressionOracle"), `${files.samRegressionOracleScript}: expected SAM oracle evaluator`);
check(samRegressionOracleScript.includes("minPairedRatio"), `${files.samRegressionOracleScript}: expected paired-ratio regression threshold`);
check(samRegressionOracleScript.includes("maxOcclusionArmP95Deg"), `${files.samRegressionOracleScript}: expected occlusion-window arm threshold`);
check(samRegressionOracleScript.includes("--max-target-p95-deg"), `${files.samRegressionOracleScript}: expected configurable target p95 threshold`);
check(motionStatusHudSmokeScript.includes("getMotionStatusHudSnapshot"), `${files.motionStatusHudSmokeScript}: expected Motion State HUD snapshot validation`);
check(motionStatusHudSmokeScript.includes("#avatar-face-status"), `${files.motionStatusHudSmokeScript}: expected avatar face status DOM validation`);
check(motionStatusHudSmokeScript.includes("#avatar-expression-status"), `${files.motionStatusHudSmokeScript}: expected avatar expression status DOM validation`);
check(motionStatusHudSmokeScript.includes("#motion-status-calibration-guide"), `${files.motionStatusHudSmokeScript}: expected calibration guide DOM validation`);
check(motionStatusHudSmokeScript.includes("#motion-status-calibrate"), `${files.motionStatusHudSmokeScript}: expected calibration action DOM validation`);
check(motionStatusHudSmokeScript.includes("resetCalibrationThroughHud"), `${files.motionStatusHudSmokeScript}: expected calibration reset smoke flow`);
check(motionStatusHudSmokeScript.includes("DOM.setFileInputFiles"), `${files.motionStatusHudSmokeScript}: expected video file upload through Chrome DevTools`);
check(motionStatusHudSmokeScript.includes("Page.captureScreenshot"), `${files.motionStatusHudSmokeScript}: expected HUD screenshot capture`);
check(headPoseSmokeScript.includes("avatar-motion-agreement-check.mjs"), `${files.headPoseSmokeScript}: expected browser motion agreement runner reuse`);
check(headPoseSmokeScript.includes("faceHeadPose"), `${files.headPoseSmokeScript}: expected face head pose report gate`);
check(headPoseSmokeScript.includes("yawCorrelation"), `${files.headPoseSmokeScript}: expected yaw correlation gate`);
check(headPoseSmokeScript.includes("headRestForwardDot"), `${files.headPoseSmokeScript}: expected rest forward diagnostics gate`);
check(rootYawRecoverySmokeScript.includes("avatar-motion-agreement-check.mjs"), `${files.rootYawRecoverySmokeScript}: expected browser motion agreement runner reuse`);
check(rootYawRecoverySmokeScript.includes("parseMotionRecordingJsonl"), `${files.rootYawRecoverySmokeScript}: expected recording replay analysis`);
check(rootYawRecoverySmokeScript.includes("facingRecoveringFromUnreliableYaw"), `${files.rootYawRecoverySmokeScript}: expected root yaw recovery gate`);
check(rootYawRecoverySmokeScript.includes("sourceAvatarDivergence"), `${files.rootYawRecoverySmokeScript}: expected avatar root yaw report gate`);
check(motionGoalAuditScript.includes("passed_with_external_blockers"), `${files.motionGoalAuditScript}: expected external blocker audit status`);
check(motionGoalAuditScript.includes("validateClipManifest"), `${files.motionGoalAuditScript}: expected clip manifest validation reuse`);
check(motionGoalAuditScript.includes("P0.2.gpu-delegate-telemetry"), `${files.motionGoalAuditScript}: expected GPU delegate telemetry audit`);
check(motionGoalAuditScript.includes("P2.2.real-clip-missing"), `${files.motionGoalAuditScript}: expected real clip blocker audit`);
check(
  Array.isArray(clipFamilyManifest?.scenarios) && clipFamilyManifest.scenarios.length >= 7,
  `${files.clipFamilyManifest}: expected at least 7 labeled clip scenarios`,
);
check(
  Array.isArray(clipFamilyManifest?.clips),
  `${files.clipFamilyManifest}: expected clips array`,
);
checkSyntax(files.app);
checkSyntax(files.auxiliaryInferenceArbiter);
checkSyntax(files.faceObservationMaturation);
checkSyntax(files.boundedFrameSnapshot);
checkSyntax(files.avatarRenderer);
checkSyntax(files.faceHeadPose);
checkSyntax(files.retargetOrientation);
checkSyntax(files.handRetargeting);
checkSyntax(files.strictRetarget);
checkSyntax(files.depthCalibration);
checkSyntax(files.motionFrame);
checkSyntax(files.motionWorker);
checkSyntax(files.faceWorker);
checkSyntax(files.handWorker);
checkSyntax(files.latestFramePump);
checkSyntax(files.motionForwarding);
checkSyntax(files.presenceState);
checkSyntax(files.manualLabels);
checkSyntax(files.gestureClassifier);
checkSyntax(files.poseSolver);
checkSyntax(files.mhr70Hands);
checkSyntax(files.avatarMotionAgreementScript);
checkSyntax(files.framePumpPerformanceScript);
checkSyntax(files.syntheticGeneratorScript);
checkSyntax(files.validationCliScript);
checkSyntax(files.hmrJsonlAdapterScript);
checkSyntax(files.motionRecordingCompareScript);
checkSyntax(files.retargetModeCompareScript);
checkSyntax(files.samManualLabelsScript);
checkSyntax(files.samReferenceLabelerScript);
checkSyntax(files.samRegressionOracleScript);
checkSyntax(files.motionStatusHudSmokeScript);
checkSyntax(files.headPoseSmokeScript);
checkSyntax(files.rootYawRecoverySmokeScript);
checkSyntax(files.motionGoalAuditScript);
checkSyntax(files.vrmHumanoidMapping);
checkSyntax(files.vrmExpressionMapping);
checkSyntax(files.vrmRenderingCompat);
checkSyntax(files.avatarPerformanceScript);
checkSyntax(files.avatarVrmPerformanceScript);
checkSyntax(files.avatarVrmRenderingCompatCheck);
checkSyntax(files.avatarVrmHumanoidCheck);
checkSyntax(files.avatarVrmExpressionCheck);
checkSyntax(files.retargetOrientationCheck);
checkSyntax(files.faceHeadPoseCheck);
checkSyntax(files.strictRetargetCheck);
checkSyntax(files.depthCalibrationCheck);
checkSyntax(files.motionFrameCheck);
checkSyntax(files.motionForwardingCheck);
checkSyntax(files.presenceStateCheck);
checkSyntax(files.facingEstimatorCheck);
checkSyntax(files.solverSyntheticCheck);
checkSyntax(files.samManualLabelsCheck);
checkSyntax(files.motionRecordingCompareCheck);
checkSyntax(files.retargetModeCompareCheck);
checkSyntax(files.mhr70MappingCheck);
checkSyntax(files.mhr70HandsCheck);
checkSyntax(files.gestureClassifierCheck);
checkSyntax(files.samReferenceLabelerCheck);
checkSyntax(files.samRegressionOracleCheck);
checkSyntax(files.hmrJsonlAdapterCheck);
checkSyntax(files.clipManifestCheck);
checkSyntax(files.trackingInputGeneration);
checkSyntax(files.trackingInputGenerationCheck);
checkSyntax(files.videoPlaybackBackpressure);

if (failures.length > 0) {
  console.error(`Contract check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Contract check passed.");
