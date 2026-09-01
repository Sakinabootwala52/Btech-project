import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "../api";

import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import MapView from "../components/MapView";

import {
  formatConfidence,
  formatDate,
} from "../utils";


/* ============================================================
   DISTANCE
   ============================================================ */

function distanceKm(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R = 6371;

  const dLat =
    ((lat2 - lat1) * Math.PI) /
    180;

  const dLng =
    ((lng2 - lng1) * Math.PI) /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      (lat1 * Math.PI) / 180
    ) *
      Math.cos(
        (lat2 * Math.PI) / 180
      ) *
      Math.sin(dLng / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}


/* ============================================================
   RESOURCE HELPERS
   ============================================================ */

function getBeds(hospital) {
  return Number(
    hospital?.resources?.beds_available ??
      hospital?.beds_available ??
      hospital?.beds ??
      0
  );
}


function getAmbulances(hospital) {
  const small = Number(
    hospital?.resources?.small_ambulances ??
      hospital?.small_ambulances ??
      0
  );

  const large = Number(
    hospital?.resources?.large_ambulances ??
      hospital?.large_ambulances ??
      0
  );

  return small + large;
}


function getHospitalName(hospital) {
  return (
    hospital?.name ||
    hospital?.hospital_name ||
    "Hospital"
  );
}


function isAvailable(hospital) {
  if (
    hospital?.emergency_available != null
  ) {
    return Boolean(
      hospital.emergency_available
    );
  }

  if (hospital?.status) {
    return ![
      "unavailable",
      "offline",
      "closed",
      "full",
      "busy",
    ].includes(
      String(hospital.status)
        .trim()
        .toLowerCase()
    );
  }

  return true;
}


/* ============================================================
   RANK HOSPITALS
   ============================================================ */

function rankHospitals(
  incident,
  hospitals
) {
  if (
    incident?.latitude == null ||
    incident?.longitude == null
  ) {
    return [];
  }

  const accidentLat =
    Number(incident.latitude);

  const accidentLng =
    Number(incident.longitude);

  if (
    Number.isNaN(accidentLat) ||
    Number.isNaN(accidentLng)
  ) {
    return [];
  }

  return hospitals
    .filter(
      (hospital) =>
        hospital?.latitude != null &&
        hospital?.longitude != null
    )
    .map((hospital) => {
      const distance =
        distanceKm(
          accidentLat,
          accidentLng,
          Number(hospital.latitude),
          Number(hospital.longitude)
        );

      const beds =
        getBeds(hospital);

      const ambulances =
        getAmbulances(hospital);

      const available =
        isAvailable(hospital);

      /*
       * Decision-support score.
       *
       * We prefer:
       * - closer hospitals
       * - more ambulances
       * - more beds
       * - currently available emergency service
       */

      const distanceScore =
        Math.max(
          0,
          50 - distance * 5
        );

      const ambulanceScore =
        Math.min(
          20,
          ambulances * 10
        );

      const bedScore =
        Math.min(
          20,
          beds * 2
        );

      const availabilityScore =
        available ? 10 : -100;

      const score =
        distanceScore +
        ambulanceScore +
        bedScore +
        availabilityScore;

      return {
        ...hospital,

        hospital_name:
          getHospitalName(hospital),

        distance_km:
          distance,

        available_beds:
          beds,

        available_ambulances:
          ambulances,

        emergency_available:
          available,

        recommendation_score:
          score,
      };
    })
    .sort(
      (a, b) =>
        b.recommendation_score -
        a.recommendation_score
    );
}


/* ============================================================
   COMPONENT
   ============================================================ */

export default function HospitalDashboard() {
  const [hospital, setHospital] =
    useState(null);

  const [alerts, setAlerts] =
    useState([]);

  const [stats, setStats] =
    useState(null);

  const [availableHospitals, setAvailableHospitals] =
    useState([]);

  const [incidentDetails, setIncidentDetails] =
    useState({});

  const [error, setError] =
    useState("");

  const [loading, setLoading] =
    useState(true);


  /* ==========================================================
     LOAD DATA
     ========================================================== */

  async function load() {
    try {
      setError("");

      const [
        myHospital,
        pendingAlerts,
        hospitalStats,
        hospitals,
      ] = await Promise.all([
        api.hospitals.me(),
        api.incidents.pending(),
        api.incidents.stats(),

        // IMPORTANT:
        // Hospital users ARE allowed to call this endpoint.
        api.hospitals.available(),
      ]);

      setHospital(myHospital);

      setAlerts(
        Array.isArray(pendingAlerts)
          ? pendingAlerts
          : []
      );

      setStats(hospitalStats);

      setAvailableHospitals(
        Array.isArray(hospitals)
          ? hospitals
          : []
      );


      /* ======================================================
         GET FULL INCIDENT DETAILS
         ====================================================== */

      const details = {};

      await Promise.all(
        pendingAlerts.map(
          async (incident) => {
            try {
              const detail =
                await api.incidents.get(
                  incident.incident_id
                );

              details[
                incident.incident_id
              ] = detail;
            } catch {
              // Keep the pending alert if the
              // detailed lookup fails.
            }
          }
        )
      );

      setIncidentDetails(details);

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }


  /* ==========================================================
     POLLING
     ========================================================== */

  useEffect(() => {
    load();

    const interval = setInterval(
      load,
      3000
    );

    return () =>
      clearInterval(interval);
  }, []);


  /* ==========================================================
     ACCEPT
     ========================================================== */

  async function accept(id) {
    try {
      await api.incidents.accept(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }


  /* ==========================================================
     REJECT
     ========================================================== */

  async function reject(id) {
    try {
      await api.incidents.reject(id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }


  /* ==========================================================
     RECOMMENDATIONS
     ========================================================== */

  const recommendations =
    useMemo(() => {
      const result = {};

      alerts.forEach(
        (alert) => {
          const detail =
            incidentDetails[
              alert.incident_id
            ] || alert;

          result[
            alert.incident_id
          ] = rankHospitals(
            detail,
            availableHospitals
          );
        }
      );

      return result;
    }, [
      alerts,
      incidentDetails,
      availableHospitals,
    ]);


  /* ==========================================================
     LOADING
     ========================================================== */

  if (loading) {
    return (
      <Loading
        label="Loading emergency dashboard..."
      />
    );
  }


  return (
    <section>

      {/* ==================================================== */}
      {/* HEADER                                               */}
      {/* ==================================================== */}

      <div className="page-heading">

        <div>
          <span className="eyebrow">
            LIVE ACCIDENT QUEUE
          </span>

          <h2>
            Upcoming accidents
          </h2>

          <p>
            Every pending alert is broadcast
            to available hospitals. The first
            hospital to accept claims the case.
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


      {/* ==================================================== */}
      {/* STATS                                                */}
      {/* ==================================================== */}

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
            Attended this month
          </span>

          <strong className="stat-value">
            {stats?.attended_this_month ?? 0}
          </strong>

          <span className="stat-detail">
            Your hospital
          </span>
        </div>


        <div className="stat-card">
          <span className="stat-label">
            Total attended
          </span>

          <strong className="stat-value">
            {stats?.total_attended ?? 0}
          </strong>

          <span className="stat-detail">
            All time
          </span>
        </div>


        <div className="stat-card">
          <span className="stat-label">
            Ambulances
          </span>

          <strong className="stat-value">
            {getAmbulances(
              hospital
            )}
          </strong>

          <span className="stat-detail">
            Small + large
          </span>
        </div>

      </div>


      {/* ==================================================== */}
      {/* ALERT LIST                                           */}
      {/* ==================================================== */}

      <div className="alert-list">

        {alerts.length === 0 ? (

          <div className="panel empty-state large">

            <strong>
              No pending accident alerts
            </strong>

            <span>
              New alerts will appear
              automatically.
            </span>

          </div>

        ) : (

          alerts.map((incident) => {

            const detail =
              incidentDetails[
                incident.incident_id
              ] || incident;

            const ranked =
              recommendations[
                incident.incident_id
              ] || [];

            const recommended =
              ranked.find(
                (item) =>
                  item.emergency_available
              ) || null;


            /*
             * ------------------------------------------------
             * ACCIDENT LOCATION
             * ------------------------------------------------
             */

            const incidentForMap = {
              ...detail,

              latitude:
                detail.latitude ??
                incident.latitude,

              longitude:
                detail.longitude ??
                incident.longitude,

              camera_id:
                detail.camera_id ??
                incident.camera_id,

              severity:
                detail.severity ??
                incident.severity,

              confidence:
                detail.confidence ??
                incident.confidence,
            };


            return (
              <div
                className="alert-card"
                key={
                  incident.incident_id
                }
              >

                {/* ========================================== */}
                {/* HEADER                                    */}
                {/* ========================================== */}

                <div>
                  <span className="alert-label">
                    NEW ACCIDENT
                  </span>

                  <h3>
                    {incident.incident_id}
                  </h3>

                  <p>
                    {formatDate(
                      incident.timestamp
                    )}
                  </p>
                </div>


                {/* ========================================== */}
                {/* METRICS                                   */}
                {/* ========================================== */}

                <div className="alert-metrics">

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
                        incident
                          .severity
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


                {/* ========================================== */}
                {/* LIVE MAP                                  */}
                {/* ========================================== */}

                {incidentForMap.latitude != null &&
                  incidentForMap.longitude != null && (

                  <div
                    style={{
                      width: "100%",
                      marginTop: 16,
                    }}
                  >

                    <MapView
                      incidents={[]}

                      hospitals={
                        ranked
                      }

                      activeIncident={
                        incidentForMap
                      }

                      recommendedHospital={
                        recommended
                      }

                      height={320}
                    />

                  </div>

                )}


                {/* ========================================== */}
                {/* NO LOCATION WARNING                       */}
                {/* ========================================== */}

                {(
                  incidentForMap.latitude == null ||
                  incidentForMap.longitude == null
                ) && (

                  <div
                    className="panel"
                    style={{
                      marginTop: 16,
                    }}
                  >

                    <strong>
                      📍 Location unavailable
                    </strong>

                    <p className="muted">
                      This camera/incident does
                      not currently have GPS
                      coordinates.
                    </p>

                  </div>

                )}


                {/* ========================================== */}
                {/* RECOMMENDATION                            */}
                {/* ========================================== */}

                {recommended && (

                  <div
                    className="panel"
                    style={{
                      marginTop: 16,
                    }}
                  >

                    <span className="eyebrow">
                      TRIAGE SUPPORT
                    </span>

                    <h3>
                      ⭐ Recommended Hospital
                    </h3>


                    <div className="stats-grid">

                      <div className="stat-card">
                        <span className="stat-label">
                          Hospital
                        </span>

                        <strong className="stat-value">
                          {
                            recommended.hospital_name
                          }
                        </strong>
                      </div>


                      <div className="stat-card">
                        <span className="stat-label">
                          Distance
                        </span>

                        <strong className="stat-value">
                          {recommended.distance_km.toFixed(
                            2
                          )}{" "}
                          km
                        </strong>
                      </div>


                      <div className="stat-card">
                        <span className="stat-label">
                          Ambulances
                        </span>

                        <strong className="stat-value">
                          {
                            recommended.available_ambulances
                          }
                        </strong>
                      </div>


                      <div className="stat-card">
                        <span className="stat-label">
                          Beds
                        </span>

                        <strong className="stat-value">
                          {
                            recommended.available_beds
                          }
                        </strong>
                      </div>

                    </div>


                    <p
                      className="muted"
                      style={{
                        marginTop: 12,
                      }}
                    >
                      Recommendation considers
                      distance, ambulance
                      availability, bed capacity
                      and emergency availability.
                      It is decision-support only.
                    </p>

                  </div>

                )}


                {/* ========================================== */}
                {/* NEARBY HOSPITALS                           */}
                {/* ========================================== */}

                {ranked.length > 0 && (

                  <div
                    className="panel"
                    style={{
                      marginTop: 16,
                    }}
                  >

                    <div className="panel-header">

                      <div>
                        <span className="eyebrow">
                          NEARBY HOSPITALS
                        </span>

                        <h3>
                          Response options
                        </h3>
                      </div>

                    </div>


                    <div className="table-wrap">

                      <table>

                        <thead>
                          <tr>
                            <th>
                              Hospital
                            </th>

                            <th>
                              Distance
                            </th>

                            <th>
                              Ambulances
                            </th>

                            <th>
                              Beds
                            </th>

                            <th>
                              Status
                            </th>

                            <th>
                              Recommendation
                            </th>
                          </tr>
                        </thead>


                        <tbody>

                          {ranked
                            .slice(0, 5)
                            .map(
                              (item) => {

                                const best =
                                  recommended &&
                                  recommended.hospital_id ===
                                    item.hospital_id;

                                return (
                                  <tr
                                    key={
                                      item.hospital_id
                                    }
                                  >

                                    <td>
                                      <strong>
                                        {
                                          item.hospital_name
                                        }
                                      </strong>
                                    </td>

                                    <td>
                                      {
                                        item.distance_km.toFixed(
                                          2
                                        )
                                      }{" "}
                                      km
                                    </td>

                                    <td>
                                      {
                                        item.available_ambulances
                                      }
                                    </td>

                                    <td>
                                      {
                                        item.available_beds
                                      }
                                    </td>

                                    <td>
                                      {
                                        item.emergency_available
                                          ? "AVAILABLE"
                                          : "UNAVAILABLE"
                                      }
                                    </td>

                                    <td>
                                      {best
                                        ? "⭐ BEST MATCH"
                                        : "—"}
                                    </td>

                                  </tr>
                                );
                              }
                            )}

                        </tbody>

                      </table>

                    </div>

                  </div>

                )}


                {/* ========================================== */}
                {/* ACTIONS                                   */}
                {/* ========================================== */}

                <div
                  className="button-row"
                  style={{
                    marginTop: 16,
                  }}
                >

                  <Link
                    className="button secondary"
                    to={`/hospital/incidents/${incident.incident_id}`}
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
            );
          })

        )}

      </div>

    </section>
  );
}