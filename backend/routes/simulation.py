"""Public demo-only ambulance simulation endpoints.

This prototype deliberately simulates GPS movement. Do not expose the move endpoint
on a production deployment without authentication/authorization.
"""
from datetime import datetime, timezone
from flask import Blueprint, jsonify
from database.mongo import incidents_collection, hospitals_collection
from utils.serializers import serialize_document

simulation_bp = Blueprint("simulation", __name__)
ACTIVE = ["RESPONSE_ACCEPTED", "ACCEPTED", "DISPATCHED", "EN_ROUTE", "ARRIVED"]


def _active_incidents():
    rows = incidents_collection().find({"status": {"$in": ACTIVE}, "hospital_id": {"$exists": True, "$ne": None}}).sort("hospital_claimed_at", -1)
    result = []
    for row in rows:
        hospital = hospitals_collection().find_one({"hospital_id": row.get("hospital_id")})
        if hospital:
            row["simulation_hospital"] = {
                "hospital_id": hospital.get("hospital_id"),
                "name": hospital.get("name"),
                "address": hospital.get("address"),
                "latitude": hospital.get("latitude"),
                "longitude": hospital.get("longitude"),
            }
        result.append(serialize_document(row))
    return result


@simulation_bp.get("/active")
def active_simulations():
    return jsonify(_active_incidents()), 200


@simulation_bp.post("/<incident_id>/start")
def start_simulation(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id, "status": {"$in": ACTIVE}})
    if not incident or not incident.get("hospital_id"):
        return jsonify({"error": "INCIDENT_NOT_ACCEPTED", "message": "Only an accepted incident can start an ambulance simulation."}), 409
    now = datetime.now(timezone.utc).isoformat()
    update = {"simulation_started": True, "simulation_progress": float(incident.get("simulation_progress", 0)), "simulation_updated_at": now}
    if incident.get("status") == "RESPONSE_ACCEPTED":
        update["status"] = "DISPATCHED"
    incidents_collection().update_one({"incident_id": incident_id}, {"$set": update})
    return jsonify(next((i for i in _active_incidents() if i.get("incident_id") == incident_id), {})), 200


@simulation_bp.post("/<incident_id>/move")
def move_simulation(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id, "status": {"$in": ACTIVE}})
    if not incident or not incident.get("hospital_id"):
        return jsonify({"error": "INCIDENT_NOT_ACCEPTED", "message": "Only an accepted incident can be moved."}), 409
    current = float(incident.get("simulation_progress", 0) or 0)
    progress = min(1.0, round(current + 0.15, 2))
    status = "ARRIVED" if progress >= 1 else "EN_ROUTE"
    update = {"simulation_started": True, "simulation_progress": progress, "simulation_step": int(round(progress / 0.15)), "simulation_updated_at": datetime.now(timezone.utc).isoformat(), "status": status}
    incidents_collection().update_one({"incident_id": incident_id}, {"$set": update})
    return jsonify(next((i for i in _active_incidents() if i.get("incident_id") == incident_id), {})), 200


@simulation_bp.post("/<incident_id>/reset")
def reset_simulation(incident_id):
    incident = incidents_collection().find_one({"incident_id": incident_id, "status": {"$in": ACTIVE}})
    if not incident or not incident.get("hospital_id"):
        return jsonify({"error": "INCIDENT_NOT_ACCEPTED", "message": "Only an accepted incident can be reset."}), 409
    incidents_collection().update_one({"incident_id": incident_id}, {"$set": {"simulation_started": False, "simulation_progress": 0, "simulation_step": 0, "simulation_updated_at": datetime.now(timezone.utc).isoformat(), "status": "DISPATCHED"}})
    return jsonify(next((i for i in _active_incidents() if i.get("incident_id") == incident_id), {})), 200
