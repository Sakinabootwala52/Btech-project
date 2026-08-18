from database.mongo import init_db, cameras_collection, hospitals_collection
from config import Config

CAMERAS = [
    {"camera_id":"CAM_001","name":"Main Road Camera","latitude":18.5204,"longitude":73.8567,"location_name":"Main Road","stream_url":"sample_videos/traffic_01.mp4","status":"ACTIVE"},
    {"camera_id":"CAM_002","name":"University Road Camera","latitude":18.5310,"longitude":73.8440,"location_name":"University Road","stream_url":"sample_videos/traffic_02.mp4","status":"ACTIVE"}
]
HOSPITALS = [
    {"hospital_id":"H001","name":"City Emergency Hospital","latitude":18.5230,"longitude":73.8500,"contact":"demo-h001","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":2,"large_ambulances":1,"emergency_staff":8,"beds_available":10}},
    {"hospital_id":"H002","name":"Central Trauma Hospital","latitude":18.5074,"longitude":73.8077,"contact":"demo-h002","emergency_available":True,"staff_available":False,"status":"UNAVAILABLE","resources":{"small_ambulances":1,"large_ambulances":2,"emergency_staff":6,"beds_available":4}},
    {"hospital_id":"H003","name":"Metro Care Hospital","latitude":18.5400,"longitude":73.8700,"contact":"demo-h003","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":3,"large_ambulances":1,"emergency_staff":10,"beds_available":12}}
]

def seed():
    init_db(Config.MONGO_URI, Config.MONGO_DB_NAME)
    for camera in CAMERAS:
        cameras_collection().update_one({"camera_id":camera["camera_id"]},{"$set":camera},upsert=True)
    for hospital in HOSPITALS:
        hospitals_collection().update_one({"hospital_id":hospital["hospital_id"]},{"$set":hospital},upsert=True)
    print("Seed data inserted successfully.")

if __name__ == "__main__": seed()
