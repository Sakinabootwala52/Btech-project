from functools import wraps
from flask import jsonify, session

def require_login(role=None):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            current = session.get("role")
            if not current:
                return jsonify({"error": "UNAUTHORIZED", "message": "Login required."}), 401
            if role and current != role:
                return jsonify({"error": "FORBIDDEN", "message": "You do not have access to this resource."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator

def current_hospital_id():
    return session.get("hospital_id")
