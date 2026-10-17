from pathlib import Path
import time
import cv2

from accident_detector import AccidentDetector
from buffer import RollingVideoBuffer
from config import ANNOTATED_DIR, BUFFER_SECONDS, CLIP_DIR, CLIP_SECONDS
from detector import VehicleDetector
from tracker import TrackHistory


class VideoProcessor:
    def __init__(
        self,
        detector=None,
        accident_detector=None,
        camera_id="CAM_001",
    ):
        self.detector = detector or VehicleDetector()
        self.accident_detector = accident_detector or AccidentDetector()
        self.camera_id = camera_id

    def process_video(
        self,
        video_path,
        save_annotated=True,
        max_frames=None,
        inference_stride=2,
    ):
        """
        Process a video for vehicle tracking and accident detection.

        Performance optimization:
        - Video is still read frame-by-frame.
        - YOLO + ByteTrack runs only every `inference_stride` frames.
        - TrackHistory and accident scoring are updated only when
          a fresh detection is available.
        - Previous detections/evidence are reused for skipped frames
          for annotation and display.

        inference_stride=1 -> original behavior
        inference_stride=2 -> process every 2nd frame
        inference_stride=3 -> process every 3rd frame
        """

        if inference_stride < 1:
            raise ValueError("inference_stride must be >= 1")

        video_path = Path(video_path)

        if not video_path.exists():
            raise FileNotFoundError(f"Video not found: {video_path}")

        cap = cv2.VideoCapture(str(video_path))

        if not cap.isOpened():
            raise ValueError(f"Could not open video: {video_path}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        fps = fps if fps and fps > 0 else 25.0

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        buffer = RollingVideoBuffer(BUFFER_SECONDS, fps)
        history = TrackHistory()
        events = []

        frame_index = 0

        event_cooldown_until = -1.0
        pending_event = None
        post_event_frames = []

        # Last valid ML result.
        last_detections = []
        last_evidence = {
            "accident_detected": False,
            "confidence": 0.0,
            "severity": {
                "level": "none",
                "score": 0,
                "basis": [],
            },
        }

        writer = None

        annotated_path = (
            ANNOTATED_DIR / f"{video_path.stem}_annotated.mp4"
        )

        if save_annotated:
            ANNOTATED_DIR.mkdir(parents=True, exist_ok=True)

            writer = cv2.VideoWriter(
                str(annotated_path),
                cv2.VideoWriter_fourcc(*"mp4v"),
                fps,
                (width, height),
            )

            if not writer.isOpened():
                cap.release()
                raise ValueError(
                    f"Could not create annotated video: {annotated_path}"
                )

        start_time = time.perf_counter()

        # Effective FPS for ML updates.
        # Example:
        # source = 30 FPS
        # stride = 2
        # ML sees ~15 frames/sec
        inference_fps = fps / inference_stride

        inference_count = 0

        while True:
            ok, frame = cap.read()

            if not ok:
                break

            timestamp = frame_index / fps

            # Keep the full video history for event clips.
            buffer.add(frame_index, timestamp, frame)

            # ---------------------------------------------------------
            # ML OPTIMIZATION
            # ---------------------------------------------------------
            should_infer = (
                frame_index % inference_stride == 0
            )

            if should_infer:
                # Expensive operation:
                # YOLO detection + ByteTrack tracking.
                detections = self.detector.track_frame(frame)

                # IMPORTANT:
                # TrackHistory only updates when we have a fresh
                # detection. This avoids adding duplicate positions
                # on skipped frames and creating artificial zero-speed
                # measurements.
                features = history.update(
                    detections,
                    inference_fps,
                )

                evidence = self.accident_detector.score(
                    detections,
                    features,
                    history,
                )

                last_detections = detections
                last_evidence = evidence

                inference_count += 1

            else:
                # Reuse the most recent ML result.
                detections = last_detections
                evidence = last_evidence

            # ---------------------------------------------------------
            # ANNOTATION
            # ---------------------------------------------------------
            annotated = frame.copy()

            self._draw(
                annotated,
                detections,
                evidence,
            )

            if writer is not None:
                writer.write(annotated)

            # ---------------------------------------------------------
            # ACCIDENT EVENT DETECTION
            # ---------------------------------------------------------
            if (
                should_infer
                and evidence["accident_detected"]
                and timestamp >= event_cooldown_until
                and pending_event is None
            ):
                pending_event = {
                    "event_time": timestamp,
                    "evidence": evidence,
                    "frames": buffer.recent(),
                }

                post_event_frames = []

            # ---------------------------------------------------------
            # POST-EVENT CLIP COLLECTION
            # ---------------------------------------------------------
            if pending_event is not None:
                recent_frames = buffer.recent()

                if recent_frames:
                    post_event_frames.append(recent_frames[-1])

                target_end = (
                    pending_event["event_time"]
                    + CLIP_SECONDS / 2
                )

                if timestamp >= target_end:
                    clip_path = self._save_event_clip(
                        pending_event,
                        post_event_frames,
                        fps,
                        width,
                        height,
                        video_path.stem,
                    )

                    e = pending_event["evidence"]

                    events.append({
                        "accident_detected": True,
                        "confidence": e["confidence"],
                        "camera_id": self.camera_id,
                        "timestamp_seconds": (
                            pending_event["event_time"]
                        ),
                        "frame_index": int(
                            pending_event["event_time"] * fps
                        ),
                        "speed_before": e["speed_before"],
                        "speed_after": e["speed_after"],
                        "speed_anomaly": e["speed_anomaly"],
                        "trajectory_anomaly": (
                            e["trajectory_anomaly"]
                        ),
                        "collision_proximity": (
                            e["collision_proximity"]
                        ),
                        "persistent_abnormal_motion": (
                            e["persistent_abnormal_motion"]
                        ),
                        "severity": e["severity"],
                        "video_clip": str(clip_path),
                    })

                    pending_event = None
                    post_event_frames = []

                    event_cooldown_until = (
                        timestamp + CLIP_SECONDS
                    )

            frame_index += 1

            if (
                max_frames is not None
                and frame_index >= max_frames
            ):
                break

        cap.release()

        if writer is not None:
            writer.release()

        elapsed = time.perf_counter() - start_time

        return {
            "video_path": str(video_path),
            "camera_id": self.camera_id,
            "accident_detected": bool(events),
            "events": events,
            "metrics": {
                "fps_source": fps,
                "frames_processed": frame_index,
                "inference_frames": inference_count,
                "inference_stride": inference_stride,
                "video_total_frames": total_frames,
                "processing_seconds": round(elapsed, 3),
                "processing_fps": (
                    round(frame_index / elapsed, 2)
                    if elapsed
                    else 0
                ),
                "detection_latency_seconds": (
                    round(elapsed / frame_index, 5)
                    if frame_index
                    else 0
                ),
            },
            "annotated_video": (
                str(annotated_path)
                if writer is not None
                else None
            ),
        }

    def _save_event_clip(
        self,
        pending_event,
        post_event_frames,
        fps,
        width,
        height,
        stem,
    ):
        CLIP_DIR.mkdir(parents=True, exist_ok=True)

        event_time = pending_event["event_time"]

        clip_path = (
            CLIP_DIR
            / f"{stem}_accident_{int(event_time * 1000)}.mp4"
        )

        all_frames = (
            pending_event["frames"]
            + post_event_frames
        )

        unique = {
            item.frame_index: item
            for item in all_frames
        }

        selected = sorted(
            unique.values(),
            key=lambda item: item.frame_index,
        )

        start = event_time - CLIP_SECONDS / 2
        end = event_time + CLIP_SECONDS / 2

        selected = [
            item
            for item in selected
            if start
            <= item.timestamp_seconds
            <= end
        ]

        if not selected:
            selected = post_event_frames

        writer = cv2.VideoWriter(
            str(clip_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            fps,
            (width, height),
        )

        if not writer.isOpened():
            raise ValueError(
                f"Could not create event clip: {clip_path}"
            )

        for item in selected:
            writer.write(item.frame)

        writer.release()

        return clip_path

    @staticmethod
    def _draw(
        frame,
        detections,
        evidence,
    ):
        for det in detections:
            x1, y1, x2, y2 = map(
                int,
                det["bbox"],
            )

            cv2.rectangle(
                frame,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2,
            )

            cv2.putText(
                frame,
                f"ID {det['track_id']}",
                (x1, max(20, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 0),
                2,
            )

        if evidence["accident_detected"]:
            text = (
                f"ACCIDENT "
                f"{evidence['confidence']:.2f} | "
                f"SEVERITY "
                f"{evidence['severity']['level']}"
            )

            thickness = 2
            color = (0, 0, 255)

        else:
            text = (
                f"Monitoring | "
                f"score {evidence['confidence']:.2f}"
            )

            thickness = 1
            color = (255, 255, 255)

        cv2.putText(
            frame,
            text,
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            color,
            thickness,
        )

def process_video(
    video_path,
    camera_id="CAM_001",
    **kwargs,
):
    return VideoProcessor(
        camera_id=camera_id
    ).process_video(
        video_path,
        **kwargs,
    )