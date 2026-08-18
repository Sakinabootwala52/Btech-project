def notify_hospital(incident, hospital):
    """
    Prototype notification layer.

    This intentionally does not call SMS/email/real hospital APIs.
    The hospital dashboard will consume incidents through the backend API.
    """
    return {
        "notified": bool(hospital),
        "mode": "DASHBOARD_EVENT",
        "hospital_id": hospital["hospital_id"] if hospital else None,
        "incident_id": incident["incident_id"]
    }
