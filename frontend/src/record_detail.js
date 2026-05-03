const DISEASE_MAP = {
  psoriasis:         { ko: '건선',        en: 'Psoriasis' },
  atopic_dermatitis: { ko: '아토피피부염', en: 'Atopic Dermatitis' },
  acne:              { ko: '여드름',       en: 'Acne Vulgaris' },
  rosacea:           { ko: '주사',         en: 'Rosacea' },
  seborrheic:        { ko: '지루피부염',   en: 'Seborrheic Dermatitis' },
  normal:            { ko: '정상',         en: 'Normal' },
};

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

  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch(`/api/records/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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

    const resultChip = document.getElementById('detailResult');
    if (r.user_answer == null) {
      resultChip.textContent = '미답변';
      resultChip.className = 'meta-chip chip-gray';
    } else if (r.is_correct) {
      resultChip.textContent = '정답';
      resultChip.className = 'meta-chip chip-green';
    } else {
      resultChip.textContent = '오답';
      resultChip.className = 'meta-chip chip-red';
    }

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

    // 내 답변 vs AI
    const myAnswerInfo = r.user_answer ? (DISEASE_MAP[r.user_answer] || { ko: r.user_answer, en: r.user_answer }) : null;
    document.getElementById('myAnswer').textContent = myAnswerInfo ? myAnswerInfo.ko : '미답변';
    document.querySelector('.compare-box.my .compare-sub').textContent = myAnswerInfo ? myAnswerInfo.en : '-';
    const compareResult = document.getElementById('compareResult');
    if (r.user_answer == null) {
      compareResult.className = 'compare-result';
      compareResult.style.color = '#9ca3af';
      compareResult.innerHTML = '<span>-</span>';
    } else if (r.is_correct) {
      compareResult.className = 'compare-result correct';
      compareResult.innerHTML = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>정답`;
    } else {
      compareResult.className = 'compare-result wrong';
      compareResult.innerHTML = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>오답`;
    }
    document.getElementById('aiAnswer').textContent = info.ko;
    document.querySelector('.compare-box.ai .compare-sub').textContent = info.en;

    // 감별진단
    const diffData = r.differential || [];
    const allDiff = [
      { nameKo: info.ko, nameEn: info.en, confidence: r.confidence },
      ...diffData.map(d => {
        const di = DISEASE_MAP[d.key] || { ko: d.nameKo || d.key, en: d.nameEn || d.key };
        return { nameKo: di.ko, nameEn: di.en, confidence: d.confidence };
      }),
    ];
    document.getElementById('diffList').innerHTML = allDiff.map((d, i) => {
      const pct = Math.round((d.confidence || 0) * 100);
      const isFirst = i === 0;
      return `<div class="diff-item">
        <div class="diff-rank ${isFirst ? 'first' : 'other'}">${i + 1}</div>
        <div class="diff-info">
          <div class="diff-name">${d.nameKo}</div>
          <div class="diff-name-en">${d.nameEn}</div>
        </div>
        <div class="diff-bar-wrap">
          <div class="diff-bar-row">
            <div class="diff-bar-bg"><div class="diff-bar ${isFirst ? '' : 'low'}" style="width:${pct}%"></div></div>
            <div class="diff-pct ${isFirst ? '' : 'low'}">${pct}%</div>
          </div>
        </div>
      </div>`;
    }).join('');

    // AI 소견
    const findings = r.ai_findings ? r.ai_findings.split('\n').filter(Boolean) : [];
    document.getElementById('findingList').innerHTML = findings.length
      ? findings.map(f => `<div class="finding-item"><div class="finding-dot"></div><div class="finding-text">${f}</div></div>`).join('')
      : '<div style="font-size:13px;color:#c4cad4;padding:8px 0;">AI 소견 정보가 없습니다</div>';

    animateDiffBars();
  } catch (err) {
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


// ── 토스트 ───────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' ' + type : '') + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}
