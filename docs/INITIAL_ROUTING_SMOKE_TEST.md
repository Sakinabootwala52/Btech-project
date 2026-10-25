# Initial Routing Smoke Test (single run)

Environment: this build container, Python benchmark implementation, synthetic 16-node / 30-edge Pune-like demo graph. This is a smoke test, not a statistically robust performance study and not a real-road dataset.

- Origin–destination cases: 4
- A* and Dijkstra travel-time costs matched on all 4 cases: **yes**
- Mean expanded nodes: Dijkstra 10.25; A* 6.50
- Mean node-expansion reduction for A*: 36.07%
- One-run mean execution time: Dijkstra 0.0127 ms; A* 0.0170 ms

Interpretation: A* expanded fewer nodes in this sample, but the graph is so small that measured runtime was slower for A* in this single run. Do not claim an overall runtime speedup from this result. Repeat many times, use median/dispersion, and test a larger documented road graph before making a performance claim.
