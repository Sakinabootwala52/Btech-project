import { useEffect, useState } from "react";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";

export default function Hospitals() {
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ hospital_id: "", name: "", address: "", latitude: "", longitude: "", contact: "", facility_type: "HOSPITAL", capabilities: ["FIRST_AID", "EMERGENCY", "TRAUMA"] });
  const [notice, setNotice] = useState("");
  const [geocoding, setGeocoding] = useState(false);

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
  }, []);

  async function geocodeAddress() {
    if (!form.address.trim()) { setError("Enter a facility address or locality first."); return; }
    setGeocoding(true); setError(""); setNotice("");
    try {
      const query = `${form.address.trim()}, Pune, Maharashtra, India`;
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("The geocoding service is unavailable. You can enter coordinates manually.");
      const matches = await response.json();
      if (!matches.length) throw new Error("Could not find that address. Try adding the locality or landmark, or enter coordinates manually.");
      setForm((current) => ({ ...current, latitude: matches[0].lat, longitude: matches[0].lon }));
      setNotice(`Coordinates found for: ${matches[0].display_name}`);
    } catch (err) { setError(err.message || "Address lookup failed."); }
    finally { setGeocoding(false); }
  }

  async function createFacility(e) {
    e.preventDefault(); setError(""); setNotice("");
    try {
      await api.hospitals.create({ ...form, latitude: Number(form.latitude), longitude: Number(form.longitude) });
      setForm({ hospital_id: "", name: "", address: "", latitude: "", longitude: "", contact: "", facility_type: "HOSPITAL", capabilities: ["FIRST_AID", "EMERGENCY", "TRAUMA"] });
      setNotice("Facility registered successfully."); await load();
    } catch (err) { setError(err.message); }
  }

  function toggleCapability(capability) {
    setForm((current) => ({ ...current, capabilities: current.capabilities.includes(capability) ? current.capabilities.filter((item) => item !== capability) : [...current.capabilities, capability] }));
  }

  if (loading) return <Loading label="Loading hospitals..." />;

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">HOSPITAL REGISTRY</span>
          <h2>Registered hospitals</h2>
          <p>Hospital and first-aid clinic locations, capabilities and registered resources.</p>
        </div>
      </div>

      <ErrorMessage message={error} />
      {notice && <p className="success-message">{notice}</p>}

      <form className="panel" onSubmit={createFacility} style={{ marginBottom: 20 }}>
        <h3>Register hospital or first-aid clinic</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <input required placeholder="Facility ID (e.g. C002)" value={form.hospital_id} onChange={(e) => setForm({ ...form, hospital_id: e.target.value })} />
          <input required placeholder="Facility name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input required placeholder="Address / locality" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <input required type="number" min="-90" max="90" step="any" placeholder="Latitude (or use address lookup)" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
          <input required type="number" min="-180" max="180" step="any" placeholder="Longitude (or use address lookup)" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          <input required placeholder="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          <select value={form.facility_type} onChange={(e) => setForm({ ...form, facility_type: e.target.value, capabilities: e.target.value === "CLINIC" ? ["FIRST_AID"] : ["FIRST_AID", "EMERGENCY", "TRAUMA"] })}><option value="HOSPITAL">Hospital</option><option value="CLINIC">First-aid clinic</option></select>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0" }}>
          {["FIRST_AID", "EMERGENCY", "TRAUMA", "PEDIATRIC", "BURN"].map((cap) => <label key={cap} style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={form.capabilities.includes(cap)} onChange={() => toggleCapability(cap)} />{cap.replace("_", " ")}</label>)}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><button className="button secondary" type="button" disabled={geocoding} onClick={geocodeAddress}>{geocoding ? "Finding coordinates…" : "Find coordinates from address"}</button><button className="button primary" type="submit">Register facility</button></div>
        <p className="muted-text" style={{ marginBottom: 0, marginTop: 8 }}>Address lookup uses OpenStreetMap Nominatim and requires internet access. Check the returned pin/coordinates before registering.</p>
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
              <p className="muted-text">{hospital.facility_type || "HOSPITAL"} · {(hospital.capabilities || ["FIRST_AID", "EMERGENCY", "TRAUMA"]).join(", ")}</p>

              <div className="detail-list compact">
                <div className="detail-row"><span>Address / locality</span><strong>{hospital.address || hospital.location_name || "Address not provided — approximate coordinates only"}</strong></div>
                <div className="detail-row"><span>Coordinates</span><strong>{hospital.latitude}, {hospital.longitude}</strong></div>
                <div className="detail-row"><span>Small ambulances</span><strong>{hospital.resources?.small_ambulances ?? hospital.small_ambulances ?? 0}</strong></div>
                <div className="detail-row"><span>Large ambulances</span><strong>{hospital.resources?.large_ambulances ?? hospital.large_ambulances ?? 0}</strong></div>
                <div className="detail-row"><span>Available beds</span><strong>{hospital.resources?.beds_available ?? hospital.beds_available ?? 0}</strong></div>
                <div className="detail-row"><span>Emergency staff</span><strong>{hospital.resources?.emergency_staff ?? hospital.emergency_staff ?? 0}</strong></div>
                <div className="detail-row"><span>Emergency units</span><strong>{hospital.resources?.emergency_units ?? hospital.emergency_units ?? 0}</strong></div>
                <div className="detail-row"><span>Emergency readiness</span><strong>{available ? "Available" : "Unavailable"}</strong></div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
