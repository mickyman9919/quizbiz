/* หน้าผู้เล่น (มือถือ) */
const socket = io();
const app = $('#app');
const params = new URLSearchParams(location.search);
let pin = (params.get('pin') || '').replace(/\D/g, '');
let playerId = null;
let booted = false;
let currentKey = '';
let stopTimer = null;
let profile = loadProfile();

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('kq_profile'));
    if (p && typeof p.name === 'string') return p;
  } catch {}
  return { name: '', ...randomAvatar() };
}
function saveProfile() {
  try { localStorage.setItem('kq_profile', JSON.stringify(profile)); } catch {}
}
const keyFor = (p) => 'kq_player_' + p;

function render(html, key = '') {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  currentKey = key;
  app.innerHTML = html;
}

/* ---------- การเชื่อมต่อ ---------- */
socket.on('connect', () => {
  $('#net').hidden = true;
  if (playerId) return rejoin();
  if (!booted) {
    booted = true;
    pin ? checkPin(pin) : showPin();
  }
});
socket.on('disconnect', () => ($('#net').hidden = false));
socket.on('player:state', (s) => renderState(s));
socket.on('player:kicked', () => { forget(); showMessage('🚪', 'คุณถูกนำออกจากห้องโดยผู้ดำเนินเกม'); });
socket.on('room:closed', () => { forget(); showMessage('👋', 'ผู้ดำเนินเกมปิดห้องแล้ว ขอบคุณที่ร่วมเล่น!'); });

function forget() {
  if (pin) localStorage.removeItem(keyFor(pin));
  playerId = null;
}

function showMessage(icon, text) {
  render(`<div class="center-screen"><div class="card msg-card">
    <div class="big-icon">${icon}</div><p>${esc(text)}</p>
    <a class="btn btn-primary" href="/play">เข้าห้องอื่น</a></div></div>`, 'msg');
}

/* ---------- ใส่ PIN ---------- */
function showPin(error = '') {
  render(`<div class="center-screen"><div class="card join-card">
    <div class="logo">Quiz<span>Blitz</span></div>
    <form id="pinForm">
      <input id="pinInput" class="big-input" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Game PIN" value="${esc(pin)}">
      ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
      <button class="btn btn-primary btn-block btn-lg">ถัดไป</button>
    </form></div></div>`, 'pin');
  const input = $('#pinInput');
  input.focus();
  $('#pinForm').onsubmit = (e) => {
    e.preventDefault();
    const v = input.value.replace(/\D/g, '');
    if (v.length !== 6) return showPin('PIN ต้องเป็นตัวเลข 6 หลัก');
    checkPin(v);
  };
}

function checkPin(p) {
  socket.emit('player:check', { pin: p }, (res) => {
    pin = p;
    if (res.error) return showPin(res.error);
    history.replaceState(null, '', '/play?pin=' + pin);
    const saved = localStorage.getItem(keyFor(pin));
    if (saved) {
      playerId = saved;
      rejoin(res);
    } else showProfile(res);
  });
}

function rejoin(info) {
  socket.emit('player:join', { pin, playerId }, (res) => {
    if (res.ok) return; // จะได้รับ player:state ตามมา
    forget();
    if (res.code === 'NO_PLAYER') showProfile(info || {});
    else showMessage('😕', res.error);
  });
}

/* ---------- ตั้งชื่อ + เลือกอวาตาร์ ---------- */
function showProfile(info = {}) {
  const sel = { a: profile.a, c: profile.c };
  render(`<div class="center-screen"><div class="card profile-card">
    <div class="muted small center">ห้อง ${esc(pin)}${info.quizTitle ? ' · ' + esc(info.quizTitle) : ''}</div>
    <h2>ตั้งชื่อและเลือกตัวละคร</h2>
    <div class="avatar-preview" id="preview">${avatarHtml(sel, 'xl')}</div>
    <form id="profileForm">
      <input id="nameInput" class="big-input" maxlength="20" placeholder="ชื่อเล่นของคุณ" value="${esc(profile.name)}" autocomplete="off">
      <div class="section-label">ตัวละคร <button type="button" class="btn btn-ghost btn-sm" id="randomBtn">🎲 สุ่มให้หน่อย</button></div>
      <div class="avatar-grid" id="avatarGrid">${KQ.AVATARS.map((e, i) => `<button type="button" class="avatar-opt${i === sel.a ? ' selected' : ''}" data-a="${i}">${e}</button>`).join('')}</div>
      <div class="section-label">สีพื้นหลัง</div>
      <div class="color-row" id="colorRow">${KQ.COLORS.map((c, i) => `<button type="button" class="color-opt${i === sel.c ? ' selected' : ''}" data-c="${i}" style="--av:${c}" aria-label="สี ${i + 1}"></button>`).join('')}</div>
      <div class="form-error" id="profileError" hidden></div>
      <button class="btn btn-primary btn-block btn-lg" id="joinBtn">เข้าร่วมเกม 🚀</button>
    </form></div></div>`, 'profile');

  const update = () => {
    $('#preview').innerHTML = avatarHtml(sel, 'xl');
    $$('.avatar-opt').forEach((b) => b.classList.toggle('selected', +b.dataset.a === sel.a));
    $$('.color-opt').forEach((b) => b.classList.toggle('selected', +b.dataset.c === sel.c));
  };
  $('#avatarGrid').onclick = (e) => {
    const b = e.target.closest('[data-a]');
    if (b) { sel.a = +b.dataset.a; update(); }
  };
  $('#colorRow').onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (b) { sel.c = +b.dataset.c; update(); }
  };
  $('#randomBtn').onclick = () => {
    Object.assign(sel, randomAvatar());
    update();
    $(`[data-a="${sel.a}"]`).scrollIntoView({ block: 'nearest' });
  };
  $('#profileForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#nameInput').value.trim();
    const err = $('#profileError');
    if (!name) { err.textContent = 'กรุณาใส่ชื่อ'; err.hidden = false; return; }
    $('#joinBtn').disabled = true;
    socket.emit('player:join', { pin, name, avatar: sel }, (res) => {
      if (!res.ok) {
        if ($('#joinBtn')) $('#joinBtn').disabled = false;
        err.textContent = res.error;
        err.hidden = false;
        return;
      }
      playerId = res.playerId;
      profile = { name, ...sel };
      saveProfile();
      localStorage.setItem(keyFor(pin), playerId);
    });
  };
}

/* ---------- หน้าจอระหว่างเกม ---------- */
const bar = (s) => `<div class="player-bar">${avatarHtml(s.me.avatar, 'sm')}<span class="pname">${esc(s.me.name)}</span><span class="pscore">${fmt(s.me.score)}</span></div>`;
const screen = (s, body, cls = '') => `<div class="player-screen ${cls}">${bar(s)}${body}</div>`;

function renderState(s) {
  const sub = s.phase === 'question' ? (s.answer === null ? 'open' : 'done') : '';
  const key = `${s.phase}:${s.qIndex}:${sub}`;
  if (key === currentKey) {
    if (s.phase === 'lobby' && $('#pc')) $('#pc').textContent = s.playerCount;
    return;
  }
  const fn = { lobby, ready, question, reveal, leaderboard, ended }[s.phase];
  if (fn) fn(s, key);
}

function lobby(s, key) {
  render(screen(s, `<div class="center-body">
    <div class="avatar-bounce">${avatarHtml(s.me.avatar, 'xl')}</div>
    <h2>เข้าร่วมแล้ว!</h2>
    <p class="muted-light">เห็นชื่อตัวเองบนจอหรือยัง? รอผู้ดำเนินเกมเริ่มได้เลย</p>
    <div class="pill">👥 <span id="pc">${s.playerCount}</span> คนในห้อง</div>
    <button class="btn btn-ghost-light btn-sm" id="editBtn">✏️ เปลี่ยนชื่อ/ตัวละคร</button>
  </div>`), key);
  $('#editBtn').onclick = () => {
    socket.emit('player:leave', {}, () => {
      forget();
      showProfile({ quizTitle: s.quizTitle });
    });
  };
}

function ready(s, key) {
  render(screen(s, `<div class="center-body">
    <div class="q-badge lg">คำถามที่ ${s.qIndex + 1}/${s.total}</div>
    <h2>เตรียมตัว!</h2>
    <p class="muted-light">ดูคำถามบนจอใหญ่</p>
    <div class="loader"></div>
  </div>`), key);
}

function question(s, key) {
  if (s.answer !== null) return answered(s, s.answer, key);
  const q = s.question;
  render(screen(s, `
    <div class="timer-bar"><div id="tbar"></div></div>
    <div class="p-question">
      <div class="head"><span class="q-badge">ข้อ ${s.qIndex + 1}/${s.total}</span><span class="tleft" id="tleft">${q.time}</span></div>
      <div class="p-qtext">${esc(q.text)}</div>
    </div>
    <div class="p-choices">${q.choices.map((c, i) => `
      <button class="p-choice" data-i="${i}" style="--cc:${CHOICES[i].color}">
        <span class="shape">${CHOICES[i].shape}</span><span class="ctext">${esc(c)}</span>
      </button>`).join('')}</div>`), key);

  stopTimer = countdown(s.remaining, q.time * 1000, (left, frac) => {
    $('#tbar').style.width = frac * 100 + '%';
    $('#tleft').textContent = Math.ceil(left / 1000);
  });
  $('.p-choices').onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const choice = +b.dataset.i;
    if (navigator.vibrate) navigator.vibrate(30);
    socket.emit('player:answer', { choice });
    answered(s, choice, `question:${s.qIndex}:done`);
  };
}

function answered(s, choice, key) {
  render(screen(s, `<div class="center-body">
    <div class="chosen" style="--cc:${CHOICES[choice].color}">${CHOICES[choice].shape}</div>
    <h2>ส่งคำตอบแล้ว!</h2>
    <p class="muted-light">รอผู้เล่นคนอื่น... ⏳</p>
  </div>`), key);
}

function reveal(s, key) {
  const r = s.result;
  const answerText = r.correctChoices.map((i) => esc(r.choices[i])).join(', ');
  let cls, icon, title, extra = '';
  if (!r.answered) {
    cls = 'res-time'; icon = '⏰'; title = 'หมดเวลา!';
  } else if (r.correct) {
    cls = 'res-ok'; icon = '✅'; title = 'ถูกต้อง!';
    extra = `<div class="res-points">+${fmt(r.points)}</div>` +
      (r.streak >= 2 ? `<div class="res-streak">🔥 ตอบถูกติดกัน ${r.streak} ข้อ</div>` : '');
    if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
  } else {
    cls = 'res-bad'; icon = '❌'; title = 'ยังไม่ถูกนะ';
  }
  render(screen(s, `<div class="center-body">
    <div class="res-icon">${icon}</div>
    <h2>${title}</h2>
    ${extra}
    ${!r.correct ? `<div class="res-answer">คำตอบที่ถูก: <b>${answerText}</b></div>` : ''}
    <p>ตอนนี้คุณอยู่อันดับที่ <b>${s.me.rank}</b> จาก ${s.playerCount} คน</p>
  </div>`, cls), key);
}

function leaderboard(s, key) {
  const msg = s.me.rank === 1
    ? 'คุณนำอยู่! 🏆 รักษาตำแหน่งไว้นะ'
    : s.ahead ? `ตามหลัง <b>${esc(s.ahead.name)}</b> อยู่ ${fmt(s.ahead.gap)} คะแนน` : 'สู้ต่อไป!';
  render(screen(s, `<div class="center-body">
    <p class="muted-light">อันดับของคุณ</p>
    <div class="rank-big">#${s.me.rank}</div>
    <p class="muted-light">จาก ${s.playerCount} คน</p>
    <div class="score-big">${fmt(s.me.score)} คะแนน</div>
    <p>${msg}</p>
  </div>`), key);
}

function ended(s, key) {
  const medal = ['🏆', '🥈', '🥉'][s.me.rank - 1];
  const title = s.me.rank === 1 ? 'คุณคือแชมป์!' : s.me.rank <= 3 ? `อันดับที่ ${s.me.rank} เยี่ยมมาก!` : 'จบเกมแล้ว!';
  render(screen(s, `<div class="center-body">
    <div class="res-icon">${medal || '🎉'}</div>
    <h2>${title}</h2>
    <div class="score-big">อันดับ #${s.me.rank} · ${fmt(s.me.score)} คะแนน</div>
    <p class="muted-light">ตอบถูก ${s.correctCount} จาก ${Math.max(0, s.qIndex + 1)} ข้อ</p>
    <div class="mini-podium">${s.podium.map((p) => `
      <div class="row"><span>${['🥇', '🥈', '🥉'][p.rank - 1] || p.rank}</span>${avatarHtml(p.avatar, 'sm')}<span>${esc(p.name)}</span><b>${fmt(p.score)}</b></div>`).join('')}
    </div>
    <a class="btn btn-ghost-light" href="/play" style="margin-top:12px">เล่นเกมใหม่</a>
  </div>`), key);
  localStorage.removeItem(keyFor(pin));
}
