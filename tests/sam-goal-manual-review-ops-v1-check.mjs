#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  cpSync,
  copyFileSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import * as core from '../tools/sam-goal-manual-review-viewer-v1/core.mjs';
import { createProcessSchemaValidator } from '../tools/sam-goal-manual-review-viewer-v1/schema-validator.mjs';
import { runHeadedPresentationModes, runPresentationMaskMicroTest } from './fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-presentation-gate-v1.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'scripts/sam-goal-manual-review-ops-v1.mjs');
const CORE = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/core.mjs');
const LAUNCHER = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/launcher.mjs');
const APP = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/app.js');
const VIEWER_INDEX = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/index.html');
const VIEWER_STYLE = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/style.css');
const RULEBOOK = path.join(ROOT, 'docs/sam-goal-manual-review-operations-v1.md');
const SCHEMA_DIR = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-schemas');
const AUTHORING_SCHEMA = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/authoring-schema.json');
const FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/acceptance-matrix-v1.json');
const FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const HEADED_CDP_HELPER = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-chrome-cdp-v1.mjs');
const HEADED_PRESENTATION_GATE = path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures/headed-presentation-gate-v1.mjs');
const SHA = /^[0-9a-f]{64}$/u;
const FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION = 'negative-frozen-presentation-background-nonce-v1';
const FROZEN_NEGATIVE_NONCE_READER_MODE = 'frozen-negative-baseline-exact-v1';
const ZERO_SHA = '0'.repeat(64);
const ACTOR_A = '1'.repeat(64);
const ACTOR_B = '2'.repeat(64);
const ACTOR_C0 = '3'.repeat(64);
const CYCLE = 'mro-r1-acceptance-cycle';
const PROCESS_MARKER = Object.freeze({ authorityClass: 'process-evidence-only', compilerInput: false, p0Authority: false });
const require = createRequire(import.meta.url);
const REQUESTED_PHASE = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_TEST_PHASE ?? 'all';
const PRESENTATION_VIEWER_ASSETS = core.PRESENTATION_VIEWER_LOGICAL_PATHS.map((logicalPath) => {
  const bytes = readFileSync(path.join(ROOT, logicalPath.replace(/^immutable\/viewer\//u, 'tools/sam-goal-manual-review-viewer-v1/')));
  return { logicalPath, bytes: bytes.length, sha256: sha256(bytes) };
});
const PRESENTATION_CONTRACT_SHA256 = core.presentationContractSha256(PRESENTATION_VIEWER_ASSETS);
const PREFIT_PRESENTATION_CONTRACT_SHA256 = core.presentationContractSha256(PRESENTATION_VIEWER_ASSETS.map((item) => ({ ...item, sha256: {
  'immutable/viewer/app.js': '26c8136a3daa8315ced0bf58e63ed96858208baee7ede69ce2914a7b7f8a15ef',
  'immutable/viewer/index.html': '2912dc53b9fec0b2cec7bdf8a8794996692a90d5913cff650f5be52a20bf6459',
  'immutable/viewer/style.css': '5a46d0624e1a46478c24455b2419276407817a10dbbf93e7b29eaa32d74ffcc6',
}[item.logicalPath] ?? item.sha256 })));

const evidence = {
  artifactType: 'sam-goal-manual-review-operations-test-evidence-v1',
  schemaVersion: 1,
  status: 'running',
  cases: { passed: 0, failed: 0, expectedFailures: 0 },
  groups: {},
  exactFirstCodes: {},
  counts: {},
  hashes: {},
  performance: {},
  externalEvidence: {},
  residue: [],
};
let activeCase = null;
let tempRoot = null;
const activeServeChildren = new Set();

function killServeGroup(child, signal = 'SIGKILL') { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } }

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function rawCompare(left, right) { return Buffer.compare(Buffer.from(String(left), 'utf8'), Buffer.from(String(right), 'utf8')); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(rawCompare).map((key) => [key, stable(value[key])]));
  return value;
}
function stableStringify(value) { return JSON.stringify(stable(value)); }
function clone(value) { return structuredClone(value); }
function readJson(filePath) { return JSON.parse(readFileSync(filePath, 'utf8')); }
function bump(target, key, increment = 1) { target[key] = (target[key] ?? 0) + increment; }
function pathExists(filePath) { try { lstatSync(filePath); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
function permissionBits(filePath) { return lstatSync(filePath).mode & 0o7777; }
function caseGroup(name) { return name.split(':', 1)[0]; }

async function testCase(name, callback) {
  activeCase = name;
  try {
    await callback();
    evidence.cases.passed += 1;
    bump(evidence.groups, caseGroup(name));
  } catch (error) {
    evidence.cases.failed += 1;
    error.testCase = name;
    throw error;
  } finally {
    activeCase = null;
  }
}

function exactCode(error) {
  if (!error) return 'missing_error';
  if (typeof error.code === 'string') return error.code;
  if (error.name === 'AssertionError') return 'assertion_failed';
  return error.name || 'error';
}

async function expectCode(name, expected, callback) {
  let observed;
  try { await callback(); } catch (error) { observed = exactCode(error); }
  assert.equal(observed, expected, `${name}: expected first code ${expected}, got ${observed ?? 'success'}`);
  evidence.exactFirstCodes[name] = observed;
  evidence.cases.expectedFailures += 1;
}

function processDocument(artifactType, fields = {}) {
  return { artifactType, schemaVersion: 1, ...PROCESS_MARKER, ...fields };
}

function exactIdentity(row) {
  return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: clone(row.timeBase), loopEpoch: row.loopEpoch };
}

function presentState(clipId, frame, clipRows) {
  const planted = frame < Math.floor(clipRows / 2);
  return {
    presence: 'present',
    personState: 'single_target',
    occlusion: { body: 'observable', leftFoot: 'observable', rightFoot: 'observable', leftHand: 'observable', rightHand: 'observable' },
    contact: { left: planted ? 'planted' : 'moving', right: planted ? 'planted' : 'moving' },
    handObservability: { left: 'observable', right: 'observable' },
    endpointObservability: { leftWrist: 'observable', rightWrist: 'observable', leftAnkle: 'observable', rightAnkle: 'observable', head: 'observable' },
    subjectSelection: { state: 'selected', manualTargetId: `target-${clipId}`, anchor: null },
  };
}

function absentState() {
  return {
    presence: 'absent', personState: 'absent',
    occlusion: { body: 'out_of_frame', leftFoot: 'out_of_frame', rightFoot: 'out_of_frame', leftHand: 'out_of_frame', rightHand: 'out_of_frame' },
    contact: { left: 'unknown', right: 'unknown' },
    handObservability: { left: 'not_observable', right: 'not_observable' },
    endpointObservability: { leftWrist: 'not_observable', rightWrist: 'not_observable', leftAnkle: 'not_observable', rightAnkle: 'not_observable', head: 'not_observable' },
    subjectSelection: { state: 'absent', manualTargetId: null, anchor: null },
  };
}

const REACQUIRE_RUNS = Object.freeze({
  'arms-crossed': [[10, 16], [40, 46]],
  'csi-pose': [[20, 27]],
});

function fillWorksheet(worksheet, publicState, { includeReacquire = true } = {}) {
  const counts = new Map(publicState.sourceInventory.paired.map((source) => [source.clipId, source.decoderRowCount]));
  for (const row of worksheet.rows) {
    const run = includeReacquire && (REACQUIRE_RUNS[row.clipId] ?? []).some(([start, end]) => row.sourceFrameIndex >= start && row.sourceFrameIndex < end);
    row.scenarios = run ? ['entry_exit', 'reacquire'] : ['neutral'];
    row.manualState = run ? absentState() : presentState(row.clipId, row.sourceFrameIndex, counts.get(row.clipId));
  }
  for (const window of worksheet.windows) window.scenarioTags = ['neutral'];
  return worksheet;
}

function completeWorksheet(publicState, mode, actor, options = {}) {
  return fillWorksheet(core.createWorksheet({ publicState, mode, actorPseudonymSha256: actor, cycleId: CYCLE, bundleManifestByteSha256: '4'.repeat(64), rulebookByteSha256: '5'.repeat(64) }), publicState, options);
}

function addOverlay(worksheet, values) {
  worksheet.windows.push({ origin: 'actor_overlay', ...values });
  return worksheet;
}

function replaceStateRange(worksheet, clipId, start, end, callback) {
  for (const row of worksheet.rows) if (row.clipId === clipId && row.sourceFrameIndex >= start && row.sourceFrameIndex < end) callback(row, row.sourceFrameIndex);
}

function closeProof(proof) { core.closeDirectoryProof?.(proof); }
function closeSnapshot(snapshot) { core.closeSnapshot?.(snapshot); }

function assertNoTransactionResidue(root) {
  if (!root || !pathExists(root)) return;
  const residue = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const current = path.join(directory, name); const status = lstatSync(current);
      if (/\.mro-(?:stage|rename-cap)-/u.test(name) || /\.mro-test-/u.test(name)) residue.push(current);
      if (status.isDirectory() && !status.isSymbolicLink()) walk(current);
    }
  };
  walk(root);
  evidence.residue = residue;
  assert.deepEqual(residue, [], `transaction residue: ${residue.join(',')}`);
}

function outputFailure(error) {
  evidence.status = 'failed';
  evidence.failure = { case: error.testCase ?? activeCase, code: exactCode(error), message: error.message };
  process.stderr.write(`${JSON.stringify(stable(evidence), null, 2)}\n`);
}

function supportForSchema(role, reviewEvidence) {
  return {
    role,
    contact: Object.entries(reviewEvidence.support.contact).sort(([left], [right]) => rawCompare(left, right)).map(([field, value]) => ({ field, frames: value.frames, clips: value.clips })),
    observability: [
      { field: 'head', ...reviewEvidence.support.head.head },
      { field: 'leftHand', ...reviewEvidence.support.hand.leftHand },
      { field: 'rightHand', ...reviewEvidence.support.hand.rightHand },
    ],
    reacquireEvents: reviewEvidence.support.reacquireEvents,
    hardTestReacquireClips: reviewEvidence.support.hardTestReacquireClips,
    gatePass: reviewEvidence.gatePass,
  };
}

function deviationRecord(klass, disposition, index) {
  const isWindow = klass.startsWith('window_') || klass === 'c0_window_missing';
  if (isWindow) {
    const window = { windowId: `dev-window-${index}`, clipId: 'arms-crossed', startFrameIndex: 0, endFrameIndexExclusive: 10, purposeTags: ['fast_motion'], scenarioTags: ['fast_motion'] };
    return {
      path: `/clips/arms-crossed/windowsById/dev-window-${index}`,
      coordinateKind: 'window-parent', valueType: 'window-or-null',
      reviewAValue: window, reviewBValue: null, finalValue: window,
      class: klass, disposition, rationale: `explicit source rationale ${klass}`,
      clipId: 'arms-crossed', windowId: `dev-window-${index}`,
      c0Projection: klass === 'c0_window_missing' ? { status: 'C0_WINDOW_MISSING' } : { status: 'C0_WINDOW_PRESENT', value: klass === 'window_final_differs_from_c0' ? { ...clone(window), endFrameIndexExclusive: 9 } : clone(window) },
    };
  }
  const runs = klass === 'c0_boundary_not_represented_by_ab' || klass === 'final_matches_c0_some_rows'
    ? [{ startFrameIndex: 0, endFrameIndexExclusive: 5, value: 'present' }, { startFrameIndex: 5, endFrameIndexExclusive: 10, value: 'unknown' }]
    : [{ startFrameIndex: 0, endFrameIndexExclusive: 10, value: klass === 'final_matches_c0_no_rows' || klass === 'c0_differs_from_ab_agreement' ? 'unknown' : 'present' }];
  return {
    path: '/clips/arms-crossed/segments/0-10/presence',
    coordinateKind: 'segment', valueType: 'presence',
    reviewAValue: 'present', reviewBValue: klass === 'c0_differs_from_ab_agreement' || klass === 'c0_boundary_not_represented_by_ab' ? 'present' : 'unknown',
    finalValue: klass === 'final_matches_b_only' ? 'unknown' : klass === 'final_matches_neither_raw_review' ? 'absent' : 'present',
    class: klass, disposition, rationale: `explicit source rationale ${klass}`,
    clipId: 'arms-crossed', startFrameIndex: 0, endFrameIndexExclusive: 10, c0RowRuns: runs,
  };
}

function positiveSchemaDocuments(publicState, worksheetA, worksheetC0, reviewA, reviewB, agreement, evidenceA, evidenceB) {
  const sourceBinding = core.processSourceBinding(publicState); const hash = '6'.repeat(64);
  const formalABytes = core.formalBytes(reviewA); const formalBBytes = core.formalBytes(reviewB);
  const agreementCells = [
    ...agreement.cells.presencePersonState.map((cell) => ({ family: 'presencePersonState', field: null, ...cell })),
    ...agreement.cells.contact.map((cell) => ({ family: 'contact', ...cell })),
    ...agreement.cells.observability.map((cell) => ({ family: 'observability', ...cell })),
  ];
  const validatorStdout = Buffer.from([0, 255, 123, 10]);
  const documents = {};
  documents['bundle-manifest-v1.schema.json'] = realSemanticManifest(publicState);
  documents['access-evidence-v1.schema.json'] = processDocument('sam-goal-review-access-evidence-v1', {
    cycleId: CYCLE, mode: 'first', actorPseudonymSha256: ACTOR_A, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, bundleManifestByteSha256: hash, immutableAssetSetSha256: hash,
    fixedInputSetSha256: FIXTURE.sessionTreeContract.blindFixedInputSetSha256, sessionSeedByteSha256: hash, sessionFinalStateByteSha256: hash, editJournalByteSha256: hash, actorAttestationByteSha256: hash,
    filesystemAllowlist: ['immutable', 'mutable'], networkAllowlist: ['127.0.0.1', '::1', 'localhost'],
    actualOpenEvents: [{ sequence: 1, logicalPath: 'immutable/manifest.json', operation: 'read', result: 'allowed' }],
    cspHeaders: { 'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" },
    negativeProbeResults: [
      { name: 'host-repository', attempted: true, denied: true },
      { name: 'sibling-bundle', attempted: true, denied: true },
      { name: 'non-loopback', attempted: true, denied: true, host: '198.51.100.1' },
    ],
    outsideInputAttestation: { coordinatorProvidedRuntimeDataAfterSpawn: false, actorDeclaredNoOutsideInput: true },
  });
  documents['edit-journal-v1.schema.json'] = processDocument('sam-goal-review-edit-journal-v1', { cycleId: CYCLE, mode: 'first', actorPseudonymSha256: ACTOR_A, bundleManifestByteSha256: hash, events: [] });
  documents['worksheet-v1.schema.json'] = clone(worksheetA);
  documents['review-export-receipt-v1.schema.json'] = processDocument('sam-goal-review-export-receipt-v1', {
    cycleId: CYCLE, role: 'first', actorPseudonymSha256: ACTOR_A, publicPins: clone(core.PUBLIC_PINS), sourceBinding,
    rulebookByteSha256: hash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, bundleManifestByteSha256: hash, accessEvidenceByteSha256: hash, editJournalByteSha256: hash,
    formalReviewByteSha256: sha256(formalABytes), formalReviewCanonicalSha256: reviewA.expectedCanonicalHash,
    validatorInterfaceId: 'sam_goal.manual_pack_compiler_v3/manual-pack-review-validator-cli', validatorExitCode: 0,
    validatorStdoutByteSha256: sha256(validatorStdout), validatorStdoutBase64: validatorStdout.toString('base64'), sessionTreeSha256: hash,
  });
  documents['c0-ledger-v1.schema.json'] = processDocument('sam-goal-source-first-c0-ledger-v1', {
    cycleId: CYCLE, adjudicatorPseudonymSha256: ACTOR_C0, publicPins: clone(core.PUBLIC_PINS), sourceBinding,
    rulebookByteSha256: hash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, bundleManifestByteSha256: hash, accessEvidenceByteSha256: hash, editJournalByteSha256: hash,
    sourceOnly: true, abArtifactsObserved: false, windows: core.normalizeWindows(worksheetC0), rows: clone(worksheetC0.rows), sessionTreeSha256: hash,
  });
  documents['raw-ab-report-v1.schema.json'] = processDocument('sam-goal-raw-ab-report-v1', {
    cycleId: CYCLE, publicPins: clone(core.PUBLIC_PINS), sourceBinding, rulebookByteSha256: hash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    reviewAReceiptByteSha256: hash, reviewBReceiptByteSha256: hash, c0LedgerByteSha256: hash,
    reviewAFormalByteSha256: sha256(formalABytes), reviewBFormalByteSha256: sha256(formalBBytes),
    reviewAExportValidatorStdoutByteSha256: hash, reviewBExportValidatorStdoutByteSha256: hash,
    reviewAComparisonValidatorExitCode: 0, reviewBComparisonValidatorExitCode: 0,
    reviewAComparisonValidatorStdoutByteSha256: hash, reviewBComparisonValidatorStdoutByteSha256: hash,
    agreementInputRoles: ['first', 'second'], c0UsedForAgreement: false,
    individualGateEvidence: [
      { role: 'first', rowCount: 6711, truthPass: true, supportPass: true, reacquirePass: true, validatorExitCode: 0, validatorStdoutByteSha256: hash },
      { role: 'second', rowCount: 6711, truthPass: true, supportPass: true, reacquirePass: true, validatorExitCode: 0, validatorStdoutByteSha256: hash },
    ],
    agreementCells, agreementMacros: { ...agreement.macros, thresholds: clone(FIXTURE.thresholds) },
    supportReacquireEvidence: [supportForSchema('first', evidenceA), supportForSchema('second', evidenceB)], disagreementCounts: [], gatePass: true,
  });
  documents['reveal-receipt-v1.schema.json'] = processDocument('sam-goal-adjudication-reveal-receipt-v1', {
    cycleId: CYCLE, adjudicatorPseudonymSha256: ACTOR_C0, publicPins: clone(core.PUBLIC_PINS), sourceBinding, rulebookByteSha256: hash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    reviewAReceiptByteSha256: hash, reviewBReceiptByteSha256: hash, rawABReportByteSha256: hash, c0LedgerByteSha256: hash,
    revealBundleManifestByteSha256: hash, accessPolicyByteSha256: hash, immutableAssetSetSha256: hash, initialSkeletonByteSha256: hash,
    initialDecisionCount: 2, initialUnsetDecisionCount: 2,
  });
  documents['deviation-evidence-v1.schema.json'] = processDocument('sam-goal-manual-deviation-evidence-v1', {
    cycleId: CYCLE, adjudicatorPseudonymSha256: ACTOR_C0, publicPins: clone(core.PUBLIC_PINS), sourceBinding, rulebookByteSha256: hash, presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    reviewAReceiptByteSha256: hash, reviewBReceiptByteSha256: hash, rawABReportByteSha256: hash, c0LedgerByteSha256: hash, revealReceiptByteSha256: hash,
    revealAccessEvidenceByteSha256: hash, adjudicationJournalByteSha256: hash, formalAdjudicationByteSha256: hash, formalAdjudicationCanonicalSha256: hash,
    records: [], revealSessionTreeSha256: hash,
  });
  documents['handoff-report-v1.schema.json'] = processDocument('sam-goal-manual-review-handoff-v1', {
    cycleId: CYCLE, presentationContractSha256: PRESENTATION_CONTRACT_SHA256, reviewAReceiptByteSha256: hash, reviewBReceiptByteSha256: hash, rawABReportByteSha256: hash, c0LedgerByteSha256: hash,
    revealReceiptByteSha256: hash, deviationEvidenceByteSha256: hash, formalReviewAByteSha256: sha256(formalABytes), formalReviewBByteSha256: sha256(formalBBytes), formalAdjudicationByteSha256: hash,
    status: 'ready_for_manual_pack_compiler', reviewASessionTreeSha256: hash, reviewBSessionTreeSha256: hash, c0SessionTreeSha256: hash, revealSessionTreeSha256: hash,
  });
  return documents;
}

function assetMediaType(logicalPath) {
  return ({ '.json': 'application/json', '.jsonl': 'application/x-ndjson', '.mjs': 'text/javascript', '.js': 'text/javascript', '.cjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.md': 'text/markdown', '.mp4': 'video/mp4', '.node': 'application/x-mach-binary', '.c': 'text/x-c' })[path.extname(logicalPath)] ?? 'application/octet-stream';
}

function realSemanticManifest(publicState) {
  const specs = [
    [path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/evaluation-contract.json'), 'immutable/authority/evaluation-contract.json', 'authority_snapshot', false],
    [path.join(ROOT, 'tests/fixtures/sam-goal-v2/evaluation-v3/label-schema.json'), 'immutable/authority/label-schema.json', 'authority_snapshot', false],
    [AUTHORING_SCHEMA, 'immutable/authority/authoring-schema.json', 'authority_snapshot', false],
    [path.join(ROOT, 'tests/fixtures/sam-goal-v2/labels/source-inventory.json'), 'immutable/authority/source-inventory.json', 'authority_snapshot', false],
    [path.join(ROOT, 'tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl'), 'immutable/authority/decoder-manifest.jsonl', 'authority_snapshot', false],
    [path.join(ROOT, 'scripts/sam-goal-manual-pack-v3.mjs'), 'immutable/authority/sam-goal-manual-pack-v3.mjs', 'authority_snapshot', false],
    ...publicState.sourceInventory.paired.map((source) => [path.join(ROOT, source.video.path), `immutable/sources/${source.clipId}.mp4`, 'source_copy', false]),
    [RULEBOOK, 'immutable/rulebook.md', 'owned_rulebook', false],
    ...FIXTURE.processSchemas.map((name) => [path.join(SCHEMA_DIR, name), `immutable/schemas/${name}`, 'owned_process_schema', false]),
    ...['app.js', 'core.mjs', 'exact-still-decoder.js', 'index.html', 'schema-validator.mjs', 'style.css'].map((name) => [path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1', name), `immutable/viewer/${name}`, 'owned_viewer', false]),
    ...['coordinator-openat.c', 'coordinator-openat.node', 'launcher.mjs', 'sandbox-init.c', 'sandbox-init.node', 'sandbox-preload.cjs'].map((name) => [path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1', name), name === 'launcher.mjs' ? 'immutable/launcher.mjs' : `immutable/${name}`, 'owned_launcher', false]),
    [path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/exact-pts-decoder.mjs'), 'immutable/decoder/exact-pts-decoder.mjs', 'process_decoder', false],
    [process.execPath, 'immutable/runtime/node', 'runtime_executable', true],
  ];
  const immutableAssets = specs.map(([sourcePath, logicalPath, assetClass, executable]) => { const bytes = readFileSync(sourcePath); return { logicalPath, bytes: bytes.length, sha256: sha256(bytes), mediaType: assetMediaType(logicalPath), executable, assetClass }; }).sort((left, right) => rawCompare(left.logicalPath, right.logicalPath));
  return processDocument('sam-goal-review-bundle-manifest-v1', {
    cycleId: CYCLE, mode: 'first', actorPseudonymSha256: ACTOR_A, publicPins: clone(core.PUBLIC_PINS), sourceBinding: core.processSourceBinding(publicState), rulebookByteSha256: sha256(readFileSync(RULEBOOK)), presentationContractSha256: PRESENTATION_CONTRACT_SHA256, immutableAssets,
    runtimeExecutableLogicalPath: 'immutable/runtime/node', launcherLogicalPath: 'immutable/launcher.mjs', processDecoderLogicalPaths: ['immutable/decoder/exact-pts-decoder.mjs'], immutableAssetSetSha256: core.canonicalHash(immutableAssets), mutableLogicalRoots: ['mutable'],
  });
}

function runPythonDraftMatrix(documents) {
  const casesPath = path.join(tempRoot, 'draft-positive-documents.json');
  writeFileSync(casesPath, `${JSON.stringify(documents)}\n`, { mode: 0o600 });
  const script = [
    'import copy,json,pathlib,sys',
    'from jsonschema import Draft202012Validator',
    'from referencing import Registry, Resource',
    'schema_dir=pathlib.Path(sys.argv[1])',
    'docs=json.load(open(sys.argv[2],encoding="utf-8"))',
    'schemas={p.name:json.load(open(p,encoding="utf-8")) for p in schema_dir.glob("*.schema.json")}',
    'authoring=json.load(open(sys.argv[3],encoding="utf-8"))',
    'registry=Registry()',
    'for schema in schemas.values(): registry=registry.with_resource(schema["$id"],Resource.from_contents(schema))',
    'registry=registry.with_resource(authoring["$id"],Resource.from_contents(authoring))',
    'Draft202012Validator.check_schema(authoring)',
    'positive=negative=0',
    'for name,schema in schemas.items():',
    ' Draft202012Validator.check_schema(schema)',
    ' validator=Draft202012Validator(schema,registry=registry)',
    ' validator.validate(docs[name]); positive+=1',
    ' mutant=copy.deepcopy(docs[name]); mutant["expectedCanonicalHash"]="0"*64',
    ' try: validator.validate(mutant)',
    ' except Exception: negative+=1',
    ' else: raise AssertionError("authority injection accepted:"+name)',
    'print(json.dumps({"positive":positive,"authorityInjectionRejected":negative},sort_keys=True,separators=(",",":")))',
  ].join('\n');
  const child = spawnSync('python3', ['-c', script, SCHEMA_DIR, casesPath, AUTHORING_SCHEMA], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

function runPythonDraftNegatives(cases) {
  const casesPath = path.join(tempRoot, 'draft-negative-documents.json'); writeFileSync(casesPath, `${JSON.stringify(cases)}\n`, { mode: 0o600 });
  const script = [
    'import json,pathlib,sys',
    'from jsonschema import Draft202012Validator',
    'from referencing import Registry,Resource',
    'schema_dir=pathlib.Path(sys.argv[1]); cases=json.load(open(sys.argv[2],encoding="utf-8")); authoring=json.load(open(sys.argv[3],encoding="utf-8"))',
    'schemas={p.name:json.load(open(p,encoding="utf-8")) for p in schema_dir.glob("*.schema.json")}',
    'registry=Registry().with_resource(authoring["$id"],Resource.from_contents(authoring))',
    'for schema in schemas.values(): registry=registry.with_resource(schema["$id"],Resource.from_contents(schema))',
    'rejected=[]',
    'for case in cases:',
    ' try: Draft202012Validator(schemas[case["schema"]],registry=registry).validate(case["document"])',
    ' except Exception: rejected.append(case["name"])',
    ' else: raise AssertionError("negative accepted:"+case["name"])',
    'print(json.dumps({"rejected":rejected},sort_keys=True,separators=(",",":")))',
  ].join('\n');
  const child = spawnSync('python3', ['-c', script, SCHEMA_DIR, casesPath, AUTHORING_SCHEMA], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr || child.stdout); const report = JSON.parse(child.stdout); assert.deepEqual(report.rejected, cases.map((item) => item.name)); return report;
}

async function testPublicPinsAndIdentities() {
  const publicState = await core.verifyPublicPins();
  assert.deepEqual(core.PUBLIC_PINS, FIXTURE.publicPins);
  for (const [logicalPath, expected] of Object.entries(FIXTURE.publicBytePins)) assert.equal(sha256(readFileSync(path.join(ROOT, logicalPath))), expected, `public byte pin drift: ${logicalPath}`);
  assert.equal(publicState.decoderRows.length, FIXTURE.rowCount);
  assert.equal(publicState.sourceInventory.paired.length, FIXTURE.clipProfiles.length);
  assert.equal(publicState.sourceInventory.paired.reduce((sum, source) => sum + source.decoderRowCount, 0), FIXTURE.rowCount);
  for (const profile of FIXTURE.clipProfiles) {
    const rows = publicState.decoderRows.filter((row) => row.clipId === profile.clipId);
    assert.equal(rows.length, profile.rowCount);
    assert.deepEqual(rows.map((row) => row.sourceFrameIndex), Array.from({ length: profile.rowCount }, (_, index) => index));
    assert.equal(rows[0].ptsTicks, profile.firstPtsTicks);
    assert.equal(rows.at(-1).ptsTicks, profile.lastPtsTicks);
    assert.equal(stableStringify(rows[0].timeBase), stableStringify(profile.timeBase));
    assert.ok(rows.every((row) => row.loopEpoch === 0 && stableStringify(row.timeBase) === stableStringify(profile.timeBase)));
    assert.equal(`${BigInt(rows.at(-1).ptsTicks) + 1n}`, `${BigInt(profile.lastPtsTicks) + 1n}`);
    const source = publicState.sourceInventory.paired.find((item) => item.clipId === profile.clipId);
    const videoPath = path.join(ROOT, source.video.path); const status = lstatSync(videoPath);
    assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.size, source.video.bytes);
    assert.equal(sha256(readFileSync(videoPath)), source.video.sha256);
  }
  assert.equal(FIXTURE.clipProfiles.find((profile) => profile.clipId === 'arms-crossed').firstPtsTicks, '512');
  assert.deepEqual([...new Set(FIXTURE.clipProfiles.map((profile) => profile.timeBase.denominator))].sort((a, b) => a - b), [15360, 43080, 60000]);
  const before = core.publicBeforeAfterPins(publicState);
  assert.deepEqual(before, Object.fromEntries(Object.entries(FIXTURE.publicBytePins).map(([logicalPath, digest]) => {
    const key = logicalPath.endsWith('evaluation-contract.json') ? 'evaluationContract'
      : logicalPath.endsWith('label-schema.json') ? 'labelSchema'
        : logicalPath.endsWith('authoring-schema.json') ? 'authoringSchema'
          : logicalPath.endsWith('source-inventory.json') ? 'sourceInventory'
            : logicalPath.endsWith('decoder-manifest.jsonl') ? 'decoderManifest' : 'manualPackCompiler';
    return [key, digest];
  })));
  evidence.counts.sourceRows = publicState.decoderRows.length;
  evidence.counts.sourceVideosHashed = FIXTURE.clipProfiles.length;
  evidence.hashes.publicPinSetCanonicalSha256 = core.canonicalHash(core.PUBLIC_PINS);
  evidence.hashes.decoderIdentityCanonicalSha256 = core.canonicalHash(publicState.decoderRows.map(exactIdentity));

  const oracle = FIXTURE.externalOracleEvidence; const oraclePath = oracle.webCodecsIsoBmffPath;
  if (existsSync(oraclePath)) {
    const bytes = readFileSync(oraclePath); assert.equal(sha256(bytes), oracle.webCodecsIsoBmffSha256);
    const report = JSON.parse(bytes.toString('utf8'));
    const text = stableStringify(report);
    assert.match(text, /6711/u); assert.match(text, /42/u);
    evidence.externalEvidence.webCodecsIsoBmff = { present: true, byteSha256: sha256(bytes), expectedDecodedRows: oracle.decodedRowCount, expectedSpotDecodes: oracle.spotDecodeCount };
  } else {
    assert.notEqual(process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_REQUIRE_WEBCODECS_EVIDENCE, '1', `required external evidence missing: ${oraclePath}`);
    evidence.externalEvidence.webCodecsIsoBmff = { present: false, expectedByteSha256: oracle.webCodecsIsoBmffSha256, expectedDecodedRows: oracle.decodedRowCount, expectedSpotDecodes: oracle.spotDecodeCount };
  }
  return publicState;
}

async function testSessionTreeDescriptorContract() {
  assert.equal(PRESENTATION_CONTRACT_SHA256, FIXTURE.presentationContract.currentSha256);
  assert.equal(core.PRESENTATION_INTERFACE_ID, FIXTURE.presentationContract.interfaceId); assert.equal(core.PRESENTATION_INTERFACE_VERSION, FIXTURE.presentationContract.interfaceVersion);
  assert.deepEqual(core.PRESENTATION_EVIDENCE_TARGETS, { selectorAttribute: FIXTURE.presentationContract.selectorAttribute, ...FIXTURE.presentationContract.targets }); assert.deepEqual(core.PRESENTATION_VIEW_MODES, FIXTURE.presentationContract.viewModes);
  const presentationDescriptor = core.makePresentationContractDescriptor(PRESENTATION_VIEWER_ASSETS); assert.deepEqual(Object.keys(presentationDescriptor), ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'interfaceId', 'interfaceVersion', 'rules', 'evidenceTargets', 'viewModes', 'viewerAssets']);
  assert.equal(presentationDescriptor.artifactType, 'sam-goal-manual-review-presentation-contract-v1'); assert.deepEqual({ authorityClass: presentationDescriptor.authorityClass, compilerInput: presentationDescriptor.compilerInput, p0Authority: presentationDescriptor.p0Authority }, PROCESS_MARKER); assert.equal(presentationDescriptor.rules.defaultViewMode, 'fit'); assert.equal(presentationDescriptor.rules.fitEntireFrame, true); assert.equal(presentationDescriptor.rules.clippingAllowed, false); assert.equal(presentationDescriptor.rules.mirrored, false); assert.equal(presentationDescriptor.rules.intrinsicDecodePixelsUnchanged, true);
  assert.deepEqual(presentationDescriptor.viewerAssets.map((item) => item.logicalPath), core.PRESENTATION_VIEWER_LOGICAL_PATHS); assert.equal(core.presentationContractSha256(PRESENTATION_VIEWER_ASSETS), PRESENTATION_CONTRACT_SHA256); assert.equal(core.assertPresentationContractSha256({ presentationContractSha256: PRESENTATION_CONTRACT_SHA256 }, PRESENTATION_CONTRACT_SHA256), true);
  await expectCode('presentation:current-mismatch', 'presentation_contract_mismatch', () => core.assertPresentationContractSha256({ presentationContractSha256: ZERO_SHA }, PRESENTATION_CONTRACT_SHA256));
  for (const [logicalPath, expected] of Object.entries(FIXTURE.presentationContract.knownPrefitViewerSha256)) assert.equal(expected, { 'immutable/viewer/app.js': '26c8136a3daa8315ced0bf58e63ed96858208baee7ede69ce2914a7b7f8a15ef', 'immutable/viewer/index.html': '2912dc53b9fec0b2cec7bdf8a8794996692a90d5913cff650f5be52a20bf6459', 'immutable/viewer/style.css': '5a46d0624e1a46478c24455b2419276407817a10dbbf93e7b29eaa32d74ffcc6' }[logicalPath]);
  assert.notEqual(PREFIT_PRESENTATION_CONTRACT_SHA256, PRESENTATION_CONTRACT_SHA256); await expectCode('presentation:prefit-lineage-rejected', 'presentation_contract_mismatch', () => core.assertPresentationContractSha256({ presentationContractSha256: PREFIT_PRESENTATION_CONTRACT_SHA256 }, PRESENTATION_CONTRACT_SHA256));
  const headedGateSource = readFileSync(HEADED_PRESENTATION_GATE, 'utf8'); assert.doesNotMatch(headedGateSource, /preVisible/u); assert.doesNotMatch(headedGateSource, /maskKeys/u); assert.match(headedGateSource, /\['background', 'solid', 'reference', 'target'\]/u); assert.match(headedGateSource, /measured-F-exact-white-safe-interior-v2/u); assert.doesNotMatch(headedGateSource, /safeCoreSubset|edgeVsNominalWithinOneDevicePixel|solid-safe-core/u); assert.match(headedGateSource, /every-measured-F-rgb-byte-equals-255/u); assert.match(headedGateSource, /every-G-minus-F-rgb-byte-equals-background/u); assert.match(headedGateSource, /canvas\.width=0;canvas\.height=0;[\s\S]*?node\.remove\(\)/u); assert.match(headedGateSource, /zeroedBeforeHostRemoval/u); assert.match(headedGateSource, /presentation_paint_effect_forbidden/u); assert.match(headedGateSource, /rowSpanCanonicalSha256/u); assert.match(headedGateSource, /layoutAttributeSha256/u); assert.match(headedGateSource, /new Uint8Array\(guard\.width \* guard\.height\)/u); assert.match(headedGateSource, /strictScreenshotRgb/u); assert.match(headedGateSource, /function crc32\(bytes\)/u); assert.match(headedGateSource, /CRC32_TABLE\[\(crc \^ byte\) & 0xff\] \^ \(crc >>> 8\)/u); assert.match(headedGateSource, /crc32\(pngBytes\.subarray\(offset \+ 4, dataEnd\)\)/u); assert.match(headedGateSource, /presentation_screenshot_png_crc_invalid/u);
  const mainCheckSource = readFileSync(fileURLToPath(import.meta.url), 'utf8'), frozenBaselineAssertionSource = mainCheckSource.slice(mainCheckSource.lastIndexOf('\nfunction assertHeadedFrozenNegativeBaseline') + 1, mainCheckSource.lastIndexOf('\nfunction assertHeadedFrozenNonceCorruptionOracle') + 1); assert.ok(frozenBaselineAssertionSource.length > 0); assert.doesNotMatch(frozenBaselineAssertionSource, /if \(dpr === 1\)|x:\s*306|y:\s*212,\s*width:\s*324/u); assert.match(frozenBaselineAssertionSource, /physicalFormalEdges/u); assert.match(frozenBaselineAssertionSource, /expectedD = \{ x: Math\.floor\(physicalFormalEdges\.left\)/u); assert.match(frozenBaselineAssertionSource, /expectedEdgeVsDDevicePixels/u); assert.match(frozenBaselineAssertionSource, /measuredFNominalDIntersectionPixels/u); assert.match(frozenBaselineAssertionSource, /const runtimeAuthorities = \[\{ name: 'runtime-reference'/u); assert.match(frozenBaselineAssertionSource, /\{ name: 'runtime-target'/u); assert.match(frozenBaselineAssertionSource, /for \(const source of runtimeAuthorities\)/u); assert.match(frozenBaselineAssertionSource, /source\.rowSpanCanonicalSha256, raster\.F\.rowSpanCanonicalSha256/u); assert.match(frozenBaselineAssertionSource, /const frozenScreenshotAuthority = \{ name: 'frozen-screenshot-binding', bbox: screenshot\.measuredF, maskCanonicalSha256: screenshot\.measuredFMaskCanonicalSha256 \}/u); assert.doesNotMatch(frozenBaselineAssertionSource, /frozenScreenshotAuthority\s*=\s*\{[^}]*rowSpanCanonicalSha256/u); assert.doesNotMatch(frozenBaselineAssertionSource, /rowSpanCanonicalSha256:\s*raster\.F\.rowSpanCanonicalSha256/u); assert.match(frozenBaselineAssertionSource, /frozenMeasuredFArea = frozenScreenshotAuthority\.bbox\.width \* frozenScreenshotAuthority\.bbox\.height/u); assert.match(frozenBaselineAssertionSource, /frozenEdgeVsDDevicePixels = \{ left: frozenScreenshotAuthority\.bbox\.x - expectedD\.x/u); assert.match(frozenBaselineAssertionSource, /frozenMeasuredFNominalDIntersectionPixels = Math\.max\(0, Math\.min\(expectedD\.x \+ expectedD\.width, frozenScreenshotAuthority\.bbox\.x/u); assert.match(frozenBaselineAssertionSource, /assert\.deepEqual\(frozenScreenshotAuthority\.bbox, measuredF/u); assert.match(frozenBaselineAssertionSource, /assert\.equal\(frozenScreenshotAuthority\.maskCanonicalSha256, raster\.F\.maskCanonicalSha256/u);
  const presentationStyleRestoreSource = headedGateSource.slice(headedGateSource.indexOf('async function restorePresentationDomStyleState'), headedGateSource.indexOf('function presentationNonceMismatch')); const negativeStyleRestoreSource = headedGateSource.slice(headedGateSource.indexOf('async function restoreNegativeDomState'), headedGateSource.indexOf('async function alignNegativeSyntheticTarget')); assert.ok(presentationStyleRestoreSource.length > 0 && negativeStyleRestoreSource.length > 0); assert.doesNotMatch(presentationStyleRestoreSource, /node\.style\.cssText\s*=\s*snapshot\.styleCssText/u); assert.doesNotMatch(negativeStyleRestoreSource, /node\.style\.cssText\s*=\s*snapshot\.styleCssText/u); assert.doesNotMatch(presentationStyleRestoreSource, /deepEqual\(restored\.restoredState,\s*state/u); assert.match(presentationStyleRestoreSource, /replayStyle=\(node,snapshot\)=>\(\$\{PRESENTATION_CSP_AWARE_RAW_STYLE_REPLAY_SOURCE\}\)\(node,snapshot\.styleHasAttribute,snapshot\.styleAttribute\)/u); assert.match(negativeStyleRestoreSource, /restoreStyle=\(node,snapshot\)=>\(\$\{PRESENTATION_CSP_AWARE_RAW_STYLE_REPLAY_SOURCE\}\)\(node,snapshot\.styleAttribute!==null,snapshot\.styleAttribute\)/u); assert.match(negativeStyleRestoreSource, /restoreStyle\(parent,state\.parent\);const finalRawState/u); assert.match(presentationStyleRestoreSource, /const canonicalTrace = await presentationFormalRestorationTrace\(page, surface, 'canonical-a-after-final-raw-replay'\); const settleBarrier = await presentationDomReadOnlySettleBarrier\(page, surface\); const canonicalVerificationTrace = await presentationFormalRestorationTrace\(page, surface, 'canonical-b-after-read-only-barrier'\)/u); assert.match(presentationStyleRestoreSource, /assertPresentationFormalTraceStable\(lifecycleClass, canonicalTrace, settleBarrier, canonicalVerificationTrace\)/u); assert.match(presentationStyleRestoreSource, /presentation_post_restore_strict_semantic_projection_drift/u); assert.match(negativeStyleRestoreSource, /const canonicalState = await negativeDomState\(page, surface\); const settleBarrier = await presentationDomReadOnlySettleBarrier\(page, surface\); const canonicalVerificationState = await negativeDomState\(page, surface\)/u); assert.match(headedGateSource, /const PRESENTATION_CSP_AWARE_RAW_STYLE_REPLAY_SOURCE/u); const cspReplaySource = headedGateSource.slice(headedGateSource.indexOf('const PRESENTATION_CSP_AWARE_RAW_STYLE_REPLAY_SOURCE'), headedGateSource.indexOf('const PRESENTATION_CSP_RAW_STYLE_REPLAY_FAILURE_VIEW_SOURCE')); assert.ok(cspReplaySource.length > 0); const currentRawSnapshotIndex = cspReplaySource.indexOf("const currentHasAttribute=node.hasAttribute('style')"); const styleDeclarationIndex = cspReplaySource.indexOf('styleDeclaration=node.style'); const preReplayCssTextGetterIndex = cspReplaySource.indexOf('preReplayCssText=styleDeclaration.cssText'); const currentPresentClearIndex = cspReplaySource.indexOf("if(currentHasAttribute){styleDeclaration.cssText=''"); const currentAbsentReadOnlyIndex = cspReplaySource.indexOf("}else{clearedCssText=preReplayCssText;clearMode='current-absent-read-only';}"); const clearRawSyncBarrierIndex = cspReplaySource.indexOf("const clearRawHasAttribute=node.hasAttribute('style')"); const finalTriStateIndex = cspReplaySource.indexOf('let finalWriteKind=null;if(styleHasAttribute)'); assert.ok(currentRawSnapshotIndex >= 0 && currentRawSnapshotIndex < styleDeclarationIndex); assert.ok(styleDeclarationIndex < preReplayCssTextGetterIndex && preReplayCssTextGetterIndex < currentPresentClearIndex); assert.ok(currentPresentClearIndex < currentAbsentReadOnlyIndex); assert.ok(currentAbsentReadOnlyIndex < clearRawSyncBarrierIndex && clearRawSyncBarrierIndex < finalTriStateIndex); assert.ok(finalTriStateIndex < cspReplaySource.indexOf("node.removeAttribute('style')")); assert.equal((cspReplaySource.match(/styleDeclaration\.cssText=''/gu) ?? []).length, 1); assert.doesNotMatch(cspReplaySource, /node\.style\.cssText=''/u); assert.match(cspReplaySource, /clearMode='current-present-cssom-write';cssomClearWriteApplied=true/u); assert.match(cspReplaySource, /clearMode='current-absent-read-only'/u); assert.match(cspReplaySource, /actualCssText=styleHasAttribute\?styleDeclaration\.cssText:clearedCssText/u); assert.match(cspReplaySource, /replayOrder='current-raw-aware-preparation-then-tristate-final-write-v3'/u); assert.match(cspReplaySource, /finalWriteKind='absent-remove-attribute'/u); assert.match(cspReplaySource, /finalWriteKind='present-empty-set-attribute'/u); assert.match(cspReplaySource, /finalWriteKind='present-nonempty-cssom-assignment'/u); assert.doesNotMatch(cspReplaySource, /setAttribute\('style',styleAttribute\)/u); assert.equal((cspReplaySource.match(/styleDeclaration\.cssText=styleAttribute/gu) ?? []).length, 1); assert.equal((headedGateSource.match(/setAttribute\('style',''\)/gu) ?? []).length, 1); assert.match(headedGateSource, /source:'raw-style-attribute-not-historical-cssom'/u); assert.match(headedGateSource, /presentation_csp_raw_style_replay_mismatch/u); assert.match(headedGateSource, /bounded-csp-raw-style-replay-failure-v1/u); assert.match(headedGateSource, /async function cspAwareRawStyleReplayOracle/u); assert.match(headedGateSource, /csp-aware-raw-style-replay-chrome-regression-v1/u); assert.match(headedGateSource, /async function presentationFormalRestorationTrace/u); assert.match(headedGateSource, /presentation-formal-raw-computed-rect-trace-v1/u); assert.match(headedGateSource, /function assertAlignedPresentationTrace/u); assert.match(headedGateSource, /function assertRawAuthorityCssomStability/u); assert.match(headedGateSource, /historicalCssomDiagnosticOnly: true/u); assert.match(headedGateSource, /postFinalRawReplayReadOnlySnapshotCount: 2/u); assert.match(headedGateSource, /two-raf-bcr-computed-read-only-settle-v1/u); assert.match(headedGateSource, /await new Promise\(requestAnimationFrame\);await new Promise\(requestAnimationFrame\)/u); assert.match(headedGateSource, /getBoundingClientRect\(\)/u); assert.match(headedGateSource, /getComputedStyle\(node\)/u); assert.match(headedGateSource, /function presentationRestoreSemanticProjection/u); assert.match(headedGateSource, /postRestoreComputedAndGeometryVerifiedBeforeRepair/u); assert.match(headedGateSource, /postRestoreRepairWrites: 0/u); assert.doesNotMatch(headedGateSource, /rawAttributeAndSemanticStateExact/u); assert.match(headedGateSource, /rasterRegionIntersectionArea/u); assert.doesNotMatch(headedGateSource, /insideGeometryChangedPixels, measuredPhysicalPixels/u); assert.match(headedGateSource, /post-synthetic-pre-negative-raw-style-tristate-v1/u); assert.match(headedGateSource, /negative-frozen-presentation-background-nonce-v1/u); assert.match(headedGateSource, /frozen-negative-baseline-exact-v1/u); assert.match(headedGateSource, /presentation_background_nonce_frozen_visual_state_mismatch/u); assert.match(headedGateSource, /crossCaseSubstitutionRejectedByCanonicalHash/u); assert.match(headedGateSource, /PRESENTATION_SURFACE_PARENT_RESOLVER_SOURCE/u); assert.match(headedGateSource, /presentation_surface_parent_identity_invalid/u); assert.doesNotMatch(headedGateSource, /closest\(['"]\.viewer['"]\)/u); assert.doesNotMatch(headedGateSource, /measured F must equal aligned D/u);
  const postSyntheticPreparationSource = headedGateSource.slice(headedGateSource.indexOf('async function prepareNegativePostSyntheticViewport'), headedGateSource.indexOf('async function alignNegativeSyntheticTarget')); assert.match(postSyntheticPreparationSource, /const before = await presentationFormalRestorationTrace/u); assert.match(postSyntheticPreparationSource, /const viewportPreparation = await prepareTargetViewport/u); assert.match(postSyntheticPreparationSource, /const after = await presentationFormalRestorationTrace/u); assert.ok(postSyntheticPreparationSource.indexOf('const before =') < postSyntheticPreparationSource.indexOf('const viewportPreparation =')); assert.ok(postSyntheticPreparationSource.indexOf('const viewportPreparation =') < postSyntheticPreparationSource.indexOf('const after =')); assert.match(postSyntheticPreparationSource, /negativePreCaptureGuardEvidence\(after\.projection\.geometry/u); assert.doesNotMatch(postSyntheticPreparationSource, /\.style\.[A-Za-z]+\s*=|Object\.assign\([^)]*\.style/u);
  const alignNegativeSource = headedGateSource.slice(headedGateSource.indexOf('async function alignNegativeSyntheticTarget'), headedGateSource.indexOf('async function applyNegativeMutation')); assert.match(alignNegativeSource, /const postAlignTrace = await presentationFormalRestorationTrace/u); assert.match(alignNegativeSource, /const viewportPreparation = await prepareTargetViewport/u); assert.match(alignNegativeSource, /const postPrepareTrace = await presentationFormalRestorationTrace/u); assert.ok(alignNegativeSource.indexOf('const postAlignTrace') < alignNegativeSource.indexOf('const viewportPreparation')); assert.ok(alignNegativeSource.indexOf('const viewportPreparation') < alignNegativeSource.indexOf('const postPrepareTrace')); assert.match(alignNegativeSource, /stage\.style\.alignItems='flex-start'/u); assert.match(alignNegativeSource, /negative-initial-flex-start-alignment-policy-transition-v1/u); assert.match(alignNegativeSource, /const captureReadyTrace = await presentationFormalRestorationTrace/u); assert.match(alignNegativeSource, /rect: structuredClone\(captureReadyTrace\.formal\.rect\)/u); assert.match(alignNegativeSource, /assertAlignedPresentationTrace\(postPrepareTrace[^;]*'center'/u); assert.match(alignNegativeSource, /assertAlignedPresentationTrace\(captureReadyTrace/u); assert.match(alignNegativeSource, /centeredOverflowOffsetCssPx/u); assert.match(alignNegativeSource, /formerCenteredTop/u); assert.match(alignNegativeSource, /post-synthetic-to-flex-start-legacy-capture-transition-v1/u); assert.doesNotMatch(alignNegativeSource.slice(alignNegativeSource.indexOf('const viewportPreparation')), /Object\.assign\(target\.style|target\.style\.[A-Za-z]+\s*=/u);
  assert.match(alignNegativeSource, /formalStageTopDeltaCssPx/u); assert.match(alignNegativeSource, /formalInlineTopCssPx = Number\.parseFloat\(captureReadyTrace\.formal\.inline\.top\)/u); assert.match(alignNegativeSource, /formalInlineTopCssPx, formalStageTopDeltaCssPx/u); assert.match(alignNegativeSource, /policyAfterFormalStageTopDeltaCssPx, policyBeforeFormalStageTopDeltaCssPx/u); assert.match(alignNegativeSource, /top: captureReadyTrace\.formal\.rect\.top/u); assert.match(alignNegativeSource, /formerCenteredTop: captureReadyTrace\.formal\.rect\.top/u); assert.doesNotMatch(alignNegativeSource, /captureReadyTrace\.formal\.rect\.top, captureReadyTrace\.stage\.rect\.top/u);
  assert.match(alignNegativeSource, /const intrinsicWidthDelta = captureReadyTrace\.intrinsic\.width - captureReadyTrace\.formal\.rect\.width/u); assert.match(alignNegativeSource, /left: captureReadyTrace\.formal\.rect\.left - intrinsicWidthDelta \/ 2/u); assert.match(alignNegativeSource, /right: captureReadyTrace\.formal\.rect\.right \+ intrinsicWidthDelta \/ 2/u); assert.doesNotMatch(alignNegativeSource, /left:\s*288|right:\s*648|288\s*\*\s*captureReadyTrace\.dpr/u); const flexStartRegressionSource = headedGateSource.slice(headedGateSource.indexOf('function negativeFlexStartPreparationRegression'), headedGateSource.indexOf('function cspRawStyleReplayFirstTouchMicroOracle')); assert.match(flexStartRegressionSource, /negative-initial-flex-start-preparation-regression-v2/u); assert.match(flexStartRegressionSource, /browserRuntimeAuthorityDerivedFromPolicyAfterTargetRect: true/u); assert.match(flexStartRegressionSource, /chrome150ObservedHorizontalSnapPinsDiagnosticOnly: true/u); assert.match(flexStartRegressionSource, /intrinsicWidthDelta = intrinsic\.width - alignedRect\.width/u); assert.match(flexStartRegressionSource, /horizontalExpansionCssPx = intrinsicWidthDelta \/ 2/u); assert.match(flexStartRegressionSource, /Object\.values\(alignedPhysicalEdges\)\.every\(Number\.isSafeInteger\)/u); assert.match(flexStartRegressionSource, /Object\.values\(legacyPhysicalEdges\)\.every\(Number\.isSafeInteger\)/u); assert.doesNotMatch(flexStartRegressionSource, /x:\s*576|x:\s*574,\s*y:\s*422,\s*width:\s*724/u);
  const negativeControlsSource = headedGateSource.slice(headedGateSource.indexOf('async function runNegativeControls'), headedGateSource.indexOf('async function runTransitionStress')); assert.ok(negativeControlsSource.length > 0); assert.equal((negativeControlsSource.match(/alignNegativeSyntheticTarget\(page, surface, postSyntheticTransition\)/gu) ?? []).length, 1); const postSyntheticTransitionIndex = negativeControlsSource.indexOf('const postSyntheticTransition = await prepareNegativePostSyntheticViewport'); const originalCaptureIndex = negativeControlsSource.indexOf('const originalStrictState = await currentCaptureState'); const alignIndex = negativeControlsSource.indexOf('alignNegativeSyntheticTarget(page, surface, postSyntheticTransition)'); assert.ok(postSyntheticTransitionIndex >= 0 && postSyntheticTransitionIndex < originalCaptureIndex && originalCaptureIndex < alignIndex); assert.match(negativeControlsSource, /const preNonceTrace = await presentationFormalRestorationTrace/u); assert.match(negativeControlsSource, /assertAlignedPresentationTrace\(preNonceTrace/u); assert.match(negativeControlsSource, /preNonceCaptureState\.captureEpoch, preNonceTrace\.captureEpoch/u); assert.match(negativeControlsSource, /backgroundNonceStyleState = structuredClone\(preNonceTrace\.domStyleState\)/u); assert.match(negativeControlsSource, /preReleaseTrace = await presentationFormalRestorationTrace/u); assert.match(negativeControlsSource, /alignedPostNonceTrace = await presentationFormalRestorationTrace/u); assert.ok(negativeControlsSource.indexOf('preReleaseTrace = await presentationFormalRestorationTrace') < negativeControlsSource.indexOf('restoredNonce = await restorePresentationDomStyleState')); assert.ok(negativeControlsSource.indexOf('restoredNonce = await restorePresentationDomStyleState') < negativeControlsSource.indexOf('alignedPostNonceTrace = await presentationFormalRestorationTrace')); assert.ok(negativeControlsSource.indexOf('alignedPostNonceTrace = await presentationFormalRestorationTrace') < negativeControlsSource.indexOf('assertAlignedPresentationTrace(preReleaseTrace')); assert.match(negativeControlsSource, /presentationDomRawAuthorityState\(alignedPostNonceTrace\.domStyleState\), presentationDomRawAuthorityState\(backgroundNonceStyleState\)/u); assert.doesNotMatch(negativeControlsSource, /deepEqual\(alignedPostNonceTrace\.domStyleState, backgroundNonceStyleState/u); assert.match(negativeControlsSource, /negative-aligned-nonce-restoration-trace-v1/u); assert.match(negativeControlsSource, /negative-original-outer-restoration-trace-v1/u); assert.match(negativeControlsSource, /const mutationFrozenProjection = presentationRestoreSemanticProjection\(await currentFrozenNegativeCaptureState/u); const mutationLoopSource = negativeControlsSource.slice(negativeControlsSource.indexOf('for (const spec of NEGATIVE_PRESENTATION_MUTATIONS)'), negativeControlsSource.indexOf('} catch (error) { primaryError = error; }')); assert.doesNotMatch(mutationLoopSource, /alignNegativeSyntheticTarget|prepareTargetViewport|scrollIntoView|scrollBy|scrollTo/u); assert.equal((mutationLoopSource.match(/negativePreCaptureGuardEvidence\(expectedState\.geometry/gu) ?? []).length, 1); assert.ok(mutationLoopSource.indexOf('negativePreCaptureGuardEvidence(expectedState.geometry') < mutationLoopSource.indexOf('decodedGuardRegionEvidence(readFileSync')); assert.match(mutationLoopSource, /mutation changed root scroll/u); assert.match(mutationLoopSource, /mutation changed nested stage scroll/u); assert.match(mutationLoopSource, /legacy target must remain at aligned formal top/u); assert.match(mutationLoopSource, /legacy fractional stage top drift/u); assert.match(mutationLoopSource, /legacy formal\/stage top delta drift/u); assert.doesNotMatch(mutationLoopSource, /legacy target must remain at aligned stage top/u); assert.match(mutationLoopSource, /mutationViewportState: \{ rootScroll: applied\.scroll, stageScroll: applied\.stageScroll, stageAlignItems: applied\.stageAlignItems, formalRect: applied\.formalRect, stageRect: applied\.stageRect, formalStageTopDeltaCssPx:/u); assert.match(mutationLoopSource, /mutationRepairWriteCount: 0/u); assert.match(negativeControlsSource, /const restoredFrozenState = await currentFrozenNegativeCaptureState/u); assert.ok(negativeControlsSource.indexOf('const restoredFrozenState') < negativeControlsSource.indexOf('const restoredSnapshot')); assert.match(negativeControlsSource, /assert\.deepEqual\(restoredFrozenProjection, mutationFrozenProjection/u); assert.match(negativeControlsSource, /assert\.deepEqual\(outerStrictProjection, originalCaptureProjection/u); assert.match(negativeControlsSource, /let nonceCleanupError = null/u); assert.match(negativeControlsSource, /let outerCleanupError = null/u); assert.ok(negativeControlsSource.indexOf('let nonceCleanupError = null') < negativeControlsSource.indexOf('let outerCleanupError = null')); assert.match(negativeControlsSource, /presentationStageRestorationEvidence/u); assert.match(negativeControlsSource, /presentationCleanupAlignmentError/u); assert.match(negativeControlsSource, /recordNoncePhaseError/u); assert.doesNotMatch(negativeControlsSource, /const realigned/u);
  const negativeEdgeMutationSource = mutationLoopSource.slice(mutationLoopSource.indexOf("if (spec.kind === 'edge')"), mutationLoopSource.indexOf('} else mutationSignature')); assert.ok(negativeEdgeMutationSource.length > 0); assert.match(negativeEdgeMutationSource, /expectedInsideGeometryChangedPixels = rasterRegionIntersectionArea\(expectedTargetObservedCoverageBbox, comparison\.bbox\)/u); assert.match(negativeEdgeMutationSource, /expectedOutsideGeometryChangedPixels = expectedChangedPixels - expectedInsideGeometryChangedPixels/u); assert.match(negativeEdgeMutationSource, /insideGeometryChangedPixels \+ comparison\.targetCoverage\.outsideGeometryChangedPixels, comparison\.targetCoverage\.changedPixels/u); assert.doesNotMatch(negativeEdgeMutationSource, /insideGeometryChangedPixels, expectedChangedPixels/u); for (const field of ['insideGeometryChangedPixels', 'outsideGeometryChangedPixels', 'expectedInsideGeometryChangedPixels', 'expectedOutsideGeometryChangedPixels', 'nominalD', 'partitionExact', 'signedGapDevicePixels', 'compensationDevicePixels', 'appliedInsetDevicePixels', 'appliedInsetCssPx', 'preMeasuredFEdgeDevicePx', 'postMeasuredFEdgeDevicePx', 'baselineBinding', 'baselineBindingSha256', 'planCanonicalSha256', 'antiStaleSourceDifferences', 'antiStaleEachSourceDifferenceExact']) assert.match(negativeEdgeMutationSource, new RegExp(`${field}(?=[:,])`, 'u')); assert.match(negativeEdgeMutationSource, /antiStaleSourceDifferences = forbiddenRegionEvidence\.map/u); assert.match(negativeEdgeMutationSource, /antiStaleSourceDifferences\.every\(\(item\) => item\.different\)/u); assert.match(headedGateSource, /negative-edge-modeled-measured-f-nominal-d-partition-regression-v2/u); assert.match(headedGateSource, /modeledAuthorityOnly: true/u); assert.match(headedGateSource, /browserRuntimeAuthorityDerivedFromCoverage: true/u); assert.match(headedGateSource, /browserRuntimeDpr2InsetMustNotUseModeledPin: true/u);
  const measuredEdgePlanSource = headedGateSource.slice(headedGateSource.indexOf('function measuredEdgeClipPlan'), headedGateSource.indexOf('function presentationNonceRasterDomain')); const applyMeasuredEdgeSource = headedGateSource.slice(headedGateSource.indexOf('async function applyNegativeMutation'), headedGateSource.indexOf('async function applyFrozenNonceCorruption')); assert.ok(measuredEdgePlanSource.length > 0 && applyMeasuredEdgeSource.length > 0); assert.match(measuredEdgePlanSource, /\[1, 2\]\.includes\(dpr\)/u); assert.match(measuredEdgePlanSource, /safeRasterRect/u); assert.match(measuredEdgePlanSource, /runtimeMeasuredF\.width > dpr && runtimeMeasuredF\.height > dpr/u); assert.match(measuredEdgePlanSource, /nearEdge \? measuredEdges\[edge\] - nominalEdges\[edge\] : nominalEdges\[edge\] - measuredEdges\[edge\]/u); assert.match(measuredEdgePlanSource, /compensationDevicePixels = Math\.max\(0, signedGapDevicePixels\)/u); assert.match(measuredEdgePlanSource, /appliedInsetCssPx \* dpr, appliedInsetDevicePixels/u); assert.match(measuredEdgePlanSource, /if \(edge === 'bottom'\) assert\.ok\(signedGapDevicePixels >= 0/u); for (const field of ['runtimeMeasuredF', 'publicMeasuredF', 'frozenScreenshotMeasuredF', 'runtimeMeasuredFMaskCanonicalSha256', 'publicMeasuredFMaskCanonicalSha256', 'frozenScreenshotMeasuredFMaskCanonicalSha256', 'caseBindingKeySha256', 'frozenAuthoritySha256', 'nominalD', 'dpr']) assert.match(measuredEdgePlanSource, new RegExp(field, 'u')); assert.match(measuredEdgePlanSource, /negative-measured-f-edge-baseline-binding-v1/u); assert.match(measuredEdgePlanSource, /negative-measured-f-edge-clip-plan-v2/u); assert.match(measuredEdgePlanSource, /planComputedOnceFromFrozenBaseline: true/u); assert.match(measuredEdgePlanSource, /adaptiveReplanForbidden: true/u); assert.match(measuredEdgePlanSource, /return deepFreeze/u); assert.match(applyMeasuredEdgeSource, /preApplyNominalD=rasterD\(preApplyFormalRect\)/u); assert.ok(applyMeasuredEdgeSource.indexOf('preApplyNominalD=rasterD(preApplyFormalRect)') < applyMeasuredEdgeSource.indexOf('target.style.clipPath=edgeClipPlan.requestedClipPathCssText')); assert.match(applyMeasuredEdgeSource, /sha256Json\(binding\)/u); assert.match(applyMeasuredEdgeSource, /sha256Json\(canonicalPlan\)/u); assert.match(applyMeasuredEdgeSource, /computedClipPathPlanExact/u); assert.match(applyMeasuredEdgeSource, /bcrExact/u); assert.match(applyMeasuredEdgeSource, /stageBcrExact/u); assert.match(applyMeasuredEdgeSource, /rootScrollExact/u); assert.match(applyMeasuredEdgeSource, /stageScrollExact/u); assert.match(negativeControlsSource, /edgeClipPlans = new Map/u); assert.ok(negativeControlsSource.indexOf('edgeClipPlans = new Map') < negativeControlsSource.indexOf('runFrozenNonceCorruptionOracles')); assert.ok(negativeControlsSource.indexOf('edgeClipPlans = new Map') < negativeControlsSource.indexOf('for (const spec of NEGATIVE_PRESENTATION_MUTATIONS)')); assert.doesNotMatch(mutationLoopSource, /measuredEdgeClipPlan\(/u);
  const frozenRestoreSource = headedGateSource.slice(headedGateSource.indexOf('async function restoreFrozenNonceCorruption'), headedGateSource.indexOf('async function runFrozenNonceCorruptionOracles')); assert.match(headedGateSource, /async function applyFrozenNonceCorruption\(page, surface, kind, authority\)/u); assert.match(frozenRestoreSource, /^async function restoreFrozenNonceCorruption\(page, surface, applied\)/u); assert.match(headedGateSource, /applyFrozenNonceCorruption\(page, surface, definition\.kind, authority\)/u); assert.match(headedGateSource, /restoreFrozenNonceCorruption\(page, surface, applied\)/u); assert.match(frozenRestoreSource, /canonicalHosts=\[\.\.\.document\.querySelectorAll\('\[data-sam-goal-presentation-background-nonce-node\]'\)\]\.filter\(\(node\)=>!node\.hasAttribute\('data-sam-goal-frozen-nonce-corruption-clone'\)\)/u); assert.match(frozenRestoreSource, /canonicalHostCount:canonicalHosts\.length/u); assert.match(frozenRestoreSource, /immediatePostFinalRawReplay=record\(\)/u); assert.match(frozenRestoreSource, /const separateTaskCanonicalA = await frozenNonceRestorationState/u); assert.match(frozenRestoreSource, /const settleBarrier = await frozenNonceRestorationReadOnlyBarrier/u); assert.match(frozenRestoreSource, /const canonical = await frozenNonceRestorationState/u); assert.match(frozenRestoreSource, /const restored = replay\.immediatePostFinalRawReplay/u); assert.ok(frozenRestoreSource.indexOf('immediatePostFinalRawReplay=record()') < frozenRestoreSource.indexOf('const separateTaskCanonicalA')); assert.ok(frozenRestoreSource.indexOf('const separateTaskCanonicalA') < frozenRestoreSource.indexOf('const settleBarrier')); assert.ok(frozenRestoreSource.indexOf('const settleBarrier') < frozenRestoreSource.indexOf('const canonical =')); assert.match(frozenRestoreSource, /frozen-corruption-final-raw-replay-settle-v1/u); assert.match(frozenRestoreSource, /immediateToSeparateTaskExact/u); assert.match(frozenRestoreSource, /separateTaskToBarrierBExact/u); assert.match(frozenRestoreSource, /frozen_nonce_corruption_restoration_drift/u); assert.match(frozenRestoreSource, /bounded-frozen-corruption-restoration-drift-v1/u); assert.match(frozenRestoreSource, /rawStyleExact/u); assert.match(frozenRestoreSource, /hostRectExact/u); assert.match(frozenRestoreSource, /formalRectExact/u);
  const strictCaptureStateSource = headedGateSource.slice(headedGateSource.indexOf('async function currentCaptureState('), headedGateSource.indexOf('async function currentFrozenNegativeCaptureState(')); const privateFrozenCaptureStateSource = headedGateSource.slice(headedGateSource.indexOf('async function currentFrozenNegativeCaptureState('), headedGateSource.indexOf('function presentationCaptureStateReader(')); const captureReaderSelectionSource = headedGateSource.slice(headedGateSource.indexOf('function presentationCaptureStateReader('), headedGateSource.indexOf('async function presentationDomStyleState(')); const saveViewportPlaneSource = headedGateSource.slice(headedGateSource.indexOf('async function saveViewportPlane('), headedGateSource.indexOf('async function captureInitialAutoLockEvidence(')); assert.ok(strictCaptureStateSource.length > 0 && privateFrozenCaptureStateSource.length > 0 && captureReaderSelectionSource.length > 0 && saveViewportPlaneSource.length > 0); assert.match(strictCaptureStateSource, /^async function currentCaptureState\(page, surface, timeoutMs = 15_000\)/u); assert.doesNotMatch(strictCaptureStateSource, /frozen/iu); assert.doesNotMatch(strictCaptureStateSource, /PRESENTATION_FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION|PRESENTATION_FROZEN_NEGATIVE_NONCE_READER_MODE|PRESENTATION_FROZEN_NONCE_MEASURER_SOURCE/u); assert.match(strictCaptureStateSource, /PRESENTATION_NONCE_LAYOUT_MEASURER_SOURCE/u); assert.doesNotMatch(strictCaptureStateSource, /authorityClass|readerMode|frozenAuthoritySha256|frozenActualSha256/u); assert.match(privateFrozenCaptureStateSource, /^async function currentFrozenNegativeCaptureState\(page, surface, frozenBackgroundNonceAuthority, timeoutMs = 15_000\)/u); assert.match(privateFrozenCaptureStateSource, /PRESENTATION_FROZEN_NONCE_MEASURER_SOURCE/u); assert.doesNotMatch(privateFrozenCaptureStateSource, /PRESENTATION_NONCE_LAYOUT_MEASURER_SOURCE/u); assert.ok(privateFrozenCaptureStateSource.includes("if(nonceNodes.length!==1)return{valid:false,firstCode:'presentation_background_nonce_frozen_layout_mismatch',failures:['nonce-host-count'],nonceHostCount:nonceNodes.length}")); assert.match(headedGateSource, /const COMPOSITOR_STABILITY_TIMEOUT_MS = 5_000;/u); assert.match(headedGateSource, /kind==='duplicate-host'/u); assert.match(captureReaderSelectionSource, /reader: currentCaptureState/u); assert.match(captureReaderSelectionSource, /reader: currentFrozenNegativeCaptureState/u); assert.match(saveViewportPlaneSource, /const stateReader = presentationCaptureStateReader\(frozenBackgroundNonceAuthority\); const readCurrentState =/u); assert.ok(saveViewportPlaneSource.indexOf('const stateReader =') < saveViewportPlaneSource.indexOf('for (let attempt = 1;')); assert.doesNotMatch(saveViewportPlaneSource, /currentCaptureState\(page, surface, remainingCaptureTimeout/u); evidence.hashes.strictCaptureStateSourceSha256 = sha256(Buffer.from(strictCaptureStateSource));
  assert.match(headedGateSource, /viewport-device-raster-nonce-v1/u);
  assert.match(headedGateSource, /viewport-device-raster-layout-binding-v1/u);
  assert.match(headedGateSource, /P\.x \+ Math\.floor\(index \* P\.width \/ PRESENTATION_NONCE_STRIPE_COUNT\)/u);
  assert.match(headedGateSource, /presentation_background_nonce_raster_domain_invalid/u);
  assert.match(headedGateSource, /const supportedDpr = \[1, 2\]\.includes\(dpr\)/u);
  assert.match(headedGateSource, /P\.width >= PRESENTATION_NONCE_STRIPE_COUNT/u);
  assert.match(headedGateSource, /scanDomainName: 'G'/u);
  assert.match(headedGateSource, /physicalDIsNonceAuthority: false/u);
  assert.match(headedGateSource, /fixed-10-sha61-fixed-1-v2/u);
  assert.match(headedGateSource, /function assemblePresentationNoncePattern\(tokenBits\)/u);
  assert.doesNotMatch(headedGateSource, /presentation nonce token bits must contain both bits/u);
  assert.doesNotMatch(headedGateSource, /display:grid|grid-template-columns|contain:strict|finitePaintFootprint|legacyCenterOwnership|PRESENTATION_NONCE_PRESERVED_P_PINS/u); assert.match(headedGateSource, /context\.putImageData\(raster,G\.x,G\.y\)/u); assert.match(headedGateSource, /context\.getImageData\(G\.x,G\.y,G\.width,G\.height\)/u); assert.match(headedGateSource, /paintedDomStripeCount/u); assert.match(headedGateSource, /expectedRasterRgbaSha256/u); assert.match(headedGateSource, /readbackRgbaSha256/u); assert.match(headedGateSource, /layoutBindingSha256/u); assert.match(headedGateSource, /presentation_background_nonce_canvas_state_invalid/u); assert.match(headedGateSource, /presentation_background_nonce_canvas_readback_mismatch/u); assert.match(headedGateSource, /presentation_background_nonce_compositor_effect_forbidden/u); assert.match(headedGateSource, /presentation_background_nonce_screenshot_dimensions_invalid/u); assert.match(headedGateSource, /crypto\.randomBytes\(32\)/u); assert.match(headedGateSource, /node-csprng-capture-challenge-v1/u); assert.match(headedGateSource, /presentation_capture_output_exists/u); assert.match(headedGateSource, /destinationPolicy: 'require-absent'/u); assert.match(headedGateSource, /TARGETED_REAL_DSF2_CLIP_ID/u); assert.match(headedGateSource, /viewport\.width\}x\$\{viewport\.height\}@\$\{viewport\.deviceScaleFactor\}/u);
  assert.equal((headedGateSource.match(/\$\{PRESENTATION_ANCESTOR_CHAIN_MEASURER_SOURCE\}/gu) ?? []).length, 3); assert.match(headedGateSource, /formal-parent-to-html-v1/u); assert.match(headedGateSource, /formal-then-parent-to-html-before-after-v1/u); assert.match(headedGateSource, /page-weakmap-and-baseline-map-stable-node-id-v1/u); assert.match(headedGateSource, /presentation_ancestor_chain_identity_invalid/u); assert.match(headedGateSource, /presentation_ancestor_compositor_effect_forbidden/u); assert.match(headedGateSource, /presentation_pseudo_compositor_effect_forbidden/u); assert.match(headedGateSource, /getComputedStyle\(owner\.node,pseudo\)/u); assert.match(headedGateSource, /pseudoCanonicalSha256/u); assert.match(headedGateSource, /feComponentTransfer-discrete-256-entry/u); assert.match(headedGateSource, /palettePreservedComponents/u); for (const property of ['filter', 'webkitFilter', 'backdropFilter', 'webkitBackdropFilter', 'opacity', 'mixBlendMode', 'transform', 'webkitTransform', 'transformStyle', 'webkitTransformStyle', 'perspective', 'webkitPerspective', 'clipPath', 'webkitClipPath', 'maskImage', 'webkitMaskImage', 'contain', 'scale', 'rotate', 'translate', 'zoom', 'imageRendering', 'offsetPath']) assert.match(headedGateSource, new RegExp(`(?:^|[^A-Za-z])${property}(?:[^A-Za-z]|$)`, 'u'));
  const ancestorReplaySource = headedGateSource.slice(headedGateSource.indexOf('async function ancestorCspRawStyleReplayBaselineOracle'), headedGateSource.indexOf('async function runAncestorCompositorGuardOracle')); assert.ok(ancestorReplaySource.length > 0); assert.match(ancestorReplaySource, /ancestor-csp-raw-style-replay-baseline-v1/u); assert.match(ancestorReplaySource, /connected-clean-absent-first-touch-style-replay-v1/u); assert.match(ancestorReplaySource, /probeCreatedRaw=rawAttribute\(probe\)/u); assert.match(ancestorReplaySource, /probePreReplayRaw=rawAttribute\(probe\)/u); assert.match(ancestorReplaySource, /styleAccessBeforeReplay:false/u); assert.match(ancestorReplaySource, /firstTouchConnectedBeforeReplay=probe\.isConnected/u); assert.match(ancestorReplaySource, /firstTouchCleanAbsentOracle/u); assert.match(ancestorReplaySource, /connected-raw-present-first-touch-style-replay-v1/u); assert.match(ancestorReplaySource, /rawPresentProbe\.setAttribute\('style','outline: 1px;'\)/u); assert.match(ancestorReplaySource, /rawPresentPreReplayRaw=rawAttribute\(rawPresentProbe\)/u); assert.match(ancestorReplaySource, /rawPresentReplay\.evidence\?\.preReplayCssText===''/u); assert.match(ancestorReplaySource, /rawPresentFirstTouchOracle/u); assert.ok(ancestorReplaySource.indexOf('probePreReplayRaw=rawAttribute(probe)') < ancestorReplaySource.indexOf("absent=attempt(probe,false,null,'ancestor-probe-absent')")); assert.ok(ancestorReplaySource.indexOf("absent=attempt(probe,false,null,'ancestor-probe-absent')") < ancestorReplaySource.indexOf("empty=attempt(probe,true,'','ancestor-probe-empty')")); assert.match(ancestorReplaySource, /ancestor-probe-empty/u); assert.match(ancestorReplaySource, /ancestor-probe-nonempty/u); assert.match(ancestorReplaySource, /PRESENTATION_CSP_RAW_STYLE_REPLAY_FAILURE_VIEW_SOURCE/u); assert.match(ancestorReplaySource, /presentation_ancestor_csp_raw_style_replay_oracle_failed/u); assert.match(ancestorReplaySource, /absent-final-remove-two-raf-style-access-v1/u); assert.match(ancestorReplaySource, /absentImmediateRaw=rawAttribute\(probe\)/u); assert.match(ancestorReplaySource, /absentPreStyleAccessRaw=rawAttribute\(probe\)/u); assert.match(ancestorReplaySource, /absentCssTextAfterBarrier=probe\.style\.cssText/u); assert.match(ancestorReplaySource, /absentPostStyleAccessRaw=rawAttribute\(probe\)/u); assert.ok(ancestorReplaySource.indexOf('absentImmediateRaw=rawAttribute(probe)') < ancestorReplaySource.indexOf('await new Promise(requestAnimationFrame)')); assert.ok(ancestorReplaySource.indexOf('absentPreStyleAccessRaw=rawAttribute(probe)') < ancestorReplaySource.indexOf('absentCssTextAfterBarrier=probe.style.cssText')); assert.ok(ancestorReplaySource.indexOf('absentCssTextAfterBarrier=probe.style.cssText') < ancestorReplaySource.indexOf('absentPostStyleAccessRaw=rawAttribute(probe)')); const ancestorOracleSource = headedGateSource.slice(headedGateSource.indexOf('async function runAncestorCompositorGuardOracle'), headedGateSource.indexOf('async function runCompositorFailureOracles')); assert.ok(ancestorOracleSource.length > 0); assert.doesNotMatch(ancestorOracleSource, /saveViewportPlane|captureViewportScreenshot/u); assert.match(ancestorOracleSource, /screenshotCaptureCount = 0/u); assert.match(ancestorOracleSource, /exactInlineStyleRestored/u); assert.doesNotMatch(ancestorOracleSource, /ancestor\.style\.cssText=state\.cssText/u); assert.match(ancestorOracleSource, /\(\$\{PRESENTATION_CSP_AWARE_RAW_STYLE_REPLAY_SOURCE\}\)\(ancestor,state\.hasAttribute,state\.attribute\)/u); assert.match(ancestorOracleSource, /transitionalRawStyleState/u); assert.match(ancestorOracleSource, /presentation_ancestor_csp_raw_style_replay_failed/u); assert.match(ancestorOracleSource, /ancestor-transitional-restore/u); assert.match(ancestorOracleSource, /ancestor-final-raw-replay/u); assert.match(ancestorOracleSource, /settledCssText=ancestor\.style\.cssText/u); assert.match(ancestorOracleSource, /finalRawRestoration/u); assert.match(ancestorOracleSource, /finalRawVerification/u); assert.match(ancestorOracleSource, /cspRawStyleReplayBaselineOracle/u); assert.match(ancestorOracleSource, /transitionalReplayEvidence/u); assert.match(ancestorOracleSource, /finalReplayEvidence/u); assert.ok(ancestorOracleSource.indexOf('const restoredState') < ancestorOracleSource.indexOf('const finalRawRestoration')); assert.ok(ancestorOracleSource.indexOf('const finalRawRestoration') < ancestorOracleSource.indexOf('const finalRawVerification')); const pseudoOracleSource = headedGateSource.slice(headedGateSource.indexOf('async function runPseudoCompositorGuardOracle'), headedGateSource.indexOf('async function runCompositorFailureOracles')); assert.ok(pseudoOracleSource.length > 0); assert.doesNotMatch(pseudoOracleSource, /saveViewportPlane|captureViewportScreenshot/u); assert.doesNotMatch(pseudoOracleSource, /createElement\(['"]style['"]\)|document\.head\.append|svg\.style/u); assert.match(pseudoOracleSource, /expectedSheetPath='\/style\.css'/u); assert.match(pseudoOracleSource, /sheet\.ownerNode===link&&link\.sheet===sheet/u); assert.match(pseudoOracleSource, /::after\{.*content:/u); assert.match(pseudoOracleSource, /backdrop-filter:url/u); assert.match(pseudoOracleSource, /\.insertRule\(/u); assert.match(pseudoOracleSource, /\.deleteRule\(/u); assert.match(pseudoOracleSource, /preRulesCssText/u); assert.match(pseudoOracleSource, /postRulesCssText/u); assert.match(pseudoOracleSource, /presentation_pseudo_oracle_cleanup_duplicate_rule/u); assert.match(pseudoOracleSource, /presentation_pseudo_oracle_cleanup_rule_missing/u); assert.match(pseudoOracleSource, /exactTargetAndAncestorIdsRestored/u);
  const maskMicro = runPresentationMaskMicroTest(); assert.equal(maskMicro.iterations, 10_000); assert.equal(maskMicro.smallMaskBytes, 64); assert.equal(maskMicro.largePixels, 1_572_864); assert.equal(maskMicro.largeMaskBytes, maskMicro.largePixels); assert.ok(maskMicro.publicSerializedBytes < 2_048); assert.equal(maskMicro.publicRuntimeFieldsAbsent, true); assert.equal(maskMicro.thresholdZeroAndTwoMasksExact, true); assert.equal(maskMicro.allWhiteReferenceTransitionAccepted, true); assert.equal(maskMicro.distinctReferenceTransitionAntiStale, true); assert.equal(maskMicro.implementation, 'dense-uint8array-single-buffer-hash'); assert.equal(maskMicro.rowEqualityImplementation, 'row-buffer-compare-and-native-hash'); assert.equal(maskMicro.globalEqualityImplementation, 'global-native-buffer-equality-evidence-only'); const portraitAuthority = maskMicro.measuredPhysicalAuthorityPortrait; assert.equal(portraitAuthority.authorityVersion, 'measured-F-exact-white-safe-interior-v2'); assert.deepEqual({ D: portraitAuthority.D, C: portraitAuthority.C, E: portraitAuthority.E, G: portraitAuthority.G, F: portraitAuthority.F }, { D: { x: 304, y: 210, width: 327, height: 581 }, C: { x: 305, y: 211, width: 325, height: 579 }, E: { x: 303, y: 209, width: 329, height: 583 }, G: { x: 302, y: 208, width: 331, height: 585 }, F: { x: 304, y: 209, width: 326, height: 580 } }); assert.deepEqual(portraitAuthority.safeInterior, portraitAuthority.F); assert.equal(portraitAuthority.changedPixels, 189_080); assert.equal(portraitAuthority.thresholdMasksByteExact, true); assert.deepEqual(portraitAuthority.edgeVsDDevicePixels, { left: 0, top: -1, right: -1, bottom: -2 }); assert.equal(portraitAuthority.nominalDAuthority, false); assert.equal(portraitAuthority.nominalCAuthority, false); assert.deepEqual(portraitAuthority.nominalCOutsideF, { pixels: 325, bbox: { x: 305, y: 789, width: 325, height: 1 }, expectedLastNominalCRow: { x: 305, y: 789, width: 325, height: 1 }, exact: true }); assert.equal(portraitAuthority.solidWhiteOracle.exact, true); assert.deepEqual(portraitAuthority.solidWhiteOracle.region, portraitAuthority.F); assert.equal(portraitAuthority.gMinusFBackgroundOracle.exact, true); assert.equal(portraitAuthority.gMinusFBackgroundOracle.pixels, 4_555);
  const alignedAuthority = maskMicro.negativeAlignedMeasuredAuthority; assert.equal(alignedAuthority.authorityVersion, 'negative-aligned-measured-F-chrome150-regression-v1'); assert.deepEqual(alignedAuthority.D, { x: 306, y: 212, width: 324, height: 576 }); assert.deepEqual(alignedAuthority.G, { x: 304, y: 210, width: 328, height: 580 }); assert.deepEqual(alignedAuthority.F, { x: 306, y: 211, width: 324, height: 576 }); assert.equal(alignedAuthority.changedPixels, 186_624); assert.equal(alignedAuthority.measuredFNominalDIntersectionPixels, 186_300); assert.equal(alignedAuthority.measuredFOutsideNominalDPixels, 324); assert.equal(alignedAuthority.measuredFNominalDIntersectionPixels + alignedAuthority.measuredFOutsideNominalDPixels, alignedAuthority.changedPixels); assert.deepEqual(alignedAuthority.edgeVsDDevicePixels, { left: 0, top: -1, right: 0, bottom: -1 }); assert.equal(alignedAuthority.measuredFEqualsNominalD, false); assert.equal(alignedAuthority.nominalDAuthority, false); assert.equal(alignedAuthority.nominalCAuthority, false); assert.equal(alignedAuthority.solidWhiteOracleExact, true); assert.equal(alignedAuthority.gMinusFBackgroundOracleExact, true);
  const flexStartPreparation = maskMicro.negativeFlexStartPreparation; assert.equal(flexStartPreparation.authorityVersion, 'negative-initial-flex-start-preparation-regression-v2'); assert.equal(flexStartPreparation.browserRuntimeAuthorityDerivedFromPolicyAfterTargetRect, true); assert.equal(flexStartPreparation.chrome150ObservedHorizontalSnapPinsDiagnosticOnly, true); assert.deepEqual(flexStartPreparation.intrinsic, { width: 360, height: 640 }); assert.equal(flexStartPreparation.legacyStageMaxHeight, 180); assert.equal(flexStartPreparation.preAlignComputedAlignItems, 'center'); assert.equal(flexStartPreparation.postAlignInlineAlignItems, 'flex-start'); assert.equal(flexStartPreparation.postAlignComputedAlignItems, 'flex-start'); assert.equal(flexStartPreparation.centeredOverflowOffsetCssPx, -230); assert.equal(flexStartPreparation.cases.length, 2); assert.deepEqual(flexStartPreparation.cases.map(({ dpr, alignedRect, flexStartLegacyRect, centeredFailure, flexStartGuard }) => ({ dpr, alignedRect, flexStartLegacyRect, centeredFirstCode: centeredFailure.firstCode, centeredGy: centeredFailure.G.y, D: flexStartGuard.D, G: flexStartGuard.G })), [{ dpr: 1, alignedRect: { left: 306, top: 212, right: 630, bottom: 788, width: 324, height: 576 }, flexStartLegacyRect: { left: 288, top: 212, right: 648, bottom: 852, width: 360, height: 640 }, centeredFirstCode: 'presentation_guard_out_of_viewport', centeredGy: -20, D: { x: 288, y: 212, width: 360, height: 640 }, G: { x: 286, y: 210, width: 364, height: 644 } }, { dpr: 2, alignedRect: { left: 305, top: 212, right: 629, bottom: 788, width: 324, height: 576 }, flexStartLegacyRect: { left: 287, top: 212, right: 647, bottom: 852, width: 360, height: 640 }, centeredFirstCode: 'presentation_guard_out_of_viewport', centeredGy: -38, D: { x: 574, y: 424, width: 720, height: 1280 }, G: { x: 572, y: 422, width: 724, height: 1284 } }]); for (const item of flexStartPreparation.cases) { const expectedHorizontalExpansionCssPx = (flexStartPreparation.intrinsic.width - item.alignedRect.width) / 2; assert.equal(item.intrinsicWidthDelta, 36); assert.equal(item.horizontalExpansionCssPx, expectedHorizontalExpansionCssPx); assert.equal(item.flexStartLegacyRect.left, item.alignedRect.left - expectedHorizontalExpansionCssPx); assert.equal(item.flexStartLegacyRect.right, item.alignedRect.right + expectedHorizontalExpansionCssPx); assert.equal(item.flexStartLegacyRect.top, item.alignedRect.top); assert.equal(item.flexStartLegacyRect.bottom, item.alignedRect.top + flexStartPreparation.intrinsic.height); assert.equal(Object.values(item.alignedPhysicalEdges).every(Number.isSafeInteger), true); assert.equal(Object.values(item.legacyPhysicalEdges).every(Number.isSafeInteger), true); assert.equal((item.alignedRect.left - item.flexStartLegacyRect.left) * item.dpr, 18 * item.dpr); assert.equal((item.flexStartLegacyRect.right - item.alignedRect.right) * item.dpr, 18 * item.dpr); assert.equal(item.flexStartGuard.exact, true); assert.equal(item.flexStartGuard.writeCount, 0); assert.equal(item.flexStartGuard.clampApplied, false); } assert.equal(flexStartPreparation.baselineRectUnchanged, true); assert.equal(flexStartPreparation.rootScrollUnchanged, true); assert.deepEqual(flexStartPreparation.stageScroll, { left: 0, top: 0 }); assert.equal(flexStartPreparation.mutationRepairWriteCount, 0);
  const restorationMicro = maskMicro.restorationAndCleanup; assert.deepEqual(restorationMicro.styleActions, { absent: { operation: 'remove-attribute', value: null }, empty: { operation: 'set-exact-attribute', value: '' }, oneCharacter: { operation: 'set-exact-attribute', value: 'x' }, nonempty: { operation: 'set-exact-attribute', value: 'color: red;' } }); assert.equal(restorationMicro.absentAndEmptyDistinct, true); assert.equal(restorationMicro.historicalCssomDiagnosticOnly, true); assert.equal(restorationMicro.presentationRawAuthorityExact, true); assert.equal(restorationMicro.negativeRawAuthorityExact, true); assert.equal(restorationMicro.readOnlySettleBarrierCount, 1); assert.equal(restorationMicro.readOnlySettleRafCount, 2); assert.equal(restorationMicro.postFinalRawReplayReadOnlySnapshotCount, 2); assert.equal(restorationMicro.postFinalRawReplayCssomStable, true); assert.equal(restorationMicro.historicalCssomMismatchAcceptedDiagnosticOnly, true); assert.equal(restorationMicro.cssomInstabilityRejected, true); assert.equal(restorationMicro.semanticProjectionMutationCount, 5); assert.equal(restorationMicro.semanticProjectionMutationsRejected, true); assert.equal(restorationMicro.primaryIdentityPreserved, true); assert.equal(restorationMicro.primaryCodePreserved, true); assert.equal(restorationMicro.cleanupFailureAttachedBounded, true); assert.equal(restorationMicro.cleanupTraceDiagnosticValueBearing, true); assert.equal(restorationMicro.cleanupTraceDiagnosticContentBounded, true); assert.equal(restorationMicro.cleanupOnlyIdentityPreserved, true); assert.equal(restorationMicro.frozenAuthorityDeepFrozen, true); assert.equal(restorationMicro.crossCaseSubstitutionRejectedByCanonicalHash, true); assert.deepEqual(maskMicro.captureStateReaderSeparation, { authorityVersion: 'node-reader-selection-before-capture-loop-v1', strictReaderName: 'currentCaptureState', strictReaderMode: 'strict-current-formal-v1', strictReaderFunctionIdentityExact: true, strictReaderFrozenSourceAbsent: true, strictReaderFrozenAuthorityRequired: false, privateNegativeReaderName: 'currentFrozenNegativeCaptureState', privateNegativeReaderMode: FROZEN_NEGATIVE_NONCE_READER_MODE, privateNegativeReaderFunctionIdentityExact: true, privateNegativeReaderSeparated: true }); assert.equal(maskMicro.surfaceParentIdentity.authorityVersion, 'explicit-stage-parent-blueprint-identity-v1'); assert.equal(maskMicro.surfaceParentIdentity.modeCount, 4); assert.deepEqual(maskMicro.surfaceParentIdentity.modes, ['first', 'second', 'source-first-c0', 'adjudication-reveal']); assert.deepEqual(maskMicro.surfaceParentIdentity.parentClassAttributes, ['viewer', 'viewer', 'viewer', 'reveal-source']); assert.equal(maskMicro.surfaceParentIdentity.revealParentSupported, true);
  assert.equal(flexStartPreparation.alignedStageTopCssPx, 212.03125); assert.equal(flexStartPreparation.formalInlineTop, '-0.03125px'); assert.equal(flexStartPreparation.formalStageTopDeltaCssPx, -0.03125); assert.equal(flexStartPreparation.fractionalStageTopPreserved, true);
  const edgePartition = maskMicro.negativeEdgeModeledMeasuredFPartition; assert.equal(edgePartition.authorityVersion, 'negative-edge-modeled-measured-f-nominal-d-partition-regression-v2'); assert.equal(edgePartition.modeledAuthorityOnly, true); assert.equal(edgePartition.browserRuntimeAuthorityDerivedFromCoverage, true); assert.equal(edgePartition.browserRuntimeDpr2InsetMustNotUseModeledPin, true); assert.deepEqual(edgePartition.modeledFOffsetDevicePixels, { left: 0, top: -1, right: 0, bottom: -1 }); assert.deepEqual(edgePartition.cases.map(({ dpr, edge, expectedChangedPixels, expectedInsideGeometryChangedPixels, expectedOutsideGeometryChangedPixels, partitionExact }) => ({ dpr, edge, expectedChangedPixels, expectedInsideGeometryChangedPixels, expectedOutsideGeometryChangedPixels, partitionExact })), [{ dpr: 1, edge: 'top', expectedChangedPixels: 186_300, expectedInsideGeometryChangedPixels: 186_300, expectedOutsideGeometryChangedPixels: 0, partitionExact: true }, { dpr: 1, edge: 'right', expectedChangedPixels: 186_048, expectedInsideGeometryChangedPixels: 185_725, expectedOutsideGeometryChangedPixels: 323, partitionExact: true }, { dpr: 1, edge: 'bottom', expectedChangedPixels: 186_300, expectedInsideGeometryChangedPixels: 185_976, expectedOutsideGeometryChangedPixels: 324, partitionExact: true }, { dpr: 1, edge: 'left', expectedChangedPixels: 186_048, expectedInsideGeometryChangedPixels: 185_725, expectedOutsideGeometryChangedPixels: 323, partitionExact: true }, { dpr: 2, edge: 'top', expectedChangedPixels: 745_200, expectedInsideGeometryChangedPixels: 745_200, expectedOutsideGeometryChangedPixels: 0, partitionExact: true }, { dpr: 2, edge: 'right', expectedChangedPixels: 744_192, expectedInsideGeometryChangedPixels: 743_546, expectedOutsideGeometryChangedPixels: 646, partitionExact: true }, { dpr: 2, edge: 'bottom', expectedChangedPixels: 745_200, expectedInsideGeometryChangedPixels: 744_552, expectedOutsideGeometryChangedPixels: 648, partitionExact: true }, { dpr: 2, edge: 'left', expectedChangedPixels: 744_192, expectedInsideGeometryChangedPixels: 743_546, expectedOutsideGeometryChangedPixels: 646, partitionExact: true }]); assert.deepEqual(edgePartition.cases.map(({ dpr, edge, signedGapDevicePixels, compensationDevicePixels, appliedInsetDevicePixels, appliedInsetCssPx }) => ({ dpr, edge, signedGapDevicePixels, compensationDevicePixels, appliedInsetDevicePixels, appliedInsetCssPx })), [{ dpr: 1, edge: 'top', signedGapDevicePixels: -1, compensationDevicePixels: 0, appliedInsetDevicePixels: 1, appliedInsetCssPx: 1 }, { dpr: 1, edge: 'right', signedGapDevicePixels: 0, compensationDevicePixels: 0, appliedInsetDevicePixels: 1, appliedInsetCssPx: 1 }, { dpr: 1, edge: 'bottom', signedGapDevicePixels: 1, compensationDevicePixels: 1, appliedInsetDevicePixels: 2, appliedInsetCssPx: 2 }, { dpr: 1, edge: 'left', signedGapDevicePixels: 0, compensationDevicePixels: 0, appliedInsetDevicePixels: 1, appliedInsetCssPx: 1 }, { dpr: 2, edge: 'top', signedGapDevicePixels: -1, compensationDevicePixels: 0, appliedInsetDevicePixels: 2, appliedInsetCssPx: 1 }, { dpr: 2, edge: 'right', signedGapDevicePixels: 0, compensationDevicePixels: 0, appliedInsetDevicePixels: 2, appliedInsetCssPx: 1 }, { dpr: 2, edge: 'bottom', signedGapDevicePixels: 1, compensationDevicePixels: 1, appliedInsetDevicePixels: 3, appliedInsetCssPx: 1.5 }, { dpr: 2, edge: 'left', signedGapDevicePixels: 0, compensationDevicePixels: 0, appliedInsetDevicePixels: 2, appliedInsetCssPx: 1 }]); for (const item of edgePartition.cases) { assert.equal(item.requestedMeasuredBandCssPx, 1); assert.equal(item.requestedMeasuredBandDevicePixels, item.dpr); assert.equal(item.appliedInsetDevicePixels, item.compensationDevicePixels + item.dpr); assert.equal(item.appliedInsetCssPx * item.dpr, item.appliedInsetDevicePixels); assert.equal(Math.abs(item.postMeasuredFEdgeDevicePx - item.preMeasuredFEdgeDevicePx), item.dpr); assert.match(item.baselineBindingSha256, SHA); assert.match(item.planCanonicalSha256, SHA); assert.equal(item.planComputedOnceFromFrozenBaseline, true); assert.equal(item.adaptiveReplanForbidden, true); assert.equal(item.expectedInsideGeometryChangedPixels + item.expectedOutsideGeometryChangedPixels, item.expectedChangedPixels); assert.equal(item.expectedChangedPixels, item.expectedTargetObservedCoverageBbox.width * item.expectedTargetObservedCoverageBbox.height); }
  assert.deepEqual([...new Map(edgePartition.cases.map((item) => [item.dpr, item.nominalD.x])).entries()], [[1, 306], [2, 610]]); assert.deepEqual([...new Map(edgePartition.cases.map((item) => [item.dpr, item.modeledF.x])).entries()], [[1, 306], [2, 610]]);
  const cspFirstTouch = maskMicro.cspStyleReplayFirstTouch;
  assert.equal(cspFirstTouch.authorityVersion, 'csp-current-raw-first-touch-preparation-micro-v1');
  assert.equal(cspFirstTouch.replayOrder, 'current-raw-aware-preparation-then-tristate-final-write-v3');
  assert.equal(cspFirstTouch.currentRawSnapshottedBeforeStyleAccess, true);
  assert.equal(cspFirstTouch.preReplayCssTextGetterBeforeConditionalSetter, true);
  assert.equal(cspFirstTouch.rawSyncBarrierBeforeFinalWrite, true);
  assert.deepEqual(cspFirstTouch.currentAbsent, { clearMode: 'current-absent-read-only', cssomClearWriteApplied: false, clearVerification: 'raw-absent-and-cssom-empty', finalAbsentWrite: 'remove-attribute-last' });
  assert.deepEqual(cspFirstTouch.currentPresent, { clearMode: 'current-present-cssom-write', cssomClearWriteApplied: true, clearVerification: 'raw-present-empty-and-cssom-empty' });
  assert.equal(cspFirstTouch.desiredEmptyFinalWrite, 'set-exact-empty-attribute');
  assert.equal(cspFirstTouch.desiredNonemptyFinalWrite, 'cssom-assignment');
  assert.equal(cspFirstTouch.noHistoricalCssomReplay, true);
  assert.equal(maskMicro.nonceGrammar.authorityVersion, 'viewport-device-raster-nonce-v1');
  assert.equal(maskMicro.nonceGrammar.supportedDpr, true);
  assert.equal(maskMicro.nonceGrammar.scanDomainName, 'G');
  assert.equal(maskMicro.nonceGrammar.scanDomainPolicy, 'every-G-pixel-byte-exact-threshold-0-v1');
  assert.equal(maskMicro.nonceGrammar.physicalDIsNonceAuthority, false);
  assert.deepEqual(maskMicro.nonceGrammar.P, { x: 22, y: 20, width: 258, height: 62 });
  assert.deepEqual(maskMicro.nonceGrammar.G, { x: 18, y: 18, width: 263, height: 66 });
  assert.equal(maskMicro.nonceGrammar.boundaries.length, 65);
  assert.equal(maskMicro.nonceGrammar.boundaries[0], maskMicro.nonceGrammar.P.x);
  assert.equal(maskMicro.nonceGrammar.boundaries.at(-1), maskMicro.nonceGrammar.P.x + maskMicro.nonceGrammar.P.width);
  assert.equal(maskMicro.nonceGrammar.boundariesStrict, true);
  assert.ok(maskMicro.nonceGrammar.boundaries.every((value, index, boundaries) => Number.isSafeInteger(value) && (index === 0 || value > boundaries[index - 1])));
  assert.match(maskMicro.nonceGrammar.patternBits, /^10[01]{61}1$/u);
  assert.equal(maskMicro.nonceGrammar.PRowBitsExact, true);
  assert.equal(maskMicro.nonceGrammar.PRowEdgesExact, true);
  assert.equal(maskMicro.nonceGrammar.gOutsidePExact, true);
  assert.equal(maskMicro.nonceGrammar.mismatchThreshold, 0);
  assert.equal(maskMicro.nonceGrammar.mismatchPixels, 0);
  assert.equal(maskMicro.nonceGrammar.paintedDomStripeCount, 0);
  assert.equal(maskMicro.nonceGrammar.fixedContainingBlockViewportExact, true);
  assert.equal(maskMicro.nonceGrammar.expectedRasterRgbaSha256, '36512a1a78da2807689d82c81df612c9d16eb97bc105578e2f3f64ae1518d11b');
  assert.equal(maskMicro.nonceGrammar.canvasReadbackRgbaSha256, maskMicro.nonceGrammar.expectedRasterRgbaSha256);
  assert.equal(maskMicro.nonceGrammar.expectedRasterRgbSha256, 'ce1f432d821085e3fbfbed0c5a194983d19dbab1d85009f896f8e203be98f849');
  assert.equal(maskMicro.nonceGrammar.screenshotRasterRgbSha256, maskMicro.nonceGrammar.expectedRasterRgbSha256);
  assert.equal(maskMicro.nonceGrammar.layoutBindingSha256, 'c47a02d2fc89cec148a9d681204e71759185805e9ee17f2b1fa06a55b0de22bf');
  assert.equal(maskMicro.nonceGrammar.actualLayoutSha256, 'a0551caf74412e6503a527392cfd94dc06bacdf68e72f8825479110408adefb4');
  assert.equal(maskMicro.nonceGrammar.rowTopologyCanonicalSha256, '548f8bdc74e57d55635e85842523e8ed1839333b9bff19b80615a404f2ec4af5');
  assert.deepEqual(maskMicro.nonceGrammar.totalizedPatterns, [
    { name: 'all-zero-token-bits', patternVersion: 'fixed-10-sha61-fixed-1-v2', tokenBitCount: 61, fixedPrefix: '10', fixedSuffix: '1', transitionCount: 2, accepted: true },
    { name: 'all-one-token-bits', patternVersion: 'fixed-10-sha61-fixed-1-v2', tokenBitCount: 61, fixedPrefix: '10', fixedSuffix: '1', transitionCount: 2, accepted: true },
  ]);
  assert.deepEqual(maskMicro.nonceGrammar.offlineGeometryToPRegression.map(({ authorityVersion, dpr, P, expectedP, exact }) => ({ authorityVersion, dpr, P, expectedP, exact })), [
    { authorityVersion: 'offline-pure-geometry-to-P-regression-v1', dpr: 1, P: { x: 33, y: 165, width: 694, height: 391 }, expectedP: { x: 33, y: 165, width: 694, height: 391 }, exact: true },
    { authorityVersion: 'offline-pure-geometry-to-P-regression-v1', dpr: 2, P: { x: 66, y: 330, width: 1388, height: 782 }, expectedP: { x: 66, y: 330, width: 1388, height: 782 }, exact: true },
  ]);
  const nonceMutationNames = [
    'wrong-color-pixel', 'wrong-bit-pixel', 'transition-plus-one', 'transition-minus-one', 'one-row-transition-drift', 'missing-run', 'extra-run', 'P-left-endpoint', 'P-right-endpoint', 'G-minus-P-black', 'wrong-token', 'same-case-stale-replay',
    'wrong-dpr-layout-binding', 'unsupported-DPR3-integer',
    'backing-width-minus-one', 'backing-height-minus-one', 'canvas-css-origin-x-minus-one', 'canvas-css-origin-y-minus-one', 'canvas-css-width-minus-one', 'canvas-css-height-minus-one',
    'backing-width-plus-one', 'backing-height-plus-one', 'canvas-css-origin-x-plus-one', 'canvas-css-origin-y-plus-one', 'canvas-css-width-plus-one', 'canvas-css-height-plus-one',
    'host-rect-left-plus-one', 'fixed-containing-block-mutation', 'canvas-context-transform-mutation', 'painted-DOM-stripe-child',
    'canvas-readback-pixel', 'canvas-transform-mutation', 'host-filter-mutation', 'canvas-opacity-mutation', 'host-contain-mutation',
    'screenshot-width-minus-one', 'screenshot-width-plus-one', 'screenshot-height-minus-one', 'screenshot-height-plus-one',
  ];
  assert.equal(maskMicro.nonceGrammar.mutationCount, 39);
  assert.deepEqual(maskMicro.nonceGrammar.mutations.map((item) => item.mutation), nonceMutationNames);
  assert.equal(maskMicro.nonceGrammar.mismatchMutationCount, 12);
  assert.equal(maskMicro.nonceGrammar.noScreenshotStateOracleCount, 39);
  assert.deepEqual(Object.fromEntries([...new Set(maskMicro.nonceGrammar.mutations.map((item) => item.firstCode))].map((code) => [code, maskMicro.nonceGrammar.mutations.filter((item) => item.firstCode === code).length])), {
    presentation_background_nonce_mismatch: 12,
    presentation_background_nonce_layout_invalid: 1,
    presentation_background_nonce_raster_domain_invalid: 1,
    presentation_background_nonce_canvas_state_invalid: 16,
    presentation_background_nonce_canvas_readback_mismatch: 1,
    presentation_background_nonce_compositor_effect_forbidden: 4,
    presentation_background_nonce_screenshot_dimensions_invalid: 4,
  });
  assert.deepEqual(maskMicro.nonceGrammar.exactFirstCodes, maskMicro.nonceGrammar.mutations.map(({ mutation, firstCode }) => ({ mutation, firstCode })));
  assert.equal(maskMicro.nonceGrammar.mutations.find((item) => item.mutation === 'G-minus-P-black').failure, 'viewport-device-raster-byte-mismatch');
  assert.equal(maskMicro.nonceGrammar.sameCaseReplay.authorityVersion, 'node-csprng-capture-challenge-v1'); assert.equal(maskMicro.nonceGrammar.sameCaseReplay.entropyBytes, 32); assert.equal(maskMicro.nonceGrammar.sameCaseReplay.bindingKeySha256Exact, true); assert.equal(maskMicro.nonceGrammar.sameCaseReplay.captureChallengeSha256Distinct, true); assert.equal(maskMicro.nonceGrammar.sameCaseReplay.firstCode, 'presentation_background_nonce_mismatch');
  assert.equal(maskMicro.pngCrc.implementation, 'table-256-indexed-byte-loop'); assert.deepEqual(maskMicro.pngCrc.crc32KnownVector, { input: '123456789', expected: 'cbf43926', actual: 'cbf43926', exact: true }); assert.equal(maskMicro.pngCrc.minimalRgb8Type2PngPositive, true); assert.deepEqual(maskMicro.pngCrc.minimalPng, { width: 1, height: 1, bitDepth: 8, colorType: 2, rgb: [17, 34, 51], chunkTypes: ['IHDR', 'IDAT', 'IEND'] }); assert.equal(maskMicro.pngCrc.mutationCount, 3); assert.deepEqual(maskMicro.pngCrc.mutationChunkTypes, ['IHDR', 'IDAT', 'IEND']); assert.deepEqual(maskMicro.pngCrc.mutationFirstCodes, Array(3).fill('presentation_screenshot_png_crc_invalid')); assert.equal(maskMicro.pngCrc.mutations.length, 3); for (const [chunkIndex, chunkType] of ['IHDR', 'IDAT', 'IEND'].entries()) assert.deepEqual({ chunkType: maskMicro.pngCrc.mutations[chunkIndex].chunkType, chunkIndex: maskMicro.pngCrc.mutations[chunkIndex].chunkIndex, firstCode: maskMicro.pngCrc.mutations[chunkIndex].firstCode, evidenceChunkType: maskMicro.pngCrc.mutations[chunkIndex].evidenceChunkType, evidenceChunkIndex: maskMicro.pngCrc.mutations[chunkIndex].evidenceChunkIndex, storedCrcOneBitMutated: maskMicro.pngCrc.mutations[chunkIndex].storedCrcOneBitMutated }, { chunkType, chunkIndex, firstCode: 'presentation_screenshot_png_crc_invalid', evidenceChunkType: chunkType, evidenceChunkIndex: chunkIndex, storedCrcOneBitMutated: true });
  const ancestorProperties = ['filter', 'webkitFilter', 'backdropFilter', 'webkitBackdropFilter', 'opacity', 'mixBlendMode', 'transform', 'webkitTransform', 'transformStyle', 'webkitTransformStyle', 'perspective', 'webkitPerspective', 'clipPath', 'webkitClipPath', 'maskImage', 'webkitMaskImage', 'contain', 'scale', 'rotate', 'translate', 'zoom', 'imageRendering', 'offsetPath']; assert.equal(maskMicro.ancestorGuard.canonicalAncestorCount, 5); assert.equal(maskMicro.ancestorGuard.canonicalOrder, 'formal-parent-to-html-v1'); assert.equal(maskMicro.ancestorGuard.pseudoCanonicalOrder, 'formal-then-parent-to-html-before-after-v1'); assert.equal(maskMicro.ancestorGuard.pseudoRecordCount, 12); assert.equal(maskMicro.ancestorGuard.pseudoOwnerCount, 6); assert.equal(maskMicro.ancestorGuard.targetPseudoVisibilityOwnerBound, true); assert.equal(maskMicro.ancestorGuard.targetNodeIdentityBound, true); assert.equal(maskMicro.ancestorGuard.compositorPropertyCount, ancestorProperties.length); assert.deepEqual(maskMicro.ancestorGuard.compositorProperties, ancestorProperties); assert.deepEqual(maskMicro.ancestorGuard.compositorFirstCodes, Array(ancestorProperties.length).fill('presentation_ancestor_compositor_effect_forbidden')); const pseudoProperties = ['content', 'filter', 'webkitFilter', 'backdropFilter', 'webkitBackdropFilter', 'opacity', 'mixBlendMode', 'transform', 'webkitTransform', 'clipPath', 'webkitClipPath', 'maskImage', 'webkitMaskImage', 'scale', 'rotate', 'translate', 'isolation', 'visibility']; assert.equal(maskMicro.ancestorGuard.pseudoPropertyCount, pseudoProperties.length); assert.deepEqual(maskMicro.ancestorGuard.pseudoProperties, pseudoProperties); assert.deepEqual(maskMicro.ancestorGuard.pseudoFirstCodes, Array(pseudoProperties.length).fill('presentation_pseudo_compositor_effect_forbidden')); const identityMutationNames = ['runtime-node-replacement', 'target-node-id-drift', 'ancestor-reordered', 'html-removed', 'pseudo-owner-id-drift', 'pseudo-order-swapped', 'pseudo-record-removed']; assert.equal(maskMicro.ancestorGuard.identityMutationCount, identityMutationNames.length); assert.deepEqual(maskMicro.ancestorGuard.identityMutations.map((item) => item.mutation), identityMutationNames); assert.deepEqual(maskMicro.ancestorGuard.identityMutations.map((item) => item.firstCode), Array(identityMutationNames.length).fill('presentation_ancestor_chain_identity_invalid')); const formalModernProperties = ['webkitFilter', 'webkitBackdropFilter', 'perspective', 'webkitTransform', 'transformStyle', 'webkitTransformStyle', 'webkitPerspective', 'webkitClipPath', 'contain', 'scale', 'rotate', 'translate', 'zoom', 'imageRendering', 'offsetPath']; assert.equal(maskMicro.ancestorGuard.formalModernPropertyCount, formalModernProperties.length); assert.deepEqual(maskMicro.ancestorGuard.formalModernProperties, formalModernProperties); assert.deepEqual(maskMicro.ancestorGuard.formalModernFirstCodes, Array(formalModernProperties.length).fill('presentation_modern_paint_effect_forbidden')); evidence.performance.presentationDenseMaskMicro = maskMicro;
  evidence.hashes.presentationContractSha256 = PRESENTATION_CONTRACT_SHA256; evidence.hashes.prefitPresentationContractSha256 = PREFIT_PRESENTATION_CONTRACT_SHA256; evidence.counts.presentationViewerAssets = presentationDescriptor.viewerAssets.length;
  assert.equal(core.fixedInputSetSha256([]), FIXTURE.sessionTreeContract.blindFixedInputSetSha256);
  const revealEntries = [...FIXTURE.sessionTreeContract.revealFixedLogicalPaths].reverse().map((logicalPath, index) => ({ logicalPath, bytes: index + 1, sha256: `${(index + 1).toString(16)}`.repeat(64) }));
  const normalizedReveal = core.fixedInputDescriptors(revealEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths });
  assert.deepEqual(normalizedReveal.map((entry) => entry.logicalPath), FIXTURE.sessionTreeContract.revealFixedLogicalPaths);
  assert.equal(core.fixedInputSetSha256(revealEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths }), sha256(core.processBytes(normalizedReveal)));
  await expectCode('session-tree:fixed-duplicate', 'fixed_input_set_invalid', () => core.fixedInputDescriptors([...revealEntries, clone(revealEntries[0])]));
  await expectCode('session-tree:fixed-extra-key', 'fixed_input_descriptor_not_closed', () => core.fixedInputDescriptors([{ ...clone(revealEntries[0]), expectedSha256: ZERO_SHA }]));
  await expectCode('session-tree:fixed-path-set', 'fixed_input_set_invalid', () => core.fixedInputDescriptors(revealEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths.slice(1) }));

  const fields = {
    terminalState: 'closed', cycleId: CYCLE, mode: 'first', actorPseudonymSha256: ACTOR_A, presentationContractSha256: PRESENTATION_CONTRACT_SHA256,
    bundleManifestByteSha256: '1'.repeat(64), immutableAssetSetSha256: '2'.repeat(64), fixedInputSetSha256: FIXTURE.sessionTreeContract.blindFixedInputSetSha256,
    sessionSeedByteSha256: '3'.repeat(64), sessionFinalStateByteSha256: '4'.repeat(64), editJournalByteSha256: '5'.repeat(64),
    actorAttestationByteSha256: '6'.repeat(64), accessEvidenceByteSha256: '7'.repeat(64),
  };
  const independentDescriptor = { artifactType: 'sam-goal-review-session-tree-descriptor-v1', schemaVersion: 1, ...PROCESS_MARKER, ...clone(fields) };
  const descriptor = core.makeSessionTreeDescriptor(fields); assert.deepEqual(descriptor, independentDescriptor); assert.equal(core.validateSessionTreeDescriptor(descriptor), true);
  const independentHash = sha256(core.processBytes(independentDescriptor)); assert.equal(core.sessionTreeSha256(fields), independentHash); assert.equal(core.sessionTreeSha256(descriptor), independentHash); assert.equal(core.assertExpectedSessionTreeSha256(independentHash, descriptor), independentHash);
  await expectCode('session-tree:expected-mismatch', 'session_tree_hash_mismatch', () => core.assertExpectedSessionTreeSha256(ZERO_SHA, descriptor));
  await expectCode('session-tree:fields-not-closed', 'session_tree_fields_not_closed', () => core.makeSessionTreeDescriptor({ ...fields, expectedSessionTreeSha256: independentHash }));
  await expectCode('session-tree:descriptor-not-closed', 'session_tree_descriptor_not_closed', () => core.validateSessionTreeDescriptor({ ...descriptor, path: '/forbidden' }));
  await expectCode('session-tree:terminal-not-closed', 'session_tree_descriptor_invalid', () => core.makeSessionTreeDescriptor({ ...fields, terminalState: 'open' }));
  await expectCode('session-tree:component-hash-uppercase', 'session_tree_descriptor_invalid', () => core.makeSessionTreeDescriptor({ ...fields, accessEvidenceByteSha256: 'A'.repeat(64) }));

  const envelope = core.makeSessionSealEnvelope(fields); assert.deepEqual(Object.keys(envelope), FIXTURE.sessionTreeContract.serveStdoutFields); assert.equal(envelope.status, FIXTURE.sessionTreeContract.serveStdoutStatus); assert.equal(envelope.sessionTreeSha256, independentHash);
  const envelopeBytes = core.processBytes(envelope); assert.equal(envelopeBytes.at(-1), 0x0a); assert.notEqual(envelopeBytes.at(-2), 0x0a); assert.equal(stableStringify(core.parseJsonBuffer(envelopeBytes, { processArtifact: true })), stableStringify(envelope));

  const descriptorMutations = [
    ['terminalState', 'open'], ['presentationContractSha256', '0'.repeat(64)], ['bundleManifestByteSha256', '8'.repeat(64)], ['immutableAssetSetSha256', '9'.repeat(64)], ['fixedInputSetSha256', 'a'.repeat(64)],
    ['sessionSeedByteSha256', 'b'.repeat(64)], ['sessionFinalStateByteSha256', 'c'.repeat(64)], ['editJournalByteSha256', 'd'.repeat(64)],
    ['actorAttestationByteSha256', 'e'.repeat(64)], ['accessEvidenceByteSha256', 'f'.repeat(64)],
  ];
  const digestSet = new Set([independentHash]);
  for (const [field, value] of descriptorMutations) {
    const mutated = { ...clone(independentDescriptor), [field]: value }; digestSet.add(sha256(core.processBytes(mutated)));
    if (field !== 'terminalState') {
      const mutatedFields = { ...fields, [field]: value }; assert.equal(core.sessionTreeSha256(mutatedFields), sha256(core.processBytes(mutated)));
      await expectCode(`session-tree:component-mismatch:${field}`, 'session_tree_hash_mismatch', () => core.assertExpectedSessionTreeSha256(independentHash, mutatedFields));
    }
  }
  assert.equal(digestSet.size, descriptorMutations.length + 1);
  evidence.counts.sessionTreeDescriptorFields = Object.keys(descriptor).length; evidence.counts.sessionTreeEnvelopeFields = Object.keys(envelope).length;
  evidence.counts.sessionTreeComponentMutationBranches = descriptorMutations.length; evidence.hashes.blindFixedInputSetSha256 = core.fixedInputSetSha256([]); evidence.hashes.sessionTreeOracleSha256 = independentHash;
}

function assertRulebookContract() {
  const bytes = readFileSync(RULEBOOK); const text = bytes.toString('utf8');
  assert.equal(Buffer.from(text, 'utf8').equals(bytes), true);
  for (const phrase of ['UNSET', '100 ms', 'unreliableMinimumMs=200', 'anatomical left', 'full_clip_denominator', 'sourceFrameIndex', 'ptsTicks', 'C0_WINDOW_MISSING', 'restart_cycle']) assert.match(text, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), `rulebook phrase missing: ${phrase}`);
  for (const alias of FIXTURE.forbiddenAliases) assert.match(text, new RegExp(alias, 'iu'), `rulebook must explicitly reject alias: ${alias}`);
  assert.doesNotMatch(text, /(?:SAM|teacher|detector|avatar|metric).{0,80}(?:suggest|recommend|prefill)/iu);
  evidence.hashes.rulebookByteSha256 = sha256(bytes);
}

async function testWorksheetTruthAndEvidence(publicState) {
  const initial = core.createWorksheet({ publicState, mode: 'first', actorPseudonymSha256: ACTOR_A, cycleId: CYCLE, bundleManifestByteSha256: '4'.repeat(64), rulebookByteSha256: '5'.repeat(64) });
  assert.equal(core.containsUnset(initial), true); core.validateWorksheet(initial, publicState, { expectedMode: 'first' });
  assert.equal(initial.rows.length, 6711); assert.equal(initial.windows.length, 7);
  assert.ok(initial.rows.every((row, index) => stableStringify(exactIdentity(row)) === stableStringify(exactIdentity(publicState.decoderRows[index]))));
  assert.ok(initial.windows.every((window) => window.origin === 'structural_base' && stableStringify(window.purposeTags) === stableStringify(['full_clip_denominator']) && core.containsUnset(window.scenarioTags)));

  const worksheetA = completeWorksheet(publicState, 'first', ACTOR_A);
  const worksheetB = completeWorksheet(publicState, 'second', ACTOR_B);
  const worksheetC0 = completeWorksheet(publicState, 'source-first-c0', ACTOR_C0);
  for (const [mode, worksheet] of [['first', worksheetA], ['second', worksheetB], ['source-first-c0', worksheetC0]]) {
    assert.equal(core.containsUnset(worksheet), false); core.validateWorksheet(worksheet, publicState, { requireComplete: true, expectedMode: mode });
  }
  const reviewA = core.worksheetToReview(worksheetA, publicState); const reviewB = core.worksheetToReview(worksheetB, publicState);
  assert.equal(core.materializeReview(reviewA, publicState, { expectedRole: 'first', expectedPseudonym: ACTOR_A }).length, 6711);
  assert.equal(core.materializeReview(reviewB, publicState, { expectedRole: 'second', expectedPseudonym: ACTOR_B }).length, 6711);
  const agreement = core.rawAgreement(reviewA, reviewB, publicState);
  assert.deepEqual(agreement.thresholds, FIXTURE.thresholds); assert.equal(agreement.gatePass, true);
  assert.deepEqual(Object.fromEntries(Object.entries(agreement.cells).map(([family, cells]) => [family, cells.length])), { presencePersonState: 7, contact: 14, observability: 84 });
  assert.deepEqual(agreement.macros, { presencePersonStateKappa: 1, contactKappa: 1, observabilityKappa: 1 });
  const evidenceA = core.reviewEvidence(reviewA, publicState); const evidenceB = core.reviewEvidence(reviewB, publicState);
  assert.equal(evidenceA.gatePass, true); assert.equal(evidenceB.gatePass, true);
  assert.equal(evidenceA.support.reacquireEvents.length, 3); assert.deepEqual(evidenceA.support.hardTestReacquireClips, ['arms-crossed', 'csi-pose']);
  assert.ok(Object.values(evidenceA.support.contact).every((entry) => entry.frames >= 300 && entry.clips.length >= 2));
  assert.ok([evidenceA.support.head.head, evidenceA.support.hand.leftHand, evidenceA.support.hand.rightHand].every((entry) => entry.frames >= 300 && entry.clips.length >= 2));

  await expectCode('worksheet:unset', 'worksheet_unset', () => core.validateWorksheet(initial, publicState, { requireComplete: true, expectedMode: 'first' }));
  const row = worksheetA.rows.find((item) => item.clipId === 'dance-16x9-padded' && item.sourceFrameIndex === 100); const saved = clone(row.manualState);
  const mutateAndReject = async (name, code, mutation) => {
    row.manualState = clone(saved); mutation(row.manualState); await expectCode(name, code, () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' }));
  };
  await mutateAndReject('truth:absent', 'absent_truth_rule', (state) => { state.presence = 'absent'; });
  await mutateAndReject('truth:contact', 'contact_truth_rule', (state) => { state.presence = 'unknown'; });
  await mutateAndReject('truth:hand', 'hand_truth_rule', (state) => { state.occlusion.leftHand = 'occluded'; });
  await mutateAndReject('truth:endpoint', 'endpoint_truth_rule', (state) => { state.occlusion.body = 'occluded'; });
  await mutateAndReject('truth:single-target', 'single_target_truth_rule', (state) => { state.subjectSelection = { state: 'ambiguous', manualTargetId: null, anchor: null }; });
  await mutateAndReject('truth:multiple-people', 'multiple_people_truth_rule', (state) => { state.personState = 'multiple_people'; });
  await mutateAndReject('truth:manual-target', 'manual_target_id_required', (state) => { state.subjectSelection.manualTargetId = ''; });
  await mutateAndReject('truth:subject-null', 'subject_null_fields_required', (state) => { state.subjectSelection.state = 'unknown'; });
  await mutateAndReject('truth:anchor-bounds', 'anchor_invalid', (state) => { state.subjectSelection.anchor = { x: -Number.EPSILON, y: 1 }; });
  row.manualState = clone(saved); row.manualState.subjectSelection.anchor = { x: 0, y: 1 }; core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' });
  row.manualState = clone(saved);
  const aliasSaved = clone(row.manualState); row.manualState.leftPalm = 'observable';
  await expectCode('truth:forbidden-alias', 'manual_state_not_closed', () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' })); row.manualState = aliasSaved;
  const duplicateIdentity = worksheetA.rows[1].sourceFrameIndex; worksheetA.rows[1].sourceFrameIndex = worksheetA.rows[0].sourceFrameIndex;
  await expectCode('worksheet:duplicate-identity', 'worksheet_identity_mismatch', () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' })); worksheetA.rows[1].sourceFrameIndex = duplicateIdentity;
  const removed = worksheetA.rows.pop(); await expectCode('worksheet:missing-row', 'worksheet_row_count', () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' })); worksheetA.rows.push(removed);
  const targetRow = worksheetA.rows.find((item) => item.clipId === 'shorts-new-dance-E9_h_ZW5z0U-16x9-padded' && item.sourceFrameIndex === 1); const targetSaved = targetRow.manualState.subjectSelection.manualTargetId; targetRow.manualState.subjectSelection.manualTargetId = 'unstable-target';
  await expectCode('truth:stable-target', 'manual_target_unstable', () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' })); targetRow.manualState.subjectSelection.manualTargetId = targetSaved;
  const overlay = { windowId: 'overlay-unset', clipId: 'arms-crossed', startFrameIndex: 0, endFrameIndexExclusive: 10, origin: 'actor_overlay', purposeTags: { status: 'UNSET' }, scenarioTags: { status: 'UNSET' } };
  worksheetA.windows.push(overlay); await expectCode('worksheet:overlay-unset', 'overlay_purpose_invalid', () => core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' })); worksheetA.windows.pop();

  const contactRows = (lastPts) => [
    { clipId: 'boundary', sourceFrameIndex: 0, ptsTicks: '0', timeBase: { numerator: 1, denominator: 1000 }, manualState: { contact: { left: 'planted', right: 'moving' }, occlusion: { leftFoot: 'observable', rightFoot: 'observable' } } },
    { clipId: 'boundary', sourceFrameIndex: 1, ptsTicks: `${lastPts}`, timeBase: { numerator: 1, denominator: 1000 }, manualState: { contact: { left: 'planted', right: 'moving' }, occlusion: { leftFoot: 'observable', rightFoot: 'observable' } } },
  ];
  core.assertContactConfirmation(contactRows(100));
  await expectCode('truth:contact-100ms-one-tick-low', 'contact_confirmation_short', () => core.assertContactConfirmation(contactRows(99)));

  const lowPublicState = { ...publicState, decoderRows: publicState.decoderRows.map((item) => clone(item)) };
  const start = lowPublicState.decoderRows.find((item) => item.clipId === 'arms-crossed' && item.sourceFrameIndex === 10);
  const boundary = lowPublicState.decoderRows.find((item) => item.clipId === 'arms-crossed' && item.sourceFrameIndex === 16);
  boundary.ptsTicks = `${BigInt(start.ptsTicks) + 3071n}`;
  const lowReview = core.worksheetToReview(completeWorksheet(lowPublicState, 'first', ACTOR_A), lowPublicState);
  const lowEvidence = core.reviewEvidence(lowReview, lowPublicState);
  assert.equal(lowEvidence.support.reacquireEvents.length, 2); assert.equal(lowEvidence.reacquirePass, false);

  assert.deepEqual(core.cohenKappa(['same', 'same'], ['same', 'same']), { count: 2, observedAgreement: 1, expectedAgreement: 1, kappa: 1 });
  assert.equal(core.cohenKappa(['a', 'a'], ['b', 'b']).kappa, 0);
  for (const [key, threshold] of Object.entries(FIXTURE.thresholds)) {
    assert.equal(threshold >= FIXTURE.thresholds[key], true); assert.equal((threshold - Number.EPSILON) >= FIXTURE.thresholds[key], false);
  }
  const coreSource = readFileSync(CORE, 'utf8'); assert.match(coreSource, /macros\[key\]\s*>=\s*thresholds\[key\]/u);

  evidence.counts.kappaCells = agreement.cells.presencePersonState.length + agreement.cells.contact.length + agreement.cells.observability.length;
  evidence.counts.reacquireExactBoundaryEvents = evidenceA.support.reacquireEvents.length;
  evidence.hashes.formalReviewACanonicalSha256 = reviewA.expectedCanonicalHash;
  evidence.hashes.formalReviewBCanonicalSha256 = reviewB.expectedCanonicalHash;
  return { initial, worksheetA, worksheetB, worksheetC0, reviewA, reviewB, agreement, evidenceA, evidenceB };
}

function makeDisagreementReviews(publicState) {
  const a = completeWorksheet(publicState, 'first', ACTOR_A); const b = completeWorksheet(publicState, 'second', ACTOR_B);
  replaceStateRange(b, 'csi-pose', 100, 110, (row) => { row.scenarios = ['fast_motion']; row.manualState.presence = 'unknown'; row.manualState.contact = { left: 'unknown', right: 'unknown' }; });
  replaceStateRange(b, 'csi-pose', 200, 210, (row) => { row.manualState.personState = 'multiple_people'; row.manualState.subjectSelection = { state: 'ambiguous', manualTargetId: null, anchor: null }; });
  replaceStateRange(b, 'csi-pose', 300, 310, (row) => { row.manualState.occlusion.body = 'partial'; row.manualState.occlusion.leftHand = 'partial'; });
  replaceStateRange(b, 'csi-pose', 400, 410, (row) => { row.manualState.handObservability.left = 'not_observable'; });
  replaceStateRange(b, 'csi-pose', 500, 510, (row) => { row.manualState.endpointObservability.head = 'not_observable'; });
  replaceStateRange(b, 'csi-pose', 600, 610, (row) => { row.manualState.contact = { left: 'moving', right: 'moving' }; });
  replaceStateRange(b, 'dance-16x9-padded', 0, 359, (row) => { row.manualState.subjectSelection.manualTargetId = 'target-dance-b'; });
  replaceStateRange(b, 'dance-16x9-padded', 100, 110, (row) => { row.manualState.subjectSelection.anchor = { x: 0, y: 1 }; });
  addOverlay(a, { windowId: 'only-a', clipId: 'arms-crossed', startFrameIndex: 50, endFrameIndexExclusive: 100, purposeTags: ['fast_motion'], scenarioTags: ['fast_motion'] });
  addOverlay(a, { windowId: 'shared', clipId: 'csi-pose', startFrameIndex: 700, endFrameIndexExclusive: 800, purposeTags: ['fast_motion'], scenarioTags: ['fast_motion'] });
  addOverlay(b, { windowId: 'shared', clipId: 'csi-pose', startFrameIndex: 701, endFrameIndexExclusive: 801, purposeTags: ['turning'], scenarioTags: ['turn'] });
  core.validateWorksheet(a, publicState, { requireComplete: true, expectedMode: 'first' });
  core.validateWorksheet(b, publicState, { requireComplete: true, expectedMode: 'second' });
  return { worksheetA: a, worksheetB: b, reviewA: core.worksheetToReview(a, publicState), reviewB: core.worksheetToReview(b, publicState) };
}

async function testDisagreementsAndDeviation(publicState, c0Worksheet) {
  const pair = makeDisagreementReviews(publicState); const disagreements = core.deriveDisagreements(pair.reviewA, pair.reviewB, publicState);
  assert.ok(disagreements.length > 14); assert.equal(new Set(disagreements.map((item) => item.path)).size, disagreements.length);
  assert.deepEqual([...new Set(disagreements.map((item) => item.valueType))].sort(rawCompare), [...FIXTURE.valueTypes].sort(rawCompare));
  assert.deepEqual(disagreements.map((item) => item.path), disagreements.map((item) => item.path).sort(rawCompare));
  assert.deepEqual([...new Set(disagreements.map((item) => item.coordinateKind))].sort(rawCompare), ['segment', 'window-child', 'window-parent']);
  for (const forbidden of ['/anchor/x', '/anchor/y', '/purposeTags/0', '/scenarios/0']) assert.ok(disagreements.every((item) => !item.path.endsWith(forbidden)), `forbidden disagreement path: ${forbidden}`);

  const binding = {
    cycleId: CYCLE, publicPins: clone(core.PUBLIC_PINS), sourceBinding: core.processSourceBinding(publicState), rulebookByteSha256: '5'.repeat(64),
    reviewAReceiptByteSha256: '6'.repeat(64), reviewBReceiptByteSha256: '7'.repeat(64), rawABReportByteSha256: '8'.repeat(64), c0LedgerByteSha256: '9'.repeat(64),
  };
  const skeleton = core.makeSkeleton(pair.reviewA, pair.reviewB, publicState, binding);
  assert.equal(skeleton.decisions.length, disagreements.length); assert.equal(skeleton.disagreements.length, disagreements.length);
  assert.ok(skeleton.decisions.every((decision) => stableStringify(decision.decision) === stableStringify({ status: 'UNSET' })));
  assert.ok(!stableStringify(skeleton).includes('C0_WINDOW_PRESENT'));
  assert.deepEqual(skeleton.decisions.map(({ path: itemPath, valueType }) => ({ path: itemPath, valueType })), skeleton.disagreements.map(({ path: itemPath, valueType }) => ({ path: itemPath, valueType })));

  const segment = disagreements.find((item) => item.coordinateKind === 'segment');
  const c0Rows = clone(c0Worksheet.rows); const c0Windows = core.normalizeWindows(c0Worksheet);
  const projection = core.projectC0(segment, c0Rows, c0Windows);
  assert.ok(projection.c0RowRuns.length >= 1); assert.equal(projection.c0RowRuns[0].startFrameIndex, segment.startFrameIndex); assert.equal(projection.c0RowRuns.at(-1).endFrameIndexExclusive, segment.endFrameIndexExclusive);
  await expectCode('deviation:path-type-mismatch', 'c0_projection_path_type_mismatch', () => core.projectC0({ ...segment, valueType: 'anchor' }, c0Rows, c0Windows));
  const windowParent = disagreements.find((item) => item.coordinateKind === 'window-parent');
  assert.deepEqual(core.projectC0(windowParent, c0Rows, c0Windows), { c0Projection: { status: 'C0_WINDOW_MISSING' } });
  const presentWindow = { windowId: windowParent.windowId, clipId: windowParent.clipId, startFrameIndex: 50, endFrameIndexExclusive: 100, purposeTags: ['fast_motion'], scenarioTags: ['fast_motion'] };
  assert.deepEqual(core.projectC0(windowParent, c0Rows, [...c0Windows, presentWindow]), { c0Projection: { status: 'C0_WINDOW_PRESENT', value: presentWindow } });

  const syntheticSegment = { path: '/clips/arms-crossed/segments/0-10/presence', coordinateKind: 'segment', valueType: 'presence', reviewAValue: 'present', reviewBValue: 'unknown', clipId: 'arms-crossed', startFrameIndex: 0, endFrameIndexExclusive: 10, leaf: 'presence' };
  const classSet = new Set();
  for (const klass of core.classifyDeviation(syntheticSegment, 'present', { c0RowRuns: [{ startFrameIndex: 0, endFrameIndexExclusive: 10, value: 'present' }] })) classSet.add(klass);
  for (const klass of core.classifyDeviation(syntheticSegment, 'unknown', { c0RowRuns: [{ startFrameIndex: 0, endFrameIndexExclusive: 10, value: 'present' }] })) classSet.add(klass);
  for (const klass of core.classifyDeviation(syntheticSegment, 'absent', { c0RowRuns: [{ startFrameIndex: 0, endFrameIndexExclusive: 5, value: 'absent' }, { startFrameIndex: 5, endFrameIndexExclusive: 10, value: 'present' }] })) classSet.add(klass);
  const syntheticWindow = { path: '/clips/arms-crossed/windowsById/w', coordinateKind: 'window-parent', valueType: 'window-or-null', reviewAValue: presentWindow, reviewBValue: null, clipId: 'arms-crossed', windowId: 'w' };
  for (const klass of core.classifyDeviation(syntheticWindow, null, { c0Projection: { status: 'C0_WINDOW_MISSING' } })) classSet.add(klass);
  for (const klass of core.classifyDeviation(syntheticWindow, presentWindow, { c0Projection: { status: 'C0_WINDOW_PRESENT', value: { ...presentWindow, endFrameIndexExclusive: 99 } } })) classSet.add(klass);
  for (const klass of core.classifyDeviation(syntheticWindow, presentWindow, { c0Projection: { status: 'C0_WINDOW_MISSING' } })) classSet.add(klass);

  const agreedC0Rows = clone(c0Rows); const changed = agreedC0Rows.find((row) => row.clipId === 'dance-16x9-padded' && row.sourceFrameIndex === 100); changed.scenarios = ['fast_motion'];
  const agreedA = core.worksheetToReview(completeWorksheet(publicState, 'first', ACTOR_A), publicState); const agreedB = core.worksheetToReview(completeWorksheet(publicState, 'second', ACTOR_B), publicState);
  const agreedRecords = core.deriveAgreedC0Deviations ? core.deriveAgreedC0Deviations(agreedA, agreedB, agreedC0Rows, c0Windows, publicState) : [];
  assert.ok(agreedRecords.some((record) => record.class === 'c0_differs_from_ab_agreement'));
  for (const record of agreedRecords) classSet.add(record.class);
  assert.deepEqual([...classSet].sort(rawCompare), [...FIXTURE.deviationClasses].sort(rawCompare));

  const decisions = disagreements.map((item) => ({ path: item.path, valueType: item.valueType, value: clone(item.reviewAValue) }));
  const derived = core.deriveDeviationCoordinates(pair.reviewA, pair.reviewB, c0Rows, c0Windows, decisions, publicState);
  assert.ok(derived.length >= disagreements.length * 2); assert.deepEqual(derived.map((record) => `${record.path}\0${record.coordinateKind}\0${record.class}`), derived.map((record) => `${record.path}\0${record.coordinateKind}\0${record.class}`).sort((left, right) => {
    const [leftPath, leftKind, leftClass] = left.split('\0'); const [rightPath, rightKind, rightClass] = right.split('\0');
    return rawCompare(leftPath, rightPath) || rawCompare(leftKind, rightKind) || FIXTURE.deviationClasses.indexOf(leftClass) - FIXTURE.deviationClasses.indexOf(rightClass);
  }));
  for (const klass of FIXTURE.deviationClasses) core.validateDisposition({ class: klass, disposition: FIXTURE.classDispositions[klass], rationale: `reviewed source for ${klass}` });
  await expectCode('deviation:cross-class-disposition', 'deviation_disposition_invalid', () => core.validateDisposition({ class: 'final_matches_a_only', disposition: 'accept_b_value', rationale: 'wrong class' }));
  await expectCode('deviation:empty-rationale', 'deviation_rationale_required', () => core.validateDisposition({ class: 'final_matches_a_only', disposition: 'accept_a_value', rationale: '  ' }));
  await expectCode('deviation:restart', 'restart_cycle_blocks', () => core.validateDisposition({ class: 'final_matches_a_only', disposition: 'restart_cycle', rationale: 'source conflict' }));
  await expectCode('deviation:missing-decision', 'deviation_decision_set_mismatch', () => core.deriveDeviationCoordinates(pair.reviewA, pair.reviewB, c0Rows, c0Windows, decisions.slice(1), publicState));
  await expectCode('deviation:duplicate-decision', 'deviation_decision_set_mismatch', () => core.deriveDeviationCoordinates(pair.reviewA, pair.reviewB, c0Rows, c0Windows, [...decisions, clone(decisions[0])], publicState));

  assert.equal(typeof core.replayAdjudicationJournal, 'function', 'shared adjudication reducer API missing');
  const revealReceiptByteSha256 = 'a'.repeat(64);
  const journal = processDocument('sam-goal-review-edit-journal-v1', { cycleId: CYCLE, mode: 'adjudication-reveal', actorPseudonymSha256: ACTOR_C0, bundleManifestByteSha256: 'b'.repeat(64), revealReceiptByteSha256, events: [] });
  const replay = (targetJournal, options = {}) => core.replayAdjudicationJournal({ journal: targetJournal, skeleton, reviewA: pair.reviewA, reviewB: pair.reviewB, c0Rows, c0Windows, publicState, expectedActorPseudonym: ACTOR_C0, expectedRevealReceiptByteSha256: revealReceiptByteSha256, ...options });
  const appendEvent = (event) => journal.events.push({ sequence: journal.events.length + 1, actorPseudonymSha256: ACTOR_C0, ...clone(event) });
  for (const disagreement of disagreements) appendEvent({
    action: 'set-decision', path: disagreement.path, valueType: disagreement.valueType, decision: clone(disagreement.reviewAValue),
  });
  for (const coordinate of derived) appendEvent({
    action: 'set-disposition', path: coordinate.path, coordinateKind: coordinate.coordinateKind, deviationClass: coordinate.class,
    disposition: FIXTURE.classDispositions[coordinate.class], rationale: `source-confirmed ${coordinate.class}`,
  });
  const fullyReplayed = replay(journal, { requireComplete: true });
  assert.equal(fullyReplayed.complete, true); assert.equal(fullyReplayed.decisions.length, disagreements.length); assert.equal(fullyReplayed.records.length, derived.length); assert.equal(fullyReplayed.final.rows.length, 6711);
  core.assertFinalReviewEvidence(fullyReplayed.final.rows, publicState);

  const resetDecision = disagreements.find((item) => item.coordinateKind === 'window-parent'); assert.ok(resetDecision, 'cross-coordinate reset requires a window-parent decision'); const resetPath = resetDecision.path;
  const changedDecisions = decisions.map((decision) => decision.path === resetPath ? { ...clone(decision), value: clone(resetDecision.reviewBValue) } : clone(decision));
  const changedDerived = core.deriveDeviationCoordinates(pair.reviewA, pair.reviewB, c0Rows, c0Windows, changedDecisions, publicState); assert.ok(changedDerived.some((coordinate) => coordinate.path !== resetPath));
  appendEvent({ action: 'set-decision', path: resetDecision.path, valueType: resetDecision.valueType, decision: clone(resetDecision.reviewBValue) });
  const afterReset = replay(journal);
  assert.equal(afterReset.decisionsComplete, true); assert.equal(afterReset.dispositionsComplete, false); assert.equal(afterReset.complete, false); assert.equal(afterReset.records.length, 0);
  assert.equal(afterReset.dispositionRecords.length, changedDerived.length); assert.ok(afterReset.dispositionRecords.some((record) => record.path !== resetPath));
  assert.ok(afterReset.dispositionRecords.every((record) => stableStringify(record.disposition) === stableStringify({ status: 'UNSET' }) && stableStringify(record.rationale) === stableStringify({ status: 'UNSET' })));
  await expectCode('adjudication:reset-removes-all-prior-dispositions', 'deviation_disposition_set_mismatch', () => replay(journal, { requireComplete: true }));
  for (const coordinate of changedDerived) appendEvent({
    action: 'set-disposition', path: coordinate.path, coordinateKind: coordinate.coordinateKind, deviationClass: coordinate.class,
    disposition: FIXTURE.classDispositions[coordinate.class], rationale: `source-reconfirmed ${coordinate.class}`,
  });
  const resealed = replay(journal, { requireComplete: true });
  assert.equal(resealed.records.length, changedDerived.length); assert.deepEqual(resealed.records.map(({ path: itemPath, coordinateKind, class: klass }) => ({ path: itemPath, coordinateKind, class: klass })), changedDerived.map(({ path: itemPath, coordinateKind, class: klass }) => ({ path: itemPath, coordinateKind, class: klass })));

  const earlyDisposition = clone(journal); earlyDisposition.events = [clone(journal.events.find((event) => event.action === 'set-disposition'))]; earlyDisposition.events[0].sequence = 1;
  await expectCode('adjudication:disposition-before-current-coordinate', 'deviation_disposition_coordinate_invalid', () => replay(earlyDisposition));
  const incomplete = clone(journal); incomplete.events = [clone(journal.events.find((event) => event.action === 'set-decision'))]; incomplete.events[0].sequence = 1;
  await expectCode('adjudication:incomplete-decisions', 'adjudication_decisions_incomplete', () => replay(incomplete, { requireComplete: true }));
  const forgedCoordinate = clone(journal); const dispositionIndex = forgedCoordinate.events.findIndex((event) => event.action === 'set-disposition'); const originalDisposition = forgedCoordinate.events[dispositionIndex];
  const actualClasses = new Set(derived.filter((coordinate) => coordinate.path === originalDisposition.path && coordinate.coordinateKind === originalDisposition.coordinateKind).map((coordinate) => coordinate.class));
  const forgedClass = FIXTURE.deviationClasses.find((klass) => !actualClasses.has(klass)); assert.ok(forgedClass, `all classes unexpectedly present at ${originalDisposition.path}`); forgedCoordinate.events[dispositionIndex].deviationClass = forgedClass;
  await expectCode('adjudication:forged-coordinate', 'deviation_disposition_coordinate_invalid', () => replay(forgedCoordinate));
  const wrongActor = clone(journal); wrongActor.events[0].actorPseudonymSha256 = ACTOR_A;
  await expectCode('adjudication:event-actor-mismatch', 'journal_actor_mismatch', () => replay(wrongActor));
  const wrongDecisionType = clone(journal); wrongDecisionType.events[0].valueType = wrongDecisionType.events[0].valueType === 'presence' ? 'person-state' : 'presence';
  await expectCode('adjudication:decision-type-mismatch', 'deviation_decision_set_mismatch', () => replay(wrongDecisionType));
  const forgedSkeleton = clone(skeleton); forgedSkeleton.decisions[0].valueType = forgedSkeleton.decisions[0].valueType === 'presence' ? 'person-state' : 'presence';
  await expectCode('adjudication:forged-skeleton', 'disagreement_skeleton_invalid', () => core.replayAdjudicationJournal({ journal, skeleton: forgedSkeleton, reviewA: pair.reviewA, reviewB: pair.reviewB, c0Rows, c0Windows, publicState, expectedActorPseudonym: ACTOR_C0, expectedRevealReceiptByteSha256: revealReceiptByteSha256 }));

  evidence.counts.disagreementCount = disagreements.length;
  evidence.counts.disagreementValueTypes = new Set(disagreements.map((item) => item.valueType)).size;
  evidence.counts.deviationClasses = classSet.size;
  evidence.counts.adjudicationReplayEvents = journal.events.length;
  evidence.counts.adjudicationReplayNegativeBranches = 7;
  evidence.hashes.adjudicationReplayCanonicalSha256 = core.canonicalHash({ decisions: resealed.decisions, records: resealed.records });
  evidence.hashes.disagreementPathTypeCanonicalSha256 = core.canonicalHash(disagreements.map(({ path: itemPath, valueType }) => ({ path: itemPath, valueType })));
  return { ...pair, disagreements, skeleton, derived };
}

function reverseContactWorksheet(publicState, mode, actor) {
  const worksheet = completeWorksheet(publicState, mode, actor);
  for (const row of worksheet.rows) {
    if (row.manualState.presence !== 'present') continue;
    row.manualState.contact.left = row.manualState.contact.left === 'planted' ? 'moving' : 'planted';
    row.manualState.contact.right = row.manualState.contact.right === 'planted' ? 'moving' : 'planted';
  }
  return worksheet;
}

async function testFinalEvidenceParityMutants(publicState) {
  let rawPasses = 0; let finalRejects = 0;
  const productionAvailable = typeof core.materializeAdjudicationFinalRows === 'function' && typeof core.assertFinalReviewEvidence === 'function';
  if (!productionAvailable && (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_TEST_PHASE ?? 'all') !== 'core') assert.fail('production final-row materializer/evidence API missing');
  const productionReject = async (name, worksheetA, worksheetB, targetWorksheet, code) => {
    if (!productionAvailable) return;
    const reviewA = core.worksheetToReview(worksheetA, publicState); const reviewB = core.worksheetToReview(worksheetB, publicState); const targetRows = new Map(targetWorksheet.rows.map((row) => [`${row.clipId}\0${row.sourceFrameIndex}`, row]));
    const disagreements = core.deriveDisagreements(reviewA, reviewB, publicState); const decisions = disagreements.map((item) => {
      assert.equal(item.coordinateKind, 'segment', `${name}: unexpected window disagreement`); const row = targetRows.get(`${item.clipId}\0${item.startFrameIndex}`); return { path: item.path, valueType: item.valueType, value: clone(core.getLeaf(row, item.leaf)) };
    });
    await expectCode(`final-production:${name}`, code, () => { const materialized = core.materializeAdjudicationFinalRows(reviewA, reviewB, decisions, publicState); const rows = Array.isArray(materialized) ? materialized : materialized.rows; return core.assertFinalReviewEvidence(rows, publicState); });
  };
  const assertRawPair = (worksheetA, worksheetB) => {
    core.validateWorksheet(worksheetA, publicState, { requireComplete: true, expectedMode: 'first' });
    core.validateWorksheet(worksheetB, publicState, { requireComplete: true, expectedMode: 'second' });
    assert.equal(core.reviewEvidence(core.worksheetToReview(worksheetA, publicState), publicState).gatePass, true);
    assert.equal(core.reviewEvidence(core.worksheetToReview(worksheetB, publicState), publicState).gatePass, true);
    rawPasses += 2;
  };

  const contactA = completeWorksheet(publicState, 'first', ACTOR_A); const contactB = completeWorksheet(publicState, 'second', ACTOR_B);
  replaceStateRange(contactA, 'shorts-keGbIts0CA0-16x9-padded', 790, 797, (row) => { row.manualState.contact = { left: 'planted', right: 'planted' }; });
  replaceStateRange(contactB, 'shorts-keGbIts0CA0-16x9-padded', 795, 802, (row) => { row.manualState.contact = { left: 'planted', right: 'planted' }; });
  assertRawPair(contactA, contactB);
  const contactFinal = completeWorksheet(publicState, 'first', ACTOR_A); replaceStateRange(contactFinal, 'shorts-keGbIts0CA0-16x9-padded', 795, 797, (row) => { row.manualState.contact = { left: 'planted', right: 'planted' }; });
  await expectCode('final-parity:contact-100ms-mosaic', 'contact_confirmation_short', () => core.validateWorksheet(contactFinal, publicState, { requireComplete: true, expectedMode: 'first' })); finalRejects += 1;
  await productionReject('contact-100ms-mosaic', contactA, contactB, contactFinal, 'contact_confirmation_short');

  const supportA = completeWorksheet(publicState, 'first', ACTOR_A); const supportB = reverseContactWorksheet(publicState, 'second', ACTOR_B); assertRawPair(supportA, supportB);
  const supportFinal = completeWorksheet(publicState, 'first', ACTOR_A); for (const row of supportFinal.rows) if (row.manualState.presence === 'present') row.manualState.contact = { left: 'moving', right: 'moving' };
  const supportReview = core.worksheetToReview(supportFinal, publicState); const supportEvidence = core.reviewEvidence(supportReview, publicState); assert.equal(supportEvidence.contactPass, false); assert.equal(supportEvidence.gatePass, false); finalRejects += 1;
  await productionReject('support-mosaic', supportA, supportB, supportFinal, 'final_support_gate_failed');

  const reacquireA = completeWorksheet(publicState, 'first', ACTOR_A); const reacquireB = completeWorksheet(publicState, 'second', ACTOR_B, { includeReacquire: false });
  for (const [clipId, runs] of Object.entries({ 'arms-crossed': [[100, 106], [140, 146]], 'csi-pose': [[100, 107]] })) for (const [start, end] of runs) replaceStateRange(reacquireB, clipId, start, end, (row) => { row.scenarios = ['entry_exit', 'reacquire']; row.manualState = absentState(); });
  assertRawPair(reacquireA, reacquireB);
  const reacquireFinal = completeWorksheet(publicState, 'first', ACTOR_A, { includeReacquire: false }); const reacquireEvidence = core.reviewEvidence(core.worksheetToReview(reacquireFinal, publicState), publicState); assert.equal(reacquireEvidence.reacquirePass, false); assert.equal(reacquireEvidence.gatePass, false); finalRejects += 1;
  await productionReject('reacquire-mosaic', reacquireA, reacquireB, reacquireFinal, 'final_reacquire_gate_failed');

  const targetA = completeWorksheet(publicState, 'first', ACTOR_A); const targetB = completeWorksheet(publicState, 'second', ACTOR_B);
  replaceStateRange(targetA, 'dance-16x9-padded', 0, 359, (row) => { row.manualState.subjectSelection.manualTargetId = 'stable-a'; });
  replaceStateRange(targetB, 'dance-16x9-padded', 0, 359, (row) => { row.manualState.subjectSelection.manualTargetId = 'stable-b'; if (row.sourceFrameIndex >= 180) row.scenarios = ['fast_motion']; });
  assertRawPair(targetA, targetB);
  const targetFinal = completeWorksheet(publicState, 'first', ACTOR_A); replaceStateRange(targetFinal, 'dance-16x9-padded', 0, 180, (row) => { row.manualState.subjectSelection.manualTargetId = 'stable-a'; }); replaceStateRange(targetFinal, 'dance-16x9-padded', 180, 359, (row) => { row.manualState.subjectSelection.manualTargetId = 'stable-b'; row.scenarios = ['fast_motion']; });
  await expectCode('final-parity:stable-target-mosaic', 'manual_target_unstable', () => core.validateWorksheet(targetFinal, publicState, { requireComplete: true, expectedMode: 'first' })); finalRejects += 1;
  await productionReject('stable-target-mosaic', targetA, targetB, targetFinal, 'manual_target_unstable');

  assert.equal(rawPasses, 8); assert.equal(finalRejects, 4);
  evidence.counts.finalParityRawReviewsPassed = rawPasses; evidence.counts.finalParityMutantsRejected = finalRejects;
  evidence.counts.finalParityProductionPaths = productionAvailable ? 4 : 0;
}

const VALUE_SAMPLE = Object.freeze({
  'scenario-array': ['neutral'], presence: 'present', 'person-state': 'single_target', 'occlusion-state': 'observable', 'contact-state': 'moving',
  'hand-observability-state': 'observable', 'endpoint-observability-state': 'observable', 'subject-state': 'selected', 'manual-target-id': 'target-manual',
  anchor: { x: 0, y: 1 }, 'window-or-null': null, 'source-frame-index': 0, 'source-frame-index-exclusive': 1, 'purpose-array': ['fast_motion'],
});
const VALUE_ALTERNATE = Object.freeze({
  'scenario-array': ['fast_motion'], presence: 'unknown', 'person-state': 'unknown', 'occlusion-state': 'partial', 'contact-state': 'unknown',
  'hand-observability-state': 'not_observable', 'endpoint-observability-state': 'not_observable', 'subject-state': 'unknown', 'manual-target-id': null,
  anchor: null, 'window-or-null': { windowId: 'typed-window', clipId: 'arms-crossed', startFrameIndex: 0, endFrameIndexExclusive: 1, purposeTags: ['fast_motion'], scenarioTags: ['neutral'] },
  'source-frame-index': 1, 'source-frame-index-exclusive': 2, 'purpose-array': ['turning'],
});

function typedDeviationRecord(valueType, index) {
  const windowChild = ['source-frame-index', 'source-frame-index-exclusive', 'purpose-array'].includes(valueType);
  const windowParent = valueType === 'window-or-null';
  const coordinateKind = windowParent ? 'window-parent' : windowChild ? 'window-child' : 'segment';
  const child = valueType === 'source-frame-index' ? 'startFrameIndex' : valueType === 'source-frame-index-exclusive' ? 'endFrameIndexExclusive' : valueType === 'purpose-array' ? 'purposeTags' : null;
  const leafByType = { 'scenario-array': 'scenarios', presence: 'presence', 'person-state': 'personState', 'occlusion-state': 'occlusion/body', 'contact-state': 'contact/left', 'hand-observability-state': 'handObservability/left', 'endpoint-observability-state': 'endpointObservability/head', 'subject-state': 'subjectSelection/state', 'manual-target-id': 'subjectSelection/manualTargetId', anchor: 'subjectSelection/anchor' };
  const pathValue = windowParent ? `/clips/arms-crossed/windowsById/typed-${index}` : windowChild ? `/clips/arms-crossed/windowsById/typed-${index}/${child}` : `/clips/arms-crossed/segments/0-1/${leafByType[valueType]}`;
  const base = {
    path: pathValue, coordinateKind, valueType, reviewAValue: clone(VALUE_SAMPLE[valueType]), reviewBValue: clone(VALUE_ALTERNATE[valueType]), finalValue: clone(VALUE_SAMPLE[valueType]),
    class: 'final_matches_a_only', disposition: 'accept_a_value', rationale: `typed ${valueType}`, clipId: 'arms-crossed',
  };
  if (coordinateKind === 'segment') return { ...base, startFrameIndex: 0, endFrameIndexExclusive: 1, c0RowRuns: [{ startFrameIndex: 0, endFrameIndexExclusive: 1, value: clone(VALUE_SAMPLE[valueType]) }] };
  return { ...base, windowId: `typed-${index}`, c0Projection: windowParent && VALUE_SAMPLE[valueType] === null ? { status: 'C0_WINDOW_MISSING' } : { status: 'C0_WINDOW_PRESENT', value: clone(VALUE_SAMPLE[valueType]) } };
}

async function testProcessSchemas(publicState, state) {
  const schemaNames = readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.schema.json')).sort(rawCompare);
  assert.deepEqual(schemaNames, [...FIXTURE.processSchemas].sort(rawCompare));
  const validator = createProcessSchemaValidator(SCHEMA_DIR, AUTHORING_SCHEMA);
  const documents = positiveSchemaDocuments(publicState, state.initial, state.worksheetC0, state.reviewA, state.reviewB, state.agreement, state.evidenceA, state.evidenceB);
  assert.deepEqual(Object.keys(documents).sort(rawCompare), schemaNames);
  for (const name of schemaNames) validator.validate(path.join(SCHEMA_DIR, name), documents[name]);
  const python = runPythonDraftMatrix(documents); assert.deepEqual(python, { authorityInjectionRejected: 10, positive: 10 });

  const lineageBound = Object.entries(documents).filter(([, document]) => Object.hasOwn(document, 'presentationContractSha256'));
  for (const [schemaName, document] of lineageBound) {
    core.validateProcessArtifact(document, publicState, document.artifactType, { expectedPresentationContractSha256: PRESENTATION_CONTRACT_SHA256 });
    const stale = clone(document); stale.presentationContractSha256 = ZERO_SHA; await expectCode(`presentation:stale:${schemaName}`, 'presentation_contract_mismatch', () => core.validateProcessArtifact(stale, publicState, stale.artifactType, { expectedPresentationContractSha256: PRESENTATION_CONTRACT_SHA256 }));
    const missing = clone(document); delete missing.presentationContractSha256; await expectCode(`presentation:missing:${schemaName}`, 'presentation_contract_mismatch', () => core.validateProcessArtifact(missing, publicState, missing.artifactType, { expectedPresentationContractSha256: PRESENTATION_CONTRACT_SHA256 }));
  }
  evidence.counts.presentationBoundProcessTypes = lineageBound.length;

  for (const name of schemaNames) {
    for (const authorityField of FIXTURE.forbiddenAuthorityFields) {
      const mutant = { ...clone(documents[name]), [authorityField]: ZERO_SHA };
      await expectCode(`schema:${name}:${authorityField}`, 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, name), mutant));
    }
    const marker = clone(documents[name]); marker.compilerInput = true;
    await expectCode(`schema:${name}:authority-marker`, 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, name), marker));
  }

  const worksheetSchema = path.join(SCHEMA_DIR, 'worksheet-v1.schema.json');
  validator.validate(worksheetSchema, state.initial); validator.validate(worksheetSchema, state.worksheetA);
  const aliasWorksheet = clone(state.initial); aliasWorksheet.rows[0].manualState.leftPalm = { status: 'UNSET' };
  await expectCode('schema:worksheet-forbidden-alias', 'process_schema_validation_failed', () => validator.validate(worksheetSchema, aliasWorksheet));
  const extraNested = clone(documents['access-evidence-v1.schema.json']); extraNested.actualOpenEvents[0].wallClock = 1;
  await expectCode('schema:nested-object-closure', 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), extraNested));

  const draftNegatives = [];
  for (const [schemaName, fields] of Object.entries(FIXTURE.sessionTreeContract.treeBoundArtifactFields)) for (const field of fields) {
    const missing = clone(documents[schemaName]); delete missing[field]; const name = `session-tree-field-required:${schemaName}:${field}`;
    await expectCode(`schema:${name}`, 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, schemaName), missing)); draftNegatives.push({ name, schema: schemaName, document: missing });
  }
  const accessSelfClaim = clone(documents['access-evidence-v1.schema.json']); accessSelfClaim.sessionTreeSha256 = '7'.repeat(64);
  await expectCode('schema:access-session-tree-self-claim', 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), accessSelfClaim)); draftNegatives.push({ name: 'access-session-tree-self-claim', schema: 'access-evidence-v1.schema.json', document: accessSelfClaim });
  const deviationSchema = path.join(SCHEMA_DIR, 'deviation-evidence-v1.schema.json');
  for (const [index, valueType] of FIXTURE.valueTypes.entries()) {
    const document = clone(documents['deviation-evidence-v1.schema.json']); document.records = [typedDeviationRecord(valueType, index)];
    validator.validate(deviationSchema, document);
    const mismatch = clone(document); mismatch.records[0].reviewAValue = valueType === 'source-frame-index' || valueType === 'source-frame-index-exclusive' ? 'wrong-integer' : 987654;
    await expectCode(`schema:typed-value-mismatch:${valueType}`, 'process_schema_validation_failed', () => validator.validate(deviationSchema, mismatch));
    draftNegatives.push({ name: `typed-value-mismatch:${valueType}`, schema: 'deviation-evidence-v1.schema.json', document: mismatch });
  }
  for (const [index, klass] of FIXTURE.deviationClasses.entries()) {
    const valid = clone(documents['deviation-evidence-v1.schema.json']); valid.records = [deviationRecord(klass, FIXTURE.classDispositions[klass], index)]; validator.validate(deviationSchema, valid);
    const invalid = clone(valid); invalid.records[0].disposition = klass === 'final_matches_a_only' ? 'accept_b_value' : 'accept_a_value';
    await expectCode(`schema:class-disposition:${klass}`, 'process_schema_validation_failed', () => validator.validate(deviationSchema, invalid));
    draftNegatives.push({ name: `class-disposition:${klass}`, schema: 'deviation-evidence-v1.schema.json', document: invalid });
  }
  const coordinateMix = clone(documents['deviation-evidence-v1.schema.json']); coordinateMix.records = [deviationRecord('final_matches_a_only', 'accept_a_value', 0)]; coordinateMix.records[0].c0Projection = { status: 'C0_WINDOW_MISSING' };
  await expectCode('schema:segment-window-projection-mix', 'process_schema_validation_failed', () => validator.validate(deviationSchema, coordinateMix));
  draftNegatives.push({ name: 'segment-window-projection-mix', schema: 'deviation-evidence-v1.schema.json', document: coordinateMix });

  const segmentAsWindow = clone(documents['deviation-evidence-v1.schema.json']); const segmentRecord = typedDeviationRecord('presence', 90); segmentRecord.coordinateKind = 'window-child'; segmentRecord.windowId = 'forged'; segmentRecord.c0Projection = { status: 'C0_WINDOW_PRESENT', value: 'present' }; delete segmentRecord.startFrameIndex; delete segmentRecord.endFrameIndexExclusive; delete segmentRecord.c0RowRuns; segmentAsWindow.records = [segmentRecord];
  await expectCode('schema:segment-path-forged-window-kind', 'process_schema_validation_failed', () => validator.validate(deviationSchema, segmentAsWindow)); await expectCode('semantic:segment-path-forged-window-kind', 'deviation_coordinate_value_invalid', () => core.validateProcessArtifact(segmentAsWindow, publicState, segmentAsWindow.artifactType)); draftNegatives.push({ name: 'segment-path-forged-window-kind', schema: 'deviation-evidence-v1.schema.json', document: segmentAsWindow });
  const windowScenario = { path: '/clips/arms-crossed/windowsById/w/scenarioTags', coordinateKind: 'window-child', valueType: 'scenario-array', reviewAValue: ['neutral'], reviewBValue: ['fast_motion'], finalValue: ['neutral'], class: 'final_matches_a_only', disposition: 'accept_a_value', rationale: 'window scenario', clipId: 'arms-crossed', windowId: 'w', c0Projection: { status: 'C0_WINDOW_PRESENT', value: ['neutral'] } };
  const windowAsSegment = clone(documents['deviation-evidence-v1.schema.json']); const forgedWindow = { ...windowScenario, coordinateKind: 'segment', startFrameIndex: 0, endFrameIndexExclusive: 1, c0RowRuns: [{ startFrameIndex: 0, endFrameIndexExclusive: 1, value: ['neutral'] }] }; delete forgedWindow.windowId; delete forgedWindow.c0Projection; windowAsSegment.records = [forgedWindow];
  await expectCode('schema:window-path-forged-segment-kind', 'process_schema_validation_failed', () => validator.validate(deviationSchema, windowAsSegment)); await expectCode('semantic:window-path-forged-segment-kind', 'deviation_coordinate_value_invalid', () => core.validateProcessArtifact(windowAsSegment, publicState, windowAsSegment.artifactType)); draftNegatives.push({ name: 'window-path-forged-segment-kind', schema: 'deviation-evidence-v1.schema.json', document: windowAsSegment });
  const parentWrongType = clone(documents['deviation-evidence-v1.schema.json']); const wrongParent = deviationRecord('window_final_matches_c0', 'confirm_window_c0_alignment', 91); wrongParent.valueType = 'presence'; wrongParent.reviewAValue = 'present'; wrongParent.reviewBValue = 'unknown'; wrongParent.finalValue = 'present'; wrongParent.c0Projection = { status: 'C0_WINDOW_PRESENT', value: 'present' }; parentWrongType.records = [wrongParent];
  await expectCode('schema:window-parent-non-window-type', 'process_schema_validation_failed', () => validator.validate(deviationSchema, parentWrongType)); await expectCode('semantic:window-parent-non-window-type', 'deviation_coordinate_value_invalid', () => core.validateProcessArtifact(parentWrongType, publicState, parentWrongType.artifactType)); draftNegatives.push({ name: 'window-parent-non-window-type', schema: 'deviation-evidence-v1.schema.json', document: parentWrongType });
  const coordinateClassMutants = [
    ['window-parent-segment-only-class', (() => { const record = deviationRecord('window_final_matches_c0', 'confirm_window_c0_alignment', 92); record.class = 'final_matches_c0_all_rows'; record.disposition = 'confirm_c0_alignment'; return record; })()],
    ['segment-window-only-class', (() => { const record = deviationRecord('final_matches_a_only', 'accept_a_value', 93); record.class = 'window_final_matches_c0'; record.disposition = 'confirm_window_c0_alignment'; return record; })()],
    ['window-child-agreed-only-class', { ...windowScenario, class: 'c0_differs_from_ab_agreement', disposition: 'confirm_ab_agreement_over_c0' }],
  ];
  for (const [name, record] of coordinateClassMutants) {
    const mutant = clone(documents['deviation-evidence-v1.schema.json']); mutant.records = [record];
    await expectCode(`schema:coordinate-class:${name}`, 'process_schema_validation_failed', () => validator.validate(deviationSchema, mutant));
    await expectCode(`semantic:coordinate-class:${name}`, 'deviation_coordinate_class_invalid', () => core.validateProcessArtifact(mutant, publicState, mutant.artifactType));
    draftNegatives.push({ name: `coordinate-class:${name}`, schema: 'deviation-evidence-v1.schema.json', document: mutant });
  }

  const journalSchema = path.join(SCHEMA_DIR, 'edit-journal-v1.schema.json'); const lockedIdentity = exactIdentity(publicState.decoderRows[0]);
  const validEvent = { sequence: 1, action: 'set', actorPseudonymSha256: ACTOR_A, clipId: lockedIdentity.clipId, startFrameIndex: 0, endFrameIndexExclusive: 1, fieldPath: 'presence', valueType: 'presence', value: 'present', lockedIdentity };
  const eventDocument = clone(documents['edit-journal-v1.schema.json']); eventDocument.events = [validEvent]; validator.validate(journalSchema, eventDocument);
  const journalMutants = [
    ['evil-field-path', { fieldPath: '/evil' }],
    ['contact-wrong-value-type', { fieldPath: 'contact/left', valueType: 'presence', value: 'present' }],
    ['window-scenario-purpose-value', { fieldPath: '/windowsById/overlay/scenarioTags', valueType: 'purpose-array', value: ['fast_motion'] }],
    ['base-purpose-mutation', { fieldPath: '/windowsById/base-arms-crossed/purposeTags', valueType: 'purpose-array', value: ['full_clip_denominator'] }],
  ];
  for (const [name, mutation] of journalMutants) {
    const mutant = clone(eventDocument); Object.assign(mutant.events[0], mutation); await expectCode(`schema:journal:${name}`, 'process_schema_validation_failed', () => validator.validate(journalSchema, mutant)); draftNegatives.push({ name: `journal:${name}`, schema: 'edit-journal-v1.schema.json', document: mutant });
  }
  const revealJournal = processDocument('sam-goal-review-edit-journal-v1', {
    cycleId: CYCLE, mode: 'adjudication-reveal', actorPseudonymSha256: ACTOR_C0, bundleManifestByteSha256: '6'.repeat(64), revealReceiptByteSha256: '7'.repeat(64),
    events: [
      { sequence: 1, action: 'set-decision', actorPseudonymSha256: ACTOR_C0, path: '/clips/arms-crossed/segments/0-1/presence', valueType: 'presence', decision: 'present' },
      { sequence: 2, action: 'set-disposition', actorPseudonymSha256: ACTOR_C0, path: '/clips/arms-crossed/segments/0-1/presence', coordinateKind: 'segment', deviationClass: 'final_matches_a_only', disposition: 'accept_a_value', rationale: 'source confirms A' },
      { sequence: 3, action: 'set-decision', actorPseudonymSha256: ACTOR_C0, path: '/clips/arms-crossed/segments/0-1/presence', valueType: 'presence', decision: { status: 'UNSET' } },
      { sequence: 4, action: 'set-disposition', actorPseudonymSha256: ACTOR_C0, path: '/clips/arms-crossed/segments/0-1/presence', coordinateKind: 'segment', deviationClass: 'final_matches_a_only', disposition: { status: 'UNSET' }, rationale: { status: 'UNSET' } },
    ],
  });
  validator.validate(journalSchema, revealJournal);
  const missingRevealReceipt = clone(revealJournal); delete missingRevealReceipt.revealReceiptByteSha256;
  await expectCode('schema:reveal-journal-receipt-required', 'process_schema_validation_failed', () => validator.validate(journalSchema, missingRevealReceipt)); draftNegatives.push({ name: 'reveal-journal-receipt-required', schema: 'edit-journal-v1.schema.json', document: missingRevealReceipt });
  const blindRevealReceipt = clone(eventDocument); blindRevealReceipt.revealReceiptByteSha256 = '7'.repeat(64);
  await expectCode('schema:blind-journal-receipt-forbidden', 'process_schema_validation_failed', () => validator.validate(journalSchema, blindRevealReceipt)); draftNegatives.push({ name: 'blind-journal-receipt-forbidden', schema: 'edit-journal-v1.schema.json', document: blindRevealReceipt });
  const legacyDecision = clone(revealJournal); legacyDecision.events[0].value = legacyDecision.events[0].decision; delete legacyDecision.events[0].decision; legacyDecision.events[0].lockedIdentity = lockedIdentity;
  await expectCode('schema:reveal-journal-legacy-decision-shape', 'process_schema_validation_failed', () => validator.validate(journalSchema, legacyDecision)); draftNegatives.push({ name: 'reveal-journal-legacy-decision-shape', schema: 'edit-journal-v1.schema.json', document: legacyDecision });
  const legacyDisposition = clone(revealJournal); legacyDisposition.events[1].class = legacyDisposition.events[1].deviationClass; delete legacyDisposition.events[1].deviationClass; legacyDisposition.events[1].lockedIdentity = lockedIdentity;
  await expectCode('schema:reveal-journal-legacy-disposition-shape', 'process_schema_validation_failed', () => validator.validate(journalSchema, legacyDisposition)); draftNegatives.push({ name: 'reveal-journal-legacy-disposition-shape', schema: 'edit-journal-v1.schema.json', document: legacyDisposition });
  const halfUnsetDisposition = clone(revealJournal); halfUnsetDisposition.events[1].disposition = { status: 'UNSET' };
  await expectCode('schema:reveal-journal-half-unset-disposition', 'process_schema_validation_failed', () => validator.validate(journalSchema, halfUnsetDisposition)); draftNegatives.push({ name: 'reveal-journal-half-unset-disposition', schema: 'edit-journal-v1.schema.json', document: halfUnsetDisposition });

  const zeroAsset = clone(documents['bundle-manifest-v1.schema.json']); zeroAsset.immutableAssets[0].bytes = 0;
  await expectCode('schema:bundle-zero-byte-asset', 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, 'bundle-manifest-v1.schema.json'), zeroAsset)); draftNegatives.push({ name: 'bundle-zero-byte-asset', schema: 'bundle-manifest-v1.schema.json', document: zeroAsset });
  const extraCell = clone(documents['raw-ab-report-v1.schema.json']); extraCell.agreementCells.push(clone(extraCell.agreementCells[0]));
  await expectCode('schema:raw-extra-agreement-cell', 'process_schema_validation_failed', () => validator.validate(path.join(SCHEMA_DIR, 'raw-ab-report-v1.schema.json'), extraCell)); draftNegatives.push({ name: 'raw-extra-agreement-cell', schema: 'raw-ab-report-v1.schema.json', document: extraCell });
  await expectCode('semantic:raw-extra-agreement-cell', 'raw_ab_report_invalid', () => core.validateProcessArtifact(extraCell, publicState, extraCell.artifactType));

  const pythonNegatives = runPythonDraftNegatives(draftNegatives); assert.equal(pythonNegatives.rejected.length, draftNegatives.length);

  await expectCode('json:duplicate-key', 'duplicate_json_key', () => core.parseJsonBuffer(Buffer.from('{"x":1,"x":2}\n')));
  await expectCode('json:non-finite', 'non_finite_number', () => core.parseJsonBuffer(Buffer.from('{"x":1e400}\n')));
  await expectCode('json:bom', 'utf8_bom_forbidden', () => core.parseJsonBuffer(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{}\n')]), { processArtifact: true }));
  await expectCode('json:invalid-utf8', 'invalid_utf8', () => core.parseJsonBuffer(Buffer.from([0xff, 0x0a]), { processArtifact: true }));
  await expectCode('json:missing-terminal-lf', 'terminal_lf_required', () => core.parseJsonBuffer(Buffer.from('{}'), { processArtifact: true }));
  await expectCode('json:double-terminal-lf', 'terminal_lf_required', () => core.parseJsonBuffer(Buffer.from('{}\n\n'), { processArtifact: true }));
  for (const document of Object.values(documents)) {
    const bytes = core.processBytes(document); assert.equal(bytes.at(-1), 0x0a); assert.notEqual(bytes.at(-2), 0x0a); assert.equal(stableStringify(core.parseJsonBuffer(bytes, { processArtifact: true })), stableStringify(document));
  }

  for (const [name, document] of Object.entries(documents)) {
    if (name !== 'bundle-manifest-v1.schema.json') core.validateProcessArtifact(document, publicState, document.artifactType);
  }
  const semanticManifest = documents['bundle-manifest-v1.schema.json']; validator.validate(path.join(SCHEMA_DIR, 'bundle-manifest-v1.schema.json'), semanticManifest); core.validateProcessArtifact(semanticManifest, publicState, semanticManifest.artifactType);
  const receipt = documents['review-export-receipt-v1.schema.json']; const stdout = Buffer.from(receipt.validatorStdoutBase64, 'base64'); assert.equal(sha256(stdout), receipt.validatorStdoutByteSha256);
  for (const payload of [Buffer.alloc(0), Buffer.from('{not-json}\n'), Buffer.from([0, 1, 2, 255])]) {
    const variant = clone(receipt); variant.validatorStdoutBase64 = payload.toString('base64'); variant.validatorStdoutByteSha256 = sha256(payload); validator.validate(path.join(SCHEMA_DIR, 'review-export-receipt-v1.schema.json'), variant); core.validateProcessArtifact(variant, publicState, variant.artifactType);
  }

  const consumerMutants = [];
  const rawBase = documents['raw-ab-report-v1.schema.json'];
  const rawDuplicateCell = clone(rawBase); rawDuplicateCell.agreementCells[104] = clone(rawDuplicateCell.agreementCells[0]); consumerMutants.push(['raw-duplicate-cell', rawDuplicateCell]);
  const rawDuplicateRoles = clone(rawBase); rawDuplicateRoles.individualGateEvidence[1].role = 'first'; rawDuplicateRoles.supportReacquireEvidence[1].role = 'first'; consumerMutants.push(['raw-duplicate-roles', rawDuplicateRoles]);
  const rawContactNull = clone(rawBase); rawContactNull.agreementCells.find((cell) => cell.family === 'contact').field = null; consumerMutants.push(['raw-contact-null-field', rawContactNull]);
  const rawReacquireBounds = clone(rawBase); const reacquire = rawReacquireBounds.supportReacquireEvidence[0].reacquireEvents[0]; reacquire.endFrameIndexExclusive = reacquire.startFrameIndex; consumerMutants.push(['raw-invalid-reacquire-bounds', rawReacquireBounds]);
  const rawSupportContradiction = clone(rawBase); rawSupportContradiction.supportReacquireEvidence[0].gatePass = false; consumerMutants.push(['raw-support-gate-contradiction', rawSupportContradiction]);
  const rawMacroContradiction = clone(rawBase); rawMacroContradiction.agreementMacros.contactKappa = FIXTURE.thresholds.contactKappa - Number.EPSILON; rawMacroContradiction.gatePass = true; consumerMutants.push(['raw-macro-gate-contradiction', rawMacroContradiction]);
  for (const [name, document] of consumerMutants) await expectCode(`semantic:${name}`, 'raw_ab_report_invalid', () => core.validateProcessArtifact(document, publicState, document.artifactType));

  const badReceipt = clone(receipt); badReceipt.validatorStdoutBase64 = Buffer.from('different').toString('base64'); await expectCode('semantic:receipt-stdout-hash-mismatch', 'validator_stdout_binding_invalid', () => core.validateProcessArtifact(badReceipt, publicState, badReceipt.artifactType));
  const blindFixedSelfClaim = clone(documents['access-evidence-v1.schema.json']); blindFixedSelfClaim.fixedInputSetSha256 = '6'.repeat(64); await expectCode('semantic:blind-fixed-set-not-empty', 'access_evidence_invalid', () => core.validateProcessArtifact(blindFixedSelfClaim, publicState, blindFixedSelfClaim.artifactType));
  const c0Duplicate = clone(documents['c0-ledger-v1.schema.json']); c0Duplicate.rows[1] = clone(c0Duplicate.rows[0]); await expectCode('semantic:c0-duplicate-identity', 'worksheet_identity_mismatch', () => core.validateProcessArtifact(c0Duplicate, publicState, c0Duplicate.artifactType));
  const c0NoBases = clone(documents['c0-ledger-v1.schema.json']); c0NoBases.windows = []; await expectCode('semantic:c0-no-base-windows', 'base_window_count', () => core.validateProcessArtifact(c0NoBases, publicState, c0NoBases.artifactType));
  const manifestDuplicate = clone(semanticManifest); manifestDuplicate.immutableAssets.push(clone(manifestDuplicate.immutableAssets[0])); manifestDuplicate.immutableAssets.sort((left, right) => rawCompare(left.logicalPath, right.logicalPath)); manifestDuplicate.immutableAssetSetSha256 = core.canonicalHash(manifestDuplicate.immutableAssets); await expectCode('semantic:manifest-duplicate-logical-path', 'immutable_asset_set_invalid', () => core.validateProcessArtifact(manifestDuplicate, publicState, manifestDuplicate.artifactType));
  const manifestOverlap = clone(semanticManifest); manifestOverlap.mutableLogicalRoots = ['immutable']; await expectCode('semantic:manifest-mutable-overlap', 'bundle_manifest_runtime_or_mutable_invalid', () => core.validateProcessArtifact(manifestOverlap, publicState, manifestOverlap.artifactType));
  const deviationBase = documents['deviation-evidence-v1.schema.json']; const segmentBase = deviationRecord('final_matches_a_only', 'accept_a_value', 0);
  const noncovering = clone(deviationBase); noncovering.records = [{ ...clone(segmentBase), c0RowRuns: [{ ...clone(segmentBase.c0RowRuns[0]), startFrameIndex: segmentBase.startFrameIndex + 1 }] }]; await expectCode('semantic:deviation-noncovering-runs', 'deviation_c0_runs_invalid', () => core.validateProcessArtifact(noncovering, publicState, noncovering.artifactType));
  const nonmaximal = clone(deviationBase); const midpoint = Math.floor((segmentBase.startFrameIndex + segmentBase.endFrameIndexExclusive) / 2); nonmaximal.records = [{ ...clone(segmentBase), c0RowRuns: [{ startFrameIndex: segmentBase.startFrameIndex, endFrameIndexExclusive: midpoint, value: clone(segmentBase.c0RowRuns[0].value) }, { startFrameIndex: midpoint, endFrameIndexExclusive: segmentBase.endFrameIndexExclusive, value: clone(segmentBase.c0RowRuns[0].value) }] }]; await expectCode('semantic:deviation-nonmaximal-runs', 'deviation_c0_runs_invalid', () => core.validateProcessArtifact(nonmaximal, publicState, nonmaximal.artifactType));
  const classContradiction = clone(deviationBase); const contradiction = clone(segmentBase); contradiction.class = 'final_matches_a_only'; contradiction.disposition = 'accept_a_value'; contradiction.finalValue = clone(contradiction.reviewBValue); classContradiction.records = [contradiction]; await expectCode('semantic:deviation-class-contradiction', 'deviation_classification_invalid', () => core.validateProcessArtifact(classContradiction, publicState, classContradiction.artifactType));

  evidence.counts.draftSchemas = schemaNames.length; evidence.counts.draftPositiveDocuments = python.positive;
  evidence.counts.draftAuthorityInjectionRejections = python.authorityInjectionRejected;
  evidence.counts.draftTargetedNegativeBranches = draftNegatives.length;
  evidence.counts.typedValueBranches = FIXTURE.valueTypes.length; evidence.counts.classDispositionBranches = FIXTURE.deviationClasses.length;
  evidence.counts.consumerSemanticNegativeBranches = consumerMutants.length + 10;
  evidence.hashes.schemaSetCanonicalSha256 = core.canonicalHash(schemaNames.map((name) => ({ name, byteSha256: sha256(readFileSync(path.join(SCHEMA_DIR, name))) })));
  return documents;
}

async function atomicChildMain(kind, destination) {
  try {
    let result;
    if (kind === 'single-file') result = await core.commitSingleFile(destination, Buffer.from('atomic-child-single\n'));
    else if (kind === 'directory') result = await core.commitDirectoryTransaction(destination, ['a.json', 'b.json'], async (stage) => {
      const a = Buffer.from('{"a":1}\n'); const b = Buffer.from('{"b":2}\n');
      await core.writeExclusiveFile(path.join(stage, 'a.json'), a, 0o400); await core.writeExclusiveFile(path.join(stage, 'b.json'), b, 0o400);
      return { memberBytes: { 'a.json': a, 'b.json': b }, memberModes: { 'a.json': 0o400, 'b.json': 0o400 } };
    }); else throw Object.assign(new Error('atomic_child_kind_invalid'), { code: 'atomic_child_kind_invalid' });
    process.stdout.write(`${JSON.stringify({ status: 'atomic_child_result', result })}\n`);
    if (result.signalExitCode) process.exitCode = result.signalExitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: 'atomic_child_failed', code: exactCode(error), details: error.details ?? null })}\n`);
    process.exitCode = error.details?.exitCode ?? process.exitCode ?? 1;
  }
}

async function waitForPath(filePath, child, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (pathExists(filePath)) return;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`child exited before barrier: ${child.exitCode}/${child.signalCode}`);
    if (Date.now() >= deadline) throw new Error(`barrier timeout: ${filePath}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForCanonicalBarrier(filePath, child, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs; const expected = stableStringify({ status: 'coordinator_final_barrier' });
  for (;;) {
    try {
      const bytes = readFileSync(filePath); if (bytes.length > 0 && bytes.at(-1) === 0x0a) { const document = core.parseJsonBuffer(bytes, { processArtifact: true }); assert.equal(stableStringify(document), expected, `wrong complete barrier document: ${bytes.toString('utf8')}`); return document; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`child exited before canonical barrier: ${child.exitCode}/${child.signalCode}`); if (Date.now() >= deadline) throw new Error(`canonical barrier timeout: ${filePath}`); await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function spawnAtomicBarrier({ kind, destination, phase, action }) {
  const marker = `${destination}.mro-test-${kind}-${phase}-barrier`; const release = `${destination}.mro-test-${kind}-${phase}-release`;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--atomic-child', kind, destination], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_BARRIER: '1', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_PHASE: phase },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = []; const stderr = []; child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
  await waitForPath(marker, child); await action(child, marker, release); if (!pathExists(release)) writeFileSync(release, 'release\n', { mode: 0o600 });
  const termination = await new Promise((resolve) => child.once('exit', (status, signal) => resolve({ status, signal })));
  for (const control of [marker, release]) try { unlinkSync(control); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...termination, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
}

async function testSealedOutputsAndAtomicity() {
  const atomicRoot = path.join(tempRoot, 'atomic'); mkdirSync(atomicRoot, { mode: 0o700 });
  const single = path.join(atomicRoot, 'single.json'); const singleBytes = Buffer.from('{"sealed":true}\n');
  const singleResult = await core.commitSingleFile(single, singleBytes); assert.equal(singleResult.status, 'committed'); assert.equal(permissionBits(single), 0o600); assert.equal(lstatSync(single).nlink, 1); assert.equal(sha256(readFileSync(single)), sha256(singleBytes));
  await expectCode('atomic:single-existing', 'output_exists', () => core.commitSingleFile(single, Buffer.from('replacement'))); assert.equal(sha256(readFileSync(single)), sha256(singleBytes));

  const directory = path.join(atomicRoot, 'pair'); const reviewBytes = Buffer.from('{"review":true}\n'); const receiptBytes = Buffer.from('{"receipt":true}\n');
  const directoryResult = await core.commitDirectoryTransaction(directory, ['review.json', 'review-export-receipt.json'], async (stage) => {
    await core.writeExclusiveFile(path.join(stage, 'review.json'), reviewBytes, 0o400); await core.writeExclusiveFile(path.join(stage, 'review-export-receipt.json'), receiptBytes, 0o400);
    return { memberBytes: { 'review.json': reviewBytes, 'review-export-receipt.json': receiptBytes }, memberModes: { 'review.json': 0o400, 'review-export-receipt.json': 0o400 } };
  });
  assert.equal(directoryResult.status, 'committed'); assert.equal(permissionBits(directory), 0o700); assert.deepEqual(readdirSync(directory).sort(rawCompare), ['review-export-receipt.json', 'review.json']);
  const proof = core.proveDirectorySync(directory, ['review.json', 'review-export-receipt.json'], { 'review.json': sha256(reviewBytes), 'review-export-receipt.json': sha256(receiptBytes) }, { expectedDirectoryMode: 0o700, expectedMemberModes: { 'review.json': 0o400, 'review-export-receipt.json': 0o400 } }); closeProof(proof);

  const wrongType = path.join(atomicRoot, 'wrong-type'); writeFileSync(wrongType, 'file\n', { mode: 0o600 });
  await expectCode('atomic:directory-as-file', 'sealed_directory_type_invalid', () => core.proveDirectorySync(wrongType, ['a', 'b']));
  const extra = path.join(atomicRoot, 'extra'); mkdirSync(extra, { mode: 0o700 }); writeFileSync(path.join(extra, 'a'), 'a', { mode: 0o400 }); writeFileSync(path.join(extra, 'b'), 'b', { mode: 0o400 }); writeFileSync(path.join(extra, 'c'), 'c', { mode: 0o400 });
  await expectCode('atomic:extra-member', 'sealed_directory_members_invalid', () => core.proveDirectorySync(extra, ['a', 'b']));
  const missing = path.join(atomicRoot, 'missing'); mkdirSync(missing, { mode: 0o700 }); writeFileSync(path.join(missing, 'a'), 'a', { mode: 0o400 });
  await expectCode('atomic:missing-member', 'sealed_directory_members_invalid', () => core.proveDirectorySync(missing, ['a', 'b']));
  const subdir = path.join(atomicRoot, 'subdir'); mkdirSync(subdir, { mode: 0o700 }); mkdirSync(path.join(subdir, 'a'), { mode: 0o700 }); writeFileSync(path.join(subdir, 'b'), 'b', { mode: 0o400 });
  await expectCode('atomic:member-subdirectory', 'sealed_file_type_invalid', () => core.proveDirectorySync(subdir, ['a', 'b']));
  const symlink = path.join(atomicRoot, 'symlink'); mkdirSync(symlink, { mode: 0o700 }); writeFileSync(path.join(atomicRoot, 'symlink-target'), 'a', { mode: 0o400 }); symlinkSync('../symlink-target', path.join(symlink, 'a')); writeFileSync(path.join(symlink, 'b'), 'b', { mode: 0o400 });
  await expectCode('atomic:member-symlink', 'ELOOP', () => core.proveDirectorySync(symlink, ['a', 'b']));
  const hardlink = path.join(atomicRoot, 'hardlink'); mkdirSync(hardlink, { mode: 0o700 }); writeFileSync(path.join(hardlink, 'a'), 'a', { mode: 0o400 }); linkSync(path.join(hardlink, 'a'), path.join(atomicRoot, 'external-hardlink')); writeFileSync(path.join(hardlink, 'b'), 'b', { mode: 0o400 });
  await expectCode('atomic:member-hardlink', 'sealed_file_type_invalid', () => core.proveDirectorySync(hardlink, ['a', 'b']));
  const wrongMode = path.join(atomicRoot, 'wrong-mode'); mkdirSync(wrongMode, { mode: 0o700 }); writeFileSync(path.join(wrongMode, 'a'), 'a', { mode: 0o600 }); writeFileSync(path.join(wrongMode, 'b'), 'b', { mode: 0o400 });
  await expectCode('atomic:member-mode', 'sealed_file_mode_invalid', () => core.proveDirectorySync(wrongMode, ['a', 'b'], {}, { expectedDirectoryMode: 0o700, expectedMemberModes: { a: 0o400, b: 0o400 } }));
  const wrongHash = path.join(atomicRoot, 'wrong-hash'); mkdirSync(wrongHash, { mode: 0o700 }); writeFileSync(path.join(wrongHash, 'a'), 'a', { mode: 0o400 }); writeFileSync(path.join(wrongHash, 'b'), 'b', { mode: 0o400 });
  await expectCode('atomic:member-hash', 'expected_hash_mismatch', () => core.proveDirectorySync(wrongHash, ['a', 'b'], { a: ZERO_SHA }));

  const heldPath = path.join(atomicRoot, 'held'); writeFileSync(heldPath, 'held\n', { mode: 0o600 }); const held = core.snapshotPathSync(heldPath, { expectedMode: 0o600 });
  await expectCode('atomic:path-alias', 'sealed_path_alias', () => core.assertDistinctSnapshots([held, held]));
  writeFileSync(heldPath, 'mold\n'); await expectCode('atomic:held-buffer-mutation', 'snapshot_identity_drift', () => core.revalidateSnapshotSync(held)); closeSnapshot(held);
  const heldSizePath = path.join(atomicRoot, 'held-size'); writeFileSync(heldSizePath, 'held\n', { mode: 0o600 }); const heldSize = core.snapshotPathSync(heldSizePath, { expectedMode: 0o600 }); writeFileSync(heldSizePath, 'mutated\n'); await expectCode('atomic:held-size-mutation', 'snapshot_size_drift', () => core.revalidateSnapshotSync(heldSize)); closeSnapshot(heldSize);
  const snapshotSymlinkTarget = path.join(atomicRoot, 'snapshot-target'); const snapshotSymlink = path.join(atomicRoot, 'snapshot-link'); writeFileSync(snapshotSymlinkTarget, 'x', { mode: 0o600 }); symlinkSync('snapshot-target', snapshotSymlink);
  await expectCode('atomic:snapshot-symlink', 'ELOOP', () => core.snapshotPathSync(snapshotSymlink));
  const snapshotHard = path.join(atomicRoot, 'snapshot-hard'); linkSync(snapshotSymlinkTarget, snapshotHard);
  await expectCode('atomic:snapshot-hardlink', 'sealed_file_type_invalid', () => core.snapshotPathSync(snapshotSymlinkTarget));

  const raceDestination = path.join(atomicRoot, 'race-destination');
  const race = await spawnAtomicBarrier({ kind: 'single-file', destination: raceDestination, phase: 'during', action: async (_child, _marker, release) => { writeFileSync(raceDestination, 'competitor\n', { mode: 0o600 }); writeFileSync(release, 'release\n', { mode: 0o600 }); } });
  assert.notEqual(race.status, 0); assert.equal(readFileSync(raceDestination, 'utf8'), 'competitor\n'); assert.match(race.stderr, /output_exists/u);
  const preSignalDestination = path.join(atomicRoot, 'pre-signal');
  const preSignal = await spawnAtomicBarrier({ kind: 'single-file', destination: preSignalDestination, phase: 'pre', action: async (child, _marker, release) => { child.kill('SIGINT'); writeFileSync(release, 'release\n', { mode: 0o600 }); } });
  assert.equal(preSignal.status, 130); assert.equal(pathExists(preSignalDestination), false);
  const postPonrDestination = path.join(atomicRoot, 'post-ponr-signal');
  const postPonr = await spawnAtomicBarrier({ kind: 'directory', destination: postPonrDestination, phase: 'post-ponr', action: async (child, _marker, release) => { child.kill('SIGTERM'); writeFileSync(release, 'release\n', { mode: 0o600 }); } });
  assert.equal(postPonr.status, 143); assert.equal(pathExists(postPonrDestination), true); assert.deepEqual(readdirSync(postPonrDestination).sort(rawCompare), ['a.json', 'b.json']);

  assertNoTransactionResidue(atomicRoot);
  evidence.counts.atomicCommits = 3; evidence.counts.atomicAttackRejections = 12; evidence.counts.atomicSignalCases = 2; evidence.counts.atomicRaceCases = 1;
  evidence.hashes.atomicPairMembersCanonicalSha256 = core.canonicalHash(directoryResult.memberSha256);
}

async function testCoordinatorOpenatHelper() {
  const contract = FIXTURE.openatContract; assert.ok(contract, 'openat fixture contract missing'); const sourcePath = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/coordinator-openat.c'); const nodePath = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/coordinator-openat.node'); const builderPath = path.join(ROOT, 'tools/sam-goal-manual-review-viewer-v1/build-coordinator-openat.mjs');
  assert.equal(sha256(readFileSync(sourcePath)), contract.sourceByteSha256); assert.equal(sha256(readFileSync(nodePath)), contract.nodeByteSha256); assert.equal(sha256(readFileSync(builderPath)), contract.builderByteSha256);
  const addon = require(nodePath); assert.deepEqual(Object.keys(addon), ['openatReadOnly']); assert.equal(typeof addon.openatReadOnly, 'function');
  const root = path.join(tempRoot, 'coordinator-openat'); const heldDirectory = path.join(root, 'held'); mkdirSync(root, { mode: 0o700 }); mkdirSync(heldDirectory, { mode: 0o700 });
  const regular = path.join(heldDirectory, 'regular'); writeFileSync(regular, 'held-regular\n', { mode: 0o400 }); const regularStat = lstatSync(regular); const dirfd = openSync(heldDirectory, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  const open = (name = 'regular', type = 'regular', mode = 0o400, uid = regularStat.uid, gid = regularStat.gid, parentFd = dirfd) => addon.openatReadOnly(parentFd, name, type, mode, uid, gid);
  try {
    const fd = open(); try { assert.equal(readFileSync(fd, 'utf8'), 'held-regular\n'); assert.equal(fstatSync(fd).mode & 0o7777, 0o400); } finally { closeSync(fd); }
    for (const [name, value, code] of [
      ['dot', '.', 'coordinator_openat_name_invalid'], ['dotdot', '..', 'coordinator_openat_name_invalid'], ['slash', 'a/b', 'coordinator_openat_name_invalid'], ['backslash', 'a\\b', 'coordinator_openat_name_invalid'], ['nul', '\0', 'coordinator_openat_name_invalid'], ['nul-suffix', 'regular\0suffix', 'coordinator_openat_name_invalid'], ['oversize', 'x'.repeat(256), 'coordinator_openat_arguments_invalid'], ['empty', '', 'coordinator_openat_arguments_invalid'],
    ]) await expectCode(`openat:name:${name}`, code, () => open(value));
    await expectCode('openat:type:invalid', 'coordinator_openat_type_invalid', () => open('regular', 'file')); await expectCode('openat:type:nul', 'coordinator_openat_type_invalid', () => open('regular', 'regular\0suffix'));
    const baseArgs = [dirfd, 'regular', 'regular', 0o400, regularStat.uid, regularStat.gid]; const numericMutants = [
      ['dirfd-fraction', 0, 1.5], ['dirfd-nan', 0, Number.NaN], ['dirfd-infinity', 0, Number.POSITIVE_INFINITY], ['dirfd-overrange', 0, 2 ** 31],
      ['mode-fraction', 3, 1.5], ['mode-nan', 3, Number.NaN], ['mode-infinity', 3, Number.POSITIVE_INFINITY], ['mode-overrange', 3, 0o10000],
      ['uid-fraction', 4, 1.5], ['uid-nan', 4, Number.NaN], ['uid-infinity', 4, Number.POSITIVE_INFINITY], ['uid-overrange', 4, 2 ** 32],
      ['gid-fraction', 5, 1.5], ['gid-nan', 5, Number.NaN], ['gid-infinity', 5, Number.POSITIVE_INFINITY], ['gid-overrange', 5, 2 ** 32],
    ];
    for (const [name, index, value] of numericMutants) { const args = [...baseArgs]; args[index] = value; await expectCode(`openat:argument:${name}`, 'coordinator_openat_arguments_invalid', () => addon.openatReadOnly(...args)); }
    await expectCode('openat:argument-count', 'coordinator_openat_arguments_invalid', () => addon.openatReadOnly(...baseArgs.slice(0, 5)));

    symlinkSync('regular', path.join(heldDirectory, 'symlink')); await expectCode('openat:symlink', 'coordinator_openat_symlink_forbidden', () => open('symlink'));
    writeFileSync(path.join(heldDirectory, 'hard-base'), 'hard\n', { mode: 0o400 }); linkSync(path.join(heldDirectory, 'hard-base'), path.join(heldDirectory, 'hard-alias')); await expectCode('openat:hardlink', 'coordinator_openat_descriptor_invalid', () => open('hard-base'));
    writeFileSync(path.join(heldDirectory, 'wrong-mode'), 'mode\n', { mode: 0o600 }); await expectCode('openat:wrong-mode', 'coordinator_openat_descriptor_invalid', () => open('wrong-mode'));
    await expectCode('openat:wrong-uid', 'coordinator_openat_descriptor_invalid', () => open('regular', 'regular', 0o400, regularStat.uid + 1, regularStat.gid)); await expectCode('openat:wrong-gid', 'coordinator_openat_descriptor_invalid', () => open('regular', 'regular', 0o400, regularStat.uid, regularStat.gid + 1));
    mkdirSync(path.join(heldDirectory, 'directory-child'), { mode: 0o700 }); await expectCode('openat:directory-as-regular', 'coordinator_openat_descriptor_invalid', () => open('directory-child'));
    const mkfifo = spawnSync('/usr/bin/mkfifo', [path.join(heldDirectory, 'fifo')], { encoding: 'utf8' }); assert.equal(mkfifo.status, 0, mkfifo.stderr); chmodSync(path.join(heldDirectory, 'fifo'), 0o400); await expectCode('openat:fifo-as-regular', 'coordinator_openat_descriptor_invalid', () => open('fifo'));

    const fdCountBefore = readdirSync('/dev/fd').length; for (let index = 0; index < 1000; index += 1) { try { open('wrong-mode'); assert.fail('wrong-mode unexpectedly opened'); } catch (error) { assert.equal(exactCode(error), 'coordinator_openat_descriptor_invalid'); } } const fdCountAfter = readdirSync('/dev/fd').length; assert.equal(fdCountAfter, fdCountBefore);
    const moved = path.join(root, 'held-moved'); renameSync(heldDirectory, moved); mkdirSync(heldDirectory, { mode: 0o700 }); writeFileSync(path.join(heldDirectory, 'regular'), 'replacement-path\n', { mode: 0o400 }); const heldFd = open(); try { assert.equal(readFileSync(heldFd, 'utf8'), 'held-regular\n'); } finally { closeSync(heldFd); }
  } finally { closeSync(dirfd); }

  const buildHashes = [];
  for (let index = 0; index < 2; index += 1) {
    const buildRoot = path.join(root, `build-${index}`); mkdirSync(buildRoot, { mode: 0o700 }); const copiedSource = path.join(buildRoot, 'coordinator-openat.c'); const copiedBuilder = path.join(buildRoot, 'build-coordinator-openat.mjs'); const output = path.join(buildRoot, 'coordinator-openat.node'); copyFileSync(sourcePath, copiedSource, fsConstants.COPYFILE_EXCL); copyFileSync(builderPath, copiedBuilder, fsConstants.COPYFILE_EXCL);
    const built = spawnSync(process.execPath, [copiedBuilder, output], { cwd: buildRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }); assert.equal(built.status, 0, built.stderr || built.stdout); const report = JSON.parse(built.stdout.trim()); assert.equal(report.status, 'coordinator_openat_built'); assert.equal(report.sourceSha256, contract.sourceByteSha256); assert.equal(report.binarySha256, contract.nodeByteSha256); const outputHash = sha256(readFileSync(output)); assert.equal(outputHash, contract.nodeByteSha256); buildHashes.push(outputHash);
  }
  assert.deepEqual(buildHashes, [contract.nodeByteSha256, contract.nodeByteSha256]); evidence.counts.openatNameNegativeBranches = 8; evidence.counts.openatNumericNegativeBranches = 17; evidence.counts.openatDescriptorNegativeBranches = 7; evidence.counts.openatRepeatedFailureChecks = 1000; evidence.counts.openatDeterministicBuilds = 2; evidence.hashes.coordinatorOpenatNodeByteSha256 = contract.nodeByteSha256;
}

function cliGuardSource(publicPaths) {
  return [
    `'use strict';`,
    `const fs=require('node:fs');`,
    `const path=require('node:path');`,
    `const {syncBuiltinESMExports}=require('node:module');`,
    `const targets=new Set(${JSON.stringify(publicPaths.map((item) => path.resolve(item)))});`,
    `const normalize=(value)=>typeof value==='string'?path.resolve(value):value&&value.href&&value.protocol==='file:'?path.resolve(require('node:url').fileURLToPath(value)):null;`,
    `const guard=(name,original)=>function(input,...args){const target=normalize(input);if(target&&targets.has(target)){const error=new Error('cli_premature_public_open:'+name+':'+target);error.code='cli_premature_public_open';throw error;}return original.call(this,input,...args);};`,
    `for(const name of ['readFileSync','openSync','statSync','lstatSync','realpathSync'])if(typeof fs[name]==='function')fs[name]=guard(name,fs[name]);`,
    `syncBuiltinESMExports();`,
    '',
  ].join('\n');
}

function parseChildJsonLines(child) {
  const lines = `${child.stdout ?? ''}\n${child.stderr ?? ''}`.split(/\r?\n/u).filter(Boolean); const values = [];
  for (const line of lines) try { values.push(JSON.parse(line)); } catch { /* diagnostics may include a stack after the canonical first envelope */ }
  return values;
}

function pathTreeState(target) {
  if (!pathExists(target)) return { type: 'absent' };
  const status = lstatSync(target); const metadata = { mode: status.mode & 0o7777, nlink: status.nlink, size: status.size, symlink: status.isSymbolicLink() };
  if (status.isSymbolicLink()) return { type: 'symlink', ...metadata };
  if (status.isFile()) return { type: 'file', ...metadata, byteSha256: sha256(readFileSync(target)) };
  if (status.isDirectory()) return { type: 'directory', ...metadata, entries: Object.fromEntries(readdirSync(target).sort(rawCompare).map((name) => [name, pathTreeState(path.join(target, name))])) };
  return { type: 'other', ...metadata };
}

function normalCliFailure(args, expected) {
  const child = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1' } });
  assert.notEqual(child.status, 0, `CLI unexpectedly succeeded: ${args.join(' ')}`); const failure = parseChildJsonLines(child).find((value) => typeof value?.code === 'string');
  assert.ok(failure, `missing CLI error envelope: ${child.stdout}\n${child.stderr}`); assert.equal(failure.code, expected); return failure;
}

function cliExpectedHashFlags(prefix = 'a') { return `${prefix.charCodeAt(0).toString(16).slice(-1)}`.repeat(64); }
function mutateHashNibble(value, index) { assert.match(value, SHA); assert.ok(Number.isInteger(index) && index >= 0 && index < 64); const replacement = value[index] === '0' ? '1' : '0'; return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`; }

function testCliOutputIsolation() {
  const root = path.join(tempRoot, 'cli-isolation'); mkdirSync(root, { mode: 0o700 });
  const blindBundle = path.join(root, 'blind'); mkdirSync(path.join(blindBundle, 'mutable'), { recursive: true, mode: 0o700 }); writeFileSync(path.join(blindBundle, 'keep'), 'bundle\n', { mode: 0o600 });
  const pairA = path.join(root, 'pair-a'); const pairB = path.join(root, 'pair-b'); for (const pair of [pairA, pairB]) { mkdirSync(pair, { mode: 0o700 }); writeFileSync(path.join(pair, 'review.json'), 'review\n', { mode: 0o400 }); writeFileSync(path.join(pair, 'review-export-receipt.json'), 'receipt\n', { mode: 0o400 }); }
  const c0 = path.join(root, 'c0.json'); const raw = path.join(root, 'raw.json'); const reveal = path.join(root, 'reveal.json'); for (const filePath of [c0, raw, reveal]) writeFileSync(filePath, `${path.basename(filePath)}\n`, { mode: 0o600 });
  const before = pathTreeState(root); const hashA = cliExpectedHashFlags('a'); const hashB = cliExpectedHashFlags('b'); const hashC = cliExpectedHashFlags('c'); const hashD = cliExpectedHashFlags('d');
  normalCliFailure(['prepare-bundle', '--mode', 'first', '--actor-pseudonym-sha256', ACTOR_A, '--cycle-id', CYCLE, '--bundle-dir', path.join(ROOT, 'tests')], 'output_path_not_external_or_disjoint');
  normalCliFailure(['seal-c0', '--bundle-dir', blindBundle, '--expected-session-tree-sha256', hashA, '--output', path.join(blindBundle, 'mutable/c0.json')], 'output_path_not_external_or_disjoint');
  normalCliFailure(['compare-raw', '--review-a', path.join(pairA, 'review.json'), '--receipt-a', path.join(pairA, 'review-export-receipt.json'), '--expected-receipt-a-sha256', hashA, '--review-b', path.join(pairB, 'review.json'), '--receipt-b', path.join(pairB, 'review-export-receipt.json'), '--expected-receipt-b-sha256', hashB, '--c0-ledger', c0, '--expected-c0-byte-sha256', hashC, '--output', path.join(pairA, 'raw.json')], 'output_path_not_external_or_disjoint');
  normalCliFailure(['prepare-adjudication', '--review-a', path.join(pairA, 'review.json'), '--receipt-a', path.join(pairA, 'review-export-receipt.json'), '--expected-receipt-a-sha256', hashA, '--review-b', path.join(pairB, 'review.json'), '--receipt-b', path.join(pairB, 'review-export-receipt.json'), '--expected-receipt-b-sha256', hashB, '--raw-report', raw, '--expected-raw-report-sha256', hashC, '--c0-ledger', c0, '--expected-c0-byte-sha256', hashD, '--bundle-dir', path.join(pairA, 'nested-reveal')], 'output_path_not_external_or_disjoint');
  normalCliFailure(['export-adjudication', '--bundle-dir', blindBundle, '--review-a', path.join(pairA, 'review.json'), '--receipt-a', path.join(pairA, 'review-export-receipt.json'), '--expected-receipt-a-sha256', hashA, '--review-b', path.join(pairB, 'review.json'), '--receipt-b', path.join(pairB, 'review-export-receipt.json'), '--expected-receipt-b-sha256', hashB, '--raw-report', raw, '--expected-raw-report-sha256', hashC, '--c0-ledger', c0, '--expected-c0-byte-sha256', hashD, '--reveal-receipt', reveal, '--expected-reveal-receipt-sha256', hashA, '--expected-session-tree-sha256', hashB, '--output-dir', path.join(blindBundle, 'nested-output')], 'output_path_not_external_or_disjoint');
  assert.deepEqual(pathTreeState(root), before); assertNoTransactionResidue(root);
  evidence.counts.cliOutputIsolationBranches = 5;
}

async function expectCliFirstCode(name, args, expected, guardPath, extraEnv = {}) {
  const child = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require=${guardPath}`, ...extraEnv },
  });
  assert.notEqual(child.status, 0, `${name}: CLI unexpectedly succeeded\n${child.stdout}\n${child.stderr}`);
  const values = parseChildJsonLines(child); const failure = values.find((value) => typeof value?.code === 'string');
  assert.ok(failure, `${name}: missing canonical error envelope\n${child.stdout}\n${child.stderr}`);
  assert.equal(failure.code, expected, `${name}: wrong first code`); assert.notEqual(failure.code, 'cli_premature_public_open');
  evidence.exactFirstCodes[name] = failure.code; evidence.cases.expectedFailures += 1;
  return { child, failure };
}

async function testCliSurfaceAndScope() {
  const publicPaths = Object.keys(FIXTURE.publicBytePins).map((logical) => path.join(ROOT, logical)); const guardPath = path.join(tempRoot, 'cli-no-public-open.cjs');
  writeFileSync(guardPath, cliGuardSource(publicPaths), { mode: 0o600 });
  await expectCliFirstCode('cli:unknown-mode', ['unknown-mode'], 'cli_mode_invalid', guardPath);
  await expectCliFirstCode('cli:duplicate-flag', ['serve', '--bundle-dir', '/private/tmp/a', '--bundle-dir', '/private/tmp/b'], 'cli_flag_invalid', guardPath);
  await expectCliFirstCode('cli:mode-inapplicable', ['serve', '--bundle-dir', '/private/tmp/a', '--review-a', '/private/tmp/x'], 'cli_flag_invalid', guardPath);
  await expectCliFirstCode('cli:serve-port-forbidden', ['serve', '--bundle-dir', '/private/tmp/a', '--port', '1234'], 'cli_flag_invalid', guardPath);
  await expectCliFirstCode('cli:handoff-output-forbidden', ['handoff-check', '--output', '/private/tmp/out'], 'cli_flag_invalid', guardPath);
  await expectCliFirstCode('cli:orchestrator-state-forbidden', ['prepare-bundle', '--orchestrator-state', '/private/tmp/state'], 'cli_flag_invalid', guardPath);
  await expectCliFirstCode('cli:missing-required', ['prepare-bundle', '--mode', 'first'], 'cli_flag_missing', guardPath);
  await expectCliFirstCode('cli:actor-uppercase-hash', ['prepare-bundle', '--mode', 'first', '--actor-pseudonym-sha256', 'A'.repeat(64), '--cycle-id', CYCLE, '--bundle-dir', '/private/tmp/a'], 'actor_pseudonym_invalid', guardPath);
  const compareFlags = ['compare-raw', '--review-a', '/private/tmp/a/review.json', '--receipt-a', '/private/tmp/a/review-export-receipt.json', '--expected-receipt-a-sha256', 'A'.repeat(64), '--review-b', '/private/tmp/b/review.json', '--receipt-b', '/private/tmp/b/review-export-receipt.json', '--expected-receipt-b-sha256', '6'.repeat(64), '--c0-ledger', '/private/tmp/c0.json', '--expected-c0-byte-sha256', '7'.repeat(64), '--output', '/private/tmp/raw.json'];
  await expectCliFirstCode('cli:expected-hash-uppercase', compareFlags, 'cli_expected_hash_invalid', guardPath);

  const sessionHash = '1'.repeat(64); const fakeBundle = '/private/tmp/r2-bundle'; const fakeOutput = '/private/tmp/r2-output';
  const r2GuardPath = path.join(tempRoot, 'cli-r2-no-input-open.cjs');
  writeFileSync(r2GuardPath, cliGuardSource([fakeBundle, fakeOutput, '/private/tmp/a/review.json', '/private/tmp/a/review-export-receipt.json', '/private/tmp/b/review.json', '/private/tmp/b/review-export-receipt.json', '/private/tmp/raw.json', '/private/tmp/c0.json', '/private/tmp/reveal.json']), { mode: 0o600 });
  const exportReviewArgs = ['export-review', '--bundle-dir', fakeBundle, '--output-dir', fakeOutput];
  const sealC0Args = ['seal-c0', '--bundle-dir', fakeBundle, '--output', fakeOutput];
  const exportAdjudicationArgs = [
    'export-adjudication', '--bundle-dir', fakeBundle,
    '--review-a', '/private/tmp/a/review.json', '--receipt-a', '/private/tmp/a/review-export-receipt.json', '--expected-receipt-a-sha256', '2'.repeat(64),
    '--review-b', '/private/tmp/b/review.json', '--receipt-b', '/private/tmp/b/review-export-receipt.json', '--expected-receipt-b-sha256', '3'.repeat(64),
    '--raw-report', '/private/tmp/raw.json', '--expected-raw-report-sha256', '4'.repeat(64), '--c0-ledger', '/private/tmp/c0.json', '--expected-c0-byte-sha256', '5'.repeat(64),
    '--reveal-receipt', '/private/tmp/reveal.json', '--expected-reveal-receipt-sha256', '6'.repeat(64), '--output-dir', fakeOutput,
  ];
  await expectCliFirstCode('cli:r2-missing-session-tree-export-review', exportReviewArgs, 'cli_flag_missing', r2GuardPath);
  await expectCliFirstCode('cli:r2-missing-session-tree-seal-c0', sealC0Args, 'cli_flag_missing', r2GuardPath);
  await expectCliFirstCode('cli:r2-missing-session-tree-export-adjudication', exportAdjudicationArgs, 'cli_flag_missing', r2GuardPath);
  await expectCliFirstCode('cli:r2-duplicate-session-tree', [...exportReviewArgs, '--expected-session-tree-sha256', sessionHash, '--expected-session-tree-sha256', sessionHash], 'cli_flag_invalid', r2GuardPath);
  await expectCliFirstCode('cli:r2-uppercase-session-tree', [...exportReviewArgs, '--expected-session-tree-sha256', sessionHash.toUpperCase().replace(/^1/u, 'A')], 'cli_expected_hash_invalid', r2GuardPath);
  await expectCliFirstCode('cli:r2-short-session-tree', [...sealC0Args, '--expected-session-tree-sha256', sessionHash.slice(1)], 'cli_expected_hash_invalid', r2GuardPath);
  await expectCliFirstCode('cli:r2-environment-session-tree-default-forbidden', exportReviewArgs, 'cli_flag_missing', r2GuardPath, { SAM_GOAL_EXPECTED_SESSION_TREE_SHA256: sessionHash, EXPECTED_SESSION_TREE_SHA256: sessionHash });
  await expectCliFirstCode('cli:r2-hash-named-bundle-default-forbidden', ['export-review', '--bundle-dir', `/private/tmp/${sessionHash}`, '--output-dir', fakeOutput], 'cli_flag_missing', r2GuardPath);
  for (const [mode, args] of [
    ['prepare-bundle', ['prepare-bundle', '--expected-session-tree-sha256', sessionHash]],
    ['serve', ['serve', '--bundle-dir', fakeBundle, '--expected-session-tree-sha256', sessionHash]],
    ['compare-raw', ['compare-raw', '--expected-session-tree-sha256', sessionHash]],
    ['prepare-adjudication', ['prepare-adjudication', '--expected-session-tree-sha256', sessionHash]],
    ['handoff-check', ['handoff-check', '--expected-session-tree-sha256', sessionHash]],
  ]) await expectCliFirstCode(`cli:r2-session-tree-mode-inapplicable:${mode}`, args, 'cli_flag_invalid', r2GuardPath);

  const source = readFileSync(CLI, 'utf8'); const launcher = readFileSync(LAUNCHER, 'utf8'); const app = readFileSync(APP, 'utf8'); const indexHtml = readFileSync(VIEWER_INDEX, 'utf8'); const style = readFileSync(VIEWER_STYLE, 'utf8');
  for (const mode of Object.keys(FIXTURE.cliSurface)) assert.match(source, new RegExp(`['"]${mode}['"]`, 'u'), `CLI mode missing: ${mode}`);
  assert.doesNotMatch(source, /['"](?:compile|create-anchor|verify-anchor)['"]/u);
  assert.doesNotMatch(source, /sam-goal-label-audit-v3/u);
  assert.doesNotMatch(source, /orchestrator(?:[_-]state|State)/u);
  assert.doesNotMatch(source, /(?:p0-candidate|ready_for_p0|p0_verified|teacher-valid)/u);
  assert.match(source, /validate-review/u); assert.match(source, /validatorStdoutBase64/u); assert.match(source, /validatorStdoutByteSha256/u);
  assert.doesNotMatch(source, /JSON\.parse\([^\n]*(?:validator|stdout)/u);
  assert.match(source, /handoff-check/u); assert.match(source, /ready_for_manual_pack_compiler/u);
  assert.match(source, /formalTuple/u); assert.match(source, /report/u);
  assert.match(source, /--expected-session-tree-sha256/u); assert.match(source, /sessionTreeSha256/u); assert.match(source, /makeSessionSealEnvelope/u);
  assert.match(source, /review_ui_ready/u); assert.match(source, /process\.stderr\.write/u);
  assert.match(source, /function assertAccessEvidenceClosed/u); for (const code of Object.values(ACCESS_EVIDENCE_SEMANTIC_CODES)) assert.match(source, new RegExp(code, 'u'));

  assert.match(launcher, /x-sam-goal-csrf/u); assert.match(launcher, /clientGeneration/u); assert.match(launcher, /lockNonce/u);
  assert.match(launcher, /stale_frame_lock_ignored/u); assert.match(launcher, /locked_identity_invalid/u); assert.match(launcher, /request_close|requestClose/u);
  assert.match(launcher, /host-repository/u); assert.match(launcher, /sibling-bundle/u); assert.match(launcher, /non-loopback/u);
  assert.match(launcher, /default-src 'none'/u); assert.match(launcher, /127\.0\.0\.1/u);
  assert.match(app, /findIndex\(\(row\) => row\.clipId === clipId && row\.sourceFrameIndex === sourceFrameIndex\)/u);
  assert.match(app, /exact_jump_identity_invalid/u); assert.match(app, /releaseServerLock\(previous\)/u); assert.match(app, /lockGeneration/u);
  assert.match(app, /canvas\.width === 1 \? 0/u); assert.match(app, /canvas\.height === 1 \? 0/u); assert.doesNotMatch(app, /(?:draw.*anchor|arc\()/iu);
  assert.equal((indexHtml.match(/data-sam-goal-evidence-target="blind-exact-source-frame"/gu) ?? []).length, 1); assert.equal((indexHtml.match(/data-sam-goal-evidence-target="reveal-exact-source-frame"/gu) ?? []).length, 1); assert.equal((indexHtml.match(/data-sam-goal-view-mode="fit"/gu) ?? []).length, 4);
  for (const id of ['blindFit', 'blindOneToOne', 'revealFit', 'revealOneToOne', 'blindInspectionStage', 'revealInspectionStage']) assert.match(indexHtml, new RegExp(`id="${id}"`, 'u'));
  assert.match(style, /\.evidence-stage\{[^}]*overflow:visible/u); assert.match(style, /\.evidence-stage>\[data-sam-goal-evidence-target\]\{[^}]*max-width:100%[^}]*max-height:58vh[^}]*outline:0(?:;|\})/u); assert.match(style, /\.inspection-stage\{[^}]*overflow:auto/u); assert.doesNotMatch(indexHtml, /still-scroll/u);
  assert.match(app, /__samGoalPresentationV3/u); assert.match(app, /sourcePointFromPointer/u); assert.match(app, /inverse|rawX/u); assert.match(app, /setMode\('fit'\)/u); assert.match(app, /one-to-one/u); assert.match(app, /syncInspectionCanvas/u); assert.doesNotMatch(app, /void update(?:Reveal)?Motion/u); assert.match(app, /await updateMotionContext/u); assert.match(app, /await updateRevealMotion/u); assert.equal((app.match(/await settleMotionContextLayout\(\)/gu) ?? []).length, 4); assert.match(app, /canvas\.width = decoded\.frame\.displayWidth[\s\S]*presentation\.sync\(\)[\s\S]*await settleMotionContextLayout\(\)[\s\S]*Locked exact demux\/WebCodecs sample/u); assert.match(app, /canvas\.width = decoded\.frame\.displayWidth[\s\S]*presentation\.sync\(\)[\s\S]*await settleMotionContextLayout\(\)[\s\S]*Exact source sample verified and displayed/u);
  assert.equal(sha256(Buffer.from(app)) === FIXTURE.presentationContract.knownPrefitViewerSha256['immutable/viewer/app.js'], false); assert.equal(sha256(Buffer.from(indexHtml)) === FIXTURE.presentationContract.knownPrefitViewerSha256['immutable/viewer/index.html'], false); assert.equal(sha256(Buffer.from(style)) === FIXTURE.presentationContract.knownPrefitViewerSha256['immutable/viewer/style.css'], false);
  assert.doesNotMatch(app, /(?:skeleton|keypoint|bounding.?box|bbox|metric|kappa)/iu);
  assert.doesNotMatch(app, /(?:nearest|epsilon|frameRate|requestVideoFrameCallback)/u);
  for (const value of ['set-decision', 'set-disposition']) { assert.match(launcher, new RegExp(value, 'u'), `reveal server action missing: ${value}`); assert.match(app, new RegExp(value, 'u'), `reveal UI action missing: ${value}`); }
  assert.match(launcher, /adjudication-reveal/u); assert.match(app, /adjudication-reveal/u); assert.match(launcher, /revealReceiptByteSha256/u); assert.match(launcher, /deviationClass/u); assert.match(launcher, /current.*disposition|disposition.*current/isu);

  evidence.counts.cliNegativeBranches = 22; evidence.counts.cliSessionTreeUsageBranches = 13; evidence.counts.cliModes = Object.keys(FIXTURE.cliSurface).length;
  evidence.hashes.cliByteSha256 = sha256(Buffer.from(source)); evidence.hashes.launcherByteSha256 = sha256(Buffer.from(launcher)); evidence.hashes.appByteSha256 = sha256(Buffer.from(app));
  evidence.hashes.viewerIndexByteSha256 = sha256(Buffer.from(indexHtml)); evidence.hashes.viewerStyleByteSha256 = sha256(Buffer.from(style));
  testCliOutputIsolation();
}

function runAsyncProcess(executable, args, { env = process.env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] }); const stdout = []; const stderr = []; let timedOut = false;
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (status, signal) => { clearTimeout(timer); resolve({ status, signal, timedOut, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }); });
  });
}

function cloneTreePreservingModes(source, destination) {
  assert.equal(pathExists(destination), false); cpSync(source, destination, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
  const restoreModes = (sourcePath, destinationPath) => { const sourceStatus = lstatSync(sourcePath); if (!sourceStatus.isSymbolicLink()) chmodSync(destinationPath, sourceStatus.mode & 0o7777); if (sourceStatus.isDirectory() && !sourceStatus.isSymbolicLink()) for (const name of readdirSync(sourcePath)) restoreModes(path.join(sourcePath, name), path.join(destinationPath, name)); }; restoreModes(source, destination);
}

function cloneBundle(source, destination) {
  cloneTreePreservingModes(source, destination);
  const sourceManifest = lstatSync(path.join(source, 'immutable/bundle-manifest.json')); const destinationManifest = lstatSync(path.join(destination, 'immutable/bundle-manifest.json'));
  assert.equal(destinationManifest.isFile(), true); assert.equal(destinationManifest.nlink, 1); assert.notEqual(`${sourceManifest.dev}:${sourceManifest.ino}`, `${destinationManifest.dev}:${destinationManifest.ino}`); assert.equal(sha256(readFileSync(path.join(source, 'immutable/bundle-manifest.json'))), sha256(readFileSync(path.join(destination, 'immutable/bundle-manifest.json'))));
}

function cloneBundleRole(source, destination, publicState, mode, actor) {
  cloneBundle(source, destination); const manifestPath = path.join(destination, 'immutable/bundle-manifest.json'); const manifest = core.parseJsonBuffer(readFileSync(manifestPath), { processArtifact: true }); manifest.mode = mode; manifest.actorPseudonymSha256 = actor;
  chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, core.processBytes(manifest)); chmodSync(manifestPath, 0o400); const manifestHash = sha256(readFileSync(manifestPath));
  const worksheet = core.createWorksheet({ publicState, mode, actorPseudonymSha256: actor, cycleId: CYCLE, bundleManifestByteSha256: manifestHash, rulebookByteSha256: manifest.rulebookByteSha256 });
  const journal = processDocument('sam-goal-review-edit-journal-v1', { cycleId: CYCLE, mode, actorPseudonymSha256: actor, bundleManifestByteSha256: manifestHash, events: [] });
  writeFileSync(path.join(destination, 'mutable/worksheet-seed.json'), core.processBytes(worksheet)); chmodSync(path.join(destination, 'mutable/worksheet-seed.json'), 0o600);
  writeFileSync(path.join(destination, 'mutable/edit-journal.json'), core.processBytes(journal)); chmodSync(path.join(destination, 'mutable/edit-journal.json'), 0o600);
}

function coherentlyResealTrustedAssetMutation(bundle, logicalPath, publicState) {
  const manifestPath = path.join(bundle, 'immutable/bundle-manifest.json'); const manifest = core.parseJsonBuffer(readFileSync(manifestPath), { processArtifact: true }); const descriptor = manifest.immutableAssets.find((item) => item.logicalPath === logicalPath); assert.ok(descriptor, `missing trusted asset descriptor: ${logicalPath}`);
  const target = path.join(bundle, logicalPath); const original = readFileSync(target); assert.ok(original.length > 0, `empty trusted asset: ${logicalPath}`); const mutated = Buffer.from(original); mutated[0] ^= 0x01; assert.equal(mutated.length, original.length); assert.equal(mutated.reduce((count, byte, index) => count + Number(byte !== original[index]), 0), 1);
  const finalMode = descriptor.executable ? 0o500 : 0o400; chmodSync(target, descriptor.executable ? 0o700 : 0o600); writeFileSync(target, mutated); chmodSync(target, finalMode); assert.equal(permissionBits(target), finalMode);
  descriptor.sha256 = sha256(mutated); descriptor.bytes = mutated.length; if (logicalPath === 'immutable/rulebook.md') manifest.rulebookByteSha256 = descriptor.sha256; manifest.immutableAssetSetSha256 = core.canonicalHash(manifest.immutableAssets); core.validateProcessArtifact(manifest, publicState, manifest.artifactType);
  const manifestBytes = core.processBytes(manifest); chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, manifestBytes); chmodSync(manifestPath, 0o400); const manifestHash = sha256(manifestBytes);
  const seedPath = path.join(bundle, 'mutable/worksheet-seed.json'); const seed = core.parseJsonBuffer(readFileSync(seedPath), { processArtifact: true }); seed.bundleManifestByteSha256 = manifestHash; if (logicalPath === 'immutable/rulebook.md') seed.rulebookByteSha256 = descriptor.sha256; core.validateWorksheet(seed, publicState);
  const journalPath = path.join(bundle, 'mutable/edit-journal.json'); const journal = core.parseJsonBuffer(readFileSync(journalPath), { processArtifact: true }); journal.bundleManifestByteSha256 = manifestHash; core.validateProcessArtifact(journal, publicState, journal.artifactType);
  writeFileSync(seedPath, core.processBytes(seed)); chmodSync(seedPath, 0o600); writeFileSync(journalPath, core.processBytes(journal)); chmodSync(journalPath, 0o600);
  assert.equal(sha256(readFileSync(target)), descriptor.sha256); assert.equal(core.parseJsonBuffer(readFileSync(seedPath), { processArtifact: true }).bundleManifestByteSha256, manifestHash); assert.equal(core.parseJsonBuffer(readFileSync(journalPath), { processArtifact: true }).bundleManifestByteSha256, manifestHash);
  return { logicalPath, originalByteSha256: sha256(original), mutatedByteSha256: descriptor.sha256, manifestByteSha256: manifestHash };
}

function writeCanonicalReadOnly(filePath, document) { const bytes = core.processBytes(document); if (pathExists(filePath)) chmodSync(filePath, 0o600); writeFileSync(filePath, bytes, { mode: 0o600 }); chmodSync(filePath, 0o400); return { bytes, sha256: sha256(bytes) }; }

function rewriteSyntheticPresentationLineage(filePath, lineage = PREFIT_PRESENTATION_CONTRACT_SHA256, finalMode = 0o400) {
  const document = core.parseJsonBuffer(readFileSync(filePath), { processArtifact: true }); assert.equal(Object.hasOwn(document, 'presentationContractSha256'), true); document.presentationContractSha256 = lineage;
  const bytes = core.processBytes(document); chmodSync(filePath, 0o600); writeFileSync(filePath, bytes); chmodSync(filePath, finalMode); return { filePath, bytes, sha256: sha256(bytes), document };
}

function syntheticStaleBundle(source, destination) { cloneBundle(source, destination); const manifest = rewriteSyntheticPresentationLineage(path.join(destination, 'immutable/bundle-manifest.json')); return { bundle: destination, manifest }; }

function syntheticStalePair(sourceDirectory, destinationDirectory, processMember) { cloneTreePreservingModes(sourceDirectory, destinationDirectory); const process = rewriteSyntheticPresentationLineage(path.join(destinationDirectory, processMember)); return { directory: destinationDirectory, processPath: process.filePath, processByteSha256: process.sha256 }; }

function syntheticStaleProcessFile(sourcePath, destinationPath) { const finalMode = permissionBits(sourcePath); copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_EXCL); const process = rewriteSyntheticPresentationLineage(destinationPath, PREFIT_PRESENTATION_CONTRACT_SHA256, finalMode); return { path: destinationPath, byteSha256: process.sha256 }; }

function coherentlyResealRevealFixedSplitChain(sourceBundle, destination, kind, publicState, { unsealed = false } = {}) {
  cloneBundle(sourceBundle, destination); const fixed = path.join(destination, 'fixed'); const manifestPath = path.join(destination, 'immutable/bundle-manifest.json'); const manifestBytes = readFileSync(manifestPath); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true }); const receiptAPath = path.join(fixed, 'review-a-export-receipt.json'); const receiptBPath = path.join(fixed, 'review-b-export-receipt.json'); const rawPath = path.join(fixed, 'raw-ab-report.json'); const c0Path = path.join(fixed, 'c0-ledger.json'); const skeletonPath = path.join(fixed, 'disagreement-skeleton.json'); const revealReceiptPath = path.join(fixed, 'reveal-receipt.json');
  const receiptA = core.parseJsonBuffer(readFileSync(receiptAPath), { processArtifact: true }); const receiptB = core.parseJsonBuffer(readFileSync(receiptBPath), { processArtifact: true }); const raw = core.parseJsonBuffer(readFileSync(rawPath), { processArtifact: true }); const c0 = core.parseJsonBuffer(readFileSync(c0Path), { processArtifact: true }); const skeleton = core.parseJsonBuffer(readFileSync(skeletonPath), { processArtifact: true });
  const y = kind === 'cycle' ? `${c0.cycleId}-split-y` : kind === 'actor' ? mutateHashNibble(c0.adjudicatorPseudonymSha256, 0) : mutateHashNibble(c0.rulebookByteSha256, 0);
  if (kind === 'cycle') { for (const document of [receiptA, receiptB, raw, c0, skeleton]) document.cycleId = y; }
  else if (kind === 'actor') { c0.adjudicatorPseudonymSha256 = y; skeleton.adjudicatorPseudonymSha256 = y; }
  else if (kind === 'rulebook') { for (const document of [receiptA, receiptB, raw, c0, skeleton]) document.rulebookByteSha256 = y; }
  else assert.fail(`unknown split-chain kind: ${kind}`);
  core.validateProcessArtifact(receiptA, publicState, receiptA.artifactType); core.validateProcessArtifact(receiptB, publicState, receiptB.artifactType); core.validateProcessArtifact(c0, publicState, c0.artifactType);
  const receiptAWrite = writeCanonicalReadOnly(receiptAPath, receiptA); const receiptBWrite = writeCanonicalReadOnly(receiptBPath, receiptB); const c0Write = writeCanonicalReadOnly(c0Path, c0);
  raw.reviewAReceiptByteSha256 = receiptAWrite.sha256; raw.reviewBReceiptByteSha256 = receiptBWrite.sha256; raw.c0LedgerByteSha256 = c0Write.sha256; core.validateProcessArtifact(raw, publicState, raw.artifactType); const rawWrite = writeCanonicalReadOnly(rawPath, raw);
  skeleton.reviewAReceiptByteSha256 = receiptAWrite.sha256; skeleton.reviewBReceiptByteSha256 = receiptBWrite.sha256; skeleton.rawABReportByteSha256 = rawWrite.sha256; skeleton.c0LedgerByteSha256 = c0Write.sha256;
  const reviewABytes = readFileSync(path.join(fixed, 'review-a.json')); const reviewBBytes = readFileSync(path.join(fixed, 'review-b.json')); const reviewA = core.parseJsonBuffer(reviewABytes); const reviewB = core.parseJsonBuffer(reviewBBytes); const expectedSkeleton = core.makeSkeleton(reviewA, reviewB, publicState, {
    cycleId: c0.cycleId, adjudicatorPseudonymSha256: c0.adjudicatorPseudonymSha256, publicPins: clone(skeleton.publicPins), sourceBinding: clone(skeleton.sourceBinding), rulebookByteSha256: c0.rulebookByteSha256,
    reviewAByteSha256: sha256(reviewABytes), reviewACanonicalSha256: reviewA.expectedCanonicalHash, reviewAPseudonymSha256: reviewA.reviewerPseudonymSha256, reviewBByteSha256: sha256(reviewBBytes), reviewBCanonicalSha256: reviewB.expectedCanonicalHash, reviewBPseudonymSha256: reviewB.reviewerPseudonymSha256,
    reviewAReceiptByteSha256: receiptAWrite.sha256, reviewBReceiptByteSha256: receiptBWrite.sha256, rawABReportByteSha256: rawWrite.sha256, c0LedgerByteSha256: c0Write.sha256,
  }); assert.equal(stableStringify(skeleton), stableStringify(expectedSkeleton)); const skeletonWrite = writeCanonicalReadOnly(skeletonPath, skeleton);
  const revealReceipt = core.parseJsonBuffer(readFileSync(revealReceiptPath), { processArtifact: true }); Object.assign(revealReceipt, { reviewAReceiptByteSha256: receiptAWrite.sha256, reviewBReceiptByteSha256: receiptBWrite.sha256, rawABReportByteSha256: rawWrite.sha256, c0LedgerByteSha256: c0Write.sha256, initialSkeletonByteSha256: skeletonWrite.sha256, initialDecisionCount: skeleton.decisions.length, initialUnsetDecisionCount: skeleton.decisions.filter((decision) => stableStringify(decision.decision) === stableStringify({ status: 'UNSET' })).length }); core.validateProcessArtifact(revealReceipt, publicState, revealReceipt.artifactType); const revealReceiptWrite = writeCanonicalReadOnly(revealReceiptPath, revealReceipt);
  const journalPath = path.join(destination, 'mutable/adjudication-journal.json'); const journal = core.parseJsonBuffer(readFileSync(journalPath), { processArtifact: true }); journal.revealReceiptByteSha256 = revealReceiptWrite.sha256; core.validateProcessArtifact(journal, publicState, journal.artifactType); const journalBytes = core.processBytes(journal); writeFileSync(journalPath, journalBytes); chmodSync(journalPath, 0o600);
  const fixedEntries = FIXTURE.sessionTreeContract.revealFixedLogicalPaths.map((logicalPath) => { const bytes = readFileSync(path.join(destination, logicalPath)); return { logicalPath, bytes: bytes.length, sha256: sha256(bytes) }; }); const fixedInputSetSha256 = core.fixedInputSetSha256(fixedEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths }); const baseResult = { kind, y, receiptAByteSha256: receiptAWrite.sha256, receiptBByteSha256: receiptBWrite.sha256, rawABReportByteSha256: rawWrite.sha256, c0LedgerByteSha256: c0Write.sha256, skeletonByteSha256: skeletonWrite.sha256, revealReceiptPath, revealReceiptByteSha256: revealReceiptWrite.sha256, fixedInputSetSha256 };
  if (unsealed) { assert.deepEqual(readdirSync(path.join(destination, 'mutable')), ['adjudication-journal.json']); assert.equal(journal.events.length, 0); return { ...baseResult, unsealed: true, journalByteSha256: sha256(journalBytes) }; }
  const replay = core.replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: revealReceiptWrite.sha256, requireComplete: true });
  const attestationBytes = readFileSync(path.join(destination, 'mutable/actor-attestation.json')); const accessPath = path.join(destination, 'mutable/access-evidence.json'); const access = core.parseJsonBuffer(readFileSync(accessPath), { processArtifact: true }); Object.assign(access, { fixedInputSetSha256, sessionSeedByteSha256: skeletonWrite.sha256, sessionFinalStateByteSha256: sha256(core.processBytes(replay.finalState)), editJournalByteSha256: sha256(journalBytes), actorAttestationByteSha256: sha256(attestationBytes) }); core.validateProcessArtifact(access, publicState, access.artifactType); const accessBytes = core.processBytes(access); writeFileSync(accessPath, accessBytes); chmodSync(accessPath, 0o600);
  const sessionTreeSha256 = core.sessionTreeSha256({ terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: manifest.presentationContractSha256, bundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256, fixedInputSetSha256, sessionSeedByteSha256: skeletonWrite.sha256, sessionFinalStateByteSha256: access.sessionFinalStateByteSha256, editJournalByteSha256: access.editJournalByteSha256, actorAttestationByteSha256: access.actorAttestationByteSha256, accessEvidenceByteSha256: sha256(accessBytes) });
  return { ...baseResult, accessEvidenceByteSha256: sha256(accessBytes), sessionTreeSha256 };
}

const REVEAL_RECEIPT_SEMANTIC_CODES = Object.freeze({
  'initial-skeleton-hash': 'reveal_initial_skeleton_hash_mismatch', 'initial-counts': 'reveal_initial_decision_count_mismatch',
  'access-policy-hash': 'reveal_access_policy_hash_mismatch', 'bundle-manifest-hash': 'reveal_bundle_manifest_hash_mismatch', 'immutable-asset-set-hash': 'reveal_immutable_asset_set_hash_mismatch',
});
const REVEAL_FIXED_CROSS_CODES = Object.freeze({ 'receipt-actor': 'reveal_fixed_receipt_actor_mismatch', 'receipt-cycle': 'reveal_fixed_receipt_cycle_mismatch', 'receipt-rulebook': 'reveal_fixed_receipt_rulebook_mismatch', 'raw-formal-hash': 'reveal_raw_formal_hash_mismatch' });
const REVEAL_RAW_BINDING_CODES = Object.freeze({ 'raw-review-a-receipt-hash': 'reveal_fixed_chain_invalid', 'raw-review-b-receipt-hash': 'reveal_fixed_chain_invalid', 'raw-c0-hash': 'reveal_fixed_chain_invalid' });

function mutateRevealReceiptSemantic(receipt, mutation, actual) {
  if (mutation === 'initial-skeleton-hash') receipt.initialSkeletonByteSha256 = mutateHashNibble(actual.initialSkeletonByteSha256, 0);
  else if (mutation === 'initial-counts') { receipt.initialDecisionCount = actual.initialDecisionCount + 1; receipt.initialUnsetDecisionCount = actual.initialUnsetDecisionCount + 1; }
  else if (mutation === 'access-policy-hash') receipt.accessPolicyByteSha256 = mutateHashNibble(actual.accessPolicyByteSha256, 0);
  else if (mutation === 'bundle-manifest-hash') receipt.revealBundleManifestByteSha256 = mutateHashNibble(actual.revealBundleManifestByteSha256, 0);
  else if (mutation === 'immutable-asset-set-hash') receipt.immutableAssetSetSha256 = mutateHashNibble(actual.immutableAssetSetSha256, 0);
  else assert.fail(`unknown reveal receipt semantic mutation: ${mutation}`);
}

function coherentlyResealRevealSemanticMutation(sourceBundle, destination, mutation, publicState, { unsealed = false } = {}) {
  cloneBundle(sourceBundle, destination); const fixed = path.join(destination, 'fixed'); const manifestPath = path.join(destination, 'immutable/bundle-manifest.json'); const manifestBytes = readFileSync(manifestPath); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true });
  const paths = Object.fromEntries(['review-a-export-receipt', 'review-b-export-receipt', 'raw-ab-report', 'c0-ledger', 'disagreement-skeleton', 'access-policy', 'reveal-receipt'].map((name) => [name, path.join(fixed, `${name}.json`)]));
  const receiptA = core.parseJsonBuffer(readFileSync(paths['review-a-export-receipt']), { processArtifact: true }); const receiptB = core.parseJsonBuffer(readFileSync(paths['review-b-export-receipt']), { processArtifact: true }); const raw = core.parseJsonBuffer(readFileSync(paths['raw-ab-report']), { processArtifact: true }); const c0 = core.parseJsonBuffer(readFileSync(paths['c0-ledger']), { processArtifact: true }); const skeleton = core.parseJsonBuffer(readFileSync(paths['disagreement-skeleton']), { processArtifact: true }); const accessPolicyBytes = readFileSync(paths['access-policy']); const revealReceipt = core.parseJsonBuffer(readFileSync(paths['reveal-receipt']), { processArtifact: true });
  if (mutation === 'receipt-actor') receiptA.actorPseudonymSha256 = mutateHashNibble(receiptA.actorPseudonymSha256, 0);
  else if (mutation === 'receipt-cycle') receiptA.cycleId = `${receiptA.cycleId}-receipt-y`;
  else if (mutation === 'receipt-rulebook') receiptA.rulebookByteSha256 = mutateHashNibble(receiptA.rulebookByteSha256, 0);
  core.validateProcessArtifact(receiptA, publicState, receiptA.artifactType); core.validateProcessArtifact(receiptB, publicState, receiptB.artifactType); core.validateProcessArtifact(c0, publicState, c0.artifactType);
  const receiptAWrite = writeCanonicalReadOnly(paths['review-a-export-receipt'], receiptA); const receiptBWrite = writeCanonicalReadOnly(paths['review-b-export-receipt'], receiptB); const c0Write = writeCanonicalReadOnly(paths['c0-ledger'], c0);
  raw.reviewAReceiptByteSha256 = receiptAWrite.sha256; raw.reviewBReceiptByteSha256 = receiptBWrite.sha256; raw.c0LedgerByteSha256 = c0Write.sha256; if (mutation === 'raw-formal-hash') raw.reviewAFormalByteSha256 = mutateHashNibble(raw.reviewAFormalByteSha256, 0); else if (mutation === 'raw-review-a-receipt-hash') raw.reviewAReceiptByteSha256 = mutateHashNibble(raw.reviewAReceiptByteSha256, 0); else if (mutation === 'raw-review-b-receipt-hash') raw.reviewBReceiptByteSha256 = mutateHashNibble(raw.reviewBReceiptByteSha256, 0); else if (mutation === 'raw-c0-hash') raw.c0LedgerByteSha256 = mutateHashNibble(raw.c0LedgerByteSha256, 0); core.validateProcessArtifact(raw, publicState, raw.artifactType); const rawWrite = writeCanonicalReadOnly(paths['raw-ab-report'], raw);
  skeleton.reviewAReceiptByteSha256 = receiptAWrite.sha256; skeleton.reviewBReceiptByteSha256 = receiptBWrite.sha256; skeleton.rawABReportByteSha256 = rawWrite.sha256; skeleton.c0LedgerByteSha256 = c0Write.sha256; const skeletonWrite = writeCanonicalReadOnly(paths['disagreement-skeleton'], skeleton);
  const actualReceiptFields = { initialSkeletonByteSha256: skeletonWrite.sha256, initialDecisionCount: skeleton.decisions.length, initialUnsetDecisionCount: skeleton.decisions.filter((decision) => stableStringify(decision.decision) === stableStringify({ status: 'UNSET' })).length, accessPolicyByteSha256: sha256(accessPolicyBytes), revealBundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256 };
  Object.assign(revealReceipt, { reviewAReceiptByteSha256: receiptAWrite.sha256, reviewBReceiptByteSha256: receiptBWrite.sha256, rawABReportByteSha256: rawWrite.sha256, c0LedgerByteSha256: c0Write.sha256, ...actualReceiptFields }); if (Object.hasOwn(REVEAL_RECEIPT_SEMANTIC_CODES, mutation)) mutateRevealReceiptSemantic(revealReceipt, mutation, actualReceiptFields); core.validateProcessArtifact(revealReceipt, publicState, revealReceipt.artifactType); const revealReceiptWrite = writeCanonicalReadOnly(paths['reveal-receipt'], revealReceipt);
  const journalPath = path.join(destination, 'mutable/adjudication-journal.json'); const journal = core.parseJsonBuffer(readFileSync(journalPath), { processArtifact: true }); journal.revealReceiptByteSha256 = revealReceiptWrite.sha256; core.validateProcessArtifact(journal, publicState, journal.artifactType); const journalBytes = core.processBytes(journal); writeFileSync(journalPath, journalBytes); chmodSync(journalPath, 0o600);
  const fixedEntries = FIXTURE.sessionTreeContract.revealFixedLogicalPaths.map((logicalPath) => { const bytes = readFileSync(path.join(destination, logicalPath)); return { logicalPath, bytes: bytes.length, sha256: sha256(bytes) }; }); const fixedInputSetSha256 = core.fixedInputSetSha256(fixedEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths });
  const expectedCode = REVEAL_RECEIPT_SEMANTIC_CODES[mutation] ?? REVEAL_FIXED_CROSS_CODES[mutation] ?? REVEAL_RAW_BINDING_CODES[mutation]; const baseResult = { mutation, expectedCode, revealReceiptPath: paths['reveal-receipt'], revealReceiptByteSha256: revealReceiptWrite.sha256, fixedInputSetSha256 };
  if (unsealed) { assert.deepEqual(readdirSync(path.join(destination, 'mutable')), ['adjudication-journal.json']); assert.equal(journal.events.length, 0); return { ...baseResult, unsealed: true, journalByteSha256: sha256(journalBytes) }; }
  const reviewA = core.parseJsonBuffer(readFileSync(path.join(fixed, 'review-a.json'))); const reviewB = core.parseJsonBuffer(readFileSync(path.join(fixed, 'review-b.json'))); const replay = core.replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: revealReceiptWrite.sha256, requireComplete: true });
  const attestationPath = path.join(destination, 'mutable/actor-attestation.json'); const attestationBytes = readFileSync(attestationPath); const accessPath = path.join(destination, 'mutable/access-evidence.json'); const access = core.parseJsonBuffer(readFileSync(accessPath), { processArtifact: true }); Object.assign(access, { fixedInputSetSha256, sessionSeedByteSha256: skeletonWrite.sha256, sessionFinalStateByteSha256: sha256(core.processBytes(replay.finalState)), editJournalByteSha256: sha256(journalBytes), actorAttestationByteSha256: sha256(attestationBytes) }); core.validateProcessArtifact(access, publicState, access.artifactType); const accessBytes = core.processBytes(access); writeFileSync(accessPath, accessBytes); chmodSync(accessPath, 0o600);
  const sessionTreeSha256 = core.sessionTreeSha256({ terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: manifest.presentationContractSha256, bundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256, fixedInputSetSha256, sessionSeedByteSha256: skeletonWrite.sha256, sessionFinalStateByteSha256: access.sessionFinalStateByteSha256, editJournalByteSha256: access.editJournalByteSha256, actorAttestationByteSha256: access.actorAttestationByteSha256, accessEvidenceByteSha256: sha256(accessBytes) });
  return { ...baseResult, sessionTreeSha256, accessEvidenceByteSha256: sha256(accessBytes) };
}

async function testRevealPreReadinessFixedFailures(sourceBundle, publicState) {
  const root = path.join(path.dirname(sourceBundle), 'reveal-pre-readiness-fixed-negatives'); mkdirSync(root, { mode: 0o700 }); const oracle = []; const splitCodes = { cycle: 'reveal_cycle_split_chain_mismatch', actor: 'reveal_actor_split_chain_mismatch', rulebook: 'reveal_rulebook_split_chain_mismatch' };
  for (const [kind, expectedCode] of Object.entries(splitCodes)) {
    const bundle = path.join(root, `split-${kind}`); const mutant = coherentlyResealRevealFixedSplitChain(sourceBundle, bundle, kind, publicState, { unsealed: true }); assert.equal(mutant.unsealed, true); await assertServeRejectedBeforeSpawn(bundle, `reveal-fixed-split-${kind}`, expectedCode, root); assert.deepEqual(readdirSync(path.join(bundle, 'mutable')), ['adjudication-journal.json']); oracle.push({ family: 'split', kind, expectedCode, fixedInputSetSha256: mutant.fixedInputSetSha256, revealReceiptByteSha256: mutant.revealReceiptByteSha256 }); rmSync(bundle, { recursive: true, force: true });
  }
  const semanticCases = [...Object.entries(REVEAL_RECEIPT_SEMANTIC_CODES), ...Object.entries(REVEAL_FIXED_CROSS_CODES), ...Object.entries(REVEAL_RAW_BINDING_CODES)];
  for (const [mutation, expectedCode] of semanticCases) {
    const bundle = path.join(root, `semantic-${mutation}`); const mutant = coherentlyResealRevealSemanticMutation(sourceBundle, bundle, mutation, publicState, { unsealed: true }); assert.equal(mutant.unsealed, true); assert.equal(mutant.expectedCode, expectedCode); await assertServeRejectedBeforeSpawn(bundle, `reveal-fixed-${mutation}`, expectedCode, root); assert.deepEqual(readdirSync(path.join(bundle, 'mutable')), ['adjudication-journal.json']); oracle.push({ family: 'semantic', mutation, expectedCode, fixedInputSetSha256: mutant.fixedInputSetSha256, revealReceiptByteSha256: mutant.revealReceiptByteSha256 }); rmSync(bundle, { recursive: true, force: true });
  }
  evidence.counts.revealPreReadinessSplitChainBranches = Object.keys(splitCodes).length; evidence.counts.revealPreReadinessReceiptSemanticBranches = Object.keys(REVEAL_RECEIPT_SEMANTIC_CODES).length; evidence.counts.revealPreReadinessFixedCrossBranches = Object.keys(REVEAL_FIXED_CROSS_CODES).length; evidence.counts.revealPreReadinessRawBindingBranches = Object.keys(REVEAL_RAW_BINDING_CODES).length; evidence.counts.revealPreReadinessFixedNegativeBranches = oracle.length; evidence.hashes.revealPreReadinessFixedOracleSha256 = core.canonicalHash(oracle); assert.equal(oracle.length, 15); assertNoTransactionResidue(root); assertPublicBytesUnchanged();
}

const ACCESS_EVIDENCE_SEMANTIC_CODES = Object.freeze({ allowlist: 'access_evidence_filesystem_allowlist_invalid', read: 'access_evidence_allowed_read_invalid', write: 'access_evidence_allowed_write_invalid', 'connect-non-loopback': 'access_evidence_allowed_connect_invalid', 'connect-port-overflow-v4': 'access_evidence_allowed_connect_invalid', 'connect-port-overflow-v6': 'access_evidence_allowed_connect_invalid' });

function coherentlyMutateAccessEvidence(sourceBundle, destination, mutation, publicState) {
  cloneBundle(sourceBundle, destination); const manifestPath = path.join(destination, 'immutable/bundle-manifest.json'); const manifestBytes = readFileSync(manifestPath); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true }); const accessPath = path.join(destination, 'mutable/access-evidence.json'); const access = core.parseJsonBuffer(readFileSync(accessPath), { processArtifact: true }); const beforeBindings = Object.fromEntries(['fixedInputSetSha256', 'sessionSeedByteSha256', 'sessionFinalStateByteSha256', 'editJournalByteSha256', 'actorAttestationByteSha256'].map((key) => [key, access[key]]));
  if (mutation === 'allowlist') access.filesystemAllowlist = [...access.filesystemAllowlist, 'undeclared-secret'].sort(rawCompare);
  else { const operation = mutation.startsWith('connect-') ? 'connect' : mutation; const logicalPath = mutation === 'connect-non-loopback' ? '203.0.113.77:443' : mutation === 'connect-port-overflow-v4' ? '127.0.0.1:65536' : mutation === 'connect-port-overflow-v6' ? '::1:65536' : 'undeclared-secret'; access.actualOpenEvents.push({ sequence: access.actualOpenEvents.length + 1, logicalPath, operation, result: 'allowed' }); }
  const validator = createProcessSchemaValidator(SCHEMA_DIR, AUTHORING_SCHEMA); validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), access); core.validateProcessArtifact(access, publicState, access.artifactType); const accessBytes = core.processBytes(access); writeFileSync(accessPath, accessBytes); chmodSync(accessPath, 0o600); assert.deepEqual(Object.fromEntries(Object.keys(beforeBindings).map((key) => [key, access[key]])), beforeBindings);
  const sessionTreeSha256 = core.sessionTreeSha256({ terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: manifest.presentationContractSha256, bundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256, ...beforeBindings, accessEvidenceByteSha256: sha256(accessBytes) });
  return { mutation, expectedCode: ACCESS_EVIDENCE_SEMANTIC_CODES[mutation], sessionTreeSha256, accessEvidenceByteSha256: sha256(accessBytes), preservedBindingSha256: core.canonicalHash(beforeBindings) };
}

function coherentlyReplaceSealedMutableTree(bundle, publicState, retainedH1) {
  const manifestBytes = readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true }); const mutable = path.join(bundle, 'mutable'); const replacement = path.join(bundle, 'mutable-h2-stage'); const old = path.join(bundle, 'mutable-h1-old');
  assert.equal(pathExists(replacement), false); assert.equal(pathExists(old), false); mkdirSync(replacement, { mode: 0o700 });
  const journalName = manifest.mode === 'adjudication-reveal' ? 'adjudication-journal.json' : 'edit-journal.json'; const journal = core.parseJsonBuffer(readFileSync(path.join(mutable, journalName)), { processArtifact: true });
  journal.events.push({ sequence: journal.events.length + 1, action: 'navigate', clipId: publicState.decoderRows[0].clipId, sourceFrameIndex: publicState.decoderRows[0].sourceFrameIndex }); const journalBytes = core.processBytes(journal);
  const attestationBytes = readFileSync(path.join(mutable, 'actor-attestation.json')); const access = core.parseJsonBuffer(readFileSync(path.join(mutable, 'access-evidence.json')), { processArtifact: true });
  if (manifest.mode === 'adjudication-reveal') {
    const fixedEntries = FIXTURE.sessionTreeContract.revealFixedLogicalPaths.map((logicalPath) => { const bytes = readFileSync(path.join(bundle, logicalPath)); return { logicalPath, bytes: bytes.length, sha256: sha256(bytes) }; });
    const skeletonBytes = readFileSync(path.join(bundle, 'fixed/disagreement-skeleton.json')); const skeleton = core.parseJsonBuffer(skeletonBytes, { processArtifact: true }); const reviewA = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-a.json'))); const reviewB = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-b.json'))); const c0 = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/c0-ledger.json')), { processArtifact: true });
    const replayed = core.replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: journal.revealReceiptByteSha256, requireComplete: true });
    access.fixedInputSetSha256 = core.fixedInputSetSha256(fixedEntries, { expectedLogicalPaths: FIXTURE.sessionTreeContract.revealFixedLogicalPaths }); access.sessionSeedByteSha256 = sha256(skeletonBytes); access.sessionFinalStateByteSha256 = sha256(core.processBytes(replayed.finalState));
  } else {
    const seedBytes = readFileSync(path.join(mutable, 'worksheet-seed.json')); const seed = core.parseJsonBuffer(seedBytes, { processArtifact: true }); const finalWorksheet = core.replayWorksheetJournal(seed, journal, publicState, { requireComplete: true });
    access.fixedInputSetSha256 = core.fixedInputSetSha256([]); access.sessionSeedByteSha256 = sha256(seedBytes); access.sessionFinalStateByteSha256 = sha256(core.processBytes(finalWorksheet));
  }
  access.editJournalByteSha256 = sha256(journalBytes); access.actorAttestationByteSha256 = sha256(attestationBytes); const accessBytes = core.processBytes(access);
  if (manifest.mode !== 'adjudication-reveal') copyFileSync(path.join(mutable, 'worksheet-seed.json'), path.join(replacement, 'worksheet-seed.json'), fsConstants.COPYFILE_EXCL);
  writeFileSync(path.join(replacement, journalName), journalBytes, { mode: 0o600 }); writeFileSync(path.join(replacement, 'actor-attestation.json'), attestationBytes, { mode: 0o600 }); writeFileSync(path.join(replacement, 'access-evidence.json'), accessBytes, { mode: 0o600 });
  for (const name of readdirSync(replacement)) chmodSync(path.join(replacement, name), 0o600);
  renameSync(mutable, old); renameSync(replacement, mutable); rmSync(old, { recursive: true, force: false });
  const expectedMembers = manifest.mode === 'adjudication-reveal' ? ['access-evidence.json', 'actor-attestation.json', 'adjudication-journal.json'] : ['access-evidence.json', 'actor-attestation.json', 'edit-journal.json', 'worksheet-seed.json']; assert.deepEqual(readdirSync(mutable).sort(rawCompare), expectedMembers);
  const validator = createProcessSchemaValidator(SCHEMA_DIR, AUTHORING_SCHEMA); validator.validate(path.join(SCHEMA_DIR, 'edit-journal-v1.schema.json'), journal); validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), access); core.validateProcessArtifact(journal, publicState, journal.artifactType); core.validateProcessArtifact(access, publicState, access.artifactType);
  const h2 = core.sessionTreeSha256({
    terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: manifest.presentationContractSha256,
    bundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256, fixedInputSetSha256: access.fixedInputSetSha256,
    sessionSeedByteSha256: access.sessionSeedByteSha256, sessionFinalStateByteSha256: access.sessionFinalStateByteSha256, editJournalByteSha256: access.editJournalByteSha256,
    actorAttestationByteSha256: access.actorAttestationByteSha256, accessEvidenceByteSha256: sha256(accessBytes),
  });
  assert.notEqual(h2, retainedH1); return { h2, journalByteSha256: sha256(journalBytes), accessEvidenceByteSha256: sha256(accessBytes) };
}

function completeJournalEvents(publicState, actor) {
  const events = []; const rowsByClip = new Map(publicState.sourceInventory.paired.map((source) => [source.clipId, publicState.decoderRows.filter((row) => row.clipId === source.clipId)]));
  const add = (clipId, start, end, fieldPath, valueType, value) => events.push({ sequence: events.length + 1, action: 'set', actorPseudonymSha256: actor, clipId, startFrameIndex: start, endFrameIndexExclusive: end, fieldPath, valueType, value: clone(value), lockedIdentity: exactIdentity(rowsByClip.get(clipId)[start]) });
  for (const source of publicState.sourceInventory.paired) {
    const clipId = source.clipId; const end = source.decoderRowCount; const target = `target-${clipId}`;
    add(clipId, 0, end, 'scenarios', 'scenario-array', ['neutral']); add(clipId, 0, end, 'presence', 'presence', 'present'); add(clipId, 0, end, 'personState', 'person-state', 'single_target');
    for (const field of ['body', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand']) add(clipId, 0, end, `occlusion/${field}`, 'occlusion-state', 'observable');
    for (const side of ['left', 'right']) add(clipId, 0, end, `contact/${side}`, 'contact-state', 'moving');
    for (const side of ['left', 'right']) add(clipId, 0, end, `handObservability/${side}`, 'hand-observability-state', 'observable');
    for (const field of ['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle', 'head']) add(clipId, 0, end, `endpointObservability/${field}`, 'endpoint-observability-state', 'observable');
    add(clipId, 0, end, 'subjectSelection/state', 'subject-state', 'selected'); add(clipId, 0, end, 'subjectSelection/manualTargetId', 'manual-target-id', target); add(clipId, 0, end, 'subjectSelection/anchor', 'anchor', null);
    const half = Math.floor(end / 2); for (const side of ['left', 'right']) add(clipId, 0, half, `contact/${side}`, 'contact-state', 'planted');
    add(clipId, 0, end, `/windowsById/base-${clipId}/scenarioTags`, 'scenario-array', ['neutral']);
  }
  for (const [clipId, runs] of Object.entries(REACQUIRE_RUNS)) for (const [start, end] of runs) {
    add(clipId, start, end, 'scenarios', 'scenario-array', ['entry_exit', 'reacquire']); add(clipId, start, end, 'presence', 'presence', 'absent'); add(clipId, start, end, 'personState', 'person-state', 'absent');
    for (const field of ['body', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand']) add(clipId, start, end, `occlusion/${field}`, 'occlusion-state', 'out_of_frame');
    for (const side of ['left', 'right']) add(clipId, start, end, `contact/${side}`, 'contact-state', 'unknown');
    for (const side of ['left', 'right']) add(clipId, start, end, `handObservability/${side}`, 'hand-observability-state', 'not_observable');
    for (const field of ['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle', 'head']) add(clipId, start, end, `endpointObservability/${field}`, 'endpoint-observability-state', 'not_observable');
    add(clipId, start, end, 'subjectSelection/state', 'subject-state', 'absent'); add(clipId, start, end, 'subjectSelection/manualTargetId', 'manual-target-id', null); add(clipId, start, end, 'subjectSelection/anchor', 'anchor', null);
  }
  return events;
}

async function assertServeRejectedBeforeSpawn(bundle, name, expectedCode, monitorRoot) {
  mkdirSync(monitorRoot, { recursive: true, mode: 0o700 }); const preloadPath = path.join(monitorRoot, 'spawn-monitor.cjs'); if (!pathExists(preloadPath)) writeFileSync(preloadPath, [
    "'use strict';", "const childProcess = require('node:child_process');", "const fs = require('node:fs');",
    "for (const method of ['spawn', 'spawnSync']) { const original = childProcess[method]; childProcess[method] = function monitoredSpawn(...args) { fs.appendFileSync(process.env.SAM_GOAL_TEST_SPAWN_MARKER, `${method}\\n`); return original.apply(this, args); }; }",
    "require('node:module').syncBuiltinESMExports();", '',
  ].join('\n'), { mode: 0o600 });
  const spawnMarker = path.join(monitorRoot, `${name.replaceAll(/[^A-Za-z0-9._-]/gu, '-')}.spawned`); const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`].filter(Boolean).join(' '); const result = await runAsyncProcess(process.execPath, [CLI, 'serve', '--bundle-dir', bundle], { env: { ...process.env, NODE_ENV: 'test', NODE_OPTIONS: nodeOptions, SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', SAM_GOAL_MANUAL_REVIEW_OPS_V1_SERVE_TEST: 'startup-hang', SAM_GOAL_TEST_SPAWN_MARKER: spawnMarker }, timeoutMs: 20_000 });
  assert.equal(result.timedOut, false, `${name}: pre-readiness rejection timed out`); assert.notEqual(result.status, 0, `${name}: invalid bundle reached serve`); assert.equal(result.stdout, '', `${name}: pre-readiness stdout leaked`); assert.equal(result.stderr.includes('review_ui_ready'), false, `${name}: readiness leaked`); assert.equal(pathExists(spawnMarker), false, `${name}: child spawned before coordinator rejection`); const failures = parseChildJsonLines({ stdout: '', stderr: result.stderr }).filter((item) => typeof item?.code === 'string'); assert.equal(failures.length, 1, `${name}: ${result.stderr}`); assert.equal(failures[0].code, expectedCode, `${name}: ${result.stderr}`); assert.equal(pathExists(path.join(bundle, 'mutable/actor-attestation.json')), false); assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false); assertNoTransactionResidue(bundle); evidence.exactFirstCodes[`serve:pre-readiness:${name}`] = failures[0].code; evidence.cases.expectedFailures += 1; return failures[0];
}

async function testBlindOfflinePrefillRejected(baseBundle, publicState) {
  const root = path.join(path.dirname(baseBundle), 'offline-prefill-rejected'); const bundle = path.join(root, 'blind'); mkdirSync(root, { mode: 0o700 }); cloneBundle(baseBundle, bundle); const manifestBytes = readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true }); const events = completeJournalEvents(publicState, manifest.actorPseudonymSha256); assert.equal(events.length, 221); const journal = processDocument('sam-goal-review-edit-journal-v1', { cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, bundleManifestByteSha256: sha256(manifestBytes), events }); const seed = core.parseJsonBuffer(readFileSync(path.join(bundle, 'mutable/worksheet-seed.json')), { processArtifact: true }); core.replayWorksheetJournal(seed, journal, publicState, { requireComplete: true }); const journalBytes = core.processBytes(journal); writeFileSync(path.join(bundle, 'mutable/edit-journal.json'), journalBytes); chmodSync(path.join(bundle, 'mutable/edit-journal.json'), 0o600);
  await assertServeRejectedBeforeSpawn(bundle, 'offline-prefill-rejected:blind', 'bundle_initial_mutable_state_invalid', root); evidence.counts.blindOfflinePrefillRejectedEvents = events.length; evidence.hashes.blindOfflinePrefillRejectedJournalSha256 = sha256(journalBytes); rmSync(bundle, { recursive: true, force: true });
}

function installRevealOfflinePrefill(bundle, publicState) {
  const manifest = core.parseJsonBuffer(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')), { processArtifact: true }); const skeleton = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/disagreement-skeleton.json')), { processArtifact: true }); const reviewA = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-a.json'))); const reviewB = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-b.json'))); const c0 = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/c0-ledger.json')), { processArtifact: true }); const revealReceiptByteSha256 = sha256(readFileSync(path.join(bundle, 'fixed/reveal-receipt.json'))); const events = [];
  for (const disagreement of skeleton.disagreements) events.push({ sequence: events.length + 1, action: 'set-decision', actorPseudonymSha256: manifest.actorPseudonymSha256, path: disagreement.path, valueType: disagreement.valueType, decision: clone(disagreement.reviewAValue) });
  const makeJournal = () => processDocument('sam-goal-review-edit-journal-v1', { cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, bundleManifestByteSha256: sha256(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json'))), revealReceiptByteSha256, events: clone(events) }); const decided = core.replayAdjudicationJournal({ journal: makeJournal(), skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: revealReceiptByteSha256 });
  for (const record of decided.finalState.dispositionRecords) { const disposition = FIXTURE.classDispositions[record.deviationClass]; assert.equal(typeof disposition, 'string'); events.push({ sequence: events.length + 1, action: 'set-disposition', actorPseudonymSha256: manifest.actorPseudonymSha256, coordinateKind: record.coordinateKind, path: record.path, deviationClass: record.deviationClass, disposition, rationale: `offline prefill source rationale for ${record.deviationClass}` }); }
  const journal = makeJournal(); core.replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState, expectedActorPseudonym: manifest.actorPseudonymSha256, expectedRevealReceiptByteSha256: revealReceiptByteSha256, requireComplete: true }); const bytes = core.processBytes(journal); writeFileSync(path.join(bundle, 'mutable/adjudication-journal.json'), bytes); chmodSync(path.join(bundle, 'mutable/adjudication-journal.json'), 0o600); return { events, bytes };
}

async function testRevealOfflinePrefillRejected(baseBundle, publicState) {
  const root = path.join(path.dirname(baseBundle), 'offline-prefill-rejected-reveal'); const bundle = path.join(root, 'reveal'); mkdirSync(root, { mode: 0o700 }); cloneBundle(baseBundle, bundle); const prefill = installRevealOfflinePrefill(bundle, publicState); assert.ok(prefill.events.length > 0); await assertServeRejectedBeforeSpawn(bundle, 'offline-prefill-rejected:reveal', 'bundle_initial_mutable_state_invalid', root); evidence.counts.revealOfflinePrefillRejectedEvents = prefill.events.length; evidence.hashes.revealOfflinePrefillRejectedJournalSha256 = sha256(prefill.bytes); rmSync(bundle, { recursive: true, force: true });
}

async function completeBlindSessionThroughRuntime(server, session, bundle, actor, publicState, { alternate = false } = {}) {
  const manifestResponse = await fetchJsonResponse(server.base, '/api/manifest'); assert.equal(manifestResponse.status, 200); const manifest = manifestResponse.value; const inventory = readJson(path.join(bundle, 'immutable/authority/source-inventory.json')); const events = completeJournalEvents(publicState, actor); assert.equal(events.length, 221, 'closed-loop blind session event count drift');
  if (alternate) events.find((event) => event.fieldPath.endsWith('/scenarioTags')).value = ['fast_motion']; const rowsByIdentity = new Map(publicState.decoderRows.map((row) => [`${row.clipId}\0${row.sourceFrameIndex}`, row]));
  for (const expectedEvent of events) {
    const row = rowsByIdentity.get(`${expectedEvent.lockedIdentity.clipId}\0${expectedEvent.lockedIdentity.sourceFrameIndex}`); assert.ok(row, `missing locked row for event ${expectedEvent.sequence}`); const generation = session.generationBase + expectedEvent.sequence; const lock = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row, generation, manifest, inventory) }); assert.equal(lock.status, 200, stableStringify(lock.value)); assert.equal(lock.value.status, 'exact_frame_lock_issued');
    const { sequence, ...action } = expectedEvent; const edit = await fetchJsonResponse(server.base, '/api/edit', { method: 'POST', session, body: { ...action, clientGeneration: generation, lockNonce: lock.value.lockNonce } }); assert.equal(edit.status, 200, stableStringify(edit.value)); assert.equal(edit.value.status, 'explicit_edit_recorded'); assert.equal(edit.value.sequence, sequence);
  }
  const journalPath = path.join(bundle, 'mutable/edit-journal.json'); const journalBytes = readFileSync(journalPath); const journal = core.parseJsonBuffer(journalBytes, { processArtifact: true }); const manifestByteSha256 = sha256(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json'))); const expectedJournal = processDocument('sam-goal-review-edit-journal-v1', { cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: actor, bundleManifestByteSha256: manifestByteSha256, events }); assert.equal(journalBytes.equals(core.processBytes(expectedJournal)), true, 'runtime journal canonical bytes differ from exact API event oracle'); const seed = core.parseJsonBuffer(readFileSync(path.join(bundle, 'mutable/worksheet-seed.json')), { processArtifact: true }); const finalWorksheet = core.replayWorksheetJournal(seed, journal, publicState, { requireComplete: true }); const runtimeWorksheet = await fetchJsonResponse(server.base, '/api/worksheet'); assert.equal(runtimeWorksheet.status, 200); assert.equal(core.processBytes(runtimeWorksheet.value).equals(core.processBytes(finalWorksheet)), true, 'runtime worksheet canonical bytes differ from independent complete replay');
  bump(evidence.counts, 'blindRuntimeSessions'); bump(evidence.counts, 'blindRuntimeLockEvents', events.length); bump(evidence.counts, 'blindRuntimeEditEvents', events.length); evidence.hashes[`blindRuntimeJournal${manifest.mode.replaceAll('-', '_')}Sha256`] = sha256(journalBytes); return { events, journal, journalBytes, finalWorksheet };
}

function directChildPids(parentPid) {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); return result.stdout.split(/\r?\n/u).map((line) => line.trim().split(/\s+/u).map(Number)).filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid) && ppid === parentPid).map(([pid]) => pid);
}

async function sealBundleSession(bundle, actor, publicState, { alternate = false, delayedAckBarrier = false } = {}) {
  const barrier = path.join(path.dirname(bundle), `.${path.basename(bundle)}.ack-delay.barrier`); const release = path.join(path.dirname(bundle), `.${path.basename(bundle)}.ack-delay.release`); if (delayedAckBarrier) { assert.equal(pathExists(barrier), false); assert.equal(pathExists(release), false); }
  const server = await startServe(bundle, delayedAckBarrier ? { SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_BARRIER_PATH: barrier, SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_RELEASE_PATH: release } : {}); const session = await bootstrapSession(server); const manifest = core.parseJsonBuffer(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')), { processArtifact: true });
  const blindRuntime = manifest.mode === 'adjudication-reveal' ? null : await completeBlindSessionThroughRuntime(server, session, bundle, actor, publicState, { alternate }); if (manifest.mode === 'adjudication-reveal') await completeRevealSessionThroughRuntime(server, session, bundle, actor, publicState);
  const attest = await fetchJsonResponse(server.base, '/api/attest', { method: 'POST', session, body: { actorPseudonymSha256: actor, actorDeclaredNoOutsideInput: true, cycleId: manifest.cycleId } }); assert.equal(attest.value.status, 'actor_attestation_recorded');
  assert.equal(Buffer.concat(server.stdout).length, 0, 'serve stdout must remain empty before final child reap');
  const waiting = server.wait(); const endPromise = fetchJsonResponse(server.base, '/api/end-session', { method: 'POST', session, body: {} }); let end;
  if (delayedAckBarrier) {
    await waitForCanonicalBarrier(barrier, server.child, 20_000); assert.equal(permissionBits(barrier), 0o600); end = await endPromise; assert.equal(end.value.status, 'access_evidence_sealed'); const descendants = directChildPids(server.child.pid); assert.equal(descendants.length, 1, `expected one live launcher before delayed ACK release: ${descendants.join(',')}`); const delayStart = performance.now(); await new Promise((resolve) => setTimeout(resolve, 11_000)); const delayMs = performance.now() - delayStart; assert.ok(delayMs >= 11_000, `ACK delay too short: ${delayMs}`); assert.equal(server.child.exitCode, null); assert.equal(server.child.signalCode, null); assert.equal(Buffer.concat(server.stdout).length, 0, 'seal envelope emitted before delayed ACK release'); assert.equal(pathExists(barrier), true); assert.equal(pathExists(release), false); assert.deepEqual(directChildPids(server.child.pid), descendants); for (const pid of descendants) process.kill(pid, 0); writeFileSync(release, 'release\n', { mode: 0o600 }); evidence.delayedAckBarrier = { delayMs, coordinatorAliveBeforeRelease: true, launcherAliveBeforeRelease: true, stdoutBytesBeforeRelease: 0 };
  } else { end = await endPromise; assert.equal(end.value.status, 'access_evidence_sealed'); }
  const exit = await waiting; const envelope = sealedEnvelopeFromExit(exit); if (delayedAckBarrier) { assert.equal(pathExists(barrier), false); assert.equal(pathExists(release), false); evidence.delayedAckBarrier = { ...evidence.delayedAckBarrier, exitStatus: exit.status, exitSignal: exit.signal, sealEnvelopeStatus: envelope.status }; bump(evidence.counts, 'delayedAckOverTenSecondSealBranches'); }
  const access = core.parseJsonBuffer(readFileSync(path.join(bundle, 'mutable/access-evidence.json')), { processArtifact: true }); const validator = createProcessSchemaValidator(SCHEMA_DIR, AUTHORING_SCHEMA); validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), access); core.validateProcessArtifact(access, publicState, access.artifactType); const sessionTreeSha256 = assertSealBindsTree(bundle, access, envelope); const registryCounts = assertIndependentAccessEventRegistry(bundle, access, { requireFrameLock: manifest.mode !== 'adjudication-reveal', requireJournalTemp: true }); if (blindRuntime) { assert.ok((registryCounts.lock ?? 0) >= blindRuntime.events.length, 'runtime lock evidence count too small'); assert.ok((registryCounts.write ?? 0) >= blindRuntime.events.length, 'runtime journal write evidence count too small'); } evidence.counts.launcherAllowedEventRegistryEntries = (evidence.counts.launcherAllowedEventRegistryEntries ?? 0) + Object.values(registryCounts).reduce((sum, count) => sum + count, 0);
  const journalPath = path.join(bundle, 'mutable', manifest.mode === 'adjudication-reveal' ? 'adjudication-journal.json' : 'edit-journal.json'); const journalBytes = readFileSync(journalPath); return { access, envelope, sessionTreeSha256, journalByteSha256: sha256(journalBytes), journalBytes };
}

async function completeRevealSessionThroughRuntime(server, session, bundle, actor, publicState) {
  const skeleton = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/disagreement-skeleton.json')), { processArtifact: true });
  const reviewA = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-a.json'))); const reviewB = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/review-b.json'))); const c0 = core.parseJsonBuffer(readFileSync(path.join(bundle, 'fixed/c0-ledger.json')), { processArtifact: true });
  const journalPath = path.join(bundle, 'mutable/adjudication-journal.json'); const receiptHash = sha256(readFileSync(path.join(bundle, 'fixed/reveal-receipt.json'))); let generation = session.generationBase;
  const postAction = async (action) => {
    const response = await fetchJsonResponse(server.base, '/api/edit', { method: 'POST', session, body: { ...action, actorPseudonymSha256: actor, clientGeneration: ++generation } });
    assert.equal(response.status, 200, stableStringify(response.value)); assert.equal(response.value.status, 'explicit_adjudication_recorded'); return response.value;
  };
  const replay = (requireComplete = false) => core.replayAdjudicationJournal({
    journal: core.parseJsonBuffer(readFileSync(journalPath), { processArtifact: true }), skeleton, reviewA, reviewB, c0Rows: c0.rows, c0Windows: c0.windows, publicState,
    expectedActorPseudonym: actor, expectedRevealReceiptByteSha256: receiptHash, requireComplete,
  });
  const approveCurrentCoordinates = async () => {
    const current = replay();
    for (const record of current.finalState.dispositionRecords) {
      const disposition = FIXTURE.classDispositions[record.deviationClass]; assert.equal(typeof disposition, 'string', `missing disposition for ${record.deviationClass}`);
      await postAction({ action: 'set-disposition', coordinateKind: record.coordinateKind, path: record.path, deviationClass: record.deviationClass, disposition, rationale: `runtime source adjudication for ${record.deviationClass}` });
    }
  };

  assert.ok(skeleton.disagreements.length > 0, 'closed-loop reveal runtime must exercise a real A/B disagreement');
  for (const disagreement of skeleton.disagreements) await postAction({ action: 'set-decision', path: disagreement.path, valueType: disagreement.valueType, decision: clone(disagreement.reviewAValue) });
  const decisionsOnly = replay(); assert.equal(decisionsOnly.decisionsComplete, true); assert.equal(decisionsOnly.dispositionsComplete, false); assert.ok(decisionsOnly.finalState.dispositionRecords.length > 0);
  await approveCurrentCoordinates(); assert.equal(replay(true).complete, true);

  const changed = skeleton.disagreements[0]; const changedResponse = await postAction({ action: 'set-decision', path: changed.path, valueType: changed.valueType, decision: clone(changed.reviewBValue) }); assert.equal(changedResponse.dispositionsComplete, false);
  const resetView = await fetchJsonResponse(server.base, '/api/worksheet'); assert.equal(resetView.status, 200); assert.ok(resetView.value.dispositionRecords.length > 0); for (const record of resetView.value.dispositionRecords) { assert.deepEqual(record.disposition, { status: 'UNSET' }); assert.deepEqual(record.rationale, { status: 'UNSET' }); }
  const restoredResponse = await postAction({ action: 'set-decision', path: changed.path, valueType: changed.valueType, decision: clone(changed.reviewAValue) }); assert.equal(restoredResponse.dispositionsComplete, false);
  await approveCurrentCoordinates(); const finalReplay = replay(true); assert.equal(finalReplay.complete, true);
  evidence.counts.revealRuntimeDecisionEvents = skeleton.disagreements.length + 2; evidence.counts.revealRuntimeDispositionEvents = finalReplay.finalState.dispositionRecords.length * 2; evidence.counts.revealRuntimeGlobalResetRecords = resetView.value.dispositionRecords.length;
}

async function runCliSuccess(args, env = {}) {
  const result = await runAsyncProcess(process.execPath, [CLI, ...args], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', ...env }, timeoutMs: 60_000 }); assert.equal(result.timedOut, false); assert.equal(result.status, 0, result.stderr || result.stdout);
  const values = parseChildJsonLines(result); const success = values.at(-1); assert.ok(success && typeof success.status === 'string', `missing CLI success envelope: ${result.stdout}\n${result.stderr}`); return { result, success, values };
}

async function runCliExpectedFailureAsync(args, expectedCode, env = {}) {
  const result = await runAsyncProcess(process.execPath, [CLI, ...args], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', ...env }, timeoutMs: 60_000 }); assert.equal(result.timedOut, false); assert.notEqual(result.status, 0, `CLI unexpectedly passed: ${args.join(' ')}`);
  const failure = parseChildJsonLines(result).find((item) => typeof item?.code === 'string'); assert.ok(failure, `missing failure envelope: ${result.stdout}\n${result.stderr}`); assert.equal(failure.code, expectedCode); evidence.exactFirstCodes[`cli-runtime:${expectedCode}:${Object.keys(env).sort().join(',') || 'plain'}`] = failure.code; evidence.cases.expectedFailures += 1; return { result, failure };
}

function filesRecursive(root) {
  const result = []; const visit = (directory) => { for (const name of readdirSync(directory)) { const filePath = path.join(directory, name); const status = lstatSync(filePath); if (status.isDirectory() && !status.isSymbolicLink()) visit(filePath); else result.push(filePath); } }; visit(root); return result;
}

function exactOneFile(root, predicate, label) { const matches = filesRecursive(root).filter(predicate); assert.equal(matches.length, 1, `${label}: ${matches.join(',')}`); return matches[0]; }

function assertHeadedPhysicalRasterAuthority(authority) {
  assert.equal(authority.authority, 'measured-F-exact-white-safe-interior-v2'); assert.equal(authority.authorityVersion, authority.authority); assert.deepEqual(Object.keys(authority.domains), ['D', 'C', 'E', 'G', 'deviceScaleFactor', 'definitions']); const { D, C, E, G } = authority.domains; assert.deepEqual(C, { x: D.x + 1, y: D.y + 1, width: D.width - 2, height: D.height - 2 }); assert.deepEqual(E, { x: D.x - 1, y: D.y - 1, width: D.width + 2, height: D.height + 2 }); assert.deepEqual(G, { x: D.x - 2, y: D.y - 2, width: D.width + 4, height: D.height + 4 }); assert.ok(authority.F.changedPixels > 0); assert.equal(authority.F.deltaThreshold, 0); assert.equal(authority.F.observedPixelsRectangular, true); assert.equal(authority.F.rowSpanMetrics.holeFreeRectangular, true); assert.match(authority.F.maskCanonicalSha256, SHA); assert.match(authority.F.rowSpanCanonicalSha256, SHA); assert.equal(authority.FThreshold2.deltaThreshold, 2); assert.equal(authority.FThreshold2.changedPixels, authority.F.changedPixels); assert.deepEqual(authority.FThreshold2.observedCoverageBbox, authority.F.observedCoverageBbox); assert.equal(authority.FThreshold2.maskCanonicalSha256, authority.F.maskCanonicalSha256); assert.equal(authority.FThreshold2.rowSpanCanonicalSha256, authority.F.rowSpanCanonicalSha256); assert.equal(authority.thresholdMasksByteExact, true); assert.deepEqual(authority.safeInterior, authority.F.observedCoverageBbox); assert.equal(authority.safeInterior.width * authority.safeInterior.height, authority.F.changedPixels); assert.equal(authority.solidWhiteOracle.authorityVersion, authority.authorityVersion); assert.equal(authority.solidWhiteOracle.comparison, 'every-measured-F-rgb-byte-equals-255'); assert.deepEqual(authority.solidWhiteOracle.region, authority.safeInterior); assert.equal(authority.solidWhiteOracle.pixels, authority.F.changedPixels); assert.deepEqual(authority.solidWhiteOracle.expectedRgb, [255, 255, 255]); assert.equal(authority.solidWhiteOracle.mismatchPixels, 0); assert.equal(authority.solidWhiteOracle.mismatchBbox, null); assert.equal(authority.solidWhiteOracle.actualRgbSha256, authority.solidWhiteOracle.expectedRgbSha256); assert.equal(authority.solidWhiteOracle.exact, true); assert.equal(authority.gMinusFBackgroundOracle.authorityVersion, authority.authorityVersion); assert.equal(authority.gMinusFBackgroundOracle.comparison, 'every-G-minus-F-rgb-byte-equals-background'); assert.deepEqual(authority.gMinusFBackgroundOracle.region, G); assert.deepEqual(authority.gMinusFBackgroundOracle.excludedRegion, authority.safeInterior); assert.equal(authority.gMinusFBackgroundOracle.pixels, G.width * G.height - authority.F.changedPixels); assert.equal(authority.gMinusFBackgroundOracle.mismatchPixels, 0); assert.equal(authority.gMinusFBackgroundOracle.mismatchBbox, null); assert.equal(authority.gMinusFBackgroundOracle.backgroundRgbSha256, authority.gMinusFBackgroundOracle.solidRgbSha256); assert.equal(authority.gMinusFBackgroundOracle.exact, true); assert.equal(authority.nominalDAuthority, false); assert.equal(authority.nominalCAuthority, false); assert.equal(authority.edgeVsDDevicePixelsDiagnosticOnly, true); for (const value of Object.values(authority.edgeVsDDevicePixels)) assert.ok(Number.isSafeInteger(value)); assert.deepEqual(authority.constraints, { nonempty: true, holeFreeRectangular: true, thresholdZeroAndTwoMasksExact: true, safeInteriorEqualsMeasuredF: true, solidSafeInteriorExactOpaqueWhite: true, gMinusFBackgroundByteExact: true, physicalMaskSubsetExpandedEnvelope: true, guardExteriorUntouched: true, nominalDAuthority: false, nominalCAuthority: false, edgeVsDDevicePixelsDiagnosticOnly: true });
}

function assertHeadedFrozenNonceLayoutMetrics(metrics) {
  assert.deepEqual(Object.keys(metrics), ['hostRectExact', 'canvasViewportRectExact', 'backingStoreExact', 'paintedDomStripeCount', 'visualExact', 'noPseudoOverlay', 'readbackExact', 'boundariesStrict', 'formalZIndexExact', 'hostZIndexExact', 'canvasZIndexExact']);
  assert.equal(metrics.paintedDomStripeCount, 0);
  for (const key of Object.keys(metrics).filter((key) => key !== 'paintedDomStripeCount')) assert.equal(metrics[key], true, `frozen nonce metric ${key}`);
}

function assertHeadedAlignedFormalTrace(trace, dpr, label) {
  assert.equal(trace.formal.raw.hasAttribute, true, `${label}: formal raw style`); assert.equal(trace.formal.inline.display, 'block', `${label}: inline display`); assert.equal(trace.formal.inline.width, '324px', `${label}: inline width`); assert.equal(trace.formal.inline.height, '576px', `${label}: inline height`); assert.equal(trace.formal.inline.maxWidth, 'none', `${label}: inline max-width`); assert.equal(trace.formal.inline.maxHeight, 'none', `${label}: inline max-height`); assert.equal(trace.formal.inline.position, 'relative', `${label}: inline position`); assert.equal(Number.parseFloat(trace.formal.inline.top), trace.formal.rect.top - trace.stage.rect.top, `${label}: exact formal snap inline binding`); assert.equal(trace.formal.computed.width, '324px', `${label}: computed width`); assert.equal(trace.formal.computed.height, '576px', `${label}: computed height`); assert.equal(trace.formal.computed.maxWidth, 'none', `${label}: computed max-width`); assert.equal(trace.formal.computed.maxHeight, 'none', `${label}: computed max-height`); assert.equal(trace.stage.inline.alignItems, 'flex-start', `${label}: stage inline align-items`); assert.equal(trace.stage.computed.alignItems, 'flex-start', `${label}: stage computed align-items`); assert.equal(trace.formal.rect.width, 324, `${label}: rect width`); assert.equal(trace.formal.rect.height, 576, `${label}: rect height`); assert.deepEqual(trace.projection.formalRect, trace.formal.rect); assert.deepEqual(trace.projection.geometry.targetRect, trace.formal.rect); assert.equal(trace.projection.geometry.dpr, dpr); for (const value of [trace.formal.rect.left, trace.formal.rect.top, trace.formal.rect.right, trace.formal.rect.bottom]) assert.ok(Math.abs(value * dpr - Math.round(value * dpr)) < 1e-6, `${label}: physical edge alignment`);
}

function assertHeadedCspStyleReplayEvidence(replay, { currentHasAttribute, finalWriteKind }) {
  assert.equal(replay.authorityVersion, 'csp-aware-raw-style-attribute-replay-v1');
  assert.equal(replay.source, 'raw-style-attribute-not-historical-cssom');
  assert.equal(replay.replayOrder, 'current-raw-aware-preparation-then-tristate-final-write-v3');
  assert.equal(replay.finalWriteKind, finalWriteKind);
  assert.equal(replay.clearBeforeReplayExact, true);
  assert.equal(replay.rawExact, true);
  assert.equal(replay.cssomExact, true);
  assert.equal(replay.currentRaw.hasAttribute, currentHasAttribute);
  assert.equal(replay.cssomClearWriteApplied, currentHasAttribute);
  assert.equal(replay.clearMode, currentHasAttribute ? 'current-present-cssom-write' : 'current-absent-read-only');
  assert.equal(typeof replay.preReplayCssText, 'string');
  if (currentHasAttribute) {
    assert.equal(typeof replay.currentRaw.attribute, 'string');
    assert.deepEqual(replay.clearState, { hasAttribute: true, attribute: '', cssText: '' });
  } else {
    assert.deepEqual(replay.currentRaw, { hasAttribute: false, attribute: null });
    assert.equal(replay.preReplayCssText, '');
    assert.deepEqual(replay.clearState, { hasAttribute: false, attribute: null, cssText: '' });
  }
}

function assertHeadedCspStyleReplayOracle(oracle) {
  assert.equal(oracle.authorityVersion, 'csp-aware-raw-style-replay-chrome-regression-v1');
  assert.equal(oracle.replayAuthorityVersion, 'csp-aware-raw-style-attribute-replay-v1');
  assert.equal(oracle.source, 'raw-style-attribute-not-historical-cssom');
  assert.equal(oracle.triStateExact, true);
  assert.equal(oracle.rawAndCssomExact, true);
  assert.equal(oracle.immediateToSettledExact, true);
  assert.equal(oracle.activeComputedGeometryExact, true);
  assert.equal(oracle.captureEpochExact, true);
  assert.equal(oracle.rafCount, 2);
  assert.equal(oracle.probeRemoved, true);
  assert.equal(oracle.probeCountAfter, 0);
  const tri = oracle.triState;
  assert.equal(tri.expectedNonempty, 'position: absolute; left: 0px; top: 0px; width: 1px; height: 1px;');
  assert.deepEqual(tri.absent.raw, { hasAttribute: false, attribute: null, cssText: '' });
  assert.deepEqual(tri.empty.raw, { hasAttribute: true, attribute: '', cssText: '' });
  assert.deepEqual(tri.nonempty.raw, { hasAttribute: true, attribute: tri.expectedNonempty, cssText: tri.expectedNonempty });
  assert.deepEqual(tri.nonempty.computed, { position: 'absolute', left: '0px', top: '0px', width: '1px', height: '1px' });
  assertHeadedCspStyleReplayEvidence(tri.absentReplay, { currentHasAttribute: false, finalWriteKind: 'absent-remove-attribute' });
  assertHeadedCspStyleReplayEvidence(tri.emptyReplay, { currentHasAttribute: false, finalWriteKind: 'present-empty-set-attribute' });
  assertHeadedCspStyleReplayEvidence(tri.nonemptyReplay, { currentHasAttribute: true, finalWriteKind: 'present-nonempty-cssom-assignment' });
  assertHeadedCspStyleReplayEvidence(oracle.targets.formalReplay, { currentHasAttribute: true, finalWriteKind: 'present-nonempty-cssom-assignment' });
  assertHeadedCspStyleReplayEvidence(oracle.targets.hostReplay, { currentHasAttribute: true, finalWriteKind: 'present-nonempty-cssom-assignment' });
  assert.deepEqual(oracle.targets.immediate, oracle.targets.baseline);
  assert.deepEqual(oracle.targets.settled, oracle.targets.baseline);
  for (const target of [oracle.targets.baseline.formal, oracle.targets.baseline.host]) {
    assert.equal(target.raw.hasAttribute, true);
    assert.ok(target.raw.attribute.length > 0);
    assert.equal(target.raw.attribute, target.raw.cssText);
  }
  assert.equal(oracle.targets.baseline.formal.computed.width, '324px');
  assert.equal(oracle.targets.baseline.formal.computed.height, '576px');
  assert.equal(oracle.targets.baseline.formal.computed.maxWidth, 'none');
  assert.equal(oracle.targets.baseline.formal.computed.maxHeight, 'none');
  assert.equal(oracle.targets.baseline.formal.rect.width, 324);
  assert.equal(oracle.targets.baseline.formal.rect.height, 576);
  assert.deepEqual(oracle.targets.baseline.host.rect, oracle.targets.baseline.formal.rect);
  assert.equal(oracle.targets.baseline.host.computed.position, 'fixed');
  assert.equal(oracle.targets.baseline.host.computed.width, '324px');
  assert.equal(oracle.targets.baseline.host.computed.height, '576px');
}

function assertHeadedAncestorCspStyleReplayOracle(oracle) {
  assert.equal(oracle.authorityVersion, 'ancestor-csp-raw-style-replay-baseline-v1');
  assert.ok(['absent', 'present-empty', 'present-nonempty'].includes(oracle.baselineKind));
  assert.equal(oracle.baselineStyleAccessPreserved, true);
  assert.deepEqual(oracle.baselineRawAfterStyleAccess, oracle.baselineRawBeforeStyleAccess);
  assert.equal(oracle.settledStyleAccessPreserved, true);
  assert.deepEqual(oracle.settledRawAfterStyleAccess, oracle.settledRawBeforeStyleAccess);
  assert.equal(oracle.allReplayExact, true);
  assert.equal(oracle.baselineExact, true);
  assert.equal(oracle.triStateExact, true);
  assert.equal(oracle.probeRemoved, true);
  assert.equal(oracle.captureEpochExact, true);
  assert.equal(oracle.rafCount, 2);
  assert.deepEqual(oracle.failures, []);
  assert.deepEqual(oracle.settled, oracle.baseline);
  if (oracle.baselineKind === 'absent') {
    assert.deepEqual(oracle.baseline, { hasAttribute: false, attribute: null, cssText: '' });
  } else if (oracle.baselineKind === 'present-empty') {
    assert.deepEqual(oracle.baseline, { hasAttribute: true, attribute: '', cssText: '' });
  } else {
    assert.equal(oracle.baseline.hasAttribute, true);
    assert.ok(oracle.baseline.attribute.length > 0);
    assert.equal(oracle.baseline.attribute, oracle.baseline.cssText);
  }

  const baselineFinalWriteKind = oracle.baselineKind === 'absent'
    ? 'absent-remove-attribute'
    : oracle.baselineKind === 'present-empty'
      ? 'present-empty-set-attribute'
      : 'present-nonempty-cssom-assignment';
  assert.equal(oracle.baselineReplay.ok, true);
  assert.equal(oracle.baselineReplay.failure, null);
  assert.deepEqual(oracle.baselineReplay.after, oracle.baseline);
  assertHeadedCspStyleReplayEvidence(oracle.baselineReplay.evidence, { currentHasAttribute: oracle.baseline.hasAttribute, finalWriteKind: baselineFinalWriteKind });
  if (oracle.baselineKind === 'absent') assert.equal(oracle.baselineReplay.styleAccessAfterFinalRemove, false);

  const tri = oracle.triState;
  const firstTouch = tri.firstTouchCleanAbsentOracle;
  assert.equal(firstTouch.authorityVersion, 'connected-clean-absent-first-touch-style-replay-v1');
  assert.deepEqual(firstTouch.probeCreatedRaw, { hasAttribute: false, attribute: null });
  assert.deepEqual(firstTouch.probePreReplayRaw, { hasAttribute: false, attribute: null });
  assert.equal(firstTouch.styleAccessBeforeReplay, false);
  assert.equal(firstTouch.connectedBeforeReplay, true);
  assert.deepEqual(firstTouch.replay, tri.absent);
  assert.deepEqual(firstTouch.postReplayRaw, { hasAttribute: false, attribute: null });
  assert.equal(firstTouch.connectedAfterReplay, true);
  assert.equal(firstTouch.exact, true);

  const rawPresentFirstTouch = tri.rawPresentFirstTouchOracle;
  assert.equal(rawPresentFirstTouch.authorityVersion, 'connected-raw-present-first-touch-style-replay-v1');
  assert.deepEqual(rawPresentFirstTouch.rawPresentCreatedRaw, { hasAttribute: false, attribute: null });
  assert.deepEqual(rawPresentFirstTouch.rawPresentPreReplayRaw, { hasAttribute: true, attribute: 'outline: 1px;' });
  assert.equal(rawPresentFirstTouch.styleAccessBeforeReplay, false);
  assert.equal(rawPresentFirstTouch.connectedBeforeReplay, true);
  assert.equal(rawPresentFirstTouch.replay.ok, true);
  assert.equal(rawPresentFirstTouch.replay.failure, null);
  assert.equal(rawPresentFirstTouch.replay.styleAccessAfterFinalRemove, false);
  assert.equal(rawPresentFirstTouch.replay.evidence.preReplayCssText, '');
  assertHeadedCspStyleReplayEvidence(rawPresentFirstTouch.replay.evidence, { currentHasAttribute: true, finalWriteKind: 'absent-remove-attribute' });
  assert.deepEqual(rawPresentFirstTouch.postReplayRaw, { hasAttribute: false, attribute: null });
  assert.equal(rawPresentFirstTouch.connectedAfterReplay, true);
  assert.equal(rawPresentFirstTouch.exact, true);

  assert.deepEqual(tri.absent.after, { hasAttribute: false, attribute: null, cssText: '' });
  assert.deepEqual(tri.empty.after, { hasAttribute: true, attribute: '', cssText: '' });
  assert.deepEqual(tri.nonempty.after, { hasAttribute: true, attribute: 'outline: 0px;', cssText: 'outline: 0px;' });
  assertHeadedCspStyleReplayEvidence(tri.absent.evidence, { currentHasAttribute: false, finalWriteKind: 'absent-remove-attribute' });
  assertHeadedCspStyleReplayEvidence(tri.empty.evidence, { currentHasAttribute: false, finalWriteKind: 'present-empty-set-attribute' });
  assertHeadedCspStyleReplayEvidence(tri.nonempty.evidence, { currentHasAttribute: true, finalWriteKind: 'present-nonempty-cssom-assignment' });
  assertHeadedCspStyleReplayEvidence(tri.probeAbsentRestore.evidence, { currentHasAttribute: true, finalWriteKind: 'absent-remove-attribute' });
  assert.equal(tri.absent.styleAccessAfterFinalRemove, false);
  assert.equal(tri.probeAbsentRestore.styleAccessAfterFinalRemove, false);
  assert.equal(tri.nonemptyComputed.outlineWidth, '0px');
  for (const attempt of [tri.absent, tri.empty, tri.nonempty, tri.probeAbsentRestore]) {
    assert.equal(attempt.ok, true);
    assert.equal(attempt.failure, null);
  }

  const absentTwoRaf = tri.absentTwoRafOracle;
  assert.equal(absentTwoRaf.authorityVersion, 'absent-final-remove-two-raf-style-access-v1');
  assert.equal(absentTwoRaf.finalWriteKind, 'absent-remove-attribute');
  assert.deepEqual(absentTwoRaf.immediateRaw, { hasAttribute: false, attribute: null });
  assert.deepEqual(absentTwoRaf.preStyleAccessRaw, { hasAttribute: false, attribute: null });
  assert.equal(absentTwoRaf.cssTextAfterBarrier, '');
  assert.deepEqual(absentTwoRaf.postStyleAccessRaw, { hasAttribute: false, attribute: null });
  assert.equal(absentTwoRaf.rafCount, 2);
  assert.equal(absentTwoRaf.exact, true);
}

function assertHeadedFrozenNegativeBaseline(coverage) {
  const authority = coverage.frozenNonceAuthority; const raster = coverage.physicalRasterAuthority; const nonce = coverage.backgroundNonce; const screenshot = authority.screenshotBinding; const dpr = coverage.deviceScaleFactor;
  assertHeadedCspStyleReplayOracle(coverage.cspStyleReplayOracle); const contextRestoration = coverage.nonceContextRestorationEvidence; assert.equal(contextRestoration.authorityVersion, 'presentation-nonce-context-raw-authority-cssom-stability-v1'); assert.equal(contextRestoration.rawAttributeAndOwnedStateExact, true); assert.equal(contextRestoration.historicalCssomDiagnosticOnly, true); assert.equal(contextRestoration.readOnlySettleBarrierCount, 1); assert.equal(contextRestoration.postFinalRawReplayCssomStable, true); assert.match(contextRestoration.strictProjectionSha256, SHA); assert.equal(contextRestoration.postRestoreComputedAndGeometryVerifiedBeforeRepair, true); assert.equal(contextRestoration.postRestoreRepairWrites, 0); const alignedStage = nonce.alignedStageRestorationEvidence; assert.equal(alignedStage.authorityVersion, 'presentation-stage-raw-nonce-computed-geometry-restoration-v1'); assert.equal(alignedStage.exact, true); assert.deepEqual(alignedStage.actual, alignedStage.expected); assert.equal(alignedStage.expected.stageStyle.backgroundColor, 'rgb(5, 7, 11)'); assert.equal(alignedStage.actual.stageStyle.backgroundColor, 'rgb(5, 7, 11)'); assert.equal(alignedStage.expected.backgroundNonce, null); assert.equal(alignedStage.actual.backgroundNonce, null); assert.equal(alignedStage.expected.backgroundNonceNodeCount, 0); assert.equal(alignedStage.actual.backgroundNonceNodeCount, 0); assert.deepEqual(alignedStage.actual.stageInlineStyle, alignedStage.expected.stageInlineStyle); assert.deepEqual(alignedStage.actual.formalRect, alignedStage.expected.formalRect); assert.deepEqual(alignedStage.actual.geometry, alignedStage.expected.geometry); const alignmentTrace = nonce.alignmentRestorationTrace; assert.equal(alignmentTrace.authorityVersion, 'negative-aligned-nonce-restoration-trace-v1'); assert.equal(alignmentTrace.alignedProjectionExact, true); assertHeadedAlignedFormalTrace(alignmentTrace.preNonce, dpr, 'pre-nonce'); assertHeadedAlignedFormalTrace(alignmentTrace.preRelease, dpr, 'pre-release'); assert.equal(alignmentTrace.release.authorityVersion, 'presentation-formal-a-barrier-b-stability-v1'); assert.equal(alignmentTrace.release.exact, true); assert.deepEqual(alignmentTrace.release.canonicalB, alignmentTrace.release.canonicalA); assert.equal(alignmentTrace.release.barrier.authorityVersion, 'two-raf-bcr-computed-read-only-settle-v1'); assert.equal(alignmentTrace.release.barrier.readOnly, true); assertHeadedAlignedFormalTrace(alignmentTrace.release.canonicalA, dpr, 'release canonical A'); assertHeadedAlignedFormalTrace(alignmentTrace.release.canonicalB, dpr, 'release canonical B'); assertHeadedAlignedFormalTrace(alignmentTrace.postRelease, dpr, 'post-release'); assert.deepEqual(alignmentTrace.postRelease.formal.rect, alignedStage.actual.formalRect);
  assert.equal(authority.authorityVersion, FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION); assert.equal(authority.readerMode, FROZEN_NEGATIVE_NONCE_READER_MODE); assert.match(authority.authoritySha256, SHA); assert.equal(authority.canonicalHashExact, true); assert.equal(authority.deepFrozenExact, true); assert.equal(authority.noPseudoOverlay, true);
  assert.equal(authority.caseBindingKeySha256, nonce.challenge.bindingKeySha256); assert.equal(authority.nonceTokenSha256, nonce.nonceTokenSha256); assert.equal(authority.patternSha256, nonce.patternSha256); assert.equal(authority.patternBits, nonce.patternBits); assert.match(authority.patternBits, /^[01]{64}$/u);
  assert.equal(authority.dpr, dpr); assert.deepEqual(authority.viewportCssRect, { left: 0, top: 0, right: 1440, bottom: 1000, width: 1440, height: 1000 }); assert.deepEqual(authority.screenshotDimensions, { width: 1440 * dpr, height: 1000 * dpr }); assert.deepEqual(authority.formalTargetRect, nonce.formalTargetRect); assert.deepEqual(authority.hostRect, nonce.hostRect); assert.equal(authority.layoutSha256, nonce.actualLayoutSha256); assert.equal(authority.layoutBindingSha256, nonce.layoutBindingSha256);
  assert.equal(screenshot.authorityVersion, 'negative-frozen-baseline-screenshot-binding-v1'); assert.match(screenshot.backgroundPngSha256, SHA); assert.match(screenshot.backgroundGuardRegionSha256, SHA); assert.deepEqual(screenshot.guardRegion, raster.domains.G); assert.deepEqual(screenshot.measuredF, raster.F.observedCoverageBbox); assert.equal(screenshot.measuredFMaskCanonicalSha256, raster.F.maskCanonicalSha256); assert.equal(screenshot.nominalDAuthority, false);
  assert.deepEqual(coverage.formalRasterBbox, raster.domains.D); assert.equal(coverage.geometryPixels, raster.domains.D.width * raster.domains.D.height); assert.equal(coverage.measuredPhysicalPixels, raster.F.changedPixels); assert.equal(coverage.measuredFNominalDIntersectionPixels, Math.max(0, Math.min(raster.domains.D.x + raster.domains.D.width, raster.F.observedCoverageBbox.x + raster.F.observedCoverageBbox.width) - Math.max(raster.domains.D.x, raster.F.observedCoverageBbox.x)) * Math.max(0, Math.min(raster.domains.D.y + raster.domains.D.height, raster.F.observedCoverageBbox.y + raster.F.observedCoverageBbox.height) - Math.max(raster.domains.D.y, raster.F.observedCoverageBbox.y))); assert.equal(coverage.measuredFOutsideNominalDPixels, coverage.measuredPhysicalPixels - coverage.measuredFNominalDIntersectionPixels); assert.equal(coverage.measuredFEqualsNominalD, JSON.stringify(raster.F.observedCoverageBbox) === JSON.stringify(raster.domains.D));
  for (const observed of [coverage.referenceCoverage, coverage.targetCoverage]) { assert.equal(observed.changedPixels, coverage.measuredPhysicalPixels); assert.deepEqual(observed.observedCoverageBbox, raster.F.observedCoverageBbox); assert.equal(observed.insideGeometryChangedPixels, coverage.measuredFNominalDIntersectionPixels); assert.equal(observed.outsideGeometryChangedPixels, coverage.measuredFOutsideNominalDPixels); assert.equal(observed.insideGeometryChangedPixels + observed.outsideGeometryChangedPixels, observed.changedPixels); assert.equal(observed.outsidePhysicalMaskChangedPixels, 0); assert.equal(observed.observedPixelsRectangular, true); }
  const formalRect = authority.formalTargetRect;
  const physicalFormalEdges = { left: formalRect.left * dpr, top: formalRect.top * dpr, right: formalRect.right * dpr, bottom: formalRect.bottom * dpr };
  assert.equal(formalRect.width, 324); assert.equal(formalRect.height, 576); assert.equal(Object.values(physicalFormalEdges).every(Number.isSafeInteger), true);
  const expectedD = { x: Math.floor(physicalFormalEdges.left), y: Math.floor(physicalFormalEdges.top), width: Math.ceil(physicalFormalEdges.right) - Math.floor(physicalFormalEdges.left), height: Math.ceil(physicalFormalEdges.bottom) - Math.floor(physicalFormalEdges.top) };
  const expectedG = { x: expectedD.x - 2, y: expectedD.y - 2, width: expectedD.width + 4, height: expectedD.height + 4 };
  const measuredF = raster.F.observedCoverageBbox;
  const expectedEdgeVsDDevicePixels = { left: measuredF.x - expectedD.x, top: measuredF.y - expectedD.y, right: measuredF.x + measuredF.width - (expectedD.x + expectedD.width), bottom: measuredF.y + measuredF.height - (expectedD.y + expectedD.height) };
  const measuredFNominalDIntersectionPixels = Math.max(0, Math.min(expectedD.x + expectedD.width, measuredF.x + measuredF.width) - Math.max(expectedD.x, measuredF.x)) * Math.max(0, Math.min(expectedD.y + expectedD.height, measuredF.y + measuredF.height) - Math.max(expectedD.y, measuredF.y));
  const runtimeAuthorities = [{ name: 'runtime-reference', bbox: coverage.referenceCoverage.observedCoverageBbox, changedPixels: coverage.referenceCoverage.changedPixels, maskCanonicalSha256: coverage.referenceCoverage.maskCanonicalSha256, rowSpanCanonicalSha256: coverage.referenceCoverage.rowSpanCanonicalSha256, insideGeometryChangedPixels: coverage.referenceCoverage.insideGeometryChangedPixels, outsideGeometryChangedPixels: coverage.referenceCoverage.outsideGeometryChangedPixels }, { name: 'runtime-target', bbox: coverage.targetCoverage.observedCoverageBbox, changedPixels: coverage.targetCoverage.changedPixels, maskCanonicalSha256: coverage.targetCoverage.maskCanonicalSha256, rowSpanCanonicalSha256: coverage.targetCoverage.rowSpanCanonicalSha256, insideGeometryChangedPixels: coverage.targetCoverage.insideGeometryChangedPixels, outsideGeometryChangedPixels: coverage.targetCoverage.outsideGeometryChangedPixels }];
  const frozenScreenshotAuthority = { name: 'frozen-screenshot-binding', bbox: screenshot.measuredF, maskCanonicalSha256: screenshot.measuredFMaskCanonicalSha256 };
  const frozenMeasuredFArea = frozenScreenshotAuthority.bbox.width * frozenScreenshotAuthority.bbox.height;
  const frozenEdgeVsDDevicePixels = { left: frozenScreenshotAuthority.bbox.x - expectedD.x, top: frozenScreenshotAuthority.bbox.y - expectedD.y, right: frozenScreenshotAuthority.bbox.x + frozenScreenshotAuthority.bbox.width - (expectedD.x + expectedD.width), bottom: frozenScreenshotAuthority.bbox.y + frozenScreenshotAuthority.bbox.height - (expectedD.y + expectedD.height) };
  const frozenMeasuredFNominalDIntersectionPixels = Math.max(0, Math.min(expectedD.x + expectedD.width, frozenScreenshotAuthority.bbox.x + frozenScreenshotAuthority.bbox.width) - Math.max(expectedD.x, frozenScreenshotAuthority.bbox.x)) * Math.max(0, Math.min(expectedD.y + expectedD.height, frozenScreenshotAuthority.bbox.y + frozenScreenshotAuthority.bbox.height) - Math.max(expectedD.y, frozenScreenshotAuthority.bbox.y));
  const frozenMeasuredFOutsideNominalDPixels = frozenMeasuredFArea - frozenMeasuredFNominalDIntersectionPixels;
  assert.equal(raster.domains.deviceScaleFactor, dpr); assert.deepEqual(raster.domains.D, expectedD); assert.deepEqual(raster.domains.G, expectedG); assert.equal(expectedD.width, 324 * dpr); assert.equal(expectedD.height, 576 * dpr); assert.deepEqual(raster.F.scanRegion, expectedG); assert.ok(measuredF.x >= raster.domains.E.x && measuredF.y >= raster.domains.E.y && measuredF.x + measuredF.width <= raster.domains.E.x + raster.domains.E.width && measuredF.y + measuredF.height <= raster.domains.E.y + raster.domains.E.height); assert.equal(measuredF.width * measuredF.height, raster.F.changedPixels); assert.deepEqual(raster.edgeVsDDevicePixels, expectedEdgeVsDDevicePixels); assert.equal(coverage.measuredFNominalDIntersectionPixels, measuredFNominalDIntersectionPixels); assert.equal(coverage.measuredFOutsideNominalDPixels, raster.F.changedPixels - measuredFNominalDIntersectionPixels); assert.equal(coverage.measuredFEqualsNominalD, JSON.stringify(measuredF) === JSON.stringify(expectedD));
  for (const source of runtimeAuthorities) {
    const runtimeMeasuredFNominalDIntersectionPixels = Math.max(0, Math.min(expectedD.x + expectedD.width, source.bbox.x + source.bbox.width) - Math.max(expectedD.x, source.bbox.x)) * Math.max(0, Math.min(expectedD.y + expectedD.height, source.bbox.y + source.bbox.height) - Math.max(expectedD.y, source.bbox.y));
    assert.deepEqual(source.bbox, measuredF, `${source.name}: measured F bbox`); assert.equal(source.changedPixels, raster.F.changedPixels, `${source.name}: measured F area`); assert.equal(source.maskCanonicalSha256, raster.F.maskCanonicalSha256, `${source.name}: measured F mask`); assert.equal(source.rowSpanCanonicalSha256, raster.F.rowSpanCanonicalSha256, `${source.name}: measured F row spans`); assert.equal(source.insideGeometryChangedPixels, runtimeMeasuredFNominalDIntersectionPixels, `${source.name}: measured F inside-D partition`); assert.equal(source.outsideGeometryChangedPixels, source.changedPixels - runtimeMeasuredFNominalDIntersectionPixels, `${source.name}: measured F outside-D partition`); assert.equal(source.insideGeometryChangedPixels + source.outsideGeometryChangedPixels, source.changedPixels, `${source.name}: measured F partition total`);
  }
  assert.deepEqual(frozenScreenshotAuthority.bbox, measuredF, `${frozenScreenshotAuthority.name}: measured F bbox`); assert.equal(frozenMeasuredFArea, raster.F.changedPixels, `${frozenScreenshotAuthority.name}: bbox-derived measured F area`); assert.equal(frozenScreenshotAuthority.maskCanonicalSha256, raster.F.maskCanonicalSha256, `${frozenScreenshotAuthority.name}: measured F mask`); assert.deepEqual(frozenEdgeVsDDevicePixels, expectedEdgeVsDDevicePixels, `${frozenScreenshotAuthority.name}: bbox-derived measured F edge`); assert.equal(frozenMeasuredFNominalDIntersectionPixels, measuredFNominalDIntersectionPixels, `${frozenScreenshotAuthority.name}: bbox-derived measured F inside-D partition`); assert.equal(frozenMeasuredFOutsideNominalDPixels, coverage.measuredFOutsideNominalDPixels, `${frozenScreenshotAuthority.name}: bbox-derived measured F outside-D partition`); assert.equal(frozenMeasuredFNominalDIntersectionPixels + frozenMeasuredFOutsideNominalDPixels, frozenMeasuredFArea, `${frozenScreenshotAuthority.name}: bbox-derived measured F partition total`);
}

function assertHeadedFrozenNonceCorruptionOracle(oracle, baselineCoverage) {
  assert.equal(oracle.deviceScaleFactor, baselineCoverage.deviceScaleFactor); assert.equal(oracle.authorityVersion, FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION); assert.equal(oracle.readerMode, FROZEN_NEGATIVE_NONCE_READER_MODE); assert.equal(oracle.authoritySha256, baselineCoverage.frozenNonceAuthority.authoritySha256); assert.match(oracle.baselineActualSha256, SHA); assert.equal(oracle.corruptionCount, 6);
  assert.deepEqual(oracle.records.map((record) => record.corruption), ['layout', 'duplicate-host', 'token', 'context', 'visual', 'readback']); assert.deepEqual(oracle.records.map((record) => record.firstCode), ['presentation_background_nonce_frozen_layout_mismatch', 'presentation_background_nonce_frozen_layout_mismatch', 'presentation_background_nonce_frozen_token_mismatch', 'presentation_background_nonce_frozen_layout_mismatch', 'presentation_background_nonce_frozen_visual_state_mismatch', 'presentation_background_nonce_frozen_readback_mismatch']);
  for (const record of oracle.records) { assert.equal(record.rejectedBeforeScreenshot, true); assert.equal(record.screenshotCaptureCount, 0); assert.equal(record.destinationCreated, false); assert.equal(record.attemptPngResidue, 0); assert.equal(record.exactPostRestoreState, true); const diagnostic = record.restorationDiagnostic; assert.equal(diagnostic.authorityVersion, 'frozen-corruption-final-raw-replay-settle-v1'); assert.equal(diagnostic.postFinalRawReplayRafCount, 2); assert.equal(diagnostic.rawStyleExact, true); assert.equal(diagnostic.immediateToSeparateTaskExact, true); assert.equal(diagnostic.separateTaskToBarrierBExact, true); assert.equal(diagnostic.postFinalRawStable, true); assert.equal(diagnostic.postFinalCssomStable, true); assert.equal(diagnostic.postFinalRectStable, true); assert.equal(diagnostic.postFinalComputedStable, true); assert.equal(diagnostic.hostRectExact, true); assert.equal(diagnostic.formalRectExact, true); assert.equal(diagnostic.settleBarrier.authorityVersion, 'frozen-corruption-two-raf-bcr-computed-read-only-barrier-v1'); assert.equal(diagnostic.settleBarrier.readOnly, true); assert.equal(diagnostic.settleBarrier.rafCount, 2); assert.deepEqual(diagnostic.canonical.hostRect, diagnostic.before.hostRect); assert.deepEqual(diagnostic.canonical.formalRect, diagnostic.before.formalRect); assert.deepEqual({ hasAttribute: diagnostic.canonical.hostStyle.hasAttribute, attribute: diagnostic.canonical.hostStyle.attribute }, { hasAttribute: diagnostic.before.hostStyle.hasAttribute, attribute: diagnostic.before.hostStyle.attribute }); assert.deepEqual({ hasAttribute: diagnostic.canonical.stageStyle.hasAttribute, attribute: diagnostic.canonical.stageStyle.attribute }, { hasAttribute: diagnostic.before.stageStyle.hasAttribute, attribute: diagnostic.before.stageStyle.attribute }); assert.deepEqual({ hostStyle: diagnostic.separateTaskCanonicalA.hostStyle, stageStyle: diagnostic.separateTaskCanonicalA.stageStyle, hostRect: diagnostic.separateTaskCanonicalA.hostRect, formalRect: diagnostic.separateTaskCanonicalA.formalRect, hostComputed: diagnostic.separateTaskCanonicalA.hostComputed, stageComputed: diagnostic.separateTaskCanonicalA.stageComputed, formalComputed: diagnostic.separateTaskCanonicalA.formalComputed }, { hostStyle: diagnostic.canonical.hostStyle, stageStyle: diagnostic.canonical.stageStyle, hostRect: diagnostic.canonical.hostRect, formalRect: diagnostic.canonical.formalRect, hostComputed: diagnostic.canonical.hostComputed, stageComputed: diagnostic.canonical.stageComputed, formalComputed: diagnostic.canonical.formalComputed }); assert.equal(diagnostic.canonical.hostStyle.cssText, diagnostic.restored.hostStyle.cssText); assert.equal(diagnostic.canonical.stageStyle.cssText, diagnostic.restored.stageStyle.cssText); }
  const layout = oracle.records[0].restorationDiagnostic; assert.equal(layout.mutated.hostRect.left, layout.before.hostRect.left + 1); assert.deepEqual(layout.mutated.formalRect, layout.before.formalRect); assert.notDeepEqual({ hasAttribute: layout.mutated.hostStyle.hasAttribute, attribute: layout.mutated.hostStyle.attribute }, { hasAttribute: layout.before.hostStyle.hasAttribute, attribute: layout.before.hostStyle.attribute }); assert.deepEqual(layout.canonical.hostRect, baselineCoverage.frozenNonceAuthority.hostRect); assert.deepEqual(layout.canonical.formalRect, baselineCoverage.frozenNonceAuthority.formalTargetRect);
}

function assertHeadedNegativeStyleAttributeTransition(transition) {
  const absent = { styleHasAttribute: false, styleAttribute: null, styleCssText: '' }; assert.equal(transition.authorityVersion, 'post-synthetic-pre-negative-raw-style-tristate-v1'); assert.equal(transition.replayAuthorityVersion, 'csp-aware-raw-style-attribute-replay-v1'); assert.deepEqual(transition.before, absent); assert.deepEqual(transition.absent, absent); assert.deepEqual(transition.empty, { styleHasAttribute: true, styleAttribute: '', styleCssText: '' }); assert.deepEqual(transition.nonempty, { styleHasAttribute: true, styleAttribute: 'outline: 0px;', styleCssText: 'outline: 0px;' }); assert.deepEqual(transition.restored, absent); assert.deepEqual(transition.canonical, absent); assert.deepEqual(transition.separateVerification, absent); assert.equal(transition.postFinalRawReplayRafCount, 2); assert.equal(transition.absentAndEmptyDistinct, true); assert.equal(transition.exactPostRafAndBcrRestoration, true);
}

function assertHeadedNegativePreparation(evidence) {
  const dpr = evidence.deviceScaleFactor; const postSynthetic = evidence.postSyntheticTransition; assert.equal(postSynthetic.authorityVersion, 'post-synthetic-to-negative-natural-viewport-preparation-v1'); assert.equal(postSynthetic.intrinsicExact, true); assert.equal(postSynthetic.rawStylesExact, true); assert.equal(postSynthetic.captureEpochExact, true); assert.equal(postSynthetic.stageScrollExact, true); assert.equal(postSynthetic.domStyleWriteCount, 0); assert.equal(postSynthetic.mutationRepairWriteCount, 0); assert.equal(postSynthetic.before.stage.inline.alignItems, ''); assert.equal(postSynthetic.before.stage.computed.alignItems, 'center'); assert.equal(postSynthetic.after.stage.inline.alignItems, ''); assert.equal(postSynthetic.after.stage.computed.alignItems, 'center'); assert.deepEqual(postSynthetic.before.formal.raw, postSynthetic.after.formal.raw); assert.deepEqual(postSynthetic.before.stage.raw, postSynthetic.after.stage.raw); assert.deepEqual(postSynthetic.beforeScrollState.stage, { left: 0, top: 0 }); assert.deepEqual(postSynthetic.afterScrollState.stage, { left: 0, top: 0 }); assert.deepEqual(postSynthetic.afterScrollState.root, postSynthetic.viewportPreparation.scroll); assert.equal(postSynthetic.viewportPreparation.stability.requiredConsecutive, 2); assert.ok(postSynthetic.viewportPreparation.stability.captures >= 2); assert.equal(postSynthetic.guard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1'); assert.equal(postSynthetic.guard.phase, 'post-synthetic-natural-portrait'); assert.equal(postSynthetic.guard.exact, true); assert.equal(postSynthetic.guard.writeCount, 0); assert.equal(postSynthetic.guard.clampApplied, false); assert.deepEqual(postSynthetic.guard.geometry, postSynthetic.after.projection.geometry); assert.deepEqual(postSynthetic.guard.dimensions, { width: 1440 * dpr, height: 1000 * dpr });
  const policy = evidence.alignmentPolicyTransition; assert.equal(policy.authorityVersion, 'negative-initial-flex-start-alignment-policy-transition-v1'); assert.equal(policy.styleWriteCount, 1); assert.equal(policy.scrollWriteCount, 0); assert.equal(policy.mutationRepairWriteCount, 0); assert.equal(policy.before.stageInlineAlignItems, ''); assert.equal(policy.before.stageComputedAlignItems, 'center'); assert.equal(policy.after.stageInlineAlignItems, 'flex-start'); assert.equal(policy.after.stageComputedAlignItems, 'flex-start'); assert.deepEqual(policy.after.targetRaw, policy.before.targetRaw); assert.deepEqual(policy.after.targetRect, policy.before.targetRect); assert.deepEqual(policy.after.stageRect, policy.before.stageRect); const policyFormalStageTopDeltaCssPx = policy.before.targetRect.top - policy.before.stageRect.top; assert.equal(Number.isFinite(policyFormalStageTopDeltaCssPx), true); assert.equal(policy.after.targetRect.top - policy.after.stageRect.top, policyFormalStageTopDeltaCssPx); assert.deepEqual(policy.after.rootScroll, policy.before.rootScroll); assert.deepEqual(policy.after.stageScroll, { left: 0, top: 0 }); assert.deepEqual(policy.after.stageScroll, policy.before.stageScroll); assert.deepEqual(policy.after.nestedScrollOffsets, policy.before.nestedScrollOffsets); assert.equal(policy.after.captureEpoch, policy.before.captureEpoch); assert.equal(policy.after.stageRaw.attribute, policy.after.stageRaw.cssText); assert.match(policy.after.stageRaw.attribute, /(?:^|; )align-items: flex-start;/u);
  const transition = evidence.legacyTransitionOracle, intrinsic = { width: 360, height: 640 }, intrinsicWidthDelta = intrinsic.width - policy.after.targetRect.width, horizontalExpansionCssPx = intrinsicWidthDelta / 2, expectedTargetRect = { left: policy.after.targetRect.left - horizontalExpansionCssPx, top: policy.after.targetRect.top, right: policy.after.targetRect.right + horizontalExpansionCssPx, bottom: policy.after.targetRect.top + intrinsic.height, width: intrinsic.width, height: intrinsic.height }, rasterDomains = (rect) => { const D = { x: Math.floor(rect.left * dpr), y: Math.floor(rect.top * dpr), width: Math.ceil(rect.right * dpr) - Math.floor(rect.left * dpr), height: Math.ceil(rect.bottom * dpr) - Math.floor(rect.top * dpr) }; return { D, G: { x: D.x - 2, y: D.y - 2, width: D.width + 4, height: D.height + 4 } }; }, physicalEdges = (rect) => ({ left: rect.left * dpr, top: rect.top * dpr, right: rect.right * dpr, bottom: rect.bottom * dpr }), policyPhysicalEdges = physicalEdges(policy.after.targetRect), legacyPhysicalEdges = physicalEdges(expectedTargetRect), expectedBaselineDomains = rasterDomains(policy.after.targetRect), expectedLegacyDomains = rasterDomains(expectedTargetRect);
  assert.equal(intrinsicWidthDelta, 36); assert.equal(horizontalExpansionCssPx, 18); assert.equal(Object.values(policyPhysicalEdges).every(Number.isSafeInteger), true); assert.equal(Object.values(legacyPhysicalEdges).every(Number.isSafeInteger), true); assert.equal((policy.after.targetRect.left - expectedTargetRect.left) * dpr, 18 * dpr); assert.equal((expectedTargetRect.right - policy.after.targetRect.right) * dpr, 18 * dpr); assert.equal(expectedTargetRect.left * dpr, policy.after.targetRect.left * dpr - 18 * dpr); assert.equal(expectedTargetRect.right * dpr, policy.after.targetRect.right * dpr + 18 * dpr);
  assert.equal(transition.authorityVersion, 'post-synthetic-to-flex-start-legacy-capture-transition-v1'); assert.equal(transition.postSyntheticAuthorityVersion, postSynthetic.authorityVersion); assert.equal(transition.alignmentPolicyAuthorityVersion, policy.authorityVersion); assert.equal(transition.alignedFormalTopCssPx, policy.after.targetRect.top); assert.equal(transition.alignedStageTopCssPx, policy.after.stageRect.top); assert.equal(transition.formalStageTopDeltaCssPx, policyFormalStageTopDeltaCssPx); assert.equal(Number.parseFloat(transition.expectedFormalInlineTop), transition.formalStageTopDeltaCssPx); assert.equal(transition.centeredOverflowOffsetCssPx, -230); assert.equal(transition.formerCenteredTop, transition.alignedFormalTopCssPx - 230); assert.deepEqual(transition.expectedTargetRect, expectedTargetRect); assert.equal(transition.expectedTargetRect.top, transition.alignedFormalTopCssPx); assert.equal(transition.expectedTargetRect.bottom, transition.alignedFormalTopCssPx + intrinsic.height); assert.deepEqual(transition.expectedRootScroll, policy.after.rootScroll); assert.deepEqual(transition.expectedStageScroll, { left: 0, top: 0 }); assert.equal(transition.captureReadyBeforeAnyScreenshot, true); assert.equal(transition.mutationRepairWriteCount, 0); assert.equal(transition.guard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1'); assert.equal(transition.guard.phase, 'legacy-intrinsic-scroll-layout-predicted'); assert.equal(transition.guard.exact, true); assert.equal(transition.guard.writeCount, 0); assert.equal(transition.guard.clampApplied, false); assert.deepEqual(transition.guard.geometry.targetRect, transition.expectedTargetRect); assert.deepEqual(evidence.baselineGuard.geometry.targetRect, policy.after.targetRect); assert.equal(evidence.baselineGuard.exact, true); assert.deepEqual(evidence.baselineGuard.D, expectedBaselineDomains.D); assert.deepEqual(evidence.baselineGuard.G, expectedBaselineDomains.G); assert.deepEqual(transition.guard.D, expectedLegacyDomains.D); assert.deepEqual(transition.guard.G, expectedLegacyDomains.G);
}

function assertHeadedFrozenNegativeProbe(probe, baselineCoverage) {
  const authority = probe.frozenNonceAuthority; const baselineAuthority = baselineCoverage.frozenNonceAuthority; const state = probe.mutatedCompositorStability.expectedState; const stateNonce = state.backgroundNonceNode;
  assert.equal(probe.deviceScaleFactor, baselineCoverage.deviceScaleFactor); assert.equal(authority.authorityVersion, FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION); assert.equal(authority.authorityClass, FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION); assert.equal(authority.readerMode, FROZEN_NEGATIVE_NONCE_READER_MODE); assert.equal(authority.authoritySha256, baselineAuthority.authoritySha256); assert.equal(authority.frozenAuthoritySha256, baselineAuthority.authoritySha256); assert.equal(authority.layoutSha256, baselineAuthority.layoutSha256); assert.equal(authority.layoutBindingSha256, baselineAuthority.layoutBindingSha256); assert.deepEqual(authority.baselineFormalTargetRect, baselineAuthority.formalTargetRect); assert.deepEqual(authority.baselineHostRect, baselineAuthority.hostRect); assert.deepEqual(authority.screenshotBinding, baselineAuthority.screenshotBinding); assert.match(authority.actualSha256, SHA); assertHeadedFrozenNonceLayoutMetrics(authority.layoutMetrics);
  assert.equal(stateNonce.authorityClass, FROZEN_NEGATIVE_NONCE_AUTHORITY_VERSION); assert.equal(stateNonce.readerMode, FROZEN_NEGATIVE_NONCE_READER_MODE); assert.equal(stateNonce.frozenAuthoritySha256, baselineAuthority.authoritySha256); assert.equal(stateNonce.frozenActualSha256, authority.actualSha256); assertHeadedFrozenNonceLayoutMetrics(stateNonce.layoutMetrics); assert.deepEqual(state.geometry, authority.currentSelectedGeometry); assert.deepEqual(state.formalRect, authority.currentFormalRect); assert.deepEqual(state.intrinsic, authority.intrinsic); assert.equal(state.ancestorChain.canonicalSha256, authority.ancestorCanonicalSha256); assert.equal(state.captureEpoch, authority.captureEpoch); assert.deepEqual(authority.intrinsic, { width: 360, height: 640 }); assert.equal(authority.currentSelectedGeometry.dpr, probe.deviceScaleFactor); assert.deepEqual(authority.currentSelectedGeometry.viewport, { width: 1440, height: 1000 }); assert.match(authority.ancestorCanonicalSha256, SHA); assert.ok(Number.isSafeInteger(authority.captureEpoch) && authority.captureEpoch > 0);
  const guard = probe.preCaptureGuardEvidence; assert.equal(guard.authorityVersion, 'negative-pre-capture-target-guard-in-viewport-v1'); assert.equal(guard.phase, `negative:${probe.mutatedCompositorStability.state.slice('negative:'.length)}`); assert.equal(guard.exact, true); assert.equal(guard.writeCount, 0); assert.equal(guard.clampApplied, false); assert.deepEqual(guard.geometry, state.geometry); assert.deepEqual(guard.dimensions, { width: 1440 * probe.deviceScaleFactor, height: 1000 * probe.deviceScaleFactor }); assert.ok(guard.G.x >= 0 && guard.G.y >= 0 && guard.G.x + guard.G.width <= guard.dimensions.width && guard.G.y + guard.G.height <= guard.dimensions.height); assert.deepEqual(probe.mutationViewportState.rootScroll, state.geometry.scroll); assert.deepEqual(probe.mutationViewportState.stageScroll, { left: 0, top: 0 }); assert.deepEqual(probe.mutationViewportState.stageAlignItems, { inline: 'flex-start', computed: 'flex-start' }); assert.equal(probe.mutationViewportState.mutationRepairWriteCount, 0);
  assert.equal(probe.antiStale.recroppedWithCurrentMutatedGeometry, true); assert.ok(probe.antiStale.sourceCount >= 3); assert.ok(probe.antiStale.uniqueRegionSha256Count >= 2); assert.equal(probe.antiStale.sources.length, probe.antiStale.sourceCount); for (const source of probe.antiStale.sources) { assert.match(source.regionSha256, SHA); assert.ok(source.region.width > 0 && source.region.height > 0); } assert.equal(probe.postRestoreComputedAndGeometryVerifiedBeforeRepair, true); assert.equal(probe.postRestoreRepairWrites, 0); assert.equal(probe.rawAttributeAndOwnedStateExact, true); assert.equal(probe.historicalCssomDiagnosticOnly, true); assert.equal(probe.postFinalRawReplayCssomStable, true); assert.equal(probe.postRestoreGeometryFirstCode, null); assert.deepEqual(probe.postRestoreIntrinsic, { width: 360, height: 640 }); assert.equal(probe.postRestoreFormalIntrinsicImageDataSha256, probe.baselineFormalIntrinsicImageDataSha256); assert.match(probe.postRestoreFrozenProjectionSha256, SHA); assert.deepEqual(probe.postRestorePhysicalEdges, probe.targetPhysicalEdges);
}

function assertHeadedActualNonceLayout(nonce) {
  assert.equal(nonce.authorityVersion, 'viewport-device-raster-nonce-v1');
  assert.equal(nonce.supportedDpr, true);
  assert.equal(nonce.scanDomainName, 'G');
  assert.equal(nonce.scanDomainPolicy, 'every-G-pixel-byte-exact-threshold-0-v1');
  assert.equal(nonce.scanDomainCoordinatesSafeIntegers, true);
  assert.equal(nonce.scanDomainPositive, true);
  assert.equal(nonce.scanDomainInScreenshot, true);
  assert.equal(nonce.scanDomainSubsetE, true);
  assert.equal(nonce.eSubsetG, true);
  assert.equal(nonce.physicalDIsNonceAuthority, false);
  assert.deepEqual(Object.keys(nonce.physicalDomains), ['D', 'C', 'E', 'G', 'deviceScaleFactor', 'definitions']);
  const { D, E, G } = nonce.physicalDomains;
  const dpr = nonce.actualLayout.dpr;
  const rect = nonce.actualLayout.formalTargetRect;
  const expectedP = { x: Math.ceil(rect.left) * dpr, y: Math.floor(rect.top) * dpr, width: (Math.ceil(rect.right) - Math.ceil(rect.left)) * dpr, height: (Math.ceil(rect.bottom) - Math.floor(rect.top)) * dpr };
  assert.deepEqual(nonce.P, expectedP);
  assert.deepEqual(nonce.G, G);
  assert.ok([nonce.P.x, nonce.P.y, nonce.P.width, nonce.P.height].every(Number.isSafeInteger));
  assert.ok(nonce.P.width >= 64 && nonce.P.height > 0);
  assert.ok(nonce.P.x >= E.x && nonce.P.y >= E.y && nonce.P.x + nonce.P.width <= E.x + E.width && nonce.P.y + nonce.P.height <= E.y + E.height);
  assert.ok(E.x >= G.x && E.y >= G.y && E.x + E.width <= G.x + G.width && E.y + E.height <= G.y + G.height);
  assert.deepEqual(nonce.scanDomainEdgeVsD, { left: nonce.P.x - D.x, top: nonce.P.y - D.y, right: nonce.P.x + nonce.P.width - (D.x + D.width), bottom: nonce.P.y + nonce.P.height - (D.y + D.height) });
  assert.equal(nonce.actualLayoutBound, true);
  assert.equal(nonce.formalTargetRectExact, true);
  assert.deepEqual(nonce.actualLayout.formalTargetRect, nonce.formalTargetRect);
  assert.deepEqual(nonce.actualLayout.hostRect, nonce.formalTargetRect);
  assert.deepEqual(nonce.hostRect, nonce.formalTargetRect);
  assert.ok([1, 2].includes(dpr));
  const viewportCssRect = nonce.actualLayout.viewportCssRect;
  assert.deepEqual(viewportCssRect, { left: 0, top: 0, right: viewportCssRect.width, bottom: viewportCssRect.height, width: viewportCssRect.width, height: viewportCssRect.height });
  assert.deepEqual(nonce.canvasCssRect, viewportCssRect);
  assert.deepEqual(nonce.actualLayout.canvasRect, viewportCssRect);
  assert.deepEqual(nonce.canvasBackingStore, { width: viewportCssRect.width * dpr, height: viewportCssRect.height * dpr });
  assert.deepEqual(nonce.actualLayout.screenshotDimensions, nonce.canvasBackingStore);
  assert.deepEqual(nonce.actualLayout.canvasBackingStore, nonce.canvasBackingStore);
  assert.deepEqual(nonce.actualLayout.structure, { hostIsStageChild: true, hostChildCount: 1, canvasCount: 1, paintedDomStripeCount: 0 });
  assert.equal(nonce.paintedDomStripeCount, 0);
  assert.equal(nonce.formalZIndex, '1');
  assert.equal(nonce.hostZIndex, '0');
  assert.equal(nonce.canvasZIndex, '0');
  assert.equal(nonce.actualLayout.hostPosition, 'fixed');
  assert.equal(nonce.actualLayout.canvasPosition, 'fixed');
  const expectedEffects = { transform: 'none', filter: 'none', backdropFilter: 'none', opacity: '1', contain: 'none', clipPath: 'none', perspective: 'none', maskImage: 'none', mixBlendMode: 'normal' };
  assert.deepEqual(nonce.hostEffects, expectedEffects);
  assert.deepEqual(nonce.canvasEffects, expectedEffects);
  assert.equal(nonce.fixedContainingBlockViewportExact, true);
  assert.deepEqual(nonce.canvasContextIdentity, { alpha: true, transform: [1, 0, 0, 1, 0, 0], globalAlpha: 1, globalCompositeOperation: 'source-over' });
  assert.equal(nonce.stripeCount, 64);
  assert.equal(nonce.patternVersion, 'fixed-10-sha61-fixed-1-v2');
  assert.match(nonce.patternBits, /^10[01]{61}1$/u);
  assert.equal(nonce.tokenBitCount, 61);
  assert.deepEqual(nonce.fixedStripes, { first: 1, second: 0, last: 1, rawScreenshotRgb: { bit0: [0, 0, 0], bit1: [255, 0, 255] } });
  assert.match(nonce.patternSha256, SHA);
  assert.equal(nonce.boundaries.length, 65);
  assert.equal(nonce.boundaries[0], nonce.P.x);
  assert.equal(nonce.boundaries.at(-1), nonce.P.x + nonce.P.width);
  assert.equal(nonce.boundariesStrict, true);
  assert.deepEqual(nonce.boundaries, Array.from({ length: 65 }, (_, index) => nonce.P.x + Math.floor(index * nonce.P.width / 64)));
  assert.equal(nonce.PRowBitsExact, true);
  assert.equal(nonce.PRowEdgesExact, true);
  assert.equal(nonce.PRowCount, nonce.P.height);
  assert.equal(nonce.expectedTransitionCount, nonce.observedTransitionCount);
  assert.deepEqual(nonce.expectedEdges, nonce.patternBits.split('').slice(1).flatMap((bit, index) => bit === nonce.patternBits[index] ? [] : [nonce.boundaries[index + 1]]));
  assert.match(nonce.rowTopologyCanonicalSha256, SHA);
  assert.deepEqual(nonce.gOutsidePExpectedRgb, [255, 0, 255]);
  assert.equal(nonce.gOutsidePExact, true);
  assert.equal(nonce.gOutsidePMismatchPixels, 0);
  assert.equal(nonce.domainPixels, nonce.G.width * nonce.G.height);
  assert.equal(nonce.PDomainPixels, nonce.P.width * nonce.P.height);
  assert.equal(nonce.consumedPixels, nonce.domainPixels);
  assert.equal(nonce.allPixelsConsumed, true);
  assert.match(nonce.expectedRasterRgbaSha256, SHA);
  assert.equal(nonce.canvasReadbackRgbaSha256, nonce.expectedRasterRgbaSha256);
  assert.match(nonce.expectedRasterRgbSha256, SHA);
  assert.equal(nonce.screenshotRasterRgbSha256, nonce.expectedRasterRgbSha256);
  assert.equal(nonce.rasterSha256, nonce.screenshotRasterRgbSha256);
  assert.equal(nonce.layoutBindingVersion, 'viewport-device-raster-layout-binding-v1');
  assert.match(nonce.layoutBindingSha256, SHA);
  assert.equal(nonce.layoutBindingSha256, nonce.actualLayout.layoutBindingSha256);
  assert.match(nonce.actualLayoutSha256, SHA);
  assert.equal(nonce.actualLayoutSha256, sha256(Buffer.from(JSON.stringify(nonce.actualLayout))));
  assert.equal(nonce.mismatchThreshold, 0);
  assert.equal(nonce.mismatchPixels, 0);
  assert.equal(nonce.coverage, 1);
  assert.equal(nonce.challenge.authorityVersion, 'node-csprng-capture-challenge-v1');
  assert.equal(nonce.challenge.entropyBytes, 32);
  assert.equal(nonce.challenge.rawChallengeDisclosed, false);
  assert.match(nonce.challenge.challengeSha256, SHA);
  assert.match(nonce.challenge.bindingKeySha256, SHA);
  assert.equal(nonce.challenge.nonceToken, nonce.nonceToken);
  assert.equal(nonce.challenge.nonceTokenSha256, nonce.nonceTokenSha256);
}

function assertHeadedNormalCanvasRelease(nonce, lifecycleClass) {
  const release = nonce.releaseEvidence; assert.ok(release); assert.equal(release.authorityVersion, 'deterministic-canvas-backing-release-v1'); assert.equal(release.lifecycleClass, lifecycleClass); assert.equal(release.hostCountBefore, 1); assert.equal(release.releasedCanvasCount, 1); assert.deepEqual(release.preBackingStore, nonce.canvasBackingStore); assert.deepEqual(release.expectedBackingStore, nonce.canvasBackingStore); assert.equal(release.preBackingStorePositive, true); assert.equal(release.preBackingStoreExactExpected, true); assert.deepEqual(release.postBackingStore, { width: 0, height: 0 }); assert.equal(release.zeroedBeforeHostRemoval, true); assert.equal(release.hostRemoved, true); assert.equal(release.nonceTokenSha256, nonce.nonceTokenSha256); assert.equal(release.nonceTokenSha256, nonce.challenge.nonceTokenSha256); assert.equal(release.nonceNodeCountAfterRestore, 0); assert.equal(release.rawAttributeAndOwnedStateExact, true); assert.equal(release.historicalCssomDiagnosticOnly, true); assert.equal(release.readOnlySettleBarrierCount, 1); assert.equal(release.postFinalRawReplayCssomStable, true); const formalTrace = release.formalRestorationTrace; assert.equal(formalTrace.authorityVersion, 'presentation-formal-a-barrier-b-stability-v1'); assert.equal(formalTrace.exact, true); assert.deepEqual(formalTrace.canonicalB, formalTrace.canonicalA); assert.equal(formalTrace.immediatePostFinalRawReplay.authorityVersion, 'presentation-formal-immediate-post-final-raw-replay-trace-v1'); assert.equal(formalTrace.barrier.authorityVersion, 'two-raf-bcr-computed-read-only-settle-v1'); assert.equal(formalTrace.barrier.readOnly, true); assert.equal(formalTrace.barrier.rafCount, 2); assert.equal(release.stageBackgroundRestoration.exact, true); assert.deepEqual(release.stageBackgroundRestoration.actual, release.stageBackgroundRestoration.expected); assert.equal(release.postRestoreComputedAndGeometryVerifiedBeforeRepair, true); assert.equal(release.releases.length, 1); const detail = release.releases[0]; assert.equal(detail.hostChildCount, 1); assert.equal(detail.directCanvasCount, 1); assert.deepEqual(detail.backingStores, [{ before: nonce.canvasBackingStore, after: { width: 0, height: 0 }, zeroedWhileHostConnected: true }]); assert.equal(detail.zeroedBeforeHostRemoval, true); assert.equal(detail.hostRemoved, true); assert.equal(detail.nonceTokenSha256, nonce.nonceTokenSha256);
}

function assertHeadedOutputFreshness(freshness, viewport) {
  const expected = { width: viewport.width * viewport.deviceScaleFactor, height: viewport.height * viewport.deviceScaleFactor }; assert.equal(freshness.authorityVersion, 'all-four-plane-destinations-absent-at-capture-start-v1'); assert.equal(freshness.existingCount, 0); assert.deepEqual(freshness.planeNames, ['background', 'solid', 'reference', 'target']); assert.equal(freshness.outputPaths.length, 4); assert.equal(new Set(freshness.outputPaths).size, 4); assert.equal(freshness.noPreclean, true); assert.deepEqual(freshness.expectedDimensions, expected); assert.deepEqual(freshness.completedDimensions, { background: expected, solid: expected, reference: expected, target: expected }); assert.equal(freshness.allPlaneDimensionsExact, true);
}

function assertHeadedAncestorCaptureState(state) {
  const expectedPaint = { filter: 'none', webkitFilter: 'none', backdropFilter: 'none', webkitBackdropFilter: 'none', opacity: '1', mixBlendMode: 'normal', transform: 'none', webkitTransform: 'none', transformStyle: 'flat', webkitTransformStyle: 'flat', perspective: 'none', webkitPerspective: 'none', clipPath: 'none', webkitClipPath: 'none', maskImage: 'none', webkitMaskImage: 'none', contain: 'none', scale: 'none', rotate: 'none', translate: 'none', zoom: '1', imageRendering: 'auto', offsetPath: 'none' }; const expectedPseudo = { content: 'none', filter: 'none', webkitFilter: 'none', backdropFilter: 'none', webkitBackdropFilter: 'none', opacity: '1', mixBlendMode: 'normal', transform: 'none', webkitTransform: 'none', clipPath: 'none', webkitClipPath: 'none', maskImage: 'none', webkitMaskImage: 'none', scale: 'none', rotate: 'none', translate: 'none', isolation: 'auto' }; const chain = state.ancestorChain; assert.equal(chain.valid, true); assert.equal(chain.firstCode, null); assert.equal(chain.canonicalOrder, 'formal-parent-to-html-v1'); assert.equal(chain.pseudoCanonicalOrder, 'formal-then-parent-to-html-before-after-v1'); assert.equal(chain.identityRegistry, 'page-weakmap-and-baseline-map-stable-node-id-v1'); assert.equal(chain.ancestorCount, 5); assert.equal(chain.pseudoRecordCount, 12); assert.equal(chain.identityValid, true); assert.equal(chain.pseudoIdentityValid, true); assert.equal(chain.structuralBlueprintExact, true); assert.equal(chain.stageExact, true); assert.equal(chain.rootExact, true); assert.equal(chain.runtimeNodeIdentityExact, true); assert.equal(chain.paintIdentityExact, true); assert.equal(chain.pseudoPaintIdentityExact, true); assert.equal(chain.firstViolation, null); assert.equal(chain.pseudoFirstViolation, null); assert.deepEqual(chain.paintViolations, []); assert.deepEqual(chain.pseudoPaintViolations, []); assert.deepEqual(chain.expectedPaintIdentity, expectedPaint); assert.deepEqual(chain.expectedPseudoIdentity, expectedPseudo); assert.equal(chain.canonicalSha256, sha256(Buffer.from(JSON.stringify(chain.canonical)))); assert.equal(chain.pseudoCanonicalSha256, sha256(Buffer.from(JSON.stringify(chain.pseudoCanonical)))); assert.equal(state.selectorIdentity.formalTargetNodeIdentity, chain.targetNodeIdentity); assert.ok(Number.isSafeInteger(chain.targetNodeIdentity) && chain.targetNodeIdentity > 0); assert.deepEqual(chain.canonical.map(({ depth, tagName, namespaceURI, id, classAttribute, parentElementIndex }) => ({ depth, tagName, namespaceURI, id, classAttribute, parentElementIndex })), chain.expectedBlueprint); assert.deepEqual(chain.canonical.map((entry) => entry.paint), Array.from({ length: 5 }, () => expectedPaint)); assert.deepEqual(chain.canonical.map((entry) => entry.childNodeIdentity), [chain.targetNodeIdentity, ...chain.canonical.slice(0, -1).map((entry) => entry.nodeIdentity)]); assert.equal(new Set(chain.canonical.map((entry) => entry.nodeIdentity)).size, 5); for (const [index, entry] of chain.pseudoCanonical.entries()) { const ownerIndex = Math.floor(index / 2); const ownerVisibility = ownerIndex === 0 ? state.formalStyle.visibility : 'visible'; assert.equal(entry.ownerKind, ownerIndex === 0 ? 'formal' : 'ancestor'); assert.equal(entry.ownerDepth, ownerIndex - 1); assert.equal(entry.ownerNodeIdentity, ownerIndex === 0 ? chain.targetNodeIdentity : chain.canonical[ownerIndex - 1].nodeIdentity); assert.equal(entry.pseudo, index % 2 === 0 ? '::before' : '::after'); assert.equal(entry.ownerVisibility, ownerVisibility); assert.deepEqual(entry.paint, { ...expectedPseudo, visibility: ownerVisibility }); }
  assert.deepEqual(Object.fromEntries(['webkitFilter', 'webkitBackdropFilter', 'perspective', 'webkitTransform', 'transformStyle', 'webkitTransformStyle', 'webkitPerspective', 'webkitClipPath', 'contain', 'scale', 'rotate', 'translate', 'zoom', 'imageRendering', 'offsetPath'].map((property) => [property, state.formalStyle[property]])), { webkitFilter: 'none', webkitBackdropFilter: 'none', perspective: 'none', webkitTransform: 'none', transformStyle: 'flat', webkitTransformStyle: 'flat', webkitPerspective: 'none', webkitClipPath: 'none', contain: 'none', scale: 'none', rotate: 'none', translate: 'none', zoom: '1', imageRendering: 'auto', offsetPath: 'none' });
}

async function testHeadedProductionPresentation(publicState, revealBundle, chainRoot) {
  const headedRoot = path.join(chainRoot, 'headed-presentation'); mkdirSync(headedRoot, { mode: 0o700 });
  const definitions = [
    ['first', ACTOR_A],
    ['second', ACTOR_B],
    ['source-first-c0', ACTOR_C0],
  ];
  const bundles = [];
  for (const [mode, actor] of definitions) {
    const bundle = path.join(headedRoot, `${mode}-bundle`);
    const prepared = await runCliSuccess(['prepare-bundle', '--mode', mode, '--actor-pseudonym-sha256', actor, '--cycle-id', `${CYCLE}-headed`, '--bundle-dir', bundle]);
    assert.equal(prepared.success.status, 'blind_bundle_prepared'); const manifest = core.parseJsonBuffer(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')), { processArtifact: true }); assert.equal(manifest.mode, mode); assert.equal(manifest.presentationContractSha256, PRESENTATION_CONTRACT_SHA256); bundles.push({ mode, bundle });
  }
  bundles.push({ mode: 'adjudication-reveal', bundle: revealBundle });
  const servers = [];
  try {
    for (const item of bundles) { const server = await startServe(item.bundle); servers.push({ ...item, server, baseUrl: server.base }); }
    const summary = await runHeadedPresentationModes({ modeServers: servers.map(({ mode, baseUrl }) => ({ mode, baseUrl })), publicState, tempDir: path.join(headedRoot, 'captures') });
    assert.equal(summary.chromeProduct, 'Chrome/150.0.7871.114'); assert.equal(summary.classifier.chromeProduct, summary.chromeProduct); assert.deepEqual(summary.classifier.mappings, { background: [], red: ['red'], green: ['green'], blue: ['blue'], orange: ['orange'], cyan: ['cyan'], magenta: ['magenta'] }); assert.equal(summary.classifier.prototypeMappingsPairwiseDistinct, true); assert.equal(summary.modeCount, 4); assert.equal(summary.initialAutoLockStablePlaneCount, FIXTURE.presentationContract.initialAutoLockStablePlaneCount); assert.ok(summary.initialAutoLockScreenshotCaptureCount >= 8 && summary.initialAutoLockScreenshotCaptureCount <= 32); assert.equal(summary.initialAutoLockAttemptPngResidue, 0); assert.equal(summary.realCaptureCount, 176); assert.equal(summary.syntheticCaptureCount, 48); assert.equal(summary.negativeControlCount, 32); assert.equal(summary.transitionCount, 40_000); assert.equal(summary.compositorStablePlaneCount, 996); assert.ok(summary.compositorScreenshotCaptureCount >= 1_992); assert.ok(summary.compositorRetryCaptureCount >= 0); assert.ok(summary.compositorMaxCapturesForPlane >= 2 && summary.compositorMaxCapturesForPlane <= 8); assert.equal(summary.compositorRejectedAttemptPngResidue, 0); assert.deepEqual(summary.staleBackgroundOracles, Array.from({ length: 4 }, () => ({ substitutedPlane: 'background-challenge-a-verified-as-same-case-challenge-b', firstCode: 'presentation_background_nonce_mismatch', failClosedBy: 'capture-csprng-token-bound-viewport-device-raster-nonce-v1-G', sameCaseBindingKeySha256: true, captureChallengeSha256Distinct: true, nonceTokenDistinct: true, distinctPatternSha256: true, distinctPatternBits: true, actualLayoutSha256Stable: true, auxiliaryTargetAsBackgroundFirstCode: 'presentation_background_nonce_mismatch' }))); assert.equal(summary.targetedRealDsf2CaptureCount, 8); assert.equal(summary.targetedDsf2StaleBackgroundOracles.length, 8); assert.ok(summary.targetedDsf2StaleBackgroundOracles.every((oracle) => oracle.firstCode === 'presentation_background_nonce_mismatch' && oracle.sameCaseBindingKeySha256 === true && oracle.captureChallengeSha256Distinct === true)); assert.deepEqual(summary.nonceChallengeFreshness, { authorityVersion: 'node-csprng-capture-challenge-v1', captureCount: 232, uniqueChallengeSha256Count: 232, entropyBytes: 32, allCaptureChallengesUnique: true }); assert.ok(summary.fullSsimMin >= 0.995); assert.ok(summary.bottomQuarterSsimMin >= 0.995); assert.ok(summary.intrinsicDirectSsimMin >= 0.995);
    assert.equal(summary.presentationNonceDomMutationOracleCount, 6);
    assert.deepEqual(summary.presentationNonceDomMutationOracles.map((oracle) => oracle.mutation), ['dom-backing-width-plus-one', 'dom-canvas-css-left-plus-one', 'dom-canvas-css-width-plus-one', 'dom-canvas-transform', 'dom-host-contain-fixed-cb', 'dom-G-readback-one-pixel']);
    assert.deepEqual(summary.presentationNonceDomMutationOracles.map((oracle) => oracle.firstCode), ['presentation_background_nonce_canvas_state_invalid', 'presentation_background_nonce_canvas_state_invalid', 'presentation_background_nonce_canvas_state_invalid', 'presentation_background_nonce_compositor_effect_forbidden', 'presentation_background_nonce_compositor_effect_forbidden', 'presentation_background_nonce_canvas_readback_mismatch']);
    for (const oracle of summary.presentationNonceDomMutationOracles) { assert.equal(oracle.rejectedBeforeContentEligibility, true); assert.equal(oracle.screenshotCaptureCount, 0); assert.equal(oracle.destinationCreated, false); assert.equal(oracle.outputPathAbsent, true); assert.equal(oracle.freshInstallRestoreCycle, true); assert.equal(oracle.exactStyleRestored, true); assert.equal(oracle.rawRestorationContract.rawAttributeAndOwnedStateExact, true); assert.equal(oracle.rawRestorationContract.historicalCssomDiagnosticOnly, true); assert.equal(oracle.rawRestorationContract.readOnlySettleBarrierCount, 1); assert.equal(oracle.rawRestorationContract.readOnlySettleRafCount, 2); assert.equal(oracle.rawRestorationContract.postFinalRawReplayReadOnlySnapshotCount, 2); assert.equal(oracle.rawRestorationContract.postFinalRawReplayCssomStable, true); assert.equal(oracle.nonceNodeCountAfterRestore, 0); assert.deepEqual(oracle.zeroedBackingStore, { width: 0, height: 0 }); assert.match(oracle.nonceTokenSha256, SHA); assert.match(oracle.baselineLayoutSha256, SHA); const release = oracle.releaseEvidence; assert.equal(release.authorityVersion, 'deterministic-canvas-backing-release-v1'); assert.equal(release.lifecycleClass, 'dom-mutation-oracle'); assert.equal(release.hostCountBefore, 1); assert.equal(release.releasedCanvasCount, 1); assert.equal(release.preBackingStorePositive, true); assert.deepEqual(release.postBackingStore, { width: 0, height: 0 }); assert.equal(release.rawAttributeAndOwnedStateExact, true); assert.equal(release.historicalCssomDiagnosticOnly, true); assert.equal(release.readOnlySettleBarrierCount, 1); assert.equal(release.postFinalRawReplayCssomStable, true); assert.equal(release.formalRestorationTrace.authorityVersion, 'presentation-formal-a-barrier-b-stability-v1'); assert.equal(release.formalRestorationTrace.exact, true); assert.deepEqual(release.formalRestorationTrace.canonicalB, release.formalRestorationTrace.canonicalA); assert.equal(release.stageBackgroundRestoration.exact, true); assert.deepEqual(release.stageBackgroundRestoration.actual, release.stageBackgroundRestoration.expected); assert.equal(release.postRestoreComputedAndGeometryVerifiedBeforeRepair, true); assert.equal(release.zeroedBeforeHostRemoval, true); assert.equal(release.hostRemoved, true); assert.equal(release.nonceTokenSha256, oracle.nonceTokenSha256); assert.equal(release.nonceNodeCountAfterRestore, 0); }
    assert.deepEqual(summary.normalCanvasRelease, { authorityVersion: 'deterministic-canvas-backing-release-v1', lifecycleCount: 232, breakdown: { real: 176, synthetic: 48, 'negative-baseline': 8 }, uniqueNonceTokenSha256Count: 232, allPreBackingStoresPositiveAndExactExpected: true, allPostBackingStoresZero: true, allReleasedCanvasCountOne: true, allZeroedBeforeHostRemoval: true, allHostsRemoved: true, allNonceNodeCountsZero: true, allRawAttributeAndOwnedStateExact: true, allHistoricalCssomDiagnosticOnly: true, allPostFinalRawReplayCssomStable: true, allPostRestoreComputedAndGeometryVerifiedBeforeRepair: true, domMutationOracleReleasesExcluded: true }); assert.equal(summary.presentationRestoreSemanticVerificationCount, 238); assert.equal(summary.negativeRestoreSemanticVerificationCount, 72); assert.equal(summary.negativeMutationRestorationEvidences.length, 64); assert.equal(summary.negativeOuterRestorationEvidences.length, 8); assert.equal(summary.negativeBaselineNonceContextEvidences.length, 8);
    assert.equal(summary.ancestorCompositorGuardOracles.length, 4); for (const oracle of summary.ancestorCompositorGuardOracles) { assertHeadedAncestorCspStyleReplayOracle(oracle.cspRawStyleReplayBaselineOracle); const expectedAncestorFinalWriteKind = oracle.cspRawStyleReplayBaselineOracle.baselineKind === 'absent' ? 'absent-remove-attribute' : oracle.cspRawStyleReplayBaselineOracle.baselineKind === 'present-empty' ? 'present-empty-set-attribute' : 'present-nonempty-cssom-assignment'; assertHeadedCspStyleReplayEvidence(oracle.transitionalReplayEvidence, { currentHasAttribute: true, finalWriteKind: expectedAncestorFinalWriteKind }); assertHeadedCspStyleReplayEvidence(oracle.finalReplayEvidence, { currentHasAttribute: oracle.baselineRawStyleState.hasAttribute, finalWriteKind: expectedAncestorFinalWriteKind }); assert.equal(oracle.mutation, 'ancestor-palette-preserving-component-transfer-filter'); assert.equal(oracle.firstCode, 'presentation_ancestor_compositor_effect_forbidden'); assert.equal(oracle.snapshotFirstCode, oracle.firstCode); assert.equal(oracle.rejectedBeforeContentEligibility, true); assert.equal(oracle.screenshotCaptureCount, 0); assert.equal(oracle.destinationCreated, false); assert.equal(oracle.filter.svgPrimitive, 'feComponentTransfer-discrete-256-entry'); assert.deepEqual(oracle.filter.palettePreservedComponents, [0, 24, 32, 48, 192, 255]); assert.equal(oracle.filter.palettePreservationExact, true); assert.deepEqual(oracle.filter.generalMutation, { input: 17, output: 18 }); assert.equal(oracle.baselineAncestorChainSha256, oracle.restoredAncestorChainSha256); assert.equal(oracle.transitionalRawStyleState.cssText, oracle.baselineRawStyleState.cssText); assert.equal(oracle.settledCssText, oracle.baselineRawStyleState.cssText); assert.deepEqual(oracle.finalRawRestoration, oracle.baselineRawStyleState); assert.deepEqual(oracle.finalRawVerification, oracle.baselineRawStyleState); assert.equal(oracle.exactInlineStyleRestored, true); assert.equal(oracle.oracleSvgCountAfterRestore, 0); assert.equal(oracle.formalTargetNodeIdentityStable, true); }
    assert.equal(summary.pseudoCompositorGuardOracles.length, 4); for (const oracle of summary.pseudoCompositorGuardOracles) { assert.equal(oracle.mutation, 'ancestor-after-palette-preserving-backdrop-filter'); assert.equal(oracle.firstCode, 'presentation_pseudo_compositor_effect_forbidden'); assert.equal(oracle.snapshotFirstCode, oracle.firstCode); assert.equal(oracle.rejectedBeforeContentEligibility, true); assert.equal(oracle.screenshotCaptureCount, 0); assert.equal(oracle.destinationCreated, false); assert.equal(oracle.pseudo.pseudo, '::after'); assert.equal(oracle.pseudo.svgPrimitive, 'feComponentTransfer-discrete-256-entry-backdrop-filter'); assert.deepEqual(oracle.pseudo.palettePreservedComponents, [0, 24, 32, 48, 192, 255]); assert.equal(oracle.pseudo.palettePreservationExact, true); assert.deepEqual(oracle.pseudo.generalMutation, { input: 17, output: 18 }); assert.notEqual(oracle.pseudo.computed.content, 'none'); assert.ok(oracle.pseudo.computed.backdropFilter !== 'none' || oracle.pseudo.computed.webkitBackdropFilter !== 'none'); assert.equal(oracle.injectedStyleElementCount, 0); assert.equal(oracle.cssom.sheetOrigin, oracle.cssom.pageOrigin); assert.equal(oracle.cssom.sheetOrigin, new URL(oracle.cssom.sheetHref).origin); assert.deepEqual(oracle.cssom.ownerLink, { tagName: 'LINK', relAttribute: 'stylesheet', hrefAttribute: '/style.css', absoluteHref: oracle.cssom.sheetHref, sheetOwnerExact: true }); assert.equal(oracle.cssom.preRulesCssText.length, oracle.cssom.preRuleCount); assert.equal(oracle.cssom.preRuleCanonicalSha256, sha256(Buffer.from(JSON.stringify(oracle.cssom.preRulesCssText)))); assert.equal(oracle.cssom.insertedRuleIndex, oracle.cssom.preRuleCount); assert.equal(oracle.cssom.returnedRuleIndex, oracle.cssom.insertedRuleIndex); assert.equal(oracle.cssom.markerProperty, '--sam-goal-pseudo-oracle-id'); assert.match(oracle.cssom.insertedRuleCssText, new RegExp(oracle.cssom.insertedRuleMarker, 'u')); assert.equal(oracle.cssom.cssomInsertRuleApplied, true); assert.equal(oracle.cssom.cssomDeleteRuleApplied, true); assert.equal(oracle.cssom.markerRuleCountBeforeCleanup, 1); assert.equal(oracle.cssom.markerRuleCountAfterCleanup, 0); assert.equal(oracle.cssom.exactRulesRestored, true); assert.deepEqual(oracle.cssom.postRulesCssText, oracle.cssom.preRulesCssText); assert.equal(oracle.cssom.postRuleCount, oracle.cssom.preRuleCount); assert.equal(oracle.cssom.postRuleCanonicalSha256, oracle.cssom.preRuleCanonicalSha256); assert.equal(oracle.baselineAncestorChainSha256, oracle.restoredAncestorChainSha256); assert.equal(oracle.baselinePseudoCanonicalSha256, oracle.restoredPseudoCanonicalSha256); assert.equal(oracle.exactInlineStylesRestored, true); assert.equal(oracle.exactTargetAndAncestorIdsRestored, true); assert.equal(oracle.svgCountAfterRestore, 0); }
    assert.equal(summary.negativeFrozenNonceCorruptionOracleCount, 48); assert.equal(summary.negativeFrozenNonceCorruptionOracles.length, 8); assert.deepEqual(summary.negativeFrozenNonceCorruptionOracles, summary.modes.flatMap((mode) => mode.negativeFrozenNonceCorruptionOracles)); assert.equal(summary.negativePreparationEvidences.length, 8); assert.deepEqual(summary.negativePreparationEvidences, summary.modes.flatMap((mode) => mode.negativePreparationEvidences)); assert.equal(summary.negativeStyleAttributeTransitions.length, 4); assert.deepEqual(summary.negativeStyleAttributeTransitions, summary.modes.map((mode) => mode.negativeStyleAttributeTransition));
    for (const mode of summary.modes) {
      const initial = mode.initialAutoLockEvidence; assert.equal(initial.passiveReadiness.passive, true); assert.equal(initial.passiveReadiness.motionMetadataSettled, true); assert.equal(initial.passiveReadiness.preScrollLayoutStability.requiredConsecutive, 3); assert.ok(initial.passiveReadiness.preScrollLayoutStability.captures >= 3 && initial.passiveReadiness.preScrollLayoutStability.captures <= 8); assert.equal(initial.viewportPreparation.stability.requiredConsecutive, 2); assert.deepEqual(initial.identity, initial.publicSourceRow); assert.ok(initial.intrinsic.directExactStillSsim >= 0.995); assert.equal(initial.visiblePlane.stablePlaneCount, 1); assert.equal(initial.visiblePlane.screenshotCaptureCount, initial.visiblePlane.compositorStability.captures); assert.equal(initial.visiblePlane.destinationDeleted, true); assert.equal(initial.visiblePlane.attemptPngResidue, 0); assert.equal(mode.compositorStabilities.some((stability) => stability.state === 'preVisible'), false);
      assertHeadedAncestorCaptureState(initial.visiblePlane.compositorStability.expectedState); const targetNodeIdentities = new Set(); for (const stability of mode.compositorStabilities) { assertHeadedAncestorCaptureState(stability.expectedState); targetNodeIdentities.add(stability.expectedState.selectorIdentity.formalTargetNodeIdentity); } assert.equal(targetNodeIdentities.size, 1); assert.equal(targetNodeIdentities.has(initial.visiblePlane.compositorStability.expectedState.selectorIdentity.formalTargetNodeIdentity), true); assert.deepEqual(mode.ancestorCompositorGuardOracle, summary.ancestorCompositorGuardOracles[summary.modes.indexOf(mode)]); assert.deepEqual(mode.pseudoCompositorGuardOracle, summary.pseudoCompositorGuardOracles[summary.modes.indexOf(mode)]);
      assert.equal(mode.real.length, 44); assert.equal(mode.real.filter((record) => record.targetedDsf2).length, 2); for (const record of mode.real) { assert.deepEqual(record.planeNames, ['background', 'solid', 'reference', 'target']); assert.deepEqual(record.planeCompositorStability.map((stability) => stability.state), record.planeNames); assertHeadedPhysicalRasterAuthority(record.physicalRasterAuthority); assert.deepEqual(record.measuredPhysicalRasterBbox, record.physicalRasterAuthority.F.observedCoverageBbox); assert.deepEqual(record.solidWhiteOracle, record.physicalRasterAuthority.solidWhiteOracle); assert.equal(record.solidWhiteOracle.exact, true); assert.deepEqual(record.solidWhiteOracle.region, record.physicalRasterAuthority.safeInterior); assert.equal(record.referenceTargetGuardEquality.exact, true); assert.deepEqual(record.referenceTargetGuardEquality.region, record.physicalRasterAuthority.domains.G); assert.equal(record.referenceTargetGuardEquality.mismatchPixels, 0); for (const coverage of [record.referenceObservedCoverage, record.targetObservedCoverage]) { assert.ok(coverage.changedPixels > 0 && coverage.observedCoverageBbox); assert.equal(coverage.outsidePhysicalMaskChangedPixels, 0); assert.match(coverage.maskCanonicalSha256, SHA); assert.match(coverage.rowSpanCanonicalSha256, SHA); } assertHeadedActualNonceLayout(record.backgroundNonce); assertHeadedNormalCanvasRelease(record.backgroundNonce, 'real'); assertHeadedOutputFreshness(record.outputFreshness, record.viewport); if (record.targetedDsf2) { assert.equal(record.clipId, 'shorts-vc0GDveRIp0-16x9-padded'); assert.equal(record.sourceFrameIndex, 0); assert.equal(record.viewport.deviceScaleFactor, 2); assert.equal(record.staleBackgroundOracle.firstCode, 'presentation_background_nonce_mismatch'); } for (const stability of record.planeCompositorStability) { assert.deepEqual(stability.expectedState.backgroundNonceNode.hostRect, stability.expectedState.geometry.targetRect); assert.deepEqual(stability.expectedState.backgroundNonceNode.hostRect, record.backgroundNonce.formalTargetRect); assert.equal(stability.expectedState.backgroundNonceNode.layoutSha256, record.backgroundNonce.actualLayoutSha256); assert.equal(stability.expectedState.backgroundNonceNode.layoutAttributeSha256, record.backgroundNonce.actualLayoutSha256); assert.equal(stability.expectedState.backgroundNonceNode.layoutValid, true); assert.equal(stability.expectedState.backgroundNonceNode.paintedDomStripeCount, 0); assert.deepEqual(stability.expectedState.backgroundNonceNode.canvasRect, record.backgroundNonce.canvasCssRect); assert.deepEqual(stability.expectedState.backgroundNonceNode.canvasBackingStore, record.backgroundNonce.canvasBackingStore); assert.equal(stability.expectedState.backgroundNonceNode.canvasReadbackRgbaSha256, record.backgroundNonce.canvasReadbackRgbaSha256); } }
      for (const record of mode.synthetic) { const coverage = record.syntheticCoverage; assert.deepEqual(record.planeNames, ['background', 'solid', 'reference', 'target']); assert.deepEqual(record.planeCompositorStability.map((stability) => stability.state), record.planeNames); assertHeadedPhysicalRasterAuthority(record.physicalRasterAuthority); assert.deepEqual(record.solidWhiteOracle, record.physicalRasterAuthority.solidWhiteOracle); assert.equal(record.solidWhiteOracle.exact, true); assert.deepEqual(record.solidWhiteOracle.region, record.physicalRasterAuthority.safeInterior); assert.equal(record.referenceTargetGuardEquality.exact, true); assert.equal(coverage.referenceTargetGuardEquality.exact, true); assert.deepEqual(coverage.fullyContainedInterior, record.physicalRasterAuthority.safeInterior); assert.equal(coverage.referenceInteriorCoverage.changedPixels, coverage.interiorArea); assert.equal(coverage.targetInteriorCoverage.changedPixels, coverage.interiorArea); assert.equal(coverage.referenceInteriorCoverage.observedPixelsRectangular, true); assert.equal(coverage.targetInteriorCoverage.observedPixelsRectangular, true); assert.equal(coverage.referenceEdgeCoverage.outsidePhysicalMaskChangedPixels, 0); assert.equal(coverage.targetEdgeCoverage.outsidePhysicalMaskChangedPixels, 0); assert.equal(coverage.referenceSentinels.exact, true); assert.equal(coverage.targetSentinels.exact, true); assert.equal(coverage.referenceSentinels.sampleCount, 7); assert.equal(coverage.targetSentinels.sampleCount, 7); assertHeadedActualNonceLayout(record.backgroundNonce); assertHeadedNormalCanvasRelease(record.backgroundNonce, 'synthetic'); assertHeadedOutputFreshness(record.outputFreshness, record.viewport); for (const stability of record.planeCompositorStability) { assert.deepEqual(stability.expectedState.backgroundNonceNode.hostRect, stability.expectedState.geometry.targetRect); assert.deepEqual(stability.expectedState.backgroundNonceNode.hostRect, record.backgroundNonce.formalTargetRect); assert.equal(stability.expectedState.backgroundNonceNode.layoutSha256, record.backgroundNonce.actualLayoutSha256); assert.equal(stability.expectedState.backgroundNonceNode.layoutAttributeSha256, record.backgroundNonce.actualLayoutSha256); assert.equal(stability.expectedState.backgroundNonceNode.paintedDomStripeCount, 0); assert.deepEqual(stability.expectedState.backgroundNonceNode.canvasRect, record.backgroundNonce.canvasCssRect); assert.deepEqual(stability.expectedState.backgroundNonceNode.canvasBackingStore, record.backgroundNonce.canvasBackingStore); assert.equal(stability.expectedState.backgroundNonceNode.canvasReadbackRgbaSha256, record.backgroundNonce.canvasReadbackRgbaSha256); } }
      assert.deepEqual(mode.negativeBaselineCoverages.map((coverage) => coverage.deviceScaleFactor), [1, 2]); for (const coverage of mode.negativeBaselineCoverages) { assert.deepEqual(coverage.planeNames, ['background', 'solid', 'reference', 'target']); assertHeadedPhysicalRasterAuthority(coverage.physicalRasterAuthority); assertHeadedActualNonceLayout(coverage.backgroundNonce); assertHeadedNormalCanvasRelease(coverage.backgroundNonce, 'negative-baseline'); assertHeadedOutputFreshness(coverage.outputFreshness, { width: 1440, height: 1000, deviceScaleFactor: coverage.deviceScaleFactor }); assertHeadedFrozenNegativeBaseline(coverage); assert.equal(coverage.referenceTargetGuardEquality.exact, true); }
      assert.deepEqual(mode.negativeFrozenNonceCorruptionOracles.map((oracle) => oracle.deviceScaleFactor), [1, 2]); for (const oracle of mode.negativeFrozenNonceCorruptionOracles) assertHeadedFrozenNonceCorruptionOracle(oracle, mode.negativeBaselineCoverages.find((coverage) => coverage.deviceScaleFactor === oracle.deviceScaleFactor)); assert.deepEqual(mode.negativePreparationEvidences.map((item) => item.deviceScaleFactor), [1, 2]); for (const item of mode.negativePreparationEvidences) assertHeadedNegativePreparation(item); assertHeadedNegativeStyleAttributeTransition(mode.negativeStyleAttributeTransition); assert.deepEqual(mode.negativeOuterRestorationEvidences.map((item) => item.deviceScaleFactor), [1, 2]); for (const item of mode.negativeOuterRestorationEvidences) { assert.equal(item.rawAttributeAndOwnedStateExact, true); assert.equal(item.historicalCssomDiagnosticOnly, true); assert.equal(item.postFinalRawReplayCssomStable, true); assert.deepEqual(item.restoredStageAlignment, { inline: '', computed: 'center' }); const restorationTrace = item.restorationTrace; assert.equal(restorationTrace.authorityVersion, 'negative-original-outer-restoration-trace-v1'); assertHeadedAlignedFormalTrace(restorationTrace.preOuterCleanup, item.deviceScaleFactor, 'pre-outer-cleanup'); assert.equal(restorationTrace.postOuterCleanup.stage.inline.alignItems, ''); assert.equal(restorationTrace.postOuterCleanup.stage.computed.alignItems, 'center'); const stage = item.stageRestorationEvidence; assert.equal(stage.authorityVersion, 'presentation-stage-raw-nonce-computed-geometry-restoration-v1'); assert.equal(stage.exact, true); assert.deepEqual(stage.actual, stage.expected); assert.equal(stage.expected.stageStyle.backgroundColor, 'rgb(5, 7, 11)'); assert.equal(stage.actual.stageStyle.backgroundColor, 'rgb(5, 7, 11)'); assert.equal(stage.expected.backgroundNonce, null); assert.equal(stage.actual.backgroundNonce, null); assert.equal(stage.expected.backgroundNonceNodeCount, 0); assert.equal(stage.actual.backgroundNonceNodeCount, 0); assert.deepEqual(stage.actual.stageInlineStyle, stage.expected.stageInlineStyle); assert.deepEqual(stage.actual.formalRect, stage.expected.formalRect); assert.deepEqual(stage.actual.geometry, stage.expected.geometry); assert.deepEqual(restorationTrace.postOuterCleanup.projection.formalRect, stage.actual.formalRect); assert.deepEqual(restorationTrace.postOuterCleanup.projection.geometry, stage.actual.geometry); assert.deepEqual({ backgroundColor: restorationTrace.postOuterCleanup.stage.computed.backgroundColor, backgroundImage: restorationTrace.postOuterCleanup.stage.computed.backgroundImage }, stage.actual.stageStyle); assert.match(item.strictProjectionSha256, SHA); assert.match(item.formalIntrinsicImageDataSha256, SHA); assert.equal(item.postRestoreComputedAndGeometryVerifiedBeforeRepair, true); assert.equal(item.postRestoreRepairWrites, 0); }
      for (const negative of mode.negatives) { assert.deepEqual(negative.contentProbes.map((probe) => probe.deviceScaleFactor), [1, 2]); for (const probe of negative.contentProbes) { assertHeadedFrozenNegativeProbe(probe, mode.negativeBaselineCoverages.find((coverage) => coverage.deviceScaleFactor === probe.deviceScaleFactor)); if (negative.mutation === 'legacy-intrinsic-scroll-layout') { const preparation = mode.negativePreparationEvidences.find((item) => item.deviceScaleFactor === probe.deviceScaleFactor), transition = preparation.legacyTransitionOracle, dpr = probe.deviceScaleFactor, alignedRect = preparation.alignmentPolicyTransition.after.targetRect, actualLegacyRect = probe.frozenNonceAuthority.currentSelectedGeometry.targetRect, physicalEdges = { left: actualLegacyRect.left * dpr, top: actualLegacyRect.top * dpr, right: actualLegacyRect.right * dpr, bottom: actualLegacyRect.bottom * dpr }; assert.deepEqual(actualLegacyRect, transition.expectedTargetRect); assert.equal(Object.values(physicalEdges).every(Number.isSafeInteger), true); assert.equal((alignedRect.left - actualLegacyRect.left) * dpr, 18 * dpr); assert.equal((actualLegacyRect.right - alignedRect.right) * dpr, 18 * dpr); assert.deepEqual(probe.mutationViewportState.formalRect, actualLegacyRect); assert.equal(probe.mutationViewportState.formalRect.top, transition.alignedFormalTopCssPx); assert.equal(probe.mutationViewportState.stageRect.top, transition.alignedStageTopCssPx); assert.equal(probe.mutationViewportState.formalStageTopDeltaCssPx, transition.formalStageTopDeltaCssPx); assert.equal(probe.mutationViewportState.formalRect.top - probe.mutationViewportState.stageRect.top, transition.formalStageTopDeltaCssPx); assert.equal(probe.geometryFirstCode, 'presentation_clipping_ancestor'); assert.equal(probe.content.mutationSignature.signature, 'legacy-exact-mutated-geometry-v1'); assert.equal(probe.content.mutationSignature.exactRgb, true); assert.deepEqual(probe.mutationViewportState.rootScroll, probe.frozenNonceAuthority.currentSelectedGeometry.scroll); assert.deepEqual(probe.mutationViewportState.stageScroll, { left: 0, top: 0 }); } } }
    }
    for (const mode of summary.modes) for (const negative of mode.negatives.filter((item) => item.mutation.startsWith('one-pixel-'))) for (const probe of negative.contentProbes) {
      const edge = negative.mutation.slice('one-pixel-'.length, -'-clip'.length), dpr = probe.deviceScaleFactor, baseline = mode.negativeBaselineCoverages.find((coverage) => coverage.deviceScaleFactor === dpr), signature = probe.content.mutationSignature, nominalD = baseline.physicalRasterAuthority.domains.D, preMeasuredF = baseline.physicalRasterAuthority.F.observedCoverageBbox, nominalEdges = { top: nominalD.y, right: nominalD.x + nominalD.width, bottom: nominalD.y + nominalD.height, left: nominalD.x }, measuredEdges = { top: preMeasuredF.y, right: preMeasuredF.x + preMeasuredF.width, bottom: preMeasuredF.y + preMeasuredF.height, left: preMeasuredF.x }, nearEdge = edge === 'top' || edge === 'left', signedGapDevicePixels = nearEdge ? measuredEdges[edge] - nominalEdges[edge] : nominalEdges[edge] - measuredEdges[edge], compensationDevicePixels = Math.max(0, signedGapDevicePixels), requestedMeasuredBandDevicePixels = dpr, appliedInsetDevicePixels = compensationDevicePixels + requestedMeasuredBandDevicePixels, appliedInsetCssPx = appliedInsetDevicePixels / dpr, appliedInsetsCssPx = { top: 0, right: 0, bottom: 0, left: 0 }, expectedTargetObservedCoverageBbox = { ...preMeasuredF }; appliedInsetsCssPx[edge] = appliedInsetCssPx;
      if (edge === 'top') { expectedTargetObservedCoverageBbox.y += dpr; expectedTargetObservedCoverageBbox.height -= dpr; } else if (edge === 'right') expectedTargetObservedCoverageBbox.width -= dpr; else if (edge === 'bottom') expectedTargetObservedCoverageBbox.height -= dpr; else { expectedTargetObservedCoverageBbox.x += dpr; expectedTargetObservedCoverageBbox.width -= dpr; }
      const expectedPreMeasuredFEdgeDevicePx = measuredEdges[edge], expectedPostMeasuredFEdgeDevicePx = nearEdge ? expectedPreMeasuredFEdgeDevicePx + dpr : expectedPreMeasuredFEdgeDevicePx - dpr, requestedClipPathCssText = `inset(${[appliedInsetsCssPx.top, appliedInsetsCssPx.right, appliedInsetsCssPx.bottom, appliedInsetsCssPx.left].map((value) => `${value}px`).join(' ')})`, intersectionLeft = Math.max(expectedTargetObservedCoverageBbox.x, nominalD.x), intersectionTop = Math.max(expectedTargetObservedCoverageBbox.y, nominalD.y), intersectionRight = Math.min(expectedTargetObservedCoverageBbox.x + expectedTargetObservedCoverageBbox.width, nominalD.x + nominalD.width), intersectionBottom = Math.min(expectedTargetObservedCoverageBbox.y + expectedTargetObservedCoverageBbox.height, nominalD.y + nominalD.height), expectedArea = expectedTargetObservedCoverageBbox.width * expectedTargetObservedCoverageBbox.height, expectedInside = Math.max(0, intersectionRight - intersectionLeft) * Math.max(0, intersectionBottom - intersectionTop), expectedOutside = expectedArea - expectedInside, expectedMismatchPixels = (edge === 'top' || edge === 'bottom' ? preMeasuredF.width : preMeasuredF.height) * dpr, binding = signature.baselineBinding, applied = signature.appliedClipPath, plan = applied.plan, { planCanonicalSha256, ...canonicalPlan } = plan;
      assert.ok(dpr === 1 || dpr === 2); assert.equal([nominalD.x, nominalD.y, nominalD.width, nominalD.height, preMeasuredF.x, preMeasuredF.y, preMeasuredF.width, preMeasuredF.height, ...Object.values(nominalEdges), ...Object.values(measuredEdges)].every(Number.isSafeInteger), true); assert.ok(preMeasuredF.width > dpr && preMeasuredF.height > dpr); assert.equal(Number.isSafeInteger(signedGapDevicePixels), true); assert.equal(Number.isSafeInteger(compensationDevicePixels), true); assert.equal(Number.isSafeInteger(appliedInsetDevicePixels), true); assert.equal(appliedInsetCssPx * dpr, appliedInsetDevicePixels); if (edge === 'bottom') assert.ok(signedGapDevicePixels >= 0);
      assert.equal(negative.geometryFirstCode, 'presentation_clip_path_forbidden'); assert.equal(probe.geometryFirstCode, 'presentation_clip_path_forbidden'); assert.equal(signature.signature, `one-measured-css-pixel-${edge}-band-exact-v1`); assert.equal(signature.mutationContract, 'one-measured-css-pixel-edge-band-v1'); assert.equal(signature.edgePlanAuthorityVersion, 'negative-measured-f-edge-clip-plan-v2'); assert.equal(signature.requestedMeasuredBandCssPx, 1); assert.equal(signature.requestedMeasuredBandDevicePixels, dpr); assert.equal(signature.signedGapDevicePixels, signedGapDevicePixels); assert.equal(signature.compensationDevicePixels, compensationDevicePixels); assert.equal(signature.appliedInsetDevicePixels, appliedInsetDevicePixels); assert.equal(signature.appliedInsetCssPx, appliedInsetCssPx); assert.deepEqual(signature.appliedInsetsCssPx, appliedInsetsCssPx); assert.equal(signature.requestedClipPathCssText, requestedClipPathCssText); assert.equal(signature.preMeasuredFEdgeDevicePx, expectedPreMeasuredFEdgeDevicePx); assert.equal(signature.postMeasuredFEdgeDevicePx, expectedPostMeasuredFEdgeDevicePx); assert.deepEqual(signature.preMeasuredF, preMeasuredF); assert.deepEqual(signature.expectedPostMeasuredF, expectedTargetObservedCoverageBbox); assert.equal(signature.planComputedOnceFromFrozenBaseline, true); assert.equal(signature.adaptiveReplanForbidden, true); assert.equal(signature.exact, true); assert.equal(signature.partitionExact, true); assert.equal(signature.measuredBandVisibilityExact, true);
      assert.equal(binding.authorityVersion, 'negative-measured-f-edge-baseline-binding-v1'); assert.equal(binding.dpr, dpr); assert.deepEqual(binding.nominalD, nominalD); assert.deepEqual(binding.runtimeMeasuredF, preMeasuredF); assert.deepEqual(binding.publicMeasuredF, preMeasuredF); assert.deepEqual(binding.frozenScreenshotMeasuredF, baseline.frozenNonceAuthority.screenshotBinding.measuredF); assert.deepEqual(binding.frozenScreenshotMeasuredF, preMeasuredF); assert.equal(binding.runtimeMeasuredFMaskCanonicalSha256, baseline.physicalRasterAuthority.F.maskCanonicalSha256); assert.equal(binding.publicMeasuredFMaskCanonicalSha256, baseline.physicalRasterAuthority.F.maskCanonicalSha256); assert.equal(binding.frozenScreenshotMeasuredFMaskCanonicalSha256, baseline.frozenNonceAuthority.screenshotBinding.measuredFMaskCanonicalSha256); assert.equal(binding.runtimeMeasuredFMaskCanonicalSha256, binding.frozenScreenshotMeasuredFMaskCanonicalSha256); assert.equal(binding.caseBindingKeySha256, baseline.frozenNonceAuthority.caseBindingKeySha256); assert.equal(binding.frozenAuthoritySha256, baseline.frozenNonceAuthority.authoritySha256); assert.equal(signature.baselineBindingSha256, sha256(Buffer.from(JSON.stringify(binding)))); assert.equal(plan.baselineBindingSha256, signature.baselineBindingSha256); assert.equal(planCanonicalSha256, signature.planCanonicalSha256); assert.equal(planCanonicalSha256, sha256(Buffer.from(JSON.stringify(canonicalPlan))));
      assert.deepEqual(plan.nominalD, nominalD); assert.deepEqual(plan.preMeasuredF, preMeasuredF); assert.deepEqual(plan.expectedPostMeasuredF, expectedTargetObservedCoverageBbox); assert.equal(plan.signedGapDevicePixels, signedGapDevicePixels); assert.equal(plan.compensationDevicePixels, compensationDevicePixels); assert.equal(plan.appliedInsetDevicePixels, appliedInsetDevicePixels); assert.equal(plan.appliedInsetCssPx, appliedInsetCssPx); assert.deepEqual(plan.appliedInsetsCssPx, appliedInsetsCssPx); assert.equal(plan.requestedClipPathCssText, requestedClipPathCssText); assert.equal(applied.preApplyNominalDExact, true); assert.deepEqual(applied.preApplyNominalD, nominalD); assert.equal(applied.baselineBindingExact, true); assert.equal(applied.baselineBindingSha256Exact, true); assert.equal(applied.planCanonicalSha256Exact, true); assert.equal(applied.bcrExact, true); assert.equal(applied.stageBcrExact, true); assert.equal(applied.rootScrollExact, true); assert.equal(applied.stageScrollExact, true); assert.deepEqual(applied.preApplyFormalRect, applied.postApplyFormalRect); assert.deepEqual(applied.preApplyStageRect, applied.postApplyStageRect); assert.deepEqual(applied.preApplyScroll, applied.postApplyScroll); assert.deepEqual(applied.preApplyStageScroll, applied.postApplyStageScroll); assert.equal(applied.requestedClipPathCssText, requestedClipPathCssText); assert.deepEqual(applied.inlineInsetsCssPx, appliedInsetsCssPx); assert.deepEqual(applied.computedInsetsCssPx, appliedInsetsCssPx); assert.equal(applied.inlineClipPathPlanExact, true); assert.equal(applied.computedClipPathPlanExact, true); assert.notEqual(applied.inlineClipPath, 'none'); assert.notEqual(applied.computedClipPath, 'none');
      assert.deepEqual(signature.nominalD, nominalD); assert.deepEqual(signature.expectedTargetObservedCoverageBbox, expectedTargetObservedCoverageBbox); assert.deepEqual(signature.targetObservedCoverageBbox, expectedTargetObservedCoverageBbox); assert.equal(signature.expectedMismatchPixels, expectedMismatchPixels); assert.equal(probe.content.presentationMismatchPixels, expectedMismatchPixels); assert.equal(probe.content.pageTakeoverPixels, expectedMismatchPixels); assert.equal(probe.content.edgeMismatchPixels[edge], expectedMismatchPixels); assert.equal(signature.expectedChangedPixels, expectedArea); assert.equal(signature.expectedInsideGeometryChangedPixels, expectedInside); assert.equal(signature.expectedOutsideGeometryChangedPixels, expectedOutside); assert.equal(signature.insideGeometryChangedPixels, expectedInside); assert.equal(signature.outsideGeometryChangedPixels, expectedOutside); assert.equal(signature.insideGeometryChangedPixels + signature.outsideGeometryChangedPixels, signature.expectedChangedPixels); assert.match(signature.antiStaleRegionSha256, SHA); assert.ok(signature.antiStaleForbiddenRegionSha256Count >= 2); assert.equal(signature.antiStaleSourceCount, signature.antiStaleSourceDifferences.length); assert.ok(signature.antiStaleSourceCount >= 3); assert.equal(signature.antiStaleSourceDifferences.every((item) => item.different === true && SHA.test(item.regionSha256) && item.regionSha256 !== signature.antiStaleRegionSha256), true); assert.equal(signature.antiStaleEachSourceDifferenceExact, true); assert.equal(signature.antiStaleDifferenceExact, true);
    }
    assert.equal(summary.colorProfile, 'srgb-forced'); assert.equal(summary.classifier.forceColorProfile, 'srgb'); assert.equal(summary.classifier.calibrationDomainsByteExact, true); assert.deepEqual(summary.classifier.rawScreenshotPrototypes, summary.classifier.ffmpegRgb24Prototypes); assert.match(readFileSync(HEADED_CDP_HELPER, 'utf8'), /'--force-color-profile=srgb'/u); for (const mode of summary.modes) for (const stability of mode.compositorStabilities) { assert.equal(stability.colorProfile, 'srgb-forced'); assert.deepEqual(stability.pngMetadata.colorChunks, []); assert.deepEqual([...new Set(stability.pngMetadata.chunkTypes)], ['IHDR', 'IDAT', 'IEND']); assert.equal(stability.pngMetadata.colorType, 2); }
    assert.deepEqual(Object.keys(summary.compositorFailureOracles), ['stateDrift', 'staleRegion', 'changingRegion']); for (const oracle of Object.values(summary.compositorFailureOracles)) { assert.equal(oracle.firstCode, 'presentation_compositor_unstable'); assert.equal(oracle.screenshotCaptureCount, 8); assert.equal(oracle.attempts, 8); assert.equal(oracle.destinationCreated, false); assert.equal(oracle.attemptPngResidue, 0); } assert.equal(summary.compositorFailureOracles.changingRegion.uniqueRegionSha256Count, 8);
    evidence.headedPresentation = summary; evidence.counts.headedPresentationModes = summary.modeCount; evidence.counts.headedPresentationInitialAutoLockStablePlanes = summary.initialAutoLockStablePlaneCount; evidence.counts.headedPresentationRealCaptures = summary.realCaptureCount; evidence.counts.headedPresentationSyntheticCaptures = summary.syntheticCaptureCount; evidence.counts.headedPresentationNegativeControls = summary.negativeControlCount; evidence.counts.headedPresentationTransitions = summary.transitionCount; evidence.hashes.headedPresentationEvidenceSha256 = summary.evidenceSha256;
  } finally {
    for (const { server } of servers.reverse()) await stopServe(server).catch(() => {});
  }
  for (const { bundle } of bundles) { assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false); assert.equal(pathExists(path.join(bundle, 'mutable/actor-attestation.json')), false); }
  assertNoTransactionResidue(headedRoot);
}

async function testClosedLoopReviewChain(baseBundle, publicState) {
  if (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_SKIP_CHAIN_E2E === '1') { evidence.chainE2E = { skippedByExplicitEnvironment: true }; return; }
  const chainRoot = path.join(path.dirname(baseBundle), 'chain'); mkdirSync(chainRoot, { mode: 0o700 }); const firstBundle = path.join(chainRoot, 'first-bundle'); const secondBundle = path.join(chainRoot, 'second-bundle'); const c0Bundle = path.join(chainRoot, 'c0-bundle');
  const lineageRoot = path.join(chainRoot, 'synthetic-prefit-lineage-negatives'); mkdirSync(lineageRoot, { mode: 0o700 }); const lineageFailures = [];
  cloneBundleRole(baseBundle, firstBundle, publicState, 'first', ACTOR_A); cloneBundleRole(baseBundle, secondBundle, publicState, 'second', ACTOR_B); cloneBundleRole(baseBundle, c0Bundle, publicState, 'source-first-c0', ACTOR_C0);
  const [firstSession, secondSession, c0Session] = await Promise.all([
    sealBundleSession(firstBundle, ACTOR_A, publicState, { delayedAckBarrier: REQUESTED_PHASE !== 'headed' }),
    sealBundleSession(secondBundle, ACTOR_B, publicState, { alternate: true }),
    sealBundleSession(c0Bundle, ACTOR_C0, publicState),
  ]); const firstJournal = { bytes: firstSession.journalBytes, byteSha256: firstSession.journalByteSha256 }; const secondJournal = { bytes: secondSession.journalBytes, byteSha256: secondSession.journalByteSha256 }; const c0Journal = { bytes: c0Session.journalBytes, byteSha256: c0Session.journalByteSha256 };
  const firstAccess = firstSession.access; const secondAccess = secondSession.access; const c0Access = c0Session.access;
  for (const [access, journal] of [[firstAccess, firstJournal], [secondAccess, secondJournal], [c0Access, c0Journal]]) { assert.equal(access.editJournalByteSha256, journal.byteSha256); }

  if (REQUESTED_PHASE !== 'headed') {
  const staleServe = syntheticStaleBundle(baseBundle, path.join(lineageRoot, 'serve-bundle')); const staleServeFailure = await runCliExpectedFailureAsync(['serve', '--bundle-dir', staleServe.bundle], 'presentation_contract_mismatch'); assert.equal(staleServeFailure.result.stdout, ''); assert.equal(pathExists(path.join(staleServe.bundle, 'mutable/access-evidence.json')), false); lineageFailures.push('serve');
  const staleFirst = syntheticStaleBundle(firstBundle, path.join(lineageRoot, 'export-review-bundle')); const staleReviewOutput = path.join(lineageRoot, 'export-review-output'); const staleReviewFailure = await runCliExpectedFailureAsync(['export-review', '--bundle-dir', staleFirst.bundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output-dir', staleReviewOutput], 'presentation_contract_mismatch'); assert.equal(staleReviewFailure.result.stdout, ''); assert.equal(pathExists(staleReviewOutput), false); lineageFailures.push('export-review');
  const staleC0Bundle = syntheticStaleBundle(c0Bundle, path.join(lineageRoot, 'seal-c0-bundle')); const staleC0Output = path.join(lineageRoot, 'seal-c0-output.json'); const staleC0Failure = await runCliExpectedFailureAsync(['seal-c0', '--bundle-dir', staleC0Bundle.bundle, '--expected-session-tree-sha256', c0Session.sessionTreeSha256, '--output', staleC0Output], 'presentation_contract_mismatch'); assert.equal(staleC0Failure.result.stdout, ''); assert.equal(pathExists(staleC0Output), false); lineageFailures.push('seal-c0'); assertNoTransactionResidue(lineageRoot);

  const accessSemanticMutations = [];
  for (const [mutation, expectedCode] of Object.entries(ACCESS_EVIDENCE_SEMANTIC_CODES)) { const bundle = path.join(chainRoot, `access-semantic-${mutation}`); const output = path.join(chainRoot, `access-semantic-${mutation}-output`); const mutant = coherentlyMutateAccessEvidence(firstBundle, bundle, mutation, publicState); assert.equal(mutant.expectedCode, expectedCode); accessSemanticMutations.push(mutant); const failure = await runCliExpectedFailureAsync(['export-review', '--bundle-dir', bundle, '--expected-session-tree-sha256', mutant.sessionTreeSha256, '--output-dir', output], expectedCode); assert.equal(failure.result.stdout, ''); assert.equal(pathExists(output), false); assertNoTransactionResidue(chainRoot); }
  evidence.counts.accessEvidenceSemanticBranches = accessSemanticMutations.length; evidence.hashes.accessEvidenceSemanticOracleSha256 = core.canonicalHash(accessSemanticMutations);

  for (const [name, bundle, h1, nibble] of [['first', firstBundle, firstSession.sessionTreeSha256, 0], ['second', secondBundle, secondSession.sessionTreeSha256, 31]]) {
    const output = path.join(chainRoot, `wrong-session-${name}`); await runCliExpectedFailureAsync(['export-review', '--bundle-dir', bundle, '--expected-session-tree-sha256', mutateHashNibble(h1, nibble), '--output-dir', output], 'session_tree_hash_mismatch'); assert.equal(pathExists(output), false); assertNoTransactionResidue(chainRoot);
  }
  const wrongC0Output = path.join(chainRoot, 'wrong-session-c0.json'); await runCliExpectedFailureAsync(['seal-c0', '--bundle-dir', c0Bundle, '--expected-session-tree-sha256', mutateHashNibble(c0Session.sessionTreeSha256, 63), '--output', wrongC0Output], 'session_tree_hash_mismatch'); assert.equal(pathExists(wrongC0Output), false); assertNoTransactionResidue(chainRoot);
  const wrongModeReviewOutput = path.join(chainRoot, 'wrong-mode-review'); await runCliExpectedFailureAsync(['export-review', '--bundle-dir', c0Bundle, '--expected-session-tree-sha256', c0Session.sessionTreeSha256, '--output-dir', wrongModeReviewOutput], 'review_export_mode_invalid'); assert.equal(pathExists(wrongModeReviewOutput), false);
  const wrongModeC0Output = path.join(chainRoot, 'wrong-mode-c0.json'); await runCliExpectedFailureAsync(['seal-c0', '--bundle-dir', firstBundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output', wrongModeC0Output], 'bundle_mode_mismatch'); assert.equal(pathExists(wrongModeC0Output), false); assertNoTransactionResidue(chainRoot);
  }

  const reviewAOut = path.join(chainRoot, 'review-a'); const reviewBOut = path.join(chainRoot, 'review-b'); const opaqueA = Buffer.from([0, 255, 65, 10]); const opaqueB = Buffer.from('{opaque-not-contract-json}\n');
  await runCliSuccess(['export-review', '--bundle-dir', firstBundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output-dir', reviewAOut], { SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64: opaqueA.toString('base64') });
  await runCliSuccess(['export-review', '--bundle-dir', secondBundle, '--expected-session-tree-sha256', secondSession.sessionTreeSha256, '--output-dir', reviewBOut], { SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64: opaqueB.toString('base64') });
  for (const output of [reviewAOut, reviewBOut]) { assert.equal(permissionBits(output), 0o700); assert.deepEqual(readdirSync(output).sort(rawCompare), ['review-export-receipt.json', 'review.json']); assert.equal(permissionBits(path.join(output, 'review.json')), 0o400); assert.equal(permissionBits(path.join(output, 'review-export-receipt.json')), 0o400); }
  const receiptAPath = path.join(reviewAOut, 'review-export-receipt.json'); const receiptBPath = path.join(reviewBOut, 'review-export-receipt.json'); const receiptAHash = sha256(readFileSync(receiptAPath)); const receiptBHash = sha256(readFileSync(receiptBPath)); const receiptA = core.parseJsonBuffer(readFileSync(receiptAPath), { processArtifact: true }); const receiptB = core.parseJsonBuffer(readFileSync(receiptBPath), { processArtifact: true });
  assert.equal(receiptA.validatorStdoutByteSha256, sha256(opaqueA)); assert.equal(receiptB.validatorStdoutByteSha256, sha256(opaqueB)); assert.equal(Buffer.from(receiptA.validatorStdoutBase64, 'base64').equals(opaqueA), true); assert.equal(Buffer.from(receiptB.validatorStdoutBase64, 'base64').equals(opaqueB), true);
  assert.equal(receiptA.sessionTreeSha256, firstSession.sessionTreeSha256); assert.equal(receiptB.sessionTreeSha256, secondSession.sessionTreeSha256);
  assert.equal(receiptA.editJournalByteSha256, firstJournal.byteSha256); assert.equal(receiptB.editJournalByteSha256, secondJournal.byteSha256); assert.equal(firstAccess.editJournalByteSha256, receiptA.editJournalByteSha256); assert.equal(secondAccess.editJournalByteSha256, receiptB.editJournalByteSha256);

  if (REQUESTED_PHASE !== 'headed') {
  for (const [hook, expectedCode] of [['mutate', 'snapshot_size_drift'], ['replace', 'snapshot_identity_drift']]) { const output = path.join(chainRoot, `validator-${hook}`); await runCliExpectedFailureAsync(['export-review', '--bundle-dir', firstBundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output-dir', output], expectedCode, { SAM_GOAL_MANUAL_REVIEW_OPS_V1_AFTER_VALIDATOR_HOOK: hook }); assert.equal(pathExists(output), false); }
  const validatorFailOutput = path.join(chainRoot, 'validator-nonzero'); await runCliExpectedFailureAsync(['export-review', '--bundle-dir', firstBundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output-dir', validatorFailOutput], 'review_validator_failed', { SAM_GOAL_MANUAL_REVIEW_OPS_V1_VALIDATOR_EXIT_CODE: '7' }); assert.equal(pathExists(validatorFailOutput), false);

  const journalSwapBundle = path.join(chainRoot, 'journal-swap'); cloneBundle(firstBundle, journalSwapBundle); const manifest = core.parseJsonBuffer(readFileSync(path.join(journalSwapBundle, 'immutable/bundle-manifest.json')), { processArtifact: true }); const alternateEvents = completeJournalEvents(publicState, ACTOR_A); alternateEvents.find((event) => event.fieldPath.endsWith('/scenarioTags')).value = ['fast_motion']; const alternateJournal = processDocument('sam-goal-review-edit-journal-v1', { cycleId: CYCLE, mode: 'first', actorPseudonymSha256: ACTOR_A, bundleManifestByteSha256: sha256(readFileSync(path.join(journalSwapBundle, 'immutable/bundle-manifest.json'))), events: alternateEvents }); const replacement = path.join(journalSwapBundle, 'mutable/journal-replacement'); writeFileSync(replacement, core.processBytes(alternateJournal), { mode: 0o600 }); renameSync(replacement, path.join(journalSwapBundle, 'mutable/edit-journal.json'));
  const swapOutput = path.join(chainRoot, 'journal-swap-output'); await runCliExpectedFailureAsync(['export-review', '--bundle-dir', journalSwapBundle, '--expected-session-tree-sha256', firstSession.sessionTreeSha256, '--output-dir', swapOutput], 'bundle_access_binding_mismatch'); assert.equal(pathExists(swapOutput), false); assert.equal(manifest.mode, 'first');
  }

  const c0Path = path.join(chainRoot, 'c0-ledger.json'); const c0Seal = await runCliSuccess(['seal-c0', '--bundle-dir', c0Bundle, '--expected-session-tree-sha256', c0Session.sessionTreeSha256, '--output', c0Path]); assert.equal(c0Seal.success.status, 'source_first_c0_sealed'); const c0Hash = sha256(readFileSync(c0Path)); assert.equal(permissionBits(c0Path), 0o600); const c0Document = core.parseJsonBuffer(readFileSync(c0Path), { processArtifact: true }); assert.equal(c0Document.editJournalByteSha256, c0Journal.byteSha256); assert.equal(c0Access.editJournalByteSha256, c0Document.editJournalByteSha256); assert.equal(c0Document.sessionTreeSha256, c0Session.sessionTreeSha256);

  const rawPath = path.join(chainRoot, 'raw-ab-report.json'); const compareValidatorOpaque = Buffer.from([0x00, 0xff, 0x43, 0x4d, 0x50, 0x0a]); const raw = await runCliSuccess(['compare-raw', '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--output', rawPath], { SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64: compareValidatorOpaque.toString('base64') }); assert.equal(raw.success.status, 'raw_ab_gate_pass'); const rawHash = sha256(readFileSync(rawPath)); const rawDocument = core.parseJsonBuffer(readFileSync(rawPath), { processArtifact: true }); assert.equal(rawDocument.gatePass, true); assert.equal(rawDocument.c0UsedForAgreement, false); assert.equal(rawDocument.reviewAComparisonValidatorStdoutByteSha256, sha256(compareValidatorOpaque)); assert.equal(rawDocument.reviewBComparisonValidatorStdoutByteSha256, sha256(compareValidatorOpaque)); assert.equal(stableStringify(rawDocument.agreementMacros), stableStringify({ contactKappa: 1, observabilityKappa: 1, presencePersonStateKappa: 1, thresholds: clone(FIXTURE.thresholds) }));
  if (REQUESTED_PHASE !== 'headed') {
  const stalePair = syntheticStalePair(reviewAOut, path.join(lineageRoot, 'compare-review-a'), 'review-export-receipt.json'); const staleRawOutput = path.join(lineageRoot, 'compare-raw-output.json'); const staleCompareFailure = await runCliExpectedFailureAsync(['compare-raw', '--review-a', path.join(stalePair.directory, 'review.json'), '--receipt-a', stalePair.processPath, '--expected-receipt-a-sha256', stalePair.processByteSha256, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--output', staleRawOutput], 'presentation_contract_mismatch'); assert.equal(staleCompareFailure.result.stdout, ''); assert.equal(pathExists(staleRawOutput), false); lineageFailures.push('compare-raw');
  const staleRaw = syntheticStaleProcessFile(rawPath, path.join(lineageRoot, 'prepare-raw-report.json')); const staleRevealOutput = path.join(lineageRoot, 'prepare-adjudication-bundle'); const stalePrepareFailure = await runCliExpectedFailureAsync(['prepare-adjudication', '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--raw-report', staleRaw.path, '--expected-raw-report-sha256', staleRaw.byteSha256, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--bundle-dir', staleRevealOutput], 'presentation_contract_mismatch'); assert.equal(stalePrepareFailure.result.stdout, ''); assert.equal(pathExists(staleRevealOutput), false); lineageFailures.push('prepare-adjudication'); assertNoTransactionResidue(lineageRoot);
  const compareValidatorFailure = path.join(chainRoot, 'raw-validator-nonzero.json'); await runCliExpectedFailureAsync(['compare-raw', '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--output', compareValidatorFailure], 'review_validator_failed', { SAM_GOAL_MANUAL_REVIEW_OPS_V1_VALIDATOR_EXIT_CODE: '7' }); assert.equal(pathExists(compareValidatorFailure), false); assertNoTransactionResidue(chainRoot);
  }

  const revealBundle = path.join(chainRoot, 'reveal-bundle'); const prepared = await runCliSuccess(['prepare-adjudication', '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--raw-report', rawPath, '--expected-raw-report-sha256', rawHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--bundle-dir', revealBundle]);
  const revealReceiptPath = prepared.success.revealReceiptPath ?? exactOneFile(revealBundle, (filePath) => /reveal-receipt\.json$/u.test(filePath), 'reveal receipt'); const revealReceiptHash = sha256(readFileSync(revealReceiptPath)); assert.equal(prepared.success.revealReceiptByteSha256, revealReceiptHash);
  if (['all', 'headed'].includes(REQUESTED_PHASE)) await testHeadedProductionPresentation(publicState, revealBundle, chainRoot);
  if (REQUESTED_PHASE === 'headed') {
    const revealReceiptDocument = core.parseJsonBuffer(readFileSync(revealReceiptPath), { processArtifact: true }); const lineageDocuments = [firstAccess, secondAccess, c0Access, receiptA, receiptB, c0Document, rawDocument, revealReceiptDocument];
    assert.ok(lineageDocuments.every((document) => document.presentationContractSha256 === PRESENTATION_CONTRACT_SHA256)); evidence.counts.headedCurrentLineageLinks = lineageDocuments.length; evidence.hashes.headedCurrentLineageSha256 = core.canonicalHash(lineageDocuments.map((document) => ({ artifactType: document.artifactType, presentationContractSha256: document.presentationContractSha256 })));
    assertNoTransactionResidue(chainRoot); return;
  }
  await testRevealPreReadinessFixedFailures(revealBundle, publicState); await testRevealOfflinePrefillRejected(revealBundle, publicState);
  const revealSession = await sealBundleSession(revealBundle, ACTOR_C0, publicState);
  if (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_STOP_AFTER_REVEAL_SESSION === '1') {
    evidence.revealHttpClosedLoop = { status: 'passed', sessionTreeSha256: revealSession.sessionTreeSha256, journalByteSha256: revealSession.access.editJournalByteSha256, decisionEvents: evidence.counts.revealRuntimeDecisionEvents, dispositionEvents: evidence.counts.revealRuntimeDispositionEvents, globalResetRecords: evidence.counts.revealRuntimeGlobalResetRecords };
    return;
  }
  const exportAdjudicationArgs = ({ bundle = revealBundle, receipt = revealReceiptPath, receiptHash = revealReceiptHash, sessionTree = revealSession.sessionTreeSha256, output }) => ['export-adjudication', '--bundle-dir', bundle, '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--raw-report', rawPath, '--expected-raw-report-sha256', rawHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--reveal-receipt', receipt, '--expected-reveal-receipt-sha256', receiptHash, '--expected-session-tree-sha256', sessionTree, '--output-dir', output];
  const staleRevealBundle = syntheticStaleBundle(revealBundle, path.join(lineageRoot, 'export-adjudication-bundle')); const staleAdjudicationOutput = path.join(lineageRoot, 'export-adjudication-output'); const staleExportFailure = await runCliExpectedFailureAsync(exportAdjudicationArgs({ bundle: staleRevealBundle.bundle, output: staleAdjudicationOutput }), 'presentation_contract_mismatch'); assert.equal(staleExportFailure.result.stdout, ''); assert.equal(pathExists(staleAdjudicationOutput), false); lineageFailures.push('export-adjudication'); assertNoTransactionResidue(lineageRoot);
  const splitCodes = { cycle: 'reveal_cycle_split_chain_mismatch', actor: 'reveal_actor_split_chain_mismatch', rulebook: 'reveal_rulebook_split_chain_mismatch' }; const splitMutations = [];
  for (const [kind, expectedCode] of Object.entries(splitCodes)) { const bundle = path.join(chainRoot, `split-chain-${kind}`); const output = path.join(chainRoot, `split-chain-${kind}-output`); const mutant = coherentlyResealRevealFixedSplitChain(revealBundle, bundle, kind, publicState); assert.notEqual(mutant.revealReceiptByteSha256, revealReceiptHash); assert.notEqual(mutant.sessionTreeSha256, revealSession.sessionTreeSha256); splitMutations.push(mutant); const failure = await runCliExpectedFailureAsync(exportAdjudicationArgs({ bundle, receipt: mutant.revealReceiptPath, receiptHash: mutant.revealReceiptByteSha256, sessionTree: mutant.sessionTreeSha256, output }), expectedCode); assert.equal(failure.result.stdout, ''); assert.equal(pathExists(output), false); assertNoTransactionResidue(chainRoot); }
  evidence.counts.revealSplitChainBranches = splitMutations.length; evidence.hashes.revealSplitChainOracleSha256 = core.canonicalHash(splitMutations);
  const revealSemanticMutations = [];
  for (const [mutation, expectedCode] of [...Object.entries(REVEAL_RECEIPT_SEMANTIC_CODES), ...Object.entries(REVEAL_FIXED_CROSS_CODES)]) {
    const bundle = path.join(chainRoot, `reveal-semantic-${mutation}`); const output = path.join(chainRoot, `reveal-semantic-${mutation}-output`); const mutant = coherentlyResealRevealSemanticMutation(revealBundle, bundle, mutation, publicState); assert.equal(mutant.expectedCode, expectedCode); revealSemanticMutations.push(mutant);
    const failure = await runCliExpectedFailureAsync(exportAdjudicationArgs({ bundle, receipt: mutant.revealReceiptPath, receiptHash: mutant.revealReceiptByteSha256, sessionTree: mutant.sessionTreeSha256, output }), expectedCode); assert.equal(failure.result.stdout, ''); assert.equal(pathExists(output), false); assertNoTransactionResidue(chainRoot);
  }
  evidence.counts.revealReceiptSemanticBranches = Object.keys(REVEAL_RECEIPT_SEMANTIC_CODES).length; evidence.counts.revealFixedCrossBindingBranches = Object.keys(REVEAL_FIXED_CROSS_CODES).length; evidence.hashes.revealSemanticMutationOracleSha256 = core.canonicalHash(revealSemanticMutations);
  const wrongRevealOutput = path.join(chainRoot, 'wrong-session-reveal-output'); await runCliExpectedFailureAsync(exportAdjudicationArgs({ sessionTree: mutateHashNibble(revealSession.sessionTreeSha256, 63), output: wrongRevealOutput }), 'session_tree_hash_mismatch'); assert.equal(pathExists(wrongRevealOutput), false); assertNoTransactionResidue(chainRoot);
  const adjudicationOut = path.join(chainRoot, 'adjudication-output'); const exported = await runCliSuccess(exportAdjudicationArgs({ output: adjudicationOut }));
  assert.deepEqual(readdirSync(adjudicationOut).sort(rawCompare), ['adjudication.json', 'deviation-evidence.json']); const adjudicationPath = path.join(adjudicationOut, 'adjudication.json'); const deviationPath = path.join(adjudicationOut, 'deviation-evidence.json'); const deviationHash = sha256(readFileSync(deviationPath)); assert.equal(exported.success.deviationEvidenceByteSha256, deviationHash); const deviationDocument = core.parseJsonBuffer(readFileSync(deviationPath), { processArtifact: true }); assert.equal(deviationDocument.revealSessionTreeSha256, revealSession.sessionTreeSha256);
  const handoffArgsFor = ({ receipt = revealReceiptPath, receiptHash = revealReceiptHash, adjudication = adjudicationPath, deviation = deviationPath, expectedDeviation = deviationHash } = {}) => ['handoff-check', '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--adjudication', adjudication, '--raw-report', rawPath, '--expected-raw-report-sha256', rawHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--reveal-receipt', receipt, '--expected-reveal-receipt-sha256', receiptHash, '--deviation-evidence', deviation, '--expected-deviation-evidence-sha256', expectedDeviation];
  const staleAdjudicationPair = syntheticStalePair(adjudicationOut, path.join(lineageRoot, 'handoff-adjudication'), 'deviation-evidence.json'); const staleHandoffFailure = await runCliExpectedFailureAsync(handoffArgsFor({ adjudication: path.join(staleAdjudicationPair.directory, 'adjudication.json'), deviation: staleAdjudicationPair.processPath, expectedDeviation: staleAdjudicationPair.processByteSha256 }), 'presentation_contract_mismatch'); assert.equal(staleHandoffFailure.result.stdout, ''); lineageFailures.push('handoff-check'); assert.deepEqual(lineageFailures, ['serve', 'export-review', 'seal-c0', 'compare-raw', 'prepare-adjudication', 'export-adjudication', 'handoff-check']); evidence.counts.presentationLineageDirectConsumerFailures = lineageFailures.length; evidence.hashes.presentationLineageNegativeOracleSha256 = core.canonicalHash({ lineage: PREFIT_PRESENTATION_CONTRACT_SHA256, commands: lineageFailures }); assertNoTransactionResidue(lineageRoot);
  const validRevealReceipt = core.parseJsonBuffer(readFileSync(revealReceiptPath), { processArtifact: true }); const standaloneReceiptMutations = [];
  for (const [mutation, expectedCode] of Object.entries(REVEAL_RECEIPT_SEMANTIC_CODES)) { const document = clone(validRevealReceipt); mutateRevealReceiptSemantic(document, mutation, validRevealReceipt); core.validateProcessArtifact(document, publicState, document.artifactType); const mutantPath = path.join(chainRoot, `handoff-reveal-receipt-${mutation}.json`); const written = writeCanonicalReadOnly(mutantPath, document); standaloneReceiptMutations.push({ mutation, byteSha256: written.sha256 }); const failure = await runCliExpectedFailureAsync(handoffArgsFor({ receipt: mutantPath, receiptHash: written.sha256 }), expectedCode); assert.equal(failure.result.stdout, ''); assertNoTransactionResidue(chainRoot); }
  evidence.counts.handoffRevealReceiptSemanticBranches = standaloneReceiptMutations.length; evidence.hashes.handoffRevealReceiptMutationOracleSha256 = core.canonicalHash(standaloneReceiptMutations);
  const handoffArgs = handoffArgsFor();
  const compiler = path.join(ROOT, 'scripts/sam-goal-manual-pack-v3.mjs'); const runFreshValidator = (reviewPath, role, reviewer) => { const child = spawnSync(process.execPath, [compiler, 'validate-review', '--review', reviewPath, '--expected-role', role, '--expected-reviewer-pseudonym-sha256', reviewer], { cwd: ROOT, env: process.env, encoding: null, maxBuffer: 32 * 1024 * 1024 }); assert.equal(child.status, 0, child.stderr?.toString('utf8')); return Buffer.from(child.stdout); }; const freshValidatorA = runFreshValidator(path.join(reviewAOut, 'review.json'), 'first', receiptA.actorPseudonymSha256); const freshValidatorB = runFreshValidator(path.join(reviewBOut, 'review.json'), 'second', receiptB.actorPseudonymSha256); assert.notEqual(sha256(freshValidatorA), sha256(freshValidatorB)); for (const fresh of [freshValidatorA, freshValidatorB]) assert.notEqual(sha256(fresh), sha256(compareValidatorOpaque));
  const realHandoff = await runCliSuccess(handoffArgs); const handoffValidatorOutputs = [Buffer.alloc(0), Buffer.from('fresh validator output is deliberately non-JSON\n'), Buffer.from([0xff, 0x00, 0x48, 0x4f, 0x46, 0x0a])]; const handoffRuns = [];
  for (const validatorStdout of handoffValidatorOutputs) { assert.notEqual(sha256(validatorStdout), sha256(compareValidatorOpaque)); handoffRuns.push(await runCliSuccess(handoffArgs, { SAM_GOAL_MANUAL_REVIEW_OPS_V1_OPAQUE_STDOUT_BASE64: validatorStdout.toString('base64') })); }
  const handoff = realHandoff; for (const run of handoffRuns) { assert.deepEqual(run.success.report, handoff.success.report); assert.deepEqual(run.success.formalTuple, handoff.success.formalTuple); }
  assert.equal(handoff.success.report.status, 'ready_for_manual_pack_compiler'); assert.deepEqual(Object.keys(handoff.success.formalTuple).sort(rawCompare), ['adjudication', 'reviewA', 'reviewB']); assert.ok(Object.values(handoff.success.formalTuple).every((item) => Object.keys(item).sort(rawCompare).join(',') === 'byteSha256,path'));
  assert.deepEqual({ reviewASessionTreeSha256: handoff.success.report.reviewASessionTreeSha256, reviewBSessionTreeSha256: handoff.success.report.reviewBSessionTreeSha256, c0SessionTreeSha256: handoff.success.report.c0SessionTreeSha256, revealSessionTreeSha256: handoff.success.report.revealSessionTreeSha256 }, { reviewASessionTreeSha256: firstSession.sessionTreeSha256, reviewBSessionTreeSha256: secondSession.sessionTreeSha256, c0SessionTreeSha256: c0Session.sessionTreeSha256, revealSessionTreeSha256: revealSession.sessionTreeSha256 });
  assert.equal(stableStringify(handoff.success.report).includes('path'), false); assert.equal(stableStringify(handoff.success.formalTuple).includes('receipt'), false);

  for (const [name, sourceBundle, retainedH1] of [['first', firstBundle, firstSession.sessionTreeSha256], ['second', secondBundle, secondSession.sessionTreeSha256]]) {
    const h2Bundle = path.join(chainRoot, `coherent-h2-${name}-bundle`); const h2Output = path.join(chainRoot, `coherent-h2-${name}-output`); cloneBundle(sourceBundle, h2Bundle); coherentlyReplaceSealedMutableTree(h2Bundle, publicState, retainedH1);
    await runCliExpectedFailureAsync(['export-review', '--bundle-dir', h2Bundle, '--expected-session-tree-sha256', retainedH1, '--output-dir', h2Output], 'session_tree_hash_mismatch'); assert.equal(pathExists(h2Output), false); assertNoTransactionResidue(chainRoot);
  }
  const h2C0Bundle = path.join(chainRoot, 'coherent-h2-c0-bundle'); const h2C0Output = path.join(chainRoot, 'coherent-h2-c0-output.json'); cloneBundle(c0Bundle, h2C0Bundle); coherentlyReplaceSealedMutableTree(h2C0Bundle, publicState, c0Session.sessionTreeSha256);
  await runCliExpectedFailureAsync(['seal-c0', '--bundle-dir', h2C0Bundle, '--expected-session-tree-sha256', c0Session.sessionTreeSha256, '--output', h2C0Output], 'session_tree_hash_mismatch'); assert.equal(pathExists(h2C0Output), false); assertNoTransactionResidue(chainRoot);
  const h2RevealBundle = path.join(chainRoot, 'coherent-h2-reveal-bundle'); const h2RevealOutput = path.join(chainRoot, 'coherent-h2-reveal-output'); cloneBundle(revealBundle, h2RevealBundle); coherentlyReplaceSealedMutableTree(h2RevealBundle, publicState, revealSession.sessionTreeSha256);
  await runCliExpectedFailureAsync(['export-adjudication', '--bundle-dir', h2RevealBundle, '--review-a', path.join(reviewAOut, 'review.json'), '--receipt-a', receiptAPath, '--expected-receipt-a-sha256', receiptAHash, '--review-b', path.join(reviewBOut, 'review.json'), '--receipt-b', receiptBPath, '--expected-receipt-b-sha256', receiptBHash, '--raw-report', rawPath, '--expected-raw-report-sha256', rawHash, '--c0-ledger', c0Path, '--expected-c0-byte-sha256', c0Hash, '--reveal-receipt', revealReceiptPath, '--expected-reveal-receipt-sha256', revealReceiptHash, '--expected-session-tree-sha256', revealSession.sessionTreeSha256, '--output-dir', h2RevealOutput], 'session_tree_hash_mismatch'); assert.equal(pathExists(h2RevealOutput), false); assertNoTransactionResidue(chainRoot);
  evidence.counts.coherentH2RoleBranches = 4; assertNoTransactionResidue(chainRoot); evidence.counts.fullChainFormalTuple = 3; evidence.counts.validatorToctouBranches = 4; evidence.counts.handoffFreshOpaqueValidatorBranches = handoffRuns.length; evidence.counts.handoffRealFreshValidatorBranches = 2; evidence.hashes.handoffFreshValidatorPairSha256 = core.canonicalHash([freshValidatorA, freshValidatorB].map((bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) }))); evidence.hashes.handoffValidatorOutputOracleSha256 = core.canonicalHash(handoffValidatorOutputs.map((bytes) => ({ bytes: bytes.length, sha256: sha256(bytes) }))); evidence.hashes.rawABReportByteSha256 = rawHash; evidence.hashes.deviationEvidenceByteSha256 = deviationHash;
}

async function startServe(bundle, env = {}) {
  const child = spawn(process.execPath, [CLI, 'serve', '--bundle-dir', bundle], { cwd: ROOT, env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  activeServeChildren.add(child); const stdout = []; const stderr = []; let stderrText = ''; let readyResolve; let readyReject; const readyPromise = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); const exitPromise = new Promise((resolve) => child.once('exit', (status, signal) => { activeServeChildren.delete(child); resolve({ status, signal }); }));
  const timeout = setTimeout(() => { readyReject(new Error('serve_ready_timeout')); killServeGroup(child); }, 45_000);
  child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => {
    stderr.push(Buffer.from(chunk)); stderrText += chunk.toString('utf8');
    for (;;) { const newline = stderrText.indexOf('\n'); if (newline < 0) break; const line = stderrText.slice(0, newline); stderrText = stderrText.slice(newline + 1); try {
      const value = JSON.parse(line);
      if (value.status === 'review_ui_ready' && value.host === '127.0.0.1' && Number.isInteger(value.port)) { assert.equal(Buffer.concat(stdout).length, 0, 'serve stdout must remain empty before child reap'); clearTimeout(timeout); readyResolve(value); }
    } catch {}
    }
  });
  exitPromise.then(({ status, signal }) => { clearTimeout(timeout); readyReject(new Error(`serve_exited_before_ready:${bundle}:${status}:${signal}:${Buffer.concat(stderr).toString('utf8')}`)); });
  const ready = await readyPromise;
  const wait = async () => { const termination = await exitPromise; return { ...termination, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }; };
  return { child, ready, base: `http://127.0.0.1:${ready.port}`, wait, stdout, stderr };
}

async function fetchJsonResponse(base, route, { method = 'GET', body, session, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (method === 'POST') Object.assign(requestHeaders, { origin: base, 'content-type': 'application/json', 'x-sam-goal-csrf': session?.csrfToken ?? '', 'x-sam-goal-session': session?.sessionId ?? '' });
  const response = await fetch(`${base}${route}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15_000) }); const text = await response.text();
  let value; try { value = JSON.parse(text); } catch { throw new Error(`http_non_json:${response.status}:${text}`); }
  return { status: response.status, value, headers: response.headers };
}

async function bootstrapSession(server) {
  const response = await fetchJsonResponse(server.base, '/api/session', { headers: { 'sec-fetch-site': 'same-origin', referer: `${server.base}/` } }); assert.equal(response.status, 200); assert.equal(response.value.status, 'session_bootstrap'); return response.value;
}

function makeLockClaim(row, generation, manifest, inventory, overrides = {}) {
  const source = manifest.sourceBinding.sources.find((item) => item.clipId === row.clipId); const sourceInventory = inventory.paired.find((item) => item.clipId === row.clipId); const width = sourceInventory.media.width; const height = sourceInventory.media.height;
  return { identity: exactIdentity(row), clientGeneration: generation, sampleToken: row.sourceFrameIndex, sourceByteSha256: source.sha256, codedWidth: width, codedHeight: height, displayWidth: width, displayHeight: height, canvasWidth: width, canvasHeight: height, ...overrides };
}

function sealedEnvelopeFromExit(exit) {
  assert.equal(exit.status, 0, exit.stderr); const lines = exit.stdout.split(/\r?\n/u).filter(Boolean); assert.equal(lines.length, 1, `serve must emit exactly one post-reap stdout line: ${exit.stdout}`);
  const envelope = JSON.parse(lines[0]); assert.deepEqual(Object.keys(envelope).sort(rawCompare), [...FIXTURE.sessionTreeContract.serveStdoutFields].sort(rawCompare)); assert.equal(envelope.status, FIXTURE.sessionTreeContract.serveStdoutStatus);
  assert.equal(exit.stdout, core.processBytes(envelope).toString('utf8'), 'serve seal envelope is not canonical one-LF process JSON'); return envelope;
}

function assertSealBindsTree(bundle, access, envelope) {
  const manifestBytes = readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')); const manifest = core.parseJsonBuffer(manifestBytes, { processArtifact: true }); const accessBytes = readFileSync(path.join(bundle, 'mutable/access-evidence.json'));
  const fields = {
    terminalState: 'closed', cycleId: manifest.cycleId, mode: manifest.mode, actorPseudonymSha256: manifest.actorPseudonymSha256, presentationContractSha256: manifest.presentationContractSha256,
    bundleManifestByteSha256: sha256(manifestBytes), immutableAssetSetSha256: manifest.immutableAssetSetSha256,
    fixedInputSetSha256: access.fixedInputSetSha256, sessionSeedByteSha256: access.sessionSeedByteSha256, sessionFinalStateByteSha256: access.sessionFinalStateByteSha256,
    editJournalByteSha256: access.editJournalByteSha256, actorAttestationByteSha256: access.actorAttestationByteSha256, accessEvidenceByteSha256: sha256(accessBytes),
  };
  assert.equal(access.presentationContractSha256, PRESENTATION_CONTRACT_SHA256); assert.equal(manifest.presentationContractSha256, PRESENTATION_CONTRACT_SHA256);
  assert.deepEqual(envelope, core.makeSessionSealEnvelope(fields)); assert.equal(Object.hasOwn(access, 'sessionTreeSha256'), false); assert.equal(Object.hasOwn(manifest, 'sessionTreeSha256'), false);
  assert.ok(filesRecursive(bundle).every((filePath) => !/(?:session-tree|sessionTree|tree-descriptor)/u.test(path.basename(filePath))), 'session tree authority leaked into bundle path'); return envelope.sessionTreeSha256;
}

function assertIndependentAccessEventRegistry(bundle, access, { requireFrameLock = false, requireJournalTemp = false } = {}) {
  const manifest = core.parseJsonBuffer(readFileSync(path.join(bundle, 'immutable/bundle-manifest.json')), { processArtifact: true }); const fixedPaths = manifest.mode === 'adjudication-reveal' ? FIXTURE.sessionTreeContract.revealFixedLogicalPaths : [];
  const exactFilesystem = ['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((item) => item.logicalPath), ...fixedPaths, 'mutable'].sort(rawCompare); assert.deepEqual(access.filesystemAllowlist, exactFilesystem); assert.deepEqual(access.networkAllowlist, ['127.0.0.1', '::1', 'localhost']);
  const readable = new Set(['immutable/bundle-manifest.json', ...manifest.immutableAssets.map((item) => item.logicalPath), ...fixedPaths, ...(manifest.mode === 'adjudication-reveal' ? ['mutable/adjudication-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'] : ['mutable/worksheet-seed.json', 'mutable/edit-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'])]);
  const writable = new Set(manifest.mode === 'adjudication-reveal' ? ['mutable/adjudication-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json'] : ['mutable/edit-journal.json', 'mutable/actor-attestation.json', 'mutable/access-evidence.json']); const journalName = manifest.mode === 'adjudication-reveal' ? 'adjudication-journal.json' : 'edit-journal.json'; const tempWrite = new RegExp(`^mutable/\\.(?:${journalName.replace('.', '\\.')}\\.next|actor-attestation\\.next|access-evidence\\.seal)-[1-9][0-9]*-[0-9a-f]{24}$`, 'u'); const exactLoopback = (value) => { const match = /^(127\.0\.0\.1|::1):([1-9][0-9]{0,4})$/u.exec(value); return Boolean(match) && Number(match[2]) <= 65_535; }; const frameLock = /^session\/frame-lock\/[1-9][0-9]*$/u; const allowedCounts = {}; const allowedEvents = access.actualOpenEvents.filter((event) => event.result === 'allowed');
  for (const event of allowedEvents) { const valid = event.operation === 'read' ? readable.has(event.logicalPath) : event.operation === 'write' ? writable.has(event.logicalPath) || tempWrite.test(event.logicalPath) : ['connect', 'bind'].includes(event.operation) ? exactLoopback(event.logicalPath) : ['lock', 'unlock'].includes(event.operation) ? frameLock.test(event.logicalPath) : false; assert.equal(valid, true, `unregistered launcher event: ${stableStringify(event)}`); allowedCounts[event.operation] = (allowedCounts[event.operation] ?? 0) + 1; }
  const journalLogicalPath = manifest.mode === 'adjudication-reveal' ? 'mutable/adjudication-journal.json' : 'mutable/edit-journal.json'; for (const logicalPath of [journalLogicalPath, 'mutable/actor-attestation.json', 'mutable/access-evidence.json']) { assert.ok(allowedEvents.some((event) => event.operation === 'read' && event.logicalPath === logicalPath), `missing final read: ${logicalPath}`); if (writable.has(logicalPath) && (logicalPath !== journalLogicalPath || requireJournalTemp)) assert.ok(allowedEvents.some((event) => event.operation === 'write' && event.logicalPath === logicalPath), `missing final write: ${logicalPath}`); }
  const tempPatterns = [/^mutable\/\.actor-attestation\.next-/u, /^mutable\/\.access-evidence\.seal-/u]; if (requireJournalTemp) tempPatterns.unshift(new RegExp(`^mutable/\\.${journalName.replace('.', '\\.')}\\.next-`, 'u')); for (const pattern of tempPatterns) assert.ok(allowedEvents.some((event) => event.operation === 'write' && pattern.test(event.logicalPath)), `missing registered temp write: ${pattern}`);
  assert.ok(allowedEvents.some((event) => event.operation === 'bind' && exactLoopback(event.logicalPath))); assert.ok(allowedEvents.some((event) => event.operation === 'connect' && exactLoopback(event.logicalPath))); if (requireFrameLock) { assert.ok(allowedEvents.some((event) => event.operation === 'lock' && frameLock.test(event.logicalPath))); assert.ok(allowedEvents.some((event) => event.operation === 'unlock' && frameLock.test(event.logicalPath))); }
  return allowedCounts;
}

async function serveGroupGone(child, timeoutMs = 2_500) { const deadline = Date.now() + timeoutMs; for (;;) { try { process.kill(-child.pid, 0); } catch (error) { if (error.code === 'ESRCH') return true; throw error; } if (Date.now() >= deadline) return false; await new Promise((resolve) => setTimeout(resolve, 25)); } }

async function stopServe(server, signal = 'SIGTERM', { allowPriorFailure = false } = {}) {
  const waiting = server.wait(); server.child.kill(signal); let timer; const exit = await Promise.race([waiting, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2_500); })]); clearTimeout(timer);
  if (exit === null) { killServeGroup(server.child); await Promise.race([waiting, new Promise((resolve) => setTimeout(resolve, 2_500))]); await serveGroupGone(server.child); throw Object.assign(new Error('serve did not TERM-reap its process group within 2500ms'), { code: 'serve_stop_timeout' }); }
  const groupGone = await serveGroupGone(server.child); if (!groupGone) { killServeGroup(server.child); await serveGroupGone(server.child); throw Object.assign(new Error('serve top-level exited but a descendant survived TERM'), { code: 'serve_descendant_reap_timeout' }); }
  assert.notEqual(exit.status, null); if (!allowPriorFailure && signal === 'SIGTERM') assert.equal(exit.status, 143, `serve SIGTERM exit: ${stableStringify(exit)}`); assert.equal(parseChildJsonLines({ stdout: exit.stdout, stderr: '' }).some((item) => item.status === 'review_session_sealed'), false); let refused = false; try { await fetch(`${server.base}/api/manifest`, { signal: AbortSignal.timeout(1000) }); } catch { refused = true; } assert.equal(refused, true); return exit;
}

async function testCleanServeSession(bundle, publicState) {
  const server = await startServe(bundle); const session = await bootstrapSession(server);
  const worksheetResponse = await fetchJsonResponse(server.base, '/api/worksheet'); const manifestResponse = await fetchJsonResponse(server.base, '/api/manifest'); assert.equal(worksheetResponse.status, 200); assert.equal(manifestResponse.status, 200);
  const worksheet = worksheetResponse.value; const manifest = manifestResponse.value; const inventory = readJson(path.join(bundle, 'immutable/authority/source-inventory.json'));
  assert.equal(worksheet.rows.length, 6711); assert.equal(stableStringify(exactIdentity(worksheet.rows[0])), stableStringify(exactIdentity(publicState.decoderRows[0])));
  const row0 = worksheet.rows[0]; const row1 = worksheet.rows[1]; const row2 = worksheet.rows[2];
  const wrongCsrf = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session: { ...session, csrfToken: 'bad' }, body: makeLockClaim(row0, session.generationBase + 1, manifest, inventory) }); assert.equal(wrongCsrf.value.code, 'same_origin_request_required');
  const lock1 = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row0, session.generationBase + 1, manifest, inventory) }); assert.equal(lock1.value.status, 'exact_frame_lock_issued');
  const lock2 = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row1, session.generationBase + 2, manifest, inventory) }); assert.equal(lock2.value.status, 'exact_frame_lock_issued');
  const staleUnlock = await fetchJsonResponse(server.base, '/api/unlock', { method: 'POST', session, body: { clientGeneration: session.generationBase + 1, lockNonce: lock1.value.lockNonce } }); assert.equal(staleUnlock.value.status, 'stale_frame_lock_ignored');
  const wrongRange = await fetchJsonResponse(server.base, '/api/edit', { method: 'POST', session, body: { action: 'set', actorPseudonymSha256: ACTOR_A, clientGeneration: session.generationBase + 2, clipId: row1.clipId, startFrameIndex: row1.sourceFrameIndex + 1, endFrameIndexExclusive: row1.sourceFrameIndex + 2, fieldPath: 'scenarios', valueType: 'scenario-array', value: ['neutral'], lockedIdentity: exactIdentity(row1), lockNonce: lock2.value.lockNonce } }); assert.equal(wrongRange.value.code, 'locked_identity_invalid');
  const staleEdit = await fetchJsonResponse(server.base, '/api/edit', { method: 'POST', session, body: { action: 'set', actorPseudonymSha256: ACTOR_A, clientGeneration: session.generationBase + 1, clipId: row0.clipId, startFrameIndex: 0, endFrameIndexExclusive: 1, fieldPath: 'scenarios', valueType: 'scenario-array', value: ['neutral'], lockedIdentity: exactIdentity(row0), lockNonce: lock1.value.lockNonce } }); assert.equal(staleEdit.value.code, 'locked_identity_invalid');
  const duplicateGeneration = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row2, session.generationBase + 2, manifest, inventory) }); assert.equal(duplicateGeneration.value.code, 'frame_lock_claim_invalid');
  const invalidIdentity = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim({ ...row2, sourceFrameIndex: 999999 }, session.generationBase + 3, manifest, inventory, { sampleToken: 999999 }) }); assert.equal(invalidIdentity.value.code, 'frame_lock_identity_invalid');
  const edit2 = await fetchJsonResponse(server.base, '/api/edit', { method: 'POST', session, body: { action: 'set', actorPseudonymSha256: ACTOR_A, clientGeneration: session.generationBase + 2, clipId: row1.clipId, startFrameIndex: row1.sourceFrameIndex, endFrameIndexExclusive: row1.sourceFrameIndex + 1, fieldPath: 'scenarios', valueType: 'scenario-array', value: ['neutral'], lockedIdentity: exactIdentity(row1), lockNonce: lock2.value.lockNonce } }); assert.equal(edit2.value.status, 'explicit_edit_recorded');
  const lock3 = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row2, session.generationBase + 3, manifest, inventory) }); assert.equal(lock3.value.status, 'exact_frame_lock_issued');
  const staleAfterRelock = await fetchJsonResponse(server.base, '/api/unlock', { method: 'POST', session, body: { clientGeneration: session.generationBase + 2, lockNonce: lock2.value.lockNonce } }); assert.equal(staleAfterRelock.value.status, 'stale_frame_lock_ignored');
  const unlock3 = await fetchJsonResponse(server.base, '/api/unlock', { method: 'POST', session, body: { clientGeneration: session.generationBase + 3, lockNonce: lock3.value.lockNonce } }); assert.equal(unlock3.value.status, 'frame_lock_invalidated');
  const wrongGeometry = await fetchJsonResponse(server.base, '/api/lock', { method: 'POST', session, body: makeLockClaim(row0, session.generationBase + 4, manifest, inventory, { canvasWidth: 1 }) }); assert.equal(wrongGeometry.value.code, 'frame_lock_identity_invalid');
  const attest = await fetchJsonResponse(server.base, '/api/attest', { method: 'POST', session, body: { actorPseudonymSha256: ACTOR_A, actorDeclaredNoOutsideInput: true, cycleId: CYCLE } }); assert.equal(attest.value.status, 'actor_attestation_recorded');
  assert.equal(Buffer.concat(server.stdout).length, 0, 'serve stdout must remain empty before final child reap');
  const waiting = server.wait(); const end = await fetchJsonResponse(server.base, '/api/end-session', { method: 'POST', session, body: {} }); assert.equal(end.value.status, 'access_evidence_sealed'); const exit = await waiting; const sealEnvelope = sealedEnvelopeFromExit(exit);
  const accessPath = path.join(bundle, 'mutable/access-evidence.json'); assert.equal(pathExists(accessPath), true); assert.equal(permissionBits(accessPath), 0o600); const access = core.parseJsonBuffer(readFileSync(accessPath), { processArtifact: true });
  const validator = createProcessSchemaValidator(SCHEMA_DIR, AUTHORING_SCHEMA); validator.validate(path.join(SCHEMA_DIR, 'access-evidence-v1.schema.json'), access); core.validateProcessArtifact(access, publicState, access.artifactType);
  assert.equal(access.fixedInputSetSha256, FIXTURE.sessionTreeContract.blindFixedInputSetSha256); assertSealBindsTree(bundle, access, sealEnvelope); assertIndependentAccessEventRegistry(bundle, access, { requireFrameLock: true, requireJournalTemp: true });
  assert.deepEqual(access.negativeProbeResults.map((item) => item.name).sort(rawCompare), ['host-repository', 'non-loopback', 'sibling-bundle']); assert.ok(access.actualOpenEvents.some((event) => event.operation === 'lock')); assert.ok(access.actualOpenEvents.some((event) => event.operation === 'unlock'));
  evidence.counts.serveLockRaceBranches = 10; evidence.counts.serveAccessEvents = access.actualOpenEvents.length; evidence.hashes.serveAccessEvidenceByteSha256 = sha256(readFileSync(accessPath)); evidence.hashes.cleanServeSessionTreeSha256 = sealEnvelope.sessionTreeSha256;
}

async function testServeTermReap(bundle) { const server = await startServe(bundle); await bootstrapSession(server); const started = performance.now(); const exit = await stopServe(server); const elapsedMs = performance.now() - started; assert.equal(exit.status, 143); assert.equal(exit.signal, null); assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false); evidence.counts.serveTermReapBranches = 1; evidence.exactFirstCodes['serve:term-reap-exit-status'] = '143'; evidence.serveTermReap = { elapsedMs, exitStatus: exit.status, exitSignal: exit.signal, processGroupGone: true, sealedEnvelopeEmitted: false, accessEvidenceCreated: false }; }

async function testForgedAttestation(bundle, publicState, mode) {
  const server = await startServe(bundle); const session = await bootstrapSession(server); const target = path.join(bundle, 'mutable/actor-attestation.json'); const bytes = core.processBytes({ actorPseudonymSha256: ACTOR_A, actorDeclaredNoOutsideInput: true, cycleId: CYCLE });
  if (mode === 'precreate') writeFileSync(target, bytes, { mode: 0o600 });
  else {
    const attest = await fetchJsonResponse(server.base, '/api/attest', { method: 'POST', session, body: { actorPseudonymSha256: ACTOR_A, actorDeclaredNoOutsideInput: true, cycleId: CYCLE } }); assert.equal(attest.value.status, 'actor_attestation_recorded');
    const replacement = path.join(bundle, 'mutable/attestation-replacement'); writeFileSync(replacement, bytes, { mode: 0o600 }); renameSync(replacement, target);
  }
  let end; try { end = await fetchJsonResponse(server.base, '/api/end-session', { method: 'POST', session, body: {} }); } catch (error) { await stopServe(server, 'SIGTERM', { allowPriorFailure: true }); throw error; } assert.notEqual(end.status, 200); assert.equal(end.value.code, mode === 'precreate' ? 'actor_attestation_missing' : 'mutable_identity_drift', `${mode}:${stableStringify(end.value)}`);
  await stopServe(server, 'SIGTERM', { allowPriorFailure: true }); assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false);
  evidence.exactFirstCodes[`serve:forged-attestation-${mode}`] = end.value.code; evidence.cases.expectedFailures += 1;
  assertPublicBytesUnchanged();
}

async function testMutableAncestorReplacement(bundle) {
  const server = await startServe(bundle); await bootstrapSession(server); const mutable = path.join(bundle, 'mutable'); const moved = path.join(bundle, 'mutable-moved'); renameSync(mutable, moved); mkdirSync(mutable, { mode: 0o700 });
  for (const name of ['worksheet-seed.json', 'edit-journal.json']) copyFileSync(path.join(moved, name), path.join(mutable, name), fsConstants.COPYFILE_EXCL);
  const response = await fetchJsonResponse(server.base, '/api/worksheet'); assert.notEqual(response.status, 200); assert.equal(response.value.code, 'mutable_ancestor_identity_drift', stableStringify(response.value));
  await stopServe(server, 'SIGTERM', { allowPriorFailure: true }); assert.equal(pathExists(path.join(mutable, 'access-evidence.json')), false); assert.equal(pathExists(path.join(moved, 'access-evidence.json')), false);
  evidence.exactFirstCodes['serve:mutable-ancestor-replacement'] = response.value.code; evidence.cases.expectedFailures += 1;
}

async function testBundleRootReplacement(bundle) {
  const server = await startServe(bundle); await bootstrapSession(server); const moved = `${bundle}-moved-h1`; renameSync(bundle, moved); cloneBundle(moved, bundle);
  let code; try { const response = await fetchJsonResponse(server.base, '/api/worksheet'); assert.notEqual(response.status, 200); code = response.value.code; assert.ok(['ancestor_identity_drift', 'mutable_integrity_latched', 'bundle_root_identity_drift'].includes(code), stableStringify(response.value)); } catch (error) { code = 'connection_closed_after_bundle_root_replacement'; }
  const exit = await stopServe(server, 'SIGTERM', { allowPriorFailure: true }); assert.equal(parseChildJsonLines({ stdout: exit.stdout, stderr: '' }).some((item) => item.status === 'review_session_sealed'), false);
  assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false); assert.equal(pathExists(path.join(moved, 'mutable/access-evidence.json')), false);
  evidence.exactFirstCodes['serve:bundle-root-replacement'] = code; evidence.cases.expectedFailures += 1;
}

async function testFinalHandshakeReplacement(baseBundle, kind) {
  const raceRoot = path.join(path.dirname(baseBundle), `final-handshake-${kind}`); mkdirSync(raceRoot, { mode: 0o700 }); const bundle = path.join(raceRoot, 'bundle'); cloneBundle(baseBundle, bundle);
  const barrier = path.join(path.dirname(raceRoot), `final-${kind}.barrier`); const release = path.join(path.dirname(raceRoot), `final-${kind}.release`); assert.equal(pathExists(barrier), false); assert.equal(pathExists(release), false);
  const server = await startServe(bundle, { SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_BARRIER_PATH: barrier, SAM_GOAL_MANUAL_REVIEW_OPS_V1_FINAL_RELEASE_PATH: release }); const session = await bootstrapSession(server);
  const attest = await fetchJsonResponse(server.base, '/api/attest', { method: 'POST', session, body: { actorPseudonymSha256: ACTOR_A, actorDeclaredNoOutsideInput: true, cycleId: CYCLE } }); assert.equal(attest.value.status, 'actor_attestation_recorded'); const waiting = server.wait(); const endPromise = fetchJsonResponse(server.base, '/api/end-session', { method: 'POST', session, body: {} });
  await waitForCanonicalBarrier(barrier, server.child, 20_000); assert.equal(permissionBits(barrier), 0o600);
  if (kind === 'mutable') {
    const mutable = path.join(bundle, 'mutable'); const moved = path.join(bundle, 'mutable-moved-final'); renameSync(mutable, moved); cloneTreePreservingModes(moved, mutable);
  } else if (kind === 'bundle-root') {
    const moved = path.join(raceRoot, 'bundle-moved-final'); renameSync(bundle, moved); cloneTreePreservingModes(moved, bundle);
  } else assert.fail(`unknown final handshake replacement: ${kind}`);
  writeFileSync(release, 'release\n', { mode: 0o600 }); await endPromise.catch(() => null); const exit = await waiting; assert.notEqual(exit.status, 0); assert.equal(parseChildJsonLines({ stdout: exit.stdout, stderr: '' }).some((item) => item.status === 'review_session_sealed'), false);
  const failure = parseChildJsonLines({ stdout: '', stderr: exit.stderr }).find((item) => typeof item?.code === 'string'); assert.ok(failure, `${kind}: missing final-handshake failure: ${exit.stderr}`); assert.ok(['held_directory_identity_drift', 'ancestor_identity_drift', 'bundle_tree_directory_drift', 'bundle_tree_member_set_drift'].includes(failure.code), `${kind}:${failure.code}`);
  assert.equal(pathExists(barrier), false); assert.equal(pathExists(release), false); assertNoTransactionResidue(raceRoot); evidence.exactFirstCodes[`serve:final-handshake-${kind}`] = failure.code; evidence.cases.expectedFailures += 1;
}

async function testServeSupervisorFault(bundle, fault) {
  const result = await runAsyncProcess(process.execPath, [CLI, 'serve', '--bundle-dir', bundle], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', SAM_GOAL_MANUAL_REVIEW_OPS_V1_SERVE_TEST: fault }, timeoutMs: 20_000 });
  assert.equal(result.timedOut, false, `${fault} timed out`); assert.notEqual(result.status, 0, `${fault} supervisor unexpectedly succeeded`); const reports = parseChildJsonLines(result); const failure = reports.find((item) => typeof item?.code === 'string' || item?.status === 'failed'); assert.ok(failure, `${fault}: missing supervisor failure envelope`);
  const expectedCode = FIXTURE.sessionTreeContract.serveProtocolFaultCodes[fault]; assert.equal(failure.code, expectedCode, `${fault}: ${result.stderr}`); assert.equal(parseChildJsonLines({ stdout: result.stdout, stderr: '' }).some((item) => item.status === 'review_session_sealed'), false); const ready = reports.find((item) => item?.status === 'review_ui_ready' && Number.isInteger(item?.port)); if (ready) { let refused = false; try { await fetch(`http://127.0.0.1:${ready.port}/api/manifest`, { signal: AbortSignal.timeout(1000) }); } catch { refused = true; } assert.equal(refused, true); }
  evidence.exactFirstCodes[`serve:supervisor-${fault}`] = failure.code; evidence.cases.expectedFailures += 1;
}

async function testInitialServeTreeFailures(baseBundle) {
  const root = path.join(path.dirname(baseBundle), 'initial-tree-negatives'); mkdirSync(root, { mode: 0o700 });
  const cases = [
    ['precreated-attestation', 'bundle_unsealed_member_set_invalid', (bundle) => writeFileSync(path.join(bundle, 'mutable/actor-attestation.json'), core.processBytes({ actorPseudonymSha256: ACTOR_A, actorDeclaredNoOutsideInput: true, cycleId: CYCLE }), { mode: 0o600 })],
    ['precreated-access', 'bundle_unsealed_member_set_invalid', (bundle) => writeFileSync(path.join(bundle, 'mutable/access-evidence.json'), '{}\n', { mode: 0o600 })],
    ['temporary-member', 'bundle_unsealed_member_set_invalid', (bundle) => writeFileSync(path.join(bundle, 'mutable/session.next'), 'next\n', { mode: 0o600 })],
    ['extra-fixed-member', 'bundle_unsealed_member_set_invalid', (bundle) => { mkdirSync(path.join(bundle, 'fixed'), { mode: 0o700 }); writeFileSync(path.join(bundle, 'fixed/extra.json'), '{}\n', { mode: 0o400 }); }],
    ['wrong-mutable-mode', 'bundle_asset_mode_drift', (bundle) => chmodSync(path.join(bundle, 'mutable/edit-journal.json'), 0o400)],
    ['missing-journal', 'ENOENT', (bundle) => unlinkSync(path.join(bundle, 'mutable/edit-journal.json'))],
    ['self-described-openat-substitution', 'coordinator_openat_bundle_pin_mismatch', (bundle) => {
      const target = path.join(bundle, 'immutable/coordinator-openat.node'); const replacementBytes = Buffer.from('self-described coordinator openat substitution\n'); chmodSync(target, 0o600); writeFileSync(target, replacementBytes); chmodSync(target, 0o400);
      const manifestPath = path.join(bundle, 'immutable/bundle-manifest.json'); const manifest = core.parseJsonBuffer(readFileSync(manifestPath), { processArtifact: true }); const asset = manifest.immutableAssets.find((item) => item.logicalPath === 'immutable/coordinator-openat.node'); assert.ok(asset); asset.bytes = replacementBytes.length; asset.sha256 = sha256(replacementBytes); manifest.immutableAssetSetSha256 = core.canonicalHash(manifest.immutableAssets); const manifestBytes = core.processBytes(manifest); chmodSync(manifestPath, 0o600); writeFileSync(manifestPath, manifestBytes); chmodSync(manifestPath, 0o400); const manifestHash = sha256(manifestBytes);
      for (const name of ['worksheet-seed.json', 'edit-journal.json']) { const filePath = path.join(bundle, 'mutable', name); const document = core.parseJsonBuffer(readFileSync(filePath), { processArtifact: true }); document.bundleManifestByteSha256 = manifestHash; writeFileSync(filePath, core.processBytes(document)); chmodSync(filePath, 0o600); }
    }],
  ];
  for (const [name, expectedCode, mutate] of cases) {
    const bundle = path.join(root, name); cloneBundle(baseBundle, bundle); mutate(bundle); const result = await runAsyncProcess(process.execPath, [CLI, 'serve', '--bundle-dir', bundle], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1' }, timeoutMs: 20_000 });
    assert.equal(result.timedOut, false, `${name}: timed out`); assert.notEqual(result.status, 0, `${name}: serve unexpectedly succeeded`); assert.equal(parseChildJsonLines({ stdout: result.stdout, stderr: '' }).some((item) => item.status === 'review_session_sealed'), false);
    const failure = parseChildJsonLines(result).find((item) => typeof item?.code === 'string'); assert.equal(failure?.code, expectedCode, `${name}: ${result.stderr}`); evidence.exactFirstCodes[`serve:initial-tree:${name}`] = failure.code; evidence.cases.expectedFailures += 1; assertNoTransactionResidue(root);
  }
  evidence.counts.serveInitialTreeNegativeBranches = cases.length;
}

async function testPreverifyTermStress(baseBundle) {
  const root = path.join(path.dirname(baseBundle), 'preverify-term-stress'); mkdirSync(root, { mode: 0o700 }); const preloadPath = path.join(root, 'signal-latch-and-spawn-monitor.cjs'); const preloadSource = [
    "'use strict';", "const childProcess = require('node:child_process');", "const fs = require('node:fs');", "process.on('SIGTERM', () => { process.exitCode = 143; });",
    "for (const name of ['spawn', 'spawnSync']) { const original = childProcess[name]; childProcess[name] = function monitoredSpawn(...args) { fs.appendFileSync(process.env.SAM_GOAL_TEST_SPAWN_MARKER, `${name}\\n`); return original.apply(this, args); }; }",
    "require('node:module').syncBuiltinESMExports();", "fs.writeFileSync(process.env.SAM_GOAL_TEST_SIGNAL_LATCH_READY, 'ready\\n', { mode: 0o600 });", '',
  ].join('\n'); writeFileSync(preloadPath, preloadSource, { mode: 0o600 }); const timings = [];
  for (let index = 0; index < 6; index += 1) {
    const ready = path.join(root, `ready-${index}`); const spawnMarker = path.join(root, `spawned-${index}`); const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`].filter(Boolean).join(' '); const started = performance.now(); const child = spawn(process.execPath, [CLI, 'serve', '--bundle-dir', baseBundle], { cwd: ROOT, detached: true, env: { ...process.env, NODE_ENV: 'test', NODE_OPTIONS: nodeOptions, SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', SAM_GOAL_TEST_SIGNAL_LATCH_READY: ready, SAM_GOAL_TEST_SPAWN_MARKER: spawnMarker }, stdio: ['ignore', 'pipe', 'pipe'] }); activeServeChildren.add(child); const stdout = []; const stderr = []; child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk))); child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk))); const exitPromise = new Promise((resolve) => child.once('exit', (status, signal) => { activeServeChildren.delete(child); resolve({ status, signal }); }));
    await waitForPath(ready, child, 5_000); child.kill('SIGTERM'); child.kill('SIGTERM'); let timer; const exit = await Promise.race([exitPromise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), 5_000); })]); clearTimeout(timer); if (exit === null) { killServeGroup(child); await exitPromise; throw Object.assign(new Error(`preverify TERM run ${index} timed out`), { code: 'preverify_term_timeout' }); }
    const groupGone = await serveGroupGone(child); if (!groupGone) { killServeGroup(child); await serveGroupGone(child); throw Object.assign(new Error(`preverify TERM run ${index} leaked descendant`), { code: 'preverify_term_descendant_leak' }); }
    const stdoutBytes = Buffer.concat(stdout); const stderrText = Buffer.concat(stderr).toString('utf8'); assert.equal(exit.status, 143, `preverify TERM ${index}: ${stderrText}`); assert.equal(exit.signal, null); assert.equal(stdoutBytes.length, 0); assert.equal(stderrText.includes('review_ui_ready'), false); assert.equal(pathExists(spawnMarker), false); const failure = parseChildJsonLines({ stdout: '', stderr: stderrText }).find((item) => typeof item?.code === 'string'); assert.equal(failure?.code, 'serve_interrupted'); unlinkSync(ready); timings.push(performance.now() - started);
  }
  assert.equal(pathExists(path.join(baseBundle, 'mutable/access-evidence.json')), false); assertNoTransactionResidue(path.dirname(baseBundle)); evidence.counts.preverifyTermStressRuns = timings.length; evidence.preverifyTermStress = { runs: timings.length, elapsedMs: timings, exitStatus: 143, processGroupsGone: true, childSpawns: 0, stdoutBytes: 0, residue: 0 };
}

async function testTrustedAssetLiteralPinFailures(baseBundle, publicState) {
  const root = path.join(path.dirname(baseBundle), 'trusted-asset-pin-negatives'); mkdirSync(root, { mode: 0o700 }); const preloadPath = path.join(root, 'spawn-monitor.cjs');
  const preloadSource = [
    "'use strict';",
    "const childProcess = require('node:child_process');",
    "const fs = require('node:fs');",
    "for (const name of ['spawn', 'spawnSync']) { const original = childProcess[name]; childProcess[name] = function monitoredSpawn(...args) { fs.appendFileSync(process.env.SAM_GOAL_TEST_SPAWN_MARKER, `${name}\\n`); return original.apply(this, args); }; }",
    "require('node:module').syncBuiltinESMExports();",
    '',
  ].join('\n');
  writeFileSync(preloadPath, preloadSource, { mode: 0o600 }); const observedCodes = new Set(); const mutations = [];
  for (const [logicalPath, expectedCode] of Object.entries(FIXTURE.sessionTreeContract.trustedAssetPinFailures)) {
    const name = logicalPath.replaceAll('/', '-').replaceAll('.', '-'); const bundle = path.join(root, name); const spawnMarker = path.join(root, `${name}.spawned`); cloneBundle(baseBundle, bundle); mutations.push(coherentlyResealTrustedAssetMutation(bundle, logicalPath, publicState));
    const nodeOptions = [process.env.NODE_OPTIONS, `--require=${preloadPath}`].filter(Boolean).join(' '); const result = await runAsyncProcess(process.execPath, [CLI, 'serve', '--bundle-dir', bundle], { env: { ...process.env, NODE_ENV: 'test', NODE_OPTIONS: nodeOptions, SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1', SAM_GOAL_MANUAL_REVIEW_OPS_V1_SERVE_TEST: 'startup-hang', SAM_GOAL_TEST_SPAWN_MARKER: spawnMarker }, timeoutMs: 20_000 });
    assert.equal(result.timedOut, false, `${logicalPath}: trusted pin gate timed out`); assert.notEqual(result.status, 0, `${logicalPath}: coherent trusted-asset forgery accepted`); assert.equal(result.stdout, '', `${logicalPath}: pre-spawn rejection emitted stdout`); assert.equal(result.stderr.includes('review_ui_ready'), false, `${logicalPath}: child readiness leaked`); assert.equal(pathExists(spawnMarker), false, `${logicalPath}: child process was spawned before trusted pin rejection`);
    const reports = parseChildJsonLines({ stdout: '', stderr: result.stderr }); assert.equal(reports.filter((item) => typeof item?.code === 'string').length, 1, `${logicalPath}: ${result.stderr}`); const failure = reports.find((item) => typeof item?.code === 'string'); assert.equal(failure.code, expectedCode, `${logicalPath}: ${result.stderr}`); assert.equal(observedCodes.has(failure.code), false, `trusted pin code not distinct: ${failure.code}`); observedCodes.add(failure.code);
    assert.equal(pathExists(path.join(bundle, 'mutable/actor-attestation.json')), false); assert.equal(pathExists(path.join(bundle, 'mutable/access-evidence.json')), false); evidence.exactFirstCodes[`serve:trusted-asset:${logicalPath}`] = failure.code; evidence.cases.expectedFailures += 1; assertNoTransactionResidue(bundle);
  }
  assert.equal(observedCodes.size, Object.keys(FIXTURE.sessionTreeContract.trustedAssetPinFailures).length); evidence.counts.trustedAssetCoherentResealBranches = mutations.length; evidence.hashes.trustedAssetMutationOracleSha256 = core.canonicalHash(mutations); assertPublicBytesUnchanged();
}

async function testServeOperations(publicState) {
  if (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_SKIP_SERVE_E2E === '1') { evidence.serveE2E = { skippedByExplicitEnvironment: true }; return; }
  const serveRoot = path.join(tempRoot, 'serve-e2e'); mkdirSync(serveRoot, { mode: 0o700 }); const baseBundle = path.join(serveRoot, 'base');
  const prepared = await runAsyncProcess(process.execPath, [CLI, 'prepare-bundle', '--mode', 'first', '--actor-pseudonym-sha256', ACTOR_A, '--cycle-id', CYCLE, '--bundle-dir', baseBundle], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1' }, timeoutMs: 60_000 });
  assert.equal(prepared.timedOut, false); assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout); assert.equal(parseChildJsonLines(prepared).some((item) => item.status === 'blind_bundle_prepared'), true);
  for (const [logical, mode] of [['immutable/bundle-manifest.json', 0o400], ['immutable/runtime/node', 0o500], ['mutable/worksheet-seed.json', 0o600], ['mutable/edit-journal.json', 0o600]]) assert.equal(permissionBits(path.join(baseBundle, logical)), mode, `${logical} mode`);
  await testBlindOfflinePrefillRejected(baseBundle, publicState);
  if (process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_CHAIN_ONLY === '1' || REQUESTED_PHASE === 'headed') { await testClosedLoopReviewChain(baseBundle, publicState); assertNoTransactionResidue(serveRoot); return; }
  await testPreverifyTermStress(baseBundle); await testInitialServeTreeFailures(baseBundle); await testTrustedAssetLiteralPinFailures(baseBundle, publicState);
  const clean = path.join(serveRoot, 'clean'); const termReap = path.join(serveRoot, 'term-reap'); const forged = path.join(serveRoot, 'forged'); const swapped = path.join(serveRoot, 'swapped'); const ancestor = path.join(serveRoot, 'ancestor'); const rootReplacement = path.join(serveRoot, 'root-replacement'); cloneBundle(baseBundle, clean); cloneBundle(baseBundle, termReap); cloneBundle(baseBundle, forged); cloneBundle(baseBundle, swapped); cloneBundle(baseBundle, ancestor); cloneBundle(baseBundle, rootReplacement);
  await testCleanServeSession(clean, publicState); await testServeTermReap(termReap); await testForgedAttestation(forged, publicState, 'precreate'); await testForgedAttestation(swapped, publicState, 'swap'); await testMutableAncestorReplacement(ancestor); await testBundleRootReplacement(rootReplacement);
  await testFinalHandshakeReplacement(baseBundle, 'mutable'); await testFinalHandshakeReplacement(baseBundle, 'bundle-root');
  await testClosedLoopReviewChain(baseBundle, publicState);
  for (const fault of ['startup-hang', 'oversize-ready', 'duplicate-key-ready', 'malformed-ready', 'extra-ready-line', 'crash-after-ready']) { const faultBundle = path.join(serveRoot, `fault-${fault}`); cloneBundle(baseBundle, faultBundle); await testServeSupervisorFault(faultBundle, fault); rmSync(faultBundle, { recursive: true, force: true }); }
  for (const [name, logical, mode] of [['nonexec-0600', 'immutable/viewer/app.js', 0o600], ['runtime-0700', 'immutable/runtime/node', 0o700], ['mutable-0400', 'mutable/worksheet-seed.json', 0o400], ['directory-0755', 'immutable/viewer', 0o755]]) {
    const modeBundle = path.join(serveRoot, `mode-${name}`); cloneBundle(baseBundle, modeBundle); chmodSync(path.join(modeBundle, logical), mode); const result = await runAsyncProcess(process.execPath, [CLI, 'serve', '--bundle-dir', modeBundle], { env: { ...process.env, NODE_ENV: 'test', SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST: '1' }, timeoutMs: 20_000 }); assert.notEqual(result.status, 0, `mode drift accepted: ${name}`); const failure = parseChildJsonLines(result).find((item) => typeof item?.code === 'string'); assert.equal(failure?.code, 'bundle_asset_mode_drift'); rmSync(modeBundle, { recursive: true, force: true }); }
  assertNoTransactionResidue(serveRoot); evidence.counts.serveSupervisorFaults = 6; evidence.counts.bundleModeDriftBranches = 4;
}


async function testTenThousandTransitions(publicState, worksheet) {
  const performanceRoot = path.join(tempRoot, 'performance'); mkdirSync(performanceRoot, { mode: 0o700 });
  const proofDirectory = path.join(performanceRoot, 'proof'); mkdirSync(proofDirectory, { mode: 0o700 });
  const leftBytes = Buffer.from('left\n'); const rightBytes = Buffer.from('right\n'); writeFileSync(path.join(proofDirectory, 'left'), leftBytes, { mode: 0o400 }); writeFileSync(path.join(proofDirectory, 'right'), rightBytes, { mode: 0o400 });
  const expectedHashes = { left: sha256(leftBytes), right: sha256(rightBytes) }; const expectedModes = { left: 0o400, right: 0o400 };
  let seed = 0x13579bdf; let identityDrift = 0; let unsetDrift = 0; let roleDrift = 0; let expectedHashDrift = 0; let bundleIsolationDrift = 0; let projectionDrift = 0; let receiptChain = ZERO_SHA; let proofs = 0;
  const categories = { identity: 0, editUndo: 0, window: 0, receiptAndReproof: 0 }; const startRss = process.memoryUsage().rss; let peakRss = startRss; const start = performance.now();
  const rows = worksheet.rows; const presentRows = rows.filter((row) => row.manualState.presence === 'present');
  for (let transition = 0; transition < FIXTURE.transitionCount; transition += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    if (transition % 4 === 0) {
      const index = seed % rows.length; if (stableStringify(exactIdentity(rows[index])) !== stableStringify(exactIdentity(publicState.decoderRows[index]))) identityDrift += 1; categories.identity += 1;
    } else if (transition % 4 === 1) {
      const row = presentRows[seed % presentRows.length]; const previous = clone(row.manualState.subjectSelection.anchor); row.manualState.subjectSelection.anchor = { x: 0, y: 1 }; core.assertManualState(row.manualState); row.manualState.subjectSelection.anchor = previous; core.assertManualState(row.manualState); if (core.containsUnset(row)) unsetDrift += 1; categories.editUndo += 1;
    } else if (transition % 4 === 2) {
      const windows = core.normalizeWindows(worksheet); if (windows.length !== worksheet.windows.length || windows.some((window) => Object.hasOwn(window, 'origin'))) projectionDrift += 1; core.canonicalHash(windows); categories.window += 1;
    } else {
      const receipt = processDocument('sam-goal-transition-receipt-v1', { sequence: transition, priorSha256: receiptChain, role: 'first', cycleId: CYCLE, bundleId: 'isolated-a' }); receiptChain = sha256(core.processBytes(receipt));
      if (!SHA.test(receiptChain)) expectedHashDrift += 1; if (receipt.role !== 'first') roleDrift += 1; if (receipt.bundleId !== 'isolated-a') bundleIsolationDrift += 1;
      if (transition % 250 === 3) { const proof = core.proveDirectorySync(proofDirectory, ['left', 'right'], expectedHashes, { expectedDirectoryMode: 0o700, expectedMemberModes: expectedModes }); closeProof(proof); proofs += 1; }
      categories.receiptAndReproof += 1;
    }
    if (transition % 250 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }
  const wallMs = performance.now() - start; peakRss = Math.max(peakRss, process.memoryUsage().rss);
  assert.deepEqual(categories, { identity: 2500, editUndo: 2500, window: 2500, receiptAndReproof: 2500 });
  assert.deepEqual({ identityDrift, unsetDrift, roleDrift, expectedHashDrift, bundleIsolationDrift, projectionDrift }, { identityDrift: 0, unsetDrift: 0, roleDrift: 0, expectedHashDrift: 0, bundleIsolationDrift: 0, projectionDrift: 0 });
  assert.equal(proofs, 20); assert.match(receiptChain, SHA);
  evidence.performance = { transitions: FIXTURE.transitionCount, categories, directoryReproofs: proofs, wallMs, startRssBytes: startRss, peakRssBytes: peakRss, retainedRssDeltaBytes: process.memoryUsage().rss - startRss, inventedThresholdApplied: false };
  evidence.hashes.transitionReceiptChainSha256 = receiptChain;
}

function assertPublicBytesUnchanged() {
  for (const [logicalPath, expected] of Object.entries(FIXTURE.publicBytePins)) assert.equal(sha256(readFileSync(path.join(ROOT, logicalPath))), expected, `public dependency mutated: ${logicalPath}`);
}

function auditOwnedFixtureScope() {
  const status = spawnSync('git', ['status', '--short', '--', 'tests/sam-goal-manual-review-ops-v1-check.mjs', 'tests/fixtures/sam-goal-v2/evaluation-v3/manual-review-operations-fixtures'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(status.status, 0, status.stderr); evidence.scopeStatus = status.stdout.trim().split(/\r?\n/u).filter(Boolean);
  assert.ok(evidence.scopeStatus.every((line) => line.endsWith('tests/sam-goal-manual-review-ops-v1-check.mjs') || line.includes('manual-review-operations-fixtures')));
}

async function main() {
  const requestedPhase = REQUESTED_PHASE;
  const created = mkdtempSync(path.join(os.tmpdir(), 'sam-mro-r1-check-')); tempRoot = realpathSync(created); chmodSync(tempRoot, 0o700);
  try {
    let publicState; let state;
    await testCase('public:pins-and-identities', async () => { publicState = await testPublicPinsAndIdentities(); });
    await testCase('session-tree:descriptor-contract', async () => testSessionTreeDescriptorContract());
    await testCase('rulebook:frozen-contract', async () => assertRulebookContract());
    await testCase('worksheet:truth-evidence', async () => { state = await testWorksheetTruthAndEvidence(publicState); });
    if (!['schema', 'atomic', 'cli', 'serve', 'headed'].includes(requestedPhase)) {
      await testCase('disagreement:typed-and-deviation', async () => testDisagreementsAndDeviation(publicState, state.worksheetC0));
      await testCase('final-parity:four-mosaic-mutants', async () => testFinalEvidenceParityMutants(publicState));
      await testCase('performance:ten-thousand-transitions', async () => testTenThousandTransitions(publicState, state.worksheetA));
    }
    if (!['core', 'cli', 'serve', 'headed'].includes(requestedPhase)) {
      if (requestedPhase !== 'atomic') await testCase('schema:draft-custom-matrix', async () => testProcessSchemas(publicState, state));
      if (requestedPhase !== 'schema') { await testCase('atomic:sealed-output-attacks', async () => testSealedOutputsAndAtomicity()); await testCase('openat:coordinator-helper', async () => testCoordinatorOpenatHelper()); }
    }
    if (['all', 'cli'].includes(requestedPhase)) await testCase('cli:surface-scope-ui', async () => testCliSurfaceAndScope());
    if (['all', 'serve', 'headed'].includes(requestedPhase)) await testCase('serve:supervisor-session-access', async () => testServeOperations(publicState));
    await testCase('scope:public-unchanged', async () => { assertPublicBytesUnchanged(); auditOwnedFixtureScope(); });
    assertNoTransactionResidue(tempRoot);
    evidence.status = 'passed'; evidence.hashes.fixtureByteSha256 = sha256(readFileSync(FIXTURE_PATH)); evidence.hashes.testByteSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
    evidence.hashes.resultCoreCanonicalSha256 = core.canonicalHash({ counts: evidence.counts, exactFirstCodes: evidence.exactFirstCodes, publicPins: FIXTURE.publicPins, fixtureByteSha256: evidence.hashes.fixtureByteSha256 });
    process.stdout.write(`${JSON.stringify(stable(evidence), null, 2)}\n`);
  } finally {
    for (const child of activeServeChildren) try { killServeGroup(child); } catch {}
    activeServeChildren.clear();
    if (tempRoot && pathExists(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--atomic-child') {
  await atomicChildMain(process.argv[3], process.argv[4]);
} else {
  try { await main(); } catch (error) { outputFailure(error); for (const child of activeServeChildren) try { killServeGroup(child); } catch {} activeServeChildren.clear(); if (tempRoot && pathExists(tempRoot)) rmSync(tempRoot, { recursive: true, force: true }); process.exitCode = 1; }
}
