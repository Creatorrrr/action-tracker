# 손바닥·부위별 정확도 측정과 개선 실험

2026-09-12. 요청대로 SAM 스켈레톤을 기준 정답으로 두고 측정했다.

**좌우 손바닥까지 나눈 측정과 실제 아바타 비교를 구현했다. 부위별 보정도 구현·실험했지만, 다른 영상·관절·손발 위치 또는 화면 동작까지 함께 좋아지는 후보는 확보하지 못했다. 따라서 움직임 보정 후보는 제품 기본값으로 채택하지 않았다. 각 부위의 정확도 개선 목표는 아직 미완료다.**

현재 적용한 것은 관측 시각·손바닥·실제 bone 상태를 더 정확히 기록하고 비교하는 기능이다. 실험 코드는 명시적으로 켜는 옵션으로 남겼다. 현재 제품 기본 경로를 다시 재생해 기존 동작 보존을 별도로 확인했다.

- [전체 부위·rig·실험 결과](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/parts-final.md), [JSON](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/parts-final.json), [CSV](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/parts-final.csv)
- [동일 시각 비교 화면](http://127.0.0.1:55357/output/reports/r2-20260912/visual-review.html): 원본 / SAM 구동 아바타 / 기존 관측 구동 / 선택한 실험. 로컬 서버가 실행 중일 때 사용할 수 있다.
- [앞선 근본 원인 분석·전체 설계](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-avatar-analysis-plan.md), [원본 영상 검증](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-video-validation.md), [손바닥 추가 전 부위별 결과](/Users/chasoik/Projects/action-tracker/docs/2026-09-12-body-region-accuracy.md)

## 1. 손바닥을 어떻게 나눠 측정했는가

인물의 해부학적 왼손·오른손을 별도로 평가한다. 손목과 검지·중지·소지 MCP, 즉 손가락 뿌리의 네 관절을 사용한다. 손가락 끝이나 중간 마디를 사용하지 않아 손가락을 구부린 것과 손바닥을 돌린 것을 구별한다. Hand Landmarker의 21개 image/world 관측과 handedness 출력은 [공식 설명](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)에 따른다. SAM 관측은 저장된 MHR70에서 기존 Hand21 매핑을 사용했다. [SAM 공식 저장소](https://github.com/facebookresearch/sam-3d-body).

| 측정값 | 정의 | 기준 |
|---|---|---|
| 주축 오차 | 손목→중지 MCP 방향의 각도 차이 | SAM Hand21 직접 비교 |
| 법선 오차 | 손목·검지·소지가 만드는 손바닥 면의 방향 차이 | SAM Hand21 직접 비교 |
| 전체 회전 오차 | 직교한 손바닥 세 축 사이의 SO(3) 회전각 | SAM Hand21 직접 비교 |
| 중심 위치 오차 | 네 관절 평균 위치의 거리 / 고정된 rig 키 | 같은 rig의 SAM 구동 아바타 |
| 손목 local 회전 차이 | 실제 적용 Hand bone quaternion의 차이 | 같은 rig의 SAM 구동 아바타 |

법선 부호와 좌우·mirror 변환을 유지하므로 손바닥 앞뒤가 180° 뒤집힌 경우도 큰 오차로 남는다. 네 점이 누락되거나 거의 일직선이면 측정 불가로 기록한다. 누락을 0°로 채우지 않는다. 중심 위치는 model-local과 world를 별도로 남긴다.

아바타의 손바닥은 solver가 의도한 목표 회전이 아니라 **최종 적용된 Hand, HandIndex1, HandMiddle1, HandPinky1 bone의 실제 world 위치**에서 다시 계산한다. 따라서 부모 팔 회전, 손목 필터, rig의 기준 축이 실제 결과에 미친 영향을 포함한다. 손가락 각 마디의 굽힘 정확도는 별도 과제다.

v2에서는 팔의 local 회전 집계에서 Hand bone을 빼고 좌우 손바닥으로 옮겼다. 팔의 방향·손목 위치 지표는 그대로다. 상체·하체 요약과 손바닥을 중복 합산하지 않으며, 하나의 전신 정확도 퍼센트로 압축하지 않는다.

## 2. 손 추출 시각과 전달 지연을 분리했다

Body가 사용하는 손 결과는 이전 시각에 추출된 결과일 수 있다. 이를 현재 Body 시각의 SAM과만 비교하면 검출 오차와 전달 지연이 섞인다. 다음 세 측정을 분리했다.

1. **손 관측 자체:** 저장된 `handLeft/RightObservedSourcePtsSec`를 원래 rVFC 입력 기록과 대조하고, 그 정확한 시각의 SAM과 비교한다. 같은 손 관측이 여러 Body 프레임에 전달돼도 한 번만 센다.
2. **Body에 전달된 관측:** Body의 PTS에서 보유 중인 손 결과를 평가하고 age, 100ms 이내 관측, 예측 여부를 함께 기록한다. 이것은 전달된 상태의 품질이다.
3. **실제 아바타:** Body 적용 PTS에서 최종 bone을 읽어 SAM과 비교한다. 필터와 retarget까지 포함한 사용자에게 보이는 결과다.

decoder의 유리수 PTS와 rVFC 시각을 정수 마이크로초로 비교한다. 가까운 프레임 선택, 최적 지연 탐색, 현재 재생 시각 fallback은 정확도 표본으로 사용하지 않는다. 비교 화면에서 사용자가 입력한 시각을 가까운 *기존 정확 대응 쌍*으로 이동시키는 것은 화면 탐색 기능이며, 정답과 추론의 시간 차이를 맞추는 평가 보정이 아니다.

기존 Body 전달 로그에서 고유 손 관측 843개를 복구했고 **837개를 원래 관측 시각에서 정확히 평가**했다. 3개는 rVFC 원본 시각을 확인할 수 없었고, 3개는 유효한 손바닥 면을 구성할 수 없었다. 동일 시각의 서로 다른 손 관측 충돌은 없었다. Body에 한 번도 전달되지 않은 손 결과는 기존 로그에 없으므로, 837/843을 전체 손 검출 성공률이라고 부르지 않는다.

| 영상 | 왼손 측정/복구 | 왼손 법선 P95 | 왼손 전체 회전 P95 | 오른손 측정/복구 | 오른손 법선 P95 | 오른손 전체 회전 P95 |
|---|---:|---:|---:|---:|---:|---:|
| new-dance | 133/135 | 157.8° | 174.4° | 135/136 | 155.0° | 162.8° |
| dance | 58/58 | 152.5° | 175.5° | 77/79 | 146.8° | 169.1° |
| keGb | 135/135 | 156.9° | 162.4° | 167/167 | 120.0° | 139.0° |
| vc0G | 84/84 | 154.5° | 170.5° | 48/49 | 144.6° | 155.5° |

이 결과는 **전달 지연을 제거해도 현재 기록된 Hand21의 오차가 크다**는 뜻이다. 21점을 제공한다는 이유만으로 손목의 제어권을 Hand21에 넘기는 것은 근거가 부족하다. 원본 손 픽셀 해상도, 가림·교차 시 손 식별, 좌표 변환을 각각 확인해야 한다. 이번 수치만으로 그중 하나를 단독 원인으로 확정하지 않았다.

Body에 전달된 시각의 관측 age P95는 좌우·영상별 333.3~466.7ms였다. 원래 손 관측이 처음 Body에 전달되기까지의 age P95도 83.6~125.4ms였다. 정확한 같은 Body/Hand PTS 관측이 0개였지만, 위와 같이 **손의 원래 PTS를 복구하면 손 추출 자체의 정확도는 따로 측정할 수 있었다.**

## 3. 현재 실제 아바타의 부위별 오차

4개 development 영상의 Body 원시 프레임 1,775개 중 정확한 관측 대응은 1,771개다. Xbot·Soldier·Polydancer를 각각 적용하면 한 경로당 5,313개 실제 상태다. keGb는 원본 60fps와 Body 30Hz 상한의 차이가 있어 원본 프레임 대비 대응률을 검출 성공률로 해석하지 않는다.

아래는 Xbot 기본 경로의 P95다. 각도는 작을수록 좋다. 부위 내 고유 관절×프레임 원시 표본에서 계산했고, 부위별 P95를 평균내지 않았다. 다른 rig와 프레임 내 최악 관절의 P95, 누락·coverage는 전체 보고서에 있다.

| 영상 | 몸통 방향 | 머리·목 방향 prior | 왼팔 방향 | 오른팔 방향 | 왼다리 방향 | 오른다리 방향 |
|---|---:|---:|---:|---:|---:|---:|
| new-dance | 18.6° | 21.9° | 73.4° | 83.3° | 51.3° | 32.5° |
| dance | 22.7° | 26.3° | 55.7° | 62.8° | 48.0° | 47.0° |
| keGb | 19.3° | 37.3° | 41.5° | 42.7° | 48.5° | 33.6° |
| vc0G | 13.6° | 15.4° | 76.2° | 42.3° | 20.7° | 23.9° |

| 영상 | 왼손바닥 법선 | 왼손바닥 전체 회전 | 왼손바닥 중심 | 오른손바닥 법선 | 오른손바닥 전체 회전 | 오른손바닥 중심 |
|---|---:|---:|---:|---:|---:|---:|
| new-dance | 87.8° | 136.1° | 34.4%H | 142.0° | 160.6° | 29.1%H |
| dance | 93.7° | 112.1° | 23.1%H | 86.0° | 114.2° | 24.8%H |
| keGb | 82.1° | 84.6° | 16.3%H | 76.0° | 84.1° | 20.6%H |
| vc0G | 82.0° | 115.4° | 29.8%H | 65.7° | 74.8° | 17.4%H |

법선이 비교적 맞아도 손가락 쪽을 향하는 주축이 틀릴 수 있으므로 전체 회전도 함께 봐야 한다. 손바닥 중심 위치가 어긋나는 원인은 손목만이 아니라 어깨·팔꿈치·root까지 포함한다. 한 부위의 각도를 줄였다는 이유로 손·발 위치가 더 나빠지는 변경을 채택할 수 없다.

머리·목 방향은 희소 얼굴/몸 관절로 만든 prior다. 몸통도 하나의 hip-mid→shoulder-mid 축이므로 척추의 굽힘·비틀림 전체가 정확하다는 뜻은 아니다. 골반의 실제 local 회전은 별도 지표로 기록한다.

## 4. 구현해 비교한 보정과 채택 판단

모든 replay 후보는 동일한 원시 관측을 처음부터 순서대로 소비했다. SAM은 독립적으로 고정한 기존 renderer에서 전체 decoder cadence로 재생했다. 후보가 자신의 정답 renderer를 함께 바꿔 차이를 줄이지 않도록 분리했다. 후보에는 SAM 값, clip ID, 절대 재생 시각을 이용한 보정 규칙, 미래 관측을 넣지 않았다.

### 손바닥

- **raw Pose 관측으로 basis 재구성:** 기존 adapter가 손목과 원위 손 관절들을 동일하게 평행 이동하므로 손바닥 basis가 변하지 않았다. 처음 의심했던 ‘손목만 이동해 손바닥 축이 왜곡됨’은 이 경로에서는 반증됐다.
- **현재 Pose와 일치하는 fresh Hand21 결합:** 100ms 이내 관측이면서 두 축이 모두 45° 이내일 때만 결합했다. 큰 Hand21 오차를 무조건 적용하지 않지만, P95의 유의미한 일관 개선을 얻지 못했다.
- **손바닥 재관측 허용:** 기존 저신뢰도 innovation gate가 정지시킨 출력과 새 관측의 차이를 계속 검사하면 새 자세를 붙잡아 둘 수 있다. 연속된 실제 관측끼리 속도를 계산하고 독립적인 quaternion jump/rate 제한을 유지하는 후보를 구현했다. new-dance 왼손 전체 회전 P95는 **136.1→125.7°**, 오른손은 **160.6→154.7°**로 줄었지만 dance 왼손은 **112.1→115.1°**, keGb 오른손은 **84.1→90.2°**로 악화됐다.
- **연속 180ms 관측 확인 후 재획득:** 위 위험을 줄이는 별도 후보도 구현했다. 해당 4개 영상에서 P95 개선을 확보하지 못했다.

**판단:** 손바닥 관측과 제어권을 연결할 기반은 만들었지만 기본 활성화하지 않았다. 관측 품질·손 식별·stale 구간을 해결하지 않은 채 hold를 완화하는 것만으로는 충분하지 않았다. [손바닥·부위 단독 실험 전체](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/third-regions.md).

### 좌우 팔·다리와 몸통

기존 retarget 입력에서 해당 부위의 방향만 원시 canonical 3D 방향으로 교체하는 실험을 했다. 나머지 solver·root·contact는 유지했다. 기존 방향과 100° 넘게 충돌하는 관측은 기존 경로를 유지하는 인과적 제한을 두었다.

| 단독 보정 | 좋아진 예 | 악화되거나 충돌한 예 | 판단 |
|---|---|---|---|
| 팔 방향 | keGb 오른팔 방향 42.7→30.0°, 손목 위치 18.4→16.0%H | dance 오른팔 방향 62.8→67.7°, 손목 위치 24.1→26.6%H | 비채택 |
| 다리 방향 | dance 왼다리 방향 48.0→31.6°, 발목 위치 25.2→19.9%H | new-dance 왼다리 방향은 51.3→47.6°이나 발목 위치는 20.5→25.7%H | 비채택 |
| 몸통 방향 | new-dance 18.6→16.4°, keGb 19.3→13.8° | dance 22.7→27.7° | 비채택 |

이 결과는 입력 방향과 실제 관절 사슬의 위치를 함께 풀어야 한다는 근거다. 팔의 경우 상완·전완을 따로 맞추는 비용함수만으로 손목 위치를 보장할 수 없다. 다리는 골반·다리 방향을 적용한 뒤 root/contact가 다시 위치를 바꾸는 순서의 영향도 포함한다. 이번 실험으로 contact를 단독 원인으로 확정하거나 접지 개선을 입증한 것은 아니다.

### 머리·목

원시 머리 prior에 Head 또는 Head+Neck 방향을 맞추는 후보, `HeadTop_End` marker에 맞추는 후보, bind pose의 모델 +Y 축을 운반하는 후보를 비교했다. 머리 방향 수치가 크게 줄어도 기존 SAM 구동 아바타의 local 회전 차이는 커졌으며, 실제 화면에서는 **Polydancer의 얼굴이 아래로 숙여지는 실패**를 확인했다.

예를 들어 marker 후보의 new-dance / Polydancer marker 방향 P95는 62.6→17.7°로 줄었다. 그러나 이 숫자는 해당 marker와 희소 prior가 가까워졌다는 뜻이고, 얼굴의 해부학적 방향이 개선됐다는 증거가 아니다. 기존 Head 축은 자기 pivot 위치에서 추정하며, HeadTop_End와 모델 +Y 또한 모든 rig에서 눈·코·두개골 방향을 보장하지 않는다.

**판단:** 머리 후보도 비채택이다. `experimental-head-direction`을 생략하면 `off`다. 관절 명칭만으로 축을 정하지 말고 mesh에서 보이는 얼굴 방향과 bind 변환을 함께 검증하는 rig profile이 먼저 필요하다.

![동일한 new-dance 4초의 Polydancer 비교. 오른쪽 marker 후보가 얼굴을 숙이는 실패](/Users/chasoik/Projects/action-tracker/output/playwright/parts-polydancer-physical-4s.png)

### 입력 전처리

원시 image/world 관측으로 약한 원근 투영을 맞추는 후보와, 원본 프레임의 검은 여백을 제거해 Body 입력을 만드는 후보를 구현했다. crop은 동일 rVFC 프레임에서 수행하고 좌표를 원본 image 좌표로 복원한다. Hand는 별도의 동일 시각 전체 프레임을 유지했다.

초기 crop 실험은 worker의 scalar-only `sourceMeta` 계약에서 중첩 crop 정보가 소실됐다. 이를 평면 scalar 값과 원시 좌표 JSON 문자열로 보존하도록 수정하고 실제 영상을 다시 추론했다. **초기 crop 결과를 아바타 개선 증거로 사용하지 않는다.**

수정된 new-dance crop 실행은 437개 정확 대응을 얻었고, 기존 실행과 공통인 420개 PTS에서 비교했다. 팔·다리 8개 선분 중 7개의 원시 방향 P95가 나빠졌다. 예를 들어 오른 전완은 90.5→94.4°, 왼 정강이는 35.3→39.2°였다. 서로 다른 추론 실행의 공통 PTS 비교이며 완전히 동일한 worker 일정의 A/B는 아니다. 투영 보정도 방향과 endpoint가 서로 충돌했다. 두 전처리 모두 기본 적용하지 않았다.

## 5. 현재 코드에 남긴 기능과 검증 경계

| 파일 | 이번 변경 |
|---|---|
| [palm-frame.js](/Users/chasoik/Projects/action-tracker/src/pose/palm-frame.js) | 좌우 MCP 손바닥 basis, 부호 있는 회전 비교, 손 원본 PTS·age·freshness |
| [sam-body-regions.mjs](/Users/chasoik/Projects/action-tracker/scripts/lib/sam-body-regions.mjs) | 손 관측 중복 제거와 원래 PTS 비교, 손바닥·머리 진단축·중심 위치·coverage |
| [sam-body-region-report.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-body-region-report.mjs) | 부위·좌우·관절별 분포, 같은 프레임 상하체 실패, JSON/CSV/Markdown |
| [avatar-renderer.js](/Users/chasoik/Projects/action-tracker/src/avatar-renderer.js) | 실제 손목/MCP readback, 머리 진단축, 기본 off인 보정 후보 |
| [palm-reacquisition.js](/Users/chasoik/Projects/action-tracker/src/retarget/palm-reacquisition.js) | 연속 관측을 확인하는 손바닥 재획득 실험 |
| [letterbox-input.js](/Users/chasoik/Projects/action-tracker/src/pose/letterbox-input.js), [app.js](/Users/chasoik/Projects/action-tracker/src/app.js) | 선택적 crop, 원본 image 좌표 복원·raw 보존, 크기·변환 scalar 기록 |
| [reprojection-pose.js](/Users/chasoik/Projects/action-tracker/src/pose/reprojection-pose.js) | image/world 일관성을 시험하는 투영 후보 |
| [sam-part-replay.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-part-replay.mjs) | 소스 snapshot·hash를 남기는 실제 renderer 재생과 고정 reference 분리 |
| [sam-part-baseline-audit.mjs](/Users/chasoik/Projects/action-tracker/scripts/sam-part-baseline-audit.mjs) | 기존·현재 기본 경로의 정확 대응 bone/FK/root 불변성 검사 |

**기존 동작 보존:** 현재 작업 소스를 따로 snapshot한 후, 후보 옵션을 켜지 않은 renderer를 4개 영상×3개 rig로 재생했다. 5,313개 상태에서 모든 기존 bone local quaternion 차이는 최대 0.0000042° 이내였고, 손·발·머리 FK 및 model root 성분 차이는 0이었다. 이는 움직임 개선 증거가 아니라 측정 기능을 추가한 기본 경로의 보존 검증이다. [현재 제품 경로 검사](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/product-default-preservation-audit.json).

**실제 파일 추론:** M1 Max, Chrome 152.0.7977.83, Xbot, Pose Full/GPU, Hands CPU, Face CPU on, 입력 상한 640, 1배속 realtime 모드로 vc0G 약 15초를 새로 실행했다. head/crop 실험은 off였다. 449개 Pose 프레임, Body 처리율 약 29.79Hz, Body 추론 P95 20.60ms, 프레임 처리 합계 P95 28.30ms, avatar update P95 1.10ms였다. 카메라 노출→표시 지연 또는 render 60FPS의 검증값은 아니다. 이번 단일 실행의 29.79Hz를 엄격한 30Hz 목표 통과로 올림 처리하지 않았다. [실행 원본](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/verified-product-runtime.json).

위 실행의 내부 `overallPercent≈97`은 추출 관측과 내부 retarget의 일치도이며 **SAM 기준 정확도 97%가 아니다.** `measurement-only` 실행은 통합 품질 gate를 강제하지 않는다. 짧은 파일 실행과 accelerated replay로 카메라·7개 전체 샘플·3 rigs의 실제 처리율·10분 soak를 통과했다고 주장하지 않는다.

## 6. 다음 개선의 설계와 작업 순서

### P1. 손 관측을 독립적으로 기록하고 원본 픽셀을 보존

1. Hand worker가 실제로 받은 bitmap에 `inputGeneration`, `sourcePtsUs`, 원본 크기, crop affine, side, 검출 후보와 confidence를 붙인다. raw 21점은 Body merge 이전의 별도 observation ledger에 한 번 기록한다. 누락·거부한 검출도 시각과 이유를 남겨 전체 Hand coverage를 계산한다.
2. Body 640 입력과 Hand 픽셀 예산을 분리한다. rVFC callback에서 동결한 원본 프레임으로 좌우 손 ROI를 만들고 256 입력으로 전달한다. Body 결과가 도착한 뒤 live video를 다시 읽으면 시각이 바뀌므로 사용하지 않는다. 전체 해상도 bitmap은 프레임당 하나, 대기열은 latest-only 하나로 제한하고 소비·대체 시 즉시 닫는다.
3. 손 교차 구간에서는 ROI 소유 side를 검출 결과의 side로 곧바로 간주하지 않는다. 같은 원본 시각의 Pose wrist, 손목 2D 거리, 좌우 검출 후보, 이전 관측과의 연속성을 함께 평가한다. 애매하면 observed로 확정하지 않고 추적 보류 상태를 출력한다. 이 상태의 증가가 coverage를 낮춰 좋아 보이지 않도록 거부율도 함께 비교한다.
4. 같은 Hand PTS에서 raw 주축·법선·전체 회전과 손목 2D 오차를 비교한다. Body 지연과 Hand 전달 나이도 별도 측정한다. **원시 손 품질 개선 확인 후** 손목 제어권 변경을 시험한다.

산출물은 독립 손 ledger, source→ROI 변환 검사, 4개 development의 좌우 PTS 비교다. 원본 해상도 증가가 무조건 정확도를 올린다고 전제하지 않는다. 네 영상 중 한 영상의 감소만으로 활성화하지 않는다.

### P2. 손목·머리의 rig 기준 축을 눈에 보이는 형태와 검증

1. rig별 rest 상태에서 손목/MCP 위치와 얼굴의 눈·코·귀 방향을 함께 표시한다. bone parent-local, model-local, world 공간 변환을 분리하고 rest→pose→rest 왕복을 확인한다. mesh와 bone 축이 다르면 그 차이를 고정 rig profile로 기록한다.
2. 손목은 MCP basis로 계산한 swing/twist를 forearm의 최종 world 회전에서 local로 변환해 **한 owner가 한 번만 적용**한다. Hand 관측의 시각과 freshness가 제어권 전환 조건에 포함되어야 한다. 과거 관측을 계속 새 입력처럼 누적하지 않는다.
3. 재획득은 `observed → held → reacquiring → observed` 상태로 표현한다. 관측의 속도 제한과 출력의 회전 속도 제한을 구별한다. hold 중인 출력과 새 관측의 큰 간격을 영구적으로 재거부하는 동작을 피하되, 다른 손으로 바뀐 관측이 수렴했다는 이유만으로 승인하지 않는다.
4. 머리는 희소 head prior와 Face orientation을 독립 관측으로 다룬다. 정수리 marker 하나를 맞추는 방식 대신 검증한 rig의 앞·위 축과 quaternion으로 풀고 Neck/Head 분배를 고정한다. Face 관측 age와 중복 회전 적용 여부도 검증한다.

산출물은 3개 rig의 검증된 profile, SAM 입력 자체의 retarget 손실 보고서, 손/얼굴 정면·측면 비교다. direct SAM 차이와 기존 SAM 구동 아바타 차이를 계속 분리한다. 머리 marker 점수만의 감소는 채택 근거에서 제외한다.

### P3. 팔·다리·root를 위치까지 포함해 함께 해결

팔은 어깨 위치·상완 방향·전완 방향·손목 위치를 하나의 두 관절 사슬에서 풀고, 손목 회전은 P2의 결과와 연결한다. 다리는 골반 pose·양쪽 다리·foot contact를 공동 상태로 풀고, root 보정 뒤에 사슬을 다시 어긋나게 하는 순차 덧셈을 줄인다. 접촉 상태에는 바닥과 발의 속도·높이 관측, hold/release 및 가림 상태가 필요하다.

최적화 목표는 방향 오차만이 아니라 손목·발목·머리 endpoint, 관측 2D 재투영, 고정 길이와 관절 한계, 실제 시간 간격을 사용한 속도 일관성을 포함한다. 손바닥은 SO(3) 회전 잔차를 추가한다. 손·발의 위치 목표는 canonical body/고정 rig 비율로 정의하고, 점수를 좋게 만들기 위한 프레임별 scale·yaw 정렬을 평가에 넣지 않는다.

작업은 팔 → 다리 → root/contact 순서로 단독 효과를 먼저 확인한 뒤 통합한다. 팔 변경에서 손목 위치, 다리 변경에서 발목 위치·접지 slide가 나빠지면 해당 후보를 멈추고 원인을 분해한다. 기존 기준 아바타의 contact도 완전한 실측 정답이 아니므로, 고정 접지 구간의 영상 관측과 직접 SAM foot 궤적을 함께 검토한다.

### P4. 남은 검출 오차에만 causal 보정 학습

P1~P3의 관측·rig 계약을 고정한 후, raw world/image 관측·confidence·실제 Δt·과거 관측만 받는 작은 보정기를 비교한다. 초기 후보는 과거 5~9개 관측의 인과적 window로 두되 길이와 비용은 validation에서 결정한다. missing mask와 관측 age를 명시하며 실제 동작을 늦추는 smoothing과 구별한다.

학습은 robust joint/endpoint 잔차 + 방향 + 손바닥 회전 + 속도/접촉 항을 사용한다. 손바닥 회전만 맞추려고 다른 손목 위치를 희생하지 않도록 부위별 결과를 별도로 검사한다. 입력 정보로 구별할 수 없는 가림·손 앞뒤 사례는 손 RGB crop feature가 필요한지 판단한다.

development는 **영상 단위**로 나누고 leave-one-video-out 결과를 낸다. 겹친 영상의 인접 프레임을 train/test에 무작위로 섞지 않는다. SAM은 offline 학습 target으로만 쓰고, live 입력에는 clip ID·절대 재생 시각·SAM 조회·미래 프레임을 넣지 않는다. 4개 development 영상에 맞춘 결과만으로 새로운 사용자·동작에 일반화됐다고 판단하지 않는다.

### P5. 전체 샘플과 실제 입력에서 승격 판단

새 후보와 규칙을 고정한 뒤 남은 3개 challenge를 포함한 7개 영상×3개 rig를 측정한다. 부위별 P50/P95·프레임 최악값·coverage와 손 관측 age를 유지한다. 손/발/머리 endpoint·root·접지·지연 중 하나의 악화를 전신 평균으로 상쇄하지 않는다. 카메라 입력과 10분 soak에서 seek·loop·소스 전환·가림·재등장도 확인한다.

기존 목표를 완화하지 않는다: major 방향 P95≤20° 및 challenge별≤30°, hinge≤25°, root yaw≤15°, 실제 local 회전≤20°, endpoint≤4%H, 접지 slide≤1%H/s, Body≥min(source FPS,30Hz), render≥60FPS, 적용 지연 P95≤80ms, queue≤1, overload/stale≤5%. 전체 challenge 핵심 지표의 10% 초과 회귀 금지와 시각 확인도 유지한다. 손바닥 법선·회전의 20°는 현재 진단선이며 최종 손 전용 gate를 충족했다고 선언한 값이 아니다.

## 7. 재현과 검사

기존 원시 추론·SAM corpus·rig 자산과 ignored output snapshot이 필요하다. 파일 경로·SHA-256·후보 옵션·reference 경로는 각 실행에 남겼다. 소스만 새로 받은 checkout에 benchmark 데이터가 자동 포함되는 구조는 아니다.

```sh
# 좌우 손바닥을 포함한 전체 결과를 다시 집계
npm run sam:regions -- \
  --manifest tests/fixtures/sam-body-regions/r2-manifest.json \
  --output output/reports/r2-20260912/parts-final

# 현재 renderer를 새 디렉터리에 동결해 부위별 단독 후보 재생
node scripts/sam-part-replay.mjs \
  output/reports/r2-20260912/source-sized-manifest.json \
  output/reports/r2-20260912/third-cases.json \
  output/reports/r2-20260912/replay-next

# 현재 기본 경로를 실행한 기록과 과거 기본 경로를 비교
node scripts/sam-part-baseline-audit.mjs \
  tests/fixtures/sam-body-regions/r1-manifest.json \
  output/reports/r2-20260912/product-default-manifest.json \
  output/reports/r2-20260912/product-default-preservation-audit.json

npm run check
```

`sam-part-replay`는 이미 존재하는 source snapshot을 덮어쓰지 않으므로 재실행할 때 새 output 디렉터리를 사용한다. 정확도 replay의 가속 처리 시간을 realtime FPS라고 보고하지 않는다. `parts-final`이라는 파일명은 이번 집계 산출물을 뜻하며 실험 후보의 제품 채택을 뜻하지 않는다.

`npm run check`의 38개 검사와 anatomical precheck를 통과했다. 새 검사는 손바닥 부호·mirror·회전, 손가락 굽힘과의 분리, 원래 Hand PTS와 전달 PTS 구별, 중복·충돌·누락 관측, 재획득, crop wire 계약, 알려진 투영의 aspect 불변성과 raw 보존을 포함한다. 검사 결과와 실험별 채택/실패 상태는 [최종 검사 로그](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/final-check.log)와 [실험 판정 기록](/Users/chasoik/Projects/action-tracker/output/reports/r2-20260912/experiment-decisions.json)에 남겼다. 실제 측정이 없는 카메라·장시간·전체 challenge 검증과 모든 부위의 동작 개선은 후속 작업으로 남아 있다.
