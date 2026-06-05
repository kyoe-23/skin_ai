"""Claude LLM 리포트 생성 서비스.

분류 결과 dict → 자연어 리포트(JSON 구조화).
환경변수 LLM_ENABLED=false 또는 API 키 부재 시 None 반환 (graceful).
"""
# ── 표준 라이브러리 ──────────────────────────────────────────────
import base64
import io
import json
import logging
import os
from typing import Optional

# ── 서드파티 ─────────────────────────────────────────────────────
import anthropic

logger = logging.getLogger(__name__)

# ── 상수 (CLAUDE.md 코딩 규칙 ① 하드코딩 금지) ───────────────────
DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 4096
DEFAULT_MAX_TOKENS_CHAT = 1536
DEFAULT_TIMEOUT_SEC = 45
DEFAULT_OOD_TIMEOUT_SEC = 8       # OOD 판별 타임아웃 — 초과 시 pass-through
DEFAULT_OOD_MAX_DIM = 512         # Haiku 전송 전 리사이즈 최대 픽셀
CONFIDENCE_LOW_THRESHOLD = 0.70   # 이 미만은 '불확실' 어조 강화


def _extract_json_object(text: str) -> str:
    """LLM 응답에서 JSON 객체 부분만 추출.

    Claude가 시스템 프롬프트의 "코드블록 없이 JSON만" 지시를 어기고
    ```json ... ``` 으로 감싸거나 "Here is the JSON:" 같은 프리픽스를
    덧붙이는 경우가 있어, 첫 '{' 와 마지막 '}' 사이만 추출한다.

    Args:
        text: LLM 원문 응답

    Returns:
        JSON 추출 시도 후의 문자열 (실패 시 원문 그대로)
    """
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return text
    return text[start : end + 1]

# ── 모듈 전역 클라이언트 (성능: 매 요청마다 재생성 금지) ────────
_client: Optional[anthropic.Anthropic] = None


def _get_client() -> Optional[anthropic.Anthropic]:
    """Anthropic 클라이언트 싱글턴. LLM_ENABLED=false면 None."""
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
    """시스템 프롬프트 — §3-5 자연어 처리 가이드 참조."""
    return """당신은 피부과 전문의를 보조하는 의료 AI 어시스턴트입니다.
입력으로 딥러닝 모델(DenseNet121/EfficientNet-B3, AI Hub DS_unified 피부질환 데이터로 학습)이
산출한 11종 피부질환 분류 결과(건선, 아토피피부염, 여드름, 광선각화증, 기저세포암,
멜라닌세포모반, 악성흑색종, 지루각화증, 편평세포암, 피부섬유종, 혈관종)를 받아,
환자가 이해할 수 있는 한국어 리포트를 JSON 형식으로 생성합니다.

[필수 원칙]
1. 본 분석은 참고용이며, 확정 진단은 피부과 전문의 대면 진료로만 가능합니다.
2. 약품명·복용량·구체적 처방·치료 프로토콜은 절대 언급하지 마세요.
3. 모델 예측 외의 사실(지어낸 통계, 발병률, 가이드라인)은 출력하지 마세요.
4. 신뢰도가 낮을 때(<70%)는 단정 표현을 피하고 "가능성", "관찰됩니다" 등 추정 표현을 쓰세요.
5. uncertain=true이거나 피부암류(기저세포암·악성흑색종·편평세포암·광선각화증)로 분류된 경우
   즉시 피부과 전문의 대면 진료를 강하게 권유하세요.

[출력 형식 — 반드시 아래 JSON 스키마 준수, 코드블록 없이 JSON만]
{
  "summary": "AI 분류 결과 1~2문장",
  "mechanism": "발병 기전 — 피부 생리학적 관점에서 2문장. 특정 제품·약품명 언급 금지",
  "features": "임상 특징 — 병변 양상·호발 부위·진행 양상 2문장",
  "triggers": "악화 요인과 그 의학적 이유 2문장. 왜 악화되는지 기전 중심으로 설명. 특정 제품·약품명 언급 금지",
  "learning_point": "이 케이스에서 가장 중요한 교육적 핵심 포인트 1문장",
  "disclaimer": "참고용 분석임을 알리는 1문장. '딥러닝', '모델' 등 기술 용어와 진료 권유 문구 중복 없이 20자 이내로 간결하게."
}"""


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
        f"위 정보만을 근거로 JSON 리포트를 생성하세요."
    )

    try:
        response = client.messages.create(
            model=os.environ.get("LLM_MODEL", DEFAULT_MODEL),
            max_tokens=int(os.environ.get("LLM_MAX_TOKENS", str(DEFAULT_MAX_TOKENS))),
            system=[{
                "type": "text",
                "text": _build_system_prompt(),
                "cache_control": {"type": "ephemeral"},   # 시스템 프롬프트 캐싱 → 입력 비용 ~90% 절감
            }],
            messages=[{"role": "user", "content": user_message}],
        )
        text = response.content[0].text.strip()
        # 토큰 사용량은 로깅 (CLAUDE.md ④: 의료 데이터·예측 결과 본문은 로그 금지)
        logger.info(
            f"[LLM] 리포트 생성 완료: "
            f"input_tokens={response.usage.input_tokens}, "
            f"output_tokens={response.usage.output_tokens}, "
            f"cache_read={getattr(response.usage, 'cache_read_input_tokens', 0)}, "
            f"stop_reason={response.stop_reason}"
        )
        # 코드블록·프리픽스 텍스트가 섞여 들어와도 JSON 본문만 추출 후 파싱
        return json.loads(_extract_json_object(text))
    except json.JSONDecodeError as e:
        # text가 비어있거나 추출 실패한 경우까지 graceful 처리
        raw = text if 'text' in locals() and text else ""
        logger.warning(f"[LLM] JSON 파싱 실패 — 원문 폴백 사용: error={e}, output_len={len(raw)}, output_preview={raw[:200]!r}")
        return {
            "summary": "AI 소견을 생성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            "mechanism": "", "features": "", "triggers": "",
            "learning_point": "",
            "disclaimer": "본 분석은 참고용이며, 피부과 전문의 진료가 필요합니다.",
        }
    except anthropic.APIError as e:
        logger.error(f"[LLM] Claude API 오류: error={e}")
        return None


def check_is_skin_image(image: "Image") -> Optional[bool]:
    """Haiku vision으로 업로드 이미지가 피부/피부병변 사진인지 사전 판별.

    DenseNet은 폐쇄형 분류기라 비-피부 이미지도 높은 신뢰도로 오분류한다.
    이를 막기 위해 추론 전에 Haiku vision으로 이진 판별을 수행한다.

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
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    ood_timeout = int(os.environ.get("OOD_TIMEOUT_SEC", str(DEFAULT_OOD_TIMEOUT_SEC)))

    try:
        response = client.with_options(timeout=ood_timeout).messages.create(
            model=os.environ.get("LLM_MODEL_OOD", "claude-haiku-4-5-20251001"),
            max_tokens=5,
            system=(
                "이미지가 사람의 피부 또는 피부 병변(여드름·발진·반점·습진·상처 등)을 찍은 사진이면 'YES', "
                "그 외(동물·음식·풍경·사물 등)이면 'NO'만 출력하세요. 다른 텍스트는 절대 출력하지 마세요."
            ),
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": b64},
                    },
                    {"type": "text", "text": "YES 또는 NO"},
                ],
            }],
        )
        answer = response.content[0].text.strip().upper()
        result = answer.startswith("YES")
        logger.info(f"[OOD] 판별 완료: answer={answer!r}, is_skin={result}")
        return result
    except anthropic.APITimeoutError:
        logger.warning("[OOD] 타임아웃 — pass-through")
        return None
    except anthropic.APIError as e:
        logger.warning(f"[OOD] API 오류 — pass-through: error={e}")
        return None


CHAT_HISTORY_MAX = 20   # 최대 전달 턴 수 (초과분은 오래된 것부터 제거)


def chat_response(
    question: str,
    context: dict,
    history: Optional[list] = None,
    image_b64: Optional[str] = None,
    image_media_type: str = "image/jpeg",
) -> Optional[str]:
    """진단 컨텍스트 기반 멀티턴 후속 질문 응답.

    Args:
        question: 현재 사용자 질문
        context: {class_name, confidence, report} 딕셔너리
        history: 이전 대화 목록 [{role: "user"|"ai", content: str}, ...]
        image_b64: 첨부 이미지 base64 문자열 (None이면 텍스트만)
        image_media_type: 이미지 MIME 타입

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
        "실제 사례나 임상 증례를 묻는 경우, 실시간 검색은 불가하지만 "
        "의학 교과서·피부과 저널·증례 보고서(PubMed 등)에 기록된 학습 지식을 바탕으로 "
        "대표적인 임상 양상과 특징적 소견을 교육적으로 설명하세요. "
        "출처를 지어내지 말고, 학습된 일반 의학 지식 범위 내에서만 답변하세요. "
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

    # 이전 대화 이력을 Claude messages 형식으로 변환
    # DB 저장 role: "user" / "ai" → Claude API role: "user" / "assistant"
    prior = history or []
    if len(prior) > CHAT_HISTORY_MAX * 2:
        prior = prior[-(CHAT_HISTORY_MAX * 2):]

    messages: list = []
    for msg in prior:
        role = "assistant" if msg.get("role") == "ai" else "user"
        content = msg.get("content", "")
        # 첫 번째 user 메시지에만 분석 컨텍스트가 들어있으므로 그대로 유지
        messages.append({"role": role, "content": content})

    # 현재 질문 추가 — 이미지가 있으면 vision content block, 없으면 text만
    base_text = question if messages else first_user_msg
    if image_b64:
        current_content = [
            {"type": "image", "source": {"type": "base64", "media_type": image_media_type, "data": image_b64}},
            {"type": "text", "text": base_text},
        ]
    else:
        current_content = base_text
    messages.append({"role": "user", "content": current_content})

    try:
        response = client.messages.create(
            model=os.environ.get("LLM_MODEL_CHAT", DEFAULT_MODEL),
            max_tokens=int(os.environ.get("LLM_MAX_TOKENS_CHAT", str(DEFAULT_MAX_TOKENS_CHAT))),
            system=system,
            messages=messages,
        )
        return response.content[0].text.strip()
    except anthropic.APIError as e:
        logger.error(f"[LLM] 채팅 API 오류: error={e}")
        return None