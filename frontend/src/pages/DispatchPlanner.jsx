
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";
import Loading from "../components/Loading";

const EXAMPLE_NETWORK = {
  nodes: [
    { node_id: "J1", latitude: 18.5204, longitude: 73.8567 },
    { node_id: "J2", latitude: 18.523, longitude: 73.85 },
    { node_id: "J3", latitude: 18.531, longitude: 73.844 },
  ],
  edges: [
    {
      from: "J1",
      to: "J2",
      distance_km: 1.2,
      travel_time_min: 4,
      bidirectional: true,
    },
    {
      from: "J2",
      to: "J3",
      distance_km: 2.1,
      travel_time_min: 7,
      bidirectional: true,
    },
  ],
};

function getIncidentId(incident) {
  return String(incident?.incident_id ?? incident?._id ?? "");
}

function getSeverity(incident) {
  const severity = incident?.severity;

  if (severity && typeof severity === "object") {
    return severity.level ?? "Severity unknown";
  }

  return severity ?? "Severity unknown";
}

function getErrorMessage(error) {
  if (error instanceof SyntaxError) {
    return "Road graph must contain valid JSON.";
  }

  return error?.message || "An unexpected error occurred.";
}

export default function DispatchPlanner() {
  const [incidents, setIncidents] = useState([]);
  const [incidentId, setIncidentId] = useState("");
  const [result, setResult] = useState(null);
  const [networkText, setNetworkText] = useState(
    JSON.stringify(EXAMPLE_NETWORK, null, 2)
  );
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const mountedRef = useRef(false);
  const incidentIdRef = useRef("");
  const busyRef = useRef(false);

  useEffect(() => {
    incidentIdRef.current = incidentId;
  }, [incidentId]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setLoading(true);
      setError("");
    }

    try {
      const [incidentResponse, networkResponse, metricResponse] =
        await Promise.all([
          api.incidents.list(),
          api.dispatch.roadNetwork(),
          api.admin.engineeringMetrics(),
        ]);

      if (!mountedRef.current) return;

      const rows = Array.isArray(incidentResponse)
        ? incidentResponse
        : [];

      setIncidents(rows);

      const currentId = incidentIdRef.current;

      const selectedStillExists = rows.some(
        (incident) => getIncidentId(incident) === currentId
      );

      const nextId = selectedStillExists
        ? currentId
        : getIncidentId(rows[0]);

      setIncidentId(nextId);
      incidentIdRef.current = nextId;

      setNetworkText(
        JSON.stringify(
          networkResponse?.network || { nodes: [], edges: [] },
          null,
          2
        )
      );

      setMetrics(metricResponse);
    } catch (err) {
      if (mountedRef.current) {
        setError(getErrorMessage(err));
      }

      console.error("Dispatch planner load failed:", err);
    } finally {
      if (mountedRef.current && showLoading) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();

    const refreshTimer = window.setInterval(async () => {
      if (busyRef.current) return;

      try {
        const response = await api.incidents.list();

        if (!mountedRef.current) return;

        const rows = Array.isArray(response) ? response : [];
        setIncidents(rows);

        const currentId = incidentIdRef.current;
        const stillExists = rows.some(
          (incident) => getIncidentId(incident) === currentId
        );

        if (!stillExists) {
          const nextId = getIncidentId(rows[0]);
          setIncidentId(nextId);
          incidentIdRef.current = nextId;
          setResult(null);
        }
      } catch (err) {
        console.warn("Could not refresh dispatch incidents:", err);
      }
    }, 5000);

    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const selectedIncident = incidents.find(
    (incident) => getIncidentId(incident) === incidentId
  );

  async function rank() {
    const selectedId = incidentIdRef.current;

    if (!selectedId || busyRef.current) return;

    setBusy(true);
    busyRef.current = true;
    setError("");
    setNotice("");

    try {
      const response = await api.dispatch.recommendations(selectedId);

      if (!mountedRef.current) return;

      setResult(response);
    } catch (err) {
      if (mountedRef.current) {
        setError(`Could not rank facilities: ${getErrorMessage(err)}`);
        setResult(null);
      }
    } finally {
      busyRef.current = false;

      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function selectFacility(facility) {
    const selectedId = incidentIdRef.current;

    if (!selectedId || !facility?.facility_id || busyRef.current) {
      return;
    }

    setBusy(true);
    busyRef.current = true;
    setError("");
    setNotice("");

    try {
      const response = await api.dispatch.selectFacility(
        selectedId,
        facility.facility_id
      );

      if (!mountedRef.current) return;

      setNotice(
        response?.message ||
          `Incident routed to ${facility.name}.`
      );

      const updatedIncidentId = String(
        response?.incident_id || selectedId
      );

      setIncidentId(updatedIncidentId);
      incidentIdRef.current = updatedIncidentId;

      // Refresh incident records without replacing the edited graph
      // or changing the loading state.
      const rowsResponse = await api.incidents.list();

      if (!mountedRef.current) return;

      const rows = Array.isArray(rowsResponse) ? rowsResponse : [];
      setIncidents(rows);

      // Refresh recommendations for the same incident.
      const recommendationResponse =
        await api.dispatch.recommendations(updatedIncidentId);

      if (!mountedRef.current) return;

      setResult(recommendationResponse);
    } catch (err) {
      if (mountedRef.current) {
        setError(`Could not route incident: ${getErrorMessage(err)}`);
      }
    } finally {
      busyRef.current = false;

      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  async function saveNetwork() {
    if (busyRef.current) return;

    setBusy(true);
    busyRef.current = true;
    setError("");
    setNotice("");

    try {
      const network = JSON.parse(networkText);

      if (
        !network ||
        !Array.isArray(network.nodes) ||
        !Array.isArray(network.edges)
      ) {
        throw new Error(
          'Road graph must have "nodes" and "edges" arrays.'
        );
      }

      const saved = await api.dispatch.saveRoadNetwork(network);

      if (!mountedRef.current) return;

      setNotice(
        `Road graph saved: ${saved.node_count} nodes and ${saved.edge_count} edges.`
      );

      const selectedId = incidentIdRef.current;

      if (selectedId) {
        const recommendationResponse =
          await api.dispatch.recommendations(selectedId);

        if (mountedRef.current) {
          setResult(recommendationResponse);
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(`Could not save road graph: ${getErrorMessage(err)}`);
      }
    } finally {
      busyRef.current = false;

      if (mountedRef.current) {
        setBusy(false);
      }
    }
  }

  function handleIncidentChange(value) {
    setIncidentId(value);
    incidentIdRef.current = value;
    setResult(null);
    setError("");
    setNotice("");
  }

  if (loading) {
    return <Loading label="Loading dispatch planner..." />;
  }

  const recommendations = Array.isArray(result?.recommendations)
    ? result.recommendations
    : [];

  const incidentStatus = String(
    result?.incident_status || selectedIncident?.status || ""
  ).toUpperCase();

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ENGINEERING MODULE</span>
          <h2>Intelligent dispatch planner</h2>
        </div>

        <button
          type="button"
          className="button secondary"
          disabled={busy || loading}
          onClick={() => load()}
        >
          Refresh data
        </button>
      </div>

      <ErrorMessage message={error} />

      {notice && (
        <p className="success-message" role="status">
          {notice}
        </p>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <h3>1. Select an incident</h3>

        <div
          className="form-row"
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <select
            className="month-input"
            value={incidentId}
            disabled={busy}
            onChange={(event) =>
              handleIncidentChange(event.target.value)
            }
          >
            <option value="">Choose incident</option>

            {incidents.map((incident, index) => {
              const id = getIncidentId(incident);

              return (
                <option key={id || index} value={id}>
                  {id} · {incident.status || "Unknown status"} ·{" "}
                  {getSeverity(incident)}
                </option>
              );
            })}
          </select>

          <button
            type="button"
            className="button primary"
            disabled={!incidentId || busy}
            onClick={rank}
          >
            {busy ? "Processing..." : "Rank facilities"}
          </button>
        </div>

        {incidents.length === 0 && (
          <p className="muted-text">
            No incidents were returned by the backend.
          </p>
        )}

        {selectedIncident && (
          <p className="muted-text">
            Selected incident status:{" "}
            <strong>{selectedIncident.status || "Unknown"}</strong>
          </p>
        )}
      </div>

      {result && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <h3>2. Ranked recommendations</h3>

          {recommendations.length === 0 && (
            <p>
              No currently available facility matches the required
              capability. Check facility status and capabilities,
              or add a suitable facility.
            </p>
          )}

          <div className="hospital-grid">
            {recommendations.map((facility) => {
              const capabilities = Array.isArray(facility.capabilities)
                ? facility.capabilities
                : [];

              const route = facility.route || {};

              return (
                <article
                  className="hospital-card"
                  key={facility.facility_id}
                >
                  <div className="card-topline">
                    <span className="hospital-code">
                      #{facility.rank} · {facility.facility_id}
                    </span>

                    <span className="status-badge">
                      {facility.facility_type || "Facility"}
                    </span>
                  </div>

                  <h3>{facility.name || "Unnamed facility"}</h3>

                  <p>
                    Matched capability:{" "}
                    <strong>
                      {facility.matched_capability || "Not specified"}
                    </strong>
                  </p>

                  <div className="detail-list compact">
                    <div className="detail-row">
                      <span>Travel estimate</span>
                      <strong>
                        {route.travel_time_min ?? "N/A"} min
                      </strong>
                    </div>

                    <div className="detail-row">
                      <span>Distance</span>
                      <strong>
                        {route.distance_km ?? "N/A"} km
                      </strong>
                    </div>

                    <div className="detail-row">
                      <span>Ambulances reported</span>
                      <strong>
                        {facility.available_ambulances ?? "N/A"}
                      </strong>
                    </div>

                    <div className="detail-row">
                      <span>Emergency staff</span>
                      <strong>{facility.emergency_staff ?? "N/A"}</strong>
                    </div>

                    <div className="detail-row">
                      <span>Capabilities</span>
                      <strong>
                        {capabilities.length
                          ? capabilities.join(", ")
                          : "Not specified"}
                      </strong>
                    </div>
                  </div>

                  {route.notice && (
                    <p className="muted-text">{route.notice}</p>
                  )}

                  <button
                    type="button"
                    className="button primary full"
                    disabled={
                      busy ||
                      !incidentId ||
                      incidentStatus !== "PENDING"
                    }
                    onClick={() => selectFacility(facility)}
                  >
                    {busy
                      ? "Processing..."
                      : "Route incident to this facility"}
                  </button>

                  {incidentStatus !== "PENDING" && (
                    <p className="muted-text">
                      Routing is available only when the incident
                      status is PENDING. Current status:{" "}
                      {incidentStatus || "Unknown"}.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <h3>3. Road network graph (admin configuration)</h3>

        <textarea
          value={networkText}
          onChange={(event) => setNetworkText(event.target.value)}
          disabled={busy}
          rows={12}
          spellCheck={false}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: 13,
            padding: 12,
            borderRadius: 8,
            border: "1px solid #d0d7e2",
          }}
        />

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginTop: 12,
          }}
        >
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              setNetworkText(
                JSON.stringify(EXAMPLE_NETWORK, null, 2)
              )
            }
          >
            Load sample graph
          </button>

          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={saveNetwork}
          >
            {busy ? "Saving..." : "Validate and save graph"}
          </button>
        </div>
      </div>

      {metrics && (
        <div className="panel">
          <h3>4. Operational engineering metrics</h3>

          <div className="stats-grid">
            <div className="stat-card">
              <span>Incidents tracked</span>
              <strong>{metrics.incident_count ?? "N/A"}</strong>
            </div>

            <div className="stat-card">
              <span>Average pipeline time</span>
              <strong>
                {metrics.pipeline_processing_seconds?.average == null
                  ? "N/A"
                  : `${metrics.pipeline_processing_seconds.average}s`}
              </strong>
            </div>

            <div className="stat-card">
              <span>Detection → acceptance</span>
              <strong>
                {metrics.detection_to_accept_seconds?.average == null
                  ? "N/A"
                  : `${metrics.detection_to_accept_seconds.average}s`}
              </strong>
            </div>

            <div className="stat-card">
              <span>Acceptance → dispatch</span>
              <strong>
                {metrics.accept_to_dispatch_seconds?.average == null
                  ? "N/A"
                  : `${metrics.accept_to_dispatch_seconds.average}s`}
              </strong>
            </div>
          </div>

          {metrics.important_note && (
            <p className="muted-text">{metrics.important_note}</p>
          )}
        </div>
      )}
    </section>
  );
}
