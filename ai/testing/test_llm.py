"""Claude API 단독 테스트 — PyTorch 없이 LLM 응답 품질만 검증.

§4-1 테스트 케이스:
  1) API 연결 확인 (단순 프롬프트)
  2) llm_service.generate_report() 전체 파이프라인 (§4-3 체크리스트 케이스)

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

# §4-3 체크리스트 케이스
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


# ── 헬퍼: 결과 출력 ───────────────────────────────────────────────

def _print_report(label: str, report: dict | None, elapsed: float) -> None:
    print(f"\n[케이스] {label}")
    print(f"  소요 시간: {elapsed:.2f}초")
    if report is None:
        print("  report=None (LLM 비활성 또는 API 실패)")
        return
    for key in ("summary", "features", "advice", "disclaimer"):
        val = report.get(key, "(없음)")
        print(f"  [{key}] {val}")

    missing = [k for k in ("summary", "features", "advice", "disclaimer") if not report.get(k)]
    if missing:
        print(f"  [경고] 누락 필드: {missing}")
    else:
        print("  [OK] 4개 필드 모두 존재")


# ── 1단계: API 연결 확인 (단순 프롬프트) ─────────────────────────

def _test_api_connection() -> bool:
    """API 키 유효성 및 연결 상태만 확인."""
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("[SKIP] ANTHROPIC_API_KEY 미설정 — API 연결 테스트 생략")
        return False

    print(f"\n{DIVIDER}")
    print("1단계: API 연결 확인")
    print(DIVIDER)

    client = anthropic.Anthropic(api_key=api_key)
    t0 = time.time()
    response = client.messages.create(
        model=os.environ.get("LLM_MODEL", "claude-sonnet-4-6"),
        max_tokens=64,
        messages=[{"role": "user", "content": "한 문장으로 답하세요: 피부과 AI 어시스턴트입니까?"}],
    )
    elapsed = time.time() - t0
    print(f"  응답: {response.content[0].text.strip()}")
    print(f"  소요: {elapsed:.2f}초 | 입력 토큰: {response.usage.input_tokens} | 출력 토큰: {response.usage.output_tokens}")
    print("[OK] API 연결 성공")
    return True


# ── 2단계: generate_report() 파이프라인 테스트 ─────────────────

def _test_generate_report() -> None:
    """§4-3 체크리스트 케이스로 llm_service.generate_report() 검증."""
    from llm_service import generate_report

    llm_enabled = os.environ.get("LLM_ENABLED", "false").lower() == "true"
    print(f"\n{DIVIDER}")
    print(f"2단계: generate_report() 파이프라인 테스트 (LLM_ENABLED={llm_enabled})")
    print(DIVIDER)

    if not llm_enabled:
        # LLM 비활성 상태에서 None 반환 확인
        report = generate_report(TEST_CASES[0]["prediction"], None)
        assert report is None, "LLM_ENABLED=false 시 None 반환 실패"
        print("[OK] LLM_ENABLED=false → report=None 확인")
        return

    cache_read_total = 0
    for case in TEST_CASES:
        t0 = time.time()
        report = generate_report(case["prediction"], case["clinical_ref"])
        elapsed = time.time() - t0
        _print_report(case["label"], report, elapsed)

    print(f"\n{DIVIDER}")
    print("캐싱 동작 확인: 로그에서 'cache_read=0 이상' 여부를 확인하세요.")


# ── 진입점 ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(DIVIDER)
    print("SkinAI LLM 단독 테스트 (§4-1)")
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
