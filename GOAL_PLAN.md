# action-tracker Face/Head Retargeting Improvement Goal Plan

작성일: 2026-07-05
대상 저장소: `/Users/chasoik/Projects/action-tracker`
대상 런타임: Codex goal mode
계획 출처: Claude Code fable/xhigh 설계안, 사용자 goal objective, 현재 코드 상태 검토

## 목표 요약

- 최종적으로 달성해야 할 결과:
  - 카메라에서 추적된 얼굴 방향과 아바타에서 보이는 Head/Neck 방향이 mirror, MediaPipe face transform, pose head aim, VRM0/VRM1 rest axis 기준에서 일관되게 맞도록 수정한다.
  - 아바타 얼굴이 한쪽 방향에 고정되거나 face tracking 재획득 시 반대쪽으로 튀는 현상을 줄이고, 방향 전환이 연속적으로 보이도록 한다.
  - 문제를 다시 진단할 수 있도록 face transform, pose aim, final bone direction, root yaw, face reset/reacquire 상태를 리포트/테스트/브라우저 smoke에서 관측 가능하게 만든다.
- 작업 대상/범위:
  - `src/avatar-renderer.js`, `src/app.js`, `src/motion-frame.js`, `src/motion-worker.js`
  - 신규 또는 보강 테스트: `tests/*`
  - 신규 또는 보강 검증 스크립트: `scripts/*`
  - 문서: `README.md`, `docs/*`, 이 `GOAL_PLAN.md`
- 명시적 비목표:
  - Live2D 지원, VTuber studio 기능, 외부 HMR 필수 런타임 도입은 하지 않는다.
  - 대용량 로컬 VRM 파일(`assets/models/*.vrm`)이나 로컬 산출물은 사용자 승인 없이 커밋하지 않는다.
  - 파괴적 git 조작, 사용자 변경 되돌리기, 임의 원격 push는 하지 않는다.

## 기준선과 가정

- 현재 상태/기준선:
  - `main`은 `origin/main`과 동기화되어 있으며 최근 커밋은 `15e33c3 fix: stabilize avatar head retargeting`.
  - `npm run check`, GitHub Pages smoke, 기존 VRM motion agreement는 이전 실행에서 통과했다.
  - 현재 작업트리에는 로컬 검증용 untracked VRM 파일과 `docs/superpowers/`가 남아 있으며 커밋 대상이 아니다.
  - Head/Neck에는 root yaw, pose aim, face transform delta가 순차 적용되고 있어 writer 경합과 reset/reacquire jump 가능성이 있다.
- 확인해야 할 미지수:
  - MediaPipe face transform matrix data가 현재 runtime에서 column-major인지 row-major인지.
  - mirror mode에서 face transform yaw/pitch/roll 부호가 pose landmark head aim과 같은 화면 기준을 쓰는지.
  - VRM0/VRM1별 Head rest secondary axis가 실제 모델 정면을 가리키는지.
  - face tracking 결측/재획득 시 base quaternion 재캡처가 실제 jump를 만드는지.
- 가정:
  - 기본 UX는 mirror input ON, face expressions ON, strict retarget 기본값을 유지한다.
  - 실시간 브라우저 앱 구조와 `motionFrame` recording/replay 계약은 유지한다.
  - 목표 상향은 사용자 동의가 없으므로 비활성화한다.

## 단계별 계획

| 단계 | 작업 내용 | 단계별 목표 스펙/성능 수준 | 검증 방법 | 단계 완료 조건 |
|---|---|---|---|---|
| 1 | 계획/기준선 보정과 현재 코드 흐름 조사 | 기존 계획이 현재 face/head 목표와 일치하고 위험 경로가 함수명 기준으로 정리됨 | `git status`, `rg`, 관련 파일 읽기 | `GOAL_PLAN.md`가 현재 목표를 반영하고 진행 로그가 시작됨 |
| 2 | face/head 진단 telemetry 추가 | matrix layout, face Euler, base age/reset/reacquire, aim/bone Euler, root yaw, jump counters가 debug report에 노출됨 | `tests/contract-check.mjs`, focused unit test | `window.motionTrackerDebug.getAvatarMotionState()` 또는 performance report에서 진단 필드 확인 가능 |
| 3 | face transform 디코딩/부호 검증 유틸 분리 | synthetic row/column-major matrix와 mirror 부호가 결정적으로 검증됨 | 신규 `tests/face-head-pose-check.mjs` | yaw/pitch/roll 복원과 mirror 부호 테스트 통과 |
| 4 | face base lifecycle 안정화 | 1프레임 결측으로 base가 폐기되지 않고 재획득 시 부드럽게 blend-in | unit test + browser smoke telemetry | face drop/reacquire 시 head yaw jump < 15도 또는 원인 리포트 |
| 5 | Head/Neck writer 경합 완화 | strict mode에서도 Head/Neck은 재획득 blend와 smoothing을 적용하고 pose/face 목표가 불연속적으로 싸우지 않음 | strict/solver/retarget tests | Head target 결측/복귀 시 jump counter가 기준 이하 |
| 6 | VRM Head/Neck rest axis 교정 | Head secondary axis가 VRM0/VRM1 모델 정면과 정렬됨 | 신규 rest-axis test, VRM motion report | 접근 가능한 VRM0/VRM1에서 `headRestForwardDot >= 0.9` 또는 명확한 예외 기록 |
| 7 | root yaw 안정화 | strict root yaw hypothesis 전환이 rate-limit/smoothing됨 | `tests/facing-estimator-check.mjs`, browser report | root yaw jump가 head jump 원인으로 남지 않음 |
| 8 | head-pose 브라우저 smoke 추가 | 실제 페이지에서 face/bone yaw 부호 일치와 연속성을 JSON 리포트로 검증 | 신규 또는 확장 script 실행 | sign match >= 0.9, correlation >= 0.8, 600deg/s 초과 jump 0회 또는 예외 근거 |
| 9 | 문서/사용법 업데이트 | 새 진단 API, smoke 명령, 한계가 문서화됨 | docs review, `npm run check` | README/docs에 실행 방법과 판정 기준 반영 |
| 10 | 최종 검증과 대체 독립 검증 | 전체 회귀와 목표 기준이 현재 상태에서 증명됨 | 최종 검증 명령과 clean/dependency 대체 검증 | 완료 기준별 pass/fail 증거가 최종 보고에 포함됨 |

## 최종 목표 스펙/성능

- 필수 완료 기준:
  - `npm run check` 통과.
  - `git diff --check` 통과.
  - face/head 관련 신규 unit/contract test 통과.
  - default GLB, Polydancer VRM, 접근 가능한 로컬 VRM0, 접근 가능한 로컬 VRM1 중 가능한 모델에서 브라우저 head-pose 또는 motion agreement 검증 통과.
  - head yaw 부호 일치율 >= 0.9, face/bone yaw 상관계수 >= 0.8, 600deg/s 초과 jump 0회. 데이터가 해당 지표를 산출하지 못하면 그 이유와 대체 지표를 기록한다.
  - face drop/reacquire 시 bone yaw jump < 15도. 재현 데이터가 없으면 synthetic/forced gap 테스트와 브라우저 telemetry로 대체하고 남은 위험을 기록한다.
- 성능/품질 목표:
  - pose solver p95 <= 2ms.
  - 기존 motion agreement direction/front-back gate를 낮추지 않는다.
  - default avatar ready, VRM upload, face expressions, motion recording/replay 경로가 깨지지 않는다.
- 회귀 방지 기준:
  - expression, VRM rendering, strict retarget, facing estimator, motion frame, recording/replay 관련 기존 테스트가 통과한다.
  - 새 진단 telemetry는 기본 렌더링 경로를 과도하게 무겁게 만들지 않는다.
- 산출물:
  - 변경 코드와 테스트.
  - head-pose smoke/report JSON.
  - README/docs 업데이트.
  - 최종 검증 요약과 남은 위험.

## 독립 검증 정책

- 최종 완료 선언 전 독립 검증 필요 여부:
  - 필요하다.
- 권장 검증 주체/환경:
  - 가능하면 별도 서브에이전트 또는 clean worktree/fresh checkout에서 최종 완료 기준을 재실행한다.
- 독립 검증자가 확인할 기준:
  - 신규 face/head tests와 smoke가 실제 목표 지표를 커버하는지.
  - 기존 motion/VRM/recording 회귀가 깨지지 않았는지.
  - untracked local VRM 파일과 로컬 산출물이 의도치 않게 커밋 대상이 되지 않았는지.
- 독립 검증이 불가능할 때의 대체 검증:
  - 이유를 기록한다.
  - `git status --short`, `npm run check`, `git diff --check`, 브라우저 smoke/report 재생성, 가능하면 dependency reinstall 또는 clean clone 기반 테스트를 수행한다.
- 최종 보고/대화 transcript에 포함할 검증 증거:
  - 실행 명령, 결과 요약 또는 exit code, 생성 report 경로, 모델별 주요 수치, 미해결 위험, 완료 기준별 pass/fail.

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
  - 기존 `GOAL_PLAN.md`가 2026-07-02의 전신 모션 개선 계획이어서, 현재 사용자 목표인 face/head 방향 불일치 개선 계획으로 교체했다.
  - 현재 작업트리에는 untracked `assets/models/1406500396179985353.vrm`, `assets/models/7791455125217346676.vrm`, `docs/superpowers/`가 있으며, 이들은 검증 입력/로컬 파일로만 취급하고 커밋 대상에서 제외한다.
- 2026-07-05 단계 2-4 완료:
  - `src/face-head-pose.js`를 추가해 MediaPipe face transform row/column-major 판별, YXZ quaternion/euler 변환, mirror yaw/roll 부호 보정, face base lifecycle, short-gap hold, reacquire blend를 순수 유틸로 분리했다.
  - `tests/face-head-pose-check.mjs`를 추가해 matrix layout, yaw/pitch 복원, mirror 부호, missing/reacquire lifecycle을 검증했다.
  - `src/avatar-renderer.js`와 `src/app.js`에 `faceHeadPose` telemetry를 추가해 status, layout diagnostics, face Euler, Head bone Euler, angular velocity, jump count, reacquire state를 motion state/body validation report에서 볼 수 있게 했다.
- 2026-07-05 단계 5-7 완료:
  - strict retarget에서도 Head/Neck profile targets는 smoothing/reacquire blend를 적용하도록 조정해 pose head aim과 face transform correction이 불연속적으로 싸우는 경로를 줄였다.
  - Head/Neck rest secondary axis는 모델 forward 기준으로 보정하고 `rig.boneOrientation.byBone.Head.restForwardDot`으로 진단한다.
  - strict root yaw에는 smoothing/rate-limit telemetry를 추가했다. 기존 direction/front-back motion gate 자체는 낮추지 않았다.
- 2026-07-05 단계 8-9 완료:
  - `scripts/head-pose-smoke.mjs`와 `npm run smoke:head`를 추가해 browser motion runner 결과에서 face/head jump, yaw sign/correlation(샘플 충분 시), Head rest forward dot을 gate/report한다.
  - `README.md`와 `docs/avatar-model-validation.md`에 `faceHeadPose`, `processValidationMotionFrame`, `smoke:head`, VRM Head rest-axis 기준과 headless sample video 한계를 문서화했다.
- 2026-07-05 검증 결과:
  - `npm run check`: 통과.
  - `git diff --check`: 통과.
  - `npm run smoke:head`: 통과, `output/reports/head-pose-smoke-latest.json`; Xbot `headRestForwardDot=0.975`, Head jump `0`, face yaw samples insufficient.
  - VRM head smoke: 통과, `output/reports/head-pose-smoke-vrm-latest.json`; Polydancer `0.974`, local VRM `1406500396179985353=0.968`, local VRM `7791455125217346676=0.988`, 모두 Head jump `0`. 로컬 VRM 파일은 untracked 검증 입력으로만 사용했다.
  - `npm run motion:avatar`: Xbot/Polydancer direction/frontBack gate 통과, Soldier도 motion overall `0.995`, direction `1.0`, depth frontBack `0.964`, pose solver p95 `0.10ms`, Head jump `0`. 다만 Soldier `frontBackVisual=0.50` diagnostic component 때문에 script exit 1.
  - Soldier 단독 baseline worktree(`HEAD=15e33c3`)에서도 같은 `frontBackVisual=0.50` failure가 재현되고 replay delta failure가 추가로 발생했다. 따라서 이 failure는 이번 face/head 변경의 신규 회귀가 아니라 기존 Soldier projected-visual diagnostic 한계로 분리한다.
  - `/tmp/action-tracker-current-verify` clean copy에서 `npm run check`와 `npm run smoke:head`를 재실행해 통과했다.
