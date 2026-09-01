import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import L from "leaflet";


// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_CENTER = [
  18.5204,
  73.8567,
];


// ============================================================
// AMBULANCE ICON
// ============================================================

const ambulanceIcon =
  L.divIcon({
    className:
      "ambulance-map-icon",

    html: `
      <div
        style="
          width: 38px;
          height: 38px;
          border-radius: 50%;
          background: #ffffff;
          border: 3px solid #ef4444;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 21px;
          box-shadow: 0 4px 14px rgba(15,23,42,.28);
          animation: ambulanceMapPulse 1.2s infinite;
        "
      >
        🚑
      </div>
    `,

    iconSize: [
      38,
      38,
    ],

    iconAnchor: [
      19,
      19,
    ],
  });


// ============================================================
// FIT MAP
// ============================================================

function FitRouteBounds({
  points,
}) {
  const map =
    useMap();

  useEffect(() => {

    if (
      !points ||
      points.length < 2
    ) {
      return;
    }

    const bounds =
      L.latLngBounds(
        points
      );

    map.fitBounds(
      bounds,
      {
        padding:
          [45, 45],
        maxZoom:
          14,
      }
    );

  }, [
    map,
    points,
  ]);

  return null;
}


// ============================================================
// INTERPOLATE POSITION
// ============================================================

function interpolatePoint(
  points,
  progress
) {
  if (
    !points ||
    points.length === 0
  ) {
    return DEFAULT_CENTER;
  }

  if (
    points.length === 1
  ) {
    return points[0];
  }

  const safeProgress =
    Math.min(
      1,
      Math.max(
        0,
        progress
      )
    );

  const scaled =
    safeProgress *
    (points.length - 1);

  const index =
    Math.floor(
      scaled
    );

  if (
    index >=
    points.length - 1
  ) {
    return points[
      points.length - 1
    ];
  }

  const fraction =
    scaled -
    index;

  const start =
    points[index];

  const end =
    points[index + 1];

  return [
    start[0] +
      (end[0] -
        start[0]) *
        fraction,

    start[1] +
      (end[1] -
        start[1]) *
        fraction,
  ];
}


// ============================================================
// DISTANCE
// ============================================================

function distanceBetween(
  first,
  second
) {
  const R = 6371;

  const lat1 =
    first[0] *
    Math.PI /
    180;

  const lat2 =
    second[0] *
    Math.PI /
    180;

  const dLat =
    (
      second[0] -
      first[0]
    ) *
    Math.PI /
    180;

  const dLon =
    (
      second[1] -
      first[1]
    ) *
    Math.PI /
    180;

  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(
        dLon / 2
      ) ** 2;

  return (
    R *
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(
        1 - a
      )
    )
  );
}


function calculateRouteDistance(
  points
) {
  if (
    !points ||
    points.length < 2
  ) {
    return 0;
  }

  let total = 0;

  for (
    let i = 1;
    i < points.length;
    i += 1
  ) {
    total +=
      distanceBetween(
        points[i - 1],
        points[i]
      );
  }

  return total;
}


// ============================================================
// FALLBACK ROUTE
// ============================================================

function buildFallbackRoute(
  start,
  end
) {
  const points = [];

  const [
    startLat,
    startLng,
  ] = start;

  const [
    endLat,
    endLng,
  ] = end;

  const latDifference =
    endLat -
    startLat;

  const lngDifference =
    endLng -
    startLng;

  const offsets = [
    [0.00, 0.00],
    [0.12, 0.07],
    [0.23, -0.04],
    [0.35, 0.08],
    [0.47, -0.07],
    [0.58, 0.05],
    [0.70, -0.06],
    [0.82, 0.04],
    [0.92, -0.02],
    [1.00, 0.00],
  ];

  offsets.forEach(
    ([ratio, bend]) => {

      const lat =
        startLat +
        latDifference *
          ratio +
        Math.sin(
          ratio * Math.PI
        ) *
          bend *
          Math.abs(
            latDifference
          );

      const lng =
        startLng +
        lngDifference *
          ratio +
        Math.sin(
          ratio * Math.PI
        ) *
          bend *
          Math.abs(
            lngDifference
          );

      points.push([
        lat,
        lng,
      ]);
    }
  );

  return points;
}


// ============================================================
// ROAD ROUTE
// ============================================================

async function fetchRoadRoute(
  start,
  end
) {
  const startString =
    `${start[1]},${start[0]}`;

  const endString =
    `${end[1]},${end[0]}`;

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${startString};${endString}` +
    `?overview=full&geometries=geojson`;

  const response =
    await fetch(url);

  if (
    !response.ok
  ) {
    throw new Error(
      `Route request failed: ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes?.[0]
  ) {
    throw new Error(
      "No route returned."
    );
  }

  const coordinates =
    data.routes[0]
      ?.geometry
      ?.coordinates ||
    [];

  const points =
    coordinates.map(
      ([lng, lat]) => [
        lat,
        lng,
      ]
    );

  if (
    points.length < 2
  ) {
    throw new Error(
      "Route contains too few points."
    );
  }

  return {
    points,

    distanceKm:
      Number(
        data.routes[0]
          .distance
      ) / 1000,

    durationSeconds:
      Number(
        data.routes[0]
          .duration
      ),
  };
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function AmbulanceRouteMap({
  hospital,
  incident,
  onTripComplete,
}) {

  const [
    route,
    setRoute,
  ] = useState(null);

  const [
    routeLoading,
    setRouteLoading,
  ] = useState(false);

  const [
    routeSource,
    setRouteSource,
  ] = useState(
    "preparing"
  );

  const [
    progress,
    setProgress,
  ] = useState(0);

  const completionSent =
    useRef(false);


  // ==========================================================
  // POSITIONS
  // ==========================================================

  const hospitalPosition =
    useMemo(() => {

      if (
        hospital?.latitude ==
          null ||
        hospital?.longitude ==
          null
      ) {
        return null;
      }

      return [
        Number(
          hospital.latitude
        ),
        Number(
          hospital.longitude
        ),
      ];

    }, [
      hospital,
    ]);


  const incidentPosition =
    useMemo(() => {

      if (
        incident?.latitude ==
          null ||
        incident?.longitude ==
          null
      ) {
        return null;
      }

      return [
        Number(
          incident.latitude
        ),
        Number(
          incident.longitude
        ),
      ];

    }, [
      incident,
    ]);


  // ==========================================================
  // LOAD ROUTE
  // ==========================================================

  useEffect(() => {

    let cancelled =
      false;

    async function loadRoute() {

      if (
        !hospitalPosition ||
        !incidentPosition
      ) {
        return;
      }

      setRouteLoading(
        true
      );

      try {

        const roadRoute =
          await fetchRoadRoute(
            hospitalPosition,
            incidentPosition
          );

        if (
          cancelled
        ) {
          return;
        }

        setRoute(
          roadRoute
        );

        setRouteSource(
          "road"
        );

      } catch (error) {

        console.warn(
          "Road route unavailable. Using fallback route.",
          error
        );

        if (
          cancelled
        ) {
          return;
        }

        const fallback =
          buildFallbackRoute(
            hospitalPosition,
            incidentPosition
          );

        setRoute({
          points:
            fallback,

          distanceKm:
            calculateRouteDistance(
              fallback
            ),

          durationSeconds:
            null,
        });

        setRouteSource(
          "simulated"
        );

      } finally {

        if (
          !cancelled
        ) {
          setRouteLoading(
            false
          );
        }
      }
    }

    loadRoute();

    return () => {
      cancelled = true;
    };

  }, [
    hospitalPosition,
    incidentPosition,
  ]);


  // ==========================================================
  // RESET COMPLETION GUARD
  // ==========================================================

  useEffect(() => {

    if (
      incident?.status !==
      "EN_ROUTE"
    ) {
      completionSent.current =
        false;
    }

  }, [
    incident?.status,
  ]);


  // ==========================================================
  // ANIMATE TRIP
  // ==========================================================

  useEffect(() => {

    if (
      !route ||
      !incident
    ) {
      setProgress(0);
      return;
    }


    // Already arrived/resolved

    if (
      incident.status ===
        "ARRIVED" ||
      incident.status ===
        "RESOLVED"
    ) {

      setProgress(1);

      return;
    }


    // Waiting at hospital

    if (
      incident.status !==
      "EN_ROUTE"
    ) {

      setProgress(0);

      return;
    }


    const tripStart =
      incident.en_route_at
        ? new Date(
            incident.en_route_at
          ).getTime()
        : Date.now();


    /*
     * Demo travel speed.
     *
     * 35 km/h makes the trip visible during
     * a presentation.
     */

    const distance =
      route.distanceKm ||
      1;

    const calculatedDuration =
      (
        distance /
        35
      ) *
      60 *
      60 *
      1000;


    const duration =
      Math.min(
        90000,
        Math.max(
          30000,
          calculatedDuration
        )
      );


    let animationFrame;


    function tick() {

      const elapsed =
        Date.now() -
        tripStart;

      const nextProgress =
        Math.min(
          1,
          Math.max(
            0,
            elapsed /
              duration
          )
        );

      setProgress(
        nextProgress
      );


      /*
       * 🚨 IMPORTANT
       *
       * Once the ambulance reaches the destination,
       * tell the parent exactly once.
       */

      if (
        nextProgress >= 1 &&
        !completionSent.current
      ) {

        completionSent.current =
          true;

        if (
          typeof onTripComplete ===
          "function"
        ) {
          onTripComplete();
        }

        return;
      }


      animationFrame =
        window.requestAnimationFrame(
          tick
        );
    }


    animationFrame =
      window.requestAnimationFrame(
        tick
      );


    return () => {

      if (
        animationFrame
      ) {
        window.cancelAnimationFrame(
          animationFrame
        );
      }
    };

  }, [
    route,
    incident,
    onTripComplete,
  ]);


  // ==========================================================
  // AMBULANCE POSITION
  // ==========================================================

  const ambulancePosition =
    useMemo(() => {

      if (
        !route?.points?.length
      ) {
        return (
          hospitalPosition ||
          incidentPosition ||
          DEFAULT_CENTER
        );
      }

      return interpolatePoint(
        route.points,
        progress
      );

    }, [
      route,
      progress,
      hospitalPosition,
      incidentPosition,
    ]);


  // ==========================================================
  // REMAINING DISTANCE
  // ==========================================================

  const distanceRemaining =
    useMemo(() => {

      if (!route) {
        return null;
      }

      return Math.max(
        0,
        route.distanceKm *
          (1 - progress)
      );

    }, [
      route,
      progress,
    ]);


  // ==========================================================
  // ETA
  // ==========================================================

  const etaMinutes =
    useMemo(() => {

      if (
        !route ||
        progress >= 1
      ) {
        return 0;
      }

      const totalMinutes =
        Math.max(
          1,
          (
            route.distanceKm /
            35
          ) * 60
        );

      return Math.max(
        1,
        Math.ceil(
          totalMinutes *
            (1 - progress)
        )
      );

    }, [
      route,
      progress,
    ]);


  // ==========================================================
  // MAP POINTS
  // ==========================================================

  const mapPoints =
    useMemo(() => {

      const points = [];

      if (
        hospitalPosition
      ) {
        points.push(
          hospitalPosition
        );
      }

      if (
        incidentPosition
      ) {
        points.push(
          incidentPosition
        );
      }

      if (
        ambulancePosition
      ) {
        points.push(
          ambulancePosition
        );
      }

      return points;

    }, [
      hospitalPosition,
      incidentPosition,
      ambulancePosition,
    ]);


  // ==========================================================
  // MISSING COORDINATES
  // ==========================================================

  if (
    !hospitalPosition ||
    !incidentPosition
  ) {

    return (
      <div
        className="empty-state"
        style={{
          minHeight:
            "300px",
        }}
      >

        <strong>
          Live route unavailable
        </strong>

        <span>
          Hospital and accident coordinates are required.
        </span>

      </div>
    );
  }


  // ==========================================================
  // STATUS MESSAGE
  // ==========================================================

  let trackingText =
    "Ambulance assigned.";

  if (
    incident.status ===
    "DISPATCHED"
  ) {
    trackingText =
      "Ambulance dispatched from the hospital.";
  }

  if (
    incident.status ===
    "EN_ROUTE"
  ) {
    trackingText =
      "Ambulance is travelling to the accident location.";
  }

  if (
    incident.status ===
    "ARRIVED"
  ) {
    trackingText =
      "Ambulance has arrived at the accident location.";
  }

  if (
    incident.status ===
    "RESOLVED"
  ) {
    trackingText =
      "Emergency response completed.";
  }


  return (
    <div
      style={{
        display:
          "flex",
        flexDirection:
          "column",
        gap:
          "14px",
      }}
    >

      {/* ======================================================
          HEADER
      ====================================================== */}

      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          justifyContent:
            "space-between",
          gap:
            "15px",
          flexWrap:
            "wrap",
        }}
      >

        <div>

          <span className="eyebrow">
            LIVE AMBULANCE TRACKING
          </span>

          <h3
            style={{
              margin:
                "5px 0 4px",
            }}
          >
            Hospital → Accident
          </h3>

          <p
            style={{
              margin:
                0,
              color:
                "#64748b",
              fontSize:
                "13px",
            }}
          >
            {trackingText}
          </p>

        </div>


        <div
          style={{
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "8px",
          }}
        >

          <span
            style={{
              width:
                "8px",
              height:
                "8px",
              borderRadius:
                "50%",
              background:
                "#22c55e",
              animation:
                "routeLivePulse 1.4s infinite",
            }}
          />

          <strong
            style={{
              color:
                "#15803d",
              fontSize:
                "12px",
            }}
          >
            LIVE
          </strong>

        </div>

      </div>


      {/* ======================================================
          METRICS
      ====================================================== */}

      <div
        style={{
          display:
            "grid",
          gridTemplateColumns:
            "repeat(3, 1fr)",
          gap:
            "10px",
        }}
      >

        <div
          style={{
            padding:
              "12px",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            Total distance
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {routeLoading
              ? "Loading..."
              : `${route?.distanceKm?.toFixed(
                  2
                ) || "—"} km`}
          </strong>

        </div>


        <div
          style={{
            padding:
              "12px",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            Remaining
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {
              statusTextForRemaining(
                incident.status,
                distanceRemaining
              )
            }
          </strong>

        </div>


        <div
          style={{
            padding:
              "12px",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "10px",
            background:
              "#f8fafc",
          }}
        >

          <div
            style={{
              fontSize:
                "10px",
              color:
                "#64748b",
              fontWeight:
                700,
              textTransform:
                "uppercase",
            }}
          >
            ETA
          </div>

          <strong
            style={{
              display:
                "block",
              marginTop:
                "4px",
            }}
          >
            {incident.status ===
                "ARRIVED" ||
            incident.status ===
                "RESOLVED"
              ? "Arrived"
              : incident.status ===
                  "EN_ROUTE"
                ? `${etaMinutes} min`
                : "Waiting"}
          </strong>

        </div>

      </div>


      {/* ======================================================
          MAP
      ====================================================== */}

      <div
        style={{
          height:
            "460px",
          width:
            "100%",
          borderRadius:
            "14px",
          overflow:
            "hidden",
          position:
            "relative",
          border:
            "1px solid #e2e8f0",
        }}
      >

        <MapContainer
          center={
            hospitalPosition
          }
          zoom={13}
          scrollWheelZoom
          style={{
            height:
              "100%",
            width:
              "100%",
          }}
        >

          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />


          {/* Complete route */}

          {route?.points?.length >
            1 && (
            <Polyline
              positions={
                route.points
              }
              pathOptions={{
                color:
                  "#2563eb",
                weight:
                  6,
                opacity:
                  0.65,
              }}
            />
          )}


          {/* Travelled portion */}

          {route?.points?.length >
            1 &&
            progress > 0 && (
            <Polyline
              positions={[
                ...route.points.slice(
                  0,
                  Math.max(
                    2,
                    Math.ceil(
                      progress *
                        route.points
                          .length
                    )
                  )
                ),
              ]}
              pathOptions={{
                color:
                  "#22c55e",
                weight:
                  7,
                opacity:
                  0.95,
              }}
            />
          )}


          {/* Hospital */}

          <CircleMarker
            center={
              hospitalPosition
            }
            radius={10}
            pathOptions={{
              color:
                "#2563eb",
              fillColor:
                "#2563eb",
              fillOpacity:
                0.95,
              weight:
                3,
            }}
          >

            <Popup>

              <strong>
                🏥{" "}
                {
                  hospital.name ||
                  "Hospital"
                }
              </strong>

              <br />

              Ambulance origin

            </Popup>

          </CircleMarker>


          {/* Accident */}

          <CircleMarker
            center={
              incidentPosition
            }
            radius={12}
            pathOptions={{
              color:
                "#ef4444",
              fillColor:
                "#ef4444",
              fillOpacity:
                0.95,
              weight:
                3,
            }}
          >

            <Popup>

              <strong>
                📍 Accident Location
              </strong>

              <br />

              {
                incident.incident_id
              }

            </Popup>

          </CircleMarker>


          {/* Ambulance */}

          {incident.status !==
            "RESPONSE_ACCEPTED" && (
            <Marker
              position={
                ambulancePosition
              }
              icon={
                ambulanceIcon
              }
            >

              <Popup>

                <strong>
                  🚑 Ambulance
                </strong>

                <br />

                {incident.status ===
                "EN_ROUTE"
                  ? "Currently en route"
                  : incident.status ===
                      "ARRIVED"
                    ? "Arrived at accident"
                    : "Dispatched"}

              </Popup>

            </Marker>
          )}


          <FitRouteBounds
            points={
              mapPoints
            }
          />

        </MapContainer>


        {/* ====================================================
            MAP STATUS OVERLAY
        ==================================================== */}

        <div
          style={{
            position:
              "absolute",
            top:
              "14px",
            left:
              "50%",
            transform:
              "translateX(-50%)",
            zIndex:
              1000,
            background:
              "#ffffff",
            border:
              "1px solid #e2e8f0",
            borderRadius:
              "999px",
            padding:
              "9px 14px",
            boxShadow:
              "0 5px 20px rgba(15,23,42,.15)",
            display:
              "flex",
            alignItems:
              "center",
            gap:
              "8px",
            fontSize:
              "12px",
            fontWeight:
              800,
            whiteSpace:
              "nowrap",
          }}
        >

          {incident.status ===
          "EN_ROUTE"
            ? "🚑 Ambulance is moving"
            : incident.status ===
                "ARRIVED"
              ? "✅ Ambulance arrived"
              : incident.status ===
                  "RESOLVED"
                ? "✅ Response completed"
                : "🚑 Ambulance dispatched"}

        </div>

      </div>


      {/* ======================================================
          LEGEND
      ====================================================== */}

      <div
        style={{
          display:
            "flex",
          alignItems:
            "center",
          gap:
            "18px",
          flexWrap:
            "wrap",
          fontSize:
            "11px",
          color:
            "#64748b",
        }}
      >

        <span>
          🔵 Hospital
        </span>

        <span>
          🔴 Accident
        </span>

        <span>
          🚑 Ambulance
        </span>

        <span>
          {routeSource ===
          "road"
            ? "Road route"
            : routeSource ===
                "simulated"
              ? "Simulated route"
              : "Calculating route..."}
        </span>

      </div>


      <style>
        {`
          @keyframes routeLivePulse {
            0% {
              opacity: 1;
              transform: scale(1);
            }

            50% {
              opacity: .45;
              transform: scale(.8);
            }

            100% {
              opacity: 1;
              transform: scale(1);
            }
          }

          @keyframes ambulanceMapPulse {
            0% {
              transform: scale(1);
            }

            50% {
              transform: scale(1.08);
            }

            100% {
              transform: scale(1);
            }
          }
        `}
      </style>

    </div>
  );
}


// ============================================================
// HELPER
// ============================================================

function statusTextForRemaining(
  status,
  distanceRemaining
) {
  if (
    status ===
      "ARRIVED" ||
    status ===
      "RESOLVED"
  ) {
    return "0.00 km";
  }

  if (
    distanceRemaining !=
    null
  ) {
    return `${distanceRemaining.toFixed(
      2
    )} km`;
  }

  return "—";
}