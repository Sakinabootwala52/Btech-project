
# ml/stream_processor.py

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import cv2

from accident_detector import AccidentDetector
from buffer import RollingVideoBuffer
from config import BUFFER_SECONDS, CLIP_DIR, CLIP_SECONDS
from detector import VehicleDetector
from tracker import TrackHistory


def write_status(status_path, status_data):
    """Atomically write status JSON, retrying transient Windows locks."""
    status_path = Path(status_path)
    status_path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = status_path.with_name(
        f"{status_path.stem}.{os.getpid()}.{time.time_ns()}.tmp"
    )

    try:
        with temp_path.open("w", encoding="utf-8") as file:
            json.dump(status_data, file, ensure_ascii=False, indent=2)
            file.flush()
            os.fsync(file.fileno())

        for attempt in range(5):
            try:
                os.replace(str(temp_path), str(status_path))
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.15 * (attempt + 1))
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def notify_backend(
    callback_url,
    callback_token,
    stream_id,
    event_type,
    event,
    incident_id=None,
):
    if not callback_url:
        return None

    payload = {
        "stream_id": stream_id,
        "token": callback_token,
        "event_type": event_type,
        "event": event,
    }

    if incident_id:
        payload["incident_id"] = incident_id

    request = urllib.request.Request(
        callback_url,
        data=json.dumps(payload, default=str).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            raw = response.read().decode("utf-8")
            result = json.loads(raw) if raw else {}
            print(
                f"BACKEND CALLBACK | type={event_type} | "
                f"response={result}",
                flush=True,
            )
            return result

    except (
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
    ) as exc:
        print(
            f"BACKEND CALLBACK ERROR | type={event_type} | {exc}",
            flush=True,
        )
        return None


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

    unique_frames = {
        item.frame_index: item
        for item in buffer_frames + post_frames
    }

    selected = sorted(
        unique_frames.values(),
        key=lambda item: item.frame_index,
    )

    start = event_time - CLIP_SECONDS / 2
    end = event_time + CLIP_SECONDS / 2

    selected = [
        item for item in selected
        if start <= item.timestamp_seconds <= end
    ]

    if not selected:
        return None

    safe_camera_id = "".join(
        c if c.isalnum() or c in "-_" else "_"
        for c in camera_id
    )

    clip_path = CLIP_DIR / (
        f"{safe_camera_id}_stream_{int(event_time * 1000)}.mp4"
    )

    writer = cv2.VideoWriter(
        str(clip_path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        fps,
        (width, height),
    )

    if not writer.isOpened():
        writer.release()
        print(f"CLIP ERROR | Cannot open writer for {clip_path}")
        return None

    try:
        for item in selected:
            writer.write(item.frame)
    finally:
        writer.release()

    if not clip_path.exists() or clip_path.stat().st_size == 0:
        return None

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
        "confidence": evidence.get("confidence", 0.0),
        "camera_id": camera_id,
        "timestamp_seconds": event_time,
        "frame_index": int(event_time * fps),
        "speed_before": evidence.get("speed_before", 0.0),
        "speed_after": evidence.get("speed_after", 0.0),
        "speed_anomaly": evidence.get("speed_anomaly", False),
        "trajectory_anomaly": evidence.get("trajectory_anomaly", False),
        "collision_proximity": evidence.get("collision_proximity", False),
        "persistent_abnormal_motion": evidence.get(
            "persistent_abnormal_motion", False
        ),
        "severity": evidence.get(
            "severity",
            {"level": "unknown", "score": 0, "basis": []},
        ),
        "video_clip": str(clip_path) if clip_path else None,
    }


def process_stream(
    source,
    camera_id,
    status_path,
    inference_stride=2,
    callback_url=None,
    callback_token=None,
    stream_id=None,
):
    cap = cv2.VideoCapture(source)

    if not cap.isOpened():
        cap.release()
        raise RuntimeError(f"Could not open stream source: {source}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 25.0

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if width <= 0 or height <= 0:
        cap.release()
        raise RuntimeError("Stream reported invalid frame dimensions.")

    inference_stride = max(1, int(inference_stride))

    buffer = RollingVideoBuffer(BUFFER_SECONDS, fps)
    history = TrackHistory()
    detector = VehicleDetector()
    accident_detector = AccidentDetector()

    frame_index = 0
    last_detections = []
    last_evidence = {
        "accident_detected": False,
        "confidence": 0.0,
        "speed_anomaly": False,
        "trajectory_anomaly": False,
        "collision_proximity": False,
        "persistent_abnormal_motion": False,
        "severity": {"level": "unknown", "score": 0, "basis": []},
    }

    pending_event = None
    post_event_frames = []
    cooldown_until = -1.0
    events = []
    incident_id = None
    started_at = time.time()
    last_status_write = 0.0
    status_interval = 0.5

    def current_status(status):
        return {
            "status": status,
            "camera_id": camera_id,
            "stream_id": stream_id,
            "source": str(source),
            "frames_processed": frame_index,
            "last_timestamp": frame_index / fps,
            "accident_detected": (
                bool(events)
                or pending_event is not None
                or bool(last_evidence.get("accident_detected"))
            ),
            "last_detection": last_evidence,
            "events": events,
            "incident_id": incident_id,
            "elapsed_seconds": time.time() - started_at,
        }

    def finalize_event(event, callback_type="finalized"):
        nonlocal incident_id

        events.append(event)

        print(
            f"EVENT SAVED | clip={event.get('video_clip')} | "
            f"confidence={event.get('confidence')}",
            flush=True,
        )

        result = notify_backend(
            callback_url=callback_url,
            callback_token=callback_token,
            stream_id=stream_id,
            event_type=callback_type,
            event=event,
            incident_id=incident_id,
        )

        if result and result.get("incident_id"):
            incident_id = result["incident_id"]

    try:
        write_status(status_path, current_status("running"))

        while True:
            ok, frame = cap.read()
            if not ok:
                break

            timestamp = frame_index / fps
            buffer.add(frame_index, timestamp, frame)

            should_infer = frame_index % inference_stride == 0

            if should_infer:
                detections = detector.track_frame(frame)

                # Keep the existing TrackHistory API.
                inference_fps = fps / inference_stride
                features = history.update(detections, inference_fps)

                evidence = accident_detector.score(
                    detections,
                    features,
                    history,
                )

                last_detections = detections
                last_evidence = evidence

                print(
                    f"FRAME={frame_index} "
                    f"DETECTIONS={len(detections)} "
                    f"TRACKS={len(features)} "
                    f"ACCIDENT={evidence.get('accident_detected')} "
                    f"CONFIDENCE={evidence.get('confidence')} "
                    f"SPEED_ANOMALY={evidence.get('speed_anomaly')} "
                    f"DIRECTION_ANOMALY={evidence.get('trajectory_anomaly')} "
                    f"INTERACTION={evidence.get('collision_proximity')} "
                    f"SEVERITY={evidence.get('severity')}",
                    flush=True,
                )

            else:
                detections = last_detections
                evidence = last_evidence

            if (
                should_infer
                and evidence.get("accident_detected", False)
                and timestamp >= cooldown_until
                and pending_event is None
            ):
                pending_event = {
                    "event_time": timestamp,
                    "evidence": evidence,
                    "frames": buffer.recent(),
                }
                post_event_frames = []

                immediate_event = {
                    "accident_detected": True,
                    "confidence": evidence.get("confidence", 0.0),
                    "camera_id": camera_id,
                    "timestamp_seconds": timestamp,
                    "frame_index": frame_index,
                    "speed_before": evidence.get("speed_before", 0.0),
                    "speed_after": evidence.get("speed_after", 0.0),
                    "speed_anomaly": evidence.get("speed_anomaly", False),
                    "trajectory_anomaly": evidence.get(
                        "trajectory_anomaly", False
                    ),
                    "collision_proximity": evidence.get(
                        "collision_proximity", False
                    ),
                    "persistent_abnormal_motion": evidence.get(
                        "persistent_abnormal_motion", False
                    ),
                    "severity": evidence.get(
                        "severity",
                        {"level": "unknown", "score": 0, "basis": []},
                    ),
                    "video_clip": None,
                }

                result = notify_backend(
                    callback_url=callback_url,
                    callback_token=callback_token,
                    stream_id=stream_id,
                    event_type="detected",
                    event=immediate_event,
                )

                if result and result.get("incident_id"):
                    incident_id = result["incident_id"]

                write_status(status_path, current_status("running"))

            if pending_event is not None:
                recent = buffer.recent()
                if recent:
                    newest = recent[-1]
                    if (
                        not post_event_frames
                        or newest.frame_index
                        != post_event_frames[-1].frame_index
                    ):
                        post_event_frames.append(newest)

                target_end = (
                    pending_event["event_time"] + CLIP_SECONDS / 2
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

                    finalize_event(event)

                    pending_event = None
                    post_event_frames = []
                    cooldown_until = timestamp + CLIP_SECONDS

            frame_index += 1

            if time.monotonic() - last_status_write >= status_interval:
                write_status(status_path, current_status("running"))
                last_status_write = time.monotonic()

    except Exception as exc:
        print(f"STREAM ERROR | {type(exc).__name__}: {exc}", flush=True)
        raise

    finally:
        try:
            if pending_event is not None:
                event = build_event(
                    pending_event,
                    post_event_frames,
                    fps,
                    width,
                    height,
                    camera_id,
                )
                finalize_event(event)
        finally:
            cap.release()
            write_status(status_path, current_status("completed"))


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--source", required=True)
    parser.add_argument("--camera-id", default="CAM_001")
    parser.add_argument("--status-file", required=True)
    parser.add_argument("--inference-stride", type=int, default=2)
    parser.add_argument("--callback-url", default=None)
    parser.add_argument("--callback-token", default=None)
    parser.add_argument("--stream-id", default=None)

    args = parser.parse_args()

    source = args.source
    if source.isdigit():
        source = int(source)

    process_stream(
        source=source,
        camera_id=args.camera_id,
        status_path=Path(args.status_file),
        inference_stride=max(1, args.inference_stride),
        callback_url=args.callback_url,
        callback_token=args.callback_token,
        stream_id=args.stream_id,
    )


if __name__ == "__main__":
    main()
