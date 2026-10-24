
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import "./AmbulanceSimulation.css";

const DEFAULT_CENTER = [18.5204, 73.8567];

function coordinates(value) {
  if (!value) return null;

  const lat = Number(value.latitude ?? value.lat);
  const lng = Number(value.longitude ?? value.lng ?? value.lon);

  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return [lat, lng];
  }

  return null;
}

function distanceKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) *
      Math.cos(rad(b[0])) *
      Math.sin(dLng / 2) ** 2;

  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function makeIcon(emoji, className) {
  return L.divIcon({
    className: "ambulance-map-icon",
    html: `<div class="${className}">${emoji}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

const ambulanceIcon = makeIcon("🚑", "ambulance-pin");
const incidentIcon = makeIcon("⚠", "accident-pin");

async function getRoadRoute(start, end) {
  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${start[1]},${start[0]};${end[1]},${end[0]}` +
    "?overview=full&geometries=geojson";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("The road-routing service is unavailable.");
  }

  const result = await response.json();
  const route = result.routes?.[0];

  if (!route?.geometry?.coordinates?.length) {
    throw new Error("No road route was returned.");
  }

  return {
    points: route.geometry.coordinates.map(([lng, lat]) => [
      lat,
      lng,
    ]),
    distanceKm: route.distance / 1000,
    durationSeconds: route.duration,
    source: "OSRM",
  };
}

function makeFallbackRoute(start, end) {
  return {
    points: [start, end],
    distanceKm: distanceKm(start, end),
    durationSeconds: null,
    source: "STRAIGHT_LINE_FALLBACK",
  };
}

function pointAt(points, progress) {
  if (points.length === 1) return points[0];

  const index = Math.min(
    points.length - 1,
    Math.floor(progress * (points.length - 1))
  );

  const next = Math.min(index + 1, points.length - 1);
  const fraction = progress * (points.length - 1) - index;

  return [
    points[index][0] +
      (points[next][0] - points[index][0]) * fraction,
    points[index][1] +
      (points[next][1] - points[index][1]) * fraction,
  ];
}

function getAssignmentId(row) {
  return row?.ambulance?.ambulance_id;
}

function getIncidentId(row) {
  return row?.incident?.incident_id;
}

export default function AmbulanceLiveControl() {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [tracking, setTracking] = useState(null);
  const [route, setRoute] = useState(null);
  const [vehiclePosition, setVehiclePosition] = useState(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const selected = assignments.find(
    (row) => getAssignmentId(row) === selectedId
  );

  const incidentId = getIncidentId(selected);
  const ambulanceId = getAssignmentId(selected);

  const incidentPoint = coordinates(
    tracking?.incident_location ??
      selected?.incident?.location
  );

  const hospitalPoint = coordinates(
    tracking?.hospital?.location ??
      selected?.hospital?.location
  );

  const phase = tracking?.tracking?.phase;
  const status = tracking?.status ?? selected?.incident?.status;
  const trackingPosition = coordinates(
    tracking?.tracking?.position
  );

  const visiblePosition =
    vehiclePosition || trackingPosition || hospitalPoint;

  const loadAssignments = useCallback(async () => {
    try {
      const result = await api.ambulanceSim.assignments();
      const rows = Array.isArray(result?.ambulances)
        ? result.ambulances
        : [];

      setAssignments(rows);

      setSelectedId((current) => {
        if (current && rows.some(
          (row) => getAssignmentId(row) === current
        )) {
          return current;
        }

        const active = rows.find((row) =>
          row.incident?.incident_id &&
          ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"].includes(
            row.ambulance?.status
          )
        );

        return getAssignmentId(active || rows.find(
          (row) => row.incident?.incident_id
        )) || "";
      });
    } catch (e) {
      setError(e.message || "Could not load ambulance assignments.");
    }
  }, []);

  const refreshTracking = useCallback(async () => {
    if (!incidentId) {
      setTracking(null);
      return;
    }

    try {
      const result = await api.ambulanceSim.track(incidentId);
      setTracking(result);
    } catch (e) {
      setError(e.message || "Could not load tracking data.");
    }
  }, [incidentId]);

  useEffect(() => {
    loadAssignments();
  }, [loadAssignments]);

  useEffect(() => {
    refreshTracking();
    const timer = window.setInterval(refreshTracking, 3000);

    return () => window.clearInterval(timer);
  }, [refreshTracking]);

  useEffect(() => {
    setRoute(null);
    setVehiclePosition(null);
    setProgress(0);
    setMessage("");
    setError("");
  }, [selectedId]);

  const activeRoutePoints = useMemo(
    () => route?.points || [],
    [route]
  );

  async function requestRoute(start, end) {
    try {
      return await getRoadRoute(start, end);
    } catch (e) {
      setMessage(
        "Road routing unavailable; using a straight-line fallback for this demo."
      );
      return makeFallbackRoute(start, end);
    }
  }

  async function startTrip() {
    if (!ambulanceId || !incidentId || !incidentPoint || !hospitalPoint) {
      setError(
        "Select a dispatched ambulance with valid incident and hospital coordinates."
      );
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const roadRoute = await requestRoute(
        hospitalPoint,
        incidentPoint
      );

      await api.ambulanceSim.start(ambulanceId, {
        source: "SIMULATION",
        route_source: roadRoute.source,
        route_distance_km: roadRoute.distanceKm,
      });

      setRoute(roadRoute);
      setVehiclePosition(hospitalPoint);
      setProgress(0);

      const steps = 20;

      for (let i = 1; i <= steps; i += 1) {
        const nextProgress = i / steps;
        const position = pointAt(roadRoute.points, nextProgress);
        const remainingKm =
          roadRoute.distanceKm * (1 - nextProgress);

        await api.ambulanceSim.position(ambulanceId, {
          latitude: position[0],
          longitude: position[1],
          phase: "TO_SCENE",
          source: "SIMULATION",
          progress: nextProgress,
          speed_kmh: 35,
          remaining_km: remainingKm,
          eta_seconds: Math.round((remainingKm / 35) * 3600),
        });

        setVehiclePosition(position);
        setProgress(nextProgress);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }

      await api.ambulanceSim.arriveScene(ambulanceId);
      setMessage("Ambulance has reached the accident scene.");
      await refreshTracking();
      await loadAssignments();
    } catch (e) {
      setError(e.message || "Unable to start or update the ambulance trip.");
    } finally {
      setBusy(false);
    }
  }

  async function transportToHospital() {
    if (!ambulanceId || !incidentPoint || !hospitalPoint) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const roadRoute = await requestRoute(
        incidentPoint,
        hospitalPoint
      );

      await api.ambulanceSim.departScene(ambulanceId, {
        route_source: roadRoute.source,
        route_distance_km: roadRoute.distanceKm,
      });

      setRoute(roadRoute);
      setVehiclePosition(incidentPoint);
      setProgress(0);

      const steps = 20;

      for (let i = 1; i <= steps; i += 1) {
        const nextProgress = i / steps;
        const position = pointAt(roadRoute.points, nextProgress);
        const remainingKm =
          roadRoute.distanceKm * (1 - nextProgress);

        await api.ambulanceSim.position(ambulanceId, {
          latitude: position[0],
          longitude: position[1],
          phase: "TO_HOSPITAL",
          source: "SIMULATION",
          progress: nextProgress,
          speed_kmh: 35,
          remaining_km: remainingKm,
          eta_seconds: Math.round((remainingKm / 35) * 3600),
        });

        setVehiclePosition(position);
        setProgress(nextProgress);
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }

      setMessage(
        "Ambulance reached the hospital. Select Complete Trip to close the assignment."
      );
      await refreshTracking();
      await loadAssignments();
    } catch (e) {
      setError(e.message || "Unable to start the hospital transport.");
    } finally {
      setBusy(false);
    }
  }

  async function completeTrip() {
    if (!ambulanceId) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await api.ambulanceSim.complete(ambulanceId);
      setVehiclePosition(hospitalPoint);
      setMessage("Trip completed. The ambulance is now available.");
      await refreshTracking();
      await loadAssignments();
    } catch (e) {
      setError(e.message || "Unable to complete the trip.");
    } finally {
      setBusy(false);
    }
  }

  const canStart = ["DISPATCHED", "EN_ROUTE"].includes(status) &&
    phase !== "TO_HOSPITAL" &&
    phase !== "COMPLETED";

  const canTransport =
    status === "ARRIVED" &&
    phase !== "TO_HOSPITAL" &&
    phase !== "COMPLETED";

  const canComplete =
    status === "ARRIVED" &&
    phase === "TO_HOSPITAL";

  return (
    <main className="ambulance-page">
      <header className="ambulance-header">
        <div>
          <span className="ambulance-eyebrow">
            AMBULANCE RESPONSE SYSTEM
          </span>
          <h1>Ambulance Tracking</h1>
          <p>Assigned incidents, road routes and backend position updates.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={loadAssignments}
        >
          Refresh assignments
        </button>
      </header>

      {error && <p role="alert" className="error-message">{error}</p>}
      {message && <p role="status">{message}</p>}

      <section className="side-panel" style={{ marginBottom: 18 }}>
        <label htmlFor="ambulance-assignment">
          <strong>Select assigned ambulance</strong>
        </label>
        <select
          id="ambulance-assignment"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={busy}
          style={{ display: "block", width: "100%", marginTop: 10, padding: 10 }}
        >
          <option value="">Choose an assignment</option>
          {assignments.filter((row) => getIncidentId(row)).map((row) => (
            <option
              key={getAssignmentId(row)}
              value={getAssignmentId(row)}
            >
              {getAssignmentId(row)} — {getIncidentId(row)} — {row.ambulance?.status}
            </option>
          ))}
        </select>

        {selected && (
          <p>
            Incident: <strong>{incidentId}</strong>
            {" · "}Status: <strong>{status || "Unknown"}</strong>
            {" · "}Phase: <strong>{phase || "Not started"}</strong>
          </p>
        )}

        {!selected && (
          <p>No assigned ambulance found. Dispatch an ambulance from the hospital dashboard first.</p>
        )}
      </section>

      <section className="map-panel">
        <div className="panel-heading">
          <div>
            <h2>Route and current position</h2>
            <p>
              {route?.source === "OSRM"
                ? "Road geometry from OpenStreetMap routing"
                : "Waiting for a route"}
            </p>
          </div>
          <span className="ambulance-live-status">
            <span className="status-dot" />
            {busy ? "TRIP RUNNING" : "TRACKING"}
          </span>
        </div>

        <MapContainer
          center={visiblePosition || incidentPoint || DEFAULT_CENTER}
          zoom={13}
          scrollWheelZoom
          style={{ height: 480, width: "100%" }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {hospitalPoint && (
            <CircleMarker
              center={hospitalPoint}
              radius={8}
              pathOptions={{ color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 1 }}
            >
              <Popup>Assigned hospital</Popup>
            </CircleMarker>
          )}

          {incidentPoint && (
            <Marker position={incidentPoint} icon={incidentIcon}>
              <Popup>Accident: {incidentId}</Popup>
            </Marker>
          )}

          {activeRoutePoints.length > 1 && (
            <Polyline
              positions={activeRoutePoints}
              pathOptions={{
                color: route?.source === "OSRM" ? "#2563eb" : "#d97706",
                weight: 5,
              }}
            />
          )}

          {visiblePosition && (
            <Marker position={visiblePosition} icon={ambulanceIcon}>
              <Popup>
                {ambulanceId || "Ambulance"} — {phase || "Waiting"}
              </Popup>
            </Marker>
          )}
        </MapContainer>

        <div className="map-legend">
          <span>Hospital</span>
          <span>Accident scene</span>
          <span>Ambulance position</span>
        </div>

        <div className="side-panel" style={{ margin: 16 }}>
          <p>
            <strong>Route distance:</strong>{" "}
            {route ? `${route.distanceKm.toFixed(2)} km` : "Not calculated"}
          </p>
          <p>
            <strong>Simulation progress:</strong> {Math.round(progress * 100)}%
          </p>
          <p>
            <strong>Position source:</strong>{" "}
            {tracking?.tracking?.source || "Not started"}
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            <button
              type="button"
              disabled={busy || !selected || !canStart}
              onClick={startTrip}
            >
              Start trip to accident
            </button>

            <button
              type="button"
              disabled={busy || !selected || !canTransport}
              onClick={transportToHospital}
            >
              Transport to hospital
            </button>

            <button
              type="button"
              disabled={busy || !selected || !canComplete}
              onClick={completeTrip}
            >
              Complete trip
            </button>
          </div>

          <p className="map-disclaimer">
            Academic simulation. OSRM provides road-route estimates, not live
            traffic data. Simulation positions are sent to the backend; they
            are not real ambulance GPS readings.
          </p>
        </div>
      </section>
    </main>
  );
}
