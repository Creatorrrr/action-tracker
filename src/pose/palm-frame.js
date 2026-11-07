// Hand21 wrist and MCP joint centres define a palm, independently of finger curl.
// Directions are in canonical camera axes (x right, y up, z toward the camera).
export function palmFrameFromPoints({ wrist, index, middle, pinky, side, reflectionParity = 1 }) {
  if (![wrist, index, middle, pinky].every(finitePoint)) return null;
  const acrossIndex = sub(index, wrist), acrossPinky = sub(pinky, wrist);
  const indexLength = length(acrossIndex), pinkyLength = length(acrossPinky);
  const crossProduct = cross(acrossIndex, acrossPinky);
  const planeSine = length(crossProduct) / (indexLength * pinkyLength);
  const primary = normalize(sub(middle, wrist));
  if (!primary || !Number.isFinite(planeSine) || planeSine < 0.05) return null;
  const sign = (side === "Left" ? 1 : -1) * (reflectionParity < 0 ? -1 : 1);
  let normal = normalize(scale(crossProduct, sign));
  normal = normal && normalize(sub(normal, scale(primary, dot(normal, primary))));
  if (!normal) return null;
  const binormal = normalize(cross(primary, normal));
  return { primary, normal, binormal, center: scale(add(add(wrist, index), add(middle, pinky)), 0.25), planeSine };
}

export function hand21PalmFrame(frame, side) {
  const world = frame?.[`${side.toLowerCase()}HandWorldLandmarks`];
  if (!Array.isArray(world) || world.length !== 21) return null;
  const points = world.map(point => canonicalHandPoint(point, Boolean(frame.mirrored)));
  return palmFrameFromPoints({ wrist: points[0], index: points[5], middle: points[9], pinky: points[17], side,
    reflectionParity: frame.mirrored ? -1 : 1 });
}

export function canonicalHandPoint(point, mirrored = false) {
  return finitePoint(point) ? { x: point.x * (mirrored ? -1 : 1), y: -point.y, z: -point.z } : null;
}

export function comparePalmFrames(reference, actual) {
  if (!reference || !actual) return { primaryDeg: null, normalDeg: null, rotationDeg: null };
  const axes = ["primary", "normal", "binormal"];
  if (![reference, actual].every(frame => axes.every(axis => finitePoint(frame[axis])))) {
    return { primaryDeg: null, normalDeg: null, rotationDeg: null };
  }
  return {
    primaryDeg: angle(reference.primary, actual.primary),
    normalDeg: angle(reference.normal, actual.normal),
    // trace(R_ref^T R_actual), for the orthonormal right-handed palm frames.
    rotationDeg: Math.acos(clamp((axes.reduce((sum, axis) => sum + dot(reference[axis], actual[axis]), 0) - 1) / 2)) * 180 / Math.PI,
  };
}

export function handObservationTiming(frame, side) {
  const meta = frame?.sourceMeta ?? {};
  const teacher = meta.hands === "mhr70-to-mediapipe21";
  const state = meta[`hand${side}ObservationState`] ?? null;
  const predicted = meta[`hand${side}Predicted`] === true || state === "pose-guided-prediction";
  const pts = meta.sourcePtsSec;
  const observedPts = teacher ? pts : meta[`hand${side}ObservedSourcePtsSec`] ?? meta[`hand${side}SourcePtsSec`];
  // Use the same integer-microsecond clock as the exact-PTS evaluation; decimal
  // floating-point subtraction must not move an observation across 100 ms.
  const ageUs = Number.isFinite(pts) && Number.isFinite(observedPts)
    ? Math.round(pts * 1e6) - Math.round(observedPts * 1e6) : null;
  const ageMs = ageUs === null ? null : ageUs / 1000;
  const causal = ageUs !== null && ageUs >= 0;
  return { sourcePtsSec: observedPts ?? null, ageMs, state, predicted, causal,
    fresh100ms: causal && !predicted && ageUs <= 100000,
    sameFrame: causal && !predicted && ageUs === 0 };
}

// A Hand21 observation may be stale or a different hand inside a crossed-hand
// ROI. It only refines a current Pose basis when both observed axes agree.
export function selectConsistentPalmBasis(poseBasis, handBasis, timing) {
  if (!handBasis || !timing?.fresh100ms || !poseBasis?.valid) return poseBasis;
  const primaryDifference = angle(poseBasis.primary, handBasis.primary);
  const normalDifference = angle(poseBasis.normal, handBasis.normal);
  if (primaryDifference > 45 || normalDifference > 45) return poseBasis;
  const primary = normalize(add(poseBasis.primary, handBasis.primary));
  let normal = normalize(add(poseBasis.normal, handBasis.normal));
  if (!primary || !normal) return poseBasis;
  normal = normalize(sub(normal, scale(primary, dot(primary, normal))));
  if (!normal) return poseBasis;
  return { ...poseBasis, primary, normal, source: "pose-consistent-hand21", hand21Accepted: true,
    observationAgeMs: timing.ageMs, observationSourcePtsSec: timing.sourcePtsSec, primaryDifference, normalDifference };
}

function finitePoint(point) { return point && [point.x, point.y, point.z].every(Number.isFinite); }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a, b) { return { x: a.x * b, y: a.y * b, z: a.z * b }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function length(a) { return Math.hypot(a.x, a.y, a.z); }
function normalize(a) { const size = length(a); return size > 1e-8 ? scale(a, 1 / size) : null; }
function cross(a, b) { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }; }
function clamp(value) { return Math.max(-1, Math.min(1, value)); }
function angle(a, b) { return Math.acos(clamp(dot(a, b))) * 180 / Math.PI; }
