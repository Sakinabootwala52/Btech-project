import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";

const defaultCenter = [18.5204, 73.8567];

export default function MapView({
  incidents = [],
  hospitals = [],
  height = 360,
}) {
  const points = [
    ...incidents
      .filter((item) => item.latitude != null && item.longitude != null)
      .map((item) => ({
        type: "incident",
        id: item.incident_id,
        lat: item.latitude,
        lng: item.longitude,
        title: item.incident_id,
        detail: `Confidence: ${Math.round(item.confidence * 100)}%`,
      })),
    ...hospitals
      .filter((item) => item.latitude != null && item.longitude != null)
      .map((item) => ({
        type: "hospital",
        id: item.hospital_id,
        lat: item.latitude,
        lng: item.longitude,
        title: item.name,
        detail: item.status,
      })),
  ];

  const center =
    points.length > 0 ? [points[0].lat, points[0].lng] : defaultCenter;

  return (
    <div className="map-wrapper" style={{ height }}>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {points.map((point) => (
          <Marker key={`${point.type}-${point.id}`} position={[point.lat, point.lng]}>
            <Popup>
              <strong>{point.title}</strong>
              <br />
              {point.detail}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
