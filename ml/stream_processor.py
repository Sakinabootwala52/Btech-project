from pathlib import Path
import time
import cv2

from accident_detector import AccidentDetector
from buffer import RollingVideoBuffer
from config import BUFFER_SECONDS, CLIP_DIR, CLIP_SECONDS
from detector import VehicleDetector
from tracker import TrackHistory


class StreamProcessor:
    """
    Simulated CCTV / real-time stream processor.

    For now, a video file acts as the camera source.
    Later, the same processor can be connected to:
        - webcam
        - RTSP CCTV stream
        - IP camera
    """

    def __init__(
        self,
        detector=None,
        accident_detector=None,
        camera_id="CAM_001",
        inference_stride=2,
    ):
        self.detector = detector or VehicleDetector()
        self.accident_detector = (
            accident_detector or AccidentDetector()
        )
        self.camera_id = camera_id
        self.inference_stride = max(1, inference_stride)

        self.history = TrackHistory()
        self.last_detections = []
        self.last_evidence = {
            "accident_detected": False,
            "confidence": 0.0,
            "severity": {
                "level": "none",
                "score": 0,
                "basis": [],
            },
        }

    def process_stream(self, source):
        """
        Process a live-like source continuously.

        `source` can currently be:
            - a local video path
            - a webcam index such as 0

        Future:
            - RTSP URL
            - IP camera URL
        """

        cap = cv2.VideoCapture(source)

        if not cap.isOpened():
            raise ValueError(
                f"Could not open stream source: {source}"
            )

        fps = cap.get(cv2.CAP_PROP_FPS)

        if not fps or fps <= 0:
            fps = 25.0

        buffer = RollingVideoBuffer(
            BUFFER_SECONDS,
            fps,
        )

        frame_index = 0
        start_time = time.perf_counter()

        print("\n================================")
        print("      STREAM PROCESSING START")
        print("================================")
        print(f"Camera ID : {self.camera_id}")
        print(f"FPS       : {fps:.2f}")
        print(
            f"Inference stride : "
            f"{self.inference_stride}"
        )
        print("Press Q to stop.")
        print("================================\n")

        try:
            while True:

                ok, frame = cap.read()

                if not ok:
                    print(
                        "\nStream ended / frame unavailable."
                    )
                    break

                timestamp = frame_index / fps

                # Keep recent frames continuously.
                buffer.add(
                    frame_index,
                    timestamp,
                    frame,
                )

                # --------------------------------------------------
                # EXPENSIVE ML OPERATION
                # --------------------------------------------------

                should_infer = (
                    frame_index
                    % self.inference_stride
                    == 0
                )

                if should_infer:

                    detections = (
                        self.detector.track_frame(
                            frame
                        )
                    )

                    inference_fps = (
                        fps / self.inference_stride
                    )

                    features = self.history.update(
                        detections,
                        inference_fps,
                    )

                    evidence = (
                        self.accident_detector.score(
                            detections,
                            features,
                            self.history,
                        )
                    )

                    self.last_detections = detections
                    self.last_evidence = evidence

                else:

                    # Reuse most recent result.
                    detections = self.last_detections
                    evidence = self.last_evidence

                # --------------------------------------------------
                # DISPLAY
                # --------------------------------------------------

                display = frame.copy()

                self._draw(
                    display,
                    detections,
                    evidence,
                )

                cv2.imshow(
                    "CCTV Stream",
                    display,
                )

                # --------------------------------------------------
                # ACCIDENT EVENT
                # --------------------------------------------------

                if (
                    should_infer
                    and evidence["accident_detected"]
                ):
                    event_time = timestamp

                    print("\n🚨 ACCIDENT DETECTED")
                    print(
                        f"Camera     : "
                        f"{self.camera_id}"
                    )
                    print(
                        f"Time       : "
                        f"{event_time:.2f}s"
                    )
                    print(
                        f"Confidence : "
                        f"{evidence['confidence']}"
                    )
                    print(
                        f"Severity   : "
                        f"{evidence['severity']['level']}"
                    )

                    self._save_event_clip(
                        buffer,
                        event_time,
                        fps,
                        frame.shape[1],
                        frame.shape[0],
                    )

                frame_index += 1

                key = cv2.waitKey(1) & 0xFF

                if key == ord("q"):
                    print("\nStream stopped.")
                    break

        finally:

            cap.release()
            cv2.destroyAllWindows()

        elapsed = time.perf_counter() - start_time

        print("\n================================")
        print("       STREAM PROCESSING END")
        print("================================")
        print(
            f"Frames read : "
            f"{frame_index}"
        )
        print(
            f"Elapsed     : "
            f"{elapsed:.2f} sec"
        )

        if elapsed > 0:
            print(
                f"Read FPS    : "
                f"{frame_index / elapsed:.2f}"
            )

    def _save_event_clip(
        self,
        buffer,
        event_time,
        fps,
        width,
        height,
    ):
        """
        Save evidence surrounding an accident.
        """

        CLIP_DIR.mkdir(
            parents=True,
            exist_ok=True,
        )

        selected = buffer.around_event(
            event_time,
            CLIP_SECONDS,
        )

        if not selected:
            return None

        clip_path = (
            CLIP_DIR
            / (
                f"{self.camera_id}_"
                f"event_"
                f"{int(event_time * 1000)}.mp4"
            )
        )

        writer = cv2.VideoWriter(
            str(clip_path),
            cv2.VideoWriter_fourcc(
                *"mp4v"
            ),
            fps,
            (width, height),
        )

        for item in selected:
            writer.write(item.frame)

        writer.release()

        print(
            f"Evidence clip saved: "
            f"{clip_path}"
        )

        return clip_path

    @staticmethod
    def _draw(
        frame,
        detections,
        evidence,
    ):
        for det in detections:

            x1, y1, x2, y2 = map(
                int,
                det["bbox"],
            )

            cv2.rectangle(
                frame,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2,
            )

            cv2.putText(
                frame,
                f"ID {det['track_id']}",
                (x1, max(20, y1 - 8)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 0),
                2,
            )

        if evidence["accident_detected"]:

            text = (
                f"ACCIDENT "
                f"{evidence['confidence']:.2f} | "
                f"{evidence['severity']['level']}"
            )

            color = (0, 0, 255)
            thickness = 2

        else:

            text = (
                f"Monitoring | "
                f"{evidence['confidence']:.2f}"
            )

            color = (255, 255, 255)
            thickness = 1

        cv2.putText(
            frame,
            text,
            (20, 35),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.75,
            color,
            thickness,
        )