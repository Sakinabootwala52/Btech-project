from ultralytics import YOLO
from config import MODEL_PATH, DETECTION_CONF, TRACKER, VEHICLE_CLASS_IDS

class VehicleDetector:
    def __init__(self, model_path=MODEL_PATH):
        self.model = YOLO(model_path)

    def track_frame(self, frame):
        """
        Run YOLO detection + ByteTrack on one frame.

        persist=True is required because consecutive frames belong to
        the same video stream.
        """
        results = self.model.track(
            frame,
            persist=True,
            tracker=TRACKER,
            conf=DETECTION_CONF,
            verbose=False,
        )

        if not results:
            return []

        result = results[0]
        if result.boxes is None or len(result.boxes) == 0:
            return []

        boxes = result.boxes
        ids = boxes.id.int().cpu().tolist() if boxes.id is not None else []
        classes = boxes.cls.int().cpu().tolist()
        confidences = boxes.conf.float().cpu().tolist()
        xyxy = boxes.xyxy.cpu().tolist()

        detections = []

        for index, bbox in enumerate(xyxy):
            cls_id = classes[index]
            if cls_id not in VEHICLE_CLASS_IDS:
                continue

            track_id = ids[index] if index < len(ids) else None
            x1, y1, x2, y2 = bbox

            detections.append({
                "track_id": track_id,
                "class_id": cls_id,
                "confidence": confidences[index],
                "bbox": [x1, y1, x2, y2],
                "center": [(x1 + x2) / 2, (y1 + y2) / 2],
                "width": x2 - x1,
                "height": y2 - y1,
            },)

        return detections
