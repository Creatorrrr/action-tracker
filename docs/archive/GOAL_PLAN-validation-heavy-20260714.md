# [보관됨] action-tracker SAM Teacher Closed-Loop Goal Plan

> 2026-07-14에 검증 인프라 중심으로 비대해진 기존 계획을 원문 그대로 보관했다.
> 현재 실행 기준은 저장소 루트의 `GOAL_PLAN.md`이며, 이 문서는 완료 조건이나 선행 게이트가 아니다.

작성일: 2026-07-10
대상 저장소: `/Users/chasoik/Projects/action-tracker`
대상 런타임: Codex goal mode
목표 성격: plan-first 장기 구현 및 검증

## 계획 검토 결과

- 판정: **통과**.
- 앞선 코드·데이터·실행 결과 분석에는 목표, 단계, 잠정 성능 기준이 있었지만 다음 항목이 하나의 durable completion condition으로 묶여 있지 않았다.
  - SAM teacher validity와 exact source PTS 계약
  - 실시간 skeleton, retarget, 최종 avatar를 분리하는 계층별 검증
  - 지원 장치에서의 end-to-end latency 기준
  - 독립 최종 검증과 clean 환경 대체 검증
  - 목표 상향 opt-in 정책
- 이 파일에서 위 항목을 보완했다.
- 기존 `GOAL_PLAN.md`의 root-yaw recovery 목표는 이미 완료된 과거 목표이므로, 이번 SAM teacher 기반 폐루프 목표로 교체한다.

## 목표 요약

- 최종적으로 달성해야 할 결과:
  - `sam-3d-body-skeletons`의 teacher-valid skeleton을 정답 기준으로 사용하여, 카메라 또는 `output/test-videos` 입력에서 실시간으로 생성한 skeleton이 teacher 동작에 수렴하도록 한다.
  - live skeleton과 SAM skeleton을 동일한 시간축·좌표계·canonical pose 계약으로 정렬한다.
  - live skeleton과 SAM skeleton을 동일한 rig/retarget 구현에 각각 입력하고, 실제 적용된 avatar local bone rotation, root transform, FK joint, hand/foot contact를 비교하는 폐루프 평가기를 만든다.
  - 현재 direction-only aiming 중심 경로를 full bone-frame FK, confidence-aware temporal policy, root/contact/IK를 갖춘 리타게팅 경로로 개선한다.
  - 목표 장치에서 실시간 성능과 최종 avatar 유사도 기준을 동시에 통과한다.
- 작업 대상/범위:
  - 실시간 입력/추론: `src/app.js`, `src/motion-worker.js`, MediaPipe loader와 frame pump
  - 데이터 계약: `src/motion-frame.js`, 신규 canonical pose 계약/adapter
  - SAM 변환: `scripts/hmr-jsonl-adapter.mjs`, `src/skeleton/*`, teacher manifest/validity 도구
  - pose solve/retarget: `src/solver/*`, `src/retarget/*`, `src/avatar-renderer.js`, rig/VRM mapping
  - 평가/검증: `scripts/*compare*.mjs`, browser validation, synthetic/clip fixtures, reports
  - 문서: README 및 관련 설계·검증 문서
- 명시적 비목표:
  - SAM 3D Body 자체를 브라우저 실시간 모델로 이식하지 않는다.
  - 현재 약 3.2분의 teacher clip만으로 일반 사용자·환경 전체에 대한 production 일반화 성능을 주장하지 않는다.
  - teacher-invalid, detector fallback, ghost, 수동 absent/occluded frame을 정답으로 강제하지 않는다.
  - 평가 clip의 frame을 train에 섞거나 frame-level random split으로 성능을 부풀리지 않는다.
  - 통과를 위해 기존 또는 신규 gate를 임의로 낮추지 않는다.
  - 기존 MotionFrame v1 recording을 읽지 못하게 만드는 무조건적인 breaking change를 하지 않는다. 필요 시 versioned v2와 v1 reader를 함께 제공한다.
  - 사용자의 untracked `assets/models/*.vrm`, `docs/superpowers/`를 수정·stage·commit하지 않는다.
  - 사용자 요청 없이 commit, push, PR, 배포를 하지 않는다.

## 기준선과 가정

### 현재 상태/기준선

- 시작 커밋: `f18c2121416a85fb887c7c0990decd910c1e0bce` (`fix: normalize pose proportions for avatar retargeting`).
- 현재 브랜치: `main`. 구현 시작 전에 `codex/sam-avatar-closed-loop` 브랜치를 만든다.
- `npm run check`는 현재 통과하지만, `tests/fixtures/clip-family/manifest.json`의 실제 clip 목록은 비어 있어 현실 영상 품질을 증명하지 않는다.
- SAM teacher:
  - 대응 clip 7개
  - 총 6,711 frame record
  - 총 6,675 person prediction
  - 약 189.6초
  - 전체 `jujae.mp4`에는 대응 teacher가 없고 16.5초 regression clip만 있다.
- 2026-07-10 fresh dance/Xbot/strict/CPU partial baseline:
  - 내부 motionAgreement: 99.19%
  - live skeleton vs SAM target-angle: mean 17.799°, p95 42.974°, max 167.385°
  - hinge-flex error: p95 61.925°
  - teacher 사용률: 77.716%, live 263 / SAM 359 frame
  - live hand motion sample: 0
  - detect p95: 125.7ms
  - frame total p95: 126.9ms
  - callback lag p95: 727.9ms
  - stale callback: 38
  - 이 성능 수치는 headless CPU, 0.25x playback 조건이므로 제품 장치 FPS 기준선으로 사용하지 않고 평가 구조의 결함 증거로만 사용한다.

### 용어 정의

- teacher-valid frame:
  - exact source PTS가 존재하고, 수동 absent/occlusion, detector miss/fallback, track 오류, 비정상 bone-length/scale/temporal jump 기준을 통과한 SAM frame.
  - validity 생성 규칙, manual annotation, split, threshold는 P0에서 version/hash로 동결한다.
  - 실제 teacher-valid mask는 P1에서 위 동결 규칙으로 생성한 직후 hash를 동결하고, 그 뒤에 live 개선을 시작한다.
  - live/student 오차가 크다는 이유로 teacher frame을 사후 제외하거나 규칙·threshold·mask를 바꾸는 것은 금지한다.
- exact pair:
  - 동일 `clipId + sourcePtsUs + loopEpoch`로 연결된 live/teacher/avatar state. 자동 offset으로 만든 근사 pair는 exact pair가 아니다.
- tracker accuracy:
  - avatar renderer 이전의 live canonical skeleton과 teacher canonical skeleton의 차이.
- retarget fidelity:
  - canonical source bone frame과 실제 avatar local quaternion/FK 결과의 차이.
- end-to-end avatar accuracy:
  - 같은 source PTS, 같은 avatar rig에서 live-driven avatar와 SAM-driven avatar의 실제 적용 상태 차이.
- end-to-end latency:
  - input source PTS/capture 시점부터 해당 pose가 avatar bone에 적용된 시점까지의 지연.

### 확인해야 할 미지수

- 현재 Mac/Chrome의 headful GPU delegate에서 안정적으로 지원되는 pose/hand cadence와 해상도.
- SAM `pred_cam_t`, focal length, global rotation의 clip별 신뢰도와 좌표축.
- teacher raw 3D의 scale/bone-length flicker를 제거하는 temporal refinement가 manual label과 일치하는지.
- 지원할 VRM0/VRM1의 실제 rest-axis와 duplicate-node mapping 범위.
- 현재 sample 범위에서 deterministic correction만으로 최종 gate를 통과할 수 있는지, causal residual student가 필요한지.

### 가정

- 1차 지원 장치는 현재 작업 Mac의 최신 지원 Chrome으로 잠근다. 다른 장치에 대한 production claim은 별도 device profile이 생길 때까지 하지 않는다.
- P0에서 OS, CPU/GPU, Chrome 버전, delegate, 모델 hash, 입력 해상도를 기록하고 그 조합을 최종 성능 gate의 고정 target profile로 사용한다.
- SAM은 teacher-valid frame 안에서만 정답으로 간주한다.
- `arms-crossed`, `csi-pose`, `jujae-regression-0-16_5`는 hard held-out challenge set으로 고정하며 학습·파라미터 선택에 사용하지 않는다.
- 절대 camera/world translation이 모호한 clip은 root-relative와 camera-relative 평가를 분리하고, 검증되지 않은 absolute MPJPE를 gate로 쓰지 않는다.
- 모델 교체 여부는 이름이나 이론 성능이 아니라 frozen teacher benchmark의 정확도-지연 Pareto 결과로 결정한다.
- 필수 목표 달성 후 실행 에이전트의 자율 목표 상향은 사용자 동의가 없으므로 비활성화한다.

## 단계별 계획

| 단계 | 작업 내용 | 단계별 목표 스펙/성능 수준 | 검증 방법 | 단계 완료 조건 |
|---|---|---|---|---|
| P0 | 작업 격리, 기준선·지원 장치·artifact manifest 동결 | 별도 `codex/` 브랜치, 7개 paired clip의 immutable raw live recording, 최소 Xbot/Soldier/Polydancer rig의 legacy report, clip/video/teacher SHA, target device/browser profile, manual scenario/contact/absence window, teacher-valid 생성 규칙/split/threshold hash 및 실행 옵션 기록 | `git status`, `git log -1`, `npm run check`, 기존 browser/check scripts, raw recording hash, report schema·label coverage 검사 | immutable raw recording과 evaluation-rule hash가 있고 legacy per-clip/per-rig 지표, 부분 실행·누락 frame, manual coverage가 명시됨 |
| P1 | Dataset v2와 teacher validity 구축 | raw MHR70/127, bbox/score, focal, camera/root, detector provenance, track ID, exact PTS를 보존하고 absent/miss/occlusion/anomaly를 삭제하지 않고 mask로 기록; P0 규칙으로 실제 mask 생성 직후 hash 동결 | adapter contract test, raw↔v2 round-trip, row/frame/person count audit, manual-label audit, rule/split/threshold/mask hash 검사 | raw 정보 손실 0, silent frame drop 0, 모든 제외 frame에 reason 존재, 실제 teacher-valid mask hash 동결 |
| P2 | Immutable FramePacket과 CanonicalPoseFrame v2 도입 | source PTS, presented frame ID, capture/inference/solve/retarget/render timestamp, axis/unit, camera/root space, 2D/3D, confidence/uncertainty를 명시; mirror/axis 변환은 adapter에서 한 번만 수행 | 24/30/59.94/60fps, seek/loop, mirror, axis, unit, v1 replay compatibility tests | production과 offline comparator가 동일 canonical conversion을 사용하고 exact pair mismatch가 0 |
| P3 | 4계층 폐루프 evaluator와 실제 avatar recorder 구축 | teacher quality, tracker accuracy, retarget fidelity, end-to-end/performance를 분리; 실제 local quaternion/root/FK/contact를 source PTS와 저장; auto offset은 진단 전용 | same-input self-test, synthetic known-rotation rig, non-identity rest rig, live↔SAM clip compare | self-test의 valid frame 오차가 수치 허용오차 이내이고 실제 avatar state가 report에 포함되며, P0 raw recording으로 개선 전 v2 baseline을 즉시 산출·동결함 |
| P4 | 실시간 frame pump/worker 정상화 | capacity-1 latest-frame queue, producer/consumer 분리, worker 기본·main lazy fallback, ROI/downscale, full-resolution RGBA readback 제거, body/hand/face cadence 분리, 정확한 end-to-end telemetry | headful target-device benchmark, CPU/GPU/worker A/B, 장시간 queue/drop/memory run | body output ≥min(sourceHz, 30Hz), render ≥60fps, queue depth ≤1, overload/stale drop ≤5%, capture-to-avatar p95 ≤80ms |
| P5 | RigProfile과 full bone-frame FK 구현 | physical node unique mapping, parent/rest basis, primary/secondary/twist axes, rig-local limit, fixed rest offsets; source endpoint mutation 제거; full local quaternion을 runtime에 실제 적용 | synthetic rotation/FK tests, duplicate-node rejection, Xbot/Soldier/VRM0/VRM1 matrix | major bone rotation/end-effector gate 통과, 동일 node 중복 덮어쓰기 0, strict telemetry와 실제 적용값 동일 |
| P6 | root/contact/IK/full 3D hand/head temporal 합성 | pelvis/root SE(3), ground/contact FSM, planted-foot lock, two-bone leg/arm residual IK, full 3D palm/finger frame, body-head×face-delta 합성, confidence-aware hold/decay/reacquire | contact-labeled windows, hand-visible/hidden windows, crouch/turn/jump, occlusion/reacquire tests | contact/foot-slide/palm/hand coverage/root-yaw/reacquire 최종 gate 통과 |
| P7 | live skeleton 정확도 개선 | 먼저 axis/scale/visibility/calibration과 causal filtering을 교정; 필요하고 학습 데이터가 충분할 때만 non-test teacher corpus로 작은 causal residual student를 학습·export; challenge clip은 train에서 제외 | clip/session 단위 split, leave-one-clip/session-out, deterministic baseline A/B, accuracy-latency Pareto report | frozen held-out set에서 skeleton 및 end-to-end avatar 지표가 동시에 개선되고 성능 gate 유지 |
| P8 | 통합 회귀, default 전환, 독립 검증 | legacy/strict/v2 A/B, 7 paired clips × 최소 3 rigs × 지원 delegate matrix, 문서와 재현 명령 정리 | `npm run check`, `git diff --check`, full frozen oracle, independent subagent, clean copy/fresh worktree 재생성 | 모든 필수 완료 기준이 pass이고 미실행/부분 실행 cell이 0; 독립 검증자가 완료를 확인 |

## 평가 및 검증 방법

### A. Teacher/reference 품질

- 필수 frame metadata:
  - source video SHA256
  - exact `sourcePtsUs`
  - extractor/model/checkpoint/config SHA
  - bbox와 persistent track
  - detector hit/fallback/miss
  - joint별 visible/occluded/out-of-frame/unknown
  - manual absence/occlusion
  - bone-length, scale, velocity temporal anomaly
- raw teacher와 temporally refined teacher를 둘 다 저장한다.
- teacher가 manual floor를 통과하지 못하는 metric은 student hard gate가 아니라 watch로 분리한다.

### B. Live skeleton 정확도

- exact-paired teacher-valid frame만 분모에 포함한다.
- evaluation contract의 validity 생성 규칙/split/threshold hash가 P0 값과 다르거나 실제 validity mask hash가 P1 값과 다르면 run을 실패 처리한다.
- 지표:
  - 2D PCK/AUC와 reprojection error
  - root-relative N-MPJPE
  - PA-MPJPE
  - major-bone direction angular error
  - local rotation geodesic error
  - elbow/knee hinge error
  - root yaw error
  - left/right swap ratio
  - velocity/acceleration/jerk error
  - presence precision/recall/F1
  - occlusion hold/reacquire latency
  - hand observable-frame coverage
- axis/unit/camera audit 전에는 absolute MPJPE를 hard gate로 쓰지 않는다.

### C. Retarget 및 최종 avatar 정확도

- live와 teacher를 동일한 canonical pose→RigProfile→FK/IK 구현에 통과시킨다.
- source와 output을 독립적으로 정규화하지 않는다. 하나의 teacher-derived shared transform을 양쪽에 적용한다.
- raw camera/root-space 결과와 shared root-aligned 결과를 모두 병기하여 root/scale 오류를 숨기지 않는다.
- 지표:
  - parent-local bone quaternion geodesic error
  - avatar-height-normalized FK joint/end-effector error
  - root yaw/translation trajectory
  - palm/foot normal
  - contact F1 및 planted-foot slide
  - 렌더된 avatar keypoint reprojection
  - rig별 worst-case와 variance
- final report는 skeleton error와 retarget error를 별도 표로 제공한다.

### D. 실시간 성능

- target device의 headful 브라우저에서 측정한다.
- 모든 capture callback, inference, solve, retarget, bone-apply timestamp는 `performance.timeOrigin + performance.now()` 기반 단일 monotonic clock으로 변환한다.
- 파일 입력의 media PTS는 rVFC callback에서 monotonic clock과 anchor pair를 만들고, camera 입력은 capture callback monotonic timestamp를 사용한다. clock mapping residual도 report에 기록한다.
- 지표:
  - input/callback/processed/render FPS
  - producer replacement, queue depth, overload/stale drop ratio
  - pose/hand/face inference p50/p95
  - solver/retarget/render p50/p95
  - capture/source PTS→avatar applied p50/p95
  - smoothing이 추가한 temporal lag
  - memory와 10분 sustained-run degradation
- headless CPU 및 느린 playback 결과는 기능 회귀용으로만 사용하고 제품 성능 gate로 사용하지 않는다.
- 60fps 입력을 의도적으로 30Hz cadence로 처리할 때 생기는 cadence skip은 drop으로 보지 않는다. queue overload, stale callback, deadline miss만 drop gate의 분모에 포함한다.

### E. 라벨·분모 정의

- manual evaluation window coverage:
  - frozen manifest에 선언된 required window들의 합집합 안에서 decode 가능한 exact source PTS 수를 분모로 한다.
  - 동일 PTS에 요구된 scenario/presence/occlusion/contact/hand-observability label이 모두 존재하는 수를 분자로 한다.
  - teacher-invalid 여부는 label coverage 분모를 줄이지 않는다. decode 불가 frame만 machine-readable reason과 함께 제외할 수 있다.
- contact ground truth:
  - exact PTS 기준으로 좌/우 발을 각각 `planted | moving | unknown`으로 수동 라벨한다.
  - 각 발·각 클래스에 최소 100 teacher-valid frame이 있어야 contact F1을 hard gate로 계산한다.
  - `unknown`과 foot-out-of-frame은 분모에서 제외하되 coverage를 별도로 표시한다.
- presence:
  - clip별 present/absent F1을 먼저 계산한 뒤 clip macro-average를 최종 presence F1로 사용한다.
  - absent label이 없는 clip은 macro 분모에서 제외하고 label coverage를 실패 조건과 함께 표시한다.
- reacquire event:
  - 최소 200ms의 absent 또는 unreliable interval 뒤 첫 teacher-valid present frame을 시작점으로 한다.
  - presence가 true이고 major-bone angular error ≤30°인 상태가 3개 연속 processed frame 유지되는 첫 frame을 종료점으로 한다.
  - 시작 PTS부터 종료 PTS까지를 reacquire latency로 측정한다.
- endpoint:
  - left/right wrist, left/right ankle, head를 각각 독립 지표로 계산한다.
  - 해당 endpoint가 teacher-observable이고 exact-paired live/avatar state가 있는 frame만 분모에 포함한다.
  - endpoint별 coverage가 90% 미만이면 해당 endpoint gate는 실패한다.
- memory:
  - Chrome DevTools Protocol 또는 동등한 retained-heap 측정으로 2분 warmup 뒤 8분 steady window를 평가한다.
  - GC 후 retained-heap 선형 증가율 ≤1MiB/min, 종료 retained heap ≤post-warmup 기준의 110%를 모두 만족해야 한다.
- confidence/update strength:
  - canonical joint confidence는 `[0,1]`로 정규화하고 bone confidence는 해당 source joint confidence의 최솟값으로 계산한다.
  - `boneConfidence < 0.5`를 low-confidence로 정의한다.
  - 실제 적용된 quaternion/translation update의 effective blend alpha `≥0.95`를 full-strength update로 정의한다.
  - confidence와 effective alpha는 실제 적용 경로에서 frame/bone별로 기록한다.

## 최종 목표 스펙/성능

### 필수 데이터·평가 기준

- 7개 paired clip의 manual evaluation window coverage ≥95%.
- teacher-valid frame의 `clipId + sourcePtsUs + loopEpoch` mismatch 0.
- duplicate frame ID 0, silent frame deletion 0.
- 모든 miss/fallback/absent/occluded 제외에 machine-readable reason 존재.
- teacher-valid 생성 규칙/split/threshold hash가 P0 값과 일치하고 실제 mask hash가 P1 값과 일치.
- train/dev/test는 frame이 아니라 clip/session/person 단위로 분리.
- 전체 `jujae.mp4`는 teacher가 생성되기 전까지 paired accuracy 분모에서 제외하고 그 사실을 report에 표시.

### 필수 skeleton 품질 기준

- frozen held-out teacher-valid set에서:
  - aggregate major-bone angular p95 ≤20°.
  - 각 challenge clip major-bone angular p95 ≤30°.
  - aggregate hinge-flex p95 ≤25°.
  - root-yaw p95 ≤15°.
  - side-swap ratio ≤0.5%.
  - root-relative N-MPJPE와 PA-MPJPE가 각각 frozen baseline 대비 ≥30% 개선.
  - clip macro presence F1 ≥0.95.
  - occlusion 후 stable reacquire ≤150ms.
  - teacher-observable hand frame의 live hand coverage ≥90%.
- 평균이 개선되어도 어떤 challenge scenario의 p95가 baseline보다 10% 초과 악화되면 실패한다.

### 필수 avatar 품질 기준

- same-rig live-driven avatar vs SAM-driven avatar:
  - major local-bone quaternion geodesic p95 ≤20°.
  - left/right wrist, left/right ankle, head 각각의 endpoint p95 ≤avatar height의 4%, 각 coverage ≥90%.
  - root-yaw p95 ≤15°.
  - palm-normal dot p5 ≥0.9, 고신뢰 palm inversion 0.
  - 좌/우 발 macro contact F1 ≥0.9.
  - planted-foot slide speed p95 ≤avatar height의 1%/s.
  - low-confidence full-strength bone update 0.
- Xbot, Soldier, Polydancer VRM에서 모두 통과해야 하며 평균으로 rig 실패를 숨기지 않는다.

### 필수 실시간 성능 기준

- 현재 Mac/지원 Chrome의 headful GPU/worker profile:
  - body pose output ≥min(sourceHz, 30Hz).
  - avatar render ≥60fps.
  - capture/source PTS→avatar applied p95 ≤80ms.
  - queue depth ≤1.
  - intentional cadence skip을 제외한 steady-state overload/stale drop ≤5%.
  - pose solver p95 ≤2ms.
  - retarget solver p95 ≤2ms.
  - 10분 sustained run에서 crash 0, GC 후 retained-heap 증가율 ≤1MiB/min, 종료 retained heap ≤post-warmup의 110%, p95 latency 악화 ≤15%.
- GPU가 지원되지 않는 fallback profile은 별도 report를 제공하되 GPU profile의 통과를 대체하지 않는다.

### 회귀 방지 기준

- `npm run check` 통과.
- `git diff --check` 통과.
- 24/30/59.94/60fps, seek, loop, replay, mirror, absent, multi-person, hand-out, occlusion, non-identity rest rig 테스트 통과.
- 기존 camera/video upload, skeleton overlay, face tracking, GLB/VRM load, spring-bone path가 깨지지 않는다.
- 기존 report consumer를 위해 versioned migration 또는 backward-compatible reader가 존재한다.
- validation score는 실제 production 적용값에서 계산하며 self-referential 지표는 이름과 역할을 명시하고 최종 정확도 gate로 사용하지 않는다.

### 산출물

- `GOAL_PLAN.md`와 진행 로그.
- CanonicalPoseFrame v2 및 FramePacket 계약 문서.
- versioned teacher manifest/validity schema와 adapter.
- 실제 avatar state recorder 및 4계층 evaluator.
- 실시간 worker/frame-pump 개선 코드.
- RigProfile, full-frame FK/IK/contact/temporal 개선 코드.
- 필요한 경우 causal residual student의 학습 설정, split manifest, export artifact hash, runtime adapter.
- synthetic/unit/contract/browser/clip matrix tests.
- frozen baseline report와 final report.
- 최종 report에는 기준별 pass/fail, 실행 명령, 환경, commit SHA, artifact 경로, 미해결 위험을 포함한다.

## 독립 검증 정책

- 최종 완료 선언 전 독립 검증 필요 여부:
  - 필수.
- 권장 검증 주체/환경:
  - 구현에 참여하지 않은 별도 subagent가 diff, plan, report를 read-only 검토한다.
  - 별도의 clean worktree 또는 임시 clean copy에서 tracked code/tests를 재실행한다.
  - ignored teacher/video/model asset은 SHA manifest로 검증한 뒤 read-only로 연결한다.
- 독립 검증자가 확인할 기준:
  - P0~P8 단계 완료 조건과 최종 필수 기준 전부.
  - evaluator가 production과 같은 canonical/retarget 코드를 사용하는지.
  - exact PTS와 teacher validity 분모가 조작되지 않았는지.
  - train/test leakage가 없는지.
  - partial/timeout matrix cell을 통과로 처리하지 않았는지.
  - 실시간 측정이 headful target profile에서 재생성됐는지.
  - 사용자 untracked 파일과 unrelated 변경이 범위에 섞이지 않았는지.
- 독립 검증이 불가능할 때의 대체 검증:
  - 불가능 이유를 진행 로그에 기록한다.
  - clean copy에서 dependency install/build/check를 다시 수행한다.
  - frozen manifest의 일부 cell을 원본 입력부터 재생성하여 report 재현성을 확인한다.
  - primary run과 별도 process/browser profile로 핵심 기준을 재측정한다.
- 최종 보고에 포함할 증거:
  - 실행 명령과 exit code/결과 요약
  - 대상 장치/browser/delegate/model/config
  - 기준선과 최종 report 경로
  - 모든 completion criterion의 pass/fail 표
  - independent verifier 결과
  - 남은 위험과 범위 밖 항목

## 성능 목표 상향 정책

- 사용자 동의 여부: **아니오로 간주**.
- 필수 목표를 모두 달성한 뒤 추가 상향 라운드를 수행하지 않고 종료한다.
- 사용자가 명시적으로 허용하기 전에는 목표 수치 상향, 기능 범위 확대, 추가 모델 탐색을 하지 않는다.

## 중단/질문 조건

- 다음 경우에는 무리하게 우회하지 말고 근거와 선택지를 사용자에게 보고한다.
  - destructive git 작업, 외부 push/PR/deploy, 유료 서비스, credential 또는 추가 권한이 필요함.
  - 외부 모델·데이터의 라이선스가 불명확하거나 다운로드 승인이 필요함.
  - teacher-valid coverage가 기준 미만이라 해당 metric을 정직하게 평가할 수 없음.
  - target hardware에서 3개 이상의 통제된 구성으로 측정했는데도 성능 gate가 물리적으로 불가능하다는 증거가 있음.
  - 최종 목표를 위해 공개 API/recording format의 승인되지 않은 breaking change가 필요함.
  - 현재 sample domain을 넘어선 production 일반화 claim에 추가 인물·환경 teacher corpus가 필수임.
  - 사용자 입력이 필요한 실제 카메라 검증을 sample/headful 자동화로 대체할 수 없음.
- 단순히 구현이 어렵거나 오래 걸린다는 이유로 중단하지 않는다. 안전하고 범위 내인 수정-검증 루프는 계속한다.

## 진행 로그 규칙

- 각 체크포인트마다 다음을 짧게 기록한다.
  - 현재 단계
  - 변경 파일/설계 결정
  - 실행한 검증과 결과
  - 기준선 대비 수치
  - 남은 일
  - blocker 여부
- 단계별 검증 실패 시 원인을 분해하고 수정-검증 루프를 반복한다.
- 장시간 benchmark 또는 학습은 중간 artifact와 재개 방법을 기록한다.
- 부분 실행, timeout, skipped cell은 명시하고 통과로 계산하지 않는다.
- final에는 모든 최종 완료 기준을 pass/fail 표로 다시 판정한다.

## 현재 진행 로그

- 2026-07-10 계획 작성:
  - 앞선 repository/SAM/runtime/retarget/evaluator 분석을 durable goal plan으로 변환했다.
  - 기존 완료된 root-yaw goal 내용을 이번 목표로 교체했다.
  - target runtime은 Codex로 확정했다.
  - 자율 성능 목표 상향은 비활성화했다.
  - 독립 계획 검토의 2회 보완 요청을 반영했고 최종 PASS를 받았다.
  - 실제 teacher-valid mask는 P1 산출 직후 동결하도록 P0 규칙 hash와 분리했다.
  - manual coverage, contact/presence/reacquire/endpoint, confidence/full-strength, latency clock, memory 분모를 수치로 확정했다.
- 2026-07-10 P0 시작:
  - Codex goal thread `019f48d8-0c9a-7000-b1c8-346b6847b421`을 활성화했다.
  - `codex/sam-avatar-closed-loop` 브랜치를 생성했다.
  - implementation-orchestrator run `run-20260710T011551Z-369ad8`을 초기화했다.
  - strict dispatch/isolation 검증을 통과한 `baseline-harness@r2`와 `evaluation-contract@r2`를 독립 worker에 병렬 배정했다.
  - 변경 전 `npm run check`를 재실행해 전체 기존 contract/synthetic suite 통과를 확인했다.
  - target-device preflight를 기록했다: macOS 26.5.1, arm64 Apple M1 Max 32-core GPU, Chrome 150.0.7871.114, Node 22.17.0, npm 10.9.2.
  - 첫 worker 시도 2개는 장시간 설계만 수행하고 owned artifact/test를 만들지 못해 중단했으며, orchestrator에 failed evidence를 기록했다.
  - `baseline-harness`는 동일한 strict-valid spec으로 재배정했다.
  - 과도하게 넓었던 `evaluation-contract`는 폐기하고, generic contract/schema/audit engine과 실제 manual label-pack curation을 순차 모듈로 분리했다.
  - 분리된 `evaluation-contract-core@r1`과 `baseline-harness@r3`를 strict dispatch/isolation 재검증 후 새 worker에 배정했다.
  - 재배정 worker도 owned artifact를 만들지 않아 두 unit에 parent-local exception을 기록하고 동일 acceptance contract 아래 직접 구현했다.
  - `baseline-harness@r4`를 완료·수용했다. 실제 repository dry-run은 7 paired clip × 3 rig = 21 cell과 full `jujae` unpaired를 고정했고, media/SAM/model/runtime/content hash와 exact command를 기록한다.
  - baseline completeness는 JSONL header↔physical row, live final source PTS ≥ source duration의 90%, teacher raw↔summary↔adapter frame 수, comparison live pairing ≥95%를 교차 검증한다. delayed 1-frame, adapter truncation, stale output, skipped, timeout, delegate/worker fallback, hash drift 공격 test를 통과했다.
  - baseline focused test, 실제 21-cell dry-run, Draft 2020-12 schema, `npm run check`, `git diff --check`가 통과했고 독립 검토에서 BH-1~BH-5 PASS를 받았다.
  - `evaluation-contract-core@r2`를 완료·수용했다. contract canonical hash는 `c08e496b0ee7bfdb5608d35f9eebe054247a68ff85c13fcd4395e86951c362b9`, label schema hash는 `84cb26c912aa26ab0544259693f26c58698881c7cd13b8095042890311a78494`로 고정했다.
  - 7,007-row audit는 clip별 manual coverage ≥95%, foot/class별 teacher-valid observable contact ≥100, exact PTS/loop/timebase, split isolation, denominator, closed teacher input/threshold allowlist를 검증한다. global-average coverage 우회, frame+interval 모호성, metric self-rehash, schema-invalid window/decode reason, fully rehashed `studentLossMax` 공격을 독립 검토 과정에서 차단했다.
  - evaluation focused suite, 42,031개 generated artifact의 Draft 2020-12 검증, 기존 전체 suite, diff check가 통과했고 독립 검토에서 ECC-1~ECC-7 PASS를 받았다.
  - `source-pts-manifest@r2`를 완료·수용했다. 실제 ffprobe `v:0`의 `best_effort_timestamp`와 selected-stream time base를 그대로 사용해 7개 paired source의 정확한 6,711행을 동결했고, full `jujae` 2,189행은 inventory에만 기록하여 paired 분모에서 제외했다.
  - decoder manifest byte hash는 `d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79`, order-sensitive canonical hash는 `dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d`, source inventory canonical hash는 `b93060d968c9e280de3ec320cfc834e49e7072e2a82af086fe4c711dde0186ba`다.
  - accepted contract/schema 해시 pin, exact ffprobe argv, `BigInt` PTS, 23.920/59.940 rational time base, 비-0 시작 PTS, stream/time-base mismatch, row 삭제·재정렬, physical/semantic drift, source TOCTOU, 두 산출물 commit rollback을 포함한 focused 70개 공격 검사가 통과했다.
  - 모든 source는 자기 probe 전후뿐 아니라 전체 probe 종료, build 종료, staged commit 직전에 다시 해시 검증한다. 실제 fresh `--check`는 6,711행, drift 0, 70.38초, 최대 RSS 약 257MB로 통과했고 모든 행이 Draft 2020-12 schema에 유효했다.
  - orchestrator가 discarded dependency r1과 accepted r2를 revision-aware하게 구분하지 못해 lease가 불가능한 문제는 `tool_unavailable` parent-local exception `lex-3e2e75efa9`로 기록했다. 독립 최종 검토에서 SPM-1~SPM-6 전부 PASS를 받은 뒤 수용했다.
  - 실제 manual/P1 설계 사전검토에서 r2 source inventory가 evaluation-contract hash를 포함하고, 새 evaluation contract가 다시 source inventory hash를 고정하면 순환 identity가 된다는 결함을 발견했다. 수치 자체가 맞더라도 평가 계약을 갱신할 수 없는 구조이므로 accepted r2를 그대로 최종 기반으로 사용하지 않고 source-only revision으로 supersede했다.
  - `source-pts-manifest@r4`를 완료·수용했다. standalone source contract hash는 `39b8e1742f9be749dc34e1130b4395bb993a922374ac687b4fdd0f296be09873`, Draft 2020-12 source schema hash는 `ffc7bd71da31c07781b65e9579ed29e9b47cd3b2229b39c7b4df8e841e6a9244`, source-only inventory hash는 `64ea4c592e4a35f8c7483e33824ef2755cd1c35af77e0f631e9b9ad7f3243d8d`로 동결했다.
  - evaluation/label/teacher/role/split/live/student/avatar 의존성을 source CLI·contract·schema·inventory에서 제거했고, decoder 6,711행의 물리 SHA `d300ac13f9386293f8f1abe746bb64a3ac99f7bd942813286b550375e201cb79`와 ordered canonical SHA `dde8d9e02fa82341986e535ccf378d4ad555aefaf88d0a27531187db1afecd4d`는 byte-for-byte 유지했다.
  - source-only focused 82개 공격 검사, 실제 `--check` 6,711행 drift 0, contract/inventory/전체 decoder Draft 2020-12 검증, 기존 전체 suite와 diff check가 통과했고 독립 검토에서 SIC-1~SIC-6 PASS를 받았다.
  - `evaluation-contract-hardening@r1`을 완료·수용했다. 최종 v2 contract canonical hash는 `7a7f26a4734d0c971ecc2bef542dd05da11d67134478a2db286e1cd242bb5897`, Draft 2020-12 schema hash는 `38759400e1e5aacb1b06bf3b052a5af8f693366dfa93653d0520280723c8e146`다.
  - v2 계약은 7개 source 전체 6,711행을 P0 manual denominator로 고정하고, subject selection을 SAM 후보 수와 분리하며, 두 독립 raw review pass에 subject state/target/anchor까지 포함한다. label·subject의 모든 불일치는 exact field path로 adjudication하고 최종 artifact와 일치해야 한다.
  - P0 생성은 self-hash만으로 pass/frozen을 주장하지 못하며, 별도 호출의 외부 `--expected-p0-lock-sha256`가 정확히 일치할 때만 검증된다. P1은 같은 외부 P0 parent와 teacher-mask byte hash를 결속한다. 경로만 잠근 manifest, 완전 재해시 semantic tamper, parent 재작성 공격이 모두 실패한다.
  - 현재 SAM에 native joint confidence가 없다는 사실을 exclusion으로 악용하지 않도록 모든 teacher row에서 `confidenceAvailable=false`, `jointConfidenceSource=unavailable`, calibration false, warning 기록을 강제했다. geometry/manual torso·limb observability가 통과하면 full-body와 per-foot contact scope는 유지할 수 있다.
  - 첫 독립 실행에서 contract/schema pin drift를 발견해 재고정했고, 이후 독립 최종 검토에서 raw pass가 subject transition을 담지 못하는 결함과 focused test가 회당 약 0.9GiB 임시 패키지를 남기는 결함을 발견했다. 기준을 낮추지 않고 schema/auditor/test를 확장했으며, 기존 누적 임시 디렉터리 11개 약 7GiB를 제거했다.
  - 최종 focused suite는 64개 공격 검사, exact decoder 6,711행, Draft 2020-12 대표 artifact 7,000행, materialized pack 40,266행을 검증했다. 성공·의도적 실패 cleanup probe 모두 residue 0이고, `npm run check`, syntax, `git diff --check`, strict scope/isolation이 통과했다. 독립 검토에서 ECH-1~ECH-7 전부 PASS를 받았다.
  - P2~P4 선행 read-only 감사에서 현재 `MotionFrame v1`이 mutable reference와 모호한 timestamp를 사용하고 rVFC의 `mediaTime/presentedFrames`를 버리며, seek/loop exact identity와 unified monotonic clock이 없음을 확인했다. production과 offline이 서로 다른 mirror/axis/depth 변환을 사용하고, comparator는 nearest/offset pair를 재사용할 수 있어 현 report는 exact closed-loop gate가 아니다.
  - 현재 frame pump는 inference가 끝난 뒤에야 다음 rVFC/rAF를 등록해 producer/consumer가 실제로 분리되지 않는다. pending latest frame의 원 timestamp도 drain 시 버리고, worker는 opt-in인데 main detector를 먼저 eager-load하며, full-resolution `getImageData`와 body/hand/face 동일 cadence를 유지한다. capture-to-applied/render·queue residency·cadence skip·retained heap telemetry가 없어 P4 gate를 증명할 수 없다.
  - P5~P6 선행 read-only 감사에서 strict `localRotation`이 진단값일 뿐 실제 bone에는 다시 direction aim이 적용됨을 확인했다. VRM fallback은 하나의 physical node를 여러 spine 채널에 중복 매핑할 수 있고, source endpoint를 rig 길이에 맞춰 변형하며, applied local quaternion/FK telemetry가 없다.
  - pelvis/root SE(3), contact FSM, ground solve, planted-foot lock, two-bone residual IK는 production에 없고, strict body/hand update는 confidence/stabilization을 우회할 수 있다. hand finger는 full 3D frame이 아니며 face target은 body head pose와 합성되지 않고 rest 기준으로 덮어쓴다. 따라서 P2/P3 계약·actual-state recorder를 먼저 만든 뒤 RigProfile→full-frame FK→unique apply→temporal/contact/IK 순서로 구현한다.
  - 실제 P1 입력 사전감사에서 기존 MHR70 adapter가 SAM miss frame을 삭제하고 첫 person만 선택하며, detector score를 모든 joint visibility로 복제하고, MHR127·bbox·camera translation·global rotation을 버리는 것을 확인했다. raw `timestamp_sec`도 exact PTS가 아니며 `arms-crossed` 전체 행에서 decoder PTS보다 정확히 33.333ms 앞선다. 따라서 기존 recording adapter 출력은 Dataset v2 또는 teacher-valid mask의 원본으로 사용할 수 없다.
  - 7개 SAM raw JSONL은 decoder와 행 수/순서가 6,711개로 일치하고 모든 person record가 MHR70 2D/3D 70점과 MHR joint 127점을 가진다. 다만 custom extractor code, SAM checkpoint, MHR asset, detector weight의 실제 bytes는 repository에 없어 summary의 경로/config와 결과 asset hash만 검증 가능하며, 없는 provenance를 현재 upstream download로 대체해 검증됐다고 주장하지 않는다.
  - P1 설계를 통해 accepted `evaluation-contract-hardening@r1`의 추가 근본 결함을 발견했다. teacher mask auditor는 producer가 쓴 geometry/temporal boolean을 원본 SAM 좌표에서 재계산하지 않고, finite/basis/reprojection/bone/scale/speed/gap 및 manual-anchor→candidate 선택 수치도 P0 contract hash에 존재하지 않는다. 또한 P1 parent가 write-once 외부 P0 anchor hash가 아니라 mutable pack 내부 candidate hash다. 이 상태에서는 전면 재해시한 임의 mask와 parent substitution을 폐쇄할 수 없다.
  - 실제 manual/P0 pack을 만들기 전에 historical `evaluation-v2`를 읽기 전용으로 보존하고, 격리된 `evaluation-v3`를 소유하는 `teacher-contract-hardening@r2`로 teacher policy/schema를 별도 self-hash해 P0 descriptor에 포함한다. exact raw-line↔decoder binding, all-person lossless Dataset v2, detector-score/confidence 분리, 수치화된 projection/basis/bone/scale/speed/gap policy, per-scope reason, 외부 P0/P1 anchor 결속을 추가하며 기존 manual/contact/reacquire gate는 유지하거나 강화한다. 기존 v2 hash는 이 발견의 historical evidence로만 남기고 최종 P0 rule hash로 사용하지 않는다.
  - `manual-pack-compiler@r2` synthetic infrastructure를 완료·수용했다. authoring schema canonical hash는 `a04ce78643a98be6e550b15654317c9ec8f1678c8afa3f332e11cdf2014f69ef`, external P0 anchor schema hash는 `5b74dfb7fcef0c5ba4f3b550181dde59d69b2a22765c1abb76f27838109b7c5a`다. review/adjudication/decoder/anchor는 byte hash와 canonical hash를 같은 단일 Buffer snapshot에서 계산한다.
  - 첫 독립 검토에서 정상 예외 test가 잡지 못한 두 MPC-4 결함을 실제로 재현했다. rename/link 직전 SIGTERM은 sibling temp를 남겼고, existence check 직후 경쟁자가 만든 빈 destination을 일반 `renameSync`가 교체했다. 이를 수용하지 않고 auditor/helper를 async child로 전환하고 등록 temp·child의 SIGINT/SIGTERM cleanup을 추가했으며, macOS `/usr/bin/python3`의 `renameatx_np(RENAME_EXCL)`만 허용하고 일반 rename fallback을 제거했다.
  - 수정 후 focused 52개 공격 검사는 compile/create-anchor 실제 child SIGINT 130·SIGTERM 143, post-precheck competitor race의 directory/marker inode·bytes 보존, fake PATH python shadow, single-read guard, scenario-only fail-closed, exact 6,711행/pass, Draft 2020-12 7,000행, residue 0을 통과했다. synthetic candidate hash `b34b92cb922417f7dc60f80ba519395d9feb68fef3ed65f557e0e946056905a3`, artifact-set hash `f55158682338e9a65a4faa6c7cde9c8efd6630c26a20fdf478be896fd4a16485`, anchor hash `462e86713f33fcdc79c0e118fe04c60ab53df88ec185cfbc5de11d2f896d916d`는 수정 전후 동일하다. 독립 재검토 MPC-1~MPC-5 PASS와 `npm run check`·syntax·schema·diff PASS를 받았다.
  - r2는 실제 영상을 읽거나 real review/P0를 만들지 않은 compiler/anchor 메커니즘만 수용한 것이다. scenario-only 차이는 upstream compiled row가 evidence를 담을 수 없어 현재 명시적으로 실패하며, teacher numeric policy·외부 phase parent·scenario row를 추가한 contract와 compiler r3 없이는 실제 P0 생성이 계속 차단된다.
  - teacher contract의 독립 사전검토를 반영해 실제 P0와 downstream compiler r3의 경계를 명시했다. compiler r2는 새 descriptor/scenario/external-parent 형식을 생성할 수 없는 historical infrastructure이며, r3가 수용되기 전에는 real review validation·compile·anchor 생성을 허용하지 않는다.
  - 추가 공격 검토에서 P1 source manifest만으로 raw teacher를 잠그면 P0 이후 P1 materialization 직전까지 정답 원본을 교체할 수 있고, P0 완료 조건의 teacher SHA에도 미달함을 발견했다. 이를 막기 위해 `teacher-contract-hardening@r2`가 7개 clip의 raw JSONL·metadata·summary byte/canonical hash를 담는 standalone `teacher-input-inventory.json`을 만들고 P0 contract/manifest/external anchor에 결속하도록 spec을 강화했다. P1 Dataset/source manifest는 이 P0 inventory를 byte-for-byte 재검증해야 한다.
  - Dataset v2는 6,711개 원본 JSON physical line을 base64로 보존해 key order, numeric lexeme, null/missing, person order까지 복원하고, exact decoder rational PTS를 별도 identity로 둔다. 다중 인물 선택은 모든 후보의 usable bbox가 있어야 수동 normalized anchor로 유일성을 증명할 수 있으며, detector score는 선택·joint confidence에 사용하지 않는다.
  - geometry/temporal validity는 원본 좌표에서 auditor가 다시 계산한다. projection 0.01px, segment 0.02~1.0m, torso cross, camera/focal/in-frame, clip scale, adjacent scale/root/joint speed, exact gap을 P0 policy hash로 고정했고, nonfinite predecessor는 `temporal_reference_unavailable`로 fail-closed 처리하도록 보완했다. `teacher-contract-hardening@r2` 최신 설계 spec SHA는 `9936945db7de02ce563859d7763e0ce07ee2dbc363802a54fb6684dff33e7a4c`이며 독립 검증, strict dispatch, interface completeness, historical-v2 scope isolation을 통과했다. 구현·독립 수용과 compiler r3가 끝날 때까지 실제 P0는 계속 차단되어 있다.
  - 새 계약이 accepted historical v2 파일을 덮어쓰는 최초 draft는 scope-isolation 실패로 폐기했다. v3 owned/public path, v2 read-only dependency, `teacher-contract-hardening@r2 -> manual-pack-compiler@r3 -> evaluation-v3`의 명시적 migration으로 재설계해 평가 이력과 새 rule hash의 소유권을 분리했다.
  - compiler r3 최초 분리 설계 spec SHA `c92ff27a17d7f445244729be49abbc3904ac2d8d635149ee9a85211f7ea36879`는 독립 검증에서 REVISE했다. teacher의 기계식 gate는 정확히 `manual-pack-compiler@r3 accepted`인데 spec이 별도 `manual-pack-compiler-v3@r1`을 사용해 acceptance가 gate를 만족하지 못했고, public authoring schema도 source/clip/interval/window/disagreement/decision/value의 정확한 필드·enum·nullability와 compiled row 매핑을 닫지 않아 worker가 API를 발명할 여지가 있었다. 수정 spec은 `manual-pack-compiler@r3`, `supersedes:"r2"`, SHA `32cbe52b4c977b7d8ba0ed35fe89f8a8416ce7213ebc7cadb147a24e3d833e14`다. 47개 `$defs`/133개 `$ref`, 17개 closed object, 14개 typed disagreement branch, A/B canonical·byte·pseudonym 결속, 7 source/6,711 decoder identity, exact frame-span PTS, 9 compiled files/20 descriptor 및 current teacher `reviewState`/`disagreementFields` 매핑을 완전히 고정했다. 독립 Draft/custom/schema/decoder/P0-anchor/atomic-DAG 검증은 blocker 0으로 PASS했다. 단, 이 PASS는 정적 설계 판정이며 `teacher-contract-hardening@r2` accepted 후 interface hash를 재확인하기 전에는 등록·dispatch·real P0를 모두 차단한다.
  - teacher r2 accepted 후 등록 점검에서 orchestrator가 동일 module id의 여러 active revision을 금지하고 inactive/superseded dependency를 dispatch에서 거부하므로, r3가 supersede할 자기 r2를 live dependency로 동시에 소비할 수 없는 상태모델 충돌을 발견했다. registration-ready spec은 module/revision/gate와 모든 authoring/compiled 계약을 유지하면서 self-r2 dependency/interface edge만 제거하고, r2 authoring schema `1e2c74a4...`, P0 schema `5fb22bf9...`, compiler bytes `6f0b54dd...` 및 blind/atomic/anchor/signal behavior를 immutable read-only regression evidence로 고정했다. 새 SHA는 `49f5fc90280df69fd078b166cbc53409c3c649e6f0fdd3d3d9cfab472f6349bc`, 74,073 bytes다. 독립 검증은 47 defs/133 refs/17 closed objects/14 branches/6,711 rows/9 files/20 descriptors와 state simulation을 PASS했다. r2는 `accepted + superseded_by=r3` 이력으로 보존하고 r3만 active `ready/supersedes=r2`로 원자 등록했으며 strict/isolation 오류 0이다. orchestrator `dependency_ready`가 explicit revision을 무시하는 기존 결함 때문에 공식 lease가 false를 반환해, accepted explicit dependency와 scope를 재검증한 targeted lease workaround로 `attempt-73cf0244e7`/`manual-pack-compiler-r3-worker`를 기록·dispatch했다. 이 unit은 synthetic P0 infrastructure만 구현하며 real review/P0는 계속 금지한다.
  - 최종 metric과 teacher validity 분모를 대조해 torso/full-body/contact만으로는 wrist·ankle·head·palm gate를 정직하게 계산할 수 없음을 발견했다. revised contract는 torso, head, 좌우 arm/hand/leg, fullBody, calibration, 좌우 contact scope를 분리하고 각 scope의 joint union·manual observability·projection·in-frame·segment·temporal reason을 독립 재계산한다. contact→fullBody 상속은 기존 gate보다 약해지지 않게 유지하되, unrelated limb/head 오류가 다른 endpoint 분모를 오염시키지 못하게 한다.
  - contact transition은 frame 수가 아니라 exact rational PTS로 동결했다. 첫 lift/swing/들린 정지/안정 전 landing/slide/pivot은 moving이고, 첫 settled 후보부터 연속 관측 가능한 안정 지지의 PTS delta가 100ms 이상 확인될 때 그 첫 frame부터 planted로 소급한다. crop/occlusion/blur gap은 추론하지 않고 unknown이며, 두 reviewer에게 동일 규칙만 전달했다.
  - 원 계획의 raw teacher와 temporally refined teacher 동시 보존 조건도 P1 hash DAG에 추가했다. 5-frame 대칭 Savitzky-Golay `[-3,12,17,12,-3]/35`를 same-target·연속·동일 rational cadence window에서만 적용하고 joint 0.05m, camera 0.10m, reprojection 2px 및 구조 safety를 넘으면 frame 전체를 raw identity로 fallback한다. P1 target role은 `raw_hard_refined_watch`로 P0에서 고정해 live 성능을 본 뒤 refined target으로 바꾸지 못한다.
  - raw summary 교차검증에서 `csi-pose`는 `detection_misses=163`인데 zero-person row가 0인 모순을 발견했다. 실제 163개 row는 직전 row의 ordered detector score+bbox tuple이 exact 반복되고, 모든 clip에서 `zero-person + exact carry-forward + provenance-unavailable = summary detection_misses`가 정확히 성립한다(arms 37+0, csi 0+163, 나머지 0). 이를 score threshold가 아닌 P0-frozen detector provenance 규칙으로 만들고 carry-forward/miss row는 모든 teacher scope에서 제외한다. native per-frame event flag가 아니라 summary-reconciled inference라는 경고도 모든 row에 남긴다.
  - raw byte 감사에서 7개 `skeletons_mhr70.jsonl` 모두 `CR count == LF count == rowCount`, mixed/lone ending 0, 마지막 `0d0a`임을 확인했다. 최초 draft가 이를 LF로 기록하고 CR을 line payload에 남기는 의미 오류를 발견해 raw descriptor를 `CRLF`/`terminatorHex=0d0a`로 수정했다. `rawLineBase64`는 전체 CRLF를 제외하고 복원 시 각 row에 CRLF를 다시 붙여 원본 byte hash를 검증하며, generated Dataset/refined/mask는 별도 LF-only 계약이다. lone-LF/mixed/lone-CR/missing-terminal/payload-CR/generated-CRLF 공격을 필수화했고 독립 byte 재검증을 통과했다.
  - `teacher-contract-hardening@r2` 첫 구현은 자체 focused 119 checks·64 attacks, 6,711행/6,675 persons, 전체 회귀와 residue 0을 보고했지만 독립 결과 검토에서 수용을 거부했다. P1 inherited descriptor/tool이 P0 snapshot과 exact-equal하지 않고 재개방·재결속되는 문제, 저장소 밖 external anchor 거부, sealed-input 경로 추정, refined 상태/null 스키마, selected carry-forward raw-center hash, torso/frameScale 경계, scope-local temporal 오염, anchor TOCTOU와 불완전 attack oracle을 실제로 재현했다. 기준을 낮추지 않고 `revise_same_agent`로 반환했으며 real P0는 계속 금지한다.
  - 위 결함을 반영한 `teacher-contract-hardening@r2` authoritative 설계 SHA는 `619a4eef6266860522ec76f51ce841a1632bfbe1c391d6982b75ab0b683b35b0`이다. P0에서만 실제 review A/B/adjudication을 고정 logical role과 단일 snapshot으로 검증하고, P1은 독립 expected P0 anchor를 권위로 삼아 raw review를 재개방하지 않는다. P1 inherited bytes는 P0 descriptor/snapshot을 그대로 재사용하며, actual CLI path는 `process.cwd()` 기준, hash preimage·`-0`·oneOf 상태·scope별 diagnostic·phase별 inode/TOCTOU 행렬을 닫았다. attempt `attempt-70e30bfba7`은 focused 155 checks·85 catalog IDs를 통과했지만 독립 read-only 검토에서 세 차단점을 재현해 수용하지 않았다: auditor/synthetic schema가 실제 compiler-r3 v3 작성 타입 대신 v2 타입을 고정함, attack catalog의 expected error가 실행 오라클로 사용되지 않고 대부분 public full chain을 우회함, refined 외 Dataset/mask/source/P0/P1/anchor의 custom↔Python Draft valid/invalid 행렬이 없음. 동일 설계·기준 아래 `revise_same_agent` attempt `attempt-7cbe071241`로 반환했고 real P0는 계속 금지한다.
  - attempt `attempt-7cbe071241` 구현은 focused 160 checks, catalog 91, Dataset/refined/mask 각 6,711행·6,675 persons, Dataset/refined/mask/source/P0 pack+anchor/P1 pack+anchor/review/adjudication 10-family custom↔Python Draft matrix 58개(20 valid/38 invalid), `npm run check`를 독립 재실행에서도 PASS했다. 그러나 authoritative failure plan의 “모든 ECH2-7 semantic rehash를 public `runAudit`/CLI로 실행” 조건을 만족하지 않아 다시 REVISE했다. error 79개 중 71개가 helper-only였고 `cli:10/runAudit:2`는 실제 호출 계측이 아니라 catalog metadata 재집계였으며, scale+speed와 head+hand support는 각각 한 mutation으로 두 ID를 통과시켜 독립 oracle도 아니었다. 기준을 낮추지 않고 동일 설계의 targeted attempt `attempt-b5f0a80401`로 반환했다. 모든 semantic case를 1 mutation=1 case로 분리하고 attacker-controlled pack/lock/compiled-set/external-anchor/expected hash를 재봉인한 뒤 실제 public 경로에서 intended error까지 도달하게 하며, runtime-test 한정 snapshot hook과 실제 per-case path 계측을 추가한다. 이전 독립 suite 비용은 250.20초, OS maximum resident 약 2.20GB였고 real P0는 계속 금지한다.
  - targeted attempt `attempt-b5f0a80401`은 catalog를 96개로 확장해 실제 wrapper 계측 기준 `runAudit:86`, CLI 5, 순수 non-rehash selection helper 5로 분리했고 semantic/input/authority 84개 전부가 public `runAudit`을 정확히 한 번 지난다. 각 error는 exact first code와 비교하며 10-family custom↔Python Draft matrix 58개(20 valid/38 invalid)를 유지한다. raw number spelling/timestamp/person/key/null/MHR127/bbox/camera 공격은 `JSON.stringify` 재직렬화를 폐기하고 원본 raw byte의 단일 token/property/array만 수술적으로 바꾼 뒤 detector provenance·selection·warning을 다시 도출한다. refinement coefficient/result, false geometry flag, cross-scope reason, contact→fullBody, temporal-scope contamination, candidate-parent source/summary, duplicate descriptor set hash, post-P0 auditor/inherited-JSON Buffer reuse도 각각 독립 mutation으로 분리했다. test SHA `fb98b8087bc62d02c6bfb6702e918e0be357853d456136ea2fbd4be6d228b99f`, catalog SHA `c0360059fe462c9dd4877597642cff196580cb1beced1eca206f8ff6c1e8fdc5`, auditor SHA `38396bd4baea5618f20d9afd738b328497d06bf8bd5681bf4455df5232ada368`를 동결한 최종 run은 exit 0, 166 checks, 6,711행/6,675 persons, 96/96 attacks, 58 matrix, signal cleanup 2, residue 0으로 PASS했다. 외부 wall time 1,831.33초, OS max RSS 3,693,494,272 bytes, swap 0이었다. `npm run check`, baseline, v1, source-r4 82 checks, historical v2 64 checks, manual-r2 52 checks도 모두 PASS했다. same-agent WorkerResult SHA `83f8dc354b55bd40c1eb4f1bf5d2f86f2879fb6bc5215bbd554cda8059417655`와 독립 ACCEPT를 기록했고, orchestrator strict validation/isolation 오류 0으로 `teacher-contract-hardening@r2`를 공식 accepted 처리했다. real P0는 compiler r3 accepted 전까지 계속 금지한다.
  - 실제 Chrome 150 rVFC를 source 영상으로 검증한 결과 `metadata.mediaTime`은 정규화된 재생 시작 시간이 아니라 absolute container PTS에 직접 대응했다. `arms-crossed`의 currentTime 0.0001/0.02/0.034/0.05에서 모두 mediaTime=0.033333…으로 decoder f0 PTS 512/15360에 매핑되고, 0.067은 f1, 0.1은 f2였다. 따라서 P2 exact identity는 `absolute_source_pts_direct`로 고정하고 sourceFirstPts를 더하거나 빼는 보정, nearest/epsilon/offset은 금지한다.
  - 후보 A/B를 보지 않은 제3 판정자가 원본 영상만으로 presence/selection/contact/observability 경계를 고정한 뒤 accepted decoder manifest에서 exact PTS를 직접 조회했다. 비형식 source-only proposal은 `/tmp/action-tracker-adjudicator-proposal.md`, SHA `4b3cfa65af7505671d512a0e3478bb49196925419c7994c8b229d07a124a0f7a`로 봉인했고, 90개 interval의 양 끝 180개 `(sourceFrameIndex,ptsTicks)`를 manifest와 독립 대조해 mismatch 0을 확인했다. Reviewer A/B proposal SHA는 각각 `df254797787548cf4d5b719767b4f503b6d95be2d9a2df301f58a64b8f6102ca`, `220f570bf88b01b4df67044b35b68956b8dd077a5c70508107eba85573a794d8`로 유지된다. compiler r3 수용 전에는 이 세 파일을 formal authoring/P0 artifact로 승격하지 않는다.
  - 위 세 proposal을 freeze 후 비교한 비형식 reconciliation은 `/tmp/action-tracker-post-freeze-reconciliation.md`, SHA `64aaa0d05030b5778695b8fd276698e10d48753f554cd0803ceec9bab521440a`로 보존했다. 문서에 명시된 310개 구간 endpoint `(sourceFrameIndex,ptsTicks)`를 accepted decoder manifest와 다시 대조해 mismatch 0을 확인했다. 다섯 clip의 요청 구간에는 source-first 조정안이 있지만 `dance-16x9-padded`, `shorts-vc0GDveRIp0-16x9-padded`, 요청 범위 밖 frame과 일부 scenario/body/hand/person-state leaf는 third 미검증이다. A의 high-confidence-only 누락과 B의 unreviewed/unknown은 agreement가 아니라 missing coverage다. 따라서 기존 proposal을 형식 artifact로 변환하지 않고, v3 schema/compiler 수용 뒤 두 개의 새 decoder-complete blind pass와 별도 decoder-complete source-first adjudication을 수행한다. 보완 절차는 `/tmp/action-tracker-manual-p0-coverage-remediation.md`, SHA `59aabb4e9909dddcdb95f5d7304162b8cdecd30ec07a09f498e7b3cc15a34b3c`에 고정했다.
  - P2 parent 의미 계약은 native `performance-time-origin-v1`과 imported-stage-unavailable timing을 oneOf로 분리하고, imported HMR/v1의 원 capture/inference stage를 전부 null로 고정했다. opaque ID/clockNonce는 base64url decode→re-encode text equality를 요구하고, v1 exact binding은 결정적 sourceSessionId·seekGeneration·transitionReason·captureSequence·hashed frameId와 initial/contiguous/forward-seek/backward-seek/natural-loop 전이표를 결속한다. binding schema의 raw byte SHA와 r4 sorted-key semantic SHA도 분리했다. exact offline HMR은 실제 source-video SHA, strict complete `frame_index=i` decoder binding, no-person row 보존, two-pass input byte hash equality, bound/unbound source tuple과 deterministic session/frame identity를 요구하며 timestamp/FPS/output order는 권위가 아니다. 최종 부모 설계 SHA `5f4dac9742a87b1e1a6663d3c34382722c9d69179f4fe01fcda6f8cf6155212f`는 독립 PASS했고 `/tmp/action-tracker-p2-decomposition.md` SHA `6cff0bee2934cec872712b0bf199ed11b9d1420a4c2f71394cc8f283911f0cb7`로 네 비중복 DAG unit을 만들었다. 첫 child spec들(core `5dd1f5e4...`, canonical `49b1d2b0...`, adapters `edd679d9...`, production `3205f475...`)은 scope/DAG/MC2 추적성은 통과했지만 독립 검증에서 REVISE했다: shared schema에 CanonicalPoseFrame exact shape·zero-person branch가 없음, v1 migration→canonicalizer exactly-once handoff가 없음, existing HMR v1 CLI/default 회귀 계약이 없음, production accepted source-registry bootstrap surface가 없음. 네 spec에 exhaustive canonical `$defs`, atomic injected canonicalization handoff, explicit v1 surface, verified registry handle을 추가하고 있으며 teacher r2 + real external P0/P1 acceptance 전 register/lease 금지를 root phase gate로 고정한다.
  - P2 child 2차 수정 SHA(core `c0b1a143...`, canonical `e4b4fc4c...`, adapters `e8e9485c...`, production `1ee90799...`)는 22개 CanonicalPose `$defs`, available-3D/2D-only/zero-person/selected-unavailable branch, closed legacy request/context, public brand/hash verifier, exactly-once handoff, HMR v1 회귀를 닫았지만, core-owned HMR provenance schema와 registry-unavailable generic-file v2 branch가 빠져 독립 REVISE했다. 최종 수정 SHA는 core `24341bc79ceb3e09df43a9b1e4ff242382e9cafffb5ac646a4f3bfb092d7766a`, canonical `e4b4fc4cad130c7bf5effbf12782d1ba5495455575e4fcd59e1601472ad75098`, adapters `9449597a210f3661d932e68ef043e20dcb23736a3618f4ff9f481e1eb53a2438`, production `b2d9991eedc28b0995b6c8d7f0070a000c99db6135d09c421f9511a9c5c25f46`다. Core가 exact HMR frame/accepted-row/recording provenance 3 schema와 constructor를 소유하고 adapter는 그 public contract만 소비한다. `createSourceSession`은 camera/ready-file/unavailable-generic-file의 닫힌 3-way union이며 unavailable branch는 all-null accepted tuple, 단일 `accepted_source_registry_unavailable` reason, 별도 5-key report와 fresh-generation-only 승격을 고정한다. 독립 재검증은 두 blocker와 CanonicalPose22/legacy5/HMR-v1/DAG/scope/interface/MC2/gate/5종 테스트를 모두 PASS했고 새 blocker 0이다. 다만 teacher accepted만 충족됐고 real P0/P1 external anchor가 아직 없으므로 네 P2 unit 등록·lease·구현은 계속 금지다.
  - 실제 v3 blind-review 운영을 read-only 사전검토했다. formal `$defs.review`는 모든 state/scenario를 요구하므로 빈 review JSON에 `unknown`을 기본값으로 채우지 않고, 6,711 identity와 모든 truth leaf를 `UNSET`으로 둔 비권위 worksheet를 별도로 만든 뒤 미작성 0일 때만 formal review로 export한다. A/B 및 source-first C0 session은 7개 paired MP4·accepted source/decoder·동일 rulebook·자기 역할만 가진 deny-default bundle로 분리하고, counterpart/SAM/live/student/avatar/metric/prior proposal 접근은 금지·기록한다. raw A/B는 각각 6,711행, kappa floors, contact/head/hand support, reacquire를 adjudication 전에 검사하며 실패 시 sealed artifact를 수정하지 않고 사전선언한 새 revision만 허용한다. 오래된 remediation의 palm/finger/foot 별도 leaf 문구는 current closed v3 schema와 충돌하므로 사용하지 않고 `handObservability`, wrist/ankle/head endpoint, hand/foot/body occlusion과 contact만 권위 vocabulary로 쓴다. source-first C0 ledger와 bundle/access evidence는 P0 pack의 암호학적 권위인 것처럼 주장하지 않고 외부 write-once process evidence로 hash 동결하며, compiler/auditor/external P0 anchor가 계속 최종 authority다. 이를 자동화할 비권위 `manual-review-operations@r1` 설계를 준비하되 compiler r3 독립 accepted 전에는 real video review를 시작하지 않는다.
  - `manual-review-operations@r1` 정적 설계를 세 번의 수정·독립 검증으로 닫았다. 최종 spec은 `/tmp/manual-review-operations-v1-spec.json`, 116,997 bytes, SHA `199bce03db38359ecae674e88eba5778876772ae83bb4c54c2c8fcfb65887db6`이며 최종 독립 판정은 PASS다. A/B export receipt와 독립 expected hash, C0→raw report→reveal→handoff chain, base/overlay window UNSET, bundle-local sandbox runtime, post-validator same-buffer 재검증, directory/member와 single-file commit 규칙, downstream full re-proof, opaque compiler-validator stdout, segment/window C0 projection 및 닫힌 deviation matrix를 포함한다. formal compiler input은 review A·review B·adjudication 정확히 3개이고 process evidence는 `compilerInput=false`, `p0Authority=false`다. 다만 현재 `manual-pack-compiler@r3`가 running이므로 이 spec은 draft·unregistered·unleased 상태이며, r3 independent accepted 후에만 등록·구현한다.
  - `manual-pack-compiler@r3` 첫 구현 attempt `attempt-73cf0244e7`은 compiler `2c150197...`, normalized seal `cc9b742f...`, test `5cf8789c...`, authoring schema byte/canonical `90a5e27a...`/`c255cab6...`로 동결했고, 작업자 및 root 전용 격리 경로의 전체 focused suite가 각각 exit 0이었다. root 독립 run은 raw stdout 34,422 bytes/SHA `4cc3e582a45c4927033cb24ffd02fe1cc2010b474d44091d6bfb0e9ee83d030c`, 6,711행, 126 exact-first-code, 26 mutation race, 24 signal case, 자식 PID 소멸 및 residue 0을 재현했다. 그러나 독립 결과 검토에서 테스트가 놓친 네 차단 계열을 확인해 수용하지 않았다: presence와 무관한 `single_target_requires_selected_subject`가 present에만 제한됨, review clips accepted order 미검증, 명시적 third-valued final window 경계에서 mandatory membership split 누락, rename/link 뒤 실제 committed bytes와 sealed/context/pack을 닫지 않아 post-last-revalidation mutation이 성공할 수 있음. 오케스트레이터에 첫 WorkerResult SHA `56f515b16011e09201f77c6bbb30a5a50cac26e0adf1307ec350663dedf2d6db`를 완료 증거로 기록한 뒤 root `revise_same_agent` 판정을 남겼다. 동일 권위 spec/스키마/감사기/threshold를 유지하면서 semantic/order/final-segment/commit-closure 공격을 추가하고 새 compiler seal·candidate/set/anchor·전체 회귀를 재동결하기 전까지 real P0와 manual operations 등록은 계속 금지한다.
  - revision-2는 위 네 구현 결함을 모두 닫고 compiler `5eaddff0...`/normalized seal `dd0dab8b...`, test `40bedd82...`, WorkerResult `416291ad...`로 재동결했다. 작업자 full run과 root 독립 full run은 모두 exit 0이었고, root는 24 signal, 146 exact failure, 33 mutation case/36 race, residue 69, unchanged target 361과 candidate/set/anchor `632688d5...`/`8b2e0463...`/`504c198d...`를 재현했다. 하지만 독립 결과 검토에서 C 구현은 맞아도 acceptance oracle이 비공허하지 않음을 발견해 다시 수용을 거부했다. final window child segment는 내부 `finalSegments`에만 존재하고 durable per-frame 값은 원 segment와 같으므로, 수정 전 direct-fill 구현도 새 black-box window/row 검사를 통과할 수 있었다. A/B/D와 MPC3-1/2/4/5/6는 PASS로 유지하고, dual-gated test-only actual-finalSegments trace, 독립 trace 재계산, old-direct-fill self-consistent mutant negative control, 평시 stdout/9 files/anchor trace 부재 증거를 추가하는 targeted revision-3로 반환했다. 이 trace는 compiler input·durable output·P0 authority가 아니며, 새 seal과 전체 suite가 다시 독립 수용되기 전까지 real P0 금지는 유지한다.
  - targeted revision-3는 actual `finalSegments` 배열을 final frame map의 유일한 원천으로 만들고, `NODE_ENV=test`와 두 runtime-test gate가 모두 있을 때 compile 응답에만 비권위 trace를 노출했다. old-direct-fill self-consistent mutant는 candidate compile과 accepted auditor를 모두 통과하지만 독립 trace oracle에서 `63/6711/7db44d4f...`로 정확히 거부됐고, 정상 구현은 `67/6711/828e4ccf...`를 재현했다. 최종 동결값은 authoring schema byte/canonical `90a5e27a...`/`c255cab6...`, compiler byte/normalized seal `48656619...`/`f15853aa...`, test `3ffb52f7...`, 문서 `2a8eddc6...`, accepted auditor `38396bd4...`, corrected WorkerResult `b091d65f...`다. root 독립 full report는 42,608 bytes/SHA `9950251458a2f8827a2788cdb00f92a2bce2277d165e8e7582d042258b3fd8c8`, status `passed`였고 candidate/set/anchor `77efe412...`/`9f376fb7...`/`56f79038...`, alternate/third/aligned hashes, exact-first-code 158/`bc40643e...`, signal tuple 24/`13bf1a50...`(SIGINT 12x130, SIGTERM 12x143, child ESRCH 14/no-child 10), success `7/10/5/5`, failure `42/69/29/42`, mutation 33/races 36/residue 69/exact 153/unchanged 388을 모두 재현했다. tmp는 0, control은 빈 directory 62개와 file/link 0이었고 정확한 테스트 root를 identity 확인 후 제거했다. 독립 종합 검토에서 MPC3-1~7과 A/B/C/D blocker가 모두 닫혀 orchestrator root가 `manual-pack-compiler@r3`를 공식 accepted 처리했으며 strict dispatch/isolation 오류 0, accepted 7, open change request 0이다. 이 수용은 `manual-review-operations@r1` 등록·구현만 허가하며, operations 독립 수용과 새 decoder-complete blind A/B 및 source-first C0/C1 이전의 real P0 compile/anchor는 계속 금지한다.
  - `manual-review-operations@r2`를 구현·독립 수용했다. 최종 설계 SHA는 `d22a86560e87da4f3582b90d35c1aaeed2d2639c9a632dcdb567465e672d4fdc`, worker packet/supplement SHA는 `a8e10c634006a2625d2486ba87e6508563bfc2e19d6d9531f7fc2ff0bc04ee51`/`ba88572f5cdfcb20b864fda7365bccd79bc4d4579878eefbfebfde50b23345f0`다. coordinator/launcher/core/rulebook/test/fixture 최종 SHA는 `6334765e...`/`704faad9...`/`0ba9e578...`/`d472526d...`/`1843474c...`/`27701caa...`이고, 28개 owned file aggregate는 `8e37ea6b35eeba2c7224194fb59be6970ddbd72e11040f7d131c56ab613945fd`다. authoritative full chain을 동결 후보에서 두 번 exit 0으로 재현했고 각 run은 6/6 case, 기대 공격 87개, residue 0, 실제 first/second/C0 lock·edit 각 663개, reveal pre-readiness 15개, 11초 초과 delayed ACK, live reveal decision 3/disposition 4/global reset 2, fresh-validator/H2/TOCTOU/handoff를 통과했다. core/schema/atomic/CLI/serve 보조 matrix는 각각 8/6/7/6/6 case와 기대 공격 51/188/80/54/60개를 전부 차단했고 `npm run check`, JS 10개/C 2개 syntax, `git diff --check`도 PASS했다. 실제 Google Chrome `150.0.7871.114` headed/WebCodecs에서 blind 23/23 exact sample·2/2 왕복과 pristine reveal exact frame/UNSET UI를 검증했고, 별도 COW clone의 UI-only sequence 1..5가 두 class disposition/rationale를 global reset한 뒤 동일 A 좌표 복원 시에도 모두 UNSET임을 확인했다. blind/reveal summary SHA는 `83d23011...`/`60ebdda8...`, pristine tree SHA는 `8178ce6c...`이며 모든 coordinator는 TERM 143, stdout 0, listener/descendant/terminal residue 0으로 종료했다. WorkerResult raw/canonical SHA는 `dfbb96fb...`/`99abb938...`; 독립 결과 리뷰 blocker 0, orchestrator strict/isolation 오류 0으로 공식 accepted 8이 되었다. 같은 coordinator 생존 중 browser reload만 허용하고 종료 후에는 별도 partial-session authority가 없으므로 새 empty bundle revision을 요구하는 제약은 의도적인 anti-reseal 조건이다. 이 수용은 새 실제 source-first C0를 먼저 완료한 뒤 독립 blind A/B를 시작할 권한만 열며, zero-UNSET export·raw gate·reveal adjudication·compiler/auditor/external anchor 이전에는 P0 완료나 P1 시작을 주장하지 않는다.
  - 첫 실제 v3 source-first C0 cycle은 repository 밖 0700 root `/private/tmp/sam-p0-eval-v3-real-20260711-r1`에서 C0→blind A→blind B 순서를 고정하고 시작했다. C0 bundle manifest SHA는 `cb296fd8...`, prepare evidence SHA는 `34f5df1d...`이며, headed Chrome `150.0.7871.114`와 단일 coordinator를 유지한 채 source-only로 검토한다. `arms-crossed`는 `[0,38)` absent, `[38,42)` blurred entry, `[42,386)` selected upper-body 및 late self-occlusion 분기로 20개 truth leaf와 base window를 모두 채워 journal seq62, 386/6,711 rows, 1/7 windows가 됐다. 독립 replay 관찰은 7,721/134,227 typed leaf, schema/replay first error 0, 영속 tree anomaly 0을 확인했다. `csi-pose`의 두 source-only absent 경계는 mutation 전 인접 still로 `[2089,2183)`, `[2306,2355)`로 확정하고 증거 SHA를 고정 중이다. 이 cycle은 아직 진행 중이며 C0 seal 전에는 A/B bundle 접근을 열지 않는다.
  - 실제 운영에서 세 가지 비권위 UI 결함을 확인했다. 성공 편집 뒤 active lock은 null인데 이전 `Locked...` 문구가 남아 다음 편집을 오도하고, 화면에 허용 field registry가 없어 JSON 모양에서 추론한 `manualState.*` 경로가 `edit_value_type_mismatch`로 거부됐으며, 빠른 연속 Jump/relock은 `/api/lock` 400 경쟁을 만들 수 있다. 거부된 요청은 journal append가 없고 accepted truth에는 영향이 없었다. 현재 cycle은 매 편집 전 slow single Jump/relock→Apply enabled 확인→단일 Apply→seq 확인으로 우회한다. 후속 operations revision에서는 stale lock 표시 제거, UI field registry/typed selector 노출, lock 요청 직렬화·중복 억제와 정확한 inline error body를 요구하되, live C0 bundle을 수정하거나 기준을 낮추지 않는다.
  - `csi-pose` 오른손 source-first 판정을 완료했다. 네 개의 원 제안 중 source로 지지되지 않는 `out_of_frame→unknown` 전이와 cross-field 불법 전이 1개를 폐기하고, 63개 정확한 전이·64개 연속 구간으로 `[0,2849)`를 덮는 최종 plan SHA `7ec60f7b...`를 고정했다. 35개 hand occlusion, 19개 hand observability, 19개 wrist observability 편집을 headed UI로만 순차 적용해 journal seq214/SHA `4247c40a...`가 되었으며, 동결 plan에서 독립 산출한 63개 경계의 양쪽 126개 화면 값을 다시 읽어 mismatch 0을 확인했다. source-only resolution/projection/visible-verification SHA는 각각 `bec493e0...`/`41348d99...`/`b629de09...`이고 schema·replay·persistent-tree 검사와 coordinator/Chrome 생존 감시에서 이상 0, HTTP console은 기존 400×5+404×1에서 증가 0이다.
  - `csi-pose`에서 남은 유일한 UNSET leaf는 `scenarios`다. 첫 contact sheet가 exact-still UI 전체 screenshot을 다시 crop한 것이어서 하단 검토 UI를 원본의 하체 crop으로 오인하게 만드는 입력 결함을 발견했다. 그 sheet로 나온 G1/G2 결론은 UI 투영 전 전부 폐기했다. immutable `csi-pose.mp4` SHA `2e9b58ff...`를 ffmpeg decode frame index로 직접 선택해 만든 full 720×1280 source PNG 115개와 6개 새 sheet로 교체했으며, helper/file-manifest SHA는 `f699feb1...`/`6b4f4bba...`, manifest 121개 hash check는 PASS다. 기존 process-only coarse draft와 journal 값은 계속 판정자에게 숨긴다. `entry_exit`, `reacquire`, `turn`, `distance_change`, `partial_body_crop` 같은 시간적 태그는 clip-wide 상수로 채우지 않고 source가 지지하는 사건 경계를 dense refinement한 뒤에만 UI에 투영한다. C0가 완전히 seal되기 전 A/B 접근 금지와 동일 coordinator/browser 유지 조건은 계속 유효하다.
  - 동일 입력 결함이 이미 seq63/64로 기록된 양발 `out_of_frame` 전구간 값에도 영향을 줬음을 감사로 발견했다. 직접 디코드 원본에서는 발·발목이 한 번도 보이지 않아 contact `unknown`과 ankle `not_observable`은 유지되지만, 중앙 구간의 발은 image boundary가 아니라 전경 테이블에 가린 `occluded`다. 두 source-only 판정과 source-first adjudication을 수행했고, 첫 plan/action/script는 추가 semantic 검사에서 왼발 f2071 경계 blocker를 발견해 accepted action 0·seq214 불변 상태로 SHA `f0bfe81d...` 폐기했다. 확대 원본에서 오른발 f2055→2056, 왼발 f2080→2081, 양발 f2086→2087을 두 검증자가 일치시킨 v2 plan SHA `64d1c0e4...`를 만들었다. headed UI로 18개 correction을 seq215..232에 적용해 journal SHA `2a34ea88...`가 되었고, 9개 고유 경계의 양쪽 18프레임·좌우 36개 visible current value를 다시 읽어 mismatch 0을 확인했다. action parity, worksheet/journal schema, 232-event/6,711-row/7-window replay, HTTP non-200 증가 0, persistent anomaly 0이 PASS했으며 correction summary SHA는 `9afcb275...`다. 이 결함은 manual viewer가 원본 전체 frame을 항상 판정자에게 보여주는지 검증하는 후속 operations gate가 필요하다는 근거이며, 현재 C0에서는 direct-source decode evidence만 사용한다.
  - `csi-pose` 두 번째 presence 경계도 direct-source 확대 원본으로 재감사해, 이전 `[2306,2355)` absent 구간의 시작이 2프레임 이른 것을 확인했다. 마지막 present/첫 absent는 f2307/f2308이고 마지막 absent/첫 present는 f2354/f2355이므로 최종 absent 구간은 `[2308,2355)`다. 두 독립 preprojection 검수 뒤 f2306..2307의 presence/person/selection/target 4개만 headed UI로 seq233..236에 보정했고 journal SHA는 `0dfc9032...`가 됐다. stale browser session lock 거부와 빈 result paragraph 과잉 preflight로 두 시도가 accepted action 0·seq232 불변 상태에서 종료됐으며, 공식 bound-browser attach로 기존 `c0real20260711r1`에 연결하고 같은 coordinator/같은 탭을 1회 reload한 뒤 수정 스크립트 SHA `8c123b7f...`로 성공했다. 6개 경계 frame의 30개 visible value readback은 mismatch 0이고 journal은 불변이었다. 독립 검증에서 action parity, schema, 236-event/6,711-row/7-window replay, no-UNSET 386 rows/2 windows, persistent anomaly 0, coordinator PID 83883/port50933와 browser daemon PID93450/Chrome PID93522 생존이 모두 PASS했다. correction summary SHA는 `1d3cf724...`이며, 거부 시도는 reload 전 console error 2건 증가·성공 session error 0으로 분리 기록했다.
  - `csi-pose` scenario의 앞 구간 `[0,1750)`은 immutable MP4를 stride-1로 전수 디코드한 새 source-only primary, 별도 fresh source-only tie-break, 기존 독립 source-only 판정의 3-way 검토로 경계를 닫았다. 12개 판정 항목 중 11개는 fresh 두 검토가 일치했고, `partial_body_crop`만 원안 `[0,14)`를 `[0,22)`로 수정했다. direct raw frame에서 f21까지 머리 픽셀이 상단 경계에 남고 f22가 최초 완전 이격이며, frame22 RGB24 SHA는 `6fdba42d...`다. 충돌한 `turn=[943,1002),[1261,1350)`과 `side_view=[972,984),[1293,1314)`는 서로 격리된 fresh 전수검수와 fresh tie-break가 동일해 채택했고, 화면 내부 전경 테이블 구간은 image-boundary crop이나 `upper_body_only`로 오분류하지 않았다. primary/tie-break/manual/adjudication SHA는 `fff56b34...`/`8fb30bc1...`/`fab6c333...`/`358dd46e...`, unresolved boundary 0이며 모두 `compilerInput=false`, `p0Authority=false`인 process evidence다. 아직 UI에는 scenario action을 하나도 투영하지 않아 journal은 seq236/SHA `0dfc9032...`로 불변이고 coordinator·bound Chrome도 생존한다. 후반 `[1750,2849)`의 두 독립 source-only 전수검수와 clip-wide segment 합성·사전검증이 끝나기 전에는 scenario를 부분 투영하지 않는다.
  - 위 r1 coordinator는 이후 explicit 24-hour pathological-hang 상한을 넘겨 PID 83883/port 50933 listener와 unified exec session이 종료됐다. journal에 이미 236개 edit가 있으므로 rulebook의 anti-reseal 규칙에 따라 해당 partial session은 resume/seal/serve가 모두 불가하고, r1 source 판정·plan·journal을 replacement reviewer에게 복사·전사·prefill하는 것도 금지했다. stale attached/primary Playwright session은 정상 종료했으며 incident는 `/private/tmp/sam-p0-eval-v3-real-20260711-r1/evidence/failure/c0-coordinator-timeout-incident.json`, SHA `ae935cc4680fb54fda0285480edef85ac40e2667f50fad567a736f6d6bedea69`로 process-evidence-only 동결했다. 기준을 낮추지 않고 replacement cycle `/private/tmp/sam-p0-eval-v3-real-20260712-r2`를 새 actor 3명, C0-first access order, 20-hour operational deadline/4-hour closure reserve로 시작했다. C0 manifest SHA는 `f641857d...`, empty journal SHA는 `6c3c5591...`, cycle-plan/prepare evidence SHA는 `0a5ed87a...`/`b9fa867a...`이고 exact-PTS 7/7 및 `events=[]` 검증이 PASS했다. r2 coordinator exec session 88027/port 55544와 headed Chrome session `c0real20260712r2`를 새로 열었고, 과거 cycle·proposal·GOAL_PLAN을 전달받지 않은 단일 fresh source-only reviewer가 6,711행/7 windows를 처음부터 다시 판정 중이다. r2 C0가 zero-UNSET·visible readback·cross-field/contact/reacquire·tree/access 검증 후 정상 End Session과 외부 envelope까지 닫히기 전에는 A/B bundle을 준비하거나 접근하지 않는다.
  - replacement r2 source-first C0를 정상 seal했다. fresh reviewer의 headed UI 최종 상태는 정확 프레임 lock, `6711/6711 rows and 7/7 windows contain no UNSET`, journal sequence 537였고, 42개 exact boundary visible readback mismatch는 0이었다. root가 trusted public pins와 bundle core로 seed+journal을 독립 재생해 sequence 1..537, exact 6,711 identities, 7 base windows, no UNSET, cross-field/contact confirmation을 재검증했고 journal SHA `8ca66aa86ed4997c9a65fbd57e1461de4581f083157a43e716be2bc895ba20b1`, final process-bytes SHA `2d5424360f9809117678d4472c1cb60baa170c3a22bc47835972ece333acf18f`를 재현했다. support는 planted left/right 각 1,080 frames·3 clips, moving left/right 756/758 frames·4 clips, head 6,328 frames·7 clips, left/right hand 5,823/5,740 frames·6 clips, hard-test reacquire 3 events·2 clips로 모든 final gate가 PASS했다. immutable 38 assets+manifest의 exact member/hash/mode, 전체 0700 directory, no symlink/hardlink도 PASS했다. actor attestation SHA는 `a446ce2f3f428d04855602fa71f0483b683f304ca54def686ff4fc3c26185599`; access evidence SHA는 `7a247855a04046a64185ec120f34f316dc0b351121363e1be74304e69af855a1`이고 host repository·sibling bundle·non-loopback negative probe 3개가 모두 denied였다. coordinator exit 0의 외부 envelope는 `/private/tmp/sam-p0-eval-v3-real-20260712-r2/session-envelopes/c0.json`, SHA `8a490a6df9c99fabab9862f437cb689a5f664d13e71a2e8ddb808586a5d4f095`, session tree SHA `9073823bbf6856c8ed1a3575690d1046053ddd9f6ed7f361011170cc819d141b`로 보존했다. 공식 `seal-c0`와 별도 root ledger↔replay binding 검증은 모두 PASS했고 write-once C0 ledger `/private/tmp/sam-p0-eval-v3-real-20260712-r2/artifacts/c0-ledger.json`의 byte SHA는 `b3a51b03b841e976b1c8cef9ce9f2db1fca382c0dea328b405db0cc889f8c67c`다. C0-first gate가 닫혔으므로 이제부터만 서로 다른 fresh actor의 first/second blind bundle 준비를 허용하며, raw A/B gate·reveal adjudication·compiler/auditor/external anchor 전에는 P0 완료나 P1 시작을 주장하지 않는다.
  - C0 seal 이후에만 first/second blind bundle을 새 absent path로 준비했다. first manifest/empty journal SHA는 `c4815ef503323025dca52074dd31e7dac71ca2408ac066a05e02384338844845`/`aaea16b04dd1785f5fdf84b9617f90b2a85305df9efe7327e81b063f19263b8d`, second는 `a569e17c27c4ffa9c3700d18a3d60a06959a5e0238019b13563f3d62d4c33e9b`/`962f5009b87d54fe00a0b736dacb80a49de63bdd04080463dbf7b05d6496b95d`다. root preflight는 actor distinct, exact-PTS 7/7, exact 41-file member set, 0700 directories, no symlink/hardlink, exact all-UNSET seed 6,711 rows/7 windows, `events=[]`를 두 bundle 모두에서 PASS했다. 과잉 정규식이 owned access-evidence schema 이름을 leakage로 잡은 첫 read-only scan은 bundle mutation 없이 폐기하고 exact manifest allowlist로 재검증했다. 서로 대화 이력·C0·상대 bundle·모델/metric/proposal을 받지 않은 fresh first/second reviewer를 포트 60881/60884의 별도 coordinator와 headed Chrome session `firstreal20260713r1`/`secondreal20260713r1`에 배정했다. 두 reviewer는 현재 source-only direct-decode coarse/dense boundary audit 중이며, root 독립 zero-UNSET/replay/support/tree 검증 전 attestation·End Session을 금지했다.
  - r2 first/second blind review는 각각 source-only headed UI 검토, visible exact readback, root requireComplete/tree/browser 검증, 정상 attestation/End Session, coordinator exit 0, access negative probes, 공식 export와 root formal materialization까지 개별 PASS했다. first journal은 299 events/SHA `5fee0625...`, session tree `1b226476...`, formal/receipt SHA `b96558c2...`/`861a665f...`; second journal은 369 events/SHA `2cfc8127...`, session tree `65a25a35...`, formal/receipt SHA `3e6be9fe...`/`fbf51d00...`다. first visible readback은 27개/mismatch 0, second는 81 exact frames·226 assertions/mismatch 0이었다. second의 client-side invalid JSON 1건과 첫 accepted edit 전 동일 forbidden-path server reject 2건은 `REJECTED_ATTEMPTS.md` SHA `0d67ce14...`에 non-mutation 근거와 contemporaneous hash 부재 한계를 명시했다.
  - 두 sealed review와 C0의 independently expected hash로 official raw comparison을 실행했으나 exit 1 `raw_ab_gate_failed`였고 raw report destination은 absent로 남았다. unrounded macro는 presence/person `0.9774657027574108 < 0.99`, contact `0.49304830495827445 < 0.9`, observability `0.6639410771871006 < 0.95`; formal disagreement는 436개였다. 두 review의 individual support/reacquire gate는 true였지만 cross-review semantic agreement가 기준에 크게 미달했다. 실패 증거는 `/private/tmp/sam-p0-eval-v3-real-20260712-r2/evidence/root/RAW_AB_GATE_FAILURE.md`, SHA `ac0ca9770bfe682ecec7c7d5cf9abbaca988282cb3cba831a124158e477706ff`로 동결했다. rulebook에 따라 r2 전체 cycle은 terminal이며 C0/A/B/metric/경계/값을 수정·재사용·힌트로 반환하거나 threshold/분모를 낮추지 않는다. 새 cycle ID, 새 actor 3명, empty bundles, absent outputs로 source-first C0부터 다시 시작한다.
  - replacement r3 `/private/tmp/sam-p0-eval-v3-real-20260713-r3`를 새 cycle ID와 서로 다른 새 actor 3명, 전 경로 0700, absent outputs로 시작했다. cycle plan SHA는 `0cdcbaa209e6173f62c1c5961f9157bf689320f720927dbc5b24e80d2c9a5dd6`이며 이전 truth/metric/경계/증거를 actor에게 전달하지 않는다. r3 process-level 강화는 값 힌트 없이 모든 actor가 presence/person/selection, body·hand·foot occlusion, hand/endpoint observability, contact, scenario/window를 전클립 exact-source로 먼저 감사하고 visible transition을 exact frame까지 좁힌 뒤에만 UI에 투영하도록 요구한다. vocab/truth/support/raw threshold/denominator는 변경하지 않았다. C0 manifest/empty journal SHA `2504415bd9b5734ed83b1c5bca44d20a5d3bddada77395ecdf49c795ad35de32`/`4bbf7165dd2361903c31f27f4592d4c68daf6337ac73bc56f8a083cd282b2949`, exact-PTS 7/7, exact 41-file tree, all-UNSET 6,711 rows/7 windows, actor binding, no link가 PASS했다. first/second bundle path는 absent로 유지한 채 C0 coordinator port 65183와 headed Chrome `c0real20260713r3`만 열었고, fresh C0 reviewer가 7개 source audit sheet를 만든 뒤 전클립 semantic audit 중이다.
  - r3 C0는 전 7클립 1fps+6fps, exact-boundary grids/locks, 모든 20 leaf family, intrinsic anchor를 source-only로 감사한 뒤 pre-projection evidence를 hash 고정하고 UI에 투영했다. 첫 requireComplete에서 `endpoint_truth_rule` 두 current-journal 구간을 root가 오류 코드/좌표만 반환했고, reviewer가 source 재검토 후 seq335–336 exact UI correction으로 닫았다. 최종 journal 336 events/SHA `4e4d5a0c5dfa853571f3921164ea659da154c4cd5707ea57e1d513d9d02ba49f`, final process bytes `c3c2dd7f...`, visible readback 34/mismatch 0, exact tree/root complete/final gate가 PASS했다. support는 moving L/R 각 2,422 frames·4 clips, planted 각 350 frames·3 clips, head 6,267·7, hands 각 6,135·7, reacquire 4 events·3 hard clips였다. audit manifest/validation SHA는 `ecb5d7c4...`/`53f09242...`; actor attestation/access SHA `754c86f7...`/`d252f6db...`; envelope SHA `076495e8...`, session tree `5681a15e...`; official/root-validated C0 ledger SHA는 `5322df47711e01d91493d05d7d26715e27a7b761be68222cf095b84c0f5ffc32`다. 세 access negative probe는 denied였고 headed browser를 coordinator exit 후 정상 종료했다.
  - r3 C0 seal 이후 first/second empty bundle을 생성했다. first manifest/empty journal SHA `f8638fec3ceb3d86a257824674a46b71f6d1308e12fb5e37eef03f18829e71ae`/`901c67e407df50fec9e865c82cc109b23756fd644841f9f7627e59d3c45ae788`, second `cd2f30382454e34033e691a045ef2e12fbc48fb79fc8122176e9b80fbc406a25`/`3b173169e858190107eef8b9abda20c0d0cc6efb65dbbca4efbf87984a67d20a`다. root preflight는 두 역할 모두 exact-PTS 7/7, exact 41 files, all-UNSET 6,711 rows/7 windows, `events=[]`, actor distinct, no link를 PASS했다. public-rulebook-only semantic checklist는 SHA `d9fbf1d26833f0899adcb18784b7ff9d5a29a6d80521dc83a996b707df724ed8`로 root evidence에 동결했고 값/경계 없이 동일 decision order를 두 fresh actor의 사전 workflow에 적용했다. first/second coordinator port 54104/54107과 headed Chrome `firstreal20260713r3`/`secondreal20260713r3`를 열었으며, 양쪽 모두 상대/C0/과거 cycle을 보지 않고 full-clip source audit부터 시작했다.
  - r3 blind-r1 두 actor는 각각 fresh source evidence만 생성한 채 저널 `events=[]`, attestation/access evidence absent 상태에서 동일한 backend stream disconnect를 만나 root turn과 parent coordinator가 소실됐다. launcher child가 PPID 1로 남은 전송 계층 사고였고 accepted truth mutation, validator/raw/access/hash gate 실행은 없었다. orphan launcher·listener·stale browser를 종료하고 incident를 `/private/tmp/sam-p0-eval-v3-real-20260713-r3/evidence/root/BLIND_R1_TRANSPORT_INCIDENT.md`, SHA `3f379fbd684b95decce8102c856a25d47e1c960ad27c35ff6aec72abd9363f1a`로 동결했다. 동일 cycle/actor 계약을 유지하되 r1 evidence는 process-only·replacement 접근 금지로 두고, 새 inode의 empty revision `first-r2`/`second-r2`를 준비했다. 두 revision은 manifest/seed/empty-journal SHA가 역할별 원본과 동일하면서 exact 41 files, all-UNSET 6,711 rows/7 windows, `events=[]`, no links, r1과 inode disjoint를 root가 다시 PASS했다. 새 coordinator exec session 88735/53895가 port 50268/50258에서 `review_ui_ready`를 냈고, 새 브라우저 session `firstreal20260713r3r2`/`secondreal20260713r3r2`와 새 evidence directory만 허용한 완전히 새로운 두 reviewer가 과거 evidence 없이 20-hour deadline의 source-only 전수감사를 처음부터 다시 시작했다.
  - r3 blind-r2의 finalization 직전 root 검증을 위해 process-only pre-seal validator를 별도 0600 evidence로 준비했다. validator SHA는 `2fde5e05e40923abcb86c873e8d9278c74296d7ecf86c2bfc6cf48d921a26fba`이며 public pin, canonical manifest, exact immutable member/hash/mode, held seed/journal snapshot, exact seed, 전체 journal replay, 6,711행/모든 window zero-UNSET, semantic/contact confirmation, formal materialization round-trip, final support/reacquire를 한 번에 검사한다. 과거 sealed blind positive control은 exit 0, 현재 all-UNSET r3 negative control은 exit 1 `worksheet_unset`으로 통과했고 readiness evidence `/private/tmp/sam-p0-eval-v3-real-20260713-r3/evidence/root/PRESEAL_VALIDATOR_READINESS.md` SHA는 `19edb801fd8c6382478a4f548d68ffd41edb0c7d39ade1a907b278aa55f4fe07`이다. reviewer에게는 실패 code와 source coordinate만 전달하며 support 값·과거 truth는 숨긴다.
  - r3 blind-r2 두 reviewer는 worksheet projection 전에 각자 전 7클립 full-duration 1fps와 full-clip 6fps exact-still source coverage를 완료했다. first는 `csi-pose`만 571 exact frame을 포함해 1,162+ evidence, second는 전체 person-bearing 6fps 1,020장을 포함해 1,228+ evidence를 만들었고, 닫힌 batch마다 directory 0700/file 0600 및 journal `events=[]`를 root가 확인했다. second agent turn이 한 차례 model-capacity 오류로 끝났지만 coordinator/listener/headed Chrome과 empty journal이 모두 살아 있었고 같은 actor가 같은 browser session에 재attach해 자기 evidence에서만 계속하므로 session/판정 revision은 발생하지 않았다. 양쪽은 이제 arms/csi/jujae의 entry/exit/reacquire 및 손·몸·발 경계와 upper-body clip의 hand/head crop, 모든 leaf/scenario/window를 exact before/after frame으로 닫는 중이며, canonical `SOURCE_AUDIT_MANIFEST.json`을 hash/mode/1fps/6fps/boundary/leaf-completion/projection-start-sequence/source-only attestation과 함께 봉인하기 전에는 첫 UI edit를 금지한다.
  - second의 첫 `SOURCE_AUDIT_MANIFEST.json` SHA `09d2e1e8e3769f338dabd8d403f703d7273f12cdcc6320a5418e5ef0af732720`은 projection 전에 root+독립 auditor가 REVISE했다. 1,593 listed member hash/mode/nlink, 198/198 1fps, 1,020/1,020 6fps, 10 boundary/20 decoder identity, empty journal, visible-UI-only helper는 PASS했지만 terminal LF 부재, manifest 후 unlisted recording/mode drift, 12개 scenario raw-order 위반이 있었다. 더 근본적으로 head/hand/foot/contact를 clip-wide prose 상수로 접어 exact leaf interval/transition을 증명하지 않았고, 자기 `jujae` frames 0/10/20/40의 서로 다른 source-visible region과 모순됐으며 event-local scenario를 absent interior까지 clip-wide로 복제했다. 모든 clip contact를 unknown으로 둔 계획은 public final support를 deterministic zero로 만들어 pre-seal 실패가 확정된다. 기준을 낮추거나 값을 지시하지 않고 오류 코드와 자기 source 좌표만 반환했으며 journal은 0으로 유지했다. rejected manifest와 재감사 요구의 root evidence는 `/private/tmp/sam-p0-eval-v3-real-20260713-r3/evidence/root/SECOND_MANIFEST_R1_AUDIT.md`, SHA `2507cb23ea27ff795798cac8e985c8ee6cded4f38b34da680cd5a78ef68246eb`다. second는 exact per-leaf/scenario intervals와 contact 100ms를 자기 source에서 다시 감사하고 stable closed evidence set으로 manifest를 재작성하기 전 projection 금지다.
  - second가 자기 UI evidence만으로 contact support 불가능을 정직하게 보고했고 first도 독립적으로 full-body clip을 upper-body/absent로 판정해, reviewer와 격리된 source-only feasibility audit를 수행했다. 원본 MP4/decoder만 본 auditor는 clear both-foot+ankle 2,749 frames·5 clips, planted 좌우 각 360 frames·2 clips, moving left 358/right 392 frames·3 clips를 exact PTS로 증명해 public gate가 실제로 FEASIBLE임을 확정했다. source feasibility evidence SHA는 `82ed0cc99c67935971710253d604d425343e272d24a56ada061234c01ad148c4`다.
  - root direct-decode 대조로 실제 원인은 immutable viewer evidence capture임을 재현했다. `canvas`는 intrinsic source 크기지만 `.still-scroll{max-height:70vh;overflow:auto}` 안에 있고 Playwright canvas locator screenshot이 scroll viewport 아래 decoded pixels 대신 following page/UI pixels을 같은 intrinsic 크기 PNG에 넣는다. `dance` frame0은 direct source에서 전신인데 UI evidence는 하늘/머리만 남았고 top 385-row SSIM `0.999089` 대비 full-frame SSIM `0.384139`; `keGb` frame0 direct source의 전신 intended subject도 UI screenshot에서는 하단 전체가 사라져 두 actor가 whole-clip absent로 오판했다. first/second journal은 끝까지 `events=[]`라 projection truth는 없지만, 이미 sealed r3 C0도 동일 viewer를 사용했으므로 source truth가 신뢰 불가하고 수정할 수 없다. r3 전체 cycle을 terminal input-presentation failure로 동결하며 현재 C0/actor source evidence/값은 replacement에 재사용하지 않는다. incident evidence `/private/tmp/sam-p0-eval-v3-real-20260713-r3/evidence/root/FULL_FRAME_PRESENTATION_INCIDENT.md` SHA는 `b2c791493ab148b1591702908a2e9b58b8f3287c166f552247ece6966a11972b`다. gate는 낮추지 않고 default full-frame fit, intrinsic lock/anchor 유지, portrait+landscape blind/reveal headed-Chrome bottom/corner sentinel 회귀를 갖춘 새 operations revision을 독립 수용한 뒤 새 cycle/C0부터 다시 시작한다.
  - terminal 판정 직후 first/second headed Chrome session을 정상 종료하고 두 coordinator에 SIGINT를 전달해 각각 exit 130의 단일 `serve_interrupted` envelope로 닫았다. port 50268/50258 listener, launcher/coordinator/browser descendant는 모두 absent이고 first/second journal은 각각 기존 empty SHA `901c67e4...`/`3b173169...`, `events=[]`, attestation/access evidence absent 상태를 유지한다. 따라서 r3 blind에는 accepted truth mutation이나 부분 seal이 없으며, sealed C0까지 포함한 전체 cycle만 presentation defect 때문에 폐기한다.
  - accepted `manual-review-operations@r2`를 `r3`로 공식 supersede하고 full-frame trust boundary를 새 interface로 설계했다. 독립 unit validator의 첫 판정은 REVISE였다: inherited phase gate/MC2 trace가 r2를 가리켰고, pre-fix bundle을 current viewer lineage로 기계적으로 거부·전파하는 계약과 first/second 각각의 headed content gate가 부족했다. 이를 수정해 interface v3는 exact fit/no-clip/unmirrored semantics와 stable blind/reveal evidence target, 모든 relevant owned viewer descriptor로 `presentationContractSha256`를 만들고 bundle manifest/access/session descriptor+envelope/review receipt/C0/raw/reveal/deviation/handoff에 필수 전파한다. old/missing/cross-lineage 또는 coherent rehash는 각 direct consumer에서 `presentation_contract_mismatch`로 pre-stage 실패하며 formal compiler input·threshold·P0 descriptor는 바뀌지 않는다. first, second, C0, reveal 각각에서 Chrome 150·1280x720/1440x1000·portrait/landscape·전 7 source first/middle/last를 직접 decode와 비교해 full/bottom-quarter SSIM `>=0.995`, corner/bottom/page-pixel exclusion을 요구하고 legacy scroll layout/1px clip을 negative control로 둔다. invalid live-cycle root는 worker forbidden scope다. 수정 spec은 독립 재검토 PASS, standard/strict dispatch와 isolation 오류 0을 받았다.
  - 공식 worker packet은 `/private/tmp/manual-review-operations-r3-worker-packet.json`, 181,677 bytes, SHA `2b65459c18f2b1020d20dd23508a2976d1e3f8c507bf3ec03356dff67b34c1b1`이다. orchestrator의 revision-aware dependency lookup 결함으로 official lease가 `leased:false`여서 이번 packet 하나에만 한정한 `tool_unavailable` 예외 `lex-36069ef87f`를 기록했고, attempt `attempt-e9a40f6aad`를 targeted lease했다. worker는 r2 accepted owned bytes를 기준으로 interface-v3 schema/core/CLI/browser gate를 구현 중이며, 독립 결과 수용과 fresh r4 C0 이전에는 실제 review나 P0를 재개하지 않는다.

## Goal Planner 체크리스트

- [x] 하나의 durable objective/completion condition
- [x] 단계/checkpoint
- [x] 단계별 목표 스펙과 성능 수준
- [x] 최종 목표 스펙
- [x] 단계별·최종 검증 방법
- [x] 범위·제약·비목표
- [x] 회귀 방지 기준
- [x] 진행 로그 규칙
- [x] 중단/질문 조건
- [x] 목표 상향 opt-in 상태
- [x] 독립 최종 검증과 대체 검증
