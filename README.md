# SkinAI

AI 기반 안면 피부 질환 분류 의료 보조 서비스.

6개 클래스(건선, 아토피피부염, 여드름, 주사, 지루피부염, 정상)를 AI Hub 08-14 합성 데이터셋으로 학습한 DenseNet121 모델 기반.

---

## 프로젝트 구조

```
skin_ai/
├── ai/                       # AI 핵심 모듈
│   ├── dataset/              #   데이터셋 클래스 (PyTorch Dataset)
│   │   └── dataset.py        #     AihubFacialDataset, AihubSegDataset, CLASS_MAP, get_transforms
│   ├── preprocessing/        #   전처리 파이프라인
│   │   ├── aihub_preprocessor.py #   전처리 메인 (AIHubPreprocessor)
│   │   ├── resize_zips.py    #     1,024px ZIP → 지정 크기 JPEG ZIP 변환
│   │   ├── aihub_validate.py #     데이터 검증
│   │   └── aihub_eda.py      #     EDA 시각화
│   ├── training/             #   모델 학습
│   │   ├── classifier/       #     분류 + 세그멘테이션 학습
│   │   │   ├── config.py     #       ClassifyConfig, SegmentConfig (환경변수 지원)
│   │   │   ├── model.py      #       build_classifier(), build_segmentor()
│   │   │   ├── train.py      #       DenseNet121/EfficientNet-B3 분류 학습
│   │   │   └── train_seg.py  #       DeeplabV3+ 세그멘테이션 학습 (아토피 전용)
│   │   └── utils.py          #     공유 유틸리티 (get_device, topk_accuracy)
│   ├── testing/              #   평가 + 임계값 최적화
│   │   ├── evaluate.py       #     Top-1/3, F1, AUC, Confusion Matrix, ROC
│   │   └── threshold_opt.py  #     클래스별 confidence threshold 최적화
│   ├── inference/            #   Flask 추론 API (port 5001)
│   │   └── app.py            #     /predict (Grad-CAM), /health, /classes
│   └── results/              #   모델 체크포인트 + 학습 로그 (gitignored)
│                             #     best.pth, epoch_N.pth, training_log.json, loss_curve.png
│
├── skinai_data/              # Google Drive DataLoader 패키지
│   ├── scripts/              #   Drive 관리 스크립트
│   │   ├── build_manifest.py #     Drive 탐색 → manifest_zips.csv 생성
│   │   ├── download_dataset.py #   ZIP 다운로드 (--save-zip / 압축 해제)
│   │   ├── upload_to_drive.py  #   [PM 전용] 로컬 데이터 → Drive 업로드
│   │   └── manifest_zips.csv #     Drive ZIP 파일 목록 (git 추적)
│   ├── auth.py               #   Drive API 인증
│   ├── manifest.py           #   manifest CSV 로드
│   ├── dataset.py            #   Drive 스트리밍 Dataset
│   └── loader.py             #   DataLoader 래퍼
│
├── skinai_docs/              # 기획 문서
│
├── backend/                  # Node.js / Express (port 3000)
├── frontend/                 # Vanilla JS / HTML / CSS
├── scin_legacy/              # 레거시 SCIN ResNet50 (유지만)
│
├── data/                     # 데이터 (대부분 gitignored)
│   ├── dataset_14/           #   AI Hub 08-14 ZIP 원본 (gitignored)
│   │   ├── Training/
│   │   │   ├── 01_raw/       #     TS_{클래스}_{방향}.zip × 12
│   │   │   └── 02_label/     #     TL_{클래스}_{방향}.zip × 12
│   │   └── Validation/
│   │       ├── 01_raw/       #     VS_{클래스}_{방향}.zip × 12
│   │       └── 02_label/     #     VL_{클래스}_{방향}.zip × 12
│   ├── dataset_15/           #   AI Hub 08-15 ZIP 원본 (gitignored)
│   │   ├── Training/
│   │   │   ├── 01_raw/       #     TS_{클래스}.zip × 15 (광선각화증 등)
│   │   │   └── 02_label/     #     TL_{클래스}.zip × 15
│   │   └── Validation/
│   │       ├── 01_raw/       #     VS_{클래스}.zip × 15
│   │       └── 02_label/     #     VL_{클래스}.zip × 15
│   ├── raw/                  #   ZIP 압축 해제 원본 (gitignored, Drive 경유)
│   └── processed/            #   전처리 결과 (git 추적)
│       ├── DS14/             #     dataset_14 전처리 결과
│       │   ├── train.csv     #       학습 CSV
│       │   ├── val.csv       #       검증 CSV
│       │   ├── metadata.json #       클래스·통계 메타데이터
│       │   ├── validation_report.json
│       │   └── eda/          #       EDA 시각화 결과
│       └── DS15/             #     dataset_15 전처리 결과
│           ├── train.csv
│           ├── val.csv
│           ├── metadata.json
│           └── validation_report.json
│
├── train.ipynb               # Colab / 로컬 학습 노트북
└── setup.py                  # skinai-data pip 패키지 정의
```

---

## 서비스 구성

| 서비스 | 기술 스택 | 포트 |
|--------|-----------|------|
| Backend | Node.js / Express | 3000 |
| AI Service | Python / Flask + PyTorch | 5001 |
| Frontend | Vanilla JS / HTML / CSS | (백엔드 서빙) |

```
Browser → Frontend → Express (:3000) → Flask AI (:5001)
```

---

## 개발 환경 설정

### Backend

```bash
cd backend && npm install && npm start   # port 3000
```

### Flask AI 서비스

```bash
cd ai/inference
pip install -r requirements.txt
python app.py          # 개발 (port 5001)
```

### skinai-data 패키지 설치

```bash
pip install -e .
```

---

## 데이터 파이프라인

### 1. Drive 인증 (최초 1회)

```bash
python -m skinai_data.auth
```

### 2. ZIP 다운로드

```bash
# 방법 A — ZIP 그대로 저장 (전처리기 직접 호환, 권장)
python skinai_data/scripts/download_dataset.py --save-zip --include-labels --resume

# 방법 B — 압축 해제하여 PNG 저장
python skinai_data/scripts/download_dataset.py --resume
```

자세한 설명: [skinai_data/scripts/README.md](skinai_data/scripts/README.md)

### 3. 사전 리사이즈 (선택, I/O 최적화)

원본 1,024px PNG → 256px JPEG 변환. 9.78GB → 약 2GB, 로딩 속도 3~5배 향상.

```bash
python -m ai.preprocessing.resize_zips --resume
```

건너뛰면 원본 ZIP으로 학습하며, 그 경우 아래 전처리 명령에서 `--data_root data/dataset_14` 사용.

### 4. 전처리 (CSV 생성)

```bash
# dataset_14 원본 사용 시
python -m ai.preprocessing.aihub_preprocessor --data_root data/dataset_14 --output_dir data/processed/DS14

# dataset_15 원본 사용 시
python -m ai.preprocessing.aihub_preprocessor --data_root data/dataset_15 --output_dir data/processed/DS15

# 리사이즈 변환본 사용 시
python -m ai.preprocessing.aihub_preprocessor --data_root data/dataset_256 --output_dir data/processed/DS14

# 검증 및 EDA
python -m ai.preprocessing.aihub_validate --processed_dir data/processed/DS14
python -m ai.preprocessing.aihub_eda --processed_dir data/processed/DS14
```

### 5. 학습

```bash
# DenseNet121 분류 (기본)
python -m ai.training.classifier.train

# EfficientNet-B3 비교
python -m ai.training.classifier.train --backbone efficientnet_b3

# 체크포인트에서 이어서 학습 (Colab 세션 만료 후 재개)
python -m ai.training.classifier.train --resume ai/results/epoch_N.pth

# Colab 환경 (경로 재매핑)
python -m ai.training.classifier.train --root_dir /content/skin_ai

# 세그멘테이션 (아토피 전용, DeeplabV3+)
python -m ai.training.classifier.train_seg
```

#### 학습 환경변수

| 환경변수 | 기본값 | 설명 |
|---------|--------|------|
| `BACKBONE` | densenet121 | 모델 backbone |
| `BATCH_SIZE` | 64 | 배치 크기 |
| `LEARNING_RATE` | 0.0005 | 학습률 |
| `NUM_EPOCHS` | 30 | 최대 에폭 |
| `NUM_WORKERS` | 4 | DataLoader 워커 수 |
| `WARMUP_EPOCHS` | 3 | LR warmup 에폭 |
| `EARLY_STOPPING_PATIENCE` | 30 | 조기 종료 patience |
| `DATA_DIR` | data/processed/DS14 | 전처리 CSV 디렉토리 |
| `CHECKPOINT_DIR` | ai/results | 체크포인트 저장 경로 |
| `IMAGE_SIZE` | 256 | 리사이즈 크기 |
| `CROP_SIZE` | 224 | 크롭 크기 |
| `DROPOUT_RATE` | 0.5 | Dropout 비율 |
| `WEIGHT_DECAY` | 1e-3 | L2 정규화 |
| `DEVICE` | auto | 디바이스 (auto/cuda/mps/cpu) |

### 6. 평가

```bash
python -m ai.testing.evaluate \
    --checkpoint ai/results/best.pth
python -m ai.testing.threshold_opt \
    --checkpoint ai/results/best.pth
```

---

## 클래스 정의

| class_idx | 클래스 | 영문 |
|-----------|--------|------|
| 0 | 건선 | Psoriasis |
| 1 | 아토피피부염 | Atopic Dermatitis |
| 2 | 여드름 | Acne |
| 3 | 주사 | Rosacea |
| 4 | 지루피부염 | Seborrheic Dermatitis |
| 5 | 정상 | Normal |

---

## 현재 제한사항

- 인메모리 저장소: 게시판 데이터 재시작 시 초기화 (PostgreSQL 마이그레이션 예정)
- 체크포인트 미포함: `.pth` 파일은 gitignore — 별도 학습 필요
- 학습 데이터 미포함: AI Hub 라이선스로 인해 별도 신청 필요
