// ═══════════════════════════════════════════════════
//  withdraw.js  —  회원탈퇴 UI 인터랙션
//
//  [순수 프론트 영역]
//    - 라디오 선택, 기타 입력 토글
//    - 확인 문구 검증 및 버튼 활성화
//    - 완료 화면 전환
//    - 토스트 알림
//
//  [DB 팀 연동 필요 영역]
//    - handleWithdraw() 내부 API 호출 부분
//      → DELETE /api/auth/withdraw 또는 해당 엔드포인트로 교체
//      → 토큰 무효화 및 localStorage/sessionStorage 초기화
// ═══════════════════════════════════════════════════


// ── 라디오 선택 ───────────────────────────────────────
function selectReason(item) {
  document.querySelectorAll('.reason-item').forEach(el => el.classList.remove('selected'));
  item.classList.add('selected');

  const isOther = item.querySelector('input[type=radio]').value === 'other';
  const otherWrap = document.getElementById('reasonOtherWrap');
  otherWrap.classList.toggle('show', isOther);
  if (isOther) document.getElementById('reasonOtherText').focus();
}


// ── 확인 입력 검증 ────────────────────────────────────
function onConfirmInput() {
  const val = document.getElementById('confirmInput').value;
  const btn = document.getElementById('withdrawBtn');
  const hint = document.getElementById('confirmHint');
  const input = document.getElementById('confirmInput');
  const isValid = val === '탈퇴합니다';

  input.classList.toggle('valid', isValid);

  if (isValid) {
    btn.classList.add('ready');
    hint.textContent = '탈퇴 버튼이 활성화됐어요';
    hint.style.color = '#dc2626';
  } else {
    btn.classList.remove('ready');
    hint.textContent = '정확히 입력해야 탈퇴 버튼이 활성화됩니다';
    hint.style.color = '#9ca3af';
  }
}


// ── 회원 탈퇴 처리 ───────────────────────────────────
async function handleWithdraw() {
  const btn = document.getElementById('withdrawBtn');
  if (!btn.classList.contains('ready')) return;

  // 선택된 탈퇴 이유 수집 (선택 항목)
  const selectedReason = document.querySelector('.reason-item.selected input[type=radio]');
  const reasonValue  = selectedReason ? selectedReason.value : null;
  const reasonOther  = reasonValue === 'other'
    ? document.getElementById('reasonOtherText').value.trim()
    : null;

  btn.classList.add('loading');
  btn.disabled = true;

  // ── DB 팀 연동 영역 ──────────────────────────────
  // TODO: 아래 fetch를 실제 탈퇴 API로 교체
  //
  // const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  // const res = await fetch('/api/auth/withdraw', {
  //   method: 'DELETE',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${token}`
  //   },
  //   body: JSON.stringify({ reason: reasonValue, reasonDetail: reasonOther })
  // });
  // if (!res.ok) {
  //   showToast('탈퇴 처리 중 오류가 발생했어요. 다시 시도해주세요.', 'error');
  //   btn.classList.remove('loading');
  //   btn.disabled = false;
  //   return;
  // }
  // localStorage.removeItem('token');
  // localStorage.removeItem('user');
  // sessionStorage.removeItem('token');
  // sessionStorage.removeItem('user');
  // ── DB 팀 연동 영역 끝 ──────────────────────────

  // 임시: 1.2초 딜레이 후 완료 처리 (API 연동 전 프론트 확인용)
  await new Promise(resolve => setTimeout(resolve, 1200));

  showDoneScreen();
}


// ── 완료 화면 전환 ───────────────────────────────────
function showDoneScreen() {
  document.getElementById('mainContent').style.display = 'none';
  const done = document.getElementById('doneScreen');
  done.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // 3초 후 로그인 페이지로 이동
  setTimeout(() => { navigateTo('login.html'); }, 3000);
}


// ── 토스트 ───────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
