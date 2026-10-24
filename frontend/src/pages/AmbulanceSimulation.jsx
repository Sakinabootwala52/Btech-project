
import { useCallback, useEffect, useMemo, useState } from "react";
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

const toPoint = (location) => {
  if (!location) return null;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }

  return { latitude, longitude };
};

const mapPosition = (point) =>
  point ? [point.latitude, point.longitude] : null;

const formatNumber = (value, digits = 2) =>
  Number.isFinite(Number(value))
    ? Number(value).toFixed(digits)
    : "—";

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
    const validPoints = points.filter(Boolean);
    if (!validPoints.length) return;

    if (validPoints.length === 1) {
      map.setView(validPoints[0], 14);
      return;
    }

    map.fitBounds(validPoints, { padding: [35, 35], maxZoom: 15 });
  }, [map, points]);

  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    throw new Error("The road-routing service could not calculate a route.");
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
      "No road route was found for these coordinates. Check the saved locations."
    );
  }

  return {
    // OSRM returns [longitude, latitude].
    coordinates: route.geometry.coordinates.map(([longitude, latitude]) => [
      latitude,
      longitude,
    ]),
    distanceKm: route.distance / 1000,
    durationMinutes: route.duration / 60,
  };
}

function getAssignmentId(row) {
  return row?.ambulance?.ambulance_id || "";
}

function getIncidentPoint(row) {
  return toPoint(row?.incident?.location);
}

function getHospitalPoint(row) {
  return toPoint(row?.hospital?.location);
}

export default function AmbulanceSimulation() {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [routeInfo, setRouteInfo] = useState(null);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [progress, setProgress] = useState(0);
  const [activity, setActivity] = useState([]);

  const loadAssignments = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await api.ambulanceSim.assignments();
      const rows = Array.isArray(response?.ambulances)
        ? response.ambulances
        : [];

      setAssignments(rows);

      setSelectedId((current) => {
        if (current && rows.some((row) => getAssignmentId(row) === current)) {
          return current;
        }

        const assigned = rows.find(
          (row) => row?.ambulance?.incident_id && row?.incident
        );

        return getAssignmentId(assigned || rows[0]) || "";
      });
    } catch (err) {
      setError(
        err.message ||
          "Could not load ambulance assignments. Check your login and Flask server."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  const selected = useMemo(
    () => assignments.find((row) => getAssignmentId(row) === selectedId) || null,
    [assignments, selectedId]
  );

  const ambulance = selected?.ambulance || null;
  const incident = selected?.incident || null;
  const hospital = selected?.hospital || null;

  const incidentPoint = getIncidentPoint(selected);
  const hospitalPoint = getHospitalPoint(selected);

  const tracking = incident?.tracking || {};
  const trackingPosition = toPoint(tracking?.position);

  const currentPosition =
    vehiclePosition ||
    trackingPosition ||
    (tracking?.phase === "TO_HOSPITAL" ||
    tracking?.phase === "COMPLETED"
      ? hospitalPoint
      : tracking?.phase === "AT_SCENE"
        ? incidentPoint
        : hospitalPoint);

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
    const rows = Array.isArray(response?.ambulances)
      ? response.ambulances
      : [];

    setAssignments(rows);
  }, []);
  useEffect(() => {
  const timer = window.setInterval(async () => {
    try {
      const response = await api.ambulanceSim.assignments();

      const rows = Array.isArray(response?.ambulances)
        ? response.ambulances
        : [];

      setAssignments(rows);
    } catch (err) {
      console.error("Could not refresh ambulance assignments:", err);
    }
  }, 5000);

  return () => window.clearInterval(timer);
}, []);

  const animateLeg = useCallback(
    async ({ ambulanceId, route, phase, startIndex = 0 }) => {
      const coordinates = route.coordinates;
      const total = coordinates.length;

      setRouteCoordinates(coordinates);
      setRouteInfo(route);
      setProgress(0);

      // Send fewer, evenly spaced points to the backend to avoid
      // excessive requests while keeping the marker moving smoothly.
      const indices = Array.from(
        new Set(
          Array.from({ length: ROUTE_STEPS + 1 }, (_, index) =>
            Math.round((index / ROUTE_STEPS) * (total - 1))
          )
        )
      ).filter((index) => index >= startIndex);

      for (let step = 0; step < indices.length; step += 1) {
        const index = indices[step];
        const [latitude, longitude] = coordinates[index];
        const fraction = index / Math.max(total - 1, 1);

        setVehiclePosition({ latitude, longitude });
        setProgress(Math.round(fraction * 100));

        const remainingKm = route.distanceKm * (1 - fraction);
        const etaSeconds = route.durationMinutes * 60 * (1 - fraction);

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
    },
    []
  );

  const startTrip = async () => {
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
        `The trip to the accident cannot start from incident status ${incident?.status || "UNKNOWN"}. Dispatch the ambulance first.`
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const route = await getRoadRoute(hospitalPoint, incidentPoint);

      await api.ambulanceSim.start(ambulance.ambulance_id, {
        source: "SIMULATION",
        route_source: "OSRM",
        route_distance_km: route.distanceKm,
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

      await api.ambulanceSim.arriveScene(ambulance.ambulance_id);

      setVehiclePosition(incidentPoint);
      setMessage("Ambulance arrived at the accident scene.");
      addActivity(`Ambulance arrived at ${incident.incident_id}.`);

      await refreshAfterAction();
    } catch (err) {
      setError(err.message || "Could not complete the trip to the accident.");
      await refreshAfterAction().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const transportToHospital = async () => {
    if (!selected || !ambulance?.ambulance_id) return;

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

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const route = await getRoadRoute(incidentPoint, hospitalPoint);

      await api.ambulanceSim.departScene(ambulance.ambulance_id, {
        route_source: "OSRM",
        route_distance_km: route.distanceKm,
      });

      setVehiclePosition(incidentPoint);
      addActivity(
        `Transport started from incident ${incident.incident_id} to ${hospital.name}.`
      );

      await animateLeg({
        ambulanceId: ambulance.ambulance_id,
        route,
        phase: "TO_HOSPITAL",
      });

      setVehiclePosition(hospitalPoint);
      setMessage(
        "The ambulance reached the hospital. Complete the trip to release the ambulance."
      );
      addActivity(`Ambulance reached ${hospital.name}.`);

      await refreshAfterAction();
    } catch (err) {
      setError(err.message || "Could not complete hospital transport.");
      await refreshAfterAction().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const completeTrip = async () => {
    if (!ambulance?.ambulance_id) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api.ambulanceSim.complete(ambulance.ambulance_id);
      setMessage("Trip completed. The ambulance is now available.");
      addActivity(`Trip completed for ${incident?.incident_id || "incident"}.`);

      setProgress(100);
      await refreshAfterAction();
    } catch (err) {
      setError(err.message || "Could not complete the ambulance trip.");
    } finally {
      setBusy(false);
    }
  };

  const incidentStatus = incident?.status || "NO ACTIVE INCIDENT";
  const ambulanceStatus = ambulance?.status || "UNKNOWN";
  const phase = tracking?.phase || "NOT STARTED";

  const canStart =
    !!ambulance?.ambulance_id &&
    ["DISPATCHED", "EN_ROUTE"].includes(incident?.status);

  const canTransport =
    incident?.status === "ARRIVED" &&
    phase !== "TO_HOSPITAL" &&
    phase !== "COMPLETED";

  const canComplete =
    incident?.status === "ARRIVED" && phase === "TO_HOSPITAL";

  const hasCoordinates = !!incidentPoint && !!hospitalPoint;

  return (
    <div className="ambulance-page">
      <header className="ambulance-header">
        <div>
          <div className="ambulance-eyebrow">EMERGENCY RESPONSE SYSTEM</div>
          <h1>Ambulance Command Center</h1>
          <p>Live assignment data · Road routing · Ambulance trip tracking</p>
        </div>

        <div className="ambulance-live-status">
          <span className="status-dot" />
          {loading ? "LOADING DATA" : "BACKEND CONNECTED"}
        </div>
      </header>

      <section className="ambulance-stats">
        <article className="ambulance-stat">
          <span>Ambulance ID</span>
          <strong>{ambulance?.ambulance_id || "—"}</strong>
        </article>

        <article className="ambulance-stat">
          <span>Incident ID</span>
          <strong>{incident?.incident_id || "No assignment"}</strong>
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
              <p>Locations and assignment details from your backend</p>
            </div>

            <button
              type="button"
              className="secondary-action"
              onClick={loadAssignments}
              disabled={loading || busy}
            >
              {loading ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>

          <div className="ambulance-map" style={{ height: 480, width: "100%" }}>
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
                    <strong>Accident: {incident?.incident_id}</strong>
                    <br />
                    Severity: {titleCase(incident?.severity)}
                    <br />
                    Status: {titleCase(incident?.status)}
                    <br />
                    {incidentPoint.latitude}, {incidentPoint.longitude}
                  </Popup>
                </Marker>
              )}

              {hospitalPoint && (
                <Marker
                  position={mapPosition(hospitalPoint)}
                  icon={hospitalIcon}
                >
                  <Popup>
                    <strong>{hospital?.name || "Assigned hospital"}</strong>
                    <br />
                    Hospital ID: {hospital?.hospital_id || "—"}
                    <br />
                    {hospitalPoint.latitude}, {hospitalPoint.longitude}
                  </Popup>
                </Marker>
              )}

              {routeCoordinates.length > 0 && (
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
                    <strong>{ambulance?.ambulance_id || "Ambulance"}</strong>
                    <br />
                    Status: {titleCase(ambulanceStatus)}
                    <br />
                    Phase: {titleCase(phase)}
                    <br />
                    {currentPosition.latitude}, {currentPosition.longitude}
                  </Popup>
                </Marker>
              )}

              {tracking?.position && (
                <CircleMarker
                  center={[
                    tracking.position.latitude,
                    tracking.position.longitude,
                  ]}
                  radius={5}
                  pathOptions={{ color: "#15803d", fillOpacity: 0.7 }}
                >
                  <Popup>Latest position saved by the backend</Popup>
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

          <p className="map-disclaimer">
            The map uses saved coordinates and road geometry. Trip movement is
            simulated by this page and stored by your backend; OSRM does not
            provide live traffic conditions.
          </p>
        </section>

        <aside className="ambulance-sidebar">
          <section className="side-panel">
            <h2>Ambulance Assignments</h2>
            <p className="side-description">
              Select an assignment returned by your Flask API.
            </p>

            {loading ? (
              <p>Loading assignments from the backend…</p>
            ) : assignments.length === 0 ? (
              <p className="empty-notifications">
                No ambulance records were returned. Register an ambulance and
                dispatch it to an incident first.
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
                    setError("");
                    setMessage("");
                  }}
                  disabled={busy}
                >
                  {assignments.map((row) => {
                    const id = getAssignmentId(row);
                    return (
                      <option key={id || JSON.stringify(row)} value={id}>
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
                  <strong>{incident?.incident_id || "No incident"}</strong>
                  <p>Status: {titleCase(incidentStatus)}</p>
                  <small>
                    Severity: {titleCase(incident?.severity)} · Camera:{" "}
                    {incident?.camera_id || "—"}
                  </small>
                </div>

                <div className="selected-hospital-summary">
                  <span>Destination hospital</span>
                  <strong>{hospital?.name || "No hospital assigned"}</strong>
                  <p>Hospital ID: {hospital?.hospital_id || "—"}</p>
                  <small>
                    {hospitalPoint
                      ? `${hospitalPoint.latitude}, ${hospitalPoint.longitude}`
                      : "Hospital coordinates are missing"}
                  </small>
                </div>

                {!hasCoordinates && (
                  <p role="alert">
                    This assignment cannot be routed until both the incident
                    and hospital have valid latitude/longitude fields.
                  </p>
                )}

                <button
                  type="button"
                  className="primary-action"
                  onClick={startTrip}
                  disabled={busy || loading || !canStart || !hasCoordinates}
                >
                  {busy ? "Processing trip…" : "Start Trip to Accident"}
                </button>

                <button
                  type="button"
                  className="secondary-action"
                  onClick={transportToHospital}
                  disabled={busy || loading || !canTransport || !hasCoordinates}
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
                {routeInfo ? `${formatNumber(routeInfo.distanceKm)} km` : "—"}
              </strong>
            </div>

            <div className="detail-row">
              <span>Estimated road time</span>
              <strong>
                {routeInfo
                  ? `${Math.ceil(routeInfo.durationMinutes)} min`
                  : "—"}
              </strong>
            </div>

            <div className="detail-row">
              <span>Route progress</span>
              <strong>{progress}%</strong>
            </div>

            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            <small>
              Route time is the routing service's estimate, not live traffic
              ETA.
            </small>
          </section>

          <section className="side-panel">
            <h2>Activity & Notifications</h2>

            {activity.length === 0 ? (
              <p className="empty-notifications">
                No actions yet. Choose a dispatched assignment to begin.
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

      <footer className="ambulance-footer">
        Academic project demonstration. This page reads real application
        records and writes simulated trip positions to the backend; it does not
        contact or dispatch a real emergency service.
      </footer>
    </div>
  );
}
