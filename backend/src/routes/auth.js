const express   = require('express');
const bcrypt    = require('bcryptjs');
const crypto    = require('crypto');
const nodemailer = require('nodemailer');

const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  HTTP_STATUS, ERROR_MESSAGES, AUTH_CONFIG, STORAGE_BUCKETS,
} = require('../constants');
const {
  issueTokenAndSession, revokeSession, revokeAllSessions,
} = require('../utils/sessions');

const router = express.Router();

// ─────────────────────────────────────────────────────
// 헬퍼 — 토큰·코드 행이 활성(미만료 + 미사용)인지 검증
// ─────────────────────────────────────────────────────
const _isExpired = (isoStr) => !isoStr || new Date(isoStr) < new Date();

// ─────────────────────────────────────────────────────
// SMTP
// ─────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const _emailFromAddress = () => process.env.EMAIL_FROM || process.env.SMTP_USER;

const _sendPasswordResetMail = (toEmail, name, resetLink) => transporter.sendMail({
  from: _emailFromAddress(),
  to:   toEmail,
  subject: '[SkinAI] 비밀번호 재설정 안내',
  html: `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 28px;border:1px solid #e5e7eb;border-radius:16px;">
      <div style="text-align:center;margin-bottom:28px;">
        <span style="font-size:22px;font-weight:800;color:#1a1a2e;">Skin<span style="color:#2563eb;">AI</span></span>
      </div>
      <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">비밀번호 재설정</h2>
      <p style="color:#6b7280;font-size:14px;line-height:1.7;margin-bottom:28px;">
        안녕하세요, <strong>${name}</strong>님.<br>
        아래 버튼을 클릭하여 새 비밀번호를 설정하세요.<br>
        이 링크는 <strong>${AUTH_CONFIG.PASSWORD_RESET_TTL_MS / 60000}분</strong> 후 만료됩니다.
      </p>
      <a href="${resetLink}" style="display:block;text-align:center;background:#2563eb;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:24px;">비밀번호 재설정하기</a>
      <p style="font-size:12px;color:#9ca3af;line-height:1.6;">
        버튼이 클릭되지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요.<br>
        <a href="${resetLink}" style="color:#2563eb;word-break:break-all;">${resetLink}</a>
      </p>
    </div>`,
});

const _sendEmailChangeCodeMail = (toEmail, code) => transporter.sendMail({
  from: _emailFromAddress(),
  to:   toEmail,
  subject: '[SkinAI] 이메일 변경 인증 코드',
  html: `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 28px;border:1px solid #e5e7eb;border-radius:16px;">
      <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:14px;">이메일 변경 인증</h2>
      <p style="color:#6b7280;font-size:14px;line-height:1.7;margin-bottom:20px;">
        아래 6자리 코드를 입력해 이메일 변경을 완료하세요.<br>
        이 코드는 <strong>${AUTH_CONFIG.EMAIL_CODE_TTL_MS / 60000}분</strong> 후 만료됩니다.
      </p>
      <div style="text-align:center;font-size:36px;font-weight:800;letter-spacing:12px;color:#2563eb;padding:24px;background:#f3f4f6;border-radius:12px;">${code}</div>
    </div>`,
});

// ─────────────────────────────────────────────────────
// 회원가입
// ─────────────────────────────────────────────────────
router.post('/signup', authLimiter, async (req, res) => {
  const { name, email, password, role, affiliation, year, bio } = req.body;

  if (!name || !email || !password || !role || !affiliation) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }
  if (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.PASSWORD_TOO_SHORT });
  }

  try {
    const { data: existing } = await supabase
      .from('users').select('user_id').eq('email', email).maybeSingle();

    if (existing) {
      return res.status(HTTP_STATUS.CONFLICT).json({ message: ERROR_MESSAGES.EMAIL_DUPLICATE });
    }

    const password_hash = await bcrypt.hash(password, AUTH_CONFIG.BCRYPT_ROUNDS);

    const { data: user, error } = await supabase
      .from('users')
      .insert([{ name, email, password_hash, role, affiliation, year, bio: bio || null }])
      .select()
      .single();
    if (error) throw error;

    const { token } = await issueTokenAndSession({
      userId: user.user_id, role: user.role, req,
    });

    return res.status(HTTP_STATUS.CREATED).json({
      message: '회원가입이 완료됐습니다.',
      token,
      user: {
        user_id:     user.user_id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        affiliation: user.affiliation,
      },
    });
  } catch (err) {
    console.error('signup 오류:', err.message);
    return res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// 이메일 중복 확인
// ─────────────────────────────────────────────────────
router.get('/check-email', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.EMAIL_REQUIRED });

  try {
    const { data } = await supabase.from('users').select('user_id').eq('email', email).maybeSingle();
    return res.json({ exists: !!data });
  } catch {
    return res.json({ exists: false });
  }
});

// ─────────────────────────────────────────────────────
// 로그인
// ─────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }

  try {
    const { data: user } = await supabase
      .from('users').select('*').eq('email', email).maybeSingle();

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: ERROR_MESSAGES.LOGIN_INVALID });
    }

    const { token } = await issueTokenAndSession({
      userId: user.user_id, role: user.role, req,
    });

    return res.json({
      message: '로그인 성공',
      token,
      user: {
        user_id:     user.user_id,
        name:        user.name,
        email:       user.email,
        role:        user.role,
        affiliation: user.affiliation,
      },
    });
  } catch (err) {
    console.error('login 오류:', err.message);
    return res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// 로그아웃 (현재 세션만)
// ─────────────────────────────────────────────────────
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    await revokeSession(req.user.session_id);
    res.json({ message: '로그아웃되었습니다.' });
  } catch (err) {
    console.error('logout 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// 비밀번호 찾기 — 재설정 링크 발송
// ─────────────────────────────────────────────────────
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.EMAIL_REQUIRED });

  try {
    const { data: user } = await supabase
      .from('users').select('user_id, name').eq('email', email).maybeSingle();

    // 이메일 존재 여부 노출 방지 — 항상 동일 응답
    if (!user) return res.json({ message: ERROR_MESSAGES.RESET_SENT });

    // 동일 유저의 기존 미사용 토큰 정리 (rolling token 정책)
    await supabase.from('password_reset_tokens')
      .delete().eq('user_id', user.user_id).is('used_at', null);

    const token = crypto.randomBytes(32).toString('hex');
    const expires_at = new Date(Date.now() + AUTH_CONFIG.PASSWORD_RESET_TTL_MS).toISOString();

    const { error: insErr } = await supabase
      .from('password_reset_tokens')
      .insert([{ token, user_id: user.user_id, expires_at }]);
    if (insErr) throw insErr;

    const resetLink = `${process.env.FRONTEND_URL}/reset_password.html?token=${token}`;
    await _sendPasswordResetMail(email, user.name, resetLink);

    return res.json({ message: ERROR_MESSAGES.RESET_SENT });
  } catch (err) {
    console.error('forgot-password 오류:', err.message);
    return res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

router.get('/verify-reset-token', async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      valid: false, message: ERROR_MESSAGES.RESET_LINK_INVALID,
    });
  }

  try {
    const { data } = await supabase
      .from('password_reset_tokens')
      .select('expires_at, used_at')
      .eq('token', token)
      .maybeSingle();

    if (!data || data.used_at || _isExpired(data.expires_at)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({
        valid: false, message: ERROR_MESSAGES.RESET_LINK_INVALID,
      });
    }
    return res.json({ valid: true });
  } catch (err) {
    console.error('verify-reset-token 오류:', err.message);
    return res.status(HTTP_STATUS.SERVER_ERROR).json({ valid: false });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }
  if (password.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.PASSWORD_TOO_SHORT });
  }

  try {
    const { data: row, error: fetchErr } = await supabase
      .from('password_reset_tokens')
      .select('user_id, expires_at, used_at')
      .eq('token', token)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (!row || row.used_at || _isExpired(row.expires_at)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.RESET_LINK_INVALID });
    }

    const password_hash = await bcrypt.hash(password, AUTH_CONFIG.BCRYPT_ROUNDS);
    const { error: updErr } = await supabase
      .from('users')
      .update({ password_hash, password_changed_at: new Date().toISOString() })
      .eq('user_id', row.user_id);
    if (updErr) throw updErr;

    // 1회용 보장 — used_at 세팅
    await supabase
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token);

    // 모든 기존 세션 무효화 (탈취 대응)
    await revokeAllSessions(row.user_id);

    return res.json({ message: '비밀번호가 성공적으로 변경되었습니다.' });
  } catch (err) {
    console.error('reset-password 오류:', err.message);
    return res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P3 — 비밀번호 변경 (로그인 상태)
// ─────────────────────────────────────────────────────
router.post('/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.REQUIRED_FIELDS });
  }
  if (newPassword.length < AUTH_CONFIG.PASSWORD_MIN_LENGTH) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.PASSWORD_TOO_SHORT });
  }

  try {
    const { data: user, error: fetchErr } = await supabase
      .from('users').select('password_hash').eq('user_id', req.user.user_id).single();
    if (fetchErr || !user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: ERROR_MESSAGES.AUTH_REQUIRED });
    }

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ message: ERROR_MESSAGES.PASSWORD_MISMATCH });
    }

    const sameAsOld = await bcrypt.compare(newPassword, user.password_hash);
    if (sameAsOld) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.PASSWORD_SAME });
    }

    const password_hash = await bcrypt.hash(newPassword, AUTH_CONFIG.BCRYPT_ROUNDS);
    const { error: updErr } = await supabase
      .from('users')
      .update({ password_hash, password_changed_at: new Date().toISOString() })
      .eq('user_id', req.user.user_id);
    if (updErr) throw updErr;

    // 다른 모든 세션 무효화 — 현재 세션은 유지하기 위해 새 토큰 발급
    await revokeAllSessions(req.user.user_id, req.user.session_id);

    res.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    console.error('change-password 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// P4 — 이메일 변경 인증 코드 발송
// ─────────────────────────────────────────────────────
router.post('/email/send-code', authenticateToken, async (req, res) => {
  const { newEmail } = req.body;
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.EMAIL_INVALID });
  }

  try {
    const { data: dup } = await supabase
      .from('users').select('user_id').eq('email', newEmail).maybeSingle();
    if (dup) {
      return res.status(HTTP_STATUS.CONFLICT).json({ message: ERROR_MESSAGES.EMAIL_DUPLICATE });
    }

    // 동일 유저의 미인증 코드 정리 (새 코드 발급 시 이전 invalidate)
    await supabase.from('email_verification_codes')
      .delete().eq('user_id', req.user.user_id).is('verified_at', null);

    // 6자리 코드 생성 — crypto 기반
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(AUTH_CONFIG.EMAIL_CODE_LENGTH, '0');
    const expires_at = new Date(Date.now() + AUTH_CONFIG.EMAIL_CODE_TTL_MS).toISOString();

    const { error: insErr } = await supabase
      .from('email_verification_codes')
      .insert([{ user_id: req.user.user_id, email: newEmail, code, expires_at }]);
    if (insErr) throw insErr;

    await _sendEmailChangeCodeMail(newEmail, code);
    res.json({ message: '인증 코드를 발송했습니다.' });
  } catch (err) {
    console.error('email/send-code 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// 코드 검증 후 이메일 변경 적용
router.post('/email/verify-code', authenticateToken, async (req, res) => {
  const { code } = req.body;
  if (!code || String(code).length !== AUTH_CONFIG.EMAIL_CODE_LENGTH) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.CODE_LENGTH });
  }

  try {
    const { data: row, error: fetchErr } = await supabase
      .from('email_verification_codes')
      .select('id, email, expires_at')
      .eq('user_id', req.user.user_id)
      .eq('code', String(code))
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    if (!row || _isExpired(row.expires_at)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ message: ERROR_MESSAGES.CODE_INVALID });
    }

    // 이메일 적용
    const { error: updErr } = await supabase
      .from('users').update({ email: row.email }).eq('user_id', req.user.user_id);
    if (updErr) throw updErr;

    // 코드 사용 처리 (1회용)
    await supabase.from('email_verification_codes')
      .update({ verified_at: new Date().toISOString() }).eq('id', row.id);

    res.json({ message: '이메일이 변경되었습니다.', email: row.email });
  } catch (err) {
    console.error('email/verify-code 오류:', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.SERVER_ERROR });
  }
});

// ─────────────────────────────────────────────────────
// 회원 탈퇴
// ─────────────────────────────────────────────────────
router.delete('/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;
  try {
    // 1. Storage 이미지 삭제 (skin-images 버킷의 유저 폴더)
    const { data: files } = await supabase.storage
      .from(STORAGE_BUCKETS.SKIN_IMAGES).list(String(userId));
    if (files && files.length > 0) {
      const paths = files.map(f => `${userId}/${f.name}`);
      await supabase.storage.from(STORAGE_BUCKETS.SKIN_IMAGES).remove(paths);
    }

    // 2. ON DELETE CASCADE 가 걸려 있으면 users 삭제만으로 연관 행 정리됨.
    //    안전망으로 명시적 삭제 — 커뮤니티는 best-effort
    await supabase.from('analysis_records').delete().eq('user_id', userId);
    try {
      await supabase.from('comments').delete().eq('user_id', userId);
      await supabase.from('posts').delete().eq('user_id', userId);
    } catch (_) { /* 테이블 미존재 시 무시 */ }

    const { error } = await supabase.from('users').delete().eq('user_id', userId);
    if (error) throw error;

    res.json({ message: '계정이 삭제되었습니다.' });
  } catch (err) {
    console.error('[auth/withdraw]', err.message);
    res.status(HTTP_STATUS.SERVER_ERROR).json({ message: ERROR_MESSAGES.WITHDRAW_FAIL });
  }
});

module.exports = router;
