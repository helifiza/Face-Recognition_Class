"""Relational data for classroom attendance, stored in the entities schema."""
from contextlib import contextmanager
import psycopg
from psycopg.rows import dict_row
from .config import DATABASE_URL

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS entities;
SET LOCAL search_path TO entities, public;
CREATE TABLE IF NOT EXISTS students (
    student_id  TEXT PRIMARY KEY,                 -- MSSV
    full_name   TEXT NOT NULL,
    class_name  TEXT,                              -- lớp sinh hoạt
    faculty     TEXT,
    email       TEXT,
    status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
    course_id   TEXT PRIMARY KEY,                  -- mã học phần
    course_name TEXT NOT NULL,
    lecturer    TEXT
);

CREATE TABLE IF NOT EXISTS enrollments (
    student_id  TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    course_id   TEXT NOT NULL REFERENCES courses(course_id)  ON DELETE CASCADE,
    PRIMARY KEY (student_id, course_id)
);

CREATE TABLE IF NOT EXISTS class_sessions (
    session_id   BIGSERIAL PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(course_id),
    session_date DATE NOT NULL,                    -- YYYY-MM-DD
    start_time   TIME NOT NULL,                    -- HH:MM
    end_time     TIME NOT NULL CHECK (end_time > start_time),
    room         TEXT,
    status       TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'OPEN', 'CLOSED')) -- SCHEDULED / OPEN / CLOSED
);

CREATE TABLE IF NOT EXISTS student_face_images (
    image_id    BIGSERIAL PRIMARY KEY,
    student_id  TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    image_path  TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (student_id, image_path)
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    log_id      BIGSERIAL PRIMARY KEY,
    session_id  BIGINT NOT NULL REFERENCES class_sessions(session_id),
    student_id  TEXT NOT NULL REFERENCES students(student_id),
    check_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
    status      TEXT NOT NULL DEFAULT 'PRESENT',   -- PRESENT / LATE
    similarity  REAL,
    camera_id   TEXT,
    UNIQUE (session_id, student_id)                -- mỗi SV điểm danh 1 lần / buổi
);

CREATE TABLE IF NOT EXISTS spoofing_alerts (
    alert_id      BIGSERIAL PRIMARY KEY,
    session_id    BIGINT REFERENCES class_sessions(session_id),
    student_id    TEXT REFERENCES students(student_id),  -- NULL nếu không nhận ra ai
    spoof_type    TEXT,
    spoof_score   REAL,
    evidence_path TEXT,
    detected_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_att_session ON attendance_logs(session_id);

"""


@contextmanager
def get_conn():
    with psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=5) as conn:
        conn.execute("SET LOCAL search_path TO entities, public")
        yield conn


def init_db():
    with get_conn() as conn:
        conn.execute(SCHEMA)
