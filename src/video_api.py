"""Video-based enrollment and attendance; liveness is computed on the server."""
from pathlib import Path
from tempfile import NamedTemporaryFile
from fastapi import APIRouter, File, HTTPException, UploadFile
from .config import SIM_THRESHOLD
from .database import get_conn
from .vector_database import add_embedding, search
from .core.face_pipeline import get_pipeline

router = APIRouter()


def analyze(upload):
    path = None
    try:
        with NamedTemporaryFile(suffix=".mp4", delete=False) as temporary:
            path = Path(temporary.name)
            total = 0
            while chunk := upload.file.read(1024*1024):
                total += len(chunk)
                if total > 20*1024*1024:
                    raise HTTPException(413, "Video exceeds 20 MB")
                temporary.write(chunk)
        return get_pipeline().process_video(path)
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
    with get_conn() as conn:
        session = conn.execute("SELECT * FROM class_sessions WHERE session_id=%s", (session_id,)).fetchone()
        if not session:
            raise HTTPException(404, "Session not found")
        if session["status"] != "OPEN":
            raise HTTPException(409, "Session must be OPEN")
    quality, vector = analyze(video)
    if vector is None:
        if quality["status"] == "FAKE":
            with get_conn() as conn:
                conn.execute("""INSERT INTO spoofing_alerts (session_id,spoof_type,spoof_score)
                    VALUES (%s,'LOW_PULSE_QUALITY',%s)""", (session_id, quality["snr_db"]))
        return {"status": quality["status"], "liveness": quality}
    with get_conn() as conn:
        # Lock the session until commit so it cannot close during attendance insertion.
        session = conn.execute("SELECT * FROM class_sessions WHERE session_id=%s FOR UPDATE",
                               (session_id,)).fetchone()
        if not session or session["status"] != "OPEN":
            raise HTTPException(409, "Session is no longer OPEN")
        matches = search(conn, vector, 1)
        if not matches or matches[0]["similarity"] < SIM_THRESHOLD:
            return {"status": "UNKNOWN", "liveness": quality}
        match = matches[0]
        if not conn.execute("SELECT 1 FROM enrollments WHERE student_id=%s AND course_id=%s",
                            (match["student_id"], session["course_id"])).fetchone():
            raise HTTPException(409, "Student is not enrolled in this course")
        row = conn.execute("""INSERT INTO attendance_logs (session_id,student_id,similarity)
            VALUES (%s,%s,%s) ON CONFLICT (session_id,student_id) DO NOTHING RETURNING *""",
            (session_id, match["student_id"], match["similarity"])).fetchone()
        created = row is not None
        if not created:
            row = conn.execute("SELECT * FROM attendance_logs WHERE session_id=%s AND student_id=%s",
                               (session_id, match["student_id"])).fetchone()
        return {"status": "PRESENT" if created else "ALREADY_PRESENT", "attendance": row,
                "match": match, "liveness": quality}
