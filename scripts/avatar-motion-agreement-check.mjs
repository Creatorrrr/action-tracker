#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  video: "output/test-videos/dance-16x9-padded.mp4",
  output: "output/reports/avatar-motion-agreement-latest.json",
  warmupPoseFrames: 120,
  minPoseFrames: 240,
  timeoutMs: 240_000,
  depthCalibration: "dynamic",
  overallTarget: 0.95,
  componentTarget: 0.9,
  groupTarget: 0.9,
  depthCalibrationTarget: 0.95,
  depthCalibrationMeanCvTarget: 0.05,
  depthCalibrationP95CvTarget: 0.08,
  depthCalibrationReliableSegmentTarget: 4,
  depthCalibrationP95MsBudget: 0.6,
  labelTarget: 0.95,
};
const defaultModels = [
  { label: "Xbot", path: null },
  { label: "Soldier GLB", path: "assets/models/ratio-candidates/soldier.glb" },
  { label: "Polydancer VRM", path: "assets/models/anime-candidates/polydancer.vrm" },
];
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videos = resolveVideoInputs(args);
  const outputPath = args.output === "" ? null : path.resolve(projectRoot, args.output ?? defaults.output);
  const labelSet = await loadLabelSet(args.labels);
  const models = args.onlyModels
    ? args.models
    : args.models.length > 0
      ? [...defaultModels, ...args.models]
      : defaultModels;
  const failures = [];
  const warnings = [];

  await assertInputFiles(videos, models);

  const staticServer = await startStaticServer(projectRoot);
  const chrome = await startChrome();
  const baseAppUrl = buildAppUrl(staticServer.port, args);

  try {
    const videoReports = [];
    const flatResults = [];

    for (const video of videos) {
      const videoFailures = [];
      const videoWarnings = [];
      const videoResults = [];
      const keyframeLabels = labelsForVideo(labelSet, video);

      console.log(`Video: ${video.label}`);

      for (const model of models) {
        const result = await runModelCheck({
          model,
          videoPath: video.absolutePath,
          appUrl: baseAppUrl,
          debugPort: chrome.debugPort,
          minPoseFrames: args.minPoseFrames ?? defaults.minPoseFrames,
          warmupPoseFrames: args.warmupPoseFrames ?? defaults.warmupPoseFrames,
          timeoutMs: args.timeoutMs ?? defaults.timeoutMs,
          playbackRate: args.playbackRate ?? 1,
          measurementOnly: Boolean(args.measurementOnly),
          keyframeLabels,
          recordingOutputPath: resolveRecordingOutputPath(args, video, model, videos.length, models.length),
        });
        const resultWithVideo = {
          videoLabel: video.label,
          videoPath: video.relativePath,
          ...result,
        };
        const scopedFailures = result.failures.map((failure) => `${video.label}: ${failure}`);
        const scopedWarnings = result.warnings.map((warning) => `${video.label}: ${warning}`);

        videoResults.push(resultWithVideo);
        flatResults.push(resultWithVideo);
        videoFailures.push(...result.failures);
        videoWarnings.push(...result.warnings);
        failures.push(...scopedFailures);
        warnings.push(...scopedWarnings);
        printModelSummary(result, video.label);
      }

      videoReports.push({
        label: video.label,
        videoPath: video.relativePath,
        warnings: videoWarnings,
        failures: videoFailures,
        models: videoResults,
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      videoPath: videos[0]?.relativePath ?? "",
      videoPaths: videos.map((video) => video.relativePath),
      gates: {
        overallTarget: defaults.overallTarget,
        componentTarget: defaults.componentTarget,
        groupTarget: defaults.groupTarget,
        depthCalibrationTarget: defaults.depthCalibrationTarget,
        depthCalibrationMeanCvTarget: defaults.depthCalibrationMeanCvTarget,
        depthCalibrationP95CvTarget: defaults.depthCalibrationP95CvTarget,
        depthCalibrationP95MsBudget: defaults.depthCalibrationP95MsBudget,
        depthScale: args.depthScale ?? null,
        depthCalibration: args.depthCalibration ?? defaults.depthCalibration,
        calibrationProfile: args.calibrationProfile ?? null,
        pump: args.pump ?? null,
        debugOverlay: args.debugOverlay ?? null,
        validation: "on",
        delegate: normalizeDelegateArg(args.delegate),
        trackingWorker: args.trackingWorker ?? null,
        smoothing: args.smoothing ?? null,
        avatarRetarget: args.avatarRetarget ?? null,
        measurementOnly: Boolean(args.measurementOnly),
        minPoseFrames: args.minPoseFrames ?? defaults.minPoseFrames,
        warmupPoseFrames: args.warmupPoseFrames ?? defaults.warmupPoseFrames,
        labels: labelSet?.relativePath ?? null,
        labelTarget: defaults.labelTarget,
      },
      warnings,
      failures,
      videos: videoReports,
      models: videos.length === 1 ? videoReports[0].models : flatResults,
    };

    if (outputPath) {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    }

    if (failures.length > 0) {
      console.error(`Avatar motion agreement check failed with ${failures.length} issue(s):`);
      for (const failure of failures) {
        console.error(`- ${failure}`);
      }
      if (outputPath) {
        console.error(`Report: ${path.relative(projectRoot, outputPath)}`);
      }
      process.exitCode = 1;
    } else {
      console.log("Avatar motion agreement check passed.");
      if (outputPath) {
        console.log(`Report: ${path.relative(projectRoot, outputPath)}`);
      }
    }
  } finally {
    await chrome.close();
    await staticServer.close();
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    models: [],
    videos: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--video") {
      parsed.videos.push(rawArgs[++index]);
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--min-pose-frames") {
      parsed.minPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--warmup-pose-frames") {
      parsed.warmupPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(rawArgs[++index]);
    } else if (arg === "--playback-rate") {
      parsed.playbackRate = Number(rawArgs[++index]);
    } else if (arg === "--depth-scale") {
      parsed.depthScale = Number(rawArgs[++index]);
    } else if (arg === "--depth-calibration") {
      parsed.depthCalibration = rawArgs[++index];
    } else if (arg === "--calibration-profile") {
      parsed.calibrationProfile = rawArgs[++index];
    } else if (arg === "--pump") {
      parsed.pump = rawArgs[++index];
    } else if (arg === "--debug-overlay") {
      parsed.debugOverlay = rawArgs[++index];
    } else if (arg === "--delegate") {
      parsed.delegate = rawArgs[++index];
    } else if (arg === "--face-tracking") {
      parsed.faceTracking = rawArgs[++index];
    } else if (arg === "--tracking-worker") {
      parsed.trackingWorker = rawArgs[++index];
    } else if (arg === "--smoothing") {
      parsed.smoothing = rawArgs[++index];
    } else if (arg === "--avatar-retarget" || arg === "--retarget-mode") {
      parsed.avatarRetarget = rawArgs[++index];
    } else if (arg === "--measurement-only") {
      parsed.measurementOnly = true;
    } else if (arg === "--labels") {
      parsed.labels = rawArgs[++index];
    } else if (arg === "--recording-output") {
      parsed.recordingOutput = rawArgs[++index] ?? "";
    } else if (arg === "--model") {
      parsed.models.push(parseModelArg(rawArgs[++index]));
    } else if (arg === "--only-models") {
      parsed.onlyModels = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      parsed.models.push(parseModelArg(arg));
    }
  }

  return parsed;
}

function resolveVideoInputs(args) {
  const videoValues = args.videos.length > 0 ? args.videos : [defaults.video];

  return videoValues.map((videoValue) => {
    const absolutePath = path.resolve(projectRoot, videoValue);

    return {
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath),
      label: path.basename(videoValue),
    };
  });
}

function buildAppUrl(port, args) {
  const url = new URL(`http://127.0.0.1:${port}/index.html`);
  url.searchParams.set("validation", "on");
  url.searchParams.set("delegate", normalizeDelegateArg(args.delegate));

  if (Number.isFinite(args.depthScale)) {
    url.searchParams.set("depth-scale", String(args.depthScale));
  }

  if (args.depthCalibration) {
    url.searchParams.set("depth-calibration", args.depthCalibration);
  }

  if (args.calibrationProfile) {
    url.searchParams.set("calibration-profile", args.calibrationProfile);
  }

  if (args.pump) {
    url.searchParams.set("pump", args.pump);
  }

  if (args.debugOverlay) {
    url.searchParams.set("debug-overlay", args.debugOverlay);
  }

  if (args.faceTracking) {
    url.searchParams.set("face-tracking", args.faceTracking);
  }

  if (args.trackingWorker) {
    url.searchParams.set("tracking-worker", args.trackingWorker);
  }

  if (args.smoothing) {
    url.searchParams.set("smoothing", args.smoothing);
  }

  if (args.avatarRetarget) {
    url.searchParams.set("avatar-retarget", args.avatarRetarget);
  }

  return url.href;
}

function normalizeDelegateArg(value) {
  const normalized = String(value ?? "cpu").toLowerCase();

  if (normalized === "gpu") {
    return "gpu";
  }

  return "cpu";
}

function parseModelArg(value) {
  if (!value) {
    throw new Error("Missing model path after --model");
  }

  const separatorIndex = value.indexOf("=");

  if (separatorIndex > 0) {
    return {
      label: value.slice(0, separatorIndex),
      path: value.slice(separatorIndex + 1),
    };
  }

  return {
    label: path.basename(value),
    path: value,
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/avatar-motion-agreement-check.mjs
  node scripts/avatar-motion-agreement-check.mjs --model "VRoid A=assets/models/vroid/a.vrm"

Options:
  --video <path>             Sample video path. Repeat for a multi-video matrix. Default: ${defaults.video}
  --model <label=path>       Add a model on top of the local defaults.
  --only-models              Run only models passed with --model.
  --output <path>            JSON report path. Default: ${defaults.output}; empty disables writing.
  --warmup-pose-frames <n>   Pose frames to ignore before measurement.
  --min-pose-frames <count>  Frames with pose required before collecting the report.
  --timeout-ms <ms>          Per-model browser timeout.
  --playback-rate <n>        Set video playbackRate after load. Use <1 for dense CPU recordings.
  --depth-scale <n>          Set ?depth-scale for baseline measurements.
  --depth-calibration <mode> Set ?depth-calibration=dynamic|static.
  --calibration-profile <p>  Set ?calibration-profile to an external segment-ratio JSON.
  --pump <auto|rvfc|raf>     Set ?pump frame scheduling mode.
  --debug-overlay <on|off>   Set ?debug-overlay for canvas skeleton drawing.
  --delegate <cpu|gpu>       Set ?delegate. Default CPU keeps headless validation stable.
  --face-tracking <on|off>   Set ?face-tracking for optional FaceLandmarker smoke checks.
  --tracking-worker <on|off> Set ?tracking-worker opt-in worker detection mode.
  --smoothing <mode>         Set ?smoothing=off|retarget|strong avatar retarget smoothing mode.
  --avatar-retarget <mode>   Set ?avatar-retarget=legacy|strict.
  --labels <path>            Keyframe label JSON with videoPath/time/expected root-facing labels.
  --recording-output <path>  Save the captured tracker motion recording JSONL.
  --measurement-only         Keep readiness checks but skip numeric pass/fail gates.
`);
}

async function loadLabelSet(labelPath) {
  if (!labelPath) {
    return null;
  }

  const absolutePath = path.resolve(projectRoot, labelPath);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));

  return {
    absolutePath,
    relativePath: path.relative(projectRoot, absolutePath),
    keyframes: normalizeKeyframeLabels(parsed),
  };
}

function normalizeKeyframeLabels(parsed) {
  const keyframes = [];

  for (const entry of parsed?.keyframes ?? []) {
    keyframes.push(normalizeKeyframeLabel(entry));
  }

  for (const video of parsed?.videos ?? []) {
    for (const keyframe of video.keyframes ?? []) {
      keyframes.push(normalizeKeyframeLabel({
        ...keyframe,
        videoPath: keyframe.videoPath ?? video.videoPath ?? video.path,
      }));
    }
  }

  return keyframes.filter((keyframe) => keyframe.videoPath && Number.isFinite(keyframe.time));
}

function normalizeKeyframeLabel(label) {
  const expected = label.expected ?? {};

  return {
    id: label.id ?? `${label.videoPath ?? label.video ?? "video"}@${label.time}`,
    videoPath: label.videoPath ?? label.video,
    time: Number(label.time),
    toleranceSec: Number(label.toleranceSec ?? expected.toleranceSec ?? 0.28),
    facing: label.facing ?? expected.rootFacing ?? expected.facing ?? "unknown",
    arms: label.arms ?? "unknown",
    fingers: label.fingers ?? "unknown",
    visibility: label.visibility ?? "unknown",
    expected: {
      ...expected,
      rootFacing: expected.rootFacing ?? expected.facing ?? label.facing ?? "unknown",
    },
    notes: label.notes ?? "",
  };
}

function labelsForVideo(labelSet, video) {
  if (!labelSet) {
    return [];
  }

  return labelSet.keyframes.filter((label) => {
    const normalized = path.normalize(label.videoPath);

    return normalized === path.normalize(video.relativePath)
      || path.basename(normalized) === path.basename(video.relativePath);
  });
}

async function assertInputFiles(videoList, modelList) {
  for (const video of videoList) {
    await stat(video.absolutePath);
  }

  for (const model of modelList) {
    if (model.path) {
      await stat(path.resolve(projectRoot, model.path));
    }
  }
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = path.resolve(root, `.${pathname}`);

      if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const fileStat = await stat(filePath);

      if (!fileStat.isFile()) {
        response.writeHead(404).end("Not found");
        return;
      }

      streamFile(request, response, filePath, fileStat);
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function streamFile(request, response, filePath, fileStat) {
  const range = request.headers.range;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentType(filePath),
  };

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : fileStat.size - 1;

    if (!match || start > end || end >= fileStat.size) {
      response.writeHead(416, {
        "Content-Range": `bytes */${fileStat.size}`,
      }).end();
      return;
    }

    response.writeHead(206, {
      ...headers,
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
    });
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, {
    ...headers,
    "Content-Length": fileStat.size,
  });
  createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  return {
    ".css": "text/css; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".vrm": "model/gltf-binary",
    ".webm": "video/webm",
  }[ext] ?? "application/octet-stream";
}

async function startChrome() {
  const debugPort = await getFreePort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "action-tracker-chrome-"));
  const chromePath = resolveChromePath();
  const chromeProcess = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-popup-blocking",
    "--disable-setuid-sandbox",
    "--mute-audio",
    "--no-sandbox",
    "--no-first-run",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-unsafe-swiftshader",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-gl=swiftshader",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], {
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  chromeProcess.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await waitForChrome(debugPort, chromeProcess, () => stderr);

  return {
    debugPort,
    close: async () => {
      chromeProcess.kill("SIGTERM");
      await onceExit(chromeProcess);
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}

function resolveChromePath() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }

  const candidates = [
    "/Users/chasoik/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "/Users/chasoik/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "/Users/chasoik/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[candidates.length - 1];
}

async function getFreePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForChrome(debugPort, chromeProcess, readStderr) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 45_000) {
    if (chromeProcess.exitCode !== null) {
      throw new Error(`Chrome exited before DevTools became available: ${readStderr()}`);
    }

    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);

      if (response.ok) {
        return;
      }
    } catch {
      // Chrome is still starting.
    }

    await delay(150);
  }

  throw new Error(`Timed out waiting for Chrome DevTools: ${readStderr()}`);
}

function onceExit(childProcess) {
  if (childProcess.exitCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    childProcess.once("exit", resolve);
    setTimeout(resolve, 3000).unref?.();
  });
}

async function runModelCheck({
  model,
  videoPath: absoluteVideoPath,
  appUrl,
  debugPort,
  minPoseFrames,
  warmupPoseFrames,
  timeoutMs,
  playbackRate = 1,
  measurementOnly,
  keyframeLabels = [],
  recordingOutputPath = "",
}) {
  const page = await createPage(debugPort, appUrl);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.open();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("DOM.enable");
    await waitForExpression(client, "document.readyState === 'complete' || document.readyState === 'interactive'", timeoutMs);
    await waitForAvatarReady(client, timeoutMs);

    if (model.path) {
      await setFileInput(client, "#avatar-file-input", path.resolve(projectRoot, model.path));
      await waitForAvatarReady(client, timeoutMs);
    }

    await evaluate(client, "window.motionTrackerDebug?.resetAvatarView?.()");
    await evaluate(client, "window.motionTrackerDebug?.clearAppPerformanceSamples?.()");
    await evaluate(client, "window.motionTrackerDebug?.clearAvatarPerformanceSamples?.()");
    await evaluate(client, "window.motionTrackerDebug?.clearBodyValidation?.()");
    await setFileInput(client, "#video-file-input", absoluteVideoPath);
    await waitForExpression(
      client,
      `(() => {
        const video = document.querySelector("#camera-video");
        return Boolean(video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Number.isFinite(video.duration) && video.duration > 0);
      })()`,
      timeoutMs,
    );
    if (Number.isFinite(Number(playbackRate)) && Number(playbackRate) > 0) {
      await evaluate(client, `(() => {
        const video = document.querySelector("#camera-video");
        if (video) {
          video.playbackRate = ${JSON.stringify(Number(playbackRate))};
        }
      })()`);
    }
    await waitForExpression(
      client,
      `window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose >= ${warmupPoseFrames}`,
      timeoutMs,
    );
    await evaluate(client, "window.motionTrackerDebug?.clearAppPerformanceSamples?.()");
    await evaluate(client, "window.motionTrackerDebug?.clearAvatarPerformanceSamples?.()");
    await evaluate(client, "window.motionTrackerDebug?.clearBodyValidation?.()");
    const shouldCheckRecordingReplay = keyframeLabels.length === 0 && !measurementOnly;
    const shouldRecordMotion = keyframeLabels.length === 0 && (shouldCheckRecordingReplay || Boolean(recordingOutputPath));
    if (shouldRecordMotion) {
      await evaluate(client, "window.motionTrackerDebug?.startMotionRecording?.()");
    }
    if (keyframeLabels.length > 0) {
      await collectKeyframeSamples(client, keyframeLabels, timeoutMs);
    }
    const latestLabelTime = latestKeyframeLabelTime(keyframeLabels);
    const completionExpression = Number.isFinite(latestLabelTime)
      ? `(() => {
        const report = window.motionTrackerDebug?.getBodyValidationReport?.();
        const frames = report?.framesWithPose ?? 0;
        const lastTime = window.motionTrackerDebug?.getLastBodyValidationSample?.()?.videoTime ?? 0;
        const video = document.querySelector("#camera-video");
        return frames >= ${minPoseFrames} || (frames > 0 && (lastTime >= ${latestLabelTime.toFixed(3)} || Boolean(video?.ended)));
      })()`
      : `(() => {
        const frames = window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose ?? 0;
        const video = document.querySelector("#camera-video");
        return frames >= ${minPoseFrames} || (frames > 0 && Boolean(video?.ended));
      })()`;
    let measurementCompletionError = null;
    if (keyframeLabels.length === 0) {
      try {
        await waitForExpression(
          client,
          completionExpression,
          timeoutMs,
        );
      } catch (error) {
        if (!measurementOnly) {
          throw error;
        }
        measurementCompletionError = error;
      }
    }

    const recording = shouldRecordMotion
      ? await evaluate(client, "window.motionTrackerDebug?.stopMotionRecording?.()")
      : null;
    const recordingJsonl = recording
      ? await evaluate(client, "window.motionTrackerDebug?.getMotionRecordingJsonl?.()")
      : "";
    if (recordingOutputPath && recordingJsonl) {
      await mkdir(path.dirname(recordingOutputPath), { recursive: true });
      await writeFile(recordingOutputPath, recordingJsonl);
    }
    const payload = await evaluate(client, `(() => ({
      avatarStatus: document.querySelector("#avatar-status")?.textContent ?? "",
      cameraStatus: document.querySelector("#camera-status")?.textContent ?? "",
      modelStatus: document.querySelector("#model-status")?.textContent ?? "",
      error: document.querySelector("#error-message")?.textContent ?? "",
      body: window.motionTrackerDebug.getBodyValidationReport(),
      performance: window.motionTrackerDebug.getAvatarPerformanceReport(),
      appPerformance: window.motionTrackerDebug.getAppPerformanceReport(),
      motionState: window.motionTrackerDebug.getAvatarMotionState(),
      rig: window.motionTrackerDebug.getAvatarRigReport()
    }))()`);
    const bodySamples = keyframeLabels.length > 0
      ? await evaluate(client, "window.motionTrackerDebug.getBodyValidationSamples()")
      : [];
    const labelValidation = keyframeLabels.length > 0
      ? buildKeyframeLabelValidation(model, keyframeLabels, bodySamples)
      : null;
    const recordingReplay = shouldCheckRecordingReplay && recording
      ? await runRecordingReplayCheck(client, recording, recordingJsonl, payload.body, minPoseFrames, timeoutMs)
      : null;
    const summary = buildResultSummary(model, payload, {
      measurementOnly,
      labelValidation,
      recordingReplay,
    });
    if (measurementCompletionError) {
      summary.warnings.push(`${model.label}: measurement completion timed out; saved partial recording when available (${measurementCompletionError.message})`);
    }

    return {
      label: model.label,
      modelPath: model.path,
      playbackRate,
      ...summary,
      labelValidation,
      recordingReplay,
      report: payload,
    };
  } finally {
    await client.close();
    await closePage(debugPort, page.id);
  }
}

function resolveRecordingOutputPath(args, video, model, videoCount, modelCount) {
  if (!args.recordingOutput) {
    return "";
  }

  const outputPath = path.resolve(projectRoot, args.recordingOutput);

  if (videoCount === 1 && modelCount === 1) {
    return outputPath;
  }

  const extension = path.extname(outputPath) || ".jsonl";
  const basename = path.basename(outputPath, extension);
  const scopedName = `${basename}-${slugify(video.label)}-${slugify(model.label)}${extension}`;

  return path.join(path.dirname(outputPath), scopedName);
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

async function runRecordingReplayCheck(client, recording, recordingJsonl, liveBody, minPoseFrames, timeoutMs) {
  const recordingFrameCount = recording?.frames?.length ?? 0;
  const recordingJsonlLineCount = typeof recordingJsonl === "string"
    ? recordingJsonl.trim().split(/\r?\n/).filter(Boolean).length
    : 0;
  const targetPoseFrames = Math.min(minPoseFrames, Math.max(1, recordingFrameCount));

  await evaluate(client, "window.motionTrackerDebug?.clearBodyValidation?.()");
  await evaluate(client, "window.motionTrackerDebug?.clearAvatarPerformanceSamples?.()");
  await evaluate(
    client,
    `window.motionTrackerDebug?.loadMotionRecordingJsonl?.(${JSON.stringify(recordingJsonl)})`,
  );
  await waitForExpression(
    client,
    `(() => {
      const status = window.motionTrackerDebug?.getMotionReplayStatus?.();
      return Boolean(status && !status.active);
    })()`,
    timeoutMs,
  );

  const replayBody = await evaluate(client, "window.motionTrackerDebug?.getBodyValidationReport?.()");
  const liveScore = liveBody?.motionAgreement?.overall?.score ?? 0;
  const replayScore = replayBody?.motionAgreement?.overall?.score ?? 0;
  const scoreDelta = Math.abs(liveScore - replayScore);
  const replayFrameTolerance = Math.max(1, Math.ceil(targetPoseFrames * 0.02));
  const minReplayPoseFrames = Math.max(1, targetPoseFrames - replayFrameTolerance);
  const passed =
    recordingFrameCount >= targetPoseFrames &&
    recordingJsonlLineCount === recordingFrameCount + 1 &&
    (replayBody?.framesWithPose ?? 0) >= minReplayPoseFrames &&
    scoreDelta <= 0.03;

  return {
    passed,
    recordingFrameCount,
    recordingJsonlBytes: typeof recordingJsonl === "string" ? recordingJsonl.length : 0,
    recordingJsonlLineCount,
    replayFramesWithPose: replayBody?.framesWithPose ?? 0,
    minReplayPoseFrames,
    replayFrameTolerance,
    liveScore,
    replayScore,
    scoreDelta,
    scoreTolerance: 0.03,
  };
}

function latestKeyframeLabelTime(keyframeLabels) {
  const times = (keyframeLabels ?? [])
    .map((label) => label.time + (label.toleranceSec ?? 0))
    .filter(Number.isFinite);

  return times.length > 0 ? Math.max(...times) : NaN;
}

async function collectKeyframeSamples(client, keyframeLabels, timeoutMs) {
  const labels = keyframeLabels
    .slice()
    .sort((a, b) => a.time - b.time);

  await evaluate(client, `document.querySelector("#camera-video")?.pause?.()`);

  for (const label of labels) {
    const time = Math.max(0, Number(label.time) || 0);
    const tolerance = Number(label.toleranceSec ?? 0.28);

    await seekVideoTime(client, time);
    await waitForExpression(
      client,
      `window.motionTrackerDebug?.getBodyValidationSamples?.()?.some((sample) => Math.abs((sample?.videoTime ?? -9999) - ${time.toFixed(3)}) <= ${tolerance.toFixed(3)} && (sample?.segments?.length ?? 0) > 0)`,
      Math.min(timeoutMs, 30_000),
    );
  }
}

async function seekVideoTime(client, time) {
  await evaluate(client, `new Promise((resolve, reject) => {
    const video = document.querySelector("#camera-video");
    if (!video) {
      reject(new Error("missing video"));
      return;
    }

    const target = Math.max(0, Math.min(${time.toFixed(3)}, Math.max(0, (video.duration || ${time.toFixed(3)}) - 0.05)));
    const isAtTarget = () => Math.abs(video.currentTime - target) <= 0.035 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
    const done = () => {
      cleanup();
      resolve(true);
    };
    const fail = () => {
      cleanup();
      reject(new Error("video seek failed"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(poll);
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(\`video seek timed out target=\${target.toFixed(3)} current=\${video.currentTime.toFixed(3)} readyState=\${video.readyState} duration=\${Number(video.duration || 0).toFixed(3)}\`));
    }, 10000);
    const poll = setInterval(() => {
      if (isAtTarget()) {
        done();
      }
    }, 50);

    video.pause();
    if (isAtTarget()) {
      requestAnimationFrame(done);
      return;
    }
    video.addEventListener("seeked", done, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.currentTime = target;
  })`);
}

async function createPage(debugPort, appUrl) {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(appUrl)}`,
    { method: "PUT" },
  );

  if (!response.ok) {
    throw new Error(`Unable to create Chrome page: ${response.status} ${response.statusText}`);
  }

  const target = await response.json();

  if (!target.webSocketDebuggerUrl) {
    throw new Error("Chrome target did not return a websocket URL");
  }

  return target;
}

async function closePage(debugPort, targetId) {
  if (!targetId) {
    return;
  }

  try {
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(targetId)}`);
  } catch {
    // Chrome exits at the end of the run; page close is only memory hygiene.
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  open() {
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);

      if (!pending) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
      } else {
        pending.resolve(message.result ?? {});
      }
    });

    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) {
      return;
    }

    this.socket.close();
    await delay(50);
  }
}

async function waitForAvatarReady(client, timeoutMs) {
  await waitForExpression(
    client,
    `document.querySelector("#avatar-status")?.textContent === "Ready"`,
    timeoutMs,
  );
}

async function setFileInput(client, selector, absolutePath) {
  const document = await client.send("DOM.getDocument", { depth: 1 });
  const node = await client.send("DOM.querySelector", {
    nodeId: document.root.nodeId,
    selector,
  });

  if (!node.nodeId) {
    throw new Error(`Missing input ${selector}`);
  }

  await client.send("DOM.setFileInputFiles", {
    nodeId: node.nodeId,
    files: [absolutePath],
  });
  await evaluate(
    client,
    `document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event("change", { bubbles: true }))`,
  );
}

async function waitForExpression(client, expression, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, `Boolean(${expression})`);

    if (value === true) {
      return;
    }

    await delay(250);
  }

  const diagnostics = await evaluate(client, `(() => ({
    avatarStatus: document.querySelector("#avatar-status")?.textContent ?? "",
    cameraStatus: document.querySelector("#camera-status")?.textContent ?? "",
    modelStatus: document.querySelector("#model-status")?.textContent ?? "",
    error: document.querySelector("#error-message")?.textContent ?? "",
    framesWithPose: window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose ?? 0
  }))()`).catch((error) => ({ error: error.message }));
  throw new Error(`Timed out waiting for ${expression}: ${JSON.stringify(diagnostics)}`);
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }

  return result.result?.value;
}

function buildResultSummary(model, payload, options = {}) {
  const failuresForModel = [];
  const warningsForModel = [];
  const enforceGates = !options.measurementOnly;
  const labelValidation = options.labelValidation ?? null;
  const recordingReplay = options.recordingReplay ?? null;
  const motion = payload.body?.motionAgreement;
  const performance = payload.performance;
  const appPerformance = payload.appPerformance;
  const poseSolver = payload.motionState?.poseSolver ?? null;
  const poseSolverMetrics = payload.motionState?.poseSolverMetrics ?? null;
  const trackingWorker = appPerformance?.trackingWorker ?? {};
  const retargetSmoothing = performance?.retargetSmoothing ?? {};
  const rig = payload.rig;
  const overall = motion?.overall?.score ?? 0;
  const components = motion?.componentGate?.components ?? {};
  const directionGroups = motion?.directionByGroup ?? {};
  const projectionGroups = motion?.projectionByGroup ?? {};
  const visualGroups = payload.body?.visualByGroup ?? {};
  const depthGroups = payload.body?.depthValidation?.byGroup ?? {};
  const depthFrontBackOverall = payload.body?.depthValidation?.frontBackOverall ?? {};
  const depthFrontBackGroups = payload.body?.depthValidation?.frontBackByGroup ?? {};
  const depthCalibration = payload.body?.depthCalibration ?? {};
  const depthCalibrationSummary = depthCalibration.summary ?? {};
  const observableSegmentRule = depthCalibration.observableSegmentRule ?? {};
  const minFingerChainLength = minFingerLength(rig?.fingerChains);

  if (payload.avatarStatus !== "Ready") {
    failuresForModel.push(`${model.label}: avatar did not stay Ready (${payload.avatarStatus})`);
  }

  if (payload.error && !payload.error.includes("Input is active, but the video frame is empty")) {
    failuresForModel.push(`${model.label}: app error message is visible: ${payload.error}`);
  } else if (payload.error) {
    warningsForModel.push(`${model.label}: transient video frame warning was visible at report time`);
  }

  if (enforceGates && overall < defaults.overallTarget) {
    failuresForModel.push(`${model.label}: motion agreement ${(overall * 100).toFixed(1)}% < ${(defaults.overallTarget * 100).toFixed(0)}%`);
  }

  for (const [name, component] of Object.entries(components)) {
    if (enforceGates && !component.passed) {
      const componentMessage = `${model.label}: ${name} component ${(component.matchRate * 100).toFixed(1)}% < ${(defaults.componentTarget * 100).toFixed(0)}%`;

      if (name === "frontBack" && (depthFrontBackOverall.matchRate ?? 0) >= defaults.componentTarget) {
        warningsForModel.push(`${componentMessage}; depth front/back ${(depthFrontBackOverall.matchRate * 100).toFixed(1)}% passed, treating visual torso side-order as diagnostic`);
      } else {
        failuresForModel.push(componentMessage);
      }
    }
  }

  for (const [groupName, group] of Object.entries(directionGroups)) {
    if (enforceGates && (group.matchRate ?? 0) < defaults.groupTarget) {
      failuresForModel.push(`${model.label}: direction ${groupName} ${(group.matchRate * 100).toFixed(1)}% < ${(defaults.groupTarget * 100).toFixed(0)}%`);
    }
  }

  if (enforceGates && minFingerChainLength < 3) {
    failuresForModel.push(`${model.label}: minimum finger chain length ${minFingerChainLength} < 3`);
  }

  if (enforceGates && (depthGroups.arms?.matchRate ?? 0) < defaults.componentTarget) {
    failuresForModel.push(`${model.label}: depth arms ${(depthGroups.arms.matchRate * 100).toFixed(1)}% < ${(defaults.componentTarget * 100).toFixed(0)}%`);
  }

  if (enforceGates && (depthFrontBackGroups.arms?.matchRate ?? 0) < defaults.componentTarget) {
    failuresForModel.push(`${model.label}: depth front/back arms ${(depthFrontBackGroups.arms.matchRate * 100).toFixed(1)}% < ${(defaults.componentTarget * 100).toFixed(0)}%`);
  }

  if (enforceGates && !labelValidation && !depthCalibration.ready) {
    failuresForModel.push(`${model.label}: dynamic depth calibration was not ready`);
  } else if (enforceGates && !labelValidation && (depthCalibration.score ?? 0) < defaults.depthCalibrationTarget) {
    failuresForModel.push(`${model.label}: depth calibration score ${((depthCalibration.score ?? 0) * 100).toFixed(1)}% < ${(defaults.depthCalibrationTarget * 100).toFixed(0)}%`);
  } else if (labelValidation && (depthCalibration.score ?? 0) < defaults.depthCalibrationTarget) {
    warningsForModel.push(`${model.label}: keyframe-only depth calibration score ${((depthCalibration.score ?? 0) * 100).toFixed(1)}% < ${(defaults.depthCalibrationTarget * 100).toFixed(0)}%`);
  }

  if (enforceGates && (depthCalibrationSummary.meanSegmentCv ?? 0) > defaults.depthCalibrationMeanCvTarget) {
    failuresForModel.push(`${model.label}: depth calibration mean segment CV ${(depthCalibrationSummary.meanSegmentCv * 100).toFixed(1)}% > ${(defaults.depthCalibrationMeanCvTarget * 100).toFixed(0)}%`);
  }

  if (enforceGates && (depthCalibrationSummary.p95SegmentCv ?? 0) > defaults.depthCalibrationP95CvTarget) {
    failuresForModel.push(`${model.label}: depth calibration p95 segment CV ${(depthCalibrationSummary.p95SegmentCv * 100).toFixed(1)}% > ${(defaults.depthCalibrationP95CvTarget * 100).toFixed(0)}%`);
  }

  if (enforceGates && depthCalibration.profileAssisted && (depthCalibrationSummary.clampedRatio ?? 0) > 0.2) {
    failuresForModel.push(`${model.label}: depth calibration clamp ratio ${(depthCalibrationSummary.clampedRatio * 100).toFixed(1)}% > 20%`);
  }

  const reliableSegmentCount = depthCalibration.profileAssisted
    ? observableSegmentRule.observableReliableSegmentCount
    : depthCalibrationSummary.cvReliableSegmentCount;

  if (enforceGates && !labelValidation && (reliableSegmentCount ?? 0) < defaults.depthCalibrationReliableSegmentTarget) {
    failuresForModel.push(`${model.label}: depth calibration observable segments ${reliableSegmentCount ?? 0} < ${defaults.depthCalibrationReliableSegmentTarget}`);
  } else if (labelValidation && (reliableSegmentCount ?? 0) < defaults.depthCalibrationReliableSegmentTarget) {
    warningsForModel.push(`${model.label}: keyframe-only run has sparse depth calibration observable segments (${reliableSegmentCount ?? 0})`);
  }

  for (const warning of depthCalibration.warnings ?? []) {
    warningsForModel.push(`${model.label}: ${warning}`);
  }

  if (enforceGates) {
    const budgetFailures = performanceBudgetFailures(model.label, performance);
    failuresForModel.push(...budgetFailures);
  }

  const depthCalibrationP95 = performance?.samples?.depthCalibration?.p95Ms ?? 0;

  if (enforceGates && depthCalibrationP95 > defaults.depthCalibrationP95MsBudget) {
    failuresForModel.push(`${model.label}: depth calibration p95 ${depthCalibrationP95.toFixed(2)}ms > ${defaults.depthCalibrationP95MsBudget.toFixed(1)}ms`);
  }

  if ((payload.body?.framesWithPose ?? 0) < defaults.minPoseFrames) {
    warningsForModel.push(`${model.label}: only ${payload.body?.framesWithPose ?? 0} pose frames collected`);
  }

  const projectionArmsMatchRate = projectionGroups.arms?.matchRate ?? 0;
  const visualArmsMatchRate = visualGroups.arms?.matchRate ?? 0;

  if (projectionArmsMatchRate < 0.8) {
    warningsForModel.push(`${model.label}: projected arms diagnostic ${(projectionArmsMatchRate * 100).toFixed(1)}% < 80%`);
  }

  if (visualArmsMatchRate < 0.75) {
    warningsForModel.push(`${model.label}: visual arms diagnostic ${(visualArmsMatchRate * 100).toFixed(1)}% < 75%`);
  }

  if (labelValidation) {
    if (!labelValidation.passedTarget) {
      failuresForModel.push(
        `${model.label}: keyframe label pass rate ${(labelValidation.passRate * 100).toFixed(1)}% < ${(labelValidation.target * 100).toFixed(0)}%`,
        ...labelValidation.failures,
      );
    } else {
      warningsForModel.push(...labelValidation.failures);
    }
    warningsForModel.push(...labelValidation.warnings);
  }

  if (recordingReplay) {
    if (enforceGates && !recordingReplay.passed) {
      failuresForModel.push(
        `${model.label}: recording replay failed (${recordingReplay.replayFramesWithPose}/${recordingReplay.recordingFrameCount} replay pose frames, min ${recordingReplay.minReplayPoseFrames}, score delta ${(recordingReplay.scoreDelta * 100).toFixed(1)}%)`,
      );
    }
  }

  return {
    status: {
      avatar: payload.avatarStatus,
      camera: payload.cameraStatus,
      model: payload.modelStatus,
    },
    summary: {
      overallScore: overall,
      overallPercent: overall * 100,
      components: Object.fromEntries(
        Object.entries(motion?.components ?? {}).map(([name, component]) => [
          name,
          component.matchRate,
        ]),
      ),
      directionByGroup: Object.fromEntries(
        Object.entries(directionGroups).map(([name, group]) => [name, group.matchRate]),
      ),
      projectionByGroup: Object.fromEntries(
        Object.entries(projectionGroups).map(([name, group]) => [name, group.matchRate]),
      ),
      visualByGroup: Object.fromEntries(
        Object.entries(visualGroups).map(([name, group]) => [name, group.matchRate]),
      ),
      depthByGroup: Object.fromEntries(
        Object.entries(depthGroups).map(([name, group]) => [name, group.matchRate]),
      ),
      depthFrontBackByGroup: Object.fromEntries(
        Object.entries(depthFrontBackGroups).map(([name, group]) => [name, group.matchRate]),
      ),
      depthCalibrationScore: depthCalibration.score ?? null,
      depthCalibrationMeanSegmentCv: depthCalibrationSummary.meanSegmentCv ?? null,
      depthCalibrationP95SegmentCv: depthCalibrationSummary.p95SegmentCv ?? null,
      depthCalibrationCvReliableSegmentCount: depthCalibrationSummary.cvReliableSegmentCount ?? null,
      depthCalibrationCvSparseSegmentCount: depthCalibrationSummary.cvSparseSegmentCount ?? null,
      depthCalibrationClampedRatio: depthCalibrationSummary.clampedRatio ?? null,
      depthCalibrationProfileLocked: depthCalibration.profileLocked ?? null,
      depthCalibrationExternalReferenceSegmentCount: depthCalibration.externalReferenceSegmentCount ?? null,
      visualJointSanity: motion?.visualJointSanity?.matchRate ?? null,
      minFingerChainLength,
      framesWithPose: payload.body?.framesWithPose ?? 0,
      updateP95Ms: performance?.samples?.update?.p95Ms ?? null,
      renderP95Ms: performance?.samples?.render?.p95Ms ?? null,
      validationP95Ms: performance?.samples?.validation?.p95Ms ?? null,
      depthCalibrationP95Ms: depthCalibrationP95,
      poseSolverP95Ms: performance?.samples?.poseSolver?.p95Ms ?? null,
      avatarSmoothingMode: retargetSmoothing.mode ?? null,
      avatarSmoothingEnabled: retargetSmoothing.enabled ?? null,
      avatarSmoothingScale: retargetSmoothing.scale ?? null,
      avatarRetargetMode: payload.motionState?.retargetMode ?? performance?.retargetMode ?? null,
      sourceAvatarAngularP90Deg: payload.body?.sourceAvatarDivergence?.angularError?.p90ErrorDeg ?? null,
      sourceAvatarAngularMaxDeg: payload.body?.sourceAvatarDivergence?.angularError?.maxErrorDeg ?? null,
      sourceAvatarPalmInversionRatio: payload.body?.sourceAvatarDivergence?.handPalm?.inversionRatio ?? null,
      sourceAvatarRootYawTargetP90Deg: payload.body?.sourceAvatarDivergence?.rootYaw?.targetError?.p90ErrorDeg ?? null,
      poseSolverFacing: poseSolver?.facing ?? null,
      poseSolverMode: poseSolver?.mode ?? null,
      poseSolverTargetCount: poseSolver?.targetCount ?? null,
      poseSolverLowConfidenceTargets: poseSolver?.lowConfidenceTargets ?? null,
      poseSolverHingeViolations: poseSolver?.hingeViolations ?? null,
      poseSolverHingeLimitWarnings: poseSolver?.hingeLimitWarnings ?? null,
      poseSolverLowConfidenceHinges: poseSolver?.lowConfidenceHinges ?? null,
      poseSolverMetricFrames: poseSolverMetrics?.frames ?? null,
      poseSolverHingeViolationFrames: poseSolverMetrics?.hingeViolationFrames ?? null,
      poseSolverMaxHingeViolations: poseSolverMetrics?.maxHingeViolations ?? null,
      poseSolverHingeLimitWarningFrames: poseSolverMetrics?.hingeLimitWarningFrames ?? null,
      poseSolverMaxHingeLimitWarnings: poseSolverMetrics?.maxHingeLimitWarnings ?? null,
      poseSolverHingeLimitWarningByName: poseSolverMetrics?.hingeLimitWarningByName ?? null,
      poseSolverMaxHingeFlexDegByName: poseSolverMetrics?.maxHingeFlexDegByName ?? null,
      poseSolverMaxHingeOverflowDegByName: poseSolverMetrics?.maxHingeOverflowDegByName ?? null,
      poseSolverFacingChanges: poseSolverMetrics?.facingChanges ?? null,
      poseSolverModeChanges: poseSolverMetrics?.modeChanges ?? null,
      poseSolverOcclusionActive: poseSolverMetrics?.maxOcclusionActiveTargets ?? poseSolver?.occlusion?.activeCount ?? null,
      poseSolverOcclusionActiveFrames: poseSolverMetrics?.occlusionActiveFrames ?? null,
      pumpMode: appPerformance?.pump?.activeMode ?? null,
      pumpRequestedMode: appPerformance?.pump?.requestedMode ?? null,
      pumpCallbacks: appPerformance?.pump?.callbacks ?? null,
      pumpProcessedFrames: appPerformance?.pump?.processedFrames ?? null,
      pumpDuplicateFrames: appPerformance?.pump?.duplicateFrames ?? null,
      pumpLatestWinsFrames: appPerformance?.pump?.latestWinsFrames ?? null,
      pumpStaleFrameCallbacks: appPerformance?.pump?.staleFrameCallbacks ?? null,
      validationEnabled: appPerformance?.validation?.enabled ?? null,
      validationSamples: appPerformance?.validation?.samples ?? null,
      detectorDelegates: appPerformance?.detectorDelegates ?? null,
      detectorDelegateRequested: appPerformance?.detectorDelegates?.requested ?? null,
      detectorDelegatePose: appPerformance?.detectorDelegates?.pose ?? null,
      detectorDelegateHand: appPerformance?.detectorDelegates?.hand ?? null,
      detectorDelegateFace: appPerformance?.detectorDelegates?.face ?? null,
      detectorDelegateAttempts: appPerformance?.detectorDelegates?.attempted ?? null,
      detectorDelegateFallbackReasons: appPerformance?.detectorDelegates?.fallbackReasons ?? null,
      detectorDelegateLastFallbackReason: appPerformance?.detectorDelegates?.lastFallbackReason ?? null,
      trackingWorkerRequested: trackingWorker.requested ?? null,
      trackingWorkerSupported: trackingWorker.supported ?? null,
      trackingWorkerActive: trackingWorker.active ?? null,
      trackingWorkerStatus: trackingWorker.status ?? null,
      trackingWorkerFrames: trackingWorker.frames ?? null,
      trackingWorkerErrors: trackingWorker.errors ?? null,
      trackingWorkerFallbacks: trackingWorker.fallbacks ?? null,
      trackingWorkerFallbackReason: trackingWorker.fallbackReason ?? null,
      trackingWorkerDetectorDelegates: trackingWorker.detectorDelegates ?? null,
      appDetectP95Ms: appPerformance?.samples?.detect?.p95Ms ?? null,
      appProcessP95Ms: appPerformance?.samples?.process?.p95Ms ?? null,
      appDrawP95Ms: appPerformance?.samples?.draw?.p95Ms ?? null,
      appFrameTotalP95Ms: appPerformance?.samples?.frameTotal?.p95Ms ?? null,
      appFrameAgeP95Ms: appPerformance?.samples?.frameAge?.p95Ms ?? null,
      appFrameCallbackLagP95Ms: appPerformance?.samples?.frameCallbackLag?.p95Ms ?? null,
      appCallbackFps: appPerformance?.fps?.callback ?? null,
      appDetectionFps: appPerformance?.fps?.detection ?? null,
      keyframeLabels: labelValidation
        ? {
            checked: labelValidation.checked,
            passed: labelValidation.passed,
            failed: labelValidation.failed,
            passRate: labelValidation.passRate,
            target: labelValidation.target,
            passedTarget: labelValidation.passedTarget,
          }
        : null,
      recordingReplay,
    },
    failures: failuresForModel,
    warnings: warningsForModel,
  };
}

function buildKeyframeLabelValidation(model, labels, samples) {
  const checks = [];
  const failures = [];
  const warnings = [];
  const poseSamples = (samples ?? [])
    .filter((sample) => sample?.segments?.length > 0)
    .filter((sample) => Number.isFinite(sample.videoTime));

  for (const label of labels) {
    const sample = nearestSample(poseSamples, label.time);
    const toleranceSec = label.toleranceSec;

    if (!sample || Math.abs(sample.videoTime - label.time) > toleranceSec) {
      const message = `${model.label}: keyframe ${label.id} at ${label.time.toFixed(2)}s has no pose sample within ${toleranceSec.toFixed(2)}s`;
      failures.push(message);
      checks.push({
        id: label.id,
        time: label.time,
        passed: false,
        reason: "missing_sample",
        nearestTime: sample?.videoTime ?? null,
      });
      continue;
    }

    const rootCheck = checkRootFacing(label, sample);
    const armsDiagnostic = summarizeSampleGroup(sample, "arms");
    const fingersSupported = label.fingers === "unknown" || label.expected?.fingerState === "unsupported";

    if (!rootCheck.passed) {
      failures.push(`${model.label}: keyframe ${label.id} expected root ${rootCheck.expectedFacing} at ${label.time.toFixed(2)}s, got ${rootCheck.actualFacing} (${rootCheck.actualYawDeg.toFixed(1)}deg, error ${rootCheck.errorDeg.toFixed(1)}deg > ${rootCheck.maxErrorDeg.toFixed(1)}deg)`);
    }

    if (!fingersSupported) {
      warnings.push(`${model.label}: keyframe ${label.id} has finger label "${label.fingers}", but this gate currently verifies finger-chain availability rather than per-frame finger pose`);
    }

    checks.push({
      id: label.id,
      time: label.time,
      nearestTime: sample.videoTime,
      deltaSec: sample.videoTime - label.time,
      facing: label.facing,
      arms: label.arms,
      fingers: label.fingers,
      visibility: label.visibility,
      passed: rootCheck.passed,
      root: rootCheck,
      armsDiagnostic,
      notes: label.notes,
    });
  }

  const passed = checks.filter((check) => check.passed).length;
  const failed = checks.filter((check) => !check.passed).length;
  const passRate = checks.length > 0 ? passed / checks.length : 1;

  return {
    validationScope: "human_labeled_keyframes",
    target: defaults.labelTarget,
    checked: checks.length,
    passed,
    failed,
    passRate,
    passedTarget: passRate >= defaults.labelTarget,
    failures,
    warnings,
    checks,
  };
}

function nearestSample(samples, time) {
  let best = null;
  let bestDistance = Infinity;

  for (const sample of samples) {
    const distance = Math.abs(sample.videoTime - time);

    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }

  return best;
}

function checkRootFacing(label, sample) {
  const expectedFacing = normalizeFacing(label.expected?.rootFacing ?? label.facing);

  if (expectedFacing === "unknown") {
    return {
      expectedFacing,
      actualFacing: classifyRootFacing(sample.rootMotion?.yawOffset ?? 0),
      actualYawDeg: normalizeAngleDeg(radToDeg(sample.rootMotion?.yawOffset ?? 0)),
      errorDeg: 0,
      maxErrorDeg: 180,
      passed: true,
      skipped: true,
    };
  }

  const actualYawDeg = normalizeAngleDeg(radToDeg(sample.rootMotion?.yawOffset ?? 0));
  const expectedYawDeg = Number.isFinite(label.expected?.rootYawDeg)
    ? normalizeAngleDeg(label.expected.rootYawDeg)
    : facingToYawDeg(expectedFacing);
  const maxErrorDeg = Number(label.expected?.maxYawErrorDeg ?? label.maxYawErrorDeg ?? 65);
  const errorDeg = angularDistanceDeg(actualYawDeg, expectedYawDeg);

  return {
    expectedFacing,
    expectedYawDeg,
    actualFacing: classifyRootFacing(sample.rootMotion?.yawOffset ?? 0),
    actualYawDeg,
    errorDeg,
    maxErrorDeg,
    passed: errorDeg <= maxErrorDeg,
    rootMotion: sample.rootMotion ?? null,
  };
}

function summarizeSampleGroup(sample, groupName) {
  const rows = (sample.segments ?? [])
    .filter((segment) => segment.group === groupName)
    .filter((segment) => Number.isFinite(segment.errorDeg));

  if (rows.length === 0) {
    return {
      count: 0,
      meanErrorDeg: null,
      maxErrorDeg: null,
    };
  }

  return {
    count: rows.length,
    meanErrorDeg: rows.reduce((sum, row) => sum + row.errorDeg, 0) / rows.length,
    maxErrorDeg: Math.max(...rows.map((row) => row.errorDeg)),
  };
}

function normalizeFacing(value) {
  const text = String(value ?? "unknown").toLowerCase();

  if (["front", "forward"].includes(text)) {
    return "front";
  }

  if (["back", "backward", "away"].includes(text)) {
    return "back";
  }

  if (["left", "right", "side", "sideways"].includes(text)) {
    return "side";
  }

  return "unknown";
}

function facingToYawDeg(facing) {
  if (facing === "back") {
    return 180;
  }

  if (facing === "side") {
    return 90;
  }

  return 0;
}

function classifyRootFacing(yawRad) {
  const yawDeg = Math.abs(normalizeAngleDeg(radToDeg(yawRad)));

  if (yawDeg >= 125) {
    return "back";
  }

  if (yawDeg >= 55) {
    return "side";
  }

  return "front";
}

function radToDeg(value) {
  return Number(value) * 180 / Math.PI;
}

function normalizeAngleDeg(value) {
  let angle = Number(value);

  while (angle > 180) {
    angle -= 360;
  }

  while (angle <= -180) {
    angle += 360;
  }

  return angle;
}

function angularDistanceDeg(a, b) {
  return Math.abs(normalizeAngleDeg(a - b));
}

function minFingerLength(fingerChains) {
  const lengths = [];

  for (const side of ["Left", "Right"]) {
    for (const finger of ["Thumb", "Index", "Middle", "Ring", "Pinky"]) {
      lengths.push(fingerChains?.[side]?.[finger]?.length ?? 0);
    }
  }

  return Math.min(...lengths);
}

function performanceBudgetFailures(label, performance) {
  const budgets = performance?.budgetsMs;
  const samples = performance?.samples;
  const checks = [
    ["update p95", samples?.update?.p95Ms, budgets?.updateP95],
    ["render p95", samples?.render?.p95Ms, budgets?.renderP95],
    ["validation p95", samples?.validation?.p95Ms, budgets?.validationP95],
  ];

  return checks
    .filter(([, value, limit]) => Number.isFinite(value) && Number.isFinite(limit) && value > limit)
    .map(([name, value, limit]) => `${label}: ${name} ${value.toFixed(2)}ms > ${limit.toFixed(2)}ms`);
}

function printModelSummary(result, videoLabel = "") {
  const summary = result.summary;
  const prefix = videoLabel ? `${videoLabel} / ` : "";

  console.log(`${prefix}${result.label}: ${summary.overallPercent.toFixed(1)}% overall, `
    + `direction ${(summary.components.direction * 100).toFixed(1)}%, `
    + `front/back ${(summary.components.frontBack * 100).toFixed(1)}%, `
    + `projection ${(summary.components.projection * 100).toFixed(1)}%, `
    + `depth calibration ${((summary.depthCalibrationScore ?? 0) * 100).toFixed(1)}%, `
    + `finger min ${summary.minFingerChainLength}, `
    + `${summary.framesWithPose} pose frames, `
    + `solver ${summary.poseSolverMode ?? "unknown"}/${summary.poseSolverFacing ?? "unknown"}, `
    + `retarget ${summary.avatarRetargetMode ?? "strict"}, `
    + `solver p95 ${formatNullableMs(summary.poseSolverP95Ms)}, `
    + `hinge diag ${summary.poseSolverHingeViolations ?? "n/a"}/${summary.poseSolverHingeViolationFrames ?? "n/a"}f, `
    + `warn ${summary.poseSolverHingeLimitWarningFrames ?? "n/a"}f`
    + `${formatHingeWarningBreakdown(summary.poseSolverHingeLimitWarningByName, summary.poseSolverMaxHingeOverflowDegByName)}, `
    + `occ ${summary.poseSolverOcclusionActive ?? "n/a"}, `
    + `pump ${summary.pumpMode ?? "unknown"}, `
    + `delegate ${summary.detectorDelegatePose ?? summary.detectorDelegateRequested ?? "unknown"}, `
    + `detect p95 ${formatNullableMs(summary.appDetectP95Ms)}, `
    + `frame p95 ${formatNullableMs(summary.appFrameTotalP95Ms)}, `
    + `age p95 ${formatNullableMs(summary.appFrameAgeP95Ms)}, `
    + `lag p95 ${formatNullableMs(summary.appFrameCallbackLagP95Ms)}, `
    + `stale ${summary.pumpStaleFrameCallbacks ?? "n/a"}`);
}

function formatHingeWarningBreakdown(warningByName, overflowByName) {
  const entries = Object.entries(warningByName ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName));

  if (entries.length === 0) {
    return "";
  }

  const label = entries
    .map(([name, count]) => {
      const overflow = overflowByName?.[name];
      return Number.isFinite(overflow)
        ? `${name}:${count}/+${overflow.toFixed(1)}deg`
        : `${name}:${count}`;
    })
    .join(",");

  return ` (${label})`;
}

function formatNullableMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
