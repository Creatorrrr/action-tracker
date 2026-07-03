# SAM-3D-Body 스켈레톤 기반 3D Pose 추적 품질 개선 설계서

- 작성일: 2026-07-03
- 대상 저장소: `/Users/chasoik/Projects/action-tracker`
- 선행 문서: `docs/sam-mhr70-comparison-plan.md` (변환/비교 기반 구축 계획, 완료 단계)
- 본 문서의 위치: 위 계획의 "4단계(향후 개선 우선순위)"를 이어받아, SAM 데이터를 실제 3D pose 추적 품질 개선에 연결하는 설계와 작업계획을 정의한다.

## 0. 요약 (TL;DR)

SAM-3D-Body MHR70 데이터는 이미 `recording.jsonl`로 변환되어 tracker와 비교 가능한 상태다. 그러나 현재 비교는 **86쌍(전체 SAM 990프레임의 8.7%)의 무보간 nearest 페어링, confidence 무가중, 이벤트 구간 미구분** 진단에 머물러 있어, frontBack 83.3%, 팔 시각 진단 70.1%, length clamp 51.2%, CV segment 1/4 같은 실패/경고를 "어느 알고리즘의 어떤 결함" 수준으로 좁히지 못한다.

본 설계는 SAM 데이터에 4가지 역할(측정 기준선, 이벤트 라벨러, 캘리브레이션 소스, 회귀 oracle)을 부여하고, 6단계(P0~P5)로 (1) 비교 파이프라인의 측정 신뢰성 확보, (2) 매핑/좌표계 확정, (3) facing 추정의 3D화, (4) occlusion hold/decay, (5) 세그먼트 길이 프로파일 주입, (6) 게이트 통합을 진행한다.

## 1. SAM-3D-Body 데이터의 역할 정의

SAM은 **런타임 컴포넌트가 아니다**. 기존 계획의 비목표를 유지한다: 브라우저 내장 금지, 절대 GT 취급 금지. 대신 오프라인에서 다음 4가지 역할을 맡는다.

| 역할 | 정의 | 사용처 | 한계 인지 |
|---|---|---|---|
| **R1. Pseudo ground truth (측정 기준선)** | 같은 영상에 대한 dense(990fr, 59.94fps)·시간정합(`timestamp_sec`) 3D 참조. 절대 정답이 아니라 "합의 기준선" | `compare:recordings` 각도/힌지/깊이부호 지표의 offline 축 | SAM 자체도 단안 추정이므로 절대 오차 게이트는 관대하게, 방향성/회귀 감지 위주로 사용 |
| **R2. Event labeler (구간 라벨러)** | SAM 3D에서 프레임별 facing yaw, 팔 교차/등뒤 여부, 신체 커버리지, 2D out-of-bounds를 자동 라벨링 | "뒤돌기 구간에서 tracker facing이 몇 % 맞았나" 같은 **구간별** 지표 산출 | 라벨 자체가 휴리스틱이므로 라벨 규칙은 순수 함수와 단위 테스트로 고정 |
| **R3. Calibration source (오프라인 캘리브레이션 소스)** | SAM 3D 본 길이에서 인물별 세그먼트 길이 비율 프로파일 생성 | `src/depth-calibration.js`에 외부 reference ratio 주입. 상반신 전용 영상에서 하체/전신 캘리브레이션 안정화 | 검증 실행 전용. 일반 사용자 경로 기본값 불변 |
| **R4. Regression oracle (회귀 게이트)** | 측정 신뢰성(P0~P1)이 확보된 뒤, tracker-vs-SAM 지표를 회귀 게이트로 승격 | solver/calibration 변경 시 SAM 대비 p95 각도 오차가 기준선 대비 악화되지 않음을 자동 검증 | 게이트 값은 개선된 파이프라인으로 재측정한 새 기준선에서 산출. 현재 수치로 고정 금지 |

**비역할(명시적 제외)**: 브라우저 런타임 teacher, 프레임 단위 실시간 보정 소스, 절대 ground truth, mp4/jsonl 대용량 git 추가.

## 2. 현재 구현 상태 평가

### 2.1 구현 완료

| 영역 | 위치 | 상태 |
|---|---|---|
| MHR70 -> MP33 변환 | `scripts/hmr-jsonl-adapter.mjs` (`MHR70_TO_MEDIAPIPE33`, `convertSamMhr70JsonlRecording`) | 990프레임 변환, 2D 픽셀 정규화 + out-of-bounds 시 visibility 0.05 클램프, 3D hip-center 정규화, per-joint conf 사용 |
| 변환 테스트 | `tests/hmr-jsonl-adapter-check.mjs` | coco17 + mhr70 synthetic 검증 통과 |
| 비교 CLI | `scripts/motion-recording-compare.mjs` | `--timestamp-source sourceMeta.videoTime` 페어링, solver 기반 target 방향각/hinge flex 델타, HTML 리포트 |
| 실측 산출물 | `output/reports/tracker-vs-sam-jujae.json` 등 | 86 paired frames, byTarget/byHinge 요약 존재 |
| tracker recording | `scripts/avatar-motion-agreement-check.mjs --recording-output` | 123프레임 JSONL 산출 |

### 2.2 실측 기준선

`jujae-regression-0-16_5`, 2026-07-02 리포트 기준:

- Target 방향각: mean 13.9도 / p95 35.4도 / **max 120.1도 (RightForeArm)**. 팔과 발이 최악.
- Hinge flex: mean 17.9도 / p95 43.5도, elbow mean 약 19.4도.
- Agreement 게이트: **motion agreement 94.0% < 95% 실패**, **depth calibration reliable CV segments 1 < 4 실패**.
- 경고: frontBack 83.3% < 90%, visual arms 70.1% < 75%, length clamp 51.2%, pose frames 122개.

### 2.3 추가 데이터 사실

1. **페어링 커버리지가 낮다**: tracker 123프레임 중 86쌍만 매칭(70%), SAM 990프레임 중 8.7%만 사용. tracker는 headless CPU 실행으로 16.5초 영상에서 약 7.5fps에 그침.
2. **SAM 영상 초반 2D가 프레임 밖**: 990프레임 중 212프레임에 out-of-bounds 랜드마크가 존재하고, 특히 초반 약 0.5초는 프레임당 22~27개 랜드마크가 `y=0`으로 클램프됨. 그런데 world landmark visibility는 그대로 유지되어 solver가 이 구간을 고신뢰로 취급한다.
3. **World 좌표축은 MediaPipe와 잠정 일치**: 990프레임 전수에서 nose.y < ankle.y (y-down) 100%, nose.z < 0 (hip 기준 카메라 쪽 음수) 81.3%. 나머지 약 19%는 뒤돈 구간으로 해석 가능. 단 `sourceMeta.worldAxisX/Y: "native"`로 남아 있어 공식 axis audit은 미완이다.
4. **MHR70 wrist 매핑이 손 관절 기반**: MP15/16(wrist)이 MHR 62/41, MP17~22(손가락)가 MHR 61/40/49/28/45/24로 매핑됨. 손목 규약 차이가 ForeArm max 120도 오차에 기여할 가능성이 있으나 현재는 분리 측정 불가하다.

### 2.4 품질 개선 관점의 결함

| # | 결함 | 결과 |
|---|---|---|
| G1 | 비교기에 보간/시간 오프셋 추정/confidence 가중/커버리지 지표 없음 | 지표의 신뢰성이 낮아 개선 효과 측정 자체가 불안정 |
| G2 | 이벤트 구간(뒤돌기/팔 교차/상반신 전용) 미구분 | 전체 평균만 있어 특정 결함 개선이 지표에 묻힘 |
| G3 | facing 비교 지표 없음 | frontBack 경고의 원인을 SAM으로 판정 불가 |
| G4 | depth 부호 비교 지표 없음 | visual side-order vs depth 충돌 시 어느 쪽이 맞는지 판정 불가 |
| G5 | SAM 정보가 solver/calibration에 피드백되는 경로 없음 | SAM은 진단에만 쓰이고 추적 품질 개선에 미사용 |
| G6 | 매핑 테이블이 어댑터에 하드코딩, 관절 이름 상수 없음 | 매핑 검증/재사용/오버레이 대조 불가 |
| G7 | `estimateFacing()`이 2D x-order + face visibility 휴리스틱 | 뒤돌기/측면에서 실패. frontBack 83.3%의 유력 원인 |
| G8 | 상반신 전용 영상에서 하체 세그먼트 reference 부재 | CV segment 부족 실패, length clamp 51.2% |

## 3. 근본 설계

### 3.1 아키텍처 개요

```text
[SAM MHR70 jsonl]
   │ scripts/hmr-jsonl-adapter.mjs
   ▼
[SAM recording.jsonl] ──► scripts/sam-reference-labeler.mjs
   │                          │
   │                          ▼
   │                      [labels.json]
   │                          │
   ├──► scripts/sam-calibration-profile.mjs ──► [calibration-profile.json]
   │                          │                                  │
   ▼                          ▼                                  ▼
scripts/motion-recording-compare.mjs               src/depth-calibration.js
   ▲                                                   ▲
   │                                                   │
[tracker recording.jsonl] ◄── scripts/avatar-motion-agreement-check.mjs
                                     ▲
                     src/solver/pose-solver.js + src/solver/facing-estimator.js
                     src/app.js
```

원칙:

- 브라우저 앱 기본 동작과 `motionFrame` 스키마 v1은 불변. 확장은 `sourceMeta` 스칼라 필드와 옵션 플래그로만 수행한다.
- 모든 신규 로직은 순수 함수 모듈로 작성해 Node 단독 테스트가 가능하게 유지한다.

### 3.2 문제별 근본 설계

#### 3.2.1 뒤돌기 / 앞뒤 반전 / facing ambiguity

**현 상태**: `estimateFacing(points, fallback)`은 얼굴 visibility가 높으면 front, 어깨 x-order로 front/back, 어깨 폭이 작으면 side로 판정한다. 얼굴 visibility는 뒤통수에서도 높게 나올 수 있고, x-order는 미러/좌표 규약에 취약하며, 상태 전이에 히스테리시스가 없어 경계에서 플리커한다.

**설계**:

1. 신규 `src/solver/facing-estimator.js`에서 연속 yaw 기반 3D facing을 계산한다.
   - world landmark에서 몸통 좌표계를 구성한다: `across = rightShoulder -> leftShoulder`, `up = hipMid -> shoulderMid`, `forward = normalize(cross(up, across))`.
   - `facingYawDeg = atan2(forward.x, -forward.z)`.
   - 상태기계: `front`(|yaw| < 60도), `side-left`, `side-right`, `back`(|yaw| > 120도).
   - 전이 히스테리시스 ±15도와 최소 유지 프레임 N(기본 3)을 둔다.
   - 저신뢰(어깨/골반 confidence < 0.5) 시 이전 상태를 유지한다.
   - 얼굴 visibility는 상태 결정이 아니라 동률 해소용 보조 근거로 강등한다.
2. `solvePoseFrame`의 `previousState.facing`을 `{ state, yawDeg, holdFrames }` 구조로 확장하되, 기존 소비자를 위해 `meta.facing` 문자열은 유지한다.
3. SAM labeler가 SAM world에서 동일한 yaw를 계산해 프레임별 facing 라벨을 생성한다.
4. 비교기에 `facingAgreement`와 `yawErrorDeg`를 추가한다. 뒤돌기 구간만 별도 집계한다.
5. facing=back일 때 visual side-order 해석을 반전하도록 frontBack/side-order 검증 로직을 수정한다.

#### 3.2.2 crossed-arms / behind-back / occlusion 구간

**현 상태**: visibility 기반 confidence 감쇠만 존재한다. 팔이 몸통 뒤로 가면 MediaPipe가 임의 좌표를 출력하고 solver가 이를 그대로 방향으로 변환해 RightForeArm max 120도 같은 스파이크가 발생한다.

**설계**:

1. SAM labeler에서 다음 라벨을 생성한다.
   - `behindBack(side)`: wrist가 몸통 평면 뒤에 위치.
   - `crossedArms`: 좌측 wrist가 반대측 몸통 영역으로 넘어가고 반대도 성립.
   - 각 프레임 라벨과 연속 window 목록.
2. tracker 측에는 occlusion 상태기계를 둔다.
   - 감지: limb confidence 급락 + 2D에서 wrist가 torso bbox 내부 + depth sign 불안정.
   - 정책: **hold(마지막 고신뢰 방향 유지, 약 200ms) -> decay(rest 방향으로 완만 복귀) -> re-acquire(신뢰 회복 시 각속도 제한을 걸고 블렌드 복귀)**.
   - 재획득 스냅 방지를 위해 각속도 상한을 둔다.
3. 비교기는 label window별 target 각도 오차를 분리 집계한다.

#### 3.2.3 상반신 전용 영상의 하체/전신 calibration 불안정

**현 상태**: `src/depth-calibration.js`는 warmup 관측에서 세그먼트 길이 ratio를 추정한다. 상반신 전용이면 하체 세그먼트 샘플이 없어 `MIN_RELIABLE_CV_SEGMENTS 4` 미달로 실패하고, length solver는 관측 없는 목표 길이로 clamp를 반복한다.

**설계**:

1. 신규 `scripts/sam-calibration-profile.mjs`를 만든다.
   - SAM recording에서 고신뢰 프레임만 골라 `DEPTH_CALIBRATION_SEGMENTS`와 동일한 세그먼트 정의로 길이/`bodyScale2D` ratio의 robust 중앙값과 CV를 계산한다.
   - `{ version, video, person, segmentRatios }` JSON을 산출한다.
2. `src/depth-calibration.js`에 `applyExternalReferenceRatios(profile)`을 추가한다.
   - 외부 ratio는 `source: 'external-profile'`로 표기한다.
   - 관측이 충분해지면 관측값이 프로파일을 대체한다.
3. 미관측 하체 세그먼트는 실패가 아니라 `profileLocked` 상태로 분리한다.
4. 앱에는 `?calibration-profile=<url>` 쿼리 파라미터와 `window.motionTrackerDebug.setDepthCalibrationReference(profile)` 디버그 API를 제공한다.

#### 3.2.4 visual 2D side-order vs depth/world consistency 충돌

**현 상태**: agreement check가 "depth front/back passed, visual torso side-order는 diagnostic"처럼 강등 중이다. 충돌 시 어느 신호를 믿을지 규칙이 없다.

**설계**:

1. 비교기에 `depthSignAgreement` 지표를 추가한다.
   - 세그먼트별 `sign(childZ - parentZ)`를 tracker vs SAM으로 비교한다.
   - 깊이차가 작은 프레임은 제외한다.
2. runtime 중재 규칙을 정의한다.
   - depth calibration ready + limb confidence >= 0.5: depth 신호 우선.
   - facing=side: side-order 자체가 정의 불가이므로 미평가.
   - facing=back: side-order 기대값 반전 후 평가.
   - 그 외: visual 우선.
3. frontBack 게이트는 "충돌 프레임 비율"이 아니라 "중재 규칙 적용 후 불일치 비율"로 재정의한다.

#### 3.2.5 tracker 프레임 부족 / SAM 프레임 매칭 부족

**설계**:

1. SAM 측 보간을 추가한다.
   - tracker의 각 timestamp에 대해 SAM 이웃 2프레임을 선형 보간한다.
   - `--interpolate offline` 옵션으로 제공하고 기본은 기존 nearest 유지.
2. 전역 시간 오프셋 자동 추정을 추가한다.
   - wrist/ankle 속도 크기 시퀀스의 상호상관으로 `--offset-ms auto` 추정.
   - 탐색 범위는 ±500ms.
3. 커버리지 지표를 추가한다.
   - `pairedRatio`, `offlineUsageRatio`, pairing gap 히스토그램.
   - `pairedRatio < 0.9`면 상태를 `degraded`로 표기.
4. `avatar-motion-agreement-check.mjs`에 `--min-recorded-frames`와 처리 fps 리포트를 추가한다.

### 3.3 매핑 / 좌표계 / 시간 / 신뢰도 보완 상세

| 축 | 현재 | 보완 설계 |
|---|---|---|
| **관절 매핑** | `MHR70_TO_MEDIAPIPE33`이 어댑터에 하드코딩. wrist는 MHR 손 관절 기반 | 신규 `src/skeleton/mhr70-mapping.js`로 추출. MHR70 70개 관절 이름 상수 테이블, 매핑 근거 주석, `mapMhr70ToMediaPipe33()` 순수 함수. body wrist 관절이 있으면 교체하고, 손 관절 사용 시 `mappingNotes`에 명시 |
| **좌표계** | `worldAxisX/Y: "native"`로 남아 있음 | 어댑터에 axis audit 내장. 중력 방향, handedness, z 부호 규약을 계산해 `source.axisAudit` + `sourceMeta.worldAxisX/Y/Z`에 기록 |
| **시간 매칭** | `timestamp_sec*1000` 사용, nearest <= 25ms | 보간, 오프셋 자동 추정, 커버리지 지표. `frame_index`만 있는 입력은 `--fps` 인자로 오버라이드 가능하게 |
| **신뢰도** | per-joint conf 사용. 2D out-of-bounds 시 2D vis만 0.05 클램프, world vis는 유지 | 2D out-of-bounds 관절은 world visibility에도 감쇠 적용. `visibility = min(per-joint conf, detector_score)`로 결합. 비교기 summary에 confidence-weighted mean/p95 병기 |

## 4. 구현 방안

### 4.1 신규 파일

| 파일 | 내용 | 근거 |
|---|---|---|
| `src/skeleton/mhr70-mapping.js` | MHR70 관절 이름 상수, `MHR70_TO_MEDIAPIPE33`, `mapMhr70ToMediaPipe33()`, 축 규약 상수 | 매핑 모듈화 |
| `src/solver/facing-estimator.js` | `estimateFacingYaw(points)`, `updateFacingState(prev, yaw, confidence, opts)` 순수 함수 + 히스테리시스 상태기계 | facing 3D화 |
| `scripts/sam-reference-labeler.mjs` | SAM recording.jsonl -> `labels.json` | 이벤트 라벨 |
| `scripts/sam-calibration-profile.mjs` | SAM recording -> 세그먼트 ratio 프로파일 JSON | calibration source |
| `tests/mhr70-mapping-check.mjs` | 매핑 대칭성/범위/이름 테이블 검증 | P1 |
| `tests/facing-estimator-check.mjs` | synthetic 회전 시퀀스에서 상태 전이/히스테리시스/저신뢰 유지 검증 | P2 |
| `tests/sam-reference-labeler-check.mjs` | synthetic SAM recording으로 facing/occlusion window 라벨 검증 | P1 |
| `tests/sam-calibration-profile-check.mjs` | synthetic recording -> ratio 산출/robust 통계 검증 | P4 |

### 4.2 기존 파일 수정

| 파일 | 수정 내용 |
|---|---|
| `scripts/hmr-jsonl-adapter.mjs` | 매핑 테이블 제거 후 `src/skeleton/mhr70-mapping.js` import. axis audit, world visibility 감쇠 옵션, confidence 결합 추가 |
| `scripts/motion-recording-compare.mjs` | `--interpolate offline`, `--offset-ms <n|auto>`, `--labels <path>`, confidence-weighted 통계, `facingAgreement`, `yawErrorDeg`, `depthSignAgreement` 추가 |
| `src/solver/pose-solver.js` | `estimateFacing()`을 facing-estimator 위임으로 교체. `state.facing` 구조 확장 + `meta.facing` 문자열 호환 유지 |
| `src/depth-calibration.js` | `applyExternalReferenceRatios(profile)`, `profileLocked`, 관측 가능 세그먼트 기준 reliable 계산 옵션 |
| `src/app.js` | calibration profile 쿼리/디버그 API, occlusion hold/decay 상태기계, facing-aware side-order/depth 중재 규칙, HUD yaw 표시 |
| `scripts/avatar-motion-agreement-check.mjs` | `--sam-labels <path>`, `--min-recorded-frames`, 처리 fps 리포트 |
| `tests/motion-recording-compare-check.mjs` | 보간, 오프셋 추정, 라벨 슬라이스, 신규 지표 케이스 추가 |
| `tests/depth-calibration-check.mjs` | 프로파일 주입, profileLocked, 관측 우선 대체 케이스 추가 |
| `tests/solver-synthetic-check.mjs`, `tests/contract-check.mjs` | facing 구조 확장, `sourceMeta` 신규 필드 계약 검증 |
| `README.md`, `docs/sam-mhr70-comparison-plan.md` | 신규 CLI 사용법, 파이프라인 다이어그램, 게이트 정의 갱신 |
| `package.json` | `sam:labels`, `sam:profile` 스크립트 추가 |

### 4.3 데이터 계약

```jsonc
// output/external/sam-3d-body/<clip>/labels.json
{
  "version": 1,
  "sourceRecording": "recording.jsonl",
  "frames": [
    {
      "index": 0,
      "timestamp": 0,
      "facingYawDeg": 3.2,
      "facingState": "front",
      "leftArm": "visible",
      "rightArm": "behind-back",
      "bodyCoverage": "full",
      "lowConf2d": true
    }
  ],
  "windows": [
    { "kind": "back-facing", "startMs": 4200, "endMs": 6800 },
    { "kind": "crossed-arms", "startMs": 9100, "endMs": 10400 }
  ]
}
```

```jsonc
// output/external/sam-3d-body/<clip>/calibration-profile.json
{
  "version": 1,
  "extractor": "sam3d-body",
  "person": 0,
  "segmentRatios": {
    "torso": { "ratio": 1.0, "cv": 0.021, "samples": 640 },
    "leftUpperLeg": { "ratio": 0.84, "cv": 0.034, "samples": 590 }
  }
}
```

## 5. 작업계획

각 단계는 독립 커밋 단위이며, 완료 시 `npm run check` 전체 통과가 공통 전제다. 단계 간 의존은 P0 -> P1 -> (P2/P3/P4) -> P5다. P2/P3/P4는 P1 완료 후 병렬 가능하다.

### P0. 비교 파이프라인 측정 신뢰성 확보

- **목표**: 낮은 tracker fps에서도 신뢰 가능한 tracker-vs-SAM 지표를 산출하고 새 기준선을 고정한다.
- **구현**:
  - `motion-recording-compare.mjs`에 보간(`--interpolate offline`) 추가.
  - 오프셋 자동 추정(`--offset-ms auto`) 추가.
  - `pairedRatio`, coverage 지표, confidence-weighted 통계 추가.
  - `tests/motion-recording-compare-check.mjs` 확장.
- **검증**:
  - 등간격 synthetic에서 보간 오차가 거의 0인지 확인.
  - 인위적 +100ms 시프트 입력에서 오프셋 추정 오차가 1 frame 이하인지 확인.
  - jujae 클립 재실행 후 `pairedRatio`와 각도 지표 재산출.
- **완료 기준**:
  - jujae 클립에서 live 기준 pairedRatio >= 0.95.
  - 신규 기준선 리포트가 `output/reports/tracker-vs-sam-jujae-v2.json`으로 산출됨.
  - 기존 옵션 무지정 시 동작 불변.
- **리스크**:
  - 보간이 SAM의 급격한 프레임 오류를 평활화해 오차를 과소평가할 수 있다. nearest/보간 두 모드 지표를 병기한다.

### P1. 매핑/좌표계 확정 + SAM 라벨러

- **목표**: MHR70 매핑과 축 규약을 검증 가능한 모듈로 만들고, 문제 구간 라벨을 자동 산출한다.
- **구현**:
  - `src/skeleton/mhr70-mapping.js` 추출.
  - 어댑터 axis audit, visibility 결합, 2D 열화 전파 옵션 추가.
  - `scripts/sam-reference-labeler.mjs` 추가.
  - `tests/mhr70-mapping-check.mjs`, `tests/sam-reference-labeler-check.mjs` 추가.
- **검증**:
  - 단위 테스트.
  - jujae 실변환 재실행(990프레임 보존, axisAudit 결과 확인).
  - `labels.json`의 back-facing/crossed-arms window를 keyframe과 육안 대조.
- **완료 기준**:
  - axis audit이 y-down, handedness, z 규약을 판정해 `sourceMeta`에 기록.
  - 라벨 window가 육안 확인과 일치.
  - 초반 열화 구간(`lowConf2d`)이 라벨로 식별됨.
- **리스크**:
  - MHR70 공식 관절 이름 확보 실패 시 이름 테이블을 "추정" 표기로 낮추고 overlay 대조로 대체한다.

### P2. Facing 3D화

- **목표**: frontBack 진단 83.3%를 개선하고, 뒤돌기 구간에서 facing 상태 일치율을 확보한다.
- **구현**:
  - `src/solver/facing-estimator.js` 추가.
  - `pose-solver.js` 통합.
  - 비교기에 `facingAgreement`, `yawErrorDeg` 추가.
  - `src/app.js` side-order 중재 규칙 추가.
  - `tests/facing-estimator-check.mjs` 추가.
- **검증**:
  - synthetic 회전 테스트.
  - jujae 재측정: back-facing window에서 facing 일치율, yaw 오차, 비 window 구간 회귀 없음 확인.
- **완료 기준**:
  - back/side window facing 일치율 >= 90%.
  - 전체 frontBack 컴포넌트가 기준선(83.3%) 대비 개선.
  - motion agreement 94.0% 이상 유지.
- **리스크**:
  - MediaPipe world 좌표의 저품질 구간에서 yaw가 튈 수 있다. confidence 게이트와 히스테리시스로 완화한다.

### P3. Occlusion hold/decay

- **목표**: occlusion window에서 팔 target 오차 스파이크(max 120도대)를 억제한다.
- **구현**:
  - `src/app.js` 또는 avatar-renderer retarget 경로에 occlusion 상태기계 추가.
  - hold -> decay -> re-acquire 정책과 각속도 상한 적용.
  - label window별 팔 target 오차 집계.
- **검증**:
  - jujae occlusion window에서 팔 target p95/max 오차 전후 비교.
  - 비 window 구간 오차와 agreement 회귀 없음 확인.
  - `npm run check`와 motion agreement 실행.
- **완료 기준**:
  - occlusion window 내 팔 target p95 오차 30% 이상 감소.
  - visual arms 진단 70.1% -> 75% 이상.
  - 전체 agreement >= 94% 유지.
- **리스크**:
  - hold가 과하면 실제 빠른 팔 동작을 뭉갤 수 있다. hold 시간과 각속도 상한을 파라미터화하고 non-occlusion 구간 지표로 부작용을 감시한다.

### P4. SAM 캘리브레이션 프로파일 주입

- **목표**: 상반신 전용/부분 관측에서 세그먼트 길이 reference를 안정화하고, reliable CV segment 실패와 length clamp를 완화한다.
- **구현**:
  - `scripts/sam-calibration-profile.mjs` 추가.
  - `depth-calibration.js` 주입 API와 `profileLocked` 추가.
  - `app.js` 쿼리/디버그 API 추가.
  - agreement check에 프로파일 전달 옵션 추가.
  - `tests/sam-calibration-profile-check.mjs`, `tests/depth-calibration-check.mjs` 확장.
- **검증**:
  - 프로파일 주입 상태로 motion agreement 재실행.
  - clamp 비율, CV segment 상태, hinge/target 오차 변화 측정.
  - 프로파일 미주입 기본 경로 회귀 없음 확인.
- **완료 기준**:
  - 프로파일 주입 실행에서 length clamp 비율 <= 20%.
  - depth calibration 게이트가 관측 가능 세그먼트 기준으로 pass.
  - 기본 경로 지표 불변.
- **리스크**:
  - SAM 본 길이 편향이 프로파일로 유입될 수 있다. CV 높은 세그먼트는 제외하고 관측 우선 대체 규칙으로 상쇄한다.

### P5. 회귀 게이트 승격 + 문서화

- **목표**: SAM 비교를 재현 가능한 회귀 oracle로 승격하고 전체 파이프라인을 문서화한다.
- **구현**:
  - 신규 기준선 수치로 게이트 정의.
  - `motion-goal-audit.mjs`/`validation-cli.mjs`에 SAM 비교 산출물 반영.
  - README와 docs 갱신.
  - `package.json` 스크립트 정리.
- **검증**:
  - 클린 체크아웃 기준 전체 재현 절차 실행.
  - `npm run check` 통과.
  - 의도적 solver 열화를 게이트가 잡는지 1회 시연.
- **완료 기준**:
  - 문서화된 명령 시퀀스만으로 동일 리포트를 재현 가능.
  - 게이트가 solver 열화를 실제로 검출.
- **리스크**:
  - SAM 특정 클립에 과적합될 수 있다. 최소 2개 클립(전신+상반신 전용)을 게이트 전제 조건으로 명시하고, 미확보 시 경고 수준으로 유지한다.

### 마일스톤 요약

| 단계 | 산출물 | 성공 지표 |
|---|---|---|
| P0 | 비교기 v2 + 신규 기준선 | pairedRatio >= 0.95 |
| P1 | 매핑 모듈 + axis audit + labels.json | 라벨-육안 일치, 축 규약 확정 |
| P2 | facing 3D화 | back/side facing 일치율 >= 90% |
| P3 | occlusion hold/decay | occlusion 구간 팔 p95 오차 -30% |
| P4 | 캘리브레이션 프로파일 | clamp <= 20%, CV 게이트 pass |
| P5 | 회귀 게이트/문서 | 재현 절차 + 게이트 시연 |

## 6. 리스크 총괄 및 열린 질문

1. **SAM 오차의 전이**: SAM도 단안 모델이므로 "SAM 기준 개선"이 실제 개선과 어긋날 수 있다. 각도 오차 절대값보다 회귀 방향성과 구간별 상대 개선을 게이트로 삼고, 육안 keyframe 대조를 각 단계 검증에 포함한다.
2. **MHR70 관절 정의 불확실성**: `metadata_mhr70.json`이 있으면 이름 테이블 신뢰도가 올라간다. 사용자에게 원본 zip의 metadata 파일 제공을 요청할 수 있다.
3. **headless CPU fps 한계**: 보간으로 비교 유효성은 확보되지만, occlusion 상태기계 같은 시간 의존 로직 검증에는 실기기/GPU 실행 재측정이 병행되어야 한다.
4. **단일 클립 의존**: 현재 jujae 1개 클립뿐이다. P3/P4 검증에는 해당 시나리오가 풍부한 클립의 SAM 추출이 추가로 필요하다.

## 부록 A. 재현 명령 시퀀스

```bash
# 1. SAM MHR70 -> recording 변환
npm run hmr:jsonl -- --input output/external/sam-3d-body/<clip>/skeletons_mhr70.jsonl \
  --joint-format mhr70 --output output/external/sam-3d-body/<clip>/recording.jsonl

# 2. 라벨 생성
npm run sam:labels -- --input output/external/sam-3d-body/<clip>/recording.jsonl \
  --output output/external/sam-3d-body/<clip>/labels.json

# 3. 캘리브레이션 프로파일
npm run sam:profile -- --input output/external/sam-3d-body/<clip>/recording.jsonl \
  --output output/external/sam-3d-body/<clip>/calibration-profile.json

# 4. tracker recording 채취
node scripts/avatar-motion-agreement-check.mjs --video <clip>.mp4 \
  --recording-output output/reports/<clip>-tracker-recording.jsonl \
  --sam-labels output/external/sam-3d-body/<clip>/labels.json

# 5. 비교
npm run compare:recordings -- \
  --live output/reports/<clip>-tracker-recording.jsonl \
  --offline output/external/sam-3d-body/<clip>/recording.jsonl \
  --timestamp-source sourceMeta.videoTime --interpolate offline --offset-ms auto \
  --labels output/external/sam-3d-body/<clip>/labels.json \
  --output output/reports/tracker-vs-sam-<clip>.json --html output/reports/tracker-vs-sam-<clip>.html
```

## 부록 B. 현재 기준선 수치

2026-07-02 산출물, 개선 전:

| 지표 | 값 | 출처 |
|---|---|---|
| Target 각도 오차 mean / p95 / max | 13.9도 / 35.4도 / 120.1도 (RightForeArm) | `tracker-vs-sam-jujae.json` |
| Hinge flex 오차 mean / p95 | 17.9도 / 43.5도 | `tracker-vs-sam-jujae.json` |
| Paired frames / live / offline | 86 / 123 / 990 | `tracker-vs-sam-jujae.json` |
| Motion agreement | 94.0% (< 95% 실패) | `avatar-motion-jujae-regression-xbot-sam-recording.json` |
| frontBack 컴포넌트 | 83.3% (< 90% 경고) | `avatar-motion-jujae-regression-xbot-sam-recording.json` |
| Visual arms 진단 | 70.1% (< 75% 경고) | `avatar-motion-jujae-regression-xbot-sam-recording.json` |
| Length solver clamp | 51.2% | `avatar-motion-jujae-regression-xbot-sam-recording.json` |
| Reliable CV segments | 1 (< 4 실패) | `avatar-motion-jujae-regression-xbot-sam-recording.json` |
| SAM 2D out-of-bounds 프레임 | 212 / 990 (초반 약 0.5초 집중) | Claude Code 분석 |
| SAM world 축 실측 | y-down 100%, nose z<0 81.3% | Claude Code 분석 |

## 결론

이 설계는 P0(비교기 신뢰성)부터 착수하는 것을 전제로 한다. P0 없이 P2~P4를 먼저 진행하면 개선 효과를 측정할 수단이 불안정해진다. 가장 중요한 순서 제약은 **측정 파이프라인 신뢰성 확보 -> 라벨/축/매핑 확정 -> solver/calibration 개선 -> 회귀 게이트 승격**이다.
