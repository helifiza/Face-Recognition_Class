# AttendanceAI — giao diện kết nối FastAPI

Chạy từ thư mục gốc dự án:

```powershell
.venv\Scripts\python.exe -m uvicorn src.main:app --reload
```

Database PostgreSQL/pgvector phải đang chạy (`docker compose up -d db`).
Mở **http://localhost:8000/ui/**. Không mở `index.html` trực tiếp vì UI dùng ES modules
và gọi API cùng origin. Không cần cài npm packages hoặc build frontend.
Chạy toàn bộ bằng Docker: `docker compose up --build -d`.

## Tổ chức mã

| Đường dẫn | Trách nhiệm |
| --- | --- |
| `index.html` | Khung ứng dụng, sidebar, topbar, vùng nội dung |
| `app.js` | Điều hướng, khởi tạo màn hình, đồng bộ toàn cục, theme |
| `css/base.css` | Biến màu, reset, typography, form cơ bản |
| `css/layout.css` | Sidebar, lưới, responsive |
| `css/components.css` | Card, bảng, camera, thông báo, biểu đồ |
| `js/api.js` | Fetch JSON/multipart, phân trang, timeout, lỗi FastAPI |
| `js/state.js` | Dữ liệu chung, trạng thái kết nối, đồng bộ |
| `js/camera.js` | Chọn video, quay 8 giây, dọn stream/timer/object URL |
| `js/session-records.js` | Tải điểm danh, polling và loại bỏ phản hồi buổi cũ |
| `js/ui.js` | Thông báo, nhãn trạng thái, bảng, kết quả liveness |
| `js/utils.js` | Escape HTML, ngày giờ, đối chiếu sĩ số, xuất CSV |
| `js/views/` | Tổng quan, sinh viên, học phần, đăng ký, điểm danh, báo cáo, cài đặt |
| `tests/` | Kiểm thử bằng Node test runner |

Mỗi view nhận `(root, navigate, options)` và trả các hàm vòng đời khi cần:
`refresh()` cập nhật dữ liệu, `reload()` tải lại dữ liệu riêng,
`canLeave()` chặn chuyển màn hình khi đang lưu, `destroy()` giải phóng tài nguyên.
Không gắn event handler inline vào HTML; dữ liệu người dùng được escape trước khi hiển thị.

## Các luồng đã nối backend

- Sinh viên: `GET/POST /students`; `face_registered` lấy từ database.
- Học phần: `GET/POST /courses`, `GET/POST /enrollments`.
- Buổi học: `GET/POST /sessions`, `PATCH /sessions/{id}/status`.
- Đăng ký mặt: `POST /students/{id}/face`, multipart field **video**.
- Điểm danh: `POST /sessions/{id}/recognize`, sau đó tải `GET /sessions/{id}/attendance`.
- Báo cáo: đối chiếu danh sách học phần và bản ghi điểm danh; xuất dữ liệu đang lọc ra CSV.
- Cài đặt: `GET /config`; ngưỡng nhận diện do backend quyết định.

Camera cần localhost/HTTPS, quyền truy cập và chế độ 640×480 / 30 FPS. UI gửi video
8 giây, không ghi âm; backend quyết định liveness/nhận diện và kiểm tra giới hạn 20 MB,
300 frames. `COLLECTING`, `FAKE`, `UNKNOWN` không được UI coi là điểm danh thành công.
WebM/VP8 được ưu tiên; nếu trình duyệt không quay được, dùng video MP4/WebM phù hợp.

Không có đăng nhập giả hoặc dữ liệu điểm danh lưu trong localStorage. Backend hiện chưa
có xác thực, vì vậy cổng mở trực tiếp. Theme sáng/tối là tùy chọn duy nhất lưu trong trình duyệt.
Khi mất kết nối, UI báo lỗi và giữ dữ liệu của lần đồng bộ gần nhất. Báo cáo chỉ cho xuất
khi đã tải thành công; chỉ tính vắng khi buổi đóng và đối chiếu với sĩ số hiện tại.

## Kiểm thử

Từ thư mục gốc dự án:

```powershell
node --test src/face-recognition-attendance-ui/tests/*.test.js
.venv\Scripts\python.exe -m unittest src.test_backend src.test_ui -v
```

Hoặc `npm test` tại thư mục UI (Node 22+). Test Python cần `requirements-dev.txt`.
Xem README gốc để chạy bài kiểm thử PostgreSQL có rollback dữ liệu thử.

Kiểm tra tương tác nút đăng ký trên trình duyệt tại
`http://localhost:8000/ui/tests/browser/registration.html` sau khi cập nhật backend/image.
Các bài kiểm tra dùng DOM thật, sinh viên mẫu, sự kiện camera giả lập và API giả lập;
không mở webcam thật hoặc gửi video vào database. Bao gồm chọn sinh viên trước/sau video,
đổi sinh viên, thử lại sau lỗi API và sự kiện kết thúc của bản ghi camera cũ.
