// Maktab admini paneli (A-2 ... A-8).
import { api, esc, toast, guard, modal, prettyDate, logout, WEEKDAYS, ABSENCE_LABELS } from './common.js';

const main = document.getElementById('main');
const me = await api('GET', '/api/auth/me');
if (me.role !== 'admin') location.href = '/';
document.getElementById('school').textContent = me.school?.name ?? '';
document.getElementById('logout').addEventListener('click', guard(logout));

const opt = (items, selected, label = (x) => x.name) =>
  items.map((x) => `<option value="${x.id}" ${x.id === selected ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
const val = (root, sel) => root.querySelector(sel).value;
const page = (title, actions = '') => `<header><h1>${esc(title)}</h1><span class="spacer"></span>${actions}</header>`;

// Tanlangan bo'lim URL'da saqlanadi: sahifa yangilansa ham o'sha bo'lim ochiladi.
const tabs = {};
async function go(tab) {
  if (!tabs[tab]) tab = 'home';
  history.replaceState(null, '', `#${tab}`);
  document.querySelectorAll('#nav [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  main.innerHTML = '<p class="muted">Yuklanmoqda...</p>';
  try {
    await tabs[tab]();
  } catch (e) {
    main.innerHTML = `<p class="notice notice-bad">${esc(e.message)}</p>`;
  }
}
document.querySelectorAll('#nav [data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));

// ---------- Bosh sahifa ----------
tabs.home = async () => {
  const [s, day] = await Promise.all([api('GET', '/api/admin/summary'), api('GET', '/api/admin/attendance')]);
  const done = day.lessons.filter((l) => l.status === 'done').length;
  const missed = day.lessons.filter((l) => l.status === 'missed');
  const absent = day.lessons.reduce((n, l) => n + l.absences.filter((a) => a.type === 'sababsiz').length, 0);
  const setupSteps = [
    [s.rooms > 0, 'Xonalar va qo\'ng\'iroq jadvalini kiriting', 'rooms'],
    [s.teachers > 0, 'O\'qituvchilarni qo\'shing', 'teachers'],
    [s.classes > 0 && s.students > 0, 'Sinflar va o\'quvchilarni kiriting', 'students'],
    [day.lessons.length > 0 || s.classes === 0, 'Dars jadvalini tuzing', 'timetable'],
  ].filter(([ok]) => !ok);

  main.innerHTML = `${page(`Bugun, ${prettyDate(s.today)}`)}
    ${setupSteps.length ? `<div class="card stack"><h2>Tizimni sozlash</h2>${setupSteps
      .map(([, text, tab]) => `<div class="row"><span>• ${text}</span><button type="button" class="btn-link" data-go="${tab}">O'tish</button></div>`)
      .join('')}</div><br>` : ''}
    <div class="cards">
      <div class="card"><div class="muted small">Bugungi darslar</div><div class="stat">${day.lessons.length}</div></div>
      <div class="card"><div class="muted small">Davomat olingan</div><div class="stat">${done}</div></div>
      <div class="card"><div class="muted small">Davomat olinmagan (10 daqiqadan oshdi)</div><div class="stat">${missed.length}</div></div>
      <div class="card"><div class="muted small">Sababsiz qoldirishlar</div><div class="stat">${absent}</div></div>
      <div class="card"><div class="muted small">O'quvchilar</div><div class="stat">${s.students}</div></div>
      <div class="card"><div class="muted small">Ota-onasi botga ulangan</div><div class="stat">${s.linked_parents}</div></div>
    </div>
    ${missed.length ? `<br><div class="card"><h2>Davomat olinmagan darslar</h2>${missed
      .map((l) => `<div>${esc(l.slot_number)}-dars · ${esc(l.class_name)} · ${esc(l.subject)} · <b>${esc(l.teacher_name)}</b></div>`)
      .join('')}</div>` : ''}`;
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
};

// ---------- Davomat (A-8) ----------
const STATUS = {
  done: ['badge-ok', 'Olindi'],
  started: ['badge-warn', 'Boshlandi, belgilanmagan'],
  missed: ['badge-bad', 'Olinmagan'],
  upcoming: ['badge-info', 'Kutilmoqda'],
};
let attDate = null;
let attClass = '';

tabs.attendance = async () => {
  const classes = await api('GET', '/api/admin/classes');
  const data = await api('GET', `/api/admin/attendance?date=${attDate ?? ''}&class_id=${attClass}`);
  attDate = data.date;
  main.innerHTML = `${page('Davomat')}
    <div class="inline-fields no-print">
      <div><label for="d">Sana</label><input type="date" id="d" value="${data.date}"></div>
      <div><label for="c">Sinf</label><select id="c"><option value="">Barcha sinflar</option>${opt(classes, Number(attClass))}</select></div>
    </div><br>
    <div class="table-wrap"><table>
      <thead><tr><th>Dars</th><th>Sinf</th><th>Fan</th><th>O'qituvchi</th><th>Xona</th><th>Holat</th><th>Bor</th><th>Yo'qlar</th></tr></thead>
      <tbody>${data.lessons
        .map((l) => {
          const [cls, text] = STATUS[l.status];
          const counts = l.lesson?.teacher_count != null ? `${l.lesson.teacher_count}/${l.lesson.expected_count}` : '';
          const absent = l.absences.map((a) => `${esc(a.full_name)} <span class="muted small">(${ABSENCE_LABELS[a.type].toLowerCase()})</span>`).join('<br>');
          return `<tr class="${l.lesson ? 'clickable' : ''}" data-lesson="${l.lesson?.id ?? ''}">
            <td>${esc(l.slot_number)} · ${esc(l.start_time)}</td><td>${esc(l.class_name)}${l.group_name ? ` (${esc(l.group_name)})` : ''}</td>
            <td>${esc(l.subject)}</td><td>${esc(l.lesson?.teacher_name ?? l.teacher_name)}</td>
            <td>${esc(l.lesson?.room_name ?? l.room_name)}${l.lesson?.room_change_reason ? ` <span class="badge badge-warn" title="${esc(l.lesson.room_change_reason)}">o'zgargan</span>` : ''}</td>
            <td><span class="badge ${cls}">${text}</span></td><td>${counts}</td><td>${absent}</td></tr>`;
        })
        .join('') || '<tr><td colspan="8" class="muted">Bu kunda jadvalda dars yo\'q</td></tr>'}</tbody>
    </table></div>`;
  main.querySelector('#d').addEventListener('change', (e) => { attDate = e.target.value; go('attendance'); });
  main.querySelector('#c').addEventListener('change', (e) => { attClass = e.target.value; go('attendance'); });
  main.querySelectorAll('tr[data-lesson]').forEach((tr) => {
    if (tr.dataset.lesson) tr.addEventListener('click', guard(() => fixAttendance(Number(tr.dataset.lesson))));
  });
};

// Admin tuzatishi: sababi majburiy, audit tarixiga yoziladi.
async function fixAttendance(lessonId) {
  const l = await api('GET', `/api/admin/lessons/${lessonId}`);
  const marks = new Map(l.absences.map((a) => [a.student_id, a.type]));
  const m = modal(`
    <h2>${esc(l.class_name)} · ${esc(l.subject)}</h2>
    <p class="muted small">${esc(l.date)}, ${esc(l.slot_number)}-dars · ${esc(l.teacher_name)} · xona ${esc(l.room_name)}
      ${l.room_change_reason ? `<br>Xona o'zgarish sababi: ${esc(l.room_change_reason)}` : ''}</p>
    ${l.attendance ? `<p class="small">O'qituvchi belgisi: <b>${l.attendance.teacher_count}/${l.attendance.expected_count}</b> ·
      Kamera: ${l.attendance.camera_count ?? '— (2-bosqichda)'}</p>` : '<p class="notice notice-warn small">Davomat hali belgilanmagan</p>'}
    <div class="stack">${l.students
      .map((s) => `<div class="row"><span class="spacer">${esc(s.full_name)}</span>
        <select data-student="${s.id}"><option value="">Bor</option>${Object.entries(ABSENCE_LABELS)
          .map(([k, v]) => `<option value="${k}" ${marks.get(s.id) === k ? 'selected' : ''}>${v}</option>`)
          .join('')}</select></div>`)
      .join('')}</div>
    <div class="field"><br><label for="reason">Tuzatish sababi (majburiy)</label><input id="reason" placeholder="Masalan: spravka keltirildi"></div>
    <footer><button type="button" data-close>Yopish</button><button type="button" class="btn-primary" id="save">Tuzatishni saqlash</button></footer>`);
  m.el.querySelector('#save').addEventListener(
    'click',
    guard(async () => {
      const absences = [...m.el.querySelectorAll('select[data-student]')]
        .filter((s) => s.value)
        .map((s) => ({ student_id: Number(s.dataset.student), type: s.value }));
      await api('PUT', `/api/admin/lessons/${lessonId}/attendance`, { absences, reason: val(m.el, '#reason') });
      m.close();
      toast('Tuzatish saqlandi');
      go('attendance');
    })
  );
}

// ---------- Dars jadvali (A-6) ----------
let ttClass = null;

tabs.timetable = async () => {
  const [classes, slots, teachers, rooms] = await Promise.all([
    api('GET', '/api/admin/classes'),
    api('GET', '/api/admin/slots'),
    api('GET', '/api/admin/teachers'),
    api('GET', '/api/admin/rooms'),
  ]);
  if (!classes.length || !slots.length || !teachers.length || !rooms.length) {
    main.innerHTML = `${page('Dars jadvali')}<p class="notice notice-warn">Jadval tuzishdan oldin sinflar, qo'ng'iroqlar, xonalar va o'qituvchilarni kiriting.</p>`;
    return;
  }
  const cls = classes.find((c) => c.id === ttClass) ?? classes[0];
  ttClass = cls.id;
  const entries = await api('GET', `/api/admin/timetable?class_id=${cls.id}`);
  const shiftSlots = slots.filter((s) => s.shift === cls.shift);

  main.innerHTML = `${page('Dars jadvali')}
    <div class="inline-fields"><div><label for="cls">Sinf</label><select id="cls">${opt(classes, cls.id, (c) => `${c.name} (${c.shift}-smena)`)}</select></div></div>
    <p class="muted small">Katakni bosib dars qo'shing yoki tahrirlang. Jadvaldagi to'qnashuvlar (o'qituvchi, xona yoki sinf band) avtomatik tekshiriladi.</p>
    <div class="table-wrap"><table class="grid-tt">
      <thead><tr><th>Dars</th>${[1, 2, 3, 4, 5, 6].map((d) => `<th>${WEEKDAYS[d]}</th>`).join('')}</tr></thead>
      <tbody>${shiftSlots
        .map((s) => `<tr><td><b>${s.number}</b><br><span class="muted small">${s.start_time}–${s.end_time}</span></td>${[1, 2, 3, 4, 5, 6]
          .map((d) => {
            const here = entries.filter((e) => e.weekday === d && e.slot_id === s.id);
            return `<td><div class="tt-cell ${here.length ? '' : 'empty'}" data-day="${d}" data-slot="${s.id}">${here.length
              ? here.map((e) => `<div class="tt-item" data-entry="${e.id}"><b>${esc(e.subject)}</b>${e.group_name ? ` <span class="muted small">(${esc(e.group_name)})</span>` : ''}<br>
                  <span class="small">${esc(e.teacher_name)}</span><br><span class="muted small">xona ${esc(e.room_name)}</span></div>`).join('')
              : '+'}</div></td>`;
          })
          .join('')}</tr>`)
        .join('')}</tbody>
    </table></div>`;

  main.querySelector('#cls').addEventListener('change', (e) => { ttClass = Number(e.target.value); go('timetable'); });
  main.querySelectorAll('.tt-cell').forEach((cell) =>
    cell.addEventListener('click', (e) => {
      const item = e.target.closest('[data-entry]');
      const entry = item ? entries.find((x) => x.id === Number(item.dataset.entry)) : null;
      editEntry({ cls, entry, weekday: Number(cell.dataset.day), slotId: Number(cell.dataset.slot), teachers, rooms, slots: shiftSlots });
    })
  );
};

function editEntry({ cls, entry, weekday, slotId, teachers, rooms, slots }) {
  const e = entry ?? { weekday, slot_id: slotId, class_id: cls.id };
  const active = teachers.filter((t) => t.is_active || t.id === e.teacher_id);
  const m = modal(`
    <h2>${entry ? 'Darsni tahrirlash' : 'Dars qo\'shish'} · ${esc(cls.name)}</h2>
    <div class="inline-fields">
      <div><label for="wd">Kun</label><select id="wd">${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}" ${d === e.weekday ? 'selected' : ''}>${WEEKDAYS[d]}</option>`).join('')}</select></div>
      <div><label for="sl">Dars</label><select id="sl">${opt(slots, e.slot_id, (s) => `${s.number}-dars (${s.start_time})`)}</select></div>
    </div>
    <div class="field"><br><label for="subj">Fan</label><input id="subj" value="${esc(e.subject ?? '')}" placeholder="Masalan: Matematika"></div>
    <div class="field"><label for="grp">Guruh (sinf bo'lingan bo'lsa)</label><select id="grp"><option value="">Butun sinf</option>${opt(cls.groups, e.group_id)}</select></div>
    <div class="field"><label for="tch">O'qituvchi</label><select id="tch">${opt(active, e.teacher_id, (t) => t.full_name)}</select></div>
    <div class="field"><label for="rm">Xona</label><select id="rm">${opt(rooms, e.room_id)}</select></div>
    <footer>
      ${entry ? '<button type="button" class="btn-danger" id="del">Jadvaldan olib tashlash</button><span class="spacer"></span>' : ''}
      <button type="button" data-close>Bekor qilish</button>
      <button type="button" class="btn-primary" id="save">Saqlash</button>
    </footer>`);

  m.el.querySelector('#save').addEventListener(
    'click',
    guard(async () => {
      const body = {
        weekday: Number(val(m.el, '#wd')),
        slot_id: Number(val(m.el, '#sl')),
        class_id: cls.id,
        group_id: val(m.el, '#grp') || null,
        subject: val(m.el, '#subj'),
        teacher_id: Number(val(m.el, '#tch')),
        room_id: Number(val(m.el, '#rm')),
      };
      await api(entry ? 'PUT' : 'POST', `/api/admin/timetable${entry ? `/${entry.id}` : ''}`, body);
      m.close();
      toast('Jadval saqlandi');
      go('timetable');
    })
  );
  m.el.querySelector('#del')?.addEventListener(
    'click',
    guard(async () => {
      if (!confirm('Bu dars jadvaldan olib tashlansinmi? O\'tilgan darslar tarixi saqlanib qoladi.')) return;
      await api('DELETE', `/api/admin/timetable/${entry.id}`);
      m.close();
      toast('Dars jadvaldan olib tashlandi');
      go('timetable');
    })
  );
}

// ---------- Bir martalik o'zgarishlar (A-7) ----------
const OVERRIDE_LABELS = { cancel: 'Dars bekor qilindi', substitute: 'O\'qituvchi almashtirildi', room: 'Xona o\'zgardi' };

tabs.overrides = async () => {
  const list = await api('GET', '/api/admin/overrides');
  main.innerHTML = `${page('Bir martalik o\'zgarishlar', '<button type="button" class="btn-primary" id="add">O\'zgarish qo\'shish</button>')}
    <p class="muted small">Faqat bitta sana uchun: dars bekor qilinishi, boshqa o'qituvchi dars o'tishi yoki boshqa xonada o'tishi. Haftalik jadval o'zgarmaydi.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Sana</th><th>Dars</th><th>Sinf, fan</th><th>O'zgarish</th><th></th></tr></thead>
      <tbody>${list
        .map((o) => `<tr><td>${esc(prettyDate(o.date))}</td><td>${o.slot_number}-dars, ${esc(o.start_time)}</td>
          <td>${esc(o.class_name)} · ${esc(o.subject)}<br><span class="muted small">${esc(o.teacher_name)}</span></td>
          <td>${OVERRIDE_LABELS[o.type]}${o.new_teacher_name ? `: <b>${esc(o.new_teacher_name)}</b>` : ''}${o.new_room_name ? `: <b>${esc(o.new_room_name)}</b>` : ''}</td>
          <td><button type="button" class="btn-link" data-del="${o.id}">Bekor qilish</button></td></tr>`)
        .join('') || '<tr><td colspan="5" class="muted">Rejalashtirilgan o\'zgarishlar yo\'q</td></tr>'}</tbody>
    </table></div>`;
  main.querySelector('#add').addEventListener('click', guard(addOverride));
  main.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', guard(async () => {
      await api('DELETE', `/api/admin/overrides/${b.dataset.del}`);
      toast('O\'zgarish bekor qilindi');
      go('overrides');
    }))
  );
};

async function addOverride() {
  const [teachers, rooms] = await Promise.all([api('GET', '/api/admin/teachers'), api('GET', '/api/admin/rooms')]);
  const today = (await api('GET', '/api/admin/summary')).today;
  const m = modal(`
    <h2>Bir martalik o'zgarish</h2>
    <div class="field"><label for="od">Sana</label><input type="date" id="od" min="${today}" value="${today}"></div>
    <div class="field"><label for="ol">Dars</label><select id="ol"></select></div>
    <div class="field"><label for="ot">O'zgarish turi</label><select id="ot">${Object.entries(OVERRIDE_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field" id="f-teacher"><label for="onew">Kim dars o'tadi</label><select id="onew">${opt(teachers.filter((t) => t.is_active), null, (t) => t.full_name)}</select></div>
    <div class="field" id="f-room"><label for="oroom">Yangi xona</label><select id="oroom">${opt(rooms, null)}</select></div>
    <footer><button type="button" data-close>Bekor qilish</button><button type="button" class="btn-primary" id="save">Saqlash</button></footer>`);

  const loadLessons = guard(async () => {
    const day = await api('GET', `/api/admin/attendance?date=${val(m.el, '#od')}`);
    const free = day.lessons.filter((l) => !l.lesson);
    m.el.querySelector('#ol').innerHTML = free.length
      ? free.map((l) => `<option value="${l.timetable_id}">${l.slot_number}-dars · ${esc(l.class_name)} · ${esc(l.subject)} · ${esc(l.teacher_name)}</option>`).join('')
      : '<option value="">Bu kunda dars yo\'q</option>';
  });
  const toggle = () => {
    const type = val(m.el, '#ot');
    m.el.querySelector('#f-teacher').classList.toggle('hidden', type !== 'substitute');
    m.el.querySelector('#f-room').classList.toggle('hidden', type !== 'room');
  };
  m.el.querySelector('#od').addEventListener('change', loadLessons);
  m.el.querySelector('#ot').addEventListener('change', toggle);
  toggle();
  loadLessons();

  m.el.querySelector('#save').addEventListener(
    'click',
    guard(async () => {
      await api('POST', '/api/admin/overrides', {
        date: val(m.el, '#od'),
        timetable_id: Number(val(m.el, '#ol')),
        type: val(m.el, '#ot'),
        new_teacher_id: Number(val(m.el, '#onew')),
        new_room_id: Number(val(m.el, '#oroom')),
      });
      m.close();
      toast('O\'zgarish saqlandi');
      go('overrides');
    })
  );
}

// ---------- O'qituvchilar (A-2) ----------
function showCredentials(title, login, password) {
  modal(`
    <h2>${esc(title)}</h2>
    <p>Bu ma'lumotni o'qituvchiga bering. Parol faqat hozir ko'rsatiladi.</p>
    <div class="card stack">
      <div>Login: <span class="secret">${esc(login)}</span></div>
      <div>Vaqtinchalik parol: <span class="secret">${esc(password)}</span></div>
    </div>
    <p class="muted small">O'qituvchi birinchi kirishda parolni o'zi almashtiradi.</p>
    <footer><button type="button" class="btn-primary" data-close>Tushunarli</button></footer>`);
}

tabs.teachers = async () => {
  const list = await api('GET', '/api/admin/teachers');
  main.innerHTML = `${page('O\'qituvchilar')}
    <form class="card inline-fields" id="add">
      <div><label for="tn">Ism-familiya</label><input id="tn" placeholder="Karimova Dilnoza" required></div>
      <div><label for="tp">Telefon (ixtiyoriy)</label><input id="tp" placeholder="+998 90 123 45 67"></div>
      <div><button class="btn-primary" type="submit">Qo'shish</button></div>
    </form><br>
    <div class="table-wrap"><table>
      <thead><tr><th>Ism-familiya</th><th>Telefon</th><th>Login</th><th>Holat</th><th></th></tr></thead>
      <tbody>${list
        .map((t) => `<tr><td>${esc(t.full_name)}</td><td>${esc(t.phone ?? '')}</td><td>${esc(t.login)}</td>
          <td>${t.is_active ? (t.must_change_password ? '<span class="badge badge-warn">Hali kirmagan</span>' : '<span class="badge badge-ok">Faol</span>') : '<span class="badge badge-bad">Faol emas</span>'}</td>
          <td class="row"><button type="button" class="btn-link" data-reset="${t.id}">Parolni tiklash</button>
            <button type="button" class="btn-link" data-active="${t.id}" data-on="${t.is_active ? 0 : 1}">${t.is_active ? 'Faolsizlantirish' : 'Faollashtirish'}</button></td></tr>`)
        .join('') || '<tr><td colspan="5" class="muted">Hali o\'qituvchi yo\'q</td></tr>'}</tbody>
    </table></div>`;

  main.querySelector('#add').addEventListener(
    'submit',
    guard(async (e) => {
      e.preventDefault();
      const t = await api('POST', '/api/admin/teachers', { full_name: val(main, '#tn'), phone: val(main, '#tp') });
      await go('teachers');
      showCredentials(`${t.full_name} qo'shildi`, t.login, t.password);
    })
  );
  main.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', guard(async () => {
      if (!confirm('Parol tiklansinmi? O\'qituvchi yangi vaqtinchalik parol bilan kiradi.')) return;
      const r = await api('POST', `/api/admin/teachers/${b.dataset.reset}/reset-password`, {});
      showCredentials('Yangi parol', r.login, r.password);
    }))
  );
  main.querySelectorAll('[data-active]').forEach((b) =>
    b.addEventListener('click', guard(async () => {
      await api('POST', `/api/admin/teachers/${b.dataset.active}/active`, { is_active: b.dataset.on === '1' });
      go('teachers');
    }))
  );
};

// ---------- Sinflar va o'quvchilar (A-3, A-4) ----------
let stClass = null;

tabs.students = async () => {
  const classes = await api('GET', '/api/admin/classes');
  const cls = classes.find((c) => c.id === stClass) ?? classes[0] ?? null;
  stClass = cls?.id ?? null;
  const students = cls ? await api('GET', `/api/admin/students?class_id=${cls.id}`) : [];

  main.innerHTML = `${page('Sinflar va o\'quvchilar')}
    <form class="card inline-fields" id="add-class">
      <div><label for="cn">Yangi sinf</label><input id="cn" placeholder="5-A" required></div>
      <div><label for="cs">Smena</label><select id="cs"><option value="1">1-smena</option><option value="2">2-smena</option></select></div>
      <div><button type="submit">Sinf qo'shish</button></div>
    </form><br>
    ${cls ? `
    <div class="row"><label for="cls" class="hidden">Sinf</label>
      <select id="cls" class="no-print">${opt(classes, cls.id, (c) => `${c.name} — ${c.student_count} o'quvchi`)}</select></div><br>
    <div class="card stack">
      <div class="row"><h2>${esc(cls.name)} sinfi</h2><span class="spacer"></span>
        <button type="button" id="add-st">O'quvchi qo'shish</button>
        <button type="button" id="import">Ro'yxatni joylash</button>
        <button type="button" id="codes" class="btn-primary">Ota-onalar uchun kodlar</button></div>
      <div class="row small"><span class="muted">Guruhlar:</span>${cls.groups.map((g) => `<span class="badge badge-info">${esc(g.name)}</span>`).join('') || '<span class="muted">yo\'q</span>'}
        <button type="button" class="btn-link" id="add-group">+ guruh</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Ism-familiya</th><th>Guruh</th><th>Ota-ona botda</th><th></th></tr></thead>
        <tbody>${students
          .map((s, i) => `<tr class="${s.is_active ? '' : 'muted'}"><td>${i + 1}</td><td>${esc(s.full_name)}${s.is_active ? '' : ' (chiqib ketgan)'}</td>
            <td>${cls.groups.filter((g) => s.group_ids.includes(g.id)).map((g) => esc(g.name)).join(', ')}</td>
            <td>${s.parents_linked ? `<span class="badge badge-ok">${s.parents_linked} ta</span>` : '<span class="badge badge-warn">ulanmagan</span>'}</td>
            <td><button type="button" class="btn-link" data-edit="${s.id}">Tahrirlash</button></td></tr>`)
          .join('') || '<tr><td colspan="5" class="muted">O\'quvchilar hali kiritilmagan</td></tr>'}</tbody>
      </table></div>
    </div>` : '<p class="muted">Avval sinf qo\'shing.</p>'}`;

  main.querySelector('#add-class').addEventListener(
    'submit',
    guard(async (e) => {
      e.preventDefault();
      const r = await api('POST', '/api/admin/classes', { name: val(main, '#cn'), shift: Number(val(main, '#cs')) });
      stClass = r.id;
      toast('Sinf qo\'shildi');
      go('students');
    })
  );
  if (!cls) return;

  main.querySelector('#cls').addEventListener('change', (e) => { stClass = Number(e.target.value); go('students'); });
  main.querySelector('#add-group').addEventListener('click', guard(async () => {
    const name = prompt('Guruh nomi (masalan: Ingliz tili 1-guruh)');
    if (!name) return;
    await api('POST', `/api/admin/classes/${cls.id}/groups`, { name });
    go('students');
  }));
  main.querySelector('#add-st').addEventListener('click', () => editStudent(cls, classes, null));
  main.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => editStudent(cls, classes, students.find((s) => s.id === Number(b.dataset.edit))))
  );
  main.querySelector('#import').addEventListener('click', () => {
    const m = modal(`
      <h2>${esc(cls.name)}: ro'yxatni joylash</h2>
      <p class="muted small">Har qatorda bitta o'quvchi. Excel'dan ism-familiya ustunini nusxalab qo'yishingiz mumkin. Ro'yxatda bor ismlar takrorlanmaydi.</p>
      <textarea id="names" placeholder="Aliyev Ali&#10;Valiyeva Madina"></textarea>
      <footer><button type="button" data-close>Bekor qilish</button><button type="button" class="btn-primary" id="save">Joylash</button></footer>`);
    m.el.querySelector('#save').addEventListener('click', guard(async () => {
      const r = await api('POST', '/api/admin/students/import', { class_id: cls.id, text: val(m.el, '#names') });
      m.close();
      toast(`${r.added} ta qo'shildi${r.skipped ? `, ${r.skipped} ta takror o'tkazib yuborildi` : ''}`);
      go('students');
    }));
  });
  main.querySelector('#codes').addEventListener('click', guard(() => showCodes(cls)));
};

function editStudent(cls, classes, s) {
  const m = modal(`
    <h2>${s ? 'O\'quvchini tahrirlash' : 'O\'quvchi qo\'shish'}</h2>
    <div class="field"><label for="sn">Ism-familiya</label><input id="sn" value="${esc(s?.full_name ?? '')}"></div>
    <div class="field"><label for="sc">Sinf</label><select id="sc">${opt(classes, s?.class_id ?? cls.id)}</select></div>
    ${cls.groups.length ? `<div class="field"><label>Guruhlar</label>${cls.groups
      .map((g) => `<label class="check"><input type="checkbox" value="${g.id}" ${s?.group_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`)
      .join('')}</div>` : ''}
    ${s ? `<label class="check"><input type="checkbox" id="sa" ${s.is_active ? 'checked' : ''}> O'qiydi (belgini olib tashlasangiz, ro'yxatdan chiqadi)</label>` : ''}
    <footer><button type="button" data-close>Bekor qilish</button><button type="button" class="btn-primary" id="save">Saqlash</button></footer>`);
  m.el.querySelector('#save').addEventListener('click', guard(async () => {
    const classId = Number(val(m.el, '#sc'));
    const groupIds = classId === cls.id ? [...m.el.querySelectorAll('input[type=checkbox][value]:checked')].map((c) => Number(c.value)) : [];
    const body = { full_name: val(m.el, '#sn'), class_id: classId, group_ids: groupIds };
    if (s) body.is_active = m.el.querySelector('#sa').checked;
    await api(s ? 'PUT' : 'POST', `/api/admin/students${s ? `/${s.id}` : ''}`, body);
    m.close();
    toast('Saqlandi');
    go('students');
  }));
}

// Chop etib, ota-onalarga tarqatiladigan kodlar varag'i (B-1).
async function showCodes(cls) {
  const data = await api('GET', `/api/admin/link-codes?class_id=${cls.id}`);
  const bot = data.bot_username ? `@${data.bot_username} botiga` : 'maktab botiga';
  main.innerHTML = `${page(`${data.class_name}: ota-onalar uchun kodlar`, '<button type="button" id="print" class="btn-primary">Chop etish</button> <button type="button" id="back">Orqaga</button>')}
    <p class="muted small no-print">Har bir kartochkani qirqib, ota-onaga bering. Kod bir marta ishlatiladi; ikkinchi ota-ona uchun sahifani qayta oching, yangi kod chiqadi.</p>
    <div class="print-codes">${data.students
      .map((s) => `<div class="code-slip"><b>${esc(s.full_name)}</b> (${esc(data.class_name)})<br>
        <span class="small">Telegram'da ${esc(bot)} kiring va kodni yuboring:</span><br>
        <span class="secret">${esc(s.code)}</span>
        ${s.parents_linked ? `<br><span class="muted small">Allaqachon ulangan: ${s.parents_linked}</span>` : ''}</div>`)
      .join('')}</div>`;
  main.querySelector('#print').addEventListener('click', () => print());
  main.querySelector('#back').addEventListener('click', () => go('students'));
}

// ---------- Xonalar va qo'ng'iroqlar (A-5) ----------
tabs.rooms = async () => {
  const [rooms, slots] = await Promise.all([api('GET', '/api/admin/rooms'), api('GET', '/api/admin/slots')]);
  const next = (shift) => Math.max(0, ...slots.filter((s) => s.shift === shift).map((s) => s.number)) + 1;
  main.innerHTML = `${page('Xonalar va qo\'ng\'iroqlar')}
    <div class="card stack">
      <h2>Qo'ng'iroq jadvali</h2>
      <form class="inline-fields" id="add-slot">
        <div><label for="ss">Smena</label><select id="ss"><option value="1">1-smena</option><option value="2">2-smena</option></select></div>
        <div><label for="sn">Dars raqami</label><input id="sn" type="number" min="1" max="12" value="${next(1)}"></div>
        <div><label for="st">Boshlanishi</label><input id="st" type="time" required></div>
        <div><label for="se">Tugashi</label><input id="se" type="time" required></div>
        <div><button type="submit">Qo'shish</button></div>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Smena</th><th>Dars</th><th>Vaqti</th><th></th></tr></thead>
        <tbody>${slots.map((s) => `<tr><td>${s.shift}</td><td>${s.number}-dars</td><td>${s.start_time}–${s.end_time}</td>
          <td><button type="button" class="btn-link" data-slot="${s.id}">Tahrirlash</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Hali kiritilmagan</td></tr>'}</tbody>
      </table></div>
    </div><br>
    <div class="card stack">
      <h2>Xonalar</h2>
      <form class="inline-fields" id="add-room">
        <div><label for="rn">Xona</label><input id="rn" placeholder="101" required></div>
        <div><label class="check"><input type="checkbox" id="rc"> Kamera bor</label></div>
        <div><button type="submit">Qo'shish</button></div>
      </form>
      <p class="muted small">Kamera belgisi 2-bosqichda ishlatiladi. Hozircha davomat hamma xonada qo'lda olinadi.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Xona</th><th>Kamera</th><th></th></tr></thead>
        <tbody>${rooms.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.has_camera ? 'Bor' : '<span class="muted">Yo\'q</span>'}</td>
          <td><button type="button" class="btn-link" data-cam="${r.id}" data-on="${r.has_camera ? 0 : 1}">${r.has_camera ? 'Kamera yo\'q deb belgilash' : 'Kamera bor deb belgilash'}</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Hali kiritilmagan</td></tr>'}</tbody>
      </table></div>
    </div>`;

  main.querySelector('#ss').addEventListener('change', (e) => { main.querySelector('#sn').value = next(Number(e.target.value)); });
  main.querySelector('#add-slot').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    await api('POST', '/api/admin/slots', { shift: Number(val(main, '#ss')), number: Number(val(main, '#sn')), start_time: val(main, '#st'), end_time: val(main, '#se') });
    go('rooms');
  }));
  main.querySelectorAll('[data-slot]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = slots.find((x) => x.id === Number(b.dataset.slot));
      const m = modal(`<h2>${s.shift}-smena, ${s.number}-dars</h2>
        <div class="inline-fields"><div><label for="a">Boshlanishi</label><input id="a" type="time" value="${s.start_time}"></div>
        <div><label for="b">Tugashi</label><input id="b" type="time" value="${s.end_time}"></div></div>
        <footer><button type="button" data-close>Bekor qilish</button><button type="button" class="btn-primary" id="save">Saqlash</button></footer>`);
      m.el.querySelector('#save').addEventListener('click', guard(async () => {
        await api('PUT', `/api/admin/slots/${s.id}`, { start_time: val(m.el, '#a'), end_time: val(m.el, '#b') });
        m.close();
        go('rooms');
      }));
    })
  );
  main.querySelector('#add-room').addEventListener('submit', guard(async (e) => {
    e.preventDefault();
    await api('POST', '/api/admin/rooms', { name: val(main, '#rn'), has_camera: main.querySelector('#rc').checked });
    go('rooms');
  }));
  main.querySelectorAll('[data-cam]').forEach((b) =>
    b.addEventListener('click', guard(async () => {
      await api('PUT', `/api/admin/rooms/${b.dataset.cam}`, { has_camera: b.dataset.on === '1' });
      go('rooms');
    }))
  );
};

// ---------- O'zgarishlar tarixi (X-4) ----------
tabs.audit = async () => {
  const rows = await api('GET', '/api/admin/audit');
  main.innerHTML = `${page('O\'zgarishlar tarixi')}
    <p class="muted small">Tizimdagi har bir harakat shu yerda saqlanadi va uni hech kim o'chira olmaydi. Oxirgi 200 ta yozuv.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Vaqt (UTC)</th><th>Kim</th><th>Harakat</th><th>Tafsilot</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td class="small">${esc(r.created_at)}</td><td>${esc(r.user_name ?? 'tizim')}</td>
        <td>${esc(r.action)}</td><td class="small muted">${esc(r.new_value ?? '')}</td></tr>`).join('')}</tbody>
    </table></div>`;
};

go(location.hash.slice(1));
