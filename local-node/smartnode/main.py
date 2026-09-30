"""Lokal miyaning asosiy sikli.

1. Serverdan vazifa kutadi (long polling).
2. Har bir vazifa uchun alohida oqimda 60 soniya sanaydi (bir vaqtda ko'pi bilan MAX_PARALLEL ta, L-5).
3. Natijani yuboradi; yuborilmasa navbatga qo'yadi (L-6).
4. Har HEARTBEAT_SEC soniyada kameralarni tekshirib, holatni yuboradi (L-7).
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import requests

from . import __version__
from .client import ServerClient
from .config import Config, load_config
from .counter import CountError, YoloDetector, count_session
from .sources import check_source, open_source

log = logging.getLogger("smartnode")


class Node:
    def __init__(self, cfg: Config, client: ServerClient, detector):
        self.cfg = cfg
        self.client = client
        self.detector = detector
        self.pool = ThreadPoolExecutor(max_workers=cfg.max_parallel, thread_name_prefix="count")
        self.stop = threading.Event()

    def run_job(self, job: dict) -> None:
        sid = job["session_id"]
        room = job.get("room_name", "?")
        log.info("Sanash boshlandi: xona %s, kanal %s, sessiya %s", room, job["channel"], sid)
        try:
            source = open_source(self.cfg.stream_url(job["channel"]))
            result = count_session(
                source,
                self.detector,
                duration_sec=job.get("duration_sec", 60),
                interval_sec=self.cfg.sample_interval,
                subtract_teacher=job.get("subtract_teacher", True),
            )
            log.info("Xona %s: %s o'quvchi (kadrlar: %s)", room, result.camera_count, result.per_frame)
            payload = {"camera_count": result.camera_count, "started_at": result.started_at, "ended_at": result.ended_at}
        except (OSError, ValueError, CountError) as exc:
            log.warning("Xona %s: sanab bo'lmadi: %s", room, exc)
            payload = {"error": str(exc)}
        except Exception:  # noqa: BLE001 — kutilmagan xato ham serverga xabar qilinadi
            log.exception("Xona %s: kutilmagan xato", room)
            payload = {"error": "Lokal miyada kutilmagan xato"}
        self.client.send_result(sid, payload)

    def heartbeat_loop(self) -> None:
        while not self.stop.is_set():
            try:
                cameras = self.client.config()
                report = []
                for cam in cameras:
                    try:
                        ok, error = check_source(self.cfg.stream_url(cam["channel"]))
                    except ValueError as exc:
                        ok, error = False, str(exc)
                    report.append({"camera_id": cam["camera_id"], "ok": ok, "error": error})
                    if not ok:
                        log.warning("Kamera ishlamayapti: xona %s — %s", cam["room_name"], error)
                self.client.heartbeat(report)
                self.client.flush_queue()
            except Exception as exc:  # noqa: BLE001 — hisobot keyingi safar qayta yuboriladi
                log.warning("Holat hisoboti yuborilmadi: %s", exc)
            self.stop.wait(self.cfg.heartbeat_sec)

    def run(self) -> None:
        threading.Thread(target=self.heartbeat_loop, daemon=True, name="heartbeat").start()
        backoff = 1
        while not self.stop.is_set():
            try:
                jobs = self.client.wait_jobs()
                backoff = 1
                for job in jobs:
                    self.pool.submit(self.run_job, job)
                if jobs:
                    self.client.flush_queue()
            except PermissionError as exc:
                log.error("%s", exc)
                self.stop.wait(60)
            except (requests.ConnectionError, requests.Timeout, requests.HTTPError) as exc:
                log.warning("Server bilan aloqa yo'q (%s). %s soniyadan keyin qayta urinamiz", exc.__class__.__name__, backoff)
                self.stop.wait(backoff)
                backoff = min(backoff * 2, 60)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = load_config()
    log.info("SmartDavomat lokal miya %s. Server: %s", __version__, cfg.server_url)
    log.info("Model yuklanmoqda: %s", cfg.model)
    detector = YoloDetector(cfg.model, cfg.confidence, cfg.image_size)
    client = ServerClient(cfg.server_url, cfg.node_token, cfg.queue_file)
    node = Node(cfg, client, detector)
    try:
        node.run()
    except KeyboardInterrupt:
        node.stop.set()


if __name__ == "__main__":
    main()
