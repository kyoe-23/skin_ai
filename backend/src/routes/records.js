const express  = require('express');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const {
  HTTP_STATUS, ERROR_MESSAGES, STORAGE_BUCKETS, DISEASE_KEY_MAP,
} = require('../constants');

const router = express.Router();

// ─────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────

// Supabase getPublicUrl 결과에서 버킷 내부 경로 추출
const _extractStoragePath = (publicUrl, bucket) => {
  if (!publicUrl) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(publicUrl.substring(idx + marker.length));
};

// 분석 기록 owner 검증 후 row 반환
const _fetchOwnedRecord = async (recordId, userId, columns = '*') => {
  const { data, error } = await supabase
    .from('analysis_records')
    .select(columns)
    .eq('record_id', recordId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

// ─────────────────────────────────────────────────────
// POST /api/records — 분석 결과 저장
// ─────────────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { image_url, primary_diagnosis, confidence, differential,
            gradcam_b64, clinical_ref, ai_findings, chat_history } = req.body;

    if (!image_url || !primary_diagnosis || confidence == null) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
    }

    const diagKey = DISEASE_KEY_MAP[primary_diagnosis] ?? primary_diagnosis;

    // 1단계 — DB 행 먼저 생성 (record_id 확보)
    const { data: created, error: insertErr } = await supabase
      .from('analysis_records')
      .insert([{
        user_id:           req.user.user_id,
        image_url,
        is_masked:         true,
        primary_diagnosis: diagKey,
        confidence:        parseFloat(confidence),
        differential:      differential || null,
        clinical_ref:      clinical_ref || null,
        ai_findings:       ai_findings  || null,
        chat_history:      (chat_history && chat_history.length > 0) ? chat_history : null,
        status:            'pending',
      }])
      .select()
      .single();
    if (insertErr) throw insertErr;

    // 2단계 — Grad-CAM 업로드 (B3 수정: record_id 기반 파일명 → 충돌 방지)
    let gradcamUrl = null;
    if (gradcam_b64) {
      const gcBuf = Buffer.from(gradcam_b64, 'base64');
      const gcPath = `${req.user.user_id}/${created.record_id}.png`;

      // gradcam 버킷이 존재하면 사용, 없으면 skin-images로 fallback (마이그레이션 단계적 적용용)
      const bucket = STORAGE_BUCKETS.GRADCAM;
      const { error: gcErr } = await supabase.storage
        .from(bucket).upload(gcPath, gcBuf, { contentType: 'image/png', upsert: true });

      if (!gcErr) {
        ({ data: { publicUrl: gradcamUrl } } = supabase.storage.from(bucket).getPublicUrl(gcPath));
        await supabase
          .from('analysis_records').update({ gradcam_url: gradcamUrl }).eq('record_id', created.record_id);
      } else if (gcErr.message?.toLowerCase().includes('bucket')) {
        // gradcam 버킷 미존재 — skin-images 로 fallback
        const fbBucket = STORAGE_BUCKETS.SKIN_IMAGES;
        const { error: fbErr } = await supabase.storage
          .from(fbBucket).upload(gcPath, gcBuf, { contentType: 'image/png', upsert: true });
        if (!fbErr) {
          ({ data: { publicUrl: gradcamUrl } } = supabase.storage.from(fbBucket).getPublicUrl(gcPath));
          await supabase
            .from('analysis_records').update({ gradcam_url: gradcamUrl }).eq('record_id', created.record_id);
        }
      }
    }

    res.status(HTTP_STATUS.CREATED).json({ record: { ...created, gradcam_url: gradcamUrl } });
  } catch (err) {
    console.error('기록 저장 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/records — 내 기록 목록
// ─────────────────────────────────────────────────────
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
    console.error('기록 목록 조회 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/records/bookmarks — 북마크된 기록 목록 (반드시 /:id 보다 먼저 등록)
// ─────────────────────────────────────────────────────
router.get('/bookmarks', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('record_id, created_at, analysis_records!inner(record_id, image_url, primary_diagnosis, confidence, created_at)')
      .eq('user_id', req.user.user_id)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ bookmarks: data });
  } catch (err) {
    console.error('북마크 목록 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// GET /api/records/:id — 기록 상세 (북마크 여부 포함)
// ─────────────────────────────────────────────────────
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const record = await _fetchOwnedRecord(req.params.id, req.user.user_id);
    if (!record) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: ERROR_MESSAGES.RECORD_NOT_FOUND });

    const { data: bm } = await supabase
      .from('bookmarks')
      .select('bookmark_id')
      .eq('user_id', req.user.user_id)
      .eq('record_id', req.params.id)
      .maybeSingle();

    res.json({ record: { ...record, is_bookmarked: !!bm } });
  } catch (err) {
    console.error('기록 상세 조회 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// DELETE /api/records/:id — 기록 + Storage 객체 삭제 (B2 수정)
// ─────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const record = await _fetchOwnedRecord(
      req.params.id, req.user.user_id,
      'record_id, image_url, gradcam_url',
    );
    if (!record) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: ERROR_MESSAGES.RECORD_NOT_FOUND });

    // Storage 객체 삭제 — 버킷별로 분리해 batch remove
    const removals = [
      { bucket: STORAGE_BUCKETS.SKIN_IMAGES, url: record.image_url },
      { bucket: STORAGE_BUCKETS.GRADCAM,     url: record.gradcam_url },
      // gradcam 버킷 미사용 시 skin-images 에 있을 수 있으므로 양쪽 시도
      { bucket: STORAGE_BUCKETS.SKIN_IMAGES, url: record.gradcam_url },
    ];

    for (const { bucket, url } of removals) {
      const path = _extractStoragePath(url, bucket);
      if (path) {
        try { await supabase.storage.from(bucket).remove([path]); }
        catch (_) { /* 객체 없음 등 무시 */ }
      }
    }

    const { error } = await supabase
      .from('analysis_records')
      .delete()
      .eq('record_id', req.params.id)
      .eq('user_id', req.user.user_id);
    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('기록 삭제 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// PATCH /api/records/:id/chat — 채팅 메시지 append
// (race condition 한계는 part10 §개선사항 B4 참조)
// ─────────────────────────────────────────────────────
router.patch('/:id/chat', authenticateToken, async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'messages 배열이 필요합니다.' });
  }

  try {
    const record = await _fetchOwnedRecord(req.params.id, req.user.user_id, 'record_id, chat_history');
    if (!record) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: ERROR_MESSAGES.RECORD_NOT_FOUND });

    const updated = [...(record.chat_history || []), ...messages];

    const { error } = await supabase
      .from('analysis_records').update({ chat_history: updated }).eq('record_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('채팅 기록 저장 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// PATCH /api/records/:id/answer — 유저 답 제출
// ─────────────────────────────────────────────────────
router.patch('/:id/answer', authenticateToken, async (req, res) => {
  const { user_answer } = req.body;
  if (!user_answer) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: 'user_answer가 필요합니다.' });

  try {
    const record = await _fetchOwnedRecord(
      req.params.id, req.user.user_id, 'record_id, primary_diagnosis',
    );
    if (!record) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: ERROR_MESSAGES.RECORD_NOT_FOUND });

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
    console.error('답 제출 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// R1 — 북마크 토글 / 조회
// ─────────────────────────────────────────────────────
router.post('/:id/bookmark', authenticateToken, async (req, res) => {
  try {
    const record = await _fetchOwnedRecord(req.params.id, req.user.user_id, 'record_id');
    if (!record) return res.status(HTTP_STATUS.NOT_FOUND).json({ message: ERROR_MESSAGES.RECORD_NOT_FOUND });

    const { error } = await supabase
      .from('bookmarks')
      .upsert({ user_id: req.user.user_id, record_id: req.params.id }, { onConflict: 'user_id,record_id' });
    if (error) throw error;
    res.status(HTTP_STATUS.CREATED).json({ is_bookmarked: true });
  } catch (err) {
    console.error('북마크 추가 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

router.delete('/:id/bookmark', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', req.user.user_id)
      .eq('record_id', req.params.id);
    if (error) throw error;
    res.json({ is_bookmarked: false });
  } catch (err) {
    console.error('북마크 삭제 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

module.exports = router;
