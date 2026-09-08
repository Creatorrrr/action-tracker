#!/usr/bin/env node
// Usage: node scripts/sam-model-comparison.mjs BASE_CORPUS CANDIDATE_CORPUS OUTPUT [BASE_LABEL CANDIDATE_LABEL]
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { preparePoseObservation } from "../src/pose/observation-adapter.js";
import { directionErrorDeg, summarizeSamples } from "./lib/sam-pairing.mjs";

const [fullPath, heavyPath, outputPath, baselineLabel = "full", candidateLabel = "heavy"] = process.argv.slice(2);
if (!outputPath) throw new Error("Expected FULL_CORPUS HEAVY_CORPUS OUTPUT");
if (baselineLabel === candidateLabel) throw new Error("Comparison labels must differ");
const texts = await Promise.all([fullPath, heavyPath].map(p=>readFile(p,"utf8")));
const [full, heavy] = texts.map(JSON.parse);
if (full.clipId !== heavy.clipId) throw new Error("Different clips cannot be compared");
const recordedProfiles = [full, heavy].map(corpus => {
  const models = [...new Set(corpus.liveFrames.map(frame=>frame.sourceMeta.poseModelKey))];
  if (models.length !== 1 || !/^pose_(lite|full|heavy)$/.test(models[0])) throw new Error("Ambiguous recorded detector model");
  return { modelKey:models[0], inputMaxDimension:corpus.liveFrames[0].sourceMeta.inputMaxDimension ?? null,
    videoTimingMode:corpus.liveFrames[0].sourceMeta.videoTimingMode ?? null };
});
for (const [label, profile] of [[baselineLabel,recordedProfiles[0]],[candidateLabel,recordedProfiles[1]]]) {
  if (["lite","full","heavy"].includes(label) && profile.modelKey !== `pose_${label}`) throw new Error(`Recorded model does not match ${label}`);
}
const heavyByPts = new Map(heavy.alignment.pairs.filter(p=>p.referenceObserved).map(p=>[p.ptsUs,p]));
const common = full.alignment.pairs.filter(p=>p.referenceObserved && heavyByPts.has(p.ptsUs));
const segments = { leftUpperArm:[11,13],leftForeArm:[13,15],rightUpperArm:[12,14],rightForeArm:[14,16],
  leftUpperLeg:[23,25],leftLowerLeg:[25,27],rightUpperLeg:[24,26],rightLowerLeg:[26,28] };
const values = { [baselineLabel]:{}, [candidateLabel]:{} }, frameRows = [];
for (const pair of common) {
  const reference = full.teacherFrames[pair.teacherIndex];
  const hp = heavyByPts.get(pair.ptsUs);
  if (JSON.stringify(reference.canonicalPose) !== JSON.stringify(heavy.teacherFrames[hp.teacherIndex].canonicalPose)) {
    throw new Error("Models must be compared with identical teacher joints");
  }
  const frameRow = { ptsUs:pair.ptsUs, sourceFrameIndex:reference.sourceMeta.sourceFrameIndex };
  for (const [key,frame] of [[baselineLabel,full.liveFrames[pair.liveIndex]],[candidateLabel,heavy.liveFrames[hp.liveIndex]]]) {
    const landmarks = preparePoseObservation(frame,{mode:"canonical-world"}).canonicalPose.landmarks;
    frameRow[key] = {};
    for (const [name,[a,b]] of Object.entries(segments)) {
      const error = directionErrorDeg(landmarks[a],landmarks[b],reference.canonicalPose.landmarks[a],reference.canonicalPose.landmarks[b]);
      (values[key][name] ??= []).push(error);
      frameRow[key][name] = error;
    }
  }
  frameRows.push(frameRow);
}
const report = { clipId:full.clipId, generatedAt:new Date().toISOString(),
  scope:"Raw detector 3D directions on exactly the same rVFC/decoder microsecond PTS intersection. Not avatar/FK accuracy or model adoption.",
  inputs:[fullPath,heavyPath].map((p,i)=>({path:p,sha256:createHash("sha256").update(texts[i]).digest("hex")})),
  profiles:{ [baselineLabel]:recordedProfiles[0], [candidateLabel]:recordedProfiles[1] },
  frameCounts:{ [baselineLabel]:full.alignment.liveCount, [candidateLabel]:heavy.alignment.liveCount }, commonFrames:common.length,
  decoderCoverage:{ [baselineLabel]:full.alignment.decoderExactCoverage, [candidateLabel]:heavy.alignment.decoderExactCoverage },
  directionErrorDeg:Object.fromEntries(Object.entries(values).map(([key,groups])=>[key,
    Object.fromEntries(Object.entries(groups).map(([name,v])=>[name,summarizeSamples(v)]))])), frameRows };
await writeFile(outputPath,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({clipId:report.clipId,commonFrames:common.length,
  p95:Object.fromEntries(Object.keys(segments).map(name=>[name,[report.directionErrorDeg[baselineLabel][name].p95,report.directionErrorDeg[candidateLabel][name].p95].map(x=>x === null ? null : +x.toFixed(2))]))}));
