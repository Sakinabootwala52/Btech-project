import requests
from config import BACKEND_URL

class BackendClient:
    def __init__(self, base_url=BACKEND_URL, timeout=10):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def send_accident_event(self, event):
        payload = {
            "camera_id": event["camera_id"],
            "timestamp": event["timestamp"],
            "confidence": event["confidence"],
            "speed_before": event.get("speed_before"),
            "speed_after": event.get("speed_after"),
            "video_clip": event.get("video_clip"),
            "severity": event.get("severity"),
            "speed_unit": event.get("severity", {}).get(
                "speed_unit", "image_space_relative"
            ),
        }

        response = requests.post(
            f"{self.base_url}/api/detect-accident",
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()
