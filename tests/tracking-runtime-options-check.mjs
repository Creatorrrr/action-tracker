import assert from "node:assert/strict";
import {
  isWorkerRuntimeEnabled,
  resolveTrackingRuntimeOptions,
  resolveSkeletonMode,
  resolveHeadDirectionMode,
  resolveVideoTimingMode,
  resolveInputFrameMaxDimension,
} from "../src/tracking-runtime-options.js";

assert.equal(resolveSkeletonMode(""), "legacy-hybrid");
assert.equal(resolveSkeletonMode("?skeleton-mode=canonical-world"), "canonical-world");
assert.equal(resolveSkeletonMode("?skeleton-mode=invalid"), "legacy-hybrid");
assert.equal(resolveHeadDirectionMode(''), 'off');
assert.equal(resolveHeadDirectionMode('?head-direction=legacy'), 'off');
assert.equal(resolveHeadDirectionMode('?head-direction=unknown'), 'off');
assert.equal(resolveHeadDirectionMode('?experimental-head-direction=marker'), 'head-physical');
assert.equal(resolveHeadDirectionMode('?experimental-head-direction=observed'), 'head-only');
assert.equal(resolveHeadDirectionMode('?experimental-head-direction=bind-up'), 'head-bind-up');
assert.equal(resolveVideoTimingMode(""), "adaptive-playback");
assert.equal(resolveVideoTimingMode("?video-timing=realtime"), "realtime");
assert.equal(resolveVideoTimingMode("?video-timing=invalid"), "adaptive-playback");
assert.equal(resolveInputFrameMaxDimension(""), 640);
assert.equal(resolveInputFrameMaxDimension("?input-max-dimension=1280"), 1280);
assert.equal(resolveInputFrameMaxDimension("?input-max-dimension=99999"), 640);

assert.deepEqual(resolveTrackingRuntimeOptions(""), {
  bodyWorkerEnabled: true,
  handWorkerEnabled: true,
});
assert.deepEqual(resolveTrackingRuntimeOptions("?tracking-worker=off"), {
  bodyWorkerEnabled: false,
  handWorkerEnabled: true,
});
assert.deepEqual(resolveTrackingRuntimeOptions("?hand-worker=off"), {
  bodyWorkerEnabled: true,
  handWorkerEnabled: false,
});
assert.deepEqual(
  resolveTrackingRuntimeOptions("?tracking-worker=0&hand-worker=false"),
  { bodyWorkerEnabled: false, handWorkerEnabled: false },
);

for (const disabledValue of ["0", "false", "off", "no", "none", "OFF"]) {
  assert.equal(
    isWorkerRuntimeEnabled(`?tracking-worker=${disabledValue}`, "tracking-worker"),
    false,
  );
}

for (const enabledValue of ["", "1", "true", "on", "yes", "unexpected"]) {
  assert.equal(
    isWorkerRuntimeEnabled(
      enabledValue ? `?tracking-worker=${enabledValue}` : "",
      "tracking-worker",
    ),
    true,
  );
}

console.log("Tracking runtime options check passed");
