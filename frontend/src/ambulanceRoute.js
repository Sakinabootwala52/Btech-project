// Route geometry helpers shared by the ambulance simulator and live tracker.
// Points are [latitude, longitude] pairs, distances are kilometres.

export function toLatLng(location) {
  if (!location) return null;
  const lat = Number(location.latitude);
  const lng = Number(location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}

export function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

// Cumulative distance at every vertex, so position lookups are cheap.
export function buildRoute(points, source) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1] + haversineKm(points[i - 1], points[i]));
  }
  return { points, cumulative, totalKm: cumulative[cumulative.length - 1] || 0, source };
}

export function pointAtDistance(route, distanceKm) {
  const { points, cumulative, totalKm } = route;
  if (!points.length) return null;
  if (distanceKm <= 0) return points[0];
  if (distanceKm >= totalKm) return points[points.length - 1];
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] <= distanceKm) low = mid;
    else high = mid;
  }
  const span = cumulative[high] - cumulative[low] || 1;
  const t = (distanceKm - cumulative[low]) / span;
  return [
    points[low][0] + (points[high][0] - points[low][0]) * t,
    points[low][1] + (points[high][1] - points[low][1]) * t,
  ];
}

// The part of the route already driven, ending at the vehicle's position.
export function drivenPath(route, distanceKm) {
  const path = [];
  for (let i = 0; i < route.points.length && route.cumulative[i] <= distanceKm; i += 1) {
    path.push(route.points[i]);
  }
  const here = pointAtDistance(route, distanceKm);
  if (here) path.push(here);
  return path;
}

// Approximate road-like path used when the routing service is unreachable.
function fallbackPoints(start, end) {
  const bends = [[0, 0], [0.15, 0.06], [0.3, -0.05], [0.45, 0.07], [0.6, -0.06], [0.75, 0.05], [0.9, -0.02], [1, 0]];
  const dLat = end[0] - start[0];
  const dLng = end[1] - start[1];
  return bends.map(([t, bend]) => [
    start[0] + dLat * t + Math.sin(t * Math.PI) * bend * Math.abs(dLng || dLat),
    start[1] + dLng * t - Math.sin(t * Math.PI) * bend * Math.abs(dLat || dLng),
  ]);
}

// Real road route from the public OSRM server, with an explicit fallback.
export async function fetchRoute(start, end) {
  const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`Routing service returned ${response.status}`);
    const data = await response.json();
    const coordinates = data?.routes?.[0]?.geometry?.coordinates || [];
    if (data.code !== "Ok" || coordinates.length < 2) throw new Error("No road route returned");
    return buildRoute(coordinates.map(([lng, lat]) => [lat, lng]), "ROAD");
  } catch (error) {
    console.warn("Road route unavailable, using approximate route.", error);
    return buildRoute(fallbackPoints(start, end), "APPROXIMATE");
  }
}

// Realistic urban ambulance speed (km/h): accelerates away, slows near the
// destination, and varies along the way to mimic traffic and junctions.
export function simulatedSpeedKmh(distanceKm, totalKm) {
  const cruise = 42 + 10 * Math.sin(distanceKm * 4.1) + 5 * Math.sin(distanceKm * 11.3);
  const fromStart = Math.min(1, 0.25 + distanceKm / 0.25);
  const toEnd = Math.min(1, 0.2 + Math.max(0, totalKm - distanceKm) / 0.3);
  return Math.max(12, cruise * Math.min(fromStart, toEnd));
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return minutes ? `${minutes} min ${String(secs).padStart(2, "0")} s` : `${secs} s`;
}

export function formatAgo(isoTime, nowMs = Date.now()) {
  if (!isoTime) return "never";
  const seconds = Math.max(0, Math.round((nowMs - new Date(isoTime).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export const PHASE_LABELS = {
  TO_SCENE: "En route to scene",
  AT_SCENE: "At accident scene",
  TO_HOSPITAL: "Transporting to hospital",
  COMPLETED: "Handover complete",
};
