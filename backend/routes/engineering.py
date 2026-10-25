from flask import Blueprint, jsonify, request
from database.mongo import road_network_collection
from services.routing_benchmark import benchmark_network, sample_road_network
from utils.auth import require_login

engineering_bp = Blueprint("engineering", __name__)

@engineering_bp.get("/routing-benchmark")
@require_login("admin")
def routing_benchmark():
    source = request.args.get("source", "sample").lower()
    if source == "configured":
        doc = road_network_collection().find_one({"_id": "default"})
        network = doc.get("network") if doc else None
        if not network or len(network.get("nodes", [])) < 2:
            return jsonify({"error": "ROAD_GRAPH_REQUIRED", "message": "Configure at least two connected road-graph nodes first."}), 400
    else:
        network = sample_road_network()
    try:
        return jsonify(benchmark_network(network)), 200
    except (ValueError, KeyError, TypeError) as exc:
        return jsonify({"error": "BENCHMARK_FAILED", "message": str(exc)}), 400
