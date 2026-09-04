const FRAME_WINDOW_MS = 5000;
const FRAME_LOG_SIZE = 640;
const FRAME_EXPORT_SIZE = 120;
const EVENT_LOG_SIZE = 80;

class RingBuffer {
  constructor(size) {
    this.values = new Array(size);
    this.size = size;
    this.count = 0;
    this.index = 0;
  }

  push(value) {
    this.values[this.index] = value;
    this.index = (this.index + 1) % this.size;
    this.count = Math.min(this.count + 1, this.size);
  }

  ordered() {
    const start = (this.index - this.count + this.size) % this.size;
    return Array.from({ length: this.count }, (_, offset) => (
      this.values[(start + offset) % this.size]
    ));
  }
}

function round(value, places = 1) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

export class PerformanceMonitor {
  constructor() {
    this.startedAt = performance.now();
    this.frames = new RingBuffer(FRAME_LOG_SIZE);
    this.events = new RingBuffer(EVENT_LOG_SIZE);
    this.inputSerial = 0;
    this.currentMove = null;
    this.lastMove = null;
    this.pendingDirection = null;
    this.lastFrameAt = 0;
    this.lastPanelUpdate = 0;
    this.createPanel();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.lastFrameAt = 0;
    });
    this.frameRequest = requestAnimationFrame(timestamp => this.sampleFrame(timestamp));
    window.__2048Perf = this;
  }

  relativeTime(timestamp = performance.now()) {
    return round(timestamp - this.startedAt, 2);
  }

  record(type, data = {}) {
    this.events.push({ t: this.relativeTime(), type, ...data });
  }

  recordInput(direction, pending) {
    const input = {
      id: ++this.inputSerial,
      at: performance.now(),
      direction
    };
    this.record('input', { id: input.id, direction, pending });
    return input;
  }

  recordPending(direction) {
    this.pendingDirection = direction;
    this.record('pending', { direction });
  }

  recordInvalidMove(input) {
    this.pendingDirection = null;
    this.record('invalid-move', { input: input?.id, direction: input?.direction });
  }

  recordMoveStart(details) {
    const startedAt = performance.now();
    this.pendingDirection = null;
    this.currentMove = {
      ...details,
      startedAt,
      firstFrameAt: null,
      actualElapsed: null
    };
    this.record('move-start', {
      id: details.id,
      input: details.input?.id,
      direction: details.direction,
      distance: details.maxDistance,
      duration: details.maxDuration,
      movingTiles: details.movingTiles,
      merge: details.merge,
      spawn: details.spawn,
      inputToSchedule: details.input ? round(startedAt - details.input.at, 2) : null
    });
  }

  recordMoveEnd(id, completed) {
    const endedAt = performance.now();
    if (this.currentMove?.id === id) {
      this.currentMove.actualElapsed = endedAt - this.currentMove.startedAt;
    }
    this.record('move-end', {
      id,
      completed,
      elapsed: this.currentMove?.id === id ? round(this.currentMove.actualElapsed, 2) : null
    });
  }

  recordCommit(details) {
    this.record('commit', details);
    if (this.currentMove?.id === details.id) {
      this.lastMove = { ...this.currentMove, committedAt: performance.now() };
      this.currentMove = null;
    }
  }

  recordLifecycle(type) {
    this.pendingDirection = null;
    this.currentMove = null;
    this.lastMove = null;
    this.record('lifecycle', { action: type });
  }

  recordPulseStart(kind, tile) {
    this.record('pulse-start', { kind, tile });
  }

  recordPulseEnd(kind, tile) {
    this.record('pulse-end', { kind, tile });
  }

  recordTileCreation(total) {
    this.record('tile-create', { total });
  }

  recordTileActivation({ id, reused, animated }) {
    this.record('tile-activate', { tile: id, reused, animated });
  }

  recordTileRecycle(poolSize) {
    this.record('tile-recycle', { poolSize });
  }

  sampleFrame(timestamp) {
    const observedAt = performance.now();
    if (this.lastFrameAt) {
      const delta = timestamp - this.lastFrameAt;
      this.frames.push({ t: this.relativeTime(timestamp), delta: round(delta, 2) });
      if (this.currentMove && this.currentMove.firstFrameAt === null) {
        this.currentMove.firstFrameAt = observedAt;
        this.record('move-first-frame', {
          id: this.currentMove.id,
          inputLatency: this.currentMove.input
            ? round(observedAt - this.currentMove.input.at, 2)
            : null
        });
      }
    }
    this.lastFrameAt = timestamp;
    if (timestamp - this.lastPanelUpdate >= 250) {
      this.lastPanelUpdate = timestamp;
      this.updatePanel(timestamp);
    }
    this.frameRequest = requestAnimationFrame(next => this.sampleFrame(next));
  }

  frameStats(now = performance.now()) {
    const recent = this.frames.ordered().filter(frame => now - this.startedAt - frame.t <= FRAME_WINDOW_MS);
    const deltas = recent.map(frame => frame.delta);
    const span = recent.length > 1 ? recent.at(-1).t - recent[0].t : 0;
    return {
      fps: span > 0 ? (recent.length - 1) * 1000 / span : 0,
      last: deltas.at(-1) || 0,
      max: deltas.length ? Math.max(...deltas) : 0,
      jank: deltas.filter(delta => delta > 20).length
    };
  }

  updatePanel(now) {
    const frame = this.frameStats(now);
    const move = this.currentMove || this.lastMove;
    const actual = move
      ? (move.actualElapsed ?? now - move.startedAt)
      : null;
    this.readout.textContent = [
      `rAF ${round(frame.fps)} fps · last ${round(frame.last)} ms`,
      `max ${round(frame.max)} ms · >20 ms ${frame.jank}`,
      move
        ? `move ${move.maxDistance}c/${move.maxDuration} ms · actual ${round(actual)} ms`
        : 'move —',
      move
        ? `tiles ${move.movingTiles} · merge ${move.merge ? 'yes' : 'no'} · spawn ${move.spawn ? 'yes' : 'no'}`
        : 'tiles — · merge — · spawn —',
      `pending ${this.pendingDirection || 'no'}`
    ].join('\n');
  }

  exportLog() {
    const frames = this.frames.ordered().slice(-FRAME_EXPORT_SIZE)
      .map(frame => ({ ...frame, type: 'frame' }));
    const events = this.events.ordered();
    return JSON.stringify({
      version: 1,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio
      },
      frameWindowMs: FRAME_WINDOW_MS,
      frameStats: this.frameStats(),
      events: [...frames, ...events].sort((a, b) => a.t - b.t)
    }, null, 2);
  }

  async copyLog() {
    const log = this.exportLog();
    try {
      await navigator.clipboard.writeText(log);
      this.copyButton.textContent = 'Copied';
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = log;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      this.copyButton.textContent = 'Copied';
    }
    window.setTimeout(() => { this.copyButton.textContent = 'Copy Performance Log'; }, 900);
  }

  createPanel() {
    const style = document.createElement('style');
    style.textContent = `
      .perf-panel {
        position: fixed; right: max(8px, env(safe-area-inset-right));
        bottom: max(8px, env(safe-area-inset-bottom)); z-index: 1000;
        width: min(235px, calc(100vw - 16px)); padding: 8px;
        border-radius: 8px; color: #fff; background: rgba(35, 31, 28, .88);
        box-shadow: 0 4px 18px rgba(0,0,0,.18);
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .perf-panel pre { margin: 0 0 6px; white-space: pre-wrap; font: inherit; }
      .perf-panel button {
        width: 100%; border: 0; border-radius: 5px; padding: 5px 7px;
        color: #332f2b; background: #fff; font: 600 11px/1.2 system-ui, sans-serif;
      }
    `;
    document.head.appendChild(style);
    const panel = document.createElement('aside');
    panel.className = 'perf-panel';
    panel.setAttribute('aria-label', 'Animation performance');
    this.readout = document.createElement('pre');
    this.copyButton = document.createElement('button');
    this.copyButton.type = 'button';
    this.copyButton.textContent = 'Copy Performance Log';
    this.copyButton.addEventListener('click', () => this.copyLog());
    panel.append(this.readout, this.copyButton);
    document.body.appendChild(panel);
    this.updatePanel(performance.now());
  }
}

export function createPerformanceMonitor() {
  return new PerformanceMonitor();
}
