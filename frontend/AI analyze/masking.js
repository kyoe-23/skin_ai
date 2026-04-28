// ══════════════════════════════════════════
//  SkinAI — 프론트엔드 이미지 마스킹 모듈
//  역할: 파일 검증 → EXIF 제거 → 식별 영역 마스킹 → PNG 변환
//
//  의존: config.js (IMAGE_CONFIG)
// ══════════════════════════════════════════


// ──────────────────────────────────────────
//  1. 파일 유효성 검사
//  반환: { ok: true } or { ok: false, reason: '...' }
// ──────────────────────────────────────────
function validateImageFile(file) {
  if (!IMAGE_CONFIG.allowedTypes.includes(file.type)) {
    return {
      ok: false,
      reason: `허용된 파일 형식: ${IMAGE_CONFIG.allowedTypes.join(', ')}`,
    };
  }

  const maxBytes = IMAGE_CONFIG.maxSizeMB * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: `파일 크기는 ${IMAGE_CONFIG.maxSizeMB}MB 이하여야 합니다.`,
    };
  }

  return { ok: true };
}


// ──────────────────────────────────────────
//  2. EXIF 메타데이터 제거
//  Canvas에 다시 그려 순수 PNG로 변환
//  → GPS 위치, 촬영 기기, 날짜/시간, 병원 정보 등 모두 소거
//  반환: { canvas }
// ──────────────────────────────────────────
function stripExif(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.width;
      canvas.height = img.height;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      resolve({ canvas });
    };

    img.src = objectUrl;
  });
}


// ──────────────────────────────────────────
//  3. 식별 영역 마스킹 (블랙박스)
//  상단 + 하단 — 병원 라벨, 환자명, 날짜 스탬프 등 제거
//  마스킹 비율은 config.js의 IMAGE_CONFIG에서 조정
//
//  주의: 눈·코·입 마스킹은 백엔드에서 AI 모델로 처리
// ──────────────────────────────────────────
function maskIdentityArea(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#000000';

  // 상단 라벨 영역
  ctx.fillRect(0, 0, w, Math.floor(h * IMAGE_CONFIG.maskTopRatio));

  // 하단 라벨 영역
  const bottomStart = Math.floor(h * (1 - IMAGE_CONFIG.maskBottomRatio));
  ctx.fillRect(0, bottomStart, w, h - bottomStart);

  // 좌우 여백 마스킹 — config에 maskSideRatio 추가 후 아래 주석 해제
  // const sideW = Math.floor(w * IMAGE_CONFIG.maskSideRatio);
  // ctx.fillRect(0, 0, sideW, h);
  // ctx.fillRect(w - sideW, 0, sideW, h);
}


// ──────────────────────────────────────────
//  4. 전처리 파이프라인 (메인 함수)
//  validateImageFile → stripExif → maskIdentityArea → PNG Blob 반환
//
//  사용법:
//    const result = await processImage(file);
//    result.blob    → 서버 업로드용 클린 Blob (upload.js로 전달)
//    result.dataUrl → 미리보기용 Data URL
//    result.error   → 실패 시 에러 메시지
// ──────────────────────────────────────────
async function processImage(file) {
  const validation = validateImageFile(file);
  if (!validation.ok) return { error: validation.reason };

  const { canvas } = await stripExif(file);
  maskIdentityArea(canvas);

  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve({ blob, dataUrl: canvas.toDataURL(IMAGE_CONFIG.outputFormat) }),
      IMAGE_CONFIG.outputFormat
    );
  });
}
