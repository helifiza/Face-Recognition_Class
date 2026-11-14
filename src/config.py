"""Backend environment configuration."""
import os
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"
STUDENT_IMG_DIR = DATA_DIR / "raw" / "students"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://attendance:attendance@localhost:5432/attendance")
SIM_THRESHOLD = float(os.getenv("SIM_THRESHOLD", "0.75"))
INSIGHTFACE_MODEL = "buffalo_l"
EMBEDDING_DIM = 512
USE_GPU = False
DET_SIZE = (640, 640)
YOLO_FACE_WEIGHTS = MODELS_DIR / "yolov5n-face.pt"
YOLO_FACE_ONNX = MODELS_DIR / "yolov5n-face.onnx"
ARCFACE_ONNX = MODELS_DIR / "buffalo_l" / "w600k_r50.onnx"
