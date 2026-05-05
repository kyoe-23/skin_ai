# 코드 수정 내역 (2026-04-29)

DS15(15클래스) 학습 완료 후 평가 실패 원인 분석 및 데이터셋 독립적 구조로의 전환을 위한 수정.

---

## 배경 및 동기

DS14(6클래스)에서 DS15(15클래스)로 데이터셋을 전환하면서 다음 두 가지 문제가 동시에 발생했다.

1. **평가 스크립트 실패**: `evaluate.py` 및 `threshold_opt.py` 실행 시 `RuntimeError: size mismatch` — 체크포인트에는 15클래스 가중치가 저장되어 있으나, 스크립트가 모델을 6클래스로 초기화했기 때문
2. **하드코딩 구조**: `NUM_CLASSES = 6` 상수가 모델 아키텍처를 결정하는 구조였기 때문에, DS14↔DS15를 코드 수정 없이 전환할 수 없었음

수정 목표: **어떤 데이터셋이든 `data_dir/metadata.json`만 있으면 클래스 수/이름이 자동으로 설정되는 데이터셋 독립적(agnostic) 구조**로 전환.

---

## 수정 파일 목록

| 파일 | 수정 유형 | 핵심 변경 |
|------|-----------|-----------|
| `ai/training/classifier/config.py` | 기능 추가 | `load_from_metadata()` 메서드, `label_smoothing` 필드 추가 |
| `ai/training/classifier/model.py` | 버그 수정 | `NUM_CLASSES` 상수 → `config.num_classes` 필드 참조 |
| `ai/training/classifier/train.py` | 기능 추가 + 버그 수정 | `--data_dir`/`--num_classes` CLI 인자, `started_at` 타이밍 수정, `label_smoothing` 설정화 |
| `ai/testing/evaluate.py` | 버그 수정 | 체크포인트에서 `num_classes`/`data_dir` 복원 후 모델 초기화 |
| `ai/testing/threshold_opt.py` | 버그 수정 | 동일한 체크포인트 복원 수정 + `IDX_TO_CLASS` 하드코딩 제거 |

---

## 1. `ai/training/classifier/config.py`

### 변경 1-A: `import json`, `from pathlib import Path` 추가

**이유**: 새로 추가한 `load_from_metadata()` 메서드에서 JSON 파일을 읽기 위해 필요.

```python
# BEFORE
import os
import sys
from dataclasses import dataclass, field

# AFTER
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
```

---

### 변경 1-B: `label_smoothing` 필드 추가

**이유**: `train.py`에서 `nn.CrossEntropyLoss(label_smoothing=0.1)`으로 하드코딩되어 있었으나 config에 없어서 training_log.json에도 기록되지 않았다. 재현성 및 추적을 위해 config 필드로 관리.

```python
# BEFORE
# label_smoothing 필드 없음
# train.py에서: nn.CrossEntropyLoss(label_smoothing=0.1)  # 하드코딩

# AFTER (config.py 내 ClassifyConfig에 추가)
# ── 손실 함수 ────────────────────────────────────────────────
label_smoothing: float = field(default_factory=lambda: _env_float("LABEL_SMOOTHING", 0.1))
```

---

### 변경 1-C: `load_from_metadata()` 메서드 추가

**이유**: `NUM_CLASSES = 6`이 DS14 전용 상수로 하드코딩되어 있어 DS15(15클래스) 전환 시 코드 수정이 필요했다. `data_dir/metadata.json`에서 `num_classes`와 `class_names`를 자동 로드하면 어떤 데이터셋이든 대응 가능.

```python
# BEFORE
# 메서드 없음. config.num_classes = NUM_CLASSES = 6 고정.

# AFTER
def load_from_metadata(self) -> None:
    """data_dir/metadata.json에서 num_classes, class_names를 자동 로드."""
    meta_path = Path(self.data_dir) / "metadata.json"
    if not meta_path.exists():
        return
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    if "num_classes" in meta:
        self.num_classes = meta["num_classes"]
    if "class_map" in meta:
        self.class_names = sorted(
            meta["class_map"], key=lambda k: meta["class_map"][k]
        )
```

**참고**: `NUM_CLASSES = 6`, `CLASS_NAMES` 상수는 다른 모듈이 import할 수 있으므로 삭제하지 않고 유지. 단, 이 상수들은 더 이상 모델 아키텍처를 결정하지 않는다.

---

## 2. `ai/training/classifier/model.py`

### 변경 2-A: `NUM_CLASSES` 상수 → `config.num_classes` 필드

**이유**: `build_classifier(config)`가 `config`를 인자로 받으면서도 모델의 출력 차원을 `NUM_CLASSES = 6` 상수로 결정하고 있었다. DS15 체크포인트(15클래스)를 로드할 때 size mismatch가 발생하는 근본 원인.

```python
# BEFORE — DenseNet121 branch
model.classifier = nn.Sequential(
    nn.Dropout(config.dropout_rate),
    nn.Linear(in_features, NUM_CLASSES),   # 항상 6
)

# BEFORE — EfficientNet-B3 branch
model.classifier = nn.Sequential(
    nn.Dropout(config.dropout_rate),
    nn.Linear(in_features, NUM_CLASSES),   # 항상 6
)

# AFTER — 두 branch 모두 동일하게 수정
model.classifier = nn.Sequential(
    nn.Dropout(config.dropout_rate),
    nn.Linear(in_features, config.num_classes),   # config에서 동적 결정
)
```

---

## 3. `ai/training/classifier/train.py`

### 변경 3-A: `--data_dir`, `--num_classes` CLI 인자 추가

**이유**: Colab에서 `--data_dir data/processed_15 --num_classes 15`를 전달하는 셀이 이미 존재했으나, 기존 `_parse_args()`에 해당 인자가 정의되어 있지 않아 무시되었다. CLI로 데이터셋 경로와 클래스 수를 명시할 수 있어야 함.

```python
# BEFORE — _parse_args()에 해당 인자 없음

# AFTER
parser.add_argument("--data_dir", default=None, help="데이터셋 CSV 경로 (기본: config 값)")
parser.add_argument("--num_classes", type=int, default=None, help="클래스 수 (기본: metadata.json 자동 감지)")
```

```python
# AFTER — _apply_cli_overrides()에 처리 추가
if args.data_dir is not None:
    config.data_dir = args.data_dir
if args.num_classes is not None:
    config.num_classes = args.num_classes
```

---

### 변경 3-B: `config.load_from_metadata()` 호출 추가

**이유**: CLI 오버라이드 후 `data_dir`이 확정된 시점에서 metadata.json을 읽어 `num_classes`와 `class_names`를 자동 설정해야 한다.

```python
# BEFORE — main()에서 load_from_metadata 호출 없음

# AFTER
args = _parse_args()
config = ClassifyConfig()
_apply_cli_overrides(config, args)
config.load_from_metadata()   # data_dir/metadata.json → num_classes, class_names 자동 설정
```

---

### 변경 3-C: `started_at` 타이밍 버그 수정

**이유**: 기존 코드에서 `started_at`이 training_log.json을 저장할 때(학습 완료 후) `datetime.now()`를 호출했기 때문에 실제 학습 시작 시각이 아닌 로그 저장 시각이 기록되었다.

```python
# BEFORE — 학습 완료 후 log 저장 시점에 기록
training_log = {
    ...
    "started_at": datetime.now().isoformat(),  # 학습 완료 시각 (버그)
    ...
}

# AFTER — main() 맨 첫 줄에서 시각 캡처
def main():
    logging.basicConfig(...)
    started_at = datetime.now().isoformat()   # 실제 학습 시작 시각
    ...
    training_log = {
        ...
        "started_at": started_at,   # 올바른 시작 시각
        ...
    }
```

---

### 변경 3-D: `label_smoothing` 하드코딩 제거

**이유**: `nn.CrossEntropyLoss(label_smoothing=0.1)`으로 하드코딩되어 있어 training_log.json에 기록되지 않았고 환경변수로도 조정할 수 없었다.

```python
# BEFORE
criterion = nn.CrossEntropyLoss(label_smoothing=0.1)

# AFTER
criterion = nn.CrossEntropyLoss(label_smoothing=config.label_smoothing)
# config.label_smoothing 기본값 0.1, 환경변수 LABEL_SMOOTHING으로 오버라이드 가능
```

---

## 4. `ai/testing/evaluate.py`

### 변경 4-A: 체크포인트에서 `num_classes`/`data_dir` 복원

**이유**: `build_classifier(config)` 호출 전 `config.num_classes`가 여전히 기본값 6이었기 때문에 15클래스 체크포인트 로드 시 `RuntimeError: size mismatch` 발생.

에러 메시지:
```
RuntimeError: Error(s) in loading state_dict for DenseNet:
    size mismatch for classifier.1.weight: copying a param with shape torch.Size([15, 1024])
    from checkpoint, the param in current model has shape torch.Size([6, 1024]).
```

```python
# BEFORE
config = ClassifyConfig()
config.backbone = ckpt_config.get("backbone", config.backbone)
if args.data_dir:
    config.data_dir = args.data_dir
model = build_classifier(config)   # config.num_classes = 6 (기본값) → 크기 불일치

# AFTER
config = ClassifyConfig()
config.backbone    = ckpt_config.get("backbone", config.backbone)
config.num_classes = ckpt_config.get("num_classes", config.num_classes)   # 체크포인트에서 복원
config.data_dir    = args.data_dir or ckpt_config.get("data_dir", config.data_dir)
config.load_from_metadata()   # class_names 자동 설정
model = build_classifier(config)   # config.num_classes = 15 → 정상 로드
```

---

## 5. `ai/testing/threshold_opt.py`

### 변경 5-A: 체크포인트에서 `num_classes`/`data_dir` 복원 (evaluate.py와 동일)

**이유**: evaluate.py와 동일한 구조적 버그. 체크포인트 로드 전 `config.num_classes`가 6으로 초기화되어 있었음.

```python
# BEFORE
config = ClassifyConfig()
config.backbone = ckpt_config.get("backbone", config.backbone)
config.num_classes = ckpt_config.get("num_classes", config.num_classes)
config.data_dir = args.data_dir or ckpt_config.get("data_dir", config.data_dir)
# load_from_metadata() 호출 없음 → class_names가 DS14 기본값으로 남아 있음

# AFTER
config = ClassifyConfig()
config.backbone    = ckpt_config.get("backbone", config.backbone)
config.num_classes = ckpt_config.get("num_classes", config.num_classes)
config.data_dir    = args.data_dir or ckpt_config.get("data_dir", config.data_dir)
config.load_from_metadata()   # class_names 자동 설정
```

---

### 변경 5-B: `IDX_TO_CLASS` 하드코딩 제거 → 동적 생성

**이유**: `IDX_TO_CLASS`는 DS14 전용 딕셔너리로 `dataset.py`에 하드코딩되어 있었다. DS15에서는 클래스명이 다르므로 threshold 적용 시 KeyError가 발생했을 것.

```python
# BEFORE — dataset.py에서 DS14 전용 상수 import
from ..dataset.dataset import AihubFacialDataset, get_transforms, worker_init_fn, IDX_TO_CLASS
...
# threshold 적용 시
pred_class = IDX_TO_CLASS[pred_idx]   # DS14 기준 하드코딩 딕셔너리

# AFTER — import에서 IDX_TO_CLASS 제거, config에서 동적 생성
from ..dataset.dataset import AihubFacialDataset, get_transforms, worker_init_fn
...
# config.class_names에서 동적으로 생성
idx_to_class = {i: name for i, name in enumerate(config.class_names)}
...
pred_class = idx_to_class[pred_idx]   # 어떤 데이터셋이든 동작
```

---

## 데이터 흐름 요약

수정 후 `data_dir`이 변경되면 자동으로 전체 파이프라인이 해당 데이터셋에 맞게 초기화된다.

```
CLI: --data_dir data/processed/DS15
        ↓
config.data_dir = "data/processed/DS15"
        ↓
config.load_from_metadata()
        → data/processed/DS15/metadata.json 읽기
        → config.num_classes = 15
        → config.class_names = ["각화증", "건선", ... (15개)]
        ↓
build_classifier(config)
        → Linear(1024, 15)  ← 정상
        ↓
체크포인트 저장: config["num_classes"] = 15 기록
        ↓
evaluate.py / threshold_opt.py 로드 시
        → ckpt_config["num_classes"] = 15 복원
        → 동일한 15클래스 모델 초기화 → 정상 로드
```

---

## 수정 후 검증

| 검증 항목 | 결과 |
|-----------|------|
| DS15 metadata.json 존재 여부 | ✅ `data/processed/DS15/metadata.json` |
| `num_classes: 15` 기록 | ✅ metadata.json 내 확인 |
| train/val 데이터 누수 | ✅ 0개 중복 파일명 (train.csv 12,000건 / val.csv 1,500건) |
| evaluate.py size mismatch 해결 | ✅ 이론적 수정 완료 (Colab 재실행으로 확인 필요) |

---

## 미완료 항목

- **Test 세트 없음**: DS15는 Train/Val 두 폴더만 존재. 구글 드라이브의 원본 ZIP(Training/)에서 640/80/80 비율로 3-way split 스크립트 작성 필요.
- **dataset.py `CLASS_MAP`**: DS14 전용 상수가 남아 있으나, AihubFacialDataset이 CSV의 `class_idx` 컬럼을 직접 사용하므로 당장은 무해. 장기적으로 정리 필요.

---

## 이후 진행 계획 (2026-05-03 기준)

### 현재 상태

| 항목 | 상태 |
|------|------|
| DS15 재학습 | 🔄 진행 중 (Colab, DenseNet121 100에폭) |
| evaluate.py 수정 | ✅ 완료 |
| threshold_opt.py 수정 | ✅ 완료 |
| Colab 노트북 정비 | ✅ 완료 (Drive 동기화 방식으로 전환) |
| Test 세트 구성 | ❌ 미착수 |

---

### 1단계 — 학습 완료 후 evaluate.py 실행 (최우선)

**목적**: Val 100% 수치가 실제인지, 특정 클래스가 약한지 확인.

**진행 방법**: Colab 셀 8 실행 (학습 완료 후 자동 실행되거나 수동 실행)

**로직 흐름**:
```
best.pth 로드
    ↓
checkpoint["num_classes"] = 15 복원 → build_classifier(config) 정상 초기화
    ↓
val.csv (AI Hub 1,500장) 전체 예측
    ↓
Confusion Matrix, per-class F1/AUC, Top-1/Top-3 Accuracy 출력
    ↓
thresholds.json 생성 (클래스별 최적 confidence 기준값)
```

**예상 결과**:
- Top-1 Accuracy: 95~100% 예상 (val 세트가 AI Hub 큐레이션 이미지라 여전히 높을 가능성 큼)
- Confusion Matrix에서 혼동이 심한 클래스 쌍 식별 가능
- 특정 클래스 F1이 다른 클래스보다 낮으면 → 해당 클래스 집중 개선

**이슈**: val.csv가 AI Hub에서 공식 제공한 대표 이미지(큐레이션)이기 때문에 실제 배포 환경보다 훨씬 쉬운 데이터일 가능성이 높다. 이 점수를 실제 성능으로 보기 어렵다.

---

### 2단계 — Holdout Test 세트 구성 (재학습 필요)

**목적**: 학습에 사용하지 않은 완전히 독립적인 데이터로 진짜 성능 측정.

**왜 재학습이 필요한가**:
현재 모델은 train.csv 12,000장 전부를 학습에 사용했다. 이 12,000장 중 일부를 test로 뽑아도 모델이 이미 본 데이터라 의미가 없다. 진짜 holdout test를 만들려면 **학습 전에 미리 분리**해야 한다.

**분할 방법 (CSV 재분배)**:
```
현재 train.csv 12,000행 (800장/class × 15)
    ↓ 클래스별 랜덤 분할 (seed 고정)
new_train.csv   640장/class × 15 = 9,600행
new_val.csv      80장/class × 15 = 1,200행
test.csv         80장/class × 15 = 1,200행  ← 학습 중 절대 사용 안 함
```

기존 AI Hub val.csv는 `official_val.csv`로 보존 (비교 기준으로 활용 가능).

**로직 흐름**:
```
split_dataset.py 실행 (스크립트 별도 작성)
    ↓
data/processed_15/ 에 new_train.csv, new_val.csv, test.csv 생성
    ↓
Colab 셀 7에서 data_dir 동일하게 두고 재학습
    ↓
학습 완료 후 evaluate.py --split test 로 최종 평가
```

**예상 결과**:
- 학습 데이터가 12,000 → 9,600으로 줄어 정확도 소폭 하락 예상
- test 정확도가 val(큐레이션) 정확도보다 낮게 나오면 → val이 과도하게 쉬웠다는 근거
- test 정확도가 val과 비슷하면 → 모델 일반화 성능이 실제로 높다는 근거

---

### 3단계 — 약한 클래스 타깃 개선

2단계 결과 확인 후, per-class 지표를 기반으로 아래 중 해당하는 방향 적용.

| 증상 | 원인 추정 | 적용 방법 |
|------|-----------|-----------|
| 특정 클래스 F1 < 0.7 | 클래스 간 시각적 유사성 | Augmentation 강화 (mixup, cutout) |
| 클래스별 샘플 수 불균형 | 데이터 분포 문제 | `class_weight` 또는 오버샘플링 |
| 전체 정확도 한계 도달 | DenseNet121 표현력 한계 | EfficientNet-B3으로 backbone 교체 |
| 정확도 높지만 특정 클래스 recall 낮음 | threshold 기본값(0.5) 부적절 | `threshold_opt.py` 결과 적용 |

---

### 의사결정 흐름도

```
[1단계 evaluate.py 실행]
         ↓
    per-class F1 확인
         ↓
   ┌─────────────────────────┐
   │ 특정 클래스 F1 < 0.8?   │
   └─────────────────────────┘
       Yes ↓          No ↓
   [2단계 진행]     val 100%가 실제인지 의심
   test split       → 2단계로 test split 만들어
   재학습             진짜 성능 확인
         ↓
   [3단계: 약한 클래스 개선]
```

---

### 알려진 이슈 요약

| 이슈 | 심각도 | 상태 | 비고 |
|------|--------|------|------|
| Val 100% 신뢰성 | 높음 | 🔄 확인 중 | AI Hub 큐레이션 val, test split 없어서 검증 불가 |
| Test 세트 없음 | 높음 | ❌ 미착수 | 재학습 후 해결 |
| `app.py` NUM_CLASSES 하드코딩 | 중간 | ❌ 미착수 | 배포 전 수정 필요 |
| `dataset.py` CLASS_MAP DS14 고정 | 낮음 | ❌ 미착수 | 학습/평가에 무해, 장기 정리 대상 |
| `last.pth` 미지원 | 낮음 | ❌ 미착수 | Colab 중단 시 최대 4에폭 손실 가능 |
