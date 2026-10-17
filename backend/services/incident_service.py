from datetime import datetime, timezone
from uuid import uuid4
from database.mongo import incidents_collection, cameras_collection, hospitals_collection
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

    # Broadcast to all currently available hospitals. The first hospital to
    # atomically accept becomes the responder (first-accept / fingers-first).
    available = list(hospitals_collection().find({
        "emergency_available": True, "staff_available": True, "status": "AVAILABLE"
    }, {"hospital_id": 1, "name": 1}))

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
        "hospital_id": None, "hospital_distance_km": None,
        "status": "PENDING", "hospital_response": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    incidents_collection().insert_one(incident)
    return serialize_document(incident), True
