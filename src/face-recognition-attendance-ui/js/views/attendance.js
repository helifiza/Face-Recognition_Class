import { api } from '../api.js';
import { state, refreshData } from '../state.js';
import { VideoInput } from '../camera.js';
import { SessionRecords } from '../session-records.js';
import { header, badge, fillSelect, toast, emptyRow, attendanceTable, livenessResult } from '../ui.js';
import { escapeHtml as esc, sessionLabel } from '../utils.js';

export function attendance(root, navigate, options = {}) {
  let saving = false;
  let targetSession = options.sessionId;
  root.innerHTML = header('Điểm danh', 'Mở buổi học và gửi video để nhận diện từng sinh viên.',
    '<button type="button" id="manage-sessions" class="btn-outline">Quản lý buổi học</button>') + `
    <section class="card"><div class="session-toolbar">
      <label>Buổi học<select id="attendance-session"></select></label><div id="session-status"></div>
      <button type="button" id="open-session" class="btn-primary" disabled>Mở điểm danh</button>
      <button type="button" id="close-session" class="btn-outline" disabled>Đóng buổi học</button>
    </div><p class="muted" id="session-detail"></p></section>
    <div class="two-columns">
      <section class="card"><h2>Camera điểm danh</h2><div id="attendance-camera"></div>
        <button type="button" id="recognize-btn" class="btn-primary full-width" disabled>Nhận diện & điểm danh</button>
      </section>
      <section class="card" aria-live="polite"><h2>Kết quả nhận diện</h2><div id="recognition-result" class="result-card">
        <p class="muted">Chọn buổi đang mở, quay hoặc tải video, sau đó nhấn nhận diện.</p></div>
        <p class="notice">Sinh viên cần đăng ký khuôn mặt và thuộc học phần. Mỗi sinh viên chỉ được ghi điểm danh một lần trong mỗi buổi.</p>
      </section>
    </div>
    <section class="card"><div class="card-header"><div><h2>Kết quả điểm danh của buổi</h2><p class="muted" id="attendance-count"></p></div>
      <button type="button" id="reload-attendance" class="btn-outline">Tải lại danh sách</button></div>
      <p id="attendance-error" class="notice error" role="alert" hidden></p>
      <div class="table-responsive"><table class="data-table"><thead><tr><th>Sinh viên</th><th>Mã sinh viên</th><th>Thời gian</th><th>Trạng thái</th><th>Độ tương đồng</th></tr></thead><tbody id="attendance-tbody"></tbody></table></div>
    </section>`;
  const select = root.querySelector('#attendance-session');
  const submit = root.querySelector('#recognize-btn');
  const result = root.querySelector('#recognition-result');
  const camera = new VideoInput(root.querySelector('#attendance-camera'), () => updateControls(), state.config?.record_seconds || 8);
  const feed = new SessionRecords(renderRecords, true);
  const currentSession = () => state.sessions.find(row => String(row.session_id) === select.value);

  function updateControls() {
    const session = currentSession();
    select.disabled = saving;
    submit.disabled = saving || !camera.file || camera.recording || session?.status !== 'OPEN';
    root.querySelector('#open-session').disabled = saving || !session || session.status === 'OPEN';
    root.querySelector('#close-session').disabled = saving || session?.status !== 'OPEN';
    root.querySelector('#session-status').innerHTML = session ? badge(session.status) : '';
    root.querySelector('#session-detail').textContent = session
      ? `${session.course_id} · Phòng ${session.room || 'chưa xác định'} · ${session.enrolled_count} sinh viên · ${session.start_time.slice(0, 5)}–${session.end_time.slice(0, 5)}`
      : 'Chưa có buổi học. Tạo buổi học trong mục Học phần & buổi học.';
  }
  function renderRecords() {
    root.querySelector('#reload-attendance').disabled = feed.loading || !select.value;
    root.querySelector('#attendance-error').hidden = !feed.error;
    root.querySelector('#attendance-error').textContent = feed.error ? `${feed.error} Danh sách chưa được cập nhật.` : '';
    root.querySelector('#attendance-count').textContent = feed.loaded
      ? `${feed.rows.length} sinh viên đã điểm danh · Cập nhật ${feed.updatedAt.toLocaleTimeString('vi-VN')} · Tự tải lại mỗi 10 giây`
      : feed.loading ? 'Đang tải kết quả…' : 'Chọn buổi học để xem kết quả.';
    root.querySelector('#attendance-tbody').innerHTML = feed.loaded ? attendanceTable(feed.rows)
      : emptyRow(5, feed.loading ? 'Đang tải…' : 'Chưa có kết quả để hiển thị.');
  }
  async function changeStatus(status) {
    if (saving || !select.value) return;
    saving = true;
    camera.setBusy(true);
    updateControls();
    try {
      await api.setSessionStatus(select.value, status);
      toast(status === 'OPEN' ? 'Đã mở điểm danh.' : 'Đã đóng buổi học.');
      // Apply the confirmed mutation even if the subsequent full refresh fails.
      currentSession().status = status;
      await refreshData();
      await feed.reload();
    } catch (error) { toast(error.message, true); }
    finally { saving = false; camera.setBusy(false); updateControls(); }
  }
  root.querySelector('#open-session').onclick = () => changeStatus('OPEN');
  root.querySelector('#close-session').onclick = () => changeStatus('CLOSED');
  root.querySelector('#manage-sessions').onclick = () => navigate('courses');
  root.querySelector('#reload-attendance').onclick = () => feed.reload();
  select.onchange = () => {
    camera.clear();
    result.textContent = 'Sẵn sàng nhận diện cho buổi học đã chọn.';
    updateControls();
    feed.select(select.value);
  };
  submit.onclick = async () => {
    if (saving || !camera.file || currentSession()?.status !== 'OPEN') return;
    const id = select.value;
    const file = camera.file;
    saving = true;
    camera.setBusy(true);
    updateControls();
    submit.textContent = 'Đang phân tích video…';
    result.textContent = 'Đang so khớp khuôn mặt, sau đó kiểm tra tín hiệu mạch nếu khớp. Quá trình có thể mất vài phút trên CPU.';
    try {
      const response = await api.recognize(id, file);
      const explanations = {
        PRESENT: 'Đã ghi nhận điểm danh.', ALREADY_PRESENT: 'Sinh viên đã điểm danh trong buổi này. Không tạo bản ghi trùng.',
        UNKNOWN: 'Không tìm thấy mẫu khuôn mặt phù hợp. Kiểm tra việc đăng ký khuôn mặt.',
        COLLECTING: 'Đã khớp khuôn mặt nhưng chưa đủ tín hiệu mạch nên chưa ghi điểm danh. Hãy quay lại liên tục khoảng 8 giây.',
        FAKE: 'Đã khớp khuôn mặt nhưng tín hiệu mạch chưa đạt yêu cầu nên chưa ghi điểm danh. Giữ yên và tăng ánh sáng khi quay lại.',
      };
      result.innerHTML = livenessResult(response)
        + (response.match ? `<h3>${esc(response.match.full_name)}</h3><p>${esc(response.match.student_id)} · Độ tương đồng ${Number(response.match.similarity).toFixed(3)}</p>` : '')
        + `<p>${esc(explanations[response.status] || response.status)}</p>`;
      camera.clear();
      await feed.reload();
      await refreshData();
    } catch (error) {
      result.innerHTML = `<p class="error-text">${esc(error.message)}</p>`;
      if (error.status === 409) await refreshData();
    } finally {
      saving = false;
      camera.setBusy(false);
      submit.textContent = 'Nhận diện & điểm danh';
      updateControls();
    }
  };
  function refresh() {
    fillSelect(select, state.sessions, row => row.session_id, sessionLabel, 'Chọn buổi học');
    if (targetSession && state.sessions.some(row => String(row.session_id) === String(targetSession))) {
      select.value = targetSession;
      targetSession = null;
    } else if (!select.value && state.sessions.length) {
      select.value = (state.sessions.find(row => row.status === 'OPEN') || state.sessions[0]).session_id;
    }
    updateControls();
    feed.select(select.value);
  }
  refresh();
  return { refresh, reload: () => feed.reload(), canLeave: () => !saving, destroy() { camera.destroy(); feed.destroy(); } };
}
