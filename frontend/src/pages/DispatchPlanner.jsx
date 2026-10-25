import { useEffect, useState } from "react";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

const EXAMPLE_NETWORK = {
  nodes: [
    { node_id: "J1", latitude: 18.5204, longitude: 73.8567 },
    { node_id: "J2", latitude: 18.5230, longitude: 73.8500 },
    { node_id: "J3", latitude: 18.5310, longitude: 73.8440 },
  ],
  edges: [
    { from: "J1", to: "J2", distance_km: 1.2, travel_time_min: 4, bidirectional: true },
    { from: "J2", to: "J3", distance_km: 2.1, travel_time_min: 7, bidirectional: true },
  ],
};

export default function DispatchPlanner() {
  const [incidents, setIncidents] = useState([]);
  const [incidentId, setIncidentId] = useState("");
  const [result, setResult] = useState(null);
  const [networkText, setNetworkText] = useState(JSON.stringify(EXAMPLE_NETWORK, null, 2));
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const [rows, net, metricData] = await Promise.all([
        api.incidents.list(), api.dispatch.roadNetwork(), api.admin.engineeringMetrics(),
      ]);
      setIncidents(Array.isArray(rows) ? rows : []);
      setNetworkText(JSON.stringify(net.network || { nodes: [], edges: [] }, null, 2));
      setMetrics(metricData);
      const first = Array.isArray(rows) && rows.length ? rows[0].incident_id : "";
      setIncidentId((current) => current || first);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(async () => {
      try {
        const rows = await api.incidents.list();
        const currentRows = Array.isArray(rows) ? rows : [];
        setIncidents(currentRows);
        setIncidentId((current) =>
          currentRows.some((row) => row.incident_id === current)
            ? current
            : (currentRows[0]?.incident_id || "")
        );
      } catch (e) {
        // Keep the last successful snapshot visible if a transient poll fails.
        console.warn("Could not refresh dispatch incidents:", e);
      }
    }, 5000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  async function rank() {
    if (!incidentId) return;
    setBusy(true); setError(""); setNotice("");
    try { setResult(await api.dispatch.recommendations(incidentId)); }
    catch (e) { setError(e.message); setResult(null); }
    finally { setBusy(false); }
  }

  async function selectFacility(facility) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await api.dispatch.selectFacility(incidentId, facility.facility_id);
      setNotice(response.message || `Selected ${facility.name}.`);
      await load();
      setIncidentId(response.incident_id);
      await rank();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function saveNetwork() {
    setBusy(true); setError(""); setNotice("");
    try {
      const network = JSON.parse(networkText);
      const saved = await api.dispatch.saveRoadNetwork(network);
      setNotice(`Saved road graph: ${saved.node_count} nodes, ${saved.edge_count} edges.`);
      if (incidentId) await rank();
    } catch (e) { setError(e instanceof SyntaxError ? "Road graph must be valid JSON." : e.message); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading label="Loading dispatch planner..." />;

  return <section>
    <div className="page-heading"><div><span className="eyebrow">ENGINEERING MODULE</span><h2>Intelligent dispatch planner</h2><p>Rank suitable facilities using capability, availability, resource status and estimated travel time.</p></div><button className="button secondary" onClick={load}>Refresh data</button></div>
    <ErrorMessage message={error} />
    {notice && <p className="success-message">{notice}</p>}

    <div className="panel" style={{ marginBottom: 20 }}>
      <h3>1. Select an incident</h3>
      <div className="form-row" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <select className="month-input" value={incidentId} onChange={(e) => { setIncidentId(e.target.value); setResult(null); }}>
          <option value="">Choose incident</option>
          {incidents.map((i) => <option key={i.incident_id} value={i.incident_id}>{i.incident_id} · {i.status} · {
  typeof i.severity === "object" && i.severity !== null
    ? (i.severity.level ?? "severity unknown")
    : (i.severity ?? "severity unknown")
}</option>)}
        </select>
        <button className="button primary" disabled={!incidentId || busy} onClick={rank}>{busy ? "Calculating…" : "Rank facilities"}</button>
      </div>
      {result && <p className="muted-text">Routing mode: <strong>{result.routing_mode}</strong>. Required capabilities: {result.required_capabilities.join(", ")}. {result.notice}</p>}
    </div>

    {result && <div className="panel" style={{ marginBottom: 20 }}>
      <h3>2. Ranked recommendations</h3>
      {!result.recommendations.length && <p>No currently available facility matches the required capability. Check facility status/capabilities or add a suitable facility.</p>}
      <div className="hospital-grid">
        {result.recommendations.map((facility) => <article className="hospital-card" key={facility.facility_id}>
          <div className="card-topline"><span className="hospital-code">#{facility.rank} · {facility.facility_id}</span><span className="status-badge">{facility.facility_type}</span></div>
          <h3>{facility.name}</h3><p>Matched capability: <strong>{facility.matched_capability}</strong></p>
          <div className="detail-list compact">
            <div className="detail-row"><span>Travel estimate</span><strong>{facility.route.travel_time_min} min</strong></div>
            <div className="detail-row"><span>Distance</span><strong>{facility.route.distance_km} km</strong></div>
            <div className="detail-row"><span>Ambulances reported</span><strong>{facility.available_ambulances}</strong></div>
            <div className="detail-row"><span>Emergency staff</span><strong>{facility.emergency_staff}</strong></div>
            <div className="detail-row"><span>Capabilities</span><strong>{facility.capabilities.join(", ")}</strong></div>
          </div>
          <p className="muted-text">{facility.route.notice}</p>
          <button className="button primary full" disabled={busy || result.incident_status !== "PENDING"} onClick={() => selectFacility(facility)}>Route incident to this facility</button>
        </article>)}
      </div>
    </div>}

    <div className="panel" style={{ marginBottom: 20 }}>
      <h3>3. Road network graph (admin configuration)</h3>
      <p className="muted-text">Use nodes with coordinates and edges with distance_km and travel_time_min. For a defensible demonstration, create graph edges from a documented sample road network. Until configured, the system explicitly labels its output as a straight-line estimate—not a live road ETA.</p>
      <textarea value={networkText} onChange={(e) => setNetworkText(e.target.value)} rows={12} spellCheck={false} style={{ width: "100%", fontFamily: "monospace", fontSize: 13, padding: 12, borderRadius: 8, border: "1px solid #d0d7e2" }} />
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}><button className="button secondary" onClick={() => setNetworkText(JSON.stringify(EXAMPLE_NETWORK, null, 2))}>Load sample graph</button><button className="button primary" disabled={busy} onClick={saveNetwork}>Validate and save graph</button></div>
    </div>

    {metrics && <div className="panel">
      <h3>4. Operational engineering metrics</h3>
      <div className="stats-grid">
        <div className="stat-card"><span>Incidents tracked</span><strong>{metrics.incident_count}</strong></div>
        <div className="stat-card"><span>Average pipeline time</span><strong>{metrics.pipeline_processing_seconds.average == null ? "N/A" : `${metrics.pipeline_processing_seconds.average}s`}</strong></div>
        <div className="stat-card"><span>Detection → acceptance</span><strong>{metrics.detection_to_accept_seconds.average == null ? "N/A" : `${metrics.detection_to_accept_seconds.average}s`}</strong></div>
        <div className="stat-card"><span>Acceptance → dispatch</span><strong>{metrics.accept_to_dispatch_seconds.average == null ? "N/A" : `${metrics.accept_to_dispatch_seconds.average}s`}</strong></div>
      </div>
      <p className="muted-text">{metrics.important_note}</p>
    </div>}
  </section>;
}
