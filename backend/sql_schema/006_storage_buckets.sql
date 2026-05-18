-- ─────────────────────────────────────────────────────────────
-- 006 — Storage 버킷 분리
-- 의료영상(skin-images) ↔ 시각화(gradcam) ↔ 프로필(avatars) 정책 분리
--
-- 주의: 일부 버전의 Supabase에서는 storage.buckets 에 직접 insert 권한이
-- 제한될 수 있다. 그 경우 Supabase Dashboard → Storage → New bucket 에서
-- 동일 이름으로 수동 생성한 후 RLS 정책만 SQL로 적용한다.
-- ─────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('gradcam',  'gradcam',  true),
  ('avatars',  'avatars',  true)
ON CONFLICT (id) DO NOTHING;
