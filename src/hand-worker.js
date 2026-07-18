import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import {
  createMotionFrame,
  serializeMotionFrame,
} from "./motion-frame.js?v=20260708-single-hand-side-1";
import {
  HAND_ROI_SLOT_SIZE,
  buildHandRoiDrawPlan,
  buildPoseGuidedHandRois,
  mapSquareHandLandmarksToSource,
  stabilizePoseGuidedHandRoi,
} from "./hand-roi.js?v=20260715-stable-hand-roi-1";

const MEDIAPIPE_PREFERRED_DELEGATE = "GPU";
const MEDIAPIPE_FALLBACK_DELEGATE = "CPU";
const DEFAULT_HAND_DELEGATE = MEDIAPIPE_FALLBACK_DELEGATE;
const HAND_LANDMARKER_RUNNING_MODE = "IMAGE";
const HAND_SIDES = Object.freeze(["Left", "Right"]);
const HAND_INPUT_SIZE = HAND_ROI_SLOT_SIZE;
const MIN_HAND_DETECTION_CONFIDENCE = 0.35;
const MIN_HAND_PRESENCE_CONFIDENCE = 0.35;
const MIN_HAND_TRACKING_CONFIDENCE = 0.35;
const HAND_ROI_POSE_HOLD_SEC = 0.15;
const HAND_ROI_UNSAFE_CONFIRMATION_COUNT = 2;
const HAND_ROI_MISS_REACQUIRE_COUNTS = Object.freeze([2, 4]);
const HAND_ROI_MISS_REACQUIRE_MIN_SEC = Object.freeze([0.04, 0.12]);
const HAND_ROI_MAX_EXPANSION_LEVEL = 2;
const HAND_ROI_BASE_EXPANSION_SCALE = 1.3;
const HAND_ROI_EXPANSION_STEP = 1.25;

let vision = null;
let handWorkerSide = null;
let handLandmarker = null;
let loadedWasmAssetPath = "";
let loadedHandModelUrl = "";
let requestedDelegate = DEFAULT_HAND_DELEGATE;
let frameCanvas = null;
let frameContext = null;
let activeGeneration = null;
let lastTrackerTimestampMs = null;
let roiEpisode = null;

const detectorDelegates = {
  requested: requestedDelegate,
  fallback: MEDIAPIPE_FALLBACK_DELEGATE,
  hand: "unloaded",
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
      await initHandLandmarker(message);
      postWorkerMessage({
        type: "ready",
        requestId,
        handWorkerSide,
        detectorDelegates: getDetectorDelegates(),
      });
      return;
    }

    if (message.type === "detect") {
      const frame = await detectHandFrame(message);
      postWorkerMessage({
        type: "result",
        requestId,
        handWorkerSide,
        frame,
      });
      return;
    }

    if (message.type === "close") {
      const closingWorkerSide = handWorkerSide;
      closeHandLandmarker();
      postWorkerMessage({
        type: "closed",
        requestId,
        handWorkerSide: closingWorkerSide,
      });
      return;
    }

    throw new Error(`Unsupported hand worker message type: ${message.type}`);
  } catch (error) {
    postWorkerMessage({
      type: "error",
      requestId,
      handWorkerSide,
      message: getErrorDetail(error),
    });
  } finally {
    closeImageBitmap(message.imageBitmap);
  }
}

async function initHandLandmarker({
  workerSide,
  wasmAssetPath,
  handModelUrl,
  delegate = DEFAULT_HAND_DELEGATE,
} = {}) {
  const nextWorkerSide = normalizeHandWorkerSide(workerSide);
  if (!wasmAssetPath || !handModelUrl) {
    throw new Error("Hand worker init requires wasm and hand model URLs.");
  }

  const normalizedDelegate = normalizeMediaPipeDelegate(delegate);
  const needsVisionReload = !vision || loadedWasmAssetPath !== wasmAssetPath;
  const needsLandmarkerReload = (
    !handLandmarker ||
    handWorkerSide !== nextWorkerSide ||
    needsVisionReload ||
    loadedHandModelUrl !== handModelUrl ||
    requestedDelegate !== normalizedDelegate
  );

  requestedDelegate = normalizedDelegate;
  detectorDelegates.requested = requestedDelegate;

  if (needsLandmarkerReload) {
    resetDetectorDelegateTelemetry();
    closeHandLandmarkerInstance();
    handWorkerSide = nextWorkerSide;
    resetOwnedRuntimeState();
  }

  if (needsVisionReload) {
    vision = null;
    loadedWasmAssetPath = "";
    vision = await FilesetResolver.forVisionTasks(wasmAssetPath, true);
    loadedWasmAssetPath = wasmAssetPath;
  }

  if (needsLandmarkerReload) {
    try {
      handLandmarker = await createLandmarkerWithDelegate(
        HandLandmarker,
        vision,
        {
          baseOptions: { modelAssetPath: handModelUrl },
          runningMode: HAND_LANDMARKER_RUNNING_MODE,
          numHands: 1,
          minHandDetectionConfidence: MIN_HAND_DETECTION_CONFIDENCE,
          minHandPresenceConfidence: MIN_HAND_PRESENCE_CONFIDENCE,
          minTrackingConfidence: MIN_HAND_TRACKING_CONFIDENCE,
        },
        requestedDelegate,
      );
    } catch (error) {
      handLandmarker = null;
      loadedHandModelUrl = "";
      throw error;
    }
    loadedHandModelUrl = handModelUrl;
  }

  handWorkerSide = nextWorkerSide;
}

async function createLandmarkerWithDelegate(
  Landmarker,
  visionRef,
  options,
  preferredDelegate,
) {
  let preferredError = null;

  for (const delegate of getMediaPipeDelegateAttemptOrder(preferredDelegate)) {
    recordDetectorDelegateAttempt(delegate);

    try {
      const landmarker = await Landmarker.createFromOptions(visionRef, {
        ...options,
        baseOptions: {
          ...(options.baseOptions ?? {}),
          delegate,
        },
      });
      markDetectorDelegate(delegate, preferredError);
      return landmarker;
    } catch (error) {
      if (delegate === MEDIAPIPE_FALLBACK_DELEGATE) {
        throw error;
      }

      preferredError = error;
      console.warn(
        `hand ${preferredDelegate} delegate failed in worker; retrying with ${MEDIAPIPE_FALLBACK_DELEGATE}.`,
        error,
      );
    }
  }

  throw preferredError ?? new Error("Unable to create hand landmarker in worker.");
}

async function detectHandFrame({
  imageBitmap,
  timestamp = 0,
  mirrored = false,
  sourceMeta = {},
  poseLandmarks = null,
  requestedSide = null,
} = {}) {
  if (!imageBitmap) {
    throw new Error("Hand worker detect requires an ImageBitmap frame.");
  }

  const side = requireMatchingRequestedSide(requestedSide);
  if (!handLandmarker) {
    throw new Error(`Hand worker ${side} model is not ready.`);
  }

  await resetOwnedVideoTrackerForGeneration(sourceMeta?.inputGeneration);
  const episode = getOwnedRoiEpisode(side);
  const handResults = {
    leftHandLandmarks: null,
    rightHandLandmarks: null,
    leftHandWorldLandmarks: null,
    rightHandWorldLandmarks: null,
  };
  const detectedSides = [];
  const availableSides = [];
  const detectionSides = [];
  const unavailableSides = [];
  const paddingRatioBySide = {};
  const visibleRatioBySide = {};
  const sourceSizeBySide = {};
  const roiEpisodeReasons = [];
  const trackerResetSides = [];
  const heldPoseRoiSides = [];
  const staleSourcePtsSides = [];
  let handDetectionDurationMs = 0;
  let handTrackerResetDurationMs = 0;
  let roiRecommitCount = 0;
  let trackerTimestampMs = null;
  const sourcePtsSec = resolveFrameSourcePtsSec(timestamp, sourceMeta);

  if (isStaleHandTrackerTimestamp(timestamp, sourceMeta)) {
    staleSourcePtsSides.push(side);
  } else {
    const squareInput = drawImageBitmapToPoseGuidedRoi(
      imageBitmap,
      poseLandmarks,
      side,
      sourcePtsSec,
    );
    if (!squareInput) {
      unavailableSides.push(side);
    } else {
      availableSides.push(side);
      roiEpisodeReasons.push(`${side}:${squareInput.episodeReason}`);
      if (squareInput.heldPoseRoi) {
        heldPoseRoiSides.push(side);
      }
      if (squareInput.roiRecommitted) {
        roiRecommitCount += 1;
      }
      if (squareInput.trackerResetRequired) {
        const resetStartedAt = performance.now();
        await resetOwnedVideoTracker();
        handTrackerResetDurationMs += Math.max(
          0,
          performance.now() - resetStartedAt,
        );
        episode.pendingTrackerReset = false;
        episode.trackerResetCount += 1;
        trackerResetSides.push(side);
      }
      paddingRatioBySide[side] = squareInput.drawPlan.paddingRatio;
      visibleRatioBySide[side] = squareInput.drawPlan.visibleRatio;
      sourceSizeBySide[side] = squareInput.roi.width;
      trackerTimestampMs = resolveHandTrackerTimestamp(timestamp, sourceMeta);
      if (trackerTimestampMs === null) {
        staleSourcePtsSides.push(side);
      } else {
        detectionSides.push(side);
        const detectionStartedAt = performance.now();
        const rawHandResults = handLandmarker.detect(squareInput.videoFrame);
        handDetectionDurationMs += Math.max(
          0,
          performance.now() - detectionStartedAt,
        );
        const mapped = mapSingleSideHandResultsToSource(
          rawHandResults,
          squareInput.roi,
          side,
        );
        const key = side.toLowerCase();
        handResults[`${key}HandLandmarks`] =
          mapped.handResults[`${key}HandLandmarks`];
        handResults[`${key}HandWorldLandmarks`] =
          mapped.handResults[`${key}HandWorldLandmarks`];
        if (mapped.detectedSides.includes(side)) {
          detectedSides.push(side);
        }
        updateHandRoiEpisodeAfterDetection(
          side,
          mapped.detectedSides.includes(side),
          sourcePtsSec,
        );
      }
    }
  }

  const paddingValues = Object.values(paddingRatioBySide);
  const visibleValues = Object.values(visibleRatioBySide);
  const sourceSizes = Object.values(sourceSizeBySide);

  return serializeMotionFrame(createMotionFrame({
    timestamp,
    mirrored,
    poseResults: { landmarks: [poseLandmarks] },
    handResults,
    sourceMeta: {
      ...sourceMeta,
      handWorkerSide: side,
      trackingRuntime: "hand-worker",
      handDetectionRan: detectionSides.length > 0,
      handDetectionInputMode: availableSides.length > 0
        ? "pose-guided-single-side-image-offscreen-canvas"
        : "pose-guided-roi-unavailable",
      handRequestedSide: side,
      handRequestedSides: side,
      handRoiAvailable: availableSides.length > 0,
      handRoiAvailableSides: availableSides.join(","),
      handRoiUnavailableSides: unavailableSides.join(","),
      handRoiUnavailableCount: unavailableSides.length,
      handDetectedSide: detectedSides[0] ?? null,
      handDetectedSides: detectedSides.join(","),
      handRoiCount: availableSides.length,
      handRoiPaddingRatio: paddingValues.length > 0 ? Math.max(...paddingValues) : null,
      handRoiVisibleRatio: visibleValues.length > 0 ? Math.min(...visibleValues) : null,
      handRoiSourceSize: sourceSizes.length > 0 ? Math.max(...sourceSizes) : null,
      handRoiPaddingRatioBySide: paddingRatioBySide,
      handRoiVisibleRatioBySide: visibleRatioBySide,
      handRoiSourceSizeBySide: sourceSizeBySide,
      handRoiEpisodeReasons: roiEpisodeReasons.join(","),
      handRoiRecommitCount: roiRecommitCount,
      handRoiHeldPoseSideCount: heldPoseRoiSides.length,
      handRoiHeldPoseSides: heldPoseRoiSides.join(","),
      handTrackerResetCount: trackerResetSides.length,
      handTrackerResetSides: trackerResetSides.join(","),
      handTrackerStaleSourcePtsSkipCount: staleSourcePtsSides.length,
      handTrackerStaleSourcePtsSides: staleSourcePtsSides.join(","),
      handRoiTransformVersionLeft: side === "Left"
        ? episode.transformVersion
        : null,
      handRoiTransformVersionRight: side === "Right"
        ? episode.transformVersion
        : null,
      handRoiExpansionLevelLeft: side === "Left"
        ? episode.expansionLevel
        : null,
      handRoiExpansionLevelRight: side === "Right"
        ? episode.expansionLevel
        : null,
      handRoiMissStreakLeft: side === "Left" ? episode.missStreak : null,
      handRoiMissStreakRight: side === "Right" ? episode.missStreak : null,
      handTrackerTimestampMs: trackerTimestampMs,
      handTrackerTimestampSource: Number.isFinite(Number(sourceMeta?.sourcePtsSec))
        ? "source-pts"
        : "callback-monotonic",
      handInputWidth: HAND_INPUT_SIZE,
      handInputHeight: HAND_INPUT_SIZE,
      handDetectionDurationMs,
      handTrackerResetDurationMs,
    },
  }));
}

function drawImageBitmapToPoseGuidedRoi(
  imageBitmap,
  poseLandmarks,
  requestedSide,
  sourcePtsSec,
) {
  if (typeof OffscreenCanvas !== "function") {
    throw new Error("Hand worker requires OffscreenCanvas for MediaPipe detection.");
  }

  const sourceWidth = imageBitmap.width;
  const sourceHeight = imageBitmap.height;

  if (
    !Number.isFinite(sourceWidth) ||
    sourceWidth <= 0 ||
    !Number.isFinite(sourceHeight) ||
    sourceHeight <= 0
  ) {
    throw new Error("Hand worker received an invalid ImageBitmap frame size.");
  }

  const rois = buildPoseGuidedHandRois(poseLandmarks, sourceWidth, sourceHeight);
  const candidate = rois.find((roi) => roi.side === requestedSide) ?? null;
  const episode = getOwnedRoiEpisode(requestedSide);
  if (candidate) {
    episode.lastCandidate = candidate;
    episode.lastPoseSourcePtsSec = sourcePtsSec;
  }
  const poseGapSec = Number.isFinite(episode.lastPoseSourcePtsSec)
    ? Math.max(0, sourcePtsSec - episode.lastPoseSourcePtsSec)
    : Infinity;
  const reusePrevious = !candidate &&
    Boolean(episode.committedRoi) &&
    poseGapSec <= HAND_ROI_POSE_HOLD_SEC;
  if (!candidate && !reusePrevious) {
    if (episode.trackerHasFrames) {
      episode.pendingTrackerReset = true;
    }
    return null;
  }

  const useCurrentPoseRoi = HAND_LANDMARKER_RUNNING_MODE === "IMAGE" &&
    Boolean(candidate);
  const forceRecommit = !useCurrentPoseRoi &&
    episode.pendingTrackerReset &&
    Boolean(candidate);
  const expansionScale = HAND_ROI_BASE_EXPANSION_SCALE *
    HAND_ROI_EXPANSION_STEP ** episode.expansionLevel;
  let stableRoi = stabilizePoseGuidedHandRoi(
    candidate,
    useCurrentPoseRoi ? null : episode.committedRoi,
    {
      reusePrevious,
      forceRecommit,
      expansionScale,
      reacquireExpansionScale: expansionScale,
    },
  );
  if (
    stableRoi.transformChanged &&
    !forceRecommit &&
    stableRoi.reason === "candidate-left-outer-band"
  ) {
    episode.unsafeCandidateSamples += 1;
    if (episode.unsafeCandidateSamples < HAND_ROI_UNSAFE_CONFIRMATION_COUNT) {
      stableRoi = {
        ...stableRoi,
        roi: episode.committedRoi,
        transformChanged: false,
        reason: "candidate-unsafe-confirming",
      };
    } else {
      episode.unsafeCandidateSamples = 0;
    }
  } else if (
    stableRoi.reason === "episode-stable" ||
    stableRoi.reason === "episode-start" ||
    stableRoi.reason === "forced-reacquire" ||
    stableRoi.reason === "candidate-hard-escape"
  ) {
    episode.unsafeCandidateSamples = 0;
  }

  const episodeStarting = !episode.committedRoi && Boolean(stableRoi.roi);
  const roiRecommitted = Boolean(
    HAND_LANDMARKER_RUNNING_MODE === "VIDEO" &&
    episode.committedRoi &&
    stableRoi.transformChanged,
  );
  if (useCurrentPoseRoi && stableRoi.roi) {
    episode.committedRoi = stableRoi.roi;
    episode.transformVersion += 1;
    episode.lastCommitReason = episodeStarting
      ? stableRoi.reason
      : "current-pose-image";
  } else if (episodeStarting || stableRoi.transformChanged) {
    episode.committedRoi = stableRoi.roi;
    episode.transformVersion += 1;
    episode.lastCommitReason = stableRoi.reason;
    if (roiRecommitted) {
      episode.recommitCount += 1;
    }
  }
  const roi = episode.committedRoi;
  if (!roi) {
    return null;
  }
  const trackerResetRequired = HAND_LANDMARKER_RUNNING_MODE === "VIDEO" &&
    episode.trackerHasFrames && (
    roiRecommitted || episode.pendingTrackerReset
  );

  if (
    !frameCanvas ||
    frameCanvas.width !== HAND_INPUT_SIZE ||
    frameCanvas.height !== HAND_INPUT_SIZE
  ) {
    frameCanvas = new OffscreenCanvas(HAND_INPUT_SIZE, HAND_INPUT_SIZE);
    frameContext = frameCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  if (!frameContext) {
    throw new Error("Hand worker could not create an OffscreenCanvas 2D context.");
  }

  frameContext.fillStyle = "black";
  frameContext.fillRect(0, 0, HAND_INPUT_SIZE, HAND_INPUT_SIZE);
  const drawPlan = buildHandRoiDrawPlan(roi, {
    inputWidth: HAND_INPUT_SIZE,
    inputHeight: HAND_INPUT_SIZE,
  });
  if (!drawPlan) {
    return null;
  }
  frameContext.drawImage(
    imageBitmap,
    drawPlan.sourceX,
    drawPlan.sourceY,
    drawPlan.sourceWidth,
    drawPlan.sourceHeight,
    drawPlan.destinationX,
    drawPlan.destinationY,
    drawPlan.destinationWidth,
    drawPlan.destinationHeight,
  );
  return {
    videoFrame: frameCanvas,
    roi,
    drawPlan,
    episodeReason: useCurrentPoseRoi && !episodeStarting
      ? "current-pose-image"
      : stableRoi.reason,
    heldPoseRoi: stableRoi.reason === "held-pose-gap",
    roiRecommitted,
    trackerResetRequired,
  };
}

function mapSingleSideHandResultsToSource(results, roi, side) {
  const landmarkGroups = Array.isArray(results?.landmarks)
    ? results.landmarks
    : [];
  const worldLandmarkGroups = Array.isArray(results?.worldLandmarks)
    ? results.worldLandmarks
    : [];
  const handednessGroups = Array.isArray(results?.handednesses)
    ? results.handednesses
    : [];
  let best = null;
  landmarkGroups.forEach((squareLandmarks, index) => {
    const landmarks = mapSquareHandLandmarksToSource(squareLandmarks, roi, {
      inputSize: HAND_INPUT_SIZE,
    });
    if (!landmarks) {
      return;
    }
    const candidate = {
      landmarks,
      worldLandmarks: Array.isArray(worldLandmarkGroups[index])
        ? worldLandmarkGroups[index]
        : null,
      score: readHandednessScore(handednessGroups[index]),
    };
    if (!best || candidate.score >= best.score) {
      best = candidate;
    }
  });

  const left = side === "Left" ? best : null;
  const right = side === "Right" ? best : null;
  return {
    handResults: {
      leftHandLandmarks: left?.landmarks ?? null,
      rightHandLandmarks: right?.landmarks ?? null,
      leftHandWorldLandmarks: left?.worldLandmarks ?? null,
      rightHandWorldLandmarks: right?.worldLandmarks ?? null,
    },
    detectedSides: best ? [side] : [],
  };
}

function createHandRoiEpisode(side) {
  return {
    side,
    committedRoi: null,
    lastCandidate: null,
    lastPoseSourcePtsSec: null,
    lastAcceptedSourcePtsSec: null,
    firstMissSourcePtsSec: null,
    missStreak: 0,
    unsafeCandidateSamples: 0,
    expansionLevel: 0,
    transformVersion: 0,
    recommitCount: 0,
    trackerResetCount: 0,
    trackerHasFrames: false,
    pendingTrackerReset: false,
    lastCommitReason: "idle",
  };
}

function getOwnedRoiEpisode(side) {
  if (
    side !== handWorkerSide ||
    !roiEpisode ||
    roiEpisode.side !== handWorkerSide
  ) {
    throw new Error(`Hand worker has no owned ${side} ROI episode state.`);
  }
  return roiEpisode;
}

function resolveFrameSourcePtsSec(timestamp, sourceMeta) {
  const sourcePtsSec = Number(sourceMeta?.sourcePtsSec);
  if (Number.isFinite(sourcePtsSec)) {
    return sourcePtsSec;
  }
  const fallbackTimestamp = Number(timestamp);
  if (!Number.isFinite(fallbackTimestamp)) {
    throw new Error("Hand worker requires a finite source PTS or timestamp.");
  }
  return fallbackTimestamp / 1000;
}

function updateHandRoiEpisodeAfterDetection(side, detected, sourcePtsSec) {
  const episode = getOwnedRoiEpisode(side);
  episode.trackerHasFrames = true;
  episode.lastAcceptedSourcePtsSec = sourcePtsSec;
  if (detected) {
    episode.firstMissSourcePtsSec = null;
    episode.missStreak = 0;
    if (HAND_LANDMARKER_RUNNING_MODE === "IMAGE") {
      episode.expansionLevel = 0;
    }
    episode.pendingTrackerReset = false;
    return;
  }

  if (!Number.isFinite(episode.firstMissSourcePtsSec)) {
    episode.firstMissSourcePtsSec = sourcePtsSec;
  }
  episode.missStreak += 1;
  const missDurationSec = Math.max(
    0,
    sourcePtsSec - episode.firstMissSourcePtsSec,
  );
  const expansionIndex = Math.min(
    episode.expansionLevel,
    HAND_ROI_MISS_REACQUIRE_COUNTS.length - 1,
  );
  if (
    episode.expansionLevel < HAND_ROI_MAX_EXPANSION_LEVEL &&
    episode.missStreak >= HAND_ROI_MISS_REACQUIRE_COUNTS[expansionIndex] &&
    missDurationSec >= HAND_ROI_MISS_REACQUIRE_MIN_SEC[expansionIndex]
  ) {
    episode.expansionLevel += 1;
    episode.pendingTrackerReset = true;
  }
}

function normalizeHandWorkerSide(value) {
  if (!HAND_SIDES.includes(value)) {
    throw new Error(
      `Hand worker init requires workerSide Left or Right; received ${String(value)}.`,
    );
  }
  return value;
}

function requireMatchingRequestedSide(value) {
  if (!HAND_SIDES.includes(value)) {
    throw new Error(
      `Hand worker detect requires requestedSide Left or Right; received ${String(value)}.`,
    );
  }
  if (!handWorkerSide) {
    throw new Error("Hand worker is not initialized with an owned side.");
  }
  if (value !== handWorkerSide) {
    throw new Error(
      `Hand worker ${handWorkerSide} cannot detect requestedSide ${value}.`,
    );
  }
  return value;
}

function resolveHandTrackerTimestamp(fallbackTimestamp, sourceMeta) {
  const candidate = getHandTrackerTimestampCandidate(
    fallbackTimestamp,
    sourceMeta,
  );
  if (!Number.isFinite(candidate)) {
    throw new Error("Hand worker requires a finite tracker timestamp.");
  }

  const previous = lastTrackerTimestampMs;
  if (Number.isFinite(previous) && candidate <= previous) {
    return null;
  }
  lastTrackerTimestampMs = candidate;
  return candidate;
}

function isStaleHandTrackerTimestamp(fallbackTimestamp, sourceMeta) {
  const candidate = getHandTrackerTimestampCandidate(
    fallbackTimestamp,
    sourceMeta,
  );
  if (!Number.isFinite(candidate)) {
    throw new Error("Hand worker requires a finite tracker timestamp.");
  }
  const previous = lastTrackerTimestampMs;
  return Number.isFinite(previous) && candidate <= previous;
}

function getHandTrackerTimestampCandidate(fallbackTimestamp, sourceMeta) {
  const sourcePtsSec = Number(sourceMeta?.sourcePtsSec);
  return Number.isFinite(sourcePtsSec)
    ? sourcePtsSec * 1000
    : Number(fallbackTimestamp);
}

async function resetOwnedVideoTracker() {
  if (!handWorkerSide || !handLandmarker) {
    throw new Error("Hand worker cannot reset its missing owned landmarker.");
  }
  if (HAND_LANDMARKER_RUNNING_MODE === "VIDEO") {
    if (typeof handLandmarker.setOptions !== "function") {
      throw new Error(
        `Hand worker cannot reset ${handWorkerSide} VIDEO tracker state.`,
      );
    }
    await handLandmarker.setOptions({ runningMode: "IMAGE" });
    await handLandmarker.setOptions({ runningMode: "VIDEO" });
  }
  lastTrackerTimestampMs = null;
  if (roiEpisode) {
    roiEpisode.trackerHasFrames = false;
  }
}

async function resetOwnedVideoTrackerForGeneration(value) {
  const generation = Number(value);
  if (!Number.isFinite(generation)) {
    return;
  }
  if (activeGeneration === null) {
    activeGeneration = generation;
    resetOwnedTrackingState();
    return;
  }
  if (generation === activeGeneration) {
    return;
  }

  await resetOwnedVideoTracker();
  activeGeneration = generation;
  resetOwnedTrackingState();
}

function resetOwnedTrackingState() {
  lastTrackerTimestampMs = null;
  roiEpisode = handWorkerSide
    ? createHandRoiEpisode(handWorkerSide)
    : null;
}

function resetOwnedRuntimeState() {
  activeGeneration = null;
  resetOwnedTrackingState();
}

function readHandednessScore(group) {
  const entry = Array.isArray(group) ? group[0] : group;
  const score = Number(entry?.score ?? entry?.probability ?? 0);
  return Number.isFinite(score) ? score : 0;
}

function getMediaPipeDelegateAttemptOrder(preferredDelegate) {
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

function markDetectorDelegate(delegate, fallbackError = null) {
  detectorDelegates.hand = delegate;

  if (fallbackError) {
    const reason = getErrorDetail(fallbackError);
    detectorDelegates.fallbackReasons.hand = reason;
    detectorDelegates.lastFallbackReason = `hand: ${reason}`;
  } else {
    delete detectorDelegates.fallbackReasons.hand;
  }
}

function getDetectorDelegates() {
  return {
    ...detectorDelegates,
    attempted: cloneRecordArrayValues(detectorDelegates.attempted),
    fallbackReasons: { ...detectorDelegates.fallbackReasons },
  };
}

function recordDetectorDelegateAttempt(delegate) {
  const attempts = detectorDelegates.attempted.hand ?? [];

  if (!attempts.includes(delegate)) {
    attempts.push(delegate);
  }

  detectorDelegates.attempted.hand = attempts;
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

function closeHandLandmarker() {
  closeHandLandmarkerInstance();
  vision = null;
  loadedWasmAssetPath = "";
  loadedHandModelUrl = "";
  frameCanvas = null;
  frameContext = null;
  handWorkerSide = null;
  resetOwnedRuntimeState();
  detectorDelegates.hand = "unloaded";
  resetDetectorDelegateTelemetry();
}

function closeHandLandmarkerInstance() {
  closeLandmarker(handLandmarker);
  handLandmarker = null;
  detectorDelegates.hand = "unloaded";
  resetOwnedRuntimeState();
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
