// Opt-in, bounded event journal. No per-frame work in normal play.
export const tracing = new URLSearchParams(location.search).get('trace') === '1';
const entries = new Array(512);
let count = 0;
export function trace(type, details = {}) {
  if (!tracing) return;
  entries[count++ % entries.length] = { at: performance.now(), type, ...details };
}
export function traceLog() {
  const length = Math.min(count, entries.length);
  return Array.from({ length }, (_, i) => entries[(count - length + i) % entries.length]);
}
