"""Video-based enrollment and attendance; liveness is computed on the server."""
import logging
from pathlib import Path
from tempfile import NamedTemporaryFile
from time import perf_counter
from uuid import uuid4
from fastapi import APIRouter, File, HTTPException, UploadFile
from .config import SIM_THRESHOLD
from .database import get_conn
from .vector_database import add_embedding, search
from .core.face_pipeline import get_pipeline

router = APIRouter()
# Reuse Uvicorn's configured handler so INFO events appear in Docker logs.
logger = logging.getLogger("uvicorn.error")


def analyze(upload, *, recognition_first=False):
    path = None
    try:
        suffix = Path(upload.filename or "video.mp4").suffix.lower()
        if suffix not in {".mp4", ".webm", ".mov"}:
            suffix = ".mp4"
        with NamedTemporaryFile(suffix=suffix, delete=False) as temporary:
            path = Path(temporary.name)
            total = 0
            while chunk := upload.file.read(1024*1024):
                total += len(chunk)
                if total > 20*1024*1024:
                    raise HTTPException(413, "Video exceeds 20 MB")
                temporary.write(chunk)
        pipeline = get_pipeline()
        if recognition_first:
            return pipeline.prepare_recognition(path)
        return pipeline.process_video(path)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    finally:
        if path is not None:
            path.unlink(missing_ok=True)
        upload.file.close()


@router.post("/students/{student_id}/face", status_code=201)
def register_face(student_id: str, video: UploadFile = File(...)):
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM students WHERE student_id=%s AND status='ACTIVE'",
                            (student_id,)).fetchone():
            raise HTTPException(404, "Active student not found")
    quality, vector = analyze(video)
    if vector is None:
        raise HTTPException(422, quality)
    return {**add_embedding(student_id, vector, quality["bpm"], quality["snr_db"]), "liveness": quality}


@router.post("/sessions/{session_id}/recognize")
def recognize(session_id: int, video: UploadFile = File(...)):
    context = f"[ATTENDANCE] request_id={uuid4().hex[:12]} | session_id={session_id}"
    started = perf_counter()
    logger.info("%s | event=START", context)
    try:
        result = _recognize(session_id, video, context)
    except HTTPException as exc:
        logger.warning(
            "%s | event=REJECTED | http_status=%s | reason=%r | elapsed_s=%.3f",
            context, exc.status_code, exc.detail, perf_counter() - started,
        )
        raise
    except Exception:
        logger.exception("%s | event=ERROR | elapsed_s=%.3f", context, perf_counter() - started)
        raise
    # _recognize has exited its database contexts, including the commit.
    logger.info("%s | event=RESULT | status=%s | elapsed_s=%.3f",
                context, result["status"], perf_counter() - started)
    return result


def _recognize(session_id, video, log_context):
    with get_conn() as conn:
        session = conn.execute("SELECT * FROM class_sessions WHERE session_id=%s", (session_id,)).fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        if session["status"] != "OPEN":
            raise HTTPException(409, "Session must be OPEN")
    logger.info("%s | event=ANALYZE_VIDEO", log_context)
    pulse, vector = analyze(video, recognition_first=True)
    with get_conn() as conn:
        # Lock the session until commit so it cannot close during attendance insertion.
        session = conn.execute("SELECT * FROM class_sessions WHERE session_id=%s FOR UPDATE",
                               (session_id,)).fetchone()
        if not session or session["status"] != "OPEN":
            raise HTTPException(409, "Session is no longer OPEN")
        matches = search(conn, vector, 1)
        logger.info("%s | event=MATCH | student_id=%r | similarity=%s | threshold=%.4f",
                    log_context, matches[0]["student_id"] if matches else None,
                    f"{matches[0]['similarity']:.4f}" if matches else "N/A", SIM_THRESHOLD)
        if not matches or matches[0]["similarity"] < SIM_THRESHOLD:
            logger.info("%s | event=SKIP_LIVENESS | reason=%s", log_context,
                        "NO_MATCH" if not matches else "SIMILARITY_BELOW_THRESHOLD")
            return {"status": "UNKNOWN",
                    "liveness": {"status": "NOT_CHECKED", "bpm": None, "snr_db": None}}
        match = matches[0]
        if not conn.execute("SELECT 1 FROM enrollments WHERE student_id=%s AND course_id=%s",
                            (match["student_id"], session["course_id"])).fetchone():
            raise HTTPException(409, "Student is not enrolled in this course")
        logger.info("%s | event=CHECK_LIVENESS", log_context)
        try:
            quality = pulse.check_liveness()
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from exc
        snr, bpm = quality.get("snr_db"), quality.get("bpm")
        logger.info("%s | event=LIVENESS | status=%s | SNR=%s dB | BPM=%s",
                    log_context, quality["status"],
                    f"{snr:.2f}" if snr is not None else "N/A",
                    f"{bpm:.1f}" if bpm is not None else "N/A")
        if quality["status"] != "REAL":
            logger.info("%s | event=SKIP_ATTENDANCE | reason=LIVENESS_NOT_REAL", log_context)
            if quality["status"] == "FAKE":
                conn.execute("""INSERT INTO spoofing_alerts (session_id,student_id,spoof_type,spoof_score)
                    VALUES (%s,%s,'LOW_PULSE_QUALITY',%s)""",
                    (session_id, match["student_id"], quality["snr_db"]))
            return {"status": quality["status"], "match": match, "liveness": quality}
        row = conn.execute("""INSERT INTO attendance_logs (session_id,student_id,similarity)
            VALUES (%s,%s,%s) ON CONFLICT (session_id,student_id) DO NOTHING RETURNING *""",
            (session_id, match["student_id"], match["similarity"])).fetchone()
        created = row is not None
        if not created:
            row = conn.execute("SELECT * FROM attendance_logs WHERE session_id=%s AND student_id=%s",
                               (session_id, match["student_id"])).fetchone()
        return {"status": "PRESENT" if created else "ALREADY_PRESENT", "attendance": row,
                "match": match, "liveness": quality}
