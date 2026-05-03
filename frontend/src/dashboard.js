// ═══════════════════════════════════════════════════
//  dashboard.js  —  홈 대시보드 UI
//
//  [순수 프론트 영역]
//    - 인사 문구, 날짜/시간대 기반 greeting
//    - 취약 질환 바 애니메이션
//
//  [DB 팀 연동 필요 영역]
//    - loadUserInfo()  : 로그인 유저 정보 표시
//    - loadStats()     : 학습 통계 불러오기
//    - loadRecentRecords() : 최근 학습 기록
//    - loadStreak()    : 연속 학습일 및 주간 현황
//    - loadWeakDiseases()  : 취약 질환 목록
// ═══════════════════════════════════════════════════


// ── 시간대별 인사말 ──────────────────────────────────
(function setGreeting() {
  const hour = new Date().getHours();
  let greet = '안녕하세요';
  if (hour >= 5  && hour < 12) greet = '좋은 아침이에요';
  if (hour >= 12 && hour < 18) greet = '안녕하세요';
  if (hour >= 18 && hour < 22) greet = '수고하셨어요';
  if (hour >= 22 || hour < 5)  greet = '늦은 시간이네요';

  const user = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
  const name = user.name || '사용자';
  const role = user.role || 'resident';

  const titleEl = document.getElementById('greetTitle');
  if (titleEl) titleEl.textContent = `${greet}, ${name}님`;

  const roleEl = document.getElementById('greetRole');
  if (roleEl) roleEl.textContent = roleLabel(role);

  const avatarEl = document.getElementById('navAvatar');
  if (avatarEl) avatarEl.textContent = name.charAt(0);
})();


// ── 역할 레이블 ──────────────────────────────────────
function roleLabel(v) {
  return { resident: '전공의', student: '의대생' }[v] || '';
}


// ── 로그아웃 ──────────────────────────────────────────
function handleLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  window.location.href = 'login.html';
}


// ── 취약 질환 바 진입 애니메이션 ─────────────────────
(function animateWeakBars() {
  // 페이지 로드 후 바가 자연스럽게 채워지는 효과
  const bars = document.querySelectorAll('.weak-bar');
  bars.forEach(bar => {
    const target = bar.style.width;
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = target; }, 300);
  });
})();


// ── 통계 카드 숫자 카운트업 ───────────────────────────
(function countUpStats() {
  // ── DB 팀 연동 영역 ──────────────────────────────
  // TODO: loadStats() 호출 후 실제 값으로 카운트업
  // ── DB 팀 연동 영역 끝 ──────────────────────────
})();
