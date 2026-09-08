# Anatomical Joint Constraints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-on anatomical constraint layer so tracked avatars cannot follow impossible elbow, knee, shoulder, hip, ankle, wrist, finger, neck, or spine rotations even when the input skeleton is noisy.

**Architecture:** Keep tracking extraction separate from anatomical correction. `pose-solver` should compute raw landmark targets plus anatomy diagnostics, then emit constrained target directions and confidence scaling. `avatar-renderer` should consume constrained directions in both strict and legacy retarget paths, keep a comparison path for debugging, and expose clamp/hold/blend diagnostics in reports.

**Tech Stack:** Browser JavaScript, Three.js quaternions/vectors, VRM humanoid bones, MediaPipe-style pose/hand landmarks, current Node smoke tests under `tests/*.mjs`, current browser validation script `scripts/avatar-motion-agreement-check.mjs`.

---

## Investigation Summary

### External references used

- ISB lower-body/spine coordinate recommendations: https://www.sciencedirect.com/science/article/abs/pii/S0021929001002226
- ISB upper-limb coordinate recommendations: https://media.isbweb.org/images/documents/standards/Wu%20et%20al%20J%20Biomech%2038%20%282005%29%20981%E2%80%93992.pdf
- CDC normal joint ROM study and public tables: https://archive.cdc.gov/www_cdc_gov/ncbddd/jointrom/index.html
- CDC ROM measurement protocol: https://stacks.cdc.gov/view/cdc/153156/cdc_153156_DS1.pdf
- VRM humanoid bone spec: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
- VRM motion standardization notes: https://vrm.dev/en/vrm/vrm_features/
- Thumb/finger ROM references for hand-specific guardrails: https://pmc.ncbi.nlm.nih.gov/articles/PMC3653006/ and https://pmc.ncbi.nlm.nih.gov/articles/PMC11436331/

### Current code facts

- `src/solver/pose-solver.js` maps pose landmarks into direct bone targets. `BODY_TARGETS` includes torso, head, arms, legs, and feet.
- `src/solver/pose-solver.js` already computes `HINGES` for elbows and knees, but the hinge result is diagnostic. It does not clamp the emitted target direction.
- `src/retarget/skeleton-fk-retarget.js` currently builds strict frame bone rotations with `quaternionFromUnitVectors(restAxis, sourceDirection)`. That accepts any source direction that can be normalized.
- `src/avatar-renderer.js` applies `maxAngle` and some `maxTwist`, but strict mode disables most body `maxAngle` limits and only uses head/neck profile limits. This makes strict mode high-fidelity but weak as an anatomical safety layer.
- `src/hand-retargeting.js` resolves finger segment points, but finger joints are retargeted as independent aim directions. There is no MCP/PIP/DIP curl cascade or abduction/twist guard.
- The existing reliable validation surfaces are `npm run check`, `git diff --check`, `tests/strict-retarget-check.mjs`, `tests/solver-synthetic-check.mjs`, and `scripts/avatar-motion-agreement-check.mjs --measurement-only`.

### Anatomical elements to model

Use these as runtime guardrails, not clinical impairment thresholds. Keep limits configurable and conservative because avatar rest poses, VRM0/VRM1 mapping, Mixamo axes, camera perspective, and tracker noise differ from clinical goniometry.

| Body area | Joint model | Initial guardrail |
| --- | --- | --- |
| Neck/head | distributed yaw/pitch/roll | Split head and neck. Limit head local pitch/yaw/roll, then blend residual into neck. Reject sudden >600 deg/sec jumps as already done for face head pose. |
| Spine/chest | distributed bend/twist | Limit per-bone spine bend and twist. Avoid a single spine bone absorbing the full torso error. |
| Clavicle/shoulder girdle | limited elevation/protraction | Keep shoulder bone rotation low. Do not let shoulder bone point backward or down through torso. |
| Glenohumeral shoulder | ball-and-socket swing cone plus twist | Use torso-local cone for upper arm: flexion/elevation, abduction, extension, horizontal adduction, axial twist. Clamp impossible cross-body or behind-back directions softly. |
| Elbow | hinge with small hyperextension and small varus/valgus tolerance | Flexion roughly -5 to 150 deg for runtime; lateral bend beyond 12 to 18 deg reduces confidence or clamps toward previous valid plane. |
| Forearm | pronation/supination twist | Use hand/palm normal where available. Limit twist around forearm axis, do not use elbow hinge to represent pronation. |
| Wrist | biaxial flex/extension and radial/ulnar deviation | Limit hand aim and palm twist. Hold if palm normal flips while wrist landmarks are low confidence. |
| Fingers | MCP/PIP/DIP hinge cascade | MCP can flex and abduct; PIP/DIP are mostly hinge. Enforce curl ordering so distal bones do not bend opposite to proximal chain. |
| Thumb | CMC saddle plus MCP/IP hinges | Thumb metacarpal allows abduction/opposition; MCP/IP are mostly hinge. Keep thumb axial rotation coupled with opposition rather than arbitrary twist. |
| Pelvis/hips | root yaw plus hip swing cone | Root owns global facing. Upper legs use hip local cone for flexion, extension, abduction/adduction, and limited twist. |
| Knee | hinge with tiny hyperextension and tiny twist | Flexion roughly -5 to 145 deg for runtime. Reject side bending and twist; use previous valid lower-leg direction or neutral stance. |
| Ankle/foot | dorsiflexion/plantarflexion plus limited inversion/eversion | Limit foot pitch and roll. Avoid feet flipping backward when heel/toe landmarks are noisy. |
| Foot grounding | contact stability | If both ankles/feet are stable, keep foot roll and pelvis height smooth. If lower-body unreliable in upper-body clips, hold or neutral-blend legs. |
| Symmetry/length | kinematic plausibility | Track bone length CV, left/right segment ratios, sudden joint velocity, and crossing tests. Use these as confidence gates before retarget. |

### Initial runtime limit table

These are first-pass animation safety limits, not medical claims. They should be stored in code as soft/hard ranges and tuned with validation videos.

| Joint/bone | Soft range | Hard range | Violation action |
| --- | --- | --- | --- |
| Head | pitch -35..45, yaw -60..60, roll -30..30 deg | pitch -50..60, yaw -75..75, roll -45..45 deg | clamp and smooth |
| Neck | pitch -20..25, yaw -35..35, roll -20..20 deg | pitch -35..40, yaw -50..50, roll -30..30 deg | clamp and blend residual to head |
| Spine each | bend <= 20 deg, twist <= 18 deg | bend <= 35 deg, twist <= 30 deg | distribute over spine chain |
| Upper arm | elevation <= 170, extension <= 55, cross-body <= 65 deg | any rest delta <= 155 deg plus cone gate | cone clamp, confidence scale |
| Forearm/elbow | flexion 0..145 deg | -5..155 deg | hinge clamp, lateral violation hold |
| Hand/wrist | flex/ext -70..75, radial/ulnar -25..35 deg | rest delta <= 95 deg, twist <= 80 deg | clamp or hold on palm flip |
| Finger MCP | flex 0..90, abduct <= 30 deg | flex -10..105, abduct <= 40 deg | clamp curl/spread |
| Finger PIP | flex 0..105 deg | flex -5..115 deg | clamp curl |
| Finger DIP | flex 0..85 deg | flex -5..95 deg | clamp curl |
| Thumb CMC | abduct <= 65, opposition twist <= 60 deg | rest delta <= 90 deg | coupled clamp |
| Thumb MCP | flex 0..60 deg | flex -10..70 deg | clamp curl |
| Thumb IP | flex 0..85 deg | flex -10..95 deg | clamp curl |
| Upper leg/hip | flex 0..130, extension <= 25, abduct <= 50, adduct <= 35 deg | rest delta <= 135, twist <= 45 deg | cone clamp, lower-body hold if unstable |
| Lower leg/knee | flex 0..140 deg | -5..155 deg | hinge clamp, lateral violation hold |
| Foot/ankle | dorsiflex <= 20, plantar <= 60, invert <= 35, evert <= 25 deg | rest delta <= 80, twist <= 40 deg | clamp or neutral foot |

---

## File Structure

- Create `src/retarget/anatomical-constraints.js`
  - Pure vector/quaternion-free constraint catalog and landmark-space evaluators.
  - Exports `ANATOMICAL_CONSTRAINTS`, `FINGER_CONSTRAINTS`, `createAnatomyState`, `evaluateHingeFlexion`, `evaluateLowerBodyReliability`, `evaluateTargetCone`, `constrainPoseTargets`, and helper functions used by tests.
- Modify `src/solver/pose-solver.js`
  - Import the new module.
  - Evaluate anatomy after raw targets are built and before target stabilization.
  - Add `anatomy` diagnostics and constrained target directions into solver output.
- Modify `src/retarget/skeleton-fk-retarget.js`
  - Prefer `target.constrainedDirection` over `target.direction`.
  - Include safety diagnostics in strict retarget frames.
- Modify `src/avatar-renderer.js`
  - Consume constrained directions in strict and legacy paths.
  - Keep strict mode default-on with anatomical limits.
  - Add opt-out query option for comparison only: `?anatomy-constraints=off`.
  - Forward anatomical diagnostics into motion reports.
- Modify `src/hand-retargeting.js`
  - Add finger segment metadata so thumb/MCP/PIP/DIP constraints can be applied consistently.
- Modify `tests/solver-synthetic-check.mjs`
  - Assert impossible elbow/knee frames are flagged and constrained.
- Modify `tests/strict-retarget-check.mjs`
  - Assert strict frames use constrained directions and report clamp diagnostics.
- Create `tests/anatomical-constraints-check.mjs`
  - Unit tests for hinge, cone, twist, velocity, and lower-body reliability.
- Modify `package.json`
  - Add `node tests/anatomical-constraints-check.mjs` into `npm run check`.
- Create `scripts/anatomy-constraint-smoke.mjs`
  - Measurement-only smoke script for saved recordings/videos. It should summarize clamp rates, joint violation rates, knee p90, elbow p90, and hard-limit violations.
- Modify `scripts/avatar-motion-agreement-check.mjs`
  - Include anatomy diagnostics in generated JSON report and warnings.
- Create `docs/anatomical-constraints.md`
  - Document the limits, source references, and how to tune them.

---

## Checkpoint 1: Pure Anatomy Constraint Module

**Files:**
- Create: `src/retarget/anatomical-constraints.js`
- Create: `tests/anatomical-constraints-check.mjs`
- Modify: `package.json`

- [ ] **Step 1: Add failing unit tests for hinge and cone guardrails**

Create `tests/anatomical-constraints-check.mjs` with these initial tests:

```js
#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  ANATOMICAL_CONSTRAINTS,
  clampDegrees,
  constrainHingeChildDirection,
  constrainFlexionDeg,
  createAnatomyState,
  evaluateHingeFlexion,
  evaluateLowerBodyReliability,
  evaluateTargetCone,
} from "../src/retarget/anatomical-constraints.js";

assert.equal(ANATOMICAL_CONSTRAINTS.LeftForeArm.kind, "hinge");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftLeg.kind, "hinge");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftArm.kind, "swing-cone");
assert.equal(ANATOMICAL_CONSTRAINTS.LeftUpLeg.kind, "swing-cone");

assert.equal(clampDegrees(170, -5, 155), 155);
assert.equal(clampDegrees(-20, -5, 155), -5);
assert.equal(clampDegrees(90, -5, 155), 90);

const elbow = evaluateHingeFlexion({
  name: "leftElbow",
  parent: v(0, 0, 0),
  joint: v(1, 0, 0),
  child: v(1, -1, 0),
  minFlexDeg: -5,
  softMaxFlexDeg: 145,
  maxFlexDeg: 155,
});
assert.ok(elbow.flexDeg > 80 && elbow.flexDeg < 100);
assert.equal(elbow.hardViolation, false);

const impossibleKnee = constrainFlexionDeg({
  flexDeg: 178,
  minFlexDeg: -5,
  softMaxFlexDeg: 140,
  maxFlexDeg: 155,
});
assert.equal(impossibleKnee.clampedFlexDeg, 155);
assert.equal(impossibleKnee.hardViolation, true);
assert.equal(impossibleKnee.confidenceScale < 1, true);

const clampedKneeDirection = constrainHingeChildDirection({
  parent: v(0, 1, 0),
  joint: v(0, 0, 0),
  child: v(0, 1, 0.05),
  clampedFlexDeg: 155,
});
assert.ok(clampedKneeDirection);
assert.equal(round(clampedKneeDirection.y) < 1, true);

const shoulderCone = evaluateTargetCone({
  bone: "LeftArm",
  directionTorsoLocal: { x: -0.98, y: 0.02, z: 0.02 },
  constraint: ANATOMICAL_CONSTRAINTS.LeftArm,
});
assert.equal(shoulderCone.violation, true);
assert.equal(shoulderCone.reason, "cross_body_limit");

const lowerReliable = evaluateLowerBodyReliability({
  points: {
    leftHip: p(0.4, 0.6, 0, 0.99),
    rightHip: p(0.6, 0.6, 0, 0.99),
    leftKnee: p(0.42, 0.35, 0, 0.98),
    rightKnee: p(0.58, 0.35, 0, 0.98),
    leftAnkle: p(0.43, 0.1, 0, 0.98),
    rightAnkle: p(0.57, 0.1, 0, 0.98),
  },
  previous: createAnatomyState(),
  timestamp: 1000,
});
assert.equal(lowerReliable.reliable, true);

console.log("Anatomical constraints check passed.");

function v(x, y, z) {
  return { x, y, z };
}

function p(x, y, z, visibility) {
  return { x, y, z, visibility, presence: visibility };
}

function round(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node tests/anatomical-constraints-check.mjs
```

Expected:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module ... src/retarget/anatomical-constraints.js
```

- [ ] **Step 3: Implement the pure module**

Create `src/retarget/anatomical-constraints.js` with:

```js
const EPSILON = 0.000001;

export const ANATOMICAL_CONSTRAINTS = Object.freeze({
  Hips: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 35, maxTwistDeg: 30 }),
  Spine: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 28, maxTwistDeg: 24 }),
  Spine1: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 24, maxTwistDeg: 22 }),
  Spine2: Object.freeze({ kind: "distributed", group: "torso", maxSwingDeg: 24, maxTwistDeg: 22 }),
  Neck: Object.freeze({ kind: "head-neck", group: "head", pitch: [-35, 40], yaw: [-50, 50], roll: [-30, 30] }),
  Head: Object.freeze({ kind: "head-neck", group: "head", pitch: [-50, 60], yaw: [-75, 75], roll: [-45, 45] }),
  LeftShoulder: Object.freeze({ kind: "shoulder-girdle", group: "shoulder", maxSwingDeg: 32, maxTwistDeg: 25 }),
  RightShoulder: Object.freeze({ kind: "shoulder-girdle", group: "shoulder", maxSwingDeg: 32, maxTwistDeg: 25 }),
  LeftArm: Object.freeze({ kind: "swing-cone", group: "arms", side: "left", maxRestSwingDeg: 155, maxTwistDeg: 80, crossBodyLimit: -0.92 }),
  RightArm: Object.freeze({ kind: "swing-cone", group: "arms", side: "right", maxRestSwingDeg: 155, maxTwistDeg: 80, crossBodyLimit: 0.92 }),
  LeftForeArm: Object.freeze({ kind: "hinge", group: "arms", joint: "leftElbow", minFlexDeg: -5, softMaxFlexDeg: 145, maxFlexDeg: 155, lateralToleranceDeg: 18, maxTwistDeg: 70 }),
  RightForeArm: Object.freeze({ kind: "hinge", group: "arms", joint: "rightElbow", minFlexDeg: -5, softMaxFlexDeg: 145, maxFlexDeg: 155, lateralToleranceDeg: 18, maxTwistDeg: 70 }),
  LeftHand: Object.freeze({ kind: "wrist", group: "hands", side: "left", maxSwingDeg: 95, maxTwistDeg: 80 }),
  RightHand: Object.freeze({ kind: "wrist", group: "hands", side: "right", maxSwingDeg: 95, maxTwistDeg: 80 }),
  LeftUpLeg: Object.freeze({ kind: "swing-cone", group: "legs", side: "left", maxRestSwingDeg: 135, maxTwistDeg: 45, adductionLimit: -0.82 }),
  RightUpLeg: Object.freeze({ kind: "swing-cone", group: "legs", side: "right", maxRestSwingDeg: 135, maxTwistDeg: 45, adductionLimit: 0.82 }),
  LeftLeg: Object.freeze({ kind: "hinge", group: "legs", joint: "leftKnee", minFlexDeg: -5, softMaxFlexDeg: 140, maxFlexDeg: 155, lateralToleranceDeg: 12, maxTwistDeg: 24 }),
  RightLeg: Object.freeze({ kind: "hinge", group: "legs", joint: "rightKnee", minFlexDeg: -5, softMaxFlexDeg: 140, maxFlexDeg: 155, lateralToleranceDeg: 12, maxTwistDeg: 24 }),
  LeftFoot: Object.freeze({ kind: "ankle", group: "feet", side: "left", dorsiflexDeg: 22, plantarFlexDeg: 62, inversionDeg: 35, eversionDeg: 25, maxTwistDeg: 40 }),
  RightFoot: Object.freeze({ kind: "ankle", group: "feet", side: "right", dorsiflexDeg: 22, plantarFlexDeg: 62, inversionDeg: 35, eversionDeg: 25, maxTwistDeg: 40 }),
});

export const FINGER_CONSTRAINTS = Object.freeze({
  Thumb: Object.freeze([
    Object.freeze({ kind: "thumb-cmc", flexDeg: [0, 55], abductDeg: [0, 65], oppositionTwistDeg: 60 }),
    Object.freeze({ kind: "thumb-mcp", flexDeg: [-10, 70], softFlexDeg: [0, 60] }),
    Object.freeze({ kind: "thumb-ip", flexDeg: [-10, 95], softFlexDeg: [0, 85] }),
    Object.freeze({ kind: "thumb-tip", flexDeg: [-10, 95], softFlexDeg: [0, 85] }),
  ]),
  default: Object.freeze([
    Object.freeze({ kind: "mcp", flexDeg: [-10, 105], softFlexDeg: [0, 90], abductDeg: [-40, 40] }),
    Object.freeze({ kind: "pip", flexDeg: [-5, 115], softFlexDeg: [0, 105] }),
    Object.freeze({ kind: "dip", flexDeg: [-5, 95], softFlexDeg: [0, 85] }),
    Object.freeze({ kind: "tip", flexDeg: [-5, 95], softFlexDeg: [0, 85] }),
  ]),
});

export function createAnatomyState() {
  return {
    targets: {},
    lowerBody: {
      reliable: false,
      lastReliableAt: null,
    },
  };
}

export function clampDegrees(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

export function constrainFlexionDeg({ flexDeg, minFlexDeg, softMaxFlexDeg, maxFlexDeg }) {
  const clampedFlexDeg = clampDegrees(flexDeg, minFlexDeg, maxFlexDeg);
  const hardViolation = clampedFlexDeg !== Number(flexDeg);
  const softViolation = Number(flexDeg) > softMaxFlexDeg || Number(flexDeg) < minFlexDeg;
  const overflowDeg = Math.max(0, Number(flexDeg) - softMaxFlexDeg, minFlexDeg - Number(flexDeg));
  return {
    flexDeg: round(flexDeg),
    clampedFlexDeg: round(clampedFlexDeg),
    hardViolation,
    softViolation,
    overflowDeg: round(overflowDeg),
    confidenceScale: hardViolation ? 0.35 : softViolation ? 0.7 : 1,
  };
}

export function constrainHingeChildDirection({ parent, joint, child, clampedFlexDeg }) {
  if (!parent || !joint || !child || !Number.isFinite(Number(clampedFlexDeg))) {
    return null;
  }
  const parentDirection = normalize(subtract(parent, joint));
  const childDirection = normalize(subtract(child, joint));
  if (!parentDirection || !childDirection) {
    return null;
  }
  const rawAxis = normalize(cross(parentDirection, childDirection)) ?? choosePerpendicularAxis(parentDirection);
  const innerAngleRad = degToRad(180 - clampDegrees(clampedFlexDeg, -5, 175));
  const candidateA = normalize(rotateAroundAxis(parentDirection, rawAxis, innerAngleRad));
  const candidateB = normalize(rotateAroundAxis(parentDirection, rawAxis, -innerAngleRad));
  if (!candidateA) {
    return childDirection;
  }
  if (!candidateB) {
    return candidateA;
  }
  return dot(candidateA, childDirection) >= dot(candidateB, childDirection)
    ? candidateA
    : candidateB;
}

export function evaluateHingeFlexion({ name, parent, joint, child, minFlexDeg, softMaxFlexDeg, maxFlexDeg }) {
  if (!parent || !joint || !child) {
    return { name, flexDeg: null, hardViolation: false, softViolation: false, reason: "missing" };
  }
  const a = subtract(parent, joint);
  const b = subtract(child, joint);
  const aLength = magnitude(a);
  const bLength = magnitude(b);
  if (aLength < EPSILON || bLength < EPSILON) {
    return { name, flexDeg: null, hardViolation: false, softViolation: false, reason: "degenerate" };
  }
  const innerAngleDeg = radToDeg(Math.acos(clamp(dot(a, b) / (aLength * bLength), -1, 1)));
  const flexDeg = 180 - innerAngleDeg;
  return {
    name,
    innerAngleDeg: round(innerAngleDeg),
    ...constrainFlexionDeg({ flexDeg, minFlexDeg, softMaxFlexDeg, maxFlexDeg }),
    reason: "ok",
  };
}

export function evaluateTargetCone({ bone, directionTorsoLocal, constraint }) {
  if (!directionTorsoLocal || !constraint) {
    return { bone, violation: false, reason: "missing" };
  }
  if (constraint.side === "left" && Number(directionTorsoLocal.x) < Number(constraint.crossBodyLimit)) {
    return { bone, violation: true, reason: "cross_body_limit", confidenceScale: 0.55 };
  }
  if (constraint.side === "right" && Number(directionTorsoLocal.x) > Number(constraint.crossBodyLimit)) {
    return { bone, violation: true, reason: "cross_body_limit", confidenceScale: 0.55 };
  }
  return { bone, violation: false, reason: "ok", confidenceScale: 1 };
}

export function evaluateLowerBodyReliability({ points, previous = createAnatomyState(), timestamp = 0 } = {}) {
  const names = ["leftHip", "rightHip", "leftKnee", "rightKnee", "leftAnkle", "rightAnkle"];
  const visibilities = names.map((name) => visibility(points?.[name])).filter(Number.isFinite);
  const average = visibilities.reduce((sum, value) => sum + value, 0) / Math.max(1, visibilities.length);
  const reliable = visibilities.length === names.length && average >= 0.72;
  return {
    reliable,
    confidence: round(average),
    reason: reliable ? "ok" : "low_visibility",
    lastReliableAt: reliable ? timestamp : previous?.lowerBody?.lastReliableAt ?? null,
  };
}

export function constrainPoseTargets({ targets = [], anatomy = {} } = {}) {
  return targets.map((target) => {
    const diagnostic = anatomy.targets?.[target.bone];
    const confidenceScale = Number.isFinite(Number(diagnostic?.confidenceScale)) ? Number(diagnostic.confidenceScale) : 1;
    return {
      ...target,
      constrainedDirection: diagnostic?.constrainedDirection ?? target.constrainedDirection ?? target.direction,
      rawDirection: target.rawDirection ?? target.direction,
      confidence: round(Number(target.confidence ?? 1) * confidenceScale),
      anatomy: diagnostic ?? null,
    };
  });
}

function visibility(point) {
  return Number(point?.visibility ?? point?.presence);
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function magnitude(v) {
  return Math.hypot(v.x, v.y, v.z);
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
  const length = magnitude(vector);
  if (!Number.isFinite(length) || length < EPSILON) {
    return null;
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function choosePerpendicularAxis(direction) {
  const basis = Math.abs(direction.y) < 0.8
    ? { x: 0, y: 1, z: 0 }
    : { x: 1, y: 0, z: 0 };
  return normalize(cross(direction, basis));
}

function rotateAroundAxis(vector, axis, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const axisDot = dot(axis, vector);
  return {
    x: vector.x * cos + (axis.y * vector.z - axis.z * vector.y) * sin + axis.x * axisDot * (1 - cos),
    y: vector.y * cos + (axis.z * vector.x - axis.x * vector.z) * sin + axis.y * axisDot * (1 - cos),
    z: vector.z * cos + (axis.x * vector.y - axis.y * vector.x) * sin + axis.z * axisDot * (1 - cos),
  };
}

function degToRad(value) {
  return value * Math.PI / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function radToDeg(value) {
  return value * 180 / Math.PI;
}

function round(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  const rounded = Math.round(number * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
```

- [ ] **Step 4: Wire the test into `npm run check`**

Modify `package.json` so `"check"` starts with the new anatomy check:

```json
"check": "node tests/anatomical-constraints-check.mjs && node tests/contract-check.mjs && node tests/avatar-vrm-rendering-compat-check.mjs && node tests/avatar-vrm-humanoid-check.mjs && node tests/avatar-vrm-expression-check.mjs && node tests/retarget-orientation-check.mjs && node tests/face-head-pose-check.mjs && node tests/strict-retarget-check.mjs && node tests/depth-calibration-check.mjs && node tests/motion-frame-check.mjs && node tests/motion-forwarding-check.mjs && node tests/presence-state-check.mjs && node tests/facing-estimator-check.mjs && node tests/solver-synthetic-check.mjs && node tests/sam-manual-labels-check.mjs && node tests/motion-recording-compare-check.mjs && node tests/retarget-mode-compare-check.mjs && node tests/mhr70-mapping-check.mjs && node tests/mhr70-hands-check.mjs && node tests/gesture-classifier-check.mjs && node tests/sam-reference-labeler-check.mjs && node tests/sam-calibration-profile-check.mjs && node tests/sam-regression-oracle-check.mjs && node tests/hmr-jsonl-adapter-check.mjs && node tests/clip-manifest-check.mjs"
```

- [ ] **Step 5: Run checkpoint verification**

Run:

```bash
node tests/anatomical-constraints-check.mjs
npm run check
```

Expected:

```text
Anatomical constraints check passed.
```

and `npm run check` exits 0.

- [ ] **Step 6: Commit checkpoint 1**

```bash
git add package.json src/retarget/anatomical-constraints.js tests/anatomical-constraints-check.mjs
git commit -m "feat: add anatomical constraint primitives"
```

---

## Checkpoint 2: Solver Anatomy Diagnostics and Target Confidence

**Files:**
- Modify: `src/solver/pose-solver.js`
- Modify: `tests/solver-synthetic-check.mjs`
- Modify: `tests/anatomical-constraints-check.mjs`

- [ ] **Step 1: Add failing solver assertions**

Extend `tests/solver-synthetic-check.mjs` with a synthetic impossible knee and impossible elbow case:

```js
const impossibleKneeFrame = {
  poseLandmarks: [],
  poseWorldLandmarks: makePose33({
    leftShoulder: p(-0.2, 1.4, 0, 0.99),
    rightShoulder: p(0.2, 1.4, 0, 0.99),
    leftHip: p(-0.15, 0.9, 0, 0.99),
    rightHip: p(0.15, 0.9, 0, 0.99),
    leftKnee: p(-0.15, 0.45, 0, 0.99),
    leftAnkle: p(-0.15, 0.95, 0, 0.99),
    rightKnee: p(0.15, 0.45, 0, 0.99),
    rightAnkle: p(0.15, 0.1, 0, 0.99),
  }),
  timestamp: 1000,
};
const impossibleKneeSolved = solvePoseFrame(impossibleKneeFrame, {});
assert.equal(impossibleKneeSolved.meta.anatomyHardViolations >= 1, true);
assert.equal(impossibleKneeSolved.targets.find((target) => target.bone === "LeftLeg").anatomy.reason, "hinge_flexion_limit");
```

Add these local helpers at the bottom of `tests/solver-synthetic-check.mjs`. If the file already has helpers with these names, replace the new snippet's calls with the existing helper names and keep the same landmark indices and visibility values:

```js
function makePose33(overrides) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0, presence: 0 }));
  const indices = {
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
    leftFootIndex: 31,
    rightFootIndex: 32,
  };
  for (const [name, point] of Object.entries(overrides)) {
    landmarks[indices[name]] = point;
  }
  return landmarks;
}

function p(x, y, z, visibility = 0.99) {
  return { x, y, z, visibility, presence: visibility };
}
```

- [ ] **Step 2: Run solver tests and verify they fail**

Run:

```bash
node tests/solver-synthetic-check.mjs
```

Expected: assertion failure for missing `meta.anatomyHardViolations` or missing target anatomy data.

- [ ] **Step 3: Integrate anatomy evaluation into `pose-solver`**

Modify `src/solver/pose-solver.js` imports:

```js
import {
  ANATOMICAL_CONSTRAINTS,
  constrainHingeChildDirection,
  constrainPoseTargets,
  createAnatomyState,
  evaluateHingeFlexion,
  evaluateLowerBodyReliability,
  evaluateTargetCone,
} from "../retarget/anatomical-constraints.js";
```

Inside `solvePoseTargetsFromPoints`, replace the current target stabilization setup:

```js
  const rawTargets = BODY_TARGETS.map((target) => solveTarget(target, points))
    .map((target) => target ? enrichTargetWithTorsoBasis(target, torsoBasis) : null)
    .filter(Boolean);
```

with:

```js
  const rawTargets = BODY_TARGETS.map((target) => solveTarget(target, points))
    .map((target) => target ? enrichTargetWithTorsoBasis(target, torsoBasis) : null)
    .filter(Boolean);
  const anatomy = evaluatePoseAnatomy(points, rawTargets, previousState.anatomy, {
    timestamp,
  });
  const anatomyConstrainedTargets = constrainPoseTargets({
    targets: rawTargets,
    anatomy,
  });
```

Then change stabilization input from `rawTargets` to `anatomyConstrainedTargets`.

Add the local helper in `pose-solver.js` after `enrichTargetWithTorsoBasis`:

```js
function evaluatePoseAnatomy(points, rawTargets, previousAnatomyState = createAnatomyState(), options = {}) {
  const targetsByBone = new Map(rawTargets.map((target) => [target.bone, target]));
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
    if (constraint.kind === "hinge") {
      const hinge = HINGES.find((item) => item.name === constraint.joint);
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
        direction: target.constrainedDirection ?? target.direction,
        timestamp: options.timestamp,
      }])),
      lowerBody,
    },
  };
}
```

Update returned `state`:

```js
      anatomy: anatomy.state,
```

Update returned `meta`:

```js
      anatomySoftViolations: anatomy.softViolations,
      anatomyHardViolations: anatomy.hardViolations,
      anatomyLowerBodyReliable: anatomy.lowerBody.reliable,
      anatomyLowerBodyConfidence: anatomy.lowerBody.confidence,
      anatomyConstrainedTargets: Object.keys(anatomy.targets).length,
```

- [ ] **Step 4: Run checkpoint verification**

Run:

```bash
node tests/solver-synthetic-check.mjs
node tests/anatomical-constraints-check.mjs
npm run check
```

Expected: all pass.

- [ ] **Step 5: Commit checkpoint 2**

```bash
git add src/solver/pose-solver.js tests/solver-synthetic-check.mjs tests/anatomical-constraints-check.mjs
git commit -m "feat: report anatomical pose constraints"
```

---

## Checkpoint 3: Retarget Direction Clamp and Default-On Strict Safety

**Files:**
- Modify: `src/retarget/skeleton-fk-retarget.js`
- Modify: `src/avatar-renderer.js`
- Modify: `tests/strict-retarget-check.mjs`

- [ ] **Step 1: Add failing strict retarget assertions**

Extend `tests/strict-retarget-check.mjs`:

```js
const constrainedPose = solvedPose([
  target("LeftLeg", "legs", { x: 0, y: -1, z: 0 }, {
    constrainedDirection: { x: 0, y: -0.7, z: 0.7 },
    anatomy: {
      reason: "hinge_flexion_limit",
      hardViolation: true,
      confidenceScale: 0.35,
    },
  }),
]);
const constrainedFrame = buildStrictRetargetFrame({
  solvedPose: constrainedPose,
  rigBasis: {
    bones: {
      LeftLeg: { restAxis: [0, -1, 0] },
    },
  },
});
assert.deepEqual(
  roundVector(constrainedFrame.bones.LeftLeg.sourceDirection),
  roundVector({ x: 0, y: -0.7, z: 0.7 }),
);
assert.equal(constrainedFrame.diagnostics.anatomyConstrainedBones.includes("LeftLeg"), true);
assert.equal(constrainedFrame.bones.LeftLeg.anatomy.reason, "hinge_flexion_limit");
```

- [ ] **Step 2: Run strict test and verify it fails**

Run:

```bash
node tests/strict-retarget-check.mjs
```

Expected: strict frame still uses `target.direction` and missing anatomy diagnostics.

- [ ] **Step 3: Prefer constrained directions in strict frame**

Modify `src/retarget/skeleton-fk-retarget.js` in `buildStrictRetargetFrame`:

```js
    const sourceDirection = normalizeVector(target?.constrainedDirection ?? target?.direction);
```

Add anatomy fields into each bone:

```js
      anatomy: target.anatomy ?? null,
      rawDirection: normalizeVector(target.rawDirection) ?? normalizeVector(target.direction) ?? sourceDirection,
```

Change diagnostics:

```js
      anatomyConstrainedBones: Object.values(bones)
        .filter((bone) => bone.anatomy)
        .map((bone) => bone.bone),
      anatomyHardViolations: Object.values(bones)
        .filter((bone) => bone.anatomy?.hardViolation)
        .length,
      anatomySoftViolations: Object.values(bones)
        .filter((bone) => bone.anatomy?.softViolation)
        .length,
```

- [ ] **Step 4: Use constrained directions in renderer**

Modify `src/avatar-renderer.js`:

```js
  function resolveStrictTargetDirection(solvedTarget) {
    const direction = solvedTarget.constrainedDirection ?? solvedTarget.direction;
    return tmpVectorC.set(
      direction.x,
      direction.y,
      direction.z,
    );
  }
```

Modify `resolveSolvedTargetDirection` so legacy mode also prefers constrained directions unless torso-local correction is explicitly chosen:

```js
    const direction = solvedTarget.constrainedDirection ?? solvedTarget.direction;
    return tmpVectorC.set(
      direction.x,
      direction.y,
      direction.z,
    );
```

Keep raw direction only for diagnostics.

- [ ] **Step 5: Re-enable maxAngle/maxTwist in strict mode**

In `src/avatar-renderer.js`, replace:

```js
      const maxAngle = strictModeActive
        ? profile ? target.maxAngle * (profile.maxAngleScale ?? 1) : undefined
        : target.maxAngle * (profile?.maxAngleScale ?? 1);
```

with:

```js
      const maxAngle = target.maxAngle * (profile?.maxAngleScale ?? 1);
```

Replace:

```js
      const maxTwist = profile
        ? target.maxTwist * (profile.maxTwistScale ?? 1)
        : undefined;
```

with:

```js
      const maxTwist = target.maxTwist * (profile?.maxTwistScale ?? 1);
```

This keeps strict mode direct, but no longer unlimited.

- [ ] **Step 6: Run checkpoint verification**

Run:

```bash
node tests/strict-retarget-check.mjs
npm run check
```

Expected: all pass.

- [ ] **Step 7: Commit checkpoint 3**

```bash
git add src/retarget/skeleton-fk-retarget.js src/avatar-renderer.js tests/strict-retarget-check.mjs
git commit -m "feat: apply anatomical limits during retarget"
```

---

## Checkpoint 4: Lower-Body Reliability and Neutral Hold

**Files:**
- Modify: `src/retarget/anatomical-constraints.js`
- Modify: `src/solver/pose-solver.js`
- Modify: `src/avatar-renderer.js`
- Create: `scripts/anatomy-constraint-smoke.mjs`

- [ ] **Step 1: Add lower-body reliability criteria**

Extend `evaluateLowerBodyReliability` to include:

```js
const leftLegLength = segmentLength(points?.leftHip, points?.leftKnee) + segmentLength(points?.leftKnee, points?.leftAnkle);
const rightLegLength = segmentLength(points?.rightHip, points?.rightKnee) + segmentLength(points?.rightKnee, points?.rightAnkle);
const symmetry = leftLegLength > EPSILON && rightLegLength > EPSILON
  ? Math.min(leftLegLength, rightLegLength) / Math.max(leftLegLength, rightLegLength)
  : 0;
const reliable = visibilities.length === names.length && average >= 0.72 && symmetry >= 0.62;
```

Add helper:

```js
function segmentLength(a, b) {
  if (!a || !b) {
    return 0;
  }
  return magnitude(subtract(a, b));
}
```

- [ ] **Step 2: Mark leg targets as neutral-hold candidates**

In `pose-solver.js`, after `const anatomy = evaluatePoseAnatomy(...)`, if `anatomy.lowerBody.reliable === false`, add diagnostics for `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `RightUpLeg`, `RightLeg`, and `RightFoot`:

```js
for (const bone of ["LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"]) {
  anatomy.targets[bone] = {
    ...(anatomy.targets[bone] ?? {}),
    kind: "lower-body-reliability",
    reason: "lower_body_unreliable",
    confidenceScale: 0.25,
    hardViolation: false,
    softViolation: true,
    neutralHold: true,
  };
}
anatomy.hardViolations = Object.values(anatomy.targets).filter((item) => item.hardViolation).length;
anatomy.softViolations = Object.values(anatomy.targets).filter((item) => item.softViolation).length;
```

- [ ] **Step 3: Apply neutral hold in renderer**

In `src/avatar-renderer.js`, inside the `for (const target of BODY_RETARGETS)` loop, before resolving direction:

```js
      if (solvedTarget.anatomy?.neutralHold && (solvedTarget.group === "legs" || solvedTarget.group === "feet")) {
        applyOccludedBodyBone(target.bone, timestamp, delta, {
          holdMs: RETARGET_OCCLUSION_HOLD_MS,
          decayMs: RETARGET_OCCLUSION_DECAY_MS,
        });
        continue;
      }
```

- [ ] **Step 4: Add smoke script**

Create `scripts/anatomy-constraint-smoke.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs";
import { parseMotionRecordingJsonl } from "../src/motion-frame.js";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/anatomy-constraint-smoke.mjs <recording.jsonl>");
  process.exit(2);
}

const text = fs.readFileSync(input, "utf8");
const recording = parseMotionRecordingJsonl(text);
const state = {};
const rows = [];

for (const frame of recording.frames) {
  const solved = solvePoseFrame(frame.motionFrame ?? frame, state);
  Object.assign(state, solved.state);
  rows.push({
    timestamp: solved.timestamp,
    anatomyHardViolations: solved.meta.anatomyHardViolations ?? 0,
    anatomySoftViolations: solved.meta.anatomySoftViolations ?? 0,
    lowerBodyReliable: Boolean(solved.meta.anatomyLowerBodyReliable),
    constrainedTargets: solved.meta.anatomyConstrainedTargets ?? 0,
  });
}

const hardFrames = rows.filter((row) => row.anatomyHardViolations > 0).length;
const softFrames = rows.filter((row) => row.anatomySoftViolations > 0).length;
const lowerReliableFrames = rows.filter((row) => row.lowerBodyReliable).length;

console.log(JSON.stringify({
  input,
  frames: rows.length,
  hardFrames,
  softFrames,
  lowerReliableFrames,
  lowerReliableRatio: rows.length ? lowerReliableFrames / rows.length : 0,
}, null, 2));
```

- [ ] **Step 5: Validate on `arms-crossed` recording if present**

Run:

```bash
node scripts/anatomy-constraint-smoke.mjs output/reports/arms-crossed-recording-xbot.jsonl
```

Expected:

```text
{
  "input": "output/reports/arms-crossed-recording-xbot.jsonl",
  "frames": 1,
  "hardFrames": 0,
  "softFrames": 0,
  "lowerReliableFrames": 0,
  "lowerReliableRatio": 0
}
```

The exact numeric values may differ by recording. The required condition is `frames > 0` and all count fields are finite numbers.

Then run browser measurement:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/arms-crossed.mp4 \
  --only-models \
  --model "Xbot=assets/models/Xbot.glb" \
  --output output/reports/arms-crossed-motion-xbot-anatomy.json \
  --recording-output output/reports/arms-crossed-recording-xbot-anatomy.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

Expected:

- No hard-limit warnings from impossible knees/elbows.
- `overallScore` stays above 0.95.
- Report includes anatomy diagnostics.
- If lower-body is unreliable, legs are held or neutral-blended instead of deep knee flexion.

- [ ] **Step 6: Run checkpoint verification**

```bash
npm run check
git diff --check
```

Expected: both pass.

- [ ] **Step 7: Commit checkpoint 4**

```bash
git add src/retarget/anatomical-constraints.js src/solver/pose-solver.js src/avatar-renderer.js scripts/anatomy-constraint-smoke.mjs
git commit -m "feat: hold unreliable lower-body retargets"
```

---

## Checkpoint 5: Hand and Finger Constraint Pass

**Files:**
- Modify: `src/hand-retargeting.js`
- Modify: `src/avatar-renderer.js`
- Modify: `tests/anatomical-constraints-check.mjs`
- Modify: `tests/mhr70-hands-check.mjs`

- [ ] **Step 1: Add segment metadata to hand helper**

Modify `src/hand-retargeting.js` so `resolveFingerSegmentPoints` includes `jointKind`:

```js
  return {
    from,
    to,
    fromIndex: from === points[fromIndex] ? fromIndex : fallbackFromIndex,
    toIndex,
    jointKind: fingerName === "Thumb"
      ? ["thumb-cmc", "thumb-mcp", "thumb-ip", "thumb-tip"][segmentIndex]
      : ["mcp", "pip", "dip", "tip"][segmentIndex],
  };
```

- [ ] **Step 2: Add finger constraint tests**

Extend `tests/anatomical-constraints-check.mjs`:

```js
import {
  FINGER_CONSTRAINTS,
  constrainFingerFlexionDeg,
} from "../src/retarget/anatomical-constraints.js";

assert.equal(FINGER_CONSTRAINTS.Thumb[0].kind, "thumb-cmc");
assert.equal(FINGER_CONSTRAINTS.default[1].kind, "pip");

const pipClamp = constrainFingerFlexionDeg({
  fingerName: "Index",
  segmentIndex: 1,
  flexDeg: 140,
});
assert.equal(pipClamp.clampedFlexDeg, 115);
assert.equal(pipClamp.hardViolation, true);
```

Add implementation:

```js
export function constrainFingerFlexionDeg({ fingerName, segmentIndex, flexDeg }) {
  const constraints = fingerName === "Thumb" ? FINGER_CONSTRAINTS.Thumb : FINGER_CONSTRAINTS.default;
  const constraint = constraints[segmentIndex] ?? constraints[constraints.length - 1];
  const [minFlexDeg, maxFlexDeg] = constraint.flexDeg ?? [-10, 95];
  const [softMinFlexDeg, softMaxFlexDeg] = constraint.softFlexDeg ?? [minFlexDeg, maxFlexDeg];
  return constrainFlexionDeg({
    flexDeg,
    minFlexDeg,
    softMaxFlexDeg,
    maxFlexDeg,
    softMinFlexDeg,
  });
}
```

- [ ] **Step 3: Apply finger constraints in renderer**

In `src/avatar-renderer.js`, inside the finger loop after `tmpVectorC.subVectors(to, from);`, add:

```js
        const fingerConstraint = getFingerAimConstraint(fingerName, i);
        applyAimToBone(chain[i], tmpVectorC, strictHandAlpha ?? segmentAlpha * spreadStrength, fingerConstraint.maxAngle, {
          maxTwist: fingerConstraint.maxTwist,
        });
```

Add helper near hand functions:

```js
  function getFingerAimConstraint(fingerName, segmentIndex) {
    if (fingerName === "Thumb") {
      return segmentIndex === 0
        ? { maxAngle: THREE.MathUtils.degToRad(90), maxTwist: THREE.MathUtils.degToRad(60) }
        : { maxAngle: THREE.MathUtils.degToRad(75), maxTwist: THREE.MathUtils.degToRad(28) };
    }
    if (segmentIndex === 0) {
      return { maxAngle: THREE.MathUtils.degToRad(95), maxTwist: THREE.MathUtils.degToRad(28) };
    }
    return { maxAngle: THREE.MathUtils.degToRad(82), maxTwist: THREE.MathUtils.degToRad(18) };
  }
```

Remove the old strict-mode unlimited finger call:

```js
activeRetargetMode === RETARGET_MODE_STRICT ? undefined : fingerName === 'Thumb' ? 1.1 : 1.25
```

so strict and legacy both keep finger guardrails.

- [ ] **Step 4: Run checkpoint verification**

```bash
node tests/anatomical-constraints-check.mjs
node tests/mhr70-hands-check.mjs
npm run check
```

Expected: all pass.

- [ ] **Step 5: Commit checkpoint 5**

```bash
git add src/hand-retargeting.js src/avatar-renderer.js src/retarget/anatomical-constraints.js tests/anatomical-constraints-check.mjs tests/mhr70-hands-check.mjs
git commit -m "feat: constrain hand and finger retargeting"
```

---

## Checkpoint 6: Report Diagnostics and Debug Comparisons

**Files:**
- Modify: `src/avatar-renderer.js`
- Modify: `src/app.js`
- Modify: `scripts/avatar-motion-agreement-check.mjs`
- Modify: `tests/motion-frame-check.mjs` if report schema checks require updates

- [ ] **Step 1: Expose anatomy diagnostics in pose solver snapshot**

In `createPoseSolverSnapshot` in `src/avatar-renderer.js`, add:

```js
      anatomy: {
        softViolations: solvedPose.meta.anatomySoftViolations ?? 0,
        hardViolations: solvedPose.meta.anatomyHardViolations ?? 0,
        constrainedTargets: solvedPose.meta.anatomyConstrainedTargets ?? 0,
        lowerBodyReliable: solvedPose.meta.anatomyLowerBodyReliable ?? null,
        lowerBodyConfidence: solvedPose.meta.anatomyLowerBodyConfidence ?? null,
      },
```

Add per-target anatomy fields:

```js
        anatomy: target.anatomy ?? null,
```

- [ ] **Step 2: Add report warnings**

In `scripts/avatar-motion-agreement-check.mjs`, inside `buildResultSummary` after `const poseSolverMetrics = ...`, add:

```js
  const poseSolverAnatomy = poseSolver?.anatomy ?? {};
  const poseSolverAnatomyHardViolations = poseSolverAnatomy.hardViolations ?? poseSolver?.anatomyHardViolations ?? 0;
  const poseSolverAnatomyConstrainedTargets = poseSolverAnatomy.constrainedTargets ?? poseSolver?.anatomyConstrainedTargets ?? 0;
```

After the existing depth calibration warning loop, add:

```js
if (poseSolverAnatomyHardViolations > 0) {
  warningsForModel.push(`${model.label}: anatomy hard limits active on latest frame (${poseSolverAnatomyHardViolations})`);
}
if (poseSolverAnatomyConstrainedTargets > 4) {
  warningsForModel.push(`${model.label}: anatomy constrained ${poseSolverAnatomyConstrainedTargets} targets on latest frame`);
}
```

Inside the returned `summary` object, after `poseSolverLowConfidenceHinges`, add:

```js
      poseSolverAnatomyHardViolations,
      poseSolverAnatomySoftViolations: poseSolverAnatomy.softViolations ?? poseSolver?.anatomySoftViolations ?? null,
      poseSolverAnatomyConstrainedTargets,
      poseSolverAnatomyLowerBodyReliable: poseSolverAnatomy.lowerBodyReliable ?? poseSolver?.anatomyLowerBodyReliable ?? null,
      poseSolverAnatomyLowerBodyConfidence: poseSolverAnatomy.lowerBodyConfidence ?? poseSolver?.anatomyLowerBodyConfidence ?? null,
```

- [ ] **Step 3: Add query opt-out for A/B diagnosis**

In `src/app.js`, add a state field:

```js
anatomyConstraintsEnabled: readBooleanQuery("anatomy-constraints", true),
```

Pass it to `createAvatarRenderer`:

```js
anatomyConstraintsEnabled: state.anatomyConstraintsEnabled,
```

In `src/avatar-renderer.js`, normalize option:

```js
let anatomyConstraintsEnabled = options.anatomyConstraintsEnabled !== false;
```

If disabled, use raw directions:

```js
const direction = anatomyConstraintsEnabled
  ? solvedTarget.constrainedDirection ?? solvedTarget.direction
  : solvedTarget.direction;
```

- [ ] **Step 4: Run checkpoint verification**

```bash
npm run check
git diff --check
```

Expected: both pass.

- [ ] **Step 5: Commit checkpoint 6**

```bash
git add src/avatar-renderer.js src/app.js scripts/avatar-motion-agreement-check.mjs tests/motion-frame-check.mjs
git commit -m "feat: report anatomical retarget diagnostics"
```

---

## Checkpoint 7: Video Regression Validation

**Files:**
- Modify: `scripts/anatomy-constraint-smoke.mjs`
- Modify: `docs/anatomical-constraints.md`

- [ ] **Step 1: Run full static checks**

```bash
npm run check
git diff --check
```

Expected: both pass.

- [ ] **Step 2: Validate `arms-crossed.mp4`**

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/arms-crossed.mp4 \
  --only-models \
  --model "Xbot=assets/models/Xbot.glb" \
  --output output/reports/arms-crossed-motion-xbot-anatomy.json \
  --recording-output output/reports/arms-crossed-recording-xbot-anatomy.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

Expected:

- `overallScore >= 0.95`
- No anatomy hard-limit report warning.
- Knee flexion p90 in the smoke report is lower than the pre-change baseline if the lower body is unreliable, or the report explains that the lower body was reliable and only soft clamped.

- [ ] **Step 3: Validate the rotation clip**

Use the existing rotation clip that exposed yaw recovery issues:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4 \
  --only-models \
  --model "Xbot=assets/models/Xbot.glb" \
  --output output/reports/shorts-new-dance-xbot-anatomy.json \
  --recording-output output/reports/shorts-new-dance-xbot-anatomy.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

Expected:

- Existing yaw recovery behavior does not regress.
- Anatomy constraints do not increase `sourceAvatarRootYawTargetP90Deg`.
- No persistent one-sided head or body clamp due to root-facing recovery.

- [ ] **Step 4: Validate one VRM model**

Use one locally available VRM model but do not stage VRM assets:

```bash
node scripts/avatar-motion-agreement-check.mjs \
  --video output/test-videos/arms-crossed.mp4 \
  --only-models \
  --model "local-vrm=assets/models/1406500396179985353.vrm" \
  --output output/reports/arms-crossed-motion-vrm-anatomy.json \
  --recording-output output/reports/arms-crossed-recording-vrm-anatomy.jsonl \
  --min-pose-frames 160 \
  --warmup-pose-frames 20 \
  --timeout-ms 240000 \
  --debug-overlay off \
  --measurement-only
```

Expected:

- VRM loads and renders as before.
- Constraint diagnostics appear.
- No new missing bone errors.

- [ ] **Step 5: Document final tuning**

Create `docs/anatomical-constraints.md` with:

```md
# Anatomical Retarget Constraints

The runtime uses anatomical guardrails to prevent impossible avatar poses when landmark tracking is noisy. The limits are animation safety limits, not clinical diagnosis thresholds.

## Default behavior

Anatomy constraints are enabled by default. Use `?anatomy-constraints=off` only for A/B debugging.

## Constraint families

- Hinge constraints: elbows, knees, PIP/DIP, thumb IP.
- Swing cone constraints: shoulders and hips.
- Twist constraints: forearms, wrists, upper legs, feet, fingers.
- Lower-body reliability: holds or blends legs when leg landmarks are not stable enough for a full-body retarget.

## References

- ISB lower body and spine JCS: https://www.sciencedirect.com/science/article/abs/pii/S0021929001002226
- ISB shoulder, elbow, wrist, and hand JCS: https://media.isbweb.org/images/documents/standards/Wu%20et%20al%20J%20Biomech%2038%20%282005%29%20981%E2%80%93992.pdf
- CDC normal joint ROM study: https://archive.cdc.gov/www_cdc_gov/ncbddd/jointrom/index.html
- VRM humanoid spec: https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md
```

- [ ] **Step 6: Commit checkpoint 7**

```bash
git add scripts/anatomy-constraint-smoke.mjs docs/anatomical-constraints.md
git commit -m "docs: document anatomical retarget constraints"
```

---

## Final Completion Criteria

- [ ] `npm run check` passes.
- [ ] `git diff --check` passes.
- [ ] Strict retarget uses constrained directions by default.
- [ ] Legacy retarget uses constrained directions by default.
- [ ] Query opt-out exists only for comparison: `?anatomy-constraints=off`.
- [ ] Elbow and knee impossible flexion cases are detected and constrained.
- [ ] Shoulder and hip cross-body/swing-cone violations scale confidence or clamp.
- [ ] Wrist, finger, thumb guardrails prevent unlimited strict-mode rotations.
- [ ] `arms-crossed.mp4` no longer leaves the avatar in a persistent deep-knee pose when lower-body reliability is low.
- [ ] The rotation clip used for yaw recovery does not regress.
- [ ] At least one VRM model is validated without staging local VRM assets.
- [ ] Reports include anatomy soft/hard violation counts and constrained target counts.
- [ ] `docs/anatomical-constraints.md` documents limits and references.

## Independent Verification

Before final completion, run one of:

1. Preferred: dispatch a separate review/validation subagent to inspect the diff and run `npm run check` plus at least one browser motion validation.
2. Substitute if subagents are unavailable: run a clean command sequence from repo root after restarting the dev server:

```bash
git status --short --branch
npm run check
git diff --check
node scripts/avatar-motion-agreement-check.mjs --video output/test-videos/arms-crossed.mp4 --only-models --model "Xbot=assets/models/Xbot.glb" --output output/reports/arms-crossed-motion-xbot-anatomy.json --recording-output output/reports/arms-crossed-recording-xbot-anatomy.jsonl --min-pose-frames 160 --warmup-pose-frames 20 --timeout-ms 240000 --debug-overlay off --measurement-only
```

Record the reason if independent verification is not possible.

## Progress Log

- [ ] Checkpoint 1 complete:
- [ ] Checkpoint 2 complete:
- [ ] Checkpoint 3 complete:
- [ ] Checkpoint 4 complete:
- [ ] Checkpoint 5 complete:
- [ ] Checkpoint 6 complete:
- [ ] Checkpoint 7 complete:
