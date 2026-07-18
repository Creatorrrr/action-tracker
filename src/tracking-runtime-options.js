const DISABLED_QUERY_VALUES = new Set(["0", "false", "off", "no", "none"]);

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
