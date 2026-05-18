# DB Migrations

수동 적용. Supabase Dashboard → SQL Editor 에서 **숫자 순서대로** 한 파일씩 실행한다.

| # | 파일 | 영향 |
|---|------|------|
| 001 | `001_users_extend_columns.sql` | `users` 테이블에 `bio`, `department`, `avatar_url`, `password_changed_at`, `updated_at` 컬럼 + `role` CHECK 갱신 + 트리거 |
| 002 | `002_analysis_records_updated_at.sql` | `analysis_records.updated_at` + 인덱스 |
| 003 | `003_bookmarks.sql` | `bookmarks` 신규 테이블 |
| 004 | `004_notification_preferences.sql` | `notification_preferences` 신규 테이블 |
| 005 | `005_user_sessions.sql` | `user_sessions` 신규 테이블 |
| 006 | `006_storage_buckets.sql` | `gradcam`·`avatars` Storage 버킷 (권한 부족 시 Dashboard 에서 수동 생성) |
| 007 | `007_password_reset_tokens.sql` | `password_reset_tokens` 신규 — 인메모리 Map → DB 영속화 |
| 008 | `008_email_verification_codes.sql` | `email_verification_codes` 신규 — 인메모리 Map → DB 영속화 |

## 적용 후 코드 동작 확인

```bash
cd backend && npm start
# 다른 터미널에서
curl http://localhost:3000/api/auth/check-email?email=test@test.com
```

## 환경변수 (`backend/.env`)

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ENFORCE_SESSION` | `true` | 미들웨어가 JWT의 `session_id`를 `user_sessions` 테이블로 검증. 마이그레이션 005 미적용 환경에서는 `false` 권장 |
| `BCRYPT_ROUNDS` | `12` | bcrypt salt rounds |
| `PASSWORD_MIN_LENGTH` | `8` | 비밀번호 최소 길이 |
| `PASSWORD_RESET_TTL_MS` | `900000` | 재설정 토큰 유효시간 (ms, 15분) |
| `EMAIL_CODE_TTL_MS` | `300000` | 이메일 변경 코드 유효시간 (ms, 5분) |
| `AVATAR_MAX_BYTES` | `5242880` | 아바타 업로드 최대 크기 (5MB) |
| `AVATAR_RESIZE_PX` | `256` | 아바타 정사각 리사이즈 픽셀 |
| `UPLOAD_MAX_BYTES` | `10485760` | 일반 이미지 업로드 최대 (10MB) |

마이그레이션이 모두 적용되기 전이라도 `issueTokenAndSession` 에는 fallback 이 있어 로그인은 동작한다 (단 세션 기능은 비활성).

**중요**: 마이그레이션 007·008 적용 전에는 비밀번호 재설정·이메일 변경 라우트가 **항상 실패**한다 (관련 코드가 DB 의존). 단, 회원가입·로그인·일반 인증은 정상 동작.

## 정리 잡 (선택)

`password_reset_tokens` / `email_verification_codes` 는 만료 행이 누적되므로 `pg_cron` 으로 일일 정리 권장:

```sql
SELECT cron.schedule('pw_reset_gc',  '0 3 * * *',
  $$DELETE FROM password_reset_tokens     WHERE expires_at < now() - interval '1 day'$$);
SELECT cron.schedule('email_code_gc', '0 3 * * *',
  $$DELETE FROM email_verification_codes  WHERE expires_at < now() - interval '1 day'$$);
```

## 롤백

각 마이그레이션은 idempotent (`IF NOT EXISTS`, `IF EXISTS`)하게 작성됨. 롤백 SQL은 별도 작성 필요.
