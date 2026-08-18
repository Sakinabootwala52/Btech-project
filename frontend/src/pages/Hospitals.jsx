import { useEffect, useState } from "react";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import { api } from "../api";

export default function Hospitals() {
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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

  async function toggle(hospital) {
    try {
      await api.hospitals.updateAvailability(hospital.hospital_id, {
        emergency_available: !hospital.emergency_available,
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

      <ErrorMessage message={error} />

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
