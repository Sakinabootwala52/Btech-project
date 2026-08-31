from pathlib import Path
import argparse
import json
import time

import cv2

from accident_detector import AccidentDetector
from buffer import RollingVideoBuffer
from config import BUFFER_SECONDS, CLIP_DIR, CLIP_SECONDS
from detector import VehicleDetector
from tracker import TrackHistory


def write_status(path, status):
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = path.with_suffix(".tmp")

    temp_path.write_text(
        json.dumps(status, indent=2, default=str),
        encoding="utf-8",
    )

    temp_path.replace(path)


def save_event_clip(
    buffer_frames,
    post_frames,
    event_time,
    fps,
    width,
    height,
    camera_id,
):
    CLIP_DIR.mkdir(parents=True, exist_ok=True)

    all_frames = buffer_frames + post_frames

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
        if start <= item.timestamp_seconds <= end
    ]

    if not selected:
        return None

    clip_path = (
        CLIP_DIR
        / (
            f"{camera_id}_"
            f"stream_{int(event_time * 1000)}.mp4"
        )
    )

    writer = cv2.VideoWriter(
        str(clip_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    if not writer.isOpened():
        return None

    for item in selected:
        writer.write(item.frame)

    writer.release()

    return clip_path


def build_event(
    pending_event,
    post_event_frames,
    fps,
    width,
    height,
    camera_id,
):
    event_time = pending_event["event_time"]
    evidence = pending_event["evidence"]

    clip_path = save_event_clip(
        pending_event["frames"],
        post_event_frames,
        event_time,
        fps,
        width,
        height,
        camera_id,
    )

    return {
        "accident_detected": True,
        "confidence": evidence.get(
            "confidence",
            0.0,
        ),
        "camera_id": camera_id,
        "timestamp_seconds": event_time,
        "frame_index": int(event_time * fps),
        "speed_before": evidence.get(
            "speed_before",
            0.0,
        ),
        "speed_after": evidence.get(
            "speed_after",
            0.0,
        ),
        "speed_anomaly": evidence.get(
            "speed_anomaly",
            False,
        ),
        "trajectory_anomaly": evidence.get(
            "trajectory_anomaly",
            False,
        ),
        "collision_proximity": evidence.get(
            "collision_proximity",
            False,
        ),
        "persistent_abnormal_motion": evidence.get(
            "persistent_abnormal_motion",
            False,
        ),
        "severity": evidence.get(
            "severity",
            {
                "level": "unknown",
                "score": 0,
                "basis": [],
            },
        ),
        "video_clip": (
            str(clip_path)
            if clip_path
            else None
        ),
    }


def process_stream(
    source,
    camera_id,
    status_path,
    inference_stride=2,
):
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open stream source: {source}"
        )

    fps = cap.get(cv2.CAP_PROP_FPS)

    if not fps or fps <= 0:
        fps = 25.0

    width = int(
        cap.get(cv2.CAP_PROP_FRAME_WIDTH)
    )

    height = int(
        cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    )

    buffer = RollingVideoBuffer(
        BUFFER_SECONDS,
        fps,
    )

    history = TrackHistory()

    detector = VehicleDetector()
    accident_detector = AccidentDetector()

    frame_index = 0

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

    pending_event = None
    post_event_frames = []

    cooldown_until = -1.0

    events = []

    started_at = time.time()

    write_status(
        status_path,
        {
            "status": "running",
            "camera_id": camera_id,
            "source": str(source),
            "frames_processed": 0,
            "last_timestamp": 0,
            "accident_detected": False,
            "last_detection": last_evidence,
            "events": [],
            "elapsed_seconds": 0,
        },
    )

    try:
        while True:
            ok, frame = cap.read()

            if not ok:
                break

            timestamp = frame_index / fps

            buffer.add(
                frame_index,
                timestamp,
                frame,
            )

            should_infer = (
                frame_index % inference_stride == 0
            )

            if should_infer:
                detections = detector.track_frame(
                    frame
                )

                inference_fps = (
                    fps / inference_stride
                )

                features = history.update(
                    detections,
                    inference_fps,
                )

                evidence = accident_detector.score(
                    detections,
                    features,
                    history,
                )

                last_detections = detections
                last_evidence = evidence

            else:
                detections = last_detections
                evidence = last_evidence

            # --------------------------------------------------
            # START ACCIDENT EVENT
            # --------------------------------------------------

            if (
                should_infer
                and evidence["accident_detected"]
                and timestamp >= cooldown_until
                and pending_event is None
            ):
                pending_event = {
                    "event_time": timestamp,
                    "evidence": evidence,
                    "frames": buffer.recent(),
                }

                post_event_frames = []

                print(
                    f"\nACCIDENT DETECTED | "
                    f"camera={camera_id} | "
                    f"time={timestamp:.2f}s | "
                    f"confidence="
                    f"{evidence['confidence']:.2f}"
                )

                # Immediately expose detection
                # to the status file.
                write_status(
                    status_path,
                    {
                        "status": "running",
                        "camera_id": camera_id,
                        "source": str(source),
                        "frames_processed": frame_index,
                        "last_timestamp": timestamp,
                        "accident_detected": True,
                        "last_detection": evidence,
                        "events": events,
                        "elapsed_seconds": (
                            time.time() - started_at
                        ),
                    },
                )

            # --------------------------------------------------
            # COLLECT POST-EVENT FRAMES
            # --------------------------------------------------

            if pending_event is not None:
                recent = buffer.recent()

                if recent:
                    post_event_frames.append(
                        recent[-1]
                    )

                target_end = (
                    pending_event["event_time"]
                    + CLIP_SECONDS / 2
                )

                if timestamp >= target_end:

                    event = build_event(
                        pending_event,
                        post_event_frames,
                        fps,
                        width,
                        height,
                        camera_id,
                    )

                    events.append(event)

                    print(
                        f"EVENT SAVED | "
                        f"clip={event['video_clip']}"
                    )

                    pending_event = None
                    post_event_frames = []

                    cooldown_until = (
                        timestamp + CLIP_SECONDS
                    )

            frame_index += 1

            write_status(
                status_path,
                {
                    "status": "running",
                    "camera_id": camera_id,
                    "source": str(source),
                    "frames_processed": frame_index,
                    "last_timestamp": timestamp,
                    "accident_detected": (
                        bool(events)
                        or pending_event is not None
                        or bool(
                            last_evidence.get(
                                "accident_detected",
                                False,
                            )
                        )
                    ),
                    "last_detection": last_evidence,
                    "events": events,
                    "elapsed_seconds": (
                        time.time() - started_at
                    ),
                },
            )

    finally:
        # ------------------------------------------------------
        # IMPORTANT:
        # FINALIZE A PENDING EVENT WHEN THE STREAM ENDS.
        # ------------------------------------------------------

        if pending_event is not None:

            event = build_event(
                pending_event,
                post_event_frames,
                fps,
                width,
                height,
                camera_id,
            )

            events.append(event)

            print(
                f"FINAL EVENT SAVED | "
                f"clip={event['video_clip']}"
            )

            pending_event = None
            post_event_frames = []

        cap.release()

        write_status(
            status_path,
            {
                "status": "completed",
                "camera_id": camera_id,
                "source": str(source),
                "frames_processed": frame_index,
                "last_timestamp": (
                    frame_index / fps
                    if fps
                    else 0
                ),
                "accident_detected": bool(
                    events
                ),
                "last_detection": last_evidence,
                "events": events,
                "elapsed_seconds": (
                    time.time() - started_at
                ),
            },
        )


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--source",
        required=True,
    )

    parser.add_argument(
        "--camera-id",
        default="CAM_001",
    )

    parser.add_argument(
        "--status-file",
        required=True,
    )

    parser.add_argument(
        "--inference-stride",
        type=int,
        default=2,
    )

    args = parser.parse_args()

    source = args.source

    if source.isdigit():
        source = int(source)

    process_stream(
        source=source,
        camera_id=args.camera_id,
        status_path=Path(
            args.status_file
        ),
        inference_stride=max(
            1,
            args.inference_stride,
        ),
    )


if __name__ == "__main__":
    main()