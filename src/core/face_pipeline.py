"""CPU inference using decoded YOLOv5-Face ONNX and ArcFace ONNX models."""
from functools import lru_cache
from threading import Lock
import cv2
import numpy as np
import onnxruntime as ort
from ..config import YOLO_FACE_ONNX, ARCFACE_ONNX
from ..vector_database import normalize
from .rppg_liveness import PulseGate, skin_rgb


class FacePipeline:
    def __init__(self):
        for path in (YOLO_FACE_ONNX, ARCFACE_ONNX):
            if not path.is_file():
                raise RuntimeError(f"Missing model: {path.name}; see README.md")
        self.detector = ort.InferenceSession(str(YOLO_FACE_ONNX), providers=["CPUExecutionProvider"])
        self.recognizer = ort.InferenceSession(str(ARCFACE_ONNX), providers=["CPUExecutionProvider"])
        self.lock = Lock()

    def detect(self, frame):
        h, w = frame.shape[:2]
        scale = min(640/w, 640/h)
        nw, nh = round(w*scale), round(h*scale)
        left, top = (640-nw)//2, (640-nh)//2
        canvas = np.full((640, 640, 3), 114, dtype=np.uint8)
        canvas[top:top+nh, left:left+nw] = cv2.resize(frame, (nw, nh))
        blob = canvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32)/255
        output = self.detector.run(None, {self.detector.get_inputs()[0].name: blob})[0]
        if output.ndim != 3 or output.shape[0] != 1 or output.shape[2] != 16:
            raise RuntimeError("YOLO ONNX must return decoded [1,N,16] face predictions")
        rows = output[0]
        scores = rows[:, 4]*rows[:, 15]
        rows, scores = rows[scores >= 0.5], scores[scores >= 0.5]
        if not len(rows):
            return []
        boxes = rows[:, :4].copy()
        boxes[:, :2] -= boxes[:, 2:]/2
        indices = np.asarray(cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), 0.5, 0.45)).reshape(-1)
        faces = []
        for index in indices:
            box = boxes[index].copy()
            box[2:] += box[:2]
            box = (box - np.array([left, top, left, top])) / scale
            landmarks = (rows[index, 5:15].reshape(5, 2)-[left, top])/scale
            faces.append((box, landmarks))
        return faces

    def embed(self, frame, landmarks):
        from insightface.utils.face_align import norm_crop
        aligned = norm_crop(frame, landmark=landmarks.astype(np.float32), image_size=112)
        blob = cv2.dnn.blobFromImage(aligned, 1/127.5, (112, 112), (127.5,)*3, swapRB=True)
        vector = self.recognizer.run(None, {self.recognizer.get_inputs()[0].name: blob})[0]
        return normalize(vector.reshape(-1))

    def process_video(self, path):
        # Independent gate for every request; inference lock bounds concurrent model work.
        with self.lock:
            capture = cv2.VideoCapture(str(path))
            try:
                fps = capture.get(cv2.CAP_PROP_FPS)
                if not capture.isOpened() or not np.isfinite(fps) or not 29 <= fps <= 31:
                    raise ValueError("Supply a constant-frame-rate 30 FPS video")
                gate, previous = PulseGate(fps=fps), None
                result = dict(gate.result)
                last = None
                for index in range(301):
                    ok, frame = capture.read()
                    if not ok:
                        break
                    if index == 300:
                        raise ValueError("Video must be at most 300 frames")
                    if frame.shape[:2] != (480, 640):
                        raise ValueError("Video frames must be 640x480")
                    faces = self.detect(frame)
                    if len(faces) != 1:
                        raise ValueError("Exactly one continuous face is required")
                    box, landmarks = faces[0]
                    if previous is not None:
                        lo, hi = np.maximum(box[:2], previous[:2]), np.minimum(box[2:], previous[2:])
                        intersection = np.maximum(hi-lo, 0).prod()
                        union = (box[2:]-box[:2]).prod()+(previous[2:]-previous[:2]).prod()-intersection
                        if union <= 0 or intersection/union < 0.5:
                            raise ValueError("Face track changed; record a new clip")
                    result = gate.update(skin_rgb(frame, box), index/fps)
                    previous, last = box, (frame, landmarks)
                if result["status"] != "REAL" or last is None:
                    return result, None
                # No ArcFace computation before the physiological gate passes.
                return result, self.embed(*last)
            finally:
                capture.release()


@lru_cache(maxsize=1)
def get_pipeline():
    return FacePipeline()
