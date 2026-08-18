from pathlib import Path
import os
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8n.pt")
TRACKER = os.getenv("YOLO_TRACKER", "bytetrack.yaml")
DETECTION_CONF = float(os.getenv("DETECTION_CONF", "0.25"))

# Accident confidence threshold. This is NOT accuracy.
ACCIDENT_THRESHOLD = float(os.getenv("ACCIDENT_THRESHOLD", "0.75"))

BUFFER_SECONDS = float(os.getenv("BUFFER_SECONDS", "10"))
CLIP_SECONDS = float(os.getenv("CLIP_SECONDS", "5"))

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", str(ROOT / "outputs")))
CLIP_DIR = OUTPUT_DIR / "clips"
ANNOTATED_DIR = OUTPUT_DIR / "annotated"

VEHICLE_CLASS_IDS = {2, 3, 5, 7}

# Accident evidence parameters.
SUDDEN_SPEED_DROP_RATIO = float(os.getenv("SUDDEN_SPEED_DROP_RATIO", "0.55"))
DIRECTION_CHANGE_DEGREES = float(os.getenv("DIRECTION_CHANGE_DEGREES", "55"))
MIN_ABNORMAL_FRAMES = int(os.getenv("MIN_ABNORMAL_FRAMES", "8"))
MIN_TRACK_HISTORY = int(os.getenv("MIN_TRACK_HISTORY", "6"))
MIN_STOP_SPEED_RATIO = float(os.getenv("MIN_STOP_SPEED_RATIO", "0.20"))
COLLISION_IOU_THRESHOLD = float(os.getenv("COLLISION_IOU_THRESHOLD", "0.15"))

# Severity parameters. Relative/image-space speed is used unless camera
# calibration is available. Never present it as km/h by default.
LOW_SEVERITY_SCORE = float(os.getenv("LOW_SEVERITY_SCORE", "0.35"))
MEDIUM_SEVERITY_SCORE = float(os.getenv("MEDIUM_SEVERITY_SCORE", "0.60"))

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:5000")
POST_TO_BACKEND = os.getenv("POST_TO_BACKEND", "false").lower() == "true"
