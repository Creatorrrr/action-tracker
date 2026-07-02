#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeMotionRecording,
  parseMotionRecordingJsonl,
} from "../src/motion-frame.js";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await main();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.live || !args.offline || args.help) {
    printUsage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  const live = await loadRecording(args.live);
  const offline = await loadRecording(args.offline);
  const report = compareRecordings(live, offline, {
    maxTimestampDeltaMs: args.maxTimestampDeltaMs,
  });

  if (args.output) {
    const outputPath = path.resolve(projectRoot, args.output);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.html) {
    const htmlPath = path.resolve(projectRoot, args.html);
    await mkdir(path.dirname(htmlPath), { recursive: true });
    await writeFile(htmlPath, renderComparisonHtml(report));
  }

  console.log(JSON.stringify({
    status: report.summary.pairedFrames > 0 ? "passed" : "failed",
    outputPath: args.output || "",
    htmlPath: args.html || "",
    summary: report.summary,
  }, null, 2));

  if (report.summary.pairedFrames === 0) {
    process.exitCode = 1;
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    live: "",
    offline: "",
    output: "",
    html: "",
    maxTimestampDeltaMs: 50,
    help: false,
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--live") {
      parsed.live = rawArgs[++index] ?? "";
    } else if (arg === "--offline") {
      parsed.offline = rawArgs[++index] ?? "";
    } else if (arg === "--output") {
      parsed.output = rawArgs[++index] ?? "";
    } else if (arg === "--html") {
      parsed.html = rawArgs[++index] ?? "";
    } else if (arg === "--max-timestamp-delta-ms") {
      parsed.maxTimestampDeltaMs = Number(rawArgs[++index] ?? parsed.maxTimestampDeltaMs);
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.maxTimestampDeltaMs) || parsed.maxTimestampDeltaMs < 0) {
    throw new Error("--max-timestamp-delta-ms must be a non-negative number.");
  }

  return parsed;
}

export async function loadRecording(inputPath) {
  const absolutePath = path.resolve(projectRoot, inputPath);
  const source = await readFile(absolutePath, "utf8");
  const recording = inputPath.endsWith(".jsonl")
    ? parseMotionRecordingJsonl(source)
    : JSON.parse(source);

  return normalizeMotionRecording(recording);
}

export function compareRecordings(live, offline, options = {}) {
  const maxTimestampDeltaMs = Number(options.maxTimestampDeltaMs ?? 50);
  const liveSolved = solveRecordingFrames(live.frames);
  const offlineSolved = solveRecordingFrames(offline.frames);
  const pairs = pairSolvedFrames(liveSolved, offlineSolved, maxTimestampDeltaMs);
  const targetAngleRows = [];
  const hingeFlexRows = [];

  for (const pair of pairs) {
    collectTargetAngleRows(targetAngleRows, pair);
    collectHingeFlexRows(hingeFlexRows, pair);
  }

  return {
    generatedAt: new Date().toISOString(),
    comparisonType: "live-vs-offline-motion-recording",
    maxTimestampDeltaMs,
    live: summarizeRecordingSource(live),
    offline: summarizeRecordingSource(offline),
    summary: {
      liveFrames: live.frames.length,
      offlineFrames: offline.frames.length,
      pairedFrames: pairs.length,
      unpairedLiveFrames: live.frames.length - pairs.length,
      targetAngle: summarizeRows(targetAngleRows, "angleDeltaDeg"),
      hingeFlex: summarizeRows(hingeFlexRows, "flexDeltaDeg"),
    },
    timeline: buildComparisonTimeline(pairs, targetAngleRows, hingeFlexRows),
    byTarget: summarizeRowsByKey(targetAngleRows, "bone", "angleDeltaDeg"),
    byHinge: summarizeRowsByKey(hingeFlexRows, "name", "flexDeltaDeg"),
    worstTargets: targetAngleRows
      .slice()
      .sort((a, b) => b.angleDeltaDeg - a.angleDeltaDeg)
      .slice(0, 20),
    worstHinges: hingeFlexRows
      .slice()
      .sort((a, b) => b.flexDeltaDeg - a.flexDeltaDeg)
      .slice(0, 20),
  };
}

export function renderComparisonHtml(report) {
  const title = "Live vs Offline Motion Comparison";
  const timeline = Array.isArray(report?.timeline) ? report.timeline : [];
  const summary = report?.summary ?? {};

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #16181d;
      --muted: #636b78;
      --border: #d8dde6;
      --accent: #0f766e;
      --warn: #b45309;
      --danger: #b91c1c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; }
    .muted { color: var(--muted); }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }
    .card, section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .card { padding: 14px 16px; }
    .metric { font-size: 24px; font-weight: 700; margin-top: 4px; }
    section { padding: 18px; margin-top: 16px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 16px;
    }
    svg {
      width: 100%;
      height: 220px;
      display: block;
      margin-top: 12px;
      background: #fbfcfe;
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    .axis { stroke: #cbd5e1; stroke-width: 1; }
    .line-target { fill: none; stroke: var(--accent); stroke-width: 2.5; }
    .line-hinge { fill: none; stroke: var(--warn); stroke-width: 2.5; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    .empty {
      padding: 20px;
      border: 1px dashed var(--border);
      border-radius: 6px;
      color: var(--muted);
      margin-top: 12px;
    }
    @media (max-width: 640px) {
      main { padding: 20px 12px 32px; }
      h1 { font-size: 22px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <div class="muted">Generated ${escapeHtml(report?.generatedAt ?? "")} · max timestamp delta ${formatNumber(report?.maxTimestampDeltaMs)}ms</div>
    </header>
    <div class="summary">
      ${renderMetricCard("Paired Frames", summary.pairedFrames)}
      ${renderMetricCard("Target Max", `${formatNumber(summary.targetAngle?.max)} deg`)}
      ${renderMetricCard("Target P95", `${formatNumber(summary.targetAngle?.p95)} deg`)}
      ${renderMetricCard("Hinge Max", `${formatNumber(summary.hingeFlex?.max)} deg`)}
      ${renderMetricCard("Hinge P95", `${formatNumber(summary.hingeFlex?.p95)} deg`)}
    </div>
    <div class="grid">
      <section>
        <h2>Target Angle Delta Timeline</h2>
        <div class="muted">Per paired frame max target-direction delta in degrees.</div>
        ${renderTimelineSvg(timeline, "targetAngleMaxDeg", "line-target")}
      </section>
      <section>
        <h2>Hinge Flex Delta Timeline</h2>
        <div class="muted">Per paired frame max elbow/knee flexion delta in degrees.</div>
        ${renderTimelineSvg(timeline, "hingeFlexMaxDeg", "line-hinge")}
      </section>
    </div>
    <section>
      <h2>Targets By Bone</h2>
      ${renderSummaryTable(report?.byTarget, "Bone")}
    </section>
    <section>
      <h2>Hinges By Joint</h2>
      ${renderSummaryTable(report?.byHinge, "Joint")}
    </section>
    <div class="grid">
      <section>
        <h2>Worst Target Frames</h2>
        ${renderWorstTargets(report?.worstTargets)}
      </section>
      <section>
        <h2>Worst Hinge Frames</h2>
        ${renderWorstHinges(report?.worstHinges)}
      </section>
    </div>
  </main>
</body>
</html>
`;
}

function solveRecordingFrames(frames) {
  let previousState = {};

  return frames.map((frame, index) => {
    const solved = solvePoseFrame(frame, previousState);
    previousState = solved.state;

    return {
      index,
      timestamp: Number(frame.timestamp ?? 0),
      frame,
      solved,
    };
  });
}

function buildComparisonTimeline(pairs, targetAngleRows, hingeFlexRows) {
  const targetRowsByLiveIndex = groupRowsByKey(targetAngleRows, "liveIndex");
  const hingeRowsByLiveIndex = groupRowsByKey(hingeFlexRows, "liveIndex");

  return pairs.map((pair) => {
    const targets = targetRowsByLiveIndex[pair.live.index] ?? [];
    const hinges = hingeRowsByLiveIndex[pair.live.index] ?? [];
    const targetSummary = summarizeRows(targets, "angleDeltaDeg");
    const hingeSummary = summarizeRows(hinges, "flexDeltaDeg");

    return {
      liveIndex: pair.live.index,
      offlineIndex: pair.offline.index,
      timestamp: round(pair.live.timestamp, 3),
      timestampDeltaMs: round(pair.timestampDeltaMs, 3),
      targetAngleMeanDeg: targetSummary.mean,
      targetAngleP95Deg: targetSummary.p95,
      targetAngleMaxDeg: targetSummary.max,
      hingeFlexMeanDeg: hingeSummary.mean,
      hingeFlexP95Deg: hingeSummary.p95,
      hingeFlexMaxDeg: hingeSummary.max,
    };
  });
}

function pairSolvedFrames(liveSolved, offlineSolved, maxTimestampDeltaMs) {
  const pairs = [];
  let offlineCursor = 0;

  for (const liveFrame of liveSolved) {
    let best = null;

    for (let index = offlineCursor; index < offlineSolved.length; index += 1) {
      const offlineFrame = offlineSolved[index];
      const timestampDeltaMs = Math.abs(offlineFrame.timestamp - liveFrame.timestamp);

      if (timestampDeltaMs <= maxTimestampDeltaMs && (!best || timestampDeltaMs < best.timestampDeltaMs)) {
        best = { offlineIndex: index, offlineFrame, timestampDeltaMs };
      }

      if (offlineFrame.timestamp - liveFrame.timestamp > maxTimestampDeltaMs) {
        break;
      }
    }

    if (best) {
      offlineCursor = best.offlineIndex + 1;
      pairs.push({
        live: liveFrame,
        offline: best.offlineFrame,
        timestampDeltaMs: best.timestampDeltaMs,
      });
    }
  }

  return pairs;
}

function collectTargetAngleRows(rows, pair) {
  const offlineTargets = new Map(pair.offline.solved.targets.map((target) => [target.bone, target]));

  for (const liveTarget of pair.live.solved.targets) {
    const offlineTarget = offlineTargets.get(liveTarget.bone);

    if (!offlineTarget) {
      continue;
    }

    rows.push({
      liveIndex: pair.live.index,
      offlineIndex: pair.offline.index,
      timestampDeltaMs: pair.timestampDeltaMs,
      bone: liveTarget.bone,
      group: liveTarget.group,
      angleDeltaDeg: round(directionAngleDeg(liveTarget.direction, offlineTarget.direction), 3),
      liveConfidence: liveTarget.confidence,
      offlineConfidence: offlineTarget.confidence,
    });
  }
}

function collectHingeFlexRows(rows, pair) {
  const offlineHinges = new Map(pair.offline.solved.hinges.map((hinge) => [hinge.name, hinge]));

  for (const liveHinge of pair.live.solved.hinges) {
    const offlineHinge = offlineHinges.get(liveHinge.name);

    if (!offlineHinge || !Number.isFinite(liveHinge.flexDeg) || !Number.isFinite(offlineHinge.flexDeg)) {
      continue;
    }

    rows.push({
      liveIndex: pair.live.index,
      offlineIndex: pair.offline.index,
      timestampDeltaMs: pair.timestampDeltaMs,
      name: liveHinge.name,
      group: liveHinge.group,
      flexDeltaDeg: round(Math.abs(liveHinge.flexDeg - offlineHinge.flexDeg), 3),
      liveConfidence: liveHinge.confidence,
      offlineConfidence: offlineHinge.confidence,
    });
  }
}

function summarizeRecordingSource(recording) {
  return {
    source: recording.source ?? {},
    frameCount: recording.frames.length,
    createdAt: recording.createdAt,
    droppedFrames: recording.droppedFrames,
  };
}

function summarizeRows(rows, valueKey) {
  const values = rows
    .map((row) => row[valueKey])
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      p95: 0,
      max: 0,
    };
  }

  return {
    count: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length, 3),
    p95: round(percentile(values, 0.95), 3),
    max: round(values[values.length - 1], 3),
  };
}

function summarizeRowsByKey(rows, key, valueKey) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";

    if (!result[value]) {
      result[value] = summarizeRows(rows.filter((candidate) => candidate[key] === value), valueKey);
    }

    return result;
  }, {});
}

function groupRowsByKey(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? "unknown";
    result[value] = result[value] ?? [];
    result[value].push(row);
    return result;
  }, {});
}

function renderMetricCard(label, value) {
  return `<div class="card"><div class="muted">${escapeHtml(label)}</div><div class="metric">${escapeHtml(String(value ?? "0"))}</div></div>`;
}

function renderTimelineSvg(rows, key, className) {
  const values = rows.map((row) => Number(row?.[key] ?? 0)).filter(Number.isFinite);

  if (values.length === 0) {
    return '<div class="empty">No paired frames to plot.</div>';
  }

  const width = 720;
  const height = 220;
  const padding = 28;
  const maxValue = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1
      ? width / 2
      : padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - (value / maxValue) * (height - padding * 2);
    return `${round(x, 2)},${round(y, 2)}`;
  }).join(" ");

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(key)} timeline">
  <line class="axis" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
  <line class="axis" x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}"></line>
  <text x="${padding}" y="18" fill="#64748b" font-size="12">max ${formatNumber(maxValue)} deg</text>
  <polyline class="${escapeHtml(className)}" points="${points}"></polyline>
</svg>`;
}

function renderSummaryTable(summaryByKey, label) {
  const entries = Object.entries(summaryByKey ?? {})
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return '<div class="empty">No rows available.</div>';
  }

  const rows = entries.map(([name, summary]) => `<tr>
    <td>${escapeHtml(name)}</td>
    <td>${formatNumber(summary.count, 0)}</td>
    <td>${formatNumber(summary.mean)}</td>
    <td>${formatNumber(summary.p95)}</td>
    <td>${formatNumber(summary.max)}</td>
  </tr>`).join("");

  return `<table>
    <thead><tr><th>${escapeHtml(label)}</th><th>Count</th><th>Mean</th><th>P95</th><th>Max</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderWorstTargets(rows) {
  const values = Array.isArray(rows) ? rows : [];

  if (values.length === 0) {
    return '<div class="empty">No target differences.</div>';
  }

  return `<table>
    <thead><tr><th>Live</th><th>Offline</th><th>Bone</th><th>Group</th><th>Delta</th></tr></thead>
    <tbody>${values.map((row) => `<tr>
      <td>${formatNumber(row.liveIndex, 0)}</td>
      <td>${formatNumber(row.offlineIndex, 0)}</td>
      <td>${escapeHtml(row.bone)}</td>
      <td>${escapeHtml(row.group)}</td>
      <td>${formatNumber(row.angleDeltaDeg)} deg</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderWorstHinges(rows) {
  const values = Array.isArray(rows) ? rows : [];

  if (values.length === 0) {
    return '<div class="empty">No hinge differences.</div>';
  }

  return `<table>
    <thead><tr><th>Live</th><th>Offline</th><th>Joint</th><th>Group</th><th>Delta</th></tr></thead>
    <tbody>${values.map((row) => `<tr>
      <td>${formatNumber(row.liveIndex, 0)}</td>
      <td>${formatNumber(row.offlineIndex, 0)}</td>
      <td>${escapeHtml(row.name)}</td>
      <td>${escapeHtml(row.group)}</td>
      <td>${formatNumber(row.flexDeltaDeg)} deg</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "0";
}

function directionAngleDeg(a, b) {
  if (!a || !b) {
    return 0;
  }

  const dot = (a.x * b.x) + (a.y * b.y) + (a.z * b.z);
  const aLength = Math.hypot(a.x, a.y, a.z);
  const bLength = Math.hypot(b.x, b.y, b.z);

  if (aLength <= 0 || bLength <= 0) {
    return 0;
  }

  const cosine = Math.max(-1, Math.min(1, dot / (aLength * bLength)));
  return Math.acos(cosine) * (180 / Math.PI);
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );

  return sortedValues[index];
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function printUsage() {
  console.log(`Usage:
  node scripts/motion-recording-compare.mjs --live live.jsonl --offline offline.jsonl --output output/reports/live-vs-offline.json --html output/reports/live-vs-offline.html

Both inputs must be action-tracker motion recordings in JSON or JSONL form.
The report pairs frames by timestamp, solves both recordings through the pure
pose solver, summarizes target direction and hinge flexion differences, and can
write a static HTML timeline report with --html.
`);
}
