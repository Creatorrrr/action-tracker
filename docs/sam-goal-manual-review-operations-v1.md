# SAM Goal manual review operations v1

This document is the single normative reviewer rulebook for one evaluation-v3 manual-review cycle. Every first-review, second-review, source-first C0, and later adjudication-reveal bundle must contain these exact bytes and the same recorded byte SHA-256. It defines process, not P0 authority.

## Authority boundary

The first and second `sam-goal-manual-review-v3` documents and the one `sam-goal-manual-adjudication-v3` document are the only formal compiler inputs. Worksheets, manifests, access evidence, journals, export receipts, C0, raw agreement reports, disagreement skeletons, reveal receipts, deviation evidence, and handoff reports are `authorityClass=process-evidence-only`, `compilerInput=false`, and `p0Authority=false`. They never contain `expectedCanonicalHash`, a pack descriptor, an anchor descriptor, or a P0 claim.

The strongest status emitted here is `ready_for_manual_pack_compiler`. Only the separately accepted manual-pack compiler's compile/create-anchor/verify-anchor chain and evaluation-v3 auditor can establish P0 candidate or verified P0 status. This workflow never says P0, frozen, verified, anchored, audited, or teacher-valid about its own output.

Root establishes the accepted compiler precondition outside every CLI. A CLI reads no orchestration state and reports no dependency status. It verifies the literal accepted public pins before opening any source, worksheet, sealed input, or output. Drift is `public_byte_pin_mismatch` and stops the operation.

## Blind roles and cycle order

The first reviewer, second reviewer, and adjudicator have three distinct caller-supplied lowercase SHA-256 pseudonyms. A filename, mutable bundle hash, artifact byte hash, or process name is not an actor pseudonym. A process-only cycle ID joins evidence but never enters a formal file.

Before sealing, first and second see only accepted unmirrored source videos, exact decoder identities, this rulebook, and their own initially UNSET worksheet. They never see one another or C0. The adjudicator completes C0 under the same restriction before seeing A, B, their hashes, a comparison, or a disagreement. Only after A, B, and C0 are sealed and raw A/B gates pass is a new reveal bundle created.

The order is:

1. Root independently establishes the compiler precondition and supplies fixed public pins.
2. Separate first, second, and C0 bundles are prepared. Their work may be concurrent.
3. First and second formal reviews are atomically sealed with separate process receipts. C0 is sealed separately and its byte hash is independently recorded.
4. Raw A/B comparison re-proves both review directories and the expected C0 hash, then uses only A and B for agreement.
5. A new reveal bundle contains an A/B-derived, all-UNSET typed skeleton and a receipt binding independently expected prerequisite hashes.
6. The adjudicator makes one explicit source-based decision per A/B disagreement and one explicit allowed disposition and rationale per derived deviation record.
7. Formal adjudication and deviation evidence are atomically sealed as exactly two files.
8. Handoff re-proves current bytes and returns exactly the two formal reviews and one formal adjudication.

A failed blind validation, support/reacquire gate, raw agreement gate, access gate, or hash chain terminates the cycle. It is never repaired by feeding hints back to a reviewer, reducing the denominator, changing a threshold, editing C0, or trying compilation. A replacement cycle begins with new empty bundles and new outputs.

## Source-only evidence policy

Judge only accepted source pixels and exact source motion context. Never display or use SAM, teacher, detector, keypoint, skeleton, bbox, target candidate, live/student/avatar output, metric, prior proposal, prior label, remediation note, or another role's work. Reflections, screens, cutouts, and overlapping subject-like imagery may justify the source-visible scenario `duplicate_detection_challenge`; detector output never does.

Left and right always mean the depicted subject's anatomical left and right, never screen left/right. Sources are unmirrored. Zoom and pan may change display only. They never change an anchor, which is normalized against the original unmirrored source pixels.

Playback and navigation are context only and write no truth. A write is an explicit actor action naming one exact row or inclusive-start/exclusive-end source-frame range, one accepted field path, and one explicit value. Range paint is allowed only when the actor chose both range and value; the tool never proposes either. Undo is also explicit and journaled. Neighboring values, continuity, playback position, or a previous row never carry, infer, smooth, repair, or default a value.

`unknown` is a positive judgment that source evidence cannot decide a valid state. `{status:"UNSET"}` means not reviewed. UNSET is invalid formal truth and is never changed automatically to unknown or null.

## Exact identity and viewer

Every coordinate is the accepted five-field decoder identity:

`{clipId, sourceFrameIndex, ptsTicks, timeBase:{numerator,denominator}, loopEpoch:0}`.

There are exactly 6,711 decoder-ordered identities. `sourceFrameIndex` is the authoring coordinate and `ptsTicks/timeBase` is its exact rational presentation timestamp. A row ordinal from another source, FPS multiplication, wall clock, rounded microseconds, epsilon, nearest timestamp, or automatic first-PTS offset is never an identity.

Before a worksheet is shown, source bytes and SHA-256 must match the seven accepted descriptors. The bundle-local byte-hashed decoder reconstructs presentation order and requires every integer PTS/time base and row count to equal the manifest. Unsupported exact PTS fails closed.

An edit is enabled only after a full-resolution, unmirrored, uncropped, unresampled still is tied to the exact manifest identity. Browser media time is absolute container PTS context only. The viewer may request the exact rational time but cannot add/subtract source-first PTS or pick a nearest frame. A presented frame must prove direct equality to the requested absolute PTS; otherwise no identity is locked and editing remains disabled. Backward/forward seek relocks before editing.

The viewer shows clip ID, source-frame index, integer PTS ticks, rational time base, loop epoch, and a clearly non-authoritative decimal display. `arms-crossed` begins at 512 ticks. A nonterminal end boundary displays the PTS of the row at that boundary. A terminal boundary is last source-frame index plus one and uses integer `last ptsTicks + 1` under that clip's time base.

No mirror, overlay, skeleton, keypoint, bbox, suggestion, import/drop control, or external URL control is available.

### Interface-v3 full-frame presentation

In first, second, source-first C0, and adjudication reveal, the default locked-still surface uses one uniform CSS fit that displays the complete intrinsic source frame. All four corners and the complete bottom row are simultaneously visible, aspect ratio is preserved, no ancestor clips or scrolls the named evidence target, and the target contains only source-frame pixels. Decode pixels, canvas intrinsic dimensions, exact identity, and rational PTS are unchanged. The blind/C0 target is exactly `data-sam-goal-evidence-target="blind-exact-source-frame"`; reveal is exactly `data-sam-goal-evidence-target="reveal-exact-source-frame"`.

An explicit one-to-one inspection control may show a separate scrollable copy. It is hidden on load, is never the named formal evidence target, never changes the fitted target, and is reversibly closed by `Fit complete frame`. Pointer edits invert the fitted target's rendered rectangle to the original unmirrored intrinsic pixel grid; the four corners map exactly to normalized anchors 0 or 1.

`presentationContractSha256` is SHA-256 over canonical process bytes for the closed interface-v3 descriptor: exact fit/no-clipping/unmirrored/content-only rules, the two target identities, the `fit|one-to-one` view vocabulary, and the raw-UTF-8-logical-path-sorted `{logicalPath,bytes,sha256}` descriptors for all six owned viewer assets. Every manifest, access/session seal, review receipt, C0 ledger, raw report, reveal receipt, deviation record, and handoff report binds the one current value. Omission, stale viewer bytes, or a cross-lineage value fails first as `presentation_contract_mismatch` before staging. This lineage is process evidence only; it is absent from all three formal compiler inputs and every P0 descriptor.

## Bundle and session trust closure

The builder admits only the closed accepted authority/source set, the literal owned rulebook, ten process schemas, six viewer assets, six launcher/helper assets, the exact-PTS decoder, and the selected runtime executable. The trusted repository coordinator holds an independent literal descriptor for every owned, decoder, and runtime asset: source path, bundle logical path, byte length, SHA-256, media type, executable bit, and asset class. A bundle manifest cannot authorize its own replacement bytes. The current trusted source, manifest descriptor, copied bundle member, and staged copy must all match the same literal descriptor before spawn or direct consumption. The schema and viewer source directories also have exact member sets; an extra or missing source member fails before bundle creation.

Blind and C0 bundles contain no `fixed` root. Their mutable set is exactly worksheet seed, edit journal, actor attestation, and access evidence. Reveal contains exactly the nine declared fixed snapshots and only adjudication journal, actor attestation, and access evidence under mutable. All directories are `0700`; immutable/fixed data are `0400`, the declared runtime executable is `0500`, and mutable files are `0600`. Symlinks, hardlinks, inode aliases, owner drift, wrong modes, missing/extra members, and terminal temporary files fail closed.

Browser reload is allowed only while the same coordinator session remains running. If that coordinator exits or receives a terminating signal after any journal edit, the nonempty journal has no independently retained partial-session authority and a later `serve` rejects it before child spawn; continue only by preparing a new bundle revision whose journal is empty. Never copy or prefill a journal to simulate a resumable session.

The coordinator holds every tree member and ancestor before spawn. After the child closes its listener and writable handles, the coordinator acquires the terminal journal, attestation, and access evidence relative to its pre-held mutable directory descriptor, independently replays the final state, sends the exact private `ACK\n`, reaps a clean child, and re-proves the same held tree. Private FINAL and ACK waits share an explicit 24-hour pathological-hang upper bound; pipe failure, child exit, or signal fails immediately. Only then does the coordinator emit one canonical closed session envelope containing `sessionTreeSha256`. The descriptor binds terminal state, cycle, mode, actor, manifest, immutable set, fixed-input set, seed, replayed final state, journal, attestation, and access evidence. Neither that descriptor nor an expected session hash is stored in the bundle.

The caller retains the emitted digest outside the bundle. `export-review`, `seal-c0`, and `export-adjudication` require it as `--expected-session-tree-sha256`, rebuild the current exact descriptor, and keep the matching tree held through their point of no return. Review receipts, the C0 ledger, and deviation evidence propagate the matched digest so handoff can re-prove all four session values through independently expected process-byte hashes.

## Existing evaluation-v3 vocabulary

Scenario arrays are nonempty, unique, and raw-UTF-8 sorted. Only these values exist:

- `neutral`: ordinary source context without a more specific visible challenge.
- `entry_exit`: intended subject visibly enters or exits.
- `reacquire`: source-visible return after a qualifying absent/unreliable interval.
- `arms_crossed`: arms visibly cross the torso or each other.
- `self_occlusion`: one part of the subject visibly hides another.
- `side_view`: subject is primarily in profile.
- `back_view`: subject is primarily back-facing.
- `fast_motion`: rapid visible motion or blur affects observation.
- `jump`: visible jump, airborne phase, or landing.
- `footwork`: salient step, foot motion, or contact transition.
- `turn`: facing direction visibly changes.
- `leg_extension`: a leg is visibly extended.
- `distance_change`: source scale visibly changes with distance.
- `partial_body_crop`: a relevant region crosses the image boundary.
- `multi_person_background`: another physical person is visible.
- `duplicate_detection_challenge`: source-visible duplicate-subject imagery or overlap, never detector output.
- `hand_closeup`: a hand is visibly shown at close scale.
- `full_body_dance`: full body is visibly framed during dance motion.
- `upper_body_only`: framing visibly excludes the lower body.

`presence` is `present`, `absent`, or `unknown`. Present means the intended physical subject is visibly present; absent means absent from the frame; unknown means pixels cannot decide.

`personState` is `single_target`, `multiple_people`, `absent`, or `unknown` and describes physical people, not detections.

Each `occlusion` field (`body`, `leftFoot`, `rightFoot`, `leftHand`, `rightHand`) is:

- `observable`: usable without meaningful obstruction.
- `partial`: partly visible but still source-observable.
- `occluded`: hidden inside the image by person or object.
- `out_of_frame`: outside the image.
- `unknown`: cause/state cannot be decided.

Each anatomical foot `contact.left/right` is `planted`, `moving`, or `unknown`. Moving includes first lift, swing, held-raised motion, unsettled landing, slide, and pivot. Planted requires observable stable support and the confirmation rule below. A visibility gap is unknown, never inherited.

Each `handObservability.left/right` is `observable` or `not_observable` and says only whether the whole hand is usable source evidence. It does not describe a palm, finger, pose class, or inferred 3D orientation.

Only five endpoint fields exist: `leftWrist`, `rightWrist`, `leftAnkle`, `rightAnkle`, and `head`, each `observable` or `not_observable`. There is no foot-endpoint alias.

`subjectSelection.state` is `selected`, `absent`, `ambiguous`, or `unknown`. Selected requires a stable nonempty manual target ID. With multiple physical people it also requires an explicit normalized `{x,y}` anchor on the chosen subject. Other states require null target ID and null anchor.

Forbidden names include `palm`, `finger`, `leftPalm`, `rightPalm`, `leftFinger`, `rightFinger`, `leftFootEndpoint`, `rightFootEndpoint`, `footObservability`, any generic observability object, and any detector-derived person state or target ID.

## Cross-field truth

- `presence=absent` requires subject state absent, person state absent, both contacts unknown, both hands not observable, all five endpoints not observable, and every occlusion field exactly `out_of_frame` or `unknown`.
- A known foot contact requires presence present, the corresponding foot exactly `observable` (`partial` is insufficient), and the corresponding ankle endpoint observable.
- An observable hand requires its named hand observable or partial and its wrist endpoint observable.
- An endpoint cannot be observable when the corresponding part is occluded, out of frame, or unknown.
- `personState=single_target` requires selected subject.
- `personState=multiple_people` requires ambiguous subject or selected subject with a non-null anchor.
- Selected requires nonempty manual target ID; every other subject state requires null ID and anchor.
- Every one of the 6,711 identities has exactly one complete value in each raw review and C0.

## Exact contact confirmation

`stablePlantConfirmationMs=100`. The first settled plant candidate is labeled planted only after uninterrupted observable stable support is confirmed from that first candidate through a later exact decoder sample whose inclusive first-to-last PTS delta is at least 100 ms:

`BigInt(deltaTicks) * timeBase.numerator * 1000 >= 100 * timeBase.denominator`.

Equality passes. One tick/sample below fails. Crop, occlusion, blur, out-of-frame, or unknown is contact unknown and breaks confirmation. A later plant requires a fresh uninterrupted confirmation; no pre-gap value carries across.

## Exact reacquire rule

`unreliableMinimumMs=200`. Absent means presence absent and subject state absent. Unreliable means presence unknown, subject ambiguous/unknown, or body occluded/out-of-frame/unknown. Reliable means presence present, subject selected, and body observable/partial.

Find maximal contiguous start-inclusive/end-exclusive absent-or-unreliable intervals. Duration is exact `[startPts,endPts)` using the first decoder identity at/after the interval as `endPts`; it passes when:

`BigInt(endPtsTicks - startPtsTicks) * timeBase.numerator * 1000 >= 200 * timeBase.denominator`.

Merge overlap/nesting and adjacent intervals with no present identity between them. Each start identity is unique. A P0-candidate event is a qualifying interval followed by the first reliable identity at or after its end. Each raw review independently needs at least three such events across at least two hard-test clips. Missing support never changes 6,711.

## Windows

Each clip has exactly one structural base window spanning source-frame index 0 through its row count. Its only prefilled field is `purposeTags=[full_clip_denominator]`, which is contract structure, not observed truth. Its `scenarioTags` begins UNSET and needs an explicit value.

An actor overlay exists only after an explicit actor action chooses its ID, clip, and exact boundaries. Both purpose and scenario arrays begin UNSET and require explicit nonempty raw-UTF-8-sorted values. Overlay purpose never includes `full_clip_denominator` and never changes the denominator.

Accepted purpose values are `full_clip_denominator`, `absence_reacquire`, `self_occlusion`, `fast_motion`, `contact_transition`, `multi_person`, `crop_out_of_frame`, `duplicate_detection`, `turning`, and `hand_observability`, with their literal source-only meanings. No aliases exist. Window starts are inclusive and ends exclusive. Every membership boundary is also a formal interval split boundary even when row values do not change.

## Raw A/B agreement and C0 boundary

The accepted validator is used only as an opaque exit-status gate. Stdout may be empty, non-JSON, or arbitrary binary. It is never parsed, canonicalized, field-inspected, or compared across invocations; only its exact bytes/base64 and byte SHA-256 are preserved.

This module independently materializes the immutable formal A/B buffers to 6,711 rows and derives truth, support, reacquire, disagreement, and unweighted Cohen kappa. Unknown is included. Presence/person state uses seven per-clip joint-tuple cells and minimum macro 0.99. Contact uses fourteen clip/foot cells and minimum 0.9. Observability uses every clip and the five occlusion, two hand, and five endpoint fields and minimum 0.95. Zero variance is 1 only for identical constants and 0 otherwise. Equality at each threshold passes; comparison is unrounded.

C0 is required as a prior source-first seal and chain binding, but no C0 value enters an A/B numerator, denominator, marginal, support count, disagreement, or formal path. Changing all C0 values cannot change raw A/B metric or formal disagreement bytes.

## Adjudication and deviation

The formal disagreement set is derived only from immutable A/B. For each clip use the union of A/B interval boundaries, plus first and terminal boundaries. Compare the exact twenty segment leaves and keyed windows. Only the accepted fourteen value types and path registry exist. Anchor is atomic. Array indices, `anchor/x`, `anchor/y`, aliases, and generic paths are forbidden. Parent add/delete and shared-window child differences never coexist for the same window disagreement.

Every decision begins exactly `{status:"UNSET"}`. Agreed values, C0, majority, neighbor, continuity, and compiler defaults never prefill a decision. The actor explicitly sets one typed value per A/B disagreement.

Disposition coordinates are regenerated from the complete current decision set. Changing any decision invalidates every previously recorded disposition, including records whose path or class appears unchanged; the adjudicator must explicitly review and record the complete regenerated set again. This global reset prevents rationales from surviving a different final-state context.

Segment evidence projects C0 into maximal nonempty row runs that cover the entire A/B coordinate. A C0-only boundary never splits the formal A/B coordinate; it adds only process evidence. Window-parent evidence projects the complete keyed C0 window or `C0_WINDOW_MISSING`. Window-child evidence projects the exact typed child or missing. Segment records never carry a window projection; window records never carry row runs.

The eleven derived classes and only allowed nonblocking disposition are:

- `final_matches_a_only` → `accept_a_value`
- `final_matches_b_only` → `accept_b_value`
- `final_matches_neither_raw_review` → `accept_novel_source_value`
- `final_matches_c0_all_rows` → `confirm_c0_alignment`
- `final_matches_c0_some_rows` → `accept_partial_c0_divergence`
- `final_matches_c0_no_rows` → `accept_c0_divergence`
- `c0_differs_from_ab_agreement` → `confirm_ab_agreement_over_c0`
- `c0_boundary_not_represented_by_ab` → `confirm_unsplit_ab_coordinate`
- `window_final_matches_c0` → `confirm_window_c0_alignment`
- `window_final_differs_from_c0` → `accept_window_c0_divergence`
- `c0_window_missing` → `accept_window_without_c0`

Every class also allows only `restart_cycle`, which blocks export. Every record, including nonblocking and agreed-value C0 evidence, needs a trimmed nonempty actor rationale. Missing, extra, duplicate, retyped, generic/cross-class disposition, empty rationale, UNSET, or restart blocks.

## Sealing and failure

Mutable bundles and outputs are caller-selected absent external paths. Formal review plus receipt and formal adjudication plus deviation are each one atomic no-replace absent-directory transaction with exactly two declared regular nonsymlink `nlink=1` member files. The directory inode is proved as a directory and is not subjected to member file/link rules. A single process output uses a separate atomic no-replace regular-file transaction.

Inputs use one no-follow, stable dev/inode/mode/link/size buffer snapshot. The exact staged review file descriptor is positionally re-read after validator exit, after receipt fsync, and before commit. Ancestors and destination are re-proved. Existing destinations and competitors always win unchanged. No ordinary rename replacement fallback is allowed.

Before the point of no return, failure or SIGINT/SIGTERM terminates children, removes the registered stage, and leaves no destination. The point of no return is successful atomic no-replace commit. Signals are latched through commit and final proof. After successful proof, a latched signal exits 130/143 with independently recordable hashes. A post-commit proof failure leaves immutable `committed_pending_reproof`, makes no readiness claim, and never deletes or repairs the committed output. A downstream consumer ignores producer status and performs the full current directory/member/ancestor or single-file re-proof.

Handoff requires independently supplied expected byte hashes for both receipts, C0, raw report, reveal receipt, and deviation evidence. No artifact selects its own expected hash. It reruns both validators only for fresh exit-zero gates; fresh opaque stdout is never compared with historical stdout. It reconstructs every non-opaque raw field from the current formal reviews and accepted public contracts while preserving the independently hash-sealed report's internally bound historical stdout slots. After complete current re-proof, stdout contains one closed process report and a compiler tuple with exactly `{reviewA,reviewB,adjudication}` path-and-byte-hash members. No process evidence is passed to compilation or becomes a pack descriptor.
