"""Kadr manbalari: kamera oqimi (RTSP) yoki sinov uchun rasm va video fayl."""

from __future__ import annotations

import logging
import os
import threading
import time

import cv2
import numpy as np

log = logging.getLogger(__name__)

IMAGE_EXT = (".jpg", ".jpeg", ".png", ".bmp")


class StaticImageSource:
    """Sinov uchun: har safar bir xil rasm."""

    def __init__(self, path: str):
        self._frame = cv2.imread(path)
        if self._frame is None:
            raise OSError(f"Rasm ochilmadi: {path}")

    def latest(self) -> np.ndarray | None:
        return self._frame

    def close(self) -> None:
        pass


class StreamSource:
    """Kamera oqimini alohida oqimda uzluksiz o'qiydi va doim eng oxirgi kadrni beradi.

    RTSP bufer to'planib qolmasligi uchun kadrlar tinimsiz o'qiladi; sanash esa har
    SAMPLE_INTERVAL soniyada eng yangi kadrni oladi.
    """

    def __init__(self, url: str, open_timeout_sec: float = 10.0):
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        self._cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        if not self._cap.isOpened():
            raise OSError("Kamera oqimi ochilmadi")
        self._is_file = os.path.isfile(url)
        self._frame: np.ndarray | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        deadline = time.monotonic() + open_timeout_sec
        while self._frame is None and time.monotonic() < deadline and self._thread.is_alive():
            time.sleep(0.05)
        if self._frame is None:
            self.close()
            raise OSError("Kameradan kadr kelmadi")

    def _run(self) -> None:
        failures = 0
        while not self._stop.is_set():
            ok, frame = self._cap.read()
            if not ok:
                if self._is_file:  # sinov videosi tugasa, boshidan
                    self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                failures += 1
                if failures > 50:
                    log.warning("Oqim uzildi")
                    return
                time.sleep(0.1)
                continue
            failures = 0
            with self._lock:
                self._frame = frame
            if self._is_file:  # faylni real vaqt tezligida o'qish
                time.sleep(1 / 25)

    def latest(self) -> np.ndarray | None:
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    def close(self) -> None:
        self._stop.set()
        if self._thread.is_alive() and threading.current_thread() is not self._thread:
            self._thread.join(timeout=2)
        self._cap.release()


def open_source(url: str):
    if url.lower().endswith(IMAGE_EXT):
        return StaticImageSource(url)
    return StreamSource(url)


def check_source(url: str) -> tuple[bool, str | None]:
    """Holat hisoboti uchun (L-7): oqim ochiladimi va kadr beradimi."""
    try:
        open_source(url).close()
        return True, None
    except Exception as exc:  # noqa: BLE001 — har qanday xato "ishlamayapti" degani
        return False, str(exc)
