"""AI Hub 08-14 학습 설정.

AI Hub 08-14 활용 가이드라인(서울대학교 산학협력단, 2025.01) 공식 학습 조건 기반.
모든 설정값은 환경변수로 오버라이드 가능.
"""

import os
import sys
from dataclasses import dataclass, field


def _env_int(key: str, default: int) -> int:
    """환경변수에서 int 값 로드."""
    return int(os.getenv(key, str(default)))


def _env_float(key: str, default: float) -> float:
    """환경변수에서 float 값 로드."""
    return float(os.getenv(key, str(default)))


def _env_str(key: str, default: str) -> str:
    """환경변수에서 str 값 로드."""
    return os.getenv(key, default)


# backbone별 기본 해상도 — 공식 입력 크기 기준
_BACKBONE_DEFAULTS = {
    "densenet121": {
        "image_size": 256,
        "crop_size": 224,
        "batch_size": 64,
        "learning_rate": 0.0005,
        "warmup_epochs": 3,
    },
    "efficientnet_b3": {
        "image_size": 320,
        "crop_size": 300,
        "batch_size": 16,
        "learning_rate": 0.0005,
        "warmup_epochs": 5,
    },
}

# ── 공유 상수 ────────────────────────────────────────────────────
NUM_CLASSES = 6
CLASS_NAMES = ["건선", "아토피피부염", "여드름", "주사", "지루피부염", "정상"]


@dataclass
class ClassifyConfig:
    """분류 모델 학습 설정.

    공식 벤치마크: DenseNet121 Top-1 Accuracy 85.17% (목표 80%)
    backbone을 변경하면 apply_backbone_defaults()로 해상도/배치 크기 자동 분기.
    """

    # ── 데이터 ──────────────────────────────────────────────────
    data_dir: str = field(default_factory=lambda: _env_str("DATA_DIR", "data/processed/DS14"))
    num_classes: int = NUM_CLASSES
    class_names: list = field(default_factory=lambda: list(CLASS_NAMES))

    # ── 모델 ────────────────────────────────────────────────────
    backbone: str = field(default_factory=lambda: _env_str("BACKBONE", "densenet121"))
    pretrained: bool = True

    # ── 학습 조건 (가이드라인 공식 값 — DenseNet121 기준) ──────────
    image_size: int = field(default_factory=lambda: _env_int("IMAGE_SIZE", 256))
    crop_size: int = field(default_factory=lambda: _env_int("CROP_SIZE", 224))
    batch_size: int = field(default_factory=lambda: _env_int("BATCH_SIZE", 32))
    num_workers: int = field(default_factory=lambda: _env_int("NUM_WORKERS", 4))
    learning_rate: float = field(default_factory=lambda: _env_float("LEARNING_RATE", 0.001))
    weight_decay: float = field(default_factory=lambda: _env_float("WEIGHT_DECAY", 1e-3))
    dropout_rate: float = field(default_factory=lambda: _env_float("DROPOUT_RATE", 0.55))
    num_epochs: int = field(default_factory=lambda: _env_int("NUM_EPOCHS", 30))
    optimizer: str = field(default_factory=lambda: _env_str("OPTIMIZER", "adam"))

    # ── 스케줄러 ────────────────────────────────────────────────
    scheduler: str = field(default_factory=lambda: _env_str("SCHEDULER", "cosine"))
    warmup_epochs: int = field(default_factory=lambda: _env_int("WARMUP_EPOCHS", 3))

    # ── 저장 ────────────────────────────────────────────────────
    checkpoint_dir: str = field(default_factory=lambda: _env_str("CHECKPOINT_DIR", "ai/results"))
    best_metric: str = "val_top1_acc"
    early_stopping_patience: int = field(default_factory=lambda: _env_int("EARLY_STOPPING_PATIENCE", sys.maxsize))
    save_every_n_epochs: int = field(default_factory=lambda: _env_int("SAVE_EVERY_N_EPOCHS", 5))

    # ── 로깅 ────────────────────────────────────────────────────
    log_dir: str = field(default_factory=lambda: _env_str("LOG_DIR", "ai/logs/aihub"))
    experiment_name: str = field(default_factory=lambda: _env_str("EXPERIMENT_NAME", "densenet121_baseline"))

    # ── 성능 목표 ────────────────────────────────────────────────
    target_top1_acc: float = 0.80
    stretch_top1_acc: float = 0.85

    def apply_backbone_defaults(self) -> None:
        """backbone에 따라 image_size, crop_size, batch_size, lr, warmup을 자동 설정.

        CLI에서 명시적으로 값을 지정한 경우 그 값이 우선하므로,
        이 메서드는 CLI 파싱 전에 호출해야 한다.
        """
        defaults = _BACKBONE_DEFAULTS.get(self.backbone)
        if defaults is None:
            return
        for key, value in defaults.items():
            setattr(self, key, value)


# ── 세그멘테이션 상수 ────────────────────────────────────────────
SEG_NUM_CLASSES = 2          # 배경 / 병변
SEG_AUX_LOSS_WEIGHT = 0.4   # DeeplabV3+ auxiliary loss 가중치


@dataclass
class SegmentConfig:
    """아토피피부염 병변 경계 검출 (DeeplabV3+) 설정.

    공식 벤치마크: IoU 0.9210 (목표 0.70)
    """

    data_dir: str = field(default_factory=lambda: _env_str("SEG_DATA_DIR", "data/processed/DS14"))
    mask_dir: str = field(default_factory=lambda: _env_str("SEG_MASK_DIR", "data/masks"))
    target_class: str = "아토피피부염"
    num_classes: int = SEG_NUM_CLASSES
    num_epochs: int = field(default_factory=lambda: _env_int("SEG_NUM_EPOCHS", 30))
    batch_size: int = field(default_factory=lambda: _env_int("SEG_BATCH_SIZE", 32))
    learning_rate: float = field(default_factory=lambda: _env_float("SEG_LEARNING_RATE", 0.001))
    weight_decay: float = field(default_factory=lambda: _env_float("SEG_WEIGHT_DECAY", 1e-4))
    image_size: int = field(default_factory=lambda: _env_int("SEG_IMAGE_SIZE", 256))
    crop_size: int = field(default_factory=lambda: _env_int("SEG_CROP_SIZE", 224))
    num_workers: int = field(default_factory=lambda: _env_int("SEG_NUM_WORKERS", 4))
    checkpoint_dir: str = field(default_factory=lambda: _env_str("SEG_CHECKPOINT_DIR", "ai/checkpoints/aihub_seg"))
    log_dir: str = field(default_factory=lambda: _env_str("SEG_LOG_DIR", "ai/logs/aihub_seg"))
    target_iou: float = 0.70
    stretch_iou: float = 0.85
    aux_loss_weight: float = SEG_AUX_LOSS_WEIGHT
