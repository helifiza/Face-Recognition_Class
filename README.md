# Face-Recognition_Class

Backend điểm danh lớp học, chạy CPU bằng FastAPI và PostgreSQL/pgvector.
Giữ các thư mục hiện có; bổ sung `src/core` cho xử lý khuôn mặt và tín hiệu.

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

Swagger API: http://localhost:8000/docs. Health: http://localhost:8000/health.

Hoặc chạy Python trên máy và chỉ dùng Docker cho database:

```powershell
docker compose up -d db
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn src.main:app --reload
```

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

Upload MP4 640×480, tốc độ cố định 30 FPS, tối đa 300 frames và 20 MB.
Một video chỉ chứa một khuôn mặt liên tục. Backend từ chối mất mặt, nhiều mặt hoặc
bbox thay đổi mạnh. Theo dõi bằng IoU là cơ chế đơn giản, chưa bảo đảm danh tính liên tục.
Không tự mở webcam trên server; frontend sau này có thể quay và gửi clip.

rPPG dùng cửa sổ 120 frames, cập nhật mỗi 15 frames; POS theo công thức trong hình,
lọc Butterworth bậc 3 ở 0.75–2.5 Hz, Welch SNR quanh đỉnh và họa âm ±0.15 Hz.
Ngưỡng mặc định SNR ≥ 2.2 dB, độ lệch chuẩn BPM ≤ 10 qua 3 cửa sổ đạt chất lượng.
Vì cần 3 cửa sổ nên nên gửi clip 5–10 giây. `COLLECTING`/`FAKE` không trích embedding
và không ghi điểm danh. `FAKE` ở đây chỉ là không đạt chất lượng tín hiệu mạch.
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

Có `GET /students`, `/courses`, `/sessions` và `POST /vectors/search`
(`embedding`: 512 số hữu hạn, `limit`: 1–100) để kiểm tra tìm kiếm.
API tìm vector không ghi điểm danh. Vector rỗng, vector zero, NaN/Infinity bị từ chối.
Cosine similarity = `1 - (embedding <=> query_vector)`, chỉ mục HNSW dùng
`vector_cosine_ops` theo [pgvector](https://github.com/pgvector/pgvector).
HNSW là tìm kiếm gần đúng; cần đánh giá recall và hiệu chỉnh ngưỡng với dữ liệu thực tế.

Nhận diện tìm sinh viên ACTIVE có vector gần nhất; ngưỡng mặc định `SIM_THRESHOLD=0.75`.
Chỉ ghi nếu sinh viên thuộc học phần và buổi đang OPEN. Khóa duy nhất
`(session_id, student_id)` chống ghi trùng kể cả request đồng thời. Trả `UNKNOWN` khi
không đạt ngưỡng, `ALREADY_PRESENT` khi đã điểm danh. Trạng thái OPEN/CLOSED do người vận hành
điều khiển, chưa tự áp giờ học hay phân loại đi muộn. Đây là API nền tảng, chưa có giao diện.

