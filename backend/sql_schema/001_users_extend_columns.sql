-- ─────────────────────────────────────────────────────────────
-- 001 — users 테이블 확장
-- 추가: bio, department, avatar_url, password_changed_at, updated_at
-- 변경: user_role ENUM 에 'doctor' 값 추가
-- ─────────────────────────────────────────────────────────────

-- 컬럼 추가 (이미 존재 시 무시)
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- role 값 확장 — Supabase 의 users.role 은 user_role ENUM 타입이므로
-- CHECK 제약이 아닌 ENUM 값 추가가 필요하다.
-- (ALTER TYPE ... ADD VALUE 는 별도 트랜잭션에서 실행되어야 하므로 단독 문장으로 둠)
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'doctor';

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
