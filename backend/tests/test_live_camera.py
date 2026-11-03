"""Live phone camera / webcam source for the Live stream.

Runs against an in-memory MongoDB (mongomock); the ML worker process is faked.
    python -m unittest tests.test_live_camera
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    import mongomock
except ImportError:  # pragma: no cover
    mongomock = None


class FakeProcess:
    def __init__(self, command, **kwargs):
        self.command = command

    def poll(self):
        return None  # still running

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


class LiveSourceParsingTests(unittest.TestCase):
    def test_live_sources(self):
        from routes.stream import is_live_source
        for value in ["0", "1", "http://192.168.1.5:8080/video", "http://u:p@10.0.0.2:4747/video", "rtsp://cam/stream"]:
            self.assertTrue(is_live_source(value), value)
        for value in ["clip_01.mp4", "../secret", "123", "http://bad url", "", "file:///etc/passwd"]:
            self.assertFalse(is_live_source(value), value)


@unittest.skipUnless(mongomock, "mongomock is not installed")
class LiveCameraStreamTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import database.mongo as mongo
        mongo.MongoClient = mongomock.MongoClient
        from app import create_app
        cls.app = create_app()
        cls.app.config["TESTING"] = True
        cls.mongo = mongo

    def setUp(self):
        db = self.mongo.get_db()
        db.cameras.delete_many({})
        db.cameras.insert_one({"camera_id": "CAM_001", "name": "Main Road Camera", "latitude": 18.52,
                               "longitude": 73.85, "location_name": "Main Road", "status": "ACTIVE"})
        import routes.stream as stream
        self.stream = stream
        stream.STREAMS.clear()
        self.env = mock.patch.dict(os.environ, {"ML_PYTHON": sys.executable})
        self.env.start()
        self.tmp = tempfile.TemporaryDirectory()
        self.upload_dir = mock.patch.object(stream.Config, "UPLOAD_DIR", self.tmp.name)
        self.upload_dir.start()
        self.popen = mock.patch.object(stream.subprocess, "Popen", side_effect=FakeProcess)
        self.popen.start()
        self.client = self.app.test_client()
        response = self.client.post("/api/auth/login", json={"role": "live", "username": "live", "password": "1234"})
        self.assertEqual(response.status_code, 200, response.get_json())

    def tearDown(self):
        self.popen.stop()
        self.env.stop()
        for item in self.stream.STREAMS.values():
            handle = item.get("log_handle")
            if handle:
                handle.close()
        self.stream.STREAMS.clear()
        self.upload_dir.stop()
        self.tmp.cleanup()

    def start(self, source):
        return self.client.post("/api/live/stream/start", json={"camera_id": "CAM_001", "source": source})

    def test_phone_url_is_passed_to_worker(self):
        url = "http://192.168.1.5:8080/video"
        response = self.start(url)
        self.assertEqual(response.status_code, 201, response.get_json())
        self.assertTrue(response.get_json()["live_source"])
        stream = self.stream.STREAMS[response.get_json()["stream_id"]]
        command = stream["process"].command
        self.assertEqual(command[command.index("--source") + 1], url)

    def test_webcam_index_is_accepted(self):
        response = self.start("1")
        self.assertEqual(response.status_code, 201, response.get_json())

    def test_path_outside_sample_videos_is_rejected(self):
        response = self.start("../backend/.env")
        self.assertIn(response.status_code, (400, 404))

    def test_preview_served_once_worker_writes_it(self):
        stream_id = self.start("0").get_json()["stream_id"]
        self.assertEqual(self.client.get(f"/api/live/stream/{stream_id}/preview").status_code, 404)

        preview = Path(self.stream.STREAMS[stream_id]["status_file"]).with_suffix(".jpg")
        preview.write_bytes(b"\xff\xd8\xff\xd9")
        try:
            response = self.client.get(f"/api/live/stream/{stream_id}/preview")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, "image/jpeg")
        finally:
            preview.unlink()

    def test_preview_needs_live_login(self):
        stream_id = self.start("0").get_json()["stream_id"]
        other = self.app.test_client()
        self.assertEqual(other.get(f"/api/live/stream/{stream_id}/preview").status_code, 403)


if __name__ == "__main__":
    unittest.main()
