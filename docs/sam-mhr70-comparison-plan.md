# SAM MHR70 Comparison Plan

## 목표 요약
- 최종적으로 달성해야 할 결과: `video_skeletons.zip`의 SAM 3D Body MHR70 skeleton을 action-tracker의 `motionFrame`/recording 비교 파이프라인에 연결하여, `frontBack`, 팔/손 가림, depth/length clamp 문제를 데이터로 진단할 수 있게 한다.
- 작업 대상/범위: `scripts/hmr-jsonl-adapter.mjs`, 관련 테스트, README/검증 문서, 필요 시 recording 비교 실행 방법.
- 명시적 비목표: SAM 3D Body 런타임을 브라우저 앱에 내장하지 않는다. `motionFrame` 스키마를 깨지 않는다. SAM을 절대 ground truth로 취급하지 않는다. 대용량 mp4/jsonl을 git에 추가하지 않는다.

## 기준선과 가정
- 현재 상태/기준선: 기존 adapter는 `mediapipe33`/`coco17`만 지원한다. 기존 jujae 검증은 overall은 통과하지만 `frontBack`, visual arms, length solver clamp 경고가 남아 있다.
- 확인해야 할 미지수: SAM MHR70 좌표축 부호는 실제 overlay/replay로 최종 대조해야 한다. `mhr_joint_coords_127_3d`는 관절 이름이 없어 이번 범위에서 쓰지 않는다.
- 가정: MHR70의 70개 named keypoint와 `keypoints_mhr70_2d`/`keypoints_mhr70_3d`만 안정 입력으로 사용한다. 비교는 timestamp nearest-pairing과 solver 방향/hinge 지표를 우선한다.

## 단계별 계획
| 단계 | 작업 내용 | 단계별 목표 스펙/성능 수준 | 검증 방법 | 단계 완료 조건 |
|---|---|---|---|---|
| 1 | SAM MHR70 입력을 표준 external HMR recording JSONL로 변환 | MHR70 -> MediaPipe33 body/feet/hand-knuckle 매핑, 2D pixel normalization, 3D hip-center normalization, sourceMeta 보존 | `node tests/hmr-jsonl-adapter-check.mjs` 및 실제 `jujae-regression` 변환 | 출력이 `normalizeExternalMotionRecording()`을 통과하고 990프레임을 보존 |
| 2 | 기존 recording compare와 함께 쓸 리포트 경로 문서화 | `compare:recordings`로 tracker JSONL과 SAM JSONL을 pairing할 수 있음 | README 예시 명령, 실제 변환 산출물 생성 | `output/external/.../recording.jsonl` 생성 가능 |
| 3 | 회귀 테스트/계약 보강 | 기존 `npm run check` 계약이 깨지지 않음 | `npm run check` | 모든 테스트 통과 |
| 4 | 향후 개선 우선순위 정리 | front/back, occlusion hold/decay, depth calibration 개선 후보가 리포트 기반으로 분리됨 | 최종 보고서 | 다음 구현 단계가 명확함 |

## 최종 목표 스펙/성능
- 필수 완료 기준:
  - SAM MHR70 JSONL을 action-tracker external HMR recording JSONL로 변환하는 경로가 구현된다.
  - `jujae-regression-0-16_5/skeletons_mhr70.jsonl` 변환 결과가 990 frame, 33 pose landmarks, 33 world landmarks를 가진다.
  - 기존 테스트와 신규/확장 테스트가 통과한다.
- 성능/품질 목표: 변환은 streaming JSONL 기반으로 동작해 대용량 입력을 한 번에 JSON 배열로 만들지 않는다.
- 회귀 방지 기준: `motionFrame` schema, existing coco17 adapter behavior, recording compare CLI는 기존 동작을 유지한다.
- 산출물: 코드 변경, 테스트, README 사용법, 로컬 변환 산출물 경로.

## 독립 검증 정책
- 최종 완료 선언 전 독립 검증 필요 여부: 필요.
- 권장 검증 주체/환경: 별도 서브에이전트가 가능하면 변경 diff와 테스트 결과를 검토한다.
- 독립 검증자가 확인할 기준: schema 호환성, MHR70 mapping, 실제 zip 변환, 기존 test pass.
- 독립 검증이 불가능할 때의 대체 검증: `git diff` 자체 검토, `npm run check`, 실제 zip 변환, 가능하면 `compare:recordings` smoke를 수행한다.
- 최종 보고에 포함할 증거: 실행 명령, exit code/요약, 산출물 경로, 남은 위험.

## 성능 목표 상향 정책
- 사용자 동의 여부: 미확인.
- 정책: 필수 목표 달성 뒤 임의의 추가 상향 없이 종료한다. 다만 명확한 버그 수정은 같은 범위에서 수행한다.

## 중단/질문 조건
- SAM zip이 없거나 손상됨.
- 좌표계/미러링 확정에 수동 영상 확인이 반드시 필요함.
- `motionFrame` 스키마 변경이 필요해 보임.
- 기존 사용자 변경과 충돌해 안전하게 분리할 수 없음.

## 진행 로그 규칙
- 각 체크포인트마다 현재 단계, 변경 사항, 검증 결과, 남은 일, 차단 여부를 짧게 기록한다.

## MHR70 Head Proxy Audit

- `jujae-regression-0-16_5/skeletons_mhr70.jsonl` 기준으로 MHR70 head proxy 3/4의 lateralization을 확인했다.
- 어깨 midline 대비 2D 위치를 기준으로 joint 3은 person-left, joint 4는 person-right로 분류되는 프레임이 우세했다.
- 따라서 MediaPipe leftEar(7) <- MHR70 3, rightEar(8) <- MHR70 4 매핑은 유지한다.
- 코드에서는 혼동을 줄이기 위해 joint 3/4의 로컬 이름만 `left_ear_proxy` / `right_ear_proxy`로 정정했다.
- 새 SAM skeleton family를 추가할 때는 같은 방식으로 head proxy 좌우성을 재확인한 뒤 매핑을 고정한다.
