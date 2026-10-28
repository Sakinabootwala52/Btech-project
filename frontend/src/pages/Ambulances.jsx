import { useEffect, useState } from "react";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

export default function Ambulances() {
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const isAdmin = auth?.role === "admin";
  const [rows, setRows] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [form, setForm] = useState({ ambulance_id: "", hospital_id: "", vehicle_type: "BLS", plate_number: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    setError("");
    try {
      const data = await api.ambulances.list(); setRows(Array.isArray(data) ? data : []);
      if (isAdmin) setHospitals(await api.hospitals.list());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 5000);
    return () => window.clearInterval(refreshTimer);
  }, []);
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
    <div className="page-heading"><div><span className="eyebrow">FLEET MANAGEMENT</span><h2>Ambulance registry</h2>
    </div><button className="button secondary" onClick={load}>Refresh</button></div>
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
  </section>;
}
