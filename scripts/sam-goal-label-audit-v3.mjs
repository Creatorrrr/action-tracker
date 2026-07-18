#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V3_ROOT = "tests/fixtures/sam-goal-v2/evaluation-v3";
const PATHS = Object.freeze({
  contract: `${V3_ROOT}/evaluation-contract.json`,
  labelSchema: `${V3_ROOT}/label-schema.json`,
  teacherInventory: `${V3_ROOT}/teacher-input-inventory.json`,
  teacherPolicy: `${V3_ROOT}/teacher-policy.json`,
  teacherSchema: `${V3_ROOT}/teacher-schema.json`,
  p0AnchorSchema: `${V3_ROOT}/p0-lock-anchor-v2-schema.json`,
  p1AnchorSchema: `${V3_ROOT}/p1-lock-anchor-schema.json`,
  historicalP0AnchorSchema: "tests/fixtures/sam-goal-v2/evaluation-v2/p0-lock-anchor-schema.json",
  sourceContract: "tests/fixtures/sam-goal-v2/source-contract.json",
  sourceSchema: "tests/fixtures/sam-goal-v2/source-schema.json",
  sourceInventory: "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
  decoderManifest: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl",
});
const ACCEPTED = Object.freeze({
  contract: "5307a5d4e2c56e652b7a417713e1b0ebff5dabf712e591eefa94737e7318b1bd",
  labelSchema: "afe645d7c062e3644db96cea20b2f6724892077f1993de829a28deeb38d138f8",
  teacherInventory: "50756ed7c4d461632cea1c96a12fc53910b1112ebc15b92e2f514733e4830f04",
  teacherPolicy: "d38b9583cd5b9d9cd57d947866c1f5140e880f93095024b54c613fc3d8c804d7",
  teacherSchema: "167e92cc6a499cf57a6d10d5d0b3df4d22c8a76fae662927a46b0ade61208035",
  p0AnchorSchema: "827ef909587e99b0ed991638f36a2abd5c3941aec807a671e8030ba6a961ff84",
  p1AnchorSchema: "c709738e7214824b29985501ab7291be0919345aae69eb46d9e1ade9d316045c",
  historicalP0AnchorSchemaBytes: "5fb22bf90e604acff911799344b7993239a463b6a4af278404aae766f3e49d85",
  sourceContract: "39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873",
  sourceSchema: "ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244",
  sourceInventory: "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d",
  decoderBytes: "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79",
  decoderRows: "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d",
});
const SHA_RE = /^[0-9a-f]{64}$/;
const SCOPES = Object.freeze(["torsoFacing", "fullBody", "head", "leftArm", "rightArm", "leftHand", "rightHand", "leftLeg", "rightLeg", "calibration", "leftContact", "rightContact"]);
const MOVEMENT_SCOPES = Object.freeze(SCOPES.filter((scope) => !["calibration", "leftContact", "rightContact"].includes(scope)));
const REFINEMENT_STATUSES = Object.freeze(["unavailable", "identity_boundary", "identity_selection_gap", "identity_input_invalid", "identity_nonuniform_pts", "identity_safety_fallback", "smoothed"]);
const OBSERVABILITY_FIELDS = Object.freeze(["occlusion.body", "occlusion.leftFoot", "occlusion.rightFoot", "occlusion.leftHand", "occlusion.rightHand", "handObservability.left", "handObservability.right", "endpointObservability.leftWrist", "endpointObservability.rightWrist", "endpointObservability.leftAnkle", "endpointObservability.rightAnkle", "endpointObservability.head"]);
const P0_COMPILED = Object.freeze(["evaluation-pack.json", "manual-windows.json", "manual-labels.jsonl", "manual-subject-selection.jsonl", "manual-review-pass1.jsonl", "manual-review-pass2.jsonl", "manual-adjudication.jsonl", "manual-policy.json", "manual-summary.json"]);
const P1_COMPILED = Object.freeze(["evaluation-pack-p1.json", "evaluation-lock-p1.json", "teacher-source-manifest.json", "teacher-dataset-v2.jsonl", "teacher-refined.jsonl", "teacher-mask-v2.jsonl", "teacher-summary.json"]);

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p0-candidate
  node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p0 --p0-anchor <path> --expected-p0-anchor-sha256 <sha256> --review-a <path> --review-b <path> --adjudication <path>
  node scripts/sam-goal-label-audit-v3.mjs --label-dir <dir> --phase p1 --p0-anchor <path> --expected-p0-anchor-sha256 <sha256> --p1-anchor <path> --expected-p1-anchor-sha256 <sha256>`);
}

export function parseArgs(argv) {
  const names = new Map([
    ["--label-dir", "labelDir"], ["--phase", "phase"], ["--p0-anchor", "p0Anchor"],
    ["--expected-p0-anchor-sha256", "expectedP0"], ["--p1-anchor", "p1Anchor"],
    ["--expected-p1-anchor-sha256", "expectedP1"], ["--review-a", "reviewA"],
    ["--review-b", "reviewB"], ["--adjudication", "adjudication"],
  ]);
  const options = { labelDir: "", phase: "", p0Anchor: "", expectedP0: "", p1Anchor: "", expectedP1: "", reviewA: "", reviewB: "", adjudication: "" };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { usage(); return { help: true }; }
    const key = names.get(arg);
    if (!key) throw new Error(`unknown_argument:${arg}`);
    if (seen.has(key)) throw new Error(`duplicate_argument:${arg}`);
    seen.add(key);
    const value = argv[index += 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
    options[key] = value;
  }
  if (!options.labelDir) throw new Error("label_dir_required");
  if (!["p0-candidate", "p0", "p1"].includes(options.phase)) throw new Error(`phase_invalid:${options.phase}`);
  const supplied = new Set([...seen]);
  const expected = {
    "p0-candidate": new Set(["labelDir", "phase"]),
    p0: new Set(["labelDir", "phase", "p0Anchor", "expectedP0", "reviewA", "reviewB", "adjudication"]),
    p1: new Set(["labelDir", "phase", "p0Anchor", "expectedP0", "p1Anchor", "expectedP1"]),
  }[options.phase];
  if (supplied.size !== expected.size || [...supplied].some((key) => !expected.has(key))) throw new Error(`phase_argument_set_invalid:${options.phase}`);
  if (options.expectedP0 && !SHA_RE.test(options.expectedP0)) throw new Error("expected_p0_anchor_sha256_invalid");
  if (options.expectedP1 && !SHA_RE.test(options.expectedP1)) throw new Error("expected_p1_anchor_sha256_invalid");
  return options;
}

const AUDIT_OPTION_KEYS = Object.freeze(["labelDir", "phase", "p0Anchor", "expectedP0", "p1Anchor", "expectedP1", "reviewA", "reviewB", "adjudication"]);
export function validateAuditOptions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("audit_options_invalid");
  const keys = Object.keys(input);
  if (keys.some((key) => !AUDIT_OPTION_KEYS.includes(key))) throw new Error(`phase_argument_set_invalid:${input.phase || "unknown"}`);
  const supplied = new Set(keys.filter((key) => input[key] !== "" && input[key] !== undefined && input[key] !== null));
  const expected = {
    "p0-candidate": new Set(["labelDir", "phase"]),
    p0: new Set(["labelDir", "phase", "p0Anchor", "expectedP0", "reviewA", "reviewB", "adjudication"]),
    p1: new Set(["labelDir", "phase", "p0Anchor", "expectedP0", "p1Anchor", "expectedP1"]),
  }[input.phase];
  if (!expected || supplied.size !== expected.size || [...supplied].some((key) => !expected.has(key))) throw new Error(`phase_argument_set_invalid:${input.phase || "unknown"}`);
  if (!SHA_RE.test(input.expectedP0 || "") && input.phase !== "p0-candidate") throw new Error("expected_p0_anchor_sha256_invalid");
  if (input.phase === "p1" && !SHA_RE.test(input.expectedP1 || "")) throw new Error("expected_p1_anchor_sha256_invalid");
  return input;
}

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort((a, b) => Buffer.from(a).compare(Buffer.from(b))).map((key) => [key, stableValue(value[key])]));
  return value;
}
export function stableStringify(value) { return JSON.stringify(stableValue(value)); }
export function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function canonicalHash(value, omitExpected = false) {
  let target = value;
  if (omitExpected && value && typeof value === "object" && !Array.isArray(value)) { target = { ...value }; delete target.expectedCanonicalHash; }
  return sha256(Buffer.from(stableStringify(target), "utf8"));
}
function stableEqual(left, right) { return stableStringify(left) === stableStringify(right); }
function repoPath(relativePath) { return path.resolve(REPO_ROOT, relativePath); }
function parseJsonBuffer(buffer, label) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`bom_forbidden:${label}`);
  try { return JSON.parse(buffer.toString("utf8")); } catch (error) { throw new Error(`json_invalid:${label}:${error.message}`); }
}
function snapshotFile(filePath, label, noFollow = false) {
  const resolved = path.resolve(filePath); const ancestors = ancestorIdentityChain(resolved, label);
  let beforeLink;
  try { beforeLink = lstatSync(resolved, { bigint: true }); } catch (error) { throw new Error(`artifact_missing:${label}:${resolved}:${error.code || "error"}`); }
  if (beforeLink.isSymbolicLink() || !beforeLink.isFile()) throw new Error(noFollow ? `anchor_symlink:${label}` : `artifact_not_regular:${label}`);
  assertAncestorIdentityChain(ancestors, label);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0);
  const fd = openSync(resolved, flags);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || !sameStatIdentity(statIdentity(beforeLink), statIdentity(before))) throw new Error(`artifact_final_replaced:${label}`);
    const buffer = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "nlink"]) if (before[key] !== after[key]) throw new Error(`artifact_changed_during_read:${label}:${key}`);
    if (BigInt(buffer.length) !== before.size) throw new Error(`artifact_short_read:${label}`);
    assertAncestorIdentityChain(ancestors, label); const post = lstatSync(resolved, { bigint: true });
    if (post.isSymbolicLink() || !post.isFile() || !sameStatIdentity(statIdentity(before), statIdentity(post))) throw new Error(`artifact_final_replaced:${label}`);
    assertAncestorIdentityChain(ancestors, label);
    return { filePath: resolved, buffer, stat: before, byteSha256: sha256(buffer), ancestors };
  } finally { closeSync(fd); }
}

function cliPath(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) throw new Error("cli_path_invalid");
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(process.cwd(), input);
}
function statIdentity(stat) { return { dev: stat.dev, ino: stat.ino, mode: stat.mode, nlink: stat.nlink }; }
function sameStatIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink; }
function ancestorIdentityChain(filePath, label) {
  const resolved = path.resolve(filePath); const root = path.parse(resolved).root; const relative = path.relative(root, path.dirname(resolved));
  const chain = []; let cursor = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let status;
    try { status = lstatSync(cursor, { bigint: true }); } catch (error) { throw new Error(`external_ancestor_missing:${label}:${cursor}:${error.code || "error"}`); }
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`anchor_ancestor_symlink:${label}:${cursor}`);
    chain.push({ path: cursor, identity: statIdentity(status) });
  }
  return chain;
}
function assertAncestorIdentityChain(chain, label) {
  for (const entry of chain) {
    let status;
    try { status = lstatSync(entry.path, { bigint: true }); } catch (error) { throw new Error(`external_ancestor_replaced:${label}:${entry.path}:${error.code || "error"}`); }
    if (status.isSymbolicLink() || !status.isDirectory() || !sameStatIdentity(entry.identity, statIdentity(status))) throw new Error(`external_ancestor_replaced:${label}:${entry.path}`);
  }
}
function externalBoundary(testHooks, boundary, details) {
  testHooks?.onExternalSnapshotBoundary?.({ boundary, ...details });
}

export function secureExternalSnapshot(input, label, labelDirReal, artifactSnapshots = [], testHooks = null) {
  const filePath = cliPath(input); const ancestors = ancestorIdentityChain(filePath, label);
  externalBoundary(testHooks, "ancestors-captured", { filePath, label });
  assertAncestorIdentityChain(ancestors, label);
  let pre;
  try { pre = lstatSync(filePath, { bigint: true }); } catch (error) { throw new Error(`artifact_missing:${label}:${filePath}:${error.code || "error"}`); }
  if (pre.isSymbolicLink() || !pre.isFile()) throw new Error(`anchor_not_plain_regular:${label}`);
  if (pre.nlink !== 1n) throw new Error(`anchor_link_count:${label}:${pre.nlink}`);
  externalBoundary(testHooks, "final-lstat", { filePath, label });
  assertAncestorIdentityChain(ancestors, label);
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0); let fd;
  try { fd = openSync(filePath, flags); } catch (error) { throw new Error(`external_open_failed:${label}:${error.code || "error"}`); }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) throw new Error(`anchor_fd_not_plain_regular:${label}`);
    if (!sameStatIdentity(statIdentity(pre), statIdentity(before))) throw new Error(`external_final_replaced:${label}:pre_to_fd`);
    externalBoundary(testHooks, "fd-opened", { filePath, label, fd });
    assertAncestorIdentityChain(ancestors, label);
    const buffer = readFileSync(fd); const after = fstatSync(fd, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "nlink"]) if (before[key] !== after[key]) throw new Error(`artifact_changed_during_read:${label}:${key}`);
    if (BigInt(buffer.length) !== before.size) throw new Error(`artifact_short_read:${label}`);
    externalBoundary(testHooks, "buffer-read", { filePath, label, fd });
    assertAncestorIdentityChain(ancestors, label);
    let post;
    try { post = lstatSync(filePath, { bigint: true }); } catch (error) { throw new Error(`external_final_replaced:${label}:${error.code || "error"}`); }
    if (post.isSymbolicLink() || !post.isFile() || post.nlink !== 1n || !sameStatIdentity(statIdentity(before), statIdentity(post))) throw new Error(`external_final_replaced:${label}:fd_to_path`);
    const resolved = realpathSync(filePath); const resolvedStat = statSync(resolved, { bigint: true });
    if (!sameStatIdentity(statIdentity(before), statIdentity(resolvedStat))) throw new Error(`external_realpath_rebound:${label}`);
    assertAncestorIdentityChain(ancestors, label);
    const packRelative = path.relative(labelDirReal, resolved);
    if (packRelative === "" || (!packRelative.startsWith(`..${path.sep}`) && packRelative !== ".." && !path.isAbsolute(packRelative))) throw new Error(`anchor_inside_pack:${label}`);
    for (const artifact of artifactSnapshots) if (artifact && artifact.stat.dev === before.dev && artifact.stat.ino === before.ino) throw new Error(`anchor_aliases_pack_artifact:${label}`);
    externalBoundary(testHooks, "path-revalidated", { filePath, label, fd });
    return { filePath, buffer, stat: before, byteSha256: sha256(buffer), realpath: resolved, ancestors };
  } finally { closeSync(fd); }
}
function parseJsonlSnapshot(snapshot, label, allowEmpty = false, allowCarriageReturnInLineBytes = false) {
  const buffer = snapshot.buffer;
  if (allowEmpty && buffer.length === 0) return { lines: [], rows: [] };
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`bom_forbidden:${label}`);
  if (!buffer.length || buffer.at(-1) !== 0x0a) throw new Error(`terminal_lf_required:${label}`);
  if (!allowCarriageReturnInLineBytes && buffer.includes(0x0d)) throw new Error(`cr_forbidden:${label}`);
  const lines = buffer.subarray(0, -1).toString("utf8").split("\n");
  if (!allowEmpty && (lines.length === 0 || (lines.length === 1 && lines[0] === ""))) throw new Error(`jsonl_empty:${label}`);
  if (lines.some((line) => line.length === 0)) throw new Error(`jsonl_blank_line:${label}`);
  return {
    lines: lines.map((line) => Buffer.from(line, "utf8")),
    rows: lines.map((line, index) => { try { return JSON.parse(line); } catch (error) { throw new Error(`jsonl_invalid:${label}:${index + 1}:${error.message}`); } }),
  };
}
export function parseRawCrLfJsonlSnapshot(snapshot, label) {
  const buffer = snapshot.buffer;
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`bom_forbidden:${label}`);
  if (buffer.length < 2 || buffer.at(-2) !== 0x0d || buffer.at(-1) !== 0x0a) throw new Error(`raw_terminal_crlf_required:${label}`);
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0d && buffer[index + 1] !== 0x0a) throw new Error(`raw_lone_cr:${label}:${index}`);
    if (buffer[index] === 0x0a && (index === 0 || buffer[index - 1] !== 0x0d)) throw new Error(`raw_lone_lf:${label}:${index}`);
  }
  const lines = []; let start = 0;
  for (let index = 0; index < buffer.length - 1; index += 1) {
    if (buffer[index] !== 0x0d || buffer[index + 1] !== 0x0a) continue;
    if (index === start) throw new Error(`raw_blank_line:${label}:${lines.length + 1}`);
    lines.push(buffer.subarray(start, index)); start = index + 2; index += 1;
  }
  if (start !== buffer.length) throw new Error(`raw_mixed_terminator:${label}`);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const rows = lines.map((line, index) => { try { return JSON.parse(decoder.decode(line)); } catch (error) { throw new Error(`raw_jsonl_invalid:${label}:${index + 1}:${error.message}`); } });
  return { lines, rows };
}
function verifySelfHash(value, label) {
  if (!SHA_RE.test(value?.expectedCanonicalHash || "")) throw new Error(`self_hash_missing:${label}`);
  const actual = canonicalHash(value, true);
  if (actual !== value.expectedCanonicalHash) throw new Error(`self_hash_drift:${label}:${actual}`);
  return actual;
}

export function validateSchemaValue(root, schema, value, at = "$") {
  if (schema === true || schema === undefined) return;
  if (schema === false) throw new Error(`schema_validation:${at}:false_schema`);
  if (schema.$ref) {
    const prefix = "#/$defs/";
    if (!schema.$ref.startsWith(prefix) || !root.$defs?.[schema.$ref.slice(prefix.length)]) throw new Error(`schema_validation:${at}:bad_ref:${schema.$ref}`);
    validateSchemaValue(root, root.$defs[schema.$ref.slice(prefix.length)], value, at);
  }
  if (schema.allOf) for (const branch of schema.allOf) validateSchemaValue(root, branch, value, at);
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) { try { validateSchemaValue(root, branch, value, at); matches += 1; } catch { /* branch miss */ } }
    if (matches !== 1) throw new Error(`schema_validation:${at}:oneOf:${matches}`);
  }
  if (Object.hasOwn(schema, "const") && !stableEqual(value, schema.const)) throw new Error(`schema_validation:${at}:const`);
  if (schema.enum && !schema.enum.some((entry) => stableEqual(entry, value))) throw new Error(`schema_validation:${at}:enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const isType = (type) => ({
      object: value !== null && typeof value === "object" && !Array.isArray(value),
      array: Array.isArray(value), string: typeof value === "string", integer: Number.isSafeInteger(value),
      number: typeof value === "number" && Number.isFinite(value), boolean: typeof value === "boolean", null: value === null,
    })[type];
    if (!types.some(isType)) throw new Error(`schema_validation:${at}:type:${types.join("|")}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new Error(`schema_validation:${at}:minLength`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) throw new Error(`schema_validation:${at}:pattern`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`schema_validation:${at}:nonfinite`);
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`schema_validation:${at}:minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`schema_validation:${at}:maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`schema_validation:${at}:minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`schema_validation:${at}:maxItems`);
    if (schema.uniqueItems && new Set(value.map(stableStringify)).size !== value.length) throw new Error(`schema_validation:${at}:uniqueItems`);
    if (schema.items !== undefined) value.forEach((item, index) => validateSchemaValue(root, schema.items, item, `${at}/${index}`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`schema_validation:${at}:required:${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateSchemaValue(root, properties[key], child, `${at}/${key}`);
      else if (schema.additionalProperties === false) throw new Error(`schema_validation:${at}:additional:${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchemaValue(root, schema.additionalProperties, child, `${at}/${key}`);
    }
  }
}
function validateDef(schema, def, value, at) {
  if (!schema.$defs?.[def]) throw new Error(`schema_definition_missing:${def}`);
  validateSchemaValue(schema, schema.$defs[def], value, at);
}

function decoderIdentity(row) {
  return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch, decodeStatus: row.decodeStatus, decodeReason: row.decodeReason };
}
function identityKey(identity) { return `${identity.clipId}\u0000${identity.sourceFrameIndex}\u0000${identity.ptsTicks}\u0000${identity.timeBase?.numerator}/${identity.timeBase?.denominator}\u0000${identity.loopEpoch}`; }

function fixtureOverrideEntry(testHooks, channel, relativePath) {
  return testHooks?.[channel]?.[relativePath] || null;
}
function fixtureSnapshotPath(testHooks, channel, relativePath) {
  return fixtureOverrideEntry(testHooks, channel, relativePath)?.path || repoPath(relativePath);
}
function loadStaticJson(relativePath, label, testHooks = null) {
  const snapshot = snapshotFile(fixtureSnapshotPath(testHooks, "corePathOverrides", relativePath), label);
  return { snapshot, value: parseJsonBuffer(snapshot.buffer, label) };
}
function assertCanonicalHash(value, expected, label, omitExpected = false) {
  const actual = canonicalHash(value, omitExpected);
  if (actual !== expected) throw new Error(`${label}_hash_drift:${actual}`);
  return actual;
}

export function loadCore(testHooks = null) {
  const contract = loadStaticJson(PATHS.contract, "evaluation_contract_v3", testHooks);
  const labelSchema = loadStaticJson(PATHS.labelSchema, "label_schema_v3", testHooks);
  const teacherInventory = loadStaticJson(PATHS.teacherInventory, "teacher_input_inventory", testHooks);
  const teacherPolicy = loadStaticJson(PATHS.teacherPolicy, "teacher_policy", testHooks);
  const teacherSchema = loadStaticJson(PATHS.teacherSchema, "teacher_schema", testHooks);
  const p0AnchorSchema = loadStaticJson(PATHS.p0AnchorSchema, "p0_anchor_schema", testHooks);
  const p1AnchorSchema = loadStaticJson(PATHS.p1AnchorSchema, "p1_anchor_schema", testHooks);
  const historicalP0AnchorSchema = loadStaticJson(PATHS.historicalP0AnchorSchema, "historical_p0_anchor_schema", testHooks);
  const sourceContract = loadStaticJson(PATHS.sourceContract, "source_contract", testHooks);
  const sourceSchema = loadStaticJson(PATHS.sourceSchema, "source_schema", testHooks);
  const sourceInventory = loadStaticJson(PATHS.sourceInventory, "source_inventory", testHooks);

  if (contract.value.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("contract_draft_invalid");
  for (const [name, item] of [["label_schema", labelSchema], ["teacher_schema", teacherSchema], ["p0_anchor_schema", p0AnchorSchema], ["p1_anchor_schema", p1AnchorSchema]]) {
    if (item.value.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error(`${name}_draft_invalid`);
  }
  const hashes = {
    contract: assertCanonicalHash(contract.value, ACCEPTED.contract, "contract", true),
    labelSchema: assertCanonicalHash(labelSchema.value, ACCEPTED.labelSchema, "label_schema"),
    teacherInventory: assertPinnedSelfHashedArtifact(teacherInventory.value, ACCEPTED.teacherInventory, "teacher_inventory"),
    teacherPolicy: assertPinnedSelfHashedArtifact(teacherPolicy.value, ACCEPTED.teacherPolicy, "teacher_policy"),
    teacherSchema: assertCanonicalHash(teacherSchema.value, ACCEPTED.teacherSchema, "teacher_schema"),
    p0AnchorSchema: assertCanonicalHash(p0AnchorSchema.value, ACCEPTED.p0AnchorSchema, "p0_anchor_schema"),
    p1AnchorSchema: assertCanonicalHash(p1AnchorSchema.value, ACCEPTED.p1AnchorSchema, "p1_anchor_schema"),
    sourceContract: assertCanonicalHash(sourceContract.value, ACCEPTED.sourceContract, "source_contract", true),
    sourceSchema: assertCanonicalHash(sourceSchema.value, ACCEPTED.sourceSchema, "source_schema"),
    sourceInventory: assertCanonicalHash(sourceInventory.value, ACCEPTED.sourceInventory, "source_inventory", true),
  };
  verifySelfHash(contract.value, "evaluation_contract_v3");
  verifySelfHash(teacherInventory.value, "teacher_input_inventory");
  verifySelfHash(teacherPolicy.value, "teacher_policy");
  verifySelfHash(sourceInventory.value, "source_inventory");
  if (historicalP0AnchorSchema.snapshot.byteSha256 !== ACCEPTED.historicalP0AnchorSchemaBytes || contract.value.requiredDownstreamMigration?.historicalV2P0AnchorSchemaByteSha256 !== ACCEPTED.historicalP0AnchorSchemaBytes || contract.value.requiredDownstreamMigration?.historicalV2P0AnchorSchemaModified !== false) throw new Error("historical_p0_anchor_schema_pin_drift");
  const bindings = contract.value.teacherBindings;
  for (const [key, hashKey] of [["teacherInputInventory", "teacherInventory"], ["teacherPolicy", "teacherPolicy"], ["teacherSchema", "teacherSchema"], ["p0AnchorSchema", "p0AnchorSchema"], ["p1AnchorSchema", "p1AnchorSchema"]]) {
    if (bindings[key].canonicalSha256 !== hashes[hashKey] || bindings[key].path !== PATHS[key === "teacherInputInventory" ? "teacherInventory" : key]) throw new Error(`teacher_binding_drift:${key}`);
  }
  if (contract.value.labelSchema.canonicalSha256 !== hashes.labelSchema || contract.value.labelSchema.path !== PATHS.labelSchema) throw new Error("label_schema_binding_drift");
  if (contract.value.realP0GenerationBlockedUntil !== "manual-pack-compiler@r3 accepted" || contract.value.requiredDownstreamMigration?.historicalCompilerR2Compatible !== false) throw new Error("compiler_r3_migration_gate_drift");
  validateDef(teacherSchema.value, "teacherInputInventory", teacherInventory.value, "teacherInputInventory");

  const decoderSnapshot = snapshotFile(fixtureSnapshotPath(testHooks, "corePathOverrides", PATHS.decoderManifest), "decoder_manifest");
  const decoder = parseJsonlSnapshot(decoderSnapshot, "decoder_manifest");
  if (decoder.rows.length !== 6711 || decoderSnapshot.byteSha256 !== ACCEPTED.decoderBytes || canonicalHash(decoder.rows) !== ACCEPTED.decoderRows) throw new Error("decoder_identity_drift");
  const decoderByClip = new Map();
  const decoderByKey = new Map();
  for (const [index, row] of decoder.rows.entries()) {
    validateDef(labelSchema.value, "decoderRow", row, `decoder/${index}`);
    const key = identityKey(decoderIdentity(row));
    if (decoderByKey.has(key)) throw new Error(`decoder_duplicate:${key}`);
    decoderByKey.set(key, row);
    if (!decoderByClip.has(row.clipId)) decoderByClip.set(row.clipId, []);
    decoderByClip.get(row.clipId).push(row);
  }
  if (decoderByClip.has("jujae-full")) throw new Error("unpaired_leakage:decoder");
  return {
    contract: contract.value, labelSchema: labelSchema.value, teacherInventory: teacherInventory.value,
    teacherPolicy: teacherPolicy.value, teacherSchema: teacherSchema.value, p0AnchorSchema: p0AnchorSchema.value,
    p1AnchorSchema: p1AnchorSchema.value, sourceInventory: sourceInventory.value, hashes,
    decoderRows: decoder.rows, decoderByClip, decoderByKey, decoderSnapshot,
  };
}

export function usableBbox(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) && value[2] > value[0] && value[3] > value[1];
}
function sameDetectorTuple(left, right) {
  return Object.is(left.detector_score, right.detector_score) && usableBbox(left.detector_bbox_xyxy) && usableBbox(right.detector_bbox_xyxy)
    && left.detector_bbox_xyxy.every((value, index) => Object.is(value, right.detector_bbox_xyxy[index]));
}
export function deriveDetectorProvenance(raw, previousRaw = null) {
  if (raw.persons.length === 0) return { state: "miss_no_prediction", source: "zero_raw_persons_summary_reconciled" };
  if (raw.persons.some((person) => !usableBbox(person.detector_bbox_xyxy))) return { state: "provenance_unavailable", source: "missing_or_invalid_native_detector_bbox" };
  if (previousRaw && previousRaw.persons.length > 0 && previousRaw.persons.length === raw.persons.length && raw.persons.every((person, index) => sameDetectorTuple(person, previousRaw.persons[index]))) {
    return { state: "carry_forward_fallback", source: "derived_exact_detector_tuple_repeat_summary_reconciled" };
  }
  return { state: "detector_hit", source: "derived_nonrepeat_valid_native_detector_bbox" };
}
function descriptorMatches(snapshot, descriptor, label, json = false, selfHashed = false) {
  if (snapshot.buffer.length !== descriptor.bytes && descriptor.bytes !== undefined) throw new Error(`descriptor_size_drift:${label}`);
  if (snapshot.byteSha256 !== descriptor.byteSha256) throw new Error(`descriptor_byte_drift:${label}`);
  if (json) {
    const value = parseJsonBuffer(snapshot.buffer, label);
    const actual = canonicalHash(value, selfHashed);
    if (actual !== descriptor.canonicalSha256) throw new Error(`descriptor_canonical_drift:${label}`);
    return value;
  }
  return null;
}

function validateRawFrame(raw, clip, lineIndex, teacherSchema) {
  validateDef(teacherSchema, "rawFrame", raw, `raw/${clip.clipId}/${lineIndex}`);
  if (raw.frame_index !== lineIndex) throw new Error(`raw_frame_index_drift:${clip.clipId}:${lineIndex}:${raw.frame_index}`);
  if (raw.person_count !== raw.persons.length) throw new Error(`raw_person_count_drift:${clip.clipId}:${lineIndex}`);
  if (raw.image_size.width !== clip.video.width || raw.image_size.height !== clip.video.height) throw new Error(`raw_image_size_drift:${clip.clipId}:${lineIndex}`);
}

export function auditTeacherInputs(context = loadCore(), testHooks = null) {
  const acceptedClipIds = context.contract.clipInventory.map((clip) => clip.clipId);
  if (!stableEqual(context.teacherInventory.clips.map((clip) => clip.clipId), acceptedClipIds)) throw new Error("teacher_inventory_clip_order_drift");
  const rowsByClip = new Map();
  const provenanceByClip = new Map();
  let totalRows = 0;
  for (const clip of context.teacherInventory.clips) {
    const source = context.sourceInventory.paired.find((candidate) => candidate.clipId === clip.clipId);
    if (!source || source.video.sha256 !== clip.video.sha256 || source.video.bytes !== clip.video.bytes || source.decoderRowCount !== clip.decoderRows) throw new Error(`teacher_source_binding_drift:${clip.clipId}`);
    const rawOverride = fixtureOverrideEntry(testHooks, "teacherPathOverrides", clip.files.skeletonsMhr70.path);
    const rawSnapshot = snapshotFile(rawOverride?.path || repoPath(clip.files.skeletonsMhr70.path), `raw_teacher:${clip.clipId}`);
    const parsed = parseRawCrLfJsonlSnapshot(rawSnapshot, `raw_teacher:${clip.clipId}`);
    descriptorMatches(rawSnapshot, clip.files.skeletonsMhr70, `raw_teacher:${clip.clipId}`);
    if (parsed.rows.length !== clip.decoderRows || parsed.lines.length !== clip.files.skeletonsMhr70.rowCount) throw new Error(`raw_row_count_drift:${clip.clipId}`);
    const metadataSnapshot = snapshotFile(fixtureSnapshotPath(testHooks, "teacherPathOverrides", clip.files.metadataMhr70.path), `metadata:${clip.clipId}`);
    const metadata = descriptorMatches(metadataSnapshot, clip.files.metadataMhr70, `metadata:${clip.clipId}`, true);
    const summarySnapshot = snapshotFile(fixtureSnapshotPath(testHooks, "teacherPathOverrides", clip.files.summary.path), `summary:${clip.clipId}`);
    const summary = descriptorMatches(summarySnapshot, clip.files.summary, `summary:${clip.clipId}`, true);
    const expectedNames = context.teacherPolicy.metadata.keypointNames.map(({ name }) => name);
    if (metadata.format !== "mhr70" || metadata.keypoint_count !== 70 || !stableEqual(metadata.keypoint_names, expectedNames) || new Set(metadata.keypoint_names).size !== 70) throw new Error(`metadata_semantics_drift:${clip.clipId}`);
    const decoderRows = context.decoderByClip.get(clip.clipId) || [];
    if (decoderRows.length !== parsed.rows.length) throw new Error(`raw_decoder_count_drift:${clip.clipId}`);
    const provenance = [];
    let persons = 0;
    for (const [index, raw] of parsed.rows.entries()) {
      validateRawFrame(raw, clip, index, context.teacherSchema);
      if (decoderRows[index].sourceFrameIndex !== index) throw new Error(`raw_decoder_index_drift:${clip.clipId}:${index}`);
      persons += raw.persons.length;
      provenance.push(deriveDetectorProvenance(raw, index > 0 ? parsed.rows[index - 1] : null));
    }
    const counts = Object.fromEntries(["detector_hit", "carry_forward_fallback", "miss_no_prediction", "provenance_unavailable"].map((state) => [state, provenance.filter((entry) => entry.state === state).length]));
    const expectedCounts = context.teacherPolicy.expectedRawReconciliation[clip.clipId];
    if (!stableEqual(counts, expectedCounts)) throw new Error(`detector_provenance_reconciliation_drift:${clip.clipId}:${stableStringify(counts)}`);
    const nonHit = parsed.rows.length - counts.detector_hit;
    if (summary.processed_frames !== parsed.rows.length || summary.every_n_frames !== 1 || summary.total_person_predictions !== persons || summary.detection_misses !== nonHit) throw new Error(`summary_reconciliation_drift:${clip.clipId}`);
    rowsByClip.set(clip.clipId, { rows: parsed.rows, lines: parsed.lines, snapshot: rawSnapshot, metadata, summary });
    provenanceByClip.set(clip.clipId, provenance);
    totalRows += parsed.rows.length;
  }
  if (totalRows !== 6711) throw new Error(`teacher_raw_total_drift:${totalRows}`);
  return { rowsByClip, provenanceByClip, totalRows };
}

function expandedBbox(bbox, fraction) {
  const width = bbox[2] - bbox[0]; const height = bbox[3] - bbox[1];
  return [bbox[0] - fraction * width, bbox[1] - fraction * height, bbox[2] + fraction * width, bbox[3] + fraction * height];
}
function bboxForSelection(person, fraction) {
  if (usableBbox(person.detector_bbox_xyxy)) return { source: "detector", bbox: expandedBbox(person.detector_bbox_xyxy, fraction), warning: null };
  if (usableBbox(person.bbox_xyxy)) return { source: "fallback", bbox: expandedBbox(person.bbox_xyxy, fraction), warning: "detector_bbox_invalid_fallback" };
  return null;
}
function contains(bbox, x, y) { return x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3]; }

export function deriveSelection(raw, manualSubject, policy) {
  const empty = {
    manualSubjectState: manualSubject.state, manualTargetId: manualSubject.manualTargetId,
    rawPersonIndex: null, rawPersonId: null, selectedTrackId: null,
    effectiveBboxSource: null, effectiveBboxXyxy: null, selectionFailureReason: null, selectionWarningCodes: [],
  };
  if (manualSubject.state !== "selected") return empty;
  const persons = raw.persons;
  if (persons.length === 0) return { ...empty, selectionFailureReason: "teacher_record_missing" };
  const finish = (index, effective = null) => ({
    ...empty, rawPersonIndex: index, rawPersonId: persons[index].person_id, selectedTrackId: manualSubject.manualTargetId,
    effectiveBboxSource: effective?.source ?? null, effectiveBboxXyxy: effective?.bbox ?? null,
    selectionWarningCodes: effective?.warning ? [effective.warning] : [],
  });
  if (persons.length === 1 && manualSubject.anchor === null) return finish(0);
  if (persons.length > 1 && manualSubject.anchor === null) return { ...empty, selectionFailureReason: "teacher_candidate_ambiguous" };
  const candidates = persons.map((person) => bboxForSelection(person, policy.thresholds.bbox_padding_fraction));
  if (candidates.some((candidate) => candidate === null)) return { ...empty, selectionFailureReason: "candidate_bbox_unusable" };
  const pixelX = manualSubject.anchor.x * raw.image_size.width;
  const pixelY = manualSubject.anchor.y * raw.image_size.height;
  const matches = candidates.map((candidate, index) => ({ candidate, index })).filter(({ candidate }) => contains(candidate.bbox, pixelX, pixelY));
  if (persons.length === 1) return matches.length === 1 ? finish(0, candidates[0]) : { ...empty, selectionFailureReason: "teacher_candidate_anchor_mismatch" };
  return matches.length === 1 ? finish(matches[0].index, matches[0].candidate) : { ...empty, selectionFailureReason: "teacher_candidate_ambiguous" };
}

export function validDescriptorPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.includes("//")) return false;
  const parts = value.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..") && path.posix.normalize(value) === value;
}
export function descriptorSetHash(descriptors) {
  const sorted = descriptors.map(({ path: descriptorPath, byteSha256 }) => ({ path: descriptorPath, byteSha256 }))
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) throw new Error("descriptor_duplicate_path");
  return canonicalHash(sorted);
}
function isRepoDescriptor(descriptorPath) { return descriptorPath.startsWith("tests/") || descriptorPath.startsWith("scripts/") || descriptorPath.startsWith("sam-3d-body-skeletons/"); }
function resolvedDescriptorPath(descriptorPath, labelDir) {
  if (!validDescriptorPath(descriptorPath)) throw new Error(`descriptor_path_invalid:${descriptorPath}`);
  return isRepoDescriptor(descriptorPath) ? repoPath(descriptorPath) : path.resolve(labelDir, descriptorPath);
}
function verifyDescriptor(descriptor, expectedPath, labelDir, canonical = false, testHooks = null) {
  if (descriptor.path !== expectedPath || !validDescriptorPath(descriptor.path)) throw new Error(`descriptor_path_drift:${expectedPath}:${descriptor.path}`);
  const filePath = fixtureOverrideEntry(testHooks, "descriptorPathOverrides", expectedPath)?.path || resolvedDescriptorPath(descriptor.path, labelDir);
  const snapshot = snapshotFile(filePath, `descriptor:${expectedPath}`);
  if (snapshot.byteSha256 !== descriptor.byteSha256) throw new Error(`descriptor_byte_drift:${expectedPath}`);
  let value = null;
  if (canonical) {
    value = parseJsonBuffer(snapshot.buffer, `descriptor:${expectedPath}`);
    if (canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash")) !== descriptor.canonicalSha256) throw new Error(`descriptor_canonical_drift:${expectedPath}`);
  }
  return { snapshot, value, descriptor };
}
function verifyDescriptorAt(descriptor, expectedPath, filePath, canonical = false) {
  if (descriptor.path !== expectedPath || !validDescriptorPath(descriptor.path)) throw new Error(`descriptor_path_drift:${expectedPath}:${descriptor.path}`);
  const snapshot = snapshotFile(filePath, `descriptor:${expectedPath}`);
  if (snapshot.byteSha256 !== descriptor.byteSha256) throw new Error(`descriptor_byte_drift:${expectedPath}`);
  let value = null;
  if (canonical) {
    value = parseJsonBuffer(snapshot.buffer, `descriptor:${expectedPath}`);
    if (canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash")) !== descriptor.canonicalSha256) throw new Error(`descriptor_canonical_drift:${expectedPath}`);
  }
  return { snapshot, value, descriptor };
}

function scanForbiddenDurable(value, contract, at = "artifact") {
  const forbidden = contract.forbiddenDurableFamilies.map((entry) => String(entry).toLowerCase().replace(/[^a-z0-9]/g, ""));
  const visit = (child, cursor) => {
    if (Array.isArray(child)) { child.forEach((entry, index) => visit(entry, `${cursor}/${index}`)); return; }
    if (child && typeof child === "object") {
      for (const [key, nested] of Object.entries(child)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (forbidden.some((token) => normalized.includes(token))) throw new Error(`forbidden_durable_key:${cursor}/${key}`);
        visit(nested, `${cursor}/${key}`);
      }
      return;
    }
    if (typeof child === "string") {
      const normalized = child.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbidden.some((token) => normalized.includes(token))) throw new Error(`forbidden_durable_value:${cursor}`);
    }
  };
  visit(value, at);
}

const P0_DESCRIPTOR_POLICY = Object.freeze({
  evaluationContract: [PATHS.contract, true], labelSchema: [PATHS.labelSchema, true],
  authoringSchema: [`${V3_ROOT}/authoring-schema.json`, true], teacherInputInventory: [PATHS.teacherInventory, true],
  teacherPolicy: [PATHS.teacherPolicy, true], teacherSchema: [PATHS.teacherSchema, true],
  p0AnchorSchema: [PATHS.p0AnchorSchema, true], p1AnchorSchema: [PATHS.p1AnchorSchema, true],
  sourceInventory: [PATHS.sourceInventory, true], decoderManifest: [PATHS.decoderManifest, false],
  manualWindows: ["manual-windows.json", true], manualLabels: ["manual-labels.jsonl", false],
  manualSubjectSelection: ["manual-subject-selection.jsonl", false], manualReviewPassA: ["manual-review-pass1.jsonl", false],
  manualReviewPassB: ["manual-review-pass2.jsonl", false], manualAdjudication: ["manual-adjudication.jsonl", false],
  manualPolicy: ["manual-policy.json", true], manualSummary: ["manual-summary.json", true],
  manualCompiler: ["scripts/sam-goal-manual-pack-v3.mjs", false], labelAuditor: ["scripts/sam-goal-label-audit-v3.mjs", false],
});
export function assertClosedDescriptorPolicy(files, policy, label) {
  if (!files || !stableEqual(Object.keys(files).sort(), Object.keys(policy).sort())) throw new Error(`${label}_descriptor_set_drift`);
  for (const [key, [expectedPath]] of Object.entries(policy)) if (files[key]?.path !== expectedPath || !validDescriptorPath(files[key]?.path)) throw new Error(`descriptor_path_drift:${label}:${key}:${files[key]?.path}`);
}

function canonicalSortedStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) throw new Error(`scenario_array_invalid:${label}`);
  const sorted = [...values].sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (!stableEqual(values, sorted)) throw new Error(`scenario_array_not_canonical:${label}`);
}
function frameKeyFromSpan(span, label) {
  if (span?.kind !== "frame") throw new Error(`compiled_span_not_frame:${label}`);
  return identityKey(span.identity);
}
function manualState(label, subject) {
  return {
    presence: label.presence, personState: label.personState, occlusion: label.occlusion, contact: label.contact,
    handObservability: label.handObservability, endpointObservability: label.endpointObservability,
    subjectSelection: { state: subject.state, manualTargetId: subject.manualTargetId, anchor: subject.anchor },
  };
}
function validateManualTruth(label, subject, key) {
  const observable = new Set(["observable", "partial"]);
  if (label.presence === "absent") {
    if (label.personState !== "absent" || subject.state !== "absent" || label.contact.left !== "unknown" || label.contact.right !== "unknown") throw new Error(`manual_absent_truth:${key}`);
    if ([...Object.values(label.handObservability), ...Object.values(label.endpointObservability)].some((value) => value !== "not_observable")) throw new Error(`manual_absent_observable:${key}`);
    if (Object.values(label.occlusion).some((value) => !["out_of_frame", "unknown"].includes(value))) throw new Error(`manual_absent_target_pixels:${key}`);
  }
  if (label.presence === "present" && label.personState === "single_target" && subject.state !== "selected") throw new Error(`manual_single_target_unselected:${key}`);
  if (label.personState === "multiple_people" && !(subject.state === "ambiguous" || (subject.state === "selected" && subject.anchor !== null))) throw new Error(`manual_multiple_people_subject:${key}`);
  if (subject.state === "selected" && (typeof subject.manualTargetId !== "string" || !subject.manualTargetId)) throw new Error(`manual_target_id_missing:${key}`);
  if (subject.state !== "selected" && (subject.manualTargetId !== null || subject.anchor !== null)) throw new Error(`manual_unselected_payload:${key}`);
  for (const foot of ["left", "right"]) if (label.contact[foot] !== "unknown" && !(label.presence === "present" && label.occlusion[`${foot}Foot`] === "observable" && label.endpointObservability[`${foot}Ankle`] === "observable")) throw new Error(`manual_contact_unobservable:${key}:${foot}`);
  for (const hand of ["left", "right"]) if (label.handObservability[hand] === "observable" && !(observable.has(label.occlusion[`${hand}Hand`]) && label.endpointObservability[`${hand}Wrist`] === "observable")) throw new Error(`manual_hand_truth:${key}:${hand}`);
}
function differencePaths(left, right, prefix = "") {
  if (stableEqual(left, right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return [prefix];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => differencePaths(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
function mapExactRows(rows, keyOf, decoderRows, label) {
  const map = new Map();
  for (const [index, row] of rows.entries()) {
    const key = keyOf(row, index);
    if (map.has(key)) throw new Error(`${label}_duplicate:${key}`);
    map.set(key, row);
  }
  if (map.size !== decoderRows.length) throw new Error(`${label}_count:${map.size}:${decoderRows.length}`);
  for (const decoder of decoderRows) if (!map.has(identityKey(decoderIdentity(decoder)))) throw new Error(`${label}_hole:${identityKey(decoderIdentity(decoder))}`);
  return map;
}
function valueAt(value, dotted) { return dotted.split(".").reduce((current, key) => current?.[key], value); }
function cohenKappa(left, right) {
  if (left.length !== right.length || left.length === 0) throw new Error("kappa_input_invalid");
  const categories = [...new Set([...left, ...right])]; const leftCounts = new Map(); const rightCounts = new Map(); let agreements = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) agreements += 1;
    leftCounts.set(left[index], (leftCounts.get(left[index]) || 0) + 1); rightCounts.set(right[index], (rightCounts.get(right[index]) || 0) + 1);
  }
  const observed = agreements / left.length;
  const expected = categories.reduce((sum, category) => sum + ((leftCounts.get(category) || 0) / left.length) * ((rightCounts.get(category) || 0) / right.length), 0);
  return expected === 1 ? (observed === 1 ? 1 : 0) : (observed - expected) / (1 - expected);
}
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function computeAgreement(passA, passB, context) {
  const presence = []; const contact = []; const observability = [];
  for (const decoderRows of context.decoderByClip.values()) {
    const first = decoderRows.map((row) => passA.get(identityKey(decoderIdentity(row))).state);
    const second = decoderRows.map((row) => passB.get(identityKey(decoderIdentity(row))).state);
    presence.push(cohenKappa(first.map((state) => `${state.presence}|${state.personState}`), second.map((state) => `${state.presence}|${state.personState}`)));
    for (const foot of ["left", "right"]) contact.push(cohenKappa(first.map((state) => state.contact[foot]), second.map((state) => state.contact[foot])));
    for (const field of OBSERVABILITY_FIELDS) observability.push(cohenKappa(first.map((state) => valueAt(state, field)), second.map((state) => valueAt(state, field))));
  }
  return { presencePersonStateKappa: average(presence), contactKappa: average(contact), observabilityKappa: average(observability) };
}
function enforceStableManualTarget(reviewMap, context, label) {
  for (const [clipId, rows] of context.decoderByClip) {
    const targets = new Set(rows.map((row) => reviewMap.get(identityKey(decoderIdentity(row))).state.subjectSelection).filter((selection) => selection.state === "selected").map((selection) => selection.manualTargetId));
    if (targets.size > 1) throw new Error(`review_subject_target_unstable:${label}:${clipId}`);
  }
}
function enforceReacquireCoverage(labels, subjects, context) {
  const events = [];
  for (const clip of context.contract.clipInventory.filter((entry) => entry.role === "hard_test")) {
    const rows = context.decoderByClip.get(clip.clipId); let index = 0;
    while (index < rows.length) {
      const stateAt = (position) => { const key = identityKey(decoderIdentity(rows[position])); return { label: labels.get(key), subject: subjects.get(key) }; };
      const bad = ({ label, subject }) => (label.presence === "absent" && subject.state === "absent") || label.presence === "unknown" || ["ambiguous", "unknown"].includes(subject.state) || ["occluded", "out_of_frame", "unknown"].includes(label.occlusion.body);
      const reliable = ({ label, subject }) => label.presence === "present" && subject.state === "selected" && ["observable", "partial"].includes(label.occlusion.body);
      if (!bad(stateAt(index))) { index += 1; continue; }
      const start = index; while (index < rows.length && bad(stateAt(index))) index += 1;
      if (index >= rows.length) break;
      let reliableIndex = index; while (reliableIndex < rows.length && !reliable(stateAt(reliableIndex))) reliableIndex += 1;
      if (reliableIndex >= rows.length) break;
      const delta = BigInt(rows[index].ptsTicks) - BigInt(rows[start].ptsTicks);
      if (delta * BigInt(rows[start].timeBase.numerator) * 1000n >= BigInt(context.contract.reacquirePolicy.minimumUnreliableIntervalMs) * BigInt(rows[start].timeBase.denominator)) events.push({ clipId: clip.clipId, start, reliableIndex });
    }
  }
  if (events.length < context.contract.reacquirePolicy.minimumP0CandidateEvents || new Set(events.map((event) => event.clipId)).size < context.contract.reacquirePolicy.minimumHardTestClips) throw new Error(`reacquire_coverage:${events.length}:${new Set(events.map((event) => event.clipId)).size}`);
  return events;
}

function parseManualPack(loaded, context) {
  const parseRows = (name, def, allowEmpty = false) => {
    const parsed = parseJsonlSnapshot(loaded[name].snapshot, name, allowEmpty);
    for (const [index, row] of parsed.rows.entries()) validateDef(context.labelSchema, def, row, `${name}/${index}`);
    return parsed.rows;
  };
  const manualLabels = parseRows("manualLabels", "manualLabel");
  const subjectRows = parseRows("manualSubjectSelection", "subjectSelection");
  const reviewA = parseRows("manualReviewPassA", "reviewRow");
  const reviewB = parseRows("manualReviewPassB", "reviewRow");
  const adjudications = parseRows("manualAdjudication", "adjudicationRow", true);
  const labels = mapExactRows(manualLabels, (row, index) => frameKeyFromSpan(row.span, `manual/${index}`), context.decoderRows, "manual_labels");
  const subjects = mapExactRows(subjectRows, (row, index) => frameKeyFromSpan(row.span, `subject/${index}`), context.decoderRows, "manual_subjects");
  const passA = mapExactRows(reviewA, (row) => identityKey(row.identity), context.decoderRows, "review_a");
  const passB = mapExactRows(reviewB, (row) => identityKey(row.identity), context.decoderRows, "review_b");
  const adjudicationMap = new Map();
  for (const row of adjudications) {
    const key = identityKey(row.identity);
    if (adjudicationMap.has(key)) throw new Error(`adjudication_duplicate:${key}`);
    adjudicationMap.set(key, row);
  }
  const reviewerA = new Set(reviewA.map((row) => row.reviewerHash));
  const reviewerB = new Set(reviewB.map((row) => row.reviewerHash));
  if (reviewerA.size !== 1 || reviewerB.size !== 1 || [...reviewerA][0] === [...reviewerB][0]) throw new Error("reviewer_identity_not_independent");
  enforceStableManualTarget(passA, context, "first"); enforceStableManualTarget(passB, context, "second");
  const scenarioTaxonomy = new Set(context.contract.scenarioTaxonomy);
  let disagreementCount = 0;
  for (const decoder of context.decoderRows) {
    const key = identityKey(decoderIdentity(decoder));
    const label = labels.get(key); const subject = subjects.get(key); const first = passA.get(key); const second = passB.get(key);
    canonicalSortedStrings(label.scenarios, `manual:${key}`); canonicalSortedStrings(first.scenarios, `reviewA:${key}`); canonicalSortedStrings(second.scenarios, `reviewB:${key}`);
    if ([...label.scenarios, ...first.scenarios, ...second.scenarios].some((tag) => !scenarioTaxonomy.has(tag))) throw new Error(`scenario_open:${key}`);
    if (first.pass !== "first" || second.pass !== "second" || !first.reviewed || !second.reviewed || first.origin !== "manual" || second.origin !== "manual") throw new Error(`review_provenance:${key}`);
    validateManualTruth(label, subject, key);
    const firstCombined = { scenarios: first.scenarios, state: first.state };
    const secondCombined = { scenarios: second.scenarios, state: second.state };
    const finalCombined = { scenarios: label.scenarios, state: manualState(label, subject) };
    const differences = differencePaths(firstCombined, secondCombined);
    const adjudication = adjudicationMap.get(key);
    if (differences.length) {
      disagreementCount += 1;
      if (!adjudication || !adjudication.adjudicated || adjudication.origin !== "manual") throw new Error(`adjudication_missing:${key}`);
      canonicalSortedStrings(adjudication.scenarios, `adjudication:${key}`);
      if (adjudication.scenarios.some((tag) => !scenarioTaxonomy.has(tag))) throw new Error(`scenario_open:adjudication:${key}`);
      if (!stableEqual(adjudication.disagreementFields, differences) || !stableEqual({ scenarios: adjudication.scenarios, state: adjudication.decision }, finalCombined)) throw new Error(`adjudication_decision_drift:${key}`);
    } else {
      if (adjudication) throw new Error(`adjudication_without_disagreement:${key}`);
      if (!stableEqual(firstCombined, finalCombined)) throw new Error(`unadjudicated_final_drift:${key}`);
    }
  }
  if (adjudicationMap.size !== disagreementCount) throw new Error("adjudication_extra_rows");
  const policy = loaded.manualPolicy.value; const summary = loaded.manualSummary.value;
  validateDef(context.labelSchema, "manualPolicy", policy, "manualPolicy"); validateDef(context.labelSchema, "manualSummary", summary, "manualSummary");
  verifySelfHash(policy, "manualPolicy"); verifySelfHash(summary, "manualSummary");
  if (policy.contractCanonicalSha256 !== context.hashes.contract || policy.schemaCanonicalSha256 !== context.hashes.labelSchema) throw new Error("manual_policy_v3_binding");
  const reviewerHashes = { first: [...reviewerA][0], second: [...reviewerB][0] };
  const adjudicators = new Set(adjudications.map((row) => row.adjudicatorHash));
  if (adjudicators.size > 1 || (adjudicators.size === 1 && [reviewerHashes.first, reviewerHashes.second].includes([...adjudicators][0]))) throw new Error("adjudicator_identity_not_independent");
  if (policy.reviewerHashes.first !== reviewerHashes.first || policy.reviewerHashes.second !== reviewerHashes.second || (adjudicators.size && policy.reviewerHashes.adjudicator !== [...adjudicators][0]) || new Set(Object.values(policy.reviewerHashes)).size !== 3) throw new Error("manual_policy_reviewer_binding");
  const expectedThresholds = { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95, preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2 };
  if (!stableEqual(policy.thresholds, expectedThresholds)) throw new Error("manual_policy_thresholds_drift");
  const agreement = computeAgreement(passA, passB, context);
  for (const [name, floor] of Object.entries(context.contract.manualReview.agreement.minimum)) if (agreement[name] + 1e-12 < floor) throw new Error(`agreement_below_floor:${name}:${agreement[name]}:${floor}`);
  if (summary.decoderRows !== 6711 || summary.materializedManualRows !== 6711 || summary.materializedSubjectRows !== 6711 || summary.reviewPass1Rows !== 6711 || summary.reviewPass2Rows !== 6711) throw new Error("manual_summary_denominator");
  const expectedPerClip = context.contract.sourceBinding.paired.map((clip) => ({ clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows }));
  if (!stableEqual(summary.perClip, expectedPerClip)) throw new Error("manual_summary_per_clip_drift");
  const reacquireEvents = enforceReacquireCoverage(labels, subjects, context);
  return { labels, subjects, passA, passB, adjudicationMap, disagreementCount, agreement, policy, summary, reacquireEvents };
}

function bodyObservable(label) { return label.presence === "present" && ["observable", "partial"].includes(label.occlusion.body); }
function armObservable(label, side) { return bodyObservable(label) && label.endpointObservability[`${side}Wrist`] === "observable"; }
function handObservable(label, side) { return armObservable(label, side) && ["observable", "partial"].includes(label.occlusion[`${side}Hand`]) && label.handObservability[side] === "observable"; }
function headObservable(label) { return bodyObservable(label) && label.endpointObservability.head === "observable"; }
function strictFootObservable(label, side) { return bodyObservable(label) && label.occlusion[`${side}Foot`] === "observable" && label.endpointObservability[`${side}Ankle`] === "observable"; }
function enforceManualSupport(manual, context) {
  const cells = Object.fromEntries(["leftHand", "rightHand", "head", "leftPlanted", "leftMoving", "rightPlanted", "rightMoving"].map((key) => [key, { frames: 0, clips: new Set() }]));
  for (const decoder of context.decoderRows) {
    const key = identityKey(decoderIdentity(decoder)); const label = manual.labels.get(key);
    for (const side of ["left", "right"]) {
      if (handObservable(label, side)) { cells[`${side}Hand`].frames += 1; cells[`${side}Hand`].clips.add(decoder.clipId); }
      const contact = label.contact[side];
      if (strictFootObservable(label, side) && ["planted", "moving"].includes(contact)) { const cell = cells[`${side}${contact[0].toUpperCase()}${contact.slice(1)}`]; cell.frames += 1; cell.clips.add(decoder.clipId); }
    }
    if (headObservable(label)) { cells.head.frames += 1; cells.head.clips.add(decoder.clipId); }
  }
  for (const key of ["leftHand", "rightHand", "head"]) if (cells[key].frames < 300 || cells[key].clips.size < 2) throw new Error(`pre_mask_support:${key}:${cells[key].frames}:${cells[key].clips.size}`);
  for (const key of ["leftPlanted", "leftMoving", "rightPlanted", "rightMoving"]) if (cells[key].frames < 300 || cells[key].clips.size < 2) throw new Error(`pre_mask_contact_support:${key}:${cells[key].frames}:${cells[key].clips.size}`);
  return cells;
}

export function auditP0Candidate(labelDirInput, context = loadCore(), teacherInputs = auditTeacherInputs(context), testHooks = null) {
  const labelDir = path.resolve(labelDirInput);
  if (!existsSync(labelDir) || !statSync(labelDir).isDirectory()) throw new Error(`label_dir_invalid:${labelDir}`);
  const manifestSnapshot = snapshotFile(path.join(labelDir, "evaluation-pack.json"), "evaluation_pack_p0");
  const manifest = parseJsonBuffer(manifestSnapshot.buffer, "evaluation_pack_p0");
  validateDef(context.labelSchema, "p0PackManifest", manifest, "evaluationPackP0");
  const manifestHash = verifySelfHash(manifest, "evaluationPackP0");
  const descriptorPolicy = testHooks?.p0DescriptorPolicy || P0_DESCRIPTOR_POLICY;
  const keys = Object.keys(descriptorPolicy);
  assertClosedDescriptorPolicy(manifest.files, descriptorPolicy, "p0");
  const loaded = {};
  for (const key of keys) {
    const [expectedPath, canonical] = descriptorPolicy[key];
    loaded[key] = verifyDescriptor(manifest.files[key], expectedPath, labelDir, canonical, testHooks);
  }
  if (loaded.teacherInputInventory.descriptor.canonicalSha256 !== context.hashes.teacherInventory) throw new Error("teacher_inventory_pinned_hash_drift");
  if (loaded.teacherPolicy.descriptor.canonicalSha256 !== context.hashes.teacherPolicy) throw new Error("teacher_policy_pinned_hash_drift");
  if (loaded.evaluationContract.descriptor.canonicalSha256 !== context.hashes.contract || loaded.labelSchema.descriptor.canonicalSha256 !== context.hashes.labelSchema
    || loaded.teacherSchema.descriptor.canonicalSha256 !== context.hashes.teacherSchema || loaded.p0AnchorSchema.descriptor.canonicalSha256 !== context.hashes.p0AnchorSchema
    || loaded.p1AnchorSchema.descriptor.canonicalSha256 !== context.hashes.p1AnchorSchema || loaded.sourceInventory.descriptor.canonicalSha256 !== context.hashes.sourceInventory
    || loaded.decoderManifest.descriptor.byteSha256 !== ACCEPTED.decoderBytes) throw new Error("p0_static_dependency_drift");
  if (loaded.manualCompiler.descriptor.path.includes("manual-pack-v2") || loaded.authoringSchema.descriptor.path.includes("evaluation-v2")) throw new Error("compiler_r2_pin_incompatible");
  const manual = parseManualPack(loaded, context);
  scanForbiddenDurable(manifest, context.contract, "p0Manifest");
  for (const [name, item] of Object.entries(loaded)) if (["manualWindows", "manualPolicy", "manualSummary"].includes(name)) scanForbiddenDurable(item.value, context.contract, name);
  const manualSupport = enforceManualSupport(manual, context);
  return { labelDir, labelDirReal: realpathSync(labelDir), manifest, manifestHash, manifestSnapshot, loaded, manual, manualSupport, teacherInputs };
}

function orderedWarnings(codes, policy) {
  const set = new Set(codes);
  return policy.warnings.codes.filter((code) => set.has(code));
}
export function expectedDatasetRow(decoder, raw, rawLine, rawLineIndex, provenance, subject, policy) {
  const selection = deriveSelection(raw, subject, policy);
  const exactPtsNumber = (Number(decoder.ptsTicks) * decoder.timeBase.numerator) / decoder.timeBase.denominator;
  const rawTimestampNumber = raw.timestamp_sec;
  const differs = rawTimestampNumber !== exactPtsNumber;
  const warningCodes = ["native_joint_confidence_unavailable", "detector_provenance_derived_not_native"];
  if (selection.selectionWarningCodes.includes("detector_bbox_invalid_fallback")) warningCodes.push("detector_bbox_invalid_fallback");
  if (differs) warningCodes.push("raw_timestamp_differs_from_exact_pts");
  return {
    artifactType: "teacher-dataset-row-v2", schemaVersion: 2, identity: decoderIdentity(decoder), rawLineIndex,
    rawLineBase64: rawLine.toString("base64"), rawLineByteSha256: sha256(rawLine), decodedRawCanonicalSha256: canonicalHash(raw),
    rawTimestampComparison: { rawTimestampNumber, exactPtsNumber, deltaSec: rawTimestampNumber - exactPtsNumber, differs },
    detectorProvenance: provenance, derivedSelection: selection, warningCodes: orderedWarnings(warningCodes, policy),
  };
}

export function auditDataset(snapshot, p0, context) {
  const parsed = parseJsonlSnapshot(snapshot, "teacher_dataset_v2");
  if (parsed.rows.length !== 6711) throw new Error(`teacher_dataset_count:${parsed.rows.length}`);
  const rows = []; const reconstructedByClip = new Map(context.teacherInventory.clips.map((clip) => [clip.clipId, []]));
  for (const [globalIndex, decoder] of context.decoderRows.entries()) {
    const actual = parsed.rows[globalIndex];
    validateDef(context.teacherSchema, "datasetRow", actual, `teacherDataset/${globalIndex}`);
    const canonicalLine = Buffer.from(stableStringify(actual), "utf8");
    if (!canonicalLine.equals(parsed.lines[globalIndex])) throw new Error(`teacher_dataset_serialization:${globalIndex}`);
    if (!stableEqual(actual.identity, decoderIdentity(decoder))) throw new Error(`teacher_dataset_identity:${globalIndex}`);
    const clipInput = p0.teacherInputs.rowsByClip.get(decoder.clipId);
    const lineIndex = decoder.sourceFrameIndex;
    const rawLine = clipInput.lines[lineIndex]; const raw = clipInput.rows[lineIndex];
    if (!rawLine || !raw) throw new Error(`teacher_dataset_raw_hole:${decoder.clipId}:${lineIndex}`);
    let decoded; let decodedBuffer;
    try {
      decodedBuffer = Buffer.from(actual.rawLineBase64, "base64");
      if (decodedBuffer.toString("base64") !== actual.rawLineBase64 || !decodedBuffer.equals(rawLine) || decodedBuffer.includes(0x0d) || decodedBuffer.includes(0x0a)) throw new Error("base64_or_line_bytes");
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodedBuffer));
    } catch (error) { throw new Error(`teacher_dataset_raw_reconstruction:${globalIndex}:${error.message}`); }
    if (!stableEqual(decoded, raw)) throw new Error(`teacher_dataset_decoded_drift:${globalIndex}`);
    const provenance = p0.teacherInputs.provenanceByClip.get(decoder.clipId)[lineIndex];
    const subject = p0.manual.subjects.get(identityKey(decoderIdentity(decoder)));
    const expected = expectedDatasetRow(decoder, raw, rawLine, lineIndex, provenance, subject, context.teacherPolicy);
    assertDatasetRowClaim(actual, expected, context, globalIndex);
    reconstructedByClip.get(decoder.clipId).push(decodedBuffer, Buffer.from([0x0d, 0x0a]));
    rows.push({ decoder, raw, provenance, subject, selection: expected.derivedSelection, row: actual });
  }
  for (const clip of context.teacherInventory.clips) {
    const reconstructed = Buffer.concat(reconstructedByClip.get(clip.clipId));
    if (!reconstructed.equals(p0.teacherInputs.rowsByClip.get(clip.clipId).snapshot.buffer) || sha256(reconstructed) !== clip.files.skeletonsMhr70.byteSha256) throw new Error(`teacher_dataset_source_reconstruction_drift:${clip.clipId}`);
  }
  return { rows, snapshot, byteSha256: snapshot.byteSha256 };
}
export function assertDatasetRowClaim(actual, expected, context, index = 0) {
  validateDef(context.teacherSchema, "datasetRow", actual, `teacherDataset/${index}`);
  if (!stableEqual(actual, expected)) throw new Error(`teacher_dataset_derivation_drift:${index}`);
}
export function assertExactArtifactRows(rows, expected, label) { if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`${label}_count:${rows?.length}:${expected}`); }
export function assertPinnedSelfHashedArtifact(value, expectedHash, label) {
  const actual = verifySelfHash(value, label); if (actual !== expectedHash) throw new Error(`${label}_pinned_hash_drift:${actual}`); return actual;
}

function finiteNested(value) {
  if (Array.isArray(value)) return value.every(finiteNested);
  return typeof value === "number" && Number.isFinite(value);
}
function vectorDistance(left, right) { return Math.hypot(...left.map((value, index) => value - right[index])); }
function segmentLength(points, segment) { const [left, right] = segment.split("-").map(Number); return vectorDistance(points[left], points[right]); }
function median(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function torsoBasisFacts(points, policy) {
  const sub = (a, b) => a.map((value, index) => value - b[index]);
  const add = (a, b) => a.map((value, index) => value + b[index]);
  const scale = (a, factor) => a.map((value) => value * factor);
  const norm = (a) => Math.hypot(...a);
  const normalize = (a) => { const length = norm(a); return length ? scale(a, 1 / length) : null; };
  const shoulder = sub(points[6], points[5]); const hip = sub(points[10], points[9]);
  const vertical = sub(scale(add(points[5], points[6]), 0.5), scale(add(points[9], points[10]), 0.5));
  if (![shoulder, hip, vertical].every(finiteNested)) return { cross: null, valid: false };
  const precursorNorms = [shoulder, hip, vertical].map(norm);
  if (precursorNorms.some((value) => value === 0)) return { cross: null, valid: false };
  const shoulderN = normalize(shoulder); const hipN = normalize(hip); const lateralSum = add(shoulderN, hipN);
  const lateralNorm = norm(lateralSum);
  if (!Number.isFinite(lateralNorm) || lateralNorm === 0) return { cross: null, valid: false };
  const lateral = normalize(lateralSum); const verticalN = normalize(vertical);
  const cross = norm([lateral[1] * verticalN[2] - lateral[2] * verticalN[1], lateral[2] * verticalN[0] - lateral[0] * verticalN[2], lateral[0] * verticalN[1] - lateral[1] * verticalN[0]]);
  const t = policy.thresholds;
  return { cross: Number.isFinite(cross) ? cross : null, valid: Number.isFinite(cross) && precursorNorms.every((value) => value >= t.min_segment_m) && lateralNorm >= t.min_dimensionless_normalization_norm && cross >= t.min_normalized_torso_cross };
}
function rawPose(person) {
  return { predCamT: person.pred_cam_t, keypointsMhr70RootRelativeM: person.keypoints_mhr70_3d, mhrJointCoords127RootRelativeM: person.mhr_joint_coords_127_3d };
}
function poseHash(pose) { return canonicalHash(pose); }
function smoothNested(values, numerators, denominator) {
  if (Array.isArray(values[0])) return values[0].map((_, index) => smoothNested(values.map((value) => value[index]), numerators, denominator));
  let accumulator = 0;
  for (let index = 0; index < numerators.length; index += 1) accumulator += numerators[index] * values[index];
  return accumulator / denominator;
}
function equalRationalDelta(left, right) { return left.ticks * right.denominator === right.ticks * left.denominator; }
function adjacentDelta(left, right) {
  if (left.timeBase.numerator !== right.timeBase.numerator || left.timeBase.denominator !== right.timeBase.denominator) return null;
  const ticks = BigInt(right.ptsTicks) - BigInt(left.ptsTicks);
  return { ticks, numerator: BigInt(left.timeBase.numerator), denominator: BigInt(left.timeBase.denominator) };
}
export function contactStableConfirmed(firstIdentity, lastIdentity, confirmationMs = 100) {
  if (firstIdentity.clipId !== lastIdentity.clipId || firstIdentity.timeBase.numerator !== lastIdentity.timeBase.numerator || firstIdentity.timeBase.denominator !== lastIdentity.timeBase.denominator || lastIdentity.sourceFrameIndex < firstIdentity.sourceFrameIndex) return false;
  const deltaTicks = BigInt(lastIdentity.ptsTicks) - BigInt(firstIdentity.ptsTicks);
  return deltaTicks >= 0n && deltaTicks * BigInt(firstIdentity.timeBase.numerator) * 1000n >= BigInt(confirmationMs) * BigInt(firstIdentity.timeBase.denominator);
}
function projectionDelta(candidate, centerPerson, imageSize) {
  const result = [];
  for (let index = 0; index < 70; index += 1) {
    const point = candidate.keypointsMhr70RootRelativeM[index]; const camera = candidate.predCamT;
    const depth = point[2] + camera[2];
    if (!Number.isFinite(depth) || depth <= 0) return Infinity;
    const u = ((point[0] + camera[0]) * centerPerson.focal_length) / depth + imageSize.width / 2;
    const v = ((point[1] + camera[1]) * centerPerson.focal_length) / depth + imageSize.height / 2;
    result.push(Math.hypot(u - centerPerson.keypoints_mhr70_2d[index][0], v - centerPerson.keypoints_mhr70_2d[index][1]));
  }
  return Math.max(...result);
}
function refinementSafety(candidate, raw, imageSize, policy) {
  const t = policy.thresholds;
  const center = rawPose(raw);
  if (!finiteNested(candidate.predCamT) || !finiteNested(candidate.keypointsMhr70RootRelativeM) || !finiteNested(candidate.mhrJointCoords127RootRelativeM)) return false;
  if (vectorDistance(candidate.predCamT, center.predCamT) > t.refinement_max_camera_displacement_m) return false;
  for (const key of ["keypointsMhr70RootRelativeM", "mhrJointCoords127RootRelativeM"]) for (let index = 0; index < candidate[key].length; index += 1) if (vectorDistance(candidate[key][index], center[key][index]) > t.refinement_max_joint_displacement_m) return false;
  const segments = policy.majorSegments.map((segment) => segmentLength(candidate.keypointsMhr70RootRelativeM, segment));
  if (segments.some((value) => !Number.isFinite(value) || value < t.min_segment_m || value > t.max_segment_m)) return false;
  const torso = torsoBasisFacts(candidate.keypointsMhr70RootRelativeM, policy);
  if (!torso.valid) return false;
  return projectionDelta(candidate, raw, imageSize) <= t.refinement_max_reprojection_delta_px;
}

function buildClipRowIndex(datasetRows) {
  const byClip = new Map(); const localByGlobal = new Map();
  for (let index = 0; index < datasetRows.length; index += 1) {
    const clipId = datasetRows[index].decoder.clipId;
    if (!byClip.has(clipId)) byClip.set(clipId, []);
    const rows = byClip.get(clipId); localByGlobal.set(index, rows.length); rows.push(datasetRows[index]);
  }
  return { byClip, localByGlobal };
}
const CLIP_ROW_INDEX_CACHE = new WeakMap();
function cachedClipRowIndex(datasetRows) {
  let index = CLIP_ROW_INDEX_CACHE.get(datasetRows);
  if (!index) { index = buildClipRowIndex(datasetRows); CLIP_ROW_INDEX_CACHE.set(datasetRows, index); }
  return index;
}
export function deriveRefinedRow(index, datasetRows, policy, clipIndex = null) {
  const center = datasetRows[index]; const identity = decoderIdentity(center.decoder);
  const base = {
    artifactType: "teacher-refined-row-v2", schemaVersion: 2, identity,
    selectedRawPersonIndex: center.selection.rawPersonIndex, selectedTrackId: center.selection.selectedTrackId,
    targetRole: "watch", refinementStatus: "unavailable", policyCanonicalSha256: policy.expectedCanonicalHash,
    sourceWindow: null, predCamT: null, keypointsMhr70RootRelativeM: null, mhrJointCoords127RootRelativeM: null,
    rawCenterCanonicalSha256: null, refinedPoseCanonicalSha256: null,
  };
  const selected = center.selection.rawPersonIndex === null ? null : center.raw.persons[center.selection.rawPersonIndex];
  if (!selected) return base;
  if (!finiteNested(selected.pred_cam_t) || !finiteNested(selected.keypoints_mhr70_3d) || !finiteNested(selected.mhr_joint_coords_127_3d)) throw new Error(`refined_selected_center_nonfinite:${index}`);
  const raw = rawPose(selected); const rawHash = poseHash(raw);
  if (center.provenance.state !== "detector_hit") return { ...base, rawCenterCanonicalSha256: rawHash };
  const finish = (status, pose, window = null) => ({ ...base, refinementStatus: status, sourceWindow: window, ...pose, rawCenterCanonicalSha256: rawHash, refinedPoseCanonicalSha256: poseHash(pose) });
  const indexData = clipIndex || cachedClipRowIndex(datasetRows); const clipRows = indexData.byClip.get(center.decoder.clipId) || [];
  const localIndex = indexData.localByGlobal.get(index);
  if (localIndex < 2 || localIndex > clipRows.length - 3) return finish("identity_boundary", raw);
  const windowRows = clipRows.slice(localIndex - 2, localIndex + 3); const sourceWindow = windowRows.map((entry) => decoderIdentity(entry.decoder));
  if (windowRows.some((entry, offset) => entry.provenance.state !== "detector_hit" || entry.selection.rawPersonIndex === null || entry.selection.selectedTrackId !== center.selection.selectedTrackId || entry.decoder.sourceFrameIndex !== center.decoder.sourceFrameIndex + offset - 2)) return finish("identity_selection_gap", raw, sourceWindow);
  const persons = windowRows.map((entry) => entry.raw.persons[entry.selection.rawPersonIndex]);
  if (persons.some((person) => !finiteNested(person.pred_cam_t) || !finiteNested(person.keypoints_mhr70_3d) || !finiteNested(person.mhr_joint_coords_127_3d))) return finish("identity_input_invalid", raw, sourceWindow);
  const deltas = windowRows.slice(1).map((entry, offset) => adjacentDelta(windowRows[offset].decoder, entry.decoder));
  const uniform = deltas.every((delta) => delta && delta.ticks > 0n && equalRationalDelta(deltas[0], delta));
  const withinGap = deltas.every((delta) => delta && delta.ticks * delta.numerator * 1000n <= BigInt(policy.thresholds.max_selected_gap_ms) * delta.denominator);
  if (!uniform || !withinGap) return finish("identity_nonuniform_pts", raw, sourceWindow);
  const numerators = policy.thresholds.refinement_savgol_numerator; const denominator = policy.thresholds.refinement_savgol_denominator;
  const candidate = {
    predCamT: smoothNested(persons.map((person) => person.pred_cam_t), numerators, denominator),
    keypointsMhr70RootRelativeM: smoothNested(persons.map((person) => person.keypoints_mhr70_3d), numerators, denominator),
    mhrJointCoords127RootRelativeM: smoothNested(persons.map((person) => person.mhr_joint_coords_127_3d), numerators, denominator),
  };
  if (!refinementSafety(candidate, selected, center.raw.image_size, policy)) return finish("identity_safety_fallback", raw, sourceWindow);
  return finish("smoothed", candidate, sourceWindow);
}

export function auditRefined(snapshot, dataset, context) {
  const parsed = parseJsonlSnapshot(snapshot, "teacher_refined");
  if (parsed.rows.length !== 6711) throw new Error(`teacher_refined_count:${parsed.rows.length}`);
  const clipIndex = buildClipRowIndex(dataset.rows);
  for (let index = 0; index < parsed.rows.length; index += 1) {
    const actual = parsed.rows[index]; validateDef(context.teacherSchema, "refinedRow", actual, `teacherRefined/${index}`);
    if (!Buffer.from(stableStringify(actual), "utf8").equals(parsed.lines[index])) throw new Error(`teacher_refined_serialization:${index}`);
    const expected = deriveRefinedRow(index, dataset.rows, context.teacherPolicy, clipIndex);
    assertRefinedRowClaim(actual, expected, context, index);
  }
  return { rows: parsed.rows, snapshot, byteSha256: snapshot.byteSha256 };
}
export function assertRefinedRowClaim(actual, expected, context, index = 0) {
  validateDef(context.teacherSchema, "refinedRow", actual, `teacherRefined/${index}`);
  if (!stableEqual(actual, expected)) throw new Error(`teacher_refined_derivation_drift:${index}`);
}

function uniqueIndices(...groups) { return [...new Set(groups.flat())]; }
function scopeIndices(policy) {
  const sets = policy.scopeJointSets;
  const torso = sets.torso;
  return {
    torsoFacing: torso,
    fullBody: sets.full_body,
    head: uniqueIndices(torso, sets.head),
    leftArm: uniqueIndices(torso, sets.left_arm), rightArm: uniqueIndices(torso, sets.right_arm),
    leftHand: uniqueIndices(torso, sets.left_arm, sets.left_hand), rightHand: uniqueIndices(torso, sets.right_arm, sets.right_hand),
    leftLeg: uniqueIndices(torso, sets.left_leg), rightLeg: uniqueIndices(torso, sets.right_leg),
  };
}
function projectionFacts(person, raw, indices, policy) {
  if (!person) return { maxError: null, depthRange: null, coordinatesFinite: false, cameraValid: false, reprojectionValid: false, inFrame: false };
  const t = policy.thresholds; const focal = person.focal_length; const camera = person.pred_cam_t;
  let coordinatesFinite = Number.isFinite(focal) && finiteNested(camera); let cameraValid = Number.isFinite(focal) && focal > t.focal_open_min_px && focal <= t.focal_max_px && finiteNested(camera);
  let inFrame = true; const errors = []; const depths = [];
  for (const index of indices) {
    const point2 = person.keypoints_mhr70_2d[index]; const point3 = person.keypoints_mhr70_3d[index];
    if (!finiteNested(point2) || !finiteNested(point3)) { coordinatesFinite = false; cameraValid = false; inFrame = false; continue; }
    const depth = point3[2] + camera[2]; depths.push(depth);
    if (!Number.isFinite(depth) || depth <= t.camera_depth_open_min_m || depth > t.camera_depth_max_m) cameraValid = false;
    const u = ((point3[0] + camera[0]) * focal) / depth + raw.image_size.width / 2;
    const v = ((point3[1] + camera[1]) * focal) / depth + raw.image_size.height / 2;
    errors.push(Math.hypot(u - point2[0], v - point2[1]));
    if (point2[0] < -t.in_frame_tolerance_px || point2[0] > raw.image_size.width + t.in_frame_tolerance_px || point2[1] < -t.in_frame_tolerance_px || point2[1] > raw.image_size.height + t.in_frame_tolerance_px) inFrame = false;
  }
  const maxError = errors.length === indices.length && errors.every(Number.isFinite) ? Math.max(...errors) : null;
  const depthRange = depths.length === indices.length && depths.every(Number.isFinite) ? { min: Math.min(...depths), max: Math.max(...depths) } : null;
  return { maxError, depthRange, coordinatesFinite, cameraValid, reprojectionValid: maxError !== null && maxError <= t.max_reprojection_error_px, inFrame };
}
function orderedReasons(reasons, policy) { const set = new Set(reasons); return policy.reasons.precedence.filter((reason) => set.has(reason)); }
function metricSegments(person, policy) { return person ? policy.majorSegments.map((segment) => { const value = segmentLength(person.keypoints_mhr70_3d, segment); return Number.isFinite(value) ? value : null; }) : Array(10).fill(null); }
function segmentsValid(segments, indices, policy) {
  const t = policy.thresholds; return indices.every((index) => Number.isFinite(segments[index]) && segments[index] >= t.min_segment_m && segments[index] <= t.max_segment_m);
}
const SEGMENTS_BY_SCOPE = Object.freeze({ leftArm: [0, 1], leftHand: [0, 1], rightArm: [2, 3], rightHand: [2, 3], leftLeg: [4, 5], rightLeg: [6, 7], fullBody: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] });
function legObservable(label, side) { return bodyObservable(label) && ["observable", "partial"].includes(label.occlusion[`${side}Foot`]) && label.endpointObservability[`${side}Ankle`] === "observable"; }
function vectorSpeed(current, previous, seconds) { return vectorDistance(current, previous) / seconds; }
function maxJointSpeed(current, previous, indices, seconds) { return Math.max(...indices.map((index) => vectorSpeed(current[index], previous[index], seconds))); }
function timeFacts(current, predecessor, policy, indicesByScope, frameScale) {
  const emptySpeeds = Object.fromEntries(MOVEMENT_SCOPES.map((scope) => [scope, null]));
  if (!predecessor) return { exactTemporalDelta: null, gap: false, seconds: null, cameraRootSpeedMps: null, scaleJump: null, maxSpeeds: emptySpeeds, referenceUnavailable: new Set() };
  const delta = adjacentDelta(predecessor.decoder, current.decoder);
  if (!delta || delta.ticks <= 0n) return { exactTemporalDelta: null, gap: false, seconds: null, cameraRootSpeedMps: null, scaleJump: null, maxSpeeds: emptySpeeds, referenceUnavailable: new Set(MOVEMENT_SCOPES) };
  const exactTemporalDelta = { deltaTicks: String(delta.ticks), timeBase: current.decoder.timeBase };
  const gap = current.decoder.sourceFrameIndex !== predecessor.decoder.sourceFrameIndex + 1 || delta.ticks * delta.numerator * 1000n > BigInt(policy.thresholds.max_selected_gap_ms) * delta.denominator;
  if (gap) return { exactTemporalDelta, gap, seconds: null, cameraRootSpeedMps: null, scaleJump: null, maxSpeeds: emptySpeeds, referenceUnavailable: new Set() };
  const seconds = (Number(delta.ticks) * Number(delta.numerator)) / Number(delta.denominator);
  const currentPerson = current.selection.rawPersonIndex === null ? null : current.raw.persons[current.selection.rawPersonIndex];
  const previousPerson = predecessor.selection.rawPersonIndex === null ? null : predecessor.raw.persons[predecessor.selection.rawPersonIndex];
  const referenceUnavailable = new Set();
  let cameraRootSpeedMps = null;
  if (!currentPerson || !previousPerson || !finiteNested(currentPerson.pred_cam_t) || !finiteNested(previousPerson.pred_cam_t) || !Number.isFinite(seconds) || seconds <= 0) MOVEMENT_SCOPES.forEach((scope) => referenceUnavailable.add(scope));
  else cameraRootSpeedMps = vectorSpeed(currentPerson.pred_cam_t, previousPerson.pred_cam_t, seconds);
  const maxSpeeds = { ...emptySpeeds };
  for (const scope of MOVEMENT_SCOPES) {
    const required = indicesByScope[scope];
    if (!currentPerson || !previousPerson || !required.every((joint) => finiteNested(currentPerson.keypoints_mhr70_3d[joint]) && finiteNested(previousPerson.keypoints_mhr70_3d[joint])) || !Number.isFinite(seconds) || seconds <= 0) { referenceUnavailable.add(scope); continue; }
    maxSpeeds[scope] = maxJointSpeed(currentPerson.keypoints_mhr70_3d, previousPerson.keypoints_mhr70_3d, indicesByScope[scope], seconds);
  }
  const previousSegments = metricSegments(previousPerson, policy); const previousFrameScale = median(previousSegments.slice(0, 8));
  let scaleJump = null;
  if (frameScale === null || previousFrameScale === null || previousFrameScale === 0) referenceUnavailable.add("fullBody");
  else scaleJump = Math.abs(frameScale / previousFrameScale - 1);
  return { exactTemporalDelta, gap, seconds, cameraRootSpeedMps, scaleJump, maxSpeeds, referenceUnavailable };
}

export function expectedMaskRow(entry, label, clipScale, predecessor, context) {
  const policy = context.teacherPolicy; const t = policy.thresholds; const indices = scopeIndices(policy);
  const person = entry.selection.rawPersonIndex === null ? null : entry.raw.persons[entry.selection.rawPersonIndex];
  const projections = Object.fromEntries(MOVEMENT_SCOPES.map((scope) => [scope, projectionFacts(person, entry.raw, indices[scope], policy)]));
  const segments = metricSegments(person, policy); const frameScale = segments.slice(0, 8).every(Number.isFinite) ? median(segments.slice(0, 8)) : null;
  const time = timeFacts(entry, predecessor, policy, indices, frameScale);
  const shared = [];
  if (label.presence === "absent") shared.push("manual_absent");
  if (label.presence === "unknown") shared.push("manual_presence_unknown");
  if (entry.subject.state !== "selected") shared.push("manual_subject_unselected");
  if (entry.provenance.state === "miss_no_prediction") shared.push("detector_miss_no_prediction");
  if (entry.provenance.state === "carry_forward_fallback") shared.push("detector_carry_forward_fallback");
  if (entry.provenance.state === "provenance_unavailable") shared.push("detector_provenance_unavailable");
  if (entry.selection.selectionFailureReason) shared.push(entry.selection.selectionFailureReason);
  const rawReasons = {};
  const coordinateReasons = (scope) => {
    if (!person) return [];
    const facts = projections[scope]; const reasons = [];
    if (!facts.coordinatesFinite) reasons.push("required_coordinates_nonfinite");
    if (!facts.cameraValid) reasons.push("camera_parameters_invalid");
    if (facts.maxError !== null && !facts.reprojectionValid) reasons.push("reprojection_error");
    if (!facts.inFrame) reasons.push("required_joint_out_of_frame");
    return reasons;
  };
  const temporalReasons = (scope, includeScale = false) => {
    if (!predecessor) return [];
    if (time.gap) return ["temporal_gap"];
    const reasons = [];
    if (time.referenceUnavailable.has(scope) || (includeScale && time.referenceUnavailable.has("fullBody"))) reasons.push("temporal_reference_unavailable");
    else {
      if (time.cameraRootSpeedMps > t.max_camera_root_speed_mps) reasons.push("root_speed_anomaly");
      if (time.maxSpeeds[scope] > t.max_root_relative_joint_speed_mps) reasons.push("joint_speed_anomaly");
      if (includeScale && time.scaleJump > t.max_adjacent_scale_jump) reasons.push("scale_jump");
    }
    return reasons;
  };
  const torsoBasis = person ? torsoBasisFacts(person.keypoints_mhr70_3d, policy) : { cross: null, valid: false };
  const torsoBasisValue = torsoBasis.cross;
  rawReasons.torsoFacing = [...shared, ...coordinateReasons("torsoFacing")];
  if (!bodyObservable(label)) rawReasons.torsoFacing.push("manual_body_unobservable");
  if (person && !torsoBasis.valid) rawReasons.torsoFacing.push("invalid_torso_basis");
  rawReasons.torsoFacing.push(...temporalReasons("torsoFacing"));
  const inherited = (scope) => [...rawReasons.torsoFacing, ...coordinateReasons(scope), ...temporalReasons(scope)];
  rawReasons.head = inherited("head"); if (!headObservable(label)) rawReasons.head.push("manual_head_unobservable");
  for (const side of ["left", "right"]) {
    const arm = `${side}Arm`; const hand = `${side}Hand`; const leg = `${side}Leg`;
    rawReasons[arm] = inherited(arm); if (!armObservable(label, side)) rawReasons[arm].push("manual_arm_unobservable");
    if (person && !segmentsValid(segments, SEGMENTS_BY_SCOPE[arm], policy)) rawReasons[arm].push("bone_length_anomaly");
    rawReasons[hand] = [...rawReasons[arm], ...coordinateReasons(hand), ...temporalReasons(hand)];
    if (!handObservable(label, side)) rawReasons[hand].push("manual_hand_unobservable");
    rawReasons[leg] = inherited(leg); if (!legObservable(label, side)) rawReasons[leg].push("manual_leg_unobservable");
    if (person && !segmentsValid(segments, SEGMENTS_BY_SCOPE[leg], policy)) rawReasons[leg].push("bone_length_anomaly");
  }
  rawReasons.fullBody = [...rawReasons.torsoFacing, ...coordinateReasons("fullBody"), ...temporalReasons("fullBody", true)];
  if (!strictFootObservable(label, "left") || !strictFootObservable(label, "right")) rawReasons.fullBody.push("incomplete_full_body_observability");
  if (person && !segmentsValid(segments, SEGMENTS_BY_SCOPE.fullBody, policy)) rawReasons.fullBody.push("bone_length_anomaly");
  if (person && clipScale === null) rawReasons.fullBody.push("scale_median_unavailable");
  if (person && frameScale !== null && clipScale !== null && Math.abs(frameScale / clipScale - 1) > t.max_clip_median_scale_deviation) rawReasons.fullBody.push("scale_deviation");
  rawReasons.calibration = [...rawReasons.fullBody, "native_joint_confidence_unavailable"];
  for (const side of ["left", "right"]) {
    const contact = `${side}Contact`; rawReasons[contact] = [...rawReasons.fullBody];
    const legIndices = policy.scopeJointSets[`${side}_leg`];
    if (!person || !legIndices.every((index) => finiteNested(person.keypoints_mhr70_3d[index]))) rawReasons[contact].push("leg_chain_nonfinite");
    if (!strictFootObservable(label, side)) rawReasons[contact].push("manual_foot_unobservable");
    if (!["planted", "moving"].includes(label.contact[side])) rawReasons[contact].push("manual_contact_unknown");
  }
  const scopeReasons = Object.fromEntries(SCOPES.map((scope) => [scope, orderedReasons(rawReasons[scope], policy)]));
  const scope = Object.fromEntries(SCOPES.map((name) => [name, scopeReasons[name].length === 0]));
  const valid = Object.values(scope).some(Boolean);
  const exclusionReasons = valid ? [] : orderedReasons(SCOPES.filter((name) => name !== "calibration").flatMap((name) => scopeReasons[name]), policy);
  if (!valid && exclusionReasons.length === 0) throw new Error(`mask_empty_global_reason:${identityKey(decoderIdentity(entry.decoder))}`);
  return {
    artifactType: "teacher-mask-row-v2", schemaVersion: 2, identity: decoderIdentity(entry.decoder),
    selectedRawPersonIndex: entry.selection.rawPersonIndex, selectedTrackId: entry.selection.selectedTrackId,
    detectorProvenance: entry.provenance, jointConfidenceSource: "unavailable", confidenceAvailable: false,
    diagnostics: {
      perScopeMaxReprojectionErrorPx: Object.fromEntries(MOVEMENT_SCOPES.map((name) => [name, projections[name].maxError])),
      perScopeCameraDepthRangeM: Object.fromEntries(MOVEMENT_SCOPES.map((name) => [name, projections[name].depthRange])),
      torsoCross: torsoBasisValue, tenMajorSegmentLengthsM: segments, frameScaleM: frameScale, clipScaleM: clipScale,
      exactTemporalDelta: time.exactTemporalDelta, scaleJump: time.scaleJump, cameraRootSpeedMps: time.cameraRootSpeedMps,
      maxRootRelativeJointSpeedMps: time.maxSpeeds,
    },
    scope, scopeReasons, valid, exclusionReasons, warningCodes: entry.row.warningCodes,
  };
}

export function clipScales(dataset, context) {
  const result = new Map(); const t = context.teacherPolicy.thresholds;
  for (const clipId of context.teacherInventory.clips.map((clip) => clip.clipId)) {
    const scales = [];
    for (const entry of dataset.rows.filter((row) => row.decoder.clipId === clipId)) {
      if (entry.provenance.state !== "detector_hit" || entry.subject.state !== "selected" || entry.selection.rawPersonIndex === null) continue;
      const segments = metricSegments(entry.raw.persons[entry.selection.rawPersonIndex], context.teacherPolicy);
      if (segments.slice(0, 8).every((value) => Number.isFinite(value) && value >= t.min_segment_m && value <= t.max_segment_m)) scales.push(median(segments.slice(0, 8)));
    }
    result.set(clipId, median(scales));
  }
  return result;
}

export function auditMask(snapshot, dataset, p0, context) {
  const parsed = parseJsonlSnapshot(snapshot, "teacher_mask_v2");
  if (parsed.rows.length !== 6711) throw new Error(`teacher_mask_count:${parsed.rows.length}`);
  const scales = clipScales(dataset, context); const previousByClipTarget = new Map(); const rows = [];
  for (let index = 0; index < dataset.rows.length; index += 1) {
    const entry = dataset.rows[index]; const targetKey = `${entry.decoder.clipId}\u0000${entry.selection.selectedTrackId ?? ""}`;
    const predecessor = entry.selection.selectedTrackId === null ? null : previousByClipTarget.get(targetKey) || null;
    const label = p0.manual.labels.get(identityKey(decoderIdentity(entry.decoder)));
    const expected = expectedMaskRow(entry, label, scales.get(entry.decoder.clipId), predecessor, context);
    const actual = parsed.rows[index]; validateDef(context.teacherSchema, "maskRow", actual, `teacherMask/${index}`);
    if (!Buffer.from(stableStringify(actual), "utf8").equals(parsed.lines[index])) throw new Error(`teacher_mask_serialization:${index}`);
    assertMaskRowClaim(actual, expected, context, index);
    rows.push(actual);
    if (entry.provenance.state === "detector_hit" && entry.selection.rawPersonIndex !== null) previousByClipTarget.set(targetKey, entry);
  }
  return { rows, scales, snapshot, byteSha256: snapshot.byteSha256 };
}
export function assertMaskRowClaim(actual, expected, context, index = 0) {
  validateDef(context.teacherSchema, "maskRow", actual, `teacherMask/${index}`);
  if (!stableEqual(actual, expected)) throw new Error(`teacher_mask_derivation_drift:${index}`);
}

function provenanceRecords(p0) {
  const summaries = [...p0.teacherInputs.rowsByClip.entries()].map(([clipId, entry]) => ({ clipId, summary: entry.summary }));
  const first = summaries[0]?.summary;
  if (!first) throw new Error("teacher_summary_source_missing");
  for (const { summary } of summaries) {
    if (summary.checkpoint_path !== first.checkpoint_path || summary.mhr_path !== first.mhr_path || summary.detector?.model !== first.detector?.model) throw new Error("teacher_provenance_model_claim_drift_across_clips");
  }
  return [
    { component: "extractor_code", availability: "unavailable", sha256: null, reason: "artifact_bytes_not_present_in_workspace", claimedPathOrModel: null, claimedConfig: { perClip: summaries.map(({ clipId, summary }) => ({ clipId, every_n_frames: summary.every_n_frames, person_batch_size: summary.person_batch_size })) } },
    { component: "sam_checkpoint", availability: "unavailable", sha256: null, reason: "artifact_bytes_not_present_in_workspace", claimedPathOrModel: first.checkpoint_path ?? null, claimedConfig: null },
    { component: "mhr_asset", availability: "unavailable", sha256: null, reason: "artifact_bytes_not_present_in_workspace", claimedPathOrModel: first.mhr_path ?? null, claimedConfig: null },
    { component: "detector_weights", availability: "unavailable", sha256: null, reason: "artifact_bytes_not_present_in_workspace", claimedPathOrModel: first.detector?.model ?? null, claimedConfig: { perClip: summaries.map(({ clipId, summary }) => { const config = { ...summary.detector }; delete config.model; return { clipId, ...config }; }) } },
  ];
}
export function expectedSourceManifest(parentP0AnchorSha256, p0, context) {
  const value = {
    artifactType: "teacher-source-manifest-v2", schemaVersion: 2, parentP0AnchorSha256,
    teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory, sourceInventoryCanonicalSha256: context.hashes.sourceInventory,
    decoderManifest: { path: PATHS.decoderManifest, byteSha256: ACCEPTED.decoderBytes, canonicalRowsSha256: ACCEPTED.decoderRows, rowCount: 6711 },
    clips: context.teacherInventory.clips, provenance: provenanceRecords(p0),
    serialization: { json: "compact-recursively-key-sorted-utf8-terminal-lf", jsonl: "one-compact-recursively-key-sorted-object-per-decoder-row", lineEnding: "LF", terminalNewline: true, rowOrder: "decoder-manifest" },
  };
  value.expectedCanonicalHash = canonicalHash(value);
  return value;
}
export function auditSourceManifest(snapshot, parentP0AnchorSha256, p0, context) {
  const actual = parseJsonBuffer(snapshot.buffer, "teacher_source_manifest");
  validateDef(context.teacherSchema, "teacherSourceManifest", actual, "teacherSourceManifest"); verifySelfHash(actual, "teacherSourceManifest");
  const expected = expectedSourceManifest(parentP0AnchorSha256, p0, context);
  if (!stableEqual(actual, expected)) throw new Error("teacher_source_manifest_derivation_drift");
  if (!snapshot.buffer.equals(Buffer.from(`${stableStringify(actual)}\n`, "utf8"))) throw new Error("teacher_source_manifest_serialization");
  return { value: actual, hash: actual.expectedCanonicalHash, snapshot };
}
function countMap(keys) { return Object.fromEntries(keys.map((key) => [key, 0])); }
function clipCountSummary(clipId, role, entries, refinedRows, maskRows, context) {
  const provenance = countMap(["detector_hit", "carry_forward_fallback", "miss_no_prediction", "provenance_unavailable"]);
  const refinementStatuses = countMap(REFINEMENT_STATUSES);
  const selection = countMap(["selected", "unattempted", "teacher_record_missing", "teacher_candidate_ambiguous", "teacher_candidate_anchor_mismatch", "candidate_bbox_unusable", "detectorBboxInvalidFallback"]);
  const reasons = countMap(context.teacherPolicy.reasons.precedence);
  const scopes = Object.fromEntries(SCOPES.map((scope) => [scope, { true: 0, false: 0 }]));
  let personPredictions = 0; let zeroPersonRows = 0; let multiPersonRows = 0; let selectedRows = 0; let validRows = 0;
  for (let local = 0; local < entries.length; local += 1) {
    const entry = entries[local]; const refined = refinedRows[local]; const mask = maskRows[local];
    personPredictions += entry.raw.persons.length; if (entry.raw.persons.length === 0) zeroPersonRows += 1; if (entry.raw.persons.length > 1) multiPersonRows += 1;
    provenance[entry.provenance.state] += 1; refinementStatuses[refined.refinementStatus] += 1;
    if (entry.selection.rawPersonIndex !== null) { selectedRows += 1; selection.selected += 1; } else if (entry.selection.selectionFailureReason) selection[entry.selection.selectionFailureReason] += 1; else selection.unattempted += 1;
    if (entry.selection.selectionWarningCodes.includes("detector_bbox_invalid_fallback")) selection.detectorBboxInvalidFallback += 1;
    const rowReasonSet = new Set(Object.values(mask.scopeReasons).flat()); for (const reason of rowReasonSet) reasons[reason] += 1;
    for (const scope of SCOPES) scopes[scope][String(mask.scope[scope])] += 1;
    if (mask.valid) validRows += 1;
  }
  return { clipId, role, decoderRows: entries.length, rawRows: entries.length, personPredictions, zeroPersonRows, multiPersonRows, selectedRows, detectorProvenance: provenance, refinementStatuses, selection, reasons, scopes, validRows, invalidRows: entries.length - validRows };
}
function sumClipCounts(perClip, context) {
  const total = clipCountSummary("__all_paired__", "all_paired", [], [], [], context);
  total.decoderRows = 0; total.rawRows = 0;
  for (const clip of perClip) {
    for (const key of ["decoderRows", "rawRows", "personPredictions", "zeroPersonRows", "multiPersonRows", "selectedRows", "validRows", "invalidRows"]) total[key] += clip[key];
    for (const key of Object.keys(total.detectorProvenance)) total.detectorProvenance[key] += clip.detectorProvenance[key];
    for (const key of Object.keys(total.refinementStatuses)) total.refinementStatuses[key] += clip.refinementStatuses[key];
    for (const key of Object.keys(total.selection)) total.selection[key] += clip.selection[key];
    for (const key of Object.keys(total.reasons)) total.reasons[key] += clip.reasons[key];
    for (const scope of SCOPES) { total.scopes[scope].true += clip.scopes[scope].true; total.scopes[scope].false += clip.scopes[scope].false; }
  }
  return total;
}
function supportCell(dataset, maskRows, p0, predicatePre, predicatePost) {
  let preMaskFrames = 0; let postMaskFrames = 0; const preMaskClips = new Set(); const postMaskClips = new Set();
  for (let index = 0; index < dataset.rows.length; index += 1) {
    const entry = dataset.rows[index]; const label = p0.manual.labels.get(identityKey(decoderIdentity(entry.decoder)));
    if (predicatePre(label, entry)) { preMaskFrames += 1; preMaskClips.add(entry.decoder.clipId); }
    if (predicatePost(label, entry, maskRows[index])) { postMaskFrames += 1; postMaskClips.add(entry.decoder.clipId); }
  }
  return { preMaskFrames, postMaskFrames, preMaskClips: preMaskClips.size, postMaskClips: postMaskClips.size };
}
function expectedSupport(dataset, mask, p0) {
  const support = {
    leftHand: supportCell(dataset, mask.rows, p0, (label) => handObservable(label, "left"), (_label, _entry, row) => row.scope.leftHand),
    rightHand: supportCell(dataset, mask.rows, p0, (label) => handObservable(label, "right"), (_label, _entry, row) => row.scope.rightHand),
    head: supportCell(dataset, mask.rows, p0, headObservable, (_label, _entry, row) => row.scope.head),
  };
  for (const side of ["left", "right"]) for (const state of ["planted", "moving"]) {
    const key = `${side}${state[0].toUpperCase()}${state.slice(1)}`;
    support[key] = supportCell(dataset, mask.rows, p0, (label) => strictFootObservable(label, side) && label.contact[side] === state, (label, _entry, row) => row.scope[`${side}Contact`] && label.contact[side] === state);
  }
  for (const key of ["leftHand", "rightHand", "head"]) {
    const cell = support[key]; if (cell.preMaskFrames < 300 || cell.postMaskFrames < 100 || cell.preMaskClips < 2 || cell.postMaskClips < 2) throw new Error(`teacher_support_floor:${key}`);
  }
  for (const key of ["leftPlanted", "leftMoving", "rightPlanted", "rightMoving"]) {
    const cell = support[key]; if (cell.preMaskFrames < 300 || cell.postMaskFrames < 100 || cell.preMaskClips < 2 || cell.postMaskClips < 1) throw new Error(`teacher_contact_support_floor:${key}`);
  }
  return support;
}
export function expectedTeacherSummary(parentP0AnchorSha256, sourceManifest, dataset, refined, mask, p0, context) {
  const perClip = [];
  for (const clip of context.contract.clipInventory) {
    const indexed = dataset.rows.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.decoder.clipId === clip.clipId);
    perClip.push(clipCountSummary(clip.clipId, clip.role, indexed.map(({ entry }) => entry), indexed.map(({ index }) => refined.rows[index]), indexed.map(({ index }) => mask.rows[index]), context));
  }
  const value = {
    artifactType: "teacher-summary-v2", schemaVersion: 2, parentP0AnchorSha256,
    teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory, teacherSourceManifestCanonicalSha256: sourceManifest.hash,
    teacherDatasetByteSha256: dataset.byteSha256, teacherRefinedByteSha256: refined.byteSha256, teacherMaskByteSha256: mask.byteSha256,
    targetRole: "raw_hard_refined_watch", teacherPolicyCanonicalSha256: context.hashes.teacherPolicy,
    evaluationContractCanonicalSha256: context.hashes.contract, teacherSchemaCanonicalSha256: context.hashes.teacherSchema,
    perClip, totals: sumClipCounts(perClip, context), manualCoverageRows: 6711, support: expectedSupport(dataset, mask, p0),
    unpaired: { clipId: "jujae-full", role: "unpaired_final", teacherState: "teacher_missing", pairedRows: 0 },
    provenanceAvailability: provenanceRecords(p0), forbiddenDurableFamilyCount: 0,
  };
  value.expectedCanonicalHash = canonicalHash(value);
  return value;
}
export function auditTeacherSummary(snapshot, parentP0AnchorSha256, sourceManifest, dataset, refined, mask, p0, context) {
  const actual = parseJsonBuffer(snapshot.buffer, "teacher_summary"); validateDef(context.teacherSchema, "teacherSummary", actual, "teacherSummary"); verifySelfHash(actual, "teacherSummary");
  const expected = expectedTeacherSummary(parentP0AnchorSha256, sourceManifest, dataset, refined, mask, p0, context);
  if (!stableEqual(actual, expected)) throw new Error("teacher_summary_derivation_drift");
  if (!snapshot.buffer.equals(Buffer.from(`${stableStringify(actual)}\n`, "utf8"))) throw new Error("teacher_summary_serialization");
  return { value: actual, hash: actual.expectedCanonicalHash, snapshot };
}

function descriptorFromSnapshot(descriptorPath, snapshot, canonical = false) {
  const descriptor = { path: descriptorPath };
  if (canonical) {
    const value = parseJsonBuffer(snapshot.buffer, `descriptor_build:${descriptorPath}`);
    descriptor.canonicalSha256 = canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash"));
  }
  descriptor.byteSha256 = snapshot.byteSha256;
  return descriptor;
}
function sortedByteDescriptors(entries) { return entries.map(([descriptorPath, snapshot]) => descriptorFromSnapshot(descriptorPath, snapshot, false)).sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path))); }
export function externalAnchorSnapshot(anchorInput, label, labelDirReal, artifactSnapshots = [], testHooks = null) {
  return secureExternalSnapshot(anchorInput, label, labelDirReal, artifactSnapshots, testHooks);
}
function snapshotIdentityKey(snapshot) { return `${snapshot.stat.dev}:${snapshot.stat.ino}`; }
function assertDistinctSnapshotIdentities(namedSnapshots, code) {
  const seen = new Map();
  for (const [name, snapshot] of namedSnapshots) {
    const key = snapshotIdentityKey(snapshot); const previous = seen.get(key);
    if (previous) throw new Error(`${code}:${previous}:${name}`);
    seen.set(key, name);
  }
}
const SEALED_ROLES = Object.freeze({
  reviewA: { option: "reviewA", role: "first", logicalPath: "sealed/review-a.json", artifactType: "sam-goal-manual-review-v3", schemaVersion: 3, actorField: "reviewerPseudonymSha256", schemaDef: "review" },
  reviewB: { option: "reviewB", role: "second", logicalPath: "sealed/review-b.json", artifactType: "sam-goal-manual-review-v3", schemaVersion: 3, actorField: "reviewerPseudonymSha256", schemaDef: "review" },
  adjudication: { option: "adjudication", role: "adjudication", logicalPath: "sealed/adjudication.json", artifactType: "sam-goal-manual-adjudication-v3", schemaVersion: 3, actorField: "adjudicatorPseudonymSha256", schemaDef: "adjudication" },
});
function assertBoundAuthoringContract(authoringSchema, spec) {
  const definition = authoringSchema?.$defs?.[spec.schemaDef];
  if (!definition) throw new Error(`sealed_authoring_schema_definition_missing:${spec.schemaDef}`);
  const artifactType = definition.properties?.artifactType?.const;
  const schemaVersion = definition.properties?.schemaVersion?.const;
  const roleRule = definition.properties?.role;
  const roleAccepted = roleRule?.const === spec.role || roleRule?.enum?.includes(spec.role);
  if (artifactType !== spec.artifactType || schemaVersion !== spec.schemaVersion || !roleAccepted) throw new Error(`authoring_schema_contract_mismatch:${spec.schemaDef}:${spec.role}`);
  return definition;
}
function verifySealedInput(input, descriptor, p0, key, artifactSnapshots, testHooks = null, preparedSnapshot = null) {
  const spec = SEALED_ROLES[key];
  if (!stableEqual(descriptor, { role: spec.role, logicalPath: spec.logicalPath, actorPseudonymSha256: descriptor?.actorPseudonymSha256, byteSha256: descriptor?.byteSha256 })
    || !SHA_RE.test(descriptor?.actorPseudonymSha256 || "") || !SHA_RE.test(descriptor?.byteSha256 || "")) throw new Error(`sealed_descriptor_invalid:${key}`);
  const snapshot = preparedSnapshot || secureExternalSnapshot(input, `sealed_${key}`, p0.labelDirReal, artifactSnapshots, testHooks);
  if (snapshot.filePath !== cliPath(input)) throw new Error(`sealed_prepared_path_mismatch:${key}`);
  for (const artifact of artifactSnapshots) if (artifact && artifact.stat.dev === snapshot.stat.dev && artifact.stat.ino === snapshot.stat.ino) throw new Error(`anchor_aliases_pack_artifact:sealed_${key}`);
  if (snapshot.byteSha256 !== descriptor.byteSha256) throw new Error(`sealed_input_hash_drift:${key}`);
  const value = parseJsonBuffer(snapshot.buffer, `sealed_${key}`);
  assertBoundAuthoringContract(p0.loaded.authoringSchema.value, spec);
  validateDef(p0.loaded.authoringSchema.value, spec.schemaDef, value, `sealed/${key}`);
  verifySelfHash(value, `sealed_${key}`);
  if (value.artifactType !== spec.artifactType || value.schemaVersion !== spec.schemaVersion) throw new Error(`sealed_artifact_type_mismatch:${key}`);
  if (value.role !== spec.role) throw new Error(`sealed_role_mismatch:${key}`);
  if (value[spec.actorField] !== descriptor.actorPseudonymSha256) throw new Error(`sealed_actor_mismatch:${key}`);
  return { snapshot, value, descriptor, key };
}

export function verifyP0Anchor(options, p0, context, testHooks = null, prepared = null) {
  const artifactSnapshots = [p0.manifestSnapshot, ...Object.values(p0.loaded).map((item) => item.snapshot)];
  assertDistinctSnapshotIdentities([["evaluationPack", p0.manifestSnapshot], ...Object.entries(p0.loaded).map(([name, item]) => [name, item.snapshot])], "p0_pack_artifact_alias");
  const snapshot = prepared?.p0AnchorSnapshot || externalAnchorSnapshot(options.p0Anchor, "p0_anchor", p0.labelDirReal, artifactSnapshots, testHooks);
  if (snapshot.filePath !== cliPath(options.p0Anchor)) throw new Error("p0_anchor_prepared_path_mismatch");
  for (const artifact of artifactSnapshots) if (artifact && artifact.stat.dev === snapshot.stat.dev && artifact.stat.ino === snapshot.stat.ino) throw new Error("anchor_aliases_pack_artifact:p0_anchor");
  const anchor = prepared?.p0AnchorValue || parseJsonBuffer(snapshot.buffer, "p0_anchor"); validateSchemaValue(context.p0AnchorSchema, context.p0AnchorSchema, anchor, "p0Anchor");
  const hash = verifySelfHash(anchor, "p0Anchor");
  if (hash !== options.expectedP0) throw new Error(`p0_anchor_expected_mismatch:${options.expectedP0}:${hash}`);
  if (anchor.candidateP0PackCanonicalSha256 !== p0.manifestHash) throw new Error("p0_anchor_candidate_mismatch");
  const expectedEvaluationPack = descriptorFromSnapshot("evaluation-pack.json", p0.manifestSnapshot, true);
  if (!stableEqual(anchor.evaluationPack, expectedEvaluationPack)) throw new Error("p0_anchor_pack_descriptor_drift");
  const compiledEntries = [
    ["evaluation-pack.json", p0.manifestSnapshot], ["manual-windows.json", p0.loaded.manualWindows.snapshot],
    ["manual-labels.jsonl", p0.loaded.manualLabels.snapshot], ["manual-subject-selection.jsonl", p0.loaded.manualSubjectSelection.snapshot],
    ["manual-review-pass1.jsonl", p0.loaded.manualReviewPassA.snapshot], ["manual-review-pass2.jsonl", p0.loaded.manualReviewPassB.snapshot],
    ["manual-adjudication.jsonl", p0.loaded.manualAdjudication.snapshot], ["manual-policy.json", p0.loaded.manualPolicy.snapshot],
    ["manual-summary.json", p0.loaded.manualSummary.snapshot],
  ];
  const compiled = sortedByteDescriptors(compiledEntries);
  if (!stableEqual(compiled.map((entry) => entry.path), [...P0_COMPILED].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) || !stableEqual(anchor.compiledArtifacts, compiled)) throw new Error("p0_anchor_compiled_set_drift");
  if (anchor.compiledArtifactSetSha256 !== descriptorSetHash(compiled)) throw new Error("p0_anchor_compiled_set_hash_drift");
  const expectedDependencies = {
    evaluationContractCanonicalSha256: context.hashes.contract, labelSchemaCanonicalSha256: context.hashes.labelSchema,
    authoringSchemaCanonicalSha256: p0.loaded.authoringSchema.descriptor.canonicalSha256, teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory,
    teacherPolicyCanonicalSha256: context.hashes.teacherPolicy, teacherSchemaCanonicalSha256: context.hashes.teacherSchema,
    p0AnchorSchemaCanonicalSha256: context.hashes.p0AnchorSchema, p1AnchorSchemaCanonicalSha256: context.hashes.p1AnchorSchema,
    sourceInventoryCanonicalSha256: context.hashes.sourceInventory, decoderByteSha256: ACCEPTED.decoderBytes,
    decoderCanonicalRowsSha256: ACCEPTED.decoderRows, manualCompilerByteSha256: p0.loaded.manualCompiler.snapshot.byteSha256,
    labelAuditorByteSha256: p0.loaded.labelAuditor.snapshot.byteSha256,
  };
  if (!stableEqual(anchor.dependencies, expectedDependencies)) throw new Error("p0_anchor_dependencies_drift");
  const verificationPhase = options.phase || (options.reviewA || options.reviewB || options.adjudication ? "p0" : "p1");
  let sealed = null;
  if (verificationPhase === "p0") {
    const values = [];
    for (const key of Object.keys(SEALED_ROLES)) {
      const verified = verifySealedInput(options[SEALED_ROLES[key].option], anchor.sealedInputs[key], p0, key, [...artifactSnapshots, snapshot, ...values.map((entry) => entry.snapshot)], testHooks, prepared?.sealedSnapshots?.[key]);
      values.push(verified);
    }
    const expectedActors = { reviewA: p0.manual.policy.reviewerHashes.first, reviewB: p0.manual.policy.reviewerHashes.second, adjudication: p0.manual.policy.reviewerHashes.adjudicator };
    for (const entry of values) if (entry.descriptor.actorPseudonymSha256 !== expectedActors[entry.key]) throw new Error(`sealed_actor_policy_mismatch:${entry.key}`);
    const byKey = Object.fromEntries(values.map((entry) => [entry.key, entry]));
    if (Object.hasOwn(byKey.adjudication.value, "reviewACanonicalSha256") && byKey.adjudication.value.reviewACanonicalSha256 !== byKey.reviewA.value.expectedCanonicalHash) throw new Error("sealed_adjudication_review_a_hash_mismatch");
    if (Object.hasOwn(byKey.adjudication.value, "reviewBCanonicalSha256") && byKey.adjudication.value.reviewBCanonicalSha256 !== byKey.reviewB.value.expectedCanonicalHash) throw new Error("sealed_adjudication_review_b_hash_mismatch");
    assertDistinctSnapshotIdentities([["p0Anchor", snapshot], ...values.map((entry) => [entry.key, entry.snapshot])], "sealed_inode_alias");
    for (const field of ["byteSha256", "actorPseudonymSha256"]) if (new Set(values.map((entry) => entry.descriptor[field])).size !== values.length) throw new Error(`sealed_${field === "byteSha256" ? "byte" : "actor"}_alias`);
    if (new Set(values.map((entry) => entry.snapshot.realpath)).size !== values.length) throw new Error("sealed_realpath_alias");
    sealed = Object.fromEntries(values.map((entry) => [entry.key, entry]));
  } else if (verificationPhase !== "p1") throw new Error(`p0_anchor_verification_phase_invalid:${verificationPhase}`);
  return { anchor, hash, snapshot, compiled, sealed };
}

const P1_INHERITED = Object.freeze({ evaluationContract: "evaluationContract", labelSchema: "labelSchema", teacherInputInventory: "teacherInputInventory", teacherPolicy: "teacherPolicy", teacherSchema: "teacherSchema", p0AnchorSchema: "p0AnchorSchema", p1AnchorSchema: "p1AnchorSchema", sourceInventory: "sourceInventory", decoderManifest: "decoderManifest", labelAuditor: "labelAuditor" });
const P1_NEW_DESCRIPTOR_POLICY = Object.freeze({
  teacherSourceManifest: ["teacher-source-manifest.json", true], teacherDataset: ["teacher-dataset-v2.jsonl", false],
  teacherRefined: ["teacher-refined.jsonl", false], teacherMask: ["teacher-mask-v2.jsonl", false], teacherSummary: ["teacher-summary.json", true],
  teacherMaterializer: ["scripts/sam-goal-teacher-materialize-v2.mjs", false],
});
function externalP0Descriptor(snapshot, hash) { return { logicalPath: "anchors/p0.json", canonicalSha256: hash, byteSha256: snapshot.byteSha256 }; }

function syntheticFixturePolicies() {
  const fixtureAuthoring = `${V3_ROOT}/audit-fixtures/synthetic-authoring-schema.json`;
  const fixtureCompiler = `${V3_ROOT}/audit-fixtures/synthetic-manual-compiler.txt`;
  const fixtureMaterializer = `${V3_ROOT}/audit-fixtures/synthetic-teacher-materializer.txt`;
  return {
    p0DescriptorPolicy: {
      evaluationContract: [PATHS.contract, true], labelSchema: [PATHS.labelSchema, true], authoringSchema: [fixtureAuthoring, true],
      teacherInputInventory: [PATHS.teacherInventory, true], teacherPolicy: [PATHS.teacherPolicy, true], teacherSchema: [PATHS.teacherSchema, true],
      p0AnchorSchema: [PATHS.p0AnchorSchema, true], p1AnchorSchema: [PATHS.p1AnchorSchema, true], sourceInventory: [PATHS.sourceInventory, true],
      decoderManifest: [PATHS.decoderManifest, false], manualWindows: ["manual-windows.json", true], manualLabels: ["manual-labels.jsonl", false],
      manualSubjectSelection: ["manual-subject-selection.jsonl", false], manualReviewPassA: ["manual-review-pass1.jsonl", false], manualReviewPassB: ["manual-review-pass2.jsonl", false],
      manualAdjudication: ["manual-adjudication.jsonl", false], manualPolicy: ["manual-policy.json", true], manualSummary: ["manual-summary.json", true],
      manualCompiler: [fixtureCompiler, false], labelAuditor: ["scripts/sam-goal-label-audit-v3.mjs", false],
    },
    p1NewDescriptorPolicy: {
      teacherSourceManifest: ["teacher-source-manifest.json", true], teacherDataset: ["teacher-dataset-v2.jsonl", false],
      teacherRefined: ["teacher-refined.jsonl", false], teacherMask: ["teacher-mask-v2.jsonl", false], teacherSummary: ["teacher-summary.json", true],
      teacherMaterializer: [fixtureMaterializer, false],
    },
  };
}
function runtimeFixtureScope(options) {
  const fixtureRoot = realpathSync(repoPath(`${V3_ROOT}/audit-fixtures`)); const labelDirReal = realpathSync(cliPath(options.labelDir));
  const relative = path.relative(fixtureRoot, labelDirReal); const parts = relative.split(path.sep);
  if (parts.length !== 2 || !parts[0].startsWith("runtime-test-") || parts[1] !== "pack" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("synthetic_fixture_scope_invalid");
  return { fixtureRoot, labelDirReal, runtimeRoot: path.dirname(labelDirReal) };
}
function validateFixtureOverrideMap(channel, overrides, runtimeRoot) {
  if (overrides === undefined) return;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) throw new Error(`synthetic_override_map_invalid:${channel}`);
  for (const [logicalPath, entry] of Object.entries(overrides)) {
    if (!validDescriptorPath(logicalPath) || !entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`synthetic_override_invalid:${channel}:${logicalPath}`);
    const allowedKeys = ["path", "baselineByteSha256"];
    if (Object.keys(entry).some((key) => !allowedKeys.includes(key)) || typeof entry.path !== "string" || !SHA_RE.test(entry.baselineByteSha256 || "")) throw new Error(`synthetic_override_invalid:${channel}:${logicalPath}`);
    if (channel === "corePathOverrides" && !Object.values(PATHS).includes(logicalPath)) throw new Error(`synthetic_core_override_forbidden:${logicalPath}`);
    if (channel === "teacherPathOverrides" && !logicalPath.startsWith("sam-3d-body-skeletons/")) throw new Error(`synthetic_teacher_override_forbidden:${logicalPath}`);
    const baseline = snapshotFile(repoPath(logicalPath), `synthetic_baseline:${logicalPath}`);
    if (baseline.byteSha256 !== entry.baselineByteSha256) throw new Error(`synthetic_baseline_hash_drift:${logicalPath}`);
    const target = realpathSync(cliPath(entry.path)); const relative = path.relative(runtimeRoot, target); const parts = relative.split(path.sep);
    if (parts[0] !== "overrides" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`synthetic_override_scope_invalid:${logicalPath}`);
    const status = lstatSync(target, { bigint: true });
    if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1n) throw new Error(`synthetic_override_not_plain_regular:${logicalPath}`);
  }
}
function validateRunAuditTestHooks(options, testHooks) {
  if (testHooks === null || testHooks === undefined) return null;
  if (process.env.NODE_ENV !== "test") throw new Error("synthetic_fixture_mode_forbidden");
  const allowedKeys = ["syntheticOnly", "testFixtureMode", "p0DescriptorPolicy", "p1NewDescriptorPolicy", "corePathOverrides", "descriptorPathOverrides", "teacherPathOverrides", "onExternalSnapshotBoundary", "onAuditPhaseBoundary"];
  if (!testHooks || typeof testHooks !== "object" || Array.isArray(testHooks) || Object.keys(testHooks).some((key) => !allowedKeys.includes(key))) throw new Error("synthetic_fixture_hooks_invalid");
  if (testHooks.syntheticOnly !== true || testHooks.testFixtureMode !== "evaluation-v3-runtime-test") throw new Error("synthetic_fixture_disclosure_missing");
  const expected = syntheticFixturePolicies();
  if (!stableEqual(testHooks.p0DescriptorPolicy, expected.p0DescriptorPolicy) || !stableEqual(testHooks.p1NewDescriptorPolicy, expected.p1NewDescriptorPolicy)) throw new Error("synthetic_fixture_policy_drift");
  if (testHooks.onExternalSnapshotBoundary !== undefined && typeof testHooks.onExternalSnapshotBoundary !== "function") throw new Error("synthetic_fixture_boundary_hook_invalid");
  if (testHooks.onAuditPhaseBoundary !== undefined && typeof testHooks.onAuditPhaseBoundary !== "function") throw new Error("synthetic_fixture_phase_hook_invalid");
  const { runtimeRoot } = runtimeFixtureScope(options);
  for (const channel of ["corePathOverrides", "descriptorPathOverrides", "teacherPathOverrides"]) validateFixtureOverrideMap(channel, testHooks[channel], runtimeRoot);
  return testHooks;
}
function syntheticCliTestHooks(options) {
  if (process.env.SAM_GOAL_V3_SYNTHETIC_AUDIT !== "1") return null;
  if (process.env.NODE_ENV !== "test") throw new Error("synthetic_fixture_mode_forbidden");
  runtimeFixtureScope(options);
  return { syntheticOnly: true, testFixtureMode: "evaluation-v3-runtime-test", ...syntheticFixturePolicies() };
}

export function auditP1Candidate(options, p0, p0Anchor, context, testHooks = null) {
  const manifestSnapshot = snapshotFile(path.join(p0.labelDir, "evaluation-pack-p1.json"), "evaluation_pack_p1");
  const manifest = parseJsonBuffer(manifestSnapshot.buffer, "evaluation_pack_p1"); validateDef(context.teacherSchema, "p1PackManifest", manifest, "evaluationPackP1");
  const manifestHash = verifySelfHash(manifest, "evaluationPackP1");
  if (manifest.parentP0AnchorSha256 !== p0Anchor.hash || manifest.targetRole !== "raw_hard_refined_watch") throw new Error("p1_pack_parent_or_role_drift");
  const newPolicy = testHooks?.p1NewDescriptorPolicy || P1_NEW_DESCRIPTOR_POLICY;
  const expectedKeys = ["p0Pack", "externalP0Anchor", ...Object.keys(P1_INHERITED), ...Object.keys(newPolicy)].sort();
  if (!manifest.files || !stableEqual(Object.keys(manifest.files).sort(), expectedKeys)) throw new Error("p1_descriptor_set_drift");
  const loaded = {
    p0Pack: { snapshot: p0.manifestSnapshot, value: p0.manifest, descriptor: p0Anchor.anchor.evaluationPack },
    externalP0Anchor: { snapshot: p0Anchor.snapshot, value: p0Anchor.anchor, descriptor: externalP0Descriptor(p0Anchor.snapshot, p0Anchor.hash) },
  };
  if (!stableEqual(manifest.files.p0Pack, p0Anchor.anchor.evaluationPack)) throw new Error("p1_inherited_descriptor_drift:p0Pack");
  if (!stableEqual(manifest.files.externalP0Anchor, loaded.externalP0Anchor.descriptor)) throw new Error("p1_external_p0_descriptor_drift");
  for (const [p1Key, p0Key] of Object.entries(P1_INHERITED)) {
    if (!stableEqual(manifest.files[p1Key], p0.manifest.files[p0Key])) throw new Error(`p1_inherited_descriptor_drift:${p1Key}`);
    loaded[p1Key] = { ...p0.loaded[p0Key], descriptor: manifest.files[p1Key] };
  }
  for (const [key, [expectedPath, canonical]] of Object.entries(newPolicy)) loaded[key] = verifyDescriptor(manifest.files[key], expectedPath, p0.labelDir, canonical);
  const phaseSnapshots = [["p1Manifest", manifestSnapshot], ["p0Anchor", p0Anchor.snapshot], ...Object.entries(loaded).filter(([key]) => !["p0Pack", "externalP0Anchor", ...Object.keys(P1_INHERITED)].includes(key)).map(([name, item]) => [name, item.snapshot]), ...[["p0Pack", p0.manifestSnapshot], ...Object.entries(p0.loaded).map(([name, item]) => [`p0/${name}`, item.snapshot])]];
  assertDistinctSnapshotIdentities(phaseSnapshots, "p1_artifact_alias");
  const staticExpected = { evaluationContract: context.hashes.contract, labelSchema: context.hashes.labelSchema, teacherInputInventory: context.hashes.teacherInventory, teacherPolicy: context.hashes.teacherPolicy, teacherSchema: context.hashes.teacherSchema, p0AnchorSchema: context.hashes.p0AnchorSchema, p1AnchorSchema: context.hashes.p1AnchorSchema, sourceInventory: context.hashes.sourceInventory };
  for (const [key, hash] of Object.entries(staticExpected)) if (loaded[key].descriptor.canonicalSha256 !== hash) throw new Error(`p1_static_dependency_drift:${key}`);
  if (loaded.decoderManifest.descriptor.byteSha256 !== ACCEPTED.decoderBytes || loaded.p0Pack.descriptor.canonicalSha256 !== p0.manifestHash || loaded.externalP0Anchor.descriptor.canonicalSha256 !== p0Anchor.hash) throw new Error("p1_parent_descriptor_drift");
  const sourceManifest = auditSourceManifest(loaded.teacherSourceManifest.snapshot, p0Anchor.hash, p0, context);
  const dataset = auditDataset(loaded.teacherDataset.snapshot, p0, context);
  const refined = auditRefined(loaded.teacherRefined.snapshot, dataset, context);
  const mask = auditMask(loaded.teacherMask.snapshot, dataset, p0, context);
  const summary = auditTeacherSummary(loaded.teacherSummary.snapshot, p0Anchor.hash, sourceManifest, dataset, refined, mask, p0, context);
  scanForbiddenDurable(manifest, context.contract, "p1Manifest"); scanForbiddenDurable(sourceManifest.value, context.contract, "teacherSourceManifest"); scanForbiddenDurable(summary.value, context.contract, "teacherSummary");
  const lockSnapshot = snapshotFile(path.join(p0.labelDir, "evaluation-lock-p1.json"), "evaluation_lock_p1");
  assertDistinctSnapshotIdentities([...phaseSnapshots, ["p1Lock", lockSnapshot]], "p1_artifact_alias");
  const lock = parseJsonBuffer(lockSnapshot.buffer, "evaluation_lock_p1"); validateDef(context.teacherSchema, "p1CandidateLock", lock, "evaluationLockP1");
  const lockHash = verifySelfHash(lock, "evaluationLockP1");
  const expectedLock = {
    artifactType: "evaluation-lock-v2", schemaVersion: 2, phase: "p1-candidate", parentP0AnchorSha256: p0Anchor.hash,
    p1PackCanonicalSha256: manifestHash, targetRole: "raw_hard_refined_watch", teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory,
    teacherSourceManifestCanonicalSha256: sourceManifest.hash, teacherDatasetByteSha256: dataset.byteSha256,
    teacherRefinedByteSha256: refined.byteSha256, teacherMaskByteSha256: mask.byteSha256, teacherSummaryCanonicalSha256: summary.hash,
    teacherPolicyCanonicalSha256: context.hashes.teacherPolicy, teacherMaterializerByteSha256: loaded.teacherMaterializer.snapshot.byteSha256,
    labelAuditorByteSha256: loaded.labelAuditor.snapshot.byteSha256,
  };
  expectedLock.expectedCanonicalHash = canonicalHash(expectedLock);
  if (!stableEqual(lock, expectedLock)) throw new Error("p1_candidate_lock_derivation_drift");
  return { manifest, manifestHash, manifestSnapshot, loaded, sourceManifest, dataset, refined, mask, summary, lock, lockHash, lockSnapshot };
}

export function verifyP1Anchor(options, p0, p0Anchor, p1, context, testHooks = null) {
  const artifactSnapshots = [p1.manifestSnapshot, p1.lockSnapshot, ...Object.values(p1.loaded).map((item) => item.snapshot)];
  const snapshot = externalAnchorSnapshot(options.p1Anchor, "p1_anchor", p0.labelDirReal, [...artifactSnapshots, p0Anchor.snapshot], testHooks);
  const anchor = parseJsonBuffer(snapshot.buffer, "p1_anchor"); validateSchemaValue(context.p1AnchorSchema, context.p1AnchorSchema, anchor, "p1Anchor");
  const hash = verifySelfHash(anchor, "p1Anchor"); if (hash !== options.expectedP1) throw new Error(`p1_anchor_expected_mismatch:${options.expectedP1}:${hash}`);
  if (anchor.parentP0AnchorSha256 !== p0Anchor.hash || anchor.candidateP1LockCanonicalSha256 !== p1.lockHash || anchor.targetRole !== "raw_hard_refined_watch") throw new Error("p1_anchor_parent_or_lock_drift");
  if (!stableEqual(anchor.evaluationPackP1, descriptorFromSnapshot("evaluation-pack-p1.json", p1.manifestSnapshot, true)) || !stableEqual(anchor.p1Lock, descriptorFromSnapshot("evaluation-lock-p1.json", p1.lockSnapshot, true))) throw new Error("p1_anchor_pack_lock_descriptor_drift");
  const teacherArtifacts = {
    inputInventory: descriptorFromSnapshot(PATHS.teacherInventory, p1.loaded.teacherInputInventory.snapshot, true),
    sourceManifest: descriptorFromSnapshot("teacher-source-manifest.json", p1.loaded.teacherSourceManifest.snapshot, true),
    dataset: descriptorFromSnapshot("teacher-dataset-v2.jsonl", p1.loaded.teacherDataset.snapshot), refined: descriptorFromSnapshot("teacher-refined.jsonl", p1.loaded.teacherRefined.snapshot),
    mask: descriptorFromSnapshot("teacher-mask-v2.jsonl", p1.loaded.teacherMask.snapshot), summary: descriptorFromSnapshot("teacher-summary.json", p1.loaded.teacherSummary.snapshot, true),
  };
  if (!stableEqual(anchor.teacherArtifacts, teacherArtifacts)) throw new Error("p1_anchor_teacher_artifact_drift");
  const compiledEntries = [["evaluation-pack-p1.json", p1.manifestSnapshot], ["evaluation-lock-p1.json", p1.lockSnapshot], ["teacher-source-manifest.json", p1.loaded.teacherSourceManifest.snapshot], ["teacher-dataset-v2.jsonl", p1.loaded.teacherDataset.snapshot], ["teacher-refined.jsonl", p1.loaded.teacherRefined.snapshot], ["teacher-mask-v2.jsonl", p1.loaded.teacherMask.snapshot], ["teacher-summary.json", p1.loaded.teacherSummary.snapshot]];
  const compiled = sortedByteDescriptors(compiledEntries);
  if (!stableEqual(compiled.map((entry) => entry.path), [...P1_COMPILED].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) || !stableEqual(anchor.compiledArtifacts, compiled) || anchor.compiledArtifactSetSha256 !== descriptorSetHash(compiled)) throw new Error("p1_anchor_compiled_set_drift");
  const expectedDependencies = {
    evaluationContractCanonicalSha256: context.hashes.contract, teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory,
    teacherPolicyCanonicalSha256: context.hashes.teacherPolicy, teacherSchemaCanonicalSha256: context.hashes.teacherSchema,
    p0AnchorSchemaCanonicalSha256: context.hashes.p0AnchorSchema, p1AnchorSchemaCanonicalSha256: context.hashes.p1AnchorSchema,
    teacherMaterializerByteSha256: p1.loaded.teacherMaterializer.snapshot.byteSha256, labelAuditorByteSha256: p1.loaded.labelAuditor.snapshot.byteSha256,
  };
  if (!stableEqual(anchor.dependencies, expectedDependencies)) throw new Error("p1_anchor_dependencies_drift");
  return { anchor, hash, snapshot, compiled };
}

function makeReport(options, context, p0, p0Anchor = null, p1 = null, p1Anchor = null, testHooks = null) {
  const disclosure = testHooks ? { syntheticOnly: true, testFixtureMode: testHooks.testFixtureMode } : {};
  if (options.phase === "p0-candidate") return { status: "candidate", phase: "p0-candidate", ...disclosure, frozen: false, externallyVerified: false, candidateP0PackCanonicalSha256: p0.manifestHash, decoderRows: 6711, teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory, realP0BlockedUntil: context.contract.realP0GenerationBlockedUntil };
  if (options.phase === "p0") return { status: "passed", phase: "p0", ...disclosure, frozen: true, externallyVerified: true, candidateP0PackCanonicalSha256: p0.manifestHash, parentP0AnchorSha256: p0Anchor.hash, decoderRows: 6711, teacherInputInventoryCanonicalSha256: context.hashes.teacherInventory };
  return { status: "passed", phase: "p1", ...disclosure, frozen: true, externallyVerified: true, parentP0AnchorSha256: p0Anchor.hash, p1PackCanonicalSha256: p1.manifestHash, candidateP1LockCanonicalSha256: p1.lockHash, parentP1AnchorSha256: p1Anchor.hash, teacherRows: 6711, targetRole: "raw_hard_refined_watch" };
}
function errorCode(message) { return String(message || "audit_error").split(":", 1)[0] || "audit_error"; }

function prepareP0Authority(options, testHooks = null) {
  const labelDir = cliPath(options.labelDir); const ancestors = ancestorIdentityChain(labelDir, "label_dir");
  let labelStat;
  try { labelStat = lstatSync(labelDir, { bigint: true }); } catch { throw new Error(`label_dir_invalid:${labelDir}`); }
  if (labelStat.isSymbolicLink() || !labelStat.isDirectory()) throw new Error(`label_dir_invalid:${labelDir}`);
  assertAncestorIdentityChain(ancestors, "label_dir"); const labelDirReal = realpathSync(labelDir);
  const p0AnchorSnapshot = externalAnchorSnapshot(options.p0Anchor, "p0_anchor", labelDirReal, [], testHooks);
  const p0AnchorValue = parseJsonBuffer(p0AnchorSnapshot.buffer, "p0_anchor"); const p0AnchorHash = verifySelfHash(p0AnchorValue, "p0Anchor");
  if (p0AnchorHash !== options.expectedP0) throw new Error(`p0_anchor_expected_mismatch:${options.expectedP0}:${p0AnchorHash}`);
  const sealedSnapshots = {};
  if (options.phase === "p0") {
    const prior = [p0AnchorSnapshot];
    for (const key of Object.keys(SEALED_ROLES)) {
      const snapshot = secureExternalSnapshot(options[SEALED_ROLES[key].option], `sealed_${key}`, labelDirReal, prior, testHooks);
      sealedSnapshots[key] = snapshot; prior.push(snapshot);
    }
  }
  return { labelDir, labelDirReal, labelIdentity: statIdentity(labelStat), labelAncestors: ancestors, p0AnchorSnapshot, p0AnchorValue, p0AnchorHash, sealedSnapshots };
}
function assertPreparedLabelDir(prepared, p0) {
  if (!prepared || p0.labelDirReal !== prepared.labelDirReal) throw new Error("label_dir_replaced:realpath");
  const current = lstatSync(prepared.labelDir, { bigint: true });
  if (current.isSymbolicLink() || !current.isDirectory() || !sameStatIdentity(prepared.labelIdentity, statIdentity(current))) throw new Error("label_dir_replaced:identity");
  assertAncestorIdentityChain(prepared.labelAncestors, "label_dir");
}

export function runAudit(options, testHooks = null) {
  validateAuditOptions(options);
  const scopedTestHooks = validateRunAuditTestHooks(options, testHooks);
  const prepared = options.phase === "p0-candidate" ? null : prepareP0Authority(options, scopedTestHooks);
  const context = loadCore(scopedTestHooks); const teacherInputs = auditTeacherInputs(context, scopedTestHooks); const p0 = auditP0Candidate(options.labelDir, context, teacherInputs, scopedTestHooks);
  if (options.phase === "p0-candidate") return makeReport(options, context, p0, null, null, null, scopedTestHooks);
  assertPreparedLabelDir(prepared, p0);
  const p0Anchor = verifyP0Anchor(options, p0, context, scopedTestHooks, prepared);
  if (options.phase === "p0") return makeReport(options, context, p0, p0Anchor, null, null, scopedTestHooks);
  scopedTestHooks?.onAuditPhaseBoundary?.(Object.freeze({ boundary: "p0-verified-before-p1" }));
  const p1 = auditP1Candidate(options, p0, p0Anchor, context, scopedTestHooks); const p1Anchor = verifyP1Anchor(options, p0, p0Anchor, p1, context, scopedTestHooks);
  return makeReport(options, context, p0, p0Anchor, p1, p1Anchor, scopedTestHooks);
}

function main() {
  const options = parseArgs(process.argv.slice(2)); if (options.help) return;
  console.log(JSON.stringify(runAudit(options, syntheticCliTestHooks(options)), null, 2));
}
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); }
  catch (error) {
    const detail = error?.message || String(error); const phaseIndex = process.argv.indexOf("--phase");
    console.log(JSON.stringify({ status: "failed", phase: phaseIndex >= 0 ? process.argv[phaseIndex + 1] : null, errors: [{ code: errorCode(detail), detail }] }, null, 2));
    process.exitCode = 1;
  }
}
