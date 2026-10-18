import os
from pathlib import Path
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

class Config:
    MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
    MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "accident_response")
    UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(BASE_DIR / "uploads" / "videos"))
    ACCIDENT_THRESHOLD = float(os.getenv("ACCIDENT_THRESHOLD", "0.75"))
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "1234")
    LIVE_USERNAME = os.getenv("LIVE_USERNAME", "live")
    LIVE_PASSWORD = os.getenv("LIVE_PASSWORD", "1234")
    AMBULANCE_USERNAME = os.getenv("AMBULANCE_USERNAME", "ambulance")
    AMBULANCE_PASSWORD = os.getenv("AMBULANCE_PASSWORD", "1234")
    ML_PYTHON = os.getenv("ML_PYTHON", "")
    ML_MAIN = os.getenv("ML_MAIN", "")
    ML_TIMEOUT_SECONDS = int(os.getenv("ML_TIMEOUT_SECONDS", "900"))
