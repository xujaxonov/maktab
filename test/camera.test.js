// 2-bosqich testlari: lokal miya bilan aloqa, kamera sanog'i, farq tekshiruvi va shubhali holatlar.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { nowTashkent } from '../src/time.js';

process.env.ALLOW_ANY_TIME = '1';

let db, server, base;
const today = nowTashkent();
const skip = today.weekday === 7 && 'yakshanba: dars yo\'q';
const ctx = {};

function client(headers = {}) {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const admin = client();
const teacher = client();
let node;

before(async () => {
  db = openDb(':memory:');
  const school = db.prepare("INSERT INTO schools (name) VALUES ('Test')").run().lastInsertRowid;
  const add = db.prepare('INSERT INTO users (school_id, role, full_name, login, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 0)');
  add.run(school, 'admin', 'Admin', 'admin', hashPassword('parol1234'));
  const teacherId = add.run(school, 'teacher', 'Karimova', 'karimova', hashPassword('parol1234')).lastInsertRowid;
  const cls = db.prepare("INSERT INTO classes (school_id, name) VALUES (?, '5-A')").run(school).lastInsertRowid;
  const st = db.prepare('INSERT INTO students (school_id, class_id, full_name) VALUES (?, ?, ?)');
  for (let i = 1; i <= 10; i++) st.run(school, cls, `O'quvchi ${String(i).padStart(2, '0')}`);
  ctx.camRoom = db.prepare("INSERT INTO rooms (school_id, name) VALUES (?, '101')").run(school).lastInsertRowid;
  ctx.plainRoom = db.prepare("INSERT INTO rooms (school_id, name) VALUES (?, 'Sport zali')").run(school).lastInsertRowid;
  const slot = db.prepare("INSERT INTO lesson_slots (school_id, number, start_time, end_time) VALUES (?, ?, '08:00', '08:45')");
  const slots = [1, 2, 3].map((n) => slot.run(school, n).lastInsertRowid);
  const tt = db.prepare(
    `INSERT INTO timetable (school_id, weekday, slot_id, class_id, subject, teacher_id, room_id, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, '2020-01-01', '2099-12-31')`
  );
  ctx.tt = [
    tt.run(school, today.weekday || 1, slots[0], cls, 'Matematika', teacherId, ctx.camRoom).lastInsertRowid,
    tt.run(school, today.weekday || 1, slots[1], cls, 'Jismoniy tarbiya', teacherId, ctx.plainRoom).lastInsertRowid,
    tt.run(school, today.weekday || 1, slots[2], cls, 'Ona tili', teacherId, ctx.camRoom).lastInsertRowid,
  ];
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/api/auth/login', { login: 'admin', password: 'parol1234' });
  await teacher('POST', '/api/auth/login', { login: 'karimova', password: 'parol1234' });
});

after(() => server.close());

test('admin kamera biriktiradi va lokal miya tokenini oladi', async () => {
  assert.equal((await admin('PUT', `/api/admin/rooms/${ctx.camRoom}/camera`, { channel: 'rtsp://x' })).status, 400);
  assert.equal((await admin('PUT', `/api/admin/rooms/${ctx.camRoom}/camera`, { channel: '3' })).status, 200);
  const rooms = (await admin('GET', '/api/admin/rooms')).body;
  assert.equal(rooms.find((r) => r.id === ctx.camRoom).channel, '3');

  const { body } = await admin('POST', '/api/admin/node/token', {});
  assert.match(body.token, /^sdn_/);
  ctx.token = body.token;
  node = client({ authorization: `Bearer ${ctx.token}`, 'x-node-version': 'test-1' });
  assert.equal((await client({ authorization: 'Bearer xato' })('GET', '/api/node/config')).status, 401);

  // Hali birorta so'rov yubormagan lokal miya "aloqada emas".
  assert.equal((await admin('GET', '/api/admin/node')).body.online, false);
});

test('lokal miya kameralar holatini yuboradi', async () => {
  const cams = (await node('GET', '/api/node/config')).body.cameras;
  assert.equal(cams.length, 1);
  assert.equal(cams[0].channel, '3');
  ctx.cameraId = cams[0].camera_id;
  await node('POST', '/api/node/heartbeat', { cameras: [{ camera_id: ctx.cameraId, ok: false, error: 'Ulanish rad etildi' }] });
  const summary = (await admin('GET', '/api/admin/summary')).body;
  assert.equal(summary.node.online, true);
  assert.equal(summary.cameras_failing[0].status_error, 'Ulanish rad etildi');
  await node('POST', '/api/node/heartbeat', { cameras: [{ camera_id: ctx.cameraId, ok: true }] });
});

test('kamerali xonada dars boshlanishi lokal miyaga vazifa beradi (long polling)', { skip }, async () => {
  const waiting = node('GET', '/api/node/jobs?wait=10');
  await new Promise((r) => setTimeout(r, 200));
  const started = Date.now();
  const lesson = await teacher('POST', '/api/teacher/lessons/start', { timetable_id: ctx.tt[0], date: today.date });
  assert.equal(lesson.body.mode, 'camera');
  assert.equal(lesson.body.session.status, 'pending');
  ctx.lesson = lesson.body;

  const { body } = await waiting;
  assert.ok(Date.now() - started < 3000, 'vazifa darhol yetib kelishi kerak');
  assert.equal(body.jobs.length, 1);
  assert.deepEqual(
    { channel: body.jobs[0].channel, duration: body.jobs[0].duration_sec, subtract: body.jobs[0].subtract_teacher },
    { channel: '3', duration: 60, subtract: true }
  );
  ctx.sessionId = body.jobs[0].session_id;
  // Vazifa ikkinchi marta berilmaydi.
  assert.equal((await node('GET', '/api/node/jobs')).body.jobs.length, 0);
});

test('farq 2 dan oshsa o\'qituvchidan tasdiq so\'raladi va dars shubhali bo\'ladi', { skip }, async () => {
  const bad = await node('POST', `/api/node/sessions/${ctx.sessionId}/result`, { camera_count: -1, started_at: 'x', ended_at: 'y' });
  assert.equal(bad.status, 400);
  const t0 = new Date(Date.now() - 60_000).toISOString();
  const t1 = new Date().toISOString();
  assert.equal((await node('POST', `/api/node/sessions/${ctx.sessionId}/result`, { camera_count: 7, started_at: t0, ended_at: t1 })).status, 200);

  const details = (await teacher('GET', `/api/teacher/lessons/${ctx.lesson.id}`)).body;
  assert.equal(details.session.status, 'done');
  assert.equal(details.session.camera_count, 7);

  // Kamera 7, o'qituvchi "hamma bor" (10): farq 3.
  const first = await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, { absences: [] });
  assert.equal(first.status, 409);
  assert.equal(first.body.code, 'confirm_difference');
  assert.equal(first.body.camera_count, 7);
  assert.equal(first.body.teacher_count, 10);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 0);

  const confirmed = await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, { absences: [], confirm_difference: true });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.attendance.difference, 3);
  assert.equal(confirmed.body.attendance.is_suspicious, 1);

  // Keyin to'g'rilansa ham (8 bor), shubhali belgi saqlanib qoladi.
  const students = confirmed.body.students;
  const fixed = await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, {
    absences: students.slice(0, 2).map((s) => ({ student_id: s.id, type: 'sababsiz' })),
  });
  assert.equal(fixed.status, 200);
  assert.equal(fixed.body.attendance.difference, 1);
  assert.equal(fixed.body.attendance.is_suspicious, 1);
});

test('admin shubhali holatni ko\'radi va xulosa yozadi', { skip }, async () => {
  const list = (await admin('GET', '/api/admin/suspicious')).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].camera_count, 7);
  assert.equal(list[0].channel, '3');
  assert.ok(list[0].video_from && list[0].video_to);

  assert.equal((await admin('POST', `/api/admin/suspicious/${list[0].attendance_id}/review`, { verdict: 'boshqa' })).status, 400);
  const review = await admin('POST', `/api/admin/suspicious/${list[0].attendance_id}/review`, { verdict: 'oqituvchi_xatosi', comment: 'Videoda 7 kishi' });
  assert.equal(review.status, 201);
  assert.equal((await admin('GET', '/api/admin/suspicious')).body.length, 0);
  assert.equal((await admin('GET', '/api/admin/suspicious?all=1')).body[0].review.verdict, 'oqituvchi_xatosi');
  assert.equal((await admin('GET', '/api/admin/summary')).body.suspicious_open, 0);
});

test('kamerasiz xonada dars qo\'lda rejimda o\'tadi', { skip }, async () => {
  const lesson = await teacher('POST', '/api/teacher/lessons/start', { timetable_id: ctx.tt[1], date: today.date });
  assert.equal(lesson.body.mode, 'manual');
  assert.equal(lesson.body.session, null);
});

test('lokal miya aloqada bo\'lmasa, dars qo\'lda rejimga o\'tadi va sabab yoziladi', { skip }, async () => {
  db.prepare("UPDATE local_nodes SET last_seen_at = '2000-01-01T00:00:00.000Z'").run();
  const lesson = await teacher('POST', '/api/teacher/lessons/start', { timetable_id: ctx.tt[2], date: today.date });
  assert.equal(lesson.body.mode, 'manual');
  assert.equal(lesson.body.session.status, 'failed');
  assert.equal(lesson.body.session.error, 'Lokal miya aloqada emas');
});

test('javob bermagan sessiya 5 daqiqadan keyin yopiladi', { skip }, async () => {
  const sid = db
    .prepare("INSERT INTO counting_sessions (lesson_id, camera_id, node_id, status, requested_at) VALUES (?, ?, 1, 'running', ?)")
    .run(
      db.prepare("INSERT INTO lessons (timetable_id, date, school_id, teacher_id, class_id, subject, room_id, mode, started_at, ends_at) SELECT timetable_id, '2000-01-01', school_id, teacher_id, class_id, subject, room_id, 'camera', started_at, ends_at FROM lessons LIMIT 1").run().lastInsertRowid,
      ctx.cameraId,
      new Date(Date.now() - 6 * 60_000).toISOString()
    ).lastInsertRowid;
  await node('GET', '/api/node/jobs');
  assert.equal(db.prepare('SELECT status FROM counting_sessions WHERE id = ?').get(sid).status, 'failed');
});

test('token almashtirilsa, eski token ishlamaydi; kamera faolsizlantiriladi', async () => {
  await admin('POST', '/api/admin/node/token', {});
  assert.equal((await node('GET', '/api/node/config')).status, 401);
  assert.equal((await admin('DELETE', `/api/admin/rooms/${ctx.camRoom}/camera`)).status, 200);
  const room = (await admin('GET', '/api/admin/rooms')).body.find((r) => r.id === ctx.camRoom);
  assert.equal(room.camera_id, null);
  assert.equal(room.has_camera, 0);
});
