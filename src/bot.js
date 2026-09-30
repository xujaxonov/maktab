// Ota-onalar uchun Telegram bot (B-1, B-2).
// Long polling orqali ishlaydi, shuning uchun serverga tashqaridan kirish (webhook) kerak emas.
import { audit } from './db.js';

const API = 'https://api.telegram.org';
const SEND_INTERVAL_MS = 3000;

export function startBot(db, { token, log = console }) {
  if (!token) {
    log.warn('[bot] BOT_TOKEN berilmagan: bot o\'chiq, xabarlar navbatda kutib turadi');
    return { stop() {} };
  }

  let stopped = false;
  let offset = 0;

  async function call(method, body) {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(40_000),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.description || `Telegram xatosi ${res.status}`);
      err.code = data.error_code;
      throw err;
    }
    return data.result;
  }

  const reply = (chatId, text) => call('sendMessage', { chat_id: chatId, text }).catch((e) => log.error('[bot]', e.message));

  // Kodni tanlab topishga urinishdan himoya: bitta chatdan soatiga 10 ta noto'g'ri kod.
  const wrongCodes = new Map();

  function linkParent(chatId, from, rawCode) {
    const code = rawCode.trim().toUpperCase();
    const tries = wrongCodes.get(chatId);
    if (tries && Date.now() - tries.first < 3600_000 && tries.count >= 10) {
      return 'Juda ko\'p noto\'g\'ri urinish. Bir soatdan keyin qayta urinib ko\'ring.';
    }

    const link = db
      .prepare(
        `SELECT pl.*, st.full_name, st.school_id, c.name AS class_name
         FROM parent_links pl JOIN students st ON st.id = pl.student_id JOIN classes c ON c.id = st.class_id
         WHERE pl.link_code = ? AND st.is_active = 1`
      )
      .get(code);
    if (!link) {
      const t = tries && Date.now() - tries.first < 3600_000 ? tries : { first: Date.now(), count: 0 };
      t.count++;
      wrongCodes.set(chatId, t);
      return 'Kod topilmadi. Maktab bergan kodni tekshirib, qayta yuboring.';
    }

    let parent = db.prepare('SELECT * FROM parents WHERE telegram_id = ?').get(chatId);
    if (!parent) {
      const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || null;
      const r = db.prepare('INSERT INTO parents (telegram_id, full_name) VALUES (?, ?)').run(chatId, name);
      parent = { id: r.lastInsertRowid };
    }

    if (link.parent_id === parent.id) return `Siz ${link.full_name} (${link.class_name}) ga allaqachon ulangansiz.`;
    if (link.parent_id) return 'Bu kod ishlatilgan. Maktabdan yangi kod so\'rang.';

    const already = db
      .prepare('SELECT 1 FROM parent_links WHERE student_id = ? AND parent_id = ?')
      .get(link.student_id, parent.id);
    if (already) return `Siz ${link.full_name} (${link.class_name}) ga allaqachon ulangansiz.`;

    db.prepare('UPDATE parent_links SET parent_id = ?, linked_at = CURRENT_TIMESTAMP WHERE id = ?').run(parent.id, link.id);
    audit(db, { schoolId: link.school_id, action: 'parent.link', entity: 'student', entityId: link.student_id, newValue: { parent_id: parent.id } });
    return (
      `Siz ${link.full_name} (${link.class_name}) ga ulandingiz.\n` +
      'Endi farzandingiz darsga kelmasa, shu yerga xabar keladi.'
    );
  }

  function children(chatId) {
    const rows = db
      .prepare(
        `SELECT st.full_name, c.name AS class_name FROM parents p
         JOIN parent_links pl ON pl.parent_id = p.id JOIN students st ON st.id = pl.student_id
         JOIN classes c ON c.id = st.class_id
         WHERE p.telegram_id = ? ORDER BY st.full_name`
      )
      .all(chatId);
    if (!rows.length) return 'Hali hech bir o\'quvchiga ulanmagansiz. Maktab bergan kodni yuboring.';
    return 'Ulangan farzandlaringiz:\n' + rows.map((r) => `• ${r.full_name} (${r.class_name})`).join('\n');
  }

  function handle(message) {
    if (!message?.text || message.chat?.type !== 'private') return;
    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/start')) {
      const code = text.split(/\s+/)[1];
      if (code) return reply(chatId, linkParent(chatId, message.from, code));
      return reply(
        chatId,
        'Assalomu alaykum! Bu SmartDavomat boti.\n' +
          'Farzandingiz darsga kelmasa, shu yerga xabar keladi.\n\n' +
          'Ulanish uchun maktab bergan 8 belgili kodni yuboring.'
      );
    }
    if (text === '/farzandlarim') return reply(chatId, children(chatId));
    if (/^[A-Za-z0-9]{8}$/.test(text)) return reply(chatId, linkParent(chatId, message.from, text));
    return reply(chatId, 'Maktab bergan 8 belgili kodni yuboring yoki /farzandlarim buyrug\'ini tanlang.');
  }

  async function poll() {
    while (!stopped) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          try {
            await handle(u.message);
          } catch (e) {
            log.error('[bot] xabarni qayta ishlashda xato:', e.message);
          }
        }
      } catch (e) {
        if (stopped) return;
        log.error('[bot] getUpdates xatosi:', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  // Navbatdagi xabarlarni yuborish. Tarmoq xatosida xabar navbatda qoladi va keyin qayta yuboriladi.
  const pending = db.prepare(
    `SELECT n.id, n.text, p.telegram_id FROM notifications n JOIN parents p ON p.id = n.parent_id
     WHERE n.status = 'pending' AND n.channel = 'telegram' ORDER BY n.id LIMIT 25`
  );
  const markSent = db.prepare("UPDATE notifications SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL WHERE id = ?");
  const markFailed = db.prepare("UPDATE notifications SET status = 'failed', error = ? WHERE id = ?");
  let sending = false;

  async function flush() {
    if (sending || stopped) return;
    sending = true;
    try {
      for (const n of pending.all()) {
        try {
          await call('sendMessage', { chat_id: n.telegram_id, text: n.text });
          markSent.run(n.id);
        } catch (e) {
          // 400/403: chat topilmadi yoki ota-ona botni bloklagan, qayta urinish foydasiz.
          if (e.code === 400 || e.code === 403) markFailed.run(e.message, n.id);
          else {
            log.error('[bot] yuborib bo\'lmadi, keyinroq qayta urinamiz:', e.message);
            break;
          }
        }
      }
    } finally {
      sending = false;
    }
  }

  poll();
  const timer = setInterval(flush, SEND_INTERVAL_MS);
  log.info('[bot] ishga tushdi');

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
