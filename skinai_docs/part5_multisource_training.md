# 파트 5 — 도메인 갭 해소: 80% 달성 가능 플랜

> 작성일: 2026-05-04  
> 최종 수정: 2026-05-04 (DermNet 실제 폴더 구조 검증 후 매핑 테이블 전면 수정)  
> 대상 모델: DS14 (안면부 염증성 6종) + DS15 (피부종양 15종)  
> 공통 문제: 합성 데이터 도메인 갭 — 실제 임상 이미지 테스트에서 정확도 급락  
> 목표: 외부 임상 이미지 Top-1 **≥ 80%** (실사용 최소 기준)  
> 근거: 2024-2025 최신 논문 + 공개 데이터셋 조사 결과

---

## 1. 두 데이터셋의 도메인 갭 구조

| 항목 | DS14 (안면부 피부질환) | DS15 (피부종양) |
|------|---------------------|----------------|
| 클래스 수 | 6종 | 15종 |
| 촬영 부위 | 안면 | **전신** |
| 악성 클래스 | 없음 | 3종 (악성흑색종, 기저세포암, 편평세포암) |
| 학습 데이터 | 9,600장 (합성) | 12,000장 (합성, 클래스당 800장) |
| val 데이터 | 1,200장 | 1,500장 |
| 기존 val 성능 | Top-1 92.27% | 학습 예정 |
| **실제 이미지 성능** | **25% (측정됨)** | **미측정 (동일 문제 예상)** |
| 적합한 외부 데이터 | DermNet NZ, SCIN, Fitzpatrick17k | **ISIC, HAM10000**, SCIN 일부 |

두 모델 모두 AI Hub 합성 데이터 기반이므로 도메인 갭 원인은 동일하다. 그러나 임상 목적과 촬영 부위가 달라 **외부 데이터 전략은 완전히 분리**해야 한다.

---

## 2. 외부 데이터셋 — DS14용 (안면부 염증성 피부질환)

### A. Kaggle DermNet ★ 최우선

| 항목 | 내용 |
|------|------|
| 총량 | train 15,557장 + test 4,002장 = 19,559장 (23종) |
| DS14 커버 | 건선, 아토피피부염, 여드름 — **실질 3종** (정상·지루피부염 없음, 주사 분리 불가) |
| 이미지 유형 | 실제 임상 사진 |
| 라이선스 | CC BY-NC-ND 4.0 (학술 허용) |
| 다운로드 | `kaggle datasets download shubhamgoel27/dermnet` |
| 워터마크 | 일부 있음 → 없는 버전: `alisahad/dermnet-augmented-datasetno-watermark` |

**실제 검증된 매핑 테이블** (23개 폴더 직접 확인, 2026-05-04):

| AI Hub 클래스 | DermNet 폴더명 | train | test | 레이블 품질 |
|--------------|--------------|------:|-----:|-----------|
| 건선 | `Psoriasis pictures Lichen Planus and related diseases` | 1,405 | 352 | ⚠️ Lichen Planus(편평태선) 혼재 |
| 아토피피부염 | `Atopic Dermatitis Photos` | 489 | 123 | ✅ |
| 아토피피부염 | `Eczema Photos` *(기획안 누락)* | 1,235 | 309 | ⚠️ 습진 상위 개념 — 접촉성 피부염 등 혼재 |
| 여드름+주사 혼재 | `Acne and Rosacea Photos` | 840 | 312 | ❌ 파일 단위 레이블 없어 분리 불가 |
| **지루피부염** | **폴더 없음** | — | — | ❌ 기획안 오류 |
| **주사** | **독립 폴더 없음** | — | — | ❌ 위 여드름 폴더에 혼재, 분리 불가 |
| **정상** | **폴더 없음** | — | — | ❌ (기획안과 동일) |

> **기획안 수정 사항 요약**
>
> | 항목 | 기획안 | 실제 |
> |------|--------|------|
> | DS14 커버 클래스 수 | 5종 | **3종** (건선·아토피·여드름) |
> | 지루피부염 폴더 | `Seborrheic dermatitis Photos/` | **존재하지 않음** — `Seborrheic Keratoses and other Benign Tumors`(지루각화증, 다른 질환)만 있음 |
> | 주사 독립 폴더 | `Acne and rosacea Photos/` 내부 분리 가능 | **파일 단위 레이블 미제공으로 분리 불가** |
> | `Eczema Photos` 처리 | 언급 없음 | 아토피로 병합 (습진 노이즈 포함) |
> | train 이미지 수 | 3,373장 | **3,969장** (Eczema 병합 포함) |
> | 폴더명 대소문자 | `Lichen planus`, `dermatitis photos` | `Lichen Planus`, `Dermatitis Photos` (대문자) |

**DermNet 내 클래스 불균형 (train 기준):**

| 매핑 클래스 | train | test |
|------------|------:|-----:|
| 아토피피부염 (Atopic + Eczema 합산) | 1,724 | 432 |
| 건선 | 1,405 | 352 |
| 여드름 (주사 혼재) | 840 | 312 |

여드름이 아토피 대비 약 2배 적다. WeightedRandomSampler의 AI Hub/DermNet 소스 가중치만으로는 DermNet 내부 불균형이 보정되지 않음 → 클래스별 추가 가중치 필요.

### B. SCIN (Google)

| 항목 | 내용 |
|------|------|
| 총량 | 10,407장 |
| 촬영 환경 | 일반인 스마트폰 자가 촬영 (실사용 환경과 가장 유사) |
| 라이선스 | **CC BY 4.0** (가장 관대) |
| 다운로드 | `datasets.load_dataset("google/scin")` |
| DS14 유용 클래스 | 여드름 ~109장, 주사 ~57장 — 소량 보강용 |
| 특이사항 | 다인종 피부톤 포함 — 실제 환경 다양성 반영 |

**DS14 관련 수량이 적어 단독 사용 불가. 보조 데이터로 활용.**

### C. Fitzpatrick17k

| 항목 | 내용 |
|------|------|
| 총량 | 16,577장 (114종) |
| DS14 커버 | 건선, 아토피, 여드름, 주사, 지루피부염 — 5/6종 |
| 다운로드 | GitHub (mattgroh/fitzpatrick17k) 신청 필요 |
| 라이선스 | 학술 허용 |
| 주의 | 2025 논문에서 중복·레이블 오류 일부 발견 → 전처리 검증 필수 |

---

## 3. 외부 데이터셋 — DS15용 (피부종양 15종)

DS15 클래스 구조와 공개 데이터셋 매핑:

| DS15 클래스 | 위험도 | ISIC 매핑 | HAM10000 매핑 |
|------------|--------|----------|--------------|
| 악성흑색종 | 악성 | ✅ MEL | ✅ mel |
| 기저세포암 | 악성 | ✅ BCC | ✅ bkl (일부), bcc |
| 편평세포암 | 악성 | ✅ SCC | ❌ 없음 |
| 보웬병 | 전암성 | ✅ AK/SCC 전단계 일부 | ❌ 없음 |
| 광선각화증 | 전암성 | ✅ AK | ✅ akiec |
| 멜라닌세포모반 | 추적필요 | ✅ NV | ✅ nv |
| 흑색점 | 추적필요 | ✅일부 | ❌ 없음 |
| 지루각화증 | 양성 | ✅ BKL | ✅ bkl |
| 피부섬유종 | 양성 | ✅ DF | ✅ df |
| 혈관종 | 양성 | ✅ VASC | ✅ vasc |
| 사마귀 | 양성 | ❌ | ❌ |
| 화농 육아종 | 양성 | ❌ | ❌ |
| 표피낭종 | 양성 | ❌ | ❌ |
| 비립종 | 양성 | ❌ | ❌ |
| 피지샘증식증 | 양성 | ❌ | ❌ |

### A. ISIC Archive ★ DS15 최우선

| 항목 | 내용 |
|------|------|
| 총량 | ISIC 2020: 33,000+장 / ISIC 2019: 25,000+장 |
| DS15 커버 | 10/15종 (악성 3종 + 전암성 1종 + 추적 1종 + 양성 3종) |
| 이미지 유형 | 피부경(dermoscopy) + 임상 사진 혼재 |
| 라이선스 | CC BY-NC 4.0 (학술 허용) |
| 다운로드 | ISIC API 또는 Kaggle ISIC 대회 데이터 |
| 주의 | **dermoscopy 이미지 비율 높음** — DS15 AI Hub 합성과 촬영 방식 차이. 임상 사진만 필터링 권장 |

### B. HAM10000 ★ DS15 핵심 보조

| 항목 | 내용 |
|------|------|
| 총량 | 10,015장 (7종) |
| DS15 커버 | 6/15종 (악성흑색종, 광선각화증, 멜라닌세포모반, 지루각화증, 피부섬유종, 혈관종) |
| 이미지 유형 | 피부경(dermoscopy) — **임상 사진 아님** |
| 라이선스 | CC BY-NC-SA 4.0 |
| 다운로드 | `kaggle datasets download kmader/skin-cancer-mnist-ham10000` |
| 주의 | dermoscopy 이미지라 DS15 AI Hub 합성(임상 사진 기반)과 도메인 차이 존재. 별도 도메인 적응 고려 |

### C. SCIN DS15 관련 클래스

SCIN은 염증성 피부질환 위주이나 일부 종양 관련 케이스 포함. DS15 보완 목적으로 소량 활용 가능.

---

## 4. 정상/보완 클래스 확보 방안

### DS14 — 정상 클래스

DermNet NZ와 SCIN 모두 "정상 피부" 카테고리가 부족하다.

| 방법 | 장점 | 단점 |
|------|------|------|
| AI Hub DS14 정상(합성) 유지 | 즉시 사용 | 합성 데이터 편향 잔존 |
| CelebA 일부 추출 | 202,599장, 학술 허용 | 피부 병변 없음 검증 필요 |
| FFHQ 일부 추출 | 70,000장 고해상도 | CC BY-NC-SA 2.0 |
| 직접 촬영 | 현실 분포 반영 | 개인정보 동의 필요, 수량 한정 |

### DS15 — 사마귀·화농 육아종·표피낭종·비립종·피지샘증식증

ISIC/HAM10000에서 커버되지 않는 5개 양성 클래스는 Fitzpatrick17k 또는 직접 수집 필요.

---

## 5. 80% 달성 플랜

### DS14 — Plan A: DinoV2 + DermNet 혼합 ★ 권장

**근거**: DinoV2 + DermNet + HAM10000 혼합에서 **96.48%** 달성 (2024 논문). DenseNet121 대비 실제 이미지 domain 적응력 우수.

**예상 성능**: 80~88%  
**소요 시간**: 2~3주

구현 핵심:
- `facebook/dinov2-base` (HuggingFace) — Classifier head: Linear(768→6)
- Kaggle DermNet **3종 매핑** (건선·아토피·여드름) 후 `ConcatDataset` ← §2A 검증 결과 반영
- `WeightedRandomSampler`: AI Hub weight=1.0, DermNet weight=1.5 + **DermNet 내 클래스별 추가 보정** (여드름 2.0x)
- AugMix 적용 (도메인 일반화 효과 검증)

> ⚠️ **주사·지루피부염·정상** 클래스는 DermNet 커버 불가 — AI Hub 합성 데이터만으로 학습됨. 해당 클래스의 도메인 갭은 이 플랜으로 해소되지 않음.

### DS14 — Plan B: DenseNet121 유지 + DermNet 혼합 (빠른 검증)

**예상 성능**: 75~85%  
**소요 시간**: 1~2주 (Plan A 이전 baseline)

DermNet NZ 기반 EfficientNet-B2 단독 **89.55%** 달성 사례(MDPI 2025) 참고. DenseNet121도 대규모 실제 데이터 혼합 시 80% 도달 가능성 있음.

> ⚠️ 위 논문 성능은 DermNet 자체 평가(in-distribution)이며, 우리 DS14 6종 도메인(안면부 한정)에서의 실제 성능은 다를 수 있음.

---

### DS15 — Plan A: DinoV2 + ISIC 혼합 ★ 권장

**근거**: ISIC 데이터셋은 DS15 15종 중 10종 직접 매핑 가능. DinoV2는 의료 이미지 domain 적응력이 높고 melanoma/BCC classification에서 SOTA 근접 성능 보고.

**예상 성능**: 악성 클래스 recall ≥ 85%, 전체 Top-1 ≥ 78%  
**소요 시간**: 2~3주

구현 핵심:
- ISIC 2019/2020에서 DS15 10종 추출 → `data/processed/isic/`
- 악성 클래스(악성흑색종, 기저세포암, 편평세포암)에 FocalLoss 가중치
- dermoscopy vs 임상사진 도메인 차이 → 이미지 유형별 augmentation 분리
- `WeightedRandomSampler`로 악성:양성 비율 보정 (현재 AI Hub는 균형이지만 ISIC는 악성 비율 낮음)

### DS15 — 악성 클래스 특별 전략

임상적으로 악성 클래스(악성흑색종, 기저세포암, 편평세포암)의 **False Negative는 치명적**. 외부 데이터 혼합 시 악성 클래스 recall 최우선.

| 전략 | 내용 |
|------|------|
| FocalLoss (γ=2.0) | 악성 클래스 어려운 샘플에 가중치 집중 |
| 악성 클래스 오버샘플링 | WeightedRandomSampler에서 악성 weight 2.0 설정 |
| Recall 기준 best.pth 저장 | val_top1_acc 대신 악성 클래스 macro recall 기준 체크포인트 선택 |
| Threshold 보수적 설정 | 악성 클래스 threshold 낮게 설정 → uncertain 범위 넓힘 |

---

### 공유 전략: PanDerm Backbone (DS14 + DS15 공통)

**근거**: Nature Medicine 2025 발표 피부과 특화 foundation model. 200만+ 장 의료 이미지 사전학습. **10% 레이블만으로 fully-supervised 모델 초과.**

DS14/DS15 모두 공유 backbone으로 사용 가능 → 장기적으로 멀티헤드 통합(data-dataset-15 계획안 §6 Phase 3)의 backbone으로 최적.

**GitHub**: `SiyuanYan1/PanDerm`  
**예상 성능**: DS14 85~92%, DS15 80~88%  
**소요 시간**: 3~4주 (weight 접근 포함)

---

## 6. 80% 달성 불가 방법 (제외 이유)

| 방법 | DS14 | DS15 | 이유 |
|------|------|------|------|
| Augmentation 강화만 | ❌ 최대 35% | ❌ | 도메인 gap 근본 미해결 |
| GAN/Diffusion 합성 추가 | ❌ | ❌ | 합성→합성 확장은 real gap 미해결 |
| DANN/CORAL 단독 | ❌ 75% 한계 | ❌ | 멀티클래스에서 불안정 |
| SimCLR 단독 | ❌ +3%p | ❌ | npj Digital Medicine 2024 검증 |
| ISIC/HAM10000 → DS14에 사용 | ❌ | — | 분류 체계 다름 (피부암 vs 염증성) |
| DermNet → DS15에 사용 | — | ❌ | 염증성 피부질환 위주, 종양 미포함 |

---

## 7. 권장 실행 순서

```
[즉시, 재학습 없음]
1. TTA 적용 → DS14 25% → ~30% 확인 (상한선 파악용)

[1~2주 — DS14 Plan B 선행]
2. Kaggle DermNet 다운로드 확인 (이미 보유)
3. DermNet 3종(건선·아토피·여드름) 매핑 + 클래스별 가중치 보정
   ※ 6종 매핑 불가 — §2A 검증 결과 참고 (지루피부염 폴더 없음, 주사 분리 불가)
4. DenseNet121 + DermNet 혼합 학습
5. external val 평가 → 건선·아토피·여드름 3종 75% / 전체(주사·지루·정상 포함) 성능 별도 측정

[2~3주 — DS14 Plan A]
6. DinoV2 backbone 교체 + DermNet 혼합 → 80~88% 목표 (3종 커버 클래스 기준)

[병행 — DS15 외부 데이터 준비]
7. ISIC 2019/2020 다운로드 → DS15 15종 매핑 (10종 가능)
8. HAM10000 → 6종 추출 (피부경 이미지 주의)
9. DS15 모델 DinoV2 + ISIC 혼합 학습 → ≥ 78% 목표

[4주+ — 통합]
10. PanDerm backbone → DS14 + DS15 공유 backbone 멀티헤드 구조
    (data-dataset-15-memoized-starlight.md §6 Phase 3 참고)
```

---

## 8. 신규/수정 파일 목록

**구현 완료:**

| 파일 | 대상 | 역할 | 상태 |
|------|------|------|------|
| `ai/preprocessing/external_preprocessor.py` | DS14 | DermNet 디렉토리 → CSV 생성 (3종 매핑) | ✅ 완료 |
| `ai/dataset/dataset.py` | DS14 | `ExternalFacialDataset` 추가 | ✅ 완료 |
| `ai/training/classifier/config.py` | DS14 | `extra_data_dir`, `external_weight` 필드 | ✅ 완료 |
| `ai/training/classifier/train.py` | DS14 | ConcatDataset + WeightedRandomSampler + warmup 수정 | ✅ 완료 |
| `ai/testing/evaluate.py` | 공통 | `ExternalFacialDataset` 자동 감지 분기 | ✅ 완료 |

**미구현 (예정):**

| 파일 | 대상 | 역할 |
|------|------|------|
| `ai/training/classifier/model.py` (수정) | 공통 | `build_dinov2_classifier()` 추가 |
| `ai/training/classifier/config_15.py` (신규) | DS15 | FocalLoss 설정, 악성 클래스 가중치 |
| `ai/training/classifier/train_15.py` (신규) | DS15 | FocalLoss + Recall 기준 best 저장 |
| `ai/preprocessing/aihub_preprocessor_15.py` (신규) | DS15 | DS15 ZIP 파싱 (방향 없음), 15종 CSV 생성 |

수정하지 않는 파일:
- `ai/inference/app.py` — MODEL_PATH 환경변수 교체만 필요
- `ai/testing/threshold_opt.py` — 재사용 가능

---

## 9. 참고 문헌 및 데이터셋 링크

| 항목 | 출처 | 수치/비고 |
|------|------|---------|
| DinoV2 + DermNet + HAM10000 | 2024 ML 논문 | **96.48% accuracy** |
| DermNet EfficientNet-B2 단독 | MDPI 2025 | **89.55%** |
| DANN 합성→실제 | PMC 2024 | F1=0.75, +18.47%p |
| PanDerm | Nature Medicine 2025 | 28개 벤치마크 SOTA |
| TTA 피부 분류 | MDPI 2025 | +1~3%p |
| SimCLR 피부 (기대 이하) | npj Digital Medicine 2024 | +3%p |

| 데이터셋 | 링크 |
|----------|------|
| Kaggle DermNet (DS14) | https://www.kaggle.com/datasets/shubhamgoel27/dermnet |
| SCIN HuggingFace (DS14+DS15) | https://huggingface.co/datasets/google/scin |
| ISIC Archive (DS15) | https://www.isic-archive.com |
| HAM10000 Kaggle (DS15) | https://www.kaggle.com/datasets/kmader/skin-cancer-mnist-ham10000 |
| Fitzpatrick17k (DS14 보조) | https://github.com/mattgroh/fitzpatrick17k |
| DinoV2 HuggingFace | https://huggingface.co/facebook/dinov2-base |
| PanDerm GitHub | https://github.com/SiyuanYan1/PanDerm |

---

## 관련 문서

- [part4_realtest_plan.md](part4_realtest_plan.md) — DS14 실제 테스트 기획
- [data-dataset-15-memoized-starlight.md](data-dataset-15-memoized-starlight.md) — DS15 통합 기획 (멀티헤드 구조)
- [ai/results/DS14/DS14_report.md](../ai/results/DS14/DS14_report.md) — DS14 학습 결과
