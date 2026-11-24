import { state, refreshData, subscribe } from './js/state.js';
import { toast, applyTheme } from './js/ui.js';
import { dashboard } from './js/views/dashboard.js';
import { students } from './js/views/students.js';
import { courses } from './js/views/courses.js';
import { registration } from './js/views/registration.js';
import { attendance } from './js/views/attendance.js';
import { reports } from './js/views/reports.js';
import { settings } from './js/views/settings.js';

const views = { dashboard, students, courses, registration, attendance, reports, settings };
const outlet = document.querySelector('#view-outlet');
let page;
let currentView;

function navigate(name, options = {}) {
  if (!views[name]) name = 'dashboard';
  if (page?.canLeave && !page.canLeave()) {
    toast('Vui lòng đợi yêu cầu đang xử lý hoàn tất.', true);
    return;
  }
  page?.destroy?.();
  currentView = name;
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === name;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  page = views[name](outlet, navigate, options);
  history.replaceState(null, '', `#${name}`);
  outlet.querySelector('h1')?.focus();
}

function renderConnection() {
  const status = document.querySelector('#connection-status');
  status.textContent = state.loading ? 'Đang đồng bộ…' : state.error ? 'Mất kết nối' : 'Đã kết nối';
  status.className = `status-badge ${state.error ? 'danger' : state.loading ? 'neutral' : 'success'}`;
  const banner = document.querySelector('#connection-error');
  banner.hidden = !state.error;
  banner.textContent = state.error
    ? `${state.error} ${state.loaded ? 'Đang hiển thị dữ liệu của lần đồng bộ trước.' : 'Chưa tải được dữ liệu.'} Bấm “Làm mới” để thử lại.`
    : '';
  document.querySelector('#refresh-btn').disabled = state.loading;
  document.querySelector('#last-sync').textContent = state.updatedAt
    ? `Đồng bộ ${state.updatedAt.toLocaleTimeString('vi-VN')}` : 'Chưa đồng bộ';
}

applyTheme();
document.querySelector('#current-date').textContent = new Date().toLocaleDateString('vi-VN', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => navigate(button.dataset.view));
});
document.querySelector('#refresh-btn').addEventListener('click', async () => {
  if (page?.canLeave && !page.canLeave()) return toast('Vui lòng đợi xử lý hoàn tất.', true);
  if (await refreshData()) await page?.reload?.();
});
document.querySelector('#theme-toggle').addEventListener('click', () => {
  applyTheme(!document.body.classList.contains('dark-mode'));
});
window.addEventListener('hashchange', () => {
  const next = location.hash.slice(1);
  if (next !== currentView) navigate(next);
});
window.addEventListener('pagehide', () => page?.destroy?.());
subscribe(() => { renderConnection(); page?.refresh?.(); });
navigate(location.hash.slice(1));
refreshData();
