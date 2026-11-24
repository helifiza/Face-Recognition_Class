import { students } from '../../js/views/students.js';
import { api, ApiError, errorMessage } from '../../js/api.js';
import { state, subscribe } from '../../js/state.js';

const tests = [];
const test = (name, run) => tests.push({ name, run });
const assert = (value, message) => { if (!value) throw new Error(message); };
const clone = value => JSON.parse(JSON.stringify(value));

function mount() {
  let records = [
    { student_id: 'TEST-A', full_name: 'Test Student A', email: 'a@example.com', class_name: 'Class A', faculty: 'Faculty A', status: 'ACTIVE', face_registered: true },
    { student_id: 'TEST-B', full_name: 'Test Student B', status: 'ACTIVE', face_registered: false, has_history: true },
  ];
  const originalApi = { ...api };
  const originalConfirm = window.confirm;
  const calls = [];
  let confirmation = '';
  window.confirm = message => { confirmation = message; return true; };
  Object.assign(api, {
    students: async () => clone(records), courses: async () => [], enrollments: async () => [], sessions: async () => [], config: async () => ({}),
    createStudent: async body => {
      calls.push({ method: 'POST', body });
      const row = { ...body, status: 'ACTIVE', face_registered: false };
      records.push(row);
      return clone(row);
    },
    updateStudent: async (id, body) => {
      calls.push({ method: 'PATCH', id, body });
      const row = records.find(item => item.student_id === id);
      Object.assign(row, body);
      return clone(row);
    },
    deleteStudent: async id => {
      calls.push({ method: 'DELETE', id });
      if (records.find(row => row.student_id === id)?.has_history) {
        const detail = 'Student has attendance or alert history; set status to INACTIVE instead';
        throw new ApiError(errorMessage(detail), 409, detail);
      }
      records = records.filter(row => row.student_id !== id);
      return null;
    },
  });
  Object.assign(state, { students: clone(records), courses: [], enrollments: [], sessions: [], config: {}, loaded: true, loading: false, error: '' });
  document.querySelector('#toast').hidden = true;
  const root = document.createElement('main');
  root.className = 'main-content';
  document.body.append(root);
  const page = students(root, () => {});
  const unsubscribe = subscribe(() => page.refresh());
  const find = selector => root.querySelector(selector);
  return {
    root, page, find, calls,
    field: name => find(`[name="${name}"]`),
    edit: id => find(`[data-edit="${id}"]`).click(),
    remove: id => find(`[data-delete="${id}"]`).click(),
    submit: () => find('#student-form').requestSubmit(),
    confirmation: () => confirmation,
    destroy() { unsubscribe(); root.remove(); Object.assign(api, originalApi); window.confirm = originalConfirm; },
  };
}

async function finished(ui) {
  const deadline = performance.now() + 3000;
  while (!ui.page.canLeave() || state.loading) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for student operation');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('edit preloads the profile, locks the id and saves changes including cleared email', async ui => {
  ui.edit('TEST-A');
  assert(ui.field('full_name').value === 'Test Student A', 'Existing name must be prefilled');
  assert(ui.field('student_id').readOnly, 'Student id must be immutable');
  ui.field('full_name').value = 'Updated Student';
  ui.field('email').value = '';
  ui.submit();
  await finished(ui);
  const saved = ui.calls[0];
  assert(saved.method === 'PATCH' && saved.id === 'TEST-A', 'Edit must target the selected student');
  assert(!('student_id' in saved.body) && saved.body.email === null, 'Do not rename id; allow clearing optional fields');
  assert(state.students[0].full_name === 'Updated Student' && state.students[0].face_registered, 'Update must preserve face registration');
  assert(ui.find('#students-tbody').textContent.includes('Updated Student'), 'Table must show saved name');
  assert(!ui.field('student_id').readOnly && ui.find('#cancel-student-edit').hidden, 'Successful save must restore create mode');
});

test('cancel resets the form without changing data and adding a student still works', async ui => {
  ui.edit('TEST-A');
  ui.field('full_name').value = 'Unsaved';
  ui.find('#cancel-student-edit').click();
  assert(ui.calls.length === 0 && !ui.field('student_id').readOnly, 'Cancel must not send an update');
  assert(ui.field('full_name').value === '' && ui.find('#student-status-field').hidden, 'Cancel must reset fields');
  ui.field('student_id').value = 'TEST-C';
  ui.field('full_name').value = 'New Student';
  ui.submit();
  await finished(ui);
  assert(ui.calls[0].method === 'POST' && !('status' in ui.calls[0].body), 'Create must retain its existing API contract');
  assert(state.students.length === 3, 'New student must appear');
});

test('failed save preserves edits and pending requests prevent duplicate submissions', async ui => {
  let rejectSave;
  let count = 0;
  api.updateStudent = () => { count++; return new Promise((_resolve, reject) => { rejectSave = reject; }); };
  ui.edit('TEST-A');
  ui.field('full_name').value = 'Retry this name';
  ui.submit();
  assert(!ui.page.canLeave() && ui.find('fieldset').disabled, 'Pending save must lock the form');
  ui.find('#student-form').dispatchEvent(new Event('submit', { cancelable: true }));
  assert(count === 1, 'Double submission must not create a second request');
  rejectSave(new ApiError('Test update failure', 503));
  await finished(ui);
  assert(ui.field('full_name').value === 'Retry this name' && ui.field('student_id').readOnly, 'Failed save must retain edits');
  assert(document.querySelector('#toast').textContent === 'Test update failure', 'Failure must be visible');
});

test('canceling deletion makes no request; confirming removes the selected student', async ui => {
  window.confirm = () => false;
  ui.remove('TEST-A');
  assert(ui.calls.length === 0 && state.students.length === 2, 'Canceled deletion must not mutate data');
  let prompt;
  window.confirm = message => { prompt = message; return true; };
  ui.edit('TEST-A');
  ui.remove('TEST-A');
  await finished(ui);
  assert(prompt.includes('TEST-A') && prompt.includes('Mẫu khuôn mặt'), 'Confirmation must identify the student and related data');
  assert(ui.calls.length === 1 && ui.calls[0].method === 'DELETE', 'Delete must send one request');
  assert(state.students.length === 1 && state.students[0].student_id === 'TEST-B', 'Only selected student must disappear');
  assert(!ui.find('[data-edit="TEST-A"]') && !ui.field('student_id').readOnly, 'Deleted student must leave both table and editor');
});

test('protected history remains visible and the student can be deactivated', async ui => {
  ui.remove('TEST-B');
  await finished(ui);
  assert(state.students.length === 2 && ui.find('[data-edit="TEST-B"]'), 'Rejected delete must keep the student');
  assert(document.querySelector('#toast').textContent.includes('Ngừng hoạt động'), 'Explain how to preserve history');
  ui.edit('TEST-B');
  ui.field('status').value = 'INACTIVE';
  ui.submit();
  await finished(ui);
  assert(state.students[1].status === 'INACTIVE' && state.students[1].has_history, 'Deactivation must preserve the record');
  assert(ui.find('[data-register="TEST-B"]').disabled, 'Inactive student must not be offered face registration');
});

test('student text stays escaped in action buttons and search remains usable', async ui => {
  state.students[0].full_name = '<img src=x onerror="window.studentXss=true">';
  state.students[0].student_id = 'TEST-"<&';
  ui.page.refresh();
  assert(!ui.find('img') && !window.studentXss, 'Names must not inject HTML');
  const edit = ui.find('[data-edit]');
  assert(edit.dataset.edit === 'TEST-"<&', 'Special characters must survive the action id');
  edit.click();
  assert(ui.field('student_id').value === 'TEST-"<&', 'Edit must find the intended record');
  ui.find('#student-search').value = 'Test Student B';
  ui.find('#student-search').dispatchEvent(new Event('input'));
  assert(ui.find('#students-tbody').querySelectorAll('tr').length === 1, 'Search must still filter rows');
});

window.studentTests = (async () => {
  const results = [];
  for (const { name, run } of tests) {
    const ui = mount();
    try { await run(ui); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
    finally { ui.destroy(); }
  }
  document.querySelector('#test-results').textContent = results.map(result =>
    `${result.passed ? 'PASS' : 'FAIL'} ${result.name}${result.error ? `: ${result.error}` : ''}`).join('\n');
  return results;
})();
