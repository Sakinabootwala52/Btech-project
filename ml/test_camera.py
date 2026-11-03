"""Check a camera before the live demo.

Opens a webcam number or a phone camera URL, measures the frame rate,
saves a snapshot and runs YOLO on it to show whether the vehicles
(for example toy cars) are being detected.

Examples:
    python test_camera.py 0
    python test_camera.py 1
    python test_camera.py http://192.168.1.5:8080/video        (IP Webcam, Android)
    python test_camera.py http://192.168.1.5:4747/video        (DroidCam, Android or iPhone)
    python test_camera.py http://user:pass@192.168.1.5:8080/video
"""
import sys
import time

import cv2

from config import DETECTION_CONF
from config import VEHICLE_CLASS_IDS
from detector import VehicleDetector


def open_source(value):
    source = int(value) if value.isdigit() else value
    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        sys.exit(
            f"Could not open {value}. Check the number or URL, that the camera app is running, "
            "and that the phone and laptop are on the same Wi-Fi or hotspot."
        )
    return cap


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)

    value = sys.argv[1].strip()
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

    cap = open_source(value)
    frames, frame, started = 0, None, time.time()

    while time.time() - started < seconds:
        ok, current = cap.read()
        if not ok:
            time.sleep(0.05)
            continue
        frame = current
        frames += 1

    cap.release()

    if frame is None:
        sys.exit("The camera opened but sent no frames. Restart the camera app and try again.")

    elapsed = time.time() - started
    height, width = frame.shape[:2]
    print(f"Camera OK: {width}x{height}, about {frames / elapsed:.1f} frames per second")

    cv2.imwrite("camera_test.jpg", frame)
    print("Snapshot saved as ml/camera_test.jpg")

    detections = VehicleDetector().track_frame(frame)
    print(f"Vehicles detected in the snapshot: {len(detections)} (DETECTION_CONF={DETECTION_CONF})")
    for det in detections:
        print(f"  class {det['class_id']} confidence {det['confidence']:.2f}")

    if not detections:
        print(
            "No vehicles found. Put the cars in view, add light, use a plain background, "
            "or lower DETECTION_CONF in ml/.env (for example 0.15)."
        )
    print(f"(vehicle classes counted: {sorted(VEHICLE_CLASS_IDS)})")


if __name__ == "__main__":
    main()
