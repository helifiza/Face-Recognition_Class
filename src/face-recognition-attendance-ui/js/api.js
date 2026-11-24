export class ApiError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const messages = {
  'Duplicate data or invalid relationship': 'Mã đã tồn tại hoặc dữ liệu liên kết không hợp lệ.',
  'Database unavailable': 'Không kết nối được cơ sở dữ liệu.',
  'Session not found': 'Không tìm thấy buổi học.',
  'Session must be OPEN': 'Hãy mở buổi học trước khi điểm danh.',
  'Session is no longer OPEN': 'Buổi học đã đóng trong lúc xử lý video.',
  'Student is not enrolled in this course': 'Sinh viên chưa được thêm vào học phần này.',
  'Active student not found': 'Không tìm thấy sinh viên đang hoạt động.',
  'Student not found': 'Không tìm thấy sinh viên. Hãy làm mới danh sách.',
  'Student has attendance or alert history; set status to INACTIVE instead': 'Không thể xóa sinh viên đã có lịch sử điểm danh hoặc cảnh báo. Bấm Sửa và chuyển trạng thái sang Ngừng hoạt động để giữ lịch sử.',
  'Video exceeds 20 MB': 'Video vượt quá 20 MB.',
  'Supply a constant-frame-rate 30 FPS video': 'Cần video có tốc độ cố định 30 FPS. Hãy quay lại hoặc tải video đúng định dạng.',
  'Video frames must be 640x480': 'Video phải có độ phân giải 640 × 480.',
  'Video must contain at least one frame': 'Không đọc được khung hình trong video. Hãy quay lại hoặc chọn video khác.',
  'Video must be at most 300 frames': 'Video vượt quá 300 khung hình (10 giây ở 30 FPS).',
  'Video must be at most 10 seconds': 'Video dài quá 10 giây. Hãy quay lại clip ngắn hơn.',
  'WebM must contain increasing frame timestamps': 'Không đọc được thời gian khung hình WebM. Hãy quay lại hoặc tải video MP4.',
  'WebM must be recorded at approximately 30 FPS': 'Nhịp khung hình WebM không đạt 30 FPS. Hãy dùng camera 30 FPS hoặc video MP4 phù hợp.',
  'Exactly one continuous face is required': 'Video cần có đúng một khuôn mặt liên tục trong khung hình.',
  'Face track changed; record a new clip': 'Khuôn mặt di chuyển quá nhiều. Hãy giữ yên và quay lại.',
};

export function errorMessage(detail) {
  if (Array.isArray(detail)) return detail.map(item => `${(item.loc || []).slice(1).join('.')}: ${item.msg}`).join('; ');
  if (detail && typeof detail === 'object') {
    if (detail.status === 'FAKE') return 'Tín hiệu mạch chưa đạt yêu cầu. Giữ yên, tăng ánh sáng và quay lại.';
    if (detail.status === 'COLLECTING') return 'Chưa đủ tín hiệu mạch. Hãy quay liên tục khoảng 8 giây.';
    return detail.message || JSON.stringify(detail);
  }
  return messages[detail] || detail || 'Yêu cầu không thành công.';
}

export async function request(path, { method = 'GET', body, timeout = 15000, signal } = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeout);
  const multipart = body instanceof FormData;
  try {
    const response = await fetch(path, {
      method, signal: controller.signal, cache: 'no-store',
      headers: body && !multipart ? { 'Content-Type': 'application/json' } : {},
      body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new ApiError(`Máy chủ trả về phản hồi không hợp lệ (HTTP ${response.status}).`, response.status); }
    if (!response.ok) throw new ApiError(errorMessage(data?.detail), response.status, data?.detail);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('Yêu cầu bị hủy hoặc hết thời gian chờ. Hãy làm mới dữ liệu trước khi thử lại.', 0);
    throw new ApiError('Không kết nối được backend. Kiểm tra máy chủ và kết nối mạng.', 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

async function listAll(path) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const separator = path.includes('?') ? '&' : '?';
    const page = await request(`${path}${separator}limit=500&offset=${offset}`);
    if (!Array.isArray(page)) throw new ApiError('Danh sách trả về không hợp lệ.', 0);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}

function upload(path, file) {
  const body = new FormData();
  body.append('video', file, file.name);
  return request(path, { method: 'POST', body, timeout: 180000 });
}

export const api = {
  config: () => request('/config'),
  students: () => listAll('/students'),
  courses: () => listAll('/courses'),
  enrollments: () => listAll('/enrollments'),
  sessions: () => listAll('/sessions'),
  createStudent: body => request('/students', { method: 'POST', body }),
  updateStudent: (id, body) => request(`/students/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteStudent: id => request(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createCourse: body => request('/courses', { method: 'POST', body }),
  enroll: body => request('/enrollments', { method: 'POST', body }),
  createSession: body => request('/sessions', { method: 'POST', body }),
  setSessionStatus: (id, status) => request(`/sessions/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { status } }),
  attendance: (id, signal) => request(`/sessions/${encodeURIComponent(id)}/attendance`, { signal }),
  registerFace: (id, file) => upload(`/students/${encodeURIComponent(id)}/face`, file),
  recognize: (id, file) => upload(`/sessions/${encodeURIComponent(id)}/recognize`, file),
};
