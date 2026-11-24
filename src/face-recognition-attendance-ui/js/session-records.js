import { api } from './api.js';

export class SessionRecords {
  constructor(onChange, poll = false) {
    this.onChange = onChange;
    this.poll = poll;
    this.rows = [];
    this.version = 0;
  }
  select(id) {
    if (this.id === id) return;
    this.id = id;
    this.rows = [];
    this.loaded = false;
    this.error = '';
    return this.reload();
  }
  async reload() {
    clearTimeout(this.timer);
    this.controller?.abort();
    const version = ++this.version;
    if (!this.id || this.destroyed) { this.loading = false; this.onChange(); return; }
    this.controller = new AbortController();
    this.loading = true;
    this.onChange();
    try {
      const rows = await api.attendance(this.id, this.controller.signal);
      if (version !== this.version || this.destroyed) return;
      this.rows = rows;
      this.loaded = true;
      this.error = '';
      this.updatedAt = new Date();
    } catch (error) {
      if (version !== this.version || this.destroyed) return;
      this.error = error.message;
    } finally {
      if (version === this.version && !this.destroyed) {
        this.loading = false;
        this.onChange();
        if (this.poll) this.schedule();
      }
    }
  }
  schedule() {
    this.timer = setTimeout(() => {
      if (document.hidden) this.schedule();
      else this.reload();
    }, 10000);
  }
  destroy() {
    this.destroyed = true;
    this.version++;
    clearTimeout(this.timer);
    this.controller?.abort();
  }
}
