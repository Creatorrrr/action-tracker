import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import { normalizeFace } from "./motion-frame.js?v=20260708-single-hand-side-1";

const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
const FACE_RUNNING_MODE = "IMAGE";
const SOURCE_PTS_EPSILON_SEC = 0.000001;

let vision = null;
let faceLandmarker = null;
let loadedConfigurationKey = "";
let activeGeneration = null;
let latestReservedGeneration = null;
let messageTail = Promise.resolve();

const detectorDelegates = {
  requested: MEDIAPIPE_PREFERRED_DELEGATE,
  fallback: MEDIAPIPE_FALLBACK_DELEGATE,
  face: "unloaded",
  lastFallbackReason: "",
  attempted: [],
  fallbackReasons: {},
};

installMediaPipeModuleFactoryImportBridge();

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (
    message.type === "prepare-generation" ||
    message.type === "reserve-generation"
  ) {
    reserveGenerationAtReceipt(message.inputGeneration);
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
      await initFaceLandmarker(message);
      postWorkerMessage({
        type: "ready",
        requestId,
        configurationKey: loadedConfigurationKey,
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "prepare-generation") {
      const generationMeta = prepareGeneration({
        inputGeneration: message.inputGeneration,
        configurationKey: message.configurationKey,
      });
      postWorkerMessage({
        type: "generation-ready",
        requestId,
        inputGeneration: message.inputGeneration,
        configurationKey: loadedConfigurationKey,
        generationMeta,
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "reserve-generation") {
      activateReservedGeneration(message.inputGeneration);
      postWorkerMessage({
        type: "generation-reserved",
        requestId,
        inputGeneration: message.inputGeneration,
      });
      return;
    }

    if (message.type === "detect") {
      const result = detectFaceFrame(message);
      postWorkerMessage({
        type: "result",
        requestId,
        inputGeneration: result.inputGeneration,
        configurationKey: result.configurationKey,
        sourcePtsSec: result.sourcePtsSec,
        result,
      });
      return;
    }

    if (message.type === "close") {
      closeFaceLandmarker();
      postWorkerMessage({ type: "closed", requestId });
      return;
    }

    throw new Error(`Unsupported face worker message type: ${message.type}`);
  } catch (error) {
    postWorkerMessage({
      type: "error",
      requestId,
      message: getErrorDetail(error),
      code: String(error?.code ?? ""),
    });
  } finally {
    closeImageBitmap(message.imageBitmap);
  }
}

async function initFaceLandmarker({
  wasmAssetPath,
  faceModelUrl,
  delegate = MEDIAPIPE_PREFERRED_DELEGATE,
} = {}) {
  if (!wasmAssetPath || !faceModelUrl) {
    throw new Error("Face worker init requires wasm and face model URLs.");
  }

  const normalizedDelegate = normalizeMediaPipeDelegate(delegate);
  const configurationKey = JSON.stringify([
    String(faceModelUrl),
    normalizedDelegate,
    FACE_RUNNING_MODE,
  ]);
  if (faceLandmarker && configurationKey === loadedConfigurationKey) {
    return;
  }

  if (!vision) {
    vision = await FilesetResolver.forVisionTasks(wasmAssetPath, true);
  }

  const candidate = await createFaceLandmarkerWithDelegate(
    vision,
    faceModelUrl,
    normalizedDelegate,
  );
  const previous = faceLandmarker;
  faceLandmarker = candidate.landmarker;
  loadedConfigurationKey = configurationKey;
  detectorDelegates.requested = normalizedDelegate;
  detectorDelegates.face = candidate.delegate;
  detectorDelegates.attempted = candidate.attempted;
  detectorDelegates.fallbackReasons = candidate.fallbackReason
    ? { face: candidate.fallbackReason }
    : {};
  detectorDelegates.lastFallbackReason = candidate.fallbackReason
    ? `face: ${candidate.fallbackReason}`
    : "";
  closeLandmarker(previous);
}

async function createFaceLandmarkerWithDelegate(
  visionRef,
  faceModelUrl,
  preferredDelegate,
) {
  let preferredError = null;
  const attempted = [];

  for (const delegate of getMediaPipeDelegateAttemptOrder(preferredDelegate)) {
    attempted.push(delegate);
    try {
      const landmarker = await FaceLandmarker.createFromOptions(visionRef, {
        baseOptions: {
          modelAssetPath: faceModelUrl,
          delegate,
        },
        runningMode: FACE_RUNNING_MODE,
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      return {
        landmarker,
        delegate,
        attempted,
        fallbackReason: preferredError ? getErrorDetail(preferredError) : "",
      };
    } catch (error) {
      if (delegate === MEDIAPIPE_FALLBACK_DELEGATE) {
        throw error;
      }
      preferredError = error;
      console.warn(
        `face ${preferredDelegate} delegate failed in worker; retrying with ${MEDIAPIPE_FALLBACK_DELEGATE}.`,
        error,
      );
    }
  }

  throw preferredError ?? new Error("Unable to create face landmarker in worker.");
}

function reserveGenerationAtReceipt(inputGeneration) {
  if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
    return false;
  }
  if (
    latestReservedGeneration !== null &&
    inputGeneration < latestReservedGeneration
  ) {
    return false;
  }
  latestReservedGeneration = inputGeneration;
  return true;
}

function activateReservedGeneration(inputGeneration) {
  assertGeneration(inputGeneration);
  if (inputGeneration !== latestReservedGeneration) {
    throw createGenerationError(
      `Face generation ${inputGeneration} was superseded by ${latestReservedGeneration}.`,
      "FACE_GENERATION_SUPERSEDED",
    );
  }
  activeGeneration = inputGeneration;
}

function prepareGeneration({ inputGeneration, configurationKey } = {}) {
  if (!faceLandmarker || !loadedConfigurationKey) {
    throw new Error("Face worker model is not ready.");
  }
  assertConfigurationKey(configurationKey);
  activateReservedGeneration(inputGeneration);
  return {
    faceGeneration: inputGeneration,
    faceGenerationStrategy: "stateless-image-rebind",
    faceLandmarkerRunningMode: FACE_RUNNING_MODE,
  };
}

function detectFaceFrame({
  imageBitmap,
  timestamp = 0,
  sourcePtsSec,
  inputGeneration,
  configurationKey,
  sourceMeta = {},
  includeLandmarks = false,
} = {}) {
  if (!imageBitmap) {
    throw new Error("Face worker detect requires an ImageBitmap frame.");
  }
  if (!faceLandmarker) {
    throw new Error("Face worker model is not ready.");
  }
  assertConfigurationKey(configurationKey);
  assertGeneration(inputGeneration);
  if (
    inputGeneration !== activeGeneration ||
    inputGeneration !== latestReservedGeneration
  ) {
    throw createGenerationError(
      `Face worker rejected unprepared generation ${inputGeneration}.`,
      "FACE_GENERATION_STALE",
    );
  }
  if (sourceMeta?.inputGeneration !== inputGeneration) {
    throw createGenerationError(
      "Face worker input generation metadata does not match its request envelope.",
      "FACE_GENERATION_STALE",
    );
  }
  const requestSourcePtsSec = Number.isFinite(sourcePtsSec)
    ? Number(sourcePtsSec)
    : null;
  const metadataSourcePtsSec = Number.isFinite(sourceMeta?.sourcePtsSec)
    ? Number(sourceMeta.sourcePtsSec)
    : null;
  if (
    !Number.isFinite(requestSourcePtsSec) ||
    !Number.isFinite(metadataSourcePtsSec) ||
    Math.abs(requestSourcePtsSec - metadataSourcePtsSec) >
      SOURCE_PTS_EPSILON_SEC
  ) {
    const error = new Error(
      "Face worker source PTS metadata does not match its request envelope.",
    );
    error.code = "FACE_SOURCE_PTS_MISMATCH";
    throw error;
  }

  const detectionStartedAt = performance.now();
  const face = normalizeFace(faceLandmarker.detect(imageBitmap), {
    includeLandmarks: Boolean(includeLandmarks),
  });
  const detectionDurationMs = Math.max(0, performance.now() - detectionStartedAt);
  const resultSourceMeta = {
    ...sourceMeta,
    trackingRuntime: "face-worker",
    faceGeneration: inputGeneration,
    faceTrackerConfigurationKey: loadedConfigurationKey,
    faceLandmarkerRunningMode: FACE_RUNNING_MODE,
    faceDetectionDurationMs: detectionDurationMs,
  };

  if (face) {
    face.sourceMeta = { ...resultSourceMeta };
  }
  return {
    timestamp: Number(timestamp) || 0,
    inputGeneration,
    configurationKey: loadedConfigurationKey,
    sourcePtsSec: requestSourcePtsSec,
    sourceMeta: resultSourceMeta,
    face,
  };
}

function assertGeneration(inputGeneration) {
  if (!Number.isSafeInteger(inputGeneration) || inputGeneration < 0) {
    throw new TypeError("inputGeneration must be a non-negative safe integer");
  }
}

function assertConfigurationKey(configurationKey) {
  if (!configurationKey || configurationKey !== loadedConfigurationKey) {
    const error = new Error(
      "Face worker request configuration does not match the loaded model.",
    );
    error.code = "FACE_CONFIGURATION_MISMATCH";
    throw error;
  }
}

function createGenerationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getDetectorDelegates() {
  return {
    ...detectorDelegates,
    attempted: { face: [...detectorDelegates.attempted] },
    fallbackReasons: { ...detectorDelegates.fallbackReasons },
  };
}

function getMediaPipeDelegateAttemptOrder(preferredDelegate) {
  return preferredDelegate === MEDIAPIPE_FALLBACK_DELEGATE
    ? [MEDIAPIPE_FALLBACK_DELEGATE]
    : [MEDIAPIPE_PREFERRED_DELEGATE, MEDIAPIPE_FALLBACK_DELEGATE];
}

function normalizeMediaPipeDelegate(value) {
  return String(value ?? "").toLowerCase() === "cpu"
    ? MEDIAPIPE_FALLBACK_DELEGATE
    : MEDIAPIPE_PREFERRED_DELEGATE;
}

function closeFaceLandmarker() {
  const landmarker = faceLandmarker;
  faceLandmarker = null;
  loadedConfigurationKey = "";
  activeGeneration = null;
  latestReservedGeneration = null;
  detectorDelegates.face = "unloaded";
  closeLandmarker(landmarker);
}

function closeLandmarker(landmarker) {
  try {
    landmarker?.close?.();
  } catch {
    // Best-effort cleanup inside the worker.
  }
}

function closeImageBitmap(imageBitmap) {
  try {
    imageBitmap?.close?.();
  } catch {
    // A transferred ImageBitmap may already be detached.
  }
}

function postWorkerMessage(message) {
  self.postMessage(message);
}

function getErrorDetail(error) {
  return error?.message || String(error);
}
