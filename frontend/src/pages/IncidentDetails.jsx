import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useParams,
} from "react-router-dom";

import { api, API_BASE_URL } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import MapView from "../components/MapView";


// ============================================================
// CONSTANTS
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

function getStepIndex(status) {
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


function currentMessage(status) {
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
      "Emergency response has been completed.",

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
      hour:
        "2-digit",
      minute:
        "2-digit",
      second:
        "2-digit",
      hour12:
        true,
    }
  );
}


function formatRealDateTime(value) {
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
      year:
        "numeric",
      month:
        "short",
      day:
        "numeric",
      hour:
        "2-digit",
      minute:
        "2-digit",
      second:
        "2-digit",
      hour12:
        true,
    }
  );
}


function formatVideoTimestamp(seconds) {
  const value =
    Number(seconds);

  if (
    !Number.isFinite(
      value
    )
  ) {
    return "—";
  }

  const minutes =
    Math.floor(
      value / 60
    );

  const remaining =
    Math.floor(
      value % 60
    );

  return `${minutes}:${String(
    remaining
  ).padStart(2, "0")}`;
}


function durationSeconds(
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
      endDate.getTime()
      - startDate.getTime()
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
    minutes <= 0
  ) {
    return `${secs}s`;
  }

  return `${minutes}m ${String(
    secs
  ).padStart(2, "0")}s`;
}


// ============================================================
// URL HELPER
// ============================================================

function getVideoUrl(
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

  /*
   * Backend stores evidence clips as:
   *
   * /uploads/filename.mp4
   *
   * The frontend runs on port 5173,
   * so make sure the browser requests
   * the clip from Flask on port 5000.
   */

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
    ) *
      Math.sin(
        dLat / 2
      ) +
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
      ) *
      Math.sin(
        dLon / 2
      );

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
// LIVE TRACKING TIMELINE
// ============================================================

function LiveTrackingTimeline({
  incident,
  lastUpdated,
}) {
  const status =
    incident?.status ||
    "PENDING";

  const currentIndex =
    getStepIndex(
      status
    );

  const isCompleted =
    status ===
    "RESOLVED";

  const isRejected =
    status ===
    "REJECTED";

  const timestampMap = {
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

  const trackingStart =
    incident?.accepted_status_at ||
    incident?.hospital_claimed_at ||
    incident?.created_at;

  const finalTime =
    incident?.resolved_at ||
    incident?.arrived_at;

  const responseDuration =
    durationSeconds(
      trackingStart,
      finalTime
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
        position:
          "relative",
        overflow:
          "hidden",
      }}
    >

      {/* ====================================================
          HEADER
      ==================================================== */}

      <div
        style={{
          display:
            "flex",
          justifyContent:
            "space-between",
          alignItems:
            "flex-start",
          gap:
            "16px",
          flexWrap:
            "wrap",
        }}
      >

        <div>

          <div
            style={{
              fontSize:
                "11px",
              fontWeight:
                800,
              letterSpacing:
                "0.08em",
              textTransform:
                "uppercase",
              color:
                "#64748b",
            }}
          >
            Live Emergency Response
          </div>

          <h3
            style={{
              margin:
                "5px 0 5px",
              fontSize:
                "20px",
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
            {currentMessage(
              status
            )}
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
          }}
        >

          <div
            style={{
              display:
                "flex",
              alignItems:
                "center",
              gap:
                "7px",
              padding:
                "7px 11px",
              borderRadius:
                "999px",
              background:
                isCompleted
                  ? "#ecfdf5"
                  : isRejected
                    ? "#fff1f2"
                    : "#ecfdf5",
              color:
                isCompleted
                  ? "#15803d"
                  : isRejected
                    ? "#be123c"
                    : "#15803d",
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
                  isCompleted
                    ? "#22c55e"
                    : isRejected
                      ? "#fb7185"
                      : "#22c55e",
                boxShadow:
                  !isCompleted &&
                  !isRejected
                    ? "0 0 0 5px rgba(34,197,94,0.12)"
                    : "none",
                animation:
                  !isCompleted &&
                  !isRejected
                    ? "livePulse 1.5s infinite"
                    : "none",
              }}
            />

            {isCompleted
              ? "COMPLETED"
              : isRejected
                ? "CLOSED"
                : "LIVE"}

          </div>

          <div
            style={{
              fontSize:
                "11px",
              color:
                "#94a3b8",
            }}
          >
            Updated{" "}
            {lastUpdated}
          </div>

        </div>

      </div>


      {/* ====================================================
          LIVE MESSAGE
      ==================================================== */}

      {!isCompleted &&
        !isRejected && (
          <div
            style={{
              marginTop:
                "18px",
              padding:
                "11px 14px",
              borderRadius:
                "10px",
              background:
                "#f8fafc",
              border:
                "1px solid #e2e8f0",
              display:
                "flex",
              alignItems:
                "center",
              gap:
                "10px",
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
              {currentMessage(
                status
              )}
            </span>

          </div>
        )}


      {/* ====================================================
          STEPS
      ==================================================== */}

      {!isRejected && (
        <div
          style={{
            marginTop:
              "28px",
            position:
              "relative",
          }}
        >

          {/* Base line */}

          <div
            style={{
              position:
                "absolute",
              top:
                "15px",
              left:
                "4%",
              right:
                "4%",
              height:
                "3px",
              background:
                "#e5e7eb",
              borderRadius:
                "999px",
            }}
          />

          {/* Completed line */}

          <div
            style={{
              position:
                "absolute",
              top:
                "15px",
              left:
                "4%",
              width:
                `${
                  currentIndex /
                  (
                    TRACKING_STEPS.length -
                    1
                  ) *
                  92
                }%`,
              height:
                "3px",
              background:
                "#22c55e",
              borderRadius:
                "999px",
              transition:
                "width 0.6s ease",
            }}
          />


          {/* Ambulance moving indicator */}

          {(status ===
            "DISPATCHED" ||
            status ===
              "EN_ROUTE") && (
            <div
              style={{
                position:
                  "absolute",
                top:
                  "-10px",
                left:
                  `${
                    4 +
                    (
                      currentIndex /
                      (
                        TRACKING_STEPS.length -
                        1
                      )
                    ) *
                      92
                  }%`,
                transform:
                  "translateX(-50%)",
                zIndex:
                  3,
                fontSize:
                  "18px",
                transition:
                  "left 0.8s ease",
                filter:
                  "drop-shadow(0 2px 3px rgba(0,0,0,.18))",
                animation:
                  "ambulanceBounce 1s infinite ease-in-out",
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
                `repeat(${
                  TRACKING_STEPS.length
                }, 1fr)`,
              position:
                "relative",
                zIndex:
                  2,
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

                const future =
                  index >
                  currentIndex;

                const stepTime =
                  timestampMap[
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
                      minWidth:
                        0,
                    }}
                  >

                    <div
                      style={{
                        width:
                          "31px",
                        height:
                          "31px",
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
                        fontSize:
                          completed ||
                          current
                            ? "14px"
                            : "11px",
                        fontWeight:
                          900,
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
                          current
                            ? "3px solid #16a34a"
                            : future
                              ? "2px solid #cbd5e1"
                              : "2px solid #22c55e",
                        boxShadow:
                          current
                            ? "0 0 0 7px rgba(34,197,94,0.12)"
                            : "none",
                        animation:
                          current
                            ? "currentStepPulse 1.6s infinite"
                            : "none",
                        boxSizing:
                          "border-box",
                      }}
                    >

                      {completed
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
                          current
                            ? 800
                            : completed
                              ? 700
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
                      {step.shortLabel}
                    </div>


                    <div
                      style={{
                        marginTop:
                          "5px",
                        fontSize:
                          "10px",
                        color:
                          stepTime
                            ? "#64748b"
                            : "#cbd5e1",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      {stepTime
                        ? formatClockTime(
                            stepTime
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


      {/* ====================================================
          CURRENT STATUS CARD
      ==================================================== */}

      <div
        style={{
          marginTop:
            "24px",
          display:
            "grid",
          gridTemplateColumns:
            "1.4fr 1fr 1fr",
          gap:
            "10px",
        }}
      >

        <div
          style={{
            padding:
              "13px",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              textTransform:
                "uppercase",
              fontWeight:
                700,
            }}
          >
            Current status
          </div>

          <div
            style={{
              marginTop:
                "4px",
              fontWeight:
                800,
              color:
                "#111827",
            }}
          >
            {formatStatus(
              status
            )}
          </div>

        </div>


        <div
          style={{
            padding:
              "13px",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              textTransform:
                "uppercase",
              fontWeight:
                700,
            }}
          >
            Ambulance
          </div>

          <div
            style={{
              marginTop:
                "4px",
              fontWeight:
                800,
              color:
                "#111827",
            }}
          >
            {
              incident?.ambulance_type
              || "Not assigned"
            }
          </div>

        </div>


        <div
          style={{
            padding:
              "13px",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
            border:
              "1px solid #e2e8f0",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              textTransform:
                "uppercase",
              fontWeight:
                700,
            }}
          >
            Response time
          </div>

          <div
            style={{
              marginTop:
                "4px",
              fontWeight:
                800,
              color:
                "#111827",
            }}
          >
            {
              formatDuration(
                responseDuration
              )
            }
          </div>

        </div>

      </div>


      {/* ====================================================
          ANIMATIONS
      ==================================================== */}

      <style>
        {`
          @keyframes livePulse {
            0% {
              box-shadow: 0 0 0 0 rgba(34,197,94,0.35);
            }
            70% {
              box-shadow: 0 0 0 7px rgba(34,197,94,0);
            }
            100% {
              box-shadow: 0 0 0 0 rgba(34,197,94,0);
            }
          }

          @keyframes currentStepPulse {
            0% {
              transform: scale(1);
              box-shadow: 0 0 0 0 rgba(34,197,94,0.28);
            }
            50% {
              transform: scale(1.08);
              box-shadow: 0 0 0 8px rgba(34,197,94,0.08);
            }
            100% {
              transform: scale(1);
              box-shadow: 0 0 0 0 rgba(34,197,94,0);
            }
          }

          @keyframes ambulanceBounce {
            0% {
              transform: translateX(-50%) translateY(0);
            }
            50% {
              transform: translateX(-50%) translateY(-4px);
            }
            100% {
              transform: translateX(-50%) translateY(0);
            }
          }

          @media (max-width: 800px) {
            .live-tracking-mobile-grid {
              grid-template-columns: 1fr !important;
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

export default function IncidentDetails() {

  const {
    id: incidentId,
  } = useParams();

  const [
    incident,
    setIncident,
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
    error,
    setError,
  ] = useState("");

  const [
    actionLoading,
    setActionLoading,
  ] = useState(false);

  const [
    lastUpdated,
    setLastUpdated,
  ] = useState(
    "just now"
  );

  // ==========================================================
  // LOAD INCIDENT
  // ==========================================================

  async function loadIncident(
    showLoading = false
  ) {

    try {

      if (
        showLoading
      ) {
        setLoading(true);
      }

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
        "Incident loading failed:",
        e
      );

      setError(
        e.message
      );

    } finally {

      if (
        showLoading
      ) {
        setLoading(false);
      }
    }
  }


  // ==========================================================
  // LOAD HOSPITALS
  // ==========================================================

  async function loadHospitals() {

    try {

      const data =
        await api.hospitals.available();

      setHospitals(
        Array.isArray(
          data
        )
          ? data
          : []
      );

    } catch (e) {

      console.error(
        "Hospital loading failed:",
        e
      );
    }
  }


  // ==========================================================
  // INITIAL LOAD
  // ==========================================================

  useEffect(() => {

    loadIncident(
      true
    );

    loadHospitals();

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

    /*
     * Poll every second.
     *
     * This makes the timeline feel live while keeping
     * the implementation simple and reliable.
     */

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
              "Real-time incident refresh failed:",
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
  // "UPDATED X SECONDS AGO"
  // ==========================================================

  useEffect(() => {

    const timer =
      setInterval(
        () => {

          setLastUpdated(
            (current) => {

              if (
                current ===
                "just now"
              ) {
                return "1s ago";
              }

              const match =
                current.match(
                  /(\d+)s ago/
                );

              if (!match) {
                return current;
              }

              const seconds =
                Number(
                  match[1]
                );

              return `${seconds + 1}s ago`;
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

      const available =
        hospitals.filter(
          (hospital) =>
            hospital.latitude !=
              null &&
            hospital.longitude !=
              null
        );

      if (
        available.length === 0
      ) {
        return null;
      }

      let best =
        null;

      for (
        const hospital
        of available
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
              hospital.latitude
            ),

            Number(
              hospital.longitude
            )
          );

        if (
          best === null ||
          distance <
            best.distance
        ) {

          best = {
            ...hospital,
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
  // INCIDENT ACTION
  // ==========================================================

  async function updateStatus(
    status
  ) {

    try {

      setActionLoading(
        true
      );

      setError("");

      const updated =
        await api.incidents.updateStatus(
          incidentId,
          status
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
        result.incident ||
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
          Back to Dashboard
        </Link>

      </section>
    );
  }


  // ==========================================================
  // VIDEO
  // ==========================================================

  const videoUrl =
    getVideoUrl(
      incident.video_clip
    );


  // ==========================================================
  // ACTIONS
  // ==========================================================

  const status =
    incident.status;


  // ==========================================================
  // NEXT ACTION
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
          : "🚑 Mark En Route"}
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
  // UI
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
              fontSize:
                "12px",
              marginBottom:
                "10px",
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
                color:
                  "#94a3b8",
                margin:
                  "0 6px",
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
              {incident.incident_id}
            </span>

          </div>


          <span className="eyebrow">
            EMERGENCY CASE
          </span>

          <h2>
            {incident.incident_id}
          </h2>

          <p>

            Detected{" "}
            {formatVideoTimestamp(
              incident.timestamp
            )}{" "}
            into the source video

            {incident.created_at && (
              <>
                {" · "}
                Alert created{" "}
                {formatRealDateTime(
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
                "RESOLVED"
                ? "on"
                : status ===
                    "REJECTED"
                  ? "off"
                  : "on"
            }`}
          >
            {formatStatus(
              status
            ).toUpperCase()}
          </span>

          {![
            "RESOLVED",
            "REJECTED",
          ].includes(
            status
          ) && (
            <span
              style={{
                fontSize:
                  "11px",
                color:
                  "#16a34a",
                fontWeight:
                  800,
                display:
                  "flex",
                alignItems:
                  "center",
                gap:
                  "6px",
              }}
            >

              <span
                style={{
                  width:
                    "7px",
                  height:
                    "7px",
                  background:
                    "#22c55e",
                  borderRadius:
                    "50%",
                  animation:
                    "headerLivePulse 1.4s infinite",
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
          LIVE TRACKING
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
          MAIN TWO COLUMN
      ====================================================== */}

      <div
        className="content-grid"
      >

        {/* ====================================================
            VIDEO
        ==================================================== */}

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
                Review the detected event and
                supporting visual evidence.
              </p>

            </div>

          </div>


          {videoUrl ? (

            <video
              controls
              preload="metadata"
              style={{
                width:
                  "100%",
                display:
                  "block",
                borderRadius:
                  "12px",
                background:
                  "#111827",
                maxHeight:
                  "500px",
              }}
              src={
                videoUrl
              }
            />

          ) : (

            <div
              className="empty-state"
            >

              <strong>
                Evidence clip is still being prepared
              </strong>

              <span>
                The incident was already sent to the
                hospital before clip generation finished.
              </span>

            </div>

          )}

        </div>


        {/* ====================================================
            DECISION SUPPORT
        ==================================================== */}

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
                Supporting signals from the accident detector.
              </p>

            </div>

          </div>


          <div
            style={{
              display:
                "flex",
              flexDirection:
                "column",
              gap:
                "0",
            }}
          >

            <div
              style={{
                display:
                  "flex",
                justifyContent:
                  "space-between",
                padding:
                  "12px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span>
                Accident confidence
              </span>

              <strong>
                {
                  Number(
                    incident.confidence ??
                    0
                  ).toLocaleString(
                    undefined,
                    {
                      style:
                        "percent",
                      maximumFractionDigits:
                        0,
                    }
                  )
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
                  "12px 0",
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
                  "12px 0",
                borderBottom:
                  "1px solid #e2e8f0",
              }}
            >

              <span>
                Severity score
              </span>

              <strong>
                {
                  Number(
                    incident.severity
                      ?.score ??
                    0
                  ).toFixed(
                    4
                  )
                }
              </strong>

            </div>


            <div
              style={{
                padding:
                  "12px 0",
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
                {
                  Array.isArray(
                    incident.severity
                      ?.basis
                  )
                    ? incident.severity.basis.join(
                        ", "
                      ) ||
                      "None recorded"
                    : "None recorded"
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
                  "12px 0",
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
          CASE INFORMATION
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
                  "18px",
              }}
            >
              {
                incident.accepted_by_hospital ||
                incident.dispatch_hospital_name ||
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
              Response status
            </span>

            <strong
              className="stat-value"
              style={{
                fontSize:
                  "17px",
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
            10,
          boxShadow:
            "0 8px 30px rgba(15,23,42,0.12)",
        }}
      >

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
              className="eyebrow"
            >
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
                currentMessage(
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


      {/* ======================================================
          HEADER ANIMATION
      ====================================================== */}

      <style>
        {`
          @keyframes headerLivePulse {
            0% {
              opacity: 1;
              transform: scale(1);
            }
            50% {
              opacity: 0.45;
              transform: scale(0.75);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>

    </section>
  );
}