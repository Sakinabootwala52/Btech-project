"""Idempotent development seed data.

IMPORTANT: the hospital/clinic entries below are DEMO facilities for local
development, not verified real-world availability. Replace/verify facility
records and register real ambulances before using this as real operational data.
"""
from database.mongo import (
    init_db, cameras_collection, hospitals_collection
)
from config import Config

CAMERAS = [
    {"camera_id": "CAM_001", "name": "Main Road Camera", "latitude": 18.5204, "longitude": 73.8567, "location_name": "Main Road, Pune (demo)", "stream_url": "clip_01.mp4", "source_type": "SIMULATED_VIDEO", "status": "ACTIVE"},
    {"camera_id": "CAM_002", "name": "University Road Camera", "latitude": 18.5310, "longitude": 73.8440, "location_name": "University Road, Pune (demo)", "stream_url": "clip_02.mp4", "source_type": "SIMULATED_VIDEO", "status": "ACTIVE"},
    {"camera_id": "CAM_003", "name": "Central Junction Camera", "latitude": 18.5074, "longitude": 73.8077, "location_name": "Central Junction, Pune (demo)", "stream_url": "clip_03.mp4", "source_type": "SIMULATED_VIDEO", "status": "ACTIVE"},
    {"camera_id": "CAM_004", "name": "East Corridor Camera", "latitude": 18.5400, "longitude": 73.8700, "location_name": "East Corridor, Pune (demo)", "stream_url": "clip_04.mp4", "source_type": "SIMULATED_VIDEO", "status": "ACTIVE"},
]

# These are explicitly demo-only records, retained for the existing college demo.
HOSPITALS = [
    {"hospital_id":"H001","name":"City Emergency Hospital (DEMO)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5230,"longitude":73.8500,"contact":"DEMO ONLY","emergency_available":True,"staff_available":True,"status":"AVAILABLE","data_source":"DEMO","resources":{"small_ambulances":2,"large_ambulances":1,"emergency_staff":8,"beds_available":10}},
    {"hospital_id":"H002","name":"Central Trauma Hospital (DEMO)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5074,"longitude":73.8077,"contact":"DEMO ONLY","emergency_available":True,"staff_available":False,"status":"UNAVAILABLE","data_source":"DEMO","resources":{"small_ambulances":1,"large_ambulances":2,"emergency_staff":6,"beds_available":4}},
    {"hospital_id":"H003","name":"Metro Care Hospital (DEMO)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5400,"longitude":73.8700,"contact":"DEMO ONLY","emergency_available":True,"staff_available":True,"status":"AVAILABLE","data_source":"DEMO","resources":{"small_ambulances":3,"large_ambulances":1,"emergency_staff":10,"beds_available":12}},
    {"hospital_id":"C001","name":"Demo First Aid Clinic (DEMO)","facility_type":"CLINIC","capabilities":["FIRST_AID"],"latitude":18.5260,"longitude":73.8620,"contact":"DEMO ONLY","emergency_available":True,"staff_available":True,"status":"AVAILABLE","data_source":"DEMO","resources":{"small_ambulances":0,"large_ambulances":0,"emergency_staff":2,"beds_available":0}}
]

def seed():
    init_db(Config.MONGO_URI, Config.MONGO_DB_NAME)
    for camera in CAMERAS:
        cameras_collection().update_one({"camera_id": camera["camera_id"]}, {"$setOnInsert": camera}, upsert=True)
    for hospital in HOSPITALS:
        hospitals_collection().update_one({"hospital_id": hospital["hospital_id"]}, {"$setOnInsert": hospital}, upsert=True)
    print("Development seed checked: missing simulated cameras and DEMO-only facilities were inserted; existing records were not overwritten.")
    print("No ambulance records were fabricated. Register verified ambulances in the admin UI.")

if __name__ == "__main__":
    seed()
