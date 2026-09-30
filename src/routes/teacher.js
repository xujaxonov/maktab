// O'qituvchi ilovasi uchun API (O-2 ... O-8).
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { teacherDay, startLesson, lessonDetails, saveAttendance, HttpError } from '../lessons.js';
import { nowTashkent, isDate } from '../time.js';

export function teacherRoutes(db) {
  const r = Router();
  r.use(requireRole('teacher'));

  // Bir kunlik darslar. ?date=YYYY-MM-DD, bo'lmasa bugun.
  r.get('/lessons', (req, res) => {
    const date = req.query.date || nowTashkent().date;
    if (!isDate(date)) throw new HttpError(400, 'Sana noto\'g\'ri');
    res.json({ date, today: nowTashkent().date, lessons: teacherDay(db, req.user, date) });
  });

  // Xonani almashtirish uchun maktab xonalari ro'yxati.
  r.get('/rooms', (req, res) => {
    res.json(db.prepare('SELECT id, name FROM rooms WHERE school_id = ? ORDER BY name').all(req.user.school_id));
  });

  r.post('/lessons/start', (req, res) => {
    const { timetable_id, date, room_id, reason } = req.body || {};
    if (!isDate(date)) throw new HttpError(400, 'Sana noto\'g\'ri');
    const lesson = startLesson(db, req.user, {
      timetableId: Number(timetable_id),
      date,
      roomId: room_id ? Number(room_id) : null,
      reason,
      ip: req.ip,
    });
    res.json(lessonDetails(db, lesson.id));
  });

  r.get('/lessons/:id', (req, res) => {
    const details = lessonDetails(db, Number(req.params.id));
    if (!details || details.teacher_id !== req.user.id) throw new HttpError(404, 'Dars topilmadi');
    res.json(details);
  });

  r.put('/lessons/:id/attendance', (req, res) => {
    const details = saveAttendance(db, req.user, {
      lessonId: Number(req.params.id),
      absences: req.body?.absences,
      ip: req.ip,
    });
    res.json(details);
  });

  return r;
}
