import assert from 'node:assert/strict';
import { createPalmObservationState, evaluatePalmReacquisition } from '../src/retarget/palm-reacquisition.js';
import { evaluatePoseHandInnovation } from '../src/retarget/pose-hand-innovation-gate.js';
import { createCausalQuaternionTargetState, updateCausalQuaternionTarget } from '../src/retarget/causal-quaternion-target.js';
const rotation = degrees => ({ x: 0, y: Math.sin(degrees * Math.PI / 360), z: 0, w: Math.cos(degrees * Math.PI / 360) });
const identity = rotation(0), displaced = rotation(120);
const args = (time, target = displaced) => ({ previousRotation: identity, candidateRotation: target,
  previousTimestampMs: time - 30, timestampMs: time, confidence: 0.2 });
const observations = createPalmObservationState();
const output = createCausalQuaternionTargetState();
updateCausalQuaternionTarget(output, identity, 0);
for (let time = 30; time <= 180; time += 30) {
  assert.equal(evaluatePoseHandInnovation(args(time)).hold, true);
  const gate = evaluatePalmReacquisition(observations, args(time));
  assert.equal(gate.hold, true, 'A single jump or short plateau must not bypass the gate');
  updateCausalQuaternionTarget(output, gate.hold ? null : displaced, time);
}
const confirmed = evaluatePalmReacquisition(observations, args(210));
assert.equal(confirmed.reacquired, true);
assert.equal(confirmed.hold, false);
assert.equal(updateCausalQuaternionTarget(output, displaced, 210).status, 'jump-hold');
const settled = updateCausalQuaternionTarget(output, displaced, 240);
assert.equal(settled.status, 'jump-confirmed-rate-limited');
assert.ok(settled.appliedDeltaDeg <= 1080 * 0.03 + 1e-6);

// Alternating outliers and a missing frame cannot accumulate confirmation time.
const noisy = createPalmObservationState();
for (let time = 30; time < 1200; time += 30) {
  assert.equal(evaluatePalmReacquisition(noisy, args(time, rotation(time % 60 ? 120 : -120))).reacquired, false);
}
evaluatePalmReacquisition(observations, args(250, null));
assert.equal(evaluatePalmReacquisition(observations, args(280)).reacquired, false);
assert.equal(evaluatePalmReacquisition(observations, args(600)).reacquired, false);
assert.equal(evaluatePalmReacquisition(observations, args(500)).reacquired, false);
assert.deepEqual(createPalmObservationState(), { rotation: null, timestampMs: null, stableSinceMs: null, anchorRotation: null });
const reliableArgs = { ...args(1000), confidence: 0.9 };
assert.equal(evaluatePalmReacquisition(createPalmObservationState(), reliableArgs).hold, evaluatePoseHandInnovation(reliableArgs).hold);
console.log('Palm stable reacquisition, isolated-noise rejection, time reset and downstream rate-limit checks passed.');
