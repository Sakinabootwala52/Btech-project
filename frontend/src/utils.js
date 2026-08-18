export function formatConfidence(value) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString();
}

export function formatDistance(value) {
  if (value === null || value === undefined) return "—";
  return `${Number(value).toFixed(2)} km`;
}

export function statusClass(status = "") {
  return status.toLowerCase().replaceAll("_", "-");
}
