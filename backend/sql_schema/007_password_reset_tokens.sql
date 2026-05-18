-- ─────────────────────────────────────────────────────────────
-- 007 — password_reset_tokens 테이블
-- 비밀번호 재설정 토큰을 인메모리 Map → DB 로 영속화.
-- 서버 재시작·다중 인스턴스 환경에서도 일관성 유지.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       TEXT PRIMARY KEY,                                       -- crypto.randomBytes(32).hex
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,                                   -- 발급 시 + PASSWORD_RESET_TTL_MS
  used_at     TIMESTAMPTZ,                                            -- 1회용 보장 — 세팅되면 무효
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 동일 유저의 활성 토큰 조회 / 정리용 partial index
CREATE INDEX IF NOT EXISTS idx_pw_reset_user_active
  ON password_reset_tokens (user_id)
  WHERE used_at IS NULL;

-- 만료 토큰 일괄 정리용 (pg_cron 으로 주기 정리 시 사용)
CREATE INDEX IF NOT EXISTS idx_pw_reset_expires
  ON password_reset_tokens (expires_at);

-- 운영 노트:
--   cron 으로 expires_at < now() - interval '1 day' 인 행 일괄 삭제 권장
--   예) SELECT cron.schedule('pw_reset_gc', '0 3 * * *',
--         $$DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '1 day'$$);
