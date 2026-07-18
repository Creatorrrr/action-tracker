import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "scripts/sam-goal-label-audit-v2.mjs");
const CONTRACT_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json");
const SCHEMA_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json");
const DECODER_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl");
const SOURCE_INVENTORY_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/source-inventory.json");
const V1_PATHS = [
  "tests/fixtures/sam-goal-v2/evaluation-contract.json", "tests/fixtures/sam-goal-v2/label-schema.json",
  "scripts/sam-goal-label-audit.mjs", "docs/sam-goal-evaluation-contract.md",
  "tests/fixtures/sam-goal-v2/source-contract.json", "tests/fixtures/sam-goal-v2/source-schema.json",
  "scripts/sam-goal-source-pts.mjs", "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl", "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
];
const EXPECTED_PRESERVED = [
  "7883afc32fa882eec62b015d882526762dfa132a099ed603e445623159afa3a4",
  "1ae3fa22f47043d014d9cb40b45d28b319e25da390e90e03dbdbbc1a5e10f765",
  "7ca0a0728da03fbe1982e2cf79150dfd41aea3bb6b2cea7948f6208044bcbdee",
  "3584aad52c0bad10f87d0cd67203d3678e6b9a524ed9c570e82e90a03ea71559",
  "3271fde0dfe2cea9875ef0fbf1bada7788a7904a9a8a3f1e4e10dd0eaa4539e3",
  "7a9fa1e3ddbacc7c1133b44aa10a041b14487c7049e5769a522ba01c681dabf4",
  "36c1e1e97af4c79eacd8cdf001156512b4952210cfda7bdaad60560a6d9ca081",
  "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79",
  "e4289a7e0d3503fe163e315317f4532b0c8565929491d82303456b512b0e2fd7",
];
const CONTRACT_HASH = "7a7f26a4734d0c971ecc2bef542dd05da11d67134478a2db286e1cd242bb5897";
const SCHEMA_HASH = "38759400e1e5aacb1b06bf3b052a5af8f693366dfa93653d0520280723c8e146";
const suiteStarted = process.hrtime.bigint();
const tempParent = path.resolve(os.tmpdir());
const ownedTempRootsBefore = new Set(readdirSync(tempParent).filter((name) => /^sam-eval-v2-[A-Za-z0-9]+$/.test(name)).map((name) => path.join(tempParent, name)));
const tempRoot = mkdtempSync(path.join(tempParent, "sam-eval-v2-"));
let tempCleaned = false;
function cleanupTempRoot() {
  if (tempCleaned) return;
  const resolved = path.resolve(tempRoot);
  const safe = path.dirname(resolved) === tempParent && /^sam-eval-v2-[A-Za-z0-9]+$/.test(path.basename(resolved));
  if (!safe) throw new Error(`unsafe_temp_cleanup_refused:${resolved}`);
  rmSync(resolved, { recursive: true, force: true });
  tempCleaned = true;
}
process.on("exit", cleanupTempRoot);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanupTempRoot(); process.exit(signal === "SIGINT" ? 130 : 143); });
const cleanupProbeIndex = process.argv.indexOf("--cleanup-probe");
if (cleanupProbeIndex >= 0) {
  const markerPath = process.argv[cleanupProbeIndex + 1];
  if (!markerPath) throw new Error("cleanup_probe_marker_required");
  writeFileSync(markerPath, tempRoot);
  mkdirSync(path.join(tempRoot, "nested"), { recursive: true });
  writeFileSync(path.join(tempRoot, "nested", "residue.bin"), Buffer.alloc(1024 * 1024));
  throw new Error("intentional_cleanup_probe_failure");
}
const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
const decoderRows = readFileSync(DECODER_PATH, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(decoderRows.length, 6711);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value, omitRoot = false) {
  let target = value;
  if (omitRoot) { target = { ...value }; delete target.expectedCanonicalHash; }
  return sha(JSON.stringify(stable(target)));
}
function withHash(value) { const result = { ...value, expectedCanonicalHash: "" }; result.expectedCanonicalHash = canonical(result, true); return result; }
function jsonl(rows) { return `${rows.map((row) => JSON.stringify(row)).join("\n")}${rows.length ? "\n" : ""}`; }
function writeJson(filePath, value) { writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function identity(row) { return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch }; }
function key(rowIdentity) { return `${rowIdentity.clipId}:${rowIdentity.sourceFrameIndex}`; }
function readRows(filePath) { return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
function state(label, subject) {
  return {
    presence: label.presence, personState: label.personState, occlusion: label.occlusion, contact: label.contact,
    handObservability: label.handObservability, endpointObservability: label.endpointObservability,
    subjectSelection: { state: subject.state, manualTargetId: subject.manualTargetId, anchor: subject.anchor },
  };
}

const preservedBefore = V1_PATHS.map((file) => sha(readFileSync(path.join(ROOT, file))));
assert.deepEqual(preservedBefore, EXPECTED_PRESERVED);

const absence = new Set([
  ...Array.from({ length: 7 }, (_, i) => `arms-crossed:${i}`),
  ...Array.from({ length: 7 }, (_, i) => `arms-crossed:${30 + i}`),
  ...Array.from({ length: 7 }, (_, i) => `csi-pose:${i}`),
]);
const multipleKey = "csi-pose:100";

function makePresentLabel(row, index, options) {
  const contactClass = options.lowContactSupport ? "planted" : (row.sourceFrameIndex % 2 === 0 ? "planted" : "moving");
  const otherClass = options.lowContactSupport ? "planted" : (contactClass === "planted" ? "moving" : "planted");
  return {
    artifactType: "manual-label-v2", labelId: `label-${index}`, span: { kind: "frame", identity: identity(row) },
    scenarios: [row.clipId.includes("dance") ? "full_body_dance" : "neutral"], presence: "present",
    personState: key(identity(row)) === multipleKey ? "multiple_people" : "single_target",
    occlusion: { body: "observable", leftFoot: "observable", rightFoot: "observable", leftHand: "observable", rightHand: "observable" },
    contact: { left: contactClass, right: otherClass }, handObservability: { left: "observable", right: "observable" },
    endpointObservability: { leftWrist: "observable", rightWrist: "observable", leftAnkle: "observable", rightAnkle: "observable", head: "observable" },
    provenance: { origin: "manual_video", reviewStatus: "adjudicated" },
  };
}
function makeAbsentLabel(row, index) {
  return {
    artifactType: "manual-label-v2", labelId: `label-${index}`, span: { kind: "frame", identity: identity(row) }, scenarios: ["entry_exit"],
    presence: "absent", personState: "absent", occlusion: { body: "out_of_frame", leftFoot: "out_of_frame", rightFoot: "out_of_frame", leftHand: "out_of_frame", rightHand: "out_of_frame" },
    contact: { left: "unknown", right: "unknown" }, handObservability: { left: "not_observable", right: "not_observable" },
    endpointObservability: { leftWrist: "not_observable", rightWrist: "not_observable", leftAnkle: "not_observable", rightAnkle: "not_observable", head: "not_observable" },
    provenance: { origin: "manual_video", reviewStatus: "adjudicated" },
  };
}

function baseDescriptors(dir) {
  const canonicalDescriptor = (name) => ({ path: name, canonicalSha256: canonical(JSON.parse(readFileSync(path.join(dir, name), "utf8")), true) });
  const byteDescriptor = (name) => ({ path: name, byteSha256: sha(readFileSync(path.join(dir, name))) });
  return {
    contract: { path: "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json", canonicalSha256: CONTRACT_HASH },
    schema: { path: "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json", canonicalSha256: SCHEMA_HASH },
    sourceInventory: { path: "tests/fixtures/sam-goal-v2/labels/source-inventory.json", canonicalSha256: "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d" },
    decoderManifest: { path: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl", byteSha256: "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79" },
    manualWindows: canonicalDescriptor("manual-windows.json"), manualLabels: byteDescriptor("manual-labels.jsonl"),
    manualSubjectSelection: byteDescriptor("manual-subject-selection.jsonl"), manualReviewPass1: byteDescriptor("manual-review-pass1.jsonl"),
    manualReviewPass2: byteDescriptor("manual-review-pass2.jsonl"), manualAdjudication: byteDescriptor("manual-adjudication.jsonl"),
    manualPolicy: canonicalDescriptor("manual-policy.json"), manualSummary: canonicalDescriptor("manual-summary.json"),
  };
}
function rewriteP0Manifest(dir) {
  const manifest = withHash({ artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p0", files: baseDescriptors(dir) });
  writeJson(path.join(dir, "evaluation-pack.json"), manifest); return manifest.expectedCanonicalHash;
}
function rewriteP1(dir, p0Hash) {
  const descriptors = { ...baseDescriptors(dir), teacherMask: { path: "teacher-valid-mask.jsonl", byteSha256: sha(readFileSync(path.join(dir, "teacher-valid-mask.jsonl"))) } };
  const p1 = withHash({ artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p1", parentP0LockSha256: p0Hash, files: descriptors });
  writeJson(path.join(dir, "evaluation-pack-p1.json"), p1);
  const lock = withHash({ artifactType: "evaluation-lock-v2", schemaVersion: 2, phase: "p1", parentP0LockSha256: p0Hash, teacherMaskSha256: descriptors.teacherMask.byteSha256 });
  writeJson(path.join(dir, "evaluation-lock-p1.json"), lock);
}

function buildPack(dir, options = {}) {
  mkdirSync(dir, { recursive: true });
  const useAbsence = options.noReacquire ? new Set() : absence;
  const labels = decoderRows.map((row, index) => useAbsence.has(key(identity(row))) ? makeAbsentLabel(row, index) : makePresentLabel(row, index, options));
  const subjects = decoderRows.map((row, index) => {
    const absent = useAbsence.has(key(identity(row)));
    return {
      artifactType: "manual-subject-selection-v2", selectionId: `subject-${index}`, span: { kind: "frame", identity: identity(row) },
      state: absent ? "absent" : "selected", manualTargetId: absent ? null : `target-${row.clipId}`,
      anchor: absent ? null : (key(identity(row)) === multipleKey ? { x: 0.5, y: 0.5 } : null), evidence: "manual_video",
    };
  });
  if (options.nonReliableGap || options.dedupGap) {
    const gapIndex = decoderRows.findIndex((row) => row.clipId === "arms-crossed" && row.sourceFrameIndex === 7);
    labels[gapIndex].personState = "unknown";
    subjects[gapIndex].state = "absent"; subjects[gapIndex].manualTargetId = null; subjects[gapIndex].anchor = null;
  }
  if (options.dedupGap) {
    for (let frame = 8; frame < 15; frame += 1) {
      const index = decoderRows.findIndex((row) => row.clipId === "arms-crossed" && row.sourceFrameIndex === frame);
      labels[index] = makeAbsentLabel(decoderRows[index], index);
      subjects[index].state = "absent"; subjects[index].manualTargetId = null; subjects[index].anchor = null;
    }
  }
  const first = labels.map((label, index) => ({ artifactType: "manual-review-v2", pass: "first", reviewerHash: "1".repeat(64), identity: label.span.identity, reviewed: true, origin: "manual", state: state(label, subjects[index]) }));
  const second = first.map((row) => ({ ...row, pass: "second", reviewerHash: "2".repeat(64), state: structuredClone(row.state) }));
  const adjudication = [];
  if (!options.zeroDisagreement) {
    const disagreementIndexes = options.lowKappa ? labels.map((_, index) => index).filter((index) => index % 2 === 0 && labels[index].presence === "present") : [1000];
    for (const index of disagreementIndexes) {
      const current = second[index].state.contact.left;
      second[index].state.contact.left = current === "planted" ? "moving" : "planted";
      adjudication.push({ artifactType: "manual-adjudication-v2", adjudicatorHash: "3".repeat(64), identity: labels[index].span.identity, disagreementFields: ["contact.left"], decision: state(labels[index], subjects[index]), origin: "manual", adjudicated: true });
    }
  }
  const windows = contract.sourceBinding.paired.map((clip) => ({ windowId: `base-${clip.clipId}`, clipId: clip.clipId, startPtsTicks: clip.startPtsTicks, endPtsTicksExclusive: clip.endPtsTicksExclusive, expectedDecoderRows: clip.rows, purposeTags: ["full_clip_denominator"], scenarioTags: ["neutral"] }));
  const arms = decoderRows.filter((row) => row.clipId === "arms-crossed");
  windows.push({ windowId: "overlay-reacquire", clipId: "arms-crossed", startPtsTicks: arms[0].ptsTicks, endPtsTicksExclusive: arms[20].ptsTicks, expectedDecoderRows: 20, purposeTags: ["absence_reacquire"], scenarioTags: ["reacquire"] });
  writeJson(path.join(dir, "manual-windows.json"), withHash({ artifactType: "manual-windows-v2", schemaVersion: 2, windows }));
  writeFileSync(path.join(dir, "manual-labels.jsonl"), jsonl(labels));
  writeFileSync(path.join(dir, "manual-subject-selection.jsonl"), jsonl(subjects));
  writeFileSync(path.join(dir, "manual-review-pass1.jsonl"), jsonl(first));
  writeFileSync(path.join(dir, "manual-review-pass2.jsonl"), jsonl(second));
  writeFileSync(path.join(dir, "manual-adjudication.jsonl"), jsonl(adjudication));
  writeJson(path.join(dir, "manual-policy.json"), withHash({ artifactType: "manual-policy-v2", schemaVersion: 2, contractCanonicalSha256: CONTRACT_HASH, schemaCanonicalSha256: SCHEMA_HASH, reviewerHashes: { first: "1".repeat(64), second: "2".repeat(64), adjudicator: "3".repeat(64) }, thresholds: { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95, preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2 } }));
  writeJson(path.join(dir, "manual-summary.json"), withHash({ artifactType: "manual-summary-v2", schemaVersion: 2, decoderRows: 6711, materializedManualRows: 6711, materializedSubjectRows: 6711, reviewPass1Rows: 6711, reviewPass2Rows: 6711, perClip: contract.sourceBinding.paired.map((clip) => ({ clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows })) }));
  const p0Hash = rewriteP0Manifest(dir);
  const teacherRows = decoderRows.map((row, index) => {
    const label = labels[index]; const subject = subjects[index]; const present = label.presence === "present";
    return {
      artifactType: "teacher-valid-v2", identity: identity(row), teacherRecord: "present", selectedSubject: subject.state,
      confidenceAvailable: false, jointConfidenceSource: "unavailable", detectorScoreProvenance: "detector", valid: present,
      scope: { torsoFacing: present, fullBody: present, calibration: false, contactEligibility: { left: present, right: present } },
      manual: {
        presence: label.presence, bodyObservable: ["observable", "partial"].includes(label.occlusion.body),
        leftLegObservable: ["observable", "partial"].includes(label.occlusion.body) && label.occlusion.leftFoot === "observable",
        rightLegObservable: ["observable", "partial"].includes(label.occlusion.body) && label.occlusion.rightFoot === "observable",
        leftFootObservable: label.occlusion.leftFoot === "observable", rightFootObservable: label.occlusion.rightFoot === "observable",
        leftContact: label.contact.left, rightContact: label.contact.right,
      },
      geometry: { finiteTorso: present, validTorsoBasis: present, inFrameProjection: present, finiteLeftLegChain: present, finiteRightLegChain: present, boneScaleSpeedTemporalGuards: present },
      exclusionReasons: present ? [] : ["manual_absent"], warningCodes: ["native_joint_confidence_unavailable"],
    };
  });
  writeFileSync(path.join(dir, "teacher-valid-mask.jsonl"), jsonl(teacherRows));
  rewriteP1(dir, p0Hash);
  return { p0Hash, labels, subjects, first, second, adjudication, teacherRows };
}

function runAudit(dir, phase, expected = "", extra = []) {
  const args = [AUDIT, "--label-dir", dir, "--phase", phase];
  if (expected) args.push("--expected-p0-lock-sha256", expected);
  args.push(...extra);
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}
function report(result) {
  try { return JSON.parse(result.stdout); }
  catch { assert.fail(`invalid report status=${result.status}\n${result.stdout}\n${result.stderr}`); }
}
function expectFailure(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout);
  const value = report(result); assert.equal(value.status, "failed"); assert.match(value.errors[0].detail, pattern);
}
function clonePack(source, name) { const target = path.join(tempRoot, name); cpSync(source, target, { recursive: true }); return target; }
function mutateJson(filePath, mutate) { const value = JSON.parse(readFileSync(filePath, "utf8")); mutate(value); writeJson(filePath, withHash(value)); }
function mutateRows(filePath, mutate) { const rows = readRows(filePath); mutate(rows); writeFileSync(filePath, jsonl(rows)); }
function flat(value, prefix = "", output = {}) {
  for (const [name, child] of Object.entries(value)) {
    const keyName = prefix ? `${prefix}.${name}` : name;
    if (child && typeof child === "object" && !Array.isArray(child)) flat(child, keyName, output); else output[keyName] = child;
  }
  return output;
}
function changedFields(left, right) {
  const a = flat(left); const b = flat(right);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((name) => JSON.stringify(a[name]) !== JSON.stringify(b[name])).sort();
}

const validDir = path.join(tempRoot, "valid");
const built = buildPack(validDir);

const candidateRun = runAudit(validDir, "p0");
assert.equal(candidateRun.status, 0, candidateRun.stdout || candidateRun.stderr);
const candidate = report(candidateRun);
assert.equal(candidate.status, "candidate");
assert.equal(candidate.frozen, false);
assert.equal(candidate.externallyVerified, false);
assert.equal(candidate.candidateP0LockSha256, built.p0Hash);
assert.equal(candidate.manual.rows, 6711);
assert.equal(candidate.manual.subjectRows, 6711);
assert.equal(candidate.reacquireCandidates.length, 3);
assert.ok(candidate.agreement.contactKappa >= 0.9);

const verifiedRun = runAudit(validDir, "p0", built.p0Hash);
assert.equal(verifiedRun.status, 0, verifiedRun.stdout || verifiedRun.stderr);
const verified = report(verifiedRun);
assert.equal(verified.status, "passed");
assert.equal(verified.frozen, true);
assert.equal(verified.externallyVerified, true);

const p1Run = runAudit(validDir, "p1", built.p0Hash);
assert.equal(p1Run.status, 0, p1Run.stdout || p1Run.stderr);
const p1 = report(p1Run);
assert.equal(p1.status, "passed");
assert.equal(p1.frozen, true);
assert.equal(p1.teacherRows, 6711);
assert.equal(p1.p1ReacquireStarts.length, 3);

expectFailure(runAudit(validDir, "p0", "0".repeat(64)), /external_p0_lock_mismatch/);
expectFailure(runAudit(validDir, "p1"), /expected_p0_lock_required/);

{
  const dir = clonePack(validDir, "tiny-base");
  mutateJson(path.join(dir, "manual-windows.json"), (value) => {
    const rows = decoderRows.filter((row) => row.clipId === "arms-crossed");
    value.windows[0].endPtsTicksExclusive = rows[10].ptsTicks; value.windows[0].expectedDecoderRows = 10;
  });
  expectFailure(runAudit(dir, "p0"), /base_window_binding/);
}
{
  const dir = clonePack(validDir, "terminal-omission");
  mutateJson(path.join(dir, "manual-windows.json"), (value) => {
    const rows = decoderRows.filter((row) => row.clipId === "arms-crossed");
    value.windows[0].endPtsTicksExclusive = rows.at(-1).ptsTicks; value.windows[0].expectedDecoderRows = rows.length - 1;
  });
  expectFailure(runAudit(dir, "p0"), /base_window_binding|base_denominator_hole/);
}
{
  const dir = clonePack(validDir, "fps-boundary");
  mutateJson(path.join(dir, "manual-windows.json"), (value) => { value.windows.at(-1).startPtsTicks = "513"; });
  expectFailure(runAudit(dir, "p0"), /boundary_not_decoder_pts/);
}
{
  const dir = clonePack(validDir, "unpaired-window");
  mutateJson(path.join(dir, "manual-windows.json"), (value) => { value.windows.at(-1).clipId = "jujae-full"; });
  expectFailure(runAudit(dir, "p0"), /window_clip_unpaired_or_unknown/);
}
{
  const dir = clonePack(validDir, "manual-hole");
  mutateRows(path.join(dir, "manual-labels.jsonl"), (rows) => rows.pop());
  expectFailure(runAudit(dir, "p0"), /manual_labels_coverage|manual_labels_hole/);
}
{
  const dir = clonePack(validDir, "subject-hole");
  mutateRows(path.join(dir, "manual-subject-selection.jsonl"), (rows) => rows.splice(100, 1));
  expectFailure(runAudit(dir, "p0"), /manual_subject_selection_coverage|manual_subject_selection_hole/);
}
{
  const dir = clonePack(validDir, "subject-target");
  mutateRows(path.join(dir, "manual-subject-selection.jsonl"), (rows) => { rows[100].manualTargetId = null; });
  expectFailure(runAudit(dir, "p0"), /subject_target_required/);
}
{
  const dir = clonePack(validDir, "multiple-anchor");
  mutateRows(path.join(dir, "manual-subject-selection.jsonl"), (rows) => {
    const row = rows.find((entry) => entry.span.identity.clipId === "csi-pose" && entry.span.identity.sourceFrameIndex === 100); row.anchor = null;
  });
  expectFailure(runAudit(dir, "p0"), /truth_multiple_people/);
}
{
  const dir = clonePack(validDir, "open-scenario");
  mutateRows(path.join(dir, "manual-labels.jsonl"), (rows) => { rows[100].scenarios = ["invented_scenario"]; });
  expectFailure(runAudit(dir, "p0"), /scenario_open/);
}
for (const [name, mutate, pattern] of [
  ["truth-absent", (row) => { row.presence = "absent"; }, /truth_absent/],
  ["truth-contact", (row) => { row.occlusion.leftFoot = "occluded"; }, /truth_contact/],
  ["truth-hand", (row) => { row.occlusion.leftHand = "occluded"; }, /truth_hand|truth_endpoint/],
  ["truth-endpoint", (row) => { row.occlusion.body = "unknown"; }, /truth_endpoint/],
]) {
  const dir = clonePack(validDir, name);
  mutateRows(path.join(dir, "manual-labels.jsonl"), (rows) => mutate(rows[100]));
  expectFailure(runAudit(dir, "p0"), pattern);
}
{
  const dir = clonePack(validDir, "forbidden-live");
  mutateRows(path.join(dir, "manual-labels.jsonl"), (rows) => { rows[100].livePrediction = 1; });
  expectFailure(runAudit(dir, "p0"), /forbidden_input_key/);
}
{
  const dir = clonePack(validDir, "wall-clock");
  mutateJson(path.join(dir, "manual-windows.json"), (value) => { value.generatedAt = "now"; });
  expectFailure(runAudit(dir, "p0"), /wall_clock_forbidden/);
}
{
  const dir = clonePack(validDir, "automated-review");
  mutateRows(path.join(dir, "manual-review-pass1.jsonl"), (rows) => { rows[100].origin = "automated"; });
  expectFailure(runAudit(dir, "p0"), /schema_validation/);
}
{
  const dir = clonePack(validDir, "impossible-review");
  mutateRows(path.join(dir, "manual-review-pass1.jsonl"), (rows) => { rows[100].state.presence = "absent"; });
  expectFailure(runAudit(dir, "p0"), /review_truth_absent/);
}
{
  const dir = clonePack(validDir, "same-reviewer");
  mutateRows(path.join(dir, "manual-review-pass2.jsonl"), (rows) => rows.forEach((row) => { row.reviewerHash = "1".repeat(64); }));
  expectFailure(runAudit(dir, "p0"), /reviewer_hash_not_distinct/);
}
{
  const dir = clonePack(validDir, "unresolved-disagreement");
  writeFileSync(path.join(dir, "manual-adjudication.jsonl"), "");
  expectFailure(runAudit(dir, "p0"), /adjudication_missing/);
}

function subjectDisagreementVariant(name, mutateSecond, { adjudicate = false, mutateAdjudication = null } = {}) {
  const dir = clonePack(validDir, name);
  const pass1Path = path.join(dir, "manual-review-pass1.jsonl");
  const pass2Path = path.join(dir, "manual-review-pass2.jsonl");
  const adjudicationPath = path.join(dir, "manual-adjudication.jsonl");
  const firstRows = readRows(pass1Path); const secondRows = readRows(pass2Path); const adjudicationRows = readRows(adjudicationPath);
  const index = secondRows.findIndex((row) => row.identity.clipId === "csi-pose" && row.identity.sourceFrameIndex === 100);
  mutateSecond(secondRows[index].state.subjectSelection);
  if (adjudicate) {
    const row = {
      artifactType: "manual-adjudication-v2", adjudicatorHash: "3".repeat(64), identity: secondRows[index].identity,
      disagreementFields: changedFields(firstRows[index].state, secondRows[index].state), decision: structuredClone(firstRows[index].state), origin: "manual", adjudicated: true,
    };
    if (mutateAdjudication) mutateAdjudication(row);
    adjudicationRows.push(row);
  }
  writeFileSync(pass2Path, jsonl(secondRows)); writeFileSync(adjudicationPath, jsonl(adjudicationRows));
  return { dir, p0Hash: rewriteP0Manifest(dir) };
}

{
  const variant = subjectDisagreementVariant("subject-state-adjudicated", (subject) => {
    subject.state = "ambiguous"; subject.manualTargetId = null; subject.anchor = null;
  }, { adjudicate: true });
  const result = runAudit(variant.dir, "p0", variant.p0Hash);
  assert.equal(result.status, 0, result.stdout);
}
{
  const variant = subjectDisagreementVariant("subject-state-unresolved", (subject) => {
    subject.state = "ambiguous"; subject.manualTargetId = null; subject.anchor = null;
  });
  expectFailure(runAudit(variant.dir, "p0"), /adjudication_missing/);
}
{
  const variant = subjectDisagreementVariant("subject-anchor-fields-attack", (subject) => { subject.anchor.x = 0.6; }, {
    adjudicate: true,
    mutateAdjudication: (row) => { row.disagreementFields = ["subjectSelection.anchor.y"]; },
  });
  expectFailure(runAudit(variant.dir, "p0"), /adjudication_fields_mismatch/);
}
{
  const dir = clonePack(validDir, "subject-target-unstable-attack");
  mutateRows(path.join(dir, "manual-review-pass2.jsonl"), (rows) => {
    const row = rows.find((entry) => entry.identity.clipId === "arms-crossed" && entry.identity.sourceFrameIndex === 100);
    row.state.subjectSelection.manualTargetId = "different-target";
  });
  expectFailure(runAudit(dir, "p0"), /review_subject_target_unstable/);
}
{
  const dir = clonePack(validDir, "automated-subject-review");
  mutateRows(path.join(dir, "manual-review-pass1.jsonl"), (rows) => { rows[100].state.subjectSelection.automated = true; });
  expectFailure(runAudit(dir, "p0"), /schema_validation/);
}
{
  const dir = clonePack(validDir, "agreed-subject-final-binding");
  mutateRows(path.join(dir, "manual-subject-selection.jsonl"), (rows) => {
    rows.forEach((row) => { if (row.span.identity.clipId === "arms-crossed" && row.state === "selected") row.manualTargetId = "final-only-target"; });
  });
  expectFailure(runAudit(dir, "p0"), /final_label_pass_mismatch/);
}
{
  const variant = subjectDisagreementVariant("adjudicated-subject-final-binding", (subject) => { subject.anchor.x = 0.6; }, {
    adjudicate: true,
    mutateAdjudication: (row) => { row.decision.subjectSelection.anchor.x = 0.7; },
  });
  expectFailure(runAudit(variant.dir, "p0"), /adjudication_final_mismatch/);
}

const zeroDir = path.join(tempRoot, "zero-disagreement");
const zero = buildPack(zeroDir, { zeroDisagreement: true });
const zeroCandidate = runAudit(zeroDir, "p0");
assert.equal(zeroCandidate.status, 0, zeroCandidate.stdout);
assert.equal(report(zeroCandidate).disagreementsAdjudicated, 0);
assert.equal(runAudit(zeroDir, "p0", zero.p0Hash).status, 0);

const gapDir = path.join(tempRoot, "non-reliable-gap");
const gap = buildPack(gapDir, { nonReliableGap: true });
const gapRun = runAudit(gapDir, "p0", gap.p0Hash);
assert.equal(gapRun.status, 0, gapRun.stdout);
assert.equal(report(gapRun).reacquireCandidates.length, 3);

const dedupDir = path.join(tempRoot, "deduplicated-reliable-start");
const dedup = buildPack(dedupDir, { dedupGap: true });
const dedupRun = runAudit(dedupDir, "p0", dedup.p0Hash);
assert.equal(dedupRun.status, 0, dedupRun.stdout);
const dedupEvents = report(dedupRun).reacquireCandidates;
assert.equal(dedupEvents.length, 3);
assert.equal(new Set(dedupEvents.map((event) => `${event.reliableStartIdentity.clipId}:${event.reliableStartIdentity.sourceFrameIndex}`)).size, 3);
assert.ok(dedupEvents.some((event) => event.clipId === "arms-crossed" && event.startIdentity.sourceFrameIndex === 8));

const lowKappaDir = path.join(tempRoot, "low-kappa");
buildPack(lowKappaDir, { lowKappa: true });
expectFailure(runAudit(lowKappaDir, "p0"), /agreement_below_floor:contactKappa/);

const lowSupportDir = path.join(tempRoot, "low-support");
buildPack(lowSupportDir, { lowContactSupport: true });
expectFailure(runAudit(lowSupportDir, "p0"), /pre_mask_contact_frames/);

const noReacquireDir = path.join(tempRoot, "no-reacquire");
buildPack(noReacquireDir, { noReacquire: true });
expectFailure(runAudit(noReacquireDir, "p0"), /reacquire_event_count/);

function teacherFailure(name, mutate, pattern) {
  const dir = clonePack(validDir, name);
  mutateRows(path.join(dir, "teacher-valid-mask.jsonl"), mutate);
  expectFailure(runAudit(dir, "p1", built.p0Hash), pattern);
}
teacherFailure("native-confidence", (rows) => {
  rows[1000].confidenceAvailable = true; rows[1000].jointConfidenceSource = "native"; rows[1000].warningCodes = [];
}, /teacher_current_native_confidence_forbidden/);
teacherFailure("detector-joint-imputation", (rows) => { rows[1000].jointConfidence = 0.9; }, /schema_validation/);
teacherFailure("confidence-calibration", (rows) => { rows[1000].scope.calibration = true; }, /teacher_confidence_calibration/);
teacherFailure("confidence-warning", (rows) => { rows[1000].warningCodes = []; }, /teacher_confidence_warning_missing/);
teacherFailure("invalid-with-scope", (rows) => { rows[1000].valid = false; rows[1000].exclusionReasons = ["insufficient_observability"]; }, /teacher_invalid_truth/);
teacherFailure("contact-without-full-body", (rows) => { rows[1000].scope.fullBody = false; }, /teacher_contact_implies_full_body/);
teacherFailure("confidence-exclusion", (rows) => { rows[1000].exclusionReasons = ["confidence_unavailable"]; }, /schema_validation|teacher_confidence_exclusion_forbidden/);
teacherFailure("post-mask-support", (rows) => {
  rows.forEach((row) => { if (row.manual.leftContact === "moving") row.scope.contactEligibility.left = false; });
}, /post_mask_contact_frames:left:moving/);
teacherFailure("p1-reacquire-collapse", (rows) => {
  rows.forEach((row) => {
    if (["arms-crossed", "csi-pose"].includes(row.identity.clipId)) {
      row.valid = false; row.scope = { torsoFacing: false, fullBody: false, calibration: false, contactEligibility: { left: false, right: false } };
      row.exclusionReasons = ["manual_occluded"];
    }
  });
}, /p1_reacquire_start_count|p1_reacquire_hard_clip_count/);

{
  const dir = clonePack(validDir, "p1-parent-rehash");
  mutateJson(path.join(dir, "evaluation-pack-p1.json"), (value) => { value.parentP0LockSha256 = "f".repeat(64); });
  mutateJson(path.join(dir, "evaluation-lock-p1.json"), (value) => { value.parentP0LockSha256 = "f".repeat(64); });
  expectFailure(runAudit(dir, "p1", built.p0Hash), /pack_parent_p0_mismatch|p1_pack_binding|p1_parent_lock_mismatch/);
}

{
  const dir = clonePack(validDir, "fully-rehashed-p0-semantic-tamper");
  mutateRows(path.join(dir, "manual-labels.jsonl"), (rows) => { rows[1000].scenarios = ["turn"]; });
  const changedCandidate = rewriteP0Manifest(dir);
  assert.notEqual(changedCandidate, built.p0Hash);
  const changedRun = runAudit(dir, "p0");
  assert.equal(changedRun.status, 0, changedRun.stdout);
  assert.equal(report(changedRun).status, "candidate");
  assert.equal(report(changedRun).candidateP0LockSha256, changedCandidate);
  expectFailure(runAudit(dir, "p0", built.p0Hash), /external_p0_lock_mismatch/);
  rewriteP1(dir, changedCandidate);
  expectFailure(runAudit(dir, "p1", built.p0Hash), /external_p0_lock_mismatch/);
}

{
  const changedContractPath = path.join(tempRoot, "rehashed-semantic-contract.json");
  const changed = structuredClone(contract); changed.contactPolicy.preMaskMinimumObservableKnownFramesPerFootAndClass = 1;
  writeJson(changedContractPath, withHash(changed));
  expectFailure(runAudit(validDir, "p0", built.p0Hash, ["--contract", changedContractPath]), /contract_hash_drift/);
}

{
  const dir = clonePack(validDir, "descriptor-omission");
  mutateJson(path.join(dir, "evaluation-pack.json"), (value) => { delete value.files.manualLabels; });
  expectFailure(runAudit(dir, "p0"), /schema_validation|pack_descriptor_drift/);
}
{
  const dir = clonePack(validDir, "path-only-descriptor");
  mutateJson(path.join(dir, "evaluation-pack.json"), (value) => { value.files.manualLabels = "manual-labels.jsonl"; });
  expectFailure(runAudit(dir, "p0"), /schema_validation/);
}

{
  const dir = clonePack(validDir, "valid-frame-interval-materialization");
  const labelsPath = path.join(dir, "manual-labels.jsonl");
  const subjectsPath = path.join(dir, "manual-subject-selection.jsonl");
  const pass1Path = path.join(dir, "manual-review-pass1.jsonl");
  const pass2Path = path.join(dir, "manual-review-pass2.jsonl");
  const labels = readRows(labelsPath); const subjects = readRows(subjectsPath); const pass1 = readRows(pass1Path); const pass2 = readRows(pass2Path);
  const first = labels.findIndex((row) => row.span.identity.clipId === "arms-crossed" && row.span.identity.sourceFrameIndex === 100);
  const second = labels.findIndex((row) => row.span.identity.clipId === "arms-crossed" && row.span.identity.sourceFrameIndex === 101);
  const endRow = decoderRows.find((row) => row.clipId === "arms-crossed" && row.sourceFrameIndex === 102);
  const intervalLabel = structuredClone(labels[first]);
  intervalLabel.labelId = "interval-label-100-102";
  intervalLabel.span = { kind: "interval", clipId: "arms-crossed", startPtsTicks: labels[first].span.identity.ptsTicks, endPtsTicksExclusive: endRow.ptsTicks, loopEpoch: 0 };
  for (const field of ["presence", "personState", "occlusion", "contact", "handObservability", "endpointObservability"]) labels[second][field] = structuredClone(labels[first][field]);
  pass1[second].state = state(labels[first], subjects[first]); pass2[second].state = state(labels[first], subjects[first]);
  const intervalSubject = structuredClone(subjects[first]);
  intervalSubject.selectionId = "interval-subject-100-102";
  intervalSubject.span = { kind: "interval", clipId: "arms-crossed", startPtsTicks: subjects[first].span.identity.ptsTicks, endPtsTicksExclusive: endRow.ptsTicks, loopEpoch: 0 };
  labels.splice(second, 1); labels.splice(first, 1); labels.push(intervalLabel);
  subjects.splice(second, 1); subjects.splice(first, 1); subjects.push(intervalSubject);
  writeFileSync(labelsPath, jsonl(labels)); writeFileSync(subjectsPath, jsonl(subjects)); writeFileSync(pass1Path, jsonl(pass1)); writeFileSync(pass2Path, jsonl(pass2));
  const newHash = rewriteP0Manifest(dir);
  const result = runAudit(dir, "p0", newHash);
  assert.equal(result.status, 0, result.stdout);
}

{
  const dir = clonePack(validDir, "overlay-membership-crossing");
  const labelsPath = path.join(dir, "manual-labels.jsonl");
  const labels = readRows(labelsPath);
  const first = labels.findIndex((row) => row.span.identity.clipId === "arms-crossed" && row.span.identity.sourceFrameIndex === 19);
  const second = labels.findIndex((row) => row.span.identity.clipId === "arms-crossed" && row.span.identity.sourceFrameIndex === 20);
  const endRow = decoderRows.find((row) => row.clipId === "arms-crossed" && row.sourceFrameIndex === 21);
  const interval = structuredClone(labels[first]); interval.labelId = "crossing-interval";
  interval.span = { kind: "interval", clipId: "arms-crossed", startPtsTicks: labels[first].span.identity.ptsTicks, endPtsTicksExclusive: endRow.ptsTicks, loopEpoch: 0 };
  labels.splice(second, 1); labels.splice(first, 1); labels.push(interval); writeFileSync(labelsPath, jsonl(labels));
  expectFailure(runAudit(dir, "p0"), /window_membership_crossing/);
}

assert.equal(canonical(contract, true), CONTRACT_HASH);
assert.equal(canonical(JSON.parse(readFileSync(SCHEMA_PATH, "utf8"))), SCHEMA_HASH);
const reorderedContract = Object.fromEntries(Object.entries(contract).reverse());
assert.equal(canonical(reorderedContract, true), CONTRACT_HASH);
const reorderedTaxonomy = structuredClone(contract); reorderedTaxonomy.scenarioTaxonomy.reverse();
assert.notEqual(canonical(reorderedTaxonomy, true), CONTRACT_HASH);

const schemaSample = path.join(tempRoot, "schema-sample.jsonl");
const sampleRows = [...decoderRows, ...readRows(path.join(validDir, "manual-labels.jsonl")).slice(0, 289)];
assert.equal(sampleRows.length, 7000);
writeFileSync(schemaSample, jsonl(sampleRows));
const draftValidation = spawnSync("python3", ["-c", [
  "import json,sys", "from jsonschema import Draft202012Validator",
  "schema=json.load(open(sys.argv[1],encoding='utf-8'))", "Draft202012Validator.check_schema(schema)", "validator=Draft202012Validator(schema)",
  "count=0", "for line in open(sys.argv[2],encoding='utf-8'):", "  if line.strip(): validator.validate(json.loads(line)); count += 1",
  "for path in sys.argv[3:]: validator.validate(json.load(open(path,encoding='utf-8')))", "print(count)",
].join("\n"), SCHEMA_PATH, schemaSample,
path.join(validDir, "manual-windows.json"), path.join(validDir, "manual-policy.json"), path.join(validDir, "manual-summary.json"),
path.join(validDir, "evaluation-pack.json"), path.join(validDir, "evaluation-pack-p1.json"), path.join(validDir, "evaluation-lock-p1.json"),
], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
assert.equal(draftValidation.status, 0, draftValidation.stderr || draftValidation.stdout);
assert.equal(Number(draftValidation.stdout.trim()), 7000);

const preservedAfter = V1_PATHS.map((file) => sha(readFileSync(path.join(ROOT, file))));
assert.deepEqual(preservedAfter, EXPECTED_PRESERVED);
assert.equal(sha(readFileSync(DECODER_PATH)), "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79");
assert.equal(canonical(decoderRows), "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d");
assert.equal(canonical(JSON.parse(readFileSync(SOURCE_INVENTORY_PATH, "utf8")), true), "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d");

const cleanupMarker = path.join(tempRoot, "cleanup-probe-marker.txt");
const cleanupProbe = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--cleanup-probe", cleanupMarker], { cwd: ROOT, encoding: "utf8" });
assert.notEqual(cleanupProbe.status, 0);
assert.match(cleanupProbe.stderr, /intentional_cleanup_probe_failure/);
const failedProbeRoot = readFileSync(cleanupMarker, "utf8");
assert.equal(existsSync(failedProbeRoot), false, `failed assertion path leaked ${failedProbeRoot}`);
rmSync(cleanupMarker, { force: true });

const elapsedMs = Number(process.hrtime.bigint() - suiteStarted) / 1e6;
const completedTempRoot = tempRoot;
cleanupTempRoot();
assert.equal(existsSync(completedTempRoot), false, `success path leaked ${completedTempRoot}`);
const ownedTempRootsAfter = new Set(readdirSync(tempParent).filter((name) => /^sam-eval-v2-[A-Za-z0-9]+$/.test(name)).map((name) => path.join(tempParent, name)));
const newlyLeakedRoots = [...ownedTempRootsAfter].filter((entry) => !ownedTempRootsBefore.has(entry));
assert.deepEqual(newlyLeakedRoots, []);

console.log(JSON.stringify({
  status: "passed", checks: 64, exactDecoderRows: 6711, draft202012ArtifactRows: 7000,
  totalMaterializedPackRows: 6711 * 6, p0LockSha256: built.p0Hash,
  validP0AuditElapsedMs: candidate.elapsedMs, cleanupProbePassed: true, newTempResidueCount: newlyLeakedRoots.length, elapsedMs,
}, null, 2));
