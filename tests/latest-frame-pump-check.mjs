import assert from "node:assert/strict";
import {
  AUXILIARY_INFERENCE_LANES,
  createAuxiliaryInferenceArbiter,
} from "../src/auxiliary-inference-arbiter.js";
import { createLatestFramePump } from "../src/latest-frame-pump.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function createHarness({ onTransition } = {}) {
  const gates = new Map();
  const consumed = [];
  const applied = [];
  const disposed = [];
  const pump = createLatestFramePump({
    onTransition,
    consume(envelope) {
      consumed.push(envelope);
      const gate = deferred();
      gates.set(envelope.id, gate);
      return gate.promise;
    },
    apply(result, envelope) {
      applied.push({ result, envelope });
    },
    dispose(envelope, reason) {
      disposed.push({ envelope, reason });
      envelope.bitmap?.close();
    },
  });
  return { pump, gates, consumed, applied, disposed };
}

function frame(id, extra = {}) {
  let closeCount = 0;
  return {
    id,
    sourcePtsSec: id + 0.123456789,
    token: { id: `token-${id}` },
    bitmap: {
      close() {
        closeCount += 1;
      },
    },
    get closeCount() {
      return closeCount;
    },
    ...extra,
  };
}

async function checkLatestWinsAndDisposesOnce() {
  const harness = createHarness();
  const a = frame("A");
  const b = frame("B");
  const c = frame("C");

  harness.pump.offer(a);
  harness.pump.offer(b);
  harness.pump.offer(c);

  assert.deepEqual(harness.consumed.map(({ id }) => id), ["A"]);
  assert.equal(b.closeCount, 1, "superseded pending frame must close once");
  assert.equal(c.closeCount, 0, "latest pending frame must remain live");
  assert.deepEqual(
    harness.disposed.map(({ envelope, reason }) => [envelope.id, reason]),
    [["B", "overload"]],
  );

  harness.gates.get("A").resolve("result-A");
  await waitFor(() => harness.gates.has("C"), "latest frame C did not start");
  harness.gates.get("C").resolve("result-C");
  await waitFor(() => harness.applied.length === 2, "A and C were not applied");

  assert.deepEqual(harness.consumed.map(({ id }) => id), ["A", "C"]);
  assert.deepEqual(harness.applied.map(({ envelope }) => envelope.id), ["A", "C"]);
  assert.deepEqual([a.closeCount, b.closeCount, c.closeCount], [1, 1, 1]);
  assert.deepEqual(
    harness.pump.getStatus(),
    {
      generation: 0,
      offered: 3,
      started: 2,
      applied: 2,
      overloadDrops: 1,
      staleQueuedDrops: 0,
      staleResultDrops: 0,
      consumeErrors: 0,
      applyErrors: 0,
      disposeErrors: 0,
      queuedTransitions: 1,
      replacedTransitions: 1,
      promotedTransitions: 1,
      settledTransitions: 1,
      droppedTransitions: 0,
      transitionErrors: 0,
      maxQueueDepth: 1,
      queueDepth: 0,
      inFlight: false,
    },
  );
}

async function checkPendingTransitionOrderingAndObserverIsolation() {
  const transitions = [];
  const transitionSnapshots = [];
  let harness;
  harness = createHarness({
    onTransition(transition) {
      transitions.push(transition);
      transitionSnapshots.push({
        type: transition.type,
        appliedIds: harness.applied.map(({ envelope }) => envelope.id),
        disposedIds: harness.disposed.map(({ envelope }) => envelope.id),
      });
    },
  });
  const active = frame("transition-active");
  const queued = frame("transition-queued", {
    sourcePtsSec: 4.2,
    callbackMonotonicMs: 100,
    pendingDeadlineMonotonicMs: 180,
  });
  const replacement = frame("transition-replacement", {
    sourcePtsSec: 4.233333,
    callbackMonotonicMs: 133.333,
    pendingDeadlineMonotonicMs: 213.333,
  });

  harness.pump.offer(active);
  harness.pump.offer(queued);
  harness.pump.offer(replacement);
  assert.deepEqual(
    transitions.map(({ type }) => type),
    ["pending-queued", "pending-replaced"],
  );
  assert.equal(Object.isFrozen(transitions[0]), true);
  assert.equal(Object.isFrozen(transitions[0].pending), true);
  assert.equal(transitions[0].pending.sourcePtsSec, 4.2);
  assert.equal(transitions[0].pending.pendingDeadlineMonotonicMs, 180);
  assert.equal(
    transitions[1].replaced.pendingId,
    transitions[0].pending.pendingId,
  );

  harness.gates.get("transition-active").resolve("active-result");
  await waitFor(
    () => harness.gates.has("transition-replacement"),
    "replacement pending frame did not promote",
  );
  assert.deepEqual(
    transitions.map(({ type }) => type),
    ["pending-queued", "pending-replaced", "pending-promoted"],
  );
  assert.equal(
    transitions[2].pending.pendingId,
    transitions[1].pending.pendingId,
  );
  harness.gates.get("transition-replacement").resolve("replacement-result");
  await waitFor(
    () => transitions.at(-1)?.type === "pending-settled",
    "promoted pending frame did not settle",
  );
  assert.deepEqual(
    transitions.map(({ type }) => type),
    [
      "pending-queued",
      "pending-replaced",
      "pending-promoted",
      "pending-settled",
    ],
  );
  assert.equal(Object.isFrozen(transitions[3]), true);
  assert.equal(Object.isFrozen(transitions[3].pending), true);
  assert.strictEqual(transitions[3].pending, transitions[2].pending);
  assert.equal(transitions[3].reason, "applied");
  assert.deepEqual(transitionSnapshots[3].appliedIds, [
    "transition-active",
    "transition-replacement",
  ]);
  assert.equal(
    transitionSnapshots[3].disposedIds.includes("transition-replacement"),
    true,
    "pending-settled must follow promoted envelope disposal",
  );
  assert.deepEqual(
    [active.closeCount, queued.closeCount, replacement.closeCount],
    [1, 1, 1],
  );

  const throwing = createHarness({
    onTransition() {
      throw new Error("synthetic transition observer failure");
    },
  });
  const throwingActive = frame("throwing-active");
  const throwingQueued = frame("throwing-queued");
  throwing.pump.offer(throwingActive);
  throwing.pump.offer(throwingQueued);
  throwing.gates.get("throwing-active").resolve("active-result");
  await waitFor(
    () => throwing.gates.has("throwing-queued"),
    "observer failure corrupted pending promotion",
  );
  throwing.gates.get("throwing-queued").resolve("queued-result");
  await waitFor(() => throwing.applied.length === 2, "observer failure blocked apply");
  assert.equal(throwing.pump.getStatus().transitionErrors, 3);
  assert.deepEqual([throwingActive.closeCount, throwingQueued.closeCount], [1, 1]);

  const droppedTransitions = [];
  const dropping = createHarness({
    onTransition(transition) {
      droppedTransitions.push(transition);
    },
  });
  const droppingActive = frame("dropping-active");
  const droppingQueued = frame("dropping-queued");
  dropping.pump.offer(droppingActive);
  dropping.pump.offer(droppingQueued);
  dropping.pump.advanceGeneration("synthetic-generation-advance");
  assert.deepEqual(
    droppedTransitions.map(({ type }) => type),
    ["pending-queued", "pending-dropped"],
  );
  assert.equal(droppedTransitions[1].reason, "synthetic-generation-advance");
  assert.equal(droppingQueued.closeCount, 1);
  dropping.gates.get("dropping-active").resolve("stale-result");
  await waitFor(() => !dropping.pump.getStatus().inFlight, "stale active frame did not settle");
  assert.equal(droppingActive.closeCount, 1);
}

async function checkGenerationDropsQueuedAndResults() {
  const harness = createHarness();
  const active = frame("active");
  const queued = frame("queued");

  harness.pump.offer(active);
  harness.pump.offer(queued);
  assert.equal(harness.pump.advanceGeneration("input-changed"), 1);
  assert.equal(queued.closeCount, 1);
  assert.equal(harness.pump.getStatus().queueDepth, 0);

  harness.gates.get("active").resolve("old-result");
  await waitFor(() => !harness.pump.getStatus().inFlight, "stale in-flight frame did not finish");
  assert.equal(active.closeCount, 1);
  assert.equal(harness.applied.length, 0, "stale result must never enter apply");

  const explicitlyStale = frame("explicitly-stale", { generation: 0 });
  assert.equal(harness.pump.offer(explicitlyStale), false);
  assert.equal(explicitlyStale.closeCount, 1);

  const current = frame("current");
  harness.pump.offer(current);
  harness.gates.get("current").resolve("current-result");
  await waitFor(() => harness.applied.length === 1, "current-generation result was not applied");

  const status = harness.pump.getStatus();
  assert.equal(status.generation, 1);
  assert.equal(status.staleQueuedDrops, 2);
  assert.equal(status.staleResultDrops, 1);
  assert.equal(status.applied, 1);
  assert.deepEqual(harness.applied.map(({ envelope }) => envelope.id), ["current"]);
  assert.deepEqual([active.closeCount, queued.closeCount, explicitlyStale.closeCount, current.closeCount], [1, 1, 1, 1]);
}

async function checkExactEnvelopePreservation() {
  const harness = createHarness();
  const exactToken = { generationToken: "camera-17" };
  const exact = frame("exact", {
    sourcePtsSec: 12.3456789012345,
    callbackMonotonicMs: 9876.543210987,
    token: exactToken,
  });

  harness.pump.offer(exact);
  assert.strictEqual(harness.consumed[0], exact, "consume must receive the original envelope object");
  assert.equal(exact.generation, 0, "offer must stamp the current generation");
  assert.equal(harness.consumed[0].sourcePtsSec, 12.3456789012345);
  assert.equal(harness.consumed[0].callbackMonotonicMs, 9876.543210987);
  assert.strictEqual(harness.consumed[0].token, exactToken);

  harness.gates.get("exact").resolve({ pose: "exact-result" });
  await waitFor(() => harness.applied.length === 1, "exact envelope was not applied");
  assert.strictEqual(harness.applied[0].envelope, exact);
  assert.strictEqual(harness.applied[0].envelope.token, exactToken);
  assert.equal(exact.closeCount, 1);
}

async function checkTelemetryResetPreservesLiveState() {
  const harness = createHarness();
  const active = frame("reset-active");
  const queued = frame("reset-queued");

  harness.pump.offer(active);
  harness.pump.offer(queued);
  const generationBefore = harness.pump.getGeneration();
  harness.pump.resetTelemetry();
  const reset = harness.pump.getStatus();

  assert.equal(harness.pump.getGeneration(), generationBefore);
  assert.equal(reset.generation, generationBefore);
  assert.equal(reset.inFlight, true, "reset must not cancel active work");
  assert.equal(reset.queueDepth, 1, "reset must not clear pending work");
  assert.equal(reset.maxQueueDepth, 1, "max depth must remain valid for a live queue");
  assert.deepEqual(
    {
      offered: reset.offered,
      started: reset.started,
      applied: reset.applied,
      overloadDrops: reset.overloadDrops,
      staleQueuedDrops: reset.staleQueuedDrops,
      staleResultDrops: reset.staleResultDrops,
    },
    {
      offered: 0,
      started: 0,
      applied: 0,
      overloadDrops: 0,
      staleQueuedDrops: 0,
      staleResultDrops: 0,
    },
  );

  harness.gates.get("reset-active").resolve("active-result");
  await waitFor(() => harness.gates.has("reset-queued"), "pending work was lost during reset");
  harness.gates.get("reset-queued").resolve("queued-result");
  await waitFor(() => harness.applied.length === 2, "live work did not complete after reset");
  assert.deepEqual(harness.applied.map(({ envelope }) => envelope.id), ["reset-active", "reset-queued"]);
  assert.deepEqual([active.closeCount, queued.closeCount], [1, 1]);
}

async function checkAuxiliaryInferenceCapacityAndFaceReleaseOwnership() {
  let clockMs = 10;
  const arbiter = createAuxiliaryInferenceArbiter({ now: () => clockMs });
  const left = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_LEFT,
    generation: 0,
    sourcePtsSec: 1.123456789,
  });
  const right = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: 0,
    sourcePtsSec: 1.123456789,
  });
  const facePromise = arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: 0,
    sourcePtsSec: 1.2,
  });
  let faceSettled = false;
  void facePromise.then(() => {
    faceSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(faceSettled, false, "the only third lane must wait for a real release");
  assert.deepEqual(
    {
      active: arbiter.getStatus().active,
      queued: arbiter.getStatus().queued,
      maxActive: arbiter.getStatus().maxActive,
      maxQueued: arbiter.getStatus().maxQueued,
    },
    { active: 2, queued: 1, maxActive: 2, maxQueued: 1 },
  );

  clockMs = 34.5;
  assert.equal(left.release(), true);
  const face = await facePromise;
  assert.equal(face.lane, AUXILIARY_INFERENCE_LANES.FACE);
  assert.equal(face.generation, 0);
  assert.equal(face.sourcePtsSec, 1.2);
  assert.equal(arbiter.getStatus().maxWaitMs, 24.5);
  assert.deepEqual(
    {
      waitedGrants: arbiter.getStatus().byLane.face.waitedGrants,
      totalWaitMs: arbiter.getStatus().byLane.face.totalWaitMs,
      maxWaitMs: arbiter.getStatus().byLane.face.maxWaitMs,
      averageWaitMs: arbiter.getStatus().byLane.face.averageWaitMs,
    },
    {
      waitedGrants: 1,
      totalWaitMs: 24.5,
      maxWaitMs: 24.5,
      averageWaitMs: 24.5,
    },
  );
  assert.equal(left.release(), false, "lease release must be idempotent");
  assert.equal(face.release(), true);
  assert.equal(right.release(), true);
  assert.equal(arbiter.getStatus().active, 0);
}

async function checkAuxiliaryInferenceGenerationAndDuplicateFences() {
  const arbiter = createAuxiliaryInferenceArbiter({ now: () => 0 });
  const face = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: 0,
    sourcePtsSec: 0,
  });
  const left = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_LEFT,
    generation: 0,
    sourcePtsSec: 0,
  });
  const queuedRight = arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: 0,
    sourcePtsSec: 0,
  });

  assert.equal(await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: 0,
    sourcePtsSec: 0.033333,
  }), null, "one lane must never own two active or queued requests");
  assert.equal(await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_LEFT,
    generation: 0,
    sourcePtsSec: 0.033333,
  }), null, "an active Hand lane must not grow the sole wait slot");
  assert.equal(await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: 0,
    sourcePtsSec: 0.033333,
  }), null, "the already queued third lane must not grow the sole wait slot");
  assert.equal(arbiter.getStatus().queued, 1);
  assert.equal(arbiter.getStatus().maxQueued, 1);
  assert.equal(arbiter.getStatus().queueOverflowRejections, 0);
  assert.equal(arbiter.advanceGeneration(1), 1);
  assert.equal(await queuedRight, null, "queued old-generation work must cancel");
  assert.equal(arbiter.getStatus().active, 2, "posted old work remains active until settle");
  assert.equal(await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: 0,
    sourcePtsSec: 0.1,
  }), null, "new stale acquisitions must fail closed");

  face.release();
  left.release();
  const current = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: 1,
    sourcePtsSec: 12.3456789012345,
  });
  assert.equal(current.sourcePtsSec, 12.3456789012345);
  current.release();
  assert.equal(arbiter.getStatus().generationCancellations, 1);
  assert.equal(arbiter.getStatus().duplicateLaneRejections, 3);
  assert.equal(arbiter.getStatus().staleRejections, 1);
}

async function checkAuxiliaryInferenceTelemetryResetPreservesOwnership() {
  const arbiter = createAuxiliaryInferenceArbiter({ now: () => 5 });
  const face = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.FACE,
    generation: 0,
    sourcePtsSec: 2,
  });
  const left = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_LEFT,
    generation: 0,
    sourcePtsSec: 2,
  });
  const rightPromise = arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_RIGHT,
    generation: 0,
    sourcePtsSec: 2,
  });

  arbiter.resetTelemetry();
  const reset = arbiter.getStatus();
  assert.equal(reset.active, 2);
  assert.equal(reset.queued, 1);
  assert.equal(reset.maxActive, 2);
  assert.equal(reset.maxQueued, 1);
  assert.equal(reset.attempts, 0);
  assert.equal(reset.grants, 0);
  assert.equal(reset.generation, 0);

  face.release();
  const right = await rightPromise;
  assert.equal(right.lane, AUXILIARY_INFERENCE_LANES.HAND_RIGHT);
  left.release();
  right.release();
  assert.equal(arbiter.getStatus().active, 0);
}

async function checkAuxiliaryInferenceFinallyReleaseAfterConsumerError() {
  const arbiter = createAuxiliaryInferenceArbiter();

  await assert.rejects(async () => {
    const lease = await arbiter.acquire({
      lane: AUXILIARY_INFERENCE_LANES.FACE,
      generation: 0,
      sourcePtsSec: 3,
    });
    try {
      throw new Error("synthetic consumer failure");
    } finally {
      lease.release();
    }
  }, /synthetic consumer failure/);

  assert.equal(arbiter.getStatus().active, 0);
  assert.equal(arbiter.getStatus().releases, 1);
  const next = await arbiter.acquire({
    lane: AUXILIARY_INFERENCE_LANES.HAND_LEFT,
    generation: 0,
    sourcePtsSec: 3.1,
  });
  assert.equal(next.lane, AUXILIARY_INFERENCE_LANES.HAND_LEFT);
  next.release();
}

function checkAuxiliaryInferenceInputValidation() {
  assert.throws(
    () => createAuxiliaryInferenceArbiter({ capacity: 1 }),
    /capacity must remain 2/i,
  );
  const arbiter = createAuxiliaryInferenceArbiter();
  assert.throws(
    () => arbiter.acquire({ lane: "unknown", generation: 0, sourcePtsSec: 0 }),
    /unknown auxiliary inference lane/i,
  );
  assert.throws(
    () => arbiter.acquire({
      lane: AUXILIARY_INFERENCE_LANES.FACE,
      generation: -1,
      sourcePtsSec: 0,
    }),
    /generation/i,
  );
  assert.throws(
    () => arbiter.acquire({
      lane: AUXILIARY_INFERENCE_LANES.FACE,
      generation: 0,
      sourcePtsSec: Number.NaN,
    }),
    /sourcePtsSec/i,
  );
}

await checkLatestWinsAndDisposesOnce();
await checkPendingTransitionOrderingAndObserverIsolation();
await checkGenerationDropsQueuedAndResults();
await checkExactEnvelopePreservation();
await checkTelemetryResetPreservesLiveState();
await checkAuxiliaryInferenceCapacityAndFaceReleaseOwnership();
await checkAuxiliaryInferenceGenerationAndDuplicateFences();
await checkAuxiliaryInferenceTelemetryResetPreservesOwnership();
await checkAuxiliaryInferenceFinallyReleaseAfterConsumerError();
checkAuxiliaryInferenceInputValidation();

console.log("Latest frame pump check passed");
