# 파트 6 — 학습 실행 기획

> 작성일: 2026-05-05  
> 기준: 로컬 데이터셋 전수 확인 후 작성  
> 전제: DS14·DS15 독립 학습 → 이후 멀티헤드 통합 (data-dataset-15-memoized-starlight.md §6 Phase 3)

---

## 1. 보유 데이터 현황 요약

### AI Hub 합성 (전처리 완료)

| 데이터셋 | split | 장수 | 클래스 | 균형 |
|---------|-------|-----:|--------|------|
| DS14 | train | 9,600 | 6종 × 1,600 | ✅ 완전 균형 |
| DS14 | val | 1,200 | 6종 × 200 | ✅ |
| DS15 | train | 12,000 | 15종 × 800 | ✅ 완전 균형 |
| DS15 | val | 1,500 | 15종 × 100 | ✅ |

### 외부 임상 데이터

**DermNet NZ (전처리 완료 — `data/processed/dermnet/`)**

| split | 장수 | 아토피피부염 | 건선 | 여드름 |
|-------|-----:|------------:|-----:|------:|
| train | 3,373 | 1,465 | 1,194 | 714 |
| val | 596 | 259 | 211 | 126 |
| test (홀드아웃) | 1,096 | 432 | 352 | 312 |

DS14 6종 중 **3종만 커버** (아토피·건선·여드름). 주사·지루피부염·정상 미포함.

**ISIC 2019 (전처리 미완료 — `data/ISIC 2019/`)**

| ISIC 레이블 | DS15 클래스 | 위험도 | 장수 |
|------------|------------|--------|-----:|
| MEL | 악성흑색종 | 악성 | 4,522 |
| BCC | 기저세포암 | 악성 | 3,323 |
| SCC | 편평세포암 | 악성 | 628 |
| AK | 광선각화증 | 전암성 | 867 |
| NV | 멜라닌세포모반 | 추적필요 | 12,875 |
| BKL | 지루각화증 | 양성 | 2,624 |
| DF | 피부섬유종 | 양성 | 239 |
| VASC | 혈관종 | 양성 | 253 |
| **합계** | 8종 | | **25,331** |

DS15 15종 중 **8종 커버**. NV 50.8% 독점 → 다운샘플 필요.

**HAM10000 (전처리 미완료 — `data/HAM10000/`)**

| 레이블 | DS15 클래스 | 장수 |
|--------|------------|-----:|
| nv | 멜라닌세포모반 | 6,705 |
| mel | 악성흑색종 | 1,113 |
| bkl | 지루각화증 | 1,099 |
| bcc | 기저세포암 | 514 |
| akiec | 광선각화증 | 327 |
| vasc | 혈관종 | 142 |
| df | 피부섬유종 | 115 |
| **합계** | 7종 | **10,015** |

이미지: `HAM10000_images_part_1` (5,000) + `HAM10000_images_part_2` (5,015).  
레이블: `HAM10000_metadata.csv` (image_id → dx 컬럼).  
⚠️ **dermoscopy 이미지** — AI Hub 합성(임상 사진)과 도메인 다름.  
ISIC 2019와 7종 전부 겹치므로 **초기 학습에서 제외, Phase 3 성능 미달 시 보조로 추가**.

---

## 2. DS15 클래스별 커버리지

| DS15 클래스 | AI Hub | ISIC 2019 | 비고 |
|------------|:------:|:---------:|------|
| 악성흑색종 | 800 | 4,522 | ✅ 충분 |
| 기저세포암 | 800 | 3,323 | ✅ 충분 |
| 편평세포암 | 800 | 628 | ⚠️ 소량 — 가중치 보정 필요 |
| 광선각화증 | 800 | 867 | ⚠️ 소량 |
| 멜라닌세포모반 | 800 | 12,875 | ⚠️ 과잉 — 3,000장 다운샘플 |
| 지루각화증 | 800 | 2,624 | ✅ 충분 |
| 피부섬유종 | 800 | 239 | ⚠️ 소량 |
| 혈관종 | 800 | 253 | ⚠️ 소량 |
| 보웬병 | 800 | **없음** | ❌ AI Hub만 |
| 흑색점 | 800 | **없음** | ❌ AI Hub만 |
| 사마귀 | 800 | **없음** | ❌ AI Hub만 |
| 비립종 | 800 | **없음** | ❌ AI Hub만 |
| 표피낭종 | 800 | **없음** | ❌ AI Hub만 |
| 화농 육아종 | 800 | **없음** | ❌ AI Hub만 |
| 피지샘증식증 | 800 | **없음** | ❌ AI Hub만 |

ISIC 혼합으로 **8종만 도메인 갭 완화**, 나머지 7종은 합성 데이터에 의존.

---

## 3. 학습 단계 계획

### Phase 1 — DS15 단독 Baseline ✅ 완료

**결과**: Colab 100 epoch 학습 완료 (`ai/results/DS15/training DS_15.ipynb`)

```
학습: data/processed_15/train.csv  (12,000장, 15종 균형)  ← Colab 경로
검증: data/processed_15/val.csv    (1,500장)
backbone: DenseNet121, batch_size=64, lr=0.0005
loss: CrossEntropyLoss (label_smoothing=0.1)
checkpoint: ai/results/DS15/checkpoints/   ← 실제 저장 경로
```

**결과 수치**: best_epoch=95, **val Top-1 99.93%**  
> ⚠️ AI Hub 큐레이션 val 세트이므로 실제 성능 과대평가 가능성 높음. test split 재학습 후 진짜 성능 확인 필요.

**목표**: Top-1 ≥ 75% (AI Hub 가이드라인) — ✅ 달성

---

### Phase 2 — ISIC 2019 전처리

**목적**: ISIC 2019 → DS15 클래스 매핑 CSV 생성  
**코드 준비**: 완료 (`--flat`, `--max_per_class`, `--class_idx_map_file` 추가) / **Drive 업로드 대기 중**

```bash
python -m ai.preprocessing.external_preprocessor \
    --root_dir "data/ISIC 2019" \
    --output_dir data/processed/isic2019 \
    --val_ratio 0.15 \
    --source isic2019 \
    --class_map_file ai/preprocessing/class_maps/isic2019_class_map.json \
    --class_idx_map_file ai/preprocessing/class_maps/unified_class_idx_map.json \
    --flat \
    --max_per_class 3000   # NV 12,875장 → 3,000장 다운샘플
```

완료된 파일: `ai/preprocessing/class_maps/isic2019_class_map.json` ✅, `ai/preprocessing/class_maps/ds15_class_idx_map.json` ✅

**NV 다운샘플 후 예상 분포:**

| 클래스 | 원본 | 다운샘플 후 |
|--------|-----:|----------:|
| NV | 12,875 | 3,000 |
| MEL | 4,522 | 3,000 |
| BCC | 3,323 | 3,000 |
| BKL | 2,624 | 2,624 |
| AK | 867 | 867 |
| SCC | 628 | 628 |
| VASC | 253 | 253 |
| DF | 239 | 239 |
| **합계** | 25,331 | **13,611** |

---

### Phase 3 — DS15 + ISIC 2019 혼합 학습

**목적**: 실제 임상 이미지 혼합으로 도메인 갭 완화  
**소요 시간**: ~1~2일 (H100 기준 50 epoch)  
**선행 조건**: Phase 1 완료 + Phase 2 완료

```
AI Hub DS15 train:   12,000장  — source weight 1.0
ISIC 2019 train:     ~11,569장 — source weight 1.5 (val 15% 분리 후)
합계: ~23,569장

sampler: WeightedRandomSampler
  악성 클래스 ISIC (MEL/BCC/SCC): × 2.0  # 임상 중요도
  소량 ISIC 클래스 (SCC/AK/DF/VASC): × 2.5  # 부족 보정
  NV: × 0.5  # 과잉 억제

loss: FocalLoss (γ=2.0)
best model 기준: 악성 클래스 macro Recall  # val_top1_acc 아님
checkpoint: ai/results/DS15/mixed_isic/
```

**목표**: 악성 클래스 Recall ≥ 85%, 전체 Top-1 ≥ 78%

---

### Phase 4 — DS14 + DermNet 혼합 학습 (Phase 1~2 병행)

**목적**: DS14 3종(아토피·건선·여드름) 도메인 갭 완화  
**소요 시간**: ~1일  
**즉시 시작 가능 조건**: `train_mixed.ipynb`의 `EXTRA_DATA_DIR` 경로만 수정

```
AI Hub DS14 train:  9,600장  — weight 1.0
DermNet train:      3,373장  — weight 1.5
DermNet 클래스별 추가 보정:
  여드름(714장): × 2.0
  건선(1,194장): × 1.2
  아토피(1,465장): × 1.0

checkpoint: ai/results/DS14/mixed_dermnet/
평가:
  - DS14 val (합성 6종): 기존 92% 수준 유지 확인
  - DermNet test (홀드아웃): 3종 Top-1 ≥ 75% 목표
```

> ⚠️ 주사·지루피부염·정상 클래스는 DermNet 미포함 — 해당 클래스 도메인 갭 미해소

---

## 4. 파일 작업 현황

| 파일 | Phase | 내용 | 상태 |
|------|-------|------|------|
| `ai/preprocessing/class_maps/isic2019_class_map.json` | 2 | ISIC 레이블 → 클래스 매핑 | ✅ 완료 |
| `ai/preprocessing/class_maps/ds15_class_idx_map.json` | 2 | DS15 클래스 → 인덱스 매핑 | ✅ 완료 |
| `ai/preprocessing/external_preprocessor.py` 수정 | 2 | `--flat`, `--max_per_class`, `--class_idx_map_file` 추가 | ✅ 완료 |
| `ai/training/classifier/train.py` 수정 | 4 | `ExternalFacialDataset`에 `root_dir=args.root_dir` 전달 | ✅ 완료 |

> `config_15.py`, `train_15.py` 별도 작성 불필요 — 기존 `train.py`의 `--data_dir`/`--num_classes` CLI 인자 + `load_from_metadata()`로 DS15 지원 완료.

기존 코드 재사용:
- `ai/dataset/dataset.py` — `ExternalFacialDataset(root_dir=...)`, `AihubFacialDataset` 그대로 사용
- `ai/testing/evaluate.py` — DS15도 동일 (num_classes는 체크포인트에서 자동 복원, `--data_dir` 오버라이드 필요)
- `ai/training/classifier/train.py` — DS14 혼합 학습 및 DS15 단독 학습 모두 사용

---

## 5. Colab 노트북 계획

| 노트북 | Phase | 내용 | 상태 |
|--------|-------|------|------|
| `train_mixed.ipynb` (경로 수정) | 4 | `EXTRA_DATA_DIR=data/processed/dermnet` 반영 | ✅ 완료 |
| `ai/results/DS15/training DS_15.ipynb` | 1 | DS15 단독 baseline 학습 (Colab 실행 완료) | ✅ 완료 |
| `train_ds15_mixed.ipynb` (신규) | 3 | DS15 + ISIC 2019 혼합 학습 | 🔴 미작성 |

---

## 6. 실행 우선순위

| 순위 | 항목 | 상태 | 선행 조건 |
|------|------|------|----------|
| — | DS15 baseline 학습 (Phase 1) | 🟢 완료 (val Top-1 99.93%, epoch 95) | — |
| — | `external_preprocessor.py --flat` + `class_maps/isic2019_class_map.json` + `class_maps/unified_class_idx_map.json` | 🟢 완료 | — |
| — | `train_mixed.ipynb` `EXTRA_DATA_DIR` 경로 수정 | 🟢 완료 | — |
| 1 | DS15 test split 재학습 (3-way split, 640/80/80 per class) | 🟡 권고 | `split_dataset.py` 작성 필요 |
| 2 | ISIC 2019 Drive 업로드 완료 후 전처리 (Phase 2) | 🟡 Drive 업로드 대기 | Drive 업로드 완료 |
| 3 | DS14 DermNet 혼합 학습 (Phase 4) | 🟡 Colab 실행 대기 | DermNet Drive 업로드 완료 |
| 4 | `train_ds15_mixed.ipynb` 작성 + DS15 ISIC 혼합 학습 (Phase 3) | 🔴 대기 | Phase 1(재학습)·2 완료 |
| 5 | HAM10000 보조 활용 | 🔴 보류 | Phase 3 성능 미달 시 검토 |

---

## 관련 문서

- [part5_multisource_training.md](part5_multisource_training.md) — 외부 데이터셋 전략 및 DermNet 매핑 검증
- [data-dataset-15-memoized-starlight.md](data-dataset-15-memoized-starlight.md) — DS15 전처리·아키텍처 설계
