import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(REPO_ROOT, "scripts/sam-goal-label-audit.mjs");
const CONTRACT_PATH = path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/evaluation-contract.json");
const LABEL_SCHEMA_PATH = path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/label-schema.json");
const OMIT_KEYS = new Set(["expectedCanonicalHash", "generatedAt", "auditedAt", "elapsedMs"]);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "sam goal label audit "));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !OMIT_KEYS.has(key))
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath, rows) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonl(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function artifactValue(dir, descriptor) {
  const filePath = path.join(dir, descriptor.file);
  return descriptor.file.endsWith(".jsonl") ? readJsonl(filePath) : readJson(filePath);
}

function refreshBundle(dir) {
  const bundlePath = path.join(dir, "bundle.json");
  const bundle = readJson(bundlePath);
  for (const descriptor of Object.values(bundle.artifacts)) {
    descriptor.canonicalSha256 = canonicalHash(artifactValue(dir, descriptor));
  }
  bundle.expectedCanonicalHash = canonicalHash(bundle);
  writeJson(bundlePath, bundle);
  return bundle;
}

function buildValidPack(dir) {
  const contract = readJson(CONTRACT_PATH);
  const teacherRuleHash = canonicalHash(contract.teacherValidity);
  const decoderRows = [];
  const manualRows = [];
  const maskRows = [];
  const windows = [];
  const bundleClips = [];
  const rowsPerClip = 1001;
  const decodedPerClip = 1000;

  contract.clipInventory.forEach((clip, clipIndex) => {
    const timeBase = { numerator: 1, denominator: clipIndex % 2 === 0 ? 60000 : 43080 };
    const step = clipIndex % 2 === 0 ? 1001 : 1801;
    const windowId = `${clip.clipId}-required-0`;
    windows.push({
      windowId,
      clipId: clip.clipId,
      loopEpoch: 0,
      startPtsTicks: "0",
      endPtsTicksExclusive: String(rowsPerClip * step),
      timeBase,
      requiredDimensions: [...contract.requiredDimensions],
      declaredDecodedDenominator: decodedPerClip,
    });
    bundleClips.push({
      clipId: clip.clipId,
      role: clip.role,
      sourceGroup: clip.sourceGroup,
      sourceAssetSha256: sha256Text(`source:${clip.clipId}`),
      sessionId: `session-${clip.role}-${clipIndex}`,
      personId: `person-${clip.role}-${clipIndex}`,
      declaredDecodedWindowDenominator: decodedPerClip,
    });

    for (let sourceFrameIndex = 0; sourceFrameIndex < rowsPerClip; sourceFrameIndex += 1) {
      const ptsTicks = String(sourceFrameIndex * step);
      const identity = {
        clipId: clip.clipId,
        sourceFrameIndex,
        ptsTicks,
        timeBase,
        loopEpoch: 0,
      };
      const unavailable = sourceFrameIndex === rowsPerClip - 1;
      decoderRows.push({
        artifactType: "decoder-pts",
        ...identity,
        decodeStatus: unavailable ? "unavailable" : "decoded",
        decodeReason: unavailable ? "synthetic_decode_unavailable" : null,
      });
      if (unavailable) {
        maskRows.push({
          artifactType: "teacher-valid-mask",
          ...identity,
          ruleHash: teacherRuleHash,
          teacherRecord: "decode_unavailable",
          selectedSubject: "unknown",
          confidenceAvailable: false,
          scopes: { torsoFacing: false, fullBody: false, calibration: false },
          valid: false,
          reasonCodes: ["decode_unavailable"],
          challengeTags: [],
        });
        continue;
      }
      const contact = sourceFrameIndex % 2 === 0 ? "planted" : "moving";
      manualRows.push({
        artifactType: "manual-label",
        labelType: "frame",
        ...identity,
        windowIds: [windowId],
        reviewStatus: sourceFrameIndex % 100 === 0 ? "adjudicated" : "reviewed",
        labels: {
          scenarios: [`scenario_${clipIndex}`],
          presence: "present",
          occlusion: {
            body: "observable",
            leftHand: "observable",
            rightHand: "observable",
            leftFoot: "observable",
            rightFoot: "observable",
          },
          contact: { left: contact, right: contact },
          handObservability: { left: "observable", right: "observable" },
          endpointObservability: {
            leftWrist: "observable",
            rightWrist: "observable",
            leftAnkle: "observable",
            rightAnkle: "observable",
            head: "observable",
          },
          personState: "single_target",
        },
      });
      maskRows.push({
        artifactType: "teacher-valid-mask",
        ...identity,
        ruleHash: teacherRuleHash,
        teacherRecord: "present",
        selectedSubject: "selected",
        confidenceAvailable: true,
        scopes: { torsoFacing: true, fullBody: true, calibration: true },
        valid: true,
        reasonCodes: [],
        challengeTags: sourceFrameIndex % 251 === 0 ? ["low_confidence"] : [],
      });
    }
  });

  writeJsonl(path.join(dir, "decoder-manifest.jsonl"), decoderRows);
  writeJson(path.join(dir, "manual-windows.json"), {
    artifactType: "manual-windows",
    schemaVersion: 1,
    generatedAt: "ignored-by-canonical-hash",
    windows,
  });
  writeJsonl(path.join(dir, "manual-labels.jsonl"), manualRows);
  writeJsonl(path.join(dir, "teacher-valid-mask.jsonl"), maskRows);
  const bundle = {
    artifactType: "label-bundle",
    schemaVersion: 1,
    contractHash: canonicalHash(contract),
    clips: bundleClips,
    artifacts: {
      decoderManifest: { file: "decoder-manifest.jsonl", canonicalSha256: "0".repeat(64) },
      manualWindows: { file: "manual-windows.json", canonicalSha256: "0".repeat(64) },
      manualLabels: { file: "manual-labels.jsonl", canonicalSha256: "0".repeat(64) },
      teacherMask: { file: "teacher-valid-mask.jsonl", canonicalSha256: "0".repeat(64) },
    },
    generatedAt: "ignored-by-canonical-hash",
    expectedCanonicalHash: "0".repeat(64),
  };
  writeJson(path.join(dir, "bundle.json"), bundle);
  refreshBundle(dir);
  return { decoderRows, manualRows, maskRows, windows };
}

function runAudit(dir, contractPath = CONTRACT_PATH) {
  const output = path.join(dir, "audit-report.json");
  const result = spawnSync(process.execPath, [
    AUDIT,
    "--contract", contractPath,
    "--label-dir", dir,
    "--output", output,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // Fatal parse/input failures intentionally may have stderr only.
  }
  return { result, report };
}

function expectFailure(dir, code, contractPath = CONTRACT_PATH) {
  const { result, report } = runAudit(dir, contractPath);
  assert.notEqual(result.status, 0, `expected ${code} failure`);
  assert.ok(report, result.stderr);
  assert.ok(report.errors.some((error) => error.code === code), JSON.stringify(report.errors.slice(0, 20), null, 2));
  return report;
}

function clonePack(name) {
  const target = path.join(tempRoot, name);
  cpSync(validDir, target, { recursive: true });
  return target;
}

function reverseKeysDeep(value) {
  if (Array.isArray(value)) return value.map(reverseKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeysDeep(value[key])]));
  }
  return value;
}

const contract = readJson(CONTRACT_PATH);
assert.equal(contract.clipInventory.length, 7);
assert.deepEqual(
  contract.clipInventory.filter(({ role }) => role === "hard_test").map(({ clipId }) => clipId),
  ["arms-crossed", "csi-pose", "jujae-regression-0-16_5"],
);
assert.equal(contract.unpairedInventory[0].clipId, "jujae-full");
assert.equal(contract.manualCoverage.minimumCompleteCoverage, 0.95);
assert.equal(contract.contact.minimumTeacherValidObservableFramesPerFootAndKnownClass, 100);
assert.equal(contract.confidenceUpdate.lowConfidenceExclusiveMax, 0.5);
assert.equal(contract.confidenceUpdate.fullStrengthEffectiveAlphaInclusiveMin, 0.95);
assert.equal(contract.expectedCanonicalHash, canonicalHash(contract));
const labelSchema = readJson(LABEL_SCHEMA_PATH);
assert.equal(labelSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(contract.labelSchema.canonicalSha256, canonicalHash(labelSchema));

const validDir = path.join(tempRoot, "valid pack");
buildValidPack(validDir);
const valid = runAudit(validDir);
assert.equal(valid.result.status, 0, valid.result.stderr || valid.result.stdout);
assert.equal(valid.report.status, "passed");
assert.equal(valid.report.counts.decoderRows, 7007);
assert.equal(valid.report.coverage.denominator, 7000);
assert.equal(valid.report.coverage.completeCoverage, 1);
assert.ok(valid.report.coverage.contactSupport.left.planted >= 100);
assert.ok(Number.isFinite(valid.report.elapsedMs));

const edgeDir = clonePack("valid edge semantics");
const edgeDecoder = readJsonl(path.join(edgeDir, "decoder-manifest.jsonl"));
const edgeLabels = readJsonl(path.join(edgeDir, "manual-labels.jsonl"));
const edgeMasks = readJsonl(path.join(edgeDir, "teacher-valid-mask.jsonl"));
const edgeWindows = readJson(path.join(edgeDir, "manual-windows.json"));
const firstClipId = contract.clipInventory[0].clipId;
const lastClipId = contract.clipInventory.at(-1).clipId;

const frameZero = edgeLabels.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 0);
const frameOne = edgeLabels.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 1);
frameZero.labels.contact = { left: "planted", right: "planted" };
const intervalLabel = {
  artifactType: "manual-label",
  labelType: "interval",
  clipId: firstClipId,
  startPtsTicks: frameZero.ptsTicks,
  endPtsTicksExclusive: String(Number(frameOne.ptsTicks) + 1001),
  timeBase: frameZero.timeBase,
  loopEpoch: 0,
  windowIds: [...frameZero.windowIds],
  reviewStatus: "adjudicated",
  labels: structuredClone(frameZero.labels),
};
for (const index of [edgeLabels.indexOf(frameZero), edgeLabels.indexOf(frameOne)].sort((a, b) => b - a)) {
  edgeLabels.splice(index, 1);
}
edgeLabels.push(intervalLabel);

const absentRow = edgeLabels.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 10);
absentRow.labels.presence = "absent";
absentRow.labels.personState = "absent";
absentRow.labels.contact = { left: "unknown", right: "unknown" };
absentRow.labels.occlusion = {
  body: "out_of_frame",
  leftHand: "out_of_frame",
  rightHand: "out_of_frame",
  leftFoot: "out_of_frame",
  rightFoot: "out_of_frame",
};
absentRow.labels.handObservability = { left: "not_observable", right: "not_observable" };
Object.keys(absentRow.labels.endpointObservability).forEach((key) => {
  absentRow.labels.endpointObservability[key] = "not_observable";
});
const absentMask = edgeMasks.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 10);
Object.assign(absentMask, {
  selectedSubject: "absent",
  scopes: { torsoFacing: false, fullBody: false, calibration: false },
  valid: false,
  reasonCodes: ["manual_absent"],
  challengeTags: ["occlusion"],
});

const multiRow = edgeLabels.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 11);
multiRow.labels.personState = "multiple_people";
multiRow.labels.contact = { left: "unknown", right: "unknown" };
multiRow.labels.occlusion.leftHand = "occluded";
multiRow.labels.occlusion.rightHand = "partial";
const multiMask = edgeMasks.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 11);
Object.assign(multiMask, {
  selectedSubject: "ambiguous",
  scopes: { torsoFacing: false, fullBody: false, calibration: false },
  valid: false,
  reasonCodes: ["ambiguous_subject"],
  challengeTags: ["multi_person"],
});

const unknownRow = edgeLabels.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 12);
unknownRow.labels.presence = "unknown";
unknownRow.labels.personState = "unknown";
unknownRow.labels.contact = { left: "unknown", right: "unknown" };
Object.keys(unknownRow.labels.occlusion).forEach((key) => { unknownRow.labels.occlusion[key] = "unknown"; });
Object.keys(unknownRow.labels.handObservability).forEach((key) => { unknownRow.labels.handObservability[key] = "unknown"; });
Object.keys(unknownRow.labels.endpointObservability).forEach((key) => { unknownRow.labels.endpointObservability[key] = "unknown"; });
const unknownMask = edgeMasks.find((row) => row.clipId === firstClipId && row.sourceFrameIndex === 12);
Object.assign(unknownMask, {
  selectedSubject: "unknown",
  scopes: { torsoFacing: false, fullBody: false, calibration: false },
  valid: false,
  reasonCodes: ["manual_occluded"],
  challengeTags: ["occlusion"],
});

edgeDecoder.filter((row) => row.clipId === lastClipId).forEach((row) => { row.loopEpoch = 1; });
edgeLabels.filter((row) => row.clipId === lastClipId).forEach((row) => { row.loopEpoch = 1; });
edgeMasks.filter((row) => row.clipId === lastClipId).forEach((row) => { row.loopEpoch = 1; });
edgeWindows.windows.filter((window) => window.clipId === lastClipId).forEach((window) => { window.loopEpoch = 1; });

writeJsonl(path.join(edgeDir, "decoder-manifest.jsonl"), edgeDecoder);
writeJsonl(path.join(edgeDir, "manual-labels.jsonl"), edgeLabels);
writeJsonl(path.join(edgeDir, "teacher-valid-mask.jsonl"), edgeMasks);
writeJson(path.join(edgeDir, "manual-windows.json"), edgeWindows);
refreshBundle(edgeDir);
const edge = runAudit(edgeDir);
assert.equal(edge.result.status, 0, edge.result.stderr || edge.result.stdout);
assert.equal(edge.report.status, "passed");
assert.ok(edge.report.coverage.knownCoverageByDimension.contact.ratio < 1);

const perClipCoverageDir = clonePack("per clip coverage");
const perClipRows = readJsonl(path.join(perClipCoverageDir, "manual-labels.jsonl"));
const firstClipIndexes = perClipRows
  .map((row, index) => row.clipId === firstClipId ? index : -1)
  .filter((index) => index >= 0)
  .slice(0, 60)
  .sort((a, b) => b - a);
firstClipIndexes.forEach((index) => perClipRows.splice(index, 1));
writeJsonl(path.join(perClipCoverageDir, "manual-labels.jsonl"), perClipRows);
refreshBundle(perClipCoverageDir);
const perClipFailure = expectFailure(perClipCoverageDir, "E_MANUAL_COVERAGE_BELOW_095");
assert.ok(perClipFailure.coverage.completeCoverage > 0.95);
assert.equal(perClipFailure.coverage.byClip[firstClipId].ratio, 0.94);

const ambiguousDir = clonePack("frame interval ambiguity");
const ambiguousRows = readJsonl(path.join(ambiguousDir, "manual-labels.jsonl"));
const ambiguousFrame = ambiguousRows[0];
ambiguousRows.push({
  artifactType: "manual-label",
  labelType: "interval",
  clipId: ambiguousFrame.clipId,
  startPtsTicks: ambiguousFrame.ptsTicks,
  endPtsTicksExclusive: String(Number(ambiguousFrame.ptsTicks) + 1001),
  timeBase: ambiguousFrame.timeBase,
  loopEpoch: ambiguousFrame.loopEpoch,
  windowIds: [...ambiguousFrame.windowIds],
  reviewStatus: "reviewed",
  labels: structuredClone(ambiguousFrame.labels),
});
writeJsonl(path.join(ambiguousDir, "manual-labels.jsonl"), ambiguousRows);
refreshBundle(ambiguousDir);
expectFailure(ambiguousDir, "E_LABEL_AMBIGUOUS");

const emptyWindowDir = clonePack("empty window id");
const emptyWindows = readJson(path.join(emptyWindowDir, "manual-windows.json"));
const emptiedClipId = emptyWindows.windows[0].clipId;
emptyWindows.windows[0].windowId = "";
const emptyWindowRows = readJsonl(path.join(emptyWindowDir, "manual-labels.jsonl"));
emptyWindowRows.filter((row) => row.clipId === emptiedClipId).forEach((row) => { row.windowIds = [""]; });
writeJson(path.join(emptyWindowDir, "manual-windows.json"), emptyWindows);
writeJsonl(path.join(emptyWindowDir, "manual-labels.jsonl"), emptyWindowRows);
refreshBundle(emptyWindowDir);
expectFailure(emptyWindowDir, "E_WINDOW_ID");

const decodeReasonDir = clonePack("invalid decoded reason");
const decodeReasonRows = readJsonl(path.join(decodeReasonDir, "decoder-manifest.jsonl"));
decodeReasonRows[0].decodeReason = 42;
writeJsonl(path.join(decodeReasonDir, "decoder-manifest.jsonl"), decodeReasonRows);
refreshBundle(decodeReasonDir);
expectFailure(decodeReasonDir, "E_DECODE_REASON");

const keyOrderPath = path.join(tempRoot, "contract-reversed.json");
writeJson(keyOrderPath, reverseKeysDeep(contract));
const originalHash = spawnSync(process.execPath, [AUDIT, "--hash-json", CONTRACT_PATH], { encoding: "utf8" });
const reorderedHash = spawnSync(process.execPath, [AUDIT, "--hash-json", keyOrderPath], { encoding: "utf8" });
assert.equal(originalHash.status, 0, originalHash.stderr);
assert.equal(reorderedHash.status, 0, reorderedHash.stderr);
assert.equal(originalHash.stdout.trim(), reorderedHash.stdout.trim());

const leakageDir = clonePack("split leakage");
const leakageBundle = readJson(path.join(leakageDir, "bundle.json"));
leakageBundle.clips.find(({ role }) => role === "train_candidate").personId = leakageBundle.clips.find(({ role }) => role === "hard_test").personId;
writeJson(path.join(leakageDir, "bundle.json"), leakageBundle);
refreshBundle(leakageDir);
expectFailure(leakageDir, "E_SPLIT_LEAKAGE");

const missingDimensionDir = clonePack("missing dimension");
const missingDimensionRows = readJsonl(path.join(missingDimensionDir, "manual-labels.jsonl"));
delete missingDimensionRows[0].labels.presence;
writeJsonl(path.join(missingDimensionDir, "manual-labels.jsonl"), missingDimensionRows);
refreshBundle(missingDimensionDir);
expectFailure(missingDimensionDir, "E_REQUIRED_DIMENSION_MISSING");

const coverageDir = clonePack("coverage shrink");
const coverageRows = readJsonl(path.join(coverageDir, "manual-labels.jsonl"));
coverageRows.splice(0, 500);
writeJsonl(path.join(coverageDir, "manual-labels.jsonl"), coverageRows);
refreshBundle(coverageDir);
expectFailure(coverageDir, "E_MANUAL_COVERAGE_BELOW_095");

const contactDir = clonePack("contact insufficient");
const contactRows = readJsonl(path.join(contactDir, "manual-labels.jsonl"));
contactRows.forEach((row) => { row.labels.contact.left = "unknown"; });
writeJsonl(path.join(contactDir, "manual-labels.jsonl"), contactRows);
refreshBundle(contactDir);
expectFailure(contactDir, "E_CONTACT_CLASS_BELOW_100");

const denominatorDir = clonePack("denominator shrink");
const denominatorWindows = readJson(path.join(denominatorDir, "manual-windows.json"));
denominatorWindows.windows[0].declaredDecodedDenominator -= 1;
writeJson(path.join(denominatorDir, "manual-windows.json"), denominatorWindows);
refreshBundle(denominatorDir);
expectFailure(denominatorDir, "E_DENOMINATOR_SHRINK");

const ptsDir = clonePack("malformed pts");
const decoderRows = readJsonl(path.join(ptsDir, "decoder-manifest.jsonl"));
decoderRows.at(-1).ptsTicks = "1.5";
writeJsonl(path.join(ptsDir, "decoder-manifest.jsonl"), decoderRows);
refreshBundle(ptsDir);
expectFailure(ptsDir, "E_PTS_MALFORMED");

const forbiddenDir = clonePack("forbidden live field");
const forbiddenRows = readJsonl(path.join(forbiddenDir, "manual-labels.jsonl"));
forbiddenRows.at(-1).liveError = 0;
writeJsonl(path.join(forbiddenDir, "manual-labels.jsonl"), forbiddenRows);
refreshBundle(forbiddenDir);
expectFailure(forbiddenDir, "E_FORBIDDEN_FIELD");

const hashDir = clonePack("hash mismatch");
const hashRows = readJsonl(path.join(hashDir, "manual-labels.jsonl"));
hashRows[0].labels.scenarios = ["mutated_without_hash_update"];
writeJsonl(path.join(hashDir, "manual-labels.jsonl"), hashRows);
expectFailure(hashDir, "E_LABEL_HASH_MISMATCH");

const contractMutationPath = path.join(tempRoot, "mutated-contract.json");
const mutatedContract = readJson(CONTRACT_PATH);
mutatedContract.teacherValidity.thresholds.landmarkVisibilityMin = 0.36;
mutatedContract.expectedCanonicalHash = canonicalHash(mutatedContract);
writeJson(contractMutationPath, mutatedContract);
expectFailure(validDir, "E_TEACHER_THRESHOLD", contractMutationPath);

const contractHashMismatchPath = path.join(tempRoot, "contract-hash-mismatch.json");
const hashMismatchContract = readJson(CONTRACT_PATH);
hashMismatchContract.expectedCanonicalHash = "0".repeat(64);
writeJson(contractHashMismatchPath, hashMismatchContract);
expectFailure(validDir, "E_CONTRACT_HASH_MISMATCH", contractHashMismatchPath);

const metricMutationPath = path.join(tempRoot, "metric-mutation.json");
const metricMutation = readJson(CONTRACT_PATH);
metricMutation.presence.finalMetric = "global micro-F1";
metricMutation.expectedCanonicalHash = canonicalHash(metricMutation);
writeJson(metricMutationPath, metricMutation);
expectFailure(validDir, "E_METRIC_POLICY", metricMutationPath);

const studentTeacherContractPath = path.join(tempRoot, "student-teacher-contract.json");
const studentTeacherContract = readJson(CONTRACT_PATH);
studentTeacherContract.teacherValidity.studentLossMax = 1;
studentTeacherContract.expectedCanonicalHash = canonicalHash(studentTeacherContract);
writeJson(studentTeacherContractPath, studentTeacherContract);
const studentTeacherDir = clonePack("self-consistent student teacher field");
const studentTeacherMasks = readJsonl(path.join(studentTeacherDir, "teacher-valid-mask.jsonl"));
const studentTeacherRuleHash = canonicalHash(studentTeacherContract.teacherValidity);
studentTeacherMasks.forEach((row) => { row.ruleHash = studentTeacherRuleHash; });
writeJsonl(path.join(studentTeacherDir, "teacher-valid-mask.jsonl"), studentTeacherMasks);
const studentTeacherBundle = readJson(path.join(studentTeacherDir, "bundle.json"));
studentTeacherBundle.contractHash = canonicalHash(studentTeacherContract);
writeJson(path.join(studentTeacherDir, "bundle.json"), studentTeacherBundle);
refreshBundle(studentTeacherDir);
expectFailure(studentTeacherDir, "E_UNKNOWN_FIELD", studentTeacherContractPath);

console.log(`SAM goal label audit check passed (${valid.report.counts.decoderRows} decoder rows, ${valid.report.elapsedMs}ms valid audit).`);
