#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

export {
  compareRetargetReports,
  renderRetargetComparisonHtml,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.legacy || !args.strict || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const legacyReport = JSON.parse(await readFile(path.resolve(projectRoot, args.legacy), "utf8"));
  const strictReport = JSON.parse(await readFile(path.resolve(projectRoot, args.strict), "utf8"));
  const report = compareRetargetReports(legacyReport, strictReport, {
    legacyPath: args.legacy,
    strictPath: args.strict,
  });

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.html) {
    const htmlPath = path.resolve(projectRoot, args.html);
    await mkdir(path.dirname(htmlPath), { recursive: true });
    await writeFile(htmlPath, renderRetargetComparisonHtml(report));
  }

  console.log(JSON.stringify({
    status: report.summary.passed ? "passed" : "watch",
    outputPath: args.output || "",
    htmlPath: args.html || "",
    summary: report.summary,
  }, null, 2));
}

function parseArgs(rawArgs) {
  const parsed = {
    legacy: "",
    strict: "",
    output: "",
    html: "",
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--legacy") {
      parsed.legacy = rawArgs[++index] ?? "";
    } else if (arg === "--strict") {
      parsed.strict = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--html") {
      parsed.html = rawArgs[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function compareRetargetReports(legacyReport, strictReport, options = {}) {
  const legacyRows = flattenModels(legacyReport).map((entry) => normalizeModelSummary(entry, "legacy"));
  const strictRows = flattenModels(strictReport).map((entry) => normalizeModelSummary(entry, "strict"));
  const pairs = [];

  for (const strictRow of strictRows) {
    const legacyRow = legacyRows.find((row) =>
      row.videoLabel === strictRow.videoLabel &&
      row.label === strictRow.label
    ) ?? legacyRows.find((row) => row.label === strictRow.label);

    if (!legacyRow) {
      continue;
    }

    pairs.push(compareRows(legacyRow, strictRow));
  }

  return {
    generatedAt: new Date().toISOString(),
    comparisonType: "retarget-mode-report-comparison",
    legacyPath: options.legacyPath ?? "",
    strictPath: options.strictPath ?? "",
    summary: summarizePairs(pairs),
    pairs,
    legacyModels: legacyRows,
    strictModels: strictRows,
  };
}

function flattenModels(report) {
  if (Array.isArray(report?.models)) {
    return report.models;
  }

  return (report?.videos ?? []).flatMap((video) =>
    (video.models ?? []).map((model) => ({
      ...model,
      videoLabel: model.videoLabel ?? video.label,
      videoPath: model.videoPath ?? video.videoPath,
    })),
  );
}

function normalizeModelSummary(entry, fallbackMode) {
  const summary = entry?.summary ?? {};

  return {
    label: entry?.label ?? "unknown",
    videoLabel: entry?.videoLabel ?? "",
    videoPath: entry?.videoPath ?? "",
    mode: summary.avatarRetargetMode ?? fallbackMode,
    framesWithPose: numberOrNull(summary.framesWithPose),
    overallPercent: numberOrNull(summary.overallPercent),
    angularP90Deg: numberOrNull(summary.sourceAvatarAngularP90Deg),
    angularMaxDeg: numberOrNull(summary.sourceAvatarAngularMaxDeg),
    palmInversionRatio: numberOrNull(summary.sourceAvatarPalmInversionRatio),
    rootYawTargetP90Deg: numberOrNull(summary.sourceAvatarRootYawTargetP90Deg),
    poseSolverP95Ms: numberOrNull(summary.poseSolverP95Ms),
    failures: entry?.failures ?? [],
    warnings: entry?.warnings ?? [],
  };
}

function compareRows(legacy, strict) {
  return {
    videoLabel: strict.videoLabel || legacy.videoLabel,
    label: strict.label,
    legacy,
    strict,
    deltas: {
      angularP90Deg: delta(legacy.angularP90Deg, strict.angularP90Deg),
      angularMaxDeg: delta(legacy.angularMaxDeg, strict.angularMaxDeg),
      palmInversionRatio: delta(legacy.palmInversionRatio, strict.palmInversionRatio),
      rootYawTargetP90Deg: delta(legacy.rootYawTargetP90Deg, strict.rootYawTargetP90Deg),
      poseSolverP95Ms: delta(legacy.poseSolverP95Ms, strict.poseSolverP95Ms),
    },
    improved: {
      angularP90Deg: improvesLowerIsBetter(legacy.angularP90Deg, strict.angularP90Deg),
      palmInversionRatio: improvesLowerIsBetter(legacy.palmInversionRatio, strict.palmInversionRatio),
      rootYawTargetP90Deg: improvesLowerIsBetter(legacy.rootYawTargetP90Deg, strict.rootYawTargetP90Deg),
    },
  };
}

function summarizePairs(pairs) {
  const angularPairs = pairs.filter((pair) =>
    Number.isFinite(pair.legacy.angularP90Deg) &&
    Number.isFinite(pair.strict.angularP90Deg)
  );
  const angularMaxPairs = pairs.filter((pair) =>
    Number.isFinite(pair.legacy.angularMaxDeg) &&
    Number.isFinite(pair.strict.angularMaxDeg)
  );
  const palmPairs = pairs.filter((pair) =>
    Number.isFinite(pair.legacy.palmInversionRatio) &&
    Number.isFinite(pair.strict.palmInversionRatio)
  );
  const rootPairs = pairs.filter((pair) =>
    Number.isFinite(pair.legacy.rootYawTargetP90Deg) &&
    Number.isFinite(pair.strict.rootYawTargetP90Deg)
  );
  const poseSolverPairs = pairs.filter((pair) =>
    Number.isFinite(pair.strict.poseSolverP95Ms)
  );
  const strictImprovedAngularP90 = angularPairs.length > 0 &&
    angularPairs.every((pair) => pair.strict.angularP90Deg <= pair.legacy.angularP90Deg);
  const strictImprovedAngularMax = angularMaxPairs.length > 0 &&
    angularMaxPairs.every((pair) => pair.strict.angularMaxDeg <= pair.legacy.angularMaxDeg);
  const strictImprovedPalmInversion = palmPairs.length > 0 &&
    palmPairs.every((pair) => pair.strict.palmInversionRatio <= pair.legacy.palmInversionRatio);
  const strictImprovedRootYaw = rootPairs.length > 0 &&
    rootPairs.every((pair) => pair.strict.rootYawTargetP90Deg <= pair.legacy.rootYawTargetP90Deg);
  const strictPoseSolverWithinBudget = poseSolverPairs.length > 0 &&
    poseSolverPairs.every((pair) => pair.strict.poseSolverP95Ms <= 2);
  const passed =
    pairs.length > 0 &&
    strictImprovedAngularP90 &&
    strictImprovedAngularMax &&
    strictImprovedPalmInversion &&
    strictImprovedRootYaw &&
    strictPoseSolverWithinBudget;

  return {
    pairCount: pairs.length,
    angularPairCount: angularPairs.length,
    angularMaxPairCount: angularMaxPairs.length,
    palmPairCount: palmPairs.length,
    rootYawPairCount: rootPairs.length,
    strictImprovedAngularP90,
    strictImprovedAngularMax,
    strictImprovedPalmInversion,
    strictImprovedRootYaw,
    strictPoseSolverWithinBudget,
    passed,
    angularP90Delta: summarizeDeltas(pairs.map((pair) => pair.deltas.angularP90Deg)),
    angularMaxDelta: summarizeDeltas(pairs.map((pair) => pair.deltas.angularMaxDeg)),
    palmInversionDelta: summarizeDeltas(pairs.map((pair) => pair.deltas.palmInversionRatio)),
    rootYawTargetDelta: summarizeDeltas(pairs.map((pair) => pair.deltas.rootYawTargetP90Deg)),
    poseSolverP95Delta: summarizeDeltas(pairs.map((pair) => pair.deltas.poseSolverP95Ms)),
  };
}

function summarizeDeltas(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);

  if (sorted.length === 0) {
    return { count: 0, mean: 0, min: 0, max: 0 };
  }

  return {
    count: sorted.length,
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length, 6),
    min: round(sorted[0], 6),
    max: round(sorted[sorted.length - 1], 6),
  };
}

function renderRetargetComparisonHtml(report) {
  const rows = (report?.pairs ?? []).map((pair) => `
      <tr>
        <td>${escapeHtml(pair.videoLabel || "-")}</td>
        <td>${escapeHtml(pair.label)}</td>
        <td>${formatNumber(pair.legacy.angularP90Deg)}</td>
        <td>${formatNumber(pair.strict.angularP90Deg)}</td>
        <td>${formatDelta(pair.deltas.angularP90Deg)}</td>
        <td>${formatNumber(pair.legacy.palmInversionRatio)}</td>
        <td>${formatNumber(pair.strict.palmInversionRatio)}</td>
        <td>${formatDelta(pair.deltas.palmInversionRatio)}</td>
        <td>${formatNumber(pair.legacy.rootYawTargetP90Deg)}</td>
        <td>${formatNumber(pair.strict.rootYawTargetP90Deg)}</td>
      </tr>`).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Retarget Mode Comparison</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #111827; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .muted { color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; background: #fff; border: 1px solid #d8dee9; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e5e7eb; font-size: 13px; }
    th { color: #475569; background: #f1f5f9; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 20px; }
    .card { background: #fff; border: 1px solid #d8dee9; border-radius: 8px; padding: 14px; }
    .metric { font-size: 24px; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Retarget Mode Comparison</h1>
    <div class="muted">Generated ${escapeHtml(report?.generatedAt ?? "")}</div>
    <div class="summary">
      <div class="card"><div class="muted">Pairs</div><div class="metric">${formatNumber(report?.summary?.pairCount, 0)}</div></div>
      <div class="card"><div class="muted">Overall Status</div><div class="metric">${report?.summary?.passed ? "passed" : "watch"}</div></div>
      <div class="card"><div class="muted">Angular P90 Delta Mean</div><div class="metric">${formatDelta(report?.summary?.angularP90Delta?.mean)}</div></div>
      <div class="card"><div class="muted">Angular Max Delta Mean</div><div class="metric">${formatDelta(report?.summary?.angularMaxDelta?.mean)}</div></div>
      <div class="card"><div class="muted">Palm Delta Mean</div><div class="metric">${formatDelta(report?.summary?.palmInversionDelta?.mean)}</div></div>
      <div class="card"><div class="muted">Root Yaw Delta Mean</div><div class="metric">${formatDelta(report?.summary?.rootYawTargetDelta?.mean)}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Video</th>
          <th>Model</th>
          <th>Legacy Angular P90</th>
          <th>Strict Angular P90</th>
          <th>Delta</th>
          <th>Legacy Palm Inv.</th>
          <th>Strict Palm Inv.</th>
          <th>Palm Delta</th>
          <th>Legacy Root Yaw P90</th>
          <th>Strict Root Yaw P90</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="10">No comparable model rows.</td></tr>'}</tbody>
    </table>
  </main>
</body>
</html>`;
}

function delta(before, after) {
  return Number.isFinite(before) && Number.isFinite(after)
    ? round(after - before, 6)
    : null;
}

function improvesLowerIsBetter(before, after) {
  return Number.isFinite(before) && Number.isFinite(after) ? after <= before : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDelta(value) {
  return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : ""}${formatNumber(value)}` : "n/a";
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "n/a";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

function printUsage() {
  console.log(`Usage:
  node scripts/retarget-mode-compare.mjs --legacy output/reports/legacy.json --strict output/reports/strict.json --output output/reports/retarget-compare.json --html output/reports/retarget-compare.html
`);
}
