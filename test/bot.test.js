// Telegram bot testi: Telegram API o'rniga soxta fetch ishlatiladi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { startBot } from '../src/bot.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('ota-ona kod orqali ulanadi va navbatdagi xabarni oladi', async () => {
  const db = openDb(':memory:');
  const school = db.prepare("INSERT INTO schools (name) VALUES ('M')").run().lastInsertRowid;
  const cls = db.prepare("INSERT INTO classes (school_id, name) VALUES (?, '5-A')").run(school).lastInsertRowid;
  const student = db.prepare("INSERT INTO students (school_id, class_id, full_name) VALUES (?, ?, 'Aliyev Ali')").run(school, cls).lastInsertRowid;
  db.prepare("INSERT INTO parent_links (student_id, link_code) VALUES (?, 'ABCD2345')").run(student);

  const updates = [
    { update_id: 1, message: { chat: { id: 555, type: 'private' }, from: { first_name: 'Vali' }, text: '/start' } },
    { update_id: 2, message: { chat: { id: 555, type: 'private' }, text: 'XXXX9999' } },
    { update_id: 3, message: { chat: { id: 555, type: 'private' }, text: 'abcd2345' } },
    { update_id: 4, message: { chat: { id: 777, type: 'private' }, text: 'ABCD2345' } },
    { update_id: 5, message: { chat: { id: 555, type: 'private' }, text: '/farzandlarim' } },
  ];
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = url.split('/').at(-1);
    const body = JSON.parse(init.body);
    if (method === 'getUpdates') {
      const batch = updates.filter((u) => u.update_id >= body.offset);
      updates.length = 0;
      if (!batch.length) await wait(20);
      return { status: 200, json: async () => ({ ok: true, result: batch }) };
    }
    sent.push(body);
    return { status: 200, json: async () => ({ ok: true, result: {} }) };
  };

  const bot = startBot(db, { token: 'test', log: { info() {}, warn() {}, error() {} } });
  try {
    await wait(100);
    const texts = sent.map((m) => `${m.chat_id}: ${m.text}`);
    assert.match(texts[0], /^555: Assalomu alaykum/);
    assert.match(texts[1], /^555: Kod topilmadi/);
    assert.match(texts[2], /^555: Siz Aliyev Ali \(5-A\) ga ulandingiz/);
    assert.match(texts[3], /^777: Bu kod ishlatilgan/);
    assert.match(texts[4], /^555: Ulangan farzandlaringiz:\n• Aliyev Ali \(5-A\)/);

    // Navbatdagi xabar bir necha soniya ichida yuboriladi va "sent" bo'ladi.
    const parent = db.prepare('SELECT id FROM parents WHERE telegram_id = 555').get().id;
    db.prepare(
      "INSERT INTO notifications (parent_id, student_id, channel, text, status) VALUES (?, ?, 'telegram', 'Farzandingiz darsga kelmadi', 'pending')"
    ).run(parent, student);
    await wait(3500);
    assert.ok(sent.some((m) => m.chat_id === 555 && m.text === 'Farzandingiz darsga kelmadi'));
    assert.equal(db.prepare('SELECT status FROM notifications').get().status, 'sent');
  } finally {
    bot.stop();
    globalThis.fetch = realFetch;
  }
});
