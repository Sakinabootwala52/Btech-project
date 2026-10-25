import { useEffect, useState } from "react";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";
import MapView from "../components/MapView";

export default function Ambulances() {
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const isAdmin = auth?.role === "admin";
  const [rows, setRows] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [form, setForm] = useState({ ambulance_id: "", hospital_id: "", vehicle_type: "BLS", plate_number: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [simHospitals, setSimHospitals] = useState([]);
  const [simIncidents, setSimIncidents] = useState([]);
  const [simIncidentId, setSimIncidentId] = useState("");
  const [simHospitalId, setSimHospitalId] = useState("");
  const [simProgress, setSimProgress] = useState(0);
  const [simStarted, setSimStarted] = useState(false);
  const [simNotice, setSimNotice] = useState("Prototype only: this marker is simulated; no GPS device or live traffic feed is connected.");
  async function load() {
    setError("");
    try {
      const data = await api.ambulances.list(); setRows(Array.isArray(data) ? data : []);
      if (isAdmin) {
        const [facilityRows, incidentRows] = await Promise.all([api.hospitals.list(), api.incidents.list()]);
        setHospitals(facilityRows);
        setSimHospitals(facilityRows);
        setSimIncidents(Array.isArray(incidentRows) ? incidentRows : []);
        setSimIncidentId((current) => current || (incidentRows?.[0]?.incident_id || ""));
        setSimHospitalId((current) => current || (facilityRows?.[0]?.hospital_id || ""));
      } else {
        const own = await api.hospitals.me();
        setSimHospitals(own ? [own] : []);
        setSimHospitalId(own?.hospital_id || "");
        const history = await api.hospitals.history();
        setSimIncidents(Array.isArray(history) ? history : []);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  async function register(e) {
    e.preventDefault(); setError(""); setNotice("");
    try { await api.ambulances.register(form); setForm({ ambulance_id: "", hospital_id: "", vehicle_type: "BLS", plate_number: "" }); setNotice("Ambulance registered."); await load(); }
    catch (e) { setError(e.message); }
  }
  async function updateStatus(row, status) {
    setError(""); setNotice("");
    try { await api.ambulances.updateStatus(row.ambulance_id, status); await load(); }
    catch (e) { setError(e.message); }
  }
  if (loading) return <Loading label="Loading ambulance registry..." />;
  return <section>
    <div className="page-heading"><div><span className="eyebrow">FLEET MANAGEMENT</span><h2>Ambulance registry</h2><p>Track individually registered vehicles and prevent one vehicle being assigned to two incidents.</p></div><button className="button secondary" onClick={load}>Refresh</button></div>
    <ErrorMessage message={error} />{notice && <p className="success-message">{notice}</p>}
    {isAdmin && <form className="panel" onSubmit={register} style={{ marginBottom: 20 }}>
      <h3>Register ambulance</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
        <input required placeholder="Unique ambulance ID" value={form.ambulance_id} onChange={(e) => setForm({ ...form, ambulance_id: e.target.value })} />
        <select required value={form.hospital_id} onChange={(e) => setForm({ ...form, hospital_id: e.target.value })}><option value="">Select facility</option>{hospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.name} ({h.hospital_id})</option>)}</select>
        <select value={form.vehicle_type} onChange={(e) => setForm({ ...form, vehicle_type: e.target.value })}><option value="BLS">BLS</option><option value="ALS">ALS</option><option value="FIRST_AID">First-aid vehicle</option></select>
        <input placeholder="Vehicle / plate number (optional)" value={form.plate_number} onChange={(e) => setForm({ ...form, plate_number: e.target.value })} />
      </div><button className="button primary" type="submit" style={{ marginTop: 12 }}>Register vehicle</button>
    </form>}
    <div className="panel"><h3>Registered vehicles ({rows.length})</h3>
      {rows.length === 0 ? <p>No ambulances registered yet. Admin can register a vehicle above.</p> : <div style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Vehicle ID</th><th>Facility</th><th>Type</th><th>Plate</th><th>Status</th><th>Incident</th><th>Action</th></tr></thead><tbody>{rows.map((r) => <tr key={r.ambulance_id}><td>{r.ambulance_id}</td><td>{r.hospital_name || r.hospital_id}</td><td>{r.vehicle_type}</td><td>{r.plate_number || "—"}</td><td>{r.status}</td><td>{r.incident_id || "—"}</td><td>{["AVAILABLE", "OUT_OF_SERVICE"].includes(r.status) && <select value={r.status} onChange={(e) => updateStatus(r, e.target.value)}><option value="AVAILABLE">AVAILABLE</option><option value="OUT_OF_SERVICE">OUT_OF_SERVICE</option></select>}</td></tr>)}</tbody></table></div>}
    </div>

    <div className="panel" style={{ marginTop: 20 }}>
      <div className="page-heading" style={{ marginBottom: 12 }}><div><span className="eyebrow">GPS PROTOTYPE · NOT A LIVE FEED</span><h2>Ambulance journey simulator</h2><p>Hospital staff can request dispatch, but journey progress is controlled here for demonstration. The hospital cannot edit the ambulance position.</p></div></div>
      <p className="muted-text">{simNotice} The route line is illustrative and the orange traffic circles are mock obstacles, not verified road/traffic data.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12, marginBottom: 14 }}>
        {isAdmin && <label>Incident<select style={{ display: "block", width: "100%", marginTop: 6 }} value={simIncidentId} onChange={(e) => { setSimIncidentId(e.target.value); setSimProgress(0); setSimStarted(false); }}><option value="">Demo accident location</option>{simIncidents.map((i) => <option key={i.incident_id} value={i.incident_id}>{i.incident_id} · {i.status}</option>)}</select></label>}
        {isAdmin ? <label>Destination facility<select style={{ display: "block", width: "100%", marginTop: 6 }} value={simHospitalId} onChange={(e) => { setSimHospitalId(e.target.value); setSimProgress(0); setSimStarted(false); }}><option value="">Choose facility</option>{simHospitals.map((h) => <option key={h.hospital_id} value={h.hospital_id}>{h.name}</option>)}</select></label> : <div><span className="muted-text">Destination facility</span><p><strong>{simHospitals[0]?.name || "Your facility"}</strong></p></div>}
      </div>
      {isAdmin && <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}><button className="button primary" disabled={!simHospitalId} onClick={() => { setSimProgress(0); setSimStarted(true); setSimNotice("Simulation started. Advance the ambulance using the step control; no GPS hardware is being read."); }}>Start / reset journey</button><button className="button secondary" disabled={!simStarted || simProgress >= 100} onClick={() => { const next = Math.min(100, simProgress + 20); setSimProgress(next); if (next >= 100) setSimNotice("Simulated arrival reached. This does not update a real ambulance or incident record."); }}>Advance 20%</button><span className="status-badge">{!simStarted ? "NOT STARTED" : simProgress >= 100 ? "SIMULATED ARRIVAL" : `EN ROUTE · ${simProgress}%`}</span></div>}
      {(() => {
        const incident = simIncidents.find((i) => i.incident_id === simIncidentId);
        const destination = simHospitals.find((h) => h.hospital_id === simHospitalId);
        const origin = { latitude: Number(incident?.latitude ?? 18.5204), longitude: Number(incident?.longitude ?? 73.8567) };
        const dest = destination ? { latitude: Number(destination.latitude), longitude: Number(destination.longitude) } : null;
        const visibleProgress = isAdmin ? simProgress : 40;
        const t = visibleProgress / 100;
        const marker = dest ? { latitude: origin.latitude + (dest.latitude - origin.latitude) * t, longitude: origin.longitude + (dest.longitude - origin.longitude) * t, label: "SIM-AMB-01", status: visibleProgress >= 100 ? "Simulated arrival" : "En route (simulated preview)" } : null;
        const hospitalsToShow = simHospitals.map((h) => ({ ...h, resources: h.resources || {}, attended: 0 }));
        const traffic = dest ? [{ id: "mock-traffic-1", latitude: origin.latitude + (dest.latitude-origin.latitude)*0.38, longitude: origin.longitude + (dest.longitude-origin.longitude)*0.38, label: "Mock traffic congestion", detail: "A simulated obstacle to demonstrate map overlays." }, { id: "mock-incident-2", latitude: origin.latitude + (dest.latitude-origin.latitude)*0.72, longitude: origin.longitude + (dest.longitude-origin.longitude)*0.72, label: "Mock road incident", detail: "Illustrative road hazard; not detected from live feeds." }] : [];
        return <><MapView hospitals={hospitalsToShow} incidents={incident ? [incident] : []} routePath={dest ? [[origin.latitude, origin.longitude], [dest.latitude, dest.longitude]] : []} simulatedAmbulance={isAdmin ? (simStarted ? marker : null) : marker} trafficEvents={traffic} height={470} /><div className="stats-grid" style={{ marginTop: 14 }}><div className="stat-card"><span>Progress</span><strong>{isAdmin ? simProgress : 40}%</strong></div><div className="stat-card"><span>Illustrative distance</span><strong>{dest ? `${(Math.hypot((dest.latitude-origin.latitude)*111, (dest.longitude-origin.longitude)*105)).toFixed(2)} km` : "—"}</strong></div><div className="stat-card"><span>Estimated time</span><strong>{dest ? `${Math.round(Math.hypot((dest.latitude-origin.latitude)*111, (dest.longitude-origin.longitude)*105) / 25 * 60)} min` : "—"}</strong></div><div className="stat-card"><span>Traffic overlays</span><strong>{traffic.length}</strong></div></div><p className="muted-text">Distance and ETA above are rough straight-line demo estimates. This page demonstrates a future GPS workflow; it does not run live A* routing, access a GPS device, or ingest real-time traffic.</p></>;
      })()}
    </div>
  </section>;
}
