import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import {
  createMotionFrame,
  normalizeFace,
  serializeMotionFrame,
} from "./motion-frame.js?v=20260708-single-hand-side-1";

let vision = null;
let poseLandmarker = null;
let handLandmarker = null;
let faceLandmarker = null;
let loadedPoseModelUrl = "";
let loadedFaceTrackingEnabled = false;
let loadedFaceLandmarksEnabled = false;
let frameCanvas = null;
let frameContext = null;
const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
let requestedDelegate = MEDIAPIPE_PREFERRED_DELEGATE;
const detectorDelegates = {
  requested: requestedDelegate,
  fallback: MEDIAPIPE_FALLBACK_DELEGATE,
  hand: "unloaded",
  pose: "unloaded",
  face: "unloaded",
  lastFallbackReason: "",
  attempted: {},
  fallbackReasons: {},
};

installMediaPipeModuleFactoryImportBridge();

self.addEventListener("message", (event) => {
  void handleMessage(event.data ?? {});
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
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "detect") {
      const frame = await detectMotionFrame(message);
      postWorkerMessage({ type: "result", requestId, frame });
      return;
    }

    if (message.type === "close") {
      closeAllLandmarkers();
      postWorkerMessage({ type: "closed", requestId });
      return;
    }

    throw new Error(`Unsupported worker message type: ${message.type}`);
  } catch (error) {
    closeImageBitmap(message.imageBitmap);
    postWorkerMessage({
      type: "error",
      requestId,
      message: getErrorDetail(error),
    });
  }
}

async function initModels({
  wasmAssetPath,
  poseModelUrl,
  handModelUrl,
  faceModelUrl,
  faceTrackingEnabled = false,
  faceLandmarksEnabled = false,
  delegate = MEDIAPIPE_PREFERRED_DELEGATE,
} = {}) {
  if (!wasmAssetPath || !poseModelUrl || !handModelUrl) {
    throw new Error("Tracking worker init requires wasm, pose, and hand model URLs.");
  }

  if (!vision) {
    vision = await FilesetResolver.forVisionTasks(wasmAssetPath, true);
  }

  requestedDelegate = normalizeMediaPipeDelegate(delegate);
  detectorDelegates.requested = requestedDelegate;
  resetDetectorDelegateTelemetry();

  if (!handLandmarker) {
    handLandmarker = await createLandmarkerWithDelegate("hand", HandLandmarker, vision, {
      baseOptions: { modelAssetPath: handModelUrl },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  if (!poseLandmarker || loadedPoseModelUrl !== poseModelUrl) {
    const nextPoseLandmarker = await createLandmarkerWithDelegate("pose", PoseLandmarker, vision, {
      baseOptions: { modelAssetPath: poseModelUrl },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    closeLandmarker(poseLandmarker);
    poseLandmarker = nextPoseLandmarker;
    loadedPoseModelUrl = poseModelUrl;
  }

  if (faceTrackingEnabled && !faceLandmarker) {
    faceLandmarker = await createLandmarkerWithDelegate("face", FaceLandmarker, vision, {
      baseOptions: { modelAssetPath: faceModelUrl },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
  }

  if (!faceTrackingEnabled && faceLandmarker) {
    closeLandmarker(faceLandmarker);
    faceLandmarker = null;
    detectorDelegates.face = "unloaded";
  }

  loadedFaceTrackingEnabled = Boolean(faceTrackingEnabled);
  loadedFaceLandmarksEnabled = Boolean(faceLandmarksEnabled);
}

async function createLandmarkerWithDelegate(detectorKey, Landmarker, visionRef, options) {
  let preferredError = null;

  for (const delegate of getMediaPipeDelegateAttemptOrder()) {
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
      if (delegate === MEDIAPIPE_FALLBACK_DELEGATE) {
        throw error;
      }

      preferredError = error;
      console.warn(
        `${detectorKey} ${MEDIAPIPE_PREFERRED_DELEGATE} delegate failed in worker; retrying with ${MEDIAPIPE_FALLBACK_DELEGATE}.`,
        error,
      );
    }
  }

  throw preferredError ?? new Error(`Unable to create ${detectorKey} landmarker in worker.`);
}

function getMediaPipeDelegateAttemptOrder() {
  if (requestedDelegate === MEDIAPIPE_FALLBACK_DELEGATE) {
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
  sourceMeta = {},
  faceTrackingEnabled = false,
  faceLandmarksEnabled = false,
} = {}) {
  if (!imageBitmap) {
    throw new Error("Tracking worker detect requires an ImageBitmap frame.");
  }

  if (!poseLandmarker || !handLandmarker) {
    throw new Error("Tracking worker models are not ready.");
  }

  const videoFrame = drawImageBitmapToImageData(imageBitmap);
  closeImageBitmap(imageBitmap);
  const poseResults = poseLandmarker.detectForVideo(videoFrame, timestamp);
  const handResults = handLandmarker.detectForVideo(videoFrame, timestamp);
  const face = detectFace(videoFrame, timestamp, faceTrackingEnabled, faceLandmarksEnabled);

  return serializeMotionFrame(createMotionFrame({
    timestamp,
    mirrored,
    poseResults,
    handResults,
    face,
    sourceMeta: {
      ...sourceMeta,
      trackingRuntime: "worker",
    },
  }));
}

function drawImageBitmapToImageData(imageBitmap) {
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("Tracking worker requires OffscreenCanvas for MediaPipe detection.");
  }

  const width = imageBitmap.width;
  const height = imageBitmap.height;

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Tracking worker received an invalid ImageBitmap frame size.");
  }

  if (!frameCanvas || frameCanvas.width !== width || frameCanvas.height !== height) {
    frameCanvas = new OffscreenCanvas(width, height);
    frameContext = frameCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: true,
    });
  }

  if (!frameContext) {
    throw new Error("Tracking worker could not create an OffscreenCanvas 2D context.");
  }

  frameContext.drawImage(imageBitmap, 0, 0, width, height);
  return frameContext.getImageData(0, 0, width, height);
}

function detectFace(videoFrame, timestamp, faceTrackingEnabled, faceLandmarksEnabled) {
  if (!faceTrackingEnabled || !faceLandmarker || !loadedFaceTrackingEnabled) {
    return null;
  }

  loadedFaceLandmarksEnabled = Boolean(faceLandmarksEnabled);

  return normalizeFace(faceLandmarker.detectForVideo(videoFrame, timestamp), {
    includeLandmarks: loadedFaceLandmarksEnabled,
  });
}

function closeAllLandmarkers() {
  closeLandmarker(poseLandmarker);
  closeLandmarker(handLandmarker);
  closeLandmarker(faceLandmarker);
  poseLandmarker = null;
  handLandmarker = null;
  faceLandmarker = null;
  loadedPoseModelUrl = "";
  loadedFaceTrackingEnabled = false;
  loadedFaceLandmarksEnabled = false;
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
    // Best-effort cleanup inside the worker.
  }
}

function postWorkerMessage(message) {
  self.postMessage(message);
}

function getErrorDetail(error) {
  return error?.message || String(error);
}
