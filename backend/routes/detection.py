from flask import Blueprint, jsonify, request

from config import Config
from services.incident_service import create_incident_from_detection
from utils.validation import parse_timestamp

detection_bp = Blueprint("detection", __name__)

@detection_bp.post("")
def detect_accident_event():
    """
    Entry point for the ML module.

    The ML module sends an already-calculated accident event.
    The backend does not perform YOLO inference here.
    """
    data = request.get_json(silent=True) or {}

    required = ["camera_id", "timestamp", "confidence"]
    missing = [field for field in required if field not in data]

    if missing:
        return jsonify({
            "error": "MISSING_FIELDS",
            "fields": missing
        }), 400

    try:
        timestamp = parse_timestamp(data["timestamp"])
    except ValueError:
        return jsonify({
            "error": "INVALID_TIMESTAMP",
            "message": "timestamp must be ISO-8601."
        }), 400

    confidence = data["confidence"]

    if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        return jsonify({
            "error": "INVALID_CONFIDENCE",
            "message": "confidence must be between 0 and 1."
        }), 400

    if confidence < Config.ACCIDENT_THRESHOLD:
        return jsonify({
            "accident_detected": False,
            "incident_created": False,
            "confidence": confidence,
            "threshold": Config.ACCIDENT_THRESHOLD
        }), 200

    payload = dict(data)
    payload["timestamp"] = timestamp

    try:
        incident, created = create_incident_from_detection(payload)
    except ValueError as exc:
        return jsonify({
            "error": "DETECTION_EVENT_FAILED",
            "message": str(exc)
        }), 400

    return jsonify({
        "accident_detected": True,
        "incident_created": created,
        "incident": incident
    }), 201 if created else 200
