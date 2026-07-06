import {
  ANATOMICAL_CONSTRAINTS,
  constrainHingeChildDirection,
  constrainPoseTargets,
  createAnatomyState,
  evaluateHingeFlexion,
  evaluateLowerBodyReliability,
  evaluateTargetCone,
} from "../retarget/anatomical-constraints.js";
import {
  estimateFacingState,
  toLegacyFacing,
} from "./facing-estimator.js";

const SOLVER_VERSION = 1;
const MIN_DIRECTION_LENGTH = 0.000001;
const FULL_CONFIDENCE_VISIBILITY = 0.72;
const LOW_CONFIDENCE_VISIBILITY = 0.35;
const HINGE_RELIABLE_CONFIDENCE = 0.5;
const HINGE_LIMIT_EPSILON_DEG = 2;
const TARGET_RELIABLE_CONFIDENCE = 0.5;
const ARM_OCCLUSION_HOLD_MS = 260;
const ARM_OCCLUSION_DECAY_MS = 760;
const ARM_REACQUIRE_MAX_DEG_PER_SEC = 420;

const POSE = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
};

const BODY_TARGETS = [
  { bone: "Hips", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine1", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Spine2", from: "hipMid", to: "shoulderMid", group: "torso" },
  { bone: "Neck", from: "shoulderMid", to: "headAimBase", group: "head" },
  { bone: "Head", from: "headAimBase", to: "headCrown", group: "head" },
  { bone: "LeftShoulder", from: "shoulderMid", to: "leftShoulder", group: "shoulder" },
  { bone: "RightShoulder", from: "shoulderMid", to: "rightShoulder", group: "shoulder" },
  { bone: "LeftArm", from: "leftShoulder", to: "leftElbow", group: "arms" },
  { bone: "LeftForeArm", from: "leftElbow", to: "leftWrist", group: "arms", hinge: "leftElbow" },
  { bone: "RightArm", from: "rightShoulder", to: "rightElbow", group: "arms" },
  { bone: "RightForeArm", from: "rightElbow", to: "rightWrist", group: "arms", hinge: "rightElbow" },
  { bone: "LeftUpLeg", from: "leftHip", to: "leftKnee", group: "legs" },
  { bone: "LeftLeg", from: "leftKnee", to: "leftAnkle", group: "legs", hinge: "leftKnee" },
  { bone: "LeftFoot", from: "leftAnkle", to: "leftFootIndex", group: "feet" },
  { bone: "RightUpLeg", from: "rightHip", to: "rightKnee", group: "legs" },
  { bone: "RightLeg", from: "rightKnee", to: "rightAnkle", group: "legs", hinge: "rightKnee" },
  { bone: "RightFoot", from: "rightAnkle", to: "rightFootIndex", group: "feet" },
];

const HINGES = [
  {
    name: "leftElbow",
    group: "arms",
    parent: "leftShoulder",
    joint: "leftElbow",
    child: "leftWrist",
    minFlexDeg: 0,
    maxFlexDeg: 155,
  },
  {
    name: "rightElbow",
    group: "arms",
    parent: "rightShoulder",
    joint: "rightElbow",
    child: "rightWrist",
    minFlexDeg: 0,
    maxFlexDeg: 155,
  },
  {
    name: "leftKnee",
    group: "legs",
    parent: "leftHip",
    joint: "leftKnee",
    child: "leftAnkle",
    minFlexDeg: 0,
    maxFlexDeg: 165,
  },
  {
    name: "rightKnee",
    group: "legs",
    parent: "rightHip",
    joint: "rightKnee",
    child: "rightAnkle",
    minFlexDeg: 0,
    maxFlexDeg: 165,
  },
];

export {
  BODY_TARGETS,
  HINGES,
  LOW_CONFIDENCE_VISIBILITY,
  POSE,
  SOLVER_VERSION,
  buildPosePoints,
  estimateFacing,
  estimateTrackingMode,
  retargetConfidence,
  solveHinges,
  solvePoseFrame,
  solvePoseTargetsFromPoints,
};

function solvePoseFrame(motionFrame, previousState = {}, options = {}) {
  const points = buildPosePoints(motionFrame);

  return solvePoseTargetsFromPoints(points, previousState, {
    timestamp: Number(motionFrame?.timestamp ?? 0),
    ...options,
  });
}

function solvePoseTargetsFromPoints(points, previousState = {}, options = {}) {
  const timestamp = Number(options.timestamp ?? 0);
  const targetStabilizationEnabled = options.targetStabilization !== false;
  const mode = estimateTrackingMode(points);
  const facingState = estimateFacingState(points, previousState.facing, {
    lowConfidence: LOW_CONFIDENCE_VISIBILITY,
    timestamp,
  });
  const facing = toLegacyFacing(facingState.state);
  const torsoBasis = buildTorsoBasis(points);
  const rawTargets = BODY_TARGETS.map((target) => solveTarget(target, points))
    .map((target) => target ? enrichTargetWithTorsoBasis(target, torsoBasis) : null)
    .filter(Boolean);
  const anatomy = evaluatePoseAnatomy(points, rawTargets, previousState.anatomy, {
    timestamp,
  });
  const anatomyConstrainedTargets = applyConstrainedTargetDirections(constrainPoseTargets({
    targets: rawTargets,
    anatomy,
  }), torsoBasis);
  const targetStabilization = targetStabilizationEnabled
    ? stabilizeTargets(anatomyConstrainedTargets, previousState.targetMemory, {
      points,
      timestamp,
    })
    : {
      targets: anatomyConstrainedTargets,
      memory: {},
      summary: summarizeTargetOcclusion(anatomyConstrainedTargets),
    };
  const targets = targetStabilization.targets;
  const anatomySummary = summarizeTargetAnatomy(targets);
  const hinges = solveHinges(points);
  const hingeViolations = hinges.filter((hinge) => hinge.violation).length;
  const hingeLimitWarnings = hinges.filter((hinge) => hinge.limitWarning).length;

  return {
    version: SOLVER_VERSION,
    timestamp,
    rotations: {},
    targets,
    hinges,
    state: {
      facing: facingState,
      mode,
      targetMemory: targetStabilization.memory,
      anatomy: anatomy.state,
    },
    meta: {
      facing,
      facingDetail: facingState.state,
      facingYawDeg: facingState.yawDeg,
      facingUnwrappedYawDeg: facingState.unwrappedYawDeg,
      facingRawYawDeg: facingState.rawYawDeg,
      facingRawYawDeltaDeg: facingState.rawYawDeltaDeg,
      facingLimitedYawDeltaDeg: facingState.limitedYawDeltaDeg,
      facingRawYawJump: facingState.rawYawJump,
      facingYawFlipCount: facingState.yawFlipCount,
      facingSideOrderSign: facingState.sideOrderSign,
      facingSideOrderConfidence: facingState.sideOrderConfidence,
      facingSideOrderFlip: facingState.sideOrderFlip,
      facingYawReliable: facingState.yawReliable,
      facingYawReliabilityReason: facingState.yawReliabilityReason,
      facingUnreliableYawFrames: facingState.unreliableYawFrames,
      facingStableYawFrames: facingState.stableYawFrames,
      facingRecoveringFromUnreliableYaw: facingState.recoveringFromUnreliableYaw,
      facingLastReliableYawDeg: facingState.lastReliableYawDeg,
      facingRecoveryTargetYawDeg: facingState.recoveryTargetYawDeg,
      facingUnstableYawCandidateDeg: facingState.unstableYawCandidateDeg,
      facingUnstableYawCandidateFrames: facingState.unstableYawCandidateFrames,
      facingConfidence: facingState.confidence,
      facingReason: facingState.reason,
      mode,
      targetCount: targets.length,
      lowConfidenceTargets: targets.filter((target) => target.confidence <= LOW_CONFIDENCE_VISIBILITY).length,
      occlusionActiveTargets: targetStabilization.summary.activeCount,
      occlusionHoldTargets: targetStabilization.summary.holdCount,
      occlusionDecayTargets: targetStabilization.summary.decayCount,
      occlusionReacquireTargets: targetStabilization.summary.reacquireCount,
      implausibleTargets: targets.filter((target) => target.implausible).length,
      implausibleRatio: round(targets.filter((target) => target.implausible).length / Math.max(1, targets.length), 6),
      hingeCount: hinges.length,
      hingeViolations,
      hingeLimitWarnings,
      lowConfidenceHinges: hinges.filter((hinge) => hinge.confidence < HINGE_RELIABLE_CONFIDENCE).length,
      anatomySoftViolations: anatomySummary.softViolations,
      anatomyHardViolations: anatomySummary.hardViolations,
      anatomyLowerBodyReliable: anatomy.lowerBody.reliable,
      anatomyLowerBodyConfidence: anatomy.lowerBody.confidence,
      anatomyConstrainedTargets: anatomySummary.constrainedTargets,
    },
  };
}

function stabilizeTargets(rawTargets, previousMemory = {}, options = {}) {
  const timestamp = Number(options.timestamp ?? 0);
  const previous = previousMemory && typeof previousMemory === "object" ? previousMemory : {};
  const memory = {};
  const targets = rawTargets.map((target) => {
    if (target.group !== "arms") {
      return target;
    }

    const previousTarget = previous[target.bone];
    const occlusionRisk = estimateArmOcclusionRisk(target);
    const trackingConfidence = Number.isFinite(Number(target.rawConfidence))
      ? Number(target.rawConfidence)
      : Number(target.confidence ?? 0);
    const targetReliable = trackingConfidence >= TARGET_RELIABLE_CONFIDENCE && !occlusionRisk.active;
    const stabilized = targetReliable
      ? stabilizeReliableTarget(target, previousTarget, timestamp)
      : stabilizeOccludedTarget(target, previousTarget, timestamp, occlusionRisk);

    if (stabilized.memory) {
      memory[target.bone] = stabilized.memory;
    }

    return stabilized.target;
  });

  for (const target of rawTargets) {
    if (target.group === "arms" || !target.direction) {
      continue;
    }

    memory[target.bone] = {
      direction: target.direction,
      directionTorsoLocal: target.directionTorsoLocal,
      confidence: target.confidence,
      timestamp,
      reliableTimestamp: target.confidence >= TARGET_RELIABLE_CONFIDENCE ? timestamp : null,
      occlusionState: "tracking",
      occluded: false,
    };
  }

  return {
    targets,
    memory,
    summary: summarizeTargetOcclusion(targets),
  };
}

function stabilizeReliableTarget(target, previousTarget, timestamp) {
  const previousOccluded = previousTarget?.occluded === true ||
    previousTarget?.occlusionState === "hold" ||
    previousTarget?.occlusionState === "decay";
  const elapsedMs = Number.isFinite(timestamp) && Number.isFinite(Number(previousTarget?.timestamp))
    ? Math.max(0, timestamp - Number(previousTarget.timestamp))
    : 0;
  const maxReacquireAngleDeg = elapsedMs > 0
    ? (elapsedMs / 1000) * ARM_REACQUIRE_MAX_DEG_PER_SEC
    : ARM_REACQUIRE_MAX_DEG_PER_SEC / 30;
  const angleDeg = previousOccluded && previousTarget?.direction
    ? directionAngleDeg(previousTarget.direction, target.direction)
    : 0;
  const shouldClamp = previousOccluded && previousTarget?.direction && angleDeg > maxReacquireAngleDeg;
  const direction = shouldClamp
    ? blendDirections(previousTarget.direction, target.direction, maxReacquireAngleDeg / angleDeg)
    : target.direction;
  const directionTorsoLocal = shouldClamp && previousTarget.directionTorsoLocal && target.directionTorsoLocal
    ? blendDirections(previousTarget.directionTorsoLocal, target.directionTorsoLocal, maxReacquireAngleDeg / angleDeg)
    : target.directionTorsoLocal;
  const occlusionState = shouldClamp ? "reacquire" : "tracking";
  const stabilizedTarget = {
    ...target,
    direction,
    directionTorsoLocal,
    occlusionState,
    occlusionReason: shouldClamp ? "reacquire_angular_limit" : "none",
    rawDirection: target.rawDirection ?? target.direction,
    rawDirectionTorsoLocal: target.rawDirectionTorsoLocal ?? target.directionTorsoLocal,
  };

  return {
    target: stabilizedTarget,
    memory: {
      direction,
      directionTorsoLocal,
      confidence: target.confidence,
      timestamp,
      reliableTimestamp: timestamp,
      occlusionState,
      occluded: false,
    },
  };
}

function stabilizeOccludedTarget(target, previousTarget, timestamp, occlusionRisk) {
  if (!previousTarget?.direction) {
    const direction = target.direction;
    return {
      target: {
        ...target,
        anatomy: null,
        constrainedDirection: direction,
        occlusionState: occlusionRisk.active ? "detected" : "low-confidence",
        occlusionReason: occlusionRisk.reason,
        rawDirection: target.rawDirection ?? target.direction,
        rawDirectionTorsoLocal: target.rawDirectionTorsoLocal ?? target.directionTorsoLocal,
      },
      memory: {
        direction: target.direction,
        directionTorsoLocal: target.directionTorsoLocal,
        confidence: target.confidence,
        timestamp,
        reliableTimestamp: null,
        occlusionState: occlusionRisk.active ? "detected" : "low-confidence",
        occluded: occlusionRisk.active || target.confidence < TARGET_RELIABLE_CONFIDENCE,
      },
    };
  }

  const reliableTimestamp = Number.isFinite(Number(previousTarget.reliableTimestamp))
    ? Number(previousTarget.reliableTimestamp)
    : Number(previousTarget.timestamp);
  const elapsedSinceReliableMs = Number.isFinite(timestamp) && Number.isFinite(reliableTimestamp)
    ? Math.max(0, timestamp - reliableTimestamp)
    : 0;
  let occlusionState = "hold";
  let direction = previousTarget.direction;
  let directionTorsoLocal = previousTarget.directionTorsoLocal ?? target.directionTorsoLocal;

  if (elapsedSinceReliableMs > ARM_OCCLUSION_HOLD_MS) {
    occlusionState = "decay";
    const decayProgress = clamp(
      (elapsedSinceReliableMs - ARM_OCCLUSION_HOLD_MS) /
        Math.max(1, ARM_OCCLUSION_DECAY_MS - ARM_OCCLUSION_HOLD_MS),
      0,
      1,
    );
    direction = blendDirections(previousTarget.direction, target.direction, decayProgress * 0.35);
    if (previousTarget.directionTorsoLocal && target.directionTorsoLocal) {
      directionTorsoLocal = blendDirections(previousTarget.directionTorsoLocal, target.directionTorsoLocal, decayProgress * 0.35);
    }
  }

  if (elapsedSinceReliableMs > ARM_OCCLUSION_DECAY_MS) {
    occlusionState = "expired";
    direction = target.direction;
    directionTorsoLocal = target.directionTorsoLocal;
  }

  return {
    target: {
      ...target,
      anatomy: occlusionState === "expired" ? target.anatomy : null,
      constrainedDirection: direction,
      direction,
      directionTorsoLocal,
      occlusionState,
      occlusionReason: occlusionRisk.reason,
      rawDirection: target.rawDirection ?? target.direction,
      rawDirectionTorsoLocal: target.rawDirectionTorsoLocal ?? target.directionTorsoLocal,
    },
    memory: {
      direction,
      directionTorsoLocal,
      confidence: target.confidence,
      timestamp,
      reliableTimestamp,
      occlusionState,
      occluded: occlusionState !== "expired",
    },
  };
}

function summarizeTargetOcclusion(targets) {
  const summary = {
    activeCount: 0,
    holdCount: 0,
    decayCount: 0,
    reacquireCount: 0,
  };

  for (const target of targets) {
    if (target.occlusionState === "hold" || target.occlusionState === "decay") {
      summary.activeCount += 1;
    }
    if (target.occlusionState === "hold") {
      summary.holdCount += 1;
    }
    if (target.occlusionState === "decay") {
      summary.decayCount += 1;
    }
    if (target.occlusionState === "reacquire") {
      summary.reacquireCount += 1;
    }
  }

  return summary;
}

function estimateArmOcclusionRisk(target) {
  if (target.implausible) {
    return { active: true, reason: target.plausibilityReason ?? "implausible" };
  }

  const trackingConfidence = Number.isFinite(Number(target.rawConfidence))
    ? Number(target.rawConfidence)
    : Number(target.confidence ?? 0);
  const lowConfidence = trackingConfidence < TARGET_RELIABLE_CONFIDENCE;
  if (lowConfidence) {
    return { active: true, reason: "low_confidence" };
  }

  return { active: false, reason: "none" };
}

function buildTorsoBasis(points) {
  const leftShoulder = points?.leftShoulder;
  const rightShoulder = points?.rightShoulder;
  const shoulderMid = points?.shoulderMid;
  const hipMid = points?.hipMid;

  if (!leftShoulder || !rightShoulder || !shoulderMid || !hipMid) {
    return null;
  }

  const left = normalize(subtract(leftShoulder, rightShoulder));
  const up = normalize(subtract(shoulderMid, hipMid));

  if (!left || !up) {
    return null;
  }

  const forward = normalize(cross(up, left));

  if (!forward) {
    return null;
  }

  return { left, up, forward };
}

function directionToTorsoLocal(direction, torsoBasis) {
  return {
    x: round(dot(direction, torsoBasis.left), 6),
    y: round(dot(direction, torsoBasis.up), 6),
    z: round(dot(direction, torsoBasis.forward), 6),
  };
}

function evaluateTargetPlausibility(target, directionTorsoLocal) {
  if (!directionTorsoLocal || target.group !== "arms") {
    return { implausible: false, reason: "ok" };
  }

  const mostlyHorizontal = Math.abs(directionTorsoLocal.y) < 0.35 && Math.abs(directionTorsoLocal.z) < 0.35;

  if (target.bone === "LeftArm" && directionTorsoLocal.x < -0.92 && mostlyHorizontal) {
    return { implausible: true, reason: "implausible_left_upper_arm_cross_body" };
  }

  if (target.bone === "RightArm" && directionTorsoLocal.x > 0.92 && mostlyHorizontal) {
    return { implausible: true, reason: "implausible_right_upper_arm_cross_body" };
  }

  return { implausible: false, reason: "ok" };
}

function buildPosePoints(motionFrame) {
  const landmarks = motionFrame?.poseWorldLandmarks ?? motionFrame?.poseLandmarks ?? [];
  const imageLandmarks = motionFrame?.poseLandmarks ?? [];
  const points = {
    nose: pointFromLandmark(landmarks[POSE.nose]),
    leftEar: pointFromLandmark(landmarks[POSE.leftEar]),
    rightEar: pointFromLandmark(landmarks[POSE.rightEar]),
    leftShoulder: pointFromLandmark(landmarks[POSE.leftShoulder]),
    rightShoulder: pointFromLandmark(landmarks[POSE.rightShoulder]),
    leftElbow: pointFromLandmark(landmarks[POSE.leftElbow]),
    rightElbow: pointFromLandmark(landmarks[POSE.rightElbow]),
    leftWrist: pointFromLandmark(landmarks[POSE.leftWrist]),
    rightWrist: pointFromLandmark(landmarks[POSE.rightWrist]),
    leftHip: pointFromLandmark(landmarks[POSE.leftHip]),
    rightHip: pointFromLandmark(landmarks[POSE.rightHip]),
    leftKnee: pointFromLandmark(landmarks[POSE.leftKnee]),
    rightKnee: pointFromLandmark(landmarks[POSE.rightKnee]),
    leftAnkle: pointFromLandmark(landmarks[POSE.leftAnkle]),
    rightAnkle: pointFromLandmark(landmarks[POSE.rightAnkle]),
    leftHeel: pointFromLandmark(landmarks[POSE.leftHeel]),
    rightHeel: pointFromLandmark(landmarks[POSE.rightHeel]),
    leftFootIndex: pointFromLandmark(landmarks[POSE.leftFootIndex]),
    rightFootIndex: pointFromLandmark(landmarks[POSE.rightFootIndex]),
    imageLeftShoulder: pointFromLandmark(imageLandmarks[POSE.leftShoulder]),
    imageRightShoulder: pointFromLandmark(imageLandmarks[POSE.rightShoulder]),
    imageLeftHip: pointFromLandmark(imageLandmarks[POSE.leftHip]),
    imageRightHip: pointFromLandmark(imageLandmarks[POSE.rightHip]),
  };

  points.shoulderMid = midpoint(points.leftShoulder, points.rightShoulder);
  points.hipMid = midpoint(points.leftHip, points.rightHip);
  points.headAimBase = midpoint(points.leftEar, points.rightEar) ?? points.nose;
  points.headCrown = points.nose
    ? {
        ...points.nose,
        y: points.nose.y + 0.12,
      }
    : null;

  return points;
}

function solveTarget(target, points) {
  const from = points[target.from];
  const to = points[target.to];

  if (!from || !to) {
    return null;
  }

  const direction = normalize(subtract(to, from));

  if (!direction) {
    return null;
  }

  return {
    bone: target.bone,
    group: target.group,
    from: target.from,
    to: target.to,
    hinge: target.hinge ?? null,
    direction,
    length: round(distance(from, to), 6),
    confidence: round(retargetConfidence(from, to), 6),
  };
}

function enrichTargetWithTorsoBasis(target, torsoBasis) {
  if (!torsoBasis || !target.direction) {
    return target;
  }

  const directionTorsoLocal = directionToTorsoLocal(target.direction, torsoBasis);
  const plausibility = evaluateTargetPlausibility(target, directionTorsoLocal);
  const confidence = plausibility.implausible
    ? round(target.confidence * 0.6, 6)
    : target.confidence;

  return {
    ...target,
    directionTorsoLocal,
    rawConfidence: target.confidence,
    confidence,
    implausible: plausibility.implausible,
    plausibilityReason: plausibility.reason,
  };
}

function applyConstrainedTargetDirections(targets, torsoBasis = null) {
  return targets.map((target) => {
    const constrainedDirection = target.constrainedDirection ?? target.direction;
    const constrainedDirectionTorsoLocal = target.constrainedDirection && torsoBasis
      ? directionToTorsoLocal(constrainedDirection, torsoBasis)
      : target.directionTorsoLocal;
    return {
      ...target,
      rawDirection: target.rawDirection ?? target.direction,
      rawDirectionTorsoLocal: target.rawDirectionTorsoLocal ?? target.directionTorsoLocal,
      direction: constrainedDirection,
      constrainedDirection,
      directionTorsoLocal: constrainedDirectionTorsoLocal,
    };
  });
}

function summarizeTargetAnatomy(targets) {
  const anatomyRows = targets
    .map((target) => target.anatomy)
    .filter(Boolean);

  return {
    constrainedTargets: anatomyRows.length,
    hardViolations: anatomyRows.filter((item) => item.hardViolation).length,
    softViolations: anatomyRows.filter((item) => item.softViolation).length,
  };
}

function evaluatePoseAnatomy(points, rawTargets, previousAnatomyState = createAnatomyState(), options = {}) {
  const diagnostics = {};
  const lowerBody = evaluateLowerBodyReliability({
    points,
    previous: previousAnatomyState,
    timestamp: options.timestamp,
  });

  for (const target of rawTargets) {
    const constraint = ANATOMICAL_CONSTRAINTS[target.bone];
    if (!constraint) {
      continue;
    }

    if ((constraint.group === "legs" || constraint.group === "feet") && !lowerBody.reliable) {
      continue;
    }

    if (constraint.kind === "hinge") {
      const hinge = HINGES.find((item) => item.name === constraint.joint);
      const hingeConfidence = hinge
        ? retargetConfidence(points[hinge.parent], points[hinge.joint], points[hinge.child])
        : 0;

      if (hingeConfidence < HINGE_RELIABLE_CONFIDENCE) {
        continue;
      }

      const result = hinge ? evaluateHingeFlexion({
        name: hinge.name,
        parent: points[hinge.parent],
        joint: points[hinge.joint],
        child: points[hinge.child],
        minFlexDeg: constraint.minFlexDeg,
        softMaxFlexDeg: constraint.softMaxFlexDeg,
        maxFlexDeg: constraint.maxFlexDeg,
      }) : null;

      if (result?.hardViolation || result?.softViolation) {
        diagnostics[target.bone] = {
          kind: constraint.kind,
          joint: constraint.joint,
          reason: "hinge_flexion_limit",
          confidenceScale: result.confidenceScale,
          constrainedDirection: result.clampedFlexDeg !== result.flexDeg
            ? constrainHingeChildDirection({
                parent: points[hinge.parent],
                joint: points[hinge.joint],
                child: points[hinge.child],
                clampedFlexDeg: result.clampedFlexDeg,
              })
            : null,
          hardViolation: result.hardViolation,
          softViolation: result.softViolation,
          flexDeg: result.flexDeg,
          clampedFlexDeg: result.clampedFlexDeg,
        };
      }
      continue;
    }

    if (constraint.kind === "swing-cone") {
      const result = evaluateTargetCone({
        bone: target.bone,
        directionTorsoLocal: target.directionTorsoLocal,
        constraint,
      });

      if (result.violation) {
        diagnostics[target.bone] = {
          kind: constraint.kind,
          reason: result.reason,
          confidenceScale: result.confidenceScale,
          hardViolation: false,
          softViolation: true,
        };
      }
    }
  }

  return {
    targets: diagnostics,
    lowerBody,
    hardViolations: Object.values(diagnostics).filter((item) => item.hardViolation).length,
    softViolations: Object.values(diagnostics).filter((item) => item.softViolation).length,
    state: {
      targets: Object.fromEntries(rawTargets.map((target) => [target.bone, {
        direction: diagnostics[target.bone]?.constrainedDirection ?? target.direction,
        timestamp: options.timestamp,
      }])),
      lowerBody,
    },
  };
}

function solveHinges(points) {
  return HINGES.map((hinge) => solveHinge(hinge, points));
}

function solveHinge(hinge, points) {
  const parent = points[hinge.parent];
  const joint = points[hinge.joint];
  const child = points[hinge.child];
  const confidence = round(retargetConfidence(parent, joint, child), 6);
  const base = {
    name: hinge.name,
    group: hinge.group,
    parent: hinge.parent,
    joint: hinge.joint,
    child: hinge.child,
    minFlexDeg: hinge.minFlexDeg,
    maxFlexDeg: hinge.maxFlexDeg,
    angleModel: "unsigned_3point_inner_angle",
    signedFlexionSupported: false,
    confidence,
    violation: false,
    limitWarning: false,
    reason: "ok",
  };

  if (!parent || !joint || !child) {
    return {
      ...base,
      flexDeg: null,
      innerAngleDeg: null,
      confidence: 0,
      reason: "missing",
    };
  }

  const parentVector = subtract(parent, joint);
  const childVector = subtract(child, joint);
  const parentLength = magnitude(parentVector);
  const childLength = magnitude(childVector);

  if (parentLength < MIN_DIRECTION_LENGTH || childLength < MIN_DIRECTION_LENGTH) {
    return {
      ...base,
      flexDeg: null,
      innerAngleDeg: null,
      reason: "degenerate",
    };
  }

  const dot = parentVector.x * childVector.x +
    parentVector.y * childVector.y +
    parentVector.z * childVector.z;
  const innerAngleDeg = radToDeg(Math.acos(clamp(dot / (parentLength * childLength), -1, 1)));
  const flexDeg = 180 - innerAngleDeg;
  const reliable = confidence >= HINGE_RELIABLE_CONFIDENCE;
  const violation = reliable && flexDeg < hinge.minFlexDeg - HINGE_LIMIT_EPSILON_DEG;
  const limitWarning = reliable && !violation && flexDeg > hinge.maxFlexDeg + HINGE_LIMIT_EPSILON_DEG;

  return {
    ...base,
    flexDeg: round(flexDeg, 3),
    innerAngleDeg: round(innerAngleDeg, 3),
    violation,
    limitWarning,
    reason: reliable ? (violation ? "hinge_min_limit" : limitWarning ? "limit_warning" : "ok") : "low_confidence",
  };
}

function estimateTrackingMode(points) {
  const shoulderConfidence = averageVisibility(points.leftShoulder, points.rightShoulder);
  const hipConfidence = averageVisibility(points.leftHip, points.rightHip);

  if (shoulderConfidence < LOW_CONFIDENCE_VISIBILITY) {
    return "lost";
  }

  if (hipConfidence < LOW_CONFIDENCE_VISIBILITY) {
    return "upper-body";
  }

  return "full-body";
}

function estimateFacing(points, fallback = "front") {
  return toLegacyFacing(estimateFacingState(points, fallback, {
    lowConfidence: LOW_CONFIDENCE_VISIBILITY,
  }).state);
}

function retargetConfidence(...points) {
  const visibilities = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  if (visibilities.length === 0) {
    return 1;
  }

  const visibility = Math.min(...visibilities);

  if (visibility >= FULL_CONFIDENCE_VISIBILITY) {
    return 1;
  }

  return Math.max(0, Math.min(
    1,
    (visibility - LOW_CONFIDENCE_VISIBILITY) /
      (FULL_CONFIDENCE_VISIBILITY - LOW_CONFIDENCE_VISIBILITY),
  ));
}

function pointFromLandmark(landmark) {
  if (
    !landmark ||
    !Number.isFinite(landmark.x) ||
    !Number.isFinite(landmark.y) ||
    !Number.isFinite(landmark.z)
  ) {
    return null;
  }

  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: Number.isFinite(landmark.visibility) ? landmark.visibility : 1,
  };
}

function midpoint(a, b) {
  if (!a || !b) {
    return null;
  }

  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function averageVisibility(...points) {
  const values = points
    .map((point) => point?.visibility)
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length < MIN_DIRECTION_LENGTH) {
    return null;
  }

  return {
    x: round(vector.x / length, 6),
    y: round(vector.y / length, 6),
    z: round(vector.z / length, 6),
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function directionAngleDeg(a, b) {
  if (!a || !b) {
    return 0;
  }

  const aLength = magnitude(a);
  const bLength = magnitude(b);

  if (aLength < MIN_DIRECTION_LENGTH || bLength < MIN_DIRECTION_LENGTH) {
    return 0;
  }

  return radToDeg(Math.acos(clamp(dot(a, b) / (aLength * bLength), -1, 1)));
}

function blendDirections(from, to, amount) {
  const blend = clamp(Number(amount), 0, 1);
  const direction = normalize({
    x: from.x + (to.x - from.x) * blend,
    y: from.y + (to.y - from.y) * blend,
    z: from.z + (to.z - from.z) * blend,
  });

  return direction ?? to;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function radToDeg(rad) {
  return (rad / Math.PI) * 180;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
