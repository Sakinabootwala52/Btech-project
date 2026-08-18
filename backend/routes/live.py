import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request, session, current_app

from config import Config
from services.incident_service import create_incident_from_detection


live_bp = Blueprint("live", __name__)

ALLOWED_EXTENSIONS = {
    "mp4",
    "avi",
    "mov",
    "mkv",
    "webm",
}


def _require_live():
    return session.get("role") == "live"


def _resolve_ml_paths():
    """
    Resolve the Python executable and main.py used by the ML pipeline.
    """

    backend_dir = Path(current_app.root_path).resolve()

    ml_python = Path(Config.ML_PYTHON) if Config.ML_PYTHON else None
    ml_main = Path(Config.ML_MAIN) if Config.ML_MAIN else None

    # ML Python
    if ml_python is None or not str(ml_python):
        ml_python = (
            backend_dir.parent
            / "ml"
            / "venv"
            / "Scripts"
            / "python.exe"
        )
    elif not ml_python.is_absolute():
        ml_python = backend_dir / ml_python

    # ML main.py
    if ml_main is None or not str(ml_main):
        ml_main = backend_dir.parent / "ml" / "main.py"
    elif not ml_main.is_absolute():
        ml_main = backend_dir / ml_main

    # Linux/macOS fallback
    if not ml_python.exists():
        candidate = (
            backend_dir.parent
            / "ml"
            / "venv"
            / "bin"
            / "python"
        )

        if candidate.exists():
            ml_python = candidate
        else:
            ml_python = Path(sys.executable)

    return ml_python, ml_main


@live_bp.get("/me")
def me():
    if not _require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required."
        }), 403

    return jsonify({
        "role": "live",
        "username": session.get("username")
    }), 200


@live_bp.post("/upload")
def upload_video():
    """
    LIVE feed bridge.

    Flow:

        LIVE uploads video
              ↓
        Save source video
              ↓
        Run ML
              ↓
        Read ML JSON result
              ↓
        If accident detected:
              ↓
        Copy generated accident clip
              ↓
        Create MongoDB incident
              ↓
        Hospital dashboards receive incident

    If no accident is detected:
        no incident is created.
    """

    # ---------------------------------------------------------
    # 1. Authentication
    # ---------------------------------------------------------

    if not _require_live():
        return jsonify({
            "error": "FORBIDDEN",
            "message": "Live login required."
        }), 403

    # ---------------------------------------------------------
    # 2. Get uploaded video
    # ---------------------------------------------------------

    file = request.files.get("video")

    camera_id = (
        str(
            request.form.get(
                "camera_id",
                "CAM_001"
            )
        ).strip()
        or "CAM_001"
    )

    if file is None or not file.filename:
        return jsonify({
            "error": "VIDEO_REQUIRED",
            "message": "Choose a video file."
        }), 400

    # ---------------------------------------------------------
    # 3. Validate extension
    # ---------------------------------------------------------

    extension = (
        Path(file.filename)
        .suffix
        .lower()
        .lstrip(".")
    )

    if extension not in ALLOWED_EXTENSIONS:
        return jsonify({
            "error": "UNSUPPORTED_VIDEO",
            "message": (
                "Supported formats: "
                "mp4, avi, mov, mkv, webm."
            )
        }), 400

    # ---------------------------------------------------------
    # 4. Save uploaded source video
    # ---------------------------------------------------------

    upload_dir = Path(Config.UPLOAD_DIR).resolve()
    upload_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    source_name = (
        f"live_{uuid.uuid4().hex[:10]}.{extension}"
    )

    source_path = upload_dir / source_name

    try:
        file.save(source_path)
    except Exception as exc:
        return jsonify({
            "error": "UPLOAD_SAVE_FAILED",
            "message": str(exc)
        }), 500

    # ---------------------------------------------------------
    # 5. Resolve ML paths
    # ---------------------------------------------------------

    ml_python, ml_main = _resolve_ml_paths()

    print("\n========== LIVE ML START ==========")
    print(f"ML Python : {ml_python}")
    print(f"ML Main   : {ml_main}")
    print(f"Video     : {source_path}")
    print(f"Camera    : {camera_id}")
    print("===================================\n")

    if not ml_python.exists():
        return jsonify({
            "error": "ML_PYTHON_NOT_FOUND",
            "message": (
                f"ML Python executable not found: "
                f"{ml_python}"
            )
        }), 500

    if not ml_main.exists():
        return jsonify({
            "error": "ML_NOT_FOUND",
            "message": (
                f"ML entry point not found: "
                f"{ml_main}"
            )
        }), 500

    # ---------------------------------------------------------
    # 6. JSON result file
    # ---------------------------------------------------------

    result_path = (
        upload_dir
        / f"ml_result_{uuid.uuid4().hex[:10]}.json"
    )

    # ---------------------------------------------------------
    # 7. ML command
    # ---------------------------------------------------------

    command = [
        str(ml_python),
        str(ml_main),

        "--video",
        str(source_path),

        "--camera-id",
        camera_id,

        "--no-annotated",

        "--json-out",
        str(result_path),
    ]

    print("ML COMMAND:")
    print(" ".join(command))
    print()

    # ---------------------------------------------------------
    # 8. Run ML
    # ---------------------------------------------------------

    try:
        completed = subprocess.run(
            command,
            cwd=str(ml_main.parent),
            capture_output=True,
            text=True,
            timeout=Config.ML_TIMEOUT_SECONDS,
            check=False,
        )

    except subprocess.TimeoutExpired:
        print("\n========== ML TIMEOUT ==========\n")

        return jsonify({
            "error": "ML_TIMEOUT",
            "message": (
                "ML processing exceeded "
                "the configured timeout."
            )
        }), 504

    except OSError as exc:
        print("\n========== ML START FAILED ==========")
        print(exc)
        print("=====================================\n")

        return jsonify({
            "error": "ML_START_FAILED",
            "message": str(exc)
        }), 500

    # ---------------------------------------------------------
    # 9. Print ML output
    # ---------------------------------------------------------

    print("\n========== ML STDOUT ==========")
    print(completed.stdout)
    print("========== ML STDERR ==========")
    print(completed.stderr)
    print("================================\n")

    # ---------------------------------------------------------
    # 10. Check ML process
    # ---------------------------------------------------------

    if completed.returncode != 0:

        print(
            f"ML exited with code: "
            f"{completed.returncode}"
        )

        return jsonify({
            "error": "ML_FAILED",
            "message": "ML processing failed.",
            "return_code": completed.returncode,
            "stdout": completed.stdout[-4000:],
            "stderr": completed.stderr[-6000:],
        }), 500

    # ---------------------------------------------------------
    # 11. Check result JSON
    # ---------------------------------------------------------

    if not result_path.exists():

        print(
            f"ML result JSON missing: "
            f"{result_path}"
        )

        return jsonify({
            "error": "ML_RESULT_MISSING",
            "message": (
                "ML finished successfully, "
                "but did not produce a result JSON."
            ),
            "stdout": completed.stdout[-4000:],
            "stderr": completed.stderr[-4000:],
        }), 500

    # ---------------------------------------------------------
    # 12. Read result JSON
    # ---------------------------------------------------------

    try:

        result = json.loads(
            result_path.read_text(
                encoding="utf-8"
            )
        )

    except Exception as exc:

        print("\n========== INVALID ML JSON ==========")
        print(exc)
        print("=====================================\n")

        return jsonify({
            "error": "ML_RESULT_INVALID",
            "message": str(exc),
            "stdout": completed.stdout[-4000:],
        }), 500

    print("\n========== ML RESULT JSON ==========")
    print(json.dumps(
        result,
        indent=2,
        default=str
    ))
    print("====================================\n")

    # ---------------------------------------------------------
    # 13. Publish detected accidents
    # ---------------------------------------------------------

    incidents = []

    try:

        events = result.get(
            "events",
            []
        )

        print(
            f"ML returned "
            f"{len(events)} event(s)."
        )

        # -----------------------------------------------------
        # NO ACCIDENT
        # -----------------------------------------------------

        if not events:

            print(
                "No accident detected. "
                "No hospital incident will be created."
            )

        # -----------------------------------------------------
        # ACCIDENT EVENTS
        # -----------------------------------------------------

        for event in events:

            print("\n---------- EVENT ----------")
            print(json.dumps(
                event,
                indent=2,
                default=str
            ))

            clip_value = event.get(
                "video_clip",
                ""
            )

            if not clip_value:

                print(
                    "WARNING: Event has no "
                    "video_clip."
                )

                continue

            clip_source = Path(
                str(clip_value)
            )

            # ML normally produces relative paths
            # such as:
            #
            # outputs/clips/xxx.mp4
            #
            # Resolve them relative to ML folder.

            if not clip_source.is_absolute():

                clip_source = (
                    ml_main.parent
                    / clip_source
                ).resolve()

            else:

                clip_source = clip_source.resolve()

            print(
                f"Looking for ML clip: "
                f"{clip_source}"
            )

            # -------------------------------------------------
            # Clip does not exist
            # -------------------------------------------------

            if not clip_source.exists():

                print(
                    "WARNING: Accident clip "
                    "does not exist."
                )

                continue

            # -------------------------------------------------
            # Copy clip into backend uploads
            # -------------------------------------------------

            public_name = (
                f"{uuid.uuid4().hex[:10]}_"
                f"{clip_source.name}"
            )

            public_path = (
                upload_dir
                / public_name
            )

            shutil.copy2(
                clip_source,
                public_path
            )

            print(
                f"Public accident clip: "
                f"{public_path}"
            )

            # -------------------------------------------------
            # Build incident payload
            # -------------------------------------------------

            payload = dict(event)

            payload["camera_id"] = camera_id

            payload["video_clip"] = (
                f"/uploads/{public_name}"
            )

            # Make sure severity is preserved
            # if the ML supplied it.

            if "severity" not in payload:
                payload["severity"] = {
                    "level": "UNKNOWN",
                    "score": None,
                    "basis": [],
                    "speed_unit": "unknown",
                }

            print("\nIncident payload:")
            print(json.dumps(
                payload,
                indent=2,
                default=str
            ))

            # -------------------------------------------------
            # Create MongoDB incident
            # -------------------------------------------------

            try:

                incident, created = (
                    create_incident_from_detection(
                        payload
                    )
                )

                print(
                    f"Incident service result: "
                    f"created={created}"
                )

                if created:

                    incidents.append(
                        incident
                    )

            except Exception as exc:

                print(
                    "\n========== INCIDENT CREATION ERROR =========="
                )

                import traceback

                traceback.print_exc()

                print(
                    "==============================================\n"
                )

                raise

    except Exception as exc:

        import traceback

        print(
            "\n========== LIVE PUBLISH ERROR =========="
        )

        traceback.print_exc()

        print(
            "========================================\n"
        )

        return jsonify({
            "error": "LIVE_PROCESSING_FAILED",
            "message": (
                "ML completed, but publishing "
                "the incident failed."
            ),
            "details": str(exc),
            "ml_result": result,
        }), 500

    # ---------------------------------------------------------
    # 14. Delete temporary result JSON
    # ---------------------------------------------------------

    try:

        result_path.unlink()

    except OSError:

        pass

    # ---------------------------------------------------------
    # 15. Final response
    # ---------------------------------------------------------

    print("\n========== LIVE COMPLETE ==========")
    print(
        f"Accident detected: "
        f"{bool(incidents)}"
    )
    print(
        f"Incidents created: "
        f"{len(incidents)}"
    )
    print("===================================\n")

    return jsonify({

        "ok": True,

        "camera_id": camera_id,

        "source_video": (
            f"/uploads/{source_name}"
        ),

        "accident_detected": bool(
            incidents
        ),

        "incidents_created": len(
            incidents
        ),

        "incidents": incidents,

        "ml_metrics": result.get(
            "metrics",
            {}
        ),

        "ml_stdout": (
            completed.stdout[-3000:]
        ),

    }), 201