// Toshkent vaqti (UTC+5, yozgi vaqt yo'q). Server qaysi vaqt zonasida bo'lishidan qat'i nazar
// sanalar va dars vaqtlari Toshkent bo'yicha hisoblanadi.
const OFFSET_MS = 5 * 60 * 60 * 1000;

export function nowTashkent(now = Date.now()) {
  const d = new Date(now + OFFSET_MS);
  const date = d.toISOString().slice(0, 10);
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date, minutes, weekday: weekdayOf(date) };
}

// 1 = dushanba ... 7 = yakshanba
export function weekdayOf(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// Toshkent bo'yicha sana va "HH:MM" dan ISO vaqt (UTC).
export function tashkentToIso(date, hhmm) {
  return new Date(Date.parse(`${date}T${hhmm}:00Z`) - OFFSET_MS).toISOString();
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
