import json
import pandas as pd
from pathlib import Path
from tqdm import tqdm

def create_metadata(image_dir, raw_root, output_path):
    image_path = Path(image_dir)
    raw_path = Path(raw_root)
    records = []

    # 1. 리사이징된 이미지 목록 가져오기
    image_files = list(image_path.glob("*.png")) + list(image_path.glob("*.jpg"))
    print(f"총 {len(image_files)}개의 정제된 이미지를 처리합니다.")

    for img_p in tqdm(image_files, desc="JSON 파싱 중"):
        # 이미지 파일명에서 JSON 파일명 유추 (확장자만 .json으로 변경)
        json_name = img_p.stem + ".json"
        
        # 원본 데이터 폴더(data/raw)에서 해당 JSON 찾기 (전체 검색)
        json_files = list(raw_path.rglob(json_name))
        
        if not json_files:
            continue
            
        with open(json_files[0], 'r', encoding='utf-8') as f:
            data = json.load(f)
            info = data['annotations'][0]  # 첫 번째 annotation 정보 사용 (보통 하나의 annotation이 존재)
            
            # 데이터 추출
            records.append({
                "filename": img_p.name,
                "label_name": info['diagnosis_info']['diagnosis_name'],
                "body_part": info['diagnosis_info']['bodypart'],
                "gender": info['generated_parameters']['gender'],
                "age_range": info['generated_parameters']['age_range'],
                "bbox_width": info['bbox']['width'],
                "bbox_height": info['bbox']['height'],
                "rel_path": str(img_p)
            })

    # 2. CSV 저장
    df = pd.DataFrame(records)
    
    # 질환명을 숫자로 인코딩 (건선:0, 아토피:1 등 - PM 기획안 기준)
    class_map = {"건선": 0, "아토피피부염": 1, "여드름": 2, "주사": 3, "지루피부염": 4, "정상": 5}
    df['label_idx'] = df['label_name'].map(class_map)
    
    df.to_csv(output_path, index=False, encoding='utf-8-sig')
    print(f"\n✅ 메타데이터 생성 완료: {output_path}")
    print(df['label_name'].value_counts()) # 클래스별 개수 확인

if __name__ == "__main__":
    IMG_DIR = "./ai/preprocessing/processed_aihub/images_224"
    RAW_ROOT = "./data/raw"
    OUT_CSV = "./ai/preprocessing/processed_aihub/total_metadata.csv"
    
    create_metadata(IMG_DIR, RAW_ROOT, OUT_CSV)