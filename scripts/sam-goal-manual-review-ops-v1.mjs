#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';
import {
  CLASS_DISPOSITIONS, DEVIATION_CLASSES, MroError, PROCESS_MARKER, PUBLIC_PATHS, REVEAL_FIXED_LOGICAL_PATHS,
  PUBLIC_PINS, REPO_ROOT, RENAME_EXCL_HELPER_SOURCE_EXPECTED_SHA256,
  assertDistinctSnapshots, assertExactDeviationRecords, assertFinalReviewEvidence, canonicalHash, canonicalStringify, classifyDeviation, closeDirectoryProof,
  closeExactTreeProof, closeSnapshot, commitBundleTree, commitDirectory, commitDirectoryTransaction,
  commitSingleFile, containsUnset, createWorksheet, deepEqual, deriveDeviationCoordinates, deriveDisagreements,
  exactIdentity, fail, formalBytes, formalSourceBinding, getLeaf, makeSkeleton, materializeAdjudicationFinalRows, materializeReview,
  normalizeWindows, parseJsonBuffer, processBytes, processSourceBinding,
  presentationContractSha256,
  projectC0, proveDirectorySync, proveExactTreeSync, publicBeforeAfterPins, rawAgreement, rawUtf8Compare,
  revalidateDirectoryProofSync, revalidateExactTreeProofSync, revalidateHeldExactTreeAnchorsSync, revalidateSnapshotSync, reviewEvidence, sha256, snapshotPathSync,
  replayAdjudicationJournal, replayWorksheetJournal,
  snapshotDirectChildAtSync, spawnTracked,
  assertExpectedSessionTreeSha256, fixedInputSetSha256, makeSessionSealEnvelope, makeSessionTreeDescriptor, sessionTreeSha256,
  validateDisposition, validateProcessArtifact as validateProcessArtifactCore, validateWorksheet, verifyPublicPins,
  worksheetToReview, writeExclusiveFile,
} from '../tools/sam-goal-manual-review-viewer-v1/core.mjs';
import { createProcessSchemaValidator } from '../tools/sam-goal-manual-review-viewer-v1/schema-validator.mjs';

const OWNED_VIEWER = path.join(REPO_ROOT, 'tools/sam-goal-manual-review-viewer-v1');
const RULEBOOK = path.join(REPO_ROOT, 'docs/sam-goal-manual-review-operations-v1.md');
const SCHEMA_DIR = path.join(REPO_ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas');
const COMPILER = path.join(REPO_ROOT, PUBLIC_PATHS.manualPackCompiler);
const EXACT_DECODER = path.join(OWNED_VIEWER, 'exact-pts-decoder.mjs');
const COORDINATOR_OPENAT_NODE_SHA256 = '0e745e26ec70b7151906fa17d12ec4d385614485398cd032d886b90696b714ea';
const VALIDATOR_INTERFACE = 'sam_goal.manual_pack_compiler_v3/manual-pack-review-validator-cli';
const PRIVATE_PROTOCOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const EXPECTED_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TRUSTED_RUNTIME_SOURCE_PATH = '/Users/chasoik/.nvm/versions/node/v22.17.0/bin/node';
const PROCESS_SCHEMA_SOURCE_NAMES = Object.freeze(['access-evidence-v1.schema.json', 'bundle-manifest-v1.schema.json', 'c0-ledger-v1.schema.json', 'deviation-evidence-v1.schema.json', 'edit-journal-v1.schema.json', 'handoff-report-v1.schema.json', 'raw-ab-report-v1.schema.json', 'reveal-receipt-v1.schema.json', 'review-export-receipt-v1.schema.json', 'worksheet-v1.schema.json']);
const OWNED_VIEWER_SOURCE_NAMES = Object.freeze(['app.js', 'build-coordinator-openat.mjs', 'coordinator-openat.c', 'coordinator-openat.node', 'core.mjs', 'exact-pts-decoder.mjs', 'exact-still-decoder.js', 'index.html', 'launcher.mjs', 'sandbox-init.c', 'sandbox-init.node', 'sandbox-preload.cjs', 'schema-validator.mjs', 'style.css']);
// These literals live only in the trusted repository coordinator. They are intentionally
// independent of every bundle manifest and include core.mjs from outside that copied file.
const FROZEN_BUNDLE_ASSET_DESCRIPTORS = Object.freeze([
  Object.freeze({ sourcePath: 'docs/sam-goal-manual-review-operations-v1.md', logicalPath: 'immutable/rulebook.md', bytes: 24384, sha256: 'c161f60cb4de908bc82c3accb4fb31f4bdad1752c1a9877a0c19e0b0e199dde8', mediaType: 'text/markdown', executable: false, assetClass: 'owned_rulebook' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/access-evidence-v1.schema.json', logicalPath: 'immutable/schemas/access-evidence-v1.schema.json', bytes: 4298, sha256: '7446624e41c975500541dd088da84c4b62de05725c7162a3606e3db2d3a18b63', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/bundle-manifest-v1.schema.json', logicalPath: 'immutable/schemas/bundle-manifest-v1.schema.json', bytes: 10952, sha256: 'bfe6dbf1a0c7ef3f7648d015587d2858f0678f831102b9618fdbe7f21af98851', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/c0-ledger-v1.schema.json', logicalPath: 'immutable/schemas/c0-ledger-v1.schema.json', bytes: 2790, sha256: '428797aad03d10aa907697cfadcb2d04aa255cdccde6fe1b10919c51888118c0', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/deviation-evidence-v1.schema.json', logicalPath: 'immutable/schemas/deviation-evidence-v1.schema.json', bytes: 23021, sha256: 'b6e924cb5e863e1a8a765725a451bf2474cc8b057f36d016fe4212c786818722', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/edit-journal-v1.schema.json', logicalPath: 'immutable/schemas/edit-journal-v1.schema.json', bytes: 15276, sha256: '07cabed5c5d75cd0edb802543ba4c300bcb1b3442a3ab459cb6724af2ff582c5', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/handoff-report-v1.schema.json', logicalPath: 'immutable/schemas/handoff-report-v1.schema.json', bytes: 2365, sha256: '0b7f4e45bfc018ef46817929cf6ae75fff8791eeedb53eef82303fec8ce3879d', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/raw-ab-report-v1.schema.json', logicalPath: 'immutable/schemas/raw-ab-report-v1.schema.json', bytes: 6762, sha256: '7fef9826e6cbe31a33b1bfa787a02a1fa19e780dc719225d18651bb3a01cb54a', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/reveal-receipt-v1.schema.json', logicalPath: 'immutable/schemas/reveal-receipt-v1.schema.json', bytes: 2340, sha256: 'faf9a77dc55db74a8e1c529d28a1bda7fbcb69daee91d57b12a1f34df2bf2893', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/review-export-receipt-v1.schema.json', logicalPath: 'immutable/schemas/review-export-receipt-v1.schema.json', bytes: 2505, sha256: 'b86e1acbae5a16b8682c03219369648f96fcc7947cb1d40109a3444aa65979ee', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas/worksheet-v1.schema.json', logicalPath: 'immutable/schemas/worksheet-v1.schema.json', bytes: 4110, sha256: 'e352ed2349f67b1e2cdf429ff09546dad058a4592dcc03a08db003255a4e5844', mediaType: 'application/json', executable: false, assetClass: 'owned_process_schema' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/app.js', logicalPath: 'immutable/viewer/app.js', bytes: 38466, sha256: 'f418431f8b5648ff7944f6e4d1804b4d373e322856e5866730a04ea704625cb0', mediaType: 'text/javascript', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/core.mjs', logicalPath: 'immutable/viewer/core.mjs', bytes: 173120, sha256: 'a2a79c897bc7a773fade5c00d139495bba7cc5be81958e257f0fb77e050362bf', mediaType: 'text/javascript', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/exact-still-decoder.js', logicalPath: 'immutable/viewer/exact-still-decoder.js', bytes: 28719, sha256: '1b8cc8127da028a016f4baff298072ceff2ce7d43d1a357889b0352fc9a9984b', mediaType: 'text/javascript', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/index.html', logicalPath: 'immutable/viewer/index.html', bytes: 7766, sha256: '4a408016d5d08d034f6335cce4d011d6bf7637ac840bf492188131f09407488a', mediaType: 'text/html', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/schema-validator.mjs', logicalPath: 'immutable/viewer/schema-validator.mjs', bytes: 7066, sha256: '00d3834123028723bd978db90fceccc3537851d948060c87e71b2728c0f5b540', mediaType: 'text/javascript', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/style.css', logicalPath: 'immutable/viewer/style.css', bytes: 4234, sha256: 'e288f3cb43613ac5458ad71526a5e2cdc65faaf1c1e1c2ae6b825108ac540ebf', mediaType: 'text/css', executable: false, assetClass: 'owned_viewer' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/coordinator-openat.c', logicalPath: 'immutable/coordinator-openat.c', bytes: 5337, sha256: '0b1ec0439f5256bc587276df8992344dda513c73872f12fce064b9390227cbb5', mediaType: 'text/x-c', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/coordinator-openat.node', logicalPath: 'immutable/coordinator-openat.node', bytes: 68720, sha256: '0e745e26ec70b7151906fa17d12ec4d385614485398cd032d886b90696b714ea', mediaType: 'application/x-mach-binary', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/launcher.mjs', logicalPath: 'immutable/launcher.mjs', bytes: 66861, sha256: '09fcf32301c419eb50b0fcef2a058ec4f7c2d3d373e8a762ac9ecf8a0c6ba114', mediaType: 'text/javascript', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/sandbox-init.c', logicalPath: 'immutable/sandbox-init.c', bytes: 2509, sha256: '86f0e71f013be26cac338202a86560bd09f056e4e73cc3461244b01fee49c282', mediaType: 'text/x-c', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/sandbox-init.node', logicalPath: 'immutable/sandbox-init.node', bytes: 50400, sha256: '5f83ef2054245c9938afc2314bdd970d082525ad9639df4ad014afab3ebb7937', mediaType: 'application/x-mach-binary', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/sandbox-preload.cjs', logicalPath: 'immutable/sandbox-preload.cjs', bytes: 545, sha256: '251313b034c83bac17f9f688bedc3f6bfc8c10b4688d0994d5873ad14d8e56d0', mediaType: 'text/javascript', executable: false, assetClass: 'owned_launcher' }),
  Object.freeze({ sourcePath: 'tools/sam-goal-manual-review-viewer-v1/exact-pts-decoder.mjs', logicalPath: 'immutable/decoder/exact-pts-decoder.mjs', bytes: 11689, sha256: '9556e78b44c60a1ae9c075aa208d517ae2082d0d4e1b47e59a9760b4dd2043ef', mediaType: 'text/javascript', executable: false, assetClass: 'process_decoder' }),
  Object.freeze({ sourcePath: TRUSTED_RUNTIME_SOURCE_PATH, logicalPath: 'immutable/runtime/node', bytes: 110604016, sha256: '7bf25453c4280d0c4b8501144e419dd9597eeddd5804c4f4ab571d3286489547', mediaType: 'application/octet-stream', executable: true, assetClass: 'runtime_executable' }),
]);
const PRESENTATION_CONTRACT_SHA256 = presentationContractSha256(FROZEN_BUNDLE_ASSET_DESCRIPTORS);
const PIN_ERROR_BY_LOGICAL_PATH = Object.freeze({
  'immutable/runtime/node': 'trusted_runtime_node_pin_mismatch', 'immutable/launcher.mjs': 'trusted_launcher_pin_mismatch',
  'immutable/sandbox-preload.cjs': 'trusted_sandbox_preload_pin_mismatch', 'immutable/viewer/core.mjs': 'trusted_viewer_core_pin_mismatch',
  'immutable/viewer/app.js': 'trusted_viewer_app_pin_mismatch', 'immutable/decoder/exact-pts-decoder.mjs': 'trusted_exact_pts_decoder_pin_mismatch',
  'immutable/schemas/worksheet-v1.schema.json': 'trusted_worksheet_schema_pin_mismatch', 'immutable/rulebook.md': 'trusted_rulebook_pin_mismatch',
  'immutable/coordinator-openat.node': 'coordinator_openat_bundle_pin_mismatch',
});
const require = createRequire(import.meta.url);
const SCHEMA_FILE_BY_TYPE = Object.freeze({
  'sam-goal-review-bundle-manifest-v1': 'bundle-manifest-v1.schema.json', 'sam-goal-review-access-evidence-v1': 'access-evidence-v1.schema.json',
  'sam-goal-review-edit-journal-v1': 'edit-journal-v1.schema.json', 'sam-goal-review-worksheet-v1': 'worksheet-v1.schema.json',
  'sam-goal-review-export-receipt-v1': 'review-export-receipt-v1.schema.json', 'sam-goal-source-first-c0-ledger-v1': 'c0-ledger-v1.schema.json',
  'sam-goal-raw-ab-report-v1': 'raw-ab-report-v1.schema.json', 'sam-goal-adjudication-reveal-receipt-v1': 'reveal-receipt-v1.schema.json',
  'sam-goal-manual-deviation-evidence-v1': 'deviation-evidence-v1.schema.json', 'sam-goal-manual-review-handoff-v1': 'handoff-report-v1.schema.json',
});
let processSchemaValidator;
function validateProcessArtifact(document, publicState, expectedType = document?.artifactType) {
  const presentationBound = new Set(['sam-goal-review-bundle-manifest-v1', 'sam-goal-review-access-evidence-v1', 'sam-goal-review-export-receipt-v1', 'sam-goal-source-first-c0-ledger-v1', 'sam-goal-raw-ab-report-v1', 'sam-goal-adjudication-reveal-receipt-v1', 'sam-goal-manual-deviation-evidence-v1', 'sam-goal-manual-review-handoff-v1']);
  if (presentationBound.has(expectedType) && document?.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256) fail('presentation_contract_mismatch');
  processSchemaValidator ??= createProcessSchemaValidator(SCHEMA_DIR, path.join(REPO_ROOT, PUBLIC_PATHS.authoringSchema));
  const schemaName = SCHEMA_FILE_BY_TYPE[expectedType]; if (!schemaName) fail('process_artifact_type_invalid'); processSchemaValidator.validate(path.join(SCHEMA_DIR, schemaName), document); return validateProcessArtifactCore(document, publicState, expectedType, { expectedPresentationContractSha256: PRESENTATION_CONTRACT_SHA256 });
}
function validateFormalAuthoring(document) { processSchemaValidator ??= createProcessSchemaValidator(SCHEMA_DIR, path.join(REPO_ROOT, PUBLIC_PATHS.authoringSchema)); return processSchemaValidator.validate(path.join(REPO_ROOT, PUBLIC_PATHS.authoringSchema), document); }
const MODES = new Set(['prepare-bundle', 'serve', 'export-review', 'seal-c0', 'compare-raw', 'prepare-adjudication', 'export-adjudication', 'handoff-check']);

const MODE_FLAGS = Object.freeze({
  'prepare-bundle': { required: ['--mode', '--actor-pseudonym-sha256', '--cycle-id', '--bundle-dir'], optional: [] },
  serve: { required: ['--bundle-dir'], optional: [] },
  'export-review': { required: ['--bundle-dir', '--expected-session-tree-sha256', '--output-dir'], optional: [] },
  'seal-c0': { required: ['--bundle-dir', '--expected-session-tree-sha256', '--output'], optional: [] },
  'compare-raw': { required: ['--review-a', '--receipt-a', '--expected-receipt-a-sha256', '--review-b', '--receipt-b', '--expected-receipt-b-sha256', '--c0-ledger', '--expected-c0-byte-sha256', '--output'], optional: [] },
  'prepare-adjudication': { required: ['--review-a', '--receipt-a', '--expected-receipt-a-sha256', '--review-b', '--receipt-b', '--expected-receipt-b-sha256', '--raw-report', '--expected-raw-report-sha256', '--c0-ledger', '--expected-c0-byte-sha256', '--bundle-dir'], optional: [] },
  'export-adjudication': { required: ['--bundle-dir', '--expected-session-tree-sha256', '--review-a', '--receipt-a', '--expected-receipt-a-sha256', '--review-b', '--receipt-b', '--expected-receipt-b-sha256', '--raw-report', '--expected-raw-report-sha256', '--c0-ledger', '--expected-c0-byte-sha256', '--reveal-receipt', '--expected-reveal-receipt-sha256', '--output-dir'], optional: [] },
  'handoff-check': { required: ['--review-a', '--receipt-a', '--expected-receipt-a-sha256', '--review-b', '--receipt-b', '--expected-receipt-b-sha256', '--adjudication', '--raw-report', '--expected-raw-report-sha256', '--c0-ledger', '--expected-c0-byte-sha256', '--reveal-receipt', '--expected-reveal-receipt-sha256', '--deviation-evidence', '--expected-deviation-evidence-sha256'], optional: [] },
});

function parseCli(argv) {
  const mode = argv[0]; if (!MODES.has(mode)) fail('cli_mode_invalid'); const spec = MODE_FLAGS[mode]; const flags = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index]; const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || Object.hasOwn(flags, key) || ![...spec.required, ...spec.optional].includes(key)) fail('cli_flag_invalid'); flags[key] = value;
  }
  if (spec.required.some((flag) => !Object.hasOwn(flags, flag))) fail('cli_flag_missing');
  for (const [key, value] of Object.entries(flags)) if (key.startsWith('--expected-') && !/^[0-9a-f]{64}$/u.test(value)) fail('cli_expected_hash_invalid');
  if (mode === 'prepare-bundle' && !['first', 'second', 'source-first-c0'].includes(flags['--mode'])) fail('cli_mode_value_invalid');
  if (flags['--actor-pseudonym-sha256'] && !/^[0-9a-f]{64}$/u.test(flags['--actor-pseudonym-sha256'])) fail('actor_pseudonym_invalid');
  return { mode, flags };
}

function result(value) { process.stdout.write(`${canonicalStringify(value)}\n`); }

function pathsOverlap(left, right) {
  const a = path.resolve(left); const b = path.resolve(right);
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
}

function assertExternalDisjointOutput(output, inputs = []) {
  const absolute = path.resolve(output);
  if (pathsOverlap(absolute, REPO_ROOT) || inputs.some((input) => pathsOverlap(absolute, input))) fail('output_path_not_external_or_disjoint');
}

function preflightOutputScope(mode, flags) {
  if (mode === 'prepare-bundle') return assertExternalDisjointOutput(flags['--bundle-dir']);
  if (mode === 'export-review') return assertExternalDisjointOutput(flags['--output-dir'], [flags['--bundle-dir']]);
  if (mode === 'seal-c0') return assertExternalDisjointOutput(flags['--output'], [flags['--bundle-dir']]);
  if (mode === 'compare-raw') return assertExternalDisjointOutput(flags['--output'], [path.dirname(flags['--review-a']), path.dirname(flags['--review-b']), flags['--c0-ledger']]);
  if (mode === 'prepare-adjudication') return assertExternalDisjointOutput(flags['--bundle-dir'], [path.dirname(flags['--review-a']), path.dirname(flags['--review-b']), flags['--raw-report'], flags['--c0-ledger']]);
  if (mode === 'export-adjudication') return assertExternalDisjointOutput(flags['--output-dir'], [flags['--bundle-dir'], path.dirname(flags['--review-a']), path.dirname(flags['--review-b']), flags['--raw-report'], flags['--c0-ledger'], flags['--reveal-receipt']]);
}
function mediaType(logicalPath) {
  const extension = path.extname(logicalPath); return ({ '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.mjs': 'text/javascript', '.js': 'text/javascript', '.cjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.md': 'text/markdown', '.mp4': 'video/mp4', '.node': 'application/x-mach-binary', '.c': 'text/x-c' })[extension] ?? 'application/octet-stream';
}
async function descriptor(sourcePath, logicalPath, assetClass, executable = false) {
  const bytes = await fsp.readFile(sourcePath); return { sourcePath, logicalPath, bytes: bytes.length, sha256: sha256(bytes), mediaType: mediaType(logicalPath), executable, assetClass };
}

function pinError(logicalPath) { return PIN_ERROR_BY_LOGICAL_PATH[logicalPath] ?? 'owned_asset_pin_mismatch'; }
function frozenSourcePath(item) { return path.isAbsolute(item.sourcePath) ? item.sourcePath : path.join(REPO_ROOT, item.sourcePath); }
function frozenManifestDescriptor(item) { const { sourcePath: _sourcePath, ...manifestItem } = item; return manifestItem; }
function assertExactSourceDirectory(directory, expectedNames) {
  let entries; try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { fail('owned_asset_pin_mismatch'); }
  if (entries.some((entry) => !entry.isFile()) || !deepEqual(entries.map((entry) => entry.name).sort(rawUtf8Compare), [...expectedNames].sort(rawUtf8Compare))) fail('owned_asset_pin_mismatch');
}
function assertTrustedSourceLayout() {
  assertExactSourceDirectory(SCHEMA_DIR, PROCESS_SCHEMA_SOURCE_NAMES);
  assertExactSourceDirectory(OWNED_VIEWER, OWNED_VIEWER_SOURCE_NAMES);
  if (process.execPath !== TRUSTED_RUNTIME_SOURCE_PATH) fail('trusted_runtime_node_pin_mismatch');
}
function readFrozenAssetDescriptors() {
  assertTrustedSourceLayout(); const assets = [];
  for (const frozen of FROZEN_BUNDLE_ASSET_DESCRIPTORS) {
    if (mediaType(frozen.logicalPath) !== frozen.mediaType) fail(pinError(frozen.logicalPath));
    let snapshot; try {
      snapshot = snapshotPathSync(frozenSourcePath(frozen));
      if (snapshot.bytes.length !== frozen.bytes || snapshot.sha256 !== frozen.sha256 || frozen.logicalPath === 'immutable/runtime/node' && !(snapshot.stat.mode & 0o111)) fail(pinError(frozen.logicalPath));
      assets.push({ ...frozen, sourcePath: frozenSourcePath(frozen) });
    } catch (error) {
      if (error instanceof MroError && error.code === pinError(frozen.logicalPath)) throw error;
      fail(pinError(frozen.logicalPath));
    } finally { closeSnapshot(snapshot); }
  }
  return assets;
}
function assertManifestFrozenAssetDescriptors(manifest, { verifyCurrentSources = true } = {}) {
  if (manifest?.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256) fail('presentation_contract_mismatch');
  assertTrustedSourceLayout();
  const expected = FROZEN_BUNDLE_ASSET_DESCRIPTORS.map(frozenManifestDescriptor).sort((a, b) => rawUtf8Compare(a.logicalPath, b.logicalPath));
  const expectedPaths = new Set(expected.map((item) => item.logicalPath)); const actual = manifest.immutableAssets.filter((item) => expectedPaths.has(item.logicalPath)).sort((a, b) => rawUtf8Compare(a.logicalPath, b.logicalPath));
  if (actual.length !== expected.length) fail('owned_asset_pin_mismatch');
  for (let index = 0; index < expected.length; index += 1) if (!deepEqual(actual[index], expected[index])) fail(pinError(expected[index].logicalPath));
  if (manifest.rulebookByteSha256 !== expected.find((item) => item.logicalPath === 'immutable/rulebook.md').sha256) fail('trusted_rulebook_pin_mismatch');
  if (verifyCurrentSources) readFrozenAssetDescriptors();
}

function assertAccessEvidenceClosed(access, manifest) {
  if (access?.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256 || access.presentationContractSha256 !== manifest.presentationContractSha256) fail('presentation_contract_mismatch');
  const fixedPaths = manifest.mode === 'adjudication-reveal' ? REVEAL_FIXED_LOGICAL_PATHS : [];
  const exactFilesystem = ['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((item) => item.logicalPath), ...fixedPaths, 'mutable'].sort(rawUtf8Compare);
  if (!deepEqual(access.filesystemAllowlist, exactFilesystem)) fail('access_evidence_filesystem_allowlist_invalid');
  if (!deepEqual(access.networkAllowlist, ['127.0.0.1', '::1', 'localhost']) || !deepEqual(access.cspHeaders, { 'content-security-policy': EXPECTED_CSP })) fail('access_evidence_allowlist_invalid');
  const readable = new Set(['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((item) => item.logicalPath), ...fixedPaths, ...(manifest.mode === 'adjudication-reveal' ? ['mutable/adjudication-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'] : ['mutable/worksheet-seed.json', 'mutable/edit-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'])]);
  const writable = new Set(manifest.mode === 'adjudication-reveal' ? ['mutable/adjudication-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'] : ['mutable/edit-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json']);
  const journalName = manifest.mode === 'adjudication-reveal' ? 'adjudication-journal.json' : 'edit-journal.json';
  const tempWrite = new RegExp(`^mutable/\\.(?:${journalName.replace('.', '\\.')}\\.next|actor-attestation\\.next|access-evidence\\.seal)-[1-9][0-9]*-[0-9a-f]{24}$`, 'u');
  const exactLoopback = (value) => { const match = /^(?:127\.0\.0\.1|::1):([1-9][0-9]{0,4})$/u.exec(value); return Boolean(match) && Number(match[1]) <= 65_535; }; const frameLock = /^session\/frame-lock\/[1-9][0-9]*$/u;
  for (const event of access.actualOpenEvents) {
    if (event.result !== 'allowed') continue;
    const valid = event.operation === 'read' ? readable.has(event.logicalPath)
      : event.operation === 'write' ? writable.has(event.logicalPath) || tempWrite.test(event.logicalPath)
        : event.operation === 'connect' || event.operation === 'bind' ? exactLoopback(event.logicalPath)
          : event.operation === 'lock' || event.operation === 'unlock' ? frameLock.test(event.logicalPath) : false;
    if (!valid) fail(event.operation === 'read' ? 'access_evidence_allowed_read_invalid' : event.operation === 'write' ? 'access_evidence_allowed_write_invalid' : ['connect', 'bind'].includes(event.operation) ? 'access_evidence_allowed_connect_invalid' : 'access_evidence_allowed_event_invalid');
  }
}

async function runExactPreflight(publicState) {
  const reports = [];
  for (const source of publicState.sourceInventory.paired) {
    const child = spawnSync(process.execPath, [EXACT_DECODER, '--video', path.join(REPO_ROOT, source.video.path), '--manifest', path.join(REPO_ROOT, PUBLIC_PATHS.decoderManifest), '--clip-id', source.clipId, '--expected-video-sha256', source.video.sha256], { cwd: REPO_ROOT, encoding: null, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.status !== 0) fail('source_exact_pts_preflight_failed', child.stderr.toString('utf8'));
    const report = parseJsonBuffer(child.stdout); if (report.status !== 'exact_pts_preflight_pass' || report.rows !== source.decoderRowCount || report.firstPtsTicks !== source.firstPtsTicks || report.lastPtsTicks !== source.lastPtsTicks) fail('source_exact_pts_preflight_failed'); reports.push(report);
  }
  return reports;
}

async function blindAssets(publicState) {
  const assets = readFrozenAssetDescriptors();
  const add = async (sourcePath, logicalPath, assetClass, executable = false) => assets.push(await descriptor(sourcePath, logicalPath, assetClass, executable));
  await add(path.join(REPO_ROOT, PUBLIC_PATHS.evaluationContract), 'immutable/authority/evaluation-contract.json', 'authority_snapshot');
  await add(path.join(REPO_ROOT, PUBLIC_PATHS.labelSchema), 'immutable/authority/label-schema.json', 'authority_snapshot');
  await add(path.join(REPO_ROOT, PUBLIC_PATHS.authoringSchema), 'immutable/authority/authoring-schema.json', 'authority_snapshot');
  await add(path.join(REPO_ROOT, PUBLIC_PATHS.sourceInventory), 'immutable/authority/source-inventory.json', 'authority_snapshot');
  await add(path.join(REPO_ROOT, PUBLIC_PATHS.decoderManifest), 'immutable/authority/decoder-manifest.jsonl', 'authority_snapshot');
  await add(COMPILER, 'immutable/authority/sam-goal-manual-pack-v3.mjs', 'authority_snapshot');
  for (const source of publicState.sourceInventory.paired) await add(path.join(REPO_ROOT, source.video.path), `immutable/sources/${source.clipId}.mp4`, 'source_copy');
  assets.sort((a, b) => rawUtf8Compare(a.logicalPath, b.logicalPath)); return assets;
}

function manifestFromAssets({ assets, publicState, mode, actorPseudonymSha256, cycleId }) {
  const immutableAssets = assets.map(({ sourcePath: _sourcePath, ...asset }) => asset);
  return {
    artifactType: 'sam-goal-review-bundle-manifest-v1', schemaVersion: 1, ...PROCESS_MARKER,
    cycleId, mode, actorPseudonymSha256, publicPins: PUBLIC_PINS,
    sourceBinding: processSourceBinding(publicState), rulebookByteSha256: immutableAssets.find((x) => x.logicalPath === 'immutable/rulebook.md').sha256,
    presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    immutableAssets, runtimeExecutableLogicalPath: 'immutable/runtime/node', launcherLogicalPath: 'immutable/launcher.mjs',
    processDecoderLogicalPaths: immutableAssets.filter((x) => x.assetClass === 'process_decoder').map((x) => x.logicalPath),
    immutableAssetSetSha256: canonicalHash(immutableAssets), mutableLogicalRoots: ['mutable'],
  };
}

async function prepareBundle(flags, publicState) {
  const assets = await blindAssets(publicState); const preflight = await runExactPreflight(publicState);
  const manifest = manifestFromAssets({ assets, publicState, mode: flags['--mode'], actorPseudonymSha256: flags['--actor-pseudonym-sha256'], cycleId: flags['--cycle-id'] }); validateProcessArtifact(manifest, publicState); assertManifestFrozenAssetDescriptors(manifest, { verifyCurrentSources: false });
  const manifestBytes = processBytes(manifest); const manifestHash = sha256(manifestBytes);
  const worksheet = createWorksheet({ publicState, mode: flags['--mode'], actorPseudonymSha256: flags['--actor-pseudonym-sha256'], cycleId: flags['--cycle-id'], bundleManifestByteSha256: manifestHash, rulebookByteSha256: manifest.rulebookByteSha256 }); validateWorksheet(worksheet, publicState);
  const journal = { artifactType: 'sam-goal-review-edit-journal-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: flags['--cycle-id'], mode: flags['--mode'], actorPseudonymSha256: flags['--actor-pseudonym-sha256'], bundleManifestByteSha256: manifestHash, events: [] }; validateProcessArtifact(journal, publicState);
  const commit = await commitBundleTree(flags['--bundle-dir'], { copiedAssets: assets, generatedFiles: {
    'immutable/bundle-manifest.json': { bytes: manifestBytes, mode: 0o400 },
    'mutable/worksheet-seed.json': { bytes: processBytes(worksheet), mode: 0o600 },
    'mutable/edit-journal.json': { bytes: processBytes(journal), mode: 0o600 },
  } });
  result({ status: commit.status === 'committed' ? 'blind_bundle_prepared' : commit.status, committed: commit.committed, bundleDir: path.resolve(flags['--bundle-dir']), bundleManifestByteSha256: manifestHash, immutableAssetSetSha256: manifest.immutableAssetSetSha256, rulebookByteSha256: manifest.rulebookByteSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, exactPtsPreflight: preflight });
}

async function recursiveFiles(root, prefix = '') {
  const resultFiles = []; for (const entry of await fsp.readdir(path.join(root, prefix), { withFileTypes: true })) { const logical = path.posix.join(prefix, entry.name); if (entry.isSymbolicLink()) fail('bundle_symlink_forbidden'); if (entry.isDirectory()) resultFiles.push(...await recursiveFiles(root, logical)); else if (entry.isFile()) resultFiles.push(logical); else fail('bundle_nonregular_forbidden'); } return resultFiles;
}

async function assertBundleDirectoryModes(root, prefix = '') {
  const directory = path.join(root, prefix); const stat = await fsp.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o700) fail('bundle_asset_mode_drift');
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) await assertBundleDirectoryModes(root, path.posix.join(prefix, entry.name));
}

async function verifyBundle(bundleDir, publicState, { expectedMode, phase } = {}) {
  if (!['unsealed-start', 'sealed-current'].includes(phase)) fail('bundle_verification_phase_invalid');
  const root = path.resolve(bundleDir); const rootStat = await fsp.lstat(root); if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('bundle_root_invalid'); await assertBundleDirectoryModes(root);
  const manifestFile = path.join(root, 'immutable/bundle-manifest.json'); const manifestSnapshot = snapshotPathSync(manifestFile); let manifest;
  let manifestByteSha256;
  try { manifest = parseJsonBuffer(manifestSnapshot.bytes, { processArtifact: true }); if (!manifestSnapshot.bytes.equals(processBytes(manifest))) fail('bundle_manifest_not_canonical'); manifestByteSha256 = manifestSnapshot.sha256; validateProcessArtifact(manifest, publicState); assertManifestFrozenAssetDescriptors(manifest); } finally { closeSnapshot(manifestSnapshot); }
  if (expectedMode && manifest.mode !== expectedMode) fail('bundle_mode_mismatch');
  const allowedImmutable = new Set(['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((x) => x.logicalPath)]);
  const actualImmutable = (await recursiveFiles(root, 'immutable')).sort(rawUtf8Compare); if (!deepEqual(actualImmutable, [...allowedImmutable].sort(rawUtf8Compare))) fail('bundle_immutable_member_set_invalid');
  for (const asset of manifest.immutableAssets) {
    const expectedAssetMode = asset.executable ? 0o500 : 0o400; const assetStat = await fsp.lstat(path.join(root, asset.logicalPath)); if ((assetStat.mode & 0o7777) !== expectedAssetMode) fail('bundle_asset_mode_drift');
    const snap = snapshotPathSync(path.join(root, asset.logicalPath), { expectedHash: asset.sha256, expectedMode: expectedAssetMode }); try { if (snap.bytes.length !== asset.bytes || Boolean(snap.stat.mode & 0o111) !== asset.executable) fail('bundle_asset_drift'); } finally { closeSnapshot(snap); }
  }
  for (const logical of ['mutable/worksheet-seed.json', 'mutable/edit-journal.json']) { const mutableStat = await fsp.lstat(path.join(root, logical)); if ((mutableStat.mode & 0o7777) !== 0o600) fail('bundle_asset_mode_drift'); }
  const seedSnapshot=snapshotPathSync(path.join(root,'mutable/worksheet-seed.json'), { expectedMode: 0o600 });const journalSnapshot=snapshotPathSync(path.join(root,'mutable/edit-journal.json'), { expectedMode: 0o600 });let seed,journal;
  try{seed=parseJsonBuffer(seedSnapshot.bytes,{processArtifact:true});journal=parseJsonBuffer(journalSnapshot.bytes,{processArtifact:true});if(!seedSnapshot.bytes.equals(processBytes(seed))||!journalSnapshot.bytes.equals(processBytes(journal)))fail('bundle_mutable_not_canonical');if(seed.bundleManifestByteSha256!==manifestByteSha256||journal.bundleManifestByteSha256!==manifestByteSha256||seed.cycleId!==manifest.cycleId||journal.cycleId!==manifest.cycleId||seed.actorPseudonymSha256!==manifest.actorPseudonymSha256||journal.actorPseudonymSha256!==manifest.actorPseudonymSha256)fail('bundle_mutable_binding_mismatch');validateWorksheet(seed,publicState);validateProcessArtifact(journal,publicState);const exactSeed=createWorksheet({publicState,mode:manifest.mode,actorPseudonymSha256:manifest.actorPseudonymSha256,cycleId:manifest.cycleId,bundleManifestByteSha256:manifestByteSha256,rulebookByteSha256:manifest.rulebookByteSha256});if(!deepEqual(seed,exactSeed))fail('worksheet_seed_drift');if(phase==='unsealed-start'&&!deepEqual(journal.events,[]))fail('bundle_initial_mutable_state_invalid');const worksheet=replayWorksheetJournal(seed,journal,publicState);revalidateSnapshotSync(seedSnapshot);revalidateSnapshotSync(journalSnapshot);return {root,manifest,manifestByteSha256,worksheet,seed,journal,seedSnapshot,journalSnapshot};}catch(error){closeSnapshot(seedSnapshot);closeSnapshot(journalSnapshot);throw error}
}

async function peekBundleMode(bundleDir) {
  const snapshot = snapshotPathSync(path.join(path.resolve(bundleDir), 'immutable/bundle-manifest.json'), { expectedMode: 0o400 });
  try { const manifest = parseJsonBuffer(snapshot.bytes, { processArtifact: true }); if (!snapshot.bytes.equals(processBytes(manifest))) fail('bundle_manifest_not_canonical'); return manifest.mode; } finally { closeSnapshot(snapshot); }
}

async function verifyUnsealedRevealBundle(bundleDir, publicState) {
  const root = path.resolve(bundleDir); await assertBundleDirectoryModes(root); const extraSnapshots = [];
  try {
    const manifestSnapshot = snapshotPathSync(path.join(root, 'immutable/bundle-manifest.json'), { expectedMode: 0o400 }); extraSnapshots.push(manifestSnapshot); const manifest = parseJsonBuffer(manifestSnapshot.bytes, { processArtifact: true }); if (!manifestSnapshot.bytes.equals(processBytes(manifest))) fail('bundle_manifest_not_canonical'); validateProcessArtifact(manifest, publicState); assertManifestFrozenAssetDescriptors(manifest); if (manifest.mode !== 'adjudication-reveal') fail('bundle_mode_mismatch');
    const actualImmutable = (await recursiveFiles(root, 'immutable')).sort(rawUtf8Compare); if (!deepEqual(actualImmutable, ['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((asset) => asset.logicalPath)].sort(rawUtf8Compare))) fail('bundle_immutable_member_set_invalid');
    for (const asset of manifest.immutableAssets) { const mode = asset.executable ? 0o500 : 0o400; const snapshot = snapshotPathSync(path.join(root, asset.logicalPath), { expectedHash: asset.sha256, expectedMode: mode }); if (snapshot.bytes.length !== asset.bytes) fail('bundle_asset_drift'); closeSnapshot(snapshot); }
    const fixedSnapshots = new Map(); for (const logical of REVEAL_FIXED_LOGICAL_PATHS) { const snapshot = snapshotPathSync(path.join(root, logical), { expectedMode: 0o400 }); fixedSnapshots.set(logical, snapshot); extraSnapshots.push(snapshot); }
    if (!deepEqual((await recursiveFiles(root, 'fixed')).sort(rawUtf8Compare), [...REVEAL_FIXED_LOGICAL_PATHS].sort(rawUtf8Compare))) fail('reveal_fixed_set_invalid');
    const journalSnapshot = snapshotPathSync(path.join(root, 'mutable/adjudication-journal.json'), { expectedMode: 0o600 }); extraSnapshots.push(journalSnapshot); if (!deepEqual((await recursiveFiles(root, 'mutable')).sort(rawUtf8Compare), ['mutable/adjudication-journal.json'])) fail('bundle_unsealed_member_set_invalid');
    const reviewA = parseJsonBuffer(fixedSnapshots.get('fixed/review-a.json').bytes, { processArtifact: true }); const reviewB = parseJsonBuffer(fixedSnapshots.get('fixed/review-b.json').bytes, { processArtifact: true }); validateFormalAuthoring(reviewA); validateFormalAuthoring(reviewB);
    const receiptA = parseJsonBuffer(fixedSnapshots.get('fixed/review-a-export-receipt.json').bytes, { processArtifact: true }); const receiptB = parseJsonBuffer(fixedSnapshots.get('fixed/review-b-export-receipt.json').bytes, { processArtifact: true }); const c0 = parseJsonBuffer(fixedSnapshots.get('fixed/c0-ledger.json').bytes, { processArtifact: true }); const raw = parseJsonBuffer(fixedSnapshots.get('fixed/raw-ab-report.json').bytes, { processArtifact: true }); const revealReceipt = parseJsonBuffer(fixedSnapshots.get('fixed/reveal-receipt.json').bytes, { processArtifact: true }); validateProcessArtifact(receiptA, publicState); validateProcessArtifact(receiptB, publicState); validateProcessArtifact(c0, publicState); validateProcessArtifact(raw, publicState); validateProcessArtifact(revealReceipt, publicState);
    const skeleton = parseJsonBuffer(fixedSnapshots.get('fixed/disagreement-skeleton.json').bytes, { processArtifact: true }); const accessPolicy = parseJsonBuffer(fixedSnapshots.get('fixed/access-policy.json').bytes, { processArtifact: true }); const journal = parseJsonBuffer(journalSnapshot.bytes, { processArtifact: true }); validateProcessArtifact(journal, publicState); if (!deepEqual(journal.events, [])) fail('bundle_initial_mutable_state_invalid');
    assertRevealFixedPrerequisites({ manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, reviewA, reviewB, receiptA, receiptB, c0, raw, skeleton, revealReceipt, accessPolicy, journal, publicState });
    const replay = replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: fixedSnapshots.get('fixed/reveal-receipt.json').sha256 });
    return { root, manifest, manifestByteSha256: manifestSnapshot.sha256, manifestSnapshot, seed: skeleton, seedSnapshot: fixedSnapshots.get('fixed/disagreement-skeleton.json'), journal, journalSnapshot, worksheet: { ...replay.finalState, sourceBinding: manifest.sourceBinding, rows: c0.rows, windows: c0.windows }, replay, fixedSnapshots, extraSnapshots };
  } catch (error) { for (const snapshot of extraSnapshots) closeSnapshot(snapshot); throw error; }
}

function loopbackProbe(port) {
  return new Promise((resolve, reject) => { const request = http.get({ host: '127.0.0.1', port, path: '/api/manifest', timeout: 3000 }, (response) => { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => response.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error('loopback_probe_status'))); }); request.on('timeout', () => request.destroy(new Error('loopback_probe_timeout'))); request.on('error', reject); });
}

async function coordinatorFinalTestBarrier(throwIfInterrupted = () => {}) {
  const barrier = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_BARRIER_PATH; const release = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_RELEASE_PATH;
  if (barrier === undefined && release === undefined) return;
  if (process.env.NODE_ENV !== 'test' || process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST !== '1' || !barrier || !release || !path.isAbsolute(barrier) || !path.isAbsolute(release) || pathsOverlap(barrier, release)) fail('test_hook_invalid');
  await writeExclusiveFile(barrier, processBytes({ status: 'coordinator_final_barrier' }), 0o600); const deadline = Date.now() + 30_000;
  try {
    for (;;) {
      throwIfInterrupted();
      try { const stat = await fsp.lstat(release); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o600) fail('serve_final_barrier_release_invalid'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Date.now() >= deadline) fail('serve_final_barrier_timeout'); await new Promise((resolve) => setTimeout(resolve, 5)); throwIfInterrupted();
    }
  } finally { await fsp.unlink(barrier).catch((error) => { if (error.code !== 'ENOENT') throw error; }); await fsp.unlink(release).catch((error) => { if (error.code !== 'ENOENT') throw error; }); }
}

async function serveBundle(flags) {
  let publicState; let bundleMode; let bundle; let child; let childExitPromise; let childStdinFailure; let childStdinErrorHandler; let sealedSession; let lineReader; let preSpawnProof; let siblingSnapshot; let trustedOpenatSnapshot; const terminalSnapshots = []; let serveSignalError; let rejectServeSignal;
  const serveSignalFailure = new Promise((_, reject) => { rejectServeSignal = reject; }); void serveSignalFailure.catch(() => {});
  const signalHandlers = Object.fromEntries([['SIGINT', 130], ['SIGTERM', 143]].map(([signal, exitCode]) => [signal, () => { if (serveSignalError) return; serveSignalError = new MroError('serve_interrupted', signal, { exitCode }); try { child?.kill('SIGTERM'); } catch {} rejectServeSignal(serveSignalError); }]));
  for (const [signal, handler] of Object.entries(signalHandlers)) process.on(signal, handler);
  if (process.exitCode === 130) signalHandlers.SIGINT(); else if (process.exitCode === 143) signalHandlers.SIGTERM();
  const throwIfServeSignal = () => { if (serveSignalError) throw serveSignalError; };
  try {
    throwIfServeSignal(); publicState = await Promise.race([verifyPublicPins(), serveSignalFailure]); throwIfServeSignal();
    throwIfServeSignal(); bundleMode = await Promise.race([peekBundleMode(flags['--bundle-dir']), serveSignalFailure]); throwIfServeSignal();
    bundle = await Promise.race([bundleMode === 'adjudication-reveal' ? verifyUnsealedRevealBundle(flags['--bundle-dir'], publicState) : verifyBundle(flags['--bundle-dir'], publicState, { phase: 'unsealed-start' }), serveSignalFailure]); throwIfServeSignal();
    const fault = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_SERVE_TEST;
    if (fault !== undefined) {
      if (process.env.NODE_ENV !== 'test' || process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST !== '1' || !['startup-hang', 'oversize-ready', 'duplicate-key-ready', 'malformed-ready', 'extra-ready-line', 'crash-after-ready'].includes(fault)) fail('test_hook_invalid');
    }
    const expectedInitialTree = {
      'immutable/bundle-manifest.json': { bytes: processBytes(bundle.manifest).length, sha256: bundle.manifestByteSha256, mode: 0o400 },
      ...Object.fromEntries(bundle.manifest.immutableAssets.map((asset) => [asset.logicalPath, { bytes: asset.bytes, sha256: asset.sha256, mode: asset.executable ? 0o500 : 0o400 }])),
      ...(bundleMode === 'adjudication-reveal' ? Object.fromEntries([...bundle.fixedSnapshots].map(([logical, snapshot]) => [logical, { bytes: snapshot.bytes.length, sha256: snapshot.sha256, mode: 0o400 }])) : { 'mutable/worksheet-seed.json': { bytes: bundle.seedSnapshot.bytes.length, sha256: bundle.seedSnapshot.sha256, mode: 0o600 } }),
      [bundleMode === 'adjudication-reveal' ? 'mutable/adjudication-journal.json' : 'mutable/edit-journal.json']: { bytes: bundle.journalSnapshot.bytes.length, sha256: bundle.journalSnapshot.sha256, mode: 0o600 },
    };
    const expectedInitial = Object.keys(expectedInitialTree).sort(rawUtf8Compare); if (!deepEqual((await recursiveFiles(bundle.root)).sort(rawUtf8Compare), expectedInitial)) fail('bundle_unsealed_member_set_invalid');
    preSpawnProof = proveExactTreeSync(bundle.root, expectedInitialTree); revalidateExactTreeProofSync(preSpawnProof);
    const runtime = path.join(bundle.root, bundle.manifest.runtimeExecutableLogicalPath); const launcher = path.join(bundle.root, bundle.manifest.launcherLogicalPath); const preload = path.join(bundle.root, 'immutable/sandbox-preload.cjs'); const mutable = path.join(bundle.root, 'mutable');
    const bundledOpenat = bundle.manifest.immutableAssets.find((asset) => asset.logicalPath === 'immutable/coordinator-openat.node'); if (!bundledOpenat || bundledOpenat.sha256 !== COORDINATOR_OPENAT_NODE_SHA256 || preSpawnProof.snapshots['immutable/coordinator-openat.node']?.sha256 !== COORDINATOR_OPENAT_NODE_SHA256) fail('coordinator_openat_bundle_pin_mismatch');
    trustedOpenatSnapshot = snapshotPathSync(path.join(OWNED_VIEWER, 'coordinator-openat.node'), { expectedHash: COORDINATOR_OPENAT_NODE_SHA256 }); const coordinatorOpenat = require(path.join(OWNED_VIEWER, 'coordinator-openat.node')); revalidateSnapshotSync(trustedOpenatSnapshot); revalidateHeldExactTreeAnchorsSync(preSpawnProof);
    const hostProbe = path.join(REPO_ROOT, 'package.json'); const siblingProbe = path.join(path.dirname(bundle.root), `.${path.basename(bundle.root)}.mro-sibling-probe-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
    await writeExclusiveFile(siblingProbe, processBytes({ status: 'coordinator_owned_sibling_probe' }), 0o600); throwIfServeSignal(); siblingSnapshot = snapshotPathSync(siblingProbe, { expectedMode: 0o600 });
    const argv = ['--permission', '--allow-addons', `--allow-fs-read=${bundle.root}`, `--allow-fs-write=${mutable}`, '--require', preload, launcher, '--bundle-root', bundle.root, '--host-repository-probe', hostProbe, '--sibling-probe', siblingProbe]; if (fault) argv.push('--test-fault', fault);
    const childEnv = fault ? { NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1' } : {};
    throwIfServeSignal(); child = spawn(runtime, argv, { cwd: bundle.root, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let rejectChildStdinFailure; let childStdinError;
    childStdinFailure = new Promise((_, reject) => { rejectChildStdinFailure = reject; }); void childStdinFailure.catch(() => {});
    childStdinErrorHandler = (error) => { if (childStdinError) return; childStdinError = new MroError('serve_ack_write_failed', error?.message); rejectChildStdinFailure(childStdinError); };
    child.stdin.on('error', childStdinErrorHandler); throwIfServeSignal();
    let privateByteCount = 0; let privateProtocolReject; const privateProtocolFailure = new Promise((_, reject) => { privateProtocolReject = reject; }); let childStderrBytes = 0;
    child.stderr.on('data', (chunk) => { childStderrBytes += chunk.length; if (childStderrBytes > 65_536) privateProtocolReject(new MroError('serve_private_stderr_oversize')); });
    childExitPromise = new Promise((resolve) => { child.once('error', (error) => resolve({ status: null, signal: null, error })); child.once('exit', (status, signal) => resolve({ status, signal })); });
    child.stdout.on('data', (chunk) => { privateByteCount += chunk.length; if (privateByteCount > 8_192) privateProtocolReject(new MroError('serve_private_output_oversize')); else if (chunk.includes(0x0d)) privateProtocolReject(new MroError('serve_private_output_invalid')); });
    lineReader = readline.createInterface({ input: child.stdout, crlfDelay: Infinity }); const iterator = lineReader[Symbol.asyncIterator]();
    const nextLine = async (timeoutMs, code) => {
      let timer; try { const line = await Promise.race([iterator.next(), privateProtocolFailure, childStdinFailure, serveSignalFailure, new Promise((_, reject) => { timer = setTimeout(() => reject(new MroError(code)), timeoutMs); })]); if (!line.done && Buffer.byteLength(line.value, 'utf8') > 4_096) fail('serve_private_output_oversize'); return line; } finally { clearTimeout(timer); }
    };
    const readyLine = await nextLine(10_000, 'serve_start_timeout');
    if (readyLine.done) fail('serve_child_exit'); let serving; try { serving = parseJsonBuffer(Buffer.from(readyLine.value, 'utf8')); } catch (error) { throw error instanceof MroError ? error : new MroError('serve_protocol_invalid'); }
    if (!deepEqual(Object.keys(serving).sort(rawUtf8Compare), ['csp', 'host', 'port', 'status']) || serving.status !== 'serving_source_only_bundle' || serving.host !== '127.0.0.1' || !Number.isInteger(serving.port) || serving.port < 1 || serving.port > 65535) fail('serve_protocol_invalid');
    revalidateSnapshotSync(siblingSnapshot); fs.unlinkSync(siblingProbe); const siblingHeld = fs.fstatSync(siblingSnapshot.fd); if (`${siblingHeld.dev}` !== siblingSnapshot.stat.dev || `${siblingHeld.ino}` !== siblingSnapshot.stat.ino) fail('sibling_probe_identity_drift'); siblingSnapshot.path = null;
    const loopbackBytes = await Promise.race([loopbackProbe(serving.port), serveSignalFailure]); throwIfServeSignal(); if (sha256(loopbackBytes) !== sha256(processBytes(bundle.manifest))) fail('external_loopback_probe_failed');
    process.stderr.write(processBytes({ status: 'review_ui_ready', host: '127.0.0.1', port: serving.port }));
    const finalLine = await nextLine(PRIVATE_PROTOCOL_TIMEOUT_MS, 'serve_final_timeout'); if (finalLine.done) fail('serve_child_exit'); let privateFinal; try { privateFinal = parseJsonBuffer(Buffer.from(finalLine.value, 'utf8')); } catch (error) { throw error instanceof MroError ? error : new MroError('serve_protocol_invalid'); }
    if (!deepEqual(privateFinal, { status: 'review_session_final' })) fail('serve_protocol_invalid');
    await coordinatorFinalTestBarrier(throwIfServeSignal); throwIfServeSignal();
    const journalLogical = bundleMode === 'adjudication-reveal' ? 'mutable/adjudication-journal.json' : 'mutable/edit-journal.json'; const journalName = path.basename(journalLogical); const terminalNames = [journalName, 'actor-attestation.json', 'access-evidence.json'];
    revalidateHeldExactTreeAnchorsSync(preSpawnProof, { skipLogicalPaths: [journalLogical] });
    for (const name of terminalNames) terminalSnapshots.push(snapshotDirectChildAtSync(preSpawnProof, 'mutable', name, coordinatorOpenat, { allowedNames: terminalNames, expectedMode: 0o600 }));
    assertDistinctSnapshots(terminalSnapshots); sealedSession = await Promise.race([bundleMode === 'adjudication-reveal' ? openSealedRevealSession(bundle.root, publicState) : openSealedBlindSession(bundle.root, publicState), serveSignalFailure]); throwIfServeSignal();
    const pathnameTerminals = bundleMode === 'adjudication-reveal' ? [sealedSession.journalSnapshot, sealedSession.attestationSnapshot, sealedSession.accessSnapshot] : [sealedSession.bundle.journalSnapshot, sealedSession.evidence.attestationSnapshot, sealedSession.evidence.accessSnapshot];
    for (const [relative, pathname] of terminalSnapshots.map((snapshot, index) => [snapshot, pathnameTerminals[index]])) if (relative.stat.dev !== pathname.stat.dev || relative.stat.ino !== pathname.stat.ino || relative.sha256 !== pathname.sha256 || !relative.bytes.equals(pathname.bytes)) fail('coordinator_terminal_snapshot_mismatch');
    const revalidateFinalSession = () => bundleMode === 'adjudication-reveal' ? revalidateSealedRevealSession(sealedSession) : revalidateSealedSession(sealedSession); revalidateFinalSession();
    let ackTimer; const ackWrite = new Promise((resolve, reject) => { try { child.stdin.write(Buffer.from('ACK\n'), (error) => error ? reject(new MroError('serve_ack_write_failed', error.message)) : resolve({ status: 'ack_written' })); } catch (error) { reject(new MroError('serve_ack_write_failed', error.message)); } });
    const ack = await Promise.race([ackWrite, childStdinFailure, serveSignalFailure, childExitPromise.then((exit) => { throw new MroError('serve_ack_child_exit', JSON.stringify(exit)); }), new Promise((_, reject) => { ackTimer = setTimeout(() => reject(new MroError('serve_ack_timeout')), PRIVATE_PROTOCOL_TIMEOUT_MS); })]).finally(() => clearTimeout(ackTimer)); if (ack.status !== 'ack_written') fail('serve_ack_write_failed');
    const exited = await Promise.race([childExitPromise, childStdinFailure, serveSignalFailure, new Promise((_, reject) => setTimeout(() => reject(new MroError('serve_reap_timeout')), 10_000))]);
    if (exited.status !== 0 || exited.signal !== null) fail('serve_child_unclean_exit');
    const extra = await nextLine(1_000, 'serve_private_output_timeout'); if (!extra.done) fail('serve_private_output_extra');
    for (const snapshot of terminalSnapshots) revalidateSnapshotSync(snapshot); revalidateSnapshotSync(trustedOpenatSnapshot); revalidateHeldExactTreeAnchorsSync(preSpawnProof, { skipLogicalPaths: [journalLogical] }); revalidateFinalSession(); await Promise.race([verifyPublicPins(), serveSignalFailure]); throwIfServeSignal(); for (const snapshot of terminalSnapshots) revalidateSnapshotSync(snapshot); revalidateSnapshotSync(trustedOpenatSnapshot); revalidateHeldExactTreeAnchorsSync(preSpawnProof, { skipLogicalPaths: [journalLogical] }); revalidateFinalSession();
    result(makeSessionSealEnvelope(sealedSession.descriptor));
  } catch (error) {
    if (child && child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGTERM'); } catch {}
      let killTimer; let reapTimer;
      try {
        await Promise.race([childExitPromise, new Promise((_, reject) => {
          killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch {} }, 2_000);
          reapTimer = setTimeout(() => reject(new MroError('serve_child_reap_failed', 'child did not emit exit after SIGKILL', serveSignalError?.details)), 5_000);
        })]);
      } catch (reapError) {
        if (serveSignalError && !Number.isInteger(reapError?.details?.exitCode)) reapError.details = serveSignalError.details;
        throw reapError;
      } finally { clearTimeout(killTimer); clearTimeout(reapTimer); }
    }
    if (serveSignalError) throw serveSignalError;
    throw error;
  } finally {
    for (const [signal, handler] of Object.entries(signalHandlers)) process.off(signal, handler);
    try { child?.stdin?.destroy(); } catch {} if (child?.stdin && childStdinErrorHandler) child.stdin.off('error', childStdinErrorHandler);
    lineReader?.close();
    if (siblingSnapshot?.path) { try { revalidateSnapshotSync(siblingSnapshot); fs.unlinkSync(siblingSnapshot.path); siblingSnapshot.path = null; } catch {} }
    closeSnapshot(siblingSnapshot); closeSnapshot(trustedOpenatSnapshot); for (const snapshot of terminalSnapshots) closeSnapshot(snapshot); closeExactTreeProof(preSpawnProof); if (bundleMode === 'adjudication-reveal') closeSealedRevealSession(sealedSession); else closeSealedSession(sealedSession); closeBundle(bundle);
  }
}

function assertJournalLockedTarget(worksheet, action, publicState) {
  if (action.actorPseudonymSha256 !== worksheet.actorPseudonymSha256) fail('journal_actor_mismatch');
  const source = publicState.sourceInventory.paired.find((item) => item.clipId === action.clipId); if (!source || !Number.isInteger(action.startFrameIndex) || !Number.isInteger(action.endFrameIndexExclusive) || action.startFrameIndex < 0 || action.startFrameIndex >= action.endFrameIndexExclusive || action.endFrameIndexExclusive > source.decoderRowCount) fail('journal_range_invalid');
  const row = worksheet.rows.find((item) => item.clipId === action.clipId && item.sourceFrameIndex === action.lockedIdentity?.sourceFrameIndex); if (!row || !deepEqual(exactIdentity(row), action.lockedIdentity) || row.sourceFrameIndex < action.startFrameIndex || row.sourceFrameIndex >= action.endFrameIndexExclusive) fail('journal_locked_identity_invalid');
}
function applyJournalAction(worksheet, action, publicState) {
  if (['navigate', 'playback'].includes(action.action)) return;
  assertJournalLockedTarget(worksheet, action, publicState);
  if (action.action === 'create-overlay') {
    if (action.windowId === `base-${action.clipId}` || worksheet.windows.some((window) => window.clipId === action.clipId && window.windowId === action.windowId)) fail('journal_overlay_identity_invalid');
    worksheet.windows.push({ windowId: action.windowId, clipId: action.clipId, startFrameIndex: action.startFrameIndex, endFrameIndexExclusive: action.endFrameIndexExclusive, origin: 'actor_overlay', purposeTags: { status: 'UNSET' }, scenarioTags: { status: 'UNSET' } }); return;
  }
  if (!['set', 'undo'].includes(action.action)) fail('journal_action_invalid');
  if (action.fieldPath.startsWith('/windowsById/')) {
    const match = /^\/windowsById\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(purposeTags|scenarioTags)$/u.exec(action.fieldPath); if (!match) fail('journal_window_mutation_forbidden'); const [, id, child] = match; const window = worksheet.windows.find((item) => item.clipId === action.clipId && item.windowId === id); if (!window || action.startFrameIndex !== window.startFrameIndex || action.endFrameIndexExclusive !== window.endFrameIndexExclusive) fail('journal_window_target_mismatch');
    if (window.origin === 'structural_base' && child !== 'scenarioTags') fail('journal_base_mutation_forbidden'); if (window.origin === 'actor_overlay' && !['purposeTags', 'scenarioTags'].includes(child)) fail('journal_overlay_mutation_forbidden');
    const type = child === 'purposeTags' ? 'purpose-array' : 'scenario-array'; if (action.valueType !== type) fail('journal_value_type_mismatch'); window[child] = structuredClone(action.value); return;
  }
  const types = new Map([['scenarios','scenario-array'],['presence','presence'],['personState','person-state'],['occlusion/body','occlusion-state'],['occlusion/leftFoot','occlusion-state'],['occlusion/rightFoot','occlusion-state'],['occlusion/leftHand','occlusion-state'],['occlusion/rightHand','occlusion-state'],['contact/left','contact-state'],['contact/right','contact-state'],['handObservability/left','hand-observability-state'],['handObservability/right','hand-observability-state'],['endpointObservability/leftWrist','endpoint-observability-state'],['endpointObservability/rightWrist','endpoint-observability-state'],['endpointObservability/leftAnkle','endpoint-observability-state'],['endpointObservability/rightAnkle','endpoint-observability-state'],['endpointObservability/head','endpoint-observability-state'],['subjectSelection/state','subject-state'],['subjectSelection/manualTargetId','manual-target-id'],['subjectSelection/anchor','anchor']]);
  if (types.get(action.fieldPath) !== action.valueType) fail('journal_value_type_mismatch'); let count = 0;
  for (const row of worksheet.rows) if (row.clipId === action.clipId && row.sourceFrameIndex >= action.startFrameIndex && row.sourceFrameIndex < action.endFrameIndexExclusive) {
    if (action.fieldPath === 'scenarios') row.scenarios = structuredClone(action.value);
    else { const parts = action.fieldPath.split('/'); let target = row.manualState; for (let i = 0; i < parts.length - 1; i += 1) target = target[parts[i]]; target[parts.at(-1)] = structuredClone(action.value); } count += 1;
  }
  if (!count) fail('journal_range_empty');
}

function replayJournal(bundle, publicState) {
  const replay = replayWorksheetJournal(bundle.seed, bundle.journal, publicState);
  if (!deepEqual(replay.rows, bundle.worksheet.rows) || !deepEqual(replay.windows, bundle.worksheet.windows)) fail('worksheet_not_explicit_journal_replay');
}

async function readBundleEvidence(bundle, publicState) {
  const accessSnapshot=snapshotPathSync(path.join(bundle.root,'mutable/access-evidence.json'));const accessBytes=accessSnapshot.bytes;const journalBytes=bundle.journalSnapshot.bytes;
  const access = parseJsonBuffer(accessBytes, { processArtifact: true }); const journal = bundle.journal; validateProcessArtifact(access, publicState); validateProcessArtifact(journal, publicState);
  assertAccessEvidenceClosed(access, bundle.manifest);
  if (access.cycleId !== bundle.manifest.cycleId || access.mode !== bundle.manifest.mode || access.actorPseudonymSha256 !== bundle.manifest.actorPseudonymSha256 || access.bundleManifestByteSha256 !== bundle.manifestByteSha256 || access.immutableAssetSetSha256 !== bundle.manifest.immutableAssetSetSha256) fail('bundle_access_binding_mismatch');
  return { access, accessBytes, accessSnapshot, journal, journalBytes };
}
function closeBundle(bundle){closeSnapshot(bundle?.seedSnapshot);closeSnapshot(bundle?.journalSnapshot);for(const snapshot of bundle?.extraSnapshots??[])closeSnapshot(snapshot)}

function blindSessionExpectedTree(bundle, evidence) {
  const expected = {
    'immutable/bundle-manifest.json': { bytes: processBytes(bundle.manifest).length, sha256: bundle.manifestByteSha256, mode: 0o400 },
    ...Object.fromEntries(bundle.manifest.immutableAssets.map((asset) => [asset.logicalPath, { bytes: asset.bytes, sha256: asset.sha256, mode: asset.executable ? 0o500 : 0o400 }])),
    'mutable/worksheet-seed.json': { bytes: bundle.seedSnapshot.bytes.length, sha256: bundle.seedSnapshot.sha256, mode: 0o600 },
    'mutable/edit-journal.json': { bytes: bundle.journalSnapshot.bytes.length, sha256: bundle.journalSnapshot.sha256, mode: 0o600 },
    'mutable/actor-attestation.json': { bytes: evidence.attestationSnapshot.bytes.length, sha256: evidence.attestationSnapshot.sha256, mode: 0o600 },
    'mutable/access-evidence.json': { bytes: evidence.accessSnapshot.bytes.length, sha256: evidence.accessSnapshot.sha256, mode: 0o600 },
  };
  return expected;
}

function blindSessionDescriptor(bundle, evidence) {
  const fixedHash = fixedInputSetSha256([]);
  const finalStateBytes = processBytes(bundle.worksheet);
  const fields = {
    terminalState: 'closed', cycleId: bundle.manifest.cycleId, mode: bundle.manifest.mode, actorPseudonymSha256: bundle.manifest.actorPseudonymSha256,
    presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    bundleManifestByteSha256: bundle.manifestByteSha256, immutableAssetSetSha256: bundle.manifest.immutableAssetSetSha256,
    fixedInputSetSha256: fixedHash, sessionSeedByteSha256: bundle.seedSnapshot.sha256, sessionFinalStateByteSha256: sha256(finalStateBytes),
    editJournalByteSha256: bundle.journalSnapshot.sha256, actorAttestationByteSha256: evidence.attestationSnapshot.sha256, accessEvidenceByteSha256: evidence.accessSnapshot.sha256,
  };
  const access = evidence.access;
  if (access.presentationContractSha256 !== fields.presentationContractSha256 || access.fixedInputSetSha256 !== fields.fixedInputSetSha256 || access.sessionSeedByteSha256 !== fields.sessionSeedByteSha256 || access.sessionFinalStateByteSha256 !== fields.sessionFinalStateByteSha256 || access.editJournalByteSha256 !== fields.editJournalByteSha256 || access.actorAttestationByteSha256 !== fields.actorAttestationByteSha256) fail('bundle_access_binding_mismatch');
  return makeSessionTreeDescriptor(fields);
}

async function openSealedBlindSession(bundleDir, publicState, expectedSessionTreeSha256, { expectedMode } = {}) {
  const bundle = await verifyBundle(bundleDir, publicState, { expectedMode, phase: 'sealed-current' }); let evidence; let proof;
  try {
    if (bundle.manifest.mode === 'adjudication-reveal') fail('bundle_mode_mismatch');
    replayJournal(bundle, publicState); evidence = await readBundleEvidence(bundle, publicState);
    evidence.attestationSnapshot = snapshotPathSync(path.join(bundle.root, 'mutable/actor-attestation.json'), { expectedMode: 0o600 });
    const attestation = parseJsonBuffer(evidence.attestationSnapshot.bytes, { processArtifact: true });
    if (!deepEqual(Object.keys(attestation).sort(rawUtf8Compare), ['actorDeclaredNoOutsideInput', 'actorPseudonymSha256', 'cycleId']) || attestation.actorDeclaredNoOutsideInput !== true || attestation.actorPseudonymSha256 !== bundle.manifest.actorPseudonymSha256 || attestation.cycleId !== bundle.manifest.cycleId) fail('actor_attestation_invalid');
    proof = proveExactTreeSync(bundle.root, blindSessionExpectedTree(bundle, evidence)); revalidateExactTreeProofSync(proof);
    const descriptor = blindSessionDescriptor(bundle, evidence); const actualSessionTreeSha256 = expectedSessionTreeSha256 === undefined ? sessionTreeSha256(descriptor) : assertExpectedSessionTreeSha256(expectedSessionTreeSha256, descriptor); revalidateExactTreeProofSync(proof);
    return { bundle, evidence, proof, descriptor, sessionTreeSha256: actualSessionTreeSha256 };
  } catch (error) {
    closeExactTreeProof(proof); closeSnapshot(evidence?.attestationSnapshot); closeSnapshot(evidence?.accessSnapshot); closeBundle(bundle); throw error;
  }
}

function revalidateSealedSession(session) {
  revalidateExactTreeProofSync(session.proof); revalidateSnapshotSync(session.bundle.seedSnapshot); revalidateSnapshotSync(session.bundle.journalSnapshot); revalidateSnapshotSync(session.evidence.attestationSnapshot); revalidateSnapshotSync(session.evidence.accessSnapshot);
}

function closeSealedSession(session) {
  closeExactTreeProof(session?.proof); closeSnapshot(session?.evidence?.attestationSnapshot); closeSnapshot(session?.evidence?.accessSnapshot); closeBundle(session?.bundle);
}

async function runValidatorOpaque(reviewPath, role, pseudonym) {
  const child = await spawnTracked(process.execPath, [COMPILER, 'validate-review', '--review', reviewPath, '--expected-role', role, '--expected-reviewer-pseudonym-sha256', pseudonym], { cwd: REPO_ROOT, env: {} });
  let stdout = child.stdout;
  if (process.env.NODE_ENV === 'test' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST === '1' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64 !== undefined) stdout = Buffer.from(process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64, 'base64');
  let exitCode = child.status;
  if (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_VALIDATOR_EXIT_CODE !== undefined) {
    if (process.env.NODE_ENV !== 'test' || process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST !== '1' || !/^(?:0|[1-9][0-9]{0,2})$/u.test(process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_VALIDATOR_EXIT_CODE)) fail('test_hook_invalid');
    exitCode = Number(process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_VALIDATOR_EXIT_CODE);
  }
  return { exitCode, stdout, stderr: child.stderr, stdoutByteSha256: sha256(stdout) };
}

function maybeMutateStagedReviewForTest(reviewPath) {
  if (!(process.env.NODE_ENV === 'test' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST === '1')) return;
  const hook = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_AFTER_VALIDATOR_HOOK; if (!hook) return;
  if (hook === 'mutate') { fs.chmodSync(reviewPath, 0o600); fs.appendFileSync(reviewPath, Buffer.from(' ')); }
  else if (hook === 'replace') { const replacement = `${reviewPath}.replacement`; fs.writeFileSync(replacement, fs.readFileSync(reviewPath)); fs.renameSync(replacement, reviewPath); }
  else fail('test_hook_invalid');
}

async function exportReview(flags, publicState) {
  const session = await openSealedBlindSession(flags['--bundle-dir'], publicState, flags['--expected-session-tree-sha256']); const { bundle, evidence } = session;
  try { if (!['first', 'second'].includes(bundle.manifest.mode)) fail('review_export_mode_invalid');
  validateWorksheet(bundle.worksheet, publicState, { requireComplete: true, expectedMode: bundle.manifest.mode });
  const review = worksheetToReview(bundle.worksheet, publicState); validateFormalAuthoring(review); const reviewBytes = formalBytes(review); let receipt; let receiptBytes; let validator; let stagedSnapshot;
  let commit;
  try { commit = await commitDirectoryTransaction(flags['--output-dir'], ['review.json', 'review-export-receipt.json'], async (stage) => {
    const reviewPath = path.join(stage, 'review.json'); await writeExclusiveFile(reviewPath, reviewBytes, 0o400); revalidateSealedSession(session); stagedSnapshot = snapshotPathSync(reviewPath, { expectedMode: 0o400 });
      validator = await runValidatorOpaque(reviewPath, review.role, review.reviewerPseudonymSha256); revalidateSealedSession(session); if (validator.exitCode !== 0) fail('review_validator_failed', validator.stderr.toString('utf8'));
      maybeMutateStagedReviewForTest(reviewPath); revalidateSnapshotSync(stagedSnapshot); revalidateSealedSession(session);
      receipt = {
        artifactType: 'sam-goal-review-export-receipt-v1', schemaVersion: 1, ...PROCESS_MARKER,
        cycleId: bundle.manifest.cycleId, role: review.role, actorPseudonymSha256: review.reviewerPseudonymSha256,
        publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: bundle.manifest.rulebookByteSha256,
        presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
        bundleManifestByteSha256: bundle.manifestByteSha256, accessEvidenceByteSha256: sha256(evidence.accessBytes), editJournalByteSha256: sha256(evidence.journalBytes),
        formalReviewByteSha256: sha256(reviewBytes), formalReviewCanonicalSha256: review.expectedCanonicalHash,
        validatorInterfaceId: VALIDATOR_INTERFACE, validatorExitCode: 0, validatorStdoutByteSha256: validator.stdoutByteSha256, validatorStdoutBase64: validator.stdout.toString('base64'),
        sessionTreeSha256: session.sessionTreeSha256,
      };
      validateProcessArtifact(receipt, publicState); receiptBytes = processBytes(receipt); await writeExclusiveFile(path.join(stage, 'review-export-receipt.json'), receiptBytes, 0o400); revalidateSnapshotSync(stagedSnapshot); revalidateSealedSession(session);
      return { memberBytes: { 'review.json': reviewBytes, 'review-export-receipt.json': receiptBytes }, memberModes: { 'review.json': 0o400, 'review-export-receipt.json': 0o400 }, beforeCommit: async () => { revalidateSnapshotSync(stagedSnapshot); revalidateSealedSession(session); } };
  }); } finally { closeSnapshot(stagedSnapshot); }
  result({ status: commit.status === 'committed' ? 'raw_review_sealed' : commit.status, committed: commit.committed, outputDir: path.resolve(flags['--output-dir']), reviewPath: path.join(path.resolve(flags['--output-dir']), 'review.json'), receiptPath: path.join(path.resolve(flags['--output-dir']), 'review-export-receipt.json'), formalReviewByteSha256: sha256(reviewBytes), formalReviewCanonicalSha256: review.expectedCanonicalHash, receiptByteSha256: sha256(receiptBytes), validatorStdoutByteSha256: validator.stdoutByteSha256 });
  if (commit.status !== 'committed'||commit.signalExitCode) process.exitCode = commit.signalExitCode??1;
  }finally{closeSealedSession(session)}
}

async function sealC0(flags, publicState) {
  const session = await openSealedBlindSession(flags['--bundle-dir'], publicState, flags['--expected-session-tree-sha256'], { expectedMode: 'source-first-c0' }); const { bundle, evidence } = session;
  try { validateWorksheet(bundle.worksheet, publicState, { requireComplete: true, expectedMode: 'source-first-c0' });
  const ledger = { artifactType: 'sam-goal-source-first-c0-ledger-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: bundle.manifest.cycleId, adjudicatorPseudonymSha256: bundle.manifest.actorPseudonymSha256, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: bundle.manifest.rulebookByteSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, bundleManifestByteSha256: bundle.manifestByteSha256, accessEvidenceByteSha256: sha256(evidence.accessBytes), editJournalByteSha256: sha256(evidence.journalBytes), sourceOnly: true, abArtifactsObserved: false, windows: normalizeWindows(bundle.worksheet), rows: bundle.worksheet.rows.map((row) => structuredClone(row)), sessionTreeSha256: session.sessionTreeSha256 };
  validateProcessArtifact(ledger, publicState); revalidateSealedSession(session); const bytes = processBytes(ledger); const commit = await commitSingleFile(flags['--output'], bytes, { beforeCommit: async () => revalidateSealedSession(session) }); result({ status: commit.status === 'committed' ? 'source_first_c0_sealed' : commit.status, committed: commit.committed, output: path.resolve(flags['--output']), c0LedgerByteSha256: sha256(bytes), rowCount: ledger.rows.length, sessionTreeSha256: session.sessionTreeSha256 }); if (commit.status !== 'committed'||commit.signalExitCode) process.exitCode = commit.signalExitCode??1;
  }finally{closeSealedSession(session)}
}

function openProcessFile(filePath, expectedHash, expectedType, publicState, expectedMode = 0o600) {
  const snapshot = snapshotPathSync(filePath, { expectedHash, expectedMode });
  try { const document = parseJsonBuffer(snapshot.bytes, { processArtifact: true }); validateProcessArtifact(document, publicState, expectedType); return { snapshot, document }; } catch (error) { closeSnapshot(snapshot); throw error; }
}

function openReviewPair(reviewPath, receiptPath, expectedReceiptHash, expectedRole, publicState) {
  if (path.dirname(path.resolve(reviewPath)) !== path.dirname(path.resolve(receiptPath)) || path.basename(reviewPath) !== 'review.json' || path.basename(receiptPath) !== 'review-export-receipt.json') fail('review_pair_path_invalid');
  const proof = proveDirectorySync(path.dirname(path.resolve(reviewPath)), ['review.json', 'review-export-receipt.json'], { 'review-export-receipt.json': expectedReceiptHash }, { expectedDirectoryMode: 0o700, expectedMemberModes: { 'review.json': 0o400, 'review-export-receipt.json': 0o400 } });
  try {
    const reviewBytes = proof.members['review.json'].bytes; const receiptBytes = proof.members['review-export-receipt.json'].bytes; const review = parseJsonBuffer(reviewBytes, { processArtifact: true }); validateFormalAuthoring(review); const receipt = parseJsonBuffer(receiptBytes, { processArtifact: true }); validateProcessArtifact(receipt, publicState, 'sam-goal-review-export-receipt-v1'); const rows = materializeReview(review, publicState, { expectedRole, expectedPseudonym: receipt.actorPseudonymSha256 });
    if (receipt.role !== expectedRole || receipt.formalReviewByteSha256 !== sha256(reviewBytes) || receipt.formalReviewCanonicalSha256 !== review.expectedCanonicalHash || receipt.sourceBinding && !deepEqual(receipt.sourceBinding, processSourceBinding(publicState))) fail('review_receipt_formal_binding_invalid');
    return { proof, review, reviewBytes, receipt, receiptBytes, rows, reviewSnapshot: proof.members['review.json'], receiptSnapshot: proof.members['review-export-receipt.json'] };
  } catch (error) { closeDirectoryProof(proof); throw error; }
}

function supportForReport(role, evidence) {
  const contact = Object.entries(evidence.support.contact).sort(([a], [b]) => rawUtf8Compare(a, b)).map(([field, value]) => ({ field, frames: value.frames, clips: value.clips }));
  const observability = [
    { field: 'head', ...evidence.support.head.head },
    { field: 'leftHand', ...evidence.support.hand.leftHand },
    { field: 'rightHand', ...evidence.support.hand.rightHand },
  ];
  return { role, contact, observability, reacquireEvents: evidence.support.reacquireEvents, hardTestReacquireClips: evidence.support.hardTestReacquireClips, gatePass: evidence.gatePass };
}

function regenerateRawReport({ pairA, pairB, c0Document, receiptAByteSha256, receiptBByteSha256, c0LedgerByteSha256, validatorA, validatorB, publicState }) {
  if (pairA.receipt.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256 || pairB.receipt.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256 || c0Document.presentationContractSha256 !== PRESENTATION_CONTRACT_SHA256) fail('presentation_contract_mismatch');
  if (c0Document.cycleId !== pairA.receipt.cycleId || c0Document.rulebookByteSha256 !== pairA.receipt.rulebookByteSha256 || c0Document.sourceOnly !== true || c0Document.abArtifactsObserved !== false) fail('raw_chain_binding_mismatch');
  const agreement = rawAgreement(pairA.review, pairB.review, publicState); const evidenceA = reviewEvidence(pairA.review, publicState); const evidenceB = reviewEvidence(pairB.review, publicState); const disagreements = deriveDisagreements(pairA.review, pairB.review, publicState);
  const individualGateEvidence = [
    { role: 'first', rowCount: evidenceA.rowCount, truthPass: true, supportPass: evidenceA.contactPass && evidenceA.observabilityPass, reacquirePass: evidenceA.reacquirePass, validatorExitCode: validatorA.exitCode, validatorStdoutByteSha256: validatorA.stdoutByteSha256 },
    { role: 'second', rowCount: evidenceB.rowCount, truthPass: true, supportPass: evidenceB.contactPass && evidenceB.observabilityPass, reacquirePass: evidenceB.reacquirePass, validatorExitCode: validatorB.exitCode, validatorStdoutByteSha256: validatorB.stdoutByteSha256 },
  ];
  const cells = [...agreement.cells.presencePersonState.map((cell) => ({ family: 'presencePersonState', field: null, ...cell })), ...agreement.cells.contact.map((cell) => ({ family: 'contact', ...cell })), ...agreement.cells.observability.map((cell) => ({ family: 'observability', ...cell }))];
  const countMap = new Map(); for (const disagreement of disagreements) { const key = `${disagreement.clipId}\0${disagreement.coordinateKind}`; countMap.set(key, (countMap.get(key) ?? 0) + 1); }
  const disagreementCounts = [...countMap.entries()].map(([key, count]) => { const [clipId, pathFamily] = key.split('\0'); return { clipId, pathFamily, count }; }).sort((a, b) => rawUtf8Compare(`${a.clipId}/${a.pathFamily}`, `${b.clipId}/${b.pathFamily}`));
  const gatePass = validatorA.exitCode === 0 && validatorB.exitCode === 0 && agreement.gatePass && evidenceA.gatePass && evidenceB.gatePass;
  const report = { artifactType: 'sam-goal-raw-ab-report-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: pairA.receipt.cycleId, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: pairA.receipt.rulebookByteSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, reviewAReceiptByteSha256: receiptAByteSha256, reviewBReceiptByteSha256: receiptBByteSha256, c0LedgerByteSha256, reviewAFormalByteSha256: sha256(pairA.reviewBytes), reviewBFormalByteSha256: sha256(pairB.reviewBytes), reviewAExportValidatorStdoutByteSha256: pairA.receipt.validatorStdoutByteSha256, reviewBExportValidatorStdoutByteSha256: pairB.receipt.validatorStdoutByteSha256, reviewAComparisonValidatorExitCode: validatorA.exitCode, reviewBComparisonValidatorExitCode: validatorB.exitCode, reviewAComparisonValidatorStdoutByteSha256: validatorA.stdoutByteSha256, reviewBComparisonValidatorStdoutByteSha256: validatorB.stdoutByteSha256, agreementInputRoles: ['first', 'second'], c0UsedForAgreement: false, individualGateEvidence, agreementCells: cells, agreementMacros: { ...agreement.macros, thresholds: agreement.thresholds }, supportReacquireEvidence: [supportForReport('first', evidenceA), supportForReport('second', evidenceB)], disagreementCounts, gatePass };
  return { report, agreement, evidenceA, evidenceB, disagreements, gatePass };
}

async function compareRaw(flags, publicState) {
  const pairA = openReviewPair(flags['--review-a'], flags['--receipt-a'], flags['--expected-receipt-a-sha256'], 'first', publicState);
  const pairB = openReviewPair(flags['--review-b'], flags['--receipt-b'], flags['--expected-receipt-b-sha256'], 'second', publicState);
  const c0 = openProcessFile(flags['--c0-ledger'], flags['--expected-c0-byte-sha256'], 'sam-goal-source-first-c0-ledger-v1', publicState);
  try {
    const receipts = [pairA.receipt, pairB.receipt];
    if (new Set([pairA.review.reviewerPseudonymSha256, pairB.review.reviewerPseudonymSha256, c0.document.adjudicatorPseudonymSha256]).size !== 3 || pairA.reviewBytes.equals(pairB.reviewBytes)) fail('actor_or_review_independence_invalid');
    if (![...receipts, c0.document].every((document) => document.presentationContractSha256 === PRESENTATION_CONTRACT_SHA256)) fail('presentation_contract_mismatch');
    if (![...receipts, c0.document].every((document) => document.cycleId === pairA.receipt.cycleId && document.rulebookByteSha256 === pairA.receipt.rulebookByteSha256 && deepEqual(document.publicPins, PUBLIC_PINS) && deepEqual(document.sourceBinding, processSourceBinding(publicState)))) fail('raw_chain_binding_mismatch');
    const revalidateInputs = () => { revalidateDirectoryProofSync(pairA.proof); revalidateDirectoryProofSync(pairB.proof); revalidateSnapshotSync(c0.snapshot); };
    const validatorA = await runValidatorOpaque(path.resolve(flags['--review-a']), 'first', pairA.review.reviewerPseudonymSha256); revalidateInputs();
    const validatorB = await runValidatorOpaque(path.resolve(flags['--review-b']), 'second', pairB.review.reviewerPseudonymSha256); revalidateInputs();
    if (validatorA.exitCode !== 0 || validatorB.exitCode !== 0) fail('review_validator_failed');
    const regenerated = regenerateRawReport({ pairA, pairB, c0Document: c0.document, receiptAByteSha256: flags['--expected-receipt-a-sha256'], receiptBByteSha256: flags['--expected-receipt-b-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'], validatorA, validatorB, publicState });
    const { report, disagreements, gatePass } = regenerated;
    if (!gatePass) fail('raw_ab_gate_failed');
    validateProcessArtifact(report, publicState);
    const bytes = processBytes(report); const commit = await commitSingleFile(flags['--output'], bytes, { beforeCommit: async () => revalidateInputs() });
    result({ status: gatePass && commit.status === 'committed' ? 'raw_ab_gate_pass' : gatePass ? commit.status : 'raw_ab_gate_failed', committed: commit.committed, output: path.resolve(flags['--output']), rawABReportByteSha256: sha256(bytes), gatePass, agreementMacros: report.agreementMacros, disagreementPathCanonicalSha256: canonicalHash(disagreements.map(({ path: disagreementPath, valueType }) => ({ path: disagreementPath, valueType }))), c0UsedForAgreement: false });
    if (!gatePass || commit.status !== 'committed') process.exitCode = 1;
  } finally { closeDirectoryProof(pairA.proof); closeDirectoryProof(pairB.proof); closeSnapshot(c0.snapshot); }
}

function openRevealPrerequisites(flags, publicState) {
  const pairA = openReviewPair(flags['--review-a'], flags['--receipt-a'], flags['--expected-receipt-a-sha256'], 'first', publicState);
  const pairB = openReviewPair(flags['--review-b'], flags['--receipt-b'], flags['--expected-receipt-b-sha256'], 'second', publicState);
  let raw; let c0;
  try {
    raw = openProcessFile(flags['--raw-report'], flags['--expected-raw-report-sha256'], 'sam-goal-raw-ab-report-v1', publicState); c0 = openProcessFile(flags['--c0-ledger'], flags['--expected-c0-byte-sha256'], 'sam-goal-source-first-c0-ledger-v1', publicState);
    assertDistinctSnapshots([pairA.reviewSnapshot, pairA.receiptSnapshot, pairB.reviewSnapshot, pairB.receiptSnapshot, raw.snapshot, c0.snapshot]);
    const chain = [pairA.receipt, pairB.receipt, raw.document, c0.document];
    if (!chain.every((document) => document.presentationContractSha256 === PRESENTATION_CONTRACT_SHA256)) fail('presentation_contract_mismatch');
    if (new Set([pairA.review.reviewerPseudonymSha256, pairB.review.reviewerPseudonymSha256, c0.document.adjudicatorPseudonymSha256]).size !== 3 || !chain.every((document) => document.cycleId === pairA.receipt.cycleId && document.rulebookByteSha256 === pairA.receipt.rulebookByteSha256 && deepEqual(document.publicPins, PUBLIC_PINS) && deepEqual(document.sourceBinding, processSourceBinding(publicState)))) fail('reveal_chain_binding_mismatch');
    if (raw.document.gatePass !== true || raw.document.reviewAReceiptByteSha256 !== flags['--expected-receipt-a-sha256'] || raw.document.reviewBReceiptByteSha256 !== flags['--expected-receipt-b-sha256'] || raw.document.c0LedgerByteSha256 !== flags['--expected-c0-byte-sha256'] || raw.document.reviewAFormalByteSha256 !== sha256(pairA.reviewBytes) || raw.document.reviewBFormalByteSha256 !== sha256(pairB.reviewBytes)) fail('reveal_raw_binding_mismatch');
    revalidateDirectoryProofSync(pairA.proof); revalidateDirectoryProofSync(pairB.proof); revalidateSnapshotSync(raw.snapshot); revalidateSnapshotSync(c0.snapshot);
    return { pairA, pairB, raw, c0 };
  } catch (error) { closeDirectoryProof(pairA.proof); closeDirectoryProof(pairB.proof); closeSnapshot(raw?.snapshot); closeSnapshot(c0?.snapshot); throw error; }
}

function revalidateRevealPrerequisites(inputs) { revalidateDirectoryProofSync(inputs.pairA.proof); revalidateDirectoryProofSync(inputs.pairB.proof); revalidateSnapshotSync(inputs.raw.snapshot); revalidateSnapshotSync(inputs.c0.snapshot); }
function closeRevealPrerequisites(inputs) { closeDirectoryProof(inputs?.pairA?.proof); closeDirectoryProof(inputs?.pairB?.proof); closeSnapshot(inputs?.raw?.snapshot); closeSnapshot(inputs?.c0?.snapshot); }

async function prepareAdjudication(flags, publicState) {
  const inputs = openRevealPrerequisites(flags, publicState);
  try {
    const { pairA, pairB, raw, c0 } = inputs; const assets = await blindAssets(publicState); revalidateRevealPrerequisites(inputs);
    const manifest = manifestFromAssets({ assets, publicState, mode: 'adjudication-reveal', actorPseudonymSha256: c0.document.adjudicatorPseudonymSha256, cycleId: c0.document.cycleId }); validateProcessArtifact(manifest, publicState); assertManifestFrozenAssetDescriptors(manifest, { verifyCurrentSources: false });
    const manifestBytes = processBytes(manifest); const manifestHash = sha256(manifestBytes);
    const skeleton = makeSkeleton(pairA.review, pairB.review, publicState, {
      cycleId: c0.document.cycleId, adjudicatorPseudonymSha256: c0.document.adjudicatorPseudonymSha256, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: c0.document.rulebookByteSha256,
      reviewAByteSha256: sha256(pairA.reviewBytes), reviewACanonicalSha256: pairA.review.expectedCanonicalHash, reviewAPseudonymSha256: pairA.review.reviewerPseudonymSha256,
      reviewBByteSha256: sha256(pairB.reviewBytes), reviewBCanonicalSha256: pairB.review.expectedCanonicalHash, reviewBPseudonymSha256: pairB.review.reviewerPseudonymSha256,
      reviewAReceiptByteSha256: flags['--expected-receipt-a-sha256'], reviewBReceiptByteSha256: flags['--expected-receipt-b-sha256'], rawABReportByteSha256: flags['--expected-raw-report-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'],
    });
    const skeletonBytes = processBytes(skeleton);
    const accessPolicy = { artifactType: 'sam-goal-adjudication-reveal-access-policy-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: c0.document.cycleId, mode: 'adjudication-reveal', actorPseudonymSha256: c0.document.adjudicatorPseudonymSha256, fixedLogicalPaths: [...REVEAL_FIXED_LOGICAL_PATHS], mutableLogicalRoots: ['mutable'], networkAllowlist: ['127.0.0.1', '::1', 'localhost'] };
    const accessPolicyBytes = processBytes(accessPolicy);
    const receipt = { artifactType: 'sam-goal-adjudication-reveal-receipt-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: c0.document.cycleId, adjudicatorPseudonymSha256: c0.document.adjudicatorPseudonymSha256, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: c0.document.rulebookByteSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, reviewAReceiptByteSha256: flags['--expected-receipt-a-sha256'], reviewBReceiptByteSha256: flags['--expected-receipt-b-sha256'], rawABReportByteSha256: flags['--expected-raw-report-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'], revealBundleManifestByteSha256: manifestHash, accessPolicyByteSha256: sha256(accessPolicyBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256, initialSkeletonByteSha256: sha256(skeletonBytes), initialDecisionCount: skeleton.decisions.length, initialUnsetDecisionCount: skeleton.decisions.filter((decision) => deepEqual(decision.decision, { status: 'UNSET' })).length };
    validateProcessArtifact(receipt, publicState); const receiptBytes = processBytes(receipt); const receiptHash = sha256(receiptBytes);
    const journal = { artifactType: 'sam-goal-review-edit-journal-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: manifest.cycleId, mode: 'adjudication-reveal', actorPseudonymSha256: manifest.actorPseudonymSha256, bundleManifestByteSha256: manifestHash, revealReceiptByteSha256: receiptHash, events: [] }; validateProcessArtifact(journal, publicState);
    const generatedFiles = {
      'immutable/bundle-manifest.json': { bytes: manifestBytes, mode: 0o400 },
      'fixed/review-a.json': { bytes: pairA.reviewBytes, mode: 0o400 }, 'fixed/review-a-export-receipt.json': { bytes: pairA.receiptBytes, mode: 0o400 },
      'fixed/review-b.json': { bytes: pairB.reviewBytes, mode: 0o400 }, 'fixed/review-b-export-receipt.json': { bytes: pairB.receiptBytes, mode: 0o400 },
      'fixed/c0-ledger.json': { bytes: c0.snapshot.bytes, mode: 0o400 }, 'fixed/raw-ab-report.json': { bytes: raw.snapshot.bytes, mode: 0o400 },
      'fixed/disagreement-skeleton.json': { bytes: skeletonBytes, mode: 0o400 }, 'fixed/access-policy.json': { bytes: accessPolicyBytes, mode: 0o400 }, 'fixed/reveal-receipt.json': { bytes: receiptBytes, mode: 0o400 },
      'mutable/adjudication-journal.json': { bytes: processBytes(journal), mode: 0o600 },
    };
    if (!deepEqual(Object.keys(generatedFiles).filter((logical) => logical.startsWith('fixed/')).sort(rawUtf8Compare), [...REVEAL_FIXED_LOGICAL_PATHS].sort(rawUtf8Compare))) fail('reveal_fixed_set_invalid');
    const commit = await commitBundleTree(flags['--bundle-dir'], { copiedAssets: assets, generatedFiles, beforeCommit: async () => revalidateRevealPrerequisites(inputs) });
    result({ status: commit.status === 'committed' ? 'adjudication_bundle_prepared' : commit.status, committed: commit.committed, bundleDir: path.resolve(flags['--bundle-dir']), revealReceiptPath: path.join(path.resolve(flags['--bundle-dir']), 'fixed/reveal-receipt.json'), revealReceiptByteSha256: receiptHash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, initialDecisionCount: skeleton.decisions.length, fixedInputSetSha256: fixedInputSetSha256(Object.entries(generatedFiles).filter(([logical]) => logical.startsWith('fixed/')).map(([logicalPath, item]) => ({ logicalPath, bytes: item.bytes.length, sha256: sha256(item.bytes) })), { expectedLogicalPaths: REVEAL_FIXED_LOGICAL_PATHS }) });
    if (commit.status !== 'committed' || commit.signalExitCode) process.exitCode = commit.signalExitCode ?? 1;
  } finally { closeRevealPrerequisites(inputs); }
}

function revealExpectedTree(root, manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, attestationSnapshot, accessSnapshot) {
  return {
    'immutable/bundle-manifest.json': { bytes: manifestSnapshot.bytes.length, sha256: manifestSnapshot.sha256, mode: 0o400 },
    ...Object.fromEntries(manifest.immutableAssets.map((asset) => [asset.logicalPath, { bytes: asset.bytes, sha256: asset.sha256, mode: asset.executable ? 0o500 : 0o400 }])),
    ...Object.fromEntries([...fixedSnapshots].map(([logical, snapshot]) => [logical, { bytes: snapshot.bytes.length, sha256: snapshot.sha256, mode: 0o400 }])),
    'mutable/adjudication-journal.json': { bytes: journalSnapshot.bytes.length, sha256: journalSnapshot.sha256, mode: 0o600 },
    'mutable/actor-attestation.json': { bytes: attestationSnapshot.bytes.length, sha256: attestationSnapshot.sha256, mode: 0o600 },
    'mutable/access-evidence.json': { bytes: accessSnapshot.bytes.length, sha256: accessSnapshot.sha256, mode: 0o600 },
  };
}

function assertRevealFixedPrerequisites({ manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, reviewA, reviewB, receiptA, receiptB, c0, raw, skeleton, revealReceipt, accessPolicy, journal, publicState }) {
  const manifestCycle = manifest.cycleId; const manifestActor = manifest.actorPseudonymSha256; const manifestRulebook = manifest.rulebookByteSha256;
  const fixedDocuments = new Map([['fixed/review-a.json', reviewA], ['fixed/review-a-export-receipt.json', receiptA], ['fixed/review-b.json', reviewB], ['fixed/review-b-export-receipt.json', receiptB], ['fixed/raw-ab-report.json', raw], ['fixed/c0-ledger.json', c0], ['fixed/disagreement-skeleton.json', skeleton], ['fixed/access-policy.json', accessPolicy], ['fixed/reveal-receipt.json', revealReceipt]]);
  for (const [logicalPath, document] of fixedDocuments) if (!fixedSnapshots.get(logicalPath).bytes.equals(processBytes(document))) fail('reveal_fixed_not_canonical');
  if (!journalSnapshot.bytes.equals(processBytes(journal))) fail('bundle_mutable_not_canonical');
  const fixedCoreCycles = [receiptA.cycleId, receiptB.cycleId, raw.cycleId, c0.cycleId, skeleton.cycleId];
  if (new Set(fixedCoreCycles).size === 1 && fixedCoreCycles[0] !== manifestCycle) fail('reveal_cycle_split_chain_mismatch');
  if (c0.adjudicatorPseudonymSha256 === skeleton.adjudicatorPseudonymSha256 && c0.adjudicatorPseudonymSha256 !== manifestActor) fail('reveal_actor_split_chain_mismatch');
  const fixedCoreRulebooks = [receiptA.rulebookByteSha256, receiptB.rulebookByteSha256, raw.rulebookByteSha256, c0.rulebookByteSha256, skeleton.rulebookByteSha256];
  if (new Set(fixedCoreRulebooks).size === 1 && fixedCoreRulebooks[0] !== manifestRulebook) fail('reveal_rulebook_split_chain_mismatch');
  if (receiptA.actorPseudonymSha256 !== reviewA.reviewerPseudonymSha256 || receiptB.actorPseudonymSha256 !== reviewB.reviewerPseudonymSha256) fail('reveal_fixed_receipt_actor_mismatch');
  if (receiptA.cycleId !== manifestCycle || receiptB.cycleId !== manifestCycle) fail('reveal_fixed_receipt_cycle_mismatch');
  if (receiptA.rulebookByteSha256 !== manifestRulebook || receiptB.rulebookByteSha256 !== manifestRulebook) fail('reveal_fixed_receipt_rulebook_mismatch');
  if ([raw.cycleId, c0.cycleId, skeleton.cycleId, revealReceipt.cycleId, accessPolicy.cycleId, journal.cycleId].some((value) => value !== manifestCycle)) fail('reveal_cycle_split_chain_mismatch');
  if ([c0.adjudicatorPseudonymSha256, skeleton.adjudicatorPseudonymSha256, revealReceipt.adjudicatorPseudonymSha256, accessPolicy.actorPseudonymSha256, journal.actorPseudonymSha256].some((value) => value !== manifestActor) || new Set([reviewA.reviewerPseudonymSha256, reviewB.reviewerPseudonymSha256, manifestActor]).size !== 3) fail('reveal_actor_split_chain_mismatch');
  if ([raw.rulebookByteSha256, c0.rulebookByteSha256, skeleton.rulebookByteSha256, revealReceipt.rulebookByteSha256].some((value) => value !== manifestRulebook)) fail('reveal_rulebook_split_chain_mismatch');
  const publicAndSource = [receiptA, receiptB, raw, c0, skeleton, revealReceipt];
  if (publicAndSource.some((document) => !deepEqual(document.publicPins, PUBLIC_PINS) || !deepEqual(document.sourceBinding, processSourceBinding(publicState)))) fail('reveal_fixed_chain_invalid');
  if (receiptA.role !== 'first' || receiptB.role !== 'second' || receiptA.formalReviewByteSha256 !== fixedSnapshots.get('fixed/review-a.json').sha256 || receiptB.formalReviewByteSha256 !== fixedSnapshots.get('fixed/review-b.json').sha256 || receiptA.formalReviewCanonicalSha256 !== reviewA.expectedCanonicalHash || receiptB.formalReviewCanonicalSha256 !== reviewB.expectedCanonicalHash) fail('reveal_fixed_chain_invalid');
  if (raw.reviewAReceiptByteSha256 !== fixedSnapshots.get('fixed/review-a-export-receipt.json').sha256 || raw.reviewBReceiptByteSha256 !== fixedSnapshots.get('fixed/review-b-export-receipt.json').sha256 || raw.c0LedgerByteSha256 !== fixedSnapshots.get('fixed/c0-ledger.json').sha256) fail('reveal_fixed_chain_invalid');
  if (raw.reviewAFormalByteSha256 !== fixedSnapshots.get('fixed/review-a.json').sha256 || raw.reviewBFormalByteSha256 !== fixedSnapshots.get('fixed/review-b.json').sha256) fail('reveal_raw_formal_hash_mismatch');
  if (raw.reviewAExportValidatorStdoutByteSha256 !== receiptA.validatorStdoutByteSha256 || raw.reviewBExportValidatorStdoutByteSha256 !== receiptB.validatorStdoutByteSha256 || raw.gatePass !== true) fail('reveal_fixed_chain_invalid');
  if (journal.bundleManifestByteSha256 !== manifestSnapshot.sha256 || journal.revealReceiptByteSha256 !== fixedSnapshots.get('fixed/reveal-receipt.json').sha256) fail('reveal_fixed_chain_invalid');
  const expectedPolicy = { artifactType: 'sam-goal-adjudication-reveal-access-policy-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: manifestCycle, mode: 'adjudication-reveal', actorPseudonymSha256: manifestActor, fixedLogicalPaths: [...REVEAL_FIXED_LOGICAL_PATHS], mutableLogicalRoots: ['mutable'], networkAllowlist: ['127.0.0.1', '::1', 'localhost'] };
  if (!deepEqual(accessPolicy, expectedPolicy)) fail('reveal_access_policy_invalid');
  const expectedSkeleton = makeSkeleton(reviewA, reviewB, publicState, { cycleId: manifestCycle, adjudicatorPseudonymSha256: manifestActor, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: manifestRulebook, reviewAByteSha256: fixedSnapshots.get('fixed/review-a.json').sha256, reviewACanonicalSha256: reviewA.expectedCanonicalHash, reviewAPseudonymSha256: reviewA.reviewerPseudonymSha256, reviewBByteSha256: fixedSnapshots.get('fixed/review-b.json').sha256, reviewBCanonicalSha256: reviewB.expectedCanonicalHash, reviewBPseudonymSha256: reviewB.reviewerPseudonymSha256, reviewAReceiptByteSha256: fixedSnapshots.get('fixed/review-a-export-receipt.json').sha256, reviewBReceiptByteSha256: fixedSnapshots.get('fixed/review-b-export-receipt.json').sha256, rawABReportByteSha256: fixedSnapshots.get('fixed/raw-ab-report.json').sha256, c0LedgerByteSha256: fixedSnapshots.get('fixed/c0-ledger.json').sha256 });
  if (!deepEqual(skeleton, expectedSkeleton)) fail('disagreement_skeleton_invalid');
  if (revealReceipt.revealBundleManifestByteSha256 !== manifestSnapshot.sha256) fail('reveal_bundle_manifest_hash_mismatch');
  if (revealReceipt.immutableAssetSetSha256 !== manifest.immutableAssetSetSha256) fail('reveal_immutable_asset_set_hash_mismatch');
  if (revealReceipt.accessPolicyByteSha256 !== fixedSnapshots.get('fixed/access-policy.json').sha256) fail('reveal_access_policy_hash_mismatch');
  if (revealReceipt.initialSkeletonByteSha256 !== fixedSnapshots.get('fixed/disagreement-skeleton.json').sha256) fail('reveal_initial_skeleton_hash_mismatch');
  if (revealReceipt.reviewAReceiptByteSha256 !== fixedSnapshots.get('fixed/review-a-export-receipt.json').sha256 || revealReceipt.reviewBReceiptByteSha256 !== fixedSnapshots.get('fixed/review-b-export-receipt.json').sha256 || revealReceipt.rawABReportByteSha256 !== fixedSnapshots.get('fixed/raw-ab-report.json').sha256 || revealReceipt.c0LedgerByteSha256 !== fixedSnapshots.get('fixed/c0-ledger.json').sha256) fail('reveal_receipt_chain_mismatch');
  if (revealReceipt.initialDecisionCount !== skeleton.decisions.length) fail('reveal_initial_decision_count_mismatch');
  if (revealReceipt.initialUnsetDecisionCount !== skeleton.decisions.filter((decision) => deepEqual(decision.decision, { status: 'UNSET' })).length) fail('reveal_initial_unset_count_mismatch');
  return { expectedPolicy, expectedSkeleton };
}

function assertRevealFixedChain(args) {
  const expected = assertRevealFixedPrerequisites(args); const { manifest, access, attestation } = args;
  if (access.cycleId !== manifest.cycleId || attestation.cycleId !== manifest.cycleId) fail('reveal_cycle_split_chain_mismatch');
  if (access.actorPseudonymSha256 !== manifest.actorPseudonymSha256 || attestation.actorPseudonymSha256 !== manifest.actorPseudonymSha256) fail('reveal_actor_split_chain_mismatch');
  return expected;
}

async function openSealedRevealSession(bundleDir, publicState, expectedSessionTreeSha256) {
  const root = path.resolve(bundleDir); await assertBundleDirectoryModes(root); const snapshots = []; let proof;
  try {
    const manifestSnapshot = snapshotPathSync(path.join(root, 'immutable/bundle-manifest.json'), { expectedMode: 0o400 }); snapshots.push(manifestSnapshot); const manifest = parseJsonBuffer(manifestSnapshot.bytes, { processArtifact: true });
    if (!manifestSnapshot.bytes.equals(processBytes(manifest))) fail('bundle_manifest_not_canonical'); validateProcessArtifact(manifest, publicState); assertManifestFrozenAssetDescriptors(manifest); if (manifest.mode !== 'adjudication-reveal') fail('bundle_mode_mismatch');
    const actualImmutable = (await recursiveFiles(root, 'immutable')).sort(rawUtf8Compare); if (!deepEqual(actualImmutable, ['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((asset) => asset.logicalPath)].sort(rawUtf8Compare))) fail('bundle_immutable_member_set_invalid');
    for (const asset of manifest.immutableAssets) { const expectedMode = asset.executable ? 0o500 : 0o400; const snapshot = snapshotPathSync(path.join(root, asset.logicalPath), { expectedHash: asset.sha256, expectedMode }); if (snapshot.bytes.length !== asset.bytes) fail('bundle_asset_drift'); snapshots.push(snapshot); }
    const fixedSnapshots = new Map(); for (const logical of REVEAL_FIXED_LOGICAL_PATHS) { const snapshot = snapshotPathSync(path.join(root, logical), { expectedMode: 0o400 }); fixedSnapshots.set(logical, snapshot); snapshots.push(snapshot); }
    if (!deepEqual((await recursiveFiles(root, 'fixed')).sort(rawUtf8Compare), [...REVEAL_FIXED_LOGICAL_PATHS].sort(rawUtf8Compare))) fail('reveal_fixed_set_invalid');
    const journalSnapshot = snapshotPathSync(path.join(root, 'mutable/adjudication-journal.json'), { expectedMode: 0o600 }); const attestationSnapshot = snapshotPathSync(path.join(root, 'mutable/actor-attestation.json'), { expectedMode: 0o600 }); const accessSnapshot = snapshotPathSync(path.join(root, 'mutable/access-evidence.json'), { expectedMode: 0o600 }); snapshots.push(journalSnapshot, attestationSnapshot, accessSnapshot); assertDistinctSnapshots(snapshots);
    const reviewA = parseJsonBuffer(fixedSnapshots.get('fixed/review-a.json').bytes, { processArtifact: true }); const reviewB = parseJsonBuffer(fixedSnapshots.get('fixed/review-b.json').bytes, { processArtifact: true }); validateFormalAuthoring(reviewA); validateFormalAuthoring(reviewB);
    const receiptA = parseJsonBuffer(fixedSnapshots.get('fixed/review-a-export-receipt.json').bytes, { processArtifact: true }); const receiptB = parseJsonBuffer(fixedSnapshots.get('fixed/review-b-export-receipt.json').bytes, { processArtifact: true }); const c0 = parseJsonBuffer(fixedSnapshots.get('fixed/c0-ledger.json').bytes, { processArtifact: true }); const raw = parseJsonBuffer(fixedSnapshots.get('fixed/raw-ab-report.json').bytes, { processArtifact: true }); const revealReceipt = parseJsonBuffer(fixedSnapshots.get('fixed/reveal-receipt.json').bytes, { processArtifact: true });
    validateProcessArtifact(receiptA, publicState); validateProcessArtifact(receiptB, publicState); validateProcessArtifact(c0, publicState); validateProcessArtifact(raw, publicState); validateProcessArtifact(revealReceipt, publicState);
    const skeleton = parseJsonBuffer(fixedSnapshots.get('fixed/disagreement-skeleton.json').bytes, { processArtifact: true }); const accessPolicy = parseJsonBuffer(fixedSnapshots.get('fixed/access-policy.json').bytes, { processArtifact: true }); const journal = parseJsonBuffer(journalSnapshot.bytes, { processArtifact: true }); const access = parseJsonBuffer(accessSnapshot.bytes, { processArtifact: true }); const attestation = parseJsonBuffer(attestationSnapshot.bytes, { processArtifact: true }); validateProcessArtifact(journal, publicState); validateProcessArtifact(access, publicState); assertAccessEvidenceClosed(access, manifest);
    assertRevealFixedChain({ manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, reviewA, reviewB, receiptA, receiptB, c0, raw, skeleton, revealReceipt, accessPolicy, journal, access, attestation, publicState });
    if (!journalSnapshot.bytes.equals(processBytes(journal)) || !accessSnapshot.bytes.equals(processBytes(access)) || !attestationSnapshot.bytes.equals(processBytes(attestation))) fail('bundle_mutable_not_canonical');
    if (!deepEqual(Object.keys(attestation).sort(rawUtf8Compare), ['actorDeclaredNoOutsideInput', 'actorPseudonymSha256', 'cycleId']) || attestation.actorDeclaredNoOutsideInput !== true || attestation.actorPseudonymSha256 !== manifest.actorPseudonymSha256 || attestation.cycleId !== manifest.cycleId) fail('actor_attestation_invalid');
    const replay = replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: fixedSnapshots.get('fixed/reveal-receipt.json').sha256, requireComplete: true });
    const fixedEntries = [...fixedSnapshots].map(([logicalPath, snapshot]) => ({ logicalPath, bytes: snapshot.bytes.length, sha256: snapshot.sha256 })); const fixedHash = fixedInputSetSha256(fixedEntries, { expectedLogicalPaths: REVEAL_FIXED_LOGICAL_PATHS });
    const fields = { terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, bundleManifestByteSha256: manifestSnapshot.sha256, immutableAssetSetSha256: manifest.immutableAssetSetSha256, fixedInputSetSha256: fixedHash, sessionSeedByteSha256: fixedSnapshots.get('fixed/disagreement-skeleton.json').sha256, sessionFinalStateByteSha256: sha256(processBytes(replay.finalState)), editJournalByteSha256: journalSnapshot.sha256, actorAttestationByteSha256: attestationSnapshot.sha256, accessEvidenceByteSha256: accessSnapshot.sha256 };
    if (access.cycleId !== manifest.cycleId || access.mode !== manifest.mode || access.actorPseudonymSha256 !== manifest.actorPseudonymSha256 || access.bundleManifestByteSha256 !== manifestSnapshot.sha256 || access.immutableAssetSetSha256 !== manifest.immutableAssetSetSha256 || access.fixedInputSetSha256 !== fixedHash || access.sessionSeedByteSha256 !== fields.sessionSeedByteSha256 || access.sessionFinalStateByteSha256 !== fields.sessionFinalStateByteSha256 || access.editJournalByteSha256 !== fields.editJournalByteSha256 || access.actorAttestationByteSha256 !== fields.actorAttestationByteSha256) fail('bundle_access_binding_mismatch');
    proof = proveExactTreeSync(root, revealExpectedTree(root, manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, attestationSnapshot, accessSnapshot)); const descriptor = makeSessionTreeDescriptor(fields); const actualSessionTreeSha256 = expectedSessionTreeSha256 === undefined ? sessionTreeSha256(descriptor) : assertExpectedSessionTreeSha256(expectedSessionTreeSha256, descriptor); revalidateExactTreeProofSync(proof);
    return { root, manifest, manifestSnapshot, fixedSnapshots, journalSnapshot, attestationSnapshot, accessSnapshot, access, accessPolicy, journal, skeleton, reviewA, reviewB, receiptA, receiptB, c0, raw, revealReceipt, replay, proof, descriptor, sessionTreeSha256: actualSessionTreeSha256, snapshots };
  } catch (error) { closeExactTreeProof(proof); for (const snapshot of snapshots) closeSnapshot(snapshot); throw error; }
}

function revalidateSealedRevealSession(session) { revalidateExactTreeProofSync(session.proof); for (const snapshot of session.snapshots) revalidateSnapshotSync(snapshot); }
function closeSealedRevealSession(session) { closeExactTreeProof(session?.proof); for (const snapshot of session?.snapshots ?? []) closeSnapshot(snapshot); }

async function exportAdjudication(flags, publicState) {
  const session = await openSealedRevealSession(flags['--bundle-dir'], publicState, flags['--expected-session-tree-sha256']); const inputs = openRevealPrerequisites(flags, publicState); let revealReceiptInput;
  try {
    revealReceiptInput = openProcessFile(flags['--reveal-receipt'], flags['--expected-reveal-receipt-sha256'], 'sam-goal-adjudication-reveal-receipt-v1', publicState, 0o400);
    if (revealReceiptInput.snapshot.stat.dev !== session.fixedSnapshots.get('fixed/reveal-receipt.json').stat.dev || revealReceiptInput.snapshot.stat.ino !== session.fixedSnapshots.get('fixed/reveal-receipt.json').stat.ino || !revealReceiptInput.snapshot.bytes.equals(session.fixedSnapshots.get('fixed/reveal-receipt.json').bytes)) fail('reveal_receipt_bundle_binding_mismatch');
    const fixedBindings = [['fixed/review-a.json', inputs.pairA.reviewBytes], ['fixed/review-a-export-receipt.json', inputs.pairA.receiptBytes], ['fixed/review-b.json', inputs.pairB.reviewBytes], ['fixed/review-b-export-receipt.json', inputs.pairB.receiptBytes], ['fixed/raw-ab-report.json', inputs.raw.snapshot.bytes], ['fixed/c0-ledger.json', inputs.c0.snapshot.bytes]];
    for (const [logical, bytes] of fixedBindings) if (!session.fixedSnapshots.get(logical).bytes.equals(bytes)) fail('reveal_fixed_prerequisite_drift');
    if (session.revealReceipt.reviewAReceiptByteSha256 !== flags['--expected-receipt-a-sha256'] || session.revealReceipt.reviewBReceiptByteSha256 !== flags['--expected-receipt-b-sha256'] || session.revealReceipt.rawABReportByteSha256 !== flags['--expected-raw-report-sha256'] || session.revealReceipt.c0LedgerByteSha256 !== flags['--expected-c0-byte-sha256']) fail('reveal_receipt_chain_mismatch');
    for (const record of session.replay.records) validateDisposition(record);
    assertFinalReviewEvidence(session.replay.final.rows, publicState);
    const decisions = session.replay.decisions.map(({ path: decisionPath, valueType, decision }) => ({ path: decisionPath, valueType, value: structuredClone(decision) }));
    const adjudication = {
      artifactType: 'sam-goal-manual-adjudication-v3', schemaVersion: 3, role: 'adjudication', origin: 'manual_video', adjudicated: true,
      adjudicatorPseudonymSha256: session.manifest.actorPseudonymSha256,
      reviewACanonicalSha256: session.reviewA.expectedCanonicalHash, reviewAByteSha256: session.fixedSnapshots.get('fixed/review-a.json').sha256, reviewAPseudonymSha256: session.reviewA.reviewerPseudonymSha256,
      reviewBCanonicalSha256: session.reviewB.expectedCanonicalHash, reviewBByteSha256: session.fixedSnapshots.get('fixed/review-b.json').sha256, reviewBPseudonymSha256: session.reviewB.reviewerPseudonymSha256,
      windows: structuredClone(session.replay.final.windows), disagreements: structuredClone(session.skeleton.disagreements), decisions,
    };
    adjudication.expectedCanonicalHash = canonicalHash(adjudication); validateFormalAuthoring(adjudication); const adjudicationBytes = formalBytes(adjudication);
    const deviation = { artifactType: 'sam-goal-manual-deviation-evidence-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: session.manifest.cycleId, adjudicatorPseudonymSha256: session.manifest.actorPseudonymSha256, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: session.manifest.rulebookByteSha256, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, reviewAReceiptByteSha256: flags['--expected-receipt-a-sha256'], reviewBReceiptByteSha256: flags['--expected-receipt-b-sha256'], rawABReportByteSha256: flags['--expected-raw-report-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'], revealReceiptByteSha256: flags['--expected-reveal-receipt-sha256'], revealAccessEvidenceByteSha256: session.accessSnapshot.sha256, adjudicationJournalByteSha256: session.journalSnapshot.sha256, formalAdjudicationByteSha256: sha256(adjudicationBytes), formalAdjudicationCanonicalSha256: adjudication.expectedCanonicalHash, records: structuredClone(session.replay.records), revealSessionTreeSha256: session.sessionTreeSha256 };
    validateProcessArtifact(deviation, publicState); const deviationBytes = processBytes(deviation); revalidateSealedRevealSession(session); revalidateRevealPrerequisites(inputs); revalidateSnapshotSync(revealReceiptInput.snapshot);
    const commit = await commitDirectoryTransaction(flags['--output-dir'], ['adjudication.json', 'deviation-evidence.json'], async (stage) => {
      await writeExclusiveFile(path.join(stage, 'adjudication.json'), adjudicationBytes, 0o400); revalidateSealedRevealSession(session); revalidateRevealPrerequisites(inputs); revalidateSnapshotSync(revealReceiptInput.snapshot);
      await writeExclusiveFile(path.join(stage, 'deviation-evidence.json'), deviationBytes, 0o400); revalidateSealedRevealSession(session); revalidateRevealPrerequisites(inputs); revalidateSnapshotSync(revealReceiptInput.snapshot);
      return { memberBytes: { 'adjudication.json': adjudicationBytes, 'deviation-evidence.json': deviationBytes }, memberModes: { 'adjudication.json': 0o400, 'deviation-evidence.json': 0o400 }, beforeCommit: async () => { revalidateSealedRevealSession(session); revalidateRevealPrerequisites(inputs); revalidateSnapshotSync(revealReceiptInput.snapshot); } };
    });
    result({ status: commit.status === 'committed' ? 'compiler_authority_pending' : commit.status, committed: commit.committed, outputDir: path.resolve(flags['--output-dir']), adjudicationPath: path.join(path.resolve(flags['--output-dir']), 'adjudication.json'), deviationEvidencePath: path.join(path.resolve(flags['--output-dir']), 'deviation-evidence.json'), formalAdjudicationByteSha256: sha256(adjudicationBytes), formalAdjudicationCanonicalSha256: adjudication.expectedCanonicalHash, deviationEvidenceByteSha256: sha256(deviationBytes), revealSessionTreeSha256: session.sessionTreeSha256 });
    if (commit.status !== 'committed' || commit.signalExitCode) process.exitCode = commit.signalExitCode ?? 1;
  } finally { closeSnapshot(revealReceiptInput?.snapshot); closeRevealPrerequisites(inputs); closeSealedRevealSession(session); }
}

function openAdjudicationPair(adjudicationPath, deviationPath, expectedDeviationHash, publicState) {
  if (path.dirname(path.resolve(adjudicationPath)) !== path.dirname(path.resolve(deviationPath)) || path.basename(adjudicationPath) !== 'adjudication.json' || path.basename(deviationPath) !== 'deviation-evidence.json') fail('adjudication_pair_path_invalid');
  const proof = proveDirectorySync(path.dirname(path.resolve(adjudicationPath)), ['adjudication.json', 'deviation-evidence.json'], { 'deviation-evidence.json': expectedDeviationHash }, { expectedDirectoryMode: 0o700, expectedMemberModes: { 'adjudication.json': 0o400, 'deviation-evidence.json': 0o400 } });
  try { const adjudicationBytes = proof.members['adjudication.json'].bytes; const deviationBytes = proof.members['deviation-evidence.json'].bytes; const adjudication = parseJsonBuffer(adjudicationBytes, { processArtifact: true }); const deviation = parseJsonBuffer(deviationBytes, { processArtifact: true }); validateFormalAuthoring(adjudication); validateProcessArtifact(deviation, publicState); return { proof, adjudication, adjudicationBytes, deviation, deviationBytes }; }
  catch (error) { closeDirectoryProof(proof); throw error; }
}

async function handoffCheck(flags, publicState) {
  const inputs = openRevealPrerequisites(flags, publicState); let revealReceiptInput; let adjudicationPair;
  try {
    revealReceiptInput = openProcessFile(flags['--reveal-receipt'], flags['--expected-reveal-receipt-sha256'], 'sam-goal-adjudication-reveal-receipt-v1', publicState, 0o400);
    adjudicationPair = openAdjudicationPair(flags['--adjudication'], flags['--deviation-evidence'], flags['--expected-deviation-evidence-sha256'], publicState);
    assertDistinctSnapshots([inputs.pairA.reviewSnapshot, inputs.pairA.receiptSnapshot, inputs.pairB.reviewSnapshot, inputs.pairB.receiptSnapshot, inputs.raw.snapshot, inputs.c0.snapshot, revealReceiptInput.snapshot, ...Object.values(adjudicationPair.proof.members)]);
    const { adjudication, adjudicationBytes, deviation } = adjudicationPair;
    const revalidateAll = () => { revalidateRevealPrerequisites(inputs); revalidateSnapshotSync(revealReceiptInput.snapshot); revalidateDirectoryProofSync(adjudicationPair.proof); };
    const revealReceipt = revealReceiptInput.document;
    if (![inputs.pairA.receipt, inputs.pairB.receipt, inputs.raw.document, inputs.c0.document, revealReceipt, adjudicationPair.deviation].every((document) => document.presentationContractSha256 === PRESENTATION_CONTRACT_SHA256)) fail('presentation_contract_mismatch');
    if (revealReceipt.cycleId !== inputs.pairA.receipt.cycleId || revealReceipt.adjudicatorPseudonymSha256 !== inputs.c0.document.adjudicatorPseudonymSha256 || revealReceipt.reviewAReceiptByteSha256 !== flags['--expected-receipt-a-sha256'] || revealReceipt.reviewBReceiptByteSha256 !== flags['--expected-receipt-b-sha256'] || revealReceipt.rawABReportByteSha256 !== flags['--expected-raw-report-sha256'] || revealReceipt.c0LedgerByteSha256 !== flags['--expected-c0-byte-sha256'] || revealReceipt.rulebookByteSha256 !== inputs.pairA.receipt.rulebookByteSha256 || !deepEqual(revealReceipt.publicPins, PUBLIC_PINS) || !deepEqual(revealReceipt.sourceBinding, processSourceBinding(publicState))) fail('handoff_chain_binding_mismatch');
    const revealAssets = await blindAssets(publicState); revalidateAll();
    const expectedRevealManifest = manifestFromAssets({ assets: revealAssets, publicState, mode: 'adjudication-reveal', actorPseudonymSha256: inputs.c0.document.adjudicatorPseudonymSha256, cycleId: inputs.c0.document.cycleId }); validateProcessArtifact(expectedRevealManifest, publicState); assertManifestFrozenAssetDescriptors(expectedRevealManifest, { verifyCurrentSources: false });
    const expectedRevealManifestHash = sha256(processBytes(expectedRevealManifest)); if (revealReceipt.revealBundleManifestByteSha256 !== expectedRevealManifestHash) fail('reveal_bundle_manifest_hash_mismatch');
    if (revealReceipt.immutableAssetSetSha256 !== expectedRevealManifest.immutableAssetSetSha256) fail('reveal_immutable_asset_set_hash_mismatch');
    const expectedAccessPolicy = { artifactType: 'sam-goal-adjudication-reveal-access-policy-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: inputs.c0.document.cycleId, mode: 'adjudication-reveal', actorPseudonymSha256: inputs.c0.document.adjudicatorPseudonymSha256, fixedLogicalPaths: [...REVEAL_FIXED_LOGICAL_PATHS], mutableLogicalRoots: ['mutable'], networkAllowlist: ['127.0.0.1', '::1', 'localhost'] };
    if (revealReceipt.accessPolicyByteSha256 !== sha256(processBytes(expectedAccessPolicy))) fail('reveal_access_policy_hash_mismatch');
    const expectedSkeleton = makeSkeleton(inputs.pairA.review, inputs.pairB.review, publicState, { cycleId: inputs.c0.document.cycleId, adjudicatorPseudonymSha256: inputs.c0.document.adjudicatorPseudonymSha256, publicPins: PUBLIC_PINS, sourceBinding: processSourceBinding(publicState), rulebookByteSha256: inputs.c0.document.rulebookByteSha256, reviewAByteSha256: sha256(inputs.pairA.reviewBytes), reviewACanonicalSha256: inputs.pairA.review.expectedCanonicalHash, reviewAPseudonymSha256: inputs.pairA.review.reviewerPseudonymSha256, reviewBByteSha256: sha256(inputs.pairB.reviewBytes), reviewBCanonicalSha256: inputs.pairB.review.expectedCanonicalHash, reviewBPseudonymSha256: inputs.pairB.review.reviewerPseudonymSha256, reviewAReceiptByteSha256: flags['--expected-receipt-a-sha256'], reviewBReceiptByteSha256: flags['--expected-receipt-b-sha256'], rawABReportByteSha256: flags['--expected-raw-report-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'] });
    if (revealReceipt.initialSkeletonByteSha256 !== sha256(processBytes(expectedSkeleton))) fail('reveal_initial_skeleton_hash_mismatch');
    if (revealReceipt.initialDecisionCount !== expectedSkeleton.decisions.length) fail('reveal_initial_decision_count_mismatch');
    if (revealReceipt.initialUnsetDecisionCount !== expectedSkeleton.decisions.filter((decision) => deepEqual(decision.decision, { status: 'UNSET' })).length) fail('reveal_initial_unset_count_mismatch');
    if (deviation.cycleId !== inputs.pairA.receipt.cycleId || deviation.reviewAReceiptByteSha256 !== flags['--expected-receipt-a-sha256'] || deviation.reviewBReceiptByteSha256 !== flags['--expected-receipt-b-sha256'] || deviation.rawABReportByteSha256 !== flags['--expected-raw-report-sha256'] || deviation.c0LedgerByteSha256 !== flags['--expected-c0-byte-sha256'] || deviation.revealReceiptByteSha256 !== flags['--expected-reveal-receipt-sha256'] || deviation.formalAdjudicationByteSha256 !== sha256(adjudicationBytes) || deviation.formalAdjudicationCanonicalSha256 !== adjudication.expectedCanonicalHash) fail('handoff_chain_binding_mismatch');
    if (deviation.adjudicatorPseudonymSha256 !== inputs.c0.document.adjudicatorPseudonymSha256 || deviation.rulebookByteSha256 !== inputs.pairA.receipt.rulebookByteSha256 || !deepEqual(deviation.publicPins, PUBLIC_PINS) || !deepEqual(deviation.sourceBinding, processSourceBinding(publicState))) fail('handoff_chain_binding_mismatch');
    if (adjudication.reviewAByteSha256 !== sha256(inputs.pairA.reviewBytes) || adjudication.reviewACanonicalSha256 !== inputs.pairA.review.expectedCanonicalHash || adjudication.reviewAPseudonymSha256 !== inputs.pairA.review.reviewerPseudonymSha256 || adjudication.reviewBByteSha256 !== sha256(inputs.pairB.reviewBytes) || adjudication.reviewBCanonicalSha256 !== inputs.pairB.review.expectedCanonicalHash || adjudication.reviewBPseudonymSha256 !== inputs.pairB.review.reviewerPseudonymSha256 || adjudication.adjudicatorPseudonymSha256 !== inputs.c0.document.adjudicatorPseudonymSha256) fail('handoff_formal_binding_mismatch');
    const validatorA = await runValidatorOpaque(path.resolve(flags['--review-a']), 'first', inputs.pairA.review.reviewerPseudonymSha256); revalidateAll();
    if (validatorA.exitCode !== 0) fail('review_validator_failed');
    const validatorB = await runValidatorOpaque(path.resolve(flags['--review-b']), 'second', inputs.pairB.review.reviewerPseudonymSha256); revalidateAll();
    if (validatorB.exitCode !== 0) fail('review_validator_failed');
    const historicalValidatorA = { exitCode: validatorA.exitCode, stdoutByteSha256: inputs.raw.document.reviewAComparisonValidatorStdoutByteSha256 };
    const historicalValidatorB = { exitCode: validatorB.exitCode, stdoutByteSha256: inputs.raw.document.reviewBComparisonValidatorStdoutByteSha256 };
    const regeneratedRaw = regenerateRawReport({ pairA: inputs.pairA, pairB: inputs.pairB, c0Document: inputs.c0.document, receiptAByteSha256: flags['--expected-receipt-a-sha256'], receiptBByteSha256: flags['--expected-receipt-b-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'], validatorA: historicalValidatorA, validatorB: historicalValidatorB, publicState });
    validateProcessArtifact(regeneratedRaw.report, publicState); if (!deepEqual(regeneratedRaw.report, inputs.raw.document)) fail('raw_ab_report_drift');
    const disagreements = deriveDisagreements(inputs.pairA.review, inputs.pairB.review, publicState).map(({ coordinateKind: _kind, clipId: _clip, startFrameIndex: _start, endFrameIndexExclusive: _end, leaf: _leaf, windowId: _window, child: _child, ...item }) => item);
    if (!deepEqual(adjudication.disagreements, disagreements) || !deepEqual(adjudication.decisions.map(({ path: decisionPath, valueType }) => ({ path: decisionPath, valueType })), disagreements.map(({ path: disagreementPath, valueType }) => ({ path: disagreementPath, valueType })))) fail('handoff_decision_set_mismatch');
    const final = materializeAdjudicationFinalRows(inputs.pairA.review, inputs.pairB.review, adjudication.decisions, publicState); assertFinalReviewEvidence(final.rows, publicState); if (!deepEqual(final.windows, adjudication.windows)) fail('handoff_adjudication_window_mismatch');
    const expectedCoordinates = deriveDeviationCoordinates(inputs.pairA.review, inputs.pairB.review, inputs.c0.document.rows, inputs.c0.document.windows, adjudication.decisions, publicState); assertExactDeviationRecords(expectedCoordinates, deviation.records); for (const record of deviation.records) validateDisposition(record);
    const canonicalCopy = structuredClone(adjudication); delete canonicalCopy.expectedCanonicalHash; if (canonicalHash(canonicalCopy) !== adjudication.expectedCanonicalHash) fail('handoff_adjudication_canonical_mismatch');
    revalidateAll();
    const report = { artifactType: 'sam-goal-manual-review-handoff-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: inputs.pairA.receipt.cycleId, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, reviewAReceiptByteSha256: flags['--expected-receipt-a-sha256'], reviewBReceiptByteSha256: flags['--expected-receipt-b-sha256'], rawABReportByteSha256: flags['--expected-raw-report-sha256'], c0LedgerByteSha256: flags['--expected-c0-byte-sha256'], revealReceiptByteSha256: flags['--expected-reveal-receipt-sha256'], deviationEvidenceByteSha256: flags['--expected-deviation-evidence-sha256'], formalReviewAByteSha256: sha256(inputs.pairA.reviewBytes), formalReviewBByteSha256: sha256(inputs.pairB.reviewBytes), formalAdjudicationByteSha256: sha256(adjudicationBytes), status: 'ready_for_manual_pack_compiler', reviewASessionTreeSha256: inputs.pairA.receipt.sessionTreeSha256, reviewBSessionTreeSha256: inputs.pairB.receipt.sessionTreeSha256, c0SessionTreeSha256: inputs.c0.document.sessionTreeSha256, revealSessionTreeSha256: deviation.revealSessionTreeSha256 };
    validateProcessArtifact(report, publicState);
    const formalTuple = { reviewA: { path: path.resolve(flags['--review-a']), byteSha256: report.formalReviewAByteSha256 }, reviewB: { path: path.resolve(flags['--review-b']), byteSha256: report.formalReviewBByteSha256 }, adjudication: { path: path.resolve(flags['--adjudication']), byteSha256: report.formalAdjudicationByteSha256 } };
    result({ status: 'ready_for_manual_pack_compiler', report, formalTuple });
  } finally { closeDirectoryProof(adjudicationPair?.proof); closeSnapshot(revealReceiptInput?.snapshot); closeRevealPrerequisites(inputs); }
}

async function main() {
  const { mode, flags } = parseCli(process.argv.slice(2));
  preflightOutputScope(mode, flags);
  if (mode === 'serve') return serveBundle(flags);
  const publicState = await verifyPublicPins();
  if (mode === 'prepare-bundle') return prepareBundle(flags, publicState);
  if (mode === 'export-review') return exportReview(flags, publicState);
  if (mode === 'seal-c0') return sealC0(flags, publicState);
  if (mode === 'compare-raw') return compareRaw(flags, publicState);
  if (mode === 'prepare-adjudication') return prepareAdjudication(flags, publicState);
  if (mode === 'export-adjudication') return exportAdjudication(flags, publicState);
  if (mode === 'handoff-check') return handoffCheck(flags, publicState);
  fail('cli_mode_invalid');
}

try {
  await main();
} catch (error) {
  const code = typeof error?.code === 'string' ? error.code : 'manual_review_operations_failed';
  process.stderr.write(processBytes({ status: 'failed', code }).toString('utf8'));
  process.exitCode = Number.isInteger(error?.details?.exitCode) ? error.details.exitCode : 1;
}
