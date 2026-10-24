from datetime import datetime, timezone

from flask import (
    Blueprint,
    jsonify,
    request,
    session,
)

from pymongo import ReturnDocument

from database.mongo import (
    incidents_collection,
    attendance_collection,
    hospitals_collection,
    ambulances_collection,
    road_network_collection,
)

from utils.serializers import (
    serialize_document,
)

from utils.auth import (
    require_login,
    current_hospital_id,
)
from services.dispatch_service import rank_facilities


incidents_bp = Blueprint(
    "incidents",
    __name__,
)


# ============================================================
# ADMIN: ALL INCIDENTS
# ============================================================

@incidents_bp.get("")
@require_login("admin")
def get_incidents():

    incidents = (
        incidents_collection()
        .find()
        .sort("timestamp", -1)
    )

    return jsonify(
        [
            serialize_document(incident)
            for incident in incidents
        ]
    ), 200


# ============================================================
# HOSPITAL: PENDING INCIDENTS
# ============================================================

@incidents_bp.get("/hospital/pending")
@require_login("hospital")
def hospital_pending():

    hospital_id = current_hospital_id()
    incidents = (
        incidents_collection()
        .find({
            "status": "PENDING",
            "dispatch_exhausted": {"$ne": True},
            "$or": [
                {"eligible_hospitals": {"$exists": False}},
                {"eligible_hospitals": {"$size": 0}},
                {"eligible_hospitals": hospital_id},
            ],
        })
        .sort("timestamp", -1)
    )

    return jsonify(
        [
            serialize_document(incident)
            for incident in incidents
        ]
    ), 200

# ============================================================
# HOSPITAL: INCIDENTS FOR THE MAP
# ============================================================

@incidents_bp.get("/hospital/map-incidents")
@require_login("hospital")
def hospital_map_incidents():
    hospital_id = current_hospital_id()

    query = {
        "$or": [
            {
                "status": "PENDING",
                "dispatch_exhausted": {"$ne": True},
                "$or": [
                    {"eligible_hospitals": {"$exists": False}},
                    {"eligible_hospitals": {"$size": 0}},
                    {"eligible_hospitals": hospital_id},
                ],
            },
            {"hospital_id": hospital_id},
            {"dispatch_hospital_id": hospital_id},
        ]
    }

    incidents = (
        incidents_collection()
        .find(query)
        .sort("timestamp", -1)
        .limit(500)
    )

    return jsonify([
        serialize_document(incident)
        for incident in incidents
    ]), 200


# ============================================================
# HOSPITAL: HISTORY
# ============================================================

@incidents_bp.get("/hospital/history")
@require_login("hospital")
def hospital_history():

    hospital_id = current_hospital_id()

    rows = (
        attendance_collection()
        .find({
            "hospital_id": hospital_id
        })
        .sort("accepted_at", -1)
        .limit(100)
    )

    return jsonify(
        [
            serialize_document(row)
            for row in rows
        ]
    ), 200


# ============================================================
# HOSPITAL: STATS
# ============================================================

@incidents_bp.get("/hospital/stats")
@require_login("hospital")
def hospital_stats():

    hospital_id = current_hospital_id()

    total = attendance_collection().count_documents({
        "hospital_id": hospital_id
    })

    month_prefix = datetime.now(
        timezone.utc
    ).strftime("%Y-%m")

    month = attendance_collection().count_documents({
        "hospital_id": hospital_id,
        "accepted_at": {
            "$regex": f"^{month_prefix}"
        },
    })

    return jsonify({
        "total_attended": total,
        "attended_this_month": month,
    }), 200


# ============================================================
# GET INCIDENT
# ============================================================

@incidents_bp.get("/<incident_id>")
@require_login()
def get_incident(incident_id):

    incident = incidents_collection().find_one({
        "incident_id": incident_id
    })

    if incident is None:
        return jsonify({
            "error": "INCIDENT_NOT_FOUND"
        }), 404

    if session.get("role") == "hospital":

        hospital_id = current_hospital_id()

        incident_hospital_id = incident.get(
            "hospital_id"
        )

        if (
            incident_hospital_id
            and incident_hospital_id != hospital_id
        ):
            return jsonify({
                "error": "FORBIDDEN"
            }), 403

    return jsonify(
        serialize_document(incident)
    ), 200


# ============================================================
# ACCEPT INCIDENT
# ============================================================

@incidents_bp.post("/<incident_id>/accept")
@require_login("hospital")
def accept_incident(incident_id):

    hospital_id = current_hospital_id()

    hospital = hospitals_collection().find_one({
        "hospital_id": hospital_id
    })

    if hospital is None:
        return jsonify({
            "error": "HOSPITAL_NOT_FOUND"
        }), 404

    if not hospital.get("emergency_available", False) or not hospital.get("staff_available", False) or hospital.get("status", "AVAILABLE") != "AVAILABLE":
        return jsonify({
            "error": "HOSPITAL_UNAVAILABLE",
            "message": "Facility must be marked available with staff available before accepting.",
        }), 409

    current_incident = incidents_collection().find_one({"incident_id": incident_id})
    if current_incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    eligible = current_incident.get("eligible_hospitals")
    if current_incident.get("dispatch_exhausted"):
        return jsonify({"error": "DISPATCH_EXHAUSTED", "message": "No suitable facility remains. Admin review is required."}), 409
    if eligible and hospital_id not in eligible:
        return jsonify({"error": "FACILITY_NOT_SELECTED", "message": "This incident has been routed to another facility."}), 403

    now = datetime.now(
        timezone.utc
    ).isoformat()

    snapshot = hospital.get(
        "resources",
        {}
    )

    # Atomic operation:
    # only the first hospital can change PENDING
    # to RESPONSE_ACCEPTED.
    accept_filter = {"incident_id": incident_id, "status": "PENDING"}
    if eligible:
        # Recheck the selected facility inside the atomic claim to avoid a
        # route-change/accept race between the earlier validation and update.
        accept_filter["eligible_hospitals"] = hospital_id

    result = (
        incidents_collection()
        .find_one_and_update(
            accept_filter,
            {
                "$set": {
                    "status":
                        "RESPONSE_ACCEPTED",

                    "hospital_response":
                        "ACCEPTED",

                    "hospital_id":
                        hospital_id,

                    "hospital_claimed_at":
                        now,

                    "accepted_by_hospital":
                        hospital.get("name"),

                    "resource_snapshot":
                        snapshot,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    )

    if result is None:

        existing = incidents_collection().find_one({
            "incident_id": incident_id
        })

        if (
            existing
            and existing.get("hospital_id")
            == hospital_id
        ):
            return jsonify(
                serialize_document(existing)
            ), 200

        return jsonify({
            "error": "ALREADY_CLAIMED",
            "message": (
                "Another hospital accepted "
                "this incident first."
            ),
        }), 409

    attendance = {
        "incident_id": incident_id,
        "hospital_id": hospital_id,
        "hospital_name": hospital.get("name"),
        "accepted_at": now,
        "resources_snapshot": snapshot,
        "severity": result.get("severity"),
        "location": {
            "latitude":
                result.get("latitude"),

            "longitude":
                result.get("longitude"),
        },
    }

    attendance_collection().update_one(
        {
            "incident_id": incident_id
        },
        {
            "$setOnInsert": attendance
        },
        upsert=True,
    )

    return jsonify(
        serialize_document(result)
    ), 200


# ============================================================
# REJECT INCIDENT
# ============================================================

@incidents_bp.post("/<incident_id>/reject")
@require_login("hospital")
def reject_incident(incident_id):

    hospital_id = current_hospital_id()
    current_incident = incidents_collection().find_one({"incident_id": incident_id})
    if current_incident is None:
        return jsonify({"error": "INCIDENT_NOT_FOUND"}), 404
    eligible = current_incident.get("eligible_hospitals")
    if current_incident.get("dispatch_exhausted"):
        return jsonify({"error": "DISPATCH_EXHAUSTED", "message": "No suitable facility remains. Admin review is required."}), 409
    if eligible and hospital_id not in eligible:
        return jsonify({"error": "FACILITY_NOT_SELECTED", "message": "This incident has been routed to another facility."}), 403

    result = (
        incidents_collection()
        .find_one_and_update(
            {
                "incident_id": incident_id,
                "status": "PENDING",
            },
            {
                "$set": {
                    "last_rejected_by": hospital_id,
                    "last_rejected_at": datetime.now(timezone.utc).isoformat(),
                },
                "$addToSet": {"rejected_hospitals": hospital_id}
            },
            return_document=ReturnDocument.AFTER,
        )
    )

    if result is None:
        return jsonify({"error": "INCIDENT_NOT_PENDING"}), 409

    # Automatic fallback: after a facility rejects, route the still-pending
    # incident to the next suitable available facility (if any).
    network_doc = road_network_collection().find_one({"_id": "default"})
    network = network_doc.get("network") if network_doc else None
    try:
        ranked = rank_facilities(result, list(hospitals_collection().find()), network)["recommendations"]
    except ValueError:
        ranked = []
    if ranked:
        next_facility = ranked[0]
        result = incidents_collection().find_one_and_update(
            {"incident_id": incident_id, "status": "PENDING"},
            {"$set": {
                "eligible_hospitals": [next_facility["facility_id"]],
                "recommended_hospital_id": next_facility["facility_id"],
                "recommended_hospital_name": next_facility["name"],
                "dispatch_recommendation": next_facility,
                "dispatch_exhausted": False,
                "fallback_count": int(result.get("fallback_count", 0)) + 1,
                "last_fallback_at": datetime.now(timezone.utc).isoformat(),
            }},
            return_document=ReturnDocument.AFTER,
        )
    else:
        result = incidents_collection().find_one_and_update(
            {"incident_id": incident_id, "status": "PENDING"},
            {"$set": {"eligible_hospitals": [], "dispatch_exhausted": True, "dispatch_exhausted_at": datetime.now(timezone.utc).isoformat()}},
            return_document=ReturnDocument.AFTER,
        )
    return jsonify({"incident": serialize_document(result), "fallback_facility": (ranked[0] if ranked else None), "dispatch_exhausted": not bool(ranked)}), 200


# ============================================================
# 🚑 DISPATCH AMBULANCE
# ============================================================

@incidents_bp.post("/<incident_id>/dispatch")
@require_login("hospital")
def dispatch_ambulance(incident_id):

    hospital_id = current_hospital_id()

    # --------------------------------------------------------
    # Get accepting hospital
    # --------------------------------------------------------

    hospital = hospitals_collection().find_one({
        "hospital_id": hospital_id
    })

    if hospital is None:
        return jsonify({
            "error": "HOSPITAL_NOT_FOUND"
        }), 404

    # --------------------------------------------------------
    # Get incident
    # --------------------------------------------------------

    incident = incidents_collection().find_one({
        "incident_id": incident_id
    })

    if incident is None:
        return jsonify({
            "error": "INCIDENT_NOT_FOUND"
        }), 404

    # --------------------------------------------------------
    # Only the accepting hospital can dispatch
    # --------------------------------------------------------

    if incident.get("hospital_id") != hospital_id:
        return jsonify({
            "error": "FORBIDDEN",
            "message": (
                "Only the accepting hospital "
                "can dispatch this case."
            ),
        }), 403

    # --------------------------------------------------------
    # Must be accepted first
    # --------------------------------------------------------

    if incident.get("status") != "RESPONSE_ACCEPTED":
        return jsonify({
            "error":
                "INVALID_INCIDENT_STATE",
            "message": (
                "Accept the incident before "
                "dispatching an ambulance."
            ),
        }), 409

    # --------------------------------------------------------
    # Prefer individually registered ambulances when this
    # hospital has any. Legacy resource counters remain as a
    # backward-compatible fallback for older demo records.
    # --------------------------------------------------------
    registered_count = ambulances_collection().count_documents({"hospital_id": hospital_id})
    if registered_count:
        now = datetime.now(timezone.utc).isoformat()
        ambulance = ambulances_collection().find_one_and_update(
            {"hospital_id": hospital_id, "status": "AVAILABLE"},
            {"$set": {"status": "ASSIGNED", "incident_id": incident_id, "assigned_at": now}},
            sort=[("ambulance_id", 1)],
            return_document=ReturnDocument.AFTER,
        )
        if ambulance is None:
            return jsonify({"error": "NO_AMBULANCE_AVAILABLE", "message": "No registered ambulance is currently available."}), 409
        result = incidents_collection().find_one_and_update(
            {"incident_id": incident_id, "hospital_id": hospital_id, "status": "RESPONSE_ACCEPTED"},
            {"$set": {"status": "DISPATCHED", "ambulance_status": "DISPATCHED", "ambulance_id": ambulance["ambulance_id"], "ambulance_type": ambulance.get("vehicle_type", "BLS"), "ambulance_assigned_at": now, "dispatched_at": now, "dispatch_hospital_id": hospital_id, "dispatch_hospital_name": hospital.get("name")}},
            return_document=ReturnDocument.AFTER,
        )
        if result is None:
            ambulances_collection().update_one({"ambulance_id": ambulance["ambulance_id"], "status": "ASSIGNED", "incident_id": incident_id}, {"$set": {"status": "AVAILABLE", "incident_id": None}, "$unset": {"assigned_at": ""}})
            return jsonify({"error": "INVALID_INCIDENT_STATE", "message": "Incident state changed before dispatch completed."}), 409
        return jsonify({"ok": True, "status": "DISPATCHED", "ambulance_id": ambulance["ambulance_id"], "ambulance_type": ambulance.get("vehicle_type", "BLS"), "incident": serialize_document(result)}), 200

    # --------------------------------------------------------
    # Legacy fallback: use resource counters when no individual
    # ambulance records exist for this facility.
    # --------------------------------------------------------
    resources = hospital.get(
        "resources",
        {}
    )

    small = int(
        resources.get(
            "small_ambulances",
            0,
        )
    )

    large = int(
        resources.get(
            "large_ambulances",
            0,
        )
    )

    # --------------------------------------------------------
    # Choose ambulance
    # --------------------------------------------------------

    if small > 0:
        ambulance_type = "SMALL"
        resource_field = (
            "resources.small_ambulances"
        )

    elif large > 0:
        ambulance_type = "LARGE"
        resource_field = (
            "resources.large_ambulances"
        )

    else:
        return jsonify({
            "error":
                "NO_AMBULANCE_AVAILABLE",
            "message":
                "No ambulance is available at this hospital.",
        }), 409

    now = datetime.now(
        timezone.utc
    ).isoformat()

    # --------------------------------------------------------
    # Atomically reserve one ambulance
    # --------------------------------------------------------

    updated_hospital = (
        hospitals_collection()
        .find_one_and_update(
            {
                "hospital_id": hospital_id,
                resource_field: {
                    "$gt": 0
                },
            },
            {
                "$inc": {
                    resource_field: -1
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    )

    if updated_hospital is None:
        return jsonify({
            "error":
                "NO_AMBULANCE_AVAILABLE",
            "message":
                "The ambulance was just assigned to another case.",
        }), 409

    # --------------------------------------------------------
    # Update incident
    # --------------------------------------------------------

    result = (
        incidents_collection()
        .find_one_and_update(
            {
                "incident_id": incident_id,
                "hospital_id": hospital_id,
                "status": "RESPONSE_ACCEPTED",
            },
            {
                "$set": {
                    "status":
                        "DISPATCHED",

                    "ambulance_status":
                        "DISPATCHED",

                    "ambulance_type":
                        ambulance_type,

                    "ambulance_assigned_at":
                        now,

                    "dispatched_at":
                        now,

                    "dispatch_hospital_id":
                        hospital_id,

                    "dispatch_hospital_name":
                        hospital.get("name"),
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    )

    # --------------------------------------------------------
    # If incident changed during dispatch,
    # return ambulance to hospital resources.
    # --------------------------------------------------------

    if result is None:

        hospitals_collection().update_one(
            {
                "hospital_id":
                    hospital_id
            },
            {
                "$inc": {
                    resource_field: 1
                }
            },
        )

        return jsonify({
            "error":
                "INVALID_INCIDENT_STATE",
            "message":
                "Incident state changed before dispatch completed.",
        }), 409

    return jsonify({
        "ok": True,
        "status": "DISPATCHED",
        "ambulance_type":
            ambulance_type,
        "incident":
            serialize_document(result),
    }), 200


# ============================================================
# UPDATE INCIDENT STATUS
# ============================================================

@incidents_bp.put("/<incident_id>/status")
@require_login()
def update_incident_status(incident_id):

    data = (
        request.get_json(
            silent=True
        )
        or {}
    )

    status = data.get("status")

    allowed = {
        "PENDING",
        "RESPONSE_ACCEPTED",
        "DISPATCHED",
        "EN_ROUTE",
        "ARRIVED",
        "REJECTED",
        "RESOLVED",
    }

    if status not in allowed:
        return jsonify({
            "error":
                "INVALID_STATUS",
            "allowed":
                sorted(allowed),
        }), 400

    incident = incidents_collection().find_one({
        "incident_id":
            incident_id
    })

    if incident is None:
        return jsonify({
            "error":
                "INCIDENT_NOT_FOUND"
        }), 404

    # Hospital may only modify its own incident.
    if (
        session.get("role") == "hospital"
        and incident.get("hospital_id")
        != current_hospital_id()
    ):
        return jsonify({
            "error":
                "FORBIDDEN"
        }), 403

    now = datetime.now(
        timezone.utc
    ).isoformat()

    update = {
        "status": status
    }

    if status == "RESPONSE_ACCEPTED":

        update[
            "hospital_response"
        ] = "ACCEPTED"

        update[
            "accepted_status_at"
        ] = now

    elif status == "DISPATCHED":

        update[
            "ambulance_status"
        ] = "DISPATCHED"

        update[
            "dispatched_at"
        ] = now

    elif status == "EN_ROUTE":

        update[
            "ambulance_status"
        ] = "EN_ROUTE"

        update[
            "en_route_at"
        ] = now

    elif status == "ARRIVED":

        update[
            "ambulance_status"
        ] = "ARRIVED"

        update[
            "arrived_at"
        ] = now

    elif status == "REJECTED":

        update[
            "hospital_response"
        ] = "REJECTED"

        update[
            "rejected_at"
        ] = now

    elif status == "RESOLVED":

        update[
            "hospital_response"
        ] = "RESOLVED"

        update[
            "resolved_at"
        ] = now

    result = (
        incidents_collection()
        .find_one_and_update(
            {"incident_id": incident_id},
            {"$set": update},
            return_document=ReturnDocument.AFTER,
        )
    )
    if result and result.get("ambulance_id"):
        ambulance_id = result["ambulance_id"]
        if status == "EN_ROUTE":
            ambulances_collection().update_one({"ambulance_id": ambulance_id, "incident_id": incident_id}, {"$set": {"status": "EN_ROUTE", "en_route_at": now}})
        elif status == "ARRIVED":
            ambulances_collection().update_one({"ambulance_id": ambulance_id, "incident_id": incident_id}, {"$set": {"status": "ARRIVED", "arrived_at": now}})
        elif status == "RESOLVED":
            ambulances_collection().update_one({"ambulance_id": ambulance_id, "incident_id": incident_id}, {"$set": {"status": "AVAILABLE", "incident_id": None, "status_updated_at": now}, "$unset": {"assigned_at": "", "en_route_at": "", "arrived_at": ""}})

    return jsonify(
        serialize_document(result)
    ), 200