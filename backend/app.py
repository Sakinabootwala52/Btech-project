from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from config import Config
from database.mongo import init_db
from routes.auth import auth_bp
from routes.incidents import incidents_bp
from routes.hospitals import hospitals_bp
from routes.cameras import cameras_bp
from routes.detection import detection_bp
from routes.admin import admin_bp
from routes.live import live_bp
from utils.errors import register_error_handlers


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY
    CORS(app, resources={r"/api/*": {"origins": "http://localhost:5173"}}, supports_credentials=True)
    init_db(app.config["MONGO_URI"], app.config["MONGO_DB_NAME"])

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(incidents_bp, url_prefix="/api/incidents")
    app.register_blueprint(hospitals_bp, url_prefix="/api/hospitals")
    app.register_blueprint(cameras_bp, url_prefix="/api/cameras")
    app.register_blueprint(detection_bp, url_prefix="/api/detect-accident")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(live_bp, url_prefix="/api/live")

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "accident-response-backend"}), 200

    @app.get("/uploads/<path:filename>")
    def uploads(filename):
        return send_from_directory(app.config["UPLOAD_DIR"], filename)

    register_error_handlers(app)
    return app

app = create_app()
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
