import { useState } from "react";
import { Link } from "react-router-dom";
import { api, API_BASE_URL } from "../api";

export default function LiveDashboard() {
  const [file, setFile] = useState(null);
  const [cameraId, setCameraId] = useState("CAM_001");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!file) return setError("Choose a video first.");
    setProcessing(true);
    setError("");
    setResult(null);
    try {
      const data = await api.live.upload(file, cameraId);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">LIVE VIDEO INTAKE</span>
          <h2>Feed a camera video into ML</h2>
          <p>Upload a CCTV clip as the live operator. The ML pipeline processes it and any detected accident is immediately published to hospital queues.</p>
        </div>
        <span className="live-pill"><span className="status-dot online" /> ML PIPELINE</span>
      </div>

      {error && <div className="error-message"><span>{error}</span></div>}

      <div className="panel" style={{maxWidth: 760}}>
        <div className="panel-header">
          <div>
            <h3>Send camera footage</h3>
            <span>For the professor demo, upload one of your accident/non-accident clips.</span>
          </div>
        </div>
        <form className="form-stack" onSubmit={submit}>
          <label>Camera ID
            <input value={cameraId} onChange={e => setCameraId(e.target.value)} placeholder="CAM_001" required />
          </label>
          <label>Video file
            <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] || null)} required />
          </label>
          {file && <div className="panel"><strong>{file.name}</strong><span>{(file.size / (1024 * 1024)).toFixed(2)} MB</span></div>}
          <button className="button primary" disabled={processing}>
            {processing ? "Running YOLO + tracking..." : "Send to ML"}
          </button>
        </form>
      </div>

      {processing && (
        <div className="panel" style={{marginTop: 18}}>
          <strong>Processing video...</strong>
          <p className="muted">When ML finishes, a detected accident clip is published to every eligible hospital dashboard.</p>
        </div>
      )}

      {result && (
        <div className="panel" style={{marginTop: 18}}>
          <div className="panel-header">
            <div>
              <span className="eyebrow">ML RESULT</span>
              <h3>{result.accident_detected ? `${result.incidents_created} accident alert(s) published` : "No accident detected"}</h3>
            </div>
          </div>
          <div className="stats-grid">
            <div className="stat-card"><span className="stat-label">Camera</span><strong className="stat-value">{result.camera_id}</strong></div>
            <div className="stat-card"><span className="stat-label">Accident</span><strong className="stat-value">{result.accident_detected ? "TRUE" : "FALSE"}</strong></div>
            <div className="stat-card"><span className="stat-label">Incidents created</span><strong className="stat-value">{result.incidents_created}</strong></div>
            <div className="stat-card"><span className="stat-label">Processing FPS</span><strong className="stat-value">{result.ml_metrics?.processing_fps ?? "—"}</strong></div>
          </div>
          {result.incidents?.map(incident => (
            <div className="alert-card" key={incident.incident_id} style={{marginTop: 12}}>
              <div>
                <span className="alert-label">PUBLISHED TO HOSPITALS</span>
                <h3>{incident.incident_id}</h3>
                <p>Camera {incident.camera_id} · {incident.severity?.level || "UNKNOWN"} severity</p>
              </div>
              <div className="button-row">
                <a className="button secondary" href={`${API_BASE_URL.replace(/\/api$/, "")}${incident.video_clip}`} target="_blank" rel="noreferrer">Open clip</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
