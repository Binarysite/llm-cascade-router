// Reduce an error to a label that is safe to persist in a report. Provider error bodies can echo
// a masked API key, and e.message can carry the body, so only the status code or the error name is kept.
export function safeErrorLabel(e) {
  const m = /HTTP (\d{3})/.exec(String(e?.message ?? ''));
  if (m) return `HTTP ${m[1]}`;
  return String(e?.name ?? 'Error');
}
