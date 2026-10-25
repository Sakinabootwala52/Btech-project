from datetime import datetime, timezone
from uuid import uuid4
from database.mongo import incidents_collection, cameras_collection, hospitals_collection
from services.distance_service import haversine_distance_km
from utils.serializers import serialize_document

def generate_incident_id(): return f"INC_{uuid4().hex[:8].upper()}"

def find_duplicate(camera_id, timestamp):
    return incidents_collection().find_one({"camera_id": camera_id, "timestamp": timestamp})

def create_incident_from_detection(payload):
    camera_id = payload["camera_id"]; timestamp = payload["timestamp"]
    camera = cameras_collection().find_one({"camera_id": camera_id})
    if camera is None: raise ValueError(f"Camera '{camera_id}' not found.")
    duplicate = find_duplicate(camera_id, timestamp)
    if duplicate: return serialize_document(duplicate), False

    # Notify only the three nearest available hospitals/clinics. Acceptance
    # remains atomic in the incident route, so the first eligible facility wins.
    available = list(hospitals_collection().find({
        "emergency_available": True, "staff_available": True, "status": "AVAILABLE"
    }, {"hospital_id": 1, "name": 1, "latitude": 1, "longitude": 1, "facility_type": 1}))
    origin_lat = float(camera["latitude"])
    origin_lon = float(camera["longitude"])
    for facility in available:
        try:
            facility["distance_km"] = round(haversine_distance_km(
                origin_lat, origin_lon, float(facility["latitude"]), float(facility["longitude"])
            ), 2)
        except (KeyError, TypeError, ValueError):
            facility["distance_km"] = None
    available = sorted((facility for facility in available if facility["distance_km"] is not None), key=lambda facility: facility["distance_km"])[:3]

    incident = {
        "incident_id": generate_incident_id(), "camera_id": camera_id, "timestamp": timestamp,
        "latitude": camera["latitude"], "longitude": camera["longitude"],
        "confidence": payload["confidence"], "speed_before": payload.get("speed_before"),
        "speed_after": payload.get("speed_after"), "speed_unit": payload.get("speed_unit"),
        "severity": payload.get("severity"), "video_clip": payload.get("video_clip"),
        "severity_score": payload.get("severity_score"),
        "evidence": payload.get("evidence", {}),
        "processing_seconds": payload.get("processing_seconds"),
        "detector_version": payload.get("detector_version", "weighted-evidence-v1"),
        "eligible_hospitals": [h["hospital_id"] for h in available],
        "eligible_hospital_names": [h["name"] for h in available],
        "nearby_facilities": [{"hospital_id": h["hospital_id"], "name": h["name"], "facility_type": h.get("facility_type", "HOSPITAL"), "distance_km": h["distance_km"]} for h in available],
        "hospital_id": None, "hospital_distance_km": None,
        "status": "PENDING", "hospital_response": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    incidents_collection().insert_one(incident)
    return serialize_document(incident), True
