const express = require('express');
const multer  = require('multer');
const sharp   = require('sharp');
const crypto  = require('crypto');

const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const { revokeSession, revokeAllSessions } = require('../utils/sessions');
const {
  HTTP_STATUS, ERROR_MESSAGES, STORAGE_BUCKETS, USER_ROLES,
} = require('../constants');

const router = express.Router();

// ─────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────
const AVATAR_MAX_BYTES   = Number(process.env.AVATAR_MAX_BYTES   || 5 * 1024 * 1024);
const AVATAR_RESIZE_PX   = Number(process.env.AVATAR_RESIZE_PX   || 256);
const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const PROFILE_EDITABLE_FIELDS = ['name', 'role', 'affiliation', 'department', 'year', 'bio'];
const NOTIFICATION_FIELDS = [
  'notify_email', 'notify_marketing', 'notify_record_done', 'notify_weekly',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_AVATAR_MIME.includes(file.mimetype)) {
      return cb(new Error(ERROR_MESSAGES.IMAGE_INVALID));
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────────────
// GET /api/users/me — 현재 사용자 프로필
// ─────────────────────────────────────────────────────
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id, name, email, role, affiliation, department, year, bio, avatar_url, created_at')
      .eq('user_id', req.user.user_id)
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) {
    console.error('[users/me GET]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P1/S2 — PATCH /api/users/me — 프로필 수정
// ─────────────────────────────────────────────────────
router.patch('/me', authenticateToken, async (req, res) => {
  // 허용된 필드만 화이트리스트 처리
  const updates = {};
  for (const f of PROFILE_EDITABLE_FIELDS) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }
  if (updates.role && !USER_ROLES.includes(updates.role)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: '유효하지 않은 역할입니다.' });
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('user_id', req.user.user_id)
      .select('user_id, name, email, role, affiliation, department, year, bio, avatar_url')
      .single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) {
    console.error('[users/me PATCH]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P2 — POST /api/users/me/avatar — 아바타 업로드
// ─────────────────────────────────────────────────────
router.post('/me/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.IMAGE_MISSING });
  }

  try {
    // EXIF 제거 + 정사각형 리사이즈 + WebP
    const buf = await sharp(req.file.buffer)
      .rotate()
      .resize(AVATAR_RESIZE_PX, AVATAR_RESIZE_PX, { fit: 'cover' })
      .withMetadata(false)
      .webp({ quality: 88 })
      .toBuffer();

    const path = `${req.user.user_id}/${crypto.randomUUID()}.webp`;
    const { error: upErr } = await supabase.storage
      .from(STORAGE_BUCKETS.AVATARS)
      .upload(path, buf, { contentType: 'image/webp', upsert: false });
    if (upErr) throw upErr;

    const { data: { publicUrl } } = supabase.storage
      .from(STORAGE_BUCKETS.AVATARS).getPublicUrl(path);

    const { error: dbErr } = await supabase
      .from('users').update({ avatar_url: publicUrl }).eq('user_id', req.user.user_id);
    if (dbErr) throw dbErr;

    res.json({ avatar_url: publicUrl });
  } catch (err) {
    console.error('[users/me/avatar]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// 아바타 제거
router.delete('/me/avatar', authenticateToken, async (req, res) => {
  try {
    const { error } = await supabase
      .from('users').update({ avatar_url: null }).eq('user_id', req.user.user_id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[users/me/avatar DELETE]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P6 — 알림 설정
// ─────────────────────────────────────────────────────
router.get('/me/notifications', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notification_preferences').select('*').eq('user_id', req.user.user_id).maybeSingle();
    if (error) throw error;

    // 행이 없으면 기본값 반환 (테이블 DEFAULT 와 동기화)
    const defaults = {
      notify_email: true, notify_marketing: false,
      notify_record_done: true, notify_weekly: true,
    };
    res.json({ preferences: data || defaults });
  } catch (err) {
    console.error('[users/me/notifications GET]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

router.patch('/me/notifications', authenticateToken, async (req, res) => {
  const updates = {};
  for (const f of NOTIFICATION_FIELDS) {
    if (typeof req.body[f] === 'boolean') updates[f] = req.body[f];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }

  try {
    // UPSERT — 행이 없으면 생성, 있으면 갱신
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: req.user.user_id, ...updates }, { onConflict: 'user_id' })
      .select()
      .single();
    if (error) throw error;
    res.json({ preferences: data });
  } catch (err) {
    console.error('[users/me/notifications PATCH]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P5 / P8 — 세션 관리
// ─────────────────────────────────────────────────────
router.get('/me/sessions', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_sessions')
      .select('session_id, device_label, user_agent, ip_address, created_at, last_seen_at')
      .eq('user_id', req.user.user_id)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: false });
    if (error) throw error;

    const sessions = (data || []).map(s => ({
      ...s,
      is_current: s.session_id === req.user.session_id,
    }));
    res.json({ sessions });
  } catch (err) {
    console.error('[users/me/sessions]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// 특정 세션 종료
router.delete('/me/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { data: target, error: fetchErr } = await supabase
      .from('user_sessions')
      .select('user_id')
      .eq('session_id', req.params.sessionId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!target || target.user_id !== req.user.user_id) {
      return res.status(HTTP_STATUS.FORBIDDEN).json({ message: ERROR_MESSAGES.NOT_OWNER });
    }
    await revokeSession(req.params.sessionId);
    res.json({ success: true });
  } catch (err) {
    console.error('[users/me/sessions DELETE]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// 모든 기기 로그아웃 (현재 세션 포함)
router.post('/me/logout-all', authenticateToken, async (req, res) => {
  try {
    await revokeAllSessions(req.user.user_id);
    res.json({ message: '모든 기기에서 로그아웃되었습니다.' });
  } catch (err) {
    console.error('[users/me/logout-all]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

module.exports = router;
