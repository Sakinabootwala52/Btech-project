from flask import Blueprint, jsonify, request, session
from database.mongo import hospitals_collection
from config import Config

auth_bp = Blueprint("auth", __name__)

@auth_bp.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    role = str(data.get("role", "")).lower()
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))

    if role == "admin":
        if username != Config.ADMIN_USERNAME or password != Config.ADMIN_PASSWORD:
            return jsonify({"error": "INVALID_CREDENTIALS", "message": "Invalid admin credentials."}), 401
        session.clear()
        session["role"] = "admin"
        session["username"] = username
        return jsonify({"role": "admin", "username": username}), 200

    if role == "live":
        if username != Config.LIVE_USERNAME or password != Config.LIVE_PASSWORD:
            return jsonify({"error": "INVALID_CREDENTIALS", "message": "Invalid live credentials."}), 401
        session.clear()
        session["role"] = "live"
        session["username"] = username
        return jsonify({"role": "live", "username": username}), 200

    if role == "ambulance":
        if username != Config.AMBULANCE_USERNAME or password != Config.AMBULANCE_PASSWORD:
            return jsonify({"error": "INVALID_CREDENTIALS", "message": "Invalid ambulance operator credentials."}), 401
        session.clear()
        session["role"] = "ambulance"
        session["username"] = username
        return jsonify({"role": "ambulance", "username": username}), 200

    if role == "hospital":
        hospital = hospitals_collection().find_one({"name": {"$regex": f"^{username}$", "$options": "i"}})
        if hospital is None or password != "1234":
            return jsonify({"error": "INVALID_CREDENTIALS", "message": "Invalid hospital credentials."}), 401
        session.clear()
        session["role"] = "hospital"
        session["hospital_id"] = hospital["hospital_id"]
        session["hospital_name"] = hospital["name"]
        return jsonify({
            "role": "hospital",
            "hospital_id": hospital["hospital_id"],
            "hospital_name": hospital["name"]
        }), 200

    return jsonify({"error": "INVALID_ROLE", "message": "role must be admin, hospital, live, or ambulance."}), 400

@auth_bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True}), 200

@auth_bp.get("/me")
def me():
    if not session.get("role"):
        return jsonify({"authenticated": False}), 200
    return jsonify({
        "authenticated": True,
        "role": session.get("role"),
        "username": session.get("username"),
        "hospital_id": session.get("hospital_id"),
        "hospital_name": session.get("hospital_name")
    }), 200
