#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  LANDMARK_INDEX,
  MEDIAPIPE_POSE_LANDMARK_COUNT,
  createSyntheticMotionFrame,
  createSyntheticSequence,
} from "../scripts/generate-synthetic-landmarks.mjs";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const identity = createSyntheticSequence({ scenario: "identity", frames: 3 });
assert.equal(identity.frames.length, 3);

for (const frame of identity.frames) {
  assert.equal(frame.poseLandmarks.length, MEDIAPIPE_POSE_LANDMARK_COUNT);
  assert.equal(frame.poseWorldLandmarks.length, MEDIAPIPE_POSE_LANDMARK_COUNT);
  assert.equal(frame.expected.facing, "front");
  assert.equal(frame.expected.mode, "full-body");
  assert.ok(frame.poseLandmarks.every((landmark) => Number.isFinite(landmark.x)));
  const solved = solvePoseFrame(frame);
  assert.equal(solved.meta.mode, "full-body");
  assert.equal(solved.meta.facing, "front");
  assert.equal(solved.meta.facingYawFlipCount, 0);
  assert.equal(solved.meta.facingSideOrderFlip, false);
  assert.equal(Math.abs(solved.meta.facingSideOrderSign), 1);
  assert.equal(solved.meta.implausibleTargets, 0);
  assert.equal(solved.meta.implausibleRatio, 0);
  assert.ok(Number.isFinite(solved.meta.facingUnwrappedYawDeg));
  assert.ok(solved.meta.targetCount >= 16);
  assert.equal(solved.meta.hingeViolations, 0);
  assert.equal(solved.meta.hingeLimitWarnings, 0);
  assert.equal(solved.hinges.length, 4);
  const leftArmTarget = solved.targets.find((target) => target.bone === "LeftArm");
  assert.ok(leftArmTarget?.directionTorsoLocal, "solver should expose torso-local target directions");
  assert.equal(leftArmTarget.implausible, false);
}

const neutralHeadFrame = createSyntheticMotionFrame({ scenario: "identity" });
const neutralHeadDirection = findTarget(solvePoseFrame(neutralHeadFrame), "Head").direction;
const yawHeadFrame = cloneMotionFrame(neutralHeadFrame);
yawHeadFrame.poseWorldLandmarks[LANDMARK_INDEX.nose].x += 0.16;
const pitchHeadFrame = cloneMotionFrame(neutralHeadFrame);
pitchHeadFrame.poseWorldLandmarks[LANDMARK_INDEX.nose].y += 0.16;
assert.ok(
  directionAngleDeg(neutralHeadDirection, findTarget(solvePoseFrame(yawHeadFrame), "Head").direction) > 20,
  "head target direction should respond to nose yaw offset",
);
assert.ok(
  directionAngleDeg(neutralHeadDirection, findTarget(solvePoseFrame(pitchHeadFrame), "Head").direction) > 5,
  "head target direction should respond to nose pitch offset",
);

const leftElbowFlex = createSyntheticSequence({ scenario: "left-elbow-flex", frames: 5 });
const firstFlex = leftElbowFlex.frames[0];
const lastFlex = leftElbowFlex.frames.at(-1);
assert.ok(
  lastFlex.expected.joints.leftElbow.flexDeg > firstFlex.expected.joints.leftElbow.flexDeg,
  "left-elbow-flex should increase expected elbow flexion",
);
assert.ok(
  elbowFlexionDeg(lastFlex) > elbowFlexionDeg(firstFlex),
  "left-elbow-flex should bend the generated landmark chain",
);
const solvedFlexFrames = leftElbowFlex.frames.map((frame) => solvePoseFrame(frame));
const firstSolvedFlex = findHinge(solvedFlexFrames[0], "leftElbow");
const lastSolvedFlex = findHinge(solvedFlexFrames.at(-1), "leftElbow");
assert.ok(
  lastSolvedFlex.flexDeg > firstSolvedFlex.flexDeg,
  "left-elbow-flex solver output should increase elbow flexion",
);
const maxLeftElbowMae = Math.max(...leftElbowFlex.frames.map((frame, index) => {
  const solvedFlex = findHinge(solvedFlexFrames[index], "leftElbow");
  return Math.abs(solvedFlex.flexDeg - frame.expected.joints.leftElbow.flexDeg);
}));
assert.ok(
  maxLeftElbowMae <= 0.5,
  `left-elbow-flex solver MAE should stay <= 0.5deg, got ${maxLeftElbowMae.toFixed(3)}deg`,
);
assert.equal(
  Math.max(...solvedFlexFrames.map((solved) => solved.meta.hingeViolations)),
  0,
  "left-elbow-flex should not violate hinge limits",
);
assert.equal(
  Math.max(...solvedFlexFrames.map((solved) => solved.meta.hingeLimitWarnings)),
  0,
  "left-elbow-flex should not exceed soft hinge warning limits",
);

const turn = createSyntheticSequence({ scenario: "turn-180", frames: 5 });
assert.equal(turn.frames[0].expected.facing, "front");
assert.equal(turn.frames.at(-1).expected.facing, "back");
assert.equal(turn.frames.at(-1).expected.yawDeg, 180);
assert.equal(solvePoseFrame(turn.frames.at(-1)).meta.facing, "back");
const turnFacingStates = solveSequence(turn.frames).map((solved) => solved.meta.facing);
assert.deepEqual(
  turnFacingStates,
  ["front", "front", "front", "front", "back"],
  "turn-180 should keep facing stable until the rear-facing transition",
);
const solvedTurnFrames = solveSequence(turn.frames);
assert.ok(Math.abs(Math.abs(solvedTurnFrames.at(-1).meta.facingUnwrappedYawDeg) - 180) <= 0.001);
assert.equal(Math.max(...solvedTurnFrames.map((solved) => solved.meta.facingYawFlipCount)), 0);
assert.equal(
  countStateChatter(turnFacingStates),
  0,
  "turn-180 should not chatter between facing states",
);

const upperBody = createSyntheticMotionFrame({ scenario: "upper-body" });
assert.equal(upperBody.expected.mode, "upper-body");
const upperBodySolved = solvePoseFrame(upperBody);
assert.equal(upperBodySolved.meta.mode, "upper-body");
assert.equal(upperBodySolved.meta.hingeViolations, 0);
assert.equal(findHinge(upperBodySolved, "leftKnee").reason, "low_confidence");
assert.equal(findHinge(upperBodySolved, "rightKnee").reason, "low_confidence");
assert.ok(
  upperBody.poseLandmarks[LANDMARK_INDEX.leftHip].visibility < 0.5,
  "upper-body fixture should mark hips low-confidence",
);
assert.ok(
  upperBody.poseLandmarks[LANDMARK_INDEX.leftShoulder].visibility > 0.8,
  "upper-body fixture should keep shoulders reliable",
);

const occluded = createSyntheticMotionFrame({
  scenario: "left-wrist-occlusion",
  progress: 1,
});
assert.equal(occluded.expected.joints.leftElbow.occluded, true);
assert.ok(
  occluded.poseLandmarks[LANDMARK_INDEX.leftWrist].visibility < 0.5,
  "left-wrist-occlusion should lower wrist visibility",
);
assert.ok(
  occluded.poseLandmarks[LANDMARK_INDEX.leftElbow].visibility > 0.8,
  "left-wrist-occlusion should keep elbow visible",
);
const occludedSolved = solvePoseFrame(occluded);
const leftForeArm = occludedSolved.targets.find((target) => target.bone === "LeftForeArm");
assert.ok(leftForeArm);
assert.ok(leftForeArm.confidence < 0.5);
const leftOccludedHinge = findHinge(occludedSolved, "leftElbow");
assert.ok(leftOccludedHinge.confidence < 0.5);
assert.equal(leftOccludedHinge.violation, false);
assert.equal(leftOccludedHinge.reason, "low_confidence");
const occlusionSequence = createSyntheticSequence({ scenario: "left-wrist-occlusion", frames: 9 });
const solvedOcclusionSequence = solveSequence(occlusionSequence.frames);
const occlusionReliableSpikes = countReliableTargetSpikes(solvedOcclusionSequence, 180);
assert.equal(
  occlusionReliableSpikes,
  0,
  "left-wrist-occlusion should not emit reliable target spikes while wrist visibility is low",
);
const leftForeArmOcclusionStates = solvedOcclusionSequence
  .map((solved) => solved.targets.find((target) => target.bone === "LeftForeArm")?.occlusionState)
  .filter(Boolean);
assert.ok(
  leftForeArmOcclusionStates.includes("hold"),
  `left-wrist-occlusion should hold the previous left forearm direction, got ${leftForeArmOcclusionStates.join(",")}`,
);
assert.ok(
  Math.max(...solvedOcclusionSequence.map((solved) => solved.meta.occlusionActiveTargets)) > 0,
  "left-wrist-occlusion should expose active occlusion target counts",
);
const rawOcclusionSolved = solveSequence(occlusionSequence.frames, { targetStabilization: false });
assert.ok(
  rawOcclusionSolved.every((solved) =>
    solved.targets.every((target) => target.occlusionState === undefined)
  ),
  "targetStabilization=false should leave target rows raw for offline references",
);

const lostAndReacquired = createSyntheticSequence({ scenario: "lost-and-reacquired", frames: 9 });
const solvedLostAndReacquired = solveSequence(lostAndReacquired.frames);
const lostModes = solvedLostAndReacquired.map((solved) => solved.meta.mode);
assert.deepEqual(
  lostModes,
  ["full-body", "full-body", "full-body", "lost", "lost", "lost", "full-body", "full-body", "full-body"],
  "lost-and-reacquired should mark the hidden middle span as lost and recover to full-body",
);
assert.equal(
  countStateChatter(lostModes),
  0,
  "lost-and-reacquired should not chatter between full-body and lost modes",
);
assert.equal(
  Math.max(...solvedLostAndReacquired.map((solved) => solved.meta.hingeViolations)),
  0,
  "lost-and-reacquired should not emit unsigned hinge min-limit diagnostics while hidden",
);
assert.equal(lostAndReacquired.frames[3].expected.lostTracking, true);
assert.equal(lostAndReacquired.frames.at(-1).expected.mode, "full-body");

console.log("Solver synthetic fixture check passed.");

function solveSequence(frames, options = {}) {
  let previousState = {};

  return frames.map((frame) => {
    const solved = solvePoseFrame(frame, previousState, options);
    previousState = solved.state;
    return solved;
  });
}

function findHinge(solved, name) {
  const hinge = solved.hinges.find((candidate) => candidate.name === name);
  assert.ok(hinge, `Expected hinge ${name}`);
  return hinge;
}

function findTarget(solved, bone) {
  const target = solved.targets.find((candidate) => candidate.bone === bone);
  assert.ok(target, `Expected target ${bone}`);
  return target;
}

function cloneMotionFrame(frame) {
  return JSON.parse(JSON.stringify(frame));
}

function elbowFlexionDeg(frame) {
  const shoulder = frame.poseWorldLandmarks[LANDMARK_INDEX.leftShoulder];
  const elbow = frame.poseWorldLandmarks[LANDMARK_INDEX.leftElbow];
  const wrist = frame.poseWorldLandmarks[LANDMARK_INDEX.leftWrist];
  const upper = subtract(shoulder, elbow);
  const lower = subtract(wrist, elbow);
  const dot = upper.x * lower.x + upper.y * lower.y + upper.z * lower.z;
  const mag = magnitude(upper) * magnitude(lower);

  const innerAngleDeg = (Math.acos(Math.max(-1, Math.min(1, dot / mag))) / Math.PI) * 180;
  return 180 - innerAngleDeg;
}

function countReliableTargetSpikes(solvedFrames, thresholdDegPerSec) {
  let spikes = 0;

  for (let index = 1; index < solvedFrames.length; index += 1) {
    const previous = solvedFrames[index - 1];
    const current = solvedFrames[index];
    const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;

    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
      continue;
    }

    const previousTargets = new Map(previous.targets.map((target) => [target.bone, target]));

    for (const target of current.targets) {
      const previousTarget = previousTargets.get(target.bone);

      if (!previousTarget || previousTarget.confidence < 0.5 || target.confidence < 0.5) {
        continue;
      }

      const velocity = directionAngleDeg(previousTarget.direction, target.direction) / elapsedSeconds;

      if (velocity > thresholdDegPerSec) {
        spikes += 1;
      }
    }
  }

  return spikes;
}

function countStateChatter(states) {
  let chatter = 0;
  let index = 0;

  while (index < states.length) {
    const state = states[index];
    let end = index + 1;

    while (end < states.length && states[end] === state) {
      end += 1;
    }

    const previous = index > 0 ? states[index - 1] : null;
    const next = end < states.length ? states[end] : null;

    if (previous && next && previous === next && previous !== state && end - index <= 1) {
      chatter += 1;
    }

    index = end;
  }

  return chatter;
}

function directionAngleDeg(a, b) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const mag = magnitude(a) * magnitude(b);

  if (mag <= 0) {
    return 0;
  }

  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) / Math.PI) * 180;
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}
