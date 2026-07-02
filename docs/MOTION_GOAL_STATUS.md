# Motion Goal Status

작성일: 2026-07-02
대상 계획: `GOAL_PLAN.md`

## 상태 기준

- `done`: 코드와 검증 명령으로 현재 완료가 증명됨.
- `partial`: 실행 가능한 골격은 있으나 목표 전체를 증명할 데이터나 후속 구현이 남음.
- `deferred`: 현재 환경이나 사용자 승인/에셋 부족으로 보류가 명확함.
- `blocked_external_input`: 실제 영상, 라벨, 실기기 GPU처럼 외부 입력 없이는 더 강한 증거를 만들 수 없음.

## 체크포인트 현황

| 항목 | 상태 | 현재 증거 | 남은 일 |
|---|---|---|---|
| P0.1 저장소 위생 | done | 로컬 산출물 ignore 추가, `npm run check` 통과 이력 | 최종 커밋 전 status 재확인 |
| P0.2 GPU delegate 보고 | done | pose/hand/face detector가 GPU 우선, CPU fallback, report/HUD 노출. delegate report에 detector별 `attempted`와 `fallbackReasons` 포함. CPU smoke에서 pose/hand `attempted=[CPU]`, fallbackReasons `{}` 확인. `npm run smoke:hud:gpu` 통과: requested `GPU`, pose/hand active `GPU`, pose/hand `attempted=[GPU]`, fallbackReasons `{}` | 실브라우저 GPU에서 20/33ms 성능 목표만 별도 재측정 |
| P0.3 latest-wins frame pipeline | done | rVFC stale callback drop, frame-age/lag 지표. latest `npm run perf:pump` 통과: rVFC `overall=99.54%`, frame-age p95 `30.5ms`, detect p95 `125.6ms`, frame p95 `126.2ms`, stale callback `19`, duplicate `0` | 실제 GPU/실촬영에서 재측정 |
| P0.4 validation opt-in | done | `?validation=on`에서만 body validation sample 집계 | 최종 검증 재실행 |
| P1.1 pure solver boundary | done | `src/solver/pose-solver.js`, renderer consumes solver target/meta | legacy renderer 잔재 제거 여부는 P1.7에서 판단 |
| P1.2 hinge 제약 | blocked_external_input | synthetic unsigned hinge min-limit diagnostic 0, left elbow MAE 0.5deg 이하. 현재 hinge 각도는 3-point unsigned inner-angle 기반이라 signed 역굴절 증명은 아니다. `hingeLimitWarningByName`, `maxHingeFlexDegByName`, `maxHingeOverflowDegByName`로 soft warning 원인 관절/초과각을 리포트. `goal:audit`가 `P1.2.real-crossed-arms-hinge`를 외부 입력 blocker로 보고 | real crossed-arms/behind-back clip 또는 signed limb-plane solver로 역굴절 품질 확인 후 limit/retarget 조정 |
| P1.3 facing FSM | blocked_external_input | synthetic 180도 전이 1회, HUD/debug snapshot 노출. `goal:audit`가 `P1.3.real-facing-transition`을 외부 입력 blocker로 보고 | 실제 turn clip과 지연 300ms 이하 라벨 검증 |
| P1.4 occlusion hold/decay | blocked_external_input | low-confidence wrist fixture와 renderer hold/decay 상태. `goal:audit`가 `P1.4.real-occlusion-hold-decay`를 외부 입력 blocker로 보고 | 실제 등 뒤 팔 clip에서 spike 0회 확인 |
| P1.5 upper-body mode FSM | blocked_external_input | upper-body synthetic mode, low-confidence legs decay. `goal:audit`가 `P1.5.real-upper-body-mode`를 외부 입력 blocker로 보고 | 실제 상반신 clip에서 chatter 0회 확인 |
| P1.6 smoothing/filter 통일 | deferred | 현재 retarget smoothing 모드는 유지 | jitter/latency 라벨 clip 확보 뒤 조정 |
| P1.7 legacy solver 제거 | deferred | 새 solver 경계는 있으나 renderer aim path가 아직 적용 담당 | real clip gate 녹색 전까지 삭제 보류 |
| P2.1 synthetic GT | done | 6개 synthetic scenario와 `tests/solver-synthetic-check.mjs`, lost/reacquired mode 전이 포함 | real clip coverage 추가 |
| P2.2 clip family | blocked_external_input | 7개 scenario manifest schema, 중복/unknown scenario/path/required label/coverage 검증 존재. label value schema는 18개 required label의 token/interval/timeline/joint-list/hinge/head/recovery 구조를 검증. clips 0개라 unavailable | 사용자 제공/승인 real clip과 labels 필요 |
| P2.3 validation CLI | done | synthetic/clips/agreement suite, package scripts. latest bounded `npm run validate:all -- --only-models --model Xbot=assets/models/Xbot.glb --debug-overlay off --min-pose-frames 120 --warmup-pose-frames 60` 통과: synthetic gate pass, clips unavailable by empty manifest, agreement Xbot `overall=99.38%`, age `33.6ms`, detect `123.8ms`, solver `0.10ms`, unsigned hinge diagnostic `0`, soft warning `16f`, JSONL `120 lines / 119 frames` | 실제 clip 확보 뒤 real-suite 승격 |
| P2.4 증상 직결 지표 | blocked_external_input | frame age, hinge, facing/mode, stale, JSONL replay, HUD, synthetic target angular velocity/static jitter RMS, reliable occlusion spike, suppressed low-confidence spike, mode/facing chatter gate 노출. synthetic latest: reliable occlusion spike `0`, mode/facing chatter `0`, static jitter `0`. `goal:audit`가 real clip coverage 부재를 blocker로 보고 | real clip spike/chatter 라벨 기반 지표 확장 |
| P3.1 three-vrm 적용 | deferred | VRM metadata/mapping 자체 처리 유지 | 런타임 스택 전환은 별도 승인/벤치 후 진행 |
| P3.2 GLB canonical 정규화 | partial | VRM/GLB 진단과 Mixamo/VRM mapping 유지 | solver target을 완전한 canonical humanoid output으로 고정 |
| P4.1 상태 HUD | done | `Motion State` HUD와 `getMotionStatusHudSnapshot()` 추가. `npm run smoke:hud` 통과: Front/Full Body/Good/CPU, screenshot `output/reports/motion-status-hud-smoke-latest.png` | 최종 검증 재실행 |
| P4.2 T-pose calibration UX | partial | HUD에 depth calibration readiness/guide와 `Calibrate` 버튼 추가. `poseQuality`가 shoulder/arm coverage, 팔 펼침, 팔 높이, symmetry, visibility를 점수화한다. `npm run smoke:hud`가 `framesWithPose=63`, reset before `Ready 100%`, reset after `Warm 0/30`, final `Ready 100%`/`Locked`, reset failures `[]` 확인 | 실제 T-pose 영상 라벨 기반 자동 gate 승격은 별도 후속 |
| P4.3 lost tracking 복귀 | partial | `lost-and-reacquired` synthetic에서 full-body -> lost -> full-body 전이, unsigned hinge diagnostic 0; renderer lost hold/rest easing/reacquire blend-in 추가 | 실제 소실/복귀 clip에서 스냅 복귀 0회 확인 필요 |
| P5.1 JSONL recording export | done | JSONL export/import, replay line-count gate. latest `npm run motion:avatar`에서 Xbot `240 lines / 239 frames`, Soldier `242 lines / 241 frames`, Polydancer `241 lines / 240 frames` line count 일치 | 실제 offline/HMR 샘플과 비교 gate 연결 |
| P5.2 offline HMR scaffold | partial | `npm run hmr:jsonl` adapter가 normalized external recording과 generic `mediapipe33`/`coco17` joint-array 입력을 MediaPipe-33 JSONL로 변환. synthetic coco17 sample은 `frameCount=2`, pose/world 33개, extractor `wham` | 실제 외부 HMR 샘플 1개 replay 필요 |
| P5.3 live-vs-offline viewer | partial | `npm run compare:recordings` CLI가 live/offline JSON/JSONL을 같은 solver로 비교하고 target-angle/hinge-flexion delta JSON과 정적 HTML timeline report를 생성. synthetic turn sample은 `pairedFrames=9`, target max `180deg`, hinge max `0deg`, report `output/reports/live-vs-offline-synthetic-turn.html` | 실제 offline HMR 샘플/라벨 확보 뒤 acceptance gate로 승격 |

## 현재 완료 불가 증거

- `npm run validate:clips`는 manifest schema, clip path, required label, scenario coverage를 확인하지만 `clips: []`라 `unavailable`이 정상 상태다. 실제 실패 시나리오 영상과 라벨 없이는 P2.2, real P1 게이트, P5.2 샘플 replay를 완료로 볼 수 없다.
- `npm run goal:audit`는 현재 리포트와 manifest를 감사해 `status=passed_with_external_blockers`, `failedCount=0`, `externalBlockerCount=15`를 보고한다. P1/P2 real acceptance 항목은 synthetic/agreement 증거는 있으나 real clip/HMR 입력 없이는 더 승격할 수 없다는 점이 기계적으로 확인된다.
- headless GPU smoke는 requested/attempted/active delegate telemetry 증거로는 사용 가능하지만, detect p95 `479.4ms`라 실제 GPU delegate 목표 `20ms/33ms` 성능 증거로 쓰기 어렵다. 이 목표는 사용자의 실제 브라우저/GPU 환경이나 별도 실기기 검증이 필요하다.
- soft hinge-limit warning은 unsigned min-limit diagnostic과 분리되어 있으며, 현재 지표만으로 signed elbow/knee inversion 해결을 증명하지 않는다. 실제 팔 접힘 품질 개선 여부는 crossed-arms/behind-back clip 또는 signed limb-plane solver 없이 완료로 판단할 수 없다.

## 다음 추천 순서

1. 브라우저에서 기본 모델 정면/팔 움직임 수동 확인. HUD 표시는 `npm run smoke:hud`로 자동 확인됨.
2. 사용자가 real clip/labels를 제공하면 `tests/fixtures/clip-family/manifest.json`을 채우고 P1/P2 real gates를 strict하게 전환.
3. 실제 offline HMR 샘플이 생기면 `npm run compare:recordings -- --html ...` 리포트를 기준으로 acceptance threshold와 라벨 기반 판정을 추가한다.
4. 실 GPU 브라우저에서 delegate `GPU` 기준 detection p50/p95를 재측정해 P0.2 성능 목표 달성 여부를 확정한다.
