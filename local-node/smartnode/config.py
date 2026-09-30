"""Sozlamalar muhit o'zgaruvchilaridan o'qiladi (.env yoki docker-compose)."""

import json
import os
from dataclasses import dataclass, field


def _env(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


@dataclass
class Config:
    server_url: str
    node_token: str
    # NVR oqimi manzili andozasi. {channel} o'rniga kamera kanali qo'yiladi.
    # Hikvision: rtsp://LOGIN:PAROL@192.168.1.64:554/Streaming/Channels/{channel}01
    # Dahua:     rtsp://LOGIN:PAROL@192.168.1.108:554/cam/realmonitor?channel={channel}&subtype=0
    nvr_url_template: str | None
    # Alohida kanallar uchun aniq manzillar: {"3": "rtsp://..."} yoki sinov uchun rasm/video fayl.
    camera_urls: dict[str, str] = field(default_factory=dict)
    model: str = "yolo11n.pt"
    confidence: float = 0.35
    image_size: int = 960
    sample_interval: float = 2.0
    max_parallel: int = 10
    heartbeat_sec: int = 300
    queue_file: str = "data/results-queue.jsonl"

    def stream_url(self, channel: str) -> str:
        if channel in self.camera_urls:
            return self.camera_urls[channel]
        if not self.nvr_url_template:
            raise ValueError(f"{channel}-kanal uchun oqim manzili sozlanmagan (NVR_URL_TEMPLATE yoki CAMERA_URLS)")
        return self.nvr_url_template.format(channel=channel)


def load_config() -> Config:
    server_url = _env("SERVER_URL")
    token = _env("NODE_TOKEN")
    if not server_url or not token:
        raise SystemExit("SERVER_URL va NODE_TOKEN berilishi shart (admin paneli -> Xonalar va kameralar -> Lokal miya)")
    return Config(
        server_url=server_url.rstrip("/"),
        node_token=token,
        nvr_url_template=_env("NVR_URL_TEMPLATE"),
        camera_urls=json.loads(_env("CAMERA_URLS", "{}")),
        model=_env("MODEL", "yolo11n.pt"),
        confidence=float(_env("CONFIDENCE", "0.35")),
        image_size=int(_env("IMAGE_SIZE", "960")),
        sample_interval=float(_env("SAMPLE_INTERVAL", "2")),
        max_parallel=int(_env("MAX_PARALLEL", "10")),
        heartbeat_sec=int(_env("HEARTBEAT_SEC", "300")),
        queue_file=_env("QUEUE_FILE", "data/results-queue.jsonl"),
    )
