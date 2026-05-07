"""AI Hub 안면부 피부질환 PyTorch Dataset 클래스.

DS14(6종)·DS15(15종) 등 AI Hub 전처리 결과 CSV를 공용으로 읽는다.

CSV 컬럼 (AihubFacialDataset / AihubSegDataset):
    zip_path  : 원천 ZIP 파일의 절대경로
    filename  : ZIP 내 파일명 (예: H0_168820_P1_L0.png)
    class_idx : 정수 인덱스 (데이터셋별 상이 — metadata.json 참조)
    class_name: 한국어 클래스명
    split     : train / val
    direction : front / side

CSV 컬럼 (ExternalFacialDataset):
    image_path: 프로젝트 루트 기준 상대경로
    class_idx : 정수 인덱스
    class_name: 한국어 클래스명
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import io
import logging
import zipfile
from pathlib import Path
from typing import Optional

# ── 서드파티 ─────────────────────────────────────────────────────
import pandas as pd
import torch
from PIL import Image, UnidentifiedImageError
from torch.utils.data import Dataset
from torchvision import transforms

logger = logging.getLogger(__name__)

# ── 워커별 ZIP 핸들 캐시 ──────────────────────────────────────────
# DataLoader(worker_init_fn=worker_init_fn) 전달 시 워커 프로세스별로 초기화됨.
# num_workers=0 (메인 프로세스)에서도 캐싱이 동작해 반복 개방 비용을 줄임.
_WORKER_ZIP_CACHE: dict = {}

# ── 상수 ─────────────────────────────────────────────────────────
CLASS_MAP = {
    "건선": 0, "아토피피부염": 1, "여드름": 2,
    "주사": 3, "지루피부염": 4, "정상": 5,
}
IDX_TO_CLASS = {v: k for k, v in CLASS_MAP.items()}

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

# fallback 시 더미 이미지 기본 크기 (config의 crop_size가 우선)
DEFAULT_CROP_SIZE = 224
NUM_CHANNELS = 3               # RGB
_FALLBACK_SEARCH_RANGE = 10    # 이미지 로드 실패 시 인접 샘플 탐색 범위
MASK_BINARIZE_THRESHOLD = 127  # 세그멘테이션 마스크 이진화 기준값
ATOPY_TARGET_CLASS = "아토피피부염"  # AihubSegDataset 필터 대상 클래스


# ── 헬퍼 ─────────────────────────────────────────────────────────

def worker_init_fn(worker_id: int) -> None:
    """DataLoader worker 초기화 — ZIP 핸들 캐시를 리셋.

    fork로 생성된 워커 프로세스가 부모의 파일 핸들을 상속하지 않도록
    캐시를 비운다. 이후 _get_cached_zip이 워커별 독립 핸들을 새로 열어 캐싱.

    DataLoader(..., worker_init_fn=worker_init_fn) 으로 전달.

    Args:
        worker_id: 워커 프로세스 번호 (DataLoader 내부에서 자동 전달)
    """
    global _WORKER_ZIP_CACHE
    _WORKER_ZIP_CACHE = {}


def _get_cached_zip(zip_path: str) -> zipfile.ZipFile:
    """ZIP 핸들을 캐시에서 반환. 없으면 열어서 캐싱.

    워커 프로세스별 독립 캐시이므로 프로세스 간 경합 없음.

    Args:
        zip_path: ZIP 파일 절대경로

    Returns:
        zipfile.ZipFile: 열린 ZipFile 핸들
    """
    if zip_path not in _WORKER_ZIP_CACHE:
        _WORKER_ZIP_CACHE[zip_path] = zipfile.ZipFile(zip_path, "r")
    return _WORKER_ZIP_CACHE[zip_path]


def get_transforms(split: str, config=None, task: str = "classify"):
    """split과 task에 따른 transform 반환.

    Args:
        split: 'train', 'val', 'test'
        config: ClassifyConfig / SegmentConfig (None이면 기본값 사용)
        task: 'classify' 또는 'segment'

    Returns:
        torchvision.transforms.Compose 또는 albumentations.Compose
    """
    image_size = config.image_size if config else 256
    crop_size = config.crop_size if config else 224

    if task == "classify":
        if split == "train":
            # 합성→실제 도메인 갭 대응: ColorJitter·Rotation 강화, Perspective·Sharpness 추가
            return transforms.Compose([
                transforms.Resize(image_size),
                transforms.RandomCrop(crop_size),
                transforms.RandomHorizontalFlip(0.5),
                transforms.ColorJitter(0.5, 0.5, 0.5, 0.2),
                transforms.RandomGrayscale(p=0.1),
                transforms.RandomRotation(20),
                transforms.RandomApply([transforms.GaussianBlur(kernel_size=5, sigma=(0.1, 2.0))], p=0.5),
                transforms.RandomPerspective(distortion_scale=0.2, p=0.3),
                transforms.RandomAdjustSharpness(sharpness_factor=2, p=0.3),
                transforms.ToTensor(),
                transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
                transforms.RandomErasing(p=0.3, scale=(0.02, 0.25)),
            ])
        return transforms.Compose([
            transforms.Resize(image_size),
            transforms.CenterCrop(crop_size),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ])

    if task == "segment":
        try:
            import albumentations as A
            from albumentations.pytorch import ToTensorV2
        except ImportError:
            raise ImportError("pip install albumentations 필요")

        if split == "train":
            return A.Compose([
                A.Resize(image_size, image_size),
                A.RandomCrop(crop_size, crop_size),
                A.HorizontalFlip(p=0.5),
                A.ColorJitter(brightness=0.2, contrast=0.2, p=0.5),
                A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
                ToTensorV2(),
            ])
        return A.Compose([
            A.Resize(image_size, image_size),
            A.CenterCrop(crop_size, crop_size),
            A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
            ToTensorV2(),
        ])

    raise ValueError(f"알 수 없는 task: {task}")


def _remap_zip_path(zip_path: str, root_dir: str) -> str:
    """로컬 절대경로를 root_dir 기준으로 재매핑.

    CSV의 zip_path가 전처리 당시 로컬 절대경로로 기록되어 있을 때,
    Colab 등 다른 환경에서 경로를 교체하기 위해 사용한다.

    'data' 디렉토리 세그먼트를 앵커로 삼아 상대경로를 추출하고
    root_dir 아래에 재조합한다.

    Args:
        zip_path: CSV에 저장된 절대경로 (예: /Users/kyoe/skin_ai/data/dataset_14/...)
        root_dir: 새 프로젝트 루트 (예: /content/drive/MyDrive/skin_ai)

    Returns:
        str: 재매핑된 경로 (예: /content/drive/MyDrive/skin_ai/data/dataset_14/...)
    """
    parts = Path(zip_path).parts
    for i, part in enumerate(parts):
        if part == "data":
            return str(Path(root_dir) / Path(*parts[i:]))
    # 'data' 세그먼트를 찾지 못하면 원본 반환
    logger.warning(f"zip_path 재매핑 실패 — 'data' 세그먼트 없음: {zip_path}")
    return zip_path


def _load_image_from_zip(zip_path: str, filename: str) -> Optional[Image.Image]:
    """ZIP 파일에서 이미지를 직접 로드.

    워커별 ZIP 핸들 캐시(_WORKER_ZIP_CACHE)를 재사용해 반복 개방 I/O 비용을 제거.
    DataLoader(worker_init_fn=worker_init_fn) 과 함께 사용 시 효과 최대.

    Args:
        zip_path: ZIP 파일 절대경로
        filename: ZIP 내 파일명 (leading slash 없음)

    Returns:
        PIL.Image.Image | None: RGB 이미지 또는 실패 시 None
    """
    try:
        zf = _get_cached_zip(zip_path)
        # ZIP 내부 경로는 leading slash가 있을 수 있음 (원본 AI Hub ZIP 특성)
        targets = [filename, "/" + filename]
        for target in targets:
            if target in zf.namelist():
                with zf.open(target) as f:
                    return Image.open(io.BytesIO(f.read())).convert("RGB")
        logger.warning(f"ZIP 내 파일 없음: {filename} (zip: {Path(zip_path).name})")
        return None
    except (zipfile.BadZipFile, OSError, UnidentifiedImageError) as e:
        logger.warning(f"이미지 로드 실패: {filename} — {e}")
        return None


# ── 공개 클래스 ──────────────────────────────────────────────────

class AihubFacialDataset(Dataset):
    """AI Hub 안면부 피부질환 분류 Dataset.

    전처리된 CSV(zip_path + filename 컬럼)를 읽어
    ZIP 파일에서 직접 이미지를 로드한다.
    DS14(6종)·DS15(15종) 모두 지원.

    Args:
        csv_path: 전처리된 CSV 경로 (train.csv, val.csv, test.csv)
        transform: torchvision transform (None이면 val/test 기본 transform 사용)
        direction: 'front', 'side', None (None이면 전체)
        root_dir: CSV의 zip_path를 재매핑할 프로젝트 루트 경로.
                  Colab 등 로컬과 다른 환경에서 절대경로 불일치를 해소할 때 사용.
                  None이면 CSV 원본 경로를 그대로 사용.
    """

    def __init__(
        self,
        csv_path: str,
        transform=None,
        direction: str = "front",
        root_dir: Optional[str] = None,
        crop_size: int = DEFAULT_CROP_SIZE,
    ):
        df = pd.read_csv(csv_path)

        if direction:
            df = df[df["direction"] == direction].reset_index(drop=True)

        if "class_idx" not in df.columns:
            df["class_idx"] = df["class_name"].map(CLASS_MAP)

        # Colab 등 다른 환경에서 절대경로 재매핑
        if root_dir is not None:
            df["zip_path"] = df["zip_path"].apply(
                lambda p: _remap_zip_path(p, root_dir)
            )

        self.df = df
        self._crop_size = crop_size
        split = Path(csv_path).stem   # 파일명에서 split 추론 (train/val/test)
        self.transform = transform or get_transforms(split)

        logger.info(f"Dataset 로드: {csv_path} ({len(self.df)}건, direction={direction})")

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        label = int(row["class_idx"])

        image = _load_image_from_zip(row["zip_path"], row["filename"])
        if image is None:
            return self._get_fallback(idx)

        if self.transform:
            image = self.transform(image)

        return image, label

    def _get_fallback(self, idx: int):
        """이미지 로드 실패 시 인접 유효 샘플 반환.

        Args:
            idx: 실패한 인덱스

        Returns:
            tuple: (image_tensor, label) — 유효 샘플 또는 더미
        """
        for offset in range(1, min(_FALLBACK_SEARCH_RANGE, len(self.df))):
            next_idx = (idx + offset) % len(self.df)
            row = self.df.iloc[next_idx]
            image = _load_image_from_zip(row["zip_path"], row["filename"])
            if image is None:
                continue
            if self.transform:
                image = self.transform(image)
            return image, int(row["class_idx"])

        # 모든 fallback 실패 시 더미 (배치 크기 유지용)
        return torch.zeros(NUM_CHANNELS, self._crop_size, self._crop_size), 0


class AihubSegDataset(Dataset):
    """아토피피부염 병변 세그멘테이션 Dataset.

    Args:
        csv_path: 전처리된 CSV (아토피만 필터링됨)
        mask_dir: lesion_area 마스크 PNG 디렉토리
        transform: albumentations transform
        root_dir: zip_path 재매핑용 프로젝트 루트. None이면 원본 경로 사용.
    """

    def __init__(
        self,
        csv_path: str,
        mask_dir: str,
        transform=None,
        root_dir: Optional[str] = None,
        crop_size: int = DEFAULT_CROP_SIZE,
    ):
        df = pd.read_csv(csv_path)
        self.df = df[df["class_name"] == ATOPY_TARGET_CLASS].reset_index(drop=True)

        if root_dir is not None:
            self.df["zip_path"] = self.df["zip_path"].apply(
                lambda p: _remap_zip_path(p, root_dir)
            )
        self.mask_dir = Path(mask_dir)
        self.transform = transform
        self._crop_size = crop_size

        logger.info(f"SegDataset 로드: {len(self.df)}건 (아토피)")

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        mask_name = Path(row["filename"]).stem + "_mask.png"
        mask_path = self.mask_dir / mask_name

        try:
            import numpy as np

            image = _load_image_from_zip(row["zip_path"], row["filename"])
            if image is None:
                raise OSError(f"이미지 로드 실패: {row['filename']}")
            image = np.array(image)

            if mask_path.exists():
                mask = np.array(Image.open(mask_path).convert("L"))
                mask = (mask > MASK_BINARIZE_THRESHOLD).astype(np.uint8)
            else:
                mask = np.zeros(image.shape[:2], dtype=np.uint8)

            if self.transform:
                transformed = self.transform(image=image, mask=mask)
                image = transformed["image"]
                mask = transformed["mask"]
            else:
                image = torch.from_numpy(image).permute(2, 0, 1).float() / 255.0
                mask = torch.from_numpy(mask)

            return image, mask.long()

        except (OSError, UnidentifiedImageError) as e:
            logger.warning(f"세그멘테이션 데이터 로드 실패 [{idx}]: {e}")
            return (
                torch.zeros(NUM_CHANNELS, self._crop_size, self._crop_size),
                torch.zeros(self._crop_size, self._crop_size, dtype=torch.long),
            )


class ExternalFacialDataset(Dataset):
    """외부 임상 이미지 Dataset.

    CSV 컬럼 포맷을 자동 감지해 두 가지 읽기 방식을 지원한다:
    - ZIP 모드  : CSV에 zip_path + filename 컬럼이 있을 때
                 (pack_external_to_zip.py 로 생성, Drive I/O 최적화)
    - 파일 모드 : CSV에 image_path 컬럼이 있을 때
                 (external_preprocessor.py 기본 출력, 하위 호환)

    Args:
        csv_path: external_preprocessor 또는 pack_external_to_zip이 생성한 CSV 경로
        transform: torchvision transform (None이면 split 기본 transform)
        crop_size: 로드 실패 시 더미 텐서 크기
        root_dir: Colab 등 다른 환경에서 경로 재매핑할 프로젝트 루트.
                  None이면 CSV에 저장된 경로를 그대로 사용.
    """

    def __init__(
        self,
        csv_path: str,
        transform=None,
        crop_size: int = DEFAULT_CROP_SIZE,
        root_dir: Optional[str] = None,
    ):
        df = pd.read_csv(csv_path)

        # CSV 포맷 자동 감지
        self._use_zip = "zip_path" in df.columns and "filename" in df.columns

        if self._use_zip:
            # ZIP 모드: zip_path 경로만 재매핑 (filename은 ZIP 내부 상대경로라 불변)
            if root_dir is not None:
                df["zip_path"] = df["zip_path"].apply(
                    lambda p: _remap_zip_path(p, root_dir)
                )
        else:
            # 파일 모드: 절대경로는 'data' 앵커로 재매핑, 상대경로는 root_dir prefix 추가
            if root_dir is not None:
                df["image_path"] = df["image_path"].apply(
                    lambda p: _remap_zip_path(p, root_dir) if Path(p).is_absolute()
                              else str(Path(root_dir) / p)
                )

        if "class_idx" not in df.columns:
            df["class_idx"] = df["class_name"].map(CLASS_MAP)

        before = len(df)
        df = df.dropna(subset=["class_idx"]).reset_index(drop=True)
        df["class_idx"] = df["class_idx"].astype(int)
        if len(df) < before:
            logger.warning(f"[WARNING] class_idx 매핑 실패로 {before - len(df)}건 제외")

        self.df = df
        self._crop_size = crop_size
        split = Path(csv_path).stem
        self.transform = transform or get_transforms(split)

        mode = "ZIP" if self._use_zip else "파일"
        logger.info(f"ExternalFacialDataset 로드({mode}): {csv_path} ({len(self.df)}건)")

    def __len__(self) -> int:
        return len(self.df)

    def __getitem__(self, idx: int):
        row = self.df.iloc[idx]
        label = int(row["class_idx"])

        try:
            if self._use_zip:
                image = _load_image_from_zip(row["zip_path"], row["filename"])
                if image is None:
                    raise OSError("ZIP에서 이미지 로드 실패")
            else:
                image = Image.open(row["image_path"]).convert("RGB")
        except (OSError, UnidentifiedImageError, KeyError) as e:
            name = row.get("filename", row.get("image_path", "unknown"))
            logger.warning(f"[WARNING] 외부 이미지 로드 실패: {Path(str(name)).name} — {e}")
            return torch.zeros(3, self._crop_size, self._crop_size), label

        if self.transform:
            image = self.transform(image)

        return image, label
