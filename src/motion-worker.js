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
} from "./motion-frame.js?v=20260618-tracked-channels-1";

let vision = null;
let poseLandmarker = null;
let handLandmarker = null;
let faceLandmarker = null;
let loadedPoseModelUrl = "";
let loadedFaceTrackingEnabled = false;
let loadedFaceLandmarksEnabled = false;
let frameCanvas = null;
let frameContext = null;

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
      postWorkerMessage({ type: "ready", requestId });
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
} = {}) {
  if (!wasmAssetPath || !poseModelUrl || !handModelUrl) {
    throw new Error("Tracking worker init requires wasm, pose, and hand model URLs.");
  }

  if (!vision) {
    vision = await FilesetResolver.forVisionTasks(wasmAssetPath, true);
  }

  if (!handLandmarker) {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: handModelUrl },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  if (!poseLandmarker || loadedPoseModelUrl !== poseModelUrl) {
    const nextPoseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: poseModelUrl },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    closeLandmarker(poseLandmarker);
    poseLandmarker = nextPoseLandmarker;
    loadedPoseModelUrl = poseModelUrl;
  }

  if (faceTrackingEnabled && !faceLandmarker) {
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
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
  }

  loadedFaceTrackingEnabled = Boolean(faceTrackingEnabled);
  loadedFaceLandmarksEnabled = Boolean(faceLandmarksEnabled);
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
