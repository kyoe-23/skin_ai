# Part 10 — DB 테이블 기술서 (Supabase)

SkinAI 백엔드(`backend/src/`)와 프론트엔드(`frontend/`)에서 구현된 기능을 역추적해 정리한 **Supabase 기준 테이블 명세서**. 향후 마이그레이션 SQL·RLS 정책·신규 기능 설계의 기준 문서로 사용한다.

> **범위**: 커뮤니티 기능(`posts`·`comments`)은 본 문서에서 제외.
> **분류**: ① **운영 중** — 코드에서 직접 `.from()` 호출이 존재 / ② **후보** — UI·요구사항은 있으나 백엔드 미구현, 사전 설계.

---

## ERD 요약

```
users (PK user_id)
  │
  ├──< analysis_records (PK record_id, FK user_id)        [운영 중]
  │       │
  │       ├──< chat_messages (FK record_id)               [후보 — 현재는 JSONB 컬럼]
  │       └──< bookmarks (FK user_id, record_id)          [후보]
  │
  ├──< password_reset_tokens (FK user_id)                 [후보 — 현재는 인메모리]
  └──< email_verification_codes (FK user_id)              [후보]

Storage 버킷
  └── skin-images/{user_id}/...   원본 + Grad-CAM 모두 동일 버킷
```

---

## 1) `users` — 회원 계정·의료진 프로필 〔운영 중〕

회원가입·로그인·프로필 갱신·탈퇴에서 사용. 관련 코드:
- [auth.js:31-81](../backend/src/routes/auth.js#L31-L81) 회원가입
- [auth.js:101-145](../backend/src/routes/auth.js#L101-L145) 로그인
- [auth.js:260-293](../backend/src/routes/auth.js#L260-L293) 탈퇴

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `user_id` | UUID | ✅ | `gen_random_uuid()` | PK |
| `email` | TEXT | ✅ | — | 로그인 ID, UNIQUE |
| `password_hash` | TEXT | ✅ | — | bcrypt salt=10 ([auth.js:49](../backend/src/routes/auth.js#L49)) |
| `name` | TEXT | ✅ | — | 회원가입 입력 |
| `role` | TEXT | ✅ | — | `'resident'` \| `'student'` (CHECK 권장) |
| `affiliation` | TEXT | ✅ | — | 소속 병원·학교 |
| `year` | INT |  | — | 연차 (전공의 N년차 등) |
| `bio` | TEXT |  | — | 자기소개 ≤200자 — 프론트는 전송하나 백엔드 insert 미반영 ([signup.js:211](../frontend/src/signup.js#L211)) |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 인덱스 & 제약

- PK: `user_id`
- UNIQUE: `email`
- CHECK: `role IN ('resident', 'student')`

### 참고

- 백엔드는 `user_id` UUID를 JWT payload에 그대로 임베드. JWT 만료 1시간 ([auth.js:62](../backend/src/routes/auth.js#L62)).
- **현재 백엔드 insert에 빠진 필드(`bio`)는 마이그레이션 시 함께 추가** 후 라우트 수정 권장.
- 탈퇴 시 `analysis_records`·`skin-images/{user_id}/` 전체 삭제됨 ([auth.js:265-285](../backend/src/routes/auth.js#L265-L285)).
- **RLS 후보**: `auth.uid() = user_id` 인 행만 select/update 허용.

---

## 2) `analysis_records` — AI 분석 결과 이력 〔운영 중〕

이미지 분석 결과·LLM 리포트·채팅 이력을 한 로우에 저장. 관련 코드:
- [records.js:23-70](../backend/src/routes/records.js#L23-L70) 저장
- [records.js:73-105](../backend/src/routes/records.js#L73-L105) 목록·상세
- [records.js:134-199](../backend/src/routes/records.js#L134-L199) 채팅·답 제출

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `record_id` | UUID | ✅ | `gen_random_uuid()` | PK |
| `user_id` | UUID | ✅ | — | FK → `users.user_id` ON DELETE CASCADE |
| `image_url` | TEXT | ✅ | — | 마스킹된 원본 (Public URL, `skin-images` 버킷) |
| `gradcam_url` | TEXT |  | — | Grad-CAM heatmap (동일 버킷) |
| `is_masked` | BOOLEAN | ✅ | `true` | EXIF·라벨 마스킹 완료 여부 |
| `primary_diagnosis` | TEXT | ✅ | — | 11종 클래스 키 (예: `'psoriasis'`, `'acne'`) |
| `confidence` | REAL | ✅ | — | 0.0~1.0 |
| `differential` | JSONB |  | — | AI top3 후보 — 구조는 §JSONB 예시 참조 |
| `clinical_ref` | JSONB |  | — | 임상 통계 메타 (AI 서버 동봉) |
| `ai_findings` | JSONB |  | — | LLM 리포트 6필드 객체 |
| `chat_history` | JSONB |  | — | `[{role, content}, ...]` 배열 (멀티턴 Q&A) |
| `user_answer` | TEXT |  | — | 학습용 사용자 답안(클래스 키) |
| `is_correct` | BOOLEAN |  | — | `user_answer === primary_diagnosis` 결과 |
| `status` | TEXT | ✅ | `'pending'` | `'pending'` \| `'completed'` — 답 제출 시 completed |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 인덱스 & 제약

- PK: `record_id`
- FK: `user_id` → `users(user_id)` ON DELETE CASCADE
- CHECK: `status IN ('pending', 'completed')`
- CHECK: `confidence BETWEEN 0 AND 1`
- 권장 인덱스: `(user_id, created_at DESC)` — my_analyze 페이지네이션

### 참고

- 클래스 키 매핑은 [records.js:8-20](../backend/src/routes/records.js#L8-L20) `CLASS_KEY_MAP` 참조 (한글명 → snake_case key).
- 채팅 추가는 **append 패턴** — 기존 배열에 새 메시지 push ([records.js:150-151](../backend/src/routes/records.js#L150-L151)).
- 답 제출 시 status가 `pending` → `completed` 로 전이 ([records.js:188](../backend/src/routes/records.js#L188)).
- **RLS 후보**: `auth.uid() = user_id`.

---

## 3) Supabase Storage — `skin-images` 버킷 〔운영 중〕

원본 분석 이미지와 Grad-CAM heatmap을 **단일 버킷**에 함께 저장. 관련 코드:
- [analyze.js:62-72](../backend/src/routes/analyze.js#L62-L72) 원본 업로드
- [records.js:37-42](../backend/src/routes/records.js#L37-L42) Grad-CAM 업로드

### 파일 경로 패턴

| 종류 | 경로 | MIME |
|------|------|------|
| 원본 (EXIF 제거·라벨 마스킹) | `{user_id}/{uuid}.png` | `image/png` |
| Grad-CAM heatmap | `{user_id}/{timestamp}_gradcam.png` | `image/png` |

### 라이프사이클

- 학습기록 초기화(`DELETE /api/analyze/records`) → 유저 폴더 전체 삭제 ([analyze.js:177-183](../backend/src/routes/analyze.js#L177-L183))
- 탈퇴 → 동일 ([auth.js:265-272](../backend/src/routes/auth.js#L265-L272))
- 개별 record 삭제 → **Storage 객체는 현재 삭제 안 됨** (개선 필요)

### 참고

- 현재 Public 버킷으로 `getPublicUrl()` 사용. 향후 의료영상 정책 강화 시 Signed URL 전환 검토.
- 마스킹 파이프라인: EXIF 완전 제거 + 상하단 8% 블랙 마스킹 ([analyze.js:42-58](../backend/src/routes/analyze.js#L42-L58)).

---

## 4) `chat_messages` — 분석 기록 멀티턴 Q&A 〔후보 / 마이그레이션 권장〕

현재 `analysis_records.chat_history` JSONB로 저장 중. JSONB는 단순 복원에는 충분하나 다음 한계가 있어 정규화 분리 권장:
- 메시지 단위 인덱싱·통계 불가
- 동시 append 시 race condition (현재 read-modify-write 방식)
- 사용자별 전체 채팅 텍스트 검색 불가

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `message_id` | BIGSERIAL | ✅ | — | PK |
| `record_id` | UUID | ✅ | — | FK → `analysis_records(record_id)` ON DELETE CASCADE |
| `role` | TEXT | ✅ | — | `'user'` \| `'ai'` |
| `content` | TEXT | ✅ | — | 메시지 본문 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 인덱스 & 제약

- PK: `message_id`
- FK: `record_id` ON DELETE CASCADE
- CHECK: `role IN ('user', 'ai')`
- 권장 인덱스: `(record_id, created_at ASC)` — 시간순 복원

### 마이그레이션 노트

기존 `chat_history` JSONB의 backfill SQL 예시:
```sql
INSERT INTO chat_messages (record_id, role, content, created_at)
SELECT r.record_id,
       msg->>'role',
       msg->>'content',
       r.created_at
FROM analysis_records r,
     LATERAL jsonb_array_elements(r.chat_history) AS msg
WHERE r.chat_history IS NOT NULL;
```
이후 `analysis_records.chat_history` 컬럼 DROP 및 [records.js:134-165](../backend/src/routes/records.js#L134-L165) `/chat` 라우트 수정.

---

## 5) `bookmarks` — 분석 기록 북마크 〔후보〕

`record_detail.html`에 북마크 토글 UI 존재하나 백엔드 미구현. 1:N 구조로 사전 설계.

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
- 권장 인덱스: `(user_id, created_at DESC)`

---

## 6) `password_reset_tokens` — 비밀번호 재설정 〔후보 / 영속화 권장〕

현재 [auth.js:12](../backend/src/routes/auth.js#L12) 의 인메모리 `Map`으로 처리 — 서버 재시작 시 모든 토큰 무효화, 다중 인스턴스 운영 불가. DB 영속화 필요.

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `token` | TEXT | ✅ | — | PK, `crypto.randomBytes(32).toString('hex')` |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `expires_at` | TIMESTAMPTZ | ✅ | — | 발급 시 + 15분 |
| `used_at` | TIMESTAMPTZ |  | — | 1회용 보장 — NOT NULL 이면 거부 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 운영 노트

- pg_cron 또는 주기 잡으로 `expires_at < now() - 1d` 인 행 삭제
- 동일 이메일 재발급 시 기존 토큰 invalidate 로직은 [auth.js:164-166](../backend/src/routes/auth.js#L164-L166) 패턴 유지

---

## 7) `email_verification_codes` — 이메일 인증 6자리 〔후보〕

`profile.html` 이메일 변경 시 6자리 인증 코드 UI 존재. 백엔드 라우트 미구현.

### 컬럼

| 컬럼 | 타입 | NOT NULL | 기본값 | 설명 |
|------|------|----------|--------|------|
| `id` | BIGSERIAL | ✅ | — | PK |
| `user_id` | UUID | ✅ | — | FK → `users` ON DELETE CASCADE |
| `email` | TEXT | ✅ | — | 인증 대상 (변경 후 주소) |
| `code` | CHAR(6) | ✅ | — | 6자리 숫자 문자열 |
| `expires_at` | TIMESTAMPTZ | ✅ | — | 발급 시 + 5분 권장 |
| `verified_at` | TIMESTAMPTZ |  | — | 인증 완료 시각 |
| `created_at` | TIMESTAMPTZ | ✅ | `now()` | |

### 인덱스 & 제약

- 권장 인덱스: `(user_id, expires_at DESC)`
- 동일 user_id의 미사용 코드는 새 발급 시 invalidate

---

## JSONB 컬럼 내부 구조 예시

### `analysis_records.differential`

AI Flask 서버 `/predict` 응답의 `prediction.top3`를 그대로 저장.

```json
[
  { "class_name": "건선",      "confidence": 0.82 },
  { "class_name": "지루각화증", "confidence": 0.09 },
  { "class_name": "아토피피부염","confidence": 0.04 }
]
```

### `analysis_records.clinical_ref`

AI 서버 동봉 임상 통계 메타. 클래스별 유병률·호발 연령대 등.

```json
{
  "class_name": "건선",
  "prevalence": "성인 인구의 1~3%",
  "common_sites": ["두피", "팔꿈치", "무릎"],
  "age_range": "20~40대 초발"
}
```

### `analysis_records.ai_findings`

[llm_service.py:generate_report()](../ai/inference/llm_service.py) 반환 객체. LLM 비활성 또는 실패 시 `null`.

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

### `analysis_records.chat_history` (현재 운영 / 차후 제거 예정)

```json
[
  { "role": "user", "content": "이 환자에게 권장되는 검사는?" },
  { "role": "ai",   "content": "임상 진단 외에 조직검사가..." }
]
```

---

## § 운영 중 테이블 — 개선 사항

코드 검토 중 발견된 **버그·구조적 결함·권장 개선점**. 우선순위는 영향도 기준으로 분류했다.

### 🔴 확실한 버그 (즉시 수정 권장)

#### B1. `users.bio` 누락 — 회원가입 시 데이터 손실
프론트는 `bio`를 전송하나 백엔드 `INSERT` 컬럼 목록에 빠져 있어 항상 NULL 저장.

- 근거: [signup.js:211](../frontend/src/signup.js#L211) 전송 vs [auth.js:53](../backend/src/routes/auth.js#L53) insert
- 수정: `auth.js:32` 의 destructure에 `bio` 추가, `:53` insert 객체에도 추가

#### B2. 개별 record 삭제 시 Storage 객체가 남는 누수
`DELETE /api/records/:id`가 DB 로우만 삭제하고 `image_url`·`gradcam_url`이 가리키는 Storage 객체는 그대로 둠. 장기 누적 시 스토리지 비용·개인정보 잔존 이슈.

- 근거: [records.js:108-131](../backend/src/routes/records.js#L108-L131)
- 수정: 삭제 직전에 `image_url`·`gradcam_url`에서 경로 파싱 → `supabase.storage.from('skin-images').remove([...])`

#### B3. Grad-CAM 파일명 `Date.now()` 충돌
같은 ms 내 두 요청이 들어오면 동일 경로가 되고, `upsert: false`라 두 번째 업로드가 실패 → `gradcam_url`이 null로 저장될 수 있음.

- 근거: [records.js:37](../backend/src/routes/records.js#L37) `${user_id}/${Date.now()}_gradcam.png`
- 수정: `${user_id}/${record_id}.png` 또는 `crypto.randomUUID()` 사용 (원본 업로드 패턴과 통일)

#### B4. `chat_history` JSONB의 race condition
[records.js:150-157](../backend/src/routes/records.js#L150-L157) 는 read → modify → write 방식. 동일 record에 동시에 두 메시지가 추가되면 한쪽이 덮어써져 손실.

- 근거: PATCH `/api/records/:id/chat` 에 트랜잭션·낙관적 락 부재
- 수정: 단기 — Postgres `jsonb_set` + `||` 연산자로 atomic append RPC 사용 / 장기 — §4 `chat_messages` 정규화로 INSERT 단순화

---

### 🟡 구조적 결함 (마이그레이션 권장)

#### S1. `analysis_records.clinical_ref` 중복 저장
질환별로 거의 정적인 임상 통계(유병률·호발 부위·연령대 등)를 매 record마다 JSONB로 복제 저장. 1만 건 기록이면 동일 텍스트가 1만 번 박힘.

- 권장: `diseases` 마스터 테이블 신설
  | 컬럼 | 타입 | 설명 |
  |------|------|------|
  | `disease_key` | TEXT PK | `'psoriasis'`, `'acne'` 등 |
  | `name_ko` | TEXT NOT NULL | 한글명 |
  | `prevalence` | TEXT | 유병률 |
  | `common_sites` | TEXT[] | 호발 부위 |
  | `age_range` | TEXT | 호발 연령 |
- `analysis_records.primary_diagnosis` 를 이 테이블 FK로 변경

#### S2. `CLASS_KEY_MAP` 하드코딩
한글↔영문 키 매핑이 [records.js:8-20](../backend/src/routes/records.js#L8-L20) 에 박혀 있음. 신규 클래스 추가 시 코드 수정 필요. S1의 `diseases` 마스터 테이블이 도입되면 자연 해결.

#### S3. `updated_at` 컬럼 부재
`users`·`analysis_records` 모두 `created_at`만 있고 `updated_at` 없음. 프로필 수정·답 제출·채팅 추가 시각 추적 불가.

- 권장: 두 테이블에 `updated_at TIMESTAMPTZ DEFAULT now()` + BEFORE UPDATE 트리거

#### S4. Storage 단일 버킷 — 원본 + Grad-CAM 혼재
의료영상(원본)과 시각화 처리물(Grad-CAM)은 **개인정보 영향도·보존 정책·접근 권한**이 달라야 하는데 현재 `skin-images` 한 버킷에 섞여 있음.

- 권장: `gradcam` 버킷 신설 후 [records.js:39](../backend/src/routes/records.js#L39) 업로드 경로 변경

#### S5. `is_correct` 계산 로직 분산
[records.js:182-184](../backend/src/routes/records.js#L182-L184) 에서 `toLowerCase().trim()` 비교로 계산. 추후 다른 라우트에서도 같은 비교가 필요해지면 표류 위험.

- 권장: Postgres GENERATED COLUMN
  ```sql
  is_correct BOOLEAN GENERATED ALWAYS AS
    (lower(trim(user_answer)) = lower(trim(primary_diagnosis))) STORED
  ```

---

### 🟢 보안·운영 강화 (선택 적용)

#### O1. 로그인 실패 추적 부재
현재 IP 기반 rate-limit만 있어(`auth` 라우트 15분당 5회) 분산 brute-force·credential stuffing 대응 부족.

- 권장: `login_attempts` 테이블 또는 `users.failed_login_count`·`locked_until` 컬럼 추가

#### O2. 비밀번호 변경 시 기존 세션 무효화 안 됨
[auth.js:225-257](../backend/src/routes/auth.js#L225-L257) 재설정 후 기존 JWT가 그대로 유효. 탈취 대응 부족.

- 권장: `users.password_changed_at` 컬럼 + JWT 검증 시 발급시각 비교, 또는 토큰 블랙리스트

#### O3. Public Storage URL — Signed URL로 전환
[analyze.js:71](../backend/src/routes/analyze.js#L71) `getPublicUrl()` 사용. 의료영상이므로 만료시간 있는 Signed URL 권장. 단 record_detail 등에서 URL을 DB에 영구 저장하므로 매 조회 시 재서명 필요 → 응답 시점 발급으로 구조 변경.

#### O4. bcrypt salt 라운드 상향
현재 `salt=10`. 의료 도메인 권고는 12 이상. CPU 부하와의 trade-off 확인 후 적용.

#### O5. JSONB GIN 인덱스 부재
`differential`·`ai_findings`로 필터·검색을 추가할 계획이 있다면 GIN 인덱스 사전 준비.
```sql
CREATE INDEX idx_records_findings ON analysis_records USING GIN (ai_findings);
```

#### O6. `role` enum에 `doctor` 부재
[auth.js:34](../backend/src/routes/auth.js#L34) 는 회원가입 시 `role` 필수만 체크, 값 검증 없음. 프론트는 `resident`/`student` 만 전송. 실제 운영 정책에 의사·전문의 가입 필요 여부 확인 후 enum 갱신.

---

### 우선순위 요약

| 우선순위 | 항목 | 영향 |
|---------|------|------|
| 즉시 | B1, B2, B3, B4 | 데이터 손실·누수 |
| 단기 | S3, S4, O3 | 운영 가시성·의료영상 정책 |
| 중기 | S1, S2, S5 | 구조 정규화 |
| 장기 | O1, O2, O4, O5, O6 | 보안 강화·확장성 |

---

## 부록 — UI에만 존재하는 미구현 기능

다음 항목은 프론트 UI에 표시되나 백엔드 라우트·DB가 없어 본 문서에서는 후보 스키마조차 정의하지 않는다.

| 항목 | 발견 위치 | 향후 후보 테이블 |
|------|----------|----------------|
| 세션 관리(다중 로그인 기기 목록) | `profile.html` | `user_sessions` |
| 알림 설정 | `profile.html` | `notification_preferences` |
| 학습 통계 (streak·도넛·바 차트) | `my_analyze.html`, `dashboard.html` | **별도 테이블 불필요** — `analysis_records` 집계로 동적 계산 |

---

## 검증 체크리스트

- [x] `backend/src/routes/{auth,analyze,records}.js`의 모든 `.from('테이블')` 호출이 본 문서의 §1·§2에 매핑됨
- [x] 프론트엔드 회원가입·프로필·my_analyze·record_detail에 표시되는 모든 필드가 §1·§2의 컬럼으로 추적 가능
- [x] AI 서버 `/predict`·`/report` 응답 필드가 JSONB 예시(§differential, §clinical_ref, §ai_findings)에 반영됨
- [ ] 마이그레이션 SQL 작성 (후속 작업)
- [ ] RLS 정책 SQL 작성 (후속 작업)
