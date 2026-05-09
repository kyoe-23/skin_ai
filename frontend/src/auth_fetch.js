// ── 인증된 API 호출 공용 래퍼 ─────────────────────────────────────
// 401/403 응답 시 자동으로 세션 정리 + 로그인 페이지로 리다이렉트.
// Authorization 헤더는 sessionStorage/localStorage 의 token 을 자동 부착.

const AUTH_FAILED_FLAG = 'session_expired';

function _getToken() {
  return sessionStorage.getItem('token') || localStorage.getItem('token');
}

function _clearSession() {
  sessionStorage.removeItem('token');
  localStorage.removeItem('token');
  sessionStorage.removeItem('user');
  localStorage.removeItem('user');
}

function _redirectToLogin() {
  // 같은 디렉토리 내 페이지면 절대경로 'login.html', 다르면 상대경로 처리
  // 현재 frontend/html/ 단일 디렉토리 구조 기준
  sessionStorage.setItem(AUTH_FAILED_FLAG, '1');
  const target = location.pathname.endsWith('login.html')
    ? null
    : 'login.html';
  if (target) location.href = target;
}

// 외부 API: fetch와 동일한 시그니처. Authorization 자동 부착.
async function apiFetch(url, options = {}) {
  const token = _getToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 || res.status === 403) {
    _clearSession();
    _redirectToLogin();
    // 호출부의 후속 코드가 잘못된 응답을 다루지 않도록 throw
    throw new Error('SESSION_EXPIRED');
  }

  return res;
}

// 로그인 페이지에서 만료 알림 배너 표시용
function consumeSessionExpiredFlag() {
  if (sessionStorage.getItem(AUTH_FAILED_FLAG) === '1') {
    sessionStorage.removeItem(AUTH_FAILED_FLAG);
    return true;
  }
  return false;
}
