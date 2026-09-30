"""Sanash mantig'i (L-3): 60 soniya davomida kadrlarni olib, har birida odamlarni sanaydi.

Natija — kadrlar sanog'ining medianasi: bir-ikki kadrda kimdir to'silib qolsa yoki
bir lahzaga boshqa odam o'tib ketsa, natija buzilmaydi. Kadrlar diskka yozilmaydi (L-4).
"""

from __future__ import annotations

import statistics
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Protocol

import numpy as np

MIN_FRAMES = 3


class FrameSource(Protocol):
    def latest(self) -> np.ndarray | None: ...
    def close(self) -> None: ...


class Detector(Protocol):
    def count_people(self, frame: np.ndarray) -> int: ...


@dataclass
class CountResult:
    camera_count: int
    started_at: str
    ended_at: str
    frames: int
    per_frame: list[int]


class CountError(Exception):
    pass


def aggregate(per_frame: list[int], subtract_teacher: bool) -> int:
    """Kadrlar sanog'idan yakuniy son: mediana (yarimini yuqoriga yaxlitlab), o'qituvchi ayiriladi."""
    if len(per_frame) < MIN_FRAMES:
        raise CountError(f"Kameradan yetarli kadr olinmadi ({len(per_frame)} ta)")
    median = statistics.median(per_frame)
    count = int(median + 0.5)
    if subtract_teacher:
        count -= 1
    return max(count, 0)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def count_session(
    source: FrameSource,
    detector: Detector,
    *,
    duration_sec: float,
    interval_sec: float,
    subtract_teacher: bool,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> CountResult:
    started_at = _now_iso()
    start = clock()
    per_frame: list[int] = []
    try:
        while clock() - start < duration_sec:
            frame = source.latest()
            if frame is not None:
                per_frame.append(detector.count_people(frame))
            sleep(interval_sec)
    finally:
        source.close()
    ended_at = _now_iso()
    return CountResult(
        camera_count=aggregate(per_frame, subtract_teacher),
        started_at=started_at,
        ended_at=ended_at,
        frames=len(per_frame),
        per_frame=per_frame,
    )


class YoloDetector:
    """YOLO bilan odamlarni aniqlash. Bitta model hamma xonalar uchun ishlatiladi, shuning uchun qulf bilan."""

    PERSON_CLASS = 0

    def __init__(self, model: str, confidence: float, image_size: int):
        from ultralytics import YOLO  # og'ir kutubxona, faqat kerak bo'lganda yuklanadi

        self._model = YOLO(model)
        self._confidence = confidence
        self._image_size = image_size
        self._lock = threading.Lock()

    def count_people(self, frame: np.ndarray) -> int:
        with self._lock:
            result = self._model.predict(
                frame,
                classes=[self.PERSON_CLASS],
                conf=self._confidence,
                imgsz=self._image_size,
                verbose=False,
            )[0]
        return int(len(result.boxes))
