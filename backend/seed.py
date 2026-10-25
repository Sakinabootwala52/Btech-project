from database.mongo import init_db, cameras_collection, hospitals_collection
from config import Config

CAMERAS = [
    {"camera_id":"CAM_001","name":"Main Road Camera","latitude":18.5204,"longitude":73.8567,"location_name":"Main Road","stream_url":"sample_videos/traffic_01.mp4","status":"ACTIVE"},
    {"camera_id":"CAM_002","name":"University Road Camera","latitude":18.5310,"longitude":73.8440,"location_name":"University Road","stream_url":"sample_videos/traffic_02.mp4","status":"ACTIVE"}
]
# Pune facilities and resource figures are demonstration data, not verified live inventories.
# Coordinates are approximate map pins intended for the prototype.
HOSPITALS = [
    {"hospital_id":"PUN-H001","name":"Sassoon General Hospital","address":"Station Road area, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5204,"longitude":73.8718,"contact":"demo-sassoon","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":5,"large_ambulances":4,"emergency_staff":34,"emergency_units":3,"beds_available":42}},
    {"hospital_id":"PUN-H002","name":"Deenanath Mangeshkar Hospital","address":"Erandwane, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA","PEDIATRIC"],"latitude":18.4936,"longitude":73.8500,"contact":"demo-deenanath","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":4,"large_ambulances":3,"emergency_staff":28,"emergency_units":3,"beds_available":31}},
    {"hospital_id":"PUN-H003","name":"Jehangir Hospital","address":"Sassoon Road, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5289,"longitude":73.8765,"contact":"demo-jehangir","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":3,"large_ambulances":3,"emergency_staff":24,"emergency_units":2,"beds_available":26}},
    {"hospital_id":"PUN-H004","name":"Ruby Hall Clinic","address":"Sassoon Road area, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA","BURN"],"latitude":18.5322,"longitude":73.8767,"contact":"demo-rubyhall","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":4,"large_ambulances":4,"emergency_staff":30,"emergency_units":3,"beds_available":35}},
    {"hospital_id":"PUN-H005","name":"Poona Hospital and Research Centre","address":"Sadashiv Peth, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5134,"longitude":73.8510,"contact":"demo-poona","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":2,"large_ambulances":2,"emergency_staff":18,"emergency_units":2,"beds_available":20}},
    {"hospital_id":"PUN-H006","name":"Sahyadri Super Speciality Hospital, Deccan","address":"Deccan Gymkhana, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA","PEDIATRIC"],"latitude":18.5158,"longitude":73.8380,"contact":"demo-sahyadri","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":3,"large_ambulances":2,"emergency_staff":22,"emergency_units":2,"beds_available":24}},
    {"hospital_id":"PUN-H007","name":"Noble Hospital","address":"Hadapsar, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA"],"latitude":18.5018,"longitude":73.9260,"contact":"demo-noble","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":3,"large_ambulances":2,"emergency_staff":20,"emergency_units":2,"beds_available":22}},
    {"hospital_id":"PUN-H008","name":"Manipal Hospital, Kharadi","address":"Kharadi, Pune, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA","PEDIATRIC"],"latitude":18.5510,"longitude":73.9440,"contact":"demo-manipal","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":3,"large_ambulances":2,"emergency_staff":21,"emergency_units":2,"beds_available":23}},
    {"hospital_id":"PUN-H009","name":"Aditya Birla Memorial Hospital","address":"Pimpri-Chinchwad, Pune district, Maharashtra (approximate demo location)","facility_type":"HOSPITAL","capabilities":["FIRST_AID","EMERGENCY","TRAUMA","BURN"],"latitude":18.6270,"longitude":73.8030,"contact":"demo-aditya-birla","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":4,"large_ambulances":3,"emergency_staff":27,"emergency_units":3,"beds_available":30}},
    {"hospital_id":"PUN-C010","name":"Demo First Aid Clinic - Shivajinagar","address":"Shivajinagar, Pune, Maharashtra (approximate demo location)","facility_type":"CLINIC","capabilities":["FIRST_AID"],"latitude":18.5308,"longitude":73.8470,"contact":"demo-clinic","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":0,"large_ambulances":0,"emergency_staff":4,"emergency_units":1,"beds_available":2}},
    {"hospital_id":"PUN-C011","name":"Demo First Aid Clinic - Deccan","address":"Deccan Gymkhana, Pune, Maharashtra (approximate demo location)","facility_type":"CLINIC","capabilities":["FIRST_AID"],"latitude":18.5165,"longitude":73.8415,"contact":"demo-clinic-deccan","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":0,"large_ambulances":0,"emergency_staff":3,"emergency_units":1,"beds_available":1}},
    {"hospital_id":"PUN-C012","name":"Demo First Aid Clinic - Camp","address":"Camp area, Pune, Maharashtra (approximate demo location)","facility_type":"CLINIC","capabilities":["FIRST_AID"],"latitude":18.5130,"longitude":73.8790,"contact":"demo-clinic-camp","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":0,"large_ambulances":0,"emergency_staff":4,"emergency_units":1,"beds_available":2}},
    {"hospital_id":"PUN-C013","name":"Demo First Aid Clinic - Erandwane","address":"Erandwane, Pune, Maharashtra (approximate demo location)","facility_type":"CLINIC","capabilities":["FIRST_AID"],"latitude":18.4985,"longitude":73.8440,"contact":"demo-clinic-erandwane","emergency_available":True,"staff_available":True,"status":"AVAILABLE","resources":{"small_ambulances":0,"large_ambulances":0,"emergency_staff":3,"emergency_units":1,"beds_available":1}},
]


def seed():
    init_db(Config.MONGO_URI, Config.MONGO_DB_NAME)
    for camera in CAMERAS:
        cameras_collection().update_one({"camera_id":camera["camera_id"]},{"$set":camera},upsert=True)
    # Remove only the original sample-only facility IDs replaced by the Pune seed.
    hospitals_collection().delete_many({"hospital_id": {"$in": ["H001", "H002", "H003", "C001"]}})
    for hospital in HOSPITALS:
        hospitals_collection().update_one({"hospital_id":hospital["hospital_id"]},{"$set":hospital},upsert=True)
    print("Seed data inserted successfully.")

if __name__ == "__main__": seed()
