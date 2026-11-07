import { buildCanonicalPose, buildCanonicalPosePoints } from "../../src/pose/canonical-pose.js";
import { quaternionSignInvariantAngleDeg, endpointHeightNormalizedError } from "../../src/avatar-applied-state.js";
import { directionErrorDeg, summarizeSamples } from "./sam-pairing.mjs";
import { hand21PalmFrame, comparePalmFrames, handObservationTiming } from "../../src/pose/palm-frame.js";

export const BODY_REGION_REPORT_VERSION = 2;

// These cutoffs are diagnostics derived from the existing design targets. A
// frame-wise maximum cutoff is NOT the project's aggregate P95 acceptance gate.
export const REGION_METRICS = Object.freeze({
  directionDeg: { label: "방향 오차", unit: "degrees", diagnosticThreshold: 20 },
  localRotationDeg: { label: "local 회전 차이", unit: "degrees", diagnosticThreshold: 20 },
  palmFrameDeg: { label: "손바닥 world 회전 차이", unit: "degrees", diagnosticThreshold: 20 },
  headAxisDeg: { label: "Head→HeadTop_End marker와 SAM prior의 차이", unit: "degrees", diagnosticThreshold: 20 },
  headBindUpDeg: { label: "bind 기준 모델 +Y 축과 SAM prior의 차이", unit: "degrees", diagnosticThreshold: 20 },
  fkLocalPctH: { label: "model-local 위치 차이", unit: "percent-avatar-height", diagnosticThreshold: 4 },
  fkWorldPctH: { label: "world 위치 차이", unit: "percent-avatar-height", diagnosticThreshold: 4 },
});

const parts = {
  torso: { label: "몸통", directions: ["torso"], bones: ["Spine", "Spine1", "Spine2"], endpoints: [] },
  headNeck: { label: "머리·목", directions: ["neck", "head"], bones: ["Neck", "Head"], endpoints: ["Head"] },
  leftArm: { label: "왼팔", directions: ["leftUpperArm", "leftForeArm"], bones: ["LeftArm", "LeftForeArm"], endpoints: ["LeftHand"] },
  rightArm: { label: "오른팔", directions: ["rightUpperArm", "rightForeArm"], bones: ["RightArm", "RightForeArm"], endpoints: ["RightHand"] },
  leftLeg: { label: "왼다리", directions: ["leftUpperLeg", "leftLowerLeg"], bones: ["LeftUpLeg", "LeftLeg", "LeftFoot"], endpoints: ["LeftFoot"] },
  rightLeg: { label: "오른다리", directions: ["rightUpperLeg", "rightLowerLeg"], bones: ["RightUpLeg", "RightLeg", "RightFoot"], endpoints: ["RightFoot"] },
  pelvis: { label: "골반 회전", directions: [], bones: ["Hips"], endpoints: [] },
  leftPalm: { label: "왼손바닥", directions: ["leftPalmPrimary", "leftPalmNormal"], bones: ["LeftHand"], endpoints: ["LeftPalm"], palms: ["Left"] },
  rightPalm: { label: "오른손바닥", directions: ["rightPalmPrimary", "rightPalmNormal"], bones: ["RightHand"], endpoints: ["RightPalm"], palms: ["Right"] },
};
const group = (label, keys) => ({ label, ...Object.fromEntries(
  ["directions", "bones", "endpoints"].map(key => [key, [...new Set(keys.flatMap(part => parts[part][key]))]]),
) });

// Upper/lower are overlapping summary views of the detailed parts, never extra
// samples in a whole-body score. The six collinear torso proxies count only once.
export const BODY_REGIONS = Object.freeze({
  upperBody: group("상체", ["torso", "headNeck", "leftArm", "rightArm"]),
  lowerBody: group("하체", ["leftLeg", "rightLeg"]),
  ...parts,
});

const DIRECTION_POINTS = {
  torso: ["hipMid", "shoulderMid"], neck: ["chest", "headAimBase"], head: ["headAimBase", "headCrown"],
  leftUpperArm: ["leftShoulder", "leftElbow"], leftForeArm: ["leftElbow", "leftWrist"],
  rightUpperArm: ["rightShoulder", "rightElbow"], rightForeArm: ["rightElbow", "rightWrist"],
  leftUpperLeg: ["leftHip", "leftKnee"], leftLowerLeg: ["leftKnee", "leftAnkle"],
  rightUpperLeg: ["rightHip", "rightKnee"], rightLowerLeg: ["rightKnee", "rightAnkle"],
};
const allBones = [...new Set(Object.values(parts).flatMap(part => part.bones))];
const allEndpoints = [...new Set(Object.values(parts).flatMap(part => part.endpoints))];

// Recover unique Hand21 observations from the delivery log and evaluate at
// their recorded observation PTS, never at the later Body delivery PTS. This
// is a lower bound on the hand stream: observations never delivered are absent.
export function scoreRecordedHandObservations({ liveFrames, teacherFrames }) {
  const ptsKey = seconds => Number.isFinite(seconds) ? Math.round(seconds * 1e6) : null;
  const liveByPts = new Map(liveFrames.map(frame => [ptsKey(frame.sourceMeta?.sourcePtsSec), frame]));
  const teacherByPts = new Map(teacherFrames.map(frame => [ptsKey(frame.sourceMeta?.sourcePtsSec), frame]));
  return Object.fromEntries(['Left', 'Right'].map(side => {
    const unique = new Map();
    let duplicateDeliveries = 0, invalidTimingDeliveries = 0;
    for (const frame of liveFrames) {
      const world = frame[`${side.toLowerCase()}HandWorldLandmarks`];
      if (!Array.isArray(world) || world.length !== 21) continue;
      const timing = handObservationTiming(frame, side);
      if (!timing.causal || timing.predicted) { invalidTimingDeliveries++; continue; }
      const key = ptsKey(timing.sourcePtsSec), signature = JSON.stringify([frame.mirrored, world]);
      const existing = unique.get(key);
      if (existing) {
        duplicateDeliveries++;
        if (existing.signature !== signature) existing.conflict = true;
      } else unique.set(key, { ptsUs: key, frame, signature, firstDeliveryAgeMs: timing.ageMs, conflict: false });
    }
    const rows = [], rejected = { conflictingObservations: 0, sourcePtsNotVerified: 0, missingTeacher: 0, invalidPalmBasis: 0 };
    for (const observation of unique.values()) {
      const origin = liveByPts.get(observation.ptsUs), teacher = teacherByPts.get(observation.ptsUs);
      let reason = null;
      if (observation.conflict) reason = 'conflictingObservations';
      else if (origin?.sourceMeta?.sourcePtsSource !== 'rvfc-media-time' || origin.mirrored !== observation.frame.mirrored) reason = 'sourcePtsNotVerified';
      else if (teacher?.canonicalPose?.status !== 'observed') reason = 'missingTeacher';
      const error = comparePalmFrames(hand21PalmFrame(teacher, side), hand21PalmFrame(observation.frame, side));
      if (!reason && error.rotationDeg === null) reason = 'invalidPalmBasis';
      if (reason) rejected[reason]++;
      rows.push({ ptsUs: observation.ptsUs, firstDeliveryAgeMs: observation.firstDeliveryAgeMs,
        reason, ...(reason ? { primaryDeg: null, normalDeg: null, rotationDeg: null } : error) });
    }
    rows.sort((a, b) => a.ptsUs - b.ptsUs);
    const scored = rows.filter(row => !row.reason);
    return [side, { uniqueRecordedObservations: unique.size, exactScoredObservations: scored.length,
      duplicateDeliveries, invalidTimingDeliveries, rejected,
      conditionalCoverage: unique.size ? scored.length / unique.size : null,
      sourceTimelineCoverageLowerBound: teacherFrames.length ? scored.length / teacherFrames.length : null,
      primaryDeg: summarizeSamples(scored.map(row => row.primaryDeg)),
      normalDeg: summarizeSamples(scored.map(row => row.normalDeg)),
      rotationDeg: summarizeSamples(scored.map(row => row.rotationDeg)),
      firstDeliveryAgeMs: summarizeSamples(scored.map(row => row.firstDeliveryAgeMs)), rows }];
  }));
}

export function rawDetectorRegionFrame(live, teacher, pair) {
  const raw = live?.rawPoseObservation;
  if (raw?.version !== 1 || raw.provenance !== "detector-output") throw new Error("Regional scoring requires raw detector output");
  assertPts(raw.sourcePtsSec, pair.ptsUs, "raw detector");
  assertPts(live.sourceMeta?.sourcePtsSec, pair.ptsUs, "live");
  assertPts(teacher?.sourceMeta?.sourcePtsSec, pair.ptsUs, "teacher");
  if (live.sourceMeta?.sourcePtsSource !== "rvfc-media-time") throw new Error("Regional scoring requires exact rVFC PTS");
  // Rebuild directly from preserved raw world observations. No legacy adapter,
  // fitted scale/yaw, confidence selection or reference-dependent correction.
  const livePoints = buildCanonicalPosePoints({ ...live, canonicalPose: buildCanonicalPose(live) });
  const teacherPoints = buildCanonicalPosePoints(teacher);
  const directions = Object.fromEntries(Object.entries(DIRECTION_POINTS).map(([name, [a, b]]) => [
    name, directionErrorDeg(livePoints[a], livePoints[b], teacherPoints[a], teacherPoints[b]),
  ]));
  const palmFrameDeg = {}, palmObservations = {};
  for (const side of ["Left", "Right"]) {
    const errors = comparePalmFrames(hand21PalmFrame(teacher, side), hand21PalmFrame(live, side));
    directions[`${side.toLowerCase()}PalmPrimary`] = errors.primaryDeg;
    directions[`${side.toLowerCase()}PalmNormal`] = errors.normalDeg;
    palmFrameDeg[side] = errors.rotationDeg;
    palmObservations[side] = { ...handObservationTiming(live, side), basisAvailable: errors.rotationDeg !== null };
  }
  return { ...frameKey(pair), metrics: { directionDeg: directions, palmFrameDeg }, palmObservations };
}

export function appliedAvatarRegionFrame(row, reference, teacherFrame = null) {
  const actual = row.appliedAvatarState;
  if (actual) assertPts(actual.timing?.sourcePtsSec, row.ptsUs, "applied avatar");
  if (reference) assertPts(reference.timing?.sourcePtsSec, row.ptsUs, "reference avatar");
  const height = reference?.modelHeight;
  const localRotationDeg = Object.fromEntries(allBones.map(bone => [bone,
    quaternionSignInvariantAngleDeg(reference?.bones?.[bone]?.localQuaternion, actual?.bones?.[bone]?.localQuaternion),
  ]));
  const directions = actual ? { ...row.directionErrorDeg } : {};
  const palmFrameDeg = {};
  for (const side of ["Left", "Right"]) {
    const errors = comparePalmFrames(teacherFrame ? hand21PalmFrame(teacherFrame, side) : null, actual?.palms?.[side]?.world);
    directions[`${side.toLowerCase()}PalmPrimary`] = errors.primaryDeg;
    directions[`${side.toLowerCase()}PalmNormal`] = errors.normalDeg;
    palmFrameDeg[side] = errors.rotationDeg;
  }
  const teacherPoints = teacherFrame ? buildCanonicalPosePoints(teacherFrame) : {};
  const headAxisDeg = { HeadCrownAxis: actual?.headCrownAxisWorld ? directionErrorDeg(
    { x: 0, y: 0, z: 0 }, actual.headCrownAxisWorld, teacherPoints.headAimBase, teacherPoints.headCrown) : null };
  const headBindUpDeg = { HeadBindUp: actual?.headBindUpAxisWorld ? directionErrorDeg(
    { x: 0, y: 0, z: 0 }, actual.headBindUpAxisWorld, teacherPoints.headAimBase, teacherPoints.headCrown) : null };
  const metrics = { directionDeg: directions, localRotationDeg, palmFrameDeg, headAxisDeg, headBindUpDeg };
  for (const [metric, positionKey] of [["fkLocalPctH", "modelLocalPosition"], ["fkWorldPctH", "worldPosition"]]) {
    metrics[metric] = Object.fromEntries(allEndpoints.map(endpoint => {
      const error = endpointHeightNormalizedError(
        endpointPosition(reference, endpoint, positionKey), endpointPosition(actual, endpoint, positionKey), height,
      );
      return [endpoint, error === null ? null : error * 100];
    }));
  }
  return { ...frameKey(row), metrics };
}

export function summarizeBodyRegions(frames, { expectedFrameCount = frames.length, metricNames = Object.keys(REGION_METRICS) } = {}) {
  if (!Number.isInteger(expectedFrameCount) || expectedFrameCount < frames.length) throw new Error("Invalid expected regional frame count");
  let previousPts = -1;
  for (const frame of frames) {
    if (!Number.isSafeInteger(frame.ptsUs) || frame.ptsUs <= previousPts) throw new Error("Duplicate/non-monotonic regional PTS");
    previousPts = frame.ptsUs;
  }
  for (const metric of metricNames) if (!REGION_METRICS[metric]) throw new Error(`Unknown regional metric: ${metric}`);
  const regions = Object.fromEntries(Object.entries(BODY_REGIONS).map(([id, region]) => [id, {
    label: region.label,
    metrics: Object.fromEntries(metricNames.map(metric => [metric,
      summarizeRegionMetric(frames, region, metric, expectedFrameCount),
    ])),
  }]));
  return {
    version: BODY_REGION_REPORT_VERSION, expectedFrameCount, recordedFrameCount: frames.length,
    regions,
    upperLower: Object.fromEntries(metricNames.filter(metric => membersFor(BODY_REGIONS.upperBody, metric).length
      && membersFor(BODY_REGIONS.lowerBody, metric).length).map(metric => [metric,
      summarizeUpperLower(frames, metric, expectedFrameCount),
    ])),
  };
}

function summarizeRegionMetric(frames, region, metric, expectedFrames) {
  const members = membersFor(region, metric);
  if (!members.length) return { status: "not-applicable", members: [] };
  const samples = [], worstFrames = [], memberSamples = Object.fromEntries(members.map(name => [name, []]));
  let within = 0;
  for (const frame of frames) {
    const values = members.map(member => validError(frame.metrics?.[metric]?.[member], metric));
    values.forEach((value, index) => {
      if (value !== null) { samples.push(value); memberSamples[members[index]].push(value); }
    });
    if (values.every(value => value !== null)) {
      const error = Math.max(...values);
      worstFrames.push({ ...frameKey(frame), error, worstMember: members[values.indexOf(error)] });
      if (error <= REGION_METRICS[metric].diagnosticThreshold) within++;
    }
  }
  return {
    status: samples.length ? "measured" : "unavailable", members,
    samples: summarizeSamples(samples),
    // P95 over real per-frame maxima, not a mean/max of marginal P95s.
    frameWorst: summarizeSamples(worstFrames.map(frame => frame.error)),
    byMember: Object.fromEntries(Object.entries(memberSamples).map(([name, values]) => [name, summarizeSamples(values)])),
    coverage: {
      expectedFrames, completeFrames: worstFrames.length, missingFrames: expectedFrames - worstFrames.length,
      completeFrameRatio: ratio(worstFrames.length, expectedFrames),
      expectedSamples: expectedFrames * members.length, measuredSamples: samples.length,
      sampleRatio: ratio(samples.length, expectedFrames * members.length),
    },
    diagnostic: {
      threshold: REGION_METRICS[metric].diagnosticThreshold,
      withinFrames: within, overFrames: worstFrames.length - within, unscorableFrames: expectedFrames - worstFrames.length,
      // Missing frames remain in the denominator and cannot count as success.
      withinRatio: ratio(within, expectedFrames), overRatio: ratio(worstFrames.length - within, expectedFrames),
    },
    worstFrames: worstFrames.sort((a, b) => b.error - a.error || a.ptsUs - b.ptsUs).slice(0, 5),
  };
}

function summarizeUpperLower(frames, metric, expectedFrames) {
  const counts = { bothWithin: 0, upperWithinLowerOver: 0, upperOverLowerWithin: 0, bothOver: 0, unscorable: expectedFrames - frames.length };
  const examples = { upperWithinLowerOver: [], upperOverLowerWithin: [] };
  const threshold = REGION_METRICS[metric].diagnosticThreshold;
  for (const frame of frames) {
    const upper = completeFrameWorst(frame, BODY_REGIONS.upperBody, metric);
    const lower = completeFrameWorst(frame, BODY_REGIONS.lowerBody, metric);
    if (upper === null || lower === null) { counts.unscorable++; continue; }
    const key = upper <= threshold
      ? lower <= threshold ? "bothWithin" : "upperWithinLowerOver"
      : lower <= threshold ? "upperOverLowerWithin" : "bothOver";
    counts[key]++;
    if (examples[key]) examples[key].push({ ...frameKey(frame), upperWorst: upper, lowerWorst: lower });
  }
  for (const [key, values] of Object.entries(examples)) {
    const worstKey = key === "upperWithinLowerOver" ? "lowerWorst" : "upperWorst";
    examples[key] = values.sort((a, b) => b[worstKey] - a[worstKey] || a.ptsUs - b.ptsUs).slice(0, 5);
  }
  return { threshold, expectedFrames, counts,
    ratios: Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, ratio(count, expectedFrames)])), examples };
}

function completeFrameWorst(frame, region, metric) {
  const values = membersFor(region, metric).map(member => validError(frame.metrics?.[metric]?.[member], metric));
  return values.length && values.every(value => value !== null) ? Math.max(...values) : null;
}

function membersFor(region, metric) {
  if (metric === "headAxisDeg") return region === BODY_REGIONS.headNeck ? ["HeadCrownAxis"] : [];
  if (metric === "headBindUpDeg") return region === BODY_REGIONS.headNeck ? ["HeadBindUp"] : [];
  if (metric === "palmFrameDeg") return region.palms ?? [];
  return region[metric === "directionDeg" ? "directions" : metric === "localRotationDeg" ? "bones" : "endpoints"];
}

function endpointPosition(state, endpoint, space) {
  if (endpoint.endsWith("Palm")) return state?.palms?.[endpoint.slice(0, -4)]?.[space === "worldPosition" ? "world" : "modelLocal"]?.center;
  return state?.fkEndpoints?.[endpoint]?.[space];
}

function validError(value, metric) {
  return Number.isFinite(value) && value >= 0 && (!metric.endsWith("Deg") || value <= 180) ? value : null;
}

function assertPts(seconds, expected, label) {
  if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isFinite(seconds) || Math.round(seconds * 1e6) !== expected) {
    throw new Error(`Mismatched ${label} PTS`);
  }
}

function frameKey({ ptsUs, teacherIndex, liveIndex }) {
  return { ptsUs, teacherIndex, liveIndex };
}

function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
