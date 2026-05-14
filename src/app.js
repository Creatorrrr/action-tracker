import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import { createAvatarRenderer } from "./avatar-renderer.js?v=20260514-avatar-orbit-2";

const WASM_ASSET_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const AVATAR_MODEL_URL = "./assets/models/Xbot.glb";
const DEFAULT_AVATAR_DEPTH_SCALE = 1;

const POSE_MODEL_URLS = {
  pose_lite:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
  pose_full:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
  pose_heavy:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task",
};

const POSE_MODEL_KEYS_BY_OPTION = {
  lite: "pose_lite",
  full: "pose_full",
  heavy: "pose_heavy",
};

const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";
const BODY_MATCH_THRESHOLD_DEG = 30;
const BODY_VISUAL_MATCH_THRESHOLD = 0.35;
const BODY_STRICT_JOINT_THRESHOLD = 0.16;
const BODY_STRICT_MIN_SEGMENT_LENGTH = 0.035;
const BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG = 18;
const BODY_STRICT_SEGMENT_LENGTH_ERROR_THRESHOLD = 0.25;
const BODY_STRICT_SIDE_ORDER_EPSILON = 0.025;
const BODY_STRICT_TEMPORAL_MIN_SOURCE_MOTION = 0.012;
const BODY_STRICT_TEMPORAL_ERROR_THRESHOLD = 0.08;
const BODY_STRICT_TEMPORAL_MIN_AVATAR_RATIO = 0.35;
const BODY_STRICT_TEMPORAL_MAX_AVATAR_RATIO = 2.75;

const BODY_STRICT_SCORE_WEIGHTS = {
  joints: 0.45,
  segments: 0.35,
  sideOrder: 0.1,
  temporal: 0.1,
};

const BODY_STRICT_SEGMENTS = [
  { name: "shoulderWidth", group: "torso", from: "leftShoulder", to: "rightShoulder" },
  { name: "hipWidth", group: "torso", from: "leftHip", to: "rightHip" },
  { name: "leftTorso", group: "torso", from: "leftShoulder", to: "leftHip" },
  { name: "rightTorso", group: "torso", from: "rightShoulder", to: "rightHip" },
  { name: "leftUpperArm", group: "arms", from: "leftShoulder", to: "leftElbow" },
  { name: "leftForeArm", group: "arms", from: "leftElbow", to: "leftWrist" },
  { name: "rightUpperArm", group: "arms", from: "rightShoulder", to: "rightElbow" },
  { name: "rightForeArm", group: "arms", from: "rightElbow", to: "rightWrist" },
  { name: "leftUpperLeg", group: "legs", from: "leftHip", to: "leftKnee" },
  { name: "leftLowerLeg", group: "legs", from: "leftKnee", to: "leftAnkle" },
  { name: "rightUpperLeg", group: "legs", from: "rightHip", to: "rightKnee" },
  { name: "rightLowerLeg", group: "legs", from: "rightKnee", to: "rightAnkle" },
];

const BODY_STRICT_SIDE_ORDER_PAIRS = [
  { name: "shoulders", group: "torso", left: "leftShoulder", right: "rightShoulder" },
  { name: "elbows", group: "arms", left: "leftElbow", right: "rightElbow" },
  { name: "wrists", group: "arms", left: "leftWrist", right: "rightWrist" },
  { name: "hips", group: "torso", left: "leftHip", right: "rightHip" },
  { name: "knees", group: "legs", left: "leftKnee", right: "rightKnee" },
  { name: "ankles", group: "legs", left: "leftAnkle", right: "rightAnkle" },
];

const ELEMENT_IDS = {
  video: "camera-video",
  canvas: "overlay-canvas",
  startButton: "start-button",
  stopButton: "stop-button",
  videoFileInput: "video-file-input",
  mirrorToggle: "mirror-toggle",
  avatarSkeletonToggle: "avatar-skeleton-toggle",
  modelSelect: "model-select",
  cameraStatus: "camera-status",
  modelStatus: "model-status",
  fpsValue: "fps-value",
  poseCount: "pose-count",
  leftHandCount: "left-hand-count",
  rightHandCount: "right-hand-count",
  errorMessage: "error-message",
  avatarCanvas: "avatar-canvas",
  avatarViewReset: "avatar-view-reset",
  avatarStatus: "avatar-status",
  avatarBoneCount: "avatar-bone-count",
};

const REQUIRED_ELEMENT_KEYS = [
  "video",
  "canvas",
  "startButton",
  "stopButton",
  "videoFileInput",
  "mirrorToggle",
  "avatarSkeletonToggle",
  "modelSelect",
  "cameraStatus",
  "modelStatus",
  "fpsValue",
  "poseCount",
  "leftHandCount",
  "rightHandCount",
  "errorMessage",
];
const AVATAR_ELEMENT_KEYS = ["avatarCanvas", "avatarStatus", "avatarBoneCount"];

const POSE_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [29, 31],
  [27, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [28, 32],
];

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const state = {
  elements: {},
  context: null,
  missingIds: [],
  vision: null,
  poseLandmarker: null,
  handLandmarker: null,
  poseModelKey: null,
  modelLoadPromise: null,
  stream: null,
  videoFileUrl: "",
  inputKind: "idle",
  videoFileName: "",
  animationFrameId: 0,
  active: false,
  starting: false,
  startToken: 0,
  lastVideoTime: -1,
  lastFrameTimestamp: 0,
  smoothedFps: 0,
  errorCode: null,
  avatarRenderer: null,
  avatarInitPromise: null,
  bodyValidation: {
    samples: [],
    lastSample: null,
  },
};

function boot() {
  state.elements = getDomElements();
  state.missingIds = getMissingElementIds();
  state.context = state.elements.canvas?.getContext("2d") ?? null;

  if (state.elements.video) {
    state.elements.video.muted = true;
    state.elements.video.playsInline = true;
    state.elements.video.setAttribute("playsinline", "");
  }

  initAvatarRenderer();

  state.elements.startButton?.addEventListener("click", () => {
    void startCamera();
  });
  state.elements.stopButton?.addEventListener("click", () => {
    stopCamera();
  });
  state.elements.videoFileInput?.addEventListener("click", () => {
    state.elements.videoFileInput.value = "";
  });
  state.elements.videoFileInput?.addEventListener("change", () => {
    const file = state.elements.videoFileInput.files?.[0];

    if (file) {
      void startVideoFile(file);
    }
  });
  state.elements.mirrorToggle?.addEventListener("change", () => {
    applyMirrorPreference();
    if (state.active) {
      clearCanvas();
    }
  });
  state.elements.avatarSkeletonToggle?.addEventListener("change", () => {
    syncAvatarDebugOptions();
  });
  state.elements.avatarViewReset?.addEventListener("click", () => {
    state.avatarRenderer?.resetView?.();
  });
  state.elements.modelSelect?.addEventListener("change", () => {
    clearError();
    if (state.poseLandmarker && state.poseModelKey !== getSelectedPoseModelKey()) {
      setText("modelStatus", "Model selected");
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCamera({ preserveError: true });
    disposeAvatarRenderer();
  });
  window.addEventListener("pagehide", () => {
    stopCamera({ preserveError: true });
    disposeAvatarRenderer();
  });

  exposeDebugApi();
  resetMetrics();
  setText("cameraStatus", "Stopped");
  setText("modelStatus", "Not loaded");
  updateControls();

  if (state.missingIds.length > 0) {
    const message = `Missing required UI elements: ${state.missingIds.join(", ")}`;
    setError(message, "MISSING_DOM");
    console.warn(message);
  }

  if (!state.context && state.elements.canvas) {
    setError("Canvas rendering is unavailable in this browser.", "CANVAS_UNSUPPORTED");
  }
}

function getDomElements() {
  return Object.fromEntries(
    Object.entries(ELEMENT_IDS).map(([key, id]) => [key, document.getElementById(id)]),
  );
}

function getMissingElementIds() {
  return REQUIRED_ELEMENT_KEYS.filter((key) => !state.elements[key]).map(
    (key) => `#${ELEMENT_IDS[key]}`,
  );
}

function getMissingAvatarElementIds() {
  return AVATAR_ELEMENT_KEYS.filter((key) => !state.elements[key]).map(
    (key) => `#${ELEMENT_IDS[key]}`,
  );
}

function initAvatarRenderer() {
  const missingAvatarIds = getMissingAvatarElementIds();

  if (missingAvatarIds.length > 0) {
    setAvatarStatus(`Avatar unavailable: missing ${missingAvatarIds.join(", ")}`);
    setAvatarBoneCount(0);
    console.warn(`Avatar unavailable: missing ${missingAvatarIds.join(", ")}`);
    return;
  }

  try {
    state.avatarRenderer = createAvatarRenderer({
      canvas: state.elements.avatarCanvas,
      statusElement: state.elements.avatarStatus,
      boneCountElement: state.elements.avatarBoneCount,
      modelUrl: AVATAR_MODEL_URL,
      depthScale: getInitialAvatarDepthScale(),
    });
    syncAvatarDebugOptions();
    state.avatarInitPromise = state.avatarRenderer
      .init()
      .catch((error) => {
        setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
        setAvatarBoneCount(0);
        console.warn("Avatar initialization failed.", error);
      })
      .finally(() => {
        state.avatarInitPromise = null;
      });
  } catch (error) {
    state.avatarRenderer = null;
    setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
    setAvatarBoneCount(0);
    console.warn("Avatar initialization failed.", error);
  }
}

async function startCamera() {
  if (state.starting || state.active) {
    return;
  }

  clearError();

  if (!hasUsableDom()) {
    setText("cameraStatus", "Unavailable");
    updateControls();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setText("cameraStatus", "Unsupported");
    setError(
      "This browser does not support camera capture. Use a browser with getUserMedia support.",
      "UNSUPPORTED_BROWSER",
    );
    updateControls();
    return;
  }

  const token = ++state.startToken;
  state.starting = true;
  setText("cameraStatus", "Requesting camera");
  updateControls();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
    });

    if (!isCurrentStart(token)) {
      stopStream(stream);
      return;
    }

    state.stream = stream;
    state.inputKind = "camera";
    state.videoFileName = "";
    releaseVideoFileUrl();
    state.elements.video.srcObject = stream;
    state.elements.video.removeAttribute("src");
    state.elements.video.controls = false;
    state.elements.video.loop = false;
    setText("cameraStatus", "Starting camera");
    updateControls();

    await state.elements.video.play();
    await waitForVideoFrame(state.elements.video, "Camera");

    if (!isCurrentStart(token)) {
      return;
    }

    resizeCanvasToVideoFrame();
    setMirrorPreference(true);
    applyMirrorPreference();

    await ensureModelsLoaded();

    if (!isCurrentStart(token)) {
      return;
    }

    state.active = true;
    state.starting = false;
    state.lastVideoTime = -1;
    state.lastFrameTimestamp = 0;
    state.smoothedFps = 0;
    resetBodyValidation();
    setText("cameraStatus", "Running");
    setText("modelStatus", "Ready");
    updateControls();
    scheduleDetectionFrame();
  } catch (error) {
    if (isCurrentStart(token)) {
      const message = getStartupErrorMessage(error);
      setError(message, error?.code ?? "START_FAILED");
      setText("cameraStatus", "Failed");
      stopCamera({
        preserveError: true,
        cameraStatus: "Failed",
        modelStatus: error?.code === "MODEL_LOAD_FAILED" ? "Failed" : undefined,
      });
    }
  } finally {
    if (isCurrentStart(token) && state.starting) {
      state.starting = false;
      updateControls();
    }
  }
}

async function startVideoFile(file) {
  if (state.starting) {
    return;
  }

  if (state.active || state.stream || state.videoFileUrl) {
    stopCamera({ preserveError: true, cameraStatus: "Switching input" });
  }

  clearError();

  if (!hasUsableDom()) {
    setText("cameraStatus", "Unavailable");
    updateControls();
    return;
  }

  if (!isLikelyVideoFile(file)) {
    setText("cameraStatus", "Unsupported file");
    setError("Select a video file such as MP4, WebM, MOV, or M4V.", "UNSUPPORTED_VIDEO_FILE");
    updateControls();
    return;
  }

  const token = ++state.startToken;
  const objectUrl = URL.createObjectURL(file);
  state.starting = true;
  state.inputKind = "video";
  state.videoFileName = file.name;
  state.videoFileUrl = objectUrl;
  setText("cameraStatus", "Loading video");
  updateControls();

  try {
    const { video } = state.elements;
    video.pause();
    video.srcObject = null;
    video.src = objectUrl;
    video.controls = true;
    video.loop = true;
    video.currentTime = 0;

    await video.play();
    await waitForVideoFrame(video, "Video");

    if (!isCurrentStart(token)) {
      return;
    }

    resizeCanvasToVideoFrame();
    setMirrorPreference(false);
    applyMirrorPreference();

    await ensureModelsLoaded();

    if (!isCurrentStart(token)) {
      return;
    }

    state.active = true;
    state.starting = false;
    state.lastVideoTime = -1;
    state.lastFrameTimestamp = 0;
    state.smoothedFps = 0;
    resetBodyValidation();
    setText("cameraStatus", `Video running: ${file.name}`);
    setText("modelStatus", "Ready");
    updateControls();
    scheduleDetectionFrame();
  } catch (error) {
    if (isCurrentStart(token)) {
      setError(getVideoStartupErrorMessage(error), error?.code ?? "VIDEO_START_FAILED");
      setText("cameraStatus", "Failed");
      stopCamera({
        preserveError: true,
        cameraStatus: "Failed",
        modelStatus: error?.code === "MODEL_LOAD_FAILED" ? "Failed" : undefined,
      });
    }
  } finally {
    if (isCurrentStart(token) && state.starting) {
      state.starting = false;
      updateControls();
    }
  }
}

function stopCamera(options = {}) {
  state.startToken += 1;
  state.starting = false;
  state.active = false;
  state.inputKind = "idle";
  state.videoFileName = "";

  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
  }

  if (state.stream) {
    stopStream(state.stream);
    state.stream = null;
  }

  if (state.elements.video) {
    state.elements.video.pause();
    state.elements.video.srcObject = null;
    state.elements.video.removeAttribute("src");
    state.elements.video.controls = false;
    state.elements.video.loop = false;
    state.elements.video.load();
  }

  releaseVideoFileUrl();

  if (state.elements.videoFileInput) {
    state.elements.videoFileInput.value = "";
  }

  state.lastVideoTime = -1;
  state.lastFrameTimestamp = 0;
  state.smoothedFps = 0;
  clearCanvas();
  resetAvatarPose();
  resetMetrics();
  setText("cameraStatus", options.cameraStatus ?? "Stopped");

  if (!state.poseLandmarker && !state.handLandmarker) {
    setText("modelStatus", options.modelStatus ?? "Not loaded");
  }

  if (!options.preserveError) {
    clearError();
  }

  updateControls();
}

function resetAvatarPose() {
  try {
    state.avatarRenderer?.resetPose();
  } catch (error) {
    console.warn("Unable to reset avatar pose.", error);
  }
}

function disposeAvatarRenderer() {
  try {
    state.avatarRenderer?.dispose();
  } catch (error) {
    console.warn("Unable to dispose avatar renderer.", error);
  } finally {
    state.avatarRenderer = null;
    state.avatarInitPromise = null;
  }
}

async function ensureModelsLoaded() {
  const selectedPoseModelKey = getSelectedPoseModelKey();

  if (
    state.poseLandmarker &&
    state.handLandmarker &&
    state.poseModelKey === selectedPoseModelKey
  ) {
    setText("modelStatus", "Ready");
    return;
  }

  if (state.modelLoadPromise) {
    await state.modelLoadPromise;
    return;
  }

  state.modelLoadPromise = loadModels(selectedPoseModelKey);

  try {
    await state.modelLoadPromise;
  } finally {
    state.modelLoadPromise = null;
  }
}

async function loadModels(selectedPoseModelKey) {
  setText("modelStatus", "Loading models");

  try {
    if (!state.vision) {
      state.vision = await FilesetResolver.forVisionTasks(WASM_ASSET_PATH);
    }

    if (!state.handLandmarker) {
      state.handLandmarker = await HandLandmarker.createFromOptions(state.vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }

    if (!state.poseLandmarker || state.poseModelKey !== selectedPoseModelKey) {
      const nextPoseLandmarker = await PoseLandmarker.createFromOptions(state.vision, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URLS[selectedPoseModelKey],
        },
        runningMode: "VIDEO",
        numPoses: 1,
      });
      closeLandmarker(state.poseLandmarker);
      state.poseLandmarker = nextPoseLandmarker;
      state.poseModelKey = selectedPoseModelKey;
    }

    setText("modelStatus", "Ready");
  } catch (error) {
    setText("modelStatus", "Failed");
    const wrapped = new Error(`Model load failed: ${getErrorDetail(error)}`);
    wrapped.code = "MODEL_LOAD_FAILED";
    throw wrapped;
  }
}

function scheduleDetectionFrame() {
  if (!state.active) {
    return;
  }

  state.animationFrameId = requestAnimationFrame(runDetectionFrame);
}

function runDetectionFrame(timestamp) {
  if (!state.active) {
    return;
  }

  try {
    const { video } = state.elements;

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      clearCanvas();
      setError(
        "Input is active, but the video frame is empty.",
        "EMPTY_VIDEO_FRAME",
      );
      setText("cameraStatus", "No video frame");
      scheduleDetectionFrame();
      return;
    }

    if (state.errorCode === "EMPTY_VIDEO_FRAME") {
      clearError();
      setText(
        "cameraStatus",
        state.inputKind === "video" && state.videoFileName
          ? `Video running: ${state.videoFileName}`
          : "Running",
      );
    }

    resizeCanvasToVideoFrame();

    if (video.currentTime === state.lastVideoTime) {
      scheduleDetectionFrame();
      return;
    }

    state.lastVideoTime = video.currentTime;

    const poseResults = state.poseLandmarker.detectForVideo(video, timestamp);
    const handResults = state.handLandmarker.detectForVideo(video, timestamp);

    updateAvatarRenderer(poseResults, handResults, timestamp);
    recordBodyValidation(poseResults, timestamp);
    drawResults(poseResults, handResults);
    updateDetectionMetrics(poseResults, handResults, timestamp);
  } catch (error) {
    setError(`Tracking failed: ${getErrorDetail(error)}`, "TRACKING_FAILED");
    setText("cameraStatus", "Failed");
    stopCamera({ preserveError: true, cameraStatus: "Failed" });
    return;
  }

  scheduleDetectionFrame();
}

function updateAvatarRenderer(poseResults, handResults, timestamp) {
  if (!state.avatarRenderer) {
    return;
  }

  try {
    state.avatarRenderer.update({
      poseResults,
      handResults,
      mirrored: Boolean(state.elements.mirrorToggle?.checked),
      timestamp,
    });
  } catch (error) {
    setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
    console.warn("Avatar update failed.", error);
  }
}

function syncAvatarDebugOptions() {
  try {
    state.avatarRenderer?.setSkeletonVisible?.(
      Boolean(state.elements.avatarSkeletonToggle?.checked),
    );
  } catch (error) {
    console.warn("Unable to update avatar debug options.", error);
  }
}

function recordBodyValidation(poseResults, timestamp) {
  if (!state.avatarRenderer?.getBodyValidationSnapshot) {
    return;
  }

  try {
    const snapshot = state.avatarRenderer.getBodyValidationSnapshot({
      poseResults,
      mirrored: Boolean(state.elements.mirrorToggle?.checked),
      timestamp,
    });
    const visualSnapshot = state.avatarRenderer.getProjectedBodyPoseSnapshot?.({
      poseResults,
      mirrored: Boolean(state.elements.mirrorToggle?.checked),
      timestamp,
    });
    const depthSnapshot = state.avatarRenderer.getDepthValidationSnapshot?.({
      poseResults,
      mirrored: Boolean(state.elements.mirrorToggle?.checked),
      timestamp,
    });
    const sample = {
      timestamp,
      videoTime: Number(state.elements.video?.currentTime ?? 0),
      inputKind: state.inputKind,
      videoFileName: state.videoFileName,
      avatarDepthScale: state.avatarRenderer.getDepthScale?.() ?? null,
      ready: Boolean(snapshot?.ready),
      segments: (snapshot?.segments ?? []).map((segment) => ({
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
      })),
      summary: snapshot?.summary ?? null,
      visualJoints: (visualSnapshot?.joints ?? []).map((joint) => ({
        name: joint.name,
        group: joint.group,
        source: joint.source,
        avatar: joint.avatar,
        error: joint.error,
      })),
      visualSummary: visualSnapshot?.summary ?? null,
      depthSegments: (depthSnapshot?.segments ?? []).map((segment) => ({
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
        flatSourceErrorDeg: segment.flatSourceErrorDeg,
        sourceDepthRatio: segment.sourceDepthRatio,
        sourceDepthDelta: segment.sourceDepthDelta,
        depthSalient: segment.depthSalient,
        matched: segment.matched,
      })),
      depthSummary: depthSnapshot?.summary ?? null,
      depthSource: depthSnapshot?.depthSource ?? null,
      depthReferenceScale: depthSnapshot?.referenceDepthScale ?? null,
      depthSelfReferential: depthSnapshot?.selfReferential ?? null,
      depthMeasurementMode: depthSnapshot?.measurementMode ?? null,
    };

    state.bodyValidation.lastSample = sample;
    state.bodyValidation.samples.push(sample);

    if (state.bodyValidation.samples.length > 5000) {
      state.bodyValidation.samples.splice(0, state.bodyValidation.samples.length - 5000);
    }
  } catch (error) {
    console.warn("Body validation sample skipped.", error);
  }
}

function drawResults(poseResults, handResults) {
  const { context } = state;
  const { canvas } = state.elements;

  if (!context || !canvas) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  for (const landmarks of poseResults?.landmarks ?? []) {
    const bodyLandmarks = landmarks.slice(0, 33);
    drawConnections(bodyLandmarks, POSE_CONNECTIONS, {
      color: "rgba(38, 222, 129, 0.92)",
      lineWidth: 4,
      minVisibility: 0.35,
    });
    drawLandmarks(bodyLandmarks, {
      fillStyle: "#d9ffe9",
      strokeStyle: "#139a52",
      radius: 4,
      minVisibility: 0.35,
    });
  }

  const handLandmarks = (handResults?.landmarks ?? [])
    .slice(0, 2)
    .map((landmarks) => landmarks.slice(0, 21));
  handLandmarks.forEach((landmarks, index) => {
    const label = getHandednessLabel(handResults, index);
    const color = label === "right" ? "#ffb020" : "#38bdf8";
    drawConnections(landmarks, HAND_CONNECTIONS, {
      color,
      lineWidth: 3,
      minVisibility: 0,
    });
    drawLandmarks(landmarks, {
      fillStyle: "#ffffff",
      strokeStyle: color,
      radius: 3.5,
      minVisibility: 0,
    });
  });
}

function drawConnections(landmarks, connections, options) {
  const { context } = state;

  if (!context) {
    return;
  }

  context.save();
  context.strokeStyle = options.color;
  context.lineWidth = options.lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const [startIndex, endIndex] of connections) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];

    if (
      !isDrawableLandmark(start, options.minVisibility) ||
      !isDrawableLandmark(end, options.minVisibility)
    ) {
      continue;
    }

    const startPoint = landmarkToCanvasPoint(start);
    const endPoint = landmarkToCanvasPoint(end);
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.lineTo(endPoint.x, endPoint.y);
    context.stroke();
  }

  context.restore();
}

function drawLandmarks(landmarks, options) {
  const { context } = state;

  if (!context) {
    return;
  }

  context.save();
  context.fillStyle = options.fillStyle;
  context.strokeStyle = options.strokeStyle;
  context.lineWidth = 2;

  for (const landmark of landmarks) {
    if (!isDrawableLandmark(landmark, options.minVisibility)) {
      continue;
    }

    const point = landmarkToCanvasPoint(landmark);
    context.beginPath();
    context.arc(point.x, point.y, options.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  context.restore();
}

function updateDetectionMetrics(poseResults, handResults, timestamp) {
  const poseTotal = poseResults?.landmarks?.length ?? 0;
  const handCounts = countHandLandmarks(handResults);

  setText("poseCount", String(poseTotal));
  setText("leftHandCount", String(handCounts.left));
  setText("rightHandCount", String(handCounts.right));

  if (state.lastFrameTimestamp > 0) {
    const elapsed = timestamp - state.lastFrameTimestamp;

    if (elapsed > 0) {
      const instantFps = 1000 / elapsed;
      state.smoothedFps =
        state.smoothedFps > 0
          ? state.smoothedFps * 0.82 + instantFps * 0.18
          : instantFps;
      setText("fpsValue", state.smoothedFps.toFixed(1));
    }
  } else {
    setText("fpsValue", "0.0");
  }

  state.lastFrameTimestamp = timestamp;
}

function countHandLandmarks(handResults) {
  const counts = { left: 0, right: 0 };
  const landmarksByHand = (handResults?.landmarks ?? []).slice(0, 2);

  landmarksByHand.forEach((landmarks, index) => {
    const label = getHandednessLabel(handResults, index);

    if (label === "right") {
      counts.right += Math.min(landmarks.length, 21);
      return;
    }

    if (label === "left") {
      counts.left += Math.min(landmarks.length, 21);
      return;
    }

    if (counts.left === 0) {
      counts.left += Math.min(landmarks.length, 21);
    } else {
      counts.right += Math.min(landmarks.length, 21);
    }
  });

  return counts;
}

function getHandednessLabel(handResults, index) {
  const category = handResults?.handedness?.[index]?.[0];
  const label = category?.categoryName ?? category?.displayName ?? "";

  return label.toLowerCase();
}

function landmarkToCanvasPoint(landmark) {
  const { canvas, mirrorToggle } = state.elements;
  const mirrored = Boolean(mirrorToggle?.checked);
  const x = landmark.x * canvas.width;

  return {
    x: mirrored ? canvas.width - x : x,
    y: landmark.y * canvas.height,
  };
}

function isDrawableLandmark(landmark, minVisibility) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y)
  ) {
    return false;
  }

  if (typeof landmark.visibility === "number" && landmark.visibility < minVisibility) {
    return false;
  }

  if (typeof landmark.presence === "number" && landmark.presence < minVisibility) {
    return false;
  }

  return true;
}

function resizeCanvasToVideoFrame() {
  const { video, canvas } = state.elements;

  if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
    return false;
  }

  if (canvas.width !== video.videoWidth) {
    canvas.width = video.videoWidth;
  }

  if (canvas.height !== video.videoHeight) {
    canvas.height = video.videoHeight;
  }

  return true;
}

function clearCanvas() {
  const { context } = state;
  const { canvas } = state.elements;

  if (context && canvas) {
    context.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function applyMirrorPreference() {
  const { video, mirrorToggle } = state.elements;

  if (!video) {
    return;
  }

  video.style.transform = mirrorToggle?.checked ? "scaleX(-1)" : "";
  video.style.transformOrigin = "center center";
}

function setMirrorPreference(mirrored) {
  if (state.elements.mirrorToggle) {
    state.elements.mirrorToggle.checked = Boolean(mirrored);
  }
}

function resetMetrics() {
  setText("fpsValue", "0");
  setText("poseCount", "0");
  setText("leftHandCount", "0");
  setText("rightHandCount", "0");
}

function resetBodyValidation() {
  state.bodyValidation.samples = [];
  state.bodyValidation.lastSample = null;
}

function getBodyValidationReport() {
  const samples = state.bodyValidation.samples.slice();
  const framesWithPose = samples.filter((sample) => sample.segments.length > 0);
  const segmentRows = framesWithPose.flatMap((sample) =>
    sample.segments
      .filter((segment) => Number.isFinite(segment.errorDeg))
      .map((segment) => ({
        videoTime: sample.videoTime,
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
      })),
  );
  const visualRows = samples.flatMap((sample) =>
    (sample.visualJoints ?? [])
      .filter((joint) => Number.isFinite(joint.error))
      .map((joint) => ({
        videoTime: sample.videoTime,
        name: joint.name,
        group: joint.group,
        source: joint.source,
        avatar: joint.avatar,
        error: joint.error,
      })),
  );
  const strictValidation = buildStrictValidationReport(samples);
  const depthValidation = buildDepthValidationReport(samples);

  return {
    inputKind: state.inputKind,
    videoFileName: state.videoFileName,
    totalFrames: samples.length,
    framesWithPose: framesWithPose.length,
    poseCoverage:
      samples.length > 0 ? framesWithPose.length / samples.length : 0,
    averageSegmentsPerPoseFrame:
      framesWithPose.length > 0
        ? segmentRows.length / framesWithPose.length
        : 0,
    matchThresholdDeg: BODY_MATCH_THRESHOLD_DEG,
    overall: summarizeErrors(segmentRows),
    byGroup: summarizeRowsByKey(segmentRows, "group"),
    bySegment: summarizeRowsByKey(segmentRows, "name"),
    visualMatchThreshold: BODY_VISUAL_MATCH_THRESHOLD,
    visualOverall: summarizeVisualErrors(visualRows),
    visualByGroup: summarizeVisualRowsByKey(visualRows, "group"),
    visualByJoint: summarizeVisualRowsByKey(visualRows, "name"),
    strictValidation,
    depthValidation,
    visualWorstSamples: visualRows
      .slice()
      .sort((a, b) => b.error - a.error)
      .slice(0, 12),
    worstSamples: segmentRows
      .slice()
      .sort((a, b) => b.errorDeg - a.errorDeg)
      .slice(0, 12),
    lastSample: state.bodyValidation.lastSample,
  };
}

function buildStrictValidationReport(samples) {
  const jointRows = buildStrictJointRows(samples);
  const segmentRows = buildStrictSegmentRows(samples);
  const sideOrderRows = buildStrictSideOrderRows(samples);
  const temporalRows = buildStrictTemporalRows(samples);
  const components = {
    joints: summarizeStrictRows(jointRows, "error"),
    segments: summarizeStrictRows(segmentRows, "combinedError"),
    sideOrder: summarizeStrictRows(sideOrderRows, "mismatch"),
    temporal: summarizeStrictRows(temporalRows, "motionError"),
  };
  const overallScore = weightedStrictScore(components);

  return {
    validationScope: "2d_projection",
    limitations: [
      "Does not validate true front/back physical depth.",
      "Use depthValidation for MediaPipe-relative depth agreement only.",
    ],
    thresholds: {
      jointDistance: BODY_STRICT_JOINT_THRESHOLD,
      segmentAngleDeg: BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG,
      segmentLengthErrorRatio: BODY_STRICT_SEGMENT_LENGTH_ERROR_THRESHOLD,
      minSegmentLength: BODY_STRICT_MIN_SEGMENT_LENGTH,
      sideOrderEpsilon: BODY_STRICT_SIDE_ORDER_EPSILON,
      temporalMinSourceMotion: BODY_STRICT_TEMPORAL_MIN_SOURCE_MOTION,
      temporalMotionError: BODY_STRICT_TEMPORAL_ERROR_THRESHOLD,
      temporalAvatarMotionRatio: [
        BODY_STRICT_TEMPORAL_MIN_AVATAR_RATIO,
        BODY_STRICT_TEMPORAL_MAX_AVATAR_RATIO,
      ],
    },
    scoreWeights: BODY_STRICT_SCORE_WEIGHTS,
    overall: {
      score: overallScore,
      scorePercent: overallScore * 100,
      passTarget: 0.95,
      passed: overallScore >= 0.95,
    },
    components,
    jointsByGroup: summarizeStrictRowsByKey(jointRows, "group", "error"),
    jointsByName: summarizeStrictRowsByKey(jointRows, "name", "error"),
    segmentsByGroup: summarizeStrictRowsByKey(segmentRows, "group", "combinedError"),
    segmentsByName: summarizeStrictRowsByKey(segmentRows, "name", "combinedError"),
    sideOrderByGroup: summarizeStrictRowsByKey(sideOrderRows, "group", "mismatch"),
    temporalByGroup: summarizeStrictRowsByKey(temporalRows, "group", "motionError"),
    temporalByName: summarizeStrictRowsByKey(temporalRows, "name", "motionError"),
    worstJoints: jointRows
      .slice()
      .sort((a, b) => b.error - a.error)
      .slice(0, 12),
    worstSegments: segmentRows
      .slice()
      .sort((a, b) => b.combinedError - a.combinedError)
      .slice(0, 12),
    worstTemporal: temporalRows
      .slice()
      .sort((a, b) => b.motionError - a.motionError)
      .slice(0, 12),
    sideOrderMismatches: sideOrderRows.filter((row) => !row.matched).slice(0, 12),
  };
}

function buildDepthValidationReport(samples) {
  const depthRows = samples.flatMap((sample) =>
    (sample.depthSegments ?? [])
      .filter((segment) => Number.isFinite(segment.errorDeg))
      .map((segment) => ({
        videoTime: sample.videoTime,
        depthScale: sample.avatarDepthScale,
        depthSource: sample.depthSource,
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
        flatSourceErrorDeg: segment.flatSourceErrorDeg,
        sourceDepthRatio: segment.sourceDepthRatio,
        sourceDepthDelta: segment.sourceDepthDelta,
        depthSalient: Boolean(segment.depthSalient),
        matched: Boolean(segment.matched),
      })),
  );
  const depthSalientRows = depthRows.filter((row) => row.depthSalient);
  const depthScales = [
    ...new Set(
      samples
        .map((sample) => sample.avatarDepthScale)
        .filter((value) => Number.isFinite(value)),
    ),
  ];
  const referenceDepthScales = [
    ...new Set(
      samples
        .map((sample) => sample.depthReferenceScale)
        .filter((value) => Number.isFinite(value)),
    ),
  ];
  const measurementModes = [
    ...new Set(samples.map((sample) => sample.depthMeasurementMode).filter(Boolean)),
  ];
  const selfReferential = samples.some((sample) => sample.depthSelfReferential === true);

  return {
    validationScope: "mediapipe_relative_depth",
    independentGroundTruth: false,
    selfReferential,
    measurementModes,
    limitations: [
      "This is not ground-truth physical depth.",
      "It measures agreement with MediaPipe-provided relative z/world depth.",
      "When depthScale equals the reference depth scale, this reports retarget residual against the same MediaPipe depth signal, not independent depth quality.",
      "Single-camera front/back ambiguity can still be wrong when landmarks are occluded or inferred.",
    ],
    performanceGate: {
      projectionScoreMustStayAtLeast: 0.95,
      depthScaleBaseline: 0,
      requiredImprovement:
        "Compared with depthScale 0, depthSalient meanErrorDeg should improve by >=10% or matchRate by >=10 percentage points.",
    },
    depthScales,
    referenceDepthScales,
    depthSources: [...new Set(depthRows.map((row) => row.depthSource).filter(Boolean))],
    overall: summarizeDepthErrors(depthRows),
    depthSalient: summarizeDepthErrors(depthSalientRows),
    byGroup: summarizeDepthRowsByKey(depthRows, "group"),
    bySegment: summarizeDepthRowsByKey(depthRows, "name"),
    salientByGroup: summarizeDepthRowsByKey(depthSalientRows, "group"),
    worstSamples: depthRows
      .slice()
      .sort((a, b) => b.errorDeg - a.errorDeg)
      .slice(0, 12),
    worstDepthSalientSamples: depthSalientRows
      .slice()
      .sort((a, b) => b.errorDeg - a.errorDeg)
      .slice(0, 12),
  };
}

function buildStrictJointRows(samples) {
  return samples.flatMap((sample) =>
    (sample.visualJoints ?? [])
      .map((joint) => {
        if (!hasPointArray(joint.source) || !hasPointArray(joint.avatar)) {
          return null;
        }

        const error = Number(joint.error);

        if (!Number.isFinite(error)) {
          return null;
        }

        return {
          videoTime: sample.videoTime,
          name: joint.name,
          group: joint.group,
          error,
          matched: error <= BODY_STRICT_JOINT_THRESHOLD,
          source: joint.source,
          avatar: joint.avatar,
        };
      })
      .filter(Boolean),
  );
}

function buildStrictSegmentRows(samples) {
  return samples.flatMap((sample) => {
    const joints = visualJointMap(sample);

    return BODY_STRICT_SEGMENTS
      .map((segment) => {
        const sourceFrom = joints.get(segment.from)?.source;
        const sourceTo = joints.get(segment.to)?.source;
        const avatarFrom = joints.get(segment.from)?.avatar;
        const avatarTo = joints.get(segment.to)?.avatar;

        if (
          !hasPointArray(sourceFrom) ||
          !hasPointArray(sourceTo) ||
          !hasPointArray(avatarFrom) ||
          !hasPointArray(avatarTo)
        ) {
          return null;
        }

        const sourceVector = vector2D(sourceFrom, sourceTo);
        const avatarVector = vector2D(avatarFrom, avatarTo);
        const sourceLength = vectorLength(sourceVector);
        const avatarLength = vectorLength(avatarVector);

        if (
          sourceLength < BODY_STRICT_MIN_SEGMENT_LENGTH ||
          avatarLength < BODY_STRICT_MIN_SEGMENT_LENGTH
        ) {
          return null;
        }

        const angleErrorDeg = angleBetweenVectorsDeg(sourceVector, avatarVector);
        const lengthErrorRatio = Math.abs(avatarLength / sourceLength - 1);
        const angleScore = angleErrorDeg / BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG;
        const lengthScore = lengthErrorRatio / BODY_STRICT_SEGMENT_LENGTH_ERROR_THRESHOLD;
        const combinedError = Math.max(angleScore, lengthScore);

        return {
          videoTime: sample.videoTime,
          name: segment.name,
          group: segment.group,
          from: segment.from,
          to: segment.to,
          angleErrorDeg,
          lengthErrorRatio,
          combinedError,
          matched:
            angleErrorDeg <= BODY_STRICT_SEGMENT_ANGLE_THRESHOLD_DEG &&
            lengthErrorRatio <= BODY_STRICT_SEGMENT_LENGTH_ERROR_THRESHOLD,
        };
      })
      .filter(Boolean);
  });
}

function buildStrictSideOrderRows(samples) {
  return samples.flatMap((sample) => {
    const joints = visualJointMap(sample);

    return BODY_STRICT_SIDE_ORDER_PAIRS
      .map((pair) => {
        const sourceLeft = joints.get(pair.left)?.source;
        const sourceRight = joints.get(pair.right)?.source;
        const avatarLeft = joints.get(pair.left)?.avatar;
        const avatarRight = joints.get(pair.right)?.avatar;

        if (
          !hasPointArray(sourceLeft) ||
          !hasPointArray(sourceRight) ||
          !hasPointArray(avatarLeft) ||
          !hasPointArray(avatarRight)
        ) {
          return null;
        }

        const sourceDelta = sourceLeft[0] - sourceRight[0];
        const avatarDelta = avatarLeft[0] - avatarRight[0];

        if (
          Math.abs(sourceDelta) < BODY_STRICT_SIDE_ORDER_EPSILON ||
          Math.abs(avatarDelta) < BODY_STRICT_SIDE_ORDER_EPSILON
        ) {
          return null;
        }

        const matched = Math.sign(sourceDelta) === Math.sign(avatarDelta);

        return {
          videoTime: sample.videoTime,
          name: pair.name,
          group: pair.group,
          sourceDelta,
          avatarDelta,
          mismatch: matched ? 0 : 1,
          matched,
        };
      })
      .filter(Boolean);
  });
}

function buildStrictTemporalRows(samples) {
  const rows = [];
  let previous = null;

  for (const sample of samples) {
    const current = visualJointMap(sample);

    if (!previous || current.size === 0) {
      previous = { sample, joints: current };
      continue;
    }

    const elapsed = Math.max(0, sample.videoTime - previous.sample.videoTime);

    for (const [name, joint] of current) {
      const previousJoint = previous.joints.get(name);

      if (
        !previousJoint ||
        !hasPointArray(joint.source) ||
        !hasPointArray(joint.avatar) ||
        !hasPointArray(previousJoint.source) ||
        !hasPointArray(previousJoint.avatar)
      ) {
        continue;
      }

      const sourceDelta = vector2D(previousJoint.source, joint.source);
      const avatarDelta = vector2D(previousJoint.avatar, joint.avatar);
      const sourceMotion = vectorLength(sourceDelta);
      const avatarMotion = vectorLength(avatarDelta);

      if (sourceMotion < BODY_STRICT_TEMPORAL_MIN_SOURCE_MOTION) {
        continue;
      }

      const motionError = vectorLength({
        x: sourceDelta.x - avatarDelta.x,
        y: sourceDelta.y - avatarDelta.y,
      });
      const motionRatio = avatarMotion / sourceMotion;
      const matched =
        motionError <= BODY_STRICT_TEMPORAL_ERROR_THRESHOLD &&
        motionRatio >= BODY_STRICT_TEMPORAL_MIN_AVATAR_RATIO &&
        motionRatio <= BODY_STRICT_TEMPORAL_MAX_AVATAR_RATIO;

      rows.push({
        videoTime: sample.videoTime,
        elapsed,
        name,
        group: joint.group,
        sourceMotion,
        avatarMotion,
        motionRatio,
        motionError,
        matched,
      });
    }

    previous = { sample, joints: current };
  }

  return rows;
}

function visualJointMap(sample) {
  const map = new Map();

  for (const joint of sample?.visualJoints ?? []) {
    map.set(joint.name, joint);
  }

  return map;
}

function weightedStrictScore(components) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(BODY_STRICT_SCORE_WEIGHTS)) {
    const component = components[key];

    if (!component || component.count === 0) {
      continue;
    }

    totalWeight += weight;
    weightedSum += component.matchRate * weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

function exposeDebugApi() {
  globalThis.motionTrackerDebug = {
    getBodyValidationReport,
    getBodyValidationSamples: () => state.bodyValidation.samples.slice(),
    getLastBodyValidationSample: () => state.bodyValidation.lastSample,
    getAvatarDepthScale: () => state.avatarRenderer?.getDepthScale?.() ?? null,
    setAvatarDepthScale: (value) => {
      const nextScale = state.avatarRenderer?.setDepthScale?.(value) ?? null;
      resetBodyValidation();
      return nextScale;
    },
    getAvatarViewState: () => state.avatarRenderer?.getViewState?.() ?? null,
    resetAvatarView: () => state.avatarRenderer?.resetView?.() ?? null,
    clearBodyValidation: resetBodyValidation,
  };
}

function summarizeRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => candidate[key] === value);

    if (!result[value]) {
      result[value] = summarizeErrors(groupRows);
    }

    return result;
  }, {});
}

function summarizeVisualRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => candidate[key] === value);

    if (!result[value]) {
      result[value] = summarizeVisualErrors(groupRows);
    }

    return result;
  }, {});
}

function summarizeStrictRowsByKey(rows, key, valueKey) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => candidate[key] === value);

    if (!result[value]) {
      result[value] = summarizeStrictRows(groupRows, valueKey);
    }

    return result;
  }, {});
}

function summarizeDepthRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => candidate[key] === value);

    if (!result[value]) {
      result[value] = summarizeDepthErrors(groupRows);
    }

    return result;
  }, {});
}

function summarizeStrictRows(rows, valueKey) {
  const values = rows
    .map((row) => row[valueKey])
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = rows.filter((row) => row.matched).length;

  return {
    count: rows.length,
    matchedCount,
    matchRate: rows.length > 0 ? matchedCount / rows.length : 0,
    mean: average(values),
    median: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    max: values.length > 0 ? values[values.length - 1] : 0,
  };
}

function summarizeDepthErrors(rows) {
  const errors = rows
    .map((row) => row.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const sourceDepthRatios = rows
    .map((row) => row.sourceDepthRatio)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const flatSourceErrors = rows
    .map((row) => row.flatSourceErrorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = rows.filter((row) => row.matched).length;

  return {
    count: rows.length,
    matchedCount,
    matchRate: rows.length > 0 ? matchedCount / rows.length : 0,
    meanErrorDeg: average(errors),
    medianErrorDeg: percentile(errors, 0.5),
    p90ErrorDeg: percentile(errors, 0.9),
    maxErrorDeg: errors.length > 0 ? errors[errors.length - 1] : 0,
    meanSourceDepthRatio: average(sourceDepthRatios),
    p90SourceDepthRatio: percentile(sourceDepthRatios, 0.9),
    meanFlatSourceErrorDeg: average(flatSourceErrors),
  };
}

function summarizeErrors(rows) {
  const values = rows
    .map((row) => row.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return {
    count: values.length,
    matchedCount: values.filter((value) => value <= BODY_MATCH_THRESHOLD_DEG).length,
    matchRate:
      values.length > 0
        ? values.filter((value) => value <= BODY_MATCH_THRESHOLD_DEG).length / values.length
        : 0,
    matchThresholdDeg: BODY_MATCH_THRESHOLD_DEG,
    meanErrorDeg: average(values),
    medianErrorDeg: percentile(values, 0.5),
    p90ErrorDeg: percentile(values, 0.9),
    maxErrorDeg: values.length > 0 ? values[values.length - 1] : 0,
  };
}

function summarizeVisualErrors(rows) {
  const values = rows
    .map((row) => row.error)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = values.filter((value) => value <= BODY_VISUAL_MATCH_THRESHOLD).length;

  return {
    count: values.length,
    matchedCount,
    matchRate: values.length > 0 ? matchedCount / values.length : 0,
    matchThreshold: BODY_VISUAL_MATCH_THRESHOLD,
    meanError: average(values),
    medianError: percentile(values, 0.5),
    p90Error: percentile(values, 0.9),
    maxError: values.length > 0 ? values[values.length - 1] : 0,
  };
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * fraction) - 1),
  );
  return sortedValues[index];
}

function hasPointArray(value) {
  return Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]);
}

function vector2D(from, to) {
  return {
    x: to[0] - from[0],
    y: to[1] - from[1],
  };
}

function vectorLength(vector) {
  return Math.hypot(vector.x, vector.y);
}

function angleBetweenVectorsDeg(a, b) {
  const aLength = vectorLength(a);
  const bLength = vectorLength(b);

  if (aLength < 0.0001 || bLength < 0.0001) {
    return 0;
  }

  const dot = a.x * b.x + a.y * b.y;
  const cosine = Math.min(1, Math.max(-1, dot / (aLength * bLength)));

  return Math.acos(cosine) * (180 / Math.PI);
}

function updateControls() {
  const missingRequiredDom = state.missingIds.length > 0 || !state.context;

  if (state.elements.startButton) {
    state.elements.startButton.disabled =
      missingRequiredDom || state.starting || state.active;
  }

  if (state.elements.stopButton) {
    state.elements.stopButton.disabled =
      missingRequiredDom ||
      (!state.starting && !state.active && !state.stream && !state.videoFileUrl);
  }

  if (state.elements.videoFileInput) {
    state.elements.videoFileInput.disabled = missingRequiredDom || state.starting;
  }

  if (state.elements.avatarSkeletonToggle) {
    state.elements.avatarSkeletonToggle.disabled = false;
  }

  if (state.elements.modelSelect) {
    state.elements.modelSelect.disabled = state.starting || state.active;
  }
}

function hasUsableDom() {
  if (state.missingIds.length > 0) {
    setError(
      `Missing required UI elements: ${state.missingIds.join(", ")}`,
      "MISSING_DOM",
    );
    return false;
  }

  if (!state.context) {
    setError("Canvas rendering is unavailable in this browser.", "CANVAS_UNSUPPORTED");
    return false;
  }

  return true;
}

function waitForVideoFrame(video, sourceLabel = "Input") {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(() => {
        const error = new Error(`${sourceLabel} started, but the video frame is empty.`);
        error.code = "EMPTY_VIDEO_FRAME";
        reject(error);
      });
    }, 8000);

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      video.removeEventListener("loadedmetadata", handleReady);
      video.removeEventListener("loadeddata", handleReady);
      video.removeEventListener("canplay", handleReady);
      video.removeEventListener("error", handleError);
      callback();
    };

    const handleReady = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        finish(resolve);
      }
    };

    const handleError = () => {
      finish(() => reject(new Error(`${sourceLabel} video failed to load.`)));
    };

    if (video.videoWidth > 0 && video.videoHeight > 0) {
      finish(resolve);
      return;
    }

    video.addEventListener("loadedmetadata", handleReady);
    video.addEventListener("loadeddata", handleReady);
    video.addEventListener("canplay", handleReady);
    video.addEventListener("error", handleError);
  });
}

function getSelectedPoseModelKey() {
  const rawValue = state.elements.modelSelect?.value ?? "";
  const normalizedValue = rawValue.trim().toLowerCase();

  return POSE_MODEL_KEYS_BY_OPTION[normalizedValue] ?? "pose_full";
}

function getInitialAvatarDepthScale() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("depth-scale");

  if (value === null) {
    return DEFAULT_AVATAR_DEPTH_SCALE;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return DEFAULT_AVATAR_DEPTH_SCALE;
  }

  return Math.min(1.5, Math.max(0, number));
}

function isLikelyVideoFile(file) {
  if (!file) {
    return false;
  }

  if (file.type?.startsWith("video/")) {
    return true;
  }

  return /\.(m4v|mov|mp4|ogv|webm)$/i.test(file.name ?? "");
}

function releaseVideoFileUrl() {
  if (!state.videoFileUrl) {
    return;
  }

  URL.revokeObjectURL(state.videoFileUrl);
  state.videoFileUrl = "";
}

function getStartupErrorMessage(error) {
  if (error?.code === "MODEL_LOAD_FAILED") {
    return error.message;
  }

  if (error?.code === "EMPTY_VIDEO_FRAME") {
    return "Camera started, but the video frame is empty. Check the camera and try again.";
  }

  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "Camera permission was denied. Allow camera access and try again.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No camera was found. Connect a camera and try again.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The camera is already in use or unavailable. Close other camera apps and try again.";
  }

  return `Unable to start tracking: ${getErrorDetail(error)}`;
}

function getVideoStartupErrorMessage(error) {
  if (error?.code === "MODEL_LOAD_FAILED") {
    return error.message;
  }

  if (error?.code === "EMPTY_VIDEO_FRAME") {
    return "Video started, but the frame is empty. Check the file and try again.";
  }

  return `Unable to start video tracking: ${getErrorDetail(error)}`;
}

function setText(key, value) {
  const element = state.elements[key];

  if (element) {
    element.textContent = value;
  }
}

function setAvatarStatus(value) {
  setText("avatarStatus", value);
}

function setAvatarBoneCount(value) {
  setText("avatarBoneCount", String(value));
}

function setError(message, code = "ERROR") {
  state.errorCode = code;

  if (state.elements.errorMessage) {
    state.elements.errorMessage.textContent = message;
    state.elements.errorMessage.hidden = false;
  } else {
    console.error(message);
  }
}

function clearError() {
  state.errorCode = null;

  if (state.elements.errorMessage) {
    state.elements.errorMessage.textContent = "";
    state.elements.errorMessage.hidden = true;
  }
}

function stopStream(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function closeLandmarker(landmarker) {
  try {
    landmarker?.close?.();
  } catch (error) {
    console.warn("Unable to close MediaPipe landmarker.", error);
  }
}

function isCurrentStart(token) {
  return token === state.startToken;
}

function getErrorDetail(error) {
  return error?.message || String(error);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
