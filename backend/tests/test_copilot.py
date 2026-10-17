import unittest
from unittest.mock import patch
from services.copilot_service import explain_incident, retrieve_sources

class CopilotTests(unittest.TestCase):
    def test_fallback_is_grounded_and_cites_sources_without_api_key(self):
        with patch.dict('os.environ', {}, clear=True):
            result = explain_incident(
                {"incident_id": "SIM-1", "status": "PENDING", "severity": "HIGH", "evidence": {"speed_drop": True}},
                [{"facility_id": "H1", "name": "Demo Hospital", "matched_capability": "TRAUMA",
                  "route": {"travel_time_min": 4.2, "distance_km": 2.1, "routing_mode": "ROAD_GRAPH"},
                  "available_ambulances": 1}],
                "Why this hospital?",
            )
        self.assertEqual(result["mode"], "grounded_template")
        self.assertIn("SIM-1", result["answer"])
        self.assertTrue(result["citations"])
        self.assertIn("not proof", result["answer"])

    def test_retrieval_returns_source_ids_and_urls(self):
        sources = retrieve_sources("shortest path emergency response vehicle")
        self.assertTrue(sources)
        self.assertTrue(all("id" in item and "url" in item for item in sources))

if __name__ == "__main__":
    unittest.main()
