"""Run: python -m unittest src.test_backend -v."""
import unittest
from unittest.mock import patch, MagicMock
import numpy as np
from fastapi import HTTPException
from .core.rppg_liveness import PulseGate, skin_rgb
from .vector_database import normalize, cosine_similarity
from .schemas import ClassSession


class SignalTests(unittest.TestCase):
    def test_cosine(self):
        a, b = np.zeros(512), np.zeros(512)
        a[0], b[1] = 1, 1
        self.assertAlmostEqual(cosine_similarity(a, 7*a), 1)
        self.assertAlmostEqual(cosine_similarity(a, b), 0)
        self.assertAlmostEqual(cosine_similarity(a, -a), -1)

    def test_invalid_vectors(self):
        for value in (np.zeros(512), np.ones(511), np.full(512, np.nan), np.full(512, np.inf)):
            with self.assertRaises(ValueError):
                normalize(value)

    def test_flat_signal_never_passes(self):
        gate = PulseGate()
        for index in range(180):
            result = gate.update([120, 100, 80], index/30)
            self.assertNotEqual(result['status'], 'REAL')
        self.assertEqual(result['status'], 'FAKE')

    def test_timing_gap_resets_gate(self):
        gate = PulseGate()
        for index in range(120):
            gate.update([120, 100, 80], index/30)
        self.assertEqual(gate.update([120, 100, 80], 10)['status'], 'COLLECTING')
        self.assertEqual(len(gate.samples), 1)
        with self.assertRaises(ValueError):
            gate.update([120, 100, 80], 10)

    def test_roi_rgb_order(self):
        frame = np.full((480, 640, 3), [10, 20, 30], dtype=np.uint8)
        np.testing.assert_equal(skin_rgb(frame, [100, 100, 200, 250]), [30, 20, 10])

    def test_invalid_session(self):
        with self.assertRaises(ValueError):
            ClassSession(course_id='c', session_date='2026-11-14', start_time='10:00', end_time='09:00')


class AttendanceTests(unittest.TestCase):
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_closed_session_does_not_process_video(self, analyze, connection):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        conn.execute.return_value.fetchone.return_value = {'status': 'CLOSED'}
        with self.assertRaises(HTTPException) as error:
            recognize(1, MagicMock())
        self.assertEqual(error.exception.status_code, 409)
        analyze.assert_not_called()

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_collecting_never_searches_or_records(self, analyze, connection, search):
        from .video_api import recognize
        connection.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = {'status': 'OPEN'}
        analyze.return_value = ({'status': 'COLLECTING'}, None)
        self.assertEqual(recognize(1, MagicMock())['status'], 'COLLECTING')
        search.assert_not_called()

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_duplicate_attendance_returns_existing(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        conn.execute.return_value.fetchone.side_effect = [session, session, {'exists': 1}, None, {'log_id': 42}]
        analyze.return_value = ({'status': 'REAL'}, np.ones(512))
        search.return_value = [{'student_id': 's', 'similarity': 0.9}]
        result = recognize(1, MagicMock())
        self.assertEqual(result['status'], 'ALREADY_PRESENT')
        self.assertEqual(result['attendance']['log_id'], 42)


if __name__ == '__main__':
    unittest.main()
