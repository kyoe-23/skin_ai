# SkinAI — 프론트엔드

> 피부과 전공의 · 의대생을 위한 피부질환 AI 분류 학습 및 실습 보조 플랫폼

---

## 프로젝트 소개

SkinAI는 피부질환 11종을 대상으로 이미지를 업로드하면 AI가 질환을 분류하고, Claude LMM을 통해 감별진단 설명 및 학습 피드백을 제공하는 플랫폼입니다.

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Backend | Node.js, Express |
| AI 추론 | Python, Flask, PyTorch |
| LMM | Claude API (Sonnet / Haiku) |
| DB | Supabase (PostgreSQL) |

---

## 파일 구조

### HTML (`frontend/html/`)

| 파일명 | 설명 |
|--------|------|
| `index.html` | 서비스 랜딩 페이지 |
| `login.html` | 로그인 |
| `signup.html` | 회원가입 |
| `privacy_consent.html` | 개인정보 동의 |
| `dashboard.html` | 홈 대시보드 |
| `ai_analyze.html` | AI 피부 분석 |
| `my_analyze.html` | 내 분석 기록 목록 |
| `record_detail.html` | 분석 기록 상세 |
| `community.html` | 커뮤니티 게시판 |
| `post_detail.html` | 게시글 상세 |
| `profile.html` | 프로필 설정 |
| `forgot_password.html` | 비밀번호 찾기 |
| `reset_password.html` | 비밀번호 재설정 |
| `withdraw.html` | 회원 탈퇴 |
| `records.html` | 기록 목록 |

### JS (`frontend/src/`)

| 파일명 | 대응 HTML | 설명 |
|--------|-----------|------|
| `auth_fetch.js` | 전체 공통 | 인증 API 공용 래퍼 |
| `disease_map.js` | 전체 공통 | 11종 질환 매핑 데이터 |
| `transition.js` | 전체 공통 | 페이지 전환 애니메이션 |
| `login.js` | `login.html` | 로그인 처리 |
| `signup.js` | `signup.html` | 회원가입 처리 |
| `privacy_consent.js` | `privacy_consent.html` | 개인정보 동의 처리 |
| `dashboard.js` | `dashboard.html` | 홈 대시보드 |
| `ai_analyze.js` | `ai_analyze.html` | AI 분석 핵심 로직 |
| `my_analyze.js` | `my_analyze.html` | 분석 기록 목록 |
| `record_detail.js` | `record_detail.html` | 분석 기록 상세 |
| `community.js` | `community.html` | 커뮤니티 게시판 |
| `post_detail.js` | `post_detail.html` | 게시글 상세 |
| `profile.js` | `profile.html` | 프로필 설정 |
| `forgot_password.js` | `forgot_password.html` | 비밀번호 찾기 |
| `reset_password.js` | `reset_password.html` | 비밀번호 재설정 |
| `withdraw.js` | `withdraw.html` | 회원 탈퇴 |

---

## 공통 모듈

### `auth_fetch.js` — 인증 API 공용 래퍼

모든 페이지에서 로드되는 API 호출 공통 함수.

- `apiFetch(url, options)` : `sessionStorage` 또는 `localStorage`에서 JWT를 자동으로 꺼내 `Authorization: Bearer {token}` 헤더에 부착
- 응답이 `401` / `403`이면 세션 정리 후 `login.html`로 자동 리다이렉트
- `consumeSessionExpiredFlag()` : 로그인 페이지 세션 만료 안내 배너 표시용

**토큰 저장 위치**
- 로그인 유지 체크 → `localStorage`
- 미체크 → `sessionStorage`

---

### `disease_map.js` — 질환 매핑 데이터

AI 모델 11종 질환의 한글명 / 영문명 / 키 매핑. Flask `app.py`의 클래스 순서와 반드시 일치해야 함.

| key | 한글명 | 영문명 |
|-----|--------|--------|
| psoriasis | 건선 | Psoriasis |
| atopic_dermatitis | 아토피피부염 | Atopic Dermatitis |
| acne | 여드름 | Acne Vulgaris |
| actinic_keratosis | 광선각화증 | Actinic Keratosis |
| basal_cell_carcinoma | 기저세포암 | Basal Cell Carcinoma |
| melanocytic_nevi | 멜라닌세포모반 | Melanocytic Nevi |
| melanoma | 악성흑색종 | Melanoma |
| seborrheic_keratosis | 지루각화증 | Seborrheic Keratosis |
| squamous_cell_carcinoma | 편평세포암 | Squamous Cell Carcinoma |
| dermatofibroma | 피부섬유종 | Dermatofibroma |
| vascular_lesion | 혈관종 | Vascular Lesion |

제공 함수: `VALID_DISEASES` / `DISEASE_MAP` / `DISEASE_KO_TO_KEY` / `diseaseByKoName(nameKo)` / `getDiseaseLabel(key)`

---

### `transition.js` — 페이지 전환 애니메이션

- `navigateTo(url)` : 페이드아웃(0.22초) 후 이동
- `<a href>` 클릭 시 자동 적용 (외부 링크 · `mailto:` · `_blank` 제외)
- 뒤로가기 시 투명 상태 복원

---

## 인증

### `login.js`

1. 이메일 형식 유효성 검사
2. `POST /api/auth/login`
3. JWT·유저 정보·로그인 시각(`loginTime`)·기기 UA(`loginUA`) storage 저장
4. 0.8초 후 `dashboard.html` 이동
5. 세션 만료 리다이렉트 시 안내 배너 표시

### `signup.js`

1. 역할 선택 (전공의 / 의대생)
2. 이메일 중복 확인 (400ms 디바운스 → `GET /api/auth/check-email`)
3. 비밀번호 강도 측정 3단계 (약함 / 보통 / 강함)
4. 개인정보 동의 페이지 이동 전 폼 데이터 `sessionStorage` 임시 저장 → 복귀 시 자동 복원
5. `POST /api/auth/signup`

### `privacy_consent.js`

개인정보보호법·의료법 기반 10개 필수 동의 항목. 아코디언 방식, 진행률 바, 전체 동의 완료 시 제출 버튼 활성화. 완료 → `sessionStorage.privacyConsent = 'true'` 저장.

### `forgot_password.js`

`POST /api/auth/forgot-password` → 성공 시 "발송 완료" 화면 전환 (15분 유효 안내).

### `reset_password.js`

1. URL 쿼리스트링 `token` 추출 → `GET /api/auth/verify-reset-token`으로 유효성 확인
2. 비밀번호 강도 5단계 측정
3. `POST /api/auth/reset-password`

---

## 메인 기능

### `ai_analyze.js` — AI 피부 분석

**업로드:** 드래그앤드롭 또는 파일 선택, 10MB 초과 차단, 미리보기 표시

**분석 흐름:**
1. `POST /api/analyze/upload` — 서버에서 EXIF 제거·마스킹 처리
2. 3단계 로딩 애니메이션 (업로드와 병렬)
3. `POST /api/analyze/run` — AI 분석 실행
4. 결과: 진단명(한글/영문), 신뢰도 %, 신뢰도 바 애니메이션
5. AI 소견: 분석 응답에 포함 시 즉시 표시 / 없으면 `POST /api/analyze/report`로 별도 비동기 요청
6. 임상 통계: 연령분포·성별분포·주 중증도 표시

**에러 처리:**
- `uncertain` → 에러 카드 + 지원 질환 목록
- AI 서버 미연결(`API_NOT_CONNECTED`) → 별도 안내
- 세션 만료 → 로그인 자동 이동

**LLM 채팅:** 진단 완료 후 채팅창 표시, `POST /api/analyze/chat`, `chatHistory` 배열로 세션 보관

**기록 저장:** `POST /api/records` — 이미지 URL·진단명·신뢰도·Grad-CAM·임상 통계·AI 소견·채팅 기록

---

### `my_analyze.js` — 분석 기록 목록

- `GET /api/records`로 전체 기록 로드
- 필터: 질환별 칩 버튼 · 날짜 범위(1주/1개월/3개월) · 정렬(최신/신뢰도 높음/낮음)
- 페이지네이션 (페이지당 5건)
- 신뢰도 링 SVG 애니메이션 (80%↑ 녹색 / 65%↑ 주황 / 이하 빨강)
- 통계 카드: 전체·이번 주·이번 달 건수 (전월 대비 증감)
- 도넛 차트: 질환별 분포 (Chart.js)
- 바 차트: 최근 6개월 분석 건수 (Chart.js)
- 스트릭 캘린더: 최근 35일 학습 현황 (레벨별 색상)
- 기록 삭제: `DELETE /api/records/:id`

---

### `record_detail.js` — 분석 기록 상세

- URL `?id=` 파라미터로 `GET /api/records/:id`
- 표시: 진단명·신뢰도·날짜·원본 이미지·Grad-CAM 열지도(원본/히트맵 비교)·AI 소견·채팅 기록 복원
- LLM 채팅: `POST /api/analyze/chat`, 메시지 저장: `PATCH /api/records/:id/chat`
- 공유: Web Share API 또는 클립보드 복사

---

### `dashboard.js` — 홈 대시보드

- 시간대별 인사말 (새벽/아침/낮/저녁)
- storage에서 유저 이름·역할 표시
- 로그아웃: 토큰·유저 정보 삭제 → `login.html` 이동

> 학습 통계·최근 기록·취약 질환 목록은 API 미연동 (TODO)

---

## 커뮤니티

### `community.js`

> 현재 더미 데이터 기반 동작 (실제 API 미연동)

- 피드: 질환 태그 필터 + 검색(제목/내용/태그) 조합 필터링
- 게시글 작성: 인스타그램 스타일 태그 입력 (#태그명, 질환 자동완성), 미디어 첨부(드래그앤드롭)
- 좋아요 토글·조회수·링크 공유·삭제(본인만)
- 댓글/대댓글: 작성·수정·삭제·좋아요·답글

---

## 설정·계정

### `profile.js`

탭 구성: 프로필 정보 / 계정 정보 / 알림 설정 / 데이터 관리

- 프로필 이미지 변경 (5MB 제한)
- 이름·역할·소속 수정 → storage 유저 정보 동기화
- 비밀번호 변경 (강도 4단계)
- 이메일 변경 (인증코드 발송 + 3분 타이머)
- 현재 세션 기기/브라우저 정보 파싱 표시
- 데이터 내보내기: `GET /api/analyze/records` → CSV 다운로드
- 학습 기록 초기화: `DELETE /api/analyze/records`

### `withdraw.js`

1. 탈퇴 사유 라디오 선택 (기타 선택 시 직접 입력창)
2. `'탈퇴합니다'` 정확 입력 시에만 버튼 활성화
3. `DELETE /api/auth/withdraw` → 성공 시 storage 전체 초기화 → 3초 후 `login.html`

---

## API 엔드포인트

| 기능 | 메서드 | 경로 |
|------|--------|------|
| 로그인 | POST | `/api/auth/login` |
| 회원가입 | POST | `/api/auth/signup` |
| 이메일 중복확인 | GET | `/api/auth/check-email?email=` |
| 비밀번호 찾기 | POST | `/api/auth/forgot-password` |
| 재설정 토큰 확인 | GET | `/api/auth/verify-reset-token?token=` |
| 비밀번호 재설정 | POST | `/api/auth/reset-password` |
| 회원 탈퇴 | DELETE | `/api/auth/withdraw` |
| 이미지 업로드 | POST | `/api/analyze/upload` |
| AI 분석 실행 | POST | `/api/analyze/run` |
| LLM 리포트 | POST | `/api/analyze/report` |
| LLM 채팅 | POST | `/api/analyze/chat` |
| 기록 저장 | POST | `/api/records` |
| 기록 목록 조회 | GET | `/api/records` |
| 기록 상세 조회 | GET | `/api/records/:id` |
| 기록 삭제 | DELETE | `/api/records/:id` |
| 채팅 저장 | PATCH | `/api/records/:id/chat` |
| 전체 기록 삭제 | DELETE | `/api/analyze/records` |
| 전체 기록 조회 | GET | `/api/analyze/records` |

---

## 로컬 실행

```bash
cd backend
cp .env.example .env   # 환경변수 설정
npm install
npm start              # http://localhost:3000
```

서버가 `frontend/html/`의 정적 파일을 함께 서빙합니다. 별도 빌드 없이 바로 접속 가능합니다.
