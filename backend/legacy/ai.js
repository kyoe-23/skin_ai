const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

// ── 상수 ─────────────────────────────────────────────────────────

/** HTTP 상태코드 — 매직 넘버 방지 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

/** 에러 메시지 중앙화 */
const ERROR_MESSAGES = {
  NO_IMAGE: '이미지 파일을 업로드해주세요',
  INVALID_FILE_TYPE: '이미지 파일만 업로드 가능합니다 (jpg, jpeg, png)',
  AI_SERVICE_UNAVAILABLE: 'AI 분석 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
  PREDICT_FAILED: '이미지 분석 중 오류가 발생했습니다.',
  SAVE_FAILED: '서버 오류가 발생했습니다',
  NO_PREDICTION: '예측 결과가 필요합니다',
  INVALID_INPUT: '입력값 오류',
};

// Flask AI 서비스 설정 (환경변수 필수)
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || process.env.FLASK_AI_SERVICE_URL || 'http://localhost:5001';
const AI_REQUEST_TIMEOUT = parseInt(process.env.AI_REQUEST_TIMEOUT || process.env.FLASK_API_TIMEOUT || '30000', 10);

// 업로드 파일 크기 제한 (환경변수 우선, 기본 10MB)
const MAX_PREDICT_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || String(10 * 1024 * 1024), 10);
const MAX_LEGACY_FILE_SIZE = 5 * 1024 * 1024; // 기존 설문 플로우용 5MB

const router = express.Router();

// 이미지 저장소 설정
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'skin-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: MAX_LEGACY_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다 (jpg, jpeg, png)'));
    }
  }
});

// 임시 저장소
let surveys = []; // 설문지 목록
let surveyIdCounter = 1;
let analyses = []; // 분석 결과
let analysisIdCounter = 1;

// 설문지 질문 목록 (동적으로 관리 가능)
let surveyQuestions = [
  {
    id: 1,
    question: '피부 타입을 선택해주세요',
    type: 'radio',
    options: ['건성', '지성', '복합성', '민감성'],
    required: true
  },
  {
    id: 2,
    question: '현재 피부 고민이 무엇인가요? (복수 선택 가능)',
    type: 'checkbox',
    options: ['여드름', '주름', '색소침착', '모공', '건조함', '민감함'],
    required: true
  },
  {
    id: 3,
    question: '하루 평균 수면 시간은 몇 시간인가요?',
    type: 'radio',
    options: ['4시간 미만', '4-6시간', '6-8시간', '8시간 이상'],
    required: true
  },
  {
    id: 4,
    question: '하루 물 섭취량은 얼마나 되나요?',
    type: 'radio',
    options: ['500ml 미만', '500ml-1L', '1L-2L', '2L 이상'],
    required: true
  },
  {
    id: 5,
    question: '현재 사용 중인 스킨케어 제품이 있나요?',
    type: 'text',
    required: false
  }
];

// ── AI Hub 08-14 신규 엔드포인트 ──────────────────────────────

// 업로드 설정 (10MB, jpg/png)
const uploadPredict = multer({
  storage: storage,
  limits: { fileSize: MAX_PREDICT_FILE_SIZE },
  fileFilter: function (req, file, cb) {
    const allowed = /jpeg|jpg|png/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error(ERROR_MESSAGES.INVALID_FILE_TYPE));
  }
});

/**
 * Flask AI 서비스로 이미지를 전달하고 결과를 반환하는 내부 헬퍼.
 *
 * @param {string} filepath - 업로드된 이미지 임시 파일 경로
 * @returns {Promise<Object>} Flask 응답 데이터
 */
async function callFlaskPredict(filepath) {
  const formData = new FormData();
  formData.append('image', fs.createReadStream(filepath));

  const response = await axios.post(`${AI_SERVICE_URL}/predict`, formData, {
    headers: { ...formData.getHeaders() },
    timeout: AI_REQUEST_TIMEOUT,
    maxContentLength: MAX_PREDICT_FILE_SIZE * 5, // 응답 포함 여유
  });

  return response.data;
}

// POST /api/ai/predict — 이미지 분류 + Grad-CAM + 임상 참고정보
router.post('/predict', authenticateToken, uploadPredict.single('image'), async (req, res) => {
  let filepath = null;
  try {
    if (!req.file) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: ERROR_MESSAGES.NO_IMAGE,
      });
    }

    filepath = req.file.path;
    const data = await callFlaskPredict(filepath);
    return res.json(data);

  } catch (error) {
    // 연결 실패 — Flask 서비스 다운
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        success: false,
        message: ERROR_MESSAGES.AI_SERVICE_UNAVAILABLE,
      });
    }

    // Flask가 에러 응답을 보낸 경우 그대로 전달
    if (error.response) {
      return res.status(error.response.status).json(error.response.data);
    }

    console.error('[ERROR] /predict 실패:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: ERROR_MESSAGES.PREDICT_FAILED,
    });

  } finally {
    // 임시 파일은 성공/실패 무관하게 반드시 삭제
    if (filepath) {
      try { fs.unlinkSync(filepath); } catch (_) { /* 파일 삭제 실패는 무시 */ }
    }
  }
});

// POST /api/ai/analyses — 분석 결과 저장
router.post('/analyses', authenticateToken, [
  body('prediction').notEmpty().withMessage(ERROR_MESSAGES.NO_PREDICTION),
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_INPUT,
        errors: errors.array(),
      });
    }

    const { prediction, gradcam, clinical_ref, image_url } = req.body;
    const userId = req.user.userId;

    // Grad-CAM base64 → 파일 저장
    let gradcamPath = null;
    if (gradcam) {
      const gradcamDir = path.join('uploads', 'gradcam');
      if (!fs.existsSync(gradcamDir)) fs.mkdirSync(gradcamDir, { recursive: true });

      const filename = `gradcam-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      gradcamPath = path.join(gradcamDir, filename);
      fs.writeFileSync(gradcamPath, Buffer.from(gradcam, 'base64'));
    }

    const newAnalysis = {
      id: analysisIdCounter++,
      userId,
      image_url: image_url || null,
      prediction,
      gradcam_path: gradcamPath,
      clinical_ref: clinical_ref || null,
      createdAt: new Date().toISOString(),
    };

    analyses.push(newAnalysis);

    return res.status(HTTP_STATUS.CREATED).json({
      success: true,
      message: '분석 결과가 저장되었습니다',
      data: { id: newAnalysis.id },
    });
  } catch (error) {
    console.error('[ERROR] 분석 저장 실패:', error.message);
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: ERROR_MESSAGES.SAVE_FAILED,
    });
  }
});

// GET /api/ai/analyses — 내 분석 이력 조회 (최신순 20건)
router.get('/analyses', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const userAnalyses = analyses
      .filter(a => a.userId === userId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const start = (page - 1) * limit;
    const paginated = userAnalyses.slice(start, start + limit);

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total: userAnalyses.length,
        totalPages: Math.ceil(userAnalyses.length / limit),
      }
    });
  } catch (error) {
    console.error('[ERROR] 분석 이력 조회 실패:', error);
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다' });
  }
});

// ── 기존 엔드포인트 (하위 호환) ──────────────────────────────

// 이미지 업로드 (POST /api/ai/image-upload)
router.post('/image-upload', authenticateToken, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: '이미지 파일을 업로드해주세요'
      });
    }

    res.json({
      success: true,
      message: '이미지가 업로드되었습니다',
      data: {
        filename: req.file.filename,
        path: req.file.path,
        size: req.file.size,
        uploadedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('이미지 업로드 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 설문지 목록 조회 (GET /api/ai/survey/questions)
router.get('/survey/questions', (req, res) => {
  try {
    res.json({
      success: true,
      data: surveyQuestions
    });
  } catch (error) {
    console.error('설문지 목록 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 설문지 질문 추가 (POST /api/ai/survey/questions) - 관리자용
router.post('/survey/questions', authenticateToken, [
  body('question').notEmpty().withMessage('질문을 입력해주세요'),
  body('type').isIn(['radio', 'checkbox', 'text']).withMessage('올바른 질문 타입을 선택해주세요'),
  body('options').optional().isArray().withMessage('옵션은 배열이어야 합니다'),
  body('required').optional().isBoolean().withMessage('required는 boolean이어야 합니다')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const { question, type, options, required } = req.body;

    const newQuestion = {
      id: surveyQuestions.length + 1,
      question,
      type,
      options: options || [],
      required: required !== undefined ? required : true
    };

    surveyQuestions.push(newQuestion);

    res.status(201).json({
      success: true,
      message: '질문이 추가되었습니다',
      data: newQuestion
    });
  } catch (error) {
    console.error('질문 추가 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 설문지 질문 수정 (PUT /api/ai/survey/questions/:id) - 관리자용
router.put('/survey/questions/:id', authenticateToken, [
  body('question').optional().notEmpty().withMessage('질문을 입력해주세요'),
  body('type').optional().isIn(['radio', 'checkbox', 'text']).withMessage('올바른 질문 타입을 선택해주세요'),
  body('options').optional().isArray().withMessage('옵션은 배열이어야 합니다'),
  body('required').optional().isBoolean().withMessage('required는 boolean이어야 합니다')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const questionId = parseInt(req.params.id);
    const questionIndex = surveyQuestions.findIndex(q => q.id === questionId);

    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: '질문을 찾을 수 없습니다'
      });
    }

    const { question, type, options, required } = req.body;

    if (question) surveyQuestions[questionIndex].question = question;
    if (type) surveyQuestions[questionIndex].type = type;
    if (options) surveyQuestions[questionIndex].options = options;
    if (required !== undefined) surveyQuestions[questionIndex].required = required;

    res.json({
      success: true,
      message: '질문이 수정되었습니다',
      data: surveyQuestions[questionIndex]
    });
  } catch (error) {
    console.error('질문 수정 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 설문지 질문 삭제 (DELETE /api/ai/survey/questions/:id) - 관리자용
router.delete('/survey/questions/:id', authenticateToken, (req, res) => {
  try {
    const questionId = parseInt(req.params.id);
    const questionIndex = surveyQuestions.findIndex(q => q.id === questionId);

    if (questionIndex === -1) {
      return res.status(404).json({
        success: false,
        message: '질문을 찾을 수 없습니다'
      });
    }

    const deletedQuestion = surveyQuestions.splice(questionIndex, 1)[0];

    res.json({
      success: true,
      message: '질문이 삭제되었습니다',
      data: deletedQuestion
    });
  } catch (error) {
    console.error('질문 삭제 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 설문지 제출 (POST /api/ai/survey)
router.post('/survey', authenticateToken, [
  body('imageFilename').notEmpty().withMessage('업로드된 이미지 파일명이 필요합니다'),
  body('answers').isArray().withMessage('답변은 배열이어야 합니다')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: '입력값 오류',
        errors: errors.array()
      });
    }

    const { imageFilename, answers } = req.body;
    const userId = req.user.userId;

    // 새 설문지 생성
    const newSurvey = {
      id: surveyIdCounter++,
      userId,
      imageFilename,
      answers,
      submittedAt: new Date().toISOString()
    };

    surveys.push(newSurvey);

    // AI 분석 결과 생성 (Flask AI 서비스 호출)
    console.log('[INFO] AI 분석 시작:', { surveyId: newSurvey.id, imageFilename });
    const analysis = await generateAnalysis(newSurvey);
    const newAnalysis = {
      id: analysisIdCounter++,
      surveyId: newSurvey.id,
      userId,
      ...analysis,
      createdAt: new Date().toISOString()
    };

    analyses.push(newAnalysis);

    console.log('[INFO] AI 분석 완료:', { analysisId: newAnalysis.id });

    res.status(201).json({
      success: true,
      message: '설문지가 제출되었습니다',
      data: {
        survey: newSurvey,
        analysisId: newAnalysis.id
      }
    });
  } catch (error) {
    console.error('[ERROR] 설문지 제출 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 분석 결과 조회 (GET /api/ai/analysis/:id)
router.get('/analysis/:id', authenticateToken, (req, res) => {
  try {
    const analysisId = parseInt(req.params.id);
    const analysis = analyses.find(a => a.id === analysisId);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: '분석 결과를 찾을 수 없습니다'
      });
    }

    // 본인의 분석 결과만 조회 가능
    if (analysis.userId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: '분석 결과를 조회할 권한이 없습니다'
      });
    }

    res.json({
      success: true,
      data: analysis
    });
  } catch (error) {
    console.error('분석 결과 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

// 내 분석 결과 목록 (GET /api/ai/my-analyses)
router.get('/my-analyses', authenticateToken, (req, res) => {
  try {
    const userId = req.user.userId;
    const userAnalyses = analyses.filter(a => a.userId === userId);

    // 최신순 정렬
    const sortedAnalyses = userAnalyses.sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    res.json({
      success: true,
      data: sortedAnalyses
    });
  } catch (error) {
    console.error('분석 목록 조회 에러:', error);
    res.status(500).json({
      success: false,
      message: '서버 오류가 발생했습니다'
    });
  }
});

/**
 * Flask AI 서비스를 사용한 이미지 분석
 *
 * @param {string} imageFilename - 업로드된 이미지 파일명
 * @returns {Promise<Object>} AI 분석 결과
 */
async function analyzeImageWithAI(imageFilename) {
  try {
    const imagePath = path.join('uploads', imageFilename);

    // 이미지 파일 존재 확인
    if (!fs.existsSync(imagePath)) {
      throw new Error(`이미지 파일을 찾을 수 없습니다: ${imageFilename}`);
    }

    // FormData 생성 (이미지 업로드용)
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));

    // Flask AI 서비스 호출
    console.log(`[INFO] Flask AI 서비스 호출 중: ${AI_SERVICE_URL}/predict`);
    const response = await axios.post(`${AI_SERVICE_URL}/predict`, formData, {
      headers: {
        ...formData.getHeaders()
      },
      timeout: AI_REQUEST_TIMEOUT
    });

    if (!response.data || !response.data.success) {
      throw new Error('Flask AI 서비스 응답 오류');
    }

    console.log('[INFO] AI 분석 성공');
    return response.data.data;

  } catch (error) {
    console.error('[ERROR] Flask AI 서비스 호출 실패:', error.message);

    // Flask 서비스가 다운되었거나 응답하지 않는 경우 폴백 (fallback)
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.warn('[WARNING] Flask AI 서비스 연결 실패. 폴백 분석 사용');
      return generateFallbackAnalysis();
    }

    throw error;
  }
}

/**
 * AI 분석 결과 생성 함수 (Flask API 호출 + 설문 데이터 결합)
 *
 * @param {Object} survey - 설문 데이터 (imageFilename, answers 포함)
 * @returns {Promise<Object>} 분석 결과
 */
async function generateAnalysis(survey) {
  try {
    // Flask AI 서비스로 이미지 분석
    const aiAnalysis = await analyzeImageWithAI(survey.imageFilename);

    // 설문 데이터 추출
    const answers = survey.answers;
    const skinType = answers[0] || '알 수 없음';
    const concerns = answers[1] || [];
    const sleepHours = answers[2] || '알 수 없음';  // 수면 시간
    const waterIntake = answers[3] || '알 수 없음';  // 물 섭취량
    const skincare = answers[4] || '';  // 스킨케어 제품

    // 생활 습관 기반 추천 사항 생성
    const lifestyleRecommendations = generateLifestyleRecommendations(
      sleepHours,
      waterIntake,
      skincare,
      aiAnalysis.top_disease,
      skinType,
      concerns
    );

    // AI 추천 사항과 생활 습관 추천 통합
    let combinedRecommendations = [];
    if (aiAnalysis.predictions && aiAnalysis.predictions.length > 0) {
      combinedRecommendations = [
        ...aiAnalysis.predictions[0].recommendations,
        ...lifestyleRecommendations
      ];
    } else {
      combinedRecommendations = [
        ...generateDefaultRecommendations(skinType, concerns),
        ...lifestyleRecommendations
      ];
    }

    // 생활 습관 기반 상세 분석 점수 조정
    const detailedScores = calculateDetailedScores(skinType, concerns, sleepHours, waterIntake);

    // AI 분석 결과와 설문 데이터 결합
    return {
      // 이미지 정보
      imageFilename: survey.imageFilename,

      // 설문 데이터
      skinType,
      concerns,
      sleepHours,
      waterIntake,
      skincare,

      // AI 분석 결과
      predictions: aiAnalysis.predictions || [],
      topDisease: aiAnalysis.top_disease,
      overallConfidence: aiAnalysis.overall_confidence,
      aiSummary: aiAnalysis.summary,

      // 통합 분석 결과
      score: Math.floor((aiAnalysis.overall_confidence || 0.7) * 100),
      recommendations: combinedRecommendations,
      summary: aiAnalysis.summary || '전반적으로 양호한 피부 상태입니다. 꾸준한 관리가 중요합니다.',

      // 상세 분석 (설문 + 생활 습관 기반)
      detailedAnalysis: detailedScores
    };

  } catch (error) {
    console.error('[ERROR] AI 분석 실패, 폴백 사용:', error.message);
    return generateFallbackAnalysis(survey);
  }
}

/**
 * 폴백 분석 (Flask 서비스 다운 시 사용)
 *
 * @param {Object} survey - 설문 데이터 (imageFilename, answers 포함)
 * @returns {Object} 기본 분석 결과
 */
function generateFallbackAnalysis(survey = {}) {
  const answers = survey.answers || [];
  const skinType = answers[0] || '알 수 없음';
  const concerns = answers[1] || [];

  return {
    // 이미지 정보
    imageFilename: survey.imageFilename,

    skinType,
    concerns,
    predictions: [],
    topDisease: null,
    overallConfidence: 0,
    aiSummary: 'AI 분석 서비스를 사용할 수 없습니다. 피부과 전문의 상담을 권장합니다.',

    score: Math.floor(Math.random() * 30) + 70,
    recommendations: generateDefaultRecommendations(skinType, concerns),
    summary: '설문 기반 분석 결과입니다. 정확한 진단을 위해 피부과 전문의 상담을 권장합니다.',

    detailedAnalysis: {
      moisture: estimateMoisture(skinType),
      elasticity: 70 + Math.floor(Math.random() * 20),
      pores: estimatePores(skinType, concerns),
      pigmentation: concerns.includes('색소침착') ? 50 + Math.floor(Math.random() * 20) : 70 + Math.floor(Math.random() * 20)
    },

    warning: 'AI 분석 서비스가 일시적으로 사용 불가능합니다.'
  };
}

/**
 * 피부 타입 기반 수분 점수 추정
 */
function estimateMoisture(skinType) {
  const moistureMap = {
    '건성': 40 + Math.floor(Math.random() * 20),
    '지성': 70 + Math.floor(Math.random() * 20),
    '복합성': 60 + Math.floor(Math.random() * 20),
    '민감성': 50 + Math.floor(Math.random() * 20)
  };
  return moistureMap[skinType] || 60 + Math.floor(Math.random() * 20);
}

/**
 * 피부 타입 및 고민 기반 모공 점수 추정
 */
function estimatePores(skinType, concerns) {
  let score = 70;

  if (skinType === '지성') score -= 10;
  if (concerns.includes('모공')) score -= 15;

  return Math.max(40, score + Math.floor(Math.random() * 10));
}

/**
 * 피부 타입 및 고민 기반 기본 추천 사항 생성
 */
function generateDefaultRecommendations(skinType, concerns) {
  const recommendations = [];

  // 피부 타입별 추천
  if (skinType === '건성') {
    recommendations.push('보습제를 충분히 사용하세요');
    recommendations.push('하루 2L 이상 물을 마시세요');
  } else if (skinType === '지성') {
    recommendations.push('유분기 적은 화장품을 사용하세요');
    recommendations.push('이중 세안을 권장합니다');
  } else if (skinType === '민감성') {
    recommendations.push('저자극 제품을 사용하세요');
    recommendations.push('패치 테스트 후 사용하세요');
  }

  // 고민별 추천
  if (concerns.includes('여드름')) {
    recommendations.push('피부과 전문의 진료를 권장합니다');
  }
  if (concerns.includes('색소침착')) {
    recommendations.push('자외선 차단제를 매일 사용하세요');
  }

  // 기본 추천
  recommendations.push('규칙적인 수면 패턴을 유지하세요');
  recommendations.push('균형 잡힌 식단을 유지하세요');

  return recommendations;
}

/**
 * 생활 습관 기반 추천 사항 생성
 *
 * @param {string} sleepHours - 수면 시간
 * @param {string} waterIntake - 물 섭취량
 * @param {string} skincare - 스킨케어 제품
 * @param {string} topDisease - AI 예측 질환
 * @param {string} skinType - 피부 타입
 * @param {Array} concerns - 피부 고민
 * @returns {Array} 생활 습관 추천 배열
 */
function generateLifestyleRecommendations(sleepHours, waterIntake, skincare, topDisease, skinType, concerns) {
  const recommendations = [];

  // 1. 수면 시간 기반 추천
  if (sleepHours === '4시간 미만' || sleepHours === '4-6시간') {
    recommendations.push('⏰ 하루 7-8시간 수면을 권장합니다 (피부 재생에 필수)');

    // AI 예측과 연계된 경고
    if (topDisease && (topDisease.toLowerCase().includes('acne') || concerns.includes('여드름'))) {
      recommendations.push('⚠️ 수면 부족은 여드름을 악화시킬 수 있습니다');
    }
    if (concerns.includes('주름')) {
      recommendations.push('⚠️ 수면 부족은 피부 노화를 가속화합니다');
    }
  }

  // 2. 물 섭취량 기반 추천
  if (waterIntake === '500ml 미만' || waterIntake === '500ml-1L') {
    recommendations.push('💧 하루 2L 이상 물을 마시세요 (피부 수분 유지)');

    // 건조 관련 질환과 연계
    if (skinType === '건성') {
      recommendations.push('⚠️ 건성 피부에는 충분한 수분 섭취가 매우 중요합니다');
    }
    if (concerns.includes('건조함')) {
      recommendations.push('🚰 수분 섭취 증가가 피부 건조 개선에 도움됩니다');
    }
  }

  // 3. 스킨케어 제품 분석
  if (skincare && skincare.trim().length > 0) {
    const skincareLC = skincare.toLowerCase();

    // 여드름 피부에 오일 제품 사용 경고
    if ((topDisease && topDisease.toLowerCase().includes('acne')) || concerns.includes('여드름')) {
      if (skincareLC.includes('오일') || skincareLC.includes('oil')) {
        recommendations.push('⚠️ 오일 성분 제품은 여드름을 악화시킬 수 있습니다');
      }
    }

    // 민감성 피부에 강한 성분 경고
    if (skinType === '민감성') {
      if (skincareLC.includes('레티놀') || skincareLC.includes('retinol') ||
          skincareLC.includes('aha') || skincareLC.includes('bha')) {
        recommendations.push('⚠️ 민감성 피부는 강한 성분 사용 시 주의가 필요합니다');
      }
    }
  }

  // 4. AI 예측 질환과 생활 습관 통합 분석
  if (topDisease) {
    const diseaseLC = topDisease.toLowerCase();

    // 아토피/습진: 수면과 스트레스 관리
    if (diseaseLC.includes('dermatitis') || diseaseLC.includes('eczema')) {
      if (sleepHours === '4시간 미만') {
        recommendations.push('⚠️ 아토피/습진은 수면 부족 시 악화될 수 있습니다');
      }
    }

    // 색소침착: 자외선 차단
    if (diseaseLC.includes('pigment') || concerns.includes('색소침착')) {
      recommendations.push('☀️ 자외선 차단제를 매일 사용하세요 (색소침착 예방)');
    }
  }

  return recommendations;
}

/**
 * 생활 습관 기반 상세 점수 계산
 *
 * @param {string} skinType - 피부 타입
 * @param {Array} concerns - 피부 고민
 * @param {string} sleepHours - 수면 시간
 * @param {string} waterIntake - 물 섭취량
 * @returns {Object} 상세 점수 객체
 */
function calculateDetailedScores(skinType, concerns, sleepHours, waterIntake) {
  // 기본 점수
  let moisture = estimateMoisture(skinType);
  let elasticity = 70;
  let pores = estimatePores(skinType, concerns);
  let pigmentation = concerns.includes('색소침착') ? 50 : 70;

  // 수면 시간에 따른 탄력 조정
  if (sleepHours === '4시간 미만') {
    elasticity -= 20;
  } else if (sleepHours === '4-6시간') {
    elasticity -= 10;
  } else if (sleepHours === '8시간 이상') {
    elasticity += 5;
  }

  // 물 섭취량에 따른 수분 조정
  if (waterIntake === '500ml 미만') {
    moisture -= 20;
  } else if (waterIntake === '500ml-1L') {
    moisture -= 10;
  } else if (waterIntake === '2L 이상') {
    moisture += 5;
  }

  // 수면 부족 시 색소침착 악화
  if (sleepHours === '4시간 미만') {
    pigmentation -= 10;
  }

  // 점수 범위 제한 (0-100)
  moisture = Math.max(0, Math.min(100, moisture + Math.floor(Math.random() * 10)));
  elasticity = Math.max(0, Math.min(100, elasticity + Math.floor(Math.random() * 10)));
  pores = Math.max(0, Math.min(100, pores + Math.floor(Math.random() * 5)));
  pigmentation = Math.max(0, Math.min(100, pigmentation + Math.floor(Math.random() * 10)));

  return {
    moisture,
    elasticity,
    pores,
    pigmentation
  };
}

module.exports = router;
