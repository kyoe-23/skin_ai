# SkinAI 이미지 처리 가이드 

> 프론트엔드는 이미지 전송만, 백엔드에서 검증·마스킹·저장 일괄 처리

---

## 변경 사항 요약

| 항목 | v1 (기존) | v2 (변경) |
|------|----------|----------|
| EXIF 제거 | 프론트엔드 (Canvas API) | 백엔드 |
| 마스킹 처리 | 프론트엔드 (부분) + 백엔드 | 백엔드 일괄 |
| 파일 검증 | 백엔드 | 백엔드 |
| Supabase 업로드 | 백엔드 | 백엔드 |
| 프론트 역할 | 전처리 + 전송 | 이미지 전송만 |

---

## 전체 처리 흐름

```
[프론트엔드]
    |
    | 원본 이미지 전송 (multipart/form-data + JWT)
    | HTTPS 암호화 전송
    |
[백엔드]
    |
    |-- 1단계. 파일 유효성 검증
    |         - 파일 형식 확인 (PNG, JPEG만 허용)
    |         - 파일 크기 확인 (최대 10MB)
    |         - 실제 이미지 여부 확인 (매직 바이트)
    |
    |-- 2단계. EXIF 메타데이터 완전 제거
    |         - GPS 위치, 기기정보, 촬영시간 등 제거
    |         - Pillow 라이브러리로 픽셀 데이터만 추출
    |
    |-- 3단계. 식별 영역 마스킹
    |         - 상하단 라벨 영역 블랙 마스킹
    |         - 안면 랜드마크 탐지 (OpenCV + face_recognition)
    |         - 눈 영역 마스킹 처리
    |
    |-- 4단계. Supabase Storage 업로드
    |         - 비식별화 파일명 생성 (user_id/uuid.png)
    |         - Private 버킷에 저장
    |
    |-- 5단계. DB에 기록 저장
    |         - image_url, is_masked, status 저장
    |
    | 저장된 이미지 URL 반환
    |
[프론트엔드]
    |
    | 분석 결과 화면 표시
```

---

## 프론트엔드

### 역할 최소화

프론트엔드는 이미지를 받아서 백엔드로 전송하는 역할만 수행합니다.
별도의 전처리 작업 없이 원본 이미지를 그대로 서버로 전송합니다.

### 이미지 전송 코드

```javascript
async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);  // 원본 파일 그대로 전송

  // 로딩 UI 표시
  showLoadingUI('이미지 업로드 중...');

  try {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    const res = await fetch('http://localhost:3000/api/analyze/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`  // JWT 인증
      },
      body: formData
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.message);

    return data.imageUrl;  // 마스킹 처리된 이미지 URL 반환

  } catch (err) {
    showErrorUI(err.message);
  } finally {
    hideLoadingUI();
  }
}
```

### 프론트엔드 체크리스트

- [ ] 파일 선택 UI (input type=file)
- [ ] 파일 크기 사전 체크 (10MB 초과 시 안내 메시지)
- [ ] 업로드 중 로딩 UI (스피너, 진행률)
- [ ] 업로드 실패 시 에러 메시지 표시
- [ ] JWT 토큰 헤더 포함 전송
- [ ] 완료 후 분석 결과 화면 전환

---

## 백엔드가 할 일

### 1단계. 파일 유효성 검증

```javascript
// Node.js + multer 예시
const multer = require('multer');
const path = require('path');

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 제한
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('JPG, PNG 파일만 허용됩니다.'));
    }
    cb(null, true);
  }
});
```

### 2단계. EXIF 메타데이터 제거

```python
# Python (Pillow) 예시
from PIL import Image
import io

def strip_exif(image_bytes):
    img = Image.open(io.BytesIO(image_bytes))
    # 픽셀 데이터만 추출 → EXIF 완전 제거
    data = list(img.getdata())
    clean_img = Image.new(img.mode, img.size)
    clean_img.putdata(data)

    output = io.BytesIO()
    clean_img.save(output, format='PNG')
    return output.getvalue()
```

제거되는 정보는 다음과 같습니다.
- GPS 위치 정보 (촬영 장소)
- 촬영 날짜 및 시간
- 촬영 기기 정보 (병원 장비명 등)
- 환자 관련 병원 정보

### 3단계. 식별 영역 마스킹

**마스킹 방식**

피부 분석 AI API에서 병변 부위 좌표를 반환받아 해당 영역만 노출하고 나머지는 전부 블랙 마스킹합니다.
별도의 세그멘테이션 모델 없이 API 응답 좌표만으로 마스킹 처리합니다.

**마스킹 대상 부위**

| 부위 | 처리 방식 | 이유 |
|------|----------|------|
| 피부 병변 영역 | 원본 유지 (노출) | AI API가 탐지한 질환 부위 |
| 눈 / 눈썹 | 블랙 마스킹 | 개인 식별 가능 |
| 배경 / 기타 영역 | 블랙 마스킹 | 불필요한 개인정보 제거 |
| 상단 8% 영역 | 블랙 마스킹 | 병원명, 환자명 라벨 |
| 하단 8% 영역 | 블랙 마스킹 | 하단 정보 표시 영역 |

**전체 처리 흐름**

```
이미지 업로드
    ↓
EXIF 제거 + 파일 검증
    ↓
피부 분석 AI API 호출
    ↓
AI가 병변 부위 좌표(마스크) 반환
    ↓
병변 부위만 원본 유지
나머지 전부 블랙 마스킹
    ↓
Supabase Storage 저장
```

**마스킹 처리 코드 (API 응답 형식 확정 후 업데이트 예정)**

```python
def mask_by_api_response(image, api_response):
    """
    피부 분석 AI API 응답 기반 마스킹
    - api_response: AI API에서 반환된 병변 좌표 (형식 확정 후 업데이트)
    - 병변 부위만 원본 유지, 나머지 전부 블랙 마스킹
    """
    h, w = image.shape[:2]
    result = np.zeros_like(image)  # 전체 블랙

    # TODO: API 응답 형식 확정 후 아래 로직 구현
    # 예시 1 - 바운딩박스 형식
    # for box in api_response['bounding_boxes']:
    #     x, y, bw, bh = box['x'], box['y'], box['w'], box['h']
    #     result[y:y+bh, x:x+bw] = image[y:y+bh, x:x+bw]

    # 예시 2 - 마스크 좌표 형식
    # mask = np.array(api_response['lesion_mask'], dtype=np.int32)
    # cv2.fillPoly(result, [mask], (255, 255, 255))
    # result = cv2.bitwise_and(image, image, mask=result[:,:,0])

    # 상하단 라벨 영역 마스킹
    result[:int(h * 0.08), :] = 0
    result[int(h * 0.92):, :] = 0

    return result
```

> API 응답 형식이 확정되면 위 코드를 업데이트합니다.
> 확인이 필요한 정보: 응답 좌표 형식 (바운딩박스 / 마스크 / 폴리곤), 좌표 기준 (픽셀 / 비율), 다중 병변 동시 반환 여부

### 4단계. Supabase Storage 업로드

```javascript
// Node.js 예시
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

async function uploadToSupabase(cleanImageBuffer, userId) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

  // 개인정보 없는 UUID 기반 파일명
  const filename = `${userId}/${uuidv4()}.png`;

  const { error } = await supabase.storage
    .from('skin-images')
    .upload(filename, cleanImageBuffer, {
      contentType: 'image/png',
      upsert: false
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from('skin-images')
    .getPublicUrl(filename);

  return data.publicUrl;
}
```

### 5단계. DB에 기록 저장

```javascript
async function saveRecord(supabase, userId, imageUrl) {
  const { error } = await supabase
    .from('analysis_records')
    .insert({
      user_id: userId,
      image_url: imageUrl,
      is_masked: true,
      status: 'pending'  // AI 분석 대기 상태
    });

  if (error) throw error;
}
```

### 백엔드 체크리스트

- [ ] multer 파일 업로드 미들웨어 설정
- [ ] 파일 형식 / 크기 / 무결성 검증
- [ ] EXIF 메타데이터 완전 제거
- [ ] 상하단 라벨 영역 블랙 마스킹
- [ ] 안면 랜드마크 탐지 및 눈 마스킹
- [ ] 마스킹 범위 의료팀과 협의
- [ ] Supabase Storage Private 버킷 업로드
- [ ] DB analysis_records 테이블에 기록 저장
- [ ] JWT 인증 미들웨어 적용
- [ ] 처리 실패 시 에러 핸들링
- [ ] 비동기 처리 (처리 시간 최적화)

---

## 역할 분리 요약

| 작업 | 담당 | 이유 |
|------|------|------|
| 이미지 전송 | 프론트엔드 | 사용자 액션 처리 |
| 파일 유효성 검증 | 백엔드 | 보안상 서버에서 반드시 검증 |
| EXIF 제거 | 백엔드 | 완전한 제거 보장, 우회 방지 |
| 식별 영역 마스킹 | 백엔드 | AI 모델 필요, 정확한 좌표 계산 |
| Supabase 업로드 | 백엔드 | API 키 노출 방지 |
| DB 기록 저장 | 백엔드 | 데이터 무결성 보장 |

---

## 이슈 및 해결 방안

| 이슈 | 내용 | 해결 방안 |
|------|------|----------|
| 원본 이미지 전송 | EXIF 포함 원본이 네트워크로 전송됨 | HTTPS 필수 적용 |
| 서버 부하 집중 | 마스킹·검증 작업이 백엔드에 집중 | 비동기 처리 + 큐 방식 권장 |
| 전송 용량 | 원본 이미지 그대로 전송 시 용량 클 수 있음 | 최대 10MB 제한 |
| 처리 대기 시간 | 마스킹 처리 시간만큼 사용자 대기 | 로딩 UI 필수 구현 |
