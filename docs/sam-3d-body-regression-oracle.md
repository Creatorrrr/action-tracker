# SAM 3D Body Regression Oracle

This project uses SAM-3D-Body as an offline pseudo-ground-truth source, not as a
browser runtime dependency. The regression oracle is a three-step workflow:

1. Convert SAM MHR70 skeletons to an action-tracker recording with
   `npm run hmr:jsonl -- --joint-format mhr70`.
2. Compare a browser tracker recording against the SAM recording with
   `npm run compare:recordings`.
3. Gate the generated comparison JSON with `npm run sam:oracle`.

## Juojae Clip Baseline

The current labeled regression clip is:

- video: `output/test-videos/jujae-regression-0-16_5.mp4`
- SAM recording: `output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl`
- SAM labels: `output/external/sam-3d-body/jujae-regression-0-16_5/labels.json`
- SAM calibration profile:
  `output/external/sam-3d-body/jujae-regression-0-16_5/calibration-profile.json`
- tracker-vs-SAM report: `output/reports/tracker-vs-sam-jujae-v2.json`
- tracker-vs-SAM HTML: `output/reports/tracker-vs-sam-jujae-v2.html`

## Commands

Generate labels:

```sh
npm run sam:labels -- --input output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl --output output/external/sam-3d-body/jujae-regression-0-16_5/labels.json
```

Generate the conservative depth-calibration profile:

```sh
npm run sam:profile -- --input output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl --output output/external/sam-3d-body/jujae-regression-0-16_5/calibration-profile.json --ratio-scale 1.3
```

Regenerate the tracker-vs-SAM comparison:

```sh
npm run compare:recordings -- --live output/reports/jujae-regression-0-16_5-tracker-recording-p2.jsonl --offline output/external/sam-3d-body/jujae-regression-0-16_5/recording.jsonl --timestamp-source sourceMeta.videoTime --max-timestamp-delta-ms 25 --interpolate offline --offset-ms auto --labels output/external/sam-3d-body/jujae-regression-0-16_5/labels.json --output output/reports/tracker-vs-sam-jujae-v2.json --html output/reports/tracker-vs-sam-jujae-v2.html
```

Gate the report:

```sh
npm run sam:oracle -- --report output/reports/tracker-vs-sam-jujae-v2.json --output output/reports/tracker-vs-sam-jujae-v2-oracle.json
```

Measure the profile-assisted depth-calibration path:

```sh
node scripts/avatar-motion-agreement-check.mjs --video output/test-videos/jujae-regression-0-16_5.mp4 --only-models --model Xbot=assets/models/Xbot.glb --output output/reports/avatar-motion-jujae-regression-xbot-p4-profile-depth.json --smoothing retarget --pump rvfc --debug-overlay off --calibration-profile output/external/sam-3d-body/jujae-regression-0-16_5/calibration-profile.json --measurement-only
```

## Default Oracle Thresholds

`scripts/sam-regression-oracle.mjs` defaults to the current jujae baseline:

| Metric | Threshold |
|---|---:|
| pairedRatio | >= 0.95 |
| timestampDelta.p95 | <= 25ms |
| targetAngle.p95 | <= 50deg |
| targetAngle.weightedP95 | <= 50deg |
| targetAngle.max | <= 180deg |
| hingeFlex.p95 | <= 55deg |
| facingAgreement.agreementRatio | >= 0.95 |
| facingAgreement.backSideAgreementRatio | >= 0.90 |
| facingAgreement.yawError.p95 | <= 35deg |
| occlusionArmTargetAngle.p95 | <= 75deg |
| occlusionArmTargetAngle.max | <= 120deg |

These are regression thresholds, not claims that SAM is perfect ground truth.
Raise them only after a fresh browser recording, SAM comparison, and visual
review show a stable improvement.

## Known Limits

- The P3 occlusion target is a documented blocker rather than a solved quality
  gain for the jujae sample. SAM labels do not contain crossed-arm frames, and
  the behind-back arm rows with the largest deltas are high-confidence rows.
  Low-confidence hold/decay/reacquire is implemented, but high-confidence
  behind-torso heuristics worsened the report, so the retained oracle threshold
  prevents regressions without hiding that limitation.
- The profile-assisted depth path is intentionally opt-in. It can reduce the
  length clamp ratio under the observable-segment rule, but default no-profile
  behavior must keep passing the normal browser motion gate.
- The oracle cannot replace real visual review. It catches numeric regressions
  in paired tracker-vs-SAM reports and should be used with the generated HTML
  timeline plus focused playback of the worst rows.
