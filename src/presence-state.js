const DEFAULT_PRESENT_THRESHOLD = 0.35;
const DEFAULT_ABSENT_THRESHOLD = 0.15;
const DEFAULT_PRESENT_HOLD_FRAMES = 2;
const DEFAULT_ABSENT_HOLD_FRAMES = 3;

export {
  createPresenceState,
  estimateMotionFramePresenceConfidence,
  updatePresenceState,
};

function createPresenceState(options = {}) {
  return {
    status: "unknown",
    confidence: 0,
    presentFrames: 0,
    absentFrames: 0,
    transitions: 0,
    frames: 0,
    lastChangedFrame: 0,
    presentThreshold: Number.isFinite(Number(options.presentThreshold))
      ? Number(options.presentThreshold)
      : DEFAULT_PRESENT_THRESHOLD,
    absentThreshold: Number.isFinite(Number(options.absentThreshold))
      ? Number(options.absentThreshold)
      : DEFAULT_ABSENT_THRESHOLD,
    presentHoldFrames: Number.isInteger(Number(options.presentHoldFrames))
      ? Math.max(1, Number(options.presentHoldFrames))
      : DEFAULT_PRESENT_HOLD_FRAMES,
    absentHoldFrames: Number.isInteger(Number(options.absentHoldFrames))
      ? Math.max(1, Number(options.absentHoldFrames))
      : DEFAULT_ABSENT_HOLD_FRAMES,
  };
}

function updatePresenceState(state, motionFrame) {
  const current = state && typeof state === "object" ? state : createPresenceState();
  const confidence = estimateMotionFramePresenceConfidence(motionFrame);
  const previousStatus = current.status;
  current.frames += 1;
  current.confidence = confidence;

  if (confidence >= current.presentThreshold) {
    current.presentFrames += 1;
    current.absentFrames = 0;

    if (previousStatus === "absent" || previousStatus === "exiting") {
      current.status = current.presentFrames >= current.presentHoldFrames ? "present" : "entering";
    } else {
      current.status = current.presentFrames >= current.presentHoldFrames ? "present" : "entering";
    }
  } else if (confidence <= current.absentThreshold) {
    current.absentFrames += 1;
    current.presentFrames = 0;

    if (previousStatus === "present" || previousStatus === "entering") {
      current.status = current.absentFrames >= current.absentHoldFrames ? "absent" : "exiting";
    } else {
      current.status = current.absentFrames >= current.absentHoldFrames ? "absent" : "exiting";
    }
  } else {
    current.presentFrames = 0;
    current.absentFrames = 0;
    current.status = previousStatus === "absent" ? "entering" : previousStatus === "present" ? "exiting" : "unknown";
  }

  if (current.status !== previousStatus) {
    current.transitions += 1;
    current.lastChangedFrame = current.frames;
  }

  return {
    status: current.status,
    confidence,
    presentFrames: current.presentFrames,
    absentFrames: current.absentFrames,
    transitions: current.transitions,
    frames: current.frames,
    shouldUpdateAvatar: current.status !== "absent",
  };
}

function estimateMotionFramePresenceConfidence(frame) {
  const pose = Array.isArray(frame?.poseLandmarks) ? frame.poseLandmarks : [];
  const world = Array.isArray(frame?.poseWorldLandmarks) ? frame.poseWorldLandmarks : [];
  const sourceScore = Number(frame?.sourceMeta?.detectorScore);
  const landmarkScore = averageLandmarkConfidence(pose.length > 0 ? pose : world);

  if (Number.isFinite(sourceScore)) {
    return clamp(Math.min(sourceScore, landmarkScore || sourceScore), 0, 1);
  }

  return clamp(landmarkScore, 0, 1);
}

function averageLandmarkConfidence(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    return 0;
  }

  const coreIndices = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  const values = coreIndices
    .map((index) => landmarks[index])
    .filter(Boolean)
    .map((landmark) => Math.min(
      Number.isFinite(Number(landmark.visibility)) ? Number(landmark.visibility) : 1,
      Number.isFinite(Number(landmark.presence)) ? Number(landmark.presence) : 1,
    ))
    .filter(Number.isFinite);

  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}
