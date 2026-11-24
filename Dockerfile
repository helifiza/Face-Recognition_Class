FROM python:3.11-slim-trixie
WORKDIR /app
# InsightFace depends on opencv-python, which needs these shared libraries even
# when the application only processes videos without opening GUI windows.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libgomp1 libxcb1 libgl1 libglib2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt && python -m pip check
COPY src ./src
# Check startup imports without connecting to the database or loading models.
RUN python -c "from src.main import app; from insightface.utils.face_align import norm_crop"
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
