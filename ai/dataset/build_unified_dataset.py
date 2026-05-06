"""DS14 + DS15 CSV 필터링·재인덱싱 → 통합 unified 데이터셋 CSV 생성.

DS14(6종)와 DS15(15종) 중 외부 임상 데이터로 검증된 11종만 추출하고,
class_idx를 통합 인덱스(0~10)로 재매핑해 data/processed/unified/ 에 저장한다.

3-way split: DS14·DS15 train 데이터 중 test_ratio 비율을 클래스별 층화 추출해
test.csv 로 분리한다. val.csv 는 원본 그대로 모델 선택용으로 사용한다.

통합 클래스 인덱스 (ai/preprocessing/class_maps/unified_class_idx_map.json):
    0: 건선        (DS14 0→0)
    1: 아토피피부염  (DS14 1→1)
    2: 여드름       (DS14 2→2)
    3: 광선각화증    (DS15 0→3)
    4: 기저세포암    (DS15 1→4)
    5: 멜라닌세포모반 (DS15 2→5)
    6: 악성흑색종    (DS15 6→6)
    7: 지루각화증    (DS15 7→7)
    8: 편평세포암    (DS15 8→8)
    9: 피부섬유종    (DS15 10→9)
   10: 혈관종       (DS15 12→10)

사용법:
    python -m ai.dataset.build_unified_dataset \\
        --ds14_dir data/processed/DS14 \\
        --ds15_dir data/processed/DS15 \\
        --class_map ai/preprocessing/class_maps/unified_class_idx_map.json \\
        --output_dir data/processed/unified \\
        --test_ratio 0.1
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

# DS14 → unified 재인덱스 맵 (포함할 3종만)
DS14_REMAP: dict[int, int] = {0: 0, 1: 1, 2: 2}
DS14_TARGET_CLASSES = {"건선", "아토피피부염", "여드름"}

# DS15 → unified 재인덱스 맵 (포함할 8종만)
DS15_REMAP: dict[int, int] = {
    0: 3,   # 광선각화증
    1: 4,   # 기저세포암
    2: 5,   # 멜라닌세포모반
    6: 6,   # 악성흑색종
    7: 7,   # 지루각화증
    8: 8,   # 편평세포암
    10: 9,  # 피부섬유종
    12: 10, # 혈관종
}
DS15_TARGET_CLASSES = {
    "광선각화증", "기저세포암", "멜라닌세포모반", "악성흑색종",
    "지루각화증", "편평세포암", "피부섬유종", "혈관종",
}

COMMON_COLS = ["zip_path", "filename", "class_idx", "class_name", "split"]

DEFAULT_TEST_RATIO = 0.1
RANDOM_SEED = 42


def _stratified_split(df: pd.DataFrame, test_ratio: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """클래스별 층화 추출로 train/test 분리."""
    train_parts, test_parts = [], []
    for _, group in df.groupby("class_name"):
        n_test = max(1, round(len(group) * test_ratio))
        test_sample = group.sample(n=n_test, random_state=RANDOM_SEED)
        train_parts.append(group.drop(test_sample.index))
        test_parts.append(test_sample)
    return (
        pd.concat(train_parts, ignore_index=True),
        pd.concat(test_parts, ignore_index=True),
    )


def _load_and_filter(csv_path: Path, target_classes: set[str], remap: dict[int, int], source_tag: str) -> pd.DataFrame:
    """CSV 로드 → 대상 클래스 필터 → class_idx 재매핑."""
    if not csv_path.exists():
        logger.warning(f"[WARNING] CSV 없음, 건너뜀: {csv_path}")
        return pd.DataFrame()

    df = pd.read_csv(csv_path)
    df = df[df["class_name"].isin(target_classes)].copy()
    df["class_idx"] = df["class_idx"].map(remap)
    df["source"] = source_tag

    # AihubFacialDataset 호환 컬럼만 유지
    keep_cols = [c for c in COMMON_COLS + ["source"] if c in df.columns]
    return df[keep_cols].reset_index(drop=True)


def build_unified(
    ds14_dir: Path,
    ds15_dir: Path,
    output_dir: Path,
    class_map_path: Path,
    test_ratio: float = DEFAULT_TEST_RATIO,
) -> None:
    """DS14 + DS15를 필터링·재인덱싱 후 통합 CSV 저장 (3-way split)."""
    with open(class_map_path, "r", encoding="utf-8") as f:
        unified_map = json.load(f)
    logger.info(f"[INFO] 통합 클래스 ({len(unified_map)}종): {list(unified_map.keys())}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # val은 원본 그대로 유지 (모델 선택용)
    for split in ("val",):
        parts = []
        for src_dir, target_cls, remap, tag in (
            (ds14_dir, DS14_TARGET_CLASSES, DS14_REMAP, "DS14"),
            (ds15_dir, DS15_TARGET_CLASSES, DS15_REMAP, "DS15"),
        ):
            df = _load_and_filter(src_dir / f"{split}.csv", target_cls, remap, tag)
            if not df.empty:
                parts.append(df)
                logger.info(f"[INFO] {tag} {split}: {len(df)}건")

        if not parts:
            logger.warning(f"[WARNING] {split} 데이터 없음")
            continue

        combined = pd.concat(parts, ignore_index=True)
        combined["split"] = split
        out_path = output_dir / f"{split}.csv"
        combined.to_csv(out_path, index=False)
        logger.info(f"[INFO] {split}.csv 저장: {len(combined)}건 → {out_path}")
        _print_distribution(combined, unified_map, split)

    # train → 층화 추출로 train / test 분리
    train_parts = []
    for src_dir, target_cls, remap, tag in (
        (ds14_dir, DS14_TARGET_CLASSES, DS14_REMAP, "DS14"),
        (ds15_dir, DS15_TARGET_CLASSES, DS15_REMAP, "DS15"),
    ):
        df = _load_and_filter(src_dir / "train.csv", target_cls, remap, tag)
        if not df.empty:
            train_parts.append(df)
            logger.info(f"[INFO] DS14/DS15 train 로드 ({tag}): {len(df)}건")

    if not train_parts:
        logger.warning("[WARNING] train 데이터 없음")
        return

    all_train = pd.concat(train_parts, ignore_index=True)
    new_train, test_df = _stratified_split(all_train, test_ratio)

    for df, split in ((new_train, "train"), (test_df, "test")):
        df = df.copy()
        df["split"] = split
        out_path = output_dir / f"{split}.csv"
        df.to_csv(out_path, index=False)
        logger.info(f"[INFO] {split}.csv 저장: {len(df)}건 → {out_path}")
        _print_distribution(df, unified_map, split)

    # metadata.json 저장
    meta = {
        "source": "unified (DS14+DS15)",
        "num_classes": len(unified_map),
        "classes": unified_map,
        "ds14_classes": list(DS14_TARGET_CLASSES),
        "ds15_classes": list(DS15_TARGET_CLASSES),
        "test_ratio": test_ratio,
        "random_seed": RANDOM_SEED,
    }
    with open(output_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    logger.info(f"[INFO] metadata.json 저장: {output_dir / 'metadata.json'}")


def _print_distribution(df: pd.DataFrame, unified_map: dict, split: str) -> None:
    """클래스별 분포 출력."""
    print(f"\n[{split}] 클래스별 분포:")
    for name, cnt in df["class_name"].value_counts().sort_index().items():
        idx = unified_map.get(name, "?")
        print(f"  [{idx:>2}] {name:<12}: {cnt:>5}장")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(description="DS14 + DS15 → 통합 unified 데이터셋 CSV 생성")
    parser.add_argument("--ds14_dir", default="data/processed/DS14",
                        help="DS14 전처리 CSV 디렉토리 (기본: data/processed/DS14)")
    parser.add_argument("--ds15_dir", default="data/processed/DS15",
                        help="DS15 전처리 CSV 디렉토리 (기본: data/processed/DS15)")
    parser.add_argument("--class_map", default="ai/preprocessing/class_maps/unified_class_idx_map.json",
                        help="통합 클래스 인덱스 맵 JSON (기본: ai/preprocessing/class_maps/unified_class_idx_map.json)")
    parser.add_argument("--output_dir", default="data/processed/unified",
                        help="출력 CSV 디렉토리 (기본: data/processed/unified)")
    parser.add_argument("--test_ratio", type=float, default=DEFAULT_TEST_RATIO,
                        help=f"train 중 test로 분리할 비율 (기본: {DEFAULT_TEST_RATIO})")
    args = parser.parse_args()

    print("=" * 60)
    print("DS14 + DS15 통합 데이터셋 생성")
    print(f"  DS14 : {args.ds14_dir}")
    print(f"  DS15 : {args.ds15_dir}")
    print(f"  출력 : {args.output_dir}")
    print("=" * 60)

    build_unified(
        ds14_dir=Path(args.ds14_dir),
        ds15_dir=Path(args.ds15_dir),
        output_dir=Path(args.output_dir),
        class_map_path=Path(args.class_map),
        test_ratio=args.test_ratio,
    )
    print("\n완료.")


if __name__ == "__main__":
    main()
