// PMP Study App - Quiz Logic
const EXAM_SECONDS = 13800; // 230分（PMP試験時間）
const PW_HASH_CORRECT = 'e912de903c327db76b2a3c44d30e8f59ee5d325124c040c821e31ca36fe50df3'; // pmp2024

const $ = id => document.getElementById(id);

let setIdx = 0, Q = [], perms = [], answers = [], filter = '', pos = 0;
let remaining = EXAM_SECONDS, timerId = null, running = false, startedOnce = false;
let bookmarks = [], retakeMode = false, retakeIndices = [];
let markReview = new Set();   // レビューマーク（セッション中のみ、本番試験と同様）
let pendingMultiMap = {};     // 複数選択の未確定選択 qi -> [indices]

// --- 順列生成（可変長・選択肢シャッフル） ---
function makePerm(n = 4) {
  const p = Array.from({length: n}, (_, i) => i);
  for (let i = n-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

// 単一選択・複数選択両対応の順列適用
function applyPerm(q, perm) {
  if (Array.isArray(q.a)) {
    return { ...q, o: perm.map(i => q.o[i]), a: q.a.map(ai => perm.indexOf(ai)) };
  }
  return { ...q, o: perm.map(i => q.o[i]), a: perm.indexOf(q.a) };
}

// 正解判定（単一・複数選択共通）
function isCorrectAnswer(qi) {
  const pq = applyPerm(Q[qi], perms[qi]);
  const ans = answers[qi];
  if (ans === undefined) return false;
  if (Array.isArray(pq.a)) {
    return Array.isArray(ans) && ans.length === pq.a.length && pq.a.every(a => ans.includes(a));
  }
  return ans === pq.a;
}

// localStorage保存データからの正解判定（ダッシュボード集計用）
function isCorrectFromSaved(q, savedAns, perm) {
  if (savedAns === undefined) return false;
  if (Array.isArray(q.a)) {
    if (!perm) return false;
    const permA = q.a.map(ai => perm.indexOf(ai));
    return Array.isArray(savedAns) && savedAns.length === permA.length && permA.every(a => savedAns.includes(a));
  }
  return savedAns === (perm ? perm.indexOf(q.a) : q.a);
}

// 選択肢のCSSクラス（レビュー表示用）
function optClass(pq, ans, j) {
  if (Array.isArray(pq.a)) {
    if (pq.a.includes(j)) return 'correct';
    if (Array.isArray(ans) && ans.includes(j)) return 'wrong';
    return '';
  }
  if (j === pq.a) return 'correct';
  if (j === ans && ans !== pq.a) return 'wrong';
  return '';
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

// --- ブックマーク ---
function bookmarkKey(i) { return `pmp_bookmarks_s${i}`; }
function loadBookmarks(i) {
  if (!storageOK()) return [];
  try { return JSON.parse(localStorage.getItem(bookmarkKey(i)) || '[]'); } catch { return []; }
}
function saveBookmarksStore(i, marks) {
  if (storageOK()) localStorage.setItem(bookmarkKey(i), JSON.stringify(marks));
}
window.toggleBookmark = function() {
  const fi = filteredIndices();
  if (!fi.length) return;
  const qi = fi[pos];
  const idx = bookmarks.indexOf(qi);
  if (idx >= 0) bookmarks.splice(idx, 1);
  else bookmarks.push(qi);
  saveBookmarksStore(setIdx, bookmarks);
  const btn = $('bookmarkBtn');
  btn.textContent = bookmarks.includes(qi) ? '★' : '☆';
  btn.classList.toggle('bookmarked', bookmarks.includes(qi));
  renderGrid();
};

// --- レビューマーク（PMP試験と同様のセッション内マーク） ---
window.toggleMarkReview = function() {
  const fi = filteredIndices();
  if (!fi.length) return;
  const qi = fi[pos];
  if (markReview.has(qi)) markReview.delete(qi);
  else markReview.add(qi);
  const btn = $('markReviewBtn');
  btn.classList.toggle('marked', markReview.has(qi));
  btn.title = markReview.has(qi) ? 'レビューマーク解除' : 'レビューのためにマーク';
  renderGrid();
};

// --- ストリーク ---
function updateStreak() {
  if (!storageOK()) return;
  const today = new Date().toISOString().slice(0, 10);
  let dates = [];
  try { dates = JSON.parse(localStorage.getItem('pmp_study_dates') || '[]'); } catch {}
  if (!dates.includes(today)) {
    dates.push(today);
    localStorage.setItem('pmp_study_dates', JSON.stringify(dates));
  }
}
function getStreak() {
  if (!storageOK()) return 0;
  try {
    const dates = JSON.parse(localStorage.getItem('pmp_study_dates') || '[]');
    if (!dates.length) return 0;
    const sorted = [...new Set(dates)].sort().reverse();
    const today = new Date().toISOString().slice(0, 10);
    const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (sorted[0] !== today && sorted[0] !== yest) return 0;
    let streak = 0;
    let cur = sorted[0] === today ? new Date() : new Date(Date.now() - 86400000);
    for (const d of sorted) {
      if (d === cur.toISOString().slice(0, 10)) {
        streak++;
        cur = new Date(cur.getTime() - 86400000);
      } else break;
    }
    return streak;
  } catch { return 0; }
}

// --- セッション履歴 ---
function sessionHistKey() { return 'pmp_sessions_v1'; }
function loadAllSessions() {
  if (!storageOK()) return [];
  try { return JSON.parse(localStorage.getItem(sessionHistKey()) || '[]'); } catch { return []; }
}
function saveSession(entry) {
  const sessions = loadAllSessions();
  sessions.unshift(entry);
  if (sessions.length > 20) sessions.length = 20;
  if (storageOK()) localStorage.setItem(sessionHistKey(), JSON.stringify(sessions));
}

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
    answers = Array(Q.length).fill(undefined); perms = Q.map(q => makePerm(q.o.length));
    pos = 0; filter = ''; retakeMode = false; markReview.clear(); pendingMultiMap = {};
    $('retakeBar').classList.add('hidden'); $('filterSelect').value = '';
    clearState(); renderQuestion(); renderGrid(); updateStats();
  }
};

// --- 統計更新 ---
function updateStats() {
  const answered = answers.filter(a => a !== undefined).length;
  const correct = Q.filter((_, i) => isCorrectAnswer(i)).length;
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
  if (retakeMode) return retakeIndices;
  if (filter === '__bookmark__') return bookmarks.slice().sort((a,b)=>a-b);
  if (filter === '__review__') return [...markReview].sort((a,b)=>a-b);
  if (!filter) return Q.map((_,i)=>i);
  return Q.map((q,i)=>q.d===filter?i:-1).filter(i=>i>=0);
}

// --- 複数選択オプション切り替え ---
function toggleMultiOption(qi, optIdx, reqCount) {
  if (!pendingMultiMap[qi]) pendingMultiMap[qi] = [];
  const pending = pendingMultiMap[qi];
  const idx = pending.indexOf(optIdx);
  if (idx >= 0) {
    pending.splice(idx, 1);
  } else {
    pending.push(optIdx);
  }
  // UIを再描画（選択状態の更新のみ）
  const fi = filteredIndices();
  const curPos = fi.indexOf(qi);
  if (curPos >= 0) updateMultiUI(qi, reqCount);
}

function updateMultiUI(qi, reqCount) {
  const pending = pendingMultiMap[qi] || [];
  const labels = ['A','B','C','D','E'];
  const pq = applyPerm(Q[qi], perms[qi]);

  // オプションボタンの選択状態更新
  $('optionsArea').querySelectorAll('.option-btn').forEach((btn, i) => {
    btn.classList.toggle('multi-selected', pending.includes(i));
  });

  // カウンター更新
  const counter = $('multiCounter');
  if (counter) counter.textContent = `${pending.length}/${reqCount}選択`;

  // 確定ボタン更新
  const confirmBtn = $('confirmMultiBtn');
  if (confirmBtn) {
    const ready = pending.length === reqCount;
    confirmBtn.disabled = !ready;
    confirmBtn.style.opacity = ready ? '1' : '0.5';
    confirmBtn.textContent = ready ? `回答を確定する（${pending.length}/${reqCount}）` : `${pending.length}/${reqCount}選択中…`;
  }
}

function confirmMultiAnswer(qi) {
  const pending = pendingMultiMap[qi] || [];
  if (!pending.length) return;
  answers[qi] = [...pending];
  updateStreak();
  saveState(); renderQuestion(); updateStats();
}

// --- 問題描画 ---
function renderQuestion() {
  const fi = filteredIndices();
  if (!fi.length) {
    $('questionCard').style.display = 'none';
    return;
  }
  $('questionCard').style.display = 'block';
  if (pos >= fi.length) pos = fi.length - 1;
  const qi = fi[pos];
  const pq = applyPerm(Q[qi], perms[qi]);
  const isMulti = Array.isArray(pq.a);
  const ans = answers[qi];
  const labels = ['A','B','C','D','E'];

  $('questionId').textContent = `Q${qi+1} / 全${Q.length}問  (${pos+1}/${fi.length})`;
  $('domainTag').textContent = pq.d;
  $('questionText').innerHTML = sanitizeHtml(pq.q);

  // ブックマークボタン
  const bmBtn = $('bookmarkBtn');
  bmBtn.textContent = bookmarks.includes(qi) ? '★' : '☆';
  bmBtn.classList.toggle('bookmarked', bookmarks.includes(qi));

  // レビューマークボタン
  const rvBtn = $('markReviewBtn');
  const isMarked = markReview.has(qi);
  rvBtn.classList.toggle('marked', isMarked);
  rvBtn.title = isMarked ? 'レビューマーク解除' : 'レビューのためにマーク';

  // 複数選択の指示エリア
  const instrArea = $('multiInstructionArea');
  if (isMulti) {
    const reqCount = pq.a.length;
    const pending = pendingMultiMap[qi] || [];
    instrArea.innerHTML = `
      <div class="multi-instruction">
        <span>📋 複数選択問題 — <strong>${reqCount}つ</strong>選んでください</span>
        <span class="multi-counter" id="multiCounter">${pending.length}/${reqCount}選択</span>
      </div>`;
  } else {
    instrArea.innerHTML = '';
  }

  // 選択肢描画
  const opts = $('optionsArea'); opts.innerHTML = '';
  pq.o.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';

    // 選択肢解説（oe）を取得 — 元の順序インデックスで参照
    const origIdx = perms[qi][i];
    const oeText = Q[qi].oe && Q[qi].oe[origIdx];

    if (ans !== undefined) {
      // 回答済み
      btn.disabled = true;
      const cls = optClass(pq, ans, i);
      if (cls) btn.classList.add(cls);
    } else if (isMulti) {
      // 複数選択・未回答
      const pending = pendingMultiMap[qi] || [];
      if (pending.includes(i)) btn.classList.add('multi-selected');
      btn.onclick = () => toggleMultiOption(qi, i, pq.a.length);
    } else {
      // 単一選択・未回答
      btn.onclick = () => selectAnswer(qi, i);
    }

    // 回答後のみoе表示
    if (ans !== undefined && oeText) {
      btn.innerHTML = `<div class="opt-top"><span class="opt-lbl">${labels[i]}.</span><span>${sanitizeHtml(opt)}</span></div><div class="option-explain">${sanitizeHtml(oeText)}</div>`;
    } else {
      btn.innerHTML = `<div class="opt-top"><span class="opt-lbl">${labels[i]}.</span><span>${sanitizeHtml(opt)}</span></div>`;
    }
    opts.appendChild(btn);
  });

  // 複数選択の確定エリア
  const confirmArea = $('confirmArea');
  if (isMulti && ans === undefined) {
    const reqCount = pq.a.length;
    const pending = pendingMultiMap[qi] || [];
    const ready = pending.length === reqCount;
    confirmArea.innerHTML = `
      <button id="confirmMultiBtn" class="btn accent confirm-multi-btn"
        onclick="confirmMultiAnswer(${qi})"
        ${!ready ? 'disabled' : ''}
        style="opacity:${ready?1:0.5}">
        ${ready ? `回答を確定する（${pending.length}/${reqCount}）` : `${pending.length}/${reqCount}選択中…`}
      </button>`;
  } else {
    confirmArea.innerHTML = '';
  }

  // 解説
  const expl = $('explanationArea');
  if (ans !== undefined && pq.e) {
    const correct = isCorrectAnswer(qi);
    const label = correct ? '✓ 正解' : '✗ 不正解';
    const color = correct ? 'var(--correct)' : 'var(--wrong)';
    expl.innerHTML = `<strong style="color:${color}">${label}</strong><br><br>${sanitizeHtml(pq.e)}`;
    expl.classList.add('show');
  } else {
    expl.innerHTML = ''; expl.classList.remove('show');
  }
  renderGrid();
}

window.confirmMultiAnswer = confirmMultiAnswer;

function selectAnswer(qi, idx) {
  if (answers[qi] !== undefined) return;
  answers[qi] = idx;
  updateStreak();
  saveState(); renderQuestion(); updateStats();
}

// --- ナビゲーション ---
window.prevQ = function() { if (pos > 0) { pos--; renderQuestion(); } };
window.nextQ = function() { const fi=filteredIndices(); if (pos < fi.length-1) { pos++; renderQuestion(); } };
window.applyFilter = function() {
  filter = $('filterSelect').value;
  pos = 0; retakeMode = false; $('retakeBar').classList.add('hidden');
  renderQuestion(); renderGrid(); saveState();
};

// --- 再挑戦モード ---
window.startRetakeMode = function() {
  const wrongIdxs = Q.map((_,i)=>i).filter(i => answers[i] !== undefined && !isCorrectAnswer(i));
  if (!wrongIdxs.length) { alert('不正解の問題がありません！'); return; }
  wrongIdxs.forEach(i => { answers[i] = undefined; delete pendingMultiMap[i]; });
  retakeMode = true; retakeIndices = wrongIdxs;
  pos = 0; filter = ''; $('filterSelect').value = '';
  $('retakeBar').classList.remove('hidden');
  saveState(); showQuiz(); renderQuestion(); renderGrid(); updateStats();
};
window.exitRetakeMode = function() {
  retakeMode = false; $('retakeBar').classList.add('hidden');
  renderQuestion(); renderGrid();
};

// --- グリッド描画 ---
function renderGrid() {
  const fi = filteredIndices(); const grid = $('qgrid'); grid.innerHTML = '';
  fi.forEach((qi, i) => {
    const btn = document.createElement('button');
    btn.className = 'qgrid-btn';
    if (i === pos) btn.classList.add('current');
    else if (answers[qi] !== undefined) btn.classList.add(isCorrectAnswer(qi) ? 'correct' : 'wrong');
    if (bookmarks.includes(qi)) btn.classList.add('bookmarked');
    if (markReview.has(qi)) btn.classList.add('review');
    // 複数選択の選択中（未確定）表示
    if (Q[qi] && Array.isArray(Q[qi].a) && answers[qi] === undefined && (pendingMultiMap[qi]||[]).length > 0) {
      btn.classList.add('multi-pending');
    }
    btn.textContent = qi+1;
    btn.onclick = () => { pos=i; renderQuestion(); };
    grid.appendChild(btn);
  });
  const label = retakeMode ? `再挑戦 (${fi.length}問)`
    : filter === '__bookmark__' ? `ブックマーク (${fi.length}問)`
    : filter === '__review__' ? `レビューマーク (${fi.length}問)`
    : filter ? `${filter} (${fi.length}問)` : `全${Q.length}問`;
  $('gridFilterLabel').textContent = label;
}

// --- フィルターオプション構築 ---
function buildFilterOptions() {
  const domains = [...new Set(Q.map(q=>q.d))].sort();
  const sel = $('filterSelect');
  sel.innerHTML = '<option value="">すべてのドメイン</option>';
  domains.forEach(d => {
    const o=document.createElement('option'); o.value=d; o.textContent=d;
    if(d===filter) o.selected=true; sel.appendChild(o);
  });
  const bm = document.createElement('option'); bm.value='__bookmark__'; bm.textContent='★ ブックマーク済み'; sel.appendChild(bm);
  const rv = document.createElement('option'); rv.value='__review__'; rv.textContent='🚩 レビューマーク'; sel.appendChild(rv);
}

// --- セット読み込み ---
function loadOE(i, callback) {
  const flagKey = `_oe${i}loaded`;
  if (window[flagKey]) { callback(); return; }
  const script = document.createElement('script');
  script.src = `set-${i}-oe.js`;
  script.onload = callback;
  script.onerror = callback; // oe失敗しても続行
  document.head.appendChild(script);
}

function loadSet(i) {
  setIdx = i;
  $('loadingArea').style.display = 'flex'; $('questionCard').style.display = 'none';
  if (ALL_SETS[i]) {
    loadOE(i, () => initSet(i));
    return;
  }
  const script = document.createElement('script');
  script.src = `set-${i}.js`;
  script.onload = () => loadOE(i, () => initSet(i));
  script.onerror = () => { $('loadingArea').innerHTML = `<p style="color:var(--wrong)">セット${i+1}の読み込みに失敗しました</p>`; };
  document.head.appendChild(script);
}

function initSet(i) {
  Q = ALL_SETS[i]; $('loadingArea').style.display='none'; $('questionCard').style.display='block';
  bookmarks = loadBookmarks(i);
  retakeMode = false; markReview.clear(); pendingMultiMap = {};
  $('retakeBar').classList.add('hidden');
  if (!loadState()) {
    answers = Array(Q.length).fill(undefined);
    perms = Q.map(q => makePerm(q.o.length));
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
  $('quizView').classList.remove('hidden');
  $('resultsView').classList.remove('show');
  $('dashboardView').classList.remove('show');
}
window.showQuiz = showQuiz;
window.showResults = function() {
  $('quizView').classList.add('hidden');
  $('resultsView').classList.add('show');
  $('dashboardView').classList.remove('show');
  renderResults();
};
window.toggleDashboard = function() {
  const dash = $('dashboardView');
  if (dash.classList.contains('show')) { dash.classList.remove('show'); showQuiz(); }
  else {
    $('quizView').classList.add('hidden');
    $('resultsView').classList.remove('show');
    dash.classList.add('show');
    renderDashboard();
  }
};

// --- コンフェッティ ---
function triggerConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);
  const colors = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const size = Math.random() * 8 + 4;
    p.style.cssText = `left:${Math.random()*100}vw;top:-20px;width:${size}px;height:${size}px;background:${colors[Math.floor(Math.random()*colors.length)]};border-radius:${Math.random()>.5?'50%':'2px'};animation-duration:${Math.random()*2+2}s;animation-delay:${Math.random()*.6}s;`;
    container.appendChild(p);
  }
  setTimeout(() => container.remove(), 5000);
}

// --- ドメイン集計 ---
function calcDomainStats() {
  const gd = {};
  for (let i = 0; i < ALL_SETS.length; i++) {
    if (!ALL_SETS[i]) continue;
    const s = storageOK() && localStorage.getItem(`pmp_study_v1_s${i}`);
    if (!s) continue;
    try {
      const d = JSON.parse(s);
      ALL_SETS[i].forEach((q, j) => {
        if (!gd[q.d]) gd[q.d] = { t:0, c:0, a:0 };
        gd[q.d].t++;
        if (d.answers?.[j] !== undefined) {
          gd[q.d].a++;
          if (isCorrectFromSaved(q, d.answers[j], d.perms?.[j])) gd[q.d].c++;
        }
      });
    } catch {}
  }
  return gd;
}

// --- 結果表示 ---
function renderResults() {
  const answered = answers.filter(a=>a!==undefined).length;
  const correct = Q.filter((_,i)=>isCorrectAnswer(i)).length;
  const acc = answered>0?Math.round(correct/answered*100):0;

  // リング
  const ring = $('resultRingFill');
  const circ = 2 * Math.PI * 50;
  const color = acc>=70?'#22c55e':acc>=40?'#f59e0b':'#ef4444';
  ring.setAttribute('stroke', color);
  setTimeout(() => { ring.style.strokeDashoffset = circ - (acc/100)*circ; }, 100);

  $('resultScoreValue').textContent = acc+'%';
  $('resultScoreValue').className = 'result-score-value' + (acc>=70?' good':acc>=40?' ok':' bad');
  $('resultDetail').textContent = `${correct}問正解 / ${answered}問回答済 / ${Q.length}問中`;
  $('resultTimestamp').textContent = `集計: ${new Date().toLocaleString('ja-JP')} ｜ セット${setIdx+1}`;

  // バッジ
  const badges = $('resultBadges');
  badges.innerHTML = '';
  if (acc >= 70) badges.innerHTML += `<span class="result-badge pass">✓ 合格圏（70%以上）</span>`;
  else badges.innerHTML += `<span class="result-badge fail">目標まであと${70-acc}%</span>`;
  if (answered === Q.length) badges.innerHTML += `<span class="result-badge pass">✓ 全問回答</span>`;
  else badges.innerHTML += `<span class="result-badge warn">未回答 ${Q.length-answered}問</span>`;

  // 複数選択問題の内訳
  const multiQ = Q.filter(q => Array.isArray(q.a));
  if (multiQ.length > 0) {
    const multiAnswered = multiQ.filter((q,_) => answers[Q.indexOf(q)] !== undefined).length;
    const multiCorrect = Q.map((_,i)=>i).filter(i => Array.isArray(Q[i].a) && isCorrectAnswer(i)).length;
    badges.innerHTML += `<span class="result-badge warn">複数選択: ${multiCorrect}/${multiAnswered}問正解</span>`;
  }

  saveSession({ set:setIdx, date:new Date().toLocaleString('ja-JP'), acc, correct, answered, total:Q.length, elapsed:EXAM_SECONDS-remaining });
  if (acc >= 70) setTimeout(triggerConfetti, 400);

  // ドメイン別
  const domains = {};
  Q.forEach((q,i)=>{
    if(!domains[q.d]) domains[q.d]={t:0,c:0,a:0};
    domains[q.d].t++;
    if(answers[i]!==undefined){ domains[q.d].a++; if(isCorrectAnswer(i)) domains[q.d].c++; }
  });
  const bd = $('domainBreakdown'); bd.innerHTML='';
  Object.entries(domains).sort((a,b)=>b[1].a-a[1].a).forEach(([d,s])=>{
    const acc2=s.a>0?Math.round(s.c/s.a*100):null;
    const cls=acc2===null?'':acc2>=70?'good':acc2>=40?'ok':'bad';
    const barColor=acc2===null?'var(--border)':acc2>=70?'var(--correct)':acc2>=40?'var(--warn)':'var(--wrong)';
    const row=document.createElement('div'); row.className='domain-row';
    row.innerHTML=`<span class="domain-name">${d}</span>
      <div class="domain-bar-track"><div class="domain-bar-fill" style="width:0%;background:${barColor}"></div></div>
      <span class="domain-acc ${cls}">${acc2!==null?acc2+'%':'-'}</span>
      <span style="font-size:11px;color:var(--text2)">${s.a}/${s.t}</span>`;
    bd.appendChild(row);
    setTimeout(()=>{ row.querySelector('.domain-bar-fill').style.width=(acc2??0)+'%'; },150);
  });

  showReview('wrong');
}

window.showReview = function(mode) {
  $('showWrongBtn').classList.toggle('active',mode==='wrong');
  $('showAllBtn').classList.toggle('active',mode==='all');
  $('showBookmarkBtn').classList.toggle('active',mode==='bookmark');
  const list=$('reviewList'); list.innerHTML='';
  const labels=['A','B','C','D','E'];

  Q.forEach((q,i)=>{
    const pq=applyPerm(Q[i],perms[i]); const ans=answers[i];
    if(ans===undefined) return;
    const ok=isCorrectAnswer(i);
    if(mode==='wrong'&&ok) return;
    if(mode==='bookmark'&&!bookmarks.includes(i)) return;

    const isMulti = Array.isArray(pq.a);
    const item=document.createElement('div'); item.className='review-item';
    item.innerHTML=`
      <div class="review-item-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
        <span class="review-status ${ok?'correct':'wrong'}">${ok?'✓':'✗'}</span>
        <span style="font-family:var(--mono);font-size:12px;min-width:45px">Q${i+1}</span>
        ${isMulti?'<span class="multi-badge">複数選択</span>':''}
        ${bookmarks.includes(i)?'<span style="color:var(--warn);font-size:12px">★</span>':''}
        <span class="review-q">${sanitizeHtml(q.q).slice(0,80)}…</span>
      </div>
      <div class="review-body">
        <div style="margin-bottom:10px;font-size:14px;line-height:1.6">${sanitizeHtml(pq.q)}</div>
        ${isMulti?`<div style="font-size:11px;color:var(--text2);margin-bottom:6px">正解: ${pq.a.map(a=>labels[a]).join('・')} / あなたの回答: ${Array.isArray(ans)?ans.map(a=>labels[a]).join('・'):'-'}</div>`:''}
        ${pq.o.map((o,j)=>{
          const cls=optClass(pq,ans,j);
          const isCorrectOpt = Array.isArray(pq.a)?pq.a.includes(j):j===pq.a;
          const isUserAns = Array.isArray(ans)?ans.includes(j):j===ans;
          const origJ = (perms[i]||[0,1,2,3,4])[j];
          const reviewOe = Q[i].oe && Q[i].oe[origJ];
          return `<div class="review-opt ${cls}">
            <strong>${labels[j]}.</strong> ${sanitizeHtml(o)}
            ${isCorrectOpt?' <span class="badge-correct">✓ 正解</span>':''}
            ${isUserAns&&!isCorrectOpt?' <span class="badge-wrong">✗ あなたの回答</span>':''}
            ${reviewOe?`<div class="option-explain" style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(128,128,128,.2);font-size:11px;color:var(--text2)">${sanitizeHtml(reviewOe)}</div>`:''}
          </div>`;
        }).join('')}
        ${pq.e?`<div class="explanation show">${sanitizeHtml(pq.e)}</div>`:''}
      </div>`;
    list.appendChild(item);
  });
  if(!list.children.length)
    list.innerHTML=`<p style="text-align:center;color:var(--text2);padding:24px">${mode==='wrong'?'全問正解！':mode==='bookmark'?'ブックマークなし':'まだ回答がありません'}</p>`;
};

// --- SVG ドーナツチャート ---
function donutSvg(pct, color, size=80) {
  const r = size * 0.39, c = 2*Math.PI*r, off = c - (pct/100)*c;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="${size*.13}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${size*.13}"
      stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${c.toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
      class="donut-arc" data-target="${off.toFixed(1)}"/>
    <text x="${size/2}" y="${size/2}" text-anchor="middle" dy=".35em" fill="var(--text)"
      font-size="${size*.19}" font-weight="900" font-family="monospace">${pct}%</text>
  </svg>`;
}
function animateDonut(el) {
  setTimeout(() => {
    el.querySelectorAll('.donut-arc').forEach(a => {
      a.style.transition = 'stroke-dashoffset 1s ease';
      a.style.strokeDashoffset = a.dataset.target;
    });
  }, 100);
}

// --- SVG レーダーチャート ---
function renderRadarChart(container, data) {
  if (!data.length) { container.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;font-size:12px">データなし</p>'; return; }
  const size=260, cx=130, cy=130, R=88, levels=4, n=data.length;
  const angles = data.map((_,i) => (i*2*Math.PI/n) - Math.PI/2);
  let grid='';
  for(let l=1;l<=levels;l++){
    const r=R*l/levels;
    const pts=angles.map(a=>`${(cx+r*Math.cos(a)).toFixed(1)},${(cy+r*Math.sin(a)).toFixed(1)}`).join(' ');
    grid+=`<polygon points="${pts}" fill="none" stroke="var(--border)" stroke-width=".8" opacity=".6"/>`;
    const lx=(cx+(r+3)*Math.cos(-Math.PI/2)).toFixed(1), ly=(cy+(r+3)*Math.sin(-Math.PI/2)-2).toFixed(1);
    grid+=`<text x="${lx}" y="${ly}" text-anchor="middle" fill="var(--text2)" font-size="7">${Math.round(l/levels*100)}%</text>`;
  }
  let axes='';
  angles.forEach(a=>{axes+=`<line x1="${cx}" y1="${cy}" x2="${(cx+R*Math.cos(a)).toFixed(1)}" y2="${(cy+R*Math.sin(a)).toFixed(1)}" stroke="var(--border)" stroke-width=".8" opacity=".6"/>`;});
  const dataPts=data.map((d,i)=>{const r=d.answered>0?R*d.value/100:0;return`${(cx+r*Math.cos(angles[i])).toFixed(1)},${(cy+r*Math.sin(angles[i])).toFixed(1)}`;});
  const dataArea=`<polygon points="${dataPts.join(' ')}" fill="rgba(59,130,246,.2)" stroke="#3b82f6" stroke-width="2"/>`;
  const dots=data.map((d,i)=>{const r=d.answered>0?R*d.value/100:0;const dx=(cx+r*Math.cos(angles[i])).toFixed(1),dy=(cy+r*Math.sin(angles[i])).toFixed(1);const c=d.answered===0?'#64748b':d.value>=70?'#22c55e':d.value>=40?'#f59e0b':'#ef4444';return`<circle cx="${dx}" cy="${dy}" r="3.5" fill="${c}" stroke="var(--bg2)" stroke-width="1.5"/>`;}).join('');
  const labelR=R+20;
  const labels=data.map((d,i)=>{const lx=(cx+labelR*Math.cos(angles[i])).toFixed(1),ly=(cy+labelR*Math.sin(angles[i])).toFixed(1);const anchor=parseFloat(lx)<cx-6?'end':parseFloat(lx)>cx+6?'start':'middle';const short=d.label.length>7?d.label.slice(0,7)+'…':d.label;const col=d.answered===0?'var(--text2)':d.value>=70?'var(--correct)':d.value>=40?'var(--warn)':'var(--wrong)';return`<text x="${lx}" y="${ly}" text-anchor="${anchor}" fill="${col}" font-size="8.5" font-weight="600" dy=".35em">${short}</text>`;}).join('');
  const refPts=angles.map(a=>`${(cx+R*.7*Math.cos(a)).toFixed(1)},${(cy+R*.7*Math.sin(a)).toFixed(1)}`).join(' ');
  const refLine=`<polygon points="${refPts}" fill="none" stroke="rgba(34,197,94,.4)" stroke-width="1" stroke-dasharray="3,3"/>`;
  container.innerHTML=`<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${grid}${axes}${refLine}${dataArea}${dots}${labels}</svg>`;
}

// --- SVG 横棒グラフ ---
function renderBarChart(container, data) {
  if (!data.length) { container.innerHTML = '<p style="text-align:center;color:var(--text2);padding:20px;font-size:12px">データなし</p>'; return; }
  const barH=22,gap=7,padT=8,padB=24,labelW=85,barW=130,valW=40,totalW=labelW+barW+valW+10;
  const totalH=data.length*(barH+gap)+padT+padB;
  let bars='';
  data.forEach((d,i)=>{
    const y=padT+i*(barH+gap), w=d.answered>0?barW*Math.min(d.value,100)/100:0;
    const col=d.answered===0?'var(--bg3)':d.value>=70?'#22c55e':d.value>=40?'#f59e0b':'#ef4444';
    const short=d.label.length>11?d.label.slice(0,11)+'…':d.label;
    bars+=`<text x="${labelW-4}" y="${y+barH/2}" text-anchor="end" fill="var(--text2)" font-size="9.5" dy=".35em">${short}</text>
      <rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="var(--bg3)"/>
      <rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="4" fill="${col}"/>
      <text x="${labelW+w+4}" y="${y+barH/2}" fill="var(--text)" font-size="10" font-weight="700" dy=".35em">${d.answered>0?d.value+'%':'-'}</text>
      <text x="${totalW}" y="${y+barH/2}" text-anchor="end" fill="var(--text2)" font-size="8.5" dy=".35em">${d.answered}/${d.total}</text>`;
  });
  const refX=(labelW+barW*0.7).toFixed(1);
  const refLine=`<line x1="${refX}" y1="${padT-4}" x2="${refX}" y2="${totalH-padB+4}" stroke="rgba(34,197,94,.5)" stroke-width="1" stroke-dasharray="3,3"/><text x="${refX}" y="${totalH-padB+14}" text-anchor="middle" fill="var(--correct)" font-size="8">70%</text>`;
  container.innerHTML=`<svg viewBox="0 0 ${totalW} ${totalH}" width="100%" style="max-width:${totalW}px">${refLine}${bars}</svg>`;
}

// --- 実績 ---
const ACHIEVEMENTS = [
  {id:'first_answer',icon:'🎯',name:'初回回答',desc:'初めて問題に答えた'},
  {id:'halfway',icon:'🏃',name:'ハーフタイム',desc:'1セット50%回答'},
  {id:'complete_set',icon:'✅',name:'完走',desc:'1セット全問回答'},
  {id:'pmp_ready',icon:'🏆',name:'PMP合格圏',desc:'正答率70%以上達成'},
  {id:'perfect_domain',icon:'⭐',name:'ドメイン完璧',desc:'ドメイン正答率100%'},
  {id:'streak_3',icon:'🔥',name:'3日連続',desc:'3日連続学習'},
  {id:'streak_7',icon:'⚡',name:'7日連続',desc:'7日連続学習'},
  {id:'bookmarker',icon:'📌',name:'ブックマーカー',desc:'5問以上ブックマーク'},
  {id:'all_sets',icon:'🌟',name:'全セット制覇',desc:'全セット70%以上'},
  {id:'multi_master',icon:'🎲',name:'複数選択マスター',desc:'複数選択問題を全問正解'},
];

function checkAchievements() {
  const earned=new Set(); let allGood=true, hasAny=false;
  const streak=getStreak();
  if(streak>=3) earned.add('streak_3'); if(streak>=7) earned.add('streak_7');
  for(let i=0;i<ALL_SETS.length;i++){
    const bm=loadBookmarks(i); if(bm.length>=5) earned.add('bookmarker');
    const s=storageOK()&&localStorage.getItem(`pmp_study_v1_s${i}`);
    if(!s||!ALL_SETS[i]){allGood=false;continue;}
    try{const d=JSON.parse(s);if(!d.answers){allGood=false;continue;}
      const answered=d.answers.filter(a=>a!==undefined).length;
      const correct=d.answers.filter((a,j)=>isCorrectFromSaved(ALL_SETS[i][j],a,d.perms?.[j])).length;
      if(answered>0){hasAny=true;earned.add('first_answer');}
      if(answered>=ALL_SETS[i].length/2) earned.add('halfway');
      if(answered>=ALL_SETS[i].length) earned.add('complete_set');
      const acc=answered>0?correct/answered*100:0;
      if(acc>=70&&answered>0) earned.add('pmp_ready'); else allGood=false;
      const dom={};
      ALL_SETS[i].forEach((q,j)=>{if(!dom[q.d])dom[q.d]={a:0,c:0};if(d.answers[j]!==undefined){dom[q.d].a++;if(isCorrectFromSaved(q,d.answers[j],d.perms?.[j]))dom[q.d].c++;}});
      if(Object.values(dom).some(s=>s.a>=3&&s.a===s.c)) earned.add('perfect_domain');
      // 複数選択マスター
      const multiQ=ALL_SETS[i].filter(q=>Array.isArray(q.a));
      const multiIdxs=ALL_SETS[i].map((_,j)=>j).filter(j=>Array.isArray(ALL_SETS[i][j].a));
      if(multiIdxs.length>0&&multiIdxs.every(j=>d.answers[j]!==undefined&&isCorrectFromSaved(ALL_SETS[i][j],d.answers[j],d.perms?.[j]))) earned.add('multi_master');
    }catch{}
  }
  if(allGood&&hasAny) earned.add('all_sets');
  return earned;
}

// --- ダッシュボード ---
function renderDashboard() {
  let totalAnswered=0,totalCorrect=0,totalBookmarks=0;
  for(let i=0;i<ALL_SETS.length;i++){
    totalBookmarks+=loadBookmarks(i).length;
    if(!ALL_SETS[i]) continue;
    const s=storageOK()&&localStorage.getItem(`pmp_study_v1_s${i}`);
    if(!s) continue;
    try{const d=JSON.parse(s);if(!d.answers) continue;
      totalAnswered+=d.answers.filter(a=>a!==undefined).length;
      totalCorrect+=d.answers.filter((a,j)=>isCorrectFromSaved(ALL_SETS[i][j],a,d.perms?.[j])).length;
    }catch{}
  }
  const globalAcc=totalAnswered>0?Math.round(totalCorrect/totalAnswered*100):null;
  const streak=getStreak();
  $('sumTotal').textContent=totalAnswered;
  $('sumAcc').textContent=globalAcc!==null?globalAcc+'%':'-';
  $('sumAcc').className='summary-value'+(globalAcc===null?'':globalAcc>=70?' good':globalAcc>=40?' warn':' bad');
  $('sumStreak').textContent=streak+'日';
  $('sumBookmarks').textContent=totalBookmarks;

  // セットカード
  const grid=$('setGrid'); grid.innerHTML='';
  const setNames=['統合・スコープ・スケジュール・コスト','品質・資源・コミュニケーション・リスク・調達・ステークホルダー','アジャイル・ハイブリッド・リーダーシップ'];
  for(let i=0;i<ALL_SETS.length;i++){
    const card=document.createElement('div');
    card.className='set-card'+(i===setIdx?' active':'');
    let acc=null,answered=0,total=ALL_SETS[i]?ALL_SETS[i].length:0;
    const s=storageOK()&&localStorage.getItem(`pmp_study_v1_s${i}`);
    if(s){try{const d=JSON.parse(s);if(d.answers&&ALL_SETS[i]){
      const c=d.answers.filter((a,j)=>isCorrectFromSaved(ALL_SETS[i][j],a,d.perms?.[j])).length;
      answered=d.answers.filter(a=>a!==undefined).length;
      acc=answered>0?Math.round(c/answered*100):null;
    }}catch{}}
    const color=acc===null?'#64748b':acc>=70?'#22c55e':acc>=40?'#f59e0b':'#ef4444';
    const multiCount=ALL_SETS[i]?ALL_SETS[i].filter(q=>Array.isArray(q.a)).length:0;
    card.innerHTML=`
      <div class="set-card-title">Set ${i+1}</div>
      <div class="set-card-sub">${setNames[i]}</div>
      <div style="display:flex;gap:10px;align-items:center;justify-content:center">
        <div>${donutSvg(acc??0,color)}</div>
        <div>${donutSvg(total>0?Math.round(answered/total*100):0,'#3b82f6')}</div>
      </div>
      <div class="set-card-stats" style="display:flex;gap:12px;justify-content:center;margin-top:4px"><span>正答率</span><span>進捗</span></div>
      <div class="set-card-stats">${answered}/${total||'?'}問 ${multiCount?`｜ 複数選択 ${multiCount}問`:''}${acc!==null?` ｜ ${acc}%`:''}</div>`;
    card.onclick=()=>loadSet(i);
    grid.appendChild(card);
    animateDonut(card);
  }

  const gd=calcDomainStats();
  const domData=Object.entries(gd).sort((a,b)=>a[0].localeCompare(b[0],'ja')).map(([label,s])=>({label,value:s.a>0?Math.round(s.c/s.a*100):0,answered:s.a,total:s.t}));
  renderRadarChart($('radarWrap'),domData);
  renderBarChart($('barChartWrap'),domData);

  // 苦手ドメイン
  const weakDoms=domData.filter(d=>d.answered>0&&d.value<50);
  const weakEl=$('weakAlert');
  if(weakDoms.length){
    weakEl.classList.remove('hidden');
    weakEl.innerHTML=`<div class="weak-alert"><div class="weak-alert-title">⚠ 強化が必要なドメイン（正答率50%未満）</div>${weakDoms.map(d=>`<div class="weak-domain-item"><div class="weak-dot"></div><span style="flex:1;font-size:13px">${d.label}</span><span style="font-family:var(--mono);font-weight:700;color:var(--wrong)">${d.value}%</span><span style="font-size:11px;color:var(--text2);margin-left:6px">${d.answered}/${d.total}</span></div>`).join('')}</div>`;
  } else { weakEl.classList.add('hidden'); }

  // ドメイン詳細
  const bd=$('globalDomainBreakdown'); bd.innerHTML='';
  if(!domData.length){bd.innerHTML='<p style="text-align:center;color:var(--text2);padding:20px">データがありません</p>';return;}
  domData.forEach(d=>{
    const cls=d.answered===0?'':d.value>=70?'good':d.value>=40?'ok':'bad';
    const barColor=d.answered===0?'var(--bg3)':d.value>=70?'var(--correct)':d.value>=40?'var(--warn)':'var(--wrong)';
    const row=document.createElement('div'); row.className='domain-row';
    row.innerHTML=`<span class="domain-name">${d.label}</span>
      <div class="domain-bar-track"><div class="domain-bar-fill" style="width:0%;background:${barColor}"></div></div>
      <span class="domain-acc ${cls}">${d.answered>0?d.value+'%':'-'}</span>
      <span style="font-size:11px;color:var(--text2)">${d.answered}/${d.total}</span>`;
    bd.appendChild(row);
    setTimeout(()=>{row.querySelector('.domain-bar-fill').style.width=d.value+'%';},150);
  });

  // 実績
  const earned=checkAchievements();
  $('achievementCount').textContent=`${earned.size} / ${ACHIEVEMENTS.length} 獲得`;
  $('achievementGrid').innerHTML=ACHIEVEMENTS.map(a=>`<div class="achievement-card ${earned.has(a.id)?'earned':''}" title="${a.desc}"><span class="achievement-icon">${a.icon}</span><div class="achievement-name">${a.name}</div><div class="achievement-desc">${a.desc}</div></div>`).join('');

  // 学習履歴
  const sessions=loadAllSessions();
  const hist=$('sessionHistory');
  if(!sessions.length){hist.innerHTML='<p style="text-align:center;color:var(--text2);padding:16px;font-size:13px">結果を記録するには「結果を見る」を開いてください</p>';}
  else{hist.innerHTML=sessions.slice(0,10).map(s=>{const col=s.acc>=70?'#22c55e':s.acc>=40?'#f59e0b':'#ef4444';return`<div class="history-item"><span class="history-set">Set ${s.set+1}</span><span class="history-date">${s.date}</span><span class="history-acc" style="color:${col}">${s.acc}%</span><div class="history-bar"><div class="history-bar-fill" style="width:${s.acc}%;background:${col}"></div></div><span class="history-detail">${s.correct}/${s.answered}問正解</span></div>`;}).join('');}
}

// --- エクスポート ---
window.saveResultsHtml = function() {
  const answered=answers.filter(a=>a!==undefined).length;
  const correct=Q.filter((_,i)=>isCorrectAnswer(i)).length;
  const acc=answered>0?Math.round(correct/answered*100):0;
  const labels=['A','B','C','D','E'];
  const html=`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>PMP結果 ${new Date().toLocaleDateString('ja-JP')}</title>
<style>body{font-family:sans-serif;max-width:800px;margin:20px auto;padding:20px;color:#1e293b}h1{color:#3b82f6}table{border-collapse:collapse;width:100%}td,th{border:1px solid #e2e8f0;padding:8px;text-align:left}th{background:#f8fafc}.c{color:#22c55e;font-weight:700}.w{color:#ef4444;font-weight:700}.m{font-size:11px;color:#64748b}</style></head><body>
<h1>🎯 PMP学習 結果レポート</h1>
<p>日時: ${new Date().toLocaleString('ja-JP')} | セット${setIdx+1}</p>
<p><strong>正答率: ${acc}%</strong>（${correct}問正解 / ${answered}問回答 / ${Q.length}問中）</p>
<table><tr><th>No.</th><th>種別</th><th>ドメイン</th><th>結果</th><th>あなたの回答</th><th>正解</th></tr>
${Q.map((q,i)=>{const pq=applyPerm(Q[i],perms[i]);const ans=answers[i];if(ans===undefined)return'';const ok=isCorrectAnswer(i);const isM=Array.isArray(pq.a);const userAns=isM?(Array.isArray(ans)?ans.map(a=>labels[a]).join(','):'-'):labels[ans];const correctAns=isM?pq.a.map(a=>labels[a]).join(','):labels[pq.a];return`<tr><td>Q${i+1}</td><td class="m">${isM?'複数選択':'単一選択'}</td><td>${q.d}</td><td class="${ok?'c':'w'}">${ok?'○':'✗'}</td><td>${userAns}</td><td>${correctAns}</td></tr>`;}).join('')}
</table></body></html>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download=`pmp-result-set${setIdx+1}-${new Date().toISOString().slice(0,10)}.html`; a.click();
};

// --- キーボード操作 ---
document.addEventListener('keydown', e => {
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  if(e.key==='ArrowLeft'||e.key==='h') prevQ();
  if(e.key==='ArrowRight'||e.key==='l') nextQ();
  if(e.key==='m') toggleMarkReview();
  // 単一選択のみキーボード回答
  const fi=filteredIndices(); if(!fi.length) return;
  const qi=fi[pos];
  if(Q[qi]&&!Array.isArray(Q[qi].a)) {
    if(['1','2','3','4'].includes(e.key)) { if(answers[qi]===undefined) selectAnswer(qi,+e.key-1); }
    if(['a','b','c','d'].includes(e.key.toLowerCase())) { if(answers[qi]===undefined) selectAnswer(qi,'abcd'.indexOf(e.key.toLowerCase())); }
  }
});

// --- 初期化 ---
function init() { buildSetSelector(); loadSet(0); }
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
else init();
