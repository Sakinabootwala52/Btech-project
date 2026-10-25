import unittest
from services.routing_service import estimate_route, validate_road_network
from services.dispatch_service import rank_facilities

NETWORK = {
    "nodes": [
        {"node_id": "A", "latitude": 18.5204, "longitude": 73.8567},
        {"node_id": "B", "latitude": 18.5230, "longitude": 73.8500},
        {"node_id": "C", "latitude": 18.5310, "longitude": 73.8440},
    ],
    "edges": [
        {"from": "A", "to": "B", "distance_km": 1.0, "travel_time_min": 2, "bidirectional": True},
        {"from": "B", "to": "C", "distance_km": 1.0, "travel_time_min": 3, "bidirectional": True},
        {"from": "A", "to": "C", "distance_km": 4.0, "travel_time_min": 10, "bidirectional": True},
    ],
}

class RoutingDispatchTests(unittest.TestCase):
    def test_graph_route_uses_lower_travel_time(self):
        route = estimate_route(NETWORK["nodes"][0], NETWORK["nodes"][2], NETWORK)
        self.assertEqual(route["routing_mode"], "ROAD_GRAPH")
        self.assertEqual(route["path"], ["A", "B", "C"])
        self.assertAlmostEqual(route["travel_time_min"], 5.0, delta=0.2)

    def test_fallback_is_explicit(self):
        route = estimate_route(NETWORK["nodes"][0], {"latitude": 18.54, "longitude": 73.87}, None)
        self.assertEqual(route["routing_mode"], "HAVERSINE_ESTIMATE")
        self.assertIn("not a live road ETA", route["notice"])

    def test_critical_incident_excludes_first_aid_only_clinic(self):
        incident = {"latitude": 18.5204, "longitude": 73.8567, "severity": "HIGH"}
        facilities = [
            {"hospital_id": "C1", "name": "Clinic", "facility_type": "CLINIC", "capabilities": ["FIRST_AID"], "latitude": 18.521, "longitude": 73.857, "status": "AVAILABLE", "emergency_available": True, "staff_available": True},
            {"hospital_id": "H1", "name": "Trauma Hospital", "facility_type": "HOSPITAL", "capabilities": ["TRAUMA", "EMERGENCY"], "latitude": 18.523, "longitude": 73.85, "status": "AVAILABLE", "emergency_available": True, "staff_available": True},
        ]
        result = rank_facilities(incident, facilities, NETWORK)
        self.assertEqual([x["facility_id"] for x in result["recommendations"]], ["H1"])

    def test_rejected_facility_is_skipped(self):
        incident = {"latitude": 18.5204, "longitude": 73.8567, "severity": "LOW", "rejected_hospitals": ["H1"]}
        facilities = [{"hospital_id": "H1", "name": "Hospital", "latitude": 18.523, "longitude": 73.85, "status": "AVAILABLE", "emergency_available": True, "staff_available": True}]
        result = rank_facilities(incident, facilities, None)
        self.assertEqual(result["recommendations"], [])

    def test_network_validation_rejects_unknown_edge_node(self):
        bad = {"nodes": [{"node_id": "A", "latitude": 0, "longitude": 0}], "edges": [{"from": "A", "to": "B", "distance_km": 1, "travel_time_min": 2}]}
        with self.assertRaises(ValueError): validate_road_network(bad)

if __name__ == "__main__":
    unittest.main()
