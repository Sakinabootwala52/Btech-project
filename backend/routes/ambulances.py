from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session
from pymongo.errors import DuplicateKeyError
from pymongo import ReturnDocument
from database.mongo import ambulances_collection, hospitals_collection, incidents_collection
from utils.auth import require_login, current_hospital_id
from utils.serializers import serialize_document

ambulances_bp = Blueprint("ambulances", __name__)
VALID_STATUSES = {"AVAILABLE", "OUT_OF_SERVICE"}


def _scope_query():
    if session.get("role") == "hospital":
        return {"hospital_id": current_hospital_id()}
    return {}


@ambulances_bp.get("")
@require_login()
def list_ambulances():
    rows = ambulances_collection().find(_scope_query()).sort([("hospital_id", 1), ("ambulance_id", 1)])
    return jsonify([serialize_document(row) for row in rows]), 200


@ambulances_bp.post("")
@require_login("admin")
def register_ambulance():
    data = request.get_json(silent=True) or {}
    required = ["ambulance_id", "hospital_id"]
    missing = [key for key in required if not data.get(key)]
    if missing:
        return jsonify({"error": "MISSING_FIELDS", "fields": missing}), 400
    hospital = hospitals_collection().find_one({"hospital_id": str(data["hospital_id"])})
    if hospital is None:
        return jsonify({"error": "HOSPITAL_NOT_FOUND"}), 404
    doc = {
        "ambulance_id": str(data["ambulance_id"]).strip(),
        "hospital_id": str(data["hospital_id"]).strip(),
        "hospital_name": hospital.get("name"),
        "vehicle_type": str(data.get("vehicle_type", "BLS")).upper(),
        "plate_number": str(data.get("plate_number", "")).strip(),
        "status": "AVAILABLE",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "incident_id": None,
    }
    try:
        result = ambulances_collection().insert_one(doc)
    except DuplicateKeyError:
        return jsonify({"error": "DUPLICATE_AMBULANCE", "message": "That ambulance ID is already registered."}), 409
    doc["_id"] = result.inserted_id
    return jsonify(serialize_document(doc)), 201


@ambulances_bp.put("/<ambulance_id>/status")
@require_login()
def update_ambulance_status(ambulance_id):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status", "")).upper()
    if status not in VALID_STATUSES:
        return jsonify({"error": "INVALID_STATUS", "allowed": sorted(VALID_STATUSES), "message": "Active assignment status is controlled by the incident lifecycle."}), 400
    query = {"ambulance_id": ambulance_id, **_scope_query()}
    result = ambulances_collection().find_one_and_update(
        {**query, "status": {"$in": ["AVAILABLE", "OUT_OF_SERVICE"]}},
        {"$set": {"status": status, "status_updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
    )
    if result is None:
        exists = ambulances_collection().find_one(query)
        if exists is None:
            return jsonify({"error": "AMBULANCE_NOT_FOUND_OR_FORBIDDEN"}), 404
        return jsonify({"error": "AMBULANCE_BUSY", "message": "An assigned ambulance cannot be manually marked available/out of service."}), 409
    return jsonify(serialize_document(result)), 200
