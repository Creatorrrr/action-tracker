#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileManualLabels,
  crossCheckManualAgainstAutoLabels,
} from "../src/labels/manual-labels.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.input || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const manualSpec = JSON.parse(await readFile(path.resolve(projectRoot, args.input), "utf8"));
  const labels = compileManualLabels(manualSpec);
  const crossCheck = args.auto
    ? crossCheckManualAgainstAutoLabels(
      labels,
      JSON.parse(await readFile(path.resolve(projectRoot, args.auto), "utf8")),
    )
    : null;

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(labels, null, 2)}\n`);
  }

  if (args.report) {
    const reportPath = path.resolve(projectRoot, args.report);
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      status: "passed",
      input: args.input,
      auto: args.auto || "",
      output: args.output || "",
      summary: labels.summary,
      crossCheck,
    }, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: "passed",
    outputPath: args.output || "",
    reportPath: args.report || "",
    frameCount: labels.frames.length,
    windowCount: labels.windows.length,
    summary: labels.summary,
    crossCheck,
  }, null, 2));
}

function parseArgs(rawArgs) {
  const parsed = {
    input: "",
    auto: "",
    output: "",
    report: "",
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--input") {
      parsed.input = rawArgs[++index] ?? "";
    } else if (arg === "--auto") {
      parsed.auto = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--report") {
      parsed.report = rawArgs[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (!parsed.input) {
      parsed.input = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printUsage() {
  console.log(`Usage:
  node scripts/sam-manual-labels.mjs --input tests/fixtures/sam-manual-labels/csi-pose.json --output output/external/sam-3d-body/csi-pose/compiled-labels.json
  node scripts/sam-manual-labels.mjs --input tests/fixtures/sam-manual-labels/csi-pose.json --auto output/external/sam-3d-body/csi-pose/labels.json --report output/reports/csi-pose-label-cross-check.json

Compiles human-authored csi-pose segment labels into action-tracker comparison
windows and frame labels. The output also marks manual reference-invalid
windows for absent, hands-out-of-frame, or unobservable-finger segments.
`);
}
