import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PTS = path.join(REPO_ROOT, "scripts/sam-goal-source-pts.mjs");
const SOURCE_CONTRACT_PATH = path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/source-contract.json");
const SOURCE_SCHEMA_PATH = path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/source-schema.json");
const REAL_INVENTORY_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/sam-goal-v2/labels/source-inventory.json",
);
const REAL_DECODER_PATH = path.join(
  REPO_ROOT,
  "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl",
);
const EXPECTED_DECODER_BYTE_SHA256 = "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79";
const EXPECTED_DECODER_CANONICAL_SHA256 = "dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d";
const EXPECTED_SOURCE_CONTRACT_SHA256 = "39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873";
const EXPECTED_SOURCE_SCHEMA_SHA256 = "ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244";
assert.equal(sha256(readFileSync(REAL_DECODER_PATH)), EXPECTED_DECODER_BYTE_SHA256);
const CLIP_IDS = [
  "arms-crossed",
  "csi-pose",
  "dance-16x9-padded",
  "jujae-regression-0-16_5",
  "shorts-keGbIts0CA0-16x9-padded",
  "shorts-new-dance-E9_h_ZW5z0U-16x9-padded",
  "shorts-vc0GDveRIp0-16x9-padded",
];
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "sam source pts ; spaces "));
const sourceDir = path.join(tempRoot, "video inputs $() []");
const outputDir = path.join(tempRoot, "generated labels");
const fakeProbe = path.join(tempRoot, "fake ffprobe executable.mjs");

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

function canonicalHash(value, { omitRootExpected = false } = {}) {
  let hashValue = value;
  if (omitRootExpected && value && typeof value === "object" && !Array.isArray(value)) {
    hashValue = { ...value };
    delete hashValue.expectedCanonicalHash;
  }
  return createHash("sha256").update(JSON.stringify(stableValue(hashValue))).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function validateJsonlWithDraft202012(manifestPath, expectedRows) {
  const validation = spawnSync("python3", [
    "-c",
    [
      "import json, sys",
      "from jsonschema import Draft202012Validator",
      "schema=json.load(open(sys.argv[1], encoding='utf-8'))",
      "validator=Draft202012Validator(schema)",
      "rows=0",
      "for line_number,line in enumerate(open(sys.argv[2], encoding='utf-8'),1):",
      "    if not line.strip(): continue",
      "    validator.validate(json.loads(line))",
      "    rows += 1",
      "assert rows == int(sys.argv[3]), (rows, sys.argv[3])",
      "print(rows)",
    ].join("\n"),
    SOURCE_SCHEMA_PATH,
    manifestPath,
    String(expectedRows),
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(Number(validation.stdout.trim()), expectedRows);
}

function validateJsonWithDraft202012(valuePath) {
  const validation = spawnSync("python3", [
    "-c",
    [
      "import json, sys",
      "from jsonschema import Draft202012Validator",
      "root=json.load(open(sys.argv[1], encoding='utf-8'))",
      "Draft202012Validator.check_schema(root)",
      "Draft202012Validator(root).validate(json.load(open(sys.argv[2], encoding='utf-8')))",
      "print('valid')",
    ].join("\n"),
    SOURCE_SCHEMA_PATH,
    valuePath,
  ], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(validation.stdout.trim(), "valid");
}

mkdirSync(sourceDir, { recursive: true });
const videos = new Map();
CLIP_IDS.forEach((clipId, index) => {
  const filePath = path.join(sourceDir, `${String(index).padStart(2, "0")}__${clipId}__ ; $() [x].mp4`);
  writeFileSync(filePath, `fixture source ${clipId}\n`);
  videos.set(clipId, filePath);
});
const unpairedVideo = path.join(sourceDir, "99__jujae-full__ ; $() [x].mp4");
writeFileSync(unpairedVideo, "fixture source jujae-full\n");

writeFileSync(fakeProbe, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const mode = process.env.FAKE_FFPROBE_MODE || "OK";
if (mode === "FAIL_IF_CALLED") {
  process.stderr.write("fake ffprobe must not be called\\n");
  process.exit(99);
}
if (args.length === 1 && args[0] === "-version") {
  process.stdout.write("ffprobe version fake-8.0.1 exact-pts-test\\n");
  process.exit(0);
}
const streamArgs = [
  "-v", "error",
  "-select_streams", "v:0",
  "-show_entries", "stream=index,codec_name,width,height,avg_frame_rate,time_base,duration",
  "-of", "json",
];
const frameArgs = [
  "-v", "error",
  "-select_streams", "v:0",
  "-show_entries", "frame=stream_index,best_effort_timestamp,time_base",
  "-of", "compact=p=0:nk=0",
];
const streamRequest = args.includes("stream=index,codec_name,width,height,avg_frame_rate,time_base,duration");
const expectedArgs = streamRequest ? streamArgs : frameArgs;
if (JSON.stringify(args.slice(0, -1)) !== JSON.stringify(expectedArgs)) {
  process.stderr.write(\`unexpected ffprobe argv: \${JSON.stringify(args)}\\n\`);
  process.exit(52);
}
const video = args.at(-1) || "";
const ids = ${JSON.stringify([...CLIP_IDS, "jujae-full"])};
const clipId = ids.find((id) => video.includes(\`__\${id}__\`));
if (!clipId) {
  process.stderr.write(\`unknown fake video: \${video}\\n\`);
  process.exit(31);
}
const profile = {
  "arms-crossed": { index: 0, tb: "1/15360", rate: "30/1", ticks: ["512", "1024", "1536"] },
  "csi-pose": { index: 1, tb: "1/15360", rate: "30/1", ticks: ["0", "512", "1024"] },
  "dance-16x9-padded": { index: 0, tb: "1/43080", rate: "43080/1801", ticks: ["90071992547409930", "90071992547411731", "90071992547413532"] },
  "jujae-regression-0-16_5": { index: 0, tb: "1/60000", rate: "60000/1001", ticks: ["0", "1001", "2002"] },
  "shorts-keGbIts0CA0-16x9-padded": { index: 0, tb: "1/15360", rate: "60/1", ticks: ["0", "256", "512"] },
  "shorts-new-dance-E9_h_ZW5z0U-16x9-padded": { index: 0, tb: "1/15360", rate: "30/1", ticks: ["0", "512", "1024"] },
  "shorts-vc0GDveRIp0-16x9-padded": { index: 0, tb: "1/15360", rate: "30/1", ticks: ["0", "512", "1024"] },
  "jujae-full": { index: 0, tb: "1/60000", rate: "60000/1001", ticks: ["0", "1001", "2002", "3003"] },
}[clipId];
if (mode === "FFPROBE_FAIL" && clipId === "dance-16x9-padded") {
  process.stderr.write("injected ffprobe failure\\n");
  process.exit(44);
}
if (streamRequest) {
  if (mode === "MALFORMED_STREAM_JSON" && clipId === "arms-crossed") {
    process.stdout.write("{-");
    process.exit(0);
  }
  const tb = mode === "INVALID_TIME_BASE" && clipId === "arms-crossed" ? "0/1" : profile.tb;
  const stream = {
    index: profile.index,
    codec_name: "h264",
    width: 1920,
    height: 1080,
    avg_frame_rate: profile.rate,
    time_base: tb,
    duration: "12.345000",
  };
  const streams = mode === "MULTIPLE_SELECTED_STREAMS" && clipId === "arms-crossed"
    ? [stream, { ...stream, index: 2 }]
    : mode === "NO_SELECTED_STREAM" && clipId === "arms-crossed" ? [] : [stream];
  process.stdout.write(JSON.stringify({ streams, programs: [], stream_groups: [], ignored: true }));
  process.exit(0);
}
if (mode === "MUTATE_SOURCE_DURING_PROBE" && clipId === "dance-16x9-padded") {
  appendFileSync(video, "mutated during probe");
}
if (mode === "MUTATE_EARLIER_SOURCE_DURING_LATER_PROBE" && clipId === "dance-16x9-padded") {
  appendFileSync(process.env.FAKE_MUTATION_TARGET, "mutated by later probe");
}
if (mode === "NO_FRAMES" && clipId === "arms-crossed") process.exit(0);
let ticks = [...profile.ticks];
if (clipId === "arms-crossed" && mode === "DUPLICATE_PTS") ticks = ["512", "512", "1536"];
if (clipId === "arms-crossed" && mode === "NONMONOTONIC_PTS") ticks = ["512", "1536", "1024"];
if (clipId === "arms-crossed" && mode === "FRACTIONAL_PTS") ticks = ["512", "1024.5", "1536"];
if (clipId === "arms-crossed" && mode === "EXPONENT_PTS") ticks = ["512", "1e3", "1536"];
if (clipId === "arms-crossed" && mode === "NEGATIVE_PTS") ticks = ["-1", "512", "1024"];
if (clipId === "arms-crossed" && mode === "LEADING_ZERO_PTS") ticks = ["0512", "1024", "1536"];
const lines = ticks.map((tick, index) => {
  const streamIndex = mode === "FRAME_STREAM_MISMATCH" && clipId === "dance-16x9-padded" && index === 1
    ? profile.index + 1 : profile.index;
  const ptsField = mode === "MISSING_PTS" && clipId === "arms-crossed" && index === 1
    ? "" : \`|best_effort_timestamp=\${tick}\`;
  const tbField = mode === "FRAME_TIME_BASE_MISMATCH" && clipId === "arms-crossed"
    ? "|time_base=1/999" : "";
  const extra = mode === "EXTRA_FIELDS" ? "|side_data_type=ignored" : "";
  return \`stream_index=\${streamIndex}\${ptsField}\${tbField}\${extra}\`;
});
process.stdout.write(\`\${lines.join("\\n")}\\n\`);
`);
chmodSync(fakeProbe, 0o755);

const isolatedInputDir = path.join(tempRoot, "standalone exact source inputs");
const isolatedSourceContract = path.join(isolatedInputDir, "source-contract.json");
const isolatedSourceSchema = path.join(isolatedInputDir, "source-schema.json");
mkdirSync(isolatedInputDir, { recursive: true });
writeFileSync(isolatedSourceContract, readFileSync(SOURCE_CONTRACT_PATH));
writeFileSync(isolatedSourceSchema, readFileSync(SOURCE_SCHEMA_PATH));

const baseArgs = [
  SOURCE_PTS,
  "--source-contract", isolatedSourceContract,
  "--source-schema", isolatedSourceSchema,
  "--output-dir", outputDir,
  "--ffprobe-bin", fakeProbe,
];
for (const clipId of CLIP_IDS) baseArgs.push("--video", `${clipId}=${videos.get(clipId)}`);
baseArgs.push("--unpaired-video", unpairedVideo);

function runCli({ mode = "OK", extra = [], args = baseArgs, env = {} } = {}) {
  return spawnSync(process.execPath, [...args, ...extra], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, FAKE_FFPROBE_MODE: mode, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parseReport(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    assert.fail(`expected JSON stdout; status=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
}

function expectFailure(mode, expectedMessage) {
  const result = runCli({ mode });
  assert.notEqual(result.status, 0, `expected ${mode} to fail`);
  assert.match(`${result.stdout}\n${result.stderr}`, expectedMessage);
}

const generated = runCli();
assert.equal(generated.status, 0, generated.stderr);
const generatedReport = parseReport(generated);
assert.equal(generatedReport.status, "generated");
assert.equal(generatedReport.rows, 21);

const decoderPath = path.join(outputDir, "decoder-manifest.jsonl");
const inventoryPath = path.join(outputDir, "source-inventory.json");
const decoderBytes = readFileSync(decoderPath);
const decoderText = decoderBytes.toString("utf8");
const rows = readJsonl(decoderPath);
const inventory = readJson(inventoryPath);
const sourceCliText = readFileSync(SOURCE_PTS, "utf8");
for (const pattern of [
  /evaluation[-_]contract/i,
  /label[-_]schema/i,
  /\bteacher\b/i,
  /sourceGroup/,
  /\brole\b/i,
  /\bmanual\b/i,
  /\blive\b/i,
  /\bstudent\b/i,
  /\bavatar\b/i,
]) assert.doesNotMatch(sourceCliText, pattern);
const forbiddenSemanticKeys = new Set([
  "teacher", "role", "sourceGroup", "split", "manual", "live", "student", "avatar",
]);
function assertSourceOnlyObject(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertSourceOnlyObject(entry, `${label}/${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbiddenSemanticKeys.has(key), false, `${label}:${key}`);
    assertSourceOnlyObject(child, `${label}/${key}`);
  }
}
assertSourceOnlyObject(readJson(isolatedSourceContract), "sourceContract");
assertSourceOnlyObject(readJson(isolatedSourceSchema), "sourceSchema");
assertSourceOnlyObject(inventory, "sourceInventory");
validateJsonlWithDraft202012(decoderPath, 21);
validateJsonWithDraft202012(isolatedSourceContract);
validateJsonWithDraft202012(inventoryPath);
assert.equal(rows.length, 21);
assert.equal(inventory.paired.length, 7);
assert.equal(inventory.unpaired.length, 1);
assert.deepEqual([...new Set(rows.map(({ clipId }) => clipId))], CLIP_IDS);
assert.ok(rows.every((row) => row.clipId !== "jujae-full"));
assert.equal(inventory.unpaired[0].clipId, "jujae-full");
assert.equal(inventory.unpaired[0].decodedFrameCount, 4);
assert.equal(inventory.unpaired[0].pairedDecoderRows, 0);
assert.equal(inventory.unpaired[0].firstPtsTicks, "0");
assert.equal(inventory.unpaired[0].lastPtsTicks, "3003");
assert.equal(inventory.paired.find(({ clipId }) => clipId === "csi-pose").media.streamIndex, 1);
assert.equal(inventory.paired.find(({ clipId }) => clipId === "dance-16x9-padded").media.averageFrameRate, "43080/1801");
assert.equal(inventory.paired.find(({ clipId }) => clipId === "jujae-regression-0-16_5").media.averageFrameRate, "60000/1001");
assert.equal(rows.find(({ clipId }) => clipId === "arms-crossed").ptsTicks, "512");
assert.equal(rows.find(({ clipId }) => clipId === "dance-16x9-padded").ptsTicks, "90071992547409930");
assert.ok(rows.every((row) => typeof row.ptsTicks === "string" && /^[0-9]+$/.test(row.ptsTicks)));
assert.ok(rows.every((row) => row.loopEpoch === 0 && row.decodeStatus === "decoded" && row.decodeReason === null));
for (const clipId of CLIP_IDS) {
  const clipRows = rows.filter((row) => row.clipId === clipId);
  assert.deepEqual(clipRows.map(({ sourceFrameIndex }) => sourceFrameIndex), [0, 1, 2]);
}
assert.equal(decoderText.endsWith("\n"), true);
assert.equal(decoderText.includes("\r"), false);
assert.equal(inventory.decoderManifest.byteSha256, sha256(decoderBytes));
assert.equal(inventory.decoderManifest.canonicalRowsSha256, canonicalHash(rows));
assert.equal(inventory.sourceContract.expectedCanonicalHash, inventory.sourceContract.canonicalSha256);
assert.equal(inventory.sourceContract.canonicalSha256, EXPECTED_SOURCE_CONTRACT_SHA256);
assert.equal(inventory.sourceSchema.canonicalSha256, EXPECTED_SOURCE_SCHEMA_SHA256);
assert.equal(inventory.expectedCanonicalHash, canonicalHash(inventory, { omitRootExpected: true }));
assert.equal(Object.hasOwn(inventory, "contract"), false);

const decoderMtime = statSync(decoderPath).mtimeMs;
const inventoryMtime = statSync(inventoryPath).mtimeMs;
const checked = runCli({ extra: ["--check"] });
assert.equal(checked.status, 0, checked.stderr);
assert.equal(parseReport(checked).status, "passed");
assert.deepEqual(readFileSync(decoderPath), decoderBytes);
assert.equal(statSync(decoderPath).mtimeMs, decoderMtime);
assert.equal(statSync(inventoryPath).mtimeMs, inventoryMtime);

const extraFieldRun = runCli({ mode: "EXTRA_FIELDS" });
assert.equal(extraFieldRun.status, 0, extraFieldRun.stderr);
assert.deepEqual(readFileSync(decoderPath), decoderBytes);

// A failed build after several successful probes must not touch either prior artifact.
const inventoryBytes = readFileSync(inventoryPath);
const midBuildFailure = runCli({ mode: "FRAME_STREAM_MISMATCH" });
assert.notEqual(midBuildFailure.status, 0);
assert.match(midBuildFailure.stderr, /frame_stream_mismatch/);
assert.deepEqual(readFileSync(decoderPath), decoderBytes);
assert.deepEqual(readFileSync(inventoryPath), inventoryBytes);

// Inventory is the last commit marker; a failure after decoder install rolls both files back.
const pairCommitFailure = runCli({
  env: { SAM_GOAL_SOURCE_PTS_FAULT_AFTER_DECODER_COMMIT: "1" },
});
assert.notEqual(pairCommitFailure.status, 0);
assert.match(pairCommitFailure.stderr, /artifact_pair_commit_failed:injected_after_decoder_commit/);
assert.deepEqual(readFileSync(decoderPath), decoderBytes);
assert.deepEqual(readFileSync(inventoryPath), inventoryBytes);

// Physical-only JSONL drift is distinct from semantic drift.
writeFileSync(decoderPath, decoderText.replace("\n", " \n"));
let drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_physical_byte_drift"));
assert.ok(!drift.drifts.some(({ code }) => code === "decoder_canonical_semantic_drift"));
assert.equal(runCli().status, 0);

const semanticRows = readJsonl(decoderPath);
semanticRows[0].ptsTicks = "513";
writeFileSync(decoderPath, `${semanticRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_canonical_semantic_drift"));
assert.equal(runCli().status, 0);

const deletedRows = readJsonl(decoderPath);
deletedRows.splice(4, 1);
writeFileSync(decoderPath, `${deletedRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_row_count_drift"));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_canonical_semantic_drift"));
assert.equal(runCli().status, 0);

const reorderedRows = readJsonl(decoderPath);
[reorderedRows[0], reorderedRows[3]] = [reorderedRows[3], reorderedRows[0]];
writeFileSync(decoderPath, `${reorderedRows.map((row) => JSON.stringify(row)).join("\n")}\n`);
drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_row_order_drift"));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_canonical_semantic_drift"));
assert.equal(runCli().status, 0);

// Inventory drift reports the affected dimensions rather than only a generic hash failure.
const mutatedInventory = readJson(inventoryPath);
mutatedInventory.ffprobe.version = "ffprobe version changed";
mutatedInventory.paired[0].media.width += 1;
mutatedInventory.paired[0].decoderRowCount += 1;
mutatedInventory.paired[0].firstPtsTicks = "0";
mutatedInventory.sourceContract.canonicalSha256 = "f".repeat(64);
writeJson(inventoryPath, mutatedInventory);
drift = parseReport(runCli({ extra: ["--check"] }));
for (const code of [
  "source_contract_hash_drift",
  "ffprobe_profile_drift",
  "media_metadata_drift",
  "decoder_row_count_drift",
  "pts_extent_drift",
  "inventory_canonical_semantic_drift",
]) assert.ok(drift.drifts.some((entry) => entry.code === code), code);
assert.equal(runCli().status, 0);

// Source bytes are part of inventory identity even when the fake frame stream stays constant.
const firstVideo = videos.get(CLIP_IDS[0]);
const originalVideoBytes = readFileSync(firstVideo);
writeFileSync(firstVideo, Buffer.concat([originalVideoBytes, Buffer.from("mutation")]));
drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "source_identity_drift"));
assert.ok(drift.drifts.some(({ code }) => code === "inventory_canonical_semantic_drift"));
writeFileSync(firstVideo, originalVideoBytes);
assert.equal(runCli().status, 0);

// Probe-time source mutation cannot produce a hash/PTS pair from different bytes.
const probeMutatedVideo = videos.get("dance-16x9-padded");
const probeMutatedOriginal = readFileSync(probeMutatedVideo);
const probeMutationFailure = runCli({ mode: "MUTATE_SOURCE_DURING_PROBE" });
assert.notEqual(probeMutationFailure.status, 0);
assert.match(probeMutationFailure.stderr, /source_hash_drift:dance-16x9-padded/);
assert.deepEqual(readFileSync(decoderPath), decoderBytes);
assert.deepEqual(readFileSync(inventoryPath), inventoryBytes);
writeFileSync(probeMutatedVideo, probeMutatedOriginal);

// A later probe cannot mutate an already-probed earlier source past the final source-set barrier.
const earlierVideo = videos.get("arms-crossed");
const earlierOriginal = readFileSync(earlierVideo);
const laterProbeMutationFailure = runCli({
  mode: "MUTATE_EARLIER_SOURCE_DURING_LATER_PROBE",
  env: { FAKE_MUTATION_TARGET: earlierVideo },
});
assert.notEqual(laterProbeMutationFailure.status, 0);
assert.match(laterProbeMutationFailure.stderr, /source_hash_drift:arms-crossed/);
assert.deepEqual(readFileSync(decoderPath), decoderBytes);
assert.deepEqual(readFileSync(inventoryPath), inventoryBytes);
writeFileSync(earlierVideo, earlierOriginal);

// Missing committed artifacts are explicit failures.
rmSync(decoderPath);
drift = parseReport(runCli({ extra: ["--check"] }));
assert.ok(drift.drifts.some(({ code }) => code === "decoder_manifest_missing"));
assert.equal(runCli().status, 0);

for (const [mode, message] of [
  ["MULTIPLE_SELECTED_STREAMS", /selected_stream_count/],
  ["NO_SELECTED_STREAM", /selected_stream_count/],
  ["INVALID_TIME_BASE", /invalid_rational/],
  ["FRAME_STREAM_MISMATCH", /frame_stream_mismatch/],
  ["FRAME_TIME_BASE_MISMATCH", /frame_time_base_mismatch/],
  ["DUPLICATE_PTS", /frame_pts_duplicate/],
  ["NONMONOTONIC_PTS", /frame_pts_nonmonotonic/],
  ["MISSING_PTS", /frame_pts_invalid/],
  ["FRACTIONAL_PTS", /frame_pts_invalid/],
  ["EXPONENT_PTS", /frame_pts_invalid/],
  ["NEGATIVE_PTS", /frame_pts_invalid/],
  ["LEADING_ZERO_PTS", /frame_pts_invalid/],
  ["NO_FRAMES", /no_decoded_frames/],
  ["FFPROBE_FAIL", /ffprobe_failed/],
]) expectFailure(mode, message);

let invalid = runCli({ mode: "MALFORMED_STREAM_JSON", extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "ffprobe_output_invalid"));

invalid = runCli({ extra: ["--video", `unknown-clip=${firstVideo}`] });
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /unknown_clip_override/);
invalid = runCli({ extra: ["--video", `${CLIP_IDS[0]}=${firstVideo}`] });
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /duplicate_clip_override/);
invalid = runCli({ extra: ["--video", `jujae-full=${unpairedVideo}`] });
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /unpaired_leakage/);
invalid = runCli({ extra: ["--unpaired-video", unpairedVideo] });
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /duplicate_argument:--unpaired-video/);

// Fatal source-input drift in check mode is machine-readable and fails before probing.
const badContractPath = path.join(tempRoot, "bad contract hash.json");
const badContract = readJson(SOURCE_CONTRACT_PATH);
badContract.expectedCanonicalHash = "0".repeat(64);
writeJson(badContractPath, badContract);
const badContractArgs = [...baseArgs];
badContractArgs[badContractArgs.indexOf("--source-contract") + 1] = badContractPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: badContractArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_contract_hash_drift"));

const badSchemaContractPath = path.join(tempRoot, "bad schema hash contract.json");
const badSchemaContract = readJson(SOURCE_CONTRACT_PATH);
badSchemaContract.sourceSchema.canonicalSha256 = "f".repeat(64);
badSchemaContract.expectedCanonicalHash = canonicalHash(badSchemaContract, { omitRootExpected: true });
writeJson(badSchemaContractPath, badSchemaContract);
const badSchemaArgs = [...baseArgs];
badSchemaArgs[badSchemaArgs.indexOf("--source-contract") + 1] = badSchemaContractPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: badSchemaArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_contract_hash_drift"));

// A semantically changed contract remains rejected even when internally rehashed.
const sourceChangedContractPath = path.join(tempRoot, "source changed and rehashed contract.json");
const sourceChangedContract = readJson(SOURCE_CONTRACT_PATH);
sourceChangedContract.paired[0].video = "different-source.mp4";
sourceChangedContract.expectedCanonicalHash = canonicalHash(sourceChangedContract, { omitRootExpected: true });
writeJson(sourceChangedContractPath, sourceChangedContract);
const sourceChangedArgs = [...baseArgs];
sourceChangedArgs[sourceChangedArgs.indexOf("--source-contract") + 1] = sourceChangedContractPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: sourceChangedArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_contract_hash_drift"));

const forbiddenFieldContractPath = path.join(tempRoot, "forbidden field and rehashed contract.json");
const forbiddenFieldContract = readJson(SOURCE_CONTRACT_PATH);
forbiddenFieldContract.paired[0].teacher = "not-a-source-input";
forbiddenFieldContract.expectedCanonicalHash = canonicalHash(
  forbiddenFieldContract,
  { omitRootExpected: true },
);
writeJson(forbiddenFieldContractPath, forbiddenFieldContract);
const forbiddenFieldArgs = [...baseArgs];
forbiddenFieldArgs[forbiddenFieldArgs.indexOf("--source-contract") + 1] = forbiddenFieldContractPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: forbiddenFieldArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => (
  code === "source_contract_shape_drift" || code === "source_contract_hash_drift"
)));

// Rehashing both a changed schema and its referring contract cannot mint a new accepted source input.
const changedSchemaPath = path.join(tempRoot, "changed source schema.json");
const changedSchema = readJson(SOURCE_SCHEMA_PATH);
changedSchema.$defs.decoderRow.properties.clipId.minLength = 2;
writeJson(changedSchemaPath, changedSchema);
const changedSchemaContractPath = path.join(tempRoot, "changed schema rehashed contract.json");
const changedSchemaContract = readJson(SOURCE_CONTRACT_PATH);
changedSchemaContract.sourceSchema.canonicalSha256 = canonicalHash(changedSchema);
changedSchemaContract.expectedCanonicalHash = canonicalHash(
  changedSchemaContract,
  { omitRootExpected: true },
);
writeJson(changedSchemaContractPath, changedSchemaContract);
const changedSchemaArgs = [...baseArgs];
changedSchemaArgs[changedSchemaArgs.indexOf("--source-contract") + 1] = changedSchemaContractPath;
changedSchemaArgs[changedSchemaArgs.indexOf("--source-schema") + 1] = changedSchemaPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: changedSchemaArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_contract_hash_drift"));

const changedSchemaOnlyArgs = [...baseArgs];
changedSchemaOnlyArgs[changedSchemaOnlyArgs.indexOf("--source-schema") + 1] = changedSchemaPath;
invalid = runCli({ mode: "FAIL_IF_CALLED", args: changedSchemaOnlyArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_schema_hash_drift"));

const missingContractArgs = [...baseArgs];
missingContractArgs[missingContractArgs.indexOf("--source-contract") + 1] = path.join(tempRoot, "missing-contract.json");
invalid = runCli({ mode: "FAIL_IF_CALLED", args: missingContractArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_contract_input_missing"));

const missingSchemaArgs = [...baseArgs];
missingSchemaArgs[missingSchemaArgs.indexOf("--source-schema") + 1] = path.join(tempRoot, "missing-schema.json");
invalid = runCli({ mode: "FAIL_IF_CALLED", args: missingSchemaArgs, extra: ["--check"] });
assert.notEqual(invalid.status, 0);
assert.ok(parseReport(invalid).drifts.some(({ code }) => code === "source_schema_input_missing"));

invalid = runCli({ args: [...baseArgs, "--contract", badContractPath] });
assert.notEqual(invalid.status, 0);
assert.match(invalid.stderr, /unknown_argument:--contract/);

// An unrelated semantics file is demonstrably not an input.
const unrelatedSemantics = path.join(tempRoot, "unrelated-evaluation-contract.json");
writeJson(unrelatedSemantics, { version: 1, threshold: 1 });
assert.equal(runCli().status, 0);
const beforeUnrelatedMutationDecoder = readFileSync(decoderPath);
const beforeUnrelatedMutationInventory = readFileSync(inventoryPath);
writeJson(unrelatedSemantics, { version: 99, threshold: -1, changed: true });
assert.equal(runCli().status, 0);
assert.deepEqual(readFileSync(decoderPath), beforeUnrelatedMutationDecoder);
assert.deepEqual(readFileSync(inventoryPath), beforeUnrelatedMutationInventory);
rmSync(unrelatedSemantics);
assert.equal(runCli({ extra: ["--check"] }).status, 0);

// Root-only exclusion keeps nested expected hashes and ordered arrays semantic.
const rootOnlyInventory = readJson(inventoryPath);
const rootOnlyHash = canonicalHash(rootOnlyInventory, { omitRootExpected: true });
rootOnlyInventory.sourceContract.expectedCanonicalHash = "a".repeat(64);
assert.notEqual(canonicalHash(rootOnlyInventory, { omitRootExpected: true }), rootOnlyHash);
const orderedContract = readJson(SOURCE_CONTRACT_PATH);
const orderedContractHash = canonicalHash(orderedContract, { omitRootExpected: true });
orderedContract.paired.reverse();
assert.notEqual(canonicalHash(orderedContract, { omitRootExpected: true }), orderedContractHash);

validateJsonlWithDraft202012(REAL_DECODER_PATH, 6711);
validateJsonWithDraft202012(SOURCE_CONTRACT_PATH);
validateJsonWithDraft202012(REAL_INVENTORY_PATH);
assert.equal(canonicalHash(readJson(SOURCE_SCHEMA_PATH)), EXPECTED_SOURCE_SCHEMA_SHA256);
assert.equal(
  canonicalHash(readJson(SOURCE_CONTRACT_PATH), { omitRootExpected: true }),
  EXPECTED_SOURCE_CONTRACT_SHA256,
);
const realDecoderAfter = readFileSync(REAL_DECODER_PATH);
assert.equal(sha256(realDecoderAfter), EXPECTED_DECODER_BYTE_SHA256);
assert.equal(canonicalHash(readJsonl(REAL_DECODER_PATH)), EXPECTED_DECODER_CANONICAL_SHA256);

console.log(JSON.stringify({
  status: "passed",
  checks: 82,
  syntheticPairedRows: rows.length,
  preservedLargePts: rows.find(({ clipId }) => clipId === "dance-16x9-padded").ptsTicks,
  tempRoot,
}, null, 2));
