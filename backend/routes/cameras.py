from flask import Blueprint, jsonify, request
from pymongo.errors import DuplicateKeyError

from database.mongo import cameras_collection
from utils.serializers import serialize_document
from utils.validation import required_fields, validate_coordinates

cameras_bp = Blueprint("cameras", __name__)

@cameras_bp.get("")
def get_cameras():
    cameras = cameras_collection().find().sort("camera_id", 1)
    return jsonify([serialize_document(c) for c in cameras]), 200

@cameras_bp.post("")
def create_camera():
    data = request.get_json(silent=True) or {}

    missing = required_fields(
        data,
        ["camera_id", "name", "latitude", "longitude", "location_name", "stream_url"]
    )

    if missing:
        return jsonify({
            "error": "MISSING_FIELDS",
            "fields": missing
        }), 400

    if not validate_coordinates(data["latitude"], data["longitude"]):
        return jsonify({
            "error": "INVALID_COORDINATES"
        }), 400

    camera = {
        "camera_id": data["camera_id"],
        "name": data["name"],
        "latitude": data["latitude"],
        "longitude": data["longitude"],
        "location_name": data["location_name"],
        "stream_url": data["stream_url"],
        "status": data.get("status", "ACTIVE")
    }

    try:
        result = cameras_collection().insert_one(camera)
    except DuplicateKeyError:
        return jsonify({
            "error": "DUPLICATE_CAMERA",
            "message": f"Camera '{data['camera_id']}' already exists."
        }), 409

    camera["_id"] = result.inserted_id
    return jsonify(serialize_document(camera)), 201

@cameras_bp.get("/<camera_id>")
def get_camera(camera_id):
    camera = cameras_collection().find_one({"camera_id": camera_id})

    if camera is None:
        return jsonify({
            "error": "CAMERA_NOT_FOUND",
            "message": f"Camera '{camera_id}' not found."
        }), 404

    return jsonify(serialize_document(camera)), 200
