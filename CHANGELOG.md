# Change Log

This document lists the changes made to the Accident Response System. It covers the map, ambulance GPS tracking, hospital routing, and backend work.

- **Git branch:** `sudi/live-gps`
## Changes Worked On

### 1. Map

- Checked how the map works on different dashboards.
- Investigated why the ambulance simulation keeps repeating on the map.
- Worked on showing the correct location based on the selected incident.

### 2. Ambulance GPS Tracking

- Explored how to show GPS locations on the map.
- Worked on supporting simulated ambulance movement for project demonstrations.
- Planned to add real GPS tracking using a device's location.

### 3. Hospital Routing

- Worked on finding hospitals using road routes with OSRM.
- Reviewed how the system selects the hospital with the shortest estimated road travel time.
- Used OpenStreetMap to keep the mapping solution suitable for a college project.

### 4. Backend Work

- Checked the Flask routes and incident-handling code.
- Reviewed how accident detection results are saved as incident records.
- Checked MongoDB connectivity and backend settings.

### 5. Bug Fixing

- Investigated frontend and backend connection problems.
- Checked how the map is used on different dashboards.
- Checked the current Git branch and local code changes.

## Files Reviewed

| File | Purpose |
|---|---|
| `frontend/src/components/MapView.jsx` | Displays the map and locations. |
| `frontend/src/pages/CommandCentre.jsx` | Shows the command-centre dashboard. |
| `frontend/src/pages/HospitalDashboard.jsx` | Shows the hospital dashboard and incident map. |
| `backend/routes/live.py` | Handles video uploads and accident detection. |
| `backend/services/incident_service.py` | Handles incident creation and hospital selection. |
| `backend/app.py` | Starts and configures the Flask application. |
| `backend/config.py` | Stores backend settings. |

**Note:** These files were reviewed during development. Check `git diff` to confirm which files were actually changed.

## Testing Checklist

- [ ] Check whether the ambulance marker moves correctly.
- [ ] Check whether the map shows the selected incident.
- [ ] Test hospital selection and route display.
- [ ] Check whether the frontend and backend communicate correctly.
- [ ] Check the MongoDB connection.
- [ ] Test ambulance movement using simulated GPS coordinates.
- [ ] Test real GPS tracking if it has been implemented.
- [ ] Confirm that all required changes are pushed to GitHub.

## Current Git Branch

```text
sudi/live-gps
```

## Notes

Update this document whenever new changes are made. Mark each feature as completed, in progress, or planned after checking its actual status. This will keep the change log accurate.