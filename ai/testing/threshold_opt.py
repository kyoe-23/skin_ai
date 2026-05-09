"""클래스별 confidence threshold 최적화.

사용법:
    python -m ai.testing.threshold_opt \
        --checkpoint ai/results/best.pth
    python -m ai.testing.threshold_opt \
        --checkpoint ai/results/best.pth \
        --mode precision --min_precision 0.75
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
import os
from datetime import datetime
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import numpy as np
import torch
from torch.utils.data import DataLoader
from sklearn.metrics import f1_score, precision_score

# ── 로컬 ─────────────────────────────────────────────────────────
from ..training.classifier.config import ClassifyConfig
from ..training.classifier.model import build_classifier
from ..training.utils import get_device, resolve_num_workers
from ..dataset.dataset import AihubFacialDataset, get_transforms, worker_init_fn

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
THRESHOLD_MIN = float(os.getenv("THRESHOLD_MIN", "0.30"))
THRESHOLD_MAX = float(os.getenv("THRESHOLD_MAX", "0.96"))
THRESHOLD_STEP = float(os.getenv("THRESHOLD_STEP", "0.05"))
DEFAULT_THRESHOLD = float(os.getenv("DEFAULT_THRESHOLD", "0.50"))
DEFAULT_MIN_PRECISION = float(os.getenv("DEFAULT_MIN_PRECISION", "0.75"))
UNCERTAIN_LABEL = -1


# ── 예측 수집 ────────────────────────────────────────────────────

@torch.no_grad()
def collect_probs(model, loader, device):
    """Validation set 전체 softmax 확률 수집.

    Args:
        model: 분류 모델
        loader: 검증 DataLoader
        device: 디바이스

    Returns:
        tuple: (확률 numpy array, 라벨 numpy array)
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

    return torch.cat(all_probs).numpy(), torch.cat(all_labels).numpy()


# ── 최적화 ───────────────────────────────────────────────────────

def optimize_thresholds(probs, labels, class_names, mode="f1_max", min_precision=DEFAULT_MIN_PRECISION):
    """클래스별 독립 threshold 탐색.

    Args:
        probs: (N, C) softmax 확률
        labels: (N,) 정답 라벨
        class_names: 클래스명 리스트
        mode: 'f1_max' 또는 'precision'
        min_precision: precision 모드에서의 최소 precision

    Returns:
        dict: 클래스별 최적 threshold
    """
    thresholds = {}
    thresholds_range = np.arange(THRESHOLD_MIN, THRESHOLD_MAX, THRESHOLD_STEP)

    for cls_idx, cls_name in enumerate(class_names):
        binary_labels = (labels == cls_idx).astype(int)
        cls_probs = probs[:, cls_idx]

        best_thresh = DEFAULT_THRESHOLD
        best_score = -1

        for thresh in thresholds_range:
            binary_preds = (cls_probs >= thresh).astype(int)

            if binary_preds.sum() == 0:
                continue

            if mode == "f1_max":
                score = f1_score(binary_labels, binary_preds, zero_division=0)
                if score > best_score:
                    best_score = score
                    best_thresh = thresh

            elif mode == "precision":
                prec = precision_score(binary_labels, binary_preds, zero_division=0)
                f1 = f1_score(binary_labels, binary_preds, zero_division=0)
                if prec >= min_precision and f1 > best_score:
                    best_score = f1
                    best_thresh = thresh

        thresholds[cls_name] = round(float(best_thresh), 2)

    return thresholds


# ── 메인 ─────────────────────────────────────────────────────────

def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="클래스별 threshold 최적화")
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--mode", default="f1_max", choices=["f1_max", "precision"])
    parser.add_argument("--min_precision", type=float, default=DEFAULT_MIN_PRECISION)
    parser.add_argument("--data_dir", default=None)
    parser.add_argument(
        "--root_dir", default=None,
        help="CSV zip_path 재매핑용 프로젝트 루트 (Colab 등 경로 불일치 환경에서 사용)",
    )
    args = parser.parse_args()

    device = get_device()

    checkpoint = torch.load(args.checkpoint, map_location=device, weights_only=False)
    ckpt_config = checkpoint.get("config", {})

    config = ClassifyConfig()
    config.backbone = ckpt_config.get("backbone", config.backbone)
    if args.data_dir:
        config.data_dir = args.data_dir
    # data_dir/metadata.json에서 num_classes/class_names 자동 로드 (DS14 6종 / unified 11종 등)
    config.load_from_metadata()
    # 체크포인트 config가 있으면 그것이 우선 (학습 당시 클래스 정보가 정답)
    if ckpt_config.get("class_names"):
        config.class_names = ckpt_config["class_names"]
        config.num_classes = len(ckpt_config["class_names"])

    # 체크포인트 클래스 정보 기반으로 idx_to_class 구성 — 글로벌 IDX_TO_CLASS(DS14 6종)에 의존하지 않음
    idx_to_class = {idx: name for idx, name in enumerate(config.class_names)}

    model = build_classifier(config)
    model.load_state_dict(checkpoint["model_state_dict"])
    model = model.to(device)

    data_dir = Path(config.data_dir)
    val_transform = get_transforms("val", config)
    val_dataset = AihubFacialDataset(
        str(data_dir / "val.csv"), transform=val_transform, root_dir=args.root_dir,
        direction=None,
    )

    num_workers = resolve_num_workers(device, config.num_workers)
    val_loader = DataLoader(
        val_dataset, batch_size=config.batch_size, shuffle=False,
        num_workers=num_workers, pin_memory=True,
        worker_init_fn=worker_init_fn,
    )

    print("=" * 60)
    print(f"클래스별 Threshold 최적화 (mode: {args.mode})")
    print("=" * 60)

    print(f"\nValidation 데이터: {len(val_dataset)}건")
    print("Softmax 확률 수집 중...")

    probs, labels = collect_probs(model, val_loader, device)

    # 최적화 전 Macro F1 (argmax 기준)
    preds_before = probs.argmax(axis=1)
    f1_before = f1_score(labels, preds_before, average="macro")

    # Threshold 최적화
    thresholds = optimize_thresholds(
        probs, labels, config.class_names,
        mode=args.mode, min_precision=args.min_precision,
    )

    # 최적화 후 Macro F1 (threshold 적용)
    preds_after = []
    for i in range(len(probs)):
        pred_idx = probs[i].argmax()
        pred_class = idx_to_class[pred_idx]
        pred_conf = probs[i, pred_idx]
        if pred_conf >= thresholds[pred_class]:
            preds_after.append(pred_idx)
        else:
            preds_after.append(UNCERTAIN_LABEL)

    valid_mask = np.array(preds_after) >= 0
    if valid_mask.sum() > 0:
        f1_after = f1_score(
            labels[valid_mask], np.array(preds_after)[valid_mask], average="macro",
        )
    else:
        f1_after = 0.0

    # ── 결과 출력 ────────────────────────────────────────────────
    separator = "-" * 65
    print(f"\n{separator}")
    print(f" {'클래스':12s} | {'Thresh':>8s} | {'F1 전':>8s} | {'F1 후':>8s} | {'개선':>8s}")
    print(separator)

    for cls_idx, cls_name in enumerate(config.class_names):
        thresh = thresholds[cls_name]
        binary_labels = (labels == cls_idx).astype(int)

        preds_b = (preds_before == cls_idx).astype(int)
        f1_b = f1_score(binary_labels, preds_b, zero_division=0)

        preds_a = (probs[:, cls_idx] >= thresh).astype(int)
        f1_a = f1_score(binary_labels, preds_a, zero_division=0)

        delta = f1_a - f1_b
        sign = "+" if delta >= 0 else ""
        print(f" {cls_name:12s} | {thresh:8.2f} | {f1_b:8.4f} | {f1_a:8.4f} | {sign}{delta:.3f}")

    print(separator)
    print(f" Macro F1: {f1_before:.4f} -> {f1_after:.4f}")
    uncertain_count = (~valid_mask).sum()
    uncertain_ratio = (~valid_mask).mean()
    print(f" 판단 불가 비율: {uncertain_count}/{len(probs)} ({uncertain_ratio * 100:.1f}%)")

    # ── 저장 ─────────────────────────────────────────────────────
    ckpt_dir = Path(config.checkpoint_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)

    output = {**thresholds}
    output["_meta"] = {
        "mode": args.mode,
        "created_at": datetime.now().isoformat(),
        "val_macro_f1_before": round(f1_before, 4),
        "val_macro_f1_after": round(f1_after, 4),
        "uncertain_ratio": round(float(uncertain_ratio), 4),
    }

    output_path = ckpt_dir / "thresholds.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n저장: {output_path}")


if __name__ == "__main__":
    main()
