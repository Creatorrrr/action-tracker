import assert from "node:assert/strict";
import {
  isWorkerRuntimeEnabled,
  resolveTrackingRuntimeOptions,
} from "../src/tracking-runtime-options.js";

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
