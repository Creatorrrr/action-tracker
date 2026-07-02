# Avatar Model Validation Plan

## Scope

Validate that the default `assets/models/Xbot.glb` and uploaded VRM/anime-style
models can both load, retarget, and render without exceeding the existing runtime
budget. The ratio-matched Soldier GLB is the primary non-chibi test model for
full-body motion parity.

## Test Inputs

- Default model: `assets/models/Xbot.glb`
- Ratio-matched GLB candidate: `assets/models/ratio-candidates/soldier.glb`
- VRM full-finger candidate: `assets/models/anime-candidates/polydancer.vrm`
- VRM lightweight partial-finger candidate:
  `assets/models/anime-candidates/elel-silverbell.vrm`
- Downloaded VRoid Hub candidates can be checked with repeated `--model`
  arguments. The local validation set used on 2026-05-14 was:
  `/Users/chasoik/Downloads/3003783639202631812.glb`,
  `/Users/chasoik/Downloads/5483827240867983999.glb`,
  `/Users/chasoik/Downloads/5804946703261501708.glb`,
  `/Users/chasoik/Downloads/5245375627490797592.glb`, and
  `/Users/chasoik/Downloads/3078376947502904970.glb`.
- Repeatable video: `output/test-videos/dance-16x9-padded.mp4`

## Required Checks

1. Static contract: `npm run check`
2. Default avatar asset/performance budget: `npm run perf:avatar`
3. Soldier GLB asset budget: `npm run perf:avatar:soldier`
4. VRM candidate humanoid/finger mapping check: `npm run perf:avatar:vrm`
5. Frame-pump performance comparison: `npm run perf:pump`
6. Browser motion gate: `npm run motion:avatar`
   - The default motion gate checks Xbot, Soldier, and the full-finger
     Polydancer VRM. The Elel lightweight candidate is a partial-finger VRM and
     is kept for load/performance diagnostics, not full-finger pass/fail.
   - For downloaded VRoid Hub files outside the repo, add one `--model
     "Label=/absolute/path/model.glb"` argument per file.
   - The gate records the measured `motionFrame` timeline, replays it without
     running MediaPipe again, and requires replay motion agreement to stay
     within `3%` of the live/video measurement.
6. Manual browser smoke:
   - Load page with no avatar file selected.
   - Confirm Xbot reaches `Avatar: Ready`.
   - Upload `soldier.glb`.
   - Confirm Soldier reaches `Avatar: Ready`.
   - Upload `polydancer.vrm`.
   - Confirm VRM reaches `Avatar: Ready`.
   - Run the sample video for at least 8 seconds on each model.
   - Collect `motionTrackerDebug.getBodyValidationReport()` and
     `motionTrackerDebug.getAvatarPerformanceReport()`.
   - Collect `motionTrackerDebug.getDepthCalibrationReport()` and confirm the
     dynamic calibration is ready, score is above `95%`, and
     `depthCalibration` runtime p95 is <= `0.6ms`.
   - Collect `motionTrackerDebug.getAvatarRigReport()` and confirm the required
     body bones are present and each finger chain reports at least 3 mapped
     segments for full-finger VRM candidates.
   - Use `?depth-calibration=static` or
     `motionTrackerDebug.setDepthCalibrationMode("static")` only for rollback
     and baseline comparisons.

## Runtime Performance Gates

The default Xbot gate remains strict:

- update median <= `1.5ms`, p95 <= `3ms`
- render median <= `8ms`, p95 <= `14ms`
- validation median <= `1ms`, p95 <= `2ms`
- dynamic depth calibration p95 <= `0.6ms`

The current VRM candidate must satisfy the same runtime p95 gates during the
sample-video run. VRM file size, vertex count, and bone/node count are reported
as compatibility warnings by default, not blocking failures. Pass
`--enforce-budget` to `scripts/avatar-vrm-performance-check.mjs` only when a
specific release wants to restore the legacy `12 MB` / `60k` / `110` gate.

The Soldier GLB asset gate allows:

- file size <= `3.5 MB`
- vertices <= `30k`
- Mixamo-compatible bones <= `80`

## Motion Quality Gates

The sample-video gate is model-relative because chibi proportions cannot match
the source person's 2D skeleton exactly.

- All checked models must stay `Ready` during playback.
- All checked models must report `depthScale: 0.45` unless `?depth-scale=` overrides it.
- Dynamic depth calibration defaults to `dynamic`. `?depth-scale=0` is the flat
  baseline/debug mode and disables dynamic calibration.
- Xbot must use `model.kind: default` and keep proportion calibration enabled.
- VRM must use `model.kind: anime` and keep bounded proportion calibration enabled.
- Runtime p95 metrics must stay inside the performance gates above.
- Recording enabled during the browser motion gate must still stay inside the
  same update/render/validation p95 gates.
- Cross-model motion agreement must be >= `0.95`.
  - Direction match weight: `0.85`
  - Torso front/back side-order weight: `0.15`
  - Projected-segment direction weight: `0`
- Each gated motion agreement component must be >= `0.90`.
- Direction group scores must be >= `0.90` for torso, arms, and legs.
- Dynamic depth calibration must be ready and score >= `0.95`.
  - Segment sample pass condition: relative length error <= `8%` and z
    smoothness within threshold.
  - Mean segment CV must be <= `5%`.
  - p95 segment CV must be <= `8%`; CV uses robust 5-95% trimming and excludes
    clamped samples because clamped frames are tracked by `clampedRatio`
    warnings.
  - A high clamped ratio is a warning, not a hard failure, because it means the
    2D projected length already exceeds the current 3D target length.
- Neck direction remains a diagnostic segment because some VRM rigs expose
  neck/head rest axes that do not track the source shoulder-to-head aim as a
  body-motion failure.
- Projected-segment and visual projected-joint scores stay in the report as
  viewport/same-proportion diagnostics only; they are not the cross-model
  pass/fail gate for VRoid/anime models.
- Neck, strict-validation, projected-segment, and visual-joint reports are kept
  for diagnosis. They can be low for rigs with different proportions or neck
  rest axes without failing the uploaded-model gate.

For the Soldier GLB sample-video gate, use stricter full-body criteria because
its proportions are close to the default Xbot and it is not chibi:

- Motion agreement >= `0.95`
- Direction match overall >= `0.95`
- Direction match by group: arms >= `0.90`, legs >= `0.95`, torso >= `0.90`
- Projected-segment direction is recorded as a viewport diagnostic.
- Torso front/back side-order match >= `0.98`
- `strictValidation` remains a same-proportion diagnostic and is not the
  uploaded-rig pass/fail score.
- Runtime update/render/validation p95 must stay inside the performance gates.

## Current Post-Fix Measurement

Measured in browser on `dance-16x9-padded.mp4` for about 8 seconds with
`scripts/avatar-motion-agreement-check.mjs`:

| Model | Kind | Motion | Direction | Arms direction | Arms depth | Arms front/back | Depth calibration | Mean CV | P95 CV | Cal p95 | Finger min |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Xbot | default | 98.4% | 98.1% | 95.7% | 96.9% | 99.7% | 99.8% | 0.2% | 0.8% | 0.1ms | 4 |
| Soldier GLB | default | 98.5% | 98.3% | 96.1% | 97.1% | 100.0% | 99.5% | 0.2% | 0.7% | 0.1ms | 4 |
| Polydancer VRM | anime | 98.3% | 98.0% | 95.5% | 96.3% | 100.0% | 98.7% | 0.9% | 4.2% | 0.1ms | 4 |
| VRoid 3003783639202631812 | anime | 98.5% | 98.3% | 96.1% | 97.5% | 100.0% | 99.5% | 0.1% | 0.7% | 0.1ms | 3 |
| VRoid 5483827240867983999 | anime | 97.7% | 97.3% | 93.9% | 96.1% | 98.9% | 99.2% | 0.4% | 1.3% | 0.1ms | 3 |
| VRoid 5804946703261501708 | anime | 98.0% | 97.6% | 94.7% | 95.7% | 99.7% | 98.9% | 0.8% | 4.0% | 0.1ms | 3 |
| VRoid 5245375627490797592 | anime | 98.2% | 97.9% | 95.2% | 96.9% | 100.0% | 99.4% | 0.2% | 0.8% | 0.1ms | 3 |
| VRoid 3078376947502904970 | anime | 97.4% | 97.0% | 93.2% | 95.3% | 99.7% | 99.4% | 0.2% | 1.5% | 0.1ms | 3 |

Soldier keeps the arm direction, depth, and front/back checks above target.
Its projected/visual arms diagnostics remain warnings because the GLB's arm
proportions and camera projection diverge from the source skeleton even when
the 3D retarget direction and front/back checks are aligned.

This measurement is limited to the existing dance clip. Final acceptance across
front/back movement, rotation, and large arm/leg depth-change clips remains
blocked until those additional depth-rich videos are available.

## Soldier Motion Measurement

Measured in browser on `dance-16x9-padded.mp4` after switching the default
avatar view to the model's front side and using primary-direction limb retargets
for uploaded Mixamo rigs:

| Model | Motion agreement | Direction overall | Arms | Legs | Arms depth | Arms front/back | Visual overall | Visual arms | Front/back | Update p95 | Render p95 | Validation p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Xbot | 98.4% | 0.981 | 0.957 | 1.000 | 0.969 | 0.997 | 0.997 | 0.998 | 1.000 | 0.3ms | 0.3ms | 0.1ms |
| Soldier GLB | 98.5% | 0.983 | 0.961 | 1.000 | 0.971 | 1.000 | 0.783 | 0.742 | 1.000 | 0.3ms | 0.3ms | 0.1ms |

Pre-fix Soldier baseline on the same sample showed arms direction match around
`0.02` and visual arms match `0`, which is the "only hands/feet tips move"
failure mode.

MediaPipe may print its own WebAssembly/OpenGL warnings in the browser console;
those are not app-level avatar failures unless the avatar leaves `Ready`.

## VRoid Hub VRM Workflow

- Download the `.vrm` from VRoid Hub, then load it through **Avatar model**.
  The app does not fetch VRoid Hub URLs directly.
- Prefer `VRM1.0 Constraint Test` for external full-finger validation because
  its public metadata indicates VRM1, downloadable usage, and finger metacarpal
  support.
- The renderer reads VRM0/VRM1 humanoid metadata and maps semantic bones such as
  `leftUpperArm`, `leftIndexProximal`, and `leftThumbMetacarpal` into the
  existing Mixamo-style retarget names.
- MToon rendering, SpringBone, and VRM constraint simulation are outside this
  motion-preview scope.
- If a VRM model appears backward-facing, reset the avatar view first and then
  record the rig report plus a screenshot. VRM0 models receive a default
  180 degree Y rotation before framing; VRM1 models keep the spec-forward
  orientation.
- Include `window.motionTrackerDebug.getAvatarRigReport()` in VRM issue reports.
  The report now includes humanoid mapping, expression coverage, finger chain
  coverage, rest-pose cache coverage, and inferred bone orientation axes so
  missing metadata, backward-facing rigs, and bad retarget axes can be separated.
