# SAM Goal manual pack compiler v2

## Scope

`sam-goal-manual-pack-v2.mjs` transforms two sealed, independently authored manual reviews plus explicit adjudication into the nine-file evaluation-v2 P0 candidate. It maps decisions to the accepted decoder manifest; it never inspects video pixels, SAM output, realtime/student/avatar output, or decides a label.

The implementation currently consumes evaluation-contract r1 through two replaceable pins. A later evaluation-contract revision must add the missing numeric teacher-guard algorithms and manual-anchor-to-teacher selection rules before any real P0 pack is produced. This compiler unit therefore proves the synthetic authoring/compilation/locking mechanism only.

Compiler-owned schema identities:

- authoring schema: `a04ce78643a98be6e550b15654317c9ec8f1678c8afa3f332e11cdf2014f69ef`;
- external anchor schema: `5b74dfb7fcef0c5ba4f3b550181dde59d69b2a22765c1abb76f27838109b7c5a`.

## Sealed authoring inputs

A review is one closed JSON artifact with:

- role `first` or `second`;
- a concrete `reviewerPseudonymSha256`, distinct from the artifact's root `expectedCanonicalHash`;
- pinned evaluation/source/decoder hashes;
- all seven source video identities copied exactly from source inventory (`clipId`, path, bytes, SHA-256);
- base windows and optional manual overlay proposals in exact frame-index coordinates;
- complete, nonoverlapping intervals covering source frame indices `[0, rowCount)` for each clip;
- scenarios, presence, physical person state, occlusion, contact, hand/endpoint observability, and subject state/target/anchor.

Intervals are start-inclusive/end-exclusive. Each boundary is a decoder `sourceFrameIndex` with loop epoch zero. A review interval must split where its own window membership changes. The compiler materializes each pass independently and requires exactly 6,711 identities from each.

Adjudication is a third closed, self-hashed JSON artifact with a distinct adjudicator pseudonym, hashes of both sealed reviews, explicit final windows, and interval decisions. Every raw difference—including scenario arrays and subject state, manual target ID, or anchor coordinates—requires exact `disagreementFields` and a full manual decision. Agreed values or explicit decisions are the only final source; there is no final-label authoring input.

The currently pinned compiled review/adjudication row schema has no scenario field. Until the evaluation contract and label schema are revised, any review scenario disagreement therefore fails closed with `compiled_scenario_disagreement_unsupported`; the compiler never silently drops it from `manual-adjudication.jsonl`. Real-pack compilation remains blocked on that upstream revision.

Unknown keys, wall-clock fields, automated claims, and SAM/detector/live/student/avatar/solver/retarget/error/report families fail before materialization.

Each sealed authoring JSON is parsed, canonically hashed, byte-hashed, and schema-checked from one immutable in-process `Buffer` snapshot. The decoder JSONL byte hash and canonical rows likewise come from one snapshot, and anchor parsing shares its initial immutability snapshot. Review identity peeks and parse/hash rereads are not used.

## Commands

Validate exactly one pass without opening its counterpart or a final pack:

```sh
node scripts/sam-goal-manual-pack-v2.mjs validate-review \
  --review /sealed/review-a.json \
  --expected-role first \
  --expected-reviewer-pseudonym-sha256 <reviewer-pseudonym-sha256>
```

Compile to a path that does not exist:

```sh
node scripts/sam-goal-manual-pack-v2.mjs compile \
  --review-a /sealed/review-a.json \
  --review-b /sealed/review-b.json \
  --adjudication /sealed/adjudication.json \
  --output-dir /new/p0-candidate
```

The compiler builds a sibling temporary directory, registers it for process-level cleanup, writes and fsyncs deterministic files, invokes the accepted P0 auditor asynchronously, and fsyncs the directory. On the target macOS profile it then calls `renameatx_np(..., RENAME_EXCL)` through the absolute `/usr/bin/python3` system runtime. That OS-level operation is one atomic no-replace commit: a destination created after the initial check is preserved and compilation fails. There is no ordinary-rename fallback; unsupported platforms or unavailable/invalid helpers fail explicitly. The source stage must disappear and the destination must be a directory before the commit is reported successful.

`SIGINT` and `SIGTERM` handlers synchronously remove every registered stage and terminate any active auditor or rename helper. Consequently, signals received while an asynchronous child or controlled commit boundary is active leave the destination absent and no sibling stage behind. Existing destinations are never merged or replaced.

## Deterministic output

The output contains exactly:

- `evaluation-pack.json`;
- `manual-windows.json`;
- `manual-labels.jsonl`;
- `manual-subject-selection.jsonl`;
- `manual-review-pass1.jsonl`;
- `manual-review-pass2.jsonl`;
- `manual-adjudication.jsonl`;
- `manual-policy.json`;
- `manual-summary.json`.

Object keys sort recursively, decoder order is stable, JSONL uses one LF-terminated compact row, and durable artifacts contain no random or wall-clock value. Final label and subject intervals merge only while their values and final adjudicated-window membership remain equal.

## External write-once anchor

Create an anchor at an absent path outside the label directory:

```sh
node scripts/sam-goal-manual-pack-v2.mjs create-anchor \
  --anchor /external/p0-anchor.json \
  --label-dir /new/p0-candidate \
  --review-a /sealed/review-a.json \
  --review-b /sealed/review-b.json \
  --adjudication /sealed/adjudication.json
```

Creation deterministically recompiles and byte-compares the candidate, runs candidate audit, registers and fsyncs its temporary file, and atomically hard-links it to the absent destination. `SIGINT` or `SIGTERM` removes the registered temporary file before exit. Existing or in-pack anchors fail without writes.

The closed anchor binds:

- `candidateP0LockSha256`;
- `evaluationPack` normalized path, canonical SHA-256, and byte SHA-256;
- nine sorted compiled artifact byte descriptors and their canonical set hash;
- all dependency hashes;
- both review roles, reviewer pseudonyms, canonical/byte hashes, and adjudication identity/hashes.

Verify in a separate read-only process:

```sh
node scripts/sam-goal-manual-pack-v2.mjs verify-anchor \
  --anchor /external/p0-anchor.json \
  --label-dir /new/p0-candidate \
  --review-a /sealed/review-a.json \
  --review-b /sealed/review-b.json \
  --adjudication /sealed/adjudication.json
```

Verification recomputes all sealed inputs and all nine output bytes, validates the anchor self-hash, and invokes P0 audit using the anchor's candidate hash. It never writes the anchor or label directory.

## Verification

```sh
node tests/sam-goal-manual-pack-v2-check.mjs
npm run check
git diff --check
```

The focused suite uses only synthetic authoring decisions. It covers exact 6,711-row independent materialization, nonzero initial PTS, final-window adjudication, subject state/target/anchor disagreements, scenario-only fail-closed behavior, zero disagreement, single-snapshot read instrumentation, support/reacquire gates, order/hash drift, forbidden leakage, deterministic repeated output, real child `SIGINT`/`SIGTERM` cleanup for compile and anchor creation, a coordinated post-precheck destination race with inode/marker preservation, `PATH` shadow resistance for the absolute rename helper, staged failure cleanup, stale destinations, and external-anchor mutation/write-once behavior.
