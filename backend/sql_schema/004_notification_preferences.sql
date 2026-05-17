-- ─────────────────────────────────────────────────────────────
-- 004 — notification_preferences 테이블 (프로필 알림 설정)
-- 사용자당 1개 행 (1:1)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id            UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  notify_email       BOOLEAN NOT NULL DEFAULT true,   -- 이메일 알림 수신
  notify_marketing   BOOLEAN NOT NULL DEFAULT false,  -- 마케팅 정보 수신
  notify_record_done BOOLEAN NOT NULL DEFAULT true,   -- 분석 완료 알림
  notify_weekly      BOOLEAN NOT NULL DEFAULT true,   -- 주간 학습 리포트
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_notify_prefs_updated_at ON notification_preferences;
CREATE TRIGGER trg_notify_prefs_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
