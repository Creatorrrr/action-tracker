#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pairSourceFrames } from "./lib/sam-pairing.mjs";
import { summarizeSamples } from "./lib/sam-pairing.mjs";
import { BODY_REGIONS, REGION_METRICS, rawDetectorRegionFrame, appliedAvatarRegionFrame, summarizeBodyRegions, scoreRecordedHandObservations } from "./lib/sam-body-regions.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const regionOrder = ["upperBody", "lowerBody", "torso", "headNeck", "leftArm", "rightArm", "leftLeg", "rightLeg"];
const modeLabel = mode => ({ "legacy-hybrid": "기존", "canonical-world": "공통 3D 후보", "aspect-diagnostic": "aspect 진단",
  "head-bind-up": "머리 bind축 실험 · 비채택", "regional-candidate": "부위 통합 실험 · 비채택" }[mode] ?? mode);
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: npm run sam:regions -- [--manifest tests/fixtures/sam-body-regions/r1-manifest.json] [--output output/reports/body-regions/report]\nWrites OUTPUT.json, OUTPUT.csv and OUTPUT.md. Input paths in the manifest are repository-relative. No inference is run.");
  process.exit(0);
}
const options = { manifest: "tests/fixtures/sam-body-regions/r1-manifest.json", output: "output/reports/body-regions/report" };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, "");
  if (!args[i].startsWith("--") || !(key in options) || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`Invalid argument: ${args[i]}`);
  options[key] = args[i + 1];
}
const inputs = [];
async function readInput(name) {
  const bytes = await readFile(path.resolve(root, name));
  inputs.push({ path: name, sha256: sha256(bytes), bytes: bytes.length });
  return JSON.parse(bytes);
}
const manifest = await readInput(options.manifest);
assert.equal(manifest.version, 1, "Unsupported regional manifest");
assert.ok(manifest.clips?.length, "Manifest needs explicit clips");
assert.equal(new Set(manifest.clips.map(clip => clip.clipId)).size, manifest.clips.length, "Duplicate clip");
const clips = [];
for (const entry of manifest.clips) {
  const corpus = await readInput(entry.corpus);
  assert.equal(corpus.clipId, entry.clipId);
  // Revalidate exact pairing rather than trusting cached coverage percentages.
  const decoderRows = corpus.teacherFrames.map(frame => ({ ...frame.sourceMeta,
    timeBase: { numerator: frame.sourceMeta.ptsTimeBaseNumerator, denominator: frame.sourceMeta.ptsTimeBaseDenominator },
  }));
  const alignment = pairSourceFrames(corpus.liveFrames, decoderRows, corpus.teacherFrames);
  assert.deepEqual(alignment.pairs, corpus.alignment.pairs, "Corpus exact pairing changed");
  const observed = alignment.pairs.filter(pair => pair.referenceObserved);
  const pairsByLiveIndex = new Map(observed.map(pair => [pair.liveIndex, pair]));
  const rawFrames = observed.map(pair => rawDetectorRegionFrame(corpus.liveFrames[pair.liveIndex], corpus.teacherFrames[pair.teacherIndex], pair));
  const teacherObservedFrames = corpus.teacherFrames.filter(frame => frame.canonicalPose?.status === "observed").length;
  const { pairs, ...coverage } = alignment;
  const clip = {
    clipId: entry.clipId, label: entry.label,
    captureProfiles: [...new Set(corpus.liveFrames.map(frame => JSON.stringify({
      poseModelKey: frame.sourceMeta.poseModelKey ?? null,
      inputMaxDimension: frame.sourceMeta.inputMaxDimension ?? null,
      videoTimingMode: frame.sourceMeta.videoTimingMode ?? null,
      headDirectionMode: frame.sourceMeta.headDirectionMode ?? null,
      inputCropMode: frame.sourceMeta.inputCropMode ?? null,
    })))].map(JSON.parse),
    coverage: { ...coverage, teacherObservedFrames, teacherMissingFrames: alignment.decoderCount - teacherObservedFrames,
      observedDecoderRatio: observed.length / alignment.decoderCount,
      observedTeacherRatio: teacherObservedFrames ? observed.length / teacherObservedFrames : null },
    detector: summarizeBodyRegions(rawFrames, { metricNames: ["directionDeg", "palmFrameDeg"], expectedFrameCount: observed.length }),
    handObservationsAtSourcePts: scoreRecordedHandObservations(corpus),
    palmObservationCoverage: Object.fromEntries(["Left", "Right"].map(side => {
      const rows = rawFrames.map(frame => frame.palmObservations[side]);
      const available = rows.filter(row => row.basisAvailable);
      return [side, { pairedFrames: rows.length, validBasisFrames: available.length,
        fresh100msFrames: available.filter(row => row.fresh100ms).length,
        sameFrameObservations: available.filter(row => row.sameFrame).length,
        predictedFrames: available.filter(row => row.predicted).length,
        unknownOrNoncausalTimingFrames: available.filter(row => !row.causal).length,
        observationAgeMs: summarizeSamples(available.map(row => row.ageMs)),
        freshNormalErrorDeg: summarizeSamples(rawFrames.filter(frame => frame.palmObservations[side].fresh100ms)
          .map(frame => frame.metrics.directionDeg[`${side.toLowerCase()}PalmNormal`])),
      }];
    })),
    avatars: [],
  };
  assert.equal(new Set(entry.replays.map(replay => replay.rig)).size, entry.replays.length, "Duplicate rig in clip");
  for (const replay of entry.replays) {
    const report = await readInput(replay.path);
    assert.equal(report.clipId, entry.clipId, "Replay belongs to another clip");
    assert.equal(report.modelUrl, replay.modelUrl, "Replay belongs to another rig");
    assert.deepEqual(report.alignment, corpus.alignment, "Replay/corpus alignment mismatch");
    assert.ok(report.referenceStates, "Regional scoring requires saved referenceStates; rerun probe with includeFrameRows=true");
    const heights = Object.values(report.referenceStates).map(state => state.modelHeight);
    assert.ok(heights.length && heights.every(height => Number.isFinite(height) && height > 0 && Math.abs(height - heights[0]) < 1e-8),
      "Reference normalization must use a fixed avatar height");
    assert.equal(new Set(report.results.map(result => result.mode)).size, report.results.length, "Duplicate replay mode");
    const modes = report.results.map(result => {
      assert.ok(Array.isArray(result.frameRows), "Regional scoring requires per-frame states, not marginal summaries");
      assert.equal(result.frameRows.length, result.scoredFrames, "Missing frameRows; marginal P95 cannot be reaggregated");
      const frames = result.frameRows.map(row => {
        const pair = pairsByLiveIndex.get(row.liveIndex);
        assert.ok(pair && pair.teacherIndex === row.teacherIndex && pair.ptsUs === row.ptsUs, "Frame is not an exact observed pair");
        if (row.appliedAvatarState) assert.ok(Math.abs(row.appliedAvatarState.modelHeight - heights[0]) < 1e-8, "Candidate/reference avatar height mismatch");
        return appliedAvatarRegionFrame(row, report.referenceStates[row.teacherIndex], corpus.teacherFrames[row.teacherIndex]);
      });
      return { mode: result.mode, ...summarizeBodyRegions(frames, { expectedFrameCount: observed.length }) };
    });
    clip.avatars.push({ rig: replay.rig, modelUrl: report.modelUrl, measuredAt: report.generatedAt,
      referencePolicy: report.referencePolicy,
      // Stored marginal reference residuals are retained as-is. They cannot be
      // pooled into a new regional P95 without their original frame samples.
      referenceDirectionResidualBySegment: report.oracleDirectionErrorDeg, modes });
  }
  clips.push(clip);
  console.log(`${entry.label}: ${observed.length}/${alignment.decoderCount} exact observed frames, ${clip.avatars.length} rigs`);
}

const evaluationSources = ["scripts/sam-body-region-report.mjs", "scripts/lib/sam-body-regions.mjs", "scripts/lib/sam-pairing.mjs",
  "src/pose/canonical-pose.js", "src/pose/palm-frame.js", "src/avatar-applied-state.js" ];
const sourceAudit = { evaluationSources: await Promise.all(evaluationSources.map(async name => ({ path: name,
  sha256: sha256(await readFile(path.resolve(root, name))),
}))) };
if (manifest.captureSourceSnapshot) {
  const snapshot = await readInput(manifest.captureSourceSnapshot);
  sourceAudit.captureSnapshotAt = snapshot.capturedAt;
  sourceAudit.comparisonWithCapture = await Promise.all(Object.entries(snapshot.files).map(async ([name, capturedSha256]) => {
    const bytes = await readFile(path.resolve(root, name)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    const currentSha256 = bytes ? sha256(bytes) : null;
    return { path: name, capturedSha256, currentSha256, same: capturedSha256 === currentSha256 };
  }));
}
const report = {
  version: 2, generatedAt: new Date().toISOString(),
  evidence: "Regional reaggregation of saved exact-PTS raw observations and applied avatar states; no new camera/video inference or rendering",
  metricDefinitions: REGION_METRICS, regionDefinitions: BODY_REGIONS,
  aggregation: {
    samples: "Each unique segment/bone/endpoint at each paired frame has equal weight; P95 is nearest-rank from those samples",
    frameWorst: "Per-frame maximum across the region, requiring all its members; P95 is nearest-rank over complete frame maxima",
    diagnostic: "All members must be within the fixed cutoff; missing/invalid members are unscorable and cannot count as within",
    denominator: "Accuracy is conditional on exact observed pairs; detector/teacher coverage is separate and includes the full source timeline",
    upperLower: "Same-frame cross-tab at the same cutoff, not a comparison of two independent clip averages",
    groups: "Upper body = torso + head/neck + both arms; lower body = both legs. Pelvis rotation is separate. Group rows are not additive",
  },
  limitations: [
    "SAM is an offline reference. FK/local rotation compare against a SAM-driven instance of the same production rig/retarget/filter, not measured ground-truth rotations.",
    "Torso is one hip-midpoint to shoulder-midpoint axis, not six independent vertebral observations. Neck/head are sparse landmark priors.",
    "HeadTop_End and bind-model-up are diagnostic rig axes, not validated visible skull anatomy. Reduced axis error does not establish improved head motion; head candidates failed visual review and are not product defaults.",
    "Arm/leg FK endpoints are wrist/ankle bone origins. Palm centers average wrist/index/middle/pinky MCP origins. Finger motion, foot slip and contact accuracy are not scored here.",
    "Model-local FK removes the model root transform. World FK includes existing root effects; ground-truth camera translation remains unverified.",
    "The frame maximum cutoffs (20 degrees, 4 percent height) are diagnostic, not a replacement for existing P95/coverage/runtime acceptance gates.",
    "No averaging of P95 values, no cross-rig local quaternion comparison, no fitted time shift, no confidence-based removal of difficult observations.",
    "Saved captures are reused. Source hash differences are disclosed; this is not a new run of the current realtime/camera path. Missing capture settings remain unknown.",
  ], sourceAudit, inputs, clips,
};
const prefix = path.resolve(root, options.output);
await mkdir(path.dirname(prefix), { recursive: true });
await writeFile(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n");
await writeFile(`${prefix}.csv`, makeCsv(report));
await writeFile(`${prefix}.md`, makeMarkdown(report, prefix));
console.log(`Regional report written: ${path.relative(root, prefix)}.{json,csv,md}`);

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function number(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function percent(value) { return Number.isFinite(value) ? `${number(value * 100)}%` : "—"; }
function cell(value) { return String(value).replaceAll("|", "\\|").replaceAll("\n", " "); }
function table(headers, rows) { return [headers, headers.map(() => "---"), ...rows].map(row => `| ${row.map(cell).join(" | ")} |`).join("\n"); }
function sourceLink(label, file) { return `[${label}](${path.resolve(root, file)})`; }
function makeMarkdown(report, prefix) {
  const captures = [...new Set(report.clips.flatMap(clip => clip.avatars.map(avatar => avatar.measuredAt?.slice(0, 10))))].filter(Boolean);
  const diagnosticExamples = report.clips.flatMap(clip => {
    const avatar = clip.avatars.find(avatar => avatar.rig === "Xbot") ?? clip.avatars[0];
    const mode = avatar?.modes.find(mode => mode.mode === "legacy-hybrid");
    return (mode?.upperLower.directionDeg.examples.upperWithinLowerOver ?? []).map(frame => ({ ...frame, clip: clip.label, rig: avatar.rig }));
  }).sort((a, b) => b.lowerWorst - a.lowerWorst);
  const example = diagnosticExamples[0];
  const replayCount = report.clips.reduce((sum, clip) => sum + clip.avatars.length, 0);
  const out = ["# 부위별 스켈레톤·아바타 정확도", "",
    `집계: ${report.generatedAt}. ${report.clips.length}개 영상의 저장된 원시 관측과 ${captures.join(", ")}에 저장한 ${replayCount}개 영상·rig 재생 결과를 동일 PTS에서 다시 계산했다. 재생 결과의 저장일은 원시 추론일과 다를 수 있다. 이 집계 명령은 새 추론·카메라 실행을 하지 않는다.`, "",
    ...(example ? [`**상체가 진단선 이내여도 하체가 벗어나는 프레임이 확인됐다.** ${example.clip} / ${example.rig} 기존 경로의 ${number(example.ptsUs / 1e6, 6)}초에서 상체 최대 방향 오차는 ${number(example.upperWorst)}°, 하체는 ${number(example.lowerWorst)}°다. 아래에 부위별 분포와 해당 프레임 비율을 함께 제시한다.`, ""] : []),
    "## 읽는 방법", "",
    "- 상체 = 몸통 + 머리·목 + 좌우 팔, 하체 = 좌우 다리다. 손바닥과 골반 local 회전은 별도다. v2부터 손목 bone 회전을 팔의 local 회전 집계에서 손바닥으로 옮겼다. 좌우는 인물의 해부학적 좌우다.",
    "- 각도와 위치 차이는 작을수록 좋다. 아래 **방향 P95**는 부위 내 고유 선분 × 대응 프레임의 원시 각도 표본에서 계산한다. 부위별 P95를 평균내지 않는다.",
    "- `frameWorst.p95`(CSV: `frame_worst_p95`)는 프레임마다 그 부위에서 가장 큰 오차를 고른 뒤 계산한 P95다. 한 관절의 실패가 평균에 가려지는지 함께 확인한다.",
    "- 방향·회전 20°, 위치 4%H는 기존 설계 목표를 빌린 **프레임 진단선**이다. 해당 부위의 모든 측정값이 이하여야 ‘이내’로 집계한다. 기존 제품 P95 합격 기준과 같지 않으며 통합 합격 판정은 하지 않는다.",
    "- 원시 추출 오차와 실제 아바타 적용 오차를 분리한다. 머리·목은 희소 landmark prior, 몸통은 하나의 축이다. 보간한 척추 6개를 별도 측정처럼 중복 가중하지 않는다.",
    "- FK는 같은 rig의 SAM 구동 아바타와 손목·발목·머리 위치 차이다. 키의 4%는 180cm 아바타에서 7.2cm다. 손가락·발바닥 접촉 정확도는 이 지표에 포함되지 않는다.", "",
    "## 시간 대응과 누락", "",
    table(["영상", "원본 프레임", "teacher 관측", "정확 대응", "원본 대비", "teacher 대비"], report.clips.map(clip => [
      clip.label, clip.coverage.decoderCount, clip.coverage.teacherObservedFrames, clip.detector.expectedFrameCount,
      percent(clip.coverage.observedDecoderRatio), percent(clip.coverage.observedTeacherRatio),
    ])), "",
    "점수는 정확히 대응한 프레임에 대한 조건부 정확도다. 누락·비유한 관절은 부위별 coverage에 남기고 정상으로 처리하지 않는다. keGb 원본 60fps와 Body 최대 30Hz의 cadence 차이가 포함되어 있으므로 이 대응률을 검출 성공률로 해석하지 않는다.", "",
    "## 추출한 스켈레톤의 방향 P95 (°)", "",
    table(["영상", ...regionOrder.map(id => BODY_REGIONS[id].label)], report.clips.map(clip => [clip.label,
      ...regionOrder.map(id => number(clip.detector.regions[id].metrics.directionDeg.samples.p95)),
    ])), "",
    "보존한 원시 world 관측을 공통 좌표계로 변환한 뒤 SAM과 비교했다. 아바타 retarget 이전 수치이며, 같은 추출 결과를 여러 rig 수만큼 중복 집계하지 않는다. 기록된 모델·입력 설정은 JSON의 captureProfiles에 있고, 기록에 없는 설정은 null로 남겼다.", "",
  ];
  const rigs = [...new Set(report.clips.flatMap(clip => clip.avatars.map(avatar => avatar.rig)))];
  out.push("## 좌우 손바닥 추출과 관측 지연", "",
    "손목과 검지·중지·소지 MCP(손가락 뿌리) 4점으로 손바닥을 정의한다. 주축은 손목→중지 MCP, 법선은 검지·소지 MCP가 만드는 면의 방향이다. 법선의 부호를 유지하므로 180° 뒤집힘을 정상으로 처리하지 않는다. 전체 회전은 직교한 세 축의 SO(3) 각도다. 손가락 마디의 굽힘은 이 정의에 포함되지 않는다.", "",
    "아래 raw Hand21은 Body 프레임 시각에 전달된 손 관측이다. 실제 손 추출 시각이 같은 관측만 동시 관측으로 세며, 과거 100ms 이내·비예측 관측을 fresh로 따로 집계한다. fresh 점수도 Body와 정확히 동시인 손 검출 정확도를 의미하지 않는다. 누락은 점수 0으로 채우지 않는다.", "");
  out.push("### Hand21 자체의 기록된 관측 시각에서 비교", "",
    "손 관측의 원래 PTS를 같은 corpus의 rVFC Body 입력 기록과 대조하고, 그 시각의 SAM Hand21에 정확히 대응했다. 같은 손 관측이 여러 Body 프레임에 전달돼도 한 번만 센다. 시간 보정값을 탐색하거나 가까운 teacher 프레임으로 대체하지 않는다. 아래 분모는 로그에서 복구한 고유 관측 수다. Body에 한 번도 전달되지 않은 Hand 결과는 이 로그에 없어 전체 손 검출률을 의미하지 않는다.", "",
    table(["영상", "손", "정확 측정/고유 관측", "주축 P95(°)", "법선 P95(°)", "전체 회전 P95(°)", "첫 전달 나이 P95(ms)"],
      report.clips.flatMap(clip => ['Left', 'Right'].map(side => { const h = clip.handObservationsAtSourcePts[side];
        return [clip.label, side === 'Left' ? '왼손' : '오른손', `${h.exactScoredObservations}/${h.uniqueRecordedObservations}`,
          number(h.primaryDeg.p95), number(h.normalDeg.p95), number(h.rotationDeg.p95), number(h.firstDeliveryAgeMs.p95)]; }))), "",
    "### Body에 전달된 시각에서 비교", "");
  const observationRows = [];
  for (const clip of report.clips) for (const side of ["Left", "Right"]) {
    const part = `${side.toLowerCase()}Palm`, timing = clip.palmObservationCoverage[side];
    const metric = clip.detector.regions[part].metrics;
    observationRows.push([clip.label, BODY_REGIONS[part].label, `${timing.validBasisFrames}/${timing.pairedFrames}`,
      timing.sameFrameObservations, timing.fresh100msFrames, timing.predictedFrames,
      number(timing.observationAgeMs.p95), number(metric.directionDeg.byMember[`${part}Normal`].p95),
      number(timing.freshNormalErrorDeg.p95), number(metric.palmFrameDeg.samples.p95)]);
  }
  out.push(table(["영상", "부위", "측정/대응", "동시 관측", "fresh ≤100ms", "예측", "관측 나이 P95(ms)",
    "법선 P95(°)", "fresh 법선 P95(°)", "전체 회전 P95(°)"], observationRows), "",
    "## 실제 아바타 손바닥 정확도", "",
    "주축·법선·전체 회전은 실제 rig의 손목/MCP world 위치로 계산한 손바닥과 SAM Hand21을 직접 비교한다. 중심 위치는 같은 rig의 SAM 구동 아바타를 기준으로 하고, 손목 local 회전도 JSON/CSV에 별도로 제공한다. 따라서 직접 SAM 비교와 retarget을 거친 비교가 섞인 단일 점수로 합쳐지지 않는다.", "");
  for (const rig of rigs) {
    const rows = [];
    for (const clip of report.clips) for (const mode of clip.avatars.find(avatar => avatar.rig === rig)?.modes ?? []) {
      if (mode.mode === "aspect-diagnostic") continue;
      for (const part of ["leftPalm", "rightPalm"]) {
        const metric = mode.regions[part].metrics;
        rows.push([clip.label, modeLabel(mode.mode), BODY_REGIONS[part].label,
          number(metric.directionDeg.byMember[`${part}Primary`].p95), number(metric.directionDeg.byMember[`${part}Normal`].p95),
          number(metric.palmFrameDeg.samples.p95), number(metric.fkLocalPctH.samples.p95),
          `${metric.palmFrameDeg.coverage.completeFrames}/${metric.palmFrameDeg.coverage.expectedFrames}`]);
      }
    }
    out.push(`### ${rig} 손바닥`, "", table(["영상", "경로", "부위", "주축 P95(°)", "법선 P95(°)", "전체 회전 P95(°)", "중심 P95(%H)", "측정/대응"], rows), "");
  }
  out.push("## 실제 적용된 아바타 신체 방향 P95 (°)", "",
    "SAM 관절 방향과 실제 적용 bone의 world 방향을 비교했다. 팔·다리 회전축의 twist 전체를 재는 수치는 아니다. local quaternion 회전 차이는 JSON/CSV에서 별도로 볼 수 있다.", "");
  const cranialRows = [];
  for (const clip of report.clips) for (const avatar of clip.avatars) for (const mode of avatar.modes) {
    const value = mode.regions.headNeck.metrics.headAxisDeg;
    if (value?.status !== 'measured') continue;
    cranialRows.push([clip.label, avatar.rig, modeLabel(mode.mode), number(value.samples.p95),
      number(mode.regions.headNeck.metrics.headBindUpDeg?.samples?.p95),
      number(mode.regions.headNeck.metrics.localRotationDeg.byMember.Head.p95),
      `${value.coverage.completeFrames}/${value.coverage.expectedFrames}`]);
  }
  if (cranialRows.length) out.push("### 머리 marker·bind축 진단과 기존 회전 기준의 차이", "",
    "Head→HeadTop_End bone 원점들의 world 방향 및 bind pose의 모델 +Y 방향을 현재 Head 회전으로 운반한 축을 SAM의 headAimBase→headCrown prior와 비교한다. 기존 `head`의 추정축을 소급 변경하지 않는 별도 진단이다. 해당 축이 없는 rig는 측정 불가다. 두 rig 축 모두 화면에 보이는 두개골의 해부학적 방향으로 검증되지 않았으며, SAM 목표도 희소 landmark prior다.", "",
    "**머리 축 실험은 기본 적용하지 않았다.** 축 오차가 줄어도 Polydancer 얼굴이 아래로 숙여지는 시각 실패가 있었다. 이 표의 감소를 머리 움직임의 정확도 개선으로 해석하지 않는다.", "",
    "기존 SAM 구동 아바타의 Head local 회전 차이도 함께 제시한다. 직접 SAM 축에 가까워지는 것과 기존 retarget의 회전을 재현하는 것이 충돌할 수 있으며, 이를 하나의 합격 점수로 합치지 않는다.", "",
    table(["영상", "rig", "경로", "marker 축 P95(°)", "bind +Y 축 P95(°)", "기존 SAM 아바타 Head local P95(°)", "marker 측정/대응"], cranialRows), "");
  for (const rig of rigs) {
    const rows = [];
    for (const clip of report.clips) for (const mode of clip.avatars.find(avatar => avatar.rig === rig)?.modes ?? []) {
      if (mode.mode === "aspect-diagnostic") continue;
      rows.push([clip.label, modeLabel(mode.mode), ...regionOrder.map(id => number(mode.regions[id].metrics.directionDeg.samples.p95))]);
    }
    out.push(`### ${rig}`, "", table(["영상", "경로", ...regionOrder.map(id => BODY_REGIONS[id].label)], rows), "");
  }
  const worstRows = [];
  for (const clip of report.clips) {
    const avatar = clip.avatars.find(avatar => avatar.rig === "Xbot");
    const baseline = avatar?.modes.find(mode => mode.mode === "legacy-hybrid");
    const candidate = avatar?.modes.find(mode => mode.mode === "canonical-world");
    if (!baseline || !candidate) continue;
    worstRows.push([clip.label, ...["upperBody", "lowerBody"].map(id =>
      `${number(baseline.regions[id].metrics.directionDeg.frameWorst.p95)} → ${number(candidate.regions[id].metrics.directionDeg.frameWorst.p95)}`)]);
  }
  if (worstRows.length) out.push("## 프레임마다 가장 큰 부위 오차의 P95 (°, Xbot)", "",
    "각 프레임에서 부위 내 가장 큰 방향 오차를 고른 분포다. 위의 선분 표본 P95와 함께 보아 일부 관절·시각의 악화를 확인한다. 다른 rig의 같은 지표도 JSON/CSV에 있다.", "",
    table(["영상", "상체 기존 → 공통 3D 후보", "하체 기존 → 공통 3D 후보"], worstRows), "");
  out.push("## 손목·발목·머리 위치 P95 (%H, model-local)", "",
    "방향 오차가 작아져도 실제 손·발 위치가 더 멀어지는지 확인하는 지표다. 손목과 발목은 각각 팔·다리 관절 사슬 전체의 결과다. world 위치 지표는 root 영향을 포함하므로 JSON/CSV에서 별도로 제공한다.", "");
  const endpointParts = ["leftArm", "rightArm", "leftLeg", "rightLeg", "headNeck"];
  for (const rig of rigs) {
    const rows = [];
    for (const clip of report.clips) for (const mode of clip.avatars.find(avatar => avatar.rig === rig)?.modes ?? []) {
      if (mode.mode === "aspect-diagnostic") continue;
      rows.push([clip.label, modeLabel(mode.mode), ...endpointParts.map(id => number(mode.regions[id].metrics.fkLocalPctH.samples.p95))]);
    }
    out.push(`### ${rig}`, "", table(["영상", "경로", "왼손목", "오른손목", "왼발목", "오른발목", "머리"], rows), "");
  }
  out.push("## 같은 프레임에서 상체·하체가 다르게 실패하는 비율", "",
    "아래 표는 기존 경로의 실제 아바타 방향을 기준으로 한다. ‘상체 이내·하체 초과’는 상체의 모든 방향 오차가 20° 이하면서 하체 중 하나 이상이 20°를 넘는 경우다. 전체 정확 대응 프레임이 분모이며, 미측정 프레임은 별도다.", "");
  const mismatchRows = [];
  for (const clip of report.clips) for (const avatar of clip.avatars) {
    const diagnostic = avatar.modes.find(mode => mode.mode === "legacy-hybrid")?.upperLower.directionDeg;
    if (!diagnostic) continue;
    mismatchRows.push([clip.label, avatar.rig, diagnostic.expectedFrames,
      ...["bothWithin", "upperWithinLowerOver", "upperOverLowerWithin", "bothOver", "unscorable"].map(key => `${diagnostic.counts[key]} (${percent(diagnostic.ratios[key])})`)]);
  }
  out.push(table(["영상", "rig", "대응 수", "둘 다 이내", "상체 이내·하체 초과", "상체 초과·하체 이내", "둘 다 초과", "미측정"], mismatchRows), "",
    "### 다시 확인할 원본 시각", "",
    "각 영상 Xbot 기존 경로에서 ‘상체 이내·하체 초과’인 예시를 하체 오차 순으로 두 개씩 표시했다. 연속 구간이나 전체 시간 비율을 의미하지 않는다. 다른 rig·후보·위치 지표의 예시는 JSON에 포함되어 있다.", "");
  const examples = [];
  for (const clip of report.clips) {
    const mode = clip.avatars.find(avatar => avatar.rig === "Xbot")?.modes.find(mode => mode.mode === "legacy-hybrid");
    for (const frame of mode?.upperLower.directionDeg.examples.upperWithinLowerOver.slice(0, 2) ?? []) {
      examples.push([clip.label, number(frame.ptsUs / 1e6, 6), frame.teacherIndex, number(frame.upperWorst), number(frame.lowerWorst)]);
    }
  }
  out.push(table(["영상", "PTS (초)", "source frame index (0부터)", "상체 최대 (°)", "하체 최대 (°)"], examples), "",
    "## 범위와 재현", "",
    "JSON/CSV에는 aspect 진단을 포함한 모든 경로의 부위별 평균·P50·P95·최대, 프레임 최대 P95, 측정 coverage, 진단선 초과 비율을 남겼다. 관절별 상세 수치와 최악 프레임 PTS는 JSON에 추가로 기록했다. 영상·rig별 결과를 유지하며 좋은 부위로 나쁜 부위의 결과를 상쇄하지 않는다.", "",
    "골반 yaw·카메라 이동·발 접촉·손가락·동작 지연·실제 카메라 검증은 별도 측정이 필요하다. FK/local 회전의 기준 아바타도 기존 retarget·filter·contact를 사용하므로 직접 측정된 완전한 bone 회전 정답은 아니다.", "",
    "SAM을 직접 적용한 기준 아바타의 선분별 방향 잔차도 JSON의 `referenceDirectionResidualBySegment`에 보존했다. 특히 머리·목 차이는 추출 오차뿐 아니라 prior와 rig 적용 손실을 포함할 수 있다. 원시 프레임이 없는 이 잔차의 P95를 새 부위 P95로 합치지 않았다.", "",
    `- ${sourceLink("전체 부위별 JSON", `${prefix}.json`)} / ${sourceLink("부위별 CSV", `${prefix}.csv`)}`,
    `- ${sourceLink("고정 입력 목록", options.manifest)} / ${sourceLink("집계 스크립트", "scripts/sam-body-region-report.mjs")} / ${sourceLink("부위·지표 정의", "scripts/lib/sam-body-regions.mjs")}`,
    "- 입력 파일 SHA-256, capture 시각, 집계 소스 SHA-256, capture 당시와 현재 소스 차이를 JSON에 기록했다. 현재 소스의 새 추론 성능을 뜻하지 않는다.", "",
    "```sh", "npm run sam:regions", "npm run check:regions", "```", "",
    "새 corpus와 `probePairedRenderer({ corpus, modelUrl, includeFrameRows: true })` 결과를 manifest에 추가하면 같은 정의로 재측정할 수 있다. 프레임 원본 없이 요약 P95만 있는 결과는 거부한다.", "");
  return out.join("\n");
}

function makeCsv(report) {
  const rows = [["clip", "rig", "stage", "mode", "region", "metric", "unit", "members", "sample_count", "mean", "p50", "p95", "max", "frame_worst_p95",
    "expected_paired_frames", "complete_frames", "missing_frames", "complete_frame_ratio", "sample_ratio", "diagnostic_cutoff", "within_frames", "over_frames", "unscorable_frames", "within_ratio", "over_ratio", "source_pair_ratio"]];
  function append(clip, rig, stage, mode, summary) {
    for (const [id, region] of Object.entries(summary.regions)) for (const [metric, value] of Object.entries(region.metrics)) {
      if (value.status === "not-applicable") continue;
      rows.push([clip.clipId, rig, stage, mode, id, metric, REGION_METRICS[metric].unit, value.members.join(";"),
        value.samples.count, value.samples.mean, value.samples.p50, value.samples.p95, value.samples.max, value.frameWorst.p95,
        value.coverage.expectedFrames, value.coverage.completeFrames, value.coverage.missingFrames, value.coverage.completeFrameRatio, value.coverage.sampleRatio,
        value.diagnostic.threshold, value.diagnostic.withinFrames, value.diagnostic.overFrames, value.diagnostic.unscorableFrames, value.diagnostic.withinRatio, value.diagnostic.overRatio,
        clip.coverage.observedDecoderRatio]);
    }
  }
  for (const clip of report.clips) {
    append(clip, "", "raw-detector", "canonical-world", clip.detector);
    for (const avatar of clip.avatars) for (const mode of avatar.modes) append(clip, avatar.rig, "applied-avatar", mode.mode, mode);
  }
  return rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
}
