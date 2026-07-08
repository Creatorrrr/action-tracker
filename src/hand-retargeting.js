export const HAND_FINGERS = Object.freeze({
  Thumb: Object.freeze([1, 2, 3, 4]),
  Index: Object.freeze([5, 6, 7, 8]),
  Middle: Object.freeze([9, 10, 11, 12]),
  Ring: Object.freeze([13, 14, 15, 16]),
  Pinky: Object.freeze([17, 18, 19, 20]),
});

const FINGER_SEGMENTS = Object.freeze([
  Object.freeze({ from: 0, to: 1, fallbackFrom: 0 }),
  Object.freeze({ from: 1, to: 2, fallbackFrom: 0 }),
  Object.freeze({ from: 2, to: 3, fallbackFrom: 1 }),
]);

const THUMB_FINGER_SEGMENTS = Object.freeze([
  Object.freeze({ from: 0, to: 1, fallbackFrom: "wrist" }),
  Object.freeze({ from: 1, to: 2, fallbackFrom: 0 }),
  Object.freeze({ from: 2, to: 3, fallbackFrom: 1 }),
]);
const PALM_CENTER_INDICES = Object.freeze([0, 5, 9, 13, 17]);
const FIST_CURL_RATIO_START = 0.86;
const FIST_CURL_RATIO_FULL = 0.58;

export function resolveFingerSegmentPoints(points, fingerName, segmentIndex) {
  const indices = HAND_FINGERS[fingerName];
  const segment = getFingerSegments(fingerName)[segmentIndex];

  if (!Array.isArray(points) || !indices || !segment) {
    return null;
  }

  const fromIndex = resolveLandmarkIndex(indices, segment.from);
  const fallbackFromIndex = resolveLandmarkIndex(indices, segment.fallbackFrom);
  const toIndex = resolveLandmarkIndex(indices, segment.to);
  const from = points[fromIndex] ?? points[fallbackFromIndex];
  const to = points[toIndex];

  if (!from || !to) {
    return null;
  }

  return {
    from,
    to,
    fromIndex: from === points[fromIndex] ? fromIndex : fallbackFromIndex,
    toIndex,
    jointKind: fingerName === "Thumb"
      ? ["thumb-cmc", "thumb-mcp", "thumb-ip", "thumb-tip"][segmentIndex]
      : ["mcp", "pip", "dip", "tip"][segmentIndex],
  };
}

export function getFingerSegmentCount(fingerName) {
  return getFingerSegments(fingerName).length;
}

export function estimateHandPalmCenter(points) {
  if (!Array.isArray(points)) {
    return null;
  }

  let count = 0;
  const center = { x: 0, y: 0, z: 0 };

  for (const index of PALM_CENTER_INDICES) {
    const point = points[index];

    if (!isPoint(point)) {
      continue;
    }

    center.x += Number(point.x);
    center.y += Number(point.y);
    center.z += Number(point.z ?? 0);
    count += 1;
  }

  if (!count) {
    return null;
  }

  return {
    x: center.x / count,
    y: center.y / count,
    z: center.z / count,
  };
}

export function estimateFingerCurlStrength(points, fingerName) {
  const indices = HAND_FINGERS[fingerName];

  if (!Array.isArray(points) || !indices) {
    return 0;
  }

  const joints = indices.map((index) => points[index]);

  if (joints.some((point) => !isPoint(point))) {
    return 0;
  }

  let chainLength = 0;

  for (let i = 1; i < joints.length; i += 1) {
    chainLength += pointDistance(joints[i - 1], joints[i]);
  }

  if (chainLength <= 0.000001) {
    return 0;
  }

  const extensionRatio = pointDistance(joints[0], joints[joints.length - 1]) / chainLength;
  const strength = (FIST_CURL_RATIO_START - extensionRatio) / (FIST_CURL_RATIO_START - FIST_CURL_RATIO_FULL);

  return clamp01(strength);
}

function getFingerSegments(fingerName) {
  return fingerName === "Thumb" ? THUMB_FINGER_SEGMENTS : FINGER_SEGMENTS;
}

function resolveLandmarkIndex(indices, token) {
  if (token === "wrist") {
    return 0;
  }

  return indices[token];
}

function isPoint(point) {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function pointDistance(a, b) {
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  const dz = Number(a.z ?? 0) - Number(b.z ?? 0);

  return Math.hypot(dx, dy, dz);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value || 0));
}
