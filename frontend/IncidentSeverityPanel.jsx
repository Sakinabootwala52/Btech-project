import SeverityBadge from "./SeverityBadge";

export default function IncidentSeverityPanel({ severity }) {
  if (!severity) {
    return (
      <div className="severity-panel unknown">
        <span className="eyebrow">POTENTIAL SEVERITY</span>
        <strong>Not available</strong>
      </div>
    );
  }

  return (
    <div className={`severity-panel ${String(severity.level).toLowerCase()}`}>
      <div>
        <span className="eyebrow">POTENTIAL SEVERITY</span>
        <div className="severity-title">
          <SeverityBadge level={severity.level} />
          {severity.score != null && (
            <span>score {Number(severity.score).toFixed(2)}</span>
          )}
        </div>
      </div>

      <div className="severity-basis">
        <span>Decision support only — hospital review required.</span>
        {severity.basis?.length > 0 && (
          <small>Signals: {severity.basis.join(", ")}</small>
        )}
      </div>

      {severity.relative_speed_before != null && (
        <div className="relative-speed">
          Relative motion before event:{" "}
          <strong>{severity.relative_speed_before}</strong>
          <span> (image-space units)</span>
        </div>
      )}
    </div>
  );
}
