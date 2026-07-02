export const MOTION_FRAME_VERSION = 1;
export const MOTION_RECORDING_VERSION = 1;
export const MOTION_RECORDING_FRAME_LIMIT = 18000;
export const MOTION_FACE_VERSION = 1;
export const EXTERNAL_HMR_SOURCE_TYPE = "external-hmr";
export const EXTERNAL_HMR_EXTRACTORS = Object.freeze([
  "wham",
  "gvhmr",
  "gemx",
  "sam3d-body",
  "sam3dbody",
]);

export function createMotionFrame({
  timestamp = 0,
  mirrored = false,
  poseResults = null,
  handResults = null,
  sourceMeta = {},
  face = null,
  faceOptions = {},
  clone = false,
} = {}) {
  const poseLandmarks = firstLandmarkList(
    poseResults?.poseLandmarks ?? poseResults?.landmarks,
  );
  const poseWorldLandmarks = firstLandmarkList(
    poseResults?.poseWorldLandmarks ?? poseResults?.worldLandmarks,
  );
  const hands = normalizeHands(handResults, mirrored);
  const leftHand = hands.find((hand) => hand.side === "Left") ?? null;
  const rightHand = hands.find((hand) => hand.side === "Right") ?? null;

  return {
    version: MOTION_FRAME_VERSION,
    timestamp: normalizeNumber(timestamp, 0),
    mirrored: Boolean(mirrored),
    poseLandmarks: clone ? cloneLandmarkList(poseLandmarks) : poseLandmarks,
    poseWorldLandmarks: clone ? cloneLandmarkList(poseWorldLandmarks) : poseWorldLandmarks,
    leftHandLandmarks: clone ? cloneLandmarkList(leftHand?.landmarks) : leftHand?.landmarks ?? null,
    rightHandLandmarks: clone ? cloneLandmarkList(rightHand?.landmarks) : rightHand?.landmarks ?? null,
    leftHandWorldLandmarks: clone ? cloneLandmarkList(leftHand?.worldLandmarks) : leftHand?.worldLandmarks ?? null,
    rightHandWorldLandmarks: clone ? cloneLandmarkList(rightHand?.worldLandmarks) : rightHand?.worldLandmarks ?? null,
    sourceMeta: clonePlainObject(sourceMeta),
    face: normalizeFace(face, faceOptions),
  };
}

export function isMotionFrame(value) {
  return Boolean(value && value.version === MOTION_FRAME_VERSION);
}

export function serializeMotionFrame(frame) {
  if (!isMotionFrame(frame)) {
    return createMotionFrame({ clone: true });
  }

  return {
    version: MOTION_FRAME_VERSION,
    timestamp: normalizeNumber(frame.timestamp, 0),
    mirrored: Boolean(frame.mirrored),
    poseLandmarks: cloneLandmarkList(frame.poseLandmarks),
    poseWorldLandmarks: cloneLandmarkList(frame.poseWorldLandmarks),
    leftHandLandmarks: cloneLandmarkList(frame.leftHandLandmarks),
    rightHandLandmarks: cloneLandmarkList(frame.rightHandLandmarks),
    leftHandWorldLandmarks: cloneLandmarkList(frame.leftHandWorldLandmarks),
    rightHandWorldLandmarks: cloneLandmarkList(frame.rightHandWorldLandmarks),
    sourceMeta: clonePlainObject(frame.sourceMeta),
    face: normalizeFace(frame.face),
  };
}

export function normalizeFace(face, options = {}) {
  if (!face) {
    return null;
  }

  const blendShapes = normalizeFaceBlendShapes(extractFaceBlendShapes(face));
  const transformMatrix = normalizeFaceTransformMatrix(extractFaceTransformMatrix(face));
  const includeLandmarks = Boolean(options.includeLandmarks || face.version === MOTION_FACE_VERSION);
  const landmarks = includeLandmarks ? cloneLandmarkList(extractFaceLandmarks(face)) : null;
  const sourceMeta = clonePlainObject(face.sourceMeta);

  if (blendShapes.length === 0 && !transformMatrix && !landmarks) {
    return null;
  }

  return {
    version: MOTION_FACE_VERSION,
    blendShapes,
    transformMatrix,
    landmarks,
    sourceMeta,
  };
}

export function createMotionRecording({
  source = {},
  frames = [],
  createdAt = new Date().toISOString(),
  droppedFrames = 0,
} = {}) {
  return {
    version: MOTION_RECORDING_VERSION,
    createdAt,
    source: clonePlainObject(source),
    droppedFrames: Math.max(0, Math.trunc(normalizeNumber(droppedFrames, 0))),
    frames: frames.map(serializeMotionFrame),
  };
}

export function normalizeMotionRecording(recording) {
  if (!recording || recording.version !== MOTION_RECORDING_VERSION || !Array.isArray(recording.frames)) {
    throw new Error("Expected a motion recording with version 1 and a frames array.");
  }

  return createMotionRecording({
    source: recording.source ?? {},
    frames: recording.frames,
    createdAt: recording.createdAt ?? new Date().toISOString(),
    droppedFrames: recording.droppedFrames ?? 0,
  });
}

export function isExternalMotionRecording(recording) {
  const source = recording?.source;

  if (!source || typeof source !== "object") {
    return false;
  }

  const type = normalizeSourceToken(source.type ?? source.kind ?? source.sourceType);
  const extractor = normalizeSourceToken(source.extractor ?? source.detector);

  return type === EXTERNAL_HMR_SOURCE_TYPE || type === "hmr" || EXTERNAL_HMR_EXTRACTORS.includes(extractor);
}

export function normalizeExternalMotionRecording(recording) {
  const normalizedRecording = normalizeMotionRecording(recording);

  if (!isExternalMotionRecording(normalizedRecording)) {
    throw new Error("Expected an external HMR motion recording source.");
  }

  assertNoEmbeddedMotionBinary(normalizedRecording.source, "recording.source");

  normalizedRecording.frames.forEach((frame, index) => {
    assertExternalMotionFrame(frame, index);
  });

  return normalizedRecording;
}

export function motionFrameToPoseResults(frame) {
  if (!isMotionFrame(frame)) {
    return { landmarks: [], worldLandmarks: [] };
  }

  return {
    landmarks: isLandmarkList(frame.poseLandmarks) ? [frame.poseLandmarks] : [],
    worldLandmarks: isLandmarkList(frame.poseWorldLandmarks) ? [frame.poseWorldLandmarks] : [],
  };
}

export function motionFrameToHandResults(frame) {
  if (!isMotionFrame(frame)) {
    return { landmarks: [], handedness: [] };
  }

  const landmarks = [];
  const handedness = [];
  const worldLandmarks = [];

  if (isLandmarkList(frame.leftHandLandmarks)) {
    landmarks.push(frame.leftHandLandmarks);
    handedness.push([{ categoryName: "Left", score: 1 }]);
    if (isLandmarkList(frame.leftHandWorldLandmarks)) {
      worldLandmarks.push(frame.leftHandWorldLandmarks);
    }
  }

  if (isLandmarkList(frame.rightHandLandmarks)) {
    landmarks.push(frame.rightHandLandmarks);
    handedness.push([{ categoryName: "Right", score: 1 }]);
    if (isLandmarkList(frame.rightHandWorldLandmarks)) {
      worldLandmarks.push(frame.rightHandWorldLandmarks);
    }
  }

  return { landmarks, handedness, worldLandmarks };
}

function normalizeHands(results, mirrored) {
  if (!results) {
    return [];
  }

  const hands = [];

  if (isLandmarkList(results.leftHandLandmarks)) {
    hands.push({
      landmarks: results.leftHandLandmarks,
      worldLandmarks: isLandmarkList(results.leftHandWorldLandmarks) ? results.leftHandWorldLandmarks : null,
      side: "Left",
      score: 1,
    });
  }

  if (isLandmarkList(results.rightHandLandmarks)) {
    hands.push({
      landmarks: results.rightHandLandmarks,
      worldLandmarks: isLandmarkList(results.rightHandWorldLandmarks) ? results.rightHandWorldLandmarks : null,
      side: "Right",
      score: 1,
    });
  }

  const landmarkGroups = normalizeHandLandmarkGroups(results);
  const worldLandmarkGroups = normalizeHandWorldLandmarkGroups(results);
  const handedness = results.multiHandedness ?? results.handednesses ?? results.handedness ?? [];
  const usedSides = new Set(hands.map((hand) => hand.side));

  landmarkGroups.forEach((landmarks, index) => {
    if (!isLandmarkList(landmarks)) {
      return;
    }

    const labeledSide = normalizeHandLabel(readHandLabel(handedness[index]), mirrored);
    const side = labeledSide && !usedSides.has(labeledSide)
      ? labeledSide
      : inferHandSide(landmarks, mirrored, usedSides);

    if (!side) {
      return;
    }

    usedSides.add(side);
    hands.push({
      landmarks,
      worldLandmarks: isLandmarkList(worldLandmarkGroups[index]) ? worldLandmarkGroups[index] : null,
      side,
      score: readHandScore(handedness[index]),
    });
  });

  return dedupeHands(hands);
}

function normalizeHandLandmarkGroups(results) {
  if (Array.isArray(results.multiHandLandmarks)) {
    return results.multiHandLandmarks;
  }

  if (Array.isArray(results.handLandmarks) && isLandmarkList(results.handLandmarks[0])) {
    return results.handLandmarks;
  }

  if (Array.isArray(results.landmarks) && isLandmarkList(results.landmarks[0])) {
    return results.landmarks;
  }

  if (isLandmarkList(results.landmarks)) {
    return [results.landmarks];
  }

  return [];
}

function normalizeHandWorldLandmarkGroups(results) {
  if (Array.isArray(results.multiHandWorldLandmarks)) {
    return results.multiHandWorldLandmarks;
  }

  if (Array.isArray(results.handWorldLandmarks) && isLandmarkList(results.handWorldLandmarks[0])) {
    return results.handWorldLandmarks;
  }

  if (Array.isArray(results.worldLandmarks) && isLandmarkList(results.worldLandmarks[0])) {
    return results.worldLandmarks;
  }

  if (isLandmarkList(results.worldLandmarks)) {
    return [results.worldLandmarks];
  }

  return [];
}

function firstLandmarkList(value) {
  if (isLandmarkList(value)) {
    return value;
  }

  if (Array.isArray(value) && isLandmarkList(value[0])) {
    return value[0];
  }

  return null;
}

function isLandmarkList(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isLandmark);
}

function isLandmark(value) {
  return Boolean(
    value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      (value.z === undefined || Number.isFinite(value.z)),
  );
}

function readHandLabel(entry) {
  if (!entry) {
    return null;
  }

  if (Array.isArray(entry)) {
    return readHandLabel(entry[0]);
  }

  const candidate = entry.categoryName
    ?? entry.displayName
    ?? entry.label
    ?? entry.classification?.[0]?.label
    ?? entry.classifications?.[0]?.label
    ?? null;

  return typeof candidate === "string" ? candidate : null;
}

function readHandScore(entry) {
  if (!entry) {
    return 0;
  }

  if (Array.isArray(entry)) {
    return readHandScore(entry[0]);
  }

  return Number(entry.score ?? entry.probability ?? entry.classification?.[0]?.score ?? 0) || 0;
}

function normalizeHandLabel(label, mirrored) {
  if (!label) {
    return null;
  }

  const lower = label.toLowerCase();
  const side = lower.includes("left") ? "Left" : lower.includes("right") ? "Right" : null;

  if (!side) {
    return null;
  }

  return mirrored ? side : oppositeSide(side);
}

function inferHandSide(landmarks, mirrored, usedSides) {
  const wrist = landmarks?.[0];

  if (wrist && Number.isFinite(wrist.x)) {
    const x = mirrored ? 1 - wrist.x : wrist.x;
    const inferred = x < 0.5 ? "Left" : "Right";

    if (!usedSides.has(inferred)) {
      return inferred;
    }
  }

  return ["Left", "Right"].find((side) => !usedSides.has(side)) ?? null;
}

function dedupeHands(hands) {
  const bySide = new Map();

  for (const hand of hands) {
    if (!hand?.side || !isLandmarkList(hand.landmarks)) {
      continue;
    }

    const current = bySide.get(hand.side);

    if (!current || hand.score > current.score) {
      bySide.set(hand.side, hand);
      continue;
    }

    if (!current.worldLandmarks && isLandmarkList(hand.worldLandmarks)) {
      current.worldLandmarks = hand.worldLandmarks;
    }
  }

  return [...bySide.values()].slice(0, 2);
}

function oppositeSide(side) {
  return side === "Left" ? "Right" : "Left";
}

function cloneLandmarkList(landmarks) {
  if (!isLandmarkList(landmarks)) {
    return null;
  }

  return landmarks.map((landmark) => {
    const clone = {
      x: landmark.x,
      y: landmark.y,
    };

    if (Number.isFinite(landmark.z)) {
      clone.z = landmark.z;
    }

    if (Number.isFinite(landmark.visibility)) {
      clone.visibility = landmark.visibility;
    }

    if (Number.isFinite(landmark.presence)) {
      clone.presence = landmark.presence;
    }

    return clone;
  });
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => isJsonPrimitive(entry)),
  );
}

function isJsonPrimitive(value) {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeSourceToken(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function assertExternalMotionFrame(frame, index) {
  const prefix = `frames[${index}]`;

  assertLandmarkCount(frame.poseLandmarks, 33, `${prefix}.poseLandmarks`);
  assertLandmarkCount(frame.poseWorldLandmarks, 33, `${prefix}.poseWorldLandmarks`);

  if (frame.leftHandLandmarks !== null) {
    assertLandmarkCount(frame.leftHandLandmarks, 21, `${prefix}.leftHandLandmarks`);
  }

  if (frame.rightHandLandmarks !== null) {
    assertLandmarkCount(frame.rightHandLandmarks, 21, `${prefix}.rightHandLandmarks`);
  }

  if (frame.leftHandWorldLandmarks !== null && frame.leftHandWorldLandmarks !== undefined) {
    assertLandmarkCount(frame.leftHandWorldLandmarks, 21, `${prefix}.leftHandWorldLandmarks`);
  }

  if (frame.rightHandWorldLandmarks !== null && frame.rightHandWorldLandmarks !== undefined) {
    assertLandmarkCount(frame.rightHandWorldLandmarks, 21, `${prefix}.rightHandWorldLandmarks`);
  }

  assertNoEmbeddedMotionBinary(frame.sourceMeta, `${prefix}.sourceMeta`);
}

function assertLandmarkCount(landmarks, expectedCount, label) {
  if (!Array.isArray(landmarks) || landmarks.length !== expectedCount) {
    throw new Error(`External HMR recording requires ${expectedCount} ${label.split(".").at(-1)} entries in ${label}.`);
  }
}

function assertNoEmbeddedMotionBinary(value, label) {
  for (const key of Object.keys(value ?? {})) {
    const normalizedKey = key.replace(/[_\-\s]/g, "").toLowerCase();

    if (
      normalizedKey.includes("rawvideo") ||
      normalizedKey.includes("rawmodel") ||
      normalizedKey.includes("videobytes") ||
      normalizedKey.includes("videobinary") ||
      normalizedKey.includes("videodata") ||
      normalizedKey.includes("modelbytes") ||
      normalizedKey.includes("modelbinary") ||
      normalizedKey.includes("modeldata") ||
      normalizedKey.includes("avatarbytes") ||
      normalizedKey.includes("avatarbinary") ||
      normalizedKey.includes("glbbytes") ||
      normalizedKey.includes("vrmbytes")
    ) {
      throw new Error(`${label}.${key}: raw video or model binary data must not be embedded in motion recordings.`);
    }
  }
}

function extractFaceBlendShapes(face) {
  if (Array.isArray(face.blendShapes)) {
    return face.blendShapes;
  }

  if (Array.isArray(face.blendshapes)) {
    return face.blendshapes;
  }

  if (Array.isArray(face.categories)) {
    return face.categories;
  }

  const faceBlendshapes = face.faceBlendshapes ?? face.faceBlendShapes;

  if (Array.isArray(faceBlendshapes)) {
    const firstGroup = faceBlendshapes.find((group) => Array.isArray(group?.categories));

    if (firstGroup) {
      return firstGroup.categories;
    }

    if (faceBlendshapes.every((entry) => typeof entry?.categoryName === "string" || typeof entry?.name === "string")) {
      return faceBlendshapes;
    }
  }

  if (Array.isArray(faceBlendshapes?.categories)) {
    return faceBlendshapes.categories;
  }

  return [];
}

function normalizeFaceBlendShapes(entries) {
  const byName = new Map();

  for (const entry of entries ?? []) {
    const rawName = entry?.name ?? entry?.categoryName ?? entry?.displayName ?? entry?.label;
    const rawScore = Number(entry?.score);

    if (typeof rawName !== "string" || rawName.trim() === "" || !Number.isFinite(rawScore)) {
      continue;
    }

    const name = rawName.trim();
    const score = clamp01(rawScore);
    const existing = byName.get(name);

    if (!existing || score > existing.score) {
      byName.set(name, { name, score });
    }
  }

  return [...byName.values()];
}

function extractFaceTransformMatrix(face) {
  if (face.transformMatrix) {
    return face.transformMatrix;
  }

  const matrices = face.facialTransformationMatrixes
    ?? face.faceTransformationMatrixes
    ?? face.facialTransformationMatrices
    ?? face.faceTransformationMatrices;

  if (Array.isArray(matrices) && matrices.length > 0) {
    return matrices[0]?.data ?? matrices[0]?.matrix ?? matrices[0];
  }

  return null;
}

function extractFaceLandmarks(face) {
  if (isLandmarkList(face.landmarks)) {
    return face.landmarks;
  }

  if (Array.isArray(face.landmarks) && isLandmarkList(face.landmarks[0])) {
    return face.landmarks[0];
  }

  if (isLandmarkList(face.faceLandmarks)) {
    return face.faceLandmarks;
  }

  if (Array.isArray(face.faceLandmarks) && isLandmarkList(face.faceLandmarks[0])) {
    return face.faceLandmarks[0];
  }

  if (Array.isArray(face.multiFaceLandmarks) && isLandmarkList(face.multiFaceLandmarks[0])) {
    return face.multiFaceLandmarks[0];
  }

  return null;
}

function normalizeFaceTransformMatrix(value) {
  if (!value) {
    return null;
  }

  const source = value?.data ?? value?.matrix ?? value;

  if (!source || typeof source.length !== "number") {
    return null;
  }

  const matrix = Array.from(source).slice(0, 16).map(Number);

  if (matrix.length !== 16 || matrix.some((entry) => !Number.isFinite(entry))) {
    return null;
  }

  return matrix;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
