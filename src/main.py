"""Local development API: python -m uvicorn src.main:app --reload."""
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
import psycopg
from psycopg import sql
from .config import SIM_THRESHOLD
from .database import get_conn, init_db
from .vector_database import init_vector_db, search
from .schemas import Student, StudentUpdate, Course, Enrollment, ClassSession, SessionStatus, VectorQuery


@asynccontextmanager
async def lifespan(app):
    init_db()
    init_vector_db()
    yield


app = FastAPI(title="Classroom Attendance Backend", lifespan=lifespan)


@app.exception_handler(psycopg.IntegrityError)
async def integrity_error(request: Request, exc):
    return JSONResponse(status_code=409, content={"detail": "Duplicate data or invalid relationship"})


@app.exception_handler(psycopg.OperationalError)
async def connection_error(request: Request, exc):
    return JSONResponse(status_code=503, content={"detail": "Database unavailable"})


@app.get("/health")
def health():
    with get_conn() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/config")
def public_config():
    """Only public settings needed by the UI; thresholds remain server-owned."""
    return {"similarity_threshold": SIM_THRESHOLD, "video_max_bytes": 20 * 1024 * 1024,
            "video_width": 640, "video_height": 480, "video_fps": 30,
            "video_max_frames": 300, "record_seconds": 8}


@app.post("/students", status_code=201)
def create_student(body: Student):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO students
            (student_id,full_name,class_name,faculty,email) VALUES (%s,%s,%s,%s,%s)
            RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/students")
def students(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    with get_conn() as conn:
        return conn.execute("""SELECT s.*, EXISTS (
            SELECT 1 FROM vectors.face_embeddings v WHERE v.student_id=s.student_id
        ) AS face_registered FROM students s ORDER BY student_id LIMIT %s OFFSET %s""",
                            (limit, offset)).fetchall()


@app.patch("/students/{student_id}")
def update_student(student_id: str, body: StudentUpdate):
    changes = body.model_dump(exclude_unset=True)
    assignments = sql.SQL(", ").join(
        sql.SQL("{}=%s").format(sql.Identifier(field)) for field in changes
    )
    with get_conn() as conn:
        row = conn.execute(
            sql.SQL("UPDATE students SET {} WHERE student_id=%s RETURNING *").format(assignments),
            (*changes.values(), student_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Student not found")
        return row


@app.delete("/students/{student_id}", status_code=204)
def delete_student(student_id: str):
    with get_conn() as conn:
        # Block concurrent FK inserts while checking history and deleting.
        if not conn.execute("SELECT 1 FROM students WHERE student_id=%s FOR UPDATE",
                            (student_id,)).fetchone():
            raise HTTPException(404, "Student not found")
        history = conn.execute("""SELECT
            EXISTS (SELECT 1 FROM attendance_logs WHERE student_id=%s) OR
            EXISTS (SELECT 1 FROM spoofing_alerts WHERE student_id=%s) AS has_history""",
            (student_id, student_id)).fetchone()
        if history["has_history"]:
            raise HTTPException(409, "Student has attendance or alert history; set status to INACTIVE instead")
        # Existing foreign keys cascade to enrollments, face images and embeddings.
        conn.execute("DELETE FROM students WHERE student_id=%s", (student_id,))
    return Response(status_code=204)


@app.post("/courses", status_code=201)
def create_course(body: Course):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO courses (course_id,course_name,lecturer)
            VALUES (%s,%s,%s) RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/courses")
def courses(limit: int = Query(500, ge=1, le=500), offset: int = Query(0, ge=0)):
    with get_conn() as conn:
        return conn.execute("SELECT * FROM courses ORDER BY course_id LIMIT %s OFFSET %s",
                            (limit, offset)).fetchall()


@app.post("/enrollments", status_code=201)
def enroll(body: Enrollment):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO enrollments (student_id,course_id)
            VALUES (%s,%s) RETURNING *""", (body.student_id, body.course_id)).fetchone()


@app.get("/enrollments")
def enrollments(course_id: str | None = None, limit: int = Query(500, ge=1, le=500),
                offset: int = Query(0, ge=0)):
    with get_conn() as conn:
        return conn.execute("""SELECT * FROM enrollments
            WHERE (%s::text IS NULL OR course_id=%s)
            ORDER BY course_id,student_id LIMIT %s OFFSET %s""",
            (course_id, course_id, limit, offset)).fetchall()


@app.post("/sessions", status_code=201)
def create_session(body: ClassSession):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO class_sessions
            (course_id,session_date,start_time,end_time,room) VALUES (%s,%s,%s,%s,%s)
            RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/sessions")
def sessions(limit: int = Query(500, ge=1, le=500), offset: int = Query(0, ge=0)):
    with get_conn() as conn:
        return conn.execute("""SELECT cs.*, c.course_name,
            (SELECT count(*) FROM attendance_logs a WHERE a.session_id=cs.session_id) AS attendance_count,
            (SELECT count(*) FROM enrollments e WHERE e.course_id=cs.course_id) AS enrolled_count
            FROM class_sessions cs JOIN courses c USING (course_id)
            ORDER BY cs.session_id DESC LIMIT %s OFFSET %s""", (limit, offset)).fetchall()


@app.patch("/sessions/{session_id}/status")
def set_session_status(session_id: int, body: SessionStatus):
    with get_conn() as conn:
        row = conn.execute("UPDATE class_sessions SET status=%s WHERE session_id=%s RETURNING *",
                           (body.status, session_id)).fetchone()
        if not row:
            raise HTTPException(404, "Session not found")
        return row


@app.post("/vectors/search")
def vector_search(body: VectorQuery):
    try:
        with get_conn() as conn:
            return search(conn, body.embedding, body.limit)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.get("/sessions/{session_id}/attendance")
def attendance(session_id: int):
    with get_conn() as conn:
        if not conn.execute("SELECT 1 FROM class_sessions WHERE session_id=%s", (session_id,)).fetchone():
            raise HTTPException(404, "Session not found")
        return conn.execute("""SELECT a.*, s.full_name FROM attendance_logs a
            JOIN students s USING (student_id) WHERE session_id=%s ORDER BY check_time""",
            (session_id,)).fetchall()


from .video_api import router
app.include_router(router)


@app.get("/", include_in_schema=False)
def portal():
    return RedirectResponse("/ui/")


# Keep the UI under its own prefix so API routes and /docs remain unchanged.
app.mount("/ui", StaticFiles(directory=Path(__file__).parent / "face-recognition-attendance-ui",
                             html=True), name="ui")
