// Maktab admini paneli uchun API (A-2 ... A-8). Hamma so'rovlar admin maktabi bilan cheklangan.
import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { audit, tx } from '../db.js';
import { requireRole, hashPassword, generatePassword, destroyUserSessions } from '../auth.js';
import { effectiveLessons, lessonDetails, saveAttendance, HttpError } from '../lessons.js';
import { nowTashkent, isDate, isTime, toMinutes, addDays } from '../time.js';
import { isNodeOnline, newNodeToken, hashToken } from '../camera.js';

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// O'quv yili oxiri: joriy yoki keyingi 30-iyun.
function schoolYearEnd(date) {
  const [y, m] = date.split('-').map(Number);
  return `${m >= 7 ? y + 1 : y}-06-30`;
}

// Ism-familiyadan lotin harflaridagi login asosi.
function loginBase(fullName) {
  const first = fullName.toLowerCase().split(/\s+/)[0] || '';
  return first.normalize('NFKD').replace(/[^a-z]/g, '').slice(0, 12) || 'oqituvchi';
}

// Ota-onaga beriladigan kod: chalkash belgilarsiz 8 ta belgi.
function linkCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('');
}

export function adminRoutes(db) {
  const r = Router();
  r.use(requireRole('admin'));

  const log = (req, action, entity, entityId, oldValue, newValue) =>
    audit(db, { userId: req.user.id, schoolId: req.user.school_id, action, entity, entityId, oldValue, newValue, ip: req.ip });

  // Yozuv shu maktabga tegishli ekanini tekshiradi.
  const own = (table, rowId, school) => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND school_id = ?`).get(rowId, school);
    if (!row) throw new HttpError(404, 'Topilmadi');
    return row;
  };
  const ownGroup = (groupId, school) => {
    const row = db
      .prepare('SELECT g.* FROM groups g JOIN classes c ON c.id = g.class_id WHERE g.id = ? AND c.school_id = ?')
      .get(groupId, school);
    if (!row) throw new HttpError(404, 'Guruh topilmadi');
    return row;
  };
  const ownTeacher = (teacherId, school) => {
    const row = db
      .prepare("SELECT * FROM users WHERE id = ? AND school_id = ? AND role = 'teacher'")
      .get(teacherId, school);
    if (!row) throw new HttpError(404, 'O\'qituvchi topilmadi');
    return row;
  };

  // ---------- Umumiy ko'rinish ----------
  r.get('/summary', (req, res) => {
    const s = req.user.school_id;
    const count = (sql) => db.prepare(sql).get(s).n;
    res.json({
      teachers: count("SELECT COUNT(*) n FROM users WHERE school_id = ? AND role = 'teacher' AND is_active = 1"),
      classes: count('SELECT COUNT(*) n FROM classes WHERE school_id = ?'),
      students: count('SELECT COUNT(*) n FROM students WHERE school_id = ? AND is_active = 1'),
      rooms: count('SELECT COUNT(*) n FROM rooms WHERE school_id = ?'),
      linked_parents: count(
        'SELECT COUNT(DISTINCT pl.student_id) n FROM parent_links pl JOIN students st ON st.id = pl.student_id WHERE st.school_id = ? AND pl.parent_id IS NOT NULL'
      ),
      cameras: count('SELECT COUNT(*) n FROM cameras WHERE school_id = ? AND is_active = 1'),
      cameras_failing: db
        .prepare("SELECT r.name AS room_name, c.status_error FROM cameras c JOIN rooms r ON r.id = c.room_id WHERE c.school_id = ? AND c.is_active = 1 AND c.status = 'error' ORDER BY r.name")
        .all(s),
      suspicious_open: count(
        `SELECT COUNT(*) n FROM attendance a JOIN lessons l ON l.id = a.lesson_id
         WHERE l.school_id = ? AND a.is_suspicious = 1 AND NOT EXISTS (SELECT 1 FROM suspicious_reviews sr WHERE sr.attendance_id = a.id)`
      ),
      node: (() => {
        const node = db.prepare('SELECT last_seen_at FROM local_nodes WHERE school_id = ?').get(s);
        return node ? { exists: true, online: isNodeOnline(node), last_seen_at: node.last_seen_at } : { exists: false, online: false };
      })(),
      today: nowTashkent().date,
    });
  });

  // ---------- O'qituvchilar (A-2) ----------
  r.get('/teachers', (req, res) => {
    res.json(
      db
        .prepare(
          "SELECT id, full_name, phone, login, is_active, must_change_password FROM users WHERE school_id = ? AND role = 'teacher' ORDER BY is_active DESC, full_name"
        )
        .all(req.user.school_id)
    );
  });

  r.post('/teachers', (req, res) => {
    const fullName = str(req.body?.full_name, 120);
    const phone = str(req.body?.phone, 30) || null;
    if (fullName.length < 3) throw new HttpError(400, 'Ism-familiyani kiriting');

    const base = loginBase(fullName);
    let login;
    do login = `${base}${Math.floor(100 + Math.random() * 900)}`;
    while (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login));

    const password = generatePassword();
    const result = db
      .prepare(
        "INSERT INTO users (school_id, role, full_name, phone, login, password_hash) VALUES (?, 'teacher', ?, ?, ?, ?)"
      )
      .run(req.user.school_id, fullName, phone, login, hashPassword(password));
    log(req, 'teacher.create', 'user', result.lastInsertRowid, undefined, { full_name: fullName, login });
    // Vaqtinchalik parol faqat bir marta ko'rsatiladi; o'qituvchi birinchi kirishda uni almashtiradi.
    res.status(201).json({ id: result.lastInsertRowid, full_name: fullName, login, password });
  });

  r.put('/teachers/:id', (req, res) => {
    const t = ownTeacher(Number(req.params.id), req.user.school_id);
    const fullName = str(req.body?.full_name, 120) || t.full_name;
    const phone = req.body?.phone === undefined ? t.phone : str(req.body.phone, 30) || null;
    db.prepare('UPDATE users SET full_name = ?, phone = ? WHERE id = ?').run(fullName, phone, t.id);
    log(req, 'teacher.update', 'user', t.id, { full_name: t.full_name, phone: t.phone }, { full_name: fullName, phone });
    res.json({ ok: true });
  });

  r.post('/teachers/:id/reset-password', (req, res) => {
    const t = ownTeacher(Number(req.params.id), req.user.school_id);
    const password = generatePassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), t.id);
    destroyUserSessions(db, t.id);
    log(req, 'teacher.reset_password', 'user', t.id);
    res.json({ login: t.login, password });
  });

  // O'qituvchi o'chirilmaydi, faqat faolsizlantiriladi: tarix saqlanib qoladi.
  r.post('/teachers/:id/active', (req, res) => {
    const t = ownTeacher(Number(req.params.id), req.user.school_id);
    const active = req.body?.is_active ? 1 : 0;
    db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(active, t.id);
    if (!active) destroyUserSessions(db, t.id);
    log(req, active ? 'teacher.activate' : 'teacher.deactivate', 'user', t.id);
    res.json({ ok: true });
  });

  // ---------- Sinflar va guruhlar (A-3) ----------
  r.get('/classes', (req, res) => {
    const classes = db
      .prepare(
        `SELECT c.id, c.name, c.shift,
                (SELECT COUNT(*) FROM students st WHERE st.class_id = c.id AND st.is_active = 1) AS student_count
         FROM classes c WHERE c.school_id = ?
         ORDER BY CAST(c.name AS INTEGER), c.name`
      )
      .all(req.user.school_id);
    const groups = db.prepare('SELECT id, name FROM groups WHERE class_id = ? ORDER BY name');
    res.json(classes.map((c) => ({ ...c, groups: groups.all(c.id) })));
  });

  r.post('/classes', (req, res) => {
    const name = str(req.body?.name, 20).toUpperCase();
    const shift = Number(req.body?.shift) === 2 ? 2 : 1;
    if (!name) throw new HttpError(400, 'Sinf nomini kiriting, masalan 5-A');
    if (db.prepare('SELECT 1 FROM classes WHERE school_id = ? AND name = ?').get(req.user.school_id, name)) {
      throw new HttpError(409, 'Bunday sinf bor');
    }
    const result = db.prepare('INSERT INTO classes (school_id, name, shift) VALUES (?, ?, ?)').run(req.user.school_id, name, shift);
    log(req, 'class.create', 'class', result.lastInsertRowid, undefined, { name, shift });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  r.put('/classes/:id', (req, res) => {
    const c = own('classes', Number(req.params.id), req.user.school_id);
    const name = str(req.body?.name, 20).toUpperCase() || c.name;
    const shift = req.body?.shift === undefined ? c.shift : Number(req.body.shift) === 2 ? 2 : 1;
    db.prepare('UPDATE classes SET name = ?, shift = ? WHERE id = ?').run(name, shift, c.id);
    log(req, 'class.update', 'class', c.id, { name: c.name, shift: c.shift }, { name, shift });
    res.json({ ok: true });
  });

  r.post('/classes/:id/groups', (req, res) => {
    const c = own('classes', Number(req.params.id), req.user.school_id);
    const name = str(req.body?.name, 60);
    if (!name) throw new HttpError(400, 'Guruh nomini kiriting');
    if (db.prepare('SELECT 1 FROM groups WHERE class_id = ? AND name = ?').get(c.id, name)) {
      throw new HttpError(409, 'Bunday guruh bor');
    }
    const result = db.prepare('INSERT INTO groups (class_id, name) VALUES (?, ?)').run(c.id, name);
    log(req, 'group.create', 'group', result.lastInsertRowid, undefined, { class_id: c.id, name });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  // ---------- O'quvchilar (A-4) ----------
  r.get('/students', (req, res) => {
    const classId = id(req.query.class_id);
    const rows = db
      .prepare(
        `SELECT st.id, st.full_name, st.class_id, st.is_active, c.name AS class_name,
                (SELECT COUNT(*) FROM parent_links pl WHERE pl.student_id = st.id AND pl.parent_id IS NOT NULL) AS parents_linked,
                (SELECT group_concat(sg.group_id) FROM student_groups sg WHERE sg.student_id = st.id) AS group_ids
         FROM students st JOIN classes c ON c.id = st.class_id
         WHERE st.school_id = ? AND (? IS NULL OR st.class_id = ?)
         ORDER BY c.name, st.is_active DESC, st.full_name`
      )
      .all(req.user.school_id, classId, classId);
    res.json(rows.map((s) => ({ ...s, group_ids: s.group_ids ? s.group_ids.split(',').map(Number) : [] })));
  });

  const setGroups = (student, groupIds, school) => {
    if (!Array.isArray(groupIds)) return;
    for (const g of groupIds) {
      const group = ownGroup(Number(g), school);
      if (group.class_id !== student.class_id) throw new HttpError(400, 'Guruh o\'quvchining sinfiga tegishli emas');
    }
    db.prepare('DELETE FROM student_groups WHERE student_id = ?').run(student.id);
    const ins = db.prepare('INSERT INTO student_groups (student_id, group_id) VALUES (?, ?)');
    for (const g of new Set(groupIds.map(Number))) ins.run(student.id, g);
  };

  r.post('/students', (req, res) => {
    const fullName = str(req.body?.full_name, 120);
    const cls = own('classes', Number(req.body?.class_id), req.user.school_id);
    if (fullName.length < 3) throw new HttpError(400, 'Ism-familiyani kiriting');
    const created = tx(db, () => {
      const result = db
        .prepare('INSERT INTO students (school_id, class_id, full_name) VALUES (?, ?, ?)')
        .run(req.user.school_id, cls.id, fullName);
      setGroups({ id: result.lastInsertRowid, class_id: cls.id }, req.body?.group_ids, req.user.school_id);
      log(req, 'student.create', 'student', result.lastInsertRowid, undefined, { full_name: fullName, class_id: cls.id });
      return result.lastInsertRowid;
    });
    res.status(201).json({ id: created });
  });

  // Ro'yxatni birdaniga kiritish: har qatorda bitta ism-familiya (Excel'dan nusxa ko'chirish mumkin).
  r.post('/students/import', (req, res) => {
    const cls = own('classes', Number(req.body?.class_id), req.user.school_id);
    const names = String(req.body?.text || '')
      .split(/\r?\n/)
      .map((l) => l.split(/[\t;,]/)[0].trim().replace(/\s+/g, ' '))
      .filter((l) => l.length >= 3)
      .slice(0, 100);
    if (!names.length) throw new HttpError(400, 'Ro\'yxat bo\'sh');
    const existing = new Set(
      db.prepare('SELECT full_name FROM students WHERE class_id = ? AND is_active = 1').all(cls.id).map((s) => s.full_name.toLowerCase())
    );
    const fresh = names.filter((n) => {
      const key = n.toLowerCase();
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    });
    tx(db, () => {
      const ins = db.prepare('INSERT INTO students (school_id, class_id, full_name) VALUES (?, ?, ?)');
      for (const n of fresh) ins.run(req.user.school_id, cls.id, n);
      log(req, 'student.import', 'class', cls.id, undefined, { added: fresh.length });
    });
    res.json({ added: fresh.length, skipped: names.length - fresh.length });
  });

  r.put('/students/:id', (req, res) => {
    const st = own('students', Number(req.params.id), req.user.school_id);
    const fullName = str(req.body?.full_name, 120) || st.full_name;
    const classId = req.body?.class_id ? own('classes', Number(req.body.class_id), req.user.school_id).id : st.class_id;
    const active = req.body?.is_active === undefined ? st.is_active : req.body.is_active ? 1 : 0;
    tx(db, () => {
      db.prepare('UPDATE students SET full_name = ?, class_id = ?, is_active = ? WHERE id = ?').run(fullName, classId, active, st.id);
      // Sinf almashsa, eski sinf guruhlari olib tashlanadi.
      if (classId !== st.class_id) db.prepare('DELETE FROM student_groups WHERE student_id = ?').run(st.id);
      setGroups({ id: st.id, class_id: classId }, req.body?.group_ids, req.user.school_id);
      log(req, 'student.update', 'student', st.id,
        { full_name: st.full_name, class_id: st.class_id, is_active: st.is_active },
        { full_name: fullName, class_id: classId, is_active: active, group_ids: req.body?.group_ids });
    });
    res.json({ ok: true });
  });

  // Sinf bo'yicha ota-onalar uchun ulash kodlari (chop etib tarqatish uchun).
  // Har bir o'quvchida bitta ishlatilmagan kod bo'ladi; ota-ona ulangach, keyingisi uchun yangisi yaratiladi.
  r.get('/link-codes', (req, res) => {
    const cls = own('classes', Number(req.query.class_id), req.user.school_id);
    const students = db
      .prepare('SELECT id, full_name FROM students WHERE class_id = ? AND is_active = 1 ORDER BY full_name')
      .all(cls.id);
    const unused = db.prepare('SELECT link_code FROM parent_links WHERE student_id = ? AND parent_id IS NULL');
    const linked = db.prepare('SELECT COUNT(*) n FROM parent_links WHERE student_id = ? AND parent_id IS NOT NULL');
    const ins = db.prepare('INSERT INTO parent_links (student_id, link_code) VALUES (?, ?)');
    const rows = tx(db, () =>
      students.map((s) => {
        let code = unused.get(s.id)?.link_code;
        if (!code) {
          code = linkCode();
          ins.run(s.id, code);
        }
        return { student_id: s.id, full_name: s.full_name, code, parents_linked: linked.get(s.id).n };
      })
    );
    res.json({ class_name: cls.name, bot_username: process.env.BOT_USERNAME || null, students: rows });
  });

  // ---------- Xonalar (A-5) ----------
  // Xonalar kamerasi bilan birga. has_camera kameralar jadvalidan kelib chiqadi.
  r.get('/rooms', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT r.id, r.name, r.has_camera, c.id AS camera_id, c.channel, c.subtract_teacher,
                  c.status AS camera_status, c.status_error AS camera_error, c.status_at AS camera_status_at
           FROM rooms r LEFT JOIN cameras c ON c.room_id = r.id AND c.is_active = 1
           WHERE r.school_id = ? ORDER BY r.name`
        )
        .all(req.user.school_id)
    );
  });

  r.post('/rooms', (req, res) => {
    const name = str(req.body?.name, 40);
    if (!name) throw new HttpError(400, 'Xona nomini kiriting');
    if (db.prepare('SELECT 1 FROM rooms WHERE school_id = ? AND name = ?').get(req.user.school_id, name)) {
      throw new HttpError(409, 'Bunday xona bor');
    }
    const result = db.prepare('INSERT INTO rooms (school_id, name) VALUES (?, ?)').run(req.user.school_id, name);
    log(req, 'room.create', 'room', result.lastInsertRowid, undefined, { name });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  r.put('/rooms/:id', (req, res) => {
    const room = own('rooms', Number(req.params.id), req.user.school_id);
    const name = str(req.body?.name, 40) || room.name;
    db.prepare('UPDATE rooms SET name = ? WHERE id = ?').run(name, room.id);
    log(req, 'room.update', 'room', room.id, { name: room.name }, { name });
    res.json({ ok: true });
  });

  // ---------- Kameralar (A-5) ----------
  // Xonaga kamera biriktirish: faqat NVR kanal raqami. Login va parol lokal miyada saqlanadi.
  r.put('/rooms/:id/camera', (req, res) => {
    const room = own('rooms', Number(req.params.id), req.user.school_id);
    const channel = str(String(req.body?.channel ?? ''), 20);
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(channel)) throw new HttpError(400, 'Kanal raqamini kiriting, masalan 3');
    const subtract = req.body?.subtract_teacher === false ? 0 : 1;
    const old = db.prepare('SELECT * FROM cameras WHERE room_id = ?').get(room.id);
    tx(db, () => {
      if (old) {
        db.prepare("UPDATE cameras SET channel = ?, subtract_teacher = ?, is_active = 1, status = 'unknown', status_error = NULL WHERE id = ?")
          .run(channel, subtract, old.id);
      } else {
        db.prepare('INSERT INTO cameras (school_id, room_id, channel, subtract_teacher) VALUES (?, ?, ?, ?)')
          .run(req.user.school_id, room.id, channel, subtract);
      }
      db.prepare('UPDATE rooms SET has_camera = 1 WHERE id = ?').run(room.id);
      log(req, 'camera.set', 'room', room.id, old ? { channel: old.channel, is_active: old.is_active } : undefined, { channel, subtract_teacher: subtract });
    });
    res.json({ ok: true });
  });

  // Kamera o'chirilmaydi (sanash tarixida ishlatilgan bo'lishi mumkin), faqat faolsizlantiriladi.
  r.delete('/rooms/:id/camera', (req, res) => {
    const room = own('rooms', Number(req.params.id), req.user.school_id);
    tx(db, () => {
      db.prepare('UPDATE cameras SET is_active = 0 WHERE room_id = ?').run(room.id);
      db.prepare('UPDATE rooms SET has_camera = 0 WHERE id = ?').run(room.id);
      log(req, 'camera.remove', 'room', room.id);
    });
    res.json({ ok: true });
  });

  // ---------- Lokal miya ----------
  r.get('/node', (req, res) => {
    const node = db.prepare('SELECT id, version, last_seen_at, created_at FROM local_nodes WHERE school_id = ?').get(req.user.school_id);
    res.json(node ? { exists: true, online: isNodeOnline(node), ...node } : { exists: false, online: false });
  });

  // Lokal miya uchun token yaratish yoki almashtirish. Token faqat bir marta ko'rsatiladi;
  // almashtirilsa, eski token bilan ulangan qurilma darhol uziladi.
  r.post('/node/token', (req, res) => {
    const token = newNodeToken();
    const existing = db.prepare('SELECT id FROM local_nodes WHERE school_id = ?').get(req.user.school_id);
    if (existing) {
      db.prepare('UPDATE local_nodes SET token_hash = ?, last_seen_at = NULL WHERE id = ?').run(hashToken(token), existing.id);
    } else {
      db.prepare('INSERT INTO local_nodes (school_id, token_hash) VALUES (?, ?)').run(req.user.school_id, hashToken(token));
    }
    log(req, existing ? 'node.token_regenerate' : 'node.create', 'local_node', existing?.id);
    res.json({ token });
  });

  // ---------- Shubhali holatlar (A-9) ----------
  r.get('/suspicious', (req, res) => {
    const onlyOpen = req.query.all !== '1';
    const rows = db
      .prepare(
        `SELECT a.id AS attendance_id, a.expected_count, a.teacher_count, a.camera_count, a.difference,
                l.id AS lesson_id, l.date, l.subject, c.name AS class_name, g.name AS group_name,
                u.full_name AS teacher_name, r.name AS room_name, s.number AS slot_number, s.start_time,
                cs.started_at AS video_from, cs.ended_at AS video_to, cam.channel,
                (SELECT json_object('verdict', sr.verdict, 'comment', sr.comment, 'created_at', sr.created_at, 'admin', au.full_name)
                   FROM suspicious_reviews sr JOIN users au ON au.id = sr.admin_id
                   WHERE sr.attendance_id = a.id ORDER BY sr.id DESC LIMIT 1) AS review
         FROM attendance a
         JOIN lessons l ON l.id = a.lesson_id
         JOIN classes c ON c.id = l.class_id
         LEFT JOIN groups g ON g.id = l.group_id
         JOIN users u ON u.id = l.teacher_id
         JOIN rooms r ON r.id = l.room_id
         JOIN timetable t ON t.id = l.timetable_id
         JOIN lesson_slots s ON s.id = t.slot_id
         LEFT JOIN counting_sessions cs ON cs.lesson_id = l.id
         LEFT JOIN cameras cam ON cam.id = cs.camera_id
         WHERE l.school_id = ? AND a.is_suspicious = 1
         ORDER BY l.date DESC, s.number DESC`
      )
      .all(req.user.school_id)
      .map((row) => ({ ...row, review: row.review ? JSON.parse(row.review) : null }));
    res.json(onlyOpen ? rows.filter((r) => !r.review) : rows);
  });

  r.post('/suspicious/:id/review', (req, res) => {
    const att = db
      .prepare('SELECT a.* FROM attendance a JOIN lessons l ON l.id = a.lesson_id WHERE a.id = ? AND l.school_id = ? AND a.is_suspicious = 1')
      .get(Number(req.params.id), req.user.school_id);
    if (!att) throw new HttpError(404, 'Shubhali holat topilmadi');
    const verdict = req.body?.verdict;
    if (!['kamera_xatosi', 'oqituvchi_xatosi', 'tasdiqlandi'].includes(verdict)) throw new HttpError(400, 'Xulosani tanlang');
    const comment = str(req.body?.comment, 500) || null;
    const result = db
      .prepare('INSERT INTO suspicious_reviews (attendance_id, admin_id, verdict, comment) VALUES (?, ?, ?, ?)')
      .run(att.id, req.user.id, verdict, comment);
    log(req, 'suspicious.review', 'attendance', att.id, undefined, { verdict, comment });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  // ---------- Qo'ng'iroq jadvali ----------
  r.get('/slots', (req, res) => {
    res.json(
      db
        .prepare('SELECT id, shift, number, start_time, end_time FROM lesson_slots WHERE school_id = ? ORDER BY shift, number')
        .all(req.user.school_id)
    );
  });

  const checkSlot = (body) => {
    const shift = Number(body?.shift) === 2 ? 2 : 1;
    const number = Number(body?.number);
    if (!Number.isInteger(number) || number < 1 || number > 12) throw new HttpError(400, 'Dars raqami 1 dan 12 gacha');
    if (!isTime(body?.start_time) || !isTime(body?.end_time)) throw new HttpError(400, 'Vaqt SS:DD ko\'rinishida bo\'lsin');
    if (toMinutes(body.start_time) >= toMinutes(body.end_time)) throw new HttpError(400, 'Tugash vaqti boshlanishdan keyin bo\'lsin');
    return { shift, number, start_time: body.start_time, end_time: body.end_time };
  };

  r.post('/slots', (req, res) => {
    const s = checkSlot(req.body);
    if (db.prepare('SELECT 1 FROM lesson_slots WHERE school_id = ? AND shift = ? AND number = ?').get(req.user.school_id, s.shift, s.number)) {
      throw new HttpError(409, 'Bu smenada shu raqamli dars bor');
    }
    const result = db
      .prepare('INSERT INTO lesson_slots (school_id, shift, number, start_time, end_time) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.school_id, s.shift, s.number, s.start_time, s.end_time);
    log(req, 'slot.create', 'slot', result.lastInsertRowid, undefined, s);
    res.status(201).json({ id: result.lastInsertRowid });
  });

  r.put('/slots/:id', (req, res) => {
    const old = own('lesson_slots', Number(req.params.id), req.user.school_id);
    const s = checkSlot({ ...old, ...req.body });
    db.prepare('UPDATE lesson_slots SET start_time = ?, end_time = ? WHERE id = ?').run(s.start_time, s.end_time, old.id);
    log(req, 'slot.update', 'slot', old.id, { start_time: old.start_time, end_time: old.end_time }, { start_time: s.start_time, end_time: s.end_time });
    res.json({ ok: true });
  });

  // ---------- Dars jadvali (A-6) ----------
  r.get('/timetable', (req, res) => {
    const today = nowTashkent().date;
    const classId = id(req.query.class_id);
    const teacherId = id(req.query.teacher_id);
    res.json(
      db
        .prepare(
          `SELECT t.id, t.weekday, t.slot_id, t.class_id, t.group_id, t.subject, t.teacher_id, t.room_id,
                  t.valid_from, t.valid_to, s.shift, s.number AS slot_number, s.start_time, s.end_time,
                  c.name AS class_name, g.name AS group_name, u.full_name AS teacher_name, r.name AS room_name
           FROM timetable t
           JOIN lesson_slots s ON s.id = t.slot_id
           JOIN classes c ON c.id = t.class_id
           LEFT JOIN groups g ON g.id = t.group_id
           JOIN users u ON u.id = t.teacher_id
           JOIN rooms r ON r.id = t.room_id
           WHERE t.school_id = ? AND t.valid_to >= ?
             AND (? IS NULL OR t.class_id = ?) AND (? IS NULL OR t.teacher_id = ?)
           ORDER BY t.weekday, s.shift, s.number, c.name`
        )
        .all(req.user.school_id, today, classId, classId, teacherId, teacherId)
    );
  });

  // Jadvaldagi to'qnashuvlar: bir vaqtda bitta o'qituvchi, xona yoki sinf ikki joyda bo'lmasligi kerak.
  // Bir sinfning turli guruhlari bir vaqtda turli darsda bo'lishi mumkin.
  const findConflict = (e, exceptId) => {
    const rows = db
      .prepare(
        `SELECT t.*, c.name AS class_name, u.full_name AS teacher_name, r.name AS room_name
         FROM timetable t JOIN classes c ON c.id = t.class_id JOIN users u ON u.id = t.teacher_id JOIN rooms r ON r.id = t.room_id
         WHERE t.school_id = ? AND t.weekday = ? AND t.slot_id = ? AND t.id IS NOT ?
           AND t.valid_from <= ? AND t.valid_to >= ?`
      )
      .all(e.school_id, e.weekday, e.slot_id, exceptId ?? null, e.valid_to, e.valid_from);
    for (const o of rows) {
      if (o.teacher_id === e.teacher_id) return `${o.teacher_name} bu vaqtda ${o.class_name} sinfida dars o'tadi`;
      if (o.room_id === e.room_id) return `${o.room_name} xonasi bu vaqtda ${o.class_name} sinfi bilan band`;
      if (o.class_id === e.class_id && (!o.group_id || !e.group_id || o.group_id === e.group_id)) {
        return `${o.class_name} sinfida bu vaqtda boshqa dars bor`;
      }
    }
    return null;
  };

  const checkEntry = (body, school, base = {}) => {
    const today = nowTashkent().date;
    const e = { ...base, ...body, school_id: school };
    e.weekday = Number(e.weekday);
    if (!Number.isInteger(e.weekday) || e.weekday < 1 || e.weekday > 6) throw new HttpError(400, 'Hafta kuni 1 (dushanba) dan 6 (shanba) gacha');
    e.subject = str(e.subject, 80);
    if (!e.subject) throw new HttpError(400, 'Fan nomini kiriting');
    const slot = own('lesson_slots', Number(e.slot_id), school);
    const cls = own('classes', Number(e.class_id), school);
    if (slot.shift !== cls.shift) throw new HttpError(400, `${cls.name} sinfi ${cls.shift}-smenada o'qiydi`);
    e.slot_id = slot.id;
    e.class_id = cls.id;
    e.group_id = id(e.group_id);
    if (e.group_id && ownGroup(e.group_id, school).class_id !== cls.id) throw new HttpError(400, 'Guruh bu sinfga tegishli emas');
    const teacher = ownTeacher(Number(e.teacher_id), school);
    if (!teacher.is_active) throw new HttpError(400, 'O\'qituvchi faol emas');
    e.teacher_id = teacher.id;
    e.room_id = own('rooms', Number(e.room_id), school).id;
    e.valid_from = e.valid_from || today;
    e.valid_to = e.valid_to || schoolYearEnd(today);
    if (!isDate(e.valid_from) || !isDate(e.valid_to) || e.valid_from > e.valid_to) throw new HttpError(400, 'Amal qilish muddati noto\'g\'ri');
    return e;
  };

  const FIELDS = ['weekday', 'slot_id', 'class_id', 'group_id', 'subject', 'teacher_id', 'room_id', 'valid_from', 'valid_to'];
  const pick = (e) => Object.fromEntries(FIELDS.map((f) => [f, e[f]]));

  r.post('/timetable', (req, res) => {
    const e = checkEntry(req.body, req.user.school_id);
    const conflict = findConflict(e, null);
    if (conflict) throw new HttpError(409, conflict);
    const result = db
      .prepare(
        `INSERT INTO timetable (school_id, weekday, slot_id, class_id, group_id, subject, teacher_id, room_id, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(e.school_id, e.weekday, e.slot_id, e.class_id, e.group_id, e.subject, e.teacher_id, e.room_id, e.valid_from, e.valid_to);
    log(req, 'timetable.create', 'timetable', result.lastInsertRowid, undefined, pick(e));
    res.status(201).json({ id: result.lastInsertRowid });
  });

  r.put('/timetable/:id', (req, res) => {
    const old = own('timetable', Number(req.params.id), req.user.school_id);
    const e = checkEntry(pick({ ...old, ...req.body }), req.user.school_id);
    const conflict = findConflict(e, old.id);
    if (conflict) throw new HttpError(409, conflict);
    db.prepare(
      `UPDATE timetable SET weekday = ?, slot_id = ?, class_id = ?, group_id = ?, subject = ?, teacher_id = ?, room_id = ?,
              valid_from = ?, valid_to = ? WHERE id = ?`
    ).run(e.weekday, e.slot_id, e.class_id, e.group_id, e.subject, e.teacher_id, e.room_id, e.valid_from, e.valid_to, old.id);
    log(req, 'timetable.update', 'timetable', old.id, pick(old), pick(e));
    res.json({ ok: true });
  });

  // Darsni jadvaldan olib tashlash. O'tib ketgan darslar tarixi saqlanishi uchun,
  // agar bu jadval bo'yicha dars o'tilgan bo'lsa, yozuv o'chirilmaydi, faqat muddati yopiladi.
  r.delete('/timetable/:id', (req, res) => {
    const t = own('timetable', Number(req.params.id), req.user.school_id);
    const last = db.prepare('SELECT MAX(date) d FROM lessons WHERE timetable_id = ?').get(t.id).d;
    tx(db, () => {
      if (last) {
        const end = [last, addDays(nowTashkent().date, -1)].sort().at(-1);
        db.prepare('UPDATE timetable SET valid_to = ? WHERE id = ?').run(end, t.id);
        db.prepare('DELETE FROM timetable_overrides WHERE timetable_id = ? AND date > ?').run(t.id, end);
      } else {
        db.prepare('DELETE FROM timetable_overrides WHERE timetable_id = ?').run(t.id);
        db.prepare('DELETE FROM timetable WHERE id = ?').run(t.id);
      }
      log(req, 'timetable.remove', 'timetable', t.id, pick(t), undefined);
    });
    res.json({ ok: true });
  });

  // ---------- Bir martalik o'zgarishlar (A-7) ----------
  r.get('/overrides', (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : nowTashkent().date;
    res.json(
      db
        .prepare(
          `SELECT o.id, o.date, o.type, o.timetable_id, o.new_teacher_id, o.new_room_id,
                  t.subject, c.name AS class_name, s.number AS slot_number, s.start_time,
                  u.full_name AS teacher_name, nu.full_name AS new_teacher_name, nr.name AS new_room_name
           FROM timetable_overrides o
           JOIN timetable t ON t.id = o.timetable_id
           JOIN classes c ON c.id = t.class_id
           JOIN lesson_slots s ON s.id = t.slot_id
           JOIN users u ON u.id = t.teacher_id
           LEFT JOIN users nu ON nu.id = o.new_teacher_id
           LEFT JOIN rooms nr ON nr.id = o.new_room_id
           WHERE t.school_id = ? AND o.date >= ?
           ORDER BY o.date, s.number`
        )
        .all(req.user.school_id, from)
    );
  });

  r.post('/overrides', (req, res) => {
    const t = own('timetable', Number(req.body?.timetable_id), req.user.school_id);
    const { date, type } = req.body || {};
    if (!isDate(date)) throw new HttpError(400, 'Sana noto\'g\'ri');
    if (date < nowTashkent().date) throw new HttpError(400, 'O\'tgan sana uchun o\'zgartirib bo\'lmaydi');
    if (!['cancel', 'substitute', 'room'].includes(type)) throw new HttpError(400, 'O\'zgarish turi noto\'g\'ri');
    if (date < t.valid_from || date > t.valid_to || (new Date(`${date}T00:00:00Z`).getUTCDay() || 7) !== t.weekday) {
      throw new HttpError(400, 'Bu dars shu sanada jadvalda yo\'q');
    }
    if (db.prepare('SELECT 1 FROM lessons WHERE timetable_id = ? AND date = ?').get(t.id, date)) {
      throw new HttpError(409, 'Bu dars allaqachon boshlangan');
    }

    let newTeacher = null;
    let newRoom = null;
    if (type === 'substitute') {
      newTeacher = ownTeacher(Number(req.body.new_teacher_id), req.user.school_id);
      if (newTeacher.id === t.teacher_id) throw new HttpError(400, 'Boshqa o\'qituvchini tanlang');
      const busy = effectiveLessons(db, { schoolId: req.user.school_id, teacherId: newTeacher.id, date })
        .find((l) => l.slot_id === t.slot_id);
      if (busy) throw new HttpError(409, `${newTeacher.full_name} bu vaqtda ${busy.class_name} sinfida dars o'tadi`);
    }
    if (type === 'room') newRoom = own('rooms', Number(req.body.new_room_id), req.user.school_id);

    const result = db
      .prepare(
        `INSERT INTO timetable_overrides (timetable_id, date, type, new_teacher_id, new_room_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (timetable_id, date, type) DO UPDATE SET new_teacher_id = excluded.new_teacher_id, new_room_id = excluded.new_room_id`
      )
      .run(t.id, date, type, newTeacher?.id ?? null, newRoom?.id ?? null, req.user.id);
    log(req, 'override.set', 'timetable', t.id, undefined, { date, type, new_teacher_id: newTeacher?.id, new_room_id: newRoom?.id });
    res.status(201).json({ id: result.lastInsertRowid });
  });

  r.delete('/overrides/:id', (req, res) => {
    const o = db
      .prepare('SELECT o.* FROM timetable_overrides o JOIN timetable t ON t.id = o.timetable_id WHERE o.id = ? AND t.school_id = ?')
      .get(Number(req.params.id), req.user.school_id);
    if (!o) throw new HttpError(404, 'Topilmadi');
    if (db.prepare('SELECT 1 FROM lessons WHERE timetable_id = ? AND date = ?').get(o.timetable_id, o.date)) {
      throw new HttpError(409, 'Dars boshlangan, o\'zgarishni bekor qilib bo\'lmaydi');
    }
    db.prepare('DELETE FROM timetable_overrides WHERE id = ?').run(o.id);
    log(req, 'override.remove', 'timetable', o.timetable_id, { date: o.date, type: o.type }, undefined);
    res.json({ ok: true });
  });

  // ---------- Davomat tarixi (A-8) ----------
  // Kun bo'yicha barcha darslar: davomat olingan, boshlanmagan yoki kechikayotgan.
  r.get('/attendance', (req, res) => {
    const now = nowTashkent();
    const date = isDate(req.query.date) ? req.query.date : now.date;
    const classId = id(req.query.class_id);
    const rows = effectiveLessons(db, { schoolId: req.user.school_id, date }).filter((l) => !classId || l.class_id === classId);
    const lessonOf = db.prepare(
      `SELECT l.id, l.mode, l.started_at, l.room_change_reason, l.teacher_id, u.full_name AS teacher_name, r.name AS room_name,
              a.expected_count, a.teacher_count, a.is_suspicious,
              cs.status AS camera_status, cs.camera_count, cs.error AS camera_error
       FROM lessons l JOIN users u ON u.id = l.teacher_id JOIN rooms r ON r.id = l.room_id
       LEFT JOIN attendance a ON a.lesson_id = l.id
       LEFT JOIN counting_sessions cs ON cs.lesson_id = l.id
       WHERE l.timetable_id = ? AND l.date = ?`
    );
    const absentOf = db.prepare(
      `SELECT st.full_name, ab.type FROM lessons l JOIN attendance a ON a.lesson_id = l.id
       JOIN absences ab ON ab.attendance_id = a.id JOIN students st ON st.id = ab.student_id
       WHERE l.id = ? ORDER BY st.full_name`
    );
    res.json({
      date,
      lessons: rows.map((r) => {
        const lesson = lessonOf.get(r.timetable_id, date) || null;
        let status;
        if (lesson?.teacher_count != null) status = 'done';
        else if (lesson) status = 'started';
        else if (date < now.date || (date === now.date && now.minutes > toMinutes(r.start_time) + 10)) status = 'missed';
        else status = 'upcoming';
        return { ...r, status, lesson, absences: lesson ? absentOf.all(lesson.id) : [] };
      }),
    });
  });

  r.get('/lessons/:id', (req, res) => {
    const details = lessonDetails(db, Number(req.params.id));
    if (!details || details.school_id !== req.user.school_id) throw new HttpError(404, 'Dars topilmadi');
    res.json(details);
  });

  // Dars tugagandan keyingi tuzatish faqat admin tomonidan, sababi bilan.
  r.put('/lessons/:id/attendance', (req, res) => {
    res.json(
      saveAttendance(db, req.user, {
        lessonId: Number(req.params.id),
        absences: req.body?.absences,
        reason: req.body?.reason,
        ip: req.ip,
        byAdmin: true,
      })
    );
  });

  // O'zgarishlar tarixi (X-4).
  r.get('/audit', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.old_value, a.new_value, a.created_at, u.full_name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.school_id = ? ORDER BY a.id DESC LIMIT 200`
        )
        .all(req.user.school_id)
    );
  });

  return r;
}
