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
const FACING_YAW_MATCH_THRESHOLD_DEG = 30;
const ARM_OCCLUSION_WINDOW_KINDS = new Set([
  "crossed-arms",
  "left-behind-back",
  "right-behind-back",
]);

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
  const labels = args.labels ? await loadLabels(args.labels) : null;
  const report = compareRecordings(live, offline, {
    maxTimestampDeltaMs: args.maxTimestampDeltaMs,
    timestampSource: args.timestampSource,
    timestampWrap: args.timestampWrap,
    interpolate: args.interpolate,
    offsetMs: args.offsetMs,
    labels,
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
    labels: "",
    maxTimestampDeltaMs: 50,
    timestampSource: "timestamp",
    timestampWrap: "none",
    interpolate: "none",
    offsetMs: 0,
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
    } else if (arg === "--labels") {
      parsed.labels = rawArgs[++index] ?? "";
    } else if (arg === "--max-timestamp-delta-ms") {
      parsed.maxTimestampDeltaMs = Number(rawArgs[++index] ?? parsed.maxTimestampDeltaMs);
    } else if (arg === "--timestamp-source") {
      parsed.timestampSource = rawArgs[++index] ?? parsed.timestampSource;
    } else if (arg === "--timestamp-wrap") {
      parsed.timestampWrap = rawArgs[++index] ?? parsed.timestampWrap;
    } else if (arg === "--interpolate") {
      parsed.interpolate = rawArgs[++index] ?? parsed.interpolate;
    } else if (arg === "--offset-ms") {
      parsed.offsetMs = rawArgs[++index] ?? parsed.offsetMs;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(parsed.maxTimestampDeltaMs) || parsed.maxTimestampDeltaMs < 0) {
    throw new Error("--max-timestamp-delta-ms must be a non-negative number.");
  }
  if (!["timestamp", "sourceMeta.videoTime"].includes(parsed.timestampSource)) {
    throw new Error("--timestamp-source must be timestamp or sourceMeta.videoTime.");
  }
  if (!["none", "offline-duration"].includes(parsed.timestampWrap)) {
    throw new Error("--timestamp-wrap must be none or offline-duration.");
  }
  if (!["none", "offline"].includes(parsed.interpolate)) {
    throw new Error("--interpolate must be none or offline.");
  }
  if (parsed.offsetMs !== "auto") {
    parsed.offsetMs = Number(parsed.offsetMs);
    if (!Number.isFinite(parsed.offsetMs)) {
      throw new Error("--offset-ms must be a number or auto.");
    }
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

export async function loadLabels(inputPath) {
  const absolutePath = path.resolve(projectRoot, inputPath);
  return JSON.parse(await readFile(absolutePath, "utf8"));
}

export function compareRecordings(live, offline, options = {}) {
  const maxTimestampDeltaMs = Number(options.maxTimestampDeltaMs ?? 50);
  const timestampSource = options.timestampSource ?? "timestamp";
  const interpolate = options.interpolate ?? "none";
  const timestampWrap = options.timestampWrap ?? "none";
  const offlineDurationMs = timestampWrap === "offline-duration"
    ? estimateRecordingDurationMs(offline.frames, timestampSource)
    : 0;
  const liveSolved = solveRecordingFrames(live.frames, {
    timestampSource,
    timestampWrapMs: offlineDurationMs,
  });
  const offlineSolved = solveRecordingFrames(offline.frames, {
    timestampSource,
    targetStabilization: false,
  });
  const estimatedOffsetMs = options.offsetMs === "auto"
    ? estimateTimestampOffsetMs(liveSolved, offlineSolved, maxTimestampDeltaMs)
    : Number(options.offsetMs ?? 0);
  const pairs = interpolate === "offline"
    ? pairLiveFramesWithInterpolatedOffline(liveSolved, offline.frames, {
      maxTimestampDeltaMs,
      timestampSource,
      offlineTimestampOffsetMs: estimatedOffsetMs,
    })
    : pairSolvedFrames(liveSolved, offlineSolved, {
      maxTimestampDeltaMs,
      offlineTimestampOffsetMs: estimatedOffsetMs,
    });
  const targetAngleRows = [];
  const hingeFlexRows = [];
  const labels = normalizeReferenceLabels(options.labels);
  const facingRows = [];

  for (const pair of pairs) {
    collectTargetAngleRows(targetAngleRows, pair);
    collectHingeFlexRows(hingeFlexRows, pair);
    collectFacingRows(facingRows, pair, findReferenceLabelForPair(pair, labels, maxTimestampDeltaMs));
  }

  return {
    generatedAt: new Date().toISOString(),
    comparisonType: "live-vs-offline-motion-recording",
    maxTimestampDeltaMs,
    timestampSource,
    timestampWrap,
    timestampWrapMs: round(offlineDurationMs, 3),
    interpolate,
    liveTargetStabilization: true,
    offlineTargetStabilization: false,
    offsetMs: options.offsetMs ?? 0,
    estimatedOffsetMs: round(estimatedOffsetMs, 3),
    live: summarizeRecordingSource(live),
    offline: summarizeRecordingSource(offline),
    summary: {
      liveFrames: live.frames.length,
      offlineFrames: offline.frames.length,
      pairedFrames: pairs.length,
      unpairedLiveFrames: live.frames.length - pairs.length,
      pairedRatio: round(ratio(pairs.length, live.frames.length), 6),
      offlineUsedFrames: countUniqueOfflineFrames(pairs),
      offlineUsageRatio: round(ratio(countUniqueOfflineFrames(pairs), offline.frames.length), 6),
      timestampDelta: summarizeRows(pairs.map((pair) => ({
        timestampDeltaMs: pair.timestampDeltaMs,
        confidenceWeight: 1,
      })), "timestampDeltaMs"),
      targetAngle: summarizeRows(targetAngleRows, "angleDeltaDeg"),
      occlusionArmTargetAngle: summarizeRows(rowsInWindowKinds(
        targetAngleRows.filter((row) => row.group === "arms"),
        labels.windows,
        ARM_OCCLUSION_WINDOW_KINDS,
      ), "angleDeltaDeg"),
      hingeFlex: summarizeRows(hingeFlexRows, "flexDeltaDeg"),
      facingAgreement: summarizeFacingRows(facingRows),
    },
    timeline: buildComparisonTimeline(pairs, targetAngleRows, hingeFlexRows),
    byTarget: summarizeRowsByKey(targetAngleRows, "bone", "angleDeltaDeg"),
    byHinge: summarizeRowsByKey(hingeFlexRows, "name", "flexDeltaDeg"),
    byLabelWindowKind: summarizeRowsByLabelWindowKind(labels.windows, targetAngleRows, hingeFlexRows, facingRows),
    byReferenceFacing: summarizeFacingRowsByState(facingRows),
    facingRows,
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
      <div class="muted">Generated ${escapeHtml(report?.generatedAt ?? "")} · timestamp ${escapeHtml(report?.timestampSource ?? "timestamp")} · wrap ${escapeHtml(report?.timestampWrap ?? "none")} · max delta ${formatNumber(report?.maxTimestampDeltaMs)}ms · interpolation ${escapeHtml(report?.interpolate ?? "none")} · offset ${formatNumber(report?.estimatedOffsetMs)}ms</div>
    </header>
    <div class="summary">
      ${renderMetricCard("Paired Frames", summary.pairedFrames)}
      ${renderMetricCard("Paired Ratio", `${formatNumber((summary.pairedRatio ?? 0) * 100, 1)}%`)}
      ${renderMetricCard("Target Max", `${formatNumber(summary.targetAngle?.max)} deg`)}
      ${renderMetricCard("Target P95", `${formatNumber(summary.targetAngle?.p95)} deg`)}
      ${renderMetricCard("Target Weighted Mean", `${formatNumber(summary.targetAngle?.weightedMean)} deg`)}
      ${renderMetricCard("Hinge Max", `${formatNumber(summary.hingeFlex?.max)} deg`)}
      ${renderMetricCard("Hinge P95", `${formatNumber(summary.hingeFlex?.p95)} deg`)}
      ${renderMetricCard("Facing Agreement", `${formatNumber((summary.facingAgreement?.agreementRatio ?? 0) * 100, 1)}%`)}
      ${renderMetricCard("Back/Side Facing", `${formatNumber((summary.facingAgreement?.backSideAgreementRatio ?? 0) * 100, 1)}%`)}
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

function solveRecordingFrames(frames, options = {}) {
  let previousState = {};
  const timestampSource = options.timestampSource ?? "timestamp";
  const timestampWrapMs = Number(options.timestampWrapMs ?? 0);
  const targetStabilization = options.targetStabilization !== false;

  return frames.map((frame, index) => {
    const solved = solvePoseFrame(frame, previousState, { targetStabilization });
    previousState = solved.state;
    const timestamp = readFrameTimestampMs(frame, timestampSource);

    return {
      index,
      timestamp: timestampWrapMs > 0 ? wrapTimestampMs(timestamp, timestampWrapMs) : timestamp,
      rawTimestamp: timestamp,
      frame,
      solved,
    };
  });
}

function readFrameTimestampMs(frame, timestampSource) {
  if (timestampSource === "sourceMeta.videoTime") {
    const videoTime = Number(frame?.sourceMeta?.videoTime);

    if (Number.isFinite(videoTime)) {
      return videoTime * 1000;
    }
  }

  return Number(frame?.timestamp ?? 0);
}

function estimateRecordingDurationMs(frames, timestampSource) {
  const timestamps = frames
    .map((frame) => readFrameTimestampMs(frame, timestampSource))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (timestamps.length < 2) {
    return 0;
  }

  const gaps = [];

  for (let index = 1; index < timestamps.length; index += 1) {
    const gap = timestamps[index] - timestamps[index - 1];

    if (gap > 0) {
      gaps.push(gap);
    }
  }

  const frameIntervalMs = gaps.length > 0 ? percentile(gaps.sort((a, b) => a - b), 0.5) : 0;
  return (timestamps.at(-1) - timestamps[0]) + frameIntervalMs;
}

function wrapTimestampMs(timestamp, durationMs) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return timestamp;
  }

  return ((timestamp % durationMs) + durationMs) % durationMs;
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
      timestamp: Number(pair.live.timestamp),
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

function pairSolvedFrames(liveSolved, offlineSolved, options = {}) {
  const maxTimestampDeltaMs = Number(options.maxTimestampDeltaMs ?? 50);
  const offlineTimestampOffsetMs = Number(options.offlineTimestampOffsetMs ?? 0);
  const pairs = [];
  const offlineTimedFrames = offlineSolved
    .map((frame) => ({
      ...frame,
      effectiveTimestamp: frame.timestamp + offlineTimestampOffsetMs,
    }))
    .filter((frame) => Number.isFinite(frame.effectiveTimestamp))
    .sort((a, b) => a.effectiveTimestamp - b.effectiveTimestamp);

  for (const liveFrame of liveSolved) {
    const best = findNearestTimedFrame(offlineTimedFrames, liveFrame.timestamp, maxTimestampDeltaMs);

    if (best) {
      pairs.push({
        live: liveFrame,
        offline: best.frame,
        timestampDeltaMs: best.timestampDeltaMs,
        offlineTimestamp: round(best.effectiveOfflineTimestamp, 3),
        offlineSourceIndices: [best.frame.index],
        interpolation: "none",
      });
    }
  }

  return pairs;
}

function pairLiveFramesWithInterpolatedOffline(liveSolved, offlineFrames, options = {}) {
  const maxTimestampDeltaMs = Number(options.maxTimestampDeltaMs ?? 50);
  const timestampSource = options.timestampSource ?? "timestamp";
  const offlineTimestampOffsetMs = Number(options.offlineTimestampOffsetMs ?? 0);
  const offlineTimedFrames = offlineFrames
    .map((frame, index) => ({
      index,
      timestamp: readFrameTimestampMs(frame, timestampSource),
      effectiveTimestamp: readFrameTimestampMs(frame, timestampSource) + offlineTimestampOffsetMs,
      frame,
    }))
    .filter((frame) => Number.isFinite(frame.effectiveTimestamp))
    .sort((a, b) => a.effectiveTimestamp - b.effectiveTimestamp);
  const pairs = [];
  let previousState = {};

  if (offlineTimedFrames.length === 0) {
    return pairs;
  }

  for (const liveFrame of liveSolved) {
    const bracket = findInterpolationBracket(offlineTimedFrames, liveFrame.timestamp);
    const left = bracket?.left;
    const right = bracket?.right;

    if (!left || !right) {
      continue;
    }

    const bracketStart = Math.min(left.effectiveTimestamp, right.effectiveTimestamp);
    const bracketEnd = Math.max(left.effectiveTimestamp, right.effectiveTimestamp);
    const outsideGap = liveFrame.timestamp < bracketStart
      ? bracketStart - liveFrame.timestamp
      : liveFrame.timestamp > bracketEnd
        ? liveFrame.timestamp - bracketEnd
        : 0;

    if (outsideGap > maxTimestampDeltaMs) {
      continue;
    }

    const span = right.effectiveTimestamp - left.effectiveTimestamp;
    const interpolationRatio = Math.abs(span) <= 0.000001
      ? 0
      : clamp((liveFrame.timestamp - left.effectiveTimestamp) / span, 0, 1);
    const interpolatedFrame = interpolateMotionFrame(left.frame, right.frame, interpolationRatio, {
      timestamp: liveFrame.timestamp,
      sourceMeta: {
        interpolation: "offline-linear",
        sourceLeftIndex: left.index,
        sourceRightIndex: right.index,
        sourceLeftTimestamp: round(left.effectiveTimestamp, 3),
        sourceRightTimestamp: round(right.effectiveTimestamp, 3),
        interpolationRatio: round(interpolationRatio, 6),
      },
    });
    const solved = solvePoseFrame(interpolatedFrame, previousState, {
      targetStabilization: false,
    });
    previousState = solved.state;

    pairs.push({
      live: liveFrame,
      offline: {
        index: round(left.index + (right.index - left.index) * interpolationRatio, 6),
        timestamp: liveFrame.timestamp,
        frame: interpolatedFrame,
        solved,
      },
      timestampDeltaMs: round(outsideGap, 3),
      offlineTimestamp: round(liveFrame.timestamp, 3),
      offlineSourceIndices: left.index === right.index ? [left.index] : [left.index, right.index],
      interpolation: "offline",
    });
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
      timestamp: Number(pair.live.timestamp),
      timestampDeltaMs: pair.timestampDeltaMs,
      bone: liveTarget.bone,
      group: liveTarget.group,
      angleDeltaDeg: round(directionAngleDeg(liveTarget.direction, offlineTarget.direction), 3),
      liveConfidence: liveTarget.confidence,
      offlineConfidence: offlineTarget.confidence,
      confidenceWeight: confidenceWeight(liveTarget.confidence, offlineTarget.confidence),
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
      timestamp: Number(pair.live.timestamp),
      timestampDeltaMs: pair.timestampDeltaMs,
      name: liveHinge.name,
      group: liveHinge.group,
      flexDeltaDeg: round(Math.abs(liveHinge.flexDeg - offlineHinge.flexDeg), 3),
      liveConfidence: liveHinge.confidence,
      offlineConfidence: offlineHinge.confidence,
      confidenceWeight: confidenceWeight(liveHinge.confidence, offlineHinge.confidence),
    });
  }
}

function collectFacingRows(rows, pair, referenceLabel) {
  if (!referenceLabel) {
    return;
  }

  const liveFacing = normalizeFacing(pair.live.solved?.meta?.facingDetail ?? pair.live.solved?.meta?.facing);
  const liveLegacyFacing = toLegacyFacing(pair.live.solved?.meta?.facing ?? liveFacing);
  const referenceFacing = normalizeFacing(referenceLabel.facingState ?? referenceLabel.facing);
  const referenceLegacyFacing = toLegacyFacing(referenceFacing);
  const liveYawDeg = Number(pair.live.solved?.meta?.facingYawDeg);
  const referenceYawDeg = Number(referenceLabel.facingYawDeg);
  const yawErrorDeg = Number.isFinite(liveYawDeg) && Number.isFinite(referenceYawDeg)
    ? angleDeltaDeg(liveYawDeg, referenceYawDeg)
    : null;
  const liveYawFacing = Number.isFinite(liveYawDeg) ? classifyFacingFromYaw(liveYawDeg) : liveFacing;
  const liveYawLegacyFacing = toLegacyFacing(liveYawFacing);
  const stableMatches = liveLegacyFacing === referenceLegacyFacing;
  const yawStateMatches = liveYawLegacyFacing === referenceLegacyFacing;
  const yawToleranceMatches = yawErrorDeg !== null && yawErrorDeg <= FACING_YAW_MATCH_THRESHOLD_DEG;

  rows.push({
    liveIndex: pair.live.index,
    offlineIndex: pair.offline.index,
    labelIndex: referenceLabel.index,
    timestamp: Number(pair.live.timestamp),
    timestampDeltaMs: round(Math.abs((referenceLabel.timestamp ?? 0) - pair.live.timestamp), 3),
    liveFacing,
    liveLegacyFacing,
    liveYawFacing,
    liveYawLegacyFacing,
    referenceFacing,
    referenceLegacyFacing,
    stableMatches,
    yawStateMatches,
    yawToleranceMatches,
    matches: stableMatches || yawStateMatches || yawToleranceMatches,
    liveYawDeg: Number.isFinite(liveYawDeg) ? round(liveYawDeg, 3) : null,
    referenceYawDeg: Number.isFinite(referenceYawDeg) ? round(referenceYawDeg, 3) : null,
    yawErrorDeg: yawErrorDeg === null ? null : round(yawErrorDeg, 3),
    confidenceWeight: Number.isFinite(Number(pair.live.solved?.meta?.facingConfidence))
      ? Number(pair.live.solved.meta.facingConfidence)
      : 1,
  });
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
    .map((row) => Number(row[valueKey]))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const weightedValues = rows
    .map((row) => ({
      value: Number(row[valueKey]),
      weight: Number.isFinite(Number(row.confidenceWeight)) ? Math.max(0, Number(row.confidenceWeight)) : 1,
    }))
    .filter((row) => Number.isFinite(row.value) && row.weight > 0)
    .sort((a, b) => a.value - b.value);

  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      p95: 0,
      max: 0,
      weightedMean: 0,
      weightedP95: 0,
      weightSum: 0,
    };
  }

  const weightSum = weightedValues.reduce((sum, row) => sum + row.weight, 0);
  const weightedMean = weightSum > 0
    ? weightedValues.reduce((sum, row) => sum + row.value * row.weight, 0) / weightSum
    : 0;

  return {
    count: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length, 3),
    p95: round(percentile(values, 0.95), 3),
    max: round(values[values.length - 1], 3),
    weightedMean: round(weightedMean, 3),
    weightedP95: round(weightedPercentile(weightedValues, 0.95), 3),
    weightSum: round(weightSum, 3),
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

function summarizeFacingRows(rows) {
  const matched = rows.filter((row) => row.matches).length;
  const stableMatched = rows.filter((row) => row.stableMatches).length;
  const yawStateMatched = rows.filter((row) => row.yawStateMatches).length;
  const yawToleranceMatched = rows.filter((row) => row.yawToleranceMatches).length;
  const backSideRows = rows.filter((row) =>
    row.referenceLegacyFacing === "back" || row.referenceLegacyFacing === "side"
  );
  const backSideMatched = backSideRows.filter((row) => row.matches).length;
  const stableBackSideMatched = backSideRows.filter((row) => row.stableMatches).length;
  const yawBackSideMatched = backSideRows.filter((row) => row.yawStateMatches).length;
  const yawToleranceBackSideMatched = backSideRows.filter((row) => row.yawToleranceMatches).length;

  return {
    count: rows.length,
    matched,
    agreementRatio: round(ratio(matched, rows.length), 6),
    stableMatched,
    stableAgreementRatio: round(ratio(stableMatched, rows.length), 6),
    yawStateMatched,
    yawStateAgreementRatio: round(ratio(yawStateMatched, rows.length), 6),
    yawToleranceDeg: FACING_YAW_MATCH_THRESHOLD_DEG,
    yawToleranceMatched,
    yawToleranceAgreementRatio: round(ratio(yawToleranceMatched, rows.length), 6),
    backSideCount: backSideRows.length,
    backSideMatched,
    backSideAgreementRatio: round(ratio(backSideMatched, backSideRows.length), 6),
    stableBackSideMatched,
    stableBackSideAgreementRatio: round(ratio(stableBackSideMatched, backSideRows.length), 6),
    yawBackSideMatched,
    yawBackSideAgreementRatio: round(ratio(yawBackSideMatched, backSideRows.length), 6),
    yawToleranceBackSideMatched,
    yawToleranceBackSideAgreementRatio: round(ratio(yawToleranceBackSideMatched, backSideRows.length), 6),
    yawError: summarizeRows(rows.filter((row) => Number.isFinite(row.yawErrorDeg)), "yawErrorDeg"),
  };
}

function summarizeFacingRowsByState(rows) {
  const grouped = groupRowsByKey(rows, "referenceFacing");
  return Object.fromEntries(
    Object.entries(grouped).map(([state, stateRows]) => [state, summarizeFacingRows(stateRows)]),
  );
}

function summarizeRowsByLabelWindowKind(windows, targetAngleRows, hingeFlexRows, facingRows) {
  const groupedWindows = groupRowsByKey(normalizeReferenceWindows(windows), "kind");

  return Object.fromEntries(Object.entries(groupedWindows).map(([kind, kindWindows]) => {
    const targets = rowsInWindows(targetAngleRows, kindWindows);
    const armTargets = targets.filter((row) => row.group === "arms");
    const hinges = rowsInWindows(hingeFlexRows, kindWindows);
    const armHinges = hinges.filter((row) => row.group === "arms");
    const facing = rowsInWindows(facingRows, kindWindows);

    return [kind, {
      windowCount: kindWindows.length,
      targetAngle: summarizeRows(targets, "angleDeltaDeg"),
      armTargetAngle: summarizeRows(armTargets, "angleDeltaDeg"),
      byArmTarget: summarizeRowsByKey(armTargets, "bone", "angleDeltaDeg"),
      worstArmTargets: armTargets
        .slice()
        .sort((a, b) => b.angleDeltaDeg - a.angleDeltaDeg)
        .slice(0, 10),
      hingeFlex: summarizeRows(hinges, "flexDeltaDeg"),
      armHingeFlex: summarizeRows(armHinges, "flexDeltaDeg"),
      facingAgreement: summarizeFacingRows(facing),
    }];
  }));
}

function rowsInWindowKinds(rows, windows, kinds) {
  const kindSet = kinds instanceof Set ? kinds : new Set(kinds);
  return rowsInWindows(
    rows,
    normalizeReferenceWindows(windows).filter((window) => kindSet.has(window.kind)),
  );
}

function rowsInWindows(rows, windows) {
  const normalizedWindows = normalizeReferenceWindows(windows);

  if (!Array.isArray(rows) || rows.length === 0 || normalizedWindows.length === 0) {
    return [];
  }

  return rows.filter((row) => {
    const timestamp = Number(row.timestamp);
    return Number.isFinite(timestamp) && normalizedWindows.some((window) =>
      timestamp >= window.startMs && timestamp <= window.endMs
    );
  });
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

function estimateTimestampOffsetMs(liveSolved, offlineSolved, maxTimestampDeltaMs) {
  const candidateStepMs = 5;
  const searchWindowMs = 500;
  let best = {
    offsetMs: 0,
    pairCount: -1,
    meanDeltaMs: Number.POSITIVE_INFINITY,
  };

  for (let offsetMs = -searchWindowMs; offsetMs <= searchWindowMs; offsetMs += candidateStepMs) {
    const pairs = pairSolvedFrames(liveSolved, offlineSolved, {
      maxTimestampDeltaMs,
      offlineTimestampOffsetMs: offsetMs,
    });
    const meanDeltaMs = pairs.length > 0
      ? pairs.reduce((sum, pair) => sum + pair.timestampDeltaMs, 0) / pairs.length
      : Number.POSITIVE_INFINITY;
    const betterPairCount = pairs.length > best.pairCount;
    const equalCountBetterDelta = pairs.length === best.pairCount && meanDeltaMs < best.meanDeltaMs;
    const equalDeltaCloserToZero = pairs.length === best.pairCount &&
      Math.abs(meanDeltaMs - best.meanDeltaMs) <= 0.000001 &&
      Math.abs(offsetMs) < Math.abs(best.offsetMs);

    if (betterPairCount || equalCountBetterDelta || equalDeltaCloserToZero) {
      best = {
        offsetMs,
        pairCount: pairs.length,
        meanDeltaMs,
      };
    }
  }

  return best.offsetMs;
}

function normalizeReferenceLabels(labels) {
  if (!labels || !Array.isArray(labels.frames)) {
    return {
      frames: [],
      windows: [],
    };
  }

  const frames = labels.frames
    .map((frame, fallbackIndex) => ({
      ...frame,
      index: Number.isFinite(Number(frame.index)) ? Number(frame.index) : fallbackIndex,
      timestamp: Number.isFinite(Number(frame.timestamp))
        ? Number(frame.timestamp)
        : Number.isFinite(Number(frame.videoTime))
          ? Number(frame.videoTime) * 1000
          : 0,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    frames,
    windows: normalizeReferenceWindows(labels.windows),
  };
}

function normalizeReferenceWindows(windows) {
  if (!Array.isArray(windows)) {
    return [];
  }

  return windows
    .map((window) => ({
      ...window,
      kind: String(window.kind ?? "unknown"),
      startMs: Number(window.startMs),
      endMs: Number(window.endMs),
    }))
    .filter((window) =>
      window.kind &&
      Number.isFinite(window.startMs) &&
      Number.isFinite(window.endMs) &&
      window.endMs >= window.startMs
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.kind.localeCompare(b.kind));
}

function findReferenceLabelForPair(pair, labels, maxTimestampDeltaMs) {
  const frames = Array.isArray(labels) ? labels : labels?.frames;

  if (!Array.isArray(frames) || frames.length === 0) {
    return null;
  }

  const timestamp = Number(pair.live?.timestamp);
  const insertionIndex = lowerBoundLabels(frames, timestamp);
  const candidates = [
    frames[insertionIndex - 1],
    frames[insertionIndex],
    frames[insertionIndex + 1],
  ].filter(Boolean);
  let best = null;

  for (const candidate of candidates) {
    const timestampDeltaMs = Math.abs(candidate.timestamp - timestamp);

    if (timestampDeltaMs <= maxTimestampDeltaMs && (!best || timestampDeltaMs < best.timestampDeltaMs)) {
      best = {
        ...candidate,
        timestampDeltaMs,
      };
    }
  }

  return best;
}

function lowerBoundLabels(labels, timestamp) {
  let low = 0;
  let high = labels.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (labels[mid].timestamp < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function findNearestTimedFrame(timedFrames, timestamp, maxTimestampDeltaMs) {
  if (timedFrames.length === 0 || !Number.isFinite(timestamp)) {
    return null;
  }

  const insertionIndex = lowerBoundTimedFrames(timedFrames, timestamp);
  const candidates = [
    timedFrames[insertionIndex - 1],
    timedFrames[insertionIndex],
    timedFrames[insertionIndex + 1],
  ].filter(Boolean);
  let best = null;

  for (const candidate of candidates) {
    const timestampDeltaMs = Math.abs(candidate.effectiveTimestamp - timestamp);

    if (timestampDeltaMs <= maxTimestampDeltaMs && (!best || timestampDeltaMs < best.timestampDeltaMs)) {
      best = {
        frame: candidate,
        timestampDeltaMs,
        effectiveOfflineTimestamp: candidate.effectiveTimestamp,
      };
    }
  }

  return best;
}

function findInterpolationBracket(timedFrames, timestamp) {
  if (timedFrames.length === 0 || !Number.isFinite(timestamp)) {
    return null;
  }

  const insertionIndex = lowerBoundTimedFrames(timedFrames, timestamp);

  if (insertionIndex <= 0) {
    const first = timedFrames[0];
    const second = timedFrames[1] ?? first;
    return { left: first, right: second };
  }

  if (insertionIndex >= timedFrames.length) {
    const last = timedFrames.at(-1);
    const previous = timedFrames.at(-2) ?? last;
    return { left: previous, right: last };
  }

  return {
    left: timedFrames[insertionIndex - 1],
    right: timedFrames[insertionIndex],
  };
}

function lowerBoundTimedFrames(timedFrames, timestamp) {
  let low = 0;
  let high = timedFrames.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (timedFrames[mid].effectiveTimestamp < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function interpolateMotionFrame(leftFrame, rightFrame, ratioValue, options = {}) {
  const ratioValueClamped = clamp(Number(ratioValue), 0, 1);

  return {
    ...leftFrame,
    timestamp: Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : interpolateNumber(leftFrame.timestamp, rightFrame.timestamp, ratioValueClamped),
    poseLandmarks: interpolateLandmarkList(leftFrame.poseLandmarks, rightFrame.poseLandmarks, ratioValueClamped),
    poseWorldLandmarks: interpolateLandmarkList(leftFrame.poseWorldLandmarks, rightFrame.poseWorldLandmarks, ratioValueClamped),
    leftHandLandmarks: interpolateLandmarkList(leftFrame.leftHandLandmarks, rightFrame.leftHandLandmarks, ratioValueClamped),
    rightHandLandmarks: interpolateLandmarkList(leftFrame.rightHandLandmarks, rightFrame.rightHandLandmarks, ratioValueClamped),
    leftHandWorldLandmarks: interpolateLandmarkList(leftFrame.leftHandWorldLandmarks, rightFrame.leftHandWorldLandmarks, ratioValueClamped),
    rightHandWorldLandmarks: interpolateLandmarkList(leftFrame.rightHandWorldLandmarks, rightFrame.rightHandWorldLandmarks, ratioValueClamped),
    sourceMeta: {
      ...leftFrame.sourceMeta,
      ...options.sourceMeta,
    },
  };
}

function interpolateLandmarkList(leftLandmarks, rightLandmarks, ratioValue) {
  if (!Array.isArray(leftLandmarks) || !Array.isArray(rightLandmarks) || leftLandmarks.length !== rightLandmarks.length) {
    return Array.isArray(leftLandmarks)
      ? leftLandmarks.map((landmark) => ({ ...landmark }))
      : null;
  }

  return leftLandmarks.map((leftLandmark, index) => {
    const rightLandmark = rightLandmarks[index];

    if (!leftLandmark || !rightLandmark) {
      return leftLandmark ? { ...leftLandmark } : rightLandmark ? { ...rightLandmark } : null;
    }

    return {
      x: interpolateNumber(leftLandmark.x, rightLandmark.x, ratioValue),
      y: interpolateNumber(leftLandmark.y, rightLandmark.y, ratioValue),
      z: interpolateNumber(leftLandmark.z, rightLandmark.z, ratioValue),
      visibility: interpolateNumber(leftLandmark.visibility, rightLandmark.visibility, ratioValue),
      presence: interpolateNumber(leftLandmark.presence, rightLandmark.presence, ratioValue),
    };
  });
}

function interpolateNumber(leftValue, rightValue, ratioValue) {
  const left = Number(leftValue);
  const right = Number(rightValue);

  if (!Number.isFinite(left) && !Number.isFinite(right)) {
    return 0;
  }
  if (!Number.isFinite(left)) {
    return right;
  }
  if (!Number.isFinite(right)) {
    return left;
  }

  return left + (right - left) * ratioValue;
}

function countUniqueOfflineFrames(pairs) {
  const indices = new Set();

  for (const pair of pairs) {
    const sourceIndices = Array.isArray(pair.offlineSourceIndices)
      ? pair.offlineSourceIndices
      : [pair.offline?.index];

    for (const index of sourceIndices) {
      if (Number.isFinite(Number(index))) {
        indices.add(Number(index));
      }
    }
  }

  return indices.size;
}

function ratio(numerator, denominator) {
  const denominatorValue = Number(denominator);
  return denominatorValue > 0 ? Number(numerator) / denominatorValue : 0;
}

function confidenceWeight(...values) {
  const finiteValues = values
    .map((value) => Number(value))
    .filter(Number.isFinite)
    .map((value) => clamp(value, 0, 1));

  return finiteValues.length > 0 ? round(Math.min(...finiteValues), 6) : 0;
}

function normalizeFacing(value) {
  const normalized = String(value ?? "unknown").trim().toLowerCase();

  if (normalized === "front" || normalized === "back" || normalized === "unknown") {
    return normalized;
  }
  if (normalized === "side" || normalized === "side-left" || normalized === "left") {
    return "side-left";
  }
  if (normalized === "side-right" || normalized === "right") {
    return "side-right";
  }
  return "unknown";
}

function toLegacyFacing(value) {
  const facing = normalizeFacing(value);

  if (facing === "side-left" || facing === "side-right") {
    return "side";
  }

  return facing;
}

function classifyFacingFromYaw(yawDeg) {
  const normalizedYaw = normalizeAngleDeg(yawDeg);
  const absYaw = Math.abs(normalizedYaw);

  if (absYaw < 60) {
    return "front";
  }
  if (absYaw > 120) {
    return "back";
  }
  return normalizedYaw >= 0 ? "side-left" : "side-right";
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

function angleDeltaDeg(a, b) {
  let delta = Math.abs(Number(a) - Number(b)) % 360;

  if (delta > 180) {
    delta = 360 - delta;
  }

  return delta;
}

function normalizeAngleDeg(value) {
  let normalized = Number(value) % 360;

  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized < -180) {
    normalized += 360;
  }

  return normalized;
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

function weightedPercentile(sortedWeightedValues, percentileValue) {
  if (sortedWeightedValues.length === 0) {
    return 0;
  }

  const totalWeight = sortedWeightedValues.reduce((sum, row) => sum + row.weight, 0);
  const threshold = totalWeight * percentileValue;
  let cumulative = 0;

  for (const row of sortedWeightedValues) {
    cumulative += row.weight;

    if (cumulative >= threshold) {
      return row.value;
    }
  }

  return sortedWeightedValues.at(-1)?.value ?? 0;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function printUsage() {
  console.log(`Usage:
  node scripts/motion-recording-compare.mjs --live live.jsonl --offline offline.jsonl --output output/reports/live-vs-offline.json --html output/reports/live-vs-offline.html

Both inputs must be action-tracker motion recordings in JSON or JSONL form.
The report pairs frames by timestamp, solves both recordings through the pure
pose solver, summarizes target direction and hinge flexion differences, and can
write a static HTML timeline report with --html. Use
--timestamp-source sourceMeta.videoTime when comparing recordings captured from
the same source video by different runtimes. Use --interpolate offline to align
dense offline recordings to sparse live frames, and --offset-ms auto to estimate
a constant live/offline timestamp offset before pairing. Use
--timestamp-wrap offline-duration for validation recordings that contain repeated
plays of the same source video.
`);
}
