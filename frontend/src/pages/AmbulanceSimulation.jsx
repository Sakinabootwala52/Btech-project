import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import {
  PHASE_LABELS,
  drivenPath,
  fetchRoute,
  formatAgo,
  formatDuration,
  pointAtDistance,
  simulatedSpeedKmh,
  toLatLng,
} from "../ambulanceRoute";

// Ambulance Unit Simulator
// ------------------------
// The live page pretends to be a CCTV camera; this page pretends to be the
// ambulance. It drives a dispatched vehicle along the road route and reports
// each position to the backend, exactly like a GPS unit would, so hospital
// screens can track it live.

const TICK_MS = 200;
const REPORT_EVERY_MS = 1500;
const SPEED_OPTIONS = [
  { value: 1, label: "1× — real time" },
  { value: 5, label: "5× — fast demo" },
  { value: 10, label: "10× — presentation" },
  { value: 20, label: "20× — quick check" },
];
const ACTIVE_STATUSES = ["ASSIGNED", "EN_ROUTE", "ARRIVED", "TRANSPORTING"];

const ambulanceIcon = L.divIcon({ className: "cc-ambulance-icon", html: '<div class="cc-ambulance-emoji">🚑</div>', iconSize: [42, 42], iconAnchor: [21, 21] });
const incidentIcon = L.divIcon({ className: "cc-incident-icon", html: '<div class="cc-incident-pin">⚠</div>', iconSize: [34, 34], iconAnchor: [17, 17] });

function FitRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 16 });
  }, [map, points]);
  return null;
}

function Metric({ label, value, detail }) {
  return <div className="cc-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function stamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Which leg the selected vehicle should drive, based on backend state.
function legFor(row) {
  if (!row?.incident) return null;
  const status = row.ambulance?.status;
  const phase = row.incident.tracking?.phase;
  if (status === "TRANSPORTING" || phase === "TO_HOSPITAL") return "TO_HOSPITAL";
  if (status === "ARRIVED" || phase === "AT_SCENE") return "AT_SCENE";
  if (status === "ASSIGNED" || status === "EN_ROUTE") return "TO_SCENE";
  return null;
}

export default function AmbulanceSimulation() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [speedFactor, setSpeedFactor] = useState(10);
  const [route, setRoute] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [distanceKm, setDistanceKm] = useState(0);
  const [speedKmh, setSpeedKmh] = useState(0);
  const [runState, setRunState] = useState("READY"); // READY | RUNNING | PAUSED | ARRIVED_DESTINATION | COMPLETED
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState({ count: 0, lastAt: null });
  const [events, setEvents] = useState([{ id: 1, time: stamp(), title: "Simulator ready", detail: "Select a dispatched ambulance to begin." }]);
  const [error, setError] = useState("");
  const [, setClock] = useState(0);

  const distanceRef = useRef(0);
  const speedRef = useRef(0);
  const lastTickRef = useRef(0);
  const reportingRef = useRef(false);
  const arrivalRef = useRef(""); // legKey whose arrival was already handled
  const eventId = useRef(2);

  const selected = useMemo(() => rows.find((row) => row.ambulance.ambulance_id === selectedId) || null, [rows, selectedId]);
  const leg = legFor(selected);
  const incidentPoint = toLatLng(selected?.incident?.location);
  const hospitalPoint = toLatLng(selected?.hospital?.location);
  const legKey = selected && leg ? `${selected.ambulance.ambulance_id}|${selected.incident.incident_id}|${leg}` : "";
  const isRunning = runState === "RUNNING";

  const addEvent = useCallback((title, detail) => {
    setEvents((prev) => [{ id: eventId.current++, time: stamp(), title, detail }, ...prev].slice(0, 14));
  }, []);

  // ---------------------------------------------------------------
  // Load vehicles and their assignments (polled for new dispatches)
  // ---------------------------------------------------------------
  const loadRows = useCallback(async () => {
    try {
      const data = await api.ambulanceSim.assignments();
      const list = Array.isArray(data?.ambulances) ? data.ambulances : [];
      setRows(list);
      setSelectedId((current) => {
        if (current && list.some((row) => row.ambulance.ambulance_id === current)) return current;
        const firstActive = list.find((row) => ACTIVE_STATUSES.includes(row.ambulance.status) && row.incident);
        return firstActive?.ambulance.ambulance_id || "";
      });
      setError("");
    } catch (e) {
      setError(`Could not load ambulances: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRows();
    const id = window.setInterval(loadRows, 4000);
    return () => window.clearInterval(id);
  }, [loadRows]);

  useEffect(() => {
    const id = window.setInterval(() => setClock((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ---------------------------------------------------------------
  // Load the road route for the current leg
  // ---------------------------------------------------------------
  const legStartLat = leg === "TO_HOSPITAL" ? incidentPoint?.[0] : hospitalPoint?.[0];
  const legStartLng = leg === "TO_HOSPITAL" ? incidentPoint?.[1] : hospitalPoint?.[1];
  const legEndLat = leg === "TO_HOSPITAL" ? hospitalPoint?.[0] : incidentPoint?.[0];
  const legEndLng = leg === "TO_HOSPITAL" ? hospitalPoint?.[1] : incidentPoint?.[1];

  useEffect(() => {
    let cancelled = false;
    setRunState((state) => (state === "COMPLETED" ? state : "READY"));
    if (!legKey || leg === "AT_SCENE" || legStartLat == null || legEndLat == null) {
      setRoute(null);
      return undefined;
    }
    setRouteLoading(true);
    fetchRoute([legStartLat, legStartLng], [legEndLat, legEndLng]).then((loaded) => {
      if (cancelled) return;
      // Resume from the last reported progress if the trip already started.
      const tracking = selected?.incident?.tracking;
      const saved = tracking?.phase === leg ? Number(tracking?.position?.progress) : 0;
      const resumeKm = Number.isFinite(saved) && saved > 0 && saved < 1 ? saved * loaded.totalKm : 0;
      distanceRef.current = resumeKm;
      setDistanceKm(resumeKm);
      setSpeedKmh(0);
      setRoute(loaded);
      if (resumeKm > 0) setRunState("PAUSED");
      setRouteLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey, legStartLat, legStartLng, legEndLat, legEndLng]);

  // ---------------------------------------------------------------
  // Report the current position to the backend
  // ---------------------------------------------------------------
  // Read through a ref so the reporting timer is not restarted by polling.
  const contextRef = useRef({});
  contextRef.current = { route, selected, leg };

  const reportPosition = useCallback(async (override = {}) => {
    const { route, selected, leg } = contextRef.current;
    if (!route || !selected || reportingRef.current) return;
    const distance = distanceRef.current;
    const point = pointAtDistance(route, distance);
    const remaining = Math.max(0, route.totalKm - distance);
    const speed = speedRef.current;
    reportingRef.current = true;
    try {
      await api.ambulanceSim.position(selected.ambulance.ambulance_id, {
        latitude: point[0],
        longitude: point[1],
        phase: leg,
        source: "SIMULATION",
        progress: route.totalKm ? distance / route.totalKm : 1,
        speed_kmh: speed,
        remaining_km: remaining,
        eta_seconds: remaining > 0 ? (remaining / Math.max(speed || 30, 15)) * 3600 : 0,
        ...override,
      });
      setReports((prev) => ({ count: prev.count + 1, lastAt: new Date().toISOString() }));
    } catch (e) {
      setRunState("PAUSED");
      setError(`Position update rejected: ${e.message}`);
      addEvent("Trip interrupted", "The backend rejected a position update — the incident was probably updated from another screen.");
      loadRows();
    } finally {
      reportingRef.current = false;
    }
  }, [addEvent, loadRows]);

  // ---------------------------------------------------------------
  // Drive: advance the vehicle along the route
  // ---------------------------------------------------------------
  useEffect(() => {
    if (!isRunning || !route) return undefined;
    lastTickRef.current = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dtSeconds = Math.min(1, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const speed = simulatedSpeedKmh(distanceRef.current, route.totalKm);
      const next = Math.min(route.totalKm, distanceRef.current + (speed / 3600) * dtSeconds * speedFactor);
      distanceRef.current = next;
      speedRef.current = speed;
      setDistanceKm(next);
      setSpeedKmh(speed);
      if (next >= route.totalKm) setRunState("ARRIVED_DESTINATION");
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [isRunning, route, speedFactor]);

  useEffect(() => {
    if (!isRunning) return undefined;
    reportPosition();
    const id = window.setInterval(() => reportPosition(), REPORT_EVERY_MS);
    return () => window.clearInterval(id);
  }, [isRunning, reportPosition]);

  // ---------------------------------------------------------------
  // Arrival at the end of a leg
  // ---------------------------------------------------------------
  useEffect(() => {
    // Handle each leg's arrival exactly once. Polling can change `selected`
    // (and even the leg) while runState is still ARRIVED_DESTINATION.
    if (runState !== "ARRIVED_DESTINATION" || !selected) return;
    if (leg !== "TO_SCENE" && leg !== "TO_HOSPITAL") return;
    if (arrivalRef.current === legKey) return;
    arrivalRef.current = legKey;
    speedRef.current = 0;
    setSpeedKmh(0);
    const id = selected.ambulance.ambulance_id;
    (async () => {
      setBusy(true);
      try {
        if (leg === "TO_SCENE") {
          await api.ambulanceSim.arriveScene(id);
          addEvent("Arrived at accident scene", `${id} reached ${selected.incident.incident_id}. Incident marked ARRIVED for the hospital.`);
        } else {
          await reportPosition({ progress: 1, remaining_km: 0, eta_seconds: 0, speed_kmh: 0 });
          addEvent("Arrived at hospital", `${id} reached ${selected.hospital?.name}. Complete the handover to free the vehicle.`);
        }
        await loadRows();
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    })();
  }, [runState, selected, leg, legKey, addEvent, loadRows, reportPosition]);

  // ---------------------------------------------------------------
  // Operator actions
  // ---------------------------------------------------------------
  async function startOrResume() {
    if (!selected || !route) return;
    setError("");
    if (runState === "PAUSED") {
      setRunState("RUNNING");
      addEvent("Trip resumed", "Vehicle moving again.");
      return;
    }
    setBusy(true);
    try {
      if (leg === "TO_SCENE") {
        await api.ambulanceSim.start(selected.ambulance.ambulance_id, { route_source: route.source, route_distance_km: Number(route.totalKm.toFixed(3)) });
        addEvent("Trip started", `${selected.ambulance.ambulance_id} left ${selected.hospital?.name} for ${selected.incident.incident_id}. Incident is now EN_ROUTE.`);
      } else {
        addEvent("Transport started", `Driving the patient to ${selected.hospital?.name}.`);
      }
      setRunState("RUNNING");
      await loadRows();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function pause() {
    setRunState("PAUSED");
    reportPosition();
    addEvent("Trip paused", "Position frozen. The hospital keeps seeing the last reported point.");
  }

  async function departScene() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await api.ambulanceSim.departScene(selected.ambulance.ambulance_id);
      addEvent("Departed scene", `Patient on board. Heading to ${selected.hospital?.name}.`);
      await loadRows();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function completeHandover() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const id = selected.ambulance.ambulance_id;
      await api.ambulanceSim.complete(id);
      addEvent("Handover complete", `Incident resolved. ${id} is AVAILABLE again.`);
      setRunState("COMPLETED");
      setRoute(null);
      await loadRows();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function selectVehicle(id) {
    setSelectedId(id);
    setRunState("READY");
    setReports({ count: 0, lastAt: null });
  }

  // ---------------------------------------------------------------
  // Derived values for display
  // ---------------------------------------------------------------
  const totalKm = route?.totalKm || 0;
  const remainingKm = route ? Math.max(0, totalKm - distanceKm) : null;
  const progress = totalKm ? Math.min(1, distanceKm / totalKm) : leg === "AT_SCENE" ? 1 : 0;
  const etaSeconds = remainingKm != null ? (remainingKm / Math.max(speedKmh || 35, 15)) * 3600 : null;
  const vehiclePoint = route ? pointAtDistance(route, distanceKm) : leg === "AT_SCENE" ? incidentPoint : hospitalPoint;
  const driven = useMemo(() => (route ? drivenPath(route, distanceKm) : []), [route, distanceKm]);
  const fitPoints = useMemo(() => {
    if (route) return route.points;
    return [hospitalPoint, incidentPoint].filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, hospitalPoint?.[0], incidentPoint?.[0]]);
  const activeRows = rows.filter((row) => ACTIVE_STATUSES.includes(row.ambulance.status) && row.incident);
  const atHospital = runState === "ARRIVED_DESTINATION" && leg === "TO_HOSPITAL";
  const phaseLabel = runState === "COMPLETED" ? PHASE_LABELS.COMPLETED : leg === "TO_SCENE" && runState === "READY" && selected?.ambulance.status === "ASSIGNED" ? "Waiting to start" : PHASE_LABELS[leg] || "No assignment";
  const stateLabel = { READY: "READY", RUNNING: "DRIVING", PAUSED: "PAUSED", ARRIVED_DESTINATION: "ARRIVED", COMPLETED: "COMPLETED" }[runState];

  let primaryAction = null;
  if (selected && leg === "AT_SCENE") {
    primaryAction = <button className="button primary" onClick={departScene} disabled={busy}>🏥 Depart to hospital</button>;
  } else if (atHospital) {
    primaryAction = <button className="button primary" onClick={completeHandover} disabled={busy}>✓ Complete handover</button>;
  } else if (selected && route && (leg === "TO_SCENE" || leg === "TO_HOSPITAL")) {
    primaryAction = <button className="button primary" onClick={startOrResume} disabled={busy || isRunning || runState === "ARRIVED_DESTINATION"}>▶ {runState === "PAUSED" ? "Resume trip" : leg === "TO_HOSPITAL" ? "Start transport" : "Start trip"}</button>;
  }

  if (loading) return <Loading label="Loading ambulance units..." />;

  return <section className="ambulance-sim">
    <div className="page-heading cc-heading">
      <div>
        <span className="eyebrow">AMBULANCE UNIT SIMULATION</span>
        <h2>Ambulance Unit Simulator</h2>
        <p>Act as the ambulance crew: drive a dispatched vehicle along the road route and stream its position to the backend so hospitals can track it live.</p>
      </div>
      <span className="live-pill"><span className={`status-dot ${isRunning ? "online" : ""}`} />{isRunning ? "DRIVING" : "STANDBY"}</span>
    </div>

    <ErrorMessage message={error} />

    <div className="cc-banner">
      <strong>SIMULATED VEHICLE — POSITIONS ARE GENERATED BY THIS PAGE, NOT BY GPS</strong>
      <span>Each position is sent to the backend through the same endpoint a real GPS unit would use, so the hospital's incident page tracks this vehicle live. Speed follows an urban ambulance profile (about 25–55 km/h); the demo clock can be accelerated.</span>
    </div>

    <div className="cc-metrics-grid">
      <Metric label="Trip phase" value={phaseLabel} detail={selected ? `${selected.ambulance.ambulance_id} · ${stateLabel}` : "Select a vehicle"} />
      <Metric label="Distance remaining" value={remainingKm != null ? `${remainingKm.toFixed(2)} km` : "—"} detail={route ? `of ${totalKm.toFixed(2)} km this leg` : "No active leg"} />
      <Metric label="Road ETA" value={remainingKm != null ? formatDuration(etaSeconds) : "—"} detail={speedFactor > 1 && remainingKm ? `Demo clock: ${formatDuration(etaSeconds / speedFactor)}` : "At current speed"} />
      <Metric label="Current speed" value={`${Math.round(speedKmh)} km/h`} detail={`Demo clock ${speedFactor}×`} />
    </div>

    <div className="cc-main-grid">
      <div className="cc-map-panel">
        <div className="cc-panel-heading">
          <div><span className="eyebrow">LIVE ROUTE</span><h3>{leg === "TO_HOSPITAL" || atHospital ? "Scene → Hospital" : "Hospital → Accident scene"}</h3></div>
          <span className="cc-sim-chip">{route?.source === "ROAD" ? "ROAD ROUTE" : route ? "APPROXIMATE ROUTE" : "SIMULATED VEHICLE"}</span>
        </div>

        {!selected || !selected.incident ? <div className="empty-state as-empty">
          <h3>No ambulance on an active assignment</h3>
          <p>{rows.length === 0 ? "No ambulances are registered yet. Admin → Ambulances → register a vehicle for a hospital." : "To create one: Live Feed detects an accident → a hospital clicks ACCEPT → on the incident page the hospital clicks Dispatch Ambulance."}</p>
          <p className="muted-text">This page refreshes every few seconds and picks up new dispatches automatically.</p>
        </div> : <>
          <div className="cc-map-wrap">
            <MapContainer center={hospitalPoint || incidentPoint || [18.5204, 73.8567]} zoom={14} scrollWheelZoom style={{ height: "430px", width: "100%" }}>
              <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitRoute points={fitPoints} />
              {route && <Polyline positions={route.points} pathOptions={{ color: "#64748b", weight: 5, opacity: 0.45, dashArray: "7 8" }} />}
              {driven.length > 1 && <Polyline positions={driven} pathOptions={{ color: "#ef4444", weight: 5, opacity: 0.95 }} />}
              {hospitalPoint && <CircleMarker center={hospitalPoint} radius={9} pathOptions={{ color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 1 }}><Popup>{selected.hospital?.name}</Popup></CircleMarker>}
              {incidentPoint && <Marker position={incidentPoint} icon={incidentIcon}><Popup>Accident {selected.incident.incident_id}</Popup></Marker>}
              {vehiclePoint && <Marker position={vehiclePoint} icon={ambulanceIcon}><Popup>{selected.ambulance.ambulance_id} · {stateLabel}</Popup></Marker>}
            </MapContainer>
          </div>
          <div className="cc-route-metrics">
            <Metric label="Leg length" value={route ? `${totalKm.toFixed(2)} km` : routeLoading ? "Loading…" : "—"} detail={route?.source === "ROAD" ? "OpenStreetMap road network (OSRM)" : route ? "Routing service unreachable — approximated" : ""} />
            <Metric label="Positions sent" value={reports.count} detail={`Last: ${formatAgo(reports.lastAt)}`} />
            <Metric label="Hospital sees" value={selected.incident.status} detail={selected.incident.tracking?.phase ? PHASE_LABELS[selected.incident.tracking.phase] : "Not started"} />
          </div>
          <div className="cc-progress">
            <div className="cc-progress-label"><span>Leg progress</span><strong>{Math.round(progress * 100)}%</strong></div>
            <div className="cc-progress-track"><span style={{ width: `${progress * 100}%` }} /></div>
          </div>
          <div className="cc-controls">
            {primaryAction}
            <button className="button secondary" onClick={pause} disabled={!isRunning}>Ⅱ Pause</button>
            <span className="cc-state-text">Status: <b>{stateLabel}</b></span>
          </div>
        </>}
      </div>

      <aside className="cc-side-column">
        <div className="cc-panel">
          <div className="cc-panel-heading"><div><span className="eyebrow">VEHICLE</span><h3>Ambulance unit</h3></div><span className="cc-count">{activeRows.length} active</span></div>
          <div className="form-stack">
            <label>Ambulance
              <select value={selectedId} onChange={(e) => selectVehicle(e.target.value)} disabled={isRunning}>
                <option value="">Select a vehicle</option>
                {rows.map((row) => <option key={row.ambulance.ambulance_id} value={row.ambulance.ambulance_id}>
                  {row.ambulance.ambulance_id} · {row.ambulance.hospital_name || row.ambulance.hospital_id} · {row.ambulance.status}{row.incident ? ` → ${row.incident.incident_id}` : ""}
                </option>)}
              </select>
            </label>
            <label>Demo clock
              <select value={speedFactor} onChange={(e) => setSpeedFactor(Number(e.target.value))}>
                {SPEED_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        {selected?.incident && <div className="cc-panel">
          <div className="cc-panel-heading"><div><span className="eyebrow">ASSIGNMENT</span><h3>{selected.incident.incident_id}</h3></div><span className="cc-sim-chip">{selected.incident.status}</span></div>
          <div className="cc-resource-row"><span>Severity</span><b>{selected.incident.severity || "—"}</b></div>
          <div className="cc-resource-row"><span>Detection confidence</span><b>{selected.incident.confidence != null ? `${Math.round(Number(selected.incident.confidence) * 100)}%` : "—"}</b></div>
          <div className="cc-resource-row"><span>Camera</span><b>{selected.incident.camera_id || "—"}</b></div>
          <div className="cc-resource-row"><span>Base hospital</span><b>{selected.hospital?.name || "—"}</b></div>
          <div className="cc-resource-row"><span>Vehicle type</span><b>{selected.ambulance.vehicle_type || "—"}</b></div>
          <div className="cc-resource-row"><span>Vehicle status</span><b>{selected.ambulance.status}</b></div>
        </div>}

        <div className="cc-panel">
          <div className="cc-panel-heading"><div><span className="eyebrow">EVENT STREAM</span><h3>Trip timeline</h3></div><span className="cc-count">{events.length}</span></div>
          <div className="cc-timeline">{events.map((event) => <div className="cc-event" key={event.id}><span className="cc-event-dot" /><div><div className="cc-event-title">{event.title}<time>{event.time}</time></div><p>{event.detail}</p></div></div>)}</div>
        </div>
      </aside>
    </div>

    <div className="panel as-fleet">
      <div className="panel-header"><div><h3>Fleet overview</h3><span>Every registered vehicle and the last position it reported.</span></div><button className="button secondary" onClick={loadRows}>Refresh</button></div>
      {rows.length === 0 ? <p className="muted-text">No ambulances registered yet.</p> : <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Vehicle</th><th>Hospital</th><th>Type</th><th>Status</th><th>Incident</th><th>Last position</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.ambulance.ambulance_id}>
          <td>{row.ambulance.ambulance_id}</td>
          <td>{row.ambulance.hospital_name || row.ambulance.hospital_id}</td>
          <td>{row.ambulance.vehicle_type}</td>
          <td>{row.ambulance.status}</td>
          <td>{row.incident?.incident_id || "—"}</td>
          <td>{row.ambulance.last_position ? `${formatAgo(row.ambulance.last_position.recorded_at)} · ${row.ambulance.last_position.source || "SIMULATION"}` : "—"}</td>
        </tr>)}</tbody>
      </table></div>}
    </div>
  </section>;
}
