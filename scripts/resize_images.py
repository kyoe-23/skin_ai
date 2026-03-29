import os
from pathlib import Path
from PIL import Image
from tqdm import tqdm

def resize_skin_images(input_root, output_root, size=(224, 224)):
    input_path = Path(input_root)
    output_path = Path(output_root)
    output_path.mkdir(parents=True, exist_ok=True)

    # 1. 정면(P2) 이미지 리스트만 확보
    image_files = list(input_path.rglob("*_P2_*.png")) 
    print(f"총 {len(image_files)}개의 정면 이미지를 찾았습니다.")

    # 2. 리사이징 루프 (CPU 효율적 사용)
    for img_path in tqdm(image_files, desc="리사이징 진행 중"):
        try:
            with Image.open(img_path) as img:
                # RGB 모드로 변환 (혹시 모를 투명도 채널 제거)
                img = img.convert("RGB")
                # 고품질 리사이징 (LANCZOS 필터)
                img_resized = img.resize(size, Image.Resampling.LANCZOS)
                
                # 저장 경로 설정 (원본 구조 유지 또는 단일 폴더)
                save_path = output_path / img_path.name
                img_resized.save(save_path, "JPEG", quality=90) # 용량 최적화를 위해 JPEG 추천
        except Exception as e:
            print(f"에러 발생 ({img_path.name}): {e}")

if __name__ == "__main__":
    # 경로 설정 (사용자님 환경에 맞게 수정)
    RAW_DATA = "./data/raw"
    PROCESSED_DATA = "./ai/preprocessing/processed_aihub/images_224"
    
    resize_skin_images(RAW_DATA, PROCESSED_DATA)