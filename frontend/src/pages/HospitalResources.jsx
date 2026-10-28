import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";

export default function HospitalResources(){
  const [hospital,setHospital]=useState(null),[form,setForm]=useState({small_ambulances:0,large_ambulances:0,emergency_staff:0,beds_available:0}),[error,setError]=useState(""),[saved,setSaved]=useState(false),[loading,setLoading]=useState(true);
  async function load(){try{const h=await api.hospitals.me();setHospital(h);setForm(h.resources||form)}catch(e){setError(e.message)}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  function change(k,v){setForm({...form,[k]:v})}
  async function save(e){e.preventDefault();try{await api.hospitals.updateResources(form);setSaved(true);setTimeout(()=>setSaved(false),1800);await load()}catch(e){setError(e.message)}}
  if(loading)return <Loading label="Loading resources..."/>;
  return <section><div className="page-heading"><div><span className="eyebrow">RESOURCE MANAGEMENT</span><h2>Emergency resources</h2>
  </div></div><ErrorMessage message={error}/><div className="panel resource-panel"><div className="panel-header"><div><h3>{hospital?.name}</h3>
  </div></div><form className="resource-grid" onSubmit={save}>{Object.entries({small_ambulances:"Small ambulances",large_ambulances:"Large ambulances",emergency_staff:"Emergency staff",beds_available:"Beds available"}).map(([key,label])=><label key={key}>{label}<input type="number" min="0" value={form[key] ?? 0} onChange={e=>change(key, Number(e.target.value))}/></label>)}<div className="resource-actions"><button className="button primary">{saved?"Saved ✓":"Save resources"}</button></div></form></div></section>
}
