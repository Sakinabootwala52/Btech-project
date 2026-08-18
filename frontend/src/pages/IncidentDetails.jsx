import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Loading from "../components/Loading";
import ErrorMessage from "../components/ErrorMessage";
import StatusBadge from "../components/StatusBadge";
import VideoPlayer from "../components/VideoPlayer";
import MapView from "../components/MapView";
import { api } from "../api";
import { formatConfidence, formatDate, formatDistance } from "../utils";

export default function IncidentDetails() {
  const { id } = useParams();
  const [incident, setIncident] = useState(null);
  const [camera, setCamera] = useState(null);
  const [hospital, setHospital] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const incidentData = await api.incidents.get(id);
      setIncident(incidentData);

      const [cameraData, hospitalData] = await Promise.all([
        api.cameras.get(incidentData.camera_id),
        api.hospitals.list(),
      ]);

      setCamera(cameraData);
      setHospital(
        hospitalData.find((item) => item.hospital_id === incidentData.hospital_id)
      );
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function updateStatus(status) {
    try {
      await api.incidents.updateStatus(id, status);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !incident) return <ErrorMessage message={error} />;
  if (!incident) return <Loading label="Loading incident..." />;

  return (
    <section>
      <div className="breadcrumb">
        <Link to="/incidents">Incidents</Link> / {incident.incident_id}
      </div>

      <div className="page-heading">
        <div>
          <span className="eyebrow">INCIDENT DETAILS</span>
          <h2>{incident.incident_id}</h2>
          <p>{formatDate(incident.timestamp)}</p>
        </div>
        <StatusBadge status={incident.status} />
      </div>

      <ErrorMessage message={error} />

      <div className="content-grid two-thirds">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Video evidence</h3>
              <span>Generated accident clip</span>
            </div>
          </div>
          <VideoPlayer src={incident.video_clip} />
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Incident summary</h3>
              <span>Detection evidence and routing</span>
            </div>
          </div>

          <div className="detail-list">
            <Detail label="Confidence" value={formatConfidence(incident.confidence)} />
            <Detail label="Camera" value={incident.camera_id} />
            <Detail label="Speed before" value={incident.speed_before ?? "—"} />
            <Detail label="Speed after" value={incident.speed_after ?? "—"} />
            <Detail label="Hospital" value={hospital?.name || incident.hospital_id || "Not assigned"} />
            <Detail label="Distance" value={formatDistance(incident.hospital_distance_km)} />
            <Detail label="Hospital response" value={incident.hospital_response} />
          </div>

          <div className="button-row">
            {incident.status === "PENDING" && (
              <>
                <button className="button primary" onClick={() => updateStatus("RESPONSE_ACCEPTED")}>
                  Accept response
                </button>
                <button className="button danger" onClick={() => updateStatus("REJECTED")}>
                  Reject
                </button>
              </>
            )}
            {incident.status === "RESPONSE_ACCEPTED" && (
              <button className="button primary" onClick={() => updateStatus("RESOLVED")}>
                Mark resolved
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <div>
            <h3>Location</h3>
            <span>
              {incident.latitude}, {incident.longitude}
            </span>
          </div>
        </div>
        <MapView incidents={[incident]} hospitals={hospital ? [hospital] : []} height={400} />
      </div>

      {camera && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>Camera information</h3>
              <span>{camera.name}</span>
            </div>
          </div>
          <div className="detail-list compact">
            <Detail label="Camera ID" value={camera.camera_id} />
            <Detail label="Location" value={camera.location_name} />
            <Detail label="Status" value={camera.status} />
          </div>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
