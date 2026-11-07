// Browser module. This measures actual FK and rotations after product retarget.
// Wall speed of accelerated replay is deliberately not reported as realtime FPS.
import { createAvatarRenderer } from "../src/avatar-renderer.js";
import { preparePoseObservation } from "../src/pose/observation-adapter.js";
import { compareSamePoseAppliedAvatarStates, endpointHeightNormalizedError } from "../src/avatar-applied-state.js";
import { summarizeSamples } from "./lib/sam-pairing.mjs";

export async function probePairedRenderer({ corpus, modelUrl, onProgress = () => {}, includeFrameRows = true,
  referenceRendererUrl = null, variants = null }) {
  const { liveFrames, teacherFrames, alignment } = corpus;
  const referenceStates = new Map(), oracleSegments = {};
  const teacherIndices = new Set(alignment.pairs.filter(p=>p.referenceObserved).map(p=>p.teacherIndex));
  const matched = new Map(alignment.pairs.filter(p=>p.referenceObserved).map(p=>[p.liveIndex,p]));
  const aspect = teacherFrames[0].sourceMeta.imageWidth / teacherFrames[0].sourceMeta.imageHeight;
  const results = [];
  const referenceFactory = referenceRendererUrl ? (await import(referenceRendererUrl)).createAvatarRenderer : createAvatarRenderer;
  const cases = variants ?? ["legacy-hybrid", "aspect-diagnostic", "canonical-world"].map(mode => ({ mode,
    inputMode: mode === "canonical-world" ? mode : "legacy-hybrid" }));
  for (const variant of [{ mode: "sam-reference", inputMode: "canonical-world", frozenRenderer: true }, ...cases]) {
    const { mode } = variant;
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "width:480px;height:640px;position:fixed;right:0;top:0;z-index:1000;background:#eee";
    document.body.appendChild(canvas);
    const renderer = (variant.frozenRenderer ? referenceFactory : createAvatarRenderer)({ canvas, modelUrl,
      skeletonMode: variant.inputMode,
      smoothingMode: "retarget", retargetMode: "strict", ...variant.rendererOptions });
    const direction = {}, quaternion = {}, endpoint = {}, worldEndpoint = {}, rows = [];
    let appliedCount = 0;
    try {
      await renderer.init();
      if (!renderer.getModelDiagnostics().ready) throw new Error(`Model not ready: ${modelUrl}`);
      const frames = mode === "sam-reference" ? teacherFrames : liveFrames;
      for (let index=0; index<frames.length; index++) {
        let frame = frames[index];
        if (mode !== "sam-reference") {
          frame = preparePoseObservation(frame, { mode: variant.inputMode });
          if (mode === "aspect-diagnostic") {
            // Offline diagnostic only: image x expressed in image-height units.
            // The product's 2D root path also sees this transform. This is not a
            // shipping aspect fix, and root changes are not isolated by this arm.
            frame = { ...frame, poseLandmarks: frame.poseLandmarks?.map(p=>p ? { ...p, x:(p.x-.5)*aspect+.5 } : p) };
          }
        }
        renderer.update({ motionFrame: frame });
        const applied = renderer.getAppliedAvatarStateSnapshot();
        if (!applied || applied.timing.sourcePtsSec !== frame.sourceMeta.sourcePtsSec ||
            Object.values(applied.bones).some(b=>b.localQuaternion.length !== 4 || !b.localQuaternion.every(Number.isFinite)) ||
            applied.coverage.fkEndpoints.ratio !== 1) throw new Error(`Invalid/stale applied state: ${mode}/${index}`);
        appliedCount++;
        const pair = matched.get(index);
        if (mode === "sam-reference") {
          if (teacherIndices.has(index)) {
            referenceStates.set(index, applied);
            appendDirections(oracleSegments, renderer.getBodyValidationSnapshot({ motionFrame: frame }).segments);
          }
        } else if (pair) {
          const target = teacherFrames[pair.teacherIndex];
          const segments = renderer.getBodyValidationSnapshot({ motionFrame: target }).segments;
          appendDirections(direction, segments);
          const reference = referenceStates.get(pair.teacherIndex);
          const comparison = compareSamePoseAppliedAvatarStates(reference, applied);
          if (comparison.coverage.bones !== 1 || comparison.coverage.endpoints !== 1) throw new Error("Incomplete matched FK/rotation coverage");
          for (const row of comparison.quaternion.rows) push(quaternion,row.bone,row.errorDeg);
          for (const row of comparison.endpoint.rows) push(endpoint,row.endpoint,row.heightNormalizedError);
          for (const [bone, value] of Object.entries(applied.fkEndpoints)) {
            push(worldEndpoint,bone,endpointHeightNormalizedError(reference.fkEndpoints[bone].worldPosition,value.worldPosition,reference.modelHeight));
          }
          if (includeFrameRows) rows.push({ liveIndex:index, teacherIndex:pair.teacherIndex, ptsUs:pair.ptsUs,
            directionErrorDeg:Object.fromEntries(segments.map(s=>[s.name,s.errorDeg])),
            // Preserve actual transforms for audit; do not substitute targets.
            appliedAvatarState:applied });
        }
        if (index % 60 === 0) { onProgress({ clipId:corpus.clipId, modelUrl, mode, index, total:frames.length }); await new Promise(requestAnimationFrame); }
      }
      if (mode !== "sam-reference") results.push({ mode, inputMode:variant.inputMode,
        rendererOptions:variant.rendererOptions ?? {}, frozenRenderer:Boolean(variant.frozenRenderer), appliedCount, scoredFrames:matched.size,
        directionErrorDeg:summarizeMap(direction), quaternionErrorDeg:summarizeMap(quaternion),
        modelLocalEndpointHeightRatio:summarizeMap(endpoint), worldEndpointHeightRatio:summarizeMap(worldEndpoint), frameRows:rows });
    } finally { renderer.dispose(); canvas.remove(); }
  }
  return { clipId:corpus.clipId, modelUrl, generatedAt:new Date().toISOString(),
    scope:"Identical raw detector replay; conditional accuracy at exact observed rVFC/decoder PTS pairs",
    referencePolicy:"SAM canonical observations, full decoder cadence, independent strict product renderer with retarget smoothing. FK/rotation are SAM-driven-avatar agreement, not measured ground-truth bone rotations. Direct SAM direction errors independently expose reference retarget residual.",
    limitations:["No temporal alignment fitting", "No realtime speed claim from replay", "No ground-truth camera translation/root", "Sparse neck/head targets are landmark priors", "Existing reference contact/filter errors remain visible in oracle residual", "Aspect diagnostic also changes 2D root input"],
    referenceRendererUrl, alignment, oracleDirectionErrorDeg:summarizeMap(oracleSegments),
    referenceStates:includeFrameRows ? Object.fromEntries(referenceStates) : undefined, results };
}

function push(map,key,value) { (map[key] ??= []).push(value); }
function appendDirections(map,segments) { for (const s of segments) push(map,s.name,s.errorDeg); }
function summarizeMap(map) { return Object.fromEntries(Object.entries(map).map(([k,v])=>[k,summarizeSamples(v)])); }
