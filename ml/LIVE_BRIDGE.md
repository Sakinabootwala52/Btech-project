# Live bridge

`main.py` now supports:

```bash
python main.py --video ..\sample_videos\clip_01.mp4 --camera-id CAM_001 --no-annotated --json-out result.json
```

The JSON file contains the normal ML result plus events. The backend live endpoint reads this JSON and publishes each generated accident clip as an incident.

Keep `POST_TO_BACKEND=false` in ML `.env` for the live bridge. The backend is responsible for publishing the events so the incident is not created twice.
