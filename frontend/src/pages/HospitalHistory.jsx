import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import { formatDate } from "../utils";

export default function HospitalHistory(){const [rows,setRows]=useState([]),[error,setError]=useState(""),[loading,setLoading]=useState(true);useEffect(()=>{api.hospitals.history().then(setRows).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);if(loading)return <Loading label="Loading accident history..."/>;return <section><div className="page-heading"><div><span className="eyebrow">ATTENDANCE HISTORY</span><h2>Accidents attended</h2>
</div></div><ErrorMessage message={error}/><div className="panel"><div className="table-wrap"><table><thead><tr><th>Incident</th><th>Accepted</th><th>Severity</th><th>Small</th><th>Large</th><th>Staff</th><th>Beds</th></tr></thead><tbody>{rows.length?rows.map(r=><tr key={r.incident_id}><td>{r.incident_id}</td><td>{formatDate(r.accepted_at)}</td><td>{r.severity?.level||"UNKNOWN"}</td><td>{r.resources_snapshot?.small_ambulances??0}</td><td>{r.resources_snapshot?.large_ambulances??0}</td><td>{r.resources_snapshot?.emergency_staff??0}</td><td>{r.resources_snapshot?.beds_available??0}</td></tr>):<tr><td colSpan="7">No accidents attended yet.</td></tr>}</tbody></table></div></div></section>}