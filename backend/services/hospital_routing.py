
import json
import math
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


OSRM_BASE_URL = os.getenv(
    "OSRM_BASE_URL",
    "https://router.project-osrm.org",
).rstrip("/")

OSRM_TIMEOUT_SECONDS = 8


class HospitalRoutingError(Exception):
    """Raised when a hospital cannot be selected safely."""


def _coordinates(document):
    """Extract and validate latitude and longitude."""

    if not isinstance(document, dict):
        return None

    location = document.get("location") or {}

    if not isinstance(location, dict):
        return None

    if location.get("type") == "Point":
        coords = location.get("coordinates") or []

        if not isinstance(coords, (list, tuple)) or len(coords) < 2:
            return None

        longitude, latitude = coords[0], coords[1]
    else:
        latitude = location.get(
            "latitude",
            location.get("lat", document.get("latitude")),
        )
        longitude = location.get(
            "longitude",
            location.get(
                "lng",
                location.get("lon", document.get("longitude")),
            ),
        )

    try:
        if latitude is None or longitude is None:
            return None

        latitude = float(latitude)
        longitude = float(longitude)

    except (TypeError, ValueError, OverflowError):
        return None

    if not (
        math.isfinite(latitude)
        and math.isfinite(longitude)
        and -90 <= latitude <= 90
        and -180 <= longitude <= 180
    ):
        return None

    return latitude, longitude


def _eligible(hospital):
    """Only consider hospitals explicitly marked available."""

    return (
        hospital.get("emergency_available") is True
        and hospital.get("staff_available") is True
        and hospital.get("status") == "AVAILABLE"
    )


def _get_json(url):
    """Make a request to the OSRM routing service."""

    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "BtechAccidentResponse/1.0",
        },
    )

    try:
        with urlopen(
            request,
            timeout=OSRM_TIMEOUT_SECONDS,
        ) as response:
            result = json.loads(response.read().decode("utf-8"))

        if not isinstance(result, dict):
            raise ValueError("Unexpected OSRM response format.")

        return result

    except (
        HTTPError,
        URLError,
        TimeoutError,
        OSError,
        ValueError,
    ) as exc:
        raise HospitalRoutingError(
            "Road routing service is unavailable. "
            "No hospital was automatically assigned."
        ) from exc


def haversine_distance_km(lat1, lon1, lat2, lon2):
    """Calculate straight-line distance between GPS coordinates."""

    lat1, lon1, lat2, lon2 = map(
        math.radians,
        [lat1, lon1, lat2, lon2],
    )

    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1)
        * math.cos(lat2)
        * math.sin(dlon / 2) ** 2
    )

    a = max(0.0, min(1.0, a))

    return 6371.0 * 2 * math.asin(math.sqrt(a))



def select_nearest_hospital_by_road_time(
    accident_location,
    hospitals,
    max_candidates=None,
):
    """
    Shortlist the nearest eligible hospitals using GPS coordinates,
    compare their OSRM road distance and travel time, and recommend
    the hospital with the shortest estimated road travel time.
    """

    accident = _coordinates(accident_location)

    if accident is None:
        raise HospitalRoutingError(
            "The accident has no valid latitude/longitude."
        )

    accident_lat, accident_lon = accident
    candidates = []

    # 1. Find eligible hospitals and calculate GPS distances.
    for hospital in hospitals:
        if not isinstance(hospital, dict):
            continue

        if not _eligible(hospital):
            continue

        position = _coordinates(hospital)

        if position is None or not hospital.get("hospital_id"):
            continue

        hospital_lat, hospital_lon = position

        straight_distance = haversine_distance_km(
            accident_lat,
            accident_lon,
            hospital_lat,
            hospital_lon,
        )

        candidates.append({
            "hospital": hospital,
            "position": position,
            "straight_distance_km": straight_distance,
        })

    if not candidates:
        raise HospitalRoutingError(
            "No eligible hospital with valid coordinates was found."
        )
    # 2. Compare every eligible hospital by default.
    # Straight-line distance is useful for reporting, but must not
    # exclude a hospital that may have a faster road route.
    candidates.sort(key=lambda item: item["straight_distance_km"])
    # Retain the optional limit only for callers that explicitly need it.
    if max_candidates is not None:
        candidates = candidates[:max(1, int(max_candidates))]


    # 3. Ask OSRM to compare road distance and travel time.
    coordinates = [f"{accident_lon},{accident_lat}"]

    for item in candidates:
        latitude, longitude = item["position"]
        coordinates.append(f"{longitude},{latitude}")

    query = urlencode({
        "sources": "0",
        "destinations": ";".join(
            str(i) for i in range(1, len(coordinates))
        ),
        "annotations": "duration,distance",
    })

    url = (
        f"{OSRM_BASE_URL}/table/v1/driving/"
        f"{';'.join(coordinates)}?{query}"
    )

    result = _get_json(url)

    if result.get("code") != "Ok":
        raise HospitalRoutingError(
            "OSRM could not compare hospital road routes."
        )

    durations = result.get("durations") or []
    distances = result.get("distances") or []

    if not durations or not durations[0] or not distances or not distances[0]:
        raise HospitalRoutingError(
            "OSRM did not return road distances and travel times."
        )

    ranked = []

    for index, item in enumerate(candidates):
        duration = (
            durations[0][index]
            if index < len(durations[0])
            else None
        )
        distance = (
            distances[0][index]
            if index < len(distances[0])
            else None
        )

        if duration is None or distance is None:
            continue

        try:
            duration = float(duration)
            distance = float(distance)
        except (TypeError, ValueError, OverflowError):
            continue

        if not (
            math.isfinite(duration)
            and math.isfinite(distance)
            and duration >= 0
            and distance >= 0
        ):
            continue

        hospital = item["hospital"]
        hospital_lat, hospital_lon = item["position"]

        ranked.append({
            "hospital": hospital,
            "hospital_id": hospital["hospital_id"],
            "hospital_name": hospital.get("name", "Unknown Hospital"),
            "latitude": hospital_lat,
            "longitude": hospital_lon,
            "straight_line_distance_km": round(
                item["straight_distance_km"], 2
            ),
            "road_distance_km": round(distance / 1000, 2),
            "eta_seconds": round(duration),
            "eta_minutes": round(duration / 60, 1),
        })

    if not ranked:
        raise HospitalRoutingError(
            "None of the shortlisted hospitals has a valid road route."
        )

    # 4. Rank hospitals by road travel time, then road distance.
    ranked.sort(
        key=lambda item: (
            item["eta_seconds"],
            item["road_distance_km"],
        )
    )

    comparisons = []

    for rank, item in enumerate(ranked, start=1):
        comparisons.append({
            "rank": rank,
            "hospital_id": item["hospital_id"],
            "hospital_name": item["hospital_name"],
            "latitude": item["latitude"],
            "longitude": item["longitude"],
            "straight_line_distance_km": item[
                "straight_line_distance_km"
            ],
            "road_distance_km": item["road_distance_km"],
            "eta_seconds": item["eta_seconds"],
            "eta_minutes": item["eta_minutes"],
            "recommended": rank == 1,
        })

    # 5. Select the fastest hospital and get its road geometry.
    best = ranked[0]
    route_coordinates = None

    try:
        route_result = get_road_route(
            accident_location,
            best["hospital"],
        )
        route_coordinates = route_result["coordinates"]
    except HospitalRoutingError:
        # Keep the comparison results even if map geometry fails.
        route_coordinates = None

    return {
        "hospital": best["hospital"],
        "candidate_hospitals": [
            item["hospital"] for item in ranked
        ],
        "comparisons": comparisons,
        "road_distance_km": best["road_distance_km"],
        "straight_line_distance_km": best[
            "straight_line_distance_km"
        ],
        "eta_seconds": best["eta_seconds"],
        "eta_minutes": best["eta_minutes"],
        "duration_seconds": best["eta_seconds"],
        "route": route_coordinates,
    }


def get_road_route(accident_location, hospital):
    """
    Return road geometry for React Leaflet.

    Output coordinates use [latitude, longitude].
    OSRM GeoJSON input coordinates use [longitude, latitude].
    """

    accident = _coordinates(accident_location)
    destination = _coordinates(hospital)

    if accident is None:
        raise HospitalRoutingError(
            "Invalid accident latitude/longitude."
        )

    if destination is None:
        raise HospitalRoutingError(
            "Invalid hospital latitude/longitude."
        )

    accident_lat, accident_lon = accident
    hospital_lat, hospital_lon = destination

    coordinates = (
        f"{accident_lon},{accident_lat};"
        f"{hospital_lon},{hospital_lat}"
    )

    query = urlencode({
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
    })

    url = (
        f"{OSRM_BASE_URL}/route/v1/driving/"
        f"{coordinates}?{query}"
    )

    result = _get_json(url)

    if result.get("code") != "Ok":
        raise HospitalRoutingError(
            "OSRM could not calculate the road route."
        )

    routes = result.get("routes") or []

    if not routes:
        raise HospitalRoutingError(
            "No driving route was found."
        )

    route = routes[0]
    geometry = route.get("geometry") or {}

    if geometry.get("type") != "LineString":
        raise HospitalRoutingError(
            "Invalid route geometry returned by OSRM."
        )

    points = geometry.get("coordinates") or []
    leaflet_coordinates = []

    for point in points:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue

        try:
            longitude = float(point[0])
            latitude = float(point[1])
        except (TypeError, ValueError, OverflowError):
            continue

        if (
            math.isfinite(latitude)
            and math.isfinite(longitude)
            and -90 <= latitude <= 90
            and -180 <= longitude <= 180
        ):
            leaflet_coordinates.append([latitude, longitude])

    if len(leaflet_coordinates) < 2:
        raise HospitalRoutingError(
            "Insufficient valid road-route coordinates."
        )

    try:
        distance_meters = float(route["distance"])
        duration_seconds = float(route["duration"])
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise HospitalRoutingError(
            "Invalid road distance or travel time."
        ) from exc

    if not (
        math.isfinite(distance_meters)
        and math.isfinite(duration_seconds)
        and distance_meters >= 0
        and duration_seconds >= 0
    ):
        raise HospitalRoutingError(
            "Invalid road distance or travel time."
        )

    return {
        "coordinates": leaflet_coordinates,
        "distance_km": round(distance_meters / 1000, 2),
        "duration_seconds": round(duration_seconds),
        "eta_minutes": round(duration_seconds / 60, 1),
    }

