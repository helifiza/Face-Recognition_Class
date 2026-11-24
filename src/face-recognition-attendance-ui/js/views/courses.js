import { api } from '../api.js';
import { state, refreshData } from '../state.js';
import { header, badge, busy, toast, emptyRow, fillSelect } from '../ui.js';
import { escapeHtml as esc, formValues, localDate, dateLabel } from '../utils.js';

export function courses(root, navigate) {
  let saves = 0;
  root.innerHTML = header('Học phần & buổi học', 'Tạo học phần, thêm sinh viên và chuẩn bị buổi điểm danh.') + `
    <div class="two-columns">
      <section class="card"><h2>Tạo học phần</h2><form id="course-form"><fieldset class="form-stack">
        <label>Mã học phần<input name="course_id" required maxlength="100" placeholder="VD: CS101"></label>
        <label>Tên học phần<input name="course_name" required maxlength="200"></label>
        <label>Giảng viên<input name="lecturer" maxlength="200"></label>
        <button class="btn-primary" type="submit">Lưu học phần</button>
      </fieldset></form></section>
      <section class="card"><h2>Thêm sinh viên vào học phần</h2><form id="enrollment-form"><fieldset class="form-stack">
        <label>Học phần<select name="course_id" id="enrollment-course" required></select></label>
        <label>Sinh viên<select name="student_id" id="enrollment-student" required></select></label>
        <p class="muted" id="enrollment-note">Chỉ sinh viên thuộc học phần mới có thể điểm danh.</p>
        <button class="btn-primary" type="submit">Thêm vào học phần</button>
      </fieldset></form></section>
    </div>
    <section class="card"><h2>Tạo buổi học</h2><form id="session-form"><fieldset class="form-grid">
      <label>Học phần<select name="course_id" id="session-course" required></select></label>
      <label>Ngày học<input name="session_date" type="date" value="${localDate()}" required></label>
      <label>Bắt đầu<input name="start_time" type="time" required></label>
      <label>Kết thúc<input name="end_time" type="time" required></label>
      <label>Phòng học<input name="room" maxlength="100"></label>
      <div class="form-action"><button class="btn-primary" type="submit">Tạo buổi học</button></div>
    </fieldset></form></section>
    <section class="card"><h2>Học phần hiện có</h2><div class="table-responsive"><table class="data-table">
      <thead><tr><th>Mã học phần</th><th>Tên học phần</th><th>Giảng viên</th><th>Sĩ số</th></tr></thead><tbody id="courses-tbody"></tbody></table></div></section>
    <section class="card"><h2>Các buổi học</h2><div class="table-responsive"><table class="data-table">
      <thead><tr><th>Học phần</th><th>Ngày học</th><th>Giờ / phòng</th><th>Trạng thái</th><th>Có mặt</th><th>Thao tác</th></tr></thead><tbody id="sessions-tbody"></tbody></table></div></section>`;
  function connectForm(id, send, message, validate) {
    const form = root.querySelector(id);
    form.onsubmit = event => {
      event.preventDefault();
      const body = formValues(form);
      if (validate && !validate(body)) return;
      saves++;
      busy(form.querySelector('button'), async () => {
        await send(body);
        if (id !== '#enrollment-form') form.reset();
        toast(message);
        await refreshData();
      }, form.querySelector('fieldset')).finally(() => { saves--; });
    };
  }
  connectForm('#course-form', api.createCourse, 'Đã tạo học phần.');
  connectForm('#enrollment-form', api.enroll, 'Đã thêm sinh viên vào học phần.');
  connectForm('#session-form', api.createSession, 'Đã tạo buổi học. Mở buổi tại màn hình Điểm danh.', body => {
    if (body.end_time <= body.start_time) { toast('Giờ kết thúc phải sau giờ bắt đầu.', true); return false; }
    return true;
  });
  root.querySelector('#enrollment-course').onchange = refreshEnrollment;
  root.querySelector('#sessions-tbody').onclick = event => {
    const button = event.target.closest('[data-session]');
    if (button) navigate('attendance', { sessionId: button.dataset.session });
  };
  function refreshEnrollment() {
    const courseId = root.querySelector('#enrollment-course').value;
    const enrolled = new Set(state.enrollments.filter(row => row.course_id === courseId).map(row => row.student_id));
    fillSelect(root.querySelector('#enrollment-student'), state.students.filter(row => row.status === 'ACTIVE' && !enrolled.has(row.student_id)),
      row => row.student_id, row => `${row.student_id} · ${row.full_name}`, 'Chọn sinh viên chưa thuộc học phần');
    root.querySelector('#enrollment-note').textContent = courseId
      ? `${enrolled.size} sinh viên đã thuộc học phần. Chỉ hiển thị sinh viên chưa được thêm.`
      : 'Chỉ sinh viên thuộc học phần mới có thể điểm danh.';
  }
  function refresh() {
    for (const id of ['#enrollment-course', '#session-course']) {
      fillSelect(root.querySelector(id), state.courses, row => row.course_id, row => `${row.course_id} · ${row.course_name}`, 'Chọn học phần');
    }
    refreshEnrollment();
    root.querySelector('#courses-tbody').innerHTML = state.courses.map(row => `<tr><td>${esc(row.course_id)}</td>
      <td>${esc(row.course_name)}</td><td>${esc(row.lecturer || '—')}</td><td>${state.enrollments.filter(item => item.course_id === row.course_id).length}</td></tr>`).join('') || emptyRow(4);
    root.querySelector('#sessions-tbody').innerHTML = state.sessions.map(row => `<tr><td>${esc(row.course_name)}<small>${esc(row.course_id)}</small></td>
      <td>${dateLabel(row.session_date)}</td><td>${esc(row.start_time.slice(0, 5))}–${esc(row.end_time.slice(0, 5))}<small>${esc(row.room || '—')}</small></td>
      <td>${badge(row.status)}</td><td>${row.attendance_count} / ${row.enrolled_count}</td>
      <td><button type="button" class="btn-outline-sm" data-session="${esc(row.session_id)}">Điểm danh</button></td></tr>`).join('') || emptyRow(6);
  }
  refresh();
  return { refresh, canLeave: () => saves === 0 };
}
