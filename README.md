# SmartDavomat

Maktab davomati tizimi. Hozir **1- va 2-bosqichlar** tayyor: maktab admini paneli, o'qituvchi ilovasi (telefon brauzerida ishlaydi), ota-onalar uchun Telegram bot va kamera orqali o'quvchilarni sanaydigan lokal miya ([local-node/](local-node/README.md)).

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

### Kamera orqali sanash (2-bosqich)

1. Admin xonaga kamera ulaydi, ya'ni NVR kanal raqamini yozadi, va lokal miya uchun token yaratadi.
2. Maktabdagi mini-kompyuterda lokal miya ishga tushiriladi ([local-node/README.md](local-node/README.md)).
3. O'qituvchi kamerali xonada "Darsni boshladim"ni bosadi. Kamera 60 soniya sanaydi va o'qituvchi ekranida "Kamera: 28 o'quvchi. Ro'yxatda: 30" chiqadi.
4. O'qituvchi soni kamera sonidan 2 tadan ko'p farq qilsa, tizim tasdiq so'raydi. Tasdiqlangan dars "shubhali" bo'ladi va admin uni **Shubhali holatlar** bo'limida video vaqti bilan ko'rib, xulosa yozadi.
5. Kamera yoki lokal miya ishlamasa, dars avtomatik qo'lda rejimga o'tadi va sababi yozib qo'yiladi.

## Bosqichlar bo'yicha holat

| TZ talabi | Holat |
| --- | --- |
| A-1 kirish | Bor. SMS orqali ikki bosqichli tasdiqlash keyinroq |
| A-2 ... A-8 admin paneli | Bor. O'quvchilar ro'yxati Excel fayl o'rniga nusxa ko'chirib joylanadi |
| O-1 ... O-5, O-7, O-8 o'qituvchi | Bor (telefon brauzerida ishlaydi) |
| B-1, B-2 bot | Bor |
| A-9, O-4, O-6, L-1 ... L-7 kamera | Bor (2-bosqich). Haqiqiy maktab kamerasida hali sinalmagan |
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
  routes/          API: auth, admin, teacher, node (lokal miya)
  camera.js        kamera sanog'i, lokal miya vazifalari, farq tekshiruvi
  cli/             create-school, demo-data
local-node/        lokal miya (Python, YOLO, Docker)
public/            veb sahifalar (admin, o'qituvchi, kirish)
test/              avtomatik testlar (npm test)
```

## Testlar

```bash
npm test
```
