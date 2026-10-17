from flask import Blueprint, jsonify, request
from database.mongo import incidents_collection, hospitals_collection, road_network_collection
from services.dispatch_service import rank_facilities
from services.routing_service import validate_road_network
from utils.auth import require_login
from utils.serializers import serialize_document

dispatch_bp = Blueprint("dispatch", __name__)


@dispatch_bp.get("/incidents/<incident_id>/recommendations")
@require_login("admin")
def recommendations(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    network_doc = road_network_collection().find_one({"_id": "default"})
    network = network_doc.get("network") if network_doc else None
    try:
        result = rank_facilities(incident, list(hospitals_collection().find()), network)
    except ValueError as exc:
        return jsonify({"error": "INVALID_INCIDENT_LOCATION", "message": str(exc)}), 422
    return jsonify({
        "incident_id": incident_id,
        "incident_status": incident.get("status"),
        "routing_mode": (result["recommendations"][0]["route"]["routing_mode"] if result["recommendations"] else ("ROAD_GRAPH" if network else "HAVERSINE_ESTIMATE")),
        "required_capabilities": result["required_capabilities"],
        "recommendations": result["recommendations"],
        "notice": "Recommendations are decision support. A dispatcher/hospital must confirm availability and acceptance.",
    }), 200


@dispatch_bp.get("/road-network")
@require_login("admin")
def get_road_network():
    doc = road_network_collection().find_one({"_id": "default"})
    return jsonify({"network": doc.get("network", {"nodes": [], "edges": []}) if doc else {"nodes": [], "edges": []}}), 200


@dispatch_bp.put("/road-network")
@require_login("admin")
def put_road_network():
    data = request.get_json(silent=True) or {}
    network = data.get("network", data)
    try:
        validate_road_network(network)
    except ValueError as exc:
        return jsonify({"error": "INVALID_ROAD_NETWORK", "message": str(exc)}), 400
    road_network_collection().update_one(
        {"_id": "default"},
        {"$set": {"network": network}},
        upsert=True,
    )
    return jsonify({"ok": True, "node_count": len(network["nodes"]), "edge_count": len(network["edges"])}), 200


@dispatch_bp.post("/incidents/<incident_id>/select-facility")
@require_login("admin")
def select_facility(incident_id):
    data = request.get_json(silent=True) or {}
    facility_id = str(data.get("facility_id", "")).strip()
    if not facility_id:
        return jsonify({"error": "MISSING_FACILITY_ID"}), 400
    incident = incidents_collection().find_one({"incident_id": incident_id})
    if incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    if incident.get("status") != "PENDING":
        return jsonify({"error": "INCIDENT_NOT_PENDING", "message": "A facility can only be selected before an incident is accepted."}), 409
    network_doc = road_network_collection().find_one({"_id": "default"})
    network = network_doc.get("network") if network_doc else None
    try:
        ranked = rank_facilities(incident, list(hospitals_collection().find()), network)["recommendations"]
    except ValueError as exc:
        return jsonify({"error": "INVALID_INCIDENT_LOCATION", "message": str(exc)}), 422
    chosen = next((item for item in ranked if item["facility_id"] == facility_id), None)
    if chosen is None:
        return jsonify({"error": "FACILITY_NOT_ELIGIBLE", "message": "Facility is unavailable, was rejected, or does not match the incident capability requirements."}), 409
    from datetime import datetime, timezone
    result = incidents_collection().find_one_and_update(
        {"incident_id": incident_id, "status": "PENDING"},
        {"$set": {
            "eligible_hospitals": [facility_id],
            "recommended_hospital_id": facility_id,
            "recommended_hospital_name": chosen["name"],
            "dispatch_recommendation": chosen,
            "dispatch_exhausted": False,
            "dispatch_selected_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if result is None:
        return jsonify({"error": "INCIDENT_STATE_CHANGED"}), 409
    return jsonify({"ok": True, "incident_id": incident_id, "selected_facility": chosen, "message": "The incident is now routed to the selected facility. If it rejects, fallback routing will select the next eligible facility."}), 200
