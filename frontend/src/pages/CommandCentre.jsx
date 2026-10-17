import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import ErrorMessage from "../components/ErrorMessage";

const START = [18.5204, 73.8567];
const DEST = [18.5350, 73.8780];
const DURATION_SECONDS = 48;
const DEMO_INCIDENT = { incident_id: "SIM-INC-001", status: "PENDING REVIEW", severity: "HIGH", latitude: DEST[0], longitude: DEST[1], evidence: { simulation: true, source: "command-centre-demo", note: "Synthetic demo incident; no real CCTV event attached." } };
const DEMO_RECOMMENDATION = [{ facility_id: "DEMO-HOSP-01", name: "Demo City Emergency Hospital", matched_capability: "TRAUMA", route: { travel_time_min: 4.6, distance_km: 2.7, routing_mode: "SIMULATED_ROUTE" }, available_ambulances: 1 }];
const ambulanceIcon = L.divIcon({ className: "cc-ambulance-icon", html: '<div class="cc-ambulance-emoji">🚑</div>', iconSize: [42, 42], iconAnchor: [21, 21] });
const incidentIcon = L.divIcon({ className: "cc-incident-icon", html: '<div class="cc-incident-pin">⚠</div>', iconSize: [34, 34], iconAnchor: [17, 17] });

function makeRoute(start, end) {
  const waypoints = [[0,0],[0.18,0.08],[0.35,-0.05],[0.52,0.10],[0.68,-0.04],[0.83,0.05],[1,0]];
  return waypoints.map(([t,bend]) => [start[0] + (end[0]-start[0])*t + Math.sin(t*Math.PI)*bend*0.035, start[1] + (end[1]-start[1])*t + Math.sin(t*Math.PI)*bend*0.04]);
}
function haversine(a,b) { const r=6371, rad=x=>x*Math.PI/180, dLat=rad(b[0]-a[0]), dLon=rad(b[1]-a[1]); const q=Math.sin(dLat/2)**2+Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2; return 2*r*Math.atan2(Math.sqrt(q),Math.sqrt(1-q)); }
function pathDistance(points) { return points.slice(1).reduce((sum,p,i)=>sum+haversine(points[i],p),0); }
function pointAt(points, progress) { const scaled=Math.max(0,Math.min(1,progress))*(points.length-1), i=Math.min(points.length-2,Math.floor(scaled)), t=scaled-i; return [points[i][0]+(points[i+1][0]-points[i][0])*t, points[i][1]+(points[i+1][1]-points[i][1])*t]; }
function FitBounds({ points }) { const map=useMap(); useEffect(()=>{ if(points.length>1) map.fitBounds(L.latLngBounds(points),{padding:[32,32]}); },[map,points]); return null; }
function stamp() { return new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function Metric({label,value,detail}) { return <div className="cc-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

export default function CommandCentre() {
  const route = useMemo(()=>makeRoute(START,DEST),[]);
  const totalDistance = useMemo(()=>pathDistance(route),[route]);
  const [progress,setProgress] = useState(0);
  const [runState,setRunState] = useState("READY");
  const [events,setEvents] = useState([{id:1,time:stamp(),title:"Simulation ready",detail:"Synthetic scenario loaded; no live GPS is connected."}]);
  const [incidents,setIncidents] = useState([]);
  const [hospitals,setHospitals] = useState([]);
  const [ambulances,setAmbulances] = useState([]);
  const [selectedIncident,setSelectedIncident] = useState("SIM-INC-001");
  const [benchmark,setBenchmark] = useState(null);
  const [benchmarkBusy,setBenchmarkBusy] = useState(false);
  const [copilot,setCopilot] = useState(null);
  const [copilotBusy,setCopilotBusy] = useState(false);
  const [question,setQuestion] = useState("Why is this facility recommended, and what are the limitations?");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [speechEnabled,setSpeechEnabled] = useState(false);
  const speechEnabledRef = useRef(false);
  const eventId = useRef(2);
  const enRouteEventSent = useRef(false);
  const approachingEventSent = useRef(false);
  const arrivalEventSent = useRef(false);
  const hasStarted = runState === "RUNNING";
  const currentPosition = useMemo(()=>pointAt(route,progress),[route,progress]);
  const remainingDistance = totalDistance*(1-progress);
  const remainingSeconds = Math.ceil(DURATION_SECONDS*(1-progress));
  const formatTime = (seconds)=>`${String(Math.floor(seconds/60)).padStart(2,"0")}:${String(seconds%60).padStart(2,"0")}`;
  useEffect(()=>{ speechEnabledRef.current = speechEnabled; },[speechEnabled]);
  const addEvent = useCallback((title,detail)=>{
    setEvents(prev=>[{id:eventId.current++,time:stamp(),title,detail},...prev].slice(0,10));
    if (speechEnabledRef.current && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${title}. ${detail}`));
    }
  },[]);

  const loadResources = useCallback(async()=>{
    try {
      const [incidentRows,facilityRows,ambulanceRows] = await Promise.all([api.incidents.list(),api.hospitals.list(),api.ambulances.list()]);
      setIncidents(Array.isArray(incidentRows)?incidentRows:[]);
      setHospitals(Array.isArray(facilityRows)?facilityRows:[]);
      setAmbulances(Array.isArray(ambulanceRows)?ambulanceRows:[]);
      setError("");
    } catch(e) { setError(`Some live database indicators could not load: ${e.message}. Simulation controls remain available.`); }
  },[]);
  useEffect(()=>{loadResources(); const id=window.setInterval(loadResources,10000); return ()=>window.clearInterval(id);},[loadResources]);

  useEffect(()=>{
    if (!hasStarted) return undefined;
    const id=window.setInterval(()=>setProgress(prev=>Math.min(1,prev+0.25/DURATION_SECONDS)),250);
    return ()=>window.clearInterval(id);
  },[hasStarted]);

  useEffect(()=>{
    if (progress >= 0.03 && !enRouteEventSent.current) {
      enRouteEventSent.current = true;
      addEvent("Ambulance en route","Simulated vehicle started moving along the demo route.");
    }
    if (progress >= 0.68 && !approachingEventSent.current) {
      approachingEventSent.current = true;
      addEvent("Approaching destination","Simulated ambulance is entering the destination area.");
    }
    if (progress >= 1 && runState === "RUNNING" && !arrivalEventSent.current) {
      arrivalEventSent.current = true;
      setRunState("ARRIVED");
      addEvent("Ambulance arrived","Simulation reached the incident marker. No real vehicle was tracked.");
    }
  },[progress,runState,addEvent]);

  function startSimulation() {
    if (progress >= 1) { setProgress(0); enRouteEventSent.current=false; approachingEventSent.current=false; arrivalEventSent.current=false; setEvents([{id:eventId.current++,time:stamp(),title:"Simulation reset",detail:"Ready for a new demonstration run."}]); }
    setRunState("RUNNING"); addEvent("Simulation started","Demo ambulance movement started. Position is synthetic.");
  }
  function pauseSimulation() { setRunState("PAUSED"); addEvent("Simulation paused","The simulated vehicle position is frozen until resumed."); }
  function resetSimulation() { setProgress(0); enRouteEventSent.current=false; approachingEventSent.current=false; arrivalEventSent.current=false; setRunState("READY"); setEvents([{id:eventId.current++,time:stamp(),title:"Simulation reset",detail:"Vehicle returned to the demo hospital."}]); setCopilot(null); }

  async function runBenchmark() {
    setBenchmarkBusy(true); setError("");
    try { const result=await api.engineering.routingBenchmark("sample"); setBenchmark(result); setNotice("Benchmark complete. Both algorithms used the same synthetic graph and origin–destination pairs."); }
    catch(e) { setError(`Routing benchmark failed: ${e.message}`); }
    finally { setBenchmarkBusy(false); }
  }
  async function askCopilot() {
    setCopilotBusy(true); setError("");
    try {
      let incident=DEMO_INCIDENT;
      let recommendations=DEMO_RECOMMENDATION;
      const actual=incidents.find(i=>String(i.incident_id)===String(selectedIncident));
      if (actual) {
        incident=actual;
        try { const ranked=await api.dispatch.recommendations(actual.incident_id); recommendations=ranked.recommendations || []; }
        catch (_) { recommendations=[]; }
      }
      const result=await api.copilot.explain({incident,recommendations,question});
      setCopilot(result); addEvent("Copilot briefing generated",`Response mode: ${result.mode}. Sources retrieved: ${result.citations?.length || 0}.`);
    } catch(e) { setError(`Copilot request failed: ${e.message}`); }
    finally { setCopilotBusy(false); }
  }
  const availableAmbulances=ambulances.filter(a=>a.status==="AVAILABLE").length;
  const activeIncidents=incidents.filter(i=>["PENDING","ACCEPTED","DISPATCHED","EN_ROUTE"].includes(String(i.status||"").toUpperCase())).length;
  const progressWidth=`${progress*100}%`;

  return <section className="command-centre">
    <div className="page-heading cc-heading"><div><span className="eyebrow">EMERGENCY OPERATIONS · ENGINEERING DEMO</span><h2>Accident Response Command Centre</h2><p>Incident awareness, explainable dispatch, route benchmarking and simulated ambulance movement.</p></div><div className="cc-mode-badge"><span className="cc-live-dot"/> SIMULATION MODE</div></div>
    <ErrorMessage message={error} />
    {notice && <p className="success-message">{notice}</p>}
    <div className="cc-banner"><strong>DEMO SIMULATION — NO LIVE GPS CONNECTED</strong><span>The moving marker, route progress and arrival state are generated locally for presentation. Live database counters below are fetched from your backend.</span></div>
    <div className="cc-metrics-grid">
      <Metric label="Open incidents" value={activeIncidents} detail="From backend records" />
      <Metric label="Registered facilities" value={hospitals.length} detail="Hospitals + clinics" />
      <Metric label="Available ambulances" value={availableAmbulances} detail={`${ambulances.length} registered total`} />
      <Metric label="Simulation progress" value={`${Math.round(progress*100)}%`} detail={runState.replace("_"," ")} />
    </div>
    <div className="cc-main-grid">
      <div className="cc-map-panel">
        <div className="cc-panel-heading"><div><span className="eyebrow">ROUTE VISUALISATION</span><h3>Ambulance → Incident</h3></div><span className="cc-sim-chip">SIMULATED VEHICLE</span></div>
        <div className="cc-map-wrap"><MapContainer center={START} zoom={14} scrollWheelZoom={true} style={{height:"430px",width:"100%"}}><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><FitBounds points={[...route,currentPosition]}/><Polyline positions={route} pathOptions={{color:"#64748b",weight:5,opacity:.45,dashArray:"7 8"}}/><Polyline positions={route.slice(0,Math.max(2,Math.ceil(progress*(route.length-1))+1))} pathOptions={{color:"#ef4444",weight:5,opacity:.95}}/><CircleMarker center={START} radius={9} pathOptions={{color:"#0f766e",fillColor:"#14b8a6",fillOpacity:1}}><Popup>Demo City Emergency Hospital (simulated)</Popup></CircleMarker><Marker position={DEST} icon={incidentIcon}><Popup>Simulated accident location</Popup></Marker><Marker position={currentPosition} icon={ambulanceIcon}><Popup>Demo ambulance · {runState}</Popup></Marker></MapContainer></div>
        <div className="cc-route-metrics"><Metric label="Remaining distance" value={`${remainingDistance.toFixed(2)} km`} detail="Along synthetic route"/><Metric label="Simulation ETA" value={formatTime(remainingSeconds)} detail="Accelerated demo clock"/><Metric label="Illustrative road ETA" value={`${Math.ceil((totalDistance/35)*60*(1-progress))} min`} detail="Assumes 35 km/h; not live traffic"/></div>
        <div className="cc-progress"><div className="cc-progress-label"><span>Trip progress</span><strong>{Math.round(progress*100)}%</strong></div><div className="cc-progress-track"><span style={{width:progressWidth}}/></div></div>
        <div className="cc-controls"><button className="button primary" onClick={startSimulation} disabled={runState==="RUNNING"}>▶ {progress>=1?"Run again":"Start simulation"}</button><button className="button secondary" onClick={pauseSimulation} disabled={runState!=="RUNNING"}>Ⅱ Pause</button><button className="button secondary" onClick={resetSimulation}>↺ Reset</button><span className="cc-state-text">Status: <b>{runState==="ARRIVED"?"ARRIVED (SIMULATED)":runState}</b></span><label className="cc-speech-toggle"><input type="checkbox" checked={speechEnabled} onChange={e=>setSpeechEnabled(e.target.checked)}/> Spoken alerts</label></div>
      </div>
      <aside className="cc-side-column">
        <div className="cc-panel"><div className="cc-panel-heading"><div><span className="eyebrow">EVENT STREAM</span><h3>Incident timeline</h3></div><span className="cc-count">{events.length}</span></div><div className="cc-timeline">{events.map(event=><div className="cc-event" key={event.id}><span className="cc-event-dot"/><div><div className="cc-event-title">{event.title}<time>{event.time}</time></div><p>{event.detail}</p></div></div>)}</div></div>
        <div className="cc-panel"><div className="cc-panel-heading"><div><span className="eyebrow">SYSTEM HEALTH</span><h3>Resource indicators</h3></div><button className="button tiny secondary" onClick={loadResources}>Refresh</button></div><div className="cc-resource-row"><span><i className="cc-indicator green"/>Backend resource query</span><b>{hospitals.length || ambulances.length ? "Connected" : "No records / unavailable"}</b></div><div className="cc-resource-row"><span>Available ambulances</span><b>{availableAmbulances}</b></div><div className="cc-resource-row"><span>Out of service</span><b>{ambulances.filter(a=>a.status==="OUT_OF_SERVICE").length}</b></div><div className="cc-resource-row"><span>Busy / assigned</span><b>{ambulances.filter(a=>a.status!=="AVAILABLE"&&a.status!=="OUT_OF_SERVICE").length}</b></div><p className="cc-footnote">Resource counters reflect registered backend data. The moving vehicle above is not one of these live vehicles.</p></div>
      </aside>
    </div>
    <div className="cc-bottom-grid">
      <div className="cc-panel"><div className="cc-panel-heading"><div><span className="eyebrow">ALGORITHM EVALUATION</span><h3>A* vs Dijkstra benchmark</h3></div><button className="button primary" onClick={runBenchmark} disabled={benchmarkBusy}>{benchmarkBusy?"Running…":"Run benchmark"}</button></div><p className="muted-text">Same synthetic road graph and origin–destination cases. Compare travel-time optimality, nodes expanded and measured runtime. Small graphs can make timing noisy.</p>{benchmark && <><div className="cc-benchmark-status"><span className={benchmark.all_optimal_costs_match?"cc-good":"cc-bad"}>{benchmark.all_optimal_costs_match?"✓ Optimal costs match":"! Cost mismatch"}</span><span>{benchmark.case_count} cases · {benchmark.node_count} nodes · {benchmark.edge_count} edges</span></div><div className="cc-chart"><div className="cc-chart-row"><span>Dijkstra time</span><div><i style={{width:`${Math.max(2,Math.min(100,(benchmark.averages.dijkstra_execution_ms/(Math.max(benchmark.averages.dijkstra_execution_ms,benchmark.averages.astar_execution_ms)||1))*100))}%`}}/></div><b>{benchmark.averages.dijkstra_execution_ms} ms</b></div><div className="cc-chart-row"><span>A* time</span><div><i className="astar" style={{width:`${Math.max(2,Math.min(100,(benchmark.averages.astar_execution_ms/(Math.max(benchmark.averages.dijkstra_execution_ms,benchmark.averages.astar_execution_ms)||1))*100))}%`}}/></div><b>{benchmark.averages.astar_execution_ms} ms</b></div><div className="cc-chart-row"><span>Dijkstra nodes</span><div><i style={{width:`${Math.max(2,benchmark.averages.dijkstra_nodes_expanded/16*100)}%`}}/></div><b>{benchmark.averages.dijkstra_nodes_expanded}</b></div><div className="cc-chart-row"><span>A* nodes</span><div><i className="astar" style={{width:`${Math.max(2,benchmark.averages.astar_nodes_expanded/16*100)}%`}}/></div><b>{benchmark.averages.astar_nodes_expanded}</b></div></div><p className="cc-footnote">Graph: {benchmark.graph_label}. A* uses a straight-line lower-bound heuristic only when the graph supports an admissible estimate; otherwise it safely falls back to h(n)=0.</p><details className="cc-details"><summary>View per-case results</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>Route</th><th>Dijkstra cost</th><th>A* cost</th><th>Dijkstra nodes</th><th>A* nodes</th><th>Match</th></tr></thead><tbody>{benchmark.cases.map(c=><tr key={`${c.start}-${c.goal}`}><td>{c.start} → {c.goal}</td><td>{c.dijkstra.travel_time_min??"N/A"}</td><td>{c.astar.travel_time_min??"N/A"}</td><td>{c.dijkstra.nodes_expanded}</td><td>{c.astar.nodes_expanded}</td><td>{c.optimal_cost_matches?"Yes":"No"}</td></tr>)}</tbody></table></div></details></>}</div>
      <div className="cc-panel"><div className="cc-panel-heading"><div><span className="eyebrow">RETRIEVAL-AUGMENTED ASSISTANT</span><h3>AI Dispatch Copilot</h3></div><span className="cc-ai-chip">AI + SOURCES</span></div><label className="cc-label">Use a recorded incident (optional)</label><select className="month-input cc-select" value={selectedIncident} onChange={e=>setSelectedIncident(e.target.value)}><option value="SIM-INC-001">Demo scenario (SIM-INC-001)</option>{incidents.map(i=><option key={i.incident_id} value={i.incident_id}>{i.incident_id} · {i.status} · {
  typeof i.severity === "object" && i.severity !== null
    ? (i.severity.level ?? "Unknown severity")
    : (i.severity ?? "Unknown severity")
}</option>)}</select><label className="cc-label">Question for the copilot</label><textarea className="cc-question" value={question} onChange={e=>setQuestion(e.target.value)} rows={3}/><button className="button primary full" onClick={askCopilot} disabled={copilotBusy}>{copilotBusy?"Preparing grounded answer…":"Explain incident / recommendation"}</button>{copilot && <div className="cc-copilot-answer"><div className="cc-answer-meta"><span className="cc-ai-chip">{copilot.mode==="llm"?`LLM · ${copilot.model}`:"GROUNDED FALLBACK"}</span><span>{copilot.citations?.length||0} sources</span></div><p>{copilot.answer}</p><small>{copilot.status_note}</small>{copilot.citations?.length>0&&<div className="cc-citations"><strong>Retrieved sources</strong>{copilot.citations.map(source=><a key={source.id} href={source.url.startsWith("http")?source.url:undefined} target={source.url.startsWith("http")?"_blank":undefined} rel="noreferrer"><b>[{source.id}] {source.title}</b><span>{source.organization}</span>{source.url.startsWith("http")&&<small>{source.url}</small>}</a>)}</div>}</div>}<p className="cc-footnote">LLM mode requires OPENAI_API_KEY in the backend environment. Without a key, the panel uses a deterministic evidence-grounded fallback and still shows retrieved sources. It never dispatches automatically.</p></div>
    </div>
  </section>;
}
