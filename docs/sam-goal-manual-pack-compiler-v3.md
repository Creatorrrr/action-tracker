# SAM goal evaluation-v3 manual pack compiler

manual-pack-compiler@r3 is the evaluation-v3 successor to the accepted historical
manual-pack-compiler@r2. It consumes only the accepted
sam_goal.teacher_contract_core@2 and sam_goal.source_pts_manifest@2 public
interfaces. The r2 authoring schema, anchor schema, and compiler remain immutable,
byte-pinned regression evidence; they are not a live dependency and cannot create a
v3 pack.

Real P0 work remains blocked until this exact revision is independently accepted.
The examples and tests for this module use synthetic manual facts only.

## Public authoring contract

The public schema is
tests/fixtures/sam-goal-v2/evaluation-v3/authoring-schema.json. It is the exact
Draft 2020-12 document embedded in the authoritative design:

- the root represents exactly one artifact through references to public
  $defs.review or $defs.adjudication;
- reviews are sam-goal-manual-review-v3, schema version 3, with role first or
  second;
- adjudication is sam-goal-manual-adjudication-v3, schema version 3, with role
  adjudication;
- objects are closed, source bindings cover all accepted v3 hashes and seven
  source descriptors, and the current hand and endpoint observability vocabulary
  is the only accepted vocabulary;
- disagreements and decisions use the closed typed registry. Manual anchor
  disagreements are atomic authoring decisions, while compiled compatibility rows
  may report derived anchor.x or anchor.y dotted leaves.

Its durable serialization recursively sorts object keys by raw UTF-8 bytes,
preserves array order, uses two-space JSON indentation, and ends in one LF. The
result is 31,479 bytes with byte SHA-256
90a5e27a6cd10bee753d516ec0f21f361ce8a529c42f585a228190e38311c68e.
The compact canonical hash is
c255cab6b226b0b4ac418ff17c92fec053d34156bf3efaf3af88fc30cdd32962.
Canonical arrays such as scenarios, purposes, disagreements, and decisions are
strictly ordered by raw UTF-8 bytes. Review window array order is not semantic;
windows are keyed by clip and window ID and normalized before comparison.

Every root self hash excludes only the root expectedCanonicalHash key. A
reviewer or adjudicator pseudonym is a stable role identity, not a file hash.

## Commands

Blind validation reads one review Buffer and prints a report only:

    node scripts/sam-goal-manual-pack-v3.mjs validate-review \
      --review /outside/review-a.json \
      --expected-role first \
      --expected-reviewer-pseudonym-sha256 <sha256>

Compilation requires two role-distinct reviews and a separately sealed
adjudication:

    node scripts/sam-goal-manual-pack-v3.mjs compile \
      --review-a /outside/review-a.json \
      --review-b /outside/review-b.json \
      --adjudication /outside/adjudication.json \
      --output-dir /outside/new-candidate

Anchor creation is write-once at an absent path outside the candidate:

    node scripts/sam-goal-manual-pack-v3.mjs create-anchor \
      --anchor /outside/p0-anchor.json \
      --label-dir /outside/new-candidate \
      --review-a /outside/review-a.json \
      --review-b /outside/review-b.json \
      --adjudication /outside/adjudication.json

Verification requires an independently recorded anchor canonical hash:

    node scripts/sam-goal-manual-pack-v3.mjs verify-anchor \
      --anchor /outside/p0-anchor.json \
      --expected-p0-anchor-sha256 <independently-recorded-sha256> \
      --label-dir /outside/new-candidate \
      --review-a /outside/review-a.json \
      --review-b /outside/review-b.json \
      --adjudication /outside/adjudication.json

Relative caller paths resolve against process.cwd(). The fixed role logicalPath
values inside an external anchor are durable identifiers only and are never
resolved as filesystem paths. Unknown, duplicate, missing, legacy, or
mode-inapplicable flags fail before authoring input access.

## Test-only final-segment trace

The compile acceptance suite may set
`SAM_GOAL_MANUAL_PACK_V3_TEST_FINAL_SEGMENT_TRACE=1` only together with
`NODE_ENV=test` and `SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST=1`. The gate is checked
immediately after CLI parsing, before self barriers, destination preparation,
context loading, or authoring input access, and is valid only for `compile`.

On that test-only path, successful compile stdout adds `finalSegmentTrace` with
the ordered child descriptors derived from the exact final-segment array used to
populate the frame map, its child count, 6,711-row coverage, and a canonical
descriptor hash. Each descriptor binds its child and A/B-union origin boundaries,
final window memberships, and the canonical hash of the exact projected selected
manual value. Normal stdout contains no trace field and retains its existing
shape and bytes.

This trace is ephemeral process output: it is not written to any of the nine
candidate files, manifests, descriptors, external anchors, inputs, or auditor
authority. Its contract classification is `durable=false`,
`compilerInput=false`, and `p0Authority=false`.

## Blind review validation

Validation uses one no-follow immutable Buffer for the requested review and only
the accepted public contract/source snapshots. It cannot open a counterpart
review, adjudication, authoring sibling, candidate directory, source video,
teacher row, or live/student/avatar output.

For every review it requires:

- exact accepted source/hash binding and exact seven-source projection;
- `review.clips` in exactly the accepted paired-clip order, with neither
  reversal nor an adjacent swap accepted;
- one full-clip denominator window per accepted clip and canonical overlay
  windows;
- already ordered, gap-free, nonoverlapping intervals covering every one of the
  6,711 exact decoder identities;
- an interval split at every window-membership boundary;
- current absence, subject, contact, hand, endpoint, stable-target, exact-PTS
  plant-confirmation, reacquire, and support rules;
- at least 300 observable pre-mask rows for each hand and head with required clip
  diversity, and the accepted planted/moving support floors for both feet.

The report describes observed support and proposal evidence. It never repairs a
gap or writes a proposal artifact.

`manual.personState = single_target` unconditionally requires a selected subject,
including when attack presence is unknown or ambiguous. The converse is not
inferred: unknown attack presence does not by itself force either subject state.

## Explicit adjudication

For each clip the compiler takes the strictly increasing union of zero, terminal
row count, and every A/B interval boundary. Every adjacent segment is a separate
decision coordinate. It compares scenarios and every manual/subject leaf.
Windows are compared by (clipId, windowId); add/delete uses one parent
window-or-null path, while a shared window may differ only in start, end,
purpose tags, or scenario tags.

The recomputed disagreements and supplied decisions must have identical,
bytewise-sorted unique path/type sets. Every decision contains one complete typed
value. The value may equal A, equal B, or be a third schema-valid explicit value;
it is accepted only because the adjudicator supplied it. Agreement or that
explicit value is the sole output source. The compiler never selects a value by
majority, continuity, neighboring rows, a detector, teacher facts, or defaults.

The final state and windows are validated again after decisions are applied.
Because a schema-valid explicit third window decision may introduce a boundary
that neither review contained, the compiler splits the already selected A/B-union
manual segment at every final-window start or end inside it. Each child keeps the
same agreed or explicitly selected manual value, belongs to exactly one complete
final window-membership set, and is then projected to frames. This split is a
coordinate normalization only; it creates no decision and selects no new value.

## Candidate output

Compilation emits exactly these nine files:

1. evaluation-pack.json
2. manual-windows.json
3. manual-labels.jsonl
4. manual-subject-selection.jsonl
5. manual-review-pass1.jsonl
6. manual-review-pass2.jsonl
7. manual-adjudication.jsonl
8. manual-policy.json
9. manual-summary.json

Labels, subject selections, and both review passes contain exactly one row for
each accepted decoder identity in manifest order. Frame spans use the exact
five-field identity. Adjudication rows exist only for identities where scenarios
or manual state differ; window-only differences do not create a row.

The candidate manifest is evaluation-pack-v2, schema version 2, phase
p0-candidate. Its closed 20-descriptor DAG binds the accepted evaluation, label,
authoring, teacher, anchor, source, and decoder contracts; all manual artifacts;
and exact compiler and v3 auditor bytes. Its only self authority is
candidateP0PackCanonicalSha256; it makes no frozen or verified claim.

All JSON and JSONL bytes are deterministic. JSONL rows are compact canonical JSON
with one LF each. The terminal PTS boundary is decimal BigInt(lastPtsTicks) + 1;
no FPS or wall-clock conversion is used.

## Filesystem and process guarantees

All semantic checks and hashes use the same one-read Buffer snapshot for a path.
The compiler descriptor reuses the exact compiler Buffer read for its tool
snapshot. The module also embeds a normalized whole-source SHA-256: the value
executed by the loaded module must equal the value extracted from that snapshot,
and replacing only the snapshot's embedded 64-hex value with zeroes must hash to
the same value. Consequently a post-loader/pre-snapshot compiler
swap cannot bind different executable and described bytes without a SHA-256
collision.
External inputs capture non-symlink ancestor identities, final lstat, no-follow
file descriptor identity, unchanged fstat, post-read path identity, and realpath.
Sealed inputs are regular files with link count one and pairwise distinct
realpaths, device/inodes, byte hashes, and actor pseudonyms.

Directory identity uses device, inode, type, and mode. Directory link count is
not an identity field: the focused APFS probe preserved device/inode/mode across
renameatx_np while adding an ordinary child changed the directory nlink from 2
to 3. Final sealed inputs and anchors still require regular-file nlink=1, and
their file snapshots also bind size and mtime.

Compile holds a no-follow descriptor for the captured parent directory. A helper
first verifies that descriptor's directory type and device/inode, creates the
unique sibling stage with mkdirat, and returns the created device/inode for
registration. The nine files are exclusively created, written, and fsynced with
openat against an opened and identity-checked stage descriptor. Commit uses only
macOS renameatx_np(RENAME_EXCL) with the held parent descriptor and two
basenames; it never resolves the parent path in the helper and has no
ordinary-rename fallback. The helper fsyncs that same descriptor, and Node then
revalidates the held parent, path parent, and committed inode. Before and after
the post-rename barrier it snapshots the actual nine committed files no-follow,
revalidates their identities, and byte-compares them with the in-memory build.
It finally revalidates all sealed inputs, context snapshots, parent identities,
the committed snapshots, and the destination inode before declaring success.
Destination races preserve the competing inode and bytes.

SIGINT and SIGTERM are one-shot asynchronous shutdowns. They forward the signal
to every controlled child, wait for close, escalate a surviving child to
SIGKILL, and wait again. Cleanup then removes only registered temporary or
provisional paths whose device/inode still matches, using the held directory
descriptor, before exiting exactly 130 or 143.

Create-anchor recompiles into the same dirfd-created, registered, fsynced sibling
stage, byte-compares the closed candidate, runs the candidate auditor, and
removes the stage by captured inode. Its anchor temp is created with
openat(O_EXCL|O_NOFOLLOW), fsynced, and registered by returned device/inode. A
dirfd-relative linkat no-replace commit links the two basenames, unlinks the temp,
and fsyncs the held parent descriptor. After both pre-link barriers, Node
revalidates and resnapshots the exact temp bytes before linking. It snapshots the
actual committed anchor before and after the post-link barrier, then rechecks its
bytes, schema, self hash, independently expected canonical hash, pack and sealed
inputs, context snapshots, parent identities, link count, and inode before
declaring success. The resulting external file has link count one and an inode
distinct from the pack and sealed inputs.

Verify-anchor creates no temporary file or directory. It snapshots the anchor,
sealed inputs, and nine candidate files once, recompiles from those sealed
Buffers in memory, byte-compares all nine files, and invokes the accepted anchored
auditor read-only. It checks the caller-supplied expected anchor hash; a candidate
self hash or compiler-generated expectation cannot freeze P0.

Success and every semantic, child, race, or signal failure leave no registered
temporary path and never replace, merge, or modify an existing candidate, anchor,
or sealed input. Test-only stage-writer, auditor-child, rename-helper, and
anchor-link-helper faults are dual-gated by `NODE_ENV=test` and the explicit
runtime-test switch; their nonzero exits exercise real partial-stage or child
failure cleanup rather than an in-process simulated throw.

## Synthetic verification

Run the owned synthetic suite with:

    node tests/sam-goal-manual-pack-v3-check.mjs

The suite derives its fake manual decisions from the accepted decoder denominator,
never writes real authoring or label paths, checks the historical r2 byte pins
before and after, and exercises schema, functional, edge, failure, regression,
and performance categories. The accepted historical r2 focused suite is executed
separately by the root acceptance workflow because it is outside this worker's
declared read scope.
