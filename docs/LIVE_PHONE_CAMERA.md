# Live demo with a phone camera

The Live page can use a phone camera (Android or iPhone) or a laptop webcam instead of a sample clip. YOLO watches the camera continuously, the **Live view** panel shows what it sees (green boxes; red with an **ACCIDENT DETECTED** banner when a crash is flagged), and a detected crash creates an incident on the hospital desk exactly as a sample clip does.

Works on Windows and macOS. The phone and the laptop only need to be on the same network.

## 1. Start the camera on the phone

| Phone | App (free) | Address to type on the Live page |
|---|---|---|
| Android | **IP Webcam** (Pavel Khlebovich) → *Start server* | `http://PHONE_IP:8080/video` |
| Android or iPhone | **DroidCam** | `http://PHONE_IP:4747/video` |
| iPhone + Mac only | **Continuity Camera** (built in, no app) | `1` (sometimes `0` or `2`) |
| Laptop webcam | — | `0` |

`PHONE_IP` is shown on the phone screen when the app is running (for example `192.168.43.1` or `172.20.10.1`). Use the address the app shows if it differs.

Continuity Camera: on the iPhone, Settings → General → AirPlay & Continuity → **Continuity Camera** on; same Apple ID on both, Wi-Fi and Bluetooth on, iPhone locked and held landscape. On macOS, allow camera access for Terminal (System Settings → Privacy & Security → Camera).

## 2. Keep it private

- Connect the laptop to the **phone's hotspot**, so no one else is on that network (college Wi-Fi often blocks phone-to-laptop connections anyway).
- In IP Webcam, set a username and password (Connection settings → Login/password) and use `http://user:pass@PHONE_IP:8080/video`.
- Stop the server in the app when the demo is over.
- DroidCam (free) accepts one viewer at a time, so do not open the camera address in a browser while the stream is running.

## 3. Check the camera before the demo

```bash
cd ml
# Windows: .venv\Scripts\activate   or   venv\Scripts\activate
# macOS:   source venv/bin/activate
python test_camera.py http://PHONE_IP:8080/video
```

It prints the resolution and frame rate, saves `ml/camera_test.jpg` and says how many vehicles YOLO found in it. Put the toy cars in view first. If it finds none, see section 6.

## 4. Run the live demo

1. Start MongoDB, the backend and the frontend as usual. To start clean, reset the incidents and run `python seed.py`.
2. Log in as **live** (`live` / `1234`).
3. Pick the camera ID (for example `CAM_001`; the incident is placed at that camera's location).
4. In **CCTV source**, choose **Live phone camera / webcam** and type the address from step 1.
5. Click **Start CCTV Stream**. The Live view appears after a few seconds.
6. Crash the cars. The banner turns red, the status shows the detection, and the incident appears on every hospital's emergency desk.
7. Continue as normal: a hospital accepts and dispatches, and the ambulance page drives the trip.
8. Click **Stop Stream** when done.

## 5. Setting up the toy-car scene

- Realistic die-cast cars (Hot Wheels, Maisto; 1:24 to 1:32 is best), two different colours.
- Plain, non-patterned surface with a tape road or a crossing; bright, even light.
- Phone fixed on a stand, landscape, 30–45° from the side and 60–100 cm away, like a CCTV camera. Not straight down.
- Push or release the cars from outside the frame so hands stay out of view. A T-bone at the crossing works best: a sudden stop plus overlap is what the detector looks for.
- Also show a normal pass with no crash: no alert should appear.

## 6. If it does not detect

Add these to `ml/.env`, then stop and start the stream again:

```
DETECTION_CONF=0.15        # find small or toy-like cars (default 0.25)
ACCIDENT_THRESHOLD=0.65    # flag the crash more easily (default 0.75)
```

Lower one step at a time and recheck the normal pass, so the demo does not raise false alarms. Say openly that the values were tuned for toy scale.

| Problem | Fix |
|---|---|
| "Could not open stream source" | The app is not running, the address is wrong, or the phone and laptop are on different networks. Run `test_camera.py` with the same address. |
| Live view never appears | Check `backend/uploads/videos/streams/<stream id>.log` for the worker error. |
| Picture lags behind | Lower the resolution in the camera app (640×480 is enough) and close other apps. |
| The stream stops by itself | The phone locked, or the app went to the background. Keep it awake and plugged in. The worker waits about 5 seconds for the camera to come back. |
| ML Python not found | Create the ML environment in `ml/.venv` or `ml/venv`, or set `ML_PYTHON` in `backend/.env`. |
