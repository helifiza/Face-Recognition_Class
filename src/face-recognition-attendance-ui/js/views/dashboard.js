import { state } from '../state.js';
import { header, badge, emptyRow } from '../ui.js';
import { escapeHtml as esc, localDate, dateLabel } from '../utils.js';

export function dashboard(root, navigate) {
  root.innerHTML = header('Tổng quan lớp học', 'Theo dõi sinh viên, buổi học và kết quả điểm danh.',
    '<button type="button" class="btn-primary" id="go-attendance">Bắt đầu điểm danh</button>') + `
    <div class="kpi-grid" id="dashboard-stats"></div>
    <div class="two-columns">
      <section class="card"><h2>Điểm danh 7 ngày gần đây</h2><p class="muted">Số lượt có mặt theo ngày của buổi học.</p><div id="weekly-chart" class="bar-chart"></div></section>
      <section class="card"><h2>Chuẩn bị lớp học</h2><p class="muted">Hoàn thành các bước để bắt đầu nhận diện.</p>
        <div class="quick-actions">
          <button type="button" data-goto="students"><strong>Thêm sinh viên</strong><span>Lưu thông tin hồ sơ sinh viên</span></button>
          <button type="button" data-goto="courses"><strong>Tổ chức buổi học</strong><span>Tạo học phần, thêm sinh viên và lên lịch</span></button>
          <button type="button" data-goto="registration"><strong>Đăng ký khuôn mặt</strong><span>Quay video và kiểm tra tín hiệu liveness</span></button>
        </div>
      </section>
    </div>
    <section class="card"><div class="card-header"><h2>Buổi học gần đây</h2><button type="button" data-goto="courses" class="btn-outline">Quản lý buổi học</button></div>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Học phần</th><th>Ngày / giờ</th><th>Phòng</th><th>Trạng thái</th><th>Có mặt / sĩ số</th></tr></thead><tbody id="recent-sessions"></tbody></table></div>
    </section>`;
  root.querySelector('#go-attendance').onclick = () => navigate('attendance');
  root.querySelectorAll('[data-goto]').forEach(button => { button.onclick = () => navigate(button.dataset.goto); });
  function refresh() {
    const today = state.sessions.filter(row => row.session_date === localDate());
    const stats = [
      ['Tổng sinh viên', state.students.length, 'blue'],
      ['Đã đăng ký khuôn mặt', state.students.filter(row => row.face_registered).length, 'green'],
      ['Lượt có mặt hôm nay', today.reduce((sum, row) => sum + row.attendance_count, 0), 'orange'],
      ['Buổi đang mở', state.sessions.filter(row => row.status === 'OPEN').length, 'purple'],
    ];
    root.querySelector('#dashboard-stats').innerHTML = stats.map(([label, count, color]) =>
      `<div class="kpi-card ${color}"><span>${label}</span><strong>${state.loaded ? count : '—'}</strong></div>`).join('');
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - 6 + index);
      const count = state.sessions.filter(row => row.session_date === localDate(date)).reduce((sum, row) => sum + row.attendance_count, 0);
      return { label: dateLabel(localDate(date)), count };
    });
    const max = Math.max(1, ...days.map(row => row.count));
    root.querySelector('#weekly-chart').innerHTML = days.map(row => `<div class="bar-row"><span>${row.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${row.count / max * 100}%"></div></div><strong>${state.loaded ? row.count : '—'}</strong></div>`).join('');
    root.querySelector('#recent-sessions').innerHTML = state.sessions.slice(0, 8).map(row => `<tr>
      <td><strong>${esc(row.course_name)}</strong><small>${esc(row.course_id)}</small></td><td>${dateLabel(row.session_date)} · ${esc(row.start_time.slice(0, 5))}</td>
      <td>${esc(row.room || '—')}</td><td>${badge(row.status)}</td><td>${row.attendance_count} / ${row.enrolled_count}</td></tr>`).join('')
      || emptyRow(5, state.loaded ? 'Chưa có buổi học. Tạo học phần và buổi học để bắt đầu.' : 'Chưa tải được dữ liệu buổi học.');
  }
  refresh();
  return { refresh };
}
