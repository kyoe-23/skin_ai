// ── 초기 유저 데이터 로드 ─────────────────────────────
(function loadUserData() {
  const raw = localStorage.getItem('user') || sessionStorage.getItem('user');
  if (!raw) return;
  const user = JSON.parse(raw);
  if (!user.name) return;

  const name        = user.name;
  const role        = user.role || 'resident';
  const affiliation = user.affiliation || '';
  const email       = user.email || '';
  const initial     = name.charAt(0);

  // 네비 아바타 + 프로필 사진 초성
  document.getElementById('navAvatar').textContent = initial;
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (avatarPreview.childNodes[0]) avatarPreview.childNodes[0].textContent = initial;
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  if (sidebarAvatar.childNodes[0]) sidebarAvatar.childNodes[0].textContent = initial;

  // 이름 표시
  document.getElementById('previewName').textContent = name;
  document.getElementById('sidebarName').textContent = name;

  // 폼 필드
  document.getElementById('fieldName').value = name;
  document.getElementById('fieldInstitution').value = affiliation;

  // 역할 라디오
  const roleKey = role.charAt(0).toUpperCase() + role.slice(1);
  const roleInput = document.getElementById('role' + roleKey);
  if (roleInput) roleInput.checked = true;

  // 역할 + 소속 표시
  const instText = affiliation ? ' · ' + affiliation : '';
  document.getElementById('previewRole').textContent = roleLabel(role) + instText;
  document.getElementById('sidebarInst').textContent = affiliation;
  updateRoleBadge(role);

  // 이메일
  if (email) {
    const emailDisabled = document.getElementById('fieldCurrentEmail');
    if (emailDisabled) emailDisabled.value = email;

    // 계정 정보 탭 — 이메일 (계정 ID)
    const accountIdEl = document.getElementById('fieldAccountId');
    if (accountIdEl) accountIdEl.value = email;

    // 사이드바 이메일 마스킹
    const sideEmailEl = document.getElementById('sideEmail');
    if (sideEmailEl) {
      const [local, domain] = email.split('@');
      sideEmailEl.textContent = local.slice(0, 4) + '…@' + domain;
    }
  }

  // 계정 유형 (역할 기반)
  const accountTypeEl = document.getElementById('fieldAccountType');
  if (accountTypeEl) accountTypeEl.value = roleLabel(role) + ' 회원';
})();

// ── TAB 전환 ──────────────────────────────────────────
function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tabId).classList.add('active');
  btn.classList.add('active');
}

// ── AVATAR ────────────────────────────────────────────
function handleAvatarChange(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { showToast('이미지는 5MB 이하여야 합니다', 'error'); return; }
  const url = URL.createObjectURL(file);
  const img = document.getElementById('avatarImg');
  img.src = url;
  img.style.display = 'block';
  const sideImg = document.getElementById('sidebarAvatarImg');
  sideImg.src = url;
  sideImg.style.display = 'block';
  markDirty();
}

function removeAvatar() {
  document.getElementById('avatarImg').style.display = 'none';
  document.getElementById('sidebarAvatarImg').style.display = 'none';
  markDirty();
}

// ── 프로필 저장 ───────────────────────────────────────
let dirty = false;
function markDirty() { dirty = true; }

function saveProfile() {
  const name = document.getElementById('fieldName').value.trim();
  if (!name) { showToast('이름을 입력해주세요', 'error'); return; }

  const role    = document.querySelector('input[name=role]:checked').value;
  const inst    = document.getElementById('fieldInstitution').value.trim();
  const dept    = document.getElementById('fieldDepartment').value.trim();
  const initial = name.charAt(0);

  // 화면 반영
  document.getElementById('previewName').textContent = name;
  document.getElementById('sidebarName').textContent = name;
  document.getElementById('navAvatar').textContent = initial;
  const avatarPreview = document.getElementById('profileAvatarPreview');
  if (avatarPreview.childNodes[0]) avatarPreview.childNodes[0].textContent = initial;
  const sidebarAvatar = document.getElementById('sidebarAvatar');
  if (sidebarAvatar.childNodes[0]) sidebarAvatar.childNodes[0].textContent = initial;

  const instText = [inst, dept].filter(Boolean).join(' · ');
  document.getElementById('previewRole').textContent = roleLabel(role) + (instText ? ' · ' + instText : '');
  document.getElementById('sidebarInst').textContent = (inst || '') + (dept ? ' · ' + dept : '');
  updateRoleBadge(role);

  // localStorage 업데이트 (이름·역할·소속 동기화)
  const storage = localStorage.getItem('user') ? localStorage : sessionStorage;
  try {
    const user = JSON.parse(storage.getItem('user') || '{}');
    user.name = name;
    user.role = role;
    user.affiliation = inst;
    storage.setItem('user', JSON.stringify(user));
  } catch (_) {}

  dirty = false;
  showToast('프로필이 저장되었어요', 'success');
}

function roleLabel(v) {
  return { resident: '전공의', student: '의대생', professor: '교수' }[v] || '';
}
function roleBadgeClass(v) {
  return { resident: 'badge-resident', student: 'badge-student', professor: 'badge-professor' }[v] || '';
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
  el.className = 'role-badge-lg ' + roleBadgeClass(role);
  el.textContent = roleLabel(role);
}

// ── 비밀번호 강도 ─────────────────────────────────────
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
    { w: '25%', bg: '#ef4444', t: '매우 약함' },
    { w: '50%', bg: '#f97316', t: '약함' },
    { w: '75%', bg: '#eab308', t: '보통' },
    { w: '100%', bg: '#16a34a', t: '강함' }
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
  else { hint.textContent = '비밀번호가 일치하지 않습니다'; hint.style.color = '#dc2626'; }
}

function togglePw(id, btn) {
  const input = document.getElementById(id);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.querySelector('svg').innerHTML = showing
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
}

function changePw() {
  const cur = document.getElementById('currentPw').value;
  const nw = document.getElementById('newPw').value;
  const cf = document.getElementById('confirmPw').value;
  if (!cur) { showToast('현재 비밀번호를 입력해주세요', 'error'); return; }
  if (nw.length < 8) { showToast('새 비밀번호는 8자 이상이어야 합니다', 'error'); return; }
  if (nw !== cf) { showToast('새 비밀번호가 일치하지 않습니다', 'error'); return; }
  ['currentPw','newPw','confirmPw'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('pwStrength').style.display = 'none';
  document.getElementById('pwMatchHint').textContent = '';
  openModal('pwSuccessModal');
}

// ── 이메일 인증 ───────────────────────────────────────
let codeTimerInterval = null;

function sendVerificationCode() {
  const email = document.getElementById('newEmail').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast('올바른 이메일 주소를 입력해주세요', 'error'); return;
  }
  document.getElementById('verifyCodeGroup').style.display = 'flex';
  document.getElementById('sendCodeBtn').disabled = true;
  showToast('인증 코드가 발송되었어요', 'success');
  startCodeTimer();
}

function startCodeTimer() {
  let left = 180;
  const el = document.getElementById('codeTimer');
  clearInterval(codeTimerInterval);
  codeTimerInterval = setInterval(() => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    el.textContent = m + ':' + s;
    if (--left < 0) {
      clearInterval(codeTimerInterval);
      el.textContent = '만료됨';
      el.style.color = '#dc2626';
      document.getElementById('sendCodeBtn').disabled = false;
    }
  }, 1000);
}

function verifyEmailCode() {
  const code = document.getElementById('verifyCode').value.trim();
  if (code.length !== 6) { showToast('6자리 코드를 입력해주세요', 'error'); return; }
  clearInterval(codeTimerInterval);
  document.getElementById('verifyCodeGroup').style.display = 'none';
  showToast('이메일이 변경되었어요', 'success');
}

// ── 세션 ──────────────────────────────────────────────
function logoutSession(btn) {
  btn.closest('.session-item').style.opacity = '0.4';
  btn.disabled = true;
  btn.textContent = '로그아웃됨';
  showToast('해당 기기에서 로그아웃되었어요', 'success');
}

function logoutAllSessions() {
  showToast('모든 기기에서 로그아웃되었어요', 'success');
}

// ── 알림 설정 ─────────────────────────────────────────
function saveNotifSetting() {
  showToast('알림 설정이 저장되었어요');
}

// ── 데이터 관리 ───────────────────────────────────────
function exportData() {
  showToast('데이터 파일을 준비 중이에요... 잠시 후 다운로드됩니다');
}

function resetRecords() {
  if (!confirm('모든 학습 기록을 삭제하시겠어요?\n이 작업은 되돌릴 수 없습니다.')) return;
  showToast('학습 기록이 초기화되었어요');
}

// ── 계정 탈퇴 ─────────────────────────────────────────
function checkDeleteConfirm() {
  const val = document.getElementById('deleteConfirmInput').value;
  document.getElementById('deleteConfirmBtn').disabled = (val !== '탈퇴합니다');
}

function confirmDeleteAccount() {
  closeModal('deleteAccountModal');
  showToast('계정이 탈퇴되었어요. 이용해주셔서 감사합니다.');
  setTimeout(() => { navigateTo('login.html'); }, 2500);
}

// ── MODAL ─────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('show');
  if (id === 'deleteAccountModal') {
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('deleteConfirmBtn').disabled = true;
  }
}
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeModal(el.id); });
});

// ── TOAST ─────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
