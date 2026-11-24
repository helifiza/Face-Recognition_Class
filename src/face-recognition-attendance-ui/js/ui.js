import { escapeHtml, timeLabel } from './utils.js';

let toastTimer;
export function toast(message, error = false) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 9000 : 4500);
}

export async function busy(button, task, fieldset) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Đang xử lý…';
  if (fieldset) fieldset.disabled = true;
  try { return await task(); }
  catch (error) { toast(error.message, true); }
  finally {
    button.disabled = false;
    button.textContent = label;
    if (fieldset) fieldset.disabled = false;
  }
}

export function applyTheme(dark) {
  try {
    if (dark === undefined) dark = localStorage.getItem('attendance_theme') === 'dark';
    localStorage.setItem('attendance_theme', dark ? 'dark' : 'light');
  } catch { /* Browser storage may be unavailable. */ }
  document.body.classList.toggle('dark-mode', Boolean(dark));
}

export const labels = {
  OPEN: 'Đang mở', CLOSED: 'Đã đóng', SCHEDULED: 'Chưa mở', PRESENT: 'Có mặt',
  ALREADY_PRESENT: 'Đã điểm danh trước đó', LATE: 'Đi muộn', ABSENT: 'Vắng', PENDING: 'Chưa điểm danh',
  ACTIVE: 'Hoạt động', INACTIVE: 'Ngừng hoạt động', REAL: 'Đạt liveness', FAKE: 'Tín hiệu chưa đạt',
  COLLECTING: 'Chưa đủ tín hiệu', UNKNOWN: 'Không nhận ra sinh viên',
};
export function badge(status) {
  const style = ['OPEN', 'PRESENT', 'REAL', 'ACTIVE', 'ALREADY_PRESENT'].includes(status) ? 'success'
    : ['ABSENT', 'FAKE'].includes(status) ? 'danger'
      : ['PENDING', 'LATE', 'COLLECTING', 'UNKNOWN'].includes(status) ? 'warning' : 'neutral';
  return `<span class="status-badge ${style}">${escapeHtml(labels[status] || status)}</span>`;
}

export function header(title, subtitle, action = '') {
  return `<div class="page-header"><div><h1 tabindex="-1">${title}</h1><p>${subtitle}</p></div>${action}</div>`;
}

export function emptyRow(columns, message = 'Chưa có dữ liệu.') {
  return `<tr><td colspan="${columns}" class="empty-state">${escapeHtml(message)}</td></tr>`;
}

export function fillSelect(select, rows, valueOf, labelOf, placeholder = 'Chọn…') {
  const selected = select.value;
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + rows.map(row =>
    `<option value="${escapeHtml(valueOf(row))}">${escapeHtml(labelOf(row))}</option>`).join('');
  if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

export function attendanceTable(rows) {
  return rows.map(row => `<tr><td>${escapeHtml(row.full_name)}</td><td>${escapeHtml(row.student_id)}</td>
    <td>${escapeHtml(timeLabel(row.check_time))}</td><td>${badge(row.status)}</td>
    <td>${row.similarity == null ? '—' : Number(row.similarity).toFixed(3)}</td></tr>`).join('') || emptyRow(5);
}

export function livenessResult(result) {
  const live = result.liveness || {};
  const title = `<div class="result-title">${badge(result.status || live.status || 'REAL')}</div>`;
  if (live.status === 'NOT_CHECKED') {
    return title + '<p class="muted">Chưa kiểm tra tín hiệu mạch vì chưa khớp khuôn mặt.</p>';
  }
  const number = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(1);
  return `${title}
    <dl class="metrics"><div><dt>Nhịp mạch ước lượng</dt><dd>${number(live.bpm)} BPM</dd></div>
    <div><dt>Chất lượng tín hiệu</dt><dd>${number(live.snr_db)} dB</dd></div></dl>`;
}
