"""전처리 완료된 데이터 탐색적 분석(EDA) 시각화.

사용법:
    python -m ai.preprocessing.aihub_eda --processed_dir data/processed/DS14
"""

import argparse
import platform
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
import numpy as np
import pandas as pd

CLASS_NAMES = ["건선", "아토피피부염", "여드름", "주사", "지루피부염", "정상"]
COLORS = ["#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7", "#DDA0DD"]


def setup_korean_font():
    """한글 폰트 설정."""
    system = platform.system()

    if system == "Darwin":
        candidates = ["AppleGothic", "Apple SD Gothic Neo"]
    elif system == "Windows":
        candidates = ["Malgun Gothic", "맑은 고딕"]
    else:
        candidates = ["NanumGothic", "NanumBarunGothic"]

    available = {f.name for f in fm.fontManager.ttflist}
    for font in candidates:
        if font in available:
            plt.rcParams["font.family"] = font
            plt.rcParams["axes.unicode_minus"] = False
            return

    print("  ⚠️ 한글 폰트를 찾을 수 없습니다. 글자가 깨질 수 있습니다.")


def load_data(processed_dir: Path) -> pd.DataFrame:
    """train/val/test CSV를 하나로 합치기."""
    dfs = []
    for split in ["train", "val", "test"]:
        csv_path = processed_dir / f"{split}.csv"
        if csv_path.exists():
            df = pd.read_csv(csv_path)
            dfs.append(df)

    if not dfs:
        raise FileNotFoundError(f"CSV 파일이 없습니다: {processed_dir}")

    return pd.concat(dfs, ignore_index=True)


def plot_class_distribution(df: pd.DataFrame, output_dir: Path):
    """클래스별 이미지 수 막대 그래프 (split 구분)."""
    fig, ax = plt.subplots(figsize=(12, 6))

    splits = ["train", "val", "test"]
    x = np.arange(len(CLASS_NAMES))
    width = 0.25

    for i, split in enumerate(splits):
        split_df = df[df["split"] == split]
        counts = [len(split_df[split_df["class_name"] == c]) for c in CLASS_NAMES]
        bars = ax.bar(x + i * width, counts, width, label=split, color=COLORS[i])
        for bar, count in zip(bars, counts):
            if count > 0:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 5,
                        str(count), ha="center", va="bottom", fontsize=8)

    ax.set_xlabel("피부질환 클래스")
    ax.set_ylabel("이미지 수")
    ax.set_title("클래스별 이미지 분포")
    ax.set_xticks(x + width)
    ax.set_xticklabels(CLASS_NAMES)
    ax.legend()
    ax.grid(axis="y", alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_dir / "class_distribution.png", dpi=150)
    plt.close()
    print("  → class_distribution.png")


def plot_gender_distribution(df: pd.DataFrame, output_dir: Path):
    """성별 분포 (전체 + 클래스별)."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    gender_counts = df["gender"].value_counts()
    if len(gender_counts) > 0:
        axes[0].pie(gender_counts.values, labels=gender_counts.index,
                    autopct="%1.1f%%", colors=COLORS[:len(gender_counts)])
        axes[0].set_title("전체 성별 분포")
    else:
        axes[0].text(0.5, 0.5, "데이터 없음", ha="center", va="center")
        axes[0].set_title("전체 성별 분포")

    gender_class = pd.crosstab(df["class_name"], df["gender"])
    if len(gender_class) > 0:
        gender_class.reindex(CLASS_NAMES).plot(kind="barh", stacked=True, ax=axes[1],
                                                color=COLORS[:gender_class.shape[1]])
        axes[1].set_title("클래스별 성별 분포")
        axes[1].set_xlabel("이미지 수")
    else:
        axes[1].text(0.5, 0.5, "데이터 없음", ha="center", va="center")

    plt.tight_layout()
    plt.savefig(output_dir / "gender_distribution.png", dpi=150)
    plt.close()
    print("  → gender_distribution.png")


def plot_age_distribution(df: pd.DataFrame, output_dir: Path):
    """연령대 분포."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))

    age_counts = df["age_range"].value_counts().sort_index()
    if len(age_counts) > 0:
        age_counts.plot(kind="bar", ax=axes[0], color=COLORS[0])
        axes[0].set_title("전체 연령대 분포")
        axes[0].set_xlabel("연령대")
        axes[0].set_ylabel("이미지 수")
        axes[0].tick_params(axis="x", rotation=45)
    else:
        axes[0].text(0.5, 0.5, "데이터 없음", ha="center", va="center")

    age_class = pd.crosstab(df["class_name"], df["age_range"])
    if len(age_class) > 0:
        age_class.reindex(CLASS_NAMES).plot(kind="barh", stacked=True, ax=axes[1])
        axes[1].set_title("클래스별 연령대 분포")
        axes[1].set_xlabel("이미지 수")
    else:
        axes[1].text(0.5, 0.5, "데이터 없음", ha="center", va="center")

    plt.tight_layout()
    plt.savefig(output_dir / "age_distribution.png", dpi=150)
    plt.close()
    print("  → age_distribution.png")


def plot_atopy_severity(df: pd.DataFrame, output_dir: Path):
    """아토피 IGA grade 분포."""
    atopy_df = df[df["class_name"] == "아토피피부염"]
    severity = atopy_df["severity"].value_counts().sort_index()

    fig, ax = plt.subplots(figsize=(8, 5))

    if len(severity) > 0:
        severity.plot(kind="bar", ax=ax, color=COLORS[1])
        ax.set_title("아토피피부염 IGA Grade 분포")
        ax.set_xlabel("IGA Grade")
        ax.set_ylabel("이미지 수")

        for i, (grade, count) in enumerate(severity.items()):
            ax.text(i, count + 1, str(count), ha="center", va="bottom")
    else:
        ax.text(0.5, 0.5, "severity 데이터 없음", ha="center", va="center",
                transform=ax.transAxes)
        ax.set_title("아토피피부염 IGA Grade 분포")

    plt.tight_layout()
    plt.savefig(output_dir / "atopy_severity.png", dpi=150)
    plt.close()
    print("  → atopy_severity.png")


def plot_acne_lesion_type(df: pd.DataFrame, output_dir: Path):
    """여드름 염증성/비염증성 비율."""
    acne_df = df[df["class_name"] == "여드름"]
    lesion = acne_df["lesion_type"].value_counts()

    fig, ax = plt.subplots(figsize=(8, 5))

    if len(lesion) > 0:
        ax.pie(lesion.values, labels=lesion.index, autopct="%1.1f%%",
               colors=[COLORS[2], COLORS[4]])
        ax.set_title("여드름 병변 유형 분포")
    else:
        ax.text(0.5, 0.5, "lesion_type 데이터 없음", ha="center", va="center",
                transform=ax.transAxes)
        ax.set_title("여드름 병변 유형 분포")

    plt.tight_layout()
    plt.savefig(output_dir / "acne_lesion_type.png", dpi=150)
    plt.close()
    print("  → acne_lesion_type.png")


def _load_image_from_zip(zip_path: str, filename: str):
    """ZIP에서 PIL 이미지 로드. 실패 시 None 반환."""
    import io
    import zipfile
    from PIL import Image, UnidentifiedImageError

    try:
        with zipfile.ZipFile(zip_path) as zf:
            for target in [filename, "/" + filename]:
                if target in zf.namelist():
                    with zf.open(target) as f:
                        return Image.open(io.BytesIO(f.read())).convert("RGB")
    except (zipfile.BadZipFile, OSError, UnidentifiedImageError):
        pass
    return None


def plot_sample_grid(df: pd.DataFrame, output_dir: Path):
    """클래스별 샘플 이미지 그리드 (ZIP에서 직접 로드)."""
    SAMPLES_PER_CLASS = 6
    fig, axes = plt.subplots(6, SAMPLES_PER_CLASS, figsize=(18, 18))

    has_zip = "zip_path" in df.columns and "filename" in df.columns

    for row_idx, class_name in enumerate(CLASS_NAMES):
        class_df = df[df["class_name"] == class_name]
        samples = class_df.head(SAMPLES_PER_CLASS)

        for col_idx in range(SAMPLES_PER_CLASS):
            ax = axes[row_idx][col_idx]
            ax.axis("off")

            if not has_zip or col_idx >= len(samples):
                ax.text(0.5, 0.5, "N/A", ha="center", va="center",
                        transform=ax.transAxes, fontsize=10)
                continue

            row = samples.iloc[col_idx]
            img = _load_image_from_zip(row["zip_path"], row["filename"])
            if img is not None:
                ax.imshow(img)
            else:
                ax.text(0.5, 0.5, "로드\n실패", ha="center", va="center",
                        transform=ax.transAxes, fontsize=9)

        axes[row_idx][0].set_ylabel(class_name, fontsize=12, rotation=0,
                                    labelpad=80, va="center")

    plt.suptitle("클래스별 샘플 이미지", fontsize=16, y=1.01)
    plt.tight_layout()
    plt.savefig(output_dir / "sample_grid.png", dpi=100, bbox_inches="tight")
    plt.close()
    print("  → sample_grid.png")


def run_eda(processed_dir: str):
    """전체 EDA 실행."""
    processed_dir = Path(processed_dir)
    output_dir = processed_dir / "eda"
    output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("AI Hub 08-14 EDA")
    print("=" * 60)

    setup_korean_font()

    print("\n데이터 로드...")
    df = load_data(processed_dir)
    print(f"  → 총 {len(df)}건 로드")

    print("\n시각화 생성 중...")
    plot_class_distribution(df, output_dir)
    plot_gender_distribution(df, output_dir)
    plot_age_distribution(df, output_dir)
    plot_atopy_severity(df, output_dir)
    plot_acne_lesion_type(df, output_dir)
    plot_sample_grid(df, output_dir)

    print(f"\n✅ EDA 완료. 결과: {output_dir}/")


def main():
    parser = argparse.ArgumentParser(description="AI Hub 08-14 EDA")
    parser.add_argument("--processed_dir", required=True, help="전처리 결과 경로")
    args = parser.parse_args()
    run_eda(args.processed_dir)


if __name__ == "__main__":
    main()
