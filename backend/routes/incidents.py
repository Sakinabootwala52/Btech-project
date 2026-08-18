from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session
from database.mongo import incidents_collection, attendance_collection, hospitals_collection
from utils.serializers import serialize_document
from utils.auth import require_login, current_hospital_id

incidents_bp = Blueprint("incidents", __name__)

@incidents_bp.get("")
@require_login("admin")
def get_incidents():
    incidents = incidents_collection().find().sort("timestamp", -1)
    return jsonify([serialize_document(i) for i in incidents]), 200

@incidents_bp.get("/hospital/pending")
@require_login("hospital")
def hospital_pending():
    # Pending incidents are broadcast to all hospital dashboards.
    incidents = incidents_collection().find({"status": "PENDING"}).sort("timestamp", -1)
    return jsonify([serialize_document(i) for i in incidents]), 200

@incidents_bp.get("/hospital/history")
@require_login("hospital")
def hospital_history():
    rows = attendance_collection().find({"hospital_id": current_hospital_id()}).sort("accepted_at", -1).limit(100)
    return jsonify([serialize_document(r) for r in rows]), 200

@incidents_bp.get("/hospital/stats")
@require_login("hospital")
def hospital_stats():
    hid = current_hospital_id()
    total = attendance_collection().count_documents({"hospital_id": hid})
    month_prefix = datetime.now(timezone.utc).strftime("%Y-%m")
    month = attendance_collection().count_documents({"hospital_id": hid, "accepted_at": {"$regex": f"^{month_prefix}"}})
    return jsonify({"total_attended": total, "attended_this_month": month}), 200

@incidents_bp.get("/<incident_id>")
@require_login()
def get_incident(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    role = session.get("role")
    if role == "hospital" and incident.get("status") != "PENDING" and incident.get("hospital_id") != current_hospital_id():
        return jsonify({"error": "FORBIDDEN"}), 403
    return jsonify(serialize_document(incident)), 200

@incidents_bp.post("")
@require_login("admin")
def create_incident():
    data = request.get_json(silent=True) or {}
    required = ["camera_id", "timestamp", "confidence"]
    missing = [f for f in required if f not in data]
    if missing: return jsonify({"error": "MISSING_FIELDS", "fields": missing}), 400
    if not 0 <= data["confidence"] <= 1: return jsonify({"error": "INVALID_CONFIDENCE"}), 400
    from services.incident_service import create_incident_from_detection
    try: incident, created = create_incident_from_detection(data)
    except ValueError as exc: return jsonify({"error": "INCIDENT_CREATION_FAILED", "message": str(exc)}), 400
    return jsonify(incident), 201 if created else 200

@incidents_bp.post("/<incident_id>/accept")
@require_login("hospital")
def accept_incident(incident_id):
    hid = current_hospital_id()
    hospital = hospitals_collection().find_one({"hospital_id": hid})
    if not hospital: return jsonify({"error": "HOSPITAL_NOT_FOUND"}), 404
    available = hospital.get("emergency_available", False) and hospital.get("staff_available", False) and hospital.get("status") == "AVAILABLE"
    if not available:
        return jsonify({"error": "HOSPITAL_UNAVAILABLE", "message": "Set your hospital as available before accepting."}), 409

    now = datetime.now(timezone.utc).isoformat()
    snapshot = hospital.get("resources", {})
    # Atomic claim: only the first hospital can transition PENDING -> RESPONSE_ACCEPTED.
    result = incidents_collection().find_one_and_update(
        {"incident_id": incident_id, "status": "PENDING"},
        {"$set": {
            "status": "RESPONSE_ACCEPTED", "hospital_response": "ACCEPTED",
            "hospital_id": hid, "hospital_claimed_at": now,
            "accepted_by_hospital": hospital.get("name"),
            "resource_snapshot": snapshot
        }},
        return_document=True
    )
    if result is None:
        current = incidents_collection().find_one({"incident_id": incident_id})
        if current and current.get("hospital_id") == hid:
            return jsonify(serialize_document(current)), 200
        return jsonify({"error": "ALREADY_CLAIMED", "message": "Another hospital accepted this incident first."}), 409

    attendance = {
        "incident_id": incident_id,
        "hospital_id": hid,
        "hospital_name": hospital.get("name"),
        "accepted_at": now,
        "resources_snapshot": snapshot,
        "severity": result.get("severity"),
        "location": {"latitude": result.get("latitude"), "longitude": result.get("longitude")}
    }
    attendance_collection().update_one({"incident_id": incident_id}, {"$setOnInsert": attendance}, upsert=True)
    return jsonify(serialize_document(result)), 200

@incidents_bp.post("/<incident_id>/reject")
@require_login("hospital")
def reject_incident(incident_id):
    hid = current_hospital_id()
    result = incidents_collection().find_one_and_update(
        {"incident_id": incident_id, "status": "PENDING"},
        {"$set": {"last_rejected_by": hid, "last_rejected_at": datetime.now(timezone.utc).isoformat()}},
        return_document=True
    )
    if result is None:
        return jsonify({"error": "INCIDENT_NOT_PENDING"}), 409
    return jsonify(serialize_document(result)), 200

@incidents_bp.put("/<incident_id>/status")
@require_login()
def update_incident_status(incident_id):
    data = request.get_json(silent=True) or {}
    status = data.get("status")
    allowed = {"PENDING", "RESPONSE_ACCEPTED", "REJECTED", "RESOLVED"}
    if status not in allowed: return jsonify({"error": "INVALID_STATUS"}), 400
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if not incident: return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    if session.get("role") == "hospital" and incident.get("hospital_id") != current_hospital_id():
        return jsonify({"error": "FORBIDDEN"}), 403
    update = {"status": status}
    if status == "RESPONSE_ACCEPTED": update["hospital_response"] = "ACCEPTED"
    elif status == "REJECTED": update["hospital_response"] = "REJECTED"
    elif status == "RESOLVED": update["hospital_response"] = "RESOLVED"
    result = incidents_collection().find_one_and_update({"incident_id": incident_id}, {"$set": update}, return_document=True)
    return jsonify(serialize_document(result)), 200
