// One coordinate transform for every joint. Image landmarks are observations,
// never a substitute for metric x/y when world z is available.
export const CANONICAL_POSE_VERSION = 1;
export const CANONICAL_WORLD_MODE = "canonical-world";
export const LEGACY_HYBRID_MODE = "legacy-hybrid";

const BODY_JOINTS = Object.freeze({
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
});

// Shared by offline solvePoseFrame and the actual renderer. No rig lengths,
// image aspect ratio, depth gain, flex bias or temporal filter enters here.
export function buildCanonicalPosePoints(frame) {
  const pose = frame?.canonicalPose;
  const landmarks = pose?.version === CANONICAL_POSE_VERSION && pose.status === "observed"
    ? pose.landmarks : [];
  const points = Object.fromEntries(Object.entries(BODY_JOINTS).map(([name, index]) => [
    name, finitePoint(landmarks[index]) ? { ...landmarks[index] } : null,
  ]));
  points.hipMid = derivedMidpoint(points.leftHip, points.rightHip);
  points.shoulderMid = derivedMidpoint(points.leftShoulder, points.rightShoulder);
  points.eyeMid = derivedMidpoint(points.leftEye, points.rightEye);
  points.earMid = derivedMidpoint(points.leftEar, points.rightEar);
  points.headAimBase = points.earMid ?? points.eyeMid;
  points.leftClavicle = points.leftShoulder;
  points.rightClavicle = points.rightShoulder;
  // Pose33 does not observe spinal curvature. Keep this prior explicit instead
  // of claiming that interpolated points are measured vertebrae.
  for (const [name, t] of Object.entries({ spineBase: 0.24, spineMid: 0.52, spineUpper: 0.76, chest: 0.9 })) {
    points[name] = points.hipMid && points.shoulderMid ? {
      ...lerpPoint(points.hipMid, points.shoulderMid, t),
      derived: "linear-torso-prior",
    } : null;
  }
  const base = points.headAimBase;
  if (base && points.shoulderMid) {
    const up = difference(base, points.shoulderMid);
    const upLength = Math.hypot(up.x, up.y, up.z);
    const headLength = Math.max(distance(points.leftShoulder, points.rightShoulder) * 0.28,
      distance(points.leftEye, points.rightEye) * 1.8);
    const nose = points.nose ? difference(points.nose, base) : { x: 0, y: 0, z: 0 };
    const noseScale = Math.min(1, headLength / (Math.hypot(nose.x, nose.y, nose.z) || 1)) * 0.5;
    points.headCrown = upLength > 1e-8 && headLength > 1e-8 ? {
      x: base.x + up.x / upLength * headLength + nose.x * noseScale,
      y: base.y + up.y / upLength * headLength + nose.y * noseScale,
      z: base.z + up.z / upLength * headLength + nose.z * noseScale,
      visibility: Math.min(base.visibility, points.nose?.visibility ?? base.visibility),
      derived: "head-landmark-prior",
    } : null;
  } else {
    points.headCrown = null;
  }
  return points;
}

export function normalizeSkeletonMode(value) {
  return value === CANONICAL_WORLD_MODE ? CANONICAL_WORLD_MODE : LEGACY_HYBRID_MODE;
}

export function canonicalFrameTimestampMs(frame) {
  const meta = frame?.sourceMeta ?? {};
  const pts = meta.sourcePtsSec ?? meta.videoTime;
  if ((meta.inputKind === "video" || String(meta.sourcePtsSource ?? "").includes("rvfc")) && Number.isFinite(pts)) {
    return pts * 1000;
  }
  if (Number.isFinite(meta.callbackMonotonicMs) && meta.callbackMonotonicMs >= 0) return meta.callbackMonotonicMs;
  return Number.isFinite(frame?.timestamp) ? frame.timestamp : 0;
}

export function captureRawPoseObservation(frame) {
  if (frame?.rawPoseObservation?.version === 1) return frame.rawPoseObservation;
  return {
    version: 1,
    timestampMs: frame?.timestamp ?? null,
    sourcePtsSec: frame?.sourceMeta?.sourcePtsSec ?? frame?.sourceMeta?.videoTime ?? null,
    poseLandmarks: cloneLandmarks(frame?.poseLandmarks),
    poseWorldLandmarks: cloneLandmarks(frame?.poseWorldLandmarks),
    // Old recordings contain only corrected observations. Do not describe them
    // as raw training inputs when the original detector output is unavailable.
    provenance: frame?.sourceMeta?.canonicalSkeletonAdapter ? "adapted-only" : "detector-output",
  };
}

export function buildCanonicalPose(frame) {
  const observation = captureRawPoseObservation(frame);
  const world = observation.poseWorldLandmarks;
  const origin = midpoint(world?.[23], world?.[24]);
  const mirrored = Boolean(frame?.mirrored);
  const available = Boolean(origin && observation.provenance !== "adapted-only");
  const landmarks = Array.from({ length: 33 }, (_, index) => available
    ? cameraPointToCanonical(world?.[index], origin, mirrored)
    : null);
  return {
    version: CANONICAL_POSE_VERSION,
    mode: CANONICAL_WORLD_MODE,
    status: available ? "observed" : "unavailable",
    reason: available ? "world-observation" : observation.provenance === "adapted-only"
      ? "raw-world-observation-unavailable" : "world-origin-unavailable",
    units: "metres",
    origin: "hip-midpoint",
    inputAxes: "x-right-y-down-z-away",
    outputAxes: mirrored ? "x-left-y-up-z-toward-camera" : "x-right-y-up-z-toward-camera",
    cameraToCanonical: [mirrored ? -1 : 1, 0, 0, 0, -1, 0, 0, 0, -1],
    cameraOrigin: origin,
    mirrored,
    sourcePtsSec: observation.sourcePtsSec,
    landmarks,
    // Root-relative world landmarks do not observe camera translation.
    rootTranslation: { status: "unavailable", reason: "root-relative-detector" },
    semantics: "mediapipe33-landmarks",
  };
}

export function cameraPointToCanonical(point, origin, mirrored = false) {
  if (!finitePoint(point) || !finitePoint(origin)) return null;
  return {
    x: (point.x - origin.x) * (mirrored ? -1 : 1) || 0,
    y: -(point.y - origin.y) || 0,
    z: -(point.z - origin.z) || 0,
    visibility: confidence(point.visibility),
    ...(Number.isFinite(point.presence) ? { presence: confidence(point.presence) } : {}),
  };
}

function midpoint(a, b) {
  return finitePoint(a) && finitePoint(b)
    ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
    : null;
}

function derivedMidpoint(a, b) {
  return finitePoint(a) && finitePoint(b) ? lerpPoint(a, b, 0.5) : null;
}

function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t,
    visibility: Math.min(confidence(a.visibility), confidence(b.visibility)),
  };
}

function difference(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function distance(a, b) {
  return finitePoint(a) && finitePoint(b) ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : 0;
}

function finitePoint(point) {
  return point && [point.x, point.y, point.z].every(Number.isFinite);
}

function confidence(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function cloneLandmarks(landmarks) {
  return Array.isArray(landmarks) ? landmarks.map((point) => point ? { ...point } : null) : null;
}
