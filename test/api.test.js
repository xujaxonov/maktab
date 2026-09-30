// 1-bosqich API testlari: admin jadval tuzadi, o'qituvchi davomat oladi, ota-onaga xabar navbatga tushadi.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/server.js';
import { hashPassword } from '../src/auth.js';
import { nowTashkent } from '../src/time.js';

process.env.ALLOW_ANY_TIME = '1';

let db, server, base;
const today = nowTashkent();
const isSunday = today.weekday === 7;

before(async () => {
  db = openDb(':memory:');
  const school = db.prepare("INSERT INTO schools (name) VALUES ('Test maktab')").run().lastInsertRowid;
  db.prepare("INSERT INTO users (school_id, role, full_name, login, password_hash, must_change_password) VALUES (?, 'admin', 'Admin', 'admin', ?, 0)")
    .run(school, hashPassword('admin1234'));
  const other = db.prepare("INSERT INTO schools (name) VALUES ('Boshqa maktab')").run().lastInsertRowid;
  db.prepare("INSERT INTO users (school_id, role, full_name, login, password_hash, must_change_password) VALUES (?, 'admin', 'Boshqa', 'admin2', ?, 0)")
    .run(other, hashPassword('admin1234'));
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

// Har bir foydalanuvchi uchun alohida cookie saqlaydigan kichik mijoz.
function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
}

const admin = client();
const teacher = client();
const teacher2 = client();
const ctx = {};

test('admin tizimga kiradi, noto\'g\'ri parol rad etiladi', async () => {
  assert.equal((await admin('POST', '/api/auth/login', { login: 'admin', password: 'xato' })).status, 401);
  const r = await admin('POST', '/api/auth/login', { login: 'admin', password: 'admin1234' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
});

test('admin maktab ma\'lumotlarini kiritadi', async () => {
  const t1 = await admin('POST', '/api/admin/teachers', { full_name: 'Karimova Dilnoza' });
  assert.equal(t1.status, 201);
  assert.match(t1.body.login, /^karimova\d{3}$/);
  ctx.teacher = t1.body;
  ctx.teacher2 = (await admin('POST', '/api/admin/teachers', { full_name: 'Toshmatov Bekzod' })).body;

  ctx.classId = (await admin('POST', '/api/admin/classes', { name: '5-a' })).body.id;
  assert.equal((await admin('POST', '/api/admin/classes', { name: '5-A' })).status, 409);

  const imp = await admin('POST', '/api/admin/students/import', { class_id: ctx.classId, text: 'Aliyev Ali\nValiyev Vali\nSobirova Sevara\n\nAliyev Ali' });
  assert.deepEqual(imp.body, { added: 3, skipped: 1 });

  ctx.roomA = (await admin('POST', '/api/admin/rooms', { name: '101' })).body.id;
  ctx.roomB = (await admin('POST', '/api/admin/rooms', { name: '102' })).body.id;
  ctx.slot = (await admin('POST', '/api/admin/slots', { number: 1, start_time: '08:00', end_time: '08:45' })).body.id;
  assert.equal((await admin('POST', '/api/admin/slots', { number: 2, start_time: '09:00', end_time: '08:45' })).status, 400);
});

test('boshqa maktab admini bu maktab ma\'lumotlarini ko\'rmaydi', async () => {
  const other = client();
  await other('POST', '/api/auth/login', { login: 'admin2', password: 'admin1234' });
  assert.equal((await other('GET', '/api/admin/teachers')).body.length, 0);
  assert.equal((await other('PUT', `/api/admin/classes/${ctx.classId}`, { name: '9-Z' })).status, 404);
});

test('jadval to\'qnashuvlari aniqlanadi', { skip: isSunday && 'yakshanba: dars yo\'q' }, async () => {
  const entry = { weekday: today.weekday, slot_id: ctx.slot, class_id: ctx.classId, subject: 'Matematika', teacher_id: ctx.teacher.id, room_id: ctx.roomA };
  const ok = await admin('POST', '/api/admin/timetable', entry);
  assert.equal(ok.status, 201);
  ctx.timetableId = ok.body.id;

  const sameTeacher = await admin('POST', '/api/admin/timetable', { ...entry, room_id: ctx.roomB });
  assert.equal(sameTeacher.status, 409);
  const sameRoom = await admin('POST', '/api/admin/timetable', { ...entry, teacher_id: ctx.teacher2.id });
  assert.equal(sameRoom.status, 409);
});

test('o\'qituvchi avval parolni almashtirishi shart', async () => {
  const login = await teacher('POST', '/api/auth/login', { login: ctx.teacher.login, password: ctx.teacher.password });
  assert.equal(login.body.must_change_password, true);
  const blocked = await teacher('GET', '/api/teacher/lessons');
  assert.equal(blocked.body.code, 'must_change_password');

  assert.equal((await teacher('POST', '/api/auth/change-password', { old_password: ctx.teacher.password, new_password: 'qisqa' })).status, 400);
  const changed = await teacher('POST', '/api/auth/change-password', { old_password: ctx.teacher.password, new_password: 'yangiParol1' });
  assert.equal(changed.status, 200);
  assert.equal((await teacher('GET', '/api/teacher/lessons')).status, 200);
  assert.equal((await teacher('GET', '/api/admin/teachers')).status, 403);
});

test('o\'qituvchi faqat o\'z darslarini ko\'radi va darsni boshlaydi', { skip: isSunday && 'yakshanba' }, async () => {
  const day = await teacher('GET', '/api/teacher/lessons');
  assert.equal(day.body.lessons.length, 1);
  assert.equal(day.body.lessons[0].subject, 'Matematika');
  assert.equal(day.body.lessons[0].can_start, true);

  const noReason = await teacher('POST', '/api/teacher/lessons/start', { timetable_id: ctx.timetableId, date: today.date, room_id: ctx.roomB });
  assert.equal(noReason.status, 400);

  const started = await teacher('POST', '/api/teacher/lessons/start', { timetable_id: ctx.timetableId, date: today.date });
  assert.equal(started.status, 200);
  assert.equal(started.body.students.length, 3);
  assert.equal(started.body.mode, 'manual');
  ctx.lesson = started.body;

  // Ikkinchi o'qituvchi bu darsni boshlay olmaydi va davomat belgilay olmaydi.
  await teacher2('POST', '/api/auth/login', { login: ctx.teacher2.login, password: ctx.teacher2.password });
  await teacher2('POST', '/api/auth/change-password', { old_password: ctx.teacher2.password, new_password: 'boshqaParol2' });
  assert.equal((await teacher2('POST', '/api/teacher/lessons/start', { timetable_id: ctx.timetableId, date: today.date })).status, 404);
  assert.equal((await teacher2('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, { absences: [] })).status, 403);
});

test('davomat saqlanadi va ota-onaga xabar navbatga tushadi', { skip: isSunday && 'yakshanba' }, async () => {
  const [ali, sevara] = ctx.lesson.students.filter((s) => s.full_name !== 'Valiyev Vali');
  // Ali'ning ota-onasi botga ulangan, Sevaraniki ulanmagan.
  const parent = db.prepare('INSERT INTO parents (telegram_id) VALUES (111)').run().lastInsertRowid;
  db.prepare('INSERT INTO parent_links (student_id, link_code, parent_id) VALUES (?, ?, ?)').run(ali.id, 'TESTCODE', parent);

  const saved = await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, {
    absences: [{ student_id: ali.id, type: 'sababsiz' }, { student_id: sevara.id, type: 'sababsiz' }],
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.attendance.expected_count, 3);
  assert.equal(saved.body.attendance.teacher_count, 1);

  let notes = db.prepare('SELECT * FROM notifications ORDER BY id').all();
  assert.equal(notes.length, 2);
  assert.equal(notes.find((n) => n.student_id === ali.id).status, 'pending');
  assert.match(notes.find((n) => n.student_id === ali.id).text, /Aliyev Ali bugun 1-dars \(Matematika, 08:00\) darsiga kelmadi/);
  assert.equal(notes.find((n) => n.student_id === sevara.id).status, 'no_channel');

  // Ali kechikib keldi: bitta yangi xabar. Sevara holati o'zgarmadi: xabar takrorlanmaydi.
  await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, {
    absences: [{ student_id: ali.id, type: 'kechikdi' }, { student_id: sevara.id, type: 'sababsiz' }],
  });
  notes = db.prepare('SELECT * FROM notifications ORDER BY id').all();
  assert.equal(notes.length, 3);
  assert.match(notes.at(-1).text, /kechikib keldi/);

  const bad = await teacher('PUT', `/api/teacher/lessons/${ctx.lesson.id}/attendance`, { absences: [{ student_id: 99999, type: 'sababsiz' }] });
  assert.equal(bad.status, 400);
});

test('admin tarixni ko\'radi; tuzatish sababsiz qabul qilinmaydi', { skip: isSunday && 'yakshanba' }, async () => {
  const day = await admin('GET', `/api/admin/attendance?date=${today.date}`);
  const row = day.body.lessons.find((l) => l.timetable_id === ctx.timetableId);
  assert.equal(row.status, 'done');
  assert.equal(row.lesson.teacher_count, 2);

  assert.equal((await admin('PUT', `/api/admin/lessons/${ctx.lesson.id}/attendance`, { absences: [] })).status, 400);
  const fixed = await admin('PUT', `/api/admin/lessons/${ctx.lesson.id}/attendance`, { absences: [], reason: 'Spravka keltirildi' });
  assert.equal(fixed.status, 200);
  const log = db.prepare("SELECT * FROM audit_log WHERE action = 'attendance.admin_fix'").get();
  assert.match(log.new_value, /Spravka keltirildi/);
});

test('davomat va audit yozuvlarini o\'chirib bo\'lmaydi', { skip: isSunday && 'yakshanba' }, () => {
  assert.throws(() => db.prepare('DELETE FROM attendance').run(), /o'chirib bo'lmaydi/);
  assert.throws(() => db.prepare('DELETE FROM lessons').run(), /o'chirib bo'lmaydi/);
  assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /o'chirib bo'lmaydi/);
  assert.throws(() => db.prepare("UPDATE audit_log SET action = 'x'").run(), /o'zgartirib bo'lmaydi/);
});

test('o\'tilgan dars jadvaldan olib tashlansa, tarix saqlanadi', { skip: isSunday && 'yakshanba' }, async () => {
  assert.equal((await admin('DELETE', `/api/admin/timetable/${ctx.timetableId}`)).status, 200);
  const row = db.prepare('SELECT valid_to FROM timetable WHERE id = ?').get(ctx.timetableId);
  assert.equal(row.valid_to, today.date);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lessons').get().n, 1);
});
