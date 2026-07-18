# SAM goal evaluation-v3 teacher contract

## Status and boundary

Evaluation-v3 is the first contract that freezes the raw SAM teacher inputs, deterministic teacher derivation, mask semantics, and external P0/P1 anchors before any live tracker or avatar tuning. Evaluation-v2 and `sam-goal-manual-pack-v2.mjs` remain byte-identical historical inputs; they are intentionally pin-incompatible with v3.

This unit does **not** create a real review, adjudication, label pack, P0 anchor, Dataset v2, P1 pack, or P1 anchor. Real P0 work is blocked until `manual-pack-compiler@r3` publishes an evaluation-v3 authoring schema and compiler and is independently accepted.

Canonical identities:

- evaluation contract: `5307a5d4e2c56e652b7a417713e1b0ebff5dabf712e591eefa94737e7318b1bd`
- label schema: `afe645d7c062e3644db96cea20b2f6724892077f1993de829a28deeb38d138f8`
- teacher-input inventory: `50756ed7c4d461632cea1c96a12fc53910b1112ebc15b92e2f514733e4830f04`
- teacher policy: `d38b9583cd5b9d9cd57d947866c1f5140e880f93095024b54c613fc3d8c804d7`
- teacher schema: `167e92cc6a499cf57a6d10d5d0b3df4d22c8a76fae662927a46b0ade61208035`
- P0 external-anchor schema: `827ef909587e99b0ed991638f36a2abd5c3941aec807a671e8030ba6a961ff84`
- P1 external-anchor schema: `c709738e7214824b29985501ab7291be0919345aae69eb46d9e1ade9d316045c`

Every JSON self-hash excludes exactly the root `expectedCanonicalHash`. Arrays are order-sensitive and object keys are recursively sorted by UTF-8 byte order for canonical hashing. No wall-clock field participates. The historical evaluation-v2 P0-anchor schema remains byte-pinned at `5fb22bf90e604acff911799344b7993239a463b6a4af278404aae766f3e49d85` and is not modified or treated as v3-compatible.

## One-way hash DAG

```text
source contract/schema/inventory/decoder ─┐
raw teacher inventory ────────────────────┼─> evaluation-v3 contract
teacher policy/schema/anchor schemas ─────┘             │
                                                        v
reviews A/B + adjudication + compiler r3 ─────> P0 candidate pack
                                                        │
                                                        v
                                             external P0 anchor
                                                        │
raw teacher bytes -> Dataset/refined/mask/summary ──────┼─> P1 candidate pack
                                                        │
                                                        v
                                              candidate P1 lock
                                                        │
                                                        v
                                             external P1 anchor
```

An earlier node never contains a later hash. P1's parent is the canonical hash of the external P0 anchor, never the candidate `evaluation-pack.json` hash. `evaluation-pack-p1.json` deliberately excludes `evaluation-lock-p1.json` and the external P1 anchor to avoid a cycle.

## Frozen teacher input

`teacher-input-inventory.json` binds exactly seven accepted clips and, for each clip:

- accepted source-video path, bytes, SHA-256, width, and height;
- `skeletons_mhr70.jsonl` bytes, byte SHA-256, row count, UTF-8, CRLF (`0d0a`) terminators, and terminal CRLF;
- `metadata_mhr70.json` bytes plus byte and canonical SHA-256;
- `summary.json` bytes plus byte and canonical SHA-256.

The seven raw files use CRLF on every physical row. Dataset `rawLineBase64` and `rawLineByteSha256` cover only the JSON bytes, excluding the entire `0d0a` terminator. Audit reconstruction appends exactly one CRLF to every decoded line and must reproduce each P0-inventoried raw file byte-for-byte. Lone LF, lone CR, mixed endings, missing terminal CRLF, or a replaced terminator fails. Derived Dataset/refined/mask JSONL and source-manifest/summary JSON remain LF-only, forbid CR, and require compact recursively key-sorted serialization.

The raw line schema is closed. It preserves all people and every `person_id`, both bbox fields, detector score, focal length, camera translation, global rotation, MHR70 2D/3D, and MHR127 3D. Only the two bbox fields may be absent or carry any JSON value, because their usability belongs to the frozen selection policy. All other missing, extra, wrong-shape, or nonfinite fields fail before masking.

Exact reconciliation is:

| clip | hit | carry-forward fallback | miss | provenance unavailable |
|---|---:|---:|---:|---:|
| arms-crossed | 349 | 0 | 37 | 0 |
| csi-pose | 2,686 | 163 | 0 | 0 |
| dance-16x9-padded | 359 | 0 | 0 | 0 |
| jujae-regression-0-16_5 | 990 | 0 | 0 | 0 |
| shorts-keGbIts0CA0-16x9-padded | 1,237 | 0 | 0 | 0 |
| shorts-new-dance-E9_h_ZW5z0U-16x9-padded | 439 | 0 | 0 | 0 |
| shorts-vc0GDveRIp0-16x9-padded | 451 | 0 | 0 | 0 |

`summary.detection_misses` equals every non-hit provenance state, not only zero-person rows. A positive-person row with an unusable native detector bbox is `provenance_unavailable`. Otherwise an exact ordered repeat of every person's detector score and detector bbox from the previous positive-person row is `carry_forward_fallback`; the remaining rows are hits. No score threshold is used.

Original extractor code, checkpoint, MHR asset, and detector weight bytes are absent. Their provenance remains `unavailable`, SHA is null, and current upstream downloads cannot substitute for those original bytes. Raw result files are independently `verified_result_bytes`; that does not upgrade model or code provenance.

## Manual-first candidate selection

Only manual state `selected` attempts a teacher candidate. `selectedTrackId` is the persistent `manualTargetId`; raw `person_id` and zero-based raw array index remain separate.

| raw persons | manual anchor | result |
|---:|---|---|
| 0 | any | `teacher_record_missing` |
| 1 | null | select without inspecting or deriving a bbox |
| 1 | present | require one usable effective bbox and inclusive anchor containment |
| >1 | null | `teacher_candidate_ambiguous` before any bbox inspection |
| >1 | present | every candidate needs a usable bbox; then exactly one must contain the anchor |

A bbox is usable only as four finite `[xMin,yMin,xMax,yMax]` values with positive width and height. Native detector bbox has priority. Fallback bbox is allowed only when the native bbox is unusable and records `detector_bbox_invalid_fallback` after successful bbox-based selection. Padding is 0.10 of each bbox extent without clamping. Normalized anchors convert continuously by `x*width,y*height`; expanded edges are inclusive. A usable native bbox that misses the anchor never falls back.

## Numeric policy

| predicate | frozen value |
|---|---:|
| MHR shapes | 70 and 127 exact joints |
| bbox padding | 0.10 extent |
| reprojection error | <= 0.01 px |
| major segment | [0.02, 1.0] m |
| normalization norm | >= 0.000001 |
| normalized torso cross | >= 0.25881904510252074 |
| camera depth | (0.1, 100] m |
| focal length | (0, 100000] px |
| in-frame tolerance | 1 px |
| clip-median scale deviation | <= 0.20 |
| adjacent scale jump | <= 0.10 |
| selected gap | <= 100 ms |
| camera-root speed | <= 12 m/s |
| root-relative joint speed | <= 20 m/s |
| stable plant confirmation | >= 100 ms exact rational PTS |
| refinement coefficients | `[-3,12,17,12,-3]/35` |
| refinement joint/camera/projection caps | 0.05 m / 0.10 m / 2 px |

MHR70/MHR127 3D remains root-relative meters. `pred_cam_t` remains camera translation, and MHR70 2D remains source pixels. Official projection is recomputed as `u=(x+tx)*f/(z+tz)+width/2`, `v=(y+ty)*f/(z+tz)+height/2` for each scope's own joint union.

The torso basis uses shoulders 5/6 and hips 9/10 exactly as specified in `teacher-policy.json`. Diagnostic computability and validity are separate: `torsoCross` remains a finite diagnostic when all normalization operands are finite and mathematically nonzero, even if a precursor is below the 0.02 m or 0.000001 validity floor; the scope still receives `invalid_torso_basis`. Exact zero or nonfinite normalization makes the diagnostic null. Frame scale is the deterministic median of the first eight major segments whenever those eight are finite, regardless of the bounds or validity of the last two torso segments. Clip-scale eligibility separately requires those first eight values in `[0.02,1.0]`.

Temporal predecessor means the most recent earlier detector hit successfully selected to the same manual target. A miss, fallback, unavailable provenance, or failed selection creates a nonconsecutive predecessor and therefore a gap. No predecessor is not itself an exclusion. Rational time comparisons use BigInt cross multiplication. Camera-root speed depends only on the two camera translations; scale jump depends only on the two first-eight frame scales; each joint-speed diagnostic reads only that scope's joint union. Therefore a nonfinite head, palm, or leg operand cannot contaminate an unrelated arm/head/leg scope.

For contact, planted begins retroactively at the first settled sample only after the first-to-last inclusive sample span reaches 100 ms. At 30 fps this normally needs four sampled rows; at 60000/1001 it needs seven. Crop, occlusion, or unknown evidence ends inheritance, and post-gap planted requires a fresh confirmation.

## Independent scopes and reasons

The auditor recomputes, and never trusts, producer geometry booleans for:

- torsoFacing, fullBody, head;
- left/right arm, hand, and leg;
- calibration;
- left/right contact.

Head, each arm, each hand, and each leg use their own required joint union and matching manual endpoint. A bad head, opposite limb, hand palm, or leg cannot disable an observable unrelated endpoint. Hand inherits its same-side arm. Full body does not inherit auxiliary endpoint observability. Contact retains the stronger accepted invariant of inheriting full body. Calibration inherits full body and always fails today with `native_joint_confidence_unavailable`.

Each disabled scope carries its ordered, unique reasons according to the policy precedence. A globally valid partial row has no global exclusions but retains reasons on disabled scopes. A globally invalid row has the ordered union of scored-scope reasons, excluding calibration-only unavailable confidence. Every current row warns that joint confidence is unavailable and detector event provenance is derived; neither warning satisfies a scope.

Manual review and adjudication rows carry canonical sorted scenario arrays. A scenario-only disagreement therefore requires a durable adjudication row. Manual absence also requires absent person/subject states, unknown contacts, non-observable hands/endpoints, and no target pixels marked observable, partial, or occluded.

## Deterministic refinement

Dataset is the raw hard target. `teacher-refined.jsonl` is watch-only. A five-row window is smoothable only when all rows are hits, select the same manual target, have consecutive source indices, identical positive rational cadence, no gap, and finite required arrays. Binary64 accumulation is strictly left-to-right and divides once by 35.

Status precedence is:

1. `unavailable`
2. `identity_boundary`
3. `identity_selection_gap`
4. `identity_input_invalid`
5. `identity_nonuniform_pts`
6. `identity_safety_fallback`
7. `smoothed`

Safety is atomic for the entire frame. Any displacement, camera, structure, or projection failure returns the exact raw pose. Live/student/avatar data cannot choose a window, status, threshold, fallback, or target role.

The closed Draft 2020-12 status matrix couples selection, window, pose, and hashes. A successfully selected non-hit row remains `unavailable` with null pose/window but retains `rawCenterCanonicalSha256`; an unselected row has no raw-center hash. Boundary identity has a raw-equal pose and no window. Every other identity/smoothed status has exactly five source identities and both pose hashes. The raw and refined pose preimage is the terminator-free compact recursively UTF-8-bytewise-key-sorted serialization of exactly `{predCamT,keypointsMhr70RootRelativeM,mhrJointCoords127RootRelativeM}`. Selected center nonfinite data is rejected before refinement, while `identity_input_invalid` is only a defensive direct-derivation result for a nonfinite neighbor.

## Phase commands

Candidate-only audit rejects every anchor argument and can never report frozen or verified:

```sh
node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p0-candidate
```

Verified P0 requires the concrete external anchor, an independently supplied expected canonical hash, and the three role-bound raw sealed inputs:

```sh
node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p0 \
  --p0-anchor <path> --expected-p0-anchor-sha256 <sha256> \
  --review-a <path> --review-b <path> --adjudication <path>
```

Verified P1 requires both complete external-anchor pairs:

```sh
node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p1 \
  --p0-anchor <path> --expected-p0-anchor-sha256 <sha256> \
  --p1-anchor <path> --expected-p1-anchor-sha256 <sha256>
```

Unknown, duplicate, legacy `--expected-p0-lock-sha256`, missing, or phase-inapplicable flags fail before audit status.

P0 durable sealed descriptors are exactly `reviewA{role=first,logicalPath=sealed/review-a.json}`, `reviewB{role=second,logicalPath=sealed/review-b.json}`, and `adjudication{role=adjudication,logicalPath=sealed/adjudication.json}`, each with its actor pseudonym and byte hash. These logical paths are identity constants and are never passed to a filesystem resolver. Actual CLI paths may be absolute or relative to the invocation `process.cwd()`, may live anywhere outside the pack, and are never persisted. Draft shape, internal role, actor pseudonym, self-hash, and byte hash are all checked from the same single Buffer snapshot. The three inputs must have distinct realpaths, device/inode pairs, byte hashes, and actors.

The P0-bound compiler-r3 authoring schema must expose `$defs.review` with `artifactType=\"sam-goal-manual-review-v3\"`, `schemaVersion=3`, and role `first` or `second`, plus `$defs.adjudication` with `artifactType=\"sam-goal-manual-adjudication-v3\"`, `schemaVersion=3`, and role `adjudication`. The auditor first proves those constants are present in the actually bound schema, then validates each same-buffer value against the matching definition. Compiler-r2/v2-shaped review or adjudication objects are rejected even when their self-hash, P0 sealed-input byte hash, and external P0 anchor are consistently regenerated.

P1 rejects all sealed-input flags before filesystem access and never requires or reopens the raw review/adjudication files. Its independently expected P0 anchor is authority, so P1 remains auditable after those raw files are moved or deleted. Every inherited P1 descriptor is deep-equal to its P0 descriptor, including canonical and byte hashes, and reuses the already verified P0 Buffer snapshot. `externalP0Anchor` uses fixed `logicalPath=anchors/p0.json`; only source manifest, Dataset, refined, mask, summary, and materializer are new teacher snapshots.

External anchors and sealed inputs must be write-once regular files with link count one, no symlink in the path, realpath outside the pack, and distinct device/inode identities. Verification captures every ancestor and final-component lstat identity, performs exactly one no-follow open/read, proves pre-lstat/fd/post-lstat/realpath identity agreement plus unchanged fd size/device/inode/mtime, and revalidates ancestors after every boundary. Deterministic final-component and ancestor replacement hooks must fail. Ordinary descriptors remain unique normalized repository- or pack-relative POSIX paths without absolute, backslash, empty, dot, dotdot, or traversal segments.

## Verification

Run the focused contract suite:

```sh
node tests/sam-goal-label-audit-v3-check.mjs
```

It performs the complete 6,711-row/6,675-person raw reconciliation and CRLF round-trip, then builds and successfully audits a scenario-bearing synthetic P0 candidate, external P0 anchor, 6,711-row Dataset/refined/mask set, P1 pack/lock, and external P1 anchor. All 96 machine-readable cases declare a closed classification, required execution path, and either `expectedOutcome=pass` or `expectedOutcome=error` plus one exact `errorCode`; every independent mutation is compared to the actual first result code. Actual wrapper instrumentation, not catalog metadata aggregation, must report exactly 86 `runAudit`, five CLI, and five explicitly non-rehash selection-math helper paths. All 84 semantic rehash, public-input, and public-authority cases traverse `runAudit`. Each attacked Dataset/refined/mask/source/summary/manual/descriptor/anchor chain recomputes every attacker-controlled self-hash, descriptor, P0/P1 pack, lock, compiled-set, external anchor, and caller-supplied expected hash before audit. Separate phase-boundary attacks swap the auditor fixture and a canonical-same/byte-different inherited evaluation-contract fixture only after P0 verification; both require P1 to pass from the already verified Buffers without reopening changed paths.

The complete 58-instance matrix covers Dataset, refined, mask, source manifest, P0 pack/anchor, P1 pack/anchor, authoring review, and authoring adjudication, with 20 valid and 38 invalid instances. Every case must produce identical validity under the repository validator and an independent Python `Draft202012Validator`. Scope/support/count reconciliation, rational equality boundaries, selected non-hit hashes, status-matrix violations, scope-local nonfinite inputs, descriptor traversal, inside/symlink/hardlink anchors, final/ancestor TOCTOU, historical v2 byte pins, sealed-input deletion before P1, argument rejection before filesystem access, signal cleanup, and zero temporary residue are mandatory. Guarded fixture execution requires `NODE_ENV=test`, accepts only `audit-fixtures/runtime-test-*/pack`, discloses `syntheticOnly=true` and `testFixtureMode=evaluation-v3-runtime-test`, and verifies every override is a plain one-link file below that runtime root whose corresponding workspace source still has the declared baseline byte hash. An override changes only the snapshotted location; immutable descriptor and semantic checks remain active. The CLI additionally requires `SAM_GOAL_V3_SYNTHETIC_AUDIT=1` and cannot bind an arbitrary policy. Report wall time and RSS separately when profiling the suite. The catalog is under `tests/fixtures/sam-goal-v2/evaluation-v3/audit-fixtures/attack-cases.json`.
