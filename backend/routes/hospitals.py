from flask import Blueprint, jsonify, request, session
from pymongo.errors import DuplicateKeyError
from database.mongo import hospitals_collection, incidents_collection
from services.hospital_service import find_nearest_available_hospital
from utils.serializers import serialize_document
from utils.validation import required_fields, validate_coordinates
from utils.auth import require_login, current_hospital_id
from database.mongo import attendance_collection

hospitals_bp = Blueprint("hospitals", __name__)

@hospitals_bp.get("")
@require_login("admin")
def get_hospitals():
    hospitals = hospitals_collection().find().sort("hospital_id", 1)
    return jsonify([serialize_document(h) for h in hospitals]), 200

@hospitals_bp.get("/available")
def get_available_hospitals():
    hospitals = hospitals_collection().find({
        "emergency_available": True, "staff_available": True, "status": "AVAILABLE"
    }).sort("hospital_id", 1)
    return jsonify([serialize_document(h) for h in hospitals]), 200

@hospitals_bp.get("/nearest")
def nearest_hospital():
    try:
        latitude = float(request.args["latitude"]); longitude = float(request.args["longitude"])
    except (KeyError, ValueError):
        return jsonify({"error": "INVALID_COORDINATES", "message": "latitude and longitude are required."}), 400
    if not validate_coordinates(latitude, longitude):
        return jsonify({"error": "INVALID_COORDINATES"}), 400
    hospital = find_nearest_available_hospital(latitude, longitude)
    if hospital is None:
        return jsonify({"error": "NO_AVAILABLE_HOSPITAL"}), 404
    return jsonify(hospital), 200

@hospitals_bp.post("")
@require_login("admin")
def create_hospital():
    data = request.get_json(silent=True) or {}
    missing = required_fields(data, ["hospital_id", "name", "latitude", "longitude", "contact"])
    if missing:
        return jsonify({"error": "MISSING_FIELDS", "fields": missing}), 400
    if not validate_coordinates(data["latitude"], data["longitude"]):
        return jsonify({"error": "INVALID_COORDINATES"}), 400
    facility_type = str(data.get("facility_type", "HOSPITAL")).upper()
    if facility_type not in {"HOSPITAL", "CLINIC"}:
        return jsonify({"error": "INVALID_FACILITY_TYPE", "allowed": ["HOSPITAL", "CLINIC"]}), 400
    capabilities = data.get("capabilities", ["FIRST_AID"] if facility_type == "CLINIC" else ["FIRST_AID", "EMERGENCY", "TRAUMA"])
    if not isinstance(capabilities, list) or any(str(x).upper() not in {"FIRST_AID", "EMERGENCY", "TRAUMA", "PEDIATRIC", "BURN"} for x in capabilities):
        return jsonify({"error": "INVALID_CAPABILITIES"}), 400
    hospital = {
        "hospital_id": data["hospital_id"], "name": data["name"],
        "latitude": data["latitude"], "longitude": data["longitude"],
        "contact": data["contact"], "facility_type": str(data.get("facility_type", "HOSPITAL")).upper(),
        "capabilities": [str(x).upper() for x in capabilities],
        "emergency_available": data.get("emergency_available", True),
        "staff_available": data.get("staff_available", True), "status": data.get("status", "AVAILABLE"),
        "resources": data.get("resources", {
            "small_ambulances": 1, "large_ambulances": 1, "emergency_staff": 5, "beds_available": 5
        })
    }
    try:
        result = hospitals_collection().insert_one(hospital)
    except DuplicateKeyError:
        return jsonify({"error": "DUPLICATE_HOSPITAL"}), 409
    hospital["_id"] = result.inserted_id
    return jsonify(serialize_document(hospital)), 201

@hospitals_bp.get("/me")
@require_login("hospital")
def hospital_me():
    hospital = hospitals_collection().find_one({"hospital_id": current_hospital_id()})
    if hospital is None:
        return jsonify({"error": "HOSPITAL_NOT_FOUND"}), 404
    return jsonify(serialize_document(hospital)), 200

@hospitals_bp.put("/me/resources")
@require_login("hospital")
def update_my_resources():
    data = request.get_json(silent=True) or {}
    allowed = {"small_ambulances", "large_ambulances", "emergency_staff", "beds_available"}
    updates = {}
    for key in allowed:
        if key in data:
            try:
                value = int(data[key])
                if value < 0: raise ValueError
            except (TypeError, ValueError):
                return jsonify({"error": "INVALID_RESOURCE_VALUE", "message": f"{key} must be a non-negative integer."}), 400
            updates[f"resources.{key}"] = value
    if not updates:
        return jsonify({"error": "NO_VALID_FIELDS"}), 400
    result = hospitals_collection().find_one_and_update(
        {"hospital_id": current_hospital_id()}, {"$set": updates}, return_document=True
    )
    return jsonify(serialize_document(result)), 200

@hospitals_bp.put("/<hospital_id>/availability")
@require_login("admin")
def update_availability(hospital_id):
    data = request.get_json(silent=True) or {}
    allowed = {"emergency_available", "staff_available", "status"}
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({"error": "NO_VALID_FIELDS"}), 400
    result = hospitals_collection().find_one_and_update({"hospital_id": hospital_id}, {"$set": updates}, return_document=True)
    if result is None:
        return jsonify({"error": "HOSPITAL_NOT_FOUND"}), 404
    return jsonify(serialize_document(result)), 200

@hospitals_bp.get("/me/history")
@require_login("hospital")
def my_history():
    rows = attendance_collection().find({"hospital_id": current_hospital_id()}).sort("accepted_at", -1).limit(100)
    return jsonify([serialize_document(r) for r in rows]), 200
