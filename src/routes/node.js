// Lokal miya (maktabdagi mini-kompyuter) uchun API (TZ L-1 ... L-7).
// Lokal miya faqat o'zi serverga ulanadi (chiquvchi ulanish), maktab tarmog'iga tashqaridan kirish ochilmaydi (X-1).
import { Router } from 'express';
import { hashToken, takeJobs, recordResult, jobHub } from '../camera.js';

const MAX_WAIT_SEC = 25;

export function nodeRoutes(db) {
  const r = Router();

  const findNode = db.prepare('SELECT * FROM local_nodes WHERE token_hash = ?');
  const touch = db.prepare('UPDATE local_nodes SET last_seen_at = ?, version = COALESCE(?, version) WHERE id = ?');

  r.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const node = token ? findNode.get(hashToken(token)) : null;
    if (!node) return res.status(401).json({ error: 'Lokal miya tokeni noto\'g\'ri' });
    touch.run(new Date().toISOString(), req.headers['x-node-version']?.slice(0, 40) ?? null, node.id);
    req.node = node;
    next();
  });

  const cameraList = (schoolId) =>
    db
      .prepare(
        `SELECT c.id AS camera_id, c.channel, c.subtract_teacher, r.name AS room_name
         FROM cameras c JOIN rooms r ON r.id = c.room_id WHERE c.school_id = ? AND c.is_active = 1 ORDER BY r.name`
      )
      .all(schoolId)
      .map((c) => ({ ...c, subtract_teacher: !!c.subtract_teacher }));

  // Vazifalarni kutish (long polling): vazifa paydo bo'lsa darhol, bo'lmasa ko'pi bilan 25 soniyada javob.
  r.get('/jobs', async (req, res) => {
    const wait = Math.min(Math.max(Number(req.query.wait) || 0, 0), MAX_WAIT_SEC);
    let jobs = takeJobs(db, req.node);
    if (!jobs.length && wait > 0) {
      const event = `school:${req.node.school_id}`;
      await new Promise((resolve) => {
        // res 'close' — mijoz ulanishni uzsa (req 'close' GET uchun darhol ishga tushishi mumkin).
        const done = () => {
          clearTimeout(timer);
          jobHub.off(event, done);
          res.off('close', done);
          resolve();
        };
        const timer = setTimeout(done, wait * 1000);
        jobHub.on(event, done);
        res.on('close', done);
      });
      if (res.destroyed || res.writableEnded) return;
      jobs = takeJobs(db, req.node);
    }
    res.json({ jobs });
  });

  r.post('/sessions/:id/result', (req, res) => {
    const result = recordResult(db, req.node, Number(req.params.id), req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });

  // Holat hisoboti (L-7): qaysi kamera ishlayapti, qaysi biri yo'q. Javobda maktab kameralari ro'yxati.
  r.post('/heartbeat', (req, res) => {
    const update = db.prepare(
      'UPDATE cameras SET status = ?, status_error = ?, status_at = ? WHERE id = ? AND school_id = ?'
    );
    const now = new Date().toISOString();
    for (const c of Array.isArray(req.body?.cameras) ? req.body.cameras : []) {
      update.run(c.ok ? 'ok' : 'error', c.ok ? null : String(c.error || 'Oqim ochilmadi').slice(0, 300), now, Number(c.camera_id), req.node.school_id);
    }
    res.json({ cameras: cameraList(req.node.school_id) });
  });

  r.get('/config', (req, res) => {
    res.json({ cameras: cameraList(req.node.school_id) });
  });

  return r;
}
