import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

function FitRoute({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [36, 36] });
    else if (points.length === 1) map.setView(points[0], 14);
  }, [map, points]);
  return null;
}

const TRACKED_STATUSES = new Set(["RESPONSE_ACCEPTED", "ACCEPTED", "DISPATCHED", "EN_ROUTE", "ARRIVED", "RESOLVED"]);
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

export default function DispatchPlanner() {
  const [incidents, setIncidents] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [incidentId, setIncidentId] = useState("");
  const [recommendations, setRecommendations] = useState(null);
  const [benchmark, setBenchmark] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);

  const load = useCallback(async (initial = false) => {
    try {
      if (initial) setLoading(true);
      const [incidentRows, facilityRows] = await Promise.all([api.incidents.list(), api.hospitals.list()]);
      const safeIncidents = Array.isArray(incidentRows) ? incidentRows : [];
      setIncidents(safeIncidents);
      setHospitals(Array.isArray(facilityRows) ? facilityRows : []);
      setIncidentId((current) => current || safeIncidents.find((i) => String(i.status).toUpperCase() === "PENDING")?.incident_id || safeIncidents[0]?.incident_id || "");
      setError("");
    } catch (e) { setError(e.message || "Could not load dispatch data."); }
    finally { if (initial) setLoading(false); }
  }, []);

  useEffect(() => { load(true); const timer = window.setInterval(() => load(false), 5000); return () => window.clearInterval(timer); }, [load]);

  const selectedIncident = incidents.find((i) => String(i.incident_id) === String(incidentId));
  const trackingIncidents = incidents.filter((i) => TRACKED_STATUSES.has(String(i.status || "").toUpperCase()) && num(i.latitude) !== null && num(i.longitude) !== null && i.hospital_id);
  const trackingIncident = trackingIncidents.find((i) => String(i.incident_id) === String(incidentId)) || trackingIncidents[0] || null;
  const trackingHospital = trackingIncident ? hospitals.find((h) => String(h.hospital_id) === String(trackingIncident.hospital_id)) : null;
  const incidentPoint = trackingIncident && num(trackingIncident.latitude) !== null && num(trackingIncident.longitude) !== null ? [num(trackingIncident.latitude), num(trackingIncident.longitude)] : null;
  const hospitalPoint = trackingHospital && num(trackingHospital.latitude) !== null && num(trackingHospital.longitude) !== null ? [num(trackingHospital.latitude), num(trackingHospital.longitude)] : null;
  const routePoints = useMemo(() => incidentPoint && hospitalPoint ? [hospitalPoint, incidentPoint] : [], [incidentPoint?.[0], incidentPoint?.[1], hospitalPoint?.[0], hospitalPoint?.[1]]);
  const ambulancePoint = useMemo(() => {
    if (routePoints.length < 2) return null;
    const t = Math.max(0, Math.min(1, progress));
    return [routePoints[0][0] + (routePoints[1][0] - routePoints[0][0]) * t, routePoints[0][1] + (routePoints[1][1] - routePoints[0][1]) * t];
  }, [routePoints, progress]);

  useEffect(() => {
    if (!trackingIncident || !routePoints.length) { setProgress(0); return; }
    const saved = Number(trackingIncident.simulation_progress);
    if (Number.isFinite(saved)) setProgress(Math.max(0, Math.min(1, saved)));
    else if (["ARRIVED", "RESOLVED"].includes(String(trackingIncident.status || "").toUpperCase())) setProgress(1);
    else setProgress(0);
  }, [trackingIncident?.incident_id, trackingIncident?.status, trackingIncident?.simulation_progress, routePoints.length]);

  async function rankNearby() {
    if (!incidentId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const data = await api.dispatch.recommendations(incidentId);
      setRecommendations(data);
    } catch (e) { setError(e.message || "Could not rank nearby facilities."); setRecommendations(null); }
    finally { setBusy(false); }
  }

  async function runBenchmark() {
    setBenchmarkBusy(true); setError("");
    try { setBenchmark(await api.engineering.routingBenchmark("sample")); }
    catch (e) { setError(e.message || "Benchmark failed."); }
    finally { setBenchmarkBusy(false); }
  }

  if (loading) return <Loading label="Loading dispatch planner..." />;

  return <section>
    <div className="page-heading"><div><span className="eyebrow">ADMIN DISPATCH</span><h2>Incident dispatch & ambulance tracking</h2><p>Nearby facilities are notified when an incident is detected. The route view appears only after a facility accepts the incident.</p></div><button className="button secondary" onClick={() => load(false)}>Refresh</button></div>
    <ErrorMessage message={error} />
    {notice && <p className="success-message">{notice}</p>}

    <div className="panel" style={{ marginBottom: 20 }}>
      <h3>Incident queue</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <select className="month-input" value={incidentId} onChange={(e) => { setIncidentId(e.target.value); setRecommendations(null); }}>
          <option value="">Choose incident</option>
          {incidents.map((i) => <option key={i.incident_id} value={i.incident_id}>{i.incident_id} · {i.status} · {typeof i.severity === "object" ? (i.severity?.level || "Severity unknown") : (i.severity || "Severity unknown")}</option>)}
        </select>
        <button className="button secondary" disabled={!incidentId || busy || String(selectedIncident?.status).toUpperCase() !== "PENDING"} onClick={rankNearby}>{busy ? "Checking…" : "View nearby facility ranking"}</button>
      </div>
      {selectedIncident && <div className="detail-list compact" style={{ marginTop: 12 }}>
        <div className="detail-row"><span>Incident status</span><strong>{selectedIncident.status}</strong></div>
        <div className="detail-row"><span>Accident coordinates</span><strong>{selectedIncident.latitude ?? "N/A"}, {selectedIncident.longitude ?? "N/A"}</strong></div>
        <div className="detail-row"><span>Accepted facility</span><strong>{selectedIncident.hospital_id ? (hospitals.find((h) => h.hospital_id === selectedIncident.hospital_id)?.name || selectedIncident.hospital_id) : "Waiting for first acceptance"}</strong></div>
      </div>}
      {recommendations && <div style={{ marginTop: 14 }}><p className="muted-text">Nearby facilities are ranked for review only. Eligible hospitals/clinics receive the incident on their own dashboard; the first valid acceptance claims it. No route graph is shown before acceptance.</p><div className="hospital-grid">{(recommendations.recommendations || []).slice(0, 3).map((f) => <article className="hospital-card" key={f.facility_id}><div className="card-topline"><span className="hospital-code">Rank #{f.rank}</span><span className="status-badge">{f.facility_type}</span></div><h3>{f.name}</h3><p>{f.latitude}, {f.longitude}</p><div className="detail-list compact"><div className="detail-row"><span>Distance estimate</span><strong>{f.route?.distance_km ?? f.distance_km ?? "—"} km</strong></div><div className="detail-row"><span>Estimated travel time</span><strong>{f.route?.travel_time_min ?? "—"} min</strong></div><div className="detail-row"><span>Ambulances</span><strong>{f.available_ambulances ?? 0}</strong></div></div></article>)}</div></div>}
    </div>

    <div className="panel" style={{ marginBottom: 20 }}>
      <div className="page-heading" style={{ marginBottom: 8 }}><div><span className="eyebrow">POST-ACCEPTANCE VIEW</span><h3>Ambulance route network</h3></div><span className="status-badge">{trackingIncident ? trackingIncident.status : "NO ACTIVE ROUTE"}</span></div>
      {!trackingIncident ? <div style={{ padding: "34px 16px", textAlign: "center" }}><h3>No ambulance route to display yet</h3><p className="muted-text">The map stays empty until a nearby hospital or clinic accepts an incident. Pending incidents do not display road nodes, edges or a route.</p></div> : !hospitalPoint || !incidentPoint ? <p className="muted-text">The accepted incident or facility is missing coordinates, so the route cannot be displayed.</p> : <>
        <p className="muted-text">Showing the accepted facility and accident location. The moving ambulance marker is a prototype simulation, not physical GPS or live road traffic.</p>
        <MapContainer center={hospitalPoint} zoom={13} scrollWheelZoom style={{ height: 430, width: "100%", borderRadius: 12 }}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitRoute points={[...routePoints, ...(ambulancePoint ? [ambulancePoint] : [])]}/><Polyline positions={routePoints} pathOptions={{ color: "#64748b", weight: 5, dashArray: "7 7" }}/><Polyline positions={progress > 0 ? [routePoints[0], ambulancePoint] : []} pathOptions={{ color: "#dc2626", weight: 5 }}/><Marker position={hospitalPoint}><Popup>{trackingHospital?.name || trackingIncident.hospital_id} — dispatching facility</Popup><Tooltip>{trackingHospital?.name || trackingIncident.hospital_id}</Tooltip></Marker><CircleMarker center={incidentPoint} radius={10} pathOptions={{ color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 1 }}><Popup>Accident location · {trackingIncident.incident_id}</Popup><Tooltip>Accident location</Tooltip></CircleMarker>{ambulancePoint && <CircleMarker center={ambulancePoint} radius={8} pathOptions={{ color: "#075985", fillColor: "#38bdf8", fillOpacity: 1 }}><Popup>Simulated ambulance position · {Math.round(progress * 100)}% of illustrative route</Popup><Tooltip>Simulated ambulance</Tooltip></CircleMarker>}</MapContainer>
        <div className="stats-grid" style={{ marginTop: 14 }}><div className="stat-card"><span>Incident</span><strong style={{ fontSize: 16 }}>{trackingIncident.incident_id}</strong></div><div className="stat-card"><span>Accepted by</span><strong style={{ fontSize: 16 }}>{trackingHospital?.name || trackingIncident.hospital_id}</strong></div><div className="stat-card"><span>Simulation progress</span><strong>{Math.round(progress * 100)}%</strong></div><div className="stat-card"><span>Tracking source</span><strong style={{ fontSize: 16 }}>Prototype simulation</strong></div></div>
      </>}
    </div>

    <div className="panel">
      <div className="page-heading" style={{ marginBottom: 8 }}><div><span className="eyebrow">ALGORITHM DEMONSTRATION</span><h3>Dijkstra vs A* route benchmark</h3></div><button className="button primary" disabled={benchmarkBusy} onClick={runBenchmark}>{benchmarkBusy ? "Running…" : "Run comparison"}</button></div>
      <p className="muted-text">This uses a small synthetic graph for your B.Tech demonstration, not live Pune road data. Both algorithms should return the same optimal route cost; A* uses a goal-directed heuristic and may explore fewer nodes. Runtime can vary on tiny graphs, so the comparison does not claim A* is always faster in every run.</p>
      {benchmark && <><div className="stats-grid" style={{ marginTop: 14 }}><div className="stat-card"><span>Sample graph</span><strong style={{ fontSize: 16 }}>{benchmark.node_count} nodes · {benchmark.edge_count} edges</strong></div><div className="stat-card"><span>Dijkstra runtime</span><strong>{benchmark.averages.dijkstra_execution_ms} ms</strong></div><div className="stat-card"><span>A* runtime</span><strong>{benchmark.averages.astar_execution_ms} ms</strong></div><div className="stat-card"><span>Optimal costs match</span><strong>{benchmark.all_optimal_costs_match ? "Yes" : "No"}</strong></div></div><div style={{ overflowX: "auto", marginTop: 14 }}><table className="data-table"><thead><tr><th>Route</th><th>Dijkstra cost (min)</th><th>A* cost (min)</th><th>Dijkstra nodes explored</th><th>A* nodes explored</th><th>Cost match</th></tr></thead><tbody>{(benchmark.cases || []).map((c) => <tr key={`${c.start}-${c.goal}`}><td>{c.start} → {c.goal}</td><td>{c.dijkstra.travel_time_min ?? "Unreachable"}</td><td>{c.astar.travel_time_min ?? "Unreachable"}</td><td>{c.dijkstra.nodes_expanded}</td><td>{c.astar.nodes_expanded}</td><td>{c.optimal_cost_matches ? "Yes" : "No"}</td></tr>)}</tbody></table></div><p className="muted-text">A* explored-node reduction average: {benchmark.averages.astar_nodes_expanded_reduction_pct}%.</p></>}
    </div>
  </section>;
}
