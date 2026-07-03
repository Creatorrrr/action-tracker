#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

const files = {
  readme: "README.md",
  packageJson: "package.json",
  html: "index.html",
  css: "styles.css",
  app: "src/app.js",
  avatarRenderer: "src/avatar-renderer.js",
  depthCalibration: "src/depth-calibration.js",
  motionFrame: "src/motion-frame.js",
  motionWorker: "src/motion-worker.js",
  motionForwarding: "src/motion-forwarding.js",
  poseSolver: "src/solver/pose-solver.js",
  vrmHumanoidMapping: "src/vrm-humanoid-mapping.js",
  vrmExpressionMapping: "src/vrm-expression-mapping.js",
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
  samReferenceLabelerScript: "scripts/sam-reference-labeler.mjs",
  motionStatusHudSmokeScript: "scripts/motion-status-hud-smoke.mjs",
  motionGoalAuditScript: "scripts/motion-goal-audit.mjs",
  avatarVrmPerformanceScript: "scripts/avatar-vrm-performance-check.mjs",
  avatarVrmHumanoidCheck: "tests/avatar-vrm-humanoid-check.mjs",
  avatarVrmExpressionCheck: "tests/avatar-vrm-expression-check.mjs",
  depthCalibrationCheck: "tests/depth-calibration-check.mjs",
  motionFrameCheck: "tests/motion-frame-check.mjs",
  motionForwardingCheck: "tests/motion-forwarding-check.mjs",
  facingEstimatorCheck: "tests/facing-estimator-check.mjs",
  solverSyntheticCheck: "tests/solver-synthetic-check.mjs",
  motionRecordingCompareCheck: "tests/motion-recording-compare-check.mjs",
  mhr70MappingCheck: "tests/mhr70-mapping-check.mjs",
  samReferenceLabelerCheck: "tests/sam-reference-labeler-check.mjs",
  hmrJsonlAdapterCheck: "tests/hmr-jsonl-adapter-check.mjs",
  clipManifestCheck: "tests/clip-manifest-check.mjs",
  clipFamilyManifest: "tests/fixtures/clip-family/manifest.json",
};

const mediaPipeVersion = "0.10.35";
const threeVersion = "0.184.0";

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    packageJson?.scripts?.check === "node tests/contract-check.mjs && node tests/avatar-vrm-humanoid-check.mjs && node tests/avatar-vrm-expression-check.mjs && node tests/depth-calibration-check.mjs && node tests/motion-frame-check.mjs && node tests/motion-forwarding-check.mjs && node tests/facing-estimator-check.mjs && node tests/solver-synthetic-check.mjs && node tests/motion-recording-compare-check.mjs && node tests/mhr70-mapping-check.mjs && node tests/sam-reference-labeler-check.mjs && node tests/sam-calibration-profile-check.mjs && node tests/hmr-jsonl-adapter-check.mjs && node tests/clip-manifest-check.mjs",
    "package.json: check script must run the contract, VRM humanoid, VRM expression, depth calibration, motion frame, forwarding, facing estimator, solver synthetic, recording compare, MHR70 mapping, SAM labeler, SAM profile, HMR adapter, and clip manifest checks",
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
    packageJson?.scripts?.["sam:labels"] === "node scripts/sam-reference-labeler.mjs",
    "package.json: sam:labels script must run the SAM reference labeler",
  );
  check(
    packageJson?.scripts?.["sam:profile"] === "node scripts/sam-calibration-profile.mjs",
    "package.json: sam:profile script must run the SAM calibration profile generator",
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

  const videoModeCount = app.match(/runningMode\s*:\s*["']VIDEO["']/g)?.length ?? 0;
  check(
    videoModeCount >= 3,
    "src/app.js: expected VIDEO runningMode for pose, hand, and optional face landmarkers",
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
    [
      "uses mirrored preview for camera input",
      /async\s+function\s+startCamera\s*\([^)]*\)[\s\S]*?setMirrorPreference\s*\(\s*true\s*\)[\s\S]*?applyMirrorPreference\s*\(\s*\)/,
    ],
    ["creates a local video file URL", /URL\.createObjectURL\s*\(\s*file\s*\)/],
    ["assigns video file URL to video", /video\.src\s*=\s*objectUrl/],
    [
      "uses unmirrored replay for video file input",
      /async\s+function\s+startVideoFile\s*\([^)]*\)[\s\S]*?setMirrorPreference\s*\(\s*false\s*\)[\s\S]*?applyMirrorPreference\s*\(\s*\)/,
    ],
    ["defines mirror preference helper", /function\s+setMirrorPreference\s*\(\s*mirrored\s*\)/],
    ["allows video file replacement while active", /videoFileInput\.disabled\s*=\s*missingRequiredDom\s*\|\|\s*state\.starting/],
    ["enables video controls for file replay", /video\.controls\s*=\s*true/],
    ["loops video files for repeatable checks", /video\.loop\s*=\s*true/],
    ["revokes video file URL", /URL\.revokeObjectURL\s*\(\s*state\.videoFileUrl\s*\)/],
    ["starts video playback", /video\.play\s*\(\s*\)/],
    ["supports requestVideoFrameCallback detection pump", /requestVideoFrameCallback\s*\(\s*\([^)]*timestamp[\s\S]*runDetectionFrame/],
    ["keeps requestAnimationFrame detection fallback", /requestAnimationFrame\s*\(\s*\([^)]*timestamp[\s\S]*runDetectionFrame/],
    ["parses detection pump flag", /function\s+getInitialDetectionPumpMode\s*\([^)]*\)[\s\S]*URLSearchParams[\s\S]*["']pump["']/],
    ["parses tracking worker opt-in flag", /function\s+getInitialTrackingWorkerEnabled\s*\([^)]*\)[\s\S]*isTruthyQueryFlag\(["']tracking-worker["']\)/],
    ["parses avatar smoothing opt-in flag", /function\s+getInitialAvatarSmoothingMode\s*\([^)]*\)[\s\S]*URLSearchParams[\s\S]*["']smoothing["']/],
    ["parses face landmark opt-in flag", /function\s+getInitialFaceLandmarksEnabled\s*\([^)]*\)[\s\S]*["']face-landmarks["']/],
    ["creates module tracking worker from local file", /new\s+Worker\s*\(\s*new\s+URL\s*\(\s*["']\.\/motion-worker\.js(?:\?[^"']+)?["']\s*,\s*import\.meta\.url\s*\)\s*,\s*\{\s*type\s*:\s*["']module["']\s*\}/],
    ["falls back to main-thread detection after worker failure", /trackingWorker[\s\S]*fallbackReason[\s\S]*detectMotionFrameOnMainThread/],
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
      /const\s+AVATAR_ELEMENT_KEYS\s*=\s*\[\s*["']avatarCanvas["']\s*,\s*["']avatarStatus["']\s*,\s*["']avatarBoneCount["']\s*\]/,
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
    ["records body validation after avatar update", /function\s+processMotionFrame\s*\([^)]*\)[\s\S]*?updateAvatarRendererFromMotionFrame\s*\(\s*normalizedFrame\s*\)[\s\S]*?recordBodyValidation\s*\(\s*normalizedFrame\s*\)/],
    ["wires avatar view reset button", /avatarViewReset[\s\S]*?addEventListener\(\s*["']click["'][\s\S]*?resetView/],
    ["wires motion status calibration button", /motionStatusCalibrateButton\?\.\s*addEventListener\(\s*["']click["'][\s\S]*?resetDepthCalibrationFromUi\s*\(\s*\)/],
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
    ["exposes avatar view debug API", /getAvatarViewState[\s\S]*resetAvatarView/],
    ["checks strict segment agreement", /function\s+buildStrictSegmentRows\s*\([^)]*\)[\s\S]*angleErrorDeg[\s\S]*lengthErrorRatio/],
    ["checks strict side-order agreement", /function\s+buildStrictSideOrderRows\s*\([^)]*\)[\s\S]*sourceDelta[\s\S]*avatarDelta/],
    ["checks strict temporal agreement", /function\s+buildStrictTemporalRows\s*\([^)]*\)[\s\S]*sourceMotion[\s\S]*motionRatio/],
    ["exposes motion tracker debug API", /globalThis\.motionTrackerDebug\s*=\s*\{[\s\S]*?getBodyValidationReport[\s\S]*?clearBodyValidation/],
    ["exposes motion recording debug API", /startMotionRecording[\s\S]*stopMotionRecording[\s\S]*getMotionRecording[\s\S]*getMotionRecordingJsonl[\s\S]*loadMotionRecording[\s\S]*loadMotionRecordingJsonl/],
    ["exposes motion forwarding debug API", /connectMotionForwarding[\s\S]*disconnectMotionForwarding[\s\S]*getMotionForwardingStatus/],
    ["exposes face tracking debug API", /setFaceTrackingEnabled[\s\S]*getFaceTrackingStatus[\s\S]*getFaceTrackingEnabled/],
    ["resets avatar pose on camera stop", /function\s+stopCamera\s*\([^)]*\)[\s\S]*?resetAvatarPose\s*\(\s*\)/],
    ["calls avatar resetPose API", /state\.avatarRenderer\?\.\s*resetPose\s*\(\s*\)/],
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
    ["defines local default model URL", /const\s+DEFAULT_MODEL_URL\s*=\s*["']\.\/assets\/models\/Xbot\.glb["']/],
    ["keeps default Xbot model camera-facing without extra yaw", /const\s+DEFAULT_XBOT_MODEL_YAW_RAD\s*=\s*0[\s\S]*function\s+getNonVrmInitialModelYawRad/],
    ["defines conservative runtime depth scale default", /const\s+DEFAULT_LANDMARK_DEPTH_SCALE\s*=\s*0\.45/],
    ["imports dynamic depth calibration helpers", /from\s+["']\.\/depth-calibration\.js["']/],
    ["imports VRM expression helpers", /from\s+["']\.\/vrm-expression-mapping\.js["']/],
    ["defines runtime performance budgets", /const\s+PERFORMANCE_BUDGETS_MS\s*=\s*\{[\s\S]*updateMedian\s*:\s*1\.5[\s\S]*validationP95\s*:\s*2/],
    ["defines face apply performance budget", /faceApplyP95\s*:\s*0\.5/],
    ["defines pose solver performance budget", /poseSolverP95\s*:\s*2/],
    ["defines group-specific smoothing", /const\s+RETARGET_SMOOTHING_MS\s*=\s*\{[\s\S]*upperArm[\s\S]*foreArm[\s\S]*finger/],
    ["normalizes opt-in smoothing mode", /function\s+normalizeAvatarSmoothingMode\s*\([^)]*\)[\s\S]*retarget[\s\S]*strong/],
    ["reports retarget smoothing mode", /retargetSmoothing\s*:\s*\{[\s\S]*mode\s*:\s*activeSmoothingMode/],
    ["bounds first update delta", /const\s+FIRST_UPDATE_DELTA_MS\s*=\s*16\.67[\s\S]*lastUpdateTime\s*>\s*0[\s\S]*FIRST_UPDATE_DELTA_MS/],
    ["exports createAvatarRenderer", /export\s+function\s+createAvatarRenderer\s*\(/],
    ["accepts injected model URL", /const\s+modelUrl\s*=\s*options\.modelUrl\s*\?\?\s*DEFAULT_MODEL_URL/],
    ["loads the configured model URL", /loader\.loadAsync\s*\(\s*modelUrl\s*\)/],
    [
      "guards update before ready or after failure",
      /function\s+update\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!ready\s*\|\|\s*failed\s*\|\|\s*disposed\s*\)\s*\{[\s\S]*?return\s*;/,
    ],
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
    ["exposes body validation snapshot", /function\s+getBodyValidationSnapshot\s*\([^)]*\)/],
    ["defines body retarget hooks", /const\s+BODY_RETARGETS\s*=\s*\[[\s\S]*?bone\s*:\s*["']LeftArm["'][\s\S]*?bone\s*:\s*["']RightLeg["']/],
    ["aims pose-fallback head at virtual crown", /bone\s*:\s*["']Head["'][\s\S]*to\s*:\s*["']headCrown["'][\s\S]*function\s+estimateHeadCrown/],
    ["applies body retargets", /for\s*\(\s*const\s+target\s+of\s+BODY_RETARGETS\s*\)[\s\S]*?applyAimToBone\s*\(\s*target\.bone/],
    ["gates retargeting by landmark visibility", /function\s+retargetConfidence\s*\([^)]*\)[\s\S]*RETARGET_FULL_CONFIDENCE_VISIBILITY/],
    ["computes limb plane normals", /function\s+computeLimbPlaneNormals\s*\([^)]*\)[\s\S]*limbPlaneNormal/],
    ["uses limb plane normals as body secondary axes", /computeLimbPlaneNormals\s*\(\s*points\s*\)[\s\S]*limbPlaneNormals\[target\.bone\]/],
    ["keeps secondary aim rest basis in dedicated temp vectors", /const\s+tmpVectorG\s*=\s*new\s+THREE\.Vector3\(\)[\s\S]*const\s+tmpVectorH\s*=\s*new\s+THREE\.Vector3\(\)[\s\S]*function\s+applyAimWithSecondary[\s\S]*const\s+restDirectionLocal\s*=\s*tmpVectorG[\s\S]*const\s+restSecondaryLocal\s*=\s*tmpVectorH/],
    ["computes palm normal", /function\s+computePalmNormal\s*\([^)]*\)[\s\S]*crossVectors/],
    ["uses hand world landmarks for palm normal when present", /worldLandmarks[\s\S]*worldPoints[\s\S]*computePalmNormal\(worldPoints\[0\]/],
    ["limits parent-relative twist", /function\s+limitTwistFromRest\s*\([^)]*\)[\s\S]*extractTwist/],
    ["stabilizes root facing before yaw changes", /ROOT_ORIENTATION_SWITCH_FRAMES[\s\S]*candidateFacingFrames[\s\S]*function\s+updateStableRootFacing/],
    ["freezes proportion calibration", /const\s+PROPORTION_CALIBRATION_FRAMES\s*=\s*30[\s\S]*function\s+freezeProportionCalibration\s*\(/],
    ["exposes avatar performance snapshot", /function\s+getPerformanceSnapshot\s*\([^)]*\)[\s\S]*PERFORMANCE_BUDGETS_MS/],
    ["reports pose solver timing", /poseSolverMs[\s\S]*samples\s*:\s*\{[\s\S]*poseSolver\s*:\s*summarizePerformanceSamples/],
    ["reports pose solver hinge metrics", /hingeViolations[\s\S]*hingeLimitWarnings[\s\S]*lowConfidenceHinges[\s\S]*solvedPose\.hinges\.map/],
    ["reports pose solver aggregate metrics", /poseSolverMetrics[\s\S]*hingeViolationFrames[\s\S]*hingeLimitWarningFrames[\s\S]*facingChanges[\s\S]*modeChanges/],
    ["reports hinge warning breakdown by name", /hingeLimitWarningByName[\s\S]*maxHingeFlexDegByName[\s\S]*maxHingeOverflowDegByName/],
    ["defines lost tracking recovery timing", /RETARGET_LOST_TRACKING_HOLD_MS[\s\S]*RETARGET_LOST_TRACKING_DECAY_MS[\s\S]*RETARGET_REACQUIRE_BLEND_MS/],
    ["eases lost tracking body pose to rest", /function\s+applyLostTrackingBodyPose\s*\([^)]*\)[\s\S]*applyOccludedBodyBone[\s\S]*RETARGET_LOST_TRACKING_HOLD_MS/],
    ["blends retarget after reacquiring pose", /function\s+updateTrackingRecoveryState\s*\([^)]*\)[\s\S]*reacquiredAt[\s\S]*RETARGET_REACQUIRE_BLEND_MS[\s\S]*trackingRecovery\.blend/],
    ["applies face transform matrix to head pose", /function\s+applyFaceHeadPose\s*\([^)]*\)[\s\S]*faceTransformQuaternion[\s\S]*applyLocalPoseDeltaToBone\(["']Head["']/],
    ["applies face expressions after hand retargeting", /applyHands\s*\([\s\S]*?\)[\s\S]*?applyFaceExpressions\s*\(/],
    ["reports expression diagnostics", /expressionPresetCount[\s\S]*resolvedMorphTargetCount[\s\S]*missingPresets/],
    ["defines finger segment mappings", /const\s+FINGER_SEGMENTS\s*=\s*\[[\s\S]*?fallbackFrom/],
    [
      "builds side-specific finger chains",
      /for\s*\(\s*const\s+side\s+of\s+\[\s*["']Left["']\s*,\s*["']Right["']\s*\]\s*\)[\s\S]*?\$\{side\}Hand\$\{fingerName\}\$\{segment\}/,
    ],
    ["applies hand landmark retargeting", /for\s*\(\s*const\s+\[fingerName,\s*indices\]\s+of\s+Object\.entries\(HAND_FINGERS\)\s*\)/],
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

  const fingerLandmarkMappings = {
    Thumb: [1, 2, 3, 4],
    Index: [5, 6, 7, 8],
    Middle: [9, 10, 11, 12],
    Ring: [13, 14, 15, 16],
    Pinky: [17, 18, 19, 20],
  };

  for (const [fingerName, indices] of Object.entries(fingerLandmarkMappings)) {
    checkPattern(
      avatarRenderer,
      new RegExp(`${fingerName}\\s*:\\s*\\[\\s*${indices.join("\\s*,\\s*")}\\s*\\]`),
      `src/avatar-renderer.js: missing ${fingerName} MediaPipe finger landmark mapping`,
    );
  }

  for (const bone of requiredAvatarBones) {
    checkPattern(
      avatarRenderer,
      new RegExp(`["']${escapeRegExp(bone)}["']`),
      `src/avatar-renderer.js: REQUIRED_BONES missing ${bone}`,
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

const [
  readme,
  packageSource,
  html,
  css,
  app,
  avatarRenderer,
  depthCalibration,
  motionFrame,
  motionWorker,
  motionForwarding,
  poseSolver,
  avatarMotionAgreementScript,
  syntheticGeneratorScript,
  validationCliScript,
  hmrJsonlAdapterScript,
  motionRecordingCompareScript,
  motionStatusHudSmokeScript,
  motionGoalAuditScript,
  vrmHumanoidMapping,
  vrmExpressionMapping,
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
    readProjectFile(files.avatarRenderer),
    readProjectFile(files.depthCalibration),
    readProjectFile(files.motionFrame),
    readProjectFile(files.motionWorker),
    readProjectFile(files.motionForwarding),
    readProjectFile(files.poseSolver),
    readProjectFile(files.avatarMotionAgreementScript),
    readProjectFile(files.syntheticGeneratorScript),
    readProjectFile(files.validationCliScript),
    readProjectFile(files.hmrJsonlAdapterScript),
    readProjectFile(files.motionRecordingCompareScript),
    readProjectFile(files.motionStatusHudSmokeScript),
    readProjectFile(files.motionGoalAuditScript),
    readProjectFile(files.vrmHumanoidMapping),
    readProjectFile(files.vrmExpressionMapping),
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
checkClaudeCodexBridge(claudeSettings, claudeCodexCommand, claudeCodexScript, readme);
checkTrackerAppContract(app);
checkAvatarAppContract(app);
checkAvatarRendererContract(avatarRenderer);
checkCssContract(css);
checkAvatarModelContract(avatarModelJson);
check(vrmHumanoidMapping.includes("parseVrmHumanoid"), `${files.vrmHumanoidMapping}: expected VRM humanoid parser`);
check(vrmHumanoidMapping.includes("createVrmHumanoidMapping"), `${files.vrmHumanoidMapping}: expected VRM humanoid mapper`);
check(vrmExpressionMapping.includes("parseVrmExpressionMetadata"), `${files.vrmExpressionMapping}: expected VRM expression parser`);
check(vrmExpressionMapping.includes("mapMediaPipeBlendShapesToVrmPresets"), `${files.vrmExpressionMapping}: expected MediaPipe blendshape mapper`);
check(depthCalibration.includes("solveDistalDepth"), `${files.depthCalibration}: expected depth solver`);
check(depthCalibration.includes("DEPTH_CALIBRATION_TARGET_SCORE"), `${files.depthCalibration}: expected depth calibration target`);
check(depthCalibration.includes("estimateCalibrationPoseQuality"), `${files.depthCalibration}: expected calibration pose quality helper`);
check(motionFrame.includes("createMotionFrame"), `${files.motionFrame}: expected motion frame factory`);
check(motionFrame.includes("createMotionRecording"), `${files.motionFrame}: expected motion recording factory`);
check(motionFrame.includes("serializeMotionRecordingJsonl"), `${files.motionFrame}: expected motion recording JSONL serializer`);
check(motionFrame.includes("parseMotionRecordingJsonl"), `${files.motionFrame}: expected motion recording JSONL parser`);
check(motionFrame.includes("normalizeExternalMotionRecording"), `${files.motionFrame}: expected external HMR recording normalizer`);
check(motionFrame.includes("isExternalMotionRecording"), `${files.motionFrame}: expected external HMR recording detector`);
check(motionFrame.includes("leftHandWorldLandmarks"), `${files.motionFrame}: expected hand world landmarks in motion frames`);
check(motionFrame.includes("extractFaceLandmarks"), `${files.motionFrame}: expected optional face landmark extraction`);
check(motionWorker.includes("self.addEventListener"), `${files.motionWorker}: expected worker message listener`);
check(motionWorker.includes("PoseLandmarker"), `${files.motionWorker}: expected pose landmarker in worker`);
check(motionWorker.includes("HandLandmarker"), `${files.motionWorker}: expected hand landmarker in worker`);
check(motionWorker.includes("createMotionFrame"), `${files.motionWorker}: expected worker to emit motion frames`);
check(/FilesetResolver\.forVisionTasks\s*\(\s*wasmAssetPath\s*,\s*true\s*\)/.test(motionWorker), `${files.motionWorker}: expected module-worker wasm fileset mode`);
check(motionWorker.includes("installMediaPipeModuleFactoryImportBridge"), `${files.motionWorker}: expected module-worker ModuleFactory import bridge`);
check(motionWorker.includes("OffscreenCanvas"), `${files.motionWorker}: expected ImageBitmap frames to be drawn to OffscreenCanvas before detection`);
check(motionWorker.includes("getImageData"), `${files.motionWorker}: expected worker detection to use ImageData from transferred frames`);
check(motionWorker.includes("fallbackReasons"), `${files.motionWorker}: expected worker delegate fallback reasons`);
check(motionWorker.includes("recordDetectorDelegateAttempt"), `${files.motionWorker}: expected worker delegate attempt telemetry`);
check(motionForwarding.includes("createMotionForwarder"), `${files.motionForwarding}: expected motion forwarding client`);
check(motionForwarding.includes("action-tracker-motion-frame"), `${files.motionForwarding}: expected stable forwarding payload type`);
check(poseSolver.includes("solveHinges"), `${files.poseSolver}: expected hinge metric solver`);
check(poseSolver.includes("hingeViolations"), `${files.poseSolver}: expected hinge violation reporting`);
check(poseSolver.includes("estimateTrackingMode"), `${files.poseSolver}: expected upper-body mode estimator`);
check(avatarMotionAgreementScript.includes("--tracking-worker"), `${files.avatarMotionAgreementScript}: expected tracking worker query flag support`);
check(avatarMotionAgreementScript.includes('"tracking-worker"'), `${files.avatarMotionAgreementScript}: expected tracking-worker URL parameter`);
check(avatarMotionAgreementScript.includes("trackingWorkerRequested"), `${files.avatarMotionAgreementScript}: expected tracking worker requested summary field`);
check(avatarMotionAgreementScript.includes("trackingWorkerFallbackReason"), `${files.avatarMotionAgreementScript}: expected tracking worker fallback reason summary field`);
check(avatarMotionAgreementScript.includes("--smoothing"), `${files.avatarMotionAgreementScript}: expected smoothing query flag support`);
check(avatarMotionAgreementScript.includes('"smoothing"'), `${files.avatarMotionAgreementScript}: expected smoothing URL parameter`);
check(avatarMotionAgreementScript.includes("avatarSmoothingMode"), `${files.avatarMotionAgreementScript}: expected smoothing summary field`);
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
check(motionStatusHudSmokeScript.includes("getMotionStatusHudSnapshot"), `${files.motionStatusHudSmokeScript}: expected Motion State HUD snapshot validation`);
check(motionStatusHudSmokeScript.includes("#motion-status-calibration-guide"), `${files.motionStatusHudSmokeScript}: expected calibration guide DOM validation`);
check(motionStatusHudSmokeScript.includes("#motion-status-calibrate"), `${files.motionStatusHudSmokeScript}: expected calibration action DOM validation`);
check(motionStatusHudSmokeScript.includes("resetCalibrationThroughHud"), `${files.motionStatusHudSmokeScript}: expected calibration reset smoke flow`);
check(motionStatusHudSmokeScript.includes("DOM.setFileInputFiles"), `${files.motionStatusHudSmokeScript}: expected video file upload through Chrome DevTools`);
check(motionStatusHudSmokeScript.includes("Page.captureScreenshot"), `${files.motionStatusHudSmokeScript}: expected HUD screenshot capture`);
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
checkSyntax(files.avatarRenderer);
checkSyntax(files.depthCalibration);
checkSyntax(files.motionFrame);
checkSyntax(files.motionWorker);
checkSyntax(files.motionForwarding);
checkSyntax(files.poseSolver);
checkSyntax(files.avatarMotionAgreementScript);
checkSyntax(files.framePumpPerformanceScript);
checkSyntax(files.syntheticGeneratorScript);
checkSyntax(files.validationCliScript);
checkSyntax(files.hmrJsonlAdapterScript);
checkSyntax(files.motionRecordingCompareScript);
checkSyntax(files.samReferenceLabelerScript);
checkSyntax(files.motionStatusHudSmokeScript);
checkSyntax(files.motionGoalAuditScript);
checkSyntax(files.vrmHumanoidMapping);
checkSyntax(files.vrmExpressionMapping);
checkSyntax(files.avatarPerformanceScript);
checkSyntax(files.avatarVrmPerformanceScript);
checkSyntax(files.avatarVrmHumanoidCheck);
checkSyntax(files.avatarVrmExpressionCheck);
checkSyntax(files.depthCalibrationCheck);
checkSyntax(files.motionFrameCheck);
checkSyntax(files.motionForwardingCheck);
checkSyntax(files.facingEstimatorCheck);
checkSyntax(files.solverSyntheticCheck);
checkSyntax(files.motionRecordingCompareCheck);
checkSyntax(files.mhr70MappingCheck);
checkSyntax(files.samReferenceLabelerCheck);
checkSyntax(files.hmrJsonlAdapterCheck);
checkSyntax(files.clipManifestCheck);

if (failures.length > 0) {
  console.error(`Contract check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Contract check passed.");
