# csi-pose SAM-3D-Body 기반 품질/성능 개선 설계 및 작업 계획

- 작성일: 2026-07-03
- 작성 근거: `consulting-claude-code` fable 모델 분석, 로컬 데이터 확인, 기존 SAM 비교/오라클 구조 검토
- 대상 영상: `output/test-videos/csi-pose.mp4`
- SAM 데이터: `sam-3d-body-skeletons/csi-pose/`
- 목표: `csi-pose` 라벨과 SAM-3D-Body MHR70 스켈레톤을 이용해 action-tracker의 3D pose/action tracking 품질을 측정 가능한 회귀 자산으로 만들고, 실제 런타임 개선까지 이어지는 구현 계획을 세운다.

## 1. 핵심 결론

`csi-pose`는 기존 `jujae` 중심 검증보다 훨씬 강한 회귀 테스트 자산이다. 팔짱, 뒷짐, 손바닥 머리 옆, 앞으로 나란히, 반 앞으로 나란히, 손가락 움직임, 앞뒤 회전, 화면 이탈/재진입, 무릎/허리 높이 하체 가림이 모두 들어 있다.

가장 중요한 설계 방향은 `tracker vs SAM` 단순 비교가 아니라 `tracker vs SAM vs 수동 라벨` 3자 비교로 바꾸는 것이다. SAM-3D-Body도 부재 구간이나 강한 가림에서 틀릴 수 있으므로, 사용자 라벨을 SAM reference의 유효성 마스크와 행동 GT로 사용해야 한다.

로컬 확인 결과:

- 영상은 720x1280, 30fps, 약 94.974초, 2849프레임이다.
- `sam-3d-body-skeletons/csi-pose/skeletons_mhr70.jsonl`도 2849줄로 전체 프레임을 덮는다.
- `summary.json` 기준 `processed_frames=2849`, `total_person_predictions=2849`, `detection_misses=163`이다.
- 사람이 없다고 라벨된 70~72초에도 SAM JSONL은 60프레임 모두 `person_count: 1`을 내고, detector score가 0.360으로 고정된다.
- 78~79초 부재 구간도 `person_count: 1`이고 detector score가 0.265~0.928까지 흔들린다.
- 따라서 detector score 임계값만으로 부재를 걸러낼 수 없다. 수동 presence 라벨이 반드시 필요하다.

## 2. 현 상태 진단

현재 프로젝트가 이미 잘 갖춘 부분:

| 영역 | 현재 상태 | 유지 이유 |
|---|---|---|
| MHR70 어댑터 | `scripts/hmr-jsonl-adapter.mjs`, `src/skeleton/mhr70-mapping.js` | SAM MHR70을 action-tracker recording 계약으로 변환하는 기본 경로가 있다. |
| 시간 정합 | `scripts/motion-recording-compare.mjs`의 `sourceMeta.videoTime`, `--interpolate offline`, `--offset-ms auto` | tracker recording과 SAM recording을 프레임 단위로 비교할 수 있다. |
| 비교 리포트 | label window별 p50/p95, bracket gap, occlusion 지표 | 새 라벨 taxonomy를 추가하기 좋은 기반이다. |
| SAM profile | `scripts/sam-calibration-profile.mjs`, `src/depth-calibration.js` | 무릎/허리 가림 상태에서 관찰 가능한 세그먼트만 쓰는 방향과 맞다. |
| regression oracle | `scripts/sam-regression-oracle.mjs` | 표준 실행 조건과 품질 게이트를 강제하는 구조가 있다. |
| 테스트 | `npm run check`에 SAM adapter/profile/oracle 테스트 포함 | 구현 후 회귀 확인이 가능하다. |

현재 부족한 부분:

| 문제 | 영향 |
|---|---|
| 사람 부재 구간 개념이 약하다. | 화면에 사람이 없어도 SAM 또는 tracker가 ghost skeleton을 유지할 수 있다. |
| 자동 라벨이 SAM에 종속된다. | SAM이 틀린 구간을 GT처럼 쓰면 오류가 숨는다. |
| 손가락 지표가 없다. | MHR70에는 손가락 40개 관절이 있지만 현재 비교/오라클에서 활용되지 않는다. |
| 행동 의미 분류가 약하다. | 각도 오차는 측정하지만 `팔짱`, `뒷짐`, `손바닥 머리 옆`, `앞으로 나란히`를 직접 판정하지 못한다. |
| stable hold와 transition이 섞인다. | 전환 구간의 자연스러운 p95 스파이크가 유지 자세 품질 판단을 오염시킨다. |
| oracle threshold가 특정 클립 중심이다. | `jujae`와 `csi-pose`를 같은 수치로 무리하게 평가하면 오탐/누락이 생긴다. |
| MHR70 이름 테이블 일부가 추정 이름이다. | `metadata_mhr70.json`의 공식 관절 이름으로 감사 가능성을 높여야 한다. |

## 3. csi-pose 라벨 자산화

### 3.1 전역 촬영 조건

사용자 정정 사항을 반영해 occlusion 조건을 다음처럼 분리한다.

| 시간 | 조건 |
|---:|---|
| 0~81초 | 화면에 무릎 높이까지 테이블에 가려진 상태 |
| 81초 이후 | 테이블에 허리 아래까지 가려진 상태 |

이 조건은 단순 설명이 아니라 평가 입력이다. 하체 관절 오류를 같은 기준으로 판단하면 안 되며, `table-knee`와 `table-waist`는 depth calibration/profile, visible segment gate, lower-body hallucination 감시에 사용해야 한다.

### 3.2 라벨 taxonomy

수동 라벨은 다음 축으로 정규화한다.

| 축 | 값 |
|---|---|
| `presence` | `present`, `absent`, `exiting`, `entering` |
| `facing` | `front`, `back`, `turning` |
| `arms` | `down`, `crossed`, `chest-raised`, `palms-near-head`, `forward`, `half-forward`, `behind-back`, `camera-reach`, transition 상태 |
| `fingers` | `moving`, `idle`, `unobservable` |
| `occlusion` | `table-knee`, `table-waist` |
| `phase` | `hold`, `transition` |
| `handsOutOfFrame` | true/false |

`phase`는 필수로 둔다. stable hold와 transition을 분리하지 않으면 품질 목표를 올릴 수 없다.

### 3.3 수동 라벨 fixture

신규 fixture를 만든다.

- 파일: `tests/fixtures/sam-manual-labels/csi-pose.json`
- 커밋 대상: 예
- 대용량 영상/SAM JSONL: 기존 방침대로 커밋하지 않음

주요 구간은 다음처럼 정규화한다.

| 시간 | phase | presence | facing | arms | fingers | occlusion |
|---:|---|---|---|---|---|---|
| 0~5 | hold | present | front | down | idle | table-knee |
| 5~9 | hold | present | front | crossed | idle | table-knee |
| 9~13 | hold | present | front | down | idle | table-knee |
| 13~19 | hold | present | front | crossed | idle | table-knee |
| 19~21 | hold | present | front | down | idle | table-knee |
| 21~30 | hold | present | front | chest-raised | moving | table-knee |
| 30~34 | transition | present | turning to-back | down | unobservable | table-knee |
| 34~37 | hold | present | back | down | moving, unobservable | table-knee |
| 37~42 | hold | present | back | crossed | unobservable | table-knee |
| 42~46 | transition | present | turning to-front | crossed | unobservable | table-knee |
| 46~49 | hold | present | front | crossed | idle | table-knee |
| 49~50 | transition | present | front | raising-to-palms-near-head | idle | table-knee |
| 50~55 | hold | present | front | palms-near-head | moving | table-knee |
| 55~57 | transition | present | front | lowering | idle | table-knee |
| 57~59 | hold | present | front | forward | idle | table-knee |
| 59~60 | hold | present | front | half-forward | idle | table-knee |
| 60~65 | transition | present | turning left-right-front | half-forward | idle | table-knee |
| 65~70 | transition | exiting | front | down | idle | table-knee |
| 70~72 | hold | absent | none | none | none | table-knee |
| 72~78 | transition | present | moving | unknown | unknown | table-knee |
| 78~79 | hold | absent | none | none | none | table-knee |
| 79~81 | transition | entering | front | lowering-posture | unknown | table-knee |
| 81~82 | transition | present | front | raising-to-palms-near-head | idle | table-waist |
| 82~84 | hold | present | front | palms-near-head | moving | table-waist, hands-out-of-frame |
| 84~86 | transition | present | front | moving-to-behind-back | unobservable | table-waist |
| 86~88 | hold | present | front | behind-back | unobservable | table-waist |
| 88~90 | transition | present | front | moving-to-crossed | idle | table-waist |
| 90~92 | hold | present | front | crossed | idle | table-waist |
| 92~94.974 | transition | present | front | camera-reach | unknown | table-waist |

구간 경계에는 기본 `guardBandSec=0.25`를 둔다. hold 평가는 양 끝 guard band를 제외하고, transition 평가는 별도 watch/gate로 본다. 72~78초처럼 화면 경계에서 들어오고 나가는 횡단 구간은 segment별 guard band를 0.5초로 늘릴 수 있게 한다.

## 4. SAM MHR70 정규화 및 비교 설계

### 4.1 time alignment

기존 방식을 유지한다.

- offline SAM recording timestamp: `timestamp_sec * 1000`
- tracker recording timestamp: `sourceMeta.videoTime`
- 비교 옵션: `--timestamp-source sourceMeta.videoTime --interpolate offline --offset-ms auto --max-timestamp-delta-ms 25`

추가할 점:

- 전체 paired ratio와 별개로 `validPairedRatio`를 둔다.
- `invalid-reference` window에 속한 pair는 pose metric 분모에서 제외한다.
- 제외된 pair 수를 `excludedPairs`로 리포트한다.

### 4.2 reference validity

수동 라벨에서 다음 구간은 SAM reference의 pose metric을 무효화한다.

- `presence=absent`
- `handsOutOfFrame=true`인 손가락/손바닥 관련 세부 metric
- `fingers=unobservable`인 finger movement metric

중요한 점은 프레임을 삭제하지 않는 것이다. 프레임은 재현성과 디버깅을 위해 남기고, metric 계산 단계에서 validity mask로 제외한다.

### 4.3 presence handling

비교기에 다음 summary를 추가한다.

| metric | 의미 |
|---|---|
| `presenceAgreement.absentSuppressionRatio` | absent 구간에서 tracker skeleton confidence가 낮거나 avatar update가 억제된 프레임 비율 |
| `presenceAgreement.ghostFrames` | absent 구간인데 tracker가 고신뢰 skeleton을 낸 프레임 수 |
| `presenceAgreement.reacquireLatencyMs` | entering 이후 안정적인 skeleton을 다시 얻기까지 걸린 시간 |
| `presenceAgreement.excludedReferencePairs` | SAM reference가 수동 라벨 때문에 제외된 pair 수 |

70~72초 부재 구간은 SAM detector score가 고정 0.360이고, 78~79초는 score가 최대 0.928까지 나오므로 detector score만으로 부재를 판단하지 않는다.

### 4.4 MHR70 hand mapping

MHR70은 손별로 wrist 1점과 손가락 20점을 제공한다. 이를 MediaPipe hand 21점 형태로 합성한다.

신규 파일 후보:

- `src/skeleton/mhr70-hands.js`
- `tests/mhr70-hands-check.mjs`

왼손 기준 매핑:

| MediaPipe hand | MHR70 |
|---|---|
| wrist | `left_wrist` |
| thumb | `left_thumb_third_joint`, `left_thumb2`, `left_thumb3`, `left_thumb4` |
| index | `left_forefinger_third_joint`, `left_forefinger2`, `left_forefinger3`, `left_forefinger4` |
| middle | `left_middle_finger_third_joint`, `left_middle_finger2`, `left_middle_finger3`, `left_middle_finger4` |
| ring | `left_ring_finger_third_joint`, `left_ring_finger2`, `left_ring_finger3`, `left_ring_finger4` |
| pinky | `left_pinky_finger_third_joint`, `left_pinky_finger2`, `left_pinky_finger3`, `left_pinky_finger4` |

오른손도 동일한 규칙을 적용한다. adapter에는 `--hands mhr70` 옵션을 추가하고, 기본값은 기존 호환성을 위해 off로 둔다.

### 4.5 axis/scale calibration

기존 MHR70 변환은 유지하되, `csi-pose` 변환 리포트에 다음을 명시한다.

- `axisAuditYDownRatio`
- `zCameraNegativeRatio`
- `detectorScore` 분포
- `detectionMisses`
- `personSelection`
- `detectorModel`

절대 길이보다 각도/상대 길이/gesture 상태가 중요하므로, 1차 개선은 scale matching보다 validity와 action-level metric에 둔다.

## 5. 행동별 metric과 oracle gate

### 5.1 crossed-arms

대상 구간:

- 5~9초
- 13~19초
- 37~42초
- 46~49초
- 90~92초

Metric:

- `gestureAgreement.crossed.holdRatio`
- wrist-to-opposite-elbow distance
- forearm crossing sign
- elbow flexion range
- window-level pass/fail

초기 gate:

- front hold crossed 구간 gesture agreement 평균 >= 0.85
- back hold crossed 구간은 초기에는 watch, SAM-vs-manual 신뢰 확인 후 gate 승격
- transition 구간은 별도 watch

### 5.2 behind-back

대상 구간:

- 84~86초 transition
- 86~88초 hold

Metric:

- wrist depth behind torso 여부
- wrist가 hip/torso 뒤쪽에 유지되는 비율
- 팔꿈치/손목 visibility 변화
- table-waist occlusion 조건에서 하체 관절이 metric을 오염시키지 않는지

초기 gate:

- 86~88초 hold에서 behind-back 상태 agreement >= 0.75
- wrist depth sign 안정률 >= 0.8
- 84~86초 transition은 watch

### 5.3 palms-near-head

대상 구간:

- 49~50초 transition
- 50~55초 hold
- 81~82초 transition
- 82~84초 hold, hands-out-of-frame 포함

Metric:

- wrist가 ear/temple 높이 근처에 있는지
- wrist lateral distance가 머리 양옆 범위에 있는지
- 손이 화면 밖으로 나가는 구간에서 reference validity가 제대로 제외되는지
- finger movement energy

초기 gate:

- 50~55초 hold agreement >= 0.8
- 82~84초는 손 화면 이탈 때문에 손가락 metric은 watch, pose validity exclusion은 gate

### 5.4 forward-arms / half-forward

대상 구간:

- 57~59초 forward
- 59~60초 half-forward
- 60~65초 half-forward + 회전

Metric:

- shoulder-elbow-wrist pitch
- wrist depth가 shoulder보다 전방인지
- forward와 half-forward의 arm elevation 차이
- 회전 중 상태 유지율

초기 gate:

- 57~60초 hold 구간만 gate
- 60~65초 회전 구간은 watch, 안정화 후 gate 승격

### 5.5 finger movement

대상 구간:

- 21~30초
- 34~37초, 단 뒤돌아 있어 observable=false
- 50~55초
- 82~84초, hands-out-of-frame 포함

Metric:

- fingertip velocity/energy
- moving vs idle energy ratio
- hand landmark visibility
- tracker/SAM/manual 3자 상관

초기 gate:

- SAM hand 합성 기준 moving 구간 energy가 idle 구간의 2배 이상인지 확인
- tracker hand landmarks가 recording에 실제 존재하는지 먼저 확인
- tracker 손 데이터가 없다면 finger metric은 인프라만 구현하고 gate는 보류

### 5.6 front/back turn

대상 구간:

- 30~34초 to-back
- 34~42초 back hold
- 42~46초 to-front
- 60~65초 left-right-front

Metric:

- `facingAgreement`
- yaw error p50/p95
- turn settle latency
- hold 중 flicker count

초기 gate:

- back hold facing agreement >= 0.9
- hold window flicker <= 1
- transition settle latency <= 500ms는 watch에서 시작

### 5.7 screen-out/in

대상 구간:

- 65~70초 exiting
- 70~72초 absent
- 72~78초 cross screen
- 78~79초 absent
- 79~81초 entering

Metric:

- absent suppression ratio
- ghost frame count
- reacquire latency
- partial visibility 상태

초기 gate:

- absentSuppressionRatio >= 0.9
- ghost frame count는 리포트 필수
- reacquire latency <= 500ms는 watch에서 시작

### 5.8 lower-body occlusion

대상 조건:

- 0~81초 table-knee
- 81초 이후 table-waist

Metric:

- observable segment ratio
- lower-body length clamp ratio
- hip jitter p95
- 하체 세그먼트가 calibration profile에 부적절하게 들어가지 않았는지

초기 gate:

- 하체 가림 구간에서 lower-body segment가 unreliable로 처리되는지 gate
- length clamp <= 20%는 watch에서 시작하고 실측 후 ratchet

## 6. 품질 목표

품질 목표는 stable hold와 transition을 분리한다.

Stable hold gate:

- `validPairedRatio >= 0.95`
- front/back facing hold agreement >= 0.9
- crossed/palms/forward/down 등 gesture hold agreement 평균 >= 0.85
- hold 구간 target angle p50 <= 15도
- hold 구간 target angle p95 <= 40도
- absentSuppressionRatio >= 0.9
- oracle report는 어떤 window가 실패했는지 명시

Transition watch:

- turn settle latency
- gesture transition duration
- entering reacquire latency
- crossing 중 partial visibility jitter

Transition을 처음부터 강한 gate로 걸지 않는다. 사용자 라벨이 초 단위이고 transition 경계가 가장 불확실하기 때문이다. 2회 이상 같은 파이프라인에서 안정적인 실측값이 나오면 watch를 gate로 승격한다.

## 7. 성능 목표

오프라인 평가 성능:

- 2849프레임 기준 변환+라벨+프로파일+비교+오라클 총 60초 이하
- Node 메모리 피크 512MB 이하
- MHR70 hand 합성 추가 비용은 adapter 시간 +30% 이내

브라우저 런타임 성능:

- presence state machine과 gesture 분류 추가 비용 <= 0.2ms/frame
- 기존 `perf:pump`, `smoke:hud` 기준 FPS 회귀 없음
- 95초 recording 동안 메모리 증가 50MB 이하
- avatar update 억제 로직이 사람 부재 구간 외에는 motion forwarding을 방해하지 않아야 함

테스트 성능:

- `npm run check` 전체 시간 증가 +20% 이내
- 대용량 mp4/jsonl 없이 synthetic fixture로 contract test 수행

## 8. 구현 계획

### P0. csi-pose 입력 자산 고정

목표:

- 수동 라벨 fixture를 커밋 가능한 GT로 만든다.
- SAM csi-pose 데이터의 기본 품질과 부재 구간 stale skeleton 문제를 리포트한다.

작업:

- 신규 `tests/fixtures/sam-manual-labels/csi-pose.json`
- 신규 또는 확장 `scripts/sam-manual-labels.mjs`
- adapter summary에 `detectionMisses`, detector metadata, elapsedMs 기록
- `output/external/sam-3d-body/csi-pose/recording.jsonl` 생성은 비커밋 산출물로 유지

검증:

```sh
npm run hmr:jsonl -- --input sam-3d-body-skeletons/csi-pose/skeletons_mhr70.jsonl \
  --joint-format mhr70 \
  --output output/external/sam-3d-body/csi-pose/recording.jsonl
npm run check
```

완료 기준:

- 2849프레임 보존
- absent 구간 reference invalid 처리 기준 문서화
- 라벨 fixture schema test 통과

### P1. manual label compiler와 validity-aware compare

목표:

- 수동 라벨을 기존 compare가 읽을 수 있는 window/frame 라벨로 컴파일한다.
- absent/hands-out-of-frame/unobservable 구간을 pose metric에서 제외한다.

작업:

- 신규 `src/labels/manual-labels.js`
- 신규 `tests/sam-manual-labels-check.mjs`
- 수정 `scripts/motion-recording-compare.mjs`
- 신규 summary: `validPairedRatio`, `excludedPairs`, `presenceAgreement`, `byManualWindow`
- `package.json`에 `sam:manual` 추가

검증:

```sh
node tests/sam-manual-labels-check.mjs
node tests/motion-recording-compare-check.mjs
npm run check
```

완료 기준:

- absent 구간은 pose 오차 분모에서 제외된다.
- 부재 구간 ghost skeleton은 별도 presence metric으로 잡힌다.
- 기존 `--labels` 경로는 동작이 변하지 않는다.

### P2. MHR70 hand 합성과 finger movement metric

목표:

- SAM MHR70 손가락 관절을 MediaPipe hand 21점 형태로 변환한다.
- finger movement를 moving/idle 라벨과 비교한다.

작업:

- 신규 `src/skeleton/mhr70-hands.js`
- 신규 `tests/mhr70-hands-check.mjs`
- 수정 `scripts/hmr-jsonl-adapter.mjs`: `--hands mhr70`
- 수정 `scripts/motion-recording-compare.mjs`: `fingerMotionEnergy`
- 수정 `src/skeleton/mhr70-mapping.js`: metadata 기반 공식 이름으로 정리

검증:

```sh
node tests/mhr70-hands-check.mjs
node tests/mhr70-mapping-check.mjs
npm run check
```

완료 기준:

- SAM hand 합성 recording 생성 가능
- moving 구간 finger energy가 idle 구간보다 유의미하게 높음
- tracker recording에 hand landmark가 없으면 gate가 아니라 watch로 남김

### P3. gesture classifier 통합

목표:

- `crossed`, `behind-back`, `palms-near-head`, `forward`, `half-forward`, `down`, `chest-raised`를 의미 수준에서 분류한다.

작업:

- 신규 `src/labels/gesture-classifier.js`
- 신규 `tests/gesture-classifier-check.mjs`
- 수정 `scripts/sam-reference-labeler.mjs`: 중복 arm classifier 제거 후 공용 classifier 사용
- 수정 `scripts/motion-recording-compare.mjs`: `gestureAgreement` 추가

검증:

```sh
node tests/gesture-classifier-check.mjs
node tests/sam-reference-labeler-check.mjs
npm run check
```

완료 기준:

- hold gesture별 `samVsManual`, `trackerVsManual`, `trackerVsSam`이 리포트된다.
- crossed-arms와 behind-back을 같은 팔 접힘으로 뭉개지 않고 분리한다.

### P4. runtime presence state machine

목표:

- 사람이 화면에 없는 구간에서 avatar가 ghost skeleton을 계속 따라가는 문제를 줄인다.
- exiting/entering 상태를 리포트하고 reacquire latency를 측정한다.

작업:

- 수정 `src/app.js`: pose 평균 visibility 기반 `present`, `absent`, `entering`, `exiting` 상태
- absent 상태에서 avatar update hold 또는 confidence decay 적용
- 신규 `tests/presence-state-check.mjs` 또는 기존 motion forwarding test 확장
- HUD/debug summary에 presence 상태 노출

검증:

```sh
npm run check
npm run smoke:hud
npm run perf:pump
```

완료 기준:

- absentSuppressionRatio >= 0.9
- present 구간에서 정상 tracking 회귀 없음
- entering 후 reacquire latency 리포트 생성

### P5. csi-pose oracle profile

목표:

- clip별 gate/watch를 선언형 JSON profile로 분리한다.
- `jujae`와 `csi-pose`를 같은 oracle binary로 평가한다.

작업:

- 신규 `tests/fixtures/sam-oracle-profiles/csi-pose.json`
- 신규 또는 수정 `tests/fixtures/sam-oracle-profiles/jujae-regression-0-16_5.json`
- 수정 `scripts/sam-regression-oracle.mjs`: `--profile`
- 수정 `tests/sam-regression-oracle-check.mjs`
- 수정 `docs/sam-3d-body-regression-oracle.md`
- `package.json`에 `sam:oracle:csi` 추가

검증:

```sh
node tests/sam-regression-oracle-check.mjs
npm run check
```

완료 기준:

- csi-pose report를 profile로 평가해 gate/watch 결과를 낸다.
- jujae oracle 결과는 기존과 동일하게 유지된다.
- threshold 실패 시 어떤 label window가 문제인지 바로 나온다.

### P6. full csi-pose 재현 명령과 HTML 리포트

목표:

- 사용자가 같은 명령으로 전체 비교 결과를 재현할 수 있게 한다.

작업:

- `docs/sam-3d-body-regression-oracle.md` 또는 신규 runbook에 명령 고정
- HTML 리포트에 manual window별 pass/fail 표시
- worst frame/timecode 링크 또는 section 추가

완료 기준:

- clean checkout에서 대용량 입력만 존재하면 전체 pipeline 재실행 가능
- 산출물이 `output/reports/tracker-vs-sam-csi-pose-v1.{json,html}`로 생성됨

## 9. 유지할 contract와 제거/축소 후보

유지해야 할 것:

- `motionFrame` recording 계약
- `sourceMeta.videoTime` 기반 비교
- `--interpolate offline`, `--offset-ms auto` 흐름
- 대용량 영상/SAM JSONL 비커밋 원칙
- oracle provenance gate
- 기존 `jujae` baseline 재현성

제거/축소 후보:

| 후보 | 처리 |
|---|---|
| `MHR70_JOINT_NAMES`의 추정 이름 | `metadata_mhr70.json` 기준 공식 이름으로 교체 |
| `sam-reference-labeler.mjs` 내부 arm classifier | 공용 `gesture-classifier`로 이관 |
| 단일 default oracle threshold | clip별 oracle profile로 축소 |
| SAM 자동 라벨만을 GT처럼 쓰는 흐름 | manual label과 교차 검증하는 흐름으로 대체 |

현재 시점에서는 compare/oracle 전체 재작성보다 유지+확장이 낫다. 이미 adapter, compare, profile, oracle, contract test가 있으므로 이를 버리면 `jujae` 기준선과 최근 검증 자산을 잃는다. 다만 P5에서 gate 정의를 profile JSON으로 외부화해, 장기적으로 범용 window-gate 엔진으로 분리할 수 있는 길을 연다.

## 10. 최종 사용자 테스트 명령

P5/P6 완료 후 목표 명령 시퀀스:

```sh
# 1. SAM MHR70 -> action-tracker recording
npm run hmr:jsonl -- --input sam-3d-body-skeletons/csi-pose/skeletons_mhr70.jsonl \
  --joint-format mhr70 --hands mhr70 \
  --output output/external/sam-3d-body/csi-pose/recording.jsonl

# 2. SAM 자동 라벨
npm run sam:labels -- --input output/external/sam-3d-body/csi-pose/recording.jsonl \
  --output output/external/sam-3d-body/csi-pose/labels.json

# 3. 수동 라벨 컴파일과 SAM-vs-manual 교차 검증
npm run sam:manual -- --input tests/fixtures/sam-manual-labels/csi-pose.json \
  --auto output/external/sam-3d-body/csi-pose/labels.json \
  --output output/external/sam-3d-body/csi-pose/compiled-labels.json \
  --report output/reports/csi-pose-label-cross-check.json

# 4. 캘리브레이션 프로파일
npm run sam:profile -- --input output/external/sam-3d-body/csi-pose/recording.jsonl \
  --output output/external/sam-3d-body/csi-pose/calibration-profile.json

# 5. tracker recording 채취
node scripts/avatar-motion-agreement-check.mjs --video output/test-videos/csi-pose.mp4 \
  --only-models --model Xbot=assets/models/Xbot.glb \
  --recording-output output/reports/csi-pose-tracker-recording-v1.jsonl \
  --output output/reports/csi-pose-avatar-motion-recording-v1.json \
  --calibration-profile output/external/sam-3d-body/csi-pose/calibration-profile.json \
  --min-pose-frames 2840 --warmup-pose-frames 0 --timeout-ms 900000 \
  --playback-rate 0.15 \
  --pump rvfc --debug-overlay off --smoothing retarget \
  --measurement-only

# 6. tracker vs SAM vs manual 비교
npm run compare:recordings -- \
  --live output/reports/csi-pose-tracker-recording-v1.jsonl \
  --offline output/external/sam-3d-body/csi-pose/recording.jsonl \
  --timestamp-source sourceMeta.videoTime --max-timestamp-delta-ms 25 \
  --interpolate offline --offset-ms auto \
  --labels output/external/sam-3d-body/csi-pose/labels.json \
  --manual-labels output/external/sam-3d-body/csi-pose/compiled-labels.json \
  --output output/reports/tracker-vs-sam-csi-pose-v1.json \
  --html output/reports/tracker-vs-sam-csi-pose-v1.html

# 7. oracle gate
npm run sam:oracle:csi

# 8. regression/performance
npm run check
npm run perf:pump
npm run smoke:hud
```

참고: `--measurement-only`는 numeric gate를 끄는 옵션이며, `--recording-output`이 있으면 timeout이 나더라도 가능한 partial tracker recording JSONL은 저장되어야 한다. CPU headless 환경에서는 pose 처리 FPS가 낮아 `--playback-rate 0.15`처럼 영상을 느리게 재생해야 absent 구간까지 충분히 샘플링된다. 전체 95초 recording이 아니라 partial recording만 생성되면 compare는 산출되지만 `sam:oracle:csi`는 `offlineUsageRatio`, absent coverage, excludedPairs 게이트에서 실패해야 한다. 이 실패는 threshold 완화 대상이 아니라 recording coverage blocker 증거다.

## 11. 주요 산출물

| 산출물 | 경로 |
|---|---|
| 수동 GT 라벨 | `tests/fixtures/sam-manual-labels/csi-pose.json` |
| SAM recording | `output/external/sam-3d-body/csi-pose/recording.jsonl` |
| 자동 라벨 | `output/external/sam-3d-body/csi-pose/labels.json` |
| 컴파일된 수동 라벨 | `output/external/sam-3d-body/csi-pose/compiled-labels.json` |
| SAM-vs-manual 교차 리포트 | `output/reports/csi-pose-label-cross-check.json` |
| tracker recording | `output/reports/csi-pose-tracker-recording-v1.jsonl` |
| 비교 리포트 | `output/reports/tracker-vs-sam-csi-pose-v1.json` |
| HTML 리포트 | `output/reports/tracker-vs-sam-csi-pose-v1.html` |
| oracle 결과 | `output/reports/tracker-vs-sam-csi-pose-v1-oracle.json` |

## 12. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| 수동 라벨 경계가 초 단위라 transition이 불안정함 | hold는 guard band 적용, transition은 watch에서 시작 |
| SAM이 부재 구간에도 skeleton을 출력함 | manual presence로 reference validity mask 생성 |
| SAM pseudo-GT 자체가 틀릴 수 있음 | `samVsManual`을 항상 리포트하고, SAM 신뢰가 낮은 gesture는 tracker gate로 승격하지 않음 |
| tracker에 hand landmarks가 없을 수 있음 | P2에서 존재 여부 확인 후 finger gate를 watch로 유지 |
| table-waist 상태에서 하체 hallucination이 metric을 오염시킴 | observable segment gate와 calibration profile로 하체 metric 제외 |
| clip별 threshold 충돌 | clip별 oracle profile로 분리 |
| 런타임 성능 회귀 | gesture/presence 계산은 O(1)로 제한하고 `perf:pump`, `smoke:hud`로 확인 |

## 13. 우선순위

1. P0/P1: 수동 라벨 fixture와 validity-aware compare를 먼저 구현한다. 이 없이는 어떤 품질 수치도 신뢰하기 어렵다.
2. P5 일부: oracle profile 구조를 빨리 열어 `jujae`와 `csi-pose` threshold를 분리한다.
3. P3: gesture classifier를 통합해 팔짱/뒷짐/손바닥/앞으로 나란히를 의미 수준에서 검증한다.
4. P2: MHR70 hand 합성으로 손가락 움직임 평가 기반을 만든다.
5. P4: 평가에서 확인된 ghost/presence 문제를 런타임 상태기계로 개선한다.
6. P6: 사용자가 직접 재현 가능한 HTML 리포트와 runbook을 완성한다.

가장 먼저 구현해야 하는 것은 더 좋은 smoothing이나 더 강한 threshold가 아니라, `수동 라벨 기반 validity`와 `hold/transition 분리`다. 지금 문제의 핵심은 추적기가 틀리는 구간뿐 아니라 SAM reference 자체도 틀리는 구간을 구분하지 못한다는 점이기 때문이다.
