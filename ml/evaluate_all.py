from pathlib import Path
import csv
import json
import subprocess
import time

from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
)


PROJECT_ROOT = Path(__file__).resolve().parent.parent

VIDEO_DIR = PROJECT_ROOT / "sample_videos"
ML_DIR = PROJECT_ROOT / "ml"

PYTHON = ML_DIR / "venv" / "Scripts" / "python.exe"
MAIN = ML_DIR / "main.py"

OUTPUT_CSV = ML_DIR / "evaluation_results.csv"


# ============================================================
# GROUND TRUTH
# 1 = accident
# 0 = non-accident
# ============================================================

GROUND_TRUTH = {
    "clip_01.mp4": 1,
    "clip_02.mp4": 1,
    "clip_03.mp4": 1,
    "clip_04.mp4": 1,
    "clip_05.mp4": 1,
    "clip_06.mp4": 1,
    "clip_07.mp4": 1,
    "clip_08.mp4": 1,
    "clip_09.mp4": 1,
    "clip_10.mp4": 1,
    "clip_11.mp4": 0,
}


def run_video(video_path):
    """
    Run the ML pipeline and read its structured JSON result.
    """

    json_output = ML_DIR / f"evaluation_{video_path.stem}.json"

    command = [
        str(PYTHON),
        str(MAIN),
        "--video",
        str(video_path),
        "--camera-id",
        "CAM_001",
        "--no-annotated",
        "--json-out",
        str(json_output),
    ]

    start = time.perf_counter()

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
    )

    elapsed = time.perf_counter() - start

    if result.returncode != 0:
        print(f"\nERROR processing {video_path.name}")
        print(result.stderr)

        return {
            "predicted": None,
            "confidence": 0.0,
            "processing_seconds": round(elapsed, 3),
            "events": 0,
        }

    if not json_output.exists():
        print(f"\nERROR: JSON result not created for {video_path.name}")

        return {
            "predicted": None,
            "confidence": 0.0,
            "processing_seconds": round(elapsed, 3),
            "events": 0,
        }

    try:
        data = json.loads(
            json_output.read_text(
                encoding="utf-8"
            )
        )

        events = data.get("events", [])

        predicted = (
            1 if data.get("accident_detected", False)
            else 0
        )

        # Use the strongest detected event confidence.
        confidence = 0.0

        if events:
            confidence = max(
                float(event.get("confidence", 0.0))
                for event in events
            )

        # Prefer the processing time reported by the ML pipeline.
        pipeline_time = data.get("metrics", {}).get(
            "processing_seconds"
        )

        processing_seconds = (
            float(pipeline_time)
            if pipeline_time is not None
            else elapsed
        )

        return {
            "predicted": predicted,
            "confidence": round(confidence, 4),
            "processing_seconds": round(
                processing_seconds,
                3,
            ),
            "events": len(events),
        }

    except (json.JSONDecodeError, ValueError, TypeError) as exc:
        print(
            f"\nERROR reading JSON for "
            f"{video_path.name}: {exc}"
        )

        return {
            "predicted": None,
            "confidence": 0.0,
            "processing_seconds": round(elapsed, 3),
            "events": 0,
        }

    finally:
        # Remove temporary JSON file.
        try:
            json_output.unlink(missing_ok=True)
        except OSError:
            pass


def main():
    videos = sorted(VIDEO_DIR.glob("*.mp4"))

    if not videos:
        print("No videos found.")
        return

    rows = []

    print()
    print("=" * 60)
    print("        ACCIDENT DETECTION EVALUATION")
    print("=" * 60)

    for video in videos:

        print()
        print(f"Processing: {video.name}")

        actual = GROUND_TRUTH.get(video.name)

        if actual is None:
            print("Actual label: NOT SET")
        else:
            print(f"Actual: {actual}")

        result = run_video(video)

        print(f"Predicted: {result['predicted']}")
        print(f"Confidence: {result['confidence']}")
        print(f"Events: {result['events']}")
        print(
            f"Time: "
            f"{result['processing_seconds']:.3f} sec"
        )

        rows.append({
            "video": video.name,
            "actual": actual,
            "predicted": result["predicted"],
            "confidence": result["confidence"],
            "processing_seconds": result[
                "processing_seconds"
            ],
            "events": result["events"],
        })

    # ========================================================
    # CREATE CSV
    # ========================================================

    with open(
        OUTPUT_CSV,
        "w",
        newline="",
        encoding="utf-8",
    ) as f:

        writer = csv.DictWriter(
            f,
            fieldnames=[
                "video",
                "actual",
                "predicted",
                "confidence",
                "processing_seconds",
                "events",
            ],
        )

        writer.writeheader()
        writer.writerows(rows)

    print()
    print("=" * 60)
    print("CSV CREATED")
    print("=" * 60)

    print(OUTPUT_CSV)

    # ========================================================
    # EVALUATION
    # ========================================================

    valid_rows = [
        row
        for row in rows
        if row["actual"] is not None
        and row["predicted"] is not None
    ]

    if not valid_rows:
        print("\nNo valid labeled results available.")
        return

    y_true = [
        int(row["actual"])
        for row in valid_rows
    ]

    y_pred = [
        int(row["predicted"])
        for row in valid_rows
    ]

    accuracy = accuracy_score(
        y_true,
        y_pred,
    )

    precision = precision_score(
        y_true,
        y_pred,
        zero_division=0,
    )

    recall = recall_score(
        y_true,
        y_pred,
        zero_division=0,
    )

    f1 = f1_score(
        y_true,
        y_pred,
        zero_division=0,
    )

    matrix = confusion_matrix(
        y_true,
        y_pred,
        labels=[0, 1],
    )

    true_negative = matrix[0][0]
    false_positive = matrix[0][1]
    false_negative = matrix[1][0]
    true_positive = matrix[1][1]

    average_time = sum(
        row["processing_seconds"]
        for row in valid_rows
    ) / len(valid_rows)

    # ========================================================
    # PRINT FINAL RESULTS
    # ========================================================

    print()
    print("=" * 60)
    print("              EVALUATION RESULTS")
    print("=" * 60)

    print(
        f"Videos evaluated : {len(valid_rows)}"
    )

    print(
        f"Accuracy         : {accuracy:.4f}"
    )

    print(
        f"Precision        : {precision:.4f}"
    )

    print(
        f"Recall           : {recall:.4f}"
    )

    print(
        f"F1-score         : {f1:.4f}"
    )

    print(
        f"True positives   : {true_positive}"
    )

    print(
        f"True negatives   : {true_negative}"
    )

    print(
        f"False positives  : {false_positive}"
    )

    print(
        f"False negatives  : {false_negative}"
    )

    print()
    print("Confusion Matrix:")
    print(matrix)

    print()
    print(
        f"Average processing time: "
        f"{average_time:.3f} sec"
    )


if __name__ == "__main__":
    main()