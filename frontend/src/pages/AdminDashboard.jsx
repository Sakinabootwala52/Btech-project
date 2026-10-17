import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatCard from "../components/StatCard";
import MapView from "../components/MapView";

export default function AdminDashboard() {
  const [month, setMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );

  const [data, setData] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        setError("");

        const [summary, hospitalList] =
          await Promise.all([
            api.admin.summary(month),
            api.hospitals.list(),
          ]);

        if (cancelled) return;

        setData(summary);

        setHospitals(
          Array.isArray(hospitalList)
            ? hospitalList
            : []
        );
      } catch (e) {
        if (!cancelled) {
          setError(e.message);
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [month]);

  if (!data && !error) {
    return (
      <Loading
        label="Loading system summary..."
      />
    );
  }

  /*
   * ==========================================================
   * HOSPITAL DATA FOR MAP
   * ==========================================================
   *
   * Use hospitals.list() because this is the API that should
   * contain the actual hospital identity/location records.
   *
   * Resource snapshot is still used for analytics tables below.
   */

  const hospitalsForMap = hospitals
    .filter(
      (hospital) =>
        hospital?.latitude != null &&
        hospital?.longitude != null
    )
    .map((hospital) => {
      const smallAmbulances = Number(
        hospital?.resources?.small_ambulances ??
          hospital?.small_ambulances ??
          0
      );

      const largeAmbulances = Number(
        hospital?.resources?.large_ambulances ??
          hospital?.large_ambulances ??
          0
      );

      const beds = Number(
        hospital?.resources?.beds_available ??
          hospital?.beds_available ??
          hospital?.beds ??
          0
      );

      return {
        hospital_id:
          hospital.hospital_id,

        name:
          hospital.name ||
          hospital.hospital_name ||
          "Hospital",

        latitude: Number(
          hospital.latitude
        ),

        longitude: Number(
          hospital.longitude
        ),

        status:
          hospital.status ||
          (hospital.emergency_available
            ? "AVAILABLE"
            : "UNAVAILABLE"),

        emergency_available:
          hospital.emergency_available,

        beds,

        ambulances:
          smallAmbulances +
          largeAmbulances,

        small_ambulances:
          smallAmbulances,

        large_ambulances:
          largeAmbulances,

        emergency_staff: Number(
          hospital?.resources?.emergency_staff ??
            hospital?.emergency_staff ??
            0
        ),
      };
    });

  /*
   * ==========================================================
   * HOTSPOTS FOR MAP
   * ==========================================================
   */

  const hotspotIncidents = (
    data?.hotspots || []
  )
    .filter(
      (hotspot) =>
        hotspot?.latitude != null &&
        hotspot?.longitude != null
    )
    .map((hotspot, index) => ({
      incident_id:
        `HOTSPOT-${index + 1}`,

      latitude: Number(
        hotspot.latitude
      ),

      longitude: Number(
        hotspot.longitude
      ),

      confidence: 1,

      camera_name:
        hotspot.camera_name,

      place:
        hotspot.place,

      count:
        hotspot.count,
    }));

  return (
    <section>
      {/* ==================================================== */}
      {/* HEADER                                               */}
      {/* ==================================================== */}

      <div className="page-heading">
        <div>
          <span className="eyebrow">
            ADMIN ANALYTICS
          </span>

          <h2>
            Overall accident response summary
          </h2>

          <p>
            Review incidents, hospital performance,
            resources and accident hotspots.
          </p>
        </div>

        <input
          className="month-input"
          type="month"
          value={month}
          onChange={(e) =>
            setMonth(e.target.value)
          }
        />
      </div>

      <ErrorMessage message={error} />

      {data && (
        <>
          {/* ================================================= */}
          {/* SUMMARY                                           */}
          {/* ================================================= */}

          <div className="stats-grid">
            <StatCard
              label="All-time accidents"
              value={
                data.totals?.all_time ?? 0
              }
              detail="All recorded incidents"
            />

            <StatCard
              label="Accidents this month"
              value={
                data.totals?.this_month ?? 0
              }
              detail={data.month}
            />

            <StatCard
              label="Pending"
              value={
                data.totals?.pending ?? 0
              }
              detail="Awaiting hospital acceptance"
              tone="danger"
            />

            <StatCard
              label="Resolved"
              value={
                data.totals?.resolved ?? 0
              }
              detail="Completed cases"
            />
          </div>

          {/* ================================================= */}
          {/* HOSPITAL PERFORMANCE + RESOURCES                 */}
          {/* ================================================= */}

          <div className="content-grid two-thirds">
            {/* Hospital performance */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>
                    Hospital performance
                  </h3>

                  <span>
                    Cases each hospital has attended
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Hospital</th>
                      <th>All-time</th>
                      <th>This month</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(
                      data.hospital_performance ||
                      []
                    ).map((hospital) => {
                      const monthly =
                        (
                          data.attendance_this_month ||
                          []
                        ).find(
                          (item) =>
                            item._id ===
                            hospital.hospital_id
                        )?.attended || 0;

                      return (
                        <tr
                          key={
                            hospital.hospital_id
                          }
                        >
                          <td>
                            {
                              hospital.hospital_name
                            }
                          </td>

                          <td>
                            {hospital.attended}
                          </td>

                          <td>
                            {monthly}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Current resources */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>
                    Current resources
                  </h3>

                  <span>
                    Latest reported capacity
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Hospital</th>
                      <th>Small</th>
                      <th>Large</th>
                      <th>Staff</th>
                      <th>Beds</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(
                      data.resource_snapshot ||
                      []
                    ).map((hospital) => (
                      <tr
                        key={
                          hospital.hospital_id
                        }
                      >
                        <td>
                          {
                            hospital.hospital_name
                          }
                        </td>

                        <td>
                          {
                            hospital.resources
                              ?.small_ambulances ||
                            0
                          }
                        </td>

                        <td>
                          {
                            hospital.resources
                              ?.large_ambulances ||
                            0
                          }
                        </td>

                        <td>
                          {
                            hospital.resources
                              ?.emergency_staff ||
                            0
                          }
                        </td>

                        <td>
                          {
                            hospital.resources
                              ?.beds_available ||
                            0
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ================================================= */}
          {/* MAP                                                */}
          {/* ================================================= */}

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>
                  Accident hotspots & hospital network
                </h3>

                <span>
                  Recorded accident locations and
                  currently available hospitals
                </span>
              </div>
            </div>

            <MapView
              incidents={
                hotspotIncidents
              }
              hospitals={
                hospitalsForMap
              }
              height={430}
            />

            {/* Hospital summary below map */}
            <div
              className="hotspot-list"
              style={{
                marginTop: 14,
              }}
            >
              {hospitalsForMap.length > 0 ? (
                hospitalsForMap.map(
                  (hospital) => (
                    <div
                      key={
                        hospital.hospital_id
                      }
                    >
                      <strong>
                        🏥
                      </strong>

                      <span>
                        {hospital.name}
                        {" · "}
                        {
                          hospital.status
                        }
                      </span>

                      <b>
                        Beds:{" "}
                        {
                          hospital.beds
                        }
                        {" · "}
                        Ambulances:{" "}
                        {
                          hospital.ambulances
                        }
                      </b>
                    </div>
                  )
                )
              ) : (
                <div>
                  <strong>
                    —
                  </strong>

                  <span>
                    No hospital coordinates
                    available.
                  </span>

                  <b>
                    Check hospital records.
                  </b>
                </div>
              )}
            </div>

            {/* Hotspots */}
            {hotspotIncidents.length >
              0 && (
              <div
                className="hotspot-list"
                style={{
                  marginTop: 8,
                }}
              >
                {(
                  data.hotspots || []
                ).map(
                  (hotspot, index) => (
                    <div
                      key={
                        `hotspot-${index}`
                      }
                    >
                      <strong>
                        #
                        {index + 1}
                      </strong>

                      <span>
                        {
                          hotspot.place
                        }
                        {" · "}
                        {
                          hotspot.camera_name
                        }
                      </span>

                      <b>
                        {
                          hotspot.count
                        }{" "}
                        incidents
                      </b>
                    </div>
                  )
                )}
              </div>
            )}
          </div>

          {/* ================================================= */}
          {/* RECENT ATTENDANCES                                */}
          {/* ================================================= */}

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>
                  Recent hospital attendances
                </h3>

                <span>
                  Resources captured when each
                  case was accepted
                </span>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Incident</th>
                    <th>Hospital</th>
                    <th>Severity</th>
                    <th>Small</th>
                    <th>Large</th>
                    <th>Staff</th>
                    <th>Beds</th>
                  </tr>
                </thead>

                <tbody>
                  {(
                    data.attendance_records ||
                    []
                  ).length > 0 ? (
                    data.attendance_records.map(
                      (record) => (
                        <tr
                          key={
                            record.incident_id
                          }
                        >
                          <td>
                            {
                              record.incident_id
                            }
                          </td>

                          <td>
                            {
                              record.hospital_name
                            }
                          </td>

                          <td>
                            {
                              record.severity
                                ?.level ||
                              "UNKNOWN"
                            }
                          </td>

                          <td>
                            {
                              record
                                .resources_snapshot
                                ?.small_ambulances ??
                              0
                            }
                          </td>

                          <td>
                            {
                              record
                                .resources_snapshot
                                ?.large_ambulances ??
                              0
                            }
                          </td>

                          <td>
                            {
                              record
                                .resources_snapshot
                                ?.emergency_staff ??
                              0
                            }
                          </td>

                          <td>
                            {
                              record
                                .resources_snapshot
                                ?.beds_available ??
                              0
                            }
                          </td>
                        </tr>
                      )
                    )
                  ) : (
                    <tr>
                      <td colSpan="7">
                        No hospital attendances
                        recorded for this month.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}