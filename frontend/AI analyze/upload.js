// ══════════════════════════════════════════
//  SkinAI — 프론트엔드 이미지 업로드 모듈
//  역할: 전처리된 클린 이미지를 서버로 전송
//
//  의존: config.js (UPLOAD_CONFIG), masking.js (processImage)
// ══════════════════════════════════════════


// ──────────────────────────────────────────
//  서버 업로드
//  JWT 인증 헤더 포함 + 업로드 진행률 콜백 + 실패 시 자동 재시도
//
//  params:
//    cleanBlob  — masking.js의 processImage()가 반환한 blob
//    token      — JWT 토큰 (localStorage 등에서 가져옴)
//    userId     — 현재 로그인 사용자 ID
//    onProgress — (0~100) 진행률 콜백 함수 (선택)
//
//  반환: 서버 응답 JSON (예: { imageUrl: '...' })
// ──────────────────────────────────────────
async function uploadImage(cleanBlob, token, userId, onProgress = null) {
  const formData = new FormData();
  formData.append('image',     cleanBlob, IMAGE_CONFIG.outputFileName);
  formData.append('userId',    userId);
  formData.append('timestamp', Date.now());

  for (let attempt = 0; attempt <= UPLOAD_CONFIG.maxRetries; attempt++) {
    try {
      return await _xhrUpload(formData, token, onProgress);
    } catch (err) {
      if (attempt === UPLOAD_CONFIG.maxRetries) throw err;
      const delay = UPLOAD_CONFIG.retryBaseDelayMs * (attempt + 1);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}


// ──────────────────────────────────────────
//  XHR 기반 업로드 내부 함수
//  fetch는 업로드 진행률을 알 수 없으므로 XHR 사용
// ──────────────────────────────────────────
function _xhrUpload(formData, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', UPLOAD_CONFIG.endpoint);

    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('서버 응답 파싱 실패'));
        }
      } else {
        reject(new Error(`업로드 실패 (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror   = () => reject(new Error('네트워크 오류'));
    xhr.ontimeout = () => reject(new Error('업로드 타임아웃'));
    xhr.timeout   = UPLOAD_CONFIG.timeoutMs;

    xhr.send(formData);
  });
}
