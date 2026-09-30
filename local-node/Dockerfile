# SmartDavomat lokal miyasi. Maktabdagi mini-kompyuterda ishlaydi (Intel N100 yoki shunga o'xshash).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# ffmpeg - RTSP oqimlari uchun, libgl/libglib - OpenCV uchun
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch'ning faqat CPU versiyasi (GPU versiyasi bir necha GB bo'ladi va mini-kompyuterga kerak emas).
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
COPY requirements.txt .
RUN pip install -r requirements.txt \
    && pip uninstall -y opencv-python \
    && pip install --force-reinstall --no-deps "opencv-python-headless>=4.9"

# Modelni oldindan yuklab olish: maktabda internet sust bo'lsa ham ishga tushishi uchun.
RUN python -c "from ultralytics import YOLO; YOLO('yolo11n.pt')"

COPY smartnode ./smartnode
COPY tests ./tests

# Kamera oqimlari va natijalar navbati uchun
VOLUME ["/app/data"]

CMD ["python", "-m", "smartnode.main"]
