document.addEventListener('DOMContentLoaded', () => {

  // ── 세션 만료로 자동 리다이렉트된 경우 안내 표시 ──
  if (typeof consumeSessionExpiredFlag === 'function' && consumeSessionExpiredFlag()) {
    document.getElementById('errorText').textContent = '세션이 만료되었습니다. 다시 로그인해주세요.';
    document.getElementById('errorMsg').classList.add('show');
  }

  // ── 비밀번호 보기 토글 ──
  document.getElementById('pwToggle').addEventListener('click', () => {
    const input = document.getElementById('pwInput');
    const icon  = document.getElementById('eyeIcon');
    if (input.type === 'password') {
      input.type = 'text';
      icon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
        <line x1="1" y1="1" x2="23" y2="23"/>`;
    } else {
      input.type = 'password';
      icon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>`;
    }
  });

  // ── 에러 표시 / 숨기기 ──
  function showError(msg) {
    document.getElementById('errorText').textContent = msg;
    document.getElementById('errorMsg').classList.add('show');
  }
  function hideError() {
    document.getElementById('errorMsg').classList.remove('show');
  }

  // ── 로그인 처리 ──
  async function handleLogin() {
    const email    = document.getElementById('emailInput').value.trim();
    const password = document.getElementById('pwInput').value;
    const remember = document.getElementById('remember').checked;
    const btn      = document.getElementById('loginBtn');

    hideError();

    if (!email)    { showError('이메일을 입력해주세요.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('올바른 이메일 형식을 입력해주세요.'); return; }
    if (!password) { showError('비밀번호를 입력해주세요.'); return; }

    btn.classList.add('loading');
    btn.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        showError(data.message || '이메일 또는 비밀번호가 올바르지 않습니다.');
        return;
      }

      // JWT 저장
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem('token', data.token);
      storage.setItem('user', JSON.stringify(data.user));
      storage.setItem('loginTime', new Date().toISOString());
      storage.setItem('loginUA', navigator.userAgent);

      // 성공 UI
      btn.querySelector('.btn-text').textContent = '✓ 로그인 완료';
      btn.style.background = '#059669';

      setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);

    } catch (err) {
      showError('서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (btn.style.background !== 'rgb(5, 150, 105)') {
        btn.classList.remove('loading');
        btn.disabled = false;
      }
    }
  }

  // ── 로그인 버튼 & Enter 키 ──
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });

});