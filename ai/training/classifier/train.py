"""AI Hub 08-14 분류 모델 학습.

기획안 Section 4 기반: Full Fine-Tuning (DenseNet121 / EfficientNet-B3)
- Warmup(N에폭) + CosineAnnealingLR
- Early Stopping (patience=10)
- 체크포인트: best.pth, epoch_N.pth (매 5에폭), training_log.json

사용법:
    python -m ai.training.classifier.train
    python -m ai.training.classifier.train --backbone efficientnet_b3
    python -m ai.training.classifier.train --resume ai/results/best.pth
    python -m ai.training.classifier.train --root_dir /content/skin_ai
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
from .config import ClassifyConfig
from .model import build_classifier, log_model_info
from ..utils import get_device, resolve_num_workers, topk_accuracy
from ...dataset.dataset import AihubFacialDataset, get_transforms, worker_init_fn

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
TOPK = (1, 3)
LOSS_CURVE_DPI = 150
TARGET_LINE_PERCENT = 80     # 학습 곡선 목표선 (%)


# ── 학습/검증 루프 ───────────────────────────────────────────────

def train_one_epoch(model, loader, criterion, optimizer, device):
    """1 에폭 학습.

    Args:
        model: 분류 모델
        loader: 학습 DataLoader
        criterion: 손실 함수
        optimizer: 옵티마이저
        device: 디바이스

    Returns:
        tuple: (평균 loss, 평균 top-1 accuracy)
    """
    model.train()
    total_loss = 0.0
    total_top1 = 0.0
    num_batches = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)

        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        top1, _ = topk_accuracy(outputs, labels, topk=TOPK)
        total_loss += loss.item()
        total_top1 += top1.item()
        num_batches += 1

    return total_loss / num_batches, total_top1 / num_batches


@torch.no_grad()
def validate(model, loader, criterion, device):
    """검증.

    Args:
        model: 분류 모델
        loader: 검증 DataLoader
        criterion: 손실 함수
        device: 디바이스

    Returns:
        tuple: (평균 loss, 평균 top-1 accuracy, 평균 top-3 accuracy)
    """
    model.eval()
    total_loss = 0.0
    total_top1 = 0.0
    total_top3 = 0.0
    num_batches = 0

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        outputs = model(images)
        loss = criterion(outputs, labels)

        top1, top3 = topk_accuracy(outputs, labels, topk=TOPK)
        total_loss += loss.item()
        total_top1 += top1.item()
        total_top3 += top3.item()
        num_batches += 1

    return (
        total_loss / num_batches,
        total_top1 / num_batches,
        total_top3 / num_batches,
    )


# ── 체크포인트 ───────────────────────────────────────────────────

def _build_checkpoint(model, optimizer, epoch, best_val_top1, config, history):
    """체크포인트 dict 생성."""
    return {
        "epoch": epoch,
        "model_state_dict": model.state_dict(),
        "optimizer_state_dict": optimizer.state_dict(),
        "best_val_top1": best_val_top1,
        "config": vars(config),
        "history": history,
    }


def _save_checkpoint(checkpoint, path):
    """체크포인트를 파일에 저장."""
    torch.save(checkpoint, path)
    logger.info(f"  체크포인트 저장: {path}")


# ── 시각화 ───────────────────────────────────────────────────────

def _plot_training_curves(history, save_path, target_acc):
    """학습 곡선 시각화 (Loss + Top-1 Accuracy).

    Args:
        history: 에폭별 기록 리스트
        save_path: 저장 경로
        target_acc: 목표 accuracy (0~1)
    """
    epochs = [h["epoch"] for h in history]
    train_loss = [h["train_loss"] for h in history]
    val_loss = [h["val_loss"] for h in history]
    val_top1 = [h["val_top1"] for h in history]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    ax1.plot(epochs, train_loss, "b-", label="Train Loss")
    ax1.plot(epochs, val_loss, "r-", label="Val Loss")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Loss")
    ax1.set_title("Loss Curve")
    ax1.legend()
    ax1.grid(alpha=0.3)

    ax2.plot(epochs, val_top1, "g-", label="Val Top-1 Acc")
    ax2.axhline(
        y=target_acc,
        color="orange", linestyle="--",
        label=f"Target ({TARGET_LINE_PERCENT}%)",
    )
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Accuracy")
    ax2.set_title("Top-1 Accuracy")
    ax2.legend()
    ax2.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=LOSS_CURVE_DPI)
    plt.close()


# ── CLI 파싱 ─────────────────────────────────────────────────────

def _parse_args():
    """CLI 인자 파싱."""
    parser = argparse.ArgumentParser(description="AI Hub 분류 모델 학습")
    parser.add_argument(
        "--backbone", default=None,
        choices=["densenet121", "efficientnet_b3"],
        help="모델 backbone (기본: 환경변수 BACKBONE 또는 densenet121)",
    )
    parser.add_argument("--experiment_name", default=None)
    parser.add_argument("--num_epochs", type=int, default=None)
    parser.add_argument("--batch_size", type=int, default=None)
    parser.add_argument("--learning_rate", type=float, default=None)
    parser.add_argument("--data_dir", default=None, help="데이터셋 CSV 경로 (기본: config 값)")
    parser.add_argument("--num_classes", type=int, default=None, help="클래스 수 (기본: metadata.json 자동 감지)")
    parser.add_argument("--resume", default=None, help="체크포인트 경로 (학습 재개)")
    parser.add_argument(
        "--root_dir", default=None,
        help="CSV zip_path 재매핑용 프로젝트 루트 (Colab 등 경로 불일치 환경에서 사용)",
    )
    return parser.parse_args()


def _apply_cli_overrides(config, args):
    """CLI 인자로 config 오버라이드 (명시된 값만).

    Args:
        config: ClassifyConfig
        args: argparse.Namespace
    """
    if args.backbone:
        config.backbone = args.backbone
        # backbone 변경 시 관련 기본값 재설정
        config.apply_backbone_defaults()

    # CLI 명시값이 backbone 기본값보다 우선
    if args.experiment_name:
        config.experiment_name = args.experiment_name
    if args.num_epochs is not None:
        config.num_epochs = args.num_epochs
    if args.batch_size is not None:
        config.batch_size = args.batch_size
    if args.learning_rate is not None:
        config.learning_rate = args.learning_rate
    if args.data_dir is not None:
        config.data_dir = args.data_dir
    if args.num_classes is not None:
        config.num_classes = args.num_classes


# ── 메인 학습 루프 ───────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    started_at = datetime.now().isoformat()

    args = _parse_args()
    config = ClassifyConfig()
    _apply_cli_overrides(config, args)
    config.load_from_metadata()   # data_dir/metadata.json → num_classes, class_names 자동 설정

    device = get_device()

    print("=" * 60)
    print("AI Hub 분류 모델 학습")
    print(f"  backbone    : {config.backbone}")
    print(f"  device      : {device}")
    print(f"  epochs      : {config.num_epochs}")
    print(f"  batch       : {config.batch_size}")
    print(f"  lr          : {config.learning_rate}")
    print(f"  warmup      : {config.warmup_epochs} epochs")
    print(f"  scheduler   : CosineAnnealingLR (T_max={config.num_epochs - config.warmup_epochs})")
    print(f"  num_classes : {config.num_classes}")
    print(f"  data_dir    : {config.data_dir}")
    print("=" * 60)

    # ── 데이터 로드 ──────────────────────────────────────────────
    data_dir = Path(config.data_dir)
    train_transform = get_transforms("train", config)
    val_transform = get_transforms("val", config)

    train_dataset = AihubFacialDataset(
        str(data_dir / "train.csv"),
        transform=train_transform,
        root_dir=args.root_dir,
        direction=None,
    )
    val_dataset = AihubFacialDataset(
        str(data_dir / "val.csv"),
        transform=val_transform,
        root_dir=args.root_dir,
        direction=None,
    )

    num_workers = resolve_num_workers(device, config.num_workers)

    train_loader = DataLoader(
        train_dataset,
        batch_size=config.batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=config.batch_size,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=True,
        worker_init_fn=worker_init_fn,
    )

    print(f"\n  Train: {len(train_dataset)}건")
    print(f"  Val  : {len(val_dataset)}건")

    # ── 모델 생성 ────────────────────────────────────────────────
    model = build_classifier(config)
    log_model_info(model)
    model = model.to(device)

    criterion = nn.CrossEntropyLoss(label_smoothing=config.label_smoothing)
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=config.learning_rate,
        weight_decay=config.weight_decay,
    )

    # warmup 이후 남은 에폭 동안 코사인 감쇠
    cosine_t_max = max(config.num_epochs - config.warmup_epochs, 1)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=cosine_t_max,
    )

    # ── 체크포인트 복원 ──────────────────────────────────────────
    start_epoch = 0
    best_val_top1 = 0.0
    history = []

    if args.resume:
        checkpoint = torch.load(args.resume, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model_state_dict"])
        optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        start_epoch = checkpoint.get("epoch", 0)
        best_val_top1 = checkpoint.get("best_val_top1", 0.0)
        history = checkpoint.get("history", [])
        print(f"\n  이어서 학습: epoch {start_epoch}, best_top1={best_val_top1:.4f}")

    # ── 저장 디렉토리 ────────────────────────────────────────────
    ckpt_dir = Path(config.checkpoint_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    # ── 학습 루프 ────────────────────────────────────────────────
    no_improve = 0
    print("\n학습 시작...\n")

    for epoch in range(start_epoch, config.num_epochs):
        epoch_num = epoch + 1
        epoch_start = time.time()

        # 학습
        train_loss, train_top1 = train_one_epoch(
            model, train_loader, criterion, optimizer, device,
        )

        # warmup 이후에만 스케줄러 step
        if epoch >= config.warmup_epochs:
            scheduler.step()

        # 검증
        val_loss, val_top1, val_top3 = validate(
            model, val_loader, criterion, device,
        )

        elapsed = time.time() - epoch_start
        current_lr = optimizer.param_groups[0]["lr"]

        # 로깅
        print(
            f"[Epoch {epoch_num:02d}/{config.num_epochs}] "
            f"Train Loss: {train_loss:.3f} | Train Top-1: {train_top1 * 100:.1f}%"
        )
        print(
            f"{'':>20s}"
            f"Val   Loss: {val_loss:.3f} | Val   Top-1: {val_top1 * 100:.1f}% | "
            f"Val Top-3: {val_top3 * 100:.1f}%"
        )
        print(
            f"{'':>20s}"
            f"시간: {elapsed:.1f}s | LR: {current_lr:.6f}"
        )

        epoch_log = {
            "epoch": epoch_num,
            "train_loss": round(train_loss, 4),
            "train_top1": round(train_top1, 4),
            "val_loss": round(val_loss, 4),
            "val_top1": round(val_top1, 4),
            "val_top3": round(val_top3, 4),
            "lr": current_lr,
        }
        history.append(epoch_log)

        # ── Best 모델 저장 ───────────────────────────────────────
        if val_top1 > best_val_top1:
            best_val_top1 = val_top1
            no_improve = 0
            ckpt = _build_checkpoint(
                model, optimizer, epoch_num, best_val_top1, config, history,
            )
            _save_checkpoint(ckpt, ckpt_dir / "best.pth")
            print(f"{'':>20s}Best 모델 저장 (Top-1: {best_val_top1 * 100:.2f}%)")
        else:
            no_improve += 1

        # ── 주기적 체크포인트 (매 save_every_n_epochs) ───────────
        if epoch_num % config.save_every_n_epochs == 0:
            ckpt = _build_checkpoint(
                model, optimizer, epoch_num, best_val_top1, config, history,
            )
            _save_checkpoint(ckpt, ckpt_dir / f"epoch_{epoch_num}.pth")

        # ── Early stopping ───────────────────────────────────────
        if no_improve >= config.early_stopping_patience:
            print(
                f"\nEarly stopping: "
                f"{config.early_stopping_patience} 에폭 동안 개선 없음"
            )
            break

        print()

    # ── 학습 로그 저장 ───────────────────────────────────────────
    best_epoch = (
        max(history, key=lambda x: x["val_top1"])["epoch"]
        if history else 0
    )
    training_log = {
        "config": vars(config),
        "best_epoch": best_epoch,
        "best_val_top1": round(best_val_top1, 4),
        "target_achieved": best_val_top1 >= config.target_top1_acc,
        "guideline_target": config.target_top1_acc,
        "device": str(device),
        "started_at": started_at,
        "history": history,
    }

    log_path = ckpt_dir / "training_log.json"
    with open(log_path, "w", encoding="utf-8") as f:
        json.dump(training_log, f, ensure_ascii=False, indent=2)

    # ── 학습 곡선 저장 ───────────────────────────────────────────
    if history:
        _plot_training_curves(
            history,
            str(ckpt_dir / "loss_curve.png"),
            config.target_top1_acc,
        )

    print("\n" + "=" * 60)
    print("학습 완료!")
    print(f"  Best Top-1 Acc : {best_val_top1 * 100:.2f}%")
    target_msg = "달성" if best_val_top1 >= config.target_top1_acc else "미달"
    print(f"  가이드라인 목표 : {target_msg}")
    print(f"  체크포인트     : {ckpt_dir}/best.pth")
    print(f"  학습 로그      : {log_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
