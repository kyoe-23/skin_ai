// ── 현재 로그인 유저 ──
const ME = { id:'user_me', author:'김전공', role:'resident', avatar:'김', avatarColor:'linear-gradient(135deg,#f59e0b,#ef4444)', dept:'피부과' };

// ── 데이터 ──
let posts = [
  { id:1, userId:'user_01', author:'박지현', role:'resident', avatar:'박', avatarColor:'linear-gradient(135deg,#2563eb,#7c3aed)', dept:'피부과', date:'2시간 전', tags:['여드름','감별진단'], title:'20대 여성, 뺨 부위 구진성 병변 — 여드름 vs 주사 감별 어떻게 하셨나요?', content:'외래에서 20대 초반 여성 환자 봤는데 뺨과 코 주위로 홍반성 구진이 산재해 있었습니다. 여드름과 주사를 감별해야 했는데 AI 분류 결과랑 제 소견이 달라서 공유해봅니다.\n\n병변 분포가 뺨 중심부에 집중되어 있고, 코 주변 홍조도 동반되어 있어서 주사를 먼저 고려했는데 AI는 87% 여드름으로 분류했네요.', media:[], likes:24, liked:false, views:142, comments:[] },
  { id:2, userId:'user_02', author:'이준혁', role:'student', avatar:'이', avatarColor:'linear-gradient(135deg,#059669,#0d9488)', dept:'본과 3학년', date:'5시간 전', tags:['습진','질문'], title:'AI가 접촉성 피부염으로 분류했는데 아토피와 어떻게 구분하나요?', content:'실습 중에 찍은 케이스인데 AI 학습 결과 접촉성 피부염 85% 신뢰도로 나왔습니다. 분포 패턴이 아토피랑도 비슷해 보여서 선생님들 의견 구합니다.', media:[], likes:11, liked:false, views:89, comments:[] },
  { id:3, userId:'user_03', author:'박민서', role:'student', avatar:'박', avatarColor:'linear-gradient(135deg,#059669,#10b981)', dept:'본과 2학년', date:'어제', tags:['색소 질환','멜라스마'], title:'멜라스마 vs 기미 — AI 분류 결과랑 교과서 소견이 다르게 나왔어요', content:'색소성 질환 공부하다가 올립니다. AI 분류 결과와 교과서 기술이 달라서 선배님들 의견 구합니다.', media:[], likes:14, liked:false, views:97, comments:[] }
];
let nextId = 4;
let currentPostId = null;
let deleteTargetId = null;
let mediaFiles = [];
let tags = [];
let currentFilter = '전체';
let searchQuery = '';

const DISEASE_TAGS = ['여드름','습진','건선','주사','지루성 피부염','색소 질환','두드러기','멜라스마','백반증','아토피','켈로이드','모낭염'];
const TAG_COUNTS   = { '여드름':42,'습진':38,'건선':31,'주사':28,'지루성 피부염':24,'색소 질환':19,'두드러기':15,'멜라스마':12,'백반증':9,'아토피':33,'켈로이드':7,'모낭염':11 };

// ── 유틸 ──
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function autoResize(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }
function roleBadge(role) {
  const map={resident:'전공의',student:'의대생'};
  const cls={resident:'badge-resident',student:'badge-student'};
  return `<span class="role-badge ${cls[role]||''}">${map[role]||''}</span>`;
}
function timeAgo(date) {
  if (typeof date==='string') return date;
  const s=Math.floor((Date.now()-date)/1000);
  if (s<60) return '방금 전';
  if (s<3600) return `${Math.floor(s/60)}분 전`;
  return `${Math.floor(s/3600)}시간 전`;
}

// ── 페이지 전환 ──
function showPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0,0);
}
function goFeed() { renderFeed(); showPage('feedPage'); }
function goWrite() { showPage('writePage'); }
function goDetail(id) { currentPostId=id; renderDetail(); showPage('detailPage'); }

// ── 새로고침 ──
function handleRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  setTimeout(() => { btn.classList.remove('spinning'); renderFeed(); showToast('새로고침 완료!'); }, 600);
}

// ── 필터 ──
function setFilter(el) {
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  currentFilter = el.dataset.filter;
  renderFeed();
}
function filterByTag(tag) {
  // 사이드바 태그 클릭 → 피드로 이동 후 필터
  goFeed();
  // 필터 칩 중 해당 태그 있으면 활성화, 없으면 전체로
  const chip = [...document.querySelectorAll('.filter-chip')].find(c=>c.dataset.filter===tag);
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  if (chip) { chip.classList.add('active'); currentFilter=tag; }
  else { document.querySelector('[data-filter="전체"]').classList.add('active'); currentFilter='전체'; }
  renderFeed();
}
function handleSearch(val) { searchQuery=val.trim().toLowerCase(); renderFeed(); }

// ── 피드 렌더 ──
function renderFeed() {
  const feed = document.getElementById('feed');
  let filtered = posts.slice().reverse();

  if (currentFilter !== '전체') {
    filtered = filtered.filter(p => p.tags.some(t => t.toLowerCase().includes(currentFilter.toLowerCase())));
  }
  if (searchQuery) {
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(searchQuery) ||
      p.content.toLowerCase().includes(searchQuery) ||
      p.tags.some(t=>t.toLowerCase().includes(searchQuery))
    );
  }

  if (!filtered.length) {
    feed.innerHTML = `<div class="empty-feed"><div class="empty-feed-icon">🔍</div>해당 태그의 게시글이 없어요</div>`;
    return;
  }

  feed.innerHTML = filtered.map(p => {
    const isMine = p.userId === ME.id;
    return `
    <div class="post-card animate-in" id="postCard${p.id}">
      <div class="post-card-top">
        <div class="post-meta">
          <div class="post-avatar" style="background:${p.avatarColor}">${p.avatar}</div>
          <div>
            <div class="post-author">${p.author} ${roleBadge(p.role)}</div>
            <div class="post-date">${timeAgo(p.date)} · ${p.dept}</div>
          </div>
        </div>
        ${isMine ? `<button class="delete-btn" onclick="openDeleteModal(${p.id})" title="게시글 삭제">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>` : ''}
      </div>
      <div class="post-tags" onclick="event.stopPropagation()">${p.tags.map(t=>`<span class="post-tag primary" onclick="filterByTagClick('${t}')"># ${t}</span>`).join('')}</div>
      <div class="post-title" onclick="goDetail(${p.id})">${p.title}</div>
      <div class="post-preview" onclick="goDetail(${p.id})">${p.content.replace(/\n/g,' ')}</div>
      ${p.media.length ? `<div class="post-media">${p.media.slice(0,3).map(m=>
        m.type==='image'
          ? `<div class="post-media-thumb" onclick="goDetail(${p.id})"><img src="${m.url}" alt=""></div>`
          : `<div class="post-media-thumb" onclick="goDetail(${p.id})"><video src="${m.url}"></video><div class="video-badge">▶ 영상</div></div>`
      ).join('')}${p.media.length>3?`<div class="post-media-thumb" style="font-size:13px;color:#9ca3af;background:#f3f4f6;">+${p.media.length-3}</div>`:''}</div>` : ''}
      <div class="post-footer">
        <button class="post-stat ${p.liked?'liked':''}" onclick="toggleLike(${p.id},this)">
          <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span>${p.likes}</span>
        </button>
        <button class="post-stat" onclick="goDetail(${p.id})">
          <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span>${p.comments.length}</span>
        </button>
        <button class="post-stat" onclick="sharePost(${p.id})">
          <svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          공유
        </button>
        <span class="post-views">조회 ${p.views}</span>
      </div>
    </div>`;
  }).join('');
}

// 게시글 태그 클릭 → 필터 적용
function filterByTagClick(tag) {
  currentFilter = tag;
  const chip = [...document.querySelectorAll('.filter-chip')].find(c=>c.dataset.filter===tag);
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  if (chip) chip.classList.add('active');
  else document.querySelector('[data-filter="전체"]').classList.add('active');
  renderFeed();
  showToast(`# ${tag} 태그 필터 적용`);
}

// ── 좋아요 ──
function toggleLike(id, el) {
  const p=posts.find(x=>x.id===id);
  p.liked=!p.liked; p.likes+=p.liked?1:-1;
  el.classList.toggle('liked',p.liked);
  el.querySelector('span').textContent=p.likes;
}

// ── 공유 ──
function sharePost(id) {
  navigator.clipboard.writeText(`https://skinai.kr/community/${id}`).catch(()=>{});
  showToast('링크가 복사됐어요!');
}

// ── 삭제 모달 ──
function openDeleteModal(id) {
  deleteTargetId = id;
  document.getElementById('deleteModal').classList.add('show');
}
function closeDeleteModal() {
  deleteTargetId = null;
  document.getElementById('deleteModal').classList.remove('show');
}
function confirmDelete() {
  posts = posts.filter(p => p.id !== deleteTargetId);
  closeDeleteModal();
  renderFeed();
  showToast('게시글이 삭제됐어요');
}
document.getElementById('deleteModal').addEventListener('click', function(e) {
  if (e.target === this) closeDeleteModal();
});

// ── 태그 입력 (인스타 스타일) ──
const tagInput = document.getElementById('tagBareInput');
const tagSuggestions = document.getElementById('tagSuggestions');

tagInput.addEventListener('input', e => {
  const val = e.target.value;
  const query = val.replace(/^#/,'').toLowerCase();
  if (query.length > 0) {
    const matches = DISEASE_TAGS.filter(t => t.toLowerCase().includes(query) && !tags.includes(t));
    if (matches.length) {
      tagSuggestions.innerHTML = matches.map(t=>`
        <div class="tag-suggestion-item" onclick="addTag('${t}')">
          <span class="tag-suggestion-hash">#</span>${t}
          <span class="tag-suggestion-count">${TAG_COUNTS[t]||0}개 게시글</span>
        </div>`).join('');
      tagSuggestions.classList.add('show');
    } else tagSuggestions.classList.remove('show');
  } else tagSuggestions.classList.remove('show');
});

tagInput.addEventListener('keydown', e => {
  if (e.key==='Enter'||e.key===',') {
    e.preventDefault();
    const v = e.target.value.trim().replace(/^#/,'');
    if (v) addTag(v);
  }
  if (e.key==='Backspace' && !e.target.value && tags.length) { tags.pop(); renderTags(); }
  if (e.key==='Escape') tagSuggestions.classList.remove('show');
});

document.addEventListener('click', e => {
  if (!e.target.closest('.tag-dropdown')) tagSuggestions.classList.remove('show');
});

function addTag(v) {
  v = v.trim();
  if (v && !tags.includes(v)) { tags.push(v); renderTags(); }
  tagInput.value=''; tagSuggestions.classList.remove('show'); tagInput.focus();
}
function addPresetTag(v) { addTag(v); }
function removeTag(i) { tags.splice(i,1); renderTags(); }

function renderTags() {
  const wrap=document.getElementById('tagWrap');
  wrap.querySelectorAll('.tag-pill').forEach(el=>el.remove());
  const input=document.getElementById('tagBareInput');
  tags.forEach((t,i)=>{
    const pill=document.createElement('div');
    pill.className='tag-pill';
    pill.innerHTML=`<span># ${t}</span><button onclick="removeTag(${i})">×</button>`;
    wrap.insertBefore(pill,input);
  });
}

// ── 미디어 ──
function handleMedia(input) {
  Array.from(input.files).forEach(f=>{
    const url=URL.createObjectURL(f);
    const type=f.type.startsWith('video')?'video':'image';
    mediaFiles.push({file:f,url,type});
  });
  renderMediaPreview();
}
function renderMediaPreview() {
  document.getElementById('mediaPreviewList').innerHTML=mediaFiles.map((m,i)=>`
    <div class="media-preview-item">
      ${m.type==='image'?`<img src="${m.url}">`:`<video src="${m.url}"></video><div class="video-badge">▶ 영상</div>`}
      <button class="media-remove" onclick="removeMedia(${i})">×</button>
    </div>`).join('');
}
function removeMedia(i) { mediaFiles.splice(i,1); renderMediaPreview(); }

const mz=document.getElementById('mediaZone');
mz.addEventListener('dragover',e=>{e.preventDefault();mz.style.borderColor='#2563eb';mz.style.background='#eff6ff';});
mz.addEventListener('dragleave',()=>{mz.style.borderColor='';mz.style.background='';});
mz.addEventListener('drop',e=>{
  e.preventDefault();mz.style.borderColor='';mz.style.background='';
  Array.from(e.dataTransfer.files).forEach(f=>{
    if(f.type.startsWith('image')||f.type.startsWith('video')){
      mediaFiles.push({file:f,url:URL.createObjectURL(f),type:f.type.startsWith('video')?'video':'image'});
    }
  });
  renderMediaPreview();
});

// ── 게시글 제출 ──
async function submitPost() {
  const title=document.getElementById('writeTitle').value.trim();
  const content=document.getElementById('writeContent').value.trim();
  if (!title) { showToast('제목을 입력해주세요'); return; }
  if (!content) { showToast('내용을 입력해주세요'); return; }

  const overlay=document.getElementById('uploadOverlay');
  const overlayStep=document.getElementById('overlayStep');
  const overlayProg=document.getElementById('overlayProgress');
  overlay.classList.add('show');

  const steps=['파일 업로드 중','게시글 저장 중','완료 처리 중'];
  const progs=[40,75,100];
  for(let i=0;i<steps.length;i++){
    overlayStep.textContent=steps[i]; overlayProg.style.width=progs[i]+'%';
    await new Promise(r=>setTimeout(r,700+i*300));
  }

  posts.push({
    id:nextId++, userId:ME.id,
    author:ME.author, role:ME.role, avatar:ME.avatar,
    avatarColor:ME.avatarColor, dept:ME.dept, date:Date.now(),
    tags:tags.length?[...tags]:['케이스공유'],
    title, content,
    media:mediaFiles.map(m=>({url:m.url,type:m.type})),
    likes:0, liked:false, views:0, comments:[]
  });

  // 새 태그 필터 칩 동적 추가
  tags.forEach(tag => {
    const bar=document.getElementById('filterBar');
    const exists=[...bar.querySelectorAll('.filter-chip')].some(c=>c.dataset.filter===tag);
    if(!exists){
      const chip=document.createElement('div');
      chip.className='filter-chip'; chip.dataset.filter=tag;
      chip.textContent=tag; chip.onclick=function(){setFilter(this);};
      bar.insertBefore(chip, bar.querySelector('.search-wrap'));
    }
  });

  document.getElementById('writeTitle').value='';
  document.getElementById('writeContent').value='';
  tags=[]; renderTags(); mediaFiles=[]; renderMediaPreview();
  document.getElementById('mediaInput').value='';
  overlay.classList.remove('show'); overlayProg.style.width='0%';
  currentFilter='전체';
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  document.querySelector('[data-filter="전체"]').classList.add('active');
  renderFeed(); showPage('feedPage');
  setTimeout(()=>showToast('게시글이 등록됐어요! 🎉'),300);
}

// ── 상세 ──
function renderDetail() {
  const p=posts.find(x=>x.id===currentPostId); if(!p) return;
  p.views++;
  document.getElementById('detailMeta').innerHTML=`
    <div class="post-avatar" style="background:${p.avatarColor}">${p.avatar}</div>
    <div style="flex:1"><div class="post-author">${p.author} ${roleBadge(p.role)}</div><div class="post-date">${timeAgo(p.date)} · ${p.dept}</div></div>`;
  document.getElementById('detailTags').innerHTML=p.tags.map(t=>`<span class="post-tag primary"># ${t}</span>`).join('');
  document.getElementById('detailTitle').textContent=p.title;
  document.getElementById('detailContent').innerHTML=p.content.replace(/\n/g,'<br>');
  document.getElementById('detailMedia').innerHTML=p.media.map(m=>
    m.type==='image'
      ? `<img src="${m.url}" alt="" style="max-width:100%;border-radius:10px;border:1px solid #e8eaed;max-height:320px;object-fit:cover;">`
      : `<video src="${m.url}" controls style="max-width:100%;border-radius:10px;border:1px solid #e8eaed;max-height:320px;"></video>`
  ).join('');
  document.getElementById('detailFooter').innerHTML=`
    <button class="post-stat ${p.liked?'liked':''}" id="detailLike" onclick="toggleDetailLike()">
      <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      <span id="detailLikeCount">${p.likes}</span>
    </button>
    <button class="post-stat"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>${p.comments.length}</span></button>
    <button class="post-stat" onclick="sharePost(${p.id})"><svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>공유하기</button>
    <span class="post-views">조회 ${p.views}</span>
    <button class="post-stat" onclick="navigateTo('post_detail.html')" style="margin-left:auto;color:#2563eb;font-weight:600;"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>상세 보기</button>`;
  renderComments();
}
function toggleDetailLike() {
  const p=posts.find(x=>x.id===currentPostId);
  p.liked=!p.liked; p.likes+=p.liked?1:-1;
  const el=document.getElementById('detailLike');
  el.classList.toggle('liked',p.liked);
  document.getElementById('detailLikeCount').textContent=p.likes;
}

// ── 댓글 ──
function renderComments() {
  const p=posts.find(x=>x.id===currentPostId);
  document.getElementById('commentsHeader').textContent=`댓글 ${p.comments.length}개`;
  document.getElementById('commentList').innerHTML=p.comments.map((c,ci)=>{
    const isMine = c.author === ME.author;
    return `
    <div class="comment-item" id="commentItem${ci}">
      <div class="comment-meta">
        <div class="comment-avatar" style="background:${c.avatarColor}">${c.avatar}</div>
        <span class="comment-author">${c.author}</span>
        <span class="comment-date">${timeAgo(c.date)}</span>
        ${isMine ? `<div class="comment-menu-wrap" style="margin-left:auto;position:relative;">
          <button class="comment-action-btn" onclick="toggleCommentMenu(${ci})" style="font-size:16px;color:#c4cad4;padding:2px 6px;">···</button>
          <div class="comment-menu" id="commentMenu${ci}">
            <div class="comment-menu-item" onclick="startEditComment(${ci})">✏️ 수정</div>
            <div class="comment-menu-item delete" onclick="deleteComment(${ci})">🗑️ 삭제</div>
          </div>
        </div>` : ''}
      </div>
      <div id="commentTextWrap${ci}">
        <div class="comment-text" id="commentText${ci}">${c.text}</div>
      </div>
      <div class="comment-edit-form" id="commentEditForm${ci}">
        <div class="reply-input-wrap" style="margin-left:36px;">
          <textarea class="reply-input" id="commentEditInput${ci}" rows="1" oninput="autoResize(this)">${c.text}</textarea>
        </div>
        <div style="margin-left:36px;margin-top:6px;display:flex;gap:6px;">
          <button class="reply-send-btn" style="background:#6b7280;" onclick="cancelEditComment(${ci})">취소</button>
          <button class="reply-send-btn" onclick="saveEditComment(${ci})">저장</button>
        </div>
      </div>
      <div class="comment-actions">
        <button class="comment-action-btn ${c.liked?'liked':''}" onclick="toggleCommentLike(${ci})">♥ ${c.likes}</button>
        <button class="comment-action-btn" onclick="toggleReplyForm(${ci})">답글 달기</button>
      </div>
      ${c.replies.length?`<div class="reply-list">${c.replies.map((r,ri)=>{
        const isMyReply = r.author === ME.author;
        return `
        <div class="reply-item" id="replyItem${ci}_${ri}">
          <div class="reply-line"></div>
          <div class="reply-content">
            <div class="reply-meta">
              <div class="comment-avatar" style="background:${r.avatarColor};width:24px;height:24px;font-size:10px;">${r.avatar}</div>
              <span class="comment-author" style="font-size:12px;">${r.author}</span>
              <span class="comment-date">${timeAgo(r.date)}</span>
              ${isMyReply?`<div class="comment-menu-wrap" style="margin-left:auto;position:relative;">
                <button class="comment-action-btn" onclick="toggleReplyMenu(${ci},${ri})" style="font-size:16px;color:#c4cad4;padding:2px 6px;">···</button>
                <div class="comment-menu" id="replyMenu${ci}_${ri}">
                  <div class="comment-menu-item" onclick="startEditReply(${ci},${ri})">✏️ 수정</div>
                  <div class="comment-menu-item delete" onclick="deleteReply(${ci},${ri})">🗑️ 삭제</div>
                </div>
              </div>`:''}
            </div>
            <div id="replyTextWrap${ci}_${ri}">
              <div class="reply-text" id="replyText${ci}_${ri}">${r.text}</div>
            </div>
            <div class="comment-edit-form" id="replyEditForm${ci}_${ri}">
              <div class="reply-input-wrap">
                <textarea class="reply-input" id="replyEditInput${ci}_${ri}" rows="1" oninput="autoResize(this)">${r.text}</textarea>
              </div>
              <div style="margin-top:6px;display:flex;gap:6px;">
                <button class="reply-send-btn" style="background:#6b7280;" onclick="cancelEditReply(${ci},${ri})">취소</button>
                <button class="reply-send-btn" onclick="saveEditReply(${ci},${ri})">저장</button>
              </div>
            </div>
          </div>
        </div>`;
      }).join('')}</div>`:''}
      <div class="reply-form" id="replyForm${ci}">
        <div class="reply-input-wrap"><textarea class="reply-input" id="replyInput${ci}" placeholder="답글을 입력하세요..." rows="1" oninput="autoResize(this)"></textarea></div>
        <button class="reply-send-btn" onclick="submitReply(${ci})">등록</button>
      </div>
    </div>`;
  }).join('');
}

// ── 댓글 메뉴 ──
function toggleCommentMenu(ci) {
  const menu = document.getElementById(`commentMenu${ci}`);
  document.querySelectorAll('.comment-menu').forEach(m => { if(m!==menu) m.classList.remove('show'); });
  menu.classList.toggle('show');
}
function toggleReplyMenu(ci,ri) {
  const menu = document.getElementById(`replyMenu${ci}_${ri}`);
  document.querySelectorAll('.comment-menu').forEach(m => { if(m!==menu) m.classList.remove('show'); });
  menu.classList.toggle('show');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.comment-menu-wrap')) document.querySelectorAll('.comment-menu').forEach(m=>m.classList.remove('show'));
}, true);

// ── 댓글 수정 ──
function startEditComment(ci) {
  document.getElementById(`commentMenu${ci}`).classList.remove('show');
  document.getElementById(`commentText${ci}`).style.display='none';
  document.getElementById(`commentEditForm${ci}`).style.display='block';
  const ta = document.getElementById(`commentEditInput${ci}`);
  ta.focus(); autoResize(ta);
}
function cancelEditComment(ci) {
  document.getElementById(`commentText${ci}`).style.display='';
  document.getElementById(`commentEditForm${ci}`).style.display='none';
}
function saveEditComment(ci) {
  const p=posts.find(x=>x.id===currentPostId);
  const newText = document.getElementById(`commentEditInput${ci}`).value.trim();
  if (!newText) return;
  p.comments[ci].text = newText;
  renderComments(); showToast('댓글이 수정됐어요');
}

// ── 댓글 삭제 ──
function deleteComment(ci) {
  const p=posts.find(x=>x.id===currentPostId);
  p.comments.splice(ci,1);
  renderComments(); showToast('댓글이 삭제됐어요');
}

// ── 대댓글 수정 ──
function startEditReply(ci,ri) {
  document.getElementById(`replyMenu${ci}_${ri}`).classList.remove('show');
  document.getElementById(`replyText${ci}_${ri}`).style.display='none';
  document.getElementById(`replyEditForm${ci}_${ri}`).style.display='block';
  const ta = document.getElementById(`replyEditInput${ci}_${ri}`);
  ta.focus(); autoResize(ta);
}
function cancelEditReply(ci,ri) {
  document.getElementById(`replyText${ci}_${ri}`).style.display='';
  document.getElementById(`replyEditForm${ci}_${ri}`).style.display='none';
}
function saveEditReply(ci,ri) {
  const p=posts.find(x=>x.id===currentPostId);
  const newText = document.getElementById(`replyEditInput${ci}_${ri}`).value.trim();
  if (!newText) return;
  p.comments[ci].replies[ri].text = newText;
  renderComments(); showToast('답글이 수정됐어요');
}

// ── 대댓글 삭제 ──
function deleteReply(ci,ri) {
  const p=posts.find(x=>x.id===currentPostId);
  p.comments[ci].replies.splice(ri,1);
  renderComments(); showToast('답글이 삭제됐어요');
}

function submitComment() {
  const input=document.getElementById('commentInput');
  const text=input.value.trim(); if(!text) return;
  const p=posts.find(x=>x.id===currentPostId);
  p.comments.push({avatar:ME.avatar,avatarColor:ME.avatarColor,author:ME.author,date:Date.now(),text,likes:0,liked:false,replies:[]});
  input.value=''; input.style.height='auto';
  renderComments(); showToast('댓글이 등록됐어요!');
}
function toggleCommentLike(ci) {
  const p=posts.find(x=>x.id===currentPostId); const c=p.comments[ci];
  c.liked=!c.liked; c.likes+=c.liked?1:-1; renderComments();
}
function toggleReplyForm(ci) {
  const form=document.getElementById(`replyForm${ci}`);
  form.classList.toggle('show');
  if(form.classList.contains('show')) document.getElementById(`replyInput${ci}`).focus();
}
function submitReply(ci) {
  const input=document.getElementById(`replyInput${ci}`);
  const text=input.value.trim(); if(!text) return;
  const p=posts.find(x=>x.id===currentPostId);
  p.comments[ci].replies.push({avatar:ME.avatar,avatarColor:ME.avatarColor,author:ME.author,date:Date.now(),text});
  renderComments(); showToast('답글이 등록됐어요!');
}

renderFeed();
