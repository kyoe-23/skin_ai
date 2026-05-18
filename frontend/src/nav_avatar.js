// ─────────────────────────────────────────────────────
// nav_avatar.js — 페이지 공통 아바타 렌더링
//
//  - renderNavAvatar(user)  : 우측 상단 #navAvatar 렌더
//  - applyDefaultAvatar(el) : 임의 요소에 기본 인물 이미지(SVG) 표시
//
// 모두 글자 텍스트 없이 사진 또는 SVG 만 사용한다.
// ─────────────────────────────────────────────────────

// 기본 아바타 — 흰색 인물 실루엣 SVG (data URL)
const DEFAULT_AVATAR_DATA_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">' +
    '<circle cx="12" cy="8" r="4"/>' +
    '<path d="M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8z"/>' +
  '</svg>'
);

// 요소에 기본 SVG 아이콘을 60% 크기 중앙 배치로 표시.
// 배경 단색은 CSS 클래스(.avatar / .avatar-large 등)의 background-color 가 담당.
function applyDefaultAvatar(el) {
  if (!el) return;
  el.style.backgroundImage    = `url("${DEFAULT_AVATAR_DATA_URL}")`;
  el.style.backgroundSize     = '60%';
  el.style.backgroundRepeat   = 'no-repeat';
  el.style.backgroundPosition = 'center';
}

// 업로드된 사진을 풀 사이즈로 표시.
function applyPhotoAvatar(el, url) {
  if (!el) return;
  el.style.backgroundImage    = `url("${url}")`;
  el.style.backgroundSize     = 'cover';
  el.style.backgroundRepeat   = 'no-repeat';
  el.style.backgroundPosition = 'center';
}

function renderNavAvatar(user) {
  const el = document.getElementById('navAvatar');
  if (!el) return;
  el.textContent = '';

  if (user && user.avatar_url) {
    applyPhotoAvatar(el, user.avatar_url);
  } else {
    applyDefaultAvatar(el);
  }
}

// 페이지 로드 시 자동 적용 — localStorage 우선
(function initNavAvatar() {
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || sessionStorage.getItem('user') || '{}');
  } catch (_) { user = {}; }
  renderNavAvatar(user);
})();
