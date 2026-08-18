from database.mongo import hospitals_collection
from services.distance_service import haversine_distance_km
from utils.serializers import serialize_document

def get_available_hospitals():
    hospitals = hospitals_collection().find({
        "emergency_available": True,
        "staff_available": True,
        "status": "AVAILABLE"
    })

    return [serialize_document(h) for h in hospitals]

def find_nearest_available_hospital(latitude, longitude):
    hospitals = get_available_hospitals()

    if not hospitals:
        return None

    ranked = []

    for hospital in hospitals:
        distance = haversine_distance_km(
            latitude,
            longitude,
            hospital["latitude"],
            hospital["longitude"]
        )

        hospital["distance_km"] = round(distance, 2)
        ranked.append(hospital)

    ranked.sort(key=lambda item: item["distance_km"])
    return ranked[0]
