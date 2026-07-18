import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const PUBLIC_PATHS = Object.freeze({
  evaluationContract: 'tests/fixtures/sam-goal-v2/evaluation-v3/evaluation-contract.json',
  labelSchema: 'tests/fixtures/sam-goal-v2/evaluation-v3/label-schema.json',
  authoringSchema: 'tests/fixtures/sam-goal-v2/evaluation-v3/authoring-schema.json',
  sourceInventory: 'tests/fixtures/sam-goal-v2/labels/source-inventory.json',
  decoderManifest: 'tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl',
  manualPackCompiler: 'scripts/sam-goal-manual-pack-v3.mjs',
});
const PROCESS_SCHEMA_NAMES = Object.freeze(['access-evidence-v1.schema.json', 'bundle-manifest-v1.schema.json', 'c0-ledger-v1.schema.json', 'deviation-evidence-v1.schema.json', 'edit-journal-v1.schema.json', 'handoff-report-v1.schema.json', 'raw-ab-report-v1.schema.json', 'reveal-receipt-v1.schema.json', 'review-export-receipt-v1.schema.json', 'worksheet-v1.schema.json']);
const VIEWER_ASSET_NAMES = Object.freeze(['app.js', 'core.mjs', 'exact-still-decoder.js', 'index.html', 'schema-validator.mjs', 'style.css']);
const LAUNCHER_ASSET_NAMES = Object.freeze(['coordinator-openat.c', 'coordinator-openat.node', 'launcher.mjs', 'sandbox-init.c', 'sandbox-init.node', 'sandbox-preload.cjs']);

// Accepted r2 worker packet a8e10c634006a2625d2486ba87e6508563bfc2e19d6d9531f7fc2ff0bc04ee51
// and public-pins supplement ba88572f5cdfcb20b864fda7365bccd79bc4d4579878eefbfebfde50b23345f0.
// These expected values are intentionally literal. Runtime never derives its authority pins
// from the repository bytes it is about to verify.
export const PUBLIC_PINS = Object.freeze({
  evaluationContractCanonicalSha256: '5307a5d4e2c56e652b7a417713e1b0ebff5dabf712e591eefa94737e7318b1bd',
  labelSchemaCanonicalSha256: 'afe645d7c062e3644db96cea20b2f6724892077f1993de829a28deeb38d138f8',
  authoringSchemaCanonicalSha256: 'c255cab6b226b0b4ac418ff17c92fec053d34156bf3efaf3af88fc30cdd32962',
  sourceInventoryCanonicalSha256: '64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d',
  decoderByteSha256: 'd300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79',
  decoderCanonicalRowsSha256: 'dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d',
  manualPackCompilerByteSha256: '486566190bb148ed0ed7fb8421a1ed57a96228346579e250394fca5000239b44',
});

export const RENAME_EXCL_PYTHON = '/usr/bin/python3';
export const RENAME_EXCL_PYTHON_BYTE_SHA256 = '179301dcb41ea78accc3fa0048a7e6f6710d891945a751a34addd622020c1818';
export const RENAME_EXCL_HELPER_SOURCE = String.raw`import ctypes,errno,json,os,stat,sys,time
source,destination=sys.argv[1:3]
source_stat=os.lstat(source)
source_type="directory" if stat.S_ISDIR(source_stat.st_mode) else ("regular" if stat.S_ISREG(source_stat.st_mode) else "other")
source_meta={"dev":source_stat.st_dev,"ino":source_stat.st_ino,"mode":source_stat.st_mode,"nlink":source_stat.st_nlink,"size":source_stat.st_size,"type":source_type}
if source_type=="other" or stat.S_ISLNK(source_stat.st_mode) or (source_type=="regular" and source_stat.st_nlink!=1):
 print(json.dumps({"errno":errno.EINVAL,"rc":-2,"source":source_meta,"syscallRc":None},separators=(",",":"),sort_keys=True));sys.exit(1)
try:
 destination_stat=os.lstat(destination)
 destination_type="directory" if stat.S_ISDIR(destination_stat.st_mode) else ("regular" if stat.S_ISREG(destination_stat.st_mode) else "other")
 print(json.dumps({"destination":{"dev":destination_stat.st_dev,"ino":destination_stat.st_ino,"mode":destination_stat.st_mode,"nlink":destination_stat.st_nlink,"size":destination_stat.st_size,"type":destination_type},"errno":errno.EEXIST,"rc":-2,"source":source_meta,"syscallRc":None},separators=(",",":"),sort_keys=True));sys.exit(17)
except FileNotFoundError:
 pass
if os.environ.get("MRO_RENAME_TEST_NODE_ENV")=="test" and os.environ.get("MRO_RENAME_TEST_RUNTIME")=="1" and os.environ.get("MRO_RENAME_TEST_BARRIER")=="1":
 barrier=os.environ["MRO_RENAME_TEST_BARRIER_PATH"]
 release=os.environ["MRO_RENAME_TEST_RELEASE_PATH"]
 fd=os.open(barrier,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
 deadline=time.monotonic()+10
 while not os.path.exists(release):
  if time.monotonic()>=deadline: print(json.dumps({"errno":errno.ETIMEDOUT,"rc":-3,"source":source_meta,"syscallRc":None},separators=(",",":"),sort_keys=True));sys.exit(1)
  time.sleep(0.005)
print(json.dumps({"phase":"READY","source":source_meta},separators=(",",":"),sort_keys=True),flush=True)
if sys.stdin.buffer.readline()!=b"GO\n": print(json.dumps({"errno":errno.ECANCELED,"rc":-3,"source":source_meta,"syscallRc":None},separators=(",",":"),sort_keys=True));sys.exit(1)
libc=ctypes.CDLL(None,use_errno=True)
rename_excl=libc.renamex_np
rename_excl.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint]
rename_excl.restype=ctypes.c_int
ctypes.set_errno(0)
rc=rename_excl(os.fsencode(source),os.fsencode(destination),ctypes.c_uint(0x4))
syscall_rc=rc
error=ctypes.get_errno()
result={"errno":error,"rc":rc,"source":source_meta,"syscallRc":syscall_rc}
if rc==0:
 destination_stat=os.lstat(destination)
 destination_type="directory" if stat.S_ISDIR(destination_stat.st_mode) else ("regular" if stat.S_ISREG(destination_stat.st_mode) else "other")
 result["destination"]={"dev":destination_stat.st_dev,"ino":destination_stat.st_ino,"mode":destination_stat.st_mode,"nlink":destination_stat.st_nlink,"size":destination_stat.st_size,"type":destination_type}
 if result["destination"]!=source_meta: result["errno"]=errno.EIO;result["rc"]=-4;rc=-4
print(json.dumps(result,separators=(",",":"),sort_keys=True))
sys.exit(0 if rc==0 else (17 if error==errno.EEXIST else 1))
`;
export const RENAME_EXCL_HELPER_SOURCE_EXPECTED_SHA256 = '970836a0b3451391604e62c0895b0ac7f3d83e31bb53dbd82cb244c825c2149e';
export const RENAME_EXCL_HELPER_SOURCE_SHA256 = sha256(Buffer.from(RENAME_EXCL_HELPER_SOURCE, 'utf8'));

export const PROCESS_MARKER = Object.freeze({
  authorityClass: 'process-evidence-only',
  compilerInput: false,
  p0Authority: false,
});
export const PRESENTATION_INTERFACE_ID = 'sam_goal.manual_review_operations';
export const PRESENTATION_INTERFACE_VERSION = 3;
export const PRESENTATION_EVIDENCE_TARGETS = Object.freeze({
  selectorAttribute: 'data-sam-goal-evidence-target',
  blind: 'blind-exact-source-frame',
  reveal: 'reveal-exact-source-frame',
});
export const PRESENTATION_VIEW_MODES = Object.freeze(['fit', 'one-to-one']);
export const PRESENTATION_VIEWER_LOGICAL_PATHS = Object.freeze(VIEWER_ASSET_NAMES.map((name) => `immutable/viewer/${name}`).sort(rawUtf8Compare));
export const UNSET = Object.freeze({ status: 'UNSET' });
export const C0_MISSING = Object.freeze({ status: 'C0_WINDOW_MISSING' });
export const SHA_RE = /^[0-9a-f]{64}$/;
export const PSEUDONYM_RE = SHA_RE;
export const WINDOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const SCENARIOS = Object.freeze([
  'neutral', 'entry_exit', 'reacquire', 'arms_crossed', 'self_occlusion',
  'side_view', 'back_view', 'fast_motion', 'jump', 'footwork', 'turn',
  'leg_extension', 'distance_change', 'partial_body_crop',
  'multi_person_background', 'duplicate_detection_challenge', 'hand_closeup',
  'full_body_dance', 'upper_body_only',
]);
export const PURPOSES = Object.freeze([
  'full_clip_denominator', 'absence_reacquire', 'self_occlusion', 'fast_motion',
  'contact_transition', 'multi_person', 'crop_out_of_frame',
  'duplicate_detection', 'turning', 'hand_observability',
]);
export const OCCLUSION_FIELDS = Object.freeze(['body', 'leftFoot', 'rightFoot', 'leftHand', 'rightHand']);
export const HAND_FIELDS = Object.freeze(['left', 'right']);
export const ENDPOINT_FIELDS = Object.freeze(['leftWrist', 'rightWrist', 'leftAnkle', 'rightAnkle', 'head']);
export const SEGMENT_LEAVES = Object.freeze([
  ['scenarios', 'scenario-array'],
  ['presence', 'presence'],
  ['personState', 'person-state'],
  ['occlusion/body', 'occlusion-state'],
  ['occlusion/leftFoot', 'occlusion-state'],
  ['occlusion/rightFoot', 'occlusion-state'],
  ['occlusion/leftHand', 'occlusion-state'],
  ['occlusion/rightHand', 'occlusion-state'],
  ['contact/left', 'contact-state'],
  ['contact/right', 'contact-state'],
  ['handObservability/left', 'hand-observability-state'],
  ['handObservability/right', 'hand-observability-state'],
  ['endpointObservability/leftWrist', 'endpoint-observability-state'],
  ['endpointObservability/rightWrist', 'endpoint-observability-state'],
  ['endpointObservability/leftAnkle', 'endpoint-observability-state'],
  ['endpointObservability/rightAnkle', 'endpoint-observability-state'],
  ['endpointObservability/head', 'endpoint-observability-state'],
  ['subjectSelection/state', 'subject-state'],
  ['subjectSelection/manualTargetId', 'manual-target-id'],
  ['subjectSelection/anchor', 'anchor'],
]);
export const VALUE_TYPES = Object.freeze([
  'scenario-array', 'presence', 'person-state', 'occlusion-state', 'contact-state',
  'hand-observability-state', 'endpoint-observability-state', 'subject-state',
  'manual-target-id', 'anchor', 'window-or-null', 'source-frame-index',
  'source-frame-index-exclusive', 'purpose-array',
]);
export const DEVIATION_CLASSES = Object.freeze([
  'final_matches_a_only', 'final_matches_b_only', 'final_matches_neither_raw_review',
  'final_matches_c0_all_rows', 'final_matches_c0_some_rows', 'final_matches_c0_no_rows',
  'c0_differs_from_ab_agreement', 'c0_boundary_not_represented_by_ab',
  'window_final_matches_c0', 'window_final_differs_from_c0', 'c0_window_missing',
]);
export const CLASS_DISPOSITIONS = Object.freeze({
  final_matches_a_only: ['accept_a_value', 'restart_cycle'],
  final_matches_b_only: ['accept_b_value', 'restart_cycle'],
  final_matches_neither_raw_review: ['accept_novel_source_value', 'restart_cycle'],
  final_matches_c0_all_rows: ['confirm_c0_alignment', 'restart_cycle'],
  final_matches_c0_some_rows: ['accept_partial_c0_divergence', 'restart_cycle'],
  final_matches_c0_no_rows: ['accept_c0_divergence', 'restart_cycle'],
  c0_differs_from_ab_agreement: ['confirm_ab_agreement_over_c0', 'restart_cycle'],
  c0_boundary_not_represented_by_ab: ['confirm_unsplit_ab_coordinate', 'restart_cycle'],
  window_final_matches_c0: ['confirm_window_c0_alignment', 'restart_cycle'],
  window_final_differs_from_c0: ['accept_window_c0_divergence', 'restart_cycle'],
  c0_window_missing: ['accept_window_without_c0', 'restart_cycle'],
});
export const REVEAL_FIXED_LOGICAL_PATHS = Object.freeze([
  'fixed/access-policy.json',
  'fixed/c0-ledger.json',
  'fixed/disagreement-skeleton.json',
  'fixed/raw-ab-report.json',
  'fixed/reveal-receipt.json',
  'fixed/review-a-export-receipt.json',
  'fixed/review-a.json',
  'fixed/review-b-export-receipt.json',
  'fixed/review-b.json',
]);
export const REVEAL_MUTABLE_LOGICAL_PATHS = Object.freeze([
  'mutable/adjudication-journal.json',
  'mutable/actor-attestation.json',
  'mutable/access-evidence.json',
]);
export const SESSION_TREE_DESCRIPTOR_FIELDS = Object.freeze([
  'artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority',
  'terminalState', 'cycleId', 'mode', 'actorPseudonymSha256', 'presentationContractSha256',
  'bundleManifestByteSha256', 'immutableAssetSetSha256', 'fixedInputSetSha256',
  'sessionSeedByteSha256', 'sessionFinalStateByteSha256', 'editJournalByteSha256',
  'actorAttestationByteSha256', 'accessEvidenceByteSha256',
]);
export const SESSION_SEAL_ENVELOPE_FIELDS = Object.freeze([
  'status', 'cycleId', 'mode', 'actorPseudonymSha256', 'presentationContractSha256', 'sessionTreeSha256',
  'bundleManifestByteSha256', 'fixedInputSetSha256', 'sessionSeedByteSha256',
  'sessionFinalStateByteSha256', 'editJournalByteSha256',
  'actorAttestationByteSha256', 'accessEvidenceByteSha256',
]);

export class MroError extends Error {
  constructor(code, message = code, details = undefined) {
    super(message);
    this.name = 'MroError';
    this.code = code;
    this.details = details;
  }
}

const SIGNAL_EXIT = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
const transactionSignals = { activeChildren: new Set(), stages: new Map(), critical: 0, latched: null, preCommit: null };
for (const signal of Object.keys(SIGNAL_EXIT)) process.on(signal, () => {
  if (transactionSignals.critical > 0) { transactionSignals.latched ??= signal; return; }
  transactionSignals.preCommit ??= signal;
  for (const child of transactionSignals.activeChildren) { try { child.kill(signal); } catch {} }
  // Do not unlink an in-flight stage here: an async prepare callback could recreate the same
  // pathname with a different inode after this handler returns. The owning transaction observes
  // preCommit at its next checked boundary and removes only its registered inode in its catch.
  process.exitCode = SIGNAL_EXIT[signal];
});
process.on('exit', () => {
  for (const [stage, owned] of transactionSignals.stages) {
    try { const located = locateOwnedPath(stage, owned); if (located && !owned.pastPonr && !owned.indeterminatePreserve && (!owned.protectedDestination || path.resolve(located) !== path.resolve(owned.protectedDestination))) fs.rmSync(located, { recursive: owned.type === 'directory', force: false }); } catch {}
  }
});

function throwIfPreCommitSignal() { if (transactionSignals.preCommit) fail('pre_commit_signal', transactionSignals.preCommit, { exitCode: SIGNAL_EXIT[transactionSignals.preCommit] }); }
function registerStage(stage, owned) { owned.parentChain ??= captureAncestorChainSync(path.dirname(stage)); owned.basename ??= path.basename(stage); transactionSignals.stages.set(stage, owned); }
function unregisterStage(stage) { transactionSignals.stages.delete(stage); }
function enterCommitCritical() { throwIfPreCommitSignal(); transactionSignals.critical += 1; }
function leaveCommitCritical() { transactionSignals.critical = Math.max(0, transactionSignals.critical - 1); if (transactionSignals.critical === 0 && transactionSignals.latched) { const signal = transactionSignals.latched; transactionSignals.latched = null; const code = SIGNAL_EXIT[signal]; process.exitCode = code; return code; } return null; }

export function spawnTracked(executable, args, options = {}) {
  throwIfPreCommitSignal();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, encoding: undefined, stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'] }); transactionSignals.activeChildren.add(child);
    const stdout = []; const stderr = []; child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk))); child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => { transactionSignals.activeChildren.delete(child); reject(error); });
    child.once('exit', (status, signal) => { transactionSignals.activeChildren.delete(child); resolve({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), pid: child.pid }); });
  });
}

export function fail(code, message = code, details) {
  throw new MroError(code, message, details);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function rawUtf8Compare(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function canonicalStringify(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non_finite_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(rawUtf8Compare).map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
  }
  fail('unsupported_json_value');
}

export function canonicalHash(value, { excludeRootExpectedHash = false } = {}) {
  const cloned = structuredClone(value);
  if (excludeRootExpectedHash && cloned && typeof cloned === 'object' && !Array.isArray(cloned)) {
    delete cloned.expectedCanonicalHash;
  }
  return sha256(Buffer.from(canonicalStringify(cloned), 'utf8'));
}

class StrictJsonParser {
  constructor(text) { this.text = text; this.index = 0; }
  ws() { while ([' ', '\t', '\n', '\r'].includes(this.text[this.index])) this.index += 1; }
  parse() { this.ws(); const value = this.value(); this.ws(); if (this.index !== this.text.length) fail('json_trailing_data'); return value; }
  value() {
    this.ws(); const c = this.text[this.index];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    if (this.text.startsWith('true', this.index)) { this.index += 4; return true; }
    if (this.text.startsWith('false', this.index)) { this.index += 5; return false; }
    if (this.text.startsWith('null', this.index)) { this.index += 4; return null; }
    return this.number();
  }
  string() {
    const start = this.index; this.index += 1;
    for (;;) {
      if (this.index >= this.text.length) fail('json_unterminated_string');
      const c = this.text[this.index++];
      if (c === '"') break;
      if (c === '\\') this.index += 1;
      else if (c.charCodeAt(0) < 0x20) fail('json_control_character');
    }
    try { return JSON.parse(this.text.slice(start, this.index)); } catch { fail('json_invalid_string'); }
  }
  number() {
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u);
    if (!match) fail('json_invalid_value');
    this.index += match[0].length; const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('non_finite_number'); return value;
  }
  array() {
    const out = []; this.index += 1; this.ws();
    if (this.text[this.index] === ']') { this.index += 1; return out; }
    for (;;) {
      out.push(this.value()); this.ws(); const c = this.text[this.index++];
      if (c === ']') return out; if (c !== ',') fail('json_invalid_array');
    }
  }
  object() {
    const out = Object.create(null); const seen = new Set(); this.index += 1; this.ws();
    if (this.text[this.index] === '}') { this.index += 1; return out; }
    for (;;) {
      this.ws(); if (this.text[this.index] !== '"') fail('json_object_key_required');
      const key = this.string(); if (seen.has(key)) fail('duplicate_json_key', `duplicate JSON key: ${key}`); seen.add(key);
      this.ws(); if (this.text[this.index++] !== ':') fail('json_colon_required');
      Object.defineProperty(out, key, { configurable: true, enumerable: true, value: this.value(), writable: true }); this.ws(); const c = this.text[this.index++];
      if (c === '}') return out; if (c !== ',') fail('json_invalid_object');
    }
  }
}

export function parseJsonBuffer(buffer, { processArtifact = false } = {}) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) fail('utf8_bom_forbidden');
  const text = buffer.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buffer)) fail('invalid_utf8');
  if (processArtifact && (!text.endsWith('\n') || text.endsWith('\n\n'))) fail('terminal_lf_required');
  return new StrictJsonParser(text).parse();
}

export function processBytes(value) {
  return Buffer.from(`${canonicalStringify(value)}\n`, 'utf8');
}

export function fixedInputDescriptors(entries, { expectedLogicalPaths } = {}) {
  if (!Array.isArray(entries)) fail('fixed_input_set_invalid');
  const descriptors = entries.map((entry) => {
    assertExactKeys(entry, ['logicalPath', 'bytes', 'sha256'], 'fixed_input_descriptor_not_closed');
    if (typeof entry.logicalPath !== 'string' || !entry.logicalPath.startsWith('fixed/') || entry.logicalPath.startsWith('/') || entry.logicalPath.includes('..') || entry.logicalPath.includes('\\') || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) fail('fixed_input_descriptor_invalid');
    assertSha(entry.sha256, 'fixed_input_descriptor_invalid'); return { logicalPath: entry.logicalPath, bytes: entry.bytes, sha256: entry.sha256 };
  }).sort((left, right) => rawUtf8Compare(left.logicalPath, right.logicalPath));
  if (new Set(descriptors.map((entry) => entry.logicalPath)).size !== descriptors.length) fail('fixed_input_set_invalid');
  if (expectedLogicalPaths && !deepEqual(descriptors.map((entry) => entry.logicalPath), [...expectedLogicalPaths].sort(rawUtf8Compare))) fail('fixed_input_set_invalid');
  return descriptors;
}

export function fixedInputSetSha256(entries, options) {
  return sha256(processBytes(fixedInputDescriptors(entries, options)));
}

export function presentationViewerDescriptors(assets) {
  if (!Array.isArray(assets)) fail('presentation_contract_descriptor_invalid');
  const byPath = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || !PRESENTATION_VIEWER_LOGICAL_PATHS.includes(asset.logicalPath) || byPath.has(asset.logicalPath) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.sha256 !== 'string' || !SHA_RE.test(asset.sha256)) continue;
    byPath.set(asset.logicalPath, { logicalPath: asset.logicalPath, bytes: asset.bytes, sha256: asset.sha256 });
  }
  const descriptors = [...byPath.values()].sort((left, right) => rawUtf8Compare(left.logicalPath, right.logicalPath));
  if (!deepEqual(descriptors.map((item) => item.logicalPath), PRESENTATION_VIEWER_LOGICAL_PATHS)) fail('presentation_contract_descriptor_invalid');
  return descriptors;
}

export function makePresentationContractDescriptor(assets) {
  return {
    artifactType: 'sam-goal-manual-review-presentation-contract-v1',
    schemaVersion: 1,
    ...PROCESS_MARKER,
    interfaceId: PRESENTATION_INTERFACE_ID,
    interfaceVersion: PRESENTATION_INTERFACE_VERSION,
    rules: {
      defaultViewMode: 'fit',
      fitEntireFrame: true,
      uniformScale: true,
      clippingAllowed: false,
      mirrored: false,
      contentEvidenceTargetContainsOnlySourceFrame: true,
      intrinsicDecodePixelsUnchanged: true,
      pointerMapping: 'inverse-uniform-fit-to-intrinsic-source-pixels',
    },
    evidenceTargets: structuredClone(PRESENTATION_EVIDENCE_TARGETS),
    viewModes: [...PRESENTATION_VIEW_MODES],
    viewerAssets: presentationViewerDescriptors(assets),
  };
}

export function presentationContractSha256(assets) {
  return sha256(processBytes(makePresentationContractDescriptor(assets)));
}

export function assertPresentationContractSha256(document, expected) {
  if (typeof expected !== 'string' || !SHA_RE.test(expected) || document?.presentationContractSha256 !== expected) fail('presentation_contract_mismatch');
  return true;
}

export function makeSessionTreeDescriptor(fields) {
  assertExactKeys(fields, ['terminalState', 'cycleId', 'mode', 'actorPseudonymSha256', 'presentationContractSha256', 'bundleManifestByteSha256', 'immutableAssetSetSha256', 'fixedInputSetSha256', 'sessionSeedByteSha256', 'sessionFinalStateByteSha256', 'editJournalByteSha256', 'actorAttestationByteSha256', 'accessEvidenceByteSha256'], 'session_tree_fields_not_closed');
  if (fields.terminalState !== 'closed' || typeof fields.cycleId !== 'string' || !fields.cycleId.trim() || fields.cycleId.length > 128 || !['first', 'second', 'source-first-c0', 'adjudication-reveal'].includes(fields.mode)) fail('session_tree_descriptor_invalid');
  assertSha(fields.actorPseudonymSha256, 'session_tree_descriptor_invalid');
  for (const key of ['presentationContractSha256', 'bundleManifestByteSha256', 'immutableAssetSetSha256', 'fixedInputSetSha256', 'sessionSeedByteSha256', 'sessionFinalStateByteSha256', 'editJournalByteSha256', 'actorAttestationByteSha256', 'accessEvidenceByteSha256']) assertSha(fields[key], 'session_tree_descriptor_invalid');
  return { artifactType: 'sam-goal-review-session-tree-descriptor-v1', schemaVersion: 1, ...PROCESS_MARKER, ...structuredClone(fields) };
}

export function validateSessionTreeDescriptor(descriptor) {
  assertExactKeys(descriptor, SESSION_TREE_DESCRIPTOR_FIELDS, 'session_tree_descriptor_not_closed');
  const { artifactType, schemaVersion, authorityClass, compilerInput, p0Authority, ...fields } = descriptor;
  if (artifactType !== 'sam-goal-review-session-tree-descriptor-v1' || schemaVersion !== 1 || authorityClass !== PROCESS_MARKER.authorityClass || compilerInput !== false || p0Authority !== false || !deepEqual(descriptor, makeSessionTreeDescriptor(fields))) fail('session_tree_descriptor_invalid');
  return true;
}

export function sessionTreeSha256(descriptorOrFields) {
  const descriptor = Object.hasOwn(descriptorOrFields ?? {}, 'artifactType') ? structuredClone(descriptorOrFields) : makeSessionTreeDescriptor(descriptorOrFields);
  validateSessionTreeDescriptor(descriptor); return sha256(processBytes(descriptor));
}

export function assertExpectedSessionTreeSha256(expected, descriptorOrFields) {
  assertSha(expected, 'session_tree_hash_mismatch'); const actual = sessionTreeSha256(descriptorOrFields);
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) fail('session_tree_hash_mismatch'); return actual;
}

export function makeSessionSealEnvelope(descriptorOrFields) {
  const descriptor = Object.hasOwn(descriptorOrFields ?? {}, 'artifactType') ? structuredClone(descriptorOrFields) : makeSessionTreeDescriptor(descriptorOrFields); validateSessionTreeDescriptor(descriptor);
  const envelope = { status: 'review_session_sealed', cycleId: descriptor.cycleId, mode: descriptor.mode, actorPseudonymSha256: descriptor.actorPseudonymSha256, presentationContractSha256: descriptor.presentationContractSha256, sessionTreeSha256: sessionTreeSha256(descriptor), bundleManifestByteSha256: descriptor.bundleManifestByteSha256, fixedInputSetSha256: descriptor.fixedInputSetSha256, sessionSeedByteSha256: descriptor.sessionSeedByteSha256, sessionFinalStateByteSha256: descriptor.sessionFinalStateByteSha256, editJournalByteSha256: descriptor.editJournalByteSha256, actorAttestationByteSha256: descriptor.actorAttestationByteSha256, accessEvidenceByteSha256: descriptor.accessEvidenceByteSha256 };
  assertExactKeys(envelope, SESSION_SEAL_ENVELOPE_FIELDS, 'session_seal_envelope_not_closed'); return envelope;
}

export function assertExactKeys(value, keys, code = 'object_not_closed') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort(rawUtf8Compare);
  const expected = [...keys].sort(rawUtf8Compare);
  if (canonicalStringify(actual) !== canonicalStringify(expected)) fail(code, `${code}: ${actual.join(',')}`);
}

export function assertSha(value, code = 'sha256_invalid') {
  if (typeof value !== 'string' || !SHA_RE.test(value)) fail(code);
}

export function assertProcessMarker(value) {
  if (value.authorityClass !== PROCESS_MARKER.authorityClass || value.compilerInput !== false || value.p0Authority !== false) fail('process_authority_confusion');
  for (const field of ['expectedCanonicalHash', 'candidateP0PackCanonicalSha256', 'p0Anchor', 'p0Verified', 'packDescriptor', 'parentAnchor']) {
    if (Object.hasOwn(value, field)) fail('process_authority_field_forbidden', field);
  }
}

function publicPath(key) { return path.join(REPO_ROOT, PUBLIC_PATHS[key]); }

export async function verifyPublicPins() {
  const [evaluationBytes, labelBytes, authoringBytes, inventoryBytes, decoderBytes, compilerBytes] = await Promise.all([
    fsp.readFile(publicPath('evaluationContract')),
    fsp.readFile(publicPath('labelSchema')),
    fsp.readFile(publicPath('authoringSchema')),
    fsp.readFile(publicPath('sourceInventory')),
    fsp.readFile(publicPath('decoderManifest')),
    fsp.readFile(publicPath('manualPackCompiler')),
  ]);
  const evaluationContract = parseJsonBuffer(evaluationBytes);
  const labelSchema = parseJsonBuffer(labelBytes);
  const authoringSchema = parseJsonBuffer(authoringBytes);
  const sourceInventory = parseJsonBuffer(inventoryBytes);
  if (!decoderBytes.toString('utf8').endsWith('\n')) fail('public_byte_pin_mismatch');
  const lines = decoderBytes.toString('utf8').slice(0, -1).split('\n');
  const decoderRows = lines.map((line) => parseJsonBuffer(Buffer.from(line)));
  const actual = {
    evaluationContractCanonicalSha256: canonicalHash(evaluationContract, { excludeRootExpectedHash: true }),
    labelSchemaCanonicalSha256: canonicalHash(labelSchema),
    authoringSchemaCanonicalSha256: canonicalHash(authoringSchema),
    sourceInventoryCanonicalSha256: canonicalHash(sourceInventory, { excludeRootExpectedHash: true }),
    decoderByteSha256: sha256(decoderBytes),
    decoderCanonicalRowsSha256: canonicalHash(decoderRows),
    manualPackCompilerByteSha256: sha256(compilerBytes),
  };
  if (canonicalStringify(actual) !== canonicalStringify(PUBLIC_PINS)) fail('public_byte_pin_mismatch', 'accepted public bytes drifted', { expected: PUBLIC_PINS, actual });
  if (decoderRows.length !== 6711) fail('public_byte_pin_mismatch');
  return Object.freeze({
    evaluationContract, labelSchema, authoringSchema, sourceInventory, decoderRows,
    publicPins: PUBLIC_PINS,
    publicByteHashes: Object.freeze({
      evaluationContract: sha256(evaluationBytes), labelSchema: sha256(labelBytes),
      authoringSchema: sha256(authoringBytes), sourceInventory: sha256(inventoryBytes),
      decoderManifest: sha256(decoderBytes), manualPackCompiler: sha256(compilerBytes),
    }),
  });
}

export function processSourceBinding(publicState) {
  const paired = publicState.sourceInventory.paired.map(({ clipId, video }) => ({ clipId, path: video.path, bytes: video.bytes, sha256: video.sha256 }));
  return {
    evaluationContractCanonicalSha256: PUBLIC_PINS.evaluationContractCanonicalSha256,
    labelSchemaCanonicalSha256: PUBLIC_PINS.labelSchemaCanonicalSha256,
    authoringSchemaCanonicalSha256: PUBLIC_PINS.authoringSchemaCanonicalSha256,
    sourceInventoryCanonicalSha256: PUBLIC_PINS.sourceInventoryCanonicalSha256,
    decoderByteSha256: PUBLIC_PINS.decoderByteSha256,
    decoderCanonicalRowsSha256: PUBLIC_PINS.decoderCanonicalRowsSha256,
    decoderRowCount: 6711,
    sources: paired,
  };
}

export function formalSourceBinding(publicState) {
  const { evaluationContract: contract, sourceInventory } = publicState;
  const paired = sourceInventory.paired.map(({ clipId, video }) => ({ clipId, path: video.path, bytes: video.bytes, sha256: video.sha256 }));
  return {
    evaluationContractCanonicalSha256: PUBLIC_PINS.evaluationContractCanonicalSha256,
    labelSchemaCanonicalSha256: PUBLIC_PINS.labelSchemaCanonicalSha256,
    authoringSchemaCanonicalSha256: PUBLIC_PINS.authoringSchemaCanonicalSha256,
    teacherInputInventoryCanonicalSha256: contract.teacherBindings.teacherInputInventory.canonicalSha256,
    teacherPolicyCanonicalSha256: contract.teacherBindings.teacherPolicy.canonicalSha256,
    teacherSchemaCanonicalSha256: contract.teacherBindings.teacherSchema.canonicalSha256,
    p0AnchorSchemaCanonicalSha256: contract.teacherBindings.p0AnchorSchema.canonicalSha256,
    p1AnchorSchemaCanonicalSha256: contract.teacherBindings.p1AnchorSchema.canonicalSha256,
    sourceContractCanonicalSha256: contract.sourceBinding.sourceContract.canonicalSha256,
    sourceSchemaCanonicalSha256: contract.sourceBinding.sourceSchema.canonicalSha256,
    sourceInventoryCanonicalSha256: PUBLIC_PINS.sourceInventoryCanonicalSha256,
    decoderByteSha256: PUBLIC_PINS.decoderByteSha256,
    decoderCanonicalRowsSha256: PUBLIC_PINS.decoderCanonicalRowsSha256,
    decoderRowCount: 6711,
    sources: paired,
  };
}

export function exactIdentity(row) {
  return { clipId: row.clipId, sourceFrameIndex: row.sourceFrameIndex, ptsTicks: row.ptsTicks, timeBase: row.timeBase, loopEpoch: row.loopEpoch };
}

function cloneUnset() { return { status: 'UNSET' }; }
function unsetManualState() {
  return {
    presence: cloneUnset(), personState: cloneUnset(),
    occlusion: Object.fromEntries(OCCLUSION_FIELDS.map((key) => [key, cloneUnset()])),
    contact: Object.fromEntries(HAND_FIELDS.map((key) => [key, cloneUnset()])),
    handObservability: Object.fromEntries(HAND_FIELDS.map((key) => [key, cloneUnset()])),
    endpointObservability: Object.fromEntries(ENDPOINT_FIELDS.map((key) => [key, cloneUnset()])),
    subjectSelection: { state: cloneUnset(), manualTargetId: cloneUnset(), anchor: cloneUnset() },
  };
}

export function createWorksheet({ publicState, mode, actorPseudonymSha256, cycleId, bundleManifestByteSha256 = '0'.repeat(64), rulebookByteSha256 }) {
  if (!['first', 'second', 'source-first-c0'].includes(mode)) fail('mode_invalid');
  assertSha(actorPseudonymSha256, 'actor_pseudonym_invalid');
  if (typeof cycleId !== 'string' || !cycleId.trim() || cycleId.length > 128) fail('cycle_id_invalid');
  const windows = publicState.sourceInventory.paired.map((source) => ({
    windowId: `base-${source.clipId}`, clipId: source.clipId,
    startFrameIndex: 0, endFrameIndexExclusive: source.decoderRowCount,
    origin: 'structural_base', purposeTags: ['full_clip_denominator'], scenarioTags: cloneUnset(),
  }));
  return {
    artifactType: 'sam-goal-review-worksheet-v1', schemaVersion: 1, ...PROCESS_MARKER,
    cycleId, mode, actorPseudonymSha256, bundleManifestByteSha256,
    sourceBinding: processSourceBinding(publicState), rulebookByteSha256,
    windows,
    rows: publicState.decoderRows.map((row) => ({ ...exactIdentity(row), scenarios: cloneUnset(), manualState: unsetManualState() })),
  };
}

export function deepEqual(a, b) { return canonicalStringify(a) === canonicalStringify(b); }
export function containsUnset(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && value.status === 'UNSET') return true;
  if (Array.isArray(value)) return value.some(containsUnset);
  return Boolean(value && typeof value === 'object' && Object.values(value).some(containsUnset));
}

function assertSortedEnumArray(value, accepted, code) {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some((x) => !accepted.includes(x))) fail(code);
  const sorted = [...value].sort(rawUtf8Compare);
  if (!deepEqual(value, sorted)) fail(code);
}

export function assertManualState(state) {
  assertExactKeys(state, ['presence', 'personState', 'occlusion', 'contact', 'handObservability', 'endpointObservability', 'subjectSelection'], 'manual_state_not_closed');
  if (!['present', 'absent', 'unknown'].includes(state.presence)) fail('presence_invalid');
  if (!['single_target', 'multiple_people', 'absent', 'unknown'].includes(state.personState)) fail('person_state_invalid');
  assertExactKeys(state.occlusion, OCCLUSION_FIELDS, 'occlusion_not_closed');
  for (const value of Object.values(state.occlusion)) if (!['observable', 'partial', 'occluded', 'out_of_frame', 'unknown'].includes(value)) fail('occlusion_invalid');
  assertExactKeys(state.contact, HAND_FIELDS, 'contact_not_closed');
  for (const value of Object.values(state.contact)) if (!['planted', 'moving', 'unknown'].includes(value)) fail('contact_invalid');
  assertExactKeys(state.handObservability, HAND_FIELDS, 'hand_observability_not_closed');
  assertExactKeys(state.endpointObservability, ENDPOINT_FIELDS, 'endpoint_observability_not_closed');
  for (const value of [...Object.values(state.handObservability), ...Object.values(state.endpointObservability)]) if (!['observable', 'not_observable'].includes(value)) fail('observability_invalid');
  assertExactKeys(state.subjectSelection, ['state', 'manualTargetId', 'anchor'], 'subject_selection_not_closed');
  const subject = state.subjectSelection;
  if (!['selected', 'absent', 'ambiguous', 'unknown'].includes(subject.state)) fail('subject_state_invalid');
  if (subject.state === 'selected') {
    if (typeof subject.manualTargetId !== 'string' || subject.manualTargetId.length === 0) fail('manual_target_id_required');
    if (subject.anchor !== null) {
      assertExactKeys(subject.anchor, ['x', 'y'], 'anchor_not_closed');
      if (![subject.anchor.x, subject.anchor.y].every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)) fail('anchor_invalid');
    }
  } else if (subject.manualTargetId !== null || subject.anchor !== null) fail('subject_null_fields_required');
  if (state.presence === 'absent') {
    if (subject.state !== 'absent' || state.personState !== 'absent' || state.contact.left !== 'unknown' || state.contact.right !== 'unknown') fail('absent_truth_rule');
    if (Object.values(state.handObservability).some((x) => x !== 'not_observable') || Object.values(state.endpointObservability).some((x) => x !== 'not_observable')) fail('absent_truth_rule');
    if (Object.values(state.occlusion).some((x) => !['out_of_frame', 'unknown'].includes(x))) fail('absent_truth_rule');
  }
  for (const side of HAND_FIELDS) {
    if (state.contact[side] !== 'unknown' && (state.presence !== 'present' || state.occlusion[`${side}Foot`] !== 'observable' || state.endpointObservability[`${side}Ankle`] !== 'observable')) fail('contact_truth_rule');
    if (state.handObservability[side] === 'observable' && (!['observable', 'partial'].includes(state.occlusion[`${side}Hand`]) || state.endpointObservability[`${side}Wrist`] !== 'observable')) fail('hand_truth_rule');
  }
  const endpointPart = { leftWrist: 'leftHand', rightWrist: 'rightHand', leftAnkle: 'leftFoot', rightAnkle: 'rightFoot', head: 'body' };
  for (const endpoint of ENDPOINT_FIELDS) if (state.endpointObservability[endpoint] === 'observable' && ['occluded', 'out_of_frame', 'unknown'].includes(state.occlusion[endpointPart[endpoint]])) fail('endpoint_truth_rule');
  if (state.personState === 'single_target' && subject.state !== 'selected') fail('single_target_truth_rule');
  if (state.personState === 'multiple_people' && !(subject.state === 'ambiguous' || (subject.state === 'selected' && subject.anchor !== null))) fail('multiple_people_truth_rule');
}

export function validateWorksheet(worksheet, publicState, { requireComplete = false, expectedMode } = {}) {
  assertProcessMarker(worksheet);
  if (worksheet.artifactType !== 'sam-goal-review-worksheet-v1' || worksheet.schemaVersion !== 1) fail('worksheet_type_invalid');
  if (expectedMode && worksheet.mode !== expectedMode) fail('worksheet_mode_mismatch');
  if (!['first', 'second', 'source-first-c0'].includes(worksheet.mode)) fail('worksheet_mode_invalid');
  assertSha(worksheet.actorPseudonymSha256); assertSha(worksheet.bundleManifestByteSha256); assertSha(worksheet.rulebookByteSha256);
  if (!deepEqual(worksheet.sourceBinding, processSourceBinding(publicState))) fail('source_binding_mismatch');
  if (!Array.isArray(worksheet.rows) || worksheet.rows.length !== 6711) fail('worksheet_row_count');
  const targetsByClip = new Map();
  for (let index = 0; index < 6711; index += 1) {
    const row = worksheet.rows[index]; const expected = publicState.decoderRows[index];
    if (!deepEqual(exactIdentity(row), exactIdentity(expected))) fail('worksheet_identity_mismatch', `row ${index}`);
    assertExactKeys(row, ['clipId', 'sourceFrameIndex', 'ptsTicks', 'timeBase', 'loopEpoch', 'scenarios', 'manualState'], 'worksheet_row_not_closed');
    if (requireComplete) {
      if (containsUnset(row)) fail('worksheet_unset');
      assertSortedEnumArray(row.scenarios, SCENARIOS, 'scenario_array_invalid');
      assertManualState(row.manualState);
      if (row.manualState.subjectSelection.state === 'selected') {
        if (!targetsByClip.has(row.clipId)) targetsByClip.set(row.clipId, new Set());
        targetsByClip.get(row.clipId).add(row.manualState.subjectSelection.manualTargetId);
      }
    }
  }
  if (requireComplete) for (const [clipId, targets] of targetsByClip) if (targets.size > 1) fail('manual_target_unstable', clipId);
  if (!Array.isArray(worksheet.windows)) fail('windows_invalid');
  const ids = new Set(); const baseByClip = new Map();
  for (const window of worksheet.windows) {
    assertExactKeys(window, ['windowId', 'clipId', 'startFrameIndex', 'endFrameIndexExclusive', 'origin', 'purposeTags', 'scenarioTags'], 'worksheet_window_not_closed');
    const identityKey = `${window.clipId}\0${window.windowId}`;
    if (!WINDOW_ID_RE.test(window.windowId) || ids.has(identityKey)) fail('window_id_invalid'); ids.add(identityKey);
    const source = publicState.sourceInventory.paired.find((x) => x.clipId === window.clipId);
    if (!source || !Number.isInteger(window.startFrameIndex) || !Number.isInteger(window.endFrameIndexExclusive) || window.startFrameIndex < 0 || window.startFrameIndex >= window.endFrameIndexExclusive || window.endFrameIndexExclusive > source.decoderRowCount) fail('window_boundary_invalid');
    if (window.origin === 'structural_base') {
      if (window.windowId !== `base-${window.clipId}` || baseByClip.has(window.clipId) || window.startFrameIndex !== 0 || window.endFrameIndexExclusive !== source.decoderRowCount || !deepEqual(window.purposeTags, ['full_clip_denominator'])) fail('base_window_invalid');
      baseByClip.set(window.clipId, window);
    } else if (window.origin === 'actor_overlay') {
      if (requireComplete) assertSortedEnumArray(window.purposeTags, PURPOSES.filter((x) => x !== 'full_clip_denominator'), 'overlay_purpose_invalid');
      else if (!deepEqual(window.purposeTags, UNSET) && containsUnset(window.purposeTags)) fail('overlay_purpose_invalid');
    } else fail('window_origin_invalid');
    if (requireComplete) assertSortedEnumArray(window.scenarioTags, SCENARIOS, 'window_scenarios_invalid');
  }
  if (baseByClip.size !== 7) fail('base_window_count');
  if (requireComplete && containsUnset(worksheet.windows)) fail('window_unset');
  if (requireComplete) assertContactConfirmation(worksheet.rows);
  return true;
}

const BLIND_JOURNAL_FIELD_TYPES = Object.freeze(new Map([
  ['scenarios', 'scenario-array'], ['presence', 'presence'], ['personState', 'person-state'],
  ['occlusion/body', 'occlusion-state'], ['occlusion/leftFoot', 'occlusion-state'], ['occlusion/rightFoot', 'occlusion-state'], ['occlusion/leftHand', 'occlusion-state'], ['occlusion/rightHand', 'occlusion-state'],
  ['contact/left', 'contact-state'], ['contact/right', 'contact-state'], ['handObservability/left', 'hand-observability-state'], ['handObservability/right', 'hand-observability-state'],
  ['endpointObservability/leftWrist', 'endpoint-observability-state'], ['endpointObservability/rightWrist', 'endpoint-observability-state'], ['endpointObservability/leftAnkle', 'endpoint-observability-state'], ['endpointObservability/rightAnkle', 'endpoint-observability-state'], ['endpointObservability/head', 'endpoint-observability-state'],
  ['subjectSelection/state', 'subject-state'], ['subjectSelection/manualTargetId', 'manual-target-id'], ['subjectSelection/anchor', 'anchor'],
]));

function assertBlindJournalTarget(worksheet, event, publicState) {
  if (event.actorPseudonymSha256 !== worksheet.actorPseudonymSha256) fail('journal_actor_mismatch');
  const source = publicState.sourceInventory.paired.find((item) => item.clipId === event.clipId);
  if (!source || !Number.isSafeInteger(event.startFrameIndex) || !Number.isSafeInteger(event.endFrameIndexExclusive) || event.startFrameIndex < 0 || event.startFrameIndex >= event.endFrameIndexExclusive || event.endFrameIndexExclusive > source.decoderRowCount) fail('journal_range_invalid');
  const row = worksheet.rows.find((item) => item.clipId === event.clipId && item.sourceFrameIndex === event.lockedIdentity?.sourceFrameIndex);
  if (!row || !deepEqual(exactIdentity(row), event.lockedIdentity) || row.sourceFrameIndex < event.startFrameIndex || row.sourceFrameIndex >= event.endFrameIndexExclusive) fail('journal_locked_identity_invalid');
}

function applyBlindJournalEvent(worksheet, event, publicState) {
  if (['navigate', 'playback'].includes(event.action)) {
    assertExactKeys(event, ['sequence', 'action', 'clipId', 'sourceFrameIndex'], 'journal_event_not_closed');
    if (!worksheet.rows.some((row) => row.clipId === event.clipId && row.sourceFrameIndex === event.sourceFrameIndex)) fail('journal_navigation_identity_invalid');
    return;
  }
  const keys = event.action === 'create-overlay'
    ? ['sequence', 'action', 'actorPseudonymSha256', 'clipId', 'startFrameIndex', 'endFrameIndexExclusive', 'windowId', 'lockedIdentity']
    : ['sequence', 'action', 'actorPseudonymSha256', 'clipId', 'startFrameIndex', 'endFrameIndexExclusive', 'fieldPath', 'valueType', 'value', 'lockedIdentity'];
  assertExactKeys(event, keys, 'journal_event_not_closed'); assertBlindJournalTarget(worksheet, event, publicState);
  if (event.action === 'create-overlay') {
    if (!WINDOW_ID_RE.test(event.windowId) || event.windowId === `base-${event.clipId}` || worksheet.windows.some((window) => window.clipId === event.clipId && window.windowId === event.windowId)) fail('journal_overlay_identity_invalid');
    worksheet.windows.push({ windowId: event.windowId, clipId: event.clipId, startFrameIndex: event.startFrameIndex, endFrameIndexExclusive: event.endFrameIndexExclusive, origin: 'actor_overlay', purposeTags: structuredClone(UNSET), scenarioTags: structuredClone(UNSET) }); return;
  }
  if (!['set', 'undo'].includes(event.action)) fail('journal_action_invalid');
  if (event.fieldPath.startsWith('/windowsById/')) {
    const match = /^\/windowsById\/([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/(purposeTags|scenarioTags)$/u.exec(event.fieldPath); if (!match) fail('journal_window_mutation_forbidden');
    const [, windowId, child] = match; const window = worksheet.windows.find((item) => item.clipId === event.clipId && item.windowId === windowId);
    if (!window || window.startFrameIndex !== event.startFrameIndex || window.endFrameIndexExclusive !== event.endFrameIndexExclusive || window.origin === 'structural_base' && child !== 'scenarioTags' || window.origin === 'actor_overlay' && child === 'purposeTags' && event.value?.includes?.('full_clip_denominator')) fail('journal_window_target_mismatch');
    if (event.valueType !== (child === 'purposeTags' ? 'purpose-array' : 'scenario-array')) fail('journal_value_type_mismatch'); window[child] = structuredClone(event.value); return;
  }
  if (BLIND_JOURNAL_FIELD_TYPES.get(event.fieldPath) !== event.valueType) fail('journal_value_type_mismatch'); let count = 0;
  for (const row of worksheet.rows) if (row.clipId === event.clipId && row.sourceFrameIndex >= event.startFrameIndex && row.sourceFrameIndex < event.endFrameIndexExclusive) {
    if (event.fieldPath === 'scenarios') row.scenarios = structuredClone(event.value);
    else { const parts = event.fieldPath.split('/'); let target = row.manualState; for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]]; target[parts.at(-1)] = structuredClone(event.value); }
    count += 1;
  }
  if (!count) fail('journal_range_empty');
}

export function replayWorksheetJournal(seed, journal, publicState, { requireComplete = false } = {}) {
  if (!seed || !journal || seed.artifactType !== 'sam-goal-review-worksheet-v1' || journal.artifactType !== 'sam-goal-review-edit-journal-v1' || seed.schemaVersion !== 1 || journal.schemaVersion !== 1 || !['first', 'second', 'source-first-c0'].includes(seed.mode) || journal.mode !== seed.mode || seed.cycleId !== journal.cycleId || seed.actorPseudonymSha256 !== journal.actorPseudonymSha256 || seed.bundleManifestByteSha256 !== journal.bundleManifestByteSha256 || !Array.isArray(journal.events)) fail('journal_seed_binding_invalid');
  validateWorksheet(seed, publicState, { expectedMode: seed.mode }); const worksheet = structuredClone(seed);
  for (const [index, event] of journal.events.entries()) { if (event.sequence !== index + 1) fail('journal_sequence_invalid'); applyBlindJournalEvent(worksheet, event, publicState); }
  validateWorksheet(worksheet, publicState, { expectedMode: seed.mode, requireComplete }); return worksheet;
}

export function assertContactConfirmation(rows) {
  for (const clipId of [...new Set(rows.map((row) => row.clipId))]) for (const side of HAND_FIELDS) {
    const clipRows = rows.filter((row) => row.clipId === clipId); let start = null; let last = null;
    const closeRun = () => {
      if (!start) return;
      const confirmed = (BigInt(last.ptsTicks) - BigInt(start.ptsTicks)) * BigInt(start.timeBase.numerator) * 1000n >= 100n * BigInt(start.timeBase.denominator);
      if (!confirmed) fail('contact_confirmation_short', `${clipId}:${side}:${start.sourceFrameIndex}`);
      start = null; last = null;
    };
    for (const row of clipRows) {
      const observable = ['observable', 'partial'].includes(row.manualState.occlusion[`${side}Foot`]);
      if (row.manualState.contact[side] === 'planted' && observable) { if (!start) start = row; last = row; }
      else closeRun();
    }
    closeRun();
  }
}

export function normalizeWindows(worksheet) {
  return worksheet.windows.map(({ origin: _origin, ...window }) => structuredClone(window)).sort((a, b) => {
    for (const key of ['clipId', 'startFrameIndex', 'endFrameIndexExclusive', 'windowId']) {
      const result = typeof a[key] === 'string' ? rawUtf8Compare(a[key], b[key]) : a[key] - b[key]; if (result) return result;
    }
    return 0;
  });
}

function memberships(windows, clipId, frame) {
  return windows.filter((window) => window.clipId === clipId && frame >= window.startFrameIndex && frame < window.endFrameIndexExclusive).map((window) => window.windowId).sort(rawUtf8Compare);
}

export function worksheetToReview(worksheet, publicState) {
  validateWorksheet(worksheet, publicState, { requireComplete: true, expectedMode: worksheet.mode });
  if (!['first', 'second'].includes(worksheet.mode)) fail('c0_formal_export_forbidden');
  const windows = normalizeWindows(worksheet); const clips = [];
  for (const source of publicState.sourceInventory.paired) {
    const rows = worksheet.rows.filter((row) => row.clipId === source.clipId); const intervals = [];
    for (const row of rows) {
      const candidate = { startFrameIndex: row.sourceFrameIndex, endFrameIndexExclusive: row.sourceFrameIndex + 1, scenarios: row.scenarios, state: row.manualState };
      const memberSet = memberships(windows, row.clipId, row.sourceFrameIndex);
      const previous = intervals.at(-1);
      if (previous && previous.endFrameIndexExclusive === row.sourceFrameIndex && deepEqual(previous.scenarios, candidate.scenarios) && deepEqual(previous.state, candidate.state) && deepEqual(previous.__memberships, memberSet)) previous.endFrameIndexExclusive += 1;
      else intervals.push({ ...candidate, __memberships: memberSet });
    }
    clips.push({ clipId: source.clipId, intervals: intervals.map(({ __memberships: _memberships, ...interval }) => interval) });
  }
  const review = {
    artifactType: 'sam-goal-manual-review-v3', schemaVersion: 3, role: worksheet.mode,
    reviewerPseudonymSha256: worksheet.actorPseudonymSha256, origin: 'manual_video', reviewed: true,
    sourceBinding: formalSourceBinding(publicState), windows, clips,
  };
  review.expectedCanonicalHash = canonicalHash(review);
  return review;
}

export function materializeReview(review, publicState, { expectedRole, expectedPseudonym } = {}) {
  assertExactKeys(review, ['artifactType', 'schemaVersion', 'role', 'reviewerPseudonymSha256', 'origin', 'reviewed', 'sourceBinding', 'windows', 'clips', 'expectedCanonicalHash'], 'formal_review_not_closed');
  if (review.artifactType !== 'sam-goal-manual-review-v3' || review.schemaVersion !== 3 || review.origin !== 'manual_video' || review.reviewed !== true) fail('formal_review_type_invalid');
  if (!['first', 'second'].includes(review.role) || (expectedRole && review.role !== expectedRole)) fail('formal_review_role_invalid');
  assertSha(review.reviewerPseudonymSha256); if (expectedPseudonym && review.reviewerPseudonymSha256 !== expectedPseudonym) fail('reviewer_pseudonym_mismatch');
  if (!deepEqual(review.sourceBinding, formalSourceBinding(publicState))) fail('source_binding_mismatch');
  if (canonicalHash(review, { excludeRootExpectedHash: true }) !== review.expectedCanonicalHash) fail('formal_review_canonical_hash');
  const synthetic = {
    artifactType: 'sam-goal-review-worksheet-v1', schemaVersion: 1, ...PROCESS_MARKER,
    cycleId: 'formal-materialization', mode: review.role, actorPseudonymSha256: review.reviewerPseudonymSha256,
    bundleManifestByteSha256: '0'.repeat(64), sourceBinding: processSourceBinding(publicState), rulebookByteSha256: '0'.repeat(64),
    windows: review.windows.map((window) => ({ ...window, origin: window.purposeTags.includes('full_clip_denominator') ? 'structural_base' : 'actor_overlay' })), rows: [],
  };
  const clipMap = new Map(review.clips.map((clip) => [clip.clipId, clip]));
  for (const expected of publicState.decoderRows) {
    const clip = clipMap.get(expected.clipId); if (!clip) fail('formal_review_clip_missing');
    const containing = clip.intervals.filter((interval) => expected.sourceFrameIndex >= interval.startFrameIndex && expected.sourceFrameIndex < interval.endFrameIndexExclusive);
    if (containing.length !== 1) fail('formal_review_interval_coverage');
    const interval = containing[0]; synthetic.rows.push({ ...exactIdentity(expected), scenarios: interval.scenarios, manualState: interval.state });
  }
  validateWorksheet(synthetic, publicState, { requireComplete: true, expectedMode: review.role });
  const roundTrip = worksheetToReview(synthetic, publicState);
  if (!deepEqual(roundTrip, review)) fail('formal_review_noncanonical_intervals');
  return synthetic.rows;
}

export function formalBytes(document) { return processBytes(document); }

export function getLeaf(row, leafPath) {
  if (leafPath === 'scenarios') return row.scenarios;
  return leafPath.split('/').reduce((value, key) => value[key], row.manualState);
}

export function reviewEvidenceFromRows(rows, publicState) {
  if (!Array.isArray(rows) || rows.length !== 6711) fail('final_row_count_invalid'); const targetsByClip = new Map();
  for (let index = 0; index < rows.length; index += 1) { const row = rows[index]; if (!deepEqual(exactIdentity(row), exactIdentity(publicState.decoderRows[index]))) fail('final_row_identity_invalid'); assertSortedEnumArray(row.scenarios, SCENARIOS, 'scenario_array_invalid'); assertManualState(row.manualState); if (row.manualState.subjectSelection.state === 'selected') { if (!targetsByClip.has(row.clipId)) targetsByClip.set(row.clipId, new Set()); targetsByClip.get(row.clipId).add(row.manualState.subjectSelection.manualTargetId); } }
  for (const [clipId, targets] of targetsByClip) if (targets.size > 1) fail('manual_target_unstable', clipId); assertContactConfirmation(rows);
  const support = { contact: {}, head: {}, hand: {}, reacquireEvents: [], hardTestReacquireClips: [] };
  const clipRole = new Map(publicState.evaluationContract.clipInventory.map((x) => [x.clipId, x.role]));
  for (const side of HAND_FIELDS) for (const klass of ['planted', 'moving']) {
    const matching = rows.filter((row) => {
      const state = row.manualState;
      return state.contact[side] === klass && state.presence === 'present' && ['observable', 'partial'].includes(state.occlusion.body)
        && state.occlusion[`${side}Foot`] === 'observable' && state.endpointObservability[`${side}Ankle`] === 'observable';
    });
    support.contact[`${side}:${klass}`] = { frames: matching.length, clips: [...new Set(matching.map((row) => row.clipId))].sort(rawUtf8Compare) };
  }
  for (const field of ['head', 'leftHand', 'rightHand']) {
    const matching = rows.filter((row) => {
      const state = row.manualState;
      if (state.presence !== 'present' || !['observable', 'partial'].includes(state.occlusion.body)) return false;
      if (field === 'head') return state.endpointObservability.head === 'observable';
      const side = field.startsWith('left') ? 'left' : 'right';
      return ['observable', 'partial'].includes(state.occlusion[`${side}Hand`]) && state.handObservability[side] === 'observable' && state.endpointObservability[`${side}Wrist`] === 'observable';
    });
    support[field === 'head' ? 'head' : 'hand'][field] = { frames: matching.length, clips: [...new Set(matching.map((row) => row.clipId))].sort(rawUtf8Compare) };
  }
  for (const source of publicState.sourceInventory.paired) {
    if (clipRole.get(source.clipId) !== 'hard_test') continue;
    const clipRows = rows.filter((row) => row.clipId === source.clipId); let index = 0;
    const unreliable = (row) => row.manualState.presence === 'absent' || row.manualState.presence === 'unknown' || ['ambiguous', 'unknown'].includes(row.manualState.subjectSelection.state) || ['occluded', 'out_of_frame', 'unknown'].includes(row.manualState.occlusion.body);
    const reliable = (row) => row.manualState.presence === 'present' && row.manualState.subjectSelection.state === 'selected' && ['observable', 'partial'].includes(row.manualState.occlusion.body);
    while (index < clipRows.length) {
      if (!unreliable(clipRows[index])) { index += 1; continue; }
      const start = index; while (index < clipRows.length && unreliable(clipRows[index])) index += 1;
      if (index >= clipRows.length) break;
      const end = index; let reliableIndex = index; while (reliableIndex < clipRows.length && !reliable(clipRows[reliableIndex])) reliableIndex += 1;
      if (reliableIndex >= clipRows.length) break;
      const first = clipRows[start]; const boundary = clipRows[end];
      const durationPass = (BigInt(boundary.ptsTicks) - BigInt(first.ptsTicks)) * BigInt(first.timeBase.numerator) * 1000n >= 200n * BigInt(first.timeBase.denominator);
      if (durationPass) support.reacquireEvents.push({ clipId: source.clipId, startFrameIndex: first.sourceFrameIndex, endFrameIndexExclusive: boundary.sourceFrameIndex, reacquiredFrameIndex: clipRows[reliableIndex].sourceFrameIndex });
    }
  }
  support.hardTestReacquireClips = [...new Set(support.reacquireEvents.filter((x) => clipRole.get(x.clipId) === 'hard_test').map((x) => x.clipId))].sort(rawUtf8Compare);
  const contactPass = Object.values(support.contact).every((x) => x.frames >= 300 && x.clips.length >= 2);
  const observabilityPass = support.head.head.frames >= 300 && support.head.head.clips.length >= 2 && ['leftHand', 'rightHand'].every((key) => support.hand[key].frames >= 300 && support.hand[key].clips.length >= 2);
  const reacquirePass = support.reacquireEvents.length >= 3 && support.hardTestReacquireClips.length >= 2;
  return { rowCount: rows.length, support, contactPass, observabilityPass, reacquirePass, gatePass: contactPass && observabilityPass && reacquirePass };
}

export function reviewEvidence(review, publicState) {
  return reviewEvidenceFromRows(materializeReview(review, publicState, { expectedRole: review.role, expectedPseudonym: review.reviewerPseudonymSha256 }), publicState);
}

export function cohenKappa(aValues, bValues) {
  if (aValues.length !== bValues.length || !aValues.length) fail('kappa_input_invalid');
  let agreed = 0; const aCounts = new Map(); const bCounts = new Map();
  for (let i = 0; i < aValues.length; i += 1) {
    const a = canonicalStringify(aValues[i]); const b = canonicalStringify(bValues[i]); if (a === b) agreed += 1;
    aCounts.set(a, (aCounts.get(a) ?? 0) + 1); bCounts.set(b, (bCounts.get(b) ?? 0) + 1);
  }
  const po = agreed / aValues.length; const categories = new Set([...aCounts.keys(), ...bCounts.keys()]);
  let pe = 0; for (const category of categories) pe += ((aCounts.get(category) ?? 0) / aValues.length) * ((bCounts.get(category) ?? 0) / bValues.length);
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { count: aValues.length, observedAgreement: po, expectedAgreement: pe, kappa };
}

export function rawAgreement(reviewA, reviewB, publicState) {
  const aRows = materializeReview(reviewA, publicState, { expectedRole: 'first' });
  const bRows = materializeReview(reviewB, publicState, { expectedRole: 'second' });
  const cells = { presencePersonState: [], contact: [], observability: [] };
  for (const source of publicState.sourceInventory.paired) {
    const indexes = aRows.map((row, i) => row.clipId === source.clipId ? i : -1).filter((i) => i >= 0);
    cells.presencePersonState.push({ clipId: source.clipId, ...cohenKappa(indexes.map((i) => [aRows[i].manualState.presence, aRows[i].manualState.personState]), indexes.map((i) => [bRows[i].manualState.presence, bRows[i].manualState.personState])) });
    for (const side of HAND_FIELDS) cells.contact.push({ clipId: source.clipId, field: side, ...cohenKappa(indexes.map((i) => aRows[i].manualState.contact[side]), indexes.map((i) => bRows[i].manualState.contact[side])) });
    for (const [group, fields] of [['occlusion', OCCLUSION_FIELDS], ['handObservability', HAND_FIELDS], ['endpointObservability', ENDPOINT_FIELDS]]) {
      for (const field of fields) cells.observability.push({ clipId: source.clipId, field: `${group}.${field}`, ...cohenKappa(indexes.map((i) => aRows[i].manualState[group][field]), indexes.map((i) => bRows[i].manualState[group][field])) });
    }
  }
  const average = (values) => values.reduce((sum, value) => sum + value.kappa, 0) / values.length;
  const macros = { presencePersonStateKappa: average(cells.presencePersonState), contactKappa: average(cells.contact), observabilityKappa: average(cells.observability) };
  const thresholds = { presencePersonStateKappa: 0.99, contactKappa: 0.9, observabilityKappa: 0.95 };
  const gatePass = Object.keys(thresholds).every((key) => macros[key] >= thresholds[key]);
  return { aRows, bRows, cells, macros, thresholds, gatePass };
}

export function rawAgreementCellRegistry(publicState) {
  const registry = [];
  for (const source of publicState.sourceInventory.paired) registry.push({ family: 'presencePersonState', clipId: source.clipId, field: null });
  for (const source of publicState.sourceInventory.paired) for (const side of HAND_FIELDS) registry.push({ family: 'contact', clipId: source.clipId, field: side });
  for (const source of publicState.sourceInventory.paired) {
    for (const [group, fields] of [['occlusion', OCCLUSION_FIELDS], ['handObservability', HAND_FIELDS], ['endpointObservability', ENDPOINT_FIELDS]]) {
      for (const field of fields) registry.push({ family: 'observability', clipId: source.clipId, field: `${group}.${field}` });
    }
  }
  if (registry.length !== 105 || new Set(registry.map((cell) => canonicalStringify(cell))).size !== registry.length) fail('raw_ab_report_invalid');
  return registry;
}

function assertRawReportSemantics(document, publicState) {
  const roles = ['first', 'second'];
  if (!Array.isArray(document.individualGateEvidence) || !Array.isArray(document.supportReacquireEvidence) || !deepEqual(document.individualGateEvidence.map((item) => item.role), roles) || !deepEqual(document.supportReacquireEvidence.map((item) => item.role), roles)) fail('raw_ab_report_invalid');
  if (document.individualGateEvidence[0].validatorStdoutByteSha256 !== document.reviewAComparisonValidatorStdoutByteSha256 || document.individualGateEvidence[1].validatorStdoutByteSha256 !== document.reviewBComparisonValidatorStdoutByteSha256) fail('raw_ab_report_invalid');
  const knownClips = new Set(publicState.sourceInventory.paired.map((source) => source.clipId)); const hardRoles = new Map(publicState.evaluationContract.clipInventory.map((item) => [item.clipId, item.role]));
  const assertCount = (entry) => {
    if (!Number.isInteger(entry.frames) || entry.frames < 0 || entry.frames > 6711 || !Array.isArray(entry.clips) || !deepEqual(entry.clips, [...entry.clips].sort(rawUtf8Compare)) || new Set(entry.clips).size !== entry.clips.length || entry.clips.some((clipId) => !knownClips.has(clipId)) || entry.frames === 0 !== (entry.clips.length === 0) || entry.frames < entry.clips.length) fail('raw_ab_report_invalid');
  };
  for (let index = 0; index < roles.length; index += 1) {
    const individual = document.individualGateEvidence[index]; const support = document.supportReacquireEvidence[index];
    if (individual.rowCount !== 6711 || individual.truthPass !== true || individual.validatorExitCode !== 0 || !Array.isArray(support.contact) || !Array.isArray(support.observability) || !deepEqual(support.contact.map((item) => item.field), ['left:moving', 'left:planted', 'right:moving', 'right:planted']) || !deepEqual(support.observability.map((item) => item.field), ['head', 'leftHand', 'rightHand'])) fail('raw_ab_report_invalid');
    for (const count of [...support.contact, ...support.observability]) assertCount(count);
    if (!Array.isArray(support.reacquireEvents) || !Array.isArray(support.hardTestReacquireClips)) fail('raw_ab_report_invalid');
    let previousKey = null; const eventClips = new Set();
    for (const event of support.reacquireEvents) {
      const source = publicState.sourceInventory.paired.find((item) => item.clipId === event.clipId); const startRow = publicState.decoderRows.find((row) => row.clipId === event.clipId && row.sourceFrameIndex === event.startFrameIndex); const endRow = publicState.decoderRows.find((row) => row.clipId === event.clipId && row.sourceFrameIndex === event.endFrameIndexExclusive);
      const key = `${event.clipId}\0${String(event.startFrameIndex).padStart(10, '0')}\0${String(event.endFrameIndexExclusive).padStart(10, '0')}\0${String(event.reacquiredFrameIndex).padStart(10, '0')}`;
      if (!source || hardRoles.get(event.clipId) !== 'hard_test' || !startRow || !endRow || !Number.isInteger(event.reacquiredFrameIndex) || event.startFrameIndex >= event.endFrameIndexExclusive || event.endFrameIndexExclusive > event.reacquiredFrameIndex || event.reacquiredFrameIndex >= source.decoderRowCount || previousKey !== null && rawUtf8Compare(previousKey, key) >= 0 || (BigInt(endRow.ptsTicks) - BigInt(startRow.ptsTicks)) * BigInt(startRow.timeBase.numerator) * 1000n < 200n * BigInt(startRow.timeBase.denominator)) fail('raw_ab_report_invalid');
      previousKey = key; eventClips.add(event.clipId);
    }
    const expectedEventClips = [...eventClips].sort(rawUtf8Compare); if (!deepEqual(support.hardTestReacquireClips, expectedEventClips)) fail('raw_ab_report_invalid');
    const supportPass = support.contact.every((item) => item.frames >= 300 && item.clips.length >= 2) && support.observability.every((item) => item.frames >= 300 && item.clips.length >= 2); const reacquirePass = support.reacquireEvents.length >= 3 && support.hardTestReacquireClips.length >= 2;
    if (individual.supportPass !== supportPass || individual.reacquirePass !== reacquirePass || support.gatePass !== (supportPass && reacquirePass)) fail('raw_ab_report_invalid');
  }
  const cellsByFamily = { presencePersonState: [], contact: [], observability: [] }; for (const cell of document.agreementCells) cellsByFamily[cell.family]?.push(cell);
  const average = (items) => items.reduce((sum, item) => sum + item.kappa, 0) / items.length; const macros = document.agreementMacros;
  if (average(cellsByFamily.presencePersonState) !== macros.presencePersonStateKappa || average(cellsByFamily.contact) !== macros.contactKappa || average(cellsByFamily.observability) !== macros.observabilityKappa) fail('raw_ab_report_invalid');
  const agreementPass = macros.presencePersonStateKappa >= macros.thresholds.presencePersonStateKappa && macros.contactKappa >= macros.thresholds.contactKappa && macros.observabilityKappa >= macros.thresholds.observabilityKappa;
  const expectedGate = agreementPass && document.supportReacquireEvidence.every((item) => item.gatePass); if (document.gatePass !== expectedGate) fail('raw_ab_report_invalid');
}

function pointerToken(value) { return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1'); }
function windowKey(window) { return `${window.clipId}\0${window.windowId}`; }
function reviewWindowsById(review) { return new Map(review.windows.map((window) => [windowKey(window), window])); }
function formalSegmentPath(clipId, start, end, leaf) { return `/clips/${pointerToken(clipId)}/segments/${start}-${end}/${leaf}`; }
function windowParentPath(clipId, id) { return `/clips/${pointerToken(clipId)}/windowsById/${pointerToken(id)}`; }

export function deriveDisagreements(reviewA, reviewB, publicState) {
  const { aRows, bRows } = rawAgreement(reviewA, reviewB, publicState); const disagreements = [];
  for (const source of publicState.sourceInventory.paired) {
    const clipA = reviewA.clips.find((x) => x.clipId === source.clipId); const clipB = reviewB.clips.find((x) => x.clipId === source.clipId);
    const boundaries = new Set([0, source.decoderRowCount]);
    for (const interval of [...clipA.intervals, ...clipB.intervals]) { boundaries.add(interval.startFrameIndex); boundaries.add(interval.endFrameIndexExclusive); }
    const ordered = [...boundaries].sort((a, b) => a - b);
    const offset = publicState.decoderRows.findIndex((row) => row.clipId === source.clipId);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const start = ordered[i]; const end = ordered[i + 1]; const aRow = aRows[offset + start]; const bRow = bRows[offset + start];
      for (const [leaf, valueType] of SEGMENT_LEAVES) {
        const av = getLeaf(aRow, leaf); const bv = getLeaf(bRow, leaf);
        if (!deepEqual(av, bv)) disagreements.push({ path: formalSegmentPath(source.clipId, start, end, leaf), valueType, reviewAValue: av, reviewBValue: bv, coordinateKind: 'segment', clipId: source.clipId, startFrameIndex: start, endFrameIndexExclusive: end, leaf });
      }
    }
  }
  const aWindows = reviewWindowsById(reviewA); const bWindows = reviewWindowsById(reviewB);
  for (const key of [...new Set([...aWindows.keys(), ...bWindows.keys()])].sort(rawUtf8Compare)) {
    const a = aWindows.get(key) ?? null; const b = bWindows.get(key) ?? null; const clipId = (a ?? b).clipId; const id = (a ?? b).windowId;
    if (!a || !b) disagreements.push({ path: windowParentPath(clipId, id), valueType: 'window-or-null', reviewAValue: a, reviewBValue: b, coordinateKind: 'window-parent', clipId, windowId: id });
    else {
      for (const [key, valueType] of [['startFrameIndex', 'source-frame-index'], ['endFrameIndexExclusive', 'source-frame-index-exclusive'], ['purposeTags', 'purpose-array'], ['scenarioTags', 'scenario-array']]) {
        if (!deepEqual(a[key], b[key])) disagreements.push({ path: `${windowParentPath(clipId, id)}/${key}`, valueType, reviewAValue: a[key], reviewBValue: b[key], coordinateKind: 'window-child', clipId, windowId: id, child: key });
      }
    }
  }
  disagreements.sort((a, b) => rawUtf8Compare(a.path, b.path));
  if (new Set(disagreements.map((x) => x.path)).size !== disagreements.length) fail('disagreement_duplicate_path');
  return disagreements;
}

export function makeSkeleton(reviewA, reviewB, publicState, binding) {
  const disagreements = deriveDisagreements(reviewA, reviewB, publicState);
  const compact = disagreements.map(({ coordinateKind: _kind, clipId: _clip, startFrameIndex: _start, endFrameIndexExclusive: _end, leaf: _leaf, windowId: _window, child: _child, ...item }) => item);
  return {
    artifactType: 'sam-goal-typed-disagreement-skeleton-v1', schemaVersion: 1, ...PROCESS_MARKER,
    ...binding,
    disagreements: compact,
    decisions: compact.map(({ path: disagreementPath, valueType }) => ({ path: disagreementPath, valueType, decision: { status: 'UNSET' } })),
  };
}

export function projectC0(disagreement, c0Rows, c0Windows) {
  if (disagreement.coordinateKind === 'segment') {
    const registeredType = new Map(SEGMENT_LEAVES).get(disagreement.leaf);
    if (!registeredType || registeredType !== disagreement.valueType || disagreement.path !== formalSegmentPath(disagreement.clipId, disagreement.startFrameIndex, disagreement.endFrameIndexExclusive, disagreement.leaf)) fail('c0_projection_path_type_mismatch');
    const rows = c0Rows.filter((row) => row.clipId === disagreement.clipId && row.sourceFrameIndex >= disagreement.startFrameIndex && row.sourceFrameIndex < disagreement.endFrameIndexExclusive);
    if (rows.length !== disagreement.endFrameIndexExclusive - disagreement.startFrameIndex || rows.some((row, index) => row.sourceFrameIndex !== disagreement.startFrameIndex + index)) fail('c0_segment_projection_empty'); const runs = [];
    for (const row of rows) {
      const value = getLeaf(row, disagreement.leaf); const previous = runs.at(-1);
      if (previous && previous.endFrameIndexExclusive === row.sourceFrameIndex && deepEqual(previous.value, value)) previous.endFrameIndexExclusive += 1;
      else runs.push({ startFrameIndex: row.sourceFrameIndex, endFrameIndexExclusive: row.sourceFrameIndex + 1, value });
    }
    return { c0RowRuns: runs };
  }
  if (disagreement.coordinateKind === 'window-parent') {
    if (disagreement.valueType !== 'window-or-null' || disagreement.path !== windowParentPath(disagreement.clipId, disagreement.windowId)) fail('c0_projection_path_type_mismatch');
  } else if (disagreement.coordinateKind === 'window-child') {
    const childTypes = { startFrameIndex: 'source-frame-index', endFrameIndexExclusive: 'source-frame-index-exclusive', purposeTags: 'purpose-array', scenarioTags: 'scenario-array' };
    if (childTypes[disagreement.child] !== disagreement.valueType || disagreement.path !== `${windowParentPath(disagreement.clipId, disagreement.windowId)}/${disagreement.child}`) fail('c0_projection_path_type_mismatch');
  } else fail('c0_projection_coordinate_kind_invalid');
  const window = c0Windows.find((item) => item.clipId === disagreement.clipId && item.windowId === disagreement.windowId);
  if (!window) return { c0Projection: C0_MISSING };
  const value = disagreement.coordinateKind === 'window-parent' ? window : window[disagreement.child];
  return { c0Projection: { status: 'C0_WINDOW_PRESENT', value } };
}

function segmentPlans(reviewA, reviewB, publicState) {
  const aRows = materializeReview(reviewA, publicState, { expectedRole: 'first' });
  const bRows = materializeReview(reviewB, publicState, { expectedRole: 'second' });
  const plans = [];
  for (const source of publicState.sourceInventory.paired) {
    const clipA = reviewA.clips.find((x) => x.clipId === source.clipId); const clipB = reviewB.clips.find((x) => x.clipId === source.clipId);
    const boundaries = new Set([0, source.decoderRowCount]);
    for (const interval of [...clipA.intervals, ...clipB.intervals]) { boundaries.add(interval.startFrameIndex); boundaries.add(interval.endFrameIndexExclusive); }
    const ordered = [...boundaries].sort((a, b) => a - b); const offset = publicState.decoderRows.findIndex((row) => row.clipId === source.clipId);
    for (let index = 0; index < ordered.length - 1; index += 1) plans.push({ clipId: source.clipId, startFrameIndex: ordered[index], endFrameIndexExclusive: ordered[index + 1], aRow: aRows[offset + ordered[index]], bRow: bRows[offset + ordered[index]] });
  }
  return plans;
}

function setLeafValue(row, leafPath, value) {
  if (leafPath === 'scenarios') { row.scenarios = structuredClone(value); return; }
  const keys = leafPath.split('/'); let cursor = row.manualState; for (const key of keys.slice(0, -1)) cursor = cursor[key]; cursor[keys.at(-1)] = structuredClone(value);
}

export function materializeAdjudicationFinalRows(reviewA, reviewB, decisions, publicState) {
  const disagreements = deriveDisagreements(reviewA, reviewB, publicState); const expectedKeys = disagreements.map((item) => `${item.path}\0${item.valueType}`); const actualKeys = decisions.map((item) => `${item.path}\0${item.valueType}`);
  if (!deepEqual(actualKeys, expectedKeys) || new Set(actualKeys).size !== actualKeys.length) fail('deviation_decision_set_mismatch'); const decisionByPath = new Map(decisions.map((item) => [item.path, item])); const { aRows } = rawAgreement(reviewA, reviewB, publicState); const rows = [];
  for (const segment of segmentPlans(reviewA, reviewB, publicState)) {
    const selected = structuredClone(segment.aRow);
    for (const [leaf, valueType] of SEGMENT_LEAVES) { const disagreementPath = formalSegmentPath(segment.clipId, segment.startFrameIndex, segment.endFrameIndexExclusive, leaf); const decision = decisionByPath.get(disagreementPath); if (decision) { if (decision.valueType !== valueType) fail('deviation_decision_set_mismatch'); setLeafValue(selected, leaf, decision.value); } }
    for (let frame = segment.startFrameIndex; frame < segment.endFrameIndexExclusive; frame += 1) { const identity = publicState.decoderRows.find((item) => item.clipId === segment.clipId && item.sourceFrameIndex === frame); rows.push({ ...exactIdentity(identity), scenarios: structuredClone(selected.scenarios), manualState: structuredClone(selected.manualState) }); }
  }
  rows.sort((left, right) => publicState.decoderRows.findIndex((item) => item.clipId === left.clipId && item.sourceFrameIndex === left.sourceFrameIndex) - publicState.decoderRows.findIndex((item) => item.clipId === right.clipId && item.sourceFrameIndex === right.sourceFrameIndex));
  const aWindows = reviewWindowsById(reviewA); const bWindows = reviewWindowsById(reviewB); const windows = [];
  for (const key of [...new Set([...aWindows.keys(), ...bWindows.keys()])].sort(rawUtf8Compare)) {
    const left = aWindows.get(key) ?? null; const right = bWindows.get(key) ?? null; const source = left ?? right; const parent = decisionByPath.get(windowParentPath(source.clipId, source.windowId)); let selected;
    if (parent) { if (parent.valueType !== 'window-or-null') fail('deviation_decision_set_mismatch'); selected = structuredClone(parent.value); }
    else { selected = structuredClone(left); if (selected) for (const [child, valueType] of [['startFrameIndex','source-frame-index'],['endFrameIndexExclusive','source-frame-index-exclusive'],['purposeTags','purpose-array'],['scenarioTags','scenario-array']]) { const decision = decisionByPath.get(`${windowParentPath(source.clipId, source.windowId)}/${child}`); if (decision) { if (decision.valueType !== valueType) fail('deviation_decision_set_mismatch'); selected[child] = structuredClone(decision.value); } } }
    if (selected !== null) { if (selected.clipId !== source.clipId || selected.windowId !== source.windowId) fail('adjudication_window_identity_drift'); windows.push(selected); }
  }
  const worksheetWindows = windows.map((window) => ({ ...structuredClone(window), origin: window.windowId === `base-${window.clipId}` && deepEqual(window.purposeTags, ['full_clip_denominator']) ? 'structural_base' : 'actor_overlay' }));
  const synthetic = { artifactType: 'sam-goal-review-worksheet-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: 'adjudication-final-materialization', mode: 'first', actorPseudonymSha256: reviewA.reviewerPseudonymSha256, bundleManifestByteSha256: '0'.repeat(64), sourceBinding: processSourceBinding(publicState), rulebookByteSha256: '0'.repeat(64), windows: worksheetWindows, rows };
  validateWorksheet(synthetic, publicState, { requireComplete: true, expectedMode: 'first' }); const evidence = assertFinalReviewEvidence(rows, publicState); return { rows, windows: normalizeWindows(synthetic), evidence };
}

export function assertFinalReviewEvidence(rows, publicState) {
  const evidence = reviewEvidenceFromRows(rows, publicState);
  if (!evidence.contactPass || !evidence.observabilityPass) fail('final_support_gate_failed');
  if (!evidence.reacquirePass) fail('final_reacquire_gate_failed');
  return evidence;
}

function deviationCoordinateBase(disagreement, finalValue, projection) {
  const base = {
    path: disagreement.path, coordinateKind: disagreement.coordinateKind, valueType: disagreement.valueType,
    reviewAValue: structuredClone(disagreement.reviewAValue), reviewBValue: structuredClone(disagreement.reviewBValue), finalValue: structuredClone(finalValue), clipId: disagreement.clipId,
  };
  if (disagreement.coordinateKind === 'segment') return { ...base, startFrameIndex: disagreement.startFrameIndex, endFrameIndexExclusive: disagreement.endFrameIndexExclusive, c0RowRuns: structuredClone(projection.c0RowRuns) };
  return { ...base, windowId: disagreement.windowId, c0Projection: structuredClone(projection.c0Projection) };
}

export function deriveAgreedC0Deviations(reviewA, reviewB, c0Rows, c0Windows, publicState) {
  const records = [];
  for (const segment of segmentPlans(reviewA, reviewB, publicState)) for (const [leaf, valueType] of SEGMENT_LEAVES) {
    const reviewAValue = getLeaf(segment.aRow, leaf); const reviewBValue = getLeaf(segment.bRow, leaf);
    if (!deepEqual(reviewAValue, reviewBValue)) continue;
    const coordinate = { path: formalSegmentPath(segment.clipId, segment.startFrameIndex, segment.endFrameIndexExclusive, leaf), coordinateKind: 'segment', valueType, reviewAValue, reviewBValue, clipId: segment.clipId, startFrameIndex: segment.startFrameIndex, endFrameIndexExclusive: segment.endFrameIndexExclusive, leaf };
    const projection = projectC0(coordinate, c0Rows, c0Windows); const differs = projection.c0RowRuns.some((run) => !deepEqual(run.value, reviewAValue));
    if (!differs) continue;
    const base = deviationCoordinateBase(coordinate, reviewAValue, projection);
    records.push({ ...base, class: 'c0_differs_from_ab_agreement' });
    if (projection.c0RowRuns.some((run, index) => index > 0 && run.startFrameIndex > segment.startFrameIndex && run.startFrameIndex < segment.endFrameIndexExclusive)) records.push({ ...structuredClone(base), class: 'c0_boundary_not_represented_by_ab' });
  }
  const aWindows = reviewWindowsById(reviewA); const bWindows = reviewWindowsById(reviewB); const c0ByKey = new Map(c0Windows.map((window) => [windowKey(window), window]));
  for (const key of [...new Set([...aWindows.keys(), ...bWindows.keys(), ...c0ByKey.keys()])].sort(rawUtf8Compare)) {
    const a = aWindows.get(key) ?? null; const b = bWindows.get(key) ?? null; if (!deepEqual(a, b)) continue;
    const c0Window = c0ByKey.get(key) ?? null; if (deepEqual(a, c0Window)) continue;
    const source = a ?? b ?? c0Window; const coordinate = { path: windowParentPath(source.clipId, source.windowId), coordinateKind: 'window-parent', valueType: 'window-or-null', reviewAValue: a, reviewBValue: b, clipId: source.clipId, windowId: source.windowId };
    const projection = projectC0(coordinate, c0Rows, c0Windows);
    records.push({ ...deviationCoordinateBase(coordinate, a, projection), class: 'c0_differs_from_ab_agreement' });
  }
  records.sort((a, b) => rawUtf8Compare(a.path, b.path) || rawUtf8Compare(a.coordinateKind, b.coordinateKind) || DEVIATION_CLASSES.indexOf(a.class) - DEVIATION_CLASSES.indexOf(b.class));
  return records;
}

export function deriveDeviationCoordinates(reviewA, reviewB, c0Rows, c0Windows, decisions, publicState) {
  const decisionMap = new Map(decisions.map((decision) => [`${decision.path}\0${decision.valueType}`, decision.value]));
  const disagreements = deriveDisagreements(reviewA, reviewB, publicState);
  if (decisionMap.size !== decisions.length || decisionMap.size !== disagreements.length) fail('deviation_decision_set_mismatch');
  const records = [];
  for (const disagreement of disagreements) {
    const key = `${disagreement.path}\0${disagreement.valueType}`; if (!decisionMap.has(key)) fail('deviation_decision_set_mismatch');
    const finalValue = decisionMap.get(key); const projection = projectC0(disagreement, c0Rows, c0Windows); const base = deviationCoordinateBase(disagreement, finalValue, projection);
    for (const klass of classifyDeviation(disagreement, finalValue, projection)) records.push({ ...structuredClone(base), class: klass });
  }
  records.push(...deriveAgreedC0Deviations(reviewA, reviewB, c0Rows, c0Windows, publicState));
  records.sort((a, b) => rawUtf8Compare(a.path, b.path) || rawUtf8Compare(a.coordinateKind, b.coordinateKind) || DEVIATION_CLASSES.indexOf(a.class) - DEVIATION_CLASSES.indexOf(b.class));
  return records;
}

export function deriveCurrentDeviationCoordinates(reviewA, reviewB, c0Rows, c0Windows, decisions, publicState) {
  if (!Array.isArray(decisions)) fail('deviation_decision_set_mismatch'); const disagreements = deriveDisagreements(reviewA, reviewB, publicState); const disagreementByKey = new Map(disagreements.map((item) => [`${item.path}\0${item.valueType}`, item])); const seen = new Set(); const records = [];
  for (const decision of decisions) {
    const key = `${decision.path}\0${decision.valueType}`; if (seen.has(key) || !disagreementByKey.has(key)) fail('deviation_decision_set_mismatch'); seen.add(key);
    if (deepEqual(decision.decision, UNSET)) continue;
    const disagreement = disagreementByKey.get(key); const projection = projectC0(disagreement, c0Rows, c0Windows); const base = deviationCoordinateBase(disagreement, decision.decision, projection);
    for (const klass of classifyDeviation(disagreement, decision.decision, projection)) records.push({ ...structuredClone(base), class: klass });
  }
  records.push(...deriveAgreedC0Deviations(reviewA, reviewB, c0Rows, c0Windows, publicState));
  records.sort((a, b) => rawUtf8Compare(a.path, b.path) || rawUtf8Compare(a.coordinateKind, b.coordinateKind) || DEVIATION_CLASSES.indexOf(a.class) - DEVIATION_CLASSES.indexOf(b.class)); return records;
}

function assertSkeletonDecisionCore(skeleton, reviewA, reviewB, publicState) {
  const expected = makeSkeleton(reviewA, reviewB, publicState, {});
  if (!skeleton || skeleton.artifactType !== expected.artifactType || skeleton.schemaVersion !== 1 || skeleton.authorityClass !== PROCESS_MARKER.authorityClass || skeleton.compilerInput !== false || skeleton.p0Authority !== false || !deepEqual(skeleton.disagreements, expected.disagreements) || !deepEqual(skeleton.decisions, expected.decisions)) fail('disagreement_skeleton_invalid');
  return deriveDisagreements(reviewA, reviewB, publicState);
}

function assertAdjudicationDispositionValue(event) {
  if (!DEVIATION_CLASSES.includes(event.deviationClass) || !CLASS_DISPOSITIONS[event.deviationClass]?.includes(event.disposition)) fail('deviation_disposition_invalid');
  if (typeof event.rationale !== 'string' || !event.rationale.trim()) fail('deviation_rationale_required');
}

export function replayAdjudicationJournal({ journal, skeleton, reviewA, reviewB, c0Rows, c0Windows, publicState, expectedActorPseudonym, expectedRevealReceiptByteSha256 = journal?.revealReceiptByteSha256, requireComplete = false }) {
  if (!journal || journal.artifactType !== 'sam-goal-review-edit-journal-v1' || journal.schemaVersion !== 1 || journal.mode !== 'adjudication-reveal' || journal.actorPseudonymSha256 !== expectedActorPseudonym || journal.revealReceiptByteSha256 !== expectedRevealReceiptByteSha256 || !Array.isArray(journal.events)) fail('adjudication_journal_invalid');
  assertSha(expectedActorPseudonym, 'adjudicator_pseudonym_invalid'); assertSha(expectedRevealReceiptByteSha256, 'reveal_receipt_hash_mismatch'); assertSkeletonDecisionCore(skeleton, reviewA, reviewB, publicState); const skeletonByPath = new Map(skeleton.decisions.map((item) => [item.path, item]));
  const decisions = new Map(); const dispositions = new Map(); let currentCoordinates = null;
  const decisionState = () => skeleton.decisions.map((item) => ({ path: item.path, valueType: item.valueType, decision: decisions.has(item.path) ? structuredClone(decisions.get(item.path)) : structuredClone(UNSET) }));
  const formalDecisions = () => decisionState().map((item) => ({ path: item.path, valueType: item.valueType, value: structuredClone(item.decision) }));
  for (let index = 0; index < journal.events.length; index += 1) {
    const event = journal.events[index]; if (event.sequence !== index + 1) fail('edit_sequence_invalid');
    if (['navigate', 'playback'].includes(event.action)) {
      const row = publicState.decoderRows.find((item) => item.clipId === event.clipId && item.sourceFrameIndex === event.sourceFrameIndex); if (!row) fail('adjudication_navigation_identity_invalid'); continue;
    }
    if (event.actorPseudonymSha256 !== expectedActorPseudonym) fail('journal_actor_mismatch');
    if (event.action === 'set-decision') {
      const fixedDecision = skeletonByPath.get(event.path); if (!fixedDecision || fixedDecision.valueType !== event.valueType) fail('deviation_decision_set_mismatch');
      if (deepEqual(event.decision, UNSET)) decisions.delete(event.path); else decisions.set(event.path, structuredClone(event.decision));
      // A single decision can change segment boundaries/window projections and therefore
      // the class of coordinates other than the edited path.  Every disposition was
      // derived from the previous complete decision state, so none may survive a
      // decision transition without an explicit actor confirmation against the new set.
      dispositions.clear();
      currentCoordinates = null; continue;
    }
    if (event.action === 'set-disposition') {
      currentCoordinates ??= deriveCurrentDeviationCoordinates(reviewA, reviewB, c0Rows, c0Windows, decisionState(), publicState); const coordinate = currentCoordinates.find((item) => item.path === event.path && item.coordinateKind === event.coordinateKind && item.class === event.deviationClass);
      if (!coordinate) fail('deviation_disposition_coordinate_invalid'); const key = `${event.path}\0${event.coordinateKind}\0${event.deviationClass}`; const clears = deepEqual(event.disposition, UNSET) && deepEqual(event.rationale, UNSET);
      if (clears) dispositions.delete(key); else { if (deepEqual(event.disposition, UNSET) || deepEqual(event.rationale, UNSET)) fail('deviation_disposition_invalid'); assertAdjudicationDispositionValue(event); dispositions.set(key, { disposition: event.disposition, rationale: event.rationale }); } continue;
    }
    fail('adjudication_journal_action_invalid');
  }
  const decisionsComplete = decisions.size === skeleton.decisions.length; if (requireComplete && !decisionsComplete) fail('adjudication_decisions_incomplete');
  currentCoordinates ??= deriveCurrentDeviationCoordinates(reviewA, reviewB, c0Rows, c0Windows, decisionState(), publicState); const dispositionRecords = currentCoordinates.map((coordinate) => {
    const disposition = dispositions.get(`${coordinate.path}\0${coordinate.coordinateKind}\0${coordinate.class}`); if (!disposition) { if (requireComplete) fail('deviation_disposition_set_mismatch'); return null; }
    return { ...structuredClone(coordinate), ...structuredClone(disposition) };
  });
  const records = dispositionRecords.filter(Boolean); if (requireComplete && records.length !== currentCoordinates.length) fail('deviation_disposition_set_mismatch');
  if (requireComplete) assertExactDeviationRecords(currentCoordinates, records);
  const finalState = { artifactType: 'sam-goal-adjudication-session-final-state-v1', schemaVersion: 1, ...PROCESS_MARKER, cycleId: journal.cycleId, adjudicatorPseudonymSha256: expectedActorPseudonym, revealReceiptByteSha256: expectedRevealReceiptByteSha256, decisions: decisionState(), dispositionRecords: currentCoordinates.map((coordinate, index) => ({ coordinateKind: coordinate.coordinateKind, path: coordinate.path, deviationClass: coordinate.class, disposition: dispositionRecords[index]?.disposition ?? structuredClone(UNSET), rationale: dispositionRecords[index]?.rationale ?? structuredClone(UNSET) })) };
  const dispositionsComplete = records.length === currentCoordinates.length; const complete = decisionsComplete && dispositionsComplete; const final = requireComplete ? materializeAdjudicationFinalRows(reviewA, reviewB, formalDecisions(), publicState) : null;
  return { complete, decisionsComplete, dispositionsComplete, decisions: decisionState(), dispositionRecords: finalState.dispositionRecords, records, finalState, final };
}

export function classifyDeviation(disagreement, finalValue, projection) {
  const rawClass = deepEqual(finalValue, disagreement.reviewAValue) && !deepEqual(finalValue, disagreement.reviewBValue) ? 'final_matches_a_only'
    : deepEqual(finalValue, disagreement.reviewBValue) && !deepEqual(finalValue, disagreement.reviewAValue) ? 'final_matches_b_only'
      : 'final_matches_neither_raw_review';
  const classes = [rawClass];
  if (disagreement.coordinateKind === 'segment') {
    const matches = projection.c0RowRuns.map((run) => deepEqual(run.value, finalValue));
    classes.push(matches.every(Boolean) ? 'final_matches_c0_all_rows' : matches.some(Boolean) ? 'final_matches_c0_some_rows' : 'final_matches_c0_no_rows');
    if (projection.c0RowRuns.some((run, index) => index > 0 && run.startFrameIndex > disagreement.startFrameIndex && run.startFrameIndex < disagreement.endFrameIndexExclusive)) classes.push('c0_boundary_not_represented_by_ab');
  } else if (projection.c0Projection.status === 'C0_WINDOW_MISSING') {
    if (disagreement.coordinateKind === 'window-parent' && finalValue === null) classes.push('window_final_matches_c0'); else classes.push('c0_window_missing');
  } else classes.push(deepEqual(finalValue, projection.c0Projection.value) ? 'window_final_matches_c0' : 'window_final_differs_from_c0');
  return classes;
}

const RAW_DEVIATION_CLASSES = new Set(['final_matches_a_only', 'final_matches_b_only', 'final_matches_neither_raw_review']);
const SEGMENT_ONLY_DEVIATION_CLASSES = new Set(['final_matches_c0_all_rows', 'final_matches_c0_some_rows', 'final_matches_c0_no_rows', 'c0_boundary_not_represented_by_ab']);
const WINDOW_ONLY_DEVIATION_CLASSES = new Set(['window_final_matches_c0', 'window_final_differs_from_c0', 'c0_window_missing']);

function assertDeviationCoordinateClass(record) {
  const kind = record.coordinateKind; const klass = record.class;
  if (!['segment', 'window-parent', 'window-child'].includes(kind) || !DEVIATION_CLASSES.includes(klass)) fail('deviation_coordinate_class_invalid');
  if (SEGMENT_ONLY_DEVIATION_CLASSES.has(klass) && kind !== 'segment') fail('deviation_coordinate_class_invalid');
  if (WINDOW_ONLY_DEVIATION_CLASSES.has(klass) && !['window-parent', 'window-child'].includes(kind)) fail('deviation_coordinate_class_invalid');
  if (klass === 'c0_differs_from_ab_agreement' && !['segment', 'window-parent'].includes(kind)) fail('deviation_coordinate_class_invalid');
}

function assertDeviationCoordinateValue(record) {
  if (record.coordinateKind === 'segment') {
    if (!Number.isInteger(record.startFrameIndex) || !Number.isInteger(record.endFrameIndexExclusive) || record.startFrameIndex < 0 || record.endFrameIndexExclusive <= record.startFrameIndex) fail('deviation_coordinate_value_invalid');
    const match = SEGMENT_LEAVES.find(([leaf, valueType]) => record.path === formalSegmentPath(record.clipId, record.startFrameIndex, record.endFrameIndexExclusive, leaf) && record.valueType === valueType);
    if (!match) fail('deviation_coordinate_value_invalid');
    return;
  }
  if (!WINDOW_ID_RE.test(record.windowId)) fail('deviation_coordinate_value_invalid');
  const parent = windowParentPath(record.clipId, record.windowId);
  if (record.coordinateKind === 'window-parent') {
    if (record.path !== parent || record.valueType !== 'window-or-null') fail('deviation_coordinate_value_invalid');
    return;
  }
  const children = new Map([['startFrameIndex', 'source-frame-index'], ['endFrameIndexExclusive', 'source-frame-index-exclusive'], ['purposeTags', 'purpose-array'], ['scenarioTags', 'scenario-array']]);
  const child = [...children].find(([name, valueType]) => record.path === `${parent}/${name}` && record.valueType === valueType);
  if (!child) fail('deviation_coordinate_value_invalid');
}

function assertDeviationC0Projection(record) {
  if (record.coordinateKind === 'segment') {
    if (!Array.isArray(record.c0RowRuns) || !record.c0RowRuns.length || Object.hasOwn(record, 'c0Projection')) fail('deviation_c0_runs_invalid');
    let cursor = record.startFrameIndex;
    for (let index = 0; index < record.c0RowRuns.length; index += 1) {
      const run = record.c0RowRuns[index];
      if (!run || typeof run !== 'object' || Array.isArray(run) || !deepEqual(Object.keys(run).sort(rawUtf8Compare), ['endFrameIndexExclusive', 'startFrameIndex', 'value']) || !Number.isInteger(run.startFrameIndex) || !Number.isInteger(run.endFrameIndexExclusive) || run.startFrameIndex !== cursor || run.endFrameIndexExclusive <= run.startFrameIndex || run.endFrameIndexExclusive > record.endFrameIndexExclusive || index > 0 && deepEqual(run.value, record.c0RowRuns[index - 1].value)) fail('deviation_c0_runs_invalid');
      cursor = run.endFrameIndexExclusive;
    }
    if (cursor !== record.endFrameIndexExclusive) fail('deviation_c0_runs_invalid');
    return;
  }
  if (Object.hasOwn(record, 'c0RowRuns') || !record.c0Projection || typeof record.c0Projection !== 'object' || Array.isArray(record.c0Projection)) fail('deviation_projection_kind_invalid');
  if (record.c0Projection.status === 'C0_WINDOW_MISSING') {
    if (!deepEqual(Object.keys(record.c0Projection), ['status'])) fail('deviation_projection_kind_invalid');
  } else if (record.c0Projection.status === 'C0_WINDOW_PRESENT') {
    if (!deepEqual(Object.keys(record.c0Projection).sort(rawUtf8Compare), ['status', 'value'])) fail('deviation_projection_kind_invalid');
  } else fail('deviation_projection_kind_invalid');
}

function assertDeviationClassification(record) {
  if (RAW_DEVIATION_CLASSES.has(record.class)) {
    if (deepEqual(record.reviewAValue, record.reviewBValue)) fail('deviation_classification_invalid');
    const expected = deepEqual(record.finalValue, record.reviewAValue) ? 'final_matches_a_only'
      : deepEqual(record.finalValue, record.reviewBValue) ? 'final_matches_b_only' : 'final_matches_neither_raw_review';
    if (record.class !== expected) fail('deviation_classification_invalid');
    return;
  }
  if (record.coordinateKind === 'segment') {
    const matches = record.c0RowRuns.map((run) => deepEqual(run.value, record.finalValue));
    if (record.class.startsWith('final_matches_c0_')) {
      const expected = matches.every(Boolean) ? 'final_matches_c0_all_rows' : matches.some(Boolean) ? 'final_matches_c0_some_rows' : 'final_matches_c0_no_rows';
      if (record.class !== expected) fail('deviation_classification_invalid');
      return;
    }
    if (record.class === 'c0_boundary_not_represented_by_ab') {
      if (!record.c0RowRuns.some((run, index) => index > 0 && run.startFrameIndex > record.startFrameIndex && run.startFrameIndex < record.endFrameIndexExclusive)) fail('deviation_classification_invalid');
      return;
    }
    if (record.class === 'c0_differs_from_ab_agreement') {
      if (!deepEqual(record.reviewAValue, record.reviewBValue) || !deepEqual(record.finalValue, record.reviewAValue) || !record.c0RowRuns.some((run) => !deepEqual(run.value, record.finalValue))) fail('deviation_classification_invalid');
      return;
    }
    fail('deviation_classification_invalid');
  }
  const missing = record.c0Projection.status === 'C0_WINDOW_MISSING';
  const semanticC0Match = missing ? record.coordinateKind === 'window-parent' && record.finalValue === null : deepEqual(record.finalValue, record.c0Projection.value);
  if (record.class === 'window_final_matches_c0' && !semanticC0Match) fail('deviation_classification_invalid');
  if (record.class === 'window_final_differs_from_c0' && (missing || semanticC0Match)) fail('deviation_classification_invalid');
  if (record.class === 'c0_window_missing' && (!missing || semanticC0Match)) fail('deviation_classification_invalid');
  if (record.class === 'c0_differs_from_ab_agreement' && (!deepEqual(record.reviewAValue, record.reviewBValue) || !deepEqual(record.finalValue, record.reviewAValue) || semanticC0Match)) fail('deviation_classification_invalid');
}

export function validateDeviationRecord(record) {
  assertDeviationCoordinateClass(record); assertDeviationCoordinateValue(record); assertDeviationC0Projection(record); assertDeviationClassification(record); validateDisposition(record); return true;
}

export function assertExactDeviationRecords(expectedCoordinates, actualRecords) {
  if (!Array.isArray(expectedCoordinates) || !Array.isArray(actualRecords) || expectedCoordinates.length !== actualRecords.length) fail('deviation_records_invalid');
  const stripped = actualRecords.map(({ disposition: _disposition, rationale: _rationale, ...coordinate }) => coordinate);
  if (!deepEqual(stripped, expectedCoordinates)) fail('deviation_records_invalid');
  for (const record of actualRecords) validateDeviationRecord(record);
  return true;
}

export function validateDisposition(record) {
  if (!DEVIATION_CLASSES.includes(record.class) || !CLASS_DISPOSITIONS[record.class].includes(record.disposition)) fail('deviation_disposition_invalid');
  if (typeof record.rationale !== 'string' || !record.rationale.trim()) fail('deviation_rationale_required');
  if (record.disposition === 'restart_cycle') fail('restart_cycle_blocks');
}

function exactPermissionBits(mode) { return mode & 0o7777; }

export function snapshotPathSync(target, { expectedType = 'file', expectedHash, expectedMode } = {}) {
  if (expectedMode !== undefined && (!Number.isInteger(expectedMode) || expectedMode < 0 || expectedMode > 0o7777)) fail('expected_mode_invalid');
  const ancestors = []; let cursor = path.resolve(path.dirname(target));
  while (true) { const stat = fs.lstatSync(cursor); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ancestor_invalid'); ancestors.push({ path: cursor, dev: `${stat.dev}`, ino: `${stat.ino}`, mode: stat.mode, uid: stat.uid, gid: stat.gid, type: 'directory', symlink: false }); const next = path.dirname(cursor); if (next === cursor) break; cursor = next; }
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0); const fd = fs.openSync(target, flags);
  try {
    const stat = fs.fstatSync(fd); const lst = fs.lstatSync(target);
    if (expectedType === 'file' && (!stat.isFile() || !lst.isFile() || lst.isSymbolicLink() || stat.nlink !== 1)) fail('sealed_file_type_invalid');
    if (expectedMode !== undefined && (exactPermissionBits(stat.mode) !== expectedMode || exactPermissionBits(lst.mode) !== expectedMode)) fail('sealed_file_mode_invalid');
    const bytes = readFdExactlySync(fd, stat.size); const digest = sha256(bytes); if (expectedHash && digest !== expectedHash) fail('expected_hash_mismatch');
    const real = fs.realpathSync(target); const post = fs.fstatSync(fd); const pathPost = fs.lstatSync(target);
    const secondBytes = readFdExactlySync(fd, stat.size);
    if (!post.isFile() || !pathPost.isFile() || pathPost.isSymbolicLink() || stat.dev !== post.dev || stat.ino !== post.ino || stat.size !== post.size || stat.mode !== post.mode || stat.nlink !== post.nlink || stat.dev !== pathPost.dev || stat.ino !== pathPost.ino || stat.size !== pathPost.size || stat.mode !== pathPost.mode || stat.nlink !== pathPost.nlink || !bytes.equals(secondBytes) || digest !== sha256(secondBytes)) fail('snapshot_identity_drift');
    for (const item of ancestors) { const current = fs.lstatSync(item.path); if (!current.isDirectory() || current.isSymbolicLink() || `${current.dev}` !== item.dev || `${current.ino}` !== item.ino || current.mode !== item.mode || current.uid !== item.uid || current.gid !== item.gid) fail('ancestor_identity_drift'); }
    return { path: path.resolve(target), realpath: real, fd, bytes, sha256: digest, expectedMode, stat: { dev: `${stat.dev}`, ino: `${stat.ino}`, mode: stat.mode, nlink: stat.nlink, size: stat.size, uid: stat.uid, gid: stat.gid }, ancestors };
  } catch (error) { fs.closeSync(fd); throw error; }
}

export function closeSnapshot(snapshot) { if (snapshot?.fd !== undefined) { fs.closeSync(snapshot.fd); snapshot.fd = undefined; } }

function readFdExactlySync(fd, size) {
  if (!Number.isSafeInteger(size) || size < 0) fail('snapshot_size_invalid');
  const buffer = Buffer.alloc(size); let offset = 0;
  while (offset < size) {
    const count = fs.readSync(fd, buffer, offset, size - offset, offset);
    if (count === 0) fail('snapshot_short_read'); offset += count;
  }
  const one = Buffer.alloc(1); if (fs.readSync(fd, one, 0, 1, size) !== 0) fail('snapshot_size_drift');
  return buffer;
}

export function revalidateSnapshotSync(snapshot) {
  const stat = fs.fstatSync(snapshot.fd); const lst = fs.lstatSync(snapshot.path); const bytes = readFdExactlySync(snapshot.fd, snapshot.stat.size);
  if (!stat.isFile() || !lst.isFile() || lst.isSymbolicLink() || `${stat.dev}` !== snapshot.stat.dev || `${stat.ino}` !== snapshot.stat.ino || `${lst.dev}` !== snapshot.stat.dev || `${lst.ino}` !== snapshot.stat.ino || stat.size !== snapshot.stat.size || lst.size !== snapshot.stat.size || stat.nlink !== snapshot.stat.nlink || lst.nlink !== snapshot.stat.nlink || stat.mode !== snapshot.stat.mode || lst.mode !== snapshot.stat.mode || stat.uid !== snapshot.stat.uid || lst.uid !== snapshot.stat.uid || stat.gid !== snapshot.stat.gid || lst.gid !== snapshot.stat.gid || (snapshot.expectedMode !== undefined && (exactPermissionBits(stat.mode) !== snapshot.expectedMode || exactPermissionBits(lst.mode) !== snapshot.expectedMode)) || !bytes.equals(snapshot.bytes) || sha256(bytes) !== snapshot.sha256 || fs.realpathSync(snapshot.path) !== snapshot.realpath) fail('snapshot_identity_drift');
  for (const item of snapshot.ancestors) { const current = fs.lstatSync(item.path); if (!current.isDirectory() || current.isSymbolicLink() || `${current.dev}` !== item.dev || `${current.ino}` !== item.ino || current.mode !== item.mode || current.uid !== item.uid || current.gid !== item.gid) fail('ancestor_identity_drift'); }
}

export function proveDirectorySync(directory, names, expectedHashes = {}, { expectedDirectoryMode, expectedMemberModes = {} } = {}) {
  if (expectedDirectoryMode !== undefined && (!Number.isInteger(expectedDirectoryMode) || expectedDirectoryMode < 0 || expectedDirectoryMode > 0o7777)) fail('expected_mode_invalid');
  const target = path.resolve(directory); const before = fs.lstatSync(target);
  if (!before.isDirectory() || before.isSymbolicLink()) fail('sealed_directory_type_invalid');
  if (expectedDirectoryMode !== undefined && exactPermissionBits(before.mode) !== expectedDirectoryMode) fail('sealed_directory_mode_invalid');
  const entries = fs.readdirSync(target).sort(rawUtf8Compare); const expectedNames = [...names].sort(rawUtf8Compare);
  if (!deepEqual(entries, expectedNames)) fail('sealed_directory_members_invalid');
  const members = {};
  try {
    for (const name of expectedNames) members[name] = snapshotPathSync(path.join(target, name), { expectedType: 'file', expectedHash: expectedHashes[name], expectedMode: expectedMemberModes[name] });
    const afterEntries = fs.readdirSync(target).sort(rawUtf8Compare);
    if (!deepEqual(afterEntries, expectedNames)) fail('sealed_directory_members_drift');
    const after = fs.lstatSync(target); if (`${before.dev}` !== `${after.dev}` || `${before.ino}` !== `${after.ino}` || !after.isDirectory() || after.isSymbolicLink() || before.mode !== after.mode || before.uid !== after.uid || before.gid !== after.gid || (expectedDirectoryMode !== undefined && exactPermissionBits(after.mode) !== expectedDirectoryMode)) fail('sealed_directory_identity_drift');
    for (const snapshot of Object.values(members)) revalidateSnapshotSync(snapshot);
    return { directory: target, stat: { dev: `${before.dev}`, ino: `${before.ino}`, mode: before.mode, uid: before.uid, gid: before.gid }, entries, members };
  } catch (error) { for (const snapshot of Object.values(members)) closeSnapshot(snapshot); throw error; }
}

export function closeDirectoryProof(proof) { for (const snapshot of Object.values(proof?.members ?? {})) closeSnapshot(snapshot); }

export function revalidateDirectoryProofSync(proof) {
  const current = fs.lstatSync(proof.directory); if (!current.isDirectory() || current.isSymbolicLink() || `${current.dev}` !== proof.stat.dev || `${current.ino}` !== proof.stat.ino || current.mode !== proof.stat.mode || current.uid !== proof.stat.uid || current.gid !== proof.stat.gid) fail('sealed_directory_identity_drift');
  const entries = fs.readdirSync(proof.directory).sort(rawUtf8Compare); if (!deepEqual(entries, proof.entries)) fail('sealed_directory_members_drift');
  for (const snapshot of Object.values(proof.members)) revalidateSnapshotSync(snapshot);
}

function assertSnapshotTransfer(before, after) {
  if (!before || !after || before.stat.dev !== after.stat.dev || before.stat.ino !== after.stat.ino || before.stat.mode !== after.stat.mode || before.stat.nlink !== after.stat.nlink || before.stat.size !== after.stat.size || before.stat.uid !== after.stat.uid || before.stat.gid !== after.stat.gid || before.sha256 !== after.sha256 || !before.bytes.equals(after.bytes)) fail('committed_member_identity_drift');
}

function assertDirectoryTransfer(before, after) {
  if (!before || !after || before.stat.dev !== after.stat.dev || before.stat.ino !== after.stat.ino || before.stat.mode !== after.stat.mode || before.stat.uid !== after.stat.uid || before.stat.gid !== after.stat.gid || !deepEqual(Object.keys(before.members).sort(rawUtf8Compare), Object.keys(after.members).sort(rawUtf8Compare))) fail('committed_directory_identity_drift');
  for (const name of Object.keys(before.members)) assertSnapshotTransfer(before.members[name], after.members[name]);
}

export async function writeExclusiveFile(target, bytes, mode = 0o600) {
  throwIfPreCommitSignal();
  const handle = await fsp.open(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), mode);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  throwIfPreCommitSignal();
}
function writeRegisteredFileStageSync(target, bytes, mode = 0o600) {
  let fd; let owned;
  try {
    fd = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), mode);
    owned = pathIdentitySync(target); registerStage(target, owned); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    const finalIdentity = pathIdentitySync(target); if (owned.dev !== finalIdentity.dev || owned.ino !== finalIdentity.ino || owned.type !== finalIdentity.type || finalIdentity.symlink) fail('stage_identity_drift');
    owned.mode = finalIdentity.mode; owned.nlink = finalIdentity.nlink; owned.size = finalIdentity.size; return owned;
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    if (owned) { try { const located = locateOwnedPath(target, owned); if (located) fs.rmSync(located, { force: false }); } catch {} unregisterStage(target); }
    throw error;
  }
}
function createRegisteredDirectoryStageSync(target) {
  let owned;
  try { fs.mkdirSync(target, { mode: 0o700 }); owned = pathIdentitySync(target); if (owned.type !== 'directory' || owned.symlink) fail('directory_stage_invalid'); registerStage(target, owned); return owned; }
  catch (error) {
    if (owned) { try { const located = locateOwnedPath(target, owned); if (located) fs.rmSync(located, { recursive: true, force: false }); } catch {} unregisterStage(target); }
    else { try { const current = pathIdentitySync(target); if (current.type === 'directory' && !current.symlink) fs.rmSync(target, { recursive: true, force: false }); } catch {} }
    throw error;
  }
}

export async function fsyncDirectory(target) {
  throwIfPreCommitSignal();
  const before = await fsp.lstat(target); if (!before.isDirectory() || before.isSymbolicLink()) fail('fsync_directory_invalid');
  const handle = await fsp.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try { const held = await handle.stat(); if (!held.isDirectory() || held.dev !== before.dev || held.ino !== before.ino) fail('fsync_directory_identity_drift'); await handle.sync(); const after = await fsp.lstat(target); if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode) fail('fsync_directory_identity_drift'); } finally { await handle.close(); }
  throwIfPreCommitSignal();
}
export function stageName(destination) { return path.join(path.dirname(destination), `.${path.basename(destination)}.mro-stage-${process.pid}-${crypto.randomBytes(8).toString('hex')}`); }
function renameTestBarrier(absolute, kind) {
  if (!(process.env.NODE_ENV === 'test' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST === '1' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_BARRIER === '1')) return undefined;
  const phase = process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_PHASE ?? 'pre';
  if (!['pre', 'during', 'post-ponr', 'post-proof'].includes(phase)) fail('rename_test_phase_invalid');
  return { phase, barrierPath: `${absolute}.mro-test-${kind}-${phase}-barrier`, releasePath: `${absolute}.mro-test-${kind}-${phase}-release` };
}

async function awaitParentTestBarrier(testBarrier, phase) {
  if (!testBarrier || testBarrier.phase !== phase) return;
  if (!(process.env.NODE_ENV === 'test' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST === '1' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_BARRIER === '1')) fail('rename_test_gate_invalid');
  const fd = fs.openSync(testBarrier.barrierPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try { fs.writeFileSync(fd, Buffer.from(`${canonicalStringify({ phase, helperPid: testBarrier.helperPid ?? null })}\n`)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      try { const stat = fs.lstatSync(testBarrier.releasePath); if (!stat.isFile() || stat.isSymbolicLink()) fail('rename_test_release_invalid'); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (Date.now() >= deadline) fail('rename_test_release_timeout');
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    try { fs.unlinkSync(testBarrier.barrierPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { fs.unlinkSync(testBarrier.releasePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function renameSourceMeta(identity) {
  return { dev: Number(identity.dev), ino: Number(identity.ino), mode: identity.mode, nlink: identity.nlink, size: identity.size, type: identity.type };
}

function assertRenameMeta(value, expected, code) {
  assertExactKeys(value, ['dev', 'ino', 'mode', 'nlink', 'size', 'type'], code);
  for (const key of ['dev', 'ino', 'mode', 'nlink', 'size']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail(code);
  if (!['directory', 'regular', 'other'].includes(value.type)) fail(code);
  if (expected && !deepEqual(value, expected)) fail(code);
}

function assertRenameReport(value, expectedSource, { syscall }) {
  const keys = value && Object.hasOwn(value, 'destination')
    ? ['destination', 'errno', 'rc', 'source', 'syscallRc']
    : ['errno', 'rc', 'source', 'syscallRc'];
  assertExactKeys(value, keys, 'rename_excl_helper_protocol');
  if (!Number.isSafeInteger(value.errno) || value.errno < 0 || !Number.isSafeInteger(value.rc)) fail('rename_excl_helper_protocol');
  if (syscall ? !Number.isSafeInteger(value.syscallRc) : value.syscallRc !== null) fail('rename_excl_helper_protocol');
  assertRenameMeta(value.source, expectedSource, 'rename_excl_source_identity_protocol');
  if (value.destination) assertRenameMeta(value.destination, undefined, 'rename_excl_destination_identity_protocol');
  if (syscall && value.syscallRc === 0 && !value.destination) fail('rename_excl_helper_protocol');
  if (!syscall && ![-3, -2].includes(value.rc)) fail('rename_excl_helper_protocol');
}

export function parseRenameExclProtocol({ stdoutBytes, stderrBytes, status, signal, expectedSource, criticalEntered }) {
  if (!Buffer.isBuffer(stdoutBytes) || !Buffer.isBuffer(stderrBytes) || stderrBytes.length !== 0 || signal !== null || !Number.isInteger(status)) fail('rename_excl_helper_protocol');
  const text = stdoutBytes.toString('utf8');
  if (!text.endsWith('\n') || text.includes('\r') || Buffer.byteLength(text, 'utf8') !== stdoutBytes.length) fail('rename_excl_helper_protocol');
  const lines = text.slice(0, -1).split('\n');
  if (!lines.length || lines.some((line) => line.length === 0)) fail('rename_excl_helper_protocol');
  const first = parseJsonBuffer(Buffer.from(lines[0]));
  if (first?.phase === 'READY') {
    if (!criticalEntered || lines.length !== 2) fail('rename_excl_helper_protocol');
    assertExactKeys(first, ['phase', 'source'], 'rename_excl_ready_protocol');
    assertRenameMeta(first.source, expectedSource, 'rename_excl_source_identity_protocol');
    const report = parseJsonBuffer(Buffer.from(lines[1]));
    assertRenameReport(report, expectedSource, { syscall: true });
    const expectedStatus = report.rc === 0 ? 0 : report.errno === 17 ? 17 : 1;
    if (status !== expectedStatus) fail('rename_excl_helper_protocol');
    return { report, protocolPhase: 'READY_THEN_TERMINAL' };
  }
  if (criticalEntered || lines.length !== 1) fail('rename_excl_helper_protocol');
  assertRenameReport(first, expectedSource, { syscall: false });
  const expectedStatus = first.errno === 17 ? 17 : 1;
  if (status !== expectedStatus) fail('rename_excl_helper_protocol');
  return { report: first, protocolPhase: 'PRECHECK_TERMINAL' };
}

export async function runRenameExcl(source, destination, { testBarrier, beforeGo, expectedSourceIdentity } = {}) {
  if (RENAME_EXCL_HELPER_SOURCE_SHA256 !== RENAME_EXCL_HELPER_SOURCE_EXPECTED_SHA256) fail('rename_excl_helper_source_pin_mismatch');
  const pythonBytes = fs.readFileSync(RENAME_EXCL_PYTHON);
  if (sha256(pythonBytes) !== RENAME_EXCL_PYTHON_BYTE_SHA256) fail('rename_excl_runtime_pin_mismatch');
  const env = {};
  if (testBarrier?.phase === 'pre') {
    if (!(process.env.NODE_ENV === 'test' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RUNTIME_TEST === '1' && process.env.SAM_GOAL_MANUAL_REVIEW_OPS_V1_RENAME_BARRIER === '1')) fail('rename_test_gate_invalid');
    Object.assign(env, {
      MRO_RENAME_TEST_NODE_ENV: 'test', MRO_RENAME_TEST_RUNTIME: '1', MRO_RENAME_TEST_BARRIER: '1',
      MRO_RENAME_TEST_BARRIER_PATH: testBarrier.barrierPath,
      MRO_RENAME_TEST_RELEASE_PATH: testBarrier.releasePath,
    });
  }
  const sourceIdentity = pathIdentitySync(source); const expectedSource = renameSourceMeta(expectedSourceIdentity ?? sourceIdentity);
  if (expectedSourceIdentity && !sameIdentity(expectedSourceIdentity, sourceIdentity)) fail('rename_excl_source_identity_drift');
  return new Promise((resolve, reject) => {
    const child = spawn(RENAME_EXCL_PYTHON, ['-I', '-S', '-c', RENAME_EXCL_HELPER_SOURCE, source, destination], { env, stdio: ['pipe', 'pipe', 'pipe'] }); transactionSignals.activeChildren.add(child);
    const stdout = []; const stderr = []; let text = ''; let firstHandled = false; let criticalEntered = false; let protocolError = null; let readyFlow = Promise.resolve(); let settled = false;
    const rejectOnce = (error) => { if (settled) return; settled = true; reject(error); }; const resolveOnce = (value) => { if (settled) return; settled = true; resolve(value); };
    child.stdin.on('error', (error) => { if (!protocolError) { protocolError = new MroError('rename_excl_helper_stdin_error', error.code ?? error.message); protocolError.criticalEntered = criticalEntered; } });
    const sendGo = () => new Promise((done) => {
      let finished = false; const finish = (error) => { if (finished) return; finished = true; child.removeListener('exit', onExit); if (error && !protocolError) { protocolError = new MroError('rename_excl_helper_stdin_error', error.code ?? error.message); protocolError.criticalEntered = criticalEntered; } done(); };
      const onExit = () => finish(new Error('helper_exited_before_go_write_completed')); child.once('exit', onExit);
      try { child.stdin.end('GO\n', () => finish()); } catch (error) { finish(error); }
    });
    child.stdout.on('data', (chunk) => {
      stdout.push(Buffer.from(chunk)); text += chunk.toString('utf8');
      if (!firstHandled && text.includes('\n')) {
        firstHandled = true; const first = text.slice(0, text.indexOf('\n'));
        try {
          const ready = parseJsonBuffer(Buffer.from(first));
          if (ready.phase === 'READY') {
            assertExactKeys(ready, ['phase', 'source'], 'rename_excl_ready_protocol'); assertRenameMeta(ready.source, expectedSource, 'rename_excl_source_identity_protocol'); throwIfPreCommitSignal(); enterCommitCritical(); criticalEntered = true;
            if (testBarrier) testBarrier.helperPid = child.pid;
            readyFlow = (async () => { await awaitParentTestBarrier(testBarrier, 'during'); if (beforeGo) await beforeGo(); throwIfPreCommitSignal(); await sendGo(); })().catch((error) => { protocolError = error; try { child.kill('SIGTERM'); } catch {} });
          }
        } catch (error) { protocolError = error; try { child.kill('SIGTERM'); } catch {} }
      }
    });
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => { transactionSignals.activeChildren.delete(child); error.criticalEntered = criticalEntered; rejectOnce(error); });
    child.once('exit', async (status, signal) => {
      transactionSignals.activeChildren.delete(child); const stdoutBytes = Buffer.concat(stdout); const stderrBytes = Buffer.concat(stderr);
      await readyFlow;
      if (protocolError) { protocolError.criticalEntered = criticalEntered; return rejectOnce(protocolError); }
      try {
        const protocol = parseRenameExclProtocol({ stdoutBytes, stderrBytes, status, signal, expectedSource, criticalEntered });
        resolveOnce({ exitCode: status, signal, report: protocol.report, protocolPhase: protocol.protocolPhase, criticalEntered, stderrByteSha256: sha256(stderrBytes), stderrBytes: stderrBytes.length });
      } catch (error) { error.criticalEntered = criticalEntered; rejectOnce(error); }
    });
  });
}

function optionalIdentity(target) { try { return pathIdentitySync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function memberIdentityMap(root, names) {
  const result = {}; let rootIdentity = null; try { rootIdentity = optionalIdentity(root); } catch {}
  for (const name of [...names].sort(rawUtf8Compare)) {
    if (!rootIdentity || rootIdentity.type !== 'directory' || rootIdentity.symlink) { result[name] = null; continue; }
    try { result[name] = optionalIdentity(path.join(root, name)); } catch (error) { result[name] = { errorCode: error.code ?? 'member_identity_unavailable' }; }
  }
  return result;
}
async function runOwnedRenameExcl(source, destination, owned, options) {
  let helper; let helperError;
  try { helper = await runRenameExcl(source, destination, { ...options, expectedSourceIdentity: options?.expectedSourceIdentity ?? owned }); } catch (error) { helperError = error; }
  let sourceNow = null; let destinationNow = null; let sourceProbeError = null; let destinationProbeError = null;
  try { sourceNow = optionalIdentity(source); } catch (error) { sourceProbeError = error; }
  try { destinationNow = optionalIdentity(destination); } catch (error) { destinationProbeError = error; }
  const sourceOwned = sourceNow && owned.dev === sourceNow.dev && owned.ino === sourceNow.ino && owned.type === sourceNow.type;
  let destinationOwned = destinationNow && owned.dev === destinationNow.dev && owned.ino === destinationNow.ino && owned.type === destinationNow.type;
  const terminalSyscallKnown = Boolean(helper && Number.isInteger(helper.report?.syscallRc));
  const ambiguousAfterReady = !terminalSyscallKnown && Boolean(helper?.criticalEntered || helperError?.criticalEntered);
  const locatedOwnedPath = locateOwnedPath(source, owned); if (locatedOwnedPath && path.resolve(locatedOwnedPath) === path.resolve(destination)) destinationOwned = true;
  const locatedOwnedSource = locatedOwnedPath && !destinationOwned ? locatedOwnedPath : null;
  // A known terminal report is authoritative: only syscallRc=0 is an authorized PONR. The owned
  // destination inference is used solely when READY was observed but the terminal report was lost.
  const ponr = Boolean(helper?.report?.syscallRc === 0 || (!terminalSyscallKnown && ambiguousAfterReady && destinationOwned));
  const reconciliationError = sourceProbeError ?? destinationProbeError;
  const unauthorizedDestinationOwned = terminalSyscallKnown && helper.report.syscallRc !== 0 && destinationOwned;
  const indeterminate = !ponr && Boolean(unauthorizedDestinationOwned || (!locatedOwnedSource && (ambiguousAfterReady || reconciliationError || helper?.criticalEntered || helperError?.criticalEntered)));
  if (ponr && !owned.disposableCapability) owned.pastPonr = true; if (indeterminate && !owned.disposableCapability) owned.indeterminatePreserve = true;
  return { helper, helperError, reconciliationError, sourceProbeError, destinationProbeError, criticalEntered: helper?.criticalEntered ?? helperError?.criticalEntered ?? false, sourceNow, destinationNow, sourceOwned: Boolean(sourceOwned), destinationOwned: Boolean(destinationOwned), locatedOwnedSource, locatedOwnedPath, ponr, indeterminate, unauthorizedDestinationOwned };
}

export async function ensureRenameExclCapability(parent) {
  const parentBefore = await fsp.lstat(parent); if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) fail('output_parent_invalid');
  // Verify the authorized executable before any disposable or real stage is created.
  const pythonBytes = await fsp.readFile(RENAME_EXCL_PYTHON); if (sha256(pythonBytes) !== RENAME_EXCL_PYTHON_BYTE_SHA256) fail('rename_excl_runtime_pin_mismatch');
  for (const kind of ['directory', 'regular']) {
    const nonce = crypto.randomBytes(8).toString('hex'); const source = path.join(parent, `.mro-rename-cap-${kind}-source-${process.pid}-${nonce}`); const destination = path.join(parent, `.mro-rename-cap-${kind}-destination-${process.pid}-${nonce}`);
    const ownedSource = kind === 'directory' ? createRegisteredDirectoryStageSync(source) : writeRegisteredFileStageSync(source, Buffer.from('mro-rename-capability\n')); ownedSource.disposableCapability = true;
    let capabilityCritical = false; let capabilitySignalCode = null;
    try {
      const outcome = await runOwnedRenameExcl(source, destination, ownedSource); const result = outcome.helper;
      capabilityCritical = outcome.criticalEntered;
      if (outcome.indeterminate) fail('commit_outcome_indeterminate');
      if (outcome.reconciliationError) throw outcome.reconciliationError;
      if (!result || result.report.syscallRc === 0 && result.exitCode !== 0) fail('atomic_no_replace_capability_identity_failure');
      if (result.exitCode !== 0 || result.report.rc !== 0 || result.report.syscallRc !== 0 || !outcome.destinationOwned || !result.report.destination || !deepEqual(result.report.source, { dev: Number(ownedSource.dev), ino: Number(ownedSource.ino), mode: ownedSource.mode, nlink: ownedSource.nlink, size: ownedSource.size, type: ownedSource.type })) fail('atomic_directory_no_replace_unavailable');
      const destinationIdentity = pathIdentitySync(destination); if (!sameIdentity(ownedSource, destinationIdentity) || `${result.report.destination.dev}` !== ownedSource.dev || `${result.report.destination.ino}` !== ownedSource.ino) fail('atomic_directory_no_replace_unavailable');
    } finally { if (capabilityCritical) capabilitySignalCode = leaveCommitCritical(); await safeRemoveOwned(source, ownedSource, kind === 'directory'); await safeRemoveOwned(destination, ownedSource, kind === 'directory'); unregisterStage(source); await fsyncDirectory(parent); }
    if (capabilitySignalCode) { transactionSignals.preCommit ??= capabilitySignalCode === 130 ? 'SIGINT' : 'SIGTERM'; throwIfPreCommitSignal(); }
  }
  const parentAfter = await fsp.lstat(parent); if (`${parentBefore.dev}` !== `${parentAfter.dev}` || `${parentBefore.ino}` !== `${parentAfter.ino}`) fail('ancestor_identity_drift');
}

export async function commitSingleFile(destination, bytes, { beforeCommit } = {}) {
  const canonical = canonicalizeDestination(destination); const { absolute, parent } = canonical; const ancestors = captureAncestorChainSync(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); await ensureRenameExclCapability(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); const stage = stageName(absolute);
  const ownedStage = writeRegisteredFileStageSync(stage, bytes); ownedStage.protectedDestination = absolute; let ponr = false; let critical = false; let snapshot; let signalExitCode = null;
  try {
    if (ownedStage.type !== 'regular' || ownedStage.nlink !== 1 || exactPermissionBits(ownedStage.mode) !== 0o600) fail('single_file_stage_invalid'); snapshot = snapshotPathSync(stage, { expectedHash: sha256(bytes), expectedMode: 0o600 }); revalidateAncestorChainSync(ancestors); revalidateSnapshotSync(snapshot); if (beforeCommit) await beforeCommit(); revalidateSnapshotSync(snapshot);
    const testBarrier = renameTestBarrier(absolute, 'single-file');
    const outcome = await runOwnedRenameExcl(stage, absolute, ownedStage, { testBarrier, beforeGo: async () => { if (beforeCommit) await beforeCommit(); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); revalidateSnapshotSync(snapshot); } }); critical = outcome.criticalEntered; ponr = outcome.ponr;
    await awaitParentTestBarrier(testBarrier, 'post-ponr');
    if (outcome.indeterminate) fail('commit_outcome_indeterminate');
    if (outcome.reconciliationError) throw outcome.reconciliationError;
    const rename = outcome.helper; if (!rename) throw outcome.helperError ?? new MroError('rename_excl_helper_protocol');
    if (rename.exitCode === 17 && !ponr) fail('output_exists'); if (rename.exitCode !== 0 || rename.report.rc !== 0 || rename.report.syscallRc !== 0 || !outcome.destinationOwned) fail('atomic_single_file_no_replace_failed');
    await fsyncDirectory(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
    const proof = snapshotPathSync(absolute, { expectedHash: sha256(bytes) }); assertSnapshotTransfer(snapshot, proof); closeSnapshot(proof); await awaitParentTestBarrier(testBarrier, 'post-proof');
    signalExitCode = leaveCommitCritical(); critical = false; unregisterStage(stage);
    return { committed: true, status: 'committed', path: absolute, byteSha256: sha256(bytes), signalExitCode };
  } catch (error) {
    if (critical) { signalExitCode = leaveCommitCritical(); critical = false; }
    if (!ponr) await safeRemoveOwned(stage, ownedStage, false);
    if (ponr) return { committed: true, status: 'committed_pending_reproof', path: absolute, byteSha256: sha256(bytes), destinationIdentity: optionalIdentity(absolute), errorCode: error.code ?? 'post_commit_proof_failed', signalExitCode };
    throw error;
  } finally { closeSnapshot(snapshot); unregisterStage(stage); }
}

export async function commitDirectory(destination, members) {
  return commitDirectoryTransaction(destination, Object.keys(members), async (stage) => {
    for (const [name, bytes] of Object.entries(members)) await writeExclusiveFile(path.join(stage, name), bytes);
    return { memberBytes: members, memberModes: Object.fromEntries(Object.keys(members).map((name) => [name, 0o600])) };
  });
}

export async function commitDirectoryTransaction(destination, expectedNames, prepare) {
  const canonical = canonicalizeDestination(destination); const { absolute, parent } = canonical; const ancestors = captureAncestorChainSync(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
  await ensureRenameExclCapability(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
  const stage = stageName(absolute); const ownedStage = createRegisteredDirectoryStageSync(stage); ownedStage.protectedDestination = absolute; let ponr = false; let prepared; let stageProof; let critical = false; let signalExitCode = null; let hashes = {}; let proofOptions = { expectedDirectoryMode: 0o700, expectedMemberModes: {} };
  try {
    prepared = await prepare(stage); if (!sameIdentity(ownedStage, pathIdentitySync(stage), { includeMutableMetadata: false })) fail('stage_identity_drift');
    if (!prepared?.memberBytes || !deepEqual(Object.keys(prepared.memberBytes).sort(rawUtf8Compare), [...expectedNames].sort(rawUtf8Compare))) fail('transaction_member_set_invalid');
    if (!prepared.memberModes || !deepEqual(Object.keys(prepared.memberModes).sort(rawUtf8Compare), [...expectedNames].sort(rawUtf8Compare)) || Object.values(prepared.memberModes).some((mode) => !Number.isInteger(mode) || mode < 0 || mode > 0o7777)) fail('transaction_member_modes_invalid');
    hashes = Object.fromEntries(Object.entries(prepared.memberBytes).map(([name, bytes]) => [name, sha256(bytes)])); proofOptions = { expectedDirectoryMode: 0o700, expectedMemberModes: prepared.memberModes };
    await fsyncDirectory(stage); if (!sameIdentity(ownedStage, pathIdentitySync(stage), { includeMutableMetadata: false })) fail('stage_identity_drift');
    if (prepared.beforeCommit) await prepared.beforeCommit(); if (!sameIdentity(ownedStage, pathIdentitySync(stage), { includeMutableMetadata: false })) fail('stage_identity_drift');
    stageProof = proveDirectorySync(stage, expectedNames, hashes, proofOptions); for (const snapshot of Object.values(stageProof.members)) revalidateSnapshotSync(snapshot); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
    const testBarrier = renameTestBarrier(absolute, 'directory');
    const outcome = await runOwnedRenameExcl(stage, absolute, ownedStage, { testBarrier, expectedSourceIdentity: pathIdentitySync(stage), beforeGo: async () => { if (prepared.beforeCommit) await prepared.beforeCommit(); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); revalidateDirectoryProofSync(stageProof); } }); critical = outcome.criticalEntered; ponr = outcome.ponr; const rename = outcome.helper;
    await awaitParentTestBarrier(testBarrier, 'post-ponr');
    if (outcome.indeterminate) fail('commit_outcome_indeterminate');
    if (outcome.reconciliationError) throw outcome.reconciliationError;
    if (!rename) throw outcome.helperError ?? new MroError('rename_excl_helper_protocol');
    if (rename.exitCode === 17 && !ponr) fail('output_exists');
    if (rename.exitCode !== 0 || rename.report.rc !== 0 || rename.report.syscallRc !== 0 || !outcome.destinationOwned) fail('atomic_directory_no_replace_failed', 'renamex_np failed', rename.report);
    await fsyncDirectory(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
    const proof = proveDirectorySync(absolute, expectedNames, hashes, proofOptions); assertDirectoryTransfer(stageProof, proof); closeDirectoryProof(proof); await awaitParentTestBarrier(testBarrier, 'post-proof');
    signalExitCode = leaveCommitCritical(); critical = false; unregisterStage(stage);
    return { committed: true, status: 'committed', directory: absolute, memberSha256: hashes, destinationIdentity: pathIdentitySync(absolute), memberIdentities: memberIdentityMap(absolute, expectedNames), signalExitCode };
  } catch (error) {
    if (critical) { signalExitCode = leaveCommitCritical(); critical = false; }
    if (!ponr) await safeRemoveOwned(stage, ownedStage, true);
    if (ponr) return { committed: true, status: 'committed_pending_reproof', directory: absolute, memberSha256: hashes, destinationIdentity: optionalIdentity(absolute), memberIdentities: memberIdentityMap(absolute, expectedNames), errorCode: error.code ?? 'post_commit_proof_failed', signalExitCode };
    throw error;
  } finally { closeDirectoryProof(stageProof); unregisterStage(stage); }
}

export async function commitBundleTree(destination, { copiedAssets, generatedFiles, beforeCommit }) {
  const canonical = canonicalizeDestination(destination); const { absolute, parent } = canonical; const ancestors = captureAncestorChainSync(parent);
  revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); await ensureRenameExclCapability(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); const stage = stageName(absolute); const ownedStage = createRegisteredDirectoryStageSync(stage); ownedStage.protectedDestination = absolute; let ponr = false; let stageProof; let critical = false; let signalExitCode = null; let expectedTree = {};
  try {
    const allLogical = [...copiedAssets.map((x) => x.logicalPath), ...Object.keys(generatedFiles)];
    if (new Set(allLogical).size !== allLogical.length || allLogical.some((name) => name.startsWith('/') || name.includes('..') || name.includes('\\')) || copiedAssets.some((asset) => !asset.logicalPath.startsWith('immutable/')) || Object.keys(generatedFiles).some((name) => !(name.startsWith('immutable/') || name.startsWith('fixed/') || name.startsWith('mutable/')))) fail('bundle_logical_path_invalid');
    for (const asset of copiedAssets) {
      const target = path.join(stage, asset.logicalPath); await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const sourceSnapshot = snapshotPathSync(asset.sourcePath, { expectedHash: asset.sha256 }); const sourceDev = sourceSnapshot.stat.dev; const sourceIno = sourceSnapshot.stat.ino;
      try { if (sourceSnapshot.bytes.length !== asset.bytes) fail('bundle_asset_source_size_drift'); await writeExclusiveFile(target, sourceSnapshot.bytes, asset.mode ?? (asset.executable ? 0o500 : 0o400)); revalidateSnapshotSync(sourceSnapshot); } finally { closeSnapshot(sourceSnapshot); }
      const targetStat = await fsp.lstat(target);
      if (!targetStat.isFile() || targetStat.isSymbolicLink() || targetStat.nlink !== 1 || (sourceDev === `${targetStat.dev}` && sourceIno === `${targetStat.ino}`)) fail('bundle_asset_not_standalone');
      const targetBytes = await fsp.readFile(target); if (targetBytes.length !== asset.bytes || sha256(targetBytes) !== asset.sha256) fail('bundle_asset_copy_drift');
    }
    for (const [logicalPath, descriptor] of Object.entries(generatedFiles)) {
      const target = path.join(stage, logicalPath); await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await writeExclusiveFile(target, descriptor.bytes, descriptor.mode ?? 0o400);
    }
    if (!sameIdentity(ownedStage, pathIdentitySync(stage), { includeMutableMetadata: false })) fail('stage_identity_drift');
    async function syncTree(directory) {
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      for (const entry of entries) if (entry.isDirectory()) await syncTree(path.join(directory, entry.name));
      await fsyncDirectory(directory);
    }
    await syncTree(stage); if (!sameIdentity(ownedStage, pathIdentitySync(stage), { includeMutableMetadata: false })) fail('stage_identity_drift');
    expectedTree = Object.fromEntries([...copiedAssets.map((asset) => [asset.logicalPath, { sha256: asset.sha256, bytes: asset.bytes, mode: asset.mode ?? (asset.executable ? 0o500 : 0o400) }]), ...Object.entries(generatedFiles).map(([logical, descriptor]) => [logical, { sha256: sha256(descriptor.bytes), bytes: descriptor.bytes.length, mode: descriptor.mode ?? 0o400 }])]);
    if (beforeCommit) await beforeCommit();
    stageProof = proveExactTreeSync(stage, expectedTree); revalidateExactTreeProofSync(stageProof); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors);
    const testBarrier = renameTestBarrier(absolute, 'bundle-tree');
    const outcome = await runOwnedRenameExcl(stage, absolute, ownedStage, { testBarrier, expectedSourceIdentity: pathIdentitySync(stage), beforeGo: async () => { if (beforeCommit) await beforeCommit(); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); revalidateExactTreeProofSync(stageProof); } }); critical = outcome.criticalEntered; ponr = outcome.ponr; const rename = outcome.helper;
    await awaitParentTestBarrier(testBarrier, 'post-ponr');
    if (outcome.indeterminate) fail('commit_outcome_indeterminate');
    if (outcome.reconciliationError) throw outcome.reconciliationError;
    if (!rename) throw outcome.helperError ?? new MroError('rename_excl_helper_protocol'); if (rename.exitCode === 17 && !ponr) fail('output_exists'); if (rename.exitCode !== 0 || rename.report.rc !== 0 || rename.report.syscallRc !== 0 || !outcome.destinationOwned) fail('atomic_directory_no_replace_failed');
    await fsyncDirectory(parent); revalidateDestinationBinding(canonical.binding); revalidateAncestorChainSync(ancestors); const destinationProof = proveExactTreeSync(absolute, expectedTree); assertExactTreeTransfer(stageProof, destinationProof); closeExactTreeProof(destinationProof); await awaitParentTestBarrier(testBarrier, 'post-proof');
    signalExitCode = leaveCommitCritical(); critical = false; unregisterStage(stage);
    return { committed: true, status: 'committed', directory: absolute, memberSha256: Object.fromEntries(Object.entries(expectedTree).map(([logical, descriptor]) => [logical, descriptor.sha256])), expectedTreeSha256: canonicalHash(expectedTree), destinationIdentity: pathIdentitySync(absolute), memberIdentities: memberIdentityMap(absolute, Object.keys(expectedTree)), signalExitCode };
  } catch (error) {
    if (critical) { signalExitCode = leaveCommitCritical(); critical = false; }
    if (!ponr) await safeRemoveOwned(stage, ownedStage, true);
    if (ponr) return { committed: true, status: 'committed_pending_reproof', directory: absolute, memberSha256: Object.fromEntries(Object.entries(expectedTree).map(([logical, descriptor]) => [logical, descriptor.sha256])), expectedTreeSha256: canonicalHash(expectedTree), destinationIdentity: optionalIdentity(absolute), memberIdentities: memberIdentityMap(absolute, Object.keys(expectedTree)), errorCode: error.code ?? 'post_commit_proof_failed', signalExitCode };
    throw error;
  } finally { closeExactTreeProof(stageProof); unregisterStage(stage); }
}

function scanTreeSync(root) {
  const rootIdentity = pathIdentitySync(root); if (rootIdentity.type !== 'directory' || rootIdentity.symlink) fail('bundle_tree_root_invalid');
  const directories = new Map([['', rootIdentity]]); const files = [];
  const visit = (relative) => {
    const absolute = path.join(root, relative); for (const name of fs.readdirSync(absolute)) {
      const logical = relative ? path.posix.join(relative, name) : name; const identity = pathIdentitySync(path.join(root, logical));
      if (identity.symlink || identity.type === 'other') fail('bundle_tree_entry_invalid');
      if (identity.type === 'directory') { directories.set(logical, identity); visit(logical); } else files.push(logical);
    }
  };
  visit(''); return { directories, files: files.sort(rawUtf8Compare) };
}

function holdDirectorySync(target) {
  const absolute = path.resolve(target); const before = fs.lstatSync(absolute);
  if (!before.isDirectory() || before.isSymbolicLink()) fail('held_directory_invalid');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_CLOEXEC ?? 0));
  try {
    const held = fs.fstatSync(fd); const after = fs.lstatSync(absolute);
    if (!held.isDirectory() || !after.isDirectory() || after.isSymbolicLink() || held.dev !== before.dev || held.ino !== before.ino || held.mode !== before.mode || held.uid !== before.uid || held.gid !== before.gid || after.dev !== before.dev || after.ino !== before.ino || after.mode !== before.mode || after.uid !== before.uid || after.gid !== before.gid || fs.realpathSync(absolute) !== absolute) fail('held_directory_identity_drift');
    return { path: absolute, fd, dev: `${held.dev}`, ino: `${held.ino}`, mode: held.mode, uid: held.uid, gid: held.gid, type: 'directory', symlink: false };
  } catch (error) { fs.closeSync(fd); throw error; }
}

function revalidateHeldDirectorySync(held) {
  const descriptor = fs.fstatSync(held.fd); const current = fs.lstatSync(held.path);
  if (!descriptor.isDirectory() || !current.isDirectory() || current.isSymbolicLink() || `${descriptor.dev}` !== held.dev || `${descriptor.ino}` !== held.ino || descriptor.mode !== held.mode || descriptor.uid !== held.uid || descriptor.gid !== held.gid || `${current.dev}` !== held.dev || `${current.ino}` !== held.ino || current.mode !== held.mode || current.uid !== held.uid || current.gid !== held.gid || fs.realpathSync(held.path) !== held.path) fail('held_directory_identity_drift');
}

function holdCompleteAncestorDirectoriesSync(root) {
  const held = []; let cursor = path.dirname(path.resolve(root));
  for (;;) { held.push(holdDirectorySync(cursor)); const next = path.dirname(cursor); if (next === cursor) break; cursor = next; }
  return held;
}

export function proveExactTreeSync(root, expectedFiles) {
  const expectedNames = Object.keys(expectedFiles).sort(rawUtf8Compare); const expectedDirectories = new Set(['']);
  for (const logical of expectedNames) { let current = path.posix.dirname(logical); while (current !== '.') { expectedDirectories.add(current); current = path.posix.dirname(current); } }
  const before = scanTreeSync(root); if (!deepEqual(before.files, expectedNames) || !deepEqual([...before.directories.keys()].sort(rawUtf8Compare), [...expectedDirectories].sort(rawUtf8Compare)) || [...before.directories.values()].some((identity) => exactPermissionBits(identity.mode) !== 0o700)) fail('bundle_tree_member_set_invalid');
  const snapshots = {}; const directoryHandles = new Map(); let ancestorHandles = [];
  try {
    for (const logical of expectedNames) { snapshots[logical] = snapshotPathSync(path.join(root, logical), { expectedHash: expectedFiles[logical].sha256, expectedMode: expectedFiles[logical].mode }); if (snapshots[logical].bytes.length !== expectedFiles[logical].bytes) fail('bundle_tree_file_size_invalid'); }
    for (const logical of [...expectedDirectories].sort(rawUtf8Compare)) directoryHandles.set(logical, holdDirectorySync(path.join(root, logical)));
    ancestorHandles = holdCompleteAncestorDirectoriesSync(root);
    const rootOwner = directoryHandles.get(''); const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (!rootOwner || currentUid !== null && rootOwner.uid !== currentUid || [...directoryHandles.values()].some((item) => item.uid !== rootOwner.uid || item.gid !== rootOwner.gid) || Object.values(snapshots).some((item) => item.stat.uid !== rootOwner.uid || item.stat.gid !== rootOwner.gid)) fail('bundle_tree_owner_invalid');
  } catch (error) { for (const snapshot of Object.values(snapshots)) closeSnapshot(snapshot); for (const held of directoryHandles.values()) try { fs.closeSync(held.fd); } catch {} for (const held of ancestorHandles) try { fs.closeSync(held.fd); } catch {} throw error; }
  const proof = { root, expectedFiles, expectedNames, expectedDirectories, directories: before.directories, snapshots, directoryHandles, ancestorHandles }; revalidateExactTreeProofSync(proof); return proof;
}

export function revalidateExactTreeProofSync(proof) {
  for (const held of proof.ancestorHandles ?? []) revalidateHeldDirectorySync(held); for (const held of proof.directoryHandles?.values?.() ?? []) revalidateHeldDirectorySync(held);
  const after = scanTreeSync(proof.root); if (!deepEqual(after.files, proof.expectedNames) || !deepEqual([...after.directories.keys()].sort(rawUtf8Compare), [...proof.expectedDirectories].sort(rawUtf8Compare)) || [...after.directories.values()].some((identity) => exactPermissionBits(identity.mode) !== 0o700)) fail('bundle_tree_member_set_drift');
  for (const [logical, identity] of proof.directories) if (!sameIdentity(identity, after.directories.get(logical), { includeMutableMetadata: false })) fail('bundle_tree_directory_drift');
  for (const snapshot of Object.values(proof.snapshots)) revalidateSnapshotSync(snapshot);
}
export function revalidateHeldExactTreeAnchorsSync(proof, { skipLogicalPaths = [] } = {}) {
  const skipped = new Set(skipLogicalPaths); for (const held of proof?.ancestorHandles ?? []) revalidateHeldDirectorySync(held); for (const held of proof?.directoryHandles?.values?.() ?? []) revalidateHeldDirectorySync(held);
  for (const [logical, snapshot] of Object.entries(proof?.snapshots ?? {})) if (!skipped.has(logical)) revalidateSnapshotSync(snapshot);
}
export function closeExactTreeProof(proof) { for (const snapshot of Object.values(proof?.snapshots ?? {})) closeSnapshot(snapshot); for (const held of proof?.directoryHandles?.values?.() ?? []) try { fs.closeSync(held.fd); } catch {} for (const held of proof?.ancestorHandles ?? []) try { fs.closeSync(held.fd); } catch {} }

export function snapshotDirectChildAtSync(proof, directoryLogicalPath, childName, addon, { allowedNames, expectedHash, expectedMode = 0o600 } = {}) {
  if (!Array.isArray(allowedNames) || !allowedNames.includes(childName) || new Set(allowedNames).size !== allowedNames.length || typeof childName !== 'string' || !childName || childName === '.' || childName === '..' || childName.includes('/') || childName.includes('\\') || childName.includes('\0')) fail('relative_snapshot_name_invalid');
  if (!addon || typeof addon.openatReadOnly !== 'function') fail('coordinator_openat_addon_invalid'); const parent = proof?.directoryHandles?.get(directoryLogicalPath); if (!parent) fail('relative_snapshot_parent_invalid'); revalidateHeldDirectorySync(parent);
  const fd = addon.openatReadOnly(parent.fd, childName, 'regular', expectedMode, parent.uid, parent.gid); const absolute = path.join(parent.path, childName);
  try {
    const stat = fs.fstatSync(fd); const bytes = readFdExactlySync(fd, stat.size); const second = readFdExactlySync(fd, stat.size); const digest = sha256(bytes); const atPath = fs.lstatSync(absolute);
    if (!stat.isFile() || !atPath.isFile() || atPath.isSymbolicLink() || stat.nlink !== 1 || atPath.nlink !== 1 || `${stat.dev}` !== `${atPath.dev}` || `${stat.ino}` !== `${atPath.ino}` || stat.mode !== atPath.mode || stat.uid !== atPath.uid || stat.gid !== atPath.gid || stat.size !== atPath.size || exactPermissionBits(stat.mode) !== expectedMode || stat.uid !== parent.uid || stat.gid !== parent.gid || !bytes.equals(second) || digest !== sha256(second) || expectedHash && digest !== expectedHash) fail('relative_snapshot_identity_drift');
    const ancestors = []; let cursor = path.dirname(absolute); for (;;) { const item = fs.lstatSync(cursor); if (!item.isDirectory() || item.isSymbolicLink()) fail('ancestor_invalid'); ancestors.push({ path: cursor, dev: `${item.dev}`, ino: `${item.ino}`, mode: item.mode, uid: item.uid, gid: item.gid, type: 'directory', symlink: false }); const next = path.dirname(cursor); if (next === cursor) break; cursor = next; }
    return { path: absolute, realpath: fs.realpathSync(absolute), fd, bytes, sha256: digest, expectedMode, stat: { dev: `${stat.dev}`, ino: `${stat.ino}`, mode: stat.mode, nlink: stat.nlink, size: stat.size, uid: stat.uid, gid: stat.gid }, ancestors, relativeParent: parent, openedWithCoordinatorOpenat: true };
  } catch (error) { fs.closeSync(fd); throw error; }
}
function assertExactTreeTransfer(before, after) {
  if (!before || !after || !deepEqual(before.expectedNames, after.expectedNames) || !deepEqual([...before.expectedDirectories.keys()].sort(rawUtf8Compare), [...after.expectedDirectories.keys()].sort(rawUtf8Compare))) fail('committed_tree_identity_drift');
  for (const logical of before.expectedDirectories) {
    const left = before.directories.get(logical); const right = after.directories.get(logical);
    if (!left || !right || !sameIdentity(left, right, { includeMutableMetadata: false })) fail('committed_tree_directory_drift');
  }
  for (const logical of before.expectedNames) assertSnapshotTransfer(before.snapshots[logical], after.snapshots[logical]);
}

export function assertDistinctSnapshots(snapshots) {
  const paths = snapshots.map((x) => x.realpath); if (new Set(paths).size !== paths.length) fail('sealed_path_alias');
  const inodes = snapshots.map((x) => `${x.stat.dev}:${x.stat.ino}`); if (new Set(inodes).size !== inodes.length) fail('sealed_inode_alias');
}

function pathIdentitySync(target) {
  const stat = fs.lstatSync(target); return { path: target, dev: `${stat.dev}`, ino: `${stat.ino}`, mode: stat.mode, nlink: stat.nlink, size: stat.size, uid: stat.uid, gid: stat.gid, type: stat.isDirectory() ? 'directory' : stat.isFile() ? 'regular' : 'other', symlink: stat.isSymbolicLink() };
}
function assertTextualDirectoryChainSync(input) {
  const absolute = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
  if (absolute.split(path.sep).includes('..')) fail('output_textual_parent_invalid');
  const parsed = path.parse(absolute); let cursor = parsed.root; const chain = [];
  const rootIdentity = pathIdentitySync(cursor); if (rootIdentity.type !== 'directory' || rootIdentity.symlink) fail('output_symlink_traversal'); chain.push(rootIdentity);
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); const identity = pathIdentitySync(cursor);
    if (identity.type !== 'directory' || identity.symlink) fail('output_symlink_traversal'); chain.push(identity);
  }
  return chain;
}
function canonicalizeDestination(input) {
  const resolved = path.resolve(input); const textualParent = path.dirname(resolved); const basename = path.basename(resolved);
  if (!basename || basename === '.' || basename === '..') fail('output_destination_invalid');
  const rawParent = path.dirname(input); if (rawParent.split(path.sep).includes('..')) fail('output_textual_parent_invalid');
  const textualChain = assertTextualDirectoryChainSync(path.isAbsolute(rawParent) ? rawParent : path.join(process.cwd(), rawParent));
  const canonicalParent = fs.realpathSync(textualParent); const parentIdentity = pathIdentitySync(canonicalParent); if (parentIdentity.type !== 'directory' || parentIdentity.symlink) fail('output_parent_invalid');
  return { absolute: path.join(canonicalParent, basename), parent: canonicalParent, binding: { textualParent, canonicalParent, parentIdentity, textualChain } };
}
function revalidateDestinationBinding(binding) {
  for (const expected of binding.textualChain) if (!sameIdentity(expected, pathIdentitySync(expected.path), { includeMutableMetadata: false })) fail('textual_parent_identity_drift');
  if (fs.realpathSync(binding.textualParent) !== binding.canonicalParent || !sameIdentity(binding.parentIdentity, pathIdentitySync(binding.canonicalParent), { includeMutableMetadata: false })) fail('textual_parent_identity_drift');
}
function sameIdentity(a, b, { includeMutableMetadata = true } = {}) {
  return a.dev === b.dev && a.ino === b.ino && a.type === b.type && !a.symlink && !b.symlink && a.mode === b.mode && a.uid === b.uid && a.gid === b.gid && (!includeMutableMetadata || (a.nlink === b.nlink && a.size === b.size));
}
function captureAncestorChainSync(target) {
  const chain = []; let cursor = path.resolve(target);
  for (;;) { const identity = pathIdentitySync(cursor); if (identity.type !== 'directory' || identity.symlink) fail('ancestor_invalid'); chain.push(identity); const next = path.dirname(cursor); if (next === cursor) return chain; cursor = next; }
}
function revalidateAncestorChainSync(chain) { for (const expected of chain) if (!sameIdentity(expected, pathIdentitySync(expected.path), { includeMutableMetadata: false })) fail('ancestor_identity_drift'); }
function resolveAncestorChainPath(chain) {
  const ordered = [...chain].reverse(); let current = ordered[0].path;
  try { if (!sameIdentity(ordered[0], pathIdentitySync(current), { includeMutableMetadata: false })) return null; } catch { return null; }
  for (let index = 1; index < ordered.length; index += 1) {
    const expected = ordered[index]; let found = null;
    try { for (const name of fs.readdirSync(current)) { const candidate = path.join(current, name); try { if (sameIdentity(expected, pathIdentitySync(candidate), { includeMutableMetadata: false })) { found = candidate; break; } } catch {} } } catch { return null; }
    if (!found) return null; current = found;
  }
  return current;
}
function locateOwnedPath(target, owned) {
  try { const current = pathIdentitySync(target); if (owned.dev === current.dev && owned.ino === current.ino && owned.type === current.type && !current.symlink) return target; } catch {}
  if (!owned.parentChain || !owned.basename) return null; const parent = resolveAncestorChainPath(owned.parentChain); if (!parent) return null; const relocated = path.join(parent, owned.basename);
  try { const current = pathIdentitySync(relocated); if (owned.dev === current.dev && owned.ino === current.ino && owned.type === current.type && !current.symlink) return relocated; } catch {}
  const matches = [];
  try {
    for (const name of fs.readdirSync(parent)) {
      const candidate = path.join(parent, name); try { const current = pathIdentitySync(candidate); if (owned.dev === current.dev && owned.ino === current.ino && owned.type === current.type && !current.symlink) matches.push(candidate); } catch {}
    }
  } catch { return null; }
  return matches.length === 1 ? matches[0] : null;
}
async function safeRemoveOwned(target, owned, recursive) {
  if (owned.pastPonr || owned.indeterminatePreserve) return; const located = locateOwnedPath(target, owned); if (located && (!owned.protectedDestination || path.resolve(located) !== path.resolve(owned.protectedDestination))) await fsp.rm(located, { recursive, force: false });
}

export function publicBeforeAfterPins(publicState) { return structuredClone(publicState.publicByteHashes); }

const PROCESS_REQUIRED = Object.freeze({
  'sam-goal-review-bundle-manifest-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'mode', 'actorPseudonymSha256', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'immutableAssets', 'runtimeExecutableLogicalPath', 'launcherLogicalPath', 'processDecoderLogicalPaths', 'immutableAssetSetSha256', 'mutableLogicalRoots'],
  'sam-goal-review-access-evidence-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'mode', 'actorPseudonymSha256', 'presentationContractSha256', 'bundleManifestByteSha256', 'immutableAssetSetSha256', 'fixedInputSetSha256', 'sessionSeedByteSha256', 'sessionFinalStateByteSha256', 'editJournalByteSha256', 'actorAttestationByteSha256', 'filesystemAllowlist', 'networkAllowlist', 'actualOpenEvents', 'cspHeaders', 'negativeProbeResults', 'outsideInputAttestation'],
  'sam-goal-review-edit-journal-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'mode', 'actorPseudonymSha256', 'bundleManifestByteSha256', 'events'],
  'sam-goal-review-worksheet-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'mode', 'actorPseudonymSha256', 'bundleManifestByteSha256', 'sourceBinding', 'rulebookByteSha256', 'windows', 'rows'],
  'sam-goal-review-export-receipt-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'role', 'actorPseudonymSha256', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'bundleManifestByteSha256', 'accessEvidenceByteSha256', 'editJournalByteSha256', 'formalReviewByteSha256', 'formalReviewCanonicalSha256', 'validatorInterfaceId', 'validatorExitCode', 'validatorStdoutByteSha256', 'validatorStdoutBase64', 'sessionTreeSha256'],
  'sam-goal-source-first-c0-ledger-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'adjudicatorPseudonymSha256', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'bundleManifestByteSha256', 'accessEvidenceByteSha256', 'editJournalByteSha256', 'sourceOnly', 'abArtifactsObserved', 'windows', 'rows', 'sessionTreeSha256'],
  'sam-goal-raw-ab-report-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'reviewAReceiptByteSha256', 'reviewBReceiptByteSha256', 'c0LedgerByteSha256', 'reviewAFormalByteSha256', 'reviewBFormalByteSha256', 'reviewAExportValidatorStdoutByteSha256', 'reviewBExportValidatorStdoutByteSha256', 'reviewAComparisonValidatorExitCode', 'reviewBComparisonValidatorExitCode', 'reviewAComparisonValidatorStdoutByteSha256', 'reviewBComparisonValidatorStdoutByteSha256', 'agreementInputRoles', 'c0UsedForAgreement', 'individualGateEvidence', 'agreementCells', 'agreementMacros', 'supportReacquireEvidence', 'disagreementCounts', 'gatePass'],
  'sam-goal-adjudication-reveal-receipt-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'adjudicatorPseudonymSha256', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'reviewAReceiptByteSha256', 'reviewBReceiptByteSha256', 'rawABReportByteSha256', 'c0LedgerByteSha256', 'revealBundleManifestByteSha256', 'accessPolicyByteSha256', 'immutableAssetSetSha256', 'initialSkeletonByteSha256', 'initialDecisionCount', 'initialUnsetDecisionCount'],
  'sam-goal-manual-deviation-evidence-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'adjudicatorPseudonymSha256', 'publicPins', 'sourceBinding', 'rulebookByteSha256', 'presentationContractSha256', 'reviewAReceiptByteSha256', 'reviewBReceiptByteSha256', 'rawABReportByteSha256', 'c0LedgerByteSha256', 'revealReceiptByteSha256', 'revealAccessEvidenceByteSha256', 'adjudicationJournalByteSha256', 'formalAdjudicationByteSha256', 'formalAdjudicationCanonicalSha256', 'records', 'revealSessionTreeSha256'],
  'sam-goal-manual-review-handoff-v1': ['artifactType', 'schemaVersion', 'authorityClass', 'compilerInput', 'p0Authority', 'cycleId', 'presentationContractSha256', 'reviewAReceiptByteSha256', 'reviewBReceiptByteSha256', 'rawABReportByteSha256', 'c0LedgerByteSha256', 'revealReceiptByteSha256', 'deviationEvidenceByteSha256', 'formalReviewAByteSha256', 'formalReviewBByteSha256', 'formalAdjudicationByteSha256', 'status', 'reviewASessionTreeSha256', 'reviewBSessionTreeSha256', 'c0SessionTreeSha256', 'revealSessionTreeSha256'],
});

const PRESENTATION_BOUND_PROCESS_TYPES = new Set([
  'sam-goal-review-bundle-manifest-v1',
  'sam-goal-review-access-evidence-v1',
  'sam-goal-review-export-receipt-v1',
  'sam-goal-source-first-c0-ledger-v1',
  'sam-goal-raw-ab-report-v1',
  'sam-goal-adjudication-reveal-receipt-v1',
  'sam-goal-manual-deviation-evidence-v1',
  'sam-goal-manual-review-handoff-v1',
]);

function exactManifestInventory(publicState, rulebookByteSha256) {
  const expected = new Map(); const add = (logicalPath, assetClass, executable = false, binding = {}) => expected.set(logicalPath, { assetClass, executable, ...binding });
  add('immutable/authority/evaluation-contract.json', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.evaluationContract });
  add('immutable/authority/label-schema.json', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.labelSchema });
  add('immutable/authority/authoring-schema.json', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.authoringSchema });
  add('immutable/authority/source-inventory.json', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.sourceInventory });
  add('immutable/authority/decoder-manifest.jsonl', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.decoderManifest });
  add('immutable/authority/sam-goal-manual-pack-v3.mjs', 'authority_snapshot', false, { sha256: publicState.publicByteHashes.manualPackCompiler });
  for (const source of publicState.sourceInventory.paired) add(`immutable/sources/${source.clipId}.mp4`, 'source_copy', false, { sha256: source.video.sha256, bytes: source.video.bytes });
  add('immutable/rulebook.md', 'owned_rulebook', false, { sha256: rulebookByteSha256 });
  for (const name of PROCESS_SCHEMA_NAMES) add(`immutable/schemas/${name}`, 'owned_process_schema');
  for (const name of VIEWER_ASSET_NAMES) add(`immutable/viewer/${name}`, 'owned_viewer');
  for (const name of LAUNCHER_ASSET_NAMES) add(name === 'launcher.mjs' ? 'immutable/launcher.mjs' : `immutable/${name}`, 'owned_launcher');
  add('immutable/decoder/exact-pts-decoder.mjs', 'process_decoder');
  add('immutable/runtime/node', 'runtime_executable', true);
  return expected;
}

export function validateProcessArtifact(document, publicState, expectedType = document?.artifactType, { expectedPresentationContractSha256 } = {}) {
  if (!PROCESS_REQUIRED[expectedType] || document?.artifactType !== expectedType) fail('process_artifact_type_invalid');
  if (PRESENTATION_BOUND_PROCESS_TYPES.has(expectedType)) {
    if (typeof document?.presentationContractSha256 !== 'string' || !SHA_RE.test(document.presentationContractSha256) || expectedPresentationContractSha256 !== undefined && document.presentationContractSha256 !== expectedPresentationContractSha256) fail('presentation_contract_mismatch');
  }
  const requiredFields = expectedType === 'sam-goal-review-edit-journal-v1' && document.mode === 'adjudication-reveal' ? [...PROCESS_REQUIRED[expectedType], 'revealReceiptByteSha256'] : PROCESS_REQUIRED[expectedType];
  assertExactKeys(document, requiredFields, 'process_artifact_not_closed'); assertProcessMarker(document);
  if (document.schemaVersion !== 1) fail('process_schema_version_invalid');
  if (Object.hasOwn(document, 'publicPins') && !deepEqual(document.publicPins, PUBLIC_PINS)) fail('process_public_pins_mismatch');
  if (Object.hasOwn(document, 'sourceBinding') && !deepEqual(document.sourceBinding, processSourceBinding(publicState))) fail('process_source_binding_mismatch');
  for (const [key, value] of Object.entries(document)) if (/Sha256$/u.test(key)) assertSha(value, `process_hash_invalid:${key}`);
  switch (expectedType) {
    case 'sam-goal-review-bundle-manifest-v1': {
      if (!['first', 'second', 'source-first-c0', 'adjudication-reveal'].includes(document.mode) || !Array.isArray(document.immutableAssets) || !document.immutableAssets.length) fail('bundle_manifest_invalid');
      const sorted = [...document.immutableAssets].sort((a, b) => rawUtf8Compare(a.logicalPath, b.logicalPath)); if (!deepEqual(sorted, document.immutableAssets) || new Set(sorted.map((x) => x.logicalPath)).size !== sorted.length || canonicalHash(sorted) !== document.immutableAssetSetSha256) fail('immutable_asset_set_invalid');
      const expectedInventory = exactManifestInventory(publicState, document.rulebookByteSha256);
      if (!deepEqual(sorted.map((asset) => asset.logicalPath), [...expectedInventory.keys()].sort(rawUtf8Compare))) fail('immutable_asset_inventory_invalid');
      for (const asset of sorted) {
        assertExactKeys(asset, ['logicalPath', 'bytes', 'sha256', 'mediaType', 'executable', 'assetClass'], 'immutable_asset_not_closed'); assertSha(asset.sha256);
        const expected = expectedInventory.get(asset.logicalPath); if (!expected || asset.assetClass !== expected.assetClass || asset.executable !== expected.executable || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || typeof asset.mediaType !== 'string' || !asset.mediaType) fail('immutable_asset_descriptor_invalid');
        if (expected.sha256 && asset.sha256 !== expected.sha256) fail('immutable_asset_public_binding_invalid'); if (expected.bytes !== undefined && asset.bytes !== expected.bytes) fail('immutable_asset_public_binding_invalid');
      }
      const decoders = sorted.filter((x) => x.assetClass === 'process_decoder').map((x) => x.logicalPath); if (!deepEqual(decoders, document.processDecoderLogicalPaths)) fail('process_decoder_set_invalid');
      if (document.runtimeExecutableLogicalPath !== 'immutable/runtime/node' || document.launcherLogicalPath !== 'immutable/launcher.mjs' || !deepEqual(document.processDecoderLogicalPaths, ['immutable/decoder/exact-pts-decoder.mjs']) || !deepEqual(document.mutableLogicalRoots, ['mutable']) || sorted.some((asset) => document.mutableLogicalRoots.some((root) => asset.logicalPath === root || asset.logicalPath.startsWith(`${root}/`)))) fail('bundle_manifest_runtime_or_mutable_invalid');
      break;
    }
    case 'sam-goal-review-access-evidence-v1':
      if (!['first', 'second', 'source-first-c0', 'adjudication-reveal'].includes(document.mode) || document.mode !== 'adjudication-reveal' && document.fixedInputSetSha256 !== fixedInputSetSha256([]) || !Array.isArray(document.actualOpenEvents) || !document.actualOpenEvents.length || !Array.isArray(document.negativeProbeResults) || !['host-repository', 'sibling-bundle', 'non-loopback'].every((name) => document.negativeProbeResults.some((x) => x.name === name && x.attempted === true && x.denied === true)) || document.outsideInputAttestation.actorDeclaredNoOutsideInput !== true || document.outsideInputAttestation.coordinatorProvidedRuntimeDataAfterSpawn !== false) fail('access_evidence_invalid');
      document.actualOpenEvents.forEach((event, index) => { if (event.sequence !== index + 1) fail('access_event_sequence_invalid'); }); break;
    case 'sam-goal-review-edit-journal-v1':
      if (!Array.isArray(document.events)) fail('edit_journal_invalid'); document.events.forEach((event, index) => { if (event.sequence !== index + 1) fail('edit_sequence_invalid'); if (['navigate', 'playback'].includes(event.action) && Object.hasOwn(event, 'value')) fail('navigation_mutation_forbidden'); }); break;
    case 'sam-goal-review-worksheet-v1': validateWorksheet(document, publicState); break;
    case 'sam-goal-review-export-receipt-v1': {
      if (!['first', 'second'].includes(document.role) || document.validatorInterfaceId !== 'sam_goal.manual_pack_compiler_v3/manual-pack-review-validator-cli' || document.validatorExitCode !== 0) fail('review_receipt_invalid');
      const stdout = Buffer.from(document.validatorStdoutBase64, 'base64'); if (stdout.toString('base64') !== document.validatorStdoutBase64 || sha256(stdout) !== document.validatorStdoutByteSha256) fail('validator_stdout_binding_invalid'); break;
    }
    case 'sam-goal-source-first-c0-ledger-v1': {
      if (document.sourceOnly !== true || document.abArtifactsObserved !== false || document.rows.length !== 6711 || containsUnset(document.rows) || containsUnset(document.windows)) fail('c0_ledger_invalid');
      const synthetic = {
        artifactType: 'sam-goal-review-worksheet-v1', schemaVersion: 1, ...PROCESS_MARKER,
        cycleId: document.cycleId, mode: 'source-first-c0', actorPseudonymSha256: document.adjudicatorPseudonymSha256,
        bundleManifestByteSha256: document.bundleManifestByteSha256, sourceBinding: document.sourceBinding, rulebookByteSha256: document.rulebookByteSha256,
        windows: document.windows.map((window) => ({ ...structuredClone(window), origin: window.purposeTags?.includes('full_clip_denominator') ? 'structural_base' : 'actor_overlay' })), rows: structuredClone(document.rows),
      };
      validateWorksheet(synthetic, publicState, { requireComplete: true, expectedMode: 'source-first-c0' }); break;
    }
    case 'sam-goal-raw-ab-report-v1':
      if (!deepEqual(document.agreementInputRoles, ['first', 'second']) || document.c0UsedForAgreement !== false || document.reviewAComparisonValidatorExitCode !== 0 || document.reviewBComparisonValidatorExitCode !== 0 || !Array.isArray(document.agreementCells) || !deepEqual(document.agreementCells.map(({ family, clipId, field }) => ({ family, clipId, field })), rawAgreementCellRegistry(publicState)) || document.agreementMacros.thresholds.presencePersonStateKappa !== 0.99 || document.agreementMacros.thresholds.contactKappa !== 0.9 || document.agreementMacros.thresholds.observabilityKappa !== 0.95) fail('raw_ab_report_invalid'); assertRawReportSemantics(document, publicState); break;
    case 'sam-goal-adjudication-reveal-receipt-v1':
      if (document.initialDecisionCount !== document.initialUnsetDecisionCount) fail('reveal_unset_count_mismatch'); break;
    case 'sam-goal-manual-deviation-evidence-v1':
      if (!Array.isArray(document.records)) fail('deviation_records_invalid'); for (const record of document.records) validateDeviationRecord(record); break;
    case 'sam-goal-manual-review-handoff-v1': if (document.status !== 'ready_for_manual_pack_compiler') fail('handoff_status_invalid'); break;
    default: break;
  }
  return true;
}
