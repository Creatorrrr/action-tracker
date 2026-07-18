#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_CONTRACT = path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/evaluation-contract.json");
const OMIT_CANONICAL_KEYS = new Set(["expectedCanonicalHash", "generatedAt", "auditedAt", "elapsedMs"]);
const SHA256_RE = /^[a-f0-9]{64}$/;
const TICKS_RE = /^(0|[1-9][0-9]*)$/;
const EXPECTED_CLIPS = new Map([
  ["arms-crossed", { role: "hard_test", sourceGroup: "arms-crossed-source", video: "output/test-videos/arms-crossed.mp4", teacher: "sam-3d-body-skeletons/arms-crossed" }],
  ["csi-pose", { role: "hard_test", sourceGroup: "csi-pose-source", video: "output/test-videos/csi-pose.mp4", teacher: "sam-3d-body-skeletons/csi-pose" }],
  ["dance-16x9-padded", { role: "validation", sourceGroup: "dance-16x9-padded-source", video: "output/test-videos/dance-16x9-padded.mp4", teacher: "sam-3d-body-skeletons/dance-16x9-padded" }],
  ["jujae-regression-0-16_5", { role: "hard_test", sourceGroup: "jujae-source", video: "output/test-videos/jujae-regression-0-16_5.mp4", teacher: "sam-3d-body-skeletons/jujae-regression-0-16_5" }],
  ["shorts-keGbIts0CA0-16x9-padded", { role: "train_candidate", sourceGroup: "shorts-keGbIts0CA0-source", video: "output/test-videos/shorts-keGbIts0CA0-16x9-padded.mp4", teacher: "sam-3d-body-skeletons/shorts-keGbIts0CA0-16x9-padded" }],
  ["shorts-new-dance-E9_h_ZW5z0U-16x9-padded", { role: "train_candidate", sourceGroup: "shorts-new-dance-E9_h_ZW5z0U-source", video: "output/test-videos/shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4", teacher: "sam-3d-body-skeletons/shorts-new-dance-E9_h_ZW5z0U-16x9-padded" }],
  ["shorts-vc0GDveRIp0-16x9-padded", { role: "train_candidate", sourceGroup: "shorts-vc0GDveRIp0-source", video: "output/test-videos/shorts-vc0GDveRIp0-16x9-padded.mp4", teacher: "sam-3d-body-skeletons/shorts-vc0GDveRIp0-16x9-padded" }],
]);
const REQUIRED_DIMENSIONS = [
  "scenarios",
  "presence",
  "occlusion",
  "contact",
  "handObservability",
  "endpointObservability",
  "personState",
];
const EXPECTED_TEACHER_INPUT_FAMILIES = [
  "decoderIdentity",
  "sourceSummary",
  "samRawCoordinates",
  "samNativeConfidence",
  "samDetectorBbox",
  "samDetectorConfidence",
  "samPersonCount",
  "samTrackIdentity",
  "manualPresence",
  "manualOcclusion",
  "manualSubjectSelection",
  "previousTeacherRowsCausal",
];
const EXPECTED_FORBIDDEN_INPUT_FAMILIES = [
  "livePrediction",
  "studentPrediction",
  "trackerOutput",
  "avatarOutput",
  "retargetOutput",
  "solverOutput",
  "liveError",
  "studentError",
  "residualToLive",
  "mpjpeToLive",
  "angleErrorToLive",
  "quaternionErrorToLive",
  "endpointErrorToLive",
  "agreementToLive",
  "latency",
  "renderFps",
  "dropRate",
  "queueDepth",
  "liveReportPath",
  "studentModelHash",
];
const EXPECTED_TEACHER_THRESHOLDS = {
  detectorConfidenceMin: 0.25,
  detectorIou: 0.7,
  landmarkVisibilityMin: 0.35,
  landmarkPresenceMin: 0.35,
  torsoFacingMinJointConfidence: 0.35,
  lowConfidenceChallengeFractionMin: 0.25,
  lowConfidenceChallengeMayExcludeTeacher: false,
  calibrationEndpointVisibilityMin: 0.5,
  calibrationBodyScale2DExclusiveMin: 0.0001,
  torsoBasisNormExclusiveMin: 0.000001,
  fullBodyShoulderElbowObservableMin: 3,
  fullBodyShoulderElbowTotal: 4,
  fullBodyHipObservableMin: 2,
  fullBodyHipTotal: 2,
  fullBodyKneeAnkleObservableMin: 3,
  fullBodyKneeAnkleTotal: 4,
  maximumSelectedSubjectsPerFrame: 1,
  boneLengthRelativeMedianDeviationMax: 0.35,
  frameScaleRatioMin: 0.75,
  frameScaleRatioMax: 1.3333333333333333,
  rootSpeedBodyHeightsPerSecondMax: 4,
  jointSpeedBodyHeightsPerSecondMax: 12,
  temporalGapNominalFrameFactorMax: 1.5,
};
const EXPECTED_REASON_CODES = [
  "decode_unavailable",
  "sam_record_missing",
  "detector_below_threshold",
  "ambiguous_subject",
  "manual_absent",
  "manual_occluded",
  "confidence_unavailable",
  "insufficient_observability",
  "invalid_torso_basis",
  "incomplete_full_body_scope",
  "calibration_unobservable",
  "bone_length_anomaly",
  "scale_jump",
  "root_speed_anomaly",
  "joint_speed_anomaly",
  "temporal_gap",
];
const FORBIDDEN_KEY_TOKENS = [
  "liveprediction",
  "studentprediction",
  "trackeroutput",
  "trackererror",
  "avataroutput",
  "retargetoutput",
  "solveroutput",
  "modeloutput",
  "liveoutput",
  "studentoutput",
  "liveconfidence",
  "studentconfidence",
  "liveerror",
  "studenterror",
  "residualtolive",
  "residual",
  "deltatolive",
  "mpjpe",
  "pampjpe",
  "nmpjpe",
  "angleerrortolive",
  "quaternionerrortolive",
  "endpointerrortolive",
  "agreementtolive",
  "comparison",
  "latency",
  "renderfps",
  "droprate",
  "stalerate",
  "queuedepth",
  "livereportpath",
  "reportpath",
  "studentmodelhash",
  "studentmodelversion",
];

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-label-audit.mjs --label-dir <path> [options]
  node scripts/sam-goal-label-audit.mjs --hash-json <path>

Options:
  --contract <path>   Default: tests/fixtures/sam-goal-v2/evaluation-contract.json
  --label-dir <path>  Directory containing bundle.json and its declared artifacts.
  --output <path>     Optional atomic JSON report output.
  --hash-json <path>  Print the canonical SHA-256 for one JSON file and exit.
  --help`);
}

function parseArgs(argv) {
  const options = {
    contract: DEFAULT_CONTRACT,
    labelDir: "",
    output: "",
    hashJson: "",
  };
  const valueOptions = new Map([
    ["--contract", "contract"],
    ["--label-dir", "labelDir"],
    ["--output", "output"],
    ["--hash-json", "hashJson"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    const key = valueOptions.get(arg);
    if (!key) throw new Error(`unknown_argument:${arg}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${arg}`);
    options[key] = value;
  }
  if (!options.hashJson && !options.labelDir) throw new Error("label_dir_required");
  return options;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !OMIT_CANONICAL_KEYS.has(key))
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function canonicalHash(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function readJson(filePath) {
  const source = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(source);
}

function readJsonl(filePath) {
  const source = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const rows = [];
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`invalid_jsonl:${path.basename(filePath)}:${index + 1}:${error.message}`);
    }
  });
  if (!rows.length) throw new Error(`empty_jsonl:${path.basename(filePath)}`);
  return rows;
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, filePath);
}

function normalizeKey(value) {
  return String(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function forbiddenKeyToken(key) {
  const normalized = normalizeKey(key);
  return FORBIDDEN_KEY_TOKENS.find((token) => normalized.includes(token)) || null;
}

function scanForbiddenKeys(value, addError, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, addError, [...pathParts, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const token = forbiddenKeyToken(key);
    if (token) addError("E_FORBIDDEN_FIELD", [...pathParts, key].join("."), token);
    scanForbiddenKeys(child, addError, [...pathParts, key]);
  }
}

function sameSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    left.length === leftSet.size
    && right.length === rightSet.size
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value))
  );
}

function parseTicks(value, addError, location) {
  if (typeof value !== "string" || !TICKS_RE.test(value)) {
    addError("E_PTS_MALFORMED", location, String(value));
    return null;
  }
  return BigInt(value);
}

function validSafeInteger(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function timeBaseKey(value, addError, location) {
  if (
    !value
    || !validSafeInteger(value.numerator, 1)
    || !validSafeInteger(value.denominator, 1)
    || Object.keys(value).some((key) => !["numerator", "denominator"].includes(key))
  ) {
    addError("E_TIMEBASE_MALFORMED", location, JSON.stringify(value));
    return "invalid";
  }
  return `${value.numerator}/${value.denominator}`;
}

function identityKey(row, addError, location) {
  const ticks = parseTicks(row?.ptsTicks, addError, `${location}.ptsTicks`);
  const timeBase = timeBaseKey(row?.timeBase, addError, `${location}.timeBase`);
  if (typeof row?.clipId !== "string" || !row.clipId) addError("E_CLIP_ID", `${location}.clipId`, "missing");
  if (!validSafeInteger(row?.sourceFrameIndex)) addError("E_FRAME_INDEX", `${location}.sourceFrameIndex`, String(row?.sourceFrameIndex));
  if (!validSafeInteger(row?.loopEpoch)) addError("E_LOOP_EPOCH", `${location}.loopEpoch`, String(row?.loopEpoch));
  if (ticks === null || timeBase === "invalid") return null;
  return `${row.clipId}\u0000${row.loopEpoch}\u0000${row.sourceFrameIndex}\u0000${row.ptsTicks}\u0000${timeBase}`;
}

function assertOnlyKeys(value, allowed, addError, location) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    addError("E_OBJECT_REQUIRED", location, typeof value);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addError("E_UNKNOWN_FIELD", `${location}.${key}`, "not allowed");
  }
  return true;
}

function validateContract(contract, addError) {
  assertOnlyKeys(
    contract,
    new Set([
      "$schema",
      "schemaVersion",
      "contractId",
      "interfaceVersion",
      "canonicalization",
      "labelSchema",
      "clipInventory",
      "unpairedInventory",
      "splitPolicy",
      "timeIdentity",
      "requiredDimensions",
      "manualCoverage",
      "contact",
      "presence",
      "reacquire",
      "endpoints",
      "confidenceUpdate",
      "teacherValidity",
      "denominatorIntegrity",
      "expectedCanonicalHash",
    ]),
    addError,
    "contract",
  );
  if (contract.schemaVersion !== 1 || contract.contractId !== "sam_goal.evaluation_contract@v1") {
    addError("E_CONTRACT_VERSION", "contract", `${contract.contractId}:${contract.schemaVersion}`);
  }
  const computedHash = canonicalHash(contract);
  if (contract.expectedCanonicalHash !== computedHash) {
    addError("E_CONTRACT_HASH_MISMATCH", "contract.expectedCanonicalHash", `${contract.expectedCanonicalHash}:${computedHash}`);
  }
  if (
    contract.canonicalization?.profile !== "sorted-json-utf8-v1"
    || contract.canonicalization?.hashAlgorithm !== "sha256"
    || contract.canonicalization?.orderSensitiveArrays !== true
    || !sameSet(contract.canonicalization?.excludedKeys || [], [...OMIT_CANONICAL_KEYS])
  ) {
    addError("E_CANONICALIZATION_POLICY", "contract.canonicalization", "profile changed");
  }
  const labelSchemaPath = contract.labelSchema?.path;
  let labelSchemaHash = null;
  if (labelSchemaPath !== "tests/fixtures/sam-goal-v2/label-schema.json") {
    addError("E_LABEL_SCHEMA_HASH_MISMATCH", "contract.labelSchema.path", String(labelSchemaPath));
  } else {
    const absoluteSchemaPath = path.resolve(REPO_ROOT, labelSchemaPath);
    if (!existsSync(absoluteSchemaPath)) {
      addError("E_LABEL_SCHEMA_HASH_MISMATCH", "contract.labelSchema.path", "missing");
    } else {
      labelSchemaHash = canonicalHash(readJson(absoluteSchemaPath));
      if (contract.labelSchema?.canonicalSha256 !== labelSchemaHash) {
        addError(
          "E_LABEL_SCHEMA_HASH_MISMATCH",
          "contract.labelSchema.canonicalSha256",
          `${contract.labelSchema?.canonicalSha256}:${labelSchemaHash}`,
        );
      }
    }
  }
  const inventory = Array.isArray(contract.clipInventory) ? contract.clipInventory : [];
  const seen = new Set();
  for (const clip of inventory) {
    if (seen.has(clip.clipId)) addError("E_CLIP_DUPLICATE", `contract.clipInventory.${clip.clipId}`, "duplicate");
    seen.add(clip.clipId);
    const expected = EXPECTED_CLIPS.get(clip.clipId);
    if (
      !expected
      || expected.role !== clip.role
      || expected.sourceGroup !== clip.sourceGroup
      || expected.video !== clip.video
      || expected.teacher !== clip.teacher
    ) {
      addError("E_SPLIT_ROLE", `contract.clipInventory.${clip.clipId}`, JSON.stringify(clip));
    }
  }
  if (inventory.length !== EXPECTED_CLIPS.size || seen.size !== EXPECTED_CLIPS.size) {
    addError("E_CLIP_INVENTORY", "contract.clipInventory", `${inventory.length}:${seen.size}`);
  }
  const unpaired = contract.unpairedInventory;
  if (
    !Array.isArray(unpaired)
    || unpaired.length !== 1
    || unpaired[0]?.clipId !== "jujae-full"
    || unpaired[0]?.role !== "unpaired_final"
    || unpaired[0]?.teacher !== null
    || unpaired[0]?.sourceGroup !== "jujae-source"
    || unpaired[0]?.video !== "output/test-videos/jujae.mp4"
    || !sameSet(unpaired[0]?.allowedUses || [], ["unpaired_runtime_only"])
  ) {
    addError("E_UNPAIRED_INVENTORY", "contract.unpairedInventory", "jujae-full contract mismatch");
  }
  const split = contract.splitPolicy || {};
  if (
    !sameSet(split.parameterSelectionRoles || [], ["train_candidate", "validation"])
    || !sameSet(split.protectedRoles || [], ["hard_test", "unpaired_final"])
    || split.hardTestMayTune !== false
    || split.unpairedMayTrainTuneOrScore !== false
    || !sameSet(split.isolationUnits || [], ["clipId", "sourceAssetSha256", "sourceGroup", "sessionId", "personId"])
    || !sameSet(split.allowedProtectedAliasSourceGroups || [], ["jujae-source"])
  ) {
    addError("E_SPLIT_POLICY", "contract.splitPolicy", "isolation or use policy changed");
  }
  const time = contract.timeIdentity || {};
  if (
    !sameSet(time.key || [], ["clipId", "sourceFrameIndex", "ptsTicks", "timeBaseNumerator", "timeBaseDenominator", "loopEpoch"])
    || time.ptsEncoding !== "base10-nonnegative-integer-string"
    || time.intervalConvention !== "start-inclusive-end-exclusive"
    || time.fpsRoundingAllowed !== false
    || time.duplicateIdentityAllowed !== false
  ) {
    addError("E_TIME_IDENTITY_POLICY", "contract.timeIdentity", "exact-PTS policy changed");
  }
  if (!sameSet(contract.requiredDimensions || [], REQUIRED_DIMENSIONS)) {
    addError("E_REQUIRED_DIMENSION_MISSING", "contract.requiredDimensions", JSON.stringify(contract.requiredDimensions));
  }
  const coverage = contract.manualCoverage || {};
  if (
    coverage.minimumCompleteCoverage !== 0.95
    || coverage.denominator !== "all decoded exact PTS in the union of required windows"
    || coverage.numerator !== "denominator PTS with one unambiguous label for every required dimension"
    || coverage.teacherInvalidMayReduceDenominator !== false
    || coverage.absentMayReduceDenominator !== false
    || coverage.unknownCountsAsComplete !== true
    || coverage.unknownCountsAsKnown !== false
    || coverage.knownCoverageReportedPerDimension !== true
    || coverage.decodeUnavailableExclusion?.allowed !== true
    || coverage.decodeUnavailableExclusion?.requiresMachineReason !== true
    || coverage.decodeUnavailableExclusion?.preservedInDecoderManifest !== true
  ) {
    addError("E_DENOMINATOR_POLICY", "contract.manualCoverage", "coverage or teacher-invalid policy changed");
  }
  const contact = contract.contact || {};
  if (
    contact.minimumTeacherValidObservableFramesPerFootAndKnownClass !== 100
    || !sameSet(contact.feet || [], ["left", "right"])
    || !sameSet(contact.classes || [], ["planted", "moving", "unknown"])
    || contact.unknownExcludedFromF1 !== true
    || contact.outOfFrameExcludedFromF1 !== true
    || contact.coverageReportedPerFoot !== true
    || contact.finalMetric !== "per-foot planted/moving F1 followed by left/right macro average"
  ) {
    addError("E_CONTACT_POLICY", "contract.contact", "minimum support changed");
  }
  if (
    !sameSet(contract.presence?.classes || [], ["present", "absent", "unknown"])
    || contract.presence?.finalMetric !== "present/absent F1 per clip followed by clip macro average"
    || contract.presence?.clipsWithoutAbsentLabelsExcludedFromMacro !== true
    || contract.presence?.excludedClipCoverageMustBeReported !== true
    || contract.reacquire?.minimumPriorAbsentOrUnreliableMs !== 200
    || contract.reacquire?.start !== "first teacher-valid present exact PTS after the qualifying interval"
    || contract.reacquire?.end !== "first of three consecutive processed frames with presence true and major-bone angular error at most 30 degrees"
    || contract.reacquire?.stableProcessedFrames !== 3
    || contract.reacquire?.majorBoneErrorMaxDeg !== 30
    || contract.reacquire?.finalMaximumMs !== 150
  ) {
    addError("E_METRIC_POLICY", "contract.presenceOrReacquire", "definition changed");
  }
  if (
    !sameSet(contract.endpoints?.names || [], ["leftWrist", "rightWrist", "leftAnkle", "rightAnkle", "head"])
    || contract.endpoints?.denominator !== "teacher-observable exact-paired live/avatar states per endpoint"
    || contract.endpoints?.minimumCoveragePerEndpoint !== 0.9
    || contract.endpoints?.finalP95AvatarHeightRatioMax !== 0.04
    || !sameSet(contract.confidenceUpdate?.canonicalJointConfidenceRange || [], [0, 1])
    || contract.confidenceUpdate?.boneConfidence !== "minimum source-joint confidence"
    || contract.confidenceUpdate?.lowConfidenceExclusiveMax !== 0.5
    || contract.confidenceUpdate?.fullStrengthEffectiveAlphaInclusiveMin !== 0.95
    || contract.confidenceUpdate?.lowConfidenceFullStrengthUpdateMaximumCount !== 0
  ) {
    addError("E_METRIC_POLICY", "contract.endpointsOrConfidence", "definition changed");
  }
  const denominator = contract.denominatorIntegrity || {};
  if (
    denominator.silentRowDeletionAllowed !== false
    || denominator.everyExcludedRowRequiresReason !== true
    || denominator.evaluationReportedDenominatorMustEqualFrozenDenominator !== true
    || denominator.manualWindowUnionDeduplicatesOverlaps !== true
    || denominator.teacherMaskCannotEditDecoderManifest !== true
    || denominator.liveOrStudentOutputCannotEditRulesWindowsLabelsOrMask !== true
  ) {
    addError("E_DENOMINATOR_POLICY", "contract.denominatorIntegrity", "integrity rule changed");
  }
  const teacher = contract.teacherValidity || {};
  assertOnlyKeys(
    teacher,
    new Set([
      "ruleId",
      "allowedInputFamilies",
      "forbiddenInputFamilies",
      "thresholds",
      "reasonCodes",
      "confidenceUnavailablePolicy",
      "actualMaskHashFrozenInPhase",
      "actualMaskHash",
    ]),
    addError,
    "contract.teacherValidity",
  );
  scanForbiddenKeys(teacher, addError, ["contract", "teacherValidity"]);
  const thresholds = teacher.thresholds || {};
  if (
    !sameSet(Object.keys(thresholds), Object.keys(EXPECTED_TEACHER_THRESHOLDS))
    || Object.entries(EXPECTED_TEACHER_THRESHOLDS).some(([key, value]) => thresholds[key] !== value)
  ) {
    addError("E_TEACHER_THRESHOLD", "contract.teacherValidity.thresholds", "threshold set changed");
  }
  if (!sameSet(teacher.allowedInputFamilies || [], EXPECTED_TEACHER_INPUT_FAMILIES)) {
    addError("E_TEACHER_INPUT_ALLOWLIST", "contract.teacherValidity.allowedInputFamilies", "allowlist changed");
  }
  if (!sameSet(teacher.forbiddenInputFamilies || [], EXPECTED_FORBIDDEN_INPUT_FAMILIES)) {
    addError("E_TEACHER_INPUT_DENYLIST", "contract.teacherValidity.forbiddenInputFamilies", "denylist changed");
  }
  if (!sameSet(teacher.reasonCodes || [], EXPECTED_REASON_CODES)) {
    addError("E_TEACHER_REASON_CODES", "contract.teacherValidity.reasonCodes", "reason-code set changed");
  }
  if (
    teacher.ruleId !== "sam_goal.teacher_valid@v1"
    || teacher.actualMaskHashFrozenInPhase !== "P1"
    || teacher.actualMaskHash !== null
    || teacher.confidenceUnavailablePolicy !== "record explicit false availability and invalidate confidence-dependent scopes"
  ) {
    addError("E_TEACHER_POLICY", "contract.teacherValidity", "rule phase or missing-confidence policy changed");
  }
  const allowedFamilies = new Set(teacher.allowedInputFamilies || []);
  for (const forbidden of teacher.forbiddenInputFamilies || []) {
    if (allowedFamilies.has(forbidden)) {
      addError("E_FORBIDDEN_FIELD", "contract.teacherValidity.allowedInputFamilies", forbidden);
    }
  }
  return { computedHash, labelSchemaHash, teacherRuleHash: canonicalHash(teacher) };
}

function resolveArtifact(labelDir, descriptor, addError, location) {
  if (!descriptor || typeof descriptor.file !== "string" || !SHA256_RE.test(descriptor.canonicalSha256 || "")) {
    addError("E_BUNDLE_ARTIFACT", location, "invalid descriptor");
    return null;
  }
  const absolute = path.resolve(labelDir, descriptor.file);
  const root = `${path.resolve(labelDir)}${path.sep}`;
  if (!absolute.startsWith(root)) {
    addError("E_ARTIFACT_PATH", location, descriptor.file);
    return null;
  }
  if (!existsSync(absolute)) {
    addError("E_ARTIFACT_MISSING", location, descriptor.file);
    return null;
  }
  return absolute;
}

function validateBundle(bundle, contract, contractHash, addError) {
  assertOnlyKeys(
    bundle,
    new Set(["artifactType", "schemaVersion", "contractHash", "clips", "artifacts", "generatedAt", "expectedCanonicalHash"]),
    addError,
    "bundle",
  );
  if (bundle.artifactType !== "label-bundle" || bundle.schemaVersion !== 1) {
    addError("E_BUNDLE_VERSION", "bundle", `${bundle.artifactType}:${bundle.schemaVersion}`);
  }
  if (bundle.contractHash !== contractHash) {
    addError("E_CONTRACT_HASH_MISMATCH", "bundle.contractHash", `${bundle.contractHash}:${contractHash}`);
  }
  const bundleHash = canonicalHash(bundle);
  if (bundle.expectedCanonicalHash !== bundleHash) {
    addError("E_LABEL_HASH_MISMATCH", "bundle.expectedCanonicalHash", `${bundle.expectedCanonicalHash}:${bundleHash}`);
  }
  const expectedArtifacts = ["decoderManifest", "manualWindows", "manualLabels", "teacherMask"];
  assertOnlyKeys(bundle.artifacts, new Set(expectedArtifacts), addError, "bundle.artifacts");
  for (const name of expectedArtifacts) {
    if (!Object.hasOwn(bundle.artifacts || {}, name)) {
      addError("E_BUNDLE_ARTIFACT", `bundle.artifacts.${name}`, "missing");
    }
  }

  const contractById = new Map(contract.clipInventory.map((clip) => [clip.clipId, clip]));
  const seen = new Set();
  const splitValues = new Map();
  const clipRows = Array.isArray(bundle.clips) ? bundle.clips : [];
  for (const [index, clip] of clipRows.entries()) {
    const location = `bundle.clips.${index}`;
    assertOnlyKeys(
      clip,
      new Set(["clipId", "role", "sourceGroup", "sourceAssetSha256", "sessionId", "personId", "declaredDecodedWindowDenominator"]),
      addError,
      location,
    );
    const expected = contractById.get(clip.clipId);
    if (!expected || expected.role !== clip.role || expected.sourceGroup !== clip.sourceGroup) {
      addError("E_SPLIT_ROLE", location, `${clip.clipId}:${clip.role}:${clip.sourceGroup}`);
    }
    if (seen.has(clip.clipId)) addError("E_CLIP_DUPLICATE", location, clip.clipId);
    seen.add(clip.clipId);
    if (!SHA256_RE.test(clip.sourceAssetSha256 || "")) addError("E_SOURCE_HASH", `${location}.sourceAssetSha256`, String(clip.sourceAssetSha256));
    if (!validSafeInteger(clip.declaredDecodedWindowDenominator, 1)) {
      addError("E_DENOMINATOR_SHRINK", `${location}.declaredDecodedWindowDenominator`, String(clip.declaredDecodedWindowDenominator));
    }
    for (const field of ["sourceAssetSha256", "sourceGroup", "sessionId", "personId"]) {
      const value = clip[field];
      if (typeof value !== "string" || !value) {
        addError("E_SPLIT_IDENTITY", `${location}.${field}`, String(value));
        continue;
      }
      const previous = splitValues.get(`${field}:${value}`);
      if (previous && previous.role !== clip.role) {
        addError("E_SPLIT_LEAKAGE", `${location}.${field}`, `${previous.clipId}:${clip.clipId}`);
      } else if (!previous) {
        splitValues.set(`${field}:${value}`, { clipId: clip.clipId, role: clip.role });
      }
    }
  }
  if (clipRows.length !== EXPECTED_CLIPS.size || seen.size !== EXPECTED_CLIPS.size) {
    addError("E_CLIP_INVENTORY", "bundle.clips", `${clipRows.length}:${seen.size}`);
  }
  return { bundleHash, clipRows };
}

function validateDecoderRows(rows, contractById, addError) {
  const byKey = new Map();
  const byClip = new Map();
  const previousByClipEpoch = new Map();
  const allowed = new Set([
    "artifactType", "clipId", "sourceFrameIndex", "ptsTicks", "timeBase", "loopEpoch", "decodeStatus", "decodeReason",
  ]);
  rows.forEach((row, index) => {
    const location = `decoder.${index + 1}`;
    assertOnlyKeys(row, allowed, addError, location);
    scanForbiddenKeys(row, addError, [location]);
    if (row.artifactType !== "decoder-pts") addError("E_ARTIFACT_TYPE", `${location}.artifactType`, String(row.artifactType));
    if (!contractById.has(row.clipId)) addError("E_CLIP_ID", `${location}.clipId`, String(row.clipId));
    const key = identityKey(row, addError, location);
    if (key) {
      if (byKey.has(key)) addError("E_PTS_DUPLICATE", location, key);
      byKey.set(key, row);
    }
    if (!new Set(["decoded", "unavailable"]).has(row.decodeStatus)) {
      addError("E_DECODE_STATUS", `${location}.decodeStatus`, String(row.decodeStatus));
    }
    if (row.decodeReason !== undefined && row.decodeReason !== null && typeof row.decodeReason !== "string") {
      addError("E_DECODE_REASON", `${location}.decodeReason`, typeof row.decodeReason);
    }
    if (row.decodeStatus === "unavailable" && !(typeof row.decodeReason === "string" && row.decodeReason.trim())) {
      addError("E_DECODE_REASON", `${location}.decodeReason`, "required");
    }
    const ticks = parseTicks(row.ptsTicks, addError, `${location}.ptsTicks.order`);
    const orderKey = `${row.clipId}:${row.loopEpoch}`;
    const previous = previousByClipEpoch.get(orderKey);
    if (previous && (
      row.sourceFrameIndex <= previous.sourceFrameIndex
      || (ticks !== null && previous.ticks !== null && ticks <= previous.ticks)
    )) {
      addError("E_PTS_NON_MONOTONIC", location, `${row.sourceFrameIndex}:${row.ptsTicks}`);
    }
    previousByClipEpoch.set(orderKey, { sourceFrameIndex: row.sourceFrameIndex, ticks });
    if (!byClip.has(row.clipId)) byClip.set(row.clipId, []);
    byClip.get(row.clipId).push(row);
  });
  for (const clipId of contractById.keys()) {
    if (!byClip.get(clipId)?.length) addError("E_DECODER_CLIP_MISSING", `decoder.${clipId}`, "no rows");
  }
  return { byKey, byClip };
}

function validateWindows(value, contract, decoderByClip, bundleByClip, addError) {
  assertOnlyKeys(value, new Set(["artifactType", "schemaVersion", "windows", "generatedAt"]), addError, "windows");
  if (value.artifactType !== "manual-windows" || value.schemaVersion !== 1 || !Array.isArray(value.windows)) {
    addError("E_WINDOWS_VERSION", "windows", "invalid container");
    return { windows: [], denominatorKeys: new Map(), denominatorByClip: new Map() };
  }
  const contractIds = new Set(contract.clipInventory.map((clip) => clip.clipId));
  const seenIds = new Set();
  const windows = [];
  const allowed = new Set([
    "windowId", "clipId", "loopEpoch", "startPtsTicks", "endPtsTicksExclusive", "timeBase", "requiredDimensions", "declaredDecodedDenominator",
  ]);
  for (const [index, window] of value.windows.entries()) {
    const location = `windows.${index}`;
    assertOnlyKeys(window, allowed, addError, location);
    scanForbiddenKeys(window, addError, [location]);
    if (typeof window.windowId !== "string" || !window.windowId.trim()) {
      addError("E_WINDOW_ID", `${location}.windowId`, String(window.windowId));
    }
    if (seenIds.has(window.windowId)) addError("E_WINDOW_DUPLICATE", `${location}.windowId`, String(window.windowId));
    seenIds.add(window.windowId);
    if (!contractIds.has(window.clipId)) addError("E_CLIP_ID", `${location}.clipId`, String(window.clipId));
    if (!validSafeInteger(window.loopEpoch)) addError("E_LOOP_EPOCH", `${location}.loopEpoch`, String(window.loopEpoch));
    const start = parseTicks(window.startPtsTicks, addError, `${location}.startPtsTicks`);
    const end = parseTicks(window.endPtsTicksExclusive, addError, `${location}.endPtsTicksExclusive`);
    const timeBase = timeBaseKey(window.timeBase, addError, `${location}.timeBase`);
    if (start !== null && end !== null && end <= start) addError("E_PTS_INTERVAL", location, `${start}:${end}`);
    if (!sameSet(window.requiredDimensions || [], contract.requiredDimensions || [])) {
      addError("E_REQUIRED_DIMENSION_MISSING", `${location}.requiredDimensions`, JSON.stringify(window.requiredDimensions));
    }
    if (!validSafeInteger(window.declaredDecodedDenominator, 1)) {
      addError("E_DENOMINATOR_SHRINK", `${location}.declaredDecodedDenominator`, String(window.declaredDecodedDenominator));
    }
    windows.push({ ...window, start, end, timeBaseKey: timeBase });
  }

  const denominatorKeys = new Map();
  const denominatorByClip = new Map();
  for (const window of windows) {
    let windowCount = 0;
    for (const row of decoderByClip.get(window.clipId) || []) {
      const ticks = TICKS_RE.test(String(row.ptsTicks)) ? BigInt(row.ptsTicks) : null;
      if (
        row.decodeStatus === "decoded"
        && ticks !== null
        && row.loopEpoch === window.loopEpoch
        && `${row.timeBase?.numerator}/${row.timeBase?.denominator}` === window.timeBaseKey
        && window.start !== null
        && window.end !== null
        && ticks >= window.start
        && ticks < window.end
      ) {
        const key = `${row.clipId}\u0000${row.loopEpoch}\u0000${row.sourceFrameIndex}\u0000${row.ptsTicks}\u0000${window.timeBaseKey}`;
        if (!denominatorKeys.has(key)) denominatorKeys.set(key, { row, windowIds: [] });
        denominatorKeys.get(key).windowIds.push(window.windowId);
        windowCount += 1;
      }
    }
    if (windowCount !== window.declaredDecodedDenominator) {
      addError("E_DENOMINATOR_SHRINK", `windows.${window.windowId}.declaredDecodedDenominator`, `${window.declaredDecodedDenominator}:${windowCount}`);
    }
  }
  for (const { row } of denominatorKeys.values()) {
    denominatorByClip.set(row.clipId, (denominatorByClip.get(row.clipId) || 0) + 1);
  }
  const bundleMap = new Map(bundleByClip.map((clip) => [clip.clipId, clip]));
  for (const clipId of contractIds) {
    const actual = denominatorByClip.get(clipId) || 0;
    const declared = bundleMap.get(clipId)?.declaredDecodedWindowDenominator;
    if (actual !== declared) addError("E_DENOMINATOR_SHRINK", `bundle.clips.${clipId}.declaredDecodedWindowDenominator`, `${declared}:${actual}`);
    if (actual === 0) addError("E_DENOMINATOR_EMPTY", `windows.${clipId}`, "no decoded PTS");
  }
  return { windows, denominatorKeys, denominatorByClip };
}

function validateLabelPayload(labels, addError, location) {
  if (!assertOnlyKeys(labels, new Set(REQUIRED_DIMENSIONS), addError, location)) return false;
  let complete = true;
  for (const dimension of REQUIRED_DIMENSIONS) {
    if (!Object.hasOwn(labels, dimension)) {
      addError("E_REQUIRED_DIMENSION_MISSING", `${location}.${dimension}`, "missing");
      complete = false;
    }
  }
  if (
    !Array.isArray(labels.scenarios)
    || labels.scenarios.length === 0
    || new Set(labels.scenarios).size !== labels.scenarios.length
    || labels.scenarios.some((value) => !/^[a-z][a-z0-9_-]*$/.test(value))
  ) {
    addError("E_LABEL_VALUE", `${location}.scenarios`, JSON.stringify(labels.scenarios));
    complete = false;
  }
  if (!new Set(["present", "absent", "unknown"]).has(labels.presence)) {
    addError("E_LABEL_VALUE", `${location}.presence`, String(labels.presence));
    complete = false;
  }
  const visibility = new Set(["observable", "partial", "occluded", "out_of_frame", "unknown"]);
  const observability = new Set(["observable", "not_observable", "unknown"]);
  const objectChecks = [
    ["occlusion", ["body", "leftHand", "rightHand", "leftFoot", "rightFoot"], visibility],
    ["contact", ["left", "right"], new Set(["planted", "moving", "unknown"])],
    ["handObservability", ["left", "right"], observability],
    ["endpointObservability", ["leftWrist", "rightWrist", "leftAnkle", "rightAnkle", "head"], observability],
  ];
  for (const [name, keys, values] of objectChecks) {
    if (!assertOnlyKeys(labels[name], new Set(keys), addError, `${location}.${name}`)) {
      complete = false;
      continue;
    }
    for (const key of keys) {
      if (!values.has(labels[name]?.[key])) {
        addError("E_LABEL_VALUE", `${location}.${name}.${key}`, String(labels[name]?.[key]));
        complete = false;
      }
    }
  }
  if (!new Set(["single_target", "multiple_people", "absent", "unknown"]).has(labels.personState)) {
    addError("E_LABEL_VALUE", `${location}.personState`, String(labels.personState));
    complete = false;
  }
  return complete;
}

function validateManualRows(rows, decoderByKey, addError) {
  const frames = new Map();
  const intervals = [];
  const decoderRows = [...decoderByKey.values()];
  const decoderClipIds = new Set(decoderRows.map((row) => row.clipId));
  const commonAllowed = new Set([
    "artifactType", "labelType", "clipId", "timeBase", "loopEpoch", "windowIds", "reviewStatus", "reviewerIdHash", "labels",
  ]);
  rows.forEach((row, index) => {
    const location = `labels.${index + 1}`;
    scanForbiddenKeys(row, addError, [location]);
    if (row.artifactType !== "manual-label") addError("E_ARTIFACT_TYPE", `${location}.artifactType`, String(row.artifactType));
    if (!decoderClipIds.has(row.clipId)) addError("E_CLIP_ID", `${location}.clipId`, String(row.clipId));
    if (!new Set(["reviewed", "adjudicated"]).has(row.reviewStatus)) addError("E_REVIEW_STATUS", `${location}.reviewStatus`, String(row.reviewStatus));
    if (row.reviewerIdHash !== undefined && !SHA256_RE.test(row.reviewerIdHash)) {
      addError("E_REVIEWER_HASH", `${location}.reviewerIdHash`, String(row.reviewerIdHash));
    }
    if (
      !Array.isArray(row.windowIds)
      || !row.windowIds.length
      || new Set(row.windowIds).size !== row.windowIds.length
      || row.windowIds.some((windowId) => typeof windowId !== "string" || !windowId.trim())
    ) {
      addError("E_WINDOW_MEMBERSHIP", `${location}.windowIds`, JSON.stringify(row.windowIds));
    }
    validateLabelPayload(row.labels, addError, `${location}.labels`);
    if (row.labelType === "frame") {
      assertOnlyKeys(row, new Set([...commonAllowed, "sourceFrameIndex", "ptsTicks"]), addError, location);
      const key = identityKey(row, addError, location);
      if (key) {
        if (frames.has(key)) addError("E_PTS_DUPLICATE", location, key);
        if (!decoderByKey.has(key)) addError("E_PTS_OUT_OF_RANGE", location, key);
        else if (decoderByKey.get(key).decodeStatus !== "decoded") addError("E_LABEL_ON_UNAVAILABLE", location, key);
        frames.set(key, row);
      }
    } else if (row.labelType === "interval") {
      assertOnlyKeys(row, new Set([...commonAllowed, "startPtsTicks", "endPtsTicksExclusive"]), addError, location);
      const start = parseTicks(row.startPtsTicks, addError, `${location}.startPtsTicks`);
      const end = parseTicks(row.endPtsTicksExclusive, addError, `${location}.endPtsTicksExclusive`);
      const timeBase = timeBaseKey(row.timeBase, addError, `${location}.timeBase`);
      if (start !== null && end !== null && end <= start) addError("E_PTS_INTERVAL", location, `${start}:${end}`);
      const matchesDecoder = start !== null && end !== null && decoderRows.some((decoder) => {
        if (
          decoder.clipId !== row.clipId
          || decoder.loopEpoch !== row.loopEpoch
          || `${decoder.timeBase?.numerator}/${decoder.timeBase?.denominator}` !== timeBase
          || !TICKS_RE.test(String(decoder.ptsTicks))
        ) return false;
        const ticks = BigInt(decoder.ptsTicks);
        return ticks >= start && ticks < end;
      });
      if (!matchesDecoder) addError("E_PTS_OUT_OF_RANGE", location, `${row.startPtsTicks}:${row.endPtsTicksExclusive}`);
      intervals.push({ row, start, end, timeBaseKey: timeBase, location });
    } else {
      addError("E_LABEL_TYPE", `${location}.labelType`, String(row.labelType));
    }
  });
  return { frames, intervals };
}

function validateMaskRows(rows, decoderByKey, teacherRuleHash, allowedReasonCodes, addError) {
  const masks = new Map();
  const allowed = new Set([
    "artifactType", "clipId", "sourceFrameIndex", "ptsTicks", "timeBase", "loopEpoch", "ruleHash", "teacherRecord",
    "selectedSubject", "confidenceAvailable", "scopes", "valid", "reasonCodes", "challengeTags",
  ]);
  rows.forEach((row, index) => {
    const location = `teacherMask.${index + 1}`;
    assertOnlyKeys(row, allowed, addError, location);
    scanForbiddenKeys(row, addError, [location]);
    if (row.artifactType !== "teacher-valid-mask") addError("E_ARTIFACT_TYPE", `${location}.artifactType`, String(row.artifactType));
    const key = identityKey(row, addError, location);
    if (key) {
      if (masks.has(key)) addError("E_PTS_DUPLICATE", location, key);
      if (!decoderByKey.has(key)) addError("E_PTS_OUT_OF_RANGE", location, key);
      masks.set(key, row);
    }
    if (row.ruleHash !== teacherRuleHash) addError("E_TEACHER_RULE_HASH_MISMATCH", `${location}.ruleHash`, `${row.ruleHash}:${teacherRuleHash}`);
    if (!new Set(["present", "missing", "decode_unavailable"]).has(row.teacherRecord)) {
      addError("E_TEACHER_MASK_VALUE", `${location}.teacherRecord`, String(row.teacherRecord));
    }
    if (!new Set(["selected", "absent", "ambiguous", "unknown"]).has(row.selectedSubject)) {
      addError("E_TEACHER_MASK_VALUE", `${location}.selectedSubject`, String(row.selectedSubject));
    }
    if (typeof row.valid !== "boolean" || typeof row.confidenceAvailable !== "boolean") {
      addError("E_TEACHER_MASK_VALUE", location, "boolean field missing");
    }
    if (
      !Array.isArray(row.reasonCodes)
      || new Set(row.reasonCodes).size !== row.reasonCodes.length
      || row.reasonCodes.some((code) => !allowedReasonCodes.has(code))
    ) {
      addError("E_TEACHER_MASK_REASON", `${location}.reasonCodes`, JSON.stringify(row.reasonCodes));
    }
    if (row.valid && row.reasonCodes?.length) addError("E_TEACHER_MASK_REASON", `${location}.reasonCodes`, "valid row has exclusion reasons");
    if (!row.valid && !row.reasonCodes?.length) addError("E_TEACHER_MASK_REASON", `${location}.reasonCodes`, "invalid row needs a reason");
    const decoder = key ? decoderByKey.get(key) : null;
    if (decoder?.decodeStatus === "unavailable" && (row.valid || !row.reasonCodes?.includes("decode_unavailable"))) {
      addError("E_DENOMINATOR_SHRINK", location, "decode-unavailable mask mismatch");
    }
    if (row.valid && (row.teacherRecord !== "present" || row.selectedSubject !== "selected")) {
      addError("E_TEACHER_MASK_VALUE", location, "valid row lacks selected teacher");
    }
    if (!row.scopes || ["torsoFacing", "fullBody", "calibration"].some((name) => typeof row.scopes[name] !== "boolean")) {
      addError("E_TEACHER_MASK_VALUE", `${location}.scopes`, JSON.stringify(row.scopes));
    } else {
      assertOnlyKeys(row.scopes, new Set(["torsoFacing", "fullBody", "calibration"]), addError, `${location}.scopes`);
    }
    if (
      !Array.isArray(row.challengeTags)
      || new Set(row.challengeTags).size !== row.challengeTags.length
      || row.challengeTags.some((tag) => !new Set(["low_confidence", "multi_person", "occlusion", "fast_motion"]).has(tag))
    ) {
      addError("E_TEACHER_MASK_VALUE", `${location}.challengeTags`, JSON.stringify(row.challengeTags));
    }
  });
  for (const key of decoderByKey.keys()) {
    if (!masks.has(key)) addError("E_TEACHER_MASK_ROW_MISSING", "teacherMask", key);
  }
  return masks;
}

function validateWindowReferences(manual, windows, addError) {
  const knownWindowIds = new Set(windows.map((window) => window.windowId));
  const rows = [
    ...[...manual.frames.values()].map((row) => ({ row, location: `labels.frame.${row.clipId}.${row.sourceFrameIndex}` })),
    ...manual.intervals.map(({ row, location }) => ({ row, location })),
  ];
  for (const { row, location } of rows) {
    for (const windowId of row.windowIds || []) {
      if (!knownWindowIds.has(windowId)) addError("E_WINDOW_MEMBERSHIP", `${location}.windowIds`, windowId);
    }
  }
}

function containsUnknown(value) {
  if (value === "unknown") return true;
  if (Array.isArray(value)) return value.some(containsUnknown);
  if (value && typeof value === "object") return Object.values(value).some(containsUnknown);
  return false;
}

function materializeCoverage({ denominatorKeys, manual, masks, contract, addError }) {
  let completeCount = 0;
  const knownByDimension = Object.fromEntries(contract.requiredDimensions.map((name) => [name, 0]));
  const contactSupport = {
    left: { planted: 0, moving: 0 },
    right: { planted: 0, moving: 0 },
  };
  const coverageByClip = new Map();
  for (const [key, entry] of denominatorKeys.entries()) {
    const row = entry.row;
    const timeBase = `${row.timeBase.numerator}/${row.timeBase.denominator}`;
    const ticks = BigInt(row.ptsTicks);
    const matchingIntervals = manual.intervals.filter((interval) => (
      interval.row.clipId === row.clipId
      && interval.row.loopEpoch === row.loopEpoch
      && interval.timeBaseKey === timeBase
      && interval.start !== null
      && interval.end !== null
      && ticks >= interval.start
      && ticks < interval.end
    ));
    if (matchingIntervals.length > 1) {
      addError("E_LABEL_INTERVAL_OVERLAP", `labels.${row.clipId}.${row.sourceFrameIndex}`, String(matchingIntervals.length));
    }
    const exactFrame = manual.frames.get(key);
    if (exactFrame && matchingIntervals.length > 0) {
      addError("E_LABEL_AMBIGUOUS", `labels.${row.clipId}.${row.sourceFrameIndex}`, "frame_and_interval");
    }
    const labelRow = exactFrame || matchingIntervals[0]?.row || null;
    let complete = false;
    if (labelRow) {
      complete = contract.requiredDimensions.every((dimension) => Object.hasOwn(labelRow.labels || {}, dimension));
      const requiredWindowIds = new Set(entry.windowIds);
      const providedWindowIds = new Set(labelRow.windowIds || []);
      if ([...requiredWindowIds].some((windowId) => !providedWindowIds.has(windowId))) {
        addError("E_WINDOW_MEMBERSHIP", `labels.${row.clipId}.${row.sourceFrameIndex}`, JSON.stringify(entry.windowIds));
      }
      for (const dimension of contract.requiredDimensions) {
        if (Object.hasOwn(labelRow.labels || {}, dimension) && !containsUnknown(labelRow.labels[dimension])) {
          knownByDimension[dimension] += 1;
        }
      }
    }
    if (complete) completeCount += 1;
    const clipCoverage = coverageByClip.get(row.clipId) || { denominator: 0, complete: 0 };
    clipCoverage.denominator += 1;
    if (complete) clipCoverage.complete += 1;
    coverageByClip.set(row.clipId, clipCoverage);

    const mask = masks.get(key);
    if (complete && mask?.valid && mask.scopes?.fullBody === true && labelRow.labels.presence === "present") {
      for (const foot of ["left", "right"]) {
        const state = labelRow.labels.contact[foot];
        const visible = labelRow.labels.occlusion[`${foot}Foot`] === "observable";
        if (visible && (state === "planted" || state === "moving")) contactSupport[foot][state] += 1;
      }
    }
  }
  const denominator = denominatorKeys.size;
  const completeCoverage = denominator > 0 ? completeCount / denominator : 0;
  if (completeCoverage < contract.manualCoverage.minimumCompleteCoverage) {
    addError("E_MANUAL_COVERAGE_BELOW_095", "coverage.complete", `${completeCount}:${denominator}:${completeCoverage}`);
  }
  for (const [clipId, value] of coverageByClip.entries()) {
    const ratio = value.denominator > 0 ? value.complete / value.denominator : 0;
    if (ratio < contract.manualCoverage.minimumCompleteCoverage) {
      addError("E_MANUAL_COVERAGE_BELOW_095", `coverage.byClip.${clipId}`, `${value.complete}:${value.denominator}:${ratio}`);
    }
  }
  const contactMinimum = contract.contact.minimumTeacherValidObservableFramesPerFootAndKnownClass;
  for (const foot of ["left", "right"]) {
    for (const state of ["planted", "moving"]) {
      if (contactSupport[foot][state] < contactMinimum) {
        addError("E_CONTACT_CLASS_BELOW_100", `contact.${foot}.${state}`, `${contactSupport[foot][state]}:${contactMinimum}`);
      }
    }
  }
  return {
    denominator,
    completeCount,
    completeCoverage,
    knownCoverageByDimension: Object.fromEntries(
      Object.entries(knownByDimension).map(([name, count]) => [name, {
        count,
        ratio: denominator > 0 ? count / denominator : 0,
      }]),
    ),
    byClip: Object.fromEntries(
      [...coverageByClip.entries()].map(([clipId, value]) => [clipId, {
        ...value,
        ratio: value.denominator > 0 ? value.complete / value.denominator : 0,
      }]),
    ),
    contactSupport,
  };
}

function main() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  if (options.hashJson) {
    console.log(canonicalHash(readJson(path.resolve(options.hashJson))));
    return;
  }

  const errors = [];
  const warnings = [];
  const addError = (code, location, detail) => errors.push({ code, location, detail });
  const contractPath = path.resolve(options.contract);
  const labelDir = path.resolve(options.labelDir);
  const contract = readJson(contractPath);
  const { computedHash: contractHash, labelSchemaHash, teacherRuleHash } = validateContract(contract, addError);
  const bundlePath = path.join(labelDir, "bundle.json");
  if (!existsSync(bundlePath)) throw new Error(`missing_bundle:${bundlePath}`);
  const bundle = readJson(bundlePath);
  scanForbiddenKeys(bundle, addError, ["bundle"]);
  const { bundleHash, clipRows } = validateBundle(bundle, contract, contractHash, addError);

  const descriptorMap = bundle.artifacts || {};
  const artifactFiles = {};
  for (const [name, descriptor] of Object.entries(descriptorMap)) {
    artifactFiles[name] = resolveArtifact(labelDir, descriptor, addError, `bundle.artifacts.${name}`);
  }
  const decoderRows = artifactFiles.decoderManifest ? readJsonl(artifactFiles.decoderManifest) : [];
  const windowsValue = artifactFiles.manualWindows ? readJson(artifactFiles.manualWindows) : { windows: [] };
  const manualRows = artifactFiles.manualLabels ? readJsonl(artifactFiles.manualLabels) : [];
  const maskRows = artifactFiles.teacherMask ? readJsonl(artifactFiles.teacherMask) : [];
  const parsedArtifacts = {
    decoderManifest: decoderRows,
    manualWindows: windowsValue,
    manualLabels: manualRows,
    teacherMask: maskRows,
  };
  for (const [name, value] of Object.entries(parsedArtifacts)) {
    const actual = canonicalHash(value);
    const expected = descriptorMap[name]?.canonicalSha256;
    if (actual !== expected) addError("E_LABEL_HASH_MISMATCH", `bundle.artifacts.${name}.canonicalSha256`, `${expected}:${actual}`);
  }

  const contractById = new Map(contract.clipInventory.map((clip) => [clip.clipId, clip]));
  const decoder = validateDecoderRows(decoderRows, contractById, addError);
  const windows = validateWindows(windowsValue, contract, decoder.byClip, clipRows, addError);
  const manual = validateManualRows(manualRows, decoder.byKey, addError);
  validateWindowReferences(manual, windows.windows, addError);
  const masks = validateMaskRows(
    maskRows,
    decoder.byKey,
    teacherRuleHash,
    new Set(contract.teacherValidity.reasonCodes),
    addError,
  );
  const coverage = materializeCoverage({
    denominatorKeys: windows.denominatorKeys,
    manual,
    masks,
    contract,
    addError,
  });

  errors.sort((left, right) => (
    left.code.localeCompare(right.code)
    || left.location.localeCompare(right.location)
    || String(left.detail).localeCompare(String(right.detail))
  ));
  const report = {
    schemaVersion: 1,
    contractId: contract.contractId,
    status: errors.length ? "failed" : "passed",
    auditedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    hashes: {
      contract: contractHash,
      labelSchema: labelSchemaHash,
      teacherRule: teacherRuleHash,
      bundle: bundleHash,
      artifacts: Object.fromEntries(
        Object.entries(parsedArtifacts).map(([name, value]) => [name, canonicalHash(value)]),
      ),
    },
    counts: {
      decoderRows: decoderRows.length,
      manualRows: manualRows.length,
      teacherMaskRows: maskRows.length,
      requiredWindows: windows.windows.length,
    },
    coverage,
    errors,
    warnings,
  };
  if (options.output) writeJsonAtomic(path.resolve(options.output), report);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`sam-goal-label-audit failed: ${error.message || error}`);
  process.exitCode = 1;
}
