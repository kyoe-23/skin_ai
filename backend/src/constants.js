// ─────────────────────────────────────────────────────
// 공용 상수 모듈
// 모든 라우트·미들웨어가 동일한 키와 메시지를 공유한다.
// ─────────────────────────────────────────────────────

// HTTP 상태코드
const HTTP_STATUS = Object.freeze({
  OK:           200,
  CREATED:      201,
  NO_CONTENT:   204,
  BAD_REQUEST:  400,
  UNAUTHORIZED: 401,
  FORBIDDEN:    403,
  NOT_FOUND:    404,
  CONFLICT:     409,
  UNPROCESSABLE: 422,
  TOO_MANY:     429,
  SERVER_ERROR: 500,
  BAD_GATEWAY:  502,
  UNAVAILABLE:  503,
  GATEWAY_TIMEOUT: 504,
});

// 사용자 노출 에러 메시지 (한국어)
const ERROR_MESSAGES = Object.freeze({
  AUTH_REQUIRED:        '로그인이 필요합니다.',
  TOKEN_INVALID:        '토큰이 만료됐거나 유효하지 않습니다.',
  SERVER_ERROR:         '서버 오류가 발생했습니다.',
  REQUIRED_FIELDS:      '필수 항목을 모두 입력해주세요.',
  EMAIL_DUPLICATE:      '이미 가입된 이메일입니다.',
  EMAIL_REQUIRED:       '이메일을 입력해주세요.',
  EMAIL_INVALID:        '올바른 이메일 형식이 아닙니다.',
  LOGIN_INVALID:        '이메일 또는 비밀번호가 올바르지 않습니다.',
  PASSWORD_TOO_SHORT:   `비밀번호는 ${8}자 이상이어야 합니다.`,
  PASSWORD_MISMATCH:    '현재 비밀번호가 일치하지 않습니다.',
  PASSWORD_SAME:        '새 비밀번호가 기존 비밀번호와 동일합니다.',
  RESET_LINK_INVALID:   '링크가 만료되었거나 이미 사용된 링크입니다.',
  RESET_SENT:           '재설정 링크를 발송했습니다.',
  RECORD_NOT_FOUND:     '기록을 찾을 수 없습니다.',
  IMAGE_MISSING:        '이미지가 없습니다.',
  IMAGE_INVALID:        '유효하지 않은 이미지 파일입니다.',
  CODE_INVALID:         '인증 코드가 올바르지 않거나 만료되었습니다.',
  CODE_LENGTH:          '6자리 코드를 입력해주세요.',
  WITHDRAW_FAIL:        '탈퇴 처리 중 오류가 발생했습니다.',
  NOT_OWNER:            '권한이 없습니다.',
});

// 인증 설정
const AUTH_CONFIG = Object.freeze({
  BCRYPT_ROUNDS:          Number(process.env.BCRYPT_ROUNDS || 12),
  JWT_EXPIRES_IN:         process.env.JWT_EXPIRE || '1h',
  PASSWORD_MIN_LENGTH:    Number(process.env.PASSWORD_MIN_LENGTH || 8),
  PASSWORD_RESET_TTL_MS:  Number(process.env.PASSWORD_RESET_TTL_MS || 15 * 60 * 1000),
  EMAIL_CODE_TTL_MS:      Number(process.env.EMAIL_CODE_TTL_MS     || 5  * 60 * 1000),
  EMAIL_CODE_LENGTH:      6,
});

// Supabase Storage 버킷
const STORAGE_BUCKETS = Object.freeze({
  SKIN_IMAGES: 'skin-images',
  GRADCAM:     'gradcam',     // 신규 — 마이그레이션 후 사용
  AVATARS:     'avatars',     // 신규
});

// DS_unified 11종 — 한글명 ↔ DB 키 매핑
const DISEASE_KEY_MAP = Object.freeze({
  건선:         'psoriasis',
  아토피피부염:  'atopic_dermatitis',
  여드름:        'acne',
  광선각화증:    'actinic_keratosis',
  기저세포암:    'basal_cell_carcinoma',
  멜라닌세포모반: 'melanocytic_nevi',
  악성흑색종:    'melanoma',
  지루각화증:    'seborrheic_keratosis',
  편평세포암:    'squamous_cell_carcinoma',
  피부섬유종:    'dermatofibroma',
  혈관종:       'vascular_lesion',
});

const USER_ROLES = Object.freeze(['resident', 'student', 'doctor']);

module.exports = {
  HTTP_STATUS,
  ERROR_MESSAGES,
  AUTH_CONFIG,
  STORAGE_BUCKETS,
  DISEASE_KEY_MAP,
  USER_ROLES,
};
