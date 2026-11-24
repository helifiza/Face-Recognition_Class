"""UI/API checks; ATTENDANCE_TEST_DB=1 enables a transaction-rolled-back DB flow."""
from contextlib import contextmanager, ExitStack
import os
from pathlib import Path
from threading import Lock
import unittest
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient
import numpy as np
import psycopg
from psycopg.rows import dict_row

from .config import DATABASE_URL
from .main import app


class PortalTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_portal_redirect_and_all_browser_modules(self):
        self.assertEqual(self.client.get('/', follow_redirects=False).headers['location'], '/ui/')
        response = self.client.get('/ui/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('type="module"', response.text)
        directory = Path(__file__).parent / 'face-recognition-attendance-ui'
        for path in [directory / 'app.js', *directory.glob('js/**/*.js'), *directory.glob('css/*.css')]:
            with self.subTest(path=path.name):
                response = self.client.get('/ui/' + path.relative_to(directory).as_posix())
                self.assertEqual(response.status_code, 200)
                self.assertIn('javascript' if path.suffix == '.js' else 'text/css', response.headers['content-type'])
        self.assertEqual(self.client.get('/docs').status_code, 200)

    def test_public_config_does_not_expose_database_credentials(self):
        config = self.client.get('/config').json()
        self.assertEqual(config['video_fps'], 30)
        self.assertEqual(config['video_width'], 640)
        self.assertNotIn('DATABASE_URL', config)

    def test_pagination_validation(self):
        for endpoint in ('students', 'courses', 'enrollments', 'sessions'):
            for query in ('limit=501', 'limit=0', 'offset=-1'):
                with self.subTest(endpoint=endpoint, query=query):
                    self.assertEqual(self.client.get(f'/{endpoint}?{query}').status_code, 422)

    @patch('src.main.get_conn')
    def test_missing_session_is_not_an_empty_attendance_report(self, connection):
        connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
        self.assertEqual(self.client.get('/sessions/999/attendance').status_code, 404)

    @patch('src.main.get_conn')
    def test_student_update_rejects_invalid_and_immutable_fields(self, connection):
        for body in ({}, {'student_id': 'new-id'}, {'full_name': None},
                     {'full_name': '   '}, {'status': None}, {'status': 'DELETED'},
                     {'email': 'x' * 255}, {'face_registered': True}):
            with self.subTest(body=body):
                self.assertEqual(self.client.patch('/students/test', json=body).status_code, 422)
        connection.assert_not_called()

    @patch('src.main.get_conn')
    def test_missing_student_cannot_be_updated_or_deleted(self, connection):
        connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = None
        self.assertEqual(self.client.patch('/students/missing', json={'status': 'INACTIVE'}).status_code, 404)
        self.assertEqual(self.client.delete('/students/missing').status_code, 404)

    @patch('src.video_api.get_pipeline')
    def test_browser_webm_upload_is_passed_to_pipeline_and_cleaned_up(self, pipeline):
        from .video_api import analyze
        from starlette.datastructures import UploadFile
        from io import BytesIO
        observed = []

        def process(path):
            observed.append(path)
            self.assertEqual(path.suffix, '.webm')
            self.assertEqual(path.read_bytes(), b'webm-content')
            return {'status': 'COLLECTING'}, None

        for recognition_first in (False, True):
            with self.subTest(recognition_first=recognition_first):
                pipeline.reset_mock()
                method = pipeline.return_value.prepare_recognition if recognition_first else pipeline.return_value.process_video
                method.side_effect = process
                upload = UploadFile(filename='capture.webm', file=BytesIO(b'webm-content'))
                self.assertEqual(analyze(upload, recognition_first=recognition_first)[0]['status'], 'COLLECTING')
                self.assertFalse(observed[-1].exists())
                self.assertTrue(upload.file.closed)
                method.assert_called_once()
                other = pipeline.return_value.process_video if recognition_first else pipeline.return_value.prepare_recognition
                other.assert_not_called()


class BrowserVideoTests(unittest.TestCase):
    def pipeline(self, timestamps):
        from .core.face_pipeline import FacePipeline
        pipeline = FacePipeline.__new__(FacePipeline)
        pipeline.lock = Lock()
        pipeline.detect = MagicMock(return_value=[(np.array([100, 100, 250, 300]), np.zeros((5, 2)))])
        pipeline.embed = MagicMock()
        capture = MagicMock()
        capture.isOpened.return_value = True
        frame = np.full((480, 640, 3), [80, 100, 120], dtype=np.uint8)
        capture.read.side_effect = [(True, frame)] * len(timestamps) + [(False, None)]
        capture.get.side_effect = [1000.0] + [time * 1000 for time in timestamps]
        return pipeline, capture

    def test_attendance_embedding_is_available_before_pulse_is_evaluated(self):
        from .core.rppg_liveness import PulseGate
        timestamps = [index / 30 for index in range(180)]
        pipeline, capture = self.pipeline(timestamps)
        vector = np.ones(512)
        pipeline.embed.return_value = vector
        with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture), \
                patch('src.core.face_pipeline.PulseGate', wraps=PulseGate) as gate:
            pulse, actual = pipeline.prepare_recognition('browser.webm')
            self.assertIs(actual, vector)
            pipeline.embed.assert_called_once()
            capture.release.assert_called_once()
            gate.assert_not_called()
            self.assertEqual(len(pulse.samples), len(timestamps))
            # SNR is computed only when the caller explicitly checks the matched face.
            self.assertEqual(pulse.check_liveness()['status'], 'FAKE')
            gate.assert_called_once_with(fps=30.0)

    def test_attendance_rejects_video_without_frames_before_embedding(self):
        pipeline, capture = self.pipeline([])
        with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture):
            with self.assertRaisesRegex(ValueError, 'at least one frame'):
                pipeline.prepare_recognition('browser.webm')
        pipeline.embed.assert_not_called()
        capture.release.assert_called_once()

    def test_webm_uses_frame_timestamps_instead_of_1000_fps_metadata(self):
        timestamps = [index / 30 for index in range(180)]
        pipeline, capture = self.pipeline(timestamps)
        with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture):
            quality, vector = pipeline.process_video('browser.webm')
        self.assertEqual(quality['status'], 'FAKE')  # Flat colors still fail liveness.
        self.assertIsNone(vector)
        pipeline.embed.assert_not_called()
        capture.release.assert_called_once()

    def test_gap_in_browser_video_resets_liveness(self):
        timestamps = [index / 30 for index in range(180)] + [8 + index / 30 for index in range(15)]
        pipeline, capture = self.pipeline(timestamps)
        with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture):
            quality, vector = pipeline.process_video('browser.webm')
        self.assertEqual(quality['status'], 'COLLECTING')
        self.assertIsNone(vector)

    def test_webm_timestamp_jitter_keeps_the_measured_average_cadence(self):
        timestamps = np.cumsum([0.0] + [.03, .03, .03, .043333333] * 45).tolist()
        pipeline, capture = self.pipeline(timestamps)
        with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture):
            quality, vector = pipeline.process_video('browser.webm')
        self.assertEqual(quality['status'], 'FAKE')
        self.assertIsNone(vector)

    def test_invalid_webm_timing_is_rejected(self):
        for timestamps, message in [([0, 0], 'increasing'), ([0, 11], '10 seconds'),
                                    ([index / 20 for index in range(30)], '30 FPS')]:
            for method in ('process_video', 'prepare_recognition'):
                with self.subTest(message=message, method=method):
                    pipeline, capture = self.pipeline(timestamps)
                    with patch('src.core.face_pipeline.cv2.VideoCapture', return_value=capture):
                        with self.assertRaisesRegex(ValueError, message):
                            getattr(pipeline, method)('browser.webm')
                    pipeline.embed.assert_not_called()
                    capture.release.assert_called_once()


@unittest.skipUnless(os.getenv('ATTENDANCE_TEST_DB') == '1', 'Set ATTENDANCE_TEST_DB=1 for a PostgreSQL integration check')
class DatabaseFlowTests(unittest.TestCase):
    def test_student_edit_delete_cascades_and_history_protection(self):
        from .database import init_db
        from .vector_database import init_vector_db, add_embedding, search
        init_db()
        init_vector_db()
        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        connection.execute('SET LOCAL search_path TO entities, public')

        @contextmanager
        def isolated_connection():
            with connection.transaction():
                yield connection

        marker = 'student-test-' + uuid4().hex
        client = TestClient(app)
        try:
            with ExitStack() as stack:
                for module in ('src.main', 'src.vector_database'):
                    stack.enter_context(patch(f'{module}.get_conn', isolated_connection))
                self.assertEqual(client.post('/students', json={
                    'student_id': marker, 'full_name': 'Original name', 'email': 'old@example.com',
                    'class_name': 'Class A', 'faculty': 'Faculty A',
                }).status_code, 201)
                self.assertEqual(client.post('/courses', json={'course_id': marker, 'course_name': 'Test course'}).status_code, 201)
                self.assertEqual(client.post('/enrollments', json={'student_id': marker, 'course_id': marker}).status_code, 201)
                add_embedding(marker, np.ones(512))
                connection.execute("INSERT INTO student_face_images (student_id,image_path) VALUES (%s,%s)", (marker, 'test-only-path'))
                session = client.post('/sessions', json={'course_id': marker, 'session_date': '2026-11-24', 'start_time': '08:00', 'end_time': '09:00'}).json()
                session_id = session['session_id']
                log = connection.execute("""INSERT INTO attendance_logs (session_id,student_id,similarity)
                    VALUES (%s,%s,0.95) RETURNING log_id""", (session_id, marker)).fetchone()

                # History prevents deletion, even after deactivation; all links remain.
                self.assertEqual(client.delete(f'/students/{marker}').status_code, 409)
                response = client.patch(f'/students/{marker}', json={'full_name': '  Updated name  ', 'email': None, 'status': 'INACTIVE'})
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['full_name'], 'Updated name')
                self.assertEqual(response.json()['class_name'], 'Class A')
                self.assertEqual(response.json()['faculty'], 'Faculty A')
                self.assertIsNone(response.json()['email'])
                self.assertEqual(client.delete(f'/students/{marker}').status_code, 409)
                records = client.get(f'/sessions/{session_id}/attendance').json()
                self.assertEqual(records[0]['log_id'], log['log_id'])
                self.assertEqual(records[0]['full_name'], 'Updated name')
                self.assertFalse(any(row['student_id'] == marker for row in search(connection, np.ones(512), 100)))
                self.assertEqual(client.patch(f'/students/{marker}', json={'status': 'ACTIVE'}).status_code, 200)

                # Alert history also protects a student without attendance history.
                connection.execute('DELETE FROM attendance_logs WHERE student_id=%s', (marker,))
                connection.execute("INSERT INTO spoofing_alerts (student_id,spoof_type) VALUES (%s,'TEST')", (marker,))
                self.assertEqual(client.delete(f'/students/{marker}').status_code, 409)
                for table in ('enrollments', 'student_face_images', 'vectors.face_embeddings'):
                    self.assertIsNotNone(connection.execute(f'SELECT 1 FROM {table} WHERE student_id=%s', (marker,)).fetchone())

                # Only this test's own fixtures are removed; the outer transaction rolls back.
                connection.execute('DELETE FROM spoofing_alerts WHERE student_id=%s', (marker,))
                response = client.delete(f'/students/{marker}')
                self.assertEqual(response.status_code, 204, response.text)
                self.assertEqual(response.content, b'')
                for table in ('students', 'enrollments', 'student_face_images', 'vectors.face_embeddings'):
                    self.assertIsNone(connection.execute(f'SELECT 1 FROM {table} WHERE student_id=%s', (marker,)).fetchone())
                self.assertIsNotNone(connection.execute('SELECT 1 FROM class_sessions WHERE session_id=%s', (session_id,)).fetchone())
                self.assertEqual(client.delete(f'/students/{marker}').status_code, 404)
                self.assertEqual(client.patch(f'/students/{marker}', json={'status': 'INACTIVE'}).status_code, 404)
        finally:
            connection.rollback()
            connection.close()

    def test_student_course_face_session_and_duplicate_attendance(self):
        from .database import init_db
        from .vector_database import init_vector_db
        init_db()
        init_vector_db()
        connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
        connection.execute('SET LOCAL search_path TO entities, public')

        @contextmanager
        def isolated_connection():
            # Each request gets a savepoint on one outer transaction. Even error
            # responses can be exercised without committing test records.
            with connection.transaction():
                yield connection

        marker = 'ui-test-' + uuid4().hex
        client = TestClient(app)
        try:
            with ExitStack() as stack:
                for module in ('src.main', 'src.video_api', 'src.vector_database'):
                    stack.enter_context(patch(f'{module}.get_conn', isolated_connection))
                response = client.post('/students', json={'student_id': marker, 'full_name': 'UI integration test'})
                self.assertEqual(response.status_code, 201, response.text)
                self.assertEqual(client.post('/students', json={'student_id': marker, 'full_name': 'Duplicate'}).status_code, 409)
                self.assertEqual(client.post('/courses', json={'course_id': marker, 'course_name': 'UI course'}).status_code, 201)
                self.assertEqual(client.post('/enrollments', json={'student_id': marker, 'course_id': marker}).status_code, 201)
                self.assertEqual(len(client.get('/enrollments', params={'course_id': marker}).json()), 1)
                response = client.post('/sessions', json={'course_id': marker, 'session_date': '2026-11-21', 'start_time': '08:00', 'end_time': '09:00'})
                self.assertEqual(response.status_code, 201, response.text)
                session_id = response.json()['session_id']
                analyze = stack.enter_context(patch('src.video_api.analyze', return_value=({'status': 'REAL', 'bpm': 72, 'snr_db': 8}, np.ones(512))))
                video = {'video': ('face.webm', b'fixture-video', 'video/webm')}
                self.assertEqual(client.post(f'/students/{marker}/face', files=video).status_code, 201)
                students = client.get('/students?limit=500').json()
                # Use a direct lookup if a user's database already has >500 rows.
                self.assertTrue(connection.execute('SELECT 1 FROM vectors.face_embeddings WHERE student_id=%s', (marker,)).fetchone())
                for student in students:
                    if student['student_id'] == marker:
                        self.assertTrue(student['face_registered'])
                before = analyze.call_count
                self.assertEqual(client.post(f'/sessions/{session_id}/recognize', files=video).status_code, 409)
                self.assertEqual(analyze.call_count, before)
                self.assertEqual(client.patch(f'/sessions/{session_id}/status', json={'status': 'OPEN'}).status_code, 200)
                pulse = MagicMock()
                analyze.return_value = (pulse, np.ones(512))
                # Deterministic match while still exercising real SQL writes and
                # enrollment/duplicate checks; no real biometric fixture required.
                search = stack.enter_context(patch('src.video_api.search', return_value=[]))
                unknown = client.post(f'/sessions/{session_id}/recognize', files=video)
                self.assertEqual(unknown.status_code, 200, unknown.text)
                self.assertEqual(unknown.json()['status'], 'UNKNOWN')
                self.assertEqual(unknown.json()['liveness'], {'status': 'NOT_CHECKED', 'bpm': None, 'snr_db': None})
                pulse.check_liveness.assert_not_called()
                search.return_value = [{'student_id': marker, 'full_name': 'UI integration test', 'similarity': .95}]
                for status in ('COLLECTING', 'FAKE'):
                    pulse.check_liveness.return_value = {'status': status, 'bpm': 72, 'snr_db': 0.1}
                    rejected = client.post(f'/sessions/{session_id}/recognize', files=video)
                    self.assertEqual(rejected.status_code, 200, rejected.text)
                    self.assertEqual(rejected.json()['status'], status)
                    self.assertEqual(rejected.json()['match']['student_id'], marker)
                    self.assertEqual(client.get(f'/sessions/{session_id}/attendance').json(), [])
                alert = connection.execute('SELECT student_id,spoof_score FROM spoofing_alerts WHERE session_id=%s', (session_id,)).fetchone()
                self.assertEqual(alert['student_id'], marker)
                self.assertAlmostEqual(alert['spoof_score'], .1)
                pulse.check_liveness.return_value = {'status': 'REAL', 'bpm': 72, 'snr_db': 8}
                self.assertEqual(client.post(f'/sessions/{session_id}/recognize', files=video).json()['status'], 'PRESENT')
                self.assertEqual(client.post(f'/sessions/{session_id}/recognize', files=video).json()['status'], 'ALREADY_PRESENT')
                self.assertEqual(len(client.get(f'/sessions/{session_id}/attendance').json()), 1)
                session = next(row for row in client.get('/sessions').json() if row['session_id'] == session_id)
                self.assertEqual(session['attendance_count'], 1)
                self.assertEqual(session['enrolled_count'], 1)
                self.assertEqual(client.patch(f'/sessions/{session_id}/status', json={'status': 'CLOSED'}).status_code, 200)
                self.assertEqual(client.post(f'/sessions/{session_id}/recognize', files=video).status_code, 409)
        finally:
            connection.rollback()
            connection.close()


if __name__ == '__main__':
    unittest.main()
