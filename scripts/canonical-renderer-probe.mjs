// Browser module: import from a page with the application's import map.
// Oracle-input ablation only. This does not run or score a realtime detector.
import { createAvatarRenderer } from "../src/avatar-renderer.js";
import { solvePoseFrame } from "../src/solver/pose-solver.js";

export async function probeCanonicalRenderer({ frames, modelUrl, onProgress = () => {} }) {
  const results = [];
  for (const mode of ["legacy-hybrid", "canonical-world"]) {
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:480px;height:640px;position:fixed;right:0;top:0;z-index:1000;background:#eee";
    document.body.appendChild(canvas);
    const renderer = createAvatarRenderer({ canvas, modelUrl, skeletonMode: mode, retargetMode: "strict" });
    const bySegment = new Map();
    let finiteStates = 0, coveredEndpoints = 0, maxTargetDifference = 0, canonicalStable = true;
    let sourceState = {};
    try {
      await renderer.init();
      if (!renderer.getModelDiagnostics().ready) throw new Error(`Renderer failed to load ${modelUrl}`);
      for (let index = 0; index < frames.length; index++) {
        const reference = frames[index];
        if (reference.sourceMeta.observationStatus === "missing") {
          renderer.update({ motionFrame: reference });
          continue;
        }
        const input = mode === "canonical-world" ? reference : { ...reference, canonicalPose: null };
        renderer.update({ motionFrame: input });
        const state = renderer.getMotionStateSnapshot();
        const applied = state.appliedAvatarState;
        if (!applied || applied.timing.sourcePtsSec !== reference.sourceMeta.sourcePtsSec) {
          throw new Error(`Missing/stale applied state at source frame ${reference.sourceMeta.sourceFrameIndex}`);
        }
        const quaternions = Object.values(applied.bones).map((bone) => bone.localQuaternion);
        if (!quaternions.length || quaternions.some((q) => q.length !== 4 || !q.every(Number.isFinite))) {
          throw new Error("Non-finite actual bone quaternion");
        }
        finiteStates++;
        coveredEndpoints += Object.values(applied.fkEndpoints).filter((endpoint) =>
          Array.isArray(endpoint.modelLocalPosition) && endpoint.modelLocalPosition.every(Number.isFinite)).length;
        if (mode === "canonical-world") {
          canonicalStable &&= JSON.stringify(state.canonicalPose.landmarks) === JSON.stringify(reference.canonicalPose.landmarks);
          const solved = solvePoseFrame(reference, sourceState);
          sourceState = solved.state;
          for (const target of solved.targets) {
            const actual = state.strictRetarget?.bones?.[target.bone]?.sourceDirection;
            const expected = target.constrainedDirection ?? target.direction;
            if (!actual) throw new Error(`Missing canonical target ${target.bone}`);
            maxTargetDifference = Math.max(maxTargetDifference, Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z));
          }
        }
        // Pass the canonical reference explicitly even when the product used
        // the legacy input path. Both arms of the comparison use one target.
        const snapshot = renderer.getBodyValidationSnapshot({ motionFrame: reference });
        for (const segment of snapshot.segments) {
          const entry = bySegment.get(segment.name) ?? { bone: segment.bone, errors: [] };
          if (Number.isFinite(segment.errorDeg)) entry.errors.push(segment.errorDeg);
          bySegment.set(segment.name, entry);
        }
        if (index % 30 === 0) {
          onProgress({ mode, index, total: frames.length });
          await new Promise(requestAnimationFrame);
        }
      }
      if (coveredEndpoints !== finiteStates * 5) throw new Error("Incomplete actual FK endpoint coverage");
      if (mode === "canonical-world" && (!canonicalStable || maxTargetDifference > 1e-5)) {
        throw new Error("Canonical geometry or offline/product target parity failed");
      }
      results.push({ mode, frames: frames.length, finiteStates, coveredEndpoints,
        canonicalStable: mode === "canonical-world" ? canonicalStable : null,
        maxTargetDifference: mode === "canonical-world" ? maxTargetDifference : null,
        bySegment: Object.fromEntries([...bySegment].map(([name, entry]) => [name, { bone: entry.bone, ...summarize(entry.errors) }])) });
    } finally {
      renderer.dispose();
      canvas.remove();
    }
  }
  return { modelUrl, scope: "SAM oracle input to actual avatar; no detector or realtime SLA measured", results };
}

function summarize(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return { count: sorted.length, meanDeg: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    p95Deg: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null };
}
