# 실시간 스켈레톤 개선 실행 기록 — R1 후보 구현

작성: 2026-09-08 KST. 기준 소스: `6cfc14996b73774ef34af0883937fb3f67dce68a`.
사용자의 “진행시켜”에 따라 [분석·작업계획](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-avatar-analysis-plan.md)의 구현을 시작했다.

**공통 3D 경로와 SAM 정답 경로를 구현했고, 이후 사용자가 제공한 원본 영상으로 실제 비교까지 진행했다. 전체 목표 달성이나 기본 경로 승격은 아직 하지 않았다.** 원본 7개 해시가 일치했고, 4개 개발 영상×3개 rig 비교에서 endpoint 회귀가 확인됐다. Full/Heavy와 640/1280 입력 비교, 파일 실시간 모드의 최신 결과는 [원본 영상 후속 검증](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-video-validation.md)에 있다. 아래 SAM 직접 입력 진단은 앞선 구조 검증 기록이다.

## 단계 상태

| 단계 | 현재 상태 | 남은 조건 |
|---|---|---|
| R0 데이터/기준선 | 원본 7개 해시 확인, 개발 4개 raw/actual baseline 수집 | 최종 후보를 고정한 뒤 challenge 3개 실행 |
| R1 공통 3D/정답 | 후보 구현 및 실제 detector/3 rigs 비교, 기본값 승격 기각 | 관절 방향 개선과 endpoint 회귀를 함께 해결 |
| R2 손목/rig/root | 이번 변경에 포함하지 않음 | R1에서 고정할 입력 경로 선택 후 별도 실험 |
| R3 모델 선택/학습 | Full/Heavy 및 입력 크기 판별, 학습은 실행하지 않음 | 입력 정보·R2 개선 후 남은 오차에 한해 causal residual 실험 |
| R4 실시간 통합 | 파일 realtime 모드 구현, 4 clips×2 입력 크기 실행 | 카메라, 3 rigs 동시 성능 기준, 손 신선도, 10분 soak |
| R5 최종 검증 | 실행하지 않음 | 7 clips × 3 rigs 전체 정확도, 카메라/10분 soak |

앞선 구조 검증 당시 `output/test-videos`가 없고 파일 검색에서도 원본을 찾지 못했다. 이후 사용자가 `assets/videos`에 원본을 제공했다. SAM overlay 영상을 detector 입력으로 사용하지 않았다. `output`에는 이번 검증 산출물을 보존한다.

## 구현한 동작

### 관측과 3D 표현

- [canonical-pose.js](/Users/chasoik/Projects/action-tracker/src/pose/canonical-pose.js): hip midpoint를 원점으로 하고 camera xyz 전체에 `(x, -y, -z)` 변환을 적용한다. 미러링은 x에 한 번만 적용한다. world 관측이 없거나 보정된 옛 녹화만 있으면 unavailable을 반환한다.
- [observation-adapter.js](/Users/chasoik/Projects/action-tracker/src/pose/observation-adapter.js): detector 원본을 `rawPoseObservation`으로 보존한다. 기존 hybrid + flex bias 경로와 `canonical-world` 경로를 분리한다. 원본이 보존된 녹화는 두 경로로 다시 비교할 수 있다.
- canonical 모드의 제품 renderer와 offline solver가 같은 point builder와 facing 옵션, source clock을 쓴다. 영상은 PTS, 카메라는 callback clock을 사용한다. PTS 0도 유효한 시각이다.
- canonical 관절을 만들 때 rig 비율·z gain·동적 깊이 보정이 들어가지 않는다. 실제 rig 길이와 bone 회전 제약은 기존 retarget 단계에서 적용한다.
- Pose33에서 관측하지 않는 척추 곡률은 선형 torso prior로 표시한다. 머리 끝점도 landmark prior다. 3D 관절 위치가 완전한 local rotation 관측이라는 주장은 하지 않는다.
- 실제 적용과 body/depth 검증 양쪽이 같은 canonical 관절을 읽는다. `canonical_source_to_avatar_residual`은 입력 관절 대비 아바타 잔차이며 detector 정확도 지표가 아니다.
- [motion-frame.js](/Users/chasoik/Projects/action-tracker/src/motion-frame.js)는 raw 관측과 canonical payload를 JSONL 녹화·재생 중 보존한다.

### SAM 정답 경로

[sam-reference.js](/Users/chasoik/Projects/action-tracker/src/pose/sam-reference.js)와 [변환 CLI](/Users/chasoik/Projects/action-tracker/scripts/hmr-jsonl-adapter.mjs)에 `--canonical`을 추가했다.

- clip/frame과 decoder manifest가 일대일로 대응해야 변환한다. raw `timestamp_sec`와 보정량도 함께 보존한다.
- 사람이 없는 행도 missing 관측으로 저장한다. missing을 출력 행 삭제나 타임라인 압축으로 바꾸지 않는다.
- 70개 named joint, 양손 21개 관절, 원본 camera/global/127-joint 데이터가 유지된다. 화면 밖 2D 좌표를 잘라내지 않는다.
- Pose33 finger 슬롯은 MHR MCP proxy임을 명시한다. 원본 70개 관절이 있어서 이후 손목 의미 변환을 다시 할 수 있다.
- `pred_cam_t`와 127 joints는 원본을 보존하는 단계다. 좌표 의미·hierarchy가 검증되기 전 root나 bone 회전으로 추측 적용하지 않는다.
- person 선택은 명시한 배열 index이다. ID 기반 다인 추적을 구현한 것은 아니다.

## 실제 검증

수정 전 전체 검사와 수정 후 `npm run check`의 33개 검사 및 anatomical precheck가 통과했다. 새 검사는 padding/resize 표현 불변성, root-relative 이동, mirror, world 결측, 원본 불변성, raw 재생, timestamp, SAM 결측/정렬/중첩 데이터 직렬화를 확인한다.

[SAM 전체 변환 기록](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-canonical-reference-audit.json): 6,711개 행, 선택 person이 있는 6,674개 행에서 유한한 solver 출력을 얻었다. 검사한 8개 팔다리 구간의 변환 전후 최대 길이 차이는 0이었다. 이는 좌표 변환의 무결성 결과다. 사람이 없는 37행은 유지됐다. `arms-crossed` CLI 출력은 386행이고 시작 PTS는 33.333ms이다.

### 동일한 SAM 입력을 실제 아바타에 적용한 진단

입력은 development clip `shorts-new-dance-E9_h_ZW5z0U-16x9-padded`의 **0~119번 120프레임**이다. SAM의 동일한 2D/3D 관측을 legacy hybrid와 새 canonical 경로 각각에 넣었다. 평가 목표는 두 경우 모두 canonical 방향으로 고정했다.

[브라우저 probe](/Users/chasoik/Projects/action-tracker/scripts/canonical-renderer-probe.mjs)를 실제 renderer에서 실행했다. Xbot/Soldier/Polydancer 각각 두 경로, 총 720회 적용에서 finite bone quaternion과 5개 FK endpoint를 수집했다. 세 rig 모두 canonical 관절이 입력과 같았고, pure solver와 제품 retarget 목표 방향의 최대 벡터 차이는 `7.506e-7`이었다. 브라우저 console error는 없었다.

아래는 **실제 bone world 회전으로 회전시킨 rest aim 축과 canonical 목표 방향 사이의 각도 P95**다. full quaternion 오차, endpoint 정확도, detector 추출 오차와는 다르다. `FK 수집 성공`은 `FK 오차 목표 통과`를 의미하지 않는다.

| 구간 P95 (도) | Xbot 기존 → 후보 | Soldier 기존 → 후보 | Polydancer 기존 → 후보 |
|---|---:|---:|---:|
| 왼쪽 위팔 | 20.812 → <0.001 | 20.812 → <0.001 | 20.812 → <0.001 |
| 왼쪽 아래팔 | 29.409 → <0.001 | 35.667 → <0.001 | 35.446 → <0.001 |
| 오른쪽 아래팔 | 19.425 → 0.410 | 30.865 → 0.366 | 29.415 → 0.318 |
| 목 | 11.365 → 13.417 | 8.287 → 10.277 | 13.203 → 16.082 |
| 머리 | 22.160 → 10.209 | 33.754 → 29.576 | 29.047 → 25.232 |

팔에서 기존 표현이 만드는 손실이 확인됐다. 동시에 목 방향의 회귀와 Soldier/Polydancer의 머리 잔차가 남았다. 머리 목표는 sparse landmark 기반 prior라 별도 rest 축·head/neck 분배 확인도 필요하다. **이 4초 진단만으로 후보를 기본값으로 채택하지 않았다.** 전체 프레임·손목 twist·root·접촉·속도 cap·실제 입력 정확도는 추가 검증 대상이다.

수치·소스 해시는 [probe 결과 JSON](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-canonical-renderer-probe.json), 렌더 화면은 [Xbot 캡처](/Users/chasoik/Projects/action-tracker/output/playwright/canonical-r1-xbot.png)에 있다. 프레임을 빠르게 주입한 진단이므로 이 실행의 wall time으로 realtime FPS/latency를 주장하지 않는다.

## 재현

저장소에서 `npm run start` 후 `http://127.0.0.1:8000/?skeleton-mode=canonical-world&validation=1`을 연다. 쿼리가 없으면 기존 `legacy-hybrid`가 기본이다. 기존 depth/flex 보정으로 관측 원본을 덮어쓴 옛 녹화는 raw 학습 자료로 사용하지 않는다.

```sh
npm run check
node scripts/hmr-jsonl-adapter.mjs \
  --input sam-3d-body-skeletons/arms-crossed/skeletons_mhr70.jsonl \
  --joint-format mhr70 --canonical --clip arms-crossed \
  --decoder-manifest tests/fixtures/sam-goal-v2/labels/decoder-manifest.jsonl \
  --output output/reports/sam-canonical-arms-crossed.jsonl
```

브라우저 module probe는 앱 import map이 있는 페이지에서 실행한다. `frames`에는 위 JSONL을 `parseMotionRecordingJsonl`로 읽은 recording의 frames를 전달할 수 있다. 측정한 120프레임 fixture는 `output/playwright/canonical-preview-frames.json`에 남겼다.

```js
const { probeCanonicalRenderer } = await import('/scripts/canonical-renderer-probe.mjs');
const frames = await (await fetch('/output/playwright/canonical-preview-frames.json')).json();
const report = await probeCanonicalRenderer({ frames, modelUrl: '/assets/models/Xbot.glb' });
```

원본 복구 후 실제 검출에서 raw payload를 잃던 보조 채널 병합을 수정했고, legacy→canonical→legacy 재생도 원본에서 정확히 한 번 보정하도록 고쳤다. 앞선 평가 소스와 현재 adapter의 3,550 frame/mode 쌍을 비교한 최대 좌표 차이는 `6.80e-16`이고 canonical payload는 동일했다. 현재 코드와 검증 결과, 남은 작업은 [후속 검증 문서](/Users/chasoik/Projects/action-tracker/docs/2026-09-08-realtime-skeleton-video-validation.md)를 기준으로 한다. 커밋·푸시는 하지 않았다.
