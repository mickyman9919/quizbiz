'use strict';
/**
 * QuizBlitz — เกมควิซแบบเรียลไทม์ (คล้าย Kahoot)
 * Express (หน้าเว็บ + REST API สำหรับจัดการควิซ) + Socket.IO (ห้องเกมแบบเรียลไทม์)
 */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { AVATARS, COLORS } = require('./public/js/avatars.js');

const { createStore } = require('./storage');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
// Render ใส่ RENDER_EXTERNAL_URL ให้อัตโนมัติ
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 300;
const READY_MS = 3000; // หน้า "เตรียมตัว" ก่อนเปิดให้ตอบ
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // ห้องที่ไม่มีความเคลื่อนไหว 6 ชม. จะถูกลบ

/* ------------------------------------------------------------------ */
/* ที่เก็บแบบทดสอบ (ไฟล์ JSON หรือ PostgreSQL — ดู storage.js)              */
/* ------------------------------------------------------------------ */
let store;
let quizzes = []; // สำเนาในหน่วยความจำ อัปเดตพร้อมกับ store

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** ตรวจและจัดรูปข้อมูลแบบทดสอบที่ส่งมาจากหน้าแอดมิน */
function normalizeQuiz(input) {
  input = input || {};
  const errors = [];
  const title = str(input.title, 120);
  if (!title) errors.push('กรุณาใส่ชื่อแบบทดสอบ');
  const rawQs = Array.isArray(input.questions) ? input.questions.slice(0, 200) : [];
  if (!rawQs.length) errors.push('ต้องมีอย่างน้อย 1 คำถาม');

  const questions = rawQs.map((q, i) => {
    q = q || {};
    const n = i + 1;
    const text = str(q.text, 300);
    const rawCorrect = new Set((Array.isArray(q.correct) ? q.correct : []).map(Number));
    const choices = [];
    const correct = [];
    (Array.isArray(q.choices) ? q.choices.slice(0, 4) : []).forEach((c, idx) => {
      const t = str(c, 120);
      if (!t) return; // ตัดตัวเลือกที่เว้นว่าง
      if (rawCorrect.has(idx)) correct.push(choices.length);
      choices.push(t);
    });
    if (!text) errors.push(`คำถามที่ ${n}: ยังไม่ได้พิมพ์คำถาม`);
    if (choices.length < 2) errors.push(`คำถามที่ ${n}: ต้องมีตัวเลือกอย่างน้อย 2 ข้อ`);
    if (!correct.length) errors.push(`คำถามที่ ${n}: ต้องเลือกคำตอบที่ถูกอย่างน้อย 1 ข้อ`);
    const image = str(q.image, 1000);
    return {
      text,
      image: /^https?:\/\//i.test(image) ? image : '',
      choices,
      correct,
      time: clamp(parseInt(q.time, 10) || 20, 5, 240),
      points: ['standard', 'double', 'none'].includes(q.points) ? q.points : 'standard',
    };
  });
  return { errors, quiz: { title, description: str(input.description, 500), questions } };
}

/* ------------------------------------------------------------------ */
/* HTTP: หน้าเว็บ + REST API                                            */
/* ------------------------------------------------------------------ */
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

function checkAdmin(pw) {
  if (!ADMIN_PASSWORD) return true;
  const a = Buffer.from(String(pw || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// กันการเดารหัสผ่าน: ผิดเกิน 10 ครั้งใน 15 นาที ต่อ IP จะถูกพักไว้
const failedLogins = new Map();
function tooManyFails(ip) {
  const f = failedLogins.get(ip);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000;
}
function recordFail(ip) {
  const f = failedLogins.get(ip);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failedLogins.set(ip, { count: 1, first: Date.now() });
  else f.count++;
}

app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, storage: store ? store.kind : null }));
app.get('/api/config', (req, res) => res.json({ adminRequired: !!ADMIN_PASSWORD }));

const admin = express.Router();
admin.use((req, res, next) => {
  if (tooManyFails(req.ip)) return res.status(429).json({ error: 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาที' });
  if (checkAdmin(req.get('x-admin-password'))) return next();
  recordFail(req.ip);
  res.status(401).json({ error: 'รหัสผ่านผู้ดูแลไม่ถูกต้อง' });
});
// ห่อ handler แบบ async ให้ส่ง error กลับเป็น JSON
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'บันทึกข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง' });
  });
admin.post('/login', (req, res) => res.json({ ok: true }));
admin.get('/quizzes', (req, res) => {
  res.json(
    quizzes
      .map((q) => ({
        id: q.id,
        title: q.title,
        description: q.description,
        questionCount: q.questions.length,
        updatedAt: q.updatedAt,
      }))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  );
});
admin.get('/quizzes/:id', (req, res) => {
  const q = quizzes.find((x) => x.id === req.params.id);
  q ? res.json(q) : res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
});
admin.post('/quizzes', wrap(async (req, res) => {
  const { errors, quiz } = normalizeQuiz(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('\n'), errors });
  const now = new Date().toISOString();
  const full = { id: crypto.randomBytes(5).toString('hex'), ...quiz, createdAt: now, updatedAt: now };
  await store.upsert(full);
  quizzes.push(full);
  res.status(201).json(full);
}));
admin.put('/quizzes/:id', wrap(async (req, res) => {
  const idx = quizzes.findIndex((x) => x.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
  const { errors, quiz } = normalizeQuiz(req.body);
  if (errors.length) return res.status(400).json({ error: errors.join('\n'), errors });
  const updated = { ...quizzes[idx], ...quiz, updatedAt: new Date().toISOString() };
  await store.upsert(updated);
  quizzes[idx] = updated;
  res.json(updated);
}));
admin.delete('/quizzes/:id', wrap(async (req, res) => {
  if (!quizzes.some((x) => x.id === req.params.id)) return res.status(404).json({ error: 'ไม่พบแบบทดสอบ' });
  await store.remove(req.params.id);
  quizzes = quizzes.filter((x) => x.id !== req.params.id);
  res.json({ ok: true });
}));
app.use('/api/admin', admin);

/* ------------------------------------------------------------------ */
/* ห้องเกม                                                              */
/* ------------------------------------------------------------------ */
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 8000 });
const rooms = new Map();

function genPin() {
  let pin;
  do pin = String(crypto.randomInt(100000, 1000000));
  while (rooms.has(pin));
  return pin;
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

/** URL ที่ผู้เล่นใช้เข้าห้อง — ถ้าโฮสต์เปิดผ่าน localhost จะแทนด้วย IP ในวง LAN ให้มือถือสแกนได้ */
function baseUrl(socket) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const h = socket.handshake.headers;
  const host = String(h['x-forwarded-host'] || h.host || `localhost:${PORT}`).split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const m = host.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
  const hostname = m ? m[1] : host;
  const port = m && m[2];
  if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
    const ip = lanAddress();
    if (ip) return `${proto}://${ip}${port ? ':' + port : ''}`;
  }
  return `${proto}://${host}`;
}

const currentQuestion = (room) => room.quiz.questions[room.qIndex];

/** เรียงผู้เล่นตามคะแนน และกำหนดอันดับ (คะแนนเท่ากันได้อันดับเดียวกัน) */
function rankPlayers(room) {
  const list = [...room.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  let rank = 0;
  let prev = null;
  list.forEach((p, i) => {
    if (p.score !== prev) {
      rank = i + 1;
      prev = p.score;
    }
    p.rank = rank;
  });
  return list;
}

const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  score: p.score,
  rank: p.rank,
  prevRank: p.prevRank,
  lastPoints: p.lastPoints,
  lastCorrect: p.lastCorrect,
  streak: p.streak,
  correctCount: p.correctCount,
  connected: p.connected,
  joinedAt: p.joinedAt,
});

function hostView(room) {
  const q = currentQuestion(room);
  const ranked = rankPlayers(room);
  const v = {
    pin: room.pin,
    joinUrl: room.joinUrl,
    qr: room.qr,
    quizTitle: room.quiz.title,
    phase: room.phase,
    locked: room.locked,
    qIndex: room.qIndex,
    total: room.quiz.questions.length,
    playerCount: room.players.size,
    players: ranked.map(publicPlayer),
  };
  if (q && ['ready', 'question', 'reveal'].includes(room.phase)) {
    v.question = {
      text: q.text,
      image: q.image,
      choices: q.choices,
      time: q.time,
      points: q.points,
      correct: room.phase === 'reveal' ? q.correct : null,
    };
  }
  if (room.phase === 'question') {
    v.remaining = Math.max(0, room.qEndAt - Date.now());
    v.answeredCount = room.answers.size;
  }
  if (room.phase === 'reveal') v.stats = room.history[room.qIndex];
  if (room.phase === 'ended') v.history = room.history;
  return v;
}

function playerView(room, p) {
  const q = currentQuestion(room);
  const v = {
    phase: room.phase,
    quizTitle: room.quiz.title,
    qIndex: room.qIndex,
    total: room.quiz.questions.length,
    playerCount: room.players.size,
    me: { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: p.rank },
  };
  switch (room.phase) {
    case 'ready':
      v.text = q.text;
      break;
    case 'question': {
      const a = room.answers.get(p.id);
      v.question = { text: q.text, choices: q.choices, time: q.time };
      v.remaining = Math.max(0, room.qEndAt - Date.now());
      v.answer = a ? a.choice : null;
      break;
    }
    case 'reveal': {
      const a = room.answers.get(p.id);
      v.result = {
        answered: !!a,
        choice: a ? a.choice : null,
        correct: !!(a && a.correct),
        points: a ? a.points : 0,
        streak: p.streak,
        correctChoices: q.correct,
        choices: q.choices,
      };
      break;
    }
    case 'leaderboard':
    case 'ended': {
      const ranked = rankPlayers(room);
      const idx = ranked.indexOf(p);
      const ahead = idx > 0 ? ranked[idx - 1] : null;
      v.ahead = ahead && ahead.score > p.score ? { name: ahead.name, gap: ahead.score - p.score } : null;
      v.correctCount = p.correctCount;
      if (room.phase === 'ended')
        v.podium = ranked.slice(0, 3).map((x) => ({ name: x.name, avatar: x.avatar, score: x.score, rank: x.rank }));
      break;
    }
  }
  return v;
}

function emitHost(room) {
  if (room.hostSocketId) io.to(room.hostSocketId).emit('host:state', hostView(room));
}
function emitPlayer(room, p) {
  if (p.socketId) io.to(p.socketId).emit('player:state', playerView(room, p));
}
function broadcast(room) {
  room.lastActivity = Date.now();
  emitHost(room); // hostView คำนวณอันดับให้แล้ว
  for (const p of room.players.values()) emitPlayer(room, p);
}

/* ---------- ลำดับเกม: lobby → ready → question → reveal → leaderboard → ... → ended ---------- */
function goReady(room, idx) {
  clearTimeout(room.timer);
  rankPlayers(room).forEach((p) => (p.prevRank = p.rank));
  room.qIndex = idx;
  room.phase = 'ready';
  room.answers = new Map();
  room.timer = setTimeout(() => startQuestion(room), READY_MS);
  broadcast(room);
}

function startQuestion(room) {
  clearTimeout(room.timer);
  const q = currentQuestion(room);
  room.phase = 'question';
  room.qStartAt = Date.now();
  room.qEndAt = room.qStartAt + q.time * 1000;
  room.timer = setTimeout(() => reveal(room), q.time * 1000 + 300);
  broadcast(room);
}

function reveal(room) {
  if (room.phase !== 'question') return;
  clearTimeout(room.timer);
  const q = currentQuestion(room);
  room.phase = 'reveal';
  const distribution = q.choices.map(() => 0);
  let correct = 0;
  let totalTime = 0;
  for (const a of room.answers.values()) {
    distribution[a.choice]++;
    if (a.correct) correct++;
    totalTime += a.elapsed;
  }
  for (const p of room.players.values()) {
    if (!room.answers.has(p.id)) {
      p.streak = 0;
      p.lastPoints = 0;
      p.lastCorrect = false;
    }
  }
  const answered = room.answers.size;
  room.history[room.qIndex] = {
    text: q.text,
    choices: q.choices,
    correctChoices: q.correct,
    distribution,
    answered,
    correct,
    players: room.players.size,
    avgTime: answered ? Math.round(totalTime / answered / 100) / 10 : 0,
  };
  broadcast(room);
}

function endGame(room) {
  clearTimeout(room.timer);
  room.phase = 'ended';
  broadcast(room);
}

function handleNext(room) {
  switch (room.phase) {
    case 'lobby':
      if (!room.players.size) return 'ยังไม่มีผู้เล่นในห้อง';
      goReady(room, 0);
      break;
    case 'ready':
      startQuestion(room);
      break;
    case 'question':
      reveal(room);
      break;
    case 'reveal':
      room.phase = 'leaderboard';
      broadcast(room);
      break;
    case 'leaderboard':
      if (room.qIndex + 1 < room.quiz.questions.length) goReady(room, room.qIndex + 1);
      else endGame(room);
      break;
  }
  return null;
}

/** ปิดคำถามทันทีเมื่อผู้เล่นที่ออนไลน์ตอบครบทุกคน */
function checkAllAnswered(room) {
  if (room.phase !== 'question') return;
  const active = [...room.players.values()].filter((p) => p.connected);
  if (active.length && active.every((p) => room.answers.has(p.id))) reveal(room);
}

/**
 * คิดคะแนนแบบ Kahoot: ตอบถูกได้ 50–100% ของคะแนนเต็มตามความเร็ว
 * + โบนัสตอบถูกติดกัน 100 ต่อข้อ (สูงสุด 500)
 */
function handleAnswer(room, p, choice) {
  if (room.phase !== 'question' || room.answers.has(p.id)) return;
  const q = currentQuestion(room);
  const now = Date.now();
  if (now > room.qEndAt + 500) return;
  choice = Number(choice);
  if (!Number.isInteger(choice) || choice < 0 || choice >= q.choices.length) return;

  const limit = q.time * 1000;
  const elapsed = clamp(now - room.qStartAt, 0, limit);
  const correct = q.correct.includes(choice);
  const base = q.points === 'double' ? 2000 : q.points === 'none' ? 0 : 1000;
  let points = 0;
  if (correct) {
    p.streak++;
    p.correctCount++;
    if (base) points = Math.round(base * (1 - elapsed / limit / 2)) + Math.min((p.streak - 1) * 100, 500);
  } else {
    p.streak = 0;
  }
  p.score += points;
  p.lastPoints = points;
  p.lastCorrect = correct;
  room.answers.set(p.id, { choice, elapsed, correct, points });
  room.lastActivity = now;
  emitPlayer(room, p);
  emitHost(room);
  checkAllAnswered(room);
}

function removePlayer(room, playerId, event) {
  const p = room.players.get(playerId);
  if (!p) return;
  room.players.delete(playerId);
  room.answers.delete(playerId);
  if (event && p.socketId) io.to(p.socketId).emit(event);
  if (room.phase === 'lobby') broadcast(room);
  else emitHost(room);
  checkAllAnswered(room);
}

function closeRoom(room) {
  clearTimeout(room.timer);
  for (const p of room.players.values()) if (p.socketId) io.to(p.socketId).emit('room:closed');
  rooms.delete(room.pin);
}

/* ------------------------------------------------------------------ */
/* Socket.IO                                                            */
/* ------------------------------------------------------------------ */
io.on('connection', (socket) => {
  const on = (event, handler) =>
    socket.on(event, async (data, cb) => {
      if (typeof cb !== 'function') cb = () => {};
      try {
        await handler(data || {}, cb);
      } catch (err) {
        console.error(event, err);
        cb({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' });
      }
    });
  const hostRoom = () => {
    const r = rooms.get(socket.data.pin);
    return r && socket.data.role === 'host' && r.hostSocketId === socket.id ? r : null;
  };

  /* ---------- โฮสต์ ---------- */
  on('host:create', async ({ quizId, adminPassword }, cb) => {
    const ip = String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address).split(',')[0].trim();
    if (tooManyFails(ip)) return cb({ error: 'ลองรหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาที' });
    if (!checkAdmin(adminPassword)) {
      recordFail(ip);
      return cb({ error: 'รหัสผ่านผู้ดูแลไม่ถูกต้อง' });
    }
    const quiz = quizzes.find((q) => q.id === quizId);
    if (!quiz) return cb({ error: 'ไม่พบแบบทดสอบนี้' });
    if (!quiz.questions.length) return cb({ error: 'แบบทดสอบนี้ยังไม่มีคำถาม' });
    const pin = genPin();
    const joinUrl = `${baseUrl(socket)}/play?pin=${pin}`;
    const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 520, errorCorrectionLevel: 'M' });
    const room = {
      pin,
      joinUrl,
      qr,
      hostKey: crypto.randomBytes(16).toString('hex'),
      hostSocketId: socket.id,
      quiz: JSON.parse(JSON.stringify(quiz)),
      players: new Map(),
      answers: new Map(),
      history: [],
      phase: 'lobby',
      locked: false,
      qIndex: -1,
      timer: null,
      lastActivity: Date.now(),
    };
    rooms.set(pin, room);
    socket.data = { role: 'host', pin };
    cb({ ok: true, pin, hostKey: room.hostKey });
    broadcast(room);
  });

  on('host:rejoin', ({ pin, hostKey }, cb) => {
    const room = rooms.get(String(pin || ''));
    if (!room || room.hostKey !== hostKey) return cb({ error: 'ไม่พบห้องนี้ หรือห้องถูกปิดไปแล้ว' });
    if (room.hostSocketId && room.hostSocketId !== socket.id) io.to(room.hostSocketId).emit('host:replaced');
    room.hostSocketId = socket.id;
    socket.data = { role: 'host', pin: room.pin };
    cb({ ok: true });
    emitHost(room);
  });

  on('host:next', (_, cb) => {
    const room = hostRoom();
    if (!room) return cb({ error: 'ไม่มีสิทธิ์ควบคุมห้องนี้' });
    const err = handleNext(room);
    cb(err ? { error: err } : { ok: true });
  });

  on('host:lock', ({ locked }, cb) => {
    const room = hostRoom();
    if (!room) return cb({ error: 'ไม่มีสิทธิ์ควบคุมห้องนี้' });
    room.locked = !!locked;
    emitHost(room);
    cb({ ok: true });
  });

  on('host:kick', ({ playerId }, cb) => {
    const room = hostRoom();
    if (!room) return cb({ error: 'ไม่มีสิทธิ์ควบคุมห้องนี้' });
    removePlayer(room, playerId, 'player:kicked');
    cb({ ok: true });
  });

  on('host:end', (_, cb) => {
    const room = hostRoom();
    if (!room) return cb({ error: 'ไม่มีสิทธิ์ควบคุมห้องนี้' });
    endGame(room);
    cb({ ok: true });
  });

  on('host:close', (_, cb) => {
    const room = hostRoom();
    if (!room) return cb({ error: 'ไม่มีสิทธิ์ควบคุมห้องนี้' });
    closeRoom(room);
    cb({ ok: true });
  });

  /* ---------- ผู้เล่น ---------- */
  on('player:check', ({ pin }, cb) => {
    const room = rooms.get(String(pin || '').trim());
    if (!room) return cb({ error: 'ไม่พบห้องนี้ ตรวจสอบ PIN อีกครั้ง', code: 'NO_ROOM' });
    if (room.phase === 'ended') return cb({ error: 'เกมนี้จบไปแล้ว', code: 'ENDED' });
    cb({ ok: true, quizTitle: room.quiz.title, locked: room.locked });
  });

  on('player:join', ({ pin, name, avatar, playerId }, cb) => {
    const room = rooms.get(String(pin || '').trim());
    if (!room) return cb({ error: 'ไม่พบห้องนี้ หรือห้องถูกปิดไปแล้ว', code: 'NO_ROOM' });

    let p = playerId ? room.players.get(String(playerId)) : null;
    if (p) {
      // กลับเข้าห้องเดิม (รีเฟรช / เน็ตหลุด)
      p.socketId = socket.id;
      p.connected = true;
    } else {
      if (playerId && !name) return cb({ error: 'กรุณาเข้าร่วมใหม่', code: 'NO_PLAYER' });
      if (room.phase === 'ended') return cb({ error: 'เกมนี้จบไปแล้ว', code: 'ENDED' });
      if (room.locked) return cb({ error: 'ห้องนี้ถูกล็อก ไม่รับผู้เล่นเพิ่มแล้ว', code: 'LOCKED' });
      if (room.players.size >= MAX_PLAYERS) return cb({ error: 'ห้องเต็มแล้ว', code: 'FULL' });
      const cleanName = str(name, 20).replace(/\s+/g, ' ');
      if (!cleanName) return cb({ error: 'กรุณาใส่ชื่อ' });
      const taken = [...room.players.values()].some((x) => x.name.toLowerCase() === cleanName.toLowerCase());
      if (taken) return cb({ error: 'ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่นนะ' });
      const a = parseInt(avatar && avatar.a, 10);
      const c = parseInt(avatar && avatar.c, 10);
      p = {
        id: crypto.randomUUID(),
        name: cleanName,
        avatar: {
          a: a >= 0 && a < AVATARS.length ? a : crypto.randomInt(AVATARS.length),
          c: c >= 0 && c < COLORS.length ? c : crypto.randomInt(COLORS.length),
        },
        score: 0,
        streak: 0,
        correctCount: 0,
        lastPoints: 0,
        lastCorrect: false,
        rank: 0,
        prevRank: 0,
        joinedAt: Date.now(),
        socketId: socket.id,
        connected: true,
      };
      room.players.set(p.id, p);
    }
    socket.data = { role: 'player', pin: room.pin, playerId: p.id };
    cb({ ok: true, playerId: p.id });
    if (room.phase === 'lobby') broadcast(room);
    else {
      rankPlayers(room);
      emitPlayer(room, p);
      emitHost(room);
    }
  });

  on('player:answer', ({ choice }, cb) => {
    const room = rooms.get(socket.data.pin);
    const p = room && room.players.get(socket.data.playerId);
    if (!p || p.socketId !== socket.id) return cb({ error: 'ไม่ได้อยู่ในห้อง' });
    handleAnswer(room, p, choice);
    cb({ ok: true });
  });

  on('player:leave', (_, cb) => {
    const room = rooms.get(socket.data.pin);
    if (room && socket.data.role === 'player') removePlayer(room, socket.data.playerId);
    socket.data = {};
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.pin);
    if (!room) return;
    if (socket.data.role === 'host' && room.hostSocketId === socket.id) {
      room.hostSocketId = null;
    } else if (socket.data.role === 'player') {
      const p = room.players.get(socket.data.playerId);
      if (p && p.socketId === socket.id) {
        p.connected = false;
        p.socketId = null;
        emitHost(room);
        checkAllAnswered(room);
      }
    }
  });
});

// ลบห้องเก่าที่ไม่มีการใช้งาน
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) if (now - room.lastActivity > ROOM_TTL_MS) closeRoom(room);
}, 10 * 60 * 1000).unref();

createStore()
  .then((s) => {
    store = s;
    quizzes = store.all();
    server.listen(PORT, () => {
      const ip = lanAddress();
      console.log(`\n🎮 QuizBlitz พร้อมใช้งาน (พอร์ต ${PORT}, ที่เก็บข้อมูล: ${store.kind}, ${quizzes.length} แบบทดสอบ)`);
      if (PUBLIC_URL) console.log(`   เว็บไซต์: ${PUBLIC_URL}   ·   หน้าจัดการ: ${PUBLIC_URL}/admin`);
      else {
        console.log(`   หน้าจัดการ (Admin):  http://localhost:${PORT}/admin`);
        if (ip) console.log(`   ผู้เล่นในวง Wi-Fi เดียวกัน: http://${ip}:${PORT}/play`);
      }
      console.log(ADMIN_PASSWORD ? '   🔒 เปิดใช้รหัสผ่านผู้ดูแล' : '   ⚠️  ยังไม่ได้ตั้ง ADMIN_PASSWORD — ใครก็เข้าหน้าจัดการได้');
      console.log('');
    });
  })
  .catch((err) => {
    console.error('เชื่อมต่อที่เก็บข้อมูลไม่สำเร็จ:', err.message);
    process.exit(1);
  });
