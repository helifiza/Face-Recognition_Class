import { state } from '../state.js';
import { SessionRecords } from '../session-records.js';
import { header, fillSelect, attendanceTable, emptyRow, labels } from '../ui.js';
import { sessionLabel, rosterRows, downloadCsv, timeLabel } from '../utils.js';

export function reports(root) {
  let rows = [];
  root.innerHTML = header('Báo cáo điểm danh', 'Đối chiếu kết quả với danh sách sinh viên của học phần.',
    '<button type="button" id="export-report" class="btn-primary" disabled>Xuất CSV</button>') + `
    <section class="card"><div class="form-grid">
      <label>Học phần<select id="report-course"></select></label>
      <label>Buổi học<select id="report-session"></select></label>
      <label>Lọc trạng thái<select id="report-status"><option value="">Tất cả</option value="PRESENT">Có mặt</option><option value="ABSENT">Vắng</option><option value="PENDING">Chưa điểm danh</option></select></label>
    </div><p class="notice">Chỉ tính vắng khi buổi học đã đóng. Sĩ số đối chiếu theo danh sách học phần hiện tại; hệ thống chưa lưu lịch sử thay đổi sĩ số.</p></section>
    <div id="report-stats" class="kpi-grid"></div>
    <section class="card"><h2>Chi tiết buổi học</h2><p id="report-error" class="notice error" role="alert" hidden></p>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Sinh viên</th><th>Mã sinh viên</th><th>Thời gian</th><th>Trạng thái</th><th>Độ tương đồng</th></tr></thead><tbody id="report-tbody"></tbody></table></div>
    </section>`;
  const courseSelect = root.querySelector('#report-course');
  const sessionSelect = root.querySelector('#report-session');
  const statusSelect = root.querySelector('#report-status');
  const exportButton = root.querySelector('#export-report');
  const feed = new SessionRecords(render);
  const currentSession = () => state.sessions.find(row => String(row.session_id) === sessionSelect.value);
  function visibleRows() { return rows.filter(row => !statusSelect.value || row.status === statusSelect.value); }
  function render() {
    const session = currentSession();
    const ready = feed.loaded && !feed.loading && !feed.error && Boolean(session);
    rows = ready ? rosterRows(state.students, state.enrollments, session, feed.rows) : [];
    exportButton.disabled = !ready || rows.length === 0;
    root.querySelector('#report-error').hidden = !feed.error;
    root.querySelector('#report-error').textContent = feed.error || '';
    const counts = [
      ['Sĩ số đối chiếu', rows.length, 'blue'],
      ['Có mặt', rows.filter(row => ['PRESENT', 'LATE'].includes(row.status)).length, 'green'],
      ['Vắng', rows.filter(row => row.status === 'ABSENT').length, 'orange'],
      ['Chưa điểm danh', rows.filter(row => row.status === 'PENDING').length, 'purple'],
    ];
    root.querySelector('#report-stats').innerHTML = counts.map(([label, count, color]) => `<div class="kpi-card ${color}"><span>${label}</span><strong>${ready ? count : '—'}</strong></div>`).join('');
    root.querySelector('#report-tbody').innerHTML = ready ? attendanceTable(visibleRows())
      : emptyRow(5, feed.loading ? 'Đang tải kết quả…' : 'Chọn một buổi học để xem báo cáo.');
  }
  function sessions() {
    const filtered = state.sessions.filter(row => !courseSelect.value || row.course_id === courseSelect.value);
    fillSelect(sessionSelect, filtered, row => row.session_id, sessionLabel, 'Chọn buổi học');
    feed.select(sessionSelect.value);
    render();
  }
  courseSelect.onchange = sessions;
  sessionSelect.onchange = () => feed.select(sessionSelect.value);
  statusSelect.onchange = render;
  exportButton.onclick = () => {
    if (exportButton.disabled) return;
    const session = currentSession();
    downloadCsv(`diem-danh-${session.session_id}-${session.session_date}.csv`, [
      ['Mã học phần', 'Buổi học', 'Ngày học', 'Mã sinh viên', 'Họ tên', 'Lớp', 'Trạng thái', 'Thời gian', 'Độ tương đồng'],
      ...visibleRows().map(row => [session.course_id, session.session_id, session.session_date, row.student_id,
        row.full_name, row.class_name, labels[row.status] || row.status, row.check_time ? timeLabel(row.check_time) : '', row.similarity ?? '']),
    ]);
  };
  function refresh() {
    fillSelect(courseSelect, state.courses, row => row.course_id, row => `${row.course_id} · ${row.course_name}`, 'Tất cả học phần');
    sessions();
  }
  refresh();
  return { refresh, reload: () => feed.reload(), destroy: () => feed.destroy() };
}
