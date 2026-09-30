import json
import os
import tempfile
import unittest
from unittest import mock

import numpy as np
import requests

from smartnode.client import ServerClient
from smartnode.config import Config
from smartnode.counter import CountError, aggregate, count_session


class FakeSource:
    def __init__(self, frames):
        self.frames = list(frames)
        self.closed = False

    def latest(self):
        return self.frames.pop(0) if self.frames else None

    def close(self):
        self.closed = True


class FakeDetector:
    """Kadr o'rniga son beriladi: kadr = np.array(son)."""

    def count_people(self, frame):
        return int(frame)


class FakeClock:
    def __init__(self):
        self.t = 0.0

    def now(self):
        return self.t

    def sleep(self, sec):
        self.t += sec


class AggregateTest(unittest.TestCase):
    def test_median_minus_teacher(self):
        # Bir kadrda 2 kishi to'silib qolgan, bir kadrda birov o'tib ketgan: mediana barqaror.
        self.assertEqual(aggregate([29, 29, 27, 29, 30, 29], subtract_teacher=True), 28)

    def test_without_teacher(self):
        self.assertEqual(aggregate([10, 11, 11, 12], subtract_teacher=False), 11)

    def test_half_rounds_up(self):
        self.assertEqual(aggregate([10, 11, 10, 11], subtract_teacher=False), 11)

    def test_never_negative(self):
        self.assertEqual(aggregate([0, 0, 0], subtract_teacher=True), 0)

    def test_too_few_frames(self):
        with self.assertRaises(CountError):
            aggregate([5, 5], subtract_teacher=True)


class CountSessionTest(unittest.TestCase):
    def test_samples_every_interval_for_duration(self):
        clock = FakeClock()
        source = FakeSource(np.array(n) for n in [31] * 40)
        result = count_session(
            source, FakeDetector(), duration_sec=60, interval_sec=2, subtract_teacher=True, sleep=clock.sleep, clock=clock.now
        )
        self.assertEqual(result.frames, 30)
        self.assertEqual(result.camera_count, 30)
        self.assertTrue(source.closed)
        self.assertLess(result.started_at, result.ended_at + "~")

    def test_no_frames_is_error_and_source_closed(self):
        clock = FakeClock()
        source = FakeSource([])
        with self.assertRaises(CountError):
            count_session(source, FakeDetector(), duration_sec=10, interval_sec=2, subtract_teacher=True, sleep=clock.sleep, clock=clock.now)
        self.assertTrue(source.closed)


class ConfigTest(unittest.TestCase):
    def test_stream_url_template_and_override(self):
        cfg = Config("http://s", "t", "rtsp://u:p@nvr/Streaming/Channels/{channel}01", {"7": "/video/test.mp4"})
        self.assertEqual(cfg.stream_url("3"), "rtsp://u:p@nvr/Streaming/Channels/301")
        self.assertEqual(cfg.stream_url("7"), "/video/test.mp4")

    def test_missing_template(self):
        with self.assertRaises(ValueError):
            Config("http://s", "t", None).stream_url("3")


class QueueTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.queue = os.path.join(self.dir.name, "q.jsonl")
        self.client = ServerClient("http://server", "token", self.queue)

    def tearDown(self):
        self.dir.cleanup()

    def test_result_queued_when_offline_and_flushed_later(self):
        with mock.patch.object(self.client, "_request", side_effect=requests.ConnectionError()):
            self.client.send_result(5, {"camera_count": 28})
            self.client.send_result(6, {"camera_count": 30})
            self.assertEqual(self.client.flush_queue(), 0)
        with open(self.queue, encoding="utf-8") as f:
            self.assertEqual([json.loads(l)["session_id"] for l in f], [5, 6])

        sent = []
        with mock.patch.object(self.client, "_request", side_effect=lambda m, p, **kw: sent.append((p, kw["json"]))):
            self.assertEqual(self.client.flush_queue(), 2)
        self.assertEqual(sent[0], ("/sessions/5/result", {"camera_count": 28}))
        with open(self.queue, encoding="utf-8") as f:
            self.assertEqual(f.read(), "")

    def test_rejected_result_is_not_retried(self):
        response = mock.Mock(status_code=404, text="Sessiya topilmadi")
        with mock.patch.object(self.client, "_request", side_effect=requests.HTTPError(response=response)):
            self.client.send_result(9, {"camera_count": 1})
        self.assertFalse(os.path.exists(self.queue) and open(self.queue).read())


if __name__ == "__main__":
    unittest.main()
