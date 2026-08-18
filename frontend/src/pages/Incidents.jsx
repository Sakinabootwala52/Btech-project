import { useEffect, useState } from "react";
import IncidentTable from "../components/IncidentTable";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import { api } from "../api";

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    try {
      setError("");
      setIncidents(await api.incidents.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <Loading label="Loading incidents..." />;

  const filtered =
    filter === "ALL"
      ? incidents
      : incidents.filter((incident) => incident.status === filter);

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">INCIDENT MANAGEMENT</span>
          <h2>Accident incidents</h2>
          <p>Review detection events and emergency response status.</p>
        </div>
        <button className="button secondary" onClick={load}>Refresh</button>
      </div>

      <ErrorMessage message={error} />

      <div className="filter-row">
        {["ALL", "PENDING", "RESPONSE_ACCEPTED", "REJECTED", "RESOLVED"].map(
          (status) => (
            <button
              key={status}
              className={`filter-button ${filter === status ? "selected" : ""}`}
              onClick={() => setFilter(status)}
            >
              {status.replaceAll("_", " ")}
            </button>
          )
        )}
      </div>

      <div className="panel">
        <IncidentTable incidents={filtered} />
      </div>
    </section>
  );
}
