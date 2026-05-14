// DISEASE_MAP 은 disease_map.js 에서 글로벌로 제공 (DS_unified 11종)

// ── 전역 상태 ──
let _currentRecordId = null;
let _chatContext     = {};
let _chatMessages    = [];   // 멀티턴용 인메모리 이력

const _AI_AVATAR_RD = `<div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>`;

function animateRing(confPct) {
  const ring = document.getElementById('confRing');
  if (!ring) return;
  const circumference = 2 * Math.PI * 34;
  const offset = circumference * (1 - confPct / 100);
  ring.style.strokeDasharray = circumference;
  ring.style.strokeDashoffset = circumference;
  setTimeout(() => { ring.style.strokeDashoffset = offset; }, 200);
}

function animateDiffBars() {
  document.querySelectorAll('.diff-bar').forEach(bar => {
    const target = bar.style.width;
    bar.style.width = '0%';
    setTimeout(() => { bar.style.width = target; }, 300);
  });
}

async function loadRecordDetail() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  _currentRecordId = id;

  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await apiFetch(`/api/records/${id}`);
    if (!res.ok) return;
    const { record: r } = await res.json();

    const info = DISEASE_MAP[r.primary_diagnosis] || { ko: r.primary_diagnosis || '-', en: r.primary_diagnosis || '-' };
    const confPct = r.confidence != null ? Math.round(r.confidence * 100) : 0;
    const dateStr = r.created_at ? r.created_at.slice(0, 10).replace(/-/g, '.') : '-';

    // 헤더
    document.getElementById('detailDiagName').textContent = info.ko;
    document.getElementById('detailDiagEn').textContent = info.en;
    document.getElementById('detailConf').textContent = `AI 신뢰도 ${confPct}%`;
    document.getElementById('detailDate').textContent = dateStr;

    // 이미지
    const imgEl = document.getElementById('analyzedImg');
    if (r.image_url) {
      imgEl.innerHTML = `<img src="${r.image_url}" alt="${info.ko}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`;
    }

    // Grad-CAM
    if (r.gradcam_url) {
      document.getElementById('gradcamRow').style.display = 'block';
      const imgStyle = 'width:100%;height:100%;object-fit:cover;border-radius:12px;';
      document.getElementById('gradcamOriginal').innerHTML =
        `<img src="${r.image_url}" alt="원본" style="${imgStyle}">`;
      document.getElementById('gradcamHeatmap').innerHTML =
        `<img src="${r.gradcam_url}" alt="Grad-CAM" style="${imgStyle}">`;
    }

    // 신뢰도 링
    document.getElementById('confVal').textContent = `${confPct}%`;
    animateRing(confPct);

    // AI 소견 (report JSON)
    let report = null;
    try { report = r.ai_findings ? JSON.parse(r.ai_findings) : null; } catch { report = null; }
    const findingEl = document.getElementById('findingList');
    if (report && (report.summary || report.features)) {
      findingEl.innerHTML = [
        report.summary   && `<div class="finding-item"><div class="finding-dot"></div><div class="finding-text">${report.summary}</div></div>`,
        report.features  && `<div class="finding-item"><div class="finding-dot"></div><div class="finding-text">${report.features}</div></div>`,
        report.advice    && `<div class="finding-item"><div class="finding-dot" style="background:#16a34a"></div><div class="finding-text">${report.advice}</div></div>`,
        report.disclaimer && `<div class="finding-item" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;"><div class="finding-text" style="color:#92400e;font-size:12px;">${report.disclaimer}</div></div>`,
      ].filter(Boolean).join('');
    } else {
      findingEl.innerHTML = '<div style="font-size:13px;color:#c4cad4;padding:8px 0;">AI 소견 정보가 없습니다</div>';
    }

    // 채팅 컨텍스트 저장
    _chatContext = { class_name: info.ko, confidence: r.confidence, report };

    // 저장된 채팅 기록 복원 (멀티턴 이력도 함께 초기화)
    const savedChat = r.chat_history || [];
    _chatMessages = savedChat.map(m => ({ role: m.role, content: m.content }));
    if (savedChat.length > 0) {
      renderChatHistory(savedChat);
    }
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') return;
    console.error('기록 상세 로드 실패:', err);
  }
}

loadRecordDetail();


// ── 북마크 토글 ──────────────────────────────────────
let bookmarked = false;
function bookmarkRecord() {
  bookmarked = !bookmarked;
  const btn = document.getElementById('bookmarkBtn');
  if (bookmarked) {
    btn.style.borderColor = '#f59e0b';
    btn.style.color = '#f59e0b';
    btn.style.background = '#fffbeb';
    showToast('북마크에 저장됐어요');
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
    btn.style.background = '';
    showToast('북마크가 해제됐어요');
  }
  // ── DB 팀 연동 영역 ──────────────────────────────
  // TODO: POST /api/records/:id/bookmark
  // ── DB 팀 연동 영역 끝 ──────────────────────────
}


// ── 공유 ──────────────────────────────────────────────
function shareRecord() {
  if (navigator.share) {
    navigator.share({ title: 'SkinAI 분석 결과', url: location.href });
  } else {
    navigator.clipboard.writeText(location.href).then(() => showToast('링크가 복사됐어요'));
  }
}


// ── LLM 채팅 ─────────────────────────────────────────
function setQuestion(el) {
  const input = document.getElementById('chatInput');
  input.value = el.textContent;
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
  input.focus();
}

function renderChatHistory(messages) {
  const messagesEl = document.getElementById('chatMessages');
  const suggestions = document.getElementById('chatSuggestions');
  if (suggestions && messages.length > 0) suggestions.style.display = 'none';

  messages.forEach(m => {
    const safe = (m.content || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    if (m.role === 'user') {
      messagesEl.insertAdjacentHTML('beforeend', `
        <div style="align-self:flex-end;display:flex;align-items:flex-end;max-width:80%;">
          <div style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:16px 16px 4px 16px;font-size:13px;line-height:1.6;">${safe}</div>
        </div>`);
    } else {
      messagesEl.insertAdjacentHTML('beforeend', `
        <div style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;max-width:90%;">
          ${_AI_AVATAR_RD}
          <div style="background:#f8fafc;border:1px solid #e8eaed;color:#374151;padding:12px 16px;border-radius:4px 16px 16px 16px;font-size:13px;line-height:1.7;">${safe}</div>
        </div>`);
    }
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function saveChatMessages(messages) {
  if (!_currentRecordId || !messages.length) return;
  try {
    await apiFetch(`/api/records/${_currentRecordId}/chat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch (err) {
    console.error('채팅 저장 실패:', err);
  }
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const question = input.value.trim();
  if (!question) return;

  const suggestions = document.getElementById('chatSuggestions');
  if (suggestions) suggestions.style.display = 'none';

  const messagesEl = document.getElementById('chatMessages');
  const safeQ = question.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  messagesEl.insertAdjacentHTML('beforeend', `
    <div style="align-self:flex-end;display:flex;align-items:flex-end;max-width:80%;">
      <div style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:16px 16px 4px 16px;font-size:13px;line-height:1.6;">${safeQ}</div>
    </div>`);

  input.value = '';
  input.style.height = 'auto';

  const loadingId = 'chat-loading-' + Date.now();
  messagesEl.insertAdjacentHTML('beforeend', `
    <div id="${loadingId}" style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;">
      ${_AI_AVATAR_RD}
      <div style="background:#f3f4f6;border:1px solid #e8eaed;padding:12px 16px;border-radius:4px 16px 16px 16px;display:flex;gap:5px;align-items:center;">
        <div class="chat-dot"></div><div class="chat-dot"></div><div class="chat-dot"></div>
      </div>
    </div>`);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await apiFetch('/api/analyze/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, context: _chatContext, history: _chatMessages }),
    });
    const data = await res.json();
    const rawAnswer = data.answer || 'LLM이 비활성화되어 있습니다.';
    const safeA = rawAnswer.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    document.getElementById(loadingId)?.remove();
    messagesEl.insertAdjacentHTML('beforeend', `
      <div style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;max-width:90%;">
        ${_AI_AVATAR_RD}
        <div style="background:#f8fafc;border:1px solid #e8eaed;color:#374151;padding:12px 16px;border-radius:4px 16px 16px 16px;font-size:13px;line-height:1.7;">${safeA}</div>
      </div>`);
    messagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const ts = new Date().toISOString();
    // 인메모리 이력에 누적 (다음 턴에 전달)
    _chatMessages.push({ role: 'user', content: question, ts });
    _chatMessages.push({ role: 'ai',   content: rawAnswer, ts });
    saveChatMessages([
      { role: 'user', content: question,   ts },
      { role: 'ai',   content: rawAnswer,  ts },
    ]);
  } catch {
    document.getElementById(loadingId)?.remove();
    messagesEl.insertAdjacentHTML('beforeend', `
      <div style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;">
        <div style="width:28px;height:28px;border-radius:8px;background:#fee2e2;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:10px 14px;border-radius:4px 16px 16px 16px;font-size:13px;">오류가 발생했습니다. 다시 시도해주세요.</div>
      </div>`);
    messagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}


// ── 기록 삭제 ────────────────────────────────────────
async function deleteRecord() {
  if (!_currentRecordId) return;
  if (!confirm('이 분석 기록을 삭제하시겠습니까?')) return;

  try {
    const res = await apiFetch(`/api/records/${_currentRecordId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    location.href = 'my_analyze.html';
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') return;
    console.error('기록 삭제 실패:', err);
    alert('기록 삭제에 실패했습니다.');
  }
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
