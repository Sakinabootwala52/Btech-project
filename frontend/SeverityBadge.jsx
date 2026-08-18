export default function SeverityBadge({ level = "UNKNOWN" }) {
  const normalized = String(level).toUpperCase();

  return (
    <span className={`severity-badge severity-${normalized.toLowerCase()}`}>
      {normalized}
    </span>
  );
}
