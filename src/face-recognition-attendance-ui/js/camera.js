import { toast } from './ui.js';

const MAX_BYTES = 20 * 1024 * 1024;

export function validateVideo(file) {
  if (!file || file.size === 0) throw new Error('Chọn một video có nội dung.');
  if (file.size > MAX_BYTES) throw new Error('Video vượt quá 20 MB.');
  if (!/\.(mp4|webm|mov)$/i.test(file.name) && !/^video\/(mp4|webm|quicktime)$/.test(file.type)) {
    throw new Error('Chọn video MP4, WebM hoặc MOV. Ảnh tĩnh không dùng được để kiểm tra liveness.');
  }
}

export class VideoInput {
  constructor(root, onChange = () => {}, seconds = 8) {
    this.root = root;
    this.onChange = onChange;
    this.seconds = seconds;
    this.file = null;
    this.recording = false;
    this.opening = false;
    this.version = 0;
    root.innerHTML = `<div class="camera-box"><video playsinline muted aria-label="Xem trước video khuôn mặt"></video></div>
      <p class="capture-status" role="status">Camera đang tắt. Bật camera hoặc chọn video có sẵn.</p>
      <div class="toolbar capture-actions"><button type="button" class="btn-outline" data-camera>Bật camera</button>
        <button type="button" class="btn-primary" data-record disabled>Quay ${seconds} giây</button></div>
      <label class="file-label">Hoặc tải video có sẵn<input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"></label>
      <p class="muted small">640 × 480 · 30 FPS · 5–10 giây · tối đa 20 MB. Giữ yên, đủ sáng và chỉ một khuôn mặt trong khung hình.</p>`;
    this.video = root.querySelector('video');
    this.status = root.querySelector('.capture-status');
    this.cameraButton = root.querySelector('[data-camera]');
    this.recordButton = root.querySelector('[data-record]');
    this.input = root.querySelector('input');
    this.cameraButton.onclick = () => this.stream ? this.stopCamera() : this.startCamera();
    this.recordButton.onclick = () => this.record();
    this.input.onchange = () => {
      const file = this.input.files[0];
      if (!file) return;
      this.stopCamera();
      this.setFile(null);
      try { validateVideo(file); this.setFile(file); }
      catch (error) { this.input.value = ''; this.status.textContent = error.message; toast(error.message, true); }
    };
  }

  updateControls() {
    this.cameraButton.disabled = Boolean(this.locked || this.opening || this.recording);
    this.cameraButton.textContent = this.stream ? 'Tắt camera' : 'Bật camera';
    this.recordButton.disabled = Boolean(this.locked || this.opening || this.recording || !this.stream);
    this.input.disabled = Boolean(this.locked || this.opening || this.recording);
  }

  setBusy(value) { this.locked = value; this.updateControls(); }

  setFile(file) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.file = file;
    this.video.removeAttribute('src');
    this.video.controls = Boolean(file);
    if (file) {
      this.url = URL.createObjectURL(file);
      this.video.src = this.url;
      this.status.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB · Sẵn sàng gửi`;
    }
    if (!this.destroyed) this.onChange(file);
  }

  async startCamera() {
    if (this.opening || this.locked || this.destroyed) return;
    const version = ++this.version;
    this.opening = true;
    this.updateControls();
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
        throw new Error('Trình duyệt chưa hỗ trợ quay video. Dùng Chrome/Edge tại localhost hoặc HTTPS, hoặc tải video có sẵn.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { exact: 640 }, height: { exact: 480 }, frameRate: { ideal: 30, min: 29, max: 31 } },
      });
      if (this.destroyed || version !== this.version) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.setFile(null);
      this.input.value = '';
      this.video.srcObject = stream;
      await this.video.play();
      if (this.destroyed || version !== this.version) return;
      this.status.textContent = `Camera sẵn sàng. Nhấn “Quay ${this.seconds} giây” khi khuôn mặt ở giữa khung hình.`;
    } catch (error) {
      if (this.destroyed || version !== this.version) return;
      this.stopCamera();
      const message = error.name === 'NotAllowedError' ? 'Quyền camera bị từ chối. Cho phép camera trong trình duyệt hoặc tải video.'
        : error.name === 'OverconstrainedError' ? 'Camera không hỗ trợ 640 × 480 ở 30 FPS. Hãy dùng camera khác hoặc tải video.'
          : error.name === 'NotFoundError' ? 'Không tìm thấy camera. Bạn có thể tải video có sẵn.' : error.message;
      this.status.textContent = message;
      toast(message, true);
    } finally { this.opening = false; this.updateControls(); }
  }

  record() {
    if (!this.stream || this.recording || this.locked) return;
    try {
      const mimeType = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Trình duyệt không có bộ mã hóa video phù hợp. Hãy tải video có sẵn.');
      const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 2000000 });
      this.recorder = recorder;
      this.setFile(null);
      this.recording = true;
      this.onChange(null);
      const version = this.version;
      const chunks = [];
      let failed = false;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        failed = true;
        this.status.textContent = 'Không quay được video. Hãy thử lại hoặc tải video.';
        this.stopCamera();
      };
      recorder.onstop = () => {
        if (this.destroyed || version !== this.version || failed) return;
        this.clearTimers();
        this.recording = false;
        this.releaseTracks();
        this.updateControls();
        try {
          const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const file = new File(chunks, `face-${Date.now()}.${extension}`, { type: recorder.mimeType || mimeType });
          validateVideo(file);
          this.setFile(file);
        } catch (error) {
          this.setFile(null);
          this.status.textContent = error.message;
          toast(error.message, true);
        }
      };
      recorder.start(250);
      const start = Date.now();
      const tick = () => { this.status.textContent = `Đang quay… ${Math.min(this.seconds, Math.floor((Date.now() - start) / 1000))} / ${this.seconds} giây. Giữ yên khuôn mặt.`; };
      tick();
      this.interval = setInterval(tick, 250);
      this.timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, this.seconds * 1000);
      this.updateControls();
    } catch (error) {
      this.recording = false;
      this.clearTimers();
      this.updateControls();
      if (!this.destroyed) this.onChange(this.file);
      toast(error.message, true);
    }
  }

  clearTimers() { clearTimeout(this.timer); clearInterval(this.interval); }
  releaseTracks() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
  stopCamera() {
    this.version++;
    this.clearTimers();
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recording = false;
    this.releaseTracks();
    this.updateControls();
    if (!this.file) this.status.textContent = 'Camera đang tắt. Bật camera hoặc chọn video có sẵn.';
    if (!this.destroyed) this.onChange(this.file);
  }
  clear() { this.stopCamera(); this.setFile(null); this.input.value = ''; this.status.textContent = 'Camera đang tắt. Bật camera hoặc chọn video có sẵn.'; }
  destroy() { this.destroyed = true; this.stopCamera(); this.setFile(null); }
}
