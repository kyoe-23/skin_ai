// ─────────────────────────────────────────────────────
// nav_avatar.js — 모든 페이지 공통 우측 상단 아바타 렌더링
//
// renderNavAvatar(user) : avatar_url 있으면 사진, 없으면 기본 인물 SVG.
// 페이지 로드 시 localStorage / sessionStorage 의 user 로 자동 초기 렌더.
// ─────────────────────────────────────────────────────

// 기본 아바타 — 흰색 인물 실루엣 SVG (data URL)
const DEFAULT_AVATAR_DATA_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">' +
    '<circle cx="12" cy="8" r="4"/>' +
    '<path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8z"/>' +
  '</svg>'
);

// .avatar 클래스의 기본 그라데이션 — 기본 이미지 뒤에 깔리는 배경
const AVATAR_BG_GRADIENT = 'linear-gradient(135deg, #2563eb, #7c3aed)';

function renderNavAvatar(user) {
  const el = document.getElementById('navAvatar');
  if (!el) return;

  // 글자 잔재 제거
  el.textContent = '';

  if (user && user.avatar_url) {
    // 업로드된 프로필 사진 — 풀 사이즈로 표시
    el.style.backgroundImage    = `url("${user.avatar_url}")`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundRepeat   = 'no-repeat';
    el.style.backgroundPosition = 'center';
  } else {
    // 기본 상태 — 그라데이션 위에 인물 실루엣 SVG 를 60% 크기로 중앙 배치
    el.style.backgroundImage    = `url("${DEFAULT_AVATAR_DATA_URL}"), ${AVATAR_BG_GRADIENT}`;
    el.style.backgroundSize     = '60%, cover';
    el.style.backgroundRepeat   = 'no-repeat, no-repeat';
    el.style.backgroundPosition = 'center, center';
  }
}

// 페이지 로드 시 자동 적용 — localStorage 의 user 우선
(function initNavAvatar() {
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
  } catch (_) { user = {}; }
  renderNavAvatar(user);
})();
