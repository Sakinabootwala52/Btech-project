from pymongo import MongoClient, ASCENDING, DESCENDING

_client = None
_db = None

def init_db(uri: str, db_name: str):
    global _client, _db
    _client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    _client.admin.command("ping")
    _db = _client[db_name]

    _db.cameras.create_index([("camera_id", ASCENDING)], unique=True)
    _db.hospitals.create_index([("hospital_id", ASCENDING)], unique=True)
    _db.incidents.create_index([("incident_id", ASCENDING)], unique=True)
    _db.incidents.create_index([("timestamp", DESCENDING)])
    _db.incidents.create_index([("status", ASCENDING), ("timestamp", DESCENDING)])
    _db.incidents.create_index([("hospital_id", ASCENDING), ("timestamp", DESCENDING)])
    _db.attendance.create_index([("hospital_id", ASCENDING), ("accepted_at", DESCENDING)])
    _db.attendance.create_index([("incident_id", ASCENDING)], unique=True)
    _db.ambulances.create_index([("ambulance_id", ASCENDING)], unique=True)
    _db.ambulances.create_index([("hospital_id", ASCENDING), ("status", ASCENDING)])
    # MongoDB automatically creates the unique _id index; do not recreate it.
    return _db

def get_db():
    if _db is None:
        raise RuntimeError("Database has not been initialized.")
    return _db

def cameras_collection(): return get_db()["cameras"]
def hospitals_collection(): return get_db()["hospitals"]
def incidents_collection(): return get_db()["incidents"]
def attendance_collection(): return get_db()["attendance"]


def ambulances_collection(): return get_db()["ambulances"]
def road_network_collection(): return get_db()["road_network"]
