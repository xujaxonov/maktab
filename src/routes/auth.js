// Kirish, chiqish va parolni almashtirish (A-1, O-1).
import { Router } from 'express';
import { audit } from '../db.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  destroyUserSessions,
  hashPassword,
  verifyPassword,
  validatePassword,
  loginBlocked,
  recordLoginFailure,
  clearLoginFailures,
} from '../auth.js';

export function authRoutes(db) {
  const r = Router();

  r.post('/login', (req, res) => {
    const login = String(req.body?.login || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${login}`;
    if (loginBlocked(key)) {
      return res.status(429).json({ error: 'Juda ko\'p urinish. 15 daqiqadan keyin qayta urinib ko\'ring' });
    }

    const user = db.prepare('SELECT * FROM users WHERE login = ? AND is_active = 1').get(login);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
    }
    clearLoginFailures(key);

    const { token, expires } = createSession(db, user.id);
    audit(db, { userId: user.id, schoolId: user.school_id, action: 'auth.login', entity: 'user', entityId: user.id, ip: req.ip });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === '1',
      expires: new Date(expires),
    });
    res.json({ role: user.role, full_name: user.full_name, must_change_password: !!user.must_change_password });
  });

  r.post('/logout', (req, res) => {
    if (req.sessionToken) destroySession(db, req.sessionToken);
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
    const school = req.user.school_id
      ? db.prepare('SELECT id, name FROM schools WHERE id = ?').get(req.user.school_id)
      : null;
    res.json({
      id: req.user.id,
      role: req.user.role,
      full_name: req.user.full_name,
      login: req.user.login,
      must_change_password: !!req.user.must_change_password,
      school,
    });
  });

  r.post('/change-password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Tizimga kiring' });
    const { old_password, new_password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(old_password || ''), user.password_hash)) {
      return res.status(400).json({ error: 'Joriy parol noto\'g\'ri' });
    }
    const problem = validatePassword(new_password);
    if (problem) return res.status(400).json({ error: problem });
    if (old_password === new_password) return res.status(400).json({ error: 'Yangi parol eskisidan farq qilishi kerak' });

    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      hashPassword(new_password),
      user.id
    );
    destroyUserSessions(db, user.id, req.sessionToken);
    audit(db, { userId: user.id, schoolId: user.school_id, action: 'auth.change_password', entity: 'user', entityId: user.id, ip: req.ip });
    res.json({ ok: true });
  });

  return r;
}
