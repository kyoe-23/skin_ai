"""전처리 완료된 CSV 데이터 검증 스크립트.

사용법:
    python -m ai.preprocessing.aihub_validate --processed_dir data/processed/DS14
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import argparse
import io
import json
import zipfile
from pathlib import Path

# ── 서드파티 ─────────────────────────────────────────────────────
import pandas as pd
from PIL import Image, UnidentifiedImageError

# ── 상수 ─────────────────────────────────────────────────────────
REQUIRED_SPLITS = ["train", "val"]
OPTIONAL_SPLITS = ["test"]

REQUIRED_COLUMNS = ["zip_path", "filename", "class_idx", "class_name", "split"]
VALID_LABEL_RANGE = (0, 5)
BALANCE_THRESHOLD = 0.8
SAMPLE_RATIO = 0.1


# ── 헬퍼 ─────────────────────────────────────────────────────────

def _verify_image_from_zip(zip_path: str, filename: str) -> bool:
    """ZIP에서 이미지를 직접 열어 손상 여부 확인.

    Args:
        zip_path: ZIP 파일 절대경로
        filename: ZIP 내 파일명

    Returns:
        bool: 정상이면 True
    """
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for target in [filename, "/" + filename]:
                if target in zf.namelist():
                    with zf.open(target) as f:
                        img = Image.open(io.BytesIO(f.read()))
                        img.verify()
                    return True
        return False
    except (zipfile.BadZipFile, OSError, UnidentifiedImageError):
        return False


def _check_csv_exists(processed_dir: Path, report: dict) -> dict:
    """CSV 파일 존재 확인.

    Returns:
        dict: {split_name: DataFrame}
    """
    print("\n[1/6] CSV 파일 확인...")
    dfs = {}

    for split in REQUIRED_SPLITS + OPTIONAL_SPLITS:
        csv_path = processed_dir / f"{split}.csv"
        is_required = split in REQUIRED_SPLITS

        if csv_path.exists():
            df = pd.read_csv(csv_path)
            dfs[split] = df
            report["passed"].append(f"{split}.csv 존재 ({len(df)}건)")
            print(f"  ✅ {split}.csv: {len(df)}건")
        elif is_required:
            report["failed"].append(f"{split}.csv 누락")
            print(f"  ❌ {split}.csv 누락")
        else:
            report["warnings"].append(f"{split}.csv 없음 (해당 split 미제공 시 정상)")
            print(f"  ⚠️ {split}.csv 없음 (선택)")

    return dfs


def _check_class_balance(dfs: dict, report: dict):
    """클래스별 샘플 수 균형 확인."""
    print("\n[2/6] 클래스 분포 균형 확인...")

    for split, df in dfs.items():
        dist = df["class_name"].value_counts()
        min_count = dist.min()
        max_count = dist.max()
        ratio = min_count / max_count if max_count > 0 else 0

        if ratio >= BALANCE_THRESHOLD:
            report["passed"].append(f"{split} 클래스 균형 양호 (비율: {ratio:.2f})")
            print(f"  ✅ {split}: 균형 양호 (min/max = {ratio:.2f})")
        else:
            report["warnings"].append(f"{split} 클래스 불균형 (비율: {ratio:.2f})")
            print(f"  ⚠️ {split}: 불균형 감지 (min/max = {ratio:.2f})")

        for cls, cnt in dist.items():
            print(f"      {cls}: {cnt}")


def _check_images(dfs: dict, report: dict):
    """ZIP에서 이미지 직접 열기 검증 (샘플)."""
    print(f"\n[3/6] 이미지 열기 검증 ({int(SAMPLE_RATIO * 100)}% 샘플)...")

    for split, df in dfs.items():
        if "zip_path" not in df.columns or "filename" not in df.columns:
            report["warnings"].append(f"{split}: zip_path/filename 컬럼 없음")
            print(f"  ⚠️ {split}: zip_path/filename 컬럼 없음 (건너뜀)")
            continue

        sample_n = max(1, int(len(df) * SAMPLE_RATIO))
        sample = df.sample(n=min(sample_n, len(df)), random_state=42)

        ok = 0
        fail = 0
        for _, row in sample.iterrows():
            if _verify_image_from_zip(row["zip_path"], row["filename"]):
                ok += 1
            else:
                fail += 1

        if fail == 0:
            report["passed"].append(f"{split} 이미지 검증 통과 ({ok}/{len(sample)})")
            print(f"  ✅ {split}: {ok}/{len(sample)} 검증 통과")
        else:
            report["failed"].append(f"{split} 이미지 {fail}건 손상 또는 누락")
            print(f"  ❌ {split}: {fail}/{len(sample)} 손상 또는 누락")


def _check_label_range(dfs: dict, report: dict):
    """label 범위 확인."""
    low, high = VALID_LABEL_RANGE
    print(f"\n[4/6] label 범위 확인 ({low}~{high})...")

    for split, df in dfs.items():
        min_label = int(df["class_idx"].min())
        max_label = int(df["class_idx"].max())

        if min_label >= low and max_label <= high:
            report["passed"].append(f"{split} label 범위 정상 ({min_label}~{max_label})")
            print(f"  ✅ {split}: {min_label}~{max_label}")
        else:
            report["failed"].append(f"{split} label 범위 이상 ({min_label}~{max_label})")
            print(f"  ❌ {split}: {min_label}~{max_label}")


def _check_required_columns(dfs: dict, report: dict):
    """필수 컬럼 존재 및 null 확인."""
    print("\n[5/6] 필수 컬럼 null 확인...")
    any_fail = False

    for split, df in dfs.items():
        for col in REQUIRED_COLUMNS:
            if col not in df.columns:
                report["failed"].append(f"{split}: 필수 컬럼 '{col}' 없음")
                print(f"  ❌ {split}: '{col}' 컬럼 없음")
                any_fail = True
                continue

            null_count = df[col].isna().sum()
            if null_count > 0:
                report["failed"].append(f"{split}.{col}: null {null_count}건")
                print(f"  ❌ {split}.{col}: null {null_count}건")
                any_fail = True

    if not any_fail:
        print("  ✅ 필수 컬럼 null 없음")


# ── 메인 함수 ─────────────────────────────────────────────────────

def validate(processed_dir: str) -> bool:
    """전처리 결과 검증.

    Args:
        processed_dir: train.csv / val.csv 저장 경로

    Returns:
        bool: 실패 항목 없으면 True
    """
    processed_dir = Path(processed_dir)
    report: dict = {"passed": [], "failed": [], "warnings": []}

    print("=" * 60)
    print("AI Hub 08-14 데이터 검증")
    print("=" * 60)

    dfs = _check_csv_exists(processed_dir, report)
    if not dfs:
        print("\n검증할 CSV가 없습니다.")
        return False

    _check_class_balance(dfs, report)
    _check_images(dfs, report)
    _check_label_range(dfs, report)
    _check_required_columns(dfs, report)

    # 결과 요약
    print("\n[6/6] 검증 결과 요약")
    print("=" * 60)
    print(f"  통과: {len(report['passed'])}건")
    print(f"  경고: {len(report['warnings'])}건")
    print(f"  실패: {len(report['failed'])}건")

    if report["warnings"]:
        print("\n  경고 항목:")
        for w in report["warnings"]:
            print(f"    ⚠️ {w}")

    if report["failed"]:
        print("\n  실패 항목:")
        for f in report["failed"]:
            print(f"    ❌ {f}")

    # 리포트 저장
    report_path = processed_dir / "validation_report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n리포트 저장: {report_path}")

    return len(report["failed"]) == 0


# ── 진입점 ────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Hub 08-14 데이터 검증")
    parser.add_argument("--processed_dir", required=True, help="전처리 결과 경로")
    args = parser.parse_args()

    success = validate(args.processed_dir)
    if success:
        print("\n✅ 모든 검증 통과.")
    else:
        print("\n⚠️ 검증 실패 항목이 있습니다. 확인 후 재전처리하세요.")


if __name__ == "__main__":
    main()
