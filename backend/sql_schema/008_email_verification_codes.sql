-- ─────────────────────────────────────────────────────────────
-- 008 — email_verification_codes 테이블
-- 프로필 이메일 변경 시 6자리 인증 코드를 인메모리 Map → DB 로 영속화.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email       TEXT NOT NULL,                                          -- 변경 후 적용할 이메일
  code        CHAR(6) NOT NULL,                                       -- 6자리 숫자 (crypto.randomInt)
  expires_at  TIMESTAMPTZ NOT NULL,                                   -- 발급 시 + EMAIL_CODE_TTL_MS
  verified_at TIMESTAMPTZ,                                            -- 인증 완료 시각 — NULL 이면 미사용
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 사용자별 활성(미인증) 코드 검증·정리용 partial index
CREATE INDEX IF NOT EXISTS idx_email_code_user_active
  ON email_verification_codes (user_id, expires_at DESC)
  WHERE verified_at IS NULL;

-- 만료 코드 일괄 정리용
CREATE INDEX IF NOT EXISTS idx_email_code_expires
  ON email_verification_codes (expires_at);

-- 운영 노트:
--   cron 으로 expires_at < now() - interval '1 day' 인 행 일괄 삭제 권장
