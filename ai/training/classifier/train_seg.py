"""아토피피부염 병변 세그멘테이션 모델 학습 (DeeplabV3+).

사용법:
    python -m ai.training.classifier.train_seg
    python -m ai.training.classifier.train_seg --num_epochs 50
    python -m ai.training.classifier.train_seg --root_dir /content/skin_ai
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
import time
from datetime import datetime
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

# ── 로컬 ─────────────────────────────────────────────────────────
from .config import SegmentConfig
from .model import build_segmentor, log_model_info
from ..utils import get_device, resolve_num_workers
from ...dataset.dataset import AihubSegDataset, get_transforms

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
CURVE_DPI = 150
DICE_EPSILON = 1e-8    # Dice 분모 0 방지용 안정화 항
LESION_CLASS_IDX = 1   # 세그멘테이션 클래스: 0=배경, 1=병변


# ── 메트릭 계산 ──────────────────────────────────────────────────

def _compute_iou(pred, target, num_classes):
    """클래스별 IoU 계산.

    Args:
        pred: 예측 마스크 (B, H, W)
        target: 정답 마스크 (B, H, W)
        num_classes: 클래스 수

    Returns:
        list[float]: 클래스별 IoU (NaN: 해당 클래스 없음)
    """
    ious = []
    for cls in range(num_classes):
        pred_cls = (pred == cls)
        target_cls = (target == cls)
        intersection = (pred_cls & target_cls).float().sum()
        union = (pred_cls | target_cls).float().sum()
        if union == 0:
            ious.append(float("nan"))
        else:
            ious.append((intersection / union).item())
    return ious


def _compute_dice(pred, target):
    """Dice coefficient (병변 클래스=1).

    Args:
        pred: 예측 마스크 (B, H, W)
        target: 정답 마스크 (B, H, W)

    Returns:
        float: Dice 계수
    """
    pred_1 = (pred == LESION_CLASS_IDX).float()
    target_1 = (target == LESION_CLASS_IDX).float()
    intersection = (pred_1 * target_1).sum()
    return (2 * intersection / (pred_1.sum() + target_1.sum() + DICE_EPSILON)).item()


# ── 학습/검증 루프 ───────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, aux_criterion, optimizer, device, config):
    """1 에폭 학습.

    Args:
        model: 세그멘테이션 모델
        loader: 학습 DataLoader
        criterion: 메인 손실 함수
        aux_criterion: 보조 손실 함수
        optimizer: 옵티마이저
        device: 디바이스
        config: SegmentConfig

    Returns:
        float: 평균 loss
    """
    model.train()
    total_loss = 0.0
    num_batches = 0

    for images, masks in loader:
        images, masks = images.to(device), masks.to(device)

        optimizer.zero_grad()
        outputs = model(images)

        main_loss = criterion(outputs["out"], masks)
        loss = main_loss

        if "aux" in outputs:
            aux_loss = aux_criterion(outputs["aux"], masks)
            loss = main_loss + config.aux_loss_weight * aux_loss

        loss.backward()
        optimizer.step()

        total_loss += loss.item()
        num_batches += 1

    return total_loss / num_batches


@torch.no_grad()
def validate_seg(model, loader, criterion, device, config):
    """세그멘테이션 검증.

    Args:
        model: 세그멘테이션 모델
        loader: 검증 DataLoader
        criterion: 손실 함수
        device: 디바이스
        config: SegmentConfig

    Returns:
        tuple: (평균 loss, 병변 IoU, Dice, 픽셀 정확도)
    """
    model.eval()
    total_loss = 0.0
    total_iou_lesion = 0.0
    total_dice = 0.0
    total_pixel_acc = 0.0
    num_batches = 0

    for images, masks in loader:
        images, masks = images.to(device), masks.to(device)
        outputs = model(images)["out"]

        loss = criterion(outputs, masks)
        preds = outputs.argmax(dim=1)

        ious = _compute_iou(preds, masks, num_classes=config.num_classes)
        dice = _compute_dice(preds, masks)
        pixel_acc = (preds == masks).float().mean().item()

        total_loss += loss.item()
        # IoU NaN 처리: 해당 클래스 미존재 시 0으로 대체
        lesion_iou = ious[LESION_CLASS_IDX] if not torch.isnan(torch.tensor(ious[LESION_CLASS_IDX])) else 0
        total_iou_lesion += lesion_iou
        total_dice += dice
        total_pixel_acc += pixel_acc
        num_batches += 1

    return (
        total_loss / num_batches,
        total_iou_lesion / num_batches,
        total_dice / num_batches,
        total_pixel_acc / num_batches,
    )


# ── 시각화 ───────────────────────────────────────────────────────

def _plot_seg_curves(history, save_path, target_iou):
    """세그멘테이션 메트릭 곡선 시각화.

    Args:
        history: 에폭별 기록 리스트
        save_path: 저장 경로
        target_iou: 목표 IoU
    """
    epochs = [h["epoch"] for h in history]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs, [h["val_iou"] for h in history], "g-", label="Val IoU")
    ax.plot(epochs, [h["val_dice"] for h in history], "b-", label="Val Dice")
    ax.axhline(
        y=target_iou, color="orange", linestyle="--",
        label=f"Target ({target_iou})",
    )
    ax.set_xlabel("Epoch")
    ax.set_ylabel("Score")
    ax.set_title("Segmentation Metrics")
    ax.legend()
    ax.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(save_path, dpi=CURVE_DPI)
    plt.close()


# ── CLI 파싱 ─────────────────────────────────────────────────────

def _parse_args():
    """CLI 인자 파싱."""
    parser = argparse.ArgumentParser(description="아토피 세그멘테이션 학습")
    parser.add_argument("--num_epochs", type=int, default=None)
    parser.add_argument("--batch_size", type=int, default=None)
    parser.add_argument(
        "--mask_dir", default=None,
        help="마스크 PNG 디렉토리 (기본: 환경변수 SEG_MASK_DIR 또는 data/masks)",
    )
    parser.add_argument(
        "--root_dir", default=None,
        help="CSV zip_path 재매핑용 프로젝트 루트 (Colab 등 경로 불일치 환경에서 사용)",
    )
    return parser.parse_args()


# ── 메인 학습 루프 ───────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    args = _parse_args()
    config = SegmentConfig()

    # CLI 명시값 오버라이드
    if args.num_epochs is not None:
        config.num_epochs = args.num_epochs
    if args.batch_size is not None:
        config.batch_size = args.batch_size
    if args.mask_dir:
        config.mask_dir = args.mask_dir

    device = get_device()

    print("=" * 60)
    print("아토피피부염 세그멘테이션 학습 (DeeplabV3+)")
    print(f"  device   : {device}")
    print(f"  epochs   : {config.num_epochs}")
    print(f"  batch    : {config.batch_size}")
    print(f"  lr       : {config.learning_rate}")
    print(f"  mask_dir : {config.mask_dir}")
    print("=" * 60)

    # ── 데이터 로드 ──────────────────────────────────────────────
    data_dir = Path(config.data_dir)
    train_transform = get_transforms("train", config, task="segment")
    val_transform = get_transforms("val", config, task="segment")

    train_dataset = AihubSegDataset(
        str(data_dir / "train.csv"), config.mask_dir,
        transform=train_transform, root_dir=args.root_dir,
    )
    val_dataset = AihubSegDataset(
        str(data_dir / "val.csv"), config.mask_dir,
        transform=val_transform, root_dir=args.root_dir,
    )

    num_workers = resolve_num_workers(device, config.num_workers)

    train_loader = DataLoader(
        train_dataset, batch_size=config.batch_size, shuffle=True,
        num_workers=num_workers, pin_memory=True,
    )
    val_loader = DataLoader(
        val_dataset, batch_size=config.batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
    )

    print(f"\n  Train: {len(train_dataset)}건 (아토피)")
    print(f"  Val  : {len(val_dataset)}건")

    # ── 모델 생성 ────────────────────────────────────────────────
    model = build_segmentor(config)
    log_model_info(model)
    model = model.to(device)

    criterion = nn.CrossEntropyLoss()
    aux_criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )

    # ── 저장 디렉토리 ────────────────────────────────────────────
    ckpt_dir = Path(config.checkpoint_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    best_iou = 0.0
    history = []

    print("\n학습 시작...\n")

    for epoch in range(config.num_epochs):
        epoch_num = epoch + 1
        epoch_start = time.time()

        train_loss = train_one_epoch(
            model, train_loader, criterion, aux_criterion, optimizer, device, config,
        )
        val_loss, val_iou, val_dice, val_pixel_acc = validate_seg(
            model, val_loader, criterion, device, config,
        )

        elapsed = time.time() - epoch_start

        print(
            f"[Epoch {epoch_num:02d}/{config.num_epochs}] "
            f"Train Loss: {train_loss:.3f} | "
            f"Val IoU: {val_iou:.3f} | Val Dice: {val_dice:.3f} | "
            f"Pixel Acc: {val_pixel_acc:.3f}"
        )
        print(f"{'':>20s}시간: {elapsed:.1f}s")

        history.append({
            "epoch": epoch_num,
            "train_loss": round(train_loss, 4),
            "val_loss": round(val_loss, 4),
            "val_iou": round(val_iou, 4),
            "val_dice": round(val_dice, 4),
            "val_pixel_acc": round(val_pixel_acc, 4),
        })

        if val_iou > best_iou:
            best_iou = val_iou
            torch.save({
                "epoch": epoch_num,
                "model_state_dict": model.state_dict(),
                "best_iou": best_iou,
                "config": vars(config),
            }, ckpt_dir / "best_seg.pth")
            print(f"{'':>20s}Best 모델 저장 (IoU: {best_iou:.4f})")

        print()

    # ── 학습 로그 저장 ───────────────────────────────────────────
    log = {
        "config": vars(config),
        "best_iou": round(best_iou, 4),
        "target_achieved": best_iou >= config.target_iou,
        "history": history,
    }

    log_path = ckpt_dir / "training_seg_log.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)

    # ── 메트릭 곡선 저장 ─────────────────────────────────────────
    if history:
        _plot_seg_curves(history, str(ckpt_dir / "iou_curve.png"), config.target_iou)

    print("=" * 60)
    print(f"학습 완료! Best IoU: {best_iou:.4f}")
    target_msg = "달성" if best_iou >= config.target_iou else "미달"
    print(f"  목표 IoU({config.target_iou}): {target_msg}")
    print(f"  학습 로그: {log_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
