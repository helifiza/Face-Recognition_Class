import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, request, ApiError, errorMessage } from '../js/api.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('student edits encode the id and send only the supplied changes', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/students/SV%20%231');
    assert.equal(options.method, 'PATCH');
    assert.deepEqual(JSON.parse(options.body), { email: null, status: 'INACTIVE' });
    return json({ student_id: 'SV #1', status: 'INACTIVE' });
  };
  assert.equal((await api.updateStudent('SV #1', { email: null, status: 'INACTIVE' })).status, 'INACTIVE');
});

test('student deletion handles an empty response and explains protected history', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/students/SV%20%231');
    assert.equal(options.method, 'DELETE');
    assert.equal(options.body, undefined);
    return new Response(null, { status: 204 });
  };
  assert.equal(await api.deleteStudent('SV #1'), null);
  globalThis.fetch = async () => json({ detail: 'Student has attendance or alert history; set status to INACTIVE instead' }, 409);
  await assert.rejects(api.deleteStudent('SV #1'), error => error.status === 409 && error.message.includes('Ngừng hoạt động'));
});

test('student listing loads beyond the first page', async () => {
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    return json(url.includes('offset=0') ? Array.from({ length: 500 }, (_, id) => ({ student_id: id })) : [{ student_id: 500 }]);
  };
  assert.equal((await api.students()).length, 501);
  assert.deepEqual(urls, ['/students?limit=500&offset=0', '/students?limit=500&offset=500']);
});

test('face upload uses multipart video and keeps the browser-generated boundary', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/students/SV%20%231/face');
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, {});
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('video').name, 'capture.webm');
    assert.equal(await options.body.get('video').text(), 'video-data');
    return json({ embedding_id: 1 }, 201);
  };
  assert.equal((await api.registerFace('SV #1', new File(['video-data'], 'capture.webm'))).embedding_id, 1);
});

test('closed-session conflicts retain status and are never retried', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ detail: 'Session must be OPEN' }, 409); };
  await assert.rejects(api.recognize(2, new File(['x'], 'face.mp4')), error => error instanceof ApiError && error.status === 409 && error.message.includes('mở buổi học'));
  assert.equal(calls, 1);
});

test('liveness validation preserves structured failure metrics', async () => {
  const detail = { status: 'FAKE', snr_db: -2, bpm: 80 };
  globalThis.fetch = async () => json({ detail }, 422);
  await assert.rejects(request('/test'), error => error.status === 422 && error.detail.snr_db === -2 && error.message.includes('Tín hiệu'));
  assert.match(errorMessage([{ loc: ['body', 'end_time'], msg: 'Invalid time' }]), /end_time: Invalid time/);
});

test('timeout and invalid HTTP responses show actionable errors', async () => {
  globalThis.fetch = async () => new Response('<html>Error</html>', { status: 502 });
  await assert.rejects(request('/test'), /HTTP 502/);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  await assert.rejects(request('/test', { timeout: 5 }), /hết thời gian chờ/);
});
