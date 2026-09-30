// Barcha sahifalar uchun umumiy yordamchilar.

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Javob JSON emas.
  }
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    location.href = '/';
    throw new Error('Tizimga qayta kiring');
  }
  if (res.status === 403 && data?.code === 'must_change_password') {
    location.href = '/';
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(data?.error || `Xatolik (${res.status})`);
  return data;
}

// HTML ichiga matn qo'yishdan oldin xavfsiz qilish.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer;
export function toast(message, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), isError ? 5000 : 2500);
}

// Tugma bosilganda xatoni ushlab, foydalanuvchiga ko'rsatadi.
export function guard(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };
}

// Modal oyna. content — HTML satr. Qaytaradi: { el, close }.
export function modal(content, { onClose } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${content}</div>`;
  const close = () => {
    bg.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  bg.addEventListener('click', (e) => e.target === bg && close());
  document.addEventListener('keydown', onKey);
  bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.body.append(bg);
  bg.querySelector('input, select, textarea')?.focus();
  return { el: bg.querySelector('.modal'), close };
}

export const WEEKDAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
export const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

export function weekdayOf(date) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function prettyDate(date) {
  const [, m, d] = date.split('-').map(Number);
  return `${d}-${MONTHS[m - 1]}, ${WEEKDAYS[weekdayOf(date)].toLowerCase()}`;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const ABSENCE_LABELS = { sababsiz: 'Sababsiz', sababli: 'Sababli', kechikdi: 'Kechikdi', tadbirda: 'Tadbirda' };

export async function logout() {
  await api('POST', '/api/auth/logout', {});
  location.href = '/';
}
