import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

function Metric({ label, value, detail }) {
  return <div className="stat-card"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export default function CommandCentre() {
  const [incidents, setIncidents] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [ambulances, setAmbulances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (initial = false) => {
    try {
      const [incidentRows, hospitalRows, ambulanceRows] = await Promise.all([api.incidents.list(), api.hospitals.list(), api.ambulances.list()]);
      setIncidents(Array.isArray(incidentRows) ? incidentRows : []);
      setHospitals(Array.isArray(hospitalRows) ? hospitalRows : []);
      setAmbulances(Array.isArray(ambulanceRows) ? ambulanceRows : []);
      setError("");
    } catch (e) { setError(e.message || "Could not load command-centre data."); }
    finally { if (initial) setLoading(false); }
  }, []);

  useEffect(() => { load(true); const timer = window.setInterval(() => load(false), 5000); return () => window.clearInterval(timer); }, [load]);
  if (loading) return <Loading label="Loading command centre..." />;

  const pending = incidents.filter((i) => String(i.status || "").toUpperCase() === "PENDING").length;
  const active = incidents.filter((i) => ["RESPONSE_ACCEPTED", "ACCEPTED", "DISPATCHED", "EN_ROUTE"].includes(String(i.status || "").toUpperCase())).length;
  const arrived = incidents.filter((i) => ["ARRIVED", "RESOLVED"].includes(String(i.status || "").toUpperCase())).length;
  const availableAmbulances = ambulances.filter((a) => String(a.status || "").toUpperCase() === "AVAILABLE").length;

  return <section>
    <div className="page-heading"><div><span className="eyebrow">ADMIN OVERVIEW</span><h2>Accident Response Command Centre</h2><p>Monitor incident status and registered emergency resources. Route tracking appears in Dispatch Planner only after a facility accepts an incident.</p></div><button className="button secondary" onClick={() => load(false)}>Refresh</button></div>
    <ErrorMessage message={error} />
    <div className="stats-grid"><Metric label="Pending incidents" value={pending} detail="Waiting for a nearby facility to accept"/><Metric label="Active responses" value={active} detail="Accepted or dispatched"/><Metric label="Arrived / resolved" value={arrived} detail="Recorded completed responses"/><Metric label="Registered hospitals & clinics" value={hospitals.length} detail="From MongoDB"/><Metric label="Available ambulances" value={availableAmbulances} detail={`${ambulances.length} registered total`}/></div>
    <div className="panel" style={{ marginTop: 20 }}><div className="page-heading" style={{ marginBottom: 8 }}><div><span className="eyebrow">INCIDENT QUEUE</span><h3>Recent incidents</h3></div></div>
      {!incidents.length ? <p className="muted-text">No incidents have been recorded yet. The route map remains empty until a nearby facility accepts an incident.</p> : <div style={{ overflowX: "auto" }}><table className="data-table"><thead><tr><th>Incident</th><th>Location (lat, long)</th><th>Severity</th><th>Status</th><th>Accepted facility</th></tr></thead><tbody>{incidents.slice(0, 15).map((i) => <tr key={i.incident_id}><td>{i.incident_id}</td><td>{i.latitude ?? "—"}, {i.longitude ?? "—"}</td><td>{typeof i.severity === "object" ? (i.severity?.level || "Unknown") : (i.severity || "Unknown")}</td><td>{i.status || "Unknown"}</td><td>{i.hospital_id ? (hospitals.find((h) => h.hospital_id === i.hospital_id)?.name || i.hospital_id) : "Awaiting acceptance"}</td></tr>)}</tbody></table></div>}
    </div>
    <div className="panel" style={{ marginTop: 20 }}><h3>How dispatch works</h3><ol><li>An accident detection creates an incident with a location.</li><li>The three nearest eligible hospitals or clinics receive it in their pending incident list.</li><li>The first eligible facility to accept claims the incident; other facilities can no longer accept it.</li><li>Only after acceptance, the Dispatch Planner displays the route and prototype ambulance progress.</li></ol><p className="muted-text">This is a B.Tech prototype. The moving ambulance position is simulated; it is not connected to a physical GPS device or live traffic service.</p></div>
  </section>;
}
