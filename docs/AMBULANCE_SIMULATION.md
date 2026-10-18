# Ambulance Unit Simulation

The **Live Feed** page acts as a CCTV camera. The **Ambulance Unit** page acts as the ambulance: it drives a dispatched vehicle along the road route and reports its position to the backend, exactly as a GPS unit would. Hospital screens read that position and show the vehicle moving live.

## Demo flow

1. **Admin → Ambulances**: register at least one vehicle for a hospital (e.g. `AMB-01` for City Emergency Hospital).
2. **Live Feed** (`live / 1234`): stream a clip until an accident is detected.
3. **Hospital** (`City Emergency Hospital / 1234`): ACCEPT the alert, open it, click **Dispatch Ambulance**.
4. **Ambulance** (`ambulance / 1234`, or Admin → Ambulance Simulation): the dispatched vehicle is selected automatically. Click **Start trip**.
5. Keep the hospital's incident page open beside it: the **Live Ambulance Tracking** map follows the vehicle.
6. On arrival the incident becomes `ARRIVED`. Click **Depart to hospital**, then **Start transport**.
7. At the hospital click **Complete handover**: the incident becomes `RESOLVED` and the vehicle is `AVAILABLE` again.

Use the **Demo clock** (1×–20×) to speed up the trip during a presentation. Reloading the page resumes from the last reported position.

## Lifecycle

| Step | Incident status | Ambulance status | Tracking phase |
|---|---|---|---|
| Hospital dispatches | `DISPATCHED` | `ASSIGNED` | — |
| Start trip | `EN_ROUTE` | `EN_ROUTE` | `TO_SCENE` |
| Reaches scene | `ARRIVED` | `ARRIVED` | `AT_SCENE` |
| Depart to hospital | `ARRIVED` | `TRANSPORTING` | `TO_HOSPITAL` |
| Complete handover | `RESOLVED` | `AVAILABLE` | `COMPLETED` |

Every transition is a conditional (atomic) MongoDB update, so an out-of-order or duplicate request returns `409` instead of corrupting state. If the hospital changes the status from its own page mid-trip, the simulator's next position update is rejected and the page pauses.

## API (`/api/ambulance-sim`)

| Method & path | Who | Purpose |
|---|---|---|
| `GET /assignments` | ambulance, admin | All vehicles with their incident and base hospital |
| `POST /<ambulance_id>/start` | ambulance, admin | Start or resume the trip to the scene |
| `POST /<ambulance_id>/position` | ambulance, admin | Report a position (see below) |
| `POST /<ambulance_id>/arrive-scene` | ambulance, admin | Reached the accident |
| `POST /<ambulance_id>/depart-scene` | ambulance, admin | Patient on board, heading to hospital |
| `POST /<ambulance_id>/complete` | ambulance, admin | Handover done, vehicle freed |
| `GET /track/<incident_id>` | admin, ambulance, owning hospital | Latest position, phase and trail |

Position body:

```json
{
  "latitude": 18.5212,
  "longitude": 73.8531,
  "phase": "TO_SCENE",
  "source": "SIMULATION",
  "progress": 0.42,
  "speed_kmh": 38.5,
  "remaining_km": 0.61,
  "eta_seconds": 57
}
```

Only `latitude`, `longitude` and `phase` (`TO_SCENE` or `TO_HOSPITAL`) are required. The backend stores the latest position on the incident (`ambulance_tracking.position`) and on the vehicle (`last_position`), and keeps the last 300 points as a trail.

## Connecting real GPS (work item 2)

A phone or GPS device sends the same request with `"source": "GPS"` (for example from the browser's `navigator.geolocation.watchPosition`). The hospital tracker labels the feed **GPS FEED** instead of **SIMULATED FEED**. No other backend or hospital-page change is needed.

## Routing and speed

- The route comes from the public OSRM server on OpenStreetMap roads. If it is unreachable, an approximate path is used and the page labels it **APPROXIMATE ROUTE**.
- Speed follows an urban ambulance profile (about 25–55 km/h, slower when starting and arriving). The ETA is computed from the current speed and the remaining road distance.

## Files

- `backend/routes/ambulance_sim.py`: API and lifecycle
- `backend/tests/test_ambulance_sim.py`: end-to-end tests (`pip install mongomock`, then `python -m unittest tests.test_ambulance_sim` from `backend/`)
- `frontend/src/pages/AmbulanceSimulation.jsx`: simulator page (`/ambulance`)
- `frontend/src/components/LiveAmbulanceTracker.jsx`: live map on the hospital incident page
- `frontend/src/ambulanceRoute.js`: route fetching, distance and speed helpers
- Small additions: `ambulance` login role (`auth.py`, `config.py`, `Login.jsx`), sidebar links (`Layout.jsx`), route (`App.jsx`), API client (`api.js`), styles (`styles.css`)

## Scope

Positions are simulated. The page never claims live GPS, and the banner states this. Severity and routing remain decision support; hospital staff still decide the response.
