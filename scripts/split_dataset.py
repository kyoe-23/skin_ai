import pandas as pd
from sklearn.model_selection import train_test_split
from pathlib import Path

def split_dataset(csv_path, output_dir):
    # 1. 마스터 CSV 불러오기
    df = pd.read_csv(csv_path)
    print(f"총 데이터 개수: {len(df)}개")

    correct_map = {"건선": 0, "아토피": 1, "여드름": 2, "주사": 3, "지루": 4, "정상": 5}
    df['label_idx'] = df['label_name'].map(correct_map)
    
    # 혹시라도 알 수 없는 이름 때문에 빈칸(NaN)이 생긴 데이터가 있다면 안전하게 제거
    df = df.dropna(subset=['label_idx'])
    
    print(f"정제된 총 데이터 개수: {len(df)}개")

    # 2. 1차 분할: Train(80%) vs 나머지(Temp, 20%)
    # stratify=df['label_idx'] 옵션이 클래스 비율을 똑같이 유지해주는 마법의 키워드입니다.
    train_df, temp_df = train_test_split(
        df, test_size=0.2, random_state=42, stratify=df['label_idx']
    )

    # 3. 2차 분할: Temp(20%)를 반반 쪼개서 Val(10%)과 Test(10%)로 만들기
    val_df, test_df = train_test_split(
        temp_df, test_size=0.5, random_state=42, stratify=temp_df['label_idx']
    )

    # 4. 각각의 CSV로 저장
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    train_df.to_csv(out_path / "train.csv", index=False, encoding='utf-8-sig')
    val_df.to_csv(out_path / "val.csv", index=False, encoding='utf-8-sig')
    test_df.to_csv(out_path / "test.csv", index=False, encoding='utf-8-sig')

    # 5. 결과 요약 출력
    print("\n✅ 데이터 분할 완료!")
    print(f"Train 세트: {len(train_df)}개 (80%)")
    print(f"Validation 세트: {len(val_df)}개 (10%)")
    print(f"Test 세트: {len(test_df)}개 (10%)")
    
    print("\n[참고: Validation 세트의 클래스 분포]")
    print(val_df['label_name'].value_counts())

if __name__ == "__main__":
    CSV_FILE = "./ai/preprocessing/processed_aihub/total_metadata.csv"
    OUTPUT_DIR = "./ai/preprocessing/processed_aihub"
    
    split_dataset(CSV_FILE, OUTPUT_DIR)