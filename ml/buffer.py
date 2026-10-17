from collections import deque
from dataclasses import dataclass

@dataclass
class BufferedFrame:
    frame_index: int
    timestamp_seconds: float
    frame: object

class RollingVideoBuffer:
    def __init__(self, max_seconds, fps):
        max_frames = max(1, int(max_seconds * max(fps, 1.0)))
        self.frames = deque(maxlen=max_frames)

    def add(self, frame_index, timestamp_seconds, frame):
        self.frames.append(
            BufferedFrame(frame_index, timestamp_seconds, frame.copy())
        )

    def recent(self):
        return list(self.frames)

    def around_event(self, event_time, clip_seconds):
        half = clip_seconds / 2.0
        return [
            item for item in self.frames
            if event_time - half <= item.timestamp_seconds <= event_time + half
        ]
