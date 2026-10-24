
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";

const DEFAULT_CENTER = [18.5204, 73.8567];

const ambulanceIcon = L.divIcon({
  className: "cc-ambulance-icon",
  html: '<div class="cc-ambulance-emoji">🚑</div>',
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

function stamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Metric({ label, value, detail }) {
  return (
    <div className="cc-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function getPoint(item) {
  if (!item) return null;

  const candidates = [
    item,
    item.position,
    item.location,
    item.gps,
    item.current_position,
    item.last_position,
    item.tracking?.position,
    item.ambulance_tracking?.position,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const lat =
      candidate.latitude ??
      candidate.lat;

    const lng =
      candidate.longitude ??
      candidate.lng ??
      candidate.lon;

    if (
      lat == null ||
      lng == null ||
      String(lat).trim() === "" ||
      String(lng).trim() === ""
    ) {
      continue;
    }

    const latitude = Number(lat);
    const longitude = Number(lng);

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      !(latitude === 0 && longitude === 0)
    ) {
      return [latitude, longitude];
    }
  }

  return null;
}

function getSeverity(incident) {
  const severity = incident?.severity;

  if (severity && typeof severity === "object") {
    return severity.level ?? "Unknown";
  }

  return severity ?? "Unknown";
}

function FitBounds({ points }) {
  const map = useMap();

  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [32, 32],
        maxZoom: 15,
      });
    } else if (points.length === 1) {
      map.setView(points[0], 13);
    }
  }, [map, points]);

  return null;
}

export default function CommandCentre() {
  const [events, setEvents] = useState([
    {
      id: 1,
      time: stamp(),
      title: "Command Centre opened",
      detail: "Waiting for backend resource data.",
    },
  ]);

  const [incidents, setIncidents] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [ambulances, setAmbulances] = useState([]);
  const [selectedIncident, setSelectedIncident] = useState("");

  const [benchmark, setBenchmark] = useState(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);

  const [copilot, setCopilot] = useState(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [question, setQuestion] = useState(
    "Why is this facility recommended, and what are the limitations?"
  );

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [speechEnabled, setSpeechEnabled] = useState(false);

  const speechEnabledRef = useRef(false);
  const eventId = useRef(2);

  useEffect(() => {
    speechEnabledRef.current = speechEnabled;
  }, [speechEnabled]);

  const addEvent = useCallback((title, detail) => {
    setEvents((previous) =>
      [
        {
          id: eventId.current++,
          time: stamp(),
          title,
          detail,
        },
        ...previous,
      ].slice(0, 10)
    );

    if (
      speechEnabledRef.current &&
      typeof window !== "undefined" &&
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(
        new SpeechSynthesisUtterance(`${title}. ${detail}`)
      );
    }
  }, []);

  const loadResources = useCallback(async () => {

    const [incidentRows, hospitalRows, ambulanceRows] =
  await Promise.all([
    api.incidents.list(),
    api.hospitals.list(),
    api.ambulances.list(),
  ]);
  console.log("Incidents from backend:", incidentRows);
console.log("Hospitals from backend:", hospitalRows);
console.log("Ambulances from backend:", ambulanceRows);
    try {
      const [incidentRows, hospitalRows, ambulanceRows] =
        await Promise.all([
          api.incidents.list(),
          api.hospitals.list(),
          api.ambulances.list(),
        ]);

      setIncidents(
        Array.isArray(incidentRows) ? incidentRows : []
      );
      setHospitals(
        Array.isArray(hospitalRows) ? hospitalRows : []
      );
      setAmbulances(
        Array.isArray(ambulanceRows) ? ambulanceRows : []
      );

      setError("");
    } catch (e) {
      setError(
        `Could not load backend records: ${e.message}. Check that the backend and database are running and that your session has permission.`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResources();

    const intervalId = window.setInterval(loadResources, 10000);

    return () => window.clearInterval(intervalId);
  }, [loadResources]);

  useEffect(() => {
    if (incidents.length === 0) {
      setSelectedIncident("");
      return;
    }

    const selectionExists = incidents.some(
      (incident) =>
        String(incident.incident_id) === String(selectedIncident)
    );

    if (!selectionExists) {
      setSelectedIncident(String(incidents[0].incident_id));
    }
  }, [incidents, selectedIncident]);

  const availableAmbulances = ambulances.filter(
    (ambulance) =>
      String(ambulance.status || "").toUpperCase() === "AVAILABLE"
  ).length;

  const activeIncidents = incidents.filter((incident) =>
    ["PENDING", "ACCEPTED", "DISPATCHED", "EN_ROUTE"].includes(
      String(incident.status || "").toUpperCase()
    )
  ).length;

  const selectedRealIncident =
    incidents.find(
      (incident) =>
        String(incident.incident_id) === String(selectedIncident)
    ) || null;

  const realRouteCoordinates = Array.isArray(
    selectedRealIncident?.route_coordinates
  )
    ? selectedRealIncident.route_coordinates
        .filter((point) => {
          if (!Array.isArray(point) || point.length < 2) {
            return false;
          }

          const lat = Number(point[0]);
          const lng = Number(point[1]);

          return (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180 &&
            !(lat === 0 && lng === 0)
          );
        })
        .map((point) => [Number(point[0]), Number(point[1])])
    : [];

  const realRecommendedHospital =
    hospitals.find(
      (hospital) =>
        String(hospital.hospital_id) ===
        String(selectedRealIncident?.recommended_hospital_id)
    ) || null;

  const mapPoints = [
    ...incidents.map(getPoint),
    ...hospitals.map(getPoint),
    ...ambulances.map(getPoint),
    ...realRouteCoordinates,
  ].filter(Boolean);

  const mapCenter =
    getPoint(selectedRealIncident) ||
    getPoint(ambulances.find((ambulance) => getPoint(ambulance))) ||
    getPoint(hospitals.find((hospital) => getPoint(hospital))) ||
    getPoint(incidents.find((incident) => getPoint(incident))) ||
    DEFAULT_CENTER;

  async function runBenchmark() {
    setBenchmarkBusy(true);
    setError("");
    setNotice("");

    try {
      const result =
        await api.engineering.routingBenchmark("sample");

      setBenchmark(result);
      setNotice(
        "Benchmark completed. This test uses a sample graph, not live traffic."
      );
    } catch (e) {
      setError(`Routing benchmark failed: ${e.message}`);
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function askCopilot() {
    if (!selectedRealIncident) {
      setError("Select an actual backend incident first.");
      return;
    }

    setCopilotBusy(true);
    setError("");
    setCopilot(null);

    try {
      const ranked = await api.dispatch.recommendations(
        selectedRealIncident.incident_id
      );

      const recommendations = Array.isArray(ranked?.recommendations)
        ? ranked.recommendations
        : [];

      const result = await api.copilot.explain({
        incident: selectedRealIncident,
        recommendations,
        question,
      });

      setCopilot(result);

      addEvent(
        "Copilot briefing generated",
        `Response mode: ${result.mode}. Sources retrieved: ${
          result.citations?.length || 0
        }.`
      );
    } catch (e) {
      setError(`Copilot request failed: ${e.message}`);
    } finally {
      setCopilotBusy(false);
    }
  }

  return (
    <section className="command-centre">
      <div className="page-heading cc-heading">
        <div>
          <span className="eyebrow">EMERGENCY OPERATIONS</span>
          <h2>Accident Response Command Centre</h2>
          <p>
            Backend incidents, registered resources, hospital routing,
            and dispatch analysis.
          </p>
        </div>

        <div className="cc-mode-badge">
          <span className="cc-live-dot" />
          BACKEND DATA
        </div>
      </div>

      <ErrorMessage message={error} />

      {notice && <p className="success-message">{notice}</p>}

      <div className="cc-banner">
        <strong>BACKEND DATA VIEW</strong>
        <span>
          Records are fetched from your backend. Ambulance GPS movement
          appears only when actual position updates are received.
        </span>
      </div>

      <div className="cc-metrics-grid">
        <Metric
          label="Open incidents"
          value={activeIncidents}
          detail="Backend incident records"
        />
        <Metric
          label="Registered facilities"
          value={hospitals.length}
          detail="Backend hospital records"
        />
        <Metric
          label="Registered ambulances"
          value={ambulances.length}
          detail="Backend ambulance records"
        />
        <Metric
          label="Available ambulances"
          value={availableAmbulances}
          detail="Backend availability status"
        />
      </div>

      <div className="cc-main-grid">
        <div className="cc-map-panel">
          <div className="cc-panel-heading">
            <div>
              <span className="eyebrow">DATABASE MAP</span>
              <h3>Incidents, hospitals and ambulances</h3>
            </div>

            <button
              className="button tiny secondary"
              onClick={loadResources}
              disabled={loading}
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="cc-map-wrap">
            <MapContainer
              center={mapCenter}
              zoom={12}
              scrollWheelZoom
              style={{ height: "430px", width: "100%" }}
            >
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />

              <FitBounds points={mapPoints} />

              {realRouteCoordinates.length >= 2 && (
                <Polyline
                  positions={realRouteCoordinates}
                  pathOptions={{
                    color: "#2563eb",
                    weight: 5,
                    opacity: 0.9,
                  }}
                >
                  <Popup>
                    <strong>Saved backend road route</strong>
                    <br />
                    Incident: {selectedRealIncident?.incident_id}
                    <br />
                    Hospital: {
                      selectedRealIncident?.recommended_hospital_name ||
                      realRecommendedHospital?.name ||
                      "Not available"
                    }
                  </Popup>
                </Polyline>
              )}

              {incidents.map((incident, index) => {
                const point = getPoint(incident);

                if (!point) return null;

                const isSelected =
                  String(incident.incident_id) ===
                  String(selectedIncident);

                return (
                  <CircleMarker
                    key={incident.incident_id || incident._id || index}
                    center={point}
                    radius={isSelected ? 10 : 7}
                    pathOptions={{
                      color: isSelected ? "#dc2626" : "#b91c1c",
                      fillColor: isSelected ? "#f87171" : "#ef4444",
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{
                      click: () =>
                        setSelectedIncident(
                          String(incident.incident_id)
                        ),
                    }}
                  >
                    <Popup>
                      <strong>
                        Incident: {incident.incident_id || "Unknown"}
                      </strong>
                      <br />
                      Status: {incident.status || "Unknown"}
                      <br />
                      Severity: {getSeverity(incident)}
                      <br />
                      Click the incident selector below to view its
                      routing details.
                    </Popup>
                  </CircleMarker>
                );
              })}

              {hospitals.map((hospital, index) => {
                const point = getPoint(hospital);

                if (!point) return null;

                const recommended =
                  String(hospital.hospital_id) ===
                  String(selectedRealIncident?.recommended_hospital_id);

                return (
                  <CircleMarker
                    key={hospital.hospital_id || hospital._id || index}
                    center={point}
                    radius={recommended ? 10 : 7}
                    pathOptions={{
                      color: recommended ? "#2563eb" : "#0f766e",
                      fillColor: recommended ? "#60a5fa" : "#14b8a6",
                      fillOpacity: 0.9,
                    }}
                  >
                    <Popup>
                      <strong>
                        {hospital.name ||
                          hospital.hospital_name ||
                          "Hospital"}
                      </strong>
                      <br />
                      Hospital ID: {hospital.hospital_id || "N/A"}
                      <br />
                      Status: {hospital.status || "Unknown"}
                      {recommended && (
                        <>
                          <br />
                          Recommended for selected incident
                        </>
                      )}
                    </Popup>
                  </CircleMarker>
                );
              })}

              {ambulances.map((ambulance, index) => {
                const point = getPoint(ambulance);

                if (!point) return null;

                return (
                  <Marker
                    key={
                      ambulance.ambulance_id ||
                      ambulance._id ||
                      index
                    }
                    position={point}
                    icon={ambulanceIcon}
                  >
                    <Popup>
                      <strong>
                        Ambulance: {ambulance.ambulance_id || "Unknown"}
                      </strong>
                      <br />
                      Status: {ambulance.status || "Unknown"}
                      <br />
                      Position source: {
                        ambulance.ambulance_tracking?.source ||
                        ambulance.tracking?.source ||
                        ambulance.position?.source ||
                        "Not specified"
                      }
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>
          <div className="cc-panel" style={{ marginTop: 16 }}>
            <div className="cc-panel-heading">
              <div>
                <span className="eyebrow">BACKEND RECORDS</span>
                <h3>Registered Hospitals & Clinics</h3>
              </div>
              <span className="cc-count">{hospitals.length}</span>
            </div>

            {hospitals.length === 0 ? (
              <p className="cc-footnote">
                {loading
                  ? "Loading hospital records..."
                  : "No hospital records returned by the backend."}
              </p>
            ) : (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Beds</th>
                      <th>Coordinates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hospitals.map((hospital) => (
                      <tr key={hospital.hospital_id || hospital._id}>
                        <td>{hospital.name || "Unnamed facility"}</td>
                        <td>{hospital.facility_type || "N/A"}</td>
                        <td>{hospital.status || "Unknown"}</td>
                        <td>
                          {hospital.resources?.beds_available ?? "N/A"}
                        </td>
                        <td>
                          {Number(hospital.latitude).toFixed(4)},{" "}
                          {Number(hospital.longitude).toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {mapPoints.length === 0 && (
            <p className="cc-footnote">
              No valid coordinates were found in the loaded records.
              The map is showing its default viewing area only; no
              incident or ambulance marker has been fabricated.
            </p>
          )}

          <div className="cc-panel" style={{ marginTop: 16 }}>
            <div className="cc-panel-heading">
              <div>
                <span className="eyebrow">INCIDENT DETAILS</span>
                <h3>Hospital routing result</h3>
              </div>
              <span className="cc-sim-chip">
                {selectedRealIncident?.routing_method ||
                  "No routing result"}
              </span>
            </div>

            <label className="cc-label" htmlFor="cc-incident-select">
              Select a recorded incident
            </label>

            <select
              id="cc-incident-select"
              className="month-input cc-select"
              value={selectedIncident}
              onChange={(event) =>
                setSelectedIncident(event.target.value)
              }
            >
              <option value="">Select an incident</option>
              {incidents.map((incident, index) => (
                <option
                  key={incident.incident_id || incident._id || index}
                  value={String(incident.incident_id)}
                >
                  {incident.incident_id || "Unknown ID"} ·{" "}
                  {incident.status || "Unknown status"}
                </option>
              ))}
            </select>

            {!selectedRealIncident ? (
              <p className="cc-footnote">
                {loading
                  ? "Loading incident records..."
                  : incidents.length === 0
                    ? "No incidents were returned by the backend."
                    : "Select an incident to view its routing details."}
              </p>
            ) : (
              <>
                <p>
                  <strong>Incident:</strong>{" "}
                  {selectedRealIncident.incident_id}
                </p>
                <p>
                  <strong>Status:</strong>{" "}
                  {selectedRealIncident.status || "Unknown"}
                </p>
                <p>
                  <strong>Severity:</strong>{" "}
                  {getSeverity(selectedRealIncident)}
                </p>
                <p>
                  <strong>Recommended hospital:</strong>{" "}
                  {selectedRealIncident.recommended_hospital_name ||
                    realRecommendedHospital?.name ||
                    "No saved recommendation"}
                </p>

                <div className="cc-route-metrics">
                  <Metric
                    label="Road distance"
                    value={
                      selectedRealIncident.hospital_distance_km != null
                        ? `${selectedRealIncident.hospital_distance_km} km`
                        : "N/A"
                    }
                    detail="Saved incident data"
                  />
                  <Metric
                    label="Estimated travel time"
                    value={
                      selectedRealIncident.estimated_travel_time_min != null
                        ? `${selectedRealIncident.estimated_travel_time_min} min`
                        : "N/A"
                    }
                    detail="Saved routing estimate"
                  />
                  <Metric
                    label="Route geometry"
                    value={
                      realRouteCoordinates.length >= 2
                        ? "Available"
                        : "Unavailable"
                    }
                    detail={`${realRouteCoordinates.length} route points`}
                  />
                </div>

                {selectedRealIncident.routing_error && (
                  <p className="cc-footnote">
                    Routing message: {selectedRealIncident.routing_error}
                  </p>
                )}

                {realRouteCoordinates.length < 2 && (
                  <p className="cc-footnote">
                    This incident has no valid saved route geometry.
                    Check its coordinates and the backend routing result.
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        <aside className="cc-side-column">
          <div className="cc-panel">
            <div className="cc-panel-heading">
              <div>
                <span className="eyebrow">EVENT STREAM</span>
                <h3>System timeline</h3>
              </div>
              <span className="cc-count">{events.length}</span>
            </div>

            <div className="cc-timeline">
              {events.map((event) => (
                <div className="cc-event" key={event.id}>
                  <span className="cc-event-dot" />
                  <div>
                    <div className="cc-event-title">
                      {event.title}
                      <time>{event.time}</time>
                    </div>
                    <p>{event.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <label className="cc-speech-toggle">
              <input
                type="checkbox"
                checked={speechEnabled}
                onChange={(event) =>
                  setSpeechEnabled(event.target.checked)
                }
              />
              Spoken system alerts
            </label>
          </div>

          <div className="cc-panel">
            <div className="cc-panel-heading">
              <div>
                <span className="eyebrow">SYSTEM HEALTH</span>
                <h3>Resource indicators</h3>
              </div>
              <button
                className="button tiny secondary"
                onClick={loadResources}
                disabled={loading}
              >
                Refresh
              </button>
            </div>

            <div className="cc-resource-row">
              <span>Backend resource query</span>
              <b>
                {loading
                  ? "Loading"
                  : error
                    ? "Error"
                    : "Request succeeded"}
              </b>
            </div>

            <div className="cc-resource-row">
              <span>Incident records</span>
              <b>{incidents.length}</b>
            </div>

            <div className="cc-resource-row">
              <span>Hospital records</span>
              <b>{hospitals.length}</b>
            </div>

            <div className="cc-resource-row">
              <span>Available ambulances</span>
              <b>{availableAmbulances}</b>
            </div>

            <div className="cc-resource-row">
              <span>Out of service</span>
              <b>
                {
                  ambulances.filter(
                    (ambulance) =>
                      String(ambulance.status || "").toUpperCase() ===
                      "OUT_OF_SERVICE"
                  ).length
                }
              </b>
            </div>

            <div className="cc-resource-row">
              <span>Busy / assigned</span>
              <b>
                {
                  ambulances.filter((ambulance) => {
                    const status = String(
                      ambulance.status || ""
                    ).toUpperCase();

                    return (
                      status !== "AVAILABLE" &&
                      status !== "OUT_OF_SERVICE"
                    );
                  }).length
                }
              </b>
            </div>

            <p className="cc-footnote">
              Counts come from the API responses. They do not, by
              themselves, confirm that a physical GPS device is connected.
            </p>
          </div>
        </aside>
      </div>

      <div className="cc-bottom-grid">
        <div className="cc-panel">
          <div className="cc-panel-heading">
            <div>
              <span className="eyebrow">ALGORITHM EVALUATION</span>
              <h3>A* vs Dijkstra benchmark</h3>
            </div>

            <button
              className="button primary"
              onClick={runBenchmark}
              disabled={benchmarkBusy}
            >
              {benchmarkBusy ? "Running..." : "Run benchmark"}
            </button>
          </div>

          <p className="muted-text">
            This benchmark uses the configured sample graph. Its results
            are algorithm test results, not live road traffic measurements.
          </p>

          {benchmark && (
            <>
              <div className="cc-benchmark-status">
                <span
                  className={
                    benchmark.all_optimal_costs_match
                      ? "cc-good"
                      : "cc-bad"
                  }
                >
                  {benchmark.all_optimal_costs_match
                    ? "✓ Optimal costs match"
                    : "! Cost mismatch"}
                </span>
                <span>
                  {benchmark.case_count} cases · {benchmark.node_count}{" "}
                  nodes · {benchmark.edge_count} edges
                </span>
              </div>

              {benchmark.averages && (
                <div className="cc-chart">
                  {[
                    {
                      label: "Dijkstra time",
                      value:
                        benchmark.averages.dijkstra_execution_ms,
                      unit: "ms",
                    },
                    {
                      label: "A* time",
                      value: benchmark.averages.astar_execution_ms,
                      unit: "ms",
                    },
                    {
                      label: "Dijkstra nodes",
                      value:
                        benchmark.averages.dijkstra_nodes_expanded,
                      unit: "",
                    },
                    {
                      label: "A* nodes",
                      value: benchmark.averages.astar_nodes_expanded,
                      unit: "",
                    },
                  ].map((item) => (
                    <div className="cc-chart-row" key={item.label}>
                      <span>{item.label}</span>
                      <div>
                        <i
                          style={{
                            width: `${Math.max(
                              2,
                              Math.min(100, Number(item.value) || 0)
                            )}%`,
                          }}
                        />
                      </div>
                      <b>
                        {item.value ?? "N/A"} {item.unit}
                      </b>
                    </div>
                  ))}
                </div>
              )}

              <p className="cc-footnote">
                Graph: {benchmark.graph_label || "Sample graph"}.
              </p>

              {Array.isArray(benchmark.cases) && (
                <details className="cc-details">
                  <summary>View per-case results</summary>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Route</th>
                          <th>Dijkstra cost</th>
                          <th>A* cost</th>
                          <th>Dijkstra nodes</th>
                          <th>A* nodes</th>
                          <th>Match</th>
                        </tr>
                      </thead>
                      <tbody>
                        {benchmark.cases.map((item, index) => (
                          <tr
                            key={`${item.start}-${item.goal}-${index}`}
                          >
                            <td>
                              {item.start} → {item.goal}
                            </td>
                            <td>
                              {item.dijkstra?.travel_time_min ?? "N/A"}
                            </td>
                            <td>
                              {item.astar?.travel_time_min ?? "N/A"}
                            </td>
                            <td>
                              {item.dijkstra?.nodes_expanded ?? "N/A"}
                            </td>
                            <td>
                              {item.astar?.nodes_expanded ?? "N/A"}
                            </td>
                            <td>
                              {item.optimal_cost_matches ? "Yes" : "No"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <div className="cc-panel">
          <div className="cc-panel-heading">
            <div>
              <span className="eyebrow">RETRIEVAL-AUGMENTED ASSISTANT</span>
              <h3>AI Dispatch Copilot</h3>
            </div>
            <span className="cc-ai-chip">AI + SOURCES</span>
          </div>

          <label className="cc-label" htmlFor="cc-copilot-question">
            Question about the selected incident
          </label>

          <textarea
            id="cc-copilot-question"
            className="cc-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
          />

          <button
            className="button primary full"
            onClick={askCopilot}
            disabled={copilotBusy || !selectedRealIncident}
          >
            {copilotBusy
              ? "Preparing answer..."
              : "Explain incident / recommendation"}
          </button>

          {!selectedRealIncident && (
            <p className="cc-footnote">
              Select a recorded incident in the map panel before asking
              the Copilot.
            </p>
          )}

          {copilot && (
            <div className="cc-copilot-answer">
              <div className="cc-answer-meta">
                <span className="cc-ai-chip">
                  {copilot.mode === "llm"
                    ? `LLM · ${copilot.model}`
                    : "GROUNDED FALLBACK"}
                </span>
                <span>{copilot.citations?.length || 0} sources</span>
              </div>

              <p>{copilot.answer}</p>
              <small>{copilot.status_note}</small>

              {copilot.citations?.length > 0 && (
                <div className="cc-citations">
                  <strong>Retrieved sources</strong>
                  {copilot.citations.map((source) => (
                    <a
                      key={source.id}
                      href={
                        source.url?.startsWith("http")
                          ? source.url
                          : undefined
                      }
                      target={
                        source.url?.startsWith("http")
                          ? "_blank"
                          : undefined
                      }
                      rel="noreferrer"
                    >
                      <b>
                        [{source.id}] {source.title}
                      </b>
                      <span>{source.organization}</span>
                      {source.url?.startsWith("http") && (
                        <small>{source.url}</small>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="cc-footnote">
            Copilot uses the selected backend incident and the
            recommendations returned by the dispatch API. It does not
            dispatch an ambulance automatically.
          </p>
        </div>
      </div>
    </section>
  );
}
