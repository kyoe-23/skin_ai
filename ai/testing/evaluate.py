"""분류 모델 평가.

사용법:
    python -m ai.testing.evaluate \
        --checkpoint ai/results/best.pth
    python -m ai.testing.evaluate \
        --checkpoint ai/results/best.pth \
        --split val --output_dir ai/testing/eval_results
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
import os
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
    roc_curve,
    f1_score,
)

# ── 로컬 ─────────────────────────────────────────────────────────
from ..training.classifier.config import ClassifyConfig
from ..training.classifier.model import build_classifier
from ..training.utils import get_device, resolve_num_workers
from ..dataset.dataset import AihubFacialDataset, ExternalFacialDataset, get_transforms, worker_init_fn

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
PLOT_DPI = 150
ROC_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD",
    "#F7DC6F", "#A569BD", "#5DADE2", "#48C9B0", "#F0B27A",
]
DEFAULT_OUTPUT_DIR = os.getenv("EVAL_OUTPUT_DIR", "ai/testing/eval_results")
DEFAULT_SPLIT = "val"
PLATFORM_DARWIN = "Darwin"


# ── 예측 수집 ────────────────────────────────────────────────────

@torch.no_grad()
def collect_predictions(model, loader, device):
    """평가셋 전체 예측 수집.

    Args:
        model: 분류 모델
        loader: 평가 DataLoader
        device: 디바이스

    Returns:
        tuple: (softmax 확률 텐서, 라벨 텐서)
    """
    model.eval()
    all_probs = []
    all_labels = []

    for images, labels in loader:
        images = images.to(device)
        outputs = model(images)
        probs = torch.softmax(outputs, dim=1).cpu()
        all_probs.append(probs)
        all_labels.append(labels)

    return torch.cat(all_probs), torch.cat(all_labels)


# ── 시각화 ───────────────────────────────────────────────────────

def _plot_confusion_matrix(cm, class_names, save_path):
    """Confusion Matrix 시각화.

    Args:
        cm: confusion matrix (numpy array)
        class_names: 클래스명 리스트
        save_path: 저장 경로
    """
    import platform
    if platform.system() == PLATFORM_DARWIN:
        plt.rcParams["font.family"] = "AppleGothic"
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(10, 8))
    im = ax.imshow(cm, interpolation="nearest", cmap=plt.cm.Blues)
    ax.figure.colorbar(im, ax=ax)

    ax.set(
        xticks=np.arange(cm.shape[1]),
        yticks=np.arange(cm.shape[0]),
        xticklabels=class_names,
        yticklabels=class_names,
        ylabel="실제 (True)",
        xlabel="예측 (Predicted)",
        title="Confusion Matrix",
    )
    plt.setp(ax.get_xticklabels(), rotation=45, ha="right")

    thresh = cm.max() / 2.0
    for i in range(cm.shape[0]):
        for j in range(cm.shape[1]):
            ax.text(
                j, i, format(cm[i, j], "d"),
                ha="center", va="center",
                color="white" if cm[i, j] > thresh else "black",
            )

    plt.tight_layout()
    plt.savefig(save_path, dpi=PLOT_DPI)
    plt.close()


def _plot_roc_curves(all_labels, all_probs, class_names, save_path):
    """ROC 곡선 시각화.

    Args:
        all_labels: 라벨 텐서
        all_probs: 확률 텐서
        class_names: 클래스명 리스트
        save_path: 저장 경로
    """
    fig, ax = plt.subplots(figsize=(10, 8))

    for i, (name, color) in enumerate(zip(class_names, ROC_COLORS)):
        binary_labels = (all_labels == i).numpy().astype(int)
        if binary_labels.sum() == 0:
            continue
        fpr, tpr, _ = roc_curve(binary_labels, all_probs[:, i].numpy())
        auc = roc_auc_score(binary_labels, all_probs[:, i].numpy())
        ax.plot(fpr, tpr, color=color, lw=2, label=f"{name} (AUC={auc:.3f})")

    ax.plot([0, 1], [0, 1], "k--", lw=1)
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC Curves")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=PLOT_DPI)
    plt.close()


# ── 메인 ─────────────────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="분류 모델 평가")
    parser.add_argument("--checkpoint", required=True, help="체크포인트 경로")
    parser.add_argument("--output_dir", default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--data_dir", default=None)
    parser.add_argument(
        "--split", default=DEFAULT_SPLIT,
        help="평가할 split (val 또는 test, 기본: val — test.csv 없으면 val.csv로 fallback)",
    )
    parser.add_argument(
        "--root_dir", default=None,
        help="CSV zip_path 재매핑용 프로젝트 루트 (Colab 등 경로 불일치 환경에서 사용)",
    )
    args = parser.parse_args()

    device = get_device()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── 체크포인트 로드 ──────────────────────────────────────────
    checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=False)
    ckpt_config = checkpoint.get("config", {})

    config = ClassifyConfig()
    config.backbone    = ckpt_config.get("backbone", config.backbone)
    config.num_classes = ckpt_config.get("num_classes", config.num_classes)
    config.data_dir    = args.data_dir or ckpt_config.get("data_dir", config.data_dir)
    # class_names: 체크포인트 config 우선 — 외부 데이터 평가 시 metadata 덮어쓰기 방지
    if "class_names" in ckpt_config:
        config.class_names = list(ckpt_config["class_names"])
    else:
        config.load_from_metadata()

    model = build_classifier(config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model = model.to(device)

    # ── 평가 데이터 ──────────────────────────────────────────────
    data_dir = Path(config.data_dir)
    csv_path = data_dir / f"{args.split}.csv"
    if not csv_path.exists():
        fallback = data_dir / "val.csv"
        print(f"  {csv_path.name} 없음 -> {fallback.name} 사용")
        csv_path = fallback

    eval_transform = get_transforms("val", config)

    # CSV 컬럼으로 데이터셋 타입 자동 감지
    import pandas as _pd
    _columns = _pd.read_csv(csv_path, nrows=0).columns.tolist()
    if "image_path" in _columns:
        eval_dataset = ExternalFacialDataset(str(csv_path), transform=eval_transform)
    else:
        eval_dataset = AihubFacialDataset(
            str(csv_path), transform=eval_transform, root_dir=args.root_dir,
            direction=None,
        )

    num_workers = resolve_num_workers(device, config.num_workers)
    eval_loader = DataLoader(
        eval_dataset, batch_size=config.batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
        worker_init_fn=worker_init_fn,
    )

    print(f"평가 데이터: {csv_path.name} ({len(eval_dataset)}건)")

    # ── 예측 수집 ────────────────────────────────────────────────
    all_probs, all_labels = collect_predictions(model, eval_loader, device)
    all_preds = all_probs.argmax(dim=1)

    class_names = config.class_names
    labels_np = all_labels.numpy()
    preds_np = all_preds.numpy()

    # ── Top-1, Top-3 Accuracy ────────────────────────────────────
    top1_acc = (all_preds == all_labels).float().mean().item()
    _, top3_preds = all_probs.topk(3, dim=1)
    top3_correct = sum(
        all_labels[i] in top3_preds[i] for i in range(len(all_labels))
    )
    top3_acc = top3_correct / len(all_labels)

    # ── Classification Report ────────────────────────────────────
    all_label_indices = list(range(len(class_names)))
    report = classification_report(
        labels_np, preds_np,
        labels=all_label_indices, target_names=class_names,
        output_dict=True, zero_division=0,
    )
    macro_f1 = f1_score(labels_np, preds_np, average="macro", labels=all_label_indices, zero_division=0)
    weighted_f1 = f1_score(labels_np, preds_np, average="weighted", labels=all_label_indices, zero_division=0)

    # ── AUC ──────────────────────────────────────────────────────
    try:
        macro_auc = roc_auc_score(labels_np, all_probs.numpy(), multi_class="ovr", average="macro")
    except ValueError:
        macro_auc = 0.0

    per_class_auc = {}
    for i, name in enumerate(class_names):
        binary = (labels_np == i).astype(int)
        if binary.sum() > 0:
            per_class_auc[name] = roc_auc_score(binary, all_probs[:, i].numpy())
        else:
            per_class_auc[name] = 0.0

    # ── 결과 출력 ────────────────────────────────────────────────
    target_msg = "달성" if top1_acc >= config.target_top1_acc else "미달"

    print("\n" + "=" * 60)
    print(" SkinAI 분류 모델 평가 결과")
    print(f" 모델: {config.backbone}")
    print("-" * 60)
    print(f" Top-1 Accuracy : {top1_acc * 100:.2f}%  가이드라인 목표(80%): {target_msg}")
    print(f" Top-3 Accuracy : {top3_acc * 100:.2f}%")
    print(f" Macro F1-Score : {macro_f1:.4f}")
    print(f" Macro AUC      : {macro_auc:.4f}")
    print("-" * 60)
    print(f" {'클래스':12s} {'Prec':>8s} {'Recall':>8s} {'F1':>8s} {'AUC':>8s}")
    print("-" * 60)
    for name in class_names:
        r = report.get(name, {})
        auc_val = per_class_auc.get(name, 0)
        print(
            f" {name:12s} {r.get('precision', 0):8.4f} {r.get('recall', 0):8.4f} "
            f"{r.get('f1-score', 0):8.4f} {auc_val:8.4f}"
        )
    print("=" * 60)

    # ── Confusion Matrix ─────────────────────────────────────────
    cm = confusion_matrix(labels_np, preds_np, labels=all_label_indices)
    _plot_confusion_matrix(cm, class_names, str(output_dir / "confusion_matrix.png"))
    print(f"-> confusion_matrix.png 저장")

    # ── ROC Curves ───────────────────────────────────────────────
    _plot_roc_curves(all_labels, all_probs, class_names, str(output_dir / "roc_curves.png"))
    print(f"-> roc_curves.png 저장")

    # ── JSON 결과 저장 ───────────────────────────────────────────
    results = {
        "backbone": config.backbone,
        "eval_samples": len(eval_dataset),
        "top1_accuracy": round(top1_acc, 4),
        "top3_accuracy": round(top3_acc, 4),
        "macro_f1": round(macro_f1, 4),
        "weighted_f1": round(weighted_f1, 4),
        "macro_auc": round(macro_auc, 4),
        "target_achieved": top1_acc >= config.target_top1_acc,
        "per_class": {
            name: {
                "precision": round(report[name]["precision"], 4),
                "recall": round(report[name]["recall"], 4),
                "f1": round(report[name]["f1-score"], 4),
                "auc": round(per_class_auc.get(name, 0), 4),
                "support": int(report[name]["support"]),
            }
            for name in class_names if name in report
        },
        "confusion_matrix": cm.tolist(),
    }

    with open(output_dir / "evaluation_results.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"-> evaluation_results.json 저장")


if __name__ == "__main__":
    main()
