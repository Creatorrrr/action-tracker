#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULTS = {
  contract: "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json",
  schema: "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json",
  sourceContract: "tests/fixtures/sam-goal-v2/source-contract.json",
  sourceSchema: "tests/fixtures/sam-goal-v2/source-schema.json",
  sourceInventory: "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
  decoderManifest: "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl",
};
const ACCEPTED = {
  contract: "7a7f26a4734d0c971ecc2bef542dd05da11d67134478a2db286e1cd242bb5897",
  schema: "38759400e1e5aacb1b06bf3b052a5af8f693366dfa93653d0520280723c8e146",
  sourceContract: "39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873",
  sourceSchema: "ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244",
  sourceInventory: "64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d",
  decoderBytes: "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79",
  decoderRows: "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d",
};
const SHA_RE = /^[0-9a-f]{64}$/;
const TICKS_RE = /^(0|[1-9][0-9]*)$/;
const JSON_ARTIFACTS = ["manualWindows", "manualPolicy", "manualSummary"];
const JSONL_ARTIFACTS = ["manualLabels", "manualSubjectSelection", "manualReviewPass1", "manualReviewPass2", "manualAdjudication"];
const OBSERVABILITY_FIELDS = [
  "occlusion.body", "occlusion.leftFoot", "occlusion.rightFoot", "occlusion.leftHand", "occlusion.rightHand",
  "handObservability.left", "handObservability.right",
  "endpointObservability.leftWrist", "endpointObservability.rightWrist", "endpointObservability.leftAnkle", "endpointObservability.rightAnkle", "endpointObservability.head",
];

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-label-audit-v2.mjs --label-dir <path> --phase <p0|p1> [options]
  node scripts/sam-goal-label-audit-v2.mjs --hash-json <path>

Options:
  --contract <path>                    Default: ${DEFAULTS.contract}
  --schema <path>                      Default: ${DEFAULTS.schema}
  --source-contract <path>             Default: ${DEFAULTS.sourceContract}
  --source-schema <path>               Default: ${DEFAULTS.sourceSchema}
  --source-inventory <path>            Default: ${DEFAULTS.sourceInventory}
  --decoder-manifest <path>            Default: ${DEFAULTS.decoderManifest}
  --label-dir <path>                   Directory containing the v2 pack.
  --phase <p0|p1>                      Required for audit.
  --expected-p0-lock-sha256 <sha256>   External anchor required to verify P0 and for all P1 audits.
  --output <path>                      Optional atomic audit report output.
  --hash-json <path>                   Print root-only canonical SHA-256 and exit.
  --help`);
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, labelDir: "", phase: "", expectedP0: "", output: "", hashJson: "" };
  const names = new Map([
    ["--contract", "contract"], ["--schema", "schema"], ["--source-contract", "sourceContract"],
    ["--source-schema", "sourceSchema"], ["--source-inventory", "sourceInventory"], ["--decoder-manifest", "decoderManifest"],
    ["--label-dir", "labelDir"], ["--phase", "phase"], ["--expected-p0-lock-sha256", "expectedP0"],
    ["--output", "output"], ["--hash-json", "hashJson"],
  ]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { usage(); process.exit(0); }
    const key = names.get(arg);
    if (!key) throw new Error(`unknown_argument:${arg}`);
    if (seen.has(key)) throw new Error(`duplicate_argument:${arg}`);
    seen.add(key);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
    options[key] = value;
  }
  if (options.hashJson) return options;
  if (!options.labelDir) throw new Error("label_dir_required");
  if (!new Set(["p0", "p1"]).has(options.phase)) throw new Error(`phase_invalid:${options.phase}`);
  if (options.expectedP0 && !SHA_RE.test(options.expectedP0)) throw new Error("expected_p0_lock_invalid");
  if (options.phase === "p1" && !options.expectedP0) throw new Error("expected_p0_lock_required:p1");
  return options;
}

function resolvePath(value) { return path.isAbsolute(value) ? path.normalize(value) : path.resolve(REPO_ROOT, value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  return value;
}
function canonicalHash(value, omitRootExpected = false) {
  let target = value;
  if (omitRootExpected && value && typeof value === "object" && !Array.isArray(value)) {
    target = { ...value }; delete target.expectedCanonicalHash;
  }
  return sha256(Buffer.from(JSON.stringify(stableValue(target)), "utf8"));
}
function stableEqual(left, right) { return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)); }
function assertFile(filePath, label) { if (!existsSync(filePath)) throw new Error(`artifact_missing:${label}:${filePath}`); }
function readJson(filePath, label = path.basename(filePath)) {
  assertFile(filePath, label);
  try { return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); }
  catch (error) { throw new Error(`json_invalid:${label}:${error.message}`); }
}
function readJsonl(filePath, label = path.basename(filePath), allowEmpty = false) {
  assertFile(filePath, label);
  const rows = [];
  readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); }
    catch (error) { throw new Error(`jsonl_invalid:${label}:${index + 1}:${error.message}`); }
  });
  if (!allowEmpty && !rows.length) throw new Error(`jsonl_empty:${label}`);
  return rows;
}
function verifySelfHash(value, label) {
  if (!SHA_RE.test(value?.expectedCanonicalHash || "")) throw new Error(`self_hash_missing:${label}`);
  const actual = canonicalHash(value, true);
  if (actual !== value.expectedCanonicalHash) throw new Error(`self_hash_drift:${label}:${value.expectedCanonicalHash}:${actual}`);
  return actual;
}
function atomicWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try { writeFileSync(temp, value); renameSync(temp, filePath); } finally { rmSync(temp, { force: true }); }
}

function validateSchemaValue(root, schema, value, at) {
  if (schema === true) return;
  if (schema === false) throw new Error(`schema_validation:${at}:false_schema`);
  if (schema.$ref) {
    const prefix = "#/$defs/";
    if (!schema.$ref.startsWith(prefix) || !root.$defs?.[schema.$ref.slice(prefix.length)]) throw new Error(`schema_validation:${at}:bad_ref`);
    validateSchemaValue(root, root.$defs[schema.$ref.slice(prefix.length)], value, at);
  }
  if (schema.oneOf) {
    let matches = 0;
    for (const branch of schema.oneOf) { try { validateSchemaValue(root, branch, value, at); matches += 1; } catch { /* expected branch miss */ } }
    if (matches !== 1) throw new Error(`schema_validation:${at}:oneOf:${matches}`);
  }
  if (schema.allOf) schema.allOf.forEach((branch) => validateSchemaValue(root, branch, value, at));
  if (Object.hasOwn(schema, "const") && !stableEqual(value, schema.const)) throw new Error(`schema_validation:${at}:const`);
  if (schema.enum && !schema.enum.some((entry) => stableEqual(entry, value))) throw new Error(`schema_validation:${at}:enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches = (type) => ({
      object: value !== null && typeof value === "object" && !Array.isArray(value), array: Array.isArray(value), string: typeof value === "string",
      integer: Number.isSafeInteger(value), number: typeof value === "number" && Number.isFinite(value), boolean: typeof value === "boolean", null: value === null,
    }[type]);
    if (!types.some(matches)) throw new Error(`schema_validation:${at}:type:${types.join("|")}`);
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
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(stableValue(item)))).size !== value.length) throw new Error(`schema_validation:${at}:uniqueItems`);
    if (schema.items !== undefined) value.forEach((item, index) => validateSchemaValue(root, schema.items, item, `${at}/${index}`));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new Error(`schema_validation:${at}:required:${key}`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) throw new Error(`schema_validation:${at}:minProperties`);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) validateSchemaValue(root, properties[key], child, `${at}/${key}`);
      else if (schema.additionalProperties === false) throw new Error(`schema_validation:${at}:additional:${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateSchemaValue(root, schema.additionalProperties, child, `${at}/${key}`);
    }
  }
}
function validateArtifact(schema, def, value, at) {
  if (!schema.$defs?.[def]) throw new Error(`schema_definition_missing:${def}`);
  validateSchemaValue(schema, schema.$defs[def], value, at);
}

function normalized(value) { return String(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function scanForbidden(value, contract, at = "artifact") {
  const tokens = contract.forbiddenDurableFamilies.map(normalized);
  const wallClock = new Set(contract.canonicalization.wallClockKeysForbidden.map(normalized));
  function visit(child, cursor) {
    if (Array.isArray(child)) { child.forEach((entry, index) => visit(entry, `${cursor}/${index}`)); return; }
    if (child && typeof child === "object") {
      for (const [key, nested] of Object.entries(child)) {
        const token = normalized(key);
        if (wallClock.has(token)) throw new Error(`wall_clock_forbidden:${cursor}/${key}`);
        if (tokens.some((forbidden) => token.includes(forbidden))) throw new Error(`forbidden_input_key:${cursor}/${key}`);
        visit(nested, `${cursor}/${key}`);
      }
      return;
    }
    if (typeof child === "string") {
      const token = normalized(child);
      if (tokens.some((forbidden) => token.includes(forbidden))) throw new Error(`forbidden_input_value:${cursor}:${child}`);
    }
  }
  visit(value, at);
}

function identityFromDecoder(row) {
  return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch };
}
function identityKey(identity) {
  return `${identity.clipId}\u0000${identity.sourceFrameIndex}\u0000${identity.ptsTicks}\u0000${identity.timeBase?.numerator}/${identity.timeBase?.denominator}\u0000${identity.loopEpoch}`;
}
function valueAt(value, dotted) { return dotted.split(".").reduce((current, key) => current?.[key], value); }

function loadPinnedInputs(options) {
  const paths = Object.fromEntries(["contract", "schema", "sourceContract", "sourceSchema", "sourceInventory", "decoderManifest"].map((key) => [key, resolvePath(options[key])]));
  const contract = readJson(paths.contract, "evaluation_contract_v2");
  const schema = readJson(paths.schema, "label_schema_v2");
  const contractHash = canonicalHash(contract, true);
  const schemaHash = canonicalHash(schema);
  if (contract.expectedCanonicalHash !== contractHash || contractHash !== ACCEPTED.contract) throw new Error(`contract_hash_drift:${contractHash}`);
  if (schemaHash !== contract.labelSchema?.canonicalSha256 || schemaHash !== ACCEPTED.schema) throw new Error(`schema_hash_drift:${schemaHash}`);
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") throw new Error("schema_draft_invalid");

  const sourceContract = readJson(paths.sourceContract, "source_contract");
  const sourceSchema = readJson(paths.sourceSchema, "source_schema");
  const sourceInventory = readJson(paths.sourceInventory, "source_inventory");
  const sourceContractHash = canonicalHash(sourceContract, true);
  const sourceSchemaHash = canonicalHash(sourceSchema);
  const sourceInventoryHash = canonicalHash(sourceInventory, true);
  if (sourceContractHash !== ACCEPTED.sourceContract || sourceContractHash !== contract.sourceBinding.sourceContract.canonicalSha256) throw new Error("source_contract_hash_drift");
  if (sourceSchemaHash !== ACCEPTED.sourceSchema || sourceSchemaHash !== contract.sourceBinding.sourceSchema.canonicalSha256) throw new Error("source_schema_hash_drift");
  if (sourceInventoryHash !== ACCEPTED.sourceInventory || sourceInventoryHash !== sourceInventory.expectedCanonicalHash || sourceInventoryHash !== contract.sourceBinding.sourceInventory.canonicalSha256) throw new Error("source_inventory_hash_drift");

  const decoderBytes = readFileSync(paths.decoderManifest);
  const decoderByteHash = sha256(decoderBytes);
  const decoderRows = readJsonl(paths.decoderManifest, "decoder_manifest");
  const decoderRowsHash = canonicalHash(decoderRows);
  if (decoderRows.length !== 6711 || decoderByteHash !== ACCEPTED.decoderBytes || decoderRowsHash !== ACCEPTED.decoderRows) throw new Error("decoder_identity_drift");
  if (decoderByteHash !== contract.sourceBinding.decoderManifest.byteSha256 || decoderRowsHash !== contract.sourceBinding.decoderManifest.canonicalRowsSha256) throw new Error("decoder_contract_drift");
  decoderRows.forEach((row, index) => validateArtifact(schema, "decoderRow", row, `decoder/${index}`));

  const decoderByClip = new Map();
  const decoderByIdentity = new Map();
  for (const row of decoderRows) {
    const key = identityKey(identityFromDecoder(row));
    if (decoderByIdentity.has(key)) throw new Error(`decoder_duplicate:${key}`);
    decoderByIdentity.set(key, row);
    if (!decoderByClip.has(row.clipId)) decoderByClip.set(row.clipId, []);
    decoderByClip.get(row.clipId).push(row);
  }
  for (const expected of contract.sourceBinding.paired) {
    const rows = decoderByClip.get(expected.clipId) || [];
    if (rows.length !== expected.rows || rows[0]?.ptsTicks !== expected.startPtsTicks || `${BigInt(rows.at(-1)?.ptsTicks || 0) + 1n}` !== expected.endPtsTicksExclusive) throw new Error(`decoder_clip_binding_drift:${expected.clipId}`);
  }
  if (decoderByClip.has(contract.sourceBinding.unpaired.clipId)) throw new Error("unpaired_leakage:decoder");
  return { paths, contract, schema, contractHash, schemaHash, sourceInventoryHash, decoderBytes, decoderByteHash, decoderRows, decoderRowsHash, decoderByClip, decoderByIdentity };
}

function validateBoundary(clipRows, ptsTicks, allowTerminal, label) {
  if (!TICKS_RE.test(ptsTicks || "")) throw new Error(`boundary_invalid:${label}:${ptsTicks}`);
  if (clipRows.some((row) => row.ptsTicks === ptsTicks)) return;
  const terminal = `${BigInt(clipRows.at(-1).ptsTicks) + 1n}`;
  if (allowTerminal && ptsTicks === terminal) return;
  throw new Error(`boundary_not_decoder_pts:${label}:${ptsTicks}`);
}

function materializeSpan(span, context, label) {
  if (span.kind === "frame") {
    const key = identityKey(span.identity);
    if (!context.decoderByIdentity.has(key)) throw new Error(`frame_identity_unknown:${label}:${key}`);
    return [context.decoderByIdentity.get(key)];
  }
  if (span.kind !== "interval") throw new Error(`span_kind_invalid:${label}:${span.kind}`);
  if (span.loopEpoch !== 0) throw new Error(`loop_epoch_invalid:${label}`);
  const clipRows = context.decoderByClip.get(span.clipId);
  if (!clipRows) throw new Error(`interval_clip_unknown:${label}:${span.clipId}`);
  validateBoundary(clipRows, span.startPtsTicks, false, `${label}:start`);
  validateBoundary(clipRows, span.endPtsTicksExclusive, true, `${label}:end`);
  const start = BigInt(span.startPtsTicks);
  const end = BigInt(span.endPtsTicksExclusive);
  if (end <= start) throw new Error(`interval_empty:${label}`);
  const rows = clipRows.filter((row) => BigInt(row.ptsTicks) >= start && BigInt(row.ptsTicks) < end);
  if (!rows.length) throw new Error(`interval_no_decoder_rows:${label}`);
  return rows;
}

function loadWindows(labelDir, context) {
  const filePath = path.join(labelDir, context.contract.artifacts.manualWindows);
  const pack = readJson(filePath, "manual_windows");
  scanForbidden(pack, context.contract, "manualWindows");
  validateArtifact(context.schema, "windowPack", pack, "manualWindows");
  verifySelfHash(pack, "manualWindows");
  const purposeSet = new Set(context.contract.manualWindows.purposeTags);
  const scenarioSet = new Set(context.contract.scenarioTaxonomy);
  const seenIds = new Set();
  const memberships = new Map(context.decoderRows.map((row) => [identityKey(identityFromDecoder(row)), []]));
  const baseByClip = new Map();
  for (const window of pack.windows) {
    if (seenIds.has(window.windowId)) throw new Error(`window_id_duplicate:${window.windowId}`);
    seenIds.add(window.windowId);
    if (!context.decoderByClip.has(window.clipId)) throw new Error(`window_clip_unpaired_or_unknown:${window.clipId}`);
    if (window.purposeTags.some((tag) => !purposeSet.has(tag))) throw new Error(`window_purpose_open:${window.windowId}`);
    if (window.scenarioTags.some((tag) => !scenarioSet.has(tag))) throw new Error(`scenario_open:${window.windowId}`);
    const span = { kind: "interval", clipId: window.clipId, startPtsTicks: window.startPtsTicks, endPtsTicksExclusive: window.endPtsTicksExclusive, loopEpoch: 0 };
    const rows = materializeSpan(span, context, `window:${window.windowId}`);
    if (rows.length !== window.expectedDecoderRows) throw new Error(`window_row_count_drift:${window.windowId}:${rows.length}:${window.expectedDecoderRows}`);
    for (const row of rows) memberships.get(identityKey(identityFromDecoder(row))).push(window.windowId);
    if (window.purposeTags.includes(context.contract.manualWindows.basePurposeTag)) {
      if (window.purposeTags.length !== 1) throw new Error(`base_window_mixed_purpose:${window.windowId}`);
      if (baseByClip.has(window.clipId)) throw new Error(`base_window_duplicate:${window.clipId}`);
      baseByClip.set(window.clipId, window);
    }
  }
  if (baseByClip.size !== 7) throw new Error(`base_window_count:${baseByClip.size}`);
  for (const expected of context.contract.sourceBinding.paired) {
    const base = baseByClip.get(expected.clipId);
    if (!base || base.startPtsTicks !== expected.startPtsTicks || base.endPtsTicksExclusive !== expected.endPtsTicksExclusive || base.expectedDecoderRows !== expected.rows) throw new Error(`base_window_binding:${expected.clipId}`);
  }
  if ([...memberships.values()].some((ids) => !ids.some((id) => pack.windows.find((window) => window.windowId === id)?.purposeTags.includes(context.contract.manualWindows.basePurposeTag)))) throw new Error("base_denominator_hole");
  for (const ids of memberships.values()) ids.sort();
  return { pack, filePath, memberships };
}

function materializeRows(rows, definition, context, windows, label) {
  const materialized = new Map();
  const sourceByIdentity = new Map();
  const seenIds = new Set();
  rows.forEach((row, index) => {
    scanForbidden(row, context.contract, `${label}/${index}`);
    validateArtifact(context.schema, definition, row, `${label}/${index}`);
    const rowId = row.labelId || row.selectionId;
    if (rowId && seenIds.has(rowId)) throw new Error(`${label}_id_duplicate:${rowId}`);
    if (rowId) seenIds.add(rowId);
    const identities = materializeSpan(row.span, context, `${label}/${index}`);
    if (row.span.kind === "interval") {
      const membershipSets = new Set(identities.map((decoder) => JSON.stringify(windows.memberships.get(identityKey(identityFromDecoder(decoder))))));
      if (membershipSets.size !== 1) throw new Error(`window_membership_crossing:${label}:${index}`);
    }
    for (const decoder of identities) {
      const key = identityKey(identityFromDecoder(decoder));
      if (materialized.has(key)) throw new Error(`${label}_overlap:${key}`);
      materialized.set(key, row);
      sourceByIdentity.set(key, decoder);
    }
  });
  if (materialized.size !== context.decoderRows.length) throw new Error(`${label}_coverage:${materialized.size}:${context.decoderRows.length}`);
  for (const decoder of context.decoderRows) if (!materialized.has(identityKey(identityFromDecoder(decoder)))) throw new Error(`${label}_hole:${identityKey(identityFromDecoder(decoder))}`);
  return { materialized, sourceByIdentity };
}

function stateFromFinal(label, subject) {
  return {
    presence: label.presence, personState: label.personState, occlusion: label.occlusion, contact: label.contact,
    handObservability: label.handObservability, endpointObservability: label.endpointObservability,
    subjectSelection: { state: subject.state, manualTargetId: subject.manualTargetId, anchor: subject.anchor },
  };
}

function assertManualTruth(label, subject, key, scenarioSet) {
  if (label.scenarios.some((scenario) => !scenarioSet.has(scenario))) throw new Error(`scenario_open:${key}`);
  const allEndpointsHidden = Object.values(label.endpointObservability).every((value) => value === "not_observable");
  if (label.presence === "absent") {
    if (label.personState !== "absent" || subject.state !== "absent" || label.contact.left !== "unknown" || label.contact.right !== "unknown" || label.handObservability.left !== "not_observable" || label.handObservability.right !== "not_observable" || !allEndpointsHidden) throw new Error(`truth_absent:${key}`);
  }
  for (const foot of ["left", "right"]) {
    if (label.contact[foot] !== "unknown" && (label.presence !== "present" || label.occlusion[`${foot}Foot`] !== "observable")) throw new Error(`truth_contact:${key}:${foot}`);
  }
  for (const hand of ["left", "right"]) {
    const wrist = `${hand}Wrist`;
    if (label.handObservability[hand] === "observable" && (!["observable", "partial"].includes(label.occlusion[`${hand}Hand`]) || label.endpointObservability[wrist] !== "observable")) throw new Error(`truth_hand:${key}:${hand}`);
  }
  const endpointPart = { leftWrist: "leftHand", rightWrist: "rightHand", leftAnkle: "leftFoot", rightAnkle: "rightFoot", head: "body" };
  for (const [endpoint, part] of Object.entries(endpointPart)) {
    if (label.endpointObservability[endpoint] === "observable" && ["occluded", "out_of_frame", "unknown"].includes(label.occlusion[part])) throw new Error(`truth_endpoint:${key}:${endpoint}`);
  }
  if (subject.state === "selected") {
    if (!(typeof subject.manualTargetId === "string" && subject.manualTargetId)) throw new Error(`subject_target_required:${key}`);
  } else if (subject.manualTargetId !== null || subject.anchor !== null) throw new Error(`subject_nonselected_payload:${key}`);
  if (label.personState === "multiple_people") {
    if (!((subject.state === "selected" && subject.anchor !== null) || subject.state === "ambiguous")) throw new Error(`truth_multiple_people:${key}`);
  }
  if (label.personState === "single_target" && subject.state !== "selected") throw new Error(`truth_single_target:${key}`);
}

function assertReviewStateTruth(state, key) {
  const subject = state.subjectSelection;
  const endpointsHidden = Object.values(state.endpointObservability).every((value) => value === "not_observable");
  if (state.presence === "absent" && (state.personState !== "absent" || subject.state !== "absent" || state.contact.left !== "unknown" || state.contact.right !== "unknown" || state.handObservability.left !== "not_observable" || state.handObservability.right !== "not_observable" || !endpointsHidden)) throw new Error(`review_truth_absent:${key}`);
  for (const foot of ["left", "right"]) if (state.contact[foot] !== "unknown" && (state.presence !== "present" || state.occlusion[`${foot}Foot`] !== "observable")) throw new Error(`review_truth_contact:${key}:${foot}`);
  for (const hand of ["left", "right"]) if (state.handObservability[hand] === "observable" && (!["observable", "partial"].includes(state.occlusion[`${hand}Hand`]) || state.endpointObservability[`${hand}Wrist`] !== "observable")) throw new Error(`review_truth_hand:${key}:${hand}`);
  const endpointPart = { leftWrist: "leftHand", rightWrist: "rightHand", leftAnkle: "leftFoot", rightAnkle: "rightFoot", head: "body" };
  for (const [endpoint, part] of Object.entries(endpointPart)) if (state.endpointObservability[endpoint] === "observable" && ["occluded", "out_of_frame", "unknown"].includes(state.occlusion[part])) throw new Error(`review_truth_endpoint:${key}:${endpoint}`);
  if (subject.state === "selected") {
    if (!(typeof subject.manualTargetId === "string" && subject.manualTargetId)) throw new Error(`review_subject_target_required:${key}`);
  } else if (subject.manualTargetId !== null || subject.anchor !== null) throw new Error(`review_subject_nonselected_payload:${key}`);
  if (state.personState === "multiple_people" && !((subject.state === "selected" && subject.anchor !== null) || subject.state === "ambiguous")) throw new Error(`review_truth_multiple_people:${key}`);
  if (state.personState === "single_target" && subject.state !== "selected") throw new Error(`review_truth_single_target:${key}`);
}

function loadManualArtifacts(labelDir, context, windows) {
  const files = {};
  for (const name of JSONL_ARTIFACTS) files[name] = path.join(labelDir, context.contract.artifacts[name]);
  for (const name of ["manualPolicy", "manualSummary"]) files[name] = path.join(labelDir, context.contract.artifacts[name]);
  const manualRows = readJsonl(files.manualLabels, "manual_labels");
  const subjectRows = readJsonl(files.manualSubjectSelection, "manual_subject_selection");
  const manual = materializeRows(manualRows, "manualLabel", context, windows, "manual_labels");
  const subjects = materializeRows(subjectRows, "subjectSelection", context, windows, "manual_subject_selection");
  const scenarioSet = new Set(context.contract.scenarioTaxonomy);
  const targetsByClip = new Map();
  for (const decoder of context.decoderRows) {
    const key = identityKey(identityFromDecoder(decoder));
    const label = manual.materialized.get(key);
    const subject = subjects.materialized.get(key);
    assertManualTruth(label, subject, key, scenarioSet);
    if (subject.state === "selected") {
      if (!targetsByClip.has(decoder.clipId)) targetsByClip.set(decoder.clipId, new Set());
      targetsByClip.get(decoder.clipId).add(subject.manualTargetId);
    }
  }
  for (const [clipId, targets] of targetsByClip) if (targets.size !== 1) throw new Error(`subject_target_unstable:${clipId}`);
  return { files, manualRows, subjectRows, manual, subjects };
}

function flattenState(state, prefix = "", output = {}) {
  for (const [key, value] of Object.entries(state)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flattenState(value, name, output);
    else output[name] = value;
  }
  return output;
}
function disagreementFields(left, right) {
  const a = flattenState(left); const b = flattenState(right);
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => !stableEqual(a[key], b[key])).sort();
}

function loadReviewRows(filePath, expectedPass, context) {
  const rows = readJsonl(filePath, `review_${expectedPass}`);
  if (rows.length !== context.decoderRows.length) throw new Error(`review_count:${expectedPass}:${rows.length}`);
  const map = new Map(); let reviewerHash = null; const targetsByClip = new Map();
  rows.forEach((row, index) => {
    scanForbidden(row, context.contract, `review/${expectedPass}/${index}`);
    validateArtifact(context.schema, "reviewRow", row, `review/${expectedPass}/${index}`);
    if (row.pass !== expectedPass) throw new Error(`review_pass_mismatch:${expectedPass}:${index}`);
    if (reviewerHash === null) reviewerHash = row.reviewerHash;
    if (row.reviewerHash !== reviewerHash) throw new Error(`reviewer_hash_mixed:${expectedPass}`);
    const key = identityKey(row.identity);
    if (!context.decoderByIdentity.has(key)) throw new Error(`review_identity_unknown:${expectedPass}:${key}`);
    if (map.has(key)) throw new Error(`review_duplicate:${expectedPass}:${key}`);
    assertReviewStateTruth(row.state, `${expectedPass}:${key}`);
    if (row.state.subjectSelection.state === "selected") {
      const clipId = row.identity.clipId;
      if (!targetsByClip.has(clipId)) targetsByClip.set(clipId, new Set());
      targetsByClip.get(clipId).add(row.state.subjectSelection.manualTargetId);
    }
    map.set(key, row);
  });
  if (map.size !== context.decoderRows.length) throw new Error(`review_hole:${expectedPass}`);
  for (const [clipId, targets] of targetsByClip) if (targets.size !== 1) throw new Error(`review_subject_target_unstable:${expectedPass}:${clipId}`);
  return { rows, map, reviewerHash };
}

function cohenKappa(left, right) {
  if (left.length !== right.length || !left.length) throw new Error("kappa_input_invalid");
  const categories = [...new Set([...left, ...right])];
  let agreements = 0;
  const leftCounts = new Map(); const rightCounts = new Map();
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) agreements += 1;
    leftCounts.set(left[index], (leftCounts.get(left[index]) || 0) + 1);
    rightCounts.set(right[index], (rightCounts.get(right[index]) || 0) + 1);
  }
  const observed = agreements / left.length;
  const expected = categories.reduce((sum, category) => sum + ((leftCounts.get(category) || 0) / left.length) * ((rightCounts.get(category) || 0) / right.length), 0);
  if (expected === 1) return observed === 1 ? 1 : 0;
  return (observed - expected) / (1 - expected);
}
function average(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function computeAgreement(first, second, context) {
  const presence = []; const contact = []; const observability = [];
  for (const [clipId, decoderRows] of context.decoderByClip) {
    const firstStates = decoderRows.map((row) => first.map.get(identityKey(identityFromDecoder(row))).state);
    const secondStates = decoderRows.map((row) => second.map.get(identityKey(identityFromDecoder(row))).state);
    presence.push(cohenKappa(firstStates.map((state) => `${state.presence}|${state.personState}`), secondStates.map((state) => `${state.presence}|${state.personState}`)));
    for (const foot of ["left", "right"]) contact.push(cohenKappa(firstStates.map((state) => state.contact[foot]), secondStates.map((state) => state.contact[foot])));
    for (const field of OBSERVABILITY_FIELDS) observability.push(cohenKappa(firstStates.map((state) => valueAt(state, field)), secondStates.map((state) => valueAt(state, field))));
    if (!clipId) throw new Error("clip_id_empty");
  }
  return { presencePersonStateKappa: average(presence), contactKappa: average(contact), observabilityKappa: average(observability) };
}

function auditReviews(manualArtifacts, context) {
  const first = loadReviewRows(manualArtifacts.files.manualReviewPass1, "first", context);
  const second = loadReviewRows(manualArtifacts.files.manualReviewPass2, "second", context);
  if (first.reviewerHash === second.reviewerHash) throw new Error("reviewer_hash_not_distinct");
  const adjudicationRows = readJsonl(manualArtifacts.files.manualAdjudication, "manual_adjudication", true);
  const adjudication = new Map(); let adjudicatorHash = null;
  adjudicationRows.forEach((row, index) => {
    scanForbidden(row, context.contract, `adjudication/${index}`);
    validateArtifact(context.schema, "adjudicationRow", row, `adjudication/${index}`);
    if (adjudicatorHash === null) adjudicatorHash = row.adjudicatorHash;
    if (row.adjudicatorHash !== adjudicatorHash) throw new Error("adjudicator_hash_mixed");
    const key = identityKey(row.identity);
    if (!context.decoderByIdentity.has(key)) throw new Error(`adjudication_identity_unknown:${key}`);
    if (adjudication.has(key)) throw new Error(`adjudication_duplicate:${key}`);
    assertReviewStateTruth(row.decision, `adjudication:${key}`);
    adjudication.set(key, row);
  });
  if (adjudicatorHash && [first.reviewerHash, second.reviewerHash].includes(adjudicatorHash)) throw new Error("adjudicator_not_distinct");
  let disagreementCount = 0;
  for (const decoder of context.decoderRows) {
    const key = identityKey(identityFromDecoder(decoder));
    const firstState = first.map.get(key).state;
    const secondState = second.map.get(key).state;
    const finalState = stateFromFinal(manualArtifacts.manual.materialized.get(key), manualArtifacts.subjects.materialized.get(key));
    const fields = disagreementFields(firstState, secondState);
    const adjudicated = adjudication.get(key);
    if (fields.length) {
      disagreementCount += 1;
      if (!adjudicated) throw new Error(`adjudication_missing:${key}`);
      if (!stableEqual([...adjudicated.disagreementFields].sort(), fields)) throw new Error(`adjudication_fields_mismatch:${key}`);
      if (!stableEqual(adjudicated.decision, finalState)) throw new Error(`adjudication_final_mismatch:${key}`);
    } else {
      if (adjudicated) throw new Error(`adjudication_without_disagreement:${key}`);
      if (!stableEqual(firstState, finalState)) throw new Error(`final_label_pass_mismatch:${key}`);
    }
  }
  if (adjudication.size !== disagreementCount) throw new Error("adjudication_count_mismatch");
  const agreement = computeAgreement(first, second, context);
  const minimum = context.contract.manualReview.agreement.minimum;
  for (const [name, floor] of Object.entries(minimum)) if (agreement[name] + 1e-12 < floor) throw new Error(`agreement_below_floor:${name}:${agreement[name]}:${floor}`);
  return { first, second, adjudicationRows, adjudicatorHash, disagreementCount, agreement };
}

function computeContactSupport(manualArtifacts, context, eligibility = null) {
  const support = { left: { planted: { frames: 0, clips: new Set() }, moving: { frames: 0, clips: new Set() } }, right: { planted: { frames: 0, clips: new Set() }, moving: { frames: 0, clips: new Set() } } };
  const excluded = { left: { unknown: 0, unobservable: 0 }, right: { unknown: 0, unobservable: 0 } };
  for (const decoder of context.decoderRows) {
    const key = identityKey(identityFromDecoder(decoder));
    const label = manualArtifacts.manual.materialized.get(key);
    for (const foot of ["left", "right"]) {
      const known = ["planted", "moving"].includes(label.contact[foot]);
      const observable = label.occlusion[`${foot}Foot`] === "observable";
      if (!known) { excluded[foot].unknown += 1; continue; }
      if (!observable) { excluded[foot].unobservable += 1; continue; }
      if (eligibility && !eligibility.get(key)?.[foot]) continue;
      const cell = support[foot][label.contact[foot]];
      cell.frames += 1; cell.clips.add(decoder.clipId);
    }
  }
  return {
    support: Object.fromEntries(Object.entries(support).map(([foot, classes]) => [foot, Object.fromEntries(Object.entries(classes).map(([name, cell]) => [name, { frames: cell.frames, clips: [...cell.clips].sort() }]))])),
    excluded,
  };
}

function enforceContactSupport(result, minimumFrames, minimumClips, prefix) {
  for (const foot of ["left", "right"]) for (const contact of ["planted", "moving"]) {
    const cell = result.support[foot][contact];
    if (cell.frames < minimumFrames) throw new Error(`${prefix}_contact_frames:${foot}:${contact}:${cell.frames}:${minimumFrames}`);
    if (cell.clips.length < minimumClips) throw new Error(`${prefix}_contact_clips:${foot}:${contact}:${cell.clips.length}:${minimumClips}`);
  }
}

function isReacquireBad(label, subject) {
  const absent = label.presence === "absent" && subject.state === "absent";
  const unreliable = label.presence === "unknown" || ["ambiguous", "unknown"].includes(subject.state) || ["occluded", "out_of_frame", "unknown"].includes(label.occlusion.body);
  return absent || unreliable;
}
function isReliable(label, subject) { return label.presence === "present" && subject.state === "selected" && ["observable", "partial"].includes(label.occlusion.body); }

function materializeReacquireEvents(manualArtifacts, context) {
  const hard = new Set(context.contract.clipInventory.filter((clip) => clip.role === "hard_test").map((clip) => clip.clipId));
  const events = [];
  for (const clipId of hard) {
    const rows = context.decoderByClip.get(clipId);
    let index = 0;
    while (index < rows.length) {
      const key = identityKey(identityFromDecoder(rows[index]));
      if (!isReacquireBad(manualArtifacts.manual.materialized.get(key), manualArtifacts.subjects.materialized.get(key))) { index += 1; continue; }
      const startIndex = index;
      while (index < rows.length) {
        const currentKey = identityKey(identityFromDecoder(rows[index]));
        if (!isReacquireBad(manualArtifacts.manual.materialized.get(currentKey), manualArtifacts.subjects.materialized.get(currentKey))) break;
        index += 1;
      }
      if (index >= rows.length) break;
      const endIndex = index;
      const separatorKey = identityKey(identityFromDecoder(rows[endIndex]));
      const separatorLabel = manualArtifacts.manual.materialized.get(separatorKey);
      const separatorSubject = manualArtifacts.subjects.materialized.get(separatorKey);
      if (!isReliable(separatorLabel, separatorSubject) && separatorLabel.presence !== "present") throw new Error(`reacquire_state_predicate_gap:${separatorKey}`);
      let reliableIndex = endIndex;
      while (reliableIndex < rows.length) {
        const candidateKey = identityKey(identityFromDecoder(rows[reliableIndex]));
        if (isReliable(manualArtifacts.manual.materialized.get(candidateKey), manualArtifacts.subjects.materialized.get(candidateKey))) break;
        reliableIndex += 1;
      }
      const start = rows[startIndex]; const end = rows[endIndex];
      const durationNumerator = (BigInt(end.ptsTicks) - BigInt(start.ptsTicks)) * BigInt(start.timeBase.numerator) * 1000n;
      const durationDenominator = BigInt(start.timeBase.denominator);
      if (reliableIndex < rows.length && durationNumerator >= BigInt(context.contract.reacquirePolicy.minimumUnreliableIntervalMs) * durationDenominator) {
        events.push({
          clipId, startIdentity: identityFromDecoder(start), endPtsTicksExclusive: end.ptsTicks, reliableStartIdentity: identityFromDecoder(rows[reliableIndex]),
          durationMs: Number(durationNumerator) / Number(durationDenominator),
        });
      }
      index = endIndex;
    }
  }
  const byReliableStart = new Map();
  for (const event of events) {
    const startKey = identityKey(event.reliableStartIdentity);
    const previous = byReliableStart.get(startKey);
    if (!previous || BigInt(event.startIdentity.ptsTicks) > BigInt(previous.startIdentity.ptsTicks)) byReliableStart.set(startKey, event);
  }
  const deduplicated = [...byReliableStart.values()];
  if (deduplicated.length < context.contract.reacquirePolicy.minimumP0CandidateEvents) throw new Error(`reacquire_event_count:${deduplicated.length}`);
  const hardClipCount = new Set(deduplicated.map((event) => event.clipId)).size;
  if (hardClipCount < context.contract.reacquirePolicy.minimumHardTestClips) throw new Error(`reacquire_hard_clip_count:${hardClipCount}`);
  return deduplicated;
}

function auditPolicyAndSummary(manualArtifacts, reviews, context) {
  const policy = readJson(manualArtifacts.files.manualPolicy, "manual_policy");
  const summary = readJson(manualArtifacts.files.manualSummary, "manual_summary");
  scanForbidden(policy, context.contract, "manualPolicy"); scanForbidden(summary, context.contract, "manualSummary");
  validateArtifact(context.schema, "manualPolicy", policy, "manualPolicy");
  validateArtifact(context.schema, "manualSummary", summary, "manualSummary");
  verifySelfHash(policy, "manualPolicy"); verifySelfHash(summary, "manualSummary");
  if (policy.contractCanonicalSha256 !== context.contractHash || policy.schemaCanonicalSha256 !== context.schemaHash) throw new Error("manual_policy_binding");
  if ([policy.reviewerHashes.first, policy.reviewerHashes.second, policy.reviewerHashes.adjudicator].some((hash) => !SHA_RE.test(hash)) || new Set(Object.values(policy.reviewerHashes)).size !== 3) throw new Error("manual_policy_reviewers_not_distinct");
  if (policy.reviewerHashes.first !== reviews.first.reviewerHash || policy.reviewerHashes.second !== reviews.second.reviewerHash) throw new Error("manual_policy_reviewers");
  if (reviews.adjudicatorHash && policy.reviewerHashes.adjudicator !== reviews.adjudicatorHash) throw new Error("manual_policy_adjudicator");
  const expectedThresholds = {
    presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95,
    preMaskContactFrames: 300, preMaskContactClips: 2, p0ReacquireEvents: 3, p0ReacquireHardTestClips: 2,
  };
  if (!stableEqual(policy.thresholds, expectedThresholds)) throw new Error("manual_policy_thresholds");
  const expectedPerClip = context.contract.sourceBinding.paired.map((clip) => ({
    clipId: clip.clipId, decoderRows: clip.rows, manualRows: clip.rows, subjectRows: clip.rows, reviewPass1Rows: clip.rows, reviewPass2Rows: clip.rows,
  }));
  if (!stableEqual(summary.perClip, expectedPerClip)) throw new Error("manual_summary_per_clip");
  return { policy, summary };
}

function descriptorForJson(filePath) { return { path: path.basename(filePath), canonicalSha256: canonicalHash(readJson(filePath), true) }; }
function descriptorForBytes(filePath) { assertFile(filePath, path.basename(filePath)); return { path: path.basename(filePath), byteSha256: sha256(readFileSync(filePath)) }; }
function expectedP0Descriptors(labelDir, context, manualArtifacts, windows) {
  return {
    contract: { path: context.contract.labelSchema.path.replace(/label-schema\.json$/, "evaluation-contract.json"), canonicalSha256: context.contractHash },
    schema: { path: context.contract.labelSchema.path, canonicalSha256: context.schemaHash },
    sourceInventory: { path: context.contract.sourceBinding.sourceInventory.path, canonicalSha256: context.sourceInventoryHash },
    decoderManifest: { path: context.contract.sourceBinding.decoderManifest.path, byteSha256: context.decoderByteHash },
    manualWindows: descriptorForJson(windows.filePath),
    manualLabels: descriptorForBytes(manualArtifacts.files.manualLabels),
    manualSubjectSelection: descriptorForBytes(manualArtifacts.files.manualSubjectSelection),
    manualReviewPass1: descriptorForBytes(manualArtifacts.files.manualReviewPass1),
    manualReviewPass2: descriptorForBytes(manualArtifacts.files.manualReviewPass2),
    manualAdjudication: descriptorForBytes(manualArtifacts.files.manualAdjudication),
    manualPolicy: descriptorForJson(manualArtifacts.files.manualPolicy),
    manualSummary: descriptorForJson(manualArtifacts.files.manualSummary),
  };
}

function auditPackManifest(labelDir, context, descriptors, expectedPhase, externalP0 = "") {
  const filePath = path.join(labelDir, context.contract.artifacts.packManifest);
  const manifest = readJson(filePath, "pack_manifest");
  scanForbidden(manifest, context.contract, "packManifest");
  validateArtifact(context.schema, "packManifest", manifest, "packManifest");
  const manifestHash = verifySelfHash(manifest, "packManifest");
  if (manifest.phase !== expectedPhase) throw new Error(`pack_phase:${manifest.phase}:${expectedPhase}`);
  if (!stableEqual(manifest.files, descriptors)) throw new Error("pack_descriptor_drift");
  if (expectedPhase === "p1" && manifest.parentP0LockSha256 !== externalP0) throw new Error("pack_parent_p0_mismatch");
  return { manifest, manifestHash, filePath };
}

function auditP0(options, context) {
  const labelDir = resolvePath(options.labelDir);
  const windows = loadWindows(labelDir, context);
  const manualArtifacts = loadManualArtifacts(labelDir, context, windows);
  const reviews = auditReviews(manualArtifacts, context);
  const contactSupport = computeContactSupport(manualArtifacts, context);
  enforceContactSupport(contactSupport, context.contract.contactPolicy.preMaskMinimumObservableKnownFramesPerFootAndClass, context.contract.contactPolicy.preMaskSupportMinimumClips, "pre_mask");
  const reacquireEvents = materializeReacquireEvents(manualArtifacts, context);
  const policySummary = auditPolicyAndSummary(manualArtifacts, reviews, context);
  const descriptors = expectedP0Descriptors(labelDir, context, manualArtifacts, windows);
  const pack = auditPackManifest(labelDir, context, descriptors, "p0");
  if (options.expectedP0 && pack.manifestHash !== options.expectedP0) throw new Error(`external_p0_lock_mismatch:${options.expectedP0}:${pack.manifestHash}`);
  return { labelDir, windows, manualArtifacts, reviews, contactSupport, reacquireEvents, policySummary, descriptors, pack };
}

function auditTeacherRow(row, label, subject, key) {
  const scope = row.scope;
  const anyScope = scope.torsoFacing || scope.fullBody || scope.calibration || scope.contactEligibility.left || scope.contactEligibility.right;
  const unavailableWarning = row.warningCodes.includes("native_joint_confidence_unavailable");
  if (row.confidenceAvailable || row.jointConfidenceSource !== "unavailable") throw new Error(`teacher_current_native_confidence_forbidden:${key}`);
  if (row.confidenceAvailable !== (row.jointConfidenceSource === "native")) throw new Error(`teacher_confidence_source:${key}`);
  if (!row.confidenceAvailable) {
    if (!unavailableWarning) throw new Error(`teacher_confidence_warning_missing:${key}`);
    if (scope.calibration) throw new Error(`teacher_confidence_calibration:${key}`);
  } else if (unavailableWarning) throw new Error(`teacher_confidence_warning_forbidden:${key}`);
  if (row.exclusionReasons.includes("confidence_unavailable")) throw new Error(`teacher_confidence_exclusion_forbidden:${key}`);
  if (row.valid) {
    if (row.teacherRecord !== "present" || row.selectedSubject !== "selected" || !anyScope || row.exclusionReasons.length) throw new Error(`teacher_valid_truth:${key}`);
  } else {
    if (anyScope || !row.exclusionReasons.length) throw new Error(`teacher_invalid_truth:${key}`);
  }
  if ((scope.torsoFacing || scope.fullBody || scope.calibration || scope.contactEligibility.left || scope.contactEligibility.right) && !row.valid) throw new Error(`teacher_scope_implies_valid:${key}`);
  if ((scope.contactEligibility.left || scope.contactEligibility.right) && !scope.fullBody) throw new Error(`teacher_contact_implies_full_body:${key}`);
  if (scope.calibration && !scope.fullBody) throw new Error(`teacher_calibration_implies_full_body:${key}`);
  if (scope.torsoFacing && !(row.geometry.finiteTorso && row.geometry.validTorsoBasis && row.manual.bodyObservable)) throw new Error(`teacher_torso_geometry:${key}`);
  if (scope.fullBody && !(row.geometry.finiteTorso && row.geometry.inFrameProjection && row.geometry.boneScaleSpeedTemporalGuards && row.manual.presence === "present" && row.manual.bodyObservable && row.manual.leftLegObservable && row.manual.rightLegObservable && row.selectedSubject === "selected")) throw new Error(`teacher_full_body_geometry:${key}`);
  for (const foot of ["left", "right"]) {
    if (!scope.contactEligibility[foot]) continue;
    const finiteChain = row.geometry[`finite${foot[0].toUpperCase()}${foot.slice(1)}LegChain`];
    if (!(row.manual.presence === "present" && row.manual[`${foot}FootObservable`] && ["planted", "moving"].includes(row.manual[`${foot}Contact`]) && finiteChain && row.geometry.boneScaleSpeedTemporalGuards)) throw new Error(`teacher_contact_truth:${key}:${foot}`);
  }
  const expectedManual = {
    presence: label.presence,
    bodyObservable: ["observable", "partial"].includes(label.occlusion.body),
    leftLegObservable: ["observable", "partial"].includes(label.occlusion.body) && label.occlusion.leftFoot === "observable",
    rightLegObservable: ["observable", "partial"].includes(label.occlusion.body) && label.occlusion.rightFoot === "observable",
    leftFootObservable: label.occlusion.leftFoot === "observable",
    rightFootObservable: label.occlusion.rightFoot === "observable",
    leftContact: label.contact.left,
    rightContact: label.contact.right,
  };
  if (!stableEqual(row.manual, expectedManual)) throw new Error(`teacher_manual_binding:${key}`);
  if (row.selectedSubject !== subject.state) throw new Error(`teacher_subject_binding:${key}`);
  if (row.detectorScoreProvenance !== "detector" && row.detectorScoreProvenance !== "unavailable") throw new Error(`teacher_detector_provenance:${key}`);
}

function auditTeacherMask(p0, context) {
  const filePath = path.join(p0.labelDir, context.contract.artifacts.teacherMask);
  const rows = readJsonl(filePath, "teacher_valid_mask");
  if (rows.length !== context.decoderRows.length) throw new Error(`teacher_mask_count:${rows.length}`);
  const map = new Map(); const eligibility = new Map();
  rows.forEach((row, index) => {
    scanForbidden(row, context.contract, `teacherMask/${index}`);
    validateArtifact(context.schema, "teacherMaskRow", row, `teacherMask/${index}`);
    const key = identityKey(row.identity);
    if (!context.decoderByIdentity.has(key)) throw new Error(`teacher_identity_unknown:${key}`);
    if (map.has(key)) throw new Error(`teacher_duplicate:${key}`);
    const label = p0.manualArtifacts.manual.materialized.get(key);
    const subject = p0.manualArtifacts.subjects.materialized.get(key);
    auditTeacherRow(row, label, subject, key);
    map.set(key, row); eligibility.set(key, row.scope.contactEligibility);
  });
  if (map.size !== context.decoderRows.length) throw new Error("teacher_mask_hole");
  const support = computeContactSupport(p0.manualArtifacts, context, eligibility);
  enforceContactSupport(support, context.contract.contactPolicy.postMaskMinimumTeacherValidFramesPerFootAndClass, 1, "post_mask");
  const p1Starts = [];
  for (const event of p0.reacquireEvents) {
    const clipRows = context.decoderByClip.get(event.clipId);
    const startTicks = BigInt(event.endPtsTicksExclusive);
    const start = clipRows.find((decoder) => {
      if (BigInt(decoder.ptsTicks) < startTicks) return false;
      const row = map.get(identityKey(identityFromDecoder(decoder)));
      return row.valid && row.manual.presence === "present";
    });
    if (start) p1Starts.push(identityFromDecoder(start));
  }
  if (p1Starts.length < context.contract.reacquirePolicy.minimumP0CandidateEvents) throw new Error(`p1_reacquire_start_count:${p1Starts.length}`);
  if (new Set(p1Starts.map((start) => start.clipId)).size < context.contract.reacquirePolicy.minimumHardTestClips) throw new Error("p1_reacquire_hard_clip_count");
  return { filePath, rows, map, eligibility, support, p1Starts, byteSha256: sha256(readFileSync(filePath)) };
}

function auditP1(options, context) {
  const p0 = auditP0({ ...options, expectedP0: options.expectedP0 }, context);
  const teacher = auditTeacherMask(p0, context);
  const p1Descriptors = { ...p0.descriptors, teacherMask: { path: path.basename(teacher.filePath), byteSha256: teacher.byteSha256 } };
  const p1PackPath = path.join(p0.labelDir, context.contract.artifacts.p1PackManifest);
  const manifest = readJson(p1PackPath, "pack_manifest_p1");
  scanForbidden(manifest, context.contract, "packManifestP1");
  validateArtifact(context.schema, "packManifest", manifest, "packManifestP1");
  const manifestHash = verifySelfHash(manifest, "packManifestP1");
  if (manifest.phase !== "p1" || manifest.parentP0LockSha256 !== options.expectedP0 || !stableEqual(manifest.files, p1Descriptors)) throw new Error("p1_pack_binding");
  const lockPath = path.join(p0.labelDir, context.contract.artifacts.p1Lock);
  const lock = readJson(lockPath, "evaluation_lock_p1");
  scanForbidden(lock, context.contract, "evaluationLockP1");
  validateArtifact(context.schema, "evaluationLock", lock, "evaluationLockP1");
  const lockHash = verifySelfHash(lock, "evaluationLockP1");
  if (lock.parentP0LockSha256 !== options.expectedP0 || lock.parentP0LockSha256 !== p0.pack.manifestHash) throw new Error("p1_parent_lock_mismatch");
  if (lock.teacherMaskSha256 !== teacher.byteSha256) throw new Error("p1_teacher_hash_mismatch");
  return { p0, teacher, p1Pack: { manifest, manifestHash, filePath: p1PackPath }, lock: { value: lock, hash: lockHash, filePath: lockPath } };
}

function makeReport(options, context, result, elapsedMs) {
  if (options.phase === "p0") {
    const verified = Boolean(options.expectedP0);
    return {
      status: verified ? "passed" : "candidate",
      phase: "p0",
      frozen: verified,
      externallyVerified: verified,
      candidateP0LockSha256: result.pack.manifestHash,
      source: { decoderRows: context.decoderRows.length, decoderByteSha256: context.decoderByteHash, decoderCanonicalRowsSha256: context.decoderRowsHash },
      manual: { rows: result.manualArtifacts.manual.materialized.size, subjectRows: result.manualArtifacts.subjects.materialized.size, baseWindows: 7 },
      agreement: result.reviews.agreement,
      disagreementsAdjudicated: result.reviews.disagreementCount,
      preMaskContactSupport: result.contactSupport,
      reacquireCandidates: result.reacquireEvents,
      elapsedMs,
    };
  }
  return {
    status: "passed", phase: "p1", frozen: true, externallyVerified: true,
    parentP0LockSha256: result.p0.pack.manifestHash, p1PackSha256: result.p1Pack.manifestHash, p1LockSha256: result.lock.hash,
    teacherRows: result.teacher.rows.length, postMaskContactSupport: result.teacher.support, p1ReacquireStarts: result.teacher.p1Starts,
    elapsedMs,
  };
}

function errorCode(message) {
  return String(message || "audit_error").split(":", 1)[0] || "audit_error";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.hashJson) {
    const value = readJson(resolvePath(options.hashJson), "hash_json");
    console.log(JSON.stringify({ canonicalSha256: canonicalHash(value, true) }, null, 2));
    return;
  }
  const started = process.hrtime.bigint();
  const context = loadPinnedInputs(options);
  const result = options.phase === "p0" ? auditP0(options, context) : auditP1(options, context);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const report = makeReport(options, context, result, elapsedMs);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) atomicWrite(resolvePath(options.output), text);
  console.log(text.trimEnd());
}

try { main(); }
catch (error) {
  const message = error.message || String(error);
  const report = { status: "failed", phase: process.argv.includes("p1") ? "p1" : "p0", errors: [{ code: errorCode(message), detail: message }] };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    try { atomicWrite(resolvePath(process.argv[outputIndex + 1]), text); } catch { /* preserve primary failure */ }
  }
  console.log(text.trimEnd());
  process.exitCode = 1;
}
