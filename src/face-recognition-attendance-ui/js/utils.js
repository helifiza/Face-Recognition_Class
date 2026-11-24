export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateLabel(date) {
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('vi-VN') : '—';
}

export function timeLabel(value) {
  return value ? new Date(value).toLocaleString('vi-VN') : '—';
}

export function sessionLabel(session) {
  return `${session.course_name || session.course_id} · ${dateLabel(session.session_date)} · ${session.start_time.slice(0, 5)} · #${session.session_id}`;
}

export function formValues(form) {
  return Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]));
}

export function rosterRows(students, enrollments, session, logs) {
  if (!session) return [];
  const enrolled = new Set(enrollments.filter(row => row.course_id === session.course_id).map(row => row.student_id));
  const byId = new Map(logs.map(row => [row.student_id, row]));
  logs.forEach(row => enrolled.add(row.student_id));
  const byStudent = new Map(students.map(row => [row.student_id, row]));
  return [...enrolled].sort().map(id => {
    const log = byId.get(id);
    return { student_id: id, full_name: log?.full_name || byStudent.get(id)?.full_name || id,
      class_name: byStudent.get(id)?.class_name || '', check_time: log?.check_time || null,
      similarity: log?.similarity ?? null,
      status: log?.status || (session.status === 'CLOSED' ? 'ABSENT' : 'PENDING') };
  });
}

export function csvText(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');
}

export function downloadCsv(name, rows) {
  const url = URL.createObjectURL(new Blob([csvText(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
