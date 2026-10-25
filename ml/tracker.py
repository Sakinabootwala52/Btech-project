from collections import defaultdict, deque
from math import atan2, degrees, hypot

from config import (
    CAMERA_CALIBRATED,
    METERS_PER_PIXEL,
    MIN_TRACK_HISTORY,
)


class TrackHistory:
    def __init__(self, maxlen=30):
        self.points = defaultdict(
            lambda: deque(maxlen=maxlen)
        )

        self.speeds = defaultdict(
            lambda: deque(maxlen=maxlen)
        )

        self.real_speeds = defaultdict(
            lambda: deque(maxlen=maxlen)
        )

    def update(self, detections, fps):
        frame_features = []

        for det in detections:

            track_id = det["track_id"]

            if track_id is None:
                continue

            center = tuple(det["center"])

            history = self.points[track_id]

            speed_px_per_sec = 0.0
            speed_m_per_sec = None
            speed_kmh = None

            direction = None

            # ----------------------------------------------------
            # MOTION
            # ----------------------------------------------------

            if history:

                previous = history[-1]

                pixels_per_frame = hypot(
                    center[0] - previous[0],
                    center[1] - previous[1],
                )

                speed_px_per_sec = (
                    pixels_per_frame
                    * max(fps, 1.0)
                )

                # ------------------------------------------------
                # REAL-WORLD SPEED
                # ------------------------------------------------

                if CAMERA_CALIBRATED:

                    speed_m_per_sec = (
                        speed_px_per_sec
                        * METERS_PER_PIXEL
                    )

                    speed_kmh = (
                        speed_m_per_sec
                        * 3.6
                    )

                    self.real_speeds[
                        track_id
                    ].append(
                        speed_m_per_sec
                    )

            # ----------------------------------------------------
            # DIRECTION CHANGE
            # ----------------------------------------------------

            if len(history) >= 2:

                old = history[-2]

                dx1 = (
                    previous[0]
                    - old[0]
                )

                dy1 = (
                    previous[1]
                    - old[1]
                )

                dx2 = (
                    center[0]
                    - previous[0]
                )

                dy2 = (
                    center[1]
                    - previous[1]
                )

                direction = direction_change(
                    dx1,
                    dy1,
                    dx2,
                    dy2,
                )

            # ----------------------------------------------------
            # SAVE TRACK HISTORY
            # ----------------------------------------------------

            history.append(center)

            self.speeds[
                track_id
            ].append(
                speed_px_per_sec
            )

            feature = {
                "track_id": track_id,

                # Existing image-space metric.
                "speed_px_per_sec": (
                    speed_px_per_sec
                ),

                # New calibrated metric.
                "speed_m_per_sec": (
                    speed_m_per_sec
                ),

                # New calibrated metric.
                "speed_kmh": (
                    speed_kmh
                ),

                # Useful flag for UI/reporting.
                "speed_calibrated": (
                    CAMERA_CALIBRATED
                ),

                "direction_change_deg": (
                    direction
                ),

                "history_length": (
                    len(history)
                ),

                "center": center,

                "bbox": det["bbox"],
            }

            frame_features.append(
                feature
            )

        return frame_features

    def get_speed_drop(self, track_id):
        """
        Calculate speed reduction using the existing
        image-space speed metric.

        This is intentionally preserved because
        accident detection thresholds were designed
        around relative motion.
        """

        values = list(
            self.speeds[track_id]
        )

        if len(values) < 4:
            return 0.0, None, None

        recent = (
            sum(values[-2:])
            / 2
        )

        previous_window = (
            values[:-2]
        )

        if not previous_window:
            return 0.0, recent, recent

        previous = (
            sum(
                previous_window[-4:]
            )
            / min(
                4,
                len(previous_window),
            )
        )

        if previous <= 1e-6:
            return (
                0.0,
                previous,
                recent,
            )

        drop = max(
            0.0,
            (
                previous - recent
            )
            / previous,
        )

        return (
            drop,
            previous,
            recent,
        )

    def get_real_speed(self, track_id):
        """
        Return the latest calibrated speed
        in meters/second.

        Returns None when calibration is unavailable.
        """

        if not CAMERA_CALIBRATED:
            return None

        values = list(
            self.real_speeds[track_id]
        )

        if not values:
            return None

        return values[-1]

    def get_real_speed_kmh(self, track_id):
        """
        Return the latest calibrated speed
        in km/h.

        Returns None when calibration is unavailable.
        """

        speed_m_per_sec = (
            self.get_real_speed(
                track_id
            )
        )

        if speed_m_per_sec is None:
            return None

        return speed_m_per_sec * 3.6


def direction_change(
    dx1,
    dy1,
    dx2,
    dy2,
):
    if (
        hypot(dx1, dy1) < 1e-6
        or hypot(dx2, dy2) < 1e-6
    ):
        return 0.0

    a1 = degrees(
        atan2(
            dy1,
            dx1,
        )
    )

    a2 = degrees(
        atan2(
            dy2,
            dx2,
        )
    )

    difference = abs(
        a2 - a1
    )

    return min(
        difference,
        360 - difference,
    )