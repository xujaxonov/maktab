// Darslar va davomatning asosiy mantig'i (TZ 5.2 va 6-bo'lim).
import { audit, tx } from './db.js';
import { nowTashkent, weekdayOf, toMinutes, tashkentToIso } from './time.js';

// Darsni boshlash oynasi (O-3): boshlanishidan 5 daqiqa oldin, boshlangandan 15 daqiqa keyingacha.
export const START_BEFORE_MIN = 5;
export const START_AFTER_MIN = 15;

// Sinov rejimi: ALLOW_ANY_TIME=1 bo'lsa, darsni istalgan vaqtda boshlash va tahrirlash mumkin.
const allowAnyTime = () => process.env.ALLOW_ANY_TIME === '1';

// O'qituvchi yo'q deb belgilaganda "darsda emas" hisoblanadigan turlar. "kechikdi" = darsda bor.
const NOT_PRESENT = new Set(['sababsiz', 'sababli', 'tadbirda']);
export const ABSENCE_TYPES = ['sababsiz', 'sababli', 'kechikdi', 'tadbirda'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Berilgan sana uchun jadval yozuvlari, bir martalik o'zgarishlar hisobga olingan holda.
// Natijada teacher_id va room_id — o'sha kungi haqiqiy qiymatlar.
const EFFECTIVE_SQL = `
  SELECT t.id AS timetable_id, t.school_id, t.slot_id, t.class_id, t.group_id, t.subject,
         COALESCE(sub.new_teacher_id, t.teacher_id) AS teacher_id,
         COALESCE(rm.new_room_id, t.room_id) AS room_id,
         sub.id IS NOT NULL AS is_substitute,
         s.number AS slot_number, s.start_time, s.end_time, s.shift,
         c.name AS class_name, g.name AS group_name, r.name AS room_name, r.has_camera,
         u.full_name AS teacher_name
  FROM timetable t
  JOIN lesson_slots s ON s.id = t.slot_id
  JOIN classes c ON c.id = t.class_id
  LEFT JOIN groups g ON g.id = t.group_id
  LEFT JOIN timetable_overrides cancel ON cancel.timetable_id = t.id AND cancel.date = :date AND cancel.type = 'cancel'
  LEFT JOIN timetable_overrides sub ON sub.timetable_id = t.id AND sub.date = :date AND sub.type = 'substitute'
  LEFT JOIN timetable_overrides rm ON rm.timetable_id = t.id AND rm.date = :date AND rm.type = 'room'
  JOIN rooms r ON r.id = COALESCE(rm.new_room_id, t.room_id)
  JOIN users u ON u.id = COALESCE(sub.new_teacher_id, t.teacher_id)
  WHERE t.weekday = :weekday AND t.valid_from <= :date AND t.valid_to >= :date AND cancel.id IS NULL
`;

export function effectiveLessons(db, { schoolId, teacherId, date }) {
  const sql = `SELECT * FROM (${EFFECTIVE_SQL} AND t.school_id = :schoolId)
               WHERE :teacherId IS NULL OR teacher_id = :teacherId
               ORDER BY shift, slot_number, class_name`;
  return db.prepare(sql).all({ date, weekday: weekdayOf(date), schoolId, teacherId: teacherId ?? null });
}

export function effectiveLesson(db, timetableId, date) {
  return db
    .prepare(EFFECTIVE_SQL + ' AND t.id = :id')
    .get({ date, weekday: weekdayOf(date), id: timetableId });
}

export function roster(db, classId, groupId) {
  if (groupId) {
    return db
      .prepare(
        `SELECT st.id, st.full_name FROM students st
         JOIN student_groups sg ON sg.student_id = st.id
         WHERE sg.group_id = ? AND st.is_active = 1 ORDER BY st.full_name`
      )
      .all(groupId);
  }
  return db
    .prepare('SELECT id, full_name FROM students WHERE class_id = ? AND is_active = 1 ORDER BY full_name')
    .all(classId);
}

// O'qituvchining bir kunlik darslari, har biri holati bilan: kutilmoqda, boshlangan, davomat olingan.
export function teacherDay(db, user, date) {
  const now = nowTashkent();
  const rows = effectiveLessons(db, { schoolId: user.school_id, teacherId: user.id, date });
  const findLesson = db.prepare(
    `SELECT l.id, l.room_id, l.mode, l.ends_at, a.expected_count, a.teacher_count
     FROM lessons l LEFT JOIN attendance a ON a.lesson_id = l.id
     WHERE l.timetable_id = ? AND l.date = ?`
  );
  return rows.map((r) => {
    const lesson = findLesson.get(r.timetable_id, date) || null;
    const start = toMinutes(r.start_time);
    const canStart =
      !lesson &&
      date === now.date &&
      (allowAnyTime() || (now.minutes >= start - START_BEFORE_MIN && now.minutes <= start + START_AFTER_MIN));
    return { ...r, lesson, can_start: canStart };
  });
}

// "Darsni boshladim" (O-3). Takror bosilsa, mavjud dars qaytariladi.
export function startLesson(db, user, { timetableId, date, roomId, reason, ip }) {
  const now = nowTashkent();
  const eff = effectiveLesson(db, timetableId, date);
  if (!eff || eff.school_id !== user.school_id || eff.teacher_id !== user.id) {
    throw new HttpError(404, 'Bu dars sizning jadvalingizda yo\'q');
  }

  const existing = db.prepare('SELECT * FROM lessons WHERE timetable_id = ? AND date = ?').get(timetableId, date);
  if (existing) return existing;

  if (date !== now.date) throw new HttpError(400, 'Faqat bugungi darsni boshlash mumkin');
  const start = toMinutes(eff.start_time);
  if (!allowAnyTime()) {
    if (now.minutes < start - START_BEFORE_MIN) throw new HttpError(400, 'Dars hali boshlanmagan');
    if (now.minutes > start + START_AFTER_MIN) {
      throw new HttpError(400, 'Darsni boshlash vaqti o\'tib ketdi. Adminga murojaat qiling');
    }
  }

  let finalRoom = eff.room_id;
  let roomReason = null;
  if (roomId && Number(roomId) !== eff.room_id) {
    const room = db.prepare('SELECT id FROM rooms WHERE id = ? AND school_id = ?').get(roomId, user.school_id);
    if (!room) throw new HttpError(400, 'Xona topilmadi');
    if (!reason || !String(reason).trim()) throw new HttpError(400, 'Xonani o\'zgartirish sababini yozing');
    finalRoom = room.id;
    roomReason = String(reason).trim().slice(0, 300);
  }

  return tx(db, () => {
    // 1-bosqichda kamera ulanmagan, shuning uchun barcha darslar qo'lda rejimda (O-8).
    const result = db
      .prepare(
        `INSERT INTO lessons (timetable_id, date, school_id, teacher_id, class_id, group_id, subject,
                              room_id, room_change_reason, mode, started_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`
      )
      .run(
        timetableId,
        date,
        user.school_id,
        user.id,
        eff.class_id,
        eff.group_id,
        eff.subject,
        finalRoom,
        roomReason,
        new Date().toISOString(),
        tashkentToIso(date, eff.end_time)
      );
    const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(result.lastInsertRowid);
    audit(db, {
      userId: user.id,
      schoolId: user.school_id,
      action: 'lesson.start',
      entity: 'lesson',
      entityId: lesson.id,
      newValue: { room_id: finalRoom, room_change_reason: roomReason },
      ip,
    });
    return lesson;
  });
}

export function lessonDetails(db, lessonId) {
  const lesson = db
    .prepare(
      `SELECT l.*, c.name AS class_name, g.name AS group_name, r.name AS room_name,
              u.full_name AS teacher_name, s.number AS slot_number, s.start_time, s.end_time
       FROM lessons l
       JOIN classes c ON c.id = l.class_id
       LEFT JOIN groups g ON g.id = l.group_id
       JOIN rooms r ON r.id = l.room_id
       JOIN users u ON u.id = l.teacher_id
       JOIN timetable t ON t.id = l.timetable_id
       JOIN lesson_slots s ON s.id = t.slot_id
       WHERE l.id = ?`
    )
    .get(lessonId);
  if (!lesson) return null;
  const attendance = db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').get(lessonId) || null;
  const absences = attendance
    ? db
        .prepare(
          `SELECT a.student_id, a.type, st.full_name FROM absences a
           JOIN students st ON st.id = a.student_id WHERE a.attendance_id = ? ORDER BY st.full_name`
        )
        .all(attendance.id)
    : [];
  return { ...lesson, attendance, absences, students: roster(db, lesson.class_id, lesson.group_id) };
}

// Davomatni saqlash (O-5, O-7). absences: [{ student_id, type }]. Bo'sh ro'yxat = "Hamma bor".
// byAdmin: dars tugagandan keyin faqat admin tuzatadi va sababini yozadi (TZ 4-bo'lim).
export function saveAttendance(db, user, { lessonId, absences, reason, ip, byAdmin = false }) {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson || lesson.school_id !== user.school_id) throw new HttpError(404, 'Dars topilmadi');
  if (!byAdmin && lesson.teacher_id !== user.id) throw new HttpError(403, 'Bu dars sizniki emas');
  if (!byAdmin && !allowAnyTime() && new Date().toISOString() > lesson.ends_at) {
    throw new HttpError(403, 'Dars tugagan. Tuzatishni maktab admini qiladi');
  }
  if (byAdmin && (!reason || !String(reason).trim())) throw new HttpError(400, 'Tuzatish sababini yozing');
  if (!Array.isArray(absences)) throw new HttpError(400, 'absences ro\'yxat bo\'lishi kerak');

  const students = roster(db, lesson.class_id, lesson.group_id);
  const known = new Set(students.map((s) => s.id));
  const next = new Map();
  for (const a of absences) {
    const id = Number(a?.student_id);
    if (!known.has(id)) throw new HttpError(400, `O'quvchi ro'yxatda yo'q: ${a?.student_id}`);
    if (!ABSENCE_TYPES.includes(a.type)) throw new HttpError(400, `Noto'g'ri tur: ${a.type}`);
    next.set(id, a.type);
  }

  const expected = students.length;
  const teacherCount = expected - [...next.values()].filter((t) => NOT_PRESENT.has(t)).length;
  const nowIso = new Date().toISOString();

  return tx(db, () => {
    let att = db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').get(lessonId);
    const isNew = !att;
    const prev = new Map();
    if (att) {
      for (const row of db.prepare('SELECT student_id, type FROM absences WHERE attendance_id = ?').all(att.id)) {
        prev.set(row.student_id, row.type);
      }
      db.prepare('UPDATE attendance SET expected_count = ?, teacher_count = ?, updated_at = ? WHERE id = ?').run(
        expected,
        teacherCount,
        nowIso,
        att.id
      );
      db.prepare('DELETE FROM absences WHERE attendance_id = ?').run(att.id);
    } else {
      const r = db
        .prepare(
          `INSERT INTO attendance (lesson_id, expected_count, teacher_count, confirmed_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(lessonId, expected, teacherCount, nowIso, nowIso);
      att = { id: r.lastInsertRowid };
    }

    const insert = db.prepare('INSERT INTO absences (attendance_id, student_id, type) VALUES (?, ?, ?)');
    for (const [studentId, type] of next) insert.run(att.id, studentId, type);

    audit(db, {
      userId: user.id,
      schoolId: user.school_id,
      action: byAdmin ? 'attendance.admin_fix' : isNew ? 'attendance.create' : 'attendance.update',
      entity: 'attendance',
      entityId: att.id,
      oldValue: Object.fromEntries(prev),
      newValue: { absences: Object.fromEntries(next), teacher_count: teacherCount, reason: reason || undefined },
      ip,
    });

    queueNotifications(db, lesson, prev, next);
    return lessonDetails(db, lessonId);
  });
}

// Ota-onaga xabarlar faqat o'qituvchi belgilagandan keyin navbatga qo'yiladi (TZ 6-bo'lim).
// Xabar faqat holat o'zgarganda ketadi: yangi "sababsiz", "kechikib keldi" yoki xato belgi tuzatilganda.
function queueNotifications(db, lesson, prev, next) {
  const info = db
    .prepare(
      `SELECT s.number, s.start_time FROM timetable t JOIN lesson_slots s ON s.id = t.slot_id WHERE t.id = ?`
    )
    .get(lesson.timetable_id);
  const studentIds = new Set([...prev.keys(), ...next.keys()]);
  const nameOf = db.prepare('SELECT full_name FROM students WHERE id = ?');
  const parentsOf = db.prepare(
    `SELECT p.id, p.telegram_id FROM parent_links pl JOIN parents p ON p.id = pl.parent_id
     WHERE pl.student_id = ? AND pl.parent_id IS NOT NULL`
  );
  const insert = db.prepare(
    `INSERT INTO notifications (parent_id, student_id, lesson_id, channel, text, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const where = `${info.number}-dars (${lesson.subject}, ${info.start_time})`;

  for (const id of studentIds) {
    const before = prev.get(id);
    const after = next.get(id);
    if (before === after) continue;
    const name = nameOf.get(id).full_name;
    let text = null;
    if (after === 'sababsiz' && before === undefined) {
      text = `Farzandingiz ${name} bugun ${where} darsiga kelmadi.`;
    } else if (after === 'kechikdi' && before === 'sababsiz') {
      text = `Farzandingiz ${name} ${where} darsiga kechikib keldi.`;
    } else if (after === undefined && before === 'sababsiz') {
      text = `Tuzatish: farzandingiz ${name} ${where} darsida qatnashmoqda. Oldingi xabar xato edi.`;
    }
    if (!text) continue;

    const parents = parentsOf.all(id);
    if (parents.length === 0) {
      // Ota-ona botga ulanmagan. SMS 4-bosqichda qo'shiladi (B-6).
      insert.run(null, id, lesson.id, 'none', text, 'no_channel');
    }
    for (const p of parents) insert.run(p.id, id, lesson.id, 'telegram', text, 'pending');
  }
}
