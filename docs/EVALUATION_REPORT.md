# Accident Response System — Evaluation Report Template

> **Status:** template for measured results. Do not present blank/template values as experimental findings. Simulation and synthetic road-graph data must be labelled.

## 1. Research questions

1. Does A* return the same optimal travel-time cost as Dijkstra on the tested non-negative road graph?
2. Does A* reduce expanded nodes or runtime on the tested origin–destination pairs?
3. What are the accident detector's precision, recall, F1, false-positive rate and processing latency on a manually labelled video set?
4. Does capability-aware dispatch avoid recommending facilities that lack the configured required capability?
5. Does fallback choose another eligible facility after a rejection, and does atomic ambulance reservation prevent double assignment?

## 2. Routing benchmark protocol

- Run `python evaluation/run_routing_benchmark.py` from the `backend` directory.
- Both algorithms must receive the same graph and same start/goal pairs.
- Record travel-time path cost, nodes expanded and execution time. A*'s heuristic is disabled (h=0) when the graph metadata cannot support a safe admissible straight-line lower bound.
- Repeat the benchmark multiple times for a serious report; report median runtime and variation, not just one small run.
- The bundled demo graph is synthetic and Pune-like, **not a verified real road network**. Repeat with a documented road graph before claiming real-world routing performance.

## 3. Accident detection protocol

Use a labelled CSV with columns `y_true,y_pred` (0 = no accident, 1 = accident). Run `python ml/evaluate.py path\to\predictions.csv` from the project root, with scikit-learn installed in the selected Python environment. Label clips independently and report the dataset, class balance and any exclusions. Do not change labels to fit model predictions.

Report:
- Precision = TP / (TP + FP)
- Recall = TP / (TP + FN)
- F1 = harmonic mean of precision and recall
- False-positive rate = FP / (FP + TN)
- Per-video processing latency and end-to-end upload-to-alert latency

## 4. Dispatch/fallback tests

1. Best-ranked facility has the required capability and is available.
2. Facility without the required capability is excluded.
3. Unavailable or previously rejected facility is excluded.
4. No eligible facilities results in a clear no-candidate state, not a fabricated dispatch.
5. Two concurrent reservation requests cannot reserve the same ambulance.
6. A rejection causes the next eligible facility to be considered.

## 5. LLM/RAG grounding checks

- Confirm each external claim is supported by one of the retrieved citations.
- Test missing detector evidence, missing coordinates, no eligible facility, and simulated GPS.
- Ensure the assistant states when data is unavailable and never claims that simulation is real GPS.
- If no `OPENAI_API_KEY` is configured, the application intentionally uses a deterministic grounded template; label this mode accurately in screenshots and the report.

## 6. Results table (fill with actual measured values)

| Experiment | Dataset/graph | Metric | Measured result | Notes |
|---|---|---|---|---|
| Detection | Labelled clips | Precision / Recall / F1 | TBD | Do not guess |
| Routing | Synthetic demo graph | Optimal-cost match | TBD | Expect true for tested reachable pairs |
| Routing | Synthetic demo graph | Nodes expanded / runtime | TBD | Run repeated trials |
| Dispatch | Test cases | Ineligible recommendation count | TBD | Target 0 |
| Reservation | Concurrent requests | Duplicate vehicle assignments | TBD | Target 0 |
| Copilot | Grounding test set | Citation support rate | TBD | Manual review |

## 7. Limitations

- Demo ambulance movement is simulated and does not use real GPS.
- The default road graph is synthetic. The straight-line fallback and illustrative average speed are not live traffic ETA.
- The copilot requires an environment-configured OpenAI-compatible API key to call a real LLM; without it, a grounded template is returned.
- The system is a student prototype and is not connected to public-safety dispatch, real hospitals, or emergency call centres.
