# ML v2 — Accident Detection + Severity Estimation

The ML pipeline now separates two decisions:

1. Accident detection:
   - YOLO vehicle detection
   - ByteTrack tracking
   - speed/motion anomaly
   - trajectory anomaly
   - vehicle interaction
   - temporal persistence
   - evidence fusion

2. Potential severity:
   - relative motion change
   - vehicle interaction
   - post-event slowdown

IMPORTANT:
- Relative speed is image-space motion, not km/h.
- Severity is triage support, not injury/medical diagnosis.
- A hospital/user reviews the evidence clip before deciding response.

Run:

```bash
python main.py --video ..\sample_videos\clip_01.mp4 --camera-id CAM_001
```

Expected output now includes:

```text
Accident confidence: ...
Severity: HIGH (0.71)
Severity basis: relative_motion_change, vehicle_interaction
```

Do not expect the old outputs to remain identical. The stricter temporal logic is intended to reduce false positives from ordinary braking/turning.

After testing all labeled clips, use the results to tune thresholds rather than blindly raising ACCIDENT_THRESHOLD.
