-- ─────────────────────────────────────────────────────────────
-- 003 — bookmarks 테이블 (record_detail 북마크 기능)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bookmarks (
  bookmark_id BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  record_id   UUID NOT NULL REFERENCES analysis_records(record_id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, record_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created
  ON bookmarks (user_id, created_at DESC);
