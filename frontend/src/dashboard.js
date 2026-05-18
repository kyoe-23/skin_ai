const ROLE_LABELS = { resident: '전공의', student: '의대생', doctor: '전문의' };
const roleLabel = (v) => ROLE_LABELS[v] || '';

// ── 시간대별 인사말 ──────────────────────────────────
function _greetingForHour(hour) {
  if (hour >= 5  && hour < 12) return '좋은 아침이에요';
  if (hour >= 18 && hour < 22) return '수고하셨어요';
  if (hour >= 22 || hour < 5)  return '늦은 시간이네요';
  return '안녕하세요';
}

function _renderGreeting(user) {
  const greet = _greetingForHour(new Date().getHours());
  const name = user?.name || '사용자';
  const role = user?.role || 'resident';

  const titleEl = document.getElementById('greetTitle');
  const roleEl  = document.getElementById('greetRole');

  if (titleEl) titleEl.textContent = `${greet}, ${name}님`;
  if (roleEl)  roleEl.textContent  = roleLabel(role);

  // nav 아바타는 nav_avatar.js 공용 헬퍼로 일관 처리
  if (typeof renderNavAvatar === 'function') renderNavAvatar(user);
}

// ── 최신 사용자 정보로 인사·아바타 갱신 ─────────────
(async function loadUserInfo() {
  const stored = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
  _renderGreeting(stored);

  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  if (!token) return;

  try {
    const res = await apiFetch('/api/users/me');
    if (!res.ok) return;
    const { user } = await res.json();
    _renderGreeting(user);
    const storage = localStorage.getItem('user') ? localStorage : sessionStorage;
    storage.setItem('user', JSON.stringify(user));
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
  }
})();

// ── 학습 통계 로드 (매칭 요소 존재 시에만 갱신) ─────
//   .stat-num[data-stat="total"]    → 분석 건수
//   .stat-num[data-stat="diseases"] → 학습 질환 수
//   .stat-num[data-stat="streak"]   → 연속 학습일
//   .weak-bar[data-disease="xxx"]   → 취약 질환 바
(async function loadStats() {
  const hasStatEl  = document.querySelector('[data-stat]');
  const hasWeakBar = document.querySelector('[data-disease]');
  if (!hasStatEl && !hasWeakBar) return;

  try {
    const res = await apiFetch('/api/records');
    if (!res.ok) return;
    const { records } = await res.json();

    if (hasStatEl) _renderStatCards(records);
    if (hasWeakBar) _renderWeakDiseaseBars(records);
  } catch (err) {
    if (err && err.message === 'SESSION_EXPIRED') return;
  }
})();

function _renderStatCards(records) {
  const total    = records.length;
  const diseases = new Set(records.map(r => r.primary_diagnosis).filter(Boolean)).size;
  const streak   = _calcStreak(records);

  const set = (key, val) => {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = val;
  };
  set('total', total);
  set('diseases', diseases);
  set('streak', streak);
}

function _calcStreak(records) {
  const dates = new Set(records.map(r => (r.created_at || '').slice(0, 10)));
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

// 가장 자주 학습한 질환을 비율(%) 로 바에 반영
function _renderWeakDiseaseBars(records) {
  const counts = records.reduce((acc, r) => {
    const k = r.primary_diagnosis;
    if (k) acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const max = Math.max(1, ...Object.values(counts));

  document.querySelectorAll('[data-disease]').forEach(bar => {
    const key = bar.dataset.disease;
    const pct = Math.round(((counts[key] || 0) / max) * 100);
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = pct + '%'; }, 300);
  });
}

// ── 로그아웃 ──────────────────────────────────────────
async function handleLogout() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token');
  try {
    if (token) {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    }
  } catch (_) { /* 통신 실패해도 로컬 정리는 진행 */ }
  finally {
    localStorage.clear();
    sessionStorage.clear();
    window.location.href = 'login.html';
  }
}
