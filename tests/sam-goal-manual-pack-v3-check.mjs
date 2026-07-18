#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  cpSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "scripts/sam-goal-manual-pack-v3.mjs");
const AUDITOR = path.join(ROOT, "scripts/sam-goal-label-audit-v3.mjs");
const PATHS = {
  authoring: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/authoring-schema.json"),
  contract: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/evaluation-contract.json"),
  labelSchema: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/label-schema.json"),
  teacherInventory: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-input-inventory.json"),
  teacherPolicy: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-policy.json"),
  teacherSchema: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/teacher-schema.json"),
  p0Schema: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/p0-lock-anchor-v2-schema.json"),
  p1Schema: path.join(ROOT, "tests/fixtures/sam-goal-v2/evaluation-v3/p1-lock-anchor-schema.json"),
  sourceContract: path.join(ROOT, "tests/fixtures/sam-goal-v2/source-contract.json"),
  sourceSchema: path.join(ROOT, "tests/fixtures/sam-goal-v2/source-schema.json"),
  sourceInventory: path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/source-inventory.json"),
  decoder: path.join(ROOT, "tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl"),
};
const HISTORICAL = [
  ["tests/fixtures/sam-goal-v2/evaluation-v2/authoring-schema.json", "1e2c74a4d382afaf4f69857e34e3389e636324a1f7be7b4135dfcaad814df7cc"],
  ["tests/fixtures/sam-goal-v2/evaluation-v2/p0-lock-anchor-schema.json", "5fb22bf90e604acff911799344b7993239a463b6a4af278404aae766f3e49d85"],
  ["scripts/sam-goal-manual-pack-v2.mjs", "6f0b54dd124368e30fb42c330e6d2b762f72e7d63b268e478bd3afb7a888f8dd"],
];
const EXPECTED_FILES = [
  "evaluation-pack.json",
  "manual-adjudication.jsonl",
  "manual-labels.jsonl",
  "manual-policy.json",
  "manual-review-pass1.jsonl",
  "manual-review-pass2.jsonl",
  "manual-subject-selection.jsonl",
  "manual-summary.json",
  "manual-windows.json",
];
const CLONEFILE_EXCEPTION = Object.freeze({
  id: "lex-64de448275",
  evidenceSha256: "ea746a6668d3bed8ba5e98899f4f90149063048c994f353170ef1ee3847813fa",
  inventoryByteSha256: "41497869f698ec76a0670145e12bf7f0573277d64ef34e56dfd0255957c81f2c",
  supersededId: "lex-4021f003cd",
  supersededExercised: false,
});
const AUTHORIZED_CLONE_PATHS = Object.freeze([
  "sam-3d-body-skeletons/arms-crossed/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/arms-crossed/metadata_mhr70.json",
  "sam-3d-body-skeletons/arms-crossed/summary.json",
  "sam-3d-body-skeletons/csi-pose/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/csi-pose/metadata_mhr70.json",
  "sam-3d-body-skeletons/csi-pose/summary.json",
  "sam-3d-body-skeletons/dance-16x9-padded/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/dance-16x9-padded/metadata_mhr70.json",
  "sam-3d-body-skeletons/dance-16x9-padded/summary.json",
  "sam-3d-body-skeletons/jujae-regression-0-16_5/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/jujae-regression-0-16_5/metadata_mhr70.json",
  "sam-3d-body-skeletons/jujae-regression-0-16_5/summary.json",
  "sam-3d-body-skeletons/shorts-keGbIts0CA0-16x9-padded/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/shorts-keGbIts0CA0-16x9-padded/metadata_mhr70.json",
  "sam-3d-body-skeletons/shorts-keGbIts0CA0-16x9-padded/summary.json",
  "sam-3d-body-skeletons/shorts-new-dance-E9_h_ZW5z0U-16x9-padded/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/shorts-new-dance-E9_h_ZW5z0U-16x9-padded/metadata_mhr70.json",
  "sam-3d-body-skeletons/shorts-new-dance-E9_h_ZW5z0U-16x9-padded/summary.json",
  "sam-3d-body-skeletons/shorts-vc0GDveRIp0-16x9-padded/skeletons_mhr70.jsonl",
  "sam-3d-body-skeletons/shorts-vc0GDveRIp0-16x9-padded/metadata_mhr70.json",
  "sam-3d-body-skeletons/shorts-vc0GDveRIp0-16x9-padded/summary.json",
]);
const CLONEFILE_HELPER_SOURCE = [
  "import ctypes, json, os, stat, sys",
  "",
  "def metadata(value):",
  "    return {\"dev\": str(value.st_dev), \"ino\": str(value.st_ino), \"nlink\": str(value.st_nlink), \"mode\": str(value.st_mode), \"size\": str(value.st_size)}",
  "",
  "if len(sys.argv) != 3:",
  "    raise SystemExit(64)",
  "source = sys.argv[1]",
  "destination = sys.argv[2]",
  "source_status = os.lstat(source)",
  "if stat.S_ISLNK(source_status.st_mode) or not stat.S_ISREG(source_status.st_mode):",
  "    raise SystemExit(65)",
  "try:",
  "    os.lstat(destination)",
  "except FileNotFoundError:",
  "    pass",
  "else:",
  "    raise SystemExit(66)",
  "clonefile = ctypes.CDLL(None,use_errno=True).clonefile",
  "clonefile.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]",
  "clonefile.restype = ctypes.c_int",
  "clonefile_rc = clonefile(os.fsencode(source), os.fsencode(destination), 0)",
  "clonefile_errno = ctypes.get_errno()",
  "if clonefile_rc != 0:",
  "    print(json.dumps({\"clonefileRc\": clonefile_rc, \"errno\": clonefile_errno}, sort_keys=True, separators=(\",\", \":\")))",
  "    raise SystemExit(67)",
  "destination_status = os.lstat(destination)",
  "if stat.S_ISLNK(destination_status.st_mode) or not stat.S_ISREG(destination_status.st_mode):",
  "    raise SystemExit(68)",
  "print(json.dumps({\"clonefileRc\": clonefile_rc, \"source\": metadata(source_status), \"destination\": metadata(destination_status)}, sort_keys=True, separators=(\",\", \":\")))",
  "",
].join("\n");
const CLONEFILE_HELPER_SHA256 = "d5c0b98069208450227fd1833bb7e93909ba075d93ff3a0bd7b35fd73ded85b3";
const EXECUTION_EVIDENCE = {
  successByMode: {},
  failureByMode: {},
  expectedFirstCodes: {},
  signalExitCodes: {},
  signalCases: [],
  mutationCases: [],
  races: { destination: 0, anchor: 0 },
  mutationRaces: 0,
  residueAssertions: 0,
  exactFailureAssertions: 0,
  unchangedFailureTargets: 0,
};
function incrementCounter(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function assertClonefileHelperSource() {
  assert.equal(sha256(Buffer.from(CLONEFILE_HELPER_SOURCE, "utf8")), CLONEFILE_HELPER_SHA256,
    "clonefile helper source hash drift");
  assert.equal(CLONEFILE_HELPER_SOURCE.split("ctypes.CDLL(None,use_errno=True).clonefile").length - 1, 1,
    "clonefile helper binding count drift");
  assert.equal((CLONEFILE_HELPER_SOURCE.match(/\bclonefile\(/gu) || []).length, 1,
    "clonefile helper call count drift");
  for (const forbidden of [
    /\/bin\/cp/u,
    /\bcopyfile\b/u,
    /\bshutil\b/u,
    /\bos\.(?:link|symlink)\b/u,
    /\b(?:open|read|write)\s*\(/u,
  ]) assert.doesNotMatch(CLONEFILE_HELPER_SOURCE, forbidden, "clonefile helper contains forbidden fallback API");
  assert.match(CLONEFILE_HELPER_SOURCE,
    /if clonefile_rc != 0:\n    print\([^\n]+\)\n    raise SystemExit\(67\)/u,
    "clonefile helper nonzero return is not terminal");
  assert.match(CLONEFILE_HELPER_SOURCE,
    /source_status = os\.lstat\(source\)\nif stat\.S_ISLNK\(source_status\.st_mode\) or not stat\.S_ISREG\(source_status\.st_mode\):\n    raise SystemExit\(65\)/u,
    "clonefile helper source guard drift");
  assert.match(CLONEFILE_HELPER_SOURCE,
    /try:\n    os\.lstat\(destination\)\nexcept FileNotFoundError:\n    pass\nelse:\n    raise SystemExit\(66\)/u,
    "clonefile helper absent-destination guard drift");
}
assertClonefileHelperSource();
function compareBytes(left, right) {
  return Buffer.from(String(left), "utf8").compare(Buffer.from(String(right), "utf8"));
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(compareBytes).map(function (key) {
      return [key, stableValue(value[key])];
    }));
  }
  return value;
}
function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}
function stableEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}
function canonicalHash(value, omitExpected) {
  let target = value;
  if (omitExpected) {
    target = { ...value };
    delete target.expectedCanonicalHash;
  }
  return sha256(Buffer.from(stableStringify(target), "utf8"));
}
function withSelfHash(value) {
  const result = { ...value, expectedCanonicalHash: "" };
  result.expectedCanonicalHash = canonicalHash(result, true);
  return result;
}
function pretty(value) {
  return Buffer.from(JSON.stringify(stableValue(value), null, 2) + "\n", "utf8");
}
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function pathState(filePath) {
  let status;
  try { status = lstatSync(filePath, { bigint: true }); } catch (error) {
    if (error.code === "ENOENT") return { kind: "absent" };
    throw error;
  }
  const identity = {
    dev: String(status.dev),
    ino: String(status.ino),
    mode: String(status.mode),
    nlink: String(status.nlink),
    size: String(status.size),
    mtimeNs: String(status.mtimeNs),
  };
  if (status.isSymbolicLink()) return { kind: "symlink", identity, target: readlinkSync(filePath) };
  if (status.isFile()) return { kind: "file", identity, sha256: sha256(readFileSync(filePath)) };
  if (status.isDirectory()) {
    const entries = readdirSync(filePath).sort(compareBytes);
    return {
      kind: "directory",
      identity,
      entries: entries.map(function (name) { return [name, pathState(path.join(filePath, name))]; }),
    };
  }
  return { kind: "other", identity };
}

function controlPair(tempRoot, token) {
  const configured = process.env.SAM_GOAL_MANUAL_PACK_V3_TEST_CONTROL_ROOT || "";
  if (!configured) {
    return {
      ready: path.join(tempRoot, token + ".ready"),
      release: path.join(tempRoot, token + ".release"),
    };
  }
  const controlRoot = path.resolve(configured);
  const rootStatus = lstatSync(controlRoot);
  assert.equal(rootStatus.isSymbolicLink(), false, "control root symlink");
  assert.equal(rootStatus.isDirectory(), true, "control root must be a directory");
  const relative = path.relative(tempRoot, controlRoot);
  assert.ok(relative === ".." || relative.startsWith(".." + path.sep), "control root must be outside candidate ancestor");
  const caseDirectory = path.join(controlRoot, token);
  mkdirSync(caseDirectory, { mode: 0o700 });
  return {
    ready: path.join(caseDirectory, "ready"),
    release: path.join(caseDirectory, "release"),
  };
}

function controlReadyPath(tempRoot, token) {
  const configured = process.env.SAM_GOAL_MANUAL_PACK_V3_TEST_CONTROL_ROOT || "";
  return configured
    ? path.join(path.resolve(configured), token, "ready")
    : path.join(tempRoot, token + ".ready");
}

function cliFailureTargets(args) {
  const targets = [];
  for (let index = 1; index < args.length; index += 2) {
    if (["--review", "--review-a", "--review-b", "--adjudication", "--output-dir", "--anchor", "--label-dir"].includes(args[index]) && args[index + 1]) {
      targets.push(path.resolve(args[index + 1]));
    }
  }
  return [...new Set(targets)];
}

function transactionalResidue(parentPaths) {
  const residue = [];
  for (const parentPath of new Set(parentPaths.map(function (entry) { return path.dirname(entry); }))) {
    try {
      for (const name of readdirSync(parentPath)) {
        if (name.includes(".tmp-") || name.includes(".anchor-stage-")) residue.push(path.join(parentPath, name));
      }
    } catch { /* an absent parent is captured by the exact target snapshot */ }
  }
  return sorted(residue);
}

function expectedFailure(code, detail = code) {
  return { code, detail };
}

function normalizedCompilerDigest(buffer) {
  const text = buffer.toString("utf8");
  const pattern = /const SELF_NORMALIZED_SHA256 = "([0-9a-f]{64})";/gu;
  const matches = [...text.matchAll(pattern)];
  assert.equal(matches.length, 1, "compiler normalized self marker count");
  return {
    embedded: matches[0][1],
    digest: sha256(Buffer.from(text.replace(pattern, 'const SELF_NORMALIZED_SHA256 = "' + "0".repeat(64) + '";'), "utf8")),
  };
}

function selfConsistentCompilerSource(sourceText) {
  const marker = /const SELF_NORMALIZED_SHA256 = "([0-9a-f]{64})";/gu;
  assert.equal([...sourceText.matchAll(marker)].length, 1, "compiler normalized self marker count before reseal");
  const zeroed = sourceText.replace(marker, 'const SELF_NORMALIZED_SHA256 = "' + "0".repeat(64) + '";');
  const digest = sha256(Buffer.from(zeroed, "utf8"));
  const source = zeroed.replace('const SELF_NORMALIZED_SHA256 = "' + "0".repeat(64) + '";',
    'const SELF_NORMALIZED_SHA256 = "' + digest + '";');
  assert.deepEqual(normalizedCompilerDigest(Buffer.from(source, "utf8")), { embedded: digest, digest });
  return { buffer: Buffer.from(source, "utf8"), digest };
}

function selfConsistentCompilerVariant(buffer, suffix) {
  return selfConsistentCompilerSource(buffer.toString("utf8") + "\n// " + suffix + "\n");
}

function oldDirectFillCompilerMutant(buffer) {
  const source = buffer.toString("utf8");
  const startMarker = "  const finalMemberships = windowMemberships(normalizedFinalWindows, context);\n";
  const endMarker = [
    "  const final = new Map();",
    "  for (const segment of finalSegments) {",
    "    for (let frame = segment.start; frame < segment.end; frame += 1) final.set(frameKey(segment.clipId, frame), segment.selected);",
    "  }",
    "",
  ].join("\n");
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, "old-direct-fill mutant split block start missing");
  assert.equal(source.indexOf(startMarker, start + startMarker.length), -1, "old-direct-fill mutant split block start ambiguous");
  const endStart = source.indexOf(endMarker, start);
  assert.notEqual(endStart, -1, "old-direct-fill mutant projection block end missing");
  assert.equal(source.indexOf(endMarker, endStart + endMarker.length), -1, "old-direct-fill mutant projection block end ambiguous");
  const replacement = [
    "  const finalMemberships = windowMemberships(normalizedFinalWindows, context);",
    "  const finalSegments = []; const final = new Map();",
    "  for (const segment of selectedSegments) {",
    "    const projected = stableValue(segment.selected);",
    "    const memberships = stableValue(finalMemberships.get(frameKey(segment.clipId, segment.start)));",
    "    finalSegments.push({",
    "      clipId: segment.clipId, start: segment.start, end: segment.end, originStart: segment.start, originEnd: segment.end,",
    "      memberships, selected: projected,",
    "    });",
    "    for (let frame = segment.start; frame < segment.end; frame += 1) final.set(frameKey(segment.clipId, frame), projected);",
    "  }",
    "",
  ].join("\n");
  const mutantSource = source.slice(0, start) + replacement + source.slice(endStart + endMarker.length);
  assert.equal(mutantSource.includes("finalWindowsByClip"), false, "old-direct-fill mutant retained final-window split index");
  assert.equal(mutantSource.includes("adjudication_final_membership_crossing"), false,
    "old-direct-fill mutant retained membership-crossing assertion");
  return selfConsistentCompilerSource(mutantSource);
}

function makeRepoMirror(tempRoot, name) {
  const mirror = path.join(tempRoot, "repo-mirror-" + name);
  const files = [...new Set([
    ...Object.values(PATHS),
    ...HISTORICAL.map(function (entry) { return path.join(ROOT, entry[0]); }),
    CLI,
    AUDITOR,
  ])];
  for (const source of files) {
    const relative = path.relative(ROOT, source);
    const destination = path.join(mirror, relative);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    cpSync(source, destination);
  }
  return { root: mirror, cli: path.join(mirror, path.relative(ROOT, CLI)) };
}

function metadataType(status) {
  if (status.isSymbolicLink()) return "symlink";
  if (status.isFile()) return "file";
  if (status.isDirectory()) return "directory";
  return "other";
}

function lstatMetadataOnly(filePath) {
  const status = lstatSync(filePath, { bigint: true });
  return {
    dev: String(status.dev),
    ino: String(status.ino),
    type: metadataType(status),
    mode: String(status.mode),
    nlink: String(status.nlink),
    size: String(status.size),
    mtimeNs: String(status.mtimeNs),
  };
}

function helperMetadata(metadata) {
  return Object.fromEntries(["dev", "ino", "nlink", "mode", "size"].map(function (key) {
    return [key, metadata[key]];
  }));
}

function authorizedCloneDescriptors() {
  assert.equal(sha256(readFileSync(PATHS.teacherInventory)), CLONEFILE_EXCEPTION.inventoryByteSha256,
    "clonefile authority inventory byte hash drift");
  const descriptors = teacherInventory.clips.flatMap(function (clip) {
    return [clip.files.skeletonsMhr70, clip.files.metadataMhr70, clip.files.summary];
  });
  assert.equal(descriptors.length, 21, "clonefile authority inventory count drift");
  assert.deepEqual(descriptors.map(function (descriptor) { return descriptor.path; }), AUTHORIZED_CLONE_PATHS,
    "clonefile authority inventory path/order drift");
  for (const descriptor of descriptors) {
    assert.ok(Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0,
      "clonefile authority inventory byte size invalid: " + descriptor.path);
    assert.match(descriptor.byteSha256, /^[0-9a-f]{64}$/u,
      "clonefile authority inventory hash invalid: " + descriptor.path);
  }
  return descriptors;
}

function authorizedSourceMetadataPaths() {
  const ancestors = new Set();
  const sources = AUTHORIZED_CLONE_PATHS.map(function (logicalPath) {
    const source = path.join(ROOT, logicalPath);
    let cursor = path.dirname(source);
    for (;;) {
      ancestors.add(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return source;
  });
  return [...sources, ...sorted(ancestors)];
}

function sourceMetadataSnapshot() {
  const snapshot = authorizedSourceMetadataPaths().map(function (filePath) {
    return [filePath, lstatMetadataOnly(filePath)];
  });
  for (const [index, [filePath, metadata]] of snapshot.entries()) {
    assert.equal(metadata.type, index < AUTHORIZED_CLONE_PATHS.length ? "file" : "directory",
      "authorized clone source/ancestor type drift: " + filePath);
  }
  return snapshot;
}

function runAuthorizedClonefile(source, destination) {
  let destinationStatus;
  try { destinationStatus = lstatSync(destination); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert.equal(destinationStatus, undefined, "clonefile destination already exists: " + destination);
  const result = spawnSync("/usr/bin/python3", ["-I", "-S", "-c", CLONEFILE_HELPER_SOURCE, source, destination], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0,
    "clonefile helper failed: " + source + " -> " + destination + "\nstdout=" + result.stdout + "\nstderr=" + result.stderr);
  assert.equal(result.stderr, "", "clonefile helper emitted stderr");
  let report;
  try { report = JSON.parse(result.stdout); } catch (error) {
    throw new Error("clonefile helper JSON invalid: " + error.message + ":" + result.stdout);
  }
  assert.deepEqual(Object.keys(report), ["clonefileRc", "destination", "source"], "clonefile helper report shape drift");
  assert.equal(report.clonefileRc, 0, "clonefile helper did not report clonefileRc=0");
  return report;
}

function cloneAuthorizedInputsIntoMirror(mirrorRoot, descriptors, cloneEvidence) {
  for (const descriptor of descriptors) {
    const source = path.join(ROOT, descriptor.path);
    const destination = path.join(mirrorRoot, descriptor.path);
    const sourceBefore = lstatMetadataOnly(source);
    assert.equal(sourceBefore.type, "file", "authorized clone source is not a plain regular file: " + source);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    const helperReport = runAuthorizedClonefile(source, destination);
    const sourceAfter = lstatMetadataOnly(source);
    assert.deepEqual(sourceAfter, sourceBefore, "authorized clone source metadata drift: " + source);
    assert.equal(sourceBefore.size, String(descriptor.bytes), "authorized clone source byte size drift: " + source);
    const destinationMetadata = lstatMetadataOnly(destination);
    assert.equal(destinationMetadata.type, "file", "clone destination is not a plain nonsymlink regular file: " + destination);
    assert.equal(destinationMetadata.nlink, "1", "clone destination link count drift: " + destination);
    assert.equal(destinationMetadata.dev, sourceBefore.dev, "clone destination device drift: " + destination);
    assert.notEqual(destinationMetadata.ino, sourceBefore.ino, "clone destination reused source inode: " + destination);
    assert.equal(destinationMetadata.size, String(descriptor.bytes), "clone destination byte size drift: " + destination);
    assert.deepEqual(helperReport.source, helperMetadata(sourceBefore), "clone helper source metadata drift: " + source);
    assert.deepEqual(helperReport.destination, helperMetadata(destinationMetadata),
      "clone helper destination metadata drift: " + destination);
    const destinationByteSha256 = sha256(readFileSync(destination));
    assert.equal(destinationByteSha256, descriptor.byteSha256, "clone destination byte hash drift: " + destination);
    cloneEvidence.push({
      logicalPath: descriptor.path,
      destination,
      clonefileRc: helperReport.clonefileRc,
      source: helperReport.source,
      destinationMetadata: helperReport.destination,
      byteSha256: destinationByteSha256,
      sameDeviceVerified: destinationMetadata.dev === sourceBefore.dev,
      distinctInodeVerified: destinationMetadata.ino !== sourceBefore.ino,
      nlinkOneVerified: destinationMetadata.nlink === "1",
      sizeVerified: destinationMetadata.size === String(descriptor.bytes) && sourceBefore.size === String(descriptor.bytes),
      hashVerified: destinationByteSha256 === descriptor.byteSha256,
    });
  }
}

function ownedRootIdentity(filePath) {
  const metadata = lstatMetadataOnly(filePath);
  assert.equal(metadata.type, "directory", "owned cleanup root is not a plain nonsymlink directory: " + filePath);
  return Object.fromEntries(["dev", "ino", "type", "mode"].map(function (key) { return [key, metadata[key]]; }));
}

function fsyncDirectory(directory) {
  const before = ownedRootIdentity(directory);
  const fd = openSync(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | (fsConstants.O_NOFOLLOW || 0));
  try {
    const held = fstatSync(fd, { bigint: true });
    const heldIdentity = {
      dev: String(held.dev), ino: String(held.ino), type: metadataType(held), mode: String(held.mode),
    };
    assert.deepEqual(heldIdentity, before, "fsync directory identity drift: " + directory);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  assert.deepEqual(ownedRootIdentity(directory), before, "fsync directory path replaced: " + directory);
}

function removeOwnedRoot(entry) {
  let actual;
  try { actual = ownedRootIdentity(entry.path); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assert.deepEqual(actual, entry.identity, "owned cleanup root identity drift: " + entry.path);
  rmSync(entry.path, { recursive: true, force: true });
  fsyncDirectory(path.dirname(entry.path));
  assert.equal(pathExists(entry.path), false, "owned cleanup root remains: " + entry.path);
}

function fsGuardPreloadSource(config) {
  return [
    "\"use strict\";",
    "const fs=require(\"node:fs\");",
    "const path=require(\"node:path\");",
    "const {syncBuiltinESMExports}=require(\"node:module\");",
    "const config=" + JSON.stringify(config) + ";",
    "const original=Object.fromEntries(Object.keys(fs).filter(k=>typeof fs[k]===\"function\").map(k=>[k,fs[k]]));",
    "const allowedFiles=new Set(config.allowedFiles.map(p=>path.resolve(p)));",
    "const forbiddenFiles=new Set(config.forbiddenFiles.map(p=>path.resolve(p)));",
    "const allowedAncestors=new Set();",
    "for(const file of allowedFiles){let cursor=path.dirname(file);for(;;){allowedAncestors.add(cursor);const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}}",
    "const opened={};",
    "const normalize=input=>typeof input===\"string\"?path.resolve(input):input&&input.href&&input.protocol===\"file:\"?path.resolve(require(\"node:url\").fileURLToPath(input)):null;",
    "const checkPath=(name,input)=>{const resolved=normalize(input);if(resolved===null)return;if(forbiddenFiles.has(resolved))throw new Error(\"guard_forbidden_read:\"+name+\":\"+resolved);if(!allowedFiles.has(resolved)&&!allowedAncestors.has(resolved))throw new Error(\"guard_outside_allowlist:\"+name+\":\"+resolved);};",
    "const writeFlags=flags=>typeof flags===\"number\"?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0:typeof flags===\"string\"?/[wa+]/u.test(flags):false;",
    "for(const name of [\"lstatSync\",\"statSync\",\"realpathSync\",\"readFileSync\",\"readdirSync\"]){fs[name]=function(input,...args){checkPath(name,input);return original[name].call(this,input,...args);};}",
    "fs.openSync=function(input,flags,...args){checkPath(\"openSync\",input);if(writeFlags(flags))throw new Error(\"guard_write_open:\"+String(input));const resolved=normalize(input);if(resolved)opened[resolved]=(opened[resolved]||0)+1;return original.openSync.call(this,input,flags,...args);};",
    "for(const name of [\"writeFileSync\",\"appendFileSync\",\"mkdirSync\",\"linkSync\",\"renameSync\",\"rmSync\",\"unlinkSync\",\"truncateSync\"]){if(typeof original[name]===\"function\")fs[name]=function(){throw new Error(\"guard_forbidden_write:\"+name);};}",
    "process.on(\"exit\",()=>{const fd=original.openSync(config.reportPath,\"a\",0o600);try{original.writeFileSync(fd,JSON.stringify({pid:process.pid,opened})+\"\\n\");}finally{original.closeSync(fd);}});",
    "syncBuiltinESMExports();",
    "",
  ].join("\n");
}

function statIdentityFaultPreloadSource(targetPath, triggerPath) {
  return [
    '"use strict";',
    'const fs=require("node:fs");',
    'const path=require("node:path");',
    'const {syncBuiltinESMExports}=require("node:module");',
    'const target=path.resolve(' + JSON.stringify(targetPath) + ');',
    'const trigger=path.resolve(' + JSON.stringify(triggerPath) + ');',
    'const originalExists=fs.existsSync;',
    'for(const name of ["lstatSync","statSync"]){const original=fs[name];fs[name]=function(input,...args){const status=original.call(this,input,...args);if(typeof input==="string"&&path.resolve(input)===target&&originalExists(trigger)){return new Proxy(status,{get(object,key){if(key==="ino")return typeof object.ino==="bigint"?object.ino+1n:object.ino+1;const value=Reflect.get(object,key,object);return typeof value==="function"?value.bind(object):value;}});}return status;};}',
    'syncBuiltinESMExports();',
    '',
  ].join("\n");
}

function readGuardReports(reportPath) {
  return readFileSync(reportPath, "utf8").trimEnd().split("\n").filter(Boolean).map(JSON.parse);
}

function assertGuardOpenedExactlyOnce(reportPath, expectedFiles) {
  const aggregate = {};
  for (const report of readGuardReports(reportPath)) {
    for (const [filePath, count] of Object.entries(report.opened)) aggregate[filePath] = (aggregate[filePath] || 0) + count;
  }
  for (const filePath of expectedFiles) assert.equal(aggregate[path.resolve(filePath)], 1, "immutable Buffer was not opened exactly once: " + filePath);
  return aggregate;
}
function sorted(values) {
  return [...values].sort(compareBytes);
}
function exactIdentity(row) {
  return {
    clipId: row.clipId,
    sourceFrameIndex: row.sourceFrameIndex,
    ptsTicks: row.ptsTicks,
    timeBase: row.timeBase,
    loopEpoch: row.loopEpoch,
  };
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function splitReviewIntervals(review, clipId, boundaries) {
  const clip = review.clips.find(function (entry) { return entry.clipId === clipId; });
  const points = new Set(boundaries);
  clip.intervals = clip.intervals.flatMap(function (interval) {
    const cuts = [interval.startFrameIndex, ...[...points].filter(function (point) {
      return point > interval.startFrameIndex && point < interval.endFrameIndexExclusive;
    }).sort(function (left, right) { return left - right; }), interval.endFrameIndexExclusive];
    return cuts.slice(0, -1).map(function (start, index) {
      return { ...deepClone(interval), startFrameIndex: start, endFrameIndexExclusive: cuts[index + 1] };
    });
  });
  return clip;
}

function isolatedPlantReview(sourceReview, clipId, start, endExclusive, side) {
  const review = deepClone(sourceReview);
  const clip = splitReviewIntervals(review, clipId, [start, endExclusive]);
  for (const interval of clip.intervals) {
    if (interval.state.presence === "present") interval.state.contact[side] = "moving";
    if (interval.startFrameIndex === start && interval.endFrameIndexExclusive === endExclusive) interval.state.contact[side] = "planted";
  }
  return withSelfHash(review);
}

function exactLeftHandSupportReview(sourceReview, secondClipFrames) {
  const review = deepClone(sourceReview);
  for (const clip of review.clips) {
    for (const interval of clip.intervals) interval.state.handObservability.left = "not_observable";
  }
  for (const [clipId, endExclusive] of [["dance-16x9-padded", 150], ["jujae-regression-0-16_5", secondClipFrames]]) {
    const clip = splitReviewIntervals(review, clipId, [0, endExclusive]);
    for (const interval of clip.intervals) {
      if (interval.startFrameIndex === 0 && interval.endFrameIndexExclusive === endExclusive) interval.state.handObservability.left = "observable";
    }
  }
  return withSelfHash(review);
}
function historicalPins() {
  return HISTORICAL.map(function (entry) {
    const actual = sha256(readFileSync(path.join(ROOT, entry[0])));
    assert.equal(actual, entry[1], "historical pin drift: " + entry[0]);
    return actual;
  });
}

const contract = readJson(PATHS.contract);
const labelSchema = readJson(PATHS.labelSchema);
const authoringSchema = readJson(PATHS.authoring);
const teacherInventory = readJson(PATHS.teacherInventory);
const teacherPolicy = readJson(PATHS.teacherPolicy);
const teacherSchema = readJson(PATHS.teacherSchema);
const p0Schema = readJson(PATHS.p0Schema);
const p1Schema = readJson(PATHS.p1Schema);
const sourceContract = readJson(PATHS.sourceContract);
const sourceSchema = readJson(PATHS.sourceSchema);
const sourceInventory = readJson(PATHS.sourceInventory);
const decoderRows = readFileSync(PATHS.decoder, "utf8").trimEnd().split("\n").map(JSON.parse);
const decoderByClip = new Map();
for (const row of decoderRows) {
  if (!decoderByClip.has(row.clipId)) decoderByClip.set(row.clipId, []);
  decoderByClip.get(row.clipId).push(row);
}
const clipIds = contract.sourceBinding.paired.map(function (entry) { return entry.clipId; });
const clipOrdinal = new Map(clipIds.map(function (clipId, index) { return [clipId, index]; }));

const hashes = {
  evaluationContractCanonicalSha256: canonicalHash(contract, true),
  labelSchemaCanonicalSha256: canonicalHash(labelSchema, false),
  authoringSchemaCanonicalSha256: canonicalHash(authoringSchema, false),
  teacherInputInventoryCanonicalSha256: canonicalHash(teacherInventory, true),
  teacherPolicyCanonicalSha256: canonicalHash(teacherPolicy, true),
  teacherSchemaCanonicalSha256: canonicalHash(teacherSchema, false),
  p0AnchorSchemaCanonicalSha256: canonicalHash(p0Schema, false),
  p1AnchorSchemaCanonicalSha256: canonicalHash(p1Schema, false),
  sourceContractCanonicalSha256: canonicalHash(sourceContract, true),
  sourceSchemaCanonicalSha256: canonicalHash(sourceSchema, false),
  sourceInventoryCanonicalSha256: canonicalHash(sourceInventory, true),
  decoderByteSha256: sha256(readFileSync(PATHS.decoder)),
  decoderCanonicalRowsSha256: canonicalHash(decoderRows, false),
};
const sourceBinding = {
  ...hashes,
  decoderRowCount: decoderRows.length,
  sources: sourceInventory.paired.map(function (entry) {
    return { clipId: entry.clipId, path: entry.video.path, bytes: entry.video.bytes, sha256: entry.video.sha256 };
  }),
};

function basePresentState(role, clipId, frameIndex, rowCount) {
  const selectedId = role === "second" && clipId === "arms-crossed"
    ? "synthetic-target-arms-b"
    : "synthetic-target-" + clipId;
  return {
    presence: "present",
    personState: "single_target",
    occlusion: {
      body: "observable",
      leftFoot: "observable",
      rightFoot: "observable",
      leftHand: "observable",
      rightHand: "observable",
    },
    contact: {
      left: frameIndex < Math.floor(rowCount / 2) ? "planted" : "moving",
      right: frameIndex < Math.floor(rowCount / 2) ? "planted" : "moving",
    },
    handObservability: { left: "observable", right: "observable" },
    endpointObservability: {
      leftWrist: "observable",
      rightWrist: "observable",
      leftAnkle: "observable",
      rightAnkle: "observable",
      head: "observable",
    },
    subjectSelection: { state: "selected", manualTargetId: selectedId, anchor: null },
  };
}
function absentState() {
  return {
    presence: "absent",
    personState: "absent",
    occlusion: {
      body: "out_of_frame",
      leftFoot: "out_of_frame",
      rightFoot: "out_of_frame",
      leftHand: "out_of_frame",
      rightHand: "out_of_frame",
    },
    contact: { left: "unknown", right: "unknown" },
    handObservability: { left: "not_observable", right: "not_observable" },
    endpointObservability: {
      leftWrist: "not_observable",
      rightWrist: "not_observable",
      leftAnkle: "not_observable",
      rightAnkle: "not_observable",
      head: "not_observable",
    },
    subjectSelection: { state: "absent", manualTargetId: null, anchor: null },
  };
}
function commonAbsence(clipId, frameIndex) {
  if (clipId === "arms-crossed" && frameIndex >= 0 && frameIndex < 8) return true;
  if (clipId === "csi-pose" && frameIndex >= 1000 && frameIndex < 1008) return true;
  if (clipId === "csi-pose" && frameIndex >= 2000 && frameIndex < 2008) return true;
  return false;
}
function authoredAt(role, clipId, frameIndex) {
  const rowCount = decoderByClip.get(clipId).length;
  if (commonAbsence(clipId, frameIndex)) {
    return { scenarios: ["entry_exit"], state: absentState() };
  }
  const state = basePresentState(role, clipId, frameIndex, rowCount);
  const scenarios = ["neutral"];
  if (clipId === "csi-pose" && frameIndex === 220) {
    state.personState = "multiple_people";
    state.subjectSelection.anchor = { x: 0.4, y: 0.5 };
  }
  if (clipId === "csi-pose" && frameIndex === 230) {
    state.subjectSelection.anchor = { x: 0.4, y: 0.5 };
  }
  if (role !== "second" || clipId !== "csi-pose") return { scenarios, state };
  if (frameIndex === 50) return { scenarios: ["fast_motion"], state };
  if (frameIndex === 60) {
    state.presence = "unknown";
    state.personState = "unknown";
    state.contact = { left: "unknown", right: "unknown" };
  } else if (frameIndex === 80) {
    state.occlusion.body = "partial";
  } else if (frameIndex === 90) {
    state.occlusion.leftFoot = "partial";
    state.contact.left = "unknown";
  } else if (frameIndex === 100) {
    state.occlusion.rightFoot = "partial";
    state.contact.right = "unknown";
  } else if (frameIndex === 110) {
    state.occlusion.leftHand = "partial";
  } else if (frameIndex === 120) {
    state.occlusion.rightHand = "partial";
  } else if (frameIndex === 130) {
    state.contact.left = state.contact.left === "planted" ? "moving" : "planted";
  } else if (frameIndex === 140) {
    state.contact.right = state.contact.right === "planted" ? "moving" : "planted";
  } else if (frameIndex === 150) {
    state.handObservability.left = "not_observable";
  } else if (frameIndex === 160) {
    state.handObservability.right = "not_observable";
  } else if (frameIndex === 170) {
    state.handObservability.left = "not_observable";
    state.endpointObservability.leftWrist = "not_observable";
  } else if (frameIndex === 180) {
    state.handObservability.right = "not_observable";
    state.endpointObservability.rightWrist = "not_observable";
  } else if (frameIndex === 190) {
    state.contact.left = "unknown";
    state.endpointObservability.leftAnkle = "not_observable";
  } else if (frameIndex === 200) {
    state.contact.right = "unknown";
    state.endpointObservability.rightAnkle = "not_observable";
  } else if (frameIndex === 210) {
    state.endpointObservability.head = "not_observable";
  } else if (frameIndex === 220) {
    state.subjectSelection = { state: "ambiguous", manualTargetId: null, anchor: null };
  } else if (frameIndex === 230) {
    state.subjectSelection.anchor = { x: 0.6, y: 0.7 };
  }
  return { scenarios, state };
}

function windowsFor(role) {
  const windows = clipIds.map(function (clipId) {
    return {
      windowId: "base-" + clipId,
      clipId,
      startFrameIndex: 0,
      endFrameIndexExclusive: decoderByClip.get(clipId).length,
      purposeTags: ["full_clip_denominator"],
      scenarioTags: ["neutral"],
    };
  });
  if (role === "first") {
    windows.push({
      windowId: "overlay-shared",
      clipId: "csi-pose",
      startFrameIndex: 300,
      endFrameIndexExclusive: 500,
      purposeTags: ["fast_motion"],
      scenarioTags: ["fast_motion"],
    });
    windows.push({
      windowId: "overlay-a",
      clipId: "csi-pose",
      startFrameIndex: 600,
      endFrameIndexExclusive: 700,
      purposeTags: ["self_occlusion"],
      scenarioTags: ["self_occlusion"],
    });
  } else {
    windows.push({
      windowId: "overlay-shared",
      clipId: "csi-pose",
      startFrameIndex: 301,
      endFrameIndexExclusive: 501,
      purposeTags: ["turning"],
      scenarioTags: ["turn"],
    });
    windows.push({
      windowId: "overlay-b",
      clipId: "csi-pose",
      startFrameIndex: 800,
      endFrameIndexExclusive: 900,
      purposeTags: ["hand_observability"],
      scenarioTags: ["hand_closeup"],
    });
    windows.reverse();
  }
  return windows;
}
function membershipAt(windows, clipId, frameIndex) {
  return sorted(windows.filter(function (window) {
    return window.clipId === clipId
      && frameIndex >= window.startFrameIndex
      && frameIndex < window.endFrameIndexExclusive;
  }).map(function (window) { return window.windowId; }));
}
function intervalsFor(role, clipId, windows) {
  const count = decoderByClip.get(clipId).length;
  const intervals = [];
  let start = 0;
  let previous = authoredAt(role, clipId, 0);
  let previousMembership = membershipAt(windows, clipId, 0);
  for (let frame = 1; frame <= count; frame += 1) {
    const current = frame < count ? authoredAt(role, clipId, frame) : null;
    const currentMembership = frame < count ? membershipAt(windows, clipId, frame) : null;
    if (frame === count || !stableEqual(previous, current) || !stableEqual(previousMembership, currentMembership)) {
      intervals.push({
        startFrameIndex: start,
        endFrameIndexExclusive: frame,
        scenarios: previous.scenarios,
        state: previous.state,
      });
      start = frame;
      previous = current;
      previousMembership = currentMembership;
    }
  }
  return intervals;
}

function kappaBoundaryReview(sourceReview, role, pseudonym, flippedPresentFrames) {
  const review = deepClone(sourceReview);
  review.role = role;
  review.reviewerPseudonymSha256 = pseudonym;
  const clipId = "csi-pose";
  const count = decoderByClip.get(clipId).length;
  const authored = function (frameIndex) {
    const base = basePresentState("first", clipId, frameIndex, count);
    const designedPresent = frameIndex < 278
      || (frameIndex >= 1000 && frameIndex < 1139)
      || (frameIndex >= 2000 && frameIndex < 2138);
    const present = designedPresent && frameIndex >= flippedPresentFrames;
    if (!present) {
      base.presence = "unknown";
      base.personState = "unknown";
      base.contact = { left: "unknown", right: "unknown" };
    }
    return { scenarios: ["neutral"], state: base };
  };
  const intervals = [];
  let start = 0;
  let previous = authored(0);
  let previousMembership = membershipAt(review.windows, clipId, 0);
  for (let frame = 1; frame <= count; frame += 1) {
    const current = frame < count ? authored(frame) : null;
    const currentMembership = frame < count ? membershipAt(review.windows, clipId, frame) : null;
    if (frame === count || !stableEqual(previous, current) || !stableEqual(previousMembership, currentMembership)) {
      intervals.push({
        startFrameIndex: start,
        endFrameIndexExclusive: frame,
        scenarios: previous.scenarios,
        state: previous.state,
      });
      start = frame;
      previous = current;
      previousMembership = currentMembership;
    }
  }
  review.clips.find(function (clip) { return clip.clipId === clipId; }).intervals = intervals;
  return withSelfHash(review);
}
function makeReview(role, pseudonym) {
  const windows = windowsFor(role);
  return withSelfHash({
    artifactType: "sam-goal-manual-review-v3",
    schemaVersion: 3,
    role,
    reviewerPseudonymSha256: pseudonym,
    origin: "manual_video",
    reviewed: true,
    sourceBinding,
    windows,
    clips: clipIds.map(function (clipId) {
      return { clipId, intervals: intervalsFor(role, clipId, windows) };
    }),
  });
}

const MANUAL_FIELDS = [
  ["scenarios", "scenario-array", function (value) { return value.scenarios; }],
  ["presence", "presence", function (value) { return value.state.presence; }],
  ["personState", "person-state", function (value) { return value.state.personState; }],
  ["occlusion/body", "occlusion-state", function (value) { return value.state.occlusion.body; }],
  ["occlusion/leftFoot", "occlusion-state", function (value) { return value.state.occlusion.leftFoot; }],
  ["occlusion/rightFoot", "occlusion-state", function (value) { return value.state.occlusion.rightFoot; }],
  ["occlusion/leftHand", "occlusion-state", function (value) { return value.state.occlusion.leftHand; }],
  ["occlusion/rightHand", "occlusion-state", function (value) { return value.state.occlusion.rightHand; }],
  ["contact/left", "contact-state", function (value) { return value.state.contact.left; }],
  ["contact/right", "contact-state", function (value) { return value.state.contact.right; }],
  ["handObservability/left", "hand-observability-state", function (value) { return value.state.handObservability.left; }],
  ["handObservability/right", "hand-observability-state", function (value) { return value.state.handObservability.right; }],
  ["endpointObservability/leftWrist", "endpoint-observability-state", function (value) { return value.state.endpointObservability.leftWrist; }],
  ["endpointObservability/rightWrist", "endpoint-observability-state", function (value) { return value.state.endpointObservability.rightWrist; }],
  ["endpointObservability/leftAnkle", "endpoint-observability-state", function (value) { return value.state.endpointObservability.leftAnkle; }],
  ["endpointObservability/rightAnkle", "endpoint-observability-state", function (value) { return value.state.endpointObservability.rightAnkle; }],
  ["endpointObservability/head", "endpoint-observability-state", function (value) { return value.state.endpointObservability.head; }],
  ["subjectSelection/state", "subject-state", function (value) { return value.state.subjectSelection.state; }],
  ["subjectSelection/manualTargetId", "manual-target-id", function (value) { return value.state.subjectSelection.manualTargetId; }],
  ["subjectSelection/anchor", "anchor", function (value) { return value.state.subjectSelection.anchor; }],
];
function intervalValue(review, clipId, frameIndex) {
  const clip = review.clips.find(function (entry) { return entry.clipId === clipId; });
  const interval = clip.intervals.find(function (entry) {
    return frameIndex >= entry.startFrameIndex && frameIndex < entry.endFrameIndexExclusive;
  });
  return { scenarios: interval.scenarios, state: interval.state };
}
function normalizedWindows(windows) {
  return [...windows].sort(function (left, right) {
    return clipOrdinal.get(left.clipId) - clipOrdinal.get(right.clipId)
      || left.startFrameIndex - right.startFrameIndex
      || left.endFrameIndexExclusive - right.endFrameIndexExclusive
      || compareBytes(left.windowId, right.windowId);
  });
}
function makeAdjudication(reviewA, bytesA, reviewB, bytesB, adjudicator) {
  const disagreements = [];
  for (const clipId of clipIds) {
    const count = decoderByClip.get(clipId).length;
    const boundaries = new Set([0, count]);
    for (const review of [reviewA, reviewB]) {
      const clip = review.clips.find(function (entry) { return entry.clipId === clipId; });
      for (const interval of clip.intervals) {
        boundaries.add(interval.startFrameIndex);
        boundaries.add(interval.endFrameIndexExclusive);
      }
    }
    const ordered = [...boundaries].sort(function (a, b) { return a - b; });
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index];
      const end = ordered[index + 1];
      const left = intervalValue(reviewA, clipId, start);
      const right = intervalValue(reviewB, clipId, start);
      for (const field of MANUAL_FIELDS) {
        const aValue = field[2](left);
        const bValue = field[2](right);
        if (!stableEqual(aValue, bValue)) {
          disagreements.push({
            path: "/clips/" + clipId + "/segments/" + start + "-" + end + "/" + field[0],
            valueType: field[1],
            reviewAValue: deepClone(aValue),
            reviewBValue: deepClone(bValue),
          });
        }
      }
    }
  }
  const windowsA = new Map(reviewA.windows.map(function (window) {
    return [window.clipId + "\0" + window.windowId, window];
  }));
  const windowsB = new Map(reviewB.windows.map(function (window) {
    return [window.clipId + "\0" + window.windowId, window];
  }));
  const windowKeys = sorted(new Set([...windowsA.keys(), ...windowsB.keys()]));
  for (const key of windowKeys) {
    const left = windowsA.get(key);
    const right = windowsB.get(key);
    const parts = key.split("\0");
    const base = "/clips/" + parts[0] + "/windowsById/" + parts[1];
    if (!left || !right) {
      disagreements.push({
        path: base,
        valueType: "window-or-null",
        reviewAValue: left ? deepClone(left) : null,
        reviewBValue: right ? deepClone(right) : null,
      });
      continue;
    }
    for (const child of [
      ["startFrameIndex", "source-frame-index"],
      ["endFrameIndexExclusive", "source-frame-index-exclusive"],
      ["purposeTags", "purpose-array"],
      ["scenarioTags", "scenario-array"],
    ]) {
      if (!stableEqual(left[child[0]], right[child[0]])) {
        disagreements.push({
          path: base + "/" + child[0],
          valueType: child[1],
          reviewAValue: deepClone(left[child[0]]),
          reviewBValue: deepClone(right[child[0]]),
        });
      }
    }
  }
  disagreements.sort(function (left, right) { return compareBytes(left.path, right.path); });
  const decisions = disagreements.map(function (entry) {
    let explicitValue = entry.reviewAValue;
    if (entry.path === "/clips/csi-pose/segments/50-51/scenarios") explicitValue = ["turn"];
    if (entry.path === "/clips/csi-pose/segments/130-131/contact/left") explicitValue = entry.reviewBValue;
    return { path: entry.path, valueType: entry.valueType, value: deepClone(explicitValue) };
  });
  return withSelfHash({
    artifactType: "sam-goal-manual-adjudication-v3",
    schemaVersion: 3,
    role: "adjudication",
    origin: "manual_video",
    adjudicated: true,
    adjudicatorPseudonymSha256: adjudicator,
    reviewACanonicalSha256: reviewA.expectedCanonicalHash,
    reviewAByteSha256: sha256(bytesA),
    reviewAPseudonymSha256: reviewA.reviewerPseudonymSha256,
    reviewBCanonicalSha256: reviewB.expectedCanonicalHash,
    reviewBByteSha256: sha256(bytesB),
    reviewBPseudonymSha256: reviewB.reviewerPseudonymSha256,
    windows: normalizedWindows(reviewA.windows),
    disagreements,
    decisions,
  });
}

function windowDecisionAdjudication(baseAdjudication, baseWindows, options) {
  const value = deepClone(baseAdjudication);
  const decisionByPath = new Map(value.decisions.map(function (decision) { return [decision.path, decision]; }));
  const finalWindows = deepClone(baseWindows);
  if (options.sharedStart !== undefined) {
    decisionByPath.get("/clips/csi-pose/windowsById/overlay-shared/startFrameIndex").value = options.sharedStart;
    finalWindows.find(function (window) { return window.clipId === "csi-pose" && window.windowId === "overlay-shared"; }).startFrameIndex = options.sharedStart;
  }
  if (options.sharedEnd !== undefined) {
    decisionByPath.get("/clips/csi-pose/windowsById/overlay-shared/endFrameIndexExclusive").value = options.sharedEnd;
    finalWindows.find(function (window) { return window.clipId === "csi-pose" && window.windowId === "overlay-shared"; }).endFrameIndexExclusive = options.sharedEnd;
  }
  if (options.overlayA) {
    decisionByPath.get("/clips/csi-pose/windowsById/overlay-a").value = deepClone(options.overlayA);
    const index = finalWindows.findIndex(function (window) { return window.clipId === "csi-pose" && window.windowId === "overlay-a"; });
    if (index === -1) finalWindows.push(deepClone(options.overlayA));
    else finalWindows[index] = deepClone(options.overlayA);
  }
  value.windows = normalizedWindows(finalWindows);
  return { adjudication: withSelfHash(value), finalWindows: normalizedWindows(finalWindows) };
}

function expectedManualWindowsArtifact(windows) {
  return withSelfHash({
    artifactType: "manual-windows-v2",
    schemaVersion: 2,
    windows: normalizedWindows(windows).map(function (window) {
      const rows = decoderByClip.get(window.clipId);
      const endTicks = window.endFrameIndexExclusive === rows.length
        ? String(BigInt(rows.at(-1).ptsTicks) + 1n)
        : rows[window.endFrameIndexExclusive].ptsTicks;
      return {
        windowId: window.windowId,
        clipId: window.clipId,
        startPtsTicks: rows[window.startFrameIndex].ptsTicks,
        endPtsTicksExclusive: endTicks,
        expectedDecoderRows: window.endFrameIndexExclusive - window.startFrameIndex,
        purposeTags: window.purposeTags,
        scenarioTags: window.scenarioTags,
      };
    }),
  });
}

function assertCandidateIdentityCoverage(candidate) {
  const rows = function (name) {
    return readFileSync(path.join(candidate, name), "utf8").trimEnd().split("\n").filter(Boolean).map(JSON.parse);
  };
  const labels = rows("manual-labels.jsonl");
  const subjects = rows("manual-subject-selection.jsonl");
  const first = rows("manual-review-pass1.jsonl");
  const second = rows("manual-review-pass2.jsonl");
  assert.deepEqual([labels.length, subjects.length, first.length, second.length], [6711, 6711, 6711, 6711]);
  for (let index = 0; index < decoderRows.length; index += 1) {
    const expected = exactIdentity(decoderRows[index]);
    assert.deepEqual(labels[index].span.identity, expected);
    assert.deepEqual(subjects[index].span.identity, expected);
    assert.deepEqual(first[index].identity, expected);
    assert.deepEqual(second[index].identity, expected);
  }
}

function assertFinalWindowMembership(candidate, windows, requiredBoundaries) {
  const expected = expectedManualWindowsArtifact(windows);
  assert.deepEqual(readFileSync(path.join(candidate, "manual-windows.json")), pretty(expected), "final window bytes drift");
  const csiWindows = windows.filter(function (window) { return window.clipId === "csi-pose"; });
  const count = decoderByClip.get("csi-pose").length;
  const memberships = Array.from({ length: count }, function (_, frameIndex) {
    return stableStringify(sorted(csiWindows.filter(function (window) {
      return frameIndex >= window.startFrameIndex && frameIndex < window.endFrameIndexExclusive;
    }).map(function (window) { return window.windowId; })));
  });
  const transitions = [];
  for (let index = 1; index < memberships.length; index += 1) if (memberships[index] !== memberships[index - 1]) transitions.push(index);
  for (const boundary of requiredBoundaries) assert.ok(transitions.includes(boundary), "missing final membership boundary " + boundary);
  const segments = [0, ...transitions, count];
  for (let index = 0; index < segments.length - 1; index += 1) {
    const values = new Set(memberships.slice(segments[index], segments[index + 1]));
    assert.equal(values.size, 1, "final membership changed inside segment " + segments[index] + "-" + segments[index + 1]);
  }
  assertCandidateIdentityCoverage(candidate);
}

const INDEPENDENT_MANUAL_LEAVES = Object.freeze([
  ["scenarios", ["scenarios"]],
  ["presence", ["state", "presence"]],
  ["personState", ["state", "personState"]],
  ["occlusion/body", ["state", "occlusion", "body"]],
  ["occlusion/leftFoot", ["state", "occlusion", "leftFoot"]],
  ["occlusion/rightFoot", ["state", "occlusion", "rightFoot"]],
  ["occlusion/leftHand", ["state", "occlusion", "leftHand"]],
  ["occlusion/rightHand", ["state", "occlusion", "rightHand"]],
  ["contact/left", ["state", "contact", "left"]],
  ["contact/right", ["state", "contact", "right"]],
  ["handObservability/left", ["state", "handObservability", "left"]],
  ["handObservability/right", ["state", "handObservability", "right"]],
  ["endpointObservability/leftWrist", ["state", "endpointObservability", "leftWrist"]],
  ["endpointObservability/rightWrist", ["state", "endpointObservability", "rightWrist"]],
  ["endpointObservability/leftAnkle", ["state", "endpointObservability", "leftAnkle"]],
  ["endpointObservability/rightAnkle", ["state", "endpointObservability", "rightAnkle"]],
  ["endpointObservability/head", ["state", "endpointObservability", "head"]],
  ["subjectSelection/state", ["state", "subjectSelection", "state"]],
  ["subjectSelection/manualTargetId", ["state", "subjectSelection", "manualTargetId"]],
  ["subjectSelection/anchor", ["state", "subjectSelection", "anchor"]],
]);

function independentPointerToken(value) {
  return String(value).replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function independentNestedValue(value, keys) {
  return keys.reduce(function (current, key) { return current[key]; }, value);
}

function independentSetNestedValue(value, keys, replacement) {
  let cursor = value;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)] = deepClone(replacement);
}

function independentFinalSegmentOracle(reviewA, reviewB, adjudication) {
  const decisionByPath = new Map();
  for (const decision of adjudication.decisions) {
    assert.equal(decisionByPath.has(decision.path), false, "independent oracle duplicate decision " + decision.path);
    decisionByPath.set(decision.path, decision);
  }
  const usedDecisionPaths = new Set();
  const selectedDecisionValue = function (decisionPath) {
    const decision = decisionByPath.get(decisionPath);
    assert.ok(decision, "independent oracle missing explicit decision " + decisionPath);
    usedDecisionPaths.add(decisionPath);
    return deepClone(decision.value);
  };

  const originSegments = [];
  for (const clipId of clipIds) {
    const reviewAClip = reviewA.clips.find(function (clip) { return clip.clipId === clipId; });
    const reviewBClip = reviewB.clips.find(function (clip) { return clip.clipId === clipId; });
    assert.ok(reviewAClip && reviewBClip, "independent oracle missing review clip " + clipId);
    const boundaries = new Set([0, decoderByClip.get(clipId).length]);
    for (const interval of [...reviewAClip.intervals, ...reviewBClip.intervals]) {
      boundaries.add(interval.startFrameIndex);
      boundaries.add(interval.endFrameIndexExclusive);
    }
    const ordered = [...boundaries].sort(function (left, right) { return left - right; });
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const originStart = ordered[index];
      const originEnd = ordered[index + 1];
      const left = intervalValue(reviewA, clipId, originStart);
      const right = intervalValue(reviewB, clipId, originStart);
      const selected = deepClone(left);
      const prefix = "/clips/" + independentPointerToken(clipId) + "/segments/"
        + originStart + "-" + originEnd + "/";
      for (const [suffix, keys] of INDEPENDENT_MANUAL_LEAVES) {
        const leftValue = independentNestedValue(left, keys);
        const rightValue = independentNestedValue(right, keys);
        if (!stableEqual(leftValue, rightValue)) {
          independentSetNestedValue(selected, keys, selectedDecisionValue(prefix + suffix));
        }
      }
      originSegments.push({
        clipId,
        originStart,
        originEnd,
        selected,
        selectedCanonicalSha256: canonicalHash(selected, false),
      });
    }
  }

  const windowKey = function (window) { return window.clipId + "\0" + window.windowId; };
  const windowsA = new Map(reviewA.windows.map(function (window) { return [windowKey(window), window]; }));
  const windowsB = new Map(reviewB.windows.map(function (window) { return [windowKey(window), window]; }));
  const finalWindows = [];
  for (const key of sorted(new Set([...windowsA.keys(), ...windowsB.keys()]))) {
    const left = windowsA.get(key) || null;
    const right = windowsB.get(key) || null;
    const identity = left || right;
    const prefix = "/clips/" + independentPointerToken(identity.clipId) + "/windowsById/"
      + independentPointerToken(identity.windowId);
    let selected;
    if (!left || !right) {
      selected = selectedDecisionValue(prefix);
    } else {
      selected = deepClone(left);
      for (const field of ["startFrameIndex", "endFrameIndexExclusive", "purposeTags", "scenarioTags"]) {
        if (!stableEqual(left[field], right[field])) selected[field] = selectedDecisionValue(prefix + "/" + field);
      }
    }
    if (selected !== null) {
      assert.equal(selected.clipId, identity.clipId, "independent oracle window clip identity drift");
      assert.equal(selected.windowId, identity.windowId, "independent oracle window id identity drift");
      finalWindows.push(selected);
    }
  }
  const normalizedFinalWindows = normalizedWindows(finalWindows);
  assert.deepEqual(normalizedWindows(adjudication.windows), normalizedFinalWindows,
    "independent oracle derived final windows disagree with authored adjudication windows");
  assert.deepEqual(sorted(usedDecisionPaths), sorted(decisionByPath.keys()),
    "independent oracle did not consume exactly the explicit manual decisions");

  const descriptors = [];
  for (const origin of originSegments) {
    const boundaries = new Set([origin.originStart, origin.originEnd]);
    for (const window of normalizedFinalWindows) {
      if (window.clipId !== origin.clipId) continue;
      if (window.startFrameIndex > origin.originStart && window.startFrameIndex < origin.originEnd) {
        boundaries.add(window.startFrameIndex);
      }
      if (window.endFrameIndexExclusive > origin.originStart && window.endFrameIndexExclusive < origin.originEnd) {
        boundaries.add(window.endFrameIndexExclusive);
      }
    }
    const ordered = [...boundaries].sort(function (left, right) { return left - right; });
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const start = ordered[index];
      const end = ordered[index + 1];
      const membershipValues = [];
      for (let frame = start; frame < end; frame += 1) {
        membershipValues.push(sorted(normalizedFinalWindows.filter(function (window) {
          return window.clipId === origin.clipId
            && frame >= window.startFrameIndex
            && frame < window.endFrameIndexExclusive;
        }).map(function (window) { return window.windowId; })));
      }
      const membershipSet = new Set(membershipValues.map(stableStringify));
      assert.equal(membershipSet.size, 1,
        "independent oracle child crosses final membership boundary " + origin.clipId + ":" + start + "-" + end);
      descriptors.push({
        clipId: origin.clipId,
        start,
        end,
        originStart: origin.originStart,
        originEnd: origin.originEnd,
        memberships: deepClone(membershipValues[0]),
        selectedCanonicalSha256: origin.selectedCanonicalSha256,
      });
    }
  }
  const childCount = descriptors.length;
  const coveredRows = descriptors.reduce(function (sum, descriptor) { return sum + descriptor.end - descriptor.start; }, 0);
  assert.equal(coveredRows, 6711, "independent oracle coverage drift");
  assert.equal(coveredRows, decoderRows.length, "independent oracle decoder coverage drift");
  return {
    descriptors,
    childCount,
    coveredRows,
    descriptorCanonicalSha256: canonicalHash(descriptors, false),
    originSegments,
    finalWindows: normalizedFinalWindows,
  };
}

function expectedFinalSegmentTrace(oracle) {
  return {
    descriptors: oracle.descriptors,
    childCount: oracle.childCount,
    coveredRows: oracle.coveredRows,
    descriptorCanonicalSha256: oracle.descriptorCanonicalSha256,
  };
}

function assertIndependentFinalSegmentTrace(report, oracle, label) {
  assert.deepEqual(report.finalSegmentTrace, expectedFinalSegmentTrace(oracle), label + " independent final-segment trace mismatch");
}

function assertIndependentOracleBoundaries(oracle, boundaries, label) {
  for (const [clipId, boundary] of boundaries) {
    const origin = oracle.originSegments.find(function (segment) {
      return segment.clipId === clipId && boundary > segment.originStart && boundary < segment.originEnd;
    });
    assert.ok(origin, label + " boundary is not strict-interior to an A/B-union origin: " + clipId + ":" + boundary);
    const siblings = oracle.descriptors.filter(function (descriptor) {
      return descriptor.clipId === clipId
        && descriptor.originStart === origin.originStart
        && descriptor.originEnd === origin.originEnd;
    });
    assert.ok(siblings.some(function (descriptor) { return descriptor.end === boundary; }),
      label + " missing left child at boundary " + clipId + ":" + boundary);
    assert.ok(siblings.some(function (descriptor) { return descriptor.start === boundary; }),
      label + " missing right child at boundary " + clipId + ":" + boundary);
    assert.deepEqual(new Set(siblings.map(function (descriptor) { return descriptor.selectedCanonicalSha256; })),
      new Set([origin.selectedCanonicalSha256]), label + " sibling projection hash drift");
  }
}

const FINAL_SEGMENT_TRACE_ENV = "SAM_GOAL_MANUAL_PACK_V3_TEST_FINAL_SEGMENT_TRACE";

function finalSegmentTraceEnvironment(options = {}) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST;
  delete env[FINAL_SEGMENT_TRACE_ENV];
  if (options.nodeEnv !== undefined) env.NODE_ENV = options.nodeEnv;
  if (options.runtimeTest !== undefined) env.SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST = options.runtimeTest;
  if (options.trace !== undefined) env[FINAL_SEGMENT_TRACE_ENV] = options.trace;
  if (options.nodeOptions !== undefined) env.NODE_OPTIONS = options.nodeOptions;
  return env;
}

function assertTraceMaterialAbsent(filePaths, trace, label) {
  const canaries = [
    "finalSegmentTrace",
    "descriptorCanonicalSha256",
    "selectedCanonicalSha256",
    trace.descriptorCanonicalSha256,
    stableStringify(trace.descriptors),
  ].map(function (value) { return Buffer.from(value, "utf8"); });
  for (const filePath of filePaths) {
    const bytes = readFileSync(filePath);
    for (const canary of canaries) {
      assert.equal(bytes.includes(canary), false, label + " persisted trace material in " + filePath);
    }
  }
}

function runRaw(args, options) {
  const started = performance.now();
  const useMacTime = process.platform === "darwin";
  const cli = options && options.cli ? options.cli : CLI;
  const executable = useMacTime ? "/usr/bin/time" : process.execPath;
  const commandArgs = useMacTime ? ["-l", process.execPath, cli, ...args] : [cli, ...args];
  const result = spawnSync(executable, commandArgs, {
    cwd: options && options.cwd ? options.cwd : ROOT,
    env: options && options.env ? options.env : process.env,
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  const wallMs = performance.now() - started;
  const peakMatch = /([0-9]+)\s+maximum resident set size/u.exec(result.stderr || "");
  const peakRssKiB = peakMatch ? Math.ceil(Number(peakMatch[1]) / 1024) : null;
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { /* failure assertions retain raw output */ }
  return { ...result, report, wallMs, peakRssKiB };
}
function runOk(args, metrics, name, options) {
  const result = runRaw(args, options);
  assert.equal(result.status, 0, name + " failed\nstdout=" + result.stdout + "\nstderr=" + result.stderr);
  assert.ok(result.report && !["failed", null].includes(result.report.status), name + " invalid report");
  incrementCounter(EXECUTION_EVIDENCE.successByMode, args[0]);
  metrics[name] = { wallMs: Number(result.wallMs.toFixed(3)), peakRssKiB: result.peakRssKiB };
  return result.report;
}
function runFail(args, name, expected, options) {
  assert.ok(expected && typeof expected.code === "string" && typeof expected.detail === "string", name + " must declare exact first error code/detail");
  const targets = [...cliFailureTargets(args), ...((options && options.unchangedPaths) || []).map(function (entry) { return path.resolve(entry); })];
  const before = new Map([...new Set(targets)].map(function (target) { return [target, pathState(target)]; }));
  const residueBefore = transactionalResidue([...before.keys()]);
  const result = runRaw(args, options);
  assert.notEqual(result.status, 0, name + " unexpectedly passed");
  assert.equal(result.report && result.report.status, "failed", name + " missing failed report");
  assert.deepEqual(result.report.errors && result.report.errors[0], expected, name + " first error drift");
  for (const [target, state] of before) {
    assert.deepEqual(pathState(target), state, name + " mutated failure target " + target);
    EXECUTION_EVIDENCE.unchangedFailureTargets += 1;
  }
  assert.deepEqual(transactionalResidue([...before.keys()]), residueBefore, name + " left transactional residue");
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, args[0]);
  EXECUTION_EVIDENCE.expectedFirstCodes[name] = expected.code;
  EXECUTION_EVIDENCE.exactFailureAssertions += 1;
  return result;
}
function waitForPath(filePath, timeoutMs) {
  const started = Date.now();
  return new Promise(function (resolve, reject) {
    const poll = function () {
      try {
        readFileSync(filePath);
        resolve();
      } catch {
        if (Date.now() - started >= timeoutMs) {
          reject(new Error("timeout waiting for " + filePath));
          return;
        }
        setTimeout(poll, 10);
      }
    };
    poll();
  });
}

function waitForPathWhileRunning(filePath, child, timeoutMs) {
  const started = Date.now();
  return new Promise(function (resolve, reject) {
    const poll = function () {
      try {
        readFileSync(filePath);
        resolve();
      } catch {
        if (child.exitCode !== null || child.signalCode !== null) {
          reject(new Error("child exited before barrier " + filePath + ":" + child.exitCode + ":" + child.signalCode));
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          reject(new Error("timeout waiting for " + filePath));
          return;
        }
        setTimeout(poll, 10);
      }
    };
    poll();
  });
}

function allTransactionalResidue(root) {
  const residue = [];
  const visit = function (directory) {
    for (const name of readdirSync(directory)) {
      const child = path.join(directory, name);
      const status = lstatSync(child);
      if (name.includes(".tmp-") || name.includes(".anchor-stage-")) residue.push(child);
      if (status.isDirectory() && !status.isSymbolicLink()) visit(child);
    }
  };
  visit(root);
  return sorted(residue);
}

async function runSignalledBarrier(args, tempRoot, mode, hook, signal, stablePaths = []) {
  const token = [mode, hook, signal].join("-").toLowerCase().replaceAll("_", "-");
  const { ready, release } = controlPair(tempRoot, "signal-" + token);
  const prefix = "SAM_GOAL_MANUAL_PACK_V3_TEST_" + hook.toUpperCase();
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    [prefix + "_READY_FILE"]: ready,
    [prefix + "_RELEASE_FILE"]: release,
  };
  const stableBefore = new Map(stablePaths.map(function (filePath) { return [filePath, pathState(filePath)]; }));
  const residueBefore = allTransactionalResidue(tempRoot);
  const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function (chunk) { stderr.push(chunk); });
  try {
    await waitForPathWhileRunning(ready, child, 300_000);
  } catch (error) {
    throw new Error(error.message + "\nstdout=" + Buffer.concat(stdout).toString("utf8") + "\nstderr=" + Buffer.concat(stderr).toString("utf8"));
  }
  const rendered = readFileSync(ready, "utf8").trim();
  let payload;
  try { payload = JSON.parse(rendered); } catch { payload = { resourcePath: rendered }; }
  child.kill(signal);
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  const exitCode = signal === "SIGINT" ? 130 : 143;
  assert.deepEqual(closed, { code: exitCode, childSignal: null }, mode + "/" + hook + "/" + signal + " exit drift\n" + Buffer.concat(stderr).toString("utf8"));
  if (payload.childPid) {
    assert.throws(function () { process.kill(payload.childPid, 0); }, function (error) { return error && error.code === "ESRCH"; },
      mode + "/" + hook + " orphaned child " + payload.childPid);
  }
  for (const [filePath, state] of stableBefore) assert.deepEqual(pathState(filePath), state, mode + "/" + hook + " mutated " + filePath);
  assert.deepEqual(allTransactionalResidue(tempRoot), residueBefore, mode + "/" + hook + " left transactional residue");
  if (payload.resourcePath && !stableBefore.has(payload.resourcePath)) {
    assert.equal(pathExists(payload.resourcePath), false, mode + "/" + hook + " left provisional resource " + payload.resourcePath);
  }
  EXECUTION_EVIDENCE.signalExitCodes[mode + ":" + hook + ":" + signal] = exitCode;
  EXECUTION_EVIDENCE.signalCases.push({
    mode,
    hook,
    signal,
    exitCode,
    childPid: payload.childPid || null,
    childPidEsrch: payload.childPid ? true : null,
    residueUnchanged: true,
    unchangedPaths: stablePaths.length,
  });
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, mode);
  EXECUTION_EVIDENCE.residueAssertions += 1;
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  return { payload, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}

async function runMutationBarrier(args, tempRoot, mode, hook, name, expected, mutation, stablePaths = [], options = {}) {
  const token = [mode, hook, name].join("-").toLowerCase().replaceAll("_", "-");
  const { ready, release } = controlPair(tempRoot, "mutation-" + token);
  const prefix = "SAM_GOAL_MANUAL_PACK_V3_TEST_" + hook.toUpperCase();
  const env = {
    ...process.env,
    ...(options.env || {}),
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    [prefix + "_READY_FILE"]: ready,
    [prefix + "_RELEASE_FILE"]: release,
  };
  const stableBefore = new Map(stablePaths.map(function (filePath) { return [filePath, pathState(filePath)]; }));
  const residueBefore = allTransactionalResidue(tempRoot);
  const cli = options.cli || CLI;
  const child = spawn(process.execPath, [cli, ...args], { cwd: options.cwd || ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function (chunk) { stderr.push(chunk); });
  try {
    await waitForPathWhileRunning(ready, child, 300_000);
  } catch (error) {
    throw new Error(error.message + "\nstdout=" + Buffer.concat(stdout).toString("utf8") + "\nstderr=" + Buffer.concat(stderr).toString("utf8"));
  }
  const rendered = readFileSync(ready, "utf8").trim();
  let payload;
  try { payload = JSON.parse(rendered); } catch { payload = { resourcePath: rendered }; }
  let restore = function () {};
  try {
    restore = mutation(payload) || restore;
    writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
    const closed = await new Promise(function (resolve, reject) {
      child.on("error", reject);
      child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
    });
    assert.notEqual(closed.code, 0, name + " mutation unexpectedly passed\n" + Buffer.concat(stderr).toString("utf8"));
    const report = JSON.parse(Buffer.concat(stdout).toString("utf8"));
    assert.deepEqual(report.errors && report.errors[0], expected, name + " mutation first error drift");
    EXECUTION_EVIDENCE.expectedFirstCodes["mutation:" + name] = expected.code;
    EXECUTION_EVIDENCE.exactFailureAssertions += 1;
    incrementCounter(EXECUTION_EVIDENCE.failureByMode, mode);
  } finally {
    restore();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise(function (resolve) { child.once("close", resolve); });
    }
  }
  for (const [filePath, state] of stableBefore) assert.deepEqual(pathState(filePath), state, name + " did not restore " + filePath);
  assert.deepEqual(allTransactionalResidue(tempRoot), residueBefore, name + " left transactional residue");
  EXECUTION_EVIDENCE.mutationRaces += 1;
  EXECUTION_EVIDENCE.mutationCases.push({ mode, hook, name, firstError: expected, restored: true, residueUnchanged: true });
  EXECUTION_EVIDENCE.residueAssertions += 1;
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
}

function replaceFileMutation(filePath, suffix) {
  const backup = filePath + "." + suffix + ".original";
  const bytes = readFileSync(filePath);
  renameSync(filePath, backup);
  writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
  return function () {
    rmSync(filePath, { force: true });
    renameSync(backup, filePath);
  };
}

function replaceAncestorMutation(ancestorPath, suffix, recreate) {
  const backup = ancestorPath + "." + suffix + ".original";
  renameSync(ancestorPath, backup);
  mkdirSync(ancestorPath, { mode: 0o700 });
  if (recreate) recreate(ancestorPath, backup);
  return function () {
    rmSync(ancestorPath, { recursive: true, force: true });
    renameSync(backup, ancestorPath);
  };
}

function mutateOwnedFile(filePath, marker) {
  const bytes = readFileSync(filePath);
  writeFileSync(filePath, Buffer.concat([bytes, Buffer.from("\n" + marker + "\n", "utf8")]));
  return function () {};
}

function onlyTransactionalSibling(destination, token) {
  const parent = path.dirname(destination);
  const prefix = "." + path.basename(destination) + token;
  const matches = readdirSync(parent).filter(function (name) { return name.startsWith(prefix); });
  assert.equal(matches.length, 1, "expected one transactional sibling for " + destination + " and " + token);
  return path.join(parent, matches[0]);
}
async function runSignalledCompile(args, tempRoot, signal, releaseBeforeSignal) {
  const suffix = signal.toLowerCase().replace("sig", "");
  const { ready, release } = controlPair(tempRoot, "legacy-signal-" + suffix);
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function (chunk) { stderr.push(chunk); });
  await waitForPath(ready, 60_000);
  const stagePath = readFileSync(ready, "utf8").trim();
  if (releaseBeforeSignal) {
    writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
    await new Promise(function (resolve) { setTimeout(resolve, 1000); });
  }
  child.kill(signal);
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  assert.equal(closed.code, signal === "SIGINT" ? 130 : 143, signal + " exit code");
  assert.equal(pathExists(stagePath), false, signal + " left stage");
  EXECUTION_EVIDENCE.signalExitCodes[signal] = closed.code;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "compile");
  EXECUTION_EVIDENCE.residueAssertions += 1;
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  return { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
}
async function runDestinationRace(args, destination, tempRoot) {
  const { ready, release } = controlPair(tempRoot, "commit-race");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_COMMIT_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_COMMIT_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function (chunk) { stderr.push(chunk); });
  await waitForPath(ready, 300_000);
  const stagePath = readFileSync(ready, "utf8").trim();
  mkdirSync(destination, { mode: 0o700 });
  const marker = path.join(destination, "competitor-marker.txt");
  writeFileSync(marker, "competitor\n", { flag: "wx", mode: 0o600 });
  const before = lstatSync(destination);
  writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  assert.notEqual(closed.code, 0, "destination race passed");
  const after = lstatSync(destination);
  assert.equal(after.dev, before.dev, "competitor device replaced");
  assert.equal(after.ino, before.ino, "competitor inode replaced");
  assert.equal(readFileSync(marker, "utf8"), "competitor\n");
  assert.equal(pathExists(stagePath), false, "destination race left stage");
  assert.match(Buffer.concat(stdout).toString("utf8"), /output_dir_raced|output_dir_exists/u);
  EXECUTION_EVIDENCE.expectedFirstCodes.destinationRace = JSON.parse(Buffer.concat(stdout).toString("utf8")).errors[0].code;
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  EXECUTION_EVIDENCE.races.destination += 1;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "compile");
  EXECUTION_EVIDENCE.residueAssertions += 1;
  return Buffer.concat(stderr).toString("utf8");
}
async function runInputMutation(args, outputDir, inputPath, originalBytes, tempRoot) {
  const { ready, release } = controlPair(tempRoot, "input-mutation");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function () { /* drain */ });
  await waitForPath(ready, 60_000);
  const stagePath = readFileSync(ready, "utf8").trim();
  const changed = Buffer.from(originalBytes.toString("utf8").replace("  \"artifactType\"", "\t \"artifactType\""), "utf8");
  assert.equal(changed.length, originalBytes.length);
  writeFileSync(inputPath, changed);
  writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  writeFileSync(inputPath, originalBytes);
  assert.notEqual(closed.code, 0, "post-snapshot mutation passed");
  assert.match(Buffer.concat(stdout).toString("utf8"), /artifact_replaced_after_read|artifact_changed|input_changed/u);
  EXECUTION_EVIDENCE.expectedFirstCodes.inputMutation = JSON.parse(Buffer.concat(stdout).toString("utf8")).errors[0].code;
  assert.equal(pathExists(stagePath), false, "input mutation left stage");
  assert.equal(pathExists(outputDir), false, "input mutation committed output");
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  EXECUTION_EVIDENCE.mutationRaces += 1;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "compile");
  EXECUTION_EVIDENCE.residueAssertions += 2;
}
async function runAncestorReplacement(args, outputDir, ancestorDir, originalBytes, tempRoot) {
  const { ready, release } = controlPair(tempRoot, "ancestor-replacement");
  const backup = ancestorDir + "-original";
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function () { /* drain */ });
  await waitForPath(ready, 60_000);
  const stagePath = readFileSync(ready, "utf8").trim();
  renameSync(ancestorDir, backup);
  mkdirSync(ancestorDir, { mode: 0o700 });
  writeFileSync(path.join(ancestorDir, "review-a.json"), originalBytes, { flag: "wx", mode: 0o600 });
  writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  rmSync(ancestorDir, { recursive: true, force: true });
  renameSync(backup, ancestorDir);
  assert.notEqual(closed.code, 0, "ancestor replacement passed");
  assert.match(Buffer.concat(stdout).toString("utf8"), /external_ancestor_replaced/u);
  EXECUTION_EVIDENCE.expectedFirstCodes.ancestorReplacement = JSON.parse(Buffer.concat(stdout).toString("utf8")).errors[0].code;
  assert.equal(pathExists(stagePath), false, "ancestor replacement left stage");
  assert.equal(pathExists(outputDir), false, "ancestor replacement committed output");
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  EXECUTION_EVIDENCE.mutationRaces += 1;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "compile");
  EXECUTION_EVIDENCE.residueAssertions += 2;
}
async function runFinalReplacement(args, outputDir, inputPath, originalBytes, tempRoot) {
  const { ready, release } = controlPair(tempRoot, "final-replacement");
  const backup = inputPath + ".original";
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_STAGE_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function () { /* drain */ });
  await waitForPath(ready, 60_000);
  const stagePath = readFileSync(ready, "utf8").trim();
  renameSync(inputPath, backup);
  writeFileSync(inputPath, originalBytes, { flag: "wx", mode: 0o600 });
  writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  rmSync(inputPath, { force: true });
  renameSync(backup, inputPath);
  assert.notEqual(closed.code, 0, "final component replacement passed");
  assert.match(Buffer.concat(stdout).toString("utf8"), /artifact_replaced_after_read|artifact_realpath_rebound/u);
  EXECUTION_EVIDENCE.expectedFirstCodes.finalReplacement = JSON.parse(Buffer.concat(stdout).toString("utf8")).errors[0].code;
  assert.equal(pathExists(stagePath), false, "final replacement left stage");
  assert.equal(pathExists(outputDir), false, "final replacement committed output");
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  EXECUTION_EVIDENCE.mutationRaces += 1;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "compile");
  EXECUTION_EVIDENCE.residueAssertions += 2;
}
async function runAnchorRace(args, anchorPath, tempRoot) {
  const { ready, release } = controlPair(tempRoot, "anchor-race");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
    SAM_GOAL_MANUAL_PACK_V3_TEST_ANCHOR_READY_FILE: ready,
    SAM_GOAL_MANUAL_PACK_V3_TEST_ANCHOR_RELEASE_FILE: release,
  };
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", function (chunk) { stdout.push(chunk); });
  child.stderr.on("data", function (chunk) { stderr.push(chunk); });
  await waitForPath(ready, 300_000);
  const tempPath = readFileSync(ready, "utf8").trim();
  writeFileSync(anchorPath, "competitor-anchor\n", { flag: "wx", mode: 0o600 });
  const before = lstatSync(anchorPath);
  writeFileSync(release, "release\n", { flag: "wx", mode: 0o600 });
  const closed = await new Promise(function (resolve, reject) {
    child.on("error", reject);
    child.on("close", function (code, childSignal) { resolve({ code, childSignal }); });
  });
  assert.notEqual(closed.code, 0, "anchor race passed");
  const after = lstatSync(anchorPath);
  assert.equal(after.dev, before.dev, "anchor competitor device replaced");
  assert.equal(after.ino, before.ino, "anchor competitor inode replaced");
  assert.equal(readFileSync(anchorPath, "utf8"), "competitor-anchor\n");
  assert.equal(pathExists(tempPath), false, "anchor race left temp");
  assert.match(Buffer.concat(stdout).toString("utf8"), /anchor_raced|anchor_exists|EEXIST/u);
  EXECUTION_EVIDENCE.expectedFirstCodes.anchorRace = JSON.parse(Buffer.concat(stdout).toString("utf8")).errors[0].code;
  rmSync(ready, { force: true });
  rmSync(release, { force: true });
  EXECUTION_EVIDENCE.races.anchor += 1;
  incrementCounter(EXECUTION_EVIDENCE.failureByMode, "create-anchor");
  EXECUTION_EVIDENCE.residueAssertions += 1;
  void stderr;
}
function pathExists(filePath) {
  try { readFileSync(filePath); return true; } catch {
    try { readdirSync(filePath); return true; } catch { return false; }
  }
}
function compareCandidates(first, second) {
  assert.deepEqual(readdirSync(first).sort(compareBytes), EXPECTED_FILES);
  assert.deepEqual(readdirSync(second).sort(compareBytes), EXPECTED_FILES);
  for (const name of EXPECTED_FILES) {
    assert.deepEqual(readFileSync(path.join(first, name)), readFileSync(path.join(second, name)), "nondeterministic " + name);
  }
}
function assertCompiledMapping(candidate) {
  const parseRows = function (name) {
    return readFileSync(path.join(candidate, name), "utf8").trimEnd().split("\n").map(JSON.parse);
  };
  const labels = parseRows("manual-labels.jsonl");
  const subjects = parseRows("manual-subject-selection.jsonl");
  const first = parseRows("manual-review-pass1.jsonl");
  const second = parseRows("manual-review-pass2.jsonl");
  assert.equal(labels.length, 6711);
  assert.equal(subjects.length, 6711);
  assert.equal(first.length, 6711);
  assert.equal(second.length, 6711);
  for (let index = 0; index < decoderRows.length; index += 1) {
    const serial = String(decoderRows[index].sourceFrameIndex).padStart(4, "0");
    assert.equal(labels[index].labelId, "label-" + decoderRows[index].clipId + "-" + serial);
    assert.equal(subjects[index].selectionId, "subject-" + decoderRows[index].clipId + "-" + serial);
    assert.deepEqual(labels[index].span, { kind: "frame", identity: exactIdentity(decoderRows[index]) });
    assert.deepEqual(subjects[index].span, { kind: "frame", identity: exactIdentity(decoderRows[index]) });
    assert.deepEqual(first[index].identity, exactIdentity(decoderRows[index]));
    assert.deepEqual(second[index].identity, exactIdentity(decoderRows[index]));
    assert.equal(first[index].pass, "first");
    assert.equal(second[index].pass, "second");
  }
  const explicitThird = labels.find(function (row) {
    return row.span.identity.clipId === "csi-pose" && row.span.identity.sourceFrameIndex === 50;
  });
  assert.deepEqual(explicitThird.scenarios, ["turn"], "explicit third adjudication value was not preserved");
  const firstScenario = first.find(function (row) { return row.identity.clipId === "csi-pose" && row.identity.sourceFrameIndex === 50; });
  const secondScenario = second.find(function (row) { return row.identity.clipId === "csi-pose" && row.identity.sourceFrameIndex === 50; });
  const scenarioAdjudication = parseRows("manual-adjudication.jsonl").find(function (row) {
    return row.identity.clipId === "csi-pose" && row.identity.sourceFrameIndex === 50;
  });
  assert.deepEqual(firstScenario.scenarios, ["neutral"]);
  assert.deepEqual(secondScenario.scenarios, ["fast_motion"]);
  assert.deepEqual(scenarioAdjudication.scenarios, ["turn"]);
  const finalLeftContact = function (frameIndex) {
    return labels.find(function (row) { return row.span.identity.clipId === "csi-pose" && row.span.identity.sourceFrameIndex === frameIndex; }).contact.left;
  };
  assert.deepEqual([finalLeftContact(90), finalLeftContact(130), finalLeftContact(190)], ["planted", "moving", "planted"],
    "discontinuous same-leaf decisions bled across segments");
  const manifest = readJson(path.join(candidate, "evaluation-pack.json"));
  assert.equal(manifest.phase, "p0-candidate");
  assert.equal(manifest.expectedCanonicalHash, canonicalHash(manifest, true));
  assert.deepEqual(sorted(Object.keys(manifest.files)), sorted([
    "evaluationContract", "labelSchema", "authoringSchema", "teacherInputInventory", "teacherPolicy",
    "teacherSchema", "p0AnchorSchema", "p1AnchorSchema", "sourceInventory", "decoderManifest",
    "manualWindows", "manualLabels", "manualSubjectSelection", "manualReviewPassA",
    "manualReviewPassB", "manualAdjudication", "manualPolicy", "manualSummary",
    "manualCompiler", "labelAuditor",
  ]));
  assert.equal(manifest.files.authoringSchema.path, "tests/fixtures/sam-goal-v2/evaluation-v3/authoring-schema.json");
  assert.equal(manifest.files.manualCompiler.path, "scripts/sam-goal-manual-pack-v3.mjs");
  assert.equal(manifest.files.labelAuditor.path, "scripts/sam-goal-label-audit-v3.mjs");
  const windows = readJson(path.join(candidate, "manual-windows.json"));
  const expectedWindows = normalizedWindows(windowsFor("first")).map(function (window) {
    const rows = decoderByClip.get(window.clipId);
    const endTicks = window.endFrameIndexExclusive === rows.length
      ? String(BigInt(rows[rows.length - 1].ptsTicks) + 1n)
      : rows[window.endFrameIndexExclusive].ptsTicks;
    return {
      windowId: window.windowId,
      clipId: window.clipId,
      startPtsTicks: rows[window.startFrameIndex].ptsTicks,
      endPtsTicksExclusive: endTicks,
      expectedDecoderRows: window.endFrameIndexExclusive - window.startFrameIndex,
      purposeTags: window.purposeTags,
      scenarioTags: window.scenarioTags,
    };
  });
  assert.deepEqual(windows.windows, expectedWindows);
  assert.equal(windows.expectedCanonicalHash, canonicalHash(windows, true));
  const summary = readJson(path.join(candidate, "manual-summary.json"));
  assert.equal(summary.decoderRows, 6711);
  assert.deepEqual(summary.perClip, contract.sourceBinding.paired.map(function (clip) {
    return {
      clipId: clip.clipId,
      decoderRows: clip.rows,
      manualRows: clip.rows,
      subjectRows: clip.rows,
      reviewPass1Rows: clip.rows,
      reviewPass2Rows: clip.rows,
    };
  }));
  assert.equal(summary.expectedCanonicalHash, canonicalHash(summary, true));
  const durableText = EXPECTED_FILES.map(function (name) {
    return readFileSync(path.join(candidate, name), "utf8");
  }).join("\n");
  assert.doesNotMatch(durableText, /studentModelHash|trackerOutput|retargetOutput|solverOutput|candidateP0LockSha256/u);
  const types = new Set();
  return { manifest, types };
}

async function main() {
  const beforePins = historicalPins();
  assert.equal(decoderRows.length, 6711);
  assert.equal(readFileSync(PATHS.authoring).length, 31_479);
  assert.equal(sha256(readFileSync(PATHS.authoring)), "90a5e27a6cd10bee753d516ec0f21f361ce8a529c42f585a228190e38311c68e");
  assert.equal(canonicalHash(authoringSchema, false), "c255cab6b226b0b4ac418ff17c92fec053d34156bf3efaf3af88fc30cdd32962");
  assert.equal(Object.keys(authoringSchema.$defs).length, 47);
  assert.deepEqual(authoringSchema.oneOf, [{ $ref: "#/$defs/review" }, { $ref: "#/$defs/adjudication" }]);
  assert.equal(authoringSchema.$defs.disagreement.allOf[1].oneOf.length, 14);
  assert.equal(authoringSchema.$defs.decision.allOf[1].oneOf.length, 14);
  assert.equal(authoringSchema.$defs.review.properties.artifactType.const, "sam-goal-manual-review-v3");
  assert.equal(authoringSchema.$defs.review.properties.schemaVersion.const, 3);
  assert.equal(authoringSchema.$defs.adjudication.properties.role.const, "adjudication");
  const compilerSource = readFileSync(CLI, "utf8");
  assert.doesNotMatch(compilerSource, /sam-goal-manual-pack-v2|evaluation-v2/u);
  let refs = 0;
  const countRefs = function (value) {
    if (Array.isArray(value)) value.forEach(countRefs);
    else if (value && typeof value === "object") {
      if (Object.hasOwn(value, "$ref")) refs += 1;
      Object.values(value).forEach(countRefs);
    }
  };
  countRefs(authoringSchema);
  assert.equal(refs, 133);
  const draftPython = process.env.SAM_GOAL_PYTHON || "python3";
  const draft = spawnSync(draftPython, ["-c",
    "import json,sys\nfrom jsonschema import Draft202012Validator\nfor p in sys.argv[1:]:\n s=json.load(open(p,encoding='utf-8'))\n Draft202012Validator.check_schema(s)\nprint(json.dumps({'executable':sys.executable,'version':sys.version.split()[0]}))\n",
    PATHS.authoring, PATHS.labelSchema, PATHS.teacherSchema, PATHS.p0Schema, PATHS.p1Schema, PATHS.sourceSchema,
  ], { encoding: "utf8" });
  assert.equal(draft.status, 0, "Draft 2020-12 check failed with " + draftPython + ": " + draft.stderr);
  const draftPythonReport = JSON.parse(draft.stdout.trim());
  const r2Syntax = spawnSync(process.execPath, ["--check", path.join(ROOT, "scripts/sam-goal-manual-pack-v2.mjs")], { encoding: "utf8" });
  assert.equal(r2Syntax.status, 0, r2Syntax.stderr);

  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "sam-goal-manual-pack-v3-synthetic-")));
  const metrics = {};
  try {
    const reviewAPath = path.join(tempRoot, "review-a.json");
    const reviewBPath = path.join(tempRoot, "review-b.json");
    const adjudicationPath = path.join(tempRoot, "adjudication.json");
    const reviewerA = sha256(Buffer.from("synthetic-reviewer-a", "utf8"));
    const reviewerB = sha256(Buffer.from("synthetic-reviewer-b", "utf8"));
    const adjudicator = sha256(Buffer.from("synthetic-adjudicator", "utf8"));
    const reviewA = makeReview("first", reviewerA);
    const reviewB = makeReview("second", reviewerB);
    const reviewABytes = pretty(reviewA);
    const reviewBBytes = pretty(reviewB);
    assert.notEqual(sha256(reviewABytes), sha256(reviewBBytes));
    const adjudication = makeAdjudication(reviewA, reviewABytes, reviewB, reviewBBytes, adjudicator);
    const adjudicationBytes = pretty(adjudication);
    const valueTypes = new Set(adjudication.disagreements.map(function (entry) { return entry.valueType; }));
    assert.deepEqual(sorted(valueTypes), sorted(authoringSchema.$defs.valueType.enum));
    writeFileSync(reviewAPath, reviewABytes, { flag: "wx", mode: 0o600 });
    writeFileSync(reviewBPath, reviewBBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(adjudicationPath, adjudicationBytes, { flag: "wx", mode: 0o600 });

    const dependencyFiles = Object.values(PATHS);
    const parsePreload = path.join(tempRoot, "parse-before-open-preload.cjs");
    const parseReport = path.join(tempRoot, "parse-before-open-report.jsonl");
    writeFileSync(parsePreload, fsGuardPreloadSource({
      allowedFiles: [CLI],
      forbiddenFiles: [...dependencyFiles, reviewAPath, reviewBPath, adjudicationPath],
      reportPath: parseReport,
    }), { flag: "wx", mode: 0o600 });
    const parseEnv = {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS || "", "--require=" + parsePreload].filter(Boolean).join(" "),
    };
    for (const mode of ["validate-review", "compile", "create-anchor", "verify-anchor"]) {
      rmSync(parseReport, { force: true });
      const parseFailure = runFail([mode, "--unexpected", "value"], "parseBeforeOpen:" + mode,
        expectedFailure("unknown_argument", "unknown_argument:--unexpected"), { env: parseEnv });
      assert.equal(pathExists(parseReport), true, mode + " guard report missing: " + parseFailure.stderr);
      const opened = readGuardReports(parseReport).flatMap(function (entry) { return Object.keys(entry.opened); });
      assert.ok(opened.every(function (filePath) { return path.resolve(filePath) === CLI; }), mode + " opened contract/input before CLI parsing");
    }

    const traceGateArgs = {
      "validate-review": [
        "validate-review", "--review", reviewAPath, "--expected-role", "first",
        "--expected-reviewer-pseudonym-sha256", reviewerA,
      ],
      compile: [
        "compile", "--review-a", reviewAPath, "--review-b", reviewBPath,
        "--adjudication", adjudicationPath, "--output-dir", path.join(tempRoot, "trace-gate-output"),
      ],
      "create-anchor": [
        "create-anchor", "--anchor", path.join(tempRoot, "trace-gate-anchor.json"),
        "--label-dir", path.join(tempRoot, "trace-gate-label-dir"),
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ],
      "verify-anchor": [
        "verify-anchor", "--anchor", path.join(tempRoot, "trace-gate-anchor.json"),
        "--expected-p0-anchor-sha256", "f".repeat(64), "--label-dir", path.join(tempRoot, "trace-gate-label-dir"),
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ],
    };
    const assertTraceGateFailureBeforeOpen = function (name, args, environment, expected) {
      rmSync(parseReport, { force: true });
      const result = runFail(args, name, expected, { env: environment });
      assert.equal(pathExists(parseReport), true, name + " guard report missing: " + result.stderr);
      const opened = readGuardReports(parseReport).flatMap(function (entry) { return Object.keys(entry.opened); });
      assert.ok(opened.every(function (filePath) { return path.resolve(filePath) === CLI; }),
        name + " opened dependency/input before final-segment trace gate rejection");
      assert.doesNotMatch(result.stderr, /guard_(?:forbidden_read|outside_allowlist)/u,
        name + " reached dependency/input reads before trace gate rejection");
    };
    const guardedNodeOptions = [process.env.NODE_OPTIONS || "", "--require=" + parsePreload].filter(Boolean).join(" ");
    assertTraceGateFailureBeforeOpen("finalSegmentTraceGate:missingNodeEnv", traceGateArgs.compile,
      finalSegmentTraceEnvironment({ runtimeTest: "1", trace: "1", nodeOptions: guardedNodeOptions }),
      expectedFailure("test_hook_forbidden", "test_hook_forbidden:" + FINAL_SEGMENT_TRACE_ENV));
    assertTraceGateFailureBeforeOpen("finalSegmentTraceGate:missingRuntime", traceGateArgs.compile,
      finalSegmentTraceEnvironment({ nodeEnv: "test", trace: "1", nodeOptions: guardedNodeOptions }),
      expectedFailure("test_hook_forbidden", "test_hook_forbidden:" + FINAL_SEGMENT_TRACE_ENV));
    for (const invalidValue of ["bad", ""]) {
      assertTraceGateFailureBeforeOpen("finalSegmentTraceGate:invalidValue:" + (invalidValue || "empty"), traceGateArgs.compile,
        finalSegmentTraceEnvironment({ nodeEnv: "test", runtimeTest: "1", trace: invalidValue, nodeOptions: guardedNodeOptions }),
        expectedFailure("test_fault_value_invalid", "test_fault_value_invalid:" + FINAL_SEGMENT_TRACE_ENV + ":" + invalidValue));
    }
    for (const mode of ["validate-review", "create-anchor", "verify-anchor"]) {
      assertTraceGateFailureBeforeOpen("finalSegmentTraceGate:mode:" + mode, traceGateArgs[mode],
        finalSegmentTraceEnvironment({ nodeEnv: "test", runtimeTest: "1", trace: "1", nodeOptions: guardedNodeOptions }),
        expectedFailure("test_hook_mode_invalid", "test_hook_mode_invalid:" + FINAL_SEGMENT_TRACE_ENV + ":" + mode));
    }

    const runBlindReview = function (role, reviewPath, counterpartPath, pseudonym) {
      const blindPreload = path.join(tempRoot, "blindness-" + role + "-preload.cjs");
      const blindReport = path.join(tempRoot, "blindness-" + role + "-report.jsonl");
      writeFileSync(blindPreload, fsGuardPreloadSource({
        allowedFiles: [CLI, ...dependencyFiles, reviewPath],
        forbiddenFiles: [counterpartPath, adjudicationPath],
        reportPath: blindReport,
      }), { flag: "wx", mode: 0o600 });
      const before = readdirSync(tempRoot).sort(compareBytes);
      const validated = runOk(["validate-review", "--review", reviewPath, "--expected-role", role, "--expected-reviewer-pseudonym-sha256", pseudonym], metrics, "validateReview" + role, {
        env: finalSegmentTraceEnvironment({
          nodeOptions: [process.env.NODE_OPTIONS || "", "--require=" + blindPreload].filter(Boolean).join(" "),
        }),
      });
      assert.equal(Object.hasOwn(validated, "finalSegmentTrace"), false, "validate-review exposed final-segment trace");
      const after = readdirSync(tempRoot).sort(compareBytes);
      assert.deepEqual(after, [...before, path.basename(blindReport)].sort(compareBytes), "validate-review performed an unapproved write");
      assertGuardOpenedExactlyOnce(blindReport, [...dependencyFiles, reviewPath]);
      EXECUTION_EVIDENCE.residueAssertions += 1;
    };
    runBlindReview("first", reviewAPath, reviewBPath, reviewerA);
    runBlindReview("second", reviewBPath, reviewAPath, reviewerB);
    const repeatedWindowIdReview = deepClone(reviewA);
    for (const window of repeatedWindowIdReview.windows) {
      if (stableEqual(window.purposeTags, ["full_clip_denominator"])) window.windowId = "base";
    }
    const sealedRepeatedWindowIdReview = withSelfHash(repeatedWindowIdReview);
    const repeatedWindowIdPath = path.join(tempRoot, "review-repeated-window-id-across-clips.json");
    writeFileSync(repeatedWindowIdPath, pretty(sealedRepeatedWindowIdReview), { flag: "wx", mode: 0o600 });
    runOk(["validate-review", "--review", repeatedWindowIdPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], metrics, "validatePerClipWindowIds");
    runFail(["validate-review", "--review", reviewAPath, "--expected-role", "second", "--expected-reviewer-pseudonym-sha256", reviewerA], "wrongRole",
      expectedFailure("review_role_mismatch", "review_role_mismatch:review:first:second"));
    runFail(["validate-review", "--review", reviewAPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerB], "wrongPseudonym",
      expectedFailure("reviewer_pseudonym_mismatch", "reviewer_pseudonym_mismatch:review"));
    const duplicateKeyPath = path.join(tempRoot, "review-a-duplicate-key.json");
    const duplicateBytes = reviewABytes.toString("utf8").replace("{\n", "{\n  \"artifactType\": \"sam-goal-manual-review-v3\",\n");
    writeFileSync(duplicateKeyPath, duplicateBytes, { flag: "wx", mode: 0o600 });
    const duplicateResult = runFail(["validate-review", "--review", duplicateKeyPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "duplicateJsonKey",
      expectedFailure("json_duplicate_key", "json_duplicate_key:review:artifactType"));
    assert.match(duplicateResult.stdout, /json_duplicate_key/u);
    const v2ReviewPath = path.join(tempRoot, "review-v2-replay.json");
    const v2Review = withSelfHash({ ...deepClone(reviewA), artifactType: "sam-goal-manual-review-v2", schemaVersion: 2 });
    writeFileSync(v2ReviewPath, pretty(v2Review), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", v2ReviewPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "v2ReviewReplay",
      expectedFailure("schema_validation", "schema_validation:review/artifactType:const"));
    const openVocabularyPath = path.join(tempRoot, "review-open-vocabulary.json");
    const openVocabulary = deepClone(reviewA);
    openVocabulary.clips[0].intervals[0].state.observability = { palm: "observable" };
    const sealedOpenVocabulary = withSelfHash(openVocabulary);
    writeFileSync(openVocabularyPath, pretty(sealedOpenVocabulary), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", openVocabularyPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "openObservabilityVocabulary",
      expectedFailure("schema_validation", "schema_validation:review/clips/0/intervals/0/state:additional:observability"));
    const forbiddenFamilyPath = path.join(tempRoot, "review-forbidden-family.json");
    const forbiddenFamily = deepClone(reviewA);
    forbiddenFamily.windows[0].windowId = "student-avatar-live";
    writeFileSync(forbiddenFamilyPath, pretty(withSelfHash(forbiddenFamily)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", forbiddenFamilyPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "forbiddenDurableFamily",
      expectedFailure("forbidden_authoring_value", "forbidden_authoring_value:review/windows/0/windowId"));
    const sourceDriftPath = path.join(tempRoot, "review-source-drift.json");
    const sourceDrift = deepClone(reviewA);
    sourceDrift.sourceBinding.sources.reverse();
    const sealedSourceDrift = withSelfHash(sourceDrift);
    writeFileSync(sourceDriftPath, pretty(sealedSourceDrift), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", sourceDriftPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "sourceProjectionOrderDrift",
      expectedFailure("review_source_binding_drift", "review_source_binding_drift:review"));
    for (const field of [
      "evaluationContractCanonicalSha256", "labelSchemaCanonicalSha256", "authoringSchemaCanonicalSha256",
      "teacherInputInventoryCanonicalSha256", "teacherPolicyCanonicalSha256", "teacherSchemaCanonicalSha256",
      "p0AnchorSchemaCanonicalSha256", "p1AnchorSchemaCanonicalSha256", "sourceContractCanonicalSha256",
      "sourceSchemaCanonicalSha256", "sourceInventoryCanonicalSha256", "decoderByteSha256",
      "decoderCanonicalRowsSha256",
    ]) {
      const bindingDrift = deepClone(reviewA);
      bindingDrift.sourceBinding[field] = bindingDrift.sourceBinding[field][0] === "0"
        ? "1" + bindingDrift.sourceBinding[field].slice(1)
        : "0" + bindingDrift.sourceBinding[field].slice(1);
      const sealedBindingDrift = withSelfHash(bindingDrift);
      const bindingPath = path.join(tempRoot, "review-binding-" + field + ".json");
      writeFileSync(bindingPath, pretty(sealedBindingDrift), { flag: "wx", mode: 0o600 });
      runFail(["validate-review", "--review", bindingPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "bindingDrift:" + field,
        expectedFailure("review_source_binding_drift", "review_source_binding_drift:review"));
    }
    const sourceCountDrift = deepClone(reviewA);
    sourceCountDrift.sourceBinding.sources.pop();
    const sourceCountPath = path.join(tempRoot, "review-source-count.json");
    writeFileSync(sourceCountPath, pretty(withSelfHash(sourceCountDrift)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", sourceCountPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "sourceDescriptorCountDrift",
      expectedFailure("schema_validation", "schema_validation:review/sourceBinding/sources:minItems"));
    const decoderCountDrift = deepClone(reviewA);
    decoderCountDrift.sourceBinding.decoderRowCount = 6710;
    const decoderCountPath = path.join(tempRoot, "review-decoder-count.json");
    writeFileSync(decoderCountPath, pretty(withSelfHash(decoderCountDrift)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", decoderCountPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "decoderCountDrift",
      expectedFailure("schema_validation", "schema_validation:review/sourceBinding/decoderRowCount:const"));
    const reorderedIntervalsPath = path.join(tempRoot, "review-reordered-intervals.json");
    const reorderedIntervals = deepClone(reviewA);
    const reorderedClip = reorderedIntervals.clips.find(function (entry) { return entry.clipId === "csi-pose"; });
    [reorderedClip.intervals[0], reorderedClip.intervals[1]] = [reorderedClip.intervals[1], reorderedClip.intervals[0]];
    const sealedReorderedIntervals = withSelfHash(reorderedIntervals);
    writeFileSync(reorderedIntervalsPath, pretty(sealedReorderedIntervals), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", reorderedIntervalsPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "rawIntervalOrderDrift",
      expectedFailure("review_interval_gap_or_overlap", "review_interval_gap_or_overlap:review:csi-pose:0:0"));
    const unorderedScenarioPath = path.join(tempRoot, "review-unordered-scenario.json");
    const unorderedScenario = deepClone(reviewA);
    unorderedScenario.clips[0].intervals[0].scenarios = ["neutral", "fast_motion"];
    const sealedUnorderedScenario = withSelfHash(unorderedScenario);
    writeFileSync(unorderedScenarioPath, pretty(sealedUnorderedScenario), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", unorderedScenarioPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "scenarioArrayOrderDrift",
      expectedFailure("canonical_array_order", "canonical_array_order:review/arms-crossed/0/scenarios"));

    const assertTruthAttack = function (name, expected, selectInterval, mutate) {
      const attacked = deepClone(reviewA);
      const interval = selectInterval(attacked);
      mutate(interval.state);
      const attackedPath = path.join(tempRoot, "review-truth-" + name + ".json");
      writeFileSync(attackedPath, pretty(withSelfHash(attacked)), { flag: "wx", mode: 0o600 });
      runFail(["validate-review", "--review", attackedPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA],
        "truthRule:" + name, expected);
    };
    const absentInterval = function (review) {
      return review.clips.find(function (clip) { return clip.clipId === "arms-crossed"; }).intervals[0];
    };
    const presentInterval = function (review) {
      return review.clips.find(function (clip) { return clip.clipId === "dance-16x9-padded"; }).intervals[0];
    };
    assertTruthAttack("absent-state", expectedFailure("truth_absent", "truth_absent:review/arms-crossed/0"), absentInterval,
      function (state) { state.personState = "unknown"; });
    assertTruthAttack("absent-observable", expectedFailure("truth_absent_observable", "truth_absent_observable:review/arms-crossed/0"), absentInterval,
      function (state) { state.handObservability.left = "observable"; });
    assertTruthAttack("absent-pixels", expectedFailure("truth_absent_pixels", "truth_absent_pixels:review/arms-crossed/0"), absentInterval,
      function (state) { state.occlusion.body = "observable"; });
    assertTruthAttack("single-target", expectedFailure("truth_single_target", "truth_single_target:review/dance-16x9-padded/0"), presentInterval,
      function (state) { state.subjectSelection = { state: "ambiguous", manualTargetId: null, anchor: null }; });
    assertTruthAttack("unknown-single-target", expectedFailure("truth_single_target", "truth_single_target:review/dance-16x9-padded/0"), presentInterval,
      function (state) {
        state.presence = "unknown";
        state.personState = "single_target";
        state.contact = { left: "unknown", right: "unknown" };
        state.subjectSelection = { state: "ambiguous", manualTargetId: null, anchor: null };
      });
    assertTruthAttack("multiple-people", expectedFailure("truth_multiple_people", "truth_multiple_people:review/dance-16x9-padded/0"), presentInterval,
      function (state) { state.personState = "multiple_people"; });
    assertTruthAttack("contact-evidence", expectedFailure("truth_contact", "truth_contact:review/dance-16x9-padded/0:left"), presentInterval,
      function (state) { state.occlusion.leftFoot = "partial"; });
    assertTruthAttack("hand-evidence", expectedFailure("truth_hand", "truth_hand:review/dance-16x9-padded/0:left"), presentInterval,
      function (state) { state.occlusion.leftHand = "out_of_frame"; });
    assertTruthAttack("endpoint-evidence", expectedFailure("truth_endpoint", "truth_endpoint:review/dance-16x9-padded/0:head"), presentInterval,
      function (state) { state.occlusion.body = "out_of_frame"; });

    const exactPlantPath = path.join(tempRoot, "review-plant-exact-threshold.json");
    writeFileSync(exactPlantPath, pretty(isolatedPlantReview(reviewA, "arms-crossed", 8, 12, "left")), { flag: "wx", mode: 0o600 });
    runOk(["validate-review", "--review", exactPlantPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], metrics, "plantExactThreshold");
    const terminalPlantStart = decoderByClip.get("arms-crossed").length - 4;
    const terminalPlantPath = path.join(tempRoot, "review-plant-terminal-threshold.json");
    writeFileSync(terminalPlantPath, pretty(isolatedPlantReview(reviewA, "arms-crossed", terminalPlantStart, decoderByClip.get("arms-crossed").length, "left")), { flag: "wx", mode: 0o600 });
    runOk(["validate-review", "--review", terminalPlantPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], metrics, "plantTerminalThreshold");
    const belowPlantPath = path.join(tempRoot, "review-plant-one-sample-below.json");
    writeFileSync(belowPlantPath, pretty(isolatedPlantReview(reviewA, "arms-crossed", 8, 11, "left")), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", belowPlantPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "plantOneSampleBelow",
      expectedFailure("review_planted_confirmation", "review_planted_confirmation:arms-crossed:left:8:11"));

    const exactSupportPath = path.join(tempRoot, "review-left-hand-support-exact.json");
    writeFileSync(exactSupportPath, pretty(exactLeftHandSupportReview(reviewA, 150)), { flag: "wx", mode: 0o600 });
    runOk(["validate-review", "--review", exactSupportPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], metrics, "leftHandSupportExactFloor");
    const belowSupportPath = path.join(tempRoot, "review-left-hand-support-below.json");
    writeFileSync(belowSupportPath, pretty(exactLeftHandSupportReview(reviewA, 149)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", belowSupportPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "leftHandSupportOneBelow",
      expectedFailure("review_support_floor", "review_support_floor:leftHand:299:2"));

    const shortPlantPath = path.join(tempRoot, "review-short-plant.json");
    const shortPlant = deepClone(reviewA);
    const danceClip = shortPlant.clips.find(function (entry) { return entry.clipId === "dance-16x9-padded"; });
    const movingIndex = danceClip.intervals.findIndex(function (entry) {
      return entry.startFrameIndex <= 200 && entry.endFrameIndexExclusive > 200;
    });
    const movingInterval = danceClip.intervals[movingIndex];
    const beforePlant = { ...deepClone(movingInterval), endFrameIndexExclusive: 200 };
    const onePlant = { ...deepClone(movingInterval), startFrameIndex: 200, endFrameIndexExclusive: 201 };
    onePlant.state.contact.left = "planted";
    const afterPlant = { ...deepClone(movingInterval), startFrameIndex: 201 };
    danceClip.intervals.splice(movingIndex, 1, beforePlant, onePlant, afterPlant);
    const sealedShortPlant = withSelfHash(shortPlant);
    writeFileSync(shortPlantPath, pretty(sealedShortPlant), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", shortPlantPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "shortPlantConfirmation",
      expectedFailure("review_planted_confirmation", "review_planted_confirmation:dance-16x9-padded:left:200:201"));

    const reverseClipOrder = deepClone(reviewA);
    reverseClipOrder.clips.reverse();
    const reverseClipOrderPath = path.join(tempRoot, "review-clips-reversed.json");
    writeFileSync(reverseClipOrderPath, pretty(withSelfHash(reverseClipOrder)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", reverseClipOrderPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "reviewClipOrder:reversed",
      expectedFailure("review_clip_order", "review_clip_order:review:0:" + clipIds.at(-1) + ":" + clipIds[0]));
    const adjacentClipOrder = deepClone(reviewA);
    [adjacentClipOrder.clips[0], adjacentClipOrder.clips[1]] = [adjacentClipOrder.clips[1], adjacentClipOrder.clips[0]];
    const adjacentClipOrderPath = path.join(tempRoot, "review-clips-adjacent-swapped.json");
    writeFileSync(adjacentClipOrderPath, pretty(withSelfHash(adjacentClipOrder)), { flag: "wx", mode: 0o600 });
    runFail(["validate-review", "--review", adjacentClipOrderPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "reviewClipOrder:adjacent",
      expectedFailure("review_clip_order", "review_clip_order:review:0:" + clipIds[1] + ":" + clipIds[0]));

    const kappaMacro = function (flipped) {
      const total = 2849;
      const present = 555;
      const observed = (total - flipped) / total;
      const chance = (present / total) * ((present - flipped) / total)
        + ((total - present) / total) * ((total - present + flipped) / total);
      const clipKappa = (observed - chance) / (1 - chance);
      return (6 + clipKappa) / 7;
    };
    assert.equal(kappaMacro(60), 0.99, "designed equality kappa is not exact");
    assert.equal(kappaMacro(61), 0.9898260882749838, "designed one-sample-below kappa drift");
    const kappaReviewA = kappaBoundaryReview(reviewA, "first", reviewerA, 0);
    const kappaReviewABytes = pretty(kappaReviewA);
    const kappaReviewAPath = path.join(tempRoot, "review-kappa-a.json");
    writeFileSync(kappaReviewAPath, kappaReviewABytes, { flag: "wx", mode: 0o600 });
    const writeKappaPair = function (flipped, suffix) {
      const second = kappaBoundaryReview(reviewA, "second", reviewerB, flipped);
      const secondBytes = pretty(second);
      const secondPath = path.join(tempRoot, "review-kappa-b-" + suffix + ".json");
      writeFileSync(secondPath, secondBytes, { flag: "wx", mode: 0o600 });
      const adjudicated = makeAdjudication(kappaReviewA, kappaReviewABytes, second, secondBytes, adjudicator);
      const adjudicationForPairPath = path.join(tempRoot, "adjudication-kappa-" + suffix + ".json");
      writeFileSync(adjudicationForPairPath, pretty(adjudicated), { flag: "wx", mode: 0o600 });
      return { secondPath, adjudicationPath: adjudicationForPairPath };
    };
    const exactKappaPair = writeKappaPair(60, "exact");
    runOk([
      "compile", "--review-a", kappaReviewAPath, "--review-b", exactKappaPair.secondPath,
      "--adjudication", exactKappaPair.adjudicationPath, "--output-dir", path.join(tempRoot, "candidate-kappa-exact"),
    ], metrics, "kappaExactFloor");
    const belowKappaPair = writeKappaPair(61, "below");
    runFail([
      "compile", "--review-a", kappaReviewAPath, "--review-b", belowKappaPair.secondPath,
      "--adjudication", belowKappaPair.adjudicationPath, "--output-dir", path.join(tempRoot, "candidate-kappa-below"),
    ], "kappaOneSampleBelow",
    expectedFailure("agreement_below_floor", "agreement_below_floor:presencePersonStateKappa:0.9898260882749838:0.99"));
    runFail(["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", path.join(tempRoot, "unused"), "--anchor", path.join(tempRoot, "bad")], "modeInapplicableFlag",
      expectedFailure("mode_argument_set_invalid", "mode_argument_set_invalid:compile"));

    const mirrorCompileArgs = function (output) {
      return ["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", output];
    };
    const dependencyMirrorCases = [
      ["contract", PATHS.contract, "evaluation_contract", hashes.evaluationContractCanonicalSha256, true, function (value) { value.schemaVersion += 1; }],
      ["policy", PATHS.teacherPolicy, "teacher_policy", hashes.teacherPolicyCanonicalSha256, true, function (value) { value.artifactType += "-substituted"; }],
      ["teacher-input", PATHS.teacherInventory, "teacher_input_inventory", hashes.teacherInputInventoryCanonicalSha256, true, function (value) { value.artifactType += "-substituted"; }],
      ["teacher-schema", PATHS.teacherSchema, "teacher_schema", hashes.teacherSchemaCanonicalSha256, false, function (value) { value.$id += "-substituted"; }],
      ["source-contract", PATHS.sourceContract, "source_contract", hashes.sourceContractCanonicalSha256, true, function (value) { value.artifactType += "-substituted"; }],
      ["source-inventory", PATHS.sourceInventory, "source_inventory", hashes.sourceInventoryCanonicalSha256, true, function (value) { value.artifactType += "-substituted"; }],
    ];
    for (const [name, sourcePath, label, expectedCanonical, omitExpected, mutate] of dependencyMirrorCases) {
      const mirror = makeRepoMirror(tempRoot, name);
      const target = path.join(mirror.root, path.relative(ROOT, sourcePath));
      const substituted = readJson(target);
      mutate(substituted);
      writeFileSync(target, pretty(substituted));
      const actualCanonical = canonicalHash(substituted, omitExpected);
      runFail(mirrorCompileArgs(path.join(tempRoot, "candidate-mirror-" + name)), "repoMirrorSubstitution:" + name,
        expectedFailure("dependency_hash_drift", "dependency_hash_drift:" + label + ":" + actualCanonical + ":" + expectedCanonical), { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "decoder");
      const target = path.join(mirror.root, path.relative(ROOT, PATHS.decoder));
      const bytes = readFileSync(target);
      const firstNewline = bytes.indexOf(0x0a);
      const first = JSON.parse(bytes.subarray(0, firstNewline).toString("utf8"));
      first.ptsTicks = String(BigInt(first.ptsTicks) + 1n);
      writeFileSync(target, Buffer.concat([Buffer.from(JSON.stringify(stableValue(first)) + "\n", "utf8"), bytes.subarray(firstNewline + 1)]));
      runFail(mirrorCompileArgs(path.join(tempRoot, "candidate-mirror-decoder")), "repoMirrorSubstitution:decoder",
        expectedFailure("decoder_binding_drift"), { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "auditor");
      const target = path.join(mirror.root, path.relative(ROOT, AUDITOR));
      writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("\n// substituted auditor\n", "utf8")]));
      const actual = sha256(readFileSync(target));
      runFail(mirrorCompileArgs(path.join(tempRoot, "candidate-mirror-auditor")), "repoMirrorSubstitution:auditor",
        expectedFailure("dependency_byte_drift", "dependency_byte_drift:label_auditor:" + actual), { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "compiler");
      const target = mirror.cli;
      writeFileSync(target, Buffer.concat([readFileSync(target), Buffer.from("\n// substituted compiler\n", "utf8")]));
      const digest = normalizedCompilerDigest(readFileSync(target));
      runFail(mirrorCompileArgs(path.join(tempRoot, "candidate-mirror-compiler")), "repoMirrorSubstitution:compiler",
        expectedFailure("manual_compiler_loaded_bytes_drift", "manual_compiler_loaded_bytes_drift:" + digest.embedded + ":" + digest.digest + ":" + digest.embedded), { cli: mirror.cli });
    }

    const assertAdjudicationAttack = function (name, expected, mutate) {
      const attacked = deepClone(adjudication);
      mutate(attacked);
      const sealed = withSelfHash(attacked);
      const attackedPath = path.join(tempRoot, "adjudication-" + name + ".json");
      writeFileSync(attackedPath, pretty(sealed), { flag: "wx", mode: 0o600 });
      runFail([
        "compile",
        "--review-a", reviewAPath,
        "--review-b", reviewBPath,
        "--adjudication", attackedPath,
        "--output-dir", path.join(tempRoot, "candidate-attack-" + name),
      ], "adjudicationAttack:" + name, expected);
    };
    assertAdjudicationAttack("missing-decision", expectedFailure("adjudication_decision_set_drift"), function (value) { value.decisions.pop(); });
    assertAdjudicationAttack("review-a-hash", expectedFailure("adjudication_review_binding", "adjudication_review_binding:reviewACanonicalSha256"), function (value) { value.reviewACanonicalSha256 = "f".repeat(64); });
    assertAdjudicationAttack("review-a-byte", expectedFailure("adjudication_review_binding", "adjudication_review_binding:reviewAByteSha256"), function (value) { value.reviewAByteSha256 = "f".repeat(64); });
    assertAdjudicationAttack("review-a-pseudonym", expectedFailure("adjudication_review_binding", "adjudication_review_binding:reviewAPseudonymSha256"), function (value) { value.reviewAPseudonymSha256 = "f".repeat(64); });
    assertAdjudicationAttack("adjudicator-alias", expectedFailure("sealed_actor_alias"), function (value) { value.adjudicatorPseudonymSha256 = reviewerA; });
    assertAdjudicationAttack("extra-decision", expectedFailure("adjudication_decision_set_drift"), function (value) {
      value.decisions.push({
        path: "/clips/csi-pose/segments/51-60/scenarios",
        valueType: "scenario-array",
        value: ["neutral"],
      });
      value.decisions.sort(function (left, right) { return compareBytes(left.path, right.path); });
    });
    assertAdjudicationAttack("path-order", expectedFailure("adjudication_path_order", "adjudication_path_order:disagreements"), function (value) {
      value.disagreements.reverse();
      value.decisions.reverse();
    });
    assertAdjudicationAttack("value-type", expectedFailure("schema_validation", "schema_validation:adjudication/decisions/0:oneOf:0"), function (value) {
      value.decisions[0].valueType = value.decisions[0].valueType === "presence" ? "person-state" : "presence";
    });

    const hardlinkPath = path.join(tempRoot, "review-a-hardlink.json");
    linkSync(reviewAPath, hardlinkPath);
    runFail(["validate-review", "--review", hardlinkPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "hardlinkReview",
      expectedFailure("artifact_link_count", "artifact_link_count:review:2"));
    rmSync(hardlinkPath);
    const symlinkPath = path.join(tempRoot, "review-a-symlink.json");
    symlinkSync(reviewAPath, symlinkPath);
    runFail(["validate-review", "--review", symlinkPath, "--expected-role", "first", "--expected-reviewer-pseudonym-sha256", reviewerA], "symlinkReview",
      expectedFailure("artifact_not_plain_regular", "artifact_not_plain_regular:review"));
    rmSync(symlinkPath);
    runFail([
      "compile",
      "--review-a", reviewAPath,
      "--review-b", reviewAPath,
      "--adjudication", adjudicationPath,
      "--output-dir", path.join(tempRoot, "candidate-review-alias"),
    ], "sameReviewPathAlias", expectedFailure("sealed_input_alias_realpath", "sealed_input_alias_realpath:reviewB"));
    const actorAliasReview = deepClone(reviewB);
    actorAliasReview.reviewerPseudonymSha256 = reviewerA;
    const actorAliasPath = path.join(tempRoot, "review-b-actor-alias.json");
    writeFileSync(actorAliasPath, pretty(withSelfHash(actorAliasReview)), { flag: "wx", mode: 0o600 });
    runFail([
      "compile",
      "--review-a", reviewAPath,
      "--review-b", actorAliasPath,
      "--adjudication", adjudicationPath,
      "--output-dir", path.join(tempRoot, "candidate-actor-alias"),
    ], "reviewerActorAlias", expectedFailure("reviewer_pseudonyms_not_distinct"));

    assertAdjudicationAttack("adjudicator-alias-b", expectedFailure("sealed_actor_alias"), function (value) {
      value.adjudicatorPseudonymSha256 = reviewerB;
    });
    const sealedAliasCases = [
      ["a-adjudication-realpath", reviewAPath, reviewBPath, reviewAPath, "sealed_input_alias_realpath:adjudication"],
      ["b-adjudication-realpath", reviewAPath, reviewBPath, reviewBPath, "sealed_input_alias_realpath:adjudication"],
    ];
    for (const [name, aPath, bPath, adjPath, detail] of sealedAliasCases) {
      runFail([
        "compile", "--review-a", aPath, "--review-b", bPath, "--adjudication", adjPath,
        "--output-dir", path.join(tempRoot, "candidate-alias-" + name),
      ], "sealedRealpathAlias:" + name, expectedFailure("sealed_input_alias_realpath", detail));
    }
    for (const [name, sourcePath, flag, label] of [
      ["review-b", reviewBPath, "--review-b", "review_b"],
      ["adjudication", adjudicationPath, "--adjudication", "adjudication"],
    ]) {
      const symlinkAlias = path.join(tempRoot, name + "-symlink.json");
      symlinkSync(sourcePath, symlinkAlias);
      const symlinkArgs = ["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", path.join(tempRoot, "candidate-" + name + "-symlink")];
      symlinkArgs[symlinkArgs.indexOf(flag) + 1] = symlinkAlias;
      runFail(symlinkArgs, "sealedSymlink:" + name,
        expectedFailure("artifact_not_plain_regular", "artifact_not_plain_regular:" + label));
      rmSync(symlinkAlias);

      const hardlinkAlias = path.join(tempRoot, name + "-hardlink.json");
      linkSync(sourcePath, hardlinkAlias);
      const hardlinkArgs = ["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", path.join(tempRoot, "candidate-" + name + "-hardlink")];
      hardlinkArgs[hardlinkArgs.indexOf(flag) + 1] = hardlinkAlias;
      runFail(hardlinkArgs, "sealedHardlink:" + name,
        expectedFailure("artifact_link_count", "artifact_link_count:" + label + ":2"));
      rmSync(hardlinkAlias);
    }
    for (const [name, bytes, flag] of [
      ["a-b", reviewABytes, "--review-b"],
      ["a-adjudication", reviewABytes, "--adjudication"],
      ["b-adjudication", reviewBBytes, "--adjudication"],
    ]) {
      const byteAliasPath = path.join(tempRoot, "sealed-byte-alias-" + name + ".json");
      writeFileSync(byteAliasPath, bytes, { flag: "wx", mode: 0o600 });
      const byteAliasArgs = ["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", path.join(tempRoot, "candidate-byte-alias-" + name)];
      byteAliasArgs[byteAliasArgs.indexOf(flag) + 1] = byteAliasPath;
      runFail(byteAliasArgs, "sealedByteAlias:" + name, expectedFailure("sealed_byte_alias"));
    }

    const candidateA = path.join(tempRoot, "candidate-a");
    const candidateB = path.join(tempRoot, "candidate-b");
    const compileArgs = function (output) {
      return ["compile", "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath, "--output-dir", output];
    };
    const relativeCreateFaultEnv = function (fault) {
      return {
        ...process.env,
        NODE_ENV: "test",
        SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
        SAM_GOAL_MANUAL_PACK_V3_FAULT_RELATIVE_CREATE: fault,
      };
    };
    const runtimeFaultEnv = function (name, value = "1") {
      return {
        ...process.env,
        NODE_ENV: "test",
        SAM_GOAL_MANUAL_PACK_V3_RUNTIME_TEST: "1",
        [name]: value,
      };
    };
    const relativeCreateDirectoryFailure = expectedFailure("relative_create_failed", "relative_create_failed:directory:RuntimeError:injected_relative_create_failure");
    const relativeCreateFileFailure = expectedFailure("relative_create_failed", "relative_create_failed:file:RuntimeError:injected_relative_create_failure");
    runFail(compileArgs(path.join(tempRoot, "candidate-fault-relative-create-stage")), "relativeCreateRollback:compile-stage",
      relativeCreateDirectoryFailure, { env: relativeCreateFaultEnv("compile_stage") });
    runFail(compileArgs(path.join(tempRoot, "candidate-fault-stage-writer")), "spontaneousHelper:compile-stage-writer",
      expectedFailure("stage_writer_failed", "stage_writer_failed:injected_stage_writer_failure"), {
        env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_STAGE_WRITER", "compile"),
      });
    runFail(compileArgs(path.join(tempRoot, "candidate-fault-candidate-auditor")), "spontaneousHelper:candidate-auditor",
      expectedFailure("auditor_child_failed", "auditor_child_failed:candidate:injected_auditor_child_failure"), {
        env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_CANDIDATE_AUDITOR"),
      });
    {
      const output = path.join(tempRoot, "candidate-fault-rename-helper");
      runFail(compileArgs(output), "spontaneousHelper:rename",
        expectedFailure("rename_excl_failed", "rename_excl_failed:" + output + ":injected_rename_helper_failure:"), {
          env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_RENAME_HELPER"),
        });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "self-snapshot-swap");
      const originalCompiler = readFileSync(mirror.cli);
      const h1 = normalizedCompilerDigest(originalCompiler).embedded;
      const alternate = selfConsistentCompilerVariant(originalCompiler, "post-loader self-consistent swap");
      const output = path.join(tempRoot, "candidate-self-snapshot-swap");
      await runMutationBarrier(mirrorCompileArgs(output), tempRoot, "compile", "self_snapshot", "compiler-post-loader-self-consistent-swap",
        expectedFailure("manual_compiler_loaded_bytes_drift", "manual_compiler_loaded_bytes_drift:" + alternate.digest + ":" + alternate.digest + ":" + h1),
        function () {
          const backup = mirror.cli + ".self-snapshot.original";
          renameSync(mirror.cli, backup);
          writeFileSync(mirror.cli, alternate.buffer, { flag: "wx", mode: 0o700 });
          return function () {
            rmSync(mirror.cli, { force: true });
            renameSync(backup, mirror.cli);
          };
        }, [mirror.cli, output], { cli: mirror.cli });
    }
    const raceInputsRoot = path.join(tempRoot, "race-inputs");
    const raceReviewADir = path.join(raceInputsRoot, "review-a");
    const raceReviewBDir = path.join(raceInputsRoot, "review-b");
    const raceAdjudicationDir = path.join(raceInputsRoot, "adjudication");
    for (const directory of [raceReviewADir, raceReviewBDir, raceAdjudicationDir]) mkdirSync(directory, { recursive: true, mode: 0o700 });
    const raceReviewAPath = path.join(raceReviewADir, "review.json");
    const raceReviewBPath = path.join(raceReviewBDir, "review.json");
    const raceAdjudicationPath = path.join(raceAdjudicationDir, "adjudication.json");
    writeFileSync(raceReviewAPath, reviewABytes, { flag: "wx", mode: 0o600 });
    writeFileSync(raceReviewBPath, reviewBBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(raceAdjudicationPath, adjudicationBytes, { flag: "wx", mode: 0o600 });
    const raceCompileArgs = function (output) {
      return ["compile", "--review-a", raceReviewAPath, "--review-b", raceReviewBPath, "--adjudication", raceAdjudicationPath, "--output-dir", output];
    };
    for (const [name, target, expected] of [
      ["compile-review-b-final", raceReviewBPath, expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB")],
      ["compile-adjudication-final", raceAdjudicationPath, expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_adjudication")],
    ]) {
      const output = path.join(tempRoot, "candidate-" + name);
      await runMutationBarrier(raceCompileArgs(output), tempRoot, "compile", "sealed_inputs_revalidate", name, expected,
        function () { return replaceFileMutation(target, name); }, [target, output]);
    }
    for (const [name, ancestor, expectedLabel] of [
      ["compile-review-b-ancestor", raceReviewBDir, "sealed_reviewB"],
      ["compile-adjudication-ancestor", raceAdjudicationDir, "sealed_adjudication"],
    ]) {
      const output = path.join(tempRoot, "candidate-" + name);
      await runMutationBarrier(raceCompileArgs(output), tempRoot, "compile", "sealed_inputs_revalidate", name,
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:" + expectedLabel + ":" + ancestor),
        function () { return replaceAncestorMutation(ancestor, name); }, [ancestor, output]);
    }
    if (compilerSource.includes('testBarrier("context_revalidate_early"')) {
    {
      const mirror = makeRepoMirror(tempRoot, "toctou-dependency-final");
      const target = path.join(mirror.root, path.relative(ROOT, PATHS.teacherPolicy));
      const output = path.join(tempRoot, "candidate-toctou-dependency-final");
      await runMutationBarrier(mirrorCompileArgs(output), tempRoot, "compile", "context_revalidate_early", "compile-dependency-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:dependency_teacherPolicy"),
        function () { return replaceFileMutation(target, "dependency-final"); }, [target, output], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "toctou-dependency-ancestor");
      const ancestor = path.join(mirror.root, "tests/fixtures/sam-goal-v2/evaluation-v3");
      const output = path.join(tempRoot, "candidate-toctou-dependency-ancestor");
      await runMutationBarrier(mirrorCompileArgs(output), tempRoot, "compile", "context_revalidate_early", "compile-dependency-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:dependency_evaluationContract:" + ancestor),
        function () { return replaceAncestorMutation(ancestor, "dependency-ancestor"); }, [ancestor, output], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "toctou-tool-final");
      const target = path.join(mirror.root, path.relative(ROOT, AUDITOR));
      const output = path.join(tempRoot, "candidate-toctou-tool-final");
      await runMutationBarrier(mirrorCompileArgs(output), tempRoot, "compile", "context_revalidate_early", "compile-tool-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:tool_labelAuditor"),
        function () { return replaceFileMutation(target, "tool-final"); }, [target, output], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "toctou-tool-ancestor");
      const ancestor = path.join(mirror.root, "scripts");
      const output = path.join(tempRoot, "candidate-toctou-tool-ancestor");
      await runMutationBarrier(mirrorCompileArgs(output), tempRoot, "compile", "context_revalidate_early", "compile-tool-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:tool_manualCompiler:" + ancestor),
        function () { return replaceAncestorMutation(ancestor, "tool-ancestor"); }, [ancestor, output], { cli: mirror.cli });
    }
    }
    {
      const outputParent = path.join(tempRoot, "output-last-window-parent");
      mkdirSync(outputParent, { mode: 0o700 });
      const output = path.join(outputParent, "candidate");
      await runMutationBarrier(compileArgs(output), tempRoot, "compile", "output_parent_last_window", "compile-output-parent-last-window",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:output_dir:" + outputParent),
        function () {
          let marker;
          let markerState;
          const restore = replaceAncestorMutation(outputParent, "last-window", function (replacement) {
            marker = path.join(replacement, "competitor.txt");
            writeFileSync(marker, "competitor\n", { flag: "wx", mode: 0o600 });
            markerState = pathState(marker);
          });
          return function () {
            assert.deepEqual(pathState(marker), markerState, "output parent competitor changed");
            restore();
          };
        }, [output]);
    }
    {
      const output = path.join(tempRoot, "candidate-last-window-sealed-mutation");
      await runMutationBarrier(raceCompileArgs(output), tempRoot, "compile", "output_parent_last_window", "compile-last-window-sealed-input",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB"),
        function () { return replaceFileMutation(raceReviewBPath, "compile-last-window-sealed"); }, [raceReviewBPath, output]);
    }
    {
      const output = path.join(tempRoot, "candidate-last-window-stage-mutation");
      await runMutationBarrier(compileArgs(output), tempRoot, "compile", "output_parent_last_window", "compile-last-window-staged-file",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:compiled_manual-labels.jsonl"),
        function () {
          const stage = onlyTransactionalSibling(output, ".tmp-");
          return mutateOwnedFile(path.join(stage, "manual-labels.jsonl"), "last-window staged mutation");
        }, [output]);
    }
    {
      const output = path.join(tempRoot, "candidate-post-rename-sealed-mutation");
      await runMutationBarrier(raceCompileArgs(output), tempRoot, "compile", "compile_post_rename", "compile-post-rename-sealed-input",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB"),
        function () { return replaceFileMutation(raceReviewBPath, "compile-post-rename-sealed"); }, [raceReviewBPath, output]);
    }
    {
      const output = path.join(tempRoot, "candidate-post-rename-committed-mutation");
      await runMutationBarrier(compileArgs(output), tempRoot, "compile", "compile_post_rename", "compile-post-rename-committed-file",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:compiled_manual-labels.jsonl"),
        function () { return mutateOwnedFile(path.join(output, "manual-labels.jsonl"), "post-rename committed mutation"); }, [output]);
    }
    const ancestorDir = path.join(tempRoot, "sealed-ancestor");
    mkdirSync(ancestorDir, { mode: 0o700 });
    const ancestorReviewPath = path.join(ancestorDir, "review-a.json");
    writeFileSync(ancestorReviewPath, reviewABytes, { flag: "wx", mode: 0o600 });
    const ancestorOutput = path.join(tempRoot, "candidate-ancestor-replacement");
    await runAncestorReplacement([
      "compile",
      "--review-a", ancestorReviewPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
      "--output-dir", ancestorOutput,
    ], ancestorOutput, ancestorDir, reviewABytes, tempRoot);
    const finalReplacementOutput = path.join(tempRoot, "candidate-final-replacement");
    await runFinalReplacement([
      "compile",
      "--review-a", ancestorReviewPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
      "--output-dir", finalReplacementOutput,
    ], finalReplacementOutput, ancestorReviewPath, reviewABytes, tempRoot);
    const mutationOutput = path.join(tempRoot, "candidate-input-mutation");
    await runInputMutation(compileArgs(mutationOutput), mutationOutput, reviewAPath, reviewABytes, tempRoot);
    if (process.env.SAM_GOAL_TEST_SKIP_SLOW_SIGNALS !== "1") {
      for (const hook of ["compile_stage", "compile_stage_writer_child", "candidate_auditor_child", "rename_helper_child", "compile_post_rename"]) {
        for (const signal of ["SIGINT", "SIGTERM"]) {
          const output = path.join(tempRoot, "candidate-signal-" + hook + "-" + signal.toLowerCase());
          await runSignalledBarrier(compileArgs(output), tempRoot, "compile", hook, signal,
            [output, reviewAPath, reviewBPath, adjudicationPath]);
        }
      }
    }
    const compiledA = runOk(compileArgs(candidateA), metrics, "compileA");
    const shadowBin = path.join(tempRoot, "shadow-bin");
    mkdirSync(shadowBin, { mode: 0o700 });
    const shadowPython = path.join(shadowBin, "python3");
    writeFileSync(shadowPython, "#!/bin/sh\nexit 99\n", { flag: "wx", mode: 0o700 });
    chmodSync(shadowPython, 0o700);
    const compiledB = runOk(compileArgs(candidateB), metrics, "compileB", {
      env: { ...process.env, PATH: shadowBin + path.delimiter + process.env.PATH },
    });
    const ordinaryCompileKeys = [
      "status", "mode", "outputDir", "materializedRowsPerPass", "disagreementPaths", "adjudicatedRows",
      "candidateP0PackCanonicalSha256", "compiledArtifactSetSha256",
    ];
    assert.deepEqual(Object.keys(compiledA), ordinaryCompileKeys, "ordinary compile response shape drift");
    assert.equal(Object.hasOwn(compiledA, "finalSegmentTrace"), false, "ordinary compile exposed final-segment trace");
    const ordinaryStdoutCandidate = path.join(tempRoot, "candidate-ordinary-stdout-control");
    const ordinaryStdoutResult = runRaw(compileArgs(ordinaryStdoutCandidate), { env: finalSegmentTraceEnvironment() });
    assert.equal(ordinaryStdoutResult.status, 0,
      "ordinary compile stdout control failed\nstdout=" + ordinaryStdoutResult.stdout + "\nstderr=" + ordinaryStdoutResult.stderr);
    assert.deepEqual(Object.keys(ordinaryStdoutResult.report || {}), ordinaryCompileKeys,
      "ordinary compile stdout control response shape drift");
    assert.equal(Object.hasOwn(ordinaryStdoutResult.report, "finalSegmentTrace"), false,
      "ordinary compile stdout control exposed final-segment trace");
    assert.equal(ordinaryStdoutResult.stdout, JSON.stringify(ordinaryStdoutResult.report, null, 2) + "\n",
      "ordinary compile stdout byte framing drift");
    assert.deepEqual(
      { ...ordinaryStdoutResult.report, outputDir: compiledA.outputDir },
      compiledA,
      "ordinary compile response values changed with trace env absent",
    );
    incrementCounter(EXECUTION_EVIDENCE.successByMode, "compile");
    metrics.compileOrdinaryStdoutControl = {
      wallMs: Number(ordinaryStdoutResult.wallMs.toFixed(3)), peakRssKiB: ordinaryStdoutResult.peakRssKiB,
    };
    assert.equal(compiledA.candidateP0PackCanonicalSha256, compiledB.candidateP0PackCanonicalSha256);
    compareCandidates(candidateA, candidateB);
    const mapped = assertCompiledMapping(candidateA);
    assert.equal(mapped.manifest.expectedCanonicalHash, compiledA.candidateP0PackCanonicalSha256);

    const thirdWindowObject = {
      windowId: "overlay-a",
      clipId: "csi-pose",
      startFrameIndex: 650,
      endFrameIndexExclusive: 675,
      purposeTags: ["self_occlusion"],
      scenarioTags: ["self_occlusion"],
    };
    assert.ok(302 > 301 && 302 < 500 && 499 > 301 && 499 < 500, "shared third boundaries are not inside the A/B union segment");
    assert.ok(thirdWindowObject.startFrameIndex > 600 && thirdWindowObject.endFrameIndexExclusive < 700,
      "window-or-null third boundaries are not child boundaries inside the A interval");
    const thirdWindowVariant = windowDecisionAdjudication(adjudication, reviewA.windows, {
      sharedStart: 302,
      sharedEnd: 499,
      overlayA: thirdWindowObject,
    });
    const thirdWindowAdjudicationPath = path.join(tempRoot, "adjudication-third-window-boundaries.json");
    writeFileSync(thirdWindowAdjudicationPath, pretty(thirdWindowVariant.adjudication), { flag: "wx", mode: 0o600 });
    const thirdWindowCandidate = path.join(tempRoot, "candidate-third-window-boundaries");
    const thirdWindowCandidateRepeat = path.join(tempRoot, "candidate-third-window-boundaries-repeat");
    const compileThirdWindow = function (output) {
      return [
        "compile", "--review-a", reviewAPath, "--review-b", reviewBPath,
        "--adjudication", thirdWindowAdjudicationPath, "--output-dir", output,
      ];
    };
    const traceEnabledEnv = finalSegmentTraceEnvironment({ nodeEnv: "test", runtimeTest: "1", trace: "1" });
    const thirdWindowOracle = independentFinalSegmentOracle(reviewA, reviewB, thirdWindowVariant.adjudication);
    assertIndependentOracleBoundaries(thirdWindowOracle, [
      ["csi-pose", 302], ["csi-pose", 499], ["csi-pose", 650], ["csi-pose", 675],
    ], "third-window oracle");
    const thirdWindowCompiled = runOk(compileThirdWindow(thirdWindowCandidate), metrics, "compileThirdWindowBoundaries", {
      env: traceEnabledEnv,
    });
    const thirdWindowRepeated = runOk(compileThirdWindow(thirdWindowCandidateRepeat), metrics, "compileThirdWindowBoundariesRepeat", {
      env: traceEnabledEnv,
    });
    assertIndependentFinalSegmentTrace(thirdWindowCompiled, thirdWindowOracle, "third-window compile");
    assertIndependentFinalSegmentTrace(thirdWindowRepeated, thirdWindowOracle, "third-window repeat");
    assert.deepEqual(thirdWindowRepeated.finalSegmentTrace, thirdWindowCompiled.finalSegmentTrace,
      "third-window trace repeat determinism drift");
    assert.equal(thirdWindowCompiled.candidateP0PackCanonicalSha256, thirdWindowRepeated.candidateP0PackCanonicalSha256);
    compareCandidates(thirdWindowCandidate, thirdWindowCandidateRepeat);
    assertFinalWindowMembership(thirdWindowCandidate, thirdWindowVariant.finalWindows, [302, 499, 650, 675]);
    assertTraceMaterialAbsent(EXPECTED_FILES.map(function (name) { return path.join(thirdWindowCandidate, name); }),
      thirdWindowCompiled.finalSegmentTrace, "third-window candidate");

    const alignedThirdWindow = {
      windowId: "overlay-a",
      clipId: "csi-pose",
      startFrameIndex: 600,
      endFrameIndexExclusive: 700,
      purposeTags: ["turning"],
      scenarioTags: ["turn"],
    };
    const alignedWindowVariant = windowDecisionAdjudication(adjudication, reviewA.windows, { overlayA: alignedThirdWindow });
    const alignedWindowAdjudicationPath = path.join(tempRoot, "adjudication-aligned-window-control.json");
    writeFileSync(alignedWindowAdjudicationPath, pretty(alignedWindowVariant.adjudication), { flag: "wx", mode: 0o600 });
    const alignedWindowCandidate = path.join(tempRoot, "candidate-aligned-window-control");
    const alignedWindowOracle = independentFinalSegmentOracle(reviewA, reviewB, alignedWindowVariant.adjudication);
    for (const boundary of [600, 700]) {
      assert.ok(alignedWindowOracle.originSegments.some(function (segment) {
        return segment.clipId === "csi-pose"
          && (segment.originStart === boundary || segment.originEnd === boundary);
      }), "aligned-window oracle boundary is not an A/B-union origin boundary: csi-pose:" + boundary);
    }
    const alignedWindowCompiled = runOk([
      "compile", "--review-a", reviewAPath, "--review-b", reviewBPath,
      "--adjudication", alignedWindowAdjudicationPath, "--output-dir", alignedWindowCandidate,
    ], metrics, "compileAlignedWindowControl", { env: traceEnabledEnv });
    assertIndependentFinalSegmentTrace(alignedWindowCompiled, alignedWindowOracle, "aligned-window control");
    assertFinalWindowMembership(alignedWindowCandidate, alignedWindowVariant.finalWindows, [600, 700]);
    assertTraceMaterialAbsent(EXPECTED_FILES.map(function (name) { return path.join(alignedWindowCandidate, name); }),
      alignedWindowCompiled.finalSegmentTrace, "aligned-window candidate");

    const thirdWindowTraceAnchor = path.join(tempRoot, "p0-anchor-third-window-trace.json");
    const thirdWindowTraceAnchorCreated = runOk([
      "create-anchor", "--anchor", thirdWindowTraceAnchor, "--label-dir", thirdWindowCandidate,
      "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", thirdWindowAdjudicationPath,
    ], metrics, "createThirdWindowTraceAnchor", { env: finalSegmentTraceEnvironment() });
    assert.equal(Object.hasOwn(thirdWindowTraceAnchorCreated, "finalSegmentTrace"), false,
      "ordinary create-anchor exposed final-segment trace");
    const thirdWindowTraceAnchorVerified = runOk([
      "verify-anchor", "--anchor", thirdWindowTraceAnchor,
      "--expected-p0-anchor-sha256", thirdWindowTraceAnchorCreated.anchorCanonicalSha256,
      "--label-dir", thirdWindowCandidate, "--review-a", reviewAPath, "--review-b", reviewBPath,
      "--adjudication", thirdWindowAdjudicationPath,
    ], metrics, "verifyThirdWindowTraceAnchor", { env: finalSegmentTraceEnvironment() });
    assert.equal(Object.hasOwn(thirdWindowTraceAnchorVerified, "finalSegmentTrace"), false,
      "ordinary verify-anchor exposed final-segment trace");
    assertTraceMaterialAbsent([
      ...EXPECTED_FILES.map(function (name) { return path.join(thirdWindowCandidate, name); }),
      thirdWindowTraceAnchor,
    ], thirdWindowCompiled.finalSegmentTrace, "third-window candidate and external anchor");

    const zeroReviewB = deepClone(reviewA);
    zeroReviewB.role = "second";
    zeroReviewB.reviewerPseudonymSha256 = reviewerB;
    zeroReviewB.windows.reverse();
    const sealedZeroReviewB = withSelfHash(zeroReviewB);
    const zeroReviewBBytes = pretty(sealedZeroReviewB);
    const zeroReviewBPath = path.join(tempRoot, "review-b-zero.json");
    writeFileSync(zeroReviewBPath, zeroReviewBBytes, { flag: "wx", mode: 0o600 });
    const zeroAdjudication = makeAdjudication(reviewA, reviewABytes, sealedZeroReviewB, zeroReviewBBytes, adjudicator);
    assert.equal(zeroAdjudication.disagreements.length, 0);
    assert.equal(zeroAdjudication.decisions.length, 0);
    const zeroAdjudicationPath = path.join(tempRoot, "adjudication-zero.json");
    writeFileSync(zeroAdjudicationPath, pretty(zeroAdjudication), { flag: "wx", mode: 0o600 });
    const zeroCandidate = path.join(tempRoot, "candidate-zero-disagreement");
    runOk([
      "compile",
      "--review-a", reviewAPath,
      "--review-b", zeroReviewBPath,
      "--adjudication", zeroAdjudicationPath,
      "--output-dir", zeroCandidate,
    ], metrics, "compileZeroDisagreement");
    assert.equal(readFileSync(path.join(zeroCandidate, "manual-adjudication.jsonl")).length, 0);
    const racedCandidate = path.join(tempRoot, "candidate-race");
    await runDestinationRace(compileArgs(racedCandidate), racedCandidate, tempRoot);
    runFail(compileArgs(candidateA), "existingDestination",
      expectedFailure("output_dir_exists", "output_dir_exists:" + candidateA));

    const anchorPath = path.join(tempRoot, "p0-anchor.json");
    const commonAnchorArgs = [
      "--anchor", anchorPath,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ];
    runFail(["create-anchor", ...commonAnchorArgs], "relativeCreateRollback:anchor-recompile-stage",
      relativeCreateDirectoryFailure, { env: relativeCreateFaultEnv("anchor_recompile_stage") });
    runFail(["create-anchor", ...commonAnchorArgs], "relativeCreateRollback:anchor-temp",
      relativeCreateFileFailure, { env: relativeCreateFaultEnv("anchor_temp") });
    {
      const faultAnchor = path.join(tempRoot, "anchor-fault-stage-writer.json");
      runFail([
        "create-anchor", "--anchor", faultAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], "spontaneousHelper:anchor-stage-writer",
      expectedFailure("stage_writer_failed", "stage_writer_failed:injected_stage_writer_failure"), {
        env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_STAGE_WRITER", "anchor"),
      });
    }
    {
      const faultAnchor = path.join(tempRoot, "anchor-fault-candidate-auditor.json");
      runFail([
        "create-anchor", "--anchor", faultAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], "spontaneousHelper:anchor-candidate-auditor",
      expectedFailure("auditor_child_failed", "auditor_child_failed:anchor_candidate:injected_auditor_child_failure"), {
        env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_CANDIDATE_AUDITOR"),
      });
    }
    {
      const faultAnchor = path.join(tempRoot, "anchor-fault-link-helper.json");
      runFail([
        "create-anchor", "--anchor", faultAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], "spontaneousHelper:anchor-link",
      expectedFailure("anchor_link_failed", "anchor_link_failed:" + faultAnchor + ":injected_anchor_link_helper_failure:"), {
        env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_ANCHOR_LINK_HELPER"),
      });
    }
    if (process.env.SAM_GOAL_TEST_SKIP_SLOW_SIGNALS !== "1") {
      for (const hook of ["anchor_recompile_stage", "anchor_stage_writer_child", "anchor_candidate_auditor_child", "anchor_pre_link", "anchor_link_helper_child", "anchor_post_link"]) {
        for (const signal of ["SIGINT", "SIGTERM"]) {
          const signalAnchor = path.join(tempRoot, "anchor-signal-" + hook + "-" + signal.toLowerCase() + ".json");
          await runSignalledBarrier([
            "create-anchor", "--anchor", signalAnchor, "--label-dir", candidateA,
            "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
          ], tempRoot, "create-anchor", hook, signal,
          [signalAnchor, candidateA, reviewAPath, reviewBPath, adjudicationPath]);
        }
      }
    }
    {
      const anchorParent = path.join(tempRoot, "anchor-last-window-parent");
      mkdirSync(anchorParent, { mode: 0o700 });
      const racedAnchor = path.join(anchorParent, "p0-anchor.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", racedAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], tempRoot, "create-anchor", "anchor_parent_last_window", "create-anchor-parent-last-window",
      expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:anchor:" + anchorParent),
      function () {
        let marker;
        let markerState;
        const restore = replaceAncestorMutation(anchorParent, "last-window", function (replacement) {
          marker = path.join(replacement, "competitor.txt");
          writeFileSync(marker, "competitor\n", { flag: "wx", mode: 0o600 });
          markerState = pathState(marker);
        });
        return function () {
          assert.deepEqual(pathState(marker), markerState, "anchor parent competitor changed");
          restore();
        };
      }, [racedAnchor, candidateA]);
    }
    {
      const attackedAnchor = path.join(tempRoot, "anchor-pre-link-temp-mutation.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], tempRoot, "create-anchor", "anchor_pre_link", "anchor-pre-link-temp-bytes",
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:anchor_temp"),
      function () {
        const temp = onlyTransactionalSibling(attackedAnchor, ".tmp-");
        return mutateOwnedFile(temp, "anchor pre-link temp mutation");
      }, [attackedAnchor]);
    }
    {
      const attackedAnchor = path.join(tempRoot, "anchor-pre-link-sealed-mutation.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", raceReviewAPath, "--review-b", raceReviewBPath, "--adjudication", raceAdjudicationPath,
      ], tempRoot, "create-anchor", "anchor_pre_link", "anchor-pre-link-sealed-input",
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB"),
      function () { return replaceFileMutation(raceReviewBPath, "anchor-pre-link-sealed"); }, [raceReviewBPath, attackedAnchor]);
    }
    {
      const attackedAnchor = path.join(tempRoot, "anchor-post-link-committed-mutation.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], tempRoot, "create-anchor", "anchor_post_link", "anchor-post-link-actual-bytes",
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:anchor_committed"),
      function () { return mutateOwnedFile(attackedAnchor, "anchor post-link actual mutation"); }, [attackedAnchor]);
    }
    {
      const attackedAnchor = path.join(tempRoot, "anchor-post-link-pack-mutation.json");
      const packTarget = path.join(candidateA, "manual-policy.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], tempRoot, "create-anchor", "anchor_post_link", "anchor-post-link-pack",
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:compiled_manual-policy.json"),
      function () { return replaceFileMutation(packTarget, "anchor-post-link-pack"); }, [packTarget, attackedAnchor]);
    }
    {
      const attackedAnchor = path.join(tempRoot, "anchor-post-link-sealed-mutation.json");
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", raceReviewAPath, "--review-b", raceReviewBPath, "--adjudication", raceAdjudicationPath,
      ], tempRoot, "create-anchor", "anchor_post_link", "anchor-post-link-sealed",
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB"),
      function () { return replaceFileMutation(raceReviewBPath, "anchor-post-link-sealed"); }, [raceReviewBPath, attackedAnchor]);
    }
    {
      const name = "anchor-post-link-context";
      const attackedAnchor = path.join(tempRoot, "anchor-post-link-context-mutation.json");
      const token = ["create-anchor", "anchor_post_link", name].join("-").toLowerCase().replaceAll("_", "-");
      const trigger = controlReadyPath(tempRoot, "mutation-" + token);
      const preload = path.join(tempRoot, "anchor-post-link-context-preload.cjs");
      writeFileSync(preload, statIdentityFaultPreloadSource(PATHS.teacherPolicy, trigger), { flag: "wx", mode: 0o600 });
      await runMutationBarrier([
        "create-anchor", "--anchor", attackedAnchor, "--label-dir", candidateA,
        "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
      ], tempRoot, "create-anchor", "anchor_post_link", name,
      expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:dependency_teacherPolicy"),
      function () { return function () {}; }, [PATHS.teacherPolicy, attackedAnchor], {
        env: { NODE_OPTIONS: [process.env.NODE_OPTIONS || "", "--require=" + preload].filter(Boolean).join(" ") },
      });
    }
    const created = runOk(["create-anchor", ...commonAnchorArgs], metrics, "createAnchor");
    assert.equal(Object.hasOwn(created, "finalSegmentTrace"), false, "ordinary create-anchor response exposed final-segment trace");
    assert.equal(created.candidateP0PackCanonicalSha256, compiledA.candidateP0PackCanonicalSha256);
    const anchorValue = readJson(anchorPath);
    assert.equal(anchorValue.schemaVersion, 2);
    assert.equal(anchorValue.candidateP0PackCanonicalSha256, compiledA.candidateP0PackCanonicalSha256);
    assert.equal(anchorValue.expectedCanonicalHash, canonicalHash(anchorValue, true));
    assert.deepEqual(anchorValue.compiledArtifacts.map(function (entry) { return entry.path; }), EXPECTED_FILES);
    assert.equal(Object.keys(anchorValue.dependencies).length, 13);
    assert.deepEqual(anchorValue.sealedInputs.reviewA, {
      role: "first",
      logicalPath: "sealed/review-a.json",
      actorPseudonymSha256: reviewerA,
      byteSha256: sha256(reviewABytes),
    });
    assert.deepEqual(anchorValue.sealedInputs.reviewB, {
      role: "second",
      logicalPath: "sealed/review-b.json",
      actorPseudonymSha256: reviewerB,
      byteSha256: sha256(reviewBBytes),
    });
    assert.deepEqual(anchorValue.sealedInputs.adjudication, {
      role: "adjudication",
      logicalPath: "sealed/adjudication.json",
      actorPseudonymSha256: adjudicator,
      byteSha256: sha256(adjudicationBytes),
    });
    assert.equal(readFileSync(anchorPath, "utf8").includes(tempRoot), false);
    const anchorStat = lstatSync(anchorPath);
    assert.equal(anchorStat.nlink, 1);
    for (const otherPath of [reviewAPath, reviewBPath, adjudicationPath, ...EXPECTED_FILES.map(function (name) { return path.join(candidateA, name); })]) {
      const other = lstatSync(otherPath);
      assert.equal(other.dev === anchorStat.dev && other.ino === anchorStat.ino, false, "anchor inode alias: " + otherPath);
    }
    const callerCanary = "CALLER_PATH_CANARY_MUST_NOT_PERSIST";
    const callerCanaryRoot = path.join(tempRoot, callerCanary);
    mkdirSync(callerCanaryRoot, { mode: 0o700 });
    const callerReviewA = path.join(callerCanaryRoot, "review-a.json");
    const callerReviewB = path.join(callerCanaryRoot, "review-b.json");
    const callerAdjudication = path.join(callerCanaryRoot, "adjudication.json");
    writeFileSync(callerReviewA, reviewABytes, { flag: "wx", mode: 0o600 });
    writeFileSync(callerReviewB, reviewBBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(callerAdjudication, adjudicationBytes, { flag: "wx", mode: 0o600 });
    const identicalAnchorPath = path.join(tempRoot, "p0-anchor-identical.json");
    const identicalCreated = runOk([
      "create-anchor", "--anchor", identicalAnchorPath, "--label-dir", candidateA,
      "--review-a", callerReviewA, "--review-b", callerReviewB, "--adjudication", callerAdjudication,
    ], metrics, "createIdenticalExternalAnchor");
    assert.equal(identicalCreated.anchorCanonicalSha256, created.anchorCanonicalSha256);
    assert.deepEqual(readFileSync(identicalAnchorPath), readFileSync(anchorPath), "caller path changed external anchor bytes");
    const durableBytes = Buffer.concat([...EXPECTED_FILES.map(function (name) { return readFileSync(path.join(candidateA, name)); }), readFileSync(anchorPath)]).toString("utf8");
    assert.equal(durableBytes.includes(callerCanary), false, "caller path canary persisted");
    const identicalAnchorStat = lstatSync(identicalAnchorPath);
    assert.equal(identicalAnchorStat.dev === anchorStat.dev && identicalAnchorStat.ino === anchorStat.ino, false, "two anchors share inode");

    const noOpenCwd = path.join(tempRoot, "logical-path-no-open-cwd");
    const logicalSealedDir = path.join(noOpenCwd, "sealed");
    mkdirSync(logicalSealedDir, { recursive: true, mode: 0o700 });
    writeFileSync(path.join(logicalSealedDir, "review-a.json"), "logical path canary\n", { flag: "wx", mode: 0o600 });
    const logicalNoOpenPreload = path.join(tempRoot, "logical-path-no-open.cjs");
    writeFileSync(logicalNoOpenPreload, [
      '"use strict";',
      'const fs=require("node:fs");',
      'const {syncBuiltinESMExports}=require("node:module");',
      'for(const name of ["openSync","readFileSync","lstatSync","statSync","realpathSync"]){const original=fs[name];fs[name]=function(input,...args){if(typeof input==="string"&&input.includes("sealed/review-a.json"))throw new Error("logical_path_opened:"+input);return original.call(this,input,...args);};}',
      'syncBuiltinESMExports();',
      '',
    ].join("\n"), { flag: "wx", mode: 0o600 });
    runOk([
      "verify-anchor", "--anchor", anchorPath, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA, "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
    ], metrics, "verifyLogicalPathNoOpen", {
      cwd: noOpenCwd,
      env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS || "", "--require=" + logicalNoOpenPreload].filter(Boolean).join(" ") },
    });
    const racedAnchorPath = path.join(tempRoot, "p0-anchor-race.json");
    await runAnchorRace([
      "create-anchor",
      "--anchor", racedAnchorPath,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], racedAnchorPath, tempRoot);
    runFail(["create-anchor", ...commonAnchorArgs], "existingAnchor",
      expectedFailure("anchor_exists", "anchor_exists:" + anchorPath));
    runFail([
      "create-anchor",
      "--anchor", path.join(candidateA, "inside-anchor.json"),
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "insidePackAnchor", expectedFailure("anchor_inside_label_dir"));
    const anchorSymlink = path.join(tempRoot, "p0-anchor-symlink.json");
    symlinkSync(anchorPath, anchorSymlink);
    runFail([
      "verify-anchor",
      "--anchor", anchorSymlink,
      "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "symlinkAnchor", expectedFailure("artifact_not_plain_regular", "artifact_not_plain_regular:p0_anchor"));
    rmSync(anchorSymlink);
    const anchorHardlink = path.join(tempRoot, "p0-anchor-hardlink.json");
    linkSync(anchorPath, anchorHardlink);
    runFail([
      "verify-anchor",
      "--anchor", anchorHardlink,
      "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "hardlinkAnchor", expectedFailure("artifact_link_count", "artifact_link_count:p0_anchor:2"));
    rmSync(anchorHardlink);
    const packAnchorAlias = path.join(tempRoot, "p0-anchor-pack-inode-alias.json");
    linkSync(path.join(candidateA, "evaluation-pack.json"), packAnchorAlias);
    runFail([
      "verify-anchor", "--anchor", packAnchorAlias, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA, "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
    ], "packAnchorInodeAlias",
    expectedFailure("artifact_link_count", "artifact_link_count:compiled_evaluation-pack.json:2"));
    rmSync(packAnchorAlias);
    runFail([
      "verify-anchor", "--anchor", anchorPath, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA, "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
    ], "spontaneousHelper:anchored-auditor",
    expectedFailure("auditor_child_failed", "auditor_child_failed:anchored:injected_auditor_child_failure"), {
      env: runtimeFaultEnv("SAM_GOAL_MANUAL_PACK_V3_FAULT_ANCHORED_AUDITOR"),
    });
    if (process.env.SAM_GOAL_TEST_SKIP_SLOW_SIGNALS !== "1") {
      for (const signal of ["SIGINT", "SIGTERM"]) {
        await runSignalledBarrier([
          "verify-anchor", "--anchor", anchorPath, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
          "--label-dir", candidateA, "--review-a", reviewAPath, "--review-b", reviewBPath, "--adjudication", adjudicationPath,
        ], tempRoot, "verify-anchor", "anchored_auditor_child", signal,
        [anchorPath, candidateA, reviewAPath, reviewBPath, adjudicationPath]);
      }
    }
    const verifyParentBefore = readdirSync(tempRoot).sort(compareBytes);
    const verified = runOk([
      "verify-anchor",
      "--anchor", anchorPath,
      "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], metrics, "verifyAnchor");
    assert.equal(Object.hasOwn(verified, "finalSegmentTrace"), false, "ordinary verify-anchor response exposed final-segment trace");
    const verifyParentAfter = readdirSync(tempRoot).sort(compareBytes);
    assert.deepEqual(verifyParentAfter, verifyParentBefore, "verify created temporary state");
    EXECUTION_EVIDENCE.residueAssertions += 1;
    assert.equal(verified.parentP0AnchorSha256, created.anchorCanonicalSha256);
    const relativeCwd = path.join(tempRoot, "nonrepo-relative-cwd");
    mkdirSync(relativeCwd, { mode: 0o700 });
    const relativePathFromCwd = function (filePath) { return path.relative(relativeCwd, filePath); };
    runOk([
      "validate-review", "--review", relativePathFromCwd(reviewAPath), "--expected-role", "first",
      "--expected-reviewer-pseudonym-sha256", reviewerA,
    ], metrics, "relativeValidateReview", { cwd: relativeCwd });
    const relativeCandidate = path.join(tempRoot, "candidate-relative-cwd");
    const relativeCompiled = runOk([
      "compile", "--review-a", relativePathFromCwd(reviewAPath), "--review-b", relativePathFromCwd(reviewBPath),
      "--adjudication", relativePathFromCwd(adjudicationPath), "--output-dir", relativePathFromCwd(relativeCandidate),
    ], metrics, "relativeCompile", { cwd: relativeCwd });
    assert.equal(relativeCompiled.candidateP0PackCanonicalSha256, compiledA.candidateP0PackCanonicalSha256);
    compareCandidates(candidateA, relativeCandidate);
    const relativeAnchor = path.join(tempRoot, "p0-anchor-relative-cwd.json");
    const relativeCreated = runOk([
      "create-anchor", "--anchor", relativePathFromCwd(relativeAnchor), "--label-dir", relativePathFromCwd(relativeCandidate),
      "--review-a", relativePathFromCwd(reviewAPath), "--review-b", relativePathFromCwd(reviewBPath), "--adjudication", relativePathFromCwd(adjudicationPath),
    ], metrics, "relativeCreateAnchor", { cwd: relativeCwd });
    assert.deepEqual(readFileSync(relativeAnchor), readFileSync(anchorPath));
    runOk([
      "verify-anchor", "--anchor", relativePathFromCwd(relativeAnchor), "--expected-p0-anchor-sha256", relativeCreated.anchorCanonicalSha256,
      "--label-dir", relativePathFromCwd(relativeCandidate), "--review-a", relativePathFromCwd(reviewAPath),
      "--review-b", relativePathFromCwd(reviewBPath), "--adjudication", relativePathFromCwd(adjudicationPath),
    ], metrics, "relativeVerifyAnchor", { cwd: relativeCwd });

    const alternateReviewB = deepClone(reviewB);
    const alternateClip = splitReviewIntervals(alternateReviewB, "csi-pose", [51, 52]);
    alternateClip.intervals.find(function (interval) {
      return interval.startFrameIndex === 51 && interval.endFrameIndexExclusive === 52;
    }).scenarios = ["turn"];
    const sealedAlternateReviewB = withSelfHash(alternateReviewB);
    const alternateReviewBBytes = pretty(sealedAlternateReviewB);
    const alternateReviewBPath = path.join(tempRoot, "review-b-alternate-valid.json");
    writeFileSync(alternateReviewBPath, alternateReviewBBytes, { flag: "wx", mode: 0o600 });
    const alternateAdjudication = makeAdjudication(reviewA, reviewABytes, sealedAlternateReviewB, alternateReviewBBytes, adjudicator);
    const alternateAdjudicationBytes = pretty(alternateAdjudication);
    const alternateAdjudicationPath = path.join(tempRoot, "adjudication-alternate-valid.json");
    writeFileSync(alternateAdjudicationPath, alternateAdjudicationBytes, { flag: "wx", mode: 0o600 });
    const alternateCandidate = path.join(tempRoot, "candidate-alternate-valid");
    const alternateCompiled = runOk([
      "compile", "--review-a", reviewAPath, "--review-b", alternateReviewBPath,
      "--adjudication", alternateAdjudicationPath, "--output-dir", alternateCandidate,
    ], metrics, "compileAlternateValidCandidate");
    assert.notEqual(alternateCompiled.candidateP0PackCanonicalSha256, compiledA.candidateP0PackCanonicalSha256);
    const alternateAnchor = path.join(tempRoot, "p0-anchor-alternate-valid.json");
    const alternateCreated = runOk([
      "create-anchor", "--anchor", alternateAnchor, "--label-dir", alternateCandidate,
      "--review-a", reviewAPath, "--review-b", alternateReviewBPath, "--adjudication", alternateAdjudicationPath,
    ], metrics, "createAlternateValidAnchor");
    assert.notEqual(alternateCreated.anchorCanonicalSha256, created.anchorCanonicalSha256);
    runFail([
      "verify-anchor", "--anchor", alternateAnchor, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", alternateCandidate, "--review-a", reviewAPath, "--review-b", alternateReviewBPath,
      "--adjudication", alternateAdjudicationPath,
    ], "alternateAnchorRejectedByFirstExpectedHash",
    expectedFailure("p0_anchor_expected_mismatch", "p0_anchor_expected_mismatch:" + created.anchorCanonicalSha256 + ":" + alternateCreated.anchorCanonicalSha256), {
      unchangedPaths: [reviewAPath, alternateReviewBPath, alternateAdjudicationPath, ...dependencyFiles, CLI, AUDITOR],
    });
    runOk([
      "verify-anchor", "--anchor", alternateAnchor, "--expected-p0-anchor-sha256", alternateCreated.anchorCanonicalSha256,
      "--label-dir", alternateCandidate, "--review-a", reviewAPath, "--review-b", alternateReviewBPath,
      "--adjudication", alternateAdjudicationPath,
    ], metrics, "verifyAlternateValidAnchor");
    const verifyArgs = function (anchor, labelDir, aPath = reviewAPath, bPath = reviewBPath, adjPath = adjudicationPath) {
      return [
        "verify-anchor", "--anchor", anchor, "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
        "--label-dir", labelDir, "--review-a", aPath, "--review-b", bPath, "--adjudication", adjPath,
      ];
    };
    for (const [name, target, expected] of [
      ["verify-review-b-final", raceReviewBPath, expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_reviewB")],
      ["verify-adjudication-final", raceAdjudicationPath, expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:sealed_adjudication")],
    ]) {
      await runMutationBarrier(verifyArgs(anchorPath, candidateA, raceReviewAPath, raceReviewBPath, raceAdjudicationPath), tempRoot,
        "verify-anchor", "sealed_inputs_revalidate", name, expected,
        function () { return replaceFileMutation(target, name); }, [target, anchorPath, candidateA]);
    }
    for (const [name, ancestor, expectedLabel] of [
      ["verify-review-b-ancestor", raceReviewBDir, "sealed_reviewB"],
      ["verify-adjudication-ancestor", raceAdjudicationDir, "sealed_adjudication"],
    ]) {
      await runMutationBarrier(verifyArgs(anchorPath, candidateA, raceReviewAPath, raceReviewBPath, raceAdjudicationPath), tempRoot,
        "verify-anchor", "sealed_inputs_revalidate", name,
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:" + expectedLabel + ":" + ancestor),
        function () { return replaceAncestorMutation(ancestor, name); }, [ancestor, anchorPath, candidateA]);
    }
    {
      const target = path.join(candidateA, "evaluation-pack.json");
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "pack_revalidate", "verify-pack-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:compiled_evaluation-pack.json"),
        function () { return replaceFileMutation(target, "verify-pack-final"); }, [target, anchorPath]);
    }
    {
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "label_dir_revalidate", "verify-label-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:label_dir:" + candidateA),
        function () { return replaceAncestorMutation(candidateA, "verify-label-ancestor"); }, [candidateA, anchorPath]);
    }
    {
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "verify_anchor_revalidate", "verify-anchor-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:p0_anchor"),
        function () { return replaceFileMutation(anchorPath, "verify-anchor-final"); }, [anchorPath, candidateA]);
    }
    {
      const anchorParent = path.join(tempRoot, "verify-anchor-ancestor-parent");
      mkdirSync(anchorParent, { mode: 0o700 });
      const isolatedAnchor = path.join(anchorParent, "p0-anchor.json");
      writeFileSync(isolatedAnchor, readFileSync(anchorPath), { flag: "wx", mode: 0o600 });
      await runMutationBarrier(verifyArgs(isolatedAnchor, candidateA), tempRoot, "verify-anchor", "verify_anchor_revalidate", "verify-anchor-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:p0_anchor:" + anchorParent),
        function () { return replaceAncestorMutation(anchorParent, "verify-anchor-ancestor"); }, [anchorParent, candidateA]);
    }
    if (compilerSource.includes('testBarrier("context_revalidate_early"')) {
    {
      const mirror = makeRepoMirror(tempRoot, "verify-toctou-dependency-final");
      const target = path.join(mirror.root, path.relative(ROOT, PATHS.teacherPolicy));
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "context_revalidate_early", "verify-dependency-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:dependency_teacherPolicy"),
        function () { return replaceFileMutation(target, "verify-dependency-final"); }, [target, anchorPath, candidateA], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "verify-toctou-dependency-ancestor");
      const ancestor = path.join(mirror.root, "tests/fixtures/sam-goal-v2/evaluation-v3");
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "context_revalidate_early", "verify-dependency-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:dependency_evaluationContract:" + ancestor),
        function () { return replaceAncestorMutation(ancestor, "verify-dependency-ancestor"); }, [ancestor, anchorPath, candidateA], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "verify-toctou-tool-final");
      const target = path.join(mirror.root, path.relative(ROOT, AUDITOR));
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "context_revalidate_early", "verify-tool-final",
        expectedFailure("artifact_replaced_after_read", "artifact_replaced_after_read:tool_labelAuditor"),
        function () { return replaceFileMutation(target, "verify-tool-final"); }, [target, anchorPath, candidateA], { cli: mirror.cli });
    }
    {
      const mirror = makeRepoMirror(tempRoot, "verify-toctou-tool-ancestor");
      const ancestor = path.join(mirror.root, "scripts");
      await runMutationBarrier(verifyArgs(anchorPath, candidateA), tempRoot, "verify-anchor", "context_revalidate_early", "verify-tool-ancestor",
        expectedFailure("external_ancestor_replaced", "external_ancestor_replaced:tool_manualCompiler:" + ancestor),
        function () { return replaceAncestorMutation(ancestor, "verify-tool-ancestor"); }, [ancestor, anchorPath, candidateA], { cli: mirror.cli });
    }
    }
    const anchorDescriptorAttacks = [
      ["missing", expectedFailure("schema_validation", "schema_validation:p0Anchor/compiledArtifacts:minItems"), function (value) { value.compiledArtifacts.pop(); }],
      ["extra", expectedFailure("schema_validation", "schema_validation:p0Anchor/compiledArtifacts:maxItems"), function (value) { value.compiledArtifacts.push({ path: "extra.json", byteSha256: "e".repeat(64) }); }],
      ["renamed", expectedFailure("p0_anchor_binding_drift"), function (value) { value.compiledArtifacts[0].path = "renamed-evaluation-pack.json"; }],
      ["traversal", expectedFailure("schema_validation", "schema_validation:p0Anchor/compiledArtifacts/0/path:pattern"), function (value) { value.compiledArtifacts[0].path = "../evaluation-pack.json"; }],
      ["absolute", expectedFailure("schema_validation", "schema_validation:p0Anchor/compiledArtifacts/0/path:pattern"), function (value) { value.compiledArtifacts[0].path = path.join(tempRoot, "evaluation-pack.json"); }],
      ["duplicate", expectedFailure("schema_validation", "schema_validation:p0Anchor/compiledArtifacts:uniqueItems"), function (value) { value.compiledArtifacts[1] = deepClone(value.compiledArtifacts[0]); }],
      ["rehashed-substitute", expectedFailure("p0_anchor_binding_drift"), function (value) { value.compiledArtifacts[0].byteSha256 = "f".repeat(64); }],
      ["set-hash", expectedFailure("p0_anchor_binding_drift"), function (value) { value.compiledArtifactSetSha256 = "f".repeat(64); }],
    ];
    for (const [name, expected, mutate] of anchorDescriptorAttacks) {
      const attackedAnchor = deepClone(anchorValue);
      mutate(attackedAnchor);
      attackedAnchor.expectedCanonicalHash = canonicalHash(attackedAnchor, true);
      const attackedAnchorPath = path.join(tempRoot, "p0-anchor-descriptor-" + name + ".json");
      writeFileSync(attackedAnchorPath, pretty(attackedAnchor), { flag: "wx", mode: 0o600 });
      runFail([
        "verify-anchor",
        "--anchor", attackedAnchorPath,
        "--expected-p0-anchor-sha256", attackedAnchor.expectedCanonicalHash,
        "--label-dir", candidateA,
        "--review-a", reviewAPath,
        "--review-b", reviewBPath,
        "--adjudication", adjudicationPath,
      ], "anchorDescriptorAttack:" + name, expected);
    }
    const logicalPathAnchor = deepClone(anchorValue);
    logicalPathAnchor.sealedInputs.reviewA.logicalPath = reviewAPath;
    logicalPathAnchor.expectedCanonicalHash = canonicalHash(logicalPathAnchor, true);
    const logicalPathAnchorPath = path.join(tempRoot, "p0-anchor-logical-path.json");
    writeFileSync(logicalPathAnchorPath, pretty(logicalPathAnchor), { flag: "wx", mode: 0o600 });
    runFail([
      "verify-anchor",
      "--anchor", logicalPathAnchorPath,
      "--expected-p0-anchor-sha256", logicalPathAnchor.expectedCanonicalHash,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "logicalPathResolutionAttack", expectedFailure("schema_validation", "schema_validation:p0Anchor/sealedInputs/reviewA/logicalPath:const"));
    runFail([
      "verify-anchor",
      "--anchor", anchorPath,
      "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", candidateA,
      "--review-a", reviewBPath,
      "--review-b", reviewAPath,
      "--adjudication", adjudicationPath,
    ], "roleSwappedInputs", expectedFailure("review_role_mismatch", "review_role_mismatch:review_a:second:first"));
    runFail([
      "verify-anchor",
      "--anchor", anchorPath,
      "--expected-p0-anchor-sha256", "f".repeat(64),
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "wrongExpectedAnchor", expectedFailure("p0_anchor_expected_mismatch", "p0_anchor_expected_mismatch:" + "f".repeat(64) + ":" + created.anchorCanonicalSha256));
    runFail([
      "verify-anchor",
      "--anchor", anchorPath,
      "--expected-p0-anchor-sha256", compiledA.candidateP0PackCanonicalSha256,
      "--label-dir", candidateA,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "candidateHashAsExternalParent", expectedFailure("p0_anchor_expected_mismatch", "p0_anchor_expected_mismatch:" + compiledA.candidateP0PackCanonicalSha256 + ":" + created.anchorCanonicalSha256));

    const altered = path.join(tempRoot, "candidate-altered");
    cpSync(candidateA, altered, { recursive: true });
    const policyPath = path.join(altered, "manual-policy.json");
    const policy = readJson(policyPath);
    policy.thresholds.preMaskContactFrames = 299;
    writeFileSync(policyPath, pretty(withSelfHash(policy)));
    runFail([
      "verify-anchor",
      "--anchor", anchorPath,
      "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
      "--label-dir", altered,
      "--review-a", reviewAPath,
      "--review-b", reviewBPath,
      "--adjudication", adjudicationPath,
    ], "candidateMutation", expectedFailure("compiled_artifact_mismatch", "compiled_artifact_mismatch:manual-policy.json"));
    for (const descriptorAttack of ["traversal", "absolute", "missing", "extra", "renamed", "duplicate", "rehashed-substitute", "set-hash"]) {
      const attackedCandidate = path.join(tempRoot, "candidate-descriptor-" + descriptorAttack);
      cpSync(candidateA, attackedCandidate, { recursive: true });
      const manifestPath = path.join(attackedCandidate, "evaluation-pack.json");
      const attackedManifest = readJson(manifestPath);
      if (descriptorAttack === "traversal") attackedManifest.files.manualPolicy.path = "../manual-policy.json";
      if (descriptorAttack === "absolute") attackedManifest.files.manualPolicy.path = path.join(attackedCandidate, "manual-policy.json");
      if (descriptorAttack === "missing") delete attackedManifest.files.manualPolicy;
      if (descriptorAttack === "extra") attackedManifest.files.unregistered = deepClone(attackedManifest.files.manualPolicy);
      if (descriptorAttack === "renamed") {
        attackedManifest.files.renamedManualPolicy = attackedManifest.files.manualPolicy;
        delete attackedManifest.files.manualPolicy;
      }
      if (descriptorAttack === "duplicate") attackedManifest.files.manualSummary = deepClone(attackedManifest.files.manualPolicy);
      if (descriptorAttack === "rehashed-substitute") attackedManifest.files.manualPolicy.byteSha256 = "f".repeat(64);
      const sealedManifest = withSelfHash(attackedManifest);
      if (descriptorAttack === "set-hash") sealedManifest.expectedCanonicalHash = "f".repeat(64);
      writeFileSync(manifestPath, pretty(sealedManifest));
      runFail([
        "verify-anchor",
        "--anchor", anchorPath,
        "--expected-p0-anchor-sha256", created.anchorCanonicalSha256,
        "--label-dir", attackedCandidate,
        "--review-a", reviewAPath,
        "--review-b", reviewBPath,
        "--adjudication", adjudicationPath,
      ], "descriptorAttack:" + descriptorAttack,
      expectedFailure("compiled_artifact_mismatch", "compiled_artifact_mismatch:evaluation-pack.json"));
    }

    assert.equal(readdirSync(tempRoot).some(function (name) { return name.includes(".tmp-"); }), false, "temporary residue");
    EXECUTION_EVIDENCE.residueAssertions += 1;
    console.log(JSON.stringify({
      status: "passed",
      categories: ["functional", "edge", "failure", "regression", "performance"],
      checks: {
        authoringSchemaBytes: readFileSync(PATHS.authoring).length,
        authoringSchemaDefinitions: Object.keys(authoringSchema.$defs).length,
        authoringSchemaRefs: refs,
        decoderRows: decoderRows.length,
        disagreementPaths: adjudication.disagreements.length,
        valueTypes: sorted(valueTypes),
        compiledFiles: EXPECTED_FILES.length,
        deterministicCandidateHash: compiledA.candidateP0PackCanonicalSha256,
        compiledArtifactSetSha256: compiledA.compiledArtifactSetSha256,
        anchorCanonicalSha256: created.anchorCanonicalSha256,
        alternateCandidateHash: alternateCompiled.candidateP0PackCanonicalSha256,
        alternateAnchorHash: alternateCreated.anchorCanonicalSha256,
        thirdWindowCandidateHash: thirdWindowCompiled.candidateP0PackCanonicalSha256,
        alignedWindowCandidateHash: alignedWindowCompiled.candidateP0PackCanonicalSha256,
        finalSegmentTraceDescriptorCanonicalSha256: thirdWindowCompiled.finalSegmentTrace.descriptorCanonicalSha256,
        finalSegmentTraceChildCount: thirdWindowCompiled.finalSegmentTrace.childCount,
        finalSegmentTraceCoveredRows: thirdWindowCompiled.finalSegmentTrace.coveredRows,
        compilerNormalizedSeal: normalizedCompilerDigest(readFileSync(CLI)),
        exactPresencePersonStateKappa: kappaMacro(60),
        oneSampleBelowPresencePersonStateKappa: kappaMacro(61),
        signalCaseCount: EXECUTION_EVIDENCE.signalCases.length,
        mutationCaseCount: EXECUTION_EVIDENCE.mutationCases.length,
      },
      metrics,
      draftPython: draftPythonReport,
      draftSchemas: [PATHS.authoring, PATHS.labelSchema, PATHS.teacherSchema, PATHS.p0Schema, PATHS.p1Schema, PATHS.sourceSchema].map(function (filePath) {
        return path.relative(ROOT, filePath);
      }),
      publicCliModes: ["validate-review", "compile", "create-anchor", "verify-anchor"],
      mpc3NamedAttackCoverage: {
        v2PinReplay: ["v2ReviewReplay", "historicalPins"],
        dependencyAndSourceSubstitution: ["13 bindingDrift subprocesses", "9 actual repo mirrors", "sourceDescriptorCountDrift", "decoderCountDrift", "candidateMutation", "compileB PATH shadow"],
        scenarioOnlyAndExplicitDecision: ["csi-pose frame 50 A/B/final scenarios", "explicit third value turn", "discontinuous contact/left A-B-A finals"],
        semanticTruthAndClipOrder: ["schema-valid unknown+single_target+ambiguous", "reversed clips", "adjacent-swapped clips"],
        thirdWindowBoundaries: ["shared start/end inside union segment", "window-or-null child boundaries", "aligned third-object control", "repeat determinism"],
        finalSegmentTraceIndependentOracle: ["exact ordered descriptors", "canonical descriptor SHA", "child count", "coveredRows 6711", "strict-interior 302/499/650/675", "one membership set per child", "sibling selected hash preservation"],
        finalSegmentTraceNegativeControlPrerequisite: ["separate authorized targeted entrypoint", "clonefile-only base/mutant mirrors", "independent exact oracle rejection", "candidate/manifest hash not used"],
        finalSegmentTraceGate: ["missing NODE_ENV", "missing runtime gate", "bad and empty value", "validate/create/verify mode rejection", "parse-before-open instrumentation"],
        finalSegmentTraceDurability: ["ordinary compile byte/shape unchanged", "ordinary validate/create/verify no trace", "all 9 candidate files", "evaluation-pack descriptors", "external anchor bytes", "trace canaries absent"],
        adjudicationSet: ["missing-decision", "extra-decision", "path-order", "value-type", "review-a-hash", "review-a-byte", "review-a-pseudonym"],
        roleActorAndFilesystemAlias: ["A/B/adjudication realpath", "device/inode", "byte", "pseudonym", "symlink", "hardlink", "pack/anchor inode"],
        logicalPath: ["logicalPathResolutionAttack", "verifyLogicalPathNoOpen"],
        decoderAndOrderDrift: ["sourceProjectionOrderDrift", "rawIntervalOrderDrift", "scenarioArrayOrderDrift"],
        forbiddenVocabulary: ["openObservabilityVocabulary"],
        descriptorSetAndPath: ["manifest and anchor missing/extra/renamed/traversal/absolute/duplicate/rehashed/set-hash"],
        candidateHashAsParent: ["candidateHashAsExternalParent"],
        independentlyExpectedAnchor: ["wrongExpectedAnchor", "alternateAnchorRejectedByFirstExpectedHash"],
        singleReadAndPostPrecheck: ["self-consistent SELF_SNAPSHOT swap", "B/adjudication/pack/anchor/label/dependency/tool final+ancestor", "output/anchor parent last-window"],
        lateCommitMutationRollback: ["last-window sealed/stage", "post-rename sealed/committed", "pre-link temp/sealed", "post-link anchor/pack/sealed/context"],
        spontaneousHelperFailures: ["compile writer", "anchor writer", "candidate auditors", "rename helper", "anchor link helper", "anchored auditor"],
        thresholds: ["planted exact/below/terminal", "support exact 300/below 299", "kappa exact 0.99/below by one sample"],
        callerPathAndRelativeCwd: ["two byte-identical external anchors", "caller canary absent", "all four modes relative from nonrepo cwd"],
        relativeCreateRollback: ["compile_stage", "anchor_recompile_stage", "anchor_temp"],
        staleDestinationAndSignals: ["existingDestination", "24 structured hook x signal cases when enabled"],
      },
      executionEvidence: EXECUTION_EVIDENCE,
      historicalPins: beforePins,
      historicalR2FocusedSuite: "root_external_acceptance_verification",
    }, null, 2));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
  assert.deepEqual(historicalPins(), beforePins);
}
function runFinalSegmentTraceMutantTarget() {
  const tempRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), "manual-compiler-fixtures-r3-clonefile-")));
  const tempParent = path.dirname(tempRoot);
  const tempRootIdentity = ownedRootIdentity(tempRoot);
  const metrics = {};
  const ownedRoots = [];
  const cloneTreeRoots = [];
  const cloneDestinations = [];
  const cloneEvidence = [];
  let sourceBefore = null;
  let sourceMetadataDriftCount = null;
  let cleanupFailureCount = null;
  let baseCompiled = null;
  let mutantCompiled = null;
  let oracle = null;
  const registerOwnedRoot = function (filePath) {
    const entry = { path: filePath, identity: ownedRootIdentity(filePath) };
    ownedRoots.push(entry);
    return entry;
  };
  const runTargetedCompile = function (args, output, name, options) {
    const result = runRaw(args, options);
    if (pathExists(output)) registerOwnedRoot(output);
    assert.equal(result.status, 0, name + " failed\nstdout=" + result.stdout + "\nstderr=" + result.stderr);
    assert.ok(result.report && result.report.status === "compiled", name + " invalid success report");
    incrementCounter(EXECUTION_EVIDENCE.successByMode, "compile");
    metrics[name] = { wallMs: Number(result.wallMs.toFixed(3)), peakRssKiB: result.peakRssKiB };
    return result.report;
  };
  try {
    const descriptors = authorizedCloneDescriptors();
    const reviewAPath = path.join(tempRoot, "review-a.json");
    const reviewBPath = path.join(tempRoot, "review-b.json");
    const adjudicationPath = path.join(tempRoot, "adjudication-third-window-boundaries.json");
    const reviewerA = sha256(Buffer.from("synthetic-reviewer-a", "utf8"));
    const reviewerB = sha256(Buffer.from("synthetic-reviewer-b", "utf8"));
    const adjudicator = sha256(Buffer.from("synthetic-adjudicator", "utf8"));
    const reviewA = makeReview("first", reviewerA);
    const reviewB = makeReview("second", reviewerB);
    const reviewABytes = pretty(reviewA);
    const reviewBBytes = pretty(reviewB);
    const adjudication = makeAdjudication(reviewA, reviewABytes, reviewB, reviewBBytes, adjudicator);
    const thirdWindowObject = {
      windowId: "overlay-a",
      clipId: "csi-pose",
      startFrameIndex: 650,
      endFrameIndexExclusive: 675,
      purposeTags: ["self_occlusion"],
      scenarioTags: ["self_occlusion"],
    };
    const thirdWindowVariant = windowDecisionAdjudication(adjudication, reviewA.windows, {
      sharedStart: 302,
      sharedEnd: 499,
      overlayA: thirdWindowObject,
    });
    writeFileSync(reviewAPath, reviewABytes, { flag: "wx", mode: 0o600 });
    writeFileSync(reviewBPath, reviewBBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(adjudicationPath, pretty(thirdWindowVariant.adjudication), { flag: "wx", mode: 0o600 });
    oracle = independentFinalSegmentOracle(reviewA, reviewB, thirdWindowVariant.adjudication);
    assertIndependentOracleBoundaries(oracle, [
      ["csi-pose", 302], ["csi-pose", 499], ["csi-pose", 650], ["csi-pose", 675],
    ], "targeted third-window oracle");
    sourceBefore = sourceMetadataSnapshot();

    const traceEnv = finalSegmentTraceEnvironment({ nodeEnv: "test", runtimeTest: "1", trace: "1" });
    const compileArgs = function (output) {
      return [
        "compile", "--review-a", reviewAPath, "--review-b", reviewBPath,
        "--adjudication", adjudicationPath, "--output-dir", output,
      ];
    };
    const baseMirror = makeRepoMirror(tempRoot, "targeted-final-segment-trace-base");
    registerOwnedRoot(baseMirror.root);
    cloneTreeRoots.push(path.join(baseMirror.root, "sam-3d-body-skeletons"));
    cloneDestinations.push(...AUTHORIZED_CLONE_PATHS.map(function (logicalPath) { return path.join(baseMirror.root, logicalPath); }));
    cloneAuthorizedInputsIntoMirror(baseMirror.root, descriptors, cloneEvidence);
    const sealedBase = selfConsistentCompilerSource(readFileSync(baseMirror.cli, "utf8"));
    writeFileSync(baseMirror.cli, sealedBase.buffer);
    const baseOutput = path.join(tempRoot, "candidate-targeted-final-segment-trace-base");
    baseCompiled = runTargetedCompile(compileArgs(baseOutput), baseOutput, "targetedFinalSegmentTraceBase", {
      cli: baseMirror.cli,
      env: traceEnv,
    });
    assertIndependentFinalSegmentTrace(baseCompiled, oracle, "targeted self-sealed base mirror");

    const mutantMirror = makeRepoMirror(tempRoot, "targeted-final-segment-trace-old-direct-fill-mutant");
    registerOwnedRoot(mutantMirror.root);
    cloneTreeRoots.push(path.join(mutantMirror.root, "sam-3d-body-skeletons"));
    cloneDestinations.push(...AUTHORIZED_CLONE_PATHS.map(function (logicalPath) { return path.join(mutantMirror.root, logicalPath); }));
    cloneAuthorizedInputsIntoMirror(mutantMirror.root, descriptors, cloneEvidence);
    const sealedMutant = oldDirectFillCompilerMutant(sealedBase.buffer);
    writeFileSync(mutantMirror.cli, sealedMutant.buffer);
    const mutantOutput = path.join(tempRoot, "candidate-targeted-final-segment-trace-old-direct-fill-mutant");
    mutantCompiled = runTargetedCompile(compileArgs(mutantOutput), mutantOutput,
      "targetedFinalSegmentTraceOldDirectFillMutant", {
      cli: mutantMirror.cli,
      env: traceEnv,
    });
    assert.ok(mutantCompiled.finalSegmentTrace, "targeted old-direct-fill mutant omitted successful trace");
    assert.deepEqual(Object.keys(mutantCompiled.finalSegmentTrace),
      ["descriptors", "childCount", "coveredRows", "descriptorCanonicalSha256"],
      "targeted old-direct-fill mutant trace shape drift");
    assert.equal(mutantCompiled.finalSegmentTrace.coveredRows, 6711,
      "targeted old-direct-fill mutant did not compile a complete projection");
    assert.equal(mutantCompiled.finalSegmentTrace.descriptors.length, mutantCompiled.finalSegmentTrace.childCount,
      "targeted old-direct-fill mutant child count is malformed");
    for (const descriptor of mutantCompiled.finalSegmentTrace.descriptors) {
      assert.deepEqual(Object.keys(descriptor), [
        "clipId", "start", "end", "originStart", "originEnd", "memberships", "selectedCanonicalSha256",
      ], "targeted old-direct-fill mutant descriptor shape drift");
      assert.ok(descriptor.start < descriptor.end, "targeted old-direct-fill mutant descriptor is empty");
      assert.ok(Array.isArray(descriptor.memberships), "targeted old-direct-fill mutant memberships are malformed");
      assert.match(descriptor.selectedCanonicalSha256, /^[0-9a-f]{64}$/u,
        "targeted old-direct-fill mutant selected hash is malformed");
    }
    assert.throws(function () {
      assertIndependentFinalSegmentTrace(mutantCompiled, oracle, "targeted old-direct-fill mutant");
    }, function (error) {
      return error && error.name === "AssertionError"
        && /independent final-segment trace mismatch/u.test(error.message);
    }, "targeted independent oracle accepted old direct-fill/no-boundary-insertion mutant");
    assert.notDeepEqual(mutantCompiled.finalSegmentTrace.descriptors, oracle.descriptors,
      "targeted old-direct-fill mutant unexpectedly matched independent descriptors");
    assert.notEqual(mutantCompiled.finalSegmentTrace.descriptorCanonicalSha256, oracle.descriptorCanonicalSha256,
      "targeted old-direct-fill mutant unexpectedly matched independent descriptor hash");
    assert.equal(cloneEvidence.length, 42, "authorized clonefile call count drift");
    assert.deepEqual(cloneEvidence.map(function (entry) { return entry.logicalPath; }),
      [...AUTHORIZED_CLONE_PATHS, ...AUTHORIZED_CLONE_PATHS], "authorized clonefile call order drift");
    assert.ok(cloneEvidence.every(function (entry) { return entry.clonefileRc === 0; }),
      "authorized clonefile evidence contains nonzero return code");
  } finally {
    const cleanupErrors = [];
    const captureCleanup = function (operation) {
      try { operation(); } catch (error) { cleanupErrors.push(error); }
    };
    for (const entry of [...ownedRoots].reverse()) captureCleanup(function () { removeOwnedRoot(entry); });
    for (const clonePath of cloneDestinations) captureCleanup(function () {
      assert.equal(pathExists(clonePath), false, "authorized clone destination remains after cleanup: " + clonePath);
    });
    for (const cloneTreeRoot of cloneTreeRoots) captureCleanup(function () {
      assert.equal(pathExists(cloneTreeRoot), false, "authorized cloned raw tree remains after cleanup: " + cloneTreeRoot);
    });
    if (sourceBefore !== null) {
      captureCleanup(function () {
        const sourceAfter = sourceMetadataSnapshot();
        const drift = sourceBefore.filter(function (entry, index) { return !stableEqual(entry, sourceAfter[index]); });
        sourceMetadataDriftCount = drift.length;
        assert.equal(sourceMetadataDriftCount, 0, "authorized clone source/ancestor metadata drift: " + stableStringify(drift));
      });
    }
    captureCleanup(function () {
      assert.deepEqual(allTransactionalResidue(tempRoot), [], "targeted final-segment trace left transactional residue");
    });
    captureCleanup(function () { fsyncDirectory(tempRoot); });
    captureCleanup(function () {
      assert.deepEqual(ownedRootIdentity(tempRoot), tempRootIdentity, "targeted owned runtime root identity drift");
      rmSync(tempRoot, { recursive: true, force: true });
      fsyncDirectory(tempParent);
      assert.equal(pathExists(tempRoot), false, "targeted owned runtime root remains after cleanup");
    });
    cleanupFailureCount = cleanupErrors.length;
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "targeted clonefile cleanup failed");
  }
  const cloneVerificationCounts = {
    clonefileRc0: cloneEvidence.filter(function (entry) { return entry.clonefileRc === 0; }).length,
    sameDevice: cloneEvidence.filter(function (entry) { return entry.sameDeviceVerified; }).length,
    distinctInode: cloneEvidence.filter(function (entry) { return entry.distinctInodeVerified; }).length,
    nlink1: cloneEvidence.filter(function (entry) { return entry.nlinkOneVerified; }).length,
    size: cloneEvidence.filter(function (entry) { return entry.sizeVerified; }).length,
    hash: cloneEvidence.filter(function (entry) { return entry.hashVerified; }).length,
  };
  assert.deepEqual(cloneVerificationCounts, {
    clonefileRc0: 42, sameDevice: 42, distinctInode: 42, nlink1: 42, size: 42, hash: 42,
  }, "authorized clonefile verification summary drift");
  console.log(JSON.stringify({
    status: "passed",
    target: "final-segment-trace-old-direct-fill-mutant",
    clonefileExceptionId: CLONEFILE_EXCEPTION.id,
    clonefileEvidenceSha256: CLONEFILE_EXCEPTION.evidenceSha256,
    supersededExceptionId: CLONEFILE_EXCEPTION.supersededId,
    supersededOperationExercised: CLONEFILE_EXCEPTION.supersededExercised,
    clonefileHelperSha256: CLONEFILE_HELPER_SHA256,
    clonefileHelperForbiddenApisAbsent: true,
    clonefileSourceGuardAsserted: true,
    clonefileAbsentDestinationGuardAsserted: true,
    clonefileExecutable: "/usr/bin/python3",
    clonefileArgvPrefix: ["-I", "-S", "-c"],
    cloneCount: cloneEvidence.length,
    cloneEvidenceCanonicalSha256: canonicalHash(cloneEvidence, false),
    cloneVerificationCounts,
    sourceMetadataDriftCount,
    cleanupFailureCount,
    oracle: {
      childCount: oracle.childCount,
      coveredRows: oracle.coveredRows,
      descriptorCanonicalSha256: oracle.descriptorCanonicalSha256,
    },
    baseTrace: {
      childCount: baseCompiled.finalSegmentTrace.childCount,
      coveredRows: baseCompiled.finalSegmentTrace.coveredRows,
      descriptorCanonicalSha256: baseCompiled.finalSegmentTrace.descriptorCanonicalSha256,
    },
    mutantTrace: {
      childCount: mutantCompiled.finalSegmentTrace.childCount,
      coveredRows: mutantCompiled.finalSegmentTrace.coveredRows,
      descriptorCanonicalSha256: mutantCompiled.finalSegmentTrace.descriptorCanonicalSha256,
    },
    baseCompileExitZero: true,
    baseCandidateAuditPassed: true,
    mutantCompileExitZero: true,
    mutantCandidateAuditPassed: true,
    mutantTraceWellFormed: true,
    independentOracleRejectedMutant: true,
    cleanupPathsAbsent: true,
    metrics,
  }, null, 2));
}

if (process.env.SAM_GOAL_MANUAL_PACK_V3_TEST_FINAL_SEGMENT_TRACE_MUTANT_ONLY === "1") {
  runFinalSegmentTraceMutantTarget();
} else {
  await main();
}
