import test from 'node:test';
import assert from 'node:assert/strict';
import { csvText, rosterRows, escapeHtml, localDate } from '../js/utils.js';
import { validateVideo } from '../js/camera.js';
import { livenessResult } from '../js/ui.js';

test('unknown face explains skipped liveness without displaying unmeasured SNR', () => {
  const html = livenessResult({ status: 'UNKNOWN', liveness: { status: 'NOT_CHECKED', bpm: null, snr_db: null } });
  assert.ok(html.includes('Không nhận ra sinh viên'));
  assert.ok(html.includes('Chưa kiểm tra tín hiệu mạch vì chưa khớp khuôn mặt'));
  assert.ok(!html.includes('BPM') && !html.includes('dB'));
});

test('a matched face with a failed pulse gate retains its metrics and failure status', () => {
  const html = livenessResult({ status: 'FAKE', liveness: { status: 'FAKE', bpm: 72, snr_db: .1 } });
  assert.ok(html.includes('Tín hiệu chưa đạt'));
  assert.ok(html.includes('72.0 BPM') && html.includes('0.1 dB'));
  assert.ok(!html.includes('Có mặt'));
});

test('reports count only the selected course and mark absent only after closure', () => {
  const students = [{ student_id: 'a', full_name: 'An' }, { student_id: 'b', full_name: 'Bình' }, { student_id: 'c' }];
  const enrollments = [{ student_id: 'a', course_id: 'x' }, { student_id: 'b', course_id: 'x' }, { student_id: 'c', course_id: 'y' }];
  const logs = [{ student_id: 'a', status: 'PRESENT', similarity: 0.91 }];
  const rows = status => rosterRows(students, enrollments, { course_id: 'x', status }, logs);
  assert.deepEqual(rows('OPEN').map(row => row.status), ['PRESENT', 'PENDING']);
  assert.deepEqual(rows('CLOSED').map(row => row.status), ['PRESENT', 'ABSENT']);
  assert.equal(rows('CLOSED')[0].similarity, 0.91);
  assert.equal(rows('CLOSED')[1].similarity, null);
});

test('reports retain recorded students even after the current roster changes', () => {
  const rows = rosterRows([], [], { course_id: 'x', status: 'CLOSED' }, [{ student_id: 'a', full_name: 'An', status: 'PRESENT' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'PRESENT');
});

test('CSV preserves Vietnamese text and quoting and neutralizes formulas', () => {
  const csv = csvText([['Nguyễn, "An"', '=SUM(1,2)', '+123', null, 'line\nbreak']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Nguyễn, ""An"""'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'+123"'));
  assert.ok(csv.endsWith('"line\nbreak"'));
});

test('student strings are escaped before rendering and dates use local calendar', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(localDate(new Date(2026, 0, 2, 0, 0)), '2026-01-02');
});

test('video validation rejects images, empty and oversized files', () => {
  assert.throws(() => validateVideo(new File(['image'], 'face.jpg', { type: 'image/jpeg' })), /Ảnh tĩnh/);
  assert.throws(() => validateVideo(new File([], 'face.mp4')), /nội dung/);
  assert.throws(() => validateVideo({ name: 'face.mp4', size: 20 * 1024 * 1024 + 1 }), /20 MB/);
  assert.doesNotThrow(() => validateVideo(new File(['x'], 'capture.webm', { type: 'video/webm' })));
});
