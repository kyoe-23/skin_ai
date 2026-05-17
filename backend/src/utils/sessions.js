// ─────────────────────────────────────────────────────
// 세션·JWT 헬퍼
// ─────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { AUTH_CONFIG } = require('../constants');

// User-Agent 문자열에서 사람이 읽을 수 있는 디바이스 라벨 추출
const parseDeviceLabel = (ua) => {
  if (!ua) return '알 수 없는 기기';

  let device = 'Windows';
  if (/iPhone/.test(ua))         device = 'iPhone';
  else if (/iPad/.test(ua))      device = 'iPad';
  else if (/Android/.test(ua))   device = 'Android';
  else if (/Macintosh/.test(ua)) device = 'Mac';
  else if (/Linux/.test(ua))     device = 'Linux';

  let browser = 'Chrome';
  if (/Firefox\//.test(ua))                          browser = 'Firefox';
  else if (/Edg\//.test(ua))                         browser = 'Edge';
  else if (/OPR\/|Opera\//.test(ua))                 browser = 'Opera';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';

  return `${device} · ${browser}`;
};

// req 에서 IP 주소 추출 (proxy 환경 고려)
const extractIp = (req) => {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
};

// 로그인·회원가입 시 새 세션 행 생성 후 JWT 발급
// user_sessions 테이블(마이그레이션 005)이 아직 적용 안 된 환경에서는
// session 없이 JWT만 발급하는 fallback 으로 동작한다.
const issueTokenAndSession = async ({ userId, role, req }) => {
  const userAgent = req.headers['user-agent'] || null;
  const ipAddress = extractIp(req);
  const deviceLabel = parseDeviceLabel(userAgent);

  let sessionId = null;
  try {
    const { data, error } = await supabase
      .from('user_sessions')
      .insert([{
        user_id:      userId,
        user_agent:   userAgent,
        ip_address:   ipAddress,
        device_label: deviceLabel,
      }])
      .select('session_id')
      .single();
    if (!error && data) sessionId = data.session_id;
  } catch (_) {
    // 테이블 미존재 등 — fallback 으로 진행
  }

  const payload = { user_id: userId, role };
  if (sessionId) payload.session_id = sessionId;

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: AUTH_CONFIG.JWT_EXPIRES_IN,
  });

  return { token, sessionId };
};

// 지정 세션 무효화 (개별 로그아웃)
const revokeSession = async (sessionId) => {
  if (!sessionId) return;
  await supabase
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .is('revoked_at', null);
};

// 유저의 모든 활성 세션 무효화 (예외: keepSessionId — 현재 세션 유지)
const revokeAllSessions = async (userId, keepSessionId = null) => {
  let query = supabase
    .from('user_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (keepSessionId) {
    query = query.neq('session_id', keepSessionId);
  }
  await query;
};

module.exports = {
  parseDeviceLabel,
  extractIp,
  issueTokenAndSession,
  revokeSession,
  revokeAllSessions,
};
