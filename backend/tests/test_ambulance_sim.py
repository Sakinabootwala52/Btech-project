"""End-to-end test of the ambulance simulation lifecycle.

Runs against an in-memory MongoDB (mongomock), so no database is needed:
    pip install mongomock
    python -m unittest tests.test_ambulance_sim

Skipped automatically when mongomock is not installed.
"""
import unittest
from datetime import datetime, timezone

try:
    import mongomock
except ImportError:  # pragma: no cover
    mongomock = None


@unittest.skipUnless(mongomock, "mongomock is not installed")
class AmbulanceSimulationFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import database.mongo as mongo
        mongo.MongoClient = mongomock.MongoClient
        from app import create_app
        cls.app = create_app()
        cls.app.config["TESTING"] = True
        cls.mongo = mongo

    def setUp(self):
        db = self.mongo.get_db()
        for name in ["cameras", "hospitals", "incidents", "ambulances", "attendance"]:
            db[name].delete_many({})
        db.cameras.insert_one({"camera_id": "CAM_001", "name": "Main Road Camera", "latitude": 18.5204, "longitude": 73.8567, "location_name": "Main Road", "status": "ACTIVE"})
        for hid, name, lat, lng in [("H001", "City Emergency Hospital", 18.5230, 73.8500), ("H003", "Metro Care Hospital", 18.5400, 73.8700)]:
            db.hospitals.insert_one({"hospital_id": hid, "name": name, "facility_type": "HOSPITAL", "capabilities": ["FIRST_AID", "EMERGENCY", "TRAUMA"], "latitude": lat, "longitude": lng, "emergency_available": True, "staff_available": True, "status": "AVAILABLE", "resources": {"small_ambulances": 2, "large_ambulances": 1, "emergency_staff": 8, "beds_available": 10}})
        db.ambulances.insert_one({"ambulance_id": "AMB-01", "hospital_id": "H001", "hospital_name": "City Emergency Hospital", "vehicle_type": "BLS", "status": "AVAILABLE", "incident_id": None})

    def login(self, client, role, username):
        response = client.post("/api/auth/login", json={"role": role, "username": username, "password": "1234"})
        self.assertEqual(response.status_code, 200, response.get_json())

    def dispatched_incident(self):
        """Create an incident, have H001 accept it and dispatch AMB-01."""
        machine = self.app.test_client()
        response = machine.post("/api/detect-accident", json={
            "camera_id": "CAM_001",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "confidence": 0.95,
            "severity": "HIGH",
        })
        self.assertIn(response.status_code, (200, 201), response.get_json())
        incident_id = response.get_json()["incident"]["incident_id"]
        hospital = self.app.test_client()
        self.login(hospital, "hospital", "City Emergency Hospital")
        response = hospital.post(f"/api/incidents/{incident_id}/accept")
        self.assertEqual(response.status_code, 200, response.get_json())
        response = hospital.post(f"/api/incidents/{incident_id}/dispatch")
        self.assertEqual(response.status_code, 200, response.get_json())
        self.assertEqual(response.get_json()["ambulance_id"], "AMB-01")
        return incident_id, hospital

    def test_full_trip_lifecycle(self):
        incident_id, hospital = self.dispatched_incident()
        crew = self.app.test_client()
        self.login(crew, "ambulance", "ambulance")

        rows = crew.get("/api/ambulance-sim/assignments").get_json()
        self.assertEqual(rows["active_count"], 1)
        self.assertEqual(rows["ambulances"][0]["incident"]["incident_id"], incident_id)
        self.assertEqual(rows["ambulances"][0]["hospital"]["hospital_id"], "H001")

        # Position before starting is rejected.
        early = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 18.52, "longitude": 73.85, "phase": "TO_SCENE"})
        self.assertEqual(early.status_code, 409)

        started = crew.post("/api/ambulance-sim/AMB-01/start", json={"route_source": "road", "route_distance_km": 1.4})
        self.assertEqual(started.status_code, 200, started.get_json())
        self.assertEqual(started.get_json()["incident"]["status"], "EN_ROUTE")
        self.assertEqual(started.get_json()["ambulance"]["status"], "EN_ROUTE")

        for step in range(3):
            moved = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 18.523 - step * 0.001, "longitude": 73.851 + step * 0.002, "phase": "TO_SCENE", "progress": step / 3, "speed_kmh": 40, "remaining_km": 1.0, "eta_seconds": 90})
            self.assertEqual(moved.status_code, 200, moved.get_json())

        tracked = hospital.get(f"/api/ambulance-sim/track/{incident_id}").get_json()
        self.assertEqual(tracked["tracking"]["phase"], "TO_SCENE")
        self.assertEqual(tracked["tracking"]["updates"], 3)
        self.assertEqual(len(tracked["tracking"]["trail"]), 3)
        self.assertEqual(tracked["tracking"]["position"]["source"], "SIMULATION")

        arrived = crew.post("/api/ambulance-sim/AMB-01/arrive-scene")
        self.assertEqual(arrived.status_code, 200, arrived.get_json())
        self.assertEqual(arrived.get_json()["incident"]["status"], "ARRIVED")

        # Cannot complete before transporting.
        self.assertEqual(crew.post("/api/ambulance-sim/AMB-01/complete").status_code, 409)

        departed = crew.post("/api/ambulance-sim/AMB-01/depart-scene", json={"route_source": "road", "route_distance_km": 1.4})
        self.assertEqual(departed.status_code, 200, departed.get_json())
        self.assertEqual(departed.get_json()["ambulance"]["status"], "TRANSPORTING")

        moved = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 18.522, "longitude": 73.851, "phase": "TO_HOSPITAL", "source": "GPS"})
        self.assertEqual(moved.status_code, 200, moved.get_json())

        done = crew.post("/api/ambulance-sim/AMB-01/complete")
        self.assertEqual(done.status_code, 200, done.get_json())
        self.assertEqual(done.get_json()["incident"]["status"], "RESOLVED")
        self.assertEqual(done.get_json()["ambulance"]["status"], "AVAILABLE")
        self.assertIsNone(done.get_json()["ambulance"]["incident_id"])

        # Ambulance can be dispatched again afterwards.
        incident_two, _ = self.dispatched_incident()
        self.assertNotEqual(incident_two, incident_id)

    def test_permissions(self):
        incident_id, _ = self.dispatched_incident()
        live = self.app.test_client()
        self.login(live, "live", "live")
        self.assertEqual(live.post("/api/ambulance-sim/AMB-01/start").status_code, 403)
        self.assertEqual(live.get(f"/api/ambulance-sim/track/{incident_id}").status_code, 403)

        other_hospital = self.app.test_client()
        self.login(other_hospital, "hospital", "Metro Care Hospital")
        self.assertEqual(other_hospital.get(f"/api/ambulance-sim/track/{incident_id}").status_code, 403)
        self.assertEqual(other_hospital.post("/api/ambulance-sim/AMB-01/start").status_code, 403)

        anonymous = self.app.test_client()
        self.assertEqual(anonymous.get("/api/ambulance-sim/assignments").status_code, 401)

    def test_hospital_manual_arrival_still_allows_transport(self):
        incident_id, hospital = self.dispatched_incident()
        crew = self.app.test_client()
        self.login(crew, "ambulance", "ambulance")
        crew.post("/api/ambulance-sim/AMB-01/start")
        # Hospital presses its own "Mark Arrived" button mid-trip.
        self.assertEqual(hospital.put(f"/api/incidents/{incident_id}/status", json={"status": "ARRIVED"}).status_code, 200)
        stale = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 18.52, "longitude": 73.85, "phase": "TO_SCENE"})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(crew.post("/api/ambulance-sim/AMB-01/depart-scene").status_code, 200)
        self.assertEqual(crew.post("/api/ambulance-sim/AMB-01/complete").get_json()["incident"]["status"], "RESOLVED")

    def test_invalid_position_rejected(self):
        self.dispatched_incident()
        crew = self.app.test_client()
        self.login(crew, "ambulance", "ambulance")
        crew.post("/api/ambulance-sim/AMB-01/start")
        bad = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": "abc", "longitude": 73.85, "phase": "TO_SCENE"})
        self.assertEqual(bad.status_code, 400)
        bad = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 95, "longitude": 73.85, "phase": "TO_SCENE"})
        self.assertEqual(bad.status_code, 400)
        bad = crew.post("/api/ambulance-sim/AMB-01/position", json={"latitude": 18.5, "longitude": 73.85, "phase": "TO_HOSPITAL"})
        self.assertEqual(bad.status_code, 409)


if __name__ == "__main__":
    unittest.main()
