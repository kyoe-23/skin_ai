"""분류 및 세그멘테이션 모델 빌드.

DenseNet121: ImageNet pretrained → Dropout(p) → Linear(1024 → NUM_CLASSES)
EfficientNet-B3: ImageNet pretrained → Dropout(p) → Linear(1536 → NUM_CLASSES)
DeeplabV3+: ResNet101 backbone → 2클래스 (배경/병변)
"""

import logging

import torch.nn as nn
from torchvision import models

from .config import ClassifyConfig, SegmentConfig, SEG_NUM_CLASSES

logger = logging.getLogger(__name__)


def build_classifier(config: ClassifyConfig) -> nn.Module:
    """분류 모델 생성.

    Args:
        config: ClassifyConfig (backbone: densenet121 | efficientnet_b3)

    Returns:
        nn.Module: 분류 모델
    """
    if config.backbone == "densenet121":
        weights = models.DenseNet121_Weights.DEFAULT if config.pretrained else None
        model = models.densenet121(weights=weights)
        in_features = model.classifier.in_features
        model.classifier = nn.Sequential(
            nn.Dropout(config.dropout_rate),
            nn.Linear(in_features, config.num_classes),
        )

    elif config.backbone == "efficientnet_b3":
        weights = models.EfficientNet_B3_Weights.DEFAULT if config.pretrained else None
        model = models.efficientnet_b3(weights=weights)
        in_features = model.classifier[-1].in_features
        model.classifier = nn.Sequential(
            nn.Dropout(config.dropout_rate),
            nn.Linear(in_features, config.num_classes),
        )

    else:
        raise ValueError(f"지원하지 않는 backbone: {config.backbone}")

    return model


def build_segmentor(config: SegmentConfig) -> nn.Module:
    """DeeplabV3+ 세그멘테이션 모델 생성.

    Args:
        config: SegmentConfig

    Returns:
        nn.Module: 세그멘테이션 모델 (num_classes=SEG_NUM_CLASSES: 배경/병변)
    """
    weights = models.segmentation.DeepLabV3_ResNet101_Weights.DEFAULT
    model = models.segmentation.deeplabv3_resnet101(weights=weights)

    # DeeplabV3 헤드의 최종 conv 레이어를 SEG_NUM_CLASSES로 교체
    deeplabv3_head_out_channels = 256
    model.classifier[-1] = nn.Conv2d(
        deeplabv3_head_out_channels, SEG_NUM_CLASSES, kernel_size=1,
    )

    if model.aux_classifier is not None:
        model.aux_classifier[-1] = nn.Conv2d(
            deeplabv3_head_out_channels, SEG_NUM_CLASSES, kernel_size=1,
        )

    return model


def log_model_info(model: nn.Module) -> dict:
    """모델 파라미터 정보 로깅.

    Args:
        model: PyTorch 모델

    Returns:
        dict: 모델 이름, 전체/학습 파라미터 수
    """
    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    name = model.__class__.__name__

    info = {
        "name": name,
        "total_params": total,
        "trainable_params": trainable,
    }

    logger.info(f"  Model     : {name}")
    logger.info(f"  Total     : {total:,} params")
    logger.info(f"  Trainable : {trainable:,} params")

    return info
