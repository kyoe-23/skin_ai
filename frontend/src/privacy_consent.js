const sections = [
  {
    title: '목적 및 범위 정의',
    law: '개인정보보호법 제15조',
    laws: ['개인정보보호법 제15조 (개인정보의 수집·이용)'],
    contents: [
      '교육 콘텐츠 제작, AI 학습 활용 등 수집 목적 범위 내에서만 이용합니다.',
      '목적이 변경될 경우 별도의 재동의를 받습니다.',
      '교육 목적 / 연구 목적 / AI 학습 목적을 각각 구분하여 처리합니다.'
    ]
  },
  {
    title: '민감정보 (피부질환 이미지) 수집 동의',
    law: '개인정보보호법 제23조',
    laws: ['개인정보보호법 제23조 (민감정보의 처리 제한)', '개인정보보호법 시행령 제18조 (민감정보의 범위)'],
    contents: [
      '피부질환 이미지는 건강정보에 해당하는 민감정보로 분류됩니다.',
      '수집 항목: 피부 이미지, 진단명, AI 분석 결과 등',
      '민감정보는 일반 개인정보와 별도로 관리됩니다.'
    ],
    warning: '위반 시 3천만 원 이하의 과태료가 부과될 수 있습니다.'
  },
  {
    title: '비식별화 및 마스킹 처리 동의',
    law: '개인정보보호법 제23조, 제29조',
    laws: ['개인정보보호법 제23조 제2항', '개인정보보호법 제29조 (안전성 확보 조치 의무)'],
    contents: [
      '이미지 상단/하단 라벨 영역 블랙 마스킹 처리를 수행합니다.',
      '눈·코·입 등 안면 식별 특징점 마스킹 처리를 수행합니다.',
      'EXIF 메타데이터(GPS 위치, 기기정보, 촬영시간)를 완전 제거합니다.',
      '재식별 시도는 금지되며, 발생 시 즉시 파기 및 보고합니다.'
    ]
  },
  {
    title: '이용 주체 및 접근 범위 동의',
    law: '개인정보보호법 제15조, 제18조',
    laws: ['개인정보보호법 제15조 (수집·이용)', '개인정보보호법 제18조 (목적 외 이용·제공 제한)'],
    contents: [
      '내부 사용자(전공의, 의대생)와 외부 제휴기관의 접근 범위를 구분합니다.',
      '내부 폐쇄형 교육과 외부 공개 콘텐츠를 분리하여 운영합니다.',
      '이미지의 다운로드 및 외부 재사용은 허용하지 않습니다.'
    ]
  },
  {
    title: '제3자 제공 및 처리위탁 동의',
    law: '개인정보보호법 제17조, 제26조',
    laws: ['개인정보보호법 제17조 (제3자 제공)', '개인정보보호법 제26조 (처리위탁)'],
    contents: [
      'Supabase (클라우드 스토리지): 이미지 및 데이터 저장 위탁',
      'Anthropic Claude API: AI 분석 및 피드백 생성 위탁',
      '위탁 업체는 위탁 목적 외 개인정보를 처리하지 않습니다.',
      '국외 이전(Supabase, Anthropic) 시 별도 고지 의무를 준수합니다.'
    ]
  },
  {
    title: '보유 및 이용 기간 동의',
    law: '개인정보보호법 제21조',
    laws: ['개인정보보호법 제21조 (개인정보의 파기)'],
    contents: [
      '개인정보 보유 기간: 회원 탈퇴 후 5년',
      '분석 이미지 보유 기간: 분석 완료 후 3년',
      '보유 기간 종료 시 지체 없이 완전 삭제 또는 비식별 전환합니다.',
      '장기 보관이 필요한 경우 추가 동의를 받습니다.'
    ]
  },
  {
    title: '동의 거부권 및 불이익 고지',
    law: '개인정보보호법 제22조',
    laws: ['개인정보보호법 제22조 (동의 방법)'],
    contents: [
      '정보주체는 개인정보 수집·이용에 동의하지 않을 권리가 있습니다.',
      '동의 거부 시 SkinAI 플랫폼 서비스 이용이 제한될 수 있습니다.',
      '동의 거부가 진료 및 치료에는 어떠한 영향도 미치지 않습니다.'
    ]
  },
  {
    title: '권리 행사 및 동의 철회',
    law: '개인정보보호법 제35조, 제36조, 제37조',
    laws: ['개인정보보호법 제35조 (열람)', '개인정보보호법 제36조 (정정·삭제)', '개인정보보호법 제37조 (처리정지)'],
    contents: [
      '열람, 정정, 삭제, 처리정지 요청이 가능합니다.',
      '요구를 받은 날로부터 10일 이내 조치 및 결과를 통지합니다.',
      '동의 철회 시 즉시 데이터 파기 절차를 진행합니다.'
    ]
  },
  {
    title: '안전성 확보 조치 확인',
    law: '개인정보보호법 제29조',
    laws: ['개인정보보호법 제29조 (안전성 확보 조치 의무)'],
    contents: [
      '접근 권한 관리: Supabase RLS, JWT 인증 토큰 적용',
      '암호화 저장: bcrypt 비밀번호 해시, HTTPS 통신 암호화',
      '접속 기록 관리 및 내부 관리계획을 수립하여 운영합니다.'
    ]
  },
  {
    title: '의료법 관련 동의',
    law: '의료법 제19조, 제21조',
    laws: ['의료법 제19조 (비밀 누설 금지)', '의료법 제21조 (기록 열람 등)'],
    contents: [
      '의료인 및 종사자의 환자 건강정보 누설을 금지합니다.',
      '의료기관 외부 플랫폼(SkinAI)으로 데이터 이동 시 별도 환자 동의를 받습니다.',
      '플랫폼 운영 주체가 병원 외부인 경우 별도 법률 검토를 거칩니다.'
    ]
  }
];

// 0: 미선택, 1: 동의, -1: 비동의
let states = new Array(sections.length).fill(0);
let openIdx = null;

function render() {
  const list = document.getElementById('sectionList');
  list.innerHTML = sections.map((s, i) => {
    const isOpen = openIdx === i;
    const state = states[i];
    const cardClass = state === 1 ? 'agreed' : (isOpen ? 'open' : '');
    const statusText = state === 1 ? '동의완료' : (state === -1 ? '비동의' : '확인필요');
    const statusClass = state === 1 ? 'done' : '';

    return `
    <div class="section-card ${cardClass}" id="card${i}">
      <div class="section-header" onclick="toggleSection(${i})">
        <div class="section-header-left">
          <span class="required-badge">필수</span>
          <div>
            <div class="section-title">${i+1}. ${s.title}</div>
            <div class="section-law">${s.law}</div>
          </div>
        </div>
        <div class="section-status">
          <span class="status-badge ${statusClass}">${statusText}</span>
          <svg class="chevron" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
      <div class="section-body ${isOpen ? 'open' : ''}">
        <div class="section-body-inner">
          <div class="body-label">근거 법령</div>
          <div class="law-tags">
            ${s.laws.map(l => `<span class="law-tag">${l}</span>`).join('')}
          </div>
          <div class="body-label">주요 내용</div>
          <div class="content-list">
            ${s.contents.map(c => `
              <div class="content-item">
                <div class="content-dot"></div>
                <span>${c}</span>
              </div>`).join('')}
          </div>
          ${s.warning ? `
            <div class="warning-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>${s.warning}</span>
            </div>` : ''}
          <div class="agree-area">
            <div class="agree-area-text">위 내용을 확인하였으며<br><span>${s.title}</span>에 동의하십니까?</div>
            <div class="agree-btns">
              <button class="disagree-btn ${state === -1 ? 'active' : ''}" onclick="setAgree(${i}, -1)">비동의</button>
              <button class="agree-btn ${state === 1 ? 'active' : ''}" onclick="setAgree(${i}, 1)">동의</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  updateProgress();
}

function toggleSection(i) {
  openIdx = openIdx === i ? null : i;
  render();
}

function setAgree(i, val) {
  states[i] = val;
  if (val === 1 && i < sections.length - 1) {
    openIdx = i + 1;
  } else {
    openIdx = i;
  }
  document.getElementById('errorMsg').classList.remove('show');
  render();
}

function updateProgress() {
  const count = states.filter(s => s === 1).length;
  const total = sections.length;
  document.getElementById('progressCount').textContent = `${count} / ${total}`;
  document.getElementById('progressFill').style.width = (count / total * 100) + '%';
  document.getElementById('submitBtn').disabled = count < total;
}

function handleSubmit() {
  const allAgreed = states.every(s => s === 1);
  if (!allAgreed) {
    document.getElementById('errorMsg').classList.add('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  sessionStorage.setItem('privacyConsent', 'true');
  window.location.href = 'signup.html';
}

function goBack() {
  window.location.href = 'signup.html';
}

render();
