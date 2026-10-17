import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useParams,
} from "react-router-dom";

import { api, API_BASE_URL } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import MapView from "../components/MapView";
import AmbulanceRouteMap from "../components/AmbulanceRouteMap";


// ============================================================
// TRACKING STEPS
// ============================================================

const TRACKING_STEPS = [
  {
    key: "RESPONSE_ACCEPTED",
    label: "Response Accepted",
    shortLabel: "Accepted",
  },
  {
    key: "DISPATCHED",
    label: "Ambulance Dispatched",
    shortLabel: "Dispatched",
  },
  {
    key: "EN_ROUTE",
    label: "Ambulance En Route",
    shortLabel: "En Route",
  },
  {
    key: "ARRIVED",
    label: "Ambulance Arrived",
    shortLabel: "Arrived",
  },
  {
    key: "RESOLVED",
    label: "Case Resolved",
    shortLabel: "Resolved",
  },
];


// ============================================================
// STATUS HELPERS
// ============================================================

function getStatusIndex(status) {
  const index =
    TRACKING_STEPS.findIndex(
      (step) =>
        step.key === status
    );

  return index >= 0
    ? index
    : 0;
}


function formatStatus(status) {
  const labels = {
    PENDING:
      "Awaiting Hospital Response",

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
  };

  return (
    labels[status] ||
    status ||
    "Unknown"
  );
}


function getCurrentMessage(status) {
  const messages = {
    PENDING:
      "Waiting for a hospital to accept this emergency.",

    RESPONSE_ACCEPTED:
      "Your hospital has accepted this emergency response.",

    DISPATCHED:
      "An ambulance has been assigned and dispatched.",

    EN_ROUTE:
      "The ambulance is currently travelling to the accident location.",

    ARRIVED:
      "The ambulance has reached the accident location.",

    RESOLVED:
      "The emergency response has been completed.",

    REJECTED:
      "This emergency request was rejected.",
  };

  return (
    messages[status] ||
    "Emergency response is being monitored."
  );
}


// ============================================================
// TIME HELPERS
// ============================================================

function formatClockTime(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleTimeString(
    [],
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }
  );
}


function formatDateTime(value) {
  if (!value) {
    return "—";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "—";
  }

  return date.toLocaleString(
    [],
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }
  );
}


function formatVideoTime(value) {
  const seconds =
    Number(value);

  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return "—";
  }

  const minutes =
    Math.floor(
      seconds / 60
    );

  const remaining =
    Math.floor(
      seconds % 60
    );

  return `${minutes}:${String(
    remaining
  ).padStart(2, "0")}`;
}


function calculateDuration(
  start,
  end
) {
  if (
    !start ||
    !end
  ) {
    return null;
  }

  const startDate =
    new Date(start);

  const endDate =
    new Date(end);

  if (
    Number.isNaN(
      startDate.getTime()
    ) ||
    Number.isNaN(
      endDate.getTime()
    )
  ) {
    return null;
  }

  return Math.max(
    0,
    (
      endDate.getTime() -
      startDate.getTime()
    ) / 1000
  );
}


function formatDuration(
  seconds
) {
  if (
    seconds == null ||
    !Number.isFinite(seconds)
  ) {
    return "—";
  }

  const total =
    Math.round(
      seconds
    );

  const minutes =
    Math.floor(
      total / 60
    );

  const secs =
    total % 60;

  if (
    minutes === 0
  ) {
    return `${secs}s`;
  }

  return `${minutes}m ${String(
    secs
  ).padStart(2, "0")}s`;
}


// ============================================================
// VIDEO URL
// ============================================================

function buildVideoUrl(
  videoClip
) {
  if (!videoClip) {
    return "";
  }

  if (
    videoClip.startsWith(
      "http://"
    ) ||
    videoClip.startsWith(
      "https://"
    )
  ) {
    return videoClip;
  }

  const backendOrigin =
    API_BASE_URL.replace(
      /\/api\/?$/,
      ""
    );

  return `${backendOrigin}${
    videoClip.startsWith("/")
      ? videoClip
      : `/${videoClip}`
  }`;
}


// ============================================================
// DISTANCE
// ============================================================

function distanceKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const toRadians =
    (value) =>
      (
        value *
        Math.PI
      ) / 180;

  const earthRadius =
    6371;

  const dLat =
    toRadians(
      lat2 - lat1
    );

  const dLon =
    toRadians(
      lon2 - lon1
    );

  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +
    Math.cos(
      toRadians(
        lat1
      )
    ) *
      Math.cos(
        toRadians(
          lat2
        )
      ) *
      Math.sin(
        dLon / 2
      ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    );

  return (
    earthRadius *
    c
  );
}


// ============================================================
// LIVE TIMELINE
// ============================================================

function LiveTrackingTimeline({
  incident,
  lastUpdated,
}) {

  const status =
    incident?.status ||
    "RESPONSE_ACCEPTED";

  const currentIndex =
    getStatusIndex(
      status
    );

  const completed =
    status ===
    "RESOLVED";

  const rejected =
    status ===
    "REJECTED";

  const timestamps = {
    RESPONSE_ACCEPTED:
      incident?.accepted_status_at ||
      incident?.hospital_claimed_at,

    DISPATCHED:
      incident?.dispatched_at ||
      incident?.ambulance_assigned_at,

    EN_ROUTE:
      incident?.en_route_at,

    ARRIVED:
      incident?.arrived_at,

    RESOLVED:
      incident?.resolved_at,
  };

  const startTime =
    incident?.accepted_status_at ||
    incident?.hospital_claimed_at ||
    incident?.created_at;

  const endTime =
    incident?.resolved_at ||
    incident?.arrived_at;

  const responseDuration =
    calculateDuration(
      startTime,
      endTime
    );

  return (
    <div
      style={{
        border:
          "1px solid #e2e8f0",
        borderRadius:
          "16px",
        background:
          "#ffffff",
        padding:
          "22px",
        overflow:
          "hidden",
      }}
    >

      {/* HEADER */}

      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          alignItems:
            "flex-start",
          gap:
            "18px",
          flexWrap:
            "wrap",
        }}
      >

        <div>

          <span className="eyebrow">
            LIVE EMERGENCY RESPONSE
          </span>

          <h3
            style={{
              margin:
                "5px 0 5px",
            }}
          >
            Real-time case tracking
          </h3>

          <p
            style={{
              margin:
                0,
              color:
                "#64748b",
              fontSize:
                "13px",
            }}
          >
            {
              getCurrentMessage(
                status
              )
            }
          </p>

        </div>


        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "10px",
            flexWrap:
              "wrap",
          }}
        >

          {!completed &&
            !rejected && (
              <div
                style={{
                  display:
                    "flex",
                  alignItems:
                    "center",
                  gap:
                    "7px",
                  padding:
                    "7px 12px",
                  borderRadius:
                    "999px",
                  background:
                    "#ecfdf5",
                  color:
                    "#15803d",
                  fontSize:
                    "11px",
                  fontWeight:
                    800,
                }}
              >

                <span
                  style={{
                    width:
                      "8px",
                    height:
                      "8px",
                    borderRadius:
                      "50%",
                    background:
                      "#22c55e",
                    animation:
                      "liveDotPulse 1.5s infinite",
                  }}
                />

                LIVE

              </div>
            )}


          {completed && (
            <div
              style={{
                padding:
                  "7px 12px",
                borderRadius:
                  "999px",
                background:
                  "#ecfdf5",
                color:
                  "#15803d",
                fontSize:
                  "11px",
                fontWeight:
                  800,
              }}
            >
              COMPLETED
            </div>
          )}


          <span
            style={{
              fontSize:
                "11px",
              color:
                "#94a3b8",
            }}
          >
            Updated{" "}
            {lastUpdated}
          </span>

        </div>

      </div>


      {/* CURRENT MESSAGE */}

      {!completed &&
        !rejected && (
          <div
            style={{
              marginTop:
                "18px",
              display:
                "flex",
              alignItems:
                "center",
              gap:
                "10px",
              padding:
                "12px 14px",
              borderRadius:
                "10px",
              background:
                "#f8fafc",
              border:
                "1px solid #e2e8f0",
            }}
          >

            <span
              style={{
                fontSize:
                  "18px",
              }}
            >
              {status ===
              "EN_ROUTE"
                ? "🚑"
                : status ===
                    "DISPATCHED"
                  ? "🚨"
                  : "✓"}
            </span>

            <span
              style={{
                fontSize:
                  "13px",
                fontWeight:
                  700,
                color:
                  "#334155",
              }}
            >
              {
                getCurrentMessage(
                  status
                )
              }
            </span>

          </div>
        )}


      {/* TIMELINE */}

      {!rejected && (
        <div
          style={{
            marginTop:
              "30px",
            position:
              "relative",
          }}
        >

          <div
            style={{
              position:
                "absolute",
              top:
                "16px",
              left:
                "5%",
              right:
                "5%",
              height:
                "3px",
              background:
                "#e5e7eb",
              borderRadius:
                "999px",
            }}
          />


          <div
            style={{
              position:
                "absolute",
              top:
                "16px",
              left:
                "5%",
              width:
                `${
                  (
                    currentIndex /
                    (
                      TRACKING_STEPS.length -
                      1
                    )
                  ) *
                  90
                }%`,
              height:
                "3px",
              background:
                "#22c55e",
              borderRadius:
                "999px",
              transition:
                "width .7s ease",
            }}
          />


          {(status ===
            "DISPATCHED" ||
            status ===
              "EN_ROUTE") && (
            <div
              style={{
                position:
                  "absolute",
                top:
                  "-11px",
                left:
                  `${
                    5 +
                    (
                      currentIndex /
                      (
                        TRACKING_STEPS.length -
                        1
                      )
                    ) *
                      90
                  }%`,
                transform:
                  "translateX(-50%)",
                zIndex:
                  4,
                fontSize:
                  "20px",
                transition:
                  "left .7s ease",
                animation:
                  "ambulanceBounce 1.1s infinite ease-in-out",
              }}
            >
              🚑
            </div>
          )}


          <div
            style={{
              display:
                "grid",
              gridTemplateColumns:
                "repeat(5, 1fr)",
              position:
                "relative",
              zIndex:
                3,
            }}
          >

            {TRACKING_STEPS.map(
              (
                step,
                index
              ) => {

                const isPast =
                  index <
                  currentIndex;

                const isCurrent =
                  index ===
                  currentIndex;

                const eventTime =
                  timestamps[
                    step.key
                  ];

                return (
                  <div
                    key={
                      step.key
                    }
                    style={{
                      textAlign:
                        "center",
                    }}
                  >

                    <div
                      style={{
                        width:
                          "32px",
                        height:
                          "32px",
                        margin:
                          "0 auto",
                        borderRadius:
                          "50%",
                        display:
                          "flex",
                        alignItems:
                          "center",
                        justifyContent:
                          "center",
                        background:
                          isPast ||
                          isCurrent
                            ? "#22c55e"
                            : "#ffffff",
                        color:
                          isPast ||
                          isCurrent
                            ? "#ffffff"
                            : "#64748b",
                        border:
                          isCurrent
                            ? "3px solid #16a34a"
                            : isPast
                              ? "2px solid #22c55e"
                              : "2px solid #cbd5e1",
                        fontSize:
                          "12px",
                        fontWeight:
                          900,
                        boxSizing:
                          "border-box",
                        boxShadow:
                          isCurrent
                            ? "0 0 0 7px rgba(34,197,94,.12)"
                            : "none",
                        animation:
                          isCurrent
                            ? "currentStepPulse 1.5s infinite"
                            : "none",
                      }}
                    >
                      {isPast
                        ? "✓"
                        : index + 1}
                    </div>


                    <div
                      style={{
                        marginTop:
                          "10px",
                        fontSize:
                          "11px",
                        fontWeight:
                          isCurrent
                            ? 800
                            : isPast
                              ? 700
                              : 600,
                        color:
                          isCurrent
                            ? "#111827"
                            : isPast
                              ? "#16a34a"
                              : "#94a3b8",
                      }}
                    >
                      {
                        step.shortLabel
                      }
                    </div>


                    <div
                      style={{
                        marginTop:
                          "5px",
                        fontSize:
                          "10px",
                        color:
                          eventTime
                            ? "#64748b"
                            : "#cbd5e1",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      {eventTime
                        ? formatClockTime(
                            eventTime
                          )
                        : "—"}
                    </div>

                  </div>
                );
              }
            )}

          </div>

        </div>
      )}


      {/* INFO */}

      <div
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "1.4fr 1fr 1fr",
          gap:
            "10px",
          marginTop:
            "25px",
        }}
      >

        <div
          style={{
            padding:
              "13px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            Current status
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {
              formatStatus(
                status
              )
            }
          </strong>

        </div>


        <div
          style={{
            padding:
              "13px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            Ambulance
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {
              incident?.ambulance_type ||
              "Not assigned"
            }
          </strong>

        </div>


        <div
          style={{
            padding:
              "13px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            Response time
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {
              formatDuration(
                responseDuration
              )
            }
          </strong>

        </div>

      </div>


      <style>
        {`
          @keyframes liveDotPulse {
            0% {
              opacity: 1;
              transform: scale(1);
            }

            50% {
              opacity: .45;
              transform: scale(.75);
            }

            100% {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes currentStepPulse {
            0% {
              transform: scale(1);
            }

            50% {
              transform: scale(1.08);
            }

            100% {
              transform: scale(1);
            }
          }

          @keyframes ambulanceBounce {
            0% {
              transform:
                translateX(-50%)
                translateY(0);
            }

            50% {
              transform:
                translateX(-50%)
                translateY(-4px);
            }

            100% {
              transform:
                translateX(-50%)
                translateY(0);
            }
          }
        `}
      </style>

    </div>
  );
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function HospitalIncidentDetails() {

  const {
    id: incidentId,
  } = useParams();


  const [
    incident,
    setIncident,
  ] = useState(null);


  const [
    hospital,
    setHospital,
  ] = useState(null);


  const [
    hospitals,
    setHospitals,
  ] = useState([]);


  const [
    loading,
    setLoading,
  ] = useState(true);


  const [
    actionLoading,
    setActionLoading,
  ] = useState(false);


  const [
    error,
    setError,
  ] = useState("");


  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(
    "just now"
  );


  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {

    async function load() {

      try {

        setLoading(
          true
        );

        setError("");

        const [
          incidentData,
          hospitalData,
          availableData,
        ] = await Promise.all([
          api.incidents.get(
            incidentId
          ),

          api.hospitals.me(),

          api.hospitals.available(),
        ]);

        setIncident(
          incidentData
        );

        setHospital(
          hospitalData
        );

        setHospitals(
          Array.isArray(
            availableData
          )
            ? availableData
            : []
        );

      } catch (e) {

        console.error(
          e
        );

        setError(
          e.message
        );

      } finally {

        setLoading(
          false
        );
      }
    }

    load();

  }, [
    incidentId,
  ]);


  // ==========================================================
  // REAL-TIME POLLING
  // ==========================================================

  useEffect(() => {

    if (!incidentId) {
      return;
    }

    const timer =
      setInterval(
        async () => {

          try {

            const data =
              await api.incidents.get(
                incidentId
              );

            setIncident(
              data
            );

            setLastUpdated(
              "just now"
            );

          } catch (e) {

            console.error(
              "Incident refresh failed:",
              e
            );
          }

        },
        1000
      );

    return () => {

      clearInterval(
        timer
      );
    };

  }, [
    incidentId,
  ]);


  // ==========================================================
  // LAST UPDATED COUNTER
  // ==========================================================

  useEffect(() => {

    const timer =
      setInterval(
        () => {

          setLastUpdated(
            (value) => {

              if (
                value ===
                "just now"
              ) {
                return "1s ago";
              }

              const match =
                value.match(
                  /(\d+)s ago/
                );

              if (!match) {
                return value;
              }

              return `${
                Number(
                  match[1]
                ) + 1
              }s ago`;
            }
          );

        },
        1000
      );

    return () => {

      clearInterval(
        timer
      );
    };

  }, []);


  // ==========================================================
  // RECOMMENDED HOSPITAL
  // ==========================================================

  const recommendedHospital =
    useMemo(() => {

      if (
        !incident ||
        incident.latitude ==
          null ||
        incident.longitude ==
          null
      ) {
        return null;
      }

      const candidates =
        hospitals.filter(
          (item) =>
            item.latitude !=
              null &&
            item.longitude !=
              null
        );

      if (
        candidates.length ===
        0
      ) {
        return null;
      }

      let best =
        null;

      for (
        const item
        of candidates
      ) {

        const distance =
          distanceKm(
            Number(
              incident.latitude
            ),

            Number(
              incident.longitude
            ),

            Number(
              item.latitude
            ),

            Number(
              item.longitude
            )
          );

        if (
          !best ||
          distance <
            best.distance
        ) {

          best = {
            ...item,
            distance,
          };
        }
      }

      return best;

    }, [
      incident,
      hospitals,
    ]);


  // ==========================================================
  // STATUS UPDATE
  // ==========================================================

  async function updateStatus(
    nextStatus
  ) {

    try {

      setActionLoading(
        true
      );

      setError("");

      const updated =
        await api.incidents.updateStatus(
          incidentId,
          nextStatus
        );

      setIncident(
        updated
      );

      setLastUpdated(
        "just now"
      );

    } catch (e) {

      setError(
        e.message
      );

    } finally {

      setActionLoading(
        false
      );
    }
  }


  // ==========================================================
  // DISPATCH
  // ==========================================================

  async function dispatchAmbulance() {

    try {

      setActionLoading(
        true
      );

      setError("");

      const result =
        await api.incidents.dispatch(
          incidentId
        );

      setIncident(
        result?.incident ||
        result
      );

      setLastUpdated(
        "just now"
      );

    } catch (e) {

      setError(
        e.message
      );

    } finally {

      setActionLoading(
        false
      );
    }
  }


  // ==========================================================
  // LOADING
  // ==========================================================

  if (loading) {

    return (
      <Loading
        label="Loading emergency case..."
      />
    );
  }


  if (!incident) {

    return (
      <section>

        <ErrorMessage
          message={
            error ||
            "Incident not found."
          }
        />

        <Link
          className="button secondary"
          to="/hospital-dashboard"
        >
          ← Back to Dashboard
        </Link>

      </section>
    );
  }


  // ==========================================================
  // VIDEO URL
  // ==========================================================

  const videoUrl =
    buildVideoUrl(
      incident.video_clip
    );


  // ==========================================================
  // STATUS
  // ==========================================================

  const status =
    incident.status ||
    "RESPONSE_ACCEPTED";


  // ==========================================================
  // ACTION BUTTON
  // ==========================================================

  let actionButton =
    null;


  if (
    status ===
    "RESPONSE_ACCEPTED"
  ) {

    actionButton = (
      <button
        className="button primary"
        onClick={
          dispatchAmbulance
        }
        disabled={
          actionLoading
        }
      >
        {actionLoading
          ? "Dispatching..."
          : "🚑 Dispatch Ambulance"}
      </button>
    );

  } else if (
    status ===
    "DISPATCHED"
  ) {

    actionButton = (
      <button
        className="button primary"
        onClick={() =>
          updateStatus(
            "EN_ROUTE"
          )
        }
        disabled={
          actionLoading
        }
      >
        {actionLoading
          ? "Updating..."
          : "🚑 Start Trip / En Route"}
      </button>
    );

  } else if (
    status ===
    "EN_ROUTE"
  ) {

    actionButton = (
      <button
        className="button primary"
        onClick={() =>
          updateStatus(
            "ARRIVED"
          )
        }
        disabled={
          actionLoading
        }
      >
        {actionLoading
          ? "Updating..."
          : "📍 Mark Arrived"}
      </button>
    );

  } else if (
    status ===
    "ARRIVED"
  ) {

    actionButton = (
      <button
        className="button primary"
        onClick={() =>
          updateStatus(
            "RESOLVED"
          )
        }
        disabled={
          actionLoading
        }
      >
        {actionLoading
          ? "Resolving..."
          : "✓ Mark Resolved"}
      </button>
    );
  }


  // ==========================================================
  // RENDER
  // ==========================================================

  return (
    <section>

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div
        className="page-heading"
      >

        <div>

          <div
            style={{
              marginBottom:
                "10px",
              fontSize:
                "12px",
            }}
          >

            <Link
              to="/hospital-dashboard"
              style={{
                color:
                  "#ef4444",
                fontWeight:
                  700,
                textDecoration:
                  "none",
              }}
            >
              Live Alerts
            </Link>

            <span
              style={{
                margin:
                  "0 7px",
                color:
                  "#94a3b8",
              }}
            >
              /
            </span>

            <span
              style={{
                color:
                  "#94a3b8",
              }}
            >
              {
                incident.incident_id
              }
            </span>

          </div>


          <span className="eyebrow">
            EMERGENCY CASE
          </span>

          <h2>
            {
              incident.incident_id
            }
          </h2>

          <p>

            Detected{" "}
            {formatVideoTime(
              incident.timestamp
            )}{" "}
            into source video

            {incident.created_at && (
              <>
                {" · "}
                Alert created{" "}
                {formatDateTime(
                  incident.created_at
                )}
              </>
            )}

          </p>

        </div>


        <div
          style={{
            display:
              "flex",
            flexDirection:
              "column",
            alignItems:
              "flex-end",
            gap:
              "8px",
          }}
        >

          <span
            className={`availability-chip ${
              status ===
                "REJECTED"
                ? "off"
                : "on"
            }`}
          >
            {
              formatStatus(
                status
              ).toUpperCase()
            }
          </span>


          {![
            "RESOLVED",
            "REJECTED",
          ].includes(
            status
          ) && (
            <span
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                gap:
                  "6px",
                color:
                  "#16a34a",
                fontSize:
                  "11px",
                fontWeight:
                  800,
              }}
            >

              <span
                style={{
                  width:
                    "7px",
                  height:
                    "7px",
                  borderRadius:
                    "50%",
                  background:
                    "#22c55e",
                  animation:
                    "liveDotPulse 1.5s infinite",
                }}
              />

              LIVE MONITORING

            </span>
          )}

        </div>

      </div>


      <ErrorMessage
        message={error}
      />


      {/* ======================================================
          LIVE TIMELINE
      ====================================================== */}

      <div
        className="panel"
      >

        <LiveTrackingTimeline
          incident={
            incident
          }
          lastUpdated={
            lastUpdated
          }
        />

      </div>


      {/* ======================================================
          AMBULANCE ROUTE
      ====================================================== */}

      {(
        status ===
          "DISPATCHED" ||
        status ===
          "EN_ROUTE" ||
        status ===
          "ARRIVED" ||
        status ===
          "RESOLVED"
      ) && (

        <div
          className="panel"
        >

          <AmbulanceRouteMap
  hospital={hospital}
  incident={incident}
  onTripComplete={() => {
    if (
      incident?.status ===
      "EN_ROUTE"
    ) {
      updateStatus("ARRIVED");
    }
  }}
/>

        </div>

      )}


      {/* ======================================================
          VIDEO + DECISION SUPPORT
      ====================================================== */}

      <div
        className="hospital-detail-grid"
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "1.45fr 0.9fr",
          gap:
            "18px",
        }}
      >

        {/* VIDEO */}

        <div
          className="panel"
        >

          <div
            className="panel-heading"
          >

            <div>

              <span className="eyebrow">
                VIDEO EVIDENCE
              </span>

              <h3>
                Accident evidence
              </h3>

              <p>
                Review the detected event
                and visual evidence.
              </p>

            </div>

          </div>


          {videoUrl ? (

            <video
              controls
              preload="metadata"
              src={
                videoUrl
              }
              style={{
                width:
                  "100%",
                display:
                  "block",
                background:
                  "#111827",
                borderRadius:
                  "12px",
                maxHeight:
                  "480px",
              }}
            />

          ) : (

            <div
              className="empty-state"
              style={{
                minHeight:
                  "220px",
              }}
            >

              <strong>
                Evidence clip unavailable
              </strong>

              <span>
                The emergency alert was created
                before the evidence clip finished processing.
              </span>

            </div>

          )}

        </div>


        {/* DECISION SUPPORT */}

        <div
          className="panel"
        >

          <div
            className="panel-heading"
          >

            <div>

              <span className="eyebrow">
                DECISION SUPPORT
              </span>

              <h3>
                Detection summary
              </h3>

              <p>
                Supporting signals from the detector.
              </p>

            </div>

          </div>


          <div>

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                padding:
                  "13px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span>
                Accident confidence
              </span>

              <strong>
                {Math.round(
                  Number(
                    incident.confidence ||
                    0
                  ) * 100
                )}
                %
              </strong>

            </div>


            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                padding:
                  "13px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span>
                Potential severity
              </span>

              <strong>
                {
                  incident.severity
                    ?.level ||
                  "UNKNOWN"
                }
              </strong>

            </div>


            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                padding:
                  "13px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span>
                Severity score
              </span>

              <strong>
                {Number(
                  incident.severity
                    ?.score ||
                  0
                ).toFixed(
                  4
                )}
              </strong>

            </div>


            <div
              style={{
                padding:
                  "13px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span
                style={{
                  display:
                    "block",
                  marginBottom:
                    "6px",
                }}
              >
                Detection signals
              </span>

              <strong
                style={{
                  fontSize:
                    "12px",
                  lineHeight:
                    1.6,
                }}
              >
                {Array.isArray(
                  incident.severity
                    ?.basis
                )
                  ? incident.severity.basis.join(
                      ", "
                    ) ||
                    "None recorded"
                  : "None recorded"}
              </strong>

            </div>


            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                padding:
                  "13px 0",
              }}
            >

              <span>
                Relative speed before
              </span>

              <strong>
                {
                  incident.speed_before !=
                    null
                    ? Number(
                        incident.speed_before
                      ).toFixed(
                        2
                      )
                    : "—"
                }
              </strong>

            </div>

          </div>

        </div>

      </div>


      {/* ======================================================
          RESPONSE INFORMATION
      ====================================================== */}

      <div
        className="panel"
      >

        <div
          className="panel-heading"
        >

          <div>

            <span className="eyebrow">
              RESPONSE INFORMATION
            </span>

            <h3>
              Emergency case
            </h3>

          </div>

        </div>


        <div
          className="stats-grid"
        >

          <div
            className="stat-card"
          >

            <span className="stat-label">
              Camera
            </span>

            <strong className="stat-value">
              {
                incident.camera_id ||
                "—"
              }
            </strong>

            <span className="stat-detail">
              Detection source
            </span>

          </div>


          <div
            className="stat-card"
          >

            <span className="stat-label">
              Ambulance
            </span>

            <strong className="stat-value">
              {
                incident.ambulance_type ||
                "—"
              }
            </strong>

            <span className="stat-detail">
              Assigned resource
            </span>

          </div>


          <div
            className="stat-card"
          >

            <span className="stat-label">
              Hospital
            </span>

            <strong
              className="stat-value"
              style={{
                fontSize:
                  "17px",
              }}
            >
              {
                incident.accepted_by_hospital ||
                incident.dispatch_hospital_name ||
                hospital?.name ||
                "Awaiting assignment"
              }
            </strong>

            <span className="stat-detail">
              Current responder
            </span>

          </div>


          <div
            className="stat-card"
          >

            <span className="stat-label">
              Case status
            </span>

            <strong
              className="stat-value"
              style={{
                fontSize:
                  "16px",
              }}
            >
              {
                formatStatus(
                  status
                )
              }
            </strong>

            <span className="stat-detail">
              Updates automatically
            </span>

          </div>

        </div>

      </div>


      {/* ======================================================
          LOCATION
      ====================================================== */}

      <div
        className="panel"
      >

        <div
          className="panel-heading"
        >

          <div>

            <span className="eyebrow">
              ACCIDENT LOCATION
            </span>

            <h3>
              Emergency location
            </h3>

            <p>

              {incident.latitude !=
                null &&
              incident.longitude !=
                null
                ? `${Number(
                    incident.latitude
                  ).toFixed(
                    5
                  )}, ${Number(
                    incident.longitude
                  ).toFixed(
                    5
                  )}`
                : "Location unavailable"}

            </p>

          </div>


          {recommendedHospital && (

            <div
              style={{
                padding:
                  "10px 13px",
                borderRadius:
                  "10px",
                background:
                  "#ecfdf5",
                color:
                  "#15803d",
                fontSize:
                  "12px",
                fontWeight:
                  800,
              }}
            >

              Nearest available:
              {" "}
              {
                recommendedHospital.name
              }
              {" "}
              (
              {
                recommendedHospital.distance.toFixed(
                  2
                )
              }
              {" "}
              km)

            </div>

          )}

        </div>


        <MapView
          incidents={[
            incident,
          ]}
          hospitals={
            hospitals
          }
          activeIncident={
            incident
          }
          recommendedHospital={
            recommendedHospital
          }
          height={430}
        />

      </div>


      {/* ======================================================
          ACTION BAR
      ====================================================== */}

      <div
        className="panel"
        style={{
          position:
            "sticky",
          bottom:
            "12px",
          zIndex:
            20,
          boxShadow:
            "0 10px 35px rgba(15,23,42,.13)",
        }}
      >

        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            justifyContent:
              "space-between",
            gap:
              "16px",
            flexWrap:
              "wrap",
          }}
        >

          <div>

            <span className="eyebrow">
              CURRENT ACTION
            </span>

            <div
              style={{
                marginTop:
                  "4px",
                fontWeight:
                  800,
              }}
            >
              {
                getCurrentMessage(
                  status
                )
              }
            </div>

          </div>


          <div
            className="button-row"
            style={{
              margin:
                0,
            }}
          >

            <Link
              className="button secondary"
              to="/hospital-dashboard"
            >
              ← Back to Dashboard
            </Link>

            {actionButton}

          </div>

        </div>

      </div>


      <style>
        {`
          @keyframes liveDotPulse {
            0% {
              opacity: 1;
              transform: scale(1);
            }

            50% {
              opacity: .45;
              transform: scale(.75);
            }

            100% {
              opacity: 1;
              transform: scale(1);
            }
          }

          @media (max-width: 900px) {
            .hospital-detail-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}
      </style>

    </section>
  );
}