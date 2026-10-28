from datetime import datetime, timezone
from functools import wraps

from flask import Blueprint, jsonify, request, session
from pymongo import ReturnDocument

from database.mongo import ambulances_collection, hospitals_collection, incidents_collection
from utils.auth import current_hospital_id, require_login
from utils.serializers import serialize_document

ambulance_sim_bp = Blueprint("ambulance_sim", __name__)

OPERATOR_ROLES = {"ambulance", "admin"}
ACTIVE_AMBULANCE_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"]
MOVING_PHASES = {"TO_SCENE": "EN_ROUTE", "TO_HOSPITAL": "TRANSPORTING"}
POSITION_SOURCES = {"SIMULATION", "GPS"}
TRAIL_LIMIT = 300


def _now():
    return datetime.now(timezone.utc).isoformat()


def require_operator(fn):
    """Only the ambulance operator (or admin) may drive a vehicle."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        role = session.get("role")
        if not role:
            return jsonify({"error": "UNAUTHORIZED", "message": "Login required."}), 401
        if role not in OPERATOR_ROLES:
            return jsonify({"error": "FORBIDDEN", "message": "Only the ambulance operator can control a vehicle."}), 403
        return fn(*args, **kwargs)
    return wrapper


def _point(doc):
    """Read valid coordinates from flat, nested, or GeoJSON-style records."""
    if not isinstance(doc, dict):
        return None

    candidates = [doc, doc.get("location"), doc.get("gps"), doc.get("position"), doc.get("current_position")]
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        try:
            if candidate.get("type") == "Point" and isinstance(candidate.get("coordinates"), (list, tuple)):
                longitude, latitude = candidate["coordinates"][:2]
            elif isinstance(candidate.get("coordinates"), (list, tuple)) and len(candidate["coordinates"]) >= 2:
                longitude, latitude = candidate["coordinates"][:2]
            else:
                latitude = candidate.get("latitude", candidate.get("lat"))
                longitude = candidate.get("longitude", candidate.get("lng", candidate.get("lon")))
            latitude, longitude = float(latitude), float(longitude)
        except (TypeError, ValueError, IndexError):
            continue
        if -90 <= latitude <= 90 and -180 <= longitude <= 180 and not (latitude == 0 and longitude == 0):
            return {"latitude": latitude, "longitude": longitude}
    return None


def _route_coordinates(value):
    """Validate route points in Leaflet order: [latitude, longitude]."""
    if value is None:
        return None
    if not isinstance(value, list) or not 2 <= len(value) <= 5000:
        raise ValueError("route_coordinates must contain between 2 and 5000 points.")
    points = []
    for point in value:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise ValueError("Each route point must be [latitude, longitude].")
        try:
            latitude, longitude = float(point[0]), float(point[1])
        except (TypeError, ValueError):
            raise ValueError("Route coordinates must be numeric.")
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError("Route coordinates are out of range.")
        points.append([round(latitude, 6), round(longitude, 6)])
    return points


def _optional_nonnegative(value, field_name):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be a number.")
    if number < 0:
        raise ValueError(f"{field_name} cannot be negative.")
    return round(number, 4)


def _severity_label(incident):
    severity = incident.get("severity")
    if isinstance(severity, dict):
        return severity.get("level")
    return severity


def _hospital_for(incident, ambulance=None):
    hospital_id = (
        (incident or {}).get("dispatch_hospital_id")
        or (incident or {}).get("hospital_id")
        or (ambulance or {}).get("hospital_id")
    )
    if not hospital_id:
        return None
    return hospitals_collection().find_one({"hospital_id": hospital_id})


def _incident_summary(incident):
    if not incident:
        return None
    return {
        "incident_id": incident.get("incident_id"),
        "status": incident.get("status"),
        "severity": _severity_label(incident),
        "confidence": incident.get("confidence"),
        "camera_id": incident.get("camera_id"),
        "location": _point(incident),
        "dispatched_at": incident.get("dispatched_at"),
        "tracking": incident.get("ambulance_tracking"),
    }


def _hospital_summary(hospital):
    if not hospital:
        return None
    return {
        "hospital_id": hospital.get("hospital_id"),
        "name": hospital.get("name"),
        "location": _point(hospital),
    }


def _load_assignment(ambulance_id):
    """Return (ambulance, incident, hospital, error_response)."""
    ambulance = ambulances_collection().find_one({"ambulance_id": ambulance_id})
    if ambulance is None:
        return None, None, None, (jsonify({"error": "AMBULANCE_NOT_FOUND"}), 404)
    incident_id = ambulance.get("incident_id")
    if not incident_id:
        return ambulance, None, None, (jsonify({
            "error": "NO_ACTIVE_ASSIGNMENT",
            "message": "This ambulance has not been dispatched to an incident.",
        }), 409)
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if incident is None:
        return ambulance, None, None, (jsonify({"error": "INCIDENT_NOT_FOUND"}), 404)
    hospital = _hospital_for(incident, ambulance)
    if _point(incident) is None or _point(hospital) is None:
        return ambulance, incident, hospital, (jsonify({
            "error": "MISSING_COORDINATES",
            "message": "Incident and hospital both need latitude/longitude for routing.",
        }), 422)
    return ambulance, incident, hospital, None


def _state_conflict(message, incident=None, ambulance=None):
    return jsonify({
        "error": "INVALID_STATE",
        "message": message,
        "incident_status": (incident or {}).get("status"),
        "ambulance_status": (ambulance or {}).get("status"),
    }), 409


def _assignment_payload(ambulance, incident, hospital):
    return {
        "ambulance": serialize_document(ambulance),
        "incident": _incident_summary(incident),
        "hospital": _hospital_summary(hospital),
    }


# ------------------------------------------------------------------
# Operator: list vehicles and their current assignment
# ------------------------------------------------------------------

# ------------------------------------------------------------------
# Read assignments: ambulance operator, admin, or hospital
# ------------------------------------------------------------------
@ambulance_sim_bp.get("/assignments")
@require_login()
def list_assignments():
    role = session.get("role")

    # Hospitals may see only ambulances belonging to their hospital.
    if role == "hospital":
        hospital_id = current_hospital_id()

        if not hospital_id:
            return jsonify({
                "error": "HOSPITAL_ID_MISSING",
                "message": "Hospital account is not linked to a hospital.",
            }), 403

        ambulance_query = {"hospital_id": hospital_id}

    elif role in {"ambulance", "admin"}:
        ambulance_query = {}

    else:
        return jsonify({
            "error": "FORBIDDEN",
            "message": "You cannot view ambulance assignments.",
        }), 403

    rows = []

    ambulances = ambulances_collection().find(
        ambulance_query
    ).sort([
        ("hospital_id", 1),
        ("ambulance_id", 1),
    ])

    for ambulance in ambulances:
        incident = None
        hospital = None

        incident_id = ambulance.get("incident_id")

        if incident_id:
            incident = incidents_collection().find_one({
                "incident_id": incident_id,
            })

        hospital = _hospital_for(incident, ambulance)

        rows.append(
            _assignment_payload(
                ambulance,
                incident,
                hospital,
            )
        )

    active = [
        row for row in rows
        if row["ambulance"].get("status")
        in ACTIVE_AMBULANCE_STATUSES
    ]

    return jsonify({
        "ambulances": rows,
        "active_count": len(active),
    }), 200


# ------------------------------------------------------------------
# Operator: start (or resume) the trip to the accident scene
# ------------------------------------------------------------------
@ambulance_sim_bp.post("/<ambulance_id>/start")
@require_operator
def start_trip(ambulance_id):
    ambulance, incident, hospital, error = _load_assignment(ambulance_id)
    if error:
        return error
    if incident.get("status") not in {"DISPATCHED", "EN_ROUTE"}:
        return _state_conflict("The trip can only start after the hospital dispatches this ambulance.", incident, ambulance)

    data = request.get_json(silent=True) or {}
    try:
        route_coordinates = _route_coordinates(data.get("route_coordinates"))
        route_distance_km = _optional_nonnegative(data.get("route_distance_km"), "route_distance_km")
        route_duration_minutes = _optional_nonnegative(data.get("route_duration_minutes"), "route_duration_minutes")
    except ValueError as exc:
        return jsonify({"error": "INVALID_ROUTE", "message": str(exc)}), 400
    now = _now()
    tracking = incident.get("ambulance_tracking") or {}
    tracking_update = {
        "ambulance_tracking.ambulance_id": ambulance_id,
        "ambulance_tracking.source": str(data.get("source", "SIMULATION")).upper(),
        "ambulance_tracking.phase": "TO_SCENE",
        "ambulance_tracking.route_source": data.get("route_source"),
        "ambulance_tracking.route_distance_km": route_distance_km,
        "ambulance_tracking.route_duration_minutes": route_duration_minutes,
        "ambulance_tracking.updated_at": now,
    }
    if route_coordinates is not None:
        tracking_update["ambulance_tracking.route_coordinates"] = route_coordinates
    if not tracking.get("started_at"):
        tracking_update["ambulance_tracking.started_at"] = now

    updated_incident = incidents_collection().find_one_and_update(
        {"incident_id": incident["incident_id"], "status": {"$in": ["DISPATCHED", "EN_ROUTE"]}},
        {"$set": {
            "status": "EN_ROUTE",
            "ambulance_status": "EN_ROUTE",
            "en_route_at": incident.get("en_route_at") or now,
            **tracking_update,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if updated_incident is None:
        return _state_conflict("Incident state changed before the trip started.")
    updated_ambulance = ambulances_collection().find_one_and_update(
        {"ambulance_id": ambulance_id, "incident_id": incident["incident_id"]},
        {"$set": {"status": "EN_ROUTE", "en_route_at": ambulance.get("en_route_at") or now}},
        return_document=ReturnDocument.AFTER,
    )
    return jsonify({"ok": True, **_assignment_payload(updated_ambulance, updated_incident, hospital)}), 200


# ------------------------------------------------------------------
# Operator or GPS device: report the vehicle's current position
# ------------------------------------------------------------------
@ambulance_sim_bp.post("/<ambulance_id>/position")
@require_operator
def report_position(ambulance_id):
    data = request.get_json(silent=True) or {}
    try:
        latitude = float(data["latitude"])
        longitude = float(data["longitude"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"error": "INVALID_POSITION", "message": "latitude and longitude must be numbers."}), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify({"error": "INVALID_POSITION", "message": "Coordinates are out of range."}), 400

    phase = str(data.get("phase", "")).upper()
    if phase not in MOVING_PHASES:
        return jsonify({"error": "INVALID_PHASE", "allowed": sorted(MOVING_PHASES)}), 400
    source = str(data.get("source", "SIMULATION")).upper()
    if source not in POSITION_SOURCES:
        return jsonify({"error": "INVALID_SOURCE", "allowed": sorted(POSITION_SOURCES)}), 400

    def optional_number(key):
        try:
            return None if data.get(key) is None else round(float(data[key]), 4)
        except (TypeError, ValueError):
            return None

    ambulance = ambulances_collection().find_one({"ambulance_id": ambulance_id})
    if ambulance is None:
        return jsonify({"error": "AMBULANCE_NOT_FOUND"}), 404
    expected_status = MOVING_PHASES[phase]
    if ambulance.get("status") != expected_status or not ambulance.get("incident_id"):
        return _state_conflict(f"Ambulance must be {expected_status} to report a {phase} position.", ambulance=ambulance)

    now = _now()
    position = {
        "latitude": round(latitude, 6),
        "longitude": round(longitude, 6),
        "phase": phase,
        "source": source,
        "progress": optional_number("progress"),
        "speed_kmh": optional_number("speed_kmh"),
        "remaining_km": optional_number("remaining_km"),
        "eta_seconds": optional_number("eta_seconds"),
        "recorded_at": now,
    }
    incident = incidents_collection().find_one_and_update(
        {
            "incident_id": ambulance["incident_id"],
            "ambulance_tracking.ambulance_id": ambulance_id,
            "ambulance_tracking.phase": phase,
        },
        
        {
            "$set": {
                "ambulance_tracking.position": position,
                "ambulance_tracking.source": source,
                "ambulance_tracking.updated_at": now,
            },
            "$inc": {"ambulance_tracking.updates": 1},
            "$push": {"ambulance_tracking.trail": {
                "$each": [[position["latitude"], position["longitude"]]],
                "$slice": -TRAIL_LIMIT,
            }},
        },
        return_document=ReturnDocument.AFTER,
    )
    if incident is None:
        current = incidents_collection().find_one({"incident_id": ambulance["incident_id"]})
        return _state_conflict("The incident is no longer in this trip phase.", current, ambulance)
    ambulances_collection().update_one(
        {"ambulance_id": ambulance_id},
        {"$set": {"last_position": position}},
    )
    return jsonify({
        "ok": True,
        "incident_status": incident.get("status"),
        "phase": phase,
        "updates": incident.get("ambulance_tracking", {}).get("updates"),
    }), 200


# ------------------------------------------------------------------
# Operator: ambulance reached the accident scene
# ------------------------------------------------------------------
@ambulance_sim_bp.post("/<ambulance_id>/arrive-scene")
@require_operator
def arrive_scene(ambulance_id):
    ambulance, incident, hospital, error = _load_assignment(ambulance_id)
    if error:
        return error
    now = _now()
    location = _point(incident)
    updated_incident = incidents_collection().find_one_and_update(
        {"incident_id": incident["incident_id"], "status": "EN_ROUTE"},
        {"$set": {
            "status": "ARRIVED",
            "ambulance_status": "ARRIVED",
            "arrived_at": now,
            "ambulance_tracking.phase": "AT_SCENE",
            "ambulance_tracking.arrived_scene_at": now,
            "ambulance_tracking.updated_at": now,
            "ambulance_tracking.position": {**location, "phase": "AT_SCENE", "progress": 1, "remaining_km": 0, "eta_seconds": 0, "speed_kmh": 0, "source": (incident.get("ambulance_tracking") or {}).get("source", "SIMULATION"), "recorded_at": now},
        }},
        return_document=ReturnDocument.AFTER,
    )
    if updated_incident is None:
        return _state_conflict("The ambulance can only arrive while it is en route.", incident, ambulance)
    updated_ambulance = ambulances_collection().find_one_and_update(
        {"ambulance_id": ambulance_id, "incident_id": incident["incident_id"]},
        {"$set": {"status": "ARRIVED", "arrived_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    return jsonify({"ok": True, **_assignment_payload(updated_ambulance, updated_incident, hospital)}), 200


# ------------------------------------------------------------------
# Operator: leave the scene and transport the patient to hospital
# ------------------------------------------------------------------
@ambulance_sim_bp.post("/<ambulance_id>/depart-scene")
@require_operator
def depart_scene(ambulance_id):
    ambulance, incident, hospital, error = _load_assignment(ambulance_id)
    if error:
        return error
    data = request.get_json(silent=True) or {}
    try:
        route_coordinates = _route_coordinates(data.get("route_coordinates"))
        route_distance_km = _optional_nonnegative(data.get("route_distance_km"), "route_distance_km")
        route_duration_minutes = _optional_nonnegative(data.get("route_duration_minutes"), "route_duration_minutes")
    except ValueError as exc:
        return jsonify({"error": "INVALID_ROUTE", "message": str(exc)}), 400
    now = _now()
    # The incident stays ARRIVED (the existing lifecycle has no transport
    # status); the transport leg is tracked by the ambulance and phase.
    route_fields = {}
    if route_coordinates is not None:
        route_fields["ambulance_tracking.return_route_coordinates"] = route_coordinates
    updated_incident = incidents_collection().find_one_and_update(
        # $nin also matches a missing phase, so this works even when the hospital
        # marked the arrival manually instead of the simulator.
        {"incident_id": incident["incident_id"], "status": "ARRIVED", "ambulance_tracking.phase": {"$nin": ["TO_HOSPITAL", "COMPLETED"]}},
        {"$set": {
            "ambulance_tracking.phase": "TO_HOSPITAL",
            "ambulance_tracking.departed_scene_at": now,
            "ambulance_tracking.return_route_source": data.get("route_source"),
            "ambulance_tracking.return_route_distance_km": route_distance_km,
            "ambulance_tracking.return_route_duration_minutes": route_duration_minutes,
            "ambulance_tracking.updated_at": now,
            "patient_transport_started_at": now,
            **route_fields,
        }},
        return_document=ReturnDocument.AFTER,
    )
    if updated_incident is None:
        return _state_conflict("Transport can start only after the ambulance has arrived at the scene.", incident, ambulance)
    updated_ambulance = ambulances_collection().find_one_and_update(
        {"ambulance_id": ambulance_id, "incident_id": incident["incident_id"]},
        {"$set": {"status": "TRANSPORTING", "transport_started_at": now}},
        return_document=ReturnDocument.AFTER,
    )
    return jsonify({"ok": True, **_assignment_payload(updated_ambulance, updated_incident, hospital)}), 200


# ------------------------------------------------------------------
# Operator: patient handed over at hospital, ambulance free again
# ------------------------------------------------------------------
@ambulance_sim_bp.post("/<ambulance_id>/complete")
@require_operator
def complete_trip(ambulance_id):
    ambulance, incident, hospital, error = _load_assignment(ambulance_id)
    if error:
        return error
    now = _now()
    hospital_location = _point(hospital)
    updated_incident = incidents_collection().find_one_and_update(
        {"incident_id": incident["incident_id"], "status": "ARRIVED", "ambulance_tracking.phase": "TO_HOSPITAL"},
        {"$set": {
            "status": "RESOLVED",
            "hospital_response": "RESOLVED",
            "resolved_at": now,
            "patient_handover_at": now,
            "ambulance_tracking.phase": "COMPLETED",
            "ambulance_tracking.completed_at": now,
            "ambulance_tracking.updated_at": now,
            "ambulance_tracking.position": {**hospital_location, "phase": "COMPLETED", "progress": 1, "remaining_km": 0, "eta_seconds": 0, "speed_kmh": 0, "source": (incident.get("ambulance_tracking") or {}).get("source", "SIMULATION"), "recorded_at": now},
        }},
        return_document=ReturnDocument.AFTER,
    )
    if updated_incident is None:
        return _state_conflict("The trip can be completed only while transporting the patient.", incident, ambulance)
    updated_ambulance = ambulances_collection().find_one_and_update(
        {"ambulance_id": ambulance_id, "incident_id": incident["incident_id"]},
        {
            "$set": {"status": "AVAILABLE", "incident_id": None, "status_updated_at": now, "last_position": {**hospital_location, "phase": "COMPLETED", "recorded_at": now}},
            "$unset": {"assigned_at": "", "en_route_at": "", "arrived_at": "", "transport_started_at": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    return jsonify({"ok": True, **_assignment_payload(updated_ambulance, updated_incident, hospital)}), 200


# ------------------------------------------------------------------
# Any signed-in screen: read live tracking for one incident
# ------------------------------------------------------------------
@ambulance_sim_bp.get("/track/<incident_id>")
@require_login()
def track_incident(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    if session.get("role") == "hospital" and incident.get("hospital_id") != current_hospital_id():
        return jsonify({"error": "FORBIDDEN"}), 403
    if session.get("role") == "live":
        return jsonify({"error": "FORBIDDEN"}), 403
    hospital = _hospital_for(incident)
    return jsonify({
        "incident_id": incident_id,
        "incident_status": incident.get("status"),
        "ambulance_id": incident.get("ambulance_id"),
        "ambulance_type": incident.get("ambulance_type"),
        "incident_location": _point(incident),
        "hospital": _hospital_summary(hospital),
        "tracking": incident.get("ambulance_tracking"),
        "server_time": _now(),
    }), 200