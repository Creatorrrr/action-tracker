// Conservative, optional input preprocessing. Only symmetric, nearly uniform
// dark borders attached to both opposite edges may be removed. No pose/teacher
// landmarks, clip identity or future frame is used to choose the rectangle.
export function detectLetterboxContent({ data, width, height }) {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  if (!data || !(width >= 32 && height >= 32) || data.length !== width * height * 4) return full;
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    return Math.max(data[i], data[i + 1], data[i + 2]) <= 20;
  };
  const column = x => { let n = 0; for (let y = 0; y < height; y++) if (dark(x, y)) n++; return n / height >= 0.995; };
  const row = y => { let n = 0; for (let x = 0; x < width; x++) if (dark(x, y)) n++; return n / width >= 0.995; };
  let left = 0, right = width - 1, top = 0, bottom = height - 1;
  while (left < width && column(left)) left++;
  while (right >= 0 && column(right)) right--;
  while (top < height && row(top)) top++;
  while (bottom >= 0 && row(bottom)) bottom--;
  const valid = (a, b, size) => a >= size * 0.1 && size - 1 - b >= size * 0.1
    && Math.abs(a - (size - 1 - b)) <= size * 0.025 && b - a + 1 >= size * 0.2;
  // Retain two sampling pixels around content to avoid clipping the first
  // non-black source pixels because of downsampling/compression at the border.
  if (!valid(left, right, width)) { left = 0; right = width - 1; }
  else { left = Math.max(0, left - 2); right = Math.min(width - 1, right + 2); }
  if (!valid(top, bottom, height)) { top = 0; bottom = height - 1; }
  else { top = Math.max(0, top - 2); bottom = Math.min(height - 1, bottom + 2); }
  return { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

export function restorePoseImageCoordinates(frame) {
  const meta = frame?.sourceMeta ?? {};
  const crop = { x: meta.bodyInputCropX, y: meta.bodyInputCropY,
    width: meta.bodyInputCropWidth, height: meta.bodyInputCropHeight };
  if (!Object.values(crop).every(Number.isFinite) || crop.width <= 0 || crop.height <= 0
    || meta.bodyInputCoordinatesRestored || !Array.isArray(frame.poseLandmarks)) return frame;
  return { ...frame, poseLandmarks: frame.poseLandmarks.map(point => point ? { ...point,
    x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height, z: point.z * crop.width } : point),
  sourceMeta: { ...frame.sourceMeta, bodyInputCoordinatesRestored: true,
    // Preserve the unmodified detector image output alongside the explicit
    // coordinate transform. World landmarks are never changed by this adapter.
    detectorCropPoseLandmarksJson: JSON.stringify(frame.poseLandmarks) } };
}
