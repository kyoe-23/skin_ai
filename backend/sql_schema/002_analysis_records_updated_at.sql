-- ─────────────────────────────────────────────────────────────
-- 002 — analysis_records 에 updated_at 컬럼 추가
-- 답 제출·채팅 추가 시각 추적 가능
-- ─────────────────────────────────────────────────────────────

ALTER TABLE analysis_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_records_updated_at ON analysis_records;
CREATE TRIGGER trg_records_updated_at
  BEFORE UPDATE ON analysis_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- my_analyze 페이지네이션·정렬 인덱스
CREATE INDEX IF NOT EXISTS idx_records_user_created
  ON analysis_records (user_id, created_at DESC);
