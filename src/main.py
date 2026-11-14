"""Local development API: python -m uvicorn src.main:app --reload."""
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
import psycopg
from .database import get_conn, init_db
from .vector_database import init_vector_db, search
from .schemas import Student, Course, Enrollment, ClassSession, SessionStatus, VectorQuery


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


@app.post("/students", status_code=201)
def create_student(body: Student):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO students
            (student_id,full_name,class_name,faculty,email) VALUES (%s,%s,%s,%s,%s)
            RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/students")
def students(limit: int = Query(100, ge=1, le=500), offset: int = Query(0, ge=0)):
    with get_conn() as conn:
        return conn.execute("SELECT * FROM students ORDER BY student_id LIMIT %s OFFSET %s",
                            (limit, offset)).fetchall()


@app.post("/courses", status_code=201)
def create_course(body: Course):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO courses (course_id,course_name,lecturer)
            VALUES (%s,%s,%s) RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/courses")
def courses():
    with get_conn() as conn:
        return conn.execute("SELECT * FROM courses ORDER BY course_id LIMIT 500").fetchall()


@app.post("/enrollments", status_code=201)
def enroll(body: Enrollment):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO enrollments (student_id,course_id)
            VALUES (%s,%s) RETURNING *""", (body.student_id, body.course_id)).fetchone()


@app.post("/sessions", status_code=201)
def create_session(body: ClassSession):
    with get_conn() as conn:
        return conn.execute("""INSERT INTO class_sessions
            (course_id,session_date,start_time,end_time,room) VALUES (%s,%s,%s,%s,%s)
            RETURNING *""", tuple(body.model_dump().values())).fetchone()


@app.get("/sessions")
def sessions():
    with get_conn() as conn:
        return conn.execute("SELECT * FROM class_sessions ORDER BY session_id DESC LIMIT 500").fetchall()


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
        return conn.execute("""SELECT a.*, s.full_name FROM attendance_logs a
            JOIN students s USING (student_id) WHERE session_id=%s ORDER BY check_time""",
            (session_id,)).fetchall()


from .video_api import router
app.include_router(router)
