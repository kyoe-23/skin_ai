# ══════════════════════════════════════════
#  SkinAI — 백엔드 이미지 처리 모듈
#  역할: 2차 EXIF 검증 → 파일 검증 → 안면 마스킹 → Supabase 업로드 → DB 저장
#
#  환경변수 (.env):
#    SUPABASE_URL
#    SUPABASE_KEY
#    SUPABASE_BUCKET
#    ALLOWED_IMAGE_TYPES   (콤마 구분, 예: image/png,image/jpeg)
#    MAX_IMAGE_SIZE_MB
# ══════════════════════════════════════════

import io
import os
import uuid
from datetime import datetime

import cv2
import face_recognition
import numpy as np
from PIL import Image
from supabase import create_client


# ──────────────────────────────────────────
#  설정 — 하드코딩 금지, 모두 환경변수에서 로드
# ──────────────────────────────────────────
SUPABASE_URL    = os.environ['SUPABASE_URL']
SUPABASE_KEY    = os.environ['SUPABASE_KEY']
SUPABASE_BUCKET = os.environ['SUPABASE_BUCKET']

ALLOWED_TYPES = os.environ.get('ALLOWED_IMAGE_TYPES', 'image/png,image/jpeg').split(',')
MAX_SIZE_MB   = int(os.environ.get('MAX_IMAGE_SIZE_MB', '10'))

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)


# ──────────────────────────────────────────
#  1. 2차 EXIF 완전 제거
#  프론트에서 제거했더라도 우회 가능성 차단
#  픽셀 데이터만 추출해 새 이미지 생성 → EXIF 완전 소거
# ──────────────────────────────────────────
def strip_exif(image_bytes: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(image_bytes))
    clean = Image.new(img.mode, img.size)
    clean.putdata(list(img.getdata()))
    return clean


# ──────────────────────────────────────────
#  2. 파일 유효성 검증
#  - 허용 타입: 환경변수 ALLOWED_IMAGE_TYPES
#  - 최대 크기: 환경변수 MAX_IMAGE_SIZE_MB
#  - 매직 바이트로 실제 이미지 여부 확인
# ──────────────────────────────────────────
MAGIC_BYTES = {
    b'\x89PNG':  'image/png',
    b'\xff\xd8': 'image/jpeg',
}

def validate_image(content_type: str, size: int, header: bytes):
    if content_type not in ALLOWED_TYPES:
        raise ValueError(f'허용되지 않는 파일 형식: {content_type}')

    if size > MAX_SIZE_MB * 1024 * 1024:
        raise ValueError(f'파일 크기 초과 (최대 {MAX_SIZE_MB}MB)')

    detected = next(
        (mime for magic, mime in MAGIC_BYTES.items() if header.startswith(magic)),
        None
    )
    if detected is None:
        raise ValueError('유효하지 않은 이미지 파일')


# ──────────────────────────────────────────
#  3. 안면 식별 영역 마스킹
#  face_recognition으로 눈 좌표 탐지 후 블랙 마스킹
#
#  주의: 코·입 주변은 피부 질환 부위일 수 있어
#        마스킹 범위는 의료팀과 협의 후 결정
# ──────────────────────────────────────────
def mask_facial_features(image_array: np.ndarray) -> np.ndarray:
    landmarks_list = face_recognition.face_landmarks(image_array)

    for face in landmarks_list:
        # 눈 마스킹
        for eye in ['left_eye', 'right_eye']:
            pts = np.array(face[eye], dtype=np.int32)
            cv2.fillPoly(image_array, [pts], (0, 0, 0))

        # 코 마스킹 — 질환 부위일 수 있으므로 의료팀 협의 후 활성화
        # nose_pts = np.array(face['nose_tip'], dtype=np.int32)
        # cv2.fillPoly(image_array, [nose_pts], (0, 0, 0))

    return image_array


# ──────────────────────────────────────────
#  4. Supabase Storage 업로드
#  파일명: {user_id}/{uuid}.png — 개인정보 없는 랜덤 파일명
#  반환: 공개 URL 문자열
# ──────────────────────────────────────────
def upload_to_supabase(image_bytes: bytes, user_id: str) -> str:
    filename = f'{user_id}/{uuid.uuid4()}.png'

    supabase.storage.from_(SUPABASE_BUCKET).upload(
        path=filename,
        file=image_bytes,
        file_options={'content-type': 'image/png'},
    )

    return supabase.storage.from_(SUPABASE_BUCKET).get_public_url(filename)


# ──────────────────────────────────────────
#  5. DB에 분석 기록 저장
#  실제 이미지는 Storage에, DB엔 URL만 저장 (용량 효율)
# ──────────────────────────────────────────
def save_record(user_id: str, image_url: str):
    supabase.table('analysis_records').insert({
        'user_id':    user_id,
        'image_url':  image_url,
        'created_at': datetime.utcnow().isoformat(),
        'status':     'pending',  # AI 분석 대기 상태
    }).execute()


# ──────────────────────────────────────────
#  전체 파이프라인 (메인 함수)
#  validate → strip_exif → mask_facial_features → upload → save_record
//
#  params:
#    file_bytes    — 업로드된 원본 이미지 bytes
#    content_type  — MIME 타입 (예: 'image/jpeg')
#    user_id       — 로그인 사용자 ID
#
#  반환: { image_url: '...' }
# ──────────────────────────────────────────
def process_and_store(file_bytes: bytes, content_type: str, user_id: str) -> dict:
    # 2-1. 파일 검증 (매직 바이트는 앞 8바이트만 확인)
    validate_image(content_type, len(file_bytes), file_bytes[:8])

    # 2-2. 2차 EXIF 제거
    clean_pil = strip_exif(file_bytes)

    # 2-3. 안면 마스킹
    img_array = np.array(clean_pil)
    masked_array = mask_facial_features(img_array)

    # 2-4. PNG bytes로 변환
    output = io.BytesIO()
    Image.fromarray(masked_array).save(output, format='PNG')
    clean_bytes = output.getvalue()

    # 2-5. Supabase 업로드 + DB 저장
    image_url = upload_to_supabase(clean_bytes, user_id)
    save_record(user_id, image_url)

    return {'image_url': image_url}
