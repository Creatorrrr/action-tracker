#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaults = {
  outputDir: "output/keyframes",
  count: 6,
  startSec: 1,
  endMarginSec: 0.4,
  frameWidth: 260,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videos = await resolveVideos(args);
  const outputDir = path.resolve(projectRoot, args.outputDir ?? defaults.outputDir);

  await mkdir(outputDir, { recursive: true });

  const chrome = await startChrome();
  const manifest = {
    generatedAt: new Date().toISOString(),
    outputDir: path.relative(projectRoot, outputDir),
    videos: [],
  };

  try {
    for (const videoPath of videos) {
      const report = await extractVideoKeyframes({
        debugPort: chrome.debugPort,
        videoPath,
        outputDir,
        count: args.count ?? defaults.count,
        explicitTimes: args.times,
        startSec: args.startSec ?? defaults.startSec,
        endMarginSec: args.endMarginSec ?? defaults.endMarginSec,
        frameWidth: args.frameWidth ?? defaults.frameWidth,
      });

      manifest.videos.push(report);
      console.log(`${report.videoPath}: ${report.times.map((time) => `${time.toFixed(2)}s`).join(", ")}`);
      console.log(`  ${report.contactSheet}`);
    }
  } finally {
    await chrome.close();
  }

  const manifestPath = path.join(outputDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Manifest: ${path.relative(projectRoot, manifestPath)}`);
}

function parseArgs(rawArgs) {
  const parsed = {
    videos: [],
    times: null,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--video") {
      parsed.videos.push(rawArgs[++index]);
    } else if (arg === "--output-dir") {
      parsed.outputDir = rawArgs[++index];
    } else if (arg === "--count") {
      parsed.count = Number(rawArgs[++index]);
    } else if (arg === "--times") {
      parsed.times = String(rawArgs[++index] ?? "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter(Number.isFinite);
    } else if (arg === "--start-sec") {
      parsed.startSec = Number(rawArgs[++index]);
    } else if (arg === "--end-margin-sec") {
      parsed.endMarginSec = Number(rawArgs[++index]);
    } else if (arg === "--frame-width") {
      parsed.frameWidth = Number(rawArgs[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      parsed.videos.push(arg);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/extract-video-keyframes.mjs
  node scripts/extract-video-keyframes.mjs --video output/test-videos/dance-16x9-padded.mp4

Options:
  --video <path>             Video path. Repeat for multiple videos. Defaults to output/test-videos.
  --output-dir <path>        Output directory. Default: ${defaults.outputDir}
  --count <n>                Auto-selected frame count per video. Default: ${defaults.count}
  --times <a,b,c>            Explicit timestamps in seconds.
  --start-sec <n>            First auto timestamp. Default: ${defaults.startSec}
  --end-margin-sec <n>       Seconds to avoid at video end. Default: ${defaults.endMarginSec}
  --frame-width <px>         Contact-sheet frame width. Default: ${defaults.frameWidth}
`);
}

async function resolveVideos(args) {
  if (args.videos.length > 0) {
    return args.videos.map((value) => path.resolve(projectRoot, value));
  }

  const dir = path.join(projectRoot, "output/test-videos");
  const names = await readdir(dir);

  return names
    .filter((name) => /\.(mp4|webm|mov|mkv)$/i.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

async function extractVideoKeyframes({
  debugPort,
  videoPath,
  outputDir,
  count,
  explicitTimes,
  startSec,
  endMarginSec,
  frameWidth,
}) {
  await stat(videoPath);

  const page = await createPage(debugPort, keyframePageHtml());
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.open();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("DOM.enable");
    await waitForExpression(client, "document.readyState === 'complete' || document.readyState === 'interactive'", 30_000);
    await setFileInput(client, "#video-file-input", videoPath);
    await waitForExpression(client, "Number.isFinite(window.__videoDuration) && window.__videoDuration > 0", 30_000);

    const duration = await evaluate(client, "window.__videoDuration");
    const times = (explicitTimes?.length > 0 ? explicitTimes : autoTimes(duration, count, startSec, endMarginSec))
      .map((time) => clamp(time, 0, Math.max(0, duration - 0.05)));
    const dataUrl = await evaluate(
      client,
      `window.__captureContactSheet(${JSON.stringify(times)}, ${Number(frameWidth) || defaults.frameWidth})`,
    );
    const baseName = path.basename(videoPath).replace(/\.[^.]+$/, "");
    const contactSheetPath = path.join(outputDir, `${baseName}-keyframes.png`);
    const metadataPath = path.join(outputDir, `${baseName}-keyframes.json`);
    const imageBytes = Buffer.from(String(dataUrl).split(",")[1] ?? "", "base64");
    const relativeVideoPath = path.relative(projectRoot, videoPath);
    const relativeContactSheetPath = path.relative(projectRoot, contactSheetPath);

    await writeFile(contactSheetPath, imageBytes);
    await writeFile(metadataPath, `${JSON.stringify({
      videoPath: relativeVideoPath,
      duration,
      times,
      contactSheet: relativeContactSheetPath,
    }, null, 2)}\n`);

    return {
      videoPath: relativeVideoPath,
      duration,
      times,
      contactSheet: relativeContactSheetPath,
      metadata: path.relative(projectRoot, metadataPath),
    };
  } finally {
    await client.close();
    await closePage(debugPort, page.id);
  }
}

function keyframePageHtml() {
  const html = `<!doctype html>
<html>
<body>
  <input id="video-file-input" type="file" accept="video/*">
  <video id="video" muted playsinline></video>
  <canvas id="canvas"></canvas>
  <script>
    const input = document.getElementById('video-file-input');
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const context = canvas.getContext('2d');

    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      video.src = URL.createObjectURL(file);
      video.load();
    });

    video.addEventListener('loadedmetadata', () => {
      window.__videoDuration = video.duration;
    });

    function waitForSeek(time) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('seek timeout')), 10000);
        const finish = () => {
          clearTimeout(timer);
          video.removeEventListener('seeked', finish);
          resolve();
        };
        video.addEventListener('seeked', finish);
        video.currentTime = time;
      });
    }

    window.__captureContactSheet = async (times, frameWidth) => {
      const sourceWidth = video.videoWidth || 1280;
      const sourceHeight = video.videoHeight || 720;
      const frameHeight = Math.max(1, Math.round(frameWidth * sourceHeight / sourceWidth));
      const labelHeight = 28;
      const gap = 10;
      const columns = Math.min(3, Math.max(1, times.length));
      const rows = Math.ceil(times.length / columns);

      canvas.width = columns * frameWidth + (columns + 1) * gap;
      canvas.height = rows * (frameHeight + labelHeight) + (rows + 1) * gap;
      context.fillStyle = '#111827';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.font = '16px system-ui, sans-serif';
      context.textBaseline = 'top';

      for (let index = 0; index < times.length; index += 1) {
        const time = Math.max(0, Math.min(Number(times[index]) || 0, Math.max(0, video.duration - 0.05)));
        await waitForSeek(time);

        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = gap + column * (frameWidth + gap);
        const y = gap + row * (frameHeight + labelHeight + gap);

        context.drawImage(video, x, y, frameWidth, frameHeight);
        context.fillStyle = 'rgba(0, 0, 0, 0.72)';
        context.fillRect(x, y + frameHeight, frameWidth, labelHeight);
        context.fillStyle = '#f9fafb';
        context.fillText(String(index + 1).padStart(2, '0') + '  ' + time.toFixed(2) + 's', x + 8, y + frameHeight + 5);
      }

      return canvas.toDataURL('image/png');
    };
  </script>
</body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function autoTimes(duration, count, startSec, endMarginSec) {
  const safeCount = Math.max(1, Math.floor(count || defaults.count));
  const start = clamp(startSec, 0, Math.max(0, duration - 0.1));
  const end = Math.max(start, duration - Math.max(0, endMarginSec));

  if (safeCount === 1) {
    return [start];
  }

  return Array.from({ length: safeCount }, (_, index) =>
    start + ((end - start) * index) / (safeCount - 1));
}

async function startChrome() {
  const debugPort = await getFreePort();
  const userDataDir = await mkdtemp(path.join(tmpdir(), "action-tracker-keyframes-chrome-"));
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

async function createPage(debugPort, url) {
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`,
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

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${expression}`);
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
