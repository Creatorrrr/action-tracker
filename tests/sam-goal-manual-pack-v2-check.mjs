import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts/sam-goal-manual-pack-v2.mjs");
const AUTHOR_SCHEMA = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/authoring-schema.json");
const ANCHOR_SCHEMA = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/p0-lock-anchor-schema.json");
const CONTRACT_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json");
const EVAL_SCHEMA_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json");
const DECODER_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl");
const INVENTORY_PATH = path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/source-inventory.json");
const PRESERVED = new Map([
  ["tests/fixtures/sam-goal-v2/evaluation-v2/evaluation-contract.json", "a0f7a52da26a2c4f0c318259c6547e89fc35048ddf031398b87666b75508fd32"],
  ["tests/fixtures/sam-goal-v2/evaluation-v2/label-schema.json", "1c27fac6cd82f521a7491672c74263f98866f0a9c66c6b3273d452c4196dfdb3"],
  ["scripts/sam-goal-label-audit-v2.mjs", "1b9870e99e0dea093925e1ed0b5f9ed3cd9d146315482a38e640006e7968fdf6"],
  ["tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl", "d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79"],
  ["tests/fixtures/sam-goal-v2/labels/source-inventory.json", "e4289a7e0d3503fe163e315317f4532b0c8565929491d82303456b512b0e2fd7"],
  ["tests/fixtures/sam-goal-v2/evaluation-contract.json", "7883afc32fa882eec62b015d882526762dfa132a099ed603e445623159afa3a4"],
  ["tests/fixtures/sam-goal-v2/label-schema.json", "1ae3fa22f47043d014d9cb40b45d28b319e25da390e90e03dbdbbc1a5e10f765"],
]);
const started = process.hrtime.bigint();
const tempParent = path.resolve(os.tmpdir());
const beforeRoots = new Set(readdirSync(tempParent).filter((name) => /^sam-manual-pack-v2-[A-Za-z0-9]+$/.test(name)).map((name) => path.join(tempParent, name)));
const tempRoot = mkdtempSync(path.join(tempParent, "sam-manual-pack-v2-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  const resolved = path.resolve(tempRoot);
  if (path.dirname(resolved) !== tempParent || !/^sam-manual-pack-v2-[A-Za-z0-9]+$/.test(path.basename(resolved))) throw new Error(`unsafe_cleanup:${resolved}`);
  rmSync(resolved, { recursive: true, force: true }); cleaned = true;
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { cleanup(); process.exit(signal === "SIGINT" ? 130 : 143); });
const cleanupProbeIndex = process.argv.indexOf("--cleanup-probe");
if (cleanupProbeIndex >= 0) {
  const marker = process.argv[cleanupProbeIndex + 1];
  if (!marker) throw new Error("cleanup_probe_marker_required");
  writeFileSync(marker, tempRoot); mkdirSync(path.join(tempRoot, "partial")); writeFileSync(path.join(tempRoot, "partial", "file"), "partial");
  throw new Error("intentional_manual_pack_cleanup_probe");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function canonical(value, omit = false) { const target = omit ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "expectedCanonicalHash")) : value; return hash(JSON.stringify(stable(target))); }
function withHash(value) { const result = { ...value, expectedCanonicalHash: "" }; result.expectedCanonicalHash = canonical(result, true); return result; }
function writeJson(filePath, value) { writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }
function readJson(filePath) { return JSON.parse(readFileSync(filePath, "utf8")); }
function flat(value, prefix = "", output = {}) {
  for (const [name, child] of Object.entries(value)) { const key = prefix ? `${prefix}.${name}` : name; if (child && typeof child === "object" && !Array.isArray(child)) flat(child, key, output); else output[key] = child; }
  return output;
}
function differences(left, right) { const a = flat(left); const b = flat(right); return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort(); }

for (const [file, expected] of PRESERVED) assert.equal(hash(readFileSync(path.join(ROOT, file))), expected, file);
const contract = readJson(CONTRACT_PATH); const inventory = readJson(INVENTORY_PATH);
const decoder = readFileSync(DECODER_PATH, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
assert.equal(decoder.length, 6711);
const byClip = new Map(); decoder.forEach((row) => { if (!byClip.has(row.clipId)) byClip.set(row.clipId, []); byClip.get(row.clipId).push(row); });
const sourceBinding = {
  evaluationContractCanonicalSha256: contract.expectedCanonicalHash,
  evaluationSchemaCanonicalSha256: contract.labelSchema.canonicalSha256,
  sourceInventoryCanonicalSha256: inventory.expectedCanonicalHash,
  decoderByteSha256: hash(readFileSync(DECODER_PATH)), decoderCanonicalRowsSha256: canonical(decoder), decoderRowCount: 6711,
  sources: inventory.paired.map(({ clipId, video }) => ({ clipId, path: video.path, bytes: video.bytes, sha256: video.sha256 })),
};

const absentFrames = new Set(["arms-crossed:0", "arms-crossed:1", "arms-crossed:2", "arms-crossed:3", "arms-crossed:4", "arms-crossed:5", "arms-crossed:6", "arms-crossed:30", "arms-crossed:31", "arms-crossed:32", "arms-crossed:33", "arms-crossed:34", "arms-crossed:35", "arms-crossed:36", "csi-pose:0", "csi-pose:1", "csi-pose:2", "csi-pose:3", "csi-pose:4", "csi-pose:5", "csi-pose:6"]);
function presentState(row) {
  const phase = Math.floor(row.sourceFrameIndex / 350) % 2;
  const multiple = row.clipId === "csi-pose" && row.sourceFrameIndex === 100;
  return {
    presence: "present", personState: multiple ? "multiple_people" : "single_target",
    occlusion: { body: "observable", leftFoot: "observable", rightFoot: "observable", leftHand: "observable", rightHand: "observable" },
    contact: { left: phase ? "moving" : "planted", right: phase ? "planted" : "moving" },
    handObservability: { left: "observable", right: "observable" },
    endpointObservability: { leftWrist: "observable", rightWrist: "observable", leftAnkle: "observable", rightAnkle: "observable", head: "observable" },
    subjectSelection: { state: "selected", manualTargetId: `target-${row.clipId}`, anchor: multiple ? { x: 0.5, y: 0.5 } : null },
  };
}
function absentState() {
  return {
    presence: "absent", personState: "absent", occlusion: { body: "out_of_frame", leftFoot: "out_of_frame", rightFoot: "out_of_frame", leftHand: "out_of_frame", rightHand: "out_of_frame" },
    contact: { left: "unknown", right: "unknown" }, handObservability: { left: "not_observable", right: "not_observable" },
    endpointObservability: { leftWrist: "not_observable", rightWrist: "not_observable", leftAnkle: "not_observable", rightAnkle: "not_observable", head: "not_observable" },
    subjectSelection: { state: "absent", manualTargetId: null, anchor: null },
  };
}
function windows(overlayEnd = 20) {
  const result = contract.sourceBinding.paired.map((clip) => ({ windowId: `base-${clip.clipId}`, clipId: clip.clipId, startFrameIndex: 0, endFrameIndexExclusive: clip.rows, purposeTags: ["full_clip_denominator"], scenarioTags: ["neutral"] }));
  result.push({ windowId: "overlay-reacquire", clipId: "arms-crossed", startFrameIndex: 0, endFrameIndexExclusive: overlayEnd, purposeTags: ["absence_reacquire"], scenarioTags: ["reacquire"] });
  return result;
}
function membership(windowRows, clipId, frame) { return windowRows.filter((window) => window.clipId === clipId && frame >= window.startFrameIndex && frame < window.endFrameIndexExclusive).map((window) => window.windowId).sort(); }
function frameValues(options = {}) {
  return decoder.map((row) => {
    const absent = !options.noReacquire && absentFrames.has(`${row.clipId}:${row.sourceFrameIndex}`);
    const state = absent ? absentState() : presentState(row);
    if (options.lowSupport && state.presence === "present") state.contact = { left: "planted", right: "planted" };
    return { scenarios: [row.clipId.includes("dance") ? "full_body_dance" : "neutral"], state };
  });
}
function mergeClips(values, windowRows) {
  const clips = [];
  for (const clip of contract.sourceBinding.paired) {
    const rows = byClip.get(clip.clipId); const intervals = []; let start = 0;
    while (start < rows.length) {
      const global = decoder.findIndex((row) => row.clipId === clip.clipId && row.sourceFrameIndex === start);
      const base = values[global]; const member = JSON.stringify(membership(windowRows, clip.clipId, start)); let end = start + 1;
      while (end < rows.length) {
        const index = global + (end - start);
        if (JSON.stringify(stable(values[index])) !== JSON.stringify(stable(base)) || JSON.stringify(membership(windowRows, clip.clipId, end)) !== member) break;
        end += 1;
      }
      intervals.push({ startFrameIndex: start, endFrameIndexExclusive: end, scenarios: base.scenarios, state: base.state }); start = end;
    }
    clips.push({ clipId: clip.clipId, intervals });
  }
  return clips;
}
function buildReview(role, pseudonym, options = {}) {
  const reviewWindows = windows(options.overlayEnd || 20); const values = frameValues(options);
  if (role === "second" && !options.noDefaultDifferences) {
    values[1000].state.contact.left = values[1000].state.contact.left === "planted" ? "moving" : "planted";
    const multiple = decoder.findIndex((row) => row.clipId === "csi-pose" && row.sourceFrameIndex === 100);
    values[multiple].state.subjectSelection.anchor.x = 0.6;
  }
  if (role === "second" && options.subjectStateDifference) {
    const multiple = decoder.findIndex((row) => row.clipId === "csi-pose" && row.sourceFrameIndex === 100);
    values[multiple].state.subjectSelection = { state: "ambiguous", manualTargetId: null, anchor: null };
  }
  if (role === "second" && options.alternateTargetClip) {
    decoder.forEach((row, index) => {
      if (row.clipId === options.alternateTargetClip && values[index].state.subjectSelection.state === "selected") values[index].state.subjectSelection.manualTargetId = `alternate-${row.clipId}`;
    });
  }
  return withHash({ artifactType: "manual-review-authoring-v2", schemaVersion: 1, role, reviewerPseudonymSha256: pseudonym, origin: "manual_video", reviewed: true, sourceBinding, windows: reviewWindows, clips: mergeClips(values, reviewWindows) });
}
function materializeReview(review) {
  const result = new Map();
  for (const clip of review.clips) for (const interval of clip.intervals) for (let frame = interval.startFrameIndex; frame < interval.endFrameIndexExclusive; frame += 1) result.set(`${clip.clipId}:${frame}`, { scenarios: interval.scenarios, state: interval.state });
  return result;
}
function buildAdjudication(first, second, options = {}) {
  const a = materializeReview(first); const b = materializeReview(second); const decisions = [];
  for (const row of decoder) {
    const key = `${row.clipId}:${row.sourceFrameIndex}`; const fields = differences(a.get(key), b.get(key));
    if (fields.length && !options.omitDecisions) decisions.push({ clipId: row.clipId, startFrameIndex: row.sourceFrameIndex, endFrameIndexExclusive: row.sourceFrameIndex + 1, disagreementFields: options.wrongFields ? ["subjectSelection.missing"] : fields, scenarios: a.get(key).scenarios, state: a.get(key).state });
  }
  return withHash({ artifactType: "manual-adjudication-authoring-v2", schemaVersion: 1, origin: "manual_video", adjudicated: true, adjudicatorPseudonymSha256: "3".repeat(64), reviewACanonicalSha256: first.expectedCanonicalHash, reviewBCanonicalSha256: second.expectedCanonicalHash, windows: options.windows || first.windows, decisions });
}

function run(args, env = {}) { return spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }); }
function startRun(args, env = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}
async function waitForFile(filePath, running, label) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (existsSync(filePath)) return;
    if (running.child.exitCode !== null || running.child.signalCode !== null) assert.fail(`${label}:child_exited_before_barrier`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  running.child.kill("SIGKILL");
  assert.fail(`${label}:barrier_timeout`);
}
const readGuardPath = path.join(tempRoot, "single-read-guard.mjs");
writeFileSync(readGuardPath, `
import fs from "node:fs";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
const originalRead = fs.readFileSync;
const limits = new Map(Object.entries(JSON.parse(process.env.SAM_GOAL_READ_LIMITS || "{}")));
const counts = new Map();
fs.readFileSync = function guardedRead(file, ...args) {
  const resolved = typeof file === "string" ? path.resolve(file) : "";
  const key = resolved ? fs.realpathSync(resolved) : "";
  if (limits.has(key)) {
    const count = (counts.get(key) || 0) + 1; counts.set(key, count);
    if (count > Number(limits.get(key))) throw new Error(\`read_guard_multiple:\${key}:\${count}\`);
  }
  return originalRead.call(this, file, ...args);
};
syncBuiltinESMExports();
process.on("exit", () => fs.writeFileSync(process.env.SAM_GOAL_READ_TRACE, JSON.stringify(Object.fromEntries(counts))));
`);
let readGuardSerial = 0;
function runWithReadGuard(args, limits) {
  const trace = path.join(tempRoot, `read-trace-${readGuardSerial += 1}.json`);
  const command = spawnSync(process.execPath, ["--import", readGuardPath, CLI, ...args], {
    cwd: ROOT, encoding: "utf8", env: { ...process.env, SAM_GOAL_READ_LIMITS: JSON.stringify(limits), SAM_GOAL_READ_TRACE: trace }, maxBuffer: 64 * 1024 * 1024,
  });
  const counts = existsSync(trace) ? readJson(trace) : {};
  return { command, counts };
}
function result(value) { try { return JSON.parse(value.stdout); } catch { assert.fail(`invalid JSON status=${value.status}\n${value.stdout}\n${value.stderr}`); } }
function fail(value, pattern) { assert.notEqual(value.status, 0, value.stdout); assert.match(result(value).errors[0].detail, pattern); }
function compileArgs(a, b, adjudication, output) { return ["compile", "--review-a", a, "--review-b", b, "--adjudication", adjudication, "--output-dir", output]; }
function anchorArgs(mode, anchor, labelDir, a, b, adjudication) { return [mode, "--anchor", anchor, "--label-dir", labelDir, "--review-a", a, "--review-b", b, "--adjudication", adjudication]; }
function writeInputs(dir, first, second, adjudication) { mkdirSync(dir, { recursive: true }); const a = path.join(dir, "first.json"); const b = path.join(dir, "second.json"); const c = path.join(dir, "adjudication.json"); writeJson(a, first); writeJson(b, second); writeJson(c, adjudication); return { a, b, c }; }
function directoryHashes(dir) { return readdirSync(dir).sort().map((name) => [name, hash(readFileSync(path.join(dir, name)))]); }

const first = buildReview("first", "1".repeat(64));
const second = buildReview("second", "2".repeat(64));
const adjudication = buildAdjudication(first, second);
const inputs = writeInputs(path.join(tempRoot, "inputs"), first, second, adjudication);

let command = run(["validate-review", "--review", inputs.a, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", "1".repeat(64)]);
assert.equal(command.status, 0, command.stdout || command.stderr);
assert.equal(result(command).materializedRows, 6711);
assert.equal(result(command).reacquireCandidates.length, 3);
command = run(["validate-review", "--review", inputs.b, "--expected-role", "second", "--expected-reviewer-pseudonym-sha256", "2".repeat(64)]);
assert.equal(command.status, 0, command.stdout || command.stderr);
assert.equal(result(command).materializedRows, 6711);

const output1 = path.join(tempRoot, "compiled-one");
command = run(compileArgs(inputs.a, inputs.b, inputs.c, output1));
assert.equal(command.status, 0, command.stdout || command.stderr);
const compileOne = result(command);
assert.equal(compileOne.status, "compiled");
assert.equal(compileOne.materializedRowsPerPass, 6711);
assert.equal(readdirSync(output1).length, 9);

const output2 = path.join(tempRoot, "compiled-two");
command = run(compileArgs(inputs.a, inputs.b, inputs.c, output2));
assert.equal(command.status, 0, command.stdout || command.stderr);
const compileTwo = result(command);
assert.equal(compileTwo.candidateP0LockSha256, compileOne.candidateP0LockSha256);
assert.equal(compileTwo.compiledArtifactSetSha256, compileOne.compiledArtifactSetSha256);
assert.deepEqual(directoryHashes(output2), directoryHashes(output1));

const singleReadInputs = [AUTHOR_SCHEMA, ANCHOR_SCHEMA, CONTRACT_PATH, EVAL_SCHEMA_PATH, INVENTORY_PATH, DECODER_PATH, inputs.a, inputs.b, inputs.c].map((file) => realpathSync(file));
const singleReadLimits = Object.fromEntries(singleReadInputs.map((file) => [file, 1]));
const guardedOutput = path.join(tempRoot, "single-read-compiled");
const guardedCompile = runWithReadGuard(compileArgs(inputs.a, inputs.b, inputs.c, guardedOutput), singleReadLimits);
assert.equal(guardedCompile.command.status, 0, guardedCompile.command.stdout || guardedCompile.command.stderr);
assert.deepEqual(guardedCompile.counts, Object.fromEntries(singleReadInputs.map((file) => [file, 1])));
assert.deepEqual(directoryHashes(guardedOutput), directoryHashes(output1));
const fakeBin = path.join(tempRoot, "fake-bin"); mkdirSync(fakeBin);
const fakePython = path.join(fakeBin, "python3"); writeFileSync(fakePython, "#!/bin/sh\nexit 97\n"); chmodSync(fakePython, 0o755);
const pathShadowOutput = path.join(tempRoot, "path-shadow-compiled");
const pathShadowCompile = run(compileArgs(inputs.a, inputs.b, inputs.c, pathShadowOutput), { PATH: fakeBin });
assert.equal(pathShadowCompile.status, 0, pathShadowCompile.stdout || pathShadowCompile.stderr);
assert.deepEqual(directoryHashes(pathShadowOutput), directoryHashes(output1));

const anchorPath = path.join(tempRoot, "external-p0-anchor.json");
command = run(anchorArgs("create-anchor", anchorPath, output1, inputs.a, inputs.b, inputs.c));
assert.equal(command.status, 0, command.stdout || command.stderr);
const createdAnchorBytes = readFileSync(anchorPath);
const createdAnchor = readJson(anchorPath);
assert.equal(createdAnchor.candidateP0LockSha256, compileOne.candidateP0LockSha256);
assert.equal(createdAnchor.evaluationPack.canonicalSha256, compileOne.candidateP0LockSha256);
assert.equal(createdAnchor.compiledArtifacts.length, 9);
assert.equal(createdAnchor.compiledArtifactSetSha256, compileOne.compiledArtifactSetSha256);
const labelBytesBeforeVerify = directoryHashes(output1);
command = run(anchorArgs("verify-anchor", anchorPath, output1, inputs.a, inputs.b, inputs.c));
assert.equal(command.status, 0, command.stdout || command.stderr);
assert.equal(result(command).frozen, true);
assert.deepEqual(readFileSync(anchorPath), createdAnchorBytes);
assert.deepEqual(directoryHashes(output1), labelBytesBeforeVerify);
const verifyReadInputs = [...singleReadInputs, ...readdirSync(output1).map((name) => realpathSync(path.join(output1, name)))];
const verifyReadLimits = Object.fromEntries(verifyReadInputs.map((file) => [file, 1]));
const anchorReal = realpathSync(anchorPath); verifyReadLimits[anchorReal] = 2;
const guardedVerify = runWithReadGuard(anchorArgs("verify-anchor", anchorPath, output1, inputs.a, inputs.b, inputs.c), verifyReadLimits);
assert.equal(guardedVerify.command.status, 0, guardedVerify.command.stdout || guardedVerify.command.stderr);
assert.deepEqual(guardedVerify.counts, Object.fromEntries([...verifyReadInputs.map((file) => [file, 1]), [anchorReal, 2]]));

fail(run(["validate-review", "--review", inputs.a, "--expected-role", "second", "--expected-reviewer-pseudonym-sha256", "1".repeat(64)]), /review_role_mismatch/);
fail(run(["validate-review", "--review", inputs.a, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", "9".repeat(64)]), /reviewer_pseudonym_mismatch/);
fail(run(compileArgs(inputs.a, inputs.a, inputs.c, path.join(tempRoot, "same-review-output"))), /review_paths_not_independent/);

function reviewAttack(name, mutate, pattern) {
  const filePath = path.join(tempRoot, `${name}.json`); const value = structuredClone(first); mutate(value); value.expectedCanonicalHash = canonical(value, true); writeJson(filePath, value);
  fail(run(["validate-review", "--review", filePath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", value.reviewerPseudonymSha256]), pattern);
}
reviewAttack("gap", (value) => { value.clips[0].intervals.shift(); }, /interval_gap/);
reviewAttack("overlap", (value) => { value.clips[0].intervals[1].startFrameIndex = value.clips[0].intervals[0].endFrameIndexExclusive - 1; }, /interval_overlap/);
reviewAttack("out-of-range", (value) => { value.clips[0].intervals.at(-1).endFrameIndexExclusive += 1; }, /interval_boundary/);
reviewAttack("membership-crossing", (value) => {
  const intervals = value.clips.find((clip) => clip.clipId === "arms-crossed").intervals;
  const index = intervals.findIndex((interval) => interval.endFrameIndexExclusive === 20);
  intervals[index].endFrameIndexExclusive = intervals[index + 1].endFrameIndexExclusive; intervals.splice(index + 1, 1);
}, /interval_membership_crossing/);
reviewAttack("unknown-field", (value) => { value.finalLabels = []; }, /schema_validation/);
reviewAttack("wall-clock", (value) => { value.generatedAt = "now"; }, /forbidden_authoring_key/);
reviewAttack("automated", (value) => { value.origin = "automated"; }, /forbidden_authoring_value|schema_validation/);
reviewAttack("sam-leakage", (value) => { value.samCandidateCount = 1; }, /forbidden_authoring_key/);
reviewAttack("live-leakage", (value) => { value.livePrediction = 1; }, /forbidden_authoring_key/);
reviewAttack("automated-subject", (value) => { value.clips[1].intervals[1].state.subjectSelection.automated = true; }, /forbidden_authoring_key/);
reviewAttack("source-video-drift", (value) => { value.sourceBinding.sources[0].sha256 = "f".repeat(64); }, /review_source_binding/);

{
  const filePath = path.join(tempRoot, "hash-order-drift.json"); const value = structuredClone(first); value.clips.reverse(); writeJson(filePath, value);
  fail(run(["validate-review", "--review", filePath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", "1".repeat(64)]), /self_hash_drift/);
}
{
  const duplicateSecond = structuredClone(second); duplicateSecond.reviewerPseudonymSha256 = first.reviewerPseudonymSha256; duplicateSecond.expectedCanonicalHash = canonical(duplicateSecond, true);
  const duplicateAdjudication = buildAdjudication(first, duplicateSecond);
  const variant = writeInputs(path.join(tempRoot, "duplicate-reviewer"), first, duplicateSecond, duplicateAdjudication);
  fail(run(compileArgs(variant.a, variant.b, variant.c, path.join(tempRoot, "duplicate-reviewer-output"))), /reviewer_pseudonyms_not_distinct/);
}
{
  const missing = buildAdjudication(first, second, { omitDecisions: true }); const variant = writeInputs(path.join(tempRoot, "missing-adjudication"), first, second, missing);
  fail(run(compileArgs(variant.a, variant.b, variant.c, path.join(tempRoot, "missing-adjudication-output"))), /adjudication_missing/);
}
{
  const missingSubject = structuredClone(adjudication);
  missingSubject.decisions = missingSubject.decisions.filter((decision) => !decision.disagreementFields.some((field) => field.includes("subjectSelection.anchor")));
  missingSubject.expectedCanonicalHash = canonical(missingSubject, true);
  const variant = writeInputs(path.join(tempRoot, "unreviewed-subject-transition"), first, second, missingSubject);
  fail(run(compileArgs(variant.a, variant.b, variant.c, path.join(tempRoot, "unreviewed-subject-transition-output"))), /adjudication_missing/);
}
{
  const wrong = buildAdjudication(first, second, { wrongFields: true }); const variant = writeInputs(path.join(tempRoot, "wrong-adjudication"), first, second, wrong);
  fail(run(compileArgs(variant.a, variant.b, variant.c, path.join(tempRoot, "wrong-adjudication-output"))), /adjudication_fields/);
}
{
  const secondWindowProposal = buildReview("second", "2".repeat(64), { overlayEnd: 21 });
  const finalWindowAdjudication = buildAdjudication(first, secondWindowProposal, { windows: first.windows });
  const variant = writeInputs(path.join(tempRoot, "adjudicated-windows"), first, secondWindowProposal, finalWindowAdjudication);
  const output = path.join(tempRoot, "adjudicated-windows-output"); const compiled = run(compileArgs(variant.a, variant.b, variant.c, output));
  assert.equal(compiled.status, 0, compiled.stdout || compiled.stderr);
  const compiledWindows = readJson(path.join(output, "manual-windows.json"));
  assert.equal(compiledWindows.windows.find((window) => window.windowId === "overlay-reacquire").expectedDecoderRows, 20);
}
{
  const stateSecond = buildReview("second", "2".repeat(64), { noDefaultDifferences: true, subjectStateDifference: true });
  const stateAdjudication = buildAdjudication(first, stateSecond); const variant = writeInputs(path.join(tempRoot, "subject-state-disagreement"), first, stateSecond, stateAdjudication);
  const output = path.join(tempRoot, "subject-state-disagreement-output"); const compiled = run(compileArgs(variant.a, variant.b, variant.c, output));
  assert.equal(compiled.status, 0, compiled.stdout || compiled.stderr);
  assert.match(readFileSync(path.join(output, "manual-adjudication.jsonl"), "utf8"), /subjectSelection\.state/);
}
{
  const targetSecond = buildReview("second", "2".repeat(64), { noDefaultDifferences: true, alternateTargetClip: "arms-crossed" });
  const targetAdjudication = buildAdjudication(first, targetSecond); const variant = writeInputs(path.join(tempRoot, "subject-target-disagreement"), first, targetSecond, targetAdjudication);
  const output = path.join(tempRoot, "subject-target-disagreement-output"); const compiled = run(compileArgs(variant.a, variant.b, variant.c, output));
  assert.equal(compiled.status, 0, compiled.stdout || compiled.stderr);
  assert.match(readFileSync(path.join(output, "manual-adjudication.jsonl"), "utf8"), /subjectSelection\.manualTargetId/);
}
{
  const scenarioSecond = buildReview("second", "2".repeat(64), { noDefaultDifferences: true });
  scenarioSecond.clips.find((clip) => clip.clipId === "arms-crossed").intervals[0].scenarios = ["arms_crossed"];
  scenarioSecond.expectedCanonicalHash = canonical(scenarioSecond, true);
  const scenarioAdjudication = buildAdjudication(first, scenarioSecond);
  const variant = writeInputs(path.join(tempRoot, "scenario-only-disagreement"), first, scenarioSecond, scenarioAdjudication);
  fail(run(compileArgs(variant.a, variant.b, variant.c, path.join(tempRoot, "scenario-only-output"))), /compiled_scenario_disagreement_unsupported/);
}
{
  const agreedSecond = buildReview("second", "2".repeat(64), { noDefaultDifferences: true });
  const agreedAdjudication = buildAdjudication(first, agreedSecond); const variant = writeInputs(path.join(tempRoot, "zero-disagreement"), first, agreedSecond, agreedAdjudication);
  const output = path.join(tempRoot, "zero-disagreement-output"); const compiled = run(compileArgs(variant.a, variant.b, variant.c, output));
  assert.equal(compiled.status, 0, compiled.stdout || compiled.stderr);
  assert.equal(readFileSync(path.join(output, "manual-adjudication.jsonl"), "utf8"), "");
}

const outputBefore = directoryHashes(output1);
fail(run(compileArgs(inputs.a, inputs.b, inputs.c, output1)), /output_dir_exists/);
assert.deepEqual(directoryHashes(output1), outputBefore);
{
  const output = path.join(tempRoot, "faulted-output");
  fail(run(compileArgs(inputs.a, inputs.b, inputs.c, output), { SAM_GOAL_MANUAL_PACK_FAULT_AFTER_FILES: "1" }), /injected_compile_failure/);
  assert.equal(existsSync(output), false);
  assert.equal(readdirSync(tempRoot).some((name) => name.includes("faulted-output.tmp")), false);
}
for (const [signal, expectedStatus] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  const suffix = signal.toLowerCase(); const output = path.join(tempRoot, `signal-${suffix}-output`);
  const ready = path.join(tempRoot, `signal-${suffix}-stage-ready`); const release = path.join(tempRoot, `signal-${suffix}-stage-release`);
  const running = startRun(compileArgs(inputs.a, inputs.b, inputs.c, output), {
    SAM_GOAL_MANUAL_PACK_TEST_STAGE_READY_FILE: ready, SAM_GOAL_MANUAL_PACK_TEST_STAGE_RELEASE_FILE: release,
  });
  await waitForFile(ready, running, `compile_${suffix}`);
  const stage = readFileSync(ready, "utf8").trim(); assert.equal(existsSync(stage), true);
  assert.equal(running.child.kill(signal), true);
  const completed = await running.completed;
  assert.equal(completed.status, expectedStatus, completed.stdout || completed.stderr); assert.equal(completed.signal, null);
  assert.equal(existsSync(stage), false); assert.equal(existsSync(output), false);
}
{
  const output = path.join(tempRoot, "commit-race-output");
  const ready = path.join(tempRoot, "commit-race-ready"); const release = path.join(tempRoot, "commit-race-release");
  const running = startRun(compileArgs(inputs.a, inputs.b, inputs.c, output), {
    SAM_GOAL_MANUAL_PACK_TEST_COMMIT_READY_FILE: ready, SAM_GOAL_MANUAL_PACK_TEST_COMMIT_RELEASE_FILE: release,
  });
  await waitForFile(ready, running, "commit_race");
  const stage = readFileSync(ready, "utf8").trim(); assert.equal(existsSync(stage), true);
  mkdirSync(output); const marker = path.join(output, "competitor-marker.txt"); writeFileSync(marker, "competitor-owned\n");
  const competitorInode = statSync(output).ino; const markerInode = statSync(marker).ino;
  writeFileSync(release, "release\n");
  const completed = await running.completed;
  fail(completed, /output_dir_raced/);
  assert.equal(statSync(output).ino, competitorInode); assert.equal(statSync(marker).ino, markerInode);
  assert.equal(readFileSync(marker, "utf8"), "competitor-owned\n"); assert.equal(existsSync(stage), false);
}
{
  const output = path.join(tempRoot, "stale-output"); mkdirSync(output); writeFileSync(path.join(output, "stale.txt"), "keep");
  fail(run(compileArgs(inputs.a, inputs.b, inputs.c, output)), /output_dir_exists/);
  assert.equal(readFileSync(path.join(output, "stale.txt"), "utf8"), "keep");
}
{
  const lowA = buildReview("first", "1".repeat(64), { lowSupport: true }); const lowB = buildReview("second", "2".repeat(64), { lowSupport: true, noDefaultDifferences: true });
  const lowAdj = buildAdjudication(lowA, lowB); const variant = writeInputs(path.join(tempRoot, "low-support"), lowA, lowB, lowAdj); const output = path.join(tempRoot, "low-support-output");
  fail(run(compileArgs(variant.a, variant.b, variant.c, output)), /pre_mask_contact_frames/); assert.equal(existsSync(output), false);
}
{
  const noA = buildReview("first", "1".repeat(64), { noReacquire: true }); const noB = buildReview("second", "2".repeat(64), { noReacquire: true, noDefaultDifferences: true });
  const noAdj = buildAdjudication(noA, noB); const variant = writeInputs(path.join(tempRoot, "no-reacquire"), noA, noB, noAdj); const output = path.join(tempRoot, "no-reacquire-output");
  fail(run(compileArgs(variant.a, variant.b, variant.c, output)), /reacquire_event_count/); assert.equal(existsSync(output), false);
}

fail(run(anchorArgs("create-anchor", anchorPath, output1, inputs.a, inputs.b, inputs.c)), /anchor_exists/);
assert.deepEqual(readFileSync(anchorPath), createdAnchorBytes);
{
  const inside = path.join(output1, "external-anchor.json");
  fail(run(anchorArgs("create-anchor", inside, output1, inputs.a, inputs.b, inputs.c)), /anchor_inside_label_dir/);
  assert.equal(existsSync(inside), false);
}
{
  const faultAnchor = path.join(tempRoot, "fault-anchor.json");
  fail(run(anchorArgs("create-anchor", faultAnchor, output1, inputs.a, inputs.b, inputs.c), { SAM_GOAL_MANUAL_PACK_FAULT_BEFORE_ANCHOR_LINK: "1" }), /injected_anchor_failure/);
  assert.equal(existsSync(faultAnchor), false);
  assert.equal(readdirSync(tempRoot).some((name) => name.includes("fault-anchor.json.tmp")), false);
}
for (const [signal, expectedStatus] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  const suffix = signal.toLowerCase(); const signalAnchor = path.join(tempRoot, `signal-${suffix}-anchor.json`);
  const ready = path.join(tempRoot, `signal-${suffix}-anchor-ready`); const release = path.join(tempRoot, `signal-${suffix}-anchor-release`);
  const labelsBefore = directoryHashes(output1);
  const running = startRun(anchorArgs("create-anchor", signalAnchor, output1, inputs.a, inputs.b, inputs.c), {
    SAM_GOAL_MANUAL_PACK_TEST_ANCHOR_READY_FILE: ready, SAM_GOAL_MANUAL_PACK_TEST_ANCHOR_RELEASE_FILE: release,
  });
  await waitForFile(ready, running, `anchor_${suffix}`);
  const temp = readFileSync(ready, "utf8").trim(); assert.equal(existsSync(temp), true);
  assert.equal(running.child.kill(signal), true);
  const completed = await running.completed;
  assert.equal(completed.status, expectedStatus, completed.stdout || completed.stderr); assert.equal(completed.signal, null);
  assert.equal(existsSync(temp), false); assert.equal(existsSync(signalAnchor), false); assert.deepEqual(directoryHashes(output1), labelsBefore);
}
{
  const tamperedAnchorPath = path.join(tempRoot, "tampered-anchor.json"); const value = structuredClone(createdAnchor);
  value.candidateP0LockSha256 = "f".repeat(64); value.expectedCanonicalHash = canonical(value, true); writeJson(tamperedAnchorPath, value);
  const bytes = readFileSync(tamperedAnchorPath);
  fail(run(anchorArgs("verify-anchor", tamperedAnchorPath, output1, inputs.a, inputs.b, inputs.c)), /anchor_binding_drift/);
  assert.deepEqual(readFileSync(tamperedAnchorPath), bytes);
}
{
  const labelDir = path.join(tempRoot, "mutated-label-dir"); cpSync(output1, labelDir, { recursive: true });
  writeFileSync(path.join(labelDir, "manual-labels.jsonl"), `${readFileSync(path.join(labelDir, "manual-labels.jsonl"), "utf8")} `);
  const copiedAnchor = path.join(tempRoot, "label-mutation-anchor.json"); writeFileSync(copiedAnchor, createdAnchorBytes); const bytes = readFileSync(copiedAnchor);
  fail(run(anchorArgs("verify-anchor", copiedAnchor, labelDir, inputs.a, inputs.b, inputs.c)), /compiled_artifact_mismatch/);
  assert.deepEqual(readFileSync(copiedAnchor), bytes);
}
{
  const reordered = structuredClone(first); reordered.clips.reverse(); reordered.expectedCanonicalHash = canonical(reordered, true);
  const rebound = buildAdjudication(reordered, second); const variant = writeInputs(path.join(tempRoot, "reordered-sealed-input"), reordered, second, rebound);
  const copiedAnchor = path.join(tempRoot, "raw-mutation-anchor.json"); writeFileSync(copiedAnchor, createdAnchorBytes);
  fail(run(anchorArgs("verify-anchor", copiedAnchor, output1, variant.a, variant.b, variant.c)), /anchor_binding_drift/);
}
{
  const badContract = structuredClone(contract); badContract.contactPolicy.preMaskMinimumObservableKnownFramesPerFootAndClass = 1; badContract.expectedCanonicalHash = canonical(badContract, true);
  const badPath = path.join(tempRoot, "bad-evaluation-contract.json"); writeJson(badPath, badContract);
  fail(run([...compileArgs(inputs.a, inputs.b, inputs.c, path.join(tempRoot, "bad-pin-output")), "--evaluation-contract", badPath]), /dependency_hash_drift:evaluationContract/);
}

const armsWindow = readJson(path.join(output1, "manual-windows.json")).windows.find((window) => window.clipId === "arms-crossed" && window.purposeTags.includes("full_clip_denominator"));
assert.equal(armsWindow.startPtsTicks, "512");
assert.equal(armsWindow.endPtsTicksExclusive, "197633");
for (const name of readdirSync(output1)) {
  const text = readFileSync(path.join(output1, name), "utf8");
  assert.doesNotMatch(text, /generatedAt|auditedAt|elapsedMs|reviewedAt|livePrediction|studentPrediction|avatarOutput/);
}

const draft = spawnSync("python3", ["-c", [
  "import json,sys", "from jsonschema import Draft202012Validator",
  "author=json.load(open(sys.argv[1],encoding='utf-8')); anchor_schema=json.load(open(sys.argv[2],encoding='utf-8')); labels=json.load(open(sys.argv[3],encoding='utf-8'))",
  "Draft202012Validator.check_schema(author); Draft202012Validator.check_schema(anchor_schema); Draft202012Validator.check_schema(labels)",
  "av=Draft202012Validator(author); av.validate(json.load(open(sys.argv[4]))); av.validate(json.load(open(sys.argv[5]))); av.validate(json.load(open(sys.argv[6])))",
  "Draft202012Validator(anchor_schema).validate(json.load(open(sys.argv[7])))",
  "lv=Draft202012Validator(labels); count=0",
  "for file in sys.argv[8:]:",
  "  for line in open(file,encoding='utf-8'):",
  "    if line.strip(): lv.validate(json.loads(line)); count += 1",
  "    if count >= 7000: break",
  "  if count >= 7000: break",
  "assert count == 7000, count", "print(count)",
].join("\n"), AUTHOR_SCHEMA, ANCHOR_SCHEMA, EVAL_SCHEMA_PATH, inputs.a, inputs.b, inputs.c, anchorPath,
path.join(output1, "manual-review-pass1.jsonl"), path.join(output1, "manual-review-pass2.jsonl")], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
assert.equal(draft.status, 0, draft.stderr || draft.stdout);
assert.equal(Number(draft.stdout.trim()), 7000);

for (const [file, expected] of PRESERVED) assert.equal(hash(readFileSync(path.join(ROOT, file))), expected, file);
const cleanupMarker = path.join(tempRoot, "cleanup-probe-marker.txt");
const cleanupProbe = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--cleanup-probe", cleanupMarker], { cwd: ROOT, encoding: "utf8" });
assert.notEqual(cleanupProbe.status, 0); assert.match(cleanupProbe.stderr, /intentional_manual_pack_cleanup_probe/);
assert.equal(existsSync(readFileSync(cleanupMarker, "utf8")), false); rmSync(cleanupMarker, { force: true });
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const completedRoot = tempRoot; cleanup(); assert.equal(existsSync(completedRoot), false);
const afterRoots = new Set(readdirSync(tempParent).filter((name) => /^sam-manual-pack-v2-[A-Za-z0-9]+$/.test(name)).map((name) => path.join(tempParent, name)));
assert.deepEqual([...afterRoots].filter((entry) => !beforeRoots.has(entry)), []);

console.log(JSON.stringify({
  status: "passed", checks: 52, exactRowsPerReview: 6711, draft202012Rows: 7000,
  deterministicCandidateP0LockSha256: compileOne.candidateP0LockSha256,
  deterministicCompiledArtifactSetSha256: compileOne.compiledArtifactSetSha256,
  anchorCanonicalSha256: createdAnchor.expectedCanonicalHash, cleanupProbePassed: true, tempResidueCount: 0, elapsedMs,
}, null, 2));
