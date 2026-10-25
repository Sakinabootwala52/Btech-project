
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./AmbulanceSimulation.css";
import { api } from "../api";

const DEFAULT_CENTER = [18.5204, 73.8567];
const ROUTE_STEPS = 24;
const STEP_DELAY_MS = 700;
const REFRESH_INTERVAL_MS = 5000;

// Parse supported API, MongoDB, and GeoJSON coordinate formats.
const toPoint = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 5) {
    return null;
  }

  if (value.type === "Feature" && value.geometry) {
    return toPoint(value.geometry, depth + 1);
  }

  if (
    value.type === "Point" &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2
  ) {
    const [longitude, latitude] = value.coordinates;
    return toPoint({ latitude, longitude }, depth + 1);
  }

  if (
    value.geometry?.type === "Point" &&
    Array.isArray(value.geometry.coordinates)
  ) {
    return toPoint(value.geometry, depth + 1);
  }

  if (
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2
  ) {
    const [longitude, latitude] = value.coordinates;
    return toPoint({ latitude, longitude }, depth + 1);
  }

  if (Array.isArray(value) && value.length >= 2) {
    // Plain arrays in this application use [latitude, longitude].
    return toPoint(
      { latitude: value[0], longitude: value[1] },
      depth + 1
    );
  }

  const nestedKeys = [
    "location",
    "gps",
    "position",
    "coordinates",
    "geometry",
  ];

  for (const key of nestedKeys) {
    const nested = value[key];

    if (nested && nested !== value && typeof nested === "object") {
      const point = toPoint(nested, depth + 1);
      if (point) return point;
    }
  }

  const rawLatitude = value.latitude ?? value.lat;
  const rawLongitude = value.longitude ?? value.lng ?? value.lon;

  if (
    rawLatitude === null ||
    rawLatitude === undefined ||
    rawLongitude === null ||
    rawLongitude === undefined ||
    rawLatitude === "" ||
    rawLongitude === ""
  ) {
    return null;
  }

  const latitude = Number(rawLatitude);
  const longitude = Number(rawLongitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return null;
  }

  return { latitude, longitude };
};

// Saved Leaflet route arrays use [latitude, longitude].
// Object coordinates are also supported.
const toRouteCoordinates = (value) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((point) => {
      if (Array.isArray(point) && point.length >= 2) {
        const latitude = Number(point[0]);
        const longitude = Number(point[1]);

        if (
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180 &&
          !(latitude === 0 && longitude === 0)
        ) {
          return [latitude, longitude];
        }

        return null;
      }

      const parsed = toPoint(point);

      return parsed
        ? [parsed.latitude, parsed.longitude]
        : null;
    })
    .filter(Boolean);
};

const mapPosition = (point) =>
  point ? [point.latitude, point.longitude] : null;

const formatNumber = (value, digits = 2) =>
  value === null ||
  value === undefined ||
  value === "" ||
  !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toFixed(digits);

const titleCase = (value) =>
  String(value || "UNKNOWN")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const hospitalIcon = L.divIcon({
  className: "ambulance-map-icon",
  html: '<div class="hospital-pin">H</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

const accidentIcon = L.divIcon({
  className: "ambulance-map-icon",
  html: '<div class="accident-pin">!</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

const ambulanceIcon = L.divIcon({
  className: "ambulance-map-icon",
  html: '<div class="ambulance-pin">🚑</div>',
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

function MapRecenter({ points }) {
  const map = useMap();

  useEffect(() => {
    const validPoints = points.filter(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every(Number.isFinite)
    );

    if (validPoints.length === 0) return;

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 14);
      return;
    }

    map.fitBounds(validPoints, {
      padding: [35, 35],
      maxZoom: 15,
    });
  }, [map, points]);

  return null;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Request a road route from the public OSRM service.
async function getRoadRoute(start, end) {
  if (!start || !end) {
    throw new Error(
      "The assigned incident and hospital must both have valid coordinates."
    );
  }

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${start.longitude},${start.latitude};` +
    `${end.longitude},${end.latitude}` +
    "?overview=full&geometries=geojson&steps=false";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      "The road-routing service is unavailable. Please try again."
    );
  }

  const data = await response.json();
  const route = data.routes?.[0];

  if (
    data.code !== "Ok" ||
    !route ||
    !Array.isArray(route.geometry?.coordinates) ||
    route.geometry.coordinates.length < 2
  ) {
    throw new Error(
      "No road route was found. Check the saved incident and hospital coordinates."
    );
  }

  return {
    // OSRM uses [longitude, latitude].
    // Leaflet uses [latitude, longitude].
    coordinates: route.geometry.coordinates.map(
      ([longitude, latitude]) => [latitude, longitude]
    ),
    distanceKm: route.distance / 1000,
    durationMinutes: route.duration / 60,
    source: "OSRM",
  };
}

function getAssignmentId(row) {
  return row?.ambulance?.ambulance_id || "";
}

function getIncidentPoint(row) {
  return toPoint(row?.incident?.location) || toPoint(row?.incident);
}

function getHospitalPoint(row) {
  return toPoint(row?.hospital?.location) || toPoint(row?.hospital);
}

function getSavedRoute(tracking) {
  const phase = tracking?.phase;

  const savedRoute =
    phase === "TO_HOSPITAL" || phase === "COMPLETED"
      ? tracking?.return_route_coordinates ||
        tracking?.route_coordinates
      : tracking?.route_coordinates;

  const coordinates = toRouteCoordinates(savedRoute);

  if (coordinates.length < 2) return null;

  const distanceValue =
    phase === "TO_HOSPITAL" || phase === "COMPLETED"
      ? tracking?.return_route_distance_km ??
        tracking?.route_distance_km
      : tracking?.route_distance_km;

  const durationValue =
    phase === "TO_HOSPITAL" || phase === "COMPLETED"
      ? tracking?.return_route_duration_minutes ??
        tracking?.route_duration_minutes
      : tracking?.route_duration_minutes;

  const distanceKm =
    distanceValue === null ||
    distanceValue === undefined ||
    distanceValue === ""
      ? null
      : Number(distanceValue);

  const durationMinutes =
    durationValue === null ||
    durationValue === undefined ||
    durationValue === ""
      ? null
      : Number(durationValue);

  return {
    coordinates,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
    durationMinutes: Number.isFinite(durationMinutes)
      ? durationMinutes
      : null,
    source:
      phase === "TO_HOSPITAL" || phase === "COMPLETED"
        ? tracking?.return_route_source ||
          tracking?.route_source ||
          "SAVED"
        : tracking?.route_source || "SAVED",
  };
}

export default function AmbulanceSimulation() {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [backendConnected, setBackendConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [progress, setProgress] = useState(0);
  const [activity, setActivity] = useState([]);
  const [hospitalReached, setHospitalReached] = useState(false);

  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAssignments = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setLoading(true);
      setError("");
    }

    try {
      const response = await api.ambulanceSim.assignments();

      if (!mountedRef.current) return;

      const rows = Array.isArray(response?.ambulances)
        ? response.ambulances
        : [];

      setBackendConnected(true);
      setAssignments(rows);

      setSelectedId((current) => {
        if (
          current &&
          rows.some((row) => getAssignmentId(row) === current)
        ) {
          return current;
        }

        const assigned = rows.find(
          (row) => row?.ambulance?.incident_id && row?.incident
        );

        return getAssignmentId(assigned || rows[0]) || "";
      });
    } catch (err) {
      if (!mountedRef.current) return;

      setBackendConnected(false);

      if (showLoading) {
        setError(
          err?.message ||
            "Could not load ambulance assignments. Check your Flask server and API connection."
        );
      }

      console.error("Could not load ambulance assignments:", err);
    } finally {
      if (mountedRef.current && showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Initial load.
  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  // Refresh assignments every five seconds, but not during a trip.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (busyRef.current || !mountedRef.current) return;
      loadAssignments(false);
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [loadAssignments]);

  const selected = useMemo(
    () =>
      assignments.find(
        (row) => getAssignmentId(row) === selectedId
      ) || null,
    [assignments, selectedId]
  );

  const ambulance = selected?.ambulance || null;
  const incident = selected?.incident || null;
  const hospital = selected?.hospital || null;

  const incidentPoint = getIncidentPoint(selected);
  const hospitalPoint = getHospitalPoint(selected);

  const tracking =
    incident?.tracking ||
    incident?.ambulance_tracking ||
    ambulance?.tracking ||
    {};

  const trackingPosition = toPoint(tracking?.position);

  const ambulanceStoredPosition =
    toPoint(ambulance?.last_position) ||
    toPoint(ambulance?.current_position) ||
    toPoint(ambulance?.location);

  // Do not invent an ambulance position.
  const currentPosition =
    vehiclePosition || trackingPosition || ambulanceStoredPosition;

  const mapPoints = useMemo(
    () =>
      [
        mapPosition(incidentPoint),
        mapPosition(hospitalPoint),
        mapPosition(currentPosition),
      ].filter(Boolean),
    [
      incidentPoint?.latitude,
      incidentPoint?.longitude,
      hospitalPoint?.latitude,
      hospitalPoint?.longitude,
      currentPosition?.latitude,
      currentPosition?.longitude,
    ]
  );

  // Restore a saved route when the selected assignment changes.
  useEffect(() => {
    if (busy) return;

    const savedRoute = getSavedRoute(tracking);

    if (savedRoute) {
      setRouteCoordinates(savedRoute.coordinates);
      setRouteInfo(savedRoute);

      const savedProgress = Number(tracking?.progress);

      setProgress(
        Number.isFinite(savedProgress)
          ? Math.max(
              0,
              Math.min(100, Math.round(savedProgress * 100))
            )
          : 0
      );

      setHospitalReached(
        tracking?.phase === "TO_HOSPITAL" &&
          Number.isFinite(savedProgress) &&
          savedProgress >= 1
      );
    } else {
      setRouteCoordinates([]);
      setRouteInfo(null);
      setProgress(0);
      setHospitalReached(false);
    }
  }, [
    selectedId,
    tracking?.phase,
    tracking?.progress,
    tracking?.route_coordinates,
    tracking?.route_distance_km,
    tracking?.route_duration_minutes,
    tracking?.route_source,
    tracking?.return_route_coordinates,
    tracking?.return_route_distance_km,
    tracking?.return_route_duration_minutes,
    tracking?.return_route_source,
    busy,
  ]);

  const addActivity = useCallback((text) => {
    setActivity((items) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          text,
          time: new Date().toLocaleTimeString(),
        },
        ...items,
      ].slice(0, 8)
    );
  }, []);

  const refreshAfterAction = useCallback(async () => {
    const response = await api.ambulanceSim.assignments();

    if (!mountedRef.current) return;

    const rows = Array.isArray(response?.ambulances)
      ? response.ambulances
      : [];

    setBackendConnected(true);
    setAssignments(rows);
  }, []);

  // Animate the ambulance along the road route and save every position.
  const animateLeg = useCallback(
    async ({ ambulanceId, route, phase }) => {
      const coordinates = route.coordinates;
      const total = coordinates.length;

      if (total < 2) {
        throw new Error(
          "The selected road route has no usable coordinates."
        );
      }

      setRouteCoordinates(coordinates);
      setRouteInfo(route);
      setProgress(0);

      const indices = Array.from(
        new Set(
          Array.from(
            { length: ROUTE_STEPS + 1 },
            (_, index) =>
              Math.round(
                (index / ROUTE_STEPS) * (total - 1)
              )
          )
        )
      );

      for (let step = 0; step < indices.length; step += 1) {
        const index = indices[step];
        const [latitude, longitude] = coordinates[index];

        const fraction =
          index / Math.max(total - 1, 1);

        setVehiclePosition({ latitude, longitude });
        setProgress(Math.round(fraction * 100));

        const distanceKm = Number(route.distanceKm);
        const durationMinutes = Number(route.durationMinutes);

        const remainingKm = Number.isFinite(distanceKm)
          ? distanceKm * (1 - fraction)
          : null;

        const etaSeconds = Number.isFinite(durationMinutes)
          ? durationMinutes * 60 * (1 - fraction)
          : null;

        // Keep the existing Flask position endpoint.
        // If this request fails, stop and show the error.
        await api.ambulanceSim.position(ambulanceId, {
          latitude,
          longitude,
          phase,
          source: "SIMULATION",
          progress: fraction,
          speed_kmh: 25,
          remaining_km: remainingKm,
          eta_seconds: etaSeconds,
        });

        if (step < indices.length - 1) {
          await delay(STEP_DELAY_MS);
        }
      }

      setProgress(100);

      const [latitude, longitude] =
        coordinates[coordinates.length - 1];

      setVehiclePosition({ latitude, longitude });
    },
    []
  );

  const startTrip = async () => {
    if (busy) return;

    if (!selected || !ambulance?.ambulance_id) {
      setError("Select an ambulance assignment first.");
      return;
    }

    if (!incidentPoint || !hospitalPoint) {
      setError(
        "This assignment is missing valid incident or hospital coordinates. Update the saved records first."
      );
      return;
    }

    if (!["DISPATCHED", "EN_ROUTE"].includes(incident?.status)) {
      setError(
        `The trip to the accident cannot start from incident status ${
          incident?.status || "UNKNOWN"
        }. Dispatch the ambulance first.`
      );
      return;
    }

    if (
      tracking?.phase === "TO_SCENE" ||
      tracking?.phase === "TO_HOSPITAL"
    ) {
      setError(
        "A trip is already in progress. Continue the existing trip instead of starting it again."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setHospitalReached(false);

    try {
      // Hospital -> accident scene.
      const route = await getRoadRoute(
        hospitalPoint,
        incidentPoint
      );

      await api.ambulanceSim.start(ambulance.ambulance_id, {
        source: "SIMULATION",
        route_source: "OSRM",
        route_coordinates: route.coordinates,
        route_distance_km: route.distanceKm,
        route_duration_minutes: route.durationMinutes,
      });

      setVehiclePosition(hospitalPoint);

      addActivity(
        `${ambulance.ambulance_id} started toward incident ${incident.incident_id}.`
      );

      await animateLeg({
        ambulanceId: ambulance.ambulance_id,
        route,
        phase: "TO_SCENE",
      });

      await api.ambulanceSim.arriveScene(
        ambulance.ambulance_id
      );

      setVehiclePosition(incidentPoint);
      setMessage("Ambulance arrived at the accident scene.");

      addActivity(
        `Ambulance arrived at ${incident.incident_id}.`
      );

      await refreshAfterAction();
    } catch (err) {
      setError(
        err?.message ||
          "Could not complete the trip to the accident."
      );

      await refreshAfterAction().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const transportToHospital = async () => {
    if (busy) return;

    if (!selected || !ambulance?.ambulance_id) {
      setError("Select an ambulance assignment first.");
      return;
    }

    if (!incidentPoint || !hospitalPoint) {
      setError("The incident or hospital coordinates are missing.");
      return;
    }

    if (
      incident?.status !== "ARRIVED" ||
      tracking?.phase === "COMPLETED"
    ) {
      setError(
        "Transport can start after the ambulance reaches the accident scene."
      );
      return;
    }

    if (tracking?.phase === "TO_HOSPITAL") {
      setError("Hospital transport has already started.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    setHospitalReached(false);

    try {
      // Accident scene -> assigned hospital.
      const route = await getRoadRoute(
        incidentPoint,
        hospitalPoint
      );

      await api.ambulanceSim.departScene(
        ambulance.ambulance_id,
        {
          route_source: "OSRM",
          route_coordinates: route.coordinates,
          route_distance_km: route.distanceKm,
          route_duration_minutes: route.durationMinutes,
        }
      );

      setVehiclePosition(incidentPoint);

      addActivity(
        `Transport started from incident ${incident.incident_id} to ${
          hospital?.name || "the assigned hospital"
        }.`
      );

      await animateLeg({
        ambulanceId: ambulance.ambulance_id,
        route,
        phase: "TO_HOSPITAL",
      });

      setVehiclePosition(hospitalPoint);
      setHospitalReached(true);

      setMessage(
        "The ambulance reached the hospital. Complete the trip to release the ambulance."
      );

      addActivity(
        `Ambulance reached ${
          hospital?.name || "the assigned hospital"
        }.`
      );

      await refreshAfterAction();
    } catch (err) {
      setError(
        err?.message ||
          "Could not complete hospital transport."
      );

      await refreshAfterAction().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const completeTrip = async () => {
    if (busy) return;

    if (!ambulance?.ambulance_id) {
      setError("No ambulance is selected.");
      return;
    }

    if (!hospitalReached) {
      setError(
        "Complete the trip to the hospital before releasing the ambulance."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api.ambulanceSim.complete(
        ambulance.ambulance_id
      );

      setMessage(
        "Trip completed. The ambulance is now available."
      );

      addActivity(
        `Trip completed for ${
          incident?.incident_id || "incident"
        }.`
      );

      setProgress(100);
      setHospitalReached(false);

      await refreshAfterAction();
    } catch (err) {
      setError(
        err?.message ||
          "Could not complete the ambulance trip."
      );
    } finally {
      setBusy(false);
    }
  };

  const incidentStatus =
    incident?.status || "NO ACTIVE INCIDENT";

  const ambulanceStatus = ambulance?.status || "UNKNOWN";
  const phase = tracking?.phase || "NOT STARTED";

  const canStart =
    !!ambulance?.ambulance_id &&
    ["DISPATCHED", "EN_ROUTE"].includes(incident?.status) &&
    !["TO_SCENE", "TO_HOSPITAL", "COMPLETED"].includes(phase);

  const canTransport =
    incident?.status === "ARRIVED" &&
    phase !== "TO_HOSPITAL" &&
    phase !== "COMPLETED";

  const canComplete =
    incident?.status === "ARRIVED" &&
    phase === "TO_HOSPITAL" &&
    hospitalReached;

  const hasCoordinates =
    !!incidentPoint && !!hospitalPoint;

  const trackingPoint = toPoint(tracking?.position);

  return (
    <div className="ambulance-page">
      <header className="ambulance-header">
        <div>
          <div className="ambulance-eyebrow">
            EMERGENCY RESPONSE SYSTEM
          </div>
          <h1>Ambulance Command Center</h1>
        </div>

        <div className="ambulance-live-status">
          <span className="status-dot" />
          {loading
            ? "LOADING DATA"
            : !backendConnected
              ? "BACKEND UNAVAILABLE"
              : assignments.length === 0
                ? "CONNECTED · NO RECORDS"
                : "CONNECTED · LIVE UPDATES"}
        </div>
      </header>

      <section className="ambulance-stats">
        <article className="ambulance-stat">
          <span>Ambulance ID</span>
          <strong>
            {ambulance?.ambulance_id || "—"}
          </strong>
        </article>

        <article className="ambulance-stat">
          <span>Incident ID</span>
          <strong>
            {incident?.incident_id || "No assignment"}
          </strong>
        </article>

        <article className="ambulance-stat">
          <span>Severity</span>
          <strong className="severity-high">
            {titleCase(incident?.severity)}
          </strong>
        </article>

        <article className="ambulance-stat">
          <span>Ambulance status</span>
          <strong>{titleCase(ambulanceStatus)}</strong>
        </article>
      </section>

      {error && (
        <div className="side-panel" role="alert">
          <strong>Action needed</strong>
          <p>{error}</p>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setError("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {message && (
        <div className="side-panel" role="status">
          {message}
        </div>
      )}

      <main className="ambulance-layout">
        <section className="map-panel">
          <div className="panel-heading">
            <div>
              <h2>Ambulance Tracking Map</h2>
            </div>

            <button
              type="button"
              className="secondary-action"
              onClick={() => loadAssignments()}
              disabled={loading || busy}
            >
              {loading ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>

          <div
            className="ambulance-map"
            style={{ height: 480, width: "100%" }}
          >
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={12}
              scrollWheelZoom
              style={{ height: "100%", width: "100%" }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <MapRecenter points={mapPoints} />

              {incidentPoint && (
                <Marker
                  position={mapPosition(incidentPoint)}
                  icon={accidentIcon}
                >
                  <Popup>
                    <strong>
                      Accident: {incident?.incident_id || "Unknown"}
                    </strong>
                    <br />
                    Severity: {titleCase(incident?.severity)}
                    <br />
                    Status: {titleCase(incident?.status)}
                    <br />
                    {incidentPoint.latitude},{" "}
                    {incidentPoint.longitude}
                  </Popup>
                </Marker>
              )}

              {hospitalPoint && (
                <Marker
                  position={mapPosition(hospitalPoint)}
                  icon={hospitalIcon}
                >
                  <Popup>
                    <strong>
                      {hospital?.name || "Assigned hospital"}
                    </strong>
                    <br />
                    Hospital ID: {hospital?.hospital_id || "—"}
                    <br />
                    {hospitalPoint.latitude},{" "}
                    {hospitalPoint.longitude}
                  </Popup>
                </Marker>
              )}

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

              {currentPosition && (
                <Marker
                  position={mapPosition(currentPosition)}
                  icon={ambulanceIcon}
                >
                  <Popup>
                    <strong>
                      {ambulance?.ambulance_id || "Ambulance"}
                    </strong>
                    <br />
                    Status: {titleCase(ambulanceStatus)}
                    <br />
                    Phase: {titleCase(phase)}
                    <br />
                    {currentPosition.latitude},{" "}
                    {currentPosition.longitude}
                  </Popup>
                </Marker>
              )}

              {trackingPoint && (
                <CircleMarker
                  center={mapPosition(trackingPoint)}
                  radius={5}
                  pathOptions={{
                    color: "#15803d",
                    fillOpacity: 0.7,
                  }}
                >
                  <Popup>
                    Latest position saved by the backend
                  </Popup>
                </CircleMarker>
              )}
            </MapContainer>
          </div>

          <div className="map-legend">
            <span>! Accident</span>
            <span>H Hospital</span>
            <span>🚑 Ambulance</span>
            <span>Blue line: OSRM road route</span>
          </div>

          {!incidentPoint &&
            !hospitalPoint &&
            !currentPosition && (
              <p className="empty-notifications">
                No mapped assignment data is available. Create an
                incident, register a hospital and ambulance, and
                dispatch the ambulance. This map does not invent
                marker locations.
              </p>
            )}

          <p className="map-disclaimer">
            Map markers use coordinates returned by your backend.
            The ambulance marker appears only when a saved or
            simulated position exists. OSRM supplies road geometry
            and estimated duration, not live traffic conditions.
          </p>
        </section>

        <aside className="ambulance-sidebar">
          <section className="side-panel">
            <h2>Ambulance Assignments</h2>

            {loading ? (
              <p>Loading assignments from the backend…</p>
            ) : assignments.length === 0 ? (
              <p className="empty-notifications">
                No ambulance records were returned. Register an
                ambulance and dispatch it to an incident first.
              </p>
            ) : (
              <label className="assignment-select-label">
                Select ambulance
                <select
                  value={selectedId}
                  onChange={(event) => {
                    setSelectedId(event.target.value);
                    setRouteCoordinates([]);
                    setRouteInfo(null);
                    setVehiclePosition(null);
                    setProgress(0);
                    setHospitalReached(false);
                    setError("");
                    setMessage("");
                  }}
                  disabled={busy}
                >
                  {assignments.map((row, index) => {
                    const id = getAssignmentId(row);

                    return (
                      <option
                        key={id || `assignment-${index}`}
                        value={id}
                      >
                        {id || "Unnamed ambulance"} —{" "}
                        {row?.incident?.incident_id || "Unassigned"} (
                        {titleCase(row?.ambulance?.status)})
                      </option>
                    );
                  })}
                </select>
              </label>
            )}

            {selected && (
              <>
                <div className="selected-hospital-summary">
                  <span>Assigned incident</span>
                  <strong>
                    {incident?.incident_id || "No incident"}
                  </strong>
                  <p>Status: {titleCase(incidentStatus)}</p>
                  <small>
                    Severity: {titleCase(incident?.severity)} ·
                    Camera: {incident?.camera_id || "—"}
                  </small>
                </div>

                <div className="selected-hospital-summary">
                  <span>Destination hospital</span>
                  <strong>
                    {hospital?.name || "No hospital assigned"}
                  </strong>
                  <p>
                    Hospital ID: {hospital?.hospital_id || "—"}
                  </p>
                  <small>
                    {hospitalPoint
                      ? `${hospitalPoint.latitude}, ${hospitalPoint.longitude}`
                      : "Hospital coordinates are missing"}
                  </small>
                </div>

                {!hasCoordinates && (
                  <p role="alert">
                    This assignment cannot be routed until both
                    the incident and hospital have valid
                    latitude/longitude coordinates.
                  </p>
                )}

                <button
                  type="button"
                  className="primary-action"
                  onClick={startTrip}
                  disabled={
                    busy || loading || !canStart || !hasCoordinates
                  }
                >
                  {busy
                    ? "Processing trip…"
                    : "Start Trip to Accident"}
                </button>

                <button
                  type="button"
                  className="secondary-action"
                  onClick={transportToHospital}
                  disabled={
                    busy ||
                    loading ||
                    !canTransport ||
                    !hasCoordinates
                  }
                >
                  Transport to Hospital
                </button>

                <button
                  type="button"
                  className="secondary-action"
                  onClick={completeTrip}
                  disabled={busy || loading || !canComplete}
                >
                  Complete Trip
                </button>
              </>
            )}
          </section>

          <section className="side-panel incident-panel">
            <h2>Trip Details</h2>

            <div className="detail-row">
              <span>Incident status</span>
              <strong>{titleCase(incidentStatus)}</strong>
            </div>

            <div className="detail-row">
              <span>Tracking phase</span>
              <strong>{titleCase(phase)}</strong>
            </div>

            <div className="detail-row">
              <span>Route distance</span>
              <strong>
                {routeInfo?.distanceKm != null
                  ? `${formatNumber(routeInfo.distanceKm)} km`
                  : "—"}
              </strong>
            </div>

            <div className="detail-row">
              <span>Estimated road time</span>
              <strong>
                {routeInfo?.durationMinutes != null
                  ? `${Math.ceil(routeInfo.durationMinutes)} min`
                  : "—"}
              </strong>
            </div>

            <div className="detail-row">
              <span>Position source</span>
              <strong>
                {titleCase(
                  tracking?.source ||
                    ambulance?.last_position?.source ||
                    (vehiclePosition
                      ? "SIMULATION"
                      : "NO POSITION")
                )}
              </strong>
            </div>

            <div className="detail-row">
              <span>Route source</span>
              <strong>
                {titleCase(
                  routeInfo?.source ||
                    tracking?.return_route_source ||
                    tracking?.route_source ||
                    "NO SAVED ROUTE"
                )}
              </strong>
            </div>

            <div className="detail-row">
              <span>Route progress</span>
              <strong>{progress}%</strong>
            </div>

            <div
              className="progress-track"
              role="progressbar"
              aria-label="Ambulance route progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </section>

          <section className="side-panel">
            <h2>Activity &amp; Notifications</h2>

            {activity.length === 0 ? (
              <p className="empty-notifications">
                No trip activity yet. Start a dispatched ambulance
                trip to see updates here.
              </p>
            ) : (
              <ul className="notification-list">
                {activity.map((item) => (
                  <li key={item.id}>
                    <strong>{item.time}</strong>
                    <br />
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}
