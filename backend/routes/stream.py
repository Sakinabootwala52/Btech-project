
import json
import os
import shutil
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, jsonify, request, session
from pymongo import ReturnDocument

from config import Config
from database.mongo import incidents_collection, cameras_collection
from services.incident_service import create_incident_from_detection
from utils.serializers import serialize_document


stream_bp = Blueprint("stream", __name__)

STREAMS = {}
STREAMS_LOCK = threading.RLock()

DEFAULT_CALLBACK_URL = (
    "http://127.0.0.1:5000/api/live/stream/internal/event"
)


def require_live():
    return session.get("role") == "live"


def resolve_paths():
    backend_dir = Path(__file__).resolve().parents[1]
    project_root = backend_dir.parent
    ml_dir = project_root / "ml"

    configured_upload_dir = Path(Config.UPLOAD_DIR)
    upload_dir = (
        configured_upload_dir
        if configured_upload_dir.is_absolute()
        else backend_dir / configured_upload_dir
    )

    return {
        "backend_dir": backend_dir,
        "project_root": project_root,
        "ml_dir": ml_dir,
        "sample_video_dir": project_root / "sample_videos",
        "python_path": ml_dir / ".venv" / "Scripts" / "python.exe",
        "worker_path": ml_dir / "stream_worker.py",
        "upload_dir": upload_dir.resolve(),
    }


def write_status(status_file, data):
    status_file = Path(status_file)
    status_file.parent.mkdir(parents=True, exist_ok=True)

    temp_file = status_file.with_name(
        f"{status_file.stem}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    )

    try:
        with temp_file.open("w", encoding="utf-8") as file:
            json.dump(data, file, indent=2, default=str)
            file.flush()
            os.fsync(file.fileno())

        os.replace(str(temp_file), str(status_file))
    finally:
        try:
            temp_file.unlink(missing_ok=True)
        except OSError:
            pass


def copy_clip_to_public_uploads(clip_value):
    if not clip_value:
        return None

    paths = resolve_paths()
    ml_dir = paths["ml_dir"]
    upload_dir = paths["upload_dir"]

    clip_source = Path(str(clip_value))

    if not clip_source.is_absolute():
        clip_source = (ml_dir / clip_source).resolve()

    if not clip_source.is_file():
        return None

    upload_dir.mkdir(parents=True, exist_ok=True)

    public_name = f"{uuid.uuid4().hex[:10]}_{clip_source.name}"
    public_path = upload_dir / public_name

    try:
        shutil.copy2(clip_source, public_path)
    except OSError as exc:
        print(f"CLIP COPY ERROR: {exc}", flush=True)
        return None

    return f"/uploads/{public_name}"


def build_payload(stream, event):
    payload = dict(event)
    payload["camera_id"] = stream["camera_id"]
    payload["event_id"] = event.get("event_id")
    payload["video_timestamp_seconds"] = event.get(
        "timestamp_seconds"
    )

    # Keep the original video timestamp separate from the database
    # creation timestamp.
    payload["timestamp"] = datetime.now(timezone.utc).isoformat()

    return payload


def event_key_for(stream, event):
    event_id = event.get("event_id")

    if event_id:
        return str(event_id)

    return (
        f"{stream['camera_id']}:"
        f"{event.get('timestamp_seconds')}"
    )


def remember_event_incident(stream, event_key, incident_id):
    if not incident_id:
        return

    with STREAMS_LOCK:
        stream.setdefault("incident_ids", {})[
            str(event_key)
        ] = incident_id

        # Retain the most recently created incident for older dashboard code.
        stream["incident_id"] = incident_id


def update_incident_evidence(incident_id, camera_id, payload, public_clip):
    update_fields = {}

    for key in (
        "confidence",
        "speed_before",
        "speed_after",
        "speed_anomaly",
        "trajectory_anomaly",
        "collision_proximity",
        "persistent_abnormal_motion",
        "severity",
        "severity_score",
        "evidence",
    ):
        if payload.get(key) is not None:
            update_fields[key] = payload[key]

    if public_clip:
        update_fields["video_clip"] = public_clip

    if not update_fields:
        return None

    updated = incidents_collection().find_one_and_update(
        {
            "incident_id": incident_id,
            "camera_id": camera_id,
        },
        {"$set": update_fields},
        return_document=ReturnDocument.AFTER,
    )

    return serialize_document(updated) if updated else None


def publish_final_event(stream, event):
    payload = build_payload(stream, event)
    event_key = event_key_for(stream, event)

    public_clip = copy_clip_to_public_uploads(
        event.get("video_clip")
    )

    if public_clip:
        payload["video_clip"] = public_clip

    incident_id = stream.get("incident_ids", {}).get(event_key)

    try:
        if incident_id:
            incident = update_incident_evidence(
                incident_id,
                stream["camera_id"],
                payload,
                public_clip,
            )

            if incident:
                stream.setdefault("published_events", set()).add(
                    event_key
                )
                return incident

        # Fallback for a missed immediate callback. The incident
        # service should deduplicate using camera_id + event_id.
        incident, created = create_incident_from_detection(payload)
        incident_id = incident.get("incident_id")

        if not incident_id:
            return None

        remember_event_incident(stream, event_key, incident_id)

        if not created:
            updated = update_incident_evidence(
                incident_id,
                stream["camera_id"],
                payload,
                public_clip,
            )
            if updated:
                incident = updated

        stream.setdefault("published_events", set()).add(event_key)
        return incident

    except Exception as exc:
        print(f"FINAL EVENT PUBLISH ERROR: {exc}", flush=True)
        return None


def publish_stream_events(stream, status):
    for event in status.get("events", []):
        event_key = event_key_for(stream, event)

        if event_key in stream.setdefault("published_events", set()):
            continue

        publish_final_event(stream, event)


@stream_bp.post("/internal/event")
def internal_stream_event():
    data = request.get_json(silent=True) or {}

    stream_id = str(data.get("stream_id", "")).strip()
    token = str(data.get("token", "")).strip()
    event_type = str(data.get("event_type", "")).strip().lower()
    event = data.get("event") or {}

    if not stream_id:
        return jsonify({"error": "STREAM_ID_REQUIRED"}), 400

    with STREAMS_LOCK:
        stream = STREAMS.get(stream_id)

    if stream is None:
        return jsonify({"error": "STREAM_NOT_FOUND"}), 404

    if token != stream.get("callback_token"):
        return jsonify({"error": "INVALID_CALLBACK_TOKEN"}), 403

    if event_type not in {"detected", "finalized"}:
        return jsonify({"error": "INVALID_EVENT_TYPE"}), 400

    event_key = event_key_for(stream, event)
    payload = build_payload(stream, event)

    if event_type == "detected":
        # The immediate event must not overwrite evidence uploaded later.
        payload["video_clip"] = None

        try:
            incident, created = create_incident_from_detection(payload)
            incident_id = incident.get("incident_id")

            if not incident_id:
                return jsonify({"error": "INCIDENT_ID_MISSING"}), 500

            remember_event_incident(stream, event_key, incident_id)

            print(
                f"ACCIDENT DETECTED | stream={stream_id} "
                f"| event={event_key} | incident={incident_id} "
                f"| created={created}",
                flush=True,
            )

            return jsonify({
                "ok": True,
                "created": created,
                "event_id": event_key,
                "incident_id": incident_id,
                "incident": serialize_document(incident),
            }), 200

        except Exception as exc:
            print(f"INCIDENT CREATE ERROR: {exc}", flush=True)
            return jsonify({
                "error": "INCIDENT_CREATE_FAILED",
                "message": str(exc),
            }), 500

    # Finalized event: resolve the incident for this event only.
    incident_id = (
        data.get("incident_id")
        or stream.get("incident_ids", {}).get(event_key)
    )

    public_clip = copy_clip_to_public_uploads(
        event.get("video_clip")
    )

    try:
        if incident_id:
            incident = update_incident_evidence(
                incident_id,
                stream["camera_id"],
                payload,
                public_clip,
            )

            if incident is None:
                return jsonify({
                    "error": "INCIDENT_NOT_FOUND",
                    "incident_id": incident_id,
                }), 404
        else:
            # Fallback if the immediate event did not create an incident.
            if public_clip:
                payload["video_clip"] = public_clip

            incident, created = create_incident_from_detection(payload)
            incident_id = incident.get("incident_id")

            if not incident_id:
                return jsonify({"error": "INCIDENT_ID_MISSING"}), 500

            remember_event_incident(stream, event_key, incident_id)

            if not created:
                updated = update_incident_evidence(
                    incident_id,
                    stream["camera_id"],
                    payload,
                    public_clip,
                )
                if updated:
                    incident = updated

        stream.setdefault("published_events", set()).add(event_key)

        return jsonify({
            "ok": True,
            "event_id": event_key,
            "incident_id": incident_id,
            "incident": incident,
        }), 200

    except Exception as exc:
        print(f"INCIDENT FINALIZATION ERROR: {exc}", flush=True)
        return jsonify({
            "error": "INCIDENT_FINALIZATION_FAILED",
            "message": str(exc),
        }), 500


@stream_bp.post("/start")
def start_stream():
    if not require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required.",
        }), 403

    data = request.get_json(silent=True) or {}

    camera_id = str(data.get("camera_id", "CAM_001")).strip()
    source_name = str(data.get("source", "clip_01.mp4")).strip()

    if not camera_id:
        return jsonify({"error": "CAMERA_ID_REQUIRED"}), 400

    camera = cameras_collection().find_one({"camera_id": camera_id})

    if camera is None:
        return jsonify({
            "error": "CAMERA_NOT_FOUND",
            "message": f"Camera '{camera_id}' is not registered.",
        }), 400

    paths = resolve_paths()
    sample_dir = paths["sample_video_dir"].resolve()

    source_path = (sample_dir / Path(source_name).name).resolve()

    try:
        source_path.relative_to(sample_dir)
    except ValueError:
        return jsonify({"error": "INVALID_SOURCE"}), 400

    if not source_path.is_file():
        return jsonify({
            "error": "SOURCE_NOT_FOUND",
            "message": str(source_path),
        }), 404

    python_path = paths["python_path"]
    worker_path = paths["worker_path"]

    if not python_path.is_file():
        return jsonify({
            "error": "ML_PYTHON_NOT_FOUND",
            "message": str(python_path),
        }), 500

    if not worker_path.is_file():
        return jsonify({
            "error": "STREAM_WORKER_NOT_FOUND",
            "message": str(worker_path),
        }), 500

    try:
        max_streams = max(
            1, int(os.getenv("MAX_CONCURRENT_STREAMS", "4"))
        )
    except ValueError:
        max_streams = 4

    with STREAMS_LOCK:
        active_streams = [
            item for item in STREAMS.values()
            if item["process"].poll() is None
        ]

        for item in active_streams:
            if item["camera_id"] == camera_id:
                return jsonify({
                    "error": "STREAM_ALREADY_RUNNING",
                    "stream_id": item["stream_id"],
                }), 409

        if len(active_streams) >= max_streams:
            return jsonify({
                "error": "STREAM_CAPACITY_REACHED",
                "message": (
                    f"Maximum concurrent streams: {max_streams}. "
                    "Benchmark hardware before increasing this limit."
                ),
                "active_streams": len(active_streams),
                "max_concurrent_streams": max_streams,
            }), 429

        stream_id = uuid.uuid4().hex[:10]
        callback_token = uuid.uuid4().hex

        status_dir = paths["upload_dir"] / "streams"
        status_dir.mkdir(parents=True, exist_ok=True)

        status_file = status_dir / f"{stream_id}.json"
        log_file = status_dir / f"{stream_id}.log"

        write_status(status_file, {
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
            "incident_id": None,
            "elapsed_seconds": 0,
        })

        command = [
            str(python_path),
            str(worker_path),
            "--source", str(source_path),
            "--camera-id", camera_id,
            "--status-file", str(status_file),
            "--inference-stride", "2",
            "--callback-url", DEFAULT_CALLBACK_URL,
            "--callback-token", callback_token,
            "--stream-id", stream_id,
        ]

        log_handle = None

        try:
            log_handle = log_file.open("a", encoding="utf-8")

            process = subprocess.Popen(
                command,
                cwd=str(paths["ml_dir"]),
                stdout=log_handle,
                stderr=subprocess.STDOUT,
                text=True,
            )

        except Exception as exc:
            if log_handle:
                log_handle.close()

            write_status(status_file, {
                "status": "failed",
                "stream_id": stream_id,
                "camera_id": camera_id,
                "error": str(exc),
                "frames_processed": 0,
                "events": [],
            })

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
            "incident_ids": {},
            "callback_token": callback_token,
            "incident_id": None,
        }

    print(
        f"STREAM STARTED | id={stream_id} | camera={camera_id}",
        flush=True,
    )

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

    with STREAMS_LOCK:
        stream = STREAMS.get(stream_id)

    if stream is None:
        return jsonify({"error": "STREAM_NOT_FOUND"}), 404

    status_file = stream["status_file"]

    try:
        if status_file.exists():
            status = json.loads(
                status_file.read_text(encoding="utf-8")
            )
        else:
            status = {
                "status": "starting",
                "stream_id": stream_id,
                "camera_id": stream["camera_id"],
                "events": [],
            }
    except (json.JSONDecodeError, OSError) as exc:
        status = {
            "status": "starting",
            "stream_id": stream_id,
            "camera_id": stream["camera_id"],
            "status_read_error": str(exc),
            "events": [],
        }

    process = stream["process"]

    if process.poll() is not None and status.get("status") == "starting":
        status["status"] = "failed"

        log_file = stream.get("log_file")
        if log_file and log_file.exists():
            try:
                status["error"] = log_file.read_text(
                    encoding="utf-8"
                )[-4000:]
            except OSError:
                pass

    publish_stream_events(stream, status)

    status["incident_ids"] = dict(stream.get("incident_ids", {}))

    if stream.get("incident_id"):
        status["incident_id"] = stream["incident_id"]

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

    with STREAMS_LOCK:
        stream = STREAMS.get(stream_id)

    if stream is None:
        return jsonify({"error": "STREAM_NOT_FOUND"}), 404

    process = stream["process"]

    try:
        if process.poll() is None:
            process.terminate()

            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    except Exception as exc:
        return jsonify({
            "error": "STREAM_STOP_FAILED",
            "message": str(exc),
        }), 500

    log_handle = stream.get("log_handle")
    if log_handle:
        try:
            log_handle.close()
        except OSError:
            pass

    return jsonify({
        "ok": True,
        "stream_id": stream_id,
        "status": "stopped",
    }), 200
