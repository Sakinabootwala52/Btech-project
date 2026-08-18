from collections import defaultdict, deque
from math import atan2, degrees, hypot

from config import MIN_TRACK_HISTORY

class TrackHistory:
    def __init__(self, maxlen=30):
        self.points = defaultdict(lambda: deque(maxlen=maxlen))
        self.speeds = defaultdict(lambda: deque(maxlen=maxlen))

    def update(self, detections, fps):
        frame_features = []

        for det in detections:
            track_id = det["track_id"]
            if track_id is None:
                continue

            center = tuple(det["center"])
            history = self.points[track_id]

            speed = 0.0
            direction = None

            if history:
                previous = history[-1]
                pixels_per_frame = hypot(
                    center[0] - previous[0],
                    center[1] - previous[1]
                )
                speed = pixels_per_frame * max(fps, 1.0)

                if len(history) >= 2:
                    old = history[-2]
                    dx1 = previous[0] - old[0]
                    dy1 = previous[1] - old[1]
                    dx2 = center[0] - previous[0]
                    dy2 = center[1] - previous[1]

                    direction = direction_change(dx1, dy1, dx2, dy2)

            history.append(center)
            self.speeds[track_id].append(speed)

            frame_features.append({
                "track_id": track_id,
                "speed_px_per_sec": speed,
                "direction_change_deg": direction,
                "history_length": len(history),
                "center": center,
                "bbox": det["bbox"],
            })

        return frame_features

    def get_speed_drop(self, track_id):
        values = list(self.speeds[track_id])
        if len(values) < 4:
            return 0.0, None, None

        recent = sum(values[-2:]) / 2
        previous_window = values[:-2]
        if not previous_window:
            return 0.0, recent, recent

        previous = sum(previous_window[-4:]) / min(4, len(previous_window))

        if previous <= 1e-6:
            return 0.0, previous, recent

        drop = max(0.0, (previous - recent) / previous)
        return drop, previous, recent


def direction_change(dx1, dy1, dx2, dy2):
    if hypot(dx1, dy1) < 1e-6 or hypot(dx2, dy2) < 1e-6:
        return 0.0

    a1 = degrees(atan2(dy1, dx1))
    a2 = degrees(atan2(dy2, dx2))
    difference = abs(a2 - a1)
    return min(difference, 360 - difference)
