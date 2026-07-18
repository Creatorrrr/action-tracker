#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const V3_ROOT = "tests/fixtures/sam-goal-v2/evaluation-v3";
const PATHS = Object.freeze({
  evaluationContract: `${V3_ROOT}/evaluation-contract.json`,
  labelSchema: `${V3_ROOT}/label-schema.json`,
  authoringSchema: `${V3_ROOT}/authoring-schema.json`,
  teacherInputInventory: `${V3_ROOT}/teacher-input-inventory.json`,
  teacherPolicy: `${V3_ROOT}/teacher-policy.json`,
  teacherSchema: `${V3_ROOT}/teacher-schema.json`,
  p0AnchorSchema: `${V3_ROOT}/p0-lock-anchor-v2-schema.json`,
  p1AnchorSchema: `${V3_ROOT}/p1-lock-anchor-schema.json`,
  sourceContract: "tests/fixtures/sam-goal-v2/source-contract.json",
  sourceSchema: "tests/fixtures/sam-goal-v2/source-schema.json",
  sourceInventory: "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
  decoderManifest: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl",
  manualCompiler: "scripts/sam-goal-manual-pack-v3.mjs",
  labelAuditor: "scripts/sam-goal-label-audit-v3.mjs",
});
const ACCEPTED = Object.freeze({
  evaluationContract: "5307a5d4e2c56e652b7a417713e1b0ebff5dabf712e591eefa94737e7318b1bd",
  labelSchema: "afe645d7c062e3644db96cea20b2f6724892077f1993de829a28deeb38d138f8",
  authoringSchema: "c255cab6b226b0b4ac418ff17c92fec053d34156bf3efaf3af88fc30cdd32962",
  authoringSchemaBytes: "90a5e27a6cd10bee753d516ec0f21f361ce8a529c42f585a228190e38311c68e",
  teacherInputInventory: "50756ed7c4d461632cea1c96a12fc53910b1112ebc15b92e2f514733e4830f04",
  teacherPolicy: "d38b9583cd5b9d9cd57d947866c1f5140e880f93095024b54c613fc3d8c804d7",
  teacherSchema: "167e92cc6a499cf57a6d10d5d0b3df4d22c8a76fae662927a46b0ade61208035",
  p0AnchorSchema: "827ef909587e99b0ed991638f36a2abd5c3941aec807a671e8030ba6a961ff84",
  p1AnchorSchema: "c709738e7214824b29985501ab7291be0919345aae69eb46d9e1ade9d316045c",
  sourceContract: "39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873",
  sourceSchema: "ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244",
  sourceInventory: "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d",
  decoderBytes: "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79",
  decoderRows: "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d",
  labelAuditorBytes: "38396bd4baea5618f20d9afd738b328497d06bf8bd5681bf4455df5232ada368",
});
const SHA_RE = /^[0-9a-f]{64}$/;
const CAPTURED_SELF_GLOBAL = "__SAM_GOAL_MANUAL_PACK_V3_CAPTURED_SELF__";
// This digest covers this entire source file after replacing the value below
// with 64 ASCII zeroes.  It binds the bytes loaded by Node's initial module
// loader to the bytes captured for the descriptor/re-execution bootstrap.
const SELF_NORMALIZED_SHA256 = "f15853aa5ac1db15eab79d6e4eff269c1f6aee125f26299e6bbf4e9730e41e26";
const COMPILED_FILES = Object.freeze([
  "evaluation-pack.json",
  "manual-windows.json",
  "manual-labels.jsonl",
  "manual-subject-selection.jsonl",
  "manual-review-pass1.jsonl",
  "manual-review-pass2.jsonl",
  "manual-adjudication.jsonl",
  "manual-policy.json",
  "manual-summary.json",
]);
const ACTIVE_TEMP_ENTRIES = new Set();
const ACTIVE_PROVISIONAL_ENTRIES = new Set();
const ACTIVE_CHILDREN = new Set();
let handlingSignal = false;
const RUNTIME_TEST_FLAG = "SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST";

function runtimeTestEnabled() { return process.env.NODE_ENV === "test" && process.env[RUNTIME_TEST_FLAG] === "1"; }
function testFaultEnabled(environmentName) {
  const value = process.env[environmentName];
  if (value === undefined || value === "") return false;
  if (!runtimeTestEnabled()) throw new Error(`test_hook_forbidden:${environmentName}`);
  if (value !== "1") throw new Error(`test_fault_value_invalid:${environmentName}:${value}`);
  return true;
}
function relativeCreateFault(label) {
  const environmentName = "SAM_GOAL_MANUAL_PACK_V3_FAULT_RELATIVE_CREATE";
  const value = process.env[environmentName];
  if (value === undefined || value === "") return false;
  if (!runtimeTestEnabled()) throw new Error(`test_hook_forbidden:${environmentName}`);
  const allowed = new Set(["compile_stage", "anchor_recompile_stage", "anchor_temp"]);
  if (!allowed.has(value)) throw new Error(`test_fault_value_invalid:${environmentName}:${value}`);
  return value === label;
}
function stageWriterFault(label) {
  const environmentName = "SAM_GOAL_MANUAL_PACK_V3_FAULT_STAGE_WRITER";
  const value = process.env[environmentName];
  if (value === undefined || value === "") return false;
  if (!runtimeTestEnabled()) throw new Error(`test_hook_forbidden:${environmentName}`);
  const allowed = new Set(["compile", "anchor"]);
  if (!allowed.has(value)) throw new Error(`test_fault_value_invalid:${environmentName}:${value}`);
  return value === label;
}
const FINAL_SEGMENT_TRACE_ENV = "SAM_GOAL_MANUAL_PACK_V3_TEST_FINAL_SEGMENT_TRACE";
function finalSegmentTraceEnabled(mode) {
  const value = process.env[FINAL_SEGMENT_TRACE_ENV];
  if (value === undefined) return false;
  if (!runtimeTestEnabled()) throw new Error(`test_hook_forbidden:${FINAL_SEGMENT_TRACE_ENV}`);
  if (value !== "1") throw new Error(`test_fault_value_invalid:${FINAL_SEGMENT_TRACE_ENV}:${value}`);
  if (mode !== "compile") throw new Error(`test_hook_mode_invalid:${FINAL_SEGMENT_TRACE_ENV}:${mode || "help"}`);
  return true;
}

function normalizedSelfDigest(buffer) {
  const text = buffer.toString("utf8");
  const pattern = /const SELF_NORMALIZED_SHA256 = "([0-9a-f]{64})";/g;
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`manual_compiler_self_marker_count:${matches.length}`);
  const normalized = Buffer.from(text.replace(pattern, `const SELF_NORMALIZED_SHA256 = "${"0".repeat(64)}";`), "utf8");
  return { embedded: matches[0][1], digest: sha256(normalized) };
}
function assertNormalizedSelf(buffer) {
  const result = normalizedSelfDigest(buffer);
  if (result.embedded !== SELF_NORMALIZED_SHA256 || result.digest !== SELF_NORMALIZED_SHA256) {
    throw new Error(`manual_compiler_loaded_bytes_drift:${result.embedded}:${result.digest}:${SELF_NORMALIZED_SHA256}`);
  }
}

function waitForChildClose(child) {
  if (!ACTIVE_CHILDREN.has(child)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    child.once("close", done);
    child.once("error", done);
  });
}
async function terminateChildren(signal) {
  const children = [...ACTIVE_CHILDREN];
  const waits = children.map(waitForChildClose);
  for (const child of children) { try { child.kill(signal); } catch { /* already exited */ } }
  let timedOut = false;
  await Promise.race([
    Promise.all(waits),
    new Promise((resolve) => setTimeout(() => { timedOut = true; resolve(); }, 2_000)),
  ]);
  if (timedOut) {
    const remaining = [...ACTIVE_CHILDREN];
    const killWaits = remaining.map(waitForChildClose);
    for (const child of remaining) { try { child.kill("SIGKILL"); } catch { /* already exited */ } }
    await Promise.all(killWaits);
  }
}
function cleanupRegisteredState() {
  for (const entry of [...ACTIVE_PROVISIONAL_ENTRIES].reverse()) {
    try { removeRelativeIfIdentity(entry); } catch { /* best effort on process shutdown */ }
    ACTIVE_PROVISIONAL_ENTRIES.delete(entry);
  }
  for (const entry of [...ACTIVE_TEMP_ENTRIES].reverse()) {
    try { removeRelativeIfIdentity(entry); } catch { /* best effort on process shutdown */ }
    ACTIVE_TEMP_ENTRIES.delete(entry);
  }
}
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(signal, () => {
    if (handlingSignal) return;
    handlingSignal = true;
    void (async () => {
      await terminateChildren(signal);
      cleanupRegisteredState();
      process.exit(exitCode);
    })();
  });
}
process.on("exit", cleanupRegisteredState);

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-manual-pack-v3.mjs validate-review --review <path> --expected-role <first|second> --expected-reviewer-pseudonym-sha256 <sha256>
  node scripts/sam-goal-manual-pack-v3.mjs compile --review-a <path> --review-b <path> --adjudication <path> --output-dir <absent-path>
  node scripts/sam-goal-manual-pack-v3.mjs create-anchor --anchor <absent-external-path> --label-dir <candidate> --review-a <path> --review-b <path> --adjudication <path>
  node scripts/sam-goal-manual-pack-v3.mjs verify-anchor --anchor <external-path> --expected-p0-anchor-sha256 <sha256> --label-dir <candidate> --review-a <path> --review-b <path> --adjudication <path>`);
}

function parseArgs(argv) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) return { help: true };
  const mode = argv[0];
  if (!["validate-review", "compile", "create-anchor", "verify-anchor"].includes(mode)) throw new Error(`mode_invalid:${mode || "missing"}`);
  const names = new Map([
    ["--review", "review"], ["--expected-role", "expectedRole"],
    ["--expected-reviewer-pseudonym-sha256", "expectedReviewer"], ["--review-a", "reviewA"],
    ["--review-b", "reviewB"], ["--adjudication", "adjudication"], ["--output-dir", "outputDir"],
    ["--anchor", "anchor"], ["--expected-p0-anchor-sha256", "expectedP0Anchor"], ["--label-dir", "labelDir"],
  ]);
  const options = { mode };
  const seen = new Set();
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]; const key = names.get(flag);
    if (!key) throw new Error(`unknown_argument:${flag}`);
    if (seen.has(key)) throw new Error(`duplicate_argument:${flag}`);
    const value = argv[index += 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${flag}`);
    seen.add(key); options[key] = value;
  }
  const expected = {
    "validate-review": new Set(["review", "expectedRole", "expectedReviewer"]),
    compile: new Set(["reviewA", "reviewB", "adjudication", "outputDir"]),
    "create-anchor": new Set(["anchor", "labelDir", "reviewA", "reviewB", "adjudication"]),
    "verify-anchor": new Set(["anchor", "expectedP0Anchor", "labelDir", "reviewA", "reviewB", "adjudication"]),
  }[mode];
  if (seen.size !== expected.size || [...seen].some((key) => !expected.has(key))) throw new Error(`mode_argument_set_invalid:${mode}`);
  if (mode === "validate-review" && !["first", "second"].includes(options.expectedRole)) throw new Error(`expected_role_invalid:${options.expectedRole}`);
  if (mode === "validate-review" && !SHA_RE.test(options.expectedReviewer)) throw new Error("expected_reviewer_pseudonym_sha256_invalid");
  if (mode === "verify-anchor" && !SHA_RE.test(options.expectedP0Anchor)) throw new Error("expected_p0_anchor_sha256_invalid");
  return options;
}

function compareUtf8(left, right) { return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8")); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compareUtf8).map((key) => [key, stableValue(value[key])]));
  return value;
}
function stableStringify(value) { return JSON.stringify(stableValue(value)); }
function stableEqual(left, right) { return stableStringify(left) === stableStringify(right); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function canonicalHash(value, omitExpected = false) {
  let target = value;
  if (omitExpected && value && typeof value === "object" && !Array.isArray(value)) { target = { ...value }; delete target.expectedCanonicalHash; }
  return sha256(Buffer.from(stableStringify(target), "utf8"));
}
function prettyJson(value) { return `${JSON.stringify(stableValue(value), null, 2)}\n`; }
function jsonl(rows) { return rows.length ? `${rows.map(stableStringify).join("\n")}\n` : ""; }
function withSelfHash(value) { const result = { ...value, expectedCanonicalHash: "" }; result.expectedCanonicalHash = canonicalHash(result, true); return result; }
function repoPath(relativePath) { return path.resolve(REPO_ROOT, relativePath); }
function cliPath(input) {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0")) throw new Error("cli_path_invalid");
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(process.cwd(), input);
}
function statIdentity(status) { return { dev: status.dev, ino: status.ino, mode: status.mode, nlink: status.nlink }; }
function sameStatIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink; }
function ancestorIdentity(status) { return { dev: status.dev, ino: status.ino, mode: status.mode }; }
function sameAncestorIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode; }
function sameSnapshotState(left, right) {
  return sameStatIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs;
}
function ancestorIdentityChain(filePath, label) {
  const resolved = path.resolve(filePath); const root = path.parse(resolved).root;
  const parts = path.relative(root, path.dirname(resolved)).split(path.sep).filter(Boolean);
  const chain = []; let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let status;
    try { status = lstatSync(cursor, { bigint: true }); } catch (error) { throw new Error(`external_ancestor_missing:${label}:${cursor}:${error.code || "error"}`); }
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`external_ancestor_symlink:${label}:${cursor}`);
    chain.push({ path: cursor, identity: ancestorIdentity(status) });
  }
  return chain;
}
function assertAncestorIdentityChain(chain, label) {
  for (const entry of chain) {
    let status;
    try { status = lstatSync(entry.path, { bigint: true }); } catch (error) { throw new Error(`external_ancestor_replaced:${label}:${entry.path}:${error.code || "error"}`); }
    if (status.isSymbolicLink() || !status.isDirectory() || !sameAncestorIdentity(entry.identity, ancestorIdentity(status))) throw new Error(`external_ancestor_replaced:${label}:${entry.path}`);
  }
}
function snapshotFile(filePath, label, requireOneLink = false) {
  const resolved = path.resolve(filePath); const ancestors = ancestorIdentityChain(resolved, label);
  let pre;
  try { pre = lstatSync(resolved, { bigint: true }); } catch (error) { throw new Error(`artifact_missing:${label}:${resolved}:${error.code || "error"}`); }
  if (pre.isSymbolicLink() || !pre.isFile()) throw new Error(`artifact_not_plain_regular:${label}`);
  if (requireOneLink && pre.nlink !== 1n) throw new Error(`artifact_link_count:${label}:${pre.nlink}`);
  assertAncestorIdentityChain(ancestors, label);
  const fd = openSync(resolved, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || (requireOneLink && before.nlink !== 1n) || !sameStatIdentity(statIdentity(pre), statIdentity(before))) throw new Error(`artifact_final_replaced:${label}`);
    const buffer = readFileSync(fd); const after = fstatSync(fd, { bigint: true });
    if (!sameSnapshotState(before, after)) throw new Error(`artifact_changed_during_read:${label}`);
    if (BigInt(buffer.length) !== before.size) throw new Error(`artifact_short_read:${label}`);
    assertAncestorIdentityChain(ancestors, label);
    const post = lstatSync(resolved, { bigint: true });
    if (post.isSymbolicLink() || !post.isFile() || !sameSnapshotState(before, post)) throw new Error(`artifact_final_replaced:${label}`);
    assertAncestorIdentityChain(ancestors, label);
    return { filePath: resolved, realpath: realpathSync(resolved), buffer, byteSha256: sha256(buffer), stat: before, ancestors };
  } finally { closeSync(fd); }
}
function revalidateSnapshot(snapshot, label) {
  assertAncestorIdentityChain(snapshot.ancestors, label);
  const current = lstatSync(snapshot.filePath, { bigint: true });
  if (current.isSymbolicLink() || !current.isFile() || !sameSnapshotState(snapshot.stat, current)) throw new Error(`artifact_replaced_after_read:${label}`);
  const resolved = realpathSync(snapshot.filePath); const resolvedStatus = statSync(resolved, { bigint: true });
  if (resolved !== snapshot.realpath || !sameSnapshotState(snapshot.stat, resolvedStatus)) throw new Error(`artifact_realpath_rebound:${label}`);
  assertAncestorIdentityChain(snapshot.ancestors, label);
}
function parseJsonBuffer(buffer, label) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`bom_forbidden:${label}`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch (error) { throw new Error(`utf8_invalid:${label}:${error.message}`); }
  assertNoDuplicateJsonKeys(text, label);
  try { return JSON.parse(text); } catch (error) { throw new Error(`json_invalid:${label}:${error.message}`); }
}
function assertNoDuplicateJsonKeys(text, label) {
  let cursor = 0;
  const whitespace = () => { while (cursor < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[cursor])) cursor += 1; };
  const stringToken = () => {
    if (text[cursor] !== '"') throw new Error(`json_invalid:${label}:string_expected`);
    const start = cursor; cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") { cursor += 2; continue; }
      if (text[cursor] === '"') { cursor += 1; break; }
      cursor += 1;
    }
    const token = text.slice(start, cursor);
    try { return JSON.parse(token); } catch (error) { throw new Error(`json_invalid:${label}:${error.message}`); }
  };
  const value = () => {
    whitespace(); const first = text[cursor];
    if (first === '"') { stringToken(); return; }
    if (first === "{") {
      cursor += 1; whitespace(); const keys = new Set();
      if (text[cursor] === "}") { cursor += 1; return; }
      while (cursor < text.length) {
        whitespace(); const key = stringToken();
        if (keys.has(key)) throw new Error(`json_duplicate_key:${label}:${key}`);
        keys.add(key); whitespace();
        if (text[cursor] !== ":") throw new Error(`json_invalid:${label}:colon_expected`);
        cursor += 1; value(); whitespace();
        if (text[cursor] === "}") { cursor += 1; return; }
        if (text[cursor] !== ",") throw new Error(`json_invalid:${label}:object_separator_expected`);
        cursor += 1;
      }
      throw new Error(`json_invalid:${label}:unterminated_object`);
    }
    if (first === "[") {
      cursor += 1; whitespace();
      if (text[cursor] === "]") { cursor += 1; return; }
      while (cursor < text.length) {
        value(); whitespace();
        if (text[cursor] === "]") { cursor += 1; return; }
        if (text[cursor] !== ",") throw new Error(`json_invalid:${label}:array_separator_expected`);
        cursor += 1;
      }
      throw new Error(`json_invalid:${label}:unterminated_array`);
    }
    while (cursor < text.length && !/[\u0009\u000a\u000d\u0020,\]}]/u.test(text[cursor])) cursor += 1;
  };
  value(); whitespace();
  if (cursor !== text.length) throw new Error(`json_invalid:${label}:trailing_content`);
}
function parseJsonlBuffer(buffer, label) {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`bom_forbidden:${label}`);
  if (!buffer.length || buffer.at(-1) !== 0x0a || buffer.includes(0x0d)) throw new Error(`jsonl_serialization_invalid:${label}`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, -1)); } catch (error) { throw new Error(`utf8_invalid:${label}:${error.message}`); }
  const lines = text.split("\n");
  if (lines.some((line) => line.length === 0)) throw new Error(`jsonl_blank_line:${label}`);
  return lines.map((line, index) => {
    assertNoDuplicateJsonKeys(line, `${label}:${index + 1}`);
    try { return JSON.parse(line); } catch (error) { throw new Error(`jsonl_invalid:${label}:${index + 1}:${error.message}`); }
  });
}
function verifySelfHash(value, label) {
  if (!SHA_RE.test(value?.expectedCanonicalHash || "")) throw new Error(`self_hash_missing:${label}`);
  const actual = canonicalHash(value, true);
  if (actual !== value.expectedCanonicalHash) throw new Error(`self_hash_drift:${label}:${actual}`);
  return actual;
}

function validateSchemaValue(root, schema, value, at = "$") {
  if (schema === true || schema === undefined) return;
  if (schema === false) throw new Error(`schema_validation:${at}:false_schema`);
  if (schema.$ref) {
    const prefix = "#/$defs/"; const name = schema.$ref.startsWith(prefix) ? schema.$ref.slice(prefix.length) : "";
    if (!name || !root.$defs?.[name]) throw new Error(`schema_validation:${at}:bad_ref:${schema.$ref}`);
    validateSchemaValue(root, root.$defs[name], value, at);
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
    const matches = (type) => ({
      object: value !== null && typeof value === "object" && !Array.isArray(value), array: Array.isArray(value),
      string: typeof value === "string", integer: Number.isSafeInteger(value), number: typeof value === "number" && Number.isFinite(value),
      boolean: typeof value === "boolean", null: value === null,
    })[type];
    if (!types.some(matches)) throw new Error(`schema_validation:${at}:type:${types.join("|")}`);
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
function validateDef(schema, name, value, at) {
  if (!schema.$defs?.[name]) throw new Error(`schema_definition_missing:${name}`);
  validateSchemaValue(schema, schema.$defs[name], value, at);
}

function loadJsonDependency(logicalPath, label, expectedCanonicalSha256, omitExpected = false) {
  const snapshot = snapshotFile(repoPath(logicalPath), label);
  const value = parseJsonBuffer(snapshot.buffer, label);
  const canonicalSha256 = canonicalHash(value, omitExpected);
  if (canonicalSha256 !== expectedCanonicalSha256) throw new Error(`dependency_hash_drift:${label}:${canonicalSha256}:${expectedCanonicalSha256}`);
  if (omitExpected) verifySelfHash(value, label);
  return { logicalPath, snapshot, value, canonicalSha256 };
}
function canonicalDescriptor(item) {
  return { path: item.logicalPath, canonicalSha256: item.canonicalSha256, byteSha256: item.snapshot.byteSha256 };
}
function byteDescriptor(logicalPath, snapshot) { return { path: logicalPath, byteSha256: snapshot.byteSha256 }; }
function assertAuthoringSchemaContract(item) {
  const { value: schema, snapshot } = item;
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || !stableEqual(schema.oneOf, [{ $ref: "#/$defs/review" }, { $ref: "#/$defs/adjudication" }])) throw new Error("authoring_schema_root_contract_drift");
  const review = schema.$defs?.review; const adjudication = schema.$defs?.adjudication;
  if (review?.properties?.artifactType?.const !== "sam-goal-manual-review-v3" || review?.properties?.schemaVersion?.const !== 3
    || !stableEqual(review?.properties?.role?.enum, ["first", "second"])) throw new Error("authoring_schema_review_contract_drift");
  if (adjudication?.properties?.artifactType?.const !== "sam-goal-manual-adjudication-v3" || adjudication?.properties?.schemaVersion?.const !== 3
    || adjudication?.properties?.role?.const !== "adjudication") throw new Error("authoring_schema_adjudication_contract_drift");
  if (snapshot.byteSha256 !== ACCEPTED.authoringSchemaBytes || snapshot.buffer.length !== 31_479 || !snapshot.buffer.equals(Buffer.from(prettyJson(schema), "utf8"))) throw new Error("authoring_schema_serialization_drift");
}
function loadContext(includeTools = false) {
  const dependencies = {
    evaluationContract: loadJsonDependency(PATHS.evaluationContract, "evaluation_contract", ACCEPTED.evaluationContract, true),
    labelSchema: loadJsonDependency(PATHS.labelSchema, "label_schema", ACCEPTED.labelSchema),
    authoringSchema: loadJsonDependency(PATHS.authoringSchema, "authoring_schema", ACCEPTED.authoringSchema),
    teacherInputInventory: loadJsonDependency(PATHS.teacherInputInventory, "teacher_input_inventory", ACCEPTED.teacherInputInventory, true),
    teacherPolicy: loadJsonDependency(PATHS.teacherPolicy, "teacher_policy", ACCEPTED.teacherPolicy, true),
    teacherSchema: loadJsonDependency(PATHS.teacherSchema, "teacher_schema", ACCEPTED.teacherSchema),
    p0AnchorSchema: loadJsonDependency(PATHS.p0AnchorSchema, "p0_anchor_schema", ACCEPTED.p0AnchorSchema),
    p1AnchorSchema: loadJsonDependency(PATHS.p1AnchorSchema, "p1_anchor_schema", ACCEPTED.p1AnchorSchema),
    sourceContract: loadJsonDependency(PATHS.sourceContract, "source_contract", ACCEPTED.sourceContract, true),
    sourceSchema: loadJsonDependency(PATHS.sourceSchema, "source_schema", ACCEPTED.sourceSchema),
    sourceInventory: loadJsonDependency(PATHS.sourceInventory, "source_inventory", ACCEPTED.sourceInventory, true),
  };
  assertAuthoringSchemaContract(dependencies.authoringSchema);
  for (const name of ["labelSchema", "authoringSchema", "teacherSchema", "p0AnchorSchema", "p1AnchorSchema", "sourceSchema"]) {
    if (dependencies[name].value.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error(`dependency_draft_drift:${name}`);
  }
  const contract = dependencies.evaluationContract.value;
  if (contract.labelSchema?.path !== PATHS.labelSchema || contract.labelSchema?.canonicalSha256 !== ACCEPTED.labelSchema) throw new Error("evaluation_label_schema_binding_drift");
  const teacherBindings = {
    teacherInputInventory: [PATHS.teacherInputInventory, ACCEPTED.teacherInputInventory],
    teacherPolicy: [PATHS.teacherPolicy, ACCEPTED.teacherPolicy], teacherSchema: [PATHS.teacherSchema, ACCEPTED.teacherSchema],
    p0AnchorSchema: [PATHS.p0AnchorSchema, ACCEPTED.p0AnchorSchema], p1AnchorSchema: [PATHS.p1AnchorSchema, ACCEPTED.p1AnchorSchema],
  };
  for (const [name, [bindingPath, hash]] of Object.entries(teacherBindings)) {
    if (!stableEqual(contract.teacherBindings?.[name], { path: bindingPath, canonicalSha256: hash })) throw new Error(`teacher_binding_drift:${name}`);
  }
  const sourceBindings = {
    sourceContract: [PATHS.sourceContract, ACCEPTED.sourceContract], sourceSchema: [PATHS.sourceSchema, ACCEPTED.sourceSchema],
    sourceInventory: [PATHS.sourceInventory, ACCEPTED.sourceInventory],
  };
  for (const [name, [bindingPath, hash]] of Object.entries(sourceBindings)) {
    if (!stableEqual(contract.sourceBinding?.[name], { path: bindingPath, canonicalSha256: hash })) throw new Error(`source_binding_drift:${name}`);
  }
  const decoderSnapshot = snapshotFile(repoPath(PATHS.decoderManifest), "decoder_manifest");
  const decoderRows = parseJsonlBuffer(decoderSnapshot.buffer, "decoder_manifest");
  if (decoderSnapshot.byteSha256 !== ACCEPTED.decoderBytes || decoderRows.length !== 6_711 || canonicalHash(decoderRows) !== ACCEPTED.decoderRows) throw new Error("decoder_binding_drift");
  const decoderByClip = new Map();
  for (const [index, row] of decoderRows.entries()) {
    validateDef(dependencies.labelSchema.value, "decoderRow", row, `decoder/${index}`);
    validateDef(dependencies.sourceSchema.value, "decoderRow", row, `sourceDecoder/${index}`);
    if (!decoderByClip.has(row.clipId)) decoderByClip.set(row.clipId, []);
    decoderByClip.get(row.clipId).push(row);
  }
  const paired = contract.sourceBinding?.paired || [];
  if (paired.length !== 7 || !stableEqual(paired.map((entry) => entry.clipId), dependencies.sourceInventory.value.paired.map((entry) => entry.clipId))) throw new Error("paired_source_order_drift");
  for (const clip of paired) {
    const rows = decoderByClip.get(clip.clipId) || [];
    if (rows.length !== clip.rows || rows.some((row, index) => row.sourceFrameIndex !== index || row.loopEpoch !== 0 || row.decodeStatus !== "decoded" || row.decodeReason !== null)) throw new Error(`decoder_clip_drift:${clip.clipId}`);
    if (rows[0]?.ptsTicks !== clip.startPtsTicks || `${BigInt(rows.at(-1)?.ptsTicks || "0") + 1n}` !== clip.endPtsTicksExclusive) throw new Error(`decoder_clip_pts_drift:${clip.clipId}`);
  }
  if (decoderByClip.size !== 7 || decoderByClip.has("jujae-full")) throw new Error("decoder_source_set_drift");
  const decoderBinding = contract.sourceBinding?.decoderManifest;
  if (!stableEqual(decoderBinding, { path: PATHS.decoderManifest, rowCount: 6_711, byteSha256: ACCEPTED.decoderBytes, canonicalRowsSha256: ACCEPTED.decoderRows })) throw new Error("decoder_contract_binding_drift");
  const sources = dependencies.sourceInventory.value.paired.map(({ clipId, video }) => ({ clipId, path: video.path, bytes: video.bytes, sha256: video.sha256 }));
  const sourceBinding = {
    evaluationContractCanonicalSha256: ACCEPTED.evaluationContract,
    labelSchemaCanonicalSha256: ACCEPTED.labelSchema,
    authoringSchemaCanonicalSha256: ACCEPTED.authoringSchema,
    teacherInputInventoryCanonicalSha256: ACCEPTED.teacherInputInventory,
    teacherPolicyCanonicalSha256: ACCEPTED.teacherPolicy,
    teacherSchemaCanonicalSha256: ACCEPTED.teacherSchema,
    p0AnchorSchemaCanonicalSha256: ACCEPTED.p0AnchorSchema,
    p1AnchorSchemaCanonicalSha256: ACCEPTED.p1AnchorSchema,
    sourceContractCanonicalSha256: ACCEPTED.sourceContract,
    sourceSchemaCanonicalSha256: ACCEPTED.sourceSchema,
    sourceInventoryCanonicalSha256: ACCEPTED.sourceInventory,
    decoderByteSha256: ACCEPTED.decoderBytes,
    decoderCanonicalRowsSha256: ACCEPTED.decoderRows,
    decoderRowCount: 6_711,
    sources,
  };
  const tools = {};
  if (includeTools) {
    tools.manualCompiler = snapshotFile(repoPath(PATHS.manualCompiler), "manual_compiler");
    assertNormalizedSelf(tools.manualCompiler.buffer);
    tools.labelAuditor = snapshotFile(repoPath(PATHS.labelAuditor), "label_auditor");
    if (tools.labelAuditor.byteSha256 !== ACCEPTED.labelAuditorBytes) throw new Error(`dependency_byte_drift:label_auditor:${tools.labelAuditor.byteSha256}`);
  }
  return {
    dependencies, tools, contract, labelSchema: dependencies.labelSchema.value, authoringSchema: dependencies.authoringSchema.value,
    p0AnchorSchema: dependencies.p0AnchorSchema.value, decoderSnapshot, decoderRows, decoderByClip, paired, sourceBinding,
  };
}

function scanForbiddenAuthoring(value, at) {
  const forbiddenKeys = ["sam", "detector", "candidatecount", "live", "student", "avatar", "solver", "retarget", "latency", "report", "error", "automated", "generatedat", "auditedat", "elapsedms", "reviewedat", "timestamp", "wallclock"];
  const forbiddenValues = [
    "live", "student", "avatar", "trackeroutput", "retargetoutput", "solveroutput", "modeloutput",
    "samcandidate", "samoutput", "samprediction", "detector", "automated",
  ];
  const normalize = (item) => String(item).toLowerCase().replace(/[^a-z0-9]/gu, "");
  const visit = (child, cursor, keyName = "") => {
    if (Array.isArray(child)) { child.forEach((entry, index) => visit(entry, `${cursor}/${index}`, keyName)); return; }
    if (child && typeof child === "object") {
      for (const [key, nested] of Object.entries(child)) {
        const token = normalize(key);
        if (forbiddenKeys.some((entry) => token.includes(entry))) throw new Error(`forbidden_authoring_key:${cursor}/${key}`);
        visit(nested, `${cursor}/${key}`, key);
      }
    } else if (typeof child === "string" && keyName !== "artifactType") {
      const token = normalize(child);
      if (forbiddenValues.some((entry) => token.includes(entry))) throw new Error(`forbidden_authoring_value:${cursor}`);
    }
  };
  visit(value, at);
}
function assertCanonicalStrings(values, allowed, label) {
  if (!Array.isArray(values) || values.length === 0 || new Set(values).size !== values.length) throw new Error(`canonical_array_invalid:${label}`);
  if (values.some((entry) => !allowed.has(entry))) throw new Error(`canonical_array_open_value:${label}`);
  const sorted = [...values].sort(compareUtf8);
  if (!stableEqual(values, sorted)) throw new Error(`canonical_array_order:${label}`);
}
function identity(row) {
  return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch };
}
function frameKey(clipId, sourceFrameIndex) { return `${clipId}\u0000${sourceFrameIndex}`; }
function ptsBoundary(rows, frameIndex) { return frameIndex === rows.length ? `${BigInt(rows.at(-1).ptsTicks) + 1n}` : rows[frameIndex].ptsTicks; }

function assertManualTruth(authored, label) {
  const state = authored.state || authored; const subject = state.subjectSelection;
  if (state.presence === "absent") {
    if (state.personState !== "absent" || subject.state !== "absent" || state.contact.left !== "unknown" || state.contact.right !== "unknown") throw new Error(`truth_absent:${label}`);
    if ([...Object.values(state.handObservability), ...Object.values(state.endpointObservability)].some((entry) => entry !== "not_observable")) throw new Error(`truth_absent_observable:${label}`);
    if (Object.values(state.occlusion).some((entry) => !["out_of_frame", "unknown"].includes(entry))) throw new Error(`truth_absent_pixels:${label}`);
  }
  if (state.personState === "single_target" && subject.state !== "selected") throw new Error(`truth_single_target:${label}`);
  if (state.personState === "multiple_people" && !(subject.state === "ambiguous" || (subject.state === "selected" && subject.anchor !== null))) throw new Error(`truth_multiple_people:${label}`);
  if (subject.state === "selected") {
    if (typeof subject.manualTargetId !== "string" || subject.manualTargetId.length === 0) throw new Error(`truth_subject_target:${label}`);
  } else if (subject.manualTargetId !== null || subject.anchor !== null) throw new Error(`truth_subject_payload:${label}`);
  for (const side of ["left", "right"]) {
    if (state.contact[side] !== "unknown" && !(state.presence === "present" && state.occlusion[`${side}Foot`] === "observable" && state.endpointObservability[`${side}Ankle`] === "observable")) throw new Error(`truth_contact:${label}:${side}`);
    if (state.handObservability[side] === "observable" && !(["observable", "partial"].includes(state.occlusion[`${side}Hand`]) && state.endpointObservability[`${side}Wrist`] === "observable")) throw new Error(`truth_hand:${label}:${side}`);
  }
  const endpointParts = { leftWrist: "leftHand", rightWrist: "rightHand", leftAnkle: "leftFoot", rightAnkle: "rightFoot", head: "body" };
  for (const [endpoint, part] of Object.entries(endpointParts)) if (state.endpointObservability[endpoint] === "observable" && !["observable", "partial"].includes(state.occlusion[part])) throw new Error(`truth_endpoint:${label}:${endpoint}`);
}

function normalizeWindows(windows, context, label) {
  const purpose = new Set(context.contract.manualWindows.purposeTags); const scenario = new Set(context.contract.scenarioTaxonomy);
  const clipOrdinal = new Map(context.paired.map((clip, index) => [clip.clipId, index])); const ids = new Set(); const base = new Set();
  const normalized = windows.map((window, index) => {
    const identityKey = `${window.clipId}\u0000${window.windowId}`;
    if (ids.has(identityKey)) throw new Error(`window_duplicate:${label}:${window.clipId}:${window.windowId}`);
    ids.add(identityKey);
    const rows = context.decoderByClip.get(window.clipId);
    if (!rows || window.startFrameIndex < 0 || window.endFrameIndexExclusive > rows.length || window.startFrameIndex >= window.endFrameIndexExclusive) throw new Error(`window_boundary:${label}:${index}`);
    assertCanonicalStrings(window.purposeTags, purpose, `${label}/${window.windowId}/purposeTags`);
    assertCanonicalStrings(window.scenarioTags, scenario, `${label}/${window.windowId}/scenarioTags`);
    if (window.purposeTags.includes(context.contract.manualWindows.basePurposeTag)) {
      if (window.purposeTags.length !== 1 || window.startFrameIndex !== 0 || window.endFrameIndexExclusive !== rows.length || base.has(window.clipId)) throw new Error(`window_base_invalid:${label}:${window.clipId}`);
      base.add(window.clipId);
    }
    return stableValue(window);
  });
  if (base.size !== 7 || context.paired.some((clip) => !base.has(clip.clipId))) throw new Error(`window_base_coverage:${label}:${base.size}`);
  normalized.sort((left, right) => clipOrdinal.get(left.clipId) - clipOrdinal.get(right.clipId)
    || left.startFrameIndex - right.startFrameIndex || left.endFrameIndexExclusive - right.endFrameIndexExclusive || compareUtf8(left.windowId, right.windowId));
  return normalized;
}
function windowMemberships(windows, context) {
  const byClip = new Map(context.paired.map((clip) => [clip.clipId, windows.filter((window) => window.clipId === clip.clipId)]));
  const memberships = new Map();
  for (const row of context.decoderRows) {
    const ids = byClip.get(row.clipId).filter((window) => row.sourceFrameIndex >= window.startFrameIndex && row.sourceFrameIndex < window.endFrameIndexExclusive).map((window) => window.windowId).sort(compareUtf8);
    memberships.set(frameKey(row.clipId, row.sourceFrameIndex), ids);
  }
  return memberships;
}
function materializeReviewClips(clips, windows, context, label) {
  const clipOrder = clips.map((clip) => clip.clipId); const acceptedClipOrder = context.paired.map((clip) => clip.clipId);
  if (!stableEqual(clipOrder, acceptedClipOrder)) {
    const mismatch = Array.from({ length: Math.max(clipOrder.length, acceptedClipOrder.length) }, (_, index) => index)
      .find((index) => clipOrder[index] !== acceptedClipOrder[index]);
    throw new Error(`review_clip_order:${label}:${mismatch}:${clipOrder[mismatch] ?? "missing"}:${acceptedClipOrder[mismatch] ?? "missing"}`);
  }
  const scenario = new Set(context.contract.scenarioTaxonomy); const memberships = windowMemberships(windows, context);
  const values = new Map(); const intervalsByClip = new Map(); const seen = new Set(); const targetsByClip = new Map();
  for (const clip of clips) {
    if (seen.has(clip.clipId)) throw new Error(`review_clip_duplicate:${label}:${clip.clipId}`);
    seen.add(clip.clipId); const rows = context.decoderByClip.get(clip.clipId);
    if (!rows) throw new Error(`review_clip_unknown:${label}:${clip.clipId}`);
    const intervals = clip.intervals.map(stableValue);
    let cursor = 0;
    for (const [index, interval] of intervals.entries()) {
      if (interval.startFrameIndex !== cursor) throw new Error(`review_interval_gap_or_overlap:${label}:${clip.clipId}:${index}:${cursor}`);
      if (interval.endFrameIndexExclusive <= interval.startFrameIndex || interval.endFrameIndexExclusive > rows.length) throw new Error(`review_interval_boundary:${label}:${clip.clipId}:${index}`);
      assertCanonicalStrings(interval.scenarios, scenario, `${label}/${clip.clipId}/${index}/scenarios`); assertManualTruth(interval, `${label}/${clip.clipId}/${index}`);
      const membershipSet = new Set(rows.slice(interval.startFrameIndex, interval.endFrameIndexExclusive).map((row) => stableStringify(memberships.get(frameKey(row.clipId, row.sourceFrameIndex)))));
      if (membershipSet.size !== 1) throw new Error(`review_interval_membership_crossing:${label}:${clip.clipId}:${index}`);
      const authored = { scenarios: stableValue(interval.scenarios), state: stableValue(interval.state) };
      for (let frame = interval.startFrameIndex; frame < interval.endFrameIndexExclusive; frame += 1) values.set(frameKey(clip.clipId, frame), authored);
      if (interval.state.subjectSelection.state === "selected") {
        if (!targetsByClip.has(clip.clipId)) targetsByClip.set(clip.clipId, new Set());
        targetsByClip.get(clip.clipId).add(interval.state.subjectSelection.manualTargetId);
      }
      cursor = interval.endFrameIndexExclusive;
    }
    if (cursor !== rows.length) throw new Error(`review_interval_terminal_gap:${label}:${clip.clipId}:${cursor}`);
    intervalsByClip.set(clip.clipId, intervals);
  }
  if (seen.size !== 7 || values.size !== 6_711 || context.paired.some((clip) => !seen.has(clip.clipId))) throw new Error(`review_coverage:${label}:${seen.size}:${values.size}`);
  for (const [clipId, targets] of targetsByClip) if (targets.size > 1) throw new Error(`review_target_unstable:${label}:${clipId}`);
  return { values, intervalsByClip, memberships };
}

function reviewEvidence(materialized, context) {
  const support = Object.fromEntries(["leftHand", "rightHand", "head", "leftPlanted", "leftMoving", "rightPlanted", "rightMoving"].map((name) => [name, { frames: 0, clips: new Set() }]));
  for (const row of context.decoderRows) {
    const state = materialized.values.get(frameKey(row.clipId, row.sourceFrameIndex)).state;
    for (const side of ["left", "right"]) {
      if (state.presence === "present" && ["observable", "partial"].includes(state.occlusion.body) && ["observable", "partial"].includes(state.occlusion[`${side}Hand`]) && state.handObservability[side] === "observable" && state.endpointObservability[`${side}Wrist`] === "observable") {
        support[`${side}Hand`].frames += 1; support[`${side}Hand`].clips.add(row.clipId);
      }
      const contact = state.contact[side];
      if (["planted", "moving"].includes(contact) && state.presence === "present" && ["observable", "partial"].includes(state.occlusion.body) && state.occlusion[`${side}Foot`] === "observable" && state.endpointObservability[`${side}Ankle`] === "observable") {
        const cell = support[`${side}${contact[0].toUpperCase()}${contact.slice(1)}`]; cell.frames += 1; cell.clips.add(row.clipId);
      }
    }
    if (state.presence === "present" && ["observable", "partial"].includes(state.occlusion.body) && state.endpointObservability.head === "observable") { support.head.frames += 1; support.head.clips.add(row.clipId); }
  }
  for (const clip of context.paired) {
    const rows = context.decoderByClip.get(clip.clipId);
    for (const side of ["left", "right"]) {
      let start = null;
      const finish = (endExclusive) => {
        if (start === null) return;
        const first = rows[start]; const last = rows[endExclusive - 1];
        const elapsed = (BigInt(last.ptsTicks) - BigInt(first.ptsTicks)) * BigInt(first.timeBase.numerator) * 1_000n;
        if (elapsed < 100n * BigInt(first.timeBase.denominator)) throw new Error(`review_planted_confirmation:${clip.clipId}:${side}:${start}:${endExclusive}`);
        start = null;
      };
      for (let index = 0; index < rows.length; index += 1) {
        const state = materialized.values.get(frameKey(clip.clipId, index)).state.contact[side];
        if (state === "planted") { if (start === null) start = index; } else finish(index);
      }
      finish(rows.length);
    }
  }
  for (const name of Object.keys(support)) if (support[name].frames < 300 || support[name].clips.size < 2) throw new Error(`review_support_floor:${name}:${support[name].frames}:${support[name].clips.size}`);
  const events = [];
  for (const clip of context.contract.clipInventory.filter((entry) => entry.role === "hard_test")) {
    const rows = context.decoderByClip.get(clip.clipId); let index = 0;
    const stateAt = (position) => materialized.values.get(frameKey(clip.clipId, position)).state;
    const bad = (state) => state.presence === "absent" || state.presence === "unknown" || ["ambiguous", "unknown"].includes(state.subjectSelection.state) || ["occluded", "out_of_frame", "unknown"].includes(state.occlusion.body);
    const reliable = (state) => state.presence === "present" && state.subjectSelection.state === "selected" && ["observable", "partial"].includes(state.occlusion.body);
    while (index < rows.length) {
      if (!bad(stateAt(index))) { index += 1; continue; }
      const start = index; while (index < rows.length && bad(stateAt(index))) index += 1;
      if (index >= rows.length) break;
      let reliableIndex = index; while (reliableIndex < rows.length && !reliable(stateAt(reliableIndex))) reliableIndex += 1;
      if (reliableIndex >= rows.length) break;
      const delta = BigInt(rows[index].ptsTicks) - BigInt(rows[start].ptsTicks);
      if (delta * BigInt(rows[start].timeBase.numerator) * 1_000n >= BigInt(context.contract.reacquirePolicy.minimumUnreliableIntervalMs) * BigInt(rows[start].timeBase.denominator)) events.push({ clipId: clip.clipId, startFrameIndex: start, reliableFrameIndex: reliableIndex });
    }
  }
  if (events.length < context.contract.reacquirePolicy.minimumP0CandidateEvents || new Set(events.map((event) => event.clipId)).size < context.contract.reacquirePolicy.minimumHardTestClips) throw new Error(`review_reacquire_coverage:${events.length}:${new Set(events.map((event) => event.clipId)).size}`);
  return {
    support: Object.fromEntries(Object.entries(support).map(([name, cell]) => [name, { frames: cell.frames, clips: [...cell.clips].sort(compareUtf8) }])),
    reacquireCandidates: events,
  };
}
function validateReviewSnapshot(snapshot, expectedRole, expectedReviewer, context, label) {
  const review = parseJsonBuffer(snapshot.buffer, label); scanForbiddenAuthoring(review, label);
  validateDef(context.authoringSchema, "review", review, label); const canonicalSha256 = verifySelfHash(review, label);
  if (review.role !== expectedRole) throw new Error(`review_role_mismatch:${label}:${review.role}:${expectedRole}`);
  if (expectedReviewer && review.reviewerPseudonymSha256 !== expectedReviewer) throw new Error(`reviewer_pseudonym_mismatch:${label}`);
  if (!stableEqual(review.sourceBinding, context.sourceBinding)) throw new Error(`review_source_binding_drift:${label}`);
  const windows = normalizeWindows(review.windows, context, `${label}/windows`);
  const materialized = materializeReviewClips(review.clips, windows, context, label); const evidence = reviewEvidence(materialized, context);
  return { snapshot, review, canonicalSha256, byteSha256: snapshot.byteSha256, windows, materialized, evidence };
}

const MANUAL_LEAVES = Object.freeze([
  ["scenarios", "scenario-array"], ["state/presence", "presence"], ["state/personState", "person-state"],
  ...["body", "leftFoot", "rightFoot", "leftHand", "rightHand"].map((name) => [`state/occlusion/${name}`, "occlusion-state"]),
  ...["left", "right"].map((name) => [`state/contact/${name}`, "contact-state"]),
  ...["left", "right"].map((name) => [`state/handObservability/${name}`, "hand-observability-state"]),
  ...["leftWrist", "rightWrist", "leftAnkle", "rightAnkle", "head"].map((name) => [`state/endpointObservability/${name}`, "endpoint-observability-state"]),
  ["state/subjectSelection/state", "subject-state"], ["state/subjectSelection/manualTargetId", "manual-target-id"], ["state/subjectSelection/anchor", "anchor"],
]);
function nestedValue(value, slashPath) { return slashPath.split("/").reduce((current, key) => current?.[key], value); }
function setNestedValue(value, slashPath, replacement) {
  const keys = slashPath.split("/"); let cursor = value;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)] = stableValue(replacement);
}
function pointerToken(value) { return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1"); }
function sortedPathEntries(entries) { return [...entries].sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.valueType, right.valueType)); }
function assertCanonicalPathEntries(entries, label) {
  const sorted = sortedPathEntries(entries);
  if (!stableEqual(entries, sorted)) throw new Error(`adjudication_path_order:${label}`);
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error(`adjudication_duplicate_path:${label}`);
}

function expectedDisagreements(first, second, context) {
  const disagreements = []; const segments = [];
  for (const clip of context.paired) {
    const boundaries = new Set([0, clip.rows]);
    for (const interval of [...first.materialized.intervalsByClip.get(clip.clipId), ...second.materialized.intervalsByClip.get(clip.clipId)]) { boundaries.add(interval.startFrameIndex); boundaries.add(interval.endFrameIndexExclusive); }
    const ordered = [...boundaries].sort((left, right) => left - right);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index]; const end = ordered[index + 1];
      const left = first.materialized.values.get(frameKey(clip.clipId, start)); const right = second.materialized.values.get(frameKey(clip.clipId, start));
      const prefix = `/clips/${pointerToken(clip.clipId)}/segments/${start}-${end}/`;
      const paths = [];
      for (const [leaf, valueType] of MANUAL_LEAVES) {
        const reviewAValue = nestedValue(left, leaf); const reviewBValue = nestedValue(right, leaf);
        if (!stableEqual(reviewAValue, reviewBValue)) {
          const suffix = leaf.startsWith("state/") ? leaf.slice("state/".length) : leaf;
          const entry = { path: `${prefix}${suffix}`, valueType, reviewAValue: stableValue(reviewAValue), reviewBValue: stableValue(reviewBValue) };
          disagreements.push(entry); paths.push({ leaf, ...entry });
        }
      }
      segments.push({ clipId: clip.clipId, start, end, left, right, paths });
    }
  }
  const windowKey = (window) => `${window.clipId}\u0000${window.windowId}`;
  const windowsA = new Map(first.windows.map((window) => [windowKey(window), window])); const windowsB = new Map(second.windows.map((window) => [windowKey(window), window]));
  const windowPlans = [];
  for (const key of [...new Set([...windowsA.keys(), ...windowsB.keys()])].sort(compareUtf8)) {
    const left = windowsA.get(key) || null; const right = windowsB.get(key) || null; const windowId = (left || right).windowId;
    if (!left || !right) {
      const clipId = (left || right).clipId; const entry = { path: `/clips/${pointerToken(clipId)}/windowsById/${pointerToken(windowId)}`, valueType: "window-or-null", reviewAValue: left, reviewBValue: right };
      disagreements.push(entry); windowPlans.push({ windowId, clipId, left, right, parent: entry, children: [] }); continue;
    }
    if (left.clipId !== right.clipId) throw new Error(`window_clip_disagreement_unaddressable:${windowId}`);
    const prefix = `/clips/${pointerToken(left.clipId)}/windowsById/${pointerToken(windowId)}`; const children = [];
    for (const [field, valueType] of [["startFrameIndex", "source-frame-index"], ["endFrameIndexExclusive", "source-frame-index-exclusive"], ["purposeTags", "purpose-array"], ["scenarioTags", "scenario-array"]]) {
      if (!stableEqual(left[field], right[field])) { const entry = { path: `${prefix}/${field}`, valueType, reviewAValue: left[field], reviewBValue: right[field] }; disagreements.push(entry); children.push({ field, ...entry }); }
    }
    windowPlans.push({ windowId, clipId: left.clipId, left, right, parent: null, children });
  }
  return { disagreements: sortedPathEntries(disagreements), segments, windowPlans };
}

function differenceFields(left, right, prefix = "") {
  if (stableEqual(left, right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return [prefix];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareUtf8).flatMap((key) => differenceFields(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
function validateAdjudicationSnapshot(snapshot, first, second, context) {
  const value = parseJsonBuffer(snapshot.buffer, "adjudication"); scanForbiddenAuthoring(value, "adjudication");
  validateDef(context.authoringSchema, "adjudication", value, "adjudication"); const canonicalSha256 = verifySelfHash(value, "adjudication");
  const expectedBindings = {
    reviewACanonicalSha256: first.canonicalSha256, reviewAByteSha256: first.byteSha256, reviewAPseudonymSha256: first.review.reviewerPseudonymSha256,
    reviewBCanonicalSha256: second.canonicalSha256, reviewBByteSha256: second.byteSha256, reviewBPseudonymSha256: second.review.reviewerPseudonymSha256,
  };
  for (const [key, expected] of Object.entries(expectedBindings)) if (value[key] !== expected) throw new Error(`adjudication_review_binding:${key}`);
  const actors = [first.review.reviewerPseudonymSha256, second.review.reviewerPseudonymSha256, value.adjudicatorPseudonymSha256];
  if (new Set(actors).size !== 3) throw new Error("sealed_actor_alias");
  const expected = expectedDisagreements(first, second, context); assertCanonicalPathEntries(value.disagreements, "disagreements"); assertCanonicalPathEntries(value.decisions, "decisions");
  if (!stableEqual(value.disagreements, expected.disagreements)) throw new Error("adjudication_disagreement_set_drift");
  const expectedKeys = expected.disagreements.map(({ path: disagreementPath, valueType }) => `${disagreementPath}\u0000${valueType}`);
  const decisionKeys = value.decisions.map(({ path: decisionPath, valueType }) => `${decisionPath}\u0000${valueType}`);
  if (!stableEqual(decisionKeys, expectedKeys)) throw new Error("adjudication_decision_set_drift");
  for (const [index, decision] of value.decisions.entries()) {
    if (decision.valueType === "scenario-array") assertCanonicalStrings(decision.value, new Set(context.contract.scenarioTaxonomy), `adjudication/decisions/${index}`);
    if (decision.valueType === "purpose-array") assertCanonicalStrings(decision.value, new Set(context.contract.manualWindows.purposeTags), `adjudication/decisions/${index}`);
  }
  const decisions = new Map(value.decisions.map((decision) => [decision.path, decision])); const selectedSegments = [];
  for (const segment of expected.segments) {
    const selected = stableValue(segment.left);
    for (const entry of segment.paths) setNestedValue(selected, entry.leaf, decisions.get(entry.path).value);
    assertCanonicalStrings(selected.scenarios, new Set(context.contract.scenarioTaxonomy), `adjudication_final:${segment.clipId}:${segment.start}-${segment.end}:scenarios`);
    assertManualTruth(selected, `adjudication_final:${segment.clipId}:${segment.start}-${segment.end}`);
    selectedSegments.push({ clipId: segment.clipId, start: segment.start, end: segment.end, selected });
  }
  const finalWindows = [];
  for (const plan of expected.windowPlans) {
    let selected;
    if (plan.parent) selected = stableValue(decisions.get(plan.parent.path).value);
    else {
      selected = stableValue(plan.left);
      for (const child of plan.children) selected[child.field] = stableValue(decisions.get(child.path).value);
    }
    if (selected !== null) {
      if (selected.windowId !== plan.windowId || selected.clipId !== plan.clipId) throw new Error(`adjudication_window_identity_drift:${plan.windowId}`);
      finalWindows.push(selected);
    }
  }
  const normalizedFinalWindows = normalizeWindows(finalWindows, context, "adjudication/finalWindows");
  const authoredWindows = normalizeWindows(value.windows, context, "adjudication/windows");
  if (!stableEqual(authoredWindows, normalizedFinalWindows)) throw new Error("adjudication_windows_drift");
  const finalMemberships = windowMemberships(normalizedFinalWindows, context);
  const finalWindowsByClip = new Map(context.paired.map((clip) => [clip.clipId, normalizedFinalWindows.filter((window) => window.clipId === clip.clipId)]));
  const finalSegments = [];
  for (const segment of selectedSegments) {
    const boundaries = new Set([segment.start, segment.end]);
    for (const window of finalWindowsByClip.get(segment.clipId)) {
      if (window.startFrameIndex > segment.start && window.startFrameIndex < segment.end) boundaries.add(window.startFrameIndex);
      if (window.endFrameIndexExclusive > segment.start && window.endFrameIndexExclusive < segment.end) boundaries.add(window.endFrameIndexExclusive);
    }
    const ordered = [...boundaries].sort((left, right) => left - right);
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index]; const end = ordered[index + 1];
      const membershipValues = [];
      for (let frame = start; frame < end; frame += 1) membershipValues.push(finalMemberships.get(frameKey(segment.clipId, frame)));
      const membershipSet = new Set(membershipValues.map(stableStringify));
      if (membershipSet.size !== 1) throw new Error(`adjudication_final_membership_crossing:${segment.clipId}:${start}-${end}`);
      const projected = stableValue(segment.selected);
      finalSegments.push({
        clipId: segment.clipId, start, end, originStart: segment.start, originEnd: segment.end,
        memberships: stableValue(membershipValues[0]), selected: projected,
      });
    }
  }
  const final = new Map();
  for (const segment of finalSegments) {
    for (let frame = segment.start; frame < segment.end; frame += 1) final.set(frameKey(segment.clipId, frame), segment.selected);
  }
  if (final.size !== 6_711) throw new Error(`adjudication_final_coverage:${final.size}`);
  const targetsByClip = new Map();
  for (const row of context.decoderRows) {
    const subject = final.get(frameKey(row.clipId, row.sourceFrameIndex)).state.subjectSelection;
    if (subject.state === "selected") { if (!targetsByClip.has(row.clipId)) targetsByClip.set(row.clipId, new Set()); targetsByClip.get(row.clipId).add(subject.manualTargetId); }
  }
  for (const [clipId, targets] of targetsByClip) if (targets.size > 1) throw new Error(`adjudication_target_unstable:${clipId}`);
  return { snapshot, value, canonicalSha256, byteSha256: snapshot.byteSha256, final, finalSegments, windows: normalizedFinalWindows, expected, decisions };
}

function compileFinalSegmentTrace(finalSegments) {
  const descriptors = finalSegments.map((segment) => ({
    clipId: segment.clipId,
    start: segment.start,
    end: segment.end,
    originStart: segment.originStart,
    originEnd: segment.originEnd,
    memberships: stableValue(segment.memberships),
    selectedCanonicalSha256: canonicalHash(segment.selected, false),
  }));
  const coveredRows = descriptors.reduce((sum, descriptor) => sum + descriptor.end - descriptor.start, 0);
  if (coveredRows !== 6_711) throw new Error(`final_segment_trace_coverage:${coveredRows}`);
  return {
    descriptors,
    childCount: descriptors.length,
    coveredRows,
    descriptorCanonicalSha256: canonicalHash(descriptors, false),
  };
}

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
function computeAgreement(first, second, context) {
  const presence = []; const contact = []; const observability = [];
  const observabilityFields = [
    "occlusion/body", "occlusion/leftFoot", "occlusion/rightFoot", "occlusion/leftHand", "occlusion/rightHand",
    "handObservability/left", "handObservability/right", "endpointObservability/leftWrist", "endpointObservability/rightWrist",
    "endpointObservability/leftAnkle", "endpointObservability/rightAnkle", "endpointObservability/head",
  ];
  for (const clip of context.paired) {
    const a = context.decoderByClip.get(clip.clipId).map((row) => first.materialized.values.get(frameKey(row.clipId, row.sourceFrameIndex)).state);
    const b = context.decoderByClip.get(clip.clipId).map((row) => second.materialized.values.get(frameKey(row.clipId, row.sourceFrameIndex)).state);
    presence.push(cohenKappa(a.map((state) => `${state.presence}|${state.personState}`), b.map((state) => `${state.presence}|${state.personState}`)));
    for (const side of ["left", "right"]) contact.push(cohenKappa(a.map((state) => state.contact[side]), b.map((state) => state.contact[side])));
    for (const field of observabilityFields) observability.push(cohenKappa(a.map((state) => nestedValue(state, field)), b.map((state) => nestedValue(state, field))));
  }
  const average = (values) => values.reduce((sum, entry) => sum + entry, 0) / values.length;
  const result = { presencePersonStateKappa: average(presence), contactKappa: average(contact), observabilityKappa: average(observability) };
  for (const [name, minimum] of Object.entries(context.contract.manualReview.agreement.minimum)) if (result[name] + 1e-12 < minimum) throw new Error(`agreement_below_floor:${name}:${result[name]}:${minimum}`);
  return result;
}

function pathInside(rootReal, targetReal) {
  const relative = path.relative(rootReal, targetReal);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function prepareAbsentDestination(input, label) {
  const destination = cliPath(input);
  try { lstatSync(destination); throw new Error(`${label}_exists:${destination}`); } catch (error) { if (error.message?.startsWith(`${label}_exists:`)) throw error; if (error.code !== "ENOENT") throw error; }
  const ancestors = ancestorIdentityChain(destination, label); const parent = path.dirname(destination);
  const parentStatus = lstatSync(parent, { bigint: true });
  if (parentStatus.isSymbolicLink() || !parentStatus.isDirectory()) throw new Error(`${label}_parent_invalid:${parent}`);
  const parentFd = openSync(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const fdStatus = fstatSync(parentFd, { bigint: true });
    if (!fdStatus.isDirectory() || !sameAncestorIdentity(ancestorIdentity(parentStatus), ancestorIdentity(fdStatus))) throw new Error(`${label}_parent_open_race:${parent}`);
    assertAncestorIdentityChain(ancestors, label);
    const parentReal = realpathSync(parent); const basename = path.basename(destination);
    const prospectiveReal = path.join(parentReal, basename);
    return { destination, basename, parent, parentReal, prospectiveReal, ancestors, parentIdentity: ancestorIdentity(fdStatus), parentFd };
  } catch (error) {
    closeSync(parentFd);
    throw error;
  }
}
function revalidateDestinationParent(prepared, label) {
  const held = fstatSync(prepared.parentFd, { bigint: true });
  if (!held.isDirectory() || !sameAncestorIdentity(prepared.parentIdentity, ancestorIdentity(held))) throw new Error(`${label}_parent_fd_replaced:${prepared.parent}`);
  assertAncestorIdentityChain(prepared.ancestors, label); const current = lstatSync(prepared.parent, { bigint: true });
  if (current.isSymbolicLink() || !current.isDirectory() || !sameAncestorIdentity(prepared.parentIdentity, ancestorIdentity(current)) || realpathSync(prepared.parent) !== prepared.parentReal) throw new Error(`${label}_parent_replaced:${prepared.parent}`);
}
function prepareLabelDirectory(input) {
  const labelDir = cliPath(input); const ancestors = ancestorIdentityChain(path.join(labelDir, "placeholder"), "label_dir");
  const status = lstatSync(labelDir, { bigint: true });
  if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`label_dir_invalid:${labelDir}`);
  assertAncestorIdentityChain(ancestors, "label_dir");
  const parent = path.dirname(labelDir); const parentStatus = lstatSync(parent, { bigint: true });
  const parentFd = openSync(parent, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const heldParent = fstatSync(parentFd, { bigint: true });
    if (!heldParent.isDirectory() || !sameAncestorIdentity(ancestorIdentity(parentStatus), ancestorIdentity(heldParent))) throw new Error("label_dir_parent_open_race");
    return {
      labelDir, labelDirReal: realpathSync(labelDir), ancestors, identity: ancestorIdentity(status), parent,
      basename: path.basename(labelDir), parentFd, parentIdentity: ancestorIdentity(heldParent), parentReal: realpathSync(parent),
    };
  } catch (error) {
    closeSync(parentFd);
    throw error;
  }
}
function revalidateLabelDirectory(prepared) {
  const heldParent = fstatSync(prepared.parentFd, { bigint: true });
  if (!heldParent.isDirectory() || !sameAncestorIdentity(prepared.parentIdentity, ancestorIdentity(heldParent))) throw new Error("label_dir_parent_fd_replaced");
  assertAncestorIdentityChain(prepared.ancestors, "label_dir"); const status = lstatSync(prepared.labelDir, { bigint: true });
  if (status.isSymbolicLink() || !status.isDirectory() || !sameAncestorIdentity(prepared.identity, ancestorIdentity(status)) || realpathSync(prepared.labelDir) !== prepared.labelDirReal) throw new Error("label_dir_replaced");
}
function closePrepared(prepared) {
  if (!prepared || prepared.parentFd === undefined || prepared.parentFd === null) return;
  try { closeSync(prepared.parentFd); } catch { /* already closed during unwind */ }
  prepared.parentFd = null;
}
function secureExternalSnapshot(input, label, excludedRootReal = "") {
  const snapshot = snapshotFile(cliPath(input), label, true);
  if (excludedRootReal && pathInside(excludedRootReal, snapshot.realpath)) throw new Error(`sealed_input_inside_pack:${label}`);
  return snapshot;
}
function assertDistinctSnapshots(namedSnapshots, code) {
  const realpaths = new Set(); const inodes = new Set();
  for (const [name, snapshot] of namedSnapshots) {
    const inode = `${snapshot.stat.dev}:${snapshot.stat.ino}`;
    if (realpaths.has(snapshot.realpath)) throw new Error(`${code}_realpath:${name}`);
    if (inodes.has(inode)) throw new Error(`${code}_inode:${name}`);
    realpaths.add(snapshot.realpath); inodes.add(inode);
  }
}
function loadSealedInputs(options, context, excludedRootReal = "") {
  const reviewASnapshot = secureExternalSnapshot(options.reviewA, "review_a", excludedRootReal);
  const reviewBSnapshot = secureExternalSnapshot(options.reviewB, "review_b", excludedRootReal);
  const adjudicationSnapshot = secureExternalSnapshot(options.adjudication, "adjudication", excludedRootReal);
  const snapshots = [["reviewA", reviewASnapshot], ["reviewB", reviewBSnapshot], ["adjudication", adjudicationSnapshot]];
  assertDistinctSnapshots(snapshots, "sealed_input_alias");
  if (new Set(snapshots.map(([, snapshot]) => snapshot.byteSha256)).size !== 3) throw new Error("sealed_byte_alias");
  const first = validateReviewSnapshot(reviewASnapshot, "first", "", context, "review_a");
  const second = validateReviewSnapshot(reviewBSnapshot, "second", "", context, "review_b");
  if (first.review.reviewerPseudonymSha256 === second.review.reviewerPseudonymSha256) throw new Error("reviewer_pseudonyms_not_distinct");
  const adjudication = validateAdjudicationSnapshot(adjudicationSnapshot, first, second, context);
  computeAgreement(first, second, context); reviewEvidence({ values: adjudication.final }, context);
  return { first, second, adjudication, snapshots };
}
function revalidateSealedInputs(inputs) { for (const [name, snapshot] of inputs.snapshots) revalidateSnapshot(snapshot, `sealed_${name}`); }

function generatedJson(value) { return Buffer.from(prettyJson(value), "utf8"); }
function generatedJsonDescriptor(descriptorPath, buffer) {
  const value = parseJsonBuffer(buffer, `generated:${descriptorPath}`);
  return { path: descriptorPath, canonicalSha256: canonicalHash(value, Object.hasOwn(value, "expectedCanonicalHash")), byteSha256: sha256(buffer) };
}
function generatedByteDescriptor(descriptorPath, buffer) { return { path: descriptorPath, byteSha256: sha256(buffer) }; }
function descriptorSetHash(descriptors) {
  const sorted = descriptors.map(({ path: descriptorPath, byteSha256 }) => ({ path: descriptorPath, byteSha256 })).sort((left, right) => compareUtf8(left.path, right.path));
  if (new Set(sorted.map((entry) => entry.path)).size !== sorted.length) throw new Error("descriptor_duplicate_path");
  return canonicalHash(sorted);
}
function differenceFieldsForOutput(left, right) { return differenceFields(left, right).sort(compareUtf8); }

function buildArtifacts(inputs, context) {
  const { first, second, adjudication } = inputs; const finalEvidence = reviewEvidence({ values: adjudication.final }, context); const agreement = computeAgreement(first, second, context);
  const manualWindows = withSelfHash({
    artifactType: "manual-windows-v2", schemaVersion: 2,
    windows: adjudication.windows.map((window) => {
      const rows = context.decoderByClip.get(window.clipId);
      return {
        windowId: window.windowId, clipId: window.clipId, startPtsTicks: ptsBoundary(rows, window.startFrameIndex),
        endPtsTicksExclusive: ptsBoundary(rows, window.endFrameIndexExclusive), expectedDecoderRows: window.endFrameIndexExclusive - window.startFrameIndex,
        purposeTags: window.purposeTags, scenarioTags: window.scenarioTags,
      };
    }),
  });
  const serialByClip = new Map(context.paired.map((clip) => [clip.clipId, 0]));
  const labels = []; const subjects = []; const reviewA = []; const reviewB = []; const adjudicationRows = [];
  for (const row of context.decoderRows) {
    const key = frameKey(row.clipId, row.sourceFrameIndex); const selected = adjudication.final.get(key); const left = first.materialized.values.get(key); const right = second.materialized.values.get(key);
    const serial = serialByClip.get(row.clipId); serialByClip.set(row.clipId, serial + 1); const exactIdentity = identity(row);
    const { subjectSelection, ...labelState } = selected.state;
    labels.push({
      artifactType: "manual-label-v2", labelId: `label-${row.clipId}-${String(serial).padStart(4, "0")}`,
      span: { kind: "frame", identity: exactIdentity }, scenarios: selected.scenarios, ...labelState,
      provenance: { origin: "manual_video", reviewStatus: "adjudicated" },
    });
    subjects.push({
      artifactType: "manual-subject-selection-v2", selectionId: `subject-${row.clipId}-${String(serial).padStart(4, "0")}`,
      span: { kind: "frame", identity: exactIdentity }, ...subjectSelection, evidence: "manual_video",
    });
    reviewA.push({ artifactType: "manual-review-v2", pass: "first", reviewerHash: first.review.reviewerPseudonymSha256, identity: exactIdentity, reviewed: true, origin: "manual", state: left.state, scenarios: left.scenarios });
    reviewB.push({ artifactType: "manual-review-v2", pass: "second", reviewerHash: second.review.reviewerPseudonymSha256, identity: exactIdentity, reviewed: true, origin: "manual", state: right.state, scenarios: right.scenarios });
    const disagreementFields = differenceFieldsForOutput({ scenarios: left.scenarios, state: left.state }, { scenarios: right.scenarios, state: right.state });
    if (disagreementFields.length) adjudicationRows.push({
      artifactType: "manual-adjudication-v2", adjudicatorHash: adjudication.value.adjudicatorPseudonymSha256, identity: exactIdentity,
      disagreementFields, decision: selected.state, origin: "manual", adjudicated: true, scenarios: selected.scenarios,
    });
  }
  const manualPolicy = withSelfHash({
    artifactType: "manual-policy-v2", schemaVersion: 2, contractCanonicalSha256: ACCEPTED.evaluationContract, schemaCanonicalSha256: ACCEPTED.labelSchema,
    reviewerHashes: { first: first.review.reviewerPseudonymSha256, second: second.review.reviewerPseudonymSha256, adjudicator: adjudication.value.adjudicatorPseudonymSha256 },
    thresholds: { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95, preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2 },
  });
  const manualSummary = withSelfHash({
    artifactType: "manual-summary-v2", schemaVersion: 2, decoderRows: 6_711, materializedManualRows: 6_711, materializedSubjectRows: 6_711, reviewPass1Rows: 6_711, reviewPass2Rows: 6_711,
    perClip: context.paired.map((clip) => ({ clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows })),
  });
  const artifacts = new Map([
    ["manual-windows.json", generatedJson(manualWindows)], ["manual-labels.jsonl", Buffer.from(jsonl(labels), "utf8")],
    ["manual-subject-selection.jsonl", Buffer.from(jsonl(subjects), "utf8")], ["manual-review-pass1.jsonl", Buffer.from(jsonl(reviewA), "utf8")],
    ["manual-review-pass2.jsonl", Buffer.from(jsonl(reviewB), "utf8")], ["manual-adjudication.jsonl", Buffer.from(jsonl(adjudicationRows), "utf8")],
    ["manual-policy.json", generatedJson(manualPolicy)], ["manual-summary.json", generatedJson(manualSummary)],
  ]);
  const d = context.dependencies;
  const files = {
    evaluationContract: canonicalDescriptor(d.evaluationContract), labelSchema: canonicalDescriptor(d.labelSchema), authoringSchema: canonicalDescriptor(d.authoringSchema),
    teacherInputInventory: canonicalDescriptor(d.teacherInputInventory), teacherPolicy: canonicalDescriptor(d.teacherPolicy), teacherSchema: canonicalDescriptor(d.teacherSchema),
    p0AnchorSchema: canonicalDescriptor(d.p0AnchorSchema), p1AnchorSchema: canonicalDescriptor(d.p1AnchorSchema), sourceInventory: canonicalDescriptor(d.sourceInventory),
    decoderManifest: byteDescriptor(PATHS.decoderManifest, context.decoderSnapshot), manualWindows: generatedJsonDescriptor("manual-windows.json", artifacts.get("manual-windows.json")),
    manualLabels: generatedByteDescriptor("manual-labels.jsonl", artifacts.get("manual-labels.jsonl")),
    manualSubjectSelection: generatedByteDescriptor("manual-subject-selection.jsonl", artifacts.get("manual-subject-selection.jsonl")),
    manualReviewPassA: generatedByteDescriptor("manual-review-pass1.jsonl", artifacts.get("manual-review-pass1.jsonl")),
    manualReviewPassB: generatedByteDescriptor("manual-review-pass2.jsonl", artifacts.get("manual-review-pass2.jsonl")),
    manualAdjudication: generatedByteDescriptor("manual-adjudication.jsonl", artifacts.get("manual-adjudication.jsonl")),
    manualPolicy: generatedJsonDescriptor("manual-policy.json", artifacts.get("manual-policy.json")), manualSummary: generatedJsonDescriptor("manual-summary.json", artifacts.get("manual-summary.json")),
    manualCompiler: byteDescriptor(PATHS.manualCompiler, context.tools.manualCompiler), labelAuditor: byteDescriptor(PATHS.labelAuditor, context.tools.labelAuditor),
  };
  const manifest = withSelfHash({ artifactType: "evaluation-pack-v2", schemaVersion: 2, phase: "p0-candidate", files });
  artifacts.set("evaluation-pack.json", generatedJson(manifest));
  const compiledDescriptors = [...artifacts.entries()].map(([name, buffer]) => generatedByteDescriptor(name, buffer)).sort((left, right) => compareUtf8(left.path, right.path));
  return { artifacts, manifest, compiledDescriptors, compiledArtifactSetSha256: descriptorSetHash(compiledDescriptors), labels, subjects, reviewA, reviewB, adjudicationRows, agreement, finalEvidence };
}

function writeSynced(filePath, contents) {
  const fd = openSync(filePath, "wx", 0o600);
  try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
}
const STAGE_BUNDLE_WRITER = String.raw`
import json, os, stat, struct, sys
fd = 3
expected_dev, expected_ino = int(sys.argv[1]), int(sys.argv[2])
expected_names = json.loads(sys.argv[3])
fault = sys.argv[4] == "1"
directory_status = os.fstat(fd)
if directory_status.st_dev != expected_dev or directory_status.st_ino != expected_ino or not stat.S_ISDIR(directory_status.st_mode):
    print(json.dumps({"ok": False, "error": "stage_fd_identity"}))
    raise SystemExit(91)
stream = sys.stdin.buffer
prefix = stream.read(4)
if len(prefix) != 4:
    print(json.dumps({"ok": False, "error": "bundle_header_short"}))
    raise SystemExit(92)
header_length = struct.unpack(">I", prefix)[0]
header_bytes = stream.read(header_length)
if len(header_bytes) != header_length:
    print(json.dumps({"ok": False, "error": "bundle_header_short"}))
    raise SystemExit(92)
header = json.loads(header_bytes.decode("utf-8"))
if [entry.get("name") for entry in header] != expected_names or any(set(entry) != {"name", "bytes"} for entry in header):
    print(json.dumps({"ok": False, "error": "bundle_file_set"}))
    raise SystemExit(93)
for entry_index, entry in enumerate(header):
    name, remaining = entry["name"], entry["bytes"]
    if not isinstance(remaining, int) or remaining < 0 or name in ("", ".", "..") or "/" in name:
        print(json.dumps({"ok": False, "error": "bundle_entry"}))
        raise SystemExit(94)
    output_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        while remaining:
            chunk = stream.read(min(remaining, 1024 * 1024))
            if not chunk:
                print(json.dumps({"ok": False, "error": "bundle_payload_short"}))
                raise SystemExit(95)
            view = memoryview(chunk)
            while view:
                written = os.write(output_fd, view)
                view = view[written:]
            remaining -= len(chunk)
        os.fsync(output_fd)
    finally:
        os.close(output_fd)
    if fault and entry_index == 0:
        print(json.dumps({"ok": False, "error": "injected_stage_writer_failure"}))
        raise SystemExit(97)
if stream.read(1) != b"":
    print(json.dumps({"ok": False, "error": "bundle_payload_extra"}))
    raise SystemExit(96)
os.fsync(fd)
print(json.dumps({"ok": True}))
`;
function builtBundle(built) {
  const entries = COMPILED_FILES.map((name) => {
    const buffer = built.artifacts.get(name);
    if (!buffer) throw new Error(`built_artifact_missing:${name}`);
    return { name, buffer };
  });
  const header = Buffer.from(JSON.stringify(entries.map(({ name, buffer }) => ({ name, bytes: buffer.length }))), "utf8");
  const prefix = Buffer.allocUnsafe(4); prefix.writeUInt32BE(header.length);
  return Buffer.concat([prefix, header, ...entries.map(({ buffer }) => buffer)]);
}
async function writeBuiltDirectory(directory, built, directoryFd, directoryIdentity, childBarrier = "stage_writer_child", faultLabel = "") {
  const result = await spawnCaptured("/usr/bin/python3", [
    "-c", STAGE_BUNDLE_WRITER, String(directoryIdentity.dev), String(directoryIdentity.ino), JSON.stringify(COMPILED_FILES),
    stageWriterFault(faultLabel) ? "1" : "0",
  ], {
    stdin: builtBundle(built), passFds: [directoryFd], childBarrier, childBarrierResource: directory,
    maxBuffer: 8 * 1024 * 1024,
  });
  let report;
  try { report = JSON.parse(result.stdout.toString("utf8")); } catch { throw new Error(`stage_writer_invalid:${result.status}:${result.stdout.toString("utf8")}:${result.stderr.toString("utf8")}`); }
  if (result.status !== 0 || report.ok !== true) {
    const stderr = result.stderr.toString("utf8").trim();
    throw new Error(`stage_writer_failed:${report.error || result.signal || result.status}${stderr ? `:${stderr}` : ""}`);
  }
}
async function spawnCaptured(command, args, options = {}) {
  let child;
  const completion = new Promise((resolve, reject) => {
    const stdio = [options.stdin ? "pipe" : "ignore", "pipe", "pipe", ...(options.passFds || [])];
    child = spawn(command, args, { cwd: options.cwd || process.cwd(), env: options.env || process.env, stdio });
    ACTIVE_CHILDREN.add(child); const stdout = []; const stderr = []; let byteCount = 0; let settled = false;
    const collect = (target) => (chunk) => {
      byteCount += chunk.length;
      if (byteCount > (options.maxBuffer || 64 * 1024 * 1024)) child.kill("SIGKILL");
      else target.push(chunk);
    };
    child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
    child.on("error", (error) => { ACTIVE_CHILDREN.delete(child); if (!settled) { settled = true; reject(error); } });
    child.on("close", (status, signal) => {
      ACTIVE_CHILDREN.delete(child); if (settled) return; settled = true;
      if (byteCount > (options.maxBuffer || 64 * 1024 * 1024)) { reject(new Error(`child_output_limit:${command}`)); return; }
      resolve({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
  if (options.childBarrier) {
    try {
      child.kill("SIGSTOP");
      if (options.stdin) { child.stdin.on("error", () => {}); child.stdin.end(options.stdin); }
      await testBarrier(options.childBarrier, { resourcePath: options.childBarrierResource || command, childPid: child.pid });
      if (ACTIVE_CHILDREN.has(child) && !handlingSignal) child.kill("SIGCONT");
    } catch (error) {
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      await completion.catch(() => {});
      throw error;
    }
  } else if (options.stdin) { child.stdin.on("error", () => {}); child.stdin.end(options.stdin); }
  return completion;
}
async function testBarrier(name, payload) {
  const prefix = `SAM_GOAL_MANUAL_PACK_V3_TEST_${name.toUpperCase()}`;
  const ready = process.env[`${prefix}_READY_FILE`] || ""; const release = process.env[`${prefix}_RELEASE_FILE`] || "";
  if (!ready && !release) return;
  if (!ready || !release) throw new Error(`test_barrier_configuration:${name}`);
  if (!runtimeTestEnabled()) throw new Error(`test_hook_forbidden:${name}`);
  const rendered = typeof payload === "string" ? payload : JSON.stringify(payload);
  writeSynced(cliPath(ready), Buffer.from(`${rendered}\n`, "utf8"));
  const deadline = Date.now() + 20_000;
  while (!existsSync(cliPath(release))) {
    if (Date.now() >= deadline) throw new Error(`test_barrier_timeout:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function awaitEarlyContextRevalidation(context, mode) {
  await testBarrier("context_revalidate_early", { mode, resourcePath: context.tools.manualCompiler.filePath });
  revalidateContext(context);
}
async function awaitRevalidationBarriers({ inputs, context, packSnapshots, labelPrepared, anchorSnapshot }) {
  if (inputs) await testBarrier("sealed_inputs_revalidate", inputs.second?.snapshot?.filePath || inputs.adjudication?.snapshot?.filePath || "sealed-inputs");
  if (context) await testBarrier("context_revalidate", context.tools?.manualCompiler?.filePath || repoPath(PATHS.evaluationContract));
  if (packSnapshots) await testBarrier("pack_revalidate", packSnapshots.get("evaluation-pack.json")?.filePath || "compiled-pack");
  if (labelPrepared) await testBarrier("label_dir_revalidate", labelPrepared.labelDir);
  if (anchorSnapshot) await testBarrier("verify_anchor_revalidate", anchorSnapshot.filePath);
}

const AUDITOR_VM_WRAPPER = String.raw`
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
(async () => {
  if (process.env.SAM_GOAL_MANUAL_PACK_V3_CHILD_FAULT === "1") throw new Error("injected_auditor_child_failure");
  const [auditorPath, ...auditArgs] = process.argv.slice(1);
  if (!auditorPath) throw new Error("auditor_path_missing");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const source = Buffer.concat(chunks).toString("utf8");
  const identifier = pathToFileURL(auditorPath).href;
  process.argv = [process.execPath, auditorPath, ...auditArgs];
  const cache = new Map();
  const linker = async (specifier) => {
    if (!specifier.startsWith("node:")) throw new Error("auditor_import_forbidden:" + specifier);
    if (cache.has(specifier)) return cache.get(specifier);
    const namespace = await import(specifier);
    const names = Object.keys(namespace);
    const synthetic = new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, namespace[name]);
    }, { identifier: specifier });
    cache.set(specifier, synthetic);
    return synthetic;
  };
  const module = new vm.SourceTextModule(source, {
    identifier,
    initializeImportMeta(meta) { meta.url = identifier; },
  });
  await module.link(linker);
  await module.evaluate();
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
`;
async function runCapturedAuditor(auditArgs, context, settings = {}) {
  if (settings.allowBarrier !== false) await testBarrier("auditor", context.tools.labelAuditor.filePath);
  const env = { ...process.env };
  delete env.SAM_GOAL_MANUAL_PACK_V3_CHILD_FAULT;
  if (settings.fault) env.SAM_GOAL_MANUAL_PACK_V3_CHILD_FAULT = "1";
  const result = await spawnCaptured(process.execPath, ["--experimental-vm-modules", "-e", AUDITOR_VM_WRAPPER, "--", context.tools.labelAuditor.filePath, ...auditArgs], {
    stdin: context.tools.labelAuditor.buffer, env,
    childBarrier: settings.childBarrier || "candidate_auditor_child", childBarrierResource: auditArgs[1] || context.tools.labelAuditor.filePath,
  });
  if (settings.fault && result.status !== 0) throw new Error(`auditor_child_failed:${settings.failureLabel || "unknown"}:injected_auditor_child_failure`);
  let report;
  try { report = parseJsonBuffer(result.stdout, "auditor_report"); } catch (error) { throw new Error(`auditor_report_invalid:${result.status}:${error.message}:${result.stderr.toString("utf8")}`); }
  if (result.status !== 0) throw new Error(`auditor_failed:${report.errors?.[0]?.detail || result.stderr.toString("utf8") || result.signal || result.status}`);
  return report;
}
async function runCandidateAuditor(labelDir, context, expectedCandidate, childBarrier = "candidate_auditor_child") {
  const failureLabel = childBarrier === "anchor_candidate_auditor_child" ? "anchor_candidate" : "candidate";
  const report = await runCapturedAuditor(["--label-dir", labelDir, "--phase", "p0-candidate"], context, {
    childBarrier, failureLabel, fault: testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_CANDIDATE_AUDITOR"),
  });
  if (report.status !== "candidate" || report.phase !== "p0-candidate" || report.frozen !== false || report.externallyVerified !== false || report.candidateP0PackCanonicalSha256 !== expectedCandidate) throw new Error("candidate_auditor_report_drift");
  return report;
}
async function runAnchoredAuditor(options, context, expectedCandidate) {
  const report = await runCapturedAuditor([
    "--label-dir", options.labelDir, "--phase", "p0", "--p0-anchor", options.anchor,
    "--expected-p0-anchor-sha256", options.expectedP0Anchor, "--review-a", options.reviewA, "--review-b", options.reviewB, "--adjudication", options.adjudication,
  ], context, {
    allowBarrier: false, childBarrier: "anchored_auditor_child",
    failureLabel: "anchored", fault: testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_ANCHORED_AUDITOR"),
  });
  if (report.status !== "passed" || report.phase !== "p0" || report.frozen !== true || report.externallyVerified !== true
    || report.candidateP0PackCanonicalSha256 !== expectedCandidate || report.parentP0AnchorSha256 !== options.expectedP0Anchor) throw new Error("anchored_auditor_report_drift");
  return report;
}

const MACOS_RENAME_EXCL_HELPER = String.raw`
import ctypes, errno, json, os, stat, sys
if sys.platform != "darwin":
    print(json.dumps({"ok": False, "error": "unsupported_platform", "platform": sys.platform}))
    raise SystemExit(90)
libc = ctypes.CDLL(None, use_errno=True)
renameatx_np = libc.renameatx_np
renameatx_np.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
renameatx_np.restype = ctypes.c_int
fd = 3
source, destination = sys.argv[1], sys.argv[2]
expected_parent_dev, expected_parent_ino = int(sys.argv[3]), int(sys.argv[4])
expected_source_dev, expected_source_ino = int(sys.argv[5]), int(sys.argv[6])
fault = sys.argv[7] == "1"
if source in ("", ".", "..") or destination in ("", ".", "..") or "/" in source or "/" in destination:
    print(json.dumps({"ok": False, "error": "basename_invalid"}))
    raise SystemExit(91)
parent_status = os.fstat(fd)
if parent_status.st_dev != expected_parent_dev or parent_status.st_ino != expected_parent_ino or not stat.S_ISDIR(parent_status.st_mode):
    print(json.dumps({"ok": False, "error": "parent_fd_identity"}))
    raise SystemExit(92)
source_status = os.stat(source, dir_fd=fd, follow_symlinks=False)
if source_status.st_dev != expected_source_dev or source_status.st_ino != expected_source_ino or not stat.S_ISDIR(source_status.st_mode):
    print(json.dumps({"ok": False, "error": "source_identity"}))
    raise SystemExit(93)
try:
    os.stat(destination, dir_fd=fd, follow_symlinks=False)
    print(json.dumps({"ok": False, "errno": errno.EEXIST, "name": "EEXIST"}))
    raise SystemExit(1)
except FileNotFoundError:
    pass
if fault:
    print(json.dumps({"ok": False, "error": "injected_rename_helper_failure"}))
    raise SystemExit(94)
result = renameatx_np(fd, os.fsencode(source), fd, os.fsencode(destination), 0x00000004)
if result != 0:
    number = ctypes.get_errno()
    print(json.dumps({"ok": False, "errno": number, "name": errno.errorcode.get(number, "UNKNOWN")}))
    raise SystemExit(1)
destination_status = os.stat(destination, dir_fd=fd, follow_symlinks=False)
if destination_status.st_dev != expected_source_dev or destination_status.st_ino != expected_source_ino or not stat.S_ISDIR(destination_status.st_mode):
    print(json.dumps({"ok": False, "error": "destination_identity"}))
    raise SystemExit(95)
os.fsync(fd)
print(json.dumps({"ok": True, "dev": str(destination_status.st_dev), "ino": str(destination_status.st_ino), "mode": str(destination_status.st_mode), "nlink": str(destination_status.st_nlink)}))
`;
async function renameDirectoryNoReplace(prepared, sourceName, sourceIdentity) {
  if (process.platform !== "darwin") throw new Error(`rename_excl_unsupported_platform:${process.platform}`);
  const result = await spawnCaptured("/usr/bin/python3", [
    "-c", MACOS_RENAME_EXCL_HELPER, sourceName, prepared.basename,
    String(prepared.parentIdentity.dev), String(prepared.parentIdentity.ino), String(sourceIdentity.dev), String(sourceIdentity.ino),
    testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_RENAME_HELPER") ? "1" : "0",
  ], {
    passFds: [prepared.parentFd], childBarrier: "rename_helper_child", childBarrierResource: prepared.destination,
  });
  let report;
  try { report = JSON.parse(result.stdout.toString("utf8")); } catch { throw new Error(`rename_excl_helper_invalid:${result.status}:${result.stdout.toString("utf8")}:${result.stderr.toString("utf8")}`); }
  if (result.status === 0 && report.ok === true) return report;
  if ([17, 66].includes(report.errno)) throw new Error(`output_dir_raced:${prepared.destination}:${report.name}`);
  throw new Error(`rename_excl_failed:${prepared.destination}:${report.errno || report.error || result.signal || result.status}:${result.stderr.toString("utf8")}`);
}

const RELATIVE_REMOVE_HELPER = String.raw`
import json, os, stat, sys
fd = 3
kind, name = sys.argv[1], sys.argv[2]
expected_parent_dev, expected_parent_ino = int(sys.argv[3]), int(sys.argv[4])
expected_dev, expected_ino = int(sys.argv[5]), int(sys.argv[6])
def valid_basename(value):
    return value not in ("", ".", "..") and "/" not in value
def remove_at(parent_fd, child_name):
    child_status = os.stat(child_name, dir_fd=parent_fd, follow_symlinks=False)
    if stat.S_ISDIR(child_status.st_mode):
        child_fd = os.open(child_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
        try:
            for grandchild in os.listdir(child_fd):
                remove_at(child_fd, grandchild)
        finally:
            os.close(child_fd)
        os.rmdir(child_name, dir_fd=parent_fd)
    else:
        os.unlink(child_name, dir_fd=parent_fd)
if not valid_basename(name):
    print(json.dumps({"ok": False, "error": "basename_invalid"}))
    raise SystemExit(91)
parent_status = os.fstat(fd)
if parent_status.st_dev != expected_parent_dev or parent_status.st_ino != expected_parent_ino or not stat.S_ISDIR(parent_status.st_mode):
    print(json.dumps({"ok": False, "error": "parent_fd_identity"}))
    raise SystemExit(92)
try:
    target = os.stat(name, dir_fd=fd, follow_symlinks=False)
except FileNotFoundError:
    print(json.dumps({"ok": True, "absent": True}))
    raise SystemExit(0)
if target.st_dev != expected_dev or target.st_ino != expected_ino:
    print(json.dumps({"ok": False, "error": "target_identity"}))
    raise SystemExit(93)
if kind == "directory" and not stat.S_ISDIR(target.st_mode):
    print(json.dumps({"ok": False, "error": "target_kind"}))
    raise SystemExit(94)
if kind == "file" and not stat.S_ISREG(target.st_mode):
    print(json.dumps({"ok": False, "error": "target_kind"}))
    raise SystemExit(94)
remove_at(fd, name)
os.fsync(fd)
print(json.dumps({"ok": True, "absent": False}))
`;
const RELATIVE_CREATE_HELPER = String.raw`
import json, os, stat, sys
fd = 3
kind, name = sys.argv[1], sys.argv[2]
expected_parent_dev, expected_parent_ino = int(sys.argv[3]), int(sys.argv[4])
fault = sys.argv[5] == "1"
if name in ("", ".", "..") or "/" in name:
    print(json.dumps({"ok": False, "error": "basename_invalid"}))
    raise SystemExit(91)
parent_status = os.fstat(fd)
if parent_status.st_dev != expected_parent_dev or parent_status.st_ino != expected_parent_ino or not stat.S_ISDIR(parent_status.st_mode):
    print(json.dumps({"ok": False, "error": "parent_fd_identity"}))
    raise SystemExit(92)
created = False
try:
    if kind == "directory":
        os.mkdir(name, 0o700, dir_fd=fd)
        created = True
    elif kind == "file":
        output_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        created = True
        try:
            while True:
                chunk = sys.stdin.buffer.read(1024 * 1024)
                if not chunk:
                    break
                view = memoryview(chunk)
                while view:
                    written = os.write(output_fd, view)
                    view = view[written:]
            os.fsync(output_fd)
        finally:
            os.close(output_fd)
    else:
        print(json.dumps({"ok": False, "error": "kind_invalid"}))
        raise SystemExit(93)
    if fault:
        raise RuntimeError("injected_relative_create_failure")
    target = os.stat(name, dir_fd=fd, follow_symlinks=False)
    if (kind == "directory" and not stat.S_ISDIR(target.st_mode)) or (kind == "file" and not stat.S_ISREG(target.st_mode)):
        raise RuntimeError("created_kind")
    os.fsync(fd)
    print(json.dumps({"ok": True, "dev": str(target.st_dev), "ino": str(target.st_ino), "mode": str(target.st_mode), "nlink": str(target.st_nlink), "size": str(target.st_size)}))
except BaseException as error:
    if created:
        try:
            if kind == "directory":
                os.rmdir(name, dir_fd=fd)
            else:
                os.unlink(name, dir_fd=fd)
            os.fsync(fd)
        except BaseException:
            pass
    if isinstance(error, SystemExit):
        raise
    print(json.dumps({"ok": False, "error": type(error).__name__ + ":" + str(error)}))
    raise SystemExit(94)
`;
function createRelative(prepared, name, kind, contents = null, faultLabel = "") {
  const result = spawnSync("/usr/bin/python3", [
    "-c", RELATIVE_CREATE_HELPER, kind, name, String(prepared.parentIdentity.dev), String(prepared.parentIdentity.ino),
    relativeCreateFault(faultLabel) ? "1" : "0",
  ], {
    input: contents || undefined, stdio: contents ? ["pipe", "pipe", "pipe", prepared.parentFd] : ["ignore", "pipe", "pipe", prepared.parentFd],
    maxBuffer: 8 * 1024 * 1024,
  });
  let report;
  try { report = JSON.parse(result.stdout.toString("utf8")); } catch { throw new Error(`relative_create_helper_invalid:${kind}:${result.status}:${result.stdout?.toString("utf8") || ""}:${result.stderr?.toString("utf8") || ""}`); }
  if (result.status !== 0 || report.ok !== true) throw new Error(`relative_create_failed:${kind}:${report.error || result.signal || result.status}`);
  return {
    dev: BigInt(report.dev), ino: BigInt(report.ino), mode: BigInt(report.mode), nlink: BigInt(report.nlink), size: BigInt(report.size),
  };
}
function removeRelativeIfIdentity(entry) {
  const { prepared, name, kind, identity } = entry;
  if (prepared.parentFd === null || prepared.parentFd === undefined || !identity) return false;
  const result = spawnSync("/usr/bin/python3", [
    "-c", RELATIVE_REMOVE_HELPER, kind, name,
    String(prepared.parentIdentity.dev), String(prepared.parentIdentity.ino), String(identity.dev), String(identity.ino),
  ], { stdio: ["ignore", "pipe", "pipe", prepared.parentFd], encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) return false;
  try { return JSON.parse(result.stdout).ok === true; } catch { return false; }
}
function relativeEntry(prepared, name, kind, identity) { return { prepared, name, kind, identity: ancestorIdentity(identity) }; }

const MACOS_LINKAT_EXCL_HELPER = String.raw`
import errno, json, os, stat, sys
if sys.platform != "darwin":
    print(json.dumps({"ok": False, "error": "unsupported_platform", "platform": sys.platform}))
    raise SystemExit(90)
fd = 3
source, destination = sys.argv[1], sys.argv[2]
expected_parent_dev, expected_parent_ino = int(sys.argv[3]), int(sys.argv[4])
expected_source_dev, expected_source_ino = int(sys.argv[5]), int(sys.argv[6])
fault = sys.argv[7] == "1"
if source in ("", ".", "..") or destination in ("", ".", "..") or "/" in source or "/" in destination:
    print(json.dumps({"ok": False, "error": "basename_invalid"}))
    raise SystemExit(91)
parent_status = os.fstat(fd)
if parent_status.st_dev != expected_parent_dev or parent_status.st_ino != expected_parent_ino or not stat.S_ISDIR(parent_status.st_mode):
    print(json.dumps({"ok": False, "error": "parent_fd_identity"}))
    raise SystemExit(92)
source_status = os.stat(source, dir_fd=fd, follow_symlinks=False)
if source_status.st_dev != expected_source_dev or source_status.st_ino != expected_source_ino or not stat.S_ISREG(source_status.st_mode) or source_status.st_nlink != 1:
    print(json.dumps({"ok": False, "error": "source_identity"}))
    raise SystemExit(93)
try:
    os.stat(destination, dir_fd=fd, follow_symlinks=False)
    print(json.dumps({"ok": False, "errno": errno.EEXIST, "name": "EEXIST"}))
    raise SystemExit(1)
except FileNotFoundError:
    pass
if fault:
    print(json.dumps({"ok": False, "error": "injected_anchor_link_helper_failure"}))
    raise SystemExit(94)
os.link(source, destination, src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
destination_status = os.stat(destination, dir_fd=fd, follow_symlinks=False)
if destination_status.st_dev != expected_source_dev or destination_status.st_ino != expected_source_ino:
    print(json.dumps({"ok": False, "error": "destination_identity"}))
    raise SystemExit(95)
os.unlink(source, dir_fd=fd)
os.fsync(fd)
print(json.dumps({"ok": True, "dev": str(destination_status.st_dev), "ino": str(destination_status.st_ino), "mode": str(destination_status.st_mode), "nlink": str(destination_status.st_nlink)}))
`;
async function linkFileNoReplace(prepared, sourceName, sourceIdentity) {
  const result = await spawnCaptured("/usr/bin/python3", [
    "-c", MACOS_LINKAT_EXCL_HELPER, sourceName, prepared.basename,
    String(prepared.parentIdentity.dev), String(prepared.parentIdentity.ino), String(sourceIdentity.dev), String(sourceIdentity.ino),
    testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_ANCHOR_LINK_HELPER") ? "1" : "0",
  ], {
    passFds: [prepared.parentFd], childBarrier: "anchor_link_helper_child", childBarrierResource: prepared.destination,
  });
  let report;
  try { report = JSON.parse(result.stdout.toString("utf8")); } catch { throw new Error(`anchor_link_helper_invalid:${result.status}:${result.stdout.toString("utf8")}:${result.stderr.toString("utf8")}`); }
  if (result.status === 0 && report.ok === true) return report;
  if (report.errno === 17) throw new Error(`anchor_raced:${prepared.destination}:EEXIST`);
  throw new Error(`anchor_link_failed:${prepared.destination}:${report.errno || report.error || result.signal || result.status}:${result.stderr.toString("utf8")}`);
}
function revalidateContext(context) {
  for (const [name, item] of Object.entries(context.dependencies)) revalidateSnapshot(item.snapshot, `dependency_${name}`);
  revalidateSnapshot(context.decoderSnapshot, "dependency_decoderManifest");
  for (const [name, snapshot] of Object.entries(context.tools)) revalidateSnapshot(snapshot, `tool_${name}`);
}
function readPackSnapshots(labelDir) {
  const entries = readdirSync(labelDir).sort(compareUtf8); const expected = [...COMPILED_FILES].sort(compareUtf8);
  if (!stableEqual(entries, expected)) throw new Error(`compiled_file_set_drift:${entries.join(",")}`);
  const snapshots = new Map();
  for (const name of expected) snapshots.set(name, snapshotFile(path.join(labelDir, name), `compiled_${name}`, true));
  assertDistinctSnapshots([...snapshots.entries()], "compiled_artifact_alias");
  return snapshots;
}
function assertPackEqualsBuilt(snapshots, built) {
  for (const name of COMPILED_FILES) if (!snapshots.get(name)?.buffer.equals(built.artifacts.get(name))) throw new Error(`compiled_artifact_mismatch:${name}`);
}
function revalidatePackSnapshots(snapshots) { for (const [name, snapshot] of snapshots) revalidateSnapshot(snapshot, `compiled_${name}`); }
async function compileAtomic(prepared, inputs, built, context) {
  revalidateDestinationParent(prepared, "output_dir"); revalidateSealedInputs(inputs); revalidateContext(context);
  const stageName = `.${prepared.basename}.tmp-${process.pid}-${randomUUID()}`;
  const stage = path.join(prepared.parent, stageName); let committed = false; let stageEntry = null; let provisionalEntry = null; let stageFd = null;
  try {
    await testBarrier("output_parent_pre_create", prepared.destination);
    const stageStatus = createRelative(prepared, stageName, "directory", null, "compile_stage");
    stageEntry = relativeEntry(prepared, stageName, "directory", stageStatus); ACTIVE_TEMP_ENTRIES.add(stageEntry);
    provisionalEntry = relativeEntry(prepared, prepared.basename, "directory", stageStatus); ACTIVE_PROVISIONAL_ENTRIES.add(provisionalEntry);
    revalidateDestinationParent(prepared, "output_dir");
    const stagePathStatus = lstatSync(stage, { bigint: true });
    if (stagePathStatus.isSymbolicLink() || !stagePathStatus.isDirectory() || !sameAncestorIdentity(stageStatus, ancestorIdentity(stagePathStatus))) throw new Error("compile_stage_path_replaced");
    stageFd = openSync(stage, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0));
    const heldStage = fstatSync(stageFd, { bigint: true });
    if (!heldStage.isDirectory() || !sameAncestorIdentity(stageStatus, ancestorIdentity(heldStage))) throw new Error("compile_stage_fd_replaced");
    await testBarrier("compile_stage", stage); await testBarrier("stage", stage);
    await writeBuiltDirectory(stage, built, stageFd, stageStatus, "compile_stage_writer_child", "compile");
    if (testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_AFTER_FILES")) throw new Error("injected_compile_failure");
    await runCandidateAuditor(stage, context, built.manifest.expectedCanonicalHash);
    const stagedSnapshots = readPackSnapshots(stage); assertPackEqualsBuilt(stagedSnapshots, built);
    revalidateSealedInputs(inputs); revalidateContext(context); revalidateDestinationParent(prepared, "output_dir"); revalidatePackSnapshots(stagedSnapshots);
    await testBarrier("commit", stage);
    await awaitRevalidationBarriers({ inputs, context, packSnapshots: stagedSnapshots });
    revalidateSealedInputs(inputs); revalidateContext(context); revalidateDestinationParent(prepared, "output_dir"); revalidatePackSnapshots(stagedSnapshots);
    await testBarrier("output_parent_last_window", prepared.destination);
    revalidateSealedInputs(inputs); revalidateContext(context); revalidateDestinationParent(prepared, "output_dir"); revalidatePackSnapshots(stagedSnapshots);
    await renameDirectoryNoReplace(prepared, stageName, stageStatus);
    const preHookDestinationStatus = lstatSync(prepared.destination, { bigint: true });
    const heldCommittedStage = fstatSync(stageFd, { bigint: true });
    if (preHookDestinationStatus.isSymbolicLink() || !preHookDestinationStatus.isDirectory()
      || !heldCommittedStage.isDirectory() || !sameAncestorIdentity(ancestorIdentity(stageStatus), ancestorIdentity(preHookDestinationStatus))
      || !sameAncestorIdentity(ancestorIdentity(stageStatus), ancestorIdentity(heldCommittedStage))) throw new Error("rename_excl_postcondition");
    const preHookCommittedSnapshots = readPackSnapshots(prepared.destination); assertPackEqualsBuilt(preHookCommittedSnapshots, built);
    await testBarrier("compile_post_rename", prepared.destination);
    revalidatePackSnapshots(preHookCommittedSnapshots);
    revalidateDestinationParent(prepared, "output_dir");
    const destinationStatus = lstatSync(prepared.destination, { bigint: true });
    if (destinationStatus.isSymbolicLink() || !destinationStatus.isDirectory() || !sameAncestorIdentity(ancestorIdentity(stageStatus), ancestorIdentity(destinationStatus))) throw new Error("rename_excl_postcondition");
    const committedSnapshots = readPackSnapshots(prepared.destination); assertPackEqualsBuilt(committedSnapshots, built);
    revalidateSealedInputs(inputs); revalidateContext(context); revalidateDestinationParent(prepared, "output_dir"); revalidatePackSnapshots(committedSnapshots);
    const finalDestinationStatus = lstatSync(prepared.destination, { bigint: true }); const finalHeldStage = fstatSync(stageFd, { bigint: true });
    if (finalDestinationStatus.isSymbolicLink() || !finalDestinationStatus.isDirectory()
      || !finalHeldStage.isDirectory() || !sameAncestorIdentity(ancestorIdentity(stageStatus), ancestorIdentity(finalDestinationStatus))
      || !sameAncestorIdentity(ancestorIdentity(stageStatus), ancestorIdentity(finalHeldStage))) throw new Error("rename_excl_final_postcondition");
    ACTIVE_TEMP_ENTRIES.delete(stageEntry); ACTIVE_PROVISIONAL_ENTRIES.delete(provisionalEntry); committed = true;
    return { destination: prepared.destination };
  } finally {
    if (stageFd !== null) { try { closeSync(stageFd); } catch { /* already closed */ } }
    if (!committed && provisionalEntry) removeRelativeIfIdentity(provisionalEntry);
    if (stageEntry) removeRelativeIfIdentity(stageEntry);
    if (provisionalEntry) ACTIVE_PROVISIONAL_ENTRIES.delete(provisionalEntry);
    if (stageEntry) ACTIVE_TEMP_ENTRIES.delete(stageEntry);
  }
}

function anchorDependencies(context) {
  return {
    evaluationContractCanonicalSha256: ACCEPTED.evaluationContract, labelSchemaCanonicalSha256: ACCEPTED.labelSchema,
    authoringSchemaCanonicalSha256: ACCEPTED.authoringSchema, teacherInputInventoryCanonicalSha256: ACCEPTED.teacherInputInventory,
    teacherPolicyCanonicalSha256: ACCEPTED.teacherPolicy, teacherSchemaCanonicalSha256: ACCEPTED.teacherSchema,
    p0AnchorSchemaCanonicalSha256: ACCEPTED.p0AnchorSchema, p1AnchorSchemaCanonicalSha256: ACCEPTED.p1AnchorSchema,
    sourceInventoryCanonicalSha256: ACCEPTED.sourceInventory, decoderByteSha256: ACCEPTED.decoderBytes,
    decoderCanonicalRowsSha256: ACCEPTED.decoderRows, manualCompilerByteSha256: context.tools.manualCompiler.byteSha256,
    labelAuditorByteSha256: context.tools.labelAuditor.byteSha256,
  };
}
function expectedAnchor(packSnapshots, inputs, context) {
  const manifestSnapshot = packSnapshots.get("evaluation-pack.json"); const manifest = parseJsonBuffer(manifestSnapshot.buffer, "evaluation_pack_anchor");
  const candidateP0PackCanonicalSha256 = verifySelfHash(manifest, "evaluation_pack_anchor");
  const compiledArtifacts = [...packSnapshots.entries()].map(([name, snapshot]) => ({ path: name, byteSha256: snapshot.byteSha256 })).sort((left, right) => compareUtf8(left.path, right.path));
  const anchor = withSelfHash({
    artifactType: "sam-goal-p0-external-anchor", schemaVersion: 2, candidateP0PackCanonicalSha256,
    evaluationPack: { path: "evaluation-pack.json", canonicalSha256: candidateP0PackCanonicalSha256, byteSha256: manifestSnapshot.byteSha256 },
    compiledArtifacts, compiledArtifactSetSha256: descriptorSetHash(compiledArtifacts), dependencies: anchorDependencies(context),
    sealedInputs: {
      reviewA: { role: "first", logicalPath: "sealed/review-a.json", actorPseudonymSha256: inputs.first.review.reviewerPseudonymSha256, byteSha256: inputs.first.byteSha256 },
      reviewB: { role: "second", logicalPath: "sealed/review-b.json", actorPseudonymSha256: inputs.second.review.reviewerPseudonymSha256, byteSha256: inputs.second.byteSha256 },
      adjudication: { role: "adjudication", logicalPath: "sealed/adjudication.json", actorPseudonymSha256: inputs.adjudication.value.adjudicatorPseudonymSha256, byteSha256: inputs.adjudication.byteSha256 },
    },
  });
  validateSchemaValue(context.p0AnchorSchema, context.p0AnchorSchema, anchor, "p0Anchor");
  return anchor;
}
async function auditRecompiledStage(labelPrepared, inputs, built, context) {
  const stageName = `.${labelPrepared.basename}.anchor-stage-${process.pid}-${randomUUID()}`;
  const stage = path.join(labelPrepared.parent, stageName); let stageEntry = null; let stageFd = null;
  try {
    await testBarrier("anchor_recompile_parent_pre_create", stage);
    const stageStatus = createRelative(labelPrepared, stageName, "directory", null, "anchor_recompile_stage");
    stageEntry = relativeEntry(labelPrepared, stageName, "directory", stageStatus); ACTIVE_TEMP_ENTRIES.add(stageEntry);
    revalidateLabelDirectory(labelPrepared);
    const stagePathStatus = lstatSync(stage, { bigint: true });
    if (stagePathStatus.isSymbolicLink() || !stagePathStatus.isDirectory() || !sameAncestorIdentity(stageStatus, ancestorIdentity(stagePathStatus))) throw new Error("anchor_recompile_stage_path_replaced");
    stageFd = openSync(stage, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0));
    const heldStage = fstatSync(stageFd, { bigint: true });
    if (!heldStage.isDirectory() || !sameAncestorIdentity(stageStatus, ancestorIdentity(heldStage))) throw new Error("anchor_recompile_stage_fd_replaced");
    await testBarrier("anchor_recompile_stage", stage);
    await writeBuiltDirectory(stage, built, stageFd, stageStatus, "anchor_stage_writer_child", "anchor");
    await runCandidateAuditor(stage, context, built.manifest.expectedCanonicalHash, "anchor_candidate_auditor_child");
    const snapshots = readPackSnapshots(stage); assertPackEqualsBuilt(snapshots, built); revalidatePackSnapshots(snapshots);
  } finally {
    if (stageFd !== null) { try { closeSync(stageFd); } catch { /* already closed */ } }
    if (stageEntry) removeRelativeIfIdentity(stageEntry);
    if (stageEntry) ACTIVE_TEMP_ENTRIES.delete(stageEntry);
  }
  revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context);
}
function ensureAnchorIdentity(anchorPath, expectedIdentity, otherSnapshots) {
  const status = lstatSync(anchorPath, { bigint: true });
  if (status.isSymbolicLink() || !status.isFile() || status.nlink !== 1n || !sameStatIdentity(expectedIdentity, statIdentity(status))) throw new Error("anchor_commit_postcondition");
  for (const [, snapshot] of otherSnapshots) if (snapshot.stat.dev === status.dev && snapshot.stat.ino === status.ino) throw new Error("anchor_inode_alias");
}
async function createAnchorAtomic(preparedAnchor, labelPrepared, packSnapshots, inputs, anchor, context) {
  if (pathInside(labelPrepared.labelDirReal, preparedAnchor.prospectiveReal)) throw new Error("anchor_inside_label_dir");
  const anchorBytes = generatedJson(anchor);
  const tempName = `.${preparedAnchor.basename}.tmp-${process.pid}-${randomUUID()}`;
  const temp = path.join(preparedAnchor.parent, tempName); let committed = false; let tempIdentity = null; let tempEntry = null; let provisionalEntry = null; let initialTempSnapshot = null;
  try {
    revalidateDestinationParent(preparedAnchor, "anchor");
    await testBarrier("anchor_parent_pre_create", preparedAnchor.destination);
    tempIdentity = createRelative(preparedAnchor, tempName, "file", anchorBytes, "anchor_temp");
    tempEntry = relativeEntry(preparedAnchor, tempName, "file", tempIdentity); ACTIVE_TEMP_ENTRIES.add(tempEntry);
    provisionalEntry = relativeEntry(preparedAnchor, preparedAnchor.basename, "file", tempIdentity); ACTIVE_PROVISIONAL_ENTRIES.add(provisionalEntry);
    revalidateDestinationParent(preparedAnchor, "anchor");
    const tempPathStatus = lstatSync(temp, { bigint: true });
    if (tempPathStatus.isSymbolicLink() || !tempPathStatus.isFile() || !sameStatIdentity(tempIdentity, statIdentity(tempPathStatus))) throw new Error("anchor_temp_path_replaced");
    initialTempSnapshot = snapshotFile(temp, "anchor_temp", true);
    if (!sameStatIdentity(tempIdentity, statIdentity(initialTempSnapshot.stat))) throw new Error("anchor_temp_identity_drift");
    if (!initialTempSnapshot.buffer.equals(anchorBytes)) throw new Error("anchor_temp_bytes_mismatch");
    revalidateDestinationParent(preparedAnchor, "anchor"); revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context); revalidatePackSnapshots(packSnapshots);
    await testBarrier("anchor", temp);
    await awaitRevalidationBarriers({ inputs, context, packSnapshots, labelPrepared });
    revalidateDestinationParent(preparedAnchor, "anchor"); revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context); revalidatePackSnapshots(packSnapshots);
    if (testFaultEnabled("SAM_GOAL_MANUAL_PACK_V3_FAULT_BEFORE_ANCHOR_LINK")) throw new Error("injected_anchor_failure");
    await testBarrier("anchor_pre_link", preparedAnchor.destination);
    await testBarrier("anchor_parent_last_window", preparedAnchor.destination);
    revalidateDestinationParent(preparedAnchor, "anchor"); revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context); revalidatePackSnapshots(packSnapshots);
    revalidateSnapshot(initialTempSnapshot, "anchor_temp");
    const preLinkTempSnapshot = snapshotFile(temp, "anchor_temp_prelink", true);
    if (!sameStatIdentity(tempIdentity, statIdentity(preLinkTempSnapshot.stat))) throw new Error("anchor_temp_prelink_identity_drift");
    if (!preLinkTempSnapshot.buffer.equals(anchorBytes)) throw new Error("anchor_temp_prelink_bytes_mismatch");
    revalidateSnapshot(preLinkTempSnapshot, "anchor_temp_prelink");
    await linkFileNoReplace(preparedAnchor, tempName, tempIdentity);
    const preHookAnchorSnapshot = snapshotFile(preparedAnchor.destination, "anchor_committed", true);
    if (!sameStatIdentity(tempIdentity, statIdentity(preHookAnchorSnapshot.stat))) throw new Error("anchor_commit_identity_drift");
    if (!preHookAnchorSnapshot.buffer.equals(anchorBytes)) throw new Error("anchor_commit_bytes_mismatch");
    await testBarrier("anchor_post_link", preparedAnchor.destination);
    revalidateSnapshot(preHookAnchorSnapshot, "anchor_committed");
    revalidateDestinationParent(preparedAnchor, "anchor");
    ensureAnchorIdentity(preparedAnchor.destination, tempIdentity, [...packSnapshots.entries(), ...inputs.snapshots]);
    const committedAnchorSnapshot = snapshotFile(preparedAnchor.destination, "anchor_committed_final", true);
    if (!sameStatIdentity(tempIdentity, statIdentity(committedAnchorSnapshot.stat))) throw new Error("anchor_commit_final_identity_drift");
    if (!committedAnchorSnapshot.buffer.equals(anchorBytes)) throw new Error("anchor_commit_final_bytes_mismatch");
    const committedAnchor = parseJsonBuffer(committedAnchorSnapshot.buffer, "anchor_committed_final");
    validateSchemaValue(context.p0AnchorSchema, context.p0AnchorSchema, committedAnchor, "p0AnchorCommitted");
    const committedCanonicalSha256 = verifySelfHash(committedAnchor, "p0AnchorCommitted");
    if (committedCanonicalSha256 !== anchor.expectedCanonicalHash) throw new Error(`anchor_commit_canonical_mismatch:${committedCanonicalSha256}:${anchor.expectedCanonicalHash}`);
    revalidateLabelDirectory(labelPrepared); revalidatePackSnapshots(packSnapshots); revalidateSealedInputs(inputs); revalidateContext(context); revalidateDestinationParent(preparedAnchor, "anchor");
    revalidateSnapshot(committedAnchorSnapshot, "anchor_committed_final");
    ensureAnchorIdentity(preparedAnchor.destination, tempIdentity, [...packSnapshots.entries(), ...inputs.snapshots]);
    ACTIVE_TEMP_ENTRIES.delete(tempEntry); ACTIVE_PROVISIONAL_ENTRIES.delete(provisionalEntry);
    committed = true;
  } finally {
    if (!committed && provisionalEntry) removeRelativeIfIdentity(provisionalEntry);
    if (tempEntry) removeRelativeIfIdentity(tempEntry);
    if (provisionalEntry) ACTIVE_PROVISIONAL_ENTRIES.delete(provisionalEntry);
    if (tempEntry) ACTIVE_TEMP_ENTRIES.delete(tempEntry);
  }
}

function validateAnchorSnapshot(anchorSnapshot, expectedHash, packSnapshots, inputs, context) {
  const anchor = parseJsonBuffer(anchorSnapshot.buffer, "p0_anchor"); validateSchemaValue(context.p0AnchorSchema, context.p0AnchorSchema, anchor, "p0Anchor");
  const actualHash = verifySelfHash(anchor, "p0Anchor");
  if (actualHash !== expectedHash) throw new Error(`p0_anchor_expected_mismatch:${expectedHash}:${actualHash}`);
  const expected = expectedAnchor(packSnapshots, inputs, context);
  if (!stableEqual(anchor, expected)) throw new Error("p0_anchor_binding_drift");
  return { anchor, actualHash };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const includeFinalSegmentTrace = finalSegmentTraceEnabled(options.mode);
  if (options.help) { usage(); return; }
  if (options.mode !== "validate-review") await testBarrier("self_snapshot", repoPath(PATHS.manualCompiler));
  if (options.mode === "validate-review") {
    const context = loadContext(false); const snapshot = secureExternalSnapshot(options.review, "review");
    const result = validateReviewSnapshot(snapshot, options.expectedRole, options.expectedReviewer, context, "review");
    revalidateSnapshot(snapshot, "review"); revalidateContext(context);
    console.log(JSON.stringify({
      status: "passed", mode: "validate-review", role: result.review.role,
      reviewerPseudonymSha256: result.review.reviewerPseudonymSha256, reviewCanonicalSha256: result.canonicalSha256,
      reviewByteSha256: result.byteSha256, materializedRows: result.materialized.values.size,
      support: result.evidence.support, reacquireCandidates: result.evidence.reacquireCandidates,
    }, null, 2));
    return;
  }
  if (options.mode === "compile") {
    const prepared = prepareAbsentDestination(options.outputDir, "output_dir");
    try {
      const context = loadContext(true); await awaitEarlyContextRevalidation(context, options.mode);
      const inputs = loadSealedInputs(options, context, prepared.prospectiveReal);
      const finalSegmentTrace = includeFinalSegmentTrace ? compileFinalSegmentTrace(inputs.adjudication.finalSegments) : null;
      const built = buildArtifacts(inputs, context);
      await compileAtomic(prepared, inputs, built, context);
      const response = {
        status: "compiled", mode: "compile", outputDir: prepared.destination, materializedRowsPerPass: 6_711,
        disagreementPaths: inputs.adjudication.expected.disagreements.length, adjudicatedRows: built.adjudicationRows.length,
        candidateP0PackCanonicalSha256: built.manifest.expectedCanonicalHash, compiledArtifactSetSha256: built.compiledArtifactSetSha256,
      };
      if (includeFinalSegmentTrace) response.finalSegmentTrace = finalSegmentTrace;
      console.log(JSON.stringify(response, null, 2));
    } finally { closePrepared(prepared); }
    return;
  }
  const labelPrepared = prepareLabelDirectory(options.labelDir);
  try {
    const context = loadContext(true); await awaitEarlyContextRevalidation(context, options.mode);
    const inputs = loadSealedInputs(options, context, labelPrepared.labelDirReal); const built = buildArtifacts(inputs, context);
    if (options.mode === "create-anchor") {
      const preparedAnchor = prepareAbsentDestination(options.anchor, "anchor");
      try {
        if (pathInside(labelPrepared.labelDirReal, preparedAnchor.prospectiveReal)) throw new Error("anchor_inside_label_dir");
        await auditRecompiledStage(labelPrepared, inputs, built, context);
        const packSnapshots = readPackSnapshots(labelPrepared.labelDir); assertPackEqualsBuilt(packSnapshots, built);
        assertDistinctSnapshots([...packSnapshots.entries(), ...inputs.snapshots], "pack_or_sealed_alias");
        revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context); revalidatePackSnapshots(packSnapshots);
        const anchor = expectedAnchor(packSnapshots, inputs, context);
        await createAnchorAtomic(preparedAnchor, labelPrepared, packSnapshots, inputs, anchor, context);
        console.log(JSON.stringify({
          status: "created", mode: "create-anchor", anchor: preparedAnchor.destination,
          candidateP0PackCanonicalSha256: anchor.candidateP0PackCanonicalSha256, anchorCanonicalSha256: anchor.expectedCanonicalHash,
          compiledArtifactSetSha256: anchor.compiledArtifactSetSha256,
        }, null, 2));
      } finally { closePrepared(preparedAnchor); }
      return;
    }
    // verify-anchor is deliberately temp-free: all recompilation remains in memory.
    const packSnapshots = readPackSnapshots(labelPrepared.labelDir); assertPackEqualsBuilt(packSnapshots, built);
    const anchorSnapshot = secureExternalSnapshot(options.anchor, "p0_anchor", labelPrepared.labelDirReal);
    assertDistinctSnapshots([...packSnapshots.entries(), ...inputs.snapshots, ["p0Anchor", anchorSnapshot]], "verify_authority_alias");
    const verified = validateAnchorSnapshot(anchorSnapshot, options.expectedP0Anchor, packSnapshots, inputs, context);
    await runAnchoredAuditor(options, context, built.manifest.expectedCanonicalHash);
    await testBarrier("verify_final_revalidate", anchorSnapshot.filePath);
    await awaitRevalidationBarriers({ inputs, context, packSnapshots, labelPrepared, anchorSnapshot });
    revalidateLabelDirectory(labelPrepared); revalidateSealedInputs(inputs); revalidateContext(context); revalidatePackSnapshots(packSnapshots); revalidateSnapshot(anchorSnapshot, "p0_anchor");
    console.log(JSON.stringify({
      status: "passed", mode: "verify-anchor", anchor: anchorSnapshot.filePath, frozen: true, externallyVerified: true,
      candidateP0PackCanonicalSha256: verified.anchor.candidateP0PackCanonicalSha256, parentP0AnchorSha256: verified.actualHash,
    }, null, 2));
  } finally { closePrepared(labelPrepared); }
}

try { await main(); }
catch (error) {
  const detail = error?.message || String(error);
  console.log(JSON.stringify({ status: "failed", mode: process.argv[2] || null, errors: [{ code: detail.split(":", 1)[0] || "manual_pack_error", detail }] }, null, 2));
  process.exitCode = 1;
}
