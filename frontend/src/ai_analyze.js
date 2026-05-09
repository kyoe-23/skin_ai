// VALID_DISEASES, diseaseByKoName 은 disease_map.js 에서 글로벌로 제공
// DOM 참조
const fileInput        = document.getElementById('fileInput');
const changeInput      = document.getElementById('changeInput');
const uploadZone       = document.getElementById('uploadZone');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const previewWrap       = document.getElementById('previewWrap');
const previewImg        = document.getElementById('previewImg');
const previewName       = document.getElementById('previewName');
const clearBtn          = document.getElementById('clearBtn');
const analyzeBtn        = document.getElementById('analyzeBtn');
const loadingCard       = document.getElementById('loadingCard');
const resultCard        = document.getElementById('resultCard');
const errorCard         = document.getElementById('errorCard');

// 업로드할 원본 파일 (서버에서 EXIF 제거·마스킹 처리)
let currentFile   = null;
let lastApiResult = null;
let chatHistory   = [];   // 이번 세션 채팅 기록 (기록 저장 시 함께 저장)

// ──────────────────────────────────────────
//  사이드바 / 에러 카드 질환 목록 렌더링
// ──────────────────────────────────────────
function renderSidebarDiseases() {
  const el = document.getElementById('sidebarDiseaseList');
  el.innerHTML = VALID_DISEASES.map((d, i) => `
    <div class="guide-item" style="${i === VALID_DISEASES.length - 1 ? 'border-bottom:none;padding-bottom:0' : ''}">
      <div class="guide-num" style="background:#f5f3ff;color:#7c3aed;">${i + 1}</div>
      <div class="guide-text"><strong>${d.nameKo}</strong> <span style="color:#c4cad4;">${d.nameEn}</span></div>
    </div>`).join('');
}

function renderErrorDiseaseChips() {
  document.getElementById('errorDiseaseChips').innerHTML =
    VALID_DISEASES.map(d => `<span class="error-disease-chip">${d.nameKo}</span>`).join('');
}

// ──────────────────────────────────────────
//  파일 선택 처리 (크기 검사 + 미리보기)
// ──────────────────────────────────────────
function loadFile(file) {
  if (file.size > 10 * 1024 * 1024) {
    alert('파일 크기가 10MB를 초과합니다. 더 작은 이미지를 선택해 주세요.');
    return;
  }

  currentFile = file;

  const url = URL.createObjectURL(file);
  previewImg.onload = () => URL.revokeObjectURL(url);
  previewImg.src = url;
  previewName.textContent = file.name;

  uploadPlaceholder.style.display = 'none';
  previewWrap.style.display = 'block';
  uploadZone.classList.add('has-image');
  analyzeBtn.disabled = false;

  resultCard.style.display  = 'none';
  errorCard.style.display   = 'none';
  loadingCard.style.display = 'none';
  lastApiResult = null;
}

fileInput.addEventListener('change',  () => { if (fileInput.files[0])  loadFile(fileInput.files[0]); });
changeInput.addEventListener('change', () => { if (changeInput.files[0]) loadFile(changeInput.files[0]); });
clearBtn.addEventListener('click', e => { e.stopPropagation(); resetAll(); });

uploadZone.addEventListener('dragover',  e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadFile(f);
});

function resetAll() {
  previewWrap.style.display   = 'none';
  uploadPlaceholder.style.display = 'block';
  uploadZone.classList.remove('has-image');
  fileInput.value  = '';
  analyzeBtn.disabled = true;
  resultCard.style.display  = 'none';
  errorCard.style.display   = 'none';
  loadingCard.style.display = 'none';
  currentFile   = null;
  lastApiResult = null;
  chatHistory   = [];
}

// ──────────────────────────────────────────
//  서버 업로드 (EXIF 제거·마스킹·Supabase·DB 는 서버에서 처리)
// ──────────────────────────────────────────
async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file);

  const res = await apiFetch('/api/analyze/upload', {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || '업로드 실패');
  return data.imageUrl;
}

// ──────────────────────────────────────────
//  AI 분석 API 호출
// ──────────────────────────────────────────
async function callAnalyzeAPI(imageUrl) {
  const res = await apiFetch('/api/analyze/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const raw = await res.json();
  if (!raw.success) return { valid: false, reason: raw.error || '분석에 실패했습니다.' };

  const pred = raw.prediction;
  const primaryDisease = diseaseByKoName(pred.class_name);

  const others = (pred.top3 || [])
    .filter(t => t.class !== pred.class_name)
    .map(t => {
      const d = diseaseByKoName(t.class);
      return { key: d.key, nameKo: d.nameKo, nameEn: d.nameEn, confidence: t.prob };
    });

  return {
    valid:        !pred.uncertain,
    reason:       pred.message ?? null,
    primary: {
      key:        primaryDisease.key,
      nameKo:     primaryDisease.nameKo,
      nameEn:     primaryDisease.nameEn,
      confidence: pred.confidence,
    },
    report:          raw.report ?? null,
    gradcam:         raw.gradcam ?? null,
    clinical_ref:    raw.clinical_ref ?? null,
    _rawPrediction:  pred,
  };
}

// ──────────────────────────────────────────
//  분석 시작
// ──────────────────────────────────────────
async function startAnalyze() {
  analyzeBtn.disabled = true;
  resultCard.style.display  = 'none';
  errorCard.style.display   = 'none';
  loadingCard.style.display = 'block';

  try {
    // 서버 업로드와 로딩 애니메이션을 병렬 실행
    const [imageUrl] = await Promise.all([
      uploadImage(currentFile),
      runLoadingSteps()
    ]);

    // AI 분석 API 호출
    const apiResult = await callAnalyzeAPI(imageUrl);

    loadingCard.style.display = 'none';

    if (!apiResult.valid) {
      showError(apiResult.reason || '분석 가능한 피부 질환 이미지가 아닙니다.');
    } else {
      lastApiResult = { ...apiResult, imageUrl };
      renderResult(apiResult);
    }

  } catch (err) {
    loadingCard.style.display = 'none';

    // SESSION_EXPIRED 는 apiFetch가 이미 로그인 페이지로 리다이렉트 — 메시지 표시 불필요
    if (err.message === 'SESSION_EXPIRED') return;

    if (err.message === 'API_NOT_CONNECTED') {
      showError('현재 AI 분석 서버가 연결되지 않았습니다. API 연결 후 이용해 주세요.');
    } else {
      showError(err.message || '분석 중 오류가 발생했습니다. 다시 시도해 주세요.');
    }
  }

  analyzeBtn.disabled = false;
}

// 3단계 로딩 애니메이션 (Promise 반환 — 업로드와 병렬 실행)
function runLoadingSteps() {
  return new Promise((resolve) => {
    const steps = [
      { id: 'step1', duration: 900,  progress: 33  },
      { id: 'step2', duration: 1400, progress: 66  },
      { id: 'step3', duration: 1100, progress: 100 },
    ];
    const bar   = document.getElementById('progressBar');
    const label = document.getElementById('progressLabel');
    let current = 0;

    ['step1', 'step2', 'step3'].forEach(id => {
      const el = document.getElementById(id);
      el.classList.remove('active', 'done');
      el.querySelector('.step-num').textContent = id.replace('step', '');
      el.querySelector('.step-num').style.display = 'flex';
    });
    bar.style.width = '0%'; label.textContent = '0%';

    function runStep(i) {
      if (i >= steps.length) { resolve(); return; }
      const s  = steps[i];
      const el = document.getElementById(s.id);
      if (i > 0) {
        const prev = document.getElementById(steps[i - 1].id);
        prev.classList.remove('active'); prev.classList.add('done');
        prev.querySelector('.step-spinner').style.display = 'none';
        const num = prev.querySelector('.step-num');
        num.style.display = 'flex'; num.textContent = '✓';
      }
      el.classList.add('active');
      const start = current, end = s.progress, startTime = Date.now();
      function animProg() {
        const pct = Math.min((Date.now() - startTime) / s.duration, 1);
        current = Math.round(start + (end - start) * pct);
        bar.style.width = current + '%'; label.textContent = current + '%';
        if (pct < 1) requestAnimationFrame(animProg);
      }
      animProg();
      setTimeout(() => runStep(i + 1), s.duration);
    }
    setTimeout(() => runStep(0), 200);
  });
}

// ──────────────────────────────────────────
//  에러 카드 표시
// ──────────────────────────────────────────
function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  renderErrorDiseaseChips();
  errorCard.style.display = 'block';
  errorCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ──────────────────────────────────────────
//  AI 소견 렌더링 (분리: 비동기 업데이트에도 재사용)
// ──────────────────────────────────────────
function renderFindings(report) {
  const findingEl = document.getElementById('findingList');
  if (!findingEl) return;
  if (report && (report.summary || report.features)) {
    findingEl.removeAttribute('data-loading');
    findingEl.innerHTML = [
      report.summary    && `<div class="finding-item"><div class="finding-dot"></div><div class="finding-text">${report.summary}</div></div>`,
      report.features   && `<div class="finding-item"><div class="finding-dot"></div><div class="finding-text">${report.features}</div></div>`,
      report.advice     && `<div class="finding-item"><div class="finding-dot" style="background:#16a34a"></div><div class="finding-text">${report.advice}</div></div>`,
      report.disclaimer && `<div class="finding-item" style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;"><div class="finding-text" style="color:#92400e;font-size:12px;">${report.disclaimer}</div></div>`,
    ].filter(Boolean).join('');
  } else {
    findingEl.innerHTML = '<div style="font-size:13px;color:#c4cad4;padding:8px 0;">AI 소견이 없습니다 (LLM 비활성 상태)</div>';
  }
}

// ──────────────────────────────────────────
//  LLM 리포트 비동기 로드 (분석 완료 후 별도 요청)
// ──────────────────────────────────────────
async function fetchReportAsync(data) {
  try {
    const res = await apiFetch('/api/analyze/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prediction:   data._rawPrediction,
        clinical_ref: data.clinical_ref,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const result = await res.json();
    if (result.success && result.report) {
      if (lastApiResult) lastApiResult.report = result.report;
      renderFindings(result.report);
    } else {
      renderFindings(null);
    }
  } catch (err) {
    console.error('LLM 리포트 로드 실패:', err);
    const findingEl = document.getElementById('findingList');
    if (findingEl && findingEl.dataset.loading === 'true') {
      findingEl.innerHTML = '<div style="font-size:13px;color:#c4cad4;padding:8px 0;">AI 소견을 불러올 수 없습니다.</div>';
    }
  }
}

// ──────────────────────────────────────────
//  결과 카드 동적 렌더링 (API 응답 기반)
// ──────────────────────────────────────────
function renderResult(data) {
  const confPct = Math.round(data.primary.confidence * 100);
  document.getElementById('resultConfPill').textContent = `신뢰도 ${confPct}%`;
  document.getElementById('diagName').textContent       = data.primary.nameEn;
  document.getElementById('diagNameKo').textContent     = data.primary.nameKo;
  document.getElementById('diagPctLabel').textContent   = `${confPct}%`;
  document.getElementById('diagBar').style.width        = `${confPct}%`;

  // AI 소견: 리포트가 있으면 바로 렌더, 없으면 로딩 후 비동기 요청
  const findingEl = document.getElementById('findingList');
  if (data.report) {
    renderFindings(data.report);
  } else {
    findingEl.dataset.loading = 'true';
    findingEl.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
        <div style="display:flex;gap:4px;align-items:center;">
          <div class="chat-dot"></div><div class="chat-dot"></div><div class="chat-dot"></div>
        </div>
        <span style="font-size:13px;color:#9ca3af;">AI 소견 생성 중...</span>
      </div>`;
    fetchReportAsync(data);
  }

  // 질환 학습 정보 (clinical_ref)
  const clinEl = document.getElementById('clinicalRefSection');
  const clinRef = data.clinical_ref;
  if (clinEl) {
    if (clinRef) {
      const rows = [];
      if (clinRef.age_distribution) {
        const top3 = Object.entries(clinRef.age_distribution).sort((a,b)=>b[1]-a[1]).slice(0,3);
        rows.push(`<div class="info-row"><div class="info-label">주요 연령</div><div class="info-val">${top3.map(([k,v])=>`${k} (${Math.round(v*100)}%)`).join(', ')}</div></div>`);
      }
      if (clinRef.gender_ratio) {
        const g = Object.entries(clinRef.gender_ratio).map(([k,v])=>`${k} ${Math.round(v*100)}%`).join(' / ');
        rows.push(`<div class="info-row"><div class="info-label">성별 분포</div><div class="info-val">${g}</div></div>`);
      }
      if (clinRef.severity_dist) {
        const top = Object.entries(clinRef.severity_dist).sort((a,b)=>b[1]-a[1])[0];
        rows.push(`<div class="info-row"><div class="info-label">주 중증도</div><div class="info-val">${top[0]} (${Math.round(top[1]*100)}%)</div></div>`);
      }
      clinEl.innerHTML = rows.length ? rows.join('') : '<div style="font-size:13px;color:#c4cad4;">데이터 없음</div>';
    } else {
      clinEl.innerHTML = '<div style="font-size:13px;color:#c4cad4;padding:8px 0;">임상 통계 데이터가 없습니다</div>';
    }
  }

  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const chatCard = document.getElementById('chatCard');
  if (chatCard) chatCard.style.display = 'block';
}

// ──────────────────────────────────────────
//  LLM 채팅
// ──────────────────────────────────────────
function setQuestion(el) {
  const input = document.getElementById('chatInput');
  input.value = el.textContent;
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';
  input.focus();
}

const _AI_AVATAR = `<div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>`;

async function sendChat() {
  const input = document.getElementById('chatInput');
  const question = input.value.trim();
  if (!question || !lastApiResult) return;

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
      ${_AI_AVATAR}
      <div style="background:#f3f4f6;border:1px solid #e8eaed;padding:12px 16px;border-radius:4px 16px 16px 16px;display:flex;gap:5px;align-items:center;">
        <div class="chat-dot"></div><div class="chat-dot"></div><div class="chat-dot"></div>
      </div>
    </div>`);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  try {
    const res = await apiFetch('/api/analyze/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        context: {
          class_name: lastApiResult.primary.nameKo,
          confidence: lastApiResult.primary.confidence,
          report:     lastApiResult.report,
        },
      }),
    });
    const data = await res.json();
    const rawAnswer = data.answer || 'LLM이 비활성화되어 있습니다.';
    const safeA = rawAnswer.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    document.getElementById(loadingId)?.remove();
    messagesEl.insertAdjacentHTML('beforeend', `
      <div style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;max-width:90%;">
        ${_AI_AVATAR}
        <div style="background:#f8fafc;border:1px solid #e8eaed;color:#374151;padding:12px 16px;border-radius:4px 16px 16px 16px;font-size:13px;line-height:1.7;">${safeA}</div>
      </div>`);
    chatHistory.push({ role: 'user', content: question, ts: new Date().toISOString() });
    chatHistory.push({ role: 'ai',   content: rawAnswer, ts: new Date().toISOString() });
  } catch {
    document.getElementById(loadingId)?.remove();
    messagesEl.insertAdjacentHTML('beforeend', `
      <div style="align-self:flex-start;display:flex;gap:10px;align-items:flex-start;">
        <div style="width:28px;height:28px;border-radius:8px;background:#fee2e2;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>
        <div style="background:#fef2f2;border:1px solid #fecaca;color:#dc2626;padding:10px 14px;border-radius:4px 16px 16px 16px;font-size:13px;">오류가 발생했습니다. 다시 시도해주세요.</div>
      </div>`);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ──────────────────────────────────────────
//  기록 저장
// ──────────────────────────────────────────
async function saveRecord() {
  if (!lastApiResult?.imageUrl) return;

  const saveBtn = document.querySelector('.action-btn.primary[onclick="saveRecord()"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }

  try {
    const primary = lastApiResult.primary;
    const res = await apiFetch('/api/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url:         lastApiResult.imageUrl,
        primary_diagnosis: primary.nameKo,
        confidence:        primary.confidence,
        differential:      lastApiResult.others      || [],
        gradcam_b64:       lastApiResult.gradcam     || null,
        clinical_ref:      lastApiResult.clinical_ref ?? null,
        ai_findings:       lastApiResult.report ? JSON.stringify(lastApiResult.report) : null,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json();

    // 채팅 기록이 있으면 PATCH로 별도 저장 (chat_history 컬럼 선택적)
    if (chatHistory.length > 0 && saved?.record?.record_id) {
      try {
        await apiFetch(`/api/records/${saved.record.record_id}/chat`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: chatHistory }),
        });
      } catch (chatErr) {
        console.warn('채팅 기록 저장 실패 (무시):', chatErr);
      }
    }

    alert('기록이 저장됐습니다.');
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') return;
    console.error('기록 저장 실패:', err);
    alert('저장 중 오류가 발생했습니다.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '기록 저장'; }
  }
}

// 초기화
renderSidebarDiseases();
renderErrorDiseaseChips();
