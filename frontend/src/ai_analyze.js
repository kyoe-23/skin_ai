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
    others,
    findings:     [],
    gradcam:      raw.gradcam ?? null,
    clinical_ref: raw.clinical_ref ?? null,
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
//  결과 카드 동적 렌더링 (API 응답 기반)
// ──────────────────────────────────────────
function renderResult(data) {
  const confPct = Math.round(data.primary.confidence * 100);
  document.getElementById('resultConfPill').textContent = `신뢰도 ${confPct}%`;
  document.getElementById('diagName').textContent       = data.primary.nameEn;
  document.getElementById('diagNameKo').textContent     = data.primary.nameKo;
  document.getElementById('diagPctLabel').textContent   = `${confPct}%`;
  document.getElementById('diagBar').style.width        = `${confPct}%`;

  const othersEl  = document.getElementById('otherDiagnoses');
  const diffLabel = document.getElementById('diffDiagLabel');
  if (data.others && data.others.length > 0) {
    diffLabel.style.display = '';
    othersEl.innerHTML = data.others.map(o => {
      const pct = Math.round(o.confidence * 100);
      return `<div class="other-diag">
        <div class="other-diag-name">${o.nameEn} (${o.nameKo})</div>
        <div class="other-bar-bg"><div class="other-bar" style="width:${pct}%"></div></div>
        <div class="other-diag-pct">${pct}%</div>
      </div>`;
    }).join('');
  } else {
    diffLabel.style.display = 'none';
    othersEl.innerHTML = '';
  }

  document.getElementById('findingList').innerHTML = (data.findings || []).map(f =>
    `<div class="finding-item"><div class="finding-dot"></div>${f}</div>`
  ).join('');

  resultCard.style.display = 'block';
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        differential:      lastApiResult.others     || [],
        gradcam_b64:       lastApiResult.gradcam    || null,
        clinical_ref:      lastApiResult.clinical_ref ?? null,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
