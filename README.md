# Face-Recognition_Class

Ứng dụng điểm danh lớp học gồm UI AttendanceAI, backend FastAPI chạy CPU và PostgreSQL/pgvector.
UI được phục vụ cùng backend tại `/ui/`, gọi API cùng origin và không cần bước build frontend.

## Cấu trúc

```text
src/
  config.py                # Đường dẫn, DATABASE_URL, ngưỡng cosine
  database.py              # Schema entities: sinh viên, học phần, buổi học, điểm danh
  vector_database.py       # Schema vectors: vector(512), cosine, HNSW
  schemas.py               # Kiểm tra dữ liệu API
  main.py                  # FastAPI và khởi tạo database
  video_api.py             # Đăng ký mặt và nhận diện từ video
  core/
    face_pipeline.py       # YOLOv5-Face ONNX → ROI → ArcFace ONNX
    rppg_liveness.py       # POS, Butterworth, Welch, trạng thái rPPG
  test_backend.py
  test_ui.py               # Kiểm thử tích hợp UI/API và luồng PostgreSQL
  face-recognition-attendance-ui/
    index.html             # Khung trang và điều hướng
    app.js                 # Khởi tạo, chuyển màn hình, đồng bộ dữ liệu
    styles.css             # Entry point CSS
    css/                   # Tokens, bố cục, thành phần giao diện
    js/
      api.js               # HTTP, phân trang, multipart video, lỗi API
      state.js             # Dữ liệu dùng chung từ backend
      camera.js            # Quay video, upload, giải phóng webcam
      session-records.js   # Tải điểm danh, polling, hủy request cũ
      ui.js                # Thành phần hiển thị và thông báo
      utils.js             # Ngày giờ, báo cáo và CSV
      views/               # Từng màn hình chức năng độc lập
    tests/                 # Kiểm thử JavaScript, không cần npm install
models/
data/
compose.yaml
Dockerfile
requirements.txt
```

## Chạy backend

Mở Docker Desktop, đợi Engine hoạt động, rồi chạy tại thư mục dự án:

```powershell
docker compose up --build -d
```

Những lần khởi động sau dùng `docker compose up -d`; chỉ thêm `--build` khi sửa mã nguồn,
giao diện, requirements hoặc Dockerfile. Dừng hệ thống bằng `docker compose stop`.

InsightFace kéo theo `opencv-python`, nên requirements chỉ dùng bản OpenCV này để tránh
cài đồng thời với `opencv-python-headless` (hai gói dùng chung module `cv2`). Dockerfile
cài các thư viện hệ thống OpenCV cần và kiểm tra import backend/căn chỉnh mặt ngay lúc build.
Nếu image cũ báo thiếu `libxcb.so.1` hoặc `libGL.so.1`, dựng lại bằng
`docker compose up --build -d backend` để áp dụng Dockerfile mới.

Giao diện: http://localhost:8000/ (chuyển tới `/ui/`).
Swagger API: http://localhost:8000/docs. Health: http://localhost:8000/health.

Hoặc chạy Python trên máy và chỉ dùng Docker cho database:

```powershell
docker compose up -d db
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn src.main:app --reload
```

## Sử dụng giao diện

1. **Sinh viên**: tạo hồ sơ sinh viên, tìm kiếm và xem trạng thái đăng ký khuôn mặt.
2. **Học phần & buổi học**: tạo học phần, thêm sinh viên vào học phần, tạo lịch học.
3. **Đăng ký khuôn mặt**: chọn sinh viên đã tạo, quay video 8 giây hoặc tải video phù hợp,
   gửi lên backend để kiểm tra liveness và lưu embedding. Lỗi liveness không được báo thành công.
4. **Điểm danh**: chọn buổi, bấm **Mở điểm danh**, quay/tải video và bấm **Nhận diện & điểm danh**.
   Bảng kết quả tự tải lại mỗi 10 giây khi màn hình đang mở; bấm **Đóng buổi học** khi kết thúc.
5. **Báo cáo**: chọn học phần/buổi, lọc trạng thái và xuất CSV có hỗ trợ tiếng Việt.
   Chỉ đánh dấu vắng khi buổi đã đóng; buổi chưa đóng hiển thị **Chưa điểm danh**.

Mở UI qua FastAPI, không mở trực tiếp `index.html` bằng `file://`.
Camera cần `localhost` hoặc HTTPS, quyền camera và thiết bị hỗ trợ 640×480 / 30 FPS.
Giao diện có chế độ sáng/tối, bố cục di động, thông báo khi mất kết nối và nút làm mới dữ liệu.
Dữ liệu nghiệp vụ lưu trong PostgreSQL; chỉ lựa chọn sáng/tối lưu trong trình duyệt.

Backend hiện chưa có xác thực/phân quyền nên UI vào trực tiếp cổng quản lý, không dùng màn hình
đăng nhập mô phỏng của bản mẫu. Giữ môi trường sử dụng nội bộ. Cài đặt ngưỡng nhận diện trên
UI chỉ đọc từ `/config`; thay `SIM_THRESHOLD` trên backend để điều chỉnh.

## Model và định dạng video

Đặt model vào các đường dẫn sau trước khi gọi API khuôn mặt:

```text
models/yolov5n-face.onnx
models/buffalo_l/w600k_r50.onnx
```

Adapter hiện sử dụng **ONNX trên CPU**. File `.pt` trong sơ đồ cần export từ
[YOLOv5-Face](https://github.com/deepcam-cn/yolov5-face) thành ONNX có đầu vào
`[1,3,640,640]`, đầu ra đã decode `[1,N,16]`: xywh, objectness, 10 tọa độ landmark,
class probability. Không tương thích tự động với YOLO phổ thông hoặc graph có NMS tích hợp.
ArcFace dùng model recognition của buffalo_l, đầu vào RGB 112×112 đã căn chỉnh theo
5 landmarks, chuẩn hóa `(pixel - 127.5)/127.5`, đầu ra 512 chiều chuẩn hóa L2.
Model được nạp khi gọi API video lần đầu; các API quản lý lớp chạy được khi chưa có model.

Upload MP4/WebM (hoặc MOV nếu OpenCV hỗ trợ codec), kích thước 640×480, tốc độ cố định 30 FPS,
tối đa 300 frames và 20 MB. UI ưu tiên WebM/VP8 cho video quay bằng MediaRecorder,
có thể dùng MP4 nếu trình duyệt hỗ trợ. Với WebM, backend kiểm tra nhịp khoảng 30 FPS bằng
trung bình khoảng cách timestamp (loại khoảng gián đoạn dài khi ước lượng FPS), giới hạn
thời lượng 10 giây và đưa timestamp thực vào PulseGate
để reset khi mất khung hình; không dùng giá trị FPS=1000 mà OpenCV có thể báo từ timebase WebM.
Backend vẫn kiểm tra định dạng, kích thước và nhịp khung hình thực tế;
nếu thiết bị/trình duyệt tạo clip không đạt, UI hiển thị lỗi để quay lại hoặc tải clip phù hợp.
Một video chỉ chứa một khuôn mặt liên tục. Backend từ chối mất mặt, nhiều mặt hoặc
bbox thay đổi mạnh. Theo dõi bằng IoU là cơ chế đơn giản, chưa bảo đảm danh tính liên tục.
Webcam mở trên trình duyệt; server chỉ xử lý clip gửi lên. UI tắt camera sau khi quay
và khi chuyển màn hình; không ghi âm.

rPPG dùng cửa sổ 120 frames, cập nhật mỗi 15 frames; POS theo công thức trong hình,
lọc Butterworth bậc 3 ở 0.75–2.5 Hz, Welch SNR quanh đỉnh và họa âm ±0.15 Hz.
Ngưỡng mặc định SNR ≥ 0.5 dB, độ lệch chuẩn BPM ≤ 10 qua 3 cửa sổ đạt chất lượng.
Vì cần 3 cửa sổ nên nên gửi clip 5–10 giây. Luồng điểm danh kiểm tra video và phát hiện
khuôn mặt, trích embedding ArcFace rồi so khớp trước. Chỉ khi khớp sinh viên thuộc học phần
mới tính rPPG/SNR từ các mẫu RGB của cùng video và ghi điểm danh nếu kết quả cuối là `REAL`.
Không khớp trả `UNKNOWN`, với `liveness.status=NOT_CHECKED` và BPM/SNR là `null`.
`COLLECTING`/`FAKE` trả cả sinh viên đã khớp và chỉ số tín hiệu, nhưng không ghi điểm danh.
Log điểm danh theo thứ tự `MATCH` → `CHECK_LIVENESS` → `LIVENESS` → `RESULT`;
không khớp có `SKIP_LIVENESS` và không chạy PulseGate. Các mẫu RGB chỉ giữ trong bộ nhớ
của yêu cầu; không cần giải mã hay chạy YOLO hai lần trên cùng video.
Đăng ký khuôn mặt vẫn kiểm tra rPPG trước khi trích và lưu embedding.
`FAKE` ở đây chỉ là không đạt chất lượng tín hiệu mạch.
Đây là triển khai POS tối giản theo mô tả, chưa tích hợp trực tiếp rPPG-Toolbox/PhysNet.
Tín hiệu mạch trong video phát lại có thể vượt qua kiểm tra; chưa được kiểm định chống giả mạo.
Chưa đo tốc độ, độ chính xác hoặc các mức tiết kiệm CPU nêu trong hình.

## API và trình tự sử dụng

1. `POST /students`: tạo sinh viên (`student_id`, `full_name`, tùy chọn `class_name`, `faculty`, `email`).
2. `POST /courses`: tạo học phần (`course_id`, `course_name`, tùy chọn `lecturer`).
3. `POST /enrollments`: thêm sinh viên vào học phần (`student_id`, `course_id`).
4. `POST /sessions`: tạo buổi học (`course_id`, `session_date`, `start_time`, `end_time`, tùy chọn `room`).
5. `POST /students/{student_id}/face`: multipart field `video`, đăng ký vector sau khi gate đạt REAL.
6. `PATCH /sessions/{session_id}/status`: JSON `{"status":"OPEN"}` để mở điểm danh.
7. `POST /sessions/{session_id}/recognize`: multipart field `video`, nhận diện và ghi điểm danh.
8. `GET /sessions/{session_id}/attendance`: xem kết quả; đổi status `CLOSED` khi kết thúc.

Trong màn hình **Sinh viên**, bấm **Sửa** để đổi họ tên, lớp, khoa, email hoặc trạng thái;
mã sinh viên được giữ cố định. **Hủy sửa** quay lại biểu mẫu thêm mới.
`PATCH /students/{student_id}` nhận các trường cần sửa; có thể gửi `null` để xóa lớp,
khoa hoặc email. `full_name` và `status` không được rỗng/null.

**Xóa** yêu cầu xác nhận và gọi `DELETE /students/{student_id}` (thành công: HTTP 204).
Chỉ xóa sinh viên chưa có lịch sử điểm danh hoặc cảnh báo; mẫu khuôn mặt và đăng ký học phần
liên quan được xóa cùng trong database. Nếu đã có lịch sử, API trả HTTP 409: dùng **Sửa →
Ngừng hoạt động** để ngừng nhận diện và giữ lại lịch sử. Có thể chuyển lại **Hoạt động** sau đó.

Có `GET /students`, `/courses`, `/sessions`, `/enrollments` và `POST /vectors/search`
(`embedding`: 512 số hữu hạn, `limit`: 1–100) để kiểm tra tìm kiếm.
API tìm vector không ghi điểm danh. Vector rỗng, vector zero, NaN/Infinity bị từ chối.
Các API danh sách hỗ trợ `limit` (1–500), `offset`; UI tự tải hết các trang.
`GET /students` bổ sung `face_registered`; `GET /sessions` bổ sung `course_name`,
`attendance_count`, `enrolled_count`; `GET /enrollments` có bộ lọc `course_id` tùy chọn.
`GET /config` trả cấu hình nhận diện/video công khai, không trả thông tin kết nối database.
Cosine similarity = `1 - (embedding <=> query_vector)`, chỉ mục HNSW dùng
`vector_cosine_ops` theo [pgvector](https://github.com/pgvector/pgvector).
HNSW là tìm kiếm gần đúng; cần đánh giá recall và hiệu chỉnh ngưỡng với dữ liệu thực tế.

Nhận diện tìm sinh viên ACTIVE có vector gần nhất; ngưỡng mặc định `SIM_THRESHOLD=0.75`.
Chỉ ghi nếu sinh viên thuộc học phần và buổi đang OPEN. Khóa duy nhất
`(session_id, student_id)` chống ghi trùng kể cả request đồng thời. Trả `UNKNOWN` khi
không đạt ngưỡng, `ALREADY_PRESENT` khi đã điểm danh. Trạng thái OPEN/CLOSED do người vận hành
điều khiển, chưa tự áp giờ học hay phân loại đi muộn. Báo cáo UI đối chiếu với danh sách
học phần hiện tại, chưa có snapshot sĩ số theo thời điểm buổi học.

## Kiểm thử

```powershell
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m unittest src.test_backend src.test_ui -v
node --test src/face-recognition-attendance-ui/tests/*.test.js
```

Để kiểm tra thêm luồng API với PostgreSQL/pgvector đang chạy:

```powershell
$env:ATTENDANCE_TEST_DB = '1'
.venv\Scripts\python.exe -m unittest src.test_ui.DatabaseFlowTests -v
Remove-Item Env:ATTENDANCE_TEST_DB
```

Test database dùng transaction rollback để không lưu sinh viên/học phần/điểm danh thử.
Phần phân tích video và kết quả nhận diện được giả lập trong bài kiểm thử này; cần dùng
video khuôn mặt thật để đánh giá pipeline/model và chất lượng rPPG.

