# SkinAI — 안면부 피부질환 AI 분류 학습 플랫폼

> 피부과 전공의 · 의대생을 위한 안면부 피부질환 AI 분류 학습 및 실습 보조 플랫폼

---

## 프로젝트 소개

SkinAI는 안면부 피부질환 6종(건선, 아토피 피부염, 여드름, 주사, 지루성 피부염, 정상)을 대상으로 이미지를 업로드하면 AI가 질환을 분류하고, Claude API + RAG를 통해 감별진단 설명 및 학습 피드백을 제공하는 플랫폼입니다.

---

## 대상 질환 6종

| No | 질환명 (한글) | 질환명 (영문) |
|----|--------------|--------------|
| 1 | 건선 | Psoriasis |
| 2 | 아토피 피부염 | Atopic Dermatitis |
| 3 | 여드름 | Acne Vulgaris |
| 4 | 주사 | Rosacea |
| 5 | 지루성 피부염 | Seborrheic Dermatitis |
| 6 | 정상 | Normal |

---

## 프로젝트 구조

```
📁 frontend/
├── 📄 README.md
│
├── 📁 AI analyze/
│   ├── 📄 guide
│   └── 📄 masking_guide.md          # 이미지 마스킹 & 저장 역할 분리 가이드
│
├── 📁 html/                         # HTML 페이지
│   ├── 📄 login.html                # 로그인
│   ├── 📄 signup.html               # 회원가입
│   ├── 📄 forgot_password.html      # 비밀번호 찾기
│   ├── 📄 reset_password.html       # 비밀번호 재설정
│   ├── 📄 dashboard.html            # 메인 대시보드
│   ├── 📄 ai_analyze.html           # 학습 AI - 이미지 분석
│   ├── 📄 my_analyze.html           # 내 분석 기록
│   ├── 📄 records.html              # 학습 기록 조회
│   ├── 📄 record_detail.html        # 학습 기록 상세
│   ├── 📄 community.html            # 학습 커뮤니티
│   ├── 📄 post_detail.html          # 게시글 상세
│   ├── 📄 profile.html              # 프로필
│   └── 📄 withdraw.html             # 회원 탈퇴
│
└── 📁 src/                          # JavaScript
    ├── 📄 login.js
    ├── 📄 signup.js
    ├── 📄 forgot_password.js
    ├── 📄 reset_password.js
    ├── 📄 dashboard.js
    ├── 📄 ai_analyze.js
    ├── 📄 my_analyze.js
    ├── 📄 record_detail.js
    ├── 📄 community.js
    ├── 📄 post_detail.js
    ├── 📄 profile.js
    ├── 📄 withdraw.js
    └── 📄 transition.js             # 페이지 전환
```

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | HTML5, CSS3, Vanilla JS |
| AI 분석 | Claude API + RAG |

---

## 화면 구성

| 화면 | 파일 | 설명 |
|------|------|------|
| 로그인 | login.html | 역할 선택 및 로그인 |
| 회원가입 | signup.html | 회원가입 폼 |
| 비밀번호 찾기 | forgot_password.html | 이메일로 재설정 링크 발송 |
| 대시보드 | dashboard.html | 학습 현황 요약 |
| 학습 AI | ai_analyze.html | 이미지 업로드 → AI 분류 결과 |
| 학습 기록 | records.html | 개인 학습 이력 및 통계 |
| 커뮤니티 | community.html | 케이스 공유 및 토론 |
| 프로필 | profile.html | 개인 정보 관리 |

---

## 개발 예정 기능

- [ ] 비밀번호 찾기 / 재설정 이메일 발송
- [ ] AI 이미지 분석 API 연동
- [ ] Claude API + RAG 대화 기능
- [ ] 학습 기록 대시보드
- [ ] 교수용 관리자 화면


