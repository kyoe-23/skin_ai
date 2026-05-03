// ── 개인정보 동의 연동 ──
function goToPrivacyConsent() {
  // 현재 입력 내용을 sessionStorage에 임시 저장
  sessionStorage.setItem('signupDraft', JSON.stringify({
    name:        document.getElementById('nameInput').value,
    email:       document.getElementById('emailInput').value,
    pw:          document.getElementById('pwInput').value,
    pwConfirm:   document.getElementById('pwConfirmInput').value,
    affiliation: document.getElementById('affiliationInput').value,
    year:        document.getElementById('yearSelect').value,
    bio:         document.getElementById('bioInput').value,
    role:        selectedRole
  }));
  window.location.href = 'privacy_consent.html';
}

document.addEventListener('DOMContentLoaded', () => {
  // 개인정보 동의 완료 상태 복원
  if (sessionStorage.getItem('privacyConsent') === 'true') {
    document.getElementById('consentPendingBox').style.display = 'none';
    document.getElementById('consentDoneBox').style.display = 'block';
  }

  // 이전에 입력했던 폼 데이터 복원
  const raw = sessionStorage.getItem('signupDraft');
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (d.name)        document.getElementById('nameInput').value        = d.name;
    if (d.email)       document.getElementById('emailInput').value       = d.email;
    if (d.pw)          document.getElementById('pwInput').value          = d.pw;
    if (d.pwConfirm)   document.getElementById('pwConfirmInput').value   = d.pwConfirm;
    if (d.affiliation) document.getElementById('affiliationInput').value = d.affiliation;
    if (d.year)        document.getElementById('yearSelect').value       = d.year;
    if (d.bio) {
      document.getElementById('bioInput').value = d.bio;
      updateBioCount();
    }
    if (d.role) {
      selectedRole = d.role;
      document.querySelectorAll('.role-btn').forEach(b => {
        const onclick = b.getAttribute('onclick') || '';
        b.classList.toggle('active', onclick.includes(`'${d.role}'`) || onclick.includes(`"${d.role}"`));
      });
    }
    // 비밀번호 입력됐으면 강도 표시 복원
    if (d.pw)        checkPwStrength();
    if (d.pwConfirm) validatePwConfirm();
  } catch (_) {}
});

// ── 역할 선택 ──
let selectedRole = 'resident';

function setRole(el, role) {
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  selectedRole = role;
}

// ── 비밀번호 보기 토글 ──
function togglePw(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
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
}

// ── 비밀번호 강도 ──
function checkPwStrength() {
  const pw   = document.getElementById('pwInput').value;
  const str  = document.getElementById('pwStrength');
  const txt  = document.getElementById('pwStrengthText');
  const bars = ['bar1','bar2','bar3'].map(id => document.getElementById(id));

  if (!pw) { str.style.display = 'none'; return; }
  str.style.display = 'block';

  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Za-z]/.test(pw) && /[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const cls    = ['', 'weak', 'medium', 'strong'];
  const labels = ['', '약함', '보통', '강함'];
  bars.forEach((b, i) => { b.className = 'pw-bar' + (i < score ? ' ' + cls[score] : ''); });
  txt.textContent = labels[score];
  txt.className   = 'pw-strength-text ' + cls[score];
}

// ── 이메일 중복 확인 (디바운스) ──
let emailTimer = null;
function validateEmail() {
  const el  = document.getElementById('emailInput');
  const err = document.getElementById('emailError');
  const val = el.value.trim();
  const fmt = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);

  el.classList.remove('valid', 'invalid');
  err.classList.remove('show');

  if (!val) return;
  if (!fmt) {
    el.classList.add('invalid');
    err.textContent = '올바른 이메일 형식을 입력해주세요';
    err.classList.add('show');
    return;
  }

  clearTimeout(emailTimer);
  emailTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`/api/auth/check-email?email=${encodeURIComponent(val)}`);
      const data = await res.json();
      if (data.exists) {
        el.classList.add('invalid');
        err.textContent = '이미 가입된 이메일입니다.';
        err.classList.add('show');
      } else {
        el.classList.add('valid');
      }
    } catch {
      // 서버 연결 전: 형식만 통과
      el.classList.add('valid');
    }
  }, 400);
}

// ── 비밀번호 확인 ──
function validatePwConfirm() {
  const pw  = document.getElementById('pwInput').value;
  const el  = document.getElementById('pwConfirmInput');
  const err = document.getElementById('pwConfirmError');
  const ok  = el.value === pw && el.value.length > 0;
  el.classList.toggle('valid',   ok);
  el.classList.toggle('invalid', !ok && el.value.length > 0);
  err.classList.toggle('show',   !ok && el.value.length > 0);
}

// ── 자기소개 글자수 ──
function updateBioCount() {
  const len = document.getElementById('bioInput').value.length;
  document.getElementById('bioCount').textContent = `${len} / 200자`;
}


// ── 에러 표시 ──
function showBannerError(msg) {
  document.getElementById('errorText').textContent = msg;
  const el = document.getElementById('errorBanner');
  el.classList.add('show');
  el.scrollIntoView({ behavior:'smooth', block:'center' });
}
function hideBannerError() {
  document.getElementById('errorBanner').classList.remove('show');
}
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (msg) el.textContent = msg;
  el.classList.add('show');
}
function hideFieldError(id) {
  document.getElementById(id).classList.remove('show');
}

// ── 회원가입 처리 ──
async function handleRegister() {
  hideBannerError();
  ['nameError','emailError','pwError','pwConfirmError','affiliationError','agreeError'].forEach(hideFieldError);

  const name        = document.getElementById('nameInput').value.trim();
  const email       = document.getElementById('emailInput').value.trim();
  const pw          = document.getElementById('pwInput').value;
  const pwConfirm   = document.getElementById('pwConfirmInput').value;
  const affiliation = document.getElementById('affiliationInput').value.trim();
  const year        = document.getElementById('yearSelect').value;
  const bio         = document.getElementById('bioInput').value.trim();
  const consented = sessionStorage.getItem('privacyConsent') === 'true';

  // 유효성 검사
  let hasError = false;
  if (!name)        { showFieldError('nameError', '이름을 입력해주세요'); hasError = true; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldError('emailError', '올바른 이메일을 입력해주세요'); hasError = true; }
  if (pw.length < 8) { showFieldError('pwError', '비밀번호는 8자 이상이어야 합니다'); hasError = true; }
  if (pw !== pwConfirm) { showFieldError('pwConfirmError', '비밀번호가 일치하지 않습니다'); hasError = true; }
  if (!affiliation) { showFieldError('affiliationError', '소속 기관을 입력해주세요'); hasError = true; }
  if (!consented) { showFieldError('agreeError', '개인정보 동의가 필요합니다'); hasError = true; }

  if (hasError) { showBannerError('입력 항목을 다시 확인해주세요.'); return; }

  const btn = document.getElementById('submitBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, email, password: pw,
        role: selectedRole,
        affiliation, year, bio
      })
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 409) {
        showFieldError('emailError', '이미 가입된 이메일입니다.');
        document.getElementById('emailInput').classList.add('invalid');
        showBannerError('이미 가입된 이메일입니다. 로그인 페이지로 이동해주세요.');
      } else {
        showBannerError(data.message || '회원가입에 실패했습니다.');
      }
      return;
    }

    // 성공 → 임시 저장 데이터 전체 정리
    sessionStorage.removeItem('privacyConsent');
    sessionStorage.removeItem('signupDraft');
    document.getElementById('registerCard').style.display = 'none';
    document.getElementById('successCard').classList.add('show');
    window.scrollTo({ top:0, behavior:'smooth' });

  } catch (err) {
    showBannerError('서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.');
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}
