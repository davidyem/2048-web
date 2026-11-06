// WheelEvent has no portable contact-start/end ID. Without explicit momentum,
// silence is only a heuristic: prefer missing an ambiguous gesture to repeating it.
export const WHEEL_QUIET_MS = 220;
export class WheelGesture {
  constructor() { this.reset(); this.serial = 0; }
  reset() {
    this.phase = 'idle'; this.lastAt = -Infinity;
    this.x = 0; this.y = 0; this.momentum = false;
  }
  lock(at) { this.phase = 'locked'; this.lastAt = at; }
  push(x, y, at, momentum) {
    const restart = this.phase === 'idle' || at - this.lastAt >= WHEEL_QUIET_MS
      || (this.momentum && momentum === false);
    // An out-of-order packet must not manufacture a quiet gap for the next one.
    this.lastAt = Math.max(this.lastAt, at);
    this.momentum = momentum === true;
    if (momentum === true) {
      this.phase = 'locked';
      return { reason: 'momentum', id: this.serial };
    }
    const ended = restart && this.serial ? this.serial : null;
    if (restart) {
      this.phase = 'collecting'; this.x = 0; this.y = 0; this.serial++;
    }
    if (this.phase === 'locked') return { reason: 'locked', id: this.serial };
    this.x += x; this.y += y;
    const major = Math.max(Math.abs(this.x), Math.abs(this.y));
    const minor = Math.min(Math.abs(this.x), Math.abs(this.y));
    if (major < 20 || major < minor * 1.3) return { reason: 'threshold', id: this.serial, start: restart, ended };
    this.phase = 'locked';
    return { x: this.x, y: this.y, id: this.serial, start: restart, ended, reason: 'recognized' };
  }
}
