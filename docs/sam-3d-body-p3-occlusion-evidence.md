# SAM-3D-Body P3 Occlusion Evidence

Date: 2026-07-03

## Scope

This note records the P3 occlusion result for `jujae-regression-0-16_5`.
The committed runtime policy is deliberately limited to low-confidence arm
targets:

- hold the last reliable arm direction for a short occlusion span
- decay toward the raw target if the span continues
- clamp angular re-acquisition when confidence returns
- keep SAM offline reference targets raw in `motion-recording-compare`

## Measured Baseline

Command:

```bash
npm run compare:recordings -- \
  --live output/reports/jujae-regression-0-16_5-tracker-recording-p2.jsonl \
  --offline output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl \
  --timestamp-source sourceMeta.videoTime \
  --max-timestamp-delta-ms 25 \
  --interpolate offline \
  --offset-ms auto \
  --labels output/external/sam-3d-body/jujae-regression-0-16_5/labels.json \
  --output output/reports/tracker-vs-sam-jujae-p3-baseline.json \
  --html output/reports/tracker-vs-sam-jujae-p3-baseline.html
```

Baseline result:

- `pairedRatio`: 1.0
- `summary.occlusionArmTargetAngle.count`: 16
- `summary.occlusionArmTargetAngle.p95`: 70.776 deg
- `summary.occlusionArmTargetAngle.max`: 70.776 deg
- label summary: `crossedArmFrames` is 0, `behindBackFrames` is 40

## P3 Result

Command:

```bash
npm run compare:recordings -- \
  --live output/reports/jujae-regression-0-16_5-tracker-recording-p2.jsonl \
  --offline output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl \
  --timestamp-source sourceMeta.videoTime \
  --max-timestamp-delta-ms 25 \
  --interpolate offline \
  --offset-ms auto \
  --labels output/external/sam-3d-body/jujae-regression-0-16_5/labels.json \
  --output output/reports/tracker-vs-sam-jujae-p3-solver.json \
  --html output/reports/tracker-vs-sam-jujae-p3-solver.html
```

Result after the safe low-confidence policy:

- `summary.occlusionArmTargetAngle.count`: 16
- `summary.occlusionArmTargetAngle.p95`: 70.776 deg
- `summary.occlusionArmTargetAngle.max`: 70.776 deg
- `summary.targetAngle.p95`: 44.033 deg

The P3 occlusion-window p95 did not improve because the SAM behind-back
windows in this clip are not tracker low-confidence windows. The worst rows in
`byLabelWindowKind.left-behind-back.worstArmTargets` are high-confidence rows,
for example:

- `timestamp`: 10703.118 ms, `bone`: `LeftForeArm`, `liveConfidence`: 1.0, `offlineConfidence`: 1.0, `angleDeltaDeg`: 70.776
- `timestamp`: 8447.385 ms, `bone`: `RightForeArm`, `liveConfidence`: 1.0, `offlineConfidence`: 0.963153, `angleDeltaDeg`: 42.951

## Rejected Runtime Policy

High-confidence behind-torso or torso-overlap hold rules were tested and
rejected. They changed valid high-confidence arm motion and worsened the SAM
window p95 instead of improving it:

- broad behind-torso hold: occlusion arm p95 worsened to 104.448 deg
- torso-overlap direction-jump hold: occlusion arm p95 worsened to 112.266 deg
  and overall target p95 worsened to 59.739 deg

Therefore P3 uses the conservative low-confidence hold/decay/re-acquire policy
and records the high-confidence SAM behind-back rows as a measurement blocker
for the requested 30% p95 improvement target on this clip.
