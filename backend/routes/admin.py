from datetime import datetime, timezone
from flask import Blueprint, jsonify, request
from database.mongo import incidents_collection, attendance_collection, hospitals_collection, cameras_collection
from utils.auth import require_login

admin_bp = Blueprint("admin", __name__)

@admin_bp.get("/summary")
@require_login("admin")
def summary():
    now = datetime.now(timezone.utc)
    month = request.args.get("month", now.strftime("%Y-%m"))
    try:
        month_start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        return jsonify({"error": "INVALID_MONTH", "message": "month must be YYYY-MM."}), 400
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)

    month_query = {"timestamp": {"$gte": month_start, "$lt": month_end}}
    attendance_month = {"accepted_at": {"$regex": f"^{month}"}}

    total = incidents_collection().count_documents({})
    month_total = incidents_collection().count_documents(month_query)
    pending = incidents_collection().count_documents({"status": "PENDING"})
    accepted = incidents_collection().count_documents({"status": "RESPONSE_ACCEPTED"})
    resolved = incidents_collection().count_documents({"status": "RESOLVED"})

    hospital_rows = list(incidents_collection().aggregate([
        {"$match": {"hospital_id": {"$ne": None}}},
        {"$group": {"_id": "$hospital_id", "attended": {"$sum": 1}}},
        {"$sort": {"attended": -1}}
    ]))
    hospital_map = {h["hospital_id"]: h["name"] for h in hospitals_collection().find({}, {"hospital_id": 1, "name": 1})}
    hospital_performance = [
        {"hospital_id": row["_id"], "hospital_name": hospital_map.get(row["_id"], row["_id"]), "attended": row["attended"]}
        for row in hospital_rows
    ]

    camera_map = {c["camera_id"]: c for c in cameras_collection().find({}, {"camera_id": 1, "name": 1, "location_name": 1})}
    hotspot_rows = list(incidents_collection().aggregate([
        {"$match": month_query},
        {"$group": {"_id": "$camera_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}, {"$limit": 10}
    ]))
    hotspots = []
    for row in hotspot_rows:
        camera = camera_map.get(row["_id"], {})
        incidents_at_camera = incidents_collection().find_one({"camera_id": row["_id"], **month_query}, sort=[("timestamp", 1)])
        hotspots.append({
            "camera_id": row["_id"],
            "camera_name": camera.get("name", row["_id"]),
            "place": camera.get("location_name", "Unknown location"),
            "latitude": incidents_at_camera.get("latitude") if incidents_at_camera else None,
            "longitude": incidents_at_camera.get("longitude") if incidents_at_camera else None,
            "count": row["count"]
        })

    resource_rows = []
    for h in hospitals_collection().find().sort("hospital_id", 1):
        resource_rows.append({
            "hospital_id": h["hospital_id"], "hospital_name": h["name"],
            "resources": h.get("resources", {}),
            "emergency_available": h.get("emergency_available", False),
            "staff_available": h.get("staff_available", False),
            "status": h.get("status")
        })

    attendance_rows = list(attendance_collection().aggregate([
        {"$match": attendance_month},
        {"$group": {"_id": "$hospital_id", "attended": {"$sum": 1}}},
        {"$sort": {"attended": -1}}
    ]))

    attendance_records = list(attendance_collection().find(attendance_month).sort("accepted_at", -1).limit(100))

    return jsonify({
        "month": month,
        "totals": {"all_time": total, "this_month": month_total, "pending": pending, "accepted": accepted, "resolved": resolved},
        "hospital_performance": hospital_performance,
        "attendance_this_month": attendance_rows,
        "attendance_records": [
            {"incident_id": r.get("incident_id"), "hospital_id": r.get("hospital_id"), "hospital_name": r.get("hospital_name"), "accepted_at": r.get("accepted_at"), "severity": r.get("severity"), "resources_snapshot": r.get("resources_snapshot", {})}
            for r in attendance_records
        ],
        "resource_snapshot": resource_rows,
        "hotspots": hotspots
    }), 200


@admin_bp.get("/engineering-metrics")
@require_login("admin")
def engineering_metrics():
    """Operational timing metrics; classifier precision/recall belongs to labelled ML evaluation."""
    incidents = list(incidents_collection().find({}, {
        "status": 1, "created_at": 1, "hospital_claimed_at": 1,
        "accepted_status_at": 1, "processing_seconds": 1, "dispatched_at": 1,
        "arrived_at": 1, "resolved_at": 1, "severity": 1,
    }))
    def parse_time(value):
        if not isinstance(value, str):
            return None
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    pipeline = [float(row["processing_seconds"]) for row in incidents if isinstance(row.get("processing_seconds"), (int, float)) and row["processing_seconds"] >= 0]
    response_seconds = []
    dispatch_seconds = []
    arrival_seconds = []
    for row in incidents:
        created = parse_time(row.get("created_at"))
        accepted = parse_time(row.get("hospital_claimed_at") or row.get("accepted_status_at"))
        dispatched = parse_time(row.get("dispatched_at"))
        arrived = parse_time(row.get("arrived_at"))
        if created and accepted and accepted >= created:
            response_seconds.append((accepted - created).total_seconds())
        if accepted and dispatched and dispatched >= accepted:
            dispatch_seconds.append((dispatched - accepted).total_seconds())
        if dispatched and arrived and arrived >= dispatched:
            arrival_seconds.append((arrived - dispatched).total_seconds())
    def avg(values):
        return round(sum(values) / len(values), 2) if values else None
    return jsonify({
        "incident_count": len(incidents),
        "pipeline_processing_seconds": {"sample_count": len(pipeline), "average": avg(pipeline), "max": round(max(pipeline), 2) if pipeline else None},
        "detection_to_accept_seconds": {"sample_count": len(response_seconds), "average": avg(response_seconds)},
        "accept_to_dispatch_seconds": {"sample_count": len(dispatch_seconds), "average": avg(dispatch_seconds)},
        "dispatch_to_arrival_seconds": {"sample_count": len(arrival_seconds), "average": avg(arrival_seconds)},
        "status_counts": {status: sum(1 for row in incidents if row.get("status") == status) for status in ["PENDING", "RESPONSE_ACCEPTED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "RESOLVED"]},
    }), 200
