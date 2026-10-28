/* จอโฮสต์ (เปิดบนโปรเจกเตอร์/จอใหญ่) */
const socket = io();
const app = $('#app');
const params = new URLSearchParams(location.search);
let pin = (params.get('pin') || '').replace(/\D/g, '');
const quizId = params.get('quiz');
let state = null;
let currentKey = '';
let stopTimer = null;
const seenPlayers = new Set();

function render(html, key) {
  if (stopTimer) { stopTimer(); stopTimer = null; }
  currentKey = key;
  app.innerHTML = html;
}
function fatal(msg) {
  render(`<div class="center-screen"><div class="card msg-card">
    <div class="big-icon">⚠️</div><p>${esc(msg)}</p>
    <a class="btn btn-primary" href="/admin">กลับหน้าจัดการ</a></div></div>`, 'fatal');
}
function act(event, data) {
  socket.emit(event, data || {}, (res) => res && res.error && toast(res.error, 'error'));
}

/* ---------- การเชื่อมต่อ ---------- */
socket.on('connect', () => {
  $('#net').hidden = true;
  if (pin) rejoin();
  else if (quizId) create();
  else fatal('ไม่ได้ระบุแบบทดสอบที่จะเริ่มเกม');
});
socket.on('disconnect', () => ($('#net').hidden = false));
socket.on('host:state', (s) => { state = s; renderState(s); });
socket.on('host:replaced', () => fatal('ห้องนี้ถูกเปิดควบคุมจากหน้าต่างอื่นแล้ว'));

function create() {
  render(`<div class="center-screen"><div class="loader"></div></div>`, 'loading');
  socket.emit('host:create', { quizId, adminPassword: localStorage.getItem('kq_admin_pw') || '' }, (res) => {
    if (!res.ok) return fatal(res.error);
    pin = res.pin;
    localStorage.setItem('kq_host_' + pin, res.hostKey);
    history.replaceState(null, '', '/host?pin=' + pin);
  });
}
function rejoin() {
  const hostKey = localStorage.getItem('kq_host_' + pin);
  if (!hostKey) return fatal('เบราว์เซอร์นี้ไม่มีสิทธิ์ควบคุมห้อง ' + pin);
  socket.emit('host:rejoin', { pin, hostKey }, (res) => {
    if (!res.ok) {
      localStorage.removeItem('kq_host_' + pin);
      fatal(res.error);
    }
  });
}

/* ---------- เลือกหน้าจอตามสถานะเกม ---------- */
function renderState(s) {
  const key = `${s.phase}:${s.qIndex}`;
  if (key === currentKey) {
    if (s.phase === 'lobby') updateLobby(s);
    if (s.phase === 'question' && $('#ac')) $('#ac').textContent = s.answeredCount;
    return;
  }
  ({ lobby: renderLobby, ready: renderReady, question: renderQuestion, reveal: renderReveal, leaderboard: renderLeaderboard, ended: renderEnded })[s.phase](s, key);
}

function gameBar(s, right = '') {
  return `<div class="host-bar">
    <div class="hb-left">
      <span class="logo-sm">Quiz<span>Blitz</span></span>
      <span class="pill">PIN <b>${s.pin}</b></span>
      ${s.qIndex >= 0 && s.phase !== 'ended' ? `<span class="pill">ข้อ ${s.qIndex + 1}/${s.total}</span>` : ''}
      <span class="pill">👥 ${s.playerCount}</span>
    </div>
    <div class="hb-right">${right}</div>
  </div>`;
}

/* ---------- ห้องรอ + QR ---------- */
function renderLobby(s, key) {
  const host = new URL(s.joinUrl).host;
  render(`<div class="host-lobby">
    <aside class="card join-panel">
      <div class="jp-step">สแกน QR ด้วยมือถือ หรือเข้า<br><b>${esc(host)}/play</b></div>
      <img class="qr" src="${s.qr}" alt="QR code สำหรับเข้าร่วมเกม">
      <div class="pin-label">Game PIN</div>
      <div class="pin">${s.pin.slice(0, 3)} ${s.pin.slice(3)}</div>
      <button class="btn btn-ghost btn-sm" id="copyBtn">📋 คัดลอกลิงก์เข้าห้อง</button>
    </aside>
    <section class="lobby-main">
      <div class="lobby-head">
        <div>
          <div class="muted-light small">แบบทดสอบ</div>
          <h1>${esc(s.quizTitle)}</h1>
          <div class="muted-light">${s.total} คำถาม</div>
        </div>
        <div class="lobby-actions">
          <button class="btn btn-ghost-light" id="lockBtn"></button>
          <button class="btn btn-primary btn-lg" id="startBtn">เริ่มเกม ▶</button>
        </div>
      </div>
      <div class="lobby-count"><span id="pc">0</span> ผู้เล่น</div>
      <div class="player-cloud" id="players"></div>
      <p class="muted-light small center">คลิกที่ชื่อผู้เล่นเพื่อนำออกจากห้อง</p>
    </section>
  </div>`, key);

  $('#copyBtn').onclick = () => {
    (navigator.clipboard ? navigator.clipboard.writeText(s.joinUrl) : Promise.reject())
      .then(() => toast('คัดลอกลิงก์แล้ว', 'success'))
      .catch(() => prompt('คัดลอกลิงก์นี้:', s.joinUrl));
  };
  $('#lockBtn').onclick = () => act('host:lock', { locked: !state.locked });
  $('#startBtn').onclick = () => act('host:next');
  $('#players').onclick = (e) => {
    const chip = e.target.closest('[data-id]');
    if (!chip) return;
    const p = state.players.find((x) => x.id === chip.dataset.id);
    if (p && confirm(`นำ "${p.name}" ออกจากห้อง?`)) act('host:kick', { playerId: p.id });
  };
  updateLobby(s);
}

function updateLobby(s) {
  $('#pc').textContent = s.playerCount;
  $('#lockBtn').textContent = s.locked ? '🔒 ล็อกห้องแล้ว' : '🔓 เปิดรับผู้เล่น';
  $('#startBtn').disabled = !s.playerCount;
  const ps = [...s.players].sort((a, b) => a.joinedAt - b.joinedAt);
  $('#players').innerHTML = ps.length
    ? ps.map((p) => {
        const isNew = !seenPlayers.has(p.id);
        seenPlayers.add(p.id);
        return `<button class="player-chip${isNew ? ' new' : ''}${p.connected ? '' : ' offline'}" data-id="${p.id}" title="นำออก">${avatarHtml(p.avatar, 'sm')}<span>${esc(p.name)}</span></button>`;
      }).join('')
    : `<div class="waiting">รอผู้เล่นเข้าร่วม... 📱</div>`;
}

/* ---------- เตรียมตัว ---------- */
function renderReady(s, key) {
  render(`${gameBar(s)}
    <div class="ready-screen">
      <div class="q-badge lg">คำถามที่ ${s.qIndex + 1} จาก ${s.total}</div>
      <h1 class="q-text">${esc(s.question.text)}</h1>
      <div class="ready-bar"><div></div></div>
    </div>`, key);
}

/* ---------- ระหว่างตอบคำถาม ---------- */
const POINT_LABEL = { standard: '', double: '⭐ คะแนนสองเท่า!', none: 'ข้อนี้ไม่คิดคะแนน' };

function tiles(q) {
  return q.choices.map((c, i) => {
    const ok = q.correct && q.correct.includes(i);
    const cls = q.correct ? (ok ? ' correct' : ' dim') : '';
    return `<div class="choice-tile${cls}" style="--cc:${CHOICES[i].color}">
      <span class="shape">${CHOICES[i].shape}</span><span class="ctext">${esc(c)}</span>
      ${q.correct ? `<span class="cmark">${ok ? '✓' : '✗'}</span>` : ''}
    </div>`;
  }).join('');
}

function media(q) {
  if (q.image) return `<img src="${esc(q.image)}" alt="">`;
  return `<div class="q-media-empty"><span class="big">❓</span>${POINT_LABEL[q.points] || ''}</div>`;
}

function renderQuestion(s, key) {
  const q = s.question;
  render(`${gameBar(s, `<button class="btn btn-ghost-light btn-sm" id="skipBtn">ปิดคำถาม ⏭</button>`)}
    <div class="host-q">
      <h1 class="q-text">${esc(q.text)}</h1>
      <div class="q-middle">
        <div class="timer-circle" id="tc"><span id="tl">${q.time}</span></div>
        <div class="q-media">${media(q)}</div>
        <div class="answers-count"><b id="ac">${s.answeredCount}</b><span>คำตอบ</span></div>
      </div>
      <div class="choice-grid">${tiles(q)}</div>
    </div>`, key);
  $('#skipBtn').onclick = () => act('host:next');
  stopTimer = countdown(s.remaining, q.time * 1000, (left, frac) => {
    const sec = Math.ceil(left / 1000);
    $('#tl').textContent = sec;
    $('#tc').style.setProperty('--p', frac);
    $('#tc').classList.toggle('urgent', sec <= 5);
  });
}

/* ---------- เฉลย + สถิติรายข้อ ---------- */
function renderReveal(s, key) {
  const q = s.question;
  const st = s.stats;
  const max = Math.max(1, ...st.distribution);
  const pct = st.players ? Math.round((st.correct / st.players) * 100) : 0;
  render(`${gameBar(s, `<button class="btn btn-primary" id="nextBtn">สรุปคะแนน ➜</button>`)}
    <div class="host-q">
      <h1 class="q-text">${esc(q.text)}</h1>
      <div class="reveal-mid">
        <div class="dist-chart">${st.distribution.map((n, i) => `
          <div class="dist-col${q.correct.includes(i) ? '' : ' dim'}" style="--cc:${CHOICES[i].color}">
            <div class="dist-num">${n}</div>
            <div class="dist-bar" style="height:0" data-h="${(n / max) * 170}"></div>
            <div class="dist-icon">${CHOICES[i].shape}${q.correct.includes(i) ? ' ✓' : ''}</div>
          </div>`).join('')}
        </div>
        <div class="reveal-stats">
          <div class="big">${pct}%</div>
          <div>ตอบถูก ${st.correct} จาก ${st.players} คน</div>
          <div>ไม่ได้ตอบ ${Math.max(0, st.players - st.answered)} คน</div>
          <div>เวลาเฉลี่ย ${st.avgTime} วินาที</div>
        </div>
      </div>
      <div class="choice-grid">${tiles(q)}</div>
    </div>`, key);
  requestAnimationFrame(() => requestAnimationFrame(() =>
    $$('.dist-bar').forEach((b) => (b.style.height = b.dataset.h + 'px'))));
  $('#nextBtn').onclick = () => act('host:next');
}

/* ---------- สรุปคะแนนหลังแต่ละข้อ ---------- */
function renderLeaderboard(s, key) {
  const last = s.qIndex + 1 >= s.total;
  const top = s.players.slice(0, 10);
  render(`${gameBar(s, `<button class="btn btn-ghost-light btn-sm" id="endBtn">จบเกมเลย</button>
      <button class="btn btn-primary" id="nextBtn">${last ? 'ดูผลสรุป 🏆' : 'คำถามถัดไป ➜'}</button>`)}
    <div class="leaderboard">
      <h1>สรุปคะแนน</h1>
      <div class="muted-light">หลังคำถามที่ ${s.qIndex + 1} จาก ${s.total}</div>
      <div class="lb-list">${top.map((p, i) => {
        const diff = p.prevRank ? p.prevRank - p.rank : 0;
        const move = diff > 0 ? `<span class="lb-move up">▲${diff}</span>` : diff < 0 ? `<span class="lb-move down">▼${-diff}</span>` : '<span class="lb-move"></span>';
        return `<div class="lb-row" style="animation-delay:${i * 60}ms">
          <span class="lb-rank">${p.rank}</span>${avatarHtml(p.avatar, 'md')}
          <span class="lb-name">${esc(p.name)}${p.streak >= 2 ? ` 🔥${p.streak}` : ''}</span>
          ${p.lastPoints ? `<span class="lb-delta">+${fmt(p.lastPoints)}</span>` : ''}
          ${move}
          <span class="lb-score">${fmt(p.score)}</span>
        </div>`;
      }).join('')}</div>
      ${s.players.length > 10 ? `<p class="muted-light">และผู้เล่นอีก ${s.players.length - 10} คน</p>` : ''}
    </div>`, key);
  $('#nextBtn').onclick = () => act('host:next');
  $('#endBtn').onclick = () => confirm('จบเกมตอนนี้และแสดงผลสรุป?') && act('host:end');
}

/* ---------- ผลสรุปตอนจบ ---------- */
function renderEnded(s, key) {
  const top3 = s.players.slice(0, 3);
  const order = [1, 0, 2].filter((i) => top3[i]);
  render(`${gameBar(s, `
      <button class="btn btn-ghost-light btn-sm" id="csvBtn">⬇ ดาวน์โหลด CSV</button>
      <button class="btn btn-ghost-light btn-sm" id="closeBtn">ปิดห้อง</button>
      <a class="btn btn-primary btn-sm" href="/admin">หน้าจัดการ</a>`)}
    <div class="final">
      <h1>🏆 ผลการแข่งขัน</h1>
      <div class="podium">${order.map((i) => {
        const p = top3[i];
        return `<div class="podium-col place-${i + 1}">
          ${avatarHtml(p.avatar, 'lg')}
          <div class="pname">${esc(p.name)}</div>
          <div class="pscore">${fmt(p.score)} คะแนน</div>
          <div class="podium-block">${i + 1}</div>
        </div>`;
      }).join('')}</div>
      <div class="final-grid">
        <div class="card">
          <h3>อันดับทั้งหมด (${s.players.length} คน)</h3>
          <table class="table">
            <thead><tr><th>#</th><th>ผู้เล่น</th><th class="num">ตอบถูก</th><th class="num">คะแนน</th></tr></thead>
            <tbody>${s.players.map((p) => `<tr>
              <td><b>${p.rank}</b></td>
              <td><div class="who">${avatarHtml(p.avatar, 'sm')}${esc(p.name)}</div></td>
              <td class="num">${p.correctCount}/${s.history.length}</td>
              <td class="num"><b>${fmt(p.score)}</b></td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="card">
          <h3>สรุปรายคำถาม</h3>
          <table class="table">
            <thead><tr><th>ข้อ</th><th>คำถาม</th><th>ตอบถูก</th><th class="num">เวลาเฉลี่ย</th></tr></thead>
            <tbody>${s.history.map((h, i) => {
              if (!h) return '';
              const pct = h.players ? Math.round((h.correct / h.players) * 100) : 0;
              return `<tr><td>${i + 1}</td><td>${esc(h.text)}</td>
                <td><div class="small">${h.correct}/${h.players} (${pct}%)</div><div class="acc-bar"><div style="width:${pct}%"></div></div></td>
                <td class="num">${h.avgTime} วิ</td></tr>`;
            }).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>`, key);

  $('#csvBtn').onclick = () => downloadCsv(s);
  $('#closeBtn').onclick = () => {
    if (!confirm('ปิดห้องนี้? ผู้เล่นทุกคนจะถูกตัดการเชื่อมต่อ')) return;
    socket.emit('host:close', {}, () => {
      localStorage.removeItem('kq_host_' + pin);
      location.href = '/admin';
    });
  };
}

function downloadCsv(s) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['อันดับ', 'ชื่อ', 'คะแนน', 'ตอบถูก', 'จำนวนข้อ']];
  s.players.forEach((p) => rows.push([p.rank, p.name, p.score, p.correctCount, s.history.length]));
  rows.push([]);
  rows.push(['ข้อ', 'คำถาม', 'ตอบถูก', 'ตอบทั้งหมด', 'ผู้เล่น', 'เวลาเฉลี่ย (วิ)']);
  s.history.forEach((h, i) => h && rows.push([i + 1, h.text, h.correct, h.answered, h.players, h.avgTime]));
  const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `quizblitz-${s.pin}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
