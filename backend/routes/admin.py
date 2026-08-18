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
