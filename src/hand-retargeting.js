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
  Object.freeze({ from: 3, to: 4, fallbackFrom: 2 }),
]);

const THUMB_FINGER_SEGMENTS = Object.freeze([
  Object.freeze({ from: "wrist", to: 0, fallbackFrom: "wrist" }),
  Object.freeze({ from: 0, to: 1, fallbackFrom: "wrist" }),
  Object.freeze({ from: 1, to: 2, fallbackFrom: 0 }),
  Object.freeze({ from: 2, to: 3, fallbackFrom: 1 }),
]);

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

function getFingerSegments(fingerName) {
  return fingerName === "Thumb" ? THUMB_FINGER_SEGMENTS : FINGER_SEGMENTS;
}

function resolveLandmarkIndex(indices, token) {
  if (token === "wrist") {
    return 0;
  }

  return indices[token];
}
