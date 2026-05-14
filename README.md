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
- Motion agreement: `motionAgreement` is the cross-model pass/fail score for uploaded humanoid rigs. It targets `95%` and combines bone-direction match, torso front/back side-order, and projected-joint sanity so different character proportions are not treated as motion failures.
- Strict validation: `strictValidation` combines tighter joint-distance checks, 2D segment angle and length-ratio checks, left-right side-order checks, and temporal motion checks for moving joints. Its `95%` target remains a diagnostic goal for near-identical rigs; uploaded-model smoke tests use `motionAgreement` plus the model-specific gates in `docs/avatar-model-validation.md`.
- Depth validation: `depthValidation` separately measures 3D segment direction agreement against MediaPipe's relative `z` or `worldLandmarks` depth. This is not ground-truth physical depth; it is only a check that the avatar follows the depth signal available from the single-camera pose model. Depth retargeting defaults to `0.45`; use `?depth-scale=0` or `window.motionTrackerDebug.setAvatarDepthScale(0)` to compare against the flat 2D baseline. When `depthScale` equals the reference scale, the depth score is a retarget residual against the same MediaPipe depth signal, not independent proof that real-world front/back limb depth is correct.
- Avatar performance: `window.motionTrackerDebug.getAvatarPerformanceReport()` exposes rolling update, render, and validation timing summaries. The current performance budgets are update median `1.5ms`, update p95 `3ms`, render median `8ms`, render p95 `14ms`, validation median `1ms`, and validation p95 `2ms`. Use `window.motionTrackerDebug.clearAvatarPerformanceSamples()` before a recorded run if you need fresh measurements.

The avatar retargeter keeps the default depth scale conservative at `0.45` to reduce single-camera depth jitter. Set `?depth-scale=1` only when inspecting depth residuals against the full MediaPipe depth signal.

Run the dependency-free avatar budget check with:

```sh
npm run perf:avatar
```

The check verifies the local GLB size/complexity, no-package-dependency constraint, twist-limiting guards, frozen proportion calibration, and performance budget declarations. It does not initialize WebGL or request camera access.

Run the VRM candidate budget check with:

```sh
npm run perf:avatar:vrm
```

The VRM candidate gate allows up to `12 MB`, `60k` vertices, and `110` bones/nodes, and requires a VRM extension marker. Runtime budgets still use the in-browser avatar performance report; both the default Xbot and uploaded VRM should stay below update p95 `3ms`, render p95 `14ms`, and validation p95 `2ms` on the sample video.

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
- Avatar motion is an approximate retarget from MediaPipe pose and hand landmarks to supported humanoid bones, including Mixamo-style `mixamorig:*` names and common unprefixed humanoid names used by VRM exports. Limb bones use primary-direction swing retargeting so Mixamo-compatible uploads like Soldier can move the whole arm/leg instead of only the hands/feet, while head/neck and hand controls keep conservative damping. VRM models use a conservative anime profile that reduces head/neck strength, adds deadband and hysteresis, and disables screen-space proportion stretching so short chibi rigs do not overreact. It is intended as a local visual preview, not a production motion-capture solver.

## Runtime Notes

- The implementation loads MediaPipe Tasks Vision JavaScript and WASM assets from `cdn.jsdelivr.net`.
- Pose and hand model files are loaded from the public MediaPipe model URLs on `storage.googleapis.com`.
- Live tracking requires browser camera permission. Video-file testing runs from a user-selected local video file and does not require camera access.
- Avatar rendering requires browser WebGL support.
- Tracking quality depends on camera quality, lighting, body and hand visibility, and how much of the subject is in frame.
- Recorded-video testing is useful for repeatable checks, but 2D video still cannot prove perfect 3D body orientation when limbs are hidden, blurred, or moving toward the camera.
- Avatar retargeting quality depends on landmark stability and bone visibility, especially for hands and fingers.
