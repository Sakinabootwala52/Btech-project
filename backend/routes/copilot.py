from flask import Blueprint, jsonify, request
from utils.auth import require_login
from services.copilot_service import explain_incident

copilot_bp = Blueprint("copilot", __name__)

@copilot_bp.post("/explain")
@require_login("admin")
def explain():
    data = request.get_json(silent=True) or {}
    incident = data.get("incident") or {}
    recommendations = data.get("recommendations") or []
    question = str(data.get("question") or "")[:1000]
    if not isinstance(incident, dict) or not isinstance(recommendations, list):
        return jsonify({"error": "INVALID_PAYLOAD", "message": "incident must be an object and recommendations must be a list."}), 400
    result = explain_incident(incident, recommendations, question)
    return jsonify(result), 200
