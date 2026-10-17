# Accident Response System — Frontend

React + Vite frontend for the 14-day prototype.

## Pages

- `/login`
- `/admin`
- `/incidents`
- `/incidents/:id`
- `/hospitals`
- `/hospital-dashboard`
- `/hospital/incidents/:id`

## Setup

Node.js 18+ recommended.

```bash
cd frontend
npm install
```

Copy `.env.example` to `.env`:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

Run:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

## Backend dependency

The frontend expects the Flask backend at:

```text
http://localhost:5000
```

The backend must expose the API contract defined in the project specification.

## IMPLEMENTED

- React/Vite setup
- Admin dashboard
- Incident list
- Incident details
- Hospital registry
- Hospital availability toggle
- Hospital dashboard
- Hospital incident response
- Leaflet/OpenStreetMap map
- Accident video viewer
- API service layer
- Automatic dashboard refresh
- Responsive UI

## MOCKED / PLACEHOLDER

- `/login` is mock authentication only.
- Browser video playback assumes the backend/static video URL is reachable.
- Real-time push notifications are not implemented; dashboards poll every 5 seconds.

## NOT IMPLEMENTED

- Production authentication/authorization
- WebSockets
- Real hospital APIs
- SMS/email notification
- Cloud storage
- Production deployment
