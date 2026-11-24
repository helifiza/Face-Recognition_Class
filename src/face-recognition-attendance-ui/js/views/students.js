import { api } from '../api.js';
import { state, refreshData } from '../state.js';
import { header, badge, toast, emptyRow } from '../ui.js';
import { escapeHtml as esc, formValues } from '../utils.js';

export function students(root, navigate) {
  let saving = false;
  let editingId = null;
  let deletingId = null;
  root.innerHTML = header('Sinh viên', 'Hồ sơ được lưu trong cơ sở dữ liệu và sử dụng chung cho các học phần.') + `
    <section class="card"><h2 id="student-form-title">Thêm sinh viên</h2>
      <form id="student-form"><fieldset class="form-grid">
        <label>Mã sinh viên<input name="student_id" required maxlength="100" autocomplete="off" placeholder="VD: SV001"></label>
        <label>Họ và tên<input name="full_name" required maxlength="200" autocomplete="name"></label>
        <label>Lớp sinh hoạt<input name="class_name" maxlength="200" placeholder="VD: CNTT01"></label>
        <label>Khoa<input name="faculty" maxlength="200"></label>
        <label>Email<input name="email" type="email" maxlength="254" autocomplete="email"></label>
        <label id="student-status-field" hidden>Trạng thái<select name="status">
          <option value="ACTIVE">Hoạt động</option><option value="INACTIVE">Ngừng hoạt động</option>
        </select></label>
        <div class="form-action toolbar"><button class="btn-primary" type="submit">Lưu sinh viên</button>
          <button class="btn-outline" type="button" id="cancel-student-edit" hidden>Hủy sửa</button></div>
      </fieldset></form>
      <p class="notice" id="student-edit-note" hidden>Mã sinh viên được giữ cố định. Chuyển sang Ngừng hoạt động để ngừng nhận diện và giữ lại lịch sử điểm danh.</p>
    </section>
    <section class="card"><div class="card-header"><div><h2>Danh sách sinh viên</h2><p class="muted" id="student-count"></p></div>
      <label class="search-label">Tìm sinh viên<input type="search" id="student-search" placeholder="Tên, mã sinh viên, lớp…"></label></div>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Sinh viên</th><th>Mã sinh viên</th><th>Lớp / khoa</th><th>Trạng thái</th><th>Khuôn mặt</th><th>Thao tác</th></tr></thead><tbody id="students-tbody"></tbody></table></div>
    </section>`;
  const form = root.querySelector('#student-form');
  const cancel = root.querySelector('#cancel-student-edit');
  function resetEditor() {
    editingId = null;
    form.reset();
  }
  function editStudent(row) {
    editingId = row.student_id;
    for (const name of ['student_id', 'full_name', 'class_name', 'faculty', 'email', 'status']) {
      form.elements.namedItem(name).value = row[name] ?? '';
    }
    refresh();
    form.scrollIntoView({ block: 'center', behavior: 'smooth' });
    form.elements.namedItem('full_name').focus({ preventScroll: true });
  }
  cancel.onclick = () => {
    if (saving || state.loading) return;
    resetEditor();
    refresh();
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (saving || state.loading) return;
    const body = formValues(form);
    const id = editingId;
    if (id !== null) delete body.student_id;
    else delete body.status;
    saving = true;
    refresh();
    try {
      const saved = id !== null ? await api.updateStudent(id, body) : await api.createStudent(body);
      if (id !== null) state.students = state.students.map(row => row.student_id === id ? { ...row, ...saved } : row);
      else state.students = [...state.students, { ...saved, face_registered: false }];
      resetEditor();
      await refreshData();
      toast(`Đã ${id !== null ? 'cập nhật' : 'thêm'} sinh viên ${saved.full_name}.`);
    } catch (error) { toast(error.message, true); }
    finally { saving = false; refresh(); }
  };
  async function removeStudent(row) {
    if (!window.confirm(`Xóa sinh viên ${row.full_name} (${row.student_id})?\nMẫu khuôn mặt và đăng ký học phần của sinh viên này cũng sẽ bị xóa.\nSinh viên đã có lịch sử điểm danh hoặc cảnh báo sẽ được giữ lại.`)) return;
    saving = true;
    deletingId = row.student_id;
    refresh();
    try {
      await api.deleteStudent(row.student_id);
      state.students = state.students.filter(item => item.student_id !== row.student_id);
      state.enrollments = state.enrollments.filter(item => item.student_id !== row.student_id);
      if (editingId === row.student_id) resetEditor();
      await refreshData();
      toast(`Đã xóa sinh viên ${row.full_name}.`);
    } catch (error) { toast(error.message, true); }
    finally { saving = false; deletingId = null; refresh(); }
  }
  root.querySelector('#student-search').oninput = refresh;
  root.querySelector('#students-tbody').onclick = event => {
    if (saving || state.loading) return;
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.hasAttribute('data-register')) return navigate('registration', { studentId: button.dataset.register });
    const id = button.dataset.edit ?? button.dataset.delete;
    const row = state.students.find(item => String(item.student_id) === id);
    if (!row) return;
    if (button.hasAttribute('data-edit')) editStudent(row);
    else if (button.hasAttribute('data-delete')) void removeStudent(row);
  };
  function refresh() {
    const editing = editingId !== null;
    const locked = saving || state.loading;
    root.querySelector('#student-form-title').textContent = editing ? 'Sửa sinh viên' : 'Thêm sinh viên';
    root.querySelector('#student-status-field').hidden = !editing;
    root.querySelector('#student-edit-note').hidden = !editing;
    form.elements.namedItem('student_id').readOnly = editing;
    form.querySelector('fieldset').disabled = locked;
    form.querySelector('[type=submit]').textContent = saving && deletingId === null ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Lưu sinh viên';
    cancel.hidden = !editing;
    const query = root.querySelector('#student-search').value.trim().toLocaleLowerCase('vi');
    const rows = state.students.filter(row => [row.full_name, row.student_id, row.class_name, row.faculty, row.email].join(' ').toLocaleLowerCase('vi').includes(query));
    root.querySelector('#student-count').textContent = `${rows.length} / ${state.students.length} sinh viên`;
    root.querySelector('#students-tbody').innerHTML = rows.map(row => `<tr>
      <td><strong>${esc(row.full_name)}</strong><small>${esc(row.email || '—')}</small></td><td>${esc(row.student_id)}</td>
      <td>${esc(row.class_name || '—')}<small>${esc(row.faculty || '')}</small></td><td>${badge(row.status)}</td>
      <td><span class="status-badge ${row.face_registered ? 'success' : 'warning'}">${row.face_registered ? 'Đã đăng ký' : 'Chưa đăng ký'}</span></td>
      <td><div class="table-actions">
        <button type="button" class="btn-outline-sm" data-edit="${esc(row.student_id)}" ${locked ? 'disabled' : ''}>Sửa</button>
        <button type="button" class="btn-outline-sm btn-danger" data-delete="${esc(row.student_id)}" ${locked ? 'disabled' : ''}>${deletingId === row.student_id ? 'Đang xóa…' : 'Xóa'}</button>
        <button type="button" class="btn-outline-sm" data-register="${esc(row.student_id)}" ${locked || row.status !== 'ACTIVE' ? 'disabled' : ''}>${row.face_registered ? 'Thêm mẫu mặt' : 'Đăng ký mặt'}</button>
      </div></td></tr>`).join('')
      || emptyRow(6, state.loaded ? 'Không có sinh viên phù hợp.' : 'Chưa tải được danh sách sinh viên.');
  }
  refresh();
  return { refresh, canLeave: () => !saving };
}
