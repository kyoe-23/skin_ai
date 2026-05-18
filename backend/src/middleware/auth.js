const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { HTTP_STATUS, ERROR_MESSAGES } = require('../constants');

// 세션 검증을 ENABLE 할지 (마이그레이션 005 적용 전이라면 false 권장)
const ENFORCE_SESSION =
  String(process.env.ENFORCE_SESSION ?? 'true').toLowerCase() === 'true';

const _respond = (res, status, message) =>
  res.status(status).json({ message });

// JWT payload 의 session_id 가 user_sessions 에서 활성 상태인지 확인
const _isSessionActive = async (sessionId) => {
  if (!sessionId) return false;
  const { data, error } = await supabase
    .from('user_sessions')
    .select('session_id, revoked_at')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error || !data) return false;
  return data.revoked_at === null;
};

// 비동기 last_seen_at 업데이트 (응답 지연 방지를 위해 fire-and-forget)
const _touchSession = (sessionId) => {
  if (!sessionId) return;
  supabase
    .from('user_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .then(() => {}, () => {});
};

const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return _respond(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.AUTH_REQUIRED);
    }

    jwt.verify(token, process.env.JWT_SECRET, async (err, payload) => {
      if (err) {
        return _respond(res, HTTP_STATUS.FORBIDDEN, ERROR_MESSAGES.TOKEN_INVALID);
      }

      // session_id 가 있고 강제 모드면 활성 여부 검증
      if (ENFORCE_SESSION && payload.session_id) {
        const active = await _isSessionActive(payload.session_id);
        if (!active) {
          return _respond(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.TOKEN_INVALID);
        }
        _touchSession(payload.session_id);
      }

      req.user = payload;
      next();
    });
  } catch (error) {
    console.error('인증 미들웨어 에러:', error);
    _respond(res, HTTP_STATUS.SERVER_ERROR, ERROR_MESSAGES.SERVER_ERROR);
  }
};

const optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      req.user = null;
      return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, payload) => {
      req.user = err ? null : payload;
      next();
    });
  } catch (error) {
    console.error('선택적 인증 에러:', error);
    req.user = null;
    next();
  }
};

module.exports = { authenticateToken, optionalAuth };
