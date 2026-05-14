"""SkinAI Flask 추론 API — 피부질환 분류 + Grad-CAM.

엔드포인트:
    POST /predict  — 이미지 분류 + Grad-CAM + 임상 참고정보
    GET  /health   — 헬스 체크
    GET  /classes  — 클래스 목록
"""

# ── 표준 라이브러리 ──────────────────────────────────────────────
import base64
import io
import json
import logging
import os
import time
import traceback
import threading
from pathlib import Path
from typing import Optional, Tuple
from llm_service import generate_report

# ── 서드파티 ─────────────────────────────────────────────────────
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError
from torchvision import models, transforms
from dotenv import load_dotenv


load_dotenv()

# ── 로거 설정 ────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Flask 앱 초기화 ──────────────────────────────────────────────
app = Flask(__name__)
_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_allowed_origins = [o.strip() for o in _origins_raw.split(",") if o.strip()]
CORS(app, resources={
    r"/*": {
        "origins": _allowed_origins,
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"],
    }
})

# ── 상수 ─────────────────────────────────────────────────────────
MAX_FILE_SIZE_MB = 10
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
MIN_IMAGE_SIZE = 100          # 최소 해상도 (픽셀)
INFER_RESIZE = 256            # 추론 전처리 resize
INFER_CROP = 224              # 추론 전처리 center crop
TOP_K = 3                     # 상위 예측 반환 수

# DS_unified 11종 기본값 — _load_model()에서 체크포인트 config로 덮어씀.
# fallback이 모델 output 차원(11)과 일치해야 IDX_TO_CLASS KeyError를 막을 수 있음.
_DEFAULT_CLASS_NAMES = [
    "건선", "아토피피부염", "여드름",
    "광선각화증", "기저세포암", "멜라닌세포모반", "악성흑색종",
    "지루각화증", "편평세포암", "피부섬유종", "혈관종",
]
CLASS_NAMES: list = list(_DEFAULT_CLASS_NAMES)
CLASS_MAP: dict = {name: idx for idx, name in enumerate(CLASS_NAMES)}
IDX_TO_CLASS: dict = {idx: name for idx, name in enumerate(CLASS_NAMES)}

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}

SUPPORTED_BACKBONES = {"densenet121", "efficientnet_b3"}
ATOPY_CLASS = "아토피피부염"   # severity_dist를 노출할 클래스
DEFAULT_MIN_CONFIDENCE = 0.7   # OOD/저신뢰 케이스 거절용 글로벌 floor — .env의 MIN_CONFIDENCE로 override

app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE

# ── 전역 상태 (서버 시작 시 1회 초기화) ─────────────────────────
_model: Optional[nn.Module] = None
_device: Optional[torch.device] = None
_thresholds: Optional[dict] = None
_clinical_ref: Optional[dict] = None
_backbone: Optional[str] = None

# 동시 추론 1개로 제한 — 요청 누적 시 CPU 포화 방지
_infer_lock = threading.Semaphore(1)

# ── 추론 transform (서버 시작 시 1회 생성) ───────────────────────
_infer_transform = transforms.Compose([
    transforms.Resize(INFER_RESIZE),
    transforms.CenterCrop(INFER_CROP),
    transforms.ToTensor(),
    transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
])


# ── 헬퍼: 디바이스 선택 ──────────────────────────────────────────

def _get_device() -> torch.device:
    """CUDA → MPS → CPU 순서로 디바이스 자동 선택.

    환경변수 DEVICE가 'auto'가 아닌 경우 강제 지정.

    Returns:
        torch.device: 선택된 디바이스
    """
    device_env = os.environ.get("DEVICE", "auto")
    if device_env != "auto":
        return torch.device(device_env)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


# ── 헬퍼: 모델 빌드 ──────────────────────────────────────────────

def _build_model_from_checkpoint(backbone: str, checkpoint: dict) -> nn.Module:
    """체크포인트와 backbone 정보로 모델 재구성.

    Args:
        backbone: 'densenet121' 또는 'efficientnet_b3'
        checkpoint: torch.load()로 읽어들인 체크포인트 dict

    Returns:
        nn.Module: 가중치가 로드된 모델

    Raises:
        ValueError: 지원하지 않는 backbone일 경우
    """
    ckpt_cfg = checkpoint.get("config", {})
    num_classes = ckpt_cfg.get("num_classes", len(_DEFAULT_CLASS_NAMES))
    dropout = ckpt_cfg.get("dropout_rate", 0.5)

    if backbone == "densenet121":
        built_model = models.densenet121(weights=None)
        in_features = built_model.classifier.in_features
        built_model.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(in_features, num_classes),
        )
    elif backbone == "efficientnet_b3":
        built_model = models.efficientnet_b3(weights=None)
        in_features = built_model.classifier[-1].in_features
        built_model.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(in_features, num_classes),
        )
    else:
        raise ValueError(f"지원하지 않는 backbone: {backbone}. 허용: {SUPPORTED_BACKBONES}")

    built_model.load_state_dict(checkpoint["model_state_dict"])
    return built_model


# ── 헬퍼: 임계값 로드 ────────────────────────────────────────────

def _load_thresholds(threshold_path: str) -> Optional[dict]:
    """thresholds.json 로드.

    파일이 없으면 None 반환 → argmax fallback으로 graceful 처리.

    Args:
        threshold_path: 임계값 JSON 파일 경로

    Returns:
        dict 또는 None
    """
    if not threshold_path or not Path(threshold_path).exists():
        logger.info("[INFO] 임계값 파일 없음 — argmax 방식 사용")
        return None

    try:
        with open(threshold_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        # _meta 키 제외한 클래스별 임계값만 추출
        thresholds = {k: v for k, v in data.items() if not k.startswith("_")}
        logger.info("[INFO] 임계값 로드 완료")
        return thresholds
    except (json.JSONDecodeError, OSError) as e:
        logger.warning(f"[WARNING] 임계값 파일 파싱 실패: error={e}")
        return None


# ── 헬퍼: 임상 참고정보 빌드 ─────────────────────────────────────

def _build_clinical_ref(df: pd.DataFrame) -> dict:
    """클래스별 임상 통계를 미리 계산하여 메모리에 캐시.

    요청마다 재계산하지 않도록 서버 시작 시 1회 수행.

    Args:
        df: processed_aihub/train.csv DataFrame

    Returns:
        dict: {class_name: {age_distribution, gender_ratio, severity_dist}}
    """
    ref = {}
    for class_name in CLASS_NAMES:
        class_df = df[df["class_name"] == class_name]
        if len(class_df) == 0:
            ref[class_name] = None
            continue

        entry: dict = {}

        if "age_range" in class_df.columns:
            age_dist = class_df["age_range"].value_counts(normalize=True)
            entry["age_distribution"] = {
                str(k): round(v, 3)
                for k, v in age_dist.items()
                if str(k) != "nan"
            }

        if "gender" in class_df.columns:
            gender_dist = class_df["gender"].value_counts(normalize=True)
            entry["gender_ratio"] = {
                str(k): round(v, 3)
                for k, v in gender_dist.items()
                if str(k) != "nan"
            }

        # severity_dist는 아토피피부염 클래스에만 노출
        if class_name == ATOPY_CLASS and "severity" in class_df.columns:
            sev_dist = class_df["severity"].value_counts(normalize=True)
            entry["severity_dist"] = {
                str(k): round(v, 3)
                for k, v in sev_dist.items()
                if str(k) != "nan"
            }
        else:
            entry["severity_dist"] = None

        ref[class_name] = entry

    return ref


# ── 모델 초기화 ───────────────────────────────────────────────────

def _load_model():
    """모델·임계값·임상 참고정보를 서버 시작 시 1회 로드."""
    global _model, _device, _thresholds, _clinical_ref, _backbone
    global CLASS_NAMES, CLASS_MAP, IDX_TO_CLASS

    _device = _get_device()
    model_path = os.environ.get("MODEL_PATH", "ai/results/best.pth")
    _backbone = os.environ.get("MODEL_BACKBONE", "densenet121")

    # 의료 데이터 경로는 로그에 출력하지 않음
    logger.info(f"[INFO] 모델 로드 시작 (backbone={_backbone}, device={_device})")

    try:
        checkpoint = torch.load(model_path, map_location=_device, weights_only=False)
    except (FileNotFoundError, RuntimeError) as e:
        logger.error(f"[ERROR] 체크포인트 로드 실패: error={e}")
        raise

    # 체크포인트 config에서 클래스 정보 복원
    ckpt_cfg = checkpoint.get("config", {})
    ckpt_class_names = ckpt_cfg.get("class_names", _DEFAULT_CLASS_NAMES)
    CLASS_NAMES[:] = ckpt_class_names
    CLASS_MAP.clear()
    CLASS_MAP.update({name: idx for idx, name in enumerate(CLASS_NAMES)})
    IDX_TO_CLASS.clear()
    IDX_TO_CLASS.update({idx: name for idx, name in enumerate(CLASS_NAMES)})
    logger.info(f"[INFO] 클래스 {len(CLASS_NAMES)}종 로드: {CLASS_NAMES}")

    _model = _build_model_from_checkpoint(_backbone, checkpoint)
    _model = _model.to(_device)
    _model.eval()
    logger.info("[INFO] 모델 로드 완료")

    threshold_path = os.environ.get("THRESHOLD_PATH", "ai/results/thresholds.json")
    _thresholds = _load_thresholds(threshold_path)

    data_csv = os.environ.get("DATA_CSV", "data/processed/unified/train.csv")
    if data_csv and Path(data_csv).exists():
        df = pd.read_csv(data_csv)
        _clinical_ref = _build_clinical_ref(df)
        logger.info(f"[INFO] clinical_ref 생성 완료 ({len(df)}건)")
    else:
        _clinical_ref = {}
        logger.warning("[WARNING] DATA_CSV 없음 — clinical_ref 비활성")

    # 워밍업: 첫 실제 요청이 느려지지 않도록 더미 추론 1회 실행
    logger.info("[INFO] 모델 워밍업 시작...")
    try:
        dummy = torch.zeros(1, 3, INFER_CROP, INFER_CROP).to(_device)
        with torch.no_grad():
            _ = _model(dummy)
        logger.info("[INFO] 워밍업 완료")
    except Exception as e:
        logger.warning(f"[WARNING] 워밍업 실패 (무시): {e}")


# ── 헬퍼: 이미지 전처리 ──────────────────────────────────────────

def _preprocess_image(image: Image.Image) -> torch.Tensor:
    """추론용 이미지 전처리 (Resize → CenterCrop → ToTensor → Normalize).

    Args:
        image: RGB PIL 이미지

    Returns:
        torch.Tensor: shape (1, 3, 224, 224)
    """
    return _infer_transform(image).unsqueeze(0)


# ── 헬퍼: Grad-CAM ───────────────────────────────────────────────

def _generate_gradcam(image: Image.Image, input_tensor: torch.Tensor) -> str:
    """Grad-CAM 히트맵을 생성하여 base64 PNG 문자열로 반환.

    pytorch_grad_cam 라이브러리 없거나 실패 시 빈 문자열 반환 (graceful).

    Args:
        image: 원본 RGB PIL 이미지
        input_tensor: 전처리된 입력 텐서, shape (1, 3, 224, 224)

    Returns:
        str: base64 인코딩된 PNG 문자열, 실패 시 빈 문자열
    """
    try:
        from pytorch_grad_cam import GradCAM
        from pytorch_grad_cam.utils.image import show_cam_on_image
    except ImportError:
        logger.warning("[WARNING] pytorch-grad-cam 미설치 — Grad-CAM 비활성")
        return ""

    try:
        if _backbone == "efficientnet_b3":
            target_layers = [_model.features[-1]]
        elif _backbone == "densenet121":
            target_layers = [_model.features.denseblock4]
        else:
            return ""

        cam = GradCAM(model=_model, target_layers=target_layers)
        grayscale_cam = cam(input_tensor=input_tensor.to(_device))[0]

        rgb_img = np.array(image.resize((INFER_CROP, INFER_CROP))).astype(np.float32) / 255.0
        alpha = float(os.environ.get("GRADCAM_ALPHA", "0.4"))
        visualization = show_cam_on_image(
            rgb_img, grayscale_cam, use_rgb=True, image_weight=1 - alpha,
        )

        buffer = io.BytesIO()
        Image.fromarray(visualization).save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("utf-8")

    except (RuntimeError, AttributeError, TypeError) as e:
        logger.warning(f"[WARNING] Grad-CAM 생성 실패: error={e}")
        return ""


# ── 헬퍼: 이미지 유효성 검사 ─────────────────────────────────────

def _validate_image(file) -> Tuple[Optional[Image.Image], Optional[str]]:
    """업로드된 파일의 유효성을 검사하고 PIL 이미지를 반환.

    Args:
        file: Flask request.files 객체

    Returns:
        (image, error_message) 튜플.
        성공 시 (Image.Image, None), 실패 시 (None, 에러 문자열)
    """
    if not file or file.filename == "":
        return None, "이미지 파일이 필요합니다."

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        return None, f"허용되지 않은 형식입니다. 허용: {', '.join(sorted(ALLOWED_EXTENSIONS))}"

    try:
        image = Image.open(file.stream).convert("RGB")
    except (OSError, UnidentifiedImageError):
        return None, "이미지를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다."

    w, h = image.size
    if w < MIN_IMAGE_SIZE or h < MIN_IMAGE_SIZE:
        return None, f"해상도가 너무 낮습니다 ({w}x{h}). 최소 {MIN_IMAGE_SIZE}x{MIN_IMAGE_SIZE} 이상이어야 합니다."

    return image, None


# ── 엔드포인트 ───────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """서비스 상태 및 로드된 모델 정보 반환."""
    return jsonify({
        "status": "ok",
        "model": _backbone or "not_loaded",
        "classes": len(CLASS_NAMES),
    })


@app.route("/classes", methods=["GET"])
def classes():
    """지원 클래스 목록 반환."""
    return jsonify({"classes": CLASS_NAMES})


@app.route("/predict", methods=["POST"])
def predict():
    """이미지 분류 + Grad-CAM + 임상 참고정보 반환.

    Request:
        multipart/form-data, 'image' 필드에 JPG/PNG

    Returns:
        JSON: {success, prediction, gradcam, clinical_ref, processing_time_ms}
    """
    start_time = time.time()

    if _model is None:
        return jsonify({"success": False, "error": "모델이 로드되지 않았습니다."}), 503

    file = request.files.get("image")
    image, error = _validate_image(file)
    if error:
        return jsonify({"success": False, "error": error}), 400

    if not _infer_lock.acquire(timeout=10):
        return jsonify({"success": False, "error": "서버가 다른 분석 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요."}), 503

    try:
        input_tensor = _preprocess_image(image)

        with torch.no_grad():
            output = _model(input_tensor.to(_device))
            probs = torch.softmax(output, dim=1).cpu().squeeze()

        pred_idx = probs.argmax().item()
        pred_class = IDX_TO_CLASS[pred_idx]
        pred_conf = probs[pred_idx].item()

        top_vals, top_idxs = probs.topk(TOP_K)
        top_k = [
            {"class": IDX_TO_CLASS[idx.item()], "prob": round(val.item(), 4)}
            for val, idx in zip(top_vals, top_idxs)
        ]

        # uncertain 판정: (1) 글로벌 최소 신뢰도 floor + (2) 클래스별 thresholds.json
        # (1)은 OOD(피부질환 아닌 이미지) 거절용 1차 가드 — softmax가 어떤 클래스에도 강한 확신이 없을 때
        # (2)는 학습된 클래스 내에서 클래스별 정밀도/재현율 trade-off를 잡기 위한 정밀 임계값
        min_confidence = float(os.environ.get("MIN_CONFIDENCE", str(DEFAULT_MIN_CONFIDENCE)))
        below_floor = pred_conf < min_confidence
        below_class_threshold = (
            _thresholds is not None
            and pred_class in _thresholds
            and pred_conf < _thresholds[pred_class]
        )
        uncertain = below_floor or below_class_threshold

        prediction = {
            "class_name": pred_class,
            "class_idx": pred_idx,
            "confidence": round(pred_conf, 4),
            "top3": top_k,
        }
        if uncertain:
            prediction["uncertain"] = True
            if below_floor:
                prediction["message"] = (
                    "분석 가능한 피부질환 이미지가 아니거나 신뢰도가 매우 낮습니다. "
                    "피부 병변이 명확히 보이는 이미지로 재시도해 주세요."
                )
            else:
                prediction["message"] = "신뢰도 부족 — 재촬영 권장"

        gradcam_b64 = _generate_gradcam(image, input_tensor)
        clinical_ref = _clinical_ref.get(pred_class) if _clinical_ref else None
        elapsed_ms = round((time.time() - start_time) * 1000)

        return jsonify({
            "success": True,
            "prediction": prediction,
            "gradcam": gradcam_b64,
            "clinical_ref": clinical_ref,
            "report": None,
            "processing_time_ms": elapsed_ms,
        })

    except (RuntimeError, torch.cuda.CudaError) as e:
        logger.error(f"[ERROR] 모델 추론 실패: error={e}")
        return jsonify({"success": False, "error": "모델 추론 중 오류가 발생했습니다."}), 500
    except Exception as e:
        logger.error(f"[ERROR] 예측 처리 중 예상치 못한 오류: error={e}")
        traceback.print_exc()
        return jsonify({"success": False, "error": "분석 중 오류가 발생했습니다."}), 500
    finally:
        _infer_lock.release()


@app.route("/chat", methods=["POST"])
def chat():
    """LLM 채팅 — 진단 컨텍스트 기반 후속 질문 처리."""
    from llm_service import chat_response
    data = request.get_json(silent=True) or {}
    question = data.get("question", "").strip()
    if not question:
        return jsonify({"success": False, "error": "question이 필요합니다."}), 400
    answer = chat_response(question, data.get("context", {}))
    if answer is None:
        return jsonify({"success": True, "answer": None, "enabled": False})
    return jsonify({"success": True, "answer": answer, "enabled": True})


@app.route("/report", methods=["POST"])
def report():
    """분류 결과 dict를 받아 LLM 리포트 생성. 이미지 미전송."""
    from llm_service import generate_report

    data = request.get_json(silent=True) or {}
    prediction = data.get("prediction")
    if not prediction or "class_name" not in prediction:
        return jsonify({"success": False, "error": "prediction 필드가 필요합니다."}), 400

    report_obj = generate_report(prediction, data.get("clinical_ref"))
    if report_obj is None:
        return jsonify({"success": True, "report": None, "enabled": False})
    return jsonify({"success": True, "report": report_obj, "enabled": True})


# ── 에러 핸들러 ──────────────────────────────────────────────────

@app.errorhandler(413)
def too_large(error):
    return jsonify({
        "success": False,
        "error": f"파일 크기 초과 (최대 {MAX_FILE_SIZE_MB}MB)",
    }), 413


@app.errorhandler(404)
def not_found(error):
    return jsonify({"success": False, "error": "엔드포인트를 찾을 수 없습니다."}), 404


# ── 앱 팩토리 & 진입점 ───────────────────────────────────────────

def create_app():
    """gunicorn용 앱 팩토리.

    gunicorn 실행 예시:
        gunicorn -w 2 -b 0.0.0.0:5001 "app:create_app()"
    """
    _load_model()
    return app


if __name__ == "__main__":
    port = int(os.environ.get("FLASK_PORT", "5001"))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    logger.info("=" * 60)
    logger.info("SkinAI Prediction Service")
    logger.info(f"  Port    : {port}")
    logger.info(f"  Debug   : {debug}")
    logger.info("=" * 60)

    _load_model()
    app.run(host="0.0.0.0", port=port, debug=debug, threaded=True)
