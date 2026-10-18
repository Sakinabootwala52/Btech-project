import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { api } from "../api";
import { PHASE_LABELS, formatAgo, formatDuration, toLatLng } from "../ambulanceRoute";

// Live ambulance position for one incident, read from the backend.
// The position comes from the ambulance simulator page today and can come
// from a real GPS device later — this component does not care which.

const POLL_MS = 2000;
const STALE_AFTER_SECONDS = 15;

const ambulanceIcon = L.divIcon({ className: "cc-ambulance-icon", html: '<div class="cc-ambulance-emoji">🚑</div>', iconSize: [42, 42], iconAnchor: [21, 21] });
const incidentIcon = L.divIcon({ className: "cc-incident-icon", html: '<div class="cc-incident-pin">⚠</div>', iconSize: [34, 34], iconAnchor: [17, 17] });

function FitOnce({ points }) {
  const map = useMap();
  const key = points.map((p) => p.join(",")).join("|");
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
    // Refit only when the fixed markers change, not on every position update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return null;
}

function Metric({ label, value, detail }) {
  return <div className="cc-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export default function LiveAmbulanceTracker({ incidentId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [, setClock] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await api.ambulanceSim.track(incidentId);
        if (!cancelled) { setData(result); setError(""); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setClock((n) => n + 1), 1000);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(tick); };
  }, [incidentId]);

  const tracking = data?.tracking || null;
  const position = tracking?.position || null;
  const hospitalPoint = toLatLng(data?.hospital?.location);
  const incidentPoint = toLatLng(data?.incident_location);
  const vehiclePoint = toLatLng(position);
  const trail = useMemo(() => (Array.isArray(tracking?.trail) ? tracking.trail : []), [tracking?.trail]);
  const fixedPoints = [hospitalPoint, incidentPoint].filter(Boolean);
  const phase = tracking?.phase;
  const lastUpdate = tracking?.updated_at || position?.recorded_at;
  const ageSeconds = lastUpdate ? (Date.now() - new Date(lastUpdate).getTime()) / 1000 : null;
  const moving = phase === "TO_SCENE" || phase === "TO_HOSPITAL";
  const stale = moving && ageSeconds != null && ageSeconds > STALE_AFTER_SECONDS;
  const source = tracking?.source || "SIMULATION";

  if (!data && !error) return <p className="muted-text">Connecting to ambulance tracking…</p>;

  return <div className="as-tracker">
    <div className="cc-panel-heading as-tracker-heading">
      <div><span className="eyebrow">LIVE AMBULANCE TRACKING</span><h3>{data?.ambulance_id || "Ambulance"} · {PHASE_LABELS[phase] || "Waiting for first position"}</h3></div>
      <span className={`cc-sim-chip ${source === "GPS" ? "as-gps-chip" : ""}`}>{source === "GPS" ? "GPS FEED" : "SIMULATED FEED"}</span>
    </div>
    {error && <p className="error-message"><span>Tracking unavailable: {error}</span></p>}
    {stale && <p className="as-stale">No position received for {Math.round(ageSeconds)}s — the vehicle may be paused or offline.</p>}
    {fixedPoints.length > 0 && <div className="cc-map-wrap as-tracker-map">
      <MapContainer center={vehiclePoint || hospitalPoint || incidentPoint} zoom={14} scrollWheelZoom style={{ height: "380px", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FitOnce points={fixedPoints} />
        {trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: "#ef4444", weight: 5, opacity: 0.9 }} />}
        {hospitalPoint && <CircleMarker center={hospitalPoint} radius={9} pathOptions={{ color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 1 }}><Popup>{data?.hospital?.name}</Popup></CircleMarker>}
        {incidentPoint && <Marker position={incidentPoint} icon={incidentIcon}><Popup>Accident {incidentId}</Popup></Marker>}
        {vehiclePoint && <Marker position={vehiclePoint} icon={ambulanceIcon}><Popup>{data?.ambulance_id} · {PHASE_LABELS[phase] || phase}</Popup></Marker>}
      </MapContainer>
    </div>}
    <div className="cc-route-metrics as-tracker-metrics">
      <Metric label="Distance remaining" value={position?.remaining_km != null ? `${Number(position.remaining_km).toFixed(2)} km` : "—"} detail={phase === "TO_HOSPITAL" ? "To hospital" : "To accident scene"} />
      <Metric label="ETA" value={moving ? formatDuration(position?.eta_seconds) : phase ? "Arrived" : "—"} detail={position?.speed_kmh != null && moving ? `${Math.round(position.speed_kmh)} km/h` : "Road speed estimate"} />
      <Metric label="Last update" value={formatAgo(lastUpdate)} detail={`${tracking?.updates || 0} positions received`} />
    </div>
  </div>;
}
