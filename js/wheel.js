// WheelEvent has no portable contact-start/end ID. Without explicit momentum,
// use quiet gaps or a sustained direction change, not amplitude spikes, to rearm.
export const WHEEL_QUIET_MS = 220;
export class WheelGesture {
  constructor() { this.reset(); this.serial = 0; }
  reset() {
    this.phase = 'idle'; this.lastAt = -Infinity;
    this.x = 0; this.y = 0; this.momentum = false;
    this.direction = null; this.recognizedAt = -Infinity; this.candidate = null;
  }
  lock(at) {
    this.phase = 'locked'; this.lastAt = at;
    this.direction = null; this.candidate = null;
  }
  accept(x, y, at, start, ended) {
    this.x = x; this.y = y; this.phase = 'locked';
    this.direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'x+' : 'x-') : (y > 0 ? 'y+' : 'y-');
    this.recognizedAt = at; this.candidate = null;
    return { x, y, id: this.serial, start, ended, reason: 'recognized' };
  }
  push(x, y, at, momentum) {
    const restart = this.phase === 'idle' || at - this.lastAt >= WHEEL_QUIET_MS
      || (this.momentum && momentum === false);
    // An out-of-order packet must not manufacture a quiet gap for the next one.
    this.lastAt = Math.max(this.lastAt, at);
    this.momentum = momentum === true;
    if (momentum === true) {
      this.phase = 'locked';
      this.candidate = null;
      return { reason: 'momentum', id: this.serial };
    }
    const ended = restart && this.serial ? this.serial : null;
    if (restart) {
      this.phase = 'collecting'; this.x = 0; this.y = 0; this.serial++; this.candidate = null;
    }
    if (this.phase === 'locked') {
      // Fallback for engines without an explicit momentum signal.
      // Require sustained, dominant new direction; never rearm on amplitude alone.
      // A reversal within one physical contact is indistinguishable from a new
      // swipe here. Same-direction repeats deliberately still need a quiet gap.
      if (typeof momentum !== 'boolean' && this.direction && at - this.recognizedAt >= 80) {
        const major = Math.max(Math.abs(x), Math.abs(y));
        const minor = Math.min(Math.abs(x), Math.abs(y));
        const direction = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'x+' : 'x-') : (y > 0 ? 'y+' : 'y-');
        if (major >= 3 && major >= minor * 1.5 && direction !== this.direction) {
          if (!this.candidate || this.candidate.direction !== direction
            || at < this.candidate.lastAt || at - this.candidate.startAt > 100) {
            this.candidate = { direction, startAt: at, lastAt: at, count: 0, x: 0, y: 0 };
          }
          const c = this.candidate;
          c.lastAt = at; c.count++; c.x += x; c.y += y;
          if (c.count >= 3 && at - c.startAt >= 24 && Math.max(Math.abs(c.x), Math.abs(c.y)) >= 48) {
            const previous = this.serial++;
            return this.accept(c.x, c.y, at, true, previous);
          }
        } else this.candidate = null;
      } else this.candidate = null;
      return { reason: 'locked', id: this.serial };
    }
    this.x += x; this.y += y;
    const major = Math.max(Math.abs(this.x), Math.abs(this.y));
    const minor = Math.min(Math.abs(this.x), Math.abs(this.y));
    if (major < 20 || major < minor * 1.3) return { reason: 'threshold', id: this.serial, start: restart, ended };
    return this.accept(this.x, this.y, at, restart, ended);
  }
}
