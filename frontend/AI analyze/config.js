// ══════════════════════════════════════════
//  SkinAI — 이미지 처리 공통 설정
//  하드코딩 방지: 모든 상수는 여기서 관리
// ══════════════════════════════════════════

const IMAGE_CONFIG = {
  // 허용 파일 타입
  allowedTypes: ['image/png', 'image/jpeg', 'image/jpg'],

  // 최대 파일 크기 (MB)
  maxSizeMB: 10,

  // 마스킹 비율 (0~1)
  maskTopRatio:    0.08,   // 상단 8% — 병원명, 환자명 라벨
  maskBottomRatio: 0.08,   // 하단 8% — 하단 정보 라벨
  // maskSideRatio: 0.05,  // 좌우 여백 — 필요 시 활성화

  // 출력 이미지 포맷
  outputFormat: 'image/png',
  outputFileName: 'skin_image.png',
};

const UPLOAD_CONFIG = {
  // API 엔드포인트
  endpoint: '/api/upload',

  // 요청 타임아웃 (ms)
  timeoutMs: 30000,

  // 실패 시 재시도 횟수
  maxRetries: 2,

  // 재시도 기본 대기 시간 (ms) — 시도마다 배수로 증가
  retryBaseDelayMs: 800,
};
