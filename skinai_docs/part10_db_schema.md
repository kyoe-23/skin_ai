# Part 10 — DB 테이블 기술서 (Supabase)

SkinAI 백엔드(`backend/src/`)와 프론트엔드(`frontend/`)에서 실제로 구현된 기능을 역추적해 정리한 **Supabase 기준 테이블 명세서**. 마이그레이션 SQL·RLS 정책·신규 기능 설계의 기준 문서.

> **범위**: 커뮤니티 기능(`posts`·`comments`)은 본 문서에서 제외.
> **분류**:
> - 〔운영 중〕 — 코드에서 직접 `.from()` 호출 + `sql_schema/` 마이그레이션 정의 존재
> - 〔후보〕 — 기능은 동작하나 인메모리·JSONB 등 비정규화 저장. DB 분리 권장

마이그레이션 파일은 `backend/sql_schema/` 에 `001~006*.sql` 로 분리. Supabase Dashboard SQL Editor 에서 순서대로 실행.

---

## ERD 요약

```
users (PK user_id)
  │
  ├──< analysis_records (PK record_id, FK user_id)        [운영 중]
  │       ├──< chat_messages (FK record_id)               [후보 — 현재 JSONB 컬럼]
  │       └──< bookmarks (FK user_id, record_id)          [운영 중]
  │
  ├──< notification_preferences (PK user_id, 1:1)         [운영 중]
  ├──< user_sessions (FK user_id)                         [운영 중]
  ├──< password_reset_tokens (FK user_id)                 [후보 — 현재 인메모리 Map]
  └──< email_verification_codes (FK user_id)              [후보 — 현재 인메모리 Map]

Storage 버킷
  ├── skin-images/{user_id}/{uuid}.png        원본 (EXIF·라벨 마스킹)
  ├── gradcam/{user_id}/{record_id}.png       Grad-CAM heatmap
  └── avatars/{user_id}/{uuid}.webp            프로필 사진
```

---

## 1) `users` — 회원 계정·의료진 프로필 〔운영 중〕

회원가입·로그인·프로필·아바타·탈퇴에서 사용. 관련 코드:
- [auth.js:83](../backend/src/routes/auth.js#L83) 회원가입
- [auth.js:149](../backend/src/routes/auth.js#L149) 로그인
- [users.js:41](../backend/src/routes/users.js#L41) 프로필 조회·수정
- [auth.js:381](../backend/src/routes/auth.js#L381) 탈퇴

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `user_id` | UUID | ✅ | `gen_random_uuid()` | PK |
| `email` | TEXT | ✅ | — | 로그인 ID, UNIQUE |
| `password_hash` | TEXT | ✅ | — | bcrypt salt=12 (`BCRYPT_ROUNDS` 환경변수로 조정) |
| `name` | TEXT | ✅ | — | 회원가입 입력 |
| `role` | TEXT | ✅ | — | `'resident'` \| `'student'` \| `'doctor'` (CHECK) |
| `affiliation` | TEXT |  | — | 소속 병원·학교 |
| `year` | INT |  | — | 연차 (전공의 N년차 등) |
| `bio` | TEXT |  | — | 자기소개 ≤200자 |
| `department` | TEXT |  | — | 진료과 (예: 피부과·내과) |
| `avatar_url` | TEXT |  | — | `avatars` 버킷의 WebP Public URL |
| `password_changed_at` | TIMESTAMPTZ |  | `now()` | 비밀번호 변경 시각 (탈취 대응용 세션 무효화 근거) |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |
| `updated_at` | TIMESTAMPTZ | ✅ | `now()` | BEFORE UPDATE 트리거로 자동 갱신 |

### 인덱스 & 제약

- PK: `user_id`
- UNIQUE: `email`
- CHECK: `role IN ('resident', 'student', 'doctor')`

### 참고

- JWT payload: `{ user_id, role, session_id }`. 만료 1시간 (`JWT_EXPIRE` 환경변수).
- 비밀번호 변경·재설정 시 `password_changed_at` 갱신 + 현재 외 세션 모두 revoke ([auth.js:280](../backend/src/routes/auth.js#L280)).
- 탈퇴 시 `skin-images/{user_id}/` 폴더 + `analysis_records` 전체 삭제 ([auth.js:381](../backend/src/routes/auth.js#L381)).
- **RLS 후보**: `auth.uid() = user_id` 인 행만 select/update 허용.
- 마이그레이션: `sql_schema/001_users_extend_columns.sql`.

---

## 2) `analysis_records` — AI 분석 결과 이력 〔운영 중〕

이미지 분석 결과·LLM 리포트·채팅 이력을 한 로우에 저장. 관련 코드:
- [records.js:38](../backend/src/routes/records.js#L38) 저장
- [records.js:106](../backend/src/routes/records.js#L106) 목록·상세
- [records.js:206](../backend/src/routes/records.js#L206) 채팅 추가
- [records.js:231](../backend/src/routes/records.js#L231) 답 제출

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `record_id` | UUID | ✅ | `gen_random_uuid()` | PK |
| `user_id` | UUID | ✅ | — | FK → `users.user_id` ON DELETE CASCADE |
| `image_url` | TEXT | ✅ | — | 마스킹된 원본 (`skin-images` 버킷 Public URL) |
| `gradcam_url` | TEXT |  | — | Grad-CAM heatmap (`gradcam` 버킷, fallback: `skin-images`) |
| `is_masked` | BOOLEAN | ✅ | `true` | EXIF·라벨 마스킹 완료 여부 |
| `primary_diagnosis` | TEXT | ✅ | — | 11종 클래스 키 (예: `'psoriasis'`, `'acne'`) |
| `confidence` | REAL | ✅ | — | 0.0~1.0 |
| `differential` | JSONB |  | — | AI top3 후보 — §JSONB 예시 |
| `clinical_ref` | JSONB |  | — | 임상 통계 메타 (AI 서버 동봉) |
| `ai_findings` | JSONB |  | — | LLM 리포트 6필드 객체 |
| `chat_history` | JSONB |  | — | `[{role, content}, ...]` (§7 정규화 권장) |
| `user_answer` | TEXT |  | — | 학습용 사용자 답안(클래스 키) |
| `is_correct` | BOOLEAN |  | — | `user_answer === primary_diagnosis` 결과 |
| `status` | TEXT | ✅ | `'pending'` | `'pending'` \| `'completed'` |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |
| `updated_at` | TIMESTAMPTZ | ✅ | `now()` | BEFORE UPDATE 트리거 |

### 인덱스 & 제약

- PK: `record_id`
- FK: `user_id` → `users(user_id)` ON DELETE CASCADE
- CHECK: `status IN ('pending', 'completed')`, `confidence BETWEEN 0 AND 1`
- 인덱스: `(user_id, created_at DESC)` — my_analyze 페이지네이션

### 참고

- 클래스 키 매핑은 [constants.js:DISEASE_KEY_MAP](../backend/src/constants.js) 중앙화.
- 개별 record 삭제 시 `image_url`·`gradcam_url` 의 Storage 객체도 함께 삭제 ([records.js:164](../backend/src/routes/records.js#L164)).
- **RLS 후보**: `auth.uid() = user_id`.
- 마이그레이션: `sql_schema/002_analysis_records_updated_at.sql`.

---

## 3) `bookmarks` — 분석 기록 북마크 〔운영 중〕

`record_detail.html` 의 북마크 토글. 관련 코드:
- [records.js:262](../backend/src/routes/records.js#L262) 추가 (upsert)
- [records.js:278](../backend/src/routes/records.js#L278) 해제
- [records.js:124](../backend/src/routes/records.js#L124) 목록 (JOIN analysis_records)

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `bookmark_id` | BIGSERIAL | ✅ | — | PK |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `record_id` | UUID | ✅ | — | FK → `analysis_records` ON DELETE CASCADE |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 인덱스 & 제약

- PK: `bookmark_id`
- UNIQUE: `(user_id, record_id)` — 중복 북마크 방지
- 인덱스: `(user_id, created_at DESC)`

마이그레이션: `sql_schema/003_bookmarks.sql`.

---

## 4) `notification_preferences` — 알림 설정 〔운영 중〕

프로필 페이지의 알림 토글 4종. 사용자당 1행. 관련 코드:
- [users.js:141](../backend/src/routes/users.js#L141) 조회
- [users.js:159](../backend/src/routes/users.js#L159) upsert

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `user_id` | UUID | ✅ | — | PK + FK → `users` ON DELETE CASCADE |
| `notify_email` | BOOLEAN | ✅ | `true` | 서비스 공지 이메일 |
| `notify_marketing` | BOOLEAN | ✅ | `false` | 마케팅·뉴스레터 |
| `notify_record_done` | BOOLEAN | ✅ | `true` | AI 분석 완료 알림 |
| `notify_weekly` | BOOLEAN | ✅ | `true` | 주간 학습 리마인더 |
| `updated_at` | TIMESTAMPTZ | ✅ | `now()` | BEFORE UPDATE 트리거 |

### 참고

- 행이 없으면 코드 레벨에서 위 기본값을 반환 ([users.js:141-157](../backend/src/routes/users.js#L141-L157)).
- 프론트 토글은 `data-notif-key` 속성으로 컬럼명과 1:1 매핑 ([profile.html:564~628](../frontend/html/profile.html)).
- **RLS 후보**: `auth.uid() = user_id`.

마이그레이션: `sql_schema/004_notification_preferences.sql`.

---

## 5) `user_sessions` — 활성 세션 〔운영 중〕

JWT 발급 시 세션 행 생성, 미들웨어가 `session_id` 로 활성 여부 검증. 관련 코드:
- [utils/sessions.js:issueTokenAndSession](../backend/src/utils/sessions.js) 발급
- [middleware/auth.js:_isSessionActive](../backend/src/middleware/auth.js) 검증
- [users.js:186](../backend/src/routes/users.js#L186) 목록
- [users.js:228](../backend/src/routes/users.js#L228) 모든 기기 로그아웃

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `session_id` | UUID | ✅ | `gen_random_uuid()` | PK — JWT 페이로드에 포함 |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `user_agent` | TEXT |  | — | 원본 UA 문자열 |
| `ip_address` | INET |  | — | 로그인 시점 IP (X-Forwarded-For 우선) |
| `device_label` | TEXT |  | — | `'iPhone · Safari'` 등 파싱 결과 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | 로그인 시각 |
| `last_seen_at` | TIMESTAMPTZ | ✅ | `now()` | 마지막 활동 — 미들웨어가 fire-and-forget 업데이트 |
| `revoked_at` | TIMESTAMPTZ |  | — | NULL = 활성. 개별/일괄 로그아웃 시 세팅 |

### 인덱스 & 제약

- PK: `session_id`
- FK: `user_id` ON DELETE CASCADE
- 인덱스: `(user_id, revoked_at)` — 활성 세션 조회

### 참고

- 환경변수 `ENFORCE_SESSION=true`(기본) 시 모든 인증 요청에서 세션 활성 여부 확인.
- 테이블 미적용 환경에서도 `issueTokenAndSession` 에 fallback 이 있어 로그인 동작 유지 (세션 기능만 비활성).
- 비밀번호 변경/재설정 시 본인 세션 외 전부 revoke 처리.

마이그레이션: `sql_schema/005_user_sessions.sql`.

---

## 6) Supabase Storage 버킷 〔운영 중〕

| 버킷 | 용도 | 경로 패턴 | 정책 |
|------|------|----------|------|
| `skin-images` | 마스킹된 원본 이미지 | `{user_id}/{uuid}.png` | Public |
| `gradcam` | Grad-CAM heatmap | `{user_id}/{record_id}.png` | Public (의료영상 시각화) |
| `avatars` | 프로필 사진 (WebP 256px) | `{user_id}/{uuid}.webp` | Public |

### 라이프사이클

- 학습기록 초기화·탈퇴 → `skin-images/{user_id}/` 폴더 일괄 삭제.
- 개별 record 삭제 → `image_url`·`gradcam_url` 경로 파싱해 양쪽 버킷에서 remove ([records.js:172-186](../backend/src/routes/records.js#L172-L186)).
- 아바타 변경 → 신규 업로드 (이전 객체는 현재 누적, 정리 잡 별도 필요).

### 참고

- 마스킹 파이프라인: EXIF 제거 + 상하단 8% 블랙 마스킹 ([analyze.js:42-58](../backend/src/routes/analyze.js#L42-L58)).
- 의료영상 정책 강화 시 Signed URL 전환 검토 (§개선사항 O3).

마이그레이션: `sql_schema/006_storage_buckets.sql` (권한 부족 시 Dashboard 수동).

---

## 7) `chat_messages` — 분석 기록 멀티턴 Q&A 〔후보〕

**현재 상태**: `analysis_records.chat_history` JSONB 컬럼에 배열로 저장. 단순 복원은 충분하나 다음 한계로 정규화 권장:
- 메시지 단위 인덱싱·통계 불가
- 동시 append 시 race condition (read-modify-write, [records.js:206-228](../backend/src/routes/records.js#L206-L228))
- 사용자별 전체 채팅 텍스트 검색 불가

### 권장 스키마

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `message_id` | BIGSERIAL | ✅ | — | PK |
| `record_id` | UUID | ✅ | — | FK → `analysis_records` ON DELETE CASCADE |
| `role` | TEXT | ✅ | — | `'user'` \| `'ai'` |
| `content` | TEXT | ✅ | — | 메시지 본문 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 마이그레이션 노트

기존 `chat_history` backfill 후 컬럼 DROP:
```sql
INSERT INTO chat_messages (record_id, role, content, created_at)
SELECT r.record_id, msg->>'role', msg->>'content', r.created_at
FROM analysis_records r,
     LATERAL jsonb_array_elements(r.chat_history) AS msg
WHERE r.chat_history IS NOT NULL;
```

---

## 8) `password_reset_tokens` — 비밀번호 재설정 〔후보〕

**현재 상태**: `_passwordResetTokens = new Map()` 인메모리 ([auth.js:20](../backend/src/routes/auth.js#L20)). TTL 15분.

**한계**:
- 서버 재시작 시 진행 중인 재설정 링크 모두 만료
- 다중 인스턴스(로드 밸런서) 운영 불가 — sticky session 필요
- 단일 인스턴스·15분 단기 데이터라 소규모 운영에선 무방

### 권장 스키마 (DB 분리 시)

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `token` | TEXT | ✅ | — | PK — `crypto.randomBytes(32).toString('hex')` |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `expires_at` | TIMESTAMPTZ | ✅ | — | 발급 시 + 15분 |
| `used_at` | TIMESTAMPTZ |  | — | 1회용 보장 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

운영 노트: `pg_cron` 으로 `expires_at < now() - 1d` 정리.

---

## 9) `email_verification_codes` — 이메일 변경 6자리 〔후보〕

**현재 상태**: `_emailChangeCodes = new Map()` 인메모리 ([auth.js:21](../backend/src/routes/auth.js#L21)). TTL 5분, user_id 단일 키.

**한계**: §8 과 동일. 다만 유효시간 5분이라 영향 더 작음.

### 권장 스키마 (DB 분리 시)

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `id` | BIGSERIAL | ✅ | — | PK |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `email` | TEXT | ✅ | — | 변경 후 이메일 주소 |
| `code` | CHAR(6) | ✅ | — | 6자리 숫자 (`crypto.randomInt`) |
| `expires_at` | TIMESTAMPTZ | ✅ | — | 발급 시 + 5분 |
| `verified_at` | TIMESTAMPTZ |  | — | 인증 완료 시각 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

---

## JSONB 컬럼 내부 구조 예시

### `analysis_records.differential`

AI Flask 서버 `/predict` 응답의 `prediction.top3`.

```json
[
  { "class_name": "건선",        "confidence": 0.82 },
  { "class_name": "지루각화증",   "confidence": 0.09 },
  { "class_name": "아토피피부염", "confidence": 0.04 }
]
```

### `analysis_records.clinical_ref`

```json
{
  "class_name":    "건선",
  "prevalence":    "성인 인구의 1~3%",
  "common_sites":  ["두피", "팔꿈치", "무릎"],
  "age_range":     "20~40대 초발"
}
```

### `analysis_records.ai_findings`

[`llm_service.py:generate_report()`](../ai/inference/llm_service.py) 반환 객체. LLM 비활성 시 `null`.

```json
{
  "summary":        "건선이 가장 유력한 후보 진단입니다.",
  "mechanism":      "각질형성세포 과증식과 T세포 매개 염증이...",
  "features":       "경계 명확한 홍반과 은백색 인설...",
  "triggers":       "스트레스·감염·약물에 의해 악화...",
  "learning_point": "Auspitz sign과 Koebner 현상 확인이 핵심...",
  "disclaimer":     "참고용 AI 분석. 전문의 진료 필요."
}
```

### `analysis_records.chat_history` (§7 정규화 권장)

```json
[
  { "role": "user", "content": "이 환자에게 권장되는 검사는?" },
  { "role": "ai",   "content": "임상 진단 외에 조직검사가..." }
]
```

---

## § 개선 사항 추적

코드 검토 중 식별된 항목과 처리 상태.

### 🟢 해결 완료

| ID | 항목 | 처리 |
|----|------|------|
| B1 | `users.bio` 회원가입 insert 누락 | [auth.js:83-120](../backend/src/routes/auth.js#L83-L120) 에서 포함 |
| B2 | 개별 record 삭제 시 Storage 객체 누수 | [records.js:164-204](../backend/src/routes/records.js#L164-L204) 에서 두 버킷 cleanup |
| B3 | Grad-CAM 파일명 `Date.now()` 충돌 | `{user_id}/{record_id}.png` 로 변경 ([records.js:65-83](../backend/src/routes/records.js#L65-L83)) |
| S3 | `updated_at` 컬럼 부재 | `users`·`analysis_records`·`notification_preferences` 모두 + 트리거 |
| S4 | Storage 단일 버킷 혼재 | `gradcam`·`avatars` 버킷 분리 (sql_schema/006) |
| O2 | 비밀번호 변경 시 기존 세션 무효화 안 됨 | `password_changed_at` + 본인 외 세션 revoke 적용 |
| O4 | bcrypt salt=10 | `BCRYPT_ROUNDS=12` 기본값 상향 |
| O6 | `role` enum `doctor` 부재 | CHECK 제약에 추가 |
| P3 | 비밀번호 변경 라우트 부재 | `POST /api/auth/change-password` |
| P4 | 이메일 6자리 인증 부재 | `/api/auth/email/{send,verify}-code` |
| P5/P8 | 세션 관리 부재 | `user_sessions` + 5개 라우트 |
| P6 | 알림 설정 저장 안 됨 | `notification_preferences` + GET/PATCH |

### 🟡 미해결 (DB 분리 권장)

| ID | 항목 | 권장 시점 |
|----|------|----------|
| B4 | `chat_history` race condition | §7 `chat_messages` 정규화 시 자연 해결 |
| §7 | `chat_history` JSONB → `chat_messages` | 채팅 검색·통계 요구사항 발생 시 |
| §8 | 비밀번호 재설정 토큰 인메모리 | 다중 인스턴스 운영 시 |
| §9 | 이메일 인증 코드 인메모리 | 다중 인스턴스 운영 시 |

### 🔵 구조 정규화 (중기)

| ID | 항목 | 권장 |
|----|------|------|
| S1 | `clinical_ref` 매 record 중복 저장 | `diseases` 마스터 테이블 + FK |
| S2 | `DISEASE_KEY_MAP` 코드 하드코딩 | S1 도입 시 자연 해결 (현재 [constants.js](../backend/src/constants.js) 중앙화) |
| S5 | `is_correct` 계산 로직 분산 | Postgres GENERATED COLUMN |

### ⚪ 보안·운영 강화 (장기)

| ID | 항목 | 권장 |
|----|------|------|
| O1 | 로그인 실패 추적 부재 | `login_attempts` 테이블 또는 `users.failed_login_count` |
| O3 | Public Storage URL | 의료영상 정책 강화 시 Signed URL |
| O5 | JSONB GIN 인덱스 부재 | 검색·필터 요구 발생 시 |

---

## 부록 — UI에만 존재하는 미구현 기능

운영 중 테이블로 흡수되지 않고 남은 UI-only 요소.

| 항목 | 발견 위치 | 비고 |
|------|----------|------|
| 학습 통계 (streak·도넛·바 차트) | `my_analyze.html`, `dashboard.html` | `analysis_records` 집계로 동적 계산. 별도 테이블 불필요 |
| 회원 탈퇴 사유 로그 | `withdraw.html` 폼 입력 | 현재 응답으로만 받고 저장 안 됨 — 분석용으로 보존하려면 `withdrawal_logs` 테이블 필요 |

---

## 검증 체크리스트

- [x] `backend/src/routes/{auth,analyze,records,users}.js` 의 모든 `.from('테이블')` 호출이 §1~§5 에 매핑됨
- [x] 프론트엔드 회원가입·프로필·my_analyze·record_detail 의 모든 필드가 §1~§5 컬럼으로 추적 가능
- [x] AI 서버 `/predict`·`/report` 응답 필드가 JSONB 예시에 반영됨
- [x] `sql_schema/001~006*.sql` 마이그레이션과 §1~§6 스키마 정합성 일치
- [ ] RLS 정책 SQL 작성 (후속 작업)
- [ ] §7~§9 인메모리·JSONB → DB 분리 (다중 인스턴스 운영 시점에 진행)
