export function computeBoundedFrameSize(
  sourceWidth,
  sourceHeight,
  maxDimension,
) {
  const width = Number(sourceWidth);
  const height = Number(sourceHeight);
  const limit = Number(maxDimension);

  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new RangeError("sourceWidth must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError("sourceHeight must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new RangeError("maxDimension must be a positive safe integer.");
  }

  const scale = Math.min(1, limit / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}
