import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatCard from "../components/StatCard";
import MapView from "../components/MapView";

export default function AdminDashboard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.admin.summary(month).then(setData).catch((e) => setError(e.message));
  }, [month]);

  if (!data && !error) return <Loading label="Loading system summary..." />;

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ADMIN ANALYTICS</span>
          <h2>Overall accident response summary</h2>
          <p>Review incidents, hospital performance, resources and accident hotspots.</p>
        </div>
        <input className="month-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <ErrorMessage message={error} />

      {data && <>
        <div className="stats-grid">
          <StatCard label="All-time accidents" value={data.totals.all_time} detail="All recorded incidents" />
          <StatCard label="Accidents this month" value={data.totals.this_month} detail={data.month} />
          <StatCard label="Pending" value={data.totals.pending} detail="Awaiting hospital acceptance" tone="danger" />
          <StatCard label="Resolved" value={data.totals.resolved} detail="Completed cases" />
        </div>

        <div className="content-grid two-thirds">
          <div className="panel">
            <div className="panel-header"><div><h3>Hospital performance</h3><span>Cases each hospital has attended</span></div></div>
            <div className="table-wrap"><table><thead><tr><th>Hospital</th><th>All-time</th><th>This month</th></tr></thead><tbody>
              {data.hospital_performance.map((h) => {
                const monthly = data.attendance_this_month.find((x) => x._id === h.hospital_id)?.attended || 0;
                return <tr key={h.hospital_id}><td>{h.hospital_name}</td><td>{h.attended}</td><td>{monthly}</td></tr>;
              })}
            </tbody></table></div>
          </div>

          <div className="panel">
            <div className="panel-header"><div><h3>Current resources</h3><span>Latest reported capacity</span></div></div>
            <div className="table-wrap"><table><thead><tr><th>Hospital</th><th>Small</th><th>Large</th><th>Staff</th><th>Beds</th></tr></thead><tbody>
              {data.resource_snapshot.map((h) => <tr key={h.hospital_id}><td>{h.hospital_name}</td><td>{h.resources?.small_ambulances || 0}</td><td>{h.resources?.large_ambulances || 0}</td><td>{h.resources?.emergency_staff || 0}</td><td>{h.resources?.beds_available || 0}</td></tr>)}
            </tbody></table></div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header"><div><h3>Accident hotspots — {data.month}</h3><span>Locations with the most recorded incidents</span></div></div>
          <MapView incidents={data.hotspots.map((h, i) => ({ incident_id: `HOTSPOT-${i + 1}`, latitude: h.latitude, longitude: h.longitude, confidence: 1 }))} height={430} />
          <div className="hotspot-list">{data.hotspots.map((h, i) => <div key={i}><strong>#{i + 1}</strong><span>{h.place} · {h.camera_name}</span><b>{h.count} incidents</b></div>)}</div>
        </div>

        <div className="panel">
          <div className="panel-header"><div><h3>Recent hospital attendances</h3><span>Resources captured when each case was accepted</span></div></div>
          <div className="table-wrap"><table><thead><tr><th>Incident</th><th>Hospital</th><th>Severity</th><th>Small</th><th>Large</th><th>Staff</th><th>Beds</th></tr></thead><tbody>
            {data.attendance_records.length ? data.attendance_records.map((r) => <tr key={r.incident_id}><td>{r.incident_id}</td><td>{r.hospital_name}</td><td>{r.severity?.level || "UNKNOWN"}</td><td>{r.resources_snapshot?.small_ambulances ?? 0}</td><td>{r.resources_snapshot?.large_ambulances ?? 0}</td><td>{r.resources_snapshot?.emergency_staff ?? 0}</td><td>{r.resources_snapshot?.beds_available ?? 0}</td></tr>) : <tr><td colSpan="7">No hospital attendances recorded for this month.</td></tr>}
          </tbody></table></div>
        </div>
      </>}
    </section>
  );
}
