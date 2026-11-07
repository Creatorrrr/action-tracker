import { buildCanonicalPose } from "./canonical-pose.js";

// Fit a weak-perspective camera using only the detector's image/world pairs.
// Image x and y share image-height units, so padding/aspect cannot stretch limbs.
// This is an input-consistency candidate, not a SAM-dependent pose correction.
export function reprojectCanonicalPose(frame, { width, height } = {}) {
  const pose = buildCanonicalPose(frame);
  const image = frame?.rawPoseObservation?.poseLandmarks;
  const aspect = width / height;
  if (pose.status !== "observed" || !Array.isArray(image) || !(aspect > 0) || !Number.isFinite(aspect)) return pose;
  const toImage = point => point && [point.x, point.y].every(Number.isFinite)
    ? { x: (point.x - 0.5) * aspect * (frame.mirrored ? -1 : 1), y: 0.5 - point.y } : null;
  const anchors = [11, 12, 23, 24, 25, 26].flatMap(index => {
    const source = toImage(image[index]), target = pose.landmarks[index];
    const confidence = Math.min(image[index]?.visibility ?? 1, target?.visibility ?? 1);
    return source && target && confidence >= 0.2 ? [{ source, target, weight: confidence }] : [];
  });
  if (anchors.length < 4) return pose;
  const totalWeight = anchors.reduce((sum, row) => sum + row.weight, 0);
  const mean = field => ({ x: anchors.reduce((sum, row) => sum + row[field].x * row.weight, 0) / totalWeight,
    y: anchors.reduce((sum, row) => sum + row[field].y * row.weight, 0) / totalWeight });
  const imageMean = mean("source"), worldMean = mean("target");
  let covariance = 0, variance = 0;
  for (const { source, target, weight } of anchors) {
    const u = source.x - imageMean.x, v = source.y - imageMean.y;
    covariance += weight * (u * (target.x - worldMean.x) + v * (target.y - worldMean.y));
    variance += weight * (u * u + v * v);
  }
  const scale = covariance / variance;
  const leftHip = toImage(image[23]), rightHip = toImage(image[24]);
  if (!(scale > 0) || !Number.isFinite(scale) || variance < 1e-8 || !leftHip || !rightHip) return pose;
  const hip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
  return { ...pose, geometryCorrection: { kind: "detector-weak-perspective", scale, anchorCount: anchors.length, width, height },
    landmarks: pose.landmarks.map((point, index) => {
      const xy = toImage(image[index]);
      return point && xy ? { ...point, x: scale * (xy.x - hip.x), y: scale * (xy.y - hip.y) } : point;
    }) };
}
