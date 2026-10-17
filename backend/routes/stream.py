import json
import subprocess
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, session
from pymongo import ReturnDocument

from config import Config
from database.mongo import incidents_collection
from services.incident_service import (
    create_incident_from_detection,
)
from utils.serializers import serialize_document


stream_bp = Blueprint("stream", __name__)

STREAMS = {}

DEFAULT_CALLBACK_URL = (
    "http://127.0.0.1:5000/api/live/stream/internal/event"
)


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

    worker_path = (
        ml_dir
        / "stream_worker.py"
    )

    configured_upload_dir = Path(
        Config.UPLOAD_DIR
    )

    if configured_upload_dir.is_absolute():
        upload_dir = configured_upload_dir
    else:
        upload_dir = (
            backend_dir
            / configured_upload_dir
        )

    return {
        "backend_dir": backend_dir,
        "project_root": project_root,
        "ml_dir": ml_dir,
        "sample_video_dir":
            sample_video_dir,
        "python_path":
            python_path,
        "worker_path":
            worker_path,
        "upload_dir":
            upload_dir.resolve(),
    }


def write_status(
    status_file,
    data,
):
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

    temp_file.replace(
        status_file
    )


def copy_clip_to_public_uploads(
    clip_value,
):
    if not clip_value:
        return None

    paths = resolve_paths()

    upload_dir = paths["upload_dir"]
    ml_dir = paths["ml_dir"]

    clip_source = Path(
        str(clip_value)
    )

    if not clip_source.is_absolute():
        clip_source = (
            ml_dir
            / clip_source
        ).resolve()

    if not clip_source.exists():
        return None

    upload_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    public_name = (
        f"{uuid.uuid4().hex[:10]}_"
        f"{clip_source.name}"
    )

    public_path = (
        upload_dir
        / public_name
    )

    try:
        import shutil

        shutil.copy2(
            clip_source,
            public_path,
        )
    except OSError:
        return None

    return (
        f"/uploads/{public_name}"
    )


def build_payload(
    stream,
    event,
):
    payload = dict(event)

    payload["camera_id"] = (
        stream["camera_id"]
    )

    payload["timestamp"] = (
        event.get(
            "timestamp_seconds",
            0,
        )
    )

    return payload


# ============================================================
# FALLBACK FINAL EVENT PUBLISHER
# ============================================================

def publish_final_event(
    stream,
    event,
):
    payload = build_payload(
        stream,
        event,
    )

    public_clip = (
        copy_clip_to_public_uploads(
            event.get("video_clip")
        )
    )

    if public_clip:
        payload["video_clip"] = (
            public_clip
        )

    event_key = (
        f"{stream['camera_id']}:"
        f"{event.get('timestamp_seconds')}"
    )

    try:
        incident, created = (
            create_incident_from_detection(
                payload
            )
        )

        incident_id = incident.get(
            "incident_id"
        )

        if incident_id:
            stream["incident_id"] = (
                incident_id
            )

        stream.setdefault(
            "published_events",
            set(),
        ).add(
            event_key
        )

        # If incident was already created by the
        # immediate callback, attach the final evidence.
        if not created and incident_id:

            update_fields = {}

            for key in [
                "confidence",
                "speed_before",
                "speed_after",
                "speed_anomaly",
                "trajectory_anomaly",
                "collision_proximity",
                "persistent_abnormal_motion",
                "severity",
            ]:
                value = payload.get(
                    key
                )

                if value is not None:
                    update_fields[key] = (
                        value
                    )

            if payload.get(
                "video_clip"
            ):
                update_fields[
                    "video_clip"
                ] = payload[
                    "video_clip"
                ]

            if update_fields:
                updated = (
                    incidents_collection()
                    .find_one_and_update(
                        {
                            "incident_id":
                                incident_id
                        },
                        {
                            "$set":
                                update_fields
                        },
                        return_document=
                            ReturnDocument.AFTER,
                    )
                )

                if updated:
                    incident = (
                        serialize_document(
                            updated
                        )
                    )

        return incident

    except Exception as exc:
        print(
            "\n========== STREAM PUBLISH ERROR =========="
        )
        print(
            f"Error: {exc}"
        )
        print(
            "============================================\n"
        )

        return None


def publish_stream_events(
    stream,
    status,
):
    """
    Safety net.

    Normally events are already sent directly from
    stream_worker.py through the callback endpoint.
    """

    events = status.get(
        "events",
        [],
    )

    if not events:
        return

    published_events = stream.setdefault(
        "published_events",
        set(),
    )

    for event in events:

        event_key = (
            f"{stream['camera_id']}:"
            f"{event.get('timestamp_seconds')}"
        )

        if event_key in published_events:
            continue

        publish_final_event(
            stream,
            event,
        )


# ============================================================
# IMMEDIATE ML CALLBACK
# ============================================================

@stream_bp.post(
    "/internal/event"
)
def internal_stream_event():

    data = request.get_json(
        silent=True
    ) or {}

    stream_id = str(
        data.get(
            "stream_id",
            "",
        )
    ).strip()

    token = str(
        data.get(
            "token",
            "",
        )
    ).strip()

    event_type = str(
        data.get(
            "event_type",
            "",
        )
    ).strip().lower()

    event = data.get(
        "event"
    ) or {}

    if not stream_id:
        return jsonify({
            "error":
                "STREAM_ID_REQUIRED"
        }), 400

    stream = STREAMS.get(
        stream_id
    )

    if stream is None:
        return jsonify({
            "error":
                "STREAM_NOT_FOUND"
        }), 404

    if token != stream.get(
        "callback_token"
    ):
        return jsonify({
            "error":
                "INVALID_CALLBACK_TOKEN"
        }), 403

    if event_type not in {
        "detected",
        "finalized",
    }:
        return jsonify({
            "error":
                "INVALID_EVENT_TYPE"
        }), 400

    # ========================================================
    # IMMEDIATE DETECTION
    # ========================================================

    if event_type == "detected":

        payload = build_payload(
            stream,
            event,
        )

        # No evidence clip yet.
        # Hospital should NOT wait for it.
        payload["video_clip"] = None

        try:
            incident, created = (
                create_incident_from_detection(
                    payload
                )
            )

            incident_id = (
                incident.get(
                    "incident_id"
                )
            )

            stream["incident_id"] = (
                incident_id
            )

            print(
                "\n"
                "========== IMMEDIATE "
                "INCIDENT CREATED =========="
            )

            print(
                f"STREAM ID : {stream_id}"
            )

            print(
                f"INCIDENT  : {incident_id}"
            )

            print(
                f"CREATED   : {created}"
            )

            print(
                "============================================"
                "\n"
            )

            return jsonify({
                "ok":
                    True,

                "created":
                    created,

                "incident_id":
                    incident_id,

                "incident":
                    serialize_document(
                        incident
                    ),
            }), 200

        except Exception as exc:

            print(
                "\n"
                "========== IMMEDIATE "
                "INCIDENT ERROR =========="
            )

            print(
                f"Error: {exc}"
            )

            print(
                "============================================"
                "\n"
            )

            return jsonify({
                "error":
                    "INCIDENT_CREATE_FAILED",

                "message":
                    str(exc),
            }), 500

    # ========================================================
    # FINALIZED EVENT
    # ========================================================

    incident_id = (
        data.get(
            "incident_id"
        )
        or stream.get(
            "incident_id"
        )
    )

    payload = build_payload(
        stream,
        event,
    )

    public_clip = (
        copy_clip_to_public_uploads(
            event.get("video_clip")
        )
    )

    update_fields = {}

    for key in [
        "confidence",
        "speed_before",
        "speed_after",
        "speed_anomaly",
        "trajectory_anomaly",
        "collision_proximity",
        "persistent_abnormal_motion",
        "severity",
    ]:

        value = payload.get(
            key
        )

        if value is not None:
            update_fields[key] = (
                value
            )

    if public_clip:
        update_fields[
            "video_clip"
        ] = public_clip

    if not incident_id:

        try:
            incident, created = (
                create_incident_from_detection(
                    payload
                )
            )

            incident_id = (
                incident.get(
                    "incident_id"
                )
            )

            if update_fields:
                updated = (
                    incidents_collection()
                    .find_one_and_update(
                        {
                            "incident_id":
                                incident_id
                        },
                        {
                            "$set":
                                update_fields
                        },
                        return_document=
                            ReturnDocument.AFTER,
                    )
                )

                if updated:
                    incident = (
                        serialize_document(
                            updated
                        )
                    )

            return jsonify({
                "ok":
                    True,

                "created":
                    created,

                "incident_id":
                    incident_id,

                "incident":
                    incident,
            }), 200

        except Exception as exc:

            return jsonify({
                "error":
                    "INCIDENT_FINALIZE_FAILED",

                "message":
                    str(exc),
            }), 500

    # Update existing immediate incident.
    try:

        updated = (
            incidents_collection()
            .find_one_and_update(
                {
                    "incident_id":
                        incident_id
                },
                {
                    "$set":
                        update_fields
                },
                return_document=
                    ReturnDocument.AFTER,
            )
        )

        if updated is None:
            return jsonify({
                "error":
                    "INCIDENT_NOT_FOUND"
            }), 404

        print(
            "\n"
            "========== INCIDENT "
            "EVIDENCE ATTACHED =========="
        )

        print(
            f"INCIDENT : {incident_id}"
        )

        print(
            f"CLIP     : {public_clip}"
        )

        print(
            "============================================"
            "\n"
        )

        return jsonify({
            "ok":
                True,

            "incident_id":
                incident_id,

            "incident":
                serialize_document(
                    updated
                ),
        }), 200

    except Exception as exc:

        return jsonify({
            "error":
                "INCIDENT_UPDATE_FAILED",

            "message":
                str(exc),
        }), 500


# ============================================================
# START STREAM
# ============================================================

@stream_bp.post(
    "/start"
)
def start_stream():

    if not require_live():
        return jsonify({
            "error":
                "FORBIDDEN",
            "message":
                "Live login required.",
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
        / Path(
            source_name
        ).name
    ).resolve()

    try:

        source_path.relative_to(
            sample_video_dir.resolve()
        )

    except ValueError:

        return jsonify({
            "error":
                "INVALID_SOURCE",
            "message":
                "Source must be inside sample_videos.",
        }), 400

    if not source_path.exists():

        return jsonify({
            "error":
                "SOURCE_NOT_FOUND",
            "message":
                str(source_path),
        }), 404

    python_path = (
        paths["python_path"]
    )

    worker_path = (
        paths["worker_path"]
    )

    if not python_path.exists():

        return jsonify({
            "error":
                "ML_PYTHON_NOT_FOUND",
            "message":
                str(python_path),
        }), 500

    if not worker_path.exists():

        return jsonify({
            "error":
                "STREAM_WORKER_NOT_FOUND",
            "message":
                str(worker_path),
        }), 500

    for existing in STREAMS.values():

        if (
            existing["camera_id"]
            == camera_id
            and existing["process"].poll()
            is None
        ):

            return jsonify({
                "error":
                    "STREAM_ALREADY_RUNNING",

                "stream_id":
                    existing[
                        "stream_id"
                    ],
            }), 409

    stream_id = (
        uuid.uuid4().hex[:10]
    )

    callback_token = (
        uuid.uuid4().hex
    )

    status_dir = (
        paths["upload_dir"]
        / "streams"
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
            "status":
                "starting",

            "stream_id":
                stream_id,

            "camera_id":
                camera_id,

            "source":
                str(source_path),

            "frames_processed":
                0,

            "last_timestamp":
                0,

            "accident_detected":
                False,

            "last_detection": {
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
            },

            "events":
                [],

            "incident_id":
                None,

            "elapsed_seconds":
                0,
        },
    )

    callback_url = (
        DEFAULT_CALLBACK_URL
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

        "--callback-url",
        callback_url,

        "--callback-token",
        callback_token,

        "--stream-id",
        stream_id,
    ]

    try:

        log_handle = open(
            log_file,
            "a",
            encoding="utf-8",
        )

        process = subprocess.Popen(
            command,
            cwd=str(
                paths["ml_dir"]
            ),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
        )

    except Exception as exc:

        write_status(
            status_file,
            {
                "status":
                    "failed",

                "stream_id":
                    stream_id,

                "camera_id":
                    camera_id,

                "source":
                    str(source_path),

                "frames_processed":
                    0,

                "last_timestamp":
                    0,

                "accident_detected":
                    False,

                "events":
                    [],

                "error":
                    str(exc),
            },
        )

        return jsonify({
            "error":
                "ML_START_FAILED",

            "message":
                str(exc),
        }), 500

    STREAMS[stream_id] = {

        "stream_id":
            stream_id,

        "camera_id":
            camera_id,

        "source":
            str(source_path),

        "status_file":
            status_file,

        "log_file":
            log_file,

        "process":
            process,

        "log_handle":
            log_handle,

        "published_events":
            set(),

        "callback_token":
            callback_token,

        "incident_id":
            None,
    }

    print(
        "\n========== STREAM STARTED =========="
    )

    print(
        f"STREAM ID     : {stream_id}"
    )

    print(
        f"CAMERA        : {camera_id}"
    )

    print(
        f"CALLBACK URL  : {callback_url}"
    )

    print(
        "====================================\n"
    )

    return jsonify({
        "ok":
            True,

        "stream_id":
            stream_id,

        "camera_id":
            camera_id,

        "source":
            source_name,

        "status":
            "starting",
    }), 201


# ============================================================
# STREAM STATUS
# ============================================================

@stream_bp.get(
    "/<stream_id>"
)
def stream_status(
    stream_id
):

    if not require_live():
        return jsonify({
            "error":
                "FORBIDDEN",
            "message":
                "Live login required.",
        }), 403

    stream = STREAMS.get(
        stream_id
    )

    if stream is None:
        return jsonify({
            "error":
                "STREAM_NOT_FOUND"
        }), 404

    status_file = (
        stream["status_file"]
    )

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
                "status":
                    "starting",

                "stream_id":
                    stream_id,

                "camera_id":
                    stream["camera_id"],
            }

    else:

        status = {
            "status":
                "starting",

            "stream_id":
                stream_id,

            "camera_id":
                stream["camera_id"],
        }

    process = (
        stream["process"]
    )

    if process.poll() is not None:

        if (
            status.get(
                "status"
            )
            == "starting"
        ):

            status["status"] = (
                "failed"
            )

            log_file = (
                stream.get(
                    "log_file"
                )
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

    # Safety-net publish.
    publish_stream_events(
        stream,
        status,
    )

    if stream.get(
        "incident_id"
    ):

        status[
            "incident_id"
        ] = stream[
            "incident_id"
        ]

    return jsonify({
        "ok":
            True,

        "stream_id":
            stream_id,

        **status,
    }), 200


# ============================================================
# STOP STREAM
# ============================================================

@stream_bp.post(
    "/<stream_id>/stop"
)
def stop_stream(
    stream_id
):

    if not require_live():
        return jsonify({
            "error":
                "FORBIDDEN",

            "message":
                "Live login required.",
        }), 403

    stream = STREAMS.get(
        stream_id
    )

    if stream is None:
        return jsonify({
            "error":
                "STREAM_NOT_FOUND"
        }), 404

    process = (
        stream["process"]
    )

    if process.poll() is None:

        process.terminate()

        try:

            process.wait(
                timeout=5
            )

        except subprocess.TimeoutExpired:

            process.kill()

    log_handle = (
        stream.get(
            "log_handle"
        )
    )

    if log_handle:

        try:
            log_handle.close()
        except Exception:
            pass

    return jsonify({
        "ok":
            True,

        "stream_id":
            stream_id,

        "status":
            "stopped",
    }), 200