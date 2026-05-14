# Avatar Model Validation Plan

## Scope

Validate that the default `assets/models/Xbot.glb` and uploaded VRM/anime-style
models can both load, retarget, and render without exceeding the existing runtime
budget. The ratio-matched Soldier GLB is the primary non-chibi test model for
full-body motion parity.

## Test Inputs

- Default model: `assets/models/Xbot.glb`
- Ratio-matched GLB candidate: `assets/models/ratio-candidates/soldier.glb`
- VRM candidate: `assets/models/anime-candidates/elel-silverbell.vrm`
- Repeatable video: `output/test-videos/dance-16x9-padded.mp4`

## Required Checks

1. Static contract: `npm run check`
2. Default avatar asset/performance budget: `npm run perf:avatar`
3. Soldier GLB asset budget: `npm run perf:avatar:soldier`
4. VRM candidate asset budget: `npm run perf:avatar:vrm`
5. Browser smoke:
   - Load page with no avatar file selected.
   - Confirm Xbot reaches `Avatar: Ready`.
   - Upload `soldier.glb`.
   - Confirm Soldier reaches `Avatar: Ready`.
   - Upload `elel-silverbell.vrm`.
   - Confirm VRM reaches `Avatar: Ready`.
   - Run the sample video for at least 8 seconds on each model.
   - Collect `motionTrackerDebug.getBodyValidationReport()` and
     `motionTrackerDebug.getAvatarPerformanceReport()`.

## Runtime Performance Gates

The default Xbot gate remains strict:

- update median <= `1.5ms`, p95 <= `3ms`
- render median <= `8ms`, p95 <= `14ms`
- validation median <= `1ms`, p95 <= `2ms`

The current VRM candidate must satisfy the same runtime p95 gates during the
sample-video run. The separate VRM asset gate allows:

- file size <= `12 MB`
- vertices <= `60k`
- bones/nodes <= `110`
- VRM extension marker present

The Soldier GLB asset gate allows:

- file size <= `3.5 MB`
- vertices <= `30k`
- Mixamo-compatible bones <= `80`

## Motion Quality Gates

The sample-video gate is model-relative because chibi proportions cannot match
the source person's 2D skeleton exactly.

- Both models must stay `Ready` during playback.
- Both models must report `depthScale: 0.45` unless `?depth-scale=` overrides it.
- Xbot must use `model.kind: default` and keep proportion calibration enabled.
- VRM must use `model.kind: anime` and keep proportion calibration disabled.
- Neck tracking should remain stable:
  - neck mean error <= `15deg`
  - neck p90 error <= `25deg`
- Torso tracking should remain stable:
  - torso mean error <= `15deg`
- Runtime p95 metrics must stay inside the performance gates above.
- Cross-model motion agreement must be >= `0.95`.
  - Direction match weight: `0.75`
  - Torso front/back side-order weight: `0.15`
  - Projected-joint sanity weight: `0.10`

For the Soldier GLB sample-video gate, use stricter full-body criteria because
its proportions are close to the default Xbot and it is not chibi:

- Motion agreement >= `0.95`
- Direction match overall >= `0.95`
- Direction match by group: arms >= `0.90`, legs >= `0.95`, torso >= `0.90`
- Visual projected-joint match overall >= `0.80`
- Visual projected-joint match by group: arms >= `0.70`, legs >= `0.70`
- Torso front/back side-order match >= `0.98`
- `strictValidation` remains a same-proportion diagnostic and is not the
  uploaded-rig pass/fail score.
- Runtime update/render/validation p95 must stay inside the performance gates.

## Current Post-Fix Measurement

Measured in browser on `dance-16x9-padded.mp4` for about 8 seconds:

| Model | Kind | Depth | Neck mean | Neck p90 | Torso mean | Update p95 | Render p95 | Validation p95 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Xbot | default | 0.45 | 6.3deg | 12.6deg | 7.0deg | 0.5ms | 0.3ms | 0.1ms |
| Elel Silverbell VRM | anime | 0.45 | 5.6deg | 9.7deg | 8.6deg | 0.2ms | 0.3ms | 0.1ms |

## Soldier Motion Measurement

Measured in browser on `dance-16x9-padded.mp4` after switching the default
avatar view to the model's front side and using primary-direction limb retargets
for uploaded Mixamo rigs:

| Model | Motion agreement | Direction overall | Arms | Legs | Visual overall | Visual arms | Visual legs | Front/back | Strict diagnostic | Update p95 | Render p95 | Validation p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Xbot | 99.7% | 0.998 | 0.994 | 1.000 | 0.986 | 0.982 | 0.977 | 1.000 | 79.2% | 0.4ms | 0.3ms | 0.1ms |
| Soldier GLB | 97.3% | 0.990 | 0.984 | 1.000 | 0.803 | 0.723 | 0.686 | 1.000 | 50.0% | 0.3ms | 0.3ms | 0.1ms |

Pre-fix Soldier baseline on the same sample showed arms direction match around
`0.02` and visual arms match `0`, which is the "only hands/feet tips move"
failure mode.

MediaPipe may print its own WebAssembly/OpenGL warnings in the browser console;
those are not app-level avatar failures unless the avatar leaves `Ready`.
