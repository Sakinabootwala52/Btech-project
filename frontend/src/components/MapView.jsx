
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Circle,
  Polyline,
  useMap,
} from "react-leaflet";

const DEFAULT_CENTER = [18.5204, 73.8567];
const DEFAULT_ZOOM = 13;

/**
 * Calculate straight-line distance in kilometres.
 */
function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  const safeA = Math.max(0, Math.min(1, a));

  return (
    2 *
    R *
    Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA))
  );
}

/**
 * Validate latitude and longitude.
 */
function isValidCoordinate(latitude, longitude) {
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    String(latitude).trim() === "" ||
    String(longitude).trim() === ""
  ) {
    return false;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Read coordinates from supported backend field formats.
 */
function getCoordinates(item) {
  const latitude =
    item?.latitude ??
    item?.location?.latitude ??
    item?.location?.lat ??
    item?.gps?.latitude ??
    item?.gps?.lat ??
    item?.coordinates?.latitude ??
    item?.coordinates?.lat;

  const longitude =
    item?.longitude ??
    item?.location?.longitude ??
    item?.location?.lng ??
    item?.gps?.longitude ??
    item?.gps?.lng ??
    item?.coordinates?.longitude ??
    item?.coordinates?.lng;

  if (!isValidCoordinate(latitude, longitude)) {
    return null;
  }

  return {
    lat: Number(latitude),
    lng: Number(longitude),
  };
}

/**
 * Recenter the existing map when the selected point changes.
 */
function MapRecenter({ center }) {
  const map = useMap();

  useEffect(() => {
    if (
      Array.isArray(center) &&
      center.length === 2 &&
      center.every(Number.isFinite)
    ) {
      map.setView(center, map.getZoom(), {
        animate: true,
      });
    }
  }, [center, map]);

  return null;
}

/**
 * Accident and hospital map.
 *
 * incidents: accident records received from the backend
 * hospitals: hospital records received from the backend
 * activeIncident: currently selected accident
 * recommendedHospital: hospital recommended by the backend
 */
export default function MapView({
  incidents = [],
  hospitals = [],
  height = 360,
  activeIncident = null,
  recommendedHospital = null,
}) {
  /*
   * Temporary diagnostic logs.
   * Check the browser console to verify actual backend data.
   */
  useEffect(() => {
    console.log("MapView - incidents received:", incidents);
    console.log("MapView - hospitals received:", hospitals);
    console.log("MapView - active incident:", activeIncident);
  }, [incidents, hospitals, activeIncident]);

  /*
   * Normalize incident data.
   */
  const incidentPoints = useMemo(() => {
    if (!Array.isArray(incidents)) {
      return [];
    }

    return incidents
      .map((item, index) => {
        const coordinates = getCoordinates(item);

        if (!coordinates) {
          return null;
        }

        return {
          ...coordinates,
          id:
            item?.incident_id ??
            item?._id ??
            `incident-${index}`,
          title:
            item?.incident_id ??
            item?._id ??
            "Accident",
          cameraId: item?.camera_id ?? "UNKNOWN",
          severity:
            item?.severity?.level ??
            item?.severity ??
            "UNKNOWN",
          confidence: Number(item?.confidence ?? 0),
        };
      })
      .filter(Boolean);
  }, [incidents]);

  /*
   * Normalize the selected accident.
   */
  const accidentPoint = useMemo(() => {
    if (!activeIncident) {
      return null;
    }

    const coordinates = getCoordinates(activeIncident);

    if (!coordinates) {
      return null;
    }

    return {
      ...coordinates,
      id:
        activeIncident.incident_id ??
        activeIncident._id ??
        null,
    };
  }, [activeIncident]);

  /*
   * Normalize hospital data.
   */
  const hospitalPoints = useMemo(() => {
    if (!Array.isArray(hospitals)) {
      return [];
    }

    return hospitals
      .map((hospital, index) => {
        const coordinates = getCoordinates(hospital);

        if (!coordinates) {
          return null;
        }

        const isRecommended =
          recommendedHospital?.hospital_id != null &&
          hospital?.hospital_id != null &&
          String(recommendedHospital.hospital_id) ===
            String(hospital.hospital_id);

        const smallAmbulances = Number(
          hospital?.resources?.small_ambulances ?? 0
        );
        const largeAmbulances = Number(
          hospital?.resources?.large_ambulances ?? 0
        );

        return {
          ...hospital,
          ...coordinates,
          markerId:
            hospital?.hospital_id ??
            hospital?._id ??
            `hospital-${index}`,
          title:
            hospital?.name ??
            hospital?.hospital_name ??
            "Hospital",
          status: hospital?.status ?? "UNKNOWN",
          beds: Number(
            hospital?.beds ??
              hospital?.available_beds ??
              hospital?.resources?.beds_available ??
              0
          ),
          ambulances: Number(
            hospital?.ambulances ??
              hospital?.available_ambulances ??
              smallAmbulances + largeAmbulances
          ),
          isRecommended,
        };
      })
      .filter(Boolean);
  }, [hospitals, recommendedHospital]);

  /*
   * Road route supplied by the backend.
   * Expected format: [[latitude, longitude], ...]
   */
  const routeCoordinates = useMemo(() => {
    const route = activeIncident?.route_coordinates;

    if (!Array.isArray(route)) {
      return [];
    }

    return route
      .filter(
        (point) =>
          Array.isArray(point) &&
          point.length >= 2 &&
          isValidCoordinate(point[0], point[1])
      )
      .map((point) => [
        Number(point[0]),
        Number(point[1]),
      ]);
  }, [activeIncident]);

  /*
   * Choose a useful map center.
   */
  const center = useMemo(() => {
    if (accidentPoint) {
      return [accidentPoint.lat, accidentPoint.lng];
    }

    if (incidentPoints.length > 0) {
      return [
        incidentPoints[0].lat,
        incidentPoints[0].lng,
      ];
    }

    if (hospitalPoints.length > 0) {
      return [
        hospitalPoints[0].lat,
        hospitalPoints[0].lng,
      ];
    }

    return DEFAULT_CENTER;
  }, [accidentPoint, incidentPoints, hospitalPoints]);

  return (
    <div
      className="map-wrapper"
      style={{
        height,
        width: "100%",
        position: "relative",
      }}
    >
      <MapContainer
        center={center}
        zoom={DEFAULT_ZOOM}
        scrollWheelZoom
        style={{
          height: "100%",
          width: "100%",
        }}
      >
        <MapRecenter center={center} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Road route returned by the backend */}
        {routeCoordinates.length >= 2 && (
          <Polyline
            positions={routeCoordinates}
            pathOptions={{
              color: "#2563eb",
              weight: 5,
              opacity: 0.85,
            }}
          />
        )}

        {/* Selected accident */}
        {accidentPoint && (
          <>
            <Marker
              position={[
                accidentPoint.lat,
                accidentPoint.lng,
              ]}
            >
              <Popup>
                <strong>🚨 Accident Detected</strong>
                <br />
                Camera: {activeIncident?.camera_id ?? "UNKNOWN"}
                <br />
                Severity:{" "}
                {activeIncident?.severity?.level ??
                  activeIncident?.severity ??
                  "UNKNOWN"}
                <br />
                Confidence:{" "}
                {Math.round(
                  Number(activeIncident?.confidence ?? 0) * 100
                )}
                %
              </Popup>
            </Marker>

            <Circle
              center={[
                accidentPoint.lat,
                accidentPoint.lng,
              ]}
              radius={500}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: 0.08,
              }}
            />
          </>
        )}

        {/* Other accidents from the incidents prop */}
        {incidentPoints
          .filter(
            (point) =>
              !accidentPoint ||
              String(point.id) !== String(accidentPoint.id)
          )
          .map((point) => (
            <Marker
              key={point.id}
              position={[point.lat, point.lng]}
            >
              <Popup>
                <strong>📍 {point.title}</strong>
                <br />
                Camera: {point.cameraId}
                <br />
                Severity: {String(point.severity)}
                <br />
                Confidence:{" "}
                {Math.round(point.confidence * 100)}%
              </Popup>
            </Marker>
          ))}

        {/* Hospitals received from the backend */}
        {hospitalPoints.map((hospital) => {
          const distance = accidentPoint
            ? distanceKm(
                accidentPoint.lat,
                accidentPoint.lng,
                hospital.lat,
                hospital.lng
              )
            : null;

          return (
            <Marker
              key={hospital.markerId}
              position={[hospital.lat, hospital.lng]}
            >
              <Popup>
                <strong>
                  {hospital.isRecommended ? "⭐ " : "🏥 "}
                  {hospital.title}
                </strong>
                <br />
                Hospital ID:{" "}
                {hospital.hospital_id ?? "N/A"}
                <br />
                Status: {hospital.status}
                <br />
                Beds available: {hospital.beds}
                <br />
                Ambulances: {hospital.ambulances}
                {distance !== null && (
                  <>
                    <br />
                    Straight-line distance:{" "}
                    {distance.toFixed(2)} km
                  </>
                )}
                {hospital.isRecommended && (
                  <>
                    <br />
                    <strong>Recommended Hospital</strong>
                  </>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
