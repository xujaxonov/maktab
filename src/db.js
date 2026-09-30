// Ma'lumotlar bazasi: sxema va yordamchi funksiyalar.
// MVP uchun Node'ning ichki SQLite'i ishlatiladi; keyingi bosqichlarda PostgreSQL'ga o'tiladi (TZ 10-bo'lim).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  shifts_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  school_id INTEGER REFERENCES schools(id),
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'admin', 'teacher')),
  full_name TEXT NOT NULL,
  phone TEXT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  shift INTEGER NOT NULL DEFAULT 1,
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  name TEXT NOT NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_groups (
  student_id INTEGER NOT NULL REFERENCES students(id),
  group_id INTEGER NOT NULL REFERENCES groups(id),
  PRIMARY KEY (student_id, group_id)
);

CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY,
  telegram_id INTEGER UNIQUE,
  full_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Har bir o'quvchi uchun ota-onani botga ulash kodi (B-1). parent_id kod ishlatilganda to'ldiriladi.
CREATE TABLE IF NOT EXISTS parent_links (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id),
  link_code TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES parents(id),
  linked_at TEXT
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  has_camera INTEGER NOT NULL DEFAULT 0,
  UNIQUE (school_id, name)
);

-- Qo'ng'iroq jadvali: dars raqami va vaqti ("HH:MM"), smena bo'yicha.
CREATE TABLE IF NOT EXISTS lesson_slots (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  shift INTEGER NOT NULL DEFAULT 1,
  number INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  UNIQUE (school_id, shift, number)
);

-- Haftalik jadval. weekday: 1 = dushanba ... 6 = shanba.
CREATE TABLE IF NOT EXISTS timetable (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 6),
  slot_id INTEGER NOT NULL REFERENCES lesson_slots(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  group_id INTEGER REFERENCES groups(id),
  subject TEXT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL
);

-- Bir martalik o'zgarishlar (A-7): type = cancel | substitute | room.
CREATE TABLE IF NOT EXISTS timetable_overrides (
  id INTEGER PRIMARY KEY,
  timetable_id INTEGER NOT NULL REFERENCES timetable(id),
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cancel', 'substitute', 'room')),
  new_teacher_id INTEGER REFERENCES users(id),
  new_room_id INTEGER REFERENCES rooms(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  UNIQUE (timetable_id, date, type)
);

-- Aniq bir kundagi dars. O'qituvchi, xona, sinf va fan o'sha kundagi holatda saqlanadi,
-- jadval keyinroq o'zgarsa ham tarix buzilmaydi.
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY,
  timetable_id INTEGER NOT NULL REFERENCES timetable(id),
  date TEXT NOT NULL,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  group_id INTEGER REFERENCES groups(id),
  subject TEXT NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  room_change_reason TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('camera', 'manual')),
  started_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  UNIQUE (timetable_id, date)
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  lesson_id INTEGER NOT NULL UNIQUE REFERENCES lessons(id),
  expected_count INTEGER NOT NULL,
  teacher_count INTEGER NOT NULL,
  camera_count INTEGER,
  difference INTEGER,
  is_suspicious INTEGER NOT NULL DEFAULT 0,
  confirmed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- type: sababsiz | sababli | kechikdi | tadbirda
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY,
  attendance_id INTEGER NOT NULL REFERENCES attendance(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  type TEXT NOT NULL CHECK (type IN ('sababsiz', 'sababli', 'kechikdi', 'tadbirda')),
  UNIQUE (attendance_id, student_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES parents(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  lesson_id INTEGER REFERENCES lessons(id),
  channel TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  school_id INTEGER REFERENCES schools(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Davomat yozuvlari va o'zgarishlar tarixini hech kim o'chira olmaydi (TZ 8-bo'lim).
CREATE TRIGGER IF NOT EXISTS attendance_no_delete BEFORE DELETE ON attendance
BEGIN SELECT RAISE(ABORT, 'Davomat yozuvini o''chirib bo''lmaydi'); END;
CREATE TRIGGER IF NOT EXISTS lessons_no_delete BEFORE DELETE ON lessons
BEGIN SELECT RAISE(ABORT, 'Dars yozuvini o''chirib bo''lmaydi'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit yozuvini o''chirib bo''lmaydi'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit yozuvini o''zgartirib bo''lmaydi'); END;

CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable (teacher_id, weekday);
CREATE INDEX IF NOT EXISTS idx_timetable_school ON timetable (school_id, weekday);
CREATE INDEX IF NOT EXISTS idx_lessons_school_date ON lessons (school_id, date);
CREATE INDEX IF NOT EXISTS idx_students_class ON students (class_id);
`;

export function openDb(path = process.env.DB_PATH || 'data/smartdavomat.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

// Bir nechta yozuvni bitta tranzaksiyada bajarish.
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function audit(db, { userId, schoolId, action, entity, entityId, oldValue, newValue, ip }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, school_id, action, entity, entity_id, old_value, new_value, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId ?? null,
    schoolId ?? null,
    action,
    entity,
    entityId ?? null,
    oldValue === undefined ? null : JSON.stringify(oldValue),
    newValue === undefined ? null : JSON.stringify(newValue),
    ip ?? null
  );
}
