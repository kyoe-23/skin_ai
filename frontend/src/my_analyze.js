// ── 상태 ──
let allRecords = [];
let currentDisease = 'all';
let currentPage = 1;
const itemsPerPage = 5;

// DISEASE_MAP, getDiseaseLabel 은 disease_map.js 에서 글로벌로 제공 (DS_unified 11종)

function toDisplayRecord(r) {
  const conf = r.confidence != null ? Math.round(r.confidence * 100) : 0;
  const info = DISEASE_MAP[r.primary_diagnosis] || { ko: r.primary_diagnosis || '미분류', en: r.primary_diagnosis || '' };
  return {
    id:        r.record_id,
    diag:      info.en,
    diagKo:    info.ko,
    disease:   r.primary_diagnosis || 'unknown',
    date:      r.created_at ? r.created_at.slice(0, 10) : '-',
    conf,
    correct:   r.is_correct === true,
    answered:  r.user_answer != null,
    myAnswer:  r.user_answer || '',
    findings:  [],
    emoji:     '🔬',
    imageUrl:  r.image_url || null,
    status:    r.status,
  };
}

async function loadRecords() {
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  if (!token) {
    document.getElementById('recordList').innerHTML =
      `<div class="empty-state"><div class="empty-icon">🔒</div><div class="empty-title">로그인이 필요합니다</div><div class="empty-text">로그인 후 내 분석 기록을 확인할 수 있습니다</div></div>`;
    return;
  }

  try {
    const res = await apiFetch('/api/records');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { records } = await res.json();
    allRecords = records.map(toDisplayRecord);
  } catch (err) {
    if (err.message === 'SESSION_EXPIRED') return;
    console.error('기록 로드 실패:', err);
    document.getElementById('recordList').innerHTML =
      `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">기록을 불러오지 못했습니다</div></div>`;
    return;
  }

  updateStats();
  applyFilters();
  renderDiseaseChart();
  renderMonthlyChart();
  renderStreak();
}

// ── 필터 ──
function filterDisease(el, val) {
  document.querySelectorAll('#diseaseFilter .chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentDisease = val;
  currentPage = 1;
  applyFilters();
}

function resetFilters() {
  currentDisease = 'all'; currentPage = 1;
  document.querySelectorAll('#diseaseFilter .chip').forEach(c => c.classList.remove('active'));
  document.querySelector('#diseaseFilter [data-filter="all"]').classList.add('active');
  document.getElementById('dateFilter').value = 'all';
  document.getElementById('sortSelect').value = 'latest';
  applyFilters();
}

function applyFilters() {
  const dateVal = document.getElementById('dateFilter').value;
  const sortVal = document.getElementById('sortSelect').value;
  const now = new Date();

  let filtered = allRecords.filter(r => {
    if (currentDisease !== 'all' && r.disease !== currentDisease) return false;
    if (dateVal !== 'all') {
      const diff = (now - new Date(r.date)) / 86400000;
      if (dateVal === 'week' && diff > 7) return false;
      if (dateVal === 'month' && diff > 30) return false;
      if (dateVal === '3month' && diff > 90) return false;
    }
    return true;
  });

  if (sortVal === 'conf_high') filtered.sort((a, b) => b.conf - a.conf);
  else if (sortVal === 'conf_low') filtered.sort((a, b) => a.conf - b.conf);
  else filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

  renderList(filtered);
}

function renderList(records) {
  document.getElementById('recordCount').textContent = `(${records.length}건)`;
  const list = document.getElementById('recordList');

  if (records.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔬</div>
        <div class="empty-title">아직 분석 기록이 없어요</div>
        <div class="empty-text">AI 분석 페이지에서 피부 이미지를<br>분석하면 여기에 기록이 쌓입니다</div>
        <button class="empty-btn" onclick="location.href='ai-analyze.html'">AI 분석 시작하기</button>
      </div>`;
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  const total = Math.ceil(records.length / itemsPerPage);
  const paged = records.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  list.innerHTML = paged.map((r, i) => {
    const confClass = r.conf >= 80 ? 'high-conf' : r.conf >= 65 ? 'med-conf' : 'low-conf';
    const confLabel = r.conf >= 80 ? '고신뢰' : r.conf >= 65 ? '중신뢰' : '저신뢰';
    return `
    <div class="record-item" style="animation-delay:${i * 0.04}s" onclick="openModal(${r.id})">
      <div class="record-thumb">${r.imageUrl ? `<img src="${r.imageUrl}" alt="${r.diagKo}">` : r.emoji || '🔬'}</div>
      <div class="record-body">
        <div class="record-top">
          <div class="record-diag">${r.diag}</div>
          <div class="record-diag-ko">${r.diagKo}</div>
        </div>
        <div class="record-desc">${r.summary || ''}</div>
        <div class="record-tags">
          <span class="tag disease">${getDiseaseLabel(r.disease)}</span>
          <span class="tag ${confClass}">${confLabel} ${r.conf}%</span>
          <span class="tag date">${r.date}</span>
        </div>
      </div>
      <div class="record-right">${renderRing(r.conf)}</div>
    </div>`;
  }).join('');

  const pg = document.getElementById('pagination');
  if (total <= 1) { pg.innerHTML = ''; return; }
  let html = '';
  for (let i = 1; i <= total; i++) {
    html += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="goPage(${i},event)">${i}</button>`;
  }
  pg.innerHTML = html;
}

function goPage(p, e) { e.stopPropagation(); currentPage = p; applyFilters(); }

function renderRing(pct) {
  const r = 16, circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const color = pct >= 80 ? '#16a34a' : pct >= 65 ? '#d97706' : '#dc2626';
  return `<div class="confidence-ring">
    <svg width="40" height="40" viewBox="0 0 40 40">
      <circle class="ring-bg" cx="20" cy="20" r="${r}"/>
      <circle class="ring-fill" cx="20" cy="20" r="${r}" stroke="${color}" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"/>
    </svg>
    <div class="ring-label" style="color:${color}">${pct}%</div>
  </div>`;
}

// ── 모달 ──
function openModal(id) {
  const r = allRecords.find(x => x.id === id);
  if (!r) return;
  document.getElementById('modalTitle').textContent = r.diag;
  document.getElementById('modalDate').textContent = `분석일: ${r.date}`;
  const imgEl = document.getElementById('modalImg');
  imgEl.innerHTML = r.imageUrl ? `<img src="${r.imageUrl}" alt="${r.diagKo}">` : (r.emoji || '🔬');
  document.getElementById('modalDiagName').textContent = r.diag;
  document.getElementById('modalDiagKo').textContent = r.diagKo;
  document.getElementById('modalConf').textContent = `신뢰도 ${r.conf}%`;
  document.getElementById('modalSummaryText').textContent = r.summary || '-';
  document.getElementById('modalFindings').innerHTML = (r.findings || []).map(f =>
    `<div class="modal-finding"><div class="modal-finding-dot"></div>${f}</div>`
  ).join('') || '<div style="font-size:12px;color:#c4cad4;">소견 정보가 없습니다</div>';
  document.getElementById('modalOverlay').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modalOverlay') || e.currentTarget === document.querySelector('.modal-close')) {
    document.getElementById('modalOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }
}

// ── 통계 업데이트 ──
function updateStats() {
  const now = new Date();
  const m = now.getMonth(), y = now.getFullYear();

  const total = allRecords.length;
  const weekCnt = allRecords.filter(r => (now - new Date(r.date)) / 86400000 <= 7).length;
  const thisMon = allRecords.filter(r => { const d = new Date(r.date); return d.getMonth() === m && d.getFullYear() === y; }).length;
  const lastMon = allRecords.filter(r => { const d = new Date(r.date); const lm = m === 0 ? 11 : m - 1; const ly = m === 0 ? y - 1 : y; return d.getMonth() === lm && d.getFullYear() === ly; }).length;
  const uniqueDis = new Set(allRecords.map(r => r.disease)).size;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statWeek').textContent = `이번 주 ${weekCnt}건`;
  document.getElementById('statMonth').textContent = thisMon;
  const delta = thisMon - lastMon;
  const deltaEl = document.getElementById('statMonthDelta');
  deltaEl.textContent = total === 0 ? '지난달 대비 -' : (delta >= 0 ? `▲ 지난달 +${delta}건` : `▼ 지난달 ${delta}건`);
  deltaEl.style.color = delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#6b7280';
  document.getElementById('statDiseases').textContent = uniqueDis;
  document.getElementById('statDiseaseDelta').textContent = `${uniqueDis}개 질환 학습`;
}

// ── 도넛 차트 ──
let donutChart = null;
function renderDiseaseChart() {
  const countMap = {};
  allRecords.forEach(r => { countMap[r.disease] = (countMap[r.disease] || 0) + 1; });
  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]);

  const rankList = document.getElementById('diseaseRankList');
  if (sorted.length === 0) {
    rankList.innerHTML = `<div style="text-align:center;padding:10px 0;font-size:11px;color:#c4cad4;">분석 기록이 없습니다</div>`;
    if (donutChart) { donutChart.destroy(); donutChart = null; }
    return;
  }

  const labels = sorted.map(([d]) => getDiseaseLabel(d));
  const data = sorted.map(([, c]) => c);
  // DS_unified 11종 — 클래스마다 구별되는 색상 11색
  const colors = [
    '#2563eb', '#7c3aed', '#16a34a', '#d97706', '#dc2626',
    '#0891b2', '#9333ea', '#db2777', '#65a30d', '#ea580c', '#475569',
  ];

  const ctx = document.getElementById('diseaseDonutChart').getContext('2d');
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors.slice(0, data.length), borderWidth: 2, borderColor: '#fff', hoverOffset: 5 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw}건 (${Math.round(c.raw / allRecords.length * 100)}%)` } }
      }
    }
  });

  const rankClasses = ['r1', 'r2', 'r3'];
  rankList.innerHTML = sorted.map(([d, c], i) => `
    <div class="disease-rank-item">
      <div class="rank-num ${rankClasses[i] || 'rn'}">${i + 1}</div>
      <div class="rank-name">${getDiseaseLabel(d)}</div>
      <div class="rank-cnt">${c}건</div>
    </div>`).join('');
}

// ── 월별 바 차트 ──
let barChart = null;
function renderMonthlyChart() {
  const now = new Date();
  const months = [], counts = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getMonth() + 1}월`);
    counts.push(allRecords.filter(r => {
      const rd = new Date(r.date);
      return rd.getMonth() === d.getMonth() && rd.getFullYear() === d.getFullYear();
    }).length);
  }

  const ctx = document.getElementById('monthlyBarChart').getContext('2d');
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: '분석 건수', data: counts,
        backgroundColor: counts.map((_, i) => i === counts.length - 1 ? '#2563eb' : '#bfdbfe'),
        borderRadius: 5, borderSkipped: false,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.raw}건` } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af' } },
        y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { stepSize: 1, font: { size: 10 }, color: '#9ca3af' } }
      }
    }
  });
}

// ── 스트릭 (실제 데이터 기반) ──
function renderStreak() {
  const grid = document.getElementById('streakGrid');
  const today = new Date();
  const cells = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const cnt = allRecords.filter(r => r.date === dateStr).length;
    const lv = cnt === 0 ? 0 : cnt === 1 ? 1 : cnt <= 3 ? 2 : 3;
    cells.push(`<div class="streak-day ${lv > 0 ? 'lv' + lv : ''} ${i === 0 ? 'today' : ''}"></div>`);
  }
  grid.innerHTML = cells.join('');
}

// ── 초기화 ──
loadRecords();
