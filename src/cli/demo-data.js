// Sinov uchun namuna maktab: admin, 3 o'qituvchi, 2 sinf, xonalar, qo'ng'iroqlar va haftalik jadval.
// Barcha parollar "demo1234", parol almashtirish so'ralmaydi. Faqat sinov uchun!
import { openDb, tx } from '../db.js';
import { hashPassword } from '../auth.js';
import { nowTashkent } from '../time.js';

const db = openDb();
if (db.prepare("SELECT 1 FROM users WHERE login = 'demo_admin'").get()) {
  console.log('Namuna ma\'lumotlar allaqachon bor. Loginlar: demo_admin, demo_karimova, demo_toshmatov, demo_yusupova. Parol: demo1234');
  process.exit(0);
}

const hash = hashPassword('demo1234');
const today = nowTashkent().date;
const [y, m] = today.split('-').map(Number);
const yearEnd = `${m >= 7 ? y + 1 : y}-06-30`;

tx(db, () => {
  const school = db.prepare("INSERT INTO schools (name) VALUES ('Namuna maktab (demo)')").run().lastInsertRowid;
  const user = db.prepare(
    'INSERT INTO users (school_id, role, full_name, login, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 0)'
  );
  user.run(school, 'admin', 'Demo Admin', 'demo_admin', hash);
  const teachers = [
    ['Karimova Dilnoza', 'demo_karimova', 'Matematika'],
    ['Toshmatov Bekzod', 'demo_toshmatov', 'Ona tili'],
    ['Yusupova Malika', 'demo_yusupova', 'Ingliz tili'],
  ].map(([name, login, subject]) => ({ id: user.run(school, 'teacher', name, login, hash).lastInsertRowid, subject }));

  // 101 va 102 xonalarda kamera bor (NVR kanallari 1 va 2), 201 da yo'q.
  const rooms = ['101', '102', '201'].map((n, i) => {
    const room = db.prepare('INSERT INTO rooms (school_id, name, has_camera) VALUES (?, ?, ?)').run(school, n, i < 2 ? 1 : 0).lastInsertRowid;
    if (i < 2) db.prepare('INSERT INTO cameras (school_id, room_id, channel) VALUES (?, ?, ?)').run(school, room, String(i + 1));
    return room;
  });

  // Slotlar 07:00 dan 19:40 gacha: istalgan vaqtda sinab ko'rish uchun kun davomida darslar bor.
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const start = 7 * 60 + i * 65;
    const fmt = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    slots.push(
      db
        .prepare('INSERT INTO lesson_slots (school_id, shift, number, start_time, end_time) VALUES (?, 1, ?, ?, ?)')
        .run(school, i + 1, fmt(start), fmt(start + 45)).lastInsertRowid
    );
  }

  const classes = ['5-A', '5-B'].map((name) => db.prepare('INSERT INTO classes (school_id, name, shift) VALUES (?, ?, 1)').run(school, name).lastInsertRowid);
  const names = [
    'Aliyev Ali', 'Botirova Sevara', 'Valiyev Jasur', 'G\'aniyeva Nilufar', 'Davronov Sardor',
    'Ergasheva Madina', 'Fayzullayev Temur', 'Hasanova Zarina', 'Ismoilov Doston', 'Jo\'rayeva Kamola',
  ];
  const addStudent = db.prepare('INSERT INTO students (school_id, class_id, full_name) VALUES (?, ?, ?)');
  for (const [ci, cls] of classes.entries()) {
    for (const n of names) addStudent.run(school, cls, ci === 0 ? n : n.split(' ').reverse().join(' '));
  }

  // Har kuni har bir o'qituvchida navbatma-navbat darslar: 5-A va 5-B.
  const add = db.prepare(
    `INSERT INTO timetable (school_id, weekday, slot_id, class_id, subject, teacher_id, room_id, valid_from, valid_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let wd = 1; wd <= 6; wd++) {
    for (const [si, slot] of slots.entries()) {
      for (const [ci, cls] of classes.entries()) {
        const t = teachers[(si + ci + wd) % teachers.length];
        add.run(school, wd, slot, cls, t.subject, t.id, rooms[ci], today, yearEnd);
      }
    }
  }
});

console.log('Namuna maktab yaratildi. Parol hammasi uchun: demo1234');
console.log('  Admin:       demo_admin');
console.log('  O\'qituvchi:  demo_karimova, demo_toshmatov, demo_yusupova');
