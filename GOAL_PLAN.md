# action-tracker 실시간 스켈레톤·아바타 제품 개발 목표 계획

작성일: 2026-07-14

기준 제품 소스: `f18c212`의 `src/**`

대상 저장소: `/Users/chasoik/Projects/action-tracker`

목표 성격: 제품 구현 우선, SAM teacher 기반 폐루프 개선

## 이 계획의 지위

- 이 파일이 현재 목표의 유일한 실행 기준이다.
- 이 파일은 2026-07-10부터 작성된 기존 `GOAL_PLAN.md`, 그 진행 로그, 하위 모듈 계획, 검증 전용 phase gate보다 우선한다.
- 기존 검증 중심 계획은 `docs/archive/GOAL_PLAN-validation-heavy-20260714.md`에 보관한다. 보관 문서는 선행 조건이나 완료 조건이 아니다.
- 기존 exact-PTS manifest, source/teacher inventory, baseline harness, 비교기와 테스트는 재사용할 수 있다. 단, 제품 구현을 막는 추가 계약·스키마·리뷰 절차로 확장하지 않는다.
- 실행 중인 `manual-review-operations@r3`, blind A/B/C0, reviewer agreement 작업은 중단·보류 대상으로 간주한다. 이 계획에서 명시적으로 다시 필요하다고 판단하기 전에는 재개하지 않는다.
- 다른 문서와 충돌하면 실제 제품 동작을 개선하는 이 계획의 단계와 성공 기준을 따른다.

## 최종 목표

`output/test-videos`의 영상과 실시간 카메라 입력을 낮은 지연으로 처리해 정확한 3D 스켈레톤을 만들고, 그 스켈레톤으로 Xbot·Soldier·Polydancer 아바타를 안정적으로 움직인다.

`sam-3d-body-skeletons`의 오프라인 고급 모델 결과는 이 목표에서 정답에 가까운 teacher로 가정한다. teacher의 품질을 다시 입증하는 것이 목표가 아니라, teacher와 실시간 결과의 차이를 측정하고 실제 런타임·스켈레톤·리타게팅 코드를 개선하는 것이 목표다.

완성된 제품 경로는 다음과 같다.

```text
camera/video frame + source PTS
  -> real-time body/hand/face inference
  -> canonical skeleton + confidence
  -> causal temporal stabilization
  -> rig-aware local rotations + root motion + IK
  -> actual avatar bones
  -> renderer
```

teacher 경로는 개발과 최종 평가에만 사용한다. 제품 런타임이 teacher 파일이나 미래 프레임에 의존해서는 안 된다.

## 제품 우선 실행 원칙

1. 주 산출물은 `src/**`의 동작 변화다. 보고서, 계약, 스키마, 수동 리뷰 팩은 보조 산출물이다.
2. 최초 최소 기준선 이후 완료되는 모든 단계는 실제 제품 파일을 변경해야 한다. `src/**` 변경과 전후 수치가 없으면 단계 진척으로 기록하지 않는다.
3. 검증만 하는 체크포인트를 두 번 연속 수행하지 않는다. 검증에서 문제를 찾으면 다음 체크포인트는 그 원인을 고치는 제품 구현이어야 한다.
4. 평가 도구의 버그는 결과를 왜곡하는 최소 범위만 수정하고 회귀 테스트 하나를 추가한 뒤 제품 구현으로 돌아간다.
5. 새 평가 계약 버전, 새 blind cycle, 새 reviewer agreement, 새 hash/TOCTOU/sandbox 방어는 사용자 승인 없이는 만들지 않는다.
6. 수동 시각 평가는 자동 수치로 판별할 수 없는 최종 체감 확인에만 쓴다. 성능 개선의 선행 게이트로 쓰지 않는다.
7. threshold, 데이터 분할, 제외 규칙, 시간 offset은 결과를 본 뒤 유리하게 바꾸지 않는다. 변경이 필요하면 기존 결과와 새 결과를 함께 남기고 사용자 승인을 받는다.
8. 실패한 측정은 숨기지 않되, 실패 증거를 더 정교하게 만드는 데 시간을 쓰기보다 가장 큰 제품 병목을 고친다.
9. 로그는 체크포인트당 최대 10줄로 유지한다. 긴 분석은 별도 보고서에 저장하고 이 파일에는 경로와 핵심 수치만 기록한다.
10. 성능 개선은 실제 target runtime의 headful Chrome, GPU delegate, worker 경로에서 확인한다. 합성 테스트만 통과한 상태를 제품 완료로 보지 않는다.

## 범위와 비범위

### 범위

- `src/motion-worker.js`, `src/motion-forwarding.js`, `src/motion-frame.js`, `src/app.js`의 캡처·추론·전달 경로
- `src/solver/**`, `src/skeleton/**`, depth/facing 모듈의 canonical 3D skeleton 정확도와 confidence 처리
- `src/retarget/**`, `src/retarget-orientation.js`, `src/avatar-renderer.js`, humanoid mapping의 rig-aware 리타게팅
- root 이동·방향, 발 고정·IK, 손목/손가락, head/face 결합, 저신뢰 구간과 재획득 처리
- Xbot, Soldier, Polydancer의 실제 bone 적용 결과
- 카메라와 영상 입력에서의 지연, 처리율, queue/drop, 장시간 안정성
- 위 제품 변화를 판별하는 최소 자동 비교와 회귀 테스트

### 비범위

- SAM teacher 자체를 재학습하거나 모든 teacher frame을 사람이 다시 라벨링하는 작업
- 정확도와 지연 개선에 직접 쓰이지 않는 범용 평가 플랫폼 제작
- 실제 오차를 가리는 자동 시간 offset 탐색, 비인과적 미래 프레임 smoothing, teacher 데이터의 런타임 사용
- 결과가 나올 때마다 데이터셋·분모·threshold를 바꾸는 작업
- UI 전면 재설계, 새로운 아바타 포맷 지원, 배포 인프라 확장은 이 목표에 필요할 때만 별도 승인 후 수행한다.

실시간 모델 교체나 보조 모델 도입은 허용한다. 다만 target runtime에서 현재 경로보다 정확도와 지연이 실제로 좋아지고, 라이선스·모델 크기·초기화 비용이 제품 제약에 맞는다는 수치가 있어야 한다.

## 고정 데이터와 최소 teacher 확인

### 데이터 분할

개발 중 반복 튜닝은 다음 4개 development clip과 Xbot을 기본으로 한다.

- `dance-16x9-padded`
- `shorts-keGbIts0CA0-16x9-padded`
- `shorts-new-dance-E9_h_ZW5z0U-16x9-padded`
- `shorts-vc0GDveRIp0-16x9-padded`

다음 3개 challenge clip은 held-out으로 고정한다. 단계 중간의 파라미터 선택에는 쓰지 않고, P4 회귀 확인과 P5 최종 평가에서만 연다.

- `arms-crossed`
- `csi-pose`
- `jujae-regression-0-16_5`

`jujae.mp4`는 paired teacher가 없으므로 정확도 분모에 넣지 않는다. 카메라와 함께 장시간 처리율·안정성·시각 smoke에만 사용한다.

최종 정확도 행렬은 7 paired clips × 3 rigs = 21 cells로 고정한다.

P0 기준선은 `f18c212`의 제품 동작에 실제 출력 telemetry만 추가한 상태에서 4 development clips × Xbot으로 만든다. telemetry가 제품 출력을 바꾸지 않는다는 self-test를 통과한 뒤 그 source/patch identity를 `BASELINE_ID`로 기록하고 P1부터 고정한다. P5에서는 별도 clean worktree의 같은 `BASELINE_ID`로 challenge 3 clips × 3 rigs를 한 번만 재생한다. 이 최종 baseline 결과는 튜닝에 사용하지 않는다.

### 재사용할 고정 증거

- `tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl`: 7 paired clips, exact source PTS 6,711 rows
- `tests/fixtures/sam-goal-v2/labels/source-inventory.json`
- 각 `sam-3d-body-skeletons/<clip>/skeletons_mhr70.jsonl`, metadata, summary
- `scripts/sam-goal-source-pts.mjs`, `scripts/sam-goal-baseline.mjs`와 이미 존재하는 비교 코드

이 증거에 대해서는 작업 시작 시 아래 항목만 한 번 확인한다.

- 7개 paired video와 teacher JSONL이 존재한다.
- exact PTS manifest의 clip별 row 수와 총 6,711 rows가 inventory와 일치한다.
- 비교에 필요한 teacher joints가 finite인지, person 결과가 존재하는지 확인한다.
- source PTS가 단조 증가하고 video와 teacher clip ID가 일치한다.

이 확인이 통과하면 teacher validity를 더 세분화한 리뷰·anchor·agreement 작업은 하지 않는다. teacher가 실제로 잘못된 frame은 고정 exclusion 파일에 `clip`, `sourcePTS`, `reason`을 기록할 수 있지만, live 실패 frame을 제외하거나 결과를 본 뒤 exclusion을 늘릴 수 없다.

## 최소 폐루프 측정 계약

평가기는 아래 세 층의 원인을 구분할 정도로만 유지한다.

| 층 | 비교 대상 | 필수 측정 |
| --- | --- | --- |
| Skeleton | teacher canonical skeleton vs live canonical skeleton | major-bone 각도, hinge flexion, root yaw, root-relative N-MPJPE, PA-MPJPE, joint coverage |
| Avatar | 같은 RigProfile로 retarget한 teacher pose vs live가 실제 적용한 avatar pose | actual local-bone quaternion, wrist/ankle/head FK endpoint, root transform, contact slide, endpoint coverage |
| Runtime | source frame이 들어온 시점 vs avatar bone에 적용된 시점 | body output Hz, render FPS, P95 applied latency, queue depth, overload/stale drop, crash |

필수 telemetry는 source PTS, monotonic capture/receive/apply time, live canonical joints/rotations/confidence, 실제 적용한 local bone quaternion, root transform, FK endpoints, active delegate/worker/model/pump mode다.

Avatar 비교는 방향 벡터나 solver 중간값이 아니라 렌더러에 실제 적용된 local quaternion을 사용한다. teacher와 live는 동일한 canonical pose, 좌표계, RigProfile, FK 구현을 통과해야 한다. 동일 pose를 양쪽에 넣는 self-test에서 quaternion error ≤ 0.1°와 endpoint error ≤ avatar height의 0.001%가 나와야 실제 제품 비교를 시작할 수 있다.

시간 정렬은 exact source PTS를 사용하며 offset은 0으로 고정한다. 누락된 live frame은 보간으로 성공 처리하지 않고 coverage와 drop으로 드러낸다. 시각 overlay와 수동 review는 이 자동 측정의 대체물이 아니다.

## 구현 단계

| 단계 | 상태 | 제품 산출물 | 종료 조건 |
| --- | --- | --- | --- |
| P0. 최소 기준선과 actual-output 연결 | 완료 | 실제 avatar bone telemetry, 동일-pose self-test, 4 development clips × Xbot 기준선 | 한 번의 구현 체크포인트 안에 기준선 표와 병목 우선순위가 나오고 P1 제품 수정을 시작함 |
| P1. 실시간 frame/inference 파이프라인 | 완료 | bounded latest-frame pump, worker 기본 경로, exact source timing, 불필요한 readback 제거 | target runtime에서 queue ≤ 1, 처리율·지연 전후 개선, fallback이 명시적으로 보임 |
| P2. canonical skeleton 정확도·안정성 | 완료 | 좌표계/관절 adapter 통일, confidence 기반 causal filter, hold/decay/reacquire, depth/facing 보정 | development clips에서 skeleton 지표가 기준선보다 실질 개선되고 runtime 목표를 깨지 않음 |
| P3. rig-aware retarget과 실제 bone 적용 | 완료 | RigProfile/rest basis/축 보정, local rotation 적용, rig-local FK, 중복 hierarchy 제거 | Xbot의 avatar 지표 개선 후 Soldier·Polydancer에서도 같은 pose 의미를 유지함 |
| P4. root/contact/IK/hand/head 통합 | **진행 중** | root SE(3), planted-foot lock와 two-bone IK, 3D palm/finger, body head + face delta, 저신뢰 복구 | development와 처음 공개한 held-out 결과가 모두 개선되고 contact·detail 회귀가 없음 |
| P5. 실시간 제품 완성·독립 최종 검증 | 대기 | 카메라/영상 통합, 3 rigs, 10분 soak, 회귀 테스트와 운영 가능한 실행 경로 | 아래 최종 성공 기준을 모두 만족하고 독립 검증자가 재현함 |

### P0 — 최소 기준선과 actual-output 연결

목표는 평가 시스템을 완성하는 것이 아니라 현재 제품에서 가장 큰 오차가 skeleton, retarget, runtime 중 어디에 있는지 한 번에 식별하는 것이다.

- exact-PTS와 teacher 최소 확인을 한 번 실행한다.
- `avatar-renderer`가 실제로 적용한 local quaternion/root와 FK endpoint를 기록한다. 이미 동등한 telemetry가 있으면 새 형식을 만들지 않고 재사용한다.
- 동일한 canonical pose를 teacher/live 양쪽 입력으로 주는 self-test 하나만 만든다.
- 4 development clips × Xbot을 현재 제품 설정으로 1회 측정한다.
- Skeleton/Avatar/Runtime의 가장 큰 P95 오차와 coverage/latency 병목을 순서대로 기록한다.
- 기존 manual review r3, blind cycle, 전체 21-cell 실행은 하지 않는다.

P0의 허용 기간은 한 번의 구현 체크포인트다. telemetry 결함이 없으면 즉시 P1 또는 수치상 더 큰 제품 병목 단계로 이동한다.

### P1 — 실시간 frame/inference 파이프라인

- 영상에서는 `requestVideoFrameCallback`의 media time을 source PTS와 연결하고, 카메라에서는 monotonic capture time을 유지한다.
- 처리 중 새 frame이 들어오면 오래된 대기 frame을 버리는 capacity-1 latest-frame pump를 사용한다. 무제한 queue와 병렬 추론 누적을 금지한다.
- body inference는 worker가 기본이며 lazy init과 명시적 fallback reason을 가진다.
- full-resolution CPU readback, 중복 canvas 복사, render와 inference의 불필요한 동기화를 profiler로 찾아 제거한다.
- body/hand/face cadence는 분리할 수 있으나, 의도적 cadence skip과 overload/stale drop을 별도 집계한다.
- target runtime의 before/after latency·Hz·drop과 제품 코드 diff를 함께 남긴다.

### P2 — canonical skeleton 정확도와 시간 안정성

- 모든 detector 출력을 하나의 좌표계, handedness, 단위, joint ID, root/pelvis 정의로 변환하는 adapter를 둔다.
- 2D/3D/world landmark 혼용, mirrored input, depth scale, facing ambiguity가 solver 내부로 새지 않게 한다.
- position만 맞추지 말고 major-bone local rotation, hinge flexion, root yaw를 teacher와 직접 비교하며 solver를 고친다.
- confidence별로 valid/held/decaying/lost/reacquiring 상태를 명시하고, 저신뢰 frame이 마지막 정상 pose를 무기한 고정하지 않게 한다.
- smoothing과 prediction은 과거·현재 frame만 사용하는 causal 방식이어야 한다. 큰 동작에서는 지연을 줄이고 정지 구간에서는 jitter를 줄이도록 confidence와 velocity에 적응한다.
- development clip별 개선을 확인하고, 한 clip의 hard-coded 보정 대신 공통 원인을 수정한다.

### P3 — rig-aware retarget과 실제 bone 적용

- canonical local rotation을 avatar humanoid bone의 실제 local quaternion으로 적용한다. 방향 벡터만 맞춘 중간 pose를 성공으로 보지 않는다.
- rig마다 rest local transform, bone axis, pre/post rotation, parent basis를 명시하는 RigProfile을 사용한다.
- 동일한 물리 bone을 두 hierarchy나 두 solver가 동시에 갱신하지 않게 단일 소유권을 둔다.
- FK와 endpoint 측정은 실제 rig-local hierarchy와 적용 quaternion을 사용한다.
- 먼저 Xbot에서 teacher-retarget vs live-applied 오차를 줄인 뒤, Soldier와 Polydancer에서 축·비율·rest pose 차이를 보정한다.
- rig-specific 보정이 canonical skeleton을 오염시키지 않게 retarget 계층에만 둔다.

### P4 — root, contact, IK, 손과 머리 통합

- pelvis translation, scale, floor, yaw를 하나의 root SE(3) 상태로 관리하고 좌우/전후 이동과 회전을 분리해 검증한다.
- 고정된 소수의 contact window에서 planted foot의 world position을 잠그고 two-bone IK로 knee/ankle을 보정한다. 전체 frame을 사람이 세 번 검토하는 방식은 쓰지 않는다.
- 손은 3D palm orientation과 finger curl/spread를 사용하고 wrist roll을 단순 2D 방향으로 대체하지 않는다.
- head는 body 기반 orientation을 기준으로 하고 face 결과는 confidence가 충분할 때 delta로 합성한다.
- occlusion과 재등장 시 snap, frozen limb, foot skating을 confidence state와 reacquire blend로 해결한다.
- held-out 3 clips는 구현이 끝난 뒤 한 번 공개해 회귀 여부를 확인하며, 그 결과에 맞춘 clip별 상수를 추가하지 않는다.

### P5 — 제품 통합과 독립 최종 검증

- 영상과 실제 카메라가 같은 canonical/retarget 경로를 사용하고, 입력 전환 시 상태가 안전하게 reset되는지 확인한다.
- Xbot, Soldier, Polydancer 전체에서 7 paired clips를 측정한다.
- 최종 회귀 판정을 위해 별도 clean worktree의 고정 `BASELINE_ID`로 challenge 3 clips × 3 rigs를 같은 환경에서 한 번 재생한다. 이 결과는 구현 선택에 사용하지 않는다.
- target Chrome headful GPU/worker 경로에서 10분 연속 카메라 또는 `jujae.mp4` soak를 수행한다.
- 제품 동작을 보호하는 최소 회귀 테스트를 `npm run check`에 연결한다. 검증 인프라 자체의 모든 방어 테스트를 추가할 필요는 없다.
- 구현에 참여하지 않은 독립 검증자가 고정 명령, raw 결과, 제품 diff를 확인하고 최종 기준을 재실행한다.

## 단계별 작업 루프

P0 이후에는 아래 순서를 반복한다.

1. 현재 지표에서 사용자 체감과 최종 기준에 가장 큰 병목 하나를 선택한다.
2. 병목의 원인이 되는 실제 runtime call path와 제품 파일을 추적한다.
3. 하나의 원인 가설에 해당하는 `src/**` 변경을 구현한다.
4. 관련 unit/synthetic test와 `npm run check`를 실행한다.
5. development clips × 필요한 최소 rig만 재실행해 before/after와 runtime 회귀를 비교한다.
6. 좋아지면 유지하고 다음 병목으로 이동한다. 나빠지면 원인을 고치거나 해당 변경만 되돌린다.
7. 체크포인트 로그 10줄 이내로 남기고 즉시 다음 제품 변경으로 진행한다.

한 단계의 모든 세부 항목이 완벽해질 때까지 다음 단계를 막지 않는다. 측정 결과 더 큰 병목이 다른 계층에 있으면 그 단계로 이동하되, 이유와 수치를 로그에 남긴다.

## 최종 성공 기준

모든 정확도 수치는 고정된 7 paired clips 전체와 명시된 coverage 분모에서 계산한다. aggregate 통과만으로 challenge clip 실패를 숨길 수 없다.

### Skeleton 정확도

- major-bone angular error aggregate P95 ≤ 20°
- 각 challenge clip의 major-bone angular error P95 ≤ 30°
- hinge-flex error P95 ≤ 25°
- root-yaw error P95 ≤ 15°
- root-relative N-MPJPE와 PA-MPJPE가 각각 같은 7 paired clips의 고정 `BASELINE_ID` 대비 30% 이상 개선
- hand joint coverage ≥ 90%
- held-out 각 핵심 지표가 P5에서 같은 조건으로 재생한 고정 `BASELINE_ID`보다 10% 넘게 악화되지 않음

### 실제 Avatar 동작

- actual local-bone quaternion error P95 ≤ 20°
- wrist/ankle/head FK endpoint error P95 ≤ avatar height의 4%
- endpoint coverage ≥ 90%
- root-yaw error P95 ≤ 15°
- 고정 contact windows에서 planted-foot slide speed P95 ≤ avatar height의 1%/s
- Xbot, Soldier, Polydancer 세 rig가 모두 통과

### 실시간 성능과 안정성

- body output rate ≥ `min(source FPS, 30 Hz)`
- render rate ≥ 60 FPS
- source/capture PTS부터 실제 avatar bone 적용까지 latency P95 ≤ 80 ms
- inference queue depth ≤ 1
- overload/stale drop ratio ≤ 5%; 의도적 cadence skip은 별도 표기
- target runtime 10분 연속 실행 중 crash 0회, 무한 queue 증가 0회, 영구 frozen pose 0회

절대 threshold를 만족하더라도 고정 `BASELINE_ID`보다 실질 개선이 없으면 완료가 아니다. 반대로 일부 threshold가 남아 있으면 측정 체계를 더 확장하지 말고 가장 큰 제품 원인을 계속 수정한다.

## 필수 검증과 독립 최종 확인

각 제품 변경의 필수 검증은 다음으로 제한한다.

- 변경 모듈의 focused test 또는 synthetic contract test
- `npm run check`
- 영향받는 development clip/rig의 before/after 자동 비교
- runtime을 건드렸다면 headful target runtime의 latency/Hz/drop 확인
- renderer/retarget을 건드렸다면 actual applied bone과 FK endpoint 확인

P5의 독립 검증자는 다음을 새 실행에서 확인한다.

- 이 계획의 데이터 분할, exclusion, offset, threshold가 결과 생성 전에 고정되어 있었는지
- 제품 diff가 실제 입력 → skeleton → avatar call path에 연결되는지
- 동일-pose self-test와 `npm run check`가 통과하는지
- 21-cell raw 결과에서 집계 수치가 재계산되는지
- target runtime의 10분 soak와 latency/queue/drop이 재현되는지
- threshold 미달·missing cell·fallback을 성공으로 집계하지 않았는지

독립 검증은 최종 확인 한 번만 수행한다. 단계마다 새로운 독립 reviewer cycle을 만들지 않는다.

## 목표 상향 정책

- 자동 목표 상향은 **비활성화**한다.
- 성공 기준을 더 엄격하게 하거나 범위를 넓히는 변경은 사용자가 명시적으로 승인할 때만 한다.
- 결과를 본 뒤 목표를 낮추거나 분모를 줄이는 변경도 사용자 승인 없이는 하지 않는다.

## 중단·질문 조건

다음 경우에만 구현을 멈추고 사용자에게 판단을 요청한다.

- paired source 또는 teacher가 실제로 누락·손상되어 고정 분모를 유지할 수 없음
- target camera/GPU/browser에 접근할 수 없어 최종 runtime 기준을 측정할 수 없음
- 새 모델의 라이선스·다운로드 크기·외부 서비스 비용이 제품 결정을 요구함
- 목표 달성에 저장소 밖 서비스 변경이나 새로운 장치 구매가 필요함
- 고정 threshold나 데이터 분할을 바꾸지 않고는 목표 자체가 물리적으로 불가능하다는 재현 가능한 증거가 있음

개별 테스트 실패, 어려운 버그, 성능 미달, 오래 걸리는 구현은 중단 조건이 아니다. 안전한 범위에서 원인을 좁히고 제품 수정을 계속한다.

## 현재 상태와 즉시 다음 작업

- 제품 기준 SHA: `f18c212`
- 고정 `BASELINE_ID`: `f18c212-p0telemetry-948f26175360`
- 완료 단계: 3/6
- 재사용 가능: exact source PTS 6,711 rows, source/teacher inventory, baseline harness, 기존 비교·synthetic test
- 참고만 함: manual pack compiler/auditor와 기존 evaluation contract 문서
- 보류: `manual-review-operations@r3`, blind A/B/C0, reviewer agreement, 추가 contract/schema hardening
- 즉시 다음 작업:
  1. same-graph Body `VIDEO` reset r3은 contact 품질을 보존했지만 reset 321.6ms와 첫 detect 317.7ms를 연속 지불해 gate 643.9ms·apply max 320.9ms·Body 23.3910Hz로 미통과했으므로 재시도하지 않는다.
  2. 이미 폐기된 generic arm jump-confirmation, Hand local rate cap, detector absolute/residual palm owner를 반복하지 않고 Pose33 endpoint와 teacher MHR70 MCP 의미 불일치를 해소하는 canonical/distilled Hand 제품 표현을 설계한다.
  3. 기존 dance actual-state recording과 teacher를 고정 입력으로 먼저 판정하고, 통과한 제품 revision만 fresh development before/after로 확장하며 challenge는 P5 최종 판정 전까지 다시 열지 않는다.

## 체크포인트 로그 형식

각 체크포인트는 아래 형식으로 최대 10줄만 추가한다.

```text
YYYY-MM-DD HH:mm KST | Pn | 상태
가설/병목:
제품 변경: src/... (핵심 동작 한 줄)
Before: 정확도 / coverage / latency / Hz / drop
After:  정확도 / coverage / latency / Hz / drop
검증: 실행 명령과 pass/fail
산출물: raw report 경로
결론: 유지/수정/되돌림
다음 제품 작업:
블로커: 없음 또는 사용자 판단이 필요한 항목
```

검증 인프라 작업만 있었던 체크포인트는 진척률을 올리지 않는다.

## 완료 체크리스트

- [x] P0 최소 기준선과 actual-output 연결 완료
- [x] P1 실시간 frame/inference 파이프라인 완료
- [x] P2 canonical skeleton 정확도·안정성 완료
- [x] P3 세 rig의 rig-aware retarget 완료
- [ ] P4 root/contact/IK/hand/head 통합 완료
- [ ] P5 카메라·영상·10분 soak와 21-cell 최종 행렬 완료
- [ ] Skeleton 최종 성공 기준 전부 통과
- [ ] 실제 Avatar 최종 성공 기준 전부 통과
- [ ] 실시간 성능·안정성 최종 성공 기준 전부 통과
- [ ] 독립 최종 검증 통과

모든 체크가 끝났을 때만 이 목표를 완료로 표시한다.

## 진행 로그

2026-07-14 13:23 KST | P0 | 완료
가설/병목: 실제 renderer 출력이 없어 skeleton·retarget·runtime 원인을 폐루프로 분리할 수 없었음
제품 변경: `src/avatar-renderer.js`, `src/avatar-applied-state.js`, `src/app.js`에 actual bone/root/FK/source timing 연결
Before: actual state·bone·FK coverage 0%; closed-loop avatar error와 applied latency 측정 불가
After: actual state/bone/FK/sourcePTS 100%; exact pairs 412/2486; body 5.70Hz; latency P95 386.5ms; quat P95 93.42°; FK P95 18.96%H
검증: exact PTS 6,711 PASS; teacher minimum PASS; same-pose ≤0.1°/≤0.001%H PASS; `npm run check` PASS; dev 4/4 완료
산출물: `output/sam-goal-p0-baseline/f18c212-p0telemetry-948f26175360`
결론: `BASELINE_ID=f18c212-p0telemetry-948f26175360` 고정, 가장 큰 runtime 병목을 P1에서 수정
다음 제품 작업: bounded latest-frame body pump와 독립 hand worker로 직렬 추론 tail 제거
블로커: 없음
2026-07-14 14:29 KST | P1 | 완료
가설/병목: 직렬 body/hand 추론과 누적 전체-report polling이 source callback 및 worker 응답을 막았음
제품 변경: `src/app.js`, `src/motion-worker.js`, `src/hand-worker.js`, `src/latest-frame-pump.js`, `src/hand-roi.js`에 독립 bounded pump·worker 기본 경로·bounded progress/active-rate telemetry 적용
Before: dance exact 93/359; major/hinge 42.091°/56.915°; latency P95 332ms; output 5.740Hz
After: dance exact 358/359; major/hinge 40.406°/57.226°; latency P95 25.3ms; output 23.933Hz; queue max 1; overload/stale/error 0
검증: `npm run check` PASS; 동일 dance/Xbot headful GPU·exact PTS·offset 0 PASS
산출물: `output/sam-goal-p1-pump/f18c212-p1active-3f658b0c70da`
결론: runtime 종료 조건 충족으로 P1 완료; 정확도 변동은 숨기지 않고 P2 입력 기준으로 유지
다음 제품 작업: occlusion/foreshortening에서 잘못된 high-confidence arm/hinge를 억제하는 causal canonical filter
블로커: 없음

2026-07-14 15:02 KST | P2 | 진행(관절 정의 adapter 체크포인트)
가설/병목: MediaPipe surface landmark의 elbow/knee flex가 teacher joint-center 정의보다 평균 12~22° 작았음
제품 변경: `src/canonical-skeleton-adapter.js`, `src/app.js`에 대칭 15° joint-center 변환을 실제 body→avatar 경로에 연결하고 cold worker init 제한을 body 90s/hand 60s로 분리
Before: dance major/hinge/root-yaw 40.406°/57.226°/22.117°; actual required-quat/FK 114.031°/17.696%H; 23.933Hz/25.3ms
After: dance 40.441°/47.102°/21.910°; actual 110.185°/18.280%H; 23.931Hz/24.9ms; exact 359/359; queue 0·drop/error 0
검증: adapter focused test·`npm run check` PASS; headful GPU worker dev 4/4 완료, fallback 0; adapter metadata 359/359
산출물: `output/sam-goal-p2-canonical/f18c212-p2joint-0b30f1423592`, `output/sam-goal-p2-canonical/f18c212-p2joint-dev3-0b30f1423592`
결론: hinge 개선은 유지하되 major 정체와 forearm/lower-leg·dev actual-avatar/FK 회귀가 남아 P2는 계속 진행
다음 제품 작업: foreshortening 시 flex는 유지하고 불안정한 bend plane만 hold/decay/reacquire하는 causal reliability state
블로커: 없음

2026-07-14 15:58 KST | P2 | 완료(더 큰 actual-retarget 병목으로 전환)
가설/병목: surface landmark 전역 회전과 준비 전 재생이 distal/FK·exact PTS·temporal seed를 흔들었고 high-flex 오검출에도 bias가 과적용됨
제품 변경: `src/canonical-skeleton-adapter.js`, `src/app.js`에 split25 joint-center, 90→110° elbow-bias fade, body/hand-ready 후 0초 시작, paused-frame recorder seed 적용
Before: dev4 pooled target/hinge/root 39.071°/40.858°/177.192°; actual req/body16/FK 100.367°/73.541°/21.129%H; ke 40.83Hz/45.4ms/overload394
After: split25 dev4 36.866°/38.616°/20.075°; actual 101.426°/74.327°/21.160%H; ke 59.94Hz/23.8ms/overload5; fade dance hinge max 106.159→92.067°·FK 19.371→18.289%H
검증: adapter focused test·`npm run check` PASS; headful GPU worker dev 4/4와 fade dance exact 359/359 PASS; queue≤1·body fallback/error0
산출물: `output/sam-goal-p2-canonical/f18c212-p2videozero-dev3-d8e700393b3c`, `output/sam-goal-p2-canonical/f18c212-p2elbowfade-seed-4edc1784157f`
결론: skeleton/root/runtime 공통 개선으로 P2 checkpoint 완료; new-dance와 최종 threshold 잔여는 유지하되 body16 4/4 회귀를 숨기지 않고 P3로 이동
다음 제품 작업: strict arm/leg에 rotation-minimizing rig-local basis를 실제 bone quaternion 단일 적용 경로로 연결
블로커: 없음

2026-07-14 17:04 KST | P3 | 진행(팔 rig-local 단일 소유권 체크포인트)
가설/병목: 월드 aim의 parent/local basis 혼용이 forearm quaternion을 키웠고 signed knee pole 없는 unsigned flex는 발 FK를 파괴함
제품 변경: `src/retarget/rig-local-rotation.js`, `src/retarget/skeleton-fk-retarget.js`, `src/avatar-renderer.js`에 current-parent rig-local arm swing·confidence/clamp hinge·단일 적용 연결; 다리는 endpoint 방향 유지
Before: dance/Xbot body16 58.713°; FK 18.289%H; exact 359/359; applied latency 24.0ms; queue≤1·drop/error0
After: body16 46.550°(-20.7%); FK 17.751%H(-2.9%); exact 359/359; applied latency 26.3ms; 23.88Hz; queue≤1·drop/error0
검증: strict focused test·`npm run check`·`git diff --check` PASS; headful GPU/worker actual-state before/after PASS
산출물: `output/sam-goal-p3-retarget/f18c212-p3armchain-10da28d0ec04` (실패 원인 보존: `f18c212-p3hingelocal-r2-963ab076512a`)
결론: 팔 단일 소유 경로 유지; 무릎 unsigned-local은 FK 33.260%H로 기각하고 signed pole/two-bone IK 전까지 방향 경로 유지
다음 제품 작업: development Xbot 회귀 확인 후 Soldier·Polydancer RigProfile의 rest axis/pre-post/hinge sign을 제품 경로에서 보정
블로커: 없음

2026-07-14 21:08 KST | P3 | 진행(elbow joint-center 좌표 bridge 체크포인트)
가설/병목: canonical adapter가 world XYZ만 고쳐 renderer가 쓰는 image XY에는 elbow joint-center 보정이 전달되지 않았음
제품 변경: `src/canonical-skeleton-adapter.js`, `src/app.js`에서 world elbow displacement의 XY만 원본 torso scale로 투영하고 wrist·root anchor와 world Z는 보존
Before: dev4 pooled body16/required18/FK 84.531°/112.649°/29.861%H; dance 57.304°/110.947°/18.659%H
After: pooled 71.350°/102.818°/20.773%H; dance 55.247°/111.008°/17.329%H; latency 24.4ms·23.92Hz·drop/error0
Clip: ke 세 지표 93.902°/113.431°/33.845%H→68.946°/95.426°/17.500%H; new FK만 30.101→30.979%H 회귀, vc body16 사실상 동률
검증: adapter mirror/root/endpoint focused test·`pnpm run check`·`git diff --check` PASS; headful GPU worker dev 4/4 exact-common PASS
산출물: `output/sam-goal-p3-retarget/f18c212-p3joint-screen-elbow-dance`, `output/sam-goal-p3-retarget/f18c212-p3joint-screen-elbow-dev3`
결론: elbow-only bridge 유지; 17:04 armchain 수치는 후속 dev 회귀로 제거된 실험값이며 현재 baseline/제품 상태가 아님
다음 제품 작업: 동일 실제 bone 경로에서 Soldier·Polydancer RigProfile 축/비율 회귀를 측정·수정; 블로커 없음

2026-07-14 21:34 KST | P3 | 완료(non-VRM front-axis RigProfile 체크포인트)
가설/병목: Soldier는 카메라만 π 회전하고 model/rest 좌우축은 canonical 입력과 반대여서 shoulder·arm 회전 오차가 증폭됨
제품 변경: `src/avatar-renderer.js`, `src/app.js`에서 non-VRM rest side-axis가 -X인 경우 model yaw π를 rest cache 전에 적용하고 camera 특례 제거·cache token 갱신
Before: 3-rig dance pooled body16/required18/FK 61.588°/120.645°/17.887%H; Soldier 77.984°/136.146°/17.475%H
After: pooled 51.830°/111.685°/18.406%H; Soldier 49.208°/114.702°/17.442%H, shoulder L/R 134.557°/152.067°→15.087°/15.844°
Rig 회귀: Xbot 재추론 +3.3%/+4.8%/+8.1%(correction applied=false), Polydancer -1.2%/-0.7%/+1.3%; 숨기지 않고 P4 FK 우선순위로 이월
Runtime: Soldier latency 24.7→25.6ms, 23.89Hz, queue≤1, overload/stale/error 0; front-axis -0.99999→+0.99999, base yaw π
검증: `pnpm run check`·`git diff --check` PASS; headful GPU worker 3 rigs exact-common 358/359/359 PASS; challenge clip 미개봉
산출물: `output/sam-goal-p3-retarget/f18c212-p3front-axis-rigprofile-dance`, 고정입력 진단 `f18c212-p3front-axis-fixed-replay-xbot.json`
결론/다음/블로커: 좌표계 근본 수정 유지·P3 완료; P4에서 wrist/ankle FK와 contact/hand/head 결합을 제품 변경으로 개선; 없음

2026-07-14 22:12 KST | P4 | 진행(root facing 좌표 규약 체크포인트)
가설/병목: hybrid image-XY/world-Z 전면축을 estimator가 side-order·face 가시성으로 재추측해 `new-dance`에서 180° winding을 선택했음
제품 변경: `src/solver/facing-estimator.js`, `src/solver/pose-solver.js`, `src/avatar-renderer.js`, `src/app.js`에 mirror별 명시 yaw offset·고정 hypothesis·540°/s causal unwrap·mirror reset 연결
Before: dev4 actual root-yaw P95 167.124°(>90° 138f), root-pos 2.738%H, LH/RH/LF/RF/Head FK 27.701/22.666/18.901/19.269/4.443%H
After: root-yaw 15.458°(>90° 12f), root-pos 2.815%H, FK 24.347/22.694/18.551/16.710/3.995%H; latency max P95 37.1ms·min 23.84Hz·queue≤1
검증: facing/solver focused·`pnpm run check`·`git diff --check` PASS; headful GPU worker dev 4/4 complete; challenge 3 clips 미개봉
산출물: `output/sam-goal-p4-root/f18c212-p4locked-facing-new-dance`, `output/sam-goal-p4-root/f18c212-p4locked-facing-dev3`
결론: 좌표 규약 수정 유지; root-position +2.8%와 ke hand FK 회귀는 숨기지 않고 후속 root/contact·hand 소유권에서 해결
다음 제품 작업/블로커: wrist primary와 palm normal을 동일 3D world basis로 통일해 tracked-hand 회전·FK 개선; 없음

2026-07-14 22:24 KST | P4 | 진행(coherent 3D hand basis 체크포인트)
가설/병목: wrist primary는 image, palm normal은 world 좌표여서 mixed `|dot|` P95 .539~.903의 비직교 basis를 손 bone에 즉시 적용했음
제품 변경: `src/retarget-orientation.js`, `src/avatar-renderer.js`, `src/app.js`에서 world primary+normal 원자 선택·전체 image fallback·invalid telemetry 제외 연결
Before: dev4 actual L/R hand quat P95 165.103/160.019°, tracked 169.981/164.268°, wrist FK 24.347/22.694%H, tracked 31.2/34.3%
After: quat 165.423/150.654°, tracked 165.136/153.829°, wrist FK 23.099/23.160%H, tracked 25.7/31.1%; root-yaw 16.162°·12f>90
회귀: `new Left` tracked 164.405→170.710°; 나머지 7개 tracked clip×side는 개선, `vc Right` 174.177→163.184°; wrist 원점은 hand local 회전에 비인과적
검증: orientation/contract focused·`pnpm run check`·`git diff --check` PASS; dev 4/4 complete; latency max P95 26.1ms·min 23.92Hz·queue≤1·drop3
산출물: `output/sam-goal-p4-hand/f18c212-p4coherent-hand-basis-dev4`; challenge 3 clips 미개봉
결론/다음/블로커: coherent basis 유지; hand coverage 미달은 후속 cadence/ROI 작업으로 남기고 planted-foot contact+two-bone IK 단일 소유권 구현; 없음

2026-07-15 02:47 KST | P4 | 진행(contact anchor trust-region 체크포인트)
가설/병목: planted 판정 뒤 raw ankle이 이동해도 full world anchor를 최대 6.13%H까지 유지해 특히 `ke` Left의 teacher 반대 XZ 보정을 누적했음
제품 변경: `src/retarget/planted-foot-ik.js`, `src/avatar-renderer.js`, `src/app.js`에 causal contact·signed-pole two-bone IK 단일 소유권과 XZ 1%H same-frame release, nullish fail-closed telemetry 연결
Before: dev4 exact-common 2,195쌍 LF/RF ankle 20.038/17.223%H; contact drift L/R P95 1.978/4.300%H; max latency 26.3ms·min 23.92Hz·queue≤1
After: LF/RF 19.819/16.989%H; drift 0.926/0.907%H(max<1%H); continuous-IK slide P95 <0.000001%H/s; max latency 25.2ms·min 23.86Hz·queue≤1
회귀: lower LeftFoot quat 59.979→64.383°, wrist FK 23.480/20.787→26.242/23.144%H; pre-contact 19.644/16.845%H보다 ankle이 아직 높아 contact 통합은 미완료
검증: contact/IK focused·`pnpm run check`·`git diff --check` PASS; headful GPU worker dev 4/4 exact-common·coverage100%·error0; challenge 3 clips 미개봉
산출물: `output/sam-goal-p4-contact/f18c212-p4planted-foot-ik-dev4b`, `f18c212-p4anchor-leash-dev4`, `f18c212-p4anchor-leash-ke`, `f18c212-p4anchor-leash-new`
결론: XZ overconstraint guard는 유지하되 fixed contact-window 최종 통과로 간주하지 않음
다음 제품 작업/블로커: hand worker ROI/cadence의 90% joint coverage 병목 수정 후 body-head+face delta 통합; 없음

2026-07-15 03:20 KST | P4 | 진행(side-priority hand inference 체크포인트)
가설/병목: 512×256 양손 합성 입력과 null/partial 전체-cache 교체가 실제 side-slot hand joint coverage를 잃었음
제품 변경: `src/hand-worker.js`, `src/hand-roi.js`, `src/tracking-cadence.js`, `src/app.js`에 좌우별 VIDEO tracker·full-square ROI·source-PTS cadence·side별 500ms cache·raw-pose crop 연결
Before: dev4 2,476f Left/Right/joint 30.654/32.189/31.422%; hand RTT P95 max63.9ms; queue≤1·error0
After: dev4 2,438f Left/Right/joint 63.454/71.534/67.494%; clip joint dance/ke/new/vc 60.894/75.147/81.435/38.889%
Runtime: hand RTT P95 max52.7ms; body min23.899Hz·frame P95 max22.6ms; queue≤1; drop 16/2,438(<1%); error/fallback0
회귀: tracked Left/Right Hand quat P95 161.120/161.802→169.448/170.938°; wrist FK 23.347/20.474→23.305/21.817%H, coverage 90%와 detail 정확도 모두 미완료
검증: cache/ROI focused·`pnpm run check`·`git diff --check` PASS; headful GPU worker dev4 exact-PTS PASS; challenge 실행 없음
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-causal-dev4` (중간 `f18c212-p4hand-side-lane-dev4`); 결론: coverage 구조 유지
다음 제품 작업/블로커: 손 local quaternion의 3D palm/rest-parent basis 근본 오차 수정 후 edge-padded ROI/cadence로 coverage 90% 재도전; 없음

2026-07-15 05:20 KST | P4 | 진행(body-owned head + face-delta 체크포인트)
가설/병목: body retarget 뒤 face 단계가 `rest * faceDelta`를 target으로 삼아 body가 계산한 Head/Neck local pose를 매 frame 약화시켰음
제품 변경: `src/face-head-pose.js`, `src/avatar-renderer.js`에서 이전 face delta를 body solve 전에 제거하고 body local quaternion 위에 smoothing된 face delta만 합성
Before: VC face-on exact-common 450f Head/Neck local P95 27.077/13.089°, Head FK 3.028%H, Head jump >90° 0; 29.95Hz·frame P95 27.9ms
After: Head/Neck 22.993/9.533°, Head FK 2.841%H, >90° 0; face transform 429/450, 30.00Hz·frame P95 29.2ms·worker error/fallback0
검증: composition round-trip/identity focused test·`pnpm run check`·`git diff --check` PASS; headful GPU worker face-on exact PTS PASS; challenge 실행 없음
산출물: `output/sam-goal-p4-head/f18c212-p4head-compose-before-vc`, `output/sam-goal-p4-head/f18c212-p4head-compose-after-vc`
결론: body absolute orientation + face relative delta 단일 소유권 유지; shoulder-elbow-wrist semantic ForeArm roll 후보는 teacher/Hand 회귀로 기각
다음 제품 작업/블로커: edge-padded ROI와 hand scheduling으로 joint coverage 90% 재도전 후 distal finger를 parent-relative bend/curl로 전환; 없음

2026-07-15 06:36 KST | P4 | 진행(actual-state distal hinge 체크포인트)
가설/병목: twist limiter scratch가 target quaternion을 rest로 덮었고, 복구 뒤에도 strict PIP/DIP가 source-dependent absolute aim과 혼합돼 1-DOF flex를 오염시켰음
제품 변경: `src/avatar-renderer.js`, `src/retarget/causal-finger-flex.js`, `src/app.js`에서 target alias 제거, parent-relative source-profile flex, quality-gated full rig hinge, source-PTS rate cap·320ms hold/60°s decay·1.25s reset 연결
Before: 고정 live replay dance/VC PIP P95 54.170/48.776°, DIP 45.286/41.011°; temporal PIP 26.837/22.090°, DIP 29.163/23.011°
After: PIP 42.449/38.158°(-21.6/-21.8%), DIP 21.252/17.441°(-53.1/-57.5%); temporal PIP 15.314/10.457°, DIP 9.000/5.208°; >90° jump 0
비회귀/잔여: MCP mean/P95·jump 사실상 동일, Hand P95 dance -1.1%·VC +0.3%; actual joint coverage dance/VC 72.145/50.554%, hand RTT max85.7ms로 90%/80ms 미달
검증: 동일 저장 live JSONL+teacher를 current renderer로 exact-PTS replay, 359/450쌍; `pnpm run check`·`git diff --check` PASS; IMAGE/GPU hand 후보는 coverage 회귀로 기각; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-hinge-{fixedlive,target}-{dance,vc}`; before `f18c212-p4hand-aliasfix-{dance,vc}`
결론/다음/블로커: distal 단일 소유권 유지; MCP absolute aim의 spread/flex 분해와 detector-null causal hand skeleton 경로를 제품 코드로 개선; 없음

2026-07-15 06:42 KST | P4 | 진행(strict MCP direct-observation 체크포인트)
가설/병목: strict MCP→PIP 방향에 이미 포함된 flex 위에 전체 finger curl→palm heuristic을 다시 가산해 MCP flex/spread를 이중 계산했음
제품 변경: `src/avatar-renderer.js`, `src/app.js`에서 fist-curl bias를 legacy 전용으로 제한하고 strict MCP는 운반된 현재 관측 방향만 소유
Before: 고정 live replay dance/VC MCP mean 49.229/36.930°, P95 122.926/89.314°, >90° 521/208; temporal P95 62.671/36.455°, >90° jump 98/33
After: mean 42.449/33.337°(-13.8/-9.7%), P95 108.551/72.447°(-11.7/-18.9%), >90° 322/109; temporal P95 52.490/34.561°, >90° jump 56/15
비회귀: 동일 exact PTS에서 PIP/DIP mean·P95·jump 불변; detector/cache/runtime 경로 변경 없음
검증: current target+동일 저장 live JSONL 359/450쌍 replay; `pnpm run check`·`git diff --check` PASS; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-mcp-{fixedlive,target}-{dance,vc}`; before `f18c212-p4hand-hinge-fixedlive-{dance,vc}`
결론/다음/블로커: 이중 curl 제거 유지; MCP를 palm-local spread+flex로 분해하고 current-parent rig-local quaternion으로 적용; 없음

2026-07-15 07:07 KST | P4 | 진행(palm-local MCP source-profile 체크포인트)
가설/병목: MediaPipe와 MHR70 finger-root 방향의 palm-local flex/spread 분포가 달라 raw MCP aim이 입력 포맷 차이를 rig quaternion으로 증폭했음
제품 변경: `src/retarget/causal-finger-flex.js`, `src/avatar-renderer.js`, `src/app.js`에서 orthonormal palm-local flex/spread 분해·포맷별 고정 profile·3D 방향 재합성 후 기존 hand-basis transport 연결
Before: 고정 dance/VC MCP mean 42.395/33.159°, P95 107.597/70.661°, >90° 318/98; temporal P95 52.490/34.561°, >90° jump 56/15
After: mean 26.274/23.572°(-38.0/-28.9%), P95 54.838/45.737°(-49.0/-35.3%), >90° 20/0; temporal P95 19.555/13.243°, jump 2/0
dev4 guard: ke mean/P95/jumpP95 17.748/38.159/5.062°, new 20.917/42.336/12.855°; >90° error/jump ke 0/0, new 5/2
검증: 동일 저장 live+teacher exact replay dance/VC 359/450, ke/new 1,191/439쌍; `pnpm run check`·`git diff --check` PASS; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-mcpprofile-{fixedlive,target}-{dance,vc,ke,new}`
결론/다음/블로커: source-format normalization 유지; detector-null 구간의 실제 hand skeleton continuity와 90% coverage를 제품 경로로 해결; 없음

2026-07-15 07:40 KST | P4 | 진행(pose-guided causal hand-state 체크포인트)
가설/병목: 500ms detector cache 만료 뒤 hand skeleton이 즉시 사라져 avatar MCP가 rest로 복귀했으며, cache TTL 연장은 실제 관측 provenance를 숨기므로 마지막 실제 hand와 당시/current raw pose만으로 별도 causal state가 필요했음
제품 변경: `src/pose-guided-hand-fallback.js`, `src/app.js`, `src/avatar-renderer.js`에서 관측 pose→현재 pose aspect-corrected similarity transport, generation/future/1.25s hard gate, observed/held/predicted telemetry 분리, stale world-landmark 차단, predicted MCP만 confidence-weighted 80ms 갱신하고 PIP/DIP는 기존 gap hold/decay로 유지
Before(actual dev4): detector-backed/product joint coverage dance/ke/new/VC 77.793/79.830/92.141/49.000%, pooled 76.127%
After(actual dev4): detector-backed 74.162/78.883/88.242/52.217%와 별도로 predicted 18.436/10.032/9.703/24.279%p를 보완해 product 92.598/88.916/97.945/76.497%, pooled 88.784%; direct detector metric은 증가한 것처럼 재분류하지 않음
동일 PTS 격리(dance/VC, prediction 제거→적용): MCP mean 28.132/24.674→28.379/23.375°, P95 55.623/46.030→58.296/44.049°, jump P95 22.599/9.917→23.898/9.020°; pooled mean/P95/jump 26.204/49.708/15.245→25.590/49.322/15.021°, >90° error/jump 1/3 불변; PIP/DIP mean·P95·jump bit-identical
runtime/잔여: body 23.91/60.00/30.00/29.95Hz, queue depth≤1·worker error/fallback0; hand RTT P95 87.4/84.6/92.9/87.3ms로 80ms 미달, ke overload 55/410; product pooled·ke·VC도 90% 미달이라 TTL을 늘리지 않고 detector 재획득을 계속 개선
검증: deterministic transform·future/generation/expiry focused check, `pnpm run check`, `git diff --check` PASS; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-posefallback-{dance,ke,new,vc}`, `f18c212-p4hand-posefallback-{fixedmissing,smooth-fixedfull}-{dance,vc}`; before `f18c212-p4hand-mcpprofile-target-{dance,ke,new,vc}`
결론/다음/블로커: causal hand-state/provenance 분리 유지; 1.25s 초과 null streak의 근본 원인인 moving-ROI VIDEO tracker 재획득을 stable crop episode/reset으로 제품 코드에서 해결; 없음

2026-07-15 08:43 KST | P4 | 진행(side-owned parallel hand runtime 체크포인트)
가설/병목: 한 worker의 좌→우 직렬 CPU 추론과 VIDEO tracker reset이 늦은 side에 두 손 RTT·프레임 재획득을 동시에 묶었음
제품 변경: `src/hand-worker.js`, `src/hand-roi.js`, `src/app.js`에 side 전용 IMAGE landmarker 2개, frozen-bitmap fan-out, 독립 capacity-1 pump·failure/cache, partial-outcome 즉시 확정 연결
Before(dev4): detector/product dance/ke/new/VC 74.162/78.883/88.242/52.217% · 92.598/88.916/97.945/76.497%, pooled 75.010/88.784%; RTT P95 87.4/84.6/92.9/87.3ms, ke hand overload 55
After(dev4): detector/product 75.978/82.441/95.434/69.734% · 95.950/94.404/99.543/84.368%, pooled 81.492/93.710%; RTT P95 44.2/49.7/43.3/42.9ms, hand overload 0, clone failure0, body 23.92/59.87/30.00/29.93Hz·error/fallback0
실제 bone pooled Before→After: Hand mean/P95 59.488/126.754→59.490/130.522°, MCP 20.786/42.957→20.748/46.196°(>90° 11→32), PIP 17.250/40.344→15.706/38.156°, DIP 7.305/18.617→6.968/18.209°; dance MCP tail 회귀는 이월
기각 실험: stable VIDEO ROI reset은 dance product 92.598→91.341%·RTT 87.4→125.8ms(reset71)로 악화; stateless IMAGE+parallel로 교체
검증: syntax/contract/pump/cadence/ROI focused·`pnpm run check`·`git diff --check` PASS; headful GPU/body-worker dev4 exact-PTS 2,480 pairs; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-parallelsidev1-{dance,ke,new,vc}`; before `f18c212-p4hand-posefallback-{dance,ke,new,vc}`
결론/다음/블로커: latency·coverage 구조 유지; dance/ke의 신규 direct MCP outlier를 observation quality·reacquire blend 제품 상태로 억제; 없음

2026-07-15 10:46 KST | P4 | 진행(MCP hemisphere + Thumb opposition 체크포인트)
가설/병목: 비-Thumb의 음수 palm-primary를 spread로 접어 direct MCP tail을 만들었고, 최초 공통 remap은 Thumb opposition spread 부호까지 뒤집었음
제품 변경: `src/retarget/causal-finger-flex.js`, `src/avatar-renderer.js`, `src/app.js`에서 비-Thumb hemisphere flex 보존, Thumb legacy opposition 분기, browser cache-token 연결; focused 회귀 test 추가
Before(dev4, parallel): pooled MCP mean/P95/>90 20.748/46.196°/32, jump P95/>90 14.955°/7; Hand/PIP/DIP P95 130.522/38.156/18.209°
After(dev4 exact 2,426f): MCP 20.045/42.941°/0, jump 15.023°/0; Hand/PIP/DIP P95 132.913/38.165/17.842°; dance non-Thumb >90 27→0, new/VC Thumb remap 회귀 1/15→0/0
Runtime 1차: detector/pred/product pooled 81.307/11.418/92.725%(before 81.492/12.218/93.710%); RTT 56.0/64.2/47.3/81.7ms·side overload16·body error/fallback0; 동일 시점 외부 고부하로 재현 확인 이월
검증: Thumb/forward/backward decomposition·syntax·contract·`pnpm run check`·`git diff --check` PASS; headful GPU/body-worker dev4 exact PTS; challenge 3 clips 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-mcpthumbguardv1-{dance,ke,new,vc}`; before `f18c212-p4hand-parallelsidev1-*`; 중간 `f18c212-p4hand-mcphemispherev1-*`
결론/다음/블로커: 수학/Thumb 분기는 유지; 비-Thumb side×finger exact-PTS causal MCP root confirmation/rate cap 제품 구현 후 안정 부하에서 runtime도 함께 재측정; 없음

2026-07-15 11:11 KST | P4 | 진행(exact-PTS causal MCP root 체크포인트)
가설/병목: direct 비-Thumb MCP가 단일 large/p≈0 관측을 즉시 적용했고 긴 재획득 gap에는 source-PTS 기반 안전 상태가 없었음
제품 변경: `src/retarget/causal-finger-flex.js`, `src/avatar-renderer.js`, `src/app.js`에 side×finger calibrated flex/spread state, exact-us stale/repeat hold, 2-PTS confirmation, 18° capped recovery, reset/telemetry/cache-token 연결
Before→After(dev4 triple-common 2,400f): MCP mean/P95 20.078/42.954→19.468/40.594°(-3.0/-5.5%), jump P95 15.122→13.905°(-8.0%), >90° 0 유지; dance P95 52.742→46.901°
비-MCP 관측: Hand mean/P95 59.867/132.913→60.397/130.984°, PIP 15.876/38.163→16.111/39.390°(new >90 1), DIP 6.903/17.842→7.023/18.357°; causal root 비소유 경로 run variance 이월
Runtime: detector/pred/product pooled 79.959/11.487/91.446%(직전 81.307/11.418/92.725%); RTT 46.5/54.0/43.8/44.7ms, side overload0, body 23.93/58.52/29.91/29.94Hz·error/fallback0
검증: exact-us direct/confirm/predicted/reset focused·독립 review·syntax/contract·`pnpm run check`·`git diff --check` PASS; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-causalrootv1-{dance,ke,new,vc}`; before `f18c212-p4hand-mcpthumbguardv1-*`
결론/다음/블로커: MCP state 유지; 가장 큰 실제 오차인 Hand P95 130.984°의 pose-owned wrist/palm roll 결손을 detector palm delta 단일 소유권으로 제품 수정; 없음

2026-07-15 12:52 KST | P4 | 진행(stateless current-pose IMAGE ROI 체크포인트)
가설/병목: stateless IMAGE landmarker가 VIDEO식 committed ROI와 miss expansion을 재사용해 hit 뒤에도 최대 2.03125× crop을 유지하고 VC 재진입 손 해상도를 잃었음
제품 변경: `src/hand-worker.js`, `src/app.js`, `index.html`에서 현재 pose crop을 매 요청 commit하고 실제 hit 시 expansion을 0으로 reset하며 cache-token을 제품 경로에 연결
Before→After(dev4 exact-common 2,234f): product coverage pooled 91.473→93.778%(+2.305%p), dance/ke/new/VC +1.955/+1.471/-0.228/+6.874%p; side 최악 -1.397%p로 -2%p guard 통과
실제 bone: Hand mean/P95 60.112/130.981→59.106/127.305°, jump P95 36.001°·>90 0 유지; MCP 19.657/40.881→19.573/40.972°, `new` Thumb1 재획득에서 >90° error4·jump2 잔여
Runtime: RTT P95 clip-side max 52.8→63.2ms·worker error/fallback0; hand side overload KE 2/2·VC 1/0, body pump overload KE 227/1,236(재실행 283/1,236)·나머지0; body 23.85/48.46(재실행46.39)/29.95/29.94Hz로 rate floor는 통과
검증: syntax/ROI/contract/pump/cadence focused·`pnpm run check`·`git diff --check` PASS; headful GPU/body-worker dev4 전 구간, challenge 3 clips 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-currentroiv1-{dance,ke,new,vc-full}`, KE repeat `f18c212-p4hand-currentroiv1-ke-r2`; before `f18c212-p4hand-causalrootv1-*`
결론/다음/블로커: coverage·Hand 개선으로 ROI는 조건부 유지하되 KE body overload 회귀는 미해결; Thumb exact-PTS reacquire owner 후 60fps body/hand contention을 제품 scheduling에서 제거; 없음

2026-07-15 13:23 KST | P4 | 진행(exact-PTS causal Thumb reacquire 체크포인트)
가설/병목: `Thumb1`만 비-Thumb의 exact-PTS confirmation/rate cap을 우회해 prediction/hold→fresh observation에서 96~118°를 즉시 적용했음
제품 변경: `src/retarget/causal-finger-flex.js`, `src/avatar-renderer.js`, `src/app.js`에서 Thumb opposition은 보존하고 side×Thumb state·unique-PTS 2회 확인·quality-bounded 최대18° recovery·cache-token을 연결
고정-input new 439f: Thumb mean/P95 16.807/44.140→14.232/28.669°, error/jump>90 4/2→0/0; non-Thumb MCP ≤0.000004° 차이, PIP/DIP exact 동일
Fresh dev4 exact4way 2,014f: Thumb 15.602/32.750→14.513/30.081°, >90 error/jump 4/2→0/0; non-Thumb/PIP/DIP P95 +0.571/+0.939/+0.059°·KE cadence-confounded
Runtime/coverage: RTT max63.0→57.2ms·worker error/fallback0; product frame-weighted 93.821→89.963%, KE body 48.46→45.50Hz·overload227→298, fresh coverage 회귀는 통과 근거로 사용하지 않음
검증: causal Thumb focused·독립 review·syntax/contract·`pnpm run check`·`git diff --check` PASS; headful GPU/body-worker dev4+fixed-new, challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-causalthumbv1-{dance,ke,new,vc}`, `f18c212-p4hand-causalthumbv1-fixed-new`; before `f18c212-p4hand-currentroiv1-*`
결론/다음/블로커: causal Thumb owner는 고정 입력의 실제 개선·비소유 불변으로 유지; 50ms 동시 hand worker CPU 포화가 만든 KE body drop과 clip별 hand PTS 변동을 capacity-aware source-PTS scheduling으로 해결; 없음

2026-07-15 13:52 KST | P4 | 진행(exact source-PTS 30Hz work-budget 체크포인트)
가설/병목: 60fps callback을 모두 body pump에 넣고 50ms hand snapshot을 결합해 side queue는 정상이어도 body overload가 24.1% 발생하고 hand 후보 96개가 fan-out 전에 함께 폐기됐음
제품 변경: `src/tracking-cadence.js`, `src/app.js`, `index.html`에서 microsecond exact-PTS 30Hz admission을 stale/duplicate 뒤·snapshot 앞에 두고 24/29.97/30fps 전부 통과, cadence skip/overload/stale provenance와 cache-token을 연결
KE runtime Before→After: callback 1,237 동일, body offer/output 1,237/939→619/619, intentional skip 0→618, overload 298→0, 45.50→29.93Hz(target-effective), applied latency P95 39.5→26.8ms, hand snapshot 411→310·RTT P95 56.1→45.1ms
Coverage/실제 bone(4-way common 511f): product 88.552→92.811%; Hand/MCP/PIP/DIP/Thumb P95 133.782/38.737/45.474/21.573/28.087→126.945/35.647/40.002/20.011/27.972°, 모든 temporal jump>90° 0 유지
비회귀: queue≤1, stale/error/fallback/hand-side-overload 0; six-decimal PTS 60fps 격프레임·24/29.97/30fps 전부 admission 장시간 독립 시뮬레이션 PASS
검증: syntax/cadence/contract/pump·`pnpm run check`·`git diff --check`·독립 review PASS; headful GPU/body-worker KE 전체 재생, challenge 3 clips 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-sourcepts30v1-ke`; before `f18c212-p4hand-causalthumbv1-ke`
결론/다음/블로커: workload budget은 유지; 가장 큰 실제 오차인 Hand P95의 pose-only palm roll 결손을 unique exact-PTS detector palm-normal delta 단일 소유권으로 제품 수정; 없음

2026-07-15 16:19 KST | P4 | 진행(actual rig-local arm continuity 체크포인트)
가설/병목: mixed-coordinate raw arm depth와 strict `targetAlpha=1`이 reliable-labelled 오방향을 실제 local quaternion에 즉시 적용해 wrist tail·90° 점프를 만들었음
제품 변경: `src/depth-calibration.js`, `src/avatar-renderer.js`, `src/solver/pose-solver.js`, `src/retarget/rig-local-rotation.js`에서 same-frame raw 2-link 방향을 calibrated 길이로 원자 적용하고 기존 420°/s 계약을 최종 arm local quaternion 경계에 연결
Before(dev dance/new/VC): Arm/ForeArm/Hand P95 53.77/144.73/132.38°; new wrist L/R 31.103/27.323%H; KE Arm/ForeArm >90° error 3/3
After: 48.158/74.911/108.052°; new wrist 26.992/22.424%H; KE wrist 8.344/9.940→8.434/9.461%H·>90° 0/0; root transform·lower/head endpoint 동일
Runtime: live apply P95 KE/dance/new/VC 1.2/1.1/1.1/1.0ms, 각 before+0.2ms 이내·3ms budget 통과; depth live/teacher 전부 PASS
검증: pure 14°@30fps rate test·depth/solver focused·`pnpm run check`·headful GPU strict exact-PTS KE+dev3 live/teacher PASS; challenge 미개봉
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-armlocalrate-r7-{live,teacher}-{ke,dance,new,vc}`
결론/다음/블로커: r7 유지; 가장 큰 잔여 Hand P95 108.052°의 pose-only wrist/palm roll 소유권을 detector palm delta와 결합해 제품 수정; 없음

2026-07-15 18:26 KST | P4 | 진행(source-PTS causal avatar clock 체크포인트)
가설/병목: callback wall clock·video PTS가 pose/face/hand/recovery에 분리되고 PTS 0을 absence로 취급해 동일 skeleton도 callback scheduling에 따라 다른 actual pose를 만들었음
제품 변경: `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 exact video PTS 하나를 모든 avatar state transition·body/depth cache에 공유하고 nullable sentinel·camera/legacy monotonic fallback·cache token을 연결
Before→After(dev4 exact 1,867쌍): Arm/ForeArm/Hand 40.319/64.566/100.343→40.314/63.080/99.639°; Leg/Foot 56.498/59.910→56.250/59.593°
Root/FK: root quat/pos 16.712°/2.127%H→16.685°/2.123%H; wrist L/R 20.207/18.914→19.750/18.930%H; ankle L/R 19.963/17.220→19.968/17.205%H
비회귀/회귀: actual bone·endpoint·PTS·finger coverage 100%; Hips 12.841→12.875°, Head FK 4.532→4.556%H, dance palm inversion +0.139%p와 KE 일부 관절 회귀는 이월
Runtime/contact/depth: apply P95 1.1/1.2/1.1/1.0ms≤3ms; depth 4/4 PASS; contact-bearing 3 clips slide≤0.01H/s, queue/error/drop0; teacher shift body/root/FK≈0·Head≤0.424°
검증/산출물: syntax·contract·applied-state·face·`pnpm run check`·독립 review PASS; `output/sam-goal-p4-clock/f18c212-p4clock-sourcepts-r1-{live,teacher}-{ke,dance,new,vc}`; challenge 미개봉
결론/다음/블로커: clock 유지·P4 미완료; raw/offset detector palm delta는 dev4 전부 악화해 기각하고 Hand P95 99.639°의 좌표/소유권 원인을 제품 경로에서 다시 분해; 없음

2026-07-16 01:26 KST | P4 | 진행(pose Hand confidence-innovation gate 체크포인트)
가설/병목: pose wrist/index/pinky의 low-confidence palm basis가 parent transport 뒤에도 물리적으로 불가능한 회전률로 Hand causal confirmation에 진입했음
제품 변경: `src/retarget/pose-hand-innovation-gate.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 세 landmark 최소 confidence를 보존하고 저신뢰 Hand innovation을 proximal arm과 같은 420°/s 상한으로 causal hold 처리
Before→After(dev4 동일 live 입력·exact PTS 1,868f): pooled Hand P95 100.655→97.672°; KE/dance/new/VC 75.156/125.662/108.810/99.040→75.842/115.334/102.473/98.282°(최대 회귀 +0.686°)
비회귀: Arm/ForeArm/Hips/UpLeg/Leg/Foot/Head, root quaternion/position, wrist/ankle/head FK endpoint 전부 metric-exact 동일; Hand owner는 pose-world-causal 유지
Runtime: final fresh dance 359 pose frames, detect/frame/age/lag P95 22.1/23.7/1.0/0.6ms, stale0, overall96.6%; `pnpm run check` PASS
검증/산출물: `output/sam-goal-p4-hand/f18c212-p4hand-confidencegatev1-fixed-{before,after}-{ke,dance,new,vc}`, final runtime `f18c212-p4hand-confidencegatev2-420-dance`; challenge 3 clips 미개봉
결론/다음/블로커: gate 유지·P4 미완료; strict mode가 선언된 Foot maxAngle을 무시하는 소유권 누락을 제품 코드에서 복원하고 같은 dev4 actual-state before/after를 측정; 없음

2026-07-16 01:35 KST | P4 | 진행(strict Foot rest-angle 체크포인트)
가설/병목: `BODY_RETARGETS`가 Foot maxAngle 1.15rad를 선언했지만 strict no-profile resolver가 이를 버려 ankle 방향을 rest 대비 무제한 적용했음
제품 변경: `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 strict Foot만 선언된 maxAngle을 direction-foot 합류 경로에 복원하고 다른 non-profile bone·maxTwist는 기존 uncapped 소유권 유지
Before→After(dev4 동일 live 입력·exact PTS 1,868f): pooled Foot P95 59.673→54.039°; KE/dance/new/VC 62.887/53.164/96.807/0→53.804/47.732/95.321/0°
비회귀: Arm/ForeArm/Hand/Hips/UpLeg/Leg/Head, root quaternion/position, 모든 기록 FK endpoint와 `footContact` 집계가 metric-exact 동일
Runtime: final fresh dance 358 pose frames, update/detect/frame/age/lag P95 1.0/21.7/23.5/0.7/0.4ms, queue≤1·stale/error/fallback0; `pnpm run check` PASS
검증/산출물: `output/sam-goal-p4-foot/f18c212-p4foot-restangle-r3-after-{ke,dance,new,vc}`, live `f18c212-p4foot-restangle-r3-live-dance`; challenge `output/sam-goal-p4-challenge/f18c212-p4integrated-r1`
Held-out 최초 공개(Xbot, exact 3,692쌍): Arm/ForeArm/Hand/Foot pooled P95 36.178/142.105/101.156/65.890°, root quat 11.790°; applied latency P95 17.4~18.5ms·queue≤1·stale/error/fallback0
잔여: planted/IK frame은 3 clips 모두 0(`lower-chain-unavailable`), product hand coverage arms/csi/jujae 82.6/67.6/94.2%; 이 결과로 clip 상수는 추가하지 않고 P5까지 challenge 재실행 금지
결론/다음/블로커: Foot 경계 유지·P4 미완료; dev dance에도 존재하는 strict lower-chain availability 단절의 공통 제품 원인을 수정하고 dev before/after 뒤 P5로 이동; 없음

2026-07-16 18:13 KST | P4 | 진행(Face 전용 bounded-input runtime 체크포인트, 미통과)
가설/병목: CPU Face·양 side Hand가 서로 독립인 3개 worker에서 동시에 실행되고 Face가 body/Hand와 같은 640px snapshot을 사용해 auxiliary CPU tail과 body drop을 만들었음
제품 변경: `src/bounded-frame-snapshot.js`, `src/app.js`, `index.html`에서 Face만 별도 persistent canvas의 512px 최대축 full-frame으로 제한하고 body/Hand 640px canvas, exact-PTS/generation/configuration, 10Hz·33.333ms lag·150ms age를 고정; 기존 contract test에 aspect/no-upscale/분리 ownership을 연결
Before→After(fixed dev VC, r5→r6): body detection 28.6369→29.1307Hz, output/callback 351/360=97.50%→311/317=98.11%, overload 7→2, Face detect P95/max 49.2/179.1→30.0/47.6ms, Hand RTT P95 119.1→59.2ms
Runtime 비회귀: Pose GPU·Face CPU·Hand CPU, queue≤1, applied-avatar latency P95 64ms≤80ms, body/Face/Hand error·fallback0, Face future0; 독립 review 2건·syntax·focused contract/presence/applied-state·`pnpm run check`·`git diff --check` PASS
미통과/중단: Face cacheExpired 1(기준0), output/callback 98.11%(기준≥99%), absolute body 29.1307Hz(<30); warmup240/comparator/dance와 challenge 재실행 금지 유지
산출물: `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r6-face512-after-vc-warmup1`; before `f18c212-p5-statelessfacelane-r5-facewindow-after-vc-warmup1`
결론/다음/블로커: 512px 제품 경로는 다음 before로 보존하되 독립 체크포인트는 기각; 해상도/phase 재탐색 없이 Face 우선순위와 총 동시 CPU work≤2를 소유하는 shared auxiliary arbiter를 제품 구현; 없음

2026-07-16 18:46 KST | P4 | 진행(bounded MotionRecording export 체크포인트, 미통과)
가설/병목: 측정 종료 시 full recording 복제와 전체 JSONL CDP 전송이 브라우저 main thread를 막아 post-record Face 만료와 PTS 공백을 만들었음
제품 변경: `src/motion-frame.js`, `src/app.js`, `scripts/avatar-motion-agreement-check.mjs`, `index.html`에서 기존 full-recording API를 유지하면서 O(1) lightweight stop, stable recording id, 최대16프레임 cursor JSONL export와 fail-closed progress 검증을 연결
Before→After(fixed dev VC, r6→r7): Face cacheExpired 1→0, post-record 133~167ms PTS 공백→없음, Face P95/max 30.0/47.6→29.1/31.1ms, Hand RTT P95 59.2→46.1ms, applied-avatar latency P95 64.0→69.8ms
하드 게이트 실패: body detection 29.1307→28.0988Hz(<28.8394), output/callback 311/317=98.11%→310/332=93.37%(<99%), overload 2/317→20/332=6.02%(>5%); 녹화의 정확히20개 66.7ms gap이20 overload와 대응
비회귀/검증: queue≤1, body/Face/Hand error·fallback0, JSONL 304/304 frame·causal Face reason만 존재; byte-identical chunk/round-trip focused·`pnpm run check`·`git diff --check`·독립 review 2건 PASS
산출물: `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r7-recordingchunks-after-vc-warmup1`; before `f18c212-p5-statelessfacelane-r6-face512-after-vc-warmup1`
결론/다음/블로커: recorder 개선은 post-stop 병목 제거용 제품 변경으로 보존하되 체크포인트는 기각; warmup240/comparator/dance/challenge를 실행하지 않고 fixed source cadence를 유지한 shared auxiliary CPU admission ownership으로 in-window Body overload를 제거; 없음

2026-07-16 21:05 KST | P4 | 진행(shared auxiliary CPU admission 체크포인트, 결정론 미통과)
가설/병목: Face·Left Hand·Right Hand CPU detect가 독립 실행되어 동시에 세 작업이 겹치고 Body 30Hz가 20개 in-window overload를 냈으며, worker permit 대기시간이 기존 Hand RTT에서 보이지 않았음
제품 변경: `src/auxiliary-inference-arbiter.js`, `src/app.js`, `index.html`에서 세 capacity-one lane이 capacity2·sole-third-lane wait를 공유하고 generation 취소·idempotent release·80ms pre/post fence·wait-inclusive Hand RTT·aggregate/per-lane wait telemetry를 소유; 일반 priority queue 주장은 제거
Before→After(fixed dev VC warmup1, r7→r8): body detection 28.0988→29.8617Hz, output/callback 310/332=93.37%→310/311=99.68%, overload+stale 20/332=6.02%→1/311=0.32%, Body avg/P95 33.86/40.70→25.89/28.60ms
Runtime/품질: arbiter maxActive2·maxQueue1·maxWait41.2ms, Face expired0·P95/max24.6/27.8ms, wait-inclusive Hand RTT P9547.5ms, applied latency P9530.1ms, error/fallback0; overall 92.9879→92.9920%(+0.0040%p), Hand product coverage 75.6452→74.6774%(-0.9677%p)
Recording: 302/302 exact PTS·generation, 33.333~33.334ms 단조 간격, causal Face reason만 존재하고 future 적용0; 독립 구현/성능 review·focused·`pnpm run check`·owned diff-check PASS
후속 미통과/중단: 허용된 warmup240도 29.9148Hz·309/309·Face expired0·latency P9529.4ms로 runtime은 통과했으나 기존 history comparator reset 30 exact frame 중 Face presence mismatch 1건(PTS0.433333: warmup1 obs0.4 non-null, warmup240 obs0.3 null; PTS0.466667에서 수렴); Body P950·Face rotation P950.109°·blendshape P950·steady150f는 통과
산출물: `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r8-auxarbiter-after-vc-{warmup1,warmup240}`; fresh dance A/B와 challenge는 기준대로 미실행
결론/다음/블로커: auxiliary admission 개선은 다음 before로 보존하되 결정론 checkpoint는 기각; wall-clock latest-completed Face cache가 아니라 source-time-owned bounded Face maturation을 제품 경로에 구현해 exact-PTS presence를 고정; 없음

2026-07-16 21:58 KST | P4 | 진행(source-slot Face maturation 체크포인트, Body exact-PTS 미통과)
가설/병목: Face worker 완료 시점에 따라 latest cache를 고르면 같은 Body PTS에서도 다른 관측 slot/presence가 적용되므로 admission 시점의 immutable token과 source-time eligibility가 Face 선택을 소유해야 했음
제품 변경: `src/face-observation-maturation.js`, `src/app.js`, `index.html`에서 generation·slot·sourcePts·absolute 80ms deadline token, 모든 null/drop/cancel terminalization, Body PTS-33.333ms 이하 newest terminal slot 단일 선택, 선택 후 rescan 금지와 wait/cancel 정리를 연결
Before→After(fixed dev VC warmup1, r8→r9): overall 92.9920→92.9187%(-0.0733%p), Hand product 74.6774→74.5955%(-0.0819%p), output/callback 310/311→309/310, body 29.8617→29.7956Hz, Body P95 28.6→29.5ms
Runtime: queue≤1, overload+stale 1/310=0.32%, Face expired/deadline-late/terminal-rejection 0/0/0·P95/max23.5/26.4ms, Hand RTT P9548.3ms, applied latency P95/max31.4/75.6ms, arbiter maxActive2·maxQueue1·maxWait44.9ms, error/fallback0
Warmup 결정론: r9 short/stressed 각 302 recording, common Body PTS 301/302; common Face slot/reason 301/301, reset presence 30/30, detector outcome 101/101·nonnull payload 69/69 exact, future/noncausal0, reset/steady Face rotation P950.109°/0.103°·blendshape0
미통과 원인/중단: short가 PTS8.266667을 Body overload로 버리고 PTS10.066667까지 연장한 반면 stressed는 8.266667을 포함하고 10.033333에서 종료하여 사전 기준 exact-common 302/302 실패; dance·challenge 미실행, Face 제품 수정은 유지하되 checkpoint 완료로 간주하지 않음
프로토콜 이탈 보존: 최초 명령의 `--min-pose-frames 1000000000` 오구성은 gate 확인 전 발견해 metric에서 제외하고 `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r9-facesettlement-invalid-protocol-minpose1e9`에 원본 보존; 기존 고정 명령(`--min-pose-frames 300`)은 warmup별 1회만 실행했고 추가 재시도 없음
산출물: `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r9-facesettlement-after-vc-{warmup1,warmup240}`; before `f18c212-p5-statelessfacelane-r8-auxarbiter-after-vc-{warmup1,warmup240}`
결론/다음/블로커: Face source-slot 소유권은 유지; 검증기·threshold를 바꾸지 않고 파일 영상 Body capacity-one pending slot이 희귀 추론 tail에서 덮어쓰이지 않도록 bounded playback backpressure를 제품 경로에 구현한 뒤 같은 fixed pair에서 before/after를 측정; 없음

2026-07-16 22:42 KST | P4 | 진행(file-video Body pending backpressure 체크포인트, 미통과)
가설/병목: Body capacity-one pump의 pending frame이 희귀 Pose tail 동안 새 rVFC frame으로 덮어써져 exact source PTS가 사라졌으므로, 파일 영상+rVFC에서 pending 소유 기간만 재생을 bounded pause하면 실제 frame을 보존할 수 있다고 보았음
제품 변경: `src/latest-frame-pump.js`, `src/video-playback-backpressure.js`, `src/app.js`, `index.html`에서 immutable queued/replaced/promoted/dropped transition, 별도 파일-video backlog owner, pre-armed rVFC 취소, matching promotion resume, absolute 80ms fail-open·episode bypass, generation/seek/rewind/config intent transfer와 오류/telemetry를 연결; camera/RAF·cadence·모델·threshold·recorder는 변경하지 않음
Before→After(fixed dev VC warmup1, r9→r10): overall 92.9187→93.0963%(+0.1776%p), Hand product 74.5955→74.9201%(+0.3247%p), output/callback 309/310→313/313, overload 1→0; 8 episode가 총68.8ms·최대22.3ms hold되고 deadline/control/transition error는0
하드 게이트 실패: Body 29.7956→29.3211Hz(<29.7), detect max65.6→232.9ms, applied latency max75.6→256.3ms(>80), Face expired0→1; PTS7.633333 ordinary Pose GPU tail 뒤 7.666667~7.866667 중 6 frame이 사라져 기존 stressed inventory와 exact common296/302
검증/중단: syntax·pump/generation/contract/presence/applied-state focused·`pnpm run check` PASS; fixed r10 short는 1회만 실행했고 실패 직후 warmup240·dance·challenge는 실행하지 않음
산출물: `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r10-bodybackpressure-after-vc-warmup1`; before `f18c212-p5-statelessfacelane-r9-facesettlement-after-vc-warmup1`
결론/다음/블로커: 즉시 pause/play가 짧은 pending 8건에도 media/GPU presentation churn을 만들면서 in-flight Pose tail 자체는 제한하지 못했으므로 r10 구현은 완료로 채택하지 않음; 다음 제품 변경은 routine pending에서는 media state를 건드리지 않는 hysteresis와 Body in-flight tail ownership을 함께 설계한 뒤 새 revision의 고정 short에서만 측정; 없음

2026-07-16 23:19 KST | P4 | 진행(file-video Body tail settlement 체크포인트, 통과)
가설/병목: r10은 pending 즉시 pause/play해 GPU Pose와 media/compositor 전이를 겹쳤고, promotion 때 재생해 232.9ms tail과 6-frame PTS 공백을 만들었음
제품 변경: `src/latest-frame-pump.js`, `src/video-playback-backpressure.js`, `src/app.js`, `index.html`에서 20ms 무제어 hysteresis, promoted consume/apply/dispose 후 settlement, pause 소유권 유지, capture/receive+80ms deadline과 4ms actual-avatar apply reserve를 연결
Before→After(r10→r11 short): Body 29.3211→29.8899Hz, detect P95/max30.2/232.9→29.5/37.6ms, applied max256.3→44.4ms, Face expired1→0; output/callback313/313→311/312, overload+stale0→0
품질 floor(r9→r11): overall92.9187→92.9146%(-0.0041%p), Hand product74.5955→74.7588%(+0.1634%p); queue≤1, Hand RTT P9551.8ms, error/fallback/control/transition0
소유권: short pending10건과 stressed7건 모두 20ms 안에 promotion되어 avoided pause17·실제 pause/play0; post-inference stale0
Warmup240/결정론: Body29.8757Hz·P95/max29.2/46.9ms·applied max48.1ms; 기존 r9 stressed 302-frame inventory를 short/stressed 모두302/302 missing0, raw common304f Body 오차0·reset Face presence mismatch0·blendshape0
검증/산출물: focused5종·contract·`pnpm run check`·diff-check PASS; `output/sam-goal-p5-reset/f18c212-p5-statelessfacelane-r11-bodysettlement-after-vc-{warmup1,warmup240}`
결론/다음/블로커: r11 유지·Body runtime/PTS checkpoint 수용; challenge 재실행 없이 dev dance의 strict planted-foot `lower-chain-unavailable` 제품 원인을 수정하고 actual contact/IK before/after로 이동; 없음

2026-07-17 00:00 KST | P4 | 진행(strict Foot rig-knee fallback-pole 체크포인트, 미통과)
가설/병목: contact 확정 시 near-straight source knee에 pole이 없어 `ik-degenerate-pole`로 즉시 해제됐고, 현재 rig hip→knee가 causal 초기 pole을 제공할 수 있었음
제품 변경: `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 actual rig fallback pole을 기존 `source-knee > previous-pole > fallback-pole` 경로에 연결; solver/contact threshold는 불변
Before→After(fixed dance/Xbot): exact359/359, degenerate episode3→0, IK3→4(<최소6), Foot teacher P9547.732→47.732°, Right ankle FK P9518.5310→18.5339%H
실패 원인: PTS4.515042 fallback IK는 residual1.33e-10H로 성공했으나 다음 PTS4.556848 root/Hips 뒤 hip-anchor가 max reach를1.955mm 초과해 실제 `ik-unreachable` 1회·ankle jump6.704%H 발생
안전: endpoint residual max6.03e-10H·slide P957.44e-9H/s·non-lower/root rotation P95 불변; fixed 1회 실패 뒤 fresh dance·challenge는 실행하지 않음
검증/산출물: strict/contract focused·`pnpm run check`·diff-check PASS; `output/sam-goal-p4-contact/f18c212-p4contact-rigfallbackpole-r1-fixed-after-dance`
결론/다음/블로커: pole 연결은 유지하되 checkpoint 미수용; exact reach/anchor를 유지하는 planted-root 최소 보정 제품 r2로 즉시 이동; 없음

2026-07-17 00:17 KST | P4 | 진행(planted-root reach 보정 체크포인트, fresh 미통과)
가설/병목: planted anchor가 rig 최대 reach를 1.955mm 넘을 때 exact solver가 유효한 clamp를 버려 contact가 해제됐음
제품 변경: `src/retarget/planted-foot-ik.js`, `src/avatar-renderer.js`, `src/app.js`에서 1%H 누적 한도의 model/root 동시 reach 보정 뒤 exact two-bone solve
Fixed Before→After: exact359/359, IK3→6, degenerate/unreachable3→0, endpoint max6.02e-10H·slide P957.44e-9H/s, Foot P9547.732° 동일
Fresh 실패: pose358/358→351/359, raw lower-chain688/716(96.09%)→422/718(58.77%), IK2→2(After 좌1/우1; 기준 총≥5·우≥4)
Runtime/품질: latency P95/max33.1/40.6ms·queue0·error/fallback0; exact-common Foot47.407→50.167°, ankle FK L/R19.555/17.301→25.317/23.297%H
검증/산출물: focused·`pnpm run check` PASS; fixed `f18c212-p4contact-rootreach-r2-fixed-after-dance`, fresh `f18c212-p4contact-rootreach-r2-live-dance`; 재시도·challenge 없음
결론/다음/블로커: reach 보정은 고정 원인을 해결해 유지하되 fresh checkpoint는 기각; stateless Body IMAGE가 잃은 temporal tracking을 VIDEO 경로로 제품 복원; 없음

2026-07-17 00:35 KST | P4 | 진행(stateful Body VIDEO 연속성 체크포인트, latency 미통과)
가설/병목: stateless IMAGE가 프레임별 독립 추론으로 pose/lower-chain 연속성을 잃었으므로 Body만 causal VIDEO tracker와 세대별 fresh detector로 복원
제품 변경: `src/motion-worker.js`, `src/app.js`, `index.html`에서 Body VIDEO+`detectForVideo`, atomic initial install/세대 recreate를 연결하고 Face IMAGE·Hand·cadence·threshold는 불변
Before→After(fresh dance/Xbot): pose351/359→359/359, raw lower-chain422/718(58.77%)→656/718(91.36%), candidate/planted/IK12/2/2→48/30/30(좌12/우18)
Contact 안전: actual degenerate/unreachable0, residual max4.15e-9H, bone/endpoint/source-PTS coverage100%, queue0·worker error/fallback0
품질: overall94.962→96.279%, legs direction99.861%, Foot teacher P9550.167→44.605°, ankle FK L/R25.317/23.297→18.532/17.388%H
미통과 원인: seek generation detector recreate102.2ms를 첫 PTS0 frozen frame 뒤 수행해 apply P95/max24.4/427.3ms, detection23.2407Hz로 기준 max≤80ms·≥23.5Hz 실패
검증/산출물: focused·`pnpm run check` PASS; `output/sam-goal-p4-contact/f18c212-p4contact-bodyvideo-r1-live-dance`; fresh 1회·재시도/challenge 없음
결론/다음/블로커: VIDEO 품질 복원은 유지하되 checkpoint 미수용; detector 준비→decoded boundary snapshot 순서로 제품 수정하고 새 revision 1회 before/after; 없음

2026-07-17 01:06 KST | P4 | 진행(same-graph Body VIDEO generation reset 체크포인트, 미통과)
가설/병목: seek마다 detector를 재생성하지 않고 같은 Pose graph를 IMAGE→VIDEO로 reset한 뒤 source timing·snapshot을 만들면 첫 actual-avatar apply cold tail을 제거할 수 있었음
제품 변경: `src/tracking-input-generation.js`, `src/motion-worker.js`, `src/app.js`, `index.html`에서 first/new generation state reset, same-generation reuse, config candidate reset 후 atomic commit, prepare-before-boundary를 연결; seed/dummy inference·timestamp 이동 없음
Before→After(fresh dance/Xbot): recreate102.2ms→same-graph reset321.6ms, first detect max425.5→319.1ms, apply P95/max24.4/427.3→24.1/320.9ms, gate438.0→643.9ms, Body23.2407→23.3910Hz
하드 게이트 실패: apply max320.9ms>80ms·Body23.3910Hz<23.5Hz이며 setOptions reset과 첫 detect가 각각 cold graph 비용을 지불해 user-visible boundary freeze도205.9ms 악화
품질/안전: pose359/359, raw lower656/718=91.36%, IK29(좌12/우17), degenerate/unreachable0, residual max4.15e-9H, overall96.245%·legs99.861%, coverage100%, queue0·error/fallback0
Teacher 비회귀: Foot P9544.605→44.666°, ankle FK L/R18.532/17.388→18.451/17.326%H; focused·contract·`pnpm run check`·diff-check PASS
산출물/결론/다음: `output/sam-goal-p4-contact/f18c212-p4contact-bodyreset-r3-live-dance`; fresh 1회·재시도/challenge 없음, reset lifecycle은 격리 의미만 보존; 후속 이력 감사에서 detector-palm Hand owner가 이미 폐기됐음을 확인해 canonical/distilled Hand 표현으로 전환; 없음

2026-07-17 02:06 KST | P4 | 진행(canonical torso-world Hand distillation r1, 미통과)
가설/병목: Pose33 fingertip와 teacher MHR70 MCP 의미 차이를 KE+new+VC skeleton-only 21D ridge로 보정하면 actual Hand tail이 줄 것으로 보았음
제품 변경: `src/retarget/canonical-hand-frame*.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 same-frame torso-world canonical frame과 strict sole-writer 전단 0.25 blend를 연결; detector는 ≤500ms feature만, finger/causal owner는 불변
Before→After(fixed dance/Xbot, exact358): Hand mean57.315→56.870°지만 P95106.746→113.131°·>90 count84→86, Left/Right P95106.746/111.848→113.131/113.588°
비소유/성능: ForeArm P9569.942→70.695°, MCP/PIP/DIP P95 불변, applyDuration P951.0→2.2ms; actual bone/endpoint/source-PTS coverage100%, frozen Hand product coverage94.568%
원인: teacher torso-world palm target이 P95≈70°인 live ForeArm parent 오차와 actual local-Hand 목적을 분리하지 못했고 confidence<0.5 구간은 causal state에 누적되어 최대171° direct divergence를 만듦
검증/산출물: focused·contract·`pnpm run check`·독립 review PASS; `output/sam-goal-p4-hand/f18c212-p4hand-canonicalstudent-r1-fixed-after-dance`
결론: r1 폐기; fixed replay 1회 뒤 fresh/challenge/threshold 변경 없음
다음 제품 작업: teacher palm을 canonical minimal-swing forearm-relative frame으로 학습·live forearm frame에 복원해 parent-relative actual Hand 목적을 직접 맞추는 r2
블로커: 없음

2026-07-17 02:39 KST | P4 | 진행(canonical forearm-relative Hand distillation r2, 미통과·폐기)
가설/병목: teacher palm을 parity-aware minimal-swing forearm 좌표에서 학습하고 live skeleton forearm으로 복원하면 r1의 torso/parent 혼입을 제거할 것으로 보았음
제품 변경: `src/retarget/canonical-hand-frame*.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 KE+new+VC skeleton-only 21D ridge(lambda100, blend0.25, 3018 side rows)를 strict Hand sole-writer 전단에 연결
Before→After(fixed dance/Xbot, exact358): Hand mean57.315→60.220°, P95106.746→115.656°, >90 count84→95; low-confidence 60f mean56.826→59.087°·P9589.312→93.147°
부분 신호/비회귀: parent-high 36f Hand P95175.424→167.147°였으나 >90 14→16; temporal >90=0 유지, finger MCP/PIP/DIP 불변, actual coverage100%
성능/안전: ForeArm P9569.942→70.695°, apply P951.0→1.200000003ms로 허용 상한을 부동소수점 수준 초과; fixed 1회 뒤 fresh/challenge/계수·gate 재탐색 없음
근본 원인: 학습된 relative frame을 live skeleton forearm world로 되돌린 뒤 actual avatar ForeArm parent에 다시 역변환하여 parent frame mismatch를 재주입함
폐기/복구: r2 artifact·resolver·renderer 연결·student 전용 계약을 제거하고 pre-student Hand 경로로 복구; focused·contract·전체 `pnpm run check`·diff-check PASS
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-forearmrelative-r2-fixed-after-dance`; before `output/sam-goal-p4-contact/f18c212-p4contact-bodyreset-r3-live-dance`
다음 제품 작업/블로커: actual avatar ForeArm parent 기준으로 relative Hand target을 직접 재구성해 parent mismatch를 상쇄하는 제품 경로를 설계·구현; 없음

2026-07-17 03:26 KST | P4 | 진행(actual-parent relative Hand r3, 미통과·폐기)
가설/제품 변경: r2 frozen relative frame을 actual ForeArm rig/Hand parent 좌표에 직접 매핑하도록 `src/retarget/canonical-hand-frame*.js`, `src/retarget/rig-local-rotation.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`을 수정해 skeleton-parent mismatch를 상쇄
Before→After(fixed dance/Xbot, exact358): Hand mean57.315→74.410°, P95106.746→153.311°, >90 count84→210; Left/Right P95106.746/111.848→154.031/148.880°
취약 cohort: confidence<0.5 60행 mean56.826→106.246°·P9589.312→168.549°·>90 3→37; parent-high P95175.424→162.723°였으나 >90 14→25
비소유/성능: temporal >90=0·finger MCP/PIP/DIP·coverage100% 유지, ForeArm P95+0.753°·Foot+0.170°, apply P951.0→1.7ms로 guard 실패
근본 결론: actual-parent cancellation 단독 가설은 기각; skeleton-minimal-swing 기준의 절대 frame은 actual rig 기준으로 옮길 때 blend=0조차 기존 Pose-world baseline을 보존하지 않는 표현 불일치가 지배적 후보
중단/복구: fixed 1회 뒤 fresh/challenge/계수·gate 재탐색 없음; r3 resolver/artifact/solver/renderer/test 계약을 제거하고 `20260717-canonical-hand-revert-1` Pose-world Hand 경로로 복구, focused·contract·전체 `pnpm run check`·diff-check PASS
산출물: `output/sam-goal-p4-hand/f18c212-p4hand-actualparent-r3-fixed-after-dance`; before `output/sam-goal-p4-contact/f18c212-p4contact-bodyreset-r3-live-dance`
다음 제품 작업/블로커: zero correction에서 baseline local Hand를 수치적으로 보존하는 baseline-relative delta 표현을 KE+new+VC teacher inventory만으로 설계·동결하고 제품 `src/**` 경로에 연결; 없음

2026-07-17 04:07 KST | P4 | 진행(prewarmed Body VIDEO generation pool 체크포인트, 통과)
가설/병목: generation2 seek가 dirty same-graph reset321.6ms와 cold detect319.1ms를 경계 안에서 연속 지불하므로, 동일 delegate의 neutral-prewarmed VIDEO graph 2개를 bounded clean lease하면 exact state isolation과 realtime apply를 함께 만족할 수 있었음
제품 변경: `src/tracking-input-generation.js`, `src/motion-worker.js`, `src/app.js`, `index.html`에서 worker-only 2-slot clean bind/swap, 3세대 inactive dirty-slot synchronous reset, 무검출 prime 확인, pool/prime/dirty telemetry를 연결; main-thread·PTS·cadence·threshold는 불변
수명주기 보강: 독립 review에서 발견한 즉시 terminate와 stale pool telemetry를 close ACK/1s timeout 후 terminate 및 worker→main 전환 시 pool state 초기화로 수정; detector 중복/누락 close와 runtime 오보고를 차단
Before→After(fresh dance/Xbot): reset321.6→0ms, detect max319.1→33.1ms, actual apply P95/max24.1/320.9→25.7/34.6ms, gate643.9→43.8ms, Body23.3910→23.8462Hz
품질/접촉: pose359/359·raw lower656/718 유지, candidate/planted/IK47/29/29→46/30/30(좌12/우18), degenerate/unreachable0, overall96.245→96.279%, legs99.861% 유지
Teacher/안전: Foot P9544.666→44.608°, ankle FK L/R18.451/17.326→18.485/17.371%H, residual max4.14e-9H·coverage100%, queue0·error/fallback/dirty lease0
비용 공개: 두 GPU graph 순차 생성+neutral prime 총1166.5ms(795.7+370.8ms)를 worker ready 이전 startup으로 이동; pool2/prewarmed2/swap1/fallback-reset0
검증/산출물: focused generation·contract·syntax·전체 `pnpm run check`·diff-check·독립 재review PASS; `output/sam-goal-p4-contact/f18c212-p4contact-prewarmedpool-r4-live-dance`; fresh1회·재시도/challenge 없음
결론/다음/블로커: r4 채택; KE+new+VC에서 지표가 혼재한 baseline-relative Hand delta는 제품 연결 전 기각했으며, 다음은 기존 산출물로 P4 잔여 실제 병목을 선택해 새 `src/**` 변경+held-out checkpoint로 진행; 없음

2026-07-17 04:50 KST | P4 | 진행(lower-body dual geometry r4, 미통과·폐기)
가설/제품 변경: 스칼라 leg geometry는 contact/root/IK/Foot에 유지하고 same-frame raw-calibrated 2-link 방향은 moving UpLeg/Leg actual rotation에만 원자 적용; 이전 scalar contact 방향 shadow로 IK fallback 역류를 차단
Fixed Before→After(exact359): pooled ankle FK P95 17.976→17.048%H(5.16% 개선), Foot P95 44.608→43.306°, L/R ankle 18.485/17.371→17.736/16.217%H
하드 게이트 실패: contact candidate/planted/IK 46/30/30→47/25/25(우 IK18→13); fresh 47/22/22(좌/우9/13), legs direction99.861→97.561%, overall96.279→95.703%
Fresh actual: pooled ankle17.052%H·Foot43.502°로 endpoint는 개선됐으나 accepted contact/solver 일치도를 희생; pose359·raw lower656/718·coverage100%·Body23.837Hz·latency P95/max26.6/39.1ms·error/fallback0
검증/산출물: syntax·depth/strict/contract focused·전체 `pnpm run check`·diff-check PASS; `output/sam-goal-p4-leg/f18c212-p4leg-dualgeometry-r4-live-dance`
중단/복구: 사전 선언 dance 1회 뒤 재시도·threshold/contact tuning·challenge 없음; r4 제품/기존-test 변경을 제거하고 accepted prewarmed-pool r4 코드로 복구, focused/full check 재통과
결론/다음/블로커: raw retarget와 scalar contact를 별도 consumer로 나누는 것만으로는 actual rig state·IK lifecycle 결합을 보존하지 못함; 다음 제품 checkpoint는 독립적으로 확인된 root tracking/contact offset 누적 소유권 분리로 이동; 없음

2026-07-17 05:17 KST | P4 | 진행(root tracking/contact offset ownership r6, 미통과·폐기)
가설/제품 변경: Body tracking 보간과 planted reach correction이 공유 `rootMotion.offset`에 누적되던 소유권을 `trackingOffset`/`contactOffset`으로 분리하고, 1%H 상태 상한·source-PTS 60ms release·단일 root commit을 `src/avatar-renderer.js`에 적용
Before→After(fresh exact359): root mean/P95/max 2.092/2.782/3.176→1.478/2.067/2.388%H, pooled world endpoint mean/RMS/P95 8.057/9.772/18.369→7.755/9.574/18.314%H
하드 게이트 실패: root P95/max가 ≤1.95/2.30%H에 미달, contact candidate/planted/IK46/30/30→53/23/23(좌/우12/18→11/12), legs99.861→99.791%
비회귀/성능: ankle FK L/R18.485/17.371→18.357/17.421%H·yaw P9516.291→16.196°/>15°20 유지, pose359·raw lower656/718·coverage100%, Body23.844Hz·latency P95/max25.7/34.4ms·queue/error/fallback0
검증/산출물: syntax·strict/applied-state/contract·전체 `pnpm run check`·diff-check PASS; `output/sam-goal-p4-root/f18c212-p4root-boundedcontactoffset-r6-live-dance`; 사전 선언 fresh1회·재시도/challenge 없음
중단/복구: 분리 offset·release·telemetry·lifecycle·cache 변경을 제거하고 `20260717-canonical-hand-revert-1` accepted shared-offset 경로로 복구, focused/diff-check 재통과
결론/다음/블로커: 누적 root 오차는 줄었지만 접지 상태 수명주기를 희생하므로 기각; 다음 제품 checkpoint는 기존 VC evidence의 face-gap hard reset을 기존 118ms causal identity release로 교체; 없음

2026-07-17 05:34 KST | P4 | 진행(causal Face gap identity release r1, 통과)
가설/병목: 400ms grace 종료 시 faceHeadComposition 즉시 identity reset이 PTS3.033333에서 Head 22.679°/680.362°/s snap을 생성
제품 변경: `src/face-head-pose.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 prior-observation release 신호와 기존 118ms source-PTS residual identity slerp를 적용; 초기화·260ms reacquire는 유지
Before→After(fixed VC exact302): jump2→0, max velocity680.362→174.136°/s, Head step P95/max3.026/22.679→3.152/5.804°, >20° 1→0
Teacher/비소유: Neck/Head P95 8.499/22.763° 동일, Head FK4.760066→4.760067%H; root/Hips/Hand/Foot/non-Head endpoint/contact JSON-exact, coverage100%
Fresh/runtime: pose451, overall96.971%, Body29.925Hz, apply P95/max22.2/36.5ms, queue/error/fallback0
검증/산출물: focused·전체 `pnpm run check`·diff-check PASS; `output/sam-goal-p4-head/f18c212-p4head-facegap-release-r1-{before,after}-vc`; after1회·재시도/challenge 없음
결론/다음/블로커: r1 채택; 기존 actual-state/teacher artifact로 P4 잔여 최대 오차의 단일 제품 원인을 선택해 `src/**` 변경+held-out checkpoint로 진행; 없음

2026-07-17 05:58 KST | P4 | 진행(torso shoulder/hip root-yaw consensus r3, 미통과·폐기)
가설/제품 변경: `src/solver/facing-estimator.js`의 shoulder-only yaw를 current-frame shoulder/hip axis 동등 consensus로 교체하고 기존 offset·rate·recovery·root/contact/IK 소유권은 유지
Before→After(fresh exact359): root yaw P95 16.291→15.040°·>15° 20→18로 감소했으나 ≤15° gate 미달; fixed replay는 P95 14.967°였음
위치/endpoint: fresh root P95 2.782→2.564%H, pooled endpoint RMS 9.772→9.655%H, model-local ankle L/R 18.485/17.371→18.196/17.297%H
하드 게이트 실패: fresh contact 46/30/30→48/29/29(좌/우 IK12/18→12/17), legs99.861→99.791%; fixed contact도47/24/24로 contact 수명주기 비회귀 실패
성능/안전: pose359·coverage100%, Body23.823Hz, apply P95/max26.0/43.7ms, degenerate/unreachable0·queue/error/fallback0
검증/산출물: focused·contract·전체 `pnpm run check`·diff-check PASS; `output/sam-goal-p4-root/f18c212-p4root-torsoconsensus-r3-live-dance`; 1회·재시도/challenge 없음
중단/복구/다음: consensus·test·cache 변경을 제거하고 face-gap r1 accepted 제품 상태로 복구; root 방향 단독 관측 변경은 contact를 흔드므로 다음 checkpoint는 기존 artifact에서 독립된 actual-state 병목을 선택; 블로커 없음

2026-07-17 06:35 KST | P4 | 진행(Pose Hand plane-observability confidence r1, 미통과·폐기)
가설/병목: Pose33 wrist-index/pinky 손끝 평면이 거의 일직선이면 palm roll이 관측 불가능하므로 평면 condition을 기존 Hand innovation confidence에 반영하면 잘못된 확정을 막을 것으로 보았음
제품 변경: `src/retarget-orientation.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 3D normalized triangle area를 confidence에 곱하고 기존 pose-world causal owner·420°/s gate·finger 소유권은 불변
Before→After(fixed dance/Xbot, exact359): Left Hand P95 106.572→132.855°, Right 105.995→127.790°, >90 error 41/41→59/66으로 양쪽 모두 20% 이상 악화
시간/세부: Hand step >90°는 0 유지, MCP local quaternion은 metric-exact였으나 contact candidate/planted/IK 46/30/30→47/25/25로 고정 replay lifecycle guard도 미통과
원인: 정상적으로 좁은 손끝 자세까지 confidence가 낮아져 causal hold가 과도한 지연을 만들었고, condition은 teacher-correct 방향을 판별하는 신호가 아니었음
검증/산출물: focused·contract·전체 `pnpm run check`·diff-check PASS; `output/sam-goal-p4-hand/f18c212-p4hand-planeobservability-r1-fixed-after-dance/avatar-report.json`
중단/복구/다음: 표준 runner가 fixed reference 전에 동일 dance live bootstrap도 실행했으나 그 수치는 판정·재시도에 사용하지 않고 protocol 이탈 원본으로 보존; 추가 fresh/challenge 없이 전체 diff 제거·check 재통과, 다음은 teacher MHR70 MCP 의미를 직접 예측하는 causal 제품 표현; 블로커 없음

2026-07-17 07:26 KST | P4 | 진행(contact-gated root-yaw innovation r1, 미통과·폐기)
가설/제품 변경: shoulder canonical yaw와 hip consensus innovation을 분리하고 `src/solver/facing-estimator.js`, `src/solver/pose-solver.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에서 직전 양발 고속-moving 구간에만 innovation을 갱신
Before→After(fixed exact359): root yaw P95 16.291→15.102°·>15° 20→19로 목표 ≤15°/≤17에 미달, Foot P95 44.608→45.570°로 악화
하드 게이트 실패: contact candidate/planted/IK 46/30/30→47/25/25, lifecycle 718행 중 31행 불일치; legs direction99.861%는 유지
원인: 접촉 중 innovation 각속도를 동결해도 이미 누적된 root 회전이 발목 world 위치를 바꿔 다음 contact FSM 입력과 anchor lifecycle을 교란
안전/산출물: coverage100%·exact PTS359; `output/sam-goal-p4-root/f18c212-p4root-contactgatedinnovation-r1-fixed-after-dance/avatar-report.json`; fixed 1회 뒤 fresh/challenge/계수·gate 재탐색 없음
중단/복구: auxiliary metadata·renderer 상태/gate·telemetry·cache/test 변경만 제거해 face-gap r1 accepted 제품으로 복구; residue0·focused·전체 `pnpm run check`·diff-check PASS
다음 제품 작업/블로커: KE+new+VC에서 동결한 baseline-local delta Hand21 student를 zero-delta identity·teacher hard-bypass·stale reset 조건으로 `src/**`에 연결하고 dance 1회 held-out 판정; 없음

2026-07-17 08:03 KST | P4 | 진행(baseline-local Hand21 delta student r1, 미통과·폐기)
가설/제품 변경: KE+new+VC teacher로 동결한 177D·3-expert baseline-local delta를 `src/retarget/hand21-delta-student*.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에 zero-delta identity·teacher bypass·stale/miss reset 조건으로 연결
Fixed Before→After(exact359): Left/Right Hand P95 106.836/107.837→106.765/107.730°, >90° 합계82→80; combined mean57.171→57.060°로 Hand 비회귀와 material >90 개선은 통과
하드 게이트 실패: pooled Foot P95 44.608 한도 대비45.045°(+0.437°), legs direction99.861%는 유지; 사전 계약대로 fresh development·challenge·재학습·gate 조정·재시도 없음
비소유 확인: 직전 current-like fixed replay와 root/contact lifecycle exact, non-Hand local quaternion geodesic max0.000005°로 실질 불변; teacher actual-state는 accepted teacher와 transform exact
원인: Hand 전용 post-owner 보정은 Foot을 쓰지 않지만 fixed replay의 기존 Foot 상태가 fresh accepted 절대 collateral 한도를 이미 넘었으므로 unit 전체 수용 조건을 충족하지 못함
검증/산출물: frozen weight SHA·focused·contract·전체 `pnpm run check`·diff-check·독립 review PASS; `output/sam-goal-p4-hand/f18c212-p4hand-baselinelocaldelta-r1-fixed-after-dance/avatar-report.json`
중단/복구: Hand21 모듈·renderer/cache/test hunk 전부 제거해 face-gap r1 accepted 제품으로 복구; residue0·focused·contract·전체 check PASS
다음 제품 작업/블로커: 기존 artifact로 contact/IK 이후 Foot local 회전의 P95 오차 cohort와 단일 소유권을 좁혀 contact lifecycle을 건드리지 않는 제품 보정을 설계; 없음

2026-07-17 09:16 KST | P4 | 진행(baseline-local moving-Foot delta student r2, fresh 미통과·폐기)
가설/제품 변경: KE+new+VC teacher로 동결한 77D side-canonical ridge를 moving·direction·non-IK Foot local에 post-contact 적용
Fixed Before→After(exact359): moving >40° 95→85, Left >40° 35→25, per-side P95 비회귀; candidate47/planted25·contact/root/ankle 불변
Fresh Before→After(exact359): moving P95 45.956→45.028°, >40° 85→80; Left P95 42.811→42.415°, Right 49.727→49.395°지만 Right >40° 54→59
하드 실패: contact46/30/30(L12/R18)→45/25/25(L12/R13); pose359·raw656/718·coverage100%·Body23.813Hz·apply26.3/52ms·queue/error/fallback0·legs99.861%
중단/복구: fresh 1회 뒤 재시도·재학습·threshold 변경·challenge 없이 제품 hunk 전부 제거; residue0·focused/contract/전체 check PASS, 실패 artifact 보존
결론/다음/블로커: r2 폐기·P4 반복 가설 보류; P5의 `src/app.js::reloadAvatarRenderer()` atomic rig/input generation lifecycle 제품 checkpoint로 이동; 없음

2026-07-17 10:26 KST | P5 | 진행(atomic avatar rig/input generation swap r1, fixed 미통과·폐기)
가설/제품 변경: `src/app.js::reloadAvatarRenderer()`를 active guard→callback 취소→generation fence→renderer 교체의 latest-wins 경계로 만들고 stale actual apply를 차단
Before→After(runtime smoke): active swap generation delta 0→1; Xbot→Soldier actual 454행 중 pre-switch apply 0·NaN quaternion 0, queue0·error/fallback0; rapid selection은 2 start/1 complete/1 superseded와 final generation actual12행만 적용
실패/중단 경계: corrupt GLB는 input stop·gate0·2초 late apply0; slow model loading 중 Stop은 15초 generation/output/apply delta0·`input-lifecycle-changed`
Fixed 하드 실패: no-swap exact359·actual/FK/sourcePTS coverage100%였으나 contact 46/30/30(L12/R18) 기준 대비47/25/25로 planted/IK 미달
검증: syntax·contract·전체 `pnpm run check`·diff-check·독립 review PASS; fixed 1회 실패 뒤 teacher/fresh/challenge 미실행
중단/복구: atomic lifecycle·telemetry·cache/test hunk를 전부 제거해 face-gap r1 제품으로 복구; residue0·독립 revert review·전체 check PASS
결론/다음/블로커: r1 폐기; 기존 3-rig×7 paired artifact에서 가장 큰 실제 제품 병목 하나를 선택해 `src/**` before/after checkpoint로 이동; 없음

2026-07-17 11:34 KST | P5 | 진행(ForeArm–Hand palm-roll factorization r1, held-out 미통과·폐기)
가설/제품 변경: accepted causal Hand world target은 유지하고 palm-implied 축회전만 ForeArm으로 옮긴 뒤 Hand local을 보상하도록 `src/retarget/rig-local-rotation.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`을 수정
Before→After(VC, Xbot/Soldier/Polydancer 각 exact451): 전체 ForeArm+Hand mean/P95 34.134/83.499→32.717/74.075°(P95 -11.29%, mean -1.417°); rig별 mean 개선 Xbot2.460°·Soldier0.873°·Polydancer0.919°
Coverage/비소유: required bone·FK·sourcePTS100%; canonical Xbot100%·Soldier/Polydancer96.875%(Eye 2개 부재); root/Arm/head/lower/Foot/endpoint 허용범위였으나 Xbot finger P9535.757→36.238°(+0.481°)로 실패
Runtime/추가 실패: Body29.83~29.93Hz·frame P9521.7~22.3ms/max33.6~54.6ms·queue0·error/fallback0였으나 Xbot stale-result1로 zero gate 실패; contact는 세 rig 모두0/0/0으로 동일
검증: pure 축회전·mirror/q-alias·Hand-world 보존·2-frame parent transport, syntax/contract/전체 `pnpm run check`·독립 구현/revert review PASS; after 1회 뒤 재실행·sign/gain/gate 조정·challenge 없음
중단/복구/산출물: factorization·telemetry·test/cache hunk 전부 제거해 face-gap r1/causal-arm-local r7로 복구, residue0; `output/sam-goal-p5-multirig/f18c212-p5-forearm-roll-{before,after}-vc`
결론/다음/블로커: r1 폐기·단순 roll 재분배 보류; 기존 before/after에서 드러난 missing/held Pose Hand와 finger-subtree 부모 변화의 단일 제품 소유권을 분리해 새 `src/**` checkpoint로 이동; 없음

2026-07-17 12:18 KST | P5 | 진행(Pose Hand subtree gap-release r1, held-out 미통과·폐기)
가설/제품 변경: post-grace Hand state commit과 뒤쪽 MCP/Hand release가 분리된 owner를 `src/avatar-renderer.js`에서 source-PTS delta 기반 선행 단일 release+released local/world commit으로 통합하고 app/cache/test 계약 갱신
Before→After(new-dance/Xbot exact439): frozen low-confidence+detected cohort L99/R120, pooled MCP mean/P95 19.356/38.674→19.341/38.523°(mean -0.016°, P95 -0.390%)
전체 Hand/finger: MCP P95 41.578→41.194°, all-finger 32.820→32.760°, Hand L/R P95 139.466/102.747→138.948/102.760°; bone/FK/sourcePTS coverage100%
하드 실패: material gate mean≥0.5° 또는 P95≥2% 미달; contact29/26/26→33/24/24로 planted/IK -2; side stale L/R1/1 유지
Runtime/비소유: Body29.871→29.922Hz, frame P95/max23.3/43.2→23.1/39.0ms, queue≤1·error/fallback0; 모든 수치 비소유 guard 통과
검증/산출물: syntax·focused·contract·전체 check·독립 구현/revert review PASS; `output/sam-goal-p5-hand/f18c212-p5-hand-gap-release-r1-{before,after}-new`
중단/복구: after 1회 뒤 재시도·threshold/grace/smoothing tuning·VC/dance/challenge 없음; 제품/test/cache hunk 제거해 face-gap r1 accepted 상태 복구
결론/다음/블로커: r1 폐기; gap release는 최대 병목 아님. side Hand pump의 deterministic startup stale-result 1/side 제품 소유권과 missing high-error Hand observation의 관계를 기존 artifact로 분석해 새 `src/**` checkpoint로 이동; 없음

2026-07-17 13:41 KST | P5 | 진행(canonical-Pose arm residual student r1, held-out 미통과·폐기)
가설/제품 변경: KE+dance+VC로 동결한 39D/96-RFF side-canonical direction student를 `src/solver/arm-residual-student.js`, `src/avatar-renderer.js`, `src/app.js`, `index.html`에 depth 보정 뒤·rig 비율 정규화 전 연결
Before→After(new-dance/Xbot exact439): pooled Arm+ForeArm mean/P95 22.773/61.653→20.956/57.863°(mean -1.817°, P95 -6.15%)
하드 실패: pooled wrist FK mean/P95 8.093/24.764→8.253/25.805%H; LeftArm P95 +1.077°, Left wrist P95 +2.014%H로 side guard 미통과
비소유/contact: RightUpLeg P95 +0.549°; candidate/planted/IK 29/26/26→28/28/28로 candidate -1, 나머지 Head/Foot endpoint·root guard는 통과
Coverage/runtime: bone/FK/sourcePTS100%; Body29.871→29.923Hz, frame P95/max23.3/43.2→24.4/42.7ms, queue≤1·error/fallback0; Hand pre-inference stale drop1 별도 표기
검증/산출물: byte-exact payload SHA·golden/non-planar mirror·canonical carrier provenance·syntax/focused/contract/전체 check·독립 구현/revert review PASS; `output/sam-goal-p5-arm/f18c212-p5-arm-residual-student-r1-after-new`
중단/복구: after 1회 뒤 재시도·재학습·blend/gate 조정·다른 rig/clip/challenge 없음; 제품/test/cache hunk 제거해 face-gap r1 accepted 상태 복구
결론/다음/블로커: r1 폐기; learned 방향 residual은 wrist endpoint와 비소유/contact tail을 보존하지 못함. 다음은 strict ForeArm의 미사용 endpoint-preserving hinge 소유권을 기존 artifact로 좁혀 `src/**` 제품 checkpoint로 진행; 없음

2026-07-17 14:32 KST | P5 | 진행(strict arm source-PTS occlusion stabilization r1, held-out 미통과·폐기)
가설/제품 변경: strict actual 재-solve의 기존 stabilization opt-out만 `src/avatar-renderer.js`에서 제거해 low-confidence Arm/ForeArm을 hold/decay/reacquire하고 app/cache/contract identity를 갱신
Before→After(new-dance/Xbot exact439): pooled ForeArm mean/P95 24.944/63.042→25.367/64.011°; pooled wrist FK mean/P95 8.093/24.764→8.091/24.472%H(P95 -1.18%, material gate 미달)
하드 실패: RightArm/RightForeArm P95 +5.384/+2.508°, Right wrist +0.372%H, DIP +0.838°, root position +0.485%H, RightUpLeg +0.547°; contact candidate/planted/IK 29/26/26→28/24/24
Coverage/runtime: actual bone·FK·sourcePTS100%, teacher drift0; Body29.871→29.931Hz, frame P95/max23.3/43.2→26.4/53.3ms, queue≤1·error/drop/fallback0
검증/산출물: syntax·solver/strict/contract·전체 `pnpm run check`·strict dispatch·독립 structure/metric/revert review PASS; `output/sam-goal-p5-arm/f18c212-p5-strict-arm-occlusion-stabilization-r1-after-new`
중단/복구: after 1회 뒤 재시도·상수/threshold 조정·다른 rig/clip/challenge 없음; 네 제품/test/cache hunk를 pre-worker SHA로 byte-exact 복구, residue0
결론/다음/블로커: r1 폐기; broad arm target hold는 right chain·root/contact tail을 보존하지 못함. 다음은 ForeArm world-primary를 current-parent 아래 causal 단일 owner로 제한해 endpoint 방향과 parent 보상을 함께 보존하는 `src/**` checkpoint; 없음

2026-07-17 15:12 KST | P5 | 진행(ForeArm world-primary causal owner r1, held-out 미통과·폐기)
가설/제품 변경: 이전 actual ForeArm world-primary를 exact source-PTS 420°/s로 제한하고 현재 Arm parent 아래 다시 solve하도록 `src/retarget/rig-local-rotation.js`, `src/avatar-renderer.js`, app/cache/contract를 수정
Before→After(new-dance/Xbot exact439): ForeArm mean/P95 24.944/63.042→27.232/75.362°; pooled wrist FK mean/P95 8.093/24.764→8.143/24.744%H로 material gate 미달
직접 계약: actual world-primary 위반 Left122/438·Right87/438→각 0/438, max step 64.030/54.116→14.000/14.000°로 causal owner 자체는 통과
하드 실패: Left/Right ForeArm P95 +11.044/+12.496°, Left wrist +0.883%H, planted/IK 26/26→25/25; Hand·finger 및 대부분 비소유 guard는 통과
Coverage/runtime: actual bone·FK·sourcePTS100%, teacher drift0; Body29.871→29.897Hz, frame P95/max23.3/43.2→22.4/48.0ms, queue≤1·aggregate error/drop/fallback0
검증/산출물: syntax·strict/contract·전체 `pnpm run check`·strict dispatch·독립 structure/direct review PASS; `output/sam-goal-p5-arm/f18c212-p5-forearm-world-primary-owner-r1-after-new`
중단/복구: after 1회 뒤 재시도·속도/threshold 조정·다른 rig/clip/challenge 없음; 6개 제품/test/cache hunk를 pre-worker SHA로 byte-exact 복구하고 orchestrator discard
결론/다음/블로커: r1 폐기·arm smoothing 계열 보류; 가장 큰 actual Hand P95 119.822°의 Pose33 endpoint와 teacher MHR70 MCP/palm 의미·관측 lifecycle 불일치를 고치는 `src/**` 제품 checkpoint로 이동; 없음

2026-07-17 16:03 KST | P5 | 진행(Pose Hand secondary-hemisphere escape r1, held-out 미통과·폐기)
가설/제품 변경: low-confidence innovation hold에서 실제 적용 Hand primary는 보존하고 반대 hemisphere의 Pose secondary만 current-parent 아래 재-solve해 기존 causal quaternion owner로 보내도록 `src/retarget-orientation.js`, `src/avatar-renderer.js`, app/cache/test를 수정
Before→After(new-dance/Xbot exact439): pooled Hand mean 55.138→54.735°(-0.403°, 목표 -0.5° 미달), P95 119.822→121.462°(+1.639°); Left/Right P95 139.466/102.747→136.798/103.249°
하드 실패: pooled wrist P95 24.764→25.104%H(+0.341), Right ForeArm P95 57.096→58.146°(+1.050), Right Hand +0.503°, root position P95 +0.324%H, RightUpLeg +0.913°; contact candidate/planted/IK 29/26/26→28/28/28
Coverage/runtime: exact PTS 439·duplicate0·teacher height drift0, actual bone/FK/sourcePTS coverage100%; Body29.871→30.001Hz, frame P95/max23.3/43.2→24.2/46.9ms, queue≤1·aggregate error/drop/timeout/fallback0
검증/안전: 독립 review가 finite-vector overflow 성공 영벡터를 발견해 fail-closed+focused test로 수정·재검토 PASS; syntax·focused·contract·전체 check·strict dispatch PASS; `output/sam-goal-p5-hand/f18c212-p5-pose-hand-secondary-escape-r1-after-new`
중단/복구: after 단 1회 뒤 재시도·threshold/계수·다른 clip/rig·challenge 없이 6개 제품/test/cache hunk를 pre-worker SHA로 byte-exact 복구하고 orchestrator discard
결론/다음/블로커: hemisphere 부호만으로는 Pose fingertip↔teacher MCP 의미 불일치와 right-chain tail을 해결하지 못함; 기존 artifact에서 source-semantics/lifecycle 단일 소유권을 좁힌 다음 `src/**` checkpoint로 즉시 이동; 없음

2026-07-18 16:45 KST | P5 | 진행(RTMW3D-X WebGPU causal anchor+native Hand21 r1, 미통과·폐기)
가설/제품 변경: 명시 선택·lazy WebGPU RTMW3D-X를 8Hz capacity-1 anchor로 Full realtime에 causal fusion하고, native Hand21을 current palm carrier에 운반해 side별 RTMW→cache→prediction 소유권으로 실제 avatar 적용
활성화/runtime: pinned 369,330,857B·WebGPU·init13.830s, anchor117/117·8.014Hz·fused399/438, 실제 RTMW Hand L/R430/438, fallback/error/circuit/ownership0, Body30.001Hz·apply P95/max21.3/43.5ms·queue0
Before→After(new-dance/Xbot exact439): Hand mean55.138→55.117°(-0.021°, 목표 -0.5° 미달), P95119.822→120.160°(+0.281%); L/R P95139.466/102.747→138.698/102.621°
하드 실패: Right wrist P95+0.317%H, RightArm+2.048°, LeftForeArm+1.605°, RightUpLeg+16.860°, Leg L/R+12.107/+3.612°, LeftFoot+16.862°; contact29/26/26→12/1/1
정렬/원인: coverage100%·reference/live recording exact439·JSONL duplicate0이나 applied-state PTS0 seed duplicate1; strict Hand bone owner가 `pose-world-causal`로 고정돼 RTMW palm은 finger 입력에만 남고 근사 body anchor가 하체/contact를 교란
검증/산출물: focused·contract·전체 `npm run check`·diff-check·독립 activation/metric/root-cause review PASS; `output/sam-goal-p5-rtmw3d/f18c212-p5-rtmw3dx-r1-after-new`; challenge·재시도·threshold 변경 없음
중단/복구: RTMW 제품/runner/test/generated-doc 후보를 최초 커밋 `8bb4be8` 상태로 전부 복구하고 전체 check PASS; 실패 artifact 보존, 사용자 미추적 파일 불변
결론/다음/블로커: r1 폐기; 다음 fresh 제품 checkpoint는 RTMW side에서만 strict wrist causal owner를 Hand21 world basis로 전환하고 confidence/profile을 분리하며 lower-body anchor는 검증 전 비소유로 제한; 없음
