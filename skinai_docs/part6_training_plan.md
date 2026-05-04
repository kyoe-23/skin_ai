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

### Phase 1 — DS15 단독 Baseline

**목적**: AI Hub 합성 데이터만으로 DS15 baseline 성능 측정  
**소요 시간**: ~1일 (H100 기준 50 epoch)  
**즉시 시작 가능 조건**: `config_15.py`, `train_15.py` 신규 작성 후

```
학습: data/processed/DS15/train.csv  (12,000장, 15종 균형)
검증: data/processed/DS15/val.csv    (1,500장)
backbone: DenseNet121
loss: CrossEntropyLoss (label_smoothing=0.1)  # 균형 데이터이므로 FocalLoss 불필요
sampler: shuffle  # 균형 데이터이므로 WeightedRandomSampler 불필요
checkpoint: ai/results/DS15/baseline/
```

**목표**: Top-1 ≥ 75% (15-class, AI Hub 가이드라인)

---

### Phase 2 — ISIC 2019 전처리

**목적**: ISIC 2019 → DS15 클래스 매핑 CSV 생성  
**소요 시간**: ~30분 (코드 수정 포함)

ISIC 2019 폴더 구조가 `data/ISIC 2019/{LABEL}/` 형태로 이미 클래스별 분리되어 있어  
`external_preprocessor.py`를 flat 폴더 구조 지원(`--flat` 옵션)으로 수정 후 재사용한다.

```bash
python -m ai.preprocessing.external_preprocessor \
    --root_dir "data/ISIC 2019" \
    --output_dir data/processed/isic2019 \
    --val_ratio 0.15 \
    --source isic2019 \
    --class_map_file ai/preprocessing/isic2019_class_map.json \
    --flat \
    --max_per_class 3000   # NV 12,875장 → 3,000장 다운샘플
```

신규 작성 파일: `ai/preprocessing/isic2019_class_map.json`

```json
{
  "MEL":  "악성흑색종",
  "BCC":  "기저세포암",
  "SCC":  "편평세포암",
  "AK":   "광선각화증",
  "NV":   "멜라닌세포모반",
  "BKL":  "지루각화증",
  "DF":   "피부섬유종",
  "VASC": "혈관종"
}
```

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

## 4. 신규 작성 필요 파일

| 파일 | Phase | 내용 |
|------|-------|------|
| `ai/training/classifier/config_15.py` | 1 | DS15 전용 설정 (num_classes=15, FocalLoss, 악성 클래스 가중치) |
| `ai/training/classifier/train_15.py` | 1 | FocalLoss, 악성 클래스 Recall 기준 best 저장 |
| `ai/preprocessing/isic2019_class_map.json` | 2 | ISIC 레이블 → DS15 클래스 매핑 |
| `ai/preprocessing/external_preprocessor.py` 수정 | 2 | `--flat`, `--max_per_class` 옵션 추가 |

기존 코드 재사용 (수정 없음):
- `ai/dataset/dataset.py` — `ExternalFacialDataset`, `AihubFacialDataset` 그대로 사용
- `ai/testing/evaluate.py` — DS15도 동일 (num_classes는 체크포인트에서 자동 복원)
- `ai/training/classifier/train.py` — DS14 혼합 학습 그대로 사용

---

## 5. Colab 노트북 계획

| 노트북 | Phase | 내용 |
|--------|-------|------|
| `train_mixed.ipynb` (경로 수정) | 4 | `EXTRA_DATA_DIR` → `data/processed/dermnet` 반영 |
| `train_ds15_baseline.ipynb` (신규) | 1 | DS15 단독 baseline 학습 |
| `train_ds15_mixed.ipynb` (신규) | 3 | DS15 + ISIC 2019 혼합 학습 |

---

## 6. 실행 우선순위

| 순위 | 항목 | 상태 | 선행 조건 |
|------|------|------|----------|
| 1 | `config_15.py` + `train_15.py` 작성 | 🔴 미작성 | 없음 |
| 2 | DS15 baseline 학습 (Phase 1) | 🔴 대기 | 위 완료 |
| 3 | `external_preprocessor.py` `--flat` 수정 + `isic2019_class_map.json` | 🔴 미작성 | 없음 |
| 4 | ISIC 2019 전처리 (Phase 2) | 🔴 대기 | 위 완료 |
| 5 | DS14 DermNet 혼합 학습 (Phase 4) | 🟡 경로 수정만 필요 | `train_mixed.ipynb` 경로 수정 |
| 6 | DS15 ISIC 혼합 학습 (Phase 3) | 🔴 대기 | Phase 1·2 완료 |
| 7 | HAM10000 보조 활용 | 🔴 보류 | Phase 3 성능 미달 시 검토 |

---

## 관련 문서

- [part5_multisource_training.md](part5_multisource_training.md) — 외부 데이터셋 전략 및 DermNet 매핑 검증
- [data-dataset-15-memoized-starlight.md](data-dataset-15-memoized-starlight.md) — DS15 전처리·아키텍처 설계
