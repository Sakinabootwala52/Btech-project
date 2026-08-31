import json
import shutil
import subprocess
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, session

from config import Config
from services.incident_service import (
    create_incident_from_detection,
)


stream_bp = Blueprint("stream", __name__)

STREAMS = {}


def require_live():
    return session.get("role") == "live"


def resolve_paths():
    backend_dir = Path(__file__).resolve().parents[1]
    project_root = backend_dir.parent

    ml_dir = project_root / "ml"
    sample_video_dir = project_root / "sample_videos"

    python_path = (
        ml_dir
        / "venv"
        / "Scripts"
        / "python.exe"
    )

    worker_path = ml_dir / "stream_worker.py"

    configured_upload_dir = Path(
        Config.UPLOAD_DIR
    )

    if configured_upload_dir.is_absolute():
        upload_dir = configured_upload_dir
    else:
        upload_dir = (
            backend_dir / configured_upload_dir
        )

    return {
        "backend_dir": backend_dir,
        "project_root": project_root,
        "ml_dir": ml_dir,
        "sample_video_dir": sample_video_dir,
        "python_path": python_path,
        "worker_path": worker_path,
        "upload_dir": upload_dir.resolve(),
    }


def write_status(status_file, data):
    status_file.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_file = status_file.with_suffix(
        ".tmp"
    )

    temp_file.write_text(
        json.dumps(
            data,
            indent=2,
            default=str,
        ),
        encoding="utf-8",
    )

    temp_file.replace(status_file)


def publish_stream_events(stream, status):
    """
    Convert ML stream events into MongoDB incidents.

    Each event is published only once.
    """

    events = status.get("events", [])

    if not events:
        return

    published_events = stream.setdefault(
        "published_events",
        set(),
    )

    paths = resolve_paths()

    upload_dir = paths["upload_dir"]
    ml_dir = paths["ml_dir"]

    for event in events:

        event_key = (
            f"{event.get('camera_id')}:"
            f"{event.get('timestamp_seconds')}"
        )

        if event_key in published_events:
            continue

        # -----------------------------------------------------
        # Build incident payload
        # -----------------------------------------------------

        payload = dict(event)

        payload["camera_id"] = (
            stream["camera_id"]
        )

        # The incident service expects "timestamp",
        # while the ML worker provides "timestamp_seconds".
        payload["timestamp"] = (
            event.get("timestamp_seconds", 0)
        )

        # -----------------------------------------------------
        # Copy evidence clip to public backend uploads
        # -----------------------------------------------------

        clip_value = event.get(
            "video_clip"
        )

        if clip_value:

            clip_source = Path(
                str(clip_value)
            )

            if not clip_source.is_absolute():
                clip_source = (
                    ml_dir / clip_source
                ).resolve()

            if clip_source.exists():

                public_name = (
                    f"{uuid.uuid4().hex[:10]}_"
                    f"{clip_source.name}"
                )

                public_path = (
                    upload_dir / public_name
                )

                upload_dir.mkdir(
                    parents=True,
                    exist_ok=True,
                )

                shutil.copy2(
                    clip_source,
                    public_path,
                )

                payload["video_clip"] = (
                    f"/uploads/{public_name}"
                )

        # -----------------------------------------------------
        # Create MongoDB incident
        # -----------------------------------------------------

        try:

            incident, created = (
                create_incident_from_detection(
                    payload
                )
            )

            if created:

                print(
                    "\n========== STREAM INCIDENT CREATED =========="
                )

                print(
                    json.dumps(
                        incident,
                        indent=2,
                        default=str,
                    )
                )

                print(
                    "==============================================\n"
                )

            else:

                print(
                    "Stream event already existed: "
                    f"{event_key}"
                )

            published_events.add(
                event_key
            )

        except Exception as exc:

            print(
                "\n========== STREAM INCIDENT ERROR =========="
            )

            print(
                f"Event: {event_key}"
            )

            print(
                f"Error: {exc}"
            )

            print(
                "============================================\n"
            )

            # Don't mark as published.
            # The next status poll can retry it.


@stream_bp.post("/start")
def start_stream():

    if not require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required.",
        }), 403

    data = request.get_json(
        silent=True
    ) or {}

    camera_id = (
        str(
            data.get(
                "camera_id",
                "CAM_001",
            )
        ).strip()
        or "CAM_001"
    )

    source_name = (
        str(
            data.get(
                "source",
                "clip_01.mp4",
            )
        ).strip()
    )

    paths = resolve_paths()

    sample_video_dir = (
        paths["sample_video_dir"]
    )

    source_path = (
        sample_video_dir
        / Path(source_name).name
    ).resolve()

    try:
        source_path.relative_to(
            sample_video_dir.resolve()
        )
    except ValueError:
        return jsonify({
            "error": "INVALID_SOURCE",
            "message": (
                "Source must be inside "
                "sample_videos."
            ),
        }), 400

    if not source_path.exists():
        return jsonify({
            "error": "SOURCE_NOT_FOUND",
            "message": str(source_path),
        }), 404

    python_path = paths["python_path"]
    worker_path = paths["worker_path"]

    if not python_path.exists():
        return jsonify({
            "error": "ML_PYTHON_NOT_FOUND",
            "message": str(python_path),
        }), 500

    if not worker_path.exists():
        return jsonify({
            "error": "STREAM_WORKER_NOT_FOUND",
            "message": str(worker_path),
        }), 500

    for existing in STREAMS.values():

        if (
            existing["camera_id"]
            == camera_id
            and existing["process"].poll()
            is None
        ):
            return jsonify({
                "error": "STREAM_ALREADY_RUNNING",
                "stream_id": existing["stream_id"],
            }), 409

    stream_id = uuid.uuid4().hex[:10]

    status_dir = (
        paths["upload_dir"] / "streams"
    )

    status_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    status_file = (
        status_dir
        / f"{stream_id}.json"
    )

    log_file = (
        status_dir
        / f"{stream_id}.log"
    )

    write_status(
        status_file,
        {
            "status": "starting",
            "stream_id": stream_id,
            "camera_id": camera_id,
            "source": str(source_path),
            "frames_processed": 0,
            "last_timestamp": 0,
            "accident_detected": False,
            "last_detection": {
                "accident_detected": False,
                "confidence": 0.0,
                "severity": {
                    "level": "none",
                    "score": 0,
                    "basis": [],
                },
            },
            "events": [],
            "elapsed_seconds": 0,
        },
    )

    command = [
        str(python_path),
        str(worker_path),
        "--source",
        str(source_path),
        "--camera-id",
        camera_id,
        "--status-file",
        str(status_file),
        "--inference-stride",
        "2",
    ]

    try:

        log_handle = open(
            log_file,
            "a",
            encoding="utf-8",
        )

        process = subprocess.Popen(
            command,
            cwd=str(paths["ml_dir"]),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )

    except Exception as exc:

        write_status(
            status_file,
            {
                "status": "failed",
                "stream_id": stream_id,
                "camera_id": camera_id,
                "source": str(source_path),
                "frames_processed": 0,
                "last_timestamp": 0,
                "accident_detected": False,
                "events": [],
                "error": str(exc),
            },
        )

        return jsonify({
            "error": "ML_START_FAILED",
            "message": str(exc),
        }), 500

    STREAMS[stream_id] = {
        "stream_id": stream_id,
        "camera_id": camera_id,
        "source": str(source_path),
        "status_file": status_file,
        "log_file": log_file,
        "process": process,
        "log_handle": log_handle,
        "published_events": set(),
    }

    return jsonify({
        "ok": True,
        "stream_id": stream_id,
        "camera_id": camera_id,
        "source": source_name,
        "status": "starting",
    }), 201


@stream_bp.get("/<stream_id>")
def stream_status(stream_id):

    if not require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required.",
        }), 403

    stream = STREAMS.get(stream_id)

    if stream is None:
        return jsonify({
            "error": "STREAM_NOT_FOUND",
        }), 404

    status_file = stream["status_file"]

    if status_file.exists():

        try:

            status = json.loads(
                status_file.read_text(
                    encoding="utf-8"
                )
            )

        except (
            json.JSONDecodeError,
            OSError,
        ):

            status = {
                "status": "starting",
                "stream_id": stream_id,
                "camera_id": stream[
                    "camera_id"
                ],
            }

    else:

        status = {
            "status": "starting",
            "stream_id": stream_id,
            "camera_id": stream[
                "camera_id"
            ],
        }

    process = stream["process"]

    if process.poll() is not None:

        if status.get("status") == "starting":

            status["status"] = "failed"

            log_file = stream.get(
                "log_file"
            )

            if (
                log_file
                and log_file.exists()
            ):

                try:

                    status["error"] = (
                        log_file.read_text(
                            encoding="utf-8"
                        )[-4000:]
                    )

                except OSError:
                    pass

    # ---------------------------------------------------------
    # NEW:
    # Publish ML events to MongoDB.
    # ---------------------------------------------------------

    publish_stream_events(
        stream,
        status,
    )

    return jsonify({
        "ok": True,
        "stream_id": stream_id,
        **status,
    }), 200


@stream_bp.post("/<stream_id>/stop")
def stop_stream(stream_id):

    if not require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required.",
        }), 403

    stream = STREAMS.get(stream_id)

    if stream is None:
        return jsonify({
            "error": "STREAM_NOT_FOUND",
        }), 404

    process = stream["process"]

    if process.poll() is None:

        process.terminate()

        try:

            process.wait(
                timeout=5
            )

        except subprocess.TimeoutExpired:

            process.kill()

    log_handle = stream.get(
        "log_handle"
    )

    if log_handle:

        try:
            log_handle.close()
        except Exception:
            pass

    return jsonify({
        "ok": True,
        "stream_id": stream_id,
        "status": "stopped",
    }), 200