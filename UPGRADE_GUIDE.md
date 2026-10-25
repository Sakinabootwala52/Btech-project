# Command Centre Upgrade Guide

## What's new
- Admin Command Centre: `/admin/command-centre`.
- Demo ambulance animation with Start/Pause/Reset, progress, remaining distance, simulated ETA and event timeline. Visible `SIMULATION MODE` banner; no GPS is claimed.
- A* vs Dijkstra benchmark API and UI, using identical cases and reporting path-cost optimality, expanded nodes and runtime.
- Retrieval-augmented dispatch copilot with a local protocol knowledge base and clickable citations. Without an API key it uses a grounded template. Optional LLM mode uses an OpenAI-compatible Chat Completions API.
- Evaluation report template and repeatable routing benchmark script.
- Fixed MongoDB `_id` index initialization and the JSX parse error in Hospitals.jsx.

## Run locally
1. Backend terminal: `cd backend`, then `python app.py`.
2. Frontend terminal: `cd frontend`, then `npm run dev`.
3. Sign in as admin and choose **Command Centre** from the sidebar.
4. Click **Start simulation**; use Pause and Reset during the demo.
5. Click **Run benchmark** and inspect the per-case results.
6. Ask the copilot to explain the current incident or recommendation.

## Optional real LLM
Set environment variables in the backend terminal before starting Flask. Never commit a key to source control.

Windows CMD example:
```bat
set OPENAI_API_KEY=your_api_key_here
set OPENAI_MODEL=gpt-4o-mini
python app.py
```

For an OpenAI-compatible provider, set `OPENAI_BASE_URL` to its `/chat/completions` endpoint. The application falls back to a grounded local response if no key is configured or the API request fails. The copilot is decision support only and does not dispatch ambulances.

## Benchmark/tests
From the `backend` directory:
```bat
python -m unittest discover -s tests -p "test_routing_benchmark.py"
python evaluation/run_routing_benchmark.py
```
The benchmark graph is synthetic and must not be described as a verified road network. See `docs/EVALUATION_REPORT.md` for the evaluation protocol and report template.


## Pune hospital map and GPS demonstration additions

- `backend/seed.py` now upserts ten Pune demonstration facilities (nine hospitals and one first-aid clinic) with approximate map coordinates and hypothetical resource counts: small/large ambulances, emergency staff, emergency units and available beds. These figures are demo data, not verified inventories. The seed removes only the four old sample facility IDs (`H001`, `H002`, `H003`, `C001`) before upserting the Pune facilities; it does not clear incidents or other collections.
- The admin dashboard map is taller and hospital markers show the name on hover. Clicking a marker shows coordinates, resources, availability and the number of incidents recorded against that hospital.
- The Ambulances page contains a GPS journey simulator. Admin can choose an incident/facility and advance a simulated marker in steps. Orange traffic/road-incident overlays are synthetic examples. They are explicitly not live GPS, live traffic, or real route geometry. Hospital users can view a preview for their own facility but cannot control the marker.
- Dispatch Planner includes a Dijkstra vs A* benchmark panel using the backend's reproducible benchmark. The sample graph is synthetic; the configured graph only represents real roads if an administrator supplies a validated road graph.

### Run the seed

From `backend/` after setting up `.env` and ensuring MongoDB is reachable: `python seed.py`. Then restart the backend and frontend. Hospital demo login uses the exact facility name as username and `1234` as the prototype password; admin/live credentials are controlled by `backend/.env` / `config.py`.
