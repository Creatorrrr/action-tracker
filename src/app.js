import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import { createAvatarRenderer } from "./avatar-renderer.js?v=20260717-face-gap-release-1";
import {
  MOTION_RECORDING_FRAME_LIMIT,
  MOTION_RECORDING_JSONL_MAX_CHUNK_FRAMES,
  MOTION_RECORDING_VERSION,
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
  serializeMotionRecordingJsonlChunk,
} from "./motion-frame.js?v=20260716-recording-chunks-1";
import { createMotionForwarder } from "./motion-forwarding.js?v=20260529-face-expression-1";
import { createLatestFramePump } from "./latest-frame-pump.js?v=20260716-pending-settlement-1";
import { createVideoPlaybackBackpressureController } from "./video-playback-backpressure.js?v=20260716-body-tail-hysteresis-1";
import {
  AUXILIARY_INFERENCE_LANES,
  createAuxiliaryInferenceArbiter,
} from "./auxiliary-inference-arbiter.js?v=20260716-capacity2-bounded-wait-2";
import { createFaceObservationMaturationLedger } from "./face-observation-maturation.js?v=20260716-face-source-slot-maturation-1";
import {
  createAtomicVideoTrackerGenerationOwner,
  createInputGenerationPlaybackGate,
} from "./tracking-input-generation.js?v=20260717-prewarmed-pose-pool-1";
import {
  DEFAULT_BODY_DETECTION_RATE_HZ,
  DEFAULT_HAND_DETECTION_INTERVAL_MS,
  HAND_OBSERVATION_SIDES,
  decideSourcePtsAdmission,
  decideSourcePtsSlotAdmission,
  mergeHandObservationCache,
  resolveHandObservationCache,
  shouldRunCadencedDetection,
} from "./tracking-cadence.js?v=20260716-face-slots-1";
import {
  DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS,
  transportPoseGuidedHandLandmarks,
} from "./pose-guided-hand-fallback.js?v=20260715-pose-hand-fallback-1";
import { computeBoundedFrameSize } from "./bounded-frame-snapshot.js?v=20260716-face512-1";
import { adaptCanonicalSkeletonFrame } from "./canonical-skeleton-adapter.js?v=20260714-joint-center-4b";
import {
  createPresenceState,
  updatePresenceState,
} from "./presence-state.js?v=20260703-csi-presence-1";
import { isWorkerRuntimeEnabled } from "./tracking-runtime-options.js?v=20260714-worker-default-1";
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
} from "./depth-calibration.js?v=20260715-raw-distal-depth-sign-1";

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
// Cold model fetch plus WASM/GPU graph creation can exceed 30 seconds on a
// healthy connection. Error events still fail fast; this is only the final
// guard against a worker that never completes its initialization handshake.
const TRACKING_WORKER_INIT_TIMEOUT_MS = 90000;
const TRACKING_WORKER_TIMEOUT_MS = 10000;
const TRACKING_WORKER_CLOSE_TIMEOUT_MS = 1000;
const FACE_WORKER_INIT_TIMEOUT_MS = 90000;
const FACE_WORKER_TIMEOUT_MS = 10000;
const FACE_WORKER_CLOSE_TIMEOUT_MS = 250;
const HAND_WORKER_INIT_TIMEOUT_MS = 120000;
const HAND_WORKER_TIMEOUT_MS = 10000;
const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
const MEDIAPIPE_BODY_RUNNING_MODE = "VIDEO";
const MEDIAPIPE_BODY_RESET_RUNNING_MODE = "IMAGE";
const MEDIAPIPE_FACE_RUNNING_MODE = "IMAGE";
const MEDIAPIPE_FACE_PREFERRED_DELEGATE = "CPU";
const MEDIAPIPE_HAND_PREFERRED_DELEGATE = "CPU";
const MAX_CONSECUTIVE_TRACKING_WORKER_DETECT_ERRORS = 3;
const FACE_DETECTION_RATE_HZ = 10;
const FACE_OBSERVATION_DELAY_MS = 1000 / 30;
const FACE_OBSERVATION_MAX_AGE_MS = 150;
const FACE_SOURCE_PTS_EPSILON_SEC = 0.000001;
const MAX_STALE_VIDEO_FRAME_CALLBACK_MS = 66;
const MAX_CONSECUTIVE_STALE_VIDEO_FRAME_SKIPS = 2;
const MAX_PENDING_FRAME_AGE_MS = 80;
// The held-out SLA measures capture/receive -> actual avatar state. Keep a
// small, clip-independent budget for the synchronous retarget/apply step; the
// accepted r9 product artifact observed a 3.5 ms maximum apply duration.
const BODY_AVATAR_APPLY_RESERVE_MS = 4;
const BODY_PENDING_HYSTERESIS_MS = 20;
const BODY_DETECTION_RATE_HZ = DEFAULT_BODY_DETECTION_RATE_HZ;
const HAND_DETECTION_INTERVAL_MS = DEFAULT_HAND_DETECTION_INTERVAL_MS;
const HAND_CACHE_MAX_AGE_MS = 500;
const HAND_POSE_GUIDED_FALLBACK_MAX_AGE_MS =
  DEFAULT_POSE_GUIDED_HAND_FALLBACK_MAX_AGE_MS;
const MAX_INFERENCE_FRAME_DIMENSION = 640;
const FACE_MAX_INFERENCE_FRAME_DIMENSION = 512;
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
const DEFAULT_POSE_MODEL_KEY = "pose_full";

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
  anatomyConstraintsEnabled: !isFalsyQueryFlag("anatomy-constraints"),
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
    outputFrames: 0,
    snapshotFrames: 0,
    snapshotErrors: 0,
    preInferenceStaleDrops: 0,
    postInferenceStaleDrops: 0,
    lastPostInferenceStaleDrop: null,
    workerFallbackFrameDrops: 0,
    timelineResets: 0,
    lastTimelineResetReason: "",
    consecutiveStaleFrameCallbacks: 0,
    lastOfferedSourcePtsSec: null,
    lastAdmittedSourcePtsSec: null,
    lastBodyCadenceAdmissionReason: "",
    bodyCadenceSkips: 0,
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
    preparedGeneration: null,
    preparedGenerationMeta: null,
    poseModelKey: "",
    configurationKey: "",
    faceTrackingEnabled: false,
    faceLandmarksEnabled: false,
    frames: 0,
    handDetectionFrames: 0,
    handCadenceSkips: 0,
    handDetectionAgeMs: null,
    handCadenceIntervalMs: null,
    detectErrors: 0,
    consecutiveDetectErrors: 0,
    errors: 0,
    fallbacks: 0,
    fallbackReason: "",
    detectorDelegates: null,
  },
  faceWorker: {
    supported: supportsTrackingWorker(),
    active: false,
    status: getInitialFaceTrackingEnabled() ? "requested" : "disabled",
    worker: null,
    lifecycleEpoch: 0,
    initPromise: null,
    requestId: 0,
    pendingRequests: new Map(),
    configurationKey: "",
    preparedGeneration: null,
    requests: 0,
    frames: 0,
    detectErrors: 0,
    errors: 0,
    timeouts: 0,
    lastError: "",
    detectorDelegates: null,
  },
  facePipeline: {
    lastAdmittedSlotIndex: null,
    snapshots: 0,
    snapshotErrors: 0,
    cadenceSkips: 0,
    unavailableSkips: 0,
    preInferenceStaleDrops: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheExpired: 0,
    cacheFuture: 0,
    lastObservationSourcePtsSec: null,
    lastObservationAgeMs: null,
  },
  bodyTracker: {
    generation: null,
    resetCount: 0,
    resetDetectors: [],
    resetDurationMs: 0,
    seededDetectors: [],
    cumulativeResets: 0,
    resetErrors: 0,
    lastGeneration: null,
    resetStrategy: "",
    detectorEpoch: 0,
    recreateCount: 0,
    recreateDetectors: [],
    recreateDurationMs: 0,
    recreateErrors: 0,
    closeErrors: 0,
    poolSize: 0,
    poolCleanCount: 0,
    poolPrewarmedCount: 0,
    poolPrimeDurationMs: 0,
    poolPrimeSlot0DurationMs: 0,
    poolPrimeSlot1DurationMs: 0,
    prewarmedSwapCount: 0,
    dirtyLeaseCount: 0,
    fallbackResetCount: 0,
    poolStrategy: "",
    fallbackResetStrategy: "",
  },
  handWorker: {
    requested: getInitialHandWorkerEnabled(),
    supported: supportsTrackingWorker(),
    active: false,
    status: getInitialHandWorkerEnabled() ? "requested" : "disabled",
    sides: Object.fromEntries(
      HAND_OBSERVATION_SIDES.map((side) => [side, createHandWorkerSideRuntime(side)]),
    ),
    requests: 0,
    frames: 0,
    roiUnavailable: 0,
    roiRecommits: 0,
    heldPoseRoiSides: 0,
    trackerResets: 0,
    staleSourcePtsSkips: 0,
    lastRoiEpisodeReasons: "",
    lastTrackerResetSides: "",
    lastRoiTransformVersionBySide: { Left: 0, Right: 0 },
    lastRoiExpansionLevelBySide: { Left: 0, Right: 0 },
    lastRoiMissStreakBySide: { Left: 0, Right: 0 },
    detectErrors: 0,
    errors: 0,
    timeouts: 0,
    lastError: "",
    detectorDelegates: null,
  },
  handPipeline: {
    lastSnapshotAt: null,
    lastSnapshotSourcePtsSec: null,
    snapshots: 0,
    cadenceSkips: 0,
    unavailableSkips: 0,
    snapshotErrors: 0,
    preInferenceStaleDrops: 0,
    cache: null,
    cacheHits: 0,
    cacheMisses: 0,
    cacheExpired: 0,
    cacheFuture: 0,
    nullResults: 0,
    heldNullResults: 0,
    singleSideResults: 0,
    detectionHitsBySide: { Left: 0, Right: 0 },
    detectionMissesBySide: { Left: 0, Right: 0 },
    outputHitsBySide: { Left: 0, Right: 0 },
    outputHeldHitsBySide: { Left: 0, Right: 0 },
    outputPredictedHitsBySide: { Left: 0, Right: 0 },
    outputDetectorMissesBySide: { Left: 0, Right: 0 },
    outputMissesBySide: { Left: 0, Right: 0 },
    lastObservedBySide: { Left: null, Right: null },
    lastPredictionAgeMsBySide: { Left: null, Right: null },
    lastAttemptSourcePtsSec: { Left: null, Right: null },
    lastCacheAgeMs: null,
    bodyFramesConsidered: 0,
    cloneAttempts: 0,
    cloneFailures: 0,
    fanOutDispatchesBySide: { Left: 0, Right: 0 },
    fanOutSkipsBySide: { Left: 0, Right: 0 },
    aggregateRequestKeys: new Set(),
    aggregateFrameKeys: new Set(),
    aggregateOutcomesByFrame: new Map(),
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
    handDetectMs: [],
    handRoundTripMs: [],
    handTrackerResetMs: [],
    bodyTrackerResetMs: [],
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
  avatarReady: false,
  avatarInitPromise: null,
  avatarLoadToken: 0,
  bodyValidation: {
    enabled: getInitialValidationEnabled(),
    samples: [],
    lastSample: null,
    framesWithPose: 0,
  },
  motionRecording: {
    active: false,
    recordingId: 0,
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

let latestFramePump = null;
let faceFramePump = null;
let handFrameFanOutPump = null;
const handSideFramePumps = { Left: null, Right: null };
const auxiliaryInferenceArbiter = createAuxiliaryInferenceArbiter();
const faceObservationMaturationLedger =
  createFaceObservationMaturationLedger({
    deadlineMs: MAX_PENDING_FRAME_AGE_MS,
    sourcePtsEpsilonSec: FACE_SOURCE_PTS_EPSILON_SEC,
  });
const mainThreadBodyTrackerGenerationOwner =
  createAtomicVideoTrackerGenerationOwner();
const bodyTrackerPlaybackGate = createInputGenerationPlaybackGate();
const videoPlaybackBackpressure =
  createVideoPlaybackBackpressureController({
    maxHoldMs: MAX_PENDING_FRAME_AGE_MS,
    pendingHysteresisMs: BODY_PENDING_HYSTERESIS_MS,
    getRuntimeContext: () => ({
      active: state.active,
      inputKind: state.inputKind,
      pumpMode: state.detectionPump.activeMode,
      generation: latestFramePump?.getGeneration() ?? 0,
      media: state.elements.video ?? null,
      boundaryActive: Boolean(
        bodyTrackerPlaybackGate.getStatus().bodyTrackerPlaybackGateActive,
      ),
    }),
    cancelScheduledFrame: cancelVideoFrameRequest,
    scheduleFrame: scheduleDetectionFrame,
    onError: handleVideoPlaybackBackpressureError,
  });
let mainThreadModelLoadPromise = null;
let detectionSnapshotCanvas = null;
let detectionSnapshotContext = null;
let faceDetectionSnapshotCanvas = null;
let faceDetectionSnapshotContext = null;
const bodyGenerationPreparations = new Map();

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
  state.elements.video?.addEventListener("seeked", handleVideoBoundarySeeked);
  state.elements.video?.addEventListener("seeking", handleVideoBoundarySeeking);
  state.elements.video?.addEventListener("play", handleVideoPlayWhileGenerationGated);
  state.elements.avatarFileInput?.addEventListener("change", () => {
    const file = state.elements.avatarFileInput.files?.[0];

    if (file) {
      useAvatarModelFile(file);
    }
  });
  state.elements.avatarDefaultButton?.addEventListener("click", () => {
    useDefaultAvatarModel();
  });
  state.elements.mirrorToggle?.addEventListener("change", async () => {
    applyMirrorPreference();
    const transition = state.active
      ? beginDetectionConfigurationGeneration("mirror-change")
      : null;
    // Mirroring changes the renderer hybrid coordinate system's facing
    // convention. Do not carry an unwrapped yaw from the opposite convention.
    resetAvatarPose({
      preserveCalibration: true,
    });
    if (state.active) {
      clearCanvas();
      try {
        await completeDetectionConfigurationGeneration(transition);
      } catch (error) {
        failVideoGenerationBoundary(
          transition?.inputGeneration,
          error,
          "mirror-change",
        );
      }
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
    const selectedPoseModelKey = getSelectedPoseModelKey();
    if (
      (state.poseLandmarker && state.poseModelKey !== selectedPoseModelKey) ||
      (state.trackingWorker.active && state.trackingWorker.poseModelKey !== selectedPoseModelKey)
    ) {
      setText("modelStatus", "Model selected");
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCamera({ preserveError: true });
    disposeTrackingWorker();
    disposeFaceWorker();
    disposeHandWorker();
    disposeAvatarRenderer();
    releaseAvatarFileUrl();
  });
  window.addEventListener("pagehide", () => {
    stopCamera({ preserveError: true });
    disposeTrackingWorker();
    disposeFaceWorker();
    disposeHandWorker();
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
  state.avatarReady = false;
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
      anatomyConstraintsEnabled: state.anatomyConstraintsEnabled,
    });
    syncAvatarDebugOptions();
    void applyInitialDepthCalibrationProfile();
    state.avatarInitPromise = state.avatarRenderer
      .init()
      .then(() => {
        if (loadToken === state.avatarLoadToken) {
          state.avatarReady = Boolean(
            state.avatarRenderer?.getModelDiagnostics?.()?.ready,
          );
        }
      })
      .catch((error) => {
        if (loadToken !== state.avatarLoadToken) {
          return;
        }

        state.avatarReady = false;
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
    state.avatarReady = false;
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
    setMirrorPreference(false);
    applyMirrorPreference();
    configureDetectionRuntime();

    await ensureModelsLoaded();
    if (state.avatarInitPromise) {
      await state.avatarInitPromise;
    }

    if (!isCurrentStart(token)) {
      return;
    }

    advanceDetectionGeneration("camera-start");
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
    video.preload = "auto";
    video.controls = true;
    video.loop = true;
    video.currentTime = 0;
    video.load();

    await waitForVideoFrame(video, "Video");

    if (!isCurrentStart(token)) {
      return;
    }

    resizeCanvasToVideoFrame();
    setMirrorPreference(false);
    applyMirrorPreference();
    configureDetectionRuntime();

    await ensureModelsLoaded();
    if (state.avatarInitPromise) {
      await state.avatarInitPromise;
    }

    if (!isCurrentStart(token)) {
      return;
    }

    advanceDetectionGeneration("video-start");
    state.active = true;
    state.lastVideoTime = -1;
    state.lastFrameTimestamp = 0;
    state.smoothedFps = 0;
    resetAppPerformance();
    resetBodyValidation();
    resetPresenceTracking();
    state.avatarRenderer?.resetDepthCalibration?.();
    setText("cameraStatus", `Starting video: ${file.name}`);
    setText("modelStatus", "Ready");
    updateControls();

    // The decoded boundary is frozen before any play call. The gate carries
    // explicit resume intent and starts playback only after this generation's
    // frame has reached the actual avatar state.
    await nominateVideoGenerationBoundary("video-start", {
      resumeAfterApply: true,
    });
    scheduleDetectionFrame();
    state.starting = false;
    setText("cameraStatus", `Priming video: ${file.name}`);
    updateControls();
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
  advanceDetectionGeneration("input-stop");
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
  state.detectionPump.pendingLatestFrame = null;

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

  if (!state.poseLandmarker && !state.trackingWorker.active) {
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

function resetVideoTimelineState(reason = "timeline-reset", options = {}) {
  if (state.inputKind !== "video" || !state.active) {
    return false;
  }

  state.detectionPump.timelineResets += 1;
  state.detectionPump.lastTimelineResetReason = reason;
  const generationTransition = advanceDetectionGeneration(reason, {
    preservePlaybackGate: Boolean(options.preservePlaybackGate),
  });
  state.lastVideoTime = -1;
  state.lastFrameTimestamp = 0;
  state.smoothedFps = 0;
  state.appPerformance.lastProcessedTimestamp = 0;
  resetPresenceTracking();
  resetAvatarPose({
    preserveCalibration: true,
  });
  return {
    reset: true,
    ...generationTransition,
  };
}

async function handleVideoBoundarySeeking() {
  if (state.inputKind !== "video" || !state.active) {
    return;
  }

  const inputGeneration = getLatestFramePump().getGeneration();
  const boundaryStatus = bodyTrackerPlaybackGate.getStatus();
  if (
    boundaryStatus.bodyTrackerBoundaryActive &&
    !boundaryStatus.bodyTrackerBoundaryNominated &&
    boundaryStatus.bodyTrackerBoundaryGeneration === inputGeneration &&
    boundaryStatus.bodyTrackerBoundaryReason === "seek"
  ) {
    return;
  }

  // Preserve the old gate until the new generation is reserved. begin() then
  // transfers resume intent without an intermediate play request.
  const timelineTransition = resetVideoTimelineState("seeking", {
    preservePlaybackGate: true,
  });
  const boundaryInputGeneration = getLatestFramePump().getGeneration();
  bodyTrackerPlaybackGate.reserveBoundary({
    inputGeneration: boundaryInputGeneration,
    media: state.elements.video,
    boundaryReason: "seek",
    resumeAfterApply: Boolean(
      timelineTransition?.videoPlaybackWasPlaying,
    ),
  });
  try {
    await prepareBodyTrackerGeneration(boundaryInputGeneration);
  } catch (error) {
    if (
      !isBodyInputGenerationTransitionError(error) ||
      getLatestFramePump().getGeneration() === boundaryInputGeneration
    ) {
      failVideoGenerationBoundary(boundaryInputGeneration, error, "seek-prepare");
    }
  }
}

function handleVideoPlayWhileGenerationGated(event) {
  if (state.inputKind !== "video" || !state.active) {
    return;
  }
  const inputGeneration = latestFramePump?.getGeneration() ?? 0;
  if (
    videoPlaybackBackpressure.blockPlayAttempt(
      event.currentTarget,
      inputGeneration,
    )
  ) {
    return;
  }
  if (!bodyTrackerPlaybackGate.getStatus().bodyTrackerPlaybackGateActive) {
    return;
  }

  // Native controls, automation, and application callers all share the media
  // element. Prevent any play() call from bypassing a frozen generation; the
  // gate's applied release clears itself before issuing the permitted play().
  const status = bodyTrackerPlaybackGate.getStatus();
  if (Number.isSafeInteger(status.bodyTrackerPlaybackGateGeneration)) {
    bodyTrackerPlaybackGate.requestResume(
      status.bodyTrackerPlaybackGateGeneration,
    );
  }
  event.currentTarget?.pause?.();
}

function handleVideoPlaybackBackpressureError(error, phase) {
  state.detectionPump.errors += 1;
  console.error(
    `File-video Body backpressure control failed during ${String(phase || "unknown")}.`,
    error,
  );
  if (!state.active || state.inputKind !== "video") {
    return;
  }

  const inputGeneration = latestFramePump?.getGeneration() ?? null;
  queueMicrotask(() => {
    if (
      !state.active ||
      state.inputKind !== "video" ||
      latestFramePump?.getGeneration() !== inputGeneration
    ) {
      return;
    }
    setError(
      `Video playback control failed: ${getErrorDetail(error)}`,
      "TRACKING_FAILED",
    );
    setText("cameraStatus", "Failed");
    stopCamera({ preserveError: true, cameraStatus: "Failed" });
  });
}

async function handleVideoBoundarySeeked() {
  if (state.inputKind !== "video" || !state.active) {
    return;
  }

  const inputGeneration = getLatestFramePump().getGeneration();
  const boundaryStatus = bodyTrackerPlaybackGate.getStatus();
  if (
    !boundaryStatus.bodyTrackerBoundaryActive ||
    boundaryStatus.bodyTrackerBoundaryGeneration !== inputGeneration ||
    boundaryStatus.bodyTrackerBoundaryReason !== "seek"
  ) {
    const timelineTransition = resetVideoTimelineState("seeked", {
      preservePlaybackGate: true,
    });
    bodyTrackerPlaybackGate.reserveBoundary({
      inputGeneration: getLatestFramePump().getGeneration(),
      media: state.elements.video,
      boundaryReason: "seek",
      resumeAfterApply: Boolean(
        timelineTransition?.videoPlaybackWasPlaying,
      ),
    });
  }

  try {
    await nominateVideoGenerationBoundary("seek");
    scheduleDetectionFrame();
  } catch (error) {
    setError(`Tracking failed: ${getErrorDetail(error)}`, "TRACKING_FAILED");
    setText("cameraStatus", "Failed");
    stopCamera({ preserveError: true, cameraStatus: "Failed" });
  }
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
    state.avatarReady = false;
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
    isTrackingWorkerReadyFor(selectedPoseModelKey) ||
    isMainThreadTrackingReadyFor(selectedPoseModelKey)
  ) {
    await Promise.all([
      ensureHandWorkerReady(),
      isTrackingWorkerReadyFor(selectedPoseModelKey)
        ? ensureFaceWorkerReady()
        : Promise.resolve(false),
    ]);
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
    const workerReady = await ensureTrackingWorkerReady(selectedPoseModelKey);
    if (!workerReady) {
      await ensureMainThreadModelsReady(selectedPoseModelKey);
    }
    // A body-ready/hand-loading state drops every hand sample in short clips.
    // Treat the independent hand worker as part of model readiness while
    // keeping its inference cadence and failure path isolated from body frames.
    await Promise.all([
      ensureHandWorkerReady(),
      workerReady ? ensureFaceWorkerReady() : Promise.resolve(false),
    ]);

    setText("modelStatus", "Ready");
  } catch (error) {
    setText("modelStatus", "Failed");
    const wrapped = new Error(`Model load failed: ${getErrorDetail(error)}`);
    wrapped.code = "MODEL_LOAD_FAILED";
    throw wrapped;
  }
}

function isMainThreadTrackingReadyFor(selectedPoseModelKey) {
  return Boolean(
    state.poseLandmarker &&
      state.poseModelKey === selectedPoseModelKey &&
      (
        !state.faceTracking.enabled ||
        state.faceLandmarker ||
        state.faceTracking.status === "failed"
      ),
  );
}

async function ensureMainThreadModelsReady(selectedPoseModelKey) {
  if (isMainThreadTrackingReadyFor(selectedPoseModelKey)) {
    return true;
  }

  if (mainThreadModelLoadPromise) {
    await mainThreadModelLoadPromise;
    return isMainThreadTrackingReadyFor(selectedPoseModelKey);
  }

  mainThreadModelLoadPromise = loadMainThreadModels(selectedPoseModelKey);
  try {
    return await mainThreadModelLoadPromise;
  } finally {
    mainThreadModelLoadPromise = null;
  }
}

async function loadMainThreadModels(selectedPoseModelKey) {
  if (!state.vision) {
    state.vision = await FilesetResolver.forVisionTasks(WASM_ASSET_PATH);
  }

  const initialEntries = await createMainThreadDetectorSet(
    selectedPoseModelKey,
    { allowFaceFailure: true },
  );
  const configurationKey = getMainThreadTrackerConfigurationKey(
    selectedPoseModelKey,
  );
  mainThreadBodyTrackerGenerationOwner.installInitial({
    detectors: initialEntries,
    configurationKey,
  });
  applyMainThreadPreparedDetectorSet(
    Object.fromEntries(initialEntries.map(({ id, detector }) => [id, detector])),
    selectedPoseModelKey,
  );

  return isMainThreadTrackingReadyFor(selectedPoseModelKey);
}

function shouldLoadMainThreadFaceTracker() {
  return Boolean(
    state.faceTracking.enabled && state.faceTracking.status !== "failed",
  );
}

function getMainThreadTrackerConfigurationKey(selectedPoseModelKey) {
  return JSON.stringify([
    selectedPoseModelKey,
    shouldLoadMainThreadFaceTracker(),
    state.detectorDelegates.requested,
    MEDIAPIPE_BODY_RUNNING_MODE,
    shouldLoadMainThreadFaceTracker() ? MEDIAPIPE_FACE_RUNNING_MODE : "",
  ]);
}

function createMainThreadDetectorFactories(selectedPoseModelKey) {
  const factories = [{
    id: "pose",
    create: () => createLandmarkerWithDelegate(
      "pose",
      PoseLandmarker,
      state.vision,
      {
        baseOptions: { modelAssetPath: POSE_MODEL_URLS[selectedPoseModelKey] },
        runningMode: MEDIAPIPE_BODY_RUNNING_MODE,
        numPoses: 1,
      },
    ),
  }];
  if (shouldLoadMainThreadFaceTracker()) {
    factories.push({
      id: "face",
      create: () => createLandmarkerWithDelegate(
        "face",
        FaceLandmarker,
        state.vision,
        {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: MEDIAPIPE_FACE_RUNNING_MODE,
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        },
      ),
    });
  }
  return factories;
}

function createMainThreadPoseStateResets() {
  return [{
    id: "pose",
    reset: async (poseLandmarker) => {
      if (typeof poseLandmarker?.setOptions !== "function") {
        throw new Error("Pose VIDEO detector does not support setOptions state reset.");
      }
      await poseLandmarker.setOptions({
        runningMode: MEDIAPIPE_BODY_RESET_RUNNING_MODE,
      });
      await poseLandmarker.setOptions({
        runningMode: MEDIAPIPE_BODY_RUNNING_MODE,
      });
    },
  }];
}

async function createMainThreadDetectorSet(
  selectedPoseModelKey,
  { allowFaceFailure = false } = {},
) {
  if (state.faceTracking.enabled) {
    state.faceTracking.status = "loading";
  }
  const factories = createMainThreadDetectorFactories(selectedPoseModelKey);
  const results = await Promise.allSettled(
    factories.map(({ create }) => Promise.resolve().then(create)),
  );
  const entries = [];
  const failures = [];
  results.forEach((result, index) => {
    const { id } = factories[index];
    if (result.status === "fulfilled" && result.value) {
      entries.push({ id, detector: result.value });
    } else {
      failures.push({
        id,
        cause: result.status === "rejected"
          ? result.reason
          : new Error("factory returned an invalid detector"),
      });
    }
  });

  const poseFailure = failures.find(({ id }) => id === "pose");
  const faceFailure = failures.find(({ id }) => id === "face");
  if (poseFailure || (faceFailure && !allowFaceFailure)) {
    entries.forEach(({ detector }) => closeLandmarker(detector));
    throw poseFailure?.cause ?? faceFailure.cause;
  }
  if (faceFailure) {
    state.faceTracking.status = "failed";
    state.faceTracking.lastError = getErrorDetail(faceFailure.cause);
    console.warn("Face tracking model load failed.", faceFailure.cause);
  } else if (state.faceTracking.enabled) {
    state.faceTracking.status = "ready";
    state.faceTracking.lastError = "";
  } else {
    state.faceTracking.status = "disabled";
  }
  return entries;
}

function applyMainThreadPreparedDetectorSet(detectorSet, selectedPoseModelKey) {
  state.poseLandmarker = detectorSet.pose ?? null;
  state.faceLandmarker = detectorSet.face ?? null;
  state.poseModelKey = state.poseLandmarker ? selectedPoseModelKey : null;
  if (state.faceTracking.enabled && state.faceLandmarker) {
    state.faceTracking.status = "ready";
  } else if (!state.faceTracking.enabled) {
    state.faceTracking.status = "disabled";
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
    return false;
  }

  return (
    state.trackingWorker.active &&
    state.trackingWorker.poseModelKey === selectedPoseModelKey
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
      delegate: state.detectorDelegates.requested,
    });
    state.trackingWorker.active = true;
    state.trackingWorker.status = "ready";
    state.trackingWorker.poseModelKey = selectedPoseModelKey;
    state.trackingWorker.configurationKey = response.configurationKey ?? "";
    state.trackingWorker.preparedGeneration = null;
    state.trackingWorker.preparedGenerationMeta = null;
    state.trackingWorker.faceTrackingEnabled = false;
    state.trackingWorker.faceLandmarksEnabled = false;
    state.trackingWorker.detectorDelegates = response.detectorDelegates ?? null;
    mergeTrackingWorkerDelegateTelemetry(response.detectorDelegates);
    recordBodyTrackerGenerationMeta(response.bodyTrackerGenerationMeta);
    state.trackingWorker.fallbackReason = "";
    return worker;
  } catch (error) {
    markTrackingWorkerFallback(error);
    return null;
  }
}

function mergeTrackingWorkerDelegateTelemetry(workerDelegates = {}) {
  for (const detectorKey of ["pose"]) {
    if (workerDelegates?.[detectorKey]) {
      state.detectorDelegates[detectorKey] = workerDelegates[detectorKey];
    }

    const attempted = workerDelegates?.attempted?.[detectorKey];
    if (Array.isArray(attempted)) {
      state.detectorDelegates.attempted[detectorKey] = attempted.slice();
    }

    const fallbackReason = workerDelegates?.fallbackReasons?.[detectorKey];
    if (fallbackReason) {
      state.detectorDelegates.fallbackReasons[detectorKey] = fallbackReason;
      state.detectorDelegates.lastFallbackReason = `${detectorKey}: ${fallbackReason}`;
    } else {
      delete state.detectorDelegates.fallbackReasons[detectorKey];
    }
  }
}

function getOrCreateTrackingWorker() {
  if (state.trackingWorker.worker) {
    return state.trackingWorker.worker;
  }

  const worker = new Worker(
    new URL("./motion-worker.js?v=20260717-prewarmed-pose-pool-1", import.meta.url),
    { type: "module" },
  );
  worker.addEventListener("message", handleTrackingWorkerMessage);
  worker.addEventListener("error", handleTrackingWorkerError);
  worker.addEventListener("messageerror", handleTrackingWorkerMessageError);
  state.trackingWorker.worker = worker;
  return worker;
}

function handleTrackingWorkerError(event) {
  if (event.currentTarget !== state.trackingWorker.worker) {
    return;
  }
  markTrackingWorkerFallback(event.error ?? event.message ?? "Tracking worker failed.");
}

function handleTrackingWorkerMessageError(event) {
  if (event.currentTarget !== state.trackingWorker.worker) {
    return;
  }
  markTrackingWorkerFallback("Tracking worker message transfer failed.");
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
    recordBodyTrackerGenerationMeta(message.bodyTrackerGenerationMeta);
    const error = new Error(message.message || "Tracking worker request failed.");
    error.code = String(message.code ?? "");
    error.bodyTrackerGenerationMeta = message.bodyTrackerGenerationMeta ?? null;
    request.reject(error);
    return;
  }

  request.resolve(message);
}

function postTrackingWorkerRequest(type, payload = {}, transfer = []) {
  const worker = getOrCreateTrackingWorker();
  const requestId = ++state.trackingWorker.requestId;
  const timeoutMs = type === "init"
    ? TRACKING_WORKER_INIT_TIMEOUT_MS
    : TRACKING_WORKER_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      state.trackingWorker.pendingRequests.delete(requestId);
      reject(createTrackingWorkerRequestError(
        `Tracking worker ${type} request timed out.`,
        true,
      ));
    }, timeoutMs);

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
      reject(createTrackingWorkerRequestError(getErrorDetail(error), true));
    }
  });
}

function createTrackingWorkerRequestError(message, fatal = false) {
  const error = new Error(message);
  error.trackingWorkerFatal = Boolean(fatal);
  return error;
}

function markTrackingWorkerFallback(error, options = {}) {
  if (!state.trackingWorker.worker && state.trackingWorker.status === "fallback") {
    return false;
  }

  const reason = getErrorDetail(error);
  state.trackingWorker.active = false;
  state.trackingWorker.status = "fallback";
  if (options.countError !== false) {
    state.trackingWorker.errors += 1;
  }
  state.trackingWorker.fallbacks += 1;
  state.trackingWorker.fallbackReason = reason;
  rejectTrackingWorkerPending(error);
  disposeTrackingWorker({ keepStatus: true });
  console.warn("Tracking worker disabled; using main-thread detection.", error);
  return true;
}

function rejectTrackingWorkerPending(error) {
  for (const [requestId, request] of state.trackingWorker.pendingRequests) {
    clearTimeout(request.timeoutId);
    request.reject(error instanceof Error ? error : new Error(String(error)));
    state.trackingWorker.pendingRequests.delete(requestId);
  }
}

function disposeTrackingWorker(options = {}) {
  const worker = state.trackingWorker.worker;
  state.trackingWorker.worker = null;

  rejectTrackingWorkerPending(new Error("Tracking worker disposed."));
  closeDetachedTrackingWorker(worker, { immediate: options.immediate === true });
  state.trackingWorker.initPromise = null;
  state.trackingWorker.active = false;
  state.trackingWorker.poseModelKey = "";
  state.trackingWorker.configurationKey = "";
  state.trackingWorker.preparedGeneration = null;
  state.trackingWorker.preparedGenerationMeta = null;
  state.trackingWorker.faceTrackingEnabled = false;
  state.trackingWorker.faceLandmarksEnabled = false;
  state.trackingWorker.detectorDelegates = null;
  resetBodyTrackerPoolTelemetry();

  if (!options.keepStatus) {
    state.trackingWorker.status = state.trackingWorker.requested ? "requested" : "disabled";
    state.trackingWorker.fallbackReason = "";
  }
}

function closeDetachedTrackingWorker(worker, { immediate = false } = {}) {
  if (!worker) {
    return false;
  }

  worker.removeEventListener("message", handleTrackingWorkerMessage);
  worker.removeEventListener("error", handleTrackingWorkerError);
  worker.removeEventListener("messageerror", handleTrackingWorkerMessageError);
  if (immediate) {
    worker.terminate();
    return true;
  }

  const requestId = ++state.trackingWorker.requestId;
  let finished = false;
  let timeoutId = null;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    worker.removeEventListener("message", handleClosed);
    worker.terminate();
  };
  const handleClosed = (event) => {
    const message = event.data ?? {};
    if (message.type === "closed" && message.requestId === requestId) {
      finish();
    }
  };

  worker.addEventListener("message", handleClosed);
  timeoutId = setTimeout(finish, TRACKING_WORKER_CLOSE_TIMEOUT_MS);
  try {
    worker.postMessage({ type: "close", requestId });
  } catch {
    finish();
  }
  return true;
}

async function ensureFaceWorkerReady() {
  if (!state.faceTracking.enabled) {
    disposeFaceWorker();
    state.faceWorker.status = "disabled";
    return false;
  }

  state.faceWorker.supported = supportsTrackingWorker();
  if (!state.faceWorker.supported) {
    state.faceWorker.status = "unsupported";
    state.faceWorker.lastError = "Worker, createImageBitmap, or OffscreenCanvas is unavailable.";
    state.faceTracking.status = "failed";
    state.faceTracking.lastError = state.faceWorker.lastError;
    return false;
  }
  if (state.faceWorker.active && state.faceWorker.worker) {
    return true;
  }
  if (state.faceWorker.initPromise) {
    await state.faceWorker.initPromise;
    return state.faceWorker.active;
  }

  const lifecycleEpoch = state.faceWorker.lifecycleEpoch;
  state.faceWorker.status = "loading";
  state.faceTracking.status = "loading";
  state.faceWorker.initPromise = initFaceWorker(lifecycleEpoch);
  try {
    await state.faceWorker.initPromise;
  } finally {
    if (state.faceWorker.lifecycleEpoch === lifecycleEpoch) {
      state.faceWorker.initPromise = null;
    }
  }
  return state.faceWorker.active;
}

async function initFaceWorker(lifecycleEpoch) {
  try {
    const response = await postFaceWorkerRequest("init", {
      wasmAssetPath: WASM_ASSET_PATH,
      faceModelUrl: FACE_MODEL_URL,
      delegate: MEDIAPIPE_FACE_PREFERRED_DELEGATE,
    });
    if (
      lifecycleEpoch !== state.faceWorker.lifecycleEpoch ||
      !state.faceTracking.enabled
    ) {
      return false;
    }
    state.faceWorker.active = true;
    state.faceWorker.status = "ready";
    state.faceWorker.configurationKey = response.configurationKey ?? "";
    state.faceWorker.preparedGeneration = null;
    state.faceWorker.detectorDelegates = response.detectorDelegates ?? null;
    state.faceWorker.lastError = "";
    state.faceTracking.status = "ready";
    state.faceTracking.lastError = "";
    mergeFaceWorkerDelegateTelemetry(response.detectorDelegates);
    return true;
  } catch (error) {
    if (
      lifecycleEpoch === state.faceWorker.lifecycleEpoch &&
      state.faceTracking.enabled
    ) {
      markFaceWorkerFailure(error);
    }
    return false;
  }
}

function mergeFaceWorkerDelegateTelemetry(workerDelegates = {}) {
  if (workerDelegates?.face) {
    state.detectorDelegates.face = workerDelegates.face;
  }
  const attempted = workerDelegates?.attempted?.face;
  if (Array.isArray(attempted)) {
    state.detectorDelegates.attempted.face = attempted.slice();
  }
  const fallbackReason = workerDelegates?.fallbackReasons?.face;
  if (fallbackReason) {
    state.detectorDelegates.fallbackReasons.face = fallbackReason;
    state.detectorDelegates.lastFallbackReason = `face: ${fallbackReason}`;
  } else {
    delete state.detectorDelegates.fallbackReasons.face;
  }
}

function getOrCreateFaceWorker() {
  if (state.faceWorker.worker) {
    return state.faceWorker.worker;
  }

  const worker = new Worker(
    new URL("./face-worker.js?v=20260716-cpu-face-1", import.meta.url),
    { type: "module" },
  );
  const lifecycleEpoch = state.faceWorker.lifecycleEpoch;
  worker.addEventListener("message", handleFaceWorkerMessage);
  worker.addEventListener("error", (event) => {
    if (
      state.faceWorker.worker !== worker ||
      state.faceWorker.lifecycleEpoch !== lifecycleEpoch
    ) {
      return;
    }
    markFaceWorkerFailure(event.error ?? event.message ?? "Face worker failed.");
  });
  worker.addEventListener("messageerror", () => {
    if (
      state.faceWorker.worker !== worker ||
      state.faceWorker.lifecycleEpoch !== lifecycleEpoch
    ) {
      return;
    }
    markFaceWorkerFailure("Face worker message transfer failed.");
  });
  state.faceWorker.worker = worker;
  return worker;
}

function handleFaceWorkerMessage(event) {
  const message = event.data ?? {};
  const request = state.faceWorker.pendingRequests.get(message.requestId);
  if (!request) {
    return;
  }

  clearTimeout(request.timeoutId);
  state.faceWorker.pendingRequests.delete(message.requestId);
  if (message.type === "error") {
    const error = new Error(message.message || "Face worker request failed.");
    error.code = String(message.code ?? "");
    request.reject(error);
    return;
  }
  request.resolve(message);
}

function postFaceWorkerRequest(type, payload = {}, transfer = []) {
  const worker = getOrCreateFaceWorker();
  const requestId = ++state.faceWorker.requestId;
  const timeoutMs = type === "init"
    ? FACE_WORKER_INIT_TIMEOUT_MS
    : FACE_WORKER_TIMEOUT_MS;
  let resolveRequest;
  let rejectRequest;
  const request = new Promise((resolve, reject) => {
    resolveRequest = resolve;
    rejectRequest = reject;
  });
  const timeoutId = setTimeout(() => {
    state.faceWorker.pendingRequests.delete(requestId);
    state.faceWorker.timeouts += 1;
    const error = new Error(`Face worker ${type} request timed out.`);
    error.faceWorkerFatal = true;
    rejectRequest(error);
  }, timeoutMs);
  state.faceWorker.pendingRequests.set(requestId, {
    resolve: resolveRequest,
    reject: rejectRequest,
    timeoutId,
  });

  try {
    worker.postMessage({ type, requestId, ...payload }, transfer);
  } catch (error) {
    clearTimeout(timeoutId);
    state.faceWorker.pendingRequests.delete(requestId);
    error.faceWorkerFatal = true;
    // Throw before returning the Promise so callers retain ownership of any
    // ImageBitmap that the failed postMessage never transferred.
    throw error;
  }
  return request;
}

function markFaceWorkerFailure(error, options = {}) {
  const reason = getErrorDetail(error);
  if (options.countError !== false) {
    state.faceWorker.errors += 1;
  }
  state.faceWorker.active = false;
  state.faceWorker.status = "failed";
  state.faceWorker.lastError = reason;
  state.faceTracking.status = "failed";
  state.faceTracking.lastError = reason;
  disposeFaceWorker({ keepStatus: true });
  console.warn("Face worker disabled without affecting body tracking.", error);
}

function rejectFaceWorkerPending(error) {
  for (const [requestId, request] of state.faceWorker.pendingRequests) {
    clearTimeout(request.timeoutId);
    request.reject(error instanceof Error ? error : new Error(String(error)));
    state.faceWorker.pendingRequests.delete(requestId);
  }
}

function disposeFaceWorker(options = {}) {
  state.faceWorker.lifecycleEpoch += 1;
  const worker = state.faceWorker.worker;
  state.faceWorker.worker = null;
  const disposalError = new Error("Face worker disposed.");
  disposalError.code = "FACE_WORKER_DISPOSED";
  rejectFaceWorkerPending(disposalError);
  closeDetachedFaceWorker(worker, { immediate: options.immediate === true });
  state.faceWorker.initPromise = null;
  state.faceWorker.active = false;
  state.faceWorker.configurationKey = "";
  state.faceWorker.preparedGeneration = null;
  state.faceWorker.detectorDelegates = null;
  getFaceFramePump().clearPending("face-worker-disposed");
  clearFaceObservationState("face-worker-disposed");
  if (!options.keepStatus) {
    state.faceWorker.status = state.faceTracking.enabled ? "requested" : "disabled";
    state.faceWorker.lastError = "";
  }
}

function closeDetachedFaceWorker(worker, { immediate = false } = {}) {
  if (!worker) {
    return false;
  }
  if (immediate) {
    worker.terminate();
    return true;
  }

  const requestId = ++state.faceWorker.requestId;
  let finished = false;
  let timeoutId = null;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    worker.removeEventListener("message", handleClosed);
    worker.terminate();
  };
  const handleClosed = (event) => {
    const message = event.data ?? {};
    if (message.type === "closed" && message.requestId === requestId) {
      finish();
    }
  };

  worker.addEventListener("message", handleClosed);
  timeoutId = setTimeout(finish, FACE_WORKER_CLOSE_TIMEOUT_MS);
  try {
    worker.postMessage({ type: "close", requestId });
  } catch {
    finish();
  }
  return true;
}

function createHandWorkerSideRuntime(side) {
  return {
    handWorkerSide: side,
    active: false,
    status: getInitialHandWorkerEnabled() ? "requested" : "disabled",
    worker: null,
    initPromise: null,
    requestId: 0,
    pendingRequests: new Map(),
    requests: 0,
    frames: 0,
    roiUnavailable: 0,
    roiRecommits: 0,
    heldPoseRoiSides: 0,
    trackerResets: 0,
    staleSourcePtsSkips: 0,
    lastRoiEpisodeReasons: "",
    lastTrackerResetSides: "",
    lastRoiTransformVersion: 0,
    lastRoiExpansionLevel: 0,
    lastRoiMissStreak: 0,
    detectErrors: 0,
    errors: 0,
    timeouts: 0,
    lastError: "",
    detectorDelegates: null,
    roundTripMs: [],
    detectionMs: [],
    trackerResetMs: [],
    lastRoundTripMs: null,
    lastDetectionMs: null,
    preInferenceStaleDrops: 0,
  };
}

function getHandWorkerSideRuntime(side) {
  const runtime = state.handWorker.sides?.[side];
  if (!runtime) {
    throw new Error(`Unknown hand worker side: ${side}`);
  }
  return runtime;
}

async function ensureHandWorkerReady() {
  configureHandWorkerRuntime();

  if (!state.handWorker.requested || !state.handWorker.supported) {
    return false;
  }

  // Start both model initializations before awaiting either one. Each promise
  // owns only its side, so a failed initialization cannot dispose its sibling.
  const readiness = HAND_OBSERVATION_SIDES.map((side) =>
    ensureHandWorkerSideReady(side)
  );
  let anyReady = false;
  for (const sidePromise of readiness) {
    anyReady = (await sidePromise) || anyReady;
  }
  refreshHandWorkerAggregateState();
  return anyReady;
}

async function ensureHandWorkerSideReady(side) {
  const runtime = getHandWorkerSideRuntime(side);
  if (runtime.active && runtime.worker) {
    return true;
  }
  if (runtime.initPromise) {
    await runtime.initPromise;
    return runtime.active;
  }

  runtime.status = "loading";
  const initPromise = initHandWorkerSide(side);
  runtime.initPromise = initPromise;
  refreshHandWorkerAggregateState();
  try {
    await initPromise;
  } finally {
    if (runtime.initPromise === initPromise) {
      runtime.initPromise = null;
    }
  }
  refreshHandWorkerAggregateState();
  return runtime.active;
}

async function initHandWorkerSide(side) {
  const runtime = getHandWorkerSideRuntime(side);
  try {
    const response = await postHandWorkerRequest(side, "init", {
      workerSide: side,
      wasmAssetPath: WASM_ASSET_PATH,
      handModelUrl: HAND_MODEL_URL,
      delegate: MEDIAPIPE_HAND_PREFERRED_DELEGATE,
    });
    assertHandWorkerResponseSide(response, side);
    runtime.active = true;
    runtime.status = "ready";
    runtime.lastError = "";
    runtime.detectorDelegates = response.detectorDelegates ?? null;
    refreshHandWorkerAggregateState();
    return runtime.worker;
  } catch (error) {
    markHandWorkerSideFailure(side, error);
    return null;
  }
}

function getOrCreateHandWorker(side) {
  const runtime = getHandWorkerSideRuntime(side);
  if (runtime.worker) {
    return runtime.worker;
  }

  const worker = new Worker(
    new URL("./hand-worker.js?v=20260715-current-pose-image-roi-1", import.meta.url),
    { type: "module" },
  );
  worker.addEventListener("message", (event) => {
    handleHandWorkerMessage(side, event);
  });
  worker.addEventListener("error", (event) => {
    const error = createHandWorkerRequestError(
      event.error ?? event.message ?? `${side} hand worker failed.`,
      { side, fatal: true },
    );
    markHandWorkerSideFailure(side, error);
  });
  worker.addEventListener("messageerror", () => {
    markHandWorkerSideFailure(side, createHandWorkerRequestError(
      `${side} hand worker message transfer failed.`,
      { side, fatal: true },
    ));
  });
  runtime.worker = worker;
  return worker;
}

function handleHandWorkerMessage(side, event) {
  const runtime = getHandWorkerSideRuntime(side);
  const message = event.data ?? {};
  const request = runtime.pendingRequests.get(message.requestId);

  if (message.handWorkerSide !== side) {
    const error = createHandWorkerRequestError(
      `${side} hand worker returned mismatched provenance ${String(message.handWorkerSide)}.`,
      { side, fatal: true },
    );
    if (request) {
      clearTimeout(request.timeoutId);
      runtime.pendingRequests.delete(message.requestId);
    }
    markHandWorkerSideFailure(side, error, {
      countDetectError: request?.type === "detect",
    });
    request?.reject(error);
    return;
  }

  if (!request) {
    return;
  }

  clearTimeout(request.timeoutId);
  runtime.pendingRequests.delete(message.requestId);
  if (message.type === "error") {
    request.reject(createHandWorkerRequestError(
      message.message || `${side} hand worker request failed.`,
      { side, fatal: Boolean(message.fatal) },
    ));
    return;
  }
  request.resolve(message);
}

function postHandWorkerRequest(side, type, payload = {}, transfer = []) {
  const runtime = getHandWorkerSideRuntime(side);
  const worker = getOrCreateHandWorker(side);
  const requestId = ++runtime.requestId;
  const timeoutMs = type === "init"
    ? HAND_WORKER_INIT_TIMEOUT_MS
    : HAND_WORKER_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      runtime.pendingRequests.delete(requestId);
      runtime.timeouts += 1;
      refreshHandWorkerAggregateState();
      reject(createHandWorkerRequestError(
        `${side} hand worker ${type} request timed out.`,
        { side, fatal: true },
      ));
    }, timeoutMs);
    runtime.pendingRequests.set(requestId, { resolve, reject, timeoutId, type });

    try {
      worker.postMessage({ type, requestId, ...payload }, transfer);
    } catch (error) {
      clearTimeout(timeoutId);
      runtime.pendingRequests.delete(requestId);
      reject(createHandWorkerRequestError(getErrorDetail(error), {
        side,
        fatal: true,
      }));
    }
  });
}

function createHandWorkerRequestError(message, { side, fatal = false } = {}) {
  const error = message instanceof Error
    ? new Error(getErrorDetail(message))
    : new Error(String(message));
  error.handWorkerSide = side ?? null;
  error.handWorkerFatal = Boolean(fatal);
  return error;
}

function assertHandWorkerResponseSide(response, side, options = {}) {
  if (
    response?.handWorkerSide !== side ||
    (
      options.requireFrameSourceMeta &&
      response?.frame?.sourceMeta?.handWorkerSide !== side
    )
  ) {
    throw createHandWorkerRequestError(
      `${side} hand worker response is missing matching side provenance.`,
      { side, fatal: true },
    );
  }
  return response;
}

function markHandWorkerSideFailure(side, error, options = {}) {
  const runtime = getHandWorkerSideRuntime(side);
  if (!runtime.worker && runtime.status === "failed") {
    return false;
  }

  const failure = error instanceof Error
    ? error
    : createHandWorkerRequestError(error, { side, fatal: true });
  failure.handWorkerSide = side;
  failure.handWorkerFailureCounted = true;
  runtime.active = false;
  runtime.status = "failed";
  if (options.countError !== false) {
    runtime.errors += 1;
  }
  if (options.countDetectError) {
    runtime.detectErrors += 1;
  }
  runtime.lastError = getErrorDetail(failure);
  cancelPendingAggregateHandOutcomesForSide(side, "worker-failure");
  disposeHandWorkerSide(side, {
    keepStatus: true,
    pendingError: failure,
  });
  refreshHandWorkerAggregateState();
  console.warn(`${side} hand worker disabled without affecting body or opposite-hand tracking.`, failure);
  return true;
}

function rejectHandWorkerSidePending(side, error) {
  const runtime = getHandWorkerSideRuntime(side);
  for (const [requestId, request] of runtime.pendingRequests) {
    clearTimeout(request.timeoutId);
    request.reject(error instanceof Error ? error : new Error(String(error)));
    runtime.pendingRequests.delete(requestId);
  }
}

function disposeHandWorkerSide(side, options = {}) {
  const runtime = getHandWorkerSideRuntime(side);
  if (runtime.worker) {
    try {
      runtime.worker.postMessage({ type: "close", requestId: 0 });
    } catch {
      // The side worker may already be shutting down.
    }
    runtime.worker.terminate();
    runtime.worker = null;
  }

  rejectHandWorkerSidePending(
    side,
    options.pendingError ?? createHandWorkerRequestError(
      `${side} hand worker disposed.`,
      { side },
    ),
  );
  runtime.initPromise = null;
  runtime.active = false;
  runtime.detectorDelegates = null;
  if (!options.keepStatus) {
    runtime.status = state.handWorker.requested ? "requested" : "disabled";
    runtime.lastError = "";
  }
}

function disposeHandWorker(options = {}) {
  for (const side of HAND_OBSERVATION_SIDES) {
    disposeHandWorkerSide(side, options);
  }
  refreshHandWorkerAggregateState();
}

function refreshHandWorkerAggregateState() {
  const runtimes = HAND_OBSERVATION_SIDES.map(getHandWorkerSideRuntime);
  const activeRuntimes = runtimes.filter((runtime) => runtime.active && runtime.worker);
  state.handWorker.active = activeRuntimes.length > 0;

  if (!state.handWorker.requested) {
    state.handWorker.status = "disabled";
  } else if (!state.handWorker.supported) {
    state.handWorker.status = "unsupported";
  } else if (runtimes.some((runtime) => runtime.status === "loading")) {
    state.handWorker.status = "loading";
  } else if (activeRuntimes.length === HAND_OBSERVATION_SIDES.length &&
    runtimes.every((runtime) => runtime.status === "ready")) {
    state.handWorker.status = "ready";
  } else if (activeRuntimes.length > 0) {
    state.handWorker.status = "degraded";
  } else if (runtimes.every((runtime) => runtime.status === "failed")) {
    state.handWorker.status = "failed";
  } else {
    state.handWorker.status = "requested";
  }

  for (const key of [
    "roiUnavailable",
    "roiRecommits",
    "heldPoseRoiSides",
    "trackerResets",
    "staleSourcePtsSkips",
    "detectErrors",
    "errors",
    "timeouts",
  ]) {
    state.handWorker[key] = runtimes.reduce(
      (total, runtime) => total + (Number(runtime[key]) || 0),
      0,
    );
  }
  state.handWorker.lastError = runtimes
    .filter((runtime) => runtime.lastError)
    .map((runtime) => `${runtime.handWorkerSide}: ${runtime.lastError}`)
    .join(" | ");
  state.handWorker.lastRoiEpisodeReasons = runtimes
    .filter((runtime) => runtime.lastRoiEpisodeReasons)
    .map((runtime) => `${runtime.handWorkerSide}: ${runtime.lastRoiEpisodeReasons}`)
    .join(" | ");
  state.handWorker.lastTrackerResetSides = runtimes
    .flatMap((runtime) => String(runtime.lastTrackerResetSides || "").split(","))
    .filter(Boolean)
    .filter((side, index, values) => values.indexOf(side) === index)
    .join(",");
  state.handWorker.lastRoiTransformVersionBySide = Object.fromEntries(
    runtimes.map((runtime) => [
      runtime.handWorkerSide,
      runtime.lastRoiTransformVersion,
    ]),
  );
  state.handWorker.lastRoiExpansionLevelBySide = Object.fromEntries(
    runtimes.map((runtime) => [
      runtime.handWorkerSide,
      runtime.lastRoiExpansionLevel,
    ]),
  );
  state.handWorker.lastRoiMissStreakBySide = Object.fromEntries(
    runtimes.map((runtime) => [runtime.handWorkerSide, runtime.lastRoiMissStreak]),
  );

  const delegateEntries = runtimes
    .map((runtime) => [
      runtime.handWorkerSide,
      runtime.detectorDelegates?.hand ?? null,
    ])
    .filter(([, delegate]) => delegate);
  const delegateValues = [...new Set(delegateEntries.map(([, delegate]) => delegate))];
  const attemptedHandDelegates = [...new Set(runtimes.flatMap(
    (runtime) => runtime.detectorDelegates?.attempted?.hand ?? [],
  ))];
  const fallbackReasonBySide = Object.fromEntries(runtimes
    .map((runtime) => [
      runtime.handWorkerSide,
      runtime.detectorDelegates?.fallbackReasons?.hand ?? "",
    ])
    .filter(([, reason]) => reason));
  const aggregateDelegate = delegateValues.length === 1
    ? delegateValues[0]
    : delegateValues.length > 1
      ? "mixed"
      : runtimes.every((runtime) => runtime.status === "failed")
        ? "failed"
        : "unloaded";
  const aggregateFallbackReason = Object.entries(fallbackReasonBySide)
    .map(([side, reason]) => `${side}: ${reason}`)
    .join(" | ");
  state.handWorker.detectorDelegates = {
    requested: MEDIAPIPE_HAND_PREFERRED_DELEGATE,
    hand: aggregateDelegate,
    bySide: Object.fromEntries(delegateEntries),
    attempted: { hand: attemptedHandDelegates },
    fallbackReasons: {
      ...(aggregateFallbackReason ? { hand: aggregateFallbackReason } : {}),
      bySide: fallbackReasonBySide,
    },
    lastFallbackReason: aggregateFallbackReason,
  };
  state.detectorDelegates.hand = aggregateDelegate;
  state.detectorDelegates.attempted.hand = attemptedHandDelegates;
  if (state.handWorker.detectorDelegates.lastFallbackReason) {
    state.detectorDelegates.fallbackReasons.hand =
      state.handWorker.detectorDelegates.lastFallbackReason;
  } else {
    delete state.detectorDelegates.fallbackReasons.hand;
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

  scheduleAnimationFrameDetection();
}

function scheduleVideoFrameDetection() {
  const video = state.elements.video;

  if (!video?.requestVideoFrameCallback) {
    state.detectionPump.activeMode = DETECTION_PUMP_RAF;
    scheduleAnimationFrameDetection();
    return;
  }

  state.videoFrameRequestId = video.requestVideoFrameCallback((timestamp, metadata) => {
    state.videoFrameRequestId = 0;
    offerVideoFrameForDetection(timestamp, metadata);
  });
}

function scheduleAnimationFrameDetection() {
  if (state.animationFrameId) {
    return;
  }

  state.animationFrameId = requestAnimationFrame((timestamp) => {
    state.animationFrameId = 0;
    if (supportsDetectionFrameSnapshot()) {
      offerAnimationFrameForDetection(timestamp);
      return;
    }

    runDetectionFrame(timestamp, { pumpMode: DETECTION_PUMP_RAF });
  });
}

function offerAnimationFrameForDetection(timestamp) {
  offerFrameForDetection(timestamp, null, DETECTION_PUMP_RAF);
}

function offerVideoFrameForDetection(timestamp, metadata) {
  offerFrameForDetection(timestamp, metadata, DETECTION_PUMP_RVFC);
}

function shouldPromoteVideoRewindAtProducer(sourcePtsSec) {
  const sourcePts = optionalFiniteNumber(sourcePtsSec);
  const lastOfferedSourcePts = optionalFiniteNumber(
    state.detectionPump.lastOfferedSourcePtsSec,
  );
  return Boolean(
    state.inputKind === "video" &&
      state.active &&
      sourcePts !== null &&
      lastOfferedSourcePts !== null &&
      sourcePts + VIDEO_TIMELINE_REWIND_EPSILON_SEC < lastOfferedSourcePts
  );
}

async function nominateVideoGenerationBoundary(boundaryReason, options = {}) {
  if (state.inputKind !== "video" || !state.active) {
    return false;
  }
  if (!supportsDetectionFrameSnapshot()) {
    throw new Error(
      "Exact video generation boundaries require OffscreenCanvas ImageBitmap snapshots.",
    );
  }

  const video = state.elements.video;
  const inputGeneration = getLatestFramePump().getGeneration();
  const existingBoundary = bodyTrackerPlaybackGate.getStatus();
  if (
    existingBoundary.bodyTrackerBoundaryActive &&
    existingBoundary.bodyTrackerBoundaryNominated &&
    existingBoundary.bodyTrackerBoundaryGeneration === inputGeneration
  ) {
    return false;
  }

  bodyTrackerPlaybackGate.reserveBoundary({
    inputGeneration,
    media: video,
    boundaryReason,
    resumeAfterApply: Boolean(options.resumeAfterApply),
  });

  try {
    await prepareBodyTrackerGeneration(inputGeneration);
    assertCurrentBodyInputGeneration(inputGeneration);
  } catch (error) {
    releaseBodyTrackerPlaybackGate(inputGeneration, "boundary-prepare-error", {
      resume: false,
    });
    if (
      isBodyInputGenerationTransitionError(error) &&
      getLatestFramePump().getGeneration() !== inputGeneration
    ) {
      return false;
    }
    throw error;
  }
  if (
    !state.active ||
    state.inputKind !== "video" ||
    getLatestFramePump().getGeneration() !== inputGeneration
  ) {
    releaseBodyTrackerPlaybackGate(inputGeneration, "boundary-superseded", {
      resume: false,
    });
    return false;
  }

  const callbackReceivedAt = optionalFiniteNumber(options.callbackReceivedAt) ?? nowMs();
  const callbackTimestamp = optionalFiniteNumber(options.timestamp) ?? callbackReceivedAt;
  const pumpMode = options.pumpMode ?? resolveDetectionPumpMode();
  const sourceTiming = options.sourceTiming ?? buildDetectionSourceTiming({
    video,
    pumpMode,
    videoFrameMetadata: options.videoFrameMetadata,
    callbackTimestamp,
    callbackReceivedAt,
  });
  const boundarySourcePtsSec = optionalFiniteNumber(sourceTiming.sourcePtsSec) ??
    optionalFiniteNumber(video.currentTime) ?? 0;

  let frameSource = null;
  let handFrameSource = null;
  try {
    frameSource = captureDetectionFrameSnapshot(video);
    state.detectionPump.snapshotFrames += 1;
    if (shouldCaptureHandSnapshot(callbackReceivedAt, boundarySourcePtsSec)) {
      state.handPipeline.lastSnapshotAt = callbackReceivedAt;
      state.handPipeline.lastSnapshotSourcePtsSec = boundarySourcePtsSec;
      try {
        handFrameSource = captureDetectionFrameSnapshot(video);
        state.handPipeline.snapshots += 1;
      } catch (error) {
        state.handPipeline.snapshotErrors += 1;
        console.warn("Hand boundary snapshot skipped without affecting body tracking.", error);
      }
    }

    const nomination = bodyTrackerPlaybackGate.nominateBoundary({
      inputGeneration,
      media: video,
      boundaryReason,
      boundarySourcePtsSec,
      resumeAfterApply: Boolean(options.resumeAfterApply),
    });
    if (!nomination.bodyTrackerBoundaryAccepted) {
      closeDetectionFrameSource(frameSource);
      closeDetectionFrameSource(handFrameSource);
      return false;
    }

    state.detectionPump.lastOfferedSourcePtsSec = boundarySourcePtsSec;
    state.detectionPump.lastAdmittedSourcePtsSec = boundarySourcePtsSec;
    state.detectionPump.lastBodyCadenceAdmissionReason = "generation-boundary";
    const latestFrameStatus = getLatestFramePump().getStatus();
    const boundarySourceTiming = {
      ...sourceTiming,
      videoTime: boundarySourcePtsSec,
      sourcePtsSec: boundarySourcePtsSec,
      bodyCadenceMaxRateHz: BODY_DETECTION_RATE_HZ,
      bodyCadenceAdmissionReason: "generation-boundary",
      bodyCadenceSkips: state.detectionPump.bodyCadenceSkips,
      bodyOverloadDrops: latestFrameStatus.overloadDrops,
      bodyStaleCallbackDrops: state.detectionPump.staleFrameCallbacks,
      bodyPreInferenceStaleDrops: state.detectionPump.preInferenceStaleDrops,
      bodyPostInferenceStaleDrops:
        state.detectionPump.postInferenceStaleDrops,
      bodyTrackerBoundaryGeneration: inputGeneration,
      bodyTrackerBoundaryReason: String(boundaryReason || "boundary"),
      bodyTrackerBoundarySourcePtsSec: boundarySourcePtsSec,
    };

    if (!options.callbackRecorded) {
      recordDetectionCallback(callbackTimestamp);
      recordAppPerformanceSample(
        "frameCallbackLagMs",
        Math.max(0, callbackReceivedAt - callbackTimestamp),
      );
    }

    const bodyEnvelope = {
      generation: inputGeneration,
      timestamp: callbackTimestamp,
      sourcePtsSec: boundarySourcePtsSec,
      callbackMonotonicMs: boundarySourceTiming.callbackMonotonicMs,
      pendingDeadlineMonotonicMs:
        resolveBodyApplyDeadlineMonotonicMs(
          boundarySourceTiming,
          callbackReceivedAt,
        ),
      frameSource,
      handFrameSource,
      options: {
        pumpMode,
        sourceTiming: boundarySourceTiming,
        callbackRecorded: true,
        staleChecked: true,
        managedByLatestFramePump: true,
        boundaryNominated: true,
      },
    };
    const accepted = getLatestFramePump().offer(bodyEnvelope);
    frameSource = null;
    handFrameSource = null;
    if (!accepted) {
      releaseBodyTrackerPlaybackGate(
        inputGeneration,
        "boundary-offer-rejected",
        { resume: false },
      );
    } else {
      offerFaceSnapshotForDetection({
        timestamp: callbackTimestamp,
        sourceTiming: boundarySourceTiming,
        inputGeneration,
      });
    }
    return accepted;
  } catch (error) {
    closeDetectionFrameSource(frameSource);
    closeDetectionFrameSource(handFrameSource);
    releaseBodyTrackerPlaybackGate(inputGeneration, "boundary-snapshot-error", {
      resume: false,
    });
    throw error;
  }
}

function offerFrameForDetection(timestamp, metadata, pumpMode) {
  if (!state.active) {
    return;
  }

  const callbackReceivedAt = nowMs();
  const callbackTimestamp = Number.isFinite(timestamp) ? timestamp : callbackReceivedAt;
  const callbackLagMs = Math.max(0, callbackReceivedAt - callbackTimestamp);
  const rewindSourcePtsSec = resolveDetectionSourcePts({
    video: state.elements.video,
    pumpMode,
    videoFrameMetadata: metadata,
  });

  recordDetectionCallback(callbackTimestamp);
  recordAppPerformanceSample("frameCallbackLagMs", callbackLagMs);

  // Keep the producer independent of inference. The callback immediately arms
  // the next source frame, then freezes this callback's pixels and exact PTS.
  scheduleDetectionFrame();

  const inputGeneration = getLatestFramePump().getGeneration();
  if (bodyTrackerPlaybackGate.blocksOrdinaryFrame(inputGeneration)) {
    return;
  }

  if (shouldPromoteVideoRewindAtProducer(rewindSourcePtsSec)) {
    const timelineTransition = resetVideoTimelineState("rewind");
    void nominateVideoGenerationBoundary("rewind", {
        timestamp: callbackTimestamp,
        callbackReceivedAt,
        pumpMode,
        videoFrameMetadata: metadata,
        callbackRecorded: true,
        resumeAfterApply: Boolean(
          timelineTransition?.videoPlaybackWasPlaying,
        ),
      })
      .then(() => {
        scheduleDetectionFrame();
      })
      .catch((error) => {
        state.detectionPump.snapshotErrors += 1;
        state.detectionPump.errors += 1;
        setError(`Tracking failed: ${getErrorDetail(error)}`, "TRACKING_FAILED");
        setText("cameraStatus", "Failed");
        stopCamera({ preserveError: true, cameraStatus: "Failed" });
      });
    return;
  }

  const sourceTiming = buildDetectionSourceTiming({
    video: state.elements.video,
    pumpMode,
    videoFrameMetadata: metadata,
    callbackTimestamp,
    callbackReceivedAt,
  });

  if (shouldSkipStaleVideoFrameCallback(callbackLagMs, { pumpMode })) {
    state.detectionPump.staleFrameCallbacks += 1;
    state.detectionPump.consecutiveStaleFrameCallbacks += 1;
    return;
  }

  state.detectionPump.consecutiveStaleFrameCallbacks = 0;

  if (
    optionalFiniteNumber(state.detectionPump.lastOfferedSourcePtsSec) ===
    optionalFiniteNumber(sourceTiming.sourcePtsSec)
  ) {
    state.detectionPump.duplicateFrames += 1;
    return;
  }

  state.detectionPump.lastOfferedSourcePtsSec = sourceTiming.sourcePtsSec;

  const bodyAdmission = decideSourcePtsAdmission({
    sourcePtsSec: sourceTiming.sourcePtsSec,
    lastAdmittedSourcePtsSec: state.detectionPump.lastAdmittedSourcePtsSec,
    maxRateHz: BODY_DETECTION_RATE_HZ,
  });
  if (!bodyAdmission.shouldAdmit) {
    if (bodyAdmission.reason === "rate-budget") {
      state.detectionPump.bodyCadenceSkips += 1;
      // Face owns a separate 10 Hz source-time grid. A 60 fps callback that
      // the 30 Hz body budget intentionally skips can still be the only real
      // callback for a Face slot after a dropped frame, so consume that slot
      // without moving or duplicating the primary body schedule.
      offerFaceSnapshotForDetection({
        timestamp: callbackTimestamp,
        sourceTiming,
        inputGeneration,
      });
    } else {
      state.detectionPump.errors += 1;
      console.warn("Source frame rejected because its exact PTS is invalid.");
    }
    return;
  }

  state.detectionPump.lastAdmittedSourcePtsSec = sourceTiming.sourcePtsSec;
  state.detectionPump.lastBodyCadenceAdmissionReason = bodyAdmission.reason;
  const latestFrameStatus = getLatestFramePump().getStatus();
  const admittedSourceTiming = {
    ...sourceTiming,
    bodyCadenceMaxRateHz: BODY_DETECTION_RATE_HZ,
    bodyCadenceAdmissionReason: bodyAdmission.reason,
    bodyCadenceSkips: state.detectionPump.bodyCadenceSkips,
    bodyOverloadDrops: latestFrameStatus.overloadDrops,
    bodyStaleCallbackDrops: state.detectionPump.staleFrameCallbacks,
    bodyPreInferenceStaleDrops: state.detectionPump.preInferenceStaleDrops,
    bodyPostInferenceStaleDrops:
      state.detectionPump.postInferenceStaleDrops,
  };

  try {
    const frameSource = captureDetectionFrameSnapshot(state.elements.video);
    state.detectionPump.snapshotFrames += 1;
    let handFrameSource = null;

    if (shouldCaptureHandSnapshot(callbackReceivedAt, sourceTiming.sourcePtsSec)) {
      state.handPipeline.lastSnapshotAt = callbackReceivedAt;
      state.handPipeline.lastSnapshotSourcePtsSec = sourceTiming.sourcePtsSec;
      try {
        handFrameSource = captureDetectionFrameSnapshot(state.elements.video);
        state.handPipeline.snapshots += 1;
      } catch (error) {
        state.handPipeline.snapshotErrors += 1;
        console.warn("Hand frame snapshot skipped without affecting body tracking.", error);
      }
    }

    const bodyEnvelope = {
      generation: inputGeneration,
      timestamp: callbackTimestamp,
      sourcePtsSec: admittedSourceTiming.sourcePtsSec,
      callbackMonotonicMs: admittedSourceTiming.callbackMonotonicMs,
      pendingDeadlineMonotonicMs:
        resolveBodyApplyDeadlineMonotonicMs(
          admittedSourceTiming,
          callbackReceivedAt,
        ),
      frameSource,
      handFrameSource,
      options: {
        pumpMode,
        sourceTiming: admittedSourceTiming,
        callbackRecorded: true,
        staleChecked: true,
        managedByLatestFramePump: true,
      },
    };
    const accepted = getLatestFramePump().offer(bodyEnvelope);
    if (accepted) {
      offerFaceSnapshotForDetection({
        timestamp: callbackTimestamp,
        sourceTiming: admittedSourceTiming,
        inputGeneration,
      });
    }
  } catch (error) {
    state.detectionPump.snapshotErrors += 1;
    state.detectionPump.errors += 1;
    console.warn("Video frame snapshot dropped.", error);
  }
}

function shouldCaptureHandSnapshot(callbackReceivedAt, sourcePtsSec) {
  if (getActiveHandWorkerSides().length === 0) {
    state.handPipeline.unavailableSkips += 1;
    return false;
  }

  const sourceTimestampMs = optionalFiniteNumber(sourcePtsSec) === null
    ? callbackReceivedAt
    : Number(sourcePtsSec) * 1000;
  const lastSourcePtsSec = optionalFiniteNumber(
    state.handPipeline.lastSnapshotSourcePtsSec,
  );
  const lastRunTimestampMs = lastSourcePtsSec === null
    ? optionalFiniteNumber(state.handPipeline.lastSnapshotAt)
    : lastSourcePtsSec * 1000;
  const decision = shouldRunCadencedDetection({
    timestampMs: sourceTimestampMs,
    lastRunTimestampMs,
    intervalMs: HAND_DETECTION_INTERVAL_MS,
    // Sampling cadence must not accelerate just because the asynchronous
    // detector has not produced a hand yet. The capacity-1 pump owns load.
    hasCachedResult: true,
  });
  if (!decision.shouldRun) {
    state.handPipeline.cadenceSkips += 1;
    return false;
  }

  return true;
}

function captureDetectionFrameSnapshot(video) {
  if (!supportsDetectionFrameSnapshot()) {
    throw new Error("OffscreenCanvas transferToImageBitmap is unavailable for the exact-PTS rVFC pump.");
  }

  const width = Number(video?.videoWidth ?? 0);
  const height = Number(video?.videoHeight ?? 0);

  if (!(width > 0 && height > 0)) {
    throw new Error("Cannot snapshot an empty video frame.");
  }

  const { width: targetWidth, height: targetHeight } = computeBoundedFrameSize(
    width,
    height,
    MAX_INFERENCE_FRAME_DIMENSION,
  );

  if (
    !detectionSnapshotCanvas ||
    detectionSnapshotCanvas.width !== targetWidth ||
    detectionSnapshotCanvas.height !== targetHeight
  ) {
    detectionSnapshotCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    detectionSnapshotContext = detectionSnapshotCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  if (!detectionSnapshotContext) {
    throw new Error("Unable to create the bounded detection snapshot canvas.");
  }

  detectionSnapshotContext.drawImage(video, 0, 0, targetWidth, targetHeight);
  return detectionSnapshotCanvas.transferToImageBitmap();
}

function captureFaceDetectionFrameSnapshot(video) {
  if (!supportsDetectionFrameSnapshot()) {
    throw new Error("OffscreenCanvas transferToImageBitmap is unavailable for Face snapshots.");
  }

  const width = Number(video?.videoWidth ?? 0);
  const height = Number(video?.videoHeight ?? 0);
  const { width: targetWidth, height: targetHeight } = computeBoundedFrameSize(
    width,
    height,
    FACE_MAX_INFERENCE_FRAME_DIMENSION,
  );

  if (
    !faceDetectionSnapshotCanvas ||
    faceDetectionSnapshotCanvas.width !== targetWidth ||
    faceDetectionSnapshotCanvas.height !== targetHeight
  ) {
    faceDetectionSnapshotCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    faceDetectionSnapshotContext = faceDetectionSnapshotCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  if (!faceDetectionSnapshotContext) {
    throw new Error("Unable to create the bounded Face snapshot canvas.");
  }

  faceDetectionSnapshotContext.drawImage(video, 0, 0, targetWidth, targetHeight);
  return faceDetectionSnapshotCanvas.transferToImageBitmap();
}

function supportsDetectionFrameSnapshot() {
  return typeof OffscreenCanvas === "function" &&
    typeof OffscreenCanvas.prototype?.transferToImageBitmap === "function";
}

function getFaceFramePump() {
  if (!faceFramePump) {
    faceFramePump = createLatestFramePump({
      consume: consumeFaceFrame,
      apply: applyFaceFrameResult,
      dispose: (envelope, reason) => {
        closeDetectionFrameSource(envelope?.frameSource);
        if (envelope) {
          envelope.frameSource = null;
        }
        if (reason !== "consumed") {
          dropFaceObservationEnvelope(envelope, reason);
        }
      },
    });
  }
  return faceFramePump;
}

function shouldUseIndependentFaceWorker() {
  return Boolean(
    state.faceTracking.enabled &&
    state.faceWorker.active &&
    state.faceWorker.worker &&
    shouldUseTrackingWorker(),
  );
}

function clearFaceObservationState(reason = "face-observation-state-cleared") {
  faceObservationMaturationLedger.cancelPending({ reason });
  state.facePipeline.lastAdmittedSlotIndex = null;
  state.facePipeline.lastObservationSourcePtsSec = null;
  state.facePipeline.lastObservationAgeMs = null;
}

function dropFaceObservationEnvelope(envelope, reason) {
  const token = envelope?.faceObservationMaturationToken;
  if (!token) {
    return false;
  }
  return faceObservationMaturationLedger.drop(token, reason);
}

function offerFaceSnapshotForDetection({
  timestamp,
  sourceTiming,
  inputGeneration,
} = {}) {
  if (!state.faceTracking.enabled) {
    return false;
  }
  if (!shouldUseIndependentFaceWorker()) {
    state.facePipeline.unavailableSkips += 1;
    return false;
  }

  const sourcePtsSec = optionalFiniteNumber(sourceTiming?.sourcePtsSec);
  if (sourcePtsSec === null) {
    state.facePipeline.snapshotErrors += 1;
    return false;
  }
  const callbackReceivedMonotonicMs = optionalFiniteNumber(
    sourceTiming?.callbackReceivedMonotonicMs,
  );
  if (callbackReceivedMonotonicMs === null) {
    state.facePipeline.snapshotErrors += 1;
    return false;
  }
  const admission = decideSourcePtsSlotAdmission({
    sourcePtsSec,
    lastAdmittedSlotIndex: state.facePipeline.lastAdmittedSlotIndex,
    maxRateHz: FACE_DETECTION_RATE_HZ,
  });
  if (!admission.shouldAdmit) {
    if (admission.reason === "source-slot-already-admitted") {
      state.facePipeline.cadenceSkips += 1;
    } else {
      state.facePipeline.snapshotErrors += 1;
    }
    return false;
  }

  let frameSource = null;
  let faceObservationMaturationToken = null;
  try {
    frameSource = captureFaceDetectionFrameSnapshot(state.elements.video);
    state.facePipeline.snapshots += 1;
    faceObservationMaturationToken = faceObservationMaturationLedger.register({
      generation: inputGeneration,
      slotIndex: admission.slotIndex,
      sourcePtsSec,
      callbackMonotonicMs: callbackReceivedMonotonicMs,
    });
    state.facePipeline.lastAdmittedSlotIndex = admission.slotIndex;
    const accepted = getFaceFramePump().offer({
      generation: inputGeneration,
      timestamp,
      sourcePtsSec,
      callbackReceivedMonotonicMs,
      faceObservationMaturationToken,
      frameSource,
      sourceMeta: getCurrentMotionSourceMeta("face-worker", sourceTiming, {
        inputGeneration,
      }),
    });
    frameSource = null;
    return accepted;
  } catch (error) {
    if (faceObservationMaturationToken) {
      faceObservationMaturationLedger.drop(
        faceObservationMaturationToken,
        "offer-error",
      );
    }
    closeDetectionFrameSource(frameSource);
    state.facePipeline.snapshotErrors += 1;
    console.warn("Face frame snapshot skipped without affecting body tracking.", error);
    return false;
  }
}

async function consumeFaceFrame(envelope) {
  const offeredAt = optionalFiniteNumber(envelope.callbackReceivedMonotonicMs);
  if (
    offeredAt !== null &&
    nowMs() - offeredAt > MAX_PENDING_FRAME_AGE_MS
  ) {
    state.facePipeline.preInferenceStaleDrops += 1;
    return null;
  }
  if (!shouldUseIndependentFaceWorker()) {
    return null;
  }

  await prepareFaceWorkerGeneration(envelope.generation);
  if (envelope.generation !== getFaceFramePump().getGeneration()) {
    return null;
  }

  const lease = await auxiliaryInferenceArbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: envelope.generation,
    sourcePtsSec: envelope.sourcePtsSec,
  });
  if (!lease) {
    return null;
  }

  const imageBitmap = envelope.frameSource;
  let transferred = false;
  try {
    const acquiredAt = optionalFiniteNumber(
      envelope.callbackReceivedMonotonicMs,
    );
    if (
      acquiredAt !== null &&
      nowMs() - acquiredAt > MAX_PENDING_FRAME_AGE_MS
    ) {
      state.facePipeline.preInferenceStaleDrops += 1;
      return null;
    }
    if (
      !imageBitmap ||
      !shouldUseIndependentFaceWorker() ||
      envelope.generation !== getFaceFramePump().getGeneration()
    ) {
      return null;
    }

    state.faceWorker.requests += 1;
    const request = postFaceWorkerRequest(
      "detect",
      {
        imageBitmap,
        timestamp: envelope.timestamp,
        sourcePtsSec: envelope.sourcePtsSec,
        inputGeneration: envelope.generation,
        configurationKey: state.faceWorker.configurationKey,
        sourceMeta: envelope.sourceMeta,
        includeLandmarks: state.faceTracking.landmarksEnabled,
      },
      [imageBitmap],
    );
    transferred = true;
    envelope.frameSource = null;
    const response = await request;
    const responseGeneration = optionalFiniteNumber(response.inputGeneration);
    const responseSourcePtsSec = optionalFiniteNumber(response.sourcePtsSec);
    if (
      responseGeneration !== envelope.generation ||
      response.configurationKey !== state.faceWorker.configurationKey ||
      responseSourcePtsSec === null ||
      Math.abs(responseSourcePtsSec - envelope.sourcePtsSec) >
        FACE_SOURCE_PTS_EPSILON_SEC
    ) {
      const error = new Error(
        "Face worker returned a mismatched generation, configuration, or source PTS envelope.",
      );
      error.code = "FACE_RESPONSE_MISMATCH";
      throw error;
    }
    return response.result ?? null;
  } catch (error) {
    if (!transferred) {
      closeDetectionFrameSource(imageBitmap);
      envelope.frameSource = null;
    }
    if (
      isFaceGenerationTransitionError(error) &&
      envelope.generation !== getFaceFramePump().getGeneration()
    ) {
      return null;
    }
    if (
      error?.code === "FACE_WORKER_DISPOSED" &&
      (
        envelope.generation !== getFaceFramePump().getGeneration() ||
        !state.faceTracking.enabled ||
        !state.faceWorker.active
      )
    ) {
      return null;
    }
    if (!isFaceGenerationTransitionError(error)) {
      state.faceWorker.detectErrors += 1;
      state.faceWorker.errors += 1;
      state.faceWorker.lastError = getErrorDetail(error);
      state.faceWorker.status = "degraded";
      if (error?.faceWorkerFatal) {
        markFaceWorkerFailure(error, { countError: false });
      }
    }
    throw error;
  } finally {
    lease.release();
  }
}

async function prepareFaceWorkerGeneration(inputGeneration) {
  if (state.faceWorker.preparedGeneration === inputGeneration) {
    return true;
  }
  const response = await postFaceWorkerRequest("prepare-generation", {
    inputGeneration,
    configurationKey: state.faceWorker.configurationKey,
  });
  if (
    inputGeneration !== getFaceFramePump().getGeneration() ||
    response.inputGeneration !== inputGeneration ||
    response.configurationKey !== state.faceWorker.configurationKey
  ) {
    const error = new Error(`Face worker prepared stale generation ${inputGeneration}.`);
    error.code = "FACE_GENERATION_STALE";
    throw error;
  }
  state.faceWorker.preparedGeneration = inputGeneration;
  state.faceWorker.detectorDelegates = response.detectorDelegates ??
    state.faceWorker.detectorDelegates;
  mergeFaceWorkerDelegateTelemetry(response.detectorDelegates);
  return true;
}

function isFaceGenerationTransitionError(error) {
  return new Set([
    "FACE_GENERATION_STALE",
    "FACE_GENERATION_SUPERSEDED",
  ]).has(String(error?.code ?? ""));
}

function applyFaceFrameResult(result, envelope) {
  if (!envelope?.faceObservationMaturationToken) {
    return false;
  }
  if (!result) {
    dropFaceObservationEnvelope(envelope, "face-result-unavailable");
    return false;
  }
  if (!state.faceTracking.enabled || !state.active) {
    dropFaceObservationEnvelope(envelope, "face-runtime-inactive");
    return false;
  }

  try {
    const responseGeneration = optionalFiniteNumber(result.inputGeneration);
    const responseSourcePtsSec = optionalFiniteNumber(result.sourcePtsSec);
    const responseMetaSourcePtsSec = optionalFiniteNumber(
      result.sourceMeta?.sourcePtsSec,
    );
    const expectedSourcePtsSec = optionalFiniteNumber(envelope.sourcePtsSec);
    if (
      responseGeneration !== envelope.generation ||
      envelope.generation !== getFaceFramePump().getGeneration() ||
      result.configurationKey !== state.faceWorker.configurationKey ||
      result.sourceMeta?.inputGeneration !== envelope.generation ||
      result.sourceMeta?.faceTrackerConfigurationKey !==
        state.faceWorker.configurationKey ||
      responseSourcePtsSec === null ||
      responseMetaSourcePtsSec === null ||
      expectedSourcePtsSec === null ||
      Math.abs(responseSourcePtsSec - expectedSourcePtsSec) >
        FACE_SOURCE_PTS_EPSILON_SEC ||
      Math.abs(responseMetaSourcePtsSec - expectedSourcePtsSec) >
        FACE_SOURCE_PTS_EPSILON_SEC
    ) {
      dropFaceObservationEnvelope(envelope, "face-result-rejected");
      return false;
    }

    const observation = {
      generation: envelope.generation,
      slotIndex: envelope.faceObservationMaturationToken.slotIndex,
      sourcePtsSec: expectedSourcePtsSec,
      face: normalizeFace(result.face, {
        includeLandmarks: state.faceTracking.landmarksEnabled,
      }),
      sourceMeta: { ...(result.sourceMeta ?? {}) },
    };
    if (
      !faceObservationMaturationLedger.settle(
        envelope.faceObservationMaturationToken,
        observation,
      )
    ) {
      return false;
    }

    state.faceWorker.frames += 1;
    state.faceWorker.status = "ready";
    state.faceWorker.lastError = "";
    state.faceTracking.status = observation.face ? "running" : "ready";
    state.faceTracking.detectFrames += 1;
    state.faceTracking.lastTimestamp = Number(result.timestamp) || 0;
    if (observation.face) {
      state.faceTracking.facesDetected += 1;
      state.faceTracking.lastError = "";
    }
    const detectionDurationMs = optionalFiniteNumber(
      result.sourceMeta?.faceDetectionDurationMs,
    );
    recordAppPerformanceSample("faceDetectMs", detectionDurationMs);
    return true;
  } catch (error) {
    dropFaceObservationEnvelope(envelope, "face-apply-error");
    throw error;
  }
}

function mergeCachedFaceIntoBodyFrame(
  bodyFrame,
  inputGeneration,
  faceSelection,
) {
  if (!state.faceTracking.enabled || !faceSelection) {
    return bodyFrame;
  }
  const bodySourcePtsSec = optionalFiniteNumber(bodyFrame?.sourceMeta?.sourcePtsSec);
  if (bodySourcePtsSec === null) {
    state.facePipeline.cacheMisses += 1;
    return bodyFrame;
  }

  const cutoffSourcePtsSec = bodySourcePtsSec - FACE_OBSERVATION_DELAY_MS / 1000;
  const selectedSourcePtsSec = optionalFiniteNumber(faceSelection.sourcePtsSec);
  const selectedObservation = faceSelection.observation;
  const hasSettledObservation = Boolean(
    faceSelection.found &&
    (faceSelection.terminal === "observation" ||
      faceSelection.terminal === "null-observation") &&
    selectedObservation &&
    typeof selectedObservation === "object" &&
    Object.prototype.hasOwnProperty.call(selectedObservation, "face") &&
    faceSelection.generation === inputGeneration &&
    selectedSourcePtsSec !== null &&
    selectedSourcePtsSec <=
      cutoffSourcePtsSec + FACE_SOURCE_PTS_EPSILON_SEC
  );

  if (!hasSettledObservation) {
    if (faceSelection.reason === "future-only") {
      state.facePipeline.cacheFuture += 1;
    }
    state.facePipeline.cacheMisses += 1;
    const unavailableAgeMs = selectedSourcePtsSec === null
      ? null
      : Math.max(0, (bodySourcePtsSec - selectedSourcePtsSec) * 1000);
    state.facePipeline.lastObservationSourcePtsSec = selectedSourcePtsSec;
    state.facePipeline.lastObservationAgeMs = unavailableAgeMs;
    const faceCacheReason = faceSelection.terminal === "deadline-miss"
      ? "causal-observation-deadline-miss"
      : faceSelection.terminal === "drop"
      ? "causal-observation-dropped"
      : faceSelection.terminal === "cancellation"
      ? "causal-observation-cancelled"
      : "causal-observation-unavailable";
    return createMotionFrame({
      timestamp: bodyFrame.timestamp,
      mirrored: bodyFrame.mirrored,
      poseResults: motionFrameToPoseResults(bodyFrame),
      face: null,
      sourceMeta: {
        ...bodyFrame.sourceMeta,
        faceTrackingRuntime: "face-worker-source-slot",
        faceCacheReason,
        faceObservationGeneration: faceSelection.generation,
        faceObservationSlotIndex: faceSelection.slotIndex,
        faceObservationSourcePtsSec: selectedSourcePtsSec,
        faceSourceDeltaMs: unavailableAgeMs,
        faceMaturationTerminal: faceSelection.terminal,
        faceMaturationReason: faceSelection.reason,
      },
    });
  }

  const ageMs = Math.max(0, (bodySourcePtsSec - selectedSourcePtsSec) * 1000);
  if (ageMs > FACE_OBSERVATION_MAX_AGE_MS + 0.001) {
    state.facePipeline.cacheExpired += 1;
    state.facePipeline.cacheMisses += 1;
    state.facePipeline.lastObservationSourcePtsSec = selectedSourcePtsSec;
    state.facePipeline.lastObservationAgeMs = ageMs;
    return createMotionFrame({
      timestamp: bodyFrame.timestamp,
      mirrored: bodyFrame.mirrored,
      poseResults: motionFrameToPoseResults(bodyFrame),
      face: null,
      sourceMeta: {
        ...bodyFrame.sourceMeta,
        faceTrackingRuntime: "face-worker-source-slot",
        faceCacheReason: "causal-observation-expired",
        faceObservationGeneration: faceSelection.generation,
        faceObservationSlotIndex: faceSelection.slotIndex,
        faceObservationSourcePtsSec: selectedSourcePtsSec,
        faceSourceDeltaMs: ageMs,
        faceMaturationTerminal: faceSelection.terminal,
        faceMaturationReason: faceSelection.reason,
      },
    });
  }

  state.facePipeline.cacheHits += 1;
  state.facePipeline.lastObservationSourcePtsSec = selectedSourcePtsSec;
  state.facePipeline.lastObservationAgeMs = ageMs;
  return createMotionFrame({
    timestamp: bodyFrame.timestamp,
    mirrored: bodyFrame.mirrored,
    poseResults: motionFrameToPoseResults(bodyFrame),
    face: selectedObservation.face,
    faceOptions: { includeLandmarks: state.faceTracking.landmarksEnabled },
    sourceMeta: {
      ...bodyFrame.sourceMeta,
      faceTrackingRuntime: "face-worker-source-slot",
      faceObservationGeneration: faceSelection.generation,
      faceObservationSlotIndex: faceSelection.slotIndex,
      faceObservationSourcePtsSec: selectedSourcePtsSec,
      faceSourceDeltaMs: ageMs,
      faceCacheReason: selectedObservation.face
        ? "causal-observation"
        : "causal-null-observation",
      faceDetectionRateHz: FACE_DETECTION_RATE_HZ,
      faceApplicationLagMs: FACE_OBSERVATION_DELAY_MS,
      faceMaturationTerminal: faceSelection.terminal,
      faceMaturationReason: faceSelection.reason,
    },
  });
}

function rejectPostInferenceStaleBodyFrame(result, envelope) {
  if (
    !result?.motionFrame ||
    envelope?.options?.boundaryNominated
  ) {
    return false;
  }

  const deadlineMonotonicMs = optionalFiniteNumber(
    envelope?.pendingDeadlineMonotonicMs,
  );
  const completedAt = nowMs();
  if (
    deadlineMonotonicMs === null ||
    completedAt + BODY_AVATAR_APPLY_RESERVE_MS < deadlineMonotonicMs
  ) {
    return false;
  }

  const callbackReceivedMonotonicMs = optionalFiniteNumber(
    envelope?.options?.sourceTiming?.callbackReceivedMonotonicMs,
  );
  const ageMs = callbackReceivedMonotonicMs === null
    ? null
    : Math.max(0, completedAt - callbackReceivedMonotonicMs);
  state.detectionPump.postInferenceStaleDrops += 1;
  const provenance = Object.freeze({
    generation: envelope.generation,
    sourcePtsSec: optionalFiniteNumber(envelope.sourcePtsSec),
    callbackReceivedMonotonicMs,
    deadlineMonotonicMs,
    applyReserveMs: BODY_AVATAR_APPLY_RESERVE_MS,
    completedAtMonotonicMs: completedAt,
    ageMs,
    reason: "apply-deadline-exceeded",
  });
  state.detectionPump.lastPostInferenceStaleDrop = provenance;
  result.motionFrame.sourceMeta = {
    ...(result.motionFrame.sourceMeta ?? {}),
    bodyPostInferenceStale: true,
    bodyPostInferenceStaleReason: provenance.reason,
    bodyPostInferenceStaleAgeMs: ageMs,
    bodyPostInferenceDeadlineMonotonicMs: deadlineMonotonicMs,
    bodyPostInferenceApplyReserveMs: BODY_AVATAR_APPLY_RESERVE_MS,
    bodyPostInferenceStaleDrops:
      state.detectionPump.postInferenceStaleDrops,
  };
  return true;
}

function resolveBodyApplyDeadlineMonotonicMs(sourceTiming, callbackReceivedAt) {
  const latencyStartMonotonicMs =
    optionalFiniteNumber(sourceTiming?.captureMonotonicMs) ??
    optionalFiniteNumber(sourceTiming?.receiveMonotonicMs) ??
    optionalFiniteNumber(callbackReceivedAt);
  return latencyStartMonotonicMs === null
    ? null
    : latencyStartMonotonicMs + MAX_PENDING_FRAME_AGE_MS;
}

function getLatestFramePump() {
  if (!latestFramePump) {
    latestFramePump = createLatestFramePump({
      onTransition: (transition) => {
        videoPlaybackBackpressure.handleTransition(transition);
      },
      consume: async (envelope) => {
        const offeredAt = optionalFiniteNumber(
          envelope.options?.sourceTiming?.callbackReceivedMonotonicMs,
        );
        const ageMs = offeredAt === null ? 0 : Math.max(0, nowMs() - offeredAt);

        if (!envelope.options?.boundaryNominated && ageMs > MAX_PENDING_FRAME_AGE_MS) {
          state.detectionPump.preInferenceStaleDrops += 1;
          return null;
        }

        const result = await runDetectionFrame(envelope.timestamp, {
          ...(envelope.options ?? {}),
          frameSource: envelope.frameSource,
          inputGeneration: envelope.generation,
          managedByLatestFramePump: true,
        });

        return result;
      },
      apply: (result, envelope) => {
        if (rejectPostInferenceStaleBodyFrame(result, envelope)) {
          closeDetectionFrameSource(envelope.handFrameSource);
          envelope.handFrameSource = null;
          return false;
        }
        if (result && envelope.handFrameSource) {
          result.handFrameSource = envelope.handFrameSource;
          result.handGeneration = envelope.generation;
          result.handSourcePtsSec = envelope.sourcePtsSec;
          result.handSourceTiming = envelope.options?.sourceTiming ?? null;
          envelope.handFrameSource = null;
        } else if (envelope.handFrameSource) {
          closeDetectionFrameSource(envelope.handFrameSource);
          envelope.handFrameSource = null;
        }
        return applyDetectionFrameResult(result);
      },
      dispose: (envelope, reason) => {
        closeDetectionFrameSource(envelope?.frameSource);
        if (reason !== "consumed") {
          closeDetectionFrameSource(envelope?.handFrameSource);
        }
        if (reason === "consume-error" || reason === "stale-result") {
          releaseBodyTrackerPlaybackGate(envelope?.generation, reason);
        }
      },
    });
  }

  return latestFramePump;
}

function advanceDetectionGeneration(reason, options = {}) {
  const backpressureRelease = videoPlaybackBackpressure.cancel(reason);
  const playbackGateStatus = bodyTrackerPlaybackGate.getStatus();
  if (
    !options.preservePlaybackGate &&
    playbackGateStatus.bodyTrackerPlaybackGateActive &&
    Number.isSafeInteger(playbackGateStatus.bodyTrackerPlaybackGateGeneration)
  ) {
    releaseBodyTrackerPlaybackGate(
      playbackGateStatus.bodyTrackerPlaybackGateGeneration,
      reason === "input-stop" ? "input-stop" : "superseding-generation",
      { resume: reason !== "input-stop" },
    );
  }
  const inputGeneration = getLatestFramePump().advanceGeneration(reason);
  bodyGenerationPreparations.clear();
  auxiliaryInferenceArbiter.advanceGeneration(inputGeneration);
  mainThreadBodyTrackerGenerationOwner.reserve(inputGeneration);
  reserveTrackingWorkerGeneration(inputGeneration);
  faceObservationMaturationLedger.advanceGeneration(inputGeneration);
  getFaceFramePump().advanceGeneration(reason);
  reserveFaceWorkerGeneration(inputGeneration);
  getHandFrameFanOutPump().advanceGeneration(reason);
  for (const side of HAND_OBSERVATION_SIDES) {
    getHandSideFramePump(side).advanceGeneration(reason);
  }
  state.detectionPump.lastOfferedSourcePtsSec = null;
  state.detectionPump.lastAdmittedSourcePtsSec = null;
  state.detectionPump.lastBodyCadenceAdmissionReason = "";
  clearFaceObservationState(reason);
  state.handPipeline.cache = null;
  state.handPipeline.lastObservedBySide = { Left: null, Right: null };
  state.handPipeline.lastPredictionAgeMsBySide = { Left: null, Right: null };
  state.handPipeline.lastSnapshotAt = null;
  state.handPipeline.lastSnapshotSourcePtsSec = null;
  state.handPipeline.lastAttemptSourcePtsSec = { Left: null, Right: null };
  state.handPipeline.lastCacheAgeMs = null;
  state.handPipeline.aggregateRequestKeys.clear();
  state.handPipeline.aggregateFrameKeys.clear();
  // Keep in-flight prior-generation outcomes until their side pumps dispose.
  // The generation is part of the key, so they cannot mix with new frames.
  return {
    inputGeneration,
    videoPlaybackWasPlaying: Boolean(
      reason !== "input-stop" && backpressureRelease.wasPlaying,
    ),
  };
}

function beginDetectionConfigurationGeneration(reason) {
  const ownsVideoBoundary = Boolean(
    state.active && state.inputKind === "video",
  );
  const previousGate = bodyTrackerPlaybackGate.getStatus();
  const generationTransition = advanceDetectionGeneration(reason, {
    preservePlaybackGate: Boolean(
      ownsVideoBoundary && previousGate.bodyTrackerPlaybackGateActive,
    ),
  });

  const inputGeneration = getLatestFramePump().getGeneration();
  if (ownsVideoBoundary) {
    bodyTrackerPlaybackGate.reserveBoundary({
      inputGeneration,
      media: state.elements.video,
      boundaryReason: reason,
      resumeAfterApply: Boolean(
        previousGate.bodyTrackerPlaybackGateWasPlaying ||
        generationTransition.videoPlaybackWasPlaying,
      ),
    });
  }
  return { inputGeneration, ownsVideoBoundary, reason };
}

async function completeDetectionConfigurationGeneration(transition) {
  if (!transition?.ownsVideoBoundary) {
    return false;
  }
  if (
    !state.active ||
    state.inputKind !== "video" ||
    getLatestFramePump().getGeneration() !== transition.inputGeneration
  ) {
    return false;
  }

  const nominated = await nominateVideoGenerationBoundary(transition.reason);
  scheduleDetectionFrame();
  return nominated;
}

function reserveTrackingWorkerGeneration(inputGeneration) {
  state.trackingWorker.preparedGeneration = null;
  state.trackingWorker.preparedGenerationMeta = null;
  const worker = state.trackingWorker.worker;
  if (!worker) {
    return false;
  }

  try {
    worker.postMessage({
      type: "reserve-generation",
      requestId: 0,
      inputGeneration,
    });
    return true;
  } catch {
    // A later request takes the normal worker fallback path with full error
    // provenance. Generation advancement itself must remain synchronous.
    return false;
  }
}

function reserveFaceWorkerGeneration(inputGeneration) {
  state.faceWorker.preparedGeneration = null;
  const worker = state.faceWorker.worker;
  if (!worker) {
    return false;
  }
  try {
    worker.postMessage({
      type: "reserve-generation",
      requestId: 0,
      inputGeneration,
    });
    return true;
  } catch {
    return false;
  }
}

function releaseBodyTrackerPlaybackGate(inputGeneration, reason, options = {}) {
  if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
    return null;
  }
  return bodyTrackerPlaybackGate.release(inputGeneration, reason, options);
}

function isActiveVideoBoundaryGeneration(inputGeneration) {
  const status = bodyTrackerPlaybackGate.getStatus();
  return Boolean(
    state.inputKind === "video" &&
    status.bodyTrackerBoundaryActive &&
    status.bodyTrackerBoundaryGeneration === inputGeneration,
  );
}

function failVideoGenerationBoundary(inputGeneration, error, phase) {
  if (
    state.inputKind !== "video" ||
    !state.active ||
    getLatestFramePump().getGeneration() !== inputGeneration
  ) {
    return false;
  }

  const detail = getErrorDetail(error);
  setError(
    `Video boundary ${phase} failed before avatar apply: ${detail}`,
    "VIDEO_BOUNDARY_APPLY_FAILED",
  );
  setText("cameraStatus", "Failed");
  stopCamera({ preserveError: true, cameraStatus: "Failed" });
  return true;
}

function closeDetectionFrameSource(frameSource) {
  try {
    frameSource?.close?.();
  } catch {
    // A transferred ImageBitmap can already be detached by the worker.
  }
}

function getActiveHandWorkerSides() {
  return HAND_OBSERVATION_SIDES.filter((side) => {
    const runtime = getHandWorkerSideRuntime(side);
    return runtime.active && runtime.worker;
  });
}

function getHandFrameFanOutPump() {
  if (!handFrameFanOutPump) {
    handFrameFanOutPump = createLatestFramePump({
      consume: fanOutHandFrameEnvelope,
      apply: (result) => (result?.dispatchedSides?.length ?? 0) > 0,
      dispose: (envelope) => {
        closeDetectionFrameSource(envelope?.imageBitmap);
        if (envelope) {
          envelope.imageBitmap = null;
        }
      },
    });
  }
  return handFrameFanOutPump;
}

async function fanOutHandFrameEnvelope(envelope) {
  const offeredAt = optionalFiniteNumber(envelope.callbackReceivedMonotonicMs);
  const ageMs = offeredAt === null ? 0 : Math.max(0, nowMs() - offeredAt);
  if (ageMs > HAND_CACHE_MAX_AGE_MS) {
    state.handPipeline.preInferenceStaleDrops += 1;
    return null;
  }

  const activeSides = getActiveHandWorkerSides();
  for (const side of HAND_OBSERVATION_SIDES) {
    if (!activeSides.includes(side)) {
      state.handPipeline.fanOutSkipsBySide[side] += 1;
    }
  }
  if (activeSides.length === 0 || !envelope.imageBitmap) {
    return null;
  }

  if (activeSides.length === 1) {
    const imageBitmap = envelope.imageBitmap;
    envelope.imageBitmap = null;
    const dispatched = offerHandSideEnvelope(
      activeSides[0],
      buildHandSideEnvelope(envelope, activeSides[0], imageBitmap),
    );
    return createHandFanOutResult(
      envelope,
      dispatched ? [activeSides[0]] : [],
    );
  }

  state.handPipeline.cloneAttempts += 1;
  let clonedImageBitmap = null;
  try {
    // Clone before either transfer. The original and clone are then owned by
    // distinct side envelopes, so neither worker can detach its sibling input.
    clonedImageBitmap = await createImageBitmap(envelope.imageBitmap);
  } catch (error) {
    state.handPipeline.cloneFailures += 1;
    const currentSides = getActiveHandWorkerSides();
    if (
      envelope.generation !== getHandFrameFanOutPump().getGeneration() ||
      currentSides.length === 0
    ) {
      return null;
    }
    const selectedSide = currentSides[0];
    for (const side of currentSides.slice(1)) {
      state.handPipeline.fanOutSkipsBySide[side] += 1;
    }
    const imageBitmap = envelope.imageBitmap;
    envelope.imageBitmap = null;
    const dispatched = offerHandSideEnvelope(
      selectedSide,
      buildHandSideEnvelope(envelope, selectedSide, imageBitmap),
    );
    console.warn(
      `Hand frame clone failed; ${selectedSide} continues without disabling either side worker.`,
      error,
    );
    return createHandFanOutResult(
      envelope,
      dispatched ? [selectedSide] : [],
    );
  }

  if (envelope.generation !== getHandFrameFanOutPump().getGeneration()) {
    closeDetectionFrameSource(clonedImageBitmap);
    return null;
  }

  const currentSides = getActiveHandWorkerSides();
  if (currentSides.length === 0) {
    closeDetectionFrameSource(clonedImageBitmap);
    return null;
  }
  if (currentSides.length === 1) {
    closeDetectionFrameSource(clonedImageBitmap);
    const imageBitmap = envelope.imageBitmap;
    envelope.imageBitmap = null;
    const dispatched = offerHandSideEnvelope(
      currentSides[0],
      buildHandSideEnvelope(envelope, currentSides[0], imageBitmap),
    );
    return createHandFanOutResult(
      envelope,
      dispatched ? [currentSides[0]] : [],
    );
  }

  const originalImageBitmap = envelope.imageBitmap;
  envelope.imageBitmap = null;
  const sideBitmaps = {
    [currentSides[0]]: originalImageBitmap,
    [currentSides[1]]: clonedImageBitmap,
  };
  const dispatchedSides = [];
  for (const side of currentSides) {
    const dispatched = offerHandSideEnvelope(
      side,
      buildHandSideEnvelope(envelope, side, sideBitmaps[side]),
    );
    if (dispatched) {
      dispatchedSides.push(side);
    }
  }
  return createHandFanOutResult(envelope, dispatchedSides);
}

function createHandFanOutResult(envelope, dispatchedSides) {
  if (dispatchedSides.length > 0) {
    const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
    state.handPipeline.aggregateOutcomesByFrame.set(key, {
      expectedSides: new Set(dispatchedSides),
      completedSides: new Set(),
      observedSides: new Set(),
      retainedCacheAfterMissBySide: {},
      telemetrySides: new Set(),
      roundTripMsBySide: {},
      detectionMsBySide: {},
      trackerResetMsBySide: {},
      finalized: false,
    });
    while (state.handPipeline.aggregateOutcomesByFrame.size > 8) {
      const oldestKey = state.handPipeline.aggregateOutcomesByFrame.keys().next().value;
      abandonIncompleteAggregateHandOutcome(oldestKey);
    }
  }
  return { dispatchedSides };
}

function getHandAggregateFrameKey(generation, sourcePtsSec) {
  const normalizedSourcePtsSec = optionalFiniteNumber(sourcePtsSec);
  return `${generation}:${normalizedSourcePtsSec === null
    ? "unknown"
    : normalizedSourcePtsSec.toFixed(6)}`;
}

function recordAggregateHandRequest(envelope) {
  const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
  if (state.handPipeline.aggregateRequestKeys.has(key)) {
    return;
  }
  state.handPipeline.aggregateRequestKeys.add(key);
  state.handWorker.requests += 1;
  trimHandAggregateKeySet(state.handPipeline.aggregateRequestKeys);
}

function recordAggregateHandDetectionFrame(envelope) {
  const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
  if (state.handPipeline.aggregateFrameKeys.has(key)) {
    return;
  }
  state.handPipeline.aggregateFrameKeys.add(key);
  state.handWorker.frames += 1;
  trimHandAggregateKeySet(state.handPipeline.aggregateFrameKeys);
}

function trimHandAggregateKeySet(keys) {
  while (keys.size > 16) {
    keys.delete(keys.values().next().value);
  }
}

function recordAggregateHandOutcome(side, merged, envelope) {
  const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
  const outcome = state.handPipeline.aggregateOutcomesByFrame.get(key);
  if (!outcome || !outcome.expectedSides.has(side)) {
    return;
  }
  outcome.completedSides.add(side);
  if (merged.observedSides.includes(side)) {
    outcome.observedSides.add(side);
  }
  outcome.retainedCacheAfterMissBySide[side] =
    merged.heldSides.includes(side);
  finalizeAggregateHandOutcome(key, outcome);
}

function recordAggregateHandLatency(side, envelope, latency) {
  const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
  const outcome = state.handPipeline.aggregateOutcomesByFrame.get(key);
  if (!outcome || !outcome.expectedSides.has(side)) {
    return;
  }
  outcome.telemetrySides.add(side);
  outcome.roundTripMsBySide[side] = latency.roundTripMs;
  outcome.detectionMsBySide[side] = latency.detectionMs;
  outcome.trackerResetMsBySide[side] = latency.trackerResetMs;
}

function cancelAggregateHandOutcomeSide(side, envelope, reason = "cancelled") {
  if (!envelope) {
    return false;
  }
  const key = getHandAggregateFrameKey(envelope.generation, envelope.sourcePtsSec);
  return cancelAggregateHandOutcomeSideByKey(side, key, reason);
}

function cancelAggregateHandOutcomeSideByKey(side, key, reason = "cancelled") {
  const outcome = state.handPipeline.aggregateOutcomesByFrame.get(key);
  if (!outcome || outcome.finalized || !outcome.expectedSides.has(side)) {
    return false;
  }

  outcome.expectedSides.delete(side);
  outcome.completedSides.delete(side);
  outcome.observedSides.delete(side);
  outcome.telemetrySides.delete(side);
  delete outcome.retainedCacheAfterMissBySide[side];
  delete outcome.roundTripMsBySide[side];
  delete outcome.detectionMsBySide[side];
  delete outcome.trackerResetMsBySide[side];
  outcome.lastCancellationReason = reason;
  finalizeAggregateHandOutcome(key, outcome);
  return true;
}

function cancelPendingAggregateHandOutcomesForSide(side, reason = "cancelled") {
  for (const [key, outcome] of [
    ...state.handPipeline.aggregateOutcomesByFrame.entries(),
  ]) {
    if (outcome.expectedSides.has(side)) {
      cancelAggregateHandOutcomeSideByKey(side, key, reason);
    }
  }
}

function abandonIncompleteAggregateHandOutcome(key) {
  const outcome = state.handPipeline.aggregateOutcomesByFrame.get(key);
  if (!outcome) {
    return;
  }
  if (outcome.finalized) {
    state.handPipeline.aggregateOutcomesByFrame.delete(key);
    return;
  }
  for (const side of [...outcome.expectedSides]) {
    if (!outcome.completedSides.has(side)) {
      cancelAggregateHandOutcomeSideByKey(side, key, "outcome-evicted");
    }
  }
  const retainedOutcome = state.handPipeline.aggregateOutcomesByFrame.get(key);
  if (retainedOutcome) {
    finalizeAggregateHandOutcome(key, retainedOutcome);
  }
}

function finalizeAggregateHandOutcome(key, outcome) {
  if (!outcome || outcome.finalized) {
    return false;
  }
  const effectiveSides = [...outcome.expectedSides];
  if (effectiveSides.length === 0) {
    outcome.finalized = true;
    state.handPipeline.aggregateOutcomesByFrame.delete(key);
    return true;
  }
  if (effectiveSides.some((side) => !outcome.completedSides.has(side))) {
    return false;
  }

  outcome.finalized = true;
  const observedSideCount = effectiveSides.filter(
    (side) => outcome.observedSides.has(side),
  ).length;
  if (observedSideCount === 0) {
    state.handPipeline.nullResults += 1;
    if (effectiveSides.some(
      (side) => outcome.retainedCacheAfterMissBySide[side],
    )) {
      state.handPipeline.heldNullResults += 1;
    }
  } else if (observedSideCount === 1) {
    state.handPipeline.singleSideResults += 1;
  }

  recordAppPerformanceSample(
    "handRoundTripMs",
    maximumFiniteValue(outcome.roundTripMsBySide, effectiveSides),
  );
  recordAppPerformanceSample(
    "handDetectMs",
    maximumFiniteValue(outcome.detectionMsBySide, effectiveSides),
  );
  recordAppPerformanceSample(
    "handTrackerResetMs",
    maximumFiniteValue(outcome.trackerResetMsBySide, effectiveSides),
  );
  state.handPipeline.aggregateOutcomesByFrame.delete(key);
  return true;
}

function maximumFiniteValue(valuesBySide, sides = HAND_OBSERVATION_SIDES) {
  const values = sides
    .map((side) => valuesBySide[side])
    .filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : null;
}

function buildHandSideEnvelope(sourceEnvelope, side, imageBitmap) {
  return {
    generation: sourceEnvelope.generation,
    timestamp: sourceEnvelope.timestamp,
    sourcePtsSec: sourceEnvelope.sourcePtsSec,
    callbackReceivedMonotonicMs: sourceEnvelope.callbackReceivedMonotonicMs,
    imageBitmap,
    mirrored: sourceEnvelope.mirrored,
    poseLandmarks: sourceEnvelope.poseLandmarks,
    sourceMeta: { ...(sourceEnvelope.sourceMeta ?? {}) },
    requestedSide: side,
  };
}

function offerHandSideEnvelope(side, envelope) {
  try {
    const accepted = getHandSideFramePump(side).offer(envelope);
    const counter = accepted
      ? state.handPipeline.fanOutDispatchesBySide
      : state.handPipeline.fanOutSkipsBySide;
    counter[side] += 1;
    return accepted;
  } catch (error) {
    closeDetectionFrameSource(envelope.imageBitmap);
    envelope.imageBitmap = null;
    state.handPipeline.fanOutSkipsBySide[side] += 1;
    console.warn(`${side} hand frame fan-out was dropped.`, error);
    return false;
  }
}

function getHandSideFramePump(side) {
  if (!handSideFramePumps[side]) {
    handSideFramePumps[side] = createLatestFramePump({
      consume: (envelope) => detectHandSideFrame(side, envelope),
      apply: (result, envelope) => {
        try {
          const applied = applyHandFrameResult(side, result, envelope);
          if (applied === false) {
            cancelAggregateHandOutcomeSide(side, envelope, "apply-rejected");
          }
          return applied;
        } catch (error) {
          cancelAggregateHandOutcomeSide(side, envelope, "apply-error");
          throw error;
        }
      },
      dispose: (envelope, reason) => {
        closeDetectionFrameSource(envelope?.imageBitmap);
        if (envelope) {
          envelope.imageBitmap = null;
        }
        if (reason !== "consumed") {
          cancelAggregateHandOutcomeSide(side, envelope, reason);
        }
      },
    });
  }
  return handSideFramePumps[side];
}

async function detectHandSideFrame(side, envelope) {
  const runtime = getHandWorkerSideRuntime(side);
  const offeredAt = optionalFiniteNumber(envelope.callbackReceivedMonotonicMs);
  const ageMs = offeredAt === null ? 0 : Math.max(0, nowMs() - offeredAt);
  if (ageMs > MAX_PENDING_FRAME_AGE_MS) {
    runtime.preInferenceStaleDrops += 1;
    state.handPipeline.preInferenceStaleDrops += 1;
    return null;
  }
  if (!runtime.active || !runtime.worker) {
    return null;
  }

  const handRequestStartedAt = nowMs();
  const lease = await auxiliaryInferenceArbiter.acquire({
    lane: side === "Left"
      ? AUXILIARY_INFERENCE_LANES.HAND_LEFT
      : AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: envelope.generation,
    sourcePtsSec: envelope.sourcePtsSec,
  });
  if (!lease) {
    return null;
  }

  try {
    const acquiredAgeMs = offeredAt === null
      ? 0
      : Math.max(0, nowMs() - offeredAt);
    if (acquiredAgeMs > MAX_PENDING_FRAME_AGE_MS) {
      runtime.preInferenceStaleDrops += 1;
      state.handPipeline.preInferenceStaleDrops += 1;
      return null;
    }
    if (
      !state.active ||
      !runtime.active ||
      !runtime.worker ||
      !envelope.imageBitmap ||
      envelope.generation !== getHandSideFramePump(side).getGeneration()
    ) {
      return null;
    }

    state.handPipeline.lastAttemptSourcePtsSec[side] = envelope.sourcePtsSec;
    recordAggregateHandRequest(envelope);
    runtime.requests += 1;
    refreshHandWorkerAggregateState();
    const response = await postHandWorkerRequest(side, "detect", {
      requestedSide: side,
      imageBitmap: envelope.imageBitmap,
      timestamp: envelope.timestamp,
      sourceMeta: { ...(envelope.sourceMeta ?? {}) },
      poseLandmarks: envelope.poseLandmarks,
      mirrored: envelope.mirrored,
    }, [envelope.imageBitmap]);
    assertHandWorkerResponseSide(response, side, { requireFrameSourceMeta: true });
    recordHandSideResponseTelemetry(side, response, handRequestStartedAt, envelope);
    runtime.status = "ready";
    runtime.lastError = "";
    refreshHandWorkerAggregateState();
    return {
      frame: response.frame ?? null,
      handWorkerSide: response.handWorkerSide,
      generation: envelope.generation,
      sourcePtsSec: envelope.sourcePtsSec,
    };
  } catch (error) {
    if (!error?.handWorkerFailureCounted) {
      runtime.detectErrors += 1;
      runtime.errors += 1;
      runtime.status = "degraded";
      runtime.lastError = getErrorDetail(error);
      if (error?.handWorkerFatal) {
        markHandWorkerSideFailure(side, error, { countError: false });
      } else {
        refreshHandWorkerAggregateState();
      }
    }
    throw error;
  } finally {
    lease.release();
  }
}

function recordHandSideResponseTelemetry(side, response, requestStartedAt, envelope) {
  const runtime = getHandWorkerSideRuntime(side);
  const handSourceMeta = response.frame?.sourceMeta ?? {};
  const roundTripMs = Math.max(0, nowMs() - requestStartedAt);
  const detectionMs = optionalFiniteNumber(handSourceMeta.handDetectionDurationMs);
  runtime.lastRoundTripMs = roundTripMs;
  runtime.lastDetectionMs = detectionMs;
  recordBoundedSample(runtime.roundTripMs, roundTripMs);
  recordBoundedSample(runtime.detectionMs, detectionMs);

  const trackerResetCount = Math.max(
    0,
    Number(handSourceMeta.handTrackerResetCount) || 0,
  );
  const trackerResetMs = trackerResetCount > 0
    ? optionalFiniteNumber(handSourceMeta.handTrackerResetDurationMs)
    : null;
  if (trackerResetMs !== null) {
    recordBoundedSample(runtime.trackerResetMs, trackerResetMs);
  }
  recordAggregateHandLatency(side, envelope, {
    roundTripMs,
    detectionMs,
    trackerResetMs,
  });
  if (handSourceMeta.handDetectionRan) {
    runtime.frames += 1;
    recordAggregateHandDetectionFrame(envelope);
  }
  runtime.roiUnavailable += Math.max(
    0,
    Number(handSourceMeta.handRoiUnavailableCount) || 0,
  );
  runtime.roiRecommits += Math.max(
    0,
    Number(handSourceMeta.handRoiRecommitCount) || 0,
  );
  runtime.heldPoseRoiSides += Math.max(
    0,
    Number(handSourceMeta.handRoiHeldPoseSideCount) || 0,
  );
  runtime.trackerResets += trackerResetCount;
  runtime.staleSourcePtsSkips += Math.max(
    0,
    Number(handSourceMeta.handTrackerStaleSourcePtsSkipCount) || 0,
  );
  runtime.lastRoiEpisodeReasons = handSourceMeta.handRoiEpisodeReasons ?? "";
  runtime.lastTrackerResetSides = handSourceMeta.handTrackerResetSides ?? "";
  runtime.lastRoiTransformVersion = optionalFiniteNumber(
    handSourceMeta[`handRoiTransformVersion${side}`],
  ) ?? 0;
  runtime.lastRoiExpansionLevel = optionalFiniteNumber(
    handSourceMeta[`handRoiExpansionLevel${side}`],
  ) ?? 0;
  runtime.lastRoiMissStreak = optionalFiniteNumber(
    handSourceMeta[`handRoiMissStreak${side}`],
  ) ?? 0;
}

function recordBoundedSample(samples, value) {
  if (!Array.isArray(samples) || !Number.isFinite(value)) {
    return;
  }
  samples.push(Math.max(0, value));
  if (samples.length > APP_PERFORMANCE_SAMPLE_LIMIT) {
    samples.splice(0, samples.length - APP_PERFORMANCE_SAMPLE_LIMIT);
  }
}

function applyHandFrameResult(side, result, envelope) {
  const frame = result?.frame;
  if (!frame || !state.active) {
    return false;
  }

  const responseGeneration = optionalFiniteNumber(frame.sourceMeta?.inputGeneration);
  const responseSourcePtsSec = optionalFiniteNumber(frame.sourceMeta?.sourcePtsSec);
  const expectedSourcePtsSec = optionalFiniteNumber(envelope.sourcePtsSec);
  if (
    result.handWorkerSide !== side ||
    frame.sourceMeta?.handWorkerSide !== side ||
    result.generation !== getHandSideFramePump(side).getGeneration() ||
    responseGeneration !== envelope.generation ||
    responseSourcePtsSec === null ||
    expectedSourcePtsSec === null ||
    Math.abs(responseSourcePtsSec - expectedSourcePtsSec) > 0.000001
  ) {
    return false;
  }

  const merged = mergeHandObservationCache(state.handPipeline.cache, {
    frame,
    generation: envelope.generation,
    sourcePtsSec: expectedSourcePtsSec,
    completedAt: nowMs(),
    attemptedSides: [side],
  });
  state.handPipeline.cache = merged.cache;
  rememberObservedHands(frame, merged, envelope.generation, expectedSourcePtsSec);
  recordAggregateHandOutcome(side, merged, envelope);

  const counter = merged.observedSides.includes(side)
    ? state.handPipeline.detectionHitsBySide
    : state.handPipeline.detectionMissesBySide;
  counter[side] += 1;
  return true;
}

function rememberObservedHands(frame, merged, generation, sourcePtsSec) {
  if (!Array.isArray(frame?.poseLandmarks) || frame.poseLandmarks.length < 23) {
    return;
  }

  for (const side of merged.observedSides) {
    const observation = merged.cache?.sides?.[side];
    if (!Array.isArray(observation?.landmarks) || observation.landmarks.length !== 21) {
      continue;
    }
    const previous = state.handPipeline.lastObservedBySide[side];
    if (
      previous?.generation === generation &&
      Number.isFinite(previous.sourcePtsSec) &&
      sourcePtsSec < previous.sourcePtsSec - 0.000001
    ) {
      continue;
    }

    state.handPipeline.lastObservedBySide[side] = {
      generation,
      sourcePtsSec,
      mirrored: Boolean(frame.mirrored),
      aspectRatio: getInputAspectRatio(),
      landmarks: clonePredictionLandmarks(observation.landmarks),
      poseLandmarks: clonePredictionLandmarks(frame.poseLandmarks),
      sourceMeta: { ...(frame.sourceMeta ?? {}) },
    };
  }
}

function clonePredictionLandmarks(landmarks) {
  return Array.isArray(landmarks)
    ? landmarks.map((landmark) => ({ ...landmark }))
    : null;
}

function getInputAspectRatio() {
  const width = Number(state.elements.video?.videoWidth);
  const height = Number(state.elements.video?.videoHeight);
  return width > 0 && height > 0 ? width / height : 1;
}

function offerHandFrameAfterBody(result, bodyFrame) {
  const imageBitmap = result?.handFrameSource;
  const poseLandmarks = result?.handPoseLandmarks ?? bodyFrame?.poseLandmarks;
  result.handFrameSource = null;
  result.handPoseLandmarks = null;
  if (!imageBitmap) {
    return false;
  }

  if (
    !state.active ||
    getActiveHandWorkerSides().length === 0 ||
    !poseLandmarks ||
    result.handGeneration !== getHandFrameFanOutPump().getGeneration()
  ) {
    closeDetectionFrameSource(imageBitmap);
    return false;
  }

  const sourcePtsSec = optionalFiniteNumber(result.handSourcePtsSec);
  if (sourcePtsSec === null) {
    closeDetectionFrameSource(imageBitmap);
    return false;
  }

  return getHandFrameFanOutPump().offer({
    generation: result.handGeneration,
    timestamp: bodyFrame.timestamp,
    sourcePtsSec,
    callbackReceivedMonotonicMs: optionalFiniteNumber(
      result.handSourceTiming?.callbackReceivedMonotonicMs,
    ),
    imageBitmap,
    mirrored: bodyFrame.mirrored,
    // Crop raw pixels with the raw detector image pose. The canonical adapter
    // intentionally moves joint centers for retargeting and must not move the
    // ROI used against the unchanged snapshot.
    poseLandmarks,
    sourceMeta: {
      ...bodyFrame.sourceMeta,
      sourcePtsSec,
      videoTime: sourcePtsSec,
      inputGeneration: result.handGeneration,
      trackingRuntime: "hand-worker",
    },
  });
}

function mergeCachedHandsIntoBodyFrame(bodyFrame, options = {}) {
  state.handPipeline.bodyFramesConsidered += 1;
  const bodySourcePtsSec = optionalFiniteNumber(bodyFrame?.sourceMeta?.sourcePtsSec);

  if (bodySourcePtsSec === null) {
    state.handPipeline.cacheMisses += 1;
    state.handPipeline.lastCacheAgeMs = null;
    countHandOutputSides([], [], []);
    return mergeCachedHandsIntoBodyFrameWithoutCounting(bodyFrame);
  }

  const generation = getHandFrameFanOutPump().getGeneration();
  const resolved = resolveHandObservationCache(state.handPipeline.cache, {
    generation,
    sourcePtsSec: bodySourcePtsSec,
    maxAgeMs: HAND_CACHE_MAX_AGE_MS,
  });
  state.handPipeline.cache = resolved.cache;
  state.handPipeline.cacheExpired += resolved.expiredSides.length;
  state.handPipeline.cacheFuture += resolved.futureSides.length;
  const prediction = resolvePoseGuidedHandPredictions(bodyFrame, {
    ...options,
    generation,
    sourcePtsSec: bodySourcePtsSec,
    excludedSides: resolved.usedSides,
  });
  countHandOutputSides(
    resolved.usedSides,
    resolved.heldSides,
    prediction.usedSides,
  );

  if (resolved.usedSides.length === 0) {
    state.handPipeline.cacheMisses += 1;
  } else {
    state.handPipeline.cacheHits += 1;
  }
  const cacheAgeValues = Object.values(resolved.ageMsBySide);
  state.handPipeline.lastCacheAgeMs = cacheAgeValues.length > 0
    ? Math.max(...cacheAgeValues)
    : null;

  const effectiveSides = [
    ...resolved.usedSides,
    ...prediction.usedSides,
  ];
  if (effectiveSides.length === 0) {
    return mergeCachedHandsIntoBodyFrameWithoutCounting(bodyFrame);
  }

  const originSourcePtsSecBySide = Object.fromEntries(effectiveSides.map((side) => [
    side,
    prediction.bySide[side]?.observedSourcePtsSec ??
      resolved.sourcePtsSecBySide[side],
  ]));
  const appliedSourcePtsSecBySide = Object.fromEntries(effectiveSides.map((side) => [
    side,
    prediction.bySide[side]?.sourcePtsSec ?? resolved.sourcePtsSecBySide[side],
  ]));
  const observationAgeMsBySide = Object.fromEntries(effectiveSides.map((side) => [
    side,
    prediction.bySide[side]?.ageMs ?? resolved.ageMsBySide[side] ?? 0,
  ]));
  const sourceMetaBySide = Object.fromEntries(effectiveSides.map((side) => [
    side,
    prediction.observationBySide[side]?.sourceMeta ??
      resolved.sourceMetaBySide[side] ??
      null,
  ]));
  const freshestSide = effectiveSides.reduce((current, side) => (
    !current || originSourcePtsSecBySide[side] > originSourcePtsSecBySide[current]
      ? side
      : current
  ), null);
  const freshestMeta = sourceMetaBySide[freshestSide] ?? {};
  const leftHandSourceMeta = sourceMetaBySide.Left ?? {};
  const rightHandSourceMeta = sourceMetaBySide.Right ?? {};
  const observationState = (side) => {
    if (prediction.usedSides.includes(side)) {
      return "pose-guided-prediction";
    }
    if (!resolved.usedSides.includes(side)) {
      return "missing";
    }
    return resolved.heldSides.includes(side)
      ? "cached-after-miss"
      : "cached-success";
  };
  const maximumObservationAgeMs = Math.max(
    0,
    ...Object.values(observationAgeMsBySide),
  );
  const handResults = {
    ...resolved.handResults,
    ...prediction.handResults,
  };

  return createMotionFrame({
    timestamp: bodyFrame.timestamp,
    mirrored: bodyFrame.mirrored,
    poseResults: motionFrameToPoseResults(bodyFrame),
    handResults,
    face: bodyFrame.face,
    sourceMeta: {
      ...bodyFrame.sourceMeta,
      handDetectionRan: false,
      handDetectionAgeMs: maximumObservationAgeMs,
      handDetectionIntervalMs: HAND_DETECTION_INTERVAL_MS,
      handSourcePtsSec: appliedSourcePtsSecBySide[freshestSide],
      handObservationSourcePtsSec: originSourcePtsSecBySide[freshestSide],
      handTrackingRuntime: prediction.usedSides.length > 0
        ? "hand-worker-cache+pose-guided-prediction"
        : "hand-worker-cache",
      handDetectionInputMode: freshestMeta.handDetectionInputMode ?? "unknown",
      handRequestedSide: freshestMeta.handRequestedSide ?? null,
      handRequestedSides: freshestMeta.handRequestedSides ?? null,
      handLatestDetectedSide: freshestMeta.handDetectedSide ?? null,
      handLatestDetectedSides: freshestMeta.handDetectedSides ?? null,
      handCachedSideCount: resolved.usedSides.length,
      handAfterMissSideCount: resolved.heldSides.length,
      handPoseGuidedSideCount: prediction.usedSides.length,
      handPoseGuidedSides: prediction.usedSides.join(","),
      handPoseGuidedMaxAgeMs: HAND_POSE_GUIDED_FALLBACK_MAX_AGE_MS,
      handLeftCached: resolved.usedSides.includes("Left"),
      handRightCached: resolved.usedSides.includes("Right"),
      handLeftPredicted: prediction.usedSides.includes("Left"),
      handRightPredicted: prediction.usedSides.includes("Right"),
      handLeftDetectionAgeMs: resolved.ageMsBySide.Left ?? null,
      handRightDetectionAgeMs: resolved.ageMsBySide.Right ?? null,
      handLeftPredictionAgeMs: prediction.bySide.Left?.ageMs ?? null,
      handRightPredictionAgeMs: prediction.bySide.Right?.ageMs ?? null,
      handLeftObservationAgeMs: observationAgeMsBySide.Left ?? null,
      handRightObservationAgeMs: observationAgeMsBySide.Right ?? null,
      handLeftSourcePtsSec: appliedSourcePtsSecBySide.Left ?? null,
      handRightSourcePtsSec: appliedSourcePtsSecBySide.Right ?? null,
      handLeftObservedSourcePtsSec: originSourcePtsSecBySide.Left ?? null,
      handRightObservedSourcePtsSec: originSourcePtsSecBySide.Right ?? null,
      handLeftPredictionOriginSourcePtsSec:
        prediction.bySide.Left?.observedSourcePtsSec ?? null,
      handRightPredictionOriginSourcePtsSec:
        prediction.bySide.Right?.observedSourcePtsSec ?? null,
      handLeftPredictionConfidence: prediction.bySide.Left?.confidence ?? null,
      handRightPredictionConfidence: prediction.bySide.Right?.confidence ?? null,
      handLeftPredictionMode: prediction.bySide.Left?.mode ?? null,
      handRightPredictionMode: prediction.bySide.Right?.mode ?? null,
      handLeftPredictionScale: prediction.bySide.Left?.scale ?? null,
      handRightPredictionScale: prediction.bySide.Right?.scale ?? null,
      handLeftPredictionRotationRad: prediction.bySide.Left?.rotationRad ?? null,
      handRightPredictionRotationRad: prediction.bySide.Right?.rotationRad ?? null,
      handLeftPredictionResidual: prediction.bySide.Left?.residual ?? null,
      handRightPredictionResidual: prediction.bySide.Right?.residual ?? null,
      handLeftObservationState: observationState("Left"),
      handRightObservationState: observationState("Right"),
      handLeftMissedDetections: resolved.missedDetectionsBySide.Left ?? null,
      handRightMissedDetections: resolved.missedDetectionsBySide.Right ?? null,
      handRoiCount: optionalFiniteNumber(freshestMeta.handRoiCount),
      handRoiPaddingRatio: optionalFiniteNumber(freshestMeta.handRoiPaddingRatio),
      handRoiVisibleRatio: optionalFiniteNumber(freshestMeta.handRoiVisibleRatio),
      handRoiSourceSize: optionalFiniteNumber(freshestMeta.handRoiSourceSize),
      handRoiEpisodeReasons: freshestMeta.handRoiEpisodeReasons ?? null,
      handRoiRecommitCount: optionalFiniteNumber(
        freshestMeta.handRoiRecommitCount,
      ),
      handRoiHeldPoseSideCount: optionalFiniteNumber(
        freshestMeta.handRoiHeldPoseSideCount,
      ),
      handTrackerResetCount: optionalFiniteNumber(
        freshestMeta.handTrackerResetCount,
      ),
      handTrackerResetDurationMs: optionalFiniteNumber(
        freshestMeta.handTrackerResetDurationMs,
      ),
      handTrackerStaleSourcePtsSkipCount: optionalFiniteNumber(
        freshestMeta.handTrackerStaleSourcePtsSkipCount,
      ),
      handRoiTransformVersionLeft: optionalFiniteNumber(
        leftHandSourceMeta.handRoiTransformVersionLeft,
      ),
      handRoiTransformVersionRight: optionalFiniteNumber(
        rightHandSourceMeta.handRoiTransformVersionRight,
      ),
      handRoiExpansionLevelLeft: optionalFiniteNumber(
        leftHandSourceMeta.handRoiExpansionLevelLeft,
      ),
      handRoiExpansionLevelRight: optionalFiniteNumber(
        rightHandSourceMeta.handRoiExpansionLevelRight,
      ),
      handRoiMissStreakLeft: optionalFiniteNumber(
        leftHandSourceMeta.handRoiMissStreakLeft,
      ),
      handRoiMissStreakRight: optionalFiniteNumber(
        rightHandSourceMeta.handRoiMissStreakRight,
      ),
      handTrackerTimestampMs: optionalFiniteNumber(
        freshestMeta.handTrackerTimestampMs,
      ),
      handTrackerTimestampSource:
        freshestMeta.handTrackerTimestampSource ?? null,
      handDetectionDurationMs: optionalFiniteNumber(
        freshestMeta.handDetectionDurationMs,
      ),
    },
  });
}

function resolvePoseGuidedHandPredictions(bodyFrame, options) {
  const poseLandmarks = Array.isArray(options.poseLandmarks)
    ? options.poseLandmarks
    : bodyFrame?.poseLandmarks;
  const currentAspectRatio = Number.isFinite(options.aspectRatio)
    ? options.aspectRatio
    : getInputAspectRatio();
  const excludedSides = new Set(options.excludedSides ?? []);
  const bySide = {};
  const observationBySide = {};
  const handResults = {};
  const usedSides = [];

  for (const side of HAND_OBSERVATION_SIDES) {
    if (excludedSides.has(side)) {
      state.handPipeline.lastPredictionAgeMsBySide[side] = null;
      continue;
    }
    const observation = state.handPipeline.lastObservedBySide[side];
    if (
      !observation ||
      observation.generation !== options.generation ||
      observation.mirrored !== Boolean(bodyFrame?.mirrored)
    ) {
      state.handPipeline.lastPredictionAgeMsBySide[side] = null;
      continue;
    }

    const result = transportPoseGuidedHandLandmarks({
      side,
      observedLandmarks: observation.landmarks,
      observedPoseLandmarks: observation.poseLandmarks,
      poseLandmarks,
      observedSourcePtsSec: observation.sourcePtsSec,
      sourcePtsSec: options.sourcePtsSec,
      observedAspectRatio: observation.aspectRatio,
      aspectRatio: currentAspectRatio,
      generation: options.generation,
      observedGeneration: observation.generation,
      maxAgeMs: HAND_POSE_GUIDED_FALLBACK_MAX_AGE_MS,
    });
    if (!result.valid) {
      state.handPipeline.lastPredictionAgeMsBySide[side] = null;
      continue;
    }

    const key = side.toLowerCase();
    bySide[side] = result;
    observationBySide[side] = observation;
    handResults[`${key}HandLandmarks`] = result.landmarks;
    handResults[`${key}HandWorldLandmarks`] = null;
    usedSides.push(side);
    state.handPipeline.lastPredictionAgeMsBySide[side] = result.ageMs;
  }

  return {
    bySide,
    observationBySide,
    handResults,
    usedSides,
  };
}

function countHandOutputSides(usedSides, heldSides = [], predictedSides = []) {
  for (const side of ["Left", "Right"]) {
    if (usedSides.includes(side)) {
      state.handPipeline.outputHitsBySide[side] += 1;
      if (heldSides.includes(side)) {
        state.handPipeline.outputHeldHitsBySide[side] += 1;
      }
    } else {
      state.handPipeline.outputDetectorMissesBySide[side] += 1;
    }
    if (predictedSides.includes(side)) {
      state.handPipeline.outputPredictedHitsBySide[side] += 1;
    }
    if (!usedSides.includes(side) && !predictedSides.includes(side)) {
      state.handPipeline.outputMissesBySide[side] += 1;
    }
  }
}

function mergeCachedHandsIntoBodyFrameWithoutCounting(bodyFrame) {
  return createMotionFrame({
    timestamp: bodyFrame.timestamp,
    mirrored: bodyFrame.mirrored,
    poseResults: motionFrameToPoseResults(bodyFrame),
    face: bodyFrame.face,
    sourceMeta: bodyFrame.sourceMeta,
  });
}

async function runDetectionFrame(timestamp, options = {}) {
  if (!state.active) {
    return null;
  }

  const managedByLatestFramePump = Boolean(options.managedByLatestFramePump);
  // Capture generation before any model load, bitmap creation, or worker await.
  // A live pump read after those boundaries could relabel older pixels.
  const inputGeneration = options.inputGeneration ?? getLatestFramePump().getGeneration();
  const callbackReceivedAt = nowMs();
  const callbackTimestamp = Number.isFinite(timestamp) ? timestamp : callbackReceivedAt;
  const pumpMode = options.pumpMode ?? state.detectionPump.activeMode;
  const rawSourcePtsSec = resolveDetectionSourcePts({
    video: state.elements.video,
    pumpMode,
    videoFrameMetadata: options.videoFrameMetadata,
  });
  if (!options.sourceTiming && shouldResetVideoTimeline(rawSourcePtsSec)) {
    if (!options.callbackRecorded) {
      recordDetectionCallback(callbackTimestamp);
      recordAppPerformanceSample(
        "frameCallbackLagMs",
        Math.max(0, callbackReceivedAt - callbackTimestamp),
      );
    }
    const timelineTransition = resetVideoTimelineState("rewind");
    const boundaryInputGeneration = getLatestFramePump().getGeneration();
    if (supportsDetectionFrameSnapshot()) {
      try {
        await nominateVideoGenerationBoundary("rewind", {
          timestamp: callbackTimestamp,
          callbackReceivedAt,
          pumpMode,
          videoFrameMetadata: options.videoFrameMetadata,
          callbackRecorded: true,
          resumeAfterApply: Boolean(
            timelineTransition?.videoPlaybackWasPlaying,
          ),
        });
        scheduleDetectionFrame();
      } catch (error) {
        failVideoGenerationBoundary(
          boundaryInputGeneration,
          error,
          "rewind-prepare",
        );
      }
    }
    return null;
  }
  const sourceTiming = options.sourceTiming ?? buildDetectionSourceTiming({
    video: state.elements.video,
    pumpMode,
    videoFrameMetadata: options.videoFrameMetadata,
    callbackTimestamp,
    callbackReceivedAt,
  });
  const frameOptions = options.sourceTiming
    ? options
    : { ...options, sourceTiming };
  const callbackLagMs = Math.max(0, callbackReceivedAt - callbackTimestamp);
  if (!options.callbackRecorded) {
    recordDetectionCallback(callbackTimestamp);
    recordAppPerformanceSample("frameCallbackLagMs", callbackLagMs);
  }

  if (!managedByLatestFramePump && state.detectionPump.busy) {
    state.detectionPump.busySkips += 1;
    state.detectionPump.pendingLatestFrame = {
      timestamp: callbackTimestamp,
      options: frameOptions,
    };
    scheduleDetectionFrame();
    return;
  }

  if (!options.staleChecked && shouldSkipStaleVideoFrameCallback(callbackLagMs, frameOptions)) {
    state.detectionPump.staleFrameCallbacks += 1;
    state.detectionPump.consecutiveStaleFrameCallbacks += 1;
    scheduleDetectionFrame();
    return;
  }

  if (!options.staleChecked) {
    state.detectionPump.consecutiveStaleFrameCallbacks = 0;
  }

  if (!managedByLatestFramePump) {
    state.detectionPump.busy = true;
  }
  const frameStartedAt = nowMs();
  const frameTimestamp = normalizeDetectionTimestamp(callbackTimestamp, frameStartedAt, callbackLagMs, frameOptions);
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

    const videoTime = optionalFiniteNumber(sourceTiming.sourcePtsSec)
      ?? Number(video.currentTime ?? 0);

    if (shouldResetVideoTimeline(videoTime)) {
      const timelineTransition = resetVideoTimelineState("rewind");
      const boundaryInputGeneration = getLatestFramePump().getGeneration();
      if (supportsDetectionFrameSnapshot()) {
        try {
          await nominateVideoGenerationBoundary("rewind", {
            timestamp: sourceTiming.callbackMonotonicMs,
            callbackReceivedAt: sourceTiming.callbackReceivedMonotonicMs,
            pumpMode: sourceTiming.pumpMode,
            callbackRecorded: true,
            resumeAfterApply: Boolean(
              timelineTransition?.videoPlaybackWasPlaying,
            ),
          });
          scheduleDetectionFrame();
        } catch (error) {
          failVideoGenerationBoundary(
            boundaryInputGeneration,
            error,
            "rewind-prepare",
          );
        }
      }
      return null;
    }

    if (videoTime === state.lastVideoTime) {
      state.detectionPump.duplicateFrames += 1;
      return;
    }

    state.lastVideoTime = videoTime;
    state.detectionPump.processedFrames += 1;
    recordAppPerformanceSample("frameAgeMs", nowMs() - frameTimestamp);

    resizeCanvasToVideoFrame();

    // Freeze the source synchronously before tracker refresh or lazy graph
    // work can yield. Completion is keyed to the last *applied* generation,
    // not detector preparation, so a worker response cannot resume playback
    // before its boundary frame reaches the avatar.
    if (state.inputKind === "video") {
      bodyTrackerPlaybackGate.begin({
        inputGeneration,
        media: video,
      });
    }

    const detectStartedAt = nowMs();
    const frameSource = options.frameSource ?? video;
    const motionFrame = await detectMotionFrameForVideo(
      frameSource,
      frameTimestamp,
      sourceTiming,
      inputGeneration,
    );
    if (inputGeneration !== getLatestFramePump().getGeneration()) {
      releaseBodyTrackerPlaybackGate(inputGeneration, "stale-result");
      return null;
    }
    recordAppPerformanceSample("detectMs", nowMs() - detectStartedAt);

    let faceSelection = null;
    const bodySourcePtsSec = optionalFiniteNumber(
      motionFrame?.sourceMeta?.sourcePtsSec,
    );
    if (
      bodySourcePtsSec !== null &&
      shouldUseIndependentFaceWorker()
    ) {
      faceSelection = await faceObservationMaturationLedger.waitForEligible({
        generation: inputGeneration,
        bodySourcePtsSec,
        applicationLagMs: FACE_OBSERVATION_DELAY_MS,
      });
      // Maturation can wait for a worker result or generation cancellation.
      // Recheck the Body owner before this fixed selection can reach apply.
      assertCurrentBodyInputGeneration(inputGeneration);
    }

    const result = {
      motionFrame,
      faceSelection,
      pumpMode,
      frameStartedAt,
      frameTimestamp,
      inputGeneration,
    };

    if (managedByLatestFramePump) {
      return result;
    }

    applyDetectionFrameResult(result);
    return result;
  } catch (error) {
    if (
      managedByLatestFramePump &&
      inputGeneration !== getLatestFramePump().getGeneration() &&
      isBodyInputGenerationTransitionError(error)
    ) {
      return null;
    }
    state.detectionPump.errors += 1;
    const failedBoundary = isActiveVideoBoundaryGeneration(inputGeneration);
    releaseBodyTrackerPlaybackGate(inputGeneration, "error", {
      resume: !failedBoundary,
    });
    if (failedBoundary) {
      failVideoGenerationBoundary(inputGeneration, error, "detection");
    }

    if (managedByLatestFramePump) {
      throw error;
    }

    shouldScheduleNext = false;
    setError(`Tracking failed: ${getErrorDetail(error)}`, "TRACKING_FAILED");
    setText("cameraStatus", "Failed");
    stopCamera({ preserveError: true, cameraStatus: "Failed" });
    return null;
  } finally {
    if (!managedByLatestFramePump) {
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
}

function applyDetectionFrameResult(result) {
  const inputGeneration = Number.isSafeInteger(result?.inputGeneration)
    ? result.inputGeneration
    : null;
  if (!result?.motionFrame || !state.active) {
    const failedBoundary = inputGeneration !== null &&
      isActiveVideoBoundaryGeneration(inputGeneration);
    if (inputGeneration !== null) {
      releaseBodyTrackerPlaybackGate(inputGeneration, "apply-skipped", {
        resume: state.active && !failedBoundary,
      });
    }
    if (failedBoundary) {
      failVideoGenerationBoundary(
        inputGeneration,
        new Error("the detection result had no motion frame"),
        "apply",
      );
    }
    closeDetectionFrameSource(result?.handFrameSource);
    if (result) {
      result.handFrameSource = null;
    }
    return false;
  }

  const processStartedAt = nowMs();
  let applied = false;
  try {
    const playbackGateMeta = inputGeneration !== null
      ? bodyTrackerPlaybackGate.buildFrameMeta(
        inputGeneration,
        "applied",
      )
      : null;
    if (playbackGateMeta?.bodyTrackerPlaybackGated) {
      result.motionFrame.sourceMeta = {
        ...(result.motionFrame.sourceMeta ?? {}),
        ...playbackGateMeta,
      };
    }
    result.handPoseLandmarks = result.motionFrame.poseLandmarks;
    const canonicalBodyFrame = adaptCanonicalSkeletonFrame(result.motionFrame);
    const bodyFrame = mergeCachedFaceIntoBodyFrame(
      canonicalBodyFrame,
      inputGeneration ?? getFaceFramePump().getGeneration(),
      result.faceSelection,
    );
    result.motionFrame = bodyFrame;
    const mergedFrame = mergeCachedHandsIntoBodyFrame(bodyFrame, {
      poseLandmarks: result.handPoseLandmarks,
      aspectRatio: getInputAspectRatio(),
    });
    const avatarStateApplied = processMotionFrame(mergedFrame, {
      record: true,
      forward: true,
      draw: state.debugOverlayEnabled,
      metrics: true,
      pumpMode: result.pumpMode,
    });
    if (!avatarStateApplied) {
      if (
        inputGeneration !== null &&
        playbackGateMeta?.bodyTrackerPlaybackGated
      ) {
        throw new Error("Avatar renderer did not accept the generation boundary frame.");
      }
      return false;
    }
    recordAppPerformanceSample("processMs", nowMs() - processStartedAt);
    recordAppPerformanceSample("frameTotalMs", nowMs() - result.frameStartedAt);
    state.detectionPump.outputFrames += 1;
    recordDetectionProcessedFrame(result.frameTimestamp);
    applied = true;
    return true;
  } finally {
    if (inputGeneration !== null) {
      if (applied) {
        const release = bodyTrackerPlaybackGate.completeApplied(inputGeneration);
        if (release && state.inputKind === "video" && state.videoFileName) {
          setText("cameraStatus", `Video running: ${state.videoFileName}`);
        }
      } else {
        const failedBoundary = isActiveVideoBoundaryGeneration(inputGeneration);
        releaseBodyTrackerPlaybackGate(inputGeneration, "apply-error", {
          resume: !failedBoundary,
        });
        if (failedBoundary) {
          failVideoGenerationBoundary(
            inputGeneration,
            new Error("avatar state application failed"),
            "apply",
          );
        }
      }
    }
    if (applied) {
      offerHandFrameAfterBody(result, result.motionFrame);
    } else {
      closeDetectionFrameSource(result.handFrameSource);
      result.handFrameSource = null;
      result.handPoseLandmarks = null;
    }
  }
}

async function detectMotionFrameForVideo(
  frameSource,
  frameTimestamp,
  sourceTiming,
  inputGeneration,
) {
  if (shouldUseTrackingWorker()) {
    try {
      const frame = await detectMotionFrameInWorker(
        frameSource,
        frameTimestamp,
        sourceTiming,
        inputGeneration,
      );
      state.trackingWorker.consecutiveDetectErrors = 0;
      if (state.trackingWorker.active) {
        state.trackingWorker.status = "ready";
      }
      return frame;
    } catch (error) {
      if (isBodyInputGenerationTransitionError(error)) {
        throw error;
      }
      // A worker ErrorEvent/messageerror already marks and disposes the worker.
      // Do not double-count the rejection of its pending detect request.
      if (state.trackingWorker.active) {
        state.trackingWorker.errors += 1;
        state.trackingWorker.detectErrors += 1;
        state.trackingWorker.consecutiveDetectErrors += 1;
        state.trackingWorker.status = "degraded";

        const shouldFallback = Boolean(
          error?.trackingWorkerFatal ||
            state.trackingWorker.consecutiveDetectErrors >=
              MAX_CONSECUTIVE_TRACKING_WORKER_DETECT_ERRORS
        );
        if (shouldFallback) {
          markTrackingWorkerFallback(error, { countError: false });
        }
      }

      if (
        isFrozenDetectionFrameSource(frameSource) &&
        error?.trackingWorkerFrameTransferred
      ) {
        state.detectionPump.workerFallbackFrameDrops += 1;
        throw new Error(`Tracking worker failed for a frozen frame; the frame was dropped before main-thread fallback: ${getErrorDetail(error)}`);
      }
    }
  }

  return detectMotionFrameOnMainThread(
    frameSource,
    frameTimestamp,
    sourceTiming,
    inputGeneration,
  );
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

function buildDetectionSourceTiming({
  video,
  pumpMode,
  videoFrameMetadata,
  callbackTimestamp,
  callbackReceivedAt,
}) {
  const metadata = videoFrameMetadata ?? {};
  const mediaTime = optionalFiniteNumber(metadata.mediaTime);
  const currentVideoTime = optionalFiniteNumber(video?.currentTime) ?? 0;
  const useRvfcMediaTime = Boolean(
    pumpMode === DETECTION_PUMP_RVFC &&
      state.inputKind === "video" &&
      mediaTime !== null
  );
  const sourcePtsSec = resolveDetectionSourcePts({
    video,
    pumpMode,
    videoFrameMetadata,
  });
  const captureMonotonicMs = optionalFiniteNumber(metadata.captureTime);
  const metadataReceiveMonotonicMs = optionalFiniteNumber(metadata.receiveTime);
  const callbackMonotonicMs = optionalFiniteNumber(callbackTimestamp) ?? callbackReceivedAt;
  const callbackReceivedMonotonicMs = optionalFiniteNumber(callbackReceivedAt) ?? callbackMonotonicMs;
  const receiveMonotonicMs = metadataReceiveMonotonicMs ?? callbackReceivedMonotonicMs;

  return {
    videoTime: sourcePtsSec,
    sourcePtsSec,
    sourcePtsSource: useRvfcMediaTime
      ? "rvfc-media-time"
      : sourcePtsFallbackSource(pumpMode),
    pumpMode,
    callbackMonotonicMs,
    callbackReceivedMonotonicMs,
    captureMonotonicMs,
    receiveMonotonicMs,
    captureMonotonicSource: captureMonotonicMs !== null
      ? "rvfc-metadata-capture-time"
      : "unavailable",
    receiveMonotonicSource: metadataReceiveMonotonicMs !== null
      ? "rvfc-metadata-receive-time"
      : "callback-received",
  };
}

function resolveDetectionSourcePts({ video, pumpMode, videoFrameMetadata } = {}) {
  const mediaTime = optionalFiniteNumber(videoFrameMetadata?.mediaTime);
  if (
    pumpMode === DETECTION_PUMP_RVFC &&
    state.inputKind === "video" &&
    mediaTime !== null
  ) {
    return mediaTime;
  }
  return optionalFiniteNumber(video?.currentTime) ?? 0;
}

function sourcePtsFallbackSource(pumpMode) {
  if (state.inputKind === "camera") {
    return "video-current-time-camera-fallback";
  }

  if (pumpMode === DETECTION_PUMP_RAF) {
    return "video-current-time-raf-fallback";
  }

  return "video-current-time-rvfc-fallback";
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shouldUseTrackingWorker() {
  return Boolean(
    state.trackingWorker.requested &&
      state.trackingWorker.supported &&
      state.trackingWorker.active &&
      state.trackingWorker.worker,
  );
}

function prepareBodyTrackerGeneration(inputGeneration, { runtime } = {}) {
  assertCurrentBodyInputGeneration(inputGeneration);
  const selectedRuntime = runtime ?? (shouldUseTrackingWorker() ? "worker" : "main-thread");
  const selectedPoseModelKey = getSelectedPoseModelKey();
  const configurationKey = selectedRuntime === "worker"
    ? state.trackingWorker.configurationKey
    : getMainThreadTrackerConfigurationKey(selectedPoseModelKey);
  const preparationKey = JSON.stringify([
    inputGeneration,
    selectedRuntime,
    configurationKey,
  ]);
  const existing = bodyGenerationPreparations.get(preparationKey);
  if (existing) {
    return existing;
  }

  const preparation = (async () => {
    if (selectedRuntime === "worker") {
      if (!shouldUseTrackingWorker()) {
        const error = new Error("Tracking worker became unavailable before generation preparation.");
        error.code = "BODY_INPUT_GENERATION_STALE";
        throw error;
      }
      return prepareTrackingWorkerGeneration(inputGeneration);
    }

    await ensureMainThreadModelsReady(selectedPoseModelKey);
    assertCurrentBodyInputGeneration(inputGeneration);
    return prepareMainThreadVideoTrackers(inputGeneration);
  })();
  // Keep both fulfillment and rejection cached for this exact generation and
  // runtime configuration. A boundary retry must await the same outcome; only
  // generation advancement is allowed to supersede it.
  bodyGenerationPreparations.set(preparationKey, preparation);
  return preparation;
}

async function detectMotionFrameInWorker(
  frameSource,
  frameTimestamp,
  sourceTiming,
  inputGeneration,
) {
  assertCurrentBodyInputGeneration(inputGeneration);
  const bodyTrackerGenerationMeta = await prepareBodyTrackerGeneration(
    inputGeneration,
    { runtime: "worker" },
  );
  assertCurrentBodyInputGeneration(inputGeneration);

  const isImageBitmap = typeof ImageBitmap === "function" && frameSource instanceof ImageBitmap;
  const ownsImageBitmap = !isImageBitmap;
  const imageBitmap = isImageBitmap
    ? frameSource
    : await createImageBitmap(frameSource);
  let frameTransferred = false;

  try {
    assertCurrentBodyInputGeneration(inputGeneration);
    const request = postTrackingWorkerRequest(
      "detect",
      {
        imageBitmap,
        timestamp: frameTimestamp,
        mirrored: Boolean(state.elements.mirrorToggle?.checked),
        inputGeneration,
        configurationKey: state.trackingWorker.configurationKey,
        sourceMeta: getCurrentMotionSourceMeta("worker", sourceTiming, {
          inputGeneration,
          bodyTrackerGenerationMeta,
        }),
      },
      [imageBitmap],
    );
    frameTransferred = true;
    const response = await request;
    assertCurrentBodyInputGeneration(inputGeneration);
    if (
      response.inputGeneration !== inputGeneration ||
      response.configurationKey !== state.trackingWorker.configurationKey ||
      response.frame?.sourceMeta?.inputGeneration !== inputGeneration
    ) {
      const error = new Error("Tracking worker returned a stale generation or Pose configuration.");
      error.code = "BODY_INPUT_GENERATION_STALE";
      throw error;
    }
    recordBodyTrackerGenerationMeta(response.frame?.sourceMeta);
    state.trackingWorker.frames += 1;

    return response.frame;
  } catch (error) {
    if (!frameTransferred && ownsImageBitmap) {
      try {
        imageBitmap.close?.();
      } catch {
        // The frame may already have been transferred to the worker.
      }
    }
    error.trackingWorkerFrameTransferred = frameTransferred;
    throw error;
  }
}

async function prepareTrackingWorkerGeneration(inputGeneration) {
  if (
    state.trackingWorker.preparedGeneration === inputGeneration &&
    state.trackingWorker.preparedGenerationMeta
  ) {
    return state.trackingWorker.preparedGenerationMeta;
  }

  const response = await postTrackingWorkerRequest("prepare-generation", {
    inputGeneration,
    configurationKey: state.trackingWorker.configurationKey,
  });
  assertCurrentBodyInputGeneration(inputGeneration);
  if (response.inputGeneration !== inputGeneration) {
    throw new Error(
      `Tracking worker prepared mismatched generation ${String(response.inputGeneration)}.`,
    );
  }
  if (response.configurationKey !== state.trackingWorker.configurationKey) {
    throw new Error("Tracking worker prepared a mismatched Pose configuration.");
  }

  const generationMeta = response.bodyTrackerGenerationMeta ?? null;
  state.trackingWorker.preparedGeneration = inputGeneration;
  state.trackingWorker.preparedGenerationMeta = generationMeta;
  state.trackingWorker.detectorDelegates = response.detectorDelegates ??
    state.trackingWorker.detectorDelegates;
  mergeTrackingWorkerDelegateTelemetry(response.detectorDelegates);
  recordBodyTrackerGenerationMeta(generationMeta);
  return generationMeta;
}

async function detectMotionFrameOnMainThread(
  frameSource,
  frameTimestamp,
  sourceTiming,
  inputGeneration,
) {
  assertCurrentBodyInputGeneration(inputGeneration);
  await ensureMainThreadModelsReady(getSelectedPoseModelKey());
  const callbackReceivedAt = optionalFiniteNumber(
    sourceTiming?.callbackReceivedMonotonicMs,
  );
  if (
    isFrozenDetectionFrameSource(frameSource) &&
    sourceTiming?.bodyCadenceAdmissionReason !== "generation-boundary" &&
    callbackReceivedAt !== null &&
    nowMs() - callbackReceivedAt > MAX_PENDING_FRAME_AGE_MS
  ) {
    state.detectionPump.preInferenceStaleDrops += 1;
    throw new Error("Main-thread fallback dropped a frozen frame that became stale during lazy model loading.");
  }
  assertCurrentBodyInputGeneration(inputGeneration);
  const bodyTrackerGenerationMeta = await prepareBodyTrackerGeneration(
    inputGeneration,
    { runtime: "main-thread" },
  );
  // The same-mode graph refresh is asynchronous. A seek or input switch that
  // lands during it must still prevent the older pixels from reaching detect.
  assertCurrentBodyInputGeneration(inputGeneration);
  const poseResults = state.poseLandmarker.detectForVideo(
    frameSource,
    frameTimestamp,
  );
  const face = detectFaceForVideo(frameSource, frameTimestamp);

  return createMotionFrame({
    timestamp: frameTimestamp,
    mirrored: Boolean(state.elements.mirrorToggle?.checked),
    poseResults,
    face,
    sourceMeta: getCurrentMotionSourceMeta("main-thread", sourceTiming, {
      inputGeneration,
      bodyTrackerGenerationMeta,
    }),
  });
}

function assertCurrentBodyInputGeneration(inputGeneration) {
  const currentGeneration = getLatestFramePump().getGeneration();
  if (
    !Number.isSafeInteger(inputGeneration) ||
    inputGeneration < 0 ||
    inputGeneration !== currentGeneration
  ) {
    const error = new Error(
      `Body tracker rejected stale input generation ${String(inputGeneration)}; current generation is ${currentGeneration}.`,
    );
    error.code = "BODY_INPUT_GENERATION_STALE";
    throw error;
  }
}

function isBodyInputGenerationTransitionError(error) {
  return new Set([
    "BODY_INPUT_GENERATION_STALE",
    "VIDEO_TRACKER_GENERATION_STALE",
    "VIDEO_TRACKER_GENERATION_SUPERSEDED",
  ]).has(String(error?.code ?? ""));
}

async function prepareMainThreadVideoTrackers(inputGeneration) {
  try {
    const selectedPoseModelKey = getSelectedPoseModelKey();
    const generationMeta = await mainThreadBodyTrackerGenerationOwner.prepare({
      inputGeneration,
      configurationKey: getMainThreadTrackerConfigurationKey(
        selectedPoseModelKey,
      ),
      detectorStateResets: createMainThreadPoseStateResets(),
      detectorFactories: createMainThreadDetectorFactories(
        selectedPoseModelKey,
      ),
    });
    assertCurrentBodyInputGeneration(inputGeneration);
    applyMainThreadPreparedDetectorSet(
      mainThreadBodyTrackerGenerationOwner.getPreparedSet(inputGeneration),
      selectedPoseModelKey,
    );
    recordBodyTrackerGenerationMeta(generationMeta);
    return generationMeta;
  } catch (error) {
    recordBodyTrackerGenerationMeta(
      error?.bodyTrackerGenerationMeta ??
        mainThreadBodyTrackerGenerationOwner.getTelemetry(),
    );
    throw error;
  }
}

function isFrozenDetectionFrameSource(value) {
  return typeof ImageBitmap === "function" && value instanceof ImageBitmap;
}

function detectFaceForVideo(frameSource, frameTimestamp) {
  if (!state.faceTracking.enabled || !state.faceLandmarker) {
    return null;
  }

  const detectStartedAt = nowMs();
  let faceResults = null;

  try {
    faceResults = state.faceLandmarker.detect(frameSource);
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

  const avatarStateApplied = presence.shouldUpdateAvatar
    ? updateAvatarRendererFromMotionFrame(processedFrame)
    // Holding the already-applied rest/last-valid state is the explicit
    // product policy for an absent person; it is valid only after the current
    // renderer has completed model initialization successfully.
    : state.avatarReady;
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

  return avatarStateApplied;
}

function updateAvatarRendererFromMotionFrame(motionFrame) {
  if (!state.avatarRenderer) {
    return false;
  }

  try {
    state.avatarRenderer.update({
      motionFrame,
      mirrored: motionFrame.mirrored,
      timestamp: motionFrame.timestamp,
    });
    const appliedAvatarState = state.avatarRenderer.getAppliedAvatarStateSnapshot?.();
    return Boolean(matchingAppliedAvatarState(motionFrame, appliedAvatarState));
  } catch (error) {
    setAvatarStatus(`Failed: ${getErrorDetail(error)}`);
    console.warn("Avatar update failed.", error);
    return false;
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
    const appliedAvatarStateCandidate = state.avatarRenderer.getAppliedAvatarStateSnapshot?.()
      ?? motionStateSnapshot?.appliedAvatarState
      ?? null;
    const appliedAvatarState = matchingAppliedAvatarState(
      motionFrame,
      appliedAvatarStateCandidate,
    );
    const sourcePtsSec = motionFrameSourcePtsSec(motionFrame);
    const sample = {
      timestamp: motionFrame.timestamp,
      sourceTimestampMs: optionalFiniteNumber(motionFrame.timestamp),
      videoTime: sourcePtsSec ?? Number(state.elements.video?.currentTime ?? 0),
      sourcePtsSec,
      sourcePtsSource: motionFrame.sourceMeta?.sourcePtsSource ?? null,
      sourceTiming: {
        pumpMode: motionFrame.sourceMeta?.pumpMode ?? null,
        timingSource: motionFrame.sourceMeta?.timingSource ?? null,
        callbackMonotonicMs: optionalFiniteNumber(motionFrame.sourceMeta?.callbackMonotonicMs),
        callbackReceivedMonotonicMs: optionalFiniteNumber(motionFrame.sourceMeta?.callbackReceivedMonotonicMs),
        captureMonotonicMs: optionalFiniteNumber(motionFrame.sourceMeta?.captureMonotonicMs),
        receiveMonotonicMs: optionalFiniteNumber(motionFrame.sourceMeta?.receiveMonotonicMs),
        captureMonotonicSource: motionFrame.sourceMeta?.captureMonotonicSource ?? null,
        receiveMonotonicSource: motionFrame.sourceMeta?.receiveMonotonicSource ?? null,
      },
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
      footContact: motionStateSnapshot?.footContact ?? null,
      faceHeadPose: motionStateSnapshot?.faceHeadPose ?? null,
      retargetMode: motionStateSnapshot?.retargetMode ?? null,
      handOrientation: motionStateSnapshot?.handOrientation ?? null,
      sourceAvatarDivergence: motionStateSnapshot?.sourceAvatarDivergence ?? null,
      appliedAvatarState,
    };

    state.bodyValidation.lastSample = sample;
    state.bodyValidation.samples.push(sample);
    if (sample.segments.length > 0) {
      state.bodyValidation.framesWithPose += 1;
    }

    if (state.bodyValidation.samples.length > 5000) {
      const removedSamples = state.bodyValidation.samples.splice(
        0,
        state.bodyValidation.samples.length - 5000,
      );
      state.bodyValidation.framesWithPose = Math.max(
        0,
        state.bodyValidation.framesWithPose - removedSamples.filter(
          (removedSample) => removedSample.segments.length > 0,
        ).length,
      );
    }
  } catch (error) {
    console.warn("Body validation sample skipped.", error);
  }
}

function motionFrameSourcePtsSec(motionFrame) {
  return optionalFiniteNumber(
    motionFrame?.sourceMeta?.sourcePtsSec ?? motionFrame?.sourceMeta?.videoTime,
  );
}

function matchingAppliedAvatarState(motionFrame, candidate) {
  const sourceTimestampMs = optionalFiniteNumber(motionFrame?.timestamp);
  const sourcePtsSec = motionFrameSourcePtsSec(motionFrame);
  const candidateTimestampMs = optionalFiniteNumber(candidate?.timing?.sourceTimestampMs);
  const candidateSourcePtsSec = optionalFiniteNumber(candidate?.timing?.sourcePtsSec);

  if (
    sourceTimestampMs === null ||
    sourcePtsSec === null ||
    candidateTimestampMs === null ||
    candidateSourcePtsSec === null
  ) {
    return null;
  }

  if (
    candidateTimestampMs !== sourceTimestampMs ||
    candidateSourcePtsSec !== sourcePtsSec
  ) {
    return null;
  }

  return candidate;
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
  const processedFrames = Number(pump.outputFrames ?? pump.processedFrames ?? 0);
  const droppedFrameWork = Number(pump.overloadDrops ?? 0) +
    Number(pump.staleQueuedDrops ?? 0) +
    Number(pump.staleResultDrops ?? 0) +
    Number(pump.staleFrameCallbacks ?? 0) +
    Number(pump.snapshotErrors ?? 0) +
    Number(pump.preInferenceStaleDrops ?? 0) +
    Number(pump.postInferenceStaleDrops ?? 0);
  const dropDenominator = Number(pump.callbacks ?? 0);
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
    postInferenceStaleDrops: pump.postInferenceStaleDrops ?? 0,
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
  configureHandWorkerRuntime();
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

function configureHandWorkerRuntime() {
  const requested = getInitialHandWorkerEnabled();
  state.handWorker.requested = requested;
  state.handWorker.supported = supportsTrackingWorker();

  if (!requested) {
    disposeHandWorker();
    for (const side of HAND_OBSERVATION_SIDES) {
      getHandWorkerSideRuntime(side).status = "disabled";
    }
    refreshHandWorkerAggregateState();
    return;
  }
  if (!state.handWorker.supported) {
    for (const side of HAND_OBSERVATION_SIDES) {
      disposeHandWorkerSide(side);
      const runtime = getHandWorkerSideRuntime(side);
      runtime.status = "unsupported";
      runtime.lastError = "Worker, createImageBitmap, or OffscreenCanvas is unavailable.";
    }
    refreshHandWorkerAggregateState();
    return;
  }
  for (const side of HAND_OBSERVATION_SIDES) {
    const runtime = getHandWorkerSideRuntime(side);
    if (runtime.status === "disabled" || runtime.status === "unsupported") {
      runtime.status = "requested";
      runtime.lastError = "";
    }
  }
  refreshHandWorkerAggregateState();
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
  const supportsExactRvfcPump = supportsVideoFrameCallback() && supportsDetectionFrameSnapshot();

  if (requestedMode === DETECTION_PUMP_RAF) {
    return DETECTION_PUMP_RAF;
  }

  if (requestedMode === DETECTION_PUMP_RVFC) {
    return supportsExactRvfcPump ? DETECTION_PUMP_RVFC : DETECTION_PUMP_RAF;
  }

  return supportsExactRvfcPump ? DETECTION_PUMP_RVFC : DETECTION_PUMP_RAF;
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
  state.detectionPump.outputFrames = 0;
  state.detectionPump.snapshotFrames = 0;
  state.detectionPump.snapshotErrors = 0;
  state.detectionPump.preInferenceStaleDrops = 0;
  state.detectionPump.postInferenceStaleDrops = 0;
  state.detectionPump.lastPostInferenceStaleDrop = null;
  state.detectionPump.workerFallbackFrameDrops = 0;
  state.detectionPump.timelineResets = 0;
  state.detectionPump.lastTimelineResetReason = "";
  state.detectionPump.consecutiveStaleFrameCallbacks = 0;
  state.detectionPump.lastOfferedSourcePtsSec = null;
  state.detectionPump.lastAdmittedSourcePtsSec = null;
  state.detectionPump.lastBodyCadenceAdmissionReason = "";
  state.detectionPump.bodyCadenceSkips = 0;
  state.detectionPump.errors = 0;
  state.detectionPump.supportsVideoFrameCallback = supportsVideoFrameCallback();
  state.detectionPump.activeMode = resolveDetectionPumpMode();
  getLatestFramePump().resetTelemetry();
  videoPlaybackBackpressure.resetTelemetry();
  auxiliaryInferenceArbiter.resetTelemetry();
  getFaceFramePump().resetTelemetry();
  faceObservationMaturationLedger.resetTelemetry();
  getHandFrameFanOutPump().resetTelemetry();
  for (const side of HAND_OBSERVATION_SIDES) {
    getHandSideFramePump(side).resetTelemetry();
  }
  state.appPerformance.startedAt = nowMs();
  state.appPerformance.lastCallbackTimestamp = 0;
  state.appPerformance.lastProcessedTimestamp = 0;
  state.appPerformance.callbackIntervalsMs.length = 0;
  state.appPerformance.detectIntervalsMs.length = 0;
  state.appPerformance.detectMs.length = 0;
  state.appPerformance.faceDetectMs.length = 0;
  state.appPerformance.faceProcessMs.length = 0;
  state.appPerformance.handDetectMs.length = 0;
  state.appPerformance.handRoundTripMs.length = 0;
  state.appPerformance.handTrackerResetMs.length = 0;
  state.appPerformance.bodyTrackerResetMs.length = 0;
  state.appPerformance.processMs.length = 0;
  state.appPerformance.drawMs.length = 0;
  state.appPerformance.frameTotalMs.length = 0;
  state.appPerformance.frameAgeMs.length = 0;
  state.appPerformance.frameCallbackLagMs.length = 0;
  state.faceTracking.detectFrames = 0;
  state.faceTracking.facesDetected = 0;
  state.faceTracking.lastTimestamp = 0;
  state.faceWorker.requests = 0;
  state.faceWorker.frames = 0;
  state.faceWorker.detectErrors = 0;
  state.faceWorker.errors = 0;
  state.faceWorker.timeouts = 0;
  state.facePipeline.snapshots = 0;
  state.facePipeline.snapshotErrors = 0;
  state.facePipeline.cadenceSkips = 0;
  state.facePipeline.unavailableSkips = 0;
  state.facePipeline.preInferenceStaleDrops = 0;
  state.facePipeline.cacheHits = 0;
  state.facePipeline.cacheMisses = 0;
  state.facePipeline.cacheExpired = 0;
  state.facePipeline.cacheFuture = 0;
  // This API resets telemetry only. Face observations and their generation-
  // scoped slot phase are product state; clearing them here would make a
  // measurement-window boundary change the avatar's causal input.
  state.trackingWorker.handDetectionFrames = 0;
  state.trackingWorker.handCadenceSkips = 0;
  state.trackingWorker.handDetectionAgeMs = null;
  state.trackingWorker.handCadenceIntervalMs = null;
  state.trackingWorker.detectErrors = 0;
  state.trackingWorker.consecutiveDetectErrors = 0;
  state.handWorker.requests = 0;
  state.handWorker.frames = 0;
  state.handWorker.roiUnavailable = 0;
  state.handWorker.roiRecommits = 0;
  state.handWorker.heldPoseRoiSides = 0;
  state.handWorker.trackerResets = 0;
  state.handWorker.staleSourcePtsSkips = 0;
  state.handWorker.lastRoiEpisodeReasons = "";
  state.handWorker.lastTrackerResetSides = "";
  state.handWorker.lastRoiTransformVersionBySide = { Left: 0, Right: 0 };
  state.handWorker.lastRoiExpansionLevelBySide = { Left: 0, Right: 0 };
  state.handWorker.lastRoiMissStreakBySide = { Left: 0, Right: 0 };
  state.handWorker.detectErrors = 0;
  state.handWorker.errors = 0;
  state.handWorker.timeouts = 0;
  for (const side of HAND_OBSERVATION_SIDES) {
    const runtime = getHandWorkerSideRuntime(side);
    for (const key of [
      "requests",
      "frames",
      "roiUnavailable",
      "roiRecommits",
      "heldPoseRoiSides",
      "trackerResets",
      "staleSourcePtsSkips",
      "detectErrors",
      "errors",
      "timeouts",
      "preInferenceStaleDrops",
    ]) {
      runtime[key] = 0;
    }
    runtime.lastRoiEpisodeReasons = "";
    runtime.lastTrackerResetSides = "";
    runtime.lastRoiTransformVersion = 0;
    runtime.lastRoiExpansionLevel = 0;
    runtime.lastRoiMissStreak = 0;
    runtime.roundTripMs.length = 0;
    runtime.detectionMs.length = 0;
    runtime.trackerResetMs.length = 0;
    runtime.lastRoundTripMs = null;
    runtime.lastDetectionMs = null;
  }
  state.handPipeline.lastSnapshotAt = null;
  state.handPipeline.lastSnapshotSourcePtsSec = null;
  state.handPipeline.snapshots = 0;
  state.handPipeline.cadenceSkips = 0;
  state.handPipeline.unavailableSkips = 0;
  state.handPipeline.snapshotErrors = 0;
  state.handPipeline.preInferenceStaleDrops = 0;
  state.handPipeline.cache = null;
  state.handPipeline.cacheHits = 0;
  state.handPipeline.cacheMisses = 0;
  state.handPipeline.cacheExpired = 0;
  state.handPipeline.cacheFuture = 0;
  state.handPipeline.nullResults = 0;
  state.handPipeline.heldNullResults = 0;
  state.handPipeline.singleSideResults = 0;
  state.handPipeline.detectionHitsBySide = { Left: 0, Right: 0 };
  state.handPipeline.detectionMissesBySide = { Left: 0, Right: 0 };
  state.handPipeline.outputHitsBySide = { Left: 0, Right: 0 };
  state.handPipeline.outputHeldHitsBySide = { Left: 0, Right: 0 };
  state.handPipeline.outputPredictedHitsBySide = { Left: 0, Right: 0 };
  state.handPipeline.outputDetectorMissesBySide = { Left: 0, Right: 0 };
  state.handPipeline.outputMissesBySide = { Left: 0, Right: 0 };
  state.handPipeline.lastObservedBySide = { Left: null, Right: null };
  state.handPipeline.lastPredictionAgeMsBySide = { Left: null, Right: null };
  state.handPipeline.lastAttemptSourcePtsSec = { Left: null, Right: null };
  state.handPipeline.lastCacheAgeMs = null;
  state.handPipeline.bodyFramesConsidered = 0;
  state.handPipeline.cloneAttempts = 0;
  state.handPipeline.cloneFailures = 0;
  state.handPipeline.fanOutDispatchesBySide = { Left: 0, Right: 0 };
  state.handPipeline.fanOutSkipsBySide = { Left: 0, Right: 0 };
  state.handPipeline.aggregateRequestKeys.clear();
  state.handPipeline.aggregateFrameKeys.clear();
  state.handPipeline.aggregateOutcomesByFrame.clear();
  refreshHandWorkerAggregateState();

  if (
    state.faceTracking.enabled &&
    (state.faceWorker.active || state.faceLandmarker) &&
    state.faceTracking.status !== "failed"
  ) {
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
  const latestFrameStatus = getLatestFramePump().getStatus();
  const callbackRate = activeFrameRateFromIntervals(
    state.appPerformance.callbackIntervalsMs,
  );
  const detectionRate = activeFrameRateFromIntervals(
    state.appPerformance.detectIntervalsMs,
  );
  const callbackActiveSeconds = sumFiniteSamples(
    state.appPerformance.callbackIntervalsMs,
  ) / 1000;

  return {
    measurementWindow: {
      elapsedMs,
      callbackActiveMs: callbackActiveSeconds * 1000,
    },
    pump: {
      requestedMode: state.detectionPump.requestedMode,
      activeMode: state.detectionPump.activeMode,
      supportsVideoFrameCallback: state.detectionPump.supportsVideoFrameCallback,
      callbacks: state.detectionPump.callbacks,
      processedFrames: state.detectionPump.processedFrames,
      outputFrames: state.detectionPump.outputFrames,
      duplicateFrames: state.detectionPump.duplicateFrames,
      emptyFrames: state.detectionPump.emptyFrames,
      busySkips: state.detectionPump.busySkips,
      latestWinsFrames: state.detectionPump.latestWinsFrames,
      staleFrameCallbacks: state.detectionPump.staleFrameCallbacks,
      snapshotFrames: state.detectionPump.snapshotFrames,
      snapshotErrors: state.detectionPump.snapshotErrors,
      snapshotSupported: supportsDetectionFrameSnapshot(),
      snapshotMode: "offscreen-bounded-image-bitmap",
      maxInferenceFrameDimension: MAX_INFERENCE_FRAME_DIMENSION,
      preInferenceStaleDrops: state.detectionPump.preInferenceStaleDrops,
      postInferenceStaleDrops:
        state.detectionPump.postInferenceStaleDrops,
      lastPostInferenceStaleDrop:
        state.detectionPump.lastPostInferenceStaleDrop,
      workerFallbackFrameDrops: state.detectionPump.workerFallbackFrameDrops,
      bodyCadenceMaxRateHz: BODY_DETECTION_RATE_HZ,
      bodyCadenceSkips: state.detectionPump.bodyCadenceSkips,
      lastAdmittedSourcePtsSec: state.detectionPump.lastAdmittedSourcePtsSec,
      lastBodyCadenceAdmissionReason:
        state.detectionPump.lastBodyCadenceAdmissionReason,
      generation: latestFrameStatus.generation,
      offeredFrames: latestFrameStatus.offered,
      startedFrames: latestFrameStatus.started,
      appliedFrames: latestFrameStatus.applied,
      overloadDrops: latestFrameStatus.overloadDrops,
      staleQueuedDrops: latestFrameStatus.staleQueuedDrops,
      staleResultDrops: latestFrameStatus.staleResultDrops,
      consumeErrors: latestFrameStatus.consumeErrors,
      applyErrors: latestFrameStatus.applyErrors,
      queuedTransitions: latestFrameStatus.queuedTransitions,
      replacedTransitions: latestFrameStatus.replacedTransitions,
      promotedTransitions: latestFrameStatus.promotedTransitions,
      settledTransitions: latestFrameStatus.settledTransitions,
      droppedTransitions: latestFrameStatus.droppedTransitions,
      transitionErrors: latestFrameStatus.transitionErrors,
      queueDepth: latestFrameStatus.queueDepth,
      maxQueueDepth: latestFrameStatus.maxQueueDepth,
      inFlight: latestFrameStatus.inFlight,
      timelineResets: state.detectionPump.timelineResets,
      lastTimelineResetReason: state.detectionPump.lastTimelineResetReason,
      hasPendingLatestFrame: Boolean(state.detectionPump.pendingLatestFrame) || latestFrameStatus.queueDepth > 0,
      errors: state.detectionPump.errors,
      debugOverlayEnabled: state.debugOverlayEnabled,
    },
    videoPlaybackBackpressure: videoPlaybackBackpressure.getStatus(),
    trackingWorker: getTrackingWorkerStatus(),
    bodyTracker: getBodyTrackerStatus(),
    auxiliaryInference: auxiliaryInferenceArbiter.getStatus(),
    handWorker: getHandWorkerStatus(),
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
      callback: callbackRate,
      inference: detectionRate,
      detection: detectionRate,
      hand: callbackActiveSeconds > 0
        ? state.handWorker.frames / callbackActiveSeconds
        : 0,
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
      handDetect: summarizeAppPerformanceSamples(state.appPerformance.handDetectMs),
      handRoundTrip: summarizeAppPerformanceSamples(state.appPerformance.handRoundTripMs),
      handTrackerReset: summarizeAppPerformanceSamples(
        state.appPerformance.handTrackerResetMs,
      ),
      bodyTrackerReset: summarizeAppPerformanceSamples(
        state.appPerformance.bodyTrackerResetMs,
      ),
      process: summarizeAppPerformanceSamples(state.appPerformance.processMs),
      draw: summarizeAppPerformanceSamples(state.appPerformance.drawMs),
      frameTotal: summarizeAppPerformanceSamples(state.appPerformance.frameTotalMs),
      frameAge: summarizeAppPerformanceSamples(state.appPerformance.frameAgeMs),
      frameCallbackLag: summarizeAppPerformanceSamples(state.appPerformance.frameCallbackLagMs),
    },
  };
}

function activeFrameRateFromIntervals(samples) {
  const sampleCount = Array.isArray(samples) ? samples.length : 0;
  const totalMs = sumFiniteSamples(samples);
  return totalMs > 0 ? sampleCount * 1000 / totalMs : 0;
}

function sumFiniteSamples(samples) {
  return (samples ?? []).reduce(
    (total, sample) => total + (Number.isFinite(sample) && sample > 0 ? sample : 0),
    0,
  );
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
  const detectorDelegates = mergeTrackingWorkerDetectorDelegates();
  return {
    requested: state.trackingWorker.requested,
    supported: state.trackingWorker.supported,
    active: state.trackingWorker.active,
    status: state.trackingWorker.status,
    poseModelKey: state.trackingWorker.poseModelKey,
    faceTrackingEnabled: state.faceTracking.enabled,
    faceLandmarksEnabled: state.faceTracking.landmarksEnabled,
    faceWorkerActive: state.faceWorker.active,
    faceWorkerStatus: state.faceWorker.status,
    frames: state.trackingWorker.frames,
    handDetectionFrames: state.handWorker.frames,
    handCadenceSkips: state.handPipeline.cadenceSkips,
    handDetectionAgeMs: state.handPipeline.lastCacheAgeMs,
    handCadenceIntervalMs: HAND_DETECTION_INTERVAL_MS,
    detectErrors: state.trackingWorker.detectErrors,
    consecutiveDetectErrors: state.trackingWorker.consecutiveDetectErrors,
    errors: state.trackingWorker.errors,
    fallbacks: state.trackingWorker.fallbacks,
    pendingRequests: state.trackingWorker.pendingRequests.size,
    preparedGeneration: state.trackingWorker.preparedGeneration,
    fallbackReason: state.trackingWorker.fallbackReason,
    detectorDelegates,
  };
}

function getBodyTrackerStatus() {
  return {
    generation: state.bodyTracker.generation,
    resetCount: state.bodyTracker.resetCount,
    resetDetectors: [...state.bodyTracker.resetDetectors],
    resetDurationMs: state.bodyTracker.resetDurationMs,
    seededDetectors: [...state.bodyTracker.seededDetectors],
    cumulativeResets: state.bodyTracker.cumulativeResets,
    resetErrors: state.bodyTracker.resetErrors,
    lastGeneration: state.bodyTracker.lastGeneration,
    resetStrategy: state.bodyTracker.resetStrategy,
    detectorEpoch: state.bodyTracker.detectorEpoch,
    recreateCount: state.bodyTracker.recreateCount,
    recreateDetectors: [...state.bodyTracker.recreateDetectors],
    recreateDurationMs: state.bodyTracker.recreateDurationMs,
    recreateErrors: state.bodyTracker.recreateErrors,
    closeErrors: state.bodyTracker.closeErrors,
    poolSize: state.bodyTracker.poolSize,
    poolCleanCount: state.bodyTracker.poolCleanCount,
    poolPrewarmedCount: state.bodyTracker.poolPrewarmedCount,
    poolPrimeDurationMs: state.bodyTracker.poolPrimeDurationMs,
    poolPrimeSlot0DurationMs: state.bodyTracker.poolPrimeSlot0DurationMs,
    poolPrimeSlot1DurationMs: state.bodyTracker.poolPrimeSlot1DurationMs,
    prewarmedSwapCount: state.bodyTracker.prewarmedSwapCount,
    dirtyLeaseCount: state.bodyTracker.dirtyLeaseCount,
    fallbackResetCount: state.bodyTracker.fallbackResetCount,
    poolStrategy: state.bodyTracker.poolStrategy,
    fallbackResetStrategy: state.bodyTracker.fallbackResetStrategy,
    ...bodyTrackerPlaybackGate.getStatus(),
  };
}

function mergeTrackingWorkerDetectorDelegates() {
  const body = state.trackingWorker.detectorDelegates ?? {};
  const face = state.faceWorker.detectorDelegates ?? {};
  const hand = state.handWorker.detectorDelegates ?? {};

  return {
    ...body,
    face: face.face ?? (state.faceWorker.status === "failed" ? "failed" : "unloaded"),
    requestedFace: face.requested ?? MEDIAPIPE_FACE_PREFERRED_DELEGATE,
    requestedHand: hand.requested ?? MEDIAPIPE_HAND_PREFERRED_DELEGATE,
    hand: hand.hand ?? (state.handWorker.status === "failed" ? "failed" : "unloaded"),
    attempted: {
      ...(body.attempted ?? {}),
      face: [...(face.attempted?.face ?? [])],
      hand: [...(hand.attempted?.hand ?? [])],
    },
    fallbackReasons: {
      ...(body.fallbackReasons ?? {}),
      ...(face.fallbackReasons ?? {}),
      ...(hand.fallbackReasons ?? {}),
    },
    lastFallbackReason:
      hand.lastFallbackReason ||
      face.lastFallbackReason ||
      body.lastFallbackReason ||
      "",
  };
}

function getHandWorkerStatus() {
  refreshHandWorkerAggregateState();
  const pump = getHandFrameFanOutPump().getStatus();
  const sideStatuses = Object.fromEntries(
    HAND_OBSERVATION_SIDES.map((side) => [side, getHandWorkerSideStatus(side)]),
  );
  const bodyFrames = state.handPipeline.bodyFramesConsidered;
  const outputHits = state.handPipeline.outputHitsBySide;
  const outputHeldHits = state.handPipeline.outputHeldHitsBySide;
  const outputPredictedHits = state.handPipeline.outputPredictedHitsBySide;
  const jointCoverage = bodyFrames > 0
    ? (outputHits.Left + outputHits.Right) / (bodyFrames * 2)
    : 0;
  const poseGuidedJointCoverage = bodyFrames > 0
    ? (outputPredictedHits.Left + outputPredictedHits.Right) / (bodyFrames * 2)
    : 0;
  const productJointCoverage = bodyFrames > 0
    ? (
        outputHits.Left +
        outputHits.Right +
        outputPredictedHits.Left +
        outputPredictedHits.Right
      ) / (bodyFrames * 2)
    : 0;
  return {
    requested: state.handWorker.requested,
    supported: state.handWorker.supported,
    active: state.handWorker.active,
    status: state.handWorker.status,
    requests: state.handWorker.requests,
    frames: state.handWorker.frames,
    roiUnavailable: state.handWorker.roiUnavailable,
    roiEpisodes: {
      recommits: state.handWorker.roiRecommits,
      heldPoseSides: state.handWorker.heldPoseRoiSides,
      trackerResets: state.handWorker.trackerResets,
      staleSourcePtsSkips: state.handWorker.staleSourcePtsSkips,
      lastReasons: state.handWorker.lastRoiEpisodeReasons,
      lastTrackerResetSides: state.handWorker.lastTrackerResetSides,
      transformVersionBySide: {
        ...state.handWorker.lastRoiTransformVersionBySide,
      },
      expansionLevelBySide: {
        ...state.handWorker.lastRoiExpansionLevelBySide,
      },
      missStreakBySide: {
        ...state.handWorker.lastRoiMissStreakBySide,
      },
    },
    delegate: state.handWorker.detectorDelegates?.hand ?? state.detectorDelegates.hand,
    detectorDelegates: state.handWorker.detectorDelegates,
    pendingRequests: HAND_OBSERVATION_SIDES.reduce(
      (total, side) => total + getHandWorkerSideRuntime(side).pendingRequests.size,
      0,
    ),
    detectErrors: state.handWorker.detectErrors,
    errors: state.handWorker.errors,
    timeouts: state.handWorker.timeouts,
    lastError: state.handWorker.lastError,
    cadenceIntervalMs: HAND_DETECTION_INTERVAL_MS,
    cadenceSkips: state.handPipeline.cadenceSkips,
    snapshots: state.handPipeline.snapshots,
    unavailableSkips: state.handPipeline.unavailableSkips,
    snapshotErrors: state.handPipeline.snapshotErrors,
    pump: {
      ...pump,
      preInferenceStaleDrops: state.handPipeline.preInferenceStaleDrops,
      cloneAttempts: state.handPipeline.cloneAttempts,
      cloneFailures: state.handPipeline.cloneFailures,
      dispatchesBySide: { ...state.handPipeline.fanOutDispatchesBySide },
      skipsBySide: { ...state.handPipeline.fanOutSkipsBySide },
      sidePumps: Object.fromEntries(HAND_OBSERVATION_SIDES.map((side) => [
        side,
        { ...sideStatuses[side].pump },
      ])),
    },
    sides: sideStatuses,
    cache: {
      present: Boolean(state.handPipeline.cache),
      ageMs: state.handPipeline.lastCacheAgeMs,
      hits: state.handPipeline.cacheHits,
      misses: state.handPipeline.cacheMisses,
      expired: state.handPipeline.cacheExpired,
      future: state.handPipeline.cacheFuture,
      nullResults: state.handPipeline.nullResults,
      heldNullResults: state.handPipeline.heldNullResults,
      singleSideResults: state.handPipeline.singleSideResults,
      detectionHitsBySide: { ...state.handPipeline.detectionHitsBySide },
      detectionMissesBySide: { ...state.handPipeline.detectionMissesBySide },
      outputHitsBySide: { ...outputHits },
      outputAfterMissHitsBySide: { ...outputHeldHits },
      outputPoseGuidedHitsBySide: { ...outputPredictedHits },
      outputDetectorMissesBySide: {
        ...state.handPipeline.outputDetectorMissesBySide,
      },
      outputMissesBySide: { ...state.handPipeline.outputMissesBySide },
      lastObservedSourcePtsSecBySide: Object.fromEntries(
        HAND_OBSERVATION_SIDES.map((side) => [
          side,
          state.handPipeline.lastObservedBySide[side]?.sourcePtsSec ?? null,
        ]),
      ),
      lastPredictionAgeMsBySide: {
        ...state.handPipeline.lastPredictionAgeMsBySide,
      },
      coverage: bodyFrames > 0 ? state.handPipeline.cacheHits / bodyFrames : 0,
      jointCoverage,
      poseGuidedJointCoverage,
      productJointCoverage,
      afterMissJointCoverage: bodyFrames > 0
        ? (outputHeldHits.Left + outputHeldHits.Right) / (bodyFrames * 2)
        : 0,
      perSideCoverage: {
        Left: bodyFrames > 0 ? outputHits.Left / bodyFrames : 0,
        Right: bodyFrames > 0 ? outputHits.Right / bodyFrames : 0,
      },
      perSideProductCoverage: {
        Left: bodyFrames > 0
          ? (outputHits.Left + outputPredictedHits.Left) / bodyFrames
          : 0,
        Right: bodyFrames > 0
          ? (outputHits.Right + outputPredictedHits.Right) / bodyFrames
          : 0,
      },
    },
  };
}

function getHandWorkerSideStatus(side) {
  const runtime = getHandWorkerSideRuntime(side);
  const pump = getHandSideFramePump(side).getStatus();
  return {
    handWorkerSide: side,
    requested: state.handWorker.requested,
    supported: state.handWorker.supported,
    active: runtime.active,
    status: runtime.status,
    workerPresent: Boolean(runtime.worker),
    requests: runtime.requests,
    frames: runtime.frames,
    pendingRequests: runtime.pendingRequests.size,
    detectErrors: runtime.detectErrors,
    errors: runtime.errors,
    timeouts: runtime.timeouts,
    lastError: runtime.lastError,
    delegate: runtime.detectorDelegates?.hand ??
      (runtime.status === "failed" ? "failed" : "unloaded"),
    detectorDelegates: runtime.detectorDelegates,
    latency: {
      lastRoundTripMs: runtime.lastRoundTripMs,
      lastDetectionMs: runtime.lastDetectionMs,
      roundTrip: summarizeAppPerformanceSamples(runtime.roundTripMs),
      detection: summarizeAppPerformanceSamples(runtime.detectionMs),
      trackerReset: summarizeAppPerformanceSamples(runtime.trackerResetMs),
    },
    roiUnavailable: runtime.roiUnavailable,
    roiEpisodes: {
      recommits: runtime.roiRecommits,
      heldPoseSides: runtime.heldPoseRoiSides,
      trackerResets: runtime.trackerResets,
      staleSourcePtsSkips: runtime.staleSourcePtsSkips,
      lastReasons: runtime.lastRoiEpisodeReasons,
      lastTrackerResetSides: runtime.lastTrackerResetSides,
      transformVersion: runtime.lastRoiTransformVersion,
      expansionLevel: runtime.lastRoiExpansionLevel,
      missStreak: runtime.lastRoiMissStreak,
    },
    pump: {
      ...pump,
      preInferenceStaleDrops: runtime.preInferenceStaleDrops,
    },
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
  state.bodyValidation.framesWithPose = 0;
}

function resetBodyTrackerPoolTelemetry() {
  state.bodyTracker.poolSize = 0;
  state.bodyTracker.poolCleanCount = 0;
  state.bodyTracker.poolPrewarmedCount = 0;
  state.bodyTracker.poolPrimeDurationMs = 0;
  state.bodyTracker.poolPrimeSlot0DurationMs = 0;
  state.bodyTracker.poolPrimeSlot1DurationMs = 0;
  state.bodyTracker.prewarmedSwapCount = 0;
  state.bodyTracker.dirtyLeaseCount = 0;
  state.bodyTracker.fallbackResetCount = 0;
  state.bodyTracker.poolStrategy = "";
  state.bodyTracker.fallbackResetStrategy = "";
}

function recordBodyTrackerGenerationMeta(generationMeta) {
  if (!generationMeta || typeof generationMeta !== "object") {
    return false;
  }

  const generation = Number.isSafeInteger(generationMeta.bodyTrackerGeneration)
    ? generationMeta.bodyTrackerGeneration
    : null;
  const resetCount = Math.max(
    0,
    Math.trunc(optionalFiniteNumber(generationMeta.bodyTrackerResetCount) ?? 0),
  );
  const resetDurationMs = Math.max(
    0,
    optionalFiniteNumber(generationMeta.bodyTrackerResetDurationMs) ?? 0,
  );
  const resetDetectors = parseBodyTrackerDetectorWireValue(
    generationMeta.bodyTrackerResetDetectors,
  );
  const seededDetectors = parseBodyTrackerDetectorWireValue(
    generationMeta.bodyTrackerSeededDetectors,
  );

  state.bodyTracker.generation = generation;
  state.bodyTracker.resetCount = resetCount;
  state.bodyTracker.resetDetectors = resetDetectors;
  state.bodyTracker.resetDurationMs = resetDurationMs;
  state.bodyTracker.seededDetectors = seededDetectors;
  state.bodyTracker.resetStrategy = String(
    generationMeta.bodyTrackerResetStrategy ?? state.bodyTracker.resetStrategy,
  );
  state.bodyTracker.detectorEpoch = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerDetectorEpoch) ??
        state.bodyTracker.detectorEpoch,
    ),
  );
  state.bodyTracker.recreateCount = Math.max(
    0,
    Math.trunc(optionalFiniteNumber(generationMeta.bodyTrackerRecreateCount) ?? 0),
  );
  state.bodyTracker.recreateDetectors = parseBodyTrackerDetectorWireValue(
    generationMeta.bodyTrackerRecreateDetectors,
  );
  state.bodyTracker.recreateDurationMs = Math.max(
    0,
    optionalFiniteNumber(generationMeta.bodyTrackerRecreateDurationMs) ?? 0,
  );
  state.bodyTracker.recreateErrors = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerRecreateErrors) ??
        state.bodyTracker.recreateErrors,
    ),
  );
  state.bodyTracker.closeErrors = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerCloseErrors) ??
        state.bodyTracker.closeErrors,
    ),
  );
  state.bodyTracker.cumulativeResets = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerCumulativeResets) ??
        state.bodyTracker.cumulativeResets,
    ),
  );
  state.bodyTracker.resetErrors = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerResetErrors) ??
        state.bodyTracker.resetErrors,
    ),
  );
  state.bodyTracker.lastGeneration = Number.isSafeInteger(
    generationMeta.bodyTrackerLastGeneration,
  )
    ? generationMeta.bodyTrackerLastGeneration
    : state.bodyTracker.lastGeneration;
  state.bodyTracker.poolSize = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerPoolSize) ??
        state.bodyTracker.poolSize,
    ),
  );
  state.bodyTracker.poolCleanCount = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerPoolCleanCount) ??
        state.bodyTracker.poolCleanCount,
    ),
  );
  state.bodyTracker.poolPrewarmedCount = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerPoolPrewarmedCount) ??
        state.bodyTracker.poolPrewarmedCount,
    ),
  );
  state.bodyTracker.poolPrimeDurationMs = Math.max(
    0,
    optionalFiniteNumber(generationMeta.bodyTrackerPoolPrimeDurationMs) ??
      state.bodyTracker.poolPrimeDurationMs,
  );
  state.bodyTracker.poolPrimeSlot0DurationMs = Math.max(
    0,
    optionalFiniteNumber(generationMeta.bodyTrackerPoolPrimeSlot0DurationMs) ??
      state.bodyTracker.poolPrimeSlot0DurationMs,
  );
  state.bodyTracker.poolPrimeSlot1DurationMs = Math.max(
    0,
    optionalFiniteNumber(generationMeta.bodyTrackerPoolPrimeSlot1DurationMs) ??
      state.bodyTracker.poolPrimeSlot1DurationMs,
  );
  state.bodyTracker.prewarmedSwapCount = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerPrewarmedSwapCount) ??
        state.bodyTracker.prewarmedSwapCount,
    ),
  );
  state.bodyTracker.dirtyLeaseCount = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerDirtyLeaseCount) ??
        state.bodyTracker.dirtyLeaseCount,
    ),
  );
  state.bodyTracker.fallbackResetCount = Math.max(
    0,
    Math.trunc(
      optionalFiniteNumber(generationMeta.bodyTrackerFallbackResetCount) ??
        state.bodyTracker.fallbackResetCount,
    ),
  );
  state.bodyTracker.poolStrategy = String(
    generationMeta.bodyTrackerPoolStrategy ?? state.bodyTracker.poolStrategy,
  );
  state.bodyTracker.fallbackResetStrategy = String(
    generationMeta.bodyTrackerFallbackResetStrategy ??
      state.bodyTracker.fallbackResetStrategy,
  );

  if (resetCount > 0) {
    recordAppPerformanceSample("bodyTrackerResetMs", resetDurationMs);
  }
  return true;
}

function parseBodyTrackerDetectorWireValue(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

function getCurrentMotionSourceMeta(
  trackingRuntime = shouldUseTrackingWorker() ? "worker" : "main-thread",
  sourceTiming = null,
  options = {},
) {
  const currentVideoTime = optionalFiniteNumber(state.elements.video?.currentTime) ?? 0;
  const sourcePtsSec = optionalFiniteNumber(sourceTiming?.sourcePtsSec) ?? currentVideoTime;
  const pumpMode = sourceTiming?.pumpMode ?? state.detectionPump.activeMode;
  const latestFrameStatus = getLatestFramePump().getStatus();

  return {
    inputKind: state.inputKind,
    videoFileName: state.videoFileName,
    videoTime: sourcePtsSec,
    sourcePtsSec,
    sourcePtsSource: sourceTiming?.sourcePtsSource ?? sourcePtsFallbackSource(pumpMode),
    pumpMode,
    callbackMonotonicMs: optionalFiniteNumber(sourceTiming?.callbackMonotonicMs),
    callbackReceivedMonotonicMs: optionalFiniteNumber(sourceTiming?.callbackReceivedMonotonicMs),
    captureMonotonicMs: optionalFiniteNumber(sourceTiming?.captureMonotonicMs),
    receiveMonotonicMs: optionalFiniteNumber(sourceTiming?.receiveMonotonicMs),
    captureMonotonicSource: sourceTiming?.captureMonotonicSource ?? "unavailable",
    receiveMonotonicSource: sourceTiming?.receiveMonotonicSource ?? "unavailable",
    timingSource: sourceTiming ? "detection-callback" : "current-state-fallback",
    poseModelKey:
      state.trackingWorker.poseModelKey || state.poseModelKey || getSelectedPoseModelKey(),
    avatarModelLabel: state.avatarFileName || "Xbot.glb",
    faceTrackingEnabled: state.faceTracking.enabled,
    faceLandmarksEnabled: state.faceTracking.landmarksEnabled,
    trackingRuntime,
    inputGeneration: options.inputGeneration ?? latestFrameStatus.generation,
    bodyCadenceMaxRateHz:
      optionalFiniteNumber(sourceTiming?.bodyCadenceMaxRateHz) ??
      BODY_DETECTION_RATE_HZ,
    bodyCadenceAdmissionReason:
      sourceTiming?.bodyCadenceAdmissionReason ??
      state.detectionPump.lastBodyCadenceAdmissionReason ??
      null,
    bodyCadenceSkips:
      optionalFiniteNumber(sourceTiming?.bodyCadenceSkips) ??
      state.detectionPump.bodyCadenceSkips,
    bodyOverloadDrops:
      optionalFiniteNumber(sourceTiming?.bodyOverloadDrops) ??
      latestFrameStatus.overloadDrops,
    bodyStaleCallbackDrops:
      optionalFiniteNumber(sourceTiming?.bodyStaleCallbackDrops) ??
      state.detectionPump.staleFrameCallbacks,
    bodyPreInferenceStaleDrops:
      optionalFiniteNumber(sourceTiming?.bodyPreInferenceStaleDrops) ??
      state.detectionPump.preInferenceStaleDrops,
    bodyPostInferenceStaleDrops:
      optionalFiniteNumber(sourceTiming?.bodyPostInferenceStaleDrops) ??
      state.detectionPump.postInferenceStaleDrops,
    ...(options.bodyTrackerGenerationMeta ?? {}),
  };
}

async function setFaceTrackingEnabled(enabled) {
  const nextEnabled = Boolean(enabled);
  const changed = state.faceTracking.enabled !== nextEnabled;
  state.faceTracking.enabled = nextEnabled;
  state.faceTracking.lastError = "";
  syncFaceTrackingControl();
  const transition = changed && state.active
    ? beginDetectionConfigurationGeneration("face-tracking-change")
    : null;

  if (!state.faceTracking.enabled) {
    state.faceTracking.landmarksEnabled = false;
    state.faceTracking.status = "disabled";
    disposeFaceWorker();
    syncFaceTrackingControl();
    if (transition) {
      try {
        await completeDetectionConfigurationGeneration(transition);
      } catch (error) {
        failVideoGenerationBoundary(
          transition.inputGeneration,
          error,
          "face-tracking-change",
        );
      }
    }
    return getFaceTrackingStatus();
  }

  state.faceTracking.status = state.faceWorker.active || state.faceLandmarker
    ? "ready"
    : "enabled";

  if (
    state.active ||
    state.starting ||
    state.poseLandmarker ||
    state.vision ||
    state.trackingWorker.active
  ) {
    try {
      await ensureModelsLoaded();
    } catch (error) {
      if (transition?.ownsVideoBoundary) {
        releaseBodyTrackerPlaybackGate(
          transition.inputGeneration,
          "face-tracking-load-error",
          { resume: false },
        );
        failVideoGenerationBoundary(
          transition.inputGeneration,
          error,
          "face-tracking-load",
        );
      }
      throw error;
    }
  }

  if (transition) {
    try {
      await completeDetectionConfigurationGeneration(transition);
    } catch (error) {
      failVideoGenerationBoundary(
        transition.inputGeneration,
        error,
        "face-tracking-change",
      );
    }
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
  const nextEnabled = Boolean(enabled);
  const changed = state.faceTracking.landmarksEnabled !== nextEnabled;
  state.faceTracking.landmarksEnabled = nextEnabled;

  if (state.faceTracking.landmarksEnabled && !state.faceTracking.enabled) {
    await setFaceTrackingEnabled(true);
    return getFaceTrackingStatus();
  }

  const transition = changed && state.active
    ? beginDetectionConfigurationGeneration("face-landmarks-change")
    : null;
  if (transition) {
    try {
      await completeDetectionConfigurationGeneration(transition);
    } catch (error) {
      failVideoGenerationBoundary(
        transition.inputGeneration,
        error,
        "face-landmarks-change",
      );
    }
  }

  return getFaceTrackingStatus();
}

function getFaceTrackingEnabled() {
  return state.faceTracking.enabled;
}

function getFaceTrackingStatus() {
  const facePump = getFaceFramePump().getStatus();
  const maturation = faceObservationMaturationLedger.getStatus();
  return {
    enabled: state.faceTracking.enabled,
    landmarksEnabled: state.faceTracking.landmarksEnabled,
    status: state.faceTracking.enabled ? state.faceTracking.status : "disabled",
    modelLoaded: Boolean(state.faceWorker.active || state.faceLandmarker),
    detectFrames: state.faceTracking.detectFrames,
    facesDetected: state.faceTracking.facesDetected,
    lastTimestamp: state.faceTracking.lastTimestamp,
    lastError: state.faceTracking.lastError,
    worker: {
      supported: state.faceWorker.supported,
      active: state.faceWorker.active,
      status: state.faceWorker.status,
      pendingRequests: state.faceWorker.pendingRequests.size,
      requests: state.faceWorker.requests,
      frames: state.faceWorker.frames,
      detectErrors: state.faceWorker.detectErrors,
      errors: state.faceWorker.errors,
      timeouts: state.faceWorker.timeouts,
      detectorDelegates: state.faceWorker.detectorDelegates,
    },
    cadenceRateHz: FACE_DETECTION_RATE_HZ,
    snapshotMaxDimension: FACE_MAX_INFERENCE_FRAME_DIMENSION,
    cadenceSkips: state.facePipeline.cadenceSkips,
    applicationLagMs: FACE_OBSERVATION_DELAY_MS,
    maxObservationAgeMs: FACE_OBSERVATION_MAX_AGE_MS,
    snapshots: state.facePipeline.snapshots,
    snapshotErrors: state.facePipeline.snapshotErrors,
    cacheHits: state.facePipeline.cacheHits,
    cacheMisses: state.facePipeline.cacheMisses,
    cacheFuture: state.facePipeline.cacheFuture,
    cacheExpired: state.facePipeline.cacheExpired,
    lastObservationSourcePtsSec:
      state.facePipeline.lastObservationSourcePtsSec,
    lastObservationAgeMs: state.facePipeline.lastObservationAgeMs,
    maturation,
    maturationDeadlineMisses: maturation.deadlineMisses,
    maturationLateDiscards: maturation.lateDiscards,
    pump: {
      ...facePump,
      offeredFrames: facePump.offered,
      appliedFrames: facePump.applied,
    },
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
  state.motionRecording.recordingId += 1;
  state.motionRecording.createdAt = new Date().toISOString();
  state.motionRecording.source = {
    ...getCurrentMotionSourceMeta(),
    recordingFrameLimit: MOTION_RECORDING_FRAME_LIMIT,
  };
  state.motionRecording.frames = [];
  state.motionRecording.droppedFrames = 0;
  state.motionRecording.lastRecording = null;

  // A seeked, paused video frame may already have been applied before a
  // recorder is armed. Seed that exact current frame so recording semantics
  // do not depend on whether Chrome emits another rVFC callback for the same
  // presentation timestamp after playback resumes.
  const seedFrame = getPausedVideoRecordingSeedFrame();
  if (seedFrame) {
    appendMotionRecordingFrame(seedFrame);
    if (state.bodyValidation.enabled) {
      recordBodyValidation(seedFrame);
    }
  }

  return getMotionRecordingStatus();
}

function getPausedVideoRecordingSeedFrame() {
  const video = state.elements.video;
  const frame = state.latestMotionFrame;
  if (
    state.inputKind !== "video" ||
    !state.active ||
    !video?.paused ||
    !isMotionFrame(frame) ||
    !Array.isArray(frame.poseLandmarks)
  ) {
    return null;
  }

  const framePtsSec = motionFrameSourcePtsSec(frame);
  const videoTimeSec = optionalFiniteNumber(video.currentTime);
  if (
    framePtsSec === null ||
    videoTimeSec === null ||
    Math.abs(framePtsSec - videoTimeSec) > 0.001
  ) {
    return null;
  }

  return frame;
}

function stopMotionRecording({ returnRecording = true } = {}) {
  state.motionRecording.active = false;
  state.motionRecording.lastRecording = buildCurrentMotionRecordingSnapshot();
  return returnRecording ? getMotionRecording() : getMotionRecordingStatus();
}

function getMotionRecording() {
  if (state.motionRecording.active || state.motionRecording.frames.length > 0) {
    return buildCurrentMotionRecording();
  }

  return state.motionRecording.lastRecording
    ? createMotionRecording(state.motionRecording.lastRecording)
    : null;
}

function getMotionRecordingJsonl() {
  const recording = getMotionRecording();

  return recording ? serializeMotionRecordingJsonl(recording) : "";
}

function getMotionRecordingJsonlChunk(
  cursor = 0,
  maxFrames = MOTION_RECORDING_JSONL_MAX_CHUNK_FRAMES,
) {
  if (state.motionRecording.active) {
    throw new Error("Stop motion recording before starting a stable chunk export.");
  }
  const recording = state.motionRecording.lastRecording;
  if (!recording) {
    throw new Error("No completed motion recording is available for chunk export.");
  }

  return {
    recordingId: recording.recordingId,
    createdAt: recording.createdAt,
    ...serializeMotionRecordingJsonlChunk(recording, { cursor, maxFrames }),
  };
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
    recordingId: state.motionRecording.active
      ? state.motionRecording.recordingId
      : state.motionRecording.lastRecording?.recordingId ?? null,
    hasRecording: Boolean(
      state.motionRecording.active || state.motionRecording.lastRecording,
    ),
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

function buildCurrentMotionRecordingSnapshot() {
  return {
    version: MOTION_RECORDING_VERSION,
    recordingId: state.motionRecording.recordingId,
    createdAt: state.motionRecording.createdAt || new Date().toISOString(),
    source: { ...(state.motionRecording.source ?? getCurrentMotionSourceMeta()) },
    frames: state.motionRecording.frames,
    droppedFrames: state.motionRecording.droppedFrames,
  };
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
    stopMotionRecording({ returnRecording: false });
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
  const appliedAvatarStates = buildAppliedAvatarStateRows(samples);
  const appliedAvatarStateSummary = summarizeAppliedAvatarStates(appliedAvatarStates);
  const footContact = buildFootContactReport(samples);
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
    appliedAvatarStates,
    appliedAvatarStateSummary,
    footContact,
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

function buildFootContactReport(samples) {
  const rows = [];
  const previousBySide = new Map();

  for (const sample of samples) {
    const sides = sample.footContact?.sides ?? {};
    const timestampMs = optionalFiniteNumber(sample.sourceTimestampMs ?? sample.timestamp);
    const sourcePtsSec = optionalFiniteNumber(sample.sourcePtsSec ?? sample.videoTime);
    const modelHeight = optionalFiniteNumber(sample.appliedAvatarState?.modelHeight);

    for (const side of ['Left', 'Right']) {
      const contact = sides[side];

      if (!contact) {
        continue;
      }

      const appliedWorld = finiteVectorArray(contact.appliedWorld);
      const previous = previousBySide.get(side) ?? null;
      const deltaMs = timestampMs !== null && previous && previous.timestampMs !== null
        ? timestampMs - previous.timestampMs
        : null;
      const continuousIk = Boolean(
        contact.ikApplied &&
        previous?.ikApplied &&
        appliedWorld &&
        previous.appliedWorld &&
        modelHeight !== null &&
        modelHeight > 0 &&
        deltaMs > 0 &&
        deltaMs <= Number(sample.footContact?.options?.maxGapMs ?? 100)
      );
      const slideSpeedHeightPerSec = continuousIk
        ? vectorArrayDistance(appliedWorld, previous.appliedWorld) / modelHeight / (deltaMs / 1000)
        : null;
      const row = {
        timestampMs,
        sourcePtsSec,
        side,
        phase: contact.phase ?? 'moving',
        owner: contact.owner ?? 'direction',
        ikApplied: Boolean(contact.ikApplied),
        ikReachable: contact.ikReachable ?? null,
        anchorWorld: finiteVectorArray(contact.anchorWorld),
        rawWorld: finiteVectorArray(contact.rawWorld),
        appliedWorld,
        poleWorld: finiteVectorArray(contact.poleWorld),
        instantaneousSpeedHeightPerSec: optionalFiniteNumber(contact.instantaneousSpeedHeightPerSec),
        verticalSpeedHeightPerSec: optionalFiniteNumber(contact.verticalSpeedHeightPerSec),
        smoothedSpeedHeightPerSec: optionalFiniteNumber(contact.smoothedSpeedHeightPerSec),
        heightAboveFloorRatio: optionalFiniteNumber(contact.heightAboveFloorRatio),
        rigFloorHeightRatio: optionalFiniteNumber(contact.rigFloorHeightRatio),
        groundPlaneAnchorDriftHeightRatio: optionalFiniteNumber(
          contact.groundPlaneAnchorDriftHeightRatio,
        ),
        confidence: optionalFiniteNumber(contact.confidence),
        directionBlend: optionalFiniteNumber(contact.directionBlend),
        endpointResidualRatio: optionalFiniteNumber(contact.endpointResidualRatio),
        reachErrorRatio: optionalFiniteNumber(contact.reachErrorRatio),
        bendDeg: optionalFiniteNumber(contact.bendDeg),
        poleSource: contact.poleSource ?? null,
        slideSpeedHeightPerSec,
        releaseReason: contact.releaseReason ?? null,
      };

      rows.push(row);
      previousBySide.set(side, {
        timestampMs,
        appliedWorld,
        ikApplied: row.ikApplied,
      });
    }
  }

  return {
    mode: samples.at(-1)?.footContact?.mode ?? null,
    options: samples.at(-1)?.footContact?.options ?? null,
    rows,
    summary: summarizeFootContactRows(rows),
    bySide: Object.fromEntries(
      ['Left', 'Right'].map((side) => [
        side,
        summarizeFootContactRows(rows.filter((row) => row.side === side)),
      ]),
    ),
  };
}

function summarizeFootContactRows(rows) {
  const residuals = rows
    .map((row) => row.endpointResidualRatio)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const slideSpeeds = rows
    .map((row) => row.slideSpeedHeightPerSec)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const releaseReasons = {};

  for (const row of rows) {
    if (row.releaseReason) {
      releaseReasons[row.releaseReason] = (releaseReasons[row.releaseReason] ?? 0) + 1;
    }
  }

  return {
    sampleCount: rows.length,
    candidateFrames: rows.filter((row) => row.phase === 'candidate').length,
    plantedFrames: rows.filter((row) => row.phase === 'planted').length,
    ikAppliedFrames: rows.filter((row) => row.ikApplied).length,
    directionFrames: rows.filter((row) => row.owner === 'direction').length,
    endpointResidual: summarizeFootContactValues(residuals),
    plantedSlideSpeedHeightPerSec: summarizeFootContactValues(slideSpeeds),
    releaseReasons,
  };
}

function summarizeFootContactValues(sortedValues) {
  return {
    count: sortedValues.length,
    mean: sortedValues.length > 0 ? average(sortedValues) : 0,
    p50: percentile(sortedValues, 0.5),
    p95: percentile(sortedValues, 0.95),
    max: sortedValues.length > 0 ? sortedValues[sortedValues.length - 1] : 0,
  };
}

function finiteVectorArray(value) {
  return Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)
    ? value.slice(0, 3)
    : null;
}

function vectorArrayDistance(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function getBodyValidationProgress() {
  const lastSample = state.bodyValidation.lastSample;
  return {
    totalFrames: state.bodyValidation.samples.length,
    framesWithPose: state.bodyValidation.framesWithPose,
    lastVideoTime: optionalFiniteNumber(lastSample?.videoTime),
    lastSourcePtsSec: optionalFiniteNumber(lastSample?.sourcePtsSec),
  };
}

function buildAppliedAvatarStateRows(samples) {
  return samples.map((sample) => {
    const appliedAvatarState = sample.appliedAvatarState ?? null;
    const applyMonotonicMs = optionalFiniteNumber(
      appliedAvatarState?.timing?.appliedAtMonotonicMs,
    );
    const captureMonotonicMs = optionalFiniteNumber(sample.sourceTiming?.captureMonotonicMs);
    const receiveMonotonicMs = optionalFiniteNumber(sample.sourceTiming?.receiveMonotonicMs);
    const latencyStartMonotonicMs = captureMonotonicMs ?? receiveMonotonicMs;
    const latencyStartSource = captureMonotonicMs !== null
      ? "capture"
      : receiveMonotonicMs !== null
        ? "receive"
        : null;
    const rawLatencyMs = applyMonotonicMs !== null && latencyStartMonotonicMs !== null
      ? applyMonotonicMs - latencyStartMonotonicMs
      : null;
    const captureOrReceiveToApplyLatencyMs = rawLatencyMs !== null && rawLatencyMs >= 0
      ? rawLatencyMs
      : null;

    return {
      sourceTimestampMs: optionalFiniteNumber(sample.sourceTimestampMs ?? sample.timestamp),
      sourcePtsSec: optionalFiniteNumber(sample.sourcePtsSec ?? sample.videoTime),
      sourcePtsSource: sample.sourcePtsSource ?? null,
      sourceTiming: { ...(sample.sourceTiming ?? {}) },
      latencyStartSource,
      captureOrReceiveToApplyLatencyMs,
      appliedAvatarState,
    };
  });
}

function summarizeAppliedAvatarStates(rows) {
  const capturedRows = rows.filter((row) => row.appliedAvatarState);
  const sourcePtsCount = rows.filter((row) => row.sourcePtsSec !== null).length;
  const latencyValues = capturedRows
    .map((row) => row.captureOrReceiveToApplyLatencyMs)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  return {
    sampleCount: rows.length,
    capturedCount: capturedRows.length,
    captureCoverage: rows.length > 0 ? capturedRows.length / rows.length : 0,
    actualBoneCoverage: aggregateAppliedCollectionCoverage(
      capturedRows,
      "canonicalBones",
      "bones",
      (bone) => finiteNumberArray(bone?.localQuaternion, 4),
    ),
    endpointCoverage: aggregateAppliedCollectionCoverage(
      capturedRows,
      "fkEndpoints",
      "fkEndpoints",
      (endpoint) => (
        finiteNumberArray(endpoint?.modelLocalPosition, 3) &&
        finiteNumberArray(endpoint?.worldPosition, 3)
      ),
    ),
    sourcePtsCoverage: {
      expectedCount: rows.length,
      capturedCount: sourcePtsCount,
      ratio: rows.length > 0 ? sourcePtsCount / rows.length : 0,
    },
    captureOrReceiveToApplyLatencyMs: summarizeAppliedLatency(
      latencyValues,
      capturedRows.length,
    ),
  };
}

function aggregateAppliedCollectionCoverage(
  rows,
  coverageKey,
  collectionKey,
  isCaptured,
) {
  let expectedCount = 0;
  let capturedCount = 0;
  let sampleCount = 0;

  for (const row of rows) {
    const expected = optionalNonNegativeCount(
      row.appliedAvatarState?.coverage?.[coverageKey]?.expectedCount,
    );

    if (expected === null) {
      continue;
    }

    const captured = Object.values(row.appliedAvatarState?.[collectionKey] ?? {})
      .filter(isCaptured)
      .length;
    expectedCount += expected;
    capturedCount += Math.min(expected, captured);
    sampleCount += 1;
  }

  return coverageSummary(sampleCount, expectedCount, capturedCount);
}

function coverageSummary(sampleCount, expectedCount, capturedCount) {
  return {
    sampleCount,
    expectedCount,
    capturedCount,
    ratio: expectedCount > 0 ? capturedCount / expectedCount : 0,
  };
}

function summarizeAppliedLatency(sortedValues, capturedCount) {
  if (sortedValues.length === 0) {
    return {
      count: 0,
      unavailableCount: capturedCount,
      p50Ms: null,
      p95Ms: null,
      maxMs: null,
    };
  }

  return {
    count: sortedValues.length,
    unavailableCount: capturedCount - sortedValues.length,
    p50Ms: percentileFromSorted(sortedValues, 0.5),
    p95Ms: percentileFromSorted(sortedValues, 0.95),
    maxMs: sortedValues[sortedValues.length - 1],
  };
}

function optionalNonNegativeCount(value) {
  const number = optionalFiniteNumber(value);

  if (number === null || number < 0 || !Number.isInteger(number)) {
    return null;
  }

  return number;
}

function finiteNumberArray(value, expectedLength) {
  return Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((entry) => optionalFiniteNumber(entry) !== null);
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
      reliable: sample.sourceAvatarDivergence?.rootYaw?.reliable,
      reliabilityReason: sample.sourceAvatarDivergence?.rootYaw?.reliabilityReason,
      unreliableFrames: sample.sourceAvatarDivergence?.rootYaw?.unreliableFrames,
      recovering: sample.sourceAvatarDivergence?.rootYaw?.recovering,
      recoveryTargetYawDeg: sample.sourceAvatarDivergence?.rootYaw?.recoveryTargetYawDeg,
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
  const unreliable = rows.filter((row) => row.reliable === false).length;
  const recovering = rows.filter((row) => row.recovering).length;
  const stableAfterUnreliable = countStableAfterUnreliableRows(rows);
  const reliabilityReasons = countByValue(rows, "reliabilityReason");

  return {
    count: rows.length,
    targetError: summarizeErrors(yawTargetErrors),
    rawJumpCount: jumps,
    sideOrderFlipCount: sideOrderFlips,
    unreliableCount: unreliable,
    recoveringCount: recovering,
    stableAfterUnreliableCount: stableAfterUnreliable,
    reliabilityReasons,
    byMode: summarizeRowsByKey(yawTargetErrors, "retargetMode"),
  };
}

function countStableAfterUnreliableRows(rows) {
  let count = 0;
  let previousWasUnreliable = false;

  for (const row of rows) {
    if (previousWasUnreliable && row.reliable === true) {
      count += 1;
    }

    previousWasUnreliable = row.reliable === false;
  }

  return count;
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
    getBodyValidationProgress,
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
    getMotionRecordingJsonlChunk,
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
      if (
        video.videoWidth > 0 &&
        video.videoHeight > 0 &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        finish(resolve);
      }
    };

    const handleError = () => {
      finish(() => reject(new Error(`${sourceLabel} video failed to load.`)));
    };

    if (
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
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

  return POSE_MODEL_KEYS_BY_OPTION[normalizedValue] ?? DEFAULT_POSE_MODEL_KEY;
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
  return isWorkerRuntimeEnabled(globalThis.location?.search, "tracking-worker");
}

function getInitialHandWorkerEnabled() {
  return isWorkerRuntimeEnabled(globalThis.location?.search, "hand-worker");
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
