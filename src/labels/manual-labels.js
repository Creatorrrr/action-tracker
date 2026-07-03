const DEFAULT_GUARD_BAND_SEC = 0.25;
const INVALID_REFERENCE_KINDS = new Set([
  "manual:presence:absent:hold",
  "manual:reference-invalid:absent",
  "manual:reference-invalid:hands-out-of-frame",
  "manual:reference-invalid:fingers-unobservable",
]);

export {
  compileManualLabels,
  crossCheckManualAgainstAutoLabels,
  findManualFrameForTimestamp,
  isInvalidReferenceKind,
  normalizeManualLabelSpec,
};

function normalizeManualLabelSpec(spec) {
  if (!spec || typeof spec !== "object") {
    throw new Error("Manual label spec must be an object.");
  }
  if (spec.version !== 1) {
    throw new Error("Manual label spec version must be 1.");
  }
  if (!Array.isArray(spec.segments) || spec.segments.length === 0) {
    throw new Error("Manual label spec requires a non-empty segments array.");
  }

  const guardBandSec = normalizeNumber(spec.guardBandSec, DEFAULT_GUARD_BAND_SEC);
  const globalConditions = spec.globalConditions ?? {};
  const occlusionChanges = Array.isArray(globalConditions.occlusionChanges)
    ? globalConditions.occlusionChanges
      .map((change) => ({
        fromSec: normalizeNumber(change.fromSec, 0),
        occlusion: String(change.occlusion ?? "unknown"),
      }))
      .sort((a, b) => a.fromSec - b.fromSec)
    : [];
  const segments = spec.segments.map((segment, index) => normalizeSegment(segment, index, {
    guardBandSec,
    occlusionChanges,
  }));

  return {
    version: 1,
    clip: String(spec.clip ?? ""),
    video: String(spec.video ?? ""),
    fps: normalizeNumber(spec.fps, 30),
    frameCount: Number.isInteger(Number(spec.frameCount)) && Number(spec.frameCount) > 0
      ? Number(spec.frameCount)
      : null,
    durationSec: normalizeNumber(spec.durationSec, Math.max(...segments.map((segment) => segment.t1))),
    guardBandSec,
    globalConditions: {
      occlusionChanges,
    },
    segments,
  };
}

function compileManualLabels(spec, options = {}) {
  const normalized = normalizeManualLabelSpec(spec);
  const fps = normalizeNumber(options.fps, normalized.fps);
  const includeFrames = options.includeFrames !== false;
  const frames = includeFrames ? buildManualFrames(normalized, fps) : [];
  const windows = buildManualWindows(normalized);

  return {
    version: 1,
    source: "manual",
    clip: normalized.clip,
    video: normalized.video,
    fps,
    durationSec: normalized.durationSec,
    guardBandSec: normalized.guardBandSec,
    frames,
    windows,
    summary: summarizeManualLabels(normalized, frames, windows),
  };
}

function crossCheckManualAgainstAutoLabels(manualLabels, autoLabels) {
  const manualWindows = Array.isArray(manualLabels?.windows) ? manualLabels.windows : [];
  const autoWindows = Array.isArray(autoLabels?.windows) ? autoLabels.windows : [];
  const checks = [
    {
      name: "crossed-arms",
      manualKinds: ["manual:arms:crossed:hold"],
      autoKinds: ["crossed-arms"],
    },
    {
      name: "back-facing",
      manualKinds: ["manual:facing:back:hold"],
      autoKinds: ["back-facing"],
    },
    {
      name: "behind-back",
      manualKinds: ["manual:arms:behind-back:hold"],
      autoKinds: ["left-behind-back", "right-behind-back"],
    },
  ];

  return {
    status: "passed",
    checks: checks.map((check) => ({
      name: check.name,
      manualKinds: check.manualKinds,
      autoKinds: check.autoKinds,
      manualMs: round(totalWindowDurationMs(manualWindows, check.manualKinds), 3),
      autoMs: round(totalWindowDurationMs(autoWindows, check.autoKinds), 3),
      intersectionMs: round(intersectionDurationMs(manualWindows, autoWindows, check.manualKinds, check.autoKinds), 3),
      unionMs: round(unionDurationMs(manualWindows, autoWindows, check.manualKinds, check.autoKinds), 3),
      iou: round(windowIou(manualWindows, autoWindows, check.manualKinds, check.autoKinds), 6),
    })),
  };
}

function findManualFrameForTimestamp(labels, timestampMs) {
  const frames = Array.isArray(labels?.frames) ? labels.frames : [];

  if (frames.length === 0 || !Number.isFinite(Number(timestampMs))) {
    return null;
  }

  const timestamp = Number(timestampMs);
  const index = lowerBoundFrames(frames, timestamp);
  const candidates = [frames[index - 1], frames[index], frames[index + 1]].filter(Boolean);
  let best = null;

  for (const candidate of candidates) {
    const deltaMs = Math.abs(Number(candidate.timestamp) - timestamp);

    if (!best || deltaMs < best.deltaMs) {
      best = {
        ...candidate,
        timestampDeltaMs: round(deltaMs, 3),
      };
    }
  }

  return best;
}

function isInvalidReferenceKind(kind) {
  return INVALID_REFERENCE_KINDS.has(String(kind ?? ""));
}

function normalizeSegment(segment, index, options) {
  const t0 = normalizeNumber(segment.t0, Number.NaN);
  const t1 = normalizeNumber(segment.t1, Number.NaN);

  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) {
    throw new Error(`Manual segment ${index} requires t0 < t1.`);
  }

  const phase = normalizeToken(segment.phase, "hold");
  const presence = normalizeToken(segment.presence, "present");
  const facing = normalizeToken(segment.facing, presence === "absent" ? "none" : "unknown");
  const arms = normalizeToken(segment.arms, "unknown");
  const fingers = normalizeToken(segment.fingers, "unknown");
  const guardBandSec = normalizeNumber(segment.segmentGuardBandSec, options.guardBandSec);
  const occlusion = segment.occlusion
    ? normalizeToken(segment.occlusion, "unknown")
    : occlusionAt(t0, options.occlusionChanges);

  return {
    ...segment,
    index,
    t0,
    t1,
    phase,
    presence,
    facing,
    arms,
    fingers,
    occlusion,
    guardBandSec,
    handsOutOfFrame: Boolean(segment.handsOutOfFrame),
    fingersObservable: segment.fingersObservable === false ? false : true,
  };
}

function buildManualFrames(spec, fps) {
  const frameCount = spec.frameCount ?? Math.max(1, Math.ceil(spec.durationSec * fps));
  const frames = [];

  for (let index = 0; index < frameCount; index += 1) {
    const timestampSec = index / fps;
    const segment = segmentAt(spec.segments, timestampSec);

    if (!segment) {
      continue;
    }

    frames.push({
      index,
      timestamp: round(timestampSec * 1000, 3),
      videoTime: round(timestampSec, 6),
      segmentIndex: segment.index,
      phase: segment.phase,
      presence: segment.presence,
      facing: segment.facing,
      arms: segment.arms,
      fingers: segment.fingers,
      occlusion: segment.occlusion,
      handsOutOfFrame: segment.handsOutOfFrame,
      fingersObservable: segment.fingersObservable,
      referenceValid: isReferenceValid(segment),
      kind: buildManualKind(segment, "segment"),
    });
  }

  return frames;
}

function buildManualWindows(spec) {
  const windows = [];

  for (const segment of spec.segments) {
    const base = {
      segmentIndex: segment.index,
      source: "manual",
      phase: segment.phase,
      presence: segment.presence,
      facing: segment.facing,
      arms: segment.arms,
      fingers: segment.fingers,
      occlusion: segment.occlusion,
      handsOutOfFrame: segment.handsOutOfFrame,
      guardBandSec: segment.guardBandSec,
      startMs: round(segment.t0 * 1000, 3),
      endMs: round(segment.t1 * 1000, 3),
      startSec: round(segment.t0, 6),
      endSec: round(segment.t1, 6),
    };

    windows.push({ ...base, kind: buildManualKind(segment, "segment") });
    windows.push({ ...base, kind: `manual:presence:${segment.presence}:${segment.phase}` });
    if (segment.facing && segment.facing !== "unknown" && segment.facing !== "none" && segment.facing !== "moving") {
      windows.push({ ...base, kind: `manual:facing:${segment.facing}:${segment.phase}` });
    }
    if (segment.arms && segment.arms !== "unknown" && segment.arms !== "none") {
      windows.push({ ...base, kind: `manual:arms:${segment.arms}:${segment.phase}` });
    }
    if (segment.fingers && segment.fingers !== "unknown" && segment.fingers !== "none") {
      windows.push({ ...base, kind: `manual:fingers:${segment.fingers}:${segment.phase}` });
    }
    if (segment.occlusion && segment.occlusion !== "unknown") {
      windows.push({ ...base, kind: `manual:occlusion:${segment.occlusion}` });
    }
    for (const invalidKind of invalidReferenceKindsForSegment(segment)) {
      windows.push({
        ...base,
        kind: invalidKind,
        referenceValid: false,
      });
    }
  }

  return windows
    .map(applyGuardBandToWindow)
    .filter((window) => window.endMs >= window.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.kind.localeCompare(b.kind));
}

function buildManualKind(segment, axis) {
  return `manual:${axis}:${segment.presence}:${segment.facing}:${segment.arms}:${segment.phase}`;
}

function applyGuardBandToWindow(window) {
  const phase = String(window.phase ?? "");
  const guardMs = phase === "hold" ? normalizeNumber(window.guardBandSec, 0) * 1000 : 0;

  if (guardMs <= 0) {
    return window;
  }

  const startMs = Number(window.startMs) + guardMs;
  const endMs = Number(window.endMs) - guardMs;

  if (endMs < startMs) {
    const midpoint = (Number(window.startMs) + Number(window.endMs)) / 2;
    return {
      ...window,
      startMs: round(midpoint, 3),
      endMs: round(midpoint, 3),
      guardBandCollapsed: true,
    };
  }

  return {
    ...window,
    startMs: round(startMs, 3),
    endMs: round(endMs, 3),
    guardBandAppliedMs: round(guardMs, 3),
  };
}

function invalidReferenceKindsForSegment(segment) {
  const kinds = [];

  if (segment.presence === "absent") {
    kinds.push("manual:reference-invalid:absent");
  }
  if (segment.handsOutOfFrame) {
    kinds.push("manual:reference-invalid:hands-out-of-frame");
  }
  if (segment.fingers === "unobservable" || segment.fingersObservable === false) {
    kinds.push("manual:reference-invalid:fingers-unobservable");
  }

  return kinds;
}

function isReferenceValid(segment) {
  return invalidReferenceKindsForSegment(segment).length === 0;
}

function summarizeManualLabels(spec, frames, windows) {
  return {
    clip: spec.clip,
    segmentCount: spec.segments.length,
    frameCount: frames.length,
    windowCount: windows.length,
    byPresence: countBy(spec.segments, "presence"),
    byPhase: countBy(spec.segments, "phase"),
    byArms: countBy(spec.segments, "arms"),
    byOcclusion: countBy(spec.segments, "occlusion"),
    invalidReferenceWindowCount: windows.filter((window) => isInvalidReferenceKind(window.kind)).length,
  };
}

function segmentAt(segments, timestampSec) {
  return segments.find((segment) => timestampSec >= segment.t0 && timestampSec < segment.t1) ?? segments.at(-1) ?? null;
}

function occlusionAt(timestampSec, changes) {
  let current = "unknown";

  for (const change of changes) {
    if (timestampSec >= change.fromSec) {
      current = change.occlusion;
    }
  }

  return current;
}

function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = String(row?.[key] ?? "unknown");
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function windowIou(leftWindows, rightWindows, leftKinds, rightKinds) {
  const intersection = intersectionDurationMs(leftWindows, rightWindows, leftKinds, rightKinds);
  const union = unionDurationMs(leftWindows, rightWindows, leftKinds, rightKinds);
  return union > 0 ? intersection / union : 0;
}

function totalWindowDurationMs(windows, kinds) {
  const kindSet = new Set(kinds);
  return normalizeIntervals(windows.filter((window) => kindSet.has(window.kind)))
    .reduce((sum, interval) => sum + Math.max(0, interval.endMs - interval.startMs), 0);
}

function intersectionDurationMs(leftWindows, rightWindows, leftKinds, rightKinds) {
  const left = normalizeIntervals(leftWindows.filter((window) => new Set(leftKinds).has(window.kind)));
  const right = normalizeIntervals(rightWindows.filter((window) => new Set(rightKinds).has(window.kind)));
  let total = 0;

  for (const leftInterval of left) {
    for (const rightInterval of right) {
      const startMs = Math.max(leftInterval.startMs, rightInterval.startMs);
      const endMs = Math.min(leftInterval.endMs, rightInterval.endMs);
      total += Math.max(0, endMs - startMs);
    }
  }

  return total;
}

function unionDurationMs(leftWindows, rightWindows, leftKinds, rightKinds) {
  const intervals = normalizeIntervals([
    ...leftWindows.filter((window) => new Set(leftKinds).has(window.kind)),
    ...rightWindows.filter((window) => new Set(rightKinds).has(window.kind)),
  ]);
  return intervals.reduce((sum, interval) => sum + Math.max(0, interval.endMs - interval.startMs), 0);
}

function normalizeIntervals(windows) {
  const sorted = windows
    .map((window) => ({
      startMs: Number(window.startMs),
      endMs: Number(window.endMs),
    }))
    .filter((window) => Number.isFinite(window.startMs) && Number.isFinite(window.endMs) && window.endMs >= window.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged = [];

  for (const interval of sorted) {
    const previous = merged.at(-1);

    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
    } else {
      merged.push({ ...interval });
    }
  }

  return merged;
}

function lowerBoundFrames(frames, timestamp) {
  let low = 0;
  let high = frames.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);

    if (frames[mid].timestamp < timestamp) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function normalizeToken(value, fallback) {
  const token = String(value ?? fallback).trim().toLowerCase();
  return token || fallback;
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}
