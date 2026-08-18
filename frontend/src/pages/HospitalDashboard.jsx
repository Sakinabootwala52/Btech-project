import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import { formatConfidence, formatDate } from "../utils";

export default function HospitalDashboard() {
  const [hospital, setHospital] = useState(null), [alerts, setAlerts] = useState([]), [stats, setStats] = useState(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  async function load() {
    try { setError(""); const [h,a,s] = await Promise.all([api.hospitals.me(), api.incidents.pending(), api.incidents.stats()]); setHospital(h); setAlerts(a); setStats(s); }
    catch(e){ setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  async function accept(id){ try { await api.incidents.accept(id); await load(); } catch(e){ setError(e.message); } }
  async function reject(id){ try { await api.incidents.reject(id); await load(); } catch(e){ setError(e.message); } }
  if (loading) return <Loading label="Loading emergency dashboard..." />;
  return <section>
    <div className="page-heading"><div><span className="eyebrow">LIVE ACCIDENT QUEUE</span><h2>Upcoming accidents</h2><p>Every pending alert is broadcast to available hospitals. The first hospital to accept claims the case.</p></div><span className={`availability-chip ${hospital?.emergency_available ? "on" : "off"}`}>{hospital?.emergency_available ? "AVAILABLE" : "UNAVAILABLE"}</span></div>
    <ErrorMessage message={error} />
    <div className="stats-grid">
      <div className="stat-card danger"><span className="stat-label">Live alerts</span><strong className="stat-value">{alerts.length}</strong><span className="stat-detail">Pending hospital response</span></div>
      <div className="stat-card"><span className="stat-label">Attended this month</span><strong className="stat-value">{stats?.attended_this_month ?? 0}</strong><span className="stat-detail">Your hospital</span></div>
      <div className="stat-card"><span className="stat-label">Total attended</span><strong className="stat-value">{stats?.total_attended ?? 0}</strong><span className="stat-detail">All time</span></div>
      <div className="stat-card"><span className="stat-label">Ambulances</span><strong className="stat-value">{(hospital?.resources?.small_ambulances ?? 0) + (hospital?.resources?.large_ambulances ?? 0)}</strong><span className="stat-detail">Small + large</span></div>
    </div>
    <div className="alert-list">
      {alerts.length === 0 ? <div className="panel empty-state large"><strong>No pending accident alerts</strong><span>New alerts will appear automatically.</span></div> : alerts.map(incident => <div className="alert-card" key={incident.incident_id}>
        <div><span className="alert-label">NEW ACCIDENT</span><h3>{incident.incident_id}</h3><p>{formatDate(incident.timestamp)}</p></div>
        <div className="alert-metrics"><div><span>Confidence</span><strong>{formatConfidence(incident.confidence)}</strong></div><div><span>Severity</span><strong>{incident.severity?.level || "UNKNOWN"}</strong></div><div><span>Camera</span><strong>{incident.camera_id}</strong></div></div>
        <div className="button-row"><Link className="button secondary" to={`/hospital/incidents/${incident.incident_id}`}>Review</Link><button className="button primary" onClick={() => accept(incident.incident_id)}>ACCEPT FIRST</button><button className="button danger" onClick={() => reject(incident.incident_id)}>Reject</button></div>
      </div>)}
    </div>
  </section>;
}
