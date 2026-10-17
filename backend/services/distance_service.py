from math import radians, sin, cos, sqrt, atan2

EARTH_RADIUS_KM = 6371.0

def haversine_distance_km(lat1, lon1, lat2, lon2):
    """
    Calculate geographic distance between two latitude/longitude points.
    """
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))

    return EARTH_RADIUS_KM * c
