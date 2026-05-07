"""외부 임상 데이터셋 이미지 폴더 → ZIP + CSV 재생성.

external_preprocessor.py가 생성한 image_path 형식 CSV를 읽어
ZIP 파일을 생성하고, zip_path + filename 형식 CSV로 변환한다.

ZIP 방식은 Google Drive에서 수만 개의 소용량 파일을 개별 읽는 I/O 병목을
제거해 Colab 학습 속도를 대폭 향상시킨다 (에폭당 22분 → 1~2분).

사용법:
    # DermNet NZ
    python -m ai.preprocessing.pack_external_to_zip \\
        --processed_dir data/processed/dermnet \\
        --image_base data/dermnet \\
        --zip_out data/dermnet.zip

    # ISIC 2019
    python -m ai.preprocessing.pack_external_to_zip \\
        --processed_dir data/processed/isic2019 \\
        --image_base "data/ISIC 2019" \\
        --zip_out data/isic2019.zip

    # HAM10000
    python -m ai.preprocessing.pack_external_to_zip \\
        --processed_dir data/processed/ham10000 \\
        --image_base data/HAM10000 \\
        --zip_out data/ham10000.zip
"""
from __future__ import annotations

import argparse
import logging
import zipfile
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

SUPPORTED_SPLITS = ("train", "val", "test")


def _image_path_to_filename(image_path: str, image_base: Path) -> str:
    """절대 또는 상대 image_path에서 ZIP 내부 상대경로(filename) 추출.

    image_base를 앵커로 삼아 그 이하의 상대경로를 반환한다.
    예: /Users/kyoe/skin_ai/data/dermnet/train/Eczema/img.jpg
        image_base = data/dermnet (또는 절대경로)
        → train/Eczema/img.jpg
    """
    p = Path(image_path)
    image_base_abs = image_base.resolve()

    # 절대경로인 경우 image_base 이하 추출
    try:
        return str(p.relative_to(image_base_abs))
    except ValueError:
        pass

    # image_base의 이름(마지막 세그먼트)을 앵커로 폴백
    parts = p.parts
    base_name = image_base.name
    for i, part in enumerate(parts):
        if part == base_name and i + 1 < len(parts):
            return str(Path(*parts[i + 1:]))

    raise ValueError(f"image_base({image_base})를 image_path({image_path})에서 찾을 수 없음")


def build_zip(image_base: Path, zip_out: Path, filenames: set[str]) -> None:
    """image_base 디렉토리에서 filenames에 해당하는 이미지만 ZIP으로 묶는다.

    ZIP_STORED(무압축) 사용 — JPEG는 이미 압축돼 deflate 효과 없음.
    무압축이 읽기 속도도 빠르고 CPU 낭비도 없다.
    """
    zip_out.parent.mkdir(parents=True, exist_ok=True)
    added = 0

    with zipfile.ZipFile(zip_out, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        for filename in sorted(filenames):
            src = image_base / filename
            if not src.exists():
                logger.warning(f"[WARNING] 이미지 없음, 건너뜀: {src}")
                continue
            zf.write(src, arcname=filename)
            added += 1
            if added % 1000 == 0:
                logger.info(f"[INFO] ZIP 추가 진행: {added}/{len(filenames)}장")

    logger.info(f"[INFO] ZIP 생성 완료: {zip_out} ({added}장, {zip_out.stat().st_size / 1e9:.2f} GB)")


def convert_csvs(processed_dir: Path, image_base: Path, zip_out: Path) -> set[str]:
    """image_path 형식 CSV → zip_path + filename 형식 CSV로 변환.

    변환된 CSV를 processed_dir에 덮어쓰고, ZIP에 필요한 filename 집합을 반환한다.
    """
    all_filenames: set[str] = set()
    zip_rel = zip_out  # 실제 경로는 Colab에서 root_dir로 재매핑되므로 절대경로 저장

    for split in SUPPORTED_SPLITS:
        csv_path = processed_dir / f"{split}.csv"
        if not csv_path.exists():
            continue

        df = pd.read_csv(csv_path)

        if "zip_path" in df.columns and "filename" in df.columns:
            logger.info(f"[INFO] {split}.csv — 이미 ZIP 형식, 건너뜀")
            all_filenames.update(df["filename"].tolist())
            continue

        if "image_path" not in df.columns:
            logger.warning(f"[WARNING] {split}.csv — image_path 컬럼 없음, 건너뜀")
            continue

        # image_path → filename 변환
        filenames = df["image_path"].apply(
            lambda p: _image_path_to_filename(p, image_base)
        )
        all_filenames.update(filenames.tolist())

        # CSV 재구성: image_path 제거, zip_path + filename 추가
        df = df.drop(columns=["image_path"])
        df.insert(0, "zip_path", str(zip_rel))
        df.insert(1, "filename", filenames)

        df.to_csv(csv_path, index=False)
        logger.info(f"[INFO] {split}.csv 변환 완료: {len(df)}건 → {csv_path}")

    return all_filenames


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    parser = argparse.ArgumentParser(
        description="외부 임상 데이터셋 이미지 폴더 → ZIP + CSV 재생성"
    )
    parser.add_argument("--processed_dir", required=True,
                        help="external_preprocessor가 생성한 CSV 디렉토리")
    parser.add_argument("--image_base", required=True,
                        help="원본 이미지 루트 디렉토리 (ZIP 내부 상대경로 기준점)")
    parser.add_argument("--zip_out", required=True,
                        help="생성할 ZIP 파일 경로 (예: data/dermnet.zip)")
    args = parser.parse_args()

    processed_dir = Path(args.processed_dir)
    image_base = Path(args.image_base).resolve()
    zip_out = Path(args.zip_out)

    print("=" * 60)
    print("외부 데이터셋 ZIP 변환")
    print(f"  CSV 디렉토리 : {processed_dir}")
    print(f"  이미지 루트  : {image_base}")
    print(f"  ZIP 출력     : {zip_out}")
    print("=" * 60)

    # 1단계: CSV 변환 + 필요한 filename 목록 수집
    print("\n[1/2] CSV 변환 중...")
    filenames = convert_csvs(processed_dir, image_base, zip_out)
    print(f"  총 {len(filenames)}개 이미지 파일 확인")

    # 2단계: ZIP 생성
    print("\n[2/2] ZIP 생성 중 (무압축, ZIP_STORED)...")
    build_zip(image_base, zip_out, filenames)

    print("\n완료.")
    print(f"  → Drive 업로드 필요: {zip_out}")
    print(f"  → Drive 업로드 필요: {processed_dir}/ (CSV 재생성됨)")


if __name__ == "__main__":
    main()
