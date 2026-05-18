// ─────────────────────────────────────────────────────────
// profile.js — 프로필 페이지
// 백엔드 API와 직접 연동. UI-only stub 제거.
// ─────────────────────────────────────────────────────────

// ── 역할 라벨 ────────────────────────────────────────
const ROLE_LABELS = { resident: '전공의', student: '의대생', doctor: '전문의' };
const roleLabel = (v) => ROLE_LABELS[v] || '';

const ROLE_BADGE_CLASS = {
  resident: 'badge-resident', student: 'badge-student', doctor: 'badge-doctor',
};
const roleBadgeClass = (v) => ROLE_BADGE_CLASS[v] || '';

// 회원가입 시 전송하는 의료진 필드 키 — 화이트리스트
const PROFILE_FIELDS = ['name', 'role', 'affiliation', 'department', 'year', 'bio'];

// ── 상태 ──────────────────────────────────────────────
let _currentUser = null;
let _dirty = false;
const markDirty = () => { _dirty = true; };

// ─────────────────────────────────────────────────────
// 초기 데이터 로드 — /api/users/me, 알림, 세션
// ─────────────────────────────────────────────────────
(async function init() {
  try {
    const res = await apiFetch('/api/users/me');
    if (!res.ok) return;
    const { user } = await res.json();
    _currentUser = user;
    _renderUser(user);
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    console.error('프로필 로드 실패:', err);
  }
  await _loadNotifications();
  await _loadSessions();
})();

function _renderUser(u) {
  const initial = (u.name || '?').charAt(0);

  document.getElementById('navAvatar').textContent = initial;

  const setAvatarInitial = (id) => {
    const el = document.getElementById(id);
    if (el && el.childNodes[0]) el.childNodes[0].textContent = initial;
  };
  setAvatarInitial('profileAvatarPreview');
  setAvatarInitial('sidebarAvatar');

  document.getElementById('previewName').textContent = u.name || '';
  document.getElementById('sidebarName').textContent = u.name || '';

  document.getElementById('fieldName').value = u.name || '';
  document.getElementById('fieldInstitution').value = u.affiliation || '';
  document.getElementById('fieldDepartment').value = u.department || '';

  const roleInput = document.getElementById('role' + (u.role || '').charAt(0).toUpperCase() + (u.role || '').slice(1));
  if (roleInput) roleInput.checked = true;

  const inst = [u.affiliation, u.department].filter(Boolean).join(' · ');
  document.getElementById('previewRole').textContent = roleLabel(u.role) + (inst ? ' · ' + inst : '');
  document.getElementById('sidebarInst').textContent = inst;
  updateRoleBadge(u.role);

  // 이메일 표시 (마스킹)
  if (u.email) {
    const setEmail = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setEmail('fieldCurrentEmail', u.email);
    setEmail('fieldAccountId', u.email);

    const sideEmailEl = document.getElementById('sideEmail');
    if (sideEmailEl) {
      const [local, domain] = u.email.split('@');
      sideEmailEl.textContent = local.slice(0, 4) + '…@' + domain;
    }
  }

  const accountTypeEl = document.getElementById('fieldAccountType');
  if (accountTypeEl) accountTypeEl.value = roleLabel(u.role) + ' 회원';

  // 아바타 이미지
  if (u.avatar_url) {
    _setAvatarImage(u.avatar_url);
  }
}

function _setAvatarImage(url) {
  const main = document.getElementById('avatarImg');
  const side = document.getElementById('sidebarAvatarImg');
  if (main) { main.src = url; main.style.display = 'block'; }
  if (side) { side.src = url; side.style.display = 'block'; }
}

function _hideAvatarImage() {
  const main = document.getElementById('avatarImg');
  const side = document.getElementById('sidebarAvatarImg');
  if (main) main.style.display = 'none';
  if (side) side.style.display = 'none';
}

// ─────────────────────────────────────────────────────
// TAB 전환
// ─────────────────────────────────────────────────────
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
}

// ─────────────────────────────────────────────────────
// P2 — 아바타 업로드
// ─────────────────────────────────────────────────────
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

async function handleAvatarChange(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > AVATAR_MAX_BYTES) {
    showToast('이미지는 5MB 이하여야 합니다', 'error'); return;
  }

  // 즉시 미리보기
  const previewUrl = URL.createObjectURL(file);
  _setAvatarImage(previewUrl);

  // 서버 업로드
  try {
    const form = new FormData();
    form.append('avatar', file);
    const res = await apiFetch('/api/users/me/avatar', { method: 'POST', body: form });
    if (!res.ok) throw new Error('업로드 실패');
    const { avatar_url } = await res.json();
    _setAvatarImage(avatar_url);
    URL.revokeObjectURL(previewUrl);
    _syncStoredUser({ avatar_url });
    showToast('프로필 사진이 변경되었어요', 'success');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('업로드에 실패했습니다', 'error');
    _hideAvatarImage();
  }
}

async function removeAvatar() {
  _hideAvatarImage();
  try {
    const res = await apiFetch('/api/users/me/avatar', { method: 'DELETE' });
    if (!res.ok) throw new Error();
    _syncStoredUser({ avatar_url: null });
    showToast('프로필 사진이 삭제되었어요', 'success');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('삭제에 실패했습니다', 'error');
  }
}

// ─────────────────────────────────────────────────────
// P1 / S2 — 프로필 저장
// ─────────────────────────────────────────────────────
async function saveProfile() {
  const name = document.getElementById('fieldName').value.trim();
  if (!name) { showToast('이름을 입력해주세요', 'error'); return; }

  const role = document.querySelector('input[name=role]:checked')?.value;
  const payload = {
    name,
    role,
    affiliation: document.getElementById('fieldInstitution').value.trim() || null,
    department:  document.getElementById('fieldDepartment').value.trim() || null,
  };

  try {
    const res = await apiFetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const { message } = await res.json().catch(() => ({}));
      throw new Error(message || '저장 실패');
    }
    const { user } = await res.json();
    _currentUser = user;
    _renderUser(user);
    _syncStoredUser(user);
    _dirty = false;
    showToast('프로필이 저장되었어요', 'success');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast(err.message || '저장에 실패했습니다', 'error');
  }
}

function _syncStoredUser(partial) {
  const storage = localStorage.getItem('user') ? localStorage : sessionStorage;
  try {
    const stored = JSON.parse(storage.getItem('user') || '{}');
    storage.setItem('user', JSON.stringify({ ...stored, ...partial }));
  } catch (_) { /* 무시 */ }
}

function updateRolePreview() {
  const role = document.querySelector('input[name=role]:checked').value;
  document.getElementById('previewRole').textContent =
    roleLabel(role) + ' · ' + document.getElementById('fieldInstitution').value;
  updateRoleBadge(role);
  markDirty();
}

function updateRoleBadge(role) {
  const el = document.getElementById('sidebarRoleBadge');
  if (!el) return;
  el.className = 'role-badge-lg ' + roleBadgeClass(role);
  el.textContent = roleLabel(role);
}

// ─────────────────────────────────────────────────────
// 비밀번호 강도·일치 UI
// ─────────────────────────────────────────────────────
function checkPwStrength(val) {
  const el = document.getElementById('pwStrength');
  const fill = document.getElementById('pwStrengthFill');
  const label = document.getElementById('pwStrengthLabel');
  if (!val) { el.style.display = 'none'; return; }
  el.style.display = 'block';

  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;

  const levels = [
    { w: '25%',  bg: '#ef4444', t: '매우 약함' },
    { w: '50%',  bg: '#f97316', t: '약함' },
    { w: '75%',  bg: '#eab308', t: '보통' },
    { w: '100%', bg: '#16a34a', t: '강함' },
  ];
  const lv = levels[Math.min(score - 1, 3)] || levels[0];
  fill.style.width = lv.w;
  fill.style.background = lv.bg;
  label.textContent = lv.t;
  label.style.color = lv.bg;
}

function checkPwMatch() {
  const nv = document.getElementById('newPw').value;
  const cv = document.getElementById('confirmPw').value;
  const hint = document.getElementById('pwMatchHint');
  if (!cv) { hint.textContent = ''; return; }
  if (nv === cv) { hint.textContent = '비밀번호가 일치합니다'; hint.style.color = '#16a34a'; }
  else          { hint.textContent = '비밀번호가 일치하지 않습니다'; hint.style.color = '#dc2626'; }
}

function togglePw(id, btn) {
  const input = document.getElementById(id);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.querySelector('svg').innerHTML = showing
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
}

// ─────────────────────────────────────────────────────
// P3 — 비밀번호 변경
// ─────────────────────────────────────────────────────
async function changePw() {
  const cur = document.getElementById('currentPw').value;
  const nw  = document.getElementById('newPw').value;
  const cf  = document.getElementById('confirmPw').value;

  if (!cur) { showToast('현재 비밀번호를 입력해주세요', 'error'); return; }
  if (nw.length < 8) { showToast('새 비밀번호는 8자 이상이어야 합니다', 'error'); return; }
  if (nw !== cf) { showToast('새 비밀번호가 일치하지 않습니다', 'error'); return; }

  try {
    const res = await apiFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    if (!res.ok) {
      const { message } = await res.json().catch(() => ({}));
      showToast(message || '변경에 실패했습니다', 'error');
      return;
    }

    ['currentPw','newPw','confirmPw'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pwStrength').style.display = 'none';
    document.getElementById('pwMatchHint').textContent = '';
    openModal('pwSuccessModal');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('변경에 실패했습니다', 'error');
  }
}

// ─────────────────────────────────────────────────────
// P4 — 이메일 변경 인증 코드
// ─────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TIMER_SEC = 180;

let _codeTimerInterval = null;
let _pendingNewEmail = null;

async function sendVerificationCode() {
  const email = document.getElementById('newEmail').value.trim();
  if (!EMAIL_RE.test(email)) {
    showToast('올바른 이메일 주소를 입력해주세요', 'error'); return;
  }

  try {
    const res = await apiFetch('/api/auth/email/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newEmail: email }),
    });
    if (!res.ok) {
      const { message } = await res.json().catch(() => ({}));
      showToast(message || '코드 발송에 실패했습니다', 'error');
      return;
    }

    _pendingNewEmail = email;
    document.getElementById('verifyCodeGroup').style.display = 'flex';
    document.getElementById('sendCodeBtn').disabled = true;
    showToast('인증 코드가 발송되었어요', 'success');
    _startCodeTimer();
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('코드 발송에 실패했습니다', 'error');
  }
}

function _startCodeTimer() {
  let left = CODE_TIMER_SEC;
  const el = document.getElementById('codeTimer');
  clearInterval(_codeTimerInterval);
  _codeTimerInterval = setInterval(() => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    el.textContent = m + ':' + s;
    if (--left < 0) {
      clearInterval(_codeTimerInterval);
      el.textContent = '만료됨';
      el.style.color = '#dc2626';
      document.getElementById('sendCodeBtn').disabled = false;
    }
  }, 1000);
}

async function verifyEmailCode() {
  const code = document.getElementById('verifyCode').value.trim();
  if (code.length !== 6) { showToast('6자리 코드를 입력해주세요', 'error'); return; }

  try {
    const res = await apiFetch('/api/auth/email/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const { message } = await res.json().catch(() => ({}));
      showToast(message || '인증에 실패했습니다', 'error');
      return;
    }
    const { email } = await res.json();
    clearInterval(_codeTimerInterval);
    document.getElementById('verifyCodeGroup').style.display = 'none';
    document.getElementById('newEmail').value = '';
    document.getElementById('sendCodeBtn').disabled = false;

    const fieldCur = document.getElementById('fieldCurrentEmail');
    if (fieldCur) fieldCur.value = email;
    _syncStoredUser({ email });
    showToast('이메일이 변경되었어요', 'success');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('인증에 실패했습니다', 'error');
  }
}

// ─────────────────────────────────────────────────────
// P8 — 세션 목록 렌더링
// ─────────────────────────────────────────────────────
const DESKTOP_SVG = `<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
const MOBILE_SVG  = `<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18" stroke-width="3" stroke-linecap="round"/></svg>`;

function formatLoginTime(isoStr) {
  if (!isoStr) return '현재 사용 중';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (days  > 0) return `${days}일 전 활동`;
  if (hours > 0) return `${hours}시간 전 활동`;
  if (mins  > 0) return `${mins}분 전 활동`;
  return '방금 활동';
}

async function _loadSessions() {
  const list = document.getElementById('sessionList');
  if (!list) return;
  try {
    const res = await apiFetch('/api/users/me/sessions');
    if (!res.ok) return;
    const { sessions } = await res.json();
    list.innerHTML = sessions.map(s => {
      const isMobile = /iPhone|iPad|Android/.test(s.user_agent || '');
      const icon = isMobile ? MOBILE_SVG : DESKTOP_SVG;
      const label = s.device_label || '알 수 없는 기기';
      const time = s.is_current ? '현재 사용 중' : formatLoginTime(s.last_seen_at);
      const right = s.is_current
        ? '<span class="session-current">현재</span>'
        : `<button class="session-end-btn" onclick="endSession('${s.session_id}')">로그아웃</button>`;
      return `
        <div class="session-item">
          <div class="session-icon">${icon}</div>
          <div class="session-info">
            <div class="session-device">${label}</div>
            <div class="session-time">${time}</div>
          </div>
          ${right}
        </div>`;
    }).join('');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
  }
}

async function endSession(sessionId) {
  try {
    const res = await apiFetch(`/api/users/me/sessions/${sessionId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('해당 기기를 로그아웃했어요', 'success');
    await _loadSessions();
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('로그아웃에 실패했습니다', 'error');
  }
}

// P5 — 모든 기기 로그아웃 (현재 세션 포함)
async function logoutAllSessions() {
  try {
    const res = await apiFetch('/api/users/me/logout-all', { method: 'POST' });
    if (!res.ok) throw new Error();
    showToast('모든 기기에서 로그아웃합니다...');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
  } finally {
    setTimeout(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = 'login.html';
    }, 1000);
  }
}

// ─────────────────────────────────────────────────────
// P6 — 알림 설정
// ─────────────────────────────────────────────────────
async function _loadNotifications() {
  try {
    const res = await apiFetch('/api/users/me/notifications');
    if (!res.ok) return;
    const { preferences } = await res.json();
    document.querySelectorAll('[data-notif-key]').forEach(input => {
      const key = input.dataset.notifKey;
      if (key in preferences) input.checked = !!preferences[key];
    });
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
  }
}

async function saveNotifSetting(input) {
  if (!input || !input.dataset?.notifKey) return;
  const payload = { [input.dataset.notifKey]: !!input.checked };

  try {
    const res = await apiFetch('/api/users/me/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error();
    showToast('알림 설정이 저장되었어요');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    // 실패 시 토글 원복
    input.checked = !input.checked;
    showToast('저장에 실패했습니다', 'error');
  }
}

// ─────────────────────────────────────────────────────
// 데이터 내보내기 / 학습 기록 초기화
// ─────────────────────────────────────────────────────
async function exportData() {
  showToast('데이터를 준비하는 중...');
  try {
    const res = await apiFetch('/api/analyze/records');
    if (!res.ok) throw new Error();
    const { records } = await res.json();

    if (!records || records.length === 0) {
      showToast('내보낼 데이터가 없습니다', 'error'); return;
    }

    const cols = ['번호', '분석일시', '이미지 URL', '마스킹 여부', '상태'];
    const rows = records.map((r, i) => [
      i + 1,
      new Date(r.created_at).toLocaleString('ko-KR'),
      r.image_url || '',
      r.is_masked ? '적용됨' : '미적용',
      r.status || ''
    ]);

    const csv = [cols, ...rows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), {
      href: url,
      download: `SkinAI_데이터_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${records.length}개 기록을 내보냈어요`, 'success');
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('데이터 내보내기에 실패했습니다', 'error');
  }
}

function resetRecords() {
  openModal('resetRecordsModal');
  const btn = document.getElementById('resetRecordsConfirmBtn');
  btn.disabled = false;
  btn.textContent = '초기화';
}

async function confirmResetRecords() {
  const btn = document.getElementById('resetRecordsConfirmBtn');
  btn.disabled = true;
  btn.textContent = '삭제 중...';

  try {
    const res = await apiFetch('/api/analyze/records', { method: 'DELETE' });
    if (!res.ok) throw new Error();
    closeModal('resetRecordsModal');
    showToast('학습 기록이 초기화되었어요', 'success');

    const statEl = document.getElementById('statAnalysisCount');
    if (statEl) statEl.textContent = '0';
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('초기화에 실패했습니다', 'error');
    btn.disabled = false;
    btn.textContent = '초기화';
  }
}

// ─────────────────────────────────────────────────────
// P7 — 계정 탈퇴 (모달 onClick 연결)
// ─────────────────────────────────────────────────────
function checkDeleteConfirm() {
  const val = document.getElementById('deleteConfirmInput').value;
  document.getElementById('deleteConfirmBtn').disabled = (val !== '탈퇴합니다');
}

async function confirmDeleteAccount() {
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true;
  btn.textContent = '처리 중...';

  try {
    const res = await apiFetch('/api/auth/withdraw', { method: 'DELETE' });
    if (!res.ok) throw new Error();
    closeModal('deleteAccountModal');
    localStorage.clear();
    sessionStorage.clear();
    showToast('계정이 탈퇴되었어요. 이용해주셔서 감사합니다.');
    setTimeout(() => { window.location.href = 'login.html'; }, 2500);
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
    showToast('탈퇴 처리에 실패했습니다', 'error');
    btn.disabled = false;
    btn.textContent = '탈퇴';
  }
}

// ─────────────────────────────────────────────────────
// 학습 통계 로드 (대시보드와 동일 로직)
// ─────────────────────────────────────────────────────
(async function loadLearningStats() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (!token) return;
  try {
    const res = await apiFetch('/api/records');
    if (!res.ok) return;
    const { records } = await res.json();

    const totalEl   = document.getElementById('statAnalysisCount');
    const diseaseEl = document.getElementById('statDiseaseCount');
    const streakEl  = document.getElementById('statStreak');
    if (totalEl)   totalEl.textContent   = records.length;
    if (diseaseEl) diseaseEl.textContent = new Set(records.map(r => r.primary_diagnosis).filter(Boolean)).size;
    if (streakEl)  streakEl.textContent  = calcStreak(records) + '일';
  } catch (_) {}
})();

function calcStreak(records) {
  const dates = new Set(records.map(r => r.created_at.slice(0, 10)));
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const start = new Date(today);
  if (!dates.has(todayStr)) start.setDate(start.getDate() - 1);

  let streak = 0;
  const d = new Date(start);
  while (streak < 365) {
    if (dates.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

// ─────────────────────────────────────────────────────
// MODAL / TOAST
// ─────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  if (id === 'deleteAccountModal') {
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('deleteConfirmBtn').disabled = true;
    document.getElementById('deleteConfirmBtn').textContent = '탈퇴';
  }
  if (id === 'resetRecordsModal') {
    const btn = document.getElementById('resetRecordsConfirmBtn');
    btn.disabled = false; btn.textContent = '초기화';
  }
}
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

let _toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
