'use strict';
/**
 * ที่เก็บแบบทดสอบ
 * - ถ้ามี DATABASE_URL → เก็บใน PostgreSQL (แนะนำเมื่อขึ้นออนไลน์ เพราะดิสก์ของโฮสต์ฟรีมักถูกล้างตอนรีสตาร์ต)
 * - ถ้าไม่มี → เก็บเป็นไฟล์ JSON ในโฟลเดอร์ data/ (เหมาะกับการรันบนเครื่องตัวเอง)
 * ครั้งแรกที่ยังไม่มีข้อมูล จะใส่แบบทดสอบตัวอย่างจาก data/sample-quizzes.json ให้
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_FILE = path.join(__dirname, 'data', 'sample-quizzes.json');
const loadSamples = () => {
  try {
    return JSON.parse(fs.readFileSync(SAMPLE_FILE, 'utf8'));
  } catch {
    return [];
  }
};

async function createPgStore(url, PoolImpl) {
  const Pool = PoolImpl || require('pg').Pool;
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.PGSSLMODE === 'disable';
  const pool = new Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, max: 5 });
  await pool.query(`CREATE TABLE IF NOT EXISTS quizzes (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const { rows } = await pool.query('SELECT data FROM quizzes');
  let all = rows.map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
  const store = {
    kind: 'postgres',
    all: () => all,
    async upsert(q) {
      await pool.query(
        `INSERT INTO quizzes (id, data, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [q.id, JSON.stringify(q)]
      );
    },
    async remove(id) {
      await pool.query('DELETE FROM quizzes WHERE id = $1', [id]);
    },
  };
  if (!all.length) {
    all = loadSamples();
    for (const q of all) await store.upsert(q);
  }
  return store;
}

function createFileStore(dir) {
  const file = path.join(dir, 'quizzes.json');
  let all;
  try {
    all = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(all)) all = [];
  } catch {
    all = loadSamples();
  }
  const flush = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(all, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  return {
    kind: 'file',
    all: () => all.map((q) => ({ ...q })),
    async upsert(q) {
      const i = all.findIndex((x) => x.id === q.id);
      if (i >= 0) all[i] = q;
      else all.push(q);
      flush();
    },
    async remove(id) {
      all = all.filter((x) => x.id !== id);
      flush();
    },
  };
}

async function createStore() {
  if (process.env.DATABASE_URL) return createPgStore(process.env.DATABASE_URL);
  return createFileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { createStore, createPgStore, createFileStore };
