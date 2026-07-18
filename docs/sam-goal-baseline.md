# SAM Goal Baseline Harness

`scripts/sam-goal-baseline.mjs` freezes the pre-improvement evidence used by
`GOAL_PLAN.md`. It does not change detector, solver, retarget, or evaluation
thresholds. Large generated recordings and reports stay under an ignored
caller-selected output directory; the committed surface is the CLI, schema,
test, and this document.

## Inventory

The default paired clips are:

- `arms-crossed`
- `csi-pose`
- `dance-16x9-padded`
- `jujae-regression-0-16_5`
- `shorts-keGbIts0CA0-16x9-padded`
- `shorts-new-dance-E9_h_ZW5z0U-16x9-padded`
- `shorts-vc0GDveRIp0-16x9-padded`

`jujae.mp4` is always inventoried as `jujae-full` with
`reason: teacher_missing`; it is never a paired accuracy cell. The required rig
IDs are `Xbot`, `Soldier`, and `Polydancer`. Use `--rig-model id=path` to bind
the exact model artifact used by a run.

## Commands

Plan and hash the complete matrix without starting a browser:

```sh
node scripts/sam-goal-baseline.mjs \
  --dry-run \
  --output-dir output/sam-goal-baseline
```

Run the fixed target profile after the independent evaluation contract exists:

```sh
node scripts/sam-goal-baseline.mjs \
  --evaluation-contract tests/fixtures/sam-goal-v2/evaluation-contract.json \
  --output-dir output/sam-goal-baseline \
  --delegate gpu \
  --tracking-worker on \
  --playback-rate 1 \
  --pump rvfc \
  --face-tracking off \
  --smoothing retarget \
  --avatar-retarget strict \
  --device-profile "macOS 26.5.1 / M1 Max / Chrome 150"
```

Resume only cells whose complete run identity and artifacts still match:

```sh
node scripts/sam-goal-baseline.mjs \
  --resume \
  --evaluation-contract tests/fixtures/sam-goal-v2/evaluation-contract.json \
  --output-dir output/sam-goal-baseline
```

Use repeated `--clip` and `--rig` options for an explicitly selected subset.
An omitted selector requests the full default dimension. `--clip-manifest`
exists for controlled fixtures and versioned alternative inventories; it must
provide `clips` and `unpaired` arrays.

## Pipeline and exact timing

For each clip the harness first converts `skeletons_mhr70.jsonl` with
`hmr-jsonl-adapter.mjs`. For each selected clip/rig cell it then invokes
`avatar-motion-agreement-check.mjs` with one model and saves the raw live
recording. Finally it invokes `motion-recording-compare.mjs` with
`sourceMeta.videoTime`, offline interpolation, and a fixed zero offset.
Automatic motion-offset estimation is intentionally not used as a substitute
for exact source time.

The default `minPoseFrames` is deliberately huge so the agreement runner waits
for video end instead of stopping after a small pose sample. A timeout, partial
recording warning, missing pose frames, missing artifact, failed comparison, or
child nonzero exit makes the cell fail. Before each child stage, the harness
removes that stage's prior outputs, so an exit-zero child cannot pass by leaving
stale files behind. It also requires wall-clock coverage of the probed source
duration, a final live `sourceMeta.videoTime` at or beyond 90% of source
duration, close agreement between report and recording frame counts, and at
least 95% live-frame pairing in the comparison. Every JSONL header frame count
must equal its physical frame rows. The converted teacher header must also
reconcile exactly with the raw SAM JSONL line count, `droppedFrames`, and SAM
summary `processed_frames`. Requested delegate, worker, frame pump, smoothing,
and retarget modes must be actually active. A skipped required model or silent
runtime fallback fails the cell.

## Index contract

The output index conforms to
`tests/fixtures/sam-goal-v2/baseline-schema.json` and records:

- Git head, branch, dirty state, and a content-based dirty fingerprint covering
  unstaged/staged binary diffs plus every non-ignored untracked file. Keeping
  the same `git status` shape cannot hide a source change.
- OS/CPU/Node/browser/device profile and media-probe version.
- Source codec, width, height, average frame rate, time base, and duration for
  every paired and unpaired video. Real repository inputs are fail-closed probed
  with `ffprobe`; controlled manifests may provide the same complete metadata.
- Raw SAM line count and summary source/processed/prediction/miss counts; the
  completeness rules and thresholds are part of the hashed runtime config.
- Delegate, worker, playback, pump, face, smoothing, retarget, and timeout
  configuration.
- SHA-256 and size for every source video, teacher raw/metadata/summary file,
  selected model, evaluation contract, and child CLI.
- Exact child command arrays.
- Per-cell status, failure reason, command exit/timeout/log evidence, and
  recording/report hashes.
- Whether the current invocation regenerated the clip-shared teacher recording
  before reusing otherwise unchanged cell outputs.

`--resume` compares the complete run identity before doing any work. A changed
model, source, teacher, contract, script, Git dirty fingerprint, environment,
or runtime option fails with `hash_drift` instead of silently overwriting the
old baseline. Completed cells are reused only when all required artifact hashes
still match.

Intentional cadence reduction is a runtime configuration, not a dropped-frame
result. Later performance reports must keep cadence skips separate from queue
overload, stale callbacks, and deadline misses.

## Verification

```sh
node tests/sam-goal-baseline-check.mjs
node --check scripts/sam-goal-baseline.mjs
npm run check
git diff --check
```

The focused test uses synthetic source/teacher/model files and injected public
CLI replacements. It covers seven-pair/three-rig enumeration, unpaired
`jujae`, paths with spaces, fractional FPS metadata, successful single-cell
execution, identity-safe resume, model hash drift, partial output, child
timeout, skipped model, delayed one-frame source-PTS truncation, teacher-adapter
truncation, stale-output reuse, delegate fallback, and missing inputs without
launching a browser.
