const express  = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const nodemailer = require('nodemailer');
const supabase  = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// 비밀번호 재설정 토큰 저장소 (메모리) — token → { email, expires }
const resetTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of resetTokens) {
    if (data.expires < now) resetTokens.delete(token);
  }
}, 10 * 60 * 1000);

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// 회원가입
router.post('/signup', async (req, res) => {
  const { name, email, password, role, affiliation, year } = req.body;

  if (!name || !email || !password || !role || !affiliation) {
    return res.status(400).json({ message: '필수 항목을 모두 입력해주세요.' });
  }

  try {
    const { data: existing } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(409).json({ message: '이미 가입된 이메일입니다.' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from('users')
      .insert([{ name, email, password_hash, role, affiliation, year }])
      .select()
      .single();

    if (error) throw error;

    const token = jwt.sign(
      { user_id: data.user_id, role: data.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.status(201).json({
      message: '회원가입이 완료됐습니다.',
      token,
      user: {
        user_id: data.user_id,
        name: data.name,
        email: data.email,
        role: data.role,
        affiliation: data.affiliation,
      },
    });

  } catch (err) {
    console.error('signup 오류:', err.message);
    return res.status(500).json({ message: err.message });
  }
});

// 이메일 중복 확인
router.get('/check-email', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });

  try {
    const { data } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email)
      .single();
    return res.json({ exists: !!data });
  } catch {
    return res.json({ exists: false });
  }
});

// 로그인
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: '이메일과 비밀번호를 입력해주세요.' });
  }

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    return res.json({
      message: '로그인 성공',
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role,
        affiliation: user.affiliation,
      },
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// 비밀번호 찾기: 재설정 링크 발송
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: '이메일을 입력해주세요.' });

  try {
    const { data: user } = await supabase
      .from('users')
      .select('name')
      .eq('email', email)
      .single();

    // 이메일 존재 여부 노출 방지 — 항상 성공 응답
    if (!user) {
      return res.json({ message: '재설정 링크를 발송했습니다.' });
    }

    for (const [token, data] of resetTokens) {
      if (data.email === email) resetTokens.delete(token);
    }

    const token = crypto.randomBytes(32).toString('hex');
    resetTokens.set(token, { email, expires: Date.now() + 15 * 60 * 1000 });

    const resetLink = `${process.env.FRONTEND_URL}/reset_password.html?token=${token}`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.SMTP_USER,
      to:   email,
      subject: '[SkinAI] 비밀번호 재설정 안내',
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 28px;border:1px solid #e5e7eb;border-radius:16px;">
          <div style="text-align:center;margin-bottom:28px;">
            <span style="font-size:22px;font-weight:800;color:#1a1a2e;">Skin<span style="color:#2563eb;">AI</span></span>
          </div>
          <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">비밀번호 재설정</h2>
          <p style="color:#6b7280;font-size:14px;line-height:1.7;margin-bottom:28px;">
            안녕하세요, <strong>${user.name}</strong>님.<br>
            아래 버튼을 클릭하여 새 비밀번호를 설정하세요.<br>
            이 링크는 <strong>15분</strong> 후 만료됩니다.
          </p>
          <a href="${resetLink}"
             style="display:block;text-align:center;background:#2563eb;color:#fff;padding:14px 24px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none;margin-bottom:24px;">
            비밀번호 재설정하기
          </a>
          <p style="font-size:12px;color:#9ca3af;line-height:1.6;">
            버튼이 클릭되지 않으면 아래 링크를 복사하여 브라우저에 붙여넣으세요.<br>
            <a href="${resetLink}" style="color:#2563eb;word-break:break-all;">${resetLink}</a>
          </p>
          <hr style="border:none;border-top:1px solid #f3f4f6;margin:20px 0;">
          <p style="font-size:12px;color:#c4cad4;text-align:center;">
            본인이 요청하지 않은 경우 이 메일을 무시하세요.
          </p>
        </div>
      `,
    });

    return res.json({ message: '재설정 링크를 발송했습니다.' });

  } catch (err) {
    console.error('forgot-password 오류:', err.message);
    return res.status(500).json({ message: '메일 발송 중 오류가 발생했습니다: ' + err.message });
  }
});

// 비밀번호 재설정: 토큰 유효성 확인
router.get('/verify-reset-token', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ valid: false });

  const data = resetTokens.get(token);
  if (!data || data.expires < Date.now()) {
    return res.status(400).json({ valid: false, message: '링크가 만료되었거나 유효하지 않습니다.' });
  }
  return res.json({ valid: true });
});

// 비밀번호 재설정: 새 비밀번호 저장
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  if (!token || !password) {
    return res.status(400).json({ message: '토큰과 새 비밀번호를 입력해주세요.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: '비밀번호는 8자 이상이어야 합니다.' });
  }

  const data = resetTokens.get(token);
  if (!data || data.expires < Date.now()) {
    return res.status(400).json({ message: '링크가 만료되었거나 이미 사용된 링크입니다.' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);

    const { error } = await supabase
      .from('users')
      .update({ password_hash })
      .eq('email', data.email);

    if (error) throw error;

    resetTokens.delete(token);
    return res.json({ message: '비밀번호가 성공적으로 변경되었습니다.' });

  } catch (err) {
    console.error('reset-password 오류:', err.message);
    return res.status(500).json({ message: '비밀번호 변경 중 오류가 발생했습니다.' });
  }
});

// 회원 탈퇴 — 유저 데이터 전체 삭제
router.delete('/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.user_id;

  try {
    // 1. Storage 이미지 삭제
    const { data: files } = await supabase.storage
      .from('skin-images')
      .list(String(userId));

    if (files && files.length > 0) {
      const paths = files.map(f => `${userId}/${f.name}`);
      await supabase.storage.from('skin-images').remove(paths);
    }

    // 2. 분석 기록 삭제
    await supabase.from('analysis_records').delete().eq('user_id', userId);

    // 3. 커뮤니티 데이터 삭제 (테이블이 있는 경우)
    try {
      await supabase.from('comments').delete().eq('user_id', userId);
      await supabase.from('posts').delete().eq('user_id', userId);
    } catch (_) { /* 테이블 미존재 시 무시 */ }

    // 4. 유저 계정 삭제
    const { error } = await supabase.from('users').delete().eq('user_id', userId);
    if (error) throw error;

    return res.json({ message: '계정이 삭제되었습니다.' });

  } catch (err) {
    console.error('[auth/withdraw]', err.message);
    return res.status(500).json({ message: '탈퇴 처리 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
