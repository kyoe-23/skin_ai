# Claude → Gemini API 마이그레이션 가이드

> 작성일: 2026-05-16  
> 대상 파일: `ai/inference/llm_service.py`, `ai/inference/requirements.txt`, `ai/inference/.env.example`, `ai/testing/test_llm.py`

---

## 목차

1. [현황 요약](#1-현황-요약)
2. [비용 비교](#2-비용-비교)
3. [모델 매핑](#3-모델-매핑)
4. [환경 구축](#4-환경-구축)
5. [코드 변경 상세](#5-코드-변경-상세)
6. [Claude vs Gemini 주요 차이점](#6-claude-vs-gemini-주요-차이점)
7. [이슈 사항 및 주의점](#7-이슈-사항-및-주의점)
8. [마이그레이션 체크리스트](#8-마이그레이션-체크리스트)

---

## 1. 현황 요약

현재 `llm_service.py`에서 Claude API를 사용하는 기능은 3가지다.

| 함수 | 사용 모델 | 역할 |
|------|-----------|------|
| `generate_report()` | `claude-sonnet-4-6` | 분류 결과 → JSON 리포트 생성 |
| `check_is_skin_image()` | `claude-haiku-4-5-20251001` | Vision OOD 필터 (피부 이미지 여부 판별) |
| `chat_response()` | `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` | 멀티턴 후속 질문 응답 |

**현재 Claude 고유 기능 의존 목록**

- `anthropic.Anthropic` 클라이언트 싱글턴
- `client.messages.create()` API 구조
- `system` 필드에 `cache_control: {"type": "ephemeral"}` → 시스템 프롬프트 캐싱 (~90% 입력 비용 절감)
- `client.with_options(timeout=N)` 요청별 타임아웃 오버라이드
- 이미지: base64 인코딩 후 `source.type: base64` 구조
- 에러 타입: `anthropic.APITimeoutError`, `anthropic.APIError`
- 응답 접근: `response.content[0].text`, `response.usage.input_tokens`, `response.usage.cache_read_input_tokens`
- 멀티턴 role: `"user"` / `"assistant"`

---

## 2. 비용 비교

> 아래 가격은 2025년 기준 공식 가격 페이지 기준이며, 변동될 수 있다.  
> 항상 최신 가격을 확인: [Anthropic Pricing](https://anthropic.com/pricing) / [Google AI Pricing](https://ai.google.dev/pricing)

### Claude (현재)

| 모델 | 입력 ($/M tokens) | 출력 ($/M tokens) | 비고 |
|------|------------------|------------------|------|
| claude-sonnet-4-6 | $3.00 | $15.00 | 리포트·채팅 |
| claude-haiku-4-5 | $0.80 | $4.00 | OOD·채팅(경량) |
| Prompt Cache 히트 | $0.30 (-90%) | — | 시스템 프롬프트 재활용 시 |

> **현재 절감 포인트**: `generate_report()` 시스템 프롬프트(약 370 tokens)에 `cache_control: ephemeral`이 적용되어 반복 호출 시 입력 비용 ~90% 절감 중.

### Gemini (이전 후보)

| 모델 | 입력 ($/M tokens) | 출력 ($/M tokens) | 비고 |
|------|------------------|------------------|------|
| gemini-2.0-flash | $0.10 | $0.40 | 범용 (권장) |
| gemini-2.0-flash-lite | $0.075 | $0.30 | 초경량 (OOD용) |
| gemini-1.5-pro | $1.25 (<128k) | $5.00 | 고품질 리포트 |
| gemini-2.5-pro | $1.25 (<200k) | $10.00 | 최고품질 |
| Context Caching | -75% 할인 | — | 최소 32k tokens 이상 |

### 예상 비용 절감

```
시나리오: 월 10,000회 리포트 생성
  - 평균 입력 1,000 tokens (시스템 ~370 + 사용자 ~200) / 출력 ~300 tokens

[Claude Sonnet, 캐시 히트 80% 가정]
  입력: 10,000 × (370×0.2×$3.00 + 370×0.8×$0.30 + 200×$3.00) / 1,000,000
       ≈ $0.96 + $0.89 + $6.00 = $7.85/월
  출력: 10,000 × 300 × $15.00 / 1,000,000 = $45.00/월
  합계: ~$53/월

[Gemini 2.0 Flash, 캐싱 없음]
  입력: 10,000 × 570 × $0.10 / 1,000,000 = $0.57/월
  출력: 10,000 × 300 × $0.40 / 1,000,000 = $1.20/월
  합계: ~$1.77/월 (약 96% 절감)
```

> **결론**: Gemini 2.0 Flash 전환 시 캐싱 없이도 비용이 대폭 감소한다.  
> 단, 품질 차이를 반드시 테스트 후 검증해야 한다.

---

## 3. 모델 매핑

| 현재 (Claude) | 권장 (Gemini) | 대안 (Gemini) |
|---------------|---------------|---------------|
| `claude-sonnet-4-6` (리포트) | `gemini-2.0-flash` | `gemini-1.5-pro` (품질 우선 시) |
| `claude-haiku-4-5-20251001` (OOD) | `gemini-2.0-flash-lite` | `gemini-2.0-flash` |
| `claude-haiku-4-5-20251001` (채팅) | `gemini-2.0-flash` | `gemini-2.0-flash-lite` |

---

## 4. 환경 구축

### 4-1. 패키지 변경

**`ai/inference/requirements.txt`**

```diff
- anthropic>=0.40.0
+ google-genai>=1.0.0
```

> `google-generativeai` (구 SDK)가 아닌 `google-genai` (신규 Vertex AI 통합 SDK)를 사용한다.  
> 구 SDK는 기능이 제한적이고, Gemini 2.x 이상은 신규 SDK에서만 완전 지원된다.

설치 확인:

```bash
pip install google-genai>=1.0.0
python -c "from google import genai; print(genai.__version__)"
```

### 4-2. API 키 발급

1. [Google AI Studio](https://aistudio.google.com/apikey)에서 API 키 발급
2. 프로젝트에서 "Gemini API" 활성화
3. 무료 할당량: Gemini 2.0 Flash — 분당 15회 요청 / 일 1,500회 (무료 티어 기준)

### 4-3. 환경 변수 변경

**`ai/inference/.env.example`**

```diff
- # ── LLM (Claude API) ─────────────────────────────────────────────
- # https://console.anthropic.com/settings/keys 에서 발급
- ANTHROPIC_API_KEY=
- # 리포트 생성 모델 (품질 우선)
- LLM_MODEL=claude-sonnet-4-6
- # 챗봇 후속 질문 모델 (속도 우선)
- LLM_MODEL_CHAT=claude-haiku-4-5-20251001
- LLM_MAX_TOKENS=4096
- LLM_MAX_TOKENS_CHAT=1536
- # false 로 끄면 LLM 없이 동작
- LLM_ENABLED=true
-
- # ── OOD 필터 (비-피부 이미지 사전 거절) ─────────────────────────
- # LLM_ENABLED=true 상태에서만 동작. false 로 끄면 OOD 체크만 단독 비활성화
- OOD_CHECK_ENABLED=true
- # OOD 판별 전용 모델 (속도 우선 — Haiku)
- LLM_MODEL_OOD=claude-haiku-4-5-20251001
- # Haiku에 전송하기 전 리사이즈 최대 픽셀 (토큰 절감)
- OOD_IMAGE_MAX_DIM=512
- # API 타임아웃(초) — 초과 시 거절하지 않고 DenseNet 분류 진행
- OOD_TIMEOUT_SEC=8

+ # ── LLM (Gemini API) ─────────────────────────────────────────────
+ # https://aistudio.google.com/apikey 에서 발급
+ GOOGLE_API_KEY=
+ # 리포트 생성 모델 (품질 우선)
+ LLM_MODEL=gemini-2.0-flash
+ # 챗봇 후속 질문 모델 (속도 우선)
+ LLM_MODEL_CHAT=gemini-2.0-flash
+ LLM_MAX_TOKENS=4096
+ LLM_MAX_TOKENS_CHAT=1536
+ # false 로 끄면 LLM 없이 동작
+ LLM_ENABLED=true
+
+ # ── OOD 필터 (비-피부 이미지 사전 거절) ─────────────────────────
+ OOD_CHECK_ENABLED=true
+ # OOD 판별 전용 모델 (속도 우선 — Flash Lite)
+ LLM_MODEL_OOD=gemini-2.0-flash-lite
+ OOD_IMAGE_MAX_DIM=512
+ OOD_TIMEOUT_SEC=8
```

---

## 5. 코드 변경 상세

### 5-1. import 및 클라이언트 초기화

**Before (Claude)**
```python
import anthropic

_client: Optional[anthropic.Anthropic] = None

def _get_client() -> Optional[anthropic.Anthropic]:
    global _client
    if os.environ.get("LLM_ENABLED", "false").lower() != "true":
        return None
    if _client is not None:
        return _client
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        logger.warning("[LLM] ANTHROPIC_API_KEY 미설정 — 리포트 비활성")
        return None
    _client = anthropic.Anthropic(api_key=api_key, timeout=DEFAULT_TIMEOUT_SEC)
    return _client
```

**After (Gemini)**
```python
from google import genai
from google.genai import types as genai_types

_client: Optional[genai.Client] = None

def _get_client() -> Optional[genai.Client]:
    global _client
    if os.environ.get("LLM_ENABLED", "false").lower() != "true":
        return None
    if _client is not None:
        return _client
    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logger.warning("[LLM] GOOGLE_API_KEY 미설정 — 리포트 비활성")
        return None
    _client = genai.Client(api_key=api_key)
    return _client
```

> **타임아웃**: Gemini SDK는 클라이언트 레벨 타임아웃을 `httpx` 클라이언트로 설정한다.  
> 요청별 오버라이드는 `generate_content(config=..., request_options={"timeout": N})`로 처리.

---

### 5-2. generate_report() — 텍스트 생성 + 구조화 JSON

**Before (Claude)**
```python
response = client.messages.create(
    model=os.environ.get("LLM_MODEL", DEFAULT_MODEL),
    max_tokens=int(os.environ.get("LLM_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
    system=[{
        "type": "text",
        "text": _build_system_prompt(),
        "cache_control": {"type": "ephemeral"},  # ← Claude 전용 캐싱
    }],
    messages=[{"role": "user", "content": user_message}],
)
text = response.content[0].text.strip()
logger.info(
    f"input_tokens={response.usage.input_tokens}, "
    f"output_tokens={response.usage.output_tokens}, "
    f"cache_read={getattr(response.usage, 'cache_read_input_tokens', 0)}"
)
```

**After (Gemini) — 기본 버전**
```python
response = client.models.generate_content(
    model=os.environ.get("LLM_MODEL", DEFAULT_MODEL),
    contents=user_message,
    config=genai_types.GenerateContentConfig(
        system_instruction=_build_system_prompt(),
        max_output_tokens=int(os.environ.get("LLM_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
    ),
)
text = response.text.strip()
logger.info(
    f"input_tokens={response.usage_metadata.prompt_token_count}, "
    f"output_tokens={response.usage_metadata.candidates_token_count}"
)
```

**After (Gemini) — 권장: JSON 스키마 강제 버전**

Gemini는 `response_mime_type`과 `response_schema`로 JSON 구조를 강제할 수 있어 `_extract_json_object()` 파서가 불필요해진다.

```python
REPORT_SCHEMA = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    required=["summary", "mechanism", "features", "triggers", "learning_point", "disclaimer"],
    properties={
        "summary":        genai_types.Schema(type=genai_types.Type.STRING),
        "mechanism":      genai_types.Schema(type=genai_types.Type.STRING),
        "features":       genai_types.Schema(type=genai_types.Type.STRING),
        "triggers":       genai_types.Schema(type=genai_types.Type.STRING),
        "learning_point": genai_types.Schema(type=genai_types.Type.STRING),
        "disclaimer":     genai_types.Schema(type=genai_types.Type.STRING),
    },
)

response = client.models.generate_content(
    model=os.environ.get("LLM_MODEL", DEFAULT_MODEL),
    contents=user_message,
    config=genai_types.GenerateContentConfig(
        system_instruction=_build_system_prompt(),
        max_output_tokens=int(os.environ.get("LLM_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
        response_mime_type="application/json",
        response_schema=REPORT_SCHEMA,
    ),
)
# JSON 파싱 오류 가능성 대폭 감소
return json.loads(response.text)
```

---

### 5-3. check_is_skin_image() — 비전 OOD 필터

**Before (Claude) — base64 인코딩 필요**
```python
buf = io.BytesIO()
resized.save(buf, format="JPEG", quality=85)
b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

response = client.with_options(timeout=ood_timeout).messages.create(
    model=os.environ.get("LLM_MODEL_OOD", "claude-haiku-4-5-20251001"),
    max_tokens=5,
    system="...",
    messages=[{
        "role": "user",
        "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
            {"type": "text", "text": "YES 또는 NO"},
        ],
    }],
)
answer = response.content[0].text.strip().upper()
```

**After (Gemini) — PIL 이미지 직접 전달 가능**
```python
buf = io.BytesIO()
resized.save(buf, format="JPEG", quality=85)
image_part = genai_types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")

response = client.models.generate_content(
    model=os.environ.get("LLM_MODEL_OOD", "gemini-2.0-flash-lite"),
    contents=[image_part, "YES 또는 NO"],
    config=genai_types.GenerateContentConfig(
        system_instruction=(
            "이미지가 사람의 피부 또는 피부 병변(여드름·발진·반점·습진·상처 등)을 찍은 사진이면 'YES', "
            "그 외(동물·음식·풍경·사물 등)이면 'NO'만 출력하세요."
        ),
        max_output_tokens=5,
    ),
    request_options={"timeout": ood_timeout},
)
answer = response.text.strip().upper()
```

> **주의**: `base64` import는 더 이상 필요 없다.

---

### 5-4. chat_response() — 멀티턴 채팅

**Before (Claude) — stateless messages 배열**
```python
# role: "user" / "assistant"
messages = []
for msg in prior:
    role = "assistant" if msg.get("role") == "ai" else "user"
    messages.append({"role": role, "content": msg.get("content", "")})
messages.append({"role": "user", "content": question})

response = client.messages.create(
    model=..., max_tokens=..., system=system, messages=messages
)
return response.content[0].text.strip()
```

**After (Gemini) — Chat 세션 또는 history 배열**
```python
# role: "user" / "model" (Claude의 "assistant" → Gemini의 "model")
history = []
for msg in prior:
    role = "model" if msg.get("role") == "ai" else "user"
    history.append(
        genai_types.Content(
            role=role,
            parts=[genai_types.Part(text=msg.get("content", ""))],
        )
    )

chat = client.chats.create(
    model=os.environ.get("LLM_MODEL_CHAT", DEFAULT_MODEL),
    config=genai_types.GenerateContentConfig(
        system_instruction=system,
        max_output_tokens=int(os.environ.get("LLM_MAX_TOKENS_CHAT", str(DEFAULT_MAX_TOKENS_CHAT))),
    ),
    history=history,
)
response = chat.send_message(question if history else first_user_msg)
return response.text.strip()
```

---

### 5-5. 에러 핸들링

**Before (Claude)**
```python
except anthropic.APITimeoutError:
    logger.warning("[OOD] 타임아웃 — pass-through")
    return None
except anthropic.APIError as e:
    logger.error(f"[LLM] Claude API 오류: error={e}")
    return None
```

**After (Gemini)**
```python
from google.api_core import exceptions as google_exceptions

except google_exceptions.DeadlineExceeded:
    logger.warning("[OOD] 타임아웃 — pass-through")
    return None
except google_exceptions.GoogleAPIError as e:
    logger.error(f"[LLM] Gemini API 오류: error={e}")
    return None
```

---

### 5-6. 상수 변경

```python
# Before
DEFAULT_MODEL = "claude-sonnet-4-6"

# After
DEFAULT_MODEL = "gemini-2.0-flash"
```

---

## 6. Claude vs Gemini 주요 차이점

| 항목 | Claude | Gemini |
|------|--------|--------|
| **패키지** | `anthropic` | `google-genai` |
| **API 키 환경변수** | `ANTHROPIC_API_KEY` | `GOOGLE_API_KEY` |
| **클라이언트** | `anthropic.Anthropic(api_key=...)` | `genai.Client(api_key=...)` |
| **호출 메서드** | `client.messages.create()` | `client.models.generate_content()` |
| **시스템 프롬프트** | `system=[{...}]` 필드 | `config.system_instruction` |
| **프롬프트 캐싱** | `cache_control: ephemeral` (쉬움, 5분 TTL) | Context Caching API (복잡, 최소 32k tokens) |
| **응답 텍스트** | `response.content[0].text` | `response.text` |
| **입력 토큰** | `response.usage.input_tokens` | `response.usage_metadata.prompt_token_count` |
| **출력 토큰** | `response.usage.output_tokens` | `response.usage_metadata.candidates_token_count` |
| **캐시 히트 토큰** | `response.usage.cache_read_input_tokens` | `response.usage_metadata.cached_content_token_count` |
| **멀티턴 role** | `"user"` / `"assistant"` | `"user"` / `"model"` |
| **타임아웃 오버라이드** | `client.with_options(timeout=N)` | `request_options={"timeout": N}` |
| **이미지 전달** | base64 인코딩 필수 | `Part.from_bytes()` 또는 PIL 직접 지원 |
| **JSON 강제 출력** | 시스템 프롬프트로 유도 (불안정) | `response_mime_type + response_schema` (네이티브 지원) |
| **스톱 이유** | `response.stop_reason` | `response.candidates[0].finish_reason` |
| **에러 기반 클래스** | `anthropic.APIError` | `google.api_core.exceptions.GoogleAPIError` |
| **타임아웃 에러** | `anthropic.APITimeoutError` | `google.api_core.exceptions.DeadlineExceeded` |
| **채팅 세션** | stateless (messages 배열 매 요청 전달) | `client.chats.create()` 세션 객체 지원 |
| **Rate Limit (무료)** | 없음 (유료만) | Flash: 분당 15회, 일 1,500회 |

---

## 7. 이슈 사항 및 주의점

### 이슈 1 — 프롬프트 캐싱 손실 (가장 중요)

현재 `generate_report()` 에서 `cache_control: ephemeral`로 시스템 프롬프트 캐싱이 적용되어 있다.  
Gemini의 Context Caching은 **최소 32,768 tokens 이상**만 지원하므로 현재 시스템 프롬프트(~370 tokens)는 대상이 아니다.

**영향**: 반복 호출 시 시스템 프롬프트 입력 비용이 매번 발생  
**완화**: Gemini 2.0 Flash의 단가 자체가 Claude Sonnet보다 96% 저렴하므로 캐싱 없이도 비용 절감

---

### 이슈 2 — JSON 파싱 안정성

현재 `_extract_json_object()`로 Claude의 마크다운 코드블록 혼입을 방어하고 있다.  
Gemini도 `response_mime_type`을 쓰지 않으면 동일 문제가 발생할 수 있다.

**권장**: `response_mime_type="application/json"` + `response_schema` 사용으로 근본 해결  
**주의**: `response_schema` 적용 시 시스템 프롬프트의 JSON 형식 지시 섹션이 중복된다 → 제거하거나 단순화

---

### 이슈 3 — 멀티턴 role 이름 불일치

DB에 저장된 대화 이력의 role 값이 `"ai"`이고, 이를 Claude `"assistant"`로 변환하고 있다.  
Gemini는 `"model"`을 사용한다.

**변경 필요**: `chat_response()` 내 role 변환 로직  
```python
# Before
role = "assistant" if msg.get("role") == "ai" else "user"
# After
role = "model" if msg.get("role") == "ai" else "user"
```

---

### 이슈 4 — OOD 타임아웃 처리 방식 변경

Claude는 `client.with_options(timeout=N).messages.create(...)` 으로 요청별 타임아웃을 적용했다.  
Gemini는 `request_options={"timeout": N}` 파라미터를 사용한다.

**에러 타입**: `anthropic.APITimeoutError` → `google.api_core.exceptions.DeadlineExceeded`

---

### 이슈 5 — Vision 품질 검증 필요

Gemini 2.0 Flash-Lite의 OOD 판별 성능이 Claude Haiku와 동일하지 않을 수 있다.  
피부 이미지 판별 정확도를 직접 테스트셋으로 비교해야 한다.

**검증 방법**:
- 피부 이미지 100장 + 비피부 이미지 100장으로 정확도 비교
- 기준치: Claude Haiku 대비 FPR(False Positive Rate) ±5% 이내

---

### 이슈 6 — Rate Limit (개발/테스트 환경)

Gemini API 무료 티어: **분당 15회, 일 1,500회**  
프로덕션에서는 유료 플랜 필요 (종량제, 일반적으로 분당 1,000~2,000회 이상)

**테스트 환경**: 단위 테스트 실행 시 rate limit 초과 가능 → 테스트 간 딜레이 추가 권장

---

### 이슈 7 — test_llm.py 수정 필요

`ai/testing/test_llm.py`가 `anthropic` 직접 import 및 `ANTHROPIC_API_KEY` 환경변수를 사용한다.  
Gemini 전환 시 전면 수정 필요.

변경 포인트:
- `import anthropic` → `from google import genai`
- `os.environ.get("ANTHROPIC_API_KEY", "")` → `os.environ.get("GOOGLE_API_KEY", "")`
- `anthropic.Anthropic(api_key=api_key)` → `genai.Client(api_key=api_key)`
- `client.messages.create(...)` → `client.models.generate_content(...)`
- `response.content[0].text` → `response.text`
- `response.usage.input_tokens` / `response.usage.output_tokens` → `response.usage_metadata`

---

### 이슈 8 — `base64` import 정리

`check_is_skin_image()`에서 base64 인코딩이 제거되면 `import base64`가 불필요해질 수 있다.  
`generate_report()`에서도 base64를 사용하지 않으면 상단 import 정리.

---

### 이슈 9 — 응답 품질 회귀 가능성

Claude Sonnet과 Gemini 2.0 Flash는 의료 도메인 한국어 리포트 생성 품질이 다를 수 있다.

**검증 권장 사항**:
1. 동일 입력 10~20개 케이스로 양 모델 출력 비교
2. `disclaimer` 20자 이내 준수 여부 체크 (Gemini가 더 길게 출력하는 경향 있음)
3. 마크다운 기호 혼입 여부 (`#`, `**` 등) — chat 응답에서 특히 주의
4. 허위 정보(hallucination) 발생 빈도 비교

---

### 이슈 10 — .env 파일 실제 키 업데이트 누락 위험

`ai/inference/.env` (git ignore)에 `ANTHROPIC_API_KEY`가 설정되어 있다면, Gemini 전환 후에도 `GOOGLE_API_KEY`가 없으면 LLM이 자동으로 비활성화된다.  
서버 재시작 후 로그에서 `[LLM] GOOGLE_API_KEY 미설정 — 리포트 비활성` 메시지를 반드시 확인.

---

## 8. 마이그레이션 체크리스트

```
환경 구축
[ ] google-genai>=1.0.0 설치 (requirements.txt 수정)
[ ] anthropic 패키지 제거
[ ] Google AI Studio에서 API 키 발급
[ ] ai/inference/.env에 GOOGLE_API_KEY 추가
[ ] .env.example 업데이트 (ANTHROPIC_API_KEY → GOOGLE_API_KEY, 모델명 변경)

llm_service.py 코드 변경
[ ] import 변경 (anthropic → google.genai, google.api_core.exceptions)
[ ] import base64 제거 (Part.from_bytes로 대체)
[ ] DEFAULT_MODEL 상수 변경 (claude-sonnet-4-6 → gemini-2.0-flash)
[ ] DEFAULT_TIMEOUT_SEC 상수 제거 (Gemini 클라이언트에 global timeout 없음)
[ ] _extract_json_object() 함수 전체 삭제 (response_schema로 대체)
[ ] _client 타입 변경 (anthropic.Anthropic → genai.Client)
[ ] _get_client() 환경변수 키 변경 (ANTHROPIC_API_KEY → GOOGLE_API_KEY)
[ ] _REPORT_SCHEMA 상수 추가 (response_schema용 JSON 스키마 정의)
[ ] _build_system_prompt() 내 JSON 출력 형식 예시 블록 제거 (스키마로 대체)
[ ] generate_report() API 호출 구조 변경
[ ] generate_report() 응답 접근 방식 변경 (response.content[0].text → response.text)
[ ] generate_report() 토큰 로깅 필드 변경 (usage_metadata)
[ ] generate_report() stop_reason 로깅 제거
[ ] generate_report() json.JSONDecodeError except 블록 내 text 변수 참조 수정
[ ] check_is_skin_image() b64 변수 삭제 + 이미지 전달 방식 변경 (base64 → Part.from_bytes)
[ ] check_is_skin_image() 타임아웃 방식 변경 (with_options → request_options)
[ ] check_is_skin_image() 에러 핸들링 변경 (APITimeoutError → DeadlineExceeded)
[ ] chat_response() role 변환 변경 ("assistant" → "model")
[ ] chat_response() messages 리스트 → chat_history (Content 객체) 구조로 변경
[ ] chat_response() 채팅 API 구조 변경 (chats.create + send_message)
[ ] 에러 핸들링 변경 (anthropic.APIError → google_exceptions.GoogleAPIError)

test_llm.py 수정
[ ] import anthropic 제거
[ ] _test_api_connection() 전체 교체 (GOOGLE_API_KEY, genai.Client 사용)
[ ] _test_generate_report() 내 cache_read_total 변수 및 캐싱 확인 메시지 제거
[ ] _print_report() 필드 목록 수정 ("advice" 제거, "mechanism"/"triggers"/"learning_point" 추가)

테스트
[ ] LLM_ENABLED=true, GOOGLE_API_KEY 설정 후 python ai/testing/test_llm.py 실행
[ ] generate_report() 출력 품질 수동 검증 (5개 케이스 이상)
[ ] check_is_skin_image() OOD 정확도 검증
[ ] chat_response() 멀티턴 흐름 검증
[ ] 서버 기동 후 /report, /chat 엔드포인트 E2E 테스트

운영
[ ] 프로덕션 .env에 GOOGLE_API_KEY 배포
[ ] 서버 재시작 후 로그에 "[LLM] GOOGLE_API_KEY 미설정" 없음 확인
[ ] 분당 요청 수 모니터링 (Rate Limit 여부)
[ ] 비용 모니터링 대시보드 Google Cloud Console로 전환
```

---

## 9. 실제 코드 대조 검증 — 문서와 현재 코드 간 차이

> 아래 항목은 현재 `llm_service.py`와 `test_llm.py` 실제 코드를 대조해 발견한 **문서에 없거나 불완전하게 기술된 사항**이다.  
> 섹션 10~11의 완성 코드에 모두 반영되어 있다.

### ① `DEFAULT_TIMEOUT_SEC = 45` 상수 제거 필요

**현재 코드 (`llm_service.py` 24번 줄)**
```python
DEFAULT_TIMEOUT_SEC = 45
```
Claude 클라이언트는 `anthropic.Anthropic(api_key=api_key, timeout=DEFAULT_TIMEOUT_SEC)`로 글로벌 타임아웃을 받는다.  
Gemini의 `genai.Client(api_key=api_key)`는 생성자에 타임아웃 파라미터가 없으므로 이 상수는 전환 후 **사용되지 않는 코드**가 된다. → 삭제.

---

### ② `_extract_json_object()` 함수 삭제 필요

**현재 코드 (`llm_service.py` 29~46번 줄)**
```python
def _extract_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    ...
    return text[start : end + 1]
```
`response_schema`를 사용하면 Gemini가 JSON 외의 텍스트를 출력하지 않으므로 이 함수와 164번 줄의 호출 `json.loads(_extract_json_object(text))`를 모두 제거한다.

---

### ③ `generate_report()` — `stop_reason` 로깅 라인 제거 필요

**현재 코드 (`llm_service.py` 156~162번 줄)**
```python
logger.info(
    f"[LLM] 리포트 생성 완료: "
    f"input_tokens={response.usage.input_tokens}, "
    f"output_tokens={response.usage.output_tokens}, "
    f"cache_read={getattr(response.usage, 'cache_read_input_tokens', 0)}, "
    f"stop_reason={response.stop_reason}"   # ← Gemini에는 response.stop_reason 없음
)
```
Gemini에서는 `response.stop_reason` 대신 `response.candidates[0].finish_reason`을 사용하나, 이 로그가 핵심 기능이 아니므로 단순히 제거하고 `usage_metadata`만 로깅한다.

---

### ④ `generate_report()` — JSONDecodeError except 블록 내 `text` 변수 참조 오류

**현재 코드 (`llm_service.py` 167번 줄)**
```python
raw = text if 'text' in locals() and text else ""
```
Gemini 버전에서는 `text` 지역 변수가 없고 `response.text`를 직접 사용하므로 이 방어 코드를 변경해야 한다.

```python
# After
raw = response.text if response else ""
```

---

### ⑤ `test_llm.py` — `_print_report()` 필드 목록 버그

**현재 코드 (`test_llm.py` 96번, 100번 줄)**
```python
for key in ("summary", "features", "advice", "disclaimer"):   # ← "advice"는 존재하지 않는 필드
    ...
missing = [k for k in ("summary", "features", "advice", "disclaimer") ...]
```
`generate_report()`의 실제 반환 필드는 `summary / mechanism / features / triggers / learning_point / disclaimer` 6개다.  
`"advice"` 필드는 없고, `"mechanism"`, `"triggers"`, `"learning_point"` 3개가 빠져 있다. → Gemini 전환과 무관하지만 같이 수정.

---

### ⑥ `test_llm.py` — `cache_read_total` 미사용 변수 + 캐싱 메시지 제거 필요

**현재 코드 (`test_llm.py` 154번, 161~162번 줄)**
```python
cache_read_total = 0   # 사용되지 않는 변수
...
print("캐싱 동작 확인: 로그에서 'cache_read=0 이상' 여부를 확인하세요.")
```
Gemini에는 프롬프트 캐싱(ephemeral)이 없으므로 두 줄 모두 삭제.

---

### ⑦ `google.api_core` 별도 설치 불필요

`from google.api_core import exceptions as google_exceptions`는 `google-genai` 설치 시 자동으로 함께 설치되는 `google-api-core` 패키지에서 제공된다. `requirements.txt`에 별도 항목 추가 불필요.

---

## 10. 완성 코드 — `ai/inference/llm_service.py`

> 아래 코드를 현재 파일에 **전체 교체(덮어쓰기)**하면 된다.

```python
"""Gemini LLM 리포트 생성 서비스.

분류 결과 dict → 자연어 리포트(JSON 구조화).
환경변수 LLM_ENABLED=false 또는 API 키 부재 시 None 반환 (graceful).
"""
# ── 표준 라이브러리 ──────────────────────────────────────────────
import io
import json
import logging
import os
from typing import Optional

# ── 서드파티 ─────────────────────────────────────────────────────
from google import genai
from google.genai import types as genai_types
from google.api_core import exceptions as google_exceptions

logger = logging.getLogger(__name__)

# ── 상수 ─────────────────────────────────────────────────────────
DEFAULT_MODEL = "gemini-2.0-flash"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_MAX_TOKENS_CHAT = 1536
DEFAULT_OOD_TIMEOUT_SEC = 8
DEFAULT_OOD_MAX_DIM = 512
CONFIDENCE_LOW_THRESHOLD = 0.70

# generate_report() 출력 JSON 스키마 — 필드 누락·마크다운 혼입 방지
_REPORT_SCHEMA = genai_types.Schema(
    type=genai_types.Type.OBJECT,
    required=["summary", "mechanism", "features", "triggers", "learning_point", "disclaimer"],
    properties={
        "summary":        genai_types.Schema(type=genai_types.Type.STRING),
        "mechanism":      genai_types.Schema(type=genai_types.Type.STRING),
        "features":       genai_types.Schema(type=genai_types.Type.STRING),
        "triggers":       genai_types.Schema(type=genai_types.Type.STRING),
        "learning_point": genai_types.Schema(type=genai_types.Type.STRING),
        "disclaimer":     genai_types.Schema(type=genai_types.Type.STRING),
    },
)

# ── 모듈 전역 클라이언트 (성능: 매 요청마다 재생성 금지) ────────
_client: Optional[genai.Client] = None


def _get_client() -> Optional[genai.Client]:
    """Gemini 클라이언트 싱글턴. LLM_ENABLED=false면 None."""
    global _client
    if os.environ.get("LLM_ENABLED", "false").lower() != "true":
        return None
    if _client is not None:
        return _client

    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        logger.warning("[LLM] GOOGLE_API_KEY 미설정 — 리포트 비활성")
        return None
    _client = genai.Client(api_key=api_key)
    return _client


def _format_clinical(clinical_ref: Optional[dict]) -> str:
    """clinical_ref dict → LLM 프롬프트용 문자열."""
    if not clinical_ref:
        return "(임상 통계 데이터 없음)"
    parts = []
    if clinical_ref.get("age_distribution"):
        top = max(clinical_ref["age_distribution"], key=clinical_ref["age_distribution"].get)
        parts.append(f"- 주 발병 연령대: {top}")
    if clinical_ref.get("gender_ratio"):
        top = max(clinical_ref["gender_ratio"], key=clinical_ref["gender_ratio"].get)
        parts.append(f"- 주 발병 성별: {top}")
    if clinical_ref.get("severity_dist"):
        top = max(clinical_ref["severity_dist"], key=clinical_ref["severity_dist"].get)
        parts.append(f"- 주 중증도: {top}")
    return "\n".join(parts) if parts else "(임상 통계 데이터 없음)"


def _build_system_prompt() -> str:
    """시스템 프롬프트. response_schema로 JSON 구조를 강제하므로 출력 형식 예시 불필요."""
    return """당신은 피부과 전문의를 보조하는 의료 AI 어시스턴트입니다.
입력으로 딥러닝 모델(DenseNet121/EfficientNet-B3, AI Hub DS_unified 피부질환 데이터로 학습)이
산출한 11종 피부질환 분류 결과(건선, 아토피피부염, 여드름, 광선각화증, 기저세포암,
멜라닌세포모반, 악성흑색종, 지루각화증, 편평세포암, 피부섬유종, 혈관종)를 받아,
환자가 이해할 수 있는 한국어 리포트를 생성합니다.

[필수 원칙]
1. 본 분석은 참고용이며, 확정 진단은 피부과 전문의 대면 진료로만 가능합니다.
2. 약품명·복용량·구체적 처방·치료 프로토콜은 절대 언급하지 마세요.
3. 모델 예측 외의 사실(지어낸 통계, 발병률, 가이드라인)은 출력하지 마세요.
4. 신뢰도가 낮을 때(<70%)는 단정 표현을 피하고 "가능성", "관찰됩니다" 등 추정 표현을 쓰세요.
5. uncertain=true이거나 피부암류(기저세포암·악성흑색종·편평세포암·광선각화증)로 분류된 경우
   즉시 피부과 전문의 대면 진료를 강하게 권유하세요.

[각 필드 작성 기준]
- summary: AI 분류 결과 1~2문장
- mechanism: 발병 기전 — 피부 생리학적 관점에서 2문장. 특정 제품·약품명 언급 금지
- features: 임상 특징 — 병변 양상·호발 부위·진행 양상 2문장
- triggers: 악화 요인과 그 의학적 이유 2문장. 기전 중심으로 설명. 특정 제품·약품명 언급 금지
- learning_point: 이 케이스에서 가장 중요한 교육적 핵심 포인트 1문장
- disclaimer: 참고용 분석임을 알리는 1문장. 기술 용어와 진료 권유 문구 중복 없이 20자 이내"""


def generate_report(prediction: dict, clinical_ref: Optional[dict]) -> Optional[dict]:
    """분류 결과 → 구조화된 LLM 리포트 dict.

    Args:
        prediction: /predict의 'prediction' 필드 ({class_name, confidence, top3, uncertain?})
        clinical_ref: /predict의 'clinical_ref' 필드 (None 가능)

    Returns:
        dict({summary, mechanism, features, triggers, learning_point, disclaimer}) 또는 None (LLM 비활성·실패 시).
    """
    client = _get_client()
    if client is None:
        return None

    top3_text = "\n".join(
        f"  {i+1}. {item['class']} ({item['prob']*100:.1f}%)"
        for i, item in enumerate(prediction.get("top3", []))
    )
    confidence = prediction.get("confidence", 0.0)
    is_uncertain = prediction.get("uncertain", False) or confidence < CONFIDENCE_LOW_THRESHOLD

    user_message = (
        f"[분류 결과]\n"
        f"- 예측 클래스: {prediction['class_name']}\n"
        f"- 신뢰도: {confidence*100:.1f}%\n"
        f"- 불확실 플래그: {is_uncertain}\n"
        f"- 상위 3개 후보:\n{top3_text}\n\n"
        f"[임상 참고 통계]\n{_format_clinical(clinical_ref)}\n\n"
        f"위 정보만을 근거로 리포트를 생성하세요."
    )

    try:
        response = client.models.generate_content(
            model=os.environ.get("LLM_MODEL", DEFAULT_MODEL),
            contents=user_message,
            config=genai_types.GenerateContentConfig(
                system_instruction=_build_system_prompt(),
                max_output_tokens=int(os.environ.get("LLM_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
                response_mime_type="application/json",
                response_schema=_REPORT_SCHEMA,
            ),
        )
        logger.info(
            f"[LLM] 리포트 생성 완료: "
            f"input_tokens={response.usage_metadata.prompt_token_count}, "
            f"output_tokens={response.usage_metadata.candidates_token_count}"
        )
        return json.loads(response.text)
    except json.JSONDecodeError as e:
        raw = response.text if response else ""
        logger.warning(f"[LLM] JSON 파싱 실패: error={e}, output_len={len(raw)}, output_preview={raw[:200]!r}")
        return {
            "summary": "AI 소견을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            "mechanism": "", "features": "", "triggers": "",
            "learning_point": "",
            "disclaimer": "본 분석은 참고용이며, 피부과 전문의 진료가 필요합니다.",
        }
    except google_exceptions.GoogleAPIError as e:
        logger.error(f"[LLM] Gemini API 오류: error={e}")
        return None


def check_is_skin_image(image: "Image") -> Optional[bool]:
    """Gemini Flash-Lite vision으로 업로드 이미지가 피부/피부병변 사진인지 사전 판별.

    DenseNet은 폐쇄형 분류기라 비-피부 이미지도 높은 신뢰도로 오분류한다.
    이를 막기 위해 추론 전에 Flash-Lite vision으로 이진 판별을 수행한다.

    Args:
        image: PIL RGB 이미지

    Returns:
        True  — 피부 이미지로 판별 → DenseNet 분류 진행
        False — 피부 이미지 아님  → HTTP 400 거절
        None  — 판별 불가(API 오류/비활성) → pass-through (서비스 중단 방지)
    """
    if os.environ.get("OOD_CHECK_ENABLED", "false").lower() != "true":
        return None

    client = _get_client()
    if client is None:
        return None

    max_dim = int(os.environ.get("OOD_IMAGE_MAX_DIM", str(DEFAULT_OOD_MAX_DIM)))
    resized = image.copy()
    resized.thumbnail((max_dim, max_dim))

    buf = io.BytesIO()
    resized.save(buf, format="JPEG", quality=85)
    image_part = genai_types.Part.from_bytes(data=buf.getvalue(), mime_type="image/jpeg")

    ood_timeout = int(os.environ.get("OOD_TIMEOUT_SEC", str(DEFAULT_OOD_TIMEOUT_SEC)))

    try:
        response = client.models.generate_content(
            model=os.environ.get("LLM_MODEL_OOD", "gemini-2.0-flash-lite"),
            contents=[image_part, "YES 또는 NO"],
            config=genai_types.GenerateContentConfig(
                system_instruction=(
                    "이미지가 사람의 피부 또는 피부 병변(여드름·발진·반점·습진·상처 등)을 찍은 사진이면 'YES', "
                    "그 외(동물·음식·풍경·사물 등)이면 'NO'만 출력하세요. 다른 텍스트는 절대 출력하지 마세요."
                ),
                max_output_tokens=5,
            ),
            request_options={"timeout": ood_timeout},
        )
        answer = response.text.strip().upper()
        result = answer.startswith("YES")
        logger.info(f"[OOD] 판별 완료: answer={answer!r}, is_skin={result}")
        return result
    except google_exceptions.DeadlineExceeded:
        logger.warning("[OOD] 타임아웃 — pass-through")
        return None
    except google_exceptions.GoogleAPIError as e:
        logger.warning(f"[OOD] API 오류 — pass-through: error={e}")
        return None


CHAT_HISTORY_MAX = 20   # 최대 전달 턴 수 (초과분은 오래된 것부터 제거)


def chat_response(question: str, context: dict, history: Optional[list] = None) -> Optional[str]:
    """진단 컨텍스트 기반 멀티턴 후속 질문 응답.

    Args:
        question: 현재 사용자 질문
        context: {class_name, confidence, report} 딕셔너리
        history: 이전 대화 목록 [{role: "user"|"ai", content: str}, ...]

    Returns:
        str 응답 또는 None (LLM 비활성·실패 시).
    """
    client = _get_client()
    if client is None:
        return None

    class_name = context.get("class_name", "알 수 없음")
    confidence = context.get("confidence", 0.0)
    report = context.get("report") or {}

    system = (
        "당신은 피부질환 교육을 돕는 의료 AI 어시스턴트입니다. "
        "사용자는 교육·학습 목적으로 피부 이미지를 분석하는 것이며, 반드시 본인의 사진이 아닐 수 있습니다. "
        "따라서 '지금 바로 병원에 가세요', '걱정되실 것 같습니다' 같이 사용자 개인의 건강을 전제하는 표현은 절대 사용하지 마세요. "
        "질환의 특징·기전·임상 정보를 객관적·교육적 관점에서 설명하세요. "
        "약품명·복용량·구체적 처방은 언급하지 마세요. "
        "답변은 바로 내용으로 시작하세요. '~에 대해 설명하겠습니다', '~을 안내해 드리겠습니다' 같은 서두 문구는 절대 사용하지 마세요. "
        "반드시 일반 텍스트로만 답변하세요. #, ##, **, *, - 등 마크다운 기호를 절대 사용하지 마세요. "
        "'더 궁금한 점이 있으신가요?' 같은 후속 질문 유도 문구는 매 답변마다 붙이지 말고, "
        "대화 흐름상 자연스럽게 추가 질문을 유도할 필요가 있을 때만 사용하세요."
    )

    # 첫 메시지에만 분석 결과 컨텍스트를 앞에 붙임 — 이후 턴은 질문만 전달
    first_user_msg = (
        f"[분석 결과] 질환: {class_name}, 신뢰도: {confidence*100:.1f}%\n"
        f"[AI 소견 요약] {report.get('summary', '없음')}\n\n"
        f"[질문] {question}"
    )

    # 이전 대화 이력을 Gemini Content 형식으로 변환
    # DB 저장 role: "user" / "ai" → Gemini API role: "user" / "model"
    prior = history or []
    if len(prior) > CHAT_HISTORY_MAX * 2:
        prior = prior[-(CHAT_HISTORY_MAX * 2):]

    chat_history: list = []
    for msg in prior:
        role = "model" if msg.get("role") == "ai" else "user"
        chat_history.append(
            genai_types.Content(
                role=role,
                parts=[genai_types.Part(text=msg.get("content", ""))],
            )
        )

    # 이전 이력이 있으면 현재 질문만, 없으면 분석 컨텍스트 포함
    current_message = question if chat_history else first_user_msg

    try:
        chat = client.chats.create(
            model=os.environ.get("LLM_MODEL_CHAT", DEFAULT_MODEL),
            config=genai_types.GenerateContentConfig(
                system_instruction=system,
                max_output_tokens=int(os.environ.get("LLM_MAX_TOKENS_CHAT", str(DEFAULT_MAX_TOKENS_CHAT))),
            ),
            history=chat_history,
        )
        response = chat.send_message(current_message)
        return response.text.strip()
    except google_exceptions.GoogleAPIError as e:
        logger.error(f"[LLM] 채팅 API 오류: error={e}")
        return None
```

---

## 11. 완성 코드 — `ai/testing/test_llm.py`

> 아래 코드를 현재 파일에 **전체 교체(덮어쓰기)**하면 된다.

```python
"""Gemini API 단독 테스트 — PyTorch 없이 LLM 응답 품질만 검증.

테스트 항목:
  1) API 연결 확인 (단순 프롬프트)
  2) llm_service.generate_report() 전체 파이프라인 (다양한 신뢰도·클래스 케이스)

실행:
    python ai/testing/test_llm.py
"""
# ── 표준 라이브러리 ──────────────────────────────────────────────
import json
import os
import sys
import time
from pathlib import Path

# ── 경로 설정 (프로젝트 루트 기준 실행 지원) ─────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "ai" / "inference"))

from dotenv import load_dotenv

load_dotenv("ai/inference/.env")

# ── 상수 ─────────────────────────────────────────────────────────
DIVIDER = "=" * 60

TEST_CASES = [
    {
        "label": "높은 신뢰도 — 아토피피부염",
        "prediction": {
            "class_name": "아토피피부염",
            "confidence": 0.91,
            "top3": [
                {"class": "아토피피부염", "prob": 0.91},
                {"class": "건선",        "prob": 0.06},
                {"class": "지루피부염",  "prob": 0.02},
            ],
        },
        "clinical_ref": {
            "age_distribution": {"10대": 0.38, "20대": 0.30, "30대": 0.20, "기타": 0.12},
            "gender_ratio": {"여": 0.55, "남": 0.45},
            "severity_dist": {"경증": 0.45, "중등도": 0.35, "중증": 0.20},
        },
    },
    {
        "label": "낮은 신뢰도 + uncertain=true — 건선",
        "prediction": {
            "class_name": "건선",
            "confidence": 0.55,
            "uncertain": True,
            "top3": [
                {"class": "건선",       "prob": 0.55},
                {"class": "여드름",     "prob": 0.28},
                {"class": "주사",       "prob": 0.12},
            ],
        },
        "clinical_ref": None,
    },
    {
        "label": "정상 클래스",
        "prediction": {
            "class_name": "정상",
            "confidence": 0.88,
            "top3": [
                {"class": "정상",       "prob": 0.88},
                {"class": "지루피부염", "prob": 0.09},
                {"class": "여드름",     "prob": 0.03},
            ],
        },
        "clinical_ref": None,
    },
    {
        "label": "clinical_ref=None graceful fallback — 주사",
        "prediction": {
            "class_name": "주사",
            "confidence": 0.78,
            "top3": [
                {"class": "주사",       "prob": 0.78},
                {"class": "여드름",     "prob": 0.15},
                {"class": "지루피부염", "prob": 0.07},
            ],
        },
        "clinical_ref": None,
    },
]

# generate_report() 반환 필드 6개 (advice 없음, mechanism/triggers/learning_point 포함)
_REPORT_FIELDS = ("summary", "mechanism", "features", "triggers", "learning_point", "disclaimer")


# ── 헬퍼: 결과 출력 ───────────────────────────────────────────────

def _print_report(label: str, report: dict | None, elapsed: float) -> None:
    print(f"\n[케이스] {label}")
    print(f"  소요 시간: {elapsed:.2f}초")
    if report is None:
        print("  report=None (LLM 비활성 또는 API 실패)")
        return
    for key in _REPORT_FIELDS:
        val = report.get(key, "(없음)")
        print(f"  [{key}] {val}")

    missing = [k for k in _REPORT_FIELDS if not report.get(k)]
    if missing:
        print(f"  [경고] 누락 필드: {missing}")
    else:
        print(f"  [OK] {len(_REPORT_FIELDS)}개 필드 모두 존재")


# ── 1단계: API 연결 확인 (단순 프롬프트) ─────────────────────────

def _test_api_connection() -> bool:
    """API 키 유효성 및 연결 상태만 확인."""
    from google import genai

    api_key = os.environ.get("GOOGLE_API_KEY", "")
    if not api_key:
        print("[SKIP] GOOGLE_API_KEY 미설정 — API 연결 테스트 생략")
        return False

    print(f"\n{DIVIDER}")
    print("1단계: API 연결 확인")
    print(DIVIDER)

    client = genai.Client(api_key=api_key)
    t0 = time.time()
    response = client.models.generate_content(
        model=os.environ.get("LLM_MODEL", "gemini-2.0-flash"),
        contents="한 문장으로 답하세요: 피부과 AI 어시스턴트입니까?",
        config={"max_output_tokens": 64},
    )
    elapsed = time.time() - t0
    print(f"  응답: {response.text.strip()}")
    print(
        f"  소요: {elapsed:.2f}초 | "
        f"입력 토큰: {response.usage_metadata.prompt_token_count} | "
        f"출력 토큰: {response.usage_metadata.candidates_token_count}"
    )
    print("[OK] API 연결 성공")
    return True


# ── 2단계: generate_report() 파이프라인 테스트 ─────────────────

def _test_generate_report() -> None:
    """다양한 신뢰도·클래스 케이스로 llm_service.generate_report() 검증."""
    from llm_service import generate_report

    llm_enabled = os.environ.get("LLM_ENABLED", "false").lower() == "true"
    print(f"\n{DIVIDER}")
    print(f"2단계: generate_report() 파이프라인 테스트 (LLM_ENABLED={llm_enabled})")
    print(DIVIDER)

    if not llm_enabled:
        report = generate_report(TEST_CASES[0]["prediction"], None)
        assert report is None, "LLM_ENABLED=false 시 None 반환 실패"
        print("[OK] LLM_ENABLED=false → report=None 확인")
        return

    for case in TEST_CASES:
        t0 = time.time()
        report = generate_report(case["prediction"], case["clinical_ref"])
        elapsed = time.time() - t0
        _print_report(case["label"], report, elapsed)


# ── 진입점 ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(DIVIDER)
    print("SkinAI LLM 단독 테스트 (Gemini)")
    print(DIVIDER)

    try:
        _test_api_connection()
    except Exception as e:
        print(f"[ERROR] API 연결 실패: {e}")
        sys.exit(1)

    _test_generate_report()

    print(f"\n{DIVIDER}")
    print("테스트 완료")
    print(DIVIDER)
```

---

## 12. 완성 환경 변수 — `ai/inference/.env.example`

> 아래 내용으로 `.env.example`을 교체하고, 실제 `.env`는 `GOOGLE_API_KEY` 값을 채워서 사용한다.

```dotenv
# ── Flask 서버 ───────────────────────────────────────────────────
FLASK_ENV=production
FLASK_PORT=5001
FLASK_DEBUG=0

# ── 모델 ─────────────────────────────────────────────────────────
MODEL_PATH=ai/results/DS_unified/checkpoint/best.pth
MODEL_BACKBONE=densenet121
THRESHOLD_PATH=ai/results/DS_unified/checkpoint/thresholds.json
DATA_CSV=data/processed/unified/train.csv
DEVICE=auto
GRADCAM_ALPHA=0.4

# OOD/저신뢰 거절용 글로벌 최소 신뢰도 (0.0~1.0). 비우면 기본 0.35
MIN_CONFIDENCE=0.35

# ── CORS ─────────────────────────────────────────────────────────
# 허용할 출처 (쉼표 구분). 비워두면 전체 허용(*)
ALLOWED_ORIGINS=https://your-domain.com

# ── LLM (Gemini API) ─────────────────────────────────────────────
# https://aistudio.google.com/apikey 에서 발급
GOOGLE_API_KEY=
# 리포트 생성 모델 (품질 우선)
LLM_MODEL=gemini-2.0-flash
# 챗봇 후속 질문 모델 (속도 우선)
LLM_MODEL_CHAT=gemini-2.0-flash
LLM_MAX_TOKENS=4096
LLM_MAX_TOKENS_CHAT=1536
# false 로 끄면 LLM 없이 동작
LLM_ENABLED=true

# ── OOD 필터 (비-피부 이미지 사전 거절) ─────────────────────────
# LLM_ENABLED=true 상태에서만 동작. false 로 끄면 OOD 체크만 단독 비활성화
OOD_CHECK_ENABLED=true
# OOD 판별 전용 모델 (속도·비용 우선 — Flash-Lite)
LLM_MODEL_OOD=gemini-2.0-flash-lite
# Flash-Lite 전송 전 리사이즈 최대 픽셀 (토큰 절감)
OOD_IMAGE_MAX_DIM=512
# API 타임아웃(초) — 초과 시 거절하지 않고 DenseNet 분류 진행
OOD_TIMEOUT_SEC=8
```

---

## 13. 실행 검증 절차

### Step 1 — 패키지 교체

```bash
pip uninstall anthropic -y
pip install "google-genai>=1.0.0"
python -c "from google import genai; from google.genai import types; from google.api_core import exceptions; print('OK')"
```

### Step 2 — API 연결 + 리포트 생성 테스트

```bash
# 프로젝트 루트에서 실행
LLM_ENABLED=true GOOGLE_API_KEY=<발급받은키> python ai/testing/test_llm.py
```

정상 출력 예시:
```
============================================================
1단계: API 연결 확인
============================================================
  응답: 네, 피부과 AI 어시스턴트입니다.
  소요: 1.23초 | 입력 토큰: 18 | 출력 토큰: 12
[OK] API 연결 성공

============================================================
2단계: generate_report() 파이프라인 테스트 (LLM_ENABLED=True)
============================================================

[케이스] 높은 신뢰도 — 아토피피부염
  소요 시간: 2.34초
  [summary] ...
  [mechanism] ...
  [features] ...
  [triggers] ...
  [learning_point] ...
  [disclaimer] ...
  [OK] 6개 필드 모두 존재
```

### Step 3 — Flask 서버 기동 후 엔드포인트 검증

```bash
# ai/inference/.env에 GOOGLE_API_KEY 설정 후
python ai/inference/app.py
```

별도 터미널에서:

```bash
# /report 엔드포인트 테스트
curl -s -X POST http://localhost:5001/report \
  -H "Content-Type: application/json" \
  -d '{
    "prediction": {
      "class_name": "아토피피부염",
      "confidence": 0.91,
      "top3": [{"class": "아토피피부염", "prob": 0.91}]
    }
  }' | python -m json.tool

# /chat 엔드포인트 테스트
curl -s -X POST http://localhost:5001/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "아토피피부염의 주요 악화 요인은 무엇인가요?",
    "context": {"class_name": "아토피피부염", "confidence": 0.91},
    "history": []
  }' | python -m json.tool
```

### Step 4 — 서버 로그 확인

정상 동작 시 보여야 할 로그:

```
INFO [LLM] 리포트 생성 완료: input_tokens=XXX, output_tokens=XXX
INFO [OOD] 판별 완료: answer='YES', is_skin=True
```

보이면 안 되는 로그:

```
WARNING [LLM] GOOGLE_API_KEY 미설정 — 리포트 비활성   ← .env에 키 없음
```
