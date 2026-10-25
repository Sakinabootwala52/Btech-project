import unittest
from services.routing_benchmark import benchmark_network, sample_road_network, shortest_path

class RoutingBenchmarkTests(unittest.TestCase):
    def test_astar_and_dijkstra_costs_match(self):
        result = benchmark_network(sample_road_network())
        self.assertTrue(result["all_optimal_costs_match"])
        self.assertGreater(result["case_count"], 0)

    def test_paths_begin_and_end_at_requested_nodes(self):
        graph = sample_road_network()
        result = shortest_path(graph, "N00", "N33", "astar")
        self.assertEqual(result["path"][0], "N00")
        self.assertEqual(result["path"][-1], "N33")
        self.assertTrue(result["reachable"])

    def test_unknown_node_rejected(self):
        with self.assertRaises(ValueError):
            shortest_path(sample_road_network(), "NOT-A-NODE", "N33", "astar")

if __name__ == "__main__":
    unittest.main()
