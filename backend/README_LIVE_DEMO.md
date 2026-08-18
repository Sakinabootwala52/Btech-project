# Live feed demo

## Login

- Live operator: `live / 1234`
- Hospital: hospital name / `1234`
- Admin: `admin / 1234`

## Folder layout

The demo assumes:

```text
be/
├── backend/
├── frontend/
└── ml/
    └── venv/
```

Set in `backend/.env`:

```env
ML_PYTHON=..\ml\venv\Scripts\python.exe
ML_MAIN=..\ml\main.py
ML_TIMEOUT_SECONDS=900
```

The live operator uploads a video to `POST /api/live/upload`. The backend runs the ML entry point, reads its JSON result, copies any generated accident clip into backend uploads, and creates a PENDING incident. Every eligible hospital then sees the incident on its dashboard and the first hospital to accept claims it atomically.

The ML `main.py` must support:

```bash
python main.py --video <path> --camera-id CAM_001 --no-annotated --json-out <result.json>
```

The v4 ML folder includes this change.

## Demo flow

1. Start MongoDB.
2. Start backend: `python app.py`.
3. Start frontend: `npm run dev`.
4. Login as `live / 1234`.
5. Upload `clip_01.mp4` with `CAM_001`.
6. Wait for ML processing to finish.
7. Open two hospital sessions in separate browsers/incognito windows.
8. Both should see the new pending incident and its video.
9. Click `ACCEPT FIRST` from one hospital.
10. Refresh/allow the 3-second polling: the other hospital loses the pending incident.

## Hosting note

WordPress can host/embed the frontend, but WordPress itself should not be expected to run the Flask API, MongoDB, YOLO/ByteTrack process, or Python ML dependencies. For a real hosted deployment, keep WordPress as the public website/container and deploy the React frontend, Flask backend, MongoDB, and ML worker on infrastructure that can run those services.
