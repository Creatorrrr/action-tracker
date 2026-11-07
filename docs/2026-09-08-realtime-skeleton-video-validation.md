# 원본 영상 연결 후 검증과 다음 구현 순서

2026-09-08. 이 문서는 [초기 분석·설계](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-avatar-analysis-plan.md)와 [R1 구현 기록](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-implementation.md)의 후속이다.

2026-09-12 추가 결과: [손바닥·부위별 개선 실험](/Users/chasoik/Projects/action-tracker/docs/2026-09-12-palm-regional-improvements.md). 좌우 손 관측 837개를 원래 PTS에서 평가하고 3개 rig의 실제 손바닥을 측정했다. 부위별 보정은 다른 영상·endpoint의 회귀 또는 시각 실패로 기본 적용하지 않았다.

## 판단

**실제 영상에 연결해 보니 좌표계 정리만으로 목표를 달성하지 못했다. 공통 3D 후보의 기본값 승격과 Heavy 모델 교체를 채택하지 않았다.** 일부 방향 오차가 개선되지만 실제 손·발·머리 위치의 회귀가 남는다. 원본 관측 보존과 동일 시각 SAM 비교는 구현·검증했고, 느린 추론 때문에 영상 자체를 멈추지 않는 실시간 평가 모드를 추가했다.

## 입력과 비교 범위

- 사용자가 제공한 [assets/videos](/Users/chasoik/Projects/action-tracker/assets/videos)의 7개 원본 모두 기존 inventory의 파일 크기와 SHA-256에 일치했다. [확인 결과](/Users/chasoik/Projects/action-tracker/output/reports/r1-20260908/video-recovery.json).
- 먼저 development 4개 `dance`, `keGb`, `new-dance`, `vc0G`를 사용했다. `arms-crossed`, `csi-pose`, `jujae`는 원본 해시만 확인했으며 이번 후보 선택의 detector 비교에 사용하지 않았다. 과거에 이미 사용한 자료이므로 이를 새로운 미사용 holdout이라고 부르지는 않는다.
- 실행 환경은 Apple M1 Max, RAM 32 GiB, headed Chrome, Pose GPU / Hand CPU, Body·Hand worker, Face off, rVFC다. 성능 결과는 이 장비·설정의 파일 입력 결과다.
- 첫 legacy 실행에서 보조 채널 병합이 새 MotionFrame을 만들며 `rawPoseObservation`을 버리는 연결 오류를 발견했다. `applyDetectionFrameResult`에서 Body 원본을 병합 후 보존하도록 수정했다. 첫 `new-dance-full-raw.jsonl`은 raw가 없는 진단 실행으로 보존했고 비교에서 제외했다.

Full 기준선의 유효 raw 관측은 1,775프레임이다. 1,771프레임을 decoder PTS와 정확히 대응시켰다.

| 영상 | SAM decoder 행 | Full 관측 | 정확히 대응한 행 | decoder 대비 대응률 |
|---|---:|---:|---:|---:|
| new-dance | 439 | 422 | 421 | 95.90% |
| dance | 359 | 357 | 356 | 99.16% |
| keGb | 1,237 | 545 | 544 | 43.98% |
| vc0G | 451 | 451 | 450 | 99.78% |

keGb의 원본은 60fps이고 제품 Body admission은 최대 30Hz다. 이 비율은 검출 정확도 점수가 아니다. 의도적 cadence 제한, callback 누락, deadline drop을 별도로 조사해야 한다. 점수가 좋은 검출 프레임만으로 전체 시간축의 품질을 주장하지 않는다.

## 정확한 대응과 지표

[sam-replay-corpus.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-replay-corpus.mjs)가 raw JSONL과 SAM 원본, decoder manifest를 연결한다. `ptsTicks × timeBase`를 정수 마이크로초로 반올림한 값과 rVFC `mediaTime`을 같은 정밀도로 비교한다. 가장 가까운 프레임 찾기, 영상별 시차 최적화, teacher에 맞춘 PTS 이동을 사용하지 않는다. 시작/seek의 `currentTime` fallback은 replay 상태에는 포함하되 정확한 관측 쌍에서 제외한다. 중복·역행 PTS, raw 없는 녹화는 거부한다.

[sam-paired-renderer-probe.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-paired-renderer-probe.mjs)는 같은 detector 관측에 대해 다음을 실행한다.

1. 기존 hybrid + 기존 flex 보정.
2. image x를 영상 높이 단위로 환산한 aspect 진단. 이 진단은 2D root 입력도 바꾸므로 제품용 aspect 수정으로 채택한 구현은 아니다.
3. 보정 전 world xyz를 한 좌표계로 변환한 `canonical-world`.

SAM reference는 독립 renderer에 전체 decoder cadence로 재생한다. Xbot, Soldier, Polydancer에서 모두 기존 strict retarget과 retarget smoothing을 사용한다.

지표는 구분해서 해석한다.

- **SAM 방향 오차:** SAM canonical 관절 방향과 실제 적용된 bone world 회전의 rest aim 축 간 각도. 같은 입력을 같은 함수로 채점하는 자기 일치도와 다르다.
- **SAM 구동 아바타와의 FK 차이:** 같은 rig에서 실제 손목·발목·머리 bone 위치를 비교한다. 아바타 키로 정규화한 model-local, world 위치를 함께 남긴다.
- **local quaternion 차이:** quaternion 부호에 불변인 회전 거리를 수집한다. SAM 관절을 기존 retarget으로 변환한 아바타와의 차이이며, SAM에서 측정된 완전한 bone rotation 정답이 아니다.
- **SAM 직접 입력 잔차:** reference renderer도 가진 cap, contact, head prior 손실을 별도 보고한다. reference가 완전하다는 가정으로 이를 숨기지 않는다.

12개 영상/rig 조합에서 총 23,433회 실제 renderer 적용, 후보의 15,939개 대응 frame/mode/rig 상태를 확인했다. 모든 상태에서 유한한 bone quaternion과 5개 FK endpoint를 수집했다. 이 숫자는 정확도 목표 통과를 뜻하지 않는다. 원본 기준선과 frame별 실제 적용 상태는 `output/reports/r1-20260908/*-replay.json`에 있다. [평가 소스 해시](/Users/chasoik/Projects/action-tracker/output/reports/r1-20260908/e1-source-hashes.json)와 소스 복사본도 보존했다.

## E1: 공통 3D의 효과와 회귀

2026-09-12에 같은 프레임 기록을 [부위별로 재집계했다](/Users/chasoik/Projects/action-tracker/docs/2026-09-12-body-region-accuracy.md). 상체·하체, 몸통·머리·좌우 팔다리의 분포와 ‘상체 이내·하체 초과’ 프레임을 확인할 수 있다. 새 추론을 실행한 결과는 아니며 아래 후보 채택 판단은 유지한다.

Xbot의 손·발·머리 위치 P95를 아래에 정리했다. 수치는 아바타 키에 대한 비율이며, 작을수록 SAM 구동 아바타에 가깝다. 예를 들어 0.20은 아바타 키의 20% 위치 차이다.

| 영상 | 왼손 기존 → 3D | 오른손 기존 → 3D | 왼발 기존 → 3D | 오른발 기존 → 3D | 머리 기존 → 3D |
|---|---:|---:|---:|---:|---:|
| new-dance | .3242 → .2881 | .2478 → .2421 | .2054 → .2715 | .1823 → .1936 | .0569 → .0873 |
| dance | .2126 → .2441 | .2408 → .3023 | .2518 → .2099 | .2639 → .2441 | .1073 → .1464 |
| keGb | .1505 → .1117 | .1844 → .1442 | .1981 → .1642 | .1026 → .1187 | .0852 → .0721 |
| vc0G | .2568 → .2669 | .1676 → .1457 | .1510 → .1490 | .2001 → .1947 | .0646 → .0540 |

new-dance의 왼발 P95는 약 32%, 머리는 약 53% 악화됐다. dance는 양손과 머리가 악화됐다. Soldier·Polydancer에서도 같은 종류의 회귀가 확인됐다. 평균 방향 개선만으로 기존 계획의 “endpoint를 희생하지 않는다” 조건을 통과시킬 수 없다.

원본 추출에서도 큰 오차가 남는다. new-dance의 raw Full 아래팔 방향 P95는 왼쪽 77.11°, 오른쪽 90.46°다. vc0G 왼쪽은 103.74°다. 좌표 변환을 정확히 해도 잘못 관측한 3D를 정확한 자세로 바꾸지는 못한다. 일부 구간은 2D 방향 오차도 크므로 깊이 보정만의 문제로 단정할 수 없다.

**결정:** 공통 3D 표현은 비교·개선 기반으로 유지하되, 제품 기본값을 승격하지 않는다. 기존 default는 `legacy-hybrid`다. clip별 상수나 영상 이름으로 경로를 선택하는 보정도 추가하지 않는다.

## E2: Heavy 교체의 판별 결과

[sam-model-comparison.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-model-comparison.mjs)에서 Full과 Heavy 모두가 실제 관측한 동일 PTS의 교집합만 비교했다. 교집합은 new-dance 404, dance 356, keGb 271, vc0G 437프레임이다. 다른 시각·다른 누락률을 모델 정확도 개선으로 오인하지 않도록 각 모델의 decoder coverage도 함께 기록했다.

| 동일 프레임의 raw 방향 P95 | Full | Heavy |
|---|---:|---:|
| new-dance 오른쪽 위팔 | 66.41° | 99.44° |
| dance 왼쪽 아래팔 | 55.41° | 71.83° |
| keGb 왼쪽 아래팔 | 29.26° | 55.28° |
| vc0G 왼쪽 아래팔 | 100.08° | 96.39° |

일부 관절은 개선되지만 전반적 대체를 정당화하지 못했다. Heavy의 첫 두 영상 Body 추론 P95는 약 38~41ms였다. 기존 adaptive playback에서 얻은 처리 프레임 수로 30Hz 실시간 달성을 주장하지 않는다.

**결정:** Heavy를 기본 모델로 바꾸지 않는다. 기존 Full을 유지하고 입력 정보와 retarget 손실을 먼저 줄인다. 이 비교는 raw 관측 판별이며 Heavy의 3개 rig FK 개선을 입증한 실험이 아니다.

## 관측 신선도와 입력 축소

Full 기준선에서 양손 world 배열이 존재하는 것과 새 손 관측이 존재하는 것은 달랐다. `new-dance`의 422프레임 중 prediction이 아니고 관측 나이가 100ms 이하인 프레임은 왼손 225개, 오른손 204개다. 관측 age P95는 양손 약 400ms였다. 다른 영상의 P95는 약 700~1,033ms까지 올라갔다. pose-guided prediction과 cached-after-miss가 손 배열을 채우므로 배열 유무를 fresh coverage로 사용할 수 없다.

현재 Body/Hand 공용 snapshot은 전체 영상을 최대 640px로 먼저 줄인다. 3414×1920 패딩 입력은 640×360이 되고, 이후 손 ROI는 이미 축소된 bitmap에서 잘린다. 작은 손의 픽셀 정보가 upstream에서 손실될 수 있다. 이는 코드에서 확인한 구조적 가능성이며, 1280px 실험의 결과와 구별한다.

## 실시간 모드와 해상도 실험

`?video-timing=realtime`에서는 Body backlog가 생겨도 파일의 재생 clock을 멈추지 않는다. 기존 latest-frame queue와 deadline drop은 유지한다. 시작·seek에서 정확한 입력 generation을 만드는 gate는 별도이며 유지한다. 기존 파일 재생 동작은 `adaptive-playback`이고 default를 유지했다.

첫 Full/canonical 실시간 연결 검증에서는 raw와 canonical이 보존된 439프레임을 수집했고, backlog에 의한 pause/hysteresis/hold는 모두 0이었다. Body 추론 P95는 20.1ms였다. 이 실행만으로 카메라·전체 동작 정확도·10분 안정성을 통과했다고 보지 않는다.

`?input-max-dimension=1280`으로 Body/Hand snapshot 상한을 바꾸는 실험 설정도 추가했다. 기본은 640이며 Face snapshot은 별도다. 640/1280 비교에서는 Full/canonical, 실제 시간 재생, 같은 4개 개발 영상을 고정했다. 손 detector 모델이나 wrist 소유권은 바꾸지 않았다.

### 640 / 1280 결과

각 영상의 동일 관측 PTS 교집합은 436 / 358 / 618 / 450프레임이다. raw 3D 아래팔 방향 P95는 다음과 같다.

| 영상 | 왼쪽 640 → 1280 | 오른쪽 640 → 1280 |
|---|---:|---:|
| new-dance | 81.77° → 77.74° | 91.98° → 101.61° |
| dance | 56.21° → 56.60° | 67.74° → 63.71° |
| keGb | 35.26° → 30.41° | 37.18° → 33.76° |
| vc0G | 100.89° → 90.70° | 48.34° → 51.10° |

Body 정확도는 일관되게 좋아지지 않았다. 반면 손의 신선도에는 유용한 변화가 있었다. keGb에서 100ms 이내이고 prediction이 아닌 왼손 관측은 **229/619 → 394/619**, 오른손은 **273/619 → 396/619**로 늘었다. 이는 원본 픽셀을 보존하는 손 ROI 실험의 근거다. 손 자세가 SAM에 더 정확히 일치한다는 증거는 아직 아니다. vc0G에서는 관측 age P95가 약 900~933ms로 여전히 나빴다.

**결정:** 전체 Body/Hand 입력 상한을 일괄 1280으로 승격하지 않는다. Body의 큰 오차가 남고 계산량이 늘며, 후보의 3-rig FK 우위를 입증한 것도 아니다. 손 채널에는 원본에서 직접 잘라낸 ROI와 실제 wrist 소유권을 별도로 검증할 가치가 있다.

### 실제 시간 처리 결과

아래 Hz는 첫/마지막 정확한 rVFC 관측 사이의 callback wall time에서 계산한 적용 관측 간격의 비율이다. rendering FPS나 모든 decoder frame의 검출률이 아니다. 지연은 **수락된 rVFC callback receive → 실제 avatar state apply**이며 카메라 노출부터 화면 표시까지의 지연, smoothing으로 인한 동작 위상 지연을 포함하지 않는다.

| 영상 | 적용 Hz 640 / 1280 | Body 추론 P95 ms 640 / 1280 | receive→apply P95 ms 640 / 1280 |
|---|---:|---:|---:|
| new-dance | 29.84 / 30.01 | 22.8 / 21.1 | 25.1 / 22.5 |
| dance | 23.93 / 23.92 | 24.2 / 30.7 | 25.1 / 31.7 |
| keGb | 30.01 / 30.00 | 20.0 / 31.1 | 21.2 / 33.2 |
| vc0G | 30.00 / 29.98 | 19.7 / 29.3 | 20.8 / 30.6 |

dance 원본은 약 23.92fps이고 keGb는 60fps에서 Body admission을 30Hz로 제한한다. 측정 구간의 wall/source 시간 비율은 0.9996~1.0009였다. **8개 실행 모두 backlog pause와 hold가 0**이고 raw/canonical payload 보존을 모든 프레임에서 확인했다. 640 new-dance에는 overload drop 1건과 post-inference deadline drop 1건이 있었고 다른 7개 실행에는 없었다. 지연은 수락된 frame에 대한 값이므로 drop 및 decoder coverage와 함께 해석한다.

이 결과는 M1 Max의 Xbot, Face off, 파일 입력 조건에서의 Body 처리율 검증이다. 손 age·실제 동작 오차, 다른 rig의 실시간 GPU 부하, 카메라, 10분 soak는 여전히 남아 있다.

### 검증 산출물

- [전체 비교 수치·설정·해시 JSON](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-video-validation.json): E1 12조합, Full/Heavy, 640/1280, 실제 시간 telemetry.
- [집계 스크립트](/Users/chasoik/Projects/action-tracker/output/reports/r1-20260908/summarize.mjs)와 [검사 로그](/Users/chasoik/Projects/action-tracker/output/reports/r1-20260908/final-check.log).
- 최종 `npm run check`의 33개 검사와 anatomical precheck 통과. 추가 CLI/module 문법 검사 및 `git diff --check` 통과. 원본 영상과 기존 untracked 작업은 보존했고 커밋·푸시는 하지 않았다.

## 다음 작업의 순서와 완료 기준

1. **입력 정보 보존:** 해상도 비교를 마친 뒤, 필요하면 같은 PTS의 원본 bitmap에서 Body/Hand ROI를 잘라내는 경로를 실험한다. resize 이전 crop과 source affine를 보존하며, 이전 프레임 ROI를 쓸 때에는 인과적 예측·확장·재탐색을 명시한다. full-resolution bitmap의 수명·queue를 제한하고 Body 결과를 기다리는 동안 live video의 다른 프레임을 손 입력으로 읽지 않는다.
2. **retarget 자체 손실:** 정답 관측을 넣었을 때 남는 목/머리 rest 축·분배, root와 순차 foot contact 보정을 독립적으로 수정한다. 실제 bone local quaternion, world/model-local FK, root 회전·이동을 함께 보고, frame/side별 회귀가 있으면 채택하지 않는다.
3. **손목 소유권:** body·root를 고정한 replay에서 Hand21 MCP basis와 신선도에 따른 wrist 소유권을 실험한다. 기존 Pose33 fingertip/MCP 의미 차이를 먼저 처리한다. age가 큰 prediction을 정답 손 관측으로 취급하지 않는다.
4. **남은 추출 오차:** 위 구조를 고정한 뒤 Full raw의 confidence·2D/3D·속도를 쓰는 작은 causal residual을 영상 단위 교차 검증한다. teacher는 offline supervision에만 쓰며 clip ID, 절대 재생 시각, 미래 관측, SAM lookup을 live 입력에 넣지 않는다. 관측만으로 구별할 수 없는 사례는 RGB crop 정보가 필요한지 별도로 판별한다.
5. **최종 승격:** 설정을 고정하고 7개 영상×3개 rig의 정확도·회귀와 실제 시간 입력, 카메라, 10분 soak를 확인한다. 후보 코드·unit 검사 성공과 이 제품 목표를 구분한다.

## 재현

```sh
node scripts/avatar-motion-agreement-check.mjs \
  --video assets/videos/shorts-new-dance-E9_h_ZW5z0U-16x9-padded.mp4 \
  --model 'Xbot=assets/models/Xbot.glb' --only-models \
  --pose-model full --skeleton-mode canonical-world \
  --video-timing realtime --input-max-dimension 640 \
  --delegate gpu --browser-mode headful --pump rvfc \
  --tracking-worker on --face-tracking off \
  --warmup-pose-frames 0 --min-pose-frames 1000000000 \
  --measurement-only --timeout-ms 120000 \
  --recording-output output/reports/example-raw.jsonl \
  --output output/reports/example-live.json

node scripts/sam-replay-corpus.mjs \
  shorts-new-dance-E9_h_ZW5z0U-16x9-padded \
  output/reports/example-raw.jsonl output/reports/example
```

replay probe는 앱 import map이 있는 브라우저에서 corpus JSON을 fetch해 `probePairedRenderer({ corpus, modelUrl })`로 실행한다. 실행 시간은 accelerated replay의 정확도 비교에만 사용하며 realtime FPS로 집계하지 않는다. 영상별 원본 hash, capture profile, exact pairing coverage, 실제 적용 상태를 함께 보관한다.
