// PMP Study App - Quiz Logic
const EXAM_SECONDS = 13800; // 230分（PMP試験時間）
const PW_HASH_CORRECT = 'e912de903c327db76b2a3c44d30e8f59ee5d325124c040c821e31ca36fe50df3'; // pmp2024

const $ = id => document.getElementById(id);

let setIdx = 0, Q = [], perms = [], answers = [], filter = '', pos = 0;
let remaining = EXAM_SECONDS, timerId = null, running = false, startedOnce = false;

// --- 順列生成（選択肢シャッフル） ---
function makePerm() {
  const p = [0,1,2,3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

function applyPerm(q, perm) {
  return { ...q, o: perm.map(i => q.o[i]), a: perm.indexOf(q.a) };
}

// --- ローカルストレージ ---
function storageKey() { return `pmp_study_v1_s${setIdx}`; }
function storageOK() {
  try { localStorage.setItem('_t','1'); localStorage.removeItem('_t'); return true; }
  catch { return false; }
}
function saveState() {
  if (!storageOK()) return;
  localStorage.setItem(storageKey(), JSON.stringify({ answers, pos, filter, remaining, startedOnce, perms }));
}
function loadState() {
  if (!storageOK()) return false;
  const s = localStorage.getItem(storageKey());
  if (!s) return false;
  try {
    const d = JSON.parse(s);
    if (!d.answers || d.answers.length !== (ALL_SETS[setIdx]||[]).length) return false;
    answers = d.answers; pos = d.pos; filter = d.filter || '';
    remaining = d.remaining ?? EXAM_SECONDS; startedOnce = d.startedOnce ?? false;
    perms = d.perms;
    return true;
  } catch { return false; }
}
function clearState() { if (storageOK()) localStorage.removeItem(storageKey()); }

// --- パスワード ---
async function sha256(msg) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

let pwAttempts = 0, pwLockUntil = 0;
async function checkPw() {
  const now = Date.now();
  if (now < pwLockUntil) {
    const sec = Math.ceil((pwLockUntil - now) / 1000);
    showPwError(`${sec}秒後に再試行してください`); return;
  }
  const h = await sha256($('pwInput').value);
  if (h === PW_HASH_CORRECT) {
    $('pwOverlay').style.display = 'none';
    sessionStorage.setItem('pmp_auth', '1');
    pwAttempts = 0;
  } else {
    pwAttempts++;
    if (pwAttempts >= 5) { pwLockUntil = Date.now() + 30000; pwAttempts = 0; showPwError('ロック中（30秒後に再試行可能）'); }
    else showPwError(`パスワードが違います（残り${5 - pwAttempts}回）`);
  }
}
function showPwError(msg) { const e = $('pwError'); e.textContent = msg; e.classList.add('show'); }

window.checkPw = checkPw;
$('pwInput').addEventListener('keydown', e => { if (e.key === 'Enter') checkPw(); });
if (sessionStorage.getItem('pmp_auth')) $('pwOverlay').style.display = 'none';

// --- テーマ ---
window.toggleTheme = function() {
  document.body.classList.toggle('light');
  $('themeBtn').textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
  localStorage.setItem('pmp_theme', document.body.classList.contains('light') ? 'light' : 'dark');
};
if (localStorage.getItem('pmp_theme') === 'light') {
  document.body.classList.add('light'); $('themeBtn').textContent = '🌙';
}

// --- タイマー ---
function fmtTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function updateTimerDisplay() {
  const el = $('timerDisplay');
  el.textContent = fmtTime(remaining);
  el.className = 'timer-display' + (remaining <= 60 ? ' danger' : remaining <= 600 ? ' warn' : '');
}
window.startTimer = function() {
  if (running) return;
  running = true; startedOnce = true;
  $('timerStartBtn').style.display = 'none'; $('timerPauseBtn').style.display = 'inline-flex';
  timerId = setInterval(() => {
    if (remaining > 0) { remaining--; updateTimerDisplay(); if (remaining % 10 === 0) saveState(); }
    else { clearInterval(timerId); running = false; alert('時間切れです。結果を確認してください。'); showResults(); }
  }, 1000);
};
window.pauseTimer = function() {
  if (!running) return;
  clearInterval(timerId); running = false;
  $('timerStartBtn').style.display = 'inline-flex'; $('timerPauseBtn').style.display = 'none'; saveState();
};
window.resetTimer = function() {
  pauseTimer(); remaining = EXAM_SECONDS; startedOnce = false;
  $('timerStartBtn').style.display = 'inline-flex'; $('timerPauseBtn').style.display = 'none';
  updateTimerDisplay();
  if (confirm('タイマーと回答をリセットしますか？')) {
    answers = Array(Q.length).fill(undefined); perms = Q.map(() => makePerm()); pos = 0; filter = '';
    $('filterSelect').value = ''; clearState(); renderQuestion(); renderGrid(); updateStats();
  }
};

// --- 統計更新 ---
function updateStats() {
  const answered = answers.filter(a => a !== undefined).length;
  const correct = answers.filter((a,i) => a !== undefined && a === applyPerm(Q[i], perms[i]).a).length;
  const wrong = answered - correct;
  const acc = answered > 0 ? Math.round(correct/answered*100) : null;
  $('statAnswered').textContent = `${answered}/${Q.length}`;
  $('statCorrect').textContent = correct;
  $('statWrong').textContent = wrong;
  $('statAcc').textContent = acc !== null ? acc + '%' : '-';
  $('progressFill').style.width = Q.length > 0 ? (answered/Q.length*100)+'%' : '0%';
}

// --- HTML サニタイズ ---
function sanitizeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div'); d.textContent = s;
  let h = d.innerHTML;
  for (const t of ['code','em','strong','br'])
    h = h.replace(new RegExp(`&lt;${t}&gt;`,'g'),`<${t}>`).replace(new RegExp(`&lt;/${t}&gt;`,'g'),`</${t}>`);
  return h;
}

// --- フィルター対象インデックス ---
function filteredIndices() {
  if (!filter) return Q.map((_,i)=>i);
  return Q.map((q,i)=>q.d===filter?i:-1).filter(i=>i>=0);
}

// --- 問題描画 ---
function renderQuestion() {
  const fi = filteredIndices();
  if (!fi.length) { $('questionText').textContent = 'このドメインに問題がありません'; $('optionsArea').innerHTML=''; return; }
  if (pos >= fi.length) pos = fi.length - 1;
  const qi = fi[pos];
  const pq = applyPerm(Q[qi], perms[qi]);
  $('questionId').textContent = `Q${qi+1} / 全${Q.length}問`;
  $('domainTag').textContent = pq.d;
  $('questionText').innerHTML = sanitizeHtml(pq.q);
  const opts = $('optionsArea'); opts.innerHTML = '';
  const labels = ['A','B','C','D'];
  const ans = answers[qi];
  pq.o.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    if (ans !== undefined) {
      btn.disabled = true;
      if (i === pq.a) btn.classList.add('correct');
      else if (i === ans) btn.classList.add('wrong');
    }
    btn.innerHTML = `<span class="option-label">${labels[i]}.</span><span>${sanitizeHtml(opt)}</span>`;
    btn.onclick = () => selectAnswer(qi, i);
    opts.appendChild(btn);
  });
  const expl = $('explanationArea');
  if (ans !== undefined && pq.e) { expl.innerHTML = sanitizeHtml(pq.e); expl.classList.add('show'); }
  else { expl.innerHTML = ''; expl.classList.remove('show'); }
  renderGrid();
}

function selectAnswer(qi, idx) {
  if (answers[qi] !== undefined) return;
  answers[qi] = idx; saveState(); renderQuestion(); updateStats();
}

// --- ナビゲーション ---
window.prevQ = function() { if (pos > 0) { pos--; renderQuestion(); } };
window.nextQ = function() { const fi=filteredIndices(); if (pos < fi.length-1) { pos++; renderQuestion(); } };
window.applyFilter = function() { filter=$('filterSelect').value; pos=0; renderQuestion(); renderGrid(); saveState(); };

// --- グリッド描画 ---
function renderGrid() {
  const fi = filteredIndices(); const grid = $('qgrid'); grid.innerHTML = '';
  fi.forEach((qi, i) => {
    const btn = document.createElement('button');
    btn.className = 'qgrid-btn';
    if (i === pos) btn.classList.add('current');
    else if (answers[qi] !== undefined) btn.classList.add(answers[qi]===applyPerm(Q[qi],perms[qi]).a?'correct':'wrong');
    btn.textContent = qi+1;
    btn.onclick = () => { pos=i; renderQuestion(); };
    grid.appendChild(btn);
  });
  $('gridFilterLabel').textContent = filter ? `${filter} (${fi.length}問)` : `全${Q.length}問`;
}

// --- フィルターオプション構築 ---
function buildFilterOptions() {
  const domains = [...new Set(Q.map(q=>q.d))].sort();
  const sel = $('filterSelect');
  sel.innerHTML = '<option value="">すべてのドメイン</option>';
  domains.forEach(d => { const o=document.createElement('option'); o.value=d; o.textContent=d; if(d===filter)o.selected=true; sel.appendChild(o); });
}

// --- セット読み込み ---
function loadSet(i) {
  setIdx = i;
  $('loadingArea').style.display = 'flex'; $('questionCard').style.display = 'none';
  if (ALL_SETS[i]) { initSet(i); return; }
  const script = document.createElement('script');
  script.src = `set-${i}.js`;
  script.onload = () => initSet(i);
  script.onerror = () => { $('loadingArea').innerHTML = `<p style="color:var(--wrong)">セット${i+1}の読み込みに失敗しました</p>`; };
  document.head.appendChild(script);
}

function initSet(i) {
  Q = ALL_SETS[i]; $('loadingArea').style.display='none'; $('questionCard').style.display='block';
  if (!loadState()) {
    answers = Array(Q.length).fill(undefined); perms = Q.map(()=>makePerm());
    pos = 0; filter = ''; remaining = EXAM_SECONDS; startedOnce = false;
  }
  clearInterval(timerId); running = false;
  $('timerStartBtn').style.display='inline-flex'; $('timerPauseBtn').style.display='none';
  updateTimerDisplay(); buildFilterOptions(); $('filterSelect').value=filter;
  renderQuestion(); updateStats();
  document.querySelectorAll('.set-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
  showQuiz();
}

// --- セットセレクター ---
function buildSetSelector() {
  const sel = $('setSelector'); sel.innerHTML = '';
  const names = ['Set 1\n統合・スコープ・スケジュール', 'Set 2\n品質・リスク・調達', 'Set 3\nアジャイル・リーダーシップ'];
  for (let i=0; i<ALL_SETS.length; i++) {
    const btn = document.createElement('button');
    btn.className = 'set-btn' + (i===0?' active':'');
    btn.textContent = `Set ${i+1}`;
    btn.title = names[i];
    btn.onclick = () => loadSet(i);
    sel.appendChild(btn);
  }
}

// --- ビュー切り替え ---
function showQuiz() {
  $('quizView').classList.remove('hidden'); $('resultsView').classList.remove('show'); $('dashboardView').classList.remove('show');
}
window.showQuiz = showQuiz;
window.showResults = function() {
  $('quizView').classList.add('hidden'); $('resultsView').classList.add('show'); $('dashboardView').classList.remove('show');
  renderResults();
};
window.toggleDashboard = function() {
  const dash=$('dashboardView');
  if (dash.classList.contains('show')) { dash.classList.remove('show'); showQuiz(); }
  else { $('quizView').classList.add('hidden'); $('resultsView').classList.remove('show'); dash.classList.add('show'); renderDashboard(); }
};

// --- 結果表示 ---
function renderResults() {
  const answered = answers.filter(a=>a!==undefined).length;
  const correct = answers.filter((a,i)=>a!==undefined&&a===applyPerm(Q[i],perms[i]).a).length;
  const acc = answered>0?Math.round(correct/answered*100):0;
  $('resultScoreValue').textContent = acc+'%';
  $('resultScoreValue').className = 'result-score-value' + (acc>=70?' good':acc>=40?' ok':' bad');
  $('resultDetail').textContent = `${correct}問正解 / ${answered}問回答済 / ${Q.length}問中`;
  $('resultTimestamp').textContent = `集計: ${new Date().toLocaleString('ja-JP')} ｜ セット${setIdx+1}`;
  // ドメイン別
  const domains = {};
  Q.forEach((q,i)=>{
    if(!domains[q.d]) domains[q.d]={t:0,c:0,a:0};
    domains[q.d].t++;
    if(answers[i]!==undefined){ domains[q.d].a++; if(answers[i]===applyPerm(Q[i],perms[i]).a) domains[q.d].c++; }
  });
  const bd = $('domainBreakdown'); bd.innerHTML='';
  Object.entries(domains).sort((a,b)=>b[1].a-a[1].a).forEach(([d,s])=>{
    const acc=s.a>0?Math.round(s.c/s.a*100):null;
    const cls=acc===null?'':acc>=70?'good':acc>=40?'ok':'bad';
    const row=document.createElement('div'); row.className='domain-row';
    row.innerHTML=`<span class="domain-name">${d}</span>
      <div class="domain-bar-track"><div class="domain-bar-fill" style="width:${acc??0}%"></div></div>
      <span class="domain-acc ${cls}">${acc!==null?acc+'%':'-'}</span>
      <span style="font-size:11px;color:var(--text2)">${s.a}/${s.t}</span>`;
    bd.appendChild(row);
  });
  showReview('wrong');
}

window.showReview = function(mode) {
  $('showWrongBtn').classList.toggle('active',mode==='wrong');
  $('showAllBtn').classList.toggle('active',mode==='all');
  const list=$('reviewList'); list.innerHTML='';
  Q.forEach((q,i)=>{
    const pq=applyPerm(Q[i],perms[i]); const ans=answers[i];
    if(ans===undefined) return;
    const ok=ans===pq.a;
    if(mode==='wrong'&&ok) return;
    const labels=['A','B','C','D'];
    const item=document.createElement('div'); item.className='review-item';
    item.innerHTML=`
      <div class="review-item-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="review-status ${ok?'correct':'wrong'}">${ok?'✓':'✗'}</span>
        <span class="question-id" style="min-width:45px">Q${i+1}</span>
        <span class="review-q">${sanitizeHtml(q.q).slice(0,80)}…</span>
      </div>
      <div class="review-body">
        <div style="margin-bottom:10px;font-size:14px;line-height:1.6">${sanitizeHtml(pq.q)}</div>
        ${pq.o.map((o,j)=>`<div class="review-opt ${j===pq.a?'correct':j===ans&&!ok?'wrong':''}">
          <strong>${labels[j]}.</strong> ${sanitizeHtml(o)}
          ${j===pq.a?' <span class="badge-correct">正解</span>':''}${j===ans&&!ok?' <span class="badge-wrong">あなたの回答</span>':''}
        </div>`).join('')}
        ${pq.e?`<div class="explanation show">${sanitizeHtml(pq.e)}</div>`:''}
      </div>`;
    list.appendChild(item);
  });
  if(!list.children.length)
    list.innerHTML=`<p style="text-align:center;color:var(--text2);padding:24px">${mode==='wrong'?'全問正解！':'まだ回答がありません'}</p>`;
};

// --- ダッシュボード ---
function renderDashboard() {
  const grid=$('setGrid'); grid.innerHTML='';
  const setNames=['統合・スコープ・スケジュール・コスト','品質・資源・コミュニケーション・リスク・調達・ステークホルダー','アジャイル・ハイブリッド・リーダーシップ'];
  for(let i=0;i<ALL_SETS.length;i++){
    const card=document.createElement('div'); card.className='set-card'+(i===setIdx?' active':'');
    let acc=null,answered=0,total=ALL_SETS[i]?ALL_SETS[i].length:0;
    const s=storageOK()&&localStorage.getItem(`pmp_study_v1_s${i}`);
    if(s){try{const d=JSON.parse(s);if(d.answers&&ALL_SETS[i]){const c=d.answers.filter((a,j)=>a!==undefined&&d.perms&&a===d.perms[j].indexOf(ALL_SETS[i][j].a)).length;answered=d.answers.filter(a=>a!==undefined).length;acc=answered>0?Math.round(c/answered*100):null;}}catch{}}
    const cls=acc===null?'none':acc>=70?'good':acc>=40?'ok':'bad';
    card.innerHTML=`<div class="set-card-title">Set ${i+1}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${setNames[i]}</div>
      <div class="set-card-acc ${cls}">${acc!==null?acc+'%':'--'}</div>
      <div class="set-card-stats">${answered}/${total||'?'}問回答済</div>`;
    card.onclick=()=>loadSet(i); grid.appendChild(card);
  }
  // 全体ドメイン集計
  const gd={};
  for(let i=0;i<ALL_SETS.length;i++){
    if(!ALL_SETS[i]) continue;
    const s=storageOK()&&localStorage.getItem(`pmp_study_v1_s${i}`);
    if(!s) continue;
    try{const d=JSON.parse(s);ALL_SETS[i].forEach((q,j)=>{
      if(!gd[q.d])gd[q.d]={t:0,c:0,a:0}; gd[q.d].t++;
      if(d.answers?.[j]!==undefined){gd[q.d].a++;const perm=d.perms?.[j]??[0,1,2,3];if(d.answers[j]===perm.indexOf(q.a))gd[q.d].c++;}
    });}catch{}
  }
  const bd=$('globalDomainBreakdown'); bd.innerHTML='';
  if(!Object.keys(gd).length){bd.innerHTML='<p style="text-align:center;color:var(--text2);padding:20px">データがありません</p>';return;}
  Object.entries(gd).sort((a,b)=>a[0].localeCompare(b[0],'ja')).forEach(([d,s])=>{
    const acc=s.a>0?Math.round(s.c/s.a*100):null;const cls=acc===null?'':acc>=70?'good':acc>=40?'ok':'bad';
    const row=document.createElement('div'); row.className='domain-row';
    row.innerHTML=`<span class="domain-name">${d}</span>
      <div class="domain-bar-track"><div class="domain-bar-fill" style="width:${acc??0}%"></div></div>
      <span class="domain-acc ${cls}">${acc!==null?acc+'%':'-'}</span>
      <span style="font-size:11px;color:var(--text2)">${s.a}/${s.t}</span>`;
    bd.appendChild(row);
  });
}

// --- エクスポート ---
window.saveResultsHtml = function() {
  const answered=answers.filter(a=>a!==undefined).length;
  const correct=answers.filter((a,i)=>a!==undefined&&a===applyPerm(Q[i],perms[i]).a).length;
  const acc=answered>0?Math.round(correct/answered*100):0;
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>PMP結果 ${new Date().toLocaleDateString('ja-JP')}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:20px auto;padding:20px;color:#1e293b}h1{color:#3b82f6}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #e2e8f0;padding:8px;text-align:left}th{background:#f8fafc}
.c{color:#22c55e;font-weight:700}.w{color:#ef4444;font-weight:700}</style></head><body>
<h1>🎯 PMP学習 結果レポート</h1>
<p>日時: ${new Date().toLocaleString('ja-JP')} | セット${setIdx+1}</p>
<p><strong>正答率: ${acc}%</strong>（${correct}問正解 / ${answered}問回答 / ${Q.length}問中）</p>
<table><tr><th>No.</th><th>ドメイン</th><th>結果</th><th>あなたの回答</th><th>正解</th></tr>
${Q.map((q,i)=>{const pq=applyPerm(Q[i],perms[i]);const ans=answers[i];if(ans===undefined)return'';const ok=ans===pq.a;const lb=['A','B','C','D'];
return`<tr><td>Q${i+1}</td><td>${q.d}</td><td class="${ok?'c':'w'}">${ok?'○':'✗'}</td><td>${lb[ans]}. ${pq.o[ans]}</td><td>${lb[pq.a]}. ${pq.o[pq.a]}</td></tr>`;}).join('')}
</table></body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`pmp-result-set${setIdx+1}-${new Date().toISOString().slice(0,10)}.html`; a.click();
};

// --- キーボード操作 ---
document.addEventListener('keydown', e => {
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='ArrowLeft'||e.key==='h') prevQ();
  if(e.key==='ArrowRight'||e.key==='l') nextQ();
  if(['1','2','3','4'].includes(e.key)) selectAnswerByKey(+e.key-1);
  if(['a','b','c','d'].includes(e.key.toLowerCase())) selectAnswerByKey('abcd'.indexOf(e.key.toLowerCase()));
});
function selectAnswerByKey(idx) {
  const fi=filteredIndices(); if(!fi.length) return;
  const qi=fi[pos]; if(answers[qi]!==undefined) return;
  selectAnswer(qi, idx);
}

// --- 初期化 ---
function init() { buildSetSelector(); loadSet(0); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();
