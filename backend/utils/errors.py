from flask import jsonify
from pymongo.errors import PyMongoError

def register_error_handlers(app):

    @app.errorhandler(400)
    def bad_request(error):
        return jsonify({
            "error": "BAD_REQUEST",
            "message": getattr(error, "description", "Invalid request")
        }), 400

    @app.errorhandler(404)
    def not_found(error):
        return jsonify({
            "error": "NOT_FOUND",
            "message": getattr(error, "description", "Resource not found")
        }), 404

    @app.errorhandler(500)
    def internal_error(error):
        return jsonify({
            "error": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected server error occurred."
        }), 500

    @app.errorhandler(Exception)
    def unhandled_error(error):
        app.logger.exception("Unhandled exception", exc_info=error)
        return jsonify({
            "error": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected server error occurred."
        }), 500
