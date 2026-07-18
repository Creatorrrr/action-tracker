# SAM Goal Evaluation Contract v1

This contract prevents an accuracy improvement from being manufactured by
changing test roles, timestamps, validity exclusions, or metric denominators
after seeing live/student errors. It is the P0 rule contract. It is **not** the
real seven-clip manual label pack and it does **not** claim that the P1
teacher-valid mask exists yet.

The committed public surfaces are:

- `tests/fixtures/sam-goal-v2/evaluation-contract.json`: fixed roles, rules,
  numeric thresholds, metric denominators, and canonical contract hash.
- `tests/fixtures/sam-goal-v2/label-schema.json`: Draft 2020-12 shapes for each
  row/container in a label bundle.
- `scripts/sam-goal-label-audit.mjs`: deterministic, fail-closed bundle audit.
- `tests/sam-goal-label-audit-check.mjs`: a 7,007-row valid pack plus isolated
  semantic and hash failure injections.

## Frozen dataset roles

| Role | Clips | Permitted use |
|---|---|---|
| `hard_test` | `arms-crossed`, `csi-pose`, `jujae-regression-0-16_5` | Final held-out evaluation only |
| `validation` | `dance-16x9-padded` | Parameter selection, never training |
| `train_candidate` | the three `shorts-*` clips | Training candidates after session/person isolation |
| `unpaired_final` | full `jujae.mp4` | Runtime-only until a teacher exists; no training, tuning, or paired scoring |

The regression crop and full `jujae` share `sourceGroup: jujae-source`. That
protected alias is declared explicitly and cannot leak into train or validation.
The bundle audit also rejects a source asset hash, source group, session ID, or
person ID shared across different paired roles.

## Artifact separation

An audited label directory contains `bundle.json` plus four artifacts declared
by that bundle:

```text
bundle.json
├── decoder-manifest.jsonl       every decoded or decode-unavailable source PTS
├── manual-windows.json          required human-review windows
├── manual-labels.jsonl          manual facts only
└── teacher-valid-mask.jsonl     SAM/manual-derived validity only
```

This split is a security boundary, not just file organization.

- Decoder rows define the immutable coverage denominator.
- Manual rows cannot contain tracker, student, avatar, solver, latency, or
  quality-error fields.
- Teacher-mask rows cannot delete decoder rows or alter manual windows.
- Live/student reports are never audit inputs.
- P1 must replace the synthetic/pending mask with a real mask and freeze its
  canonical hash. `teacherValidity.actualMaskHash` deliberately remains `null`
  in P0.

Every artifact has a canonical SHA-256 in `bundle.json`; the bundle is bound to
the contract hash and has its own canonical hash. JSON object key order and the
nondeterministic keys `generatedAt`, `auditedAt`, and `elapsedMs` do not change a
hash. Array order remains semantic. A rule, split, threshold, window, label,
mask, or declared denominator mutation changes a hash.

## Exact time identity

Frames join only on all of:

```text
clipId + sourceFrameIndex + ptsTicks + timeBase(numerator/denominator) + loopEpoch
```

`ptsTicks` is a base-10 nonnegative integer string so 64-bit timestamps are not
rounded through JavaScript `Number`. FPS-derived timestamps and auto motion
offsets are forbidden. Windows and interval labels are start-inclusive and
end-exclusive. Duplicate or non-monotonic PTS, zero/reversed intervals,
fractional ticks, and rows outside the decoder manifest fail.

## Manual coverage and denominator

For each clip:

1. Form the union of required windows and de-duplicate overlaps.
2. Select every decoder row marked `decoded` in that union.
3. Exclude only `decodeStatus: unavailable` rows with a nonempty machine reason.
4. Require one unambiguous exact-frame label or interval label for every required
   dimension: scenarios, presence, occlusion, per-foot contact, per-hand
   observability, five endpoint observabilities, and person state.

The required completion coverage is:

```text
fully dimensioned decoded PTS / all decoded PTS in required-window union >= 0.95
```

Teacher-invalid, teacher-missing, absent, occluded, or unknown labels cannot
shrink the denominator. `unknown` is an explicit reviewed value and counts as
complete, but not as known; known coverage is reported per dimension. This
prevents silent missing rows while preserving legitimate out-of-frame/unknown
states. Each window and each bundle clip declares its denominator; recomputed
values must match exactly.

The 95% requirement applies to **manual decoder-PTS coverage**, not teacher
coverage. A uniform 95% teacher gate would be wrong: `arms-crossed` has 349
predictions for 386 processed rows, the `csi-pose` aggregate records predictions
and misses with nonexclusive semantics, and the all-person VC clip has 452
predictions for 451 frames. P1 therefore creates a reason-coded row-level mask
and reports actual teacher coverage without changing the manual denominator.

## Metric definitions

Contact:

- Labels are independently `planted | moving | unknown` for left and right.
- Each foot and each known class needs at least 100 teacher-valid,
  foot-observable exact PTS.
- Unknown and out-of-frame rows are excluded from F1 but their coverage remains
  visible.
- Final contact is planted/moving F1 per foot followed by a left/right macro
  average.

Presence and reacquisition:

- Compute present/absent F1 per clip, then clip macro-average.
- A clip without absent ground truth is excluded from that macro denominator and
  its label coverage must be reported.
- Reacquisition begins at the first teacher-valid present PTS after at least
  200ms absent/unreliable.
- It ends at the first of three consecutive processed frames with presence true
  and major-bone angular error no more than 30 degrees. The final gate is 150ms.

Endpoints and confidence:

- Left/right wrist, left/right ankle, and head are independent metrics.
- Each endpoint needs at least 90% teacher-observable exact-paired coverage; its
  final p95 limit is 4% of avatar height.
- Joint confidence is normalized to `[0,1]`; bone confidence is the minimum of
  its source joints.
- Low confidence means `<0.5`. A full-strength update means effective blend
  alpha `>=0.95`. Low-confidence full-strength updates must be zero.

## Teacher-valid rule thresholds

The rule consumes only decoder identity, SAM-native data/provenance, source
summary, manual presence/occlusion/subject selection, and prior teacher rows in
causal order. The first group below comes directly from existing SAM/manual
domain code and extractor configuration:

| Rule | Frozen value | Basis |
|---|---:|---|
| detector confidence / IoU | `0.25 / 0.7` | all seven SAM summaries |
| landmark visibility and presence | `>=0.35` | current observability contract |
| torso-facing joint confidence | `>=0.35` | current facing estimator contract |
| low-confidence challenge fraction | `>=0.25` | challenge tag only; never an exclusion by itself |
| calibration endpoint visibility | `>=0.50` | current calibration contract |
| calibration body scale | `>0.0001` | degenerate-scale guard |
| torso basis norm | `>0.000001` | degenerate-basis guard |
| full-body shoulder+elbow / hip / knee+ankle counts | `3/4`, `2/2`, `3/4` | current full-body observability scope |
| selected subjects | `<=1` | single target identity requirement |

The following wide anomaly guards are manual-domain safety bounds, not values
chosen from live/student error. They are frozen before P1 mask generation:

| Guard | Frozen value |
|---|---:|
| bone-length relative deviation from teacher temporal median | `<=0.35` |
| adjacent-frame body-scale ratio | `[0.75, 1.333333...]` |
| root speed | `<=4 body-heights/s` |
| joint speed | `<=12 body-heights/s` |
| temporal gap | `<=1.5 nominal frame intervals` |

Missing confidence is never silently promoted to 1.0. It is recorded as
`confidenceAvailable: false` and invalidates confidence-dependent scopes.
Low-confidence challenge tagging remains reportable even when a scope stays
valid.

Forbidden teacher/manual dependency keys include live/student predictions or
confidence, tracker/avatar/retarget/solver output, residuals and MPJPE variants,
angle/quaternion/endpoint agreement errors, latency/FPS/drop/queue telemetry,
live report paths, and student model hashes. Unknown fields fail in addition to
the explicit forbidden-field error.

## Audit command and failure semantics

```sh
node scripts/sam-goal-label-audit.mjs \
  --contract tests/fixtures/sam-goal-v2/evaluation-contract.json \
  --label-dir /path/to/frozen-label-bundle \
  --output /path/to/audit-report.json
```

Canonical hash utility:

```sh
node scripts/sam-goal-label-audit.mjs \
  --hash-json tests/fixtures/sam-goal-v2/evaluation-contract.json
```

The audit returns nonzero and stable machine-readable errors for, among others:

- `E_SPLIT_LEAKAGE`, `E_SPLIT_ROLE`
- `E_REQUIRED_DIMENSION_MISSING`, `E_MANUAL_COVERAGE_BELOW_095`
- `E_CONTACT_CLASS_BELOW_100`, `E_DENOMINATOR_SHRINK`
- `E_PTS_DUPLICATE`, `E_PTS_NON_MONOTONIC`, `E_PTS_MALFORMED`,
  `E_PTS_OUT_OF_RANGE`, `E_PTS_INTERVAL`
- `E_FORBIDDEN_FIELD`, `E_UNKNOWN_FIELD`
- `E_CONTRACT_HASH_MISMATCH`, `E_LABEL_HASH_MISMATCH`,
  `E_TEACHER_RULE_HASH_MISMATCH`
- missing or unexplained teacher-mask/decode rows

Verification:

```sh
node --check scripts/sam-goal-label-audit.mjs
node tests/sam-goal-label-audit-check.mjs
npm run check
git diff --check
```

The focused test audits 7,007 decoder rows, including reason-coded unavailable
rows, then creates isolated copies with split leakage, a missing dimension,
coverage below 95%, insufficient contact support, denominator shrinkage,
fractional PTS, forbidden live error, stale hashes, and a mutated teacher
threshold. Key-order permutations must retain the same canonical hash.
