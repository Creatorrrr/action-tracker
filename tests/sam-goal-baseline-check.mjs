import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS = path.join(REPO_ROOT, "scripts/sam-goal-baseline.mjs");
const AGREEMENT_RUNNER = path.join(REPO_ROOT, "scripts/avatar-motion-agreement-check.mjs");
const SCHEMA = JSON.parse(readFileSync(path.join(REPO_ROOT, "tests/fixtures/sam-goal-v2/baseline-schema.json"), "utf8"));
const CLIP_IDS = [
  "arms-crossed",
  "csi-pose",
  "dance-16x9-padded",
  "jujae-regression-0-16_5",
  "shorts-keGbIts0CA0-16x9-padded",
  "shorts-new-dance-E9_h_ZW5z0U-16x9-padded",
  "shorts-vc0GDveRIp0-16x9-padded",
];

function write(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}

function spawnHarness(args, env = {}) {
  return spawnSync(process.execPath, [HARNESS, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

function assertIndexShape(index) {
  for (const key of SCHEMA.required) {
    assert.ok(Object.hasOwn(index, key), `missing schema key ${key}`);
  }
  assert.equal(index.schemaVersion, 1);
  assert.match(index.runIdentityHash, /^[a-f0-9]{64}$/);
  assert.equal(index.cells.length, index.requested.expectedCellCount);
  for (const cell of index.cells) {
    assert.match(cell.identityHash, /^[a-f0-9]{64}$/);
    assert.ok(cell.commands.adapter.length > 2);
    assert.ok(cell.commands.agreement.length > 2);
    assert.ok(cell.commands.compare.length > 2);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "sam goal baseline "));
const clipRoot = path.join(tempRoot, "clips with spaces");
const teacherRoot = path.join(tempRoot, "teachers");
const clips = CLIP_IDS.map((id, index) => {
  const teacherDir = path.join(teacherRoot, id);
  const fps = index % 2 === 0 ? 23.976 : 59.94;
  return {
    id,
    fps,
    media: {
      codec: "fixture",
      width: 1920,
      height: 1080,
      averageFrameRate: String(fps),
      sourceHz: fps,
      timeBase: "1/90000",
      durationSec: 0.01,
    },
    video: write(path.join(clipRoot, `${id}.mp4`), `video-${id}`),
    teacherDir,
    teacherRaw: write(path.join(teacherDir, "skeletons_mhr70.jsonl"), `${JSON.stringify({ frame_index: 0 })}\n`),
    teacherMetadata: write(path.join(teacherDir, "metadata_mhr70.json"), JSON.stringify({ id })),
    teacherSummary: write(path.join(teacherDir, "summary.json"), JSON.stringify({
      source_frame_count: 1,
      processed_frames: 1,
      total_person_predictions: 1,
      detection_misses: 0,
      every_n_frames: 1,
    })),
  };
});
const unpairedVideo = write(path.join(clipRoot, "jujae.mp4"), "unpaired");
const manifestPath = write(
  path.join(tempRoot, "clip-manifest.json"),
  JSON.stringify({
    clips,
    unpaired: [{
      id: "jujae-full",
      video: unpairedVideo,
      reason: "teacher_missing",
      media: {
        codec: "fixture",
        width: 1920,
        height: 1080,
        averageFrameRate: "30",
        sourceHz: 30,
        timeBase: "1/90000",
        durationSec: 0.01,
      },
    }],
  }),
);
const modelPath = write(path.join(tempRoot, "models", "fixture model.glb"), "model-v1");
const evaluationContract = write(path.join(tempRoot, "evaluation-contract.json"), JSON.stringify({ version: 1 }));

const agreementRunnerSource = readFileSync(AGREEMENT_RUNNER, "utf8");
const initializationIndex = agreementRunnerSource.indexOf("const initializationPoseFrames = Math.max(1, warmupPoseFrames)");
const rewindIndex = agreementRunnerSource.indexOf("await seekVideoTime(client, 0)", initializationIndex);
const disableLoopIndex = agreementRunnerSource.indexOf("video.loop = false", rewindIndex);
const clearMeasurementIndex = agreementRunnerSource.indexOf("clearAppPerformanceSamples", disableLoopIndex);
const startRecordingIndex = agreementRunnerSource.indexOf("startMotionRecording", clearMeasurementIndex);
const resumePlaybackIndex = agreementRunnerSource.indexOf("?.play?.()", startRecordingIndex);
assert.ok(initializationIndex >= 0, "runner must wait for asynchronous video/model initialization");
assert.ok(rewindIndex > initializationIndex, "runner must rewind after initialization");
assert.ok(disableLoopIndex > rewindIndex, "runner must disable looping after the asynchronous file loader completes");
assert.ok(clearMeasurementIndex > disableLoopIndex, "runner must clear metrics only after rewind");
assert.ok(startRecordingIndex > clearMeasurementIndex, "runner must start recording after measurement reset");
assert.ok(resumePlaybackIndex > startRecordingIndex, "runner must resume playback after recording starts");

const adapterScript = write(path.join(tempRoot, "fake-adapter.mjs"), `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const input = args[args.indexOf("--input") + 1];
const output = args[args.indexOf("--output") + 1];
const sourceCount = readFileSync(input,"utf8").split(/\\r?\\n/).filter(Boolean).length;
const frameCount = process.env.FAKE_ADAPTER_PARTIAL === "1" ? 1 : sourceCount;
mkdirSync(path.dirname(output), { recursive: true });
const rows = [{type:"action-tracker-motion-recording",frameCount,droppedFrames:0,source:{sourceFrameCount:sourceCount}}];
for(let index=0;index<frameCount;index+=1) rows.push({type:"action-tracker-motion-frame",frame:{timestamp:index}});
writeFileSync(output, rows.map((row)=>JSON.stringify(row)).join("\\n")+"\\n");
`);
const agreementScript = write(path.join(tempRoot, "fake-agreement.mjs"), `
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
const recording = args[args.indexOf("--recording-output") + 1];
if (process.env.FAKE_TIMEOUT === "1") await new Promise((resolve) => setTimeout(resolve, 3000));
if (process.env.FAKE_DELAYED_PARTIAL === "1") await new Promise((resolve) => setTimeout(resolve, 3000));
if (process.env.FAKE_NO_WRITE === "1") process.exit(0);
mkdirSync(path.dirname(output), { recursive: true });
mkdirSync(path.dirname(recording), { recursive: true });
const partial = process.env.FAKE_PARTIAL === "1";
const skipped = process.env.FAKE_SKIPPED === "1";
const delegateFallback = process.env.FAKE_DELEGATE_FALLBACK === "1";
writeFileSync(output, JSON.stringify({
  failures:[],
  warnings:partial?["measurement completion timed out; saved partial recording"]:[],
  models:[{
    skipped,
    status:{avatar:"Ready",model:"Ready"},
    summary:{
      framesWithPose:1,
      detectorDelegateRequested:"GPU",
      detectorDelegatePose:delegateFallback?"CPU":"GPU",
      detectorDelegateFallbackReasons:delegateFallback?{pose:"gpu unavailable"}:{},
      detectorDelegateLastFallbackReason:"",
      trackingWorkerRequested:true,
      trackingWorkerActive:true,
      trackingWorkerStatus:"ready",
      trackingWorkerErrors:0,
      trackingWorkerFallbacks:0,
      trackingWorkerFallbackReason:"",
      pumpMode:"rvfc",
      avatarSmoothingMode:"retarget",
      avatarRetargetMode:"strict"
    }
  }]
}));
writeFileSync(recording,
  JSON.stringify({type:"action-tracker-motion-recording",frameCount:1,droppedFrames:0,source:{inputKind:"video"}})+"\\n"+
  JSON.stringify({type:"action-tracker-motion-frame",frame:{timestamp:0,sourceMeta:{videoTime:0.009}}})+"\\n"
);
`);
const compareScript = write(path.join(tempRoot, "fake-compare.mjs"), `
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
const live = args[args.indexOf("--live") + 1];
const offline = args[args.indexOf("--offline") + 1];
const count = (file) => readFileSync(file,"utf8").split(/\\r?\\n/).filter(Boolean).length-1;
const liveFrames=count(live); const offlineFrames=count(offline); const pairedFrames=Math.min(liveFrames,offlineFrames);
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({summary:{liveFrames,offlineFrames,pairedFrames,pairedRatio:pairedFrames/liveFrames,offlineUsageRatio:pairedFrames/offlineFrames}}));
`);

const common = [
  "--clip-manifest", manifestPath,
  "--rig-model", `Xbot=${modelPath}`,
  "--rig-model", `Soldier=${modelPath}`,
  "--rig-model", `Polydancer=${modelPath}`,
  "--agreement-script", agreementScript,
  "--adapter-script", adapterScript,
  "--compare-script", compareScript,
  "--browser-version", "Fixture Chrome 1",
  "--device-profile", "fixture-device",
];

const dryOutput = path.join(tempRoot, "dry output");
const dryRun = spawnHarness(["--dry-run", "--output-dir", dryOutput, ...common]);
assert.equal(dryRun.status, 0, dryRun.stderr);
const dryIndex = JSON.parse(readFileSync(path.join(dryOutput, "dry-run-index.json"), "utf8"));
assertIndexShape(dryIndex);
assert.equal(dryIndex.clips.length, 7);
assert.deepEqual(dryIndex.clips.map(({ id }) => id), CLIP_IDS);
assert.equal(dryIndex.unpaired.length, 1);
assert.equal(dryIndex.unpaired[0].id, "jujae-full");
assert.equal(dryIndex.rigs.length, 3);
assert.equal(dryIndex.cells.length, 21);
assert.equal(dryIndex.status, "planned");
assert.equal(dryIndex.clips[0].fps, 23.976);
assert.equal(dryIndex.clips[1].fps, 59.94);
assert.equal(dryIndex.clips[0].video.media.width, 1920);
assert.equal(dryIndex.clips[0].video.media.timeBase, "1/90000");
assert.equal(dryIndex.unpaired[0].video.media.sourceHz, 30);

const repeatedDryRun = spawnHarness(["--dry-run", "--output-dir", dryOutput, ...common]);
assert.equal(repeatedDryRun.status, 0, repeatedDryRun.stderr);
const repeatedDryIndex = JSON.parse(readFileSync(path.join(dryOutput, "dry-run-index.json"), "utf8"));
assert.equal(repeatedDryIndex.runIdentityHash, dryIndex.runIdentityHash);
assert.deepEqual(
  repeatedDryIndex.cells.map(({ identityHash }) => identityHash),
  dryIndex.cells.map(({ identityHash }) => identityHash),
);

const runOutput = path.join(tempRoot, "single output");
const runIndexPath = path.join(runOutput, "index.json");
const singleArgs = [
  "--evaluation-contract", evaluationContract,
  "--output-dir", runOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  "--min-pose-frames", "1",
  ...common,
];
const single = spawnHarness(singleArgs);
assert.equal(single.status, 0, single.stderr);
const singleIndex = JSON.parse(readFileSync(runIndexPath, "utf8"));
assertIndexShape(singleIndex);
assert.equal(singleIndex.status, "completed");
assert.equal(singleIndex.cells.length, 1);
assert.equal(singleIndex.cells[0].status, "completed");
for (const artifact of Object.values(singleIndex.cells[0].artifacts)) {
  assert.equal(artifact.exists, true);
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
}

const resumed = spawnHarness(["--resume", ...singleArgs]);
assert.equal(resumed.status, 0, resumed.stderr);
const resumedIndex = JSON.parse(readFileSync(runIndexPath, "utf8"));
assert.equal(resumedIndex.cells[0].resumed, true);
assert.equal(resumedIndex.cells[0].sharedTeacherRegenerated, false);

writeFileSync(resumedIndex.cells[0].artifacts.teacherRecording.path, "tampered teacher recording");
const repairedArtifact = spawnHarness(["--resume", ...singleArgs]);
assert.equal(repairedArtifact.status, 0, repairedArtifact.stderr);
const repairedArtifactIndex = JSON.parse(readFileSync(runIndexPath, "utf8"));
// The shared teacher artifact is deterministically regenerated first; once its
// original hash is restored, the cell-specific outputs are safe to reuse.
assert.equal(repairedArtifactIndex.cells[0].resumed, true);
assert.equal(repairedArtifactIndex.cells[0].sharedTeacherRegenerated, true);
assert.equal(
  repairedArtifactIndex.cells[0].artifacts.teacherRecording.sha256,
  resumedIndex.cells[0].artifacts.teacherRecording.sha256,
);

writeFileSync(modelPath, "model-v2");
const drift = spawnHarness(["--resume", ...singleArgs]);
assert.notEqual(drift.status, 0);
assert.match(drift.stderr, /hash_drift:run_identity/);
writeFileSync(modelPath, "model-v1");

const partialOutput = path.join(tempRoot, "partial output");
const partial = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--output-dir", partialOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  ...common,
], { FAKE_PARTIAL: "1" });
assert.notEqual(partial.status, 0);
const partialIndex = JSON.parse(readFileSync(path.join(partialOutput, "index.json"), "utf8"));
assert.equal(partialIndex.cells[0].status, "failed");
assert.match(partialIndex.cells[0].reason, /avatar_report_partial/);

const adapterPartialManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
adapterPartialManifest.clips[0].teacherRaw = write(
  path.join(tempRoot, "adapter-partial", "skeletons_mhr70.jsonl"),
  Array.from({ length: 10 }, (_, frame_index) => JSON.stringify({ frame_index })).join("\n") + "\n",
);
adapterPartialManifest.clips[0].teacherSummary = write(
  path.join(tempRoot, "adapter-partial", "summary.json"),
  JSON.stringify({
    source_frame_count: 10,
    processed_frames: 10,
    total_person_predictions: 10,
    detection_misses: 0,
    every_n_frames: 1,
  }),
);
const adapterPartialManifestPath = write(
  path.join(tempRoot, "adapter-partial-manifest.json"),
  JSON.stringify(adapterPartialManifest),
);
const adapterPartialOutput = path.join(tempRoot, "adapter partial output");
const adapterPartial = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--clip-manifest", adapterPartialManifestPath,
  "--output-dir", adapterPartialOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  ...common.slice(2),
], { FAKE_ADAPTER_PARTIAL: "1" });
assert.notEqual(adapterPartial.status, 0);
const adapterPartialIndex = JSON.parse(readFileSync(path.join(adapterPartialOutput, "index.json"), "utf8"));
assert.match(adapterPartialIndex.cells[0].reason, /teacher_recording_coverage_mismatch/);

const skippedOutput = path.join(tempRoot, "skipped output");
const skipped = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--output-dir", skippedOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  ...common,
], { FAKE_SKIPPED: "1" });
assert.notEqual(skipped.status, 0);
const skippedIndex = JSON.parse(readFileSync(path.join(skippedOutput, "index.json"), "utf8"));
assert.equal(skippedIndex.cells[0].status, "failed");
assert.match(skippedIndex.cells[0].reason, /avatar_report_skipped/);

const fallbackOutput = path.join(tempRoot, "delegate fallback output");
const fallback = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--output-dir", fallbackOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  ...common,
], { FAKE_DELEGATE_FALLBACK: "1" });
assert.notEqual(fallback.status, 0);
const fallbackIndex = JSON.parse(readFileSync(path.join(fallbackOutput, "index.json"), "utf8"));
assert.match(fallbackIndex.cells[0].reason, /avatar_report_delegate_mismatch|avatar_report_delegate_fallback/);

const slowManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
slowManifest.clips[0].media.durationSec = 2;
const slowManifestPath = write(path.join(tempRoot, "slow-manifest.json"), JSON.stringify(slowManifest));
const silentPartialOutput = path.join(tempRoot, "silent partial output");
const silentPartial = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--clip-manifest", slowManifestPath,
  "--output-dir", silentPartialOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  ...common.slice(2),
], { FAKE_DELAYED_PARTIAL: "1" });
assert.notEqual(silentPartial.status, 0);
const silentPartialIndex = JSON.parse(readFileSync(path.join(silentPartialOutput, "index.json"), "utf8"));
assert.match(silentPartialIndex.cells[0].reason, /live_recording_source_pts_partial/);

const staleOutput = path.join(tempRoot, "stale output");
const staleArgs = [
  "--evaluation-contract", evaluationContract,
  "--output-dir", staleOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  "--timeout-ms", "5000",
  "--min-pose-frames", "1",
  ...common,
];
const staleSeed = spawnHarness(staleArgs);
assert.equal(staleSeed.status, 0, staleSeed.stderr);
const staleSeedIndex = JSON.parse(readFileSync(path.join(staleOutput, "index.json"), "utf8"));
writeFileSync(staleSeedIndex.cells[0].artifacts.liveRecording.path, "stale recording");
const staleAttempt = spawnHarness(["--resume", ...staleArgs], { FAKE_NO_WRITE: "1" });
assert.notEqual(staleAttempt.status, 0);
const staleIndex = JSON.parse(readFileSync(path.join(staleOutput, "index.json"), "utf8"));
assert.equal(staleIndex.cells[0].status, "failed");
assert.match(staleIndex.cells[0].reason, /recording_missing/);

const timeoutOutput = path.join(tempRoot, "timeout output");
const timeout = spawnHarness([
  "--evaluation-contract", evaluationContract,
  "--output-dir", timeoutOutput,
  "--clip", "arms-crossed",
  "--rig", "Xbot",
  // Leave enough time for the adapter's Node process to start; the agreement
  // fixture intentionally sleeps for three seconds and must be the timed-out stage.
  "--timeout-ms", "1500",
  ...common,
], { FAKE_TIMEOUT: "1" });
assert.notEqual(timeout.status, 0);
const timeoutIndex = JSON.parse(readFileSync(path.join(timeoutOutput, "index.json"), "utf8"));
assert.equal(timeoutIndex.cells[0].status, "failed");
assert.match(timeoutIndex.cells[0].reason, /agreement_timeout/);

const missingManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
missingManifest.clips[0].video = path.join(tempRoot, "missing.mp4");
const missingManifestPath = write(path.join(tempRoot, "missing-manifest.json"), JSON.stringify(missingManifest));
const missing = spawnHarness([
  "--dry-run",
  "--clip-manifest", missingManifestPath,
  "--output-dir", path.join(tempRoot, "missing output"),
  "--rig-model", `Xbot=${modelPath}`,
  "--rig-model", `Soldier=${modelPath}`,
  "--rig-model", `Polydancer=${modelPath}`,
]);
assert.notEqual(missing.status, 0);
assert.match(missing.stderr, /missing_input/);

console.log("SAM goal baseline harness check passed.");
