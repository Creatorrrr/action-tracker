import { adaptCanonicalSkeletonFrame } from "../canonical-skeleton-adapter.js";
import {
  CANONICAL_WORLD_MODE,
  buildCanonicalPose,
  captureRawPoseObservation,
  normalizeSkeletonMode,
} from "./canonical-pose.js";

export function preparePoseObservation(frame, { mode, applyLegacyCorrection = true } = {}) {
  const skeletonMode = normalizeSkeletonMode(mode);
  const rawPoseObservation = captureRawPoseObservation(frame);
  const hasRaw = rawPoseObservation.provenance !== "adapted-only";
  const rawFrame = hasRaw ? {
    ...frame,
    rawPoseObservation,
    poseLandmarks: rawPoseObservation.poseLandmarks,
    poseWorldLandmarks: rawPoseObservation.poseWorldLandmarks,
    sourceMeta: Object.fromEntries(Object.entries(frame.sourceMeta ?? {})
      .filter(([key]) => !key.startsWith("canonical") && key !== "geometryCorrection")),
  } : { ...frame, rawPoseObservation };
  if (skeletonMode === CANONICAL_WORLD_MODE) {
    return {
      ...rawFrame,
      canonicalPose: buildCanonicalPose(rawFrame),
      sourceMeta: { ...rawFrame.sourceMeta, skeletonMode, geometryCorrection: "none" },
    };
  }
  // Derive either mode from raw each time. A legacy -> canonical -> legacy
  // round trip must neither retain stale correction flags nor double its bias.
  // Old adapted-only recordings cannot be restored; keep their original data.
  const legacy = applyLegacyCorrection && hasRaw ? adaptCanonicalSkeletonFrame(rawFrame) : rawFrame;
  return {
    ...legacy,
    rawPoseObservation,
    canonicalPose: null,
    sourceMeta: { ...legacy.sourceMeta, skeletonMode },
  };
}
