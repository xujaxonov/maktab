// SmartDavomat serveri: API, veb sahifalar va Telegram bot.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db.js';
import { sessionMiddleware } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';
import { teacherRoutes } from './routes/teacher.js';
import { startBot } from './bot.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
    });
    next();
  });

  app.use(express.json({ limit: '200kb' }));
  app.use(sessionMiddleware(db));

  // Tanasi bor so'rovlar faqat JSON bo'lishi kerak: boshqa saytdan yuborilgan oddiy forma bu yerga o'tmaydi.
  app.use('/api', (req, res, next) => {
    if (req.is() !== null && !req.is('application/json')) {
      return res.status(415).json({ error: 'Faqat JSON so\'rovlar qabul qilinadi' });
    }
    next();
  });

  app.use('/api/auth', authRoutes(db));
  app.use('/api/admin', adminRoutes(db));
  app.use('/api/teacher', teacherRoutes(db));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Topilmadi' }));

  app.use(express.static(join(root, 'public'), { extensions: ['html'] }));

  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    // .env bo'lmasa, muhit o'zgaruvchilaridan foydalaniladi.
  }
  const db = openDb();
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => {
    console.log(`SmartDavomat ishga tushdi: http://localhost:${port}`);
  });
  startBot(db, { token: process.env.BOT_TOKEN });
}
