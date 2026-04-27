# 파트 4 — DS14 모델 실제 이미지 테스트 기획안

> 작성일: 2026-04-27
> 대상 모델: DenseNet121 (DS14, [ai/results/DS14/checkpoint/best.pth](../ai/results/DS14/checkpoint/best.pth))
> 학습 결과: Top-1 92.27%, Macro F1 0.9437, Macro AUC 0.9921

---

## 1. 배경 및 목적

### 1.1 배경

DS14 모델은 AI Hub 안면부 피부질환 합성데이터(12,000장, 클래스당 동일 수량)로 학습되어 가이드라인 목표(Top-1 80%, stretch 85%)를 큰 폭으로 초과 달성했다. 그러나 다음 한계를 가진다:

- **합성데이터에만 검증됨**: 실제 환자 이미지·스마트폰 촬영본의 일반화 성능 미확인
- **임상 약점 존재**: 지루피부염 Precision 0.798(다른 클래스가 지루피부염으로 오분류) — 실제 환경에서 더 악화될 가능성
- **End-to-End 미검증**: Flask 서버 → 백엔드 프록시 → 프론트 UI까지의 통합 워크플로우가 실 사용 환경에서 동작하는지 검증되지 않음

### 1.2 목적

의료진 진료 보조용 배포 전 다음을 정량 검증한다:

1. 합성데이터 외 실제 이미지 일반화 성능 측정 (도메인 갭 정량화)
2. 임상 약점 클래스(지루피부염·아토피)의 실제 환경 재현성 확인
3. Edge case(저조도·흐림·OOD) 견고성 평가 및 `uncertain` 플래그 정상 동작 확인
4. End-to-End 응답 시간(P50, P95) 측정
5. (LLM 연동 시) 자연어 리포트 품질·면책 조항 누락 여부

---

## 2. 인프라 현황

| 항목 | 위치 | 상태 |
|---|---|---|
| 체크포인트 | [ai/results/DS14/checkpoint/best.pth](../ai/results/DS14/checkpoint/best.pth) (80MB) | 준비 완료 |
| Threshold | [ai/results/DS14/thresholds.json](../ai/results/DS14/thresholds.json) | 준비 완료 |
| Flask 서버 | [ai/inference/app.py](../ai/inference/app.py) — `POST /predict` | 준비 완료 |
| 평가 스크립트 (CSV 배치) | [ai/testing/evaluate.py](../ai/testing/evaluate.py) | 준비 완료 |
| 백엔드 프록시 | [backend/src/routes/ai.js](../backend/src/routes/ai.js) — `/api/ai/predict` | 준비 완료 |
| 프론트 분석 UI | [frontend/html/ai_analyze.html](../frontend/html/ai_analyze.html) | 준비 완료 |
| Sanity 데이터 | [data/processed/DS14/val.csv](../data/processed/DS14/val.csv) (1,200장) | 준비 완료 |
| **외부 이미지 일괄 테스트 도구** | (미존재) | **신규 필요** |

→ 인프라 90% 완비. 신규 작성 코드는 외부 이미지 일괄 테스트 도구·리포트 생성기 2개에 한정.

---

## 3. 테스트 합격 기준

| 검증 항목 | 측정 방식 | 합격 기준 |
|---|---|---|
| 합성데이터 재현성 | val.csv 60장 Flask 호출 | 학습 시 결과 ±2%p 이내 |
| 도메인 갭 (외부 임상) | 외부 데이터셋 Top-1 / Macro F1 | Top-1 ≥ **75%** (합성 92% → 실제 -17%p 허용) |
| 실사용자 환경 | 스마트폰 촬영 이미지 | Top-1 ≥ **70%**, P95 응답 < 5초 |
| 견고성 (Edge case) | 저조도·흐림·OOD 입력 | `uncertain=true` 또는 confidence<threshold 비율 ≥ **80%** |
| 임상 약점 검증 | 지루피부염 Precision | 외부 셋에서 ≥ **0.70** (현 합성 0.798) |
| LLM 리포트 품질 | 체크리스트 정성 평가 | 면책 문구 100% 포함, 약품명 누설 0건 |

> 합격 기준은 진료 보조용 MVP 기준. 의료기기 인증 단계에서는 별도 임상시험 설계 필요.

---

## 4. 테스트 데이터셋 구성

### A. Sanity Check — 60장
- [data/processed/DS14/val.csv](../data/processed/DS14/val.csv)에서 클래스당 10장 무작위 샘플
- 추론 파이프라인 정상 동작 + 학습 시 metric 재현 확인
- 저장 경로: `data/realtest/sanity/`

### B. 외부 임상 이미지 — 클래스당 20~30장 (총 약 150장)
- 출처 후보:
  - **DermNet NZ** — 공개 피부과 이미지 라이브러리
  - **ISIC Archive** — 국제 피부영상 컨소시엄 (주로 색소성 병변 위주, 본 프로젝트 6종과 부분 매핑)
  - **SCIN dataset** ([scin_legacy/](../scin_legacy/) 보유) — 50종 분류 데이터 → 6종 매핑 필요
  - 공개 피부과 교과서 이미지 (라이선스 확인 필수)
- **외부 라벨 → AI Hub 6종 매핑 표 작성 필수** (예: SCIN의 "psoriasis vulgaris" → 건선)
- 매핑 불가 케이스는 "기타"로 분리하여 평가 제외
- 저장 경로: `data/realtest/external/{class_name}/`

### C. 실사용자 시나리오 — 클래스당 10장 (총 60장)
- 스마트폰 촬영 (자체 또는 협력자)
- 정상 클래스는 다양한 인종·연령·조명 조건 포함
- **개인정보 동의서 사전 확보 필수**
- 저장 시 EXIF 제거 + 익명 ID 부여 (예: `user_001.jpg`)
- 저장 경로: `data/realtest/user/`

### D. Edge Case — 50장
- 저조도 (10장)
- 흔들림·포커스 아웃 (10장)
- 회전·뒤집힘 (10장)
- 부분 가림 (마스크·머리카락·안경) (10장)
- 비안면부 (손·등 — OOD reject 테스트) (10장)
- 저장 경로: `data/realtest/edge/{subtype}/`

---

## 5. 4-Phase 실행 계획

### Phase 1 — 환경 점검 (반나절)
- Flask 서버 기동: `cd ai/inference && python app.py`
- A 데이터셋 60장으로 `realtest_runner.py` 일괄 실행
- 산출: `ai/results/DS14/realtest/phase1_sanity.csv`
- **합격 시 Phase 2 진행**, 불합격 시 환경·체크포인트·Threshold 점검

### Phase 2 — 도메인 갭 측정 (1일)
- B 데이터셋으로 Top-1, Macro F1, Per-class P/R/F1, Confusion Matrix 산출
- 합성(val.csv) vs 외부(B) confusion matrix 시각 비교
- 산출:
  - `ai/results/DS14/realtest/phase2_external_metrics.json`
  - `ai/results/DS14/realtest/phase2_external_cm.png`
  - `ai/results/DS14/realtest/phase2_synthetic_vs_external_cm.png`

### Phase 3 — 실사용자 워크플로우 (1일)
- C 데이터셋을 [frontend/html/ai_analyze.html](../frontend/html/ai_analyze.html)로 직접 업로드
- 분류 결과 + Grad-CAM + LLM 리포트(연동 시) 종합 평가
- 응답 시간 P50/P95 측정 (`processing_time_ms` 필드 활용)
- LLM 리포트 정성 평가 ([llm_api_research.md §4-3](llm_api_research.md) 체크리스트 참조)
- 산출:
  - `ai/results/DS14/realtest/phase3_user_log.csv`
  - `ai/results/DS14/realtest/phase3_qualitative_checklist.md`

### Phase 4 — Edge Case (반나절)
- D 데이터셋으로 confidence/uncertain 분포 측정
- 비안면부(OOD) 입력에서 `uncertain=true` 비율이 80% 이상 나오는지 확인
- 산출:
  - `ai/results/DS14/realtest/phase4_edge.csv`
  - `ai/results/DS14/realtest/phase4_confidence_hist.png`

---

## 6. 신규 작성 파일

### `ai/testing/realtest_runner.py`
**입력**:
- `--dir`: 이미지 디렉토리
- `--label`: 정답 라벨 CSV (선택, 있으면 클래스별 metric 산출)
- `--url`: Flask 엔드포인트 (기본 `http://localhost:5001/predict`)
- `--output`: 결과 CSV 경로

**동작**:
1. 디렉토리 내 이미지를 순회하며 multipart로 `/predict` 호출
2. JSON 응답에서 prediction·confidence·top3·uncertain·processing_time_ms 추출
3. CSV 저장 + 라벨 있을 시 sklearn으로 P/R/F1·Confusion Matrix 자동 산출

**출력 컬럼**: `filename, true_label, pred_class, confidence, top3_json, uncertain, processing_time_ms`

### `ai/testing/realtest_report.py`
**입력**: runner가 생성한 CSV

**동작**: Phase별 합격 기준과 비교하여 마크다운 리포트 + Confusion Matrix PNG + confidence 히스토그램 생성

### `skinai_docs/realtest_results_DS14.md` (Phase 실행 완료 후)
- 4-Phase 결과 종합 리포트
- 각 Phase 합격 여부, 미달 항목 분석, 후속 액션

---

## 7. 결과 저장 구조

```
ai/results/DS14/realtest/
├── phase1_sanity.csv
├── phase2_external_metrics.json
├── phase2_external_cm.png
├── phase2_synthetic_vs_external_cm.png
├── phase3_user_log.csv
├── phase3_qualitative_checklist.md
├── phase4_edge.csv
└── phase4_confidence_hist.png
```

```
data/realtest/
├── sanity/        # A. val.csv에서 추출한 60장
├── external/      # B. 외부 임상 이미지 (클래스별 디렉토리)
│   ├── 건선/
│   ├── 아토피피부염/
│   └── ...
├── user/          # C. 실사용자 스마트폰 (익명 ID)
└── edge/          # D. Edge case
    ├── lowlight/
    ├── blur/
    ├── rotated/
    ├── occluded/
    └── ood/
```

---

## 8. 위험 및 대응

| 위험 | 대응 |
|---|---|
| 외부 데이터셋 라이선스 충돌 | DermNet/ISIC 약관 사전 검토, 학술 사용 한정 명시. 결과 발표 시 출처 명기 |
| 실사용자 이미지 개인정보 | 동의서 양식 확보, EXIF 제거 + 익명 ID 부여, 저장소 접근 제한 |
| 외부 라벨 ↔ AI Hub 6종 매핑 모호 | 매핑 표 작성 후 도메인 전문가(피부과 자문) 검수, 모호 케이스는 "기타"로 분리 평가 제외 |
| 도메인 갭이 너무 큰 경우 | Phase 2 결과 분석 → 외부 데이터로 fine-tuning 또는 augmentation 정책 재설계 |
| LLM 비활성 상태 | Phase 3 정성 평가는 분류 결과만 평가, LLM 리포트 평가는 [llm_api_research.md](llm_api_research.md) 연동 후 별도 진행 |
| Flask 서버 동시성 부족 | gunicorn `-w 2`로 기동 테스트 (`gunicorn -w 2 -b 0.0.0.0:5001 "app:create_app()"`) |

---

## 9. 실행 명령 요약

```bash
# 0) Flask 서버 기동
cd ai/inference && python app.py

# 1) Phase 1 — Sanity check
python -m ai.testing.realtest_runner \
    --dir data/realtest/sanity \
    --label data/processed/DS14/val.csv \
    --url http://localhost:5001/predict \
    --output ai/results/DS14/realtest/phase1_sanity.csv

# 2) Phase 2 — 외부 임상
python -m ai.testing.realtest_runner \
    --dir data/realtest/external \
    --label data/realtest/external/labels.csv \
    --output ai/results/DS14/realtest/phase2_external.csv

python -m ai.testing.realtest_report \
    --csv ai/results/DS14/realtest/phase2_external.csv \
    --phase 2

# 3) Phase 3 — 실사용자 (UI 직접 사용 후 응답 로그만 수집)
python -m ai.testing.realtest_runner \
    --dir data/realtest/user \
    --output ai/results/DS14/realtest/phase3_user_log.csv

# 4) Phase 4 — Edge case
python -m ai.testing.realtest_runner \
    --dir data/realtest/edge \
    --output ai/results/DS14/realtest/phase4_edge.csv

python -m ai.testing.realtest_report \
    --csv ai/results/DS14/realtest/phase4_edge.csv \
    --phase 4
```

---

## 10. 후속 작업

- 각 Phase 결과는 [skinai_docs/realtest_results_DS14.md](realtest_results_DS14.md)에 누적 기록
- 합격 시 → LLM 리포트 워크플로우([llm_api_research.md](llm_api_research.md)) 통합 테스트로 진행
- 도메인 갭이 크게 발생한 경우 → 외부 데이터로 fine-tuning 검토 또는 학습 데이터 보강 논의
- 추후 dataset_15(피부측정 데이터) 도입 시 본 기획안을 템플릿으로 재사용

---

## 참고

- 학습 결과: [ai/results/DS14/training_log.json](../ai/results/DS14/training_log.json)
- 학습 보고서: [ai/results/DS14/DS14_report.md](../ai/results/DS14/DS14_report.md)
- LLM 연동 기획: [skinai_docs/llm_api_research.md](llm_api_research.md)
- 코딩 규칙: [CLAUDE.md](../CLAUDE.md)
