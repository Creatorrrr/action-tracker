# SAM Goal evaluation contract v2

## Why v2 is separate

Evaluation v2 is a new, source-bound contract. It does not overwrite the historical v1 contract, schema, auditor, or documentation. It consumes the source-PTS interface one-way and fixes the complete manual denominator before any teacher masking or realtime-system tuning.

Accepted identities:

- v2 contract: `7a7f26a4734d0c971ecc2bef542dd05da11d67134478a2db286e1cd242bb5897`;
- v2 Draft 2020-12 schema: `38759400e1e5aacb1b06bf3b052a5af8f693366dfa93653d0520280723c8e146`;
- source contract: `39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873`;
- source schema: `ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244`;
- source inventory: `64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d`;
- decoder bytes: `d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79`;
- ordered decoder rows: `dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d`.

Only root `expectedCanonicalHash` is excluded from a durable JSON artifact's self-hash. Nested hashes and ordered arrays remain semantic. Wall-clock fields are forbidden in locked artifacts.

## Exact 6,711-row denominator

Every paired source has exactly one base window tagged only `full_clip_denominator`:

| clip | start PTS | exclusive end PTS | rows |
| --- | ---: | ---: | ---: |
| `arms-crossed` | 512 | 197633 | 386 |
| `csi-pose` | 0 | 1458177 | 2,849 |
| `dance-16x9-padded` | 0 | 644759 | 359 |
| `jujae-regression-0-16_5` | 0 | 989990 | 990 |
| `shorts-keGbIts0CA0-16x9-padded` | 0 | 316417 | 1,237 |
| `shorts-new-dance-E9_h_ZW5z0U-16x9-padded` | 0 | 224257 | 439 |
| `shorts-vc0GDveRIp0-16x9-padded` | 0 | 230401 | 451 |

The union is exactly 6,711 decoder identities. Full `jujae` remains unpaired and contributes zero rows. Optional challenge overlays add scenario membership only; they cannot shrink, expand, or duplicate the denominator. Every boundary must be an exact decoder PTS, except the terminal exclusive boundary, which is the last tick plus one.

Manual labels and subject selections may use a single exact frame or a start-inclusive/end-exclusive interval. The auditor materializes intervals only onto decoder PTS. It rejects overlap, holes, FPS-like boundaries, terminal omission, and any interval that crosses a base/overlay membership boundary without being split.

## Manual labels and subject truth

`manual-labels.jsonl` and `manual-subject-selection.jsonl` are separate. Subject states are `selected`, `absent`, `ambiguous`, and `unknown`. A selected row requires a stable per-clip manual target ID. Selecting one person while multiple physical people are visible also requires a normalized manual-video anchor.

`personState` describes physical people in the video. It must not be changed because a detector emits duplicate candidates. SAM boxes or candidate counts cannot set the manual anchor or person state.

The auditor enforces the closed scenario taxonomy and these cross-field rules on every materialized identity:

- absent presence requires absent person and subject states, unknown contacts, hidden hands, and hidden endpoints;
- planted or moving contact requires present presence and an observable corresponding foot;
- an observable hand requires an observable or partial hand plus an observable wrist;
- an endpoint cannot be observable when its body part is occluded, out of frame, or unknown;
- multiple people require an anchored selected target or an ambiguous subject;
- a single target requires a selected subject.

## Independent review and deterministic agreement

Two distinct reviewers independently cover all 6,711 decoder identities. Each raw pass includes label state plus subject-selection state, stable manual target ID, and normalized anchor. Their pre-adjudication states are schema- and cross-field-truth validated before agreement. Automated proposals cannot claim label or subject review/adjudication. Every label or subject disagreement requires exactly one manual adjudication row, and the agreed/adjudicated subject result must equal `manual-subject-selection.jsonl`. A genuine zero-disagreement pack remains valid with a separately designated adjudicator.

Agreement is unweighted Cohen kappa with `unknown` retained as a category:

- presence and person state use their joint tuple per clip, then macro-average seven clip kappas;
- contact is computed per clip and foot, then macro-average fourteen kappas;
- each occlusion, hand-observability, and endpoint-observability field is computed per clip and macro-averaged;
- zero-variance inputs score 1 only when both passes are identical constants, otherwise 0.

Subject state, target ID, and anchor remain mandatory double-review/watch fields but are deliberately not added to these fixed kappa formulas. They are never dropped: exact disagreement fields, adjudication, stable per-pass IDs, cross-field truth, and final-artifact binding are hard gates.

Floors are 0.99 for presence/person, 0.90 for contact, and 0.95 for observability. Adjudicated rows can never replace either agreement input.

Before teacher masking, each foot and each known contact class needs at least 300 observable frames spanning at least two clips. Unknown and out-of-frame rows are excluded from known support but reported.

## Reacquire candidates

The exact predicates are part of the contract:

- absent: manual presence is absent and subject selection is absent;
- unreliable: manual presence is unknown, subject selection is ambiguous/unknown, or body occlusion is occluded/out-of-frame/unknown;
- reliable: manual presence is present, subject selection is selected, and body occlusion is observable/partial.

A P0 candidate is a maximal exact-PTS interval containing only absent or unreliable identities, lasting at least 200 ms, followed by the first reliable identity at or after its exclusive end. Duplicate reliable starts are deterministically deduplicated to the closest maximal interval; intervals separated by no present identity merge. P0 requires at least three candidates across at least two hard-test clips.

P1 materializes the first teacher-valid present identity at or after every candidate end. At least three starts across two hard-test clips remain mandatory; teacher masking cannot silently erase the reacquire denominator.

## Current-teacher confidence truth table

Current SAM MHR70 files do not expose native per-joint confidence. Every v2 teacher row therefore preserves:

- `confidenceAvailable=false`;
- `jointConfidenceSource=unavailable`;
- warning `native_joint_confidence_unavailable`;
- `calibration=false`;
- no `confidence_unavailable` exclusion reason.

Detector score provenance remains detector-only and cannot become joint confidence. Confidence unavailability is a warning, not an exclusion by itself. Geometry plus manual observability may still make torso-facing, full-body, and per-foot contact scopes valid.

The closed implications are fail-closed: invalid rows have every scope false and at least one exclusion; valid rows have a present teacher record, a selected subject, at least one scope, and no exclusions. Torso/full-body/calibration/contact scope implies valid. Per-foot contact eligibility implies full-body, present manual truth, an observable known foot/contact, a finite hip-knee-ankle-foot chain, and temporal guards. Calibration implies full-body but remains false without native confidence. Post-mask support requires 100 valid rows for every foot and known contact class.

## P0 and P1 commands

Create and audit a P0 candidate:

```sh
node scripts/sam-goal-label-audit-v2.mjs --label-dir /path/to/pack --phase p0
```

This returns `status=candidate`, `frozen=false`, and a candidate P0 manifest hash. It never claims verification merely because the in-pack manifest self-hashes.

Verify in a separate invocation using an anchor stored outside the pack:

```sh
node scripts/sam-goal-label-audit-v2.mjs \
  --label-dir /path/to/pack \
  --phase p0 \
  --expected-p0-lock-sha256 <externally-recorded-sha256>
```

Only this exact match returns `status=passed`, `externallyVerified=true`, and `frozen=true`.

P1 requires the same external P0 anchor:

```sh
node scripts/sam-goal-label-audit-v2.mjs \
  --label-dir /path/to/pack \
  --phase p1 \
  --expected-p0-lock-sha256 <same-p0-sha256>
```

The P0 manifest has a closed descriptor map. JSON descriptors bind root-only canonical hashes; JSONL and the decoder manifest bind physical byte hashes. P1 adds the teacher-mask byte hash and records the exact parent P0 hash in both its manifest and lock. Missing descriptors, path-only descriptors, wrong parents, semantic edits with recomputed self-hashes, or a rebuilt child chain still fail against the unchanged external P0 anchor.

## Durable files

P0 requires:

- `evaluation-pack.json`;
- `manual-windows.json`;
- `manual-labels.jsonl`;
- `manual-subject-selection.jsonl`;
- `manual-review-pass1.jsonl`;
- `manual-review-pass2.jsonl`;
- `manual-adjudication.jsonl`;
- `manual-policy.json`;
- `manual-summary.json`.

P1 additionally requires `teacher-valid-mask.jsonl`, `evaluation-pack-p1.json`, and `evaluation-lock-p1.json`.

The auditor recursively rejects durable key or value families tied to live/student/avatar outputs, errors, reports, model hashes, latency, rendering, drops, queues, or other student-dependent signals before using an artifact.

## Verification

```sh
node tests/sam-goal-label-audit-v2-check.mjs
npm run check
git diff --check
```

The focused suite materializes all 6,711 decoder identities, more than 40,000 pack rows, and validates exactly 7,000 representative artifact rows with an independent Draft 2020-12 validator. It includes valid P0/P1, zero-disagreement, independent subject state/target/anchor review attacks, exact subject adjudication/final binding, exact interval, confidence-unavailable, support, reacquire/dedup, external-anchor, forbidden-field, descriptor, and fully rehashed tamper cases. Temporary `sam-eval-v2-*` packs are synchronously removed on success, assertion failure, SIGINT, and SIGTERM; the suite runs a failing child probe and asserts that no new matching residue remains. No actual labels or locks are created in the repository.
