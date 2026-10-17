import argparse
import json
from datetime import datetime, timezone, timedelta

from config import POST_TO_BACKEND
from video_processor import process_video

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--camera-id", default="CAM_001")
    parser.add_argument("--no-annotated", action="store_true")
    parser.add_argument("--max-frames", type=int, default=None)
    parser.add_argument("--json-out", default=None)
    args = parser.parse_args()

    result = process_video(
        args.video,
        camera_id=args.camera_id,
        save_annotated=not args.no_annotated,
        max_frames=args.max_frames,
    )

    print("\n=== ML RESULT ===")
    print(f"Camera: {result['camera_id']}")
    print(f"Accident detected: {result['accident_detected']}")
    print(f"Events: {len(result['events'])}")
    print(f"Processing FPS: {result['metrics']['processing_fps']}")

    for index, event in enumerate(result["events"], start=1):
        timestamp = (
            datetime.now(timezone.utc)
            + timedelta(seconds=event["timestamp_seconds"])
        ).isoformat()

        event["timestamp"] = timestamp

        severity = event["severity"]

        print(f"\n--- Event {index} ---")
        print(f"Accident confidence: {event['confidence']}")
        print(f"Speed before (relative): {event['speed_before']}")
        print(f"Speed after (relative): {event['speed_after']}")
        print(f"Severity: {severity['level']} ({severity['score']})")
        print(f"Severity basis: {', '.join(severity['basis'])}")
        print(f"Video clip: {event['video_clip']}")

    if args.json_out:
        out_path = __import__("pathlib").Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")

        if POST_TO_BACKEND:
            from backend_client import BackendClient
            print("Backend response:", BackendClient().send_accident_event(event))

if __name__ == "__main__":
    main()
