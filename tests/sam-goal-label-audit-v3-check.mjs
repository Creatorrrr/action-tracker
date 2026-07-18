import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  auditP0Candidate,
  auditP1Candidate,
  auditDataset,
  auditSourceManifest,
  auditTeacherSummary,
  auditTeacherInputs,
  assertClosedDescriptorPolicy,
  assertDatasetRowClaim,
  assertExactArtifactRows,
  assertMaskRowClaim,
  assertPinnedSelfHashedArtifact,
  assertRefinedRowClaim,
  canonicalHash,
  clipScales,
  contactStableConfirmed,
  deriveDetectorProvenance,
  deriveRefinedRow,
  deriveSelection,
  descriptorSetHash,
  expectedDatasetRow,
  expectedMaskRow,
  expectedSourceManifest,
  expectedTeacherSummary,
  externalAnchorSnapshot,
  loadCore,
  parseArgs,
  parseRawCrLfJsonlSnapshot,
  runAudit,
  sha256,
  stableStringify,
  torsoBasisFacts,
  usableBbox,
  validateAuditOptions,
  validDescriptorPath,
  validateSchemaValue,
  verifyP0Anchor,
  verifyP1Anchor,
} from "../scripts/sam-goal-label-audit-v3.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suiteStartedAt = process.hrtime.bigint();
const AUDIT = path.join(ROOT, "scripts/sam-goal-label-audit-v3.mjs");
const V3 = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3");
const cleanupProbeIndex = process.argv.indexOf("--cleanup-probe");
const fullChainWorkerMode = process.argv.includes("--full-chain-worker");
if (fullChainWorkerMode && process.env.SAM_V3_WORKER_DEPTH !== "1") throw new Error("full_chain_worker_depth_guard");
if (!fullChainWorkerMode && process.env.SAM_V3_WORKER_DEPTH === "1") throw new Error("full_chain_worker_recursive_entry");
if (cleanupProbeIndex >= 0) {
  const marker = process.argv[cleanupProbeIndex + 1]; const signal = process.argv[cleanupProbeIndex + 2] || "SIGTERM";
  if (!marker || !["SIGINT", "SIGTERM"].includes(signal)) throw new Error("cleanup_probe_arguments_invalid");
  const probeTempParent = realpathSync(path.resolve(os.tmpdir()));
  const probeTempRoot = mkdtempSync(path.join(probeTempParent, "sam-eval-v3-test-"));
  const probeFixtureParent = path.join(V3, "audit-fixtures");
  const probeFixtureRuntime = mkdtempSync(path.join(probeFixtureParent, "runtime-test-"));
  let probeCleaned = false;
  const probeCleanup = () => { if (!probeCleaned) { rmSync(probeTempRoot, { recursive: true, force: true }); rmSync(probeFixtureRuntime, { recursive: true, force: true }); probeCleaned = true; } };
  process.once(signal, () => { probeCleanup(); process.exit(signal === "SIGINT" ? 130 : 143); });
  process.once(signal === "SIGINT" ? "SIGTERM" : "SIGINT", () => { probeCleanup(); process.exit(99); });
  writeFileSync(marker, JSON.stringify({ mode: "cleanup-only", normalSuiteStarted: false, spawnedChildren: 0, pid: process.pid, signal, tempRoot: probeTempRoot, fixtureRuntime: probeFixtureRuntime }));
  writeFileSync(path.join(probeTempRoot, "failure-residue.bin"), Buffer.alloc(1024 * 1024));
  writeFileSync(path.join(probeFixtureRuntime, "failure-residue.bin"), Buffer.alloc(1024 * 1024));
  process.kill(process.pid, signal);
  setTimeout(() => { probeCleanup(); process.exit(98); }, 5000);
  await new Promise(() => {});
}
const tempParent = realpathSync(path.resolve(os.tmpdir()));
const beforeTemps = new Set(readdirSync(tempParent).filter((name) => name.startsWith("sam-eval-v3-test-")).map((name) => path.join(tempParent, name)));
const tempRoot = mkdtempSync(path.join(tempParent, "sam-eval-v3-test-"));
const fixtureRuntimeParent = path.join(V3, "audit-fixtures");
const beforeFixtureRuntimes = new Set(readdirSync(fixtureRuntimeParent).filter((name) => name.startsWith("runtime-test-")).map((name) => path.join(fixtureRuntimeParent, name)));
const fixtureRuntime = mkdtempSync(path.join(fixtureRuntimeParent, "runtime-test-"));
let cleaned = false;
function cleanup() { if (!cleaned) { rmSync(tempRoot, { recursive: true, force: true }); rmSync(fixtureRuntime, { recursive: true, force: true }); cleaned = true; } }
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(signal === "SIGINT" ? 130 : 143); });

let checks = 0;
function check(fn) { fn(); checks += 1; }
function throwsCode(fn, code) { assert.throws(fn, (error) => String(error.message).startsWith(code)); }
const core = loadCore();
const teacher = auditTeacherInputs(core);
function withSelfHash(value) { const result = { ...value }; delete result.expectedCanonicalHash; result.expectedCanonicalHash = canonicalHash(result); return result; }
function writeStableJson(filePath, value) { writeFileSync(filePath, `${stableStringify(value)}\n`); }
function writeStableJsonl(filePath, rows) { writeFileSync(filePath, rows.length ? `${rows.map(stableStringify).join("\n")}\n` : ""); }
function descriptor(filePath, descriptorPath, canonical = false) {
  const buffer = readFileSync(filePath); const result = { path: descriptorPath };
  if (canonical) { const value = JSON.parse(buffer); result.canonicalSha256 = canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash")); }
  result.byteSha256 = sha256(buffer); return result;
}
function repoRelative(filePath) { return path.relative(ROOT, filePath).split(path.sep).join("/"); }
function manualIdentity(row) { return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch }; }
function teacherIdentity(row) { return { ...manualIdentity(row), decodeStatus: row.decodeStatus, decodeReason: row.decodeReason }; }

check(() => assert.equal(core.hashes.contract, "5307a5d4e2c56e652b7a417713e1b0ebff5dabf712e591eefa94737e7318b1bd"));
check(() => assert.equal(core.hashes.teacherInventory, core.teacherInventory.expectedCanonicalHash));
check(() => assert.equal(core.hashes.teacherPolicy, core.teacherPolicy.expectedCanonicalHash));
check(() => assert.equal(teacher.totalRows, 6711));
check(() => assert.equal([...teacher.rowsByClip.values()].reduce((sum, clip) => sum + clip.rows.reduce((count, row) => count + row.persons.length, 0), 0), 6675));
check(() => assert.deepEqual(Object.fromEntries([...teacher.provenanceByClip].map(([clipId, rows]) => [clipId, Object.fromEntries(["detector_hit", "carry_forward_fallback", "miss_no_prediction", "provenance_unavailable"].map((state) => [state, rows.filter((row) => row.state === state).length]))])), core.teacherPolicy.expectedRawReconciliation));
check(() => assert.equal(teacher.rowsByClip.get("arms-crossed").summary.source_frame_count, 388));
check(() => assert.equal(teacher.rowsByClip.get("arms-crossed").rows.length, 386));
check(() => assert.equal(core.decoderByClip.has("jujae-full"), false));

const person = (detector = [0, 0, 10, 10], fallback = [0, 0, 10, 10], score = 0.5, id = 0) => ({ person_id: id, detector_bbox_xyxy: detector, bbox_xyxy: fallback, detector_score: score });
const rawSelection = (persons) => ({ image_size: { width: 100, height: 100 }, persons });
const selected = (anchor = null) => ({ state: "selected", manualTargetId: "target-1", anchor });
check(() => assert.deepEqual(deriveDetectorProvenance({ persons: [] }), { state: "miss_no_prediction", source: "zero_raw_persons_summary_reconciled" }));
check(() => assert.equal(deriveDetectorProvenance({ persons: [person(null)] }).state, "provenance_unavailable"));
check(() => assert.equal(deriveDetectorProvenance({ persons: [person()] }, { persons: [person()] }).state, "carry_forward_fallback"));
check(() => assert.equal(deriveDetectorProvenance({ persons: [person(undefined, undefined, 0.000001)] }, { persons: [person(undefined, undefined, 0.999999)] }).state, "detector_hit"));
check(() => assert.equal(usableBbox([0, 0, 1, 1]), true));
check(() => assert.equal(usableBbox([0, 0, 0, 1]), false));
check(() => assert.equal(deriveSelection(rawSelection([]), selected(), core.teacherPolicy).selectionFailureReason, "teacher_record_missing"));
check(() => { const result = deriveSelection(rawSelection([person(null, null)]), selected(), core.teacherPolicy); assert.equal(result.rawPersonIndex, 0); assert.equal(result.effectiveBboxSource, null); assert.deepEqual(result.selectionWarningCodes, []); });
check(() => assert.equal(deriveSelection(rawSelection([person(null, null), person(null, null, 0.2, 1)]), selected(), core.teacherPolicy).selectionFailureReason, "teacher_candidate_ambiguous"));
check(() => assert.equal(deriveSelection(rawSelection([person(null, null)]), selected({ x: 0.5, y: 0.5 }), core.teacherPolicy).selectionFailureReason, "candidate_bbox_unusable"));
check(() => { const result = deriveSelection(rawSelection([person(null, [0, 0, 60, 60])]), selected({ x: 0.5, y: 0.5 }), core.teacherPolicy); assert.equal(result.effectiveBboxSource, "fallback"); assert.deepEqual(result.selectionWarningCodes, ["detector_bbox_invalid_fallback"]); });
check(() => assert.equal(deriveSelection(rawSelection([person([0, 0, 1, 1])]), selected({ x: 0, y: 0 }), core.teacherPolicy).rawPersonIndex, 0));
check(() => assert.equal(deriveSelection(rawSelection([person([0, 0, 100, 100]), person([0, 0, 100, 100], undefined, 0.4, 1)]), selected({ x: 0.5, y: 0.5 }), core.teacherPolicy).selectionFailureReason, "teacher_candidate_ambiguous"));
check(() => { const result = deriveSelection(rawSelection([person()]), { state: "absent", manualTargetId: null, anchor: null }, core.teacherPolicy); assert.equal(result.rawPersonIndex, null); assert.equal(result.selectionFailureReason, null); });

const armsInput = teacher.rowsByClip.get("arms-crossed");
const armsDecoder = core.decoderByClip.get("arms-crossed")[0];
const armsSubject = selected();
const armsDataset = expectedDatasetRow(armsDecoder, armsInput.rows[0], armsInput.lines[0], 0, teacher.provenanceByClip.get("arms-crossed")[0], armsSubject, core.teacherPolicy);
check(() => assert.notEqual(armsInput.lines[0].at(-1), 0x0d));
check(() => assert.equal(Buffer.from(armsDataset.rawLineBase64, "base64").equals(armsInput.lines[0]), true));
check(() => assert.equal(Buffer.concat([armsInput.lines[0], Buffer.from([0x0d, 0x0a])]).equals(armsInput.snapshot.buffer.subarray(0, armsInput.lines[0].length + 2)), true));
check(() => assert.equal(armsDataset.warningCodes.includes("raw_timestamp_differs_from_exact_pts"), true));
check(() => assert.equal(armsDataset.rawTimestampComparison.deltaSec, -1 / 30));
check(() => { const reordered = Buffer.from(stableStringify(JSON.parse(armsInput.lines[0])), "utf8"); assert.notEqual(sha256(reordered), armsDataset.rawLineByteSha256); });
check(() => assert.equal(parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}\r\n") }, "valid").rows.length, 1));
check(() => throwsCode(() => parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}\n") }, "lone-lf"), "raw_terminal_crlf_required"));
check(() => throwsCode(() => parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}\r\n{\"a\":2}\n") }, "mixed"), "raw_terminal_crlf_required"));
check(() => throwsCode(() => parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}\rX\r\n") }, "lone-cr"), "raw_lone_cr"));
check(() => throwsCode(() => parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}") }, "missing-terminal"), "raw_terminal_crlf_required"));
check(() => throwsCode(() => parseRawCrLfJsonlSnapshot({ buffer: Buffer.from("{\"a\":1}\r\r\n") }, "replaced-lf"), "raw_lone_cr"));

function makeRaw(frameIndex, ptsTicks = String(frameIndex)) {
  const points = Array.from({ length: 70 }, () => [0, 0, 0]);
  Object.assign(points, {
    5: [-0.2, 0.5, 0], 6: [0.2, 0.5, 0], 7: [-0.4, 0.4, 0], 8: [0.4, 0.4, 0], 9: [-0.15, 0, 0], 10: [0.15, 0, 0],
    11: [-0.15, -0.4, 0], 12: [0.15, -0.4, 0], 13: [-0.15, -0.8, 0], 14: [0.15, -0.8, 0], 15: [-0.2, -0.9, 0],
    16: [-0.1, -0.9, 0], 17: [-0.15, -0.7, 0], 18: [0.2, -0.9, 0], 19: [0.1, -0.9, 0], 20: [0.15, -0.7, 0],
    41: [0.6, 0.3, 0], 62: [-0.6, 0.3, 0], 69: [0, 0.65, 0],
  });
  const camera = [0, 0, 5]; const focal = 100; const width = 200; const height = 200;
  const points2 = points.map(([x, y, z]) => [(x + camera[0]) * focal / (z + camera[2]) + width / 2, (y + camera[1]) * focal / (z + camera[2]) + height / 2]);
  return {
    video: "synthetic.mp4", frame_index: frameIndex, timestamp_sec: Number(ptsTicks) / 30, image_size: { width, height }, person_count: 1,
    persons: [{ person_id: 7, bbox_xyxy: [0, 0, 200, 200], detector_bbox_xyxy: [0, 0, 200, 200], detector_score: 0.01, focal_length: focal,
      pred_cam_t: camera, global_rot: [0, 0, 0], keypoints_mhr70_2d: points2, keypoints_mhr70_3d: points,
      mhr_joint_coords_127_3d: Array.from({ length: 127 }, (_, index) => [index / 1000, 0, 0]) }],
  };
}
function syntheticEntry(frameIndex, ptsTicks = String(frameIndex)) {
  const raw = makeRaw(frameIndex, ptsTicks); const decoder = { artifactType: "decoder-pts", clipId: "synthetic", sourceFrameIndex: frameIndex, ptsTicks, timeBase: { numerator: 1, denominator: 30 }, loopEpoch: 0, decodeStatus: "decoded", decodeReason: null };
  const subject = selected(); const provenance = deriveDetectorProvenance(raw, null); const selection = deriveSelection(raw, subject, core.teacherPolicy);
  const row = expectedDatasetRow(decoder, raw, Buffer.from(JSON.stringify(raw)), frameIndex, provenance, subject, core.teacherPolicy);
  return { decoder, raw, provenance, subject, selection, row };
}
const smoothWindow = Array.from({ length: 5 }, (_, index) => syntheticEntry(index));
check(() => assert.equal(deriveRefinedRow(2, smoothWindow, core.teacherPolicy).refinementStatus, "smoothed"));
check(() => assert.equal(deriveRefinedRow(0, smoothWindow, core.teacherPolicy).refinementStatus, "identity_boundary"));
check(() => { const attacked = structuredClone(smoothWindow); attacked[1].provenance = { state: "carry_forward_fallback", source: "derived_exact_detector_tuple_repeat_summary_reconciled" }; assert.equal(deriveRefinedRow(2, attacked, core.teacherPolicy).refinementStatus, "identity_selection_gap"); });
check(() => { const attacked = structuredClone(smoothWindow); attacked[3].decoder.ptsTicks = "4"; assert.equal(deriveRefinedRow(2, attacked, core.teacherPolicy).refinementStatus, "identity_nonuniform_pts"); });
check(() => { const attacked = structuredClone(smoothWindow); attacked[0].raw.persons[0].keypoints_mhr70_3d[5][0] += 2; assert.equal(deriveRefinedRow(2, attacked, core.teacherPolicy).refinementStatus, "identity_safety_fallback"); });
check(() => { const unavailable = structuredClone(smoothWindow); unavailable[2].selection.rawPersonIndex = null; unavailable[2].selection.selectedTrackId = null; assert.equal(deriveRefinedRow(2, unavailable, core.teacherPolicy).refinementStatus, "unavailable"); });
check(() => assert.equal(deriveRefinedRow(2, smoothWindow, core.teacherPolicy).targetRole, "watch"));
const selectedNonHitWindow = structuredClone(smoothWindow); selectedNonHitWindow[2].provenance = { state: "carry_forward_fallback", source: "derived_exact_detector_tuple_repeat_summary_reconciled" };
const selectedNonHitRefined = deriveRefinedRow(2, selectedNonHitWindow, core.teacherPolicy);
check(() => { assert.equal(selectedNonHitRefined.refinementStatus, "unavailable"); assert.match(selectedNonHitRefined.rawCenterCanonicalSha256, /^[0-9a-f]{64}$/); assert.equal(selectedNonHitRefined.refinedPoseCanonicalSha256, null); });
check(() => { const attacked = structuredClone(smoothWindow); attacked[2].raw.persons[0].pred_cam_t[0] = Infinity; throwsCode(() => deriveRefinedRow(2, attacked, core.teacherPolicy), "refined_selected_center_nonfinite"); });

const refinementMatrixValid = [];
const unselectedWindow = structuredClone(smoothWindow); unselectedWindow[2].selection.rawPersonIndex = null; unselectedWindow[2].selection.selectedTrackId = null;
refinementMatrixValid.push(deriveRefinedRow(2, unselectedWindow, core.teacherPolicy), selectedNonHitRefined, deriveRefinedRow(0, smoothWindow, core.teacherPolicy));
const selectionGapWindow = structuredClone(smoothWindow); selectionGapWindow[1].provenance = { state: "carry_forward_fallback", source: "derived_exact_detector_tuple_repeat_summary_reconciled" };
refinementMatrixValid.push(deriveRefinedRow(2, selectionGapWindow, core.teacherPolicy));
const invalidNeighborWindow = structuredClone(smoothWindow); invalidNeighborWindow[1].raw.persons[0].keypoints_mhr70_3d[0][0] = Infinity;
refinementMatrixValid.push(deriveRefinedRow(2, invalidNeighborWindow, core.teacherPolicy));
const nonuniformWindow = structuredClone(smoothWindow); nonuniformWindow[3].decoder.ptsTicks = "4";
refinementMatrixValid.push(deriveRefinedRow(2, nonuniformWindow, core.teacherPolicy));
const safetyWindow = structuredClone(smoothWindow); safetyWindow[0].raw.persons[0].keypoints_mhr70_3d[5][0] += 2;
refinementMatrixValid.push(deriveRefinedRow(2, safetyWindow, core.teacherPolicy), deriveRefinedRow(2, smoothWindow, core.teacherPolicy));
for (const [index, row] of refinementMatrixValid.entries()) check(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.refinedRow, row, `refined-valid/${index}`));
const refinementMatrixInvalid = [
  (() => { const row = structuredClone(refinementMatrixValid[0]); row.selectedRawPersonIndex = 0; return row; })(),
  (() => { const row = structuredClone(selectedNonHitRefined); row.rawCenterCanonicalSha256 = null; return row; })(),
  (() => { const row = structuredClone(selectedNonHitRefined); row.predCamT = [0, 0, 0]; return row; })(),
  (() => { const row = structuredClone(refinementMatrixValid[2]); row.sourceWindow = Array(5).fill(row.identity); return row; })(),
  (() => { const row = structuredClone(refinementMatrixValid.at(-1)); row.sourceWindow = null; return row; })(),
  (() => { const row = structuredClone(refinementMatrixValid[3]); row.predCamT = null; return row; })(),
  (() => { const row = structuredClone(refinementMatrixValid[0]); row.rawCenterCanonicalSha256 = "a".repeat(64); return row; })(),
  (() => { const row = structuredClone(refinementMatrixValid.at(-1)); row.refinedPoseCanonicalSha256 = null; return row; })(),
];
for (const [index, row] of refinementMatrixInvalid.entries()) check(() => throwsCode(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.refinedRow, row, `refined-invalid/${index}`), "schema_validation"));
const refinementMatrixPath = path.join(tempRoot, "refinement-matrix.json"); writeStableJson(refinementMatrixPath, { valid: refinementMatrixValid, invalid: refinementMatrixInvalid });
const refinementDraft = spawnSync("python3", ["-c", "import json,sys\nfrom jsonschema import Draft202012Validator\ns=json.load(open(sys.argv[1]))\nm=json.load(open(sys.argv[2]))\nv=Draft202012Validator(s['$defs']['refinedRow'], resolver=__import__('jsonschema').RefResolver.from_schema(s))\nassert all(not list(v.iter_errors(x)) for x in m['valid'])\nassert all(list(v.iter_errors(x)) for x in m['invalid'])\nprint(len(m['valid']),len(m['invalid']))", path.join(V3, "teacher-schema.json"), refinementMatrixPath], { cwd: ROOT, encoding: "utf8" });
check(() => assert.equal(refinementDraft.status, 0, refinementDraft.stderr || refinementDraft.stdout));

const manualLabel = {
  presence: "present", personState: "single_target", occlusion: { body: "observable", leftFoot: "observable", rightFoot: "observable", leftHand: "observable", rightHand: "occluded" },
  contact: { left: "planted", right: "moving" }, handObservability: { left: "observable", right: "not_observable" },
  endpointObservability: { leftWrist: "observable", rightWrist: "observable", leftAnkle: "observable", rightAnkle: "observable", head: "not_observable" },
};
const frameSegments = core.teacherPolicy.majorSegments.slice(0, 8).map((segment) => { const [a, b] = segment.split("-").map(Number); return Math.hypot(...smoothWindow[2].raw.persons[0].keypoints_mhr70_3d[a].map((value, axis) => value - smoothWindow[2].raw.persons[0].keypoints_mhr70_3d[b][axis])); });
const clipScale = [...frameSegments].sort((a, b) => a - b).slice(3, 5).reduce((sum, value) => sum + value, 0) / 2;
const mask = expectedMaskRow(smoothWindow[2], manualLabel, clipScale, null, core);
check(() => { assert.equal(mask.scope.leftArm, true); assert.equal(mask.scope.head, false); });
check(() => { assert.equal(mask.scope.leftHand, true); assert.equal(mask.scope.rightHand, false); });
check(() => { assert.equal(mask.scope.leftContact, true); assert.equal(mask.scope.fullBody, true); });
check(() => assert.deepEqual(mask.scopeReasons.calibration.at(-1), "native_joint_confidence_unavailable"));
check(() => assert.equal(mask.warningCodes.includes("native_joint_confidence_unavailable"), true));
check(() => { const tampered = structuredClone(mask); tampered.scope.fullBody = false; assert.notDeepEqual(tampered, mask); });
check(() => { const tampered = structuredClone(mask); tampered.scope.leftArm = false; tampered.scopeReasons.leftArm = ["manual_head_unobservable"]; assert.notDeepEqual(tampered, mask); });
check(() => {
  const points = structuredClone(smoothWindow[2].raw.persons[0].keypoints_mhr70_3d); points[5] = [-0.005, 0.5, 0]; points[6] = [0.005, 0.5, 0];
  const facts = torsoBasisFacts(points, core.teacherPolicy); assert.equal(Number.isFinite(facts.cross), true); assert.equal(facts.valid, false);
});
check(() => {
  const points = structuredClone(smoothWindow[2].raw.persons[0].keypoints_mhr70_3d); points[5] = [-0.01, 0.5, 0]; points[6] = [0.01, 0.5, 0];
  assert.equal(torsoBasisFacts(points, core.teacherPolicy).valid, true);
});
check(() => {
  const entry = structuredClone(smoothWindow[2]); const points = entry.raw.persons[0].keypoints_mhr70_3d;
  for (const index of [5, 7, 62]) points[index][0] -= 1; for (const index of [6, 8, 41]) points[index][0] += 1;
  const result = expectedMaskRow(entry, manualLabel, clipScale, null, core);
  assert.equal(Number.isFinite(result.diagnostics.frameScaleM), true); assert.equal(result.diagnostics.tenMajorSegmentLengthsM[8] > core.teacherPolicy.thresholds.max_segment_m, true);
});
for (const [joint, affected, unaffected] of [[0, "head", "leftArm"], [42, "leftHand", "rightArm"], [15, "leftLeg", "head"]]) check(() => {
  const predecessor = syntheticEntry(1); const current = syntheticEntry(2); current.raw.persons[0].keypoints_mhr70_3d[joint][0] = Infinity;
  const result = expectedMaskRow(current, manualLabel, clipScale, predecessor, core);
  assert.equal(result.scopeReasons[affected].includes("temporal_reference_unavailable"), true);
  assert.equal(result.scopeReasons[unaffected].includes("temporal_reference_unavailable"), false);
  assert.equal(result.diagnostics.maxRootRelativeJointSpeedMps[affected], null);
  assert.equal(Number.isFinite(result.diagnostics.maxRootRelativeJointSpeedMps[unaffected]), true);
});

const id30 = (frame, ticks) => ({ clipId: "x", sourceFrameIndex: frame, ptsTicks: String(ticks), timeBase: { numerator: 1, denominator: 30 } });
const id5994 = (frame, ticks) => ({ clipId: "x", sourceFrameIndex: frame, ptsTicks: String(ticks), timeBase: { numerator: 1, denominator: 60000 } });
check(() => assert.equal(contactStableConfirmed(id30(0, 0), id30(2, 2)), false));
check(() => assert.equal(contactStableConfirmed(id30(0, 0), id30(3, 3)), true));
check(() => assert.equal(contactStableConfirmed(id5994(0, 0), id5994(5, 5005)), false));
check(() => assert.equal(contactStableConfirmed(id5994(0, 0), id5994(6, 6006)), true));

check(() => assert.equal(validDescriptorPath("teacher-mask-v2.jsonl"), true));
for (const invalid of ["/absolute", "../escape", "a/../b", "a/./b", "a//b", "a\\b", ""]) check(() => assert.equal(validDescriptorPath(invalid), false));
check(() => assert.deepEqual(parseArgs(["--label-dir", "x", "--phase", "p0-candidate"]).phase, "p0-candidate"));
check(() => throwsCode(() => parseArgs(["--label-dir", "x", "--phase", "p0-candidate", "--p0-anchor", "x"]), "phase_argument_set_invalid"));
check(() => assert.equal(parseArgs(["--label-dir", "x", "--phase", "p0", "--p0-anchor", "a", "--expected-p0-anchor-sha256", "a".repeat(64), "--review-a", "ra", "--review-b", "rb", "--adjudication", "ad"]).reviewA, "ra"));
check(() => throwsCode(() => parseArgs(["--label-dir", "x", "--phase", "p1", "--p0-anchor", "x", "--expected-p0-anchor-sha256", "a".repeat(64)]), "phase_argument_set_invalid"));
check(() => throwsCode(() => parseArgs(["--label-dir", "never-open", "--phase", "p1", "--p0-anchor", "x", "--expected-p0-anchor-sha256", "a".repeat(64), "--p1-anchor", "y", "--expected-p1-anchor-sha256", "b".repeat(64), "--review-a", "must-not-open"]), "phase_argument_set_invalid"));
check(() => throwsCode(() => validateAuditOptions({ labelDir: "never-open", phase: "p1", p0Anchor: "x", expectedP0: "a".repeat(64), p1Anchor: "y", expectedP1: "b".repeat(64), reviewA: "must-not-open" }), "phase_argument_set_invalid"));
check(() => throwsCode(() => parseArgs(["--label-dir", "x", "--phase", "p0", "--expected-p0-lock-sha256", "a".repeat(64)]), "unknown_argument"));
check(() => throwsCode(() => parseArgs(["--label-dir", "x", "--label-dir", "y", "--phase", "p0-candidate"]), "duplicate_argument"));

const rawSchemaSample = structuredClone(smoothWindow[0].raw);
check(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.rawFrame, rawSchemaSample, "raw"));
check(() => { const attacked = structuredClone(rawSchemaSample); delete attacked.persons[0].mhr_joint_coords_127_3d; throwsCode(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.rawFrame, attacked, "raw"), "schema_validation"); });
check(() => { const attacked = structuredClone(rawSchemaSample); attacked.persons[0].detector_bbox_xyxy = "invalid-but-policy-audited"; validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.rawFrame, attacked, "raw"); });
check(() => { const attacked = structuredClone(rawSchemaSample); attacked.persons[0].joint_confidence = 0.9; throwsCode(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.rawFrame, attacked, "raw"), "schema_validation"); });
check(() => { const attacked = structuredClone(armsDataset); attacked.detectorScore = 0.9; throwsCode(() => validateSchemaValue(core.teacherSchema, core.teacherSchema.$defs.datasetRow, attacked, "dataset"), "schema_validation"); });

check(() => assert.equal(JSON.stringify(core.teacherInventory).includes("evaluation-contract"), false));
check(() => assert.equal(JSON.stringify(core.teacherInventory).includes(core.hashes.contract), false));
check(() => assert.equal(JSON.stringify(core.teacherPolicy).includes(core.hashes.contract), false));
check(() => assert.equal(core.contract.requiredDownstreamMigration.historicalCompilerR2Compatible, false));
check(() => assert.equal(core.contract.requiredDownstreamMigration.requiredBeforeRealP0, true));
check(() => assert.equal(core.contract.phaseLocks.p1Parent, "external_p0_anchor_canonical_hash"));
check(() => assert.equal(core.contract.phaseLocks.candidatePackHashAsParentForbidden, true));
check(() => assert.deepEqual(core.contract.phaseLocks.p1PackMustExclude, ["evaluation-lock-p1.json", "external-p1-anchor.json"]));
check(() => assert.equal(core.contract.phaseLocks.p0Artifacts.includes("teacherInputInventory"), true));
check(() => assert.equal(core.contract.phaseLocks.p0Artifacts.includes("manualCompiler"), true));
check(() => assert.equal(core.contract.phaseLocks.p1CompiledArtifacts.length, 7));
const attackCatalog = JSON.parse(readFileSync(path.join(V3, "audit-fixtures/attack-cases.json"), "utf8"));
const ATTACK_CLASSIFICATIONS = new Set(["non-rehash-selection-math", "public-authority", "public-authority-observation", "public-authority-race", "public-authority-rehash", "public-baseline", "public-cli-argument-contract", "public-cli-authoring-contract", "public-cli-baseline", "public-input-format", "semantic-rehash"]);
const ATTACK_SURFACES = new Set(["anchor", "authoring", "cli", "dataset", "descriptor", "durable-artifact", "manual", "mask", "p0", "p1", "policy", "public-api", "raw-schema", "refinement", "selection", "source-manifest", "summary", "teacher-input"]);
check(() => assert.equal(attackCatalog.artifactType, "sam-goal-v3-audit-attack-catalog"));
check(() => assert.equal(attackCatalog.schemaVersion, 2));
check(() => assert.deepEqual(Object.keys(attackCatalog).sort(), ["$schema", "artifactType", "cases", "materializesRealP0OrP1", "schemaVersion"].sort()));
check(() => assert.equal(attackCatalog.materializesRealP0OrP1, false));
check(() => assert.equal(new Set(attackCatalog.cases.map((entry) => entry.caseId)).size, attackCatalog.cases.length));
check(() => assert.equal(attackCatalog.cases.length >= 59, true));
check(() => assert.equal(attackCatalog.cases.some((entry) => entry.caseId === "live-student-avatar-leakage"), true));
check(() => attackCatalog.cases.forEach((entry) => {
  const expectedKeys = ["caseId", "classification", "executionPath", "expectedOutcome", "surface", ...(entry.expectedOutcome === "error" ? ["errorCode"] : [])];
  assert.deepEqual(Object.keys(entry).sort(), expectedKeys.sort(), `${entry.caseId} catalog keys drift`);
  assert.equal(typeof entry.caseId, "string");
  assert.equal(ATTACK_SURFACES.has(entry.surface), true, `${entry.caseId} surface invalid`);
  assert.equal(ATTACK_CLASSIFICATIONS.has(entry.classification), true, `${entry.caseId} classification invalid`);
  if (entry.expectedOutcome === "pass") assert.equal(Object.hasOwn(entry, "errorCode"), false, `${entry.caseId} pass oracle must not declare errorCode`);
  else { assert.equal(entry.expectedOutcome, "error", `${entry.caseId} expectedOutcome invalid`); assert.equal(typeof entry.errorCode, "string", `${entry.caseId} errorCode missing`); assert.equal(entry.errorCode.length > 0, true); }
  assert.equal(["cli", "runAudit", "helper"].includes(entry.executionPath), true, `${entry.caseId} executionPath invalid`);
  if (entry.executionPath === "helper") assert.equal(entry.classification.startsWith("non-rehash-"), true, `${entry.caseId} helper path must be explicitly non-rehash`);
  if (entry.classification === "semantic-rehash" || entry.classification.startsWith("public-input") || entry.classification.startsWith("public-authority")) assert.equal(entry.executionPath, "runAudit", `${entry.caseId} public semantic/authority path must be runAudit`);
}));

const schemaPaths = ["label-schema.json", "teacher-schema.json", "p0-lock-anchor-v2-schema.json", "p1-lock-anchor-schema.json"].map((name) => path.join(V3, name));
const draft = spawnSync("python3", ["-c", "import json,sys\nfrom jsonschema import Draft202012Validator\nfor p in sys.argv[1:]: Draft202012Validator.check_schema(json.load(open(p,encoding='utf-8')))\nprint(len(sys.argv)-1)", ...schemaPaths], { cwd: ROOT, encoding: "utf8" });
check(() => assert.equal(draft.status, 0, draft.stderr || draft.stdout));
check(() => assert.equal(Number(draft.stdout.trim()), 4));

function buildAndAuditClosedChain() {
  const packDir = path.join(fixtureRuntime, "pack"); const sealedDir = path.join(fixtureRuntime, "sealed"); mkdirSync(packDir); mkdirSync(sealedDir);
  const fixtureAuthoring = "tests/fixtures/sam-goal-v2/evaluation-v3/audit-fixtures/synthetic-authoring-schema.json";
  const fixtureCompiler = "tests/fixtures/sam-goal-v2/evaluation-v3/audit-fixtures/synthetic-manual-compiler.txt";
  const fixtureMaterializer = "tests/fixtures/sam-goal-v2/evaluation-v3/audit-fixtures/synthetic-teacher-materializer.txt";
  const p0Policy = {
    evaluationContract: ["tests/fixtures/sam-goal-v2/evaluation-v3/evaluation-contract.json", true],
    labelSchema: ["tests/fixtures/sam-goal-v2/evaluation-v3/label-schema.json", true], authoringSchema: [fixtureAuthoring, true],
    teacherInputInventory: ["tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json", true], teacherPolicy: ["tests/fixtures/sam-goal-v2/evaluation-v3/teacher-policy.json", true],
    teacherSchema: ["tests/fixtures/sam-goal-v2/evaluation-v3/teacher-schema.json", true], p0AnchorSchema: ["tests/fixtures/sam-goal-v2/evaluation-v3/p0-lock-anchor-v2-schema.json", true],
    p1AnchorSchema: ["tests/fixtures/sam-goal-v2/evaluation-v3/p1-lock-anchor-schema.json", true], sourceInventory: ["tests/fixtures/sam-goal-v2/labels/source-inventory.json", true],
    decoderManifest: ["tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl", false], manualWindows: ["manual-windows.json", true], manualLabels: ["manual-labels.jsonl", false],
    manualSubjectSelection: ["manual-subject-selection.jsonl", false], manualReviewPassA: ["manual-review-pass1.jsonl", false], manualReviewPassB: ["manual-review-pass2.jsonl", false],
    manualAdjudication: ["manual-adjudication.jsonl", false], manualPolicy: ["manual-policy.json", true], manualSummary: ["manual-summary.json", true],
    manualCompiler: [fixtureCompiler, false], labelAuditor: ["scripts/sam-goal-label-audit-v3.mjs", false],
  };
  const reviewerA = "a".repeat(64); const reviewerB = "b".repeat(64); const adjudicator = "c".repeat(64);
  const isAbsent = (row) => (row.clipId === "arms-crossed" && ((row.sourceFrameIndex >= 50 && row.sourceFrameIndex < 59) || (row.sourceFrameIndex >= 150 && row.sourceFrameIndex < 159))) || (row.clipId === "csi-pose" && row.sourceFrameIndex >= 50 && row.sourceFrameIndex < 59);
  const labels = []; const subjects = []; const reviewsA = []; const reviewsB = [];
  for (const [index, row] of core.decoderRows.entries()) {
    const absent = isAbsent(row); const phase = Math.floor(row.sourceFrameIndex / 400) % 2; const leftContact = phase === 0 ? "planted" : "moving"; const rightContact = phase === 0 ? "moving" : "planted";
    const scenarios = [absent ? "entry_exit" : "neutral"];
    const label = {
      artifactType: "manual-label-v2", labelId: `synthetic-${index}`, span: { kind: "frame", identity: manualIdentity(row) }, scenarios,
      presence: absent ? "absent" : "present", personState: absent ? "absent" : "single_target",
      occlusion: absent ? { body: "out_of_frame", leftFoot: "out_of_frame", rightFoot: "out_of_frame", leftHand: "out_of_frame", rightHand: "out_of_frame" } : { body: "observable", leftFoot: "observable", rightFoot: "observable", leftHand: "observable", rightHand: "observable" },
      contact: absent ? { left: "unknown", right: "unknown" } : { left: leftContact, right: rightContact },
      handObservability: absent ? { left: "not_observable", right: "not_observable" } : { left: "observable", right: "observable" },
      endpointObservability: absent ? { leftWrist: "not_observable", rightWrist: "not_observable", leftAnkle: "not_observable", rightAnkle: "not_observable", head: "not_observable" } : { leftWrist: "observable", rightWrist: "observable", leftAnkle: "observable", rightAnkle: "observable", head: "observable" },
      provenance: { origin: "manual_video", reviewStatus: "adjudicated" },
    };
    const subject = { artifactType: "manual-subject-selection-v2", selectionId: `synthetic-subject-${index}`, span: { kind: "frame", identity: manualIdentity(row) }, state: absent ? "absent" : "selected", manualTargetId: absent ? null : `target-${row.clipId}`, anchor: null, evidence: "manual_video" };
    const state = { presence: label.presence, personState: label.personState, occlusion: label.occlusion, contact: label.contact, handObservability: label.handObservability, endpointObservability: label.endpointObservability, subjectSelection: { state: subject.state, manualTargetId: subject.manualTargetId, anchor: subject.anchor } };
    labels.push(label); subjects.push(subject);
    reviewsA.push({ artifactType: "manual-review-v2", pass: "first", reviewerHash: reviewerA, identity: manualIdentity(row), reviewed: true, origin: "manual", state, scenarios });
    reviewsB.push({ artifactType: "manual-review-v2", pass: "second", reviewerHash: reviewerB, identity: manualIdentity(row), reviewed: true, origin: "manual", state, scenarios });
  }
  const windows = withSelfHash({ artifactType: "manual-windows-v2", schemaVersion: 2, windows: core.contract.sourceBinding.paired.map((clip) => ({ windowId: `base-${clip.clipId}`, clipId: clip.clipId, startPtsTicks: clip.startPtsTicks, endPtsTicksExclusive: clip.endPtsTicksExclusive, expectedDecoderRows: clip.rows, purposeTags: ["full_clip_denominator"], scenarioTags: ["neutral"] })) });
  const manualPolicy = withSelfHash({ artifactType: "manual-policy-v2", schemaVersion: 2, contractCanonicalSha256: core.hashes.contract, schemaCanonicalSha256: core.hashes.labelSchema, reviewerHashes: { first: reviewerA, second: reviewerB, adjudicator }, thresholds: { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95, preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2 } });
  const manualSummary = withSelfHash({ artifactType: "manual-summary-v2", schemaVersion: 2, decoderRows: 6711, materializedManualRows: 6711, materializedSubjectRows: 6711, reviewPass1Rows: 6711, reviewPass2Rows: 6711, perClip: core.contract.sourceBinding.paired.map((clip) => ({ clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows })) });
  const manualFiles = { manualWindows: ["manual-windows.json", windows, "json"], manualLabels: ["manual-labels.jsonl", labels, "jsonl"], manualSubjectSelection: ["manual-subject-selection.jsonl", subjects, "jsonl"], manualReviewPassA: ["manual-review-pass1.jsonl", reviewsA, "jsonl"], manualReviewPassB: ["manual-review-pass2.jsonl", reviewsB, "jsonl"], manualAdjudication: ["manual-adjudication.jsonl", [], "jsonl"], manualPolicy: ["manual-policy.json", manualPolicy, "json"], manualSummary: ["manual-summary.json", manualSummary, "json"] };
  for (const [, [name, value, kind]] of Object.entries(manualFiles)) kind === "json" ? writeStableJson(path.join(packDir, name), value) : writeStableJsonl(path.join(packDir, name), value);
  const p0Files = {};
  for (const [key, [descriptorPath, canonical]] of Object.entries(p0Policy)) {
    const filePath = descriptorPath.startsWith("tests/") || descriptorPath.startsWith("scripts/") ? path.join(ROOT, descriptorPath) : path.join(packDir, descriptorPath);
    p0Files[key] = descriptor(filePath, descriptorPath, canonical);
  }
  const p0Manifest = withSelfHash({ artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p0-candidate", files: p0Files });
  writeStableJson(path.join(packDir, "evaluation-pack.json"), p0Manifest);
  const p0 = auditP0Candidate(packDir, core, teacher, { p0DescriptorPolicy: p0Policy });

  const sealed = ["review-a.json", "review-b.json", "adjudication.json"];
  const sealedValues = [
    withSelfHash({ artifactType: "sam-goal-manual-review-v3", schemaVersion: 3, role: "first", reviewerPseudonymSha256: reviewerA, fixtureNonce: 1 }),
    withSelfHash({ artifactType: "sam-goal-manual-review-v3", schemaVersion: 3, role: "second", reviewerPseudonymSha256: reviewerB, fixtureNonce: 2 }),
    withSelfHash({ artifactType: "sam-goal-manual-adjudication-v3", schemaVersion: 3, role: "adjudication", adjudicatorPseudonymSha256: adjudicator, fixtureNonce: 3 }),
  ];
  sealed.forEach((name, index) => writeStableJson(path.join(sealedDir, name), sealedValues[index]));
  const compiledP0 = [["evaluation-pack.json", path.join(packDir, "evaluation-pack.json")], ...Object.values(manualFiles).map(([name]) => [name, path.join(packDir, name)])].map(([name, filePath]) => descriptor(filePath, name)).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const p0AnchorValue = withSelfHash({
    artifactType: "sam-goal-p0-external-anchor", schemaVersion: 2, candidateP0PackCanonicalSha256: p0.manifestHash,
    evaluationPack: descriptor(path.join(packDir, "evaluation-pack.json"), "evaluation-pack.json", true), compiledArtifacts: compiledP0, compiledArtifactSetSha256: canonicalHash(compiledP0),
    dependencies: { evaluationContractCanonicalSha256: core.hashes.contract, labelSchemaCanonicalSha256: core.hashes.labelSchema, authoringSchemaCanonicalSha256: p0Files.authoringSchema.canonicalSha256, teacherInputInventoryCanonicalSha256: core.hashes.teacherInventory, teacherPolicyCanonicalSha256: core.hashes.teacherPolicy, teacherSchemaCanonicalSha256: core.hashes.teacherSchema, p0AnchorSchemaCanonicalSha256: core.hashes.p0AnchorSchema, p1AnchorSchemaCanonicalSha256: core.hashes.p1AnchorSchema, sourceInventoryCanonicalSha256: core.hashes.sourceInventory, decoderByteSha256: core.decoderSnapshot.byteSha256, decoderCanonicalRowsSha256: canonicalHash(core.decoderRows), manualCompilerByteSha256: p0Files.manualCompiler.byteSha256, labelAuditorByteSha256: p0Files.labelAuditor.byteSha256 },
    sealedInputs: {
      reviewA: { role: "first", logicalPath: "sealed/review-a.json", actorPseudonymSha256: reviewerA, byteSha256: sha256(readFileSync(path.join(sealedDir, sealed[0]))) },
      reviewB: { role: "second", logicalPath: "sealed/review-b.json", actorPseudonymSha256: reviewerB, byteSha256: sha256(readFileSync(path.join(sealedDir, sealed[1]))) },
      adjudication: { role: "adjudication", logicalPath: "sealed/adjudication.json", actorPseudonymSha256: adjudicator, byteSha256: sha256(readFileSync(path.join(sealedDir, sealed[2]))) },
    },
  });
  const p0AnchorPath = path.join(fixtureRuntime, "p0-anchor.json"); writeStableJson(p0AnchorPath, p0AnchorValue);
  const p0Anchor = verifyP0Anchor({ phase: "p0", p0Anchor: p0AnchorPath, expectedP0: p0AnchorValue.expectedCanonicalHash, reviewA: path.join(sealedDir, sealed[0]), reviewB: path.join(sealedDir, sealed[1]), adjudication: path.join(sealedDir, sealed[2]) }, p0, core);
  assert.equal(p0Anchor.sealed.reviewA.value.artifactType, "sam-goal-manual-review-v3");
  assert.equal(p0Anchor.sealed.reviewA.value.schemaVersion, 3);
  assert.equal(p0Anchor.sealed.adjudication.value.artifactType, "sam-goal-manual-adjudication-v3");

  const datasetRows = []; const datasetEntries = [];
  for (const decoder of core.decoderRows) {
    const input = teacher.rowsByClip.get(decoder.clipId); const lineIndex = decoder.sourceFrameIndex; const raw = input.rows[lineIndex]; const provenance = teacher.provenanceByClip.get(decoder.clipId)[lineIndex]; const subject = p0.manual.subjects.get(`${decoder.clipId}\u0000${decoder.sourceFrameIndex}\u0000${decoder.ptsTicks}\u0000${decoder.timeBase.numerator}/${decoder.timeBase.denominator}\u00000`);
    const row = expectedDatasetRow(decoder, raw, input.lines[lineIndex], lineIndex, provenance, subject, core.teacherPolicy);
    datasetRows.push(row); datasetEntries.push({ decoder, raw, provenance, subject, selection: row.derivedSelection, row });
  }
  const datasetPath = path.join(packDir, "teacher-dataset-v2.jsonl"); writeStableJsonl(datasetPath, datasetRows);
  const refinedRows = datasetEntries.map((_entry, index) => deriveRefinedRow(index, datasetEntries, core.teacherPolicy));
  const refinedPath = path.join(packDir, "teacher-refined.jsonl"); writeStableJsonl(refinedPath, refinedRows);
  const datasetArtifact = { rows: datasetEntries, byteSha256: sha256(readFileSync(datasetPath)) };
  const scales = clipScales(datasetArtifact, core); const previous = new Map(); const maskRows = [];
  for (const entry of datasetEntries) {
    const targetKey = `${entry.decoder.clipId}\u0000${entry.selection.selectedTrackId ?? ""}`; const predecessor = entry.selection.selectedTrackId === null ? null : previous.get(targetKey) || null;
    const key = `${entry.decoder.clipId}\u0000${entry.decoder.sourceFrameIndex}\u0000${entry.decoder.ptsTicks}\u0000${entry.decoder.timeBase.numerator}/${entry.decoder.timeBase.denominator}\u00000`;
    maskRows.push(expectedMaskRow(entry, p0.manual.labels.get(key), scales.get(entry.decoder.clipId), predecessor, core));
    if (entry.provenance.state === "detector_hit" && entry.selection.rawPersonIndex !== null) previous.set(targetKey, entry);
  }
  const maskPath = path.join(packDir, "teacher-mask-v2.jsonl"); writeStableJsonl(maskPath, maskRows);
  const sourceManifestValue = expectedSourceManifest(p0Anchor.hash, p0, core); const sourceManifestPath = path.join(packDir, "teacher-source-manifest.json"); writeStableJson(sourceManifestPath, sourceManifestValue);
  const refinedArtifact = { rows: refinedRows, byteSha256: sha256(readFileSync(refinedPath)) }; const maskArtifact = { rows: maskRows, byteSha256: sha256(readFileSync(maskPath)) }; const sourceManifest = { hash: sourceManifestValue.expectedCanonicalHash };
  const summaryValue = expectedTeacherSummary(p0Anchor.hash, sourceManifest, datasetArtifact, refinedArtifact, maskArtifact, p0, core); const summaryPath = path.join(packDir, "teacher-summary.json"); writeStableJson(summaryPath, summaryValue);

  const p1NewPolicy = { teacherSourceManifest: ["teacher-source-manifest.json", true], teacherDataset: ["teacher-dataset-v2.jsonl", false], teacherRefined: ["teacher-refined.jsonl", false], teacherMask: ["teacher-mask-v2.jsonl", false], teacherSummary: ["teacher-summary.json", true], teacherMaterializer: [fixtureMaterializer, false] };
  const inherited = { evaluationContract: "evaluationContract", labelSchema: "labelSchema", teacherInputInventory: "teacherInputInventory", teacherPolicy: "teacherPolicy", teacherSchema: "teacherSchema", p0AnchorSchema: "p0AnchorSchema", p1AnchorSchema: "p1AnchorSchema", sourceInventory: "sourceInventory", decoderManifest: "decoderManifest", labelAuditor: "labelAuditor" };
  const p1Files = {
    p0Pack: structuredClone(p0AnchorValue.evaluationPack),
    externalP0Anchor: { logicalPath: "anchors/p0.json", canonicalSha256: p0AnchorValue.expectedCanonicalHash, byteSha256: sha256(readFileSync(p0AnchorPath)) },
    ...Object.fromEntries(Object.entries(inherited).map(([p1Key, p0Key]) => [p1Key, structuredClone(p0Manifest.files[p0Key])])),
  };
  for (const [key, [descriptorPath, canonical]] of Object.entries(p1NewPolicy)) {
    const filePath = descriptorPath.startsWith("tests/") || descriptorPath.startsWith("scripts/") ? path.join(ROOT, descriptorPath) : path.join(packDir, descriptorPath);
    p1Files[key] = descriptor(filePath, descriptorPath, canonical);
  }
  const p1Manifest = withSelfHash({ artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p1-candidate", parentP0AnchorSha256: p0Anchor.hash, targetRole: "raw_hard_refined_watch", files: p1Files });
  const p1ManifestPath = path.join(packDir, "evaluation-pack-p1.json"); writeStableJson(p1ManifestPath, p1Manifest);
  const p1Lock = withSelfHash({ artifactType: "evaluation-lock-v2", schemaVersion: 2, phase: "p1-candidate", parentP0AnchorSha256: p0Anchor.hash, p1PackCanonicalSha256: p1Manifest.expectedCanonicalHash, targetRole: "raw_hard_refined_watch", teacherInputInventoryCanonicalSha256: core.hashes.teacherInventory, teacherSourceManifestCanonicalSha256: sourceManifestValue.expectedCanonicalHash, teacherDatasetByteSha256: datasetArtifact.byteSha256, teacherRefinedByteSha256: refinedArtifact.byteSha256, teacherMaskByteSha256: maskArtifact.byteSha256, teacherSummaryCanonicalSha256: summaryValue.expectedCanonicalHash, teacherPolicyCanonicalSha256: core.hashes.teacherPolicy, teacherMaterializerByteSha256: p1Files.teacherMaterializer.byteSha256, labelAuditorByteSha256: p1Files.labelAuditor.byteSha256 });
  const p1LockPath = path.join(packDir, "evaluation-lock-p1.json"); writeStableJson(p1LockPath, p1Lock);
  const p1 = auditP1Candidate({}, p0, p0Anchor, core, { p1NewDescriptorPolicy: p1NewPolicy });
  const compiledP1 = [["evaluation-pack-p1.json", p1ManifestPath], ["evaluation-lock-p1.json", p1LockPath], ["teacher-source-manifest.json", sourceManifestPath], ["teacher-dataset-v2.jsonl", datasetPath], ["teacher-refined.jsonl", refinedPath], ["teacher-mask-v2.jsonl", maskPath], ["teacher-summary.json", summaryPath]].map(([name, filePath]) => descriptor(filePath, name)).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
  const p1AnchorValue = withSelfHash({ artifactType: "sam-goal-p1-external-anchor", schemaVersion: 1, parentP0AnchorSha256: p0Anchor.hash, candidateP1LockCanonicalSha256: p1.lockHash, targetRole: "raw_hard_refined_watch", evaluationPackP1: descriptor(p1ManifestPath, "evaluation-pack-p1.json", true), p1Lock: descriptor(p1LockPath, "evaluation-lock-p1.json", true), teacherArtifacts: { inputInventory: descriptor(path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json"), "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json", true), sourceManifest: descriptor(sourceManifestPath, "teacher-source-manifest.json", true), dataset: descriptor(datasetPath, "teacher-dataset-v2.jsonl"), refined: descriptor(refinedPath, "teacher-refined.jsonl"), mask: descriptor(maskPath, "teacher-mask-v2.jsonl"), summary: descriptor(summaryPath, "teacher-summary.json", true) }, compiledArtifacts: compiledP1, compiledArtifactSetSha256: canonicalHash(compiledP1), dependencies: { evaluationContractCanonicalSha256: core.hashes.contract, teacherInputInventoryCanonicalSha256: core.hashes.teacherInventory, teacherPolicyCanonicalSha256: core.hashes.teacherPolicy, teacherSchemaCanonicalSha256: core.hashes.teacherSchema, p0AnchorSchemaCanonicalSha256: core.hashes.p0AnchorSchema, p1AnchorSchemaCanonicalSha256: core.hashes.p1AnchorSchema, teacherMaterializerByteSha256: p1Files.teacherMaterializer.byteSha256, labelAuditorByteSha256: p1Files.labelAuditor.byteSha256 } });
  const p1AnchorPath = path.join(fixtureRuntime, "p1-anchor.json"); writeStableJson(p1AnchorPath, p1AnchorValue);
  const p1Anchor = verifyP1Anchor({ p1Anchor: p1AnchorPath, expectedP1: p1AnchorValue.expectedCanonicalHash }, p0, p0Anchor, p1, core);
  return { p0, p0Anchor, p1, p1Anchor, packDir, sealedDir, sealedPaths: sealed.map((name) => path.join(sealedDir, name)), sealedValues, p0Policy, p1NewPolicy, paths: { datasetPath, refinedPath, maskPath, sourceManifestPath, summaryPath, p1ManifestPath, p1LockPath, p0AnchorPath, p1AnchorPath }, values: { p0Manifest, p0AnchorValue, p1Manifest, p1Lock, p1AnchorValue, sourceManifestValue, summaryValue }, artifacts: { datasetRows, refinedRows, maskRows } };
}

function runClosedChainAttacks(chain) {
  const executed = new Set();
  const observedPaths = new Map();
  const requestedCaseIds = process.env.SAM_V3_ATTACK_CASES ? new Set(process.env.SAM_V3_ATTACK_CASES.split(",").filter(Boolean)) : null;
  if (requestedCaseIds) for (const id of requestedCaseIds) assert.equal(attackCatalog.cases.some((entry) => entry.caseId === id), true, `unknown selected attack case:${id}`);
  let activeCase = null;
  const catalogById = new Map(attackCatalog.cases.map((entry) => [entry.caseId, entry]));
  const observePath = (executionPath) => {
    assert.ok(activeCase, "execution path observed outside an active case");
    if (!observedPaths.has(activeCase)) observedPaths.set(activeCase, []);
    observedPaths.get(activeCase).push(executionPath);
  };
  const viaHelper = (fn) => { observePath("helper"); return fn(); };
  const viaRunAudit = (options, hooks) => { observePath("runAudit"); return runAudit(options, hooks); };
  const exercise = (id, fn) => {
    assert.equal(Array.isArray(id), false, "one catalog case must map to exactly one independent mutation");
    if (requestedCaseIds && !requestedCaseIds.has(id)) return;
    const definition = catalogById.get(id);
    assert.ok(definition, `attack missing from catalog: ${id}`);
    assert.ok(["runAudit", "cli", "helper"].includes(definition.executionPath), `executionPath missing or invalid: ${id}`);
    assert.ok(definition.expectedOutcome === "pass" || (definition.expectedOutcome === "error" && typeof definition.errorCode === "string" && definition.errorCode.length > 0), `invalid catalog oracle: ${id}`);
    activeCase = id;
    let actual;
    try {
      const returned = fn();
      if (!returned || typeof returned !== "object" || !Object.hasOwn(returned, "expectedOutcome")) actual = { expectedOutcome: "pass" };
      else {
        assert.ok(returned.expectedOutcome === "pass" || (returned.expectedOutcome === "error" && typeof returned.errorCode === "string" && returned.errorCode.length > 0), "exercise returned an invalid outcome");
        actual = returned;
      }
    } catch (error) {
      actual = { expectedOutcome: "error", errorCode: String(error.message || error).split(":", 1)[0] };
    } finally {
      activeCase = null;
    }
    const paths = observedPaths.get(id) || [];
    assert.deepEqual(paths, [definition.executionPath], `${id} must observe exactly one matching execution path`);
    assert.equal(actual.expectedOutcome, definition.expectedOutcome, `${definition.caseId} expected ${definition.expectedOutcome} but got ${actual.expectedOutcome}${actual.errorCode ? `:${actual.errorCode}` : ""}`);
    if (definition.expectedOutcome === "error") assert.equal(actual.errorCode, definition.errorCode, `${definition.caseId} exact errorCode drift`);
    executed.add(definition.caseId);
  };
  const testHooks = { syntheticOnly: true, testFixtureMode: "evaluation-v3-runtime-test", p0DescriptorPolicy: chain.p0Policy, p1NewDescriptorPolicy: chain.p1NewPolicy };
  const p0AuditOptions = { labelDir: chain.packDir, phase: "p0", p0Anchor: chain.paths.p0AnchorPath, expectedP0: chain.p0Anchor.hash, reviewA: chain.sealedPaths[0], reviewB: chain.sealedPaths[1], adjudication: chain.sealedPaths[2] };
  const p1AuditOptions = { labelDir: chain.packDir, phase: "p1", p0Anchor: chain.paths.p0AnchorPath, expectedP0: chain.p0Anchor.hash, p1Anchor: chain.paths.p1AnchorPath, expectedP1: chain.p1Anchor.hash };
  const p0CliArgs = (overrides = {}) => {
    const options = { ...p0AuditOptions, ...overrides };
    return ["--label-dir", options.labelDir, "--phase", "p0", "--p0-anchor", options.p0Anchor, "--expected-p0-anchor-sha256", options.expectedP0, "--review-a", options.reviewA, "--review-b", options.reviewB, "--adjudication", options.adjudication];
  };
  const p1CliArgs = (overrides = {}) => {
    const options = { ...p1AuditOptions, ...overrides };
    return ["--label-dir", options.labelDir, "--phase", "p1", "--p0-anchor", options.p0Anchor, "--expected-p0-anchor-sha256", options.expectedP0, "--p1-anchor", options.p1Anchor, "--expected-p1-anchor-sha256", options.expectedP1];
  };
  const runCli = (args, expectedPhase) => {
    observePath("cli");
    const child = spawnSync(process.execPath, [AUDIT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: "test", SAM_GOAL_V3_SYNTHETIC_AUDIT: "1" },
      timeout: 600_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (child.error) throw child.error;
    let payload;
    try { payload = JSON.parse(child.stdout); } catch (error) { throw new Error(`cli_output_invalid:${error.message}:${child.stdout.slice(0, 500)}:${child.stderr.slice(0, 500)}`); }
    if (child.status === 0) {
      assert.equal(payload.status, "passed", `CLI ${expectedPhase} success payload status drift`);
      assert.equal(payload.phase, expectedPhase, `CLI success phase drift`);
      assert.equal(payload.syntheticOnly, true, "CLI synthetic disclosure missing");
      assert.equal(payload.testFixtureMode, "evaluation-v3-runtime-test", "CLI fixture-mode disclosure drift");
      return { expectedOutcome: "pass" };
    }
    assert.equal(child.status, 1, `CLI unexpected exit status ${child.status}: ${child.stderr}`);
    assert.equal(payload.status, "failed", "CLI failure payload status drift");
    assert.equal(payload.phase, expectedPhase, "CLI failure phase drift");
    assert.equal(Array.isArray(payload.errors), true, "CLI failure errors missing");
    assert.equal(typeof payload.errors[0]?.code, "string", "CLI failure errorCode missing");
    return { expectedOutcome: "error", errorCode: payload.errors[0].code };
  };
  exercise("public-run-audit-p0-v3-authoring", () => {
    const report = viaRunAudit(p0AuditOptions, testHooks); assert.equal(report.status, "passed"); assert.equal(report.phase, "p0"); assert.equal(report.syntheticOnly, true);
  });
  exercise("public-run-audit-full-chain", () => {
    const report = viaRunAudit(p1AuditOptions, testHooks); assert.equal(report.status, "passed"); assert.equal(report.phase, "p1"); assert.equal(report.syntheticOnly, true);
  });
  exercise("public-cli-p0-v3-authoring", () => runCli(p0CliArgs(), "p0"));
  exercise("public-cli-full-chain", () => runCli(p1CliArgs(), "p1"));
  const rehash = (value) => withSelfHash(structuredClone(value));
  const replaceJsonlRow = (filePath, rowIndex, row) => {
    const source = readFileSync(filePath); let start = 0; let current = 0; let end = -1;
    for (let index = 0; index < source.length; index += 1) if (source[index] === 0x0a) { if (current === rowIndex) { end = index; break; } current += 1; start = index + 1; }
    if (end < 0) throw new Error(`row_not_found:${rowIndex}`);
    return Buffer.concat([source.subarray(0, start), Buffer.from(stableStringify(row)), source.subarray(end)]);
  };
  const replaceJsonlRowText = (filePath, rowIndex, text) => {
    const source = readFileSync(filePath); let start = 0; let current = 0; let end = -1;
    for (let index = 0; index < source.length; index += 1) if (source[index] === 0x0a) { if (current === rowIndex) { end = index; break; } current += 1; start = index + 1; }
    if (end < 0) throw new Error(`row_not_found:${rowIndex}`);
    return Buffer.concat([source.subarray(0, start), Buffer.from(text), source.subarray(end)]);
  };
  const jsonBuffer = (value) => Buffer.from(`${stableStringify(value)}\n`);
  const descriptorForBuffer = (logicalPath, buffer, canonical = false) => {
    const result = { path: logicalPath };
    if (canonical) { const value = JSON.parse(buffer.toString("utf8")); result.canonicalSha256 = canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash")); }
    result.byteSha256 = sha256(buffer); return result;
  };
  const p1Specs = {
    teacherSourceManifest: { path: chain.paths.sourceManifestPath, compiledPath: "teacher-source-manifest.json", teacherArtifactKey: "sourceManifest", lockField: "teacherSourceManifestCanonicalSha256", canonical: true },
    teacherDataset: { path: chain.paths.datasetPath, compiledPath: "teacher-dataset-v2.jsonl", teacherArtifactKey: "dataset", lockField: "teacherDatasetByteSha256", canonical: false },
    teacherRefined: { path: chain.paths.refinedPath, compiledPath: "teacher-refined.jsonl", teacherArtifactKey: "refined", lockField: "teacherRefinedByteSha256", canonical: false },
    teacherMask: { path: chain.paths.maskPath, compiledPath: "teacher-mask-v2.jsonl", teacherArtifactKey: "mask", lockField: "teacherMaskByteSha256", canonical: false },
    teacherSummary: { path: chain.paths.summaryPath, compiledPath: "teacher-summary.json", teacherArtifactKey: "summary", lockField: "teacherSummaryCanonicalSha256", canonical: true },
  };
  const p0CompiledByFileKey = { manualWindows: "manual-windows.json", manualLabels: "manual-labels.jsonl", manualSubjectSelection: "manual-subject-selection.jsonl", manualReviewPassA: "manual-review-pass1.jsonl", manualReviewPassB: "manual-review-pass2.jsonl", manualAdjudication: "manual-adjudication.jsonl", manualPolicy: "manual-policy.json", manualSummary: "manual-summary.json" };
  const p0DependencyByFileKey = { evaluationContract: "evaluationContractCanonicalSha256", labelSchema: "labelSchemaCanonicalSha256", authoringSchema: "authoringSchemaCanonicalSha256", teacherInputInventory: "teacherInputInventoryCanonicalSha256", teacherPolicy: "teacherPolicyCanonicalSha256", teacherSchema: "teacherSchemaCanonicalSha256", p0AnchorSchema: "p0AnchorSchemaCanonicalSha256", p1AnchorSchema: "p1AnchorSchemaCanonicalSha256", sourceInventory: "sourceInventoryCanonicalSha256", decoderManifest: "decoderByteSha256", manualCompiler: "manualCompilerByteSha256", labelAuditor: "labelAuditorByteSha256" };
  const inherited = { evaluationContract: "evaluationContract", labelSchema: "labelSchema", teacherInputInventory: "teacherInputInventory", teacherPolicy: "teacherPolicy", teacherSchema: "teacherSchema", p0AnchorSchema: "p0AnchorSchema", p1AnchorSchema: "p1AnchorSchema", sourceInventory: "sourceInventory", decoderManifest: "decoderManifest", labelAuditor: "labelAuditor" };
  const rebuildFullChain = ({ p0Artifacts = [], p1Artifacts = [], mutateP0Pack = null, mutateP0Anchor = null, mutateP1Pack = null, mutateP1Lock = null, mutateP1Anchor = null } = {}) => {
    const writes = new Map();
    const p0Pack = structuredClone(chain.values.p0Manifest);
    for (const change of p0Artifacts) {
      const descriptor = descriptorForBuffer(change.logicalPath || p0Pack.files[change.fileKey].path, change.buffer, change.canonical ?? Object.hasOwn(p0Pack.files[change.fileKey], "canonicalSha256"));
      p0Pack.files[change.fileKey] = descriptor; writes.set(change.path, change.buffer);
    }
    mutateP0Pack?.(p0Pack);
    const sealedP0Pack = rehash(p0Pack); const p0PackBuffer = jsonBuffer(sealedP0Pack); writes.set(path.join(chain.packDir, "evaluation-pack.json"), p0PackBuffer);
    const p0Anchor = structuredClone(chain.values.p0AnchorValue);
    p0Anchor.candidateP0PackCanonicalSha256 = sealedP0Pack.expectedCanonicalHash;
    p0Anchor.evaluationPack = descriptorForBuffer("evaluation-pack.json", p0PackBuffer, true);
    const p0CompiledBytes = new Map([["evaluation-pack.json", sha256(p0PackBuffer)]]);
    for (const change of p0Artifacts) if (p0CompiledByFileKey[change.fileKey]) p0CompiledBytes.set(p0CompiledByFileKey[change.fileKey], sha256(change.buffer));
    p0Anchor.compiledArtifacts = p0Anchor.compiledArtifacts.map((entry) => p0CompiledBytes.has(entry.path) ? { ...entry, byteSha256: p0CompiledBytes.get(entry.path) } : entry).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    p0Anchor.compiledArtifactSetSha256 = descriptorSetHash(p0Anchor.compiledArtifacts);
    for (const [fileKey, dependencyField] of Object.entries(p0DependencyByFileKey)) {
      const descriptor = sealedP0Pack.files?.[fileKey]; if (!descriptor) continue;
      p0Anchor.dependencies[dependencyField] = dependencyField.endsWith("CanonicalSha256") ? descriptor.canonicalSha256 : descriptor.byteSha256;
    }
    mutateP0Anchor?.(p0Anchor);
    const sealedP0Anchor = rehash(p0Anchor); const p0AnchorBuffer = jsonBuffer(sealedP0Anchor); writes.set(chain.paths.p0AnchorPath, p0AnchorBuffer);

    const p1Buffers = new Map(Object.entries(p1Specs).map(([key, spec]) => [key, readFileSync(spec.path)]));
    if (sealedP0Anchor.expectedCanonicalHash !== chain.p0Anchor.hash) {
      const source = structuredClone(chain.values.sourceManifestValue); source.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash;
      if (sealedP0Pack.files?.teacherInputInventory?.canonicalSha256) source.teacherInputInventoryCanonicalSha256 = sealedP0Pack.files.teacherInputInventory.canonicalSha256;
      const sealedSource = rehash(source); p1Buffers.set("teacherSourceManifest", jsonBuffer(sealedSource));
      const summary = structuredClone(chain.values.summaryValue); summary.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash; summary.teacherSourceManifestCanonicalSha256 = sealedSource.expectedCanonicalHash;
      if (sealedP0Pack.files?.teacherInputInventory?.canonicalSha256) summary.teacherInputInventoryCanonicalSha256 = sealedP0Pack.files.teacherInputInventory.canonicalSha256;
      if (sealedP0Pack.files?.teacherPolicy?.canonicalSha256) summary.teacherPolicyCanonicalSha256 = sealedP0Pack.files.teacherPolicy.canonicalSha256;
      if (sealedP0Pack.files?.evaluationContract?.canonicalSha256) summary.evaluationContractCanonicalSha256 = sealedP0Pack.files.evaluationContract.canonicalSha256;
      if (sealedP0Pack.files?.teacherSchema?.canonicalSha256) summary.teacherSchemaCanonicalSha256 = sealedP0Pack.files.teacherSchema.canonicalSha256;
      p1Buffers.set("teacherSummary", jsonBuffer(rehash(summary)));
    }
    for (const change of p1Artifacts) { p1Buffers.set(change.fileKey, change.buffer); writes.set(p1Specs[change.fileKey].path, change.buffer); }
    if (!p1Artifacts.some((change) => change.fileKey === "teacherSummary")) {
      const summary = structuredClone(JSON.parse(p1Buffers.get("teacherSummary").toString("utf8")));
      summary.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash;
      summary.teacherSourceManifestCanonicalSha256 = canonicalHash(JSON.parse(p1Buffers.get("teacherSourceManifest").toString("utf8")), true);
      summary.teacherDatasetByteSha256 = sha256(p1Buffers.get("teacherDataset"));
      summary.teacherRefinedByteSha256 = sha256(p1Buffers.get("teacherRefined"));
      summary.teacherMaskByteSha256 = sha256(p1Buffers.get("teacherMask"));
      p1Buffers.set("teacherSummary", jsonBuffer(rehash(summary)));
    }
    const p1Pack = structuredClone(chain.values.p1Manifest); p1Pack.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash;
    p1Pack.files.p0Pack = structuredClone(p0Anchor.evaluationPack);
    p1Pack.files.externalP0Anchor = { logicalPath: "anchors/p0.json", canonicalSha256: sealedP0Anchor.expectedCanonicalHash, byteSha256: sha256(p0AnchorBuffer) };
    for (const [p1Key, p0Key] of Object.entries(inherited)) if (sealedP0Pack.files?.[p0Key]) p1Pack.files[p1Key] = structuredClone(sealedP0Pack.files[p0Key]);
    for (const [fileKey, spec] of Object.entries(p1Specs)) p1Pack.files[fileKey] = descriptorForBuffer(spec.compiledPath, p1Buffers.get(fileKey), spec.canonical);
    mutateP1Pack?.(p1Pack);
    const sealedP1Pack = rehash(p1Pack); const p1PackBuffer = jsonBuffer(sealedP1Pack); writes.set(chain.paths.p1ManifestPath, p1PackBuffer);
    const p1Lock = structuredClone(chain.values.p1Lock); p1Lock.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash; p1Lock.p1PackCanonicalSha256 = sealedP1Pack.expectedCanonicalHash;
    for (const [fileKey, spec] of Object.entries(p1Specs)) p1Lock[spec.lockField] = spec.canonical ? p1Pack.files[fileKey]?.canonicalSha256 : p1Pack.files[fileKey]?.byteSha256;
    if (p1Pack.files?.teacherInputInventory?.canonicalSha256) p1Lock.teacherInputInventoryCanonicalSha256 = p1Pack.files.teacherInputInventory.canonicalSha256;
    if (p1Pack.files?.teacherPolicy?.canonicalSha256) p1Lock.teacherPolicyCanonicalSha256 = p1Pack.files.teacherPolicy.canonicalSha256;
    if (p1Pack.files?.teacherMaterializer?.byteSha256) p1Lock.teacherMaterializerByteSha256 = p1Pack.files.teacherMaterializer.byteSha256;
    if (p1Pack.files?.labelAuditor?.byteSha256) p1Lock.labelAuditorByteSha256 = p1Pack.files.labelAuditor.byteSha256;
    mutateP1Lock?.(p1Lock);
    const sealedP1Lock = rehash(p1Lock); const p1LockBuffer = jsonBuffer(sealedP1Lock); writes.set(chain.paths.p1LockPath, p1LockBuffer);
    const p1Anchor = structuredClone(chain.values.p1AnchorValue); p1Anchor.parentP0AnchorSha256 = sealedP0Anchor.expectedCanonicalHash; p1Anchor.candidateP1LockCanonicalSha256 = sealedP1Lock.expectedCanonicalHash;
    p1Anchor.evaluationPackP1 = descriptorForBuffer("evaluation-pack-p1.json", p1PackBuffer, true); p1Anchor.p1Lock = descriptorForBuffer("evaluation-lock-p1.json", p1LockBuffer, true);
    for (const [fileKey, spec] of Object.entries(p1Specs)) p1Anchor.teacherArtifacts[spec.teacherArtifactKey] = descriptorForBuffer(spec.compiledPath, p1Buffers.get(fileKey), spec.canonical);
    if (p1Pack.files?.teacherInputInventory) p1Anchor.teacherArtifacts.inputInventory = structuredClone(p1Pack.files.teacherInputInventory);
    const compiledBuffers = new Map([["evaluation-pack-p1.json", p1PackBuffer], ["evaluation-lock-p1.json", p1LockBuffer], ...Object.entries(p1Specs).map(([key, spec]) => [spec.compiledPath, p1Buffers.get(key)])]);
    p1Anchor.compiledArtifacts = [...compiledBuffers.entries()].map(([logicalPath, buffer]) => ({ path: logicalPath, byteSha256: sha256(buffer) })).sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)));
    p1Anchor.compiledArtifactSetSha256 = descriptorSetHash(p1Anchor.compiledArtifacts);
    for (const [fileKey, dependencyField] of [["evaluationContract", "evaluationContractCanonicalSha256"], ["teacherInputInventory", "teacherInputInventoryCanonicalSha256"], ["teacherPolicy", "teacherPolicyCanonicalSha256"], ["teacherSchema", "teacherSchemaCanonicalSha256"], ["p0AnchorSchema", "p0AnchorSchemaCanonicalSha256"], ["p1AnchorSchema", "p1AnchorSchemaCanonicalSha256"]]) if (p1Pack.files?.[fileKey]?.canonicalSha256) p1Anchor.dependencies[dependencyField] = p1Pack.files[fileKey].canonicalSha256;
    if (p1Pack.files?.teacherMaterializer?.byteSha256) p1Anchor.dependencies.teacherMaterializerByteSha256 = p1Pack.files.teacherMaterializer.byteSha256;
    if (p1Pack.files?.labelAuditor?.byteSha256) p1Anchor.dependencies.labelAuditorByteSha256 = p1Pack.files.labelAuditor.byteSha256;
    mutateP1Anchor?.(p1Anchor);
    const sealedP1Anchor = rehash(p1Anchor); const p1AnchorBuffer = jsonBuffer(sealedP1Anchor); writes.set(chain.paths.p1AnchorPath, p1AnchorBuffer);
    for (const [fileKey, buffer] of p1Buffers) writes.set(p1Specs[fileKey].path, buffer);
    return { writes, p0Pack: sealedP0Pack, p0Anchor: sealedP0Anchor, p1Pack: sealedP1Pack, p1Lock: sealedP1Lock, p1Anchor: sealedP1Anchor };
  };
  const withRebuiltChain = (rebuilt, fn) => {
    const originals = new Map([...rebuilt.writes.keys()].map((filePath) => [filePath, existsSync(filePath) ? readFileSync(filePath) : null]));
    try { for (const [filePath, buffer] of rebuilt.writes) { mkdirSync(path.dirname(filePath), { recursive: true }); writeFileSync(filePath, buffer); } return fn(); }
    finally { for (const [filePath, original] of originals) original === null ? rmSync(filePath, { force: true }) : writeFileSync(filePath, original); }
  };
  const runRebuiltP1 = (rebuilt, hooks = testHooks, overrides = {}) => withRebuiltChain(rebuilt, () => viaRunAudit({ ...p1AuditOptions, expectedP0: rebuilt.p0Anchor.expectedCanonicalHash, expectedP1: rebuilt.p1Anchor.expectedCanonicalHash, ...overrides }, hooks));
  const runRebuiltP0 = (rebuilt, hooks = testHooks, overrides = {}) => withRebuiltChain(rebuilt, () => viaRunAudit({ ...p0AuditOptions, expectedP0: rebuilt.p0Anchor.expectedCanonicalHash, ...overrides }, hooks));
  const attachFixtureOverride = (rebuilt, channel, logicalPath, buffer, baseHooks = testHooks) => {
    const baseline = readFileSync(path.join(ROOT, logicalPath)); const baselineByteSha256 = sha256(baseline);
    assert.equal(baselineByteSha256, sha256(readFileSync(path.join(ROOT, logicalPath))), `fixture baseline drift:${logicalPath}`);
    const overridePath = path.join(fixtureRuntime, "overrides", `${activeCase}-${path.basename(logicalPath)}`); rebuilt.writes.set(overridePath, buffer);
    const entry = { path: overridePath, baselineByteSha256 };
    return { ...baseHooks, [channel]: { ...(baseHooks[channel] || {}), [logicalPath]: entry } };
  };
  const p1ArtifactAttack = (fileKey, buffer) => runRebuiltP1(rebuildFullChain({ p1Artifacts: [{ fileKey, buffer }] }));
  const policyPinAttack = (mutate) => {
    const attacked = structuredClone(core.teacherPolicy); mutate(attacked); const buffer = jsonBuffer(rehash(attacked)); const logicalPath = "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-policy.json"; const overridePath = path.join(fixtureRuntime, "overrides", `${activeCase}-teacher-policy.json`);
    const rebuilt = rebuildFullChain({ p0Artifacts: [{ fileKey: "teacherPolicy", logicalPath, path: overridePath, buffer, canonical: true }] }); let hooks = attachFixtureOverride(rebuilt, "corePathOverrides", logicalPath, buffer); hooks = attachFixtureOverride(rebuilt, "descriptorPathOverrides", logicalPath, buffer, hooks); return runRebuiltP1(rebuilt, hooks);
  };
  const datasetIndex = chain.p1.dataset.rows.findIndex((entry) => entry.raw.persons.length === 1 && entry.selection.rawPersonIndex === 0);
  const multiIndex = chain.p1.dataset.rows.findIndex((entry) => entry.raw.persons.length > 1);
  const datasetExpected = chain.artifacts.datasetRows[datasetIndex];
  const jsonValueEnd = (text, start) => {
    assert.equal(start < text.length, true, "JSON value start out of range");
    if (text[start] === '"') {
      for (let index = start + 1; index < text.length; index += 1) {
        if (text[index] === "\\") { index += 1; continue; }
        if (text[index] === '"') return index + 1;
      }
      assert.fail("unterminated JSON string");
    }
    if (text[start] === "{" || text[start] === "[") {
      const stack = [text[start]]; let inString = false;
      for (let index = start + 1; index < text.length; index += 1) {
        const character = text[index];
        if (inString) {
          if (character === "\\") index += 1;
          else if (character === '"') inString = false;
          continue;
        }
        if (character === '"') { inString = true; continue; }
        if (character === "{" || character === "[") stack.push(character);
        else if (character === "}" || character === "]") {
          const opening = stack.pop();
          assert.equal((opening === "{" && character === "}") || (opening === "[" && character === "]"), true, "JSON bracket mismatch");
          if (stack.length === 0) return index + 1;
        }
      }
      assert.fail("unterminated JSON container");
    }
    let end = start;
    while (end < text.length && ![",", "]", "}"].includes(text[end])) end += 1;
    assert.equal(end > start, true, "empty JSON primitive");
    return end;
  };
  const jsonPropertyRange = (text, name, occurrence = 0) => {
    const needle = `${JSON.stringify(name)}:`; let propertyStart = -1;
    for (let index = 0; index <= occurrence; index += 1) propertyStart = text.indexOf(needle, propertyStart + 1);
    assert.notEqual(propertyStart, -1, `JSON property missing:${name}:${occurrence}`);
    const valueStart = propertyStart + needle.length;
    return { propertyStart, valueStart, valueEnd: jsonValueEnd(text, valueStart) };
  };
  const replaceRange = (bytes, start, end, replacement) => {
    const text = bytes.toString("utf8");
    return Buffer.from(`${text.slice(0, start)}${replacement}${text.slice(end)}`);
  };
  const replaceJsonNumber = (bytes, name, replacement, occurrence = 0) => {
    const text = bytes.toString("utf8"); const range = jsonPropertyRange(text, name, occurrence); const original = text.slice(range.valueStart, range.valueEnd);
    assert.match(original, /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/, `JSON number spelling invalid:${name}`);
    return replaceRange(bytes, range.valueStart, range.valueEnd, replacement);
  };
  const deleteJsonProperty = (bytes, name, occurrence = 0) => {
    const text = bytes.toString("utf8"); const range = jsonPropertyRange(text, name, occurrence); let start = range.propertyStart; let end = range.valueEnd;
    if (text[end] === ",") end += 1;
    else { assert.equal(text[start - 1], ",", `JSON property is not delimited:${name}`); start -= 1; }
    return replaceRange(bytes, start, end, "");
  };
  const personElements = (bytes) => {
    const text = bytes.toString("utf8"); const range = jsonPropertyRange(text, "persons");
    assert.equal(text[range.valueStart], "["); assert.equal(text[range.valueEnd - 1], "]");
    const elements = []; let cursor = range.valueStart + 1;
    while (cursor < range.valueEnd - 1) {
      const end = jsonValueEnd(text, cursor); elements.push(text.slice(cursor, end)); cursor = end;
      if (cursor < range.valueEnd - 1) { assert.equal(text[cursor], ",", "persons array delimiter drift"); cursor += 1; }
    }
    return { text, range, elements };
  };
  const replacePersons = (bytes, transform) => {
    const { range, elements } = personElements(bytes); const replacement = `[${transform(elements).join(",")}]`;
    return replaceRange(bytes, range.valueStart, range.valueEnd, replacement);
  };
  const swapFirstTwoTopLevelProperties = (bytes) => {
    const text = bytes.toString("utf8"); const first = jsonPropertyRange(text, "video"); const second = jsonPropertyRange(text, "frame_index");
    assert.equal(first.propertyStart, 1, "video must be the first top-level property");
    assert.equal(text[first.valueEnd], ",", "video property delimiter drift");
    assert.equal(second.propertyStart, first.valueEnd + 1, "frame_index must immediately follow video");
    const firstEntry = text.slice(first.propertyStart, first.valueEnd); const secondEntry = text.slice(second.propertyStart, second.valueEnd);
    return Buffer.from(`${text.slice(0, first.propertyStart)}${secondEntry},${firstEntry}${text.slice(second.valueEnd)}`);
  };
  const coherentRawClaim = (index, bytes) => {
    const entry = chain.p1.dataset.rows[index]; const raw = JSON.parse(bytes);
    let previousRaw = null;
    if (entry.decoder.sourceFrameIndex > 0) {
      const previousEntry = chain.p1.dataset.rows[index - 1];
      assert.equal(previousEntry.decoder.clipId, entry.decoder.clipId, "previous raw clip drift");
      assert.equal(previousEntry.decoder.sourceFrameIndex, entry.decoder.sourceFrameIndex - 1, "previous raw frame-index drift");
      previousRaw = previousEntry.raw;
    }
    const provenance = deriveDetectorProvenance(raw, previousRaw);
    const selection = deriveSelection(raw, entry.subject, core.teacherPolicy);
    const claim = expectedDatasetRow(entry.decoder, raw, bytes, chain.artifacts.datasetRows[index].rawLineIndex, provenance, entry.subject, core.teacherPolicy);
    assert.equal(Buffer.from(claim.rawLineBase64, "base64").equals(bytes), true, "coherent raw claim byte round-trip drift");
    assert.equal(claim.rawLineByteSha256, sha256(bytes), "coherent raw claim byte hash drift");
    assert.equal(claim.decodedRawCanonicalSha256, canonicalHash(raw), "coherent raw claim canonical hash drift");
    assert.deepEqual(claim.detectorProvenance, provenance, "coherent raw claim detector provenance drift");
    assert.deepEqual(claim.derivedSelection, selection, "coherent raw claim selection drift");
    const warningSet = new Set(["native_joint_confidence_unavailable", "detector_provenance_derived_not_native"]);
    if (selection.selectionWarningCodes.includes("detector_bbox_invalid_fallback")) warningSet.add("detector_bbox_invalid_fallback");
    if (claim.rawTimestampComparison.differs) warningSet.add("raw_timestamp_differs_from_exact_pts");
    assert.deepEqual(claim.warningCodes, core.teacherPolicy.warnings.codes.filter((code) => warningSet.has(code)), "coherent raw claim warning drift");
    return claim;
  };
  exercise("teacher-inventory-rehash", () => {
    const attacked = rehash({ ...structuredClone(core.teacherInventory), clips: structuredClone(core.teacherInventory.clips) }); attacked.clips[0].files.skeletonsMhr70.byteSha256 = "0".repeat(64); const sealed = rehash(attacked); const buffer = jsonBuffer(sealed);
    const overridePath = path.join(fixtureRuntime, "overrides", `${activeCase}-teacher-input-inventory.json`); const rebuilt = rebuildFullChain({ p0Artifacts: [{ fileKey: "teacherInputInventory", logicalPath: "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json", path: overridePath, buffer, canonical: true }] });
    let hooks = attachFixtureOverride(rebuilt, "corePathOverrides", "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json", buffer); hooks = attachFixtureOverride(rebuilt, "descriptorPathOverrides", "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json", buffer, hooks); return runRebuiltP1(rebuilt, hooks);
  });
  const rawFixtureAttack = (mutate) => {
    const logicalPath = core.teacherInventory.clips[0].files.skeletonsMhr70.path; const baseline = readFileSync(path.join(ROOT, logicalPath)); const buffer = mutate(Buffer.from(baseline)); const rebuilt = rebuildFullChain(); const hooks = attachFixtureOverride(rebuilt, "teacherPathOverrides", logicalPath, buffer); return runRebuiltP1(rebuilt, hooks);
  };
  exercise("raw-byte-substitution", () => rawFixtureAttack((buffer) => {
    const needle = Buffer.from('"timestamp_sec":'); const start = buffer.indexOf(needle); assert.notEqual(start, -1, "raw timestamp field missing");
    const attacked = Buffer.from(buffer); let index = start + needle.length; while (index < attacked.length && (attacked[index] < 0x30 || attacked[index] > 0x39)) index += 1;
    assert.equal(index < attacked.length, true, "raw timestamp digit missing"); attacked[index] = attacked[index] === 0x39 ? 0x38 : attacked[index] + 1; return attacked;
  }));
  exercise("raw-lone-lf", () => rawFixtureAttack((buffer) => buffer.subarray(0, -2).length ? Buffer.concat([buffer.subarray(0, -2), Buffer.from("\n")]) : buffer));
  exercise("raw-mixed-line-ending", () => rawFixtureAttack((buffer) => Buffer.concat([buffer.subarray(0, -2), Buffer.from(" {\"mixed\":true}\n")])));
  exercise("raw-lone-cr", () => rawFixtureAttack((buffer) => Buffer.concat([buffer.subarray(0, -2), Buffer.from("\rX\r\n")])));
  exercise("raw-missing-terminal", () => rawFixtureAttack((buffer) => buffer.subarray(0, -2)));
  exercise("raw-replaced-lf", () => rawFixtureAttack((buffer) => Buffer.concat([buffer.subarray(0, -2), Buffer.from("\r\r\n")])));
  exercise("timestamp-substitution", () => {
    const originalBytes = Buffer.from(datasetExpected.rawLineBase64, "base64"); const originalRaw = JSON.parse(originalBytes);
    const attackedBytes = replaceJsonNumber(originalBytes, "timestamp_sec", String(originalRaw.timestamp_sec + (1 / 30)));
    const attacked = coherentRawClaim(datasetIndex, attackedBytes);
    return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked));
  });
  exercise("raw-number-spelling-drift", () => {
    const originalBytes = Buffer.from(datasetExpected.rawLineBase64, "base64");
    const originalRaw = JSON.parse(originalBytes);
    const replacementBytes = replaceJsonNumber(originalBytes, "frame_index", `${originalRaw.frame_index}e0`);
    const replacementRaw = JSON.parse(replacementBytes);
    assert.equal(replacementBytes.equals(originalBytes), false, "number-spelling replacement must change raw bytes");
    assert.deepEqual(replacementRaw, originalRaw, "number-spelling replacement must preserve parsed JSON value");
    assert.equal(canonicalHash(replacementRaw), datasetExpected.decodedRawCanonicalSha256, "number-spelling replacement must preserve decoded canonical hash");
    const attacked = coherentRawClaim(datasetIndex, replacementBytes);
    return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked));
  });
  exercise("deleted-miss-row", () => { const source = readFileSync(chain.paths.datasetPath); const firstLf = source.indexOf(0x0a); return p1ArtifactAttack("teacherDataset", source.subarray(firstLf + 1)); });
  exercise("first-person-only", () => {
    const original = Buffer.from(chain.artifacts.datasetRows[multiIndex].rawLineBase64, "base64");
    const onePerson = replaceJsonNumber(replacePersons(original, (elements) => elements.slice(0, 1)), "person_count", "1");
    const attacked = coherentRawClaim(multiIndex, onePerson);
    return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, multiIndex, attacked));
  });
  exercise("mhr127-loss", () => { const bytes = deleteJsonProperty(Buffer.from(datasetExpected.rawLineBase64, "base64"), "mhr_joint_coords_127_3d"); const attacked = coherentRawClaim(datasetIndex, bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("bbox-loss", () => {
    let bytes = deleteJsonProperty(Buffer.from(datasetExpected.rawLineBase64, "base64"), "bbox_xyxy");
    bytes = deleteJsonProperty(bytes, "detector_bbox_xyxy");
    const attacked = coherentRawClaim(datasetIndex, bytes);
    return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked));
  });
  exercise("camera-loss", () => { const bytes = deleteJsonProperty(Buffer.from(datasetExpected.rawLineBase64, "base64"), "pred_cam_t"); const attacked = coherentRawClaim(datasetIndex, bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("detector-score-as-confidence", () => { const attacked = structuredClone(datasetExpected); attacked.jointConfidence = attacked.detectorProvenance.state === "detector_hit" ? 1 : 0; return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("fallback-relabeled-hit", () => { const index = chain.p1.dataset.rows.findIndex((entry) => entry.provenance.state === "carry_forward_fallback"); const attacked = structuredClone(chain.artifacts.datasetRows[index]); attacked.detectorProvenance = { state: "detector_hit", source: "derived_nonrepeat_valid_native_detector_bbox" }; return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, index, attacked)); });
  exercise("summary-miss-drift", () => policyPinAttack((policy) => { policy.expectedRawReconciliation["arms-crossed"].miss_no_prediction -= 1; policy.expectedRawReconciliation["arms-crossed"].detector_hit += 1; }));
  exercise("invalid-detector-bbox", () => viaHelper(() => assert.equal(deriveSelection(rawSelection([person(null, null)]), selected({ x: 0.5, y: 0.5 }), core.teacherPolicy).selectionFailureReason, "candidate_bbox_unusable")));
  exercise("multi-null-anchor-bbox-confusion", () => viaHelper(() => assert.equal(deriveSelection(rawSelection([person(null, null), person(null, null, 0.2, 1)]), selected(), core.teacherPolicy).selectionFailureReason, "teacher_candidate_ambiguous")));
  exercise("single-null-anchor-over-derivation", () => { const attacked = structuredClone(datasetExpected); attacked.derivedSelection.effectiveBboxSource = "detector"; attacked.derivedSelection.effectiveBboxXyxy = [0, 0, 1, 1]; return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("normalized-anchor-edge-drift", () => viaHelper(() => assert.equal(deriveSelection(rawSelection([person([0, 0, 1, 1])]), selected({ x: 0, y: 0 }), core.teacherPolicy).rawPersonIndex, 0)));
  exercise("anchor-free-multi-selection", () => viaHelper(() => assert.equal(deriveSelection(rawSelection([person(), person([20, 20, 30, 30], undefined, 0.5, 1)]), selected(), core.teacherPolicy).selectionFailureReason, "teacher_candidate_ambiguous")));
  exercise("bbox-anchor-tie", () => viaHelper(() => assert.equal(deriveSelection(rawSelection([person([0, 0, 100, 100]), person([0, 0, 100, 100], undefined, 0.5, 1)]), selected({ x: 0.5, y: 0.5 }), core.teacherPolicy).selectionFailureReason, "teacher_candidate_ambiguous")));

  const maskIndex = chain.artifacts.maskRows.findIndex((row) => row.valid); const maskExpected = chain.artifacts.maskRows[maskIndex];
  const maskAttack = (id, mutate) => exercise(id, () => { const attacked = structuredClone(maskExpected); mutate(attacked); return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, maskIndex, attacked)); });
  maskAttack("false-geometry-flags", (row) => { row.scope.torsoFacing = !row.scope.torsoFacing; });
  maskAttack("reprojection-drift", (row) => { row.diagnostics.perScopeMaxReprojectionErrorPx.torsoFacing = 999; });
  maskAttack("invalid-clip-scale-input", (row) => { row.diagnostics.clipScaleM = row.diagnostics.clipScaleM === null ? 0.2 : row.diagnostics.clipScaleM * 2; });
  maskAttack("missing-predecessor", (row) => { row.diagnostics.exactTemporalDelta = { deltaTicks: "1", timeBase: { numerator: 1, denominator: 1 } }; });
  exercise("nonfinite-predecessor", () => { const attacked = structuredClone(maskExpected); attacked.diagnostics.cameraRootSpeedMps = "__NONFINITE__"; const text = stableStringify(attacked).replace('"__NONFINITE__"', "1e309"); return p1ArtifactAttack("teacherMask", replaceJsonlRowText(chain.paths.maskPath, maskIndex, text)); });
  exercise("scale-threshold-drift", () => policyPinAttack((policy) => { policy.thresholds.max_adjacent_scale_jump = 0.11; }));
  exercise("speed-threshold-drift", () => policyPinAttack((policy) => { policy.thresholds.max_camera_root_speed_mps = 13; }));
  maskAttack("head-cross-scope-contamination", (row) => { assert.equal(row.scopeReasons.leftArm.includes("manual_head_unobservable"), false); row.scopeReasons.leftArm = [...row.scopeReasons.leftArm, "manual_head_unobservable"]; });
  maskAttack("arm-cross-scope-contamination", (row) => { assert.equal(row.scopeReasons.rightLeg.includes("manual_arm_unobservable"), false); row.scopeReasons.rightLeg = [...row.scopeReasons.rightLeg, "manual_arm_unobservable"]; });
  maskAttack("hand-cross-scope-contamination", (row) => { assert.equal(row.scopeReasons.leftArm.includes("manual_hand_unobservable"), false); row.scopeReasons.leftArm = [...row.scopeReasons.leftArm, "manual_hand_unobservable"]; });
  maskAttack("leg-cross-scope-contamination", (row) => { assert.equal(row.scopeReasons.head.includes("manual_leg_unobservable"), false); row.scopeReasons.head = [...row.scopeReasons.head, "manual_leg_unobservable"]; });
  maskAttack("missing-endpoint-scope", (row) => { delete row.scope.head; delete row.scopeReasons.head; });
  exercise("missing-head-support", () => { const attacked = structuredClone(chain.values.summaryValue); attacked.support.head.postMaskFrames = 99; return p1ArtifactAttack("teacherSummary", jsonBuffer(rehash(attacked))); });
  exercise("missing-hand-support", () => { const attacked = structuredClone(chain.values.summaryValue); attacked.support.leftHand.postMaskFrames = 99; return p1ArtifactAttack("teacherSummary", jsonBuffer(rehash(attacked))); });
  exercise("contact-without-fullbody", () => {
    const index = chain.artifacts.maskRows.findIndex((row) => row.scope.fullBody && row.scope.leftContact); assert.notEqual(index, -1, "contact-implies-fullBody witness missing");
    const attacked = structuredClone(chain.artifacts.maskRows[index]); attacked.scope.fullBody = false;
    return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, index, attacked));
  });

  const refinedIndex = chain.artifacts.refinedRows.findIndex((row) => row.predCamT !== null); const refinedExpected = chain.artifacts.refinedRows[refinedIndex];
  const refinedAttack = (id, mutate) => exercise(id, () => { const attacked = structuredClone(refinedExpected); mutate(attacked); if (attacked.predCamT) attacked.refinedPoseCanonicalSha256 = canonicalHash({ predCamT: attacked.predCamT, keypointsMhr70RootRelativeM: attacked.keypointsMhr70RootRelativeM, mhrJointCoords127RootRelativeM: attacked.mhrJointCoords127RootRelativeM }); return p1ArtifactAttack("teacherRefined", replaceJsonlRow(chain.paths.refinedPath, refinedIndex, attacked)); });
  exercise("refinement-coefficient-drift", () => policyPinAttack((policy) => { policy.thresholds.refinement_savgol_numerator[0] = -4; }));
  refinedAttack("refinement-result-drift", (row) => { row.predCamT[0] += 0.0001; });
  refinedAttack("refinement-window-drift", (row) => { row.sourceWindow = row.sourceWindow ? [...row.sourceWindow].reverse() : [row.identity, row.identity, row.identity, row.identity, row.identity]; });
  refinedAttack("refinement-safety-drift", (row) => { row.keypointsMhr70RootRelativeM[0][0] += 1; });
  refinedAttack("refinement-status-drift", (row) => { row.refinementStatus = row.refinementStatus === "smoothed" ? "identity_safety_fallback" : "smoothed"; });
  refinedAttack("cross-gap-smoothing", (row) => { row.refinementStatus = "smoothed"; });
  refinedAttack("target-role-switch", (row) => { row.targetRole = "hard"; });
  exercise("reason-precedence-conflict", () => { const index = chain.artifacts.maskRows.findIndex((row) => row.scopeReasons.torsoFacing.length >= 2); const attacked = structuredClone(chain.artifacts.maskRows[index]); attacked.scopeReasons.torsoFacing.reverse(); return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, index, attacked)); });

  const rewriteP0Artifact = (fileKey, mutate) => {
    const name = { manualReviewPassB: "manual-review-pass2.jsonl", manualLabels: "manual-labels.jsonl" }[fileKey]; const filePath = path.join(chain.packDir, name);
    const rows = readFileSync(filePath, "utf8").trimEnd().split("\n").map(JSON.parse); mutate(rows); const buffer = Buffer.from(`${rows.map(stableStringify).join("\n")}\n`);
    return runRebuiltP1(rebuildFullChain({ p0Artifacts: [{ fileKey, path: filePath, buffer, canonical: false }] }));
  };
  exercise("scenario-disagreement-erasure", () => rewriteP0Artifact("manualReviewPassB", (rows) => { const index = rows.findIndex((row) => row.scenarios[0] === "neutral"); rows[index].scenarios = ["entry_exit"]; }));
  exercise("absent-observable-body", () => rewriteP0Artifact("manualLabels", (rows) => { const index = rows.findIndex((row) => row.presence === "absent"); rows[index].occlusion.body = "observable"; }));

  exercise("raw-key-order-drift", () => { const bytes = swapFirstTwoTopLevelProperties(Buffer.from(datasetExpected.rawLineBase64, "base64")); const attacked = coherentRawClaim(datasetIndex, bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("raw-null-missing-drift", () => { const bytes = deleteJsonProperty(Buffer.from(datasetExpected.rawLineBase64, "base64"), "bbox_xyxy"); const attacked = coherentRawClaim(datasetIndex, bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("raw-person-order-drift", () => { const original = Buffer.from(chain.artifacts.datasetRows[multiIndex].rawLineBase64, "base64"); const bytes = replacePersons(original, (elements) => [...elements].reverse()); const attacked = coherentRawClaim(multiIndex, bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, multiIndex, attacked)); });
  exercise("raw-cr-retained-in-base64", () => { const attacked = structuredClone(datasetExpected); const bytes = Buffer.concat([Buffer.from(attacked.rawLineBase64, "base64"), Buffer.from("\r")]); attacked.rawLineBase64 = bytes.toString("base64"); attacked.rawLineByteSha256 = sha256(bytes); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("generated-jsonl-crlf", () => p1ArtifactAttack("teacherDataset", Buffer.from(readFileSync(chain.paths.datasetPath).toString("utf8").replaceAll("\n", "\r\n"))));
  exercise("first-eight-last-two-separation", () => { const attacked = structuredClone(maskExpected); attacked.diagnostics.frameScaleM = null; return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, maskIndex, attacked)); });
  exercise("torso-diagnostic-validity-separation", () => { const attacked = structuredClone(maskExpected); attacked.diagnostics.torsoCross = null; return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, maskIndex, attacked)); });
  const temporalIsolationAttack = (joint, affected, unaffected) => {
    const predecessor = syntheticEntry(1); const current = syntheticEntry(2); current.raw.persons[0].keypoints_mhr70_3d[joint][0] = Infinity; const expected = expectedMaskRow(current, manualLabel, clipScale, predecessor, core);
    assert.equal(expected.scopeReasons[affected].includes("temporal_reference_unavailable"), true); assert.equal(expected.scopeReasons[unaffected].includes("temporal_reference_unavailable"), false);
    const attacked = structuredClone(maskExpected); assert.equal(attacked.scopeReasons[unaffected].includes("temporal_reference_unavailable"), false); attacked.scopeReasons[unaffected] = [...attacked.scopeReasons[unaffected], "temporal_reference_unavailable"];
    return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, maskIndex, attacked));
  };
  exercise("head-nonfinite-temporal-isolation", () => temporalIsolationAttack(0, "head", "leftArm"));
  exercise("hand-nonfinite-temporal-isolation", () => temporalIsolationAttack(42, "leftHand", "rightArm"));
  exercise("leg-nonfinite-temporal-isolation", () => temporalIsolationAttack(15, "leftLeg", "head"));
  exercise("impossible-refined-status-matrix", () => { const attacked = structuredClone(refinedExpected); attacked.refinementStatus = "unavailable"; return p1ArtifactAttack("teacherRefined", replaceJsonlRow(chain.paths.refinedPath, refinedIndex, attacked)); });
  exercise("selected-nonhit-raw-center-hash-loss", () => { const index = chain.artifacts.refinedRows.findIndex((row) => row.refinementStatus === "unavailable" && row.rawCenterCanonicalSha256 !== null); const attacked = structuredClone(chain.artifacts.refinedRows[index]); attacked.rawCenterCanonicalSha256 = null; return p1ArtifactAttack("teacherRefined", replaceJsonlRow(chain.paths.refinedPath, index, attacked)); });

  exercise("candidate-hash-as-parent", () => {
    const source = structuredClone(chain.values.sourceManifestValue); source.parentP0AnchorSha256 = chain.p0.manifestHash; const sealedSource = rehash(source);
    const summary = structuredClone(chain.values.summaryValue); summary.parentP0AnchorSha256 = chain.p0.manifestHash; summary.teacherSourceManifestCanonicalSha256 = sealedSource.expectedCanonicalHash;
    return runRebuiltP1(rebuildFullChain({
      p1Artifacts: [{ fileKey: "teacherSourceManifest", buffer: jsonBuffer(sealedSource) }, { fileKey: "teacherSummary", buffer: jsonBuffer(rehash(summary)) }],
      mutateP1Pack(pack) { pack.parentP0AnchorSha256 = chain.p0.manifestHash; },
      mutateP1Lock(lock) { lock.parentP0AnchorSha256 = chain.p0.manifestHash; },
      mutateP1Anchor(anchor) { anchor.parentP0AnchorSha256 = chain.p0.manifestHash; },
    }));
  });
  exercise("p1-inherited-canonical-same-byte-different", () => runRebuiltP1(rebuildFullChain({ mutateP1Pack(pack) { pack.files.evaluationContract.byteSha256 = "1".repeat(64); } })));
  exercise("p1-auditor-tool-rebind", () => runRebuiltP1(rebuildFullChain({ mutateP1Pack(pack) { pack.files.labelAuditor.byteSha256 = "2".repeat(64); } })));
  exercise("p1-auditor-swap-after-p0", () => {
    const logicalPath = "scripts/sam-goal-label-audit-v3.mjs"; const baseline = readFileSync(path.join(ROOT, logicalPath)); const rebuilt = rebuildFullChain();
    const hooks = attachFixtureOverride(rebuilt, "descriptorPathOverrides", logicalPath, baseline);
    const overridePath = hooks.descriptorPathOverrides[logicalPath].path; let fired = 0;
    const report = runRebuiltP1(rebuilt, { ...hooks, onAuditPhaseBoundary(event) { assert.deepEqual(event, { boundary: "p0-verified-before-p1" }); fired += 1; writeFileSync(overridePath, Buffer.concat([baseline, Buffer.from("\n// post-p0 swap\n")])); } });
    assert.equal(fired, 1, "P0-to-P1 boundary hook count drift"); return report;
  });
  exercise("p1-inherited-json-swap-after-p0", () => {
    const logicalPath = "tests/fixtures/sam-goal-v2/evaluation-v3/evaluation-contract.json"; const baseline = readFileSync(path.join(ROOT, logicalPath)); const value = JSON.parse(baseline);
    const replacement = Buffer.from(`${JSON.stringify(value)}\n`); assert.notEqual(sha256(replacement), sha256(baseline), "inherited JSON replacement must be byte-distinct"); assert.equal(canonicalHash(value, true), core.hashes.contract, "inherited JSON replacement must be canonical-equal");
    const rebuilt = rebuildFullChain(); let hooks = attachFixtureOverride(rebuilt, "corePathOverrides", logicalPath, baseline); hooks = attachFixtureOverride(rebuilt, "descriptorPathOverrides", logicalPath, baseline, hooks);
    const overridePath = hooks.descriptorPathOverrides[logicalPath].path; let fired = 0;
    const report = runRebuiltP1(rebuilt, { ...hooks, onAuditPhaseBoundary(event) { assert.deepEqual(event, { boundary: "p0-verified-before-p1" }); fired += 1; writeFileSync(overridePath, replacement); } });
    assert.equal(fired, 1, "inherited JSON P0-to-P1 boundary hook count drift"); return report;
  });
  exercise("substituted-external-anchor", () => runRebuiltP1(rebuildFullChain({ mutateP0Anchor(anchor) { anchor.candidateP0PackCanonicalSha256 = "d".repeat(64); } })));
  exercise("duplicate-descriptor", () => runRebuiltP1(rebuildFullChain({ mutateP1Anchor(anchor) {
    anchor.compiledArtifacts[1].path = anchor.compiledArtifacts[0].path;
    const attackerControlledSet = anchor.compiledArtifacts.map(({ path: descriptorPath, byteSha256 }) => ({ path: descriptorPath, byteSha256 }))
      .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
    anchor.compiledArtifactSetSha256 = canonicalHash(attackerControlledSet);
  } })));
  exercise("extra-descriptor", () => runRebuiltP1(rebuildFullChain({ mutateP1Pack(pack) { pack.files.extra = { path: "extra", byteSha256: "a".repeat(64) }; } })));
  exercise("missing-descriptor", () => runRebuiltP1(rebuildFullChain({ mutateP1Pack(pack) { delete pack.files.teacherMask; } })));
  exercise("traversal-descriptor", () => runRebuiltP1(rebuildFullChain({ mutateP1Pack(pack) { pack.files.teacherMask.path = "../teacher-mask-v2.jsonl"; } })));
  const inside = path.join(chain.packDir, "inside-anchor-probe.json"); writeStableJson(inside, {});
  exercise("inside-pack-anchor", () => viaRunAudit({ ...p0AuditOptions, p0Anchor: inside }, testHooks));
  const symlink = path.join(fixtureRuntime, "symlink-anchor-probe.json"); symlinkSync(chain.paths.p0AnchorPath, symlink);
  exercise("symlink-anchor", () => viaRunAudit({ ...p0AuditOptions, p0Anchor: symlink }, testHooks));
  const hardSource = path.join(fixtureRuntime, "hard-source-probe.json"); const hard = path.join(fixtureRuntime, "hard-anchor-probe.json"); writeStableJson(hardSource, {}); linkSync(hardSource, hard);
  exercise("hardlink-anchor", () => viaRunAudit({ ...p0AuditOptions, p0Anchor: hard }, testHooks));
  const attackedAnchor = (id, mutate) => exercise(id, () => runRebuiltP0(rebuildFullChain({ mutateP0Anchor: mutate })));
  attackedAnchor("sealed-role-swap", (value) => { value.sealedInputs.reviewA.role = "second"; });
  const legacyAuthoringAttack = (id, key, fileIndex, legacyValue) => exercise(id, () => {
    const legacyPath = path.join(fixtureRuntime, `${id}.json`); writeStableJson(legacyPath, withSelfHash(legacyValue));
    const anchorValue = structuredClone(chain.values.p0AnchorValue); anchorValue.sealedInputs[key].byteSha256 = sha256(readFileSync(legacyPath));
    const anchor = rehash(anchorValue); const anchorPath = path.join(fixtureRuntime, `${id}-anchor.json`); writeStableJson(anchorPath, anchor);
    const overrides = { p0Anchor: anchorPath, expectedP0: anchor.expectedCanonicalHash, [fileIndex === 0 ? "reviewA" : fileIndex === 1 ? "reviewB" : "adjudication"]: legacyPath };
    return runCli(p0CliArgs(overrides), "p0");
  });
  legacyAuthoringAttack("v2-authoring-review-rejected", "reviewA", 0, { artifactType: "manual-review-authoring-v2", schemaVersion: 1, role: "first", reviewerPseudonymSha256: "a".repeat(64), fixtureNonce: 1 });
  legacyAuthoringAttack("v2-authoring-adjudication-rejected", "adjudication", 2, { artifactType: "manual-adjudication-authoring-v2", schemaVersion: 1, role: "adjudication", adjudicatorPseudonymSha256: "c".repeat(64), fixtureNonce: 3 });
  attackedAnchor("sealed-byte-alias", (value) => { value.sealedInputs.reviewB.byteSha256 = value.sealedInputs.reviewA.byteSha256; });
  attackedAnchor("logical-path-resolver-misuse", (value) => { value.sealedInputs.reviewA.logicalPath = chain.sealedPaths[0]; });
  const sealedHardlink = path.join(fixtureRuntime, "sealed-review-b-hardlink.json"); linkSync(chain.sealedPaths[1], sealedHardlink);
  exercise("sealed-inode-alias", () => viaRunAudit({ ...p0AuditOptions, reviewB: sealedHardlink }, testHooks)); rmSync(sealedHardlink);
  exercise("p0-anchor-double-read", () => { const counts = new Map(); const hooks = { ...testHooks, onExternalSnapshotBoundary(event) { if (event.boundary === "fd-opened") counts.set(event.label, (counts.get(event.label) || 0) + 1); } }; const report = viaRunAudit(p0AuditOptions, hooks); assert.equal(report.status, "passed"); assert.deepEqual(Object.fromEntries(counts), { p0_anchor: 1, sealed_reviewA: 1, sealed_reviewB: 1, sealed_adjudication: 1 }); });
  exercise("p1-sealed-flags", () => runCli([...p1CliArgs(), "--review-a", chain.sealedPaths[0]], "p1"));
  exercise("cwd-relative-external-path", () => viaRunAudit({ ...p0AuditOptions, p0Anchor: path.relative(ROOT, chain.paths.p0AnchorPath), reviewA: path.relative(ROOT, chain.sealedPaths[0]), reviewB: path.relative(ROOT, chain.sealedPaths[1]), adjudication: path.relative(ROOT, chain.sealedPaths[2]) }, testHooks));
  exercise("p1-after-sealed-delete", () => { const backups = chain.sealedPaths.map((filePath) => readFileSync(filePath)); try { chain.sealedPaths.forEach((filePath) => rmSync(filePath)); return viaRunAudit(p1AuditOptions, testHooks); } finally { chain.sealedPaths.forEach((filePath, index) => writeFileSync(filePath, backups[index])); } });
  const finalRace = path.join(fixtureRuntime, "attack-final-race.json"); const finalReplacement = path.join(fixtureRuntime, "attack-final-replacement.json"); const finalOld = path.join(fixtureRuntime, "attack-final-old.json"); writeFileSync(finalRace, readFileSync(chain.paths.p0AnchorPath)); writeFileSync(finalReplacement, readFileSync(chain.paths.p0AnchorPath));
  exercise("final-component-toctou", () => { let swapped = false; const hooks = { ...testHooks, onExternalSnapshotBoundary(event) { if (!swapped && event.label === "p0_anchor" && event.boundary === "final-lstat") { renameSync(finalRace, finalOld); renameSync(finalReplacement, finalRace); swapped = true; } } }; return viaRunAudit({ ...p0AuditOptions, p0Anchor: finalRace }, hooks); });
  const raceRoot = path.join(fixtureRuntime, "attack-ancestor"); const raceLive = path.join(raceRoot, "live"); const raceReplacement = path.join(raceRoot, "replacement"); const raceOld = path.join(raceRoot, "old"); mkdirSync(raceRoot); mkdirSync(raceLive); mkdirSync(raceReplacement); writeFileSync(path.join(raceLive, "anchor.json"), readFileSync(chain.paths.p0AnchorPath)); writeFileSync(path.join(raceReplacement, "anchor.json"), readFileSync(chain.paths.p0AnchorPath));
  exercise("ancestor-toctou", () => { let swapped = false; const hooks = { ...testHooks, onExternalSnapshotBoundary(event) { if (!swapped && event.label === "p0_anchor" && event.boundary === "ancestors-captured") { renameSync(raceLive, raceOld); renameSync(raceReplacement, raceLive); swapped = true; } } }; return viaRunAudit({ ...p0AuditOptions, p0Anchor: path.join(raceLive, "anchor.json") }, hooks); });

  exercise("p1-dataset-rehash", () => { const attacked = structuredClone(datasetExpected); attacked.rawLineByteSha256 = "f".repeat(64); return p1ArtifactAttack("teacherDataset", replaceJsonlRow(chain.paths.datasetPath, datasetIndex, attacked)); });
  exercise("p1-refined-rehash", () => { const attacked = structuredClone(refinedExpected); attacked.policyCanonicalSha256 = "f".repeat(64); return p1ArtifactAttack("teacherRefined", replaceJsonlRow(chain.paths.refinedPath, refinedIndex, attacked)); });
  exercise("p1-mask-rehash", () => { const attacked = structuredClone(maskExpected); attacked.warningCodes = []; return p1ArtifactAttack("teacherMask", replaceJsonlRow(chain.paths.maskPath, maskIndex, attacked)); });
  exercise("p1-source-rehash", () => { const attacked = structuredClone(chain.values.sourceManifestValue); attacked.clips[0].files.summary.byteSha256 = "f".repeat(64); return p1ArtifactAttack("teacherSourceManifest", jsonBuffer(rehash(attacked))); });
  exercise("compiler-r2-overclaim", () => runRebuiltP1(rebuildFullChain({ mutateP0Pack(pack) { pack.files.manualCompiler.path = "scripts/sam-goal-manual-pack-v2.mjs"; } })));
  exercise("unavailable-provenance-overclaim", () => { const attacked = structuredClone(chain.values.sourceManifestValue); attacked.provenance[0].availability = "verified"; attacked.provenance[0].sha256 = "f".repeat(64); return p1ArtifactAttack("teacherSourceManifest", jsonBuffer(rehash(attacked))); });
  exercise("live-student-avatar-leakage", () => { const attacked = structuredClone(chain.values.summaryValue); attacked.liveError = 0; return p1ArtifactAttack("teacherSummary", jsonBuffer(rehash(attacked))); });

  const expectedCaseIds = requestedCaseIds ? [...requestedCaseIds] : attackCatalog.cases.map((entry) => entry.caseId);
  const missing = expectedCaseIds.filter((id) => !executed.has(id));
  assert.deepEqual(missing, [], `catalog cases not executed: ${missing.join(",")}`);
  const actualExecutionPaths = Object.fromEntries([...new Set([...observedPaths.values()].flat())].sort().map((executionPath) => [executionPath, [...observedPaths.values()].filter((paths) => paths[0] === executionPath).length]));
  const publicSemanticCases = attackCatalog.cases.filter((entry) => executed.has(entry.caseId) && (entry.classification === "semantic-rehash" || entry.classification.startsWith("public-input") || entry.classification.startsWith("public-authority"))).map((entry) => entry.caseId);
  for (const caseId of publicSemanticCases) assert.equal((observedPaths.get(caseId) || [])[0], "runAudit", `public semantic case bypassed runAudit:${caseId}`);
  return { count: executed.size, completeCatalog: requestedCaseIds === null, selectedCases: expectedCaseIds.sort(), executionPaths: actualExecutionPaths, publicSemanticCoverage: { count: publicSemanticCases.length, cases: publicSemanticCases } };
}

function validateCompleteInstanceMatrix(chain) {
  const authoringSchema = chain.p0.loaded.authoringSchema.value;
  const schemaRoots = { teacher: core.teacherSchema, label: core.labelSchema, p0Anchor: core.p0AnchorSchema, p1Anchor: core.p1AnchorSchema, authoring: authoringSchema };
  const cases = [];
  const add = (family, id, schema, def, expectedValid, value) => cases.push({ family, id, schema, def, expectedValid, value });
  const changed = (value, mutate) => { const copy = structuredClone(value); mutate(copy); return copy; };

  const selectedDataset = chain.artifacts.datasetRows.find((row) => row.derivedSelection.rawPersonIndex !== null);
  const unavailableDataset = chain.artifacts.datasetRows.find((row) => row.derivedSelection.rawPersonIndex === null);
  add("dataset", "dataset-selected", "teacher", "datasetRow", true, selectedDataset);
  add("dataset", "dataset-unavailable", "teacher", "datasetRow", true, unavailableDataset);
  add("dataset", "dataset-extra", "teacher", "datasetRow", false, changed(selectedDataset, (row) => { row.extra = true; }));
  add("dataset", "dataset-missing-raw-line", "teacher", "datasetRow", false, changed(selectedDataset, (row) => { delete row.rawLineBase64; }));
  add("dataset", "dataset-wrong-type", "teacher", "datasetRow", false, changed(selectedDataset, (row) => { row.artifactType = "teacher-dataset-row-v1"; }));
  add("dataset", "dataset-selection-nullability", "teacher", "datasetRow", false, changed(selectedDataset, (row) => { row.derivedSelection.selectedTrackId = null; }));

  refinementMatrixValid.forEach((value, index) => add("refined", `refined-valid-${index}`, "teacher", "refinedRow", true, value));
  refinementMatrixInvalid.forEach((value, index) => add("refined", `refined-invalid-${index}`, "teacher", "refinedRow", false, value));

  const validMask = chain.artifacts.maskRows.find((row) => row.valid);
  const invalidMask = chain.artifacts.maskRows.find((row) => !row.valid);
  add("mask", "mask-valid-scope", "teacher", "maskRow", true, validMask);
  add("mask", "mask-invalid-scope", "teacher", "maskRow", true, invalidMask);
  add("mask", "mask-extra", "teacher", "maskRow", false, changed(validMask, (row) => { row.extra = true; }));
  add("mask", "mask-missing-scope", "teacher", "maskRow", false, changed(validMask, (row) => { delete row.scope; }));
  add("mask", "mask-wrong-artifact", "teacher", "maskRow", false, changed(validMask, (row) => { row.artifactType = "teacher-mask-row-v1"; }));
  add("mask", "mask-scope-type", "teacher", "maskRow", false, changed(validMask, (row) => { row.scope.torsoFacing = "true"; }));

  const source = chain.values.sourceManifestValue;
  add("sourceManifest", "source-valid", "teacher", "teacherSourceManifest", true, source);
  add("sourceManifest", "source-extra", "teacher", "teacherSourceManifest", false, changed(source, (value) => { value.extra = true; }));
  add("sourceManifest", "source-wrong-artifact", "teacher", "teacherSourceManifest", false, changed(source, (value) => { value.artifactType = "teacher-source-manifest-v1"; }));
  add("sourceManifest", "source-missing-clips", "teacher", "teacherSourceManifest", false, changed(source, (value) => { delete value.clips; }));

  const p0Pack = chain.values.p0Manifest;
  add("p0Pack", "p0-pack-valid", "label", "p0PackManifest", true, p0Pack);
  add("p0Pack", "p0-pack-extra", "label", "p0PackManifest", false, changed(p0Pack, (value) => { value.extra = true; }));
  add("p0Pack", "p0-pack-wrong-phase", "label", "p0PackManifest", false, changed(p0Pack, (value) => { value.phase = "p1-candidate"; }));
  add("p0Pack", "p0-pack-missing-files", "label", "p0PackManifest", false, changed(p0Pack, (value) => { delete value.files; }));

  const p0Anchor = chain.values.p0AnchorValue;
  add("p0Anchor", "p0-anchor-valid", "p0Anchor", null, true, p0Anchor);
  add("p0Anchor", "p0-anchor-extra", "p0Anchor", null, false, changed(p0Anchor, (value) => { value.extra = true; }));
  add("p0Anchor", "p0-anchor-version", "p0Anchor", null, false, changed(p0Anchor, (value) => { value.schemaVersion = 1; }));
  add("p0Anchor", "p0-anchor-logical-path", "p0Anchor", null, false, changed(p0Anchor, (value) => { value.sealedInputs.reviewA.logicalPath = "actual/review-a.json"; }));
  add("p0Anchor", "p0-anchor-missing-dependencies", "p0Anchor", null, false, changed(p0Anchor, (value) => { delete value.dependencies; }));

  const p1Pack = chain.values.p1Manifest;
  add("p1Pack", "p1-pack-valid", "teacher", "p1PackManifest", true, p1Pack);
  add("p1Pack", "p1-pack-extra", "teacher", "p1PackManifest", false, changed(p1Pack, (value) => { value.extra = true; }));
  add("p1Pack", "p1-pack-role", "teacher", "p1PackManifest", false, changed(p1Pack, (value) => { value.targetRole = "raw_hard"; }));
  add("p1Pack", "p1-pack-external-path", "teacher", "p1PackManifest", false, changed(p1Pack, (value) => { value.files.externalP0Anchor = { path: chain.paths.p0AnchorPath, canonicalSha256: chain.p0Anchor.hash, byteSha256: value.files.externalP0Anchor.byteSha256 }; }));

  const p1Anchor = chain.values.p1AnchorValue;
  add("p1Anchor", "p1-anchor-valid", "p1Anchor", null, true, p1Anchor);
  add("p1Anchor", "p1-anchor-extra", "p1Anchor", null, false, changed(p1Anchor, (value) => { value.extra = true; }));
  add("p1Anchor", "p1-anchor-artifact", "p1Anchor", null, false, changed(p1Anchor, (value) => { value.artifactType = "sam-goal-p1-anchor"; }));
  add("p1Anchor", "p1-anchor-missing-teacher", "p1Anchor", null, false, changed(p1Anchor, (value) => { delete value.teacherArtifacts; }));

  add("authoringReview", "review-first-valid", "authoring", "review", true, chain.sealedValues[0]);
  add("authoringReview", "review-second-valid", "authoring", "review", true, chain.sealedValues[1]);
  add("authoringReview", "review-v2", "authoring", "review", false, changed(chain.sealedValues[0], (value) => { value.artifactType = "manual-review-authoring-v2"; value.schemaVersion = 1; }));
  add("authoringReview", "review-role", "authoring", "review", false, changed(chain.sealedValues[0], (value) => { value.role = "adjudication"; }));
  add("authoringReview", "review-actor", "authoring", "review", false, changed(chain.sealedValues[0], (value) => { value.reviewerPseudonymSha256 = "bad"; }));
  add("authoringAdjudication", "adjudication-valid", "authoring", "adjudication", true, chain.sealedValues[2]);
  add("authoringAdjudication", "adjudication-v2", "authoring", "adjudication", false, changed(chain.sealedValues[2], (value) => { value.artifactType = "manual-adjudication-authoring-v2"; value.schemaVersion = 1; }));
  add("authoringAdjudication", "adjudication-role", "authoring", "adjudication", false, changed(chain.sealedValues[2], (value) => { value.role = "first"; }));
  add("authoringAdjudication", "adjudication-missing-actor", "authoring", "adjudication", false, changed(chain.sealedValues[2], (value) => { delete value.adjudicatorPseudonymSha256; }));

  const customResults = cases.map((entry) => {
    const root = schemaRoots[entry.schema]; const schema = entry.def ? root.$defs[entry.def] : root;
    let valid = true;
    try { validateSchemaValue(root, schema, entry.value, `matrix/${entry.id}`); } catch { valid = false; }
    assert.equal(valid, entry.expectedValid, `custom matrix drift: ${entry.id}`);
    return valid;
  });
  const matrixPath = path.join(tempRoot, "complete-instance-matrix.json");
  writeStableJson(matrixPath, { schemas: schemaRoots, cases });
  const python = spawnSync("python3", ["-c", "import json,sys\nfrom jsonschema import Draft202012Validator,RefResolver\nb=json.load(open(sys.argv[1],encoding='utf-8'))\nout=[]\nfor c in b['cases']:\n r=b['schemas'][c['schema']]; s=r if c['def'] is None else r['$defs'][c['def']]; v=Draft202012Validator(s,resolver=RefResolver.from_schema(r)); out.append(not bool(list(v.iter_errors(c['value']))))\nprint(json.dumps(out))", matrixPath], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
  assert.equal(python.status, 0, python.stderr || python.stdout);
  const pythonResults = JSON.parse(python.stdout);
  assert.deepEqual(pythonResults, customResults, "custom/Python instance matrix parity drift");
  cases.forEach((entry, index) => assert.equal(pythonResults[index], entry.expectedValid, `Python matrix drift: ${entry.id}`));
  const families = Object.fromEntries([...new Set(cases.map((entry) => entry.family))].map((family) => [family, { valid: cases.filter((entry) => entry.family === family && entry.expectedValid).length, invalid: cases.filter((entry) => entry.family === family && !entry.expectedValid).length }]));
  return { total: cases.length, valid: cases.filter((entry) => entry.expectedValid).length, invalid: cases.filter((entry) => !entry.expectedValid).length, families };
}

if (fullChainWorkerMode) {
  const chain = buildAndAuditClosedChain();
  const instanceMatrix = validateCompleteInstanceMatrix(chain);
  const attackResult = runClosedChainAttacks(chain);
  console.log(JSON.stringify({ status: "passed", syntheticOnly: true, p0Candidate: chain.p0.manifestHash, p0Anchor: chain.p0Anchor.hash, datasetRows: chain.p1.dataset.rows.length, refinedRows: chain.p1.refined.rows.length, maskRows: chain.p1.mask.rows.length, p1Anchor: chain.p1Anchor.hash, executedAttacks: attackResult.count, completeCatalog: attackResult.completeCatalog, selectedCases: attackResult.selectedCases, executionPaths: attackResult.executionPaths, publicSemanticCoverage: attackResult.publicSemanticCoverage, instanceMatrix }, null, 2));
  cleanup();
  process.exit(0);
}

const fullChain = spawnSync(process.execPath, ["--max-old-space-size=4096", fileURLToPath(import.meta.url), "--full-chain-worker"], { cwd: ROOT, encoding: "utf8", timeout: 3_600_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NODE_ENV: "test", SAM_V3_WORKER_DEPTH: "1" } });
check(() => assert.equal(fullChain.status, 0, fullChain.stderr || fullChain.stdout));
const fullChainReport = JSON.parse(fullChain.stdout.trim());
check(() => assert.equal(fullChainReport.datasetRows, 6711));
check(() => assert.equal(fullChainReport.refinedRows, 6711));
check(() => assert.equal(fullChainReport.maskRows, 6711));
check(() => assert.equal(fullChainReport.executedAttacks, attackCatalog.cases.length));
check(() => assert.equal(fullChainReport.completeCatalog, true));
check(() => assert.deepEqual(fullChainReport.executionPaths, { cli: 5, helper: 5, runAudit: 86 }));
check(() => assert.equal(fullChainReport.publicSemanticCoverage.count, 84));
check(() => assert.equal(new Set(fullChainReport.publicSemanticCoverage.cases).size, 84));
check(() => assert.equal(fullChainReport.instanceMatrix.total >= 50, true));
check(() => assert.equal(fullChainReport.instanceMatrix.valid > 0 && fullChainReport.instanceMatrix.invalid > 0, true));
check(() => assert.deepEqual(Object.keys(fullChainReport.instanceMatrix.families).sort(), ["authoringAdjudication", "authoringReview", "dataset", "mask", "p0Anchor", "p0Pack", "p1Anchor", "p1Pack", "refined", "sourceManifest"].sort()));

const packDir = path.join(tempRoot, "pack"); const outsideDir = path.join(tempRoot, "outside"); mkdirSync(packDir); mkdirSync(outsideDir);
const regularAnchor = path.join(outsideDir, "anchor.json"); writeFileSync(regularAnchor, "{}\n");
check(() => assert.equal(externalAnchorSnapshot(regularAnchor, "probe", packDir, []).byteSha256, sha256(Buffer.from("{}\n"))));
check(() => assert.equal(externalAnchorSnapshot(path.relative(ROOT, regularAnchor), "cwd-relative", packDir, []).realpath, realpathSync(regularAnchor)));
const insideAnchor = path.join(packDir, "inside.json"); writeFileSync(insideAnchor, "{}\n");
check(() => throwsCode(() => externalAnchorSnapshot(insideAnchor, "inside", packDir, []), "anchor_inside_pack"));
const symlinkAnchor = path.join(outsideDir, "symlink.json"); symlinkSync(regularAnchor, symlinkAnchor);
check(() => throwsCode(() => externalAnchorSnapshot(symlinkAnchor, "symlink", packDir, []), "anchor_not_plain_regular"));
const hardlinkSource = path.join(outsideDir, "hard-source.json"); const hardlinkAnchor = path.join(outsideDir, "hard-anchor.json"); writeFileSync(hardlinkSource, "{}\n"); linkSync(hardlinkSource, hardlinkAnchor);
check(() => throwsCode(() => externalAnchorSnapshot(hardlinkAnchor, "hardlink", packDir, []), "anchor_link_count"));
const finalRace = path.join(outsideDir, "final-race.json"); const finalRaceReplacement = path.join(outsideDir, "final-race-replacement.json"); const finalRaceOld = path.join(outsideDir, "final-race-old.json");
writeFileSync(finalRace, "{\"old\":true}\n"); writeFileSync(finalRaceReplacement, "{\"new\":true}\n");
check(() => throwsCode(() => externalAnchorSnapshot(finalRace, "final-race", packDir, [], { onExternalSnapshotBoundary(event) { if (event.boundary === "final-lstat") { renameSync(finalRace, finalRaceOld); renameSync(finalRaceReplacement, finalRace); } } }), "external_final_replaced"));
const ancestorRaceRoot = path.join(outsideDir, "ancestor-race"); const ancestorLive = path.join(ancestorRaceRoot, "live"); const ancestorReplacement = path.join(ancestorRaceRoot, "replacement"); const ancestorOld = path.join(ancestorRaceRoot, "old");
mkdirSync(ancestorRaceRoot); mkdirSync(ancestorLive); mkdirSync(ancestorReplacement); writeFileSync(path.join(ancestorLive, "anchor.json"), "{}\n"); writeFileSync(path.join(ancestorReplacement, "anchor.json"), "{}\n");
check(() => throwsCode(() => externalAnchorSnapshot(path.join(ancestorLive, "anchor.json"), "ancestor-race", packDir, [], { onExternalSnapshotBoundary(event) { if (event.boundary === "ancestors-captured") { renameSync(ancestorLive, ancestorOld); renameSync(ancestorReplacement, ancestorLive); } } }), "external_ancestor_replaced"));

const historical = [
  ["tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json", "a0f7a52da26a2c4f0c318259c6547e89fc35048ddf031398b87666b75508fd32"],
  ["tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json", "1c27fac6cd82f521a7491672c74263f98866f0a9c66c6b3273d452c4196dfdb3"],
  ["tests/fixtures/sam-goal-v2/evaluation-v2/authoring-schema.json", "1e2c74a4d382afaf4f69857e34e3389e636324a1f7be7b4135dfcaad814df7cc"],
  ["tests/fixtures/sam-goal-v2/evaluation-v2/p0-lock-anchor-schema.json", "5fb22bf90e604acff911799344b7993239a463b6a4af278404aae766f3e49d85"],
  ["scripts/sam-goal-label-audit-v2.mjs", "1b9870e99e0dea093925e1ed0b5f9ed3cd9d146315482a38e640006e7968fdf6"],
  ["scripts/sam-goal-manual-pack-v2.mjs", "6f0b54dd124368e30fb42c330e6d2b762f72e7d63b268e478bd3afb7a888f8dd"],
];
check(() => assert.deepEqual(historical.map(([name]) => sha256(readFileSync(path.join(ROOT, name)))), historical.map(([, hash]) => hash)));
check(() => assert.equal(sha256(readFileSync(path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl"))), "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79"));
check(() => assert.equal(canonicalHash(core.decoderRows), "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d"));

const emptyPack = path.join(tempRoot, "empty-pack"); mkdirSync(emptyPack);
const earlyAuthorityPath = path.join(outsideDir, "early-authority.json"); writeStableJson(earlyAuthorityPath, withSelfHash({ artifactType: "synthetic-early-authority" }));
check(() => throwsCode(() => runAudit({ labelDir: emptyPack, phase: "p0", p0Anchor: earlyAuthorityPath, expectedP0: "f".repeat(64), reviewA: path.join(tempRoot, "must-not-open-a"), reviewB: path.join(tempRoot, "must-not-open-b"), adjudication: path.join(tempRoot, "must-not-open-adjudication") }), "p0_anchor_expected_mismatch"));
check(() => assert.equal(existsSync(path.join(tempRoot, "must-not-open-a")), false));
const failedCli = spawnSync(process.execPath, [AUDIT, "--label-dir", emptyPack, "--phase", "p0-candidate"], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
check(() => assert.notEqual(failedCli.status, 0));
check(() => assert.equal(JSON.parse(failedCli.stdout).status, "failed"));
check(() => assert.deepEqual(readdirSync(emptyPack), []));
const rejectedP1SealedCli = spawnSync(process.execPath, [AUDIT, "--label-dir", path.join(tempRoot, "must-not-open-pack"), "--phase", "p1", "--p0-anchor", path.join(tempRoot, "must-not-open-p0"), "--expected-p0-anchor-sha256", "a".repeat(64), "--p1-anchor", path.join(tempRoot, "must-not-open-p1"), "--expected-p1-anchor-sha256", "b".repeat(64), "--review-a", path.join(tempRoot, "must-not-open-review")], { cwd: ROOT, encoding: "utf8", timeout: 30000 });
check(() => assert.notEqual(rejectedP1SealedCli.status, 0));
check(() => assert.equal(JSON.parse(rejectedP1SealedCli.stdout).errors[0].code, "phase_argument_set_invalid"));
check(() => assert.equal(existsSync(path.join(tempRoot, "must-not-open-pack")), false));
for (const signal of ["SIGINT", "SIGTERM"]) {
  const cleanupMarker = path.join(tempRoot, `cleanup-probe-${signal}.json`);
  const cleanupProbe = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--cleanup-probe", cleanupMarker, signal], { cwd: ROOT, encoding: "utf8", timeout: 30000, env: { ...process.env, SAM_V3_WORKER_DEPTH: "cleanup" } });
  check(() => assert.equal(cleanupProbe.status === (signal === "SIGINT" ? 130 : 143) || cleanupProbe.signal === signal, true, cleanupProbe.stderr));
  const cleanupPaths = JSON.parse(readFileSync(cleanupMarker, "utf8"));
  check(() => assert.equal(cleanupPaths.mode, "cleanup-only"));
  check(() => assert.equal(cleanupPaths.normalSuiteStarted, false));
  check(() => assert.equal(cleanupPaths.spawnedChildren, 0));
  check(() => assert.equal(existsSync(cleanupPaths.tempRoot), false));
  check(() => assert.equal(existsSync(cleanupPaths.fixtureRuntime), false));
  const descendants = spawnSync("ps", ["-axo", "ppid="], { encoding: "utf8" }).stdout.split(/\s+/).filter(Boolean).map(Number);
  check(() => assert.equal(descendants.includes(cleanupPaths.pid), false));
}

cleanup();
check(() => assert.equal(readdirSync(tempParent).filter((name) => name.startsWith("sam-eval-v3-test-")).map((name) => path.join(tempParent, name)).filter((entry) => !beforeTemps.has(entry)).length, 0));
check(() => assert.equal(readdirSync(fixtureRuntimeParent).filter((name) => name.startsWith("runtime-test-")).map((name) => path.join(fixtureRuntimeParent, name)).filter((entry) => !beforeFixtureRuntimes.has(entry)).length, 0));
console.log(JSON.stringify({ status: "passed", checks, exactTeacherRows: teacher.totalRows, exactPersons: 6675, armsMisses: 37, csiCarryForwardFallbacks: 163, syntheticP0Anchor: fullChainReport.p0Anchor, syntheticP1Anchor: fullChainReport.p1Anchor, executedCatalogAttacks: fullChainReport.executedAttacks, observedExecutionPaths: fullChainReport.executionPaths, publicSemanticCoverage: fullChainReport.publicSemanticCoverage, instanceMatrix: fullChainReport.instanceMatrix, draft202012Schemas: 4, signalCleanupProbes: 2, temporaryResidue: 0, wallTimeMs: Number(process.hrtime.bigint() - suiteStartedAt) / 1e6, maxRssKb: process.resourceUsage().maxRSS }, null, 2));
