# 파트 7 — 혼합 학습 모델 통합 기획안

> 작성일: 2026-05-06
> 기준: DS14_mixed (50 epoch 완료), DS15_mixed (100 epoch 완료) 기준
> 목표: 두 모델을 단일 통합 모델로 재학습 → Flask 서버 단일 엔드포인트로 서빙

---

## 1. 현재 혼합 학습 모델 결과 요약

### 1-A. DS14_mixed — 6종 안면부 피부질환 모델

| 항목 | 내용 |
|------|------|
| 모델 | DenseNet121 (ImageNet pretrained) |
| 학습 데이터 | AI Hub DS14 합성 9,600장 + DermNet NZ 실제 임상 3종 |
| 외부 데이터 매핑 | 건선·아토피피부염·여드름 (3/6종) |
| 샘플링 전략 | WeightedRandomSampler (AI Hub×1.0, DermNet×1.5) |
| 학습 에폭 | 50 epoch, best_epoch=40 |
| AI Hub val Top-1 | **91.50%** (baseline 92.27% 대비 -0.77%p) |
| DermNet test Top-1 | **82.30%** (baseline 35.77% → **+46.53%p**) |
| 실사 테스트 | **86.7%** (3종 × 10장 = 30장, Flask /predict) |
| 핵심 성과 | 여드름 Recall 5.1% → 92.6% — 합성·실제 도메인 갭 완전 해소 |
| 체크포인트 | `ai/results/DS14_mixed/checkpoint/best.pth` |

**DS14_mixed 클래스별 성능 (DermNet test, 실사 검증 3종):**

| 클래스 | Recall | DermNet F1 | DermNet AUC |
|--------|--------|------------|-------------|
| 건선 | 0.807 | 0.768 | 0.922 |
| 아토피피부염 | 0.762 | 0.794 | 0.925 |
| 여드름 | 0.926 | 0.928 | 0.991 |

---

### 1-B. DS15_mixed — 15종 피부 종양·병변 모델

| 항목 | 내용 |
|------|------|
| 모델 | DenseNet121 (ImageNet pretrained) |
| 학습 데이터 | AI Hub DS15 합성 12,000장 + ISIC 2019 실제 임상 11,569장 |
| 외부 데이터 매핑 | 8/15종 (광선각화증·기저세포암·멜라닌세포모반·악성흑색종·지루각화증·편평세포암·피부섬유종·혈관종) |
| 샘플링 전략 | WeightedRandomSampler (AI Hub×1.0, ISIC×1.5) |
| 학습 에폭 | 100 epoch, best_epoch=96 |
| AI Hub val Top-1 | **99.67%** (baseline 99.93% 대비 -0.26%p) |
| ISIC val Top-1 | **77.72%** (baseline 26.40% → **+51.32%p**) |
| ISIC val Weighted F1 | **0.7764** (8종 기준 실질 지표) |
| 실사 테스트 | **79.2%** (8종 × 15장 = 120장, Flask /predict) |
| 핵심 성과 | 합성 전용 DS15 모델의 실사 도메인 갭을 51%p 이상 해소 |
| 체크포인트 | `ai/results/DS15_mixed/checkpoint/best.pth` |

**DS15_mixed 클래스별 성능 (ISIC val, 실사 검증 8종):**

| 클래스 | Recall | F1 | AUC | Support |
|--------|--------|----|-----|---------|
| 기저세포암 | 0.873 | 0.867 | 0.980 | 450 |
| 멜라닌세포모반 | 0.827 | 0.791 | 0.947 | 450 |
| 악성흑색종 | 0.742 | 0.751 | 0.933 | 450 |
| 지루각화증 | 0.734 | 0.754 | 0.940 | 394 |
| 광선각화증 | 0.661 | 0.669 | 0.943 | 130 |
| 편평세포암 | 0.585 | 0.625 | 0.970 | 94 |
| 혈관종 | 0.789 | 0.833 | 0.982 | 38 |
| 피부섬유종 | 0.778 | 0.767 | 0.997 | 36 |

---

### 1-C. 외부 데이터 매핑 현황

| 클래스 | 소스 | 외부 데이터 | 실사 검증 |
|--------|------|------------|---------|
| 건선 | DS14 | DermNet NZ | ✅ |
| 아토피피부염 | DS14 | DermNet NZ | ✅ |
| 여드름 | DS14 | DermNet NZ | ✅ |
| 주사 | DS14 | 없음 | ❌ |
| 지루피부염 | DS14 | 없음 | ❌ |
| 정상 | DS14 | 없음 | ❌ |
| 광선각화증 | DS15 | ISIC 2019 | ✅ |
| 기저세포암 | DS15 | ISIC 2019 | ✅ |
| 멜라닌세포모반 | DS15 | ISIC 2019 | ✅ |
| 악성흑색종 | DS15 | ISIC 2019 | ✅ |
| 지루각화증 | DS15 | ISIC 2019 | ✅ |
| 편평세포암 | DS15 | ISIC 2019 | ✅ |
| 피부섬유종 | DS15 | ISIC 2019 | ✅ |
| 혈관종 | DS15 | ISIC 2019 | ✅ |
| 보웬병 | DS15 | 없음 | ❌ |
| 비립종 | DS15 | 없음 | ❌ |
| 사마귀 | DS15 | 없음 | ❌ |
| 표피낭종 | DS15 | 없음 | ❌ |
| 피지샘증식증 | DS15 | 없음 | ❌ |
| 화농 육아종 | DS15 | 없음 | ❌ |
| 흑색점 | DS15 | 없음 | ❌ |

---

## 2. 라벨 재매핑 필요 여부

> **결론: 수동 어노테이션 불필요 — CSV 재인덱싱(자동)만 필요**

### 왜 재인덱싱이 필요한가

현재 DS15의 class_idx는 0~14 (15종 연속 정수). 외부 검증 클래스 11종만 선택하면
class_idx가 `{0,1,2,6,7,8,10,12}` 처럼 비연속이 된다.
PyTorch `CrossEntropyLoss`는 타깃이 0~(N-1) 범위의 연속 정수여야 하므로
소프트맥스 레이어(`num_classes=11`)와 맞지 않아 오류가 발생한다.

### 재인덱싱 방법 (수동 작업 없음)

```
1. unified_class_idx_map.json 작성 (11종 → idx 0~10)
2. DS14 train/val.csv: 건선(0)·아토피(1)·여드름(2) 행만 남기고 idx 그대로 유지
3. DS15 train/val.csv: 8종 행만 남기고 idx 재매핑
   (광선각화증 0→3, 기저세포암 1→4, 멜라닌세포모반 2→5,
    악성흑색종 6→6, 지루각화증 7→7, 편평세포암 8→8,
    피부섬유종 10→9, 혈관종 12→10)
4. DermNet, ISIC CSV도 동일하게 재인덱싱
5. 재학습: train.py --num_classes 11
```

실제로는 `df[df.class_name.isin(TARGET_CLASSES)]` + `df.class_idx.map(NEW_IDX_MAP)` 두 줄로 처리 가능.

---

## 3. HAM10000 활용 가능성 분석

HAM10000 (10,015장, 7종)은 ISIC 2019와 클래스가 완전히 겹친다.
**새 클래스 추가는 불가**하지만, **기존 8종의 실사 데이터 보강**에 유용하다.

| HAM10000 클래스 | 장수 | DS15 매핑 클래스 | ISIC val support | 기대 효과 |
|----------------|------|-----------------|-----------------|----------|
| nv (멜라닌세포모반) | 6,705 | 멜라닌세포모반 | 450 | 대규모 보강 |
| mel (악성흑색종) | 1,113 | 악성흑색종 | 450 | 보강 |
| bkl (지루각화증) | 1,099 | 지루각화증 | 394 | 보강 |
| bcc (기저세포암) | 514 | 기저세포암 | 450 | 보강 |
| akiec (광선각화증) | 327 | 광선각화증 | 130 | **소수 클래스 보강 ↑** |
| vasc (혈관종) | 142 | 혈관종 | 38 | **소수 클래스 보강 ↑↑** |
| df (피부섬유종) | 115 | 피부섬유종 | 36 | **소수 클래스 보강 ↑↑** |

> **HAM10000에는 편평세포암(SCC) 없음** → ISIC val recall 0.585 문제는 HAM10000으로 해결 불가.
> 미매핑 DS15 7종(보웬병·비립종·사마귀·표피낭종·피지샘증식증·화농 육아종·흑색점)도 HAM10000에 없음.

**권장**: HAM10000을 3번째 외부 소스로 추가 (external_weight=1.5).
피부섬유종(+115)·혈관종(+142)·광선각화증(+327) 소수 클래스의 recall 향상 기대.

---

## 4. 통합 모델 기획

### 4.1 통합 클래스셋 (11종 — 외부 검증 클래스 우선)

| idx | 클래스 | 소스 | 외부 데이터 |
|-----|--------|------|------------|
| 0 | 건선 | DS14 | DermNet NZ |
| 1 | 아토피피부염 | DS14 | DermNet NZ |
| 2 | 여드름 | DS14 | DermNet NZ |
| 3 | 광선각화증 | DS15 | ISIC 2019 + HAM10000 |
| 4 | 기저세포암 | DS15 | ISIC 2019 + HAM10000 |
| 5 | 멜라닌세포모반 | DS15 | ISIC 2019 + HAM10000 |
| 6 | 악성흑색종 | DS15 | ISIC 2019 + HAM10000 |
| 7 | 지루각화증 | DS15 | ISIC 2019 + HAM10000 |
| 8 | 편평세포암 | DS15 | ISIC 2019 (HAM10000 없음) |
| 9 | 피부섬유종 | DS15 | ISIC 2019 + HAM10000 |
| 10 | 혈관종 | DS15 | ISIC 2019 + HAM10000 |

> **제외된 10종** (주사·지루피부염·정상·보웬병·비립종·사마귀·표피낭종·피지샘증식증·화농 육아종·흑색점):
> 외부 임상 데이터 없음 → 합성 이미지만으로 학습 시 도메인 갭으로 실사 추론 신뢰도 낮음.
> 추가 외부 소스 확보 후 편입.

### 4.2 데이터 구성

**unified 3-way split (DS14+DS15 통합)**

| split | 장수 | 비고 |
|-------|-----:|------|
| train.csv | 10,080 | 학습 전용 |
| val.csv | 1,400 | best epoch 선택용 (학습 중 참조) |
| test.csv | 1,120 | **홀드아웃 — 학습 중 미사용, 최종 평가 전용** |

> test.csv는 train 10%를 클래스별 층화 추출(`--test_ratio 0.1`, seed=42)로 분리했다.

**소스별 학습 데이터**

| 소스 | 장수 | 클래스 | weight |
|------|------|--------|--------|
| AI Hub DS14 | 4,320 (3종 × 1,440) | 건선·아토피·여드름 | 1.0 |
| AI Hub DS15 | 5,760 (8종 × 720) | ISIC 매핑 8종 | 1.0 |
| DermNet NZ | ~3,000 | 건선·아토피·여드름 | 1.5 |
| ISIC 2019 | ~11,569 (8종) | ISIC 매핑 8종 | 1.5 |
| HAM10000 | ~5,363 (7종, max 3,000/class) | ISIC 매핑 7종 (SCC 제외) | 1.5 |

### 4.3 학습 설정

| 항목 | 값 |
|------|----|
| backbone | densenet121 |
| num_classes | 11 |
| num_epochs | 100 |
| batch_size | 64 |
| learning_rate | 0.0005 |
| weight_decay | 1e-3 |
| dropout_rate | 0.55 |
| label_smoothing | 0.1 |
| external_weight | 1.5 |
| scheduler | CosineAnnealingLR |
| warmup_epochs | 3 |

### 4.4 데이터 준비 명령어

```bash
# 1단계: 통합 CSV 생성 (DS14 + DS15 필터링·재인덱싱 + 3-way split)
python -m ai.dataset.build_unified_dataset \
    --ds14_dir data/processed/DS14 \
    --ds15_dir data/processed/DS15 \
    --class_map ai/preprocessing/class_maps/unified_class_idx_map.json \
    --output_dir data/processed/unified \
    --test_ratio 0.1

# 2단계: HAM10000 전처리 (unified idx 기준)
python -m ai.preprocessing.external_preprocessor \
    --root_dir data/HAM10000 \
    --output_dir data/processed/ham10000 \
    --source ham10000 \
    --class_map_file ai/preprocessing/class_maps/ham10000_class_map.json \
    --class_idx_map_file ai/preprocessing/class_maps/unified_class_idx_map.json \
    --metadata_csv data/HAM10000/HAM10000_metadata.csv \
    --max_per_class 3000

# 3단계: 외부 이미지 → ZIP 변환 (Drive I/O 병목 해소 — 에폭당 22분 → 1~2분)
# Google Drive에서 파일 수만 개를 개별 읽는 병목을 ZIP 단일 파일 읽기로 해소
python -m ai.preprocessing.pack_external_to_zip \
    --processed_dir data/processed/dermnet \
    --image_base data/dermnet \
    --zip_out data/dermnet.zip

python -m ai.preprocessing.pack_external_to_zip \
    --processed_dir data/processed/isic2019 \
    --image_base "data/ISIC 2019" \
    --zip_out data/isic2019.zip

python -m ai.preprocessing.pack_external_to_zip \
    --processed_dir data/processed/ham10000 \
    --image_base data/HAM10000 \
    --zip_out data/ham10000.zip
```

**ZIP 변환 결과** (무압축 ZIP_STORED, 1회 실행 완료):

| ZIP 파일 | 이미지 수 | 크기 |
|---------|------:|----:|
| `data/dermnet.zip` | 5,065장 | 0.48GB |
| `data/isic2019.zip` | 13,611장 | 5.63GB |
| `data/ham10000.zip` | 6,310장 | 1.75GB |

> CSV도 `image_path` → `zip_path` + `filename` 형식으로 자동 재생성됨.
> `ExternalFacialDataset`이 컬럼을 자동 감지해 ZIP/파일 읽기 방식을 분기하므로 하위 호환 유지.

**Drive 업로드 대상:**

| 항목 | 비고 |
|------|------|
| `data/dermnet.zip` | 신규 |
| `data/isic2019.zip` | 신규 |
| `data/ham10000.zip` | 신규 |
| `data/processed/dermnet/` | CSV 재생성 (zip_path 형식) |
| `data/processed/isic2019/` | CSV 재생성 |
| `data/processed/ham10000/` | CSV 재생성 |

### 4.5 학습 명령어 (Colab)

```bash
python -m ai.training.classifier.train \
    --data_dir data/processed/unified \
    --extra_data_dir data/processed/dermnet data/processed/isic2019 data/processed/ham10000 \
    --num_classes 11 \
    --num_epochs 100 \
    --external_weight 1.5 \
    --checkpoint_dir ai/results/DS_unified/checkpoint
```

### 4.6 평가 계획

```bash
# unified val (DS14 + DS15 11종 — best epoch 확인용)
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS_unified/checkpoint/best.pth \
    --data_dir data/processed/unified \
    --split val \
    --output_dir ai/results/DS_unified/eval_unified_val

# unified test (train 10% 홀드아웃 — 합성 도메인 진짜 성능)
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS_unified/checkpoint/best.pth \
    --data_dir data/processed/unified \
    --split test \
    --output_dir ai/results/DS_unified/eval_unified_test

# DermNet test (건선·아토피·여드름 실사 검증)
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS_unified/checkpoint/best.pth \
    --data_dir data/processed/dermnet \
    --split test \
    --output_dir ai/results/DS_unified/eval_dermnet_test

# ISIC val (8종 실사 검증)
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS_unified/checkpoint/best.pth \
    --data_dir data/processed/isic2019 \
    --split val \
    --output_dir ai/results/DS_unified/eval_isic_val

# HAM10000 test (7종 실사 검증)
python -m ai.testing.evaluate \
    --checkpoint ai/results/DS_unified/checkpoint/best.pth \
    --data_dir data/processed/ham10000 \
    --split test \
    --output_dir ai/results/DS_unified/eval_ham10000_test
```

### 4.7 Flask 업데이트

학습 완료 후 `ai/inference/.env` 한 줄만 변경:

```
MODEL_PATH=ai/results/DS_unified/checkpoint/best.pth
```

클래스명은 체크포인트 `config.class_names`에서 자동 복원 (app.py 코드 수정 불필요).

---

## 5. 실행 우선순위

| 단계 | 작업 | 상태 |
|------|------|------|
| 1 | `ai/preprocessing/class_maps/unified_class_idx_map.json` 작성 (11종 → 0~10) | 🟢 완료 |
| 2 | `ai/preprocessing/class_maps/ham10000_class_map.json` 작성 | 🟢 완료 |
| 3 | `ai/dataset/build_unified_dataset.py` 작성 + 3-way split CSV 생성 (train 10,080 / val 1,400 / test 1,120) | 🟢 완료 |
| 4 | HAM10000 전처리 실행 (`external_preprocessor.py --metadata_csv`) | 🟢 완료 |
| 5 | `train_unified.ipynb` Colab 노트북 작성 (DermNet + ISIC + HAM10000 포함) | 🟢 완료 |
| 5-B | 외부 이미지 ZIP 변환 (`pack_external_to_zip.py`) + `ExternalFacialDataset` ZIP 읽기 지원 추가 | 🟢 완료 |
| 6 | ZIP + CSV Drive 업로드 후 Colab 통합 학습 실행 (100 epoch) | 🔴 미완료 |
| 7 | 5개 평가 세트로 evaluate.py 실행 (unified val·test, DermNet, ISIC, HAM10000) | 🔴 미완료 |
| 8 | Flask .env 업데이트 및 실사 테스트 (11종 × 10~15장) | 🔴 미완료 |
| 9 | `DS_unified_report.md` 결과 보고서 작성 | 🔴 미완료 |

---

## 6. 성능 미달 시 대응 방안

> 기준: unified val Top-1 < 85% 또는 외부 실사 성능이 DS14_mixed·DS15_mixed 기준선 하회 시

### 6.1 1순위 — num_workers 증가 (I/O 병목 해소)

외부 이미지(DermNet·ISIC·HAM10000) 20,305장은 ZIP이 아닌 디스크 파일로 읽힌다.
GPU가 한 배치를 연산하는 동안 다음 배치를 미리 읽지 못하면 GPU가 대기 상태가 된다.
num_workers를 늘리면 병렬 프리패치로 GPU 활용률이 올라간다.

**적용 방법** (노트북 학습 셀 환경변수 추가):

```bash
NUM_WORKERS=16 \
EXTRA_DATA_DIR="data/processed/dermnet data/processed/isic2019 data/processed/ham10000" \
...
python -m ai.training.classifier.train --backbone densenet121 ...
```

**확인 기준**: `nvidia-smi`의 GPU-Util이 학습 중 12% 수준에 머물면 I/O 병목 → num_workers 증가 효과 있음

### 6.2 2순위 — EfficientNet-B3 교체

DenseNet121 대비 파라미터는 비슷하지만 ImageNet 기준 성능이 높다.

| 모델 | 파라미터 | ImageNet Top-1 |
|------|-----:|-----:|
| DenseNet121 | 7M | 74.4% |
| EfficientNet-B3 | 10M | 82.2% |
| ResNet152 | 58M | 82.0% |

EfficientNet-B3은 ResNet152와 동등한 성능에 파라미터는 1/6 수준이다.
`model.py`에 이미 구현돼 있어 `--backbone` 한 줄 변경으로 교체 가능하다.

```bash
python -m ai.training.classifier.train --backbone efficientnet_b3 ...
```

**주의**: 배치 사이즈를 늘리면 오히려 성능 저하 발생 가능 (sharp minima 수렴). 현재 batch=64 유지 권장.

---

## 7. 후속 과제

| 항목 | 내용 |
|------|------|
| 편평세포암 추가 데이터 | HAM10000에 SCC 없음 → Derm7pt 또는 추가 ISIC 확보 시 보강 |
| 미매핑 10종 | 주사·지루피부염·보웬병 등은 HAM10000에도 없음 — DermNet-17 등 다른 소스 필요 |
| 세그멘테이션 통합 | DeepLabV3+ 아토피 세그멘테이션 모델과 분류 모델 앙상블 검토 |
