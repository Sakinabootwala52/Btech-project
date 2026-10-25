
## Public ambulance simulation (demo)

- Start Flask as usual from `backend` with `python app.py`.
- Run `python seed.py` once from `backend` to upsert the sample hospitals and nearby first-aid clinics into MongoDB. The added clinic addresses, coordinates, contacts and resources are hypothetical demonstration data.
- Start the frontend as usual from `frontend` with `npm run dev`.
- Open `http://localhost:5174/ambulance` (or the Vite port shown in your terminal). This page is public and does not require login. It does not appear as a login role.
- After a hospital accepts an incident, it appears on this page. Click **Start**, then **Move** to update shared `simulation_progress` in MongoDB. The admin Dispatch Planner and hospital active-case view read that saved progress.
- This is a prototype simulation. It does not connect to a physical GPS device or live traffic. The public control endpoints are intentionally unauthenticated for a local demonstration; protect them before any public deployment.
- In the admin Facilities page, enter a Pune address/locality and use **Find coordinates from address** to look up latitude/longitude through OpenStreetMap Nominatim. Review the result before registering. Manual coordinate entry remains available if lookup fails.
