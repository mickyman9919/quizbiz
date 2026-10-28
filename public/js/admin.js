/* หน้าจัดการแบบทดสอบ */
const app = $('#app');
let pw = localStorage.getItem('kq_admin_pw') || '';
let config = { adminRequired: false };
let draft = null; // แบบทดสอบที่กำลังแก้ไข (null = อยู่หน้ารายการ)
let dirty = false;

const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
const POINTS = [['standard', 'มาตรฐาน (1,000)'], ['double', 'สองเท่า (2,000)'], ['none', 'ไม่คิดคะแนน']];

async function api(method, url, body) {
  const r = await fetch('/api/admin' + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) {
    showLogin(pw ? 'รหัสผ่านไม่ถูกต้อง' : '');
    throw new Error('unauthorized');
  }
  if (!r.ok) {
    const err = new Error(data.error || 'เกิดข้อผิดพลาด');
    err.errors = data.errors;
    throw err;
  }
  return data;
}

function shell(inner) {
  return `<header class="admin-top">
      <a class="logo-sm" href="/admin">Quiz<span>Blitz</span> <small>Admin</small></a>
      <nav>${config.adminRequired ? '<button class="btn btn-ghost-light btn-sm" data-act="logout">ออกจากระบบ</button>' : ''}</nav>
    </header>
    <main class="container">${inner}</main>`;
}

/* ---------- เข้าสู่ระบบ ---------- */
function showLogin(error = '') {
  draft = null;
  document.body.classList.remove('admin-body');
  app.innerHTML = `<div class="center-screen"><div class="card join-card">
    <div class="logo">Quiz<span>Blitz</span></div>
    <form id="loginForm">
      <input type="password" id="pwInput" class="big-input" placeholder="รหัสผ่านผู้ดูแล" autocomplete="current-password">
      ${error ? `<div class="form-error">${esc(error)}</div>` : ''}
      <button class="btn btn-primary btn-block btn-lg">เข้าสู่ระบบ</button>
    </form></div></div>`;
  $('#pwInput').focus();
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    pw = $('#pwInput').value;
    try {
      await api('POST', '/login');
      localStorage.setItem('kq_admin_pw', pw);
      showList();
    } catch (err) {
      if (err.message !== 'unauthorized') showLogin(err.message);
    }
  };
}

/* ---------- รายการแบบทดสอบ ---------- */
async function showList() {
  draft = null;
  dirty = false;
  document.body.classList.add('admin-body');
  let list;
  try {
    list = await api('GET', '/quizzes');
  } catch (e) {
    if (e.message !== 'unauthorized') app.innerHTML = shell(`<div class="form-error">${esc(e.message)}</div>`);
    return;
  }
  app.innerHTML = shell(`
    <div class="page-head">
      <h1>แบบทดสอบของฉัน</h1>
      <div class="actions">
        <label class="btn btn-ghost">📥 นำเข้า JSON<input type="file" id="importFile" accept=".json,application/json" hidden></label>
        <button class="btn btn-primary" data-act="new">＋ สร้างแบบทดสอบ</button>
      </div>
    </div>
    ${list.length ? `<div class="quiz-grid">${list.map(quizCard).join('')}</div>` : `
      <div class="card empty"><div class="big-icon">📝</div>
        <h2>ยังไม่มีแบบทดสอบ</h2><p class="muted">เริ่มสร้างแบบทดสอบแรกของคุณได้เลย</p>
        <button class="btn btn-primary btn-lg" data-act="new">＋ สร้างแบบทดสอบ</button></div>`}
  `);
  $('#importFile').onchange = importFile;
}

function quizCard(q) {
  const date = q.updatedAt ? new Date(q.updatedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  return `<div class="card quiz-card">
    <div class="qc-body">
      <h3>${esc(q.title)}</h3>
      ${q.description ? `<p class="muted">${esc(q.description)}</p>` : ''}
      <div class="qc-meta">${q.questionCount} คำถาม · แก้ไขล่าสุด ${date}</div>
    </div>
    <div class="qc-actions">
      <button class="btn btn-primary" data-act="play" data-id="${q.id}">▶ เริ่มเกม</button>
      <button class="btn btn-ghost" data-act="edit" data-id="${q.id}">✏️ แก้ไข</button>
      <button class="btn btn-ghost" data-act="dup" data-id="${q.id}" title="ทำสำเนา">⧉</button>
      <button class="btn btn-ghost" data-act="export" data-id="${q.id}" title="ส่งออก JSON">⬇</button>
      <button class="btn btn-ghost danger" data-act="del" data-id="${q.id}" title="ลบ">🗑</button>
    </div>
  </div>`;
}

async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : [data];
    let ok = 0;
    for (const item of items) {
      await api('POST', '/quizzes', { title: item.title, description: item.description, questions: item.questions });
      ok++;
    }
    toast(`นำเข้าแล้ว ${ok} แบบทดสอบ`, 'success');
    showList();
  } catch (err) {
    if (err.message !== 'unauthorized') toast('นำเข้าไม่สำเร็จ: ' + err.message, 'error');
  }
}

/* ---------- ตัวแก้ไขแบบทดสอบ ---------- */
const newQuestion = (tf) =>
  tf
    ? { text: '', image: '', choices: ['ถูก', 'ผิด'], correct: [], time: 10, points: 'standard' }
    : { text: '', image: '', choices: ['', '', '', ''], correct: [], time: 20, points: 'standard' };

async function openEditor(id) {
  if (id) {
    try {
      draft = JSON.parse(JSON.stringify(await api('GET', '/quizzes/' + id)));
    } catch (e) {
      if (e.message !== 'unauthorized') toast(e.message, 'error');
      return;
    }
  } else {
    draft = { title: '', description: '', questions: [newQuestion()] };
  }
  dirty = false;
  renderEditor();
  window.scrollTo(0, 0);
}

function renderEditor() {
  const y = window.scrollY;
  app.innerHTML = shell(`
    <div class="editor-head">
      <button class="btn btn-ghost" data-act="back">← กลับ</button>
      <div class="grow"></div>
      <span class="muted small">${draft.questions.length} คำถาม</span>
      <button class="btn btn-ghost" data-act="saveplay">บันทึกและเริ่มเกม ▶</button>
      <button class="btn btn-primary" data-act="save">💾 บันทึก</button>
    </div>
    <div id="errors"></div>
    <div class="card editor-meta">
      <label>ชื่อแบบทดสอบ
        <input class="input" data-f="title" value="${esc(draft.title)}" maxlength="120" placeholder="เช่น ควิซความรู้รอบตัว"></label>
      <label>คำอธิบาย (ไม่บังคับ)
        <input class="input" data-f="description" value="${esc(draft.description || '')}" maxlength="500" placeholder="อธิบายสั้น ๆ"></label>
    </div>
    ${draft.questions.map(questionCard).join('')}
    <div class="add-row">
      <button class="btn btn-primary" data-act="addq">＋ เพิ่มคำถาม</button>
      <button class="btn btn-ghost" data-act="addtf">＋ คำถาม ถูก/ผิด</button>
    </div>`);
  window.scrollTo(0, y);
}

function questionCard(q, i) {
  const n = draft.questions.length;
  const times = TIMES.includes(+q.time) ? TIMES : [...TIMES, +q.time].sort((a, b) => a - b);
  return `<div class="card q-card" id="q${i}">
    <div class="q-head">
      <span class="q-num">คำถามที่ ${i + 1}</span>
      <div class="q-tools">
        <button class="icon-btn" data-act="upq" data-q="${i}" ${i === 0 ? 'disabled' : ''} title="เลื่อนขึ้น">↑</button>
        <button class="icon-btn" data-act="downq" data-q="${i}" ${i === n - 1 ? 'disabled' : ''} title="เลื่อนลง">↓</button>
        <button class="icon-btn" data-act="dupq" data-q="${i}" title="ทำสำเนาคำถาม">⧉</button>
        <button class="icon-btn" data-act="delq" data-q="${i}" ${n === 1 ? 'disabled' : ''} title="ลบคำถาม">🗑</button>
      </div>
    </div>
    <textarea class="input q-input" data-q="${i}" data-f="text" rows="2" maxlength="300" placeholder="พิมพ์คำถาม...">${esc(q.text)}</textarea>
    <div class="q-meta">
      <label>⏱ เวลาตอบ
        <select class="input" data-q="${i}" data-f="time">${times.map((t) => `<option value="${t}"${t === +q.time ? ' selected' : ''}>${t} วินาที</option>`).join('')}</select></label>
      <label>⭐ คะแนน
        <select class="input" data-q="${i}" data-f="points">${POINTS.map(([v, l]) => `<option value="${v}"${v === q.points ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="grow">🖼 ลิงก์รูปภาพ (ไม่บังคับ)
        <input class="input" data-q="${i}" data-f="image" value="${esc(q.image || '')}" placeholder="https://..."></label>
    </div>
    <div class="choice-edit-grid">${q.choices.map((c, j) => `
      <div class="choice-edit${q.correct.includes(j) ? ' is-correct' : ''}" style="--cc:${CHOICES[j].color}">
        <span class="shape">${CHOICES[j].shape}</span>
        <input class="cinput" data-q="${i}" data-c="${j}" value="${esc(c)}" maxlength="120" placeholder="ตัวเลือกที่ ${j + 1}">
        <label class="correct-toggle" title="ทำเครื่องหมายว่าเป็นคำตอบที่ถูก">
          <input type="checkbox" data-q="${i}" data-correct="${j}"${q.correct.includes(j) ? ' checked' : ''}><span>✓</span></label>
        ${q.choices.length > 2 ? `<button class="icon-btn light" data-act="delc" data-q="${i}" data-c="${j}" title="ลบตัวเลือก">×</button>` : ''}
      </div>`).join('')}
    </div>
    ${q.choices.length < 4 ? `<button class="btn btn-ghost btn-sm" data-act="addc" data-q="${i}">＋ เพิ่มตัวเลือก</button>` : ''}
    <div class="hint">กด ✓ ที่ตัวเลือกที่ถูก (เลือกได้มากกว่า 1 ข้อ) · ตัวเลือกที่เว้นว่างจะถูกตัดออกตอนบันทึก</div>
  </div>`;
}

async function save(andPlay) {
  // เปิดแท็บรอไว้ก่อนเพื่อไม่ให้โดนบล็อกป๊อปอัป
  const win = andPlay ? window.open('about:blank', '_blank') : null;
  try {
    const body = { title: draft.title, description: draft.description, questions: draft.questions };
    const saved = draft.id ? await api('PUT', '/quizzes/' + draft.id, body) : await api('POST', '/quizzes', body);
    draft = JSON.parse(JSON.stringify(saved));
    dirty = false;
    toast('บันทึกแล้ว', 'success');
    renderEditor();
    if (win) win.location.href = '/host?quiz=' + saved.id;
  } catch (err) {
    if (win) win.close();
    if (err.message === 'unauthorized') return;
    const list = err.errors || [err.message];
    $('#errors').innerHTML = `<div class="form-error error-box"><b>ยังบันทึกไม่ได้:</b><ul>${list.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ---------- จัดการเหตุการณ์ (event delegation) ---------- */
app.addEventListener('input', (e) => {
  const t = e.target;
  if (!draft || t.type === 'checkbox') return;
  if (t.dataset.q === undefined) {
    if (t.dataset.f) { draft[t.dataset.f] = t.value; dirty = true; }
    return;
  }
  const q = draft.questions[+t.dataset.q];
  if (t.dataset.c !== undefined) q.choices[+t.dataset.c] = t.value;
  else if (t.dataset.f) q[t.dataset.f] = t.dataset.f === 'time' ? +t.value : t.value;
  dirty = true;
});

app.addEventListener('change', (e) => {
  const t = e.target;
  if (!draft || t.type !== 'checkbox' || t.dataset.correct === undefined) return;
  const q = draft.questions[+t.dataset.q];
  const j = +t.dataset.correct;
  q.correct = t.checked ? [...new Set([...q.correct, j])].sort() : q.correct.filter((x) => x !== j);
  t.closest('.choice-edit').classList.toggle('is-correct', t.checked);
  dirty = true;
});

app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const id = b.dataset.id;
  const i = b.dataset.q !== undefined ? +b.dataset.q : null;
  const qs = draft && draft.questions;

  switch (b.dataset.act) {
    case 'logout':
      localStorage.removeItem('kq_admin_pw');
      pw = '';
      return showLogin();
    case 'new':
      return openEditor(null);
    case 'edit':
      return openEditor(id);
    case 'play':
      return window.open('/host?quiz=' + id, '_blank');
    case 'dup':
      try {
        const q = await api('GET', '/quizzes/' + id);
        await api('POST', '/quizzes', { ...q, title: q.title + ' (สำเนา)' });
        toast('ทำสำเนาแล้ว', 'success');
        showList();
      } catch (err) { if (err.message !== 'unauthorized') toast(err.message, 'error'); }
      return;
    case 'export':
      try {
        const q = await api('GET', '/quizzes/' + id);
        const out = { title: q.title, description: q.description, questions: q.questions };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
        a.download = (q.title || 'quiz').replace(/[\\/:*?"<>|]/g, '_') + '.json';
        a.click();
      } catch (err) { if (err.message !== 'unauthorized') toast(err.message, 'error'); }
      return;
    case 'del':
      if (!confirm('ลบแบบทดสอบนี้? ไม่สามารถกู้คืนได้')) return;
      try {
        await api('DELETE', '/quizzes/' + id);
        toast('ลบแล้ว');
        showList();
      } catch (err) { if (err.message !== 'unauthorized') toast(err.message, 'error'); }
      return;

    // ----- ตัวแก้ไข -----
    case 'back':
      if (dirty && !confirm('มีการแก้ไขที่ยังไม่ได้บันทึก ออกจากหน้านี้?')) return;
      return showList();
    case 'save':
      return save(false);
    case 'saveplay':
      return save(true);
    case 'addq':
    case 'addtf':
      qs.push(newQuestion(b.dataset.act === 'addtf'));
      break;
    case 'delq':
      if (!confirm(`ลบคำถามที่ ${i + 1}?`)) return;
      qs.splice(i, 1);
      break;
    case 'dupq':
      qs.splice(i + 1, 0, JSON.parse(JSON.stringify(qs[i])));
      break;
    case 'upq':
      [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]];
      break;
    case 'downq':
      [qs[i + 1], qs[i]] = [qs[i], qs[i + 1]];
      break;
    case 'addc':
      qs[i].choices.push('');
      break;
    case 'delc': {
      const j = +b.dataset.c;
      const q = qs[i];
      q.choices.splice(j, 1);
      q.correct = q.correct.filter((x) => x !== j).map((x) => (x > j ? x - 1 : x));
      break;
    }
    default:
      return;
  }
  dirty = true;
  renderEditor();
  if (b.dataset.act === 'addq' || b.dataset.act === 'addtf') {
    const last = $(`#q${qs.length - 1}`);
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('textarea', last).focus({ preventScroll: true });
  }
});

window.addEventListener('beforeunload', (e) => {
  if (draft && dirty) e.preventDefault();
});

/* ---------- เริ่มต้น ---------- */
(async () => {
  config = await fetch('/api/config').then((r) => r.json()).catch(() => config);
  if (config.adminRequired && !pw) showLogin();
  else showList();
})();
