
from datetime import datetime, timezone
from uuid import uuid4

from database.mongo import (
    incidents_collection,
    cameras_collection,
    hospitals_collection,
)
from utils.serializers import serialize_document
from services.hospital_routing import (
    HospitalRoutingError,
    select_nearest_hospital_by_road_time,
)


def generate_incident_id():
    return f"INC_{uuid4().hex[:8].upper()}"


def find_duplicate(camera_id, timestamp, event_id=None):
    """Find an incident created by the same camera event."""
    collection = incidents_collection()

    if event_id:
        existing = collection.find_one({
            "camera_id": camera_id,
            "event_id": event_id,
        })
        if existing:
            return existing

    return collection.find_one({
        "camera_id": camera_id,
        "timestamp": timestamp,
    })


def create_incident_from_detection(payload):
    """Create one incident and recommend nearby eligible hospitals."""

    if not isinstance(payload, dict):
        raise ValueError("Detection payload must be a dictionary.")

    camera_id = payload.get("camera_id")
    timestamp = payload.get("timestamp")
    event_id = payload.get("event_id")

    if not camera_id or timestamp is None:
        raise ValueError(
            "Detection payload must contain camera_id and timestamp."
        )

    # Validate that the detecting camera exists.
    camera = cameras_collection().find_one({
        "camera_id": camera_id,
    })

    if camera is None:
        raise ValueError(f"Camera '{camera_id}' not found.")

    # Avoid duplicate incident creation.
    duplicate = find_duplicate(camera_id, timestamp, event_id)

    if duplicate:
        return serialize_document(duplicate), False

    # Find hospitals that are currently eligible.
    available = list(
        hospitals_collection().find({
            "emergency_available": True,
            "staff_available": True,
            "status": "AVAILABLE",
        })
    )

    selection = None
    recommended = None
    eligible = available
    hospital_comparison = []
    routing_method = "UNAVAILABLE"
    routing_error = None

    if available:
        try:
            selection = select_nearest_hospital_by_road_time(
                {
                    "latitude": camera.get("latitude"),
                    "longitude": camera.get("longitude"),
                },
                available,
            )

            recommended = selection["hospital"]
            eligible = selection["candidate_hospitals"]
            hospital_comparison = selection["comparisons"]
            routing_method = "OSRM_ROAD_TIME"

        except HospitalRoutingError as exc:
            routing_method = "OSRM_UNAVAILABLE"
            routing_error = str(exc)

        except (
            KeyError,
            TypeError,
            ValueError,
            OverflowError,
        ) as exc:
            routing_method = "INVALID_ROUTING_DATA"
            routing_error = str(exc)
    else:
        routing_method = "NO_AVAILABLE_HOSPITALS"

    eligible_ids = [
        hospital["hospital_id"]
        for hospital in eligible
        if hospital.get("hospital_id")
    ]

    eligible_names = [
        hospital["name"]
        for hospital in eligible
        if hospital.get("hospital_id") and hospital.get("name")
    ]

    road_distance_km = (
        selection.get("road_distance_km") if selection else None
    )
    straight_distance_km = (
        selection.get("straight_line_distance_km")
        if selection else None
    )
    estimated_travel_time_min = (
        selection.get("eta_minutes") if selection else None
    )
    duration_seconds = (
        selection.get("duration_seconds") if selection else None
    )
    route_coordinates = (
        selection.get("route") if selection else None
    )

    incident = {
        "incident_id": generate_incident_id(),
        "event_id": event_id,
        "camera_id": camera_id,
        "timestamp": timestamp,

        "latitude": camera.get("latitude"),
        "longitude": camera.get("longitude"),

        "confidence": payload.get("confidence"),
        "speed_before": payload.get("speed_before"),
        "speed_after": payload.get("speed_after"),
        "speed_unit": payload.get("speed_unit"),
        "severity": payload.get("severity"),
        "severity_score": payload.get("severity_score"),
        "video_clip": payload.get("video_clip"),
        "evidence": payload.get("evidence", {}),
        "processing_seconds": payload.get("processing_seconds"),
        "detector_version": payload.get(
            "detector_version",
            "weighted-evidence-v1",
        ),

        "eligible_hospitals": eligible_ids,
        "eligible_hospital_names": eligible_names,
        "hospital_comparison": hospital_comparison,
        "hospital_candidates_count": len(hospital_comparison),

        "hospital_id": None,
        "recommended_hospital_id": (
            recommended.get("hospital_id") if recommended else None
        ),
        "recommended_hospital_name": (
            recommended.get("name") if recommended else None
        ),

        "hospital_straight_line_distance_km": straight_distance_km,
        "hospital_distance_km": road_distance_km,
        "estimated_travel_time_min": estimated_travel_time_min,
        "estimated_travel_time_seconds": duration_seconds,
        "route_coordinates": route_coordinates,

        "routing_method": routing_method,
        "routing_error": routing_error,

        "status": "PENDING",
        "hospital_response": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    incidents_collection().insert_one(incident)

    return serialize_document(incident), True
