# action-tracker Root Yaw Recovery Goal Plan

작성일: 2026-07-05
대상 저장소: `/Users/chasoik/Projects/action-tracker`
대상 런타임: Codex goal mode
계획 출처: `shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4` 9~11초 회전 원인 분석, 사용자 `/goal` objective, 현재 코드 상태 검토

## 계획 검토 결과

- 판정: 보완 필요 -> 이 파일에서 보완 완료.
- 보완한 항목:
  - 기존 계획은 face/head retarget 안정화 완료 로그가 중심이어서, 현재 증상인 torso/root yaw 오인식 이후 재획득 복구 문제를 별도 목표로 분리했다.
  - 단계별 root yaw reliability, hold, reacquire, renderer fast recovery, clip-specific validation 기준을 추가했다.
  - 최종 완료 기준에 `shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4` 8.5~11.5초 구간 검증과 독립 검증 정책을 명시했다.

## 목표 요약

- 최종적으로 달성해야 할 결과:
  - 스켈레톤이 일시적으로 잘못 인식되어 root yaw hypothesis가 흔들리더라도, 신뢰 가능한 torso/root yaw가 다시 안정되면 아바타 root 방향이 올바른 방향으로 자동 복구된다.
  - 불안정 구간에서는 잘못된 side-order flip 또는 raw yaw jump를 즉시 root target으로 채택하지 않고 hold 또는 약한 update로 처리한다.
  - 재획득 구간에서는 큰 yaw error가 오래 남지 않도록 bounded fast recovery를 적용하고, 이 상태가 리포트/telemetry에서 관측 가능해야 한다.
- 작업 대상/범위:
  - `src/solver/facing-estimator.js`, `src/solver/pose-solver.js`
  - `src/retarget/skeleton-fk-retarget.js`, `src/avatar-renderer.js`
  - `src/app.js`, `tests/*`, `scripts/*`, `README.md` 또는 `docs/*`, 이 `GOAL_PLAN.md`
- 명시적 비목표:
  - MediaPipe 모델 자체를 교체하지 않는다.
  - 기존 `motionFrame` recording/replay 계약을 breaking change 하지 않는다.
  - 기존 direction/front-back motion agreement gate를 낮추지 않는다.
  - 대용량 로컬 VRM 파일(`assets/models/*.vrm`)과 로컬 산출물은 사용자 승인 없이 커밋하지 않는다.
  - 파괴적 git 조작, 사용자 변경 되돌리기, 임의 원격 push는 하지 않는다.

## 기준선과 가정

- 현재 상태/기준선:
  - 작업 시작 기준 커밋은 `e37c78a fix: stabilize face head retargeting`.
  - 현재 브랜치는 `codex/root-yaw-recovery`.
  - 기존 untracked `assets/models/1406500396179985353.vrm`, `assets/models/7791455125217346676.vrm`, `docs/superpowers/`는 검증 입력/로컬 파일로만 취급한다.
  - 이전 분석에서 8.5~11.5초 연속 기록은 `side-right -> front -> side-left -> front`와 side-order flip/raw jump를 보였고, renderer strict root smoothing/rate-limit가 잘못된 target을 뒤늦게 따라가며 방향 이상을 만들 수 있음이 확인됐다.
- 확인해야 할 미지수:
  - reliability 조건이 정상적인 빠른 회전까지 과도하게 막지 않는지.
  - hold 후 fast recovery가 root yaw를 튀게 하지 않고 실제 안정 신호로 복귀시키는지.
  - strict retarget과 legacy root orientation 양쪽 telemetry가 같은 판단을 드러내는지.
- 가정:
  - 실시간 앱 기본 UX, strict retarget 기본값, face expression 기본값은 유지한다.
  - 목표 상향은 사용자 동의가 없으므로 비활성화한다.

## 단계별 계획

| 단계 | 작업 내용 | 단계별 목표 스펙/성능 수준 | 검증 방법 | 단계 완료 조건 |
|---|---|---|---|---|
| 1 | 계획/기준선 보정 | 계획이 root yaw recovery 목표와 체크리스트를 충족하고 변경 브랜치/dirty scope가 확인됨 | `git status`, `git log -1`, 관련 파일 읽기 | 이 파일이 현재 목표를 반영하고 진행 로그가 시작됨 |
| 2 | 회귀 테스트 먼저 추가 | unstable yaw 후 stable yaw 재획득 시 solver가 recoverable/reliable 상태와 last reliable yaw를 드러냄 | `node tests/facing-estimator-check.mjs`가 먼저 실패해야 함 | 실패 원인이 missing reliability/recovery 필드 또는 잘못된 복구 동작임 |
| 3 | facing estimator reliability/reacquire 구현 | `yawReliable`, `yawReliabilityReason`, stable/unreliable frame counters, `lastReliableYawDeg`, `recoveringFromUnreliableYaw`가 deterministic하게 계산됨 | `node tests/facing-estimator-check.mjs` | transient bad side-order/raw jump는 unreliable/hold, 이후 stable frame은 recovery로 통과 |
| 4 | strict/legacy root orientation 적용 | renderer가 unreliable yaw를 hold/weak update하고 recovery 중 bounded fast blend를 사용함 | unit/contract test, smoke report telemetry | root yaw telemetry에 hold/recovery 상태와 target/actual error가 노출됨 |
| 5 | clip/report 검증 강화 | 8.5~11.5초 구간에서 root yaw raw jump/side flip이 있어도 stable reacquire 후 avatar target/actual이 수렴함 | `scripts/avatar-motion-agreement-check.mjs` continuous run, report JSON 검사 | report에 root yaw reliability/recovery 요약과 통과/예외 근거가 남음 |
| 6 | 문서/진행 로그 업데이트 | 새 telemetry와 한계를 README/docs/계획 로그에 기록함 | docs review, `git diff --check` | 사용자가 같은 문제를 재진단할 수 있는 명령과 필드가 문서화됨 |
| 7 | 최종 및 독립 검증 | 전체 회귀와 목표 기준이 현재 상태에서 증명됨 | `npm run check`, `git diff --check`, targeted smoke, 별도 subagent 또는 clean copy 검증 | 완료 기준별 pass/fail 증거가 final에 포함됨 |

## 최종 목표 스펙/성능

- 필수 완료 기준:
  - `npm run check` 통과.
  - `git diff --check` 통과.
  - root yaw reliability/reacquire 관련 신규 또는 보강 테스트 통과.
  - `shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4` 8.5~11.5초 연속 검증 리포트가 생성되고, stable reacquire 이후 root yaw target/actual error가 유한한 bounded threshold 안으로 수렴하거나 한계가 명확히 기록됨.
  - root yaw unreliable/hold/recovery 상태가 debug report 또는 motion state에서 관측 가능함.
- 성능/품질 목표:
  - pose solver p95 <= 2ms 유지.
  - 기존 motion agreement direction/front-back gate를 낮추지 않는다.
  - default GLB, Polydancer VRM, 접근 가능한 로컬 VRM 검증 경로를 깨지 않는다.
- 회귀 방지 기준:
  - face/head, VRM rendering, strict retarget, facing estimator, motion frame, recording/replay 관련 기존 테스트가 통과한다.
  - root yaw recovery는 low-confidence/body-lost 상태에서 임의 snap을 만들지 않는다.
- 산출물:
  - 변경 코드와 테스트.
  - root yaw continuous validation report JSON.
  - README/docs 또는 계획 로그 업데이트.
  - 최종 검증 요약과 남은 위험.

## 독립 검증 정책

- 최종 완료 선언 전 독립 검증 필요 여부:
  - 필요하다.
- 권장 검증 주체/환경:
  - 가능하면 별도 subagent가 diff와 완료 기준을 read-only로 검증한다.
  - subagent가 불가능하면 clean copy 또는 fresh checkout에서 핵심 검증을 재실행한다.
- 독립 검증자가 확인할 기준:
  - 신규 root yaw tests가 실제 복구 동작을 커버하는지.
  - 기존 motion/VRM/recording 회귀가 깨지지 않았는지.
  - untracked local VRM 파일과 로컬 산출물이 의도치 않게 커밋 대상이 되지 않았는지.
- 독립 검증이 불가능할 때의 대체 검증:
  - 이유를 기록한다.
  - `git status --short`, `npm run check`, `git diff --check`, targeted continuous clip 검증, 가능하면 clean copy 테스트를 수행한다.
- 최종 보고/대화 transcript에 포함할 검증 증거:
  - 실행 명령, 결과 요약 또는 exit code, 생성 report 경로, 주요 수치, 미해결 위험, 완료 기준별 pass/fail.

## 성능 목표 상향 정책

- 사용자 동의 여부: 미확인.
- 필수 목표 달성 후 추가 상향 없이 종료한다.
- 상향 가능한 지표와 금지 범위는 사용자 동의가 있을 때만 추가한다.

## 중단/질문 조건

- destructive git 작업, credential/permission 필요, 외부 GitHub/Pages 장애, 로컬 모델 라이선스/커밋 여부 판단 필요, 목표 수치가 현재 데이터 한계상 불가능하다는 명확한 증거가 있을 때 멈추고 보고한다.
- 기존 공개 API나 `motionFrame` recording format을 breaking change 해야 하는 경우 멈추고 보고한다.
- 실제 카메라/사용자 동작이 필수인 검증이 필요하지만 headless/sample video로 대체할 수 없는 경우 대체 증거와 함께 보고한다.

## 진행 로그 규칙

- 각 체크포인트마다 현재 단계, 변경 사항, 검증 결과, 남은 일, 차단 여부를 짧게 기록한다.
- 실패하면 원인을 분석하고 수정-검증 루프를 반복한다.
- 장시간 작업 중에는 의미 있는 상태 업데이트를 남긴다.
- final 보고에는 변경 파일, 주요 설계 결정, 검증 명령과 결과, 남은 위험, 다음 추천 작업을 포함한다.

## 현재 진행 로그

- 2026-07-05 단계 1 시작:
  - `GOAL_PLAN.md`를 현재 root yaw recovery 목표로 재작성했다.
  - `goal-planner` 체크리스트 기준으로 기존 계획의 missing detail을 보완했다.
  - 작업 브랜치를 `codex/root-yaw-recovery`로 분리했다.
- 2026-07-05 단계 2 완료:
  - `tests/facing-estimator-check.mjs`에 transient 180도 yaw 오인식 hold, stable yaw 재획득, recovery target null 보존 테스트를 추가했다.
  - RED 확인: 기존 코드는 `yawReliable` 필드가 없고 transient bad yaw를 hold하지 않아 테스트가 실패했다.
- 2026-07-05 단계 3-4 완료:
  - `src/solver/facing-estimator.js`에 `yawReliable`, `yawReliabilityReason`, `unreliableYawFrames`, `stableYawFrames`, `recoveringFromUnreliableYaw`, `lastReliableYawDeg`, `recoveryTargetYawDeg`를 추가했다.
  - side-order flip 또는 raw yaw jump 후보는 1프레임 hold하고, 같은 후보가 안정되면 bounded recovery로 채택하도록 했다.
  - `src/solver/pose-solver.js`, `src/retarget/skeleton-fk-retarget.js`, `src/avatar-renderer.js`, `src/app.js`에 root yaw reliability/recovery telemetry를 전달했다.
  - renderer는 recovery active 구간에서 전용 smoothing/rate limit를 사용하고, unreliable 구간은 solver가 hold한 yaw target을 따른다.
- 2026-07-05 단계 5 완료:
  - `scripts/root-yaw-recovery-smoke.mjs`와 `npm run smoke:root-yaw`를 추가했다.
  - full browser smoke 통과: `output/reports/root-yaw-recovery-latest.json`; root yaw target error p90 `6.292deg`, median `0.906deg`, root yaw unreliable `18`, recovering `5`, stable-after-unreliable `15`, 8.5-11.5초 solver window sample `55`, unreliable `7`, recovering `2`, stable-after-unreliable `6`, failures `[]`.
- 2026-07-05 단계 6 진행:
  - `README.md`와 `docs/avatar-model-validation.md`에 `smoke:root-yaw` 실행 방법과 root yaw reliability/recovery report 필드를 문서화했다.
- 2026-07-05 독립 검증 반영:
  - 별도 subagent가 read-only 검증을 수행했고, `scripts/root-yaw-recovery-smoke.mjs`가 untracked인 점, target error metric 부재 hard-fail 누락, browser recovery telemetry gate 부족을 지적했다.
  - smoke script는 commit 대상 구현 파일로 유지하고, p90/median/count 부재 시 fail하도록 보강했다.
  - browser report에 `stableAfterUnreliableCount`를 추가해 explicit `recovered` sample이 없더라도 hold 이후 stable reacquire가 관측되도록 했다.
- 2026-07-05 최종 로컬 검증:
  - `npm run check`: 통과.
  - `git diff --check`: 통과.
  - `npm run smoke:root-yaw`: 통과, `output/reports/root-yaw-recovery-latest.json`.
  - VRM 포함 head smoke: 통과, `output/reports/head-pose-smoke-root-yaw-vrm-latest.json`; Xbot, Polydancer VRM, local VRM 1406, local VRM 7791 모두 Head jump gate 통과.
- 2026-07-05 최종 독립/대체 검증:
  - `/tmp/action-tracker-root-yaw-verify` clean copy에서 `npm run check`: 통과.
  - 독립 subagent 재검토: 이전 blocker/risk resolved; 남은 caveat는 `scripts/root-yaw-recovery-smoke.mjs`를 최종 staging/commit 시 포함하고, untracked local VRM 및 `docs/superpowers/`는 제외해야 한다는 범위 확인뿐이다.
