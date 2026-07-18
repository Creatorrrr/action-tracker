export const HAND_ROI_SLOT_SIZE = 256;
export const HAND_ROI_PACKED_SLOT_COUNT = 2;

const MIN_POSE_CONFIDENCE = 0.2;
const MIN_ROI_SIZE_RATIO = 0.12;
const MAX_ROI_SIZE_RATIO = 0.42;
const FOREARM_TO_ROI_SIZE_RATIO = 1.45;
const HAND_SUPPORT_PADDING_RATIO = 1.65;
const MAX_EDGE_PADDING_RATIO = 0.25;
const STABLE_ROI_EXPANSION_SCALE = 1.3;
const STABLE_ROI_REACQUIRE_EXPANSION_SCALE = 1.625;
const STABLE_ROI_MAX_SIZE_RATIO = 0.56;
const STABLE_ROI_SAFE_CENTER_SHIFT_RATIO = 0.2;
const STABLE_ROI_OUTER_CENTER_SHIFT_RATIO = 0.32;
const STABLE_ROI_HARD_CENTER_SHIFT_RATIO = 0.45;
const STABLE_ROI_SAFE_CANDIDATE_SIZE_RATIO = 0.8;
const STABLE_ROI_OUTER_CANDIDATE_SIZE_RATIO = 0.92;
const STABLE_ROI_HARD_CANDIDATE_SIZE_RATIO = 1.1;

const SIDE_DEFINITIONS = Object.freeze([
  Object.freeze({
    side: "Left",
    slotIndex: 0,
    elbowIndex: 13,
    wristIndex: 15,
    proxyIndices: Object.freeze([17, 19, 21]),
  }),
  Object.freeze({
    side: "Right",
    slotIndex: 1,
    elbowIndex: 14,
    wristIndex: 16,
    proxyIndices: Object.freeze([18, 20, 22]),
  }),
]);

export function buildPoseGuidedHandRois(
  poseLandmarks,
  sourceWidth,
  sourceHeight,
  options = {},
) {
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  if (
    !Array.isArray(poseLandmarks) ||
    !(width > 0) ||
    !(height > 0)
  ) {
    return [];
  }

  const minimumConfidence = finiteOr(
    options.minimumConfidence,
    MIN_POSE_CONFIDENCE,
  );
  const minimumDimension = Math.min(width, height);
  const minimumSize = minimumDimension * MIN_ROI_SIZE_RATIO;
  const maximumSize = minimumDimension * MAX_ROI_SIZE_RATIO;

  return SIDE_DEFINITIONS.flatMap((definition) => {
    const elbow = readPosePoint(
      poseLandmarks[definition.elbowIndex],
      width,
      height,
      minimumConfidence,
    );
    const wrist = readPosePoint(
      poseLandmarks[definition.wristIndex],
      width,
      height,
      minimumConfidence,
    );
    if (!elbow || !wrist) {
      return [];
    }

    const proxyPoints = definition.proxyIndices
      .map((index) => readPosePoint(
        poseLandmarks[index],
        width,
        height,
        minimumConfidence,
      ))
      .filter(Boolean);
    const forearmVector = {
      x: wrist.x - elbow.x,
      y: wrist.y - elbow.y,
    };
    const forearmLength = Math.hypot(forearmVector.x, forearmVector.y);
    if (!(forearmLength > 0.001)) {
      return [];
    }

    const direction = {
      x: forearmVector.x / forearmLength,
      y: forearmVector.y / forearmLength,
    };
    const proxyCenter = proxyPoints.length > 0
      ? averagePoint(proxyPoints)
      : {
          x: wrist.x + direction.x * forearmLength * 0.45,
          y: wrist.y + direction.y * forearmLength * 0.45,
        };
    const center = {
      x: (wrist.x + proxyCenter.x) * 0.5 + direction.x * forearmLength * 0.1,
      y: (wrist.y + proxyCenter.y) * 0.5 + direction.y * forearmLength * 0.1,
    };
    const supportPoints = [wrist, ...proxyPoints];
    const supportDiameter = supportPoints.reduce(
      (largest, point) => Math.max(
        largest,
        Math.hypot(point.x - center.x, point.y - center.y) * 2,
      ),
      0,
    );
    const size = clamp(
      Math.max(
        minimumSize,
        forearmLength * FOREARM_TO_ROI_SIZE_RATIO,
        supportDiameter * HAND_SUPPORT_PADDING_RATIO,
      ),
      minimumSize,
      maximumSize,
    );
    // Keep the anatomical hand center fixed even when the square crosses the
    // source boundary. The worker pads the missing area instead of shifting
    // the hand toward a crop edge, which is especially important for portrait
    // videos where wrists frequently leave through the top or bottom.
    const desiredX = center.x - size * 0.5;
    const desiredY = center.y - size * 0.5;
    const maximumPadding = size * MAX_EDGE_PADDING_RATIO;
    const x = clamp(
      desiredX,
      -maximumPadding,
      width - size + maximumPadding,
    );
    const y = clamp(
      desiredY,
      -maximumPadding,
      height - size + maximumPadding,
    );

    return [{
      side: definition.side,
      slotIndex: definition.slotIndex,
      x,
      y,
      width: size,
      height: size,
      sourceWidth: width,
      sourceHeight: height,
    }];
  });
}

/**
 * Clips an anatomical ROI to available source pixels while preserving its
 * original coordinate system in the padded detector input.
 */
export function buildHandRoiDrawPlan(roi, options = {}) {
  if (!isUsableRoi(roi)) {
    return null;
  }

  const inputWidth = finiteOr(options.inputWidth, HAND_ROI_SLOT_SIZE);
  const inputHeight = finiteOr(options.inputHeight, inputWidth);
  if (!(inputWidth > 0) || !(inputHeight > 0)) {
    return null;
  }

  const sourceLeft = clamp(roi.x, 0, roi.sourceWidth);
  const sourceTop = clamp(roi.y, 0, roi.sourceHeight);
  const sourceRight = clamp(roi.x + roi.width, 0, roi.sourceWidth);
  const sourceBottom = clamp(roi.y + roi.height, 0, roi.sourceHeight);
  const sourceWidth = sourceRight - sourceLeft;
  const sourceHeight = sourceBottom - sourceTop;

  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    return null;
  }

  const scaleX = inputWidth / roi.width;
  const scaleY = inputHeight / roi.height;
  const visibleRatio = clamp(
    (sourceWidth * sourceHeight) / (roi.width * roi.height),
    0,
    1,
  );

  return {
    sourceX: sourceLeft,
    sourceY: sourceTop,
    sourceWidth,
    sourceHeight,
    destinationX: (sourceLeft - roi.x) * scaleX,
    destinationY: (sourceTop - roi.y) * scaleY,
    destinationWidth: sourceWidth * scaleX,
    destinationHeight: sourceHeight * scaleY,
    visibleRatio,
    paddingRatio: 1 - visibleRatio,
  };
}

/**
 * Keep a VIDEO landmarker in one crop coordinate system until the pose-guided
 * candidate genuinely leaves that episode. A changed crop must be paired with
 * a tracker reset by the caller; an unchanged result is safe to feed to the
 * existing tracker state.
 */
export function stabilizePoseGuidedHandRoi(
  candidate,
  previousRoi = null,
  options = {},
) {
  const previous = isUsableRoi(previousRoi) ? previousRoi : null;
  if (!isUsableRoi(candidate)) {
    if (previous && options.reusePrevious === true) {
      return {
        roi: previous,
        transformChanged: false,
        reason: "held-pose-gap",
        centerShiftRatio: null,
        candidateSizeRatio: null,
      };
    }
    return {
      roi: null,
      transformChanged: false,
      reason: "candidate-unavailable",
      centerShiftRatio: null,
      candidateSizeRatio: null,
    };
  }

  const sourceChanged = previous && (
    previous.sourceWidth !== candidate.sourceWidth ||
    previous.sourceHeight !== candidate.sourceHeight ||
    previous.side !== candidate.side
  );
  const forceRecommit = options.forceRecommit === true;
  if (!previous || sourceChanged || forceRecommit) {
    const expansionScale = forceRecommit
      ? finiteOr(
          options.reacquireExpansionScale,
          STABLE_ROI_REACQUIRE_EXPANSION_SCALE,
        )
      : finiteOr(options.expansionScale, STABLE_ROI_EXPANSION_SCALE);
    const roi = expandStableHandRoi(candidate, expansionScale, options);
    return {
      roi,
      transformChanged: Boolean(previous),
      reason: !previous
        ? "episode-start"
        : sourceChanged
          ? "source-size-change"
          : "forced-reacquire",
      centerShiftRatio: previous
        ? roiCenterDistance(candidate, previous) / previous.width
        : null,
      candidateSizeRatio: previous ? candidate.width / previous.width : null,
    };
  }

  const centerShiftRatio = roiCenterDistance(candidate, previous) / previous.width;
  const candidateSizeRatio = candidate.width / previous.width;
  const safe = centerShiftRatio <= finiteOr(
    options.safeCenterShiftRatio,
    STABLE_ROI_SAFE_CENTER_SHIFT_RATIO,
  ) && candidateSizeRatio <= finiteOr(
    options.safeCandidateSizeRatio,
    STABLE_ROI_SAFE_CANDIDATE_SIZE_RATIO,
  );
  if (safe) {
    return {
      roi: previous,
      transformChanged: false,
      reason: "episode-stable",
      centerShiftRatio,
      candidateSizeRatio,
    };
  }

  const withinOuterBand = centerShiftRatio <= finiteOr(
    options.outerCenterShiftRatio,
    STABLE_ROI_OUTER_CENTER_SHIFT_RATIO,
  ) && candidateSizeRatio <= finiteOr(
    options.outerCandidateSizeRatio,
    STABLE_ROI_OUTER_CANDIDATE_SIZE_RATIO,
  );
  if (withinOuterBand) {
    return {
      roi: previous,
      transformChanged: false,
      reason: "episode-hysteresis-band",
      centerShiftRatio,
      candidateSizeRatio,
    };
  }

  return {
    roi: expandStableHandRoi(
      candidate,
      finiteOr(options.expansionScale, STABLE_ROI_EXPANSION_SCALE),
      options,
    ),
    transformChanged: true,
    reason: centerShiftRatio > finiteOr(
      options.hardCenterShiftRatio,
      STABLE_ROI_HARD_CENTER_SHIFT_RATIO,
    ) || candidateSizeRatio > finiteOr(
      options.hardCandidateSizeRatio,
      STABLE_ROI_HARD_CANDIDATE_SIZE_RATIO,
    )
      ? "candidate-hard-escape"
      : "candidate-left-outer-band",
    centerShiftRatio,
    candidateSizeRatio,
  };
}

export function selectPackedHandRoi(
  packedLandmarks,
  rois,
  options = {},
) {
  if (!Array.isArray(packedLandmarks) || packedLandmarks.length === 0) {
    return null;
  }

  const packedWidth = finiteOr(
    options.packedWidth,
    HAND_ROI_SLOT_SIZE * HAND_ROI_PACKED_SLOT_COUNT,
  );
  const slotSize = finiteOr(options.slotSize, HAND_ROI_SLOT_SIZE);
  const finiteX = packedLandmarks
    .map((landmark) => Number(landmark?.x))
    .filter(Number.isFinite);
  if (finiteX.length === 0) {
    return null;
  }

  const meanPixelX = average(finiteX) * packedWidth;
  const slotIndex = clamp(
    Math.floor(meanPixelX / slotSize),
    0,
    HAND_ROI_PACKED_SLOT_COUNT - 1,
  );
  return rois?.find((roi) => roi?.slotIndex === slotIndex) ?? null;
}

export function mapPackedHandLandmarksToSource(
  packedLandmarks,
  roi,
  options = {},
) {
  if (!Array.isArray(packedLandmarks) || !isUsableRoi(roi)) {
    return null;
  }

  const slotSize = finiteOr(options.slotSize, HAND_ROI_SLOT_SIZE);
  const packedWidth = finiteOr(
    options.packedWidth,
    slotSize * HAND_ROI_PACKED_SLOT_COUNT,
  );
  const packedHeight = finiteOr(options.packedHeight, slotSize);
  const slotLeft = roi.slotIndex * slotSize;
  const depthScale = (packedWidth / slotSize) * (roi.width / roi.sourceWidth);

  return packedLandmarks.map((landmark) => {
    const packedPixelX = Number(landmark.x) * packedWidth;
    const packedPixelY = Number(landmark.y) * packedHeight;
    const localX = (packedPixelX - slotLeft) / slotSize;
    const localY = packedPixelY / slotSize;
    const mapped = {
      x: (roi.x + localX * roi.width) / roi.sourceWidth,
      y: (roi.y + localY * roi.height) / roi.sourceHeight,
    };

    if (Number.isFinite(landmark.z)) {
      mapped.z = landmark.z * depthScale;
    }
    if (Number.isFinite(landmark.visibility)) {
      mapped.visibility = landmark.visibility;
    }
    if (Number.isFinite(landmark.presence)) {
      mapped.presence = landmark.presence;
    }
    return mapped;
  });
}

/**
 * Map a detector result from one full-square ROI back to source coordinates.
 * The anatomical side comes from the pose-selected ROI, not detector
 * handedness, so mirrored camera input cannot swap the output side.
 */
export function mapSquareHandLandmarksToSource(squareLandmarks, roi, options = {}) {
  const inputSize = finiteOr(options.inputSize, HAND_ROI_SLOT_SIZE);
  return mapPackedHandLandmarksToSource(
    squareLandmarks,
    { ...roi, slotIndex: 0 },
    {
      slotSize: inputSize,
      packedWidth: inputSize,
      packedHeight: inputSize,
    },
  );
}

function readPosePoint(landmark, width, height, minimumConfidence) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    (
      Number.isFinite(landmark.visibility) &&
      landmark.visibility < minimumConfidence
    ) ||
    (
      Number.isFinite(landmark.presence) &&
      landmark.presence < minimumConfidence
    )
  ) {
    return null;
  }

  return {
    x: landmark.x * width,
    y: landmark.y * height,
  };
}

function averagePoint(points) {
  return {
    x: average(points.map((point) => point.x)),
    y: average(points.map((point) => point.y)),
  };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function expandStableHandRoi(candidate, expansionScale, options) {
  const minimumDimension = Math.min(
    candidate.sourceWidth,
    candidate.sourceHeight,
  );
  const maximumSize = minimumDimension * finiteOr(
    options.maximumSizeRatio,
    STABLE_ROI_MAX_SIZE_RATIO,
  );
  const size = clamp(
    candidate.width * Math.max(1, expansionScale),
    candidate.width,
    maximumSize,
  );
  const centerX = candidate.x + candidate.width * 0.5;
  const centerY = candidate.y + candidate.height * 0.5;
  const maximumPadding = size * MAX_EDGE_PADDING_RATIO;
  return {
    ...candidate,
    x: clamp(
      centerX - size * 0.5,
      -maximumPadding,
      candidate.sourceWidth - size + maximumPadding,
    ),
    y: clamp(
      centerY - size * 0.5,
      -maximumPadding,
      candidate.sourceHeight - size + maximumPadding,
    ),
    width: size,
    height: size,
  };
}

function roiCenterDistance(a, b) {
  return Math.hypot(
    a.x + a.width * 0.5 - (b.x + b.width * 0.5),
    a.y + a.height * 0.5 - (b.y + b.height * 0.5),
  );
}

function finiteOr(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function isUsableRoi(roi) {
  return Boolean(
    roi &&
      Number.isInteger(roi.slotIndex) &&
      Number.isFinite(roi.x) &&
      Number.isFinite(roi.y) &&
      roi.width > 0 &&
      roi.height > 0 &&
      roi.sourceWidth > 0 &&
      roi.sourceHeight > 0,
  );
}
