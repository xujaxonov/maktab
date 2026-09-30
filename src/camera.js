// 2-bosqich: kamera orqali sanash (TZ 5.3 va 6-bo'lim).
// Markaziy server lokal miyaga "shu xonada sanashni boshla" vazifasini beradi,
// lokal miya faqat sonni qaytaradi. Kadrlar va video maktabdan chiqmaydi.
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { audit } from './db.js';

// Kamera va o'qituvchi soni orasidagi ruxsat etilgan farq (TZ 6-bo'lim, kelishilgan: 2 ta o'quvchi).
export const DIFF_LIMIT = 2;
// Sanash davomiyligi (L-3).
export const COUNT_DURATION_SEC = 60;
// Lokal miya oxirgi so'rovidan keyin shuncha vaqt "aloqada" hisoblanadi.
export const NODE_ONLINE_SEC = 90;
// Shuncha vaqtda natija kelmasa, sessiya "muvaffaqiyatsiz" bo'ladi.
export const SESSION_TIMEOUT_SEC = 300;

// Yangi vazifa paydo bo'lganda kutib turgan lokal miyani uyg'otish uchun.
export const jobHub = new EventEmitter();
jobHub.setMaxListeners(0);

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function newNodeToken() {
  return `sdn_${randomBytes(24).toString('base64url')}`;
}

const agoIso = (sec) => new Date(Date.now() - sec * 1000).toISOString();

export function isNodeOnline(node) {
  return !!node?.last_seen_at && node.last_seen_at > agoIso(NODE_ONLINE_SEC);
}

// Dars boshlanganda chaqiriladi (startLesson tranzaksiyasi ichida).
// Xonada kamera bo'lsa va lokal miya aloqada bo'lsa, sanash navbatga qo'yiladi va "camera" rejimi qaytadi.
// Kamera bor, lekin miya aloqada bo'lmasa, sabab yozib qo'yiladi va dars qo'lda rejimda o'tadi (O-8).
export function requestCount(db, lesson) {
  const camera = db.prepare('SELECT * FROM cameras WHERE room_id = ? AND is_active = 1').get(lesson.room_id);
  if (!camera) return 'manual';

  const node = db.prepare('SELECT * FROM local_nodes WHERE school_id = ?').get(lesson.school_id);
  const now = new Date().toISOString();
  if (!isNodeOnline(node)) {
    db.prepare(
      `INSERT INTO counting_sessions (lesson_id, camera_id, status, requested_at, error)
       VALUES (?, ?, 'failed', ?, 'Lokal miya aloqada emas')`
    ).run(lesson.id, camera.id, now);
    return 'manual';
  }
  db.prepare(
    `INSERT INTO counting_sessions (lesson_id, camera_id, node_id, status, requested_at)
     VALUES (?, ?, ?, 'pending', ?)`
  ).run(lesson.id, camera.id, node.id, now);
  return 'camera';
}

// Tranzaksiya yakunlangandan keyin chaqiriladi: kutib turgan lokal miyani uyg'otadi.
export function notifyJobs(schoolId) {
  jobHub.emit(`school:${schoolId}`);
}

// Natija kelmay qolgan sessiyalarni yopish.
export function expireStale(db) {
  db.prepare(
    `UPDATE counting_sessions SET status = 'failed', error = 'Lokal miya javob bermadi'
     WHERE status IN ('pending', 'running') AND requested_at < ?`
  ).run(agoIso(SESSION_TIMEOUT_SEC));
}

// Lokal miya uchun navbatdagi vazifalar. Berilgan vazifalar "running" bo'ladi.
export function takeJobs(db, node) {
  expireStale(db);
  const jobs = db
    .prepare(
      `SELECT cs.id AS session_id, cs.camera_id, c.channel, c.subtract_teacher, r.name AS room_name
       FROM counting_sessions cs
       JOIN cameras c ON c.id = cs.camera_id
       JOIN rooms r ON r.id = c.room_id
       WHERE cs.node_id = ? AND cs.status = 'pending'
       ORDER BY cs.id LIMIT 20`
    )
    .all(node.id);
  const mark = db.prepare("UPDATE counting_sessions SET status = 'running' WHERE id = ? AND status = 'pending'");
  for (const j of jobs) mark.run(j.session_id);
  return jobs.map((j) => ({ ...j, subtract_teacher: !!j.subtract_teacher, duration_sec: COUNT_DURATION_SEC }));
}

// Lokal miyadan kelgan natija (L-4). Xato bo'lsa, dars qo'lda davom etadi.
export function recordResult(db, node, sessionId, body) {
  const session = db.prepare('SELECT * FROM counting_sessions WHERE id = ? AND node_id = ?').get(sessionId, node.id);
  if (!session) return { status: 404, error: 'Sessiya topilmadi' };
  if (session.status === 'done' || session.status === 'failed') return { status: 200, ignored: true };

  const isTime = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
  if (body?.error) {
    db.prepare("UPDATE counting_sessions SET status = 'failed', error = ? WHERE id = ?").run(String(body.error).slice(0, 300), session.id);
    return { status: 200 };
  }
  const count = Number(body?.camera_count);
  if (!Number.isInteger(count) || count < 0 || count > 200) return { status: 400, error: 'camera_count noto\'g\'ri' };
  if (!isTime(body.started_at) || !isTime(body.ended_at)) return { status: 400, error: 'Vaqt noto\'g\'ri' };

  db.prepare(
    "UPDATE counting_sessions SET status = 'done', camera_count = ?, started_at = ?, ended_at = ?, error = NULL WHERE id = ?"
  ).run(count, new Date(body.started_at).toISOString(), new Date(body.ended_at).toISOString(), session.id);
  applyDifference(db, session.lesson_id);
  return { status: 200 };
}

export function sessionOf(db, lessonId) {
  return (
    db
      .prepare(
        `SELECT cs.id, cs.status, cs.camera_count, cs.requested_at, cs.started_at, cs.ended_at, cs.error,
                c.channel, r.name AS room_name
         FROM counting_sessions cs
         LEFT JOIN cameras c ON c.id = cs.camera_id
         LEFT JOIN rooms r ON r.id = c.room_id
         WHERE cs.lesson_id = ?`
      )
      .get(lessonId) || null
  );
}

// Kamera soni va o'qituvchi sonini solishtirish. Bir marta shubhali deb belgilangan dars
// keyingi tuzatishlardan keyin ham shubhali bo'lib qoladi: tarix yo'qolmasligi kerak.
export function applyDifference(db, lessonId) {
  const att = db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').get(lessonId);
  const session = db.prepare("SELECT camera_count FROM counting_sessions WHERE lesson_id = ? AND status = 'done'").get(lessonId);
  if (!att || !session) return null;

  const difference = Math.abs(session.camera_count - att.teacher_count);
  const suspicious = att.is_suspicious || difference > DIFF_LIMIT ? 1 : 0;
  db.prepare('UPDATE attendance SET camera_count = ?, difference = ?, is_suspicious = ? WHERE id = ?').run(
    session.camera_count,
    difference,
    suspicious,
    att.id
  );
  if (suspicious && !att.is_suspicious) {
    const lesson = db.prepare('SELECT school_id FROM lessons WHERE id = ?').get(lessonId);
    audit(db, {
      schoolId: lesson.school_id,
      action: 'attendance.suspicious',
      entity: 'attendance',
      entityId: att.id,
      newValue: { camera_count: session.camera_count, teacher_count: att.teacher_count, difference },
    });
  }
  return { difference, suspicious: !!suspicious };
}
