import { useEffect, useState } from "react";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";

export default function Hospitals() {
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ hospital_id: "", name: "", latitude: "", longitude: "", contact: "", facility_type: "HOSPITAL", capabilities: ["FIRST_AID", "EMERGENCY", "TRAUMA"] });
  const [notice, setNotice] = useState("");

  async function load() {
    try {
      setError("");
      setHospitals(await api.hospitals.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const refreshTimer = window.setInterval(load, 5000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  async function createFacility(e) {
    e.preventDefault(); setError(""); setNotice("");
    try {
      await api.hospitals.create({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) });
      setForm({ hospital_id: "", name: "", latitude: "", longitude: "", contact: "", facility_type: "HOSPITAL", capabilities: ["FIRST_AID", "EMERGENCY", "TRAUMA"] });
      setNotice("Facility registered successfully."); await load();
    } catch (err) { setError(err.message); }
  }

  function toggleCapability(capability) {
    setForm((current) => ({ ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((item) => item !== capability) : [...current.capabilities, capability] }));
  }

  async function toggle(hospital) {
    try {
      const emergencyAvailable = !hospital.emergency_available;
      await api.hospitals.updateAvailability(hospital.hospital_id, {
        emergency_available: emergencyAvailable,
        status: emergencyAvailable && hospital.staff_available ? "AVAILABLE" : "UNAVAILABLE",
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <Loading label="Loading hospitals..." />;

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HOSPITAL REGISTRY</span>
          <h2>Registered hospitals</h2>
          <p>Manage prototype emergency availability.</p>
        </div>
      </div>

      <p className="muted-text" style={{ marginBottom: 12 }}>
        Availability shown here comes from the records maintained in this system; it is not a live connection to hospital dispatch systems. Verify each facility's contact, coordinates, staffing and emergency status before using it for a real response.
      </p>
      <ErrorMessage message={error} />
      {notice && <p className="success-message">{notice}</p>}

      <form className="panel" onSubmit={createFacility} style={{ marginBottom: 20 }}>
        <h3>Register hospital or first-aid clinic</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <input required placeholder="Facility ID (e.g. C002)" value={form.hospital_id} onChange={(e) => setForm({ ...form, hospital_id: e.target.value })} />
          <input required placeholder="Facility name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required type="number" min="-90" max="90" step="any" placeholder="Latitude" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
          <input required type="number" min="-180" max="180" step="any" placeholder="Longitude" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          <input required placeholder="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <select value={form.facility_type} onChange={(e) => setForm({ ...form, facility_type: e.target.value, capabilities: e.target.value === "CLINIC" ? ["FIRST_AID"] : ["FIRST_AID", "EMERGENCY", "TRAUMA"] })}><option value="HOSPITAL">Hospital</option><option value="CLINIC">First-aid clinic</option></select>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0" }}>
          {["FIRST_AID", "EMERGENCY", "TRAUMA", "PEDIATRIC", "BURN"].map((cap) => <label key={cap} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.capabilities.includes(cap)} onChange={() => toggleCapability(cap)} />{cap.replace("_", " ")}</label>)}
        </div>
        <button className="button primary" type="submit">Register facility</button>
      </form>

      <div className="hospital-grid">
        {hospitals.map((hospital) => {
          const available =
            hospital.status === "AVAILABLE" &&
            hospital.emergency_available &&
            hospital.staff_available;

          return (
            <div className="hospital-card" key={hospital.hospital_id}>
              <div className="card-topline">
                <span className="hospital-code">{hospital.hospital_id}</span>
                <StatusBadge status={available ? "AVAILABLE" : "UNAVAILABLE"} />
              </div>

              <h3>{hospital.name}</h3>
              <p>{hospital.contact}</p>
              {(hospital.data_source === "DEMO" || String(hospital.name || "").includes("(DEMO)") || String(hospital.contact || "").includes("DEMO ONLY")) && (
                <p className="muted-text"><strong>DEMO RECORD — replace with verified facility data</strong></p>
              )}
              <p className="muted-text">{hospital.facility_type || "HOSPITAL"} · {(hospital.capabilities || ["FIRST_AID", "EMERGENCY", "TRAUMA"]).join(", ")}</p>

              <div className="detail-list compact">
                <div className="detail-row">
                  <span>Emergency</span>
                  <strong>{hospital.emergency_available ? "Available" : "Unavailable"}</strong>
                </div>
                <div className="detail-row">
                  <span>Staff</span>
                  <strong>{hospital.staff_available ? "Available" : "Unavailable"}</strong>
                </div>
                <div className="detail-row">
                  <span>Coordinates</span>
                  <strong>{hospital.latitude}, {hospital.longitude}</strong>
                </div>
              </div>

              <button className="button secondary full" onClick={() => toggle(hospital)}>
                Toggle emergency availability
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
