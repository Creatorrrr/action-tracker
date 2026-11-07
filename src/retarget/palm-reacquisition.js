import { evaluatePoseHandInnovation } from './pose-hand-innovation-gate.js';

export function createPalmObservationState() {
  return { rotation: null, timestampMs: null, stableSinceMs: null, anchorRotation: null };
}

// A low-confidence observation far from a held output must not be rejected
// forever. Require a stable observation episode before letting the existing
// quaternion jump confirmation and angular-velocity limiter reacquire it.
export function evaluatePalmReacquisition(state, args, { confirmationMs = 180 } = {}) {
  const original = evaluatePoseHandInnovation(args);
  const observation = evaluatePoseHandInnovation({ ...args, previousRotation: state.rotation,
    previousTimestampMs: state.timestampMs });
  const candidate = args.candidateRotation;
  const contiguous = Number.isFinite(state.timestampMs) && args.timestampMs > state.timestampMs
    && args.timestampMs - state.timestampMs <= confirmationMs;
  const stable = candidate && contiguous && !observation.hold && Number.isFinite(observation.innovationDeg);
  if (!stable) {
    state.stableSinceMs = candidate ? args.timestampMs : null;
    state.anchorRotation = clone(candidate);
  }
  state.rotation = clone(candidate);
  state.timestampMs = args.timestampMs;
  const stableMs = candidate && Number.isFinite(state.stableSinceMs) ? args.timestampMs - state.stableSinceMs : 0;
  const reacquired = original.hold && stable && stableMs >= confirmationMs;
  return { ...original, hold: reacquired ? false : original.hold,
    reason: reacquired ? 'stable-observation-reacquire' : original.reason, reacquired: Boolean(reacquired), stableMs };
}

function clone(q) { return q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null; }
