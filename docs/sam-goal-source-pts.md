# SAM Goal exact source PTS manifest

## Boundary and purpose

`decoder-manifest.jsonl` is the immutable source-time denominator for downstream SAM-vs-realtime and avatar measurements. It records exactly what the selected video decoder presents. It never reconstructs timestamps from nominal FPS and never filters rows using downstream pose, annotation, model, or report state.

The source module has only four input classes:

- the hard-pinned `source-contract.json`;
- the hard-pinned standalone Draft 2020-12 `source-schema.json`;
- seven paired source videos plus full `jujae` as an unpaired source;
- the selected local `ffprobe` executable.

The contract contains only source membership and paths. The inventory contains only source bytes, selected-stream media facts, decoder PTS identity, serialization identity, and the two source-input hashes. Downstream consumers depend on this interface one-way; changing their semantics cannot require a source rehash.

## Generate and check

From the repository root:

```sh
node scripts/sam-goal-source-pts.mjs
node scripts/sam-goal-source-pts.mjs --check
node tests/sam-goal-source-pts-check.mjs
```

Controlled tests may use:

```sh
node scripts/sam-goal-source-pts.mjs \
  --source-contract /path/to/byte-identical-source-contract.json \
  --source-schema /path/to/byte-identical-source-schema.json \
  --ffprobe-bin /path/to/controlled-ffprobe \
  --output-dir /tmp/source-labels \
  --video 'arms-crossed=/path/with spaces/arms.mp4' \
  --unpaired-video '/path/with spaces/jujae.mp4'
```

All seven `--video` IDs must be known and unique. `jujae-full` cannot be supplied as a paired override. `--check` regenerates everything in memory, does not create directories, and never writes an artifact.

## Standalone contract and schema

The accepted canonical identities are:

- source contract: `39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873`;
- source schema: `ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244`.

The generator checks the contract's declared self-hash, the compiled-in accepted contract hash, the schema hash declared by the contract, and the compiled-in accepted schema hash before invoking `ffprobe`. A semantic edit remains rejected even if an editor recomputes every self-declared hash.

The schema has no external references and closes the keys for the source contract, decoder PTS row, and source inventory. The generator validates the accepted contract, every emitted row, and the completed inventory against those definitions. The focused and real checks also validate the files with Python `jsonschema`'s Draft 2020-12 validator.

Canonical JSON sorts object keys recursively while preserving array order. Only the root `expectedCanonicalHash` is excluded from a contract or inventory self-hash. A nested field with that name remains semantic. Decoder row arrays are order-sensitive.

## Exact timestamp semantics

The generator invokes `ffprobe` with `-select_streams v:0`. Each paired output row binds:

- `ptsTicks`: the unmodified base-10 lexeme from `frame.best_effort_timestamp`;
- `timeBase`: the exact rational `stream.time_base` of the selected stream;
- `sourceFrameIndex`: zero-based position in ffprobe presentation output order;
- `loopEpoch`: `0`;
- `decodeStatus`: `decoded`;
- `decodeReason`: `null`.

The selected stream's absolute index is checked on every frame. A frame-local time base, when present, must equal the selected stream time base. Missing, fractional, exponent-form, negative, leading-zero, duplicate, or non-monotonic PTS fail. PTS comparisons use `BigInt`, so ticks above `Number.MAX_SAFE_INTEGER` remain exact. `pkt_dts`, `nb_frames`, duration, and FPS are never timestamp fallbacks.

This matters in the real sources: `arms-crossed` starts at PTS `512`; `dance-16x9-padded` uses `1/43080` with average rate `43080/1801`; the jujae sources use `1/60000` with average rate `60000/1001`.

## Source stability and transactional output

Every source, the source contract, and the source schema are stat-checked, byte-counted, and SHA-256 hashed. Each video is rechecked immediately after its stream/frame probes. The complete input set is checked after all probes, after artifact construction, and after both outputs have been staged immediately before commit. A later probe cannot mutate an earlier source and still commit stale PTS or identity.

Generation writes only:

- `tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl`;
- `tests/fixtures/sam-goal-v2/labels/source-inventory.json`.

Both are staged and byte-verified. Existing files are backed up, the decoder is installed first, and the inventory is installed last as the commit marker. Any caught failure during the pair commit restores both prior files. Consumers must require the inventory and verify its decoder byte and canonical hashes; a missing or mismatched inventory is never an accepted pair.

## Frozen real-source result

| clip | rows | time base | average rate | first PTS | last PTS |
| --- | ---: | --- | --- | ---: | ---: |
| `arms-crossed` | 386 | `1/15360` | `30/1` | 512 | 197632 |
| `csi-pose` | 2,849 | `1/15360` | `30/1` | 0 | 1458176 |
| `dance-16x9-padded` | 359 | `1/43080` | `43080/1801` | 0 | 644758 |
| `jujae-regression-0-16_5` | 990 | `1/60000` | `60000/1001` | 0 | 989989 |
| `shorts-keGbIts0CA0-16x9-padded` | 1,237 | `1/15360` | `60/1` | 0 | 316416 |
| `shorts-new-dance-E9_h_ZW5z0U-16x9-padded` | 439 | `1/15360` | `30/1` | 0 | 224256 |
| `shorts-vc0GDveRIp0-16x9-padded` | 451 | `1/15360` | `30/1` | 0 | 230400 |
| **paired total** | **6,711** |  |  |  |  |
| `jujae-full` | 2,189 probed / 0 paired | `1/60000` | `60000/1001` | 0 | 2190188 |

Frozen identities:

- decoder physical bytes: `d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79`;
- ordered canonical decoder rows: `dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d`;
- source-only inventory: `64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d`.

The migration changed the inventory identity from `b93060d968c9e280de3ec320cfc834e49e7072e2a82af086fe4c711dde0186ba` because obsolete downstream bindings were removed and the standalone source inputs were added. The 6,711 decoder rows remained byte-for-byte identical.

## Failure interpretation

- `source_contract_hash_drift` / `source_schema_hash_drift`: a source input is not the accepted pinned artifact.
- `source_identity_drift`: a source path, size, or byte hash changed.
- `media_metadata_drift` / `ffprobe_profile_drift`: decoder selection or selected-stream facts changed.
- `decoder_row_count_drift` / `pts_extent_drift`: the denominator or an extent changed.
- `decoder_row_order_drift`: identical rows were permuted.
- `decoder_physical_byte_drift`: formatting bytes changed while parsed ordered rows remained equal.
- `decoder_canonical_semantic_drift`: an ordered row value or membership changed.
- `inventory_canonical_semantic_drift`: bound source meaning changed.
- `artifact_pair_commit_failed`: pair installation failed and rollback was attempted.

Do not repair these failures by sorting rows, renumbering after a drop, substituting FPS-derived time, or filtering by downstream validity. Regenerate only after the underlying source change is intentional and reviewed.
