# Browser Motion Tracker

A static browser motion tracker that uses MediaPipe Tasks Vision to draw pose and hand landmarks over a live camera feed or uploaded test video, with a side-by-side 3D avatar viewport driven by the same detected landmarks.

## Run Locally

Serve the project from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://localhost:8000` in a browser. Use **Start** to allow camera access, or choose a local video file from **Test video** to replay a recorded dance clip through the same tracker.

You can also use the npm script:

```sh
npm run start
```

Do not open `index.html` with `file://`. The app uses ES modules, an import map, browser camera APIs, and WebGL, so it needs a browser context such as `localhost`.

## Check

Run the local static contract check:

```sh
npm run check
```

The check is dependency-free and only reads local files. It does not load remote MediaPipe assets, request camera access, initialize WebGL, or contact remote services.

## Module Hierarchy

The current runtime and validation module boundaries are documented in `docs/MODULE_HIERARCHY.md`.

## Claude Code Codex Consultation

This repo includes a Claude Code project command for asking Codex CLI for an independent engineering opinion:

```text
/codex-consult [--model MODEL] [--effort EFFORT] [question or task]
```

The command calls `scripts/claude-codex-consult.sh`, which defaults to `gpt-5.5`, `xhigh` reasoning, workspace-write sandboxing, and Codex's `on-request` approval policy. It intentionally does not set token, budget, or reasoning caps. Claude Code should run the wrapper with a generous Bash timeout; `3600000` ms is the recommended minimum because xhigh Codex runs can take a long time.

Project-level Claude Code permissions in `.claude/settings.json` default to `auto`.

## Body Validation

The browser exposes `window.motionTrackerDebug.getBodyValidationReport()` while tracking is running. It reports two separate validation layers:

- Direction match: body segment angle error between the MediaPipe pose direction and the corresponding avatar bone direction. This is useful for debugging retarget math, but it is not enough to prove that the rendered model visually matches the source person.
- Visual skeleton match: normalized 2D joint distance between the MediaPipe skeleton in the input video and the 3D avatar skeleton projected back to the avatar viewport. This is the stricter metric to use when judging whether the model actually appears to follow the person.
- Motion agreement: `motionAgreement` is the cross-model pass/fail score for uploaded humanoid rigs. It targets `95%` overall and at least `90%` for each gated component. The gated components are 3D bone-direction match and torso front/back side-order; projected-segment direction stays in the report as a viewport sanity diagnostic so different character proportions are not treated as motion failures.
- Strict validation: `strictValidation` combines tighter joint-distance checks, 2D segment angle and length-ratio checks, left-right side-order checks, and temporal motion checks for moving joints. Its `95%` target remains a diagnostic goal for near-identical rigs; uploaded-model smoke tests use `motionAgreement` plus the model-specific gates in `docs/avatar-model-validation.md`.
- Depth validation: `depthValidation` separately measures 3D segment direction agreement against MediaPipe's relative `z` or `worldLandmarks` depth. This is not ground-truth physical depth; it is only a check that the avatar follows the depth signal available from the single-camera pose model. Depth retargeting defaults to `0.45`; use `?depth-scale=0` or `window.motionTrackerDebug.setAvatarDepthScale(0)` to compare against the flat 2D baseline.
- Dynamic depth calibration: `depthCalibration` uses warmup `worldLandmarks` samples to estimate stable torso/limb segment lengths, then refines per-frame source `z` before body retargeting and validation share the same calibrated points. It defaults to `dynamic`; use `?depth-calibration=static` or `window.motionTrackerDebug.setDepthCalibrationMode("static")` to roll back to the raw depth path. Full-body warmup still targets 6 gated segments, while upper-body-only framing can warm up from the four arm segments and falls back to shoulder-width world-depth scaling when hips are missing. `window.motionTrackerDebug.getDepthCalibrationReport()` reports score, segment CV, clamp warnings, coverage, required reference segment count, and readiness. The accuracy gate is score >= `95%`, mean segment CV <= `5%`, and p95 segment CV <= `8%`; calibration runtime p95 should stay <= `0.6ms`.
- Avatar performance: `window.motionTrackerDebug.getAvatarPerformanceReport()` exposes rolling update, render, validation, depth-calibration, and face-expression apply timing summaries. The current performance budgets are update median `1.5ms`, update p95 `3ms`, render median `8ms`, render p95 `14ms`, validation median `1ms`, validation p95 `2ms`, face-expression apply p95 `0.5ms`, and depth-calibration p95 `0.6ms`. Use `window.motionTrackerDebug.clearAvatarPerformanceSamples()` before a recorded run if you need fresh measurements.
- App pipeline performance: `window.motionTrackerDebug.getAppPerformanceReport()` exposes the active frame pump (`auto`, `rvfc`, or `raf`), callback/detection FPS, duplicate-frame counts, detect/process/draw/frame-total p95 timings, optional face detect/process p95 timings, and tracking-worker status. Use `?pump=rvfc`, `?pump=raf`, or `?pump=auto` to compare schedulers. `?tracking-worker=on` moves pose/hand/optional face detection into a module Web Worker when the browser supports `Worker`, `createImageBitmap`, and `OffscreenCanvas`; the worker loads MediaPipe's module wasm fileset and converts transferred video frames through `ImageData` before detection. If initialization or frame transfer fails, the app records `fallbackReason` and continues on the main-thread detector. Worker mode remains opt-in unless its p95 timings beat the default path. `?debug-overlay=off` disables the 2D landmark overlay for measurement runs without changing avatar retargeting or validation. Use `window.motionTrackerDebug.getTrackedChannelReport()` to inspect the latest body, hand, face, expression, and finger-chain channel coverage.
- Retarget smoothing is default-off for comparison runs. Use `?smoothing=retarget` or `?smoothing=strong` to enable bounded avatar retarget smoothing, and inspect `window.motionTrackerDebug.getAvatarPerformanceReport().retargetSmoothing` or the `avatarSmoothingMode` field in `scripts/avatar-motion-agreement-check.mjs` reports.

The avatar retargeter keeps the default depth scale conservative at `0.45`, then applies dynamic segment-length calibration when enough world landmark samples are available. Body retargeting also uses landmark visibility to hold low-confidence limb directions and limb-plane normals as secondary axes for arm/leg twist stability. Set `?depth-scale=1` only when inspecting depth residuals against the full MediaPipe depth signal; set `?depth-scale=0` for a flat baseline, which disables dynamic calibration.

## Motion Timeline

Runtime pose/hand updates are normalized into a versioned `motionFrame` before they reach the avatar renderer. The frame contains `timestamp`, `mirrored`, `poseLandmarks`, `poseWorldLandmarks`, `leftHandLandmarks`, `rightHandLandmarks`, optional `leftHandWorldLandmarks` / `rightHandWorldLandmarks`, `sourceMeta`, and optional `face` data. Face data is serialized as `{ version: 1, blendShapes: [{ name, score }], transformMatrix, landmarks, sourceMeta }`. Full 478-point face landmarks are opt-in with `?face-landmarks=on` or `window.motionTrackerDebug.setFaceLandmarksEnabled(true)` because they materially increase recording and forwarding payload size.

The debug API exposes a JSON-only recording and replay loop:

- `window.motionTrackerDebug.startMotionRecording()`
- `window.motionTrackerDebug.stopMotionRecording()`
- `window.motionTrackerDebug.getMotionRecording()`
- `window.motionTrackerDebug.clearMotionRecording()`
- `window.motionTrackerDebug.loadMotionRecording(recording)`
- `window.motionTrackerDebug.getMotionReplayStatus()`
- `window.motionTrackerDebug.stopMotionReplay()`

`stopMotionRecording()` returns `{ version: 1, source, frames, createdAt, droppedFrames }`. It records landmark timelines only; raw video files and avatar binaries are never embedded. `loadMotionRecording(recording)` replays the timeline directly into the renderer and validation reports without running MediaPipe again.

Offline HMR systems such as WHAM, GVHMR, GEM-X, or SAM 3D Body can be connected only as external extractors that produce this same recording JSON. Use `source.type: "external-hmr"` or an extractor name such as `gemx`, then write frames with 33 normalized `poseLandmarks`, 33 `poseWorldLandmarks`, optional 21-point hand landmarks, and scalar `sourceMeta` fields describing the source joint count and mapping. `normalizeExternalMotionRecording(recording)` validates that contract before replay. Do not embed raw video bytes, avatar/model binaries, or heavyweight model runtime state in the recording.

Forwarding is an optional browser WebSocket client, not a local server:

- `window.motionTrackerDebug.connectMotionForwarding("ws://127.0.0.1:PORT/path")`
- `window.motionTrackerDebug.disconnectMotionForwarding()`
- `window.motionTrackerDebug.getMotionForwardingStatus()`

Each forwarded message is `{ type: "action-tracker-motion-frame", version: 1, frame }`, using the same serialized frame shape as recordings. Forwarding failures update status only; they do not stop camera/video tracking or avatar rendering.

## Face Expressions

Face tracking is default-off and opt-in only:

- Start with `?face-tracking=on`, or call `await window.motionTrackerDebug.setFaceTrackingEnabled(true)`.
- Add `?face-landmarks=on`, or call `await window.motionTrackerDebug.setFaceLandmarksEnabled(true)`, to preserve the full MediaPipe face mesh in each frame. This flag also enables face tracking.
- Read state with `window.motionTrackerDebug.getFaceTrackingEnabled()` and `window.motionTrackerDebug.getFaceTrackingStatus()`.
- Use `window.motionTrackerDebug.getAvatarRigReport().expressions` to inspect VRM expression coverage.

When enabled, the app loads MediaPipe `FaceLandmarker` from the same Tasks Vision runtime and requests blendshape scores plus a facial transformation matrix. The renderer maps MediaPipe/ARKit blendshape names to VRM0/VRM1 preset expressions such as blink, mouth visemes, smile, and look direction by driving GLTF morph targets directly, and uses the facial transformation matrix as a bounded head/neck pose correction after the pose-landmark head aim. Full face landmarks are preserved only when explicitly requested. It does not add Electron, MediaPipe Holistic, Kalidokit, `@pixiv/three-vrm`, FBX loading, MToon, or SpringBone runtime behavior.

Run the dependency-free avatar budget check with:

```sh
npm run perf:avatar
```

The check verifies the local GLB size/complexity, no-package-dependency constraint, twist-limiting guards, frozen proportion calibration, and performance budget declarations. It does not initialize WebGL or request camera access.

Run the VRM candidate compatibility check with:

```sh
npm run perf:avatar:vrm
```

The VRM check validates the VRM extension marker, VRM0/VRM1 humanoid metadata, required body mappings, and three-segment finger chains. Runtime `window.motionTrackerDebug.getAvatarRigReport()` also reports VRM expression coverage, rest-pose cache coverage, inferred bone orientation axes, unresolved node mappings, and current finger chain coverage. It reports the legacy `12 MB` / `60k` vertex / `110` bone budget as warnings only unless `--enforce-budget` is passed. Runtime budgets still use the in-browser avatar performance report; both the default Xbot and uploaded VRM should stay below update p95 `3ms`, render p95 `14ms`, and validation p95 `2ms` on the sample video.

Run the browser-based motion agreement loop with:

```bash
npm run motion:avatar
```

It launches an isolated headless Chrome session, uploads the sample video, checks Xbot, Soldier, and local VRM candidates, and writes `output/reports/avatar-motion-agreement-latest.json`. The gate includes motion agreement, arms depth/front-back, dynamic depth-calibration score/CV, and depth-calibration runtime. Add `--tracking-worker on`, `--smoothing retarget`, or `--smoothing off` for opt-in comparison runs. Add downloaded VRoid Hub files with repeated `--model "Label=/absolute/path/model.glb"` arguments; VRM files may use `.glb` as long as they contain `VRMC_vrm` metadata.

The browser motion gate also records the measured timeline, replays it without MediaPipe, and checks that replay keeps enough pose frames and stays within a `3%` motion-agreement delta from the live/video pass. Runtime performance is sampled while recording is enabled so recording overhead remains inside the existing update and validation budgets.

Compare the video-frame pump against the rAF fallback with:

```sh
npm run perf:pump
```

This runs the same sample video and Xbot model twice, once with `?pump=raf` and once with `?pump=rvfc`, then writes `output/reports/frame-pump-comparison-latest.json`. The gate expects rVFC to keep motion agreement above `95%`, avoid frame p95 regression above `125%` of rAF, and reduce callback volume or duplicate video-frame work.

Run the ratio-matched Soldier GLB budget check with:

```sh
npm run perf:avatar:soldier
```

The Soldier gate keeps the uploaded test model below `3.5 MB`, `30k` vertices, and `80` Mixamo-compatible bones. Its recorded-video smoke gate is documented in `docs/avatar-model-validation.md`.

Use the **Avatar skeleton** toggle to render the model's live bone skeleton over the 3D avatar. This makes leg crossing, side swaps, and badly aimed limb bones visible without relying only on the skinned mesh.

The 3D avatar viewport supports orbit inspection: drag inside the avatar canvas to rotate, use the wheel or trackpad to zoom, and use **Reset** or double-click the viewport to return to the default front view. Reset the view before recording validation numbers if you want the visual projection score to match the source-video orientation.

Camera input is mirrored by default because that matches a normal webcam preview. Uploaded video files are replayed unmirrored by default so prerecorded clips are tested in their original left-right orientation. The **Mirror input** toggle can still be changed manually while tracking.

## 3D Avatar

- The right-hand viewport renders `assets/models/Xbot.glb`, a local rigged Xbot model.
- With no avatar file selected, the app always falls back to `assets/models/Xbot.glb`. Use **Avatar model** to load a local `.glb`, `.gltf`, or `.vrm` file for the current browser session, and **Default avatar** to return to Xbot.
- The ratio-matched Soldier test model is stored at `assets/models/ratio-candidates/soldier.glb` and can be loaded through **Avatar model** when validating full-body motion.
- The model is sourced from the three.js examples repository: `https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Xbot.glb`.
- The upstream source is MIT licensed by three.js. The license reference is documented in `assets/models/README.md`, and the local license text is stored at `assets/models/threejs-LICENSE.txt`.
- The avatar renderer uses the browser's WebGL support through Three.js and the local `Xbot.glb` file. If WebGL or the model load fails, the camera tracker should continue to report the avatar failure without breaking capture.
- Avatar motion is an approximate retarget from MediaPipe pose and hand landmarks to supported humanoid bones, including Mixamo-style `mixamorig:*` names, common unprefixed humanoid names, and VRM0/VRM1 humanoid metadata. Limb bones use primary-direction swing retargeting so Mixamo-compatible uploads like Soldier can move the whole arm/leg instead of only the hands/feet. `?smoothing=retarget` enables bounded head/neck/body/hand smoothing; without that flag, comparison runs use immediate retarget application. VRM models use a conservative anime profile that reduces head/neck strength, adds deadband and hysteresis, and applies bounded screen-space proportion calibration so short rigs do not overreact. It is intended as a local visual preview, not a production motion-capture solver.
- SysMocap is useful prior art for timeline recording, forwarding, and model workflow ideas, but this project intentionally does not clone SysMocap's Electron shell, OBS/WebXR product surface, MediaPipe Holistic runtime, Kalidokit dependency, `@pixiv/three-vrm` runtime, MToon/SpringBone simulation, or FBX loader in the default path.

## Runtime Notes

- The implementation loads MediaPipe Tasks Vision JavaScript and WASM assets from `cdn.jsdelivr.net`.
- Pose, hand, and opt-in face model files are loaded from the public MediaPipe model URLs on `storage.googleapis.com`.
- Live tracking requires browser camera permission. Video-file testing runs from a user-selected local video file and does not require camera access.
- Avatar rendering requires browser WebGL support.
- Tracking quality depends on camera quality, lighting, body and hand visibility, and how much of the subject is in frame.
- Recorded-video testing is useful for repeatable checks, but 2D video still cannot prove perfect 3D body orientation when limbs are hidden, blurred, or moving toward the camera.
- Avatar retargeting quality depends on landmark stability and bone visibility, especially for hands and fingers.
- Face tracking and VRM expression mapping are optional and default-off. Iris-level lookAt, direct eye-bone rotation, manual binding UI, and FBX support are still deferred.
