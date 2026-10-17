# Accident Response Backend v3

## Authentication

There are two roles on one login page:

- Hospital: username is the exact hospital name, password is `1234` for the prototype.
- Admin: username `admin`, password `1234` by default.

Change admin credentials in `.env` before any non-demo deployment.

## Hospital workflow

1. Hospital logs in.
2. Hospital updates current resources:
   - small ambulances
   - large ambulances
   - emergency staff
   - beds available
3. New ML incidents are broadcast to every hospital dashboard with `PENDING` status.
4. Hospital reviews the 5-second evidence clip and severity indicators.
5. First hospital to click ACCEPT performs an atomic database claim:
   `PENDING -> RESPONSE_ACCEPTED`.
6. Other hospital dashboards stop showing the incident because it is no longer pending.
7. A resource snapshot and attendance record are stored.
8. Hospital history shows its accepted cases.

## Admin workflow

Admin can see:
- all-time accident count
- monthly accident count
- pending/accepted/resolved counts
- hospital attendance counts
- current hospital resources
- resources captured when each incident was accepted
- monthly accident hotspots by camera/location

## Important scope boundary

Severity is decision support only. The system does not diagnose injuries or automatically choose ambulance size.

Hospital personnel review the video and decide the actual response.

## ML endpoint

`POST /api/detect-accident` remains unauthenticated for the local ML process. It can create a pending incident with severity metadata. Production deployment should add service authentication.
