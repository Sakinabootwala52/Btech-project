from collections import defaultdict
import math

from config import (
    ACCIDENT_THRESHOLD,
    COLLISION_IOU_THRESHOLD,
    DIRECTION_CHANGE_DEGREES,
    LOW_SEVERITY_SCORE,
    MEDIUM_SEVERITY_SCORE,
    MIN_ABNORMAL_FRAMES,
    MIN_STOP_SPEED_RATIO,
    SUDDEN_SPEED_DROP_RATIO,
)


class AccidentDetector:
    """
    Accident detection + potential severity estimation.

    Accident detection uses multiple visual/motion signals:

        1. Relative speed change
        2. Trajectory/direction change
        3. Vehicle interaction/proximity
        4. Temporal persistence

    IMPORTANT:
        The speed values produced by the current system are
        image-space relative motion, NOT km/h.

    Severity is decision support only and is NOT a medical diagnosis.
    """

    def __init__(self, threshold=ACCIDENT_THRESHOLD):
        self.threshold = threshold

        # Number of consecutive frames in which a track shows
        # abnormal behaviour.
        self.abnormal_streak = defaultdict(int)

        # Remember the last evidence score for each vehicle.
        self.last_scores = defaultdict(float)

    def score(self, detections, track_features, track_history):

        if not track_features:
            return empty_result()

        evidence_rows = []

        # =========================================================
        # 1. Analyse every tracked vehicle
        # =========================================================

        for feature in track_features:

            track_id = feature["track_id"]

            drop, before, after = (
                track_history.get_speed_drop(track_id)
            )

            direction = (
                feature.get("direction_change_deg")
                or 0.0
            )

            # -----------------------------------------------------
            # Speed anomaly
            # -----------------------------------------------------

            speed_anomaly = (
                before is not None
                and after is not None
                and before > 0
                and drop >= SUDDEN_SPEED_DROP_RATIO
            )

            # Very large speed reduction.
            strong_speed_anomaly = (
                before is not None
                and after is not None
                and before > 0
                and drop >= 0.70
            )

            # Vehicle almost stops after motion.
            sudden_stop = (
                before is not None
                and after is not None
                and before > 0
                and (
                    after / before
                    <= MIN_STOP_SPEED_RATIO
                )
            )

            # -----------------------------------------------------
            # Direction / trajectory anomaly
            # -----------------------------------------------------

            direction_anomaly = (
                direction >= DIRECTION_CHANGE_DEGREES
            )

            strong_direction_anomaly = (
                direction >= DIRECTION_CHANGE_DEGREES * 1.35
            )

            # -----------------------------------------------------
            # Temporal persistence
            # -----------------------------------------------------

            abnormal_now = (
                speed_anomaly
                or direction_anomaly
            )

            if abnormal_now:
                self.abnormal_streak[track_id] += 1
            else:
                self.abnormal_streak[track_id] = max(
                    0,
                    self.abnormal_streak[track_id] - 1
                )

            # We don't require 8 frames anymore.
            #
            # The old detector was too strict for the dataset.
            #
            persistent = (
                self.abnormal_streak[track_id]
                >= max(3, MIN_ABNORMAL_FRAMES // 2)
            )

            # -----------------------------------------------------
            # Per-track evidence score
            # -----------------------------------------------------

            speed_score = 0.0

            if before is not None and after is not None:

                speed_score = min(
                    drop / max(
                        SUDDEN_SPEED_DROP_RATIO,
                        0.01
                    ),
                    1.0
                )

            direction_score = min(
                direction / max(
                    DIRECTION_CHANGE_DEGREES,
                    1.0
                ),
                1.0
            )

            persistence_score = min(
                self.abnormal_streak[track_id] / 5.0,
                1.0
            )

            track_score = (
                0.50 * speed_score
                + 0.25 * direction_score
                + 0.25 * persistence_score
            )

            self.last_scores[track_id] = track_score

            evidence_rows.append({
                "track_id": track_id,

                "speed_drop": drop,

                "speed_before": before,

                "speed_after": after,

                "direction_change": direction,

                "speed_anomaly": speed_anomaly,

                "strong_speed_anomaly": (
                    strong_speed_anomaly
                ),

                "direction_anomaly": (
                    direction_anomaly
                ),

                "strong_direction_anomaly": (
                    strong_direction_anomaly
                ),

                "sudden_stop": sudden_stop,

                "persistent": persistent,

                "streak": self.abnormal_streak[
                    track_id
                ],

                "track_score": round(
                    track_score,
                    4
                ),
            })

        # =========================================================
        # 2. Vehicle interaction
        # =========================================================

        collision = collision_proximity(
            detections,
            iou_threshold=COLLISION_IOU_THRESHOLD,
        )

        # More tolerant interaction test.
        proximity = vehicle_proximity(
            detections
        )

        interaction = (
            collision
            or proximity
        )

        # =========================================================
        # 3. Gather strongest evidence
        # =========================================================

        best_speed_drop = max(
            (
                r["speed_drop"]
                for r in evidence_rows
            ),
            default=0.0
        )

        best_speed_before = max(
            (
                r["speed_before"]
                for r in evidence_rows
                if r["speed_before"] is not None
            ),
            default=None
        )

        best_speed_after = max(
            (
                r["speed_after"]
                for r in evidence_rows
                if r["speed_after"] is not None
            ),
            default=None
        )

        best_direction = max(
            (
                r["direction_change"]
                for r in evidence_rows
            ),
            default=0.0
        )

        strongest_track = max(
            evidence_rows,
            key=lambda r: r["track_score"],
            default=None
        )

        # =========================================================
        # 4. Evidence components
        # =========================================================

        speed_component = min(
            best_speed_drop
            / max(
                SUDDEN_SPEED_DROP_RATIO,
                0.01
            ),
            1.0
        )

        direction_component = min(
            best_direction
            / max(
                DIRECTION_CHANGE_DEGREES,
                1.0
            ),
            1.0
        )

        interaction_component = (
            1.0 if interaction else 0.0
        )

        persistent_component = (
            1.0
            if any(
                r["persistent"]
                for r in evidence_rows
            )
            else 0.0
        )

        stop_component = (
            1.0
            if any(
                r["sudden_stop"]
                for r in evidence_rows
            )
            else 0.0
        )

        # =========================================================
        # 5. Accident confidence
        # =========================================================
        #
        # This is a confidence/evidence score.
        # It is NOT model accuracy.
        #
        # Interaction gets strong weight because normal braking
        # should not automatically become an accident.
        #

        confidence = (
            0.40 * speed_component
            + 0.20 * direction_component
            + 0.25 * interaction_component
            + 0.10 * persistent_component
            + 0.05 * stop_component
        )

        confidence = min(
            max(confidence, 0.0),
            1.0
        )

        # =========================================================
        # 6. Accident decision
        # =========================================================
        #
        # Instead of requiring ALL signals, use several valid
        # accident pathways.
        #

        strong_speed = any(
            r["strong_speed_anomaly"]
            for r in evidence_rows
        )

        speed_signal = any(
            r["speed_anomaly"]
            for r in evidence_rows
        )

        direction_signal = any(
            r["direction_anomaly"]
            for r in evidence_rows
        )

        persistent_signal = any(
            r["persistent"]
            for r in evidence_rows
        )

        stop_signal = any(
            r["sudden_stop"]
            for r in evidence_rows
        )

        # PATH 1:
        # Vehicle interaction + meaningful speed change.
        collision_accident = (
            interaction
            and speed_signal
            and (
                persistent_signal
                or stop_signal
                or direction_signal
            )
        )

        # PATH 2:
        # Very strong speed disruption + temporal persistence.
        strong_motion_accident = (
            strong_speed
            and persistent_signal
        )

        # PATH 3:
        # Interaction + trajectory disruption.
        trajectory_accident = (
            interaction
            and direction_signal
            and persistent_signal
        )

        # Final decision.
        accident_detected = (
            confidence >= self.threshold
            and (
                collision_accident
                or strong_motion_accident
                or trajectory_accident
            )
        )

        # =========================================================
        # 7. Severity
        # =========================================================

        severity = estimate_severity(
            evidence_rows,
            collision=interaction,
        )

        return {
            "accident_detected": (
                accident_detected
            ),

            "confidence": round(
                confidence,
                4
            ),

            "speed_anomaly": (
                speed_signal
            ),

            "trajectory_anomaly": (
                direction_signal
            ),

            "collision_proximity": (
                interaction
            ),

            "persistent_abnormal_motion": (
                persistent_signal
            ),

            "speed_before": (
                round(
                    best_speed_before,
                    2
                )
                if best_speed_before is not None
                else None
            ),

            "speed_after": (
                round(
                    best_speed_after,
                    2
                )
                if best_speed_after is not None
                else None
            ),

            "evidence": {
                "strong_speed_anomaly": (
                    strong_speed
                ),

                "direction_change": round(
                    best_direction,
                    2
                ),

                "vehicle_interaction": (
                    interaction
                ),

                "persistent_motion": (
                    persistent_signal
                ),

                "sudden_stop": (
                    stop_signal
                ),

                "strongest_track_score": (
                    round(
                        strongest_track[
                            "track_score"
                        ],
                        4
                    )
                    if strongest_track
                    else 0.0
                ),
            },

            "severity": severity,
        }


# =============================================================
# SEVERITY
# =============================================================

def estimate_severity(
    rows,
    collision
):
    """
    Estimates potential impact severity.

    This is NOT medical severity.

    It is only a decision-support indicator based on:
        - relative motion change
        - vehicle interaction
        - post-event slowdown
    """

    if not rows:
        return {
            "level": "LOW",
            "score": 0.0,
            "basis": [],
            "relative_speed_before": None,
            "speed_unit": (
                "image_space_relative"
            ),
        }

    best_drop = max(
        (
            r["speed_drop"]
            for r in rows
        ),
        default=0.0
    )

    best_before = max(
        (
            r["speed_before"]
            for r in rows
            if r["speed_before"] is not None
        ),
        default=0.0
    )

    stop_after_impact = any(
        r["speed_before"] is not None
        and r["speed_after"] is not None
        and r["speed_before"] > 0
        and (
            r["speed_after"]
            / r["speed_before"]
        ) <= MIN_STOP_SPEED_RATIO
        for r in rows
    )

    motion_score = min(
        best_drop
        / max(
            SUDDEN_SPEED_DROP_RATIO,
            0.01
        ),
        1.0
    )

    interaction_score = (
        1.0 if collision else 0.0
    )

    stop_score = (
        1.0 if stop_after_impact else 0.0
    )

    score = (
        0.55 * motion_score
        + 0.25 * interaction_score
        + 0.20 * stop_score
    )

    score = min(
        max(score, 0.0),
        1.0
    )

    if score >= MEDIUM_SEVERITY_SCORE:
        level = "HIGH"

    elif score >= LOW_SEVERITY_SCORE:
        level = "MEDIUM"

    else:
        level = "LOW"

    basis = [
        "relative_motion_change"
    ]

    if collision:
        basis.append(
            "vehicle_interaction"
        )

    if stop_after_impact:
        basis.append(
            "post_event_slowdown"
        )

    return {
        "level": level,

        "score": round(
            score,
            4
        ),

        "basis": basis,

        "relative_speed_before": (
            round(
                best_before,
                2
            )
            if best_before
            else None
        ),

        "speed_unit": (
            "image_space_relative"
        ),
    }


# =============================================================
# VEHICLE INTERACTION
# =============================================================

def collision_proximity(
    detections,
    iou_threshold=0.15
):
    """
    Original IoU-based interaction test.
    """

    boxes = [
        d["bbox"]
        for d in detections
        if d.get("bbox") is not None
    ]

    for i in range(len(boxes)):

        for j in range(
            i + 1,
            len(boxes)
        ):

            if iou(
                boxes[i],
                boxes[j]
            ) >= iou_threshold:

                return True

    return False


def vehicle_proximity(
    detections,
    distance_ratio=0.75
):
    """
    More tolerant vehicle-interaction detector.

    Two vehicles may collide/interact without their bounding
    boxes having enough IoU.

    We compare the distance between bounding-box centers against
    the average size of the vehicles.
    """

    boxes = [
        d["bbox"]
        for d in detections
        if d.get("bbox") is not None
    ]

    if len(boxes) < 2:
        return False

    centers = []

    for box in boxes:

        x1, y1, x2, y2 = box

        cx = (
            float(x1)
            + float(x2)
        ) / 2.0

        cy = (
            float(y1)
            + float(y2)
        ) / 2.0

        width = abs(
            float(x2)
            - float(x1)
        )

        height = abs(
            float(y2)
            - float(y1)
        )

        size = math.sqrt(
            width * width
            + height * height
        )

        centers.append(
            (
                cx,
                cy,
                size
            )
        )

    for i in range(
        len(centers)
    ):

        for j in range(
            i + 1,
            len(centers)
        ):

            cx1, cy1, size1 = (
                centers[i]
            )

            cx2, cy2, size2 = (
                centers[j]
            )

            distance = math.sqrt(
                (cx1 - cx2) ** 2
                + (cy1 - cy2) ** 2
            )

            average_size = (
                size1 + size2
            ) / 2.0

            if average_size <= 0:
                continue

            if (
                distance
                <= average_size
                * distance_ratio
            ):
                return True

    return False


# =============================================================
# IOU
# =============================================================

def iou(a, b):

    ax1, ay1, ax2, ay2 = a

    bx1, by1, bx2, by2 = b

    ix1 = max(
        ax1,
        bx1
    )

    iy1 = max(
        ay1,
        by1
    )

    ix2 = min(
        ax2,
        bx2
    )

    iy2 = min(
        ay2,
        by2
    )

    iw = max(
        0.0,
        ix2 - ix1
    )

    ih = max(
        0.0,
        iy2 - iy1
    )

    intersection = (
        iw * ih
    )

    area_a = (
        max(
            0.0,
            ax2 - ax1
        )
        *
        max(
            0.0,
            ay2 - ay1
        )
    )

    area_b = (
        max(
            0.0,
            bx2 - bx1
        )
        *
        max(
            0.0,
            by2 - by1
        )
    )

    union = (
        area_a
        + area_b
        - intersection
    )

    if union <= 0:
        return 0.0

    return (
        intersection
        / union
    )


# =============================================================
# EMPTY RESULT
# =============================================================

def empty_result():

    return {

        "accident_detected": False,

        "confidence": 0.0,

        "speed_anomaly": False,

        "trajectory_anomaly": False,

        "collision_proximity": False,

        "persistent_abnormal_motion": False,

        "speed_before": None,

        "speed_after": None,

        "evidence": {},

        "severity": {

            "level": "LOW",

            "score": 0.0,

            "basis": [],

            "relative_speed_before": None,

            "speed_unit": (
                "image_space_relative"
            ),
        },
    }