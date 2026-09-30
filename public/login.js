import { api } from './common.js';

const loginForm = document.getElementById('login-form');
const changeForm = document.getElementById('change-form');

const HOME = { admin: '/admin', teacher: '/teacher' };

function goHome(role) {
  if (HOME[role]) location.href = HOME[role];
  else showError('login-error', 'Bu rol uchun panel hali tayyor emas (4-bosqich).');
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function showChange() {
  loginForm.classList.add('hidden');
  changeForm.classList.remove('hidden');
  document.getElementById('old-password').focus();
}

// Allaqachon kirgan bo'lsa, to'g'ridan-to'g'ri o'z paneliga o'tadi.
const me = await fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (me?.must_change_password) showChange();
else if (me) goHome(me.role);
else {
  loginForm.classList.remove('hidden');
  document.getElementById('login').focus();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('login-error', '');
  try {
    const res = await api('POST', '/api/auth/login', {
      login: document.getElementById('login').value,
      password: document.getElementById('password').value,
    });
    if (res.must_change_password) {
      document.getElementById('old-password').value = document.getElementById('password').value;
      showChange();
      document.getElementById('new-password').focus();
    } else goHome(res.role);
  } catch (err) {
    showError('login-error', err.message);
  }
});

changeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('change-error', '');
  const next = document.getElementById('new-password').value;
  if (next !== document.getElementById('new-password2').value) {
    return showError('change-error', 'Yangi parollar bir xil emas');
  }
  try {
    await api('POST', '/api/auth/change-password', {
      old_password: document.getElementById('old-password').value,
      new_password: next,
    });
    const user = await api('GET', '/api/auth/me');
    goHome(user.role);
  } catch (err) {
    showError('change-error', err.message);
  }
});
