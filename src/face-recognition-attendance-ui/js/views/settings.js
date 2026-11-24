import { state } from '../state.js';
import { header } from '../ui.js';
import { escapeHtml as esc } from '../utils.js';

export function settings(root) {
  root.innerHTML = header('Cài đặt hệ thống', 'Thông tin kết nối và cấu hình nhận diện đang được áp dụng.') + `
    <section class="card"><h2>Kết nối backend</h2><dl class="settings-list">
      <div><dt>Địa chỉ</dt><dd>${esc(location.origin)}</dd></div>
      <div><dt>Tài liệu API</dt><dd><a href="/docs" target="_blank" rel="noopener">Mở Swagger UI</a></dd></div>
    </dl><p class="notice">Phiên bản hiện tại dùng trực tiếp trong môi trường nội bộ và chưa có đăng nhập hay phân quyền người dùng.</p></section>
    <section class="card"><h2>Nhận diện & video</h2><div id="server-config"></div>
      <p class="muted">Ngưỡng nhận diện được cấu hình trên máy chủ. Đổi biến môi trường <code>SIM_THRESHOLD</code> và khởi động lại backend để áp dụng.</p>
    </section>`;
  function refresh() {
    const config = state.config;
    root.querySelector('#server-config').innerHTML = config ? `<dl class="settings-list">
      <div><dt>Ngưỡng cosine similarity</dt><dd>${esc(config.similarity_threshold)}</dd></div>
      <div><dt>Độ phân giải video</dt><dd>${esc(config.video_width)} × ${esc(config.video_height)}</dd></div>
      <div><dt>Tốc độ khung hình</dt><dd>${esc(config.video_fps)} FPS</dd></div>
      <div><dt>Thời lượng quay trên UI</dt><dd>${esc(config.record_seconds)} giây</dd></div>
      <div><dt>Giới hạn upload</dt><dd>${config.video_max_bytes / 1024 / 1024} MB · ${esc(config.video_max_frames)} khung hình</dd></div>
    </dl>` : '<p class="muted">Chưa tải được cấu hình máy chủ.</p>';
  }
  refresh();
  return { refresh };
}
