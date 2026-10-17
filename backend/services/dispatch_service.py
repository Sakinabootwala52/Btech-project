"""Facility suitability and route-time ranking for incident dispatch."""
from services.routing_service import estimate_route

SEVERE_LABELS = {"CRITICAL", "SEVERE", "HIGH", "MAJOR"}
MEDIUM_LABELS = {"MEDIUM", "MODERATE"}


def required_capabilities(incident):
    severity = str(incident.get("severity") or "").upper()
    if severity in SEVERE_LABELS:
        return ["TRAUMA", "EMERGENCY"]
    if severity in MEDIUM_LABELS:
        return ["EMERGENCY", "FIRST_AID"]
    return ["FIRST_AID", "EMERGENCY"]


def _capabilities(facility):
    provided = facility.get("capabilities")
    if provided:
        return {str(item).upper() for item in provided}
    kind = str(facility.get("facility_type", "HOSPITAL")).upper()
    if kind == "CLINIC":
        return {"FIRST_AID"}
    # Backwards-compatible default for older hospital records.
    return {"FIRST_AID", "EMERGENCY", "TRAUMA"}


def _available(facility):
    return (
        facility.get("status", "AVAILABLE") == "AVAILABLE"
        and facility.get("emergency_available", True) is True
        and facility.get("staff_available", True) is True
    )


def rank_facilities(incident, facilities, road_network=None):
    origin = {"latitude": incident.get("latitude"), "longitude": incident.get("longitude")}
    if origin["latitude"] is None or origin["longitude"] is None:
        raise ValueError("Incident must contain latitude and longitude.")
    rejected = set(incident.get("rejected_hospitals", []))
    required = required_capabilities(incident)
    ranked = []
    for facility in facilities:
        facility_id = facility.get("hospital_id") or facility.get("facility_id")
        if not facility_id or facility_id in rejected or not _available(facility):
            continue
        try:
            destination = {"latitude": float(facility["latitude"]), "longitude": float(facility["longitude"])}
        except (KeyError, TypeError, ValueError):
            continue
        caps = _capabilities(facility)
        matched = next((cap for cap in required if cap in caps), None)
        if matched is None:
            continue
        route = estimate_route(origin, destination, road_network)
        resources = facility.get("resources") or {}
        available_ambulances = int(resources.get("small_ambulances", 0) or 0) + int(resources.get("large_ambulances", 0) or 0)
        staff = int(resources.get("emergency_staff", 0) or 0)
        # Match the highest-ranked capability first, then route time, then resources.
        capability_rank = required.index(matched)
        ranked.append({
            "facility_id": facility_id,
            "hospital_id": facility_id,  # preserve existing frontend terminology
            "name": facility.get("name", facility_id),
            "facility_type": str(facility.get("facility_type", "HOSPITAL")).upper(),
            "capabilities": sorted(caps),
            "matched_capability": matched,
            "contact": facility.get("contact"),
            "latitude": destination["latitude"],
            "longitude": destination["longitude"],
            "available_ambulances": available_ambulances,
            "emergency_staff": staff,
            "route": route,
            "_sort": (capability_rank, route["travel_time_min"], -available_ambulances, -staff),
        })
    ranked.sort(key=lambda item: item["_sort"])
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
        item.pop("_sort", None)
    return {"required_capabilities": required, "recommendations": ranked}
