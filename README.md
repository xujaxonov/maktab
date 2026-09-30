# SmartDavomat

Maktab davomati tizimi. Hozir **1-bosqich (MVP, kamerasiz)** tayyor: maktab admini paneli, o'qituvchi ilovasi (telefon brauzerida ishlaydi) va ota-onalar uchun Telegram bot.

Texnik topshiriq: [SmartDavomat — Texnik topshiriq](https://claude.ai/code/artifact/2e9bfa7b-2da3-4a29-9eba-033766709d75)

## Ishga tushirish

Kerak: **Node.js 22.13 yoki undan yangi** (boshqa dastur yoki ma'lumotlar bazasi serveri kerak emas).

```bash
npm install
npm run demo        # sinov uchun namuna maktab (ixtiyoriy)
npm start           # http://localhost:3000
```

Namuna maktab loginlari (parol hammasiga `demo1234`):

| Rol | Login |
| --- | --- |
| Maktab admini | `demo_admin` |
| O'qituvchi | `demo_karimova`, `demo_toshmatov`, `demo_yusupova` |

Darsni hozirgi vaqtdan qat'i nazar sinab ko'rish uchun serverni sinov rejimida ishga tushiring:

```bash
# PowerShell
$env:ALLOW_ANY_TIME="1"; npm start
# Git Bash
ALLOW_ANY_TIME=1 npm start
```

### Haqiqiy maktab qo'shish

```bash
npm run create-school -- "12-maktab" "Karimova Dilnoza" admin12
```

Buyruq admin uchun vaqtinchalik parol chiqaradi. Admin birinchi kirishda parolni almashtiradi, keyin o'qituvchilar, sinflar, xonalar va jadvalni o'zi kiritadi.

### Telegram botni ulash

1. Telegram'da [@BotFather](https://t.me/BotFather) ga `/newbot` yuboring va token oling.
2. `.env.example` faylidan nusxa olib, `.env` deb nomlang. Unga `BOT_TOKEN` va `BOT_USERNAME` ni yozing.
3. Serverni qayta ishga tushiring. Konsolda `[bot] ishga tushdi` chiqadi.
4. Admin panelida: **Sinflar va o'quvchilar → Ota-onalar uchun kodlar → Chop etish**. Kartochkalarni ota-onalarga tarqating.
5. Ota-ona botga kodni yuboradi va farzandiga ulanadi.

## Qanday ishlaydi

1. **Admin** o'qituvchi qo'shadi. Tizim login va vaqtinchalik parol yaratadi.
2. **Admin** qo'ng'iroqlar, xonalar, sinflar, o'quvchilar va haftalik jadvalni kiritadi. Jadvaldagi to'qnashuvlar (o'qituvchi, xona yoki sinf band) avtomatik tekshiriladi.
3. **O'qituvchi** telefonda faqat o'z darslarini ko'radi. Darsni boshlanishidan 5 daqiqa oldin va 15 daqiqa keyingacha boshlay oladi.
4. O'qituvchi yo'qlarni bosib belgilaydi (sababsiz, sababli, kechikdi yoki tadbirda) yoki "Hamma bor" tugmasini bosadi.
5. Sababsiz yo'q o'quvchining ota-onasiga bot orqali xabar ketadi. O'quvchi kechikib kelsa yoki belgi xato bo'lsa, tuzatish xabari ketadi.
6. Dars tugaguncha o'qituvchi davomatni o'zgartira oladi. Dars tugagach, faqat admin sababini yozib tuzatadi.
7. Davomat va o'zgarishlar tarixini hech kim, jumladan admin ham o'chira olmaydi (ma'lumotlar bazasi darajasida taqiqlangan).

## 1-bosqichda nima bor, nima keyin

| TZ talabi | Holat |
| --- | --- |
| A-1 kirish | Bor. SMS orqali ikki bosqichli tasdiqlash keyinroq |
| A-2 ... A-8 admin paneli | Bor. O'quvchilar ro'yxati Excel fayl o'rniga nusxa ko'chirib joylanadi |
| O-1 ... O-5, O-7, O-8 o'qituvchi | Bor (telefon brauzerida ishlaydi) |
| B-1, B-2 bot | Bor |
| A-9, O-4, O-6, L-1 ... L-7 kamera | 2-bosqich |
| A-10, A-11, B-3 ... B-6, S-1 ... S-5 | 3-4-bosqichlar |
| O-9 oflayn rejim | Keyinroq |

## Tuzilma

```
src/
  server.js        server va yo'llar
  db.js            ma'lumotlar bazasi sxemasi (SQLite)
  lessons.js       darslar va davomat mantig'i
  auth.js          parollar, sessiyalar, rollar
  bot.js           Telegram bot
  time.js          Toshkent vaqti
  routes/          API: auth, admin, teacher
  cli/             create-school, demo-data
public/            veb sahifalar (admin, o'qituvchi, kirish)
test/              avtomatik testlar (npm test)
```

## Testlar

```bash
npm test
```
