"""외부 임상 이미지 전처리 — DermNet NZ (Kaggle) 디렉토리 → CSV 생성.

DermNet Kaggle 디렉토리 구조:
    {root_dir}/train/{폴더명}/*.jpg   → train.csv (학습용, AI Hub와 혼합)
    {root_dir}/test/{폴더명}/*.jpg    → test.csv  (홀드아웃, 학습에 미사용)
    train에서 val_ratio 비율로 val.csv 추가 분리

사용법:
    python -m ai.preprocessing.external_preprocessor \
        --root_dir data/external/dermnet \
        --output_dir data/processed/external \
        --val_ratio 0.15

출력 CSV 컬럼:
    image_path, class_idx, class_name, split, source
"""
from __future__ import annotations


# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import pandas as pd
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
# DermNet NZ Kaggle 폴더명 → AI Hub 6종 매핑
# None 값은 매핑 불가 → 학습 제외
DERMNET_CLASS_MAP: dict[str, str | None] = {
    # 실제 Kaggle DermNet 폴더명 기준 (대소문자 정확히 일치해야 함)
    "Psoriasis pictures Lichen Planus and related diseases": "건선",
    "Atopic Dermatitis Photos": "아토피피부염",
    "Eczema Photos": "아토피피부염",
    "Acne and Rosacea Photos": "여드름",        # 주사 혼재 — 레이블 노이즈 감수
    # 지루피부염 없음 — DermNet에 seborrheic dermatitis 폴더 미존재
    # (Seborrheic Keratoses는 다른 질환 → None 처리)
    # 매핑 불가 폴더: None → 자동 제외
    "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions": None,
    "Bullous Disease Photos": None,
    "Cellulitis Impetigo and other Bacterial Infections": None,
    "Exanthems and Drug Eruptions": None,
    "Hair Loss Photos Alopecia and other Hair Diseases": None,
    "Herpes HPV and other STDs Photos": None,
    "Light Diseases and Disorders of Pigmentation": None,
    "Lupus and other Connective Tissue diseases": None,
    "Melanoma Skin Cancer Nevi and Moles": None,
    "Nail Fungus and other Nail Disease": None,
    "Poison Ivy Photos and other Contact Dermatitis": None,
    "Scabies Lyme Disease and other Infestations and Bites": None,
    "Seborrheic Keratoses and other Benign Tumors": None,
    "Systemic Disease": None,
    "Tinea Ringworm Candidiasis and other Fungal Infections": None,
    "Urticaria Hives": None,
    "Vascular Tumors": None,
    "Vasculitis Photos": None,
    "Warts Molluscum and other Viral Infections": None,
}

CLASS_MAP_6 = {
    "건선": 0, "아토피피부염": 1, "여드름": 2,
    "주사": 3, "지루피부염": 4, "정상": 5,
}

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
RANDOM_STATE = 42


# ── 헬퍼 함수 ─────────────────────────────────────────────────────

def _load_class_map(class_map_file: str | None) -> dict[str, str | None]:
    """사용자 지정 JSON 매핑 파일 로드. 없으면 기본 DERMNET_CLASS_MAP 반환."""
    if class_map_file is None:
        return DERMNET_CLASS_MAP
    try:
        with open(class_map_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"클래스 매핑 파일 로드 실패: {e}") from e


def _scan_split_dir(split_dir: Path, class_map: dict, source: str) -> list[dict]:
    """split 디렉토리(train/ 또는 test/)를 순회해 레코드 리스트 반환.

    Args:
        split_dir: DermNet의 train/ 또는 test/ 절대경로
        class_map: 폴더명 → AI Hub 클래스명 매핑 dict
        source: 데이터 출처 이름 (예: 'dermnet')

    Returns:
        list[dict]: image_path, class_name, class_idx, source 포함 레코드
    """
    if not split_dir.exists():
        logger.warning(f"[WARNING] 디렉토리 없음: {split_dir}")
        return []

    records = []
    skipped_folders: list[str] = []

    for folder in sorted(split_dir.iterdir()):
        if not folder.is_dir():
            continue

        class_name = class_map.get(folder.name)
        if class_name is None:
            skipped_folders.append(folder.name)
            continue

        class_idx = CLASS_MAP_6.get(class_name)
        if class_idx is None:
            logger.warning(f"[WARNING] AI Hub 6종에 없는 클래스: {class_name} (폴더: {folder.name})")
            continue

        for img_path in sorted(folder.iterdir()):
            if img_path.suffix.lower() not in VALID_EXTENSIONS:
                continue
            records.append({
                "image_path": str(img_path.resolve()),
                "class_name": class_name,
                "class_idx": class_idx,
                "source": source,
            })

    if skipped_folders:
        logger.info(f"[INFO] 매핑 없어 제외된 폴더 ({len(skipped_folders)}개): {skipped_folders[:3]}...")

    return records


def _split_train_val(df: pd.DataFrame, val_ratio: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """클래스별 stratified split으로 train/val 분리.

    Args:
        df: 전체 train 레코드 DataFrame
        val_ratio: val 비율 (0 < val_ratio < 1)

    Returns:
        (train_df, val_df)
    """
    train_df, val_df = train_test_split(
        df,
        test_size=val_ratio,
        stratify=df["class_name"],
        random_state=RANDOM_STATE,
    )
    return train_df.reset_index(drop=True), val_df.reset_index(drop=True)


def _save_csvs(splits: dict[str, pd.DataFrame], output_dir: Path) -> None:
    """split별 CSV와 metadata.json을 output_dir에 저장.

    Args:
        splits: {"train": df, "val": df, "test": df} 형태
        output_dir: 출력 디렉토리
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    class_dist: dict[str, dict] = {}
    total = 0

    for split_name, df in splits.items():
        if df.empty:
            continue
        df["split"] = split_name
        csv_path = output_dir / f"{split_name}.csv"
        df.to_csv(csv_path, index=False)
        count = len(df)
        total += count
        class_dist[split_name] = df["class_name"].value_counts().to_dict()
        logger.info(f"[INFO] {split_name}.csv 저장: {count}건 → {csv_path}")

    metadata = {
        "source": "dermnet_kaggle",
        "total": total,
        "splits": {k: len(v) for k, v in splits.items() if not v.empty},
        "class_distribution": class_dist,
        "class_map": CLASS_MAP_6,
    }
    meta_path = output_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    logger.info(f"[INFO] metadata.json 저장: {meta_path}")


# ── 메인 ─────────────────────────────────────────────────────────

def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="외부 임상 이미지 → CSV 전처리 (DermNet NZ Kaggle)")
    parser.add_argument("--root_dir", required=True,
                        help="DermNet 다운로드 루트 (train/, test/ 서브디렉토리 포함)")
    parser.add_argument("--output_dir", required=True,
                        help="CSV 출력 경로 (data/processed/external)")
    parser.add_argument("--val_ratio", type=float, default=0.15,
                        help="train 데이터에서 val로 분리할 비율 (기본: 0.15)")
    parser.add_argument("--source", default="dermnet",
                        help="데이터 출처 이름 (CSV source 컬럼에 기록)")
    parser.add_argument("--class_map_file", default=None,
                        help="사용자 정의 클래스 매핑 JSON (기본: DERMNET_CLASS_MAP)")
    args = parser.parse_args()

    root_dir = Path(args.root_dir)
    output_dir = Path(args.output_dir)

    if not root_dir.exists():
        raise FileNotFoundError(f"[ERROR] root_dir 없음: {root_dir}")

    class_map = _load_class_map(args.class_map_file)

    print("=" * 60)
    print("외부 데이터셋 전처리 (DermNet NZ Kaggle)")
    print(f"  root_dir  : {root_dir}")
    print(f"  output_dir: {output_dir}")
    print(f"  val_ratio : {args.val_ratio}")
    print("=" * 60)

    # train/ 스캔 → train + val 분리
    train_records = _scan_split_dir(root_dir / "train", class_map, args.source)
    if not train_records:
        raise RuntimeError("[ERROR] train/ 에서 매핑된 이미지를 찾지 못했습니다. 경로와 클래스 매핑을 확인하세요.")

    train_all_df = pd.DataFrame(train_records)
    train_df, val_df = _split_train_val(train_all_df, args.val_ratio)

    # test/ 스캔 → 홀드아웃 test (학습에 미사용)
    test_records = _scan_split_dir(root_dir / "test", class_map, args.source)
    test_df = pd.DataFrame(test_records) if test_records else pd.DataFrame()

    _save_csvs({"train": train_df, "val": val_df, "test": test_df}, output_dir)

    print("\n클래스별 분포 (train):")
    for class_name, count in sorted(train_df["class_name"].value_counts().items()):
        print(f"  {class_name:<12}: {count:>5}장")

    print(f"\n  train: {len(train_df)}건 | val: {len(val_df)}건 | test: {len(test_df)}건")
    print(f"  출력: {output_dir}")
    print("완료.")


if __name__ == "__main__":
    main()
