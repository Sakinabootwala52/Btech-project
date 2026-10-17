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
