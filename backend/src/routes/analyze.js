const express  = require('express');
const multer   = require('multer');
const sharp    = require('sharp');
const crypto   = require('crypto');
const axios    = require('axios');
const FormData = require('form-data');
const { authenticateToken } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { applyMaskingPipeline } = require('../utils/masking');
const { HTTP_STATUS, ERROR_MESSAGES, STORAGE_BUCKETS } = require('../constants');

const FLASK_URL = process.env.AI_SERVICE_URL || `http://localhost:${process.env.FLASK_PORT || 5001}`;

// Supabase Storage URL만 허용 — SSRF 방지
const _isAllowedImageUrl = (url) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  if (!supabaseUrl || !url) return false;
  try {
    const { hostname } = new URL(url);
    const allowedHost = new URL(supabaseUrl).hostname;
    return hostname === allowedHost;
  } catch {
    return false;
  }
};
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png'];

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIME.includes(file.mimetype)) {
      return cb(new Error('JPG, PNG 파일만 허용됩니다.'));
    }
    cb(null, true);
  }
});

// POST /api/analyze/upload
router.post('/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ message: '이미지가 없습니다.' });

    // 1단계: 매직바이트로 실제 이미지 여부 확인
    const buf = file.buffer;
    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
    const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    if (!isJpeg && !isPng) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.IMAGE_INVALID });
    }

    // 2단계: EXIF 완전 제거 + orientation 보정
    const cleanBuf = await sharp(buf)
      .rotate()           // EXIF orientation 보정
      .withMetadata(false) // GPS·기기정보·촬영일시 등 EXIF 전체 제거
      .png()
      .toBuffer();

    const { width, height } = await sharp(cleanBuf).metadata();

    // 3단계: 마스킹 처리
    //   - AI API 연동 후: lesionCoords 또는 lesionMask를 API 응답에서 추출해 전달
    //   - 현재: 상하단 8% 라벨 영역만 블랙 마스킹 적용
    const processed = await applyMaskingPipeline(cleanBuf, {
      width,
      height,
      lesionCoords: null,  // TODO: AI API 응답 좌표 연결 — [{ x, y, w, h }, ...]
      lesionMask:   null,  // TODO: AI API 응답 폴리곤 연결 — [{ x, y }, ...]
    });

    // 4단계: Supabase Storage 업로드 (비식별 UUID 파일명)
    const userId  = req.user.user_id;
    const filename = `${userId}/${crypto.randomUUID()}.png`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKETS.SKIN_IMAGES)
      .upload(filename, processed, { contentType: 'image/png', upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKETS.SKIN_IMAGES)
      .getPublicUrl(filename);

    const imageUrl = urlData.publicUrl;

    res.json({ imageUrl });

  } catch (err) {
    console.error('[analyze/upload]', err);

    if (err.message && err.message.includes('파일만 허용')) {
      return res.status(400).json({ message: err.message });
    }
    res.status(500).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// POST /api/analyze/run — Flask AI 서버 프록시
router.post('/run', authenticateToken, async (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) return res.status(400).json({ success: false, error: 'imageUrl이 필요합니다.' });
  if (!_isAllowedImageUrl(imageUrl)) {
    return res.status(400).json({ success: false, error: '허용되지 않은 이미지 URL입니다.' });
  }

  try {
    const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000 });
    const form = new FormData();
    form.append('image', Buffer.from(imgRes.data), { filename: 'image.png', contentType: 'image/png' });

    const flaskRes = await axios.post(`${FLASK_URL}/predict`, form, {
      headers: form.getHeaders(),
      timeout: 300000,
    });
    res.json(flaskRes.data);
  } catch (err) {
    console.error('[analyze/run]', err.message);
    if (err.code === 'ECONNREFUSED') {
      res.status(503).json({ success: false, error: 'AI 분석 서버가 실행 중이지 않습니다. 서버를 시작해 주세요.' });
    } else if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      res.status(504).json({ success: false, error: 'AI 분석 서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' });
    } else {
      res.status(502).json({ success: false, error: 'AI 서버와 통신에 실패했습니다.' });
    }
  }
});

// POST /api/analyze/report — LLM 리포트 생성 프록시 (분석 완료 후 비동기 호출)
router.post('/report', authenticateToken, async (req, res) => {
  try {
    const flaskRes = await axios.post(`${FLASK_URL}/report`, req.body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000,
    });
    res.json(flaskRes.data);
  } catch (err) {
    console.error('[analyze/report]', err.message);
    res.status(502).json({ success: false, error: 'AI 서버와 통신에 실패했습니다.' });
  }
});

// POST /api/analyze/chat — LLM 채팅 프록시
router.post('/chat', authenticateToken, async (req, res) => {
  const { question, context, history, imageUrl } = req.body;
  if (!question) return res.status(400).json({ success: false, error: 'question이 필요합니다.' });
  try {
    const flaskRes = await axios.post(`${FLASK_URL}/chat`, {
      question,
      context: context || {},
      history: history || [],
      ...(imageUrl && { image_url: imageUrl }),
    }, { timeout: 60000 });
    res.json(flaskRes.data);
  } catch (err) {
    console.error('[analyze/chat]', err.message);
    res.status(502).json({ success: false, error: 'AI 서버와 통신에 실패했습니다.' });
  }
});

// GET /api/analyze/records — 내 분석 기록 조회 (CSV 내보내기용)
router.get('/records', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analysis_records')
      .select('*')
      .eq('user_id', req.user.user_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ records: data || [] });
  } catch (err) {
    console.error('[analyze/records GET]', err);
    res.status(500).json({ message: '기록 조회 중 오류가 발생했습니다.' });
  }
});

// DELETE /api/analyze/records — 내 분석 기록 전체 삭제
router.delete('/records', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;
  try {
    // DB 레코드 삭제
    const { error: deleteErr } = await supabase
      .from('analysis_records')
      .delete()
      .eq('user_id', userId);

    if (deleteErr) throw deleteErr;

    // Storage 이미지 삭제 (폴더 단위)
    const { data: files } = await supabase.storage
      .from(STORAGE_BUCKETS.SKIN_IMAGES)
      .list(String(userId));

    if (files && files.length > 0) {
      const paths = files.map(f => `${userId}/${f.name}`);
      await supabase.storage.from(STORAGE_BUCKETS.SKIN_IMAGES).remove(paths);
    }

    res.json({ message: '학습 기록이 초기화되었습니다.' });
  } catch (err) {
    console.error('[analyze/records DELETE]', err);
    res.status(500).json({ message: '기록 삭제 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
