"""Claude LLM 리포트 생성 서비스.

분류 결과 dict → 자연어 리포트(JSON 구조화).
환경변수 LLM_ENABLED=false 또는 API 키 부재 시 None 반환 (graceful).
"""
# ── 표준 라이브러리 ──────────────────────────────────────────────
import json
import logging
import os
from typing import Optional

# ── 서드파티 ─────────────────────────────────────────────────────
import anthropic

logger = logging.getLogger(__name__)

# ── 상수 (CLAUDE.md 코딩 규칙 ① 하드코딩 금지) ───────────────────
DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 1024
DEFAULT_TIMEOUT_SEC = 30
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
  "summary": "1~2문장 결과 요약",
  "features": "해당 질환의 일반적 임상 특징 2~3문장 (병변 양상, 호발 부위 등)",
  "advice": "일반적 생활 관리 조언 2~3문장 (자극 회피, 보습 등 비처방 영역)",
  "disclaimer": "전문의 상담 권유 1문장"
}"""


def generate_report(prediction: dict, clinical_ref: Optional[dict]) -> Optional[dict]:
    """분류 결과 → 구조화된 LLM 리포트 dict.

    Args:
        prediction: /predict의 'prediction' 필드 ({class_name, confidence, top3, uncertain?})
        clinical_ref: /predict의 'clinical_ref' 필드 (None 가능)

    Returns:
        dict({summary, features, advice, disclaimer}) 또는 None (LLM 비활성·실패 시).
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
        logger.warning(f"[LLM] JSON 파싱 실패 — 원문 폴백 사용: error={e}, output_len={len(text) if 'text' in locals() else 0}")
        fallback = text if 'text' in locals() and text else "(LLM 응답 없음)"
        return {"summary": fallback, "features": "", "advice": "", "disclaimer": "본 분석은 참고용이며, 피부과 전문의 진료가 필요합니다."}
    except anthropic.APIError as e:
        logger.error(f"[LLM] Claude API 오류: error={e}")
        return None


def chat_response(question: str, context: dict) -> Optional[str]:
    """진단 컨텍스트 기반 후속 질문 응답.

    Args:
        question: 사용자 질문
        context: {class_name, confidence, report} 딕셔너리

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
        "당신은 피부과 전문의를 보조하는 의료 AI 어시스턴트입니다. "
        "사용자의 피부 AI 분석 결과를 바탕으로 궁금한 점에 친절하고 간결하게 답변합니다. "
        "확정 진단·처방은 반드시 피부과 전문의에게 받도록 안내하세요. "
        "약품명·복용량·구체적 처방은 언급하지 마세요."
    )
    user_msg = (
        f"[분석 결과] 질환: {class_name}, 신뢰도: {confidence*100:.1f}%\n"
        f"[AI 소견 요약] {report.get('summary', '없음')}\n\n"
        f"[질문] {question}"
    )

    try:
        response = client.messages.create(
            model=os.environ.get("LLM_MODEL_CHAT", DEFAULT_MODEL),
            max_tokens=512,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        return response.content[0].text.strip()
    except anthropic.APIError as e:
        logger.error(f"[LLM] 채팅 API 오류: error={e}")
        return None