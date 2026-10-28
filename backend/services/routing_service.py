"""Road-graph routing with a clearly labelled straight-line fallback.

Road graph schema:
  nodes: [{node_id, latitude, longitude}]
  edges: [{from, to, distance_km, travel_time_min, bidirectional}]
Edge travel_time_min should be based on road/traffic data where available.
"""
from heapq import heappush, heappop
from math import inf
from services.distance_service import haversine_distance_km

DEFAULT_AVERAGE_SPEED_KMH = 25.0  # illustrative city estimate, not live traffic


def validate_road_network(network):
    if not isinstance(network, dict):
        raise ValueError("Road network must be a JSON object.")
    nodes = network.get("nodes")
    edges = network.get("edges")
    if not isinstance(nodes, list) or not isinstance(edges, list):
        raise ValueError("Road network must contain nodes[] and edges[].")
    seen = set()
    for node in nodes:
        if not isinstance(node, dict) or not node.get("node_id"):
            raise ValueError("Each node requires node_id, latitude and longitude.")
        node_id = str(node["node_id"])
        if node_id in seen:
            raise ValueError(f"Duplicate node_id: {node_id}")
        seen.add(node_id)
        try:
            lat, lon = float(node["latitude"]), float(node["longitude"])
        except (KeyError, TypeError, ValueError):
            raise ValueError(f"Node {node_id} has invalid coordinates.")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError(f"Node {node_id} has out-of-range coordinates.")
    for edge in edges:
        if not isinstance(edge, dict):
            raise ValueError("Each edge must be an object.")
        if str(edge.get("from")) not in seen or str(edge.get("to")) not in seen:
            raise ValueError("Every edge from/to must refer to an existing node_id.")
        try:
            distance = float(edge["distance_km"])
            minutes = float(edge["travel_time_min"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("Every edge needs numeric distance_km and travel_time_min.")
        if distance < 0 or minutes <= 0:
            raise ValueError("Edge distance must be >= 0 and travel_time_min must be > 0.")
    return network


def _nearest_node(point, nodes):
    if not nodes:
        return None
    return min(nodes, key=lambda n: haversine_distance_km(
        float(point["latitude"]), float(point["longitude"]),
        float(n["latitude"]), float(n["longitude"])
    ))


def _shortest_path(network, start_id, end_id):
    nodes = {str(n["node_id"]): n for n in network.get("nodes", [])}
    if start_id not in nodes or end_id not in nodes:
        return None
    graph = {node_id: [] for node_id in nodes}
    for edge in network.get("edges", []):
        a, b = str(edge["from"]), str(edge["to"])
        weight = float(edge["travel_time_min"])
        distance = float(edge["distance_km"])
        graph[a].append((b, weight, distance))
        if edge.get("bidirectional", True):
            graph[b].append((a, weight, distance))

    distances = {node_id: inf for node_id in nodes}
    distances[start_id] = 0.0
    previous = {}
    distance_km = {node_id: 0.0 for node_id in nodes}
    queue = [(0.0, start_id)]
    while queue:
        current_time, current = heappop(queue)
        if current_time != distances[current]:
            continue
        if current == end_id:
            break
        for neighbor, minutes, km in graph[current]:
            candidate = current_time + minutes
            if candidate < distances[neighbor]:
                distances[neighbor] = candidate
                distance_km[neighbor] = distance_km[current] + km
                previous[neighbor] = current
                heappush(queue, (candidate, neighbor))
    if distances[end_id] == inf:
        return None
    path = [end_id]
    while path[-1] != start_id:
        path.append(previous[path[-1]])
    path.reverse()
    return {"path": path, "travel_time_min": round(distances[end_id], 2),
            "road_distance_km": round(distance_km[end_id], 2)}


def estimate_route(origin, destination, road_network=None, average_speed_kmh=DEFAULT_AVERAGE_SPEED_KMH):
    """Return route estimate. Graph weights are used only if a valid path exists."""
    straight_km = haversine_distance_km(
        float(origin["latitude"]), float(origin["longitude"]),
        float(destination["latitude"]), float(destination["longitude"])
    )
    if road_network and road_network.get("nodes") and road_network.get("edges"):
        start = _nearest_node(origin, road_network["nodes"])
        end = _nearest_node(destination, road_network["nodes"])
        if start and end:
            result = _shortest_path(road_network, str(start["node_id"]), str(end["node_id"]))
            if result:
                # Include approximate access distance from the exact locations to snapped graph nodes.
                access_km = haversine_distance_km(origin["latitude"], origin["longitude"], start["latitude"], start["longitude"])
                egress_km = haversine_distance_km(destination["latitude"], destination["longitude"], end["latitude"], end["longitude"])
                access_minutes = (access_km + egress_km) / average_speed_kmh * 60.0
                return {
                    **result,
                    "straight_line_distance_km": round(straight_km, 2),
                    "distance_km": round(result["road_distance_km"] + access_km + egress_km, 2),
                    "travel_time_min": round(result["travel_time_min"] + access_minutes, 2),
                    "routing_mode": "ROAD_GRAPH",
                }
    estimated_minutes = (straight_km / max(float(average_speed_kmh), 1.0)) * 60.0
    return {
        "path": [],
        "straight_line_distance_km": round(straight_km, 2),
        "distance_km": round(straight_km, 2),
        "road_distance_km": None,
        "travel_time_min": round(estimated_minutes, 2),
        "routing_mode": "HAVERSINE_ESTIMATE",
        "notice": "No connected road path was available; this is a straight-line distance and illustrative speed estimate, not a live road ETA.",
    }
