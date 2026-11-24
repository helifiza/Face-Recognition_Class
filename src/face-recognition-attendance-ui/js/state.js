import { api } from './api.js';

export const state = {
  students: [], courses: [], enrollments: [], sessions: [], config: null,
  loaded: false, loading: false, error: '', updatedAt: null,
};
const listeners = new Set();
let pending;
export function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
function notify() { listeners.forEach(listener => listener()); }

export function refreshData() {
  if (pending) return pending;
  state.loading = true;
  notify();
  pending = (async () => {
    try {
      const [students, courses, enrollments, sessions, config] = await Promise.all([
        api.students(), api.courses(), api.enrollments(), api.sessions(), api.config(),
      ]);
      Object.assign(state, { students, courses, enrollments, sessions, config, loaded: true, error: '', updatedAt: new Date() });
      return true;
    } catch (error) {
      state.error = error.message;
      return false;
    } finally {
      state.loading = false;
      pending = null;
      notify();
    }
  })();
  return pending;
}
