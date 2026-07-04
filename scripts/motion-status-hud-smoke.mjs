#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  video: "output/test-videos/dance-16x9-padded.mp4",
  output: "output/reports/motion-status-hud-smoke-latest.json",
  screenshot: "output/reports/motion-status-hud-smoke-latest.png",
  delegate: "cpu",
  minPoseFrames: 60,
  timeoutMs: 120_000,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videoPath = path.resolve(projectRoot, args.video ?? defaults.video);
  const outputPath = path.resolve(projectRoot, args.output ?? defaults.output);
  const screenshotPath = path.resolve(projectRoot, args.screenshot ?? defaults.screenshot);
  const delegate = normalizeDelegateArg(args.delegate ?? defaults.delegate);
  const minPoseFrames = args.minPoseFrames ?? defaults.minPoseFrames;
  const timeoutMs = args.timeoutMs ?? defaults.timeoutMs;

  await stat(videoPath);

  const staticServer = await startStaticServer(projectRoot);
  const chrome = await startChrome();
  const appUrl = buildAppUrl(staticServer.port, delegate);

  try {
    const page = await createPage(chrome.debugPort, appUrl);
    const client = new CdpClient(page.webSocketDebuggerUrl);
    await client.open();

    try {
      await client.send("Page.enable");
      await client.send("Runtime.enable");
      await client.send("DOM.enable");
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: 1280,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await waitForExpression(client, "document.readyState === 'complete' || document.readyState === 'interactive'", timeoutMs);
      await waitForExpression(client, "document.querySelector('#avatar-status')?.textContent === 'Ready'", timeoutMs);
      await setFileInput(client, "#video-file-input", videoPath);
      await waitForExpression(
        client,
        `window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose >= ${minPoseFrames}`,
        timeoutMs,
      );
      await waitForExpression(
        client,
        `(() => {
          const snapshot = window.motionTrackerDebug?.getMotionStatusHudSnapshot?.();
          return Boolean(snapshot?.active && snapshot?.mode && snapshot.mode !== "idle" && snapshot?.quality !== "no-pose");
        })()`,
        timeoutMs,
      );

      const calibrationReset = await resetCalibrationThroughHud(client);
      await waitForExpression(
        client,
        `window.motionTrackerDebug?.getMotionStatusHudSnapshot?.()?.depthCalibration?.ready === true`,
        timeoutMs,
      );
      await waitForExpression(
        client,
        `window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose >= ${minPoseFrames}`,
        timeoutMs,
      );
      await evaluate(client, `document.querySelector("#motion-status-title")?.scrollIntoView({ block: "center", inline: "nearest" })`);
      await delay(250);
      const payload = await readHudPayload(client);
      const failures = [
        ...calibrationReset.failures,
        ...validatePayload(payload, minPoseFrames, delegate),
      ];
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      const report = {
        generatedAt: new Date().toISOString(),
        status: failures.length === 0 ? "passed" : "failed",
        appUrl,
        minPoseFrames,
        screenshotPath: path.relative(projectRoot, screenshotPath),
        failures,
        calibrationReset,
        payload,
      };

      await mkdir(path.dirname(outputPath), { recursive: true });
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

      console.log(JSON.stringify({
        status: report.status,
        outputPath: path.relative(projectRoot, outputPath),
        screenshotPath: path.relative(projectRoot, screenshotPath),
        framesWithPose: payload.framesWithPose,
        avatarFaceStatus: payload.avatarFaceStatus,
        avatarExpressionStatus: payload.avatarExpressionStatus,
        hud: payload.hud,
        calibrationReset: {
          before: calibrationReset.before?.hud?.calibration,
          after: calibrationReset.after?.hud?.calibration,
          afterFrames: calibrationReset.after?.snapshot?.depthCalibration?.frames,
          failures: calibrationReset.failures,
        },
        snapshot: {
          active: payload.snapshot?.active,
          facing: payload.snapshot?.facing,
          mode: payload.snapshot?.mode,
          quality: payload.snapshot?.quality,
          delegate: payload.snapshot?.delegate,
          detectorDelegates: payload.appPerformance?.detectorDelegates,
          calibrationLabel: payload.snapshot?.calibrationLabel,
          calibrationGuideLabel: payload.snapshot?.calibrationGuideLabel,
          calibrationPoseQuality: {
            score: payload.snapshot?.depthCalibration?.poseQuality?.score,
            passed: payload.snapshot?.depthCalibration?.poseQuality?.passed,
            reasons: payload.snapshot?.depthCalibration?.poseQuality?.reasons,
          },
        },
      }, null, 2));

      if (failures.length > 0) {
        process.exitCode = 1;
      }
    } finally {
      await client.close();
      await closePage(chrome.debugPort, page.id);
    }
  } finally {
    await chrome.close();
    await staticServer.close();
  }
}

async function readHudPayload(client) {
  return await evaluate(client, `(() => {
    const read = (id) => document.querySelector(id)?.textContent?.trim() ?? "";
    return {
      appUrl: location.href,
      avatarStatus: read("#avatar-status"),
      avatarFaceStatus: read("#avatar-face-status"),
      avatarExpressionStatus: read("#avatar-expression-status"),
      cameraStatus: read("#camera-status"),
      modelStatus: read("#model-status"),
      error: read("#error-message"),
      framesWithPose: window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose ?? 0,
      hud: {
        facing: read("#motion-status-facing"),
        mode: read("#motion-status-mode"),
        quality: read("#motion-status-quality"),
        delegate: read("#motion-status-delegate"),
        fps: read("#motion-status-fps"),
        frameAge: read("#motion-status-frame-age"),
        solver: read("#motion-status-solver"),
        drops: read("#motion-status-drops"),
        calibration: read("#motion-status-calibration"),
        calibrationGuide: read("#motion-status-calibration-guide"),
        calibrate: read("#motion-status-calibrate")
      },
      snapshot: window.motionTrackerDebug?.getMotionStatusHudSnapshot?.() ?? null,
      appPerformance: window.motionTrackerDebug?.getAppPerformanceReport?.() ?? null,
      avatarPerformance: window.motionTrackerDebug?.getAvatarPerformanceReport?.() ?? null
    };
  })()`);
}

async function resetCalibrationThroughHud(client) {
  const before = await readHudPayload(client);
  await evaluate(client, `document.querySelector("#motion-status-calibrate")?.click()`);
  const after = await readHudPayload(client);
  const failures = validateCalibrationReset(before, after);

  return {
    before,
    after,
    failures,
  };
}

function validateCalibrationReset(before, after) {
  const failures = [];
  const beforeCalibration = before?.snapshot?.depthCalibration;
  const afterCalibration = after?.snapshot?.depthCalibration;

  if (!beforeCalibration?.ready) {
    failures.push("calibration reset smoke expected calibration to be ready before clicking Calibrate");
  }

  if (afterCalibration?.ready) {
    failures.push("calibration reset did not leave ready state immediately after clicking Calibrate");
  }

  if (!Number.isFinite(afterCalibration?.frames) || afterCalibration.frames > 1) {
    failures.push(`calibration reset frames ${afterCalibration?.frames ?? "missing"} should be 0 or 1 immediately after reset`);
  }

  if (!String(after?.hud?.calibration ?? "").startsWith("Warm")) {
    failures.push(`calibration HUD after reset should show warmup, got "${after?.hud?.calibration ?? ""}"`);
  }

  if (after?.hud?.calibrate !== "Calibrate") {
    failures.push(`calibration button text should be Calibrate, got "${after?.hud?.calibrate ?? ""}"`);
  }

  return failures;
}

function parseArgs(rawArgs) {
  const parsed = {};

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--video") {
      parsed.video = rawArgs[++index];
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index];
    } else if (arg === "--screenshot") {
      parsed.screenshot = rawArgs[++index];
    } else if (arg === "--delegate") {
      parsed.delegate = rawArgs[++index];
    } else if (arg === "--min-pose-frames") {
      parsed.minPoseFrames = Number(rawArgs[++index]);
    } else if (arg === "--timeout-ms") {
      parsed.timeoutMs = Number(rawArgs[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function buildAppUrl(port, delegate) {
  const url = new URL(`http://127.0.0.1:${port}/index.html`);
  url.searchParams.set("validation", "on");
  url.searchParams.set("delegate", delegate.toLowerCase());
  url.searchParams.set("debug-overlay", "off");
  url.searchParams.set("pump", "rvfc");
  url.searchParams.set("smoothing", "retarget");
  return url.href;
}

function validatePayload(payload, minPoseFrames, requestedDelegate) {
  const failures = [];
  const snapshot = payload.snapshot ?? {};
  const hud = payload.hud ?? {};

  if (payload.avatarStatus !== "Ready") {
    failures.push(`avatar status is ${payload.avatarStatus || "empty"}, expected Ready`);
  }

  if (!payload.avatarFaceStatus || payload.avatarFaceStatus === "Loading") {
    failures.push(`avatar face status is ${payload.avatarFaceStatus || "empty"}, expected a resolved face state`);
  }

  if (!payload.avatarExpressionStatus || payload.avatarExpressionStatus === "Loading") {
    failures.push(`avatar expression status is ${payload.avatarExpressionStatus || "empty"}, expected a resolved expression coverage state`);
  }

  if (payload.error) {
    failures.push(`app error message is visible: ${payload.error}`);
  }

  if ((payload.framesWithPose ?? 0) < minPoseFrames) {
    failures.push(`framesWithPose ${payload.framesWithPose ?? 0} < ${minPoseFrames}`);
  }

  if (!snapshot.active) {
    failures.push("motion HUD snapshot is not active");
  }

  for (const [name, value] of Object.entries(hud)) {
    if (!value || value === "NaN" || value.includes("NaN")) {
      failures.push(`HUD ${name} is empty or invalid: ${value}`);
    }
  }

  const expectedPairs = [
    ["facing", "facingLabel"],
    ["mode", "modeLabel"],
    ["quality", "qualityLabel"],
    ["delegate", "delegateLabel"],
    ["calibration", "calibrationLabel"],
    ["calibrationGuide", "calibrationGuideLabel"],
  ];

  for (const [hudKey, snapshotKey] of expectedPairs) {
    if (hud[hudKey] !== snapshot[snapshotKey]) {
      failures.push(`HUD ${hudKey} "${hud[hudKey]}" does not match snapshot ${snapshotKey} "${snapshot[snapshotKey]}"`);
    }
  }

  if (!["front", "side", "back"].includes(snapshot.facing)) {
    failures.push(`snapshot facing ${snapshot.facing || "empty"} is not a tracked facing state`);
  }

  if (!["full-body", "upper-body", "lost"].includes(snapshot.mode)) {
    failures.push(`snapshot mode ${snapshot.mode || "empty"} is not a tracked mode`);
  }

  if (snapshot.quality === "idle" || snapshot.quality === "no-pose") {
    failures.push(`snapshot quality ${snapshot.quality} is not an active tracking quality`);
  }

  if (!snapshot.depthCalibration || typeof snapshot.depthCalibration !== "object") {
    failures.push("snapshot is missing depth calibration details");
  } else if (!Number.isFinite(snapshot.depthCalibration.warmupFrames)) {
    failures.push("depth calibration snapshot is missing warmupFrames");
  } else if (!Number.isFinite(snapshot.depthCalibration.poseQuality?.score)) {
    failures.push("depth calibration snapshot is missing poseQuality score");
  }

  if (snapshot.calibrationLabel === "Idle" || snapshot.calibrationGuideLabel === "Start input") {
    failures.push("calibration HUD did not leave idle state during video tracking");
  }

  failures.push(...validateDetectorDelegateTelemetry(payload, requestedDelegate));

  return failures;
}

function validateDetectorDelegateTelemetry(payload, requestedDelegate) {
  const failures = [];
  const delegates = payload.appPerformance?.detectorDelegates;
  const expectedRequested = requestedDelegate.toUpperCase();

  if (!delegates || typeof delegates !== "object") {
    return ["app performance report is missing detectorDelegates"];
  }

  if (delegates.requested !== expectedRequested) {
    failures.push(`detectorDelegates requested ${delegates.requested || "empty"} != ${expectedRequested}`);
  }

  for (const detectorKey of ["hand", "pose", "face"]) {
    const activeDelegate = delegates[detectorKey];
    const attempts = delegates.attempted?.[detectorKey] ?? [];

    if (!Array.isArray(attempts) || attempts.length === 0) {
      failures.push(`detectorDelegates attempted.${detectorKey} is empty`);
      continue;
    }

    if (!attempts.includes(expectedRequested)) {
      failures.push(`detectorDelegates attempted.${detectorKey} does not include requested ${expectedRequested}`);
    }

    if (!["CPU", "GPU"].includes(activeDelegate)) {
      failures.push(`detectorDelegates ${detectorKey} active delegate ${activeDelegate || "empty"} is invalid`);
    }

    if (expectedRequested === "GPU" && activeDelegate === "CPU") {
      if (!attempts.includes("CPU")) {
        failures.push(`detectorDelegates attempted.${detectorKey} should include CPU after GPU fallback`);
      }

      if (!delegates.fallbackReasons?.[detectorKey]) {
        failures.push(`detectorDelegates fallbackReasons.${detectorKey} is missing after GPU fallback`);
      }
    }
  }

  return failures;
}

function normalizeDelegateArg(value) {
  const normalized = String(value ?? defaults.delegate).trim().toUpperCase();

  if (normalized === "GPU" || normalized === "CPU") {
    return normalized;
  }

  throw new Error(`Invalid --delegate ${value}; expected cpu or gpu`);
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

      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": fileStat.size,
      });
      createReadStream(filePath).pipe(response);
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

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  return {
    ".css": "text/css; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".vrm": "model/gltf-binary",
    ".wasm": "application/wasm",
  }[ext] ?? "application/octet-stream";
}

async function startChrome() {
  const debugPort = await getFreePort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "action-tracker-hud-smoke-"));
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
    framesWithPose: window.motionTrackerDebug?.getBodyValidationReport?.()?.framesWithPose ?? 0,
    hud: window.motionTrackerDebug?.getMotionStatusHudSnapshot?.() ?? null
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printUsage() {
  console.log(`Usage:
  node scripts/motion-status-hud-smoke.mjs
  node scripts/motion-status-hud-smoke.mjs --video output/test-videos/dance-16x9-padded.mp4 --min-pose-frames 60

The smoke test launches a local static server and headless Chrome, uploads a
test video, waits for live tracking frames, then verifies the Motion State HUD
against window.motionTrackerDebug.getMotionStatusHudSnapshot().
`);
}

await main();
