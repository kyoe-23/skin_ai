"""외부 임상 이미지 전처리 — DermNet NZ / ISIC 2019 / HAM10000 → CSV 생성.

지원 디렉토리 구조
------------------
DermNet (기본):
    {root_dir}/train/{폴더명}/*.jpg   → train + val 분리
    {root_dir}/test/{폴더명}/*.jpg    → test (홀드아웃)

ISIC 2019 (--flat 옵션):
    {root_dir}/{LABEL}/*.jpg          → train + val 분리 (test 없음)

HAM10000 (--metadata_csv 옵션):
    {root_dir}/**/*.jpg               → 전체 스캔 후 CSV 레이블 매칭
    metadata_csv: image_id, dx 컬럼을 가진 CSV

사용법:
    # DermNet
    python -m ai.preprocessing.external_preprocessor \
        --root_dir data/dermnet \
        --output_dir data/processed/dermnet \
        --val_ratio 0.15

    # ISIC 2019
    python -m ai.preprocessing.external_preprocessor \
        --root_dir "data/ISIC 2019" \
        --output_dir data/processed/isic2019 \
        --source isic2019 \
        --class_map_file ai/preprocessing/class_maps/isic2019_class_map.json \
        --class_idx_map_file ai/preprocessing/class_maps/unified_class_idx_map.json \
        --flat \
        --max_per_class 3000

    # HAM10000
    python -m ai.preprocessing.external_preprocessor \
        --root_dir data/HAM10000 \
        --output_dir data/processed/ham10000 \
        --source ham10000 \
        --class_map_file ai/preprocessing/class_maps/ham10000_class_map.json \
        --class_idx_map_file ai/preprocessing/class_maps/unified_class_idx_map.json \
        --metadata_csv data/HAM10000/HAM10000_metadata.csv \
        --max_per_class 3000

출력 CSV 컬럼:
    image_path  : 프로젝트 루트 기준 상대경로 (root_dir → ExternalFacialDataset의 root_dir로 복원)
    class_idx   : 정수 인덱스
    class_name  : 한국어 클래스명
    split       : train / val / test
    source      : 데이터 출처 (dermnet / isic2019 등)

주의: 반드시 프로젝트 루트에서 실행해야 상대경로가 올바르게 저장됩니다.
"""
from __future__ import annotations

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
import random
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import pandas as pd
from sklearn.model_selection import train_test_split

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
# DermNet NZ Kaggle 폴더명 → AI Hub DS14 6종 매핑
# None 값 → 매핑 불가 → 자동 제외
DERMNET_CLASS_MAP: dict[str, str | None] = {
    "Psoriasis pictures Lichen Planus and related diseases": "건선",
    "Atopic Dermatitis Photos": "아토피피부염",
    "Eczema Photos": "아토피피부염",
    "Acne and Rosacea Photos": "여드름",        # 주사 혼재 — 레이블 노이즈 감수
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

# DS_unified 11종 기본 클래스 인덱스 맵 (--class_idx_map_file 미지정 시 사용)
CLASS_IDX_MAP_DEFAULT: dict[str, int] = {
    "건선": 0, "아토피피부염": 1, "여드름": 2,
    "광선각화증": 3, "기저세포암": 4, "멜라닌세포모반": 5, "악성흑색종": 6,
    "지루각화증": 7, "편평세포암": 8, "피부섬유종": 9, "혈관종": 10,
}

VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
RANDOM_STATE = 42


# ── 헬퍼 함수 ─────────────────────────────────────────────────────

def _load_class_map(class_map_file: str | None) -> dict[str, str | None]:
    """폴더명 → 클래스명 매핑 JSON 로드. 없으면 DERMNET_CLASS_MAP 반환."""
    if class_map_file is None:
        return DERMNET_CLASS_MAP
    try:
        with open(class_map_file, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"클래스 매핑 파일 로드 실패: {e}") from e


def _load_class_idx_map(class_idx_map_file: str | None) -> dict[str, int]:
    """클래스명 → 인덱스 매핑 JSON 로드. 없으면 CLASS_IDX_MAP_DEFAULT(11종) 반환."""
    if class_idx_map_file is None:
        return CLASS_IDX_MAP_DEFAULT
    try:
        with open(class_idx_map_file, "r", encoding="utf-8") as f:
            return {k: int(v) for k, v in json.load(f).items()}
    except (OSError, json.JSONDecodeError) as e:
        raise ValueError(f"클래스 인덱스 매핑 파일 로드 실패: {e}") from e


def _to_relative_path(img_path: Path) -> str:
    """이미지 경로를 프로젝트 루트(CWD) 기준 상대경로 문자열로 변환.

    절대경로 하드코딩을 방지하기 위해 resolve() 대신 이 함수를 사용한다.
    실행 환경이 달라져도 ExternalFacialDataset의 root_dir만 교체하면 복원 가능.
    """
    try:
        return str(img_path.relative_to(Path.cwd()))
    except ValueError:
        # img_path가 CWD 밖에 있는 경우 (절대경로로 root_dir를 지정했을 때)
        # root_dir 이하 경로만 추출해 저장
        logger.warning(f"[WARNING] 상대경로 변환 실패, 원본 경로 사용: {img_path}")
        return str(img_path)


def _scan_split_dir(
    split_dir: Path,
    class_map: dict[str, str | None],
    class_idx_map: dict[str, int],
    source: str,
) -> list[dict]:
    """train/ 또는 test/ 서브디렉토리를 순회해 레코드 리스트 반환.

    Args:
        split_dir: DermNet의 train/ 또는 test/ 절대경로
        class_map: 폴더명 → 클래스명 매핑
        class_idx_map: 클래스명 → 인덱스 매핑
        source: 데이터 출처 이름

    Returns:
        list[dict]: image_path(상대경로), class_name, class_idx, source
    """
    if not split_dir.exists():
        logger.warning(f"[WARNING] 디렉토리 없음: {split_dir}")
        return []

    records: list[dict] = []
    skipped_folders: list[str] = []

    for folder in sorted(split_dir.iterdir()):
        if not folder.is_dir():
            continue

        class_name = class_map.get(folder.name)
        if class_name is None:
            skipped_folders.append(folder.name)
            continue

        class_idx = class_idx_map.get(class_name)
        if class_idx is None:
            logger.warning(f"[WARNING] 인덱스 맵에 없는 클래스: {class_name} (폴더: {folder.name})")
            continue

        for img_path in sorted(folder.iterdir()):
            if img_path.suffix.lower() not in VALID_EXTENSIONS:
                continue
            records.append({
                "image_path": _to_relative_path(img_path),
                "class_name": class_name,
                "class_idx": class_idx,
                "source": source,
            })

    if skipped_folders:
        logger.info(f"[INFO] 매핑 없어 제외된 폴더 ({len(skipped_folders)}개): {skipped_folders[:3]}...")

    return records


def _scan_flat_dir(
    root_dir: Path,
    class_map: dict[str, str | None],
    class_idx_map: dict[str, int],
    source: str,
    max_per_class: int | None,
) -> list[dict]:
    """flat 구조 디렉토리 스캔 (ISIC 2019 등 train/test 서브디렉토리 없는 경우).

    {root_dir}/{LABEL}/*.jpg 구조를 직접 순회한다.
    max_per_class 지정 시 클래스당 무작위 다운샘플 적용.

    Args:
        root_dir: 데이터셋 루트 (하위에 레이블 폴더 직접 위치)
        class_map: 폴더명(레이블) → 클래스명 매핑
        class_idx_map: 클래스명 → 인덱스 매핑
        source: 데이터 출처 이름
        max_per_class: 클래스당 최대 샘플 수 (None이면 전체 사용)

    Returns:
        list[dict]: image_path(상대경로), class_name, class_idx, source
    """
    if not root_dir.exists():
        logger.warning(f"[WARNING] 디렉토리 없음: {root_dir}")
        return []

    records: list[dict] = []
    skipped_folders: list[str] = []
    rng = random.Random(RANDOM_STATE)

    for folder in sorted(root_dir.iterdir()):
        if not folder.is_dir():
            continue

        class_name = class_map.get(folder.name)
        if class_name is None:
            skipped_folders.append(folder.name)
            continue

        class_idx = class_idx_map.get(class_name)
        if class_idx is None:
            logger.warning(f"[WARNING] 인덱스 맵에 없는 클래스: {class_name} (폴더: {folder.name})")
            continue

        img_paths = [
            p for p in sorted(folder.iterdir())
            if p.suffix.lower() in VALID_EXTENSIONS
        ]

        if max_per_class is not None and len(img_paths) > max_per_class:
            img_paths = rng.sample(img_paths, max_per_class)
            logger.info(f"[INFO] 다운샘플: {class_name} {len(img_paths)} → {max_per_class}장")

        for img_path in img_paths:
            records.append({
                "image_path": _to_relative_path(img_path),
                "class_name": class_name,
                "class_idx": class_idx,
                "source": source,
            })

    if skipped_folders:
        logger.info(f"[INFO] 매핑 없어 제외된 폴더 ({len(skipped_folders)}개): {skipped_folders[:3]}...")

    return records


def _scan_csv_metadata(
    root_dir: Path,
    metadata_csv: str,
    class_map: dict[str, str | None],
    class_idx_map: dict[str, int],
    source: str,
    max_per_class: int | None,
) -> list[dict]:
    """CSV 메타데이터 기반 스캔 (HAM10000 등).

    이미지 파일이 여러 서브디렉토리에 혼재할 때 사용.
    root_dir 하위 전체 이미지를 image_id(파일명 확장자 제외)로 인덱싱 후
    metadata CSV의 레이블과 매칭한다.

    Args:
        root_dir: 이미지가 존재하는 루트 디렉토리 (재귀 탐색)
        metadata_csv: image_id·dx 컬럼을 가진 CSV 경로
        class_map: dx코드 → 클래스명 매핑 (None이면 제외)
        class_idx_map: 클래스명 → 인덱스 매핑
        source: 데이터 출처 이름
        max_per_class: 클래스당 최대 샘플 수
    """
    logger.info(f"[INFO] 이미지 인덱싱 중: {root_dir}")
    img_index: dict[str, Path] = {}
    for img_path in root_dir.rglob("*"):
        if img_path.suffix.lower() in VALID_EXTENSIONS:
            img_index[img_path.stem] = img_path
    logger.info(f"[INFO] 인덱싱 완료: {len(img_index)}개 이미지")

    try:
        meta_df = pd.read_csv(metadata_csv)
    except (OSError, pd.errors.ParserError) as e:
        raise ValueError(f"metadata_csv 로드 실패: {e}") from e

    if "image_id" not in meta_df.columns or "dx" not in meta_df.columns:
        raise ValueError(f"metadata_csv에 image_id, dx 컬럼이 필요합니다: {list(meta_df.columns)}")

    rng = random.Random(RANDOM_STATE)
    records_by_class: dict[str, list[dict]] = {}

    for _, row in meta_df.iterrows():
        image_id = str(row["image_id"])
        dx_code = str(row["dx"])

        class_name = class_map.get(dx_code)
        if class_name is None:
            continue

        class_idx = class_idx_map.get(class_name)
        if class_idx is None:
            logger.warning(f"[WARNING] 인덱스 맵에 없는 클래스: {class_name} (dx: {dx_code})")
            continue

        img_path = img_index.get(image_id)
        if img_path is None:
            logger.warning(f"[WARNING] 이미지 없음: {image_id}")
            continue

        records_by_class.setdefault(class_name, []).append({
            "image_path": _to_relative_path(img_path),
            "class_name": class_name,
            "class_idx": class_idx,
            "source": source,
        })

    records: list[dict] = []
    for class_name, class_records in records_by_class.items():
        if max_per_class is not None and len(class_records) > max_per_class:
            class_records = rng.sample(class_records, max_per_class)
            logger.info(f"[INFO] 다운샘플: {class_name} → {max_per_class}장")
        records.extend(class_records)

    return records


def _split_train_val(df: pd.DataFrame, val_ratio: float) -> tuple[pd.DataFrame, pd.DataFrame]:
    """클래스별 stratified split으로 train/val 분리."""
    train_df, val_df = train_test_split(
        df,
        test_size=val_ratio,
        stratify=df["class_name"],
        random_state=RANDOM_STATE,
    )
    return train_df.reset_index(drop=True), val_df.reset_index(drop=True)


def _save_csvs(splits: dict[str, pd.DataFrame], output_dir: Path, source: str) -> None:
    """split별 CSV와 metadata.json을 output_dir에 저장."""
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
        "source": source,
        "total": total,
        "splits": {k: len(v) for k, v in splits.items() if not v.empty},
        "class_distribution": class_dist,
    }
    meta_path = output_dir / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    logger.info(f"[INFO] metadata.json 저장: {meta_path}")


# ── 메인 ─────────────────────────────────────────────────────────

def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(
        description="외부 임상 이미지 → CSV 전처리 (DermNet NZ / ISIC 2019 등)"
    )
    parser.add_argument("--root_dir", required=True,
                        help="데이터셋 루트 디렉토리")
    parser.add_argument("--output_dir", required=True,
                        help="CSV 출력 경로")
    parser.add_argument("--val_ratio", type=float, default=0.15,
                        help="train에서 val로 분리할 비율 (기본: 0.15)")
    parser.add_argument("--source", default="dermnet",
                        help="데이터 출처 이름 (CSV source 컬럼 및 metadata에 기록)")
    parser.add_argument("--class_map_file", default=None,
                        help="폴더명 → 클래스명 JSON (기본: DERMNET_CLASS_MAP)")
    parser.add_argument("--class_idx_map_file", default=None,
                        help="클래스명 → 인덱스 JSON (기본: DS_unified 11종 CLASS_IDX_MAP_DEFAULT)")
    parser.add_argument("--flat", action="store_true",
                        help="flat 구조 모드 — train/test 서브디렉토리 없이 {root_dir}/{LABEL}/ 직접 스캔 (ISIC 2019)")
    parser.add_argument("--metadata_csv", default=None,
                        help="CSV 메타데이터 경로 (HAM10000 등 — image_id, dx 컬럼 필요). 지정 시 flat/split 모드 무시.")
    parser.add_argument("--max_per_class", type=int, default=None,
                        help="클래스당 최대 샘플 수 (다운샘플, 기본: 제한 없음)")
    args = parser.parse_args()

    root_dir = Path(args.root_dir)
    output_dir = Path(args.output_dir)

    if not root_dir.exists():
        raise FileNotFoundError(f"[ERROR] root_dir 없음: {root_dir}")

    class_map = _load_class_map(args.class_map_file)
    class_idx_map = _load_class_idx_map(args.class_idx_map_file)

    mode = "metadata_csv" if args.metadata_csv else ("flat" if args.flat else "split")
    print("=" * 60)
    print(f"외부 데이터셋 전처리 ({mode} 모드)")
    print(f"  root_dir       : {root_dir}")
    print(f"  output_dir     : {output_dir}")
    print(f"  val_ratio      : {args.val_ratio}")
    print(f"  source         : {args.source}")
    print(f"  max_per_class  : {args.max_per_class or '제한 없음'}")
    if args.metadata_csv:
        print(f"  metadata_csv   : {args.metadata_csv}")
    print("=" * 60)

    if args.metadata_csv:
        # HAM10000 등 CSV 레이블 기반 스캔
        all_records = _scan_csv_metadata(
            root_dir, args.metadata_csv, class_map, class_idx_map,
            args.source, args.max_per_class,
        )
        if not all_records:
            raise RuntimeError(
                "[ERROR] 매핑된 이미지를 찾지 못했습니다. metadata_csv와 class_map_file을 확인하세요."
            )
        all_df = pd.DataFrame(all_records)
        train_df, val_df = _split_train_val(all_df, args.val_ratio)
        test_df = pd.DataFrame()
    elif args.flat:
        # ISIC 2019 등 flat 구조 — train/test 구분 없이 전체 분리
        all_records = _scan_flat_dir(
            root_dir, class_map, class_idx_map, args.source, args.max_per_class
        )
        if not all_records:
            raise RuntimeError(
                "[ERROR] 매핑된 이미지를 찾지 못했습니다. root_dir와 class_map_file을 확인하세요."
            )
        all_df = pd.DataFrame(all_records)
        train_df, val_df = _split_train_val(all_df, args.val_ratio)
        test_df = pd.DataFrame()
    else:
        # DermNet 등 train/test 서브디렉토리 구조
        train_records = _scan_split_dir(root_dir / "train", class_map, class_idx_map, args.source)
        if not train_records:
            raise RuntimeError(
                "[ERROR] train/ 에서 매핑된 이미지를 찾지 못했습니다. 경로와 클래스 매핑을 확인하세요."
            )
        train_all_df = pd.DataFrame(train_records)
        train_df, val_df = _split_train_val(train_all_df, args.val_ratio)

        test_records = _scan_split_dir(root_dir / "test", class_map, class_idx_map, args.source)
        test_df = pd.DataFrame(test_records) if test_records else pd.DataFrame()

    _save_csvs({"train": train_df, "val": val_df, "test": test_df}, output_dir, args.source)

    print("\n클래스별 분포 (train):")
    for class_name, count in sorted(train_df["class_name"].value_counts().items()):
        print(f"  {class_name:<12}: {count:>5}장")

    print(f"\n  train: {len(train_df)}건 | val: {len(val_df)}건 | test: {len(test_df)}건")
    print(f"  출력: {output_dir}")
    print("완료.")


if __name__ == "__main__":
    main()
