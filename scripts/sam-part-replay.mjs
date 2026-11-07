#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { startStaticServer, startChrome, createPage, CdpClient, evaluate, waitForExpression } from "./avatar-motion-agreement-check.mjs";

// Each case consumes the full causal live stream. Teacher rendering stays on a
// separately frozen source tree, at its full decoder cadence.
const [manifestPath, casesPath, outputDirectory] = process.argv.slice(2);
if (!manifestPath || !casesPath || !outputDirectory) throw new Error("Usage: node scripts/sam-part-replay.mjs MANIFEST CASES OUTPUT_DIRECTORY");
const root = path.resolve(new URL("../", import.meta.url).pathname);
const manifest = JSON.parse(await readFile(manifestPath));
const configBytes = await readFile(casesPath);
const config = JSON.parse(configBytes);
if (!config.referenceRendererUrl) throw new Error("A frozen referenceRendererUrl is required");
await mkdir(outputDirectory, { recursive: true });
const sourceDirectory = path.join(outputDirectory, "source");
await mkdir(sourceDirectory);
await cp(path.join(root, "src"), path.join(sourceDirectory, "src"), { recursive: true });
await mkdir(path.join(sourceDirectory, "scripts"));
await cp(path.join(root, "scripts/sam-paired-renderer-probe.mjs"), path.join(sourceDirectory, "scripts/sam-paired-renderer-probe.mjs"));
await cp(path.join(root, "scripts/lib"), path.join(sourceDirectory, "scripts/lib"), { recursive: true });
const sourceFiles = {};
for (const name of await readdir(sourceDirectory, { recursive: true, withFileTypes: true })) {
  if (!name.isFile()) continue;
  const file = path.join(name.parentPath, name.name);
  sourceFiles[path.relative(sourceDirectory, file)] = createHash("sha256").update(await readFile(file)).digest("hex");
}
await writeFile(path.join(outputDirectory, "source-hashes.json"), JSON.stringify(sourceFiles, null, 2) + "\n");
const probeModuleUrl = `/${path.relative(root, path.resolve(sourceDirectory, "scripts/sam-paired-renderer-probe.mjs"))}`;
const server = await startStaticServer(root);
let chrome;
const outputs = [];
try {
  chrome = await startChrome("headful");
  for (const clip of manifest.clips) {
    for (const rig of clip.replays) {
      if (config.rigs && !config.rigs.includes(rig.rig)) continue;
      const page = await createPage(chrome.debugPort, `http://127.0.0.1:${server.port}/?validation=1&face-tracking=off`);
      const client = new CdpClient(page.webSocketDebuggerUrl);
      await client.open();
      try {
        await client.send("Runtime.enable");
        await waitForExpression(client, "document.readyState === 'complete'", 60000);
        const corpusUrl = `/${clip.corpus}`;
        const invocation = { modelUrl: rig.modelUrl, referenceRendererUrl: config.referenceRendererUrl,
          variants: config.variants.map(variant => ({ ...variant,
            rendererOptions: { ...variant.rendererOptions, ...(clip.sourceImageSize ? { sourceImageSize: clip.sourceImageSize } : {}) } })) };
        console.log(`Replay ${clip.label}/${rig.rig}: ${config.variants.map(variant => variant.mode).join(', ')}`);
        await evaluate(client, `(async () => {
          window.partReplayStatus = { phase: 'loading' };
          try {
            const { probePairedRenderer } = await import(${JSON.stringify(probeModuleUrl)});
            const corpus = await (await fetch(${JSON.stringify(corpusUrl)})).json();
            window.partReplayResult = await probePairedRenderer({ corpus, ...${JSON.stringify(invocation)},
              onProgress: status => { window.partReplayStatus = status; } });
            window.partReplayStatus = { phase: 'complete' };
          } catch (error) { window.partReplayStatus = { phase: 'failed', message: error.stack ?? String(error) }; }
        })(); 'started'`);
        let last = "";
        const deadline = Date.now() + 240000;
        while (true) {
          const status = await evaluate(client, "window.partReplayStatus");
          if (status?.phase === "failed") throw new Error(status.message);
          if (status?.phase === "complete") break;
          if (Date.now() > deadline) throw new Error(`Replay timeout: ${JSON.stringify(status)}`);
          const progress = `${status?.mode ?? status?.phase}:${status?.index ?? ''}`;
          if (progress !== last) { console.log(`  ${progress}`); last = progress; }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        const report = await evaluate(client, "window.partReplayResult");
        const filename = `${clip.label}-${rig.rig.toLowerCase()}-replay.json`;
        report.replayExecution = { casesPath, casesSha256: createHash("sha256").update(configBytes).digest("hex"),
          browser: chrome.browserVersion, note: "Accelerated causal replay, not realtime inference" };
        await writeFile(path.join(outputDirectory, filename), JSON.stringify(report) + "\n");
        outputs.push({ clipId: clip.clipId, rig: rig.rig, path: path.join(outputDirectory, filename) });
        console.log(`  saved ${filename}`);
      } finally {
        await client.close();
        await fetch(`http://127.0.0.1:${chrome.debugPort}/json/close/${page.id}`);
      }
    }
  }
  await writeFile(path.join(outputDirectory, "replays.json"), JSON.stringify(outputs, null, 2) + "\n");
} finally { await chrome?.close(); await server.close(); }
