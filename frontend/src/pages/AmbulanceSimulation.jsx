import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

function FitRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [38, 38] });
    else if (points.length === 1) map.setView(points[0], 14);
  }, [map, points]);
  return null;
}
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : null;

export default function AmbulanceSimulation() {
  const [rows, setRows] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("This is a public demo control page. Movement is simulated, not physical GPS.");

  const load = useCallback(async (first = false) => {
    try {
      const data = await api.simulation.active();
      const safe = Array.isArray(data) ? data : [];
      setRows(safe);
      setSelectedId((old) => safe.some((x) => x.incident_id === old) ? old : (safe[0]?.incident_id || ""));
      setError("");
    } catch (e) { setError(e.message || "Could not load accepted incidents."); }
    finally { if (first) setLoading(false); }
  }, []);

  useEffect(() => { load(true); const t = window.setInterval(() => load(false), 2000); return () => window.clearInterval(t); }, [load]);
  const incident = rows.find((x) => x.incident_id === selectedId) || rows[0] || null;
  const facility = incident?.simulation_hospital || {};
  const hospitalPoint = facility.latitude != null && facility.longitude != null ? [n(facility.latitude), n(facility.longitude)] : null;
  const incidentPoint = incident && n(incident.latitude) !== null && n(incident.longitude) !== null ? [n(incident.latitude), n(incident.longitude)] : null;
  const route = useMemo(() => hospitalPoint && incidentPoint ? [hospitalPoint, incidentPoint] : [], [hospitalPoint?.[0], hospitalPoint?.[1], incidentPoint?.[0], incidentPoint?.[1]]);
  const progress = Math.max(0, Math.min(1, n(incident?.simulation_progress) ?? (incident?.status === "ARRIVED" ? 1 : 0)));
  const ambulancePoint = route.length === 2 ? [route[0][0] + (route[1][0] - route[0][0]) * progress, route[0][1] + (route[1][1] - route[0][1]) * progress] : null;

  async function action(name) {
    if (!incident?.incident_id) return;
    setBusy(true); setError("");
    try {
      const updated = await api.simulation[name](incident.incident_id);
      setRows((old) => old.map((x) => x.incident_id === updated.incident_id ? updated : x));
      setMessage(name === "start" ? `Simulation started for ${facility.name || incident.hospital_id}. Use Move to advance the ambulance.` : name === "move" ? (updated.status === "ARRIVED" ? "Ambulance reached the accident location in the simulation." : `Ambulance moved to ${Math.round((updated.simulation_progress || 0) * 100)}% of the route.`) : "Simulation progress reset.");
      await load(false);
    } catch (e) { setError(e.message || "Simulation action failed."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page-content"><Loading label="Loading ambulance simulation…" /></div>;
  return <main style={{ minHeight: "100vh", background: "#f1f5f9", padding: "24px", color: "#0f172a" }}>
    <div style={{ maxWidth: 1280, margin: "0 auto" }}>
      <div className="page-heading"><div><span className="eyebrow">PUBLIC DEMONSTRATION CONTROL</span><h2>Ambulance GPS Simulation</h2><p>Use this separate page to advance the demo ambulance. Admin and hospital views read the same saved progress.</p></div><span className="status-badge">SIMULATED GPS</span></div>
      <ErrorMessage message={error} />
      <div className="panel" style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
          <div style={{ flex: "1 1 260px" }}><label htmlFor="sim-incident" style={{ display: "block", fontWeight: 700, marginBottom: 7 }}>Accepted incident</label><select id="sim-incident" value={incident?.incident_id || ""} onChange={(e) => setSelectedId(e.target.value)} style={{ width: "100%", padding: 12, borderRadius: 8, border: "1px solid #cbd5e1" }}><option value="">No accepted incidents</option>{rows.map((x) => <option key={x.incident_id} value={x.incident_id}>{x.incident_id} · {x.accepted_by_hospital || x.hospital_id} · {x.status}</option>)}</select></div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 22 }}><button className="button primary" disabled={!incident || busy || incident.status === "ARRIVED"} onClick={() => action("start")}>{busy ? "Working…" : "Start"}</button><button className="button primary" disabled={!incident || busy || incident.status === "ARRIVED"} onClick={() => action("move")}>Move →</button><button className="button secondary" disabled={!incident || busy} onClick={() => action("reset")}>Reset</button><button className="button secondary" onClick={() => load(false)}>Refresh</button></div>
        </div>
        <p className="muted-text" style={{ marginBottom: 0, marginTop: 12 }}>{message}</p>
      </div>
      {!incident ? <div className="panel" style={{ padding: 48, textAlign: "center" }}><h3>Waiting for a hospital or clinic to accept an incident</h3><p className="muted-text">Once a facility accepts an incident, it will appear here automatically. This page does not create or accept incidents.</p></div> : <>
        <div className="stats-grid" style={{ marginBottom: 18 }}><div className="stat-card"><span>Accepted facility</span><strong style={{ fontSize: 16 }}>{facility.name || incident.accepted_by_hospital || incident.hospital_id}</strong></div><div className="stat-card"><span>Incident</span><strong style={{ fontSize: 16 }}>{incident.incident_id}</strong></div><div className="stat-card"><span>Route progress</span><strong>{Math.round(progress * 100)}%</strong></div><div className="stat-card"><span>Status</span><strong style={{ fontSize: 16 }}>{incident.status}</strong></div></div>
        <div className="panel"><div className="page-heading" style={{ marginBottom: 12 }}><div><span className="eyebrow">SHARED LIVE VIEW</span><h3>Ambulance route</h3></div><span className="status-badge">{Math.round(progress * 100)}% complete</span></div>
          {!route.length ? <p className="muted-text">The hospital or incident coordinates are missing, so the route cannot be drawn.</p> : <MapContainer center={hospitalPoint} zoom={13} scrollWheelZoom style={{ height: 520, width: "100%", borderRadius: 12 }}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitRoute points={[...route, ...(ambulancePoint ? [ambulancePoint] : [])]}/><Polyline positions={route} pathOptions={{ color: "#64748b", weight: 5, dashArray: "7 7" }}/><Polyline positions={progress > 0 && ambulancePoint ? [route[0], ambulancePoint] : []} pathOptions={{ color: "#dc2626", weight: 5 }}/><Marker position={hospitalPoint}><Popup>{facility.name || incident.hospital_id} — dispatching facility</Popup><Tooltip>{facility.name || incident.hospital_id}</Tooltip></Marker><CircleMarker center={incidentPoint} radius={10} pathOptions={{ color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 1 }}><Popup>Accident location · {incident.incident_id}</Popup><Tooltip>Accident location</Tooltip></CircleMarker>{ambulancePoint && <CircleMarker center={ambulancePoint} radius={9} pathOptions={{ color: "#075985", fillColor: "#38bdf8", fillOpacity: 1 }}><Popup>Simulated ambulance · {Math.round(progress * 100)}%</Popup><Tooltip>🚑 Simulated ambulance</Tooltip></CircleMarker>}</MapContainer>}
          <p className="muted-text" style={{ marginTop: 12 }}>Each Move advances the saved position by one step. Open the admin Dispatch Planner or hospital dashboard in another window to observe the shared status/progress. This is not a real GPS signal or a road-following navigation route.</p>
        </div>
      </>}
    </div>
  </main>;
}
