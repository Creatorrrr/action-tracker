import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import { createAvatarRenderer } from "./avatar-renderer.js?v=20260704-vrm-head-axis-1";
import {
  MOTION_RECORDING_FRAME_LIMIT,
  createMotionFrame,
  createMotionRecording,
  isMotionFrame,
  motionFrameToHandResults,
  motionFrameToPoseResults,
  normalizeFace,
  normalizeMotionRecording,
  parseMotionRecordingJsonl,
  serializeMotionFrame,
  serializeMotionRecordingJsonl,
} from "./motion-frame.js?v=20260702-recording-jsonl-1";
import { createMotionForwarder } from "./motion-forwarding.js?v=20260529-face-expression-1";
import {
  createPresenceState,
  updatePresenceState,
} from "./presence-state.js?v=20260703-csi-presence-1";
import {
  DEPTH_CALIBRATION_CLAMP_WARNING_RATIO,
  DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
  DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
  DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS,
  DEPTH_CALIBRATION_MODE_DYNAMIC,
  DEPTH_CALIBRATION_MODE_STATIC,
  DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE,
  DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS,
  DEPTH_CALIBRATION_SOLVE_STEPS,
  DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD,
  DEPTH_CALIBRATION_TARGET_SCORE,
  evaluateDepthCalibrationSegmentGate,
  normalizeDepthCalibrationMode,
  summarizeLengthConsistency,
} from "./depth-calibration.js?v=20260529-face-expression-1";

const WASM_ASSET_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const AVATAR_MODEL_URL = "./assets/models/Xbot.glb";
const DEFAULT_AVATAR_DEPTH_SCALE = 0.45;
const DETECTION_PUMP_AUTO = "auto";
const DETECTION_PUMP_RAF = "raf";
const DETECTION_PUMP_RVFC = "rvfc";
const DETECTION_PUMP_MODES = new Set([
  DETECTION_PUMP_AUTO,
  DETECTION_PUMP_RAF,
  DETECTION_PUMP_RVFC,
]);
const AVATAR_SMOOTHING_MODE_OFF = "off";
const AVATAR_SMOOTHING_MODE_RETARGET = "retarget";
const AVATAR_SMOOTHING_MODE_STRONG = "strong";
const AVATAR_SMOOTHING_MODE_ALIASES = {
  off: AVATAR_SMOOTHING_MODE_OFF,
  none: AVATAR_SMOOTHING_MODE_OFF,
  "0": AVATAR_SMOOTHING_MODE_OFF,
  false: AVATAR_SMOOTHING_MODE_OFF,
  retarget: AVATAR_SMOOTHING_MODE_RETARGET,
  on: AVATAR_SMOOTHING_MODE_RETARGET,
  "1": AVATAR_SMOOTHING_MODE_RETARGET,
  true: AVATAR_SMOOTHING_MODE_RETARGET,
  strong: AVATAR_SMOOTHING_MODE_STRONG,
};
const AVATAR_RETARGET_MODE_LEGACY = "legacy";
const AVATAR_RETARGET_MODE_STRICT = "strict";
const AVATAR_RETARGET_MODE_ALIASES = {
  legacy: AVATAR_RETARGET_MODE_LEGACY,
  default: AVATAR_RETARGET_MODE_STRICT,
  retarget: AVATAR_RETARGET_MODE_LEGACY,
  strict: AVATAR_RETARGET_MODE_STRICT,
  "skeleton-direct": AVATAR_RETARGET_MODE_STRICT,
  skeleton: AVATAR_RETARGET_MODE_STRICT,
  fk: AVATAR_RETARGET_MODE_STRICT,
};
const DEPTH_CALIBRATION_GATE_SEGMENT_NAMES = new Set(
  DEPTH_CALIBRATION_SOLVE_STEPS.map((step) => step.segmentName),
);
const APP_PERFORMANCE_SAMPLE_LIMIT = 900;
const TRACKING_WORKER_TIMEOUT_MS = 10000;
const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
const MAX_STALE_VIDEO_FRAME_CALLBACK_MS = 66;
const MAX_CONSECUTIVE_STALE_VIDEO_FRAME_SKIPS = 2;
const MOTION_STATUS_HUD_INTERVAL_MS = 250;
const VIDEO_TIMELINE_REWIND_EPSILON_SEC = 0.05;

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
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const BODY_MATCH_THRESHOLD_DEG = 30;
const BODY_VISUAL_MATCH_THRESHOLD = 0.35;
const BODY_PROJECTED_SEGMENT_ANGLE_THRESHOLD_DEG = 35;
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
const BODY_MOTION_AGREEMENT_SCORE_WEIGHTS = {
  direction: 0.85,
  frontBack: 0.15,
  projection: 0,
};
const BODY_MOTION_AGREEMENT_EXCLUDED_SEGMENTS = new Set(["neck", "head"]);
const BODY_MOTION_AGREEMENT_FRONT_BACK_DEPTH_MIN_SAMPLES = 12;
const BODY_MOTION_AGREEMENT_FRONT_BACK_VISUAL_FLOOR = 0.8;

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
const BODY_FRONT_BACK_SIDE_ORDER_PAIRS = BODY_STRICT_SIDE_ORDER_PAIRS.filter(
  (pair) => pair.name === "shoulders" || pair.name === "hips",
);

const ELEMENT_IDS = {
  video: "camera-video",
  canvas: "overlay-canvas",
  startButton: "start-button",
  stopButton: "stop-button",
  videoFileInput: "video-file-input",
  avatarFileInput: "avatar-file-input",
  avatarDefaultButton: "avatar-default-button",
  mirrorToggle: "mirror-toggle",
  faceTrackingToggle: "face-tracking-toggle",
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
  avatarFaceStatus: "avatar-face-status",
  avatarExpressionStatus: "avatar-expression-status",
  motionStatusFacing: "motion-status-facing",
  motionStatusMode: "motion-status-mode",
  motionStatusQuality: "motion-status-quality",
  motionStatusDelegate: "motion-status-delegate",
  motionStatusFps: "motion-status-fps",
  motionStatusFrameAge: "motion-status-frame-age",
  motionStatusSolver: "motion-status-solver",
  motionStatusDrops: "motion-status-drops",
  motionStatusCalibration: "motion-status-calibration",
  motionStatusCalibrationGuide: "motion-status-calibration-guide",
  motionStatusCalibrateButton: "motion-status-calibrate",
};

const REQUIRED_ELEMENT_KEYS = [
  "video",
  "canvas",
  "startButton",
  "stopButton",
  "videoFileInput",
  "mirrorToggle",
  "faceTrackingToggle",
  "avatarSkeletonToggle",
  "modelSelect",
  "cameraStatus",
  "modelStatus",
  "fpsValue",
  "poseCount",
  "leftHandCount",
  "rightHandCount",
  "errorMessage",
  "motionStatusFacing",
  "motionStatusMode",
  "motionStatusQuality",
  "motionStatusDelegate",
  "motionStatusFps",
  "motionStatusFrameAge",
  "motionStatusSolver",
  "motionStatusDrops",
  "motionStatusCalibration",
  "motionStatusCalibrationGuide",
];
const AVATAR_ELEMENT_KEYS = [
  "avatarCanvas",
  "avatarStatus",
  "avatarBoneCount",
  "avatarFaceStatus",
  "avatarExpressionStatus",
];

const EXPRESSION_COVERAGE_GROUPS = [
  { label: "Blink", presets: ["blink", "blinkLeft", "blinkRight"] },
  { label: "Mouth", presets: ["aa", "ih", "ou", "ee", "oh"] },
  { label: "Emotion", presets: ["happy", "angry", "sad", "surprised", "relaxed"] },
  { label: "Look", presets: ["lookUp", "lookDown", "lookLeft", "lookRight"] },
];

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
  faceLandmarker: null,
  poseModelKey: null,
  modelLoadPromise: null,
  faceTracking: {
    enabled: getInitialFaceTrackingEnabled(),
    landmarksEnabled: getInitialFaceLandmarksEnabled(),
    status: getInitialFaceTrackingEnabled() ? "enabled" : "disabled",
    detectFrames: 0,
    facesDetected: 0,
    lastTimestamp: 0,
    lastError: "",
  },
  stream: null,
  videoFileUrl: "",
  avatarFileUrl: "",
  avatarFileName: "",
  inputKind: "idle",
  videoFileName: "",
  animationFrameId: 0,
  videoFrameRequestId: 0,
  active: false,
  starting: false,
  startToken: 0,
  lastVideoTime: -1,
  lastFrameTimestamp: 0,
  smoothedFps: 0,
  errorCode: null,
  debugOverlayEnabled: true,
  avatarSmoothingMode: getInitialAvatarSmoothingMode(),
  avatarRetargetMode: getInitialAvatarRetargetMode(),
  detectionPump: {
    requestedMode: DETECTION_PUMP_AUTO,
    activeMode: DETECTION_PUMP_RAF,
    supportsVideoFrameCallback: false,
    callbacks: 0,
    processedFrames: 0,
    duplicateFrames: 0,
    emptyFrames: 0,
    busySkips: 0,
    latestWinsFrames: 0,
    staleFrameCallbacks: 0,
    timelineResets: 0,
    lastTimelineResetReason: "",
    consecutiveStaleFrameCallbacks: 0,
    errors: 0,
    busy: false,
    pendingLatestFrame: null,
  },
  trackingWorker: {
    requested: getInitialTrackingWorkerEnabled(),
    supported: supportsTrackingWorker(),
    active: false,
    status: getInitialTrackingWorkerEnabled() ? "requested" : "disabled",
    worker: null,
    initPromise: null,
    requestId: 0,
    pendingRequests: new Map(),
    poseModelKey: "",
    faceTrackingEnabled: false,
    faceLandmarksEnabled: false,
    frames: 0,
    errors: 0,
    fallbacks: 0,
    fallbackReason: "",
    detectorDelegates: null,
  },
  detectorDelegates: {
    requested: getInitialMediaPipeDelegate(),
    fallback: MEDIAPIPE_FALLBACK_DELEGATE,
    hand: "unloaded",
    pose: "unloaded",
    face: "unloaded",
    lastFallbackReason: "",
    attempted: {},
    fallbackReasons: {},
  },
  appPerformance: {
    startedAt: 0,
    lastCallbackTimestamp: 0,
    lastProcessedTimestamp: 0,
    callbackIntervalsMs: [],
    detectIntervalsMs: [],
    detectMs: [],
    faceDetectMs: [],
    faceProcessMs: [],
    processMs: [],
    drawMs: [],
    frameTotalMs: [],
    frameAgeMs: [],
    frameCallbackLagMs: [],
  },
  motionStatusHud: {
    lastUpdatedAt: 0,
    lastSnapshot: null,
  },
  presenceTracking: createPresenceState(),
  avatarRenderer: null,
  avatarInitPromise: null,
  avatarLoadToken: 0,
  bodyValidation: {
    enabled: getInitialValidationEnabled(),
    samples: [],
    lastSample: null,
  },
  motionRecording: {
    active: false,
    createdAt: "",
    source: null,
    frames: [],
    droppedFrames: 0,
    lastRecording: null,
  },
  motionReplay: {
    active: false,
    recording: null,
    frameIndex: 0,
    animationFrameId: 0,
    startedAt: 0,
    baseTimestamp: 0,
  },
  motionForwarder: createMotionForwarder(),
  latestMotionFrame: null,
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

  configureDetectionRuntime();
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
  state.elements.video?.addEventListener("seeked", () => {
    resetVideoTimelineState("seeked");
  });
  state.elements.avatarFileInput?.addEventListener("change", () => {
    const file = state.elements.avatarFileInput.files?.[0];

    if (file) {
      useAvatarModelFile(file);
    }
  });
  state.elements.avatarDefaultButton?.addEventListener("click", () => {
    useDefaultAvatarModel();
  });
  state.elements.mirrorToggle?.addEventListener("change", () => {
    applyMirrorPreference();
    if (state.active) {
      clearCanvas();
    }
  });
  state.elements.faceTrackingToggle?.addEventListener("change", () => {
    void setFaceTrackingEnabled(Boolean(state.elements.faceTrackingToggle?.checked));
  });
  state.elements.avatarSkeletonToggle?.addEventListener("change", () => {
    syncAvatarDebugOptions();
  });
  state.elements.avatarViewReset?.addEventListener("click", () => {
    state.avatarRenderer?.resetView?.();
  });
  state.elements.motionStatusCalibrateButton?.addEventListener("click", () => {
    resetDepthCalibrationFromUi();
  });
  state.elements.modelSelect?.addEventListener("change", () => {
    clearError();
    if (state.poseLandmarker && state.poseModelKey !== getSelectedPoseModelKey()) {
      setText("modelStatus", "Model selected");
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCamera({ preserveError: true });
    disposeTrackingWorker();
    disposeAvatarRenderer();
    releaseAvatarFileUrl();
  });
  window.addEventListener("pagehide", () => {
    stopCamera({ preserveError: true });
    disposeTrackingWorker();
    disposeAvatarRenderer();
    releaseAvatarFileUrl();
  });

  exposeDebugApi();
  syncFaceTrackingControl();
  updateFaceExpressionStatus();
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

  const loadToken = ++state.avatarLoadToken;
  const modelUrl = getSelectedAvatarModelUrl();
  const modelLabel = state.avatarFileName || "Xbot.glb";

  try {
    state.avatarRenderer = createAvatarRenderer({
      canvas: state.elements.avatarCanvas,
      statusElement: state.elements.avatarStatus,
      boneCountElement: state.elements.avatarBoneCount,
      modelUrl,
      modelLabel,
      depthScale: getInitialAvatarDepthScale(),
      depthCalibrationMode: getInitialAvatarDepthCalibrationMode(),
      smoothingMode: state.avatarSmoothingMode,
      retargetMode: state.avatarRetargetMode,
    });
    syncAvatarDebugOptions();
    void applyInitialDepthCalibrationProfile();
    state.avatarInitPromise = state.avatarRenderer
      .init()
      .catch((error) => {
        if (loadToken !== state.avatarLoadToken) {
          return;
        }

        setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
        setAvatarBoneCount(0);
        console.warn("Avatar initialization failed.", error);
      })
      .finally(() => {
        if (loadToken === state.avatarLoadToken) {
          updateFaceExpressionStatus();
          state.avatarInitPromise = null;
        }
      });
  } catch (error) {
    state.avatarRenderer = null;
    setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
    setAvatarBoneCount(0);
    console.warn("Avatar initialization failed.", error);
  }
}

async function applyInitialDepthCalibrationProfile() {
  const profileUrl = getInitialDepthCalibrationProfileUrl();

  if (!profileUrl || !state.avatarRenderer?.setDepthCalibrationReference) {
    return;
  }

  try {
    const response = await fetch(profileUrl);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const profile = await response.json();
    state.avatarRenderer.setDepthCalibrationReference(profile);
    resetBodyValidation();
  } catch (error) {
    console.warn("Failed to load depth calibration profile.", profileUrl, error);
  }
}

async function startCamera() {
  if (state.starting || state.active) {
    return;
  }

  stopMotionReplay({ resetPose: true, silent: true });
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
    configureDetectionRuntime();

    await ensureModelsLoaded();

    if (!isCurrentStart(token)) {
      return;
    }

    state.active = true;
    state.starting = false;
    state.lastVideoTime = -1;
    state.lastFrameTimestamp = 0;
    state.smoothedFps = 0;
    resetAppPerformance();
    resetBodyValidation();
    resetPresenceTracking();
    state.avatarRenderer?.resetDepthCalibration?.();
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

  stopMotionReplay({ resetPose: true, silent: true });

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
    configureDetectionRuntime();

    await ensureModelsLoaded();

    if (!isCurrentStart(token)) {
      return;
    }

    state.active = true;
    state.starting = false;
    state.lastVideoTime = -1;
    state.lastFrameTimestamp = 0;
    state.smoothedFps = 0;
    resetAppPerformance();
    resetBodyValidation();
    resetPresenceTracking();
    state.avatarRenderer?.resetDepthCalibration?.();
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

  if (!options.preserveReplay) {
    stopMotionReplay({ resetPose: false, silent: true });
  }

  if (state.animationFrameId) {
    cancelAnimationFrame(state.animationFrameId);
    state.animationFrameId = 0;
  }

  cancelVideoFrameRequest();

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
  resetPresenceTracking();
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

function shouldResetVideoTimeline(videoTime) {
  return state.inputKind === "video" &&
    state.active &&
    Number.isFinite(videoTime) &&
    state.lastVideoTime >= 0 &&
    videoTime + VIDEO_TIMELINE_REWIND_EPSILON_SEC < state.lastVideoTime;
}

function resetVideoTimelineState(reason = "timeline-reset") {
  if (state.inputKind !== "video" || !state.active) {
    return false;
  }

  state.detectionPump.timelineResets += 1;
  state.detectionPump.lastTimelineResetReason = reason;
  state.lastVideoTime = -1;
  state.lastFrameTimestamp = 0;
  state.smoothedFps = 0;
  state.appPerformance.lastProcessedTimestamp = 0;
  resetPresenceTracking();
  resetAvatarPose({
    preserveCalibration: true,
  });
  return true;
}

function resetAvatarPose(options = {}) {
  try {
    state.avatarRenderer?.resetPose(options);
  } catch (error) {
    console.warn("Unable to reset avatar pose.", error);
  }
}

function disposeAvatarRenderer() {
  state.avatarLoadToken += 1;

  try {
    state.avatarRenderer?.dispose();
  } catch (error) {
    console.warn("Unable to dispose avatar renderer.", error);
  } finally {
    state.avatarRenderer = null;
    state.avatarInitPromise = null;
  }
}

function reloadAvatarRenderer() {
  disposeAvatarRenderer();
  initAvatarRenderer();
}

function useAvatarModelFile(file) {
  clearError();

  if (!isLikelyAvatarModelFile(file)) {
    if (state.elements.avatarFileInput) {
      state.elements.avatarFileInput.value = "";
    }

    setAvatarStatus("Unsupported avatar file");
    setAvatarBoneCount(0);
    setError("Select a GLB, GLTF, or VRM avatar model file.", "UNSUPPORTED_AVATAR_FILE");
    return;
  }

  const objectUrl = URL.createObjectURL(file);
  releaseAvatarFileUrl();
  state.avatarFileUrl = objectUrl;
  state.avatarFileName = file.name ?? "Selected avatar";
  reloadAvatarRenderer();
  updateControls();
}

function useDefaultAvatarModel() {
  clearError();

  if (state.elements.avatarFileInput) {
    state.elements.avatarFileInput.value = "";
  }

  if (!state.avatarFileUrl && !state.avatarFileName) {
    return;
  }

  releaseAvatarFileUrl();
  reloadAvatarRenderer();
  updateControls();
}

function releaseAvatarFileUrl() {
  if (state.avatarFileUrl) {
    URL.revokeObjectURL(state.avatarFileUrl);
    state.avatarFileUrl = "";
  }

  state.avatarFileName = "";
}

async function ensureModelsLoaded() {
  const selectedPoseModelKey = getSelectedPoseModelKey();

  if (
    state.poseLandmarker &&
    state.handLandmarker &&
    state.poseModelKey === selectedPoseModelKey &&
    (!state.faceTracking.enabled || state.faceLandmarker) &&
    isTrackingWorkerReadyFor(selectedPoseModelKey)
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
      state.handLandmarker = await createLandmarkerWithDelegate("hand", HandLandmarker, state.vision, {
        baseOptions: {
          modelAssetPath: HAND_MODEL_URL,
        },
        runningMode: "VIDEO",
        numHands: 2,
      });
    }

    if (!state.poseLandmarker || state.poseModelKey !== selectedPoseModelKey) {
      const nextPoseLandmarker = await createLandmarkerWithDelegate("pose", PoseLandmarker, state.vision, {
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

    if (state.faceTracking.enabled && !state.faceLandmarker) {
      state.faceTracking.status = "loading";

      try {
        state.faceLandmarker = await createLandmarkerWithDelegate("face", FaceLandmarker, state.vision, {
          baseOptions: {
            modelAssetPath: FACE_MODEL_URL,
          },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        state.faceTracking.status = "ready";
        state.faceTracking.lastError = "";
      } catch (error) {
        state.faceLandmarker = null;
        state.faceTracking.status = "failed";
        state.faceTracking.lastError = getErrorDetail(error);
        console.warn("Face tracking model load failed.", error);
      }
    } else if (!state.faceTracking.enabled) {
      state.faceTracking.status = "disabled";
    }

    await ensureTrackingWorkerReady(selectedPoseModelKey);

    setText("modelStatus", "Ready");
  } catch (error) {
    setText("modelStatus", "Failed");
    const wrapped = new Error(`Model load failed: ${getErrorDetail(error)}`);
    wrapped.code = "MODEL_LOAD_FAILED";
    throw wrapped;
  }
}

async function createLandmarkerWithDelegate(detectorKey, Landmarker, vision, options) {
  let preferredError = null;

  for (const delegate of getMediaPipeDelegateAttemptOrder()) {
    recordDetectorDelegateAttempt(detectorKey, delegate);

    try {
      const landmarker = await Landmarker.createFromOptions(vision, {
        ...options,
        baseOptions: {
          ...(options.baseOptions ?? {}),
          delegate,
        },
      });
      markDetectorDelegate(detectorKey, delegate, preferredError);
      return landmarker;
    } catch (error) {
      if (delegate === MEDIAPIPE_FALLBACK_DELEGATE) {
        throw error;
      }

      preferredError = error;
      console.warn(
        `${detectorKey} ${MEDIAPIPE_PREFERRED_DELEGATE} delegate failed; retrying with ${MEDIAPIPE_FALLBACK_DELEGATE}.`,
        error,
      );
    }
  }

  throw preferredError ?? new Error(`Unable to create ${detectorKey} landmarker.`);
}

function getMediaPipeDelegateAttemptOrder() {
  if (state.detectorDelegates.requested === MEDIAPIPE_FALLBACK_DELEGATE) {
    return [MEDIAPIPE_FALLBACK_DELEGATE];
  }

  return [MEDIAPIPE_PREFERRED_DELEGATE, MEDIAPIPE_FALLBACK_DELEGATE];
}

function markDetectorDelegate(detectorKey, delegate, fallbackError = null) {
  state.detectorDelegates[detectorKey] = delegate;

  if (fallbackError) {
    const reason = getErrorDetail(fallbackError);
    state.detectorDelegates.fallbackReasons[detectorKey] = reason;
    state.detectorDelegates.lastFallbackReason = `${detectorKey}: ${reason}`;
  } else {
    delete state.detectorDelegates.fallbackReasons[detectorKey];
  }
}

function recordDetectorDelegateAttempt(detectorKey, delegate) {
  const attempts = state.detectorDelegates.attempted[detectorKey] ?? [];

  if (!attempts.includes(delegate)) {
    attempts.push(delegate);
  }

  state.detectorDelegates.attempted[detectorKey] = attempts;
}

function resetDetectorDelegateTelemetry() {
  state.detectorDelegates.requested = getInitialMediaPipeDelegate();
  state.detectorDelegates.lastFallbackReason = "";
  state.detectorDelegates.attempted = {};
  state.detectorDelegates.fallbackReasons = {};
}

function isTrackingWorkerReadyFor(selectedPoseModelKey) {
  if (!state.trackingWorker.requested) {
    return true;
  }

  return (
    state.trackingWorker.active &&
    state.trackingWorker.poseModelKey === selectedPoseModelKey &&
    state.trackingWorker.faceTrackingEnabled === state.faceTracking.enabled &&
    state.trackingWorker.faceLandmarksEnabled === state.faceTracking.landmarksEnabled
  );
}

async function ensureTrackingWorkerReady(selectedPoseModelKey) {
  configureTrackingWorkerRuntime();

  if (!state.trackingWorker.requested) {
    return false;
  }

  if (!state.trackingWorker.supported) {
    state.trackingWorker.status = "unsupported";
    state.trackingWorker.fallbackReason = "Worker, createImageBitmap, or OffscreenCanvas is unavailable.";
    return false;
  }

  if (isTrackingWorkerReadyFor(selectedPoseModelKey)) {
    return true;
  }

  if (state.trackingWorker.initPromise) {
    await state.trackingWorker.initPromise;
    return state.trackingWorker.active;
  }

  state.trackingWorker.status = "loading";
  state.trackingWorker.initPromise = initTrackingWorker(selectedPoseModelKey);

  try {
    await state.trackingWorker.initPromise;
  } finally {
    state.trackingWorker.initPromise = null;
  }

  return state.trackingWorker.active;
}

async function initTrackingWorker(selectedPoseModelKey) {
  try {
    const worker = getOrCreateTrackingWorker();
    const response = await postTrackingWorkerRequest("init", {
      wasmAssetPath: WASM_ASSET_PATH,
      poseModelUrl: POSE_MODEL_URLS[selectedPoseModelKey],
      handModelUrl: HAND_MODEL_URL,
      faceModelUrl: FACE_MODEL_URL,
      faceTrackingEnabled: state.faceTracking.enabled,
      faceLandmarksEnabled: state.faceTracking.landmarksEnabled,
      delegate: state.detectorDelegates.requested,
    });
    state.trackingWorker.active = true;
    state.trackingWorker.status = "ready";
    state.trackingWorker.poseModelKey = selectedPoseModelKey;
    state.trackingWorker.faceTrackingEnabled = state.faceTracking.enabled;
    state.trackingWorker.faceLandmarksEnabled = state.faceTracking.landmarksEnabled;
    state.trackingWorker.detectorDelegates = response.detectorDelegates ?? null;
    state.trackingWorker.fallbackReason = "";
    return worker;
  } catch (error) {
    markTrackingWorkerFallback(error);
    return null;
  }
}

function getOrCreateTrackingWorker() {
  if (state.trackingWorker.worker) {
    return state.trackingWorker.worker;
  }

  const worker = new Worker(
    new URL("./motion-worker.js?v=20260702-delegate-latest-wins-1", import.meta.url),
    { type: "module" },
  );
  worker.addEventListener("message", handleTrackingWorkerMessage);
  worker.addEventListener("error", (event) => {
    markTrackingWorkerFallback(event.error ?? event.message ?? "Tracking worker failed.");
  });
  worker.addEventListener("messageerror", () => {
    markTrackingWorkerFallback("Tracking worker message transfer failed.");
  });
  state.trackingWorker.worker = worker;
  return worker;
}

function handleTrackingWorkerMessage(event) {
  const message = event.data ?? {};
  const request = state.trackingWorker.pendingRequests.get(message.requestId);

  if (!request) {
    return;
  }

  clearTimeout(request.timeoutId);
  state.trackingWorker.pendingRequests.delete(message.requestId);

  if (message.type === "error") {
    request.reject(new Error(message.message || "Tracking worker request failed."));
    return;
  }

  request.resolve(message);
}

function postTrackingWorkerRequest(type, payload = {}, transfer = []) {
  const worker = getOrCreateTrackingWorker();
  const requestId = ++state.trackingWorker.requestId;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      state.trackingWorker.pendingRequests.delete(requestId);
      reject(new Error(`Tracking worker ${type} request timed out.`));
    }, TRACKING_WORKER_TIMEOUT_MS);

    state.trackingWorker.pendingRequests.set(requestId, {
      resolve,
      reject,
      timeoutId,
    });

    try {
      worker.postMessage({ type, requestId, ...payload }, transfer);
    } catch (error) {
      clearTimeout(timeoutId);
      state.trackingWorker.pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

function markTrackingWorkerFallback(error) {
  const reason = getErrorDetail(error);
  state.trackingWorker.active = false;
  state.trackingWorker.status = "fallback";
  state.trackingWorker.errors += 1;
  state.trackingWorker.fallbacks += 1;
  state.trackingWorker.fallbackReason = reason;
  rejectTrackingWorkerPending(error);
  disposeTrackingWorker({ keepStatus: true });
  console.warn("Tracking worker disabled; using main-thread detection.", error);
}

function rejectTrackingWorkerPending(error) {
  for (const [requestId, request] of state.trackingWorker.pendingRequests) {
    clearTimeout(request.timeoutId);
    request.reject(error instanceof Error ? error : new Error(String(error)));
    state.trackingWorker.pendingRequests.delete(requestId);
  }
}

function disposeTrackingWorker(options = {}) {
  if (state.trackingWorker.worker) {
    try {
      state.trackingWorker.worker.postMessage({ type: "close", requestId: 0 });
    } catch {
      // The worker may already be shutting down.
    }

    state.trackingWorker.worker.terminate();
    state.trackingWorker.worker = null;
  }

  rejectTrackingWorkerPending(new Error("Tracking worker disposed."));
  state.trackingWorker.initPromise = null;
  state.trackingWorker.active = false;
  state.trackingWorker.poseModelKey = "";
  state.trackingWorker.faceTrackingEnabled = false;
  state.trackingWorker.faceLandmarksEnabled = false;
  state.trackingWorker.detectorDelegates = null;

  if (!options.keepStatus) {
    state.trackingWorker.status = state.trackingWorker.requested ? "requested" : "disabled";
    state.trackingWorker.fallbackReason = "";
  }
}

function scheduleDetectionFrame() {
  if (!state.active) {
    return;
  }

  state.detectionPump.activeMode = resolveDetectionPumpMode();

  if (state.detectionPump.activeMode === DETECTION_PUMP_RVFC) {
    if (state.videoFrameRequestId) {
      return;
    }

    scheduleVideoFrameDetection();
    return;
  }

  if (state.animationFrameId) {
    return;
  }

  state.animationFrameId = requestAnimationFrame((timestamp) => {
    state.animationFrameId = 0;
    runDetectionFrame(timestamp, { pumpMode: DETECTION_PUMP_RAF });
  });
}

function scheduleVideoFrameDetection() {
  const video = state.elements.video;

  if (!video?.requestVideoFrameCallback) {
    state.detectionPump.activeMode = DETECTION_PUMP_RAF;
    state.animationFrameId = requestAnimationFrame((timestamp) => {
      state.animationFrameId = 0;
      runDetectionFrame(timestamp, { pumpMode: DETECTION_PUMP_RAF });
    });
    return;
  }

  state.videoFrameRequestId = video.requestVideoFrameCallback((timestamp, metadata) => {
    state.videoFrameRequestId = 0;
    runDetectionFrame(timestamp, {
      pumpMode: DETECTION_PUMP_RVFC,
      videoFrameMetadata: metadata,
    });
  });
}

async function runDetectionFrame(timestamp, options = {}) {
  if (!state.active) {
    return;
  }

  const callbackReceivedAt = nowMs();
  const callbackTimestamp = Number.isFinite(timestamp) ? timestamp : callbackReceivedAt;
  const pumpMode = options.pumpMode ?? state.detectionPump.activeMode;
  const callbackLagMs = Math.max(0, callbackReceivedAt - callbackTimestamp);
  recordDetectionCallback(callbackTimestamp);
  recordAppPerformanceSample("frameCallbackLagMs", callbackLagMs);

  if (state.detectionPump.busy) {
    state.detectionPump.busySkips += 1;
    state.detectionPump.pendingLatestFrame = {
      timestamp: callbackTimestamp,
      options,
    };
    scheduleDetectionFrame();
    return;
  }

  if (shouldSkipStaleVideoFrameCallback(callbackLagMs, options)) {
    state.detectionPump.staleFrameCallbacks += 1;
    state.detectionPump.consecutiveStaleFrameCallbacks += 1;
    scheduleDetectionFrame();
    return;
  }

  state.detectionPump.consecutiveStaleFrameCallbacks = 0;

  state.detectionPump.busy = true;
  const frameStartedAt = nowMs();
  const frameTimestamp = normalizeDetectionTimestamp(callbackTimestamp, frameStartedAt, callbackLagMs, options);
  let shouldScheduleNext = true;

  try {
    const { video } = state.elements;

    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      state.detectionPump.emptyFrames += 1;
      clearCanvas();
      setError(
        "Input is active, but the video frame is empty.",
        "EMPTY_VIDEO_FRAME",
      );
      setText("cameraStatus", "No video frame");
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

    const videoTime = Number(video.currentTime ?? 0);

    if (shouldResetVideoTimeline(videoTime)) {
      resetVideoTimelineState("rewind");
    }

    if (videoTime === state.lastVideoTime) {
      state.detectionPump.duplicateFrames += 1;
      return;
    }

    state.lastVideoTime = videoTime;
    state.detectionPump.processedFrames += 1;
    recordDetectionProcessedFrame(frameTimestamp);
    recordAppPerformanceSample("frameAgeMs", nowMs() - frameTimestamp);

    resizeCanvasToVideoFrame();

    const detectStartedAt = nowMs();
    const motionFrame = await detectMotionFrameForVideo(video, frameTimestamp);
    recordAppPerformanceSample("detectMs", nowMs() - detectStartedAt);

    const processStartedAt = nowMs();
    processMotionFrame(motionFrame, {
      record: true,
      forward: true,
      draw: state.debugOverlayEnabled,
      metrics: true,
      pumpMode,
    });
    recordAppPerformanceSample("processMs", nowMs() - processStartedAt);
    recordAppPerformanceSample("frameTotalMs", nowMs() - frameStartedAt);
  } catch (error) {
    state.detectionPump.errors += 1;
    shouldScheduleNext = false;
    setError(`Tracking failed: ${getErrorDetail(error)}`, "TRACKING_FAILED");
    setText("cameraStatus", "Failed");
    stopCamera({ preserveError: true, cameraStatus: "Failed" });
    return;
  } finally {
    state.detectionPump.busy = false;

    const pendingLatestFrame = state.detectionPump.pendingLatestFrame;
    state.detectionPump.pendingLatestFrame = null;

    if (shouldScheduleNext && pendingLatestFrame) {
      state.detectionPump.latestWinsFrames += 1;
      queueMicrotask(() => {
        runDetectionFrame(nowMs(), pendingLatestFrame.options);
      });
    } else if (shouldScheduleNext) {
      scheduleDetectionFrame();
    }
  }
}

async function detectMotionFrameForVideo(video, frameTimestamp) {
  if (shouldUseTrackingWorker()) {
    try {
      return await detectMotionFrameInWorker(video, frameTimestamp);
    } catch (error) {
      markTrackingWorkerFallback(error);
    }
  }

  return detectMotionFrameOnMainThread(video, frameTimestamp);
}

function shouldSkipStaleVideoFrameCallback(callbackLagMs, options = {}) {
  return Boolean(
    options.pumpMode === DETECTION_PUMP_RVFC &&
      callbackLagMs > MAX_STALE_VIDEO_FRAME_CALLBACK_MS &&
      state.detectionPump.consecutiveStaleFrameCallbacks < MAX_CONSECUTIVE_STALE_VIDEO_FRAME_SKIPS
  );
}

function normalizeDetectionTimestamp(callbackTimestamp, frameStartedAt, callbackLagMs, options = {}) {
  if (
    options.pumpMode === DETECTION_PUMP_RVFC &&
      callbackLagMs > MAX_STALE_VIDEO_FRAME_CALLBACK_MS
  ) {
    return frameStartedAt;
  }

  return callbackTimestamp;
}

function shouldUseTrackingWorker() {
  return Boolean(
    state.trackingWorker.requested &&
      state.trackingWorker.supported &&
      state.trackingWorker.active &&
      state.trackingWorker.worker,
  );
}

async function detectMotionFrameInWorker(video, frameTimestamp) {
  const imageBitmap = await createImageBitmap(video);

  try {
    const response = await postTrackingWorkerRequest(
      "detect",
      {
        imageBitmap,
        timestamp: frameTimestamp,
        mirrored: Boolean(state.elements.mirrorToggle?.checked),
        sourceMeta: getCurrentMotionSourceMeta("worker"),
        faceTrackingEnabled: state.faceTracking.enabled,
        faceLandmarksEnabled: state.faceTracking.landmarksEnabled,
      },
      [imageBitmap],
    );
    state.trackingWorker.frames += 1;

    if (state.faceTracking.enabled) {
      state.faceTracking.status = response.frame?.face ? "running" : "ready";
      state.faceTracking.detectFrames += 1;
      state.faceTracking.lastTimestamp = frameTimestamp;

      if (response.frame?.face) {
        state.faceTracking.facesDetected += 1;
        state.faceTracking.lastError = "";
      }
    }

    return response.frame;
  } catch (error) {
    try {
      imageBitmap.close?.();
    } catch {
      // The frame may already have been transferred to the worker.
    }

    throw error;
  }
}

function detectMotionFrameOnMainThread(video, frameTimestamp) {
  const poseResults = state.poseLandmarker.detectForVideo(video, frameTimestamp);
  const handResults = state.handLandmarker.detectForVideo(video, frameTimestamp);
  const face = detectFaceForVideo(video, frameTimestamp);

  return createMotionFrame({
    timestamp: frameTimestamp,
    mirrored: Boolean(state.elements.mirrorToggle?.checked),
    poseResults,
    handResults,
    face,
    sourceMeta: getCurrentMotionSourceMeta("main-thread"),
  });
}

function detectFaceForVideo(video, frameTimestamp) {
  if (!state.faceTracking.enabled || !state.faceLandmarker) {
    return null;
  }

  const detectStartedAt = nowMs();
  let faceResults = null;

  try {
    faceResults = state.faceLandmarker.detectForVideo(video, frameTimestamp);
    recordAppPerformanceSample("faceDetectMs", nowMs() - detectStartedAt);
  } catch (error) {
    recordAppPerformanceSample("faceDetectMs", nowMs() - detectStartedAt);
    state.faceTracking.status = "failed";
    state.faceTracking.lastError = getErrorDetail(error);
    console.warn("Face tracking skipped.", error);
    return null;
  }

  const processStartedAt = nowMs();
  const face = normalizeFace(faceResults, {
    includeLandmarks: state.faceTracking.landmarksEnabled,
  });
  recordAppPerformanceSample("faceProcessMs", nowMs() - processStartedAt);
  state.faceTracking.status = "running";
  state.faceTracking.detectFrames += 1;
  state.faceTracking.lastTimestamp = frameTimestamp;

  if (face) {
    state.faceTracking.facesDetected += 1;
    state.faceTracking.lastError = "";
  }

  return face;
}

function updateAvatarRenderer(poseResults, handResults, timestamp) {
  const motionFrame = createMotionFrame({
    timestamp,
    mirrored: Boolean(state.elements.mirrorToggle?.checked),
    poseResults,
    handResults,
    sourceMeta: getCurrentMotionSourceMeta(),
  });

  updateAvatarRendererFromMotionFrame(motionFrame);
}

function processMotionFrame(motionFrame, options = {}) {
  const {
    record = false,
    forward = false,
    draw = false,
    metrics = false,
  } = options;
  const normalizedFrame = isMotionFrame(motionFrame)
    ? motionFrame
    : createMotionFrame({ sourceMeta: getCurrentMotionSourceMeta() });
  const presence = updatePresenceState(state.presenceTracking, normalizedFrame);
  const processedFrame = {
    ...normalizedFrame,
    sourceMeta: {
      ...normalizedFrame.sourceMeta,
      presenceStatus: presence.status,
      presenceConfidence: presence.confidence,
      presenceShouldUpdateAvatar: presence.shouldUpdateAvatar,
      presenceFrames: presence.frames,
      presenceTransitions: presence.transitions,
    },
  };
  state.latestMotionFrame = processedFrame;
  const poseResults = motionFrameToPoseResults(processedFrame);
  const handResults = motionFrameToHandResults(processedFrame);

  if (presence.shouldUpdateAvatar) {
    updateAvatarRendererFromMotionFrame(processedFrame);
  }
  updateFaceExpressionStatus(processedFrame);

  if (state.bodyValidation.enabled) {
    recordBodyValidation(processedFrame);
  }

  if (record) {
    appendMotionRecordingFrame(processedFrame);
  }

  if (forward) {
    state.motionForwarder.sendFrame(processedFrame);
  }

  if (draw) {
    const drawStartedAt = nowMs();
    drawResults(poseResults, handResults);
    recordAppPerformanceSample("drawMs", nowMs() - drawStartedAt);
  }

  if (metrics) {
    updateDetectionMetrics(poseResults, handResults, processedFrame.timestamp);
  }
}

function updateAvatarRendererFromMotionFrame(motionFrame) {
  if (!state.avatarRenderer) {
    return;
  }

  try {
    state.avatarRenderer.update({
      motionFrame,
      mirrored: motionFrame.mirrored,
      timestamp: motionFrame.timestamp,
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

function recordBodyValidation(input, fallbackTimestamp = 0) {
  if (!state.avatarRenderer?.getBodyValidationSnapshot) {
    return;
  }

  try {
    const motionFrame = isMotionFrame(input)
      ? input
      : createMotionFrame({
        timestamp: fallbackTimestamp,
        mirrored: Boolean(state.elements.mirrorToggle?.checked),
        poseResults: input,
        sourceMeta: getCurrentMotionSourceMeta(),
      });
    const snapshot = state.avatarRenderer.getBodyValidationSnapshot({
      motionFrame,
      mirrored: motionFrame.mirrored,
      timestamp: motionFrame.timestamp,
    });
    const visualSnapshot = state.avatarRenderer.getProjectedBodyPoseSnapshot?.({
      motionFrame,
      mirrored: motionFrame.mirrored,
      timestamp: motionFrame.timestamp,
    });
    const depthSnapshot = state.avatarRenderer.getDepthValidationSnapshot?.({
      motionFrame,
      mirrored: motionFrame.mirrored,
      timestamp: motionFrame.timestamp,
    });
    const depthCalibrationSnapshot = state.avatarRenderer.getDepthCalibrationSnapshot?.();
    const motionStateSnapshot = state.avatarRenderer.getMotionStateSnapshot?.();
    const sample = {
      timestamp: motionFrame.timestamp,
      videoTime: Number(motionFrame.sourceMeta?.videoTime ?? state.elements.video?.currentTime ?? 0),
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
        targetDirection: segment.targetDirection,
        avatarDirection: segment.avatarDirection,
        depthSalient: segment.depthSalient,
        matched: segment.matched,
      })),
      depthSummary: depthSnapshot?.summary ?? null,
      depthSource: depthSnapshot?.depthSource ?? null,
      depthReferenceScale: depthSnapshot?.referenceDepthScale ?? null,
      depthSelfReferential: depthSnapshot?.selfReferential ?? null,
      depthMeasurementMode: depthSnapshot?.measurementMode ?? null,
      depthCalibration: depthCalibrationSnapshot ?? depthSnapshot?.depthCalibration ?? null,
      rootMotion: motionStateSnapshot?.rootMotion ?? null,
      faceHeadPose: motionStateSnapshot?.faceHeadPose ?? null,
      retargetMode: motionStateSnapshot?.retargetMode ?? null,
      handOrientation: motionStateSnapshot?.handOrientation ?? null,
      sourceAvatarDivergence: motionStateSnapshot?.sourceAvatarDivergence ?? null,
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
  maybeUpdateMotionStatusHud();
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
  updateMotionStatusHud({ force: true });
}

function resetPresenceTracking() {
  state.presenceTracking = createPresenceState();
}

function resetDepthCalibrationFromUi() {
  try {
    const snapshot = state.avatarRenderer?.resetDepthCalibration?.() ?? null;
    resetBodyValidation();
    updateMotionStatusHud({ force: true });
    return state.avatarRenderer?.getDepthCalibrationSnapshot?.() ?? snapshot;
  } catch (error) {
    console.warn("Unable to reset depth calibration.", error);
    return null;
  }
}

function maybeUpdateMotionStatusHud() {
  const currentTime = nowMs();

  if (currentTime - state.motionStatusHud.lastUpdatedAt < MOTION_STATUS_HUD_INTERVAL_MS) {
    return state.motionStatusHud.lastSnapshot;
  }

  return updateMotionStatusHud({ currentTime });
}

function updateMotionStatusHud({ force = false, currentTime = nowMs() } = {}) {
  if (!force && currentTime - state.motionStatusHud.lastUpdatedAt < MOTION_STATUS_HUD_INTERVAL_MS) {
    return state.motionStatusHud.lastSnapshot;
  }

  const snapshot = buildMotionStatusHudSnapshot();
  state.motionStatusHud.lastUpdatedAt = currentTime;
  state.motionStatusHud.lastSnapshot = snapshot;

  setText("motionStatusFacing", snapshot.facingLabel);
  setText("motionStatusMode", snapshot.modeLabel);
  setText("motionStatusQuality", snapshot.qualityLabel);
  setText("motionStatusDelegate", snapshot.delegateLabel);
  setText("motionStatusFps", formatMetricNumber(snapshot.fps, 1));
  setText("motionStatusFrameAge", formatMs(snapshot.frameAgeP95Ms));
  setText("motionStatusSolver", formatMs(snapshot.poseSolverP95Ms));
  setText("motionStatusDrops", formatPercent(snapshot.dropRatio));
  setText("motionStatusCalibration", snapshot.calibrationLabel);
  setText("motionStatusCalibrationGuide", snapshot.calibrationGuideLabel);

  return snapshot;
}

function getMotionStatusHudSnapshot() {
  return state.motionStatusHud.lastSnapshot ?? buildMotionStatusHudSnapshot();
}

function buildMotionStatusHudSnapshot() {
  const appReport = getAppPerformanceReport();
  const avatarPerformance = state.avatarRenderer?.getPerformanceSnapshot?.() ?? null;
  const motionState = state.avatarRenderer?.getMotionStateSnapshot?.() ?? null;
  const poseSolver = motionState?.poseSolver ?? avatarPerformance?.poseSolver ?? null;
  const poseSolverMetrics = motionState?.poseSolverMetrics ?? avatarPerformance?.poseSolverMetrics ?? null;
  const occlusion = motionState?.occlusion ?? avatarPerformance?.occlusion ?? null;
  const depthCalibration = state.avatarRenderer?.getDepthCalibrationSnapshot?.() ?? null;
  const pump = appReport.pump ?? {};
  const processedFrames = Number(pump.processedFrames ?? 0);
  const droppedFrameWork = Number(pump.duplicateFrames ?? 0) +
    Number(pump.busySkips ?? 0) +
    Number(pump.latestWinsFrames ?? 0) +
    Number(pump.staleFrameCallbacks ?? 0);
  const dropDenominator = processedFrames + droppedFrameWork;
  const mode = poseSolver?.mode ?? poseSolverMetrics?.currentMode ?? "idle";
  const facing = poseSolver?.facing ?? poseSolverMetrics?.currentFacing ?? motionState?.rootMotion?.facing ?? "idle";
  const frameAgeP95Ms = appReport.samples?.frameAge?.p95Ms ?? 0;
  const poseSolverP95Ms = avatarPerformance?.samples?.poseSolver?.p95Ms ?? 0;
  const active = state.active || state.motionReplay.active;
  const presence = state.presenceTracking ?? createPresenceState();

  return {
    active,
    presence: presence.status,
    presenceConfidence: presence.confidence,
    facing,
    mode,
    quality: resolveMotionQuality({
      active,
      poseSolver,
      poseSolverMetrics,
      occlusion,
      frameAgeP95Ms,
    }),
    delegate: resolveActiveDelegate(appReport),
    fps: Number(appReport.fps?.detection ?? 0),
    frameAgeP95Ms,
    poseSolverP95Ms,
    depthCalibration,
    dropRatio: dropDenominator > 0 ? droppedFrameWork / dropDenominator : 0,
    droppedFrameWork,
    processedFrames,
    facingLabel: formatStatusToken(facing),
    presenceLabel: formatStatusToken(presence.status),
    modeLabel: formatStatusToken(mode),
    qualityLabel: resolveMotionQualityLabel({
      active,
      poseSolver,
      poseSolverMetrics,
      occlusion,
      frameAgeP95Ms,
    }),
    delegateLabel: formatStatusToken(resolveActiveDelegate(appReport)),
    calibrationLabel: resolveDepthCalibrationLabel(depthCalibration, active),
    calibrationGuideLabel: resolveDepthCalibrationGuideLabel(depthCalibration, active),
    pumpMode: pump.activeMode ?? "",
    staleFrameCallbacks: pump.staleFrameCallbacks ?? 0,
  };
}

function resolveDepthCalibrationLabel(snapshot, active) {
  if (!active) {
    return "Idle";
  }

  if (!snapshot) {
    return "Unavailable";
  }

  if (snapshot.mode === DEPTH_CALIBRATION_MODE_STATIC || !snapshot.active) {
    return "Static";
  }

  if (snapshot.ready) {
    return `Ready ${formatPercent(snapshot.score)}`;
  }

  return `Warm ${Math.min(snapshot.frames ?? 0, snapshot.warmupFrames ?? 0)}/${snapshot.warmupFrames ?? "?"}`;
}

function resolveDepthCalibrationGuideLabel(snapshot, active) {
  if (!active) {
    return "Start input";
  }

  if (!snapshot || snapshot.mode === DEPTH_CALIBRATION_MODE_STATIC || !snapshot.active) {
    return "Static depth";
  }

  if (snapshot.ready) {
    return snapshot.passed ? "Locked" : "Check pose";
  }

  const coverage = snapshot.coverage ?? {};
  const poseQuality = snapshot.poseQuality ?? null;
  const upperBodySegments = Number(coverage.upperBodySegments ?? 0);
  const fullBodySegments = Number(coverage.validSegments ?? 0);
  const requiredSegments = Number(snapshot.minimumReferenceSegments ?? 0);

  if (fullBodySegments >= requiredSegments) {
    if (poseQuality && !poseQuality.passed) {
      return resolveCalibrationPoseQualityGuide(poseQuality);
    }

    return "Hold still";
  }

  if (upperBodySegments >= requiredSegments) {
    if (poseQuality && !poseQuality.passed) {
      return resolveCalibrationPoseQualityGuide(poseQuality);
    }

    return "Upper OK";
  }

  return "Show body";
}

function resolveCalibrationPoseQualityGuide(poseQuality) {
  const reasons = new Set(poseQuality?.reasons ?? []);

  if (reasons.has("arms_not_level")) {
    return "Level arms";
  }

  if (reasons.has("arms_not_open") || reasons.has("asymmetric_arms")) {
    return "Open arms";
  }

  if (reasons.has("low_visibility")) {
    return "Stay visible";
  }

  return "T Pose";
}

function resolveMotionQuality({
  active,
  poseSolver,
  poseSolverMetrics,
  occlusion,
  frameAgeP95Ms,
}) {
  if (!active) {
    return "idle";
  }

  if (!state.latestMotionFrame?.poseLandmarks) {
    return "no-pose";
  }

  if (state.presenceTracking?.status === "absent") {
    return "absent";
  }

  const mode = poseSolver?.mode ?? poseSolverMetrics?.currentMode ?? "lost";

  if (mode === "lost") {
    return "lost";
  }

  if (Number(poseSolver?.hingeViolations ?? 0) > 0) {
    return "hinge-fail";
  }

  if (Number(frameAgeP95Ms ?? 0) > 66) {
    return "lagging";
  }

  if (Number(poseSolver?.lowConfidenceTargets ?? 0) > 4) {
    return "low-confidence";
  }

  if (Number(occlusion?.activeCount ?? 0) > 0) {
    return "occluded";
  }

  if (Number(poseSolver?.hingeLimitWarnings ?? 0) > 0) {
    return "soft-warning";
  }

  return "good";
}

function resolveMotionQualityLabel(input) {
  const quality = resolveMotionQuality(input);
  const labels = {
    idle: "Idle",
    "no-pose": "No pose",
    absent: "Absent",
    lost: "Lost",
    "hinge-fail": "Hinge fail",
    lagging: "Lagging",
    "low-confidence": "Low confidence",
    occluded: "Occluded",
    "soft-warning": "Warning",
    good: "Good",
  };

  return labels[quality] ?? formatStatusToken(quality);
}

function resolveActiveDelegate(appReport) {
  const workerPoseDelegate = appReport.trackingWorker?.detectorDelegates?.pose;
  const poseDelegate = workerPoseDelegate ?? appReport.detectorDelegates?.pose ?? "unloaded";

  if (appReport.trackingWorker?.active && workerPoseDelegate) {
    return `${poseDelegate} worker`;
  }

  return poseDelegate;
}

function formatStatusToken(value) {
  const token = String(value ?? "").trim();

  if (!token) {
    return "Idle";
  }

  return token
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 && part.toUpperCase() === part
      ? part
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatMetricNumber(value, digits = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "0";
  }

  return number.toFixed(digits);
}

function formatMs(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return "0ms";
  }

  if (number < 10) {
    return `${number.toFixed(1)}ms`;
  }

  return `${Math.round(number)}ms`;
}

function formatPercent(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return "0%";
  }

  return `${(number * 100).toFixed(number < 0.1 ? 1 : 0)}%`;
}

function configureDetectionRuntime() {
  state.detectionPump.requestedMode = getInitialDetectionPumpMode();
  state.detectionPump.supportsVideoFrameCallback = supportsVideoFrameCallback();
  state.detectionPump.activeMode = resolveDetectionPumpMode();
  state.debugOverlayEnabled = getInitialDebugOverlayEnabled();
  resetDetectorDelegateTelemetry();
  configureTrackingWorkerRuntime();
}

function supportsVideoFrameCallback() {
  return typeof state.elements.video?.requestVideoFrameCallback === "function";
}

function configureTrackingWorkerRuntime() {
  const requested = getInitialTrackingWorkerEnabled();
  state.trackingWorker.requested = requested;
  state.trackingWorker.supported = supportsTrackingWorker();

  if (!requested) {
    disposeTrackingWorker();
    state.trackingWorker.status = "disabled";
    return;
  }

  if (!state.trackingWorker.supported) {
    state.trackingWorker.active = false;
    state.trackingWorker.status = "unsupported";
    state.trackingWorker.fallbackReason = "Worker, createImageBitmap, or OffscreenCanvas is unavailable.";
    return;
  }

  if (!state.trackingWorker.active && state.trackingWorker.status === "disabled") {
    state.trackingWorker.status = "requested";
  }
}

function supportsTrackingWorker() {
  return (
    typeof Worker === "function" &&
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas === "function"
  );
}

function resolveDetectionPumpMode() {
  const requestedMode = state.detectionPump.requestedMode;

  if (requestedMode === DETECTION_PUMP_RAF) {
    return DETECTION_PUMP_RAF;
  }

  if (requestedMode === DETECTION_PUMP_RVFC) {
    return supportsVideoFrameCallback() ? DETECTION_PUMP_RVFC : DETECTION_PUMP_RAF;
  }

  return supportsVideoFrameCallback() ? DETECTION_PUMP_RVFC : DETECTION_PUMP_RAF;
}

function cancelVideoFrameRequest() {
  const video = state.elements.video;

  if (state.videoFrameRequestId && typeof video?.cancelVideoFrameCallback === "function") {
    video.cancelVideoFrameCallback(state.videoFrameRequestId);
  }

  state.videoFrameRequestId = 0;
}

function resetAppPerformance() {
  state.detectionPump.callbacks = 0;
  state.detectionPump.processedFrames = 0;
  state.detectionPump.duplicateFrames = 0;
  state.detectionPump.emptyFrames = 0;
  state.detectionPump.busySkips = 0;
  state.detectionPump.latestWinsFrames = 0;
  state.detectionPump.staleFrameCallbacks = 0;
  state.detectionPump.timelineResets = 0;
  state.detectionPump.lastTimelineResetReason = "";
  state.detectionPump.consecutiveStaleFrameCallbacks = 0;
  state.detectionPump.errors = 0;
  state.detectionPump.busy = false;
  state.detectionPump.pendingLatestFrame = null;
  state.detectionPump.supportsVideoFrameCallback = supportsVideoFrameCallback();
  state.detectionPump.activeMode = resolveDetectionPumpMode();
  state.appPerformance.startedAt = nowMs();
  state.appPerformance.lastCallbackTimestamp = 0;
  state.appPerformance.lastProcessedTimestamp = 0;
  state.appPerformance.callbackIntervalsMs.length = 0;
  state.appPerformance.detectIntervalsMs.length = 0;
  state.appPerformance.detectMs.length = 0;
  state.appPerformance.faceDetectMs.length = 0;
  state.appPerformance.faceProcessMs.length = 0;
  state.appPerformance.processMs.length = 0;
  state.appPerformance.drawMs.length = 0;
  state.appPerformance.frameTotalMs.length = 0;
  state.appPerformance.frameAgeMs.length = 0;
  state.appPerformance.frameCallbackLagMs.length = 0;
  state.faceTracking.detectFrames = 0;
  state.faceTracking.facesDetected = 0;
  state.faceTracking.lastTimestamp = 0;

  if (state.faceTracking.enabled && state.faceLandmarker && state.faceTracking.status !== "failed") {
    state.faceTracking.status = "ready";
  }
}

function recordDetectionCallback(timestamp) {
  state.detectionPump.callbacks += 1;

  if (state.appPerformance.lastCallbackTimestamp > 0) {
    const elapsed = timestamp - state.appPerformance.lastCallbackTimestamp;

    if (elapsed > 0 && elapsed < 5000) {
      recordAppPerformanceSample("callbackIntervalsMs", elapsed);
    }
  }

  state.appPerformance.lastCallbackTimestamp = timestamp;
}

function recordDetectionProcessedFrame(timestamp) {
  if (state.appPerformance.lastProcessedTimestamp > 0) {
    const elapsed = timestamp - state.appPerformance.lastProcessedTimestamp;

    if (elapsed > 0 && elapsed < 5000) {
      recordAppPerformanceSample("detectIntervalsMs", elapsed);
    }
  }

  state.appPerformance.lastProcessedTimestamp = timestamp;
}

function recordAppPerformanceSample(key, value) {
  const samples = state.appPerformance[key];

  if (!Array.isArray(samples) || !Number.isFinite(value)) {
    return;
  }

  samples.push(Math.max(0, value));

  if (samples.length > APP_PERFORMANCE_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - APP_PERFORMANCE_SAMPLE_LIMIT);
  }
}

function getAppPerformanceReport() {
  const elapsedMs = Math.max(0, nowMs() - state.appPerformance.startedAt);
  const elapsedSeconds = elapsedMs / 1000;

  return {
    pump: {
      requestedMode: state.detectionPump.requestedMode,
      activeMode: state.detectionPump.activeMode,
      supportsVideoFrameCallback: state.detectionPump.supportsVideoFrameCallback,
      callbacks: state.detectionPump.callbacks,
      processedFrames: state.detectionPump.processedFrames,
      duplicateFrames: state.detectionPump.duplicateFrames,
      emptyFrames: state.detectionPump.emptyFrames,
      busySkips: state.detectionPump.busySkips,
      latestWinsFrames: state.detectionPump.latestWinsFrames,
      staleFrameCallbacks: state.detectionPump.staleFrameCallbacks,
      timelineResets: state.detectionPump.timelineResets,
      lastTimelineResetReason: state.detectionPump.lastTimelineResetReason,
      hasPendingLatestFrame: Boolean(state.detectionPump.pendingLatestFrame),
      errors: state.detectionPump.errors,
      debugOverlayEnabled: state.debugOverlayEnabled,
    },
    trackingWorker: getTrackingWorkerStatus(),
    detectorDelegates: {
      ...state.detectorDelegates,
      attempted: cloneRecordArrayValues(state.detectorDelegates.attempted),
      fallbackReasons: { ...state.detectorDelegates.fallbackReasons },
    },
    validation: {
      enabled: state.bodyValidation.enabled,
      samples: state.bodyValidation.samples.length,
    },
    fps: {
      callback: elapsedSeconds > 0 ? state.detectionPump.callbacks / elapsedSeconds : 0,
      detection: elapsedSeconds > 0 ? state.detectionPump.processedFrames / elapsedSeconds : 0,
    },
    faceTracking: getFaceTrackingStatus(),
    presenceTracking: {
      status: state.presenceTracking.status,
      confidence: state.presenceTracking.confidence,
      presentFrames: state.presenceTracking.presentFrames,
      absentFrames: state.presenceTracking.absentFrames,
      transitions: state.presenceTracking.transitions,
      frames: state.presenceTracking.frames,
    },
    samples: {
      callbackInterval: summarizeAppPerformanceSamples(state.appPerformance.callbackIntervalsMs),
      detectionInterval: summarizeAppPerformanceSamples(state.appPerformance.detectIntervalsMs),
      detect: summarizeAppPerformanceSamples(state.appPerformance.detectMs),
      faceDetect: summarizeAppPerformanceSamples(state.appPerformance.faceDetectMs),
      faceProcess: summarizeAppPerformanceSamples(state.appPerformance.faceProcessMs),
      process: summarizeAppPerformanceSamples(state.appPerformance.processMs),
      draw: summarizeAppPerformanceSamples(state.appPerformance.drawMs),
      frameTotal: summarizeAppPerformanceSamples(state.appPerformance.frameTotalMs),
      frameAge: summarizeAppPerformanceSamples(state.appPerformance.frameAgeMs),
      frameCallbackLag: summarizeAppPerformanceSamples(state.appPerformance.frameCallbackLagMs),
    },
  };
}

function cloneRecordArrayValues(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, entry]) => [
      key,
      Array.isArray(entry) ? entry.slice() : entry,
    ]),
  );
}

function getTrackingWorkerStatus() {
  return {
    requested: state.trackingWorker.requested,
    supported: state.trackingWorker.supported,
    active: state.trackingWorker.active,
    status: state.trackingWorker.status,
    poseModelKey: state.trackingWorker.poseModelKey,
    faceTrackingEnabled: state.trackingWorker.faceTrackingEnabled,
    faceLandmarksEnabled: state.trackingWorker.faceLandmarksEnabled,
    frames: state.trackingWorker.frames,
    errors: state.trackingWorker.errors,
    fallbacks: state.trackingWorker.fallbacks,
    pendingRequests: state.trackingWorker.pendingRequests.size,
    fallbackReason: state.trackingWorker.fallbackReason,
    detectorDelegates: state.trackingWorker.detectorDelegates,
  };
}

function summarizeAppPerformanceSamples(samples) {
  if (!samples.length) {
    return {
      count: 0,
      avgMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }

  const sorted = samples.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);

  return {
    count: sorted.length,
    avgMs: sum / sorted.length,
    medianMs: percentileFromSorted(sorted, 0.5),
    p95Ms: percentileFromSorted(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

function percentileFromSorted(sortedValues, percentileValue) {
  if (!sortedValues.length) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );

  return sortedValues[index];
}

function resetBodyValidation() {
  state.bodyValidation.samples = [];
  state.bodyValidation.lastSample = null;
}

function getCurrentMotionSourceMeta(trackingRuntime = shouldUseTrackingWorker() ? "worker" : "main-thread") {
  return {
    inputKind: state.inputKind,
    videoFileName: state.videoFileName,
    videoTime: Number(state.elements.video?.currentTime ?? 0),
    poseModelKey: state.poseModelKey ?? "",
    avatarModelLabel: state.avatarFileName || "Xbot.glb",
    faceTrackingEnabled: state.faceTracking.enabled,
    faceLandmarksEnabled: state.faceTracking.landmarksEnabled,
    trackingRuntime,
  };
}

async function setFaceTrackingEnabled(enabled) {
  state.faceTracking.enabled = Boolean(enabled);
  state.faceTracking.lastError = "";
  syncFaceTrackingControl();

  if (!state.faceTracking.enabled) {
    state.faceTracking.landmarksEnabled = false;
    state.faceTracking.status = "disabled";
    syncFaceTrackingControl();
    return getFaceTrackingStatus();
  }

  state.faceTracking.status = state.faceLandmarker ? "ready" : "enabled";

  if (state.active || state.starting || state.poseLandmarker || state.handLandmarker || state.vision) {
    await ensureModelsLoaded();
  }

  return getFaceTrackingStatus();
}

function syncFaceTrackingControl() {
  if (state.elements.faceTrackingToggle) {
    state.elements.faceTrackingToggle.checked = state.faceTracking.enabled;
  }
  updateFaceExpressionStatus();
}

async function setFaceLandmarksEnabled(enabled) {
  state.faceTracking.landmarksEnabled = Boolean(enabled);

  if (state.faceTracking.landmarksEnabled && !state.faceTracking.enabled) {
    await setFaceTrackingEnabled(true);
  }

  if (state.active && state.trackingWorker.active) {
    state.trackingWorker.faceLandmarksEnabled = state.faceTracking.landmarksEnabled;
  }

  return getFaceTrackingStatus();
}

function getFaceTrackingEnabled() {
  return state.faceTracking.enabled;
}

function getFaceTrackingStatus() {
  return {
    enabled: state.faceTracking.enabled,
    landmarksEnabled: state.faceTracking.landmarksEnabled,
    status: state.faceTracking.enabled ? state.faceTracking.status : "disabled",
    modelLoaded: Boolean(state.faceLandmarker),
    detectFrames: state.faceTracking.detectFrames,
    facesDetected: state.faceTracking.facesDetected,
    lastTimestamp: state.faceTracking.lastTimestamp,
    lastError: state.faceTracking.lastError,
  };
}

function getTrackedChannelReport() {
  const frame = state.latestMotionFrame;
  const rigReport = state.avatarRenderer?.getModelDiagnostics?.() ?? null;
  const face = frame?.face ?? null;

  return {
    timestamp: Number(frame?.timestamp ?? 0),
    mirrored: Boolean(frame?.mirrored),
    sourceMeta: frame?.sourceMeta ?? {},
    presence: {
      status: state.presenceTracking.status,
      confidence: state.presenceTracking.confidence,
      shouldUpdateAvatar: frame?.sourceMeta?.presenceShouldUpdateAvatar ?? null,
      transitions: state.presenceTracking.transitions,
    },
    body: {
      poseLandmarkCount: landmarkCount(frame?.poseLandmarks),
      poseWorldLandmarkCount: landmarkCount(frame?.poseWorldLandmarks),
      maxPoseLandmarks: 33,
      tracked: landmarkCount(frame?.poseLandmarks) === 33,
      worldTracked: landmarkCount(frame?.poseWorldLandmarks) === 33,
    },
    hands: {
      maxHands: 2,
      maxLandmarksPerHand: 21,
      Left: buildTrackedHandReport("Left", frame, rigReport),
      Right: buildTrackedHandReport("Right", frame, rigReport),
    },
    face: {
      enabled: state.faceTracking.enabled,
      landmarksEnabled: state.faceTracking.landmarksEnabled,
      blendShapeCount: Array.isArray(face?.blendShapes) ? face.blendShapes.length : 0,
      faceLandmarkCount: landmarkCount(face?.landmarks),
      maxFaceLandmarks: 478,
      transformMatrixTracked: Array.isArray(face?.transformMatrix) && face.transformMatrix.length === 16,
      sourceMeta: face?.sourceMeta ?? {},
    },
    avatar: {
      expressionPresetCount: rigReport?.expressions?.expressionPresetCount ?? 0,
      resolvedExpressionMorphTargets: rigReport?.expressions?.resolvedMorphTargetCount ?? 0,
      missingExpressionPresets: rigReport?.expressions?.missingPresets ?? [],
      expressionCoverageGroups: buildExpressionCoverageGroups(rigReport?.expressions),
      eyeBones: rigReport?.eyeBones ?? null,
      fingerChains: rigReport?.fingerChains ?? null,
    },
    notes: [
      "Face landmarks are opt-in with ?face-landmarks=on or setFaceLandmarksEnabled(true) because 478 points increase recording and forwarding payload size.",
      "MediaPipe Tasks Vision does not output final avatar bone quaternions; body, wrist, palm, and finger rotations are inferred during retargeting.",
    ],
  };
}

function buildTrackedHandReport(side, frame, rigReport) {
  const prefix = side === "Left" ? "left" : "right";
  const landmarks = frame?.[`${prefix}HandLandmarks`];
  const worldLandmarks = frame?.[`${prefix}HandWorldLandmarks`];
  const fingerChains = rigReport?.fingerChains?.[side] ?? {};

  return {
    landmarkCount: landmarkCount(landmarks),
    worldLandmarkCount: landmarkCount(worldLandmarks),
    tracked: landmarkCount(landmarks) === 21,
    worldTracked: landmarkCount(worldLandmarks) === 21,
    palmSource: landmarkCount(worldLandmarks) === 21
      ? "worldLandmarks"
      : landmarkCount(landmarks) === 21
      ? "imageLandmarks"
      : "none",
    fingerChains,
  };
}

function landmarkCount(landmarks) {
  return Array.isArray(landmarks) ? landmarks.length : 0;
}

function startMotionRecording() {
  state.motionRecording.active = true;
  state.motionRecording.createdAt = new Date().toISOString();
  state.motionRecording.source = {
    ...getCurrentMotionSourceMeta(),
    recordingFrameLimit: MOTION_RECORDING_FRAME_LIMIT,
  };
  state.motionRecording.frames = [];
  state.motionRecording.droppedFrames = 0;
  state.motionRecording.lastRecording = null;
  return getMotionRecordingStatus();
}

function stopMotionRecording() {
  state.motionRecording.active = false;
  state.motionRecording.lastRecording = buildCurrentMotionRecording();
  return state.motionRecording.lastRecording;
}

function getMotionRecording() {
  if (state.motionRecording.active || state.motionRecording.frames.length > 0) {
    return buildCurrentMotionRecording();
  }

  return state.motionRecording.lastRecording;
}

function getMotionRecordingJsonl() {
  const recording = getMotionRecording();

  return recording ? serializeMotionRecordingJsonl(recording) : "";
}

function clearMotionRecording() {
  state.motionRecording.active = false;
  state.motionRecording.createdAt = "";
  state.motionRecording.source = null;
  state.motionRecording.frames = [];
  state.motionRecording.droppedFrames = 0;
  state.motionRecording.lastRecording = null;
  return getMotionRecordingStatus();
}

function getMotionRecordingStatus() {
  return {
    active: state.motionRecording.active,
    frameCount: state.motionRecording.frames.length,
    droppedFrames: state.motionRecording.droppedFrames,
    createdAt: state.motionRecording.createdAt,
    source: state.motionRecording.source,
    frameLimit: MOTION_RECORDING_FRAME_LIMIT,
  };
}

function buildCurrentMotionRecording() {
  return createMotionRecording({
    createdAt: state.motionRecording.createdAt || new Date().toISOString(),
    source: state.motionRecording.source ?? getCurrentMotionSourceMeta(),
    frames: state.motionRecording.frames,
    droppedFrames: state.motionRecording.droppedFrames,
  });
}

function appendMotionRecordingFrame(motionFrame) {
  if (!state.motionRecording.active) {
    return;
  }

  state.motionRecording.frames.push(serializeMotionFrame(motionFrame));

  if (state.motionRecording.frames.length > MOTION_RECORDING_FRAME_LIMIT) {
    state.motionRecording.frames.splice(
      0,
      state.motionRecording.frames.length - MOTION_RECORDING_FRAME_LIMIT,
    );
    state.motionRecording.droppedFrames += 1;
  }
}

function loadMotionRecording(recording) {
  const normalizedRecording = normalizeMotionRecording(recording);

  if (state.motionRecording.active) {
    stopMotionRecording();
  }

  stopCamera({
    preserveError: true,
    preserveReplay: true,
    cameraStatus: "Preparing replay",
  });
  stopMotionReplay({ resetPose: true, silent: true });
  resetBodyValidation();
  clearCanvas();
  state.avatarRenderer?.resetDepthCalibration?.();
  state.inputKind = "replay";
  state.videoFileName = normalizedRecording.source?.videoFileName ?? "";
  state.motionReplay.active = true;
  state.motionReplay.recording = normalizedRecording;
  state.motionReplay.frameIndex = 0;
  state.motionReplay.startedAt = 0;
  state.motionReplay.baseTimestamp = normalizedRecording.frames[0]?.timestamp ?? 0;
  setText("cameraStatus", `Replay running: ${normalizedRecording.frames.length} frames`);
  updateControls();
  scheduleMotionReplayFrame();
  return getMotionReplayStatus();
}

function loadMotionRecordingJsonl(source) {
  return loadMotionRecording(parseMotionRecordingJsonl(source));
}

function getMotionReplayStatus() {
  return {
    active: state.motionReplay.active,
    frameIndex: state.motionReplay.frameIndex,
    frameCount: state.motionReplay.recording?.frames?.length ?? 0,
    source: state.motionReplay.recording?.source ?? null,
  };
}

function scheduleMotionReplayFrame() {
  if (!state.motionReplay.active) {
    return;
  }

  state.motionReplay.animationFrameId = requestAnimationFrame(runMotionReplayFrame);
}

function runMotionReplayFrame(timestamp) {
  if (!state.motionReplay.active || !state.motionReplay.recording) {
    return;
  }

  const frames = state.motionReplay.recording.frames;

  if (frames.length === 0 || state.motionReplay.frameIndex >= frames.length) {
    stopMotionReplay({ resetPose: false, silent: true });
    setText("cameraStatus", "Replay complete");
    updateControls();
    return;
  }

  if (state.motionReplay.startedAt <= 0) {
    state.motionReplay.startedAt = timestamp;
    state.motionReplay.baseTimestamp = frames[0].timestamp;
  }

  const elapsed = timestamp - state.motionReplay.startedAt;
  let processed = 0;

  while (state.motionReplay.frameIndex < frames.length && processed < 3) {
    const frame = frames[state.motionReplay.frameIndex];
    const frameElapsed = frame.timestamp - state.motionReplay.baseTimestamp;

    if (processed > 0 && frameElapsed > elapsed) {
      break;
    }

    processMotionFrame(frame, {
      record: false,
      forward: true,
      draw: true,
      metrics: true,
    });
    state.motionReplay.frameIndex += 1;
    processed += 1;
  }

  scheduleMotionReplayFrame();
}

function stopMotionReplay(options = {}) {
  if (state.motionReplay.animationFrameId) {
    cancelAnimationFrame(state.motionReplay.animationFrameId);
  }

  const wasActive = state.motionReplay.active;
  state.motionReplay.active = false;
  state.motionReplay.recording = null;
  state.motionReplay.frameIndex = 0;
  state.motionReplay.animationFrameId = 0;
  state.motionReplay.startedAt = 0;
  state.motionReplay.baseTimestamp = 0;

  if (options.resetPose) {
    resetAvatarPose();
  }

  if (state.inputKind === "replay") {
    state.inputKind = "idle";
    state.videoFileName = "";
  }

  if (wasActive && !options.silent) {
    setText("cameraStatus", "Replay stopped");
    updateControls();
  }
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
  const projectedSegmentRows = buildProjectedSegmentRows(samples);
  const motionDirectionRows = segmentRows.filter(
    (segment) => !BODY_MOTION_AGREEMENT_EXCLUDED_SEGMENTS.has(segment.name),
  );
  const directionOverall = summarizeErrors(segmentRows);
  const motionDirectionOverall = summarizeErrors(motionDirectionRows);
  const visualOverall = summarizeVisualErrors(visualRows);
  const projectedSegmentOverall = summarizeProjectedSegmentErrors(projectedSegmentRows);
  const strictValidation = buildStrictValidationReport(samples);
  const depthValidation = buildDepthValidationReport(samples);
  const motionAgreement = buildMotionAgreementReport({
    directionOverall: motionDirectionOverall,
    directionRows: motionDirectionRows,
    visualOverall,
    projectedSegmentOverall,
    projectedSegmentRows,
    frontBackRows: buildFrontBackSideOrderRows(samples),
    depthFrontBackOverall: depthValidation.frontBackOverall,
  });
  const depthCalibration = buildDepthCalibrationReport(samples);

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
    overall: directionOverall,
    byGroup: summarizeRowsByKey(segmentRows, "group"),
    bySegment: summarizeRowsByKey(segmentRows, "name"),
    visualMatchThreshold: BODY_VISUAL_MATCH_THRESHOLD,
    visualOverall,
    visualByGroup: summarizeVisualRowsByKey(visualRows, "group"),
    visualByJoint: summarizeVisualRowsByKey(visualRows, "name"),
    projectedSegmentMatchThresholdDeg: BODY_PROJECTED_SEGMENT_ANGLE_THRESHOLD_DEG,
    projectedSegmentOverall,
    projectedSegmentByGroup: summarizeProjectedSegmentRowsByKey(projectedSegmentRows, "group"),
    projectedSegmentByName: summarizeProjectedSegmentRowsByKey(projectedSegmentRows, "name"),
    motionAgreement,
    faceHeadPose: buildFaceHeadPoseReport(samples),
    strictValidation,
    sourceAvatarDivergence: buildSourceAvatarDivergenceReport(samples),
    depthValidation,
    depthCalibration,
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

function buildFaceHeadPoseReport(samples) {
  const rows = samples
    .map((sample) => ({
      videoTime: sample.videoTime,
      status: sample.faceHeadPose?.status ?? "unknown",
      tracked: Boolean(sample.faceHeadPose?.tracked),
      withinGrace: Boolean(sample.faceHeadPose?.withinGrace),
      layout: sample.faceHeadPose?.layout ?? "unknown",
      faceYawDeg: Number(sample.faceHeadPose?.faceEulerDeg?.y),
      boneYawDeg: Number(sample.faceHeadPose?.boneEulerDeg?.y),
      boneAngularVelocityDegPerSec: Number(sample.faceHeadPose?.boneAngularVelocityDegPerSec),
      jumpCount: Number(sample.faceHeadPose?.jumpCount),
      lastJumpReason: sample.faceHeadPose?.lastJumpReason ?? null,
    }))
    .filter((row) => Number.isFinite(row.faceYawDeg) || Number.isFinite(row.boneYawDeg));
  const yawPairs = rows.filter((row) => Number.isFinite(row.faceYawDeg) && Number.isFinite(row.boneYawDeg));
  const signRows = yawPairs.filter((row) => Math.abs(row.faceYawDeg) >= 2 && Math.abs(row.boneYawDeg) >= 2);
  const signMatchedCount = signRows.filter((row) => Math.sign(row.faceYawDeg) === Math.sign(row.boneYawDeg)).length;
  const velocities = rows
    .map((row) => row.boneAngularVelocityDegPerSec)
    .filter((value) => Number.isFinite(value));
  const jumpCounts = rows
    .map((row) => row.jumpCount)
    .filter((value) => Number.isFinite(value));
  const layouts = summarizeCategoricalRows(rows, "layout");
  const statuses = summarizeCategoricalRows(rows, "status");
  let lastJumpReason = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].lastJumpReason) {
      lastJumpReason = rows[i].lastJumpReason;
      break;
    }
  }

  return {
    sampleCount: rows.length,
    yawPairCount: yawPairs.length,
    signComparableCount: signRows.length,
    signMatchedCount,
    signMatchRate: signRows.length > 0 ? signMatchedCount / signRows.length : null,
    yawCorrelation: yawPairs.length >= 3
      ? pearsonCorrelation(
        yawPairs.map((row) => row.faceYawDeg),
        yawPairs.map((row) => row.boneYawDeg),
      )
      : null,
    maxBoneAngularVelocityDegPerSec: velocities.length > 0 ? Math.max(...velocities) : null,
    jumpCount: jumpCounts.length > 0 ? Math.max(...jumpCounts) : 0,
    lastJumpReason,
    layouts,
    statuses,
    lastSample: rows.length > 0 ? rows[rows.length - 1] : null,
  };
}

function summarizeCategoricalRows(rows, field) {
  const counts = {};

  for (const row of rows) {
    const value = String(row[field] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

function pearsonCorrelation(xs, ys) {
  if (xs.length !== ys.length || xs.length < 2) {
    return null;
  }

  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denominator = Math.sqrt(denomX * denomY);

  return denominator > 0 ? numerator / denominator : null;
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

function buildSourceAvatarDivergenceReport(samples) {
  const segmentRows = samples.flatMap((sample) =>
    (sample.sourceAvatarDivergence?.segments ?? [])
      .filter((segment) => Number.isFinite(segment.errorDeg))
      .map((segment) => ({
        videoTime: sample.videoTime,
        retargetMode: sample.retargetMode ?? sample.sourceAvatarDivergence?.retargetMode ?? "unknown",
        name: segment.name,
        group: segment.group,
        bone: segment.bone,
        errorDeg: segment.errorDeg,
        targetDirection: segment.targetDirection,
        avatarDirection: segment.avatarDirection,
      })),
  );
  const rootYawRows = samples
    .map((sample) => ({
      videoTime: sample.videoTime,
      retargetMode: sample.retargetMode ?? "unknown",
      yawOffsetDeg: sample.sourceAvatarDivergence?.rootYaw?.yawOffsetDeg,
      targetYawDeg: sample.sourceAvatarDivergence?.rootYaw?.targetYawDeg,
      solverYawDeg: sample.sourceAvatarDivergence?.rootYaw?.solverYawDeg,
      rawJump: sample.sourceAvatarDivergence?.rootYaw?.rawJump,
      sideOrderFlip: sample.sourceAvatarDivergence?.rootYaw?.sideOrderFlip,
    }))
    .filter((row) => Number.isFinite(row.yawOffsetDeg) || Number.isFinite(row.targetYawDeg) || Number.isFinite(row.solverYawDeg));
  const palmRows = samples.flatMap((sample) =>
    (sample.sourceAvatarDivergence?.handPalm?.bySide ?? [])
      .filter((row) => row.tracked || Number.isFinite(row.palmDot))
      .map((row) => ({
        videoTime: sample.videoTime,
        retargetMode: sample.retargetMode ?? sample.sourceAvatarDivergence?.retargetMode ?? "unknown",
        side: row.side,
        source: row.source,
        palmDot: row.palmDot,
        inverted: row.inverted,
      })),
  );

  return {
    validationScope: "source_skeleton_vs_avatar_3d_axes",
    limitations: [
      "Compares source skeleton segment directions to current avatar bone axes, not absolute human motion truth.",
      "Hand palm dot uses available hand landmark plane diagnostics and may be absent when hands are untracked.",
    ],
    retargetModes: countByValue(segmentRows, "retargetMode"),
    angularError: summarizeErrors(segmentRows),
    angularErrorByMode: summarizeRowsByKey(segmentRows, "retargetMode"),
    angularErrorByGroup: summarizeRowsByKey(segmentRows, "group"),
    angularErrorBySegment: summarizeRowsByKey(segmentRows, "name"),
    rootYaw: summarizeSourceAvatarRootYawRows(rootYawRows),
    handPalm: summarizeSourceAvatarPalmRows(palmRows),
    worstSegments: segmentRows
      .slice()
      .sort((a, b) => b.errorDeg - a.errorDeg)
      .slice(0, 16),
  };
}

function summarizeSourceAvatarRootYawRows(rows) {
  const yawTargetErrors = rows
    .filter((row) => Number.isFinite(row.yawOffsetDeg) && Number.isFinite(row.targetYawDeg))
    .map((row) => ({
      ...row,
      errorDeg: angularDistanceDeg(row.yawOffsetDeg, row.targetYawDeg),
    }));
  const jumps = rows.filter((row) => row.rawJump).length;
  const sideOrderFlips = rows.filter((row) => row.sideOrderFlip).length;

  return {
    count: rows.length,
    targetError: summarizeErrors(yawTargetErrors),
    rawJumpCount: jumps,
    sideOrderFlipCount: sideOrderFlips,
    byMode: summarizeRowsByKey(yawTargetErrors, "retargetMode"),
  };
}

function summarizeSourceAvatarPalmRows(rows) {
  const validRows = rows.filter((row) => Number.isFinite(row.palmDot));
  const inverted = validRows.filter((row) => row.inverted).length;
  const dotRows = validRows.map((row) => ({
    ...row,
    error: 1 - row.palmDot,
    matched: row.palmDot >= 0,
  }));

  return {
    count: rows.length,
    trackedCount: validRows.length,
    inversionCount: inverted,
    inversionRatio: validRows.length > 0 ? inverted / validRows.length : 0,
    dot: summarizeStrictRows(dotRows, "palmDot"),
    bySide: summarizeStrictRowsByKey(dotRows, "side", "palmDot"),
    byMode: summarizeStrictRowsByKey(dotRows, "retargetMode", "palmDot"),
    worst: validRows
      .slice()
      .sort((a, b) => a.palmDot - b.palmDot)
      .slice(0, 12),
  };
}

function buildMotionAgreementReport({
  directionOverall,
  directionRows,
  visualOverall,
  projectedSegmentOverall,
  projectedSegmentRows,
  frontBackRows,
  depthFrontBackOverall,
}) {
  const visualFrontBack = summarizeStrictRows(frontBackRows, "mismatch");
  const depthFrontBack = depthFrontBackOverall?.count > 0 ? depthFrontBackOverall : null;
  const frontBackUsesDepth = Boolean(
    depthFrontBack &&
    depthFrontBack.count >= BODY_MOTION_AGREEMENT_FRONT_BACK_DEPTH_MIN_SAMPLES &&
    depthFrontBack.matchRate >= 0.9 &&
    visualFrontBack.matchRate < 0.9,
  );
  const frontBack = frontBackUsesDepth ? depthFrontBack : visualFrontBack;
  const components = {
    direction: {
      count: directionOverall.count,
      matchRate: directionOverall.matchRate,
      meanErrorDeg: directionOverall.meanErrorDeg,
      p90ErrorDeg: directionOverall.p90ErrorDeg,
    },
    frontBack: {
      count: frontBack.count,
      matchRate: frontBack.matchRate,
      mismatchRate: frontBack.mean,
      source: frontBackUsesDepth ? "mediapipe-relative-depth" : "visual-side-order",
      visualMatchRate: visualFrontBack.matchRate,
      visualCount: visualFrontBack.count,
      depthMatchRate: depthFrontBack?.matchRate ?? null,
      depthCount: depthFrontBack?.count ?? 0,
    },
    projection: {
      count: projectedSegmentOverall.count,
      matchRate: projectedSegmentOverall.matchRate,
      meanErrorDeg: projectedSegmentOverall.meanErrorDeg,
      p90ErrorDeg: projectedSegmentOverall.p90ErrorDeg,
    },
  };
  const overallScore = weightedMotionAgreementScore(components);
  const componentGate = buildMotionAgreementComponentGate(components);

  return {
    validationScope: "cross_model_motion_agreement",
    limitations: [
      "Uses bone direction as the primary motion signal so different humanoid proportions are not punished as motion failures.",
      "Projection uses 2D projected segment direction agreement, not same-proportion joint distance.",
      "The separate visualOverall report remains a stricter same-proportion joint-distance diagnostic.",
      "Front/back orientation uses visual torso side-order unless MediaPipe relative depth has enough samples, passes, and the visual side-order floor has not collapsed.",
      "Crossing wrists or ankles are not treated as model-front failures.",
    ],
    scoreWeights: BODY_MOTION_AGREEMENT_SCORE_WEIGHTS,
    thresholds: {
      directionErrorDeg: BODY_MATCH_THRESHOLD_DEG,
      projectionSegmentAngleDeg: BODY_PROJECTED_SEGMENT_ANGLE_THRESHOLD_DEG,
      excludedDirectionSegments: [...BODY_MOTION_AGREEMENT_EXCLUDED_SEGMENTS],
      frontBackPairs: BODY_FRONT_BACK_SIDE_ORDER_PAIRS.map((pair) => pair.name),
    },
    overall: {
      score: overallScore,
      scorePercent: overallScore * 100,
      passTarget: 0.95,
      componentPassTarget: 0.9,
      passed: overallScore >= 0.95 && componentGate.passed,
    },
    components,
    componentGate,
    directionByGroup: summarizeRowsByKey(directionRows, "group"),
    projectionByGroup: summarizeProjectedSegmentRowsByKey(projectedSegmentRows, "group"),
    projectionByName: summarizeProjectedSegmentRowsByKey(projectedSegmentRows, "name"),
    visualJointSanity: {
      count: visualOverall.count,
      matchRate: visualOverall.matchRate,
      meanError: visualOverall.meanError,
      p90Error: visualOverall.p90Error,
      matchThreshold: visualOverall.matchThreshold,
    },
    frontBackByName: summarizeStrictRowsByKey(frontBackRows, "name", "mismatch"),
    frontBackMismatches: frontBackRows.filter((row) => !row.matched).slice(0, 12),
  };
}

function buildMotionAgreementComponentGate(components) {
  const minMatchRate = 0.9;
  const results = Object.fromEntries(
    Object.entries(components)
      .filter(([name]) => (BODY_MOTION_AGREEMENT_SCORE_WEIGHTS[name] ?? 0) > 0)
      .map(([name, component]) => [
        name,
        {
          matchRate: component.matchRate,
          passed: component.count > 0 && component.matchRate >= minMatchRate,
        },
      ]),
  );
  const frontBack = components.frontBack;

  if (
    frontBack?.source === "mediapipe-relative-depth" &&
    Number(frontBack.visualCount ?? 0) >= BODY_MOTION_AGREEMENT_FRONT_BACK_DEPTH_MIN_SAMPLES
  ) {
    results.frontBackVisual = {
      count: frontBack.visualCount,
      matchRate: frontBack.visualMatchRate,
      minMatchRate: BODY_MOTION_AGREEMENT_FRONT_BACK_VISUAL_FLOOR,
      passed: frontBack.visualMatchRate >= BODY_MOTION_AGREEMENT_FRONT_BACK_VISUAL_FLOOR,
    };
  }

  return {
    minMatchRate,
    frontBackVisualFloor: BODY_MOTION_AGREEMENT_FRONT_BACK_VISUAL_FLOOR,
    frontBackDepthMinSamples: BODY_MOTION_AGREEMENT_FRONT_BACK_DEPTH_MIN_SAMPLES,
    passed: Object.values(results).every((result) => result.passed),
    components: results,
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
        targetDirection: segment.targetDirection,
        avatarDirection: segment.avatarDirection,
      })),
  );
  const depthSalientRows = depthRows.filter((row) => row.depthSalient);
  const frontBackRows = buildDepthFrontBackRows(depthRows);
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
  const lengthConsistencyRows = collectDepthCalibrationRows(samples);

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
    lengthConsistency: summarizeLengthConsistency(lengthConsistencyRows),
    frontBackOverall: summarizeStrictRows(frontBackRows, "mismatch"),
    frontBackByGroup: summarizeStrictRowsByKey(frontBackRows, "group", "mismatch"),
    frontBackBySegment: summarizeStrictRowsByKey(frontBackRows, "name", "mismatch"),
    frontBackMismatches: frontBackRows.filter((row) => !row.matched).slice(0, 12),
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

function buildDepthCalibrationReport(samples) {
  const snapshots = samples
    .map((sample) => sample.depthCalibration)
    .filter(Boolean);
  const rows = collectDepthCalibrationRows(samples);
  const latest = snapshots[snapshots.length - 1] ?? null;
  const allSegmentSummary = summarizeLengthConsistency(rows);
  const gateRows = rows.filter((row) => DEPTH_CALIBRATION_GATE_SEGMENT_NAMES.has(row.name));
  const summary = summarizeLengthConsistency(gateRows.length > 0 ? gateRows : rows);
  const ready = snapshots.some((snapshot) => snapshot.ready);
  const externalReferenceSegmentCount = latest?.externalReferenceSegmentCount ?? 0;
  const segmentGate = evaluateDepthCalibrationSegmentGate({
    cvReliableSegmentCount: summary.cvReliableSegmentCount,
    externalReferenceSegmentCount,
  });
  const profileAssisted = segmentGate.profileAssisted;
  const reliableSegmentsPassed = segmentGate.reliableSegmentsPassed;
  const clampPassed = (summary.clampedRatio ?? 0) <= DEPTH_CALIBRATION_CLAMP_WARNING_RATIO;
  const clampGatePassed = profileAssisted ? clampPassed : true;
  const passed = ready &&
    summary.score >= DEPTH_CALIBRATION_TARGET_SCORE &&
    reliableSegmentsPassed &&
    clampGatePassed &&
    summary.meanSegmentCv <= 0.05 &&
    summary.p95SegmentCv <= 0.08;

  return {
    validationScope: "dynamic_depth_solver_segment_length_consistency",
    mode: latest?.mode ?? DEPTH_CALIBRATION_MODE_DYNAMIC,
    ready,
    frozen: Boolean(latest?.frozen),
    targetScore: DEPTH_CALIBRATION_TARGET_SCORE,
    thresholds: {
      relativeLengthError: DEPTH_CALIBRATION_LENGTH_ERROR_THRESHOLD,
      smoothness: DEPTH_CALIBRATION_SMOOTHNESS_THRESHOLD,
      meanSegmentCv: 0.05,
      p95SegmentCv: 0.08,
      minCvSegmentSamples: DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES,
      minReliableCvSegments: DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS,
      clampWarningRatio: DEPTH_CALIBRATION_CLAMP_WARNING_RATIO,
      runtimeP95Ms: DEPTH_CALIBRATION_RUNTIME_P95_BUDGET_MS,
      poseQuality: DEPTH_CALIBRATION_POSE_QUALITY_TARGET_SCORE,
    },
    passed,
    referenceSegmentCount: latest?.referenceSegmentCount ?? 0,
    externalReferenceSegmentCount,
    profileAssisted,
    profileLocked: Boolean(latest?.profileLocked),
    observableSegmentRule: {
      mode: profileAssisted ? "external-profile-assisted" : "observed-cv-only",
      observableReliableSegmentCount: segmentGate.observableReliableSegmentCount,
      observedReliableSegmentCount: segmentGate.observedReliableSegmentCount,
      externalReferenceSegmentCount: segmentGate.externalReferenceSegmentCount,
      minReliableSegments: segmentGate.minReliableSegments,
      minObservedWithProfile: segmentGate.minObservedWithProfile,
      observedRequirementMet: segmentGate.observedRequirementMet,
      reliableSegmentsPassed,
      clampPassed,
      clampGatePassed,
    },
    poseQuality: latest?.poseQuality ?? null,
    score: summary.score,
    summary,
    allSegmentSummary,
    gateSegmentNames: [...DEPTH_CALIBRATION_GATE_SEGMENT_NAMES],
    byGroup: summarizeDepthCalibrationRowsByKey(rows, "group"),
    bySegment: summarizeDepthCalibrationRowsByKey(rows, "name"),
    warnings: buildDepthCalibrationWarnings(summary, ready, {
      profileAssisted,
      reliableSegmentsPassed,
      observedRequirementMet: segmentGate.observedRequirementMet,
      clampPassed,
    }),
  };
}

function collectDepthCalibrationRows(samples) {
  return samples.flatMap((sample) =>
    (sample.depthCalibration?.segments ?? [])
      .filter((segment) => Number.isFinite(segment.relativeLengthError))
      .map((segment) => ({
        mode: sample.depthCalibration.mode,
        ready: Boolean(sample.depthCalibration.ready),
        frozen: Boolean(sample.depthCalibration.frozen),
        name: segment.name,
        group: segment.group,
        gated: Boolean(segment.gated),
        actualLength: segment.actualLength,
        targetLength: segment.targetLength,
        referenceRatio: segment.referenceRatio,
        referenceSource: sample.depthCalibration.referenceRatioSources?.[segment.name] ?? null,
        relativeLengthError: segment.relativeLengthError,
        smoothnessDelta: segment.smoothnessDelta,
        smoothnessOk: Boolean(segment.smoothnessOk),
        clamped: Boolean(segment.clamped),
        matched: Boolean(segment.matched),
      })),
  );
}

function buildDepthCalibrationWarnings(summary, ready, options = {}) {
  const warnings = [];

  if (!ready) {
    warnings.push("dynamic depth calibration did not collect enough worldLandmarks reference samples");
  }

  if (!options.clampPassed) {
    warnings.push(`length solver clamped ${(summary.clampedRatio * 100).toFixed(1)}% of gated samples`);
  }

  if ((summary.cvSparseSegmentCount ?? 0) > 0) {
    warnings.push(`${summary.cvSparseSegmentCount} segment CV diagnostics had fewer than ${DEPTH_CALIBRATION_MIN_CV_SEGMENT_SAMPLES} unclamped samples`);
  }

  if (!options.profileAssisted && (summary.cvReliableSegmentCount ?? 0) < DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS) {
    warnings.push(`only ${summary.cvReliableSegmentCount ?? 0} reliable CV segments collected; target is ${DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS}`);
  } else if (options.profileAssisted && !options.reliableSegmentsPassed) {
    if (!options.observedRequirementMet) {
      warnings.push("external profile is loaded but not enough observed reliable CV segments were collected");
    } else {
      warnings.push(`external profile did not provide enough observable segments; target is ${DEPTH_CALIBRATION_MIN_RELIABLE_CV_SEGMENTS}`);
    }
  }

  return warnings;
}

function buildDepthFrontBackRows(depthRows) {
  return depthRows
    .filter((row) => row.depthSalient)
    .map((row) => {
      const sourceZ = row.targetDirection?.[2];
      const avatarZ = row.avatarDirection?.[2];

      if (!Number.isFinite(sourceZ) || !Number.isFinite(avatarZ)) {
        return null;
      }

      if (Math.abs(sourceZ) < 0.05 || Math.abs(avatarZ) < 0.05) {
        return null;
      }

      const matched = Math.sign(sourceZ) === Math.sign(avatarZ);

      return {
        videoTime: row.videoTime,
        name: row.name,
        group: row.group,
        bone: row.bone,
        sourceZ,
        avatarZ,
        mismatch: matched ? 0 : 1,
        matched,
      };
    })
    .filter(Boolean);
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

function buildProjectedSegmentRows(samples) {
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

        if (
          vectorLength(sourceVector) < BODY_STRICT_MIN_SEGMENT_LENGTH ||
          vectorLength(avatarVector) < BODY_STRICT_MIN_SEGMENT_LENGTH
        ) {
          return null;
        }

        const errorDeg = angleBetweenVectorsDeg(sourceVector, avatarVector);

        return {
          videoTime: sample.videoTime,
          name: segment.name,
          group: segment.group,
          from: segment.from,
          to: segment.to,
          errorDeg,
          matched: errorDeg <= BODY_PROJECTED_SEGMENT_ANGLE_THRESHOLD_DEG,
        };
      })
      .filter(Boolean);
  });
}

function buildStrictSideOrderRows(samples, pairs = BODY_STRICT_SIDE_ORDER_PAIRS) {
  return samples.flatMap((sample) => {
    const joints = visualJointMap(sample);

    return pairs
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

function buildFrontBackSideOrderRows(samples) {
  return buildStrictSideOrderRows(samples, BODY_FRONT_BACK_SIDE_ORDER_PAIRS);
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

function weightedMotionAgreementScore(components) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, weight] of Object.entries(BODY_MOTION_AGREEMENT_SCORE_WEIGHTS)) {
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
    getDepthCalibrationReport: () => state.avatarRenderer?.getDepthCalibrationSnapshot?.() ?? null,
    getDepthCalibrationMode: () => state.avatarRenderer?.getDepthCalibrationMode?.() ?? null,
    setDepthCalibrationMode: (value) => {
      const nextMode = state.avatarRenderer?.setDepthCalibrationMode?.(value) ?? null;
      resetBodyValidation();
      return nextMode;
    },
    setDepthCalibrationReference: (profile) => {
      const snapshot = state.avatarRenderer?.setDepthCalibrationReference?.(profile) ?? null;
      resetBodyValidation();
      return snapshot;
    },
    clearDepthCalibrationReference: () => {
      const snapshot = state.avatarRenderer?.clearDepthCalibrationReference?.() ?? null;
      resetBodyValidation();
      return snapshot;
    },
    resetDepthCalibration: resetDepthCalibrationFromUi,
    getAvatarPerformanceReport: () => state.avatarRenderer?.getPerformanceSnapshot?.() ?? null,
    getAppPerformanceReport,
    getMotionStatusHudSnapshot,
    clearAppPerformanceSamples: resetAppPerformance,
    getDetectionPumpStatus: () => getAppPerformanceReport().pump,
    getTrackingWorkerStatus,
    setDebugOverlayEnabled: (value) => {
      state.debugOverlayEnabled = Boolean(value);

      if (!state.debugOverlayEnabled) {
        clearCanvas();
      }

      return state.debugOverlayEnabled;
    },
    getDebugOverlayEnabled: () => state.debugOverlayEnabled,
    getAvatarMotionState: () => state.avatarRenderer?.getMotionStateSnapshot?.() ?? null,
    getAvatarRetargetMode: () => state.avatarRenderer?.getRetargetMode?.() ?? state.avatarRetargetMode,
    setAvatarRetargetMode: (value) => {
      const nextMode = normalizeAvatarRetargetMode(value);
      state.avatarRetargetMode = nextMode;
      const applied = state.avatarRenderer?.setRetargetMode?.(nextMode) ?? nextMode;
      resetBodyValidation();
      return applied;
    },
    clearAvatarPerformanceSamples: () => state.avatarRenderer?.clearPerformanceSamples?.() ?? null,
    getAvatarRigReport: () => state.avatarRenderer?.getModelDiagnostics?.() ?? null,
    getVrmRuntimeReport: () => state.avatarRenderer?.getVrmRuntimeReport?.() ?? null,
    setVrmSpringBoneEnabled: (value) => state.avatarRenderer?.setVrmSpringBoneEnabled?.(value) ?? null,
    getTrackedChannelReport,
    getAvatarViewState: () => state.avatarRenderer?.getViewState?.() ?? null,
    resetAvatarView: () => state.avatarRenderer?.resetView?.() ?? null,
    processValidationMotionFrame: (motionFrame) => {
      if (!state.bodyValidation.enabled) {
        throw new Error("Validation mode is not enabled.");
      }

      processMotionFrame(motionFrame, {
        record: false,
        forward: false,
        draw: false,
        metrics: false,
      });

      return state.bodyValidation.lastSample;
    },
    clearBodyValidation: resetBodyValidation,
    startMotionRecording,
    stopMotionRecording,
    getMotionRecording,
    getMotionRecordingJsonl,
    clearMotionRecording,
    getMotionRecordingStatus,
    loadMotionRecording,
    loadMotionRecordingJsonl,
    getMotionReplayStatus,
    stopMotionReplay,
    setFaceTrackingEnabled,
    setFaceLandmarksEnabled,
    getFaceTrackingStatus,
    getFaceTrackingEnabled,
    connectMotionForwarding: (url) => state.motionForwarder.connect(url),
    disconnectMotionForwarding: () => state.motionForwarder.disconnect(),
    getMotionForwardingStatus: () => state.motionForwarder.getStatus(),
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

function summarizeProjectedSegmentRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => candidate[key] === value);

    if (!result[value]) {
      result[value] = summarizeProjectedSegmentErrors(groupRows);
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

function summarizeDepthCalibrationRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    const groupRows = rows.filter((candidate) => (candidate[key] ?? "unknown") === value);

    if (!result[value]) {
      result[value] = summarizeLengthConsistency(groupRows);
    }

    return result;
  }, {});
}

function countByValue(rows, key) {
  return (rows ?? []).reduce((result, row) => {
    const value = String(row?.[key] ?? "unknown");
    result[value] = (result[value] ?? 0) + 1;
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

function angularDistanceDeg(a, b) {
  return Math.abs(normalizeAngleDeg(Number(a) - Number(b)));
}

function normalizeAngleDeg(value) {
  let angle = Number(value) % 360;

  if (angle > 180) {
    angle -= 360;
  }
  if (angle <= -180) {
    angle += 360;
  }

  return angle;
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

function summarizeProjectedSegmentErrors(rows) {
  const values = rows
    .map((row) => row.errorDeg)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const matchedCount = rows.filter((row) => row.matched).length;

  return {
    count: values.length,
    matchedCount,
    matchRate: rows.length > 0 ? matchedCount / rows.length : 0,
    matchThresholdDeg: BODY_PROJECTED_SEGMENT_ANGLE_THRESHOLD_DEG,
    meanErrorDeg: average(values),
    medianErrorDeg: percentile(values, 0.5),
    p90ErrorDeg: percentile(values, 0.9),
    maxErrorDeg: values.length > 0 ? values[values.length - 1] : 0,
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
  const replayActive = state.motionReplay.active;

  if (state.elements.startButton) {
    state.elements.startButton.disabled =
      missingRequiredDom || state.starting || state.active || replayActive;
  }

  if (state.elements.stopButton) {
    state.elements.stopButton.disabled =
      missingRequiredDom ||
      (!state.starting && !state.active && !state.stream && !state.videoFileUrl && !replayActive);
  }

  if (state.elements.videoFileInput) {
    state.elements.videoFileInput.disabled = missingRequiredDom || state.starting || replayActive;
  }

  if (state.elements.avatarFileInput) {
    state.elements.avatarFileInput.disabled = missingRequiredDom || state.starting;
  }

  if (state.elements.avatarDefaultButton) {
    state.elements.avatarDefaultButton.disabled =
      missingRequiredDom || state.starting || (!state.avatarFileUrl && !state.avatarFileName);
  }

  if (state.elements.avatarSkeletonToggle) {
    state.elements.avatarSkeletonToggle.disabled = false;
  }

  if (state.elements.faceTrackingToggle) {
    state.elements.faceTrackingToggle.disabled = false;
  }

  if (state.elements.modelSelect) {
    state.elements.modelSelect.disabled = state.starting || state.active || replayActive;
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

function getInitialAvatarDepthCalibrationMode() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("depth-calibration");

  if (value === DEPTH_CALIBRATION_MODE_STATIC) {
    return DEPTH_CALIBRATION_MODE_STATIC;
  }

  if (value === DEPTH_CALIBRATION_MODE_DYNAMIC) {
    return DEPTH_CALIBRATION_MODE_DYNAMIC;
  }

  return normalizeDepthCalibrationMode(value);
}

function getInitialDepthCalibrationProfileUrl() {
  return new URLSearchParams(globalThis.location?.search ?? "").get("calibration-profile") ?? "";
}

function getInitialDetectionPumpMode() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("pump");

  if (DETECTION_PUMP_MODES.has(value)) {
    return value;
  }

  return DETECTION_PUMP_AUTO;
}

function getInitialTrackingWorkerEnabled() {
  return isTruthyQueryFlag("tracking-worker");
}

function getInitialAvatarSmoothingMode() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("smoothing");
  const normalized = String(value ?? AVATAR_SMOOTHING_MODE_RETARGET).toLowerCase();
  return AVATAR_SMOOTHING_MODE_ALIASES[normalized] ?? AVATAR_SMOOTHING_MODE_RETARGET;
}

function getInitialAvatarRetargetMode() {
  const params = new URLSearchParams(globalThis.location?.search ?? "");
  return normalizeAvatarRetargetMode(
    params.get("avatar-retarget") ?? params.get("retarget-mode") ?? params.get("retarget"),
  );
}

function normalizeAvatarRetargetMode(value) {
  const normalized = String(value ?? AVATAR_RETARGET_MODE_STRICT).trim().toLowerCase();
  return AVATAR_RETARGET_MODE_ALIASES[normalized] ?? AVATAR_RETARGET_MODE_STRICT;
}

function getInitialDebugOverlayEnabled() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("debug-overlay");

  if (["0", "false", "off", "none"].includes(String(value).toLowerCase())) {
    return false;
  }

  return true;
}

function getInitialFaceTrackingEnabled() {
  return !isFalsyQueryFlag("face-tracking") || getInitialFaceLandmarksEnabled();
}

function getInitialFaceLandmarksEnabled() {
  return isTruthyQueryFlag("face-landmarks") || isTruthyQueryFlag("face-mesh");
}

function getInitialValidationEnabled() {
  return isTruthyQueryFlag("validation");
}

function getInitialMediaPipeDelegate() {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get("delegate");
  const normalized = String(value ?? "").toLowerCase();

  if (normalized === "cpu") {
    return MEDIAPIPE_FALLBACK_DELEGATE;
  }

  return MEDIAPIPE_PREFERRED_DELEGATE;
}

function isTruthyQueryFlag(name) {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get(name);
  return ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
}

function isFalsyQueryFlag(name) {
  const value = new URLSearchParams(globalThis.location?.search ?? "").get(name);
  return ["0", "false", "off", "no", "none"].includes(String(value).toLowerCase());
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

function isLikelyAvatarModelFile(file) {
  if (!file) {
    return false;
  }

  const type = (file.type ?? "").toLowerCase();

  if (type === "model/gltf-binary" || type === "model/gltf+json") {
    return true;
  }

  return /\.(glb|gltf|vrm)$/i.test(file.name ?? "");
}

function getSelectedAvatarModelUrl() {
  return state.avatarFileUrl || AVATAR_MODEL_URL;
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

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function setAvatarStatus(value) {
  setText("avatarStatus", value);
}

function setAvatarBoneCount(value) {
  setText("avatarBoneCount", String(value));
}

function setAvatarFaceStatus(value) {
  setText("avatarFaceStatus", value);
}

function setAvatarExpressionStatus(value) {
  setText("avatarExpressionStatus", value);
}

function updateFaceExpressionStatus(frame = state.latestMotionFrame) {
  setAvatarFaceStatus(buildFaceStatusLabel(frame));
  setAvatarExpressionStatus(buildExpressionStatusLabel(state.avatarRenderer?.getModelDiagnostics?.()?.expressions));
}

function buildFaceStatusLabel(frame) {
  const status = getFaceTrackingStatus();

  if (!status.enabled) {
    return "Off";
  }

  if (status.status === "failed") {
    return "Failed";
  }

  const blendShapeCount = Array.isArray(frame?.face?.blendShapes) ? frame.face.blendShapes.length : 0;

  if (blendShapeCount > 0) {
    return `Tracked ${blendShapeCount}`;
  }

  if (!status.modelLoaded || status.status === "loading" || status.status === "enabled") {
    return "Loading";
  }

  if (status.detectFrames > 0) {
    return "No face";
  }

  return "Ready";
}

function buildExpressionStatusLabel(expressions) {
  const targetCount = Number(expressions?.resolvedMorphTargetCount ?? 0);
  const presetCount = Number(expressions?.expressionPresetCount ?? 0);

  if (!Number.isFinite(targetCount) || targetCount <= 0) {
    return "No targets";
  }

  const coverage = buildExpressionCoverageGroups(expressions);
  const coverageLabel = coverage
    .filter((entry) => entry.supported)
    .map((entry) => entry.label);
  const compactCoverage = coverageLabel.length > 3
    ? `${coverageLabel.slice(0, 3).join("/")} +${coverageLabel.length - 3}`
    : coverageLabel.join("/");

  return compactCoverage
    ? `${compactCoverage} (${targetCount})`
    : `${presetCount} presets`;
}

function buildExpressionCoverageGroups(expressions) {
  if (!expressions || Number(expressions.expressionPresetCount ?? 0) <= 0) {
    return EXPRESSION_COVERAGE_GROUPS.map((group) => ({
      label: group.label,
      supported: false,
      supportedPresets: [],
      missingPresets: group.presets.slice(),
    }));
  }

  const missing = new Set(expressions?.missingPresets ?? []);

  return EXPRESSION_COVERAGE_GROUPS.map((group) => {
    const supportedPresets = group.presets.filter((preset) => !missing.has(preset));

    return {
      label: group.label,
      supported: supportedPresets.length > 0,
      supportedPresets,
      missingPresets: group.presets.filter((preset) => missing.has(preset)),
    };
  });
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
