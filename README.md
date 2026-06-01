# SkinAI

안면부 피부질환 AI 분류 의료 보조 서비스.

DenseNet121 / EfficientNet-B3 기반으로 11종 피부질환을 분류하고, Grad-CAM 히트맵과 Claude LMM 기반 자연어 리포트를 함께 제공합니다.

> **의료 면책**: 본 서비스는 교육·연구 목적의 보조 도구이며, 확정 진단은 피부과 전문의 대면 진료로만 가능합니다.

---

## 프로젝트 구조

```
skin_ai/
├── backend/                  # Node.js / Express API (port 3000)
│   ├── src/
│   │   ├── routes/           #   auth / analyze / records / users
│   │   ├── middleware/       #   JWT 인증 / rate limiting
│   │   ├── utils/masking.js  #   EXIF 제거 + 개인정보 마스킹
│   │   └── config/supabase.js
│   └── sql_schema/           #   Supabase 마이그레이션 SQL
│
├── frontend/                 # Vanilla JS / HTML / CSS
│   ├── html/                 #   페이지 HTML
│   └── src/                  #   JS 모듈
│
├── ai/
│   ├── inference/            # Flask 추론 서버 (port 5001)
│   │   ├── app.py            #   /predict / /report / /chat / /health
│   │   └── llm_service.py    #   Claude LMM 연동 (리포트·OOD·채팅)
│   ├── training/classifier/  # 학습 파이프라인
│   ├── dataset/              # PyTorch Dataset 클래스
│   ├── preprocessing/        # 전처리 파이프라인
│   │   └── class_maps/       #   클래스 매핑 JSON
│   ├── testing/              # 평가 + 임계값 최적화
│   └── results/              # 학습 결과 (*.pth gitignored)
│
├── data/processed/           # 전처리 CSV (git 추적)
│   ├── DS14/ DS15/           #   AI Hub 전처리 결과
│   ├── dermnet/ isic2019/ ham10000/
│   └── unified/              #   통합 11종 데이터셋
│
├── skinai_data/              # Google Drive DataLoader 패키지
└── skinai_docs/              # 개발 기획 문서
```

---

## 서비스 구성

```
Browser → Express Backend (:3000) → Flask AI Service (:5001)
                  ↓                         ↓
           Supabase DB/Storage        Claude API (LMM)
```

| 서비스 | 스택 | 포트 |
|--------|------|------|
| Backend | Node.js / Express | 3000 |
| AI Service | Python / Flask + PyTorch | 5001 |
| Frontend | Vanilla JS / HTML / CSS | (백엔드 서빙) |
| DB / Storage | Supabase (PostgreSQL + S3) | — |

### AI Service 주요 기능

- **분류**: DenseNet121 / EfficientNet-B3 Top-1/Top-3 예측
- **Grad-CAM**: 예측 근거 히트맵 시각화
- **OOD 필터**: Claude Haiku vision으로 비-피부 이미지 사전 거절
- **리포트**: Claude Sonnet으로 자연어 임상 리포트 생성
- **멀티턴 채팅**: 분석 결과 기반 후속 질문 응답

---

## 클래스 정의 (DS_unified 11종)

| idx | 클래스 | 영문 |
|-----|--------|------|
| 0 | 건선 | Psoriasis |
| 1 | 아토피피부염 | Atopic Dermatitis |
| 2 | 여드름 | Acne |
| 3 | 광선각화증 | Actinic Keratosis |
| 4 | 기저세포암 | Basal Cell Carcinoma |
| 5 | 멜라닌세포모반 | Melanocytic Nevi |
| 6 | 악성흑색종 | Melanoma |
| 7 | 지루각화증 | Seborrheic Keratosis |
| 8 | 편평세포암 | Squamous Cell Carcinoma |
| 9 | 피부섬유종 | Dermatofibroma |
| 10 | 혈관종 | Vascular Lesion |

---

## 학습 데이터

| 데이터셋 | 클래스 | 비고 |
|---------|--------|------|
| AI Hub 08-14 (DS14) | 6종 | 합성 데이터 12,000장 |
| AI Hub 08-15 (DS15) | 15종 | 합성 데이터 15,000장 |
| DermNet NZ | 3종 | 공개 임상 데이터 |
| ISIC 2019 | 8종 | 공개 임상 데이터 |
| HAM10000 | 7종 | 공개 임상 데이터 |

> 원본 데이터는 라이선스 제약으로 포함되지 않습니다. AI Hub 데이터는 별도 신청, 외부 데이터는 각 공식 배포처에서 수집하세요.

---

## 개발 환경 설정

### 사전 요구사항

- Node.js 18+
- Python 3.10+
- Supabase 프로젝트 (DB + Storage)
- Anthropic API 키 (LMM 기능 사용 시)

### Backend

```bash
cd backend
cp .env.example .env   # 환경변수 설정
npm install
npm start              # http://localhost:3000
```

### Flask AI 서비스

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cd ai/inference
cp .env.example .env   # 환경변수 설정
python app.py          # http://localhost:5001

# 가상환경 종료
deactivate
```

---

## 현재 제한사항

- 모델 체크포인트 미포함: `*.pth`는 gitignore — 별도 학습 또는 수령 필요
- 학습 데이터 미포함: AI Hub 라이선스 제약으로 별도 신청 필요
- LMM 기능: `LLM_ENABLED=true` 및 `ANTHROPIC_API_KEY` 설정 시에만 활성화
