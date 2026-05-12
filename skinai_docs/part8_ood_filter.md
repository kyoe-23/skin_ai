# Part 8. 비-피부 이미지 거절 기능 (OOD Filter)

## 문제

DenseNet121은 "11종 피부질환 중 어느 것인지"만 판단하는 **폐쇄형(closed-world) 분류기**다.
입력이 무엇이든 반드시 11종 중 하나로 분류하며, 확률 합이 항상 100%다.

→ 강아지, 음식, 풍경, 자동차, 사람 얼굴(병변 없음) 등 모든 비-피부 이미지에
  높은 신뢰도로 잘못된 피부질환을 출력한다.
  (실험 사례: 강아지 사진 → 아토피피부염 86% 신뢰도)

현재 신뢰도 임계값(MIN_CONFIDENCE, thresholds.json)으로는 이 문제를 해결할 수 없다.
강아지 사진이 86% 신뢰도를 받는 구조 자체가 문제이기 때문이다.

### 왜 기존 방법이 모두 실패하는가

| 방법 | 실패 이유 |
|------|----------|
| 신뢰도 임계값 | OOD 이미지도 softmax 특성상 높은 신뢰도 출력 |
| 예측 엔트로피 | 86% 신뢰도 = 낮은 엔트로피 → 정상 이미지와 구분 불가 |
| 특징 거리 (Mahalanobis / L2) | DenseNet이 강아지 털 텍스처를 피부 특징으로 학습해 feature space 자체가 OOD를 구분 못함 |
| 에너지 스코어 | 높은 신뢰도 = 낮은 에너지 = ID 데이터처럼 보임 |
| HSV 피부색 검출 | 황금색 강아지 털이 피부 색조 범위와 겹침 |

## 목표

피부 병변이 찍힌 사진이 아닌 이미지를 분석 전에 거절하고
명확한 안내 메시지를 사용자에게 표시한다.

## 해결 방식

**Claude Haiku vision API를 사전 필터(pre-filter)로 사용**

DenseNet 추론 실행 전, Haiku가 이미지를 보고 "사람 피부 사진인가?"를 먼저 판별한다.

### 동작 흐름

```
이미지 업로드
    ↓
이미지 유효성 검사 (기존 — 파일 형식·해상도)
    ↓
[신규] Haiku vision — "피부 이미지인가?"
    ├── 아님 → "피부 또는 피부 병변 이미지를 업로드해 주세요" (HTTP 400 반환)
    ├── 맞음 → 기존 DenseNet 분류 그대로 진행
    └── 판정 불가 (API 오류) → DenseNet 분류 진행 (서비스 중단 방지)
```

### 이 방식을 선택한 이유

- Claude vision은 "강아지인가 피부인가"를 언어 수준에서 이해한다 — 로컬 모델 기반 방법과 근본적으로 다름
- ANTHROPIC_API_KEY와 LLM 서비스 인프라(llm_service.py)가 이미 프로젝트에 구성되어 있음
- Haiku 모델 사용 시 추가 레이턴시 약 500~900ms로 수용 가능한 범위

## 예외 처리

| 상황 | 동작 |
|------|------|
| API 오류 / 타임아웃 | 거절하지 않고 DenseNet 분류 진행 (서비스 중단 방지) |
| `LLM_ENABLED=false` | OOD 체크 생략, 기존 동작 유지 |
| `OOD_CHECK_ENABLED=false` | LLM은 활성이어도 OOD 체크만 단독 비활성화 |

## 수정 범위

| 파일 | 변경 내용 |
|------|----------|
| `ai/inference/llm_service.py` | `check_is_skin_image()` 함수 신규 추가 |
| `ai/inference/app.py` | 이미지 검증 직후, 추론 전 OOD 체크 블록 삽입 |
| `ai/inference/.env` | `OOD_CHECK_ENABLED`, `LLM_MODEL_OOD`, `OOD_IMAGE_MAX_DIM`, `OOD_ENTROPY_THRESHOLD` 추가 |
| `ai/inference/.env.example` | 동일 4개 환경변수 추가 |

## 예상 레이턴시

| 상태 | 응답 시간 |
|------|----------|
| OOD 체크 활성 (정상) | 600~1,100ms |
| OOD 체크 활성 (API 타임아웃) | 최대 8초 → pass-through |
| LLM 비활성 또는 OOD_CHECK_ENABLED=false | ~140ms (기존과 동일) |

## 검증 시나리오

1. 강아지·음식·풍경 사진 업로드 → 거절 메시지 + HTTP 400 확인
2. 피부 병변 사진 업로드 → 정상 분류 통과 확인
3. 어두운 피부톤 사진 → 거절 없이 정상 통과 확인 (오거절 방지)
4. `LLM_ENABLED=false` 재시작 → 강아지 사진 pass-through, 기존 동작 유지 확인
5. `OOD_CHECK_ENABLED=false` → LLM 리포트는 정상 작동하면서 OOD 체크만 생략 확인
