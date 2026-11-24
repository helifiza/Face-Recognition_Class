import { api } from '../api.js';
import { state, refreshData } from '../state.js';
import { VideoInput } from '../camera.js';
import { header, fillSelect, toast, livenessResult } from '../ui.js';
import { escapeHtml as esc } from '../utils.js';

export function registration(root, navigate, options = {}) {
  let saving = false;
  let targetStudent = options.studentId;
  let selectedStudentId = '';
  root.innerHTML = header('Đăng ký khuôn mặt', 'Chọn sinh viên, quay video và lưu mẫu khuôn mặt sau khi kiểm tra liveness.') + `
    <div class="two-columns">
      <section class="card"><h2>Thông tin sinh viên</h2><label>Sinh viên<select id="registration-student" required></select></label>
        <div id="registration-profile" class="profile-summary muted"></div>
        <button type="button" id="add-student" class="btn-outline">Thêm sinh viên mới</button>
        <p class="notice">Mỗi lần đăng ký thành công sẽ lưu thêm một mẫu khuôn mặt cho sinh viên đã chọn.</p>
      </section>
      <section class="card"><h2>Video đăng ký</h2><div id="registration-camera"></div>
        <button type="button" id="register-face" class="btn-primary full-width" aria-describedby="registration-hint" disabled>Kiểm tra & lưu khuôn mặt</button>
        <p id="registration-hint" class="muted small" role="status" aria-live="polite"></p>
      </section>
    </div>
    <section id="registration-result" class="card result-card" aria-live="polite" hidden></section>`;
  const select = root.querySelector('#registration-student');
  const submit = root.querySelector('#register-face');
  const hint = root.querySelector('#registration-hint');
  const result = root.querySelector('#registration-result');
  const camera = new VideoInput(root.querySelector('#registration-camera'), () => {
    result.hidden = true;
    updateSubmit();
  }, state.config?.record_seconds || 8);
  function selectedStudent() {
    return state.students.find(row => String(row.student_id) === select.value && row.status === 'ACTIVE');
  }
  function updateSubmit() {
    const student = selectedStudent();
    submit.disabled = Boolean(saving || !student || !camera.file || camera.recording);
    hint.textContent = saving ? 'Đang kiểm tra video. Vui lòng đợi kết quả.'
      : !student ? 'Chọn sinh viên đang hoạt động để đăng ký khuôn mặt.'
        : camera.recording ? 'Đang quay video. Nút kiểm tra sẽ bật khi quay xong.'
          : !camera.file ? 'Chưa có video để gửi. Bấm “Quay video” sau khi bật camera hoặc tải video có sẵn.'
            : `Video đã sẵn sàng. Bấm kiểm tra để đăng ký cho ${student.full_name} (${student.student_id}).`;
  }
  function profile() {
    const student = selectedStudent();
    const nextStudentId = student ? String(student.student_id) : '';
    // A clip captured before the first selection can be used for that student.
    // Clear an existing student's clip when switching to another student.
    const switchedStudent = selectedStudentId && selectedStudentId !== nextStudentId;
    selectedStudentId = nextStudentId;
    if (switchedStudent) camera.clear();
    root.querySelector('#registration-profile').innerHTML = student
      ? `<strong>${esc(student.full_name)}</strong><p>${esc(student.student_id)} · ${esc(student.class_name || 'Chưa có lớp')}</p><p>${student.face_registered ? 'Đã có mẫu khuôn mặt.' : 'Chưa đăng ký khuôn mặt.'}</p>`
      : '<p>Chọn sinh viên đang hoạt động hoặc tạo hồ sơ mới trước khi đăng ký.</p>';
    updateSubmit();
    if (switchedStudent && !saving) hint.textContent = 'Đã đổi sinh viên. Hãy quay hoặc tải video cho sinh viên vừa chọn.';
  }
  select.onchange = () => { result.hidden = true; profile(); };
  root.querySelector('#add-student').onclick = () => navigate('students');
  submit.onclick = async () => {
    if (saving || camera.recording || !camera.file || !selectedStudent()) return;
    const id = select.value;
    const file = camera.file;
    saving = true;
    select.disabled = true;
    camera.setBusy(true);
    updateSubmit();
    submit.textContent = 'Đang kiểm tra liveness & lưu…';
    result.hidden = false;
    result.textContent = 'Đang gửi video và phân tích khuôn mặt. Quá trình này có thể mất vài phút trên CPU.';
    try {
      const response = await api.registerFace(id, file);
      camera.clear();
      result.innerHTML = `<h2>Đã lưu mẫu khuôn mặt</h2><p>Sinh viên: ${esc(id)} · Mẫu #${esc(response.embedding_id)}</p>${livenessResult(response)}`;
      result.hidden = false;
      toast('Đăng ký khuôn mặt thành công.');
      await refreshData();
    } catch (error) {
      result.innerHTML = `<h2>Chưa lưu được khuôn mặt</h2><p class="error-text">${esc(error.message)}</p>`
        + (error.detail?.status ? livenessResult({ liveness: error.detail }) : '');
      result.hidden = false;
    } finally {
      saving = false;
      select.disabled = false;
      camera.setBusy(false);
      submit.textContent = 'Kiểm tra & lưu khuôn mặt';
      updateSubmit();
    }
  };
  function refresh() {
    fillSelect(select, state.students.filter(row => row.status === 'ACTIVE'), row => row.student_id,
      row => `${row.student_id} · ${row.full_name}`, 'Chọn sinh viên');
    if (targetStudent && state.students.some(row => row.student_id === targetStudent)) { select.value = targetStudent; targetStudent = null; }
    profile();
  }
  refresh();
  return { refresh, canLeave: () => !saving, destroy: () => camera.destroy() };
}
