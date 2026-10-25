import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
} from "react-router-dom";

import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import MapView from "../components/MapView";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip } from "react-leaflet";
import {
  formatConfidence,
  formatDate,
} from "../utils";



function HospitalTrackingMap({ incident, hospital }) {
  const num = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const start = hospital && num(hospital.latitude) !== null && num(hospital.longitude) !== null ? [num(hospital.latitude), num(hospital.longitude)] : null;
  const end = incident && num(incident.latitude) !== null && num(incident.longitude) !== null ? [num(incident.latitude), num(incident.longitude)] : null;
  if (!start || !end) return <p className="muted-text">Map unavailable: incident or facility coordinates are missing.</p>;
  const progress = Math.max(0, Math.min(1, num(incident.simulation_progress) ?? (incident.status === "ARRIVED" ? 1 : 0)));
  const ambulance = [start[0] + (end[0] - start[0]) * progress, start[1] + (end[1] - start[1]) * progress];
  return <div style={{ marginTop: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 8 }}><strong>Simulated ambulance tracking</strong><span className="muted-text">{Math.round(progress * 100)}% · {incident.status}</span></div><MapContainer center={start} zoom={12} scrollWheelZoom={false} style={{ height: 250, width: "100%", borderRadius: 10 }}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Polyline positions={[start, end]} pathOptions={{ color: "#64748b", weight: 4, dashArray: "6 6" }}/><Polyline positions={progress > 0 ? [start, ambulance] : []} pathOptions={{ color: "#dc2626", weight: 4 }}/><Marker position={start}><Tooltip>{hospital.name} · dispatch point</Tooltip></Marker><CircleMarker center={end} radius={8} pathOptions={{ color: "#b91c1c", fillColor: "#ef4444", fillOpacity: 1 }}><Tooltip>Accident location</Tooltip></CircleMarker><CircleMarker center={ambulance} radius={7} pathOptions={{ color: "#075985", fillColor: "#38bdf8", fillOpacity: 1 }}><Tooltip>🚑 Simulated ambulance</Tooltip></CircleMarker></MapContainer><p className="muted-text" style={{ marginTop: 6 }}>Prototype route only — position changes when the public /ambulance simulation is advanced.</p></div>;
}

function distanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const toRadians = (
    value
  ) => (
    value * Math.PI
  ) / 180;

  const earthRadius = 6371;

  const dLat = toRadians(
    lat2 - lat1
  );

  const dLon = toRadians(
    lon2 - lon1
  );

  const a =
    Math.sin(
      dLat / 2
    ) *
      Math.sin(
        dLat / 2
      ) +
    Math.cos(
      toRadians(lat1)
    ) *
      Math.cos(
        toRadians(lat2)
      ) *
      Math.sin(
        dLon / 2
      ) *
      Math.sin(
        dLon / 2
      );

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return (
    earthRadius * c
  );
}


// ============================================================
// STATUS HELPERS
// ============================================================

const TRACKING_STEPS = [
  "RESPONSE_ACCEPTED",
  "DISPATCHED",
  "EN_ROUTE",
  "ARRIVED",
  "RESOLVED",
];


function statusLabel(
  status
) {
  const labels = {
    RESPONSE_ACCEPTED:
      "Response Accepted",

    DISPATCHED:
      "Ambulance Dispatched",

    EN_ROUTE:
      "Ambulance En Route",

    ARRIVED:
      "Ambulance Arrived",

    RESOLVED:
      "Case Resolved",

    REJECTED:
      "Rejected",

    PENDING:
      "Pending",
  };

  return (
    labels[status] ||
    status ||
    "Unknown"
  );
}


function stepIndex(
  status
) {
  const index =
    TRACKING_STEPS.indexOf(
      status
    );

  return index >= 0
    ? index
    : 0;
}


function isActiveCase(
  status
) {
  return [
    "RESPONSE_ACCEPTED",
    "DISPATCHED",
    "EN_ROUTE",
    "ARRIVED",
  ].includes(
    status
  );
}


// ============================================================
// TRACKING COMPONENT
// ============================================================

function CaseTracking({
  status,
}) {
  const currentIndex =
    stepIndex(status);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0",
        width: "100%",
        marginTop: "18px",
        marginBottom: "6px",
      }}
    >
      {TRACKING_STEPS.map(
        (
          step,
          index
        ) => {

          const completed =
            index <
            currentIndex;

          const current =
            index ===
            currentIndex;

          const pending =
            index >
            currentIndex;

          return (
            <div
              key={step}
              style={{
                flex: 1,
                position:
                  "relative",
                minWidth: 0,
              }}
            >

              {index <
                TRACKING_STEPS.length -
                  1 && (
                <div
                  style={{
                    position:
                      "absolute",
                    top: "11px",
                    left: "50%",
                    width: "100%",
                    height: "2px",
                    background:
                      completed ||
                      current
                        ? "#22c55e"
                        : "#e5e7eb",
                    zIndex: 0,
                  }}
                />
              )}

              <div
                style={{
                  position:
                    "relative",
                  zIndex: 1,
                  display:
                    "flex",
                  justifyContent:
                    "center",
                }}
              >

                <div
                  style={{
                    width:
                      "24px",
                    height:
                      "24px",
                    borderRadius:
                      "50%",
                    display:
                      "flex",
                    alignItems:
                      "center",
                    justifyContent:
                      "center",
                    fontSize:
                      "12px",
                    fontWeight:
                      800,
                    background:
                      completed ||
                      current
                        ? "#22c55e"
                        : "#ffffff",
                    color:
                      completed ||
                      current
                        ? "#ffffff"
                        : "#64748b",
                    border:
                      pending
                        ? "2px solid #dbe1e8"
                        : "2px solid #22c55e",
                    boxSizing:
                      "border-box",
                  }}
                >
                  {completed
                    ? "✓"
                    : index + 1}
                </div>

              </div>

              <div
                style={{
                  textAlign:
                    "center",
                  marginTop:
                    "8px",
                  padding:
                    "0 3px",
                  fontSize:
                    "10px",
                  fontWeight:
                    current
                      ? 800
                      : 600,
                  color:
                    current
                      ? "#111827"
                      : completed
                        ? "#16a34a"
                        : "#94a3b8",
                  lineHeight:
                    1.25,
                }}
              >
                {statusLabel(
                  step
                )}
              </div>

            </div>
          );
        }
      )}
    </div>
  );
}


// ============================================================
// MAIN DASHBOARD
// ============================================================

export default function HospitalDashboard() {

  const navigate =
    useNavigate();

  const [
    hospital,
    setHospital,
  ] = useState(null);

  const [
    alerts,
    setAlerts,
  ] = useState([]);

  const [
    stats,
    setStats,
  ] = useState(null);

  const [
    availableHospitals,
    setAvailableHospitals,
  ] = useState([]);

  const [
    activeCases,
    setActiveCases,
  ] = useState([]);

  const [
    error,
    setError,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(true);


  // ==========================================================
  // LOAD PENDING ALERTS
  // ==========================================================

  async function loadPending() {
    try {

      const pending =
        await api.incidents.pending();

      setAlerts(
        Array.isArray(
          pending
        )
          ? pending
          : []
      );

    } catch (e) {

      console.error(
        "Pending incident poll failed:",
        e
      );
    }
  }


  // ==========================================================
  // LOAD ACTIVE ACCEPTED CASES
  // ==========================================================

  async function loadActiveCases() {

    try {

      const history =
        await api.incidents.history();

      if (
        !Array.isArray(
          history
        )
      ) {
        setActiveCases(
          []
        );

        return;
      }

      /*
       * /hospital/history returns attendance records.
       *
       * Each accepted case contains incident_id.
       *
       * We then fetch the latest incident state so the
       * dashboard can show:
       *
       * RESPONSE_ACCEPTED
       * DISPATCHED
       * EN_ROUTE
       * ARRIVED
       * RESOLVED
       */

      const detailedCases =
        await Promise.all(
          history.map(
            async (
              record
            ) => {

              if (
                !record?.incident_id
              ) {
                return null;
              }

              try {

                const incident =
                  await api.incidents.get(
                    record.incident_id
                  );

                return {
                  ...record,
                  ...incident,
                };

              } catch (e) {

                console.error(
                  "Could not load incident:",
                  record.incident_id,
                  e
                );

                return {
                  ...record,
                };
              }
            }
          )
        );

      const active =
        detailedCases
          .filter(
            Boolean
          )
          .filter(
            (item) =>
              isActiveCase(
                item.status
              )
          );

      setActiveCases(
        active
      );

    } catch (e) {

      console.error(
        "Active cases loading failed:",
        e
      );
    }
  }


  // ==========================================================
  // FULL DASHBOARD LOAD
  // ==========================================================

  async function loadDashboard() {

    try {

      setError("");

      const [
        hospitalData,
        statsData,
        hospitalsData,
      ] = await Promise.all([
        api.hospitals.me(),

        api.incidents.stats(),

        api.hospitals.available(),
      ]);

      setHospital(
        hospitalData
      );

      setStats(
        statsData
      );

      setAvailableHospitals(
        Array.isArray(
          hospitalsData
        )
          ? hospitalsData
          : []
      );

      await Promise.all([
        loadPending(),
        loadActiveCases(),
      ]);

    } catch (e) {

      setError(
        e.message
      );

    } finally {

      setLoading(
        false
      );
    }
  }


  // ==========================================================
  // POLLING
  // ==========================================================

  useEffect(() => {

    loadDashboard();

    /*
     * Pending emergency alerts are polled quickly.
     */
    const pendingTimer =
      setInterval(
        loadPending,
        750
      );

    /*
     * Active accepted cases also need to update
     * when ambulance status changes.
     */
    const activeCaseTimer =
      setInterval(
        loadActiveCases,
        2000
      );

    /*
     * Hospital resources/stats/map data can be slower.
     */
    const dashboardTimer =
      setInterval(
        loadDashboard,
        5000
      );

    return () => {

      clearInterval(
        pendingTimer
      );

      clearInterval(
        activeCaseTimer
      );

      clearInterval(
        dashboardTimer
      );
    };

  }, []);


  // ==========================================================
  // ACTIVE INCIDENT
  // ==========================================================

  const activeIncident =
    alerts.length > 0
      ? alerts[0]
      : null;


  // ==========================================================
  // RECOMMENDED HOSPITAL
  // ==========================================================

  const recommendedHospital =
    useMemo(() => {

      if (
        !activeIncident ||
        activeIncident.latitude ==
          null ||
        activeIncident.longitude ==
          null
      ) {
        return null;
      }

      const candidates =
        availableHospitals.filter(
          (item) =>
            item.latitude !=
              null &&
            item.longitude !=
              null
        );

      if (
        candidates.length === 0
      ) {
        return null;
      }

      let best = null;

      for (
        const hospitalItem
        of candidates
      ) {

        const distance =
          distanceKm(
            Number(
              activeIncident.latitude
            ),

            Number(
              activeIncident.longitude
            ),

            Number(
              hospitalItem.latitude
            ),

            Number(
              hospitalItem.longitude
            )
          );

        if (
          best === null ||
          distance <
            best.distance
        ) {

          best = {
            ...hospitalItem,
            distance,
          };
        }
      }

      return best;

    }, [
      activeIncident,
      availableHospitals,
    ]);


  // ==========================================================
  // ACCEPT
  // ==========================================================

  async function accept(
    incidentId
  ) {

    try {

      await api.incidents.accept(
        incidentId
      );

      /*
       * Do NOT call loadDashboard first.
       *
       * Once accepted, /pending no longer contains
       * the incident. Navigate immediately.
       */
      navigate(
        `/hospital/incidents/${encodeURIComponent(
          incidentId
        )}`
      );

    } catch (e) {

      setError(
        e.message
      );
    }
  }


  // ==========================================================
  // REJECT
  // ==========================================================

  async function reject(
    incidentId
  ) {

    try {

      await api.incidents.reject(
        incidentId
      );

      await loadPending();

    } catch (e) {

      setError(
        e.message
      );
    }
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {

    return (
      <Loading
        label="Loading emergency dashboard..."
      />
    );
  }


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <section>

      {/* ======================================================
          PAGE HEADER
      ====================================================== */}

      <div className="page-heading">

        <div>

          <span className="eyebrow">
            LIVE ACCIDENT QUEUE
          </span>

          <h2>
            Upcoming accidents
          </h2>

          <p>
            Accident alerts are sent directly
            from the live detection service.
          </p>

        </div>


        <span
          className={`availability-chip ${
            hospital?.emergency_available
              ? "on"
              : "off"
          }`}
        >
          {hospital?.emergency_available
            ? "AVAILABLE"
            : "UNAVAILABLE"}
        </span>

      </div>


      <ErrorMessage
        message={error}
      />


      {/* ======================================================
          STATS
      ====================================================== */}

      <div className="stats-grid">

        <div className="stat-card danger">

          <span className="stat-label">
            Live alerts
          </span>

          <strong className="stat-value">
            {alerts.length}
          </strong>

          <span className="stat-detail">
            Pending hospital response
          </span>

        </div>


        <div className="stat-card">

          <span className="stat-label">
            Active responses
          </span>

          <strong className="stat-value">
            {activeCases.length}
          </strong>

          <span className="stat-detail">
            Accepted cases in progress
          </span>

        </div>


        <div className="stat-card">

          <span className="stat-label">
            Attended this month
          </span>

          <strong className="stat-value">
            {stats?.attended_this_month ??
              0}
          </strong>

          <span className="stat-detail">
            Your hospital
          </span>

        </div>


        <div className="stat-card">

          <span className="stat-label">
            Ambulances
          </span>

          <strong className="stat-value">
            {
              (hospital?.resources
                ?.small_ambulances ??
                0) +
              (hospital?.resources
                ?.large_ambulances ??
                0)
            }
          </strong>

          <span className="stat-detail">
            Small + large
          </span>

        </div>

      </div>


      {/* ======================================================
          ACTIVE RESPONSE CASES
      ====================================================== */}

      <div className="panel">

        <div className="panel-heading">

          <div>

            <span className="eyebrow">
              ACTIVE RESPONSE CASES
            </span>

            <h3>
              Accepted requests
            </h3>

            <p>
              Track every case your hospital has accepted
              until the ambulance arrives and the incident
              is resolved.
            </p>

          </div>

        </div>


        {activeCases.length === 0 ? (

          <div className="empty-state">

            <strong>
              No active response cases
            </strong>

            <span>
              Accepted emergency requests will appear here.
            </span>

          </div>

        ) : (

          <div
            style={{
              display:
                "flex",
              flexDirection:
                "column",
              gap:
                "14px",
            }}
          >

            {activeCases.map(
              (
                incident
              ) => (

                <div
                  key={
                    incident.incident_id
                  }

                  style={{
                    border:
                      "1px solid #e2e8f0",
                    borderRadius:
                      "14px",
                    padding:
                      "18px",
                    background:
                      "#ffffff",
                  }}
                >

                  {/* ------------------------------------------
                      CASE HEADER
                  ------------------------------------------ */}

                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      alignItems:
                        "center",
                      gap:
                        "16px",
                      flexWrap:
                        "wrap",
                    }}
                  >

                    <div>

                      <span
                        className="alert-label"
                      >
                        ACCEPTED CASE
                      </span>

                      <h3
                        style={{
                          margin:
                            "5px 0 4px",
                        }}
                      >
                        {
                          incident.incident_id
                        }
                      </h3>

                      <p
                        style={{
                          margin:
                            0,
                        }}
                      >
                        Accepted{" "}
                        {incident.accepted_at
                          ? formatDate(
                              incident.accepted_at
                            )
                          : "recently"}
                      </p>

                    </div>


                    <div
                      style={{
                        textAlign:
                          "right",
                      }}
                    >

                      <div
                        style={{
                          fontSize:
                            "11px",
                          fontWeight:
                            700,
                          color:
                            "#64748b",
                          textTransform:
                            "uppercase",
                          letterSpacing:
                            "0.06em",
                        }}
                      >
                        Current status
                      </div>

                      <div
                        style={{
                          marginTop:
                            "5px",
                          fontWeight:
                            800,
                          color:
                            "#111827",
                        }}
                      >
                        {
                          statusLabel(
                            incident.status
                          )
                        }
                      </div>

                    </div>

                  </div>


                  <HospitalTrackingMap incident={incident} hospital={hospital} />
                  <p style={{ marginTop: 8 }}><Link to="/ambulance">Open public ambulance simulation controls →</Link></p>

                  {/* ------------------------------------------
                      METRICS
                  ------------------------------------------ */}

                  <div
                    className="alert-metrics"
                    style={{
                      marginTop:
                        "16px",
                    }}
                  >

                    <div>

                      <span>
                        Confidence
                      </span>

                      <strong>
                        {formatConfidence(
                          incident.confidence
                        )}
                      </strong>

                    </div>


                    <div>

                      <span>
                        Severity
                      </span>

                      <strong>
                        {
                          incident.severity
                            ?.level ||
                          "UNKNOWN"
                        }
                      </strong>

                    </div>


                    <div>

                      <span>
                        Camera
                      </span>

                      <strong>
                        {
                          incident.camera_id ||
                          "—"
                        }
                      </strong>

                    </div>


                    <div>

                      <span>
                        Ambulance
                      </span>

                      <strong>
                        {
                          incident.ambulance_type ||
                          "Not dispatched"
                        }
                      </strong>

                    </div>

                  </div>


                  {/* ------------------------------------------
                      TRACKING TIMELINE
                  ------------------------------------------ */}

                  <CaseTracking
                    status={
                      incident.status ||
                      "RESPONSE_ACCEPTED"
                    }
                  />


                  {/* ------------------------------------------
                      ACTIONS
                  ------------------------------------------ */}

                  <div
                    className="button-row"
                    style={{
                      marginTop:
                        "20px",
                    }}
                  >

                    <Link
                      className="button primary"
                      to={`/hospital/incidents/${encodeURIComponent(
                        incident.incident_id
                      )}`}
                    >
                      TRACK CASE
                    </Link>

                  </div>

                </div>

              )
            )}

          </div>

        )}

      </div>


      {/* ======================================================
          EMERGENCY MAP
      ====================================================== */}

      <div className="panel">

        <div className="panel-heading">

          <div>

            <span className="eyebrow">
              EMERGENCY LOCATION
            </span>

            <h3>
              Accident and hospital network
            </h3>

            <p>

              {recommendedHospital

                ? `Nearest available hospital: ${
                    recommendedHospital.name
                  } (${recommendedHospital.distance.toFixed(
                    2
                  )} km)`

                : "Hospital locations are shown when coordinates are available."}

            </p>

          </div>

        </div>


        <MapView
          incidents={
            alerts
          }

          hospitals={
            availableHospitals
          }

          activeIncident={
            activeIncident
          }

          recommendedHospital={
            recommendedHospital
          }

          routePath={activeIncident?.latitude != null && hospital?.latitude != null ? [[Number(activeIncident.latitude), Number(activeIncident.longitude)], [Number(hospital.latitude), Number(hospital.longitude)]] : []}

          simulatedAmbulance={activeIncident && ["RESPONSE_ACCEPTED", "DISPATCHED", "EN_ROUTE", "ARRIVED"].includes(activeIncident.status) && activeIncident.latitude != null && hospital?.latitude != null ? { latitude: Number(hospital.latitude) + (Number(activeIncident.latitude) - Number(hospital.latitude)) * Math.max(0, Math.min(1, Number(activeIncident.simulation_progress || 0))), longitude: Number(hospital.longitude) + (Number(activeIncident.longitude) - Number(hospital.longitude)) * Math.max(0, Math.min(1, Number(activeIncident.simulation_progress || 0))), label: activeIncident.ambulance_id || "SIM-AMB-01", status: "Simulated GPS — advance at /ambulance" } : null}

          trafficEvents={activeIncident?.latitude != null && hospital?.latitude != null ? [{ id: "preview-traffic-a", latitude: Number(activeIncident.latitude) + (Number(hospital.latitude) - Number(activeIncident.latitude)) * 0.3, longitude: Number(activeIncident.longitude) + (Number(hospital.longitude) - Number(activeIncident.longitude)) * 0.3, label: "Mock traffic overlay", detail: "Illustrative only; not connected to live traffic." }, { id: "preview-traffic-b", latitude: Number(activeIncident.latitude) + (Number(hospital.latitude) - Number(activeIncident.latitude)) * 0.7, longitude: Number(activeIncident.longitude) + (Number(hospital.longitude) - Number(activeIncident.longitude)) * 0.7, label: "Mock road incident", detail: "Illustrative only; not a live accident feed." }] : []}

          height={420}
        />

      </div>


      {/* ======================================================
          PENDING ALERT QUEUE
      ====================================================== */}

      <div className="alert-list">

        {alerts.length === 0 ? (

          <div className="panel empty-state large">

            <strong>
              No pending accident alerts
            </strong>

            <span>
              New alerts will appear automatically.
            </span>

          </div>

        ) : (

          alerts.map(
            (
              incident
            ) => (

              <div
                className="alert-card"
                key={
                  incident.incident_id
                }
              >

                <div>

                  <span className="alert-label">
                    NEW ACCIDENT
                  </span>

                  <h3>
                    {
                      incident.incident_id
                    }
                  </h3>

                  <p>
                    {
                      formatDate(
                        incident.timestamp
                      )
                    }
                  </p>

                </div>


                <div className="alert-metrics">

                  <div>

                    <span>
                      Confidence
                    </span>

                    <strong>
                      {
                        formatConfidence(
                          incident.confidence
                        )
                      }
                    </strong>

                  </div>


                  <div>

                    <span>
                      Severity
                    </span>

                    <strong>
                      {
                        incident.severity
                          ?.level ||
                        "UNKNOWN"
                      }
                    </strong>

                  </div>


                  <div>

                    <span>
                      Camera
                    </span>

                    <strong>
                      {
                        incident.camera_id
                      }
                    </strong>

                  </div>

                </div>


                <div className="button-row">

                  <Link
                    className="button secondary"
                    to={`/hospital/incidents/${encodeURIComponent(
                      incident.incident_id
                    )}`}
                  >
                    Review
                  </Link>


                  <button
                    className="button primary"
                    onClick={() =>
                      accept(
                        incident.incident_id
                      )
                    }
                  >
                    ACCEPT FIRST
                  </button>


                  <button
                    className="button danger"
                    onClick={() =>
                      reject(
                        incident.incident_id
                      )
                    }
                  >
                    Reject
                  </button>

                </div>

              </div>

            )
          )

        )}

      </div>

    </section>
  );
}