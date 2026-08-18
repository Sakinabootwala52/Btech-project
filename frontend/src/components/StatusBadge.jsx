import { statusClass } from "../utils";

export default function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${statusClass(status)}`}>
      {String(status || "UNKNOWN").replaceAll("_", " ")}
    </span>
  );
}
