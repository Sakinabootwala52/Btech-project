import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Circle,
  useMap,
} from "react-leaflet";

import { useEffect } from "react";


const defaultCenter = [
  18.5204,
  73.8567,
];


/*
 * ============================================================
 * HAVERSINE DISTANCE
 * ============================================================
 */

function distanceKm(
  lat1,
  lng1,
  lat2,
  lng2
) {
  const R = 6371;

  const dLat =
    ((lat2 - lat1) * Math.PI) /
    180;

  const dLng =
    ((lng2 - lng1) * Math.PI) /
    180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(
      (lat1 * Math.PI) / 180
    ) *
      Math.cos(
        (lat2 * Math.PI) / 180
      ) *
      Math.sin(dLng / 2) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    )
  );
}


/*
 * ============================================================
 * MAP RECENTER
 * ============================================================
 */

function MapRecenter({
  center,
}) {
  const map = useMap();

  useEffect(() => {
    if (!center) return;

    map.setView(
      center,
      13,
      {
        animate: true,
      }
    );
  }, [
    center,
    map,
  ]);

  return null;
}


/*
 * ============================================================
 * MAP
 * ============================================================
 */

export default function MapView({
  incidents = [],
  hospitals = [],
  height = 360,

  activeIncident = null,
  recommendedHospital = null,
}) {

  /*
   * ==========================================================
   * INCIDENT POINTS
   * ==========================================================
   */

  const incidentPoints =
    incidents
      .filter(
        (item) =>
          item?.latitude != null &&
          item?.longitude != null
      )
      .map((item) => ({
        type: "incident",

        id:
          item.incident_id ||
          `incident-${item.latitude}-${item.longitude}`,

        lat: Number(
          item.latitude
        ),

        lng: Number(
          item.longitude
        ),

        title:
          item.incident_id ||
          "Accident",

        detail:
          `Confidence: ${Math.round(
            Number(
              item.confidence || 0
            ) * 100
          )}%`,
      }));


  /*
   * ==========================================================
   * ACTIVE ACCIDENT
   * ==========================================================
   */

  const hasActiveAccident =
    activeIncident &&
    activeIncident.latitude != null &&
    activeIncident.longitude != null;


  const accidentPoint =
    hasActiveAccident
      ? {
          lat: Number(
            activeIncident.latitude
          ),

          lng: Number(
            activeIncident.longitude
          ),
        }
      : null;


  /*
   * ==========================================================
   * HOSPITAL POINTS
   * ==========================================================
   */

  const hospitalPoints =
    hospitals
      .filter(
        (hospital) =>
          hospital?.latitude != null &&
          hospital?.longitude != null
      )
      .map((hospital) => {

        const lat = Number(
          hospital.latitude
        );

        const lng = Number(
          hospital.longitude
        );


        let distance = null;

        if (accidentPoint) {
          distance =
            distanceKm(
              accidentPoint.lat,
              accidentPoint.lng,
              lat,
              lng
            );
        }


        const isRecommended =
          Boolean(
            recommendedHospital &&
              recommendedHospital.hospital_id ===
                hospital.hospital_id
          );


        return {
          ...hospital,

          lat,
          lng,

          title:
            hospital.name ||
            hospital.hospital_name ||
            "Hospital",

          status:
            hospital.status ||
            "UNKNOWN",

          beds:
            Number(
              hospital.beds ??
                hospital.available_beds ??
                hospital.resources
                  ?.beds_available ??
                0
            ),

          ambulances:
            Number(
              hospital.ambulances ??
                hospital.available_ambulances ??
                (
                  Number(
                    hospital.resources
                      ?.small_ambulances ??
                    0
                  ) +
                  Number(
                    hospital.resources
                      ?.large_ambulances ??
                    0
                  )
                )
            ),

          distance,

          isRecommended,
        };
      });


  /*
   * ==========================================================
   * CENTER
   * ==========================================================
   */

  let center = defaultCenter;


  if (accidentPoint) {

    center = [
      accidentPoint.lat,
      accidentPoint.lng,
    ];

  } else if (
    incidentPoints.length > 0
  ) {

    center = [
      incidentPoints[0].lat,
      incidentPoints[0].lng,
    ];

  } else if (
    hospitalPoints.length > 0
  ) {

    center = [
      hospitalPoints[0].lat,
      hospitalPoints[0].lng,
    ];
  }


  return (
    <div
      className="map-wrapper"
      style={{
        height,
        position: "relative",
      }}
    >

      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        style={{
          height: "100%",
          width: "100%",
        }}
      >

        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />


        {/* ================================================== */}
        {/* ACTIVE ACCIDENT                                   */}
        {/* ================================================== */}

        {accidentPoint && (
          <>
            <Marker
              position={[
                accidentPoint.lat,
                accidentPoint.lng,
              ]}
            >
              <Popup>

                <strong>
                  🚨 ACCIDENT DETECTED
                </strong>

                <br />

                Camera:{" "}
                {activeIncident.camera_id ||
                  "UNKNOWN"}

                <br />

                Severity:{" "}
                {activeIncident.severity
                  ?.level ||
                  "UNKNOWN"}

                <br />

                Confidence:{" "}
                {Math.round(
                  Number(
                    activeIncident.confidence ||
                      0
                  ) * 100
                )}
                %

              </Popup>
            </Marker>


            <Circle
              center={[
                accidentPoint.lat,
                accidentPoint.lng,
              ]}
              radius={500}
              pathOptions={{
                color: "#ef4444",
                fillColor: "#ef4444",
                fillOpacity: 0.08,
              }}
            />
          </>
        )}


        {/* ================================================== */}
        {/* HOTSPOTS                                           */}
        {/* ================================================== */}

        {incidentPoints.map(
          (point) => (
            <Marker
              key={
                `incident-${point.id}`
              }
              position={[
                point.lat,
                point.lng,
              ]}
            >
              <Popup>

                <strong>
                  📍 {point.title}
                </strong>

                <br />

                {point.detail}

              </Popup>
            </Marker>
          )
        )}


        {/* ================================================== */}
        {/* HOSPITALS                                          */}
        {/* ================================================== */}

        {hospitalPoints.map(
          (hospital) => (
            <Marker
              key={
                `hospital-${hospital.hospital_id}`
              }
              position={[
                hospital.lat,
                hospital.lng,
              ]}
            >

              <Popup>

                <strong>

                  {hospital.isRecommended
                    ? "⭐ "
                    : "🏥 "}

                  {hospital.title}

                </strong>

                <br />

                Status:{" "}
                {hospital.status}

                <br />

                Beds:{" "}
                {hospital.beds}

                <br />

                Ambulances:{" "}
                {hospital.ambulances}

                {hospital.distance != null && (
                  <>
                    <br />

                    Distance:{" "}
                    {hospital.distance.toFixed(
                      2
                    )}{" "}
                    km
                  </>
                )}

                {hospital.isRecommended && (
                  <>
                    <br />

                    <strong>
                      ⭐ Recommended Hospital
                    </strong>
                  </>
                )}

              </Popup>

            </Marker>
          )
        )}


        <MapRecenter
          center={center}
        />

      </MapContainer>

    </div>
  );
}