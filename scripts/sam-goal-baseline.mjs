#!/usr/bin/env node

import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

const DEFAULT_CLIPS = [
  "arms-crossed",
  "csi-pose",
  "dance-16x9-padded",
  "jujae-regression-0-16_5",
  "shorts-keGbIts0CA0-16x9-padded",
  "shorts-new-dance-E9_h_ZW5z0U-16x9-padded",
  "shorts-vc0GDveRIp0-16x9-padded",
].map((id) => ({
  id,
  video: `output/test-videos/${id}.mp4`,
  teacherDir: `sam-3d-body-skeletons/${id}`,
  teacherRaw: `sam-3d-body-skeletons/${id}/skeletons_mhr70.jsonl`,
  teacherMetadata: `sam-3d-body-skeletons/${id}/metadata_mhr70.json`,
  teacherSummary: `sam-3d-body-skeletons/${id}/summary.json`,
}));

const DEFAULT_UNPAIRED = [
  {
    id: "jujae-full",
    video: "output/test-videos/jujae.mp4",
    reason: "teacher_missing",
  },
];

const DEFAULT_RIGS = [
  { id: "Xbot", label: "Xbot", model: "assets/models/Xbot.glb" },
  { id: "Soldier", label: "Soldier", model: "assets/models/ratio-candidates/soldier.glb" },
  { id: "Polydancer", label: "Polydancer", model: "assets/models/anime-candidates/polydancer.vrm" },
];

const DEFAULTS = {
  outputDir: "output/sam-goal-baseline",
  delegate: "gpu",
  trackingWorker: "on",
  playbackRate: 1,
  pump: "rvfc",
  faceTracking: "off",
  smoothing: "retarget",
  avatarRetarget: "strict",
  warmupPoseFrames: 0,
  minPoseFrames: 1_000_000_000,
  timeoutMs: 240_000,
  agreementScript: "scripts/avatar-motion-agreement-check.mjs",
  adapterScript: "scripts/hmr-jsonl-adapter.mjs",
  compareScript: "scripts/motion-recording-compare.mjs",
};

const COMPLETENESS = Object.freeze({
  liveFinalSourcePtsRatioMin: 0.9,
  comparisonPairedRatioMin: 0.95,
  recordingReportGapRatioMax: 0.05,
  recordingReportGapFramesMin: 5,
});

function usage() {
  console.log(`Usage:
  node scripts/sam-goal-baseline.mjs --dry-run [options]
  node scripts/sam-goal-baseline.mjs --evaluation-contract <path> [options]

Selection:
  --clip <id>                     Repeat to select clips; default is all seven paired clips.
  --rig <id>                      Repeat to select rigs; default is Xbot, Soldier, Polydancer.
  --rig-model <id=path>           Override/add a rig model path. Repeatable.
  --clip-manifest <path>          Override clip inventory for fixture or controlled runs.

Artifacts and execution:
  --output-dir <path>             Default: ${DEFAULTS.outputDir}
  --index <path>                  Default: <output-dir>/index.json (dry-run-index.json for dry-run).
  --evaluation-contract <path>    Required for non-dry runs.
  --resume                        Resume only identity-matching completed cells.
  --dry-run                       Hash and plan inputs without launching child pipelines.
  --agreement-script <path>       Default: ${DEFAULTS.agreementScript}
  --adapter-script <path>         Default: ${DEFAULTS.adapterScript}
  --compare-script <path>         Default: ${DEFAULTS.compareScript}

Runtime profile:
  --delegate <cpu|gpu>            Default: ${DEFAULTS.delegate}
  --tracking-worker <on|off>      Default: ${DEFAULTS.trackingWorker}
  --playback-rate <n>             Default: ${DEFAULTS.playbackRate}
  --pump <auto|rvfc|raf>          Default: ${DEFAULTS.pump}
  --face-tracking <on|off>        Default: ${DEFAULTS.faceTracking}
  --smoothing <off|retarget|strong>
  --avatar-retarget <legacy|strict>
  --warmup-pose-frames <n>
  --min-pose-frames <n>           Huge default forces playback to video end.
  --timeout-ms <n>                Per child process timeout.
  --device-profile <label>        Human-readable fixed target profile.
  --browser-version <label>       Explicit browser identity override.
  --help`);
}

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    clips: [],
    rigs: [],
    rigModels: [],
    dryRun: false,
    resume: false,
    clipManifest: null,
    evaluationContract: null,
    index: null,
    deviceProfile: "",
    browserVersion: "",
  };
  const valueOptions = new Map([
    ["--clip", "clips"],
    ["--rig", "rigs"],
    ["--rig-model", "rigModels"],
    ["--clip-manifest", "clipManifest"],
    ["--output-dir", "outputDir"],
    ["--index", "index"],
    ["--evaluation-contract", "evaluationContract"],
    ["--delegate", "delegate"],
    ["--tracking-worker", "trackingWorker"],
    ["--playback-rate", "playbackRate"],
    ["--pump", "pump"],
    ["--face-tracking", "faceTracking"],
    ["--smoothing", "smoothing"],
    ["--avatar-retarget", "avatarRetarget"],
    ["--warmup-pose-frames", "warmupPoseFrames"],
    ["--min-pose-frames", "minPoseFrames"],
    ["--timeout-ms", "timeoutMs"],
    ["--agreement-script", "agreementScript"],
    ["--adapter-script", "adapterScript"],
    ["--compare-script", "compareScript"],
    ["--device-profile", "deviceProfile"],
    ["--browser-version", "browserVersion"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--resume") {
      options.resume = true;
      continue;
    }
    const key = valueOptions.get(arg);
    if (!key) {
      throw new Error(`unknown_argument:${arg}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${arg}`);
    }
    index += 1;
    if (Array.isArray(options[key])) {
      options[key].push(value);
    } else {
      options[key] = value;
    }
  }
  for (const key of ["playbackRate", "warmupPoseFrames", "minPoseFrames", "timeoutMs"]) {
    options[key] = Number(options[key]);
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`invalid_number:${key}`);
    }
  }
  if (options.timeoutMs < 1) {
    throw new Error("invalid_number:timeoutMs");
  }
  if (!new Set(["cpu", "gpu"]).has(String(options.delegate).toLowerCase())) {
    throw new Error("invalid_delegate");
  }
  for (const key of ["trackingWorker", "faceTracking"]) {
    if (!new Set(["on", "off"]).has(String(options[key]).toLowerCase())) {
      throw new Error(`invalid_toggle:${key}`);
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
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

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  const hash = createHash("sha256");
  hash.update(readFileSync(filePath));
  return hash.digest("hex");
}

function assertReadableFile(filePath, label) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`missing_input:${label}:${repoRelative(filePath)}`);
  }
}

function fileIdentity(filePath) {
  assertReadableFile(filePath, "file");
  const stats = statSync(filePath);
  return {
    path: repoRelative(filePath),
    bytes: stats.size,
    sha256: sha256File(filePath),
  };
}

function compositeIdentity(files) {
  const entries = files.map((filePath) => fileIdentity(filePath));
  return {
    files: entries,
    sha256: sha256Text(stableStringify(entries.map(({ path: filePath, bytes, sha256 }) => ({ filePath, bytes, sha256 })))),
  };
}

function countNonEmptyLines(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter((line) => line.trim()).length;
}

function writeJsonAtomic(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, filePath);
}

function gitText(args, fallback = "") {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : fallback;
}

function gitBuffer(args) {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git_identity_failed:${args.join(" ")}`);
  return result.stdout;
}

function worktreeIdentity() {
  const status = gitBuffer(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const trackedDiff = gitBuffer(["diff", "--binary", "--no-ext-diff"]);
  const stagedDiff = gitBuffer(["diff", "--cached", "--binary", "--no-ext-diff"]);
  const untrackedPaths = gitBuffer(["ls-files", "--others", "--exclude-standard", "-z"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const untracked = untrackedPaths.map((relativePath) => {
    const absolutePath = path.resolve(REPO_ROOT, relativePath);
    const identity = fileIdentity(absolutePath);
    return { path: relativePath, bytes: identity.bytes, sha256: identity.sha256 };
  });
  const evidence = {
    statusSha256: sha256Text(status),
    trackedDiffSha256: sha256Text(trackedDiff),
    stagedDiffSha256: sha256Text(stagedDiff),
    untrackedTreeSha256: sha256Text(stableStringify(untracked)),
    untrackedFileCount: untracked.length,
  };
  return {
    dirty: status.length > 0,
    dirtyFingerprint: sha256Text(stableStringify(evidence)),
    ...evidence,
  };
}

function detectBrowserVersion() {
  const candidates = process.platform === "darwin"
    ? [["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--version"]]]
    : [["google-chrome", ["--version"]], ["chromium", ["--version"]]];
  for (const [binary, args] of candidates) {
    const result = spawnSync(binary, args, { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  }
  return "unknown";
}

function detectFfprobeVersion() {
  const result = spawnSync("ffprobe", ["-version"], { encoding: "utf8" });
  if (result.status !== 0) return "unknown";
  return result.stdout.split(/\r?\n/, 1)[0]?.trim() || "unknown";
}

function rateToNumber(value) {
  if (typeof value === "number") return value;
  const [numerator, denominator = "1"] = String(value || "").split("/");
  const result = Number(numerator) / Number(denominator);
  return Number.isFinite(result) && result > 0 ? result : null;
}

function normalizeDeclaredMedia(raw) {
  const media = raw.media || {};
  const sourceHz = rateToNumber(media.sourceHz ?? raw.fps);
  const width = Number(media.width ?? raw.width);
  const height = Number(media.height ?? raw.height);
  const durationSec = Number(media.durationSec ?? raw.durationSec);
  if (!(sourceHz > 0 && width > 0 && height > 0 && durationSec > 0)) return null;
  return {
    codec: String(media.codec || "declared"),
    width,
    height,
    averageFrameRate: String(media.averageFrameRate || sourceHz),
    sourceHz,
    timeBase: String(media.timeBase || "declared"),
    durationSec,
  };
}

function probeVideo(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,time_base,duration:format=duration",
    "-of", "json",
    filePath,
  ], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`media_probe_failed:${repoRelative(filePath)}:${result.stderr.trim() || result.error?.message || "unknown"}`);
  }
  const value = JSON.parse(result.stdout);
  const stream = value.streams?.[0];
  const sourceHz = rateToNumber(stream?.avg_frame_rate);
  const durationSec = Number(stream?.duration ?? value.format?.duration);
  if (!stream || !(stream.width > 0 && stream.height > 0 && sourceHz > 0 && durationSec > 0)) {
    throw new Error(`media_probe_incomplete:${repoRelative(filePath)}`);
  }
  return {
    codec: String(stream.codec_name || "unknown"),
    width: Number(stream.width),
    height: Number(stream.height),
    averageFrameRate: String(stream.avg_frame_rate),
    sourceHz,
    timeBase: String(stream.time_base || "unknown"),
    durationSec,
  };
}

function videoIdentity(filePath, raw) {
  const identity = fileIdentity(filePath);
  const media = normalizeDeclaredMedia(raw) || probeVideo(filePath);
  return { ...identity, media };
}

function loadClipManifest(options) {
  if (!options.clipManifest) {
    return { clips: DEFAULT_CLIPS, unpaired: DEFAULT_UNPAIRED };
  }
  const manifestPath = resolveRepo(options.clipManifest);
  assertReadableFile(manifestPath, "clip_manifest");
  const value = readJson(manifestPath);
  if (!Array.isArray(value.clips) || !Array.isArray(value.unpaired)) {
    throw new Error("invalid_clip_manifest_shape");
  }
  return value;
}

function normalizeClip(raw) {
  const id = String(raw.id || "").trim();
  if (!id) {
    throw new Error("invalid_clip_id");
  }
  const teacherDir = raw.teacherDir || raw.teacher || `sam-3d-body-skeletons/${id}`;
  return {
    id,
    video: raw.video || `output/test-videos/${id}.mp4`,
    teacherDir,
    teacherRaw: raw.teacherRaw || path.join(teacherDir, "skeletons_mhr70.jsonl"),
    teacherMetadata: raw.teacherMetadata || path.join(teacherDir, "metadata_mhr70.json"),
    teacherSummary: raw.teacherSummary || path.join(teacherDir, "summary.json"),
    fps: raw.fps ?? null,
    media: raw.media || null,
  };
}

function normalizeUnpaired(raw) {
  const id = String(raw.id || "").trim();
  if (!id) throw new Error("invalid_unpaired_id");
  return {
    ...raw,
    id,
    video: raw.video || `output/test-videos/${id}.mp4`,
    reason: raw.reason || "teacher_missing",
  };
}

function selectedInventory(options) {
  const rawManifest = loadClipManifest(options);
  const allClips = rawManifest.clips.map(normalizeClip);
  const clipIds = new Set(allClips.map(({ id }) => id));
  if (clipIds.size !== allClips.length) {
    throw new Error("duplicate_clip_id");
  }
  const selectedIds = options.clips.length ? new Set(options.clips) : null;
  if (selectedIds) {
    for (const id of selectedIds) {
      if (!clipIds.has(id)) {
        throw new Error(`unknown_clip:${id}`);
      }
    }
  }
  const clips = selectedIds ? allClips.filter(({ id }) => selectedIds.has(id)) : allClips;

  const rigsById = new Map(DEFAULT_RIGS.map((rig) => [rig.id, { ...rig }]));
  for (const pair of options.rigModels) {
    const separator = pair.indexOf("=");
    if (separator < 1 || separator === pair.length - 1) {
      throw new Error(`invalid_rig_model:${pair}`);
    }
    const id = pair.slice(0, separator).trim();
    const model = pair.slice(separator + 1).trim();
    const existing = rigsById.get(id);
    rigsById.set(id, { id, label: existing?.label || id, model });
  }
  const selectedRigIds = options.rigs.length ? new Set(options.rigs) : null;
  if (selectedRigIds) {
    for (const id of selectedRigIds) {
      if (!rigsById.has(id)) {
        throw new Error(`unknown_rig:${id}`);
      }
    }
  }
  const rigs = [...rigsById.values()].filter(({ id }) => !selectedRigIds || selectedRigIds.has(id));
  return {
    allClips,
    clips,
    rigs,
    unpaired: rawManifest.unpaired.map(normalizeUnpaired),
    completeMatrixRequested: !selectedIds && !selectedRigIds,
  };
}

function runtimeConfig(options) {
  return {
    delegate: String(options.delegate).toLowerCase(),
    trackingWorker: String(options.trackingWorker).toLowerCase(),
    playbackRate: options.playbackRate,
    pump: options.pump,
    faceTracking: String(options.faceTracking).toLowerCase(),
    smoothing: options.smoothing,
    avatarRetarget: options.avatarRetarget,
    warmupPoseFrames: options.warmupPoseFrames,
    minPoseFrames: options.minPoseFrames,
    timeoutMs: options.timeoutMs,
    completeness: COMPLETENESS,
  };
}

function inputInventory(options, selection) {
  const clips = selection.allClips.map((clip) => {
    const video = resolveRepo(clip.video);
    const teacherFiles = [clip.teacherRaw, clip.teacherMetadata, clip.teacherSummary].map(resolveRepo);
    const source = videoIdentity(video, clip);
    const teacherSummary = readJson(teacherFiles[2]);
    const teacherStats = {
      rawLineCount: countNonEmptyLines(teacherFiles[0]),
      sourceFrameCount: Number(teacherSummary.source_frame_count),
      processedFrameCount: Number(teacherSummary.processed_frames),
      totalPersonPredictions: Number(teacherSummary.total_person_predictions),
      detectionMisses: Number(teacherSummary.detection_misses),
      everyNFrames: Number(teacherSummary.every_n_frames),
    };
    if (
      !Number.isInteger(teacherStats.rawLineCount)
      || teacherStats.rawLineCount < 1
      || !Number.isInteger(teacherStats.processedFrameCount)
      || teacherStats.processedFrameCount !== teacherStats.rawLineCount
      || !Number.isInteger(teacherStats.sourceFrameCount)
      || teacherStats.sourceFrameCount < teacherStats.processedFrameCount
      || teacherStats.everyNFrames !== 1
    ) {
      throw new Error(`teacher_raw_summary_mismatch:${clip.id}`);
    }
    return {
      id: clip.id,
      fps: source.media.sourceHz,
      video: source,
      teacher: compositeIdentity(teacherFiles),
      teacherStats,
      teacherPaths: {
        raw: repoRelative(resolveRepo(clip.teacherRaw)),
        metadata: repoRelative(resolveRepo(clip.teacherMetadata)),
        summary: repoRelative(resolveRepo(clip.teacherSummary)),
      },
    };
  });
  const unpaired = selection.unpaired.map((item) => ({
    id: item.id,
    reason: item.reason,
    video: videoIdentity(resolveRepo(item.video), item),
  }));
  const rigs = selection.rigs.map((rig) => ({
    ...rig,
    model: fileIdentity(resolveRepo(rig.model)),
  }));
  const evaluationContract = options.evaluationContract
    ? fileIdentity(resolveRepo(options.evaluationContract))
    : null;
  return { clips, unpaired, rigs, evaluationContract };
}

function commandIdentity(command) {
  return command.map((value) => repoRelative(value));
}

function artifactDescriptor(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    return { path: repoRelative(filePath), exists: false, bytes: 0, sha256: null };
  }
  const stats = statSync(filePath);
  return { path: repoRelative(filePath), exists: true, bytes: stats.size, sha256: sha256File(filePath) };
}

function runChild(command, { timeoutMs, stdoutPath, stderrPath }) {
  mkdirSync(path.dirname(stdoutPath), { recursive: true });
  const startedAtMs = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(stdoutPath, result.stdout || "");
  writeFileSync(stderrPath, result.stderr || "");
  return {
    command: commandIdentity(command),
    exitCode: result.status,
    signal: result.signal || null,
    timedOut: Boolean(result.error?.code === "ETIMEDOUT"),
    error: result.error ? String(result.error.message || result.error) : null,
    elapsedMs: Date.now() - startedAtMs,
    stdout: artifactDescriptor(stdoutPath),
    stderr: artifactDescriptor(stderrPath),
  };
}

function clearOutputFiles(filePaths) {
  for (const filePath of filePaths) {
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}

function findForbiddenPartialSignal(value, pathParts = []) {
  if (typeof value === "string" && /\b(timed out|timeout|partial|saved partial|no video frame)\b/i.test(value)) {
    return `${pathParts.join(".")}:${value}`;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenPartialSignal(value[index], [...pathParts, String(index)]);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findForbiddenPartialSignal(child, [...pathParts, key]);
      if (found) return found;
    }
  }
  return null;
}

function normalizeRuntimeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validateAvatarReport(filePath, { config, expectedDurationSec, execution, recordingFrameCount }) {
  const report = readJson(filePath);
  const videos = Array.isArray(report.videos) ? report.videos : [];
  const models = [
    ...(Array.isArray(report.models) ? report.models : []),
    ...videos.flatMap((video) => Array.isArray(video.models) ? video.models : []),
  ];
  if (report.skipped === true || videos.some((video) => video.skipped === true) || models.some((model) => model.skipped === true)) {
    throw new Error("avatar_report_skipped");
  }
  const failures = [
    ...(Array.isArray(report.failures) ? report.failures : []),
    ...(Array.isArray(report.videos)
      ? report.videos.flatMap((video) => Array.isArray(video.failures) ? video.failures : [])
      : []),
    ...models.flatMap((model) => Array.isArray(model.failures) ? model.failures : []),
  ];
  if (failures.length) {
    throw new Error(`avatar_report_failures:${failures.length}`);
  }
  const warnings = [
    ...(Array.isArray(report.warnings) ? report.warnings : []),
    ...(Array.isArray(report.videos)
      ? report.videos.flatMap((video) => Array.isArray(video.warnings) ? video.warnings : [])
      : []),
    ...models.flatMap((model) => Array.isArray(model.warnings) ? model.warnings : []),
  ];
  const partial = findForbiddenPartialSignal(warnings);
  if (partial) {
    throw new Error(`avatar_report_partial:${partial}`);
  }
  const frames = models
    .map((model) => Number(model?.summary?.framesWithPose || model?.report?.body?.framesWithPose || 0));
  const reportFrameCount = frames.length ? Math.max(...frames) : 0;
  if (reportFrameCount < 1) {
    throw new Error("avatar_report_no_pose_frames");
  }
  const recordingGap = reportFrameCount - recordingFrameCount;
  const allowedRecordingGap = Math.max(
    config.completeness.recordingReportGapFramesMin,
    Math.ceil(reportFrameCount * config.completeness.recordingReportGapRatioMax),
  );
  if (recordingFrameCount < 1 || recordingGap > allowedRecordingGap) {
    throw new Error(`avatar_report_recording_gap:${recordingFrameCount}:${reportFrameCount}`);
  }
  const requiredWallMs = (expectedDurationSec / config.playbackRate) * 800;
  if (!(execution.elapsedMs >= requiredWallMs)) {
    throw new Error(`avatar_report_wall_coverage:${execution.elapsedMs}:${Math.ceil(requiredWallMs)}`);
  }

  const expectedDelegate = normalizeRuntimeValue(config.delegate);
  const expectedWorker = config.trackingWorker === "on";
  for (const model of models) {
    const summary = model.summary || {};
    const actualRequestedDelegate = normalizeRuntimeValue(
      summary.detectorDelegateRequested ?? summary.detectorDelegates?.requested,
    );
    const actualPoseDelegate = normalizeRuntimeValue(
      summary.detectorDelegatePose
        ?? summary.trackingWorkerDetectorDelegates?.pose
        ?? summary.detectorDelegates?.pose,
    );
    if (actualRequestedDelegate !== expectedDelegate || actualPoseDelegate !== expectedDelegate) {
      throw new Error(`avatar_report_delegate_mismatch:${actualRequestedDelegate}:${actualPoseDelegate}:${expectedDelegate}`);
    }
    if (
      Object.keys(summary.detectorDelegateFallbackReasons || {}).length > 0
      || normalizeRuntimeValue(summary.detectorDelegateLastFallbackReason)
    ) {
      throw new Error("avatar_report_delegate_fallback");
    }
    if (Boolean(summary.trackingWorkerRequested) !== expectedWorker) {
      throw new Error("avatar_report_worker_request_mismatch");
    }
    if (expectedWorker && summary.trackingWorkerActive !== true) {
      throw new Error(`avatar_report_worker_inactive:${summary.trackingWorkerStatus ?? "unknown"}`);
    }
    if (Number(summary.trackingWorkerErrors || 0) > 0 || Number(summary.trackingWorkerFallbacks || 0) > 0) {
      throw new Error("avatar_report_worker_fallback");
    }
    if (normalizeRuntimeValue(summary.trackingWorkerFallbackReason)) {
      throw new Error("avatar_report_worker_fallback_reason");
    }
    if (config.pump !== "auto" && normalizeRuntimeValue(summary.pumpMode) !== normalizeRuntimeValue(config.pump)) {
      throw new Error(`avatar_report_pump_mismatch:${summary.pumpMode ?? "unknown"}:${config.pump}`);
    }
    if (normalizeRuntimeValue(summary.avatarSmoothingMode) !== normalizeRuntimeValue(config.smoothing)) {
      throw new Error(`avatar_report_smoothing_mismatch:${summary.avatarSmoothingMode ?? "unknown"}:${config.smoothing}`);
    }
    if (normalizeRuntimeValue(summary.avatarRetargetMode) !== normalizeRuntimeValue(config.avatarRetarget)) {
      throw new Error(`avatar_report_retarget_mismatch:${summary.avatarRetargetMode ?? "unknown"}:${config.avatarRetarget}`);
    }
    if (normalizeRuntimeValue(model.status?.avatar) !== "ready" || normalizeRuntimeValue(model.status?.model) !== "ready") {
      throw new Error("avatar_report_model_not_ready");
    }
  }
}

function validateRecording(filePath, options = {}) {
  if (!existsSync(filePath)) throw new Error(`recording_missing:${repoRelative(filePath)}`);
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error("recording_partial_or_empty");
  }
  const rows = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`recording_invalid_json:${index + 1}`);
    }
  });
  const header = rows[0];
  const frames = rows.slice(1).filter((row) => (
    row?.type === "frame"
    || row?.type === "action-tracker-motion-frame"
    || row?.frame
  ));
  const frameCount = frames.length;
  if (frameCount < 1) throw new Error("recording_missing_frames");
  if (!Number.isInteger(header?.frameCount) || header.frameCount !== frameCount) {
    throw new Error(`recording_header_frame_count_mismatch:${header?.frameCount}:${frameCount}`);
  }
  if (rows.length !== frameCount + 1) {
    throw new Error(`recording_unrecognized_rows:${rows.length}:${frameCount + 1}`);
  }

  if (options.kind === "teacher") {
    const expected = options.teacherStats;
    const sourceFrameCount = Number(header?.source?.sourceFrameCount);
    const droppedFrames = Number(header?.droppedFrames);
    if (
      sourceFrameCount !== expected.rawLineCount
      || !Number.isInteger(droppedFrames)
      || droppedFrames < 0
      || frameCount + droppedFrames !== expected.rawLineCount
    ) {
      throw new Error(
        `teacher_recording_coverage_mismatch:${sourceFrameCount}:${frameCount}:${droppedFrames}:${expected.rawLineCount}`,
      );
    }
  }

  const sourceVideoTimes = frames
    .map((row) => Number(row?.frame?.sourceMeta?.videoTime ?? row?.sourceMeta?.videoTime))
    .filter(Number.isFinite);
  if (options.kind === "live") {
    if (sourceVideoTimes.length !== frameCount) {
      throw new Error(`live_recording_missing_source_pts:${sourceVideoTimes.length}:${frameCount}`);
    }
    for (let index = 1; index < sourceVideoTimes.length; index += 1) {
      if (sourceVideoTimes[index] < sourceVideoTimes[index - 1]) {
        throw new Error(`live_recording_nonmonotonic_source_pts:${index}`);
      }
    }
    const finalVideoTime = sourceVideoTimes.at(-1);
    const requiredFinalVideoTime = options.expectedDurationSec * options.finalSourcePtsRatioMin;
    if (!(finalVideoTime + 1e-9 >= requiredFinalVideoTime)) {
      throw new Error(`live_recording_source_pts_partial:${finalVideoTime}:${requiredFinalVideoTime}`);
    }
  }
  return {
    lineCount: lines.length,
    frameCount,
    header,
    firstSourceVideoTime: sourceVideoTimes[0] ?? null,
    finalSourceVideoTime: sourceVideoTimes.at(-1) ?? null,
  };
}

function validateComparison(filePath, { liveFrameCount, teacherFrameCount, pairedRatioMin }) {
  const report = readJson(filePath);
  const summary = report.summary || {};
  if (
    Number(summary.liveFrames || 0) < 1
    || Number(summary.offlineFrames || 0) < 1
    || Number(summary.pairedFrames || 0) < 1
  ) {
    throw new Error("comparison_missing_frames");
  }
  if (
    Number(summary.liveFrames) !== liveFrameCount
    || Number(summary.offlineFrames) !== teacherFrameCount
    || Number(summary.pairedFrames) > Math.min(liveFrameCount, teacherFrameCount)
  ) {
    throw new Error(
      `comparison_recording_count_mismatch:${summary.liveFrames}:${summary.offlineFrames}:${summary.pairedFrames}:${liveFrameCount}:${teacherFrameCount}`,
    );
  }
  const pairedRatio = Number(summary.pairedRatio ?? (Number(summary.pairedFrames) / liveFrameCount));
  if (!(pairedRatio >= pairedRatioMin)) {
    throw new Error(`comparison_paired_ratio_partial:${pairedRatio}:${pairedRatioMin}`);
  }
}

function verifyCompletedCell(cell) {
  if (cell.status !== "completed") return false;
  const required = ["teacherRecording", "liveRecording", "avatarReport", "comparisonReport"];
  for (const key of required) {
    const expected = cell.artifacts?.[key];
    if (!expected?.path || !expected.sha256) return false;
    const absolute = resolveRepo(expected.path);
    if (!existsSync(absolute) || sha256File(absolute) !== expected.sha256) return false;
  }
  return true;
}

function childScripts(options) {
  return {
    agreement: resolveRepo(options.agreementScript),
    adapter: resolveRepo(options.adapterScript),
    compare: resolveRepo(options.compareScript),
  };
}

function plannedCommands({ options, clip, rig, outputDir, scripts, offlineRecording }) {
  const clipDir = path.join(outputDir, "clips", clip.id);
  const cellDir = path.join(outputDir, "cells", `${clip.id}__${rig.id}`);
  const liveRecording = path.join(cellDir, "live-recording.jsonl");
  const avatarReport = path.join(cellDir, "avatar-report.json");
  const comparisonReport = path.join(cellDir, "live-vs-teacher.json");
  const adapter = [
    process.execPath,
    scripts.adapter,
    "--input", resolveRepo(clip.teacherRaw),
    "--joint-format", "mhr70",
    "--hands", "mhr70",
    "--output", offlineRecording,
  ];
  const agreement = [
    process.execPath,
    scripts.agreement,
    "--video", resolveRepo(clip.video),
    "--only-models",
    "--model", `${rig.label}=${resolveRepo(rig.model)}`,
    "--output", avatarReport,
    "--recording-output", liveRecording,
    "--reference-recording", offlineRecording,
    "--browser-mode", "headful",
    "--warmup-pose-frames", String(options.warmupPoseFrames),
    "--min-pose-frames", String(options.minPoseFrames),
    "--timeout-ms", String(options.timeoutMs),
    "--playback-rate", String(options.playbackRate),
    "--pump", String(options.pump),
    "--debug-overlay", "off",
    "--delegate", String(options.delegate),
    "--face-tracking", String(options.faceTracking),
    "--tracking-worker", String(options.trackingWorker),
    "--smoothing", String(options.smoothing),
    "--avatar-retarget", String(options.avatarRetarget),
    "--measurement-only",
  ];
  const compare = [
    process.execPath,
    scripts.compare,
    "--live", liveRecording,
    "--offline", offlineRecording,
    "--output", comparisonReport,
    "--timestamp-source", "sourceMeta.videoTime",
    "--interpolate", "offline",
    "--offset-ms", "0",
  ];
  return {
    paths: { clipDir, cellDir, liveRecording, avatarReport, comparisonReport },
    commands: { adapter, agreement, compare },
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const selection = selectedInventory(options);
  if (selection.clips.length === 0 || selection.rigs.length === 0) {
    throw new Error("empty_requested_matrix");
  }
  if (!options.dryRun && !options.evaluationContract) {
    throw new Error("evaluation_contract_required");
  }

  const outputDir = resolveRepo(options.outputDir);
  const indexPath = options.index
    ? resolveRepo(options.index)
    : path.join(outputDir, options.dryRun ? "dry-run-index.json" : "index.json");
  if (!options.dryRun && existsSync(indexPath) && !options.resume) {
    throw new Error(`index_exists_requires_resume:${repoRelative(indexPath)}`);
  }
  const scripts = childScripts(options);
  for (const [key, script] of Object.entries(scripts)) {
    assertReadableFile(script, `${key}_script`);
  }
  const inventory = inputInventory(options, selection);
  const environment = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpu: os.cpus()?.[0]?.model || "unknown",
    node: process.version,
    browser: options.browserVersion || detectBrowserVersion(),
    mediaProbe: detectFfprobeVersion(),
    deviceProfile: options.deviceProfile || "unspecified",
  };
  const worktree = worktreeIdentity();
  const git = {
    head: gitText(["rev-parse", "HEAD"], "unknown"),
    branch: gitText(["branch", "--show-current"], "unknown"),
    ...worktree,
  };
  const config = runtimeConfig(options);
  const runIdentity = {
    schemaVersion: 1,
    git,
    environment,
    config,
    evaluationContract: inventory.evaluationContract,
    clips: inventory.clips,
    unpaired: inventory.unpaired,
    rigs: inventory.rigs,
    scripts: Object.fromEntries(Object.entries(scripts).map(([key, value]) => [key, fileIdentity(value)])),
  };
  const runIdentityHash = sha256Text(stableStringify(runIdentity));
  const previous = options.resume && existsSync(indexPath) ? readJson(indexPath) : null;
  if (previous && previous.runIdentityHash !== runIdentityHash) {
    throw new Error(`hash_drift:run_identity:${previous.runIdentityHash}:${runIdentityHash}`);
  }
  const previousCells = new Map((previous?.cells || []).map((cell) => [cell.id, cell]));
  const selectedClipIds = new Set(selection.clips.map(({ id }) => id));
  const inventoryClipById = new Map(inventory.clips.map((clip) => [clip.id, clip]));
  const inventoryRigById = new Map(inventory.rigs.map((rig) => [rig.id, rig]));
  const cells = [];
  for (const clip of selection.clips) {
    for (const rig of selection.rigs) {
      const clipIdentity = inventoryClipById.get(clip.id);
      const rigIdentity = inventoryRigById.get(rig.id);
      const offlineRecording = path.join(outputDir, "clips", clip.id, "teacher-recording.jsonl");
      const plan = plannedCommands({ options, clip, rig, outputDir, scripts, offlineRecording });
      const commands = Object.fromEntries(
        Object.entries(plan.commands).map(([key, command]) => [key, commandIdentity(command)]),
      );
      const cellIdentityHash = sha256Text(stableStringify({
        runIdentityHash,
        clip: clipIdentity,
        rig: rigIdentity,
        config,
        commands,
      }));
      const previousCell = previousCells.get(`${clip.id}__${rig.id}`);
      if (previousCell && previousCell.identityHash !== cellIdentityHash) {
        throw new Error(`hash_drift:cell:${clip.id}__${rig.id}`);
      }
      cells.push({
        id: `${clip.id}__${rig.id}`,
        clipId: clip.id,
        rigId: rig.id,
        requested: selectedClipIds.has(clip.id),
        identityHash: cellIdentityHash,
        status: options.dryRun ? "planned" : "pending",
        reason: null,
        resumed: false,
        sharedTeacherRegenerated: false,
        commands,
        artifacts: {
          teacherRecording: artifactDescriptor(offlineRecording),
          liveRecording: artifactDescriptor(plan.paths.liveRecording),
          avatarReport: artifactDescriptor(plan.paths.avatarReport),
          comparisonReport: artifactDescriptor(plan.paths.comparisonReport),
        },
        execution: {},
      });
    }
  }
  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.dryRun ? "dry-run" : options.resume ? "resume" : "run",
    runIdentityHash,
    completeMatrixRequested: selection.completeMatrixRequested,
    requested: {
      clipIds: selection.clips.map(({ id }) => id),
      rigIds: selection.rigs.map(({ id }) => id),
      expectedCellCount: selection.clips.length * selection.rigs.length,
    },
    git,
    environment,
    config,
    scripts: runIdentity.scripts,
    evaluationContract: inventory.evaluationContract,
    clips: inventory.clips,
    unpaired: inventory.unpaired,
    rigs: inventory.rigs,
    status: options.dryRun ? "planned" : "running",
    failures: [],
    cells,
  };
  writeJsonAtomic(indexPath, index);
  if (options.dryRun) {
    console.log(JSON.stringify({ status: "planned", index: repoRelative(indexPath), cells: cells.length }, null, 2));
    return;
  }

  for (const clip of selection.clips) {
    const clipInventory = inventoryClipById.get(clip.id);
    const offlineRecording = path.join(outputDir, "clips", clip.id, "teacher-recording.jsonl");
    const clipCells = index.cells.filter((cell) => cell.clipId === clip.id);
    const allResumable = clipCells.every((cell) => {
      const oldCell = previousCells.get(cell.id);
      return oldCell && oldCell.identityHash === cell.identityHash && verifyCompletedCell(oldCell);
    });
    if (!allResumable) {
      const adapterPlan = plannedCommands({ options, clip, rig: selection.rigs[0], outputDir, scripts, offlineRecording });
      const adapterLogs = path.join(outputDir, "clips", clip.id, "adapter");
      clearOutputFiles([offlineRecording]);
      const adapterExecution = runChild(adapterPlan.commands.adapter, {
        timeoutMs: options.timeoutMs,
        stdoutPath: `${adapterLogs}.stdout.log`,
        stderrPath: `${adapterLogs}.stderr.log`,
      });
      for (const cell of clipCells) {
        cell.execution.adapter = adapterExecution;
        cell.sharedTeacherRegenerated = true;
      }
      if (adapterExecution.exitCode !== 0 || adapterExecution.timedOut) {
        const reason = adapterExecution.timedOut ? "adapter_timeout" : `adapter_exit_${adapterExecution.exitCode}`;
        for (const cell of clipCells) {
          cell.status = "failed";
          cell.reason = reason;
        }
        index.failures.push({ clipId: clip.id, stage: "adapter", reason });
        writeJsonAtomic(indexPath, index);
        continue;
      }
      try {
        validateRecording(offlineRecording, {
          kind: "teacher",
          teacherStats: clipInventory.teacherStats,
        });
      } catch (error) {
        const reason = String(error.message || error);
        for (const cell of clipCells) {
          cell.status = "failed";
          cell.reason = reason;
        }
        index.failures.push({ clipId: clip.id, stage: "adapter_validation", reason });
        writeJsonAtomic(indexPath, index);
        continue;
      }
    }

    for (const cell of clipCells) {
      const oldCell = previousCells.get(cell.id);
      if (oldCell && oldCell.identityHash === cell.identityHash && verifyCompletedCell(oldCell)) {
        const currentAdapterExecution = cell.execution.adapter;
        Object.assign(cell, oldCell, {
          resumed: true,
          sharedTeacherRegenerated: Boolean(currentAdapterExecution),
        });
        if (currentAdapterExecution) {
          cell.execution = { ...oldCell.execution, adapter: currentAdapterExecution };
        }
        continue;
      }
      const rig = selection.rigs.find(({ id }) => id === cell.rigId);
      const plan = plannedCommands({ options, clip, rig, outputDir, scripts, offlineRecording });
      mkdirSync(plan.paths.cellDir, { recursive: true });
      clearOutputFiles([plan.paths.liveRecording, plan.paths.avatarReport, plan.paths.comparisonReport]);
      cell.status = "running";
      writeJsonAtomic(indexPath, index);
      const agreementExecution = runChild(plan.commands.agreement, {
        timeoutMs: options.timeoutMs,
        stdoutPath: path.join(plan.paths.cellDir, "agreement.stdout.log"),
        stderrPath: path.join(plan.paths.cellDir, "agreement.stderr.log"),
      });
      cell.execution.agreement = agreementExecution;
      try {
        if (agreementExecution.timedOut) throw new Error("agreement_timeout");
        if (agreementExecution.exitCode !== 0) throw new Error(`agreement_exit_${agreementExecution.exitCode}`);
        const liveRecording = validateRecording(plan.paths.liveRecording, {
          kind: "live",
          expectedDurationSec: clipInventory.video.media.durationSec,
          finalSourcePtsRatioMin: config.completeness.liveFinalSourcePtsRatioMin,
        });
        validateAvatarReport(plan.paths.avatarReport, {
          config,
          expectedDurationSec: clipInventory.video.media.durationSec,
          execution: agreementExecution,
          recordingFrameCount: liveRecording.frameCount,
        });
        clearOutputFiles([plan.paths.comparisonReport]);
        const compareExecution = runChild(plan.commands.compare, {
          timeoutMs: options.timeoutMs,
          stdoutPath: path.join(plan.paths.cellDir, "compare.stdout.log"),
          stderrPath: path.join(plan.paths.cellDir, "compare.stderr.log"),
        });
        cell.execution.compare = compareExecution;
        if (compareExecution.timedOut) throw new Error("compare_timeout");
        if (compareExecution.exitCode !== 0) throw new Error(`compare_exit_${compareExecution.exitCode}`);
        const teacherRecording = validateRecording(offlineRecording, {
          kind: "teacher",
          teacherStats: clipInventory.teacherStats,
        });
        validateComparison(plan.paths.comparisonReport, {
          liveFrameCount: liveRecording.frameCount,
          teacherFrameCount: teacherRecording.frameCount,
          pairedRatioMin: config.completeness.comparisonPairedRatioMin,
        });
        cell.artifacts = {
          teacherRecording: artifactDescriptor(offlineRecording),
          liveRecording: artifactDescriptor(plan.paths.liveRecording),
          avatarReport: artifactDescriptor(plan.paths.avatarReport),
          comparisonReport: artifactDescriptor(plan.paths.comparisonReport),
        };
        cell.status = "completed";
        cell.reason = null;
      } catch (error) {
        cell.status = "failed";
        cell.reason = String(error.message || error);
        index.failures.push({ cellId: cell.id, stage: "cell", reason: cell.reason });
      }
      writeJsonAtomic(indexPath, index);
    }
  }

  const requestedCells = index.cells.filter((cell) => cell.requested);
  const incomplete = requestedCells.filter((cell) => cell.status !== "completed");
  index.status = incomplete.length === 0 ? "completed" : "failed";
  index.completedCellCount = requestedCells.length - incomplete.length;
  index.incompleteCellCount = incomplete.length;
  index.generatedAt = new Date().toISOString();
  writeJsonAtomic(indexPath, index);
  console.log(JSON.stringify({
    status: index.status,
    index: repoRelative(indexPath),
    completed: index.completedCellCount,
    incomplete: index.incompleteCellCount,
  }, null, 2));
  if (incomplete.length) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(`sam-goal-baseline failed: ${error.message || error}`);
  process.exitCode = 1;
}
