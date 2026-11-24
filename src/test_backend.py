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
    def test_unknown_skips_liveness_and_writes(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        pulse = MagicMock()
        analyze.return_value = (pulse, np.ones(512))
        for matches in ([], [{'student_id': 's', 'similarity': 0.1}]):
            with self.subTest(matches=matches):
                conn.reset_mock()
                conn.execute.return_value.fetchone.return_value = session
                search.return_value = matches
                result = recognize(1, MagicMock())
                self.assertEqual(result['status'], 'UNKNOWN')
                self.assertEqual(result['liveness'], {'status': 'NOT_CHECKED', 'bpm': None, 'snr_db': None})
                self.assertNotIn('match', result)
                pulse.check_liveness.assert_not_called()
                self.assertTrue(all(call.args[0].startswith('SELECT') for call in conn.execute.call_args_list))

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_match_precedes_liveness_and_failed_gate_never_records(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        match = {'student_id': 's', 'similarity': 0.9}
        for status in ('COLLECTING', 'FAKE'):
            with self.subTest(status=status):
                conn.reset_mock()
                conn.execute.return_value.fetchone.side_effect = [session, session, {'exists': 1}]
                events = []
                search.side_effect = lambda *_: events.append('match') or [match]
                quality = {'status': status, 'bpm': 72., 'snr_db': 0.1}
                pulse = MagicMock()
                pulse.check_liveness.side_effect = lambda: events.append('liveness') or quality
                analyze.side_effect = lambda *args, **kwargs: events.append('embedding') or (pulse, np.ones(512))
                upload = MagicMock()
                with self.assertLogs('uvicorn.error', level='INFO') as logs:
                    result = recognize(1, upload)
                analyze.assert_called_with(upload, recognition_first=True)
                self.assertEqual(events, ['embedding', 'match', 'liveness'])
                self.assertEqual(result, {'status': status, 'match': match, 'liveness': quality})
                statements = [call.args[0] for call in conn.execute.call_args_list]
                self.assertFalse(any('INSERT INTO attendance_logs' in sql for sql in statements))
                alerts = [call for call in conn.execute.call_args_list if 'INSERT INTO spoofing_alerts' in call.args[0]]
                self.assertEqual(len(alerts), int(status == 'FAKE'))
                if alerts:
                    self.assertEqual(alerts[0].args[1], (1, 's', quality['snr_db']))
                output = '\n'.join(logs.output)
                self.assertLess(output.index('event=MATCH'), output.index('event=CHECK_LIVENESS'))
                self.assertLess(output.index('event=LIVENESS'), output.index('event=RESULT'))

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_closed_during_analysis_and_unenrolled_skip_liveness(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        pulse = MagicMock()
        analyze.return_value = (pulse, np.ones(512))
        search.return_value = [{'student_id': 's', 'similarity': 0.9}]
        for rows in ([session, {'status': 'CLOSED'}], [session, session, None]):
            with self.subTest(rows=rows):
                conn.reset_mock()
                conn.execute.return_value.fetchone.side_effect = rows
                with self.assertRaises(HTTPException) as error:
                    recognize(1, MagicMock())
                self.assertEqual(error.exception.status_code, 409)
                pulse.check_liveness.assert_not_called()
                self.assertTrue(all(call.args[0].startswith('SELECT') for call in conn.execute.call_args_list))

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_deferred_liveness_errors_keep_http_status_and_do_not_record(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        pulse = MagicMock()
        analyze.return_value = (pulse, np.ones(512))
        search.return_value = [{'student_id': 's', 'similarity': 0.9}]
        for exception, status in ((ValueError('Invalid RGB'), 422), (RuntimeError('Unavailable'), 503)):
            with self.subTest(status=status):
                conn.reset_mock()
                conn.execute.return_value.fetchone.side_effect = [session, session, {'exists': 1}]
                pulse.check_liveness.side_effect = exception
                with self.assertRaises(HTTPException) as error:
                    recognize(1, MagicMock())
                self.assertEqual(error.exception.status_code, status)
                self.assertTrue(all(call.args[0].startswith('SELECT') for call in conn.execute.call_args_list))

    @patch('src.video_api.search')
    @patch('src.video_api.get_conn')
    @patch('src.video_api.analyze')
    def test_duplicate_attendance_returns_existing(self, analyze, connection, search):
        from .video_api import recognize
        conn = connection.return_value.__enter__.return_value
        session = {'status': 'OPEN', 'course_id': 'c'}
        conn.execute.return_value.fetchone.side_effect = [session, session, {'exists': 1}, None, {'log_id': 42}]
        pulse = MagicMock()
        pulse.check_liveness.return_value = {'status': 'REAL'}
        analyze.return_value = (pulse, np.ones(512))
        search.return_value = [{'student_id': 's', 'similarity': 0.9}]
        result = recognize(1, MagicMock())
        self.assertEqual(result['status'], 'ALREADY_PRESENT')
        self.assertEqual(result['attendance']['log_id'], 42)
        pulse.check_liveness.assert_called_once()


if __name__ == '__main__':
    unittest.main()
