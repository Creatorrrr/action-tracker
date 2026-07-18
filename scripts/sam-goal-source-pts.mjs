#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SOURCE_CONTRACT = "tests/fixtures/sam-goal-v2/source-contract.json";
const DEFAULT_SOURCE_SCHEMA = "tests/fixtures/sam-goal-v2/source-schema.json";
const DEFAULT_OUTPUT_DIR = "tests/fixtures/sam-goal-v2/labels";
const INTEGER_TICKS_RE = /^(0|[1-9][0-9]*)$/;
const RATIONAL_RE = /^([1-9][0-9]*)\/([1-9][0-9]*)$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const EXPECTED_PAIRED_IDS = [
  "arms-crossed",
  "csi-pose",
  "dance-16x9-padded",
  "jujae-regression-0-16_5",
  "shorts-keGbIts0CA0-16x9-padded",
  "shorts-new-dance-E9_h_ZW5z0U-16x9-padded",
  "shorts-vc0GDveRIp0-16x9-padded",
];
const ACCEPTED_SOURCE_CONTRACT_SHA256 = "39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873";
const ACCEPTED_SOURCE_SCHEMA_SHA256 = "ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244";
const STREAM_ARGS = [
  "-v", "error",
  "-select_streams", "v:0",
  "-show_entries", "stream=index,codec_name,width,height,avg_frame_rate,time_base,duration",
  "-of", "json",
];
const FRAME_ARGS = [
  "-v", "error",
  "-select_streams", "v:0",
  "-show_entries", "frame=stream_index,best_effort_timestamp,time_base",
  "-of", "compact=p=0:nk=0",
];

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-source-pts.mjs [options]

Options:
  --source-contract <path>   Default: ${DEFAULT_SOURCE_CONTRACT}
  --source-schema <path>     Default: ${DEFAULT_SOURCE_SCHEMA}
  --output-dir <path>        Default: ${DEFAULT_OUTPUT_DIR}
  --ffprobe-bin <path>       Default: ffprobe
  --video <clipId=path>      Override a paired source for controlled tests. Repeatable.
  --unpaired-video <path>    Override full jujae inventory source.
  --check                    Read-only regeneration and drift check.
  --help`);
}

function parseArgs(argv) {
  const options = {
    sourceContract: DEFAULT_SOURCE_CONTRACT,
    sourceSchema: DEFAULT_SOURCE_SCHEMA,
    outputDir: DEFAULT_OUTPUT_DIR,
    ffprobeBin: "ffprobe",
    videos: [],
    unpairedVideo: "",
    check: false,
  };
  const values = new Map([
    ["--source-contract", "sourceContract"],
    ["--source-schema", "sourceSchema"],
    ["--output-dir", "outputDir"],
    ["--ffprobe-bin", "ffprobeBin"],
    ["--video", "videos"],
    ["--unpaired-video", "unpairedVideo"],
  ]);
  const seenSingletons = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--check") {
      if (options.check) throw new Error("duplicate_argument:--check");
      options.check = true;
      continue;
    }
    const key = values.get(arg);
    if (!key) throw new Error(`unknown_argument:${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
    if (Array.isArray(options[key])) options[key].push(value);
    else {
      if (seenSingletons.has(key)) throw new Error(`duplicate_argument:${arg}`);
      seenSingletons.add(key);
      options[key] = value;
    }
  }
  return options;
}

function resolveRepo(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(REPO_ROOT, value);
}

function repoRelative(value) {
  const absolute = resolveRepo(value);
  const relative = path.relative(REPO_ROOT, absolute);
  return relative && !relative.startsWith("..") ? relative : absolute;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value, { omitRootExpected = false } = {}) {
  let hashValue = value;
  if (omitRootExpected && value && typeof value === "object" && !Array.isArray(value)) {
    hashValue = { ...value };
    delete hashValue.expectedCanonicalHash;
  }
  return sha256(Buffer.from(stableStringify(hashValue), "utf8"));
}

function canonicalMultisetHash(rows) {
  return canonicalHash(rows.map((row) => stableStringify(row)).sort());
}

function stableEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function parseJsonl(text, label) {
  const rows = [];
  text.replace(/^\uFEFF/, "").split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid_jsonl:${label}:${index + 1}:${error.message}`);
    }
  });
  return rows;
}

function assertFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`missing_input:${label}:${repoRelative(filePath)}`);
  }
}

function writeArtifactPair(generated) {
  const token = `${process.pid}-${randomUUID()}`;
  const entries = [
    { name: "decoder", path: generated.decoderPath, contents: generated.decoderText },
    { name: "inventory", path: generated.inventoryPath, contents: generated.inventoryText },
  ].map((entry) => ({
    ...entry,
    staged: `${entry.path}.tmp-${token}`,
    backup: `${entry.path}.bak-${token}`,
    backedUp: false,
    installed: false,
  }));
  for (const entry of entries) mkdirSync(path.dirname(entry.path), { recursive: true });
  try {
    for (const entry of entries) {
      writeFileSync(entry.staged, entry.contents);
      if (!readFileSync(entry.staged).equals(Buffer.from(entry.contents, "utf8"))) {
        throw new Error(`staged_artifact_verification_failed:${entry.name}`);
      }
    }
    assertSourceSetStable(generated.sourceChecks);
    // Remove the inventory commit marker before replacing either member. A reader
    // must treat a missing or hash-mismatched inventory as an invalid pair.
    for (const entry of [...entries].reverse()) {
      if (existsSync(entry.path)) {
        renameSync(entry.path, entry.backup);
        entry.backedUp = true;
      }
    }
    renameSync(entries[0].staged, entries[0].path);
    entries[0].installed = true;
    if (process.env.SAM_GOAL_SOURCE_PTS_FAULT_AFTER_DECODER_COMMIT === "1") {
      throw new Error("injected_after_decoder_commit");
    }
    // Inventory is the commit marker and is always installed last.
    renameSync(entries[1].staged, entries[1].path);
    entries[1].installed = true;
    for (const entry of entries) {
      if (entry.backedUp) rmSync(entry.backup, { force: true });
      entry.backedUp = false;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.installed) rmSync(entry.path, { force: true });
        if (entry.backedUp) renameSync(entry.backup, entry.path);
        entry.installed = false;
        entry.backedUp = false;
      } catch (rollbackError) {
        rollbackErrors.push(`${entry.name}:${rollbackError.message}`);
      }
    }
    const suffix = rollbackErrors.length ? `:rollback_failed:${rollbackErrors.join("|")}` : "";
    throw new Error(`artifact_pair_commit_failed:${error.message}${suffix}`);
  } finally {
    for (const entry of entries) {
      rmSync(entry.staged, { force: true });
      if (!entry.backedUp) rmSync(entry.backup, { force: true });
    }
  }
}

function run(command, args, label, maxBuffer = 128 * 1024 * 1024) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer,
  });
  if (result.status !== 0 || result.error) {
    throw new Error(
      `ffprobe_failed:${label}:${result.status}:${result.error?.message || result.stderr.trim() || "unknown"}`,
    );
  }
  return result.stdout;
}

function ffprobeVersion(binary) {
  const output = run(binary, ["-version"], "version", 1024 * 1024);
  const firstLine = output.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) throw new Error("ffprobe_version_missing");
  return firstLine;
}

function rational(value, label) {
  const match = RATIONAL_RE.exec(String(value || ""));
  if (!match) throw new Error(`invalid_rational:${label}:${value}`);
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new Error(`unsafe_rational:${label}:${value}`);
  }
  return { numerator, denominator };
}

function positiveSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid_integer:${label}:${value}`);
  return number;
}

function nonnegativeSafeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid_integer:${label}:${value}`);
  return number;
}

function parseCompactFrameLine(line, label, lineNumber) {
  const fields = {};
  for (const part of line.split("|")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    if (separator < 1) throw new Error(`invalid_frame_field:${label}:${lineNumber}:${part}`);
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (Object.hasOwn(fields, key)) throw new Error(`duplicate_frame_field:${label}:${lineNumber}:${key}`);
    fields[key] = value;
  }
  return fields;
}

function probeStream(binary, videoPath, clipId) {
  const output = run(binary, [...STREAM_ARGS, videoPath], `stream:${clipId}`);
  let value;
  try {
    value = JSON.parse(output);
  } catch (error) {
    throw new Error(`ffprobe_json_invalid:${clipId}:${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ffprobe_json_invalid:${clipId}:top_level_object_required`);
  }
  if (!Array.isArray(value.streams) || value.streams.length !== 1) {
    throw new Error(`selected_stream_count:${clipId}:${value.streams?.length ?? 0}`);
  }
  const stream = value.streams[0];
  const streamIndex = nonnegativeSafeInteger(stream.index, `${clipId}:stream_index`);
  const timeBase = rational(stream.time_base, `${clipId}:time_base`);
  rational(stream.avg_frame_rate, `${clipId}:avg_frame_rate`);
  const width = positiveSafeInteger(stream.width, `${clipId}:width`);
  const height = positiveSafeInteger(stream.height, `${clipId}:height`);
  if (!(typeof stream.codec_name === "string" && stream.codec_name)) {
    throw new Error(`codec_missing:${clipId}`);
  }
  if (!(typeof stream.duration === "string" && /^([0-9]+)(\.[0-9]+)?$/.test(stream.duration))) {
    throw new Error(`duration_invalid:${clipId}:${stream.duration}`);
  }
  return {
    streamIndex,
    codec: stream.codec_name,
    width,
    height,
    averageFrameRate: stream.avg_frame_rate,
    timeBase,
    duration: stream.duration,
  };
}

function probeFrames(binary, videoPath, clipId, media) {
  const output = run(binary, [...FRAME_ARGS, videoPath], `frames:${clipId}`);
  const lines = output.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error(`no_decoded_frames:${clipId}`);
  const rows = [];
  let previousPts = null;
  const seenPts = new Set();
  const expectedTimeBase = `${media.timeBase.numerator}/${media.timeBase.denominator}`;
  for (let sourceFrameIndex = 0; sourceFrameIndex < lines.length; sourceFrameIndex += 1) {
    const fields = parseCompactFrameLine(lines[sourceFrameIndex], clipId, sourceFrameIndex + 1);
    const frameStreamIndex = nonnegativeSafeInteger(fields.stream_index, `${clipId}:frame_stream:${sourceFrameIndex}`);
    if (frameStreamIndex !== media.streamIndex) {
      throw new Error(`frame_stream_mismatch:${clipId}:${sourceFrameIndex}:${frameStreamIndex}:${media.streamIndex}`);
    }
    if (fields.time_base !== undefined && fields.time_base !== expectedTimeBase) {
      throw new Error(`frame_time_base_mismatch:${clipId}:${sourceFrameIndex}:${fields.time_base}:${expectedTimeBase}`);
    }
    const ptsText = fields.best_effort_timestamp;
    if (typeof ptsText !== "string" || !INTEGER_TICKS_RE.test(ptsText)) {
      throw new Error(`frame_pts_invalid:${clipId}:${sourceFrameIndex}:${ptsText}`);
    }
    const pts = BigInt(ptsText);
    if (seenPts.has(ptsText)) throw new Error(`frame_pts_duplicate:${clipId}:${sourceFrameIndex}:${ptsText}`);
    if (previousPts !== null && pts <= previousPts) {
      throw new Error(`frame_pts_nonmonotonic:${clipId}:${sourceFrameIndex}:${ptsText}`);
    }
    seenPts.add(ptsText);
    previousPts = pts;
    rows.push({
      artifactType: "decoder-pts",
      clipId,
      sourceFrameIndex,
      ptsTicks: ptsText,
      timeBase: media.timeBase,
      loopEpoch: 0,
      decodeStatus: "decoded",
      decodeReason: null,
    });
  }
  return rows;
}

function assertClosedKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`source_shape_invalid:${label}:object_required`);
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unexpected.length || missing.length) {
    throw new Error(
      `source_shape_invalid:${label}:unexpected=${unexpected.join(",")}:missing=${missing.join(",")}`,
    );
  }
}

function validateSchemaValue(rootSchema, schema, value, instancePath) {
  if (schema === true) return;
  if (schema === false) throw new Error(`source_schema_validation:${instancePath}:false_schema`);
  if (schema.$ref) {
    const prefix = "#/$defs/";
    if (!schema.$ref.startsWith(prefix)) {
      throw new Error(`source_schema_validation:${instancePath}:external_ref`);
    }
    const target = rootSchema.$defs?.[schema.$ref.slice(prefix.length)];
    if (!target) throw new Error(`source_schema_validation:${instancePath}:missing_ref`);
    validateSchemaValue(rootSchema, target, value, instancePath);
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((entry) => validateSchemaValue(rootSchema, entry, value, instancePath));
  }
  if (Array.isArray(schema.oneOf)) {
    let matches = 0;
    for (const entry of schema.oneOf) {
      try {
        validateSchemaValue(rootSchema, entry, value, instancePath);
        matches += 1;
      } catch {
        // A non-matching branch is expected for oneOf.
      }
    }
    if (matches !== 1) throw new Error(`source_schema_validation:${instancePath}:oneOf:${matches}`);
  }
  if (Object.hasOwn(schema, "const") && !stableEqual(value, schema.const)) {
    throw new Error(`source_schema_validation:${instancePath}:const`);
  }
  if (schema.type) {
    const typeMatches = {
      object: value !== null && typeof value === "object" && !Array.isArray(value),
      array: Array.isArray(value),
      string: typeof value === "string",
      integer: Number.isSafeInteger(value),
      number: typeof value === "number" && Number.isFinite(value),
      boolean: typeof value === "boolean",
      null: value === null,
    }[schema.type];
    if (!typeMatches) throw new Error(`source_schema_validation:${instancePath}:type:${schema.type}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new Error(`source_schema_validation:${instancePath}:minLength`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern)).test(value)) {
      throw new Error(`source_schema_validation:${instancePath}:pattern`);
    }
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`source_schema_validation:${instancePath}:minimum`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new Error(`source_schema_validation:${instancePath}:minItems`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new Error(`source_schema_validation:${instancePath}:maxItems`);
    }
    const prefixItems = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    prefixItems.forEach((entry, index) => {
      if (index < value.length) validateSchemaValue(rootSchema, entry, value[index], `${instancePath}/${index}`);
    });
    if (Object.hasOwn(schema, "items")) {
      for (let index = prefixItems.length; index < value.length; index += 1) {
        validateSchemaValue(rootSchema, schema.items, value[index], `${instancePath}/${index}`);
      }
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) {
        throw new Error(`source_schema_validation:${instancePath}:required:${required}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        validateSchemaValue(rootSchema, properties[key], child, `${instancePath}/${key}`);
      } else if (schema.additionalProperties === false) {
        throw new Error(`source_schema_validation:${instancePath}:additional:${key}`);
      }
    }
  }
}

function validateSourceArtifact(sourceSchema, definition, value, label) {
  const schema = sourceSchema.$defs?.[definition];
  if (!schema) throw new Error(`source_schema_definition_missing:${definition}`);
  validateSchemaValue(sourceSchema, schema, value, label);
}

function verifySourceInputs(sourceContractPath, sourceSchemaPath) {
  let sourceContract;
  try {
    sourceContract = readJson(sourceContractPath);
  } catch (error) {
    throw new Error(`source_contract_json_invalid:${error.message}`);
  }
  assertClosedKeys(
    sourceContract,
    ["schemaVersion", "artifactType", "sourceSchema", "paired", "unpaired", "expectedCanonicalHash"],
    "source_contract",
  );
  assertClosedKeys(sourceContract.sourceSchema, ["path", "canonicalSha256"], "source_schema_identity");
  if (sourceContract.schemaVersion !== 1 || sourceContract.artifactType !== "sam-goal-source-contract") {
    throw new Error("source_contract_shape_invalid:identity");
  }
  if (!SHA256_RE.test(sourceContract.expectedCanonicalHash || "")) {
    throw new Error("source_contract_hash_invalid");
  }
  const sourceContractHash = canonicalHash(sourceContract, { omitRootExpected: true });
  if (sourceContract.expectedCanonicalHash !== sourceContractHash) {
    throw new Error(
      `source_contract_hash_mismatch:${sourceContract.expectedCanonicalHash}:${sourceContractHash}`,
    );
  }
  if (sourceContractHash !== ACCEPTED_SOURCE_CONTRACT_SHA256) {
    throw new Error(
      `source_contract_hash_mismatch:${ACCEPTED_SOURCE_CONTRACT_SHA256}:${sourceContractHash}`,
    );
  }

  if (!Array.isArray(sourceContract.paired)) throw new Error("paired_sources_invalid:not_array");
  const pairedIds = sourceContract.paired.map((source, index) => {
    assertClosedKeys(source, ["clipId", "video"], `paired:${index}`);
    if (!(typeof source.clipId === "string" && typeof source.video === "string" && source.video)) {
      throw new Error(`paired_sources_invalid:${index}`);
    }
    return source.clipId;
  });
  if (
    pairedIds.length !== EXPECTED_PAIRED_IDS.length
    || pairedIds.some((clipId, index) => clipId !== EXPECTED_PAIRED_IDS[index])
  ) {
    throw new Error(`paired_sources_invalid:${pairedIds.join(",")}`);
  }
  if (!Array.isArray(sourceContract.unpaired) || sourceContract.unpaired.length !== 1) {
    throw new Error("unpaired_sources_invalid:count");
  }
  assertClosedKeys(
    sourceContract.unpaired[0],
    ["clipId", "video", "pairedDecoderRows"],
    "unpaired:0",
  );
  if (
    sourceContract.unpaired[0].clipId !== "jujae-full"
    || !(typeof sourceContract.unpaired[0].video === "string" && sourceContract.unpaired[0].video)
    || sourceContract.unpaired[0].pairedDecoderRows !== 0
  ) {
    throw new Error("unpaired_sources_invalid:identity");
  }

  let sourceSchema;
  try {
    sourceSchema = readJson(sourceSchemaPath);
  } catch (error) {
    throw new Error(`source_schema_json_invalid:${error.message}`);
  }
  const sourceSchemaHash = canonicalHash(sourceSchema);
  if (sourceContract.sourceSchema.canonicalSha256 !== sourceSchemaHash) {
    throw new Error(
      `source_schema_hash_mismatch:${sourceContract.sourceSchema.canonicalSha256}:${sourceSchemaHash}`,
    );
  }
  if (sourceSchemaHash !== ACCEPTED_SOURCE_SCHEMA_SHA256) {
    throw new Error(
      `source_schema_hash_mismatch:${ACCEPTED_SOURCE_SCHEMA_SHA256}:${sourceSchemaHash}`,
    );
  }
  if (
    sourceSchema?.$schema !== "https://json-schema.org/draft/2020-12/schema"
    || !sourceSchema?.$defs?.sourceContract
    || !sourceSchema?.$defs?.decoderRow
    || !sourceSchema?.$defs?.sourceInventory
  ) {
    throw new Error("source_schema_shape_invalid");
  }
  const refs = [];
  (function collectRefs(value) {
    if (Array.isArray(value)) value.forEach(collectRefs);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref") refs.push(child);
        collectRefs(child);
      }
    }
  }(sourceSchema));
  if (refs.some((ref) => typeof ref !== "string" || !ref.startsWith("#/$defs/"))) {
    throw new Error("source_schema_external_ref");
  }
  validateSourceArtifact(sourceSchema, "sourceContract", sourceContract, "sourceContract");
  return {
    sourceContract,
    sourceContractHash,
    sourceSchema,
    sourceSchemaHash,
  };
}

function parseOverrides(values, sourceContract) {
  const known = new Set(sourceContract.paired.map(({ clipId }) => clipId));
  const overrides = new Map();
  for (const pair of values) {
    const separator = pair.indexOf("=");
    if (separator < 1 || separator === pair.length - 1) throw new Error(`invalid_video_override:${pair}`);
    const clipId = pair.slice(0, separator);
    const source = pair.slice(separator + 1);
    if (clipId === "jujae-full") throw new Error("unpaired_leakage:jujae-full");
    if (!known.has(clipId)) throw new Error(`unknown_clip_override:${clipId}`);
    if (overrides.has(clipId)) throw new Error(`duplicate_clip_override:${clipId}`);
    overrides.set(clipId, source);
  }
  return overrides;
}

function statSignature(stats) {
  return [stats.dev, stats.ino, stats.size, stats.mtimeNs, stats.ctimeNs]
    .map((value) => String(value))
    .join(":");
}

function fileIdentity(filePath, clipId) {
  assertFile(filePath, "video");
  const before = statSync(filePath, { bigint: true });
  const bytes = readFileSync(filePath);
  const after = statSync(filePath, { bigint: true });
  if (statSignature(before) !== statSignature(after)) {
    throw new Error(`source_hash_drift:${clipId}:changed_while_hashing`);
  }
  if (after.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`source_size_unsafe:${clipId}:${after.size}`);
  }
  return {
    path: repoRelative(filePath),
    bytes: Number(after.size),
    sha256: sha256(bytes),
  };
}

function assertSourceStable(clipId, before, after) {
  if (before.bytes !== after.bytes || before.sha256 !== after.sha256) {
    throw new Error(`source_hash_drift:${clipId}:${before.sha256}:${after.sha256}`);
  }
}

function assertSourceSetStable(sourceChecks) {
  for (const source of sourceChecks) {
    const current = fileIdentity(source.path, source.clipId);
    assertSourceStable(source.clipId, source.identity, current);
  }
}

function serializeRows(rows) {
  return `${rows.map((row) => stableStringify(row)).join("\n")}\n`;
}

function buildArtifacts(options) {
  const sourceContractPath = resolveRepo(options.sourceContract);
  const sourceSchemaPath = resolveRepo(options.sourceSchema);
  assertFile(sourceContractPath, "source_contract");
  assertFile(sourceSchemaPath, "source_schema");
  const sourceContractIdentity = fileIdentity(sourceContractPath, "source-contract");
  const sourceSchemaIdentity = fileIdentity(sourceSchemaPath, "source-schema");
  const sourceInputs = verifySourceInputs(sourceContractPath, sourceSchemaPath);
  assertSourceStable(
    "source-contract",
    sourceContractIdentity,
    fileIdentity(sourceContractPath, "source-contract"),
  );
  assertSourceStable(
    "source-schema",
    sourceSchemaIdentity,
    fileIdentity(sourceSchemaPath, "source-schema"),
  );
  const overrides = parseOverrides(options.videos, sourceInputs.sourceContract);
  const version = ffprobeVersion(options.ffprobeBin);
  const allRows = [];
  const paired = [];
  const sourceChecks = [
    { clipId: "source-contract", path: sourceContractPath, identity: sourceContractIdentity },
    { clipId: "source-schema", path: sourceSchemaPath, identity: sourceSchemaIdentity },
  ];
  for (const clip of sourceInputs.sourceContract.paired) {
    const videoPath = resolveRepo(overrides.get(clip.clipId) || clip.video);
    const source = fileIdentity(videoPath, clip.clipId);
    const media = probeStream(options.ffprobeBin, videoPath, clip.clipId);
    const rows = probeFrames(options.ffprobeBin, videoPath, clip.clipId, media);
    const sourceAfterProbe = fileIdentity(videoPath, clip.clipId);
    assertSourceStable(clip.clipId, source, sourceAfterProbe);
    sourceChecks.push({ clipId: clip.clipId, path: videoPath, identity: source });
    if (rows.some((row, index) => row.sourceFrameIndex !== index || row.clipId !== clip.clipId)) {
      throw new Error(`source_frame_index_discontinuous:${clip.clipId}`);
    }
    allRows.push(...rows);
    paired.push({
      clipId: clip.clipId,
      video: source,
      media,
      decoderRowCount: rows.length,
      firstPtsTicks: rows[0].ptsTicks,
      lastPtsTicks: rows.at(-1).ptsTicks,
    });
  }

  const unpairedContract = sourceInputs.sourceContract.unpaired[0];
  const unpairedPath = resolveRepo(options.unpairedVideo || unpairedContract.video);
  const unpairedSource = fileIdentity(unpairedPath, "jujae-full");
  const unpairedMedia = probeStream(options.ffprobeBin, unpairedPath, "jujae-full");
  const unpairedRows = probeFrames(options.ffprobeBin, unpairedPath, "jujae-full", unpairedMedia);
  const unpairedSourceAfterProbe = fileIdentity(unpairedPath, "jujae-full");
  assertSourceStable("jujae-full", unpairedSource, unpairedSourceAfterProbe);
  sourceChecks.push({ clipId: "jujae-full", path: unpairedPath, identity: unpairedSource });
  const unpaired = [{
    clipId: "jujae-full",
    video: unpairedSource,
    media: unpairedMedia,
    decodedFrameCount: unpairedRows.length,
    firstPtsTicks: unpairedRows[0].ptsTicks,
    lastPtsTicks: unpairedRows.at(-1).ptsTicks,
    pairedDecoderRows: 0,
  }];
  if (allRows.some((row) => row.clipId === "jujae-full")) throw new Error("unpaired_leakage:decoder_rows");
  assertSourceSetStable(sourceChecks);

  const decoderText = serializeRows(allRows);
  const decoderByteSha256 = sha256(Buffer.from(decoderText, "utf8"));
  const decoderCanonicalRowsSha256 = canonicalHash(allRows);
  const outputDir = resolveRepo(options.outputDir);
  const decoderPath = path.join(outputDir, "decoder-manifest.jsonl");
  const inventoryPath = path.join(outputDir, "source-inventory.json");
  const inventory = {
    schemaVersion: 1,
    artifactType: "sam-goal-source-inventory",
    sourceContract: {
      path: repoRelative(sourceContractPath),
      expectedCanonicalHash: sourceInputs.sourceContractHash,
      canonicalSha256: sourceInputs.sourceContractHash,
    },
    sourceSchema: {
      path: repoRelative(sourceSchemaPath),
      canonicalSha256: sourceInputs.sourceSchemaHash,
    },
    ffprobe: {
      version,
      streamSelector: "v:0",
      framePtsField: "frame.best_effort_timestamp",
      frameTimeBaseMode: "selected-stream-time_base",
      streamCommandProfile: [...STREAM_ARGS, "<video>"],
      frameCommandProfile: [...FRAME_ARGS, "<video>"],
    },
    serialization: {
      json: "sorted-key-compact-json-v1",
      lineEnding: "LF",
      terminalNewline: true,
      canonicalRowOrder: "ffprobe-presentation-order",
      arrayOrderSemantic: true,
    },
    paired,
    unpaired,
    decoderManifest: {
      path: repoRelative(decoderPath),
      rowCount: allRows.length,
      byteSha256: decoderByteSha256,
      canonicalRowsSha256: decoderCanonicalRowsSha256,
    },
    expectedCanonicalHash: "",
  };
  inventory.expectedCanonicalHash = canonicalHash(inventory, { omitRootExpected: true });
  allRows.forEach((row, index) => {
    validateSourceArtifact(sourceInputs.sourceSchema, "decoderRow", row, `decoderRow/${index}`);
  });
  validateSourceArtifact(sourceInputs.sourceSchema, "sourceInventory", inventory, "sourceInventory");
  const inventoryText = `${JSON.stringify(inventory, null, 2)}\n`;
  return {
    decoderPath,
    inventoryPath,
    decoderText,
    inventory,
    inventoryText,
    rows: allRows,
    sourceChecks,
  };
}

function inventoryComponentDrifts(committed, generated) {
  const drifts = [];
  if (
    committed?.sourceContract?.expectedCanonicalHash !== generated.sourceContract.expectedCanonicalHash
    || committed?.sourceContract?.canonicalSha256 !== generated.sourceContract.canonicalSha256
  ) {
    drifts.push({ code: "source_contract_hash_drift" });
  }
  if (!stableEqual(committed?.sourceSchema, generated.sourceSchema)) {
    drifts.push({ code: "source_schema_hash_drift" });
  }
  if (!stableEqual(committed?.ffprobe, generated.ffprobe)) {
    drifts.push({ code: "ffprobe_profile_drift" });
  }

  const sourceProjection = (inventory) => ({
    paired: Array.isArray(inventory?.paired)
      ? inventory.paired.map(({ clipId, video }) => ({ clipId, video }))
      : null,
    unpaired: Array.isArray(inventory?.unpaired)
      ? inventory.unpaired.map(({ clipId, video }) => ({ clipId, video }))
      : null,
  });
  if (!stableEqual(sourceProjection(committed), sourceProjection(generated))) {
    drifts.push({ code: "source_identity_drift" });
  }

  const mediaProjection = (inventory) => ({
    paired: Array.isArray(inventory?.paired)
      ? inventory.paired.map(({ clipId, media }) => ({ clipId, media }))
      : null,
    unpaired: Array.isArray(inventory?.unpaired)
      ? inventory.unpaired.map(({ clipId, media }) => ({ clipId, media }))
      : null,
  });
  if (!stableEqual(mediaProjection(committed), mediaProjection(generated))) {
    drifts.push({ code: "media_metadata_drift" });
  }

  const countProjection = (inventory) => ({
    paired: Array.isArray(inventory?.paired)
      ? inventory.paired.map(({ clipId, decoderRowCount }) => ({ clipId, decoderRowCount }))
      : null,
    unpaired: Array.isArray(inventory?.unpaired)
      ? inventory.unpaired.map(({ clipId, decodedFrameCount, pairedDecoderRows }) => ({
        clipId,
        decodedFrameCount,
        pairedDecoderRows,
      }))
      : null,
    manifestRowCount: inventory?.decoderManifest?.rowCount ?? null,
  });
  if (!stableEqual(countProjection(committed), countProjection(generated))) {
    drifts.push({ code: "decoder_row_count_drift" });
  }

  const extentProjection = (inventory) => ({
    paired: Array.isArray(inventory?.paired)
      ? inventory.paired.map(({ clipId, firstPtsTicks, lastPtsTicks }) => ({
        clipId,
        firstPtsTicks,
        lastPtsTicks,
      }))
      : null,
    unpaired: Array.isArray(inventory?.unpaired)
      ? inventory.unpaired.map(({ clipId, firstPtsTicks, lastPtsTicks }) => ({
        clipId,
        firstPtsTicks,
        lastPtsTicks,
      }))
      : null,
  });
  if (!stableEqual(extentProjection(committed), extentProjection(generated))) {
    drifts.push({ code: "pts_extent_drift" });
  }
  return drifts;
}

function checkArtifacts(generated) {
  const drifts = [];
  if (!existsSync(generated.decoderPath)) {
    drifts.push({ code: "decoder_manifest_missing", path: repoRelative(generated.decoderPath) });
  } else {
    const committedText = readFileSync(generated.decoderPath, "utf8");
    if (committedText !== generated.decoderText) {
      let committedCanonicalHash = null;
      let committedRows = null;
      try {
        committedRows = parseJsonl(committedText, "committed_decoder");
        committedCanonicalHash = canonicalHash(committedRows);
      } catch (error) {
        drifts.push({ code: "decoder_manifest_invalid", detail: error.message });
      }
      const canonicalMatches = committedCanonicalHash
        === generated.inventory.decoderManifest.canonicalRowsSha256;
      if (committedRows && committedRows.length !== generated.rows.length) {
        drifts.push({
          code: "decoder_row_count_drift",
          expected: generated.rows.length,
          actual: committedRows.length,
        });
      }
      if (
        committedRows
        && !canonicalMatches
        && committedRows.length === generated.rows.length
        && canonicalMultisetHash(committedRows) === canonicalMultisetHash(generated.rows)
      ) {
        drifts.push({ code: "decoder_row_order_drift" });
      }
      drifts.push({
        code: canonicalMatches ? "decoder_physical_byte_drift" : "decoder_canonical_semantic_drift",
        expectedByteSha256: generated.inventory.decoderManifest.byteSha256,
        actualByteSha256: sha256(Buffer.from(committedText, "utf8")),
        expectedCanonicalRowsSha256: generated.inventory.decoderManifest.canonicalRowsSha256,
        actualCanonicalRowsSha256: committedCanonicalHash,
      });
    }
  }
  if (!existsSync(generated.inventoryPath)) {
    drifts.push({ code: "source_inventory_missing", path: repoRelative(generated.inventoryPath) });
  } else {
    const committedText = readFileSync(generated.inventoryPath, "utf8");
    if (committedText !== generated.inventoryText) {
      let committedCanonicalHash = null;
      let committedInventory = null;
      try {
        committedInventory = JSON.parse(committedText);
        committedCanonicalHash = canonicalHash(committedInventory, { omitRootExpected: true });
      } catch (error) {
        drifts.push({ code: "source_inventory_invalid", detail: error.message });
      }
      if (committedInventory) {
        drifts.push(...inventoryComponentDrifts(committedInventory, generated.inventory));
      }
      drifts.push({
        code: committedCanonicalHash === generated.inventory.expectedCanonicalHash
          ? "inventory_physical_byte_drift"
          : "inventory_canonical_semantic_drift",
        expectedCanonicalHash: generated.inventory.expectedCanonicalHash,
        actualCanonicalHash: committedCanonicalHash,
      });
    }
  }
  const result = {
    status: drifts.length ? "failed" : "passed",
    rows: generated.rows.length,
    decoderManifest: repoRelative(generated.decoderPath),
    sourceInventory: repoRelative(generated.inventoryPath),
    drifts,
  };
  console.log(JSON.stringify(result, null, 2));
  if (drifts.length) process.exitCode = 1;
}

function fatalDriftCode(message) {
  if (String(message).startsWith("missing_input:source_contract")) return "source_contract_input_missing";
  if (String(message).startsWith("missing_input:source_schema")) return "source_schema_input_missing";
  const prefix = String(message || "").split(":", 1)[0];
  const mapping = {
    source_contract_hash_mismatch: "source_contract_hash_drift",
    source_schema_hash_mismatch: "source_schema_hash_drift",
    paired_sources_invalid: "source_contract_membership_drift",
    unpaired_sources_invalid: "source_contract_membership_drift",
    source_shape_invalid: "source_contract_shape_drift",
    ffprobe_failed: "ffprobe_error",
    ffprobe_json_invalid: "ffprobe_output_invalid",
    ffprobe_version_missing: "ffprobe_profile_drift",
    contract_json_invalid: "contract_input_invalid",
    schema_json_invalid: "schema_input_invalid",
    missing_input: "source_missing",
    source_hash_drift: "source_identity_drift",
    artifact_pair_commit_failed: "artifact_pair_commit_failed",
  };
  return mapping[prefix] || prefix || "source_pts_error";
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const generated = buildArtifacts(options);
  assertSourceSetStable(generated.sourceChecks);
  if (options.check) {
    checkArtifacts(generated);
    return;
  }
  writeArtifactPair(generated);
  console.log(JSON.stringify({
    status: "generated",
    rows: generated.rows.length,
    pairedClips: generated.inventory.paired.length,
    unpairedClips: generated.inventory.unpaired.length,
    decoderManifest: repoRelative(generated.decoderPath),
    sourceInventory: repoRelative(generated.inventoryPath),
    decoderByteSha256: generated.inventory.decoderManifest.byteSha256,
    decoderCanonicalRowsSha256: generated.inventory.decoderManifest.canonicalRowsSha256,
    sourceInventoryCanonicalSha256: generated.inventory.expectedCanonicalHash,
  }, null, 2));
}

try {
  main();
} catch (error) {
  const message = error.message || String(error);
  if (process.argv.includes("--check")) {
    console.log(JSON.stringify({
      status: "failed",
      rows: 0,
      drifts: [{ code: fatalDriftCode(message), detail: message }],
    }, null, 2));
  } else {
    console.error(`sam-goal-source-pts failed: ${message}`);
  }
  process.exitCode = 1;
}
