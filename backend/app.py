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
from routes.stream import stream_bp
from routes.dispatch import dispatch_bp
from routes.ambulances import ambulances_bp
from routes.engineering import engineering_bp
from routes.copilot import copilot_bp
from routes.simulation import simulation_bp

from utils.errors import register_error_handlers


def create_app():
    app = Flask(__name__)

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------
    app.config.from_object(Config)
    app.secret_key = Config.SECRET_KEY

    # ---------------------------------------------------------
    # CORS
    # ---------------------------------------------------------
    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174", "http://127.0.0.1:5174"]
            }
        },
        supports_credentials=True,
    )

    # ---------------------------------------------------------
    # Database
    # ---------------------------------------------------------
    init_db(
        app.config["MONGO_URI"],
        app.config["MONGO_DB_NAME"],
    )

    # ---------------------------------------------------------
    # API Routes
    # ---------------------------------------------------------
    app.register_blueprint(
        auth_bp,
        url_prefix="/api/auth",
    )

    app.register_blueprint(
        incidents_bp,
        url_prefix="/api/incidents",
    )

    app.register_blueprint(
        hospitals_bp,
        url_prefix="/api/hospitals",
    )

    app.register_blueprint(
        cameras_bp,
        url_prefix="/api/cameras",
    )

    app.register_blueprint(
        detection_bp,
        url_prefix="/api/detect-accident",
    )

    app.register_blueprint(
        admin_bp,
        url_prefix="/api/admin",
    )

    # Existing upload-based live API
    app.register_blueprint(
        live_bp,
        url_prefix="/api/live",
    )

    # ---------------------------------------------------------
    # NEW: Streaming API
    #
    # /api/live/stream/start
    # /api/live/stream/<stream_id>
    # /api/live/stream/<stream_id>/stop
    # ---------------------------------------------------------
    app.register_blueprint(
        stream_bp,
        url_prefix="/api/live/stream",
    )

    app.register_blueprint(dispatch_bp, url_prefix="/api/dispatch")
    app.register_blueprint(ambulances_bp, url_prefix="/api/ambulances")
    app.register_blueprint(engineering_bp, url_prefix="/api/engineering")
    app.register_blueprint(copilot_bp, url_prefix="/api/copilot")
    app.register_blueprint(simulation_bp, url_prefix="/api/simulation")

    # ---------------------------------------------------------
    # Health Check
    # ---------------------------------------------------------
    @app.get("/api/health")
    def health():
        return jsonify({
            "status": "ok",
            "service": "accident-response-backend",
        }), 200

    # ---------------------------------------------------------
    # Uploaded Files
    # ---------------------------------------------------------
    @app.get("/uploads/<path:filename>")
    def uploads(filename):
        return send_from_directory(
            app.config["UPLOAD_DIR"],
            filename,
        )

    # ---------------------------------------------------------
    # Error Handlers
    # ---------------------------------------------------------
    register_error_handlers(app)

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
    )