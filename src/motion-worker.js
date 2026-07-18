import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import {
  createMotionFrame,
  serializeMotionFrame,
} from "./motion-frame.js?v=20260708-single-hand-side-1";
import {
  createPrewarmedVideoTrackerGenerationOwner,
} from "./tracking-input-generation.js?v=20260717-prewarmed-pose-pool-1";

let vision = null;
let loadedConfigurationKey = "";
const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
const MEDIAPIPE_BODY_RUNNING_MODE = "VIDEO";
const MEDIAPIPE_BODY_RESET_RUNNING_MODE = "IMAGE";
const BODY_TRACKER_POOL_SIZE = 2;
const BODY_TRACKER_PRIME_CANVAS_SIZE = 16;
let requestedDelegate = MEDIAPIPE_PREFERRED_DELEGATE;
const bodyTrackerGenerationOwner = createPrewarmedVideoTrackerGenerationOwner();
let messageTail = Promise.resolve();
const detectorDelegates = {
  requested: requestedDelegate,
  fallback: MEDIAPIPE_FALLBACK_DELEGATE,
  pose: "unloaded",
  poseStandby: "unloaded",
  lastFallbackReason: "",
  attempted: {},
  fallbackReasons: {},
};

installMediaPipeModuleFactoryImportBridge();

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  // Nominate a newer generation at receipt time, not after the serialized
  // message tail reaches it. This prevents an in-progress older candidate set
  // from committing after the app has already requested a newer boundary.
  if (
    message.type === "prepare-generation" ||
    message.type === "reserve-generation"
  ) {
    try {
      bodyTrackerGenerationOwner.reserve(message.inputGeneration);
    } catch {
      // The serialized handler returns the protocol error for invalid input.
    }
  }
  messageTail = messageTail.then(
    () => handleMessage(message),
    () => handleMessage(message),
  );
});

function installMediaPipeModuleFactoryImportBridge() {
  if (self.import?.__actionTrackerModuleFactoryBridge) {
    return;
  }

  const importBridge = async (scriptUrl) => {
    const module = await import(scriptUrl);
    const moduleFactory = module?.default ?? module?.ModuleFactory;

    if (typeof moduleFactory === "function") {
      self.ModuleFactory = moduleFactory;
    }

    return module;
  };

  importBridge.__actionTrackerModuleFactoryBridge = true;
  self.import = importBridge;
}

async function handleMessage(message) {
  const requestId = message.requestId ?? 0;

  try {
    if (message.type === "init") {
      await initModels(message);
      postWorkerMessage({
        type: "ready",
        requestId,
        configurationKey: loadedConfigurationKey,
        bodyTrackerGenerationMeta: bodyTrackerGenerationOwner.getTelemetry(),
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "prepare-generation") {
      if (message.imageBitmap) {
        throw new Error("Tracking worker prepare-generation must not transfer frame pixels.");
      }
      const bodyTrackerGenerationMeta = await prepareGeneration(message);
      postWorkerMessage({
        type: "generation-ready",
        requestId,
        inputGeneration: message.inputGeneration,
        configurationKey: loadedConfigurationKey,
        bodyTrackerGenerationMeta,
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "reserve-generation") {
      if (!loadedConfigurationKey) {
        throw new Error("Tracking worker cannot reserve a generation before Pose initialization.");
      }
      if (!bodyTrackerGenerationOwner.reserve(message.inputGeneration)) {
        throw new Error("Tracking worker cannot reserve an older input generation.");
      }
      postWorkerMessage({
        type: "generation-reserved",
        requestId,
        inputGeneration: message.inputGeneration,
        configurationKey: loadedConfigurationKey,
      });
      return;
    }

    if (message.type === "detect") {
      const frame = await detectMotionFrame(message);
      postWorkerMessage({
        type: "result",
        requestId,
        inputGeneration: message.inputGeneration,
        configurationKey: loadedConfigurationKey,
        frame,
      });
      return;
    }

    if (message.type === "close") {
      closeAllLandmarkers();
      postWorkerMessage({ type: "closed", requestId });
      return;
    }

    throw new Error(`Unsupported worker message type: ${message.type}`);
  } catch (error) {
    if (message.type !== "detect") {
      closeImageBitmap(message.imageBitmap);
    }
    postWorkerMessage({
      type: "error",
      requestId,
      inputGeneration: Number.isSafeInteger(message.inputGeneration)
        ? message.inputGeneration
        : null,
      configurationKey: loadedConfigurationKey,
      message: getErrorDetail(error),
      code: String(error?.code ?? ""),
      bodyTrackerGenerationMeta:
        error?.bodyTrackerGenerationMeta ?? bodyTrackerGenerationOwner.getTelemetry(),
    });
  }
}

async function initModels({
  wasmAssetPath,
  poseModelUrl,
  delegate = MEDIAPIPE_PREFERRED_DELEGATE,
} = {}) {
  if (!wasmAssetPath || !poseModelUrl) {
    throw new Error("Tracking worker init requires wasm and pose model URLs.");
  }

  if (!vision) {
    vision = await FilesetResolver.forVisionTasks(wasmAssetPath, true);
  }

  const nextConfiguration = {
    poseModelUrl: String(poseModelUrl),
    delegate: normalizeMediaPipeDelegate(delegate),
  };
  const nextConfigurationKey = buildTrackerConfigurationKey(nextConfiguration);

  if (nextConfigurationKey !== loadedConfigurationKey) {
    const previousDelegateTelemetry = getDetectorDelegates();
    detectorDelegates.requested = nextConfiguration.delegate;
    resetDetectorDelegateTelemetry();
    let initialPoolSlots = null;
    try {
      // Ready means both same-delegate VIDEO slots have completed their
      // neutral prime. No generation is reserved or prepared during priming.
      initialPoolSlots = await createInitialPoseDetectorPool(nextConfiguration);
      bodyTrackerGenerationOwner.installPrewarmedPool({
        configurationKey: nextConfigurationKey,
        poolSlots: initialPoolSlots,
      });
      initialPoolSlots = null;
    } catch (error) {
      closePoseDetectorPool(initialPoolSlots);
      restoreDetectorDelegateTelemetry(previousDelegateTelemetry);
      throw error;
    }
    requestedDelegate = nextConfiguration.delegate;
    loadedConfigurationKey = nextConfigurationKey;
  }
}

function buildTrackerConfigurationKey({
  poseModelUrl,
  delegate,
}) {
  return JSON.stringify([
    String(poseModelUrl ?? ""),
    normalizeMediaPipeDelegate(delegate),
    MEDIAPIPE_BODY_RUNNING_MODE,
  ]);
}

function createPoseDetectorOptions(configuration) {
  return {
    baseOptions: { modelAssetPath: configuration.poseModelUrl },
    runningMode: MEDIAPIPE_BODY_RUNNING_MODE,
    numPoses: 1,
  };
}

function createPoseDetectorStateResets() {
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

async function createInitialPoseDetectorPool(configuration) {
  const poolSlots = [];
  const options = createPoseDetectorOptions(configuration);
  try {
    const currentStartedAt = performance.now();
    const currentDetector = await createLandmarkerWithDelegate(
      "pose",
      PoseLandmarker,
      vision,
      options,
      configuration.delegate,
    );
    const effectiveDelegate = detectorDelegates.pose;
    const currentSlot = {
      slotId: "current",
      delegate: effectiveDelegate,
      prewarmed: false,
      primeDurationMs: 0,
      detectors: [{ id: "pose", detector: currentDetector }],
    };
    poolSlots.push(currentSlot);
    prewarmPoseVideoDetector(currentDetector);
    currentSlot.prewarmed = true;
    currentSlot.primeDurationMs = Math.max(0, performance.now() - currentStartedAt);

    const standbyStartedAt = performance.now();
    const standbyDetector = await createLandmarkerWithDelegate(
      "poseStandby",
      PoseLandmarker,
      vision,
      options,
      effectiveDelegate,
      { allowFallback: false },
    );
    const standbySlot = {
      slotId: "standby",
      delegate: effectiveDelegate,
      prewarmed: false,
      primeDurationMs: 0,
      detectors: [{ id: "pose", detector: standbyDetector }],
    };
    poolSlots.push(standbySlot);
    if (detectorDelegates.poseStandby !== effectiveDelegate) {
      throw new Error(
        `Pose standby delegate ${detectorDelegates.poseStandby} does not match current ${effectiveDelegate}.`,
      );
    }
    prewarmPoseVideoDetector(standbyDetector);
    standbySlot.prewarmed = true;
    standbySlot.primeDurationMs = Math.max(0, performance.now() - standbyStartedAt);

    if (poolSlots.length !== BODY_TRACKER_POOL_SIZE) {
      throw new Error("Pose VIDEO detector pool did not prime both slots.");
    }
    return poolSlots;
  } catch (error) {
    closePoseDetectorPool(poolSlots);
    throw error;
  }
}

function prewarmPoseVideoDetector(poseLandmarker) {
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("Pose VIDEO pool priming requires OffscreenCanvas.");
  }
  const canvas = new OffscreenCanvas(
    BODY_TRACKER_PRIME_CANVAS_SIZE,
    BODY_TRACKER_PRIME_CANVAS_SIZE,
  );
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Pose VIDEO pool could not create its neutral prime canvas.");
  }
  context.fillStyle = "#000000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // The prime timestamp is detector-local only: it is never copied into a
  // MotionFrame, source metadata, or the product causal clock.
  const primeResult = poseLandmarker.detectForVideo(canvas, 0);
  if (
    (primeResult?.landmarks?.length ?? 0) > 0 ||
    (primeResult?.worldLandmarks?.length ?? 0) > 0
  ) {
    throw new Error("Pose VIDEO pool neutral prime unexpectedly detected a pose.");
  }
}

function closePoseDetectorPool(poolSlots) {
  const closed = new Set();
  for (const slot of poolSlots ?? []) {
    for (const { detector } of slot.detectors ?? []) {
      if (!detector || closed.has(detector)) {
        continue;
      }
      closed.add(detector);
      try {
        detector.close?.();
      } catch {
        // Best-effort cleanup for a pool that was never installed.
      }
    }
  }
}

async function prepareGeneration({ inputGeneration, configurationKey } = {}) {
  const requestedConfigurationKey = String(configurationKey ?? "");
  if (!requestedConfigurationKey || requestedConfigurationKey !== loadedConfigurationKey) {
    throw new Error("Tracking worker generation configuration does not match its loaded Pose detector.");
  }
  return bodyTrackerGenerationOwner.prepare({
    inputGeneration,
    configurationKey: requestedConfigurationKey,
    detectorStateResets: createPoseDetectorStateResets(),
  });
}

async function createLandmarkerWithDelegate(
  detectorKey,
  Landmarker,
  visionRef,
  options,
  preferredDelegate = requestedDelegate,
  { allowFallback = true } = {},
) {
  let preferredError = null;

  const attemptOrder = allowFallback
    ? getMediaPipeDelegateAttemptOrder(preferredDelegate)
    : [normalizeMediaPipeDelegate(preferredDelegate)];
  for (const delegate of attemptOrder) {
    recordDetectorDelegateAttempt(detectorKey, delegate);

    try {
      const landmarker = await Landmarker.createFromOptions(visionRef, {
        ...options,
        baseOptions: {
          ...(options.baseOptions ?? {}),
          delegate,
        },
      });
      markDetectorDelegate(detectorKey, delegate, preferredError);
      return landmarker;
    } catch (error) {
      if (!allowFallback || delegate === MEDIAPIPE_FALLBACK_DELEGATE) {
        throw error;
      }

      preferredError = error;
      console.warn(
        `${detectorKey} ${preferredDelegate} delegate failed in worker; retrying with ${MEDIAPIPE_FALLBACK_DELEGATE}.`,
        error,
      );
    }
  }

  throw preferredError ?? new Error(`Unable to create ${detectorKey} landmarker in worker.`);
}

function getMediaPipeDelegateAttemptOrder(preferredDelegate = requestedDelegate) {
  if (preferredDelegate === MEDIAPIPE_FALLBACK_DELEGATE) {
    return [MEDIAPIPE_FALLBACK_DELEGATE];
  }

  return [MEDIAPIPE_PREFERRED_DELEGATE, MEDIAPIPE_FALLBACK_DELEGATE];
}

function normalizeMediaPipeDelegate(value) {
  return String(value ?? "").toLowerCase() === "cpu"
    ? MEDIAPIPE_FALLBACK_DELEGATE
    : MEDIAPIPE_PREFERRED_DELEGATE;
}

function markDetectorDelegate(detectorKey, delegate, fallbackError = null) {
  detectorDelegates[detectorKey] = delegate;

  if (fallbackError) {
    const reason = getErrorDetail(fallbackError);
    detectorDelegates.fallbackReasons[detectorKey] = reason;
    detectorDelegates.lastFallbackReason = `${detectorKey}: ${reason}`;
  } else {
    delete detectorDelegates.fallbackReasons[detectorKey];
  }
}

function getDetectorDelegates() {
  return {
    ...detectorDelegates,
    attempted: cloneRecordArrayValues(detectorDelegates.attempted),
    fallbackReasons: { ...detectorDelegates.fallbackReasons },
  };
}

function recordDetectorDelegateAttempt(detectorKey, delegate) {
  const attempts = detectorDelegates.attempted[detectorKey] ?? [];

  if (!attempts.includes(delegate)) {
    attempts.push(delegate);
  }

  detectorDelegates.attempted[detectorKey] = attempts;
}

function resetDetectorDelegateTelemetry() {
  detectorDelegates.lastFallbackReason = "";
  detectorDelegates.attempted = {};
  detectorDelegates.fallbackReasons = {};
  detectorDelegates.poseStandby = "unloaded";
}

function restoreDetectorDelegateTelemetry(previous) {
  detectorDelegates.requested = previous.requested;
  detectorDelegates.fallback = previous.fallback;
  detectorDelegates.pose = previous.pose;
  detectorDelegates.poseStandby = previous.poseStandby ?? "unloaded";
  detectorDelegates.lastFallbackReason = previous.lastFallbackReason;
  detectorDelegates.attempted = cloneRecordArrayValues(previous.attempted);
  detectorDelegates.fallbackReasons = { ...previous.fallbackReasons };
}

function cloneRecordArrayValues(value) {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([key, entry]) => [
      key,
      Array.isArray(entry) ? entry.slice() : entry,
    ]),
  );
}

async function detectMotionFrame({
  imageBitmap,
  timestamp = 0,
  mirrored = false,
  inputGeneration,
  configurationKey,
  sourceMeta = {},
} = {}) {
  if (!imageBitmap) {
    throw new Error("Tracking worker detect requires an ImageBitmap frame.");
  }

  try {
    if (sourceMeta?.inputGeneration !== inputGeneration) {
      throw new Error("Tracking worker input generation metadata does not match its request envelope.");
    }
    if (!configurationKey || configurationKey !== loadedConfigurationKey) {
      throw new Error("Tracking worker detect configuration does not match its prepared Pose detector.");
    }

    const preparedSet = bodyTrackerGenerationOwner.getPreparedSet(inputGeneration);
    const poseLandmarker = preparedSet.pose;
    if (!poseLandmarker) {
      throw new Error("Tracking worker prepared detector set has no pose landmarker.");
    }

    const detectionStartedAt = performance.now();
    const poseResults = poseLandmarker.detectForVideo(imageBitmap, timestamp);
    const poseDetectionDurationMs = performance.now() - detectionStartedAt;

    return serializeMotionFrame(createMotionFrame({
      timestamp,
      mirrored,
      poseResults,
      handResults: null,
      face: null,
      sourceMeta: {
        ...sourceMeta,
        trackingRuntime: "worker",
        bodyInputMode: "image-bitmap",
        bodyLandmarkerRunningMode: MEDIAPIPE_BODY_RUNNING_MODE,
        bodyDetectionDurationMs: poseDetectionDurationMs,
        poseDetectionDurationMs,
        bodyTrackerGeneration: inputGeneration,
        bodyTrackerConfigurationKey: loadedConfigurationKey,
        ...bodyTrackerGenerationOwner.getTelemetry(),
      },
    }));
  } finally {
    closeImageBitmap(imageBitmap);
  }
}

function closeAllLandmarkers() {
  bodyTrackerGenerationOwner.dispose();
  loadedConfigurationKey = "";
}

function closeImageBitmap(imageBitmap) {
  try {
    imageBitmap?.close?.();
  } catch {
    // Best-effort cleanup inside the worker.
  }
}

function postWorkerMessage(message) {
  self.postMessage(message);
}

function getErrorDetail(error) {
  return error?.message || String(error);
}
