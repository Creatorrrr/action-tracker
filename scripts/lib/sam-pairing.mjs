// Compare only identical presentation timestamps, at the microsecond precision
// exposed by HTMLVideoElement.requestVideoFrameCallback. No fitted lag/offset.
export function decoderPtsMicroseconds(row) {
  const { numerator, denominator } = row.timeBase ?? {};
  if (!Number.isSafeInteger(numerator) || numerator <= 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0 ||
      !/^\d+$/.test(String(row.ptsTicks))) throw new Error("Invalid decoder PTS");
  const scaled = BigInt(row.ptsTicks) * BigInt(numerator) * 1000000n;
  const divisor = BigInt(denominator);
  const rounded = (2n * scaled + divisor) / (2n * divisor);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("PTS exceeds exact microsecond range");
  return Number(rounded);
}

export function livePtsMicroseconds(frame) {
  const value = frame?.sourceMeta?.sourcePtsSec;
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value * 1e6))) {
    throw new Error("Live frame has no finite nonnegative source PTS");
  }
  return Math.round(value * 1e6);
}

export function pairSourceFrames(liveFrames, decoderRows, teacherFrames) {
  if (decoderRows.length !== teacherFrames.length) throw new Error("Teacher/decoder row count mismatch");
  const byPts = new Map();
  decoderRows.forEach((row, index) => {
    const key = decoderPtsMicroseconds(row);
    if (row.clipId !== teacherFrames[index].sourceMeta.clipId ||
        row.sourceFrameIndex !== teacherFrames[index].sourceMeta.sourceFrameIndex || byPts.has(key)) {
      throw new Error("Ambiguous teacher timeline");
    }
    byPts.set(key, index);
  });
  const seen = new Set();
  let previous = -1;
  const pairs = [], unmatched = [], fallback = [];
  liveFrames.forEach((frame, liveIndex) => {
    if (frame.rawPoseObservation?.provenance !== "detector-output") {
      throw new Error(`Live frame ${liveIndex} does not preserve raw detector output`);
    }
    const key = livePtsMicroseconds(frame);
    if (seen.has(key) || key <= previous) throw new Error(`Duplicate/non-monotonic live PTS at ${liveIndex}`);
    if (!Number.isFinite(frame.rawPoseObservation.sourcePtsSec) || Math.round(frame.rawPoseObservation.sourcePtsSec * 1e6) !== key) {
      throw new Error("Raw/live PTS mismatch");
    }
    seen.add(key); previous = key;
    const teacherIndex = byPts.get(key);
    // A seek boundary may use currentTime while the decoded frame still has
    // another PTS. Keep it in causal replay but do not score it as exact rVFC.
    if (frame.sourceMeta.sourcePtsSource !== "rvfc-media-time") {
      fallback.push({ liveIndex, ptsUs: key, source: frame.sourceMeta.sourcePtsSource });
    } else if (teacherIndex === undefined) {
      unmatched.push({ liveIndex, ptsUs: key });
    } else {
      pairs.push({ liveIndex, teacherIndex, ptsUs: key,
        referenceObserved: teacherFrames[teacherIndex].canonicalPose?.status === "observed" });
    }
  });
  return {
    policy: "exact rounded microsecond decoder PTS to rVFC mediaTime; no fitted offset or nearest-frame join",
    liveCount: liveFrames.length, decoderCount: decoderRows.length,
    matchedCount: pairs.length, observedPairCount: pairs.filter(p => p.referenceObserved).length,
    liveExactCoverage: pairs.length / (liveFrames.length || 1),
    decoderExactCoverage: pairs.length / (decoderRows.length || 1),
    // Missing detections / intentional 30 Hz admission remain outside pairs.
    // These coverage numbers must accompany conditional accuracy statistics.
    unmatched, fallback, pairs,
  };
}

export function summarizeSamples(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
    p50: sorted[Math.max(0, Math.ceil(sorted.length * .5) - 1)] ?? null,
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? null,
    max: sorted.at(-1) ?? null };
}

export function directionErrorDeg(a, b, c, d) {
  if (![a, b, c, d].every(p => p && [p.x, p.y, p.z].every(Number.isFinite))) return null;
  const u = [b.x-a.x, b.y-a.y, b.z-a.z], v = [d.x-c.x, d.y-c.y, d.z-c.z];
  const length = Math.hypot(...u) * Math.hypot(...v);
  if (length < 1e-12) return null;
  return Math.acos(Math.max(-1, Math.min(1, u.reduce((sum, value, i) => sum + value*v[i], 0) / length))) * 180/Math.PI;
}
