# 파트 4 — DL 모델 실제 이미지 성능 테스트 기획안

> 최종 수정: 2026-05-05
> 대상 모델:
> - DS14 DenseNet121 ([ai/results/DS14/checkpoint/best.pth](../ai/results/DS14/checkpoint/best.pth)) — 학습 val Top-1 92.27%
> - DS15 DenseNet121 ([ai/results/DS15/checkpoints/best.pth](../ai/results/DS15/checkpoints/best.pth)) — 학습 val Top-1 99.93% (AI Hub 큐레이션 val — 과대평가 주의)

---

## 1. 배경 및 목적

### 1.1 배경

DS14·DS15 모델은 AI Hub 합성데이터로만 학습·검증됐다. 다음 한계가 있다:

- **합성→실제 도메인 갭 미측정**: 실제 임상 이미지에서의 일반화 성능 미확인
- **DS14 약점**: 지루피부염 Precision 0.798 — 실제 환경에서 더 악화될 가능성
- **DS15 외부 검증 없음**: 학습 후 실제 피부종양 이미지로의 전이 성능 미측정

### 1.2 목적

외부 실제 임상 이미지를 활용해 각 모델의 도메인 갭을 정량화한다.

1. DS14 모델 — DermNet NZ 실제 임상 이미지 3종(아토피·건선·여드름) 성능 측정
2. DS15 모델 — ISIC 2019 피부종양 이미지 8종 성능 측정
3. 도메인 갭 수치를 Phase 3·4 혼합 학습(part6) 전·후 비교 기준으로 활용

---

## 2. 테스트 데이터셋

### 4-A: DermNet NZ (DS14 도메인 갭 측정)

- **출처**: `data/dermnet/test/` (로컬, 홀드아웃 — 학습에 미사용)
- **CSV**: `data/processed/dermnet/test.csv` (이미 존재)
- **구성**: 1,096장 / 3종 (아토피피부염 432, 건선 352, 여드름 312)
- **평가 대상 클래스**: DS14 6종 중 3종만 커버 (주사·지루피부염·정상 제외)
- **의의**: DS14 합성 학습 → 실제 임상 이미지 간 도메인 갭 정량화

| 클래스 | 장수 | DS14 class_idx |
|--------|-----:|:--------------:|
| 아토피피부염 | 432 | 1 |
| 건선 | 352 | 0 |
| 여드름 | 312 | 2 |

> ⚠️ `data/processed/dermnet/test.csv`의 `image_path`가 로컬 절대경로로 저장된 경우
> `evaluate.py --root_dir {PROJECT_ROOT}`로 복원 가능

---

### 4-B: ISIC 2019 (DS15 도메인 갭 측정)

- **출처**: `data/ISIC 2019/` (로컬, 전체 사용)
- **CSV**: `data/processed/isic2019/` (미생성 — 아래 전처리 명령 선행 필요)
- **구성**: 25,331장 / 8종 (DS15 15종 중 8종 커버)
- **평가 대상 클래스**: DS15 8종 (아래 표)
- **의의**: DS15 합성 학습 → 실제 피부종양 이미지 간 도메인 갭 정량화

| ISIC 레이블 | DS15 클래스 | 원본 장수 | 평가 장수 (val, 15%) |
|------------|------------|----------:|--------------------:|
| MEL | 악성흑색종 | 4,522 | ~678 |
| BCC | 기저세포암 | 3,323 | ~498 |
| NV | 멜라닌세포모반 | 12,875 | ~1,931 |
| BKL | 지루각화증 | 2,624 | ~394 |
| AK | 광선각화증 | 867 | ~130 |
| SCC | 편평세포암 | 628 | ~94 |
| VASC | 혈관종 | 253 | ~38 |
| DF | 피부섬유종 | 239 | ~36 |

**전처리 명령 (ISIC 2019 CSV 생성 — 평가 전 1회 실행):**
```bash
python -m ai.preprocessing.external_preprocessor \
    --root_dir "data/ISIC 2019" \
    --output_dir data/processed/isic2019 \
    --source isic2019 \
    --class_map_file ai/preprocessing/class_maps/isic2019_class_map.json \
    --class_idx_map_file ai/preprocessing/class_maps/unified_class_idx_map.json \
    --flat \
    --max_per_class 3000
```

val.csv (15%)를 홀드아웃 평가셋으로 사용한다.

> ⚠️ `max_per_class 3000` 적용으로 NV(12,875→3,000), MEL(4,522→3,000), BCC(3,323→3,000) 다운샘플됨

---

## 3. 합격 기준

| 모델 | 데이터 | 지표 | 합격 기준 |
|------|--------|------|----------|
| DS14 | 4-A DermNet | Top-1 (3종) | ≥ **60%** |
| DS14 | 4-A DermNet | Macro F1 (3종) | ≥ **0.55** |
| DS14 | 4-A DermNet | 아토피·건선 Recall | ≥ **0.65** (합성 대비 -20%p 허용) |
| DS15 | 4-B ISIC 2019 | Top-1 (8종) | ≥ **50%** |
| DS15 | 4-B ISIC 2019 | 악성 클래스 Recall (MEL/BCC/SCC) | ≥ **0.60** |

> 합성 데이터 학습 모델의 초기 도메인 갭 측정 기준. 혼합 학습(part6 Phase 3·4) 후 재측정해 개선폭 확인.

---

## 4. 평가 도구

### `ai/testing/evaluate.py` (기존)

CSV 기반 배치 평가. 인프라 준비 불필요(Flask 서버 불필요).

**DS14 — 4-A DermNet 평가:**
```bash
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS14/checkpoint/best.pth \
    --data_dir data/processed/dermnet \
    --split test \
    --output_dir ai/results/DS14/realtest/dermnet
```

**DS15 — DS15 val 평가 (로컬, 체크포인트 검증용):**
```bash
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS15/checkpoints/best.pth \
    --data_dir data/processed/DS15 \
    --split val \
    --output_dir ai/results/DS15/realtest/val
```

> ⚠️ 학습 시 Colab data_dir이 `data/processed_15`로 기록됨. 로컬 실행 시 반드시 `--data_dir data/processed/DS15` 명시 필요.

**DS15 — 4-B ISIC 2019 평가 (전처리 후):**
```bash
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS15/checkpoints/best.pth \
    --data_dir data/processed/isic2019 \
    --split val \
    --output_dir ai/results/DS15/realtest/isic2019
```

> `evaluate.py`는 CSV 컬럼을 자동 감지해 `AihubFacialDataset`(zip_path 컬럼)과
> `ExternalFacialDataset`(image_path 컬럼)을 자동 전환한다.

---

## 5. 실행 순서

```
① ISIC 2019 전처리 CSV 생성 (4-B 준비)
   python -m ai.preprocessing.external_preprocessor --flat ...

② DS15 val 평가 (체크포인트 검증)
   python -m ai.testing.evaluate \
       --checkpoint ai/results/DS15/checkpoints/best.pth \
       --data_dir data/processed/DS15 --split val ...

③ DS14 — DermNet 평가 (4-A)
   python -m ai.testing.evaluate \
       --checkpoint ai/results/DS14/checkpoint/best.pth \
       --split test ...

④ DS15 — ISIC 2019 평가 (4-B)
   python -m ai.testing.evaluate \
       --checkpoint ai/results/DS15/checkpoints/best.pth \
       --data_dir data/processed/isic2019 --split val ...

⑤ 결과 기록 → skinai_docs/realtest_results.md
⑥ part6 혼합 학습 완료 후 ③④ 재실행 → 도메인 갭 개선폭 비교
```

---

## 6. 결과 저장 구조

```
ai/results/
├── DS14/realtest/dermnet/
│   ├── eval_metrics.json      # Top-1, F1, Per-class P/R/F1
│   ├── confusion_matrix.png
│   └── roc_curves.png
└── DS15/realtest/isic2019/
    ├── eval_metrics.json
    ├── confusion_matrix.png
    └── roc_curves.png
```

---

## 7. 이슈 및 대응

| 이슈 | 대응 |
|------|------|
| DermNet test.csv의 image_path가 절대경로 | `--root_dir` 불필요 (로컬 실행 시 절대경로 그대로 유효). Drive 이동 후엔 CSV 재생성 |
| ISIC 2019 NV 클래스 과잉(12,875장) | `--max_per_class 3000` 다운샘플로 편향 완화 |
| DS15 7종(보웬병·흑색점·사마귀 등) ISIC 미포함 | 해당 클래스는 4-B에서 평가 불가. AI Hub 합성 val로만 측정 |
| DS14에 악성 클래스 없음 | 4-A는 도메인 갭만 측정. 임상 안전성은 DS15로 평가 |
| 도메인 갭이 합격 기준 미달 | part6 혼합 학습 결과를 기다려 재측정 — fine-tuning 효과 정량화에 사용 |
| DS15 val Top-1 99.93% — AI Hub 큐레이션 val 과대평가 | 4-B ISIC 평가로 실제 도메인 갭 정량화. test split 재학습(part6) 후 독립 test 세트로 재측정 |
| DS15 holdout test 세트 없음 | train.csv 전부 학습에 사용. 재학습 전 3-way split 필요 (part6 §6 순위 1번) |
| evaluate.py DS15 로컬 실행 시 data_dir 불일치 | 학습 기록 data_dir `data/processed_15` (Colab) ≠ 로컬 `data/processed/DS15`. 반드시 `--data_dir data/processed/DS15` 명시 |

---

## 8. 후속 연계

- 4-A·4-B 결과를 [part6_training_plan.md](part6_training_plan.md) Phase 3·4 완료 후 재측정 → 혼합 학습 효과 비교
- 결과 누적: [skinai_docs/realtest_results.md](realtest_results.md) (Phase 실행 후 신규 작성)

---

## 참고

- DS15 클래스 인덱스 매핑: [ai/preprocessing/class_maps/ds15_class_idx_map.json](../ai/preprocessing/class_maps/ds15_class_idx_map.json)
- ISIC 2019 레이블 매핑: [ai/preprocessing/class_maps/isic2019_class_map.json](../ai/preprocessing/class_maps/isic2019_class_map.json)
- 혼합 학습 기획: [part6_training_plan.md](part6_training_plan.md)
- 학습 결과 (DS14): [ai/results/DS14/training_log.json](../ai/results/DS14/training_log.json)
