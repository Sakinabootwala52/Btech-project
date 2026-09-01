from pathlib import Path
import argparse
import json
import time
import urllib.error
import urllib.request

import cv2

from accident_detector import AccidentDetector
from buffer import RollingVideoBuffer
from config import (
    BUFFER_SECONDS,
    CLIP_DIR,
    CLIP_SECONDS,
)
from detector import VehicleDetector
from tracker import TrackHistory


# ============================================================
# STATUS WRITER
# ============================================================

def write_status(
    path,
    status,
):
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_path = (
        path.with_suffix(".tmp")
    )

    temp_path.write_text(
        json.dumps(
            status,
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    temp_path.replace(
        path
    )


# ============================================================
# BACKEND CALLBACK
# ============================================================

def notify_backend(
    callback_url,
    callback_token,
    stream_id,
    event_type,
    event,
    incident_id=None,
):
    """
    Send an accident event directly to Flask.

    This is the important latency optimization:

        accident detected
              ↓
        HTTP callback
              ↓
        Flask
              ↓
        MongoDB

    We intentionally use Python's standard library so the
    ML virtual environment does not need requests/axios/etc.
    """

    if not callback_url:
        return None

    payload = {
        "stream_id":
            stream_id,
        "token":
            callback_token,
        "event_type":
            event_type,
        "event":
            event,
    }

    if incident_id:
        payload["incident_id"] = (
            incident_id
        )

    body = json.dumps(
        payload,
        default=str,
    ).encode(
        "utf-8"
    )

    request = urllib.request.Request(
        callback_url,
        data=body,
        headers={
            "Content-Type":
                "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=2,
        ) as response:

            raw = (
                response.read()
                .decode("utf-8")
            )

            if not raw:
                return None

            result = json.loads(
                raw
            )

            print(
                f"BACKEND CALLBACK | "
                f"type={event_type} | "
                f"response={result}"
            )

            return result

    except (
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        OSError,
    ) as exc:

        print(
            "\n========== BACKEND CALLBACK ERROR =========="
        )

        print(
            f"Type: {event_type}"
        )

        print(
            f"Error: {exc}"
        )

        print(
            "The stream will continue running."
        )

        print(
            "=============================================\n"
        )

        return None


# ============================================================
# VIDEO CLIP
# ============================================================

def save_event_clip(
    buffer_frames,
    post_frames,
    event_time,
    fps,
    width,
    height,
    camera_id,
):
    CLIP_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    all_frames = (
        buffer_frames
        + post_frames
    )

    unique = {
        item.frame_index: item
        for item in all_frames
    }

    selected = sorted(
        unique.values(),
        key=lambda item:
            item.frame_index,
    )

    start = (
        event_time
        - CLIP_SECONDS / 2
    )

    end = (
        event_time
        + CLIP_SECONDS / 2
    )

    selected = [
        item
        for item in selected
        if (
            start
            <= item.timestamp_seconds
            <= end
        )
    ]

    if not selected:
        return None

    clip_path = (
        CLIP_DIR
        / (
            f"{camera_id}_"
            f"stream_"
            f"{int(event_time * 1000)}.mp4"
        )
    )

    writer = cv2.VideoWriter(
        str(clip_path),
        cv2.VideoWriter_fourcc(
            *"mp4v"
        ),
        fps,
        (
            width,
            height,
        ),
    )

    if not writer.isOpened():
        return None

    for item in selected:
        writer.write(
            item.frame
        )

    writer.release()

    return clip_path


# ============================================================
# EVENT BUILDER
# ============================================================

def build_event(
    pending_event,
    post_event_frames,
    fps,
    width,
    height,
    camera_id,
):
    event_time = (
        pending_event["event_time"]
    )

    evidence = (
        pending_event["evidence"]
    )

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
        "accident_detected":
            True,

        "confidence":
            evidence.get(
                "confidence",
                0.0,
            ),

        "camera_id":
            camera_id,

        "timestamp_seconds":
            event_time,

        "frame_index":
            int(
                event_time * fps
            ),

        "speed_before":
            evidence.get(
                "speed_before",
                0.0,
            ),

        "speed_after":
            evidence.get(
                "speed_after",
                0.0,
            ),

        "speed_anomaly":
            evidence.get(
                "speed_anomaly",
                False,
            ),

        "trajectory_anomaly":
            evidence.get(
                "trajectory_anomaly",
                False,
            ),

        "collision_proximity":
            evidence.get(
                "collision_proximity",
                False,
            ),

        "persistent_abnormal_motion":
            evidence.get(
                "persistent_abnormal_motion",
                False,
            ),

        "severity":
            evidence.get(
                "severity",
                {
                    "level":
                        "unknown",
                    "score":
                        0,
                    "basis":
                        [],
                },
            ),

        "video_clip":
            (
                str(clip_path)
                if clip_path
                else None
            ),
    }


# ============================================================
# STREAM PROCESSING
# ============================================================

def process_stream(
    source,
    camera_id,
    status_path,
    inference_stride=2,
    callback_url=None,
    callback_token=None,
    stream_id=None,
):
    cap = cv2.VideoCapture(
        source
    )

    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open stream source: {source}"
        )

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    if (
        not fps
        or fps <= 0
    ):
        fps = 25.0

    width = int(
        cap.get(
            cv2.CAP_PROP_FRAME_WIDTH
        )
    )

    height = int(
        cap.get(
            cv2.CAP_PROP_FRAME_HEIGHT
        )
    )

    buffer = RollingVideoBuffer(
        BUFFER_SECONDS,
        fps,
    )

    history = TrackHistory()

    detector = VehicleDetector()

    accident_detector = (
        AccidentDetector()
    )

    frame_index = 0

    last_detections = []

    last_evidence = {
        "accident_detected":
            False,
        "confidence":
            0.0,
        "severity": {
            "level":
                "none",
            "score":
                0,
            "basis":
                [],
        },
    }

    pending_event = None

    post_event_frames = []

    cooldown_until = -1.0

    events = []

    incident_id = None

    started_at = time.time()

    # ========================================================
    # INITIAL STATUS
    # ========================================================

    write_status(
        status_path,
        {
            "status":
                "running",

            "camera_id":
                camera_id,

            "stream_id":
                stream_id,

            "source":
                str(source),

            "frames_processed":
                0,

            "last_timestamp":
                0,

            "accident_detected":
                False,

            "last_detection":
                last_evidence,

            "events":
                [],

            "incident_id":
                None,

            "elapsed_seconds":
                0,
        },
    )

    try:
        while True:
            ok, frame = cap.read()

            if not ok:
                break

            timestamp = (
                frame_index / fps
            )

            buffer.add(
                frame_index,
                timestamp,
                frame,
            )

            should_infer = (
                frame_index
                % inference_stride
                == 0
            )

            # =================================================
            # ML INFERENCE
            # =================================================

            if should_infer:
                detections = (
                    detector.track_frame(
                        frame
                    )
                )

                inference_fps = (
                    fps
                    / inference_stride
                )

                features = (
                    history.update(
                        detections,
                        inference_fps,
                    )
                )

                evidence = (
                    accident_detector.score(
                        detections,
                        features,
                        history,
                    )
                )

                last_detections = (
                    detections
                )

                last_evidence = (
                    evidence
                )

            else:
                detections = (
                    last_detections
                )

                evidence = (
                    last_evidence
                )

            # =================================================
            # START ACCIDENT
            # =================================================

            if (
                should_infer
                and evidence[
                    "accident_detected"
                ]
                and timestamp
                >= cooldown_until
                and pending_event is None
            ):
                pending_event = {
                    "event_time":
                        timestamp,

                    "evidence":
                        evidence,

                    "frames":
                        buffer.recent(),
                }

                post_event_frames = []

                print(
                    f"\nACCIDENT DETECTED | "
                    f"camera={camera_id} | "
                    f"time={timestamp:.2f}s | "
                    f"confidence="
                    f"{evidence['confidence']:.2f}"
                )

                # ---------------------------------------------
                # IMMEDIATE BACKEND INCIDENT
                # ---------------------------------------------
                #
                # We do NOT wait for the evidence clip.
                #
                # This is what removes the major delay.
                #

                immediate_event = {
                    "accident_detected":
                        True,

                    "confidence":
                        evidence.get(
                            "confidence",
                            0.0,
                        ),

                    "camera_id":
                        camera_id,

                    "timestamp_seconds":
                        timestamp,

                    "frame_index":
                        frame_index,

                    "speed_before":
                        evidence.get(
                            "speed_before",
                            0.0,
                        ),

                    "speed_after":
                        evidence.get(
                            "speed_after",
                            0.0,
                        ),

                    "speed_anomaly":
                        evidence.get(
                            "speed_anomaly",
                            False,
                        ),

                    "trajectory_anomaly":
                        evidence.get(
                            "trajectory_anomaly",
                            False,
                        ),

                    "collision_proximity":
                        evidence.get(
                            "collision_proximity",
                            False,
                        ),

                    "persistent_abnormal_motion":
                        evidence.get(
                            "persistent_abnormal_motion",
                            False,
                        ),

                    "severity":
                        evidence.get(
                            "severity",
                            {
                                "level":
                                    "unknown",
                                "score":
                                    0,
                                "basis":
                                    [],
                            },
                        ),

                    "video_clip":
                        None,
                }

                callback_result = (
                    notify_backend(
                        callback_url=
                            callback_url,

                        callback_token=
                            callback_token,

                        stream_id=
                            stream_id,

                        event_type=
                            "detected",

                        event=
                            immediate_event,
                    )
                )

                if callback_result:
                    incident_id = (
                        callback_result.get(
                            "incident_id"
                        )
                    )

                    print(
                        "IMMEDIATE INCIDENT ID | "
                        f"{incident_id}"
                    )

                # Immediately expose detection in status.
                write_status(
                    status_path,
                    {
                        "status":
                            "running",

                        "camera_id":
                            camera_id,

                        "stream_id":
                            stream_id,

                        "source":
                            str(source),

                        "frames_processed":
                            frame_index,

                        "last_timestamp":
                            timestamp,

                        "accident_detected":
                            True,

                        "last_detection":
                            evidence,

                        "events":
                            events,

                        "incident_id":
                            incident_id,

                        "elapsed_seconds":
                            (
                                time.time()
                                - started_at
                            ),
                    },
                )

            # =================================================
            # COLLECT POST-EVENT FRAMES
            # =================================================

            if pending_event is not None:
                recent = buffer.recent()

                if recent:
                    post_event_frames.append(
                        recent[-1]
                    )

                target_end = (
                    pending_event[
                        "event_time"
                    ]
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

                    events.append(
                        event
                    )

                    print(
                        "EVENT SAVED | "
                        f"clip={event['video_clip']}"
                    )

                    # -----------------------------------------
                    # FINALIZE INCIDENT
                    # -----------------------------------------

                    callback_result = (
                        notify_backend(
                            callback_url=
                                callback_url,

                            callback_token=
                                callback_token,

                            stream_id=
                                stream_id,

                            event_type=
                                "finalized",

                            event=
                                event,

                            incident_id=
                                incident_id,
                        )
                    )

                    if callback_result:

                        returned_id = (
                            callback_result.get(
                                "incident_id"
                            )
                        )

                        if returned_id:
                            incident_id = (
                                returned_id
                            )

                    pending_event = None

                    post_event_frames = []

                    cooldown_until = (
                        timestamp
                        + CLIP_SECONDS
                    )

            frame_index += 1

            write_status(
                status_path,
                {
                    "status":
                        "running",

                    "camera_id":
                        camera_id,

                    "stream_id":
                        stream_id,

                    "source":
                        str(source),

                    "frames_processed":
                        frame_index,

                    "last_timestamp":
                        timestamp,

                    "accident_detected":
                        (
                            bool(events)
                            or pending_event
                            is not None
                            or bool(
                                last_evidence.get(
                                    "accident_detected",
                                    False,
                                )
                            )
                        ),

                    "last_detection":
                        last_evidence,

                    "events":
                        events,

                    "incident_id":
                        incident_id,

                    "elapsed_seconds":
                        (
                            time.time()
                            - started_at
                        ),
                },
            )

    finally:

        # =====================================================
        # FINALIZE PENDING EVENT WHEN STREAM ENDS
        # =====================================================

        if pending_event is not None:

            event = build_event(
                pending_event,
                post_event_frames,
                fps,
                width,
                height,
                camera_id,
            )

            events.append(
                event
            )

            print(
                "FINAL EVENT SAVED | "
                f"clip={event['video_clip']}"
            )

            callback_result = (
                notify_backend(
                    callback_url=
                        callback_url,

                    callback_token=
                        callback_token,

                    stream_id=
                        stream_id,

                    event_type=
                        "finalized",

                    event=
                        event,

                    incident_id=
                        incident_id,
                )
            )

            if callback_result:
                returned_id = (
                    callback_result.get(
                        "incident_id"
                    )
                )

                if returned_id:
                    incident_id = (
                        returned_id
                    )

            pending_event = None

            post_event_frames = []

        cap.release()

        write_status(
            status_path,
            {
                "status":
                    "completed",

                "camera_id":
                    camera_id,

                "stream_id":
                    stream_id,

                "source":
                    str(source),

                "frames_processed":
                    frame_index,

                "last_timestamp":
                    (
                        frame_index / fps
                        if fps
                        else 0
                    ),

                "accident_detected":
                    bool(events),

                "last_detection":
                    last_evidence,

                "events":
                    events,

                "incident_id":
                    incident_id,

                "elapsed_seconds":
                    (
                        time.time()
                        - started_at
                    ),
            },
        )


# ============================================================
# MAIN
# ============================================================

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

    parser.add_argument(
        "--callback-url",
        default=None,
    )

    parser.add_argument(
        "--callback-token",
        default=None,
    )

    parser.add_argument(
        "--stream-id",
        default=None,
    )

    args = parser.parse_args()

    source = args.source

    if source.isdigit():
        source = int(source)

    process_stream(
        source=source,

        camera_id=
            args.camera_id,

        status_path=
            Path(
                args.status_file
            ),

        inference_stride=
            max(
                1,
                args.inference_stride,
            ),

        callback_url=
            args.callback_url,

        callback_token=
            args.callback_token,

        stream_id=
            args.stream_id,
    )


if __name__ == "__main__":
    main()