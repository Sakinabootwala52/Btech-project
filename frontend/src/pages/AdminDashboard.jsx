
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
  const [incidents, setIncidents] = useState([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [error, setError] = useState("");

  // ==========================================================
  // LOAD DASHBOARD, HOSPITALS, AND INCIDENTS
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        setError("");

        const [summary, hospitalList, incidentList] =
          await Promise.all([
            api.admin.summary(month),
            api.hospitals.list(),
            api.incidents.list(),
          ]);

        if (cancelled) return;

        setData(summary);

        setHospitals(
          Array.isArray(hospitalList) ? hospitalList : []
        );

        const incidentRecords = Array.isArray(incidentList)
          ? incidentList
          : [];

        setIncidents(incidentRecords);

        setSelectedIncidentId((currentId) => {
          if (
            currentId &&
            incidentRecords.some(
              (incident) => incident.incident_id === currentId
            )
          ) {
            return currentId;
          }

          const routedIncident = incidentRecords.find(
            (incident) =>
              Array.isArray(incident.route_coordinates) &&
              incident.route_coordinates.length >= 2
          );

          return (
            routedIncident?.incident_id ||
            incidentRecords[0]?.incident_id ||
            ""
          );
        });
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load dashboard.");
        }
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [month]);

  if (!data && !error) {
    return <Loading label="Loading system summary..." />;
  }

  // ==========================================================
  // HOSPITAL DATA FOR THE EXISTING MAP
  // ==========================================================

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
        hospital_id: hospital.hospital_id,

        name:
          hospital.name ||
          hospital.hospital_name ||
          "Hospital",

        latitude: Number(hospital.latitude),
        longitude: Number(hospital.longitude),

        status:
          hospital.status ||
          (hospital.emergency_available
            ? "AVAILABLE"
            : "UNAVAILABLE"),

        emergency_available: hospital.emergency_available,
        beds,
        ambulances: smallAmbulances + largeAmbulances,
        small_ambulances: smallAmbulances,
        large_ambulances: largeAmbulances,

        emergency_staff: Number(
          hospital?.resources?.emergency_staff ??
            hospital?.emergency_staff ??
            0
        ),
      };
    });

  // ==========================================================
  // HOTSPOTS FOR THE EXISTING MAP
  // ==========================================================

  const hotspotIncidents = (data?.hotspots || [])
    .filter(
      (hotspot) =>
        hotspot?.latitude != null &&
        hotspot?.longitude != null
    )
    .map((hotspot, index) => ({
      incident_id: `HOTSPOT-${index + 1}`,
      latitude: Number(hotspot.latitude),
      longitude: Number(hotspot.longitude),
      confidence: 1,
      camera_name: hotspot.camera_name,
      place: hotspot.place,
      count: hotspot.count,
    }));

  // ==========================================================
  // SELECTED INCIDENT AND HOSPITAL COMPARISON
  // ==========================================================

  const selectedIncident =
    incidents.find(
      (incident) =>
        incident.incident_id === selectedIncidentId
    ) || null;

  const recommendedHospital = selectedIncident
    ? {
        hospital_id:
          selectedIncident.recommended_hospital_id ||
          selectedIncident.hospital_id,

        name:
          selectedIncident.recommended_hospital_name ||
          selectedIncident.hospital_name ||
          "Recommended hospital",
      }
    : null;

  const hospitalComparisons = Array.isArray(
    selectedIncident?.hospital_comparison
  )
    ? selectedIncident.hospital_comparison
    : [];

  return (
    <section>
      {/* ==================================================== */}
      {/* HEADER                                               */}
      {/* ==================================================== */}

      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMIN ANALYTICS</span>

          <h2>Overall accident response summary</h2>

          <p>
            Review incidents, hospital performance, resources
            and accident hotspots.
          </p>
        </div>

        <input
          className="month-input"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
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
              value={data.totals?.all_time ?? 0}
              detail="All recorded incidents"
            />

            <StatCard
              label="Accidents this month"
              value={data.totals?.this_month ?? 0}
              detail={data.month}
            />

            <StatCard
              label="Pending"
              value={data.totals?.pending ?? 0}
              detail="Awaiting hospital acceptance"
              tone="danger"
            />

            <StatCard
              label="Resolved"
              value={data.totals?.resolved ?? 0}
              detail="Completed cases"
            />
          </div>

          {/* ================================================= */}
          {/* HOSPITAL PERFORMANCE AND RESOURCES                 */}
          {/* ================================================= */}

          <div className="content-grid two-thirds">
            {/* Hospital performance */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Hospital performance</h3>
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
                    {(data.hospital_performance || []).map(
                      (hospital) => {
                        const monthly = (
                          data.attendance_this_month || []
                        ).find(
                          (item) =>
                            item._id === hospital.hospital_id
                        )?.attended || 0;

                        return (
                          <tr key={hospital.hospital_id}>
                            <td>{hospital.hospital_name}</td>
                            <td>{hospital.attended}</td>
                            <td>{monthly}</td>
                          </tr>
                        );
                      }
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Current resources */}
            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Current resources</h3>
                  <span>Latest reported capacity</span>
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
                    {(data.resource_snapshot || []).map(
                      (hospital) => (
                        <tr key={hospital.hospital_id}>
                          <td>{hospital.hospital_name}</td>
                          <td>
                            {hospital.resources?.small_ambulances || 0}
                          </td>
                          <td>
                            {hospital.resources?.large_ambulances || 0}
                          </td>
                          <td>
                            {hospital.resources?.emergency_staff || 0}
                          </td>
                          <td>
                            {hospital.resources?.beds_available || 0}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ================================================= */}
          {/* EXISTING MAP AND ROUTE SELECTOR                   */}
          {/* ================================================= */}

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Accident hotspots &amp; hospital network</h3>

                <span>
                  Recorded accident locations, hospitals and
                  the selected incident's route
                </span>
              </div>
            </div>

            {/* Select an incident for the existing map */}
            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor="route-incident"
                style={{
                  display: "block",
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Incident route
              </label>

              <select
                id="route-incident"
                value={selectedIncidentId}
                onChange={(event) =>
                  setSelectedIncidentId(event.target.value)
                }
                style={{
                  width: "100%",
                  maxWidth: 420,
                  padding: "10px 12px",
                  borderRadius: 8,
                }}
              >
                <option value="">Select an incident</option>

                {incidents.map((incident) => (
                  <option
                    key={incident.incident_id}
                    value={incident.incident_id}
                  >
                    {incident.incident_id}
                    {" · "}
                    {incident.severity?.level ||
                      incident.severity ||
                      "Unknown severity"}
                  </option>
                ))}
              </select>
            </div>

            {/* Reuse the existing map; do not create another map */}
            <MapView
              incidents={hotspotIncidents}
              hospitals={hospitalsForMap}
              activeIncident={selectedIncident}
              recommendedHospital={recommendedHospital}
              height={430}
            />

            {/* ================================================= */}
            {/* HOSPITAL COMPARISON UNDER THE SAME MAP            */}
            {/* ================================================= */}

            <div style={{ marginTop: 20 }}>
              <div className="panel-header">
                <div>
                  <h3>Hospital route comparison</h3>
                  <span>
                    Hospitals compared for the selected incident
                  </span>
                </div>
              </div>

              {!selectedIncident ? (
                <p>
                  Select an incident to view its hospital route
                  and comparison.
                </p>
              ) : hospitalComparisons.length === 0 ? (
                <p>
                  No saved hospital comparison is available for{" "}
                  <strong>{selectedIncident.incident_id}</strong>.
                  This incident may predate the comparison feature,
                  or the backend may not be saving comparison data.
                </p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Hospital</th>
                        <th>Straight-line distance</th>
                        <th>Road distance</th>
                        <th>ETA</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {hospitalComparisons.map(
                        (hospital, index) => {
                          const isRecommended =
                            hospital.recommended === true ||
                            (
                              hospital.hospital_id &&
                              hospital.hospital_id ===
                                (
                                  selectedIncident.recommended_hospital_id ||
                                  selectedIncident.hospital_id
                                )
                            );

                          const straightLine =
                            hospital.straight_line_distance_km ??
                            hospital.distance_straight_line_km ??
                            hospital.hospital_straight_line_distance_km;

                          const roadDistance =
                            hospital.road_distance_km ??
                            hospital.distance_km ??
                            hospital.hospital_distance_km;

                          const eta =
                            hospital.eta_minutes ??
                            hospital.estimated_travel_time_min ??
                            (
                              hospital.eta_seconds != null
                                ? Number(hospital.eta_seconds) / 60
                                : null
                            );

                          return (
                            <tr
                              key={
                                hospital.hospital_id ||
                                `${hospital.hospital_name || hospital.name || "hospital"}-${index}`
                              }
                            >
                              <td>
                                {hospital.hospital_name ||
                                  hospital.name ||
                                  "Hospital"}
                              </td>

                              <td>
                                {straightLine != null &&
                                Number.isFinite(Number(straightLine))
                                  ? `${Number(straightLine).toFixed(2)} km`
                                  : "—"}
                              </td>

                              <td>
                                {roadDistance != null &&
                                Number.isFinite(Number(roadDistance))
                                  ? `${Number(roadDistance).toFixed(2)} km`
                                  : "—"}
                              </td>

                              <td>
                                {eta != null &&
                                Number.isFinite(Number(eta))
                                  ? `${Number(eta).toFixed(1)} min`
                                  : "—"}
                              </td>

                              <td>
                                {isRecommended ? (
                                  <strong>Recommended</strong>
                                ) : (
                                  "Alternative"
                                )}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Hospital summary below the same map */}
            <div
              className="hotspot-list"
              style={{ marginTop: 14 }}
            >
              {hospitalsForMap.length > 0 ? (
                hospitalsForMap.map((hospital) => (
                  <div key={hospital.hospital_id}>
                    <strong>🏥</strong>

                    <span>
                      {hospital.name}
                      {" · "}
                      {hospital.status}
                    </span>

                    <b>
                      Beds: {hospital.beds}
                      {" · "}
                      Ambulances: {hospital.ambulances}
                    </b>
                  </div>
                ))
              ) : (
                <div>
                  <strong>—</strong>
                  <span>No hospital coordinates available.</span>
                  <b>Check hospital records.</b>
                </div>
              )}
            </div>

            {/* Existing hotspot list */}
            {hotspotIncidents.length > 0 && (
              <div
                className="hotspot-list"
                style={{ marginTop: 8 }}
              >
                {(data.hotspots || []).map((hotspot, index) => (
                  <div key={`hotspot-${index}`}>
                    <strong>#{index + 1}</strong>

                    <span>
                      {hotspot.place}
                      {" · "}
                      {hotspot.camera_name}
                    </span>

                    <b>{hotspot.count} incidents</b>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ================================================= */}
          {/* RECENT ATTENDANCES                                */}
          {/* ================================================= */}

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Recent hospital attendances</h3>

                <span>
                  Resources captured when each case was accepted
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
                  {(data.attendance_records || []).length > 0 ? (
                    data.attendance_records.map((record) => (
                      <tr key={record.incident_id}>
                        <td>{record.incident_id}</td>
                        <td>{record.hospital_name}</td>
                        <td>
                          {record.severity?.level || "UNKNOWN"}
                        </td>
                        <td>
                          {record.resources_snapshot?.small_ambulances ?? 0}
                        </td>
                        <td>
                          {record.resources_snapshot?.large_ambulances ?? 0}
                        </td>
                        <td>
                          {record.resources_snapshot?.emergency_staff ?? 0}
                        </td>
                        <td>
                          {record.resources_snapshot?.beds_available ?? 0}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7">
                        No hospital attendances recorded for this month.
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
