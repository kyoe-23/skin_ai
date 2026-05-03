const express  = require('express');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const CLASS_KEY_MAP = {
  '건선':        'psoriasis',
  '아토피피부염': 'atopic_dermatitis',
  '여드름':      'acne',
  '주사':        'rosacea',
  '지루피부염':  'seborrheic',
  '정상':        'normal',
};

// POST /api/records — 분석 결과 저장 (이미지는 이미 Supabase에 업로드된 상태)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { image_url, primary_diagnosis, confidence, differential, gradcam_b64, clinical_ref } = req.body;

    if (!image_url || !primary_diagnosis || confidence == null) {
      return res.status(400).json({ message: '이미지 URL, 진단명, 신뢰도는 필수입니다.' });
    }

    const diagKey = CLASS_KEY_MAP[primary_diagnosis] ?? primary_diagnosis;

    // Grad-CAM base64 → Storage 업로드
    let gradcamUrl = null;
    if (gradcam_b64) {
      const gcBuffer = Buffer.from(gradcam_b64, 'base64');
      const gcPath = `${req.user.user_id}/${Date.now()}_gradcam.png`;
      const { error: gcErr } = await supabase.storage
        .from('skin-images')
        .upload(gcPath, gcBuffer, { contentType: 'image/png', upsert: false });
      if (!gcErr) {
        ({ data: { publicUrl: gradcamUrl } } = supabase.storage.from('skin-images').getPublicUrl(gcPath));
      }
    }

    const { data, error } = await supabase
      .from('analysis_records')
      .insert([{
        user_id:           req.user.user_id,
        image_url,
        is_masked:         true,
        primary_diagnosis: diagKey,
        confidence:        parseFloat(confidence),
        differential:      differential  || null,
        clinical_ref:      clinical_ref  || null,
        gradcam_url:       gradcamUrl,
        status:            'pending',
      }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ record: data });
  } catch (err) {
    console.error('기록 저장 오류:', err);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/records — 내 기록 목록
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analysis_records')
      .select('record_id, image_url, primary_diagnosis, confidence, differential, status, is_correct, user_answer, created_at')
      .eq('user_id', req.user.user_id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ records: data });
  } catch (err) {
    console.error('기록 목록 조회 오류:', err);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/records/:id — 기록 상세
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('analysis_records')
      .select('*')
      .eq('record_id', req.params.id)
      .eq('user_id', req.user.user_id)
      .single();

    if (error || !data) return res.status(404).json({ message: '기록을 찾을 수 없습니다.' });
    res.json({ record: data });
  } catch (err) {
    console.error('기록 상세 조회 오류:', err);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// PATCH /api/records/:id/answer — 유저 답 제출
router.patch('/:id/answer', authenticateToken, async (req, res) => {
  const { user_answer } = req.body;
  if (!user_answer) return res.status(400).json({ message: 'user_answer가 필요합니다.' });

  try {
    const { data: record, error: fetchError } = await supabase
      .from('analysis_records')
      .select('record_id, primary_diagnosis, user_id')
      .eq('record_id', req.params.id)
      .eq('user_id', req.user.user_id)
      .single();

    if (fetchError || !record) return res.status(404).json({ message: '기록을 찾을 수 없습니다.' });

    const is_correct = record.primary_diagnosis
      ? user_answer.trim().toLowerCase() === record.primary_diagnosis.trim().toLowerCase()
      : null;

    const { data, error } = await supabase
      .from('analysis_records')
      .update({ user_answer, is_correct, status: 'completed' })
      .eq('record_id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ record: data });
  } catch (err) {
    console.error('답 제출 오류:', err);
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

module.exports = router;
