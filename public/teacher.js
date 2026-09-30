// O'qituvchi ilovasi: bugungi darslar, darsni boshlash, davomat belgilash (O-2 ... O-8).
import { api, esc, toast, guard, modal, prettyDate, addDays, logout, ABSENCE_LABELS } from './common.js';

const view = document.getElementById('view');
document.getElementById('logout').addEventListener('click', guard(logout));

const me = await api('GET', '/api/auth/me');
if (me.role !== 'teacher') location.href = '/';
document.getElementById('who').textContent = `${me.full_name} · ${me.school?.name ?? ''}`;

let currentDate = null;

// ---------- Darslar ro'yxati ----------
async function showDay(date) {
  const data = await api('GET', `/api/teacher/lessons${date ? `?date=${date}` : ''}`);
  currentDate = data.date;
  const isToday = data.date === data.today;

  view.innerHTML = `
    <div class="day-nav">
      <button type="button" data-day="-1" aria-label="Oldingi kun">‹</button>
      <div class="date">${isToday ? 'Bugun, ' : ''}${esc(prettyDate(data.date))}</div>
      <button type="button" data-day="1" aria-label="Keyingi kun">›</button>
    </div>
    ${isToday ? '' : '<p class="row"><button type="button" class="btn-link" data-today>Bugunga qaytish</button></p>'}
    <div id="lessons"></div>`;

  view.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', guard(() => showDay(addDays(currentDate, Number(b.dataset.day)))))
  );
  view.querySelector('[data-today]')?.addEventListener('click', guard(() => showDay()));

  const list = view.querySelector('#lessons');
  if (!data.lessons.length) {
    list.innerHTML = '<div class="card muted">Bu kunda darsingiz yo\'q.</div>';
    return;
  }

  for (const l of data.lessons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card lesson-card' + (l.can_start ? ' now' : '');
    let status;
    if (l.lesson?.teacher_count != null) {
      status = `<span class="badge badge-ok">Davomat olindi: ${l.lesson.teacher_count}/${l.lesson.expected_count}</span>`;
    } else if (l.lesson) status = '<span class="badge badge-warn">Boshlangan, davomat belgilanmagan</span>';
    else if (l.can_start) status = '<span class="badge badge-info">Boshlash mumkin</span>';
    else status = '';
    btn.innerHTML = `
      <div class="row"><span class="time">${esc(l.slot_number)}-dars · ${esc(l.start_time)}–${esc(l.end_time)}</span>
        ${l.is_substitute ? '<span class="badge badge-warn">Almashtirish</span>' : ''}</div>
      <div class="title">${esc(l.class_name)}${l.group_name ? ` (${esc(l.group_name)})` : ''} · ${esc(l.subject)}</div>
      <div class="muted small">Xona: ${esc(l.room_name)}</div>
      <div>${status}</div>`;
    btn.addEventListener('click', guard(() => openLesson(l)));
    list.append(btn);
  }
}

async function openLesson(l) {
  if (l.lesson) return showAttendance(await api('GET', `/api/teacher/lessons/${l.lesson.id}`));
  if (!l.can_start) {
    toast('Darsni faqat boshlanishidan 5 daqiqa oldin va 15 daqiqa keyingacha boshlash mumkin', true);
    return;
  }
  confirmStart(l);
}

// ---------- "Darsni boshladim" (O-3) ----------
async function confirmStart(l) {
  const rooms = await api('GET', '/api/teacher/rooms');
  const m = modal(`
    <h2>${esc(l.class_name)} · ${esc(l.subject)}</h2>
    <p class="muted">${esc(l.slot_number)}-dars, ${esc(l.start_time)}</p>
    <div class="field">
      <label for="room">Xona</label>
      <select id="room">${rooms.map((r) => `<option value="${r.id}" ${r.id === l.room_id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    </div>
    <div class="field hidden" id="reason-field">
      <label for="reason">Xona nega o'zgardi?</label>
      <input id="reason" placeholder="Masalan: 101-xona ta'mirda">
    </div>
    <footer>
      <button type="button" data-close>Bekor qilish</button>
      <button type="button" class="btn-primary" id="go">Darsni boshladim</button>
    </footer>`);
  const room = m.el.querySelector('#room');
  room.addEventListener('change', () => {
    m.el.querySelector('#reason-field').classList.toggle('hidden', Number(room.value) === l.room_id);
  });
  m.el.querySelector('#go').addEventListener(
    'click',
    guard(async () => {
      const details = await api('POST', '/api/teacher/lessons/start', {
        timetable_id: l.timetable_id,
        date: currentDate,
        room_id: Number(room.value),
        reason: m.el.querySelector('#reason').value,
      });
      m.close();
      showAttendance(details);
    })
  );
}

// ---------- Davomat belgilash (O-5, O-7, O-8) ----------
function showAttendance(lesson) {
  // Hozirgi belgilar: student_id -> tur. Belgilanmagan = darsda bor.
  const marks = new Map(lesson.absences.map((a) => [a.student_id, a.type]));
  const saved = !!lesson.attendance;
  const total = lesson.students.length;

  view.innerHTML = `
    <p><button type="button" class="btn-link" id="back">‹ Darslar</button></p>
    <h2>${esc(lesson.class_name)}${lesson.group_name ? ` (${esc(lesson.group_name)})` : ''} · ${esc(lesson.subject)}</h2>
    <p class="muted small">${esc(lesson.slot_number)}-dars · Xona ${esc(lesson.room_name)} ·
      ${lesson.mode === 'manual' ? 'Qo\'lda davomat (kamerasiz)' : 'Kamera'}</p>
    ${saved ? `<p class="notice small">Davomat saqlangan. Dars tugaguncha o'zgartirishingiz mumkin.</p>` : ''}
    <p class="muted small">Darsda yo'q o'quvchini bosing. Qaytadan bossangiz, "bor" bo'ladi.</p>
    <div class="card" id="students"></div>
    <div class="bottom-bar"><div class="inner"><button type="button" class="btn-primary btn-big" id="save"></button></div></div>`;

  view.querySelector('#back').addEventListener('click', guard(() => showDay(currentDate)));
  const box = view.querySelector('#students');
  const save = view.querySelector('#save');

  if (!total) box.innerHTML = '<p class="muted">Ro\'yxatda o\'quvchi yo\'q. Maktab adminiga murojaat qiling.</p>';

  const refresh = () => {
    const away = [...marks.values()].filter((t) => t !== 'kechikdi').length;
    save.textContent = marks.size === 0 ? `Hamma bor (${total})` : `Saqlash: ${total - away} bor, ${away} yo'q`;
  };

  for (const s of lesson.students) {
    const row = document.createElement('div');
    row.className = 'student';
    row.innerHTML = `<span class="mark"></span><span class="name">${esc(s.full_name)}</span>
      <select aria-label="Sabab" class="hidden">${Object.entries(ABSENCE_LABELS)
        .map(([k, v]) => `<option value="${k}">${v}</option>`)
        .join('')}</select>`;
    const select = row.querySelector('select');
    const paint = () => {
      const type = marks.get(s.id);
      row.classList.toggle('absent', !!type && type !== 'kechikdi');
      row.querySelector('.mark').textContent = !type ? '✓' : type === 'kechikdi' ? '⏱' : '✕';
      select.classList.toggle('hidden', !type);
      if (type) select.value = type;
      refresh();
    };
    row.addEventListener('click', (e) => {
      if (e.target === select) return;
      if (marks.has(s.id)) marks.delete(s.id);
      else marks.set(s.id, 'sababsiz');
      paint();
    });
    select.addEventListener('change', () => {
      marks.set(s.id, select.value);
      paint();
    });
    box.append(row);
    paint();
  }
  refresh();

  save.addEventListener(
    'click',
    guard(async () => {
      save.disabled = true;
      try {
        const res = await api('PUT', `/api/teacher/lessons/${lesson.id}/attendance`, {
          absences: [...marks].map(([student_id, type]) => ({ student_id, type })),
        });
        toast(`Saqlandi: ${res.attendance.teacher_count}/${res.attendance.expected_count} darsda`);
        showDay(currentDate);
      } finally {
        save.disabled = false;
      }
    })
  );
}

guard(showDay)();
