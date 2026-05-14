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
  avatarModel: "assets/models/Xbot.glb",
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
  "model-select",
  "mirror-toggle",
  "avatar-skeleton-toggle",
  "fps-value",
  "pose-count",
  "left-hand-count",
  "right-hand-count",
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
    packageJson?.scripts?.check === "node tests/contract-check.mjs",
    "package.json: check script must remain node tests/contract-check.mjs",
  );
  check(
    packageJson?.scripts?.start === "python3 -m http.server 8000 --bind 127.0.0.1",
    "package.json: start script must remain the local static server",
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

function checkTrackerAppContract(app) {
  const requiredAssetUrls = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediaPipeVersion}/vision_bundle.mjs`,
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${mediaPipeVersion}/wasm`,
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
  ];

  for (const url of requiredAssetUrls) {
    check(app.includes(url), `src/app.js: missing required MediaPipe asset URL ${url}`);
  }

  const videoModeCount = app.match(/runningMode\s*:\s*["']VIDEO["']/g)?.length ?? 0;
  check(
    videoModeCount >= 2,
    "src/app.js: expected VIDEO runningMode for both pose and hand landmarkers",
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
    ["schedules detection frames", /requestAnimationFrame\s*\(\s*runDetectionFrame\s*\)/],
    ["cancels detection frames", /cancelAnimationFrame\s*\(\s*state\.animationFrameId\s*\)/],
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
      "passes canvas status bone count and model URL",
      /createAvatarRenderer\s*\(\s*\{[\s\S]*?canvas\s*:\s*state\.elements\.avatarCanvas[\s\S]*?statusElement\s*:\s*state\.elements\.avatarStatus[\s\S]*?boneCountElement\s*:\s*state\.elements\.avatarBoneCount[\s\S]*?modelUrl\s*:\s*AVATAR_MODEL_URL[\s\S]*?\}\s*\)/,
    ],
    ["catches avatar init failure", /state\.avatarRenderer\s*\.\s*init\s*\(\s*\)[\s\S]*?\.catch\s*\(/],
    [
      "updates avatar from detection frame",
      /runDetectionFrame\s*\(\s*timestamp\s*\)[\s\S]*?updateAvatarRenderer\s*\(\s*poseResults\s*,\s*handResults\s*,\s*timestamp\s*\)/,
    ],
    [
      "passes pose hand mirror and timestamp to avatar update",
      /state\.avatarRenderer\.update\s*\(\s*\{[\s\S]*?poseResults[\s\S]*?handResults[\s\S]*?mirrored\s*:\s*Boolean\s*\(\s*state\.elements\.mirrorToggle\?\.\s*checked\s*\)[\s\S]*?timestamp[\s\S]*?\}\s*\)/,
    ],
    ["syncs avatar skeleton debug option", /function\s+syncAvatarDebugOptions\s*\(\s*\)[\s\S]*?setSkeletonVisible/],
    ["records body validation after avatar update", /updateAvatarRenderer\s*\(\s*poseResults\s*,\s*handResults\s*,\s*timestamp\s*\)[\s\S]*?recordBodyValidation\s*\(\s*poseResults\s*,\s*timestamp\s*\)/],
    ["wires avatar view reset button", /avatarViewReset[\s\S]*?addEventListener\(\s*["']click["'][\s\S]*?resetView/],
    ["reports body match rate against fixed threshold", /const\s+BODY_MATCH_THRESHOLD_DEG\s*=\s*30[\s\S]*matchRate/],
    ["records projected visual body validation", /getProjectedBodyPoseSnapshot[\s\S]*visualJoints/],
    ["defines strict validation thresholds", /const\s+BODY_STRICT_JOINT_THRESHOLD\s*=[\s\S]*BODY_STRICT_MIN_SEGMENT_LENGTH[\s\S]*BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG[\s\S]*BODY_STRICT_TEMPORAL_ERROR_THRESHOLD/],
    ["builds strict validation report", /function\s+buildStrictValidationReport\s*\([^)]*\)[\s\S]*strictValidation|strictValidation\s*=\s*buildStrictValidationReport\s*\(/],
    ["builds depth validation report", /function\s+buildDepthValidationReport\s*\([^)]*\)[\s\S]*mediapipe_relative_depth/],
    ["marks depth validation self-reference", /selfReferential[\s\S]*retarget residual/],
    ["exposes avatar depth scale debug API", /getAvatarDepthScale[\s\S]*setAvatarDepthScale/],
    ["exposes avatar view debug API", /getAvatarViewState[\s\S]*resetAvatarView/],
    ["checks strict segment agreement", /function\s+buildStrictSegmentRows\s*\([^)]*\)[\s\S]*angleErrorDeg[\s\S]*lengthErrorRatio/],
    ["checks strict side-order agreement", /function\s+buildStrictSideOrderRows\s*\([^)]*\)[\s\S]*sourceDelta[\s\S]*avatarDelta/],
    ["checks strict temporal agreement", /function\s+buildStrictTemporalRows\s*\([^)]*\)[\s\S]*sourceMotion[\s\S]*motionRatio/],
    ["exposes motion tracker debug API", /globalThis\.motionTrackerDebug\s*=\s*\{[\s\S]*?getBodyValidationReport[\s\S]*?clearBodyValidation/],
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
    ["defines runtime depth scale default", /const\s+DEFAULT_LANDMARK_DEPTH_SCALE\s*=\s*1/],
    ["exports createAvatarRenderer", /export\s+function\s+createAvatarRenderer\s*\(/],
    ["accepts injected model URL", /const\s+modelUrl\s*=\s*options\.modelUrl\s*\?\?\s*DEFAULT_MODEL_URL/],
    ["loads the configured model URL", /loader\.loadAsync\s*\(\s*modelUrl\s*\)/],
    [
      "guards update before ready or after failure",
      /function\s+update\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*!ready\s*\|\|\s*failed\s*\|\|\s*disposed\s*\)\s*\{[\s\S]*?return\s*;/,
    ],
    [
      "returns public renderer API",
      /const\s+api\s*=\s*\{[\s\S]*?\binit\b[\s\S]*?\bupdate\b[\s\S]*?\bgetBodyValidationSnapshot\b[\s\S]*?\bsetSkeletonVisible\b[\s\S]*?\bresetPose\b[\s\S]*?\bresize\b[\s\S]*?\bdispose\b[\s\S]*?\};/,
    ],
    ["creates Three.js skeleton helper", /new\s+THREE\.SkeletonHelper\s*\(\s*model\s*\)/],
    ["defines skeleton visibility setter", /function\s+setSkeletonVisible\s*\(\s*value\s*\)/],
    ["defines visual skeleton joints", /const\s+BODY_VISUAL_JOINTS\s*=\s*\[[\s\S]*?leftShoulder[\s\S]*?rightAnkle/],
    ["exposes projected body pose snapshot", /function\s+getProjectedBodyPoseSnapshot\s*\([^)]*\)/],
    ["exposes depth validation snapshot", /function\s+getDepthValidationSnapshot\s*\([^)]*\)/],
    ["defines orbit camera application", /function\s+applyOrbitCamera\s*\(\s*\)[\s\S]*setFromSpherical[\s\S]*lookAt/],
    ["defines orbit pointer controls", /function\s+attachOrbitControls\s*\(\s*\)[\s\S]*pointerdown[\s\S]*wheel[\s\S]*dblclick/],
    ["exposes avatar view reset", /function\s+resetView\s*\(\s*\)[\s\S]*resetOrbitCamera[\s\S]*getViewState/],
    ["reads MediaPipe world landmarks", /function\s+extractWorldPoseLandmarks\s*\([^)]*\)[\s\S]*worldLandmarks/],
    ["exposes depth scale setter", /function\s+setDepthScale\s*\([^)]*\)[\s\S]*normalizeDepthScale/],
    ["defines body validation segments", /const\s+BODY_VALIDATION_SEGMENTS\s*=\s*\[[\s\S]*?leftUpperArm[\s\S]*?rightLowerLeg/],
    ["exposes body validation snapshot", /function\s+getBodyValidationSnapshot\s*\([^)]*\)/],
    ["defines body retarget hooks", /const\s+BODY_RETARGETS\s*=\s*\[[\s\S]*?bone\s*:\s*["']LeftArm["'][\s\S]*?bone\s*:\s*["']RightLeg["']/],
    ["applies body retargets", /for\s*\(\s*const\s+target\s+of\s+BODY_RETARGETS\s*\)[\s\S]*?applyAimToBone\s*\(\s*target\.bone/],
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

const [readme, packageSource, html, css, app, avatarRenderer, avatarModelBytes] =
  await Promise.all([
    readProjectFile(files.readme),
    readProjectFile(files.packageJson),
    readProjectFile(files.html),
    readProjectFile(files.css),
    readProjectFile(files.app),
    readProjectFile(files.avatarRenderer),
    readProjectBytes(files.avatarModel),
  ]);

const packageJson = parseJson(files.packageJson, packageSource);
const avatarModelJson = parseGlbJson(avatarModelBytes, files.avatarModel);

checkPackageContract(packageJson);
checkReadmeContract(readme);
checkHtmlContract(html);
checkTrackerAppContract(app);
checkAvatarAppContract(app);
checkAvatarRendererContract(avatarRenderer);
checkCssContract(css);
checkAvatarModelContract(avatarModelJson);
checkSyntax(files.app);
checkSyntax(files.avatarRenderer);

if (failures.length > 0) {
  console.error(`Contract check failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Contract check passed.");
