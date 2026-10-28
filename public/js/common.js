/* ฟังก์ชันที่ใช้ร่วมกันทุกหน้า */
const KQ = window.KQ_AVATARS;

const CHOICES = [
  { color: 'var(--c0)', shape: '▲' },
  { color: 'var(--c1)', shape: '◆' },
  { color: 'var(--c2)', shape: '●' },
  { color: 'var(--c3)', shape: '■' },
];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function avatarHtml(av, size = 'md') {
  const emoji = KQ.AVATARS[av && av.a] ?? '❓';
  const color = KQ.COLORS[av && av.c] ?? '#ccc';
  return `<span class="avatar avatar-${size}" style="--av:${color}">${emoji}</span>`;
}

function randomAvatar() {
  return {
    a: Math.floor(Math.random() * KQ.AVATARS.length),
    c: Math.floor(Math.random() * KQ.COLORS.length),
  };
}

const fmt = (n) => Number(n || 0).toLocaleString('th-TH');

function toast(msg, type = 'info') {
  let box = $('#toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    document.body.appendChild(box);
  }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.classList.add('hide'), 3200);
  setTimeout(() => t.remove(), 3700);
}

/** นับถอยหลัง: เรียก onTick(msที่เหลือ, สัดส่วนที่เหลือ 0–1) ทุก 100ms */
function countdown(remainingMs, totalMs, onTick, onDone) {
  const end = Date.now() + remainingMs;
  let id;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    onTick(left, totalMs ? left / totalMs : 0);
    if (left <= 0) {
      clearInterval(id);
      onDone && onDone();
    }
  };
  id = setInterval(tick, 100);
  tick();
  return () => clearInterval(id);
}
