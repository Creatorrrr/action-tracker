# action-tracker Motion Capture Improvement Goal Plan

작성일: 2026-07-02
대상 저장소: `/Users/chasoik/Projects/action-tracker`
대상 런타임: Codex goal mode
계획 출처: Claude Code fable/xhigh 설계안 + goal-planner 실행 조건 정리

## 목표 요약

- 최종적으로 달성해야 할 결과:
  - 웹 기반 `action-tracker`를 실사용 가능한 실시간/오프라인 아바타 모션 캡처 시스템에 가깝게 개선한다.
  - 뒤돌아 보이는 아바타, 팔 접힘 붕괴, 등 뒤 팔 발산, 고개 꺾임, 상반신 프레이밍 불안정 문제를 solver/검증 구조 차원에서 줄인다.
  - MediaPipe 신호와 아바타의 자기참조 일치율 중심 검증을 보조 지표로 내리고, 합성 GT와 실패 시나리오 중심 검증을 추가한다.
- 작업 대상/범위:
  - `src/app.js`, `src/avatar-renderer.js`, `src/motion-frame.js`, `src/motion-worker.js`, `src/depth-calibration.js`
  - 신규 `src/solver/*`
  - 검증 스크립트와 테스트: `scripts/*`, `tests/*`, `package.json`
  - 문서: `README.md`, `docs/*`, 신규/수정 계획 및 검증 문서
- 명시적 비목표:
  - 한 번에 전체 앱을 재작성하지 않는다.
  - 외부 HMR(WHAM/GVHMR/GEM-X/SAM 3D Body)을 실시간 런타임 필수 의존성으로 만들지 않는다.
  - 사용자 미승인 대용량 모델/클립/바이너리 에셋을 무분별하게 커밋하지 않는다.
  - 파괴적 git 조작, 사용자 변경 되돌리기, 임의 원격 푸시는 하지 않는다.

## 기준선과 가정

- 현재 상태/기준선:
  - `src/app.js`와 `src/avatar-renderer.js`에 캡처, 추론, 리타게팅, 검증, UI가 많이 섞여 있다.
  - 최근 motion agreement 점수는 높지만 MediaPipe 신호 추종도 중심이라 실제 사람 동작 정답성을 보장하지 않는다.
  - 기본 검증 게이트로 `npm run check`, `npm run perf:avatar`, `npm run perf:avatar:vrm`, `npm run motion:avatar`를 사용해 왔다.
  - `motionFrame`은 live tracking, replay, forwarding을 잇는 핵심 계약이다.
- 확인해야 할 미지수:
  - 현재 MediaPipe delegate 실제 동작 상태와 GPU/CPU fallback 경로.
  - 현재 worker 경로가 `ImageData`, `ImageBitmap`, `VideoFrame` 중 무엇을 실제로 쓰는지.
  - 검증 리포트가 소스와 런타임에 얼마나 결합되어 있는지.
  - three-vrm 도입 방식: CDN pin, vendoring, 번들러 도입 중 어떤 방식이 repo와 가장 맞는지.
- 가정:
  - 실시간 트랙은 브라우저 + MediaPipe 기반을 유지한다.
  - 오프라인 HMR 트랙은 별도 디렉터리/포맷 접점으로 격리한다.
  - 사용자 요청에 따라 필수 목표 달성 뒤 최대 3회까지 안전한 성능/품질 상향 개선을 허용한다.

## 단계별 계획

| 단계 | 작업 내용 | 단계별 목표 스펙/성능 수준 | 검증 방법 | 단계 완료 조건 |
|---|---|---|---|---|
| 0.1 | 저장소 위생 정리 | 새 실행 결과가 저장소를 불필요하게 더럽히지 않음 | `git status --short`, `npm run check` | `.gitignore`/문서/에셋 provenance가 정리되고 사용자 변경은 보존 |
| 0.2 | GPU delegate 명시와 보고 | Pose/Hand/Face detector에서 GPU delegate 시도, 실패 시 CPU fallback, 리포트에 delegate 표시 | 브라우저 성능 리포트, `npm run check` | delegate 상태가 관찰 가능하고 fallback이 안전하게 동작 |
| 0.3 | latest-wins frame pipeline | 검출 중 도착한 프레임은 최신 1개만 유지, frame age p95 목표 66ms 이하 | 성능 리포트, 관련 테스트/스모크 | 지연 누적 대신 frame drop/age가 측정됨 |
| 0.4 | 런타임 검증 기본 off | 기본 프레임 루프에서 validation 집계 비용 제거, `?validation=on`으로만 활성 | perf report 비교, 기존 validation 스크립트 | 기본 경로 validation 계산/할당이 사라지고 opt-in 검증은 유지 |
| 2.1 | 합성 GT 하네스 선구축 | 알려진 관절 회전 -> 합성 landmark -> solver 출력 비교 가능 | `tests/solver-synthetic-check.mjs`, identity/팔접기/회전 케이스 | Node에서 결정적 solver GT 테스트가 `npm run check`에 편입 |
| 1.1 | pose solver 동작 보존 추출 | 기존 retarget 결과와 ε 수준 일치, solver가 Node에서 단독 실행 가능 | 신규 extraction check, `npm run check` | `src/solver/pose-solver.js` 경계가 생기고 renderer는 적용만 담당 |
| 1.2 | swing-twist + hinge 제약 | 팔꿈치/무릎 역굴절 0프레임, 팔꿈치 각도 MAE 5도 이하 | synthetic 팔 접기, 실클립/스크린샷 스모크 | 팔 접힘 붕괴 재현 불가 |
| 1.3 | facing FSM | 정면 유지 clip flip 0회/분, 180도 회전 전이 1회, 지연 300ms 이하 | facingFlipRate 리포트, clip family | 뒤돌아 보임/앞뒤 반전이 상태 모델로 통제됨 |
| 1.4 | occlusion hold/decay | visibility 낮은 관절은 hold 후 decay, 가림 중 각속도 스파이크 0회 | synthetic visibility mask, 등 뒤 손 클립 | 등 뒤 팔 발산이 억제됨 |
| 1.5 | upper-body mode FSM | 힙 미검출 시 full/upper 채터링 0회, 다리 rest 고정 | 상반신 clip, mode chatter metric | 상반신 프레이밍에서 상체 추적 안정 |
| 1.6 | One Euro/filter 통일 | 정지 jitter RMS 2deg/s 이하, 빠른 동작 위상 지연 80ms 이하 | jitter/latency 리포트 | smoothing 파라미터가 그룹별로 단순화되고 지연/지터 균형 달성 |
| 2.2 | clip family 구축 | 7개 실패 시나리오와 이벤트 라벨 스키마 확보 | manifest/schema check | 실촬영 회귀 게이트 입력이 준비됨 |
| 2.3 | validation CLI 통합 | synthetic/clips/agreement를 CLI에서 실행, runtime validation 집계 제거 | `node scripts/validation-cli.mjs --suite ...`, `npm run check` | 기존 agreement는 signalAgreement 보조 지표가 됨 |
| 1.7 | legacy solver 제거 | Phase 2 게이트가 녹색인 상태에서 legacy path 삭제 | 전체 검증 게이트 | `BODY_BONE_CONFIGS` 기반 direction-aim 잔재 제거 |
| 2.4 | 증상 직결 지표 추가 | flip rate, jitter, hinge violation, spike, chatter, frame age pass/fail 출력 | validation CLI 리포트 | 사용자 증상과 직접 연결된 수치가 관찰됨 |
| 3.1 | three-vrm 도입 검토/적용 | VRM0/VRM1 normalized humanoid, expression/lookAt 기반 확보 | VRM 테스트, 브라우저 스모크 | 자체 VRM 처리 비용이 줄고 VRM 경로 안정화 |
| 3.2 | GLB rig canonical 정규화 | solver 출력 대상은 VRM humanoid 하나로 고정 | 샘플 모델별 replay/스모크 | 신규 GLB는 매핑 테이블 중심으로 추가 가능 |
| 4.1 | 상태 HUD | facing/mode/quality/delegate/FPS 표시 | 브라우저 수동 확인, screenshot | 사용자가 추적 상태를 즉시 이해 가능 |
| 4.2 | T-pose calibration UX | depth calibration readiness가 보임 | 수동 확인/스모크 | 캘리브레이션 전후 상태가 명확 |
| 4.3 | lost tracking 복귀 | 소실 시 rest pose easing, 재획득 시 blend in | 소실/복귀 clip | 스냅 복귀 0회 |
| 5.1 | JSONL recording export | 원본 영상 참조 + 프레임당 1행 motionFrame export | 포맷 문서/샘플 export | 외부 HMR이 소비 가능한 recording format |
| 5.2 | offline HMR scaffold | GVHMR/WHAM 등 결과를 replay 포맷으로 import 가능 | 샘플 1개 replay | 오프라인 고품질 경로의 최소 골격 |
| 5.3 | live-vs-offline 비교 뷰어 | Live 결과와 offline 결과 비교 가능 | replay viewer, 각도 차이 그래프 | offline 결과가 Live solver 준-GT 역할 수행 |

## 최종 목표 스펙/성능

- 필수 완료 기준:
  - P0 항목이 모두 구현되고 검증된다.
  - `motionFrame` 계약이 보존되며 live/replay/forwarding 경로가 깨지지 않는다.
  - `src/solver/*` 기반 순수 solver 경계가 생긴다.
  - 합성 GT, clip family, signalAgreement 계층 검증이 문서화되고 실행 가능하다.
- 성능/품질 목표:
  - detection p50/p95: GPU delegate 기준 20ms/33ms 이하를 목표로 하되, 불가능하면 실제 baseline과 원인을 보고한다.
  - solver p95: 2ms 이하.
  - render p50/p95: 8ms/14ms 이하.
  - end-to-end frame age p95: 50ms 목표, Phase 0.3 중간 목표 66ms.
  - dropped/latest-wins 폐기 + duplicate frame: 30fps에서 5% 미만.
  - facing flip rate: 정면 유지 clip 0회/분, 실제 180도 회전 clip 전이 1회, 지연 300ms 이하.
  - jitter: 정지 자세 관절 각속도 RMS 2deg/s 이하, p-p 1.5도 이하.
  - 팔꿈치/무릎 hinge 위반: 0프레임.
  - occlusion 중 관절 각속도 spike(180deg/s 초과): 0회.
  - synthetic GT 관절 각도 MAE: core chain 5도 이하, limb distal 10도 이하.
- 회귀 방지 기준:
  - `npm run check` 통과.
  - retarget/landmark/runtime 경로 변경 후 `npm run motion:avatar` 통과.
  - VRM/GLB 경로 변경 후 `npm run perf:avatar`, `npm run perf:avatar:vrm` 또는 대체 성능 게이트 통과.
  - 새 validation CLI suite가 통과하거나, 미달 지표는 원인/수정 계획을 기록한다.
- 산출물:
  - `src/solver/*`
  - synthetic GT fixtures/checks
  - validation CLI와 리포트 스키마
  - docs/README 업데이트
  - 브라우저 확인 URL과 수동 확인 방법
  - 최종 검증 로그/리포트 경로

## 독립 검증 정책

- 최종 완료 선언 전 독립 검증 필요 여부:
  - 필요하다. 구현자가 직접 실행한 검증 외에 가능한 경우 별도 서브에이전트 또는 clean worktree/fresh checkout에서 최종 완료 기준을 재검증한다.
- 권장 검증 주체/환경:
  - 별도 서브에이전트가 코드 변경 내용을 리뷰하고 `npm run check`, 핵심 validation CLI, retarget 관련 브라우저/Playwright 스모크를 재실행한다.
  - 서브에이전트가 불가능하면 clean worktree 확인 후 의존성 재설치/테스트 재실행/산출물 재생성으로 대체한다.
- 독립 검증자가 확인할 기준:
  - P0 필수 완료 기준이 모두 실제 코드와 테스트로 충족되는지.
  - `motionFrame` backward compatibility가 유지되는지.
  - runtime validation 제거가 사용자-facing debug/validation 경로를 깨지 않았는지.
  - 성능 지표가 baseline 대비 악화되지 않았는지.
- 독립 검증이 불가능할 때의 대체 검증:
  - 불가능한 이유를 진행 로그에 기록한다.
  - `git status --short`, `npm run check`, relevant perf/motion scripts, validation CLI, 브라우저 스모크를 재실행한다.
- 최종 보고에 포함할 검증 증거:
  - 실행한 명령, exit code/결과 요약, 생성 리포트 경로, 확인한 브라우저 URL, 남은 위험, 완료 기준별 pass/fail.

## 성능 목표 상향 정책

- 사용자 동의 여부: 예.
- 동의한 경우:
  - 필수 목표를 모두 달성한 뒤에도 안전하고 범위 내에서 개선 여지가 확인되면 최대 3회까지 성능/품질 목표를 상향한다.
  - 각 상향 라운드마다 현재 검증된 기준선, 새 목표 수치 또는 품질 기준, 선택 이유, 검증 방법을 진행 로그에 기록한다.
- 상향 가능한 지표:
  - detection p95, frame age p95, solver p95, dropped frame rate, jitter, facing flip rate, hinge violation, occlusion spike, mode chatter, validation CLI coverage.
- 상향 금지 범위:
  - 기능 범위 확대, 외부 동작 파괴, API/recording format 무단 breaking change, 비용/보안/호환성 제약 위반, 대용량 에셋 무단 추가, 사용자 승인 없는 큰 런타임 스택 전환.

## 중단/질문 조건

다음 경우에는 멈추고 사용자에게 보고한다.

- 목표 달성이 현재 기술/환경에서 infeasible하다는 구체 증거가 있는 경우.
- 외부 서비스 인증, 비밀값, 대용량 다운로드, 유료 리소스, 별도 GPU 환경이 필요한 경우.
- 파괴적 변경, 사용자 변경 되돌리기, 커밋 히스토리 조작, 원격 push가 필요한 경우.
- 성능 목표를 달성하려면 공개 API/recording format을 breaking change 해야 하는 경우.
- clip family나 외부 HMR 검증에 필요한 영상/라벨/모델 사용 권한이 불명확한 경우.

## 진행 로그 규칙

- 각 체크포인트마다 현재 단계, 변경 사항, 검증 결과, 남은 일, 차단 여부를 짧게 기록한다.
- 실패하면 원인을 분석하고 수정-검증 루프를 반복한다.
- 장시간 작업 중에는 최소 30초 단위로 의미 있는 상태 업데이트를 남긴다.
- final 보고에는 변경 파일, 주요 설계 결정, 검증 명령과 결과, 남은 위험, 다음 추천 작업을 포함한다.

## 현재 진행 로그

- 2026-07-02 P0.1-P0.4:
  - `.gitignore`에 로컬 실행 산출물 ignore를 추가하고 validation 집계를 `?validation=on` opt-in으로 분리했다.
  - MediaPipe detector delegate를 기본 GPU 시도/CPU fallback으로 만들고 report에 delegate 상태를 노출했다.
  - detector delegate report에 detector별 `attempted` delegate order와 `fallbackReasons`를 추가했다. main-thread와 tracking worker가 같은 telemetry shape를 사용한다.
  - rVFC stale callback drop과 callback lag 지표를 추가해 latest-wins frame pipeline을 측정 가능하게 했다.
  - 검증: `npm run perf:pump` latest 통과. rVFC는 `overall=99.54%`, `frameAgeP95=30.5ms`, `detectP95=125.6ms`, `frameP95=126.2ms`, stale callback `19`, duplicate frame `0`으로 Phase 0.3 목표 `66ms` 이하를 만족했다.
  - 검증: `npm run check`, `npm run motion:avatar`.
  - 검증: `npm run smoke:hud` CPU run에서 `detectorDelegates.requested=CPU`, `pose=CPU`, `hand=CPU`, `attempted.pose=[CPU]`, `attempted.hand=[CPU]`, `fallbackReasons={}` 확인.
  - 검증: `npm run smoke:hud:gpu` headless run에서 `detectorDelegates.requested=GPU`, `pose=GPU`, `hand=GPU`, `attempted.pose=[GPU]`, `attempted.hand=[GPU]`, `fallbackReasons={}` 확인. headless GPU detect p95는 `479.4ms`라 실 GPU 성능 증거로는 사용하지 않는다.
- 2026-07-02 P1/P2 기반:
  - `src/solver/pose-solver.js` 순수 solver 경계를 만들고 renderer가 solver target/meta를 소비하도록 연결했다.
  - synthetic GT fixture/check를 추가해 hinge hard violation, soft warning, facing, upper-body, occlusion, left-elbow MAE를 검증한다.
  - validation CLI를 추가하고 synthetic/clips/agreement suite를 통합했다.
  - 검증: `node scripts/validation-cli.mjs --suite synthetic` 통과, `node scripts/validation-cli.mjs --suite clips`는 manifest schema 유효하지만 실제 clip 0개라 `unavailable`.
  - `validate:motion`/agreement suite가 report JSON을 읽어 frame age p95, detect p95, solver p95, unsigned hinge min-limit diagnostic frames, soft warning frames, facing/mode changes, delegate, stale callback, JSONL replay line count를 요약하도록 확장했다.
  - quality gate: agreement metrics 기준 frame age p95 <= `66ms`, pose solver p95 <= `2ms`, unsigned hinge min-limit diagnostic frames = `0`, JSONL replay line count 일치가 아니면 validation CLI suite를 실패 처리한다. 이 unsigned diagnostic은 signed elbow/knee inversion 증명으로 사용하지 않는다.
  - 검증: Xbot smoke에서 agreement metrics `maxFrameAgeP95Ms=24.3`, `maxPoseSolverP95Ms=0.1`, `maxHingeViolationFrames=0`, `allJsonlReplayLineCountsMatch=true`, `qualityGates.passed=true`로 통과.
- 2026-07-02 P5.1 기반:
  - motion recording을 JSONL로 export/import하는 `serializeMotionRecordingJsonl`, `parseMotionRecordingJsonl`, `getMotionRecordingJsonl`, `loadMotionRecordingJsonl` 경로를 추가했다.
  - JSONL은 recording header 1줄과 frame 1줄/프레임 구조이며 원본 영상은 `source` 참조로만 남기고 raw video/model bytes는 금지한다.
  - 검증: `tests/motion-frame-check.mjs` round-trip, frameCount 불일치, raw binary 금지 테스트.
  - 브라우저 검증: `npm run motion:avatar`가 JSONL export/load replay를 사용하도록 변경됐고 Xbot/Soldier/Polydancer에서 JSONL line count = frame count + 1, replay delta `0.01-0.18%`로 통과했다.
- 2026-07-02 P4.1/P5.2/status audit:
  - 화면 오른쪽 레일에 `Motion State` HUD를 추가해 facing, mode, quality, delegate, FPS, frame-age p95, solver p95, drop ratio를 표시한다.
  - 동일 스냅샷을 `window.motionTrackerDebug.getMotionStatusHudSnapshot()`으로 노출했다.
  - `scripts/hmr-jsonl-adapter.mjs`와 `npm run hmr:jsonl`을 추가해 external HMR recording JSON/JSONL을 검증하고 replay 가능한 recording JSONL로 변환할 수 있게 했다.
  - HMR adapter가 generic `mediapipe33`/`coco17` joint-array 입력을 MediaPipe-33 recording contract로 변환할 수 있게 확장했다.
  - `docs/MOTION_GOAL_STATUS.md`에 각 체크포인트의 `done`/`partial`/`deferred`/`blocked_external_input` 상태와 증거를 기록했다.
  - 검증: `npm run check` 통과.
  - 검증: `npm run validate:synthetic` 통과(`scenarioCount=6`, `frameCount=54`, `maxHingeViolationCount=0`, `maxHingeLimitWarningCount=0`, `maxModeChanges=2`는 `lost-and-reacquired`의 의도된 lost/full-body 전이).
  - 검증: `npm run validate:clips`는 schema 유효, `clipCount=0`이라 `unavailable`.
  - 검증: synthetic external HMR recording 샘플로 `npm run hmr:jsonl -- --input output/tmp/external-hmr-sample.json --output output/tmp/external-hmr-sample.jsonl` 통과(`frameCount=1`, pose/world landmark 각 33개).
  - 검증: `npm run hmr:jsonl -- --input output/tmp/coco17-hmr-sample.json --joint-format coco17 --output output/tmp/coco17-hmr-sample.jsonl` 통과(`frameCount=2`, pose/world landmark 각 33개, extractor `wham`).
  - 검증: Xbot agreement smoke 통과(`overall=99.46%`, `frameAgeP95=31.8ms`, `poseSolverP95=0.10ms`, unsigned hinge diagnostic `0`, JSONL replay line count 일치).
- 2026-07-02 P4.2/P4.3/P2.4 추가:
  - `Motion State` HUD에 depth calibration readiness와 guide를 추가해 warming/ready/static/coverage 부족 상태가 보이도록 했다.
  - renderer에 lost tracking recovery state를 추가해 lost mode에서는 body bones를 짧게 hold 후 rest pose로 easing하고, 재획득 후 retarget strength를 `180ms` 동안 blend-in 하도록 했다.
  - validation CLI synthetic metrics에 target angular velocity, reliable target angular velocity, static jitter RMS를 추가했다.
  - 검증: `npm run check`, `npm run perf:avatar`, `npm run validate:synthetic` 통과. synthetic metrics는 `maxStaticJitterRmsDegPerSec=0`, unsigned hinge diagnostic/soft warning `0`.
  - 검증: Xbot agreement smoke 통과(`overall=99.38%`, `frameAgeP95=28.3ms`, `poseSolverP95=0.10ms`, unsigned hinge diagnostic `0`, JSONL replay line count 일치).
- 2026-07-02 P2.2/P5.3 추가:
  - `validate:clips`가 manifest schema뿐 아니라 중복 scenario, 알 수 없는 scenario 참조, clip path 존재 여부, scenario별 required label, scenario coverage를 검증하도록 확장했다.
  - `validate:clips`가 label별 값 구조까지 검증하도록 확장했다. facing/mode token, interval, timeline, joint list, hinge limit, angular velocity, head rotation, recovery label이 스키마에 맞지 않으면 실패한다.
  - `scripts/motion-recording-compare.mjs`와 `npm run compare:recordings`를 추가해 live/browser recording과 offline/HMR recording을 같은 pure solver로 풀고 target-direction angle delta와 hinge-flexion delta를 JSON 리포트로 비교한다.
  - `tests/motion-recording-compare-check.mjs`를 `npm run check`에 편입해 동일 synthetic recording은 target/hinge delta `0`, 다른 synthetic turn recording은 target delta가 발생하는지 검증한다.
  - `npm run compare:recordings -- --html ...`이 target/hinge delta timeline SVG, by-bone/by-joint summary, worst-frame tables를 포함한 정적 HTML 비교 리포트를 생성하도록 확장했다.
  - 검증: `npm run check`, `npm run validate:synthetic` 통과.
  - 검증: `npm run validate:clips`는 real clip 0개라 `unavailable`이지만 `coveredScenarioCount=0`, `missingScenarioIds=7`, `scenarioCoverage`, `labelSchemaLabelCount=18`을 명시적으로 보고한다.
  - 검증: `npm run compare:recordings -- --live output/tmp/identity-live.jsonl --offline output/tmp/identity-offline.jsonl --output output/reports/live-vs-offline-synthetic.json` 통과(`pairedFrames=9`, target/hinge max delta `0`).
  - 검증: `npm run compare:recordings -- --live output/tmp/identity-live.jsonl --offline output/tmp/turn-offline.jsonl --output output/reports/live-vs-offline-synthetic-turn.json --html output/reports/live-vs-offline-synthetic-turn.html` 통과(`pairedFrames=9`, target max `180deg`, hinge max `0deg`).
  - 검증: Xbot agreement smoke 통과(`overall=99.77%`, `frameAgeP95=30.7ms`, `poseSolverP95=0.10ms`, unsigned hinge diagnostic `0`, soft warning `11f`, JSONL replay line count 일치).
- 2026-07-02 P2.4 synthetic gate 상향:
  - synthetic validation에 reliable occlusion spike count, suppressed low-confidence spike count, mode chatter, facing chatter 지표와 quality gate를 추가했다.
  - `tests/solver-synthetic-check.mjs`에 turn facing chatter 0, lost/full-body mode chatter 0, occluded low-confidence target의 reliable spike 0 assertion을 추가했다.
  - 검증: `npm run check` 통과.
  - 검증: `npm run validate:synthetic` 통과(`maxReliableOcclusionSpikeCount=0`, `maxModeChatterEvents=0`, `maxFacingChatterEvents=0`, `maxStaticJitterRmsDegPerSec=0`, suppressed low-confidence spike `1`은 raw occluded jump가 reliable gate에서 제외됐음을 보여주는 진단값).
  - 검증: `npm run validate:all -- --only-models --model Xbot=assets/models/Xbot.glb --debug-overlay off --min-pose-frames 120 --warmup-pose-frames 60` 통과. synthetic gate 통과, clips는 real clip 0개라 `unavailable`, Xbot agreement는 `overall=99.54%`, `frameAgeP95=38.7ms`, `poseSolverP95=0.10ms`, unsigned hinge diagnostic `0`, JSONL replay line count 일치.
  - 재검증: same bounded `validate:all` latest 통과. synthetic `maxReliableOcclusionSpikeCount=0`, `maxModeChatterEvents=0`, `maxFacingChatterEvents=0`, agreement Xbot `overall=99.38%`, `frameAgeP95=33.6ms`, `detectP95=123.8ms`, `poseSolverP95=0.10ms`, unsigned hinge diagnostic `0`, soft warning `16f`, JSONL `120 lines / 119 frames`.
- 2026-07-02 goal audit 추가:
  - `scripts/motion-goal-audit.mjs`와 `npm run goal:audit`를 추가해 최신 HUD/pump/agreement 리포트, clip manifest, HMR 비교 산출물을 읽고 P0/P1/P2/P5 증거와 외부-input blocker를 분리해 감사한다.
  - 검증: `npm run goal:audit` 통과(`status=passed_with_external_blockers`, `failedCount=0`, `externalBlockerCount=15`). P1/P2 real acceptance는 실제 clip/labels 부재, P5.2는 실제 offline HMR sample 부재로 명시된다.
- 2026-07-02 P4.1/P4.2 browser smoke:
  - `scripts/motion-status-hud-smoke.mjs`와 `npm run smoke:hud`를 추가해 headless Chrome에서 sample video를 업로드하고 Motion State HUD DOM과 `getMotionStatusHudSnapshot()`을 비교한다.
  - smoke는 HUD JSON 리포트와 PNG 스크린샷을 `output/reports/motion-status-hud-smoke-latest.*`에 기록한다.
  - 검증: `npm run smoke:hud` 통과(`framesWithPose=62`, facing `Front`, mode `Full Body`, quality `Good`, delegate `CPU`, frame age `38ms`, solver `0.1ms`, calibration `Ready 100%`, guide `Locked`).
- 2026-07-02 P4.2 manual calibration control:
  - Motion State 패널에 `Calibrate` 버튼을 추가해 기존 `resetDepthCalibration()` 경로를 사용자-facing control로 연결했다.
  - 버튼 클릭 시 body validation과 depth calibration reference를 재시작하고 HUD를 즉시 갱신한다.
  - `npm run smoke:hud`가 `Calibrate` 클릭 직후 `Warm 0/30`으로 돌아간 뒤 다시 readiness를 회복하는지 검증하도록 확장했다.
  - 검증: `npm run check`, `npm run smoke:hud` 통과(`framesWithPose=62`, reset before `Ready 100%`, reset after `Warm 0/30`, final calibration `Ready 100%`, guide `Locked`).
- 2026-07-02 P4.2 calibration pose quality:
  - `estimateCalibrationPoseQuality()`를 추가해 shoulder/arm coverage, 좌우 팔 펼침, 어깨 높이 대비 팔 높이, symmetry, visibility를 기반으로 T-pose-style 보정 자세 품질을 산출한다.
  - renderer depth calibration snapshot과 `getDepthCalibrationReport()`에 `poseQuality`를 포함하고, HUD warmup guide가 `Open arms`/`Level arms`/`Stay visible`로 품질 사유를 반영하도록 했다.
  - 검증: `npm run check` 통과. `tests/depth-calibration-check.mjs`는 synthetic T-pose가 target score 이상으로 pass하고 arms-down 자세가 `arms_not_open`/`arms_not_level`로 fail하는지 확인한다.
  - 검증: `npm run smoke:hud` 통과(`framesWithPose=63`, final calibration `Ready 100%`, guide `Locked`, reset failures `[]`, final sample poseQuality score `0.42`/failed because sample pose is not T-pose). `npm run validate:synthetic` 통과(`maxReliableOcclusionSpikeCount=0`, `maxModeChatterEvents=0`, unsigned hinge diagnostic/soft warning `0`).
- 2026-07-02 P1.2 hinge warning diagnostics:
  - 실제 crossed-arms/behind-back clip 없이 hinge limit 자체를 완화하지 않고, renderer pose solver metrics에 `hingeLimitWarningByName`, `maxHingeFlexDegByName`, `maxHingeOverflowDegByName`을 추가했다.
  - agreement smoke summary와 validation CLI model summary가 관절별 soft warning count/최대 flex/초과각을 보존하도록 연결했다.
  - 검증: `npm run check`, `npm run smoke:hud`, `npm run validate:synthetic` 통과.
- 2026-07-02 full motion gate 재검증:
  - `npm run motion:avatar`를 재실행해 Xbot/Soldier GLB/Polydancer VRM 기본 비디오 agreement gate를 모두 통과했다.
  - 결과: Xbot `overall=99.57%`, `frameAgeP95=14.9ms`, `detectP95=119.2ms`, `solverP95=0.10ms`, unsigned hinge diagnostic `0`, soft warning `22f`, JSONL `240 lines / 239 frames`.
  - 결과: Soldier GLB `overall=98.02%`, `frameAgeP95=8.6ms`, `detectP95=115.2ms`, `solverP95=0.10ms`, unsigned hinge diagnostic `0`, soft warning `22f`, JSONL `242 lines / 241 frames`.
  - 결과: Polydancer VRM `overall=99.26%`, `frameAgeP95=7.4ms`, `detectP95=116.7ms`, `solverP95=0.10ms`, unsigned hinge diagnostic `0`, soft warning `31f`, JSONL `241 lines / 240 frames`.
  - 경고: length solver clamp가 모델별 `32.1-35.7%`, Soldier projected arms diagnostic `53.0% < 80%`, Soldier visual arms diagnostic `73.7% < 75%`로 남아 실제 팔 접힘/가림 clip 확보 뒤 품질 판단이 필요하다.
- 남은 gap:
  - 실제 7개 실패 시나리오 clip 파일과 라벨이 없어 clip-family 회귀 게이트는 아직 완성되지 않았다.
  - P5.2/P5.3은 generic joint-array import와 JSON/HTML 비교 리포트 골격까지 가능하지만, 실제 offline HMR 샘플과 라벨 clip 확보 전에는 acceptance gate로 승격할 수 없다.
  - P4.2는 수동 reset과 자세 품질 점수까지 구현됐지만, 실제 T-pose 영상 라벨 기반 자동 gate 승격은 아직 검증되지 않았다.
  - soft hinge-limit warning은 motion gate에서 모델별 `22-31f` 관찰된다. 이제 관절별 원인/초과각은 기록되지만, unsigned hinge min-limit diagnostic `0/0f`는 signed 역굴절 증거가 아니므로 실제 팔 접힘 품질 개선은 crossed-arms/behind-back clip 또는 signed limb-plane solver 확보 뒤 limit/retarget 조정을 해야 한다.
  - GPU delegate 목표 `20/33ms`는 실 GPU 브라우저 환경에서 아직 검증되지 않았다. headless smoke는 GPU 요청/telemetry 검증에는 성공했지만 detect p95 `479.4ms`로 SwiftShader 성격이라 실제 성능 증거로 쓰지 않는다.

## 복사용 Codex Goal

```text
/goal Follow GOAL_PLAN.md exactly. First review the plan against its checklist, patch any missing plan details, then execute checkpoint by checkpoint until all P0 final completion criteria pass and P1/P2 items are either completed or explicitly deferred with evidence. Before final completion, run independent verification with a separate subagent or clean environment when possible; if not possible, record why and run the strongest practical substitute verification. Keep a compact progress log. After required targets pass, perform up to 3 safe stretch-improvement rounds only for allowed performance/quality metrics in GOAL_PLAN.md. Pause only for missing approvals, credentials, destructive changes, external blockers, or evidence that the target is infeasible under the stated constraints.
```
