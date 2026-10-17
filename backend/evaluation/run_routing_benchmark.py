"""Run from backend/: python evaluation/run_routing_benchmark.py"""
import csv, json, sys
from pathlib import Path
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))
from services.routing_benchmark import benchmark_network, sample_road_network

OUT = Path(__file__).resolve().parent
result = benchmark_network(sample_road_network())
(OUT / "routing_benchmark_results.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
with (OUT / "routing_benchmark_cases.csv").open("w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=["start","goal","dijkstra_cost_min","astar_cost_min","dijkstra_nodes","astar_nodes","dijkstra_ms","astar_ms","optimal_cost_matches"])
    writer.writeheader()
    for case in result["cases"]:
        writer.writerow({"start":case["start"],"goal":case["goal"],"dijkstra_cost_min":case["dijkstra"]["travel_time_min"],"astar_cost_min":case["astar"]["travel_time_min"],"dijkstra_nodes":case["dijkstra"]["nodes_expanded"],"astar_nodes":case["astar"]["nodes_expanded"],"dijkstra_ms":case["dijkstra"]["execution_ms"],"astar_ms":case["astar"]["execution_ms"],"optimal_cost_matches":case["optimal_cost_matches"]})
print(json.dumps({k:v for k,v in result.items() if k != "cases"}, indent=2))
print(f"\nWrote: {OUT / 'routing_benchmark_results.json'}")
print(f"Wrote: {OUT / 'routing_benchmark_cases.csv'}")
