# SmartDavomat lokal miyasi

Maktabdagi mini-kompyuterda ishlaydigan dastur. O'qituvchi "Darsni boshladim" tugmasini bosganda, shu xonadagi kamerada 60 soniya davomida o'quvchilarni sanaydi va serverga **faqat sonni** yuboradi. Kadrlar va video maktabdan chiqmaydi, diskka ham yozilmaydi.

## Qanday ishlaydi

1. Server bilan doimiy aloqada turadi va vazifa kutadi. Ulanishni faqat lokal miyaning o'zi ochadi, maktab tarmog'iga tashqaridan kirish kerak emas.
2. Vazifa kelganda NVR'dan xona kamerasi oqimini (RTSP) ochadi.
3. 60 soniya davomida har 2 soniyada kadr oladi (30 ta kadr) va YOLO modeli bilan har bir kadrda odamlarni sanaydi.
4. Natija kadrlar sanog'ining medianasi bo'ladi: bir kadrda kimdir to'silib qolsa yoki birov o'tib ketsa, natija buzilmaydi. Keyin o'qituvchi uchun 1 ayiriladi.
5. Internet bo'lmasa, natija `data/results-queue.jsonl` fayliga yoziladi va keyinroq yuboriladi.
6. Har 5 daqiqada barcha kameralarni tekshiradi va holatini adminga ko'rsatish uchun serverga yuboradi.

## O'rnatish (maktabdagi mini-kompyuter)

Kerak: Docker o'rnatilgan kompyuter (Linux tavsiya etiladi), maktab NVR'i bilan bitta tarmoqda.

1. Admin panelida: **Xonalar va kameralar → Lokal miya → Token yaratish**. Tokenni yozib oling.
2. Har bir kamerali xonaga **Kamera ulash** bosib, NVR kanal raqamini yozing.
3. Mini-kompyuterda:

```bash
cp .env.example .env     # SERVER_URL, NODE_TOKEN va NVR_URL_TEMPLATE ni to'ldiring
docker compose up -d --build
docker compose logs -f   # "Sanash boshlandi..." kabi yozuvlar chiqishi kerak
```

NVR login va paroli faqat shu `.env` faylida saqlanadi, markaziy serverga yuborilmaydi.

## Kamerasiz sinab ko'rish

Haqiqiy kamera o'rniga rasm yoki video fayl berish mumkin. Quyidagi misolda 1-kanal o'rniga ultralytics bilan birga keladigan sinov rasmi ishlatiladi:

```bash
docker run --rm --network host \
  -e SERVER_URL=http://localhost:3000 -e NODE_TOKEN=sdn_... \
  -e CAMERA_URLS='{"1": "/usr/local/lib/python3.12/site-packages/ultralytics/assets/bus.jpg"}' \
  smartdavomat-node
```

Windows yoki Mac'dagi Docker Desktop'da `localhost` o'rniga `host.docker.internal` yozing.

## Sozlamalar

| O'zgaruvchi | Standart | Ma'nosi |
| --- | --- | --- |
| `SERVER_URL` | — | Markaziy server manzili |
| `NODE_TOKEN` | — | Admin panelidan olingan token |
| `NVR_URL_TEMPLATE` | — | Oqim manzili andozasi, `{channel}` o'rniga kanal qo'yiladi |
| `CAMERA_URLS` | `{}` | Alohida kanallar uchun aniq manzil (JSON) |
| `MODEL` | `yolo11n.pt` | YOLO modeli. Kuchliroq kompyuterda `yolo11s.pt` aniqroq ishlaydi |
| `CONFIDENCE` | `0.35` | Aniqlash ishonchi chegarasi |
| `IMAGE_SIZE` | `960` | Kadr o'lchami. Katta sinfda orqa partalar uchun kattaroq qiymat yaxshi |
| `SAMPLE_INTERVAL` | `2` | Kadrlar orasidagi soniya |
| `MAX_PARALLEL` | `10` | Bir vaqtda sanaladigan xonalar soni |
| `HEARTBEAT_SEC` | `300` | Kameralarni tekshirish oralig'i |

## Testlar

```bash
docker run --rm smartdavomat-node python -m unittest discover -s tests -v
```
