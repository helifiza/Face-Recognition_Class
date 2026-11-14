"""ArcFace vector storage, separated from relational data in the vectors schema."""
import numpy as np
from pgvector.psycopg import register_vector
from .config import EMBEDDING_DIM, INSIGHTFACE_MODEL
from .database import get_conn

SCHEMA = """
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS vectors;
CREATE TABLE IF NOT EXISTS vectors.face_embeddings (
    embedding_id BIGSERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES entities.students(student_id) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    model_name TEXT NOT NULL DEFAULT 'buffalo_l',
    bpm DOUBLE PRECISION,
    snr_db DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_embedding_student ON vectors.face_embeddings(student_id);
CREATE INDEX IF NOT EXISTS idx_embedding_cosine ON vectors.face_embeddings
USING hnsw (embedding vector_cosine_ops);
"""


def normalize(vector):
    value = np.asarray(vector, dtype=np.float32)
    if value.shape != (EMBEDDING_DIM,) or not np.isfinite(value).all():
        raise ValueError("Embedding must contain 512 finite values")
    norm = float(np.linalg.norm(value.astype(np.float64)))
    if norm <= 1e-12:
        raise ValueError("Zero embedding is not valid")
    return (value / norm).astype(np.float32)


def cosine_similarity(left, right):
    return float(np.clip(np.dot(normalize(left), normalize(right)), -1, 1))


def init_vector_db():
    with get_conn() as conn:
        conn.execute(SCHEMA)


def add_embedding(student_id, vector, bpm=None, snr_db=None):
    with get_conn() as conn:
        register_vector(conn)
        return conn.execute("""INSERT INTO vectors.face_embeddings
            (student_id, embedding, model_name, bpm, snr_db) VALUES (%s,%s,%s,%s,%s)
            RETURNING embedding_id, student_id, created_at""",
            (student_id, normalize(vector), INSIGHTFACE_MODEL, bpm, snr_db)).fetchone()


def search(conn, vector, limit=5):
    register_vector(conn)
    value = normalize(vector)
    return conn.execute("""SELECT s.student_id, s.full_name, v.embedding_id,
        1 - (v.embedding <=> %s) AS similarity
        FROM vectors.face_embeddings v JOIN entities.students s USING (student_id)
        WHERE s.status='ACTIVE' AND v.model_name=%s
        ORDER BY v.embedding <=> %s LIMIT %s""",
        (value, INSIGHTFACE_MODEL, value, limit)).fetchall()
