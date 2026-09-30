// Parollar, sessiyalar va rollarni tekshirish (TZ X-2, X-3).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 7;
export const SESSION_COOKIE = 'sid';

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Parol kamida 8 belgidan iborat bo\'lishi kerak';
  if (!/\d/.test(password) || !/[a-zA-Z]/.test(password)) return 'Parolda harf va raqam bo\'lishi kerak';
  return null;
}

// Admin o'qituvchiga beradigan vaqtinchalik parol: chalkash belgilarsiz (0/O, 1/l).
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out.slice(0, 5) + '-' + out.slice(5);
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function destroyUserSessions(db, userId, exceptToken = null) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token IS NOT ?').run(userId, exceptToken);
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// Har bir so'rovda sessiyani o'qiydi va req.user ni to'ldiradi.
export function sessionMiddleware(db) {
  const find = db.prepare(
    `SELECT u.id, u.school_id, u.role, u.full_name, u.login, u.must_change_password, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND u.is_active = 1`
  );
  return (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const row = find.get(token);
      if (row && row.expires_at > new Date().toISOString()) {
        req.user = row;
        req.sessionToken = token;
      }
    }
    next();
  };
}

// Rolni tekshirish. Parolini almashtirmagan foydalanuvchi faqat parol almashtirish yo'liga kira oladi.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Ruxsat yo\'q' });
    if (req.user.must_change_password) {
      return res.status(403).json({ error: 'Avval parolni almashtiring', code: 'must_change_password' });
    }
    next();
  };
}

// Oddiy himoya: bitta IP va login uchun 15 daqiqada 10 ta noto'g'ri urinish.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

export function loginBlocked(key) {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(key) {
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else entry.count++;
}

export function clearLoginFailures(key) {
  failures.delete(key);
}
