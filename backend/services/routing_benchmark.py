"""Reproducible Dijkstra vs A* benchmark for non-negative travel-time graphs."""
from heapq import heappush, heappop
from math import inf
from time import perf_counter
from services.distance_service import haversine_distance_km


def build_adjacency(network):
    nodes = {str(n["node_id"]): n for n in network.get("nodes", [])}
    graph = {node_id: [] for node_id in nodes}
    max_speed = 0.0
    heuristic_safe = True
    for edge in network.get("edges", []):
        a, b = str(edge["from"]), str(edge["to"])
        minutes = float(edge["travel_time_min"])
        distance = float(edge.get("distance_km", 0.0))
        if minutes <= 0 or distance < 0:
            raise ValueError("Routing requires non-negative distances and positive travel-time weights.")
        graph[a].append((b, minutes, distance))
        if edge.get("bidirectional", True):
            graph[b].append((a, minutes, distance))
        if distance > 0:
            max_speed = max(max_speed, distance / (minutes / 60.0))
        direct = haversine_distance_km(nodes[a]["latitude"], nodes[a]["longitude"], nodes[b]["latitude"], nodes[b]["longitude"])
        # A heuristic based on straight-line distance is admissible only if the supplied
        # edge distance does not understate the geometric distance between its endpoints.
        if distance + 1e-6 < direct:
            heuristic_safe = False
    return nodes, graph, max_speed, heuristic_safe


def _heuristic(node_id, goal_id, nodes, max_speed_kmh, safe):
    if not safe or max_speed_kmh <= 0:
        return 0.0
    a, b = nodes[node_id], nodes[goal_id]
    km = haversine_distance_km(a["latitude"], a["longitude"], b["latitude"], b["longitude"])
    return (km / max_speed_kmh) * 60.0


def shortest_path(network, start_id, goal_id, algorithm="dijkstra"):
    """Return path, cost, expansion count and wall time. algorithm is dijkstra or astar."""
    algorithm = algorithm.lower()
    if algorithm not in {"dijkstra", "astar"}:
        raise ValueError("algorithm must be 'dijkstra' or 'astar'.")
    nodes, graph, max_speed, safe = build_adjacency(network)
    start_id, goal_id = str(start_id), str(goal_id)
    if start_id not in nodes or goal_id not in nodes:
        raise ValueError("Start and goal must be node IDs in the road graph.")
    began = perf_counter()
    best = {node_id: inf for node_id in nodes}
    previous = {}
    best[start_id] = 0.0
    queue = [(0.0, 0.0, start_id)]
    expanded = 0
    while queue:
        _, cost, current = heappop(queue)
        if cost > best[current] + 1e-12:
            continue
        expanded += 1
        if current == goal_id:
            break
        for neighbor, weight, _distance in graph[current]:
            candidate = cost + weight
            if candidate + 1e-12 < best[neighbor]:
                best[neighbor] = candidate
                previous[neighbor] = current
                h = _heuristic(neighbor, goal_id, nodes, max_speed, safe) if algorithm == "astar" else 0.0
                heappush(queue, (candidate + h, candidate, neighbor))
    elapsed_ms = (perf_counter() - began) * 1000.0
    if best[goal_id] == inf:
        return {"path": [], "travel_time_min": None, "nodes_expanded": expanded,
                "execution_ms": round(elapsed_ms, 4), "reachable": False,
                "heuristic_used": bool(algorithm == "astar" and safe and max_speed > 0)}
    path = [goal_id]
    while path[-1] != start_id:
        path.append(previous[path[-1]])
    path.reverse()
    return {"path": path, "travel_time_min": round(best[goal_id], 6),
            "nodes_expanded": expanded, "execution_ms": round(elapsed_ms, 4),
            "reachable": True, "heuristic_used": bool(algorithm == "astar" and safe and max_speed > 0)}


def sample_road_network():
    """Small deterministic Pune-like grid; demo data, not a real road map."""
    base_lat, base_lon = 18.5204, 73.8567
    nodes = []
    for row in range(4):
        for col in range(4):
            nodes.append({"node_id": f"N{row}{col}", "latitude": base_lat + row * 0.004,
                          "longitude": base_lon + col * 0.004})
    edges = []
    # Neighbour links; variable travel times intentionally model differing road segments.
    for row in range(4):
        for col in range(4):
            here = f"N{row}{col}"
            if col < 3:
                edges.append({"from": here, "to": f"N{row}{col+1}", "distance_km": 0.55,
                              "travel_time_min": 1.5 + ((row + col) % 3) * 0.45, "bidirectional": True})
            if row < 3:
                edges.append({"from": here, "to": f"N{row+1}{col}", "distance_km": 0.58,
                              "travel_time_min": 1.6 + ((row * 2 + col) % 4) * 0.35, "bidirectional": True})
    # A faster diagonal corridor makes destination-guided search interesting.
    edges.extend([
        {"from": "N00", "to": "N11", "distance_km": 0.95, "travel_time_min": 1.65, "bidirectional": True},
        {"from": "N11", "to": "N22", "distance_km": 0.95, "travel_time_min": 1.7, "bidirectional": True},
        {"from": "N22", "to": "N33", "distance_km": 0.95, "travel_time_min": 1.75, "bidirectional": True},
        {"from": "N03", "to": "N12", "distance_km": 0.95, "travel_time_min": 1.8, "bidirectional": True},
        {"from": "N12", "to": "N21", "distance_km": 0.95, "travel_time_min": 1.8, "bidirectional": True},
        {"from": "N21", "to": "N30", "distance_km": 0.95, "travel_time_min": 1.9, "bidirectional": True},
    ])
    return {"nodes": nodes, "edges": edges, "label": "SYNTHETIC_DEMO_GRAPH_NOT_REAL_ROADS"}


def benchmark_network(network, cases=None):
    node_ids = [str(n["node_id"]) for n in network.get("nodes", [])]
    if cases is None:
        if len(node_ids) < 2:
            raise ValueError("Road graph must contain at least two nodes for a benchmark.")
        pairs = [(node_ids[0], node_ids[-1])]
        if len(node_ids) >= 4:
            pairs.extend([(node_ids[0], node_ids[len(node_ids)//2]),
                          (node_ids[1], node_ids[-2]), (node_ids[-1], node_ids[0])])
        cases = [{"start": a, "goal": b} for a, b in pairs if a != b]
    rows = []
    for case in cases:
        d = shortest_path(network, case["start"], case["goal"], "dijkstra")
        a = shortest_path(network, case["start"], case["goal"], "astar")
        same = (d["reachable"] == a["reachable"] and
                (not d["reachable"] or abs(d["travel_time_min"] - a["travel_time_min"]) <= 1e-6))
        rows.append({"start": case["start"], "goal": case["goal"], "dijkstra": d, "astar": a,
                     "optimal_cost_matches": same,
                     "nodes_expanded_reduction_pct": (round((d["nodes_expanded"]-a["nodes_expanded"])/d["nodes_expanded"]*100, 2) if d["nodes_expanded"] else 0)})
    def mean(items, key):
        values = [item[key] for item in items if item[key] is not None]
        return round(sum(values)/len(values), 4) if values else None
    return {"graph_label": network.get("label", "CONFIGURED_GRAPH"), "node_count": len(network.get("nodes", [])),
            "edge_count": len(network.get("edges", [])), "case_count": len(rows), "all_optimal_costs_match": all(r["optimal_cost_matches"] for r in rows),
            "averages": {"dijkstra_execution_ms": mean([r["dijkstra"] for r in rows], "execution_ms"),
                         "astar_execution_ms": mean([r["astar"] for r in rows], "execution_ms"),
                         "dijkstra_nodes_expanded": mean([r["dijkstra"] for r in rows], "nodes_expanded"),
                         "astar_nodes_expanded": mean([r["astar"] for r in rows], "nodes_expanded"),
                         "astar_nodes_expanded_reduction_pct": mean(rows, "nodes_expanded_reduction_pct")}, "cases": rows}
