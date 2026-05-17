-- ─────────────────────────────────────────────────────────────
-- 005 — user_sessions 테이블 (다중 기기 세션 관리)
-- JWT 발급 시 세션 행 생성, '모든 기기 로그아웃' 시 일괄 무효화
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  user_agent   TEXT,
  ip_address   INET,
  device_label TEXT,                          -- 'iPhone · Safari' 등 파싱 결과
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ                    -- NULL = 활성
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON user_sessions (user_id, revoked_at);
