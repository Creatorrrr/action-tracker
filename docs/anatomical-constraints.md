# Anatomical Retarget Constraints

The runtime uses anatomical guardrails to prevent impossible avatar poses when landmark tracking is noisy. The limits are animation safety limits, not clinical diagnosis thresholds.

## Default Behavior

Anatomy constraints are enabled by default in both strict and legacy retarget paths. Use `?anatomy-constraints=off` only for A/B debugging against the raw solver target directions.

## Constraint Families

- Hinge constraints: elbows and knees clamp impossible flexion before body retargeting.
- Swing-cone constraints: shoulders and hips scale confidence when a target crosses conservative torso-local limits.
- Lower-body reliability: legs and feet neutral-hold when leg landmarks are missing, low-confidence, or left/right leg lengths are implausibly asymmetric.
- Wrist, thumb, and finger guardrails: strict-mode hand retargeting keeps bounded aim and twist limits instead of allowing unlimited finger rotations.
- Report diagnostics: browser reports include anatomy hard/soft violation counts, constrained target counts, and lower-body reliability fields.

## Key Runtime Fields

- `poseSolver.anatomy.hardViolations`
- `poseSolver.anatomy.softViolations`
- `poseSolver.anatomy.constrainedTargets`
- `poseSolver.anatomy.lowerBodyReliable`
- `poseSolver.anatomy.lowerBodyConfidence`
- `poseSolver.targets[].anatomy`

## Validation

Run the full static suite:

```bash
npm run check
git diff --check
```

Run a saved recording through the anatomy smoke report:

```bash
node scripts/anatomy-constraint-smoke.mjs output/reports/arms-crossed-recording-xbot-anatomy-diagnostics.jsonl
```

Run the browser measurement path on the crossed-arm sample:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/arms-crossed.mp4 \
  --only-models \
  --model "Xbot=assets/models/Xbot.glb" \
  --output output/reports/arms-crossed-motion-xbot-anatomy-diagnostics.json \
  --recording-output output/reports/arms-crossed-recording-xbot-anatomy-diagnostics.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

For VRM regression checks, use a local VRM file as a model argument but do not stage the VRM asset:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/arms-crossed.mp4 \
  --only-models \
  --model "local-vrm=assets/models/1406500396179985353.vrm" \
  --output output/reports/arms-crossed-motion-vrm-anatomy.json \
  --recording-output output/reports/arms-crossed-recording-vrm-anatomy.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

## References

- ISB lower body and spine JCS: https://www.sciencedirect.com/science/article/abs/pii/S0021929001002226
- ISB shoulder, elbow, wrist, and hand JCS: https://media.isbweb.org/images/documents/standards/Wu%20et%20al%20J%20Biomech%2038%20%282005%29%20981%E2%80%93992.pdf
- CDC normal joint ROM study: https://archive.cdc.gov/www_cdc_gov/ncbddd/jointrom/index.html
- VRM humanoid spec: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
