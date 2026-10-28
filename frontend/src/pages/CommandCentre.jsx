
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
import AmbulanceSimulation from "./AmbulanceSimulation";

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

function isValidPoint(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

/*
 * Normalize coordinate formats returned by the backend.
 *
 * Supports:
 * { latitude, longitude }
 * { lat, lng }
 * { location: { latitude, longitude } }
 * { position: { lat, lng } }
 * GeoJSON Point: { type: "Point", coordinates: [lng, lat] }
 * Plain array: [lat, lng]
 */
function getPoint(item) {
  if (!item || typeof item !== "object") return null;

  const candidates = [
    item,
    item.position,
    item.location,
    item.gps,
    item.coordinates,
    item.current_position,
    item.last_position,
    item.tracking?.position,
    item.ambulance_tracking?.position,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (
      candidate.type === "Point" &&
      Array.isArray(candidate.coordinates) &&
      candidate.coordinates.length >= 2
    ) {
      const longitude = Number(candidate.coordinates[0]);
      const latitude = Number(candidate.coordinates[1]);

      if (isValidPoint(latitude, longitude)) {
        return [latitude, longitude];
      }

      continue;
    }

    if (Array.isArray(candidate) && candidate.length >= 2) {
      const latitude = Number(candidate[0]);
      const longitude = Number(candidate[1]);

      if (isValidPoint(latitude, longitude)) {
        return [latitude, longitude];
      }

      continue;
    }

    if (typeof candidate !== "object") continue;

    const lat = candidate.latitude ?? candidate.lat;
    const lng =
      candidate.longitude ??
      candidate.lng ??
      candidate.lon ??
      candidate.long;

    if (lat == null || lng == null) continue;
    if (String(lat).trim() === "" || String(lng).trim() === "") {
      continue;
    }

    const latitude = Number(lat);
    const longitude = Number(lng);

    if (isValidPoint(latitude, longitude)) {
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

function getIncidentId(incident) {
  return incident?.incident_id ?? incident?._id ?? "";
}

function getHospitalId(hospital) {
  return hospital?.hospital_id ?? hospital?._id ?? "";
}

function getHospitalName(hospital) {
  return (
    hospital?.name ??
    hospital?.hospital_name ??
    "Unnamed facility"
  );
}

function FitBounds({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points), {
        padding: [32, 32],
        maxZoom: 15,
      });
    } else {
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

  const addEvent = useCallback((title, detail = "") => {
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

  /*
   * Load incident, hospital, and ambulance records from the backend.
   * The existing API integrations are preserved.
   */
  const loadResources = useCallback(async () => {
    try {
      const [incidentRows, hospitalRows, ambulanceRows] =
        await Promise.all([
          api.incidents.list(),
          api.hospitals.list(),
          api.ambulances.list(),
        ]);

      const nextIncidents = Array.isArray(incidentRows)
        ? incidentRows
        : [];

      const nextHospitals = Array.isArray(hospitalRows)
        ? hospitalRows
        : [];

      const nextAmbulances = Array.isArray(ambulanceRows)
        ? ambulanceRows
        : [];

      console.log("FULL MAP DATA:", {
        incidents: nextIncidents,
        hospitals: nextHospitals,
        ambulances: nextAmbulances,
      });

      setIncidents(nextIncidents);
      setHospitals(nextHospitals);
      setAmbulances(nextAmbulances);
      setError("");
    } catch (e) {
      console.error(
        "Failed to load Command Centre resources:",
        e
      );

      setError(
        `Could not load backend records: ${
          e.message || "Unknown error"
        }. Check that the backend, database, and session are available.`
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
    if (!incidents.length) {
      setSelectedIncident("");
      return;
    }

    const selectionExists = incidents.some(
      (incident) =>
        String(getIncidentId(incident)) === String(selectedIncident)
    );

    if (!selectionExists) {
      setSelectedIncident(String(getIncidentId(incidents[0])));
    }
  }, [incidents, selectedIncident]);

  const availableAmbulances = ambulances.filter(
    (ambulance) =>
      String(ambulance.status || "").toUpperCase() === "AVAILABLE"
  ).length;

  const activeIncidents = incidents.filter((incident) =>
    [
      "PENDING",
      "ACCEPTED",
      "DISPATCHED",
      "EN_ROUTE",
      "IN_PROGRESS",
    ].includes(String(incident.status || "").toUpperCase())
  ).length;

  const selectedRealIncident =
    incidents.find(
      (incident) =>
        String(getIncidentId(incident)) === String(selectedIncident)
    ) || null;

  /*
   * Use the route geometry saved on the selected incident.
   * Backend arrays are expected to be [latitude, longitude].
   */
  const realRouteCoordinates = Array.isArray(
    selectedRealIncident?.route_coordinates
  )
    ? selectedRealIncident.route_coordinates
        .map((point) => {
          if (Array.isArray(point) && point.length >= 2) {
            const latitude = Number(point[0]);
            const longitude = Number(point[1]);

            return isValidPoint(latitude, longitude)
              ? [latitude, longitude]
              : null;
          }

          return getPoint(point);
        })
        .filter(Boolean)
    : [];

  const realRecommendedHospital =
    hospitals.find(
      (hospital) =>
        String(getHospitalId(hospital)) ===
        String(selectedRealIncident?.recommended_hospital_id)
    ) || null;

  const incidentPoints = incidents
    .map(getPoint)
    .filter(Boolean);

  const hospitalPoints = hospitals
    .map(getPoint)
    .filter(Boolean);

  const ambulancePoints = ambulances
    .map(getPoint)
    .filter(Boolean);

  const mapPoints = [
    ...incidentPoints,
    ...hospitalPoints,
    ...ambulancePoints,
    ...realRouteCoordinates,
  ];

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
      setNotice("Routing benchmark completed.");
      addEvent(
        "Routing benchmark completed",
        `${result.case_count ?? 0} test cases evaluated.`
      );
    } catch (e) {
      setError(`Routing benchmark failed: ${e.message}`);
    } finally {
      setBenchmarkBusy(false);
    }
  }

  async function askCopilot() {
    if (!selectedRealIncident) {
      setError("Select a backend incident first.");
      return;
    }

    setCopilotBusy(true);
    setError("");
    setCopilot(null);

    try {
      const ranked = await api.dispatch.recommendations(
        getIncidentId(selectedRealIncident)
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
        `Response mode: ${result.mode || "unknown"}. Sources retrieved: ${
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
      {/* Page heading */}
      <div className="page-heading cc-heading">
        <div>
          <span className="eyebrow">EMERGENCY OPERATIONS</span>
          <h2>Accident Response Command Centre</h2>
        </div>
      </div>

      <ErrorMessage message={error} />

      {notice && <p className="success-message">{notice}</p>}

      {/* Dashboard metrics */}
      <div className="cc-metrics-grid">
        <Metric label="Open incidents" value={activeIncidents} />
        <Metric label="Registered facilities" value={hospitals.length} />
        <Metric label="Registered ambulances" value={ambulances.length} />
        <Metric label="Available ambulances" value={availableAmbulances} />
      </div>
{/* ========================================================================================== */}
      {/* Main dashboard grid */}
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

          {/* Main incident map */}
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
                    <strong>Saved incident route</strong>
                    <br />
                    Incident: {getIncidentId(selectedRealIncident)}
                    <br />
                    Hospital:{" "}
                    {selectedRealIncident?.recommended_hospital_name ||
                      getHospitalName(realRecommendedHospital)}
                  </Popup>
                </Polyline>
              )}

              {/* Incident markers */}
              {incidents.map((incident, index) => {
                const point = getPoint(incident);
                if (!point) return null;

                const incidentId = getIncidentId(incident);
                const isSelected =
                  String(incidentId) === String(selectedIncident);

                return (
                  <CircleMarker
                    key={incidentId || index}
                    center={point}
                    radius={isSelected ? 10 : 7}
                    pathOptions={{
                      color: isSelected ? "#dc2626" : "#b91c1c",
                      fillColor: isSelected ? "#f87171" : "#ef4444",
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{
                      click: () =>
                        setSelectedIncident(String(incidentId)),
                    }}
                  >
                    <Popup>
                      <strong>
                        Incident: {incidentId || "Unknown"}
                      </strong>
                      <br />
                      Status: {incident.status || "Unknown"}
                      <br />
                      Severity: {getSeverity(incident)}
                      <br />
                      Latitude: {point[0].toFixed(5)}
                      <br />
                      Longitude: {point[1].toFixed(5)}
                    </Popup>
                  </CircleMarker>
                );
              })}

              {/* Hospital markers */}
              {hospitals.map((hospital, index) => {
                const point = getPoint(hospital);
                if (!point) return null;

                const recommended =
                  String(getHospitalId(hospital)) ===
                  String(selectedRealIncident?.recommended_hospital_id);

                return (
                  <CircleMarker
                    key={getHospitalId(hospital) || index}
                    center={point}
                    radius={recommended ? 10 : 7}
                    pathOptions={{
                      color: recommended ? "#2563eb" : "#0f766e",
                      fillColor: recommended ? "#60a5fa" : "#14b8a6",
                      fillOpacity: 0.9,
                    }}
                  >
                    <Popup>
                      <strong>{getHospitalName(hospital)}</strong>
                      <br />
                      Hospital ID: {getHospitalId(hospital) || "N/A"}
                      <br />
                      Status: {hospital.status || "Unknown"}
                      <br />
                      Latitude: {point[0].toFixed(5)}
                      <br />
                      Longitude: {point[1].toFixed(5)}
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

              {/* Ambulance markers from backend records */}
              {ambulances.map((ambulance, index) => {
                const point = getPoint(ambulance);
                if (!point) return null;

                return (
                  <Marker
                    key={ambulance.ambulance_id || ambulance._id || index}
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
                      Latitude: {point[0].toFixed(5)}
                      <br />
                      Longitude: {point[1].toFixed(5)}
                      <br />
                      Position source:{" "}
                      {ambulance.ambulance_tracking?.source ||
                        ambulance.tracking?.source ||
                        ambulance.position?.source ||
                        "Not specified"}
                    </Popup>
                  </Marker>
                );
              })}
            </MapContainer>
          </div>

          {/* Hospital table */}
          <div className="cc-panel" style={{ marginTop: 16 }}>
            <div className="cc-panel-heading">
              <div>
                <h3>Registered Hospitals &amp; Clinics</h3>
              </div>
              <span className="cc-count">{hospitals.length}</span>
            </div>

            {hospitals.length === 0 ? (
              <p className="cc-footnote">
                {loading ? "Loading hospital records..." : "No hospital records found."}
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
                    {hospitals.map((hospital, index) => {
                      const point = getPoint(hospital);

                      return (
                        <tr key={getHospitalId(hospital) || index}>
                          <td>{getHospitalName(hospital)}</td>
                          <td>{hospital.facility_type || "N/A"}</td>
                          <td>{hospital.status || "Unknown"}</td>
                          <td>
                            {hospital.resources?.beds_available ?? "N/A"}
                          </td>
                          <td>
                            {point
                              ? `${point[0].toFixed(5)}, ${point[1].toFixed(5)}`
                              : "Missing coordinates"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {mapPoints.length === 0 && (
            <p className="cc-footnote">
              No valid coordinates were found in the loaded records.
              Check the FULL MAP DATA console output. This component
              does not fabricate markers or routes.
            </p>
          )}

          {/* Selected incident routing details */}
          <div className="cc-panel" style={{ marginTop: 16 }}>
            <div className="cc-panel-heading">
              <div>
                <span className="eyebrow">INCIDENT DETAILS</span>
                <h3>Hospital routing result</h3>
              </div>
              <span className="cc-sim-chip">
                {selectedRealIncident?.routing_method || "No routing result"}
              </span>
            </div>

            <label className="cc-label" htmlFor="cc-incident-select">
              Select a recorded incident
            </label>

            <select
              id="cc-incident-select"
              className="month-input cc-select"
              value={selectedIncident}
              onChange={(event) => setSelectedIncident(event.target.value)}
            >
              <option value="">Select an incident</option>
              {incidents.map((incident, index) => {
                const incidentId = getIncidentId(incident);

                return (
                  <option
                    key={incidentId || index}
                    value={String(incidentId)}
                  >
                    {incidentId || "Unknown ID"} ·{" "}
                    {incident.status || "Unknown status"}
                  </option>
                );
              })}
            </select>

            {!selectedRealIncident ? (
              <p className="cc-footnote">
                {loading
                  ? "Loading incident records..."
                  : incidents.length === 0
                    ? "No incident records found."
                    : "Select an incident to view its routing details."}
              </p>
            ) : (
              <>
                <p>
                  <strong>Incident:</strong>{" "}
                  {getIncidentId(selectedRealIncident)}
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
                    getHospitalName(realRecommendedHospital)}
                </p>

                <div className="cc-route-metrics">
                  <Metric
                    label="Road distance"
                    value={
                      selectedRealIncident.hospital_distance_km != null
                        ? `${selectedRealIncident.hospital_distance_km} km`
                        : "N/A"
                    }
                  />
                  <Metric
                    label="Estimated travel time"
                    value={
                      selectedRealIncident.estimated_travel_time_min != null
                        ? `${selectedRealIncident.estimated_travel_time_min} min`
                        : "N/A"
                    }
                  />
                  <Metric
                    label="Route geometry"
                    value={
                      realRouteCoordinates.length >= 2
                        ? "Available"
                        : "Unavailable"
                    }
                  />
                </div>

                {selectedRealIncident.routing_error && (
                  <p className="cc-footnote">
                    Routing message: {selectedRealIncident.routing_error}
                  </p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right sidebar */}
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

          {/* Backend resource health */}
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
          </div>
        </aside>
      </div>
{/* ============================================================================================ */}
      {/* Ambulance simulation - separate full-width section */}
      <section
        className="cc-panel cc-ambulance-simulation-panel"
        aria-label="Ambulance tracking and simulation"
        style={{ marginTop: 20, minWidth: 0 }}
      >
        <div className="cc-panel-heading">
          <div>
            <span className="eyebrow">LIVE AMBULANCE OPERATIONS</span>
            <h3>Ambulance Tracking &amp; Simulation</h3>
            
          </div>
        </div>

        <AmbulanceSimulation />
      </section>

      {/* Bottom panels: benchmark and Copilot */}
      <div className="cc-bottom-grid">
        {/* A* vs Dijkstra benchmark */}
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
                  {benchmark.case_count} cases · {benchmark.node_count} nodes ·{" "}
                  {benchmark.edge_count} edges
                </span>
              </div>

              {benchmark.averages && (
                <div className="cc-chart">
                  {[
                    {
                      label: "Dijkstra time",
                      value: benchmark.averages.dijkstra_execution_ms,
                      unit: "ms",
                    },
                    {
                      label: "A* time",
                      value: benchmark.averages.astar_execution_ms,
                      unit: "ms",
                    },
                    {
                      label: "Dijkstra nodes",
                      value: benchmark.averages.dijkstra_nodes_expanded,
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

        {/* AI Dispatch Copilot */}
        <div className="cc-panel">
          <div className="cc-panel-heading">
            <div>
              <span className="eyebrow">
                RETRIEVAL-AUGMENTED ASSISTANT
              </span>
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
        </div>
      </div>
    </section>
  );
}
