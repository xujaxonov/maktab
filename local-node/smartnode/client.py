"""Markaziy server bilan aloqa. Faqat chiquvchi so'rovlar (X-1).

Natija yuborilmasa (internet yo'q), u faylga yoziladi va keyin qayta yuboriladi (L-6).
"""

from __future__ import annotations

import json
import logging
import os
import threading

import requests

from . import __version__

log = logging.getLogger(__name__)


class ServerClient:
    def __init__(self, server_url: str, token: str, queue_file: str):
        self._base = f"{server_url}/api/node"
        self._session = requests.Session()
        self._session.headers.update({"Authorization": f"Bearer {token}", "X-Node-Version": __version__})
        self._queue_file = queue_file
        self._queue_lock = threading.Lock()
        os.makedirs(os.path.dirname(queue_file) or ".", exist_ok=True)

    def _request(self, method: str, path: str, *, timeout: float = 15, **kwargs):
        res = self._session.request(method, f"{self._base}{path}", timeout=timeout, **kwargs)
        if res.status_code == 401:
            raise PermissionError("Server tokenni rad etdi: admin panelidan yangi token oling")
        res.raise_for_status()
        return res.json()

    def wait_jobs(self, wait_sec: int = 25) -> list[dict]:
        return self._request("GET", f"/jobs?wait={wait_sec}", timeout=wait_sec + 10)["jobs"]

    def heartbeat(self, cameras: list[dict]) -> list[dict]:
        return self._request("POST", "/heartbeat", json={"cameras": cameras})["cameras"]

    def config(self) -> list[dict]:
        return self._request("GET", "/config")["cameras"]

    # ---------- Natijalar va navbat ----------
    def send_result(self, session_id: int, payload: dict) -> None:
        try:
            self._post_result(session_id, payload)
        except (requests.ConnectionError, requests.Timeout) as exc:
            log.warning("Natija yuborilmadi (%s), navbatga qo'yildi: sessiya %s", exc.__class__.__name__, session_id)
            self._enqueue(session_id, payload)

    def _post_result(self, session_id: int, payload: dict) -> None:
        try:
            self._request("POST", f"/sessions/{session_id}/result", json=payload)
        except requests.HTTPError as exc:
            # 4xx: server natijani qabul qilmaydi (masalan, sessiya topilmadi). Qayta urinish foydasiz.
            if exc.response is not None and 400 <= exc.response.status_code < 500:
                log.error("Server natijani rad etdi: sessiya %s, %s", session_id, exc.response.text[:200])
                return
            raise

    def _enqueue(self, session_id: int, payload: dict) -> None:
        with self._queue_lock, open(self._queue_file, "a", encoding="utf-8") as f:
            f.write(json.dumps({"session_id": session_id, "payload": payload}) + "\n")

    def flush_queue(self) -> int:
        """Navbatdagi natijalarni yuborishga urinadi. Yuborilganlar sonini qaytaradi."""
        with self._queue_lock:
            if not os.path.exists(self._queue_file):
                return 0
            with open(self._queue_file, encoding="utf-8") as f:
                items = [json.loads(line) for line in f if line.strip()]
            left, sent = [], 0
            for item in items:
                if left:  # tarmoq yana uzildi: qolganlarini keyinga
                    left.append(item)
                    continue
                try:
                    self._post_result(item["session_id"], item["payload"])
                    sent += 1
                except (requests.ConnectionError, requests.Timeout, requests.HTTPError):
                    left.append(item)
            tmp = f"{self._queue_file}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.writelines(json.dumps(i) + "\n" for i in left)
            os.replace(tmp, self._queue_file)
        if sent:
            log.info("Navbatdan %s ta natija yuborildi", sent)
        return sent
