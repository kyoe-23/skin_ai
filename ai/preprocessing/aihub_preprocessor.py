"""AI Hub 08-14 안면부 피부질환 데이터 전처리 파이프라인.

실제 데이터셋 구조:
    dataset_14/
    ├── Training/
    │   ├── 01_raw/    ← TS_{클래스}_{방향}.zip  (이미지, flat 구조)
    │   └── 02_label/  ← TL_{클래스}_{방향}.zip  (JSON 라벨, flat 구조)
    └── Validation/
        ├── 01_raw/    ← VS_{클래스}_{방향}.zip
        └── 02_label/  ← VL_{클래스}_{방향}.zip

사용법:
    python -m ai.preprocessing.aihub_preprocessor --data_root data/dataset_14
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import json
import logging
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── 서드파티 ─────────────────────────────────────────────────────
import pandas as pd
from tqdm import tqdm

# ── 상수 ─────────────────────────────────────────────────────────
CLASS_MAP = {
    "건선": 0, "아토피피부염": 1, "여드름": 2,
    "주사": 3, "지루피부염": 4, "정상": 5,
}
IDX_TO_CLASS = {v: k for k, v in CLASS_MAP.items()}

# ZIP명 두 번째 세그먼트 → 정식 클래스명 정규화
CLASS_NAME_ALIASES = {
    "아토피": "아토피피부염",
    "지루": "지루피부염",
}

SPLIT_DIR_MAP = {
    "Training": "train",
    "Validation": "val",
}

DIRECTION_MAP = {
    "정면": "front",
    "측면": "side",
}

RAW_SUBDIR = "01_raw"
LABEL_SUBDIR = "02_label"

logger = logging.getLogger(__name__)


# ── 헬퍼 ─────────────────────────────────────────────────────────

def _parse_zip_name(zip_name: str) -> Optional[dict]:
    """ZIP 파일명에서 클래스명과 방향 추출.

    형식: TS_건선_정면.zip  (접두사_클래스_방향.zip)

    Args:
        zip_name: ZIP 파일명 (확장자 포함)

    Returns:
        dict | None: {'class_name': str, 'direction': str} 또는 파싱 실패 시 None
    """
    stem = Path(zip_name).stem       # TS_건선_정면
    parts = stem.split("_")
    if len(parts) < 3:
        return None

    raw_class = parts[1]
    raw_direction = parts[2]

    class_name = CLASS_NAME_ALIASES.get(raw_class, raw_class)
    if class_name not in CLASS_MAP:
        logger.warning(f"[WARN] 알 수 없는 클래스: '{raw_class}' (파일: {zip_name})")
        return None

    direction = DIRECTION_MAP.get(raw_direction)
    if direction is None:
        logger.warning(f"[WARN] 알 수 없는 방향: '{raw_direction}' (파일: {zip_name})")
        return None

    return {"class_name": class_name, "direction": direction}


def _build_json_index(label_zip_path: Path) -> dict:
    """라벨 ZIP에서 identifier → 메타데이터 인덱스 구축.

    JSON 구조:
        {"annotations": [{"identifier": "...", "generated_parameters": {...}, ...}]}

    Args:
        label_zip_path: 라벨 ZIP 경로

    Returns:
        dict: {identifier: {gender, age_range, race, severity, lesion_type}}
    """
    index = {}
    if not label_zip_path.exists():
        logger.warning(f"[WARN] 라벨 ZIP 없음: {label_zip_path.name}")
        return index

    try:
        with zipfile.ZipFile(label_zip_path) as zf:
            json_names = [n for n in zf.namelist() if n.endswith(".json")]
            for name in json_names:
                try:
                    with zf.open(name) as f:
                        data = json.load(f)
                    for ann in data.get("annotations", []):
                        identifier = ann.get("identifier", "")
                        if not identifier:
                            continue

                        params = ann.get("generated_parameters", {})
                        diag = ann.get("diagnosis_info", {})
                        bbox = ann.get("bbox", {})
                        lesions = bbox.get("lesions", [])

                        # severity: 아토피 전용 (easi_score.iga_grade)
                        severity = diag.get("easi_score", {}).get("iga_grade", "")
                        # lesion_type: 여드름 전용 (첫 번째 병변의 염증성 여부)
                        lesion_type = ""
                        if lesions:
                            lesion_type = str(lesions[0].get("inflammatory", ""))

                        index[identifier] = {
                            "gender": params.get("gender", ""),
                            "age_range": params.get("age_range", ""),
                            "race": params.get("race", ""),
                            "severity": severity,
                            "lesion_type": lesion_type,
                        }
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"[WARN] JSON 파싱 실패: {name} — {e}")
    except zipfile.BadZipFile as e:
        logger.error(f"[ERROR] 라벨 ZIP 손상: {label_zip_path.name} — {e}")

    return index


def _label_zip_path(raw_zip_path: Path) -> Path:
    """원천 ZIP 경로에서 대응 라벨 ZIP 경로 반환.

    01_raw/TS_건선_정면.zip → 02_label/TL_건선_정면.zip

    Args:
        raw_zip_path: 원천 ZIP 경로

    Returns:
        Path: 라벨 ZIP 경로
    """
    label_name = raw_zip_path.name[0] + "L" + raw_zip_path.name[2:]
    return raw_zip_path.parent.parent / LABEL_SUBDIR / label_name


# ── 메인 클래스 ──────────────────────────────────────────────────

class AIHubPreprocessor:
    """AI Hub 08-14 데이터 전처리기.

    dataset_14/ 폴더를 직접 스캔하여 ZIP 내 파일 목록을 수집하고
    라벨 JSON 메타데이터와 결합해 train.csv, val.csv를 생성한다.
    압축 해제 없이 ZIP 경로와 파일명을 CSV에 기록한다.

    Args:
        data_root: dataset_14/ 폴더 경로
        output_dir: 출력 CSV 저장 경로
    """

    def __init__(self, data_root: str, output_dir: str):
        self.data_root = Path(data_root)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run(self):
        """전체 전처리 파이프라인 실행."""
        print("=" * 60)
        print("AI Hub 08-14 전처리 파이프라인")
        print(f"  data_root : {self.data_root.resolve()}")
        print(f"  output_dir: {self.output_dir.resolve()}")
        print("=" * 60)

        print("\n[1/3] ZIP 스캔 + JSON 메타데이터 추출...")
        df = self._collect_records()

        print(f"\n[2/3] 유효성 검사...")
        df = self._validate(df)

        print(f"\n[3/3] CSV 저장...")
        split_dfs = self._save_csv(df)

        print("\n" + "=" * 60)
        self._print_summary(split_dfs)

    def _collect_records(self) -> pd.DataFrame:
        """dataset_14/ 하위 ZIP을 순회하며 레코드 수집.

        Returns:
            pd.DataFrame: 전체 이미지 레코드 (zip_path, filename, class_name 등)
        """
        records = []

        for split_dir_name, split in SPLIT_DIR_MAP.items():
            raw_dir = self.data_root / split_dir_name / RAW_SUBDIR
            if not raw_dir.exists():
                logger.warning(f"[WARN] 디렉토리 없음: {raw_dir}")
                continue

            raw_zips = sorted(raw_dir.glob("*.zip"))
            logger.info(f"[INFO] {split_dir_name}: {len(raw_zips)}개 원천 ZIP 발견")

            for raw_zip in tqdm(raw_zips, desc=f"  {split}", unit="ZIP"):
                parsed = _parse_zip_name(raw_zip.name)
                if parsed is None:
                    continue

                class_name = parsed["class_name"]
                direction = parsed["direction"]
                label_zip = _label_zip_path(raw_zip)

                # 라벨 JSON 인덱스 구축 (identifier → 메타데이터)
                json_index = _build_json_index(label_zip)

                try:
                    with zipfile.ZipFile(raw_zip) as zf:
                        img_names = [
                            n for n in zf.namelist()
                            if n.lower().endswith(".png") or n.lower().endswith(".jpg")
                        ]
                except zipfile.BadZipFile as e:
                    logger.error(f"[ERROR] 원천 ZIP 손상: {raw_zip.name} — {e}")
                    continue

                for raw_name in img_names:
                    # leading slash 제거
                    filename = raw_name.lstrip("/")
                    identifier = Path(filename).stem

                    meta = json_index.get(identifier, {})
                    records.append({
                        "zip_path": str(raw_zip.resolve()),
                        "filename": filename,
                        "class_name": class_name,
                        "class_idx": CLASS_MAP[class_name],
                        "split": split,
                        "direction": direction,
                        "gender": meta.get("gender", ""),
                        "age_range": meta.get("age_range", ""),
                        "race": meta.get("race", ""),
                        "severity": meta.get("severity", ""),
                        "lesion_type": meta.get("lesion_type", ""),
                    })

        df = pd.DataFrame(records)
        print(f"  → 총 {len(df)}건 수집")
        return df

    def _validate(self, df: pd.DataFrame) -> pd.DataFrame:
        """기본 유효성 검사: 빈 데이터, 클래스 범위.

        Args:
            df: 수집된 레코드 DataFrame

        Returns:
            pd.DataFrame: 유효한 레코드만
        """
        before = len(df)

        # 알 수 없는 클래스 제거
        max_class_idx = len(CLASS_MAP) - 1
        valid_mask = df["class_idx"].between(0, max_class_idx)
        invalid = (~valid_mask).sum()
        if invalid:
            logger.warning(f"[WARN] 유효하지 않은 클래스 {invalid}건 제거")
        df = df[valid_mask].reset_index(drop=True)

        print(f"  → 유효 레코드: {len(df)}건 (제거: {before - len(df)}건)")
        return df

    def _save_csv(self, df: pd.DataFrame) -> dict[str, pd.DataFrame]:
        """split별 CSV 및 metadata.json 저장.

        Args:
            df: 전체 레코드 DataFrame

        Returns:
            dict: {split_name: DataFrame}
        """
        columns = [
            "zip_path", "filename", "class_idx", "class_name", "split", "direction",
            "gender", "age_range", "race", "severity", "lesion_type",
        ]

        split_dfs = {}
        for split_name in ["train", "val", "test"]:
            split_df = df[df["split"] == split_name].reset_index(drop=True)
            split_dfs[split_name] = split_df
            if len(split_df) == 0:
                continue
            csv_path = self.output_dir / f"{split_name}.csv"
            split_df[columns].to_csv(csv_path, index=False)
            print(f"  → {csv_path.name}: {len(split_df)}건")

        all_df = pd.concat(
            [d for d in split_dfs.values() if len(d) > 0], ignore_index=True
        )
        metadata = {
            "num_classes": len(CLASS_MAP),
            "class_map": CLASS_MAP,
            "splits": {name: len(d) for name, d in split_dfs.items()},
            "class_distribution": {
                split: all_df[all_df["split"] == split]["class_name"]
                .value_counts().to_dict()
                for split in ["train", "val"]
            },
            "processed_at": datetime.now().isoformat(),
        }
        meta_path = self.output_dir / "metadata.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
        print(f"  → metadata.json 저장")

        return split_dfs

    def _print_summary(self, split_dfs: dict[str, pd.DataFrame]):
        """클래스별 분포 요약 출력."""
        print("전처리 완료 요약")
        print("=" * 60)
        for split_name, split_df in split_dfs.items():
            if len(split_df) == 0:
                continue
            print(f"\n[{split_name}] 총 {len(split_df)}건")
            dist = split_df["class_name"].value_counts()
            for cls_name, count in dist.items():
                print(f"  {cls_name:12s}: {count:5d}장")


# ── 진입점 ────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Hub 08-14 전처리")
    parser.add_argument(
        "--data_root", default="data/dataset_14",
        help="dataset_14/ 폴더 경로 (기본: data/dataset_14)",
    )
    parser.add_argument(
        "--output_dir", default="data/processed/DS14",
        help="출력 CSV 저장 경로 (기본: data/processed/DS14)",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    preprocessor = AIHubPreprocessor(args.data_root, args.output_dir)
    preprocessor.run()


if __name__ == "__main__":
    main()
