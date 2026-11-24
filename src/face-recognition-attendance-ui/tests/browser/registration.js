import { registration } from '../../js/views/registration.js';
import { api, ApiError } from '../../js/api.js';
import { state } from '../../js/state.js';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = (value, message) => { if (!value) throw new Error(message); };
const students = [
  { student_id: 'TEST-A', full_name: 'Test Student A', status: 'ACTIVE' },
  { student_id: 'TEST-B', full_name: 'Test Student B', status: 'ACTIVE' },
];
const clip = () => new File(['test video'], 'test.webm', { type: 'video/webm' });

function mount() {
  state.students = students.map(student => ({ ...student }));
  state.config = { record_seconds: 0.05 };
  const root = document.createElement('div');
  document.body.append(root);
  const page = registration(root, () => {});
  const find = selector => root.querySelector(selector);
  return {
    root, page, find,
    select: find('#registration-student'),
    submit: find('#register-face'),
    choose(id) {
      this.select.value = id;
      this.select.dispatchEvent(new Event('change'));
    },
    upload(file = clip()) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const input = find('input[type=file]');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
    },
    destroy() { page.destroy(); root.remove(); },
  };
}

async function waitFor(check) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for recording to finish');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function mockCamera() {
  const originalRecorder = globalThis.MediaRecorder;
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  const originalPlay = HTMLMediaElement.prototype.play;
  const recorders = [];
  globalThis.MediaRecorder = class {
    static isTypeSupported() { return true; }
    constructor(_stream, options) {
      this.mimeType = options.mimeType;
      this.state = 'inactive';
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      if (!this.deferStop) queueMicrotask(() => this.finish());
    }
    finish() {
      this.ondataavailable?.({ data: new Blob(['test recording'], { type: this.mimeType }) });
      this.onstop?.();
    }
  };
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
  HTMLMediaElement.prototype.play = async () => {};
  return {
    recorders,
    restore() {
      globalThis.MediaRecorder = originalRecorder;
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      HTMLMediaElement.prototype.play = originalPlay;
    },
  };
}

test('selecting a student, then uploading a video enables submission', async ui => {
  assert(ui.submit.disabled, 'A blank form must be disabled');
  ui.choose('TEST-A');
  assert(ui.submit.disabled, 'A student without a video must be disabled');
  ui.upload();
  assert(!ui.submit.disabled, 'A selected student and valid upload must enable submission');
  ui.page.refresh();
  assert(!ui.submit.disabled, 'Refreshing unchanged students must preserve the clip');
});

test('uploading a video before the first student selection keeps the video', async ui => {
  ui.upload();
  const preview = ui.find('video').src;
  assert(ui.submit.disabled, 'An upload without a student must be disabled');
  ui.choose('TEST-A');
  assert(!ui.submit.disabled, 'First student selection must enable the uploaded video');
  assert(ui.find('video').src === preview, 'First selection must preserve the preview');
});

test('switching to another student clears the previous student video', async ui => {
  ui.choose('TEST-A');
  ui.upload();
  ui.choose('TEST-B');
  assert(ui.submit.disabled, 'A different student requires a new video');
  assert(!ui.find('video').getAttribute('src'), 'The previous preview must be removed');
  assert(ui.find('#registration-hint')?.textContent.includes('Đã đổi sinh viên'), 'The reset reason must be visible');
  ui.upload();
  assert(!ui.submit.disabled, 'Uploading a new clip must enable the new student');
});

test('an API rejection releases the button and preserves the video for retry', async ui => {
  const original = api.registerFace;
  let rejectRequest;
  api.registerFace = (id, file) => {
    assert(id === 'TEST-A' && file.name === 'test.webm', 'The request must use the selected student and video');
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  };
  try {
    ui.choose('TEST-A');
    ui.upload();
    const request = ui.submit.onclick();
    assert(ui.submit.disabled && ui.select.disabled, 'The form must lock during submission');
    assert(!ui.page.canLeave(), 'Navigation must wait for the request');
    rejectRequest(new ApiError('Test rejection', 422, { status: 'FAKE', bpm: 69.4, snr_db: 0.1 }));
    await request;
    assert(!ui.submit.disabled && !ui.select.disabled, 'A rejected request must unlock retry');
    assert(ui.page.canLeave(), 'Navigation must unlock after rejection');
    assert(ui.find('#registration-result').textContent.includes('Test rejection'), 'The rejection must remain visible');
  } finally { api.registerFace = original; }
});

test('recording before choosing a student enables submission after selection', async ui => {
  await ui.find('[data-camera]').onclick();
  ui.find('[data-record]').click();
  assert(ui.submit.disabled, 'Submission must stay disabled during recording');
  await waitFor(() => ui.find('video').getAttribute('src'));
  ui.choose('TEST-A');
  assert(!ui.submit.disabled, 'First student selection must preserve a completed recording');
});

test('recording with a selected student enables submission when finished', async ui => {
  ui.choose('TEST-A');
  await ui.find('[data-camera]').onclick();
  assert(ui.submit.disabled, 'Opening the camera does not create a clip');
  ui.find('[data-record]').click();
  assert(ui.submit.disabled, 'Recording must disable submission');
  await waitFor(() => !ui.submit.disabled);
  assert(ui.find('video').src.startsWith('blob:'), 'A completed recording must have a preview');
});

test('a recording error explains the missing video and permits another recording', async (ui, camera) => {
  ui.choose('TEST-A');
  await ui.find('[data-camera]').onclick();
  ui.find('[data-record]').click();
  camera.recorders.at(-1).onerror();
  assert(ui.submit.disabled, 'A failed recording must not enable submission');
  assert(ui.find('#registration-hint')?.textContent.includes('Chưa có video'), 'The hint must stop saying recording');
  await ui.find('[data-camera]').onclick();
  ui.find('[data-record]').click();
  await waitFor(() => !ui.submit.disabled);
});

test('a late stop event from an old recording cannot stop the new camera', async (ui, camera) => {
  ui.choose('TEST-A');
  await ui.find('[data-camera]').onclick();
  ui.find('[data-record]').click();
  const oldRecorder = camera.recorders.at(-1);
  oldRecorder.deferStop = true;
  ui.choose('TEST-B');
  await ui.find('[data-camera]').onclick();
  const newStream = ui.find('video').srcObject;
  ui.find('[data-record]').click();
  oldRecorder.finish();
  assert(ui.find('video').srcObject === newStream, 'An outdated stop event must not release the new stream');
  await waitFor(() => !ui.submit.disabled);
});

window.registrationTests = (async () => {
  const results = [];
  for (const { name, run } of tests) {
    const camera = mockCamera();
    const ui = mount();
    try {
      await run(ui, camera);
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.message });
    } finally { ui.destroy(); camera.restore(); }
  }
  document.querySelector('#test-results').textContent = results.map(result =>
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`).join('\n');
  return results;
})();
