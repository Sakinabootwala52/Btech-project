import { Link } from "react-router-dom";
import StatusBadge from "./StatusBadge";
import { formatConfidence, formatDate } from "../utils";

export default function IncidentTable({ incidents = [] }) {
  if (!incidents.length) {
    return <div className="empty-state">No incidents found.</div>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Incident</th>
            <th>Camera</th>
            <th>Time</th>
            <th>Confidence</th>
            <th>Hospital</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((incident) => (
            <tr key={incident.incident_id}>
              <td>
                <Link className="table-link" to={`/incidents/${incident.incident_id}`}>
                  {incident.incident_id}
                </Link>
              </td>
              <td>{incident.camera_id}</td>
              <td>{formatDate(incident.timestamp)}</td>
              <td>{formatConfidence(incident.confidence)}</td>
              <td>{incident.hospital_id || "Not assigned"}</td>
              <td><StatusBadge status={incident.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
