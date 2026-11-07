const DISABLED_QUERY_VALUES = new Set(["0", "false", "off", "no", "none"]);

export function resolveSkeletonMode(search) {
  return new URLSearchParams(String(search ?? "")).get("skeleton-mode") === "canonical-world"
    ? "canonical-world" : "legacy-hybrid";
}

// Cranial refinement is explicit until physical-axis and rotation/FK gates
// agree. Keep the previous mapping as the product default.
export function resolveHeadDirectionMode(search) {
  const mode = new URLSearchParams(String(search ?? '')).get('experimental-head-direction');
  return mode === 'marker' ? 'head-physical' : mode === 'observed' ? 'head-only'
    : mode === 'bind-up' ? 'head-bind-up' : 'off';
}

export function resolveVideoTimingMode(search) {
  return new URLSearchParams(String(search ?? "")).get("video-timing") === "realtime"
    ? "realtime" : "adaptive-playback";
}

export function resolveInputFrameMaxDimension(search, fallback = 640) {
  const value = Number(new URLSearchParams(String(search ?? "")).get("input-max-dimension"));
  return [640, 960, 1280, 1920].includes(value) ? value : fallback;
}

export function isWorkerRuntimeEnabled(search, parameterName) {
  const value = new URLSearchParams(String(search ?? "")).get(parameterName);
  return !DISABLED_QUERY_VALUES.has(String(value).toLowerCase());
}

export function resolveTrackingRuntimeOptions(search) {
  return {
    bodyWorkerEnabled: isWorkerRuntimeEnabled(search, "tracking-worker"),
    handWorkerEnabled: isWorkerRuntimeEnabled(search, "hand-worker"),
  };
}
