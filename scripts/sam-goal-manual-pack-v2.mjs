#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = {
  authoringSchema: "tests/fixtures/sam-goal-v2/evaluation-v2/authoring-schema.json",
  anchorSchema: "tests/fixtures/sam-goal-v2/evaluation-v2/p0-lock-anchor-schema.json",
  evaluationContract: "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json",
  evaluationSchema: "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json",
  sourceInventory: "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
  decoderManifest: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl",
  auditor: "scripts/sam-goal-label-audit-v2.mjs",
};
const ACCEPTED = {
  authoringSchema: "a04ce78643a98be6e550b15654317c9ec8f1678c8afa3f332e11cdf2014f69ef",
  anchorSchema: "5b74dfb7fcef0c5ba4f3b550181dde59d69b2a22765c1abb76f27838109b7c5a",
  evaluationContract: "7a7f26a4734d0c971ecc2bef542dd05da11d67134478a2db286e1cd242bb5897",
  evaluationSchema: "38759400e1e5aacb1b06bf3b052a5af8f693366dfa93653d0520280723c8e146",
  sourceInventory: "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d",
  decoderBytes: "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79",
  decoderRows: "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d",
};
const SHA_RE = /^[0-9a-f]{64}$/;
const COMPILED_FILES = [
  "evaluation-pack.json", "manual-windows.json", "manual-labels.jsonl", "manual-subject-selection.jsonl",
  "manual-review-pass1.jsonl", "manual-review-pass2.jsonl", "manual-adjudication.jsonl", "manual-policy.json", "manual-summary.json",
];
const ACTIVE_TEMP_PATHS = new Set();
const ACTIVE_CHILDREN = new Set();
let handlingSignal = false;

function cleanupRegisteredTemps() {
  for (const tempPath of [...ACTIVE_TEMP_PATHS].sort((a, b) => b.length - a.length)) {
    try { rmSync(tempPath, { recursive: true, force: true }); } catch { /* best effort during process shutdown */ }
    ACTIVE_TEMP_PATHS.delete(tempPath);
  }
}
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, () => {
    if (handlingSignal) return;
    handlingSignal = true;
    for (const child of ACTIVE_CHILDREN) { try { child.kill(signal); } catch { /* already exited */ } }
    cleanupRegisteredTemps();
    process.exit(exitCode);
  });
}
process.on("exit", cleanupRegisteredTemps);

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-manual-pack-v2.mjs validate-review --review <path> --expected-role <first|second> --expected-reviewer-pseudonym-sha256 <sha256>
  node scripts/sam-goal-manual-pack-v2.mjs compile --review-a <path> --review-b <path> --adjudication <path> --output-dir <new-path>
  node scripts/sam-goal-manual-pack-v2.mjs create-anchor --anchor <absent-path> --label-dir <path> --review-a <path> --review-b <path> --adjudication <path>
  node scripts/sam-goal-manual-pack-v2.mjs verify-anchor --anchor <path> --label-dir <path> --review-a <path> --review-b <path> --adjudication <path>

Dependency overrides for controlled tests:
  --authoring-schema --anchor-schema --evaluation-contract --evaluation-schema
  --source-inventory --decoder-manifest --auditor`);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (mode === "--help" || mode === "-h") { usage(); process.exit(0); }
  if (!["validate-review", "compile", "create-anchor", "verify-anchor"].includes(mode)) throw new Error(`mode_invalid:${mode || "missing"}`);
  const options = {
    mode, ...DEFAULTS, review: "", expectedRole: "", expectedReviewer: "", reviewA: "", reviewB: "", adjudication: "", outputDir: "", anchor: "", labelDir: "",
  };
  const names = new Map([
    ["--review", "review"], ["--expected-role", "expectedRole"], ["--expected-reviewer-pseudonym-sha256", "expectedReviewer"],
    ["--review-a", "reviewA"], ["--review-b", "reviewB"], ["--adjudication", "adjudication"], ["--output-dir", "outputDir"],
    ["--anchor", "anchor"], ["--label-dir", "labelDir"], ["--authoring-schema", "authoringSchema"], ["--anchor-schema", "anchorSchema"],
    ["--evaluation-contract", "evaluationContract"], ["--evaluation-schema", "evaluationSchema"], ["--source-inventory", "sourceInventory"],
    ["--decoder-manifest", "decoderManifest"], ["--auditor", "auditor"],
  ]);
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]; const key = names.get(arg);
    if (!key) throw new Error(`unknown_argument:${arg}`);
    if (seen.has(key)) throw new Error(`duplicate_argument:${arg}`);
    seen.add(key); const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
    options[key] = value;
  }
  const requireKeys = mode === "validate-review" ? ["review", "expectedRole", "expectedReviewer"]
    : mode === "compile" ? ["reviewA", "reviewB", "adjudication", "outputDir"]
      : ["anchor", "labelDir", "reviewA", "reviewB", "adjudication"];
  for (const key of requireKeys) if (!options[key]) throw new Error(`required_argument_missing:${key}`);
  if (mode === "validate-review" && !["first", "second"].includes(options.expectedRole)) throw new Error(`expected_role_invalid:${options.expectedRole}`);
  if (mode === "validate-review" && !SHA_RE.test(options.expectedReviewer)) throw new Error("expected_reviewer_invalid");
  return options;
}

function resolvePath(value) { return path.isAbsolute(value) ? path.normalize(value) : path.resolve(REPO_ROOT, value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function stableJson(value) { return JSON.stringify(stableValue(value)); }
function canonicalHash(value, omitRootExpected = false) {
  let target = value;
  if (omitRootExpected) { target = { ...value }; delete target.expectedCanonicalHash; }
  return sha256(Buffer.from(stableJson(target), "utf8"));
}
function stableEqual(left, right) { return stableJson(left) === stableJson(right); }
function parseJsonBytes(bytes, label) {
  try { return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")); }
  catch (error) { throw new Error(`json_invalid:${label}:${error.message}`); }
}
function readJsonSnapshot(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`input_missing:${label}:${filePath}`);
  const bytes = readFileSync(filePath);
  return { bytes, value: parseJsonBytes(bytes, label) };
}
function readJson(filePath, label) { return readJsonSnapshot(filePath, label).value; }
function parseJsonlBytes(bytes, label) {
  const rows = [];
  bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); } catch (error) { throw new Error(`jsonl_invalid:${label}:${index + 1}:${error.message}`); }
  });
  return rows;
}
function readJsonlSnapshot(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`input_missing:${label}:${filePath}`);
  const bytes = readFileSync(filePath);
  return { bytes, rows: parseJsonlBytes(bytes, label) };
}
function verifySelfHash(value, label) {
  if (!SHA_RE.test(value?.expectedCanonicalHash || "")) throw new Error(`self_hash_missing:${label}`);
  const actual = canonicalHash(value, true);
  if (actual !== value.expectedCanonicalHash) throw new Error(`self_hash_drift:${label}:${value.expectedCanonicalHash}:${actual}`);
  return actual;
}
function prettyJson(value) { return `${JSON.stringify(stableValue(value), null, 2)}\n`; }
function jsonl(rows) { return `${rows.map((row) => stableJson(row)).join("\n")}${rows.length ? "\n" : ""}`; }
function withSelfHash(value) { const result = { ...value, expectedCanonicalHash: "" }; result.expectedCanonicalHash = canonicalHash(result, true); return result; }

function validateSchemaValue(root, schema, value, at) {
  if (schema === true) return;
  if (schema === false) throw new Error(`schema_validation:${at}:false_schema`);
  if (schema.$ref) {
    const prefix = "#/$defs/"; const name = schema.$ref.startsWith(prefix) ? schema.$ref.slice(prefix.length) : "";
    if (!name || !root.$defs?.[name]) throw new Error(`schema_validation:${at}:bad_ref`);
    validateSchemaValue(root, root.$defs[name], value, at);
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) { try { validateSchemaValue(root, branch, value, at); matches += 1; } catch { /* branch miss */ } }
    if (matches !== 1) throw new Error(`schema_validation:${at}:oneOf:${matches}`);
  }
  if (Object.hasOwn(schema, "const") && !stableEqual(value, schema.const)) throw new Error(`schema_validation:${at}:const`);
  if (schema.enum && !schema.enum.some((entry) => stableEqual(entry, value))) throw new Error(`schema_validation:${at}:enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const match = (type) => ({ object: value !== null && typeof value === "object" && !Array.isArray(value), array: Array.isArray(value), string: typeof value === "string", integer: Number.isSafeInteger(value), number: typeof value === "number" && Number.isFinite(value), boolean: typeof value === "boolean", null: value === null }[type]);
    if (!types.some(match)) throw new Error(`schema_validation:${at}:type:${types.join("|")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`schema_validation:${at}:minLength`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) throw new Error(`schema_validation:${at}:pattern`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`schema_validation:${at}:minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`schema_validation:${at}:maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`schema_validation:${at}:minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`schema_validation:${at}:maxItems`);
    if (schema.uniqueItems && new Set(value.map(stableJson)).size !== value.length) throw new Error(`schema_validation:${at}:uniqueItems`);
    if (schema.items !== undefined) value.forEach((entry, index) => validateSchemaValue(root, schema.items, entry, `${at}/${index}`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`schema_validation:${at}:required:${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateSchemaValue(root, properties[key], child, `${at}/${key}`);
      else if (schema.additionalProperties === false) throw new Error(`schema_validation:${at}:additional:${key}`);
    }
  }
}

function scanAuthoring(value, at = "authoring") {
  const forbidden = ["sam", "detector", "candidatecount", "live", "student", "avatar", "solver", "retarget", "latency", "report", "error", "automated", "generatedat", "auditedat", "elapsedms", "reviewedat"];
  function normalized(item) { return String(item).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function visit(child, cursor) {
    if (Array.isArray(child)) { child.forEach((entry, index) => visit(entry, `${cursor}/${index}`)); return; }
    if (child && typeof child === "object") {
      for (const [key, nested] of Object.entries(child)) {
        const token = normalized(key);
        if (forbidden.some((entry) => token.includes(entry))) throw new Error(`forbidden_authoring_key:${cursor}/${key}`);
        visit(nested, `${cursor}/${key}`);
      }
    } else if (typeof child === "string") {
      const token = normalized(child);
      if (forbidden.some((entry) => token.includes(entry))) throw new Error(`forbidden_authoring_value:${cursor}:${child}`);
    }
  }
  visit(value, at);
}

function loadContext(options) {
  const paths = Object.fromEntries(Object.keys(DEFAULTS).map((key) => [key, resolvePath(options[key])]));
  const authoringSchema = readJson(paths.authoringSchema, "authoring_schema");
  const anchorSchema = readJson(paths.anchorSchema, "anchor_schema");
  const evaluationContract = readJson(paths.evaluationContract, "evaluation_contract");
  const evaluationSchema = readJson(paths.evaluationSchema, "evaluation_schema");
  const sourceInventory = readJson(paths.sourceInventory, "source_inventory");
  const hashes = {
    authoringSchema: canonicalHash(authoringSchema), anchorSchema: canonicalHash(anchorSchema),
    evaluationContract: canonicalHash(evaluationContract, true), evaluationSchema: canonicalHash(evaluationSchema),
    sourceInventory: canonicalHash(sourceInventory, true),
  };
  for (const [name, expected] of Object.entries({ authoringSchema: ACCEPTED.authoringSchema, anchorSchema: ACCEPTED.anchorSchema, evaluationContract: ACCEPTED.evaluationContract, evaluationSchema: ACCEPTED.evaluationSchema, sourceInventory: ACCEPTED.sourceInventory })) {
    if (hashes[name] !== expected) throw new Error(`dependency_hash_drift:${name}:${hashes[name]}:${expected}`);
  }
  if (evaluationContract.expectedCanonicalHash !== hashes.evaluationContract || evaluationContract.labelSchema.canonicalSha256 !== hashes.evaluationSchema || sourceInventory.expectedCanonicalHash !== hashes.sourceInventory) throw new Error("dependency_self_binding_drift");
  const decoderSnapshot = readJsonlSnapshot(paths.decoderManifest, "decoder_manifest");
  const decoderBytes = decoderSnapshot.bytes;
  const decoderByteSha256 = sha256(decoderBytes);
  const decoderRows = decoderSnapshot.rows;
  const decoderCanonicalRowsSha256 = canonicalHash(decoderRows);
  if (decoderRows.length !== 6711 || decoderByteSha256 !== ACCEPTED.decoderBytes || decoderCanonicalRowsSha256 !== ACCEPTED.decoderRows) throw new Error("decoder_binding_drift");
  const decoderByClip = new Map();
  for (const row of decoderRows) {
    if (!decoderByClip.has(row.clipId)) decoderByClip.set(row.clipId, []);
    decoderByClip.get(row.clipId).push(row);
  }
  for (const clip of evaluationContract.sourceBinding.paired) {
    const rows = decoderByClip.get(clip.clipId) || [];
    if (rows.length !== clip.rows || rows.some((row, index) => row.sourceFrameIndex !== index)) throw new Error(`decoder_clip_drift:${clip.clipId}`);
  }
  const sourceVideos = sourceInventory.paired.map(({ clipId, video }) => ({ clipId, path: video.path, bytes: video.bytes, sha256: video.sha256 }));
  const sourceBinding = {
    evaluationContractCanonicalSha256: hashes.evaluationContract,
    evaluationSchemaCanonicalSha256: hashes.evaluationSchema,
    sourceInventoryCanonicalSha256: hashes.sourceInventory,
    decoderByteSha256,
    decoderCanonicalRowsSha256,
    decoderRowCount: decoderRows.length,
    sources: sourceVideos,
  };
  return { paths, authoringSchema, anchorSchema, evaluationContract, evaluationSchema, sourceInventory, hashes, decoderBytes, decoderRows, decoderByClip, decoderByteSha256, decoderCanonicalRowsSha256, sourceBinding };
}

function assertTruth(value, at) {
  const state = value.state || value;
  const subject = state.subjectSelection;
  const endpointsHidden = Object.values(state.endpointObservability).every((entry) => entry === "not_observable");
  if (state.presence === "absent" && (state.personState !== "absent" || subject.state !== "absent" || state.contact.left !== "unknown" || state.contact.right !== "unknown" || state.handObservability.left !== "not_observable" || state.handObservability.right !== "not_observable" || !endpointsHidden)) throw new Error(`truth_absent:${at}`);
  for (const foot of ["left", "right"]) if (state.contact[foot] !== "unknown" && (state.presence !== "present" || state.occlusion[`${foot}Foot`] !== "observable")) throw new Error(`truth_contact:${at}:${foot}`);
  for (const hand of ["left", "right"]) if (state.handObservability[hand] === "observable" && (!["observable", "partial"].includes(state.occlusion[`${hand}Hand`]) || state.endpointObservability[`${hand}Wrist`] !== "observable")) throw new Error(`truth_hand:${at}:${hand}`);
  const endpointPart = { leftWrist: "leftHand", rightWrist: "rightHand", leftAnkle: "leftFoot", rightAnkle: "rightFoot", head: "body" };
  for (const [endpoint, part] of Object.entries(endpointPart)) if (state.endpointObservability[endpoint] === "observable" && ["occluded", "out_of_frame", "unknown"].includes(state.occlusion[part])) throw new Error(`truth_endpoint:${at}:${endpoint}`);
  if (subject.state === "selected") {
    if (!(typeof subject.manualTargetId === "string" && subject.manualTargetId)) throw new Error(`truth_subject_target:${at}`);
  } else if (subject.manualTargetId !== null || subject.anchor !== null) throw new Error(`truth_subject_payload:${at}`);
  if (state.personState === "multiple_people" && !((subject.state === "selected" && subject.anchor !== null) || subject.state === "ambiguous")) throw new Error(`truth_multiple_people:${at}`);
  if (state.personState === "single_target" && subject.state !== "selected") throw new Error(`truth_single_target:${at}`);
}

function normalizeWindows(windows, context, label) {
  const allowedPurpose = new Set(context.evaluationContract.manualWindows.purposeTags);
  const allowedScenario = new Set(context.evaluationContract.scenarioTaxonomy);
  const ids = new Set(); const baseByClip = new Map();
  const normalized = windows.map((window, index) => {
    if (ids.has(window.windowId)) throw new Error(`window_duplicate:${label}:${window.windowId}`);
    ids.add(window.windowId);
    const rows = context.decoderByClip.get(window.clipId);
    if (!rows) throw new Error(`window_clip_unknown:${label}:${window.clipId}`);
    if (window.startFrameIndex < 0 || window.endFrameIndexExclusive > rows.length || window.startFrameIndex >= window.endFrameIndexExclusive) throw new Error(`window_boundary:${label}:${window.windowId}`);
    if (window.purposeTags.some((tag) => !allowedPurpose.has(tag)) || window.scenarioTags.some((tag) => !allowedScenario.has(tag))) throw new Error(`window_open_tag:${label}:${window.windowId}`);
    if (window.purposeTags.includes("full_clip_denominator")) {
      if (window.purposeTags.length !== 1 || window.startFrameIndex !== 0 || window.endFrameIndexExclusive !== rows.length || baseByClip.has(window.clipId)) throw new Error(`window_base_invalid:${label}:${window.clipId}`);
      baseByClip.set(window.clipId, window);
    }
    return stableValue(window);
  });
  if (baseByClip.size !== 7) throw new Error(`window_base_count:${label}:${baseByClip.size}`);
  for (const clip of context.evaluationContract.sourceBinding.paired) if (!baseByClip.has(clip.clipId)) throw new Error(`window_base_missing:${label}:${clip.clipId}`);
  normalized.sort((a, b) => a.clipId.localeCompare(b.clipId) || a.startFrameIndex - b.startFrameIndex || a.endFrameIndexExclusive - b.endFrameIndexExclusive || a.windowId.localeCompare(b.windowId));
  return normalized;
}

function membershipsForWindows(windows, context) {
  const memberships = new Map();
  for (const [clipId, rows] of context.decoderByClip) for (const row of rows) {
    const ids = windows.filter((window) => window.clipId === clipId && row.sourceFrameIndex >= window.startFrameIndex && row.sourceFrameIndex < window.endFrameIndexExclusive).map((window) => window.windowId).sort();
    memberships.set(`${clipId}:${row.sourceFrameIndex}`, ids);
  }
  return memberships;
}

function materializeIntervals(clips, windows, context, label) {
  const clipIds = new Set(); const values = new Map(); const memberships = membershipsForWindows(windows, context); const targetsByClip = new Map();
  for (const clip of clips) {
    if (clipIds.has(clip.clipId)) throw new Error(`clip_duplicate:${label}:${clip.clipId}`);
    clipIds.add(clip.clipId);
    const decoderRows = context.decoderByClip.get(clip.clipId);
    if (!decoderRows) throw new Error(`clip_unknown:${label}:${clip.clipId}`);
    const intervals = [...clip.intervals].sort((a, b) => a.startFrameIndex - b.startFrameIndex || a.endFrameIndexExclusive - b.endFrameIndexExclusive);
    let cursor = 0;
    for (const [index, interval] of intervals.entries()) {
      if (interval.startFrameIndex < cursor) throw new Error(`interval_overlap:${label}:${clip.clipId}:${index}`);
      if (interval.startFrameIndex > cursor) throw new Error(`interval_gap:${label}:${clip.clipId}:${cursor}:${interval.startFrameIndex}`);
      if (interval.endFrameIndexExclusive <= interval.startFrameIndex || interval.endFrameIndexExclusive > decoderRows.length) throw new Error(`interval_boundary:${label}:${clip.clipId}:${index}`);
      assertTruth(interval, `${label}:${clip.clipId}:${index}`);
      const membershipSets = new Set(decoderRows.slice(interval.startFrameIndex, interval.endFrameIndexExclusive).map((row) => stableJson(memberships.get(`${clip.clipId}:${row.sourceFrameIndex}`))));
      if (membershipSets.size !== 1) throw new Error(`interval_membership_crossing:${label}:${clip.clipId}:${index}`);
      const authored = { scenarios: stableValue(interval.scenarios), state: stableValue(interval.state) };
      for (let frame = interval.startFrameIndex; frame < interval.endFrameIndexExclusive; frame += 1) values.set(`${clip.clipId}:${frame}`, authored);
      if (interval.state.subjectSelection.state === "selected") {
        if (!targetsByClip.has(clip.clipId)) targetsByClip.set(clip.clipId, new Set());
        targetsByClip.get(clip.clipId).add(interval.state.subjectSelection.manualTargetId);
      }
      cursor = interval.endFrameIndexExclusive;
    }
    if (cursor !== decoderRows.length) throw new Error(`interval_terminal_gap:${label}:${clip.clipId}:${cursor}:${decoderRows.length}`);
  }
  if (clipIds.size !== 7 || values.size !== 6711) throw new Error(`review_coverage:${label}:${clipIds.size}:${values.size}`);
  for (const [clipId, targets] of targetsByClip) if (targets.size !== 1) throw new Error(`review_target_unstable:${label}:${clipId}`);
  return { values, memberships };
}

function supportAndReacquire(materialized, context) {
  const support = { left: { planted: 0, moving: 0 }, right: { planted: 0, moving: 0 } };
  for (const value of materialized.values.values()) for (const foot of ["left", "right"]) {
    const contact = value.state.contact[foot];
    if (["planted", "moving"].includes(contact) && value.state.occlusion[`${foot}Foot`] === "observable") support[foot][contact] += 1;
  }
  const hard = new Set(context.evaluationContract.clipInventory.filter((clip) => clip.role === "hard_test").map((clip) => clip.clipId));
  const candidates = [];
  for (const clipId of hard) {
    const rows = context.decoderByClip.get(clipId); let index = 0;
    while (index < rows.length) {
      const state = materialized.values.get(`${clipId}:${index}`).state;
      const bad = state.presence === "absent" || state.presence === "unknown" || ["ambiguous", "unknown"].includes(state.subjectSelection.state) || ["occluded", "out_of_frame", "unknown"].includes(state.occlusion.body);
      if (!bad) { index += 1; continue; }
      const start = index;
      while (index < rows.length) {
        const current = materialized.values.get(`${clipId}:${index}`).state;
        const currentBad = current.presence === "absent" || current.presence === "unknown" || ["ambiguous", "unknown"].includes(current.subjectSelection.state) || ["occluded", "out_of_frame", "unknown"].includes(current.occlusion.body);
        if (!currentBad) break; index += 1;
      }
      if (index >= rows.length) break;
      const reliable = materialized.values.get(`${clipId}:${index}`).state;
      if (!(reliable.presence === "present" && reliable.subjectSelection.state === "selected" && ["observable", "partial"].includes(reliable.occlusion.body))) { index += 1; continue; }
      const durationNumerator = (BigInt(rows[index].ptsTicks) - BigInt(rows[start].ptsTicks)) * BigInt(rows[start].timeBase.numerator) * 1000n;
      if (durationNumerator >= 200n * BigInt(rows[start].timeBase.denominator)) candidates.push({ clipId, startFrameIndex: start, reliableFrameIndex: index });
    }
  }
  return { support, reacquireCandidates: candidates };
}

function validateReview(filePath, expectedRole, expectedReviewer, context, label) {
  const { bytes, value: review } = readJsonSnapshot(filePath, label);
  scanAuthoring(review, label);
  validateSchemaValue(context.authoringSchema, context.authoringSchema.$defs.review, review, label);
  const canonicalSha256 = verifySelfHash(review, label);
  if (review.role !== expectedRole) throw new Error(`review_role_mismatch:${label}:${review.role}:${expectedRole}`);
  if (expectedReviewer && review.reviewerPseudonymSha256 !== expectedReviewer) throw new Error(`reviewer_pseudonym_mismatch:${label}`);
  if (!stableEqual(review.sourceBinding, context.sourceBinding)) throw new Error(`review_source_binding:${label}`);
  const windows = normalizeWindows(review.windows, context, label);
  const materialized = materializeIntervals(review.clips, windows, context, label);
  return { filePath, review, canonicalSha256, byteSha256: sha256(bytes), windows, materialized, report: supportAndReacquire(materialized, context) };
}

function flatten(value, prefix = "", output = {}) {
  for (const [name, child] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (child && typeof child === "object" && !Array.isArray(child)) flatten(child, key, output); else output[key] = child;
  }
  return output;
}
function differenceFields(left, right) {
  const a = flatten(left); const b = flatten(right);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !stableEqual(a[key], b[key])).sort();
}

function validateAdjudication(filePath, first, second, context) {
  const { bytes, value } = readJsonSnapshot(filePath, "adjudication");
  scanAuthoring(value, "adjudication");
  validateSchemaValue(context.authoringSchema, context.authoringSchema.$defs.adjudication, value, "adjudication");
  const canonicalSha256 = verifySelfHash(value, "adjudication");
  if (value.reviewACanonicalSha256 !== first.canonicalSha256 || value.reviewBCanonicalSha256 !== second.canonicalSha256) throw new Error("adjudication_review_binding");
  if ([first.review.reviewerPseudonymSha256, second.review.reviewerPseudonymSha256].includes(value.adjudicatorPseudonymSha256)) throw new Error("adjudicator_pseudonym_not_distinct");
  const windows = normalizeWindows(value.windows, context, "adjudication_windows");
  const memberships = membershipsForWindows(windows, context);
  const decisions = new Map();
  for (const [index, decision] of value.decisions.entries()) {
    const rows = context.decoderByClip.get(decision.clipId);
    if (!rows || decision.startFrameIndex < 0 || decision.endFrameIndexExclusive > rows.length || decision.startFrameIndex >= decision.endFrameIndexExclusive) throw new Error(`adjudication_boundary:${index}`);
    assertTruth(decision, `adjudication:${index}`);
    const membershipSets = new Set(rows.slice(decision.startFrameIndex, decision.endFrameIndexExclusive).map((row) => stableJson(memberships.get(`${decision.clipId}:${row.sourceFrameIndex}`))));
    if (membershipSets.size !== 1) throw new Error(`adjudication_membership_crossing:${index}`);
    const authored = { scenarios: stableValue(decision.scenarios), state: stableValue(decision.state) };
    for (let frame = decision.startFrameIndex; frame < decision.endFrameIndexExclusive; frame += 1) {
      const key = `${decision.clipId}:${frame}`;
      if (decisions.has(key)) throw new Error(`adjudication_overlap:${key}`);
      decisions.set(key, { authored, fields: [...decision.disagreementFields].sort() });
    }
  }
  const final = new Map(); const disagreements = new Map();
  for (const row of context.decoderRows) {
    const key = `${row.clipId}:${row.sourceFrameIndex}`;
    const left = first.materialized.values.get(key); const right = second.materialized.values.get(key);
    const fields = differenceFields(left, right); const decision = decisions.get(key);
    if (fields.length) {
      if (!decision) throw new Error(`adjudication_missing:${key}`);
      if (!stableEqual(fields, decision.fields)) throw new Error(`adjudication_fields:${key}:${fields.join(",")}:${decision.fields.join(",")}`);
      final.set(key, decision.authored); disagreements.set(key, { fields, decision: decision.authored });
    } else {
      if (decision) throw new Error(`adjudication_without_disagreement:${key}`);
      final.set(key, left);
    }
  }
  if (decisions.size !== disagreements.size) throw new Error("adjudication_decision_count");
  return { filePath, value, canonicalSha256, byteSha256: sha256(bytes), windows, memberships, final, disagreements };
}

function identity(row) { return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch }; }
function ptsBoundary(clipRows, frameIndex) { return frameIndex === clipRows.length ? `${BigInt(clipRows.at(-1).ptsTicks) + 1n}` : clipRows[frameIndex].ptsTicks; }

function compileWindows(adjudication, context) {
  const windows = adjudication.windows.map((window) => {
    const rows = context.decoderByClip.get(window.clipId);
    return {
      windowId: window.windowId, clipId: window.clipId,
      startPtsTicks: ptsBoundary(rows, window.startFrameIndex), endPtsTicksExclusive: ptsBoundary(rows, window.endFrameIndexExclusive),
      expectedDecoderRows: window.endFrameIndexExclusive - window.startFrameIndex,
      purposeTags: window.purposeTags, scenarioTags: window.scenarioTags,
    };
  });
  return withSelfHash({ artifactType: "manual-windows-v2", schemaVersion: 2, windows });
}

function mergeFinalIntervals(final, memberships, context, projection) {
  const rows = [];
  for (const clip of context.evaluationContract.sourceBinding.paired) {
    const decoder = context.decoderByClip.get(clip.clipId); let start = 0; let serial = 0;
    while (start < decoder.length) {
      const base = projection(final.get(`${clip.clipId}:${start}`));
      const memberKey = stableJson(memberships.get(`${clip.clipId}:${start}`));
      let end = start + 1;
      while (end < decoder.length && stableEqual(base, projection(final.get(`${clip.clipId}:${end}`))) && stableJson(memberships.get(`${clip.clipId}:${end}`)) === memberKey) end += 1;
      rows.push({ clipId: clip.clipId, startFrameIndex: start, endFrameIndexExclusive: end, serial, value: base });
      serial += 1; start = end;
    }
  }
  return rows;
}

function buildArtifacts(first, second, adjudication, context) {
  const manualWindows = compileWindows(adjudication, context);
  const labelSegments = mergeFinalIntervals(adjudication.final, adjudication.memberships, context, (value) => ({ scenarios: value.scenarios, ...value.state, subjectSelection: undefined }));
  const subjectSegments = mergeFinalIntervals(adjudication.final, adjudication.memberships, context, (value) => value.state.subjectSelection);
  const manualLabels = labelSegments.map((segment) => {
    const { subjectSelection: _ignored, ...labelState } = segment.value;
    const decoder = context.decoderByClip.get(segment.clipId);
    return {
      artifactType: "manual-label-v2", labelId: `label-${segment.clipId}-${String(segment.serial).padStart(4, "0")}`,
      span: { kind: "interval", clipId: segment.clipId, startPtsTicks: ptsBoundary(decoder, segment.startFrameIndex), endPtsTicksExclusive: ptsBoundary(decoder, segment.endFrameIndexExclusive), loopEpoch: 0 },
      scenarios: labelState.scenarios, presence: labelState.presence, personState: labelState.personState, occlusion: labelState.occlusion,
      contact: labelState.contact, handObservability: labelState.handObservability, endpointObservability: labelState.endpointObservability,
      provenance: { origin: "manual_video", reviewStatus: "adjudicated" },
    };
  });
  const manualSubjects = subjectSegments.map((segment) => {
    const decoder = context.decoderByClip.get(segment.clipId);
    return {
      artifactType: "manual-subject-selection-v2", selectionId: `subject-${segment.clipId}-${String(segment.serial).padStart(4, "0")}`,
      span: { kind: "interval", clipId: segment.clipId, startPtsTicks: ptsBoundary(decoder, segment.startFrameIndex), endPtsTicksExclusive: ptsBoundary(decoder, segment.endFrameIndexExclusive), loopEpoch: 0 },
      state: segment.value.state, manualTargetId: segment.value.manualTargetId, anchor: segment.value.anchor, evidence: "manual_video",
    };
  });
  const reviewRows = (review, pass) => context.decoderRows.map((row) => ({
    artifactType: "manual-review-v2", pass, reviewerHash: review.review.reviewerPseudonymSha256, identity: identity(row), reviewed: true, origin: "manual", state: review.materialized.values.get(`${row.clipId}:${row.sourceFrameIndex}`).state,
  }));
  const adjudicationRows = [...adjudication.disagreements.entries()].map(([key, entry]) => {
    const [clipId, frameText] = key.split(":"); const row = context.decoderByClip.get(clipId)[Number(frameText)];
    if (entry.fields.some((field) => field === "scenarios" || field.startsWith("scenarios."))) {
      throw new Error(`compiled_scenario_disagreement_unsupported:${key}`);
    }
    const stateFields = differenceFields(first.materialized.values.get(key).state, second.materialized.values.get(key).state);
    if (!stateFields.length) throw new Error(`compiled_disagreement_projection_empty:${key}`);
    return { artifactType: "manual-adjudication-v2", adjudicatorHash: adjudication.value.adjudicatorPseudonymSha256, identity: identity(row), disagreementFields: stateFields, decision: entry.decision.state, origin: "manual", adjudicated: true };
  }).sort((a, b) => context.decoderRows.findIndex((row) => row.clipId === a.identity.clipId && row.sourceFrameIndex === a.identity.sourceFrameIndex) - context.decoderRows.findIndex((row) => row.clipId === b.identity.clipId && row.sourceFrameIndex === b.identity.sourceFrameIndex));
  const policy = withSelfHash({
    artifactType: "manual-policy-v2", schemaVersion: 2, contractCanonicalSha256: context.hashes.evaluationContract, schemaCanonicalSha256: context.hashes.evaluationSchema,
    reviewerHashes: { first: first.review.reviewerPseudonymSha256, second: second.review.reviewerPseudonymSha256, adjudicator: adjudication.value.adjudicatorPseudonymSha256 },
    thresholds: { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95, preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2 },
  });
  const summary = withSelfHash({
    artifactType: "manual-summary-v2", schemaVersion: 2, decoderRows: 6711, materializedManualRows: 6711, materializedSubjectRows: 6711, reviewPass1Rows: 6711, reviewPass2Rows: 6711,
    perClip: context.evaluationContract.sourceBinding.paired.map((clip) => ({ clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows })),
  });
  const artifacts = new Map([
    ["manual-windows.json", prettyJson(manualWindows)], ["manual-labels.jsonl", jsonl(manualLabels)], ["manual-subject-selection.jsonl", jsonl(manualSubjects)],
    ["manual-review-pass1.jsonl", jsonl(reviewRows(first, "first"))], ["manual-review-pass2.jsonl", jsonl(reviewRows(second, "second"))],
    ["manual-adjudication.jsonl", jsonl(adjudicationRows)], ["manual-policy.json", prettyJson(policy)], ["manual-summary.json", prettyJson(summary)],
  ]);
  const jsonCanonical = (name) => canonicalHash(JSON.parse(artifacts.get(name)), true);
  const manifest = withSelfHash({
    artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p0",
    files: {
      contract: { path: "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json", canonicalSha256: context.hashes.evaluationContract },
      schema: { path: "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json", canonicalSha256: context.hashes.evaluationSchema },
      sourceInventory: { path: "tests/fixtures/sam-goal-v2/labels/source-inventory.json", canonicalSha256: context.hashes.sourceInventory },
      decoderManifest: { path: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl", byteSha256: context.decoderByteSha256 },
      manualWindows: { path: "manual-windows.json", canonicalSha256: jsonCanonical("manual-windows.json") },
      manualLabels: { path: "manual-labels.jsonl", byteSha256: sha256(artifacts.get("manual-labels.jsonl")) },
      manualSubjectSelection: { path: "manual-subject-selection.jsonl", byteSha256: sha256(artifacts.get("manual-subject-selection.jsonl")) },
      manualReviewPass1: { path: "manual-review-pass1.jsonl", byteSha256: sha256(artifacts.get("manual-review-pass1.jsonl")) },
      manualReviewPass2: { path: "manual-review-pass2.jsonl", byteSha256: sha256(artifacts.get("manual-review-pass2.jsonl")) },
      manualAdjudication: { path: "manual-adjudication.jsonl", byteSha256: sha256(artifacts.get("manual-adjudication.jsonl")) },
      manualPolicy: { path: "manual-policy.json", canonicalSha256: jsonCanonical("manual-policy.json") },
      manualSummary: { path: "manual-summary.json", canonicalSha256: jsonCanonical("manual-summary.json") },
    },
  });
  artifacts.set("evaluation-pack.json", prettyJson(manifest));
  return { artifacts, manifest, manualLabels, manualSubjects, adjudicationRows };
}

function loadCompilerInputs(options, context) {
  const reviewAPath = resolvePath(options.reviewA); const reviewBPath = resolvePath(options.reviewB); const adjudicationPath = resolvePath(options.adjudication);
  const reviewAReal = realpathSync(reviewAPath); const reviewBReal = realpathSync(reviewBPath); const adjudicationReal = realpathSync(adjudicationPath);
  if (reviewAReal === reviewBReal) throw new Error("review_paths_not_independent");
  const first = validateReview(reviewAReal, "first", "", context, "review_a");
  const second = validateReview(reviewBReal, "second", "", context, "review_b");
  if (first.review.reviewerPseudonymSha256 === second.review.reviewerPseudonymSha256) throw new Error("reviewer_pseudonyms_not_distinct");
  const adjudication = validateAdjudication(adjudicationReal, first, second, context);
  return { first, second, adjudication, built: buildArtifacts(first, second, adjudication, context) };
}

function writeSynced(filePath, contents) {
  const descriptor = openSync(filePath, "wx", 0o600);
  try { writeFileSync(descriptor, contents); fsyncSync(descriptor); } finally { closeSync(descriptor); }
}
function fsyncDirectory(dirPath) { const descriptor = openSync(dirPath, "r"); try { fsyncSync(descriptor); } finally { closeSync(descriptor); } }

function spawnCaptured(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || REPO_ROOT, env: options.env || process.env, stdio: ["ignore", "pipe", "pipe"] });
    ACTIVE_CHILDREN.add(child);
    const stdout = []; const stderr = []; let bytes = 0; let settled = false;
    const collect = (target) => (chunk) => {
      bytes += chunk.length;
      if (bytes > (options.maxBuffer || 64 * 1024 * 1024)) { child.kill("SIGKILL"); return; }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      ACTIVE_CHILDREN.delete(child);
      if (!settled) { settled = true; reject(error); }
    });
    child.on("close", (status, signal) => {
      ACTIVE_CHILDREN.delete(child);
      if (settled) return;
      settled = true;
      if (bytes > (options.maxBuffer || 64 * 1024 * 1024)) { reject(new Error(`child_output_limit:${command}`)); return; }
      resolve({ status, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

async function testBarrier(name, payload) {
  const prefix = `SAM_GOAL_MANUAL_PACK_TEST_${name.toUpperCase()}`;
  const ready = process.env[`${prefix}_READY_FILE`] || ""; const release = process.env[`${prefix}_RELEASE_FILE`] || "";
  if (!ready && !release) return;
  if (!ready || !release) throw new Error(`test_barrier_configuration:${name}`);
  writeSynced(ready, `${payload}\n`);
  const deadline = Date.now() + 15_000;
  while (!existsSync(release)) {
    if (Date.now() >= deadline) throw new Error(`test_barrier_timeout:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const MACOS_RENAME_EXCL_HELPER = String.raw`
import ctypes, errno, json, os, sys
if sys.platform != "darwin":
    print(json.dumps({"ok": False, "error": "unsupported_platform", "platform": sys.platform}))
    raise SystemExit(90)
libc = ctypes.CDLL(None, use_errno=True)
renameatx_np = libc.renameatx_np
renameatx_np.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameatx_np.restype = ctypes.c_int
result = renameatx_np(-2, os.fsencode(sys.argv[1]), -2, os.fsencode(sys.argv[2]), 0x00000004)
if result != 0:
    number = ctypes.get_errno()
    print(json.dumps({"ok": False, "errno": number, "name": errno.errorcode.get(number, "UNKNOWN")}))
    raise SystemExit(1)
print(json.dumps({"ok": True}))
`;

async function renameDirectoryNoReplace(source, destination) {
  if (process.platform !== "darwin") throw new Error(`rename_excl_unsupported_platform:${process.platform}`);
  let result;
  try { result = await spawnCaptured("/usr/bin/python3", ["-c", MACOS_RENAME_EXCL_HELPER, source, destination]); }
  catch (error) { throw new Error(`rename_excl_helper_unavailable:${error.message}`); }
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(`rename_excl_helper_invalid:${result.status}:${result.stdout}:${result.stderr}`); }
  if (result.status === 0 && report.ok === true) return;
  if ([17, 66].includes(report.errno)) throw new Error(`output_dir_raced:${destination}:${report.name}`);
  throw new Error(`rename_excl_failed:${destination}:${report.errno || report.error || result.signal || result.status}:${result.stderr}`);
}

async function runAuditor(labelDir, context, expectedP0 = "") {
  const args = [context.paths.auditor, "--label-dir", labelDir, "--phase", "p0"];
  if (expectedP0) args.push("--expected-p0-lock-sha256", expectedP0);
  const result = await spawnCaptured(process.execPath, args);
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(`auditor_report_invalid:${result.status}:${result.stdout}:${result.stderr}`); }
  if (result.status !== 0 || ![expectedP0 ? "passed" : "candidate"].includes(report.status)) throw new Error(`auditor_failed:${report.errors?.[0]?.detail || result.stderr || report.status}`);
  return report;
}

async function compileAtomic(outputDir, inputs, context) {
  if (existsSync(outputDir)) throw new Error(`output_dir_exists:${outputDir}`);
  const parent = path.dirname(outputDir);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error(`output_parent_missing:${parent}`);
  const stage = path.join(parent, `.${path.basename(outputDir)}.tmp-${process.pid}-${randomUUID()}`);
  let committed = false;
  try {
    mkdirSync(stage, { recursive: false, mode: 0o700 });
    ACTIVE_TEMP_PATHS.add(stage);
    await testBarrier("stage", stage);
    for (const [name, contents] of inputs.built.artifacts) writeSynced(path.join(stage, name), contents);
    if (process.env.SAM_GOAL_MANUAL_PACK_FAULT_AFTER_FILES === "1") throw new Error("injected_compile_failure");
    const audit = await runAuditor(stage, context);
    if (audit.candidateP0LockSha256 !== inputs.built.manifest.expectedCanonicalHash) throw new Error("candidate_hash_mismatch");
    fsyncDirectory(stage);
    await testBarrier("commit", stage);
    await renameDirectoryNoReplace(stage, outputDir);
    if (existsSync(stage) || !existsSync(outputDir) || !statSync(outputDir).isDirectory()) throw new Error(`rename_excl_postcondition:${stage}:${outputDir}`);
    committed = true; ACTIVE_TEMP_PATHS.delete(stage); fsyncDirectory(parent);
    return audit;
  } finally {
    ACTIVE_TEMP_PATHS.delete(stage);
    if (!committed) rmSync(stage, { recursive: true, force: true });
  }
}

function compareCompiled(labelDir, built) {
  const names = [...COMPILED_FILES].sort();
  const entries = readdirSync(labelDir).sort();
  if (!stableEqual(entries, names)) throw new Error(`compiled_file_set_drift:${entries.join(",")}:${names.join(",")}`);
  const descriptors = []; const bytesByName = new Map();
  for (const name of names) {
    const bytes = readFileSync(path.join(labelDir, name));
    const expected = built.artifacts.get(name);
    if (expected === undefined || !bytes.equals(Buffer.from(expected, "utf8"))) throw new Error(`compiled_artifact_mismatch:${name}`);
    descriptors.push({ path: name, byteSha256: sha256(bytes) });
    bytesByName.set(name, bytes);
  }
  return { descriptors, bytesByName };
}
function builtDescriptors(built) {
  return [...COMPILED_FILES].sort().map((name) => {
    const contents = built.artifacts.get(name);
    if (contents === undefined) throw new Error(`compiled_artifact_missing:${name}`);
    return { path: name, byteSha256: sha256(Buffer.from(contents, "utf8")) };
  });
}

function sealedInputs(inputs) {
  return {
    reviewA: { role: "first", reviewerPseudonymSha256: inputs.first.review.reviewerPseudonymSha256, canonicalSha256: inputs.first.canonicalSha256, byteSha256: inputs.first.byteSha256 },
    reviewB: { role: "second", reviewerPseudonymSha256: inputs.second.review.reviewerPseudonymSha256, canonicalSha256: inputs.second.canonicalSha256, byteSha256: inputs.second.byteSha256 },
    adjudication: { adjudicatorPseudonymSha256: inputs.adjudication.value.adjudicatorPseudonymSha256, canonicalSha256: inputs.adjudication.canonicalSha256, byteSha256: inputs.adjudication.byteSha256 },
  };
}
function dependencyDescriptor(context) {
  return {
    evaluationContractCanonicalSha256: context.hashes.evaluationContract, evaluationSchemaCanonicalSha256: context.hashes.evaluationSchema,
    authoringSchemaCanonicalSha256: context.hashes.authoringSchema, anchorSchemaCanonicalSha256: context.hashes.anchorSchema,
    sourceInventoryCanonicalSha256: context.hashes.sourceInventory, decoderByteSha256: context.decoderByteSha256, decoderCanonicalRowsSha256: context.decoderCanonicalRowsSha256,
  };
}

function assertAnchorOutside(anchorPath, labelDir) {
  const labelReal = realpathSync(labelDir);
  const parent = path.dirname(anchorPath);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) throw new Error(`anchor_parent_missing:${parent}`);
  const candidate = path.join(realpathSync(parent), path.basename(anchorPath));
  const relative = path.relative(labelReal, candidate);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("anchor_inside_label_dir");
}

function expectedAnchor(labelDir, inputs, context) {
  const { descriptors, bytesByName } = compareCompiled(labelDir, inputs.built);
  const manifestBytes = bytesByName.get("evaluation-pack.json");
  const manifest = parseJsonBytes(manifestBytes, "evaluation_pack");
  const candidateP0LockSha256 = verifySelfHash(manifest, "evaluation_pack");
  if (candidateP0LockSha256 !== inputs.built.manifest.expectedCanonicalHash) throw new Error("evaluation_pack_candidate_drift");
  const anchor = withSelfHash({
    artifactType: "sam-goal-p0-external-anchor", schemaVersion: 1, candidateP0LockSha256,
    evaluationPack: { path: "evaluation-pack.json", canonicalSha256: candidateP0LockSha256, byteSha256: sha256(manifestBytes) },
    compiledArtifacts: descriptors, compiledArtifactSetSha256: canonicalHash(descriptors),
    dependencies: dependencyDescriptor(context), sealedInputs: sealedInputs(inputs),
  });
  validateSchemaValue(context.anchorSchema, context.anchorSchema, anchor, "anchor");
  return anchor;
}

async function createAnchor(anchorPath, labelDir, inputs, context) {
  if (existsSync(anchorPath)) throw new Error(`anchor_exists:${anchorPath}`);
  assertAnchorOutside(anchorPath, labelDir);
  const audit = await runAuditor(labelDir, context);
  const anchor = expectedAnchor(labelDir, inputs, context);
  if (audit.candidateP0LockSha256 !== anchor.candidateP0LockSha256) throw new Error("anchor_audit_candidate_drift");
  const parent = path.dirname(anchorPath); const temp = path.join(parent, `.${path.basename(anchorPath)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    ACTIVE_TEMP_PATHS.add(temp);
    writeSynced(temp, prettyJson(anchor));
    await testBarrier("anchor", temp);
    if (process.env.SAM_GOAL_MANUAL_PACK_FAULT_BEFORE_ANCHOR_LINK === "1") throw new Error("injected_anchor_failure");
    linkSync(temp, anchorPath);
    fsyncDirectory(parent);
  } finally { ACTIVE_TEMP_PATHS.delete(temp); rmSync(temp, { force: true }); }
  return anchor;
}

async function verifyAnchor(anchorPath, labelDir, inputs, context) {
  assertAnchorOutside(anchorPath, labelDir);
  const { bytes: before, value: anchor } = readJsonSnapshot(anchorPath, "anchor");
  validateSchemaValue(context.anchorSchema, context.anchorSchema, anchor, "anchor");
  verifySelfHash(anchor, "anchor");
  const expected = expectedAnchor(labelDir, inputs, context);
  if (!stableEqual(anchor, expected)) throw new Error("anchor_binding_drift");
  const audit = await runAuditor(labelDir, context, anchor.candidateP0LockSha256);
  if (audit.status !== "passed" || !audit.externallyVerified || !audit.frozen) throw new Error("anchor_audit_not_frozen");
  if (!readFileSync(anchorPath).equals(before)) throw new Error("verify_anchor_mutated");
  return { anchor, audit };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const context = loadContext(options);
  if (options.mode === "validate-review") {
    const reviewPath = resolvePath(options.review);
    const result = validateReview(reviewPath, options.expectedRole, options.expectedReviewer, context, "review");
    console.log(JSON.stringify({
      status: "passed", mode: "validate-review", role: result.review.role,
      reviewerPseudonymSha256: result.review.reviewerPseudonymSha256, reviewCanonicalSha256: result.canonicalSha256,
      materializedRows: result.materialized.values.size, support: result.report.support, reacquireCandidates: result.report.reacquireCandidates,
    }, null, 2));
    return;
  }
  const inputs = loadCompilerInputs(options, context);
  if (options.mode === "compile") {
    const outputDir = resolvePath(options.outputDir);
    const audit = await compileAtomic(outputDir, inputs, context);
    console.log(JSON.stringify({
      status: "compiled", mode: "compile", outputDir, materializedRowsPerPass: 6711,
      disagreements: inputs.adjudication.disagreements.size, candidateP0LockSha256: audit.candidateP0LockSha256,
      compiledArtifactSetSha256: canonicalHash(builtDescriptors(inputs.built)),
    }, null, 2));
    return;
  }
  const anchorPath = resolvePath(options.anchor); const labelDir = resolvePath(options.labelDir);
  if (!existsSync(labelDir) || !statSync(labelDir).isDirectory()) throw new Error(`label_dir_missing:${labelDir}`);
  if (options.mode === "create-anchor") {
    const anchor = await createAnchor(anchorPath, labelDir, inputs, context);
    console.log(JSON.stringify({
      status: "created", mode: "create-anchor", anchor: anchorPath, candidateP0LockSha256: anchor.candidateP0LockSha256,
      anchorCanonicalSha256: anchor.expectedCanonicalHash, compiledArtifactSetSha256: anchor.compiledArtifactSetSha256,
    }, null, 2));
    return;
  }
  const verified = await verifyAnchor(anchorPath, labelDir, inputs, context);
  console.log(JSON.stringify({
    status: "passed", mode: "verify-anchor", anchor: anchorPath, frozen: true, externallyVerified: true,
    candidateP0LockSha256: verified.anchor.candidateP0LockSha256, anchorCanonicalSha256: verified.anchor.expectedCanonicalHash,
  }, null, 2));
}

try { await main(); }
catch (error) {
  const message = error.message || String(error);
  console.log(JSON.stringify({ status: "failed", mode: process.argv[2] || null, errors: [{ code: message.split(":", 1)[0] || "manual_pack_error", detail: message }] }, null, 2));
  process.exitCode = 1;
}
