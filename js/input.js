import { WheelGesture } from './wheel.js';
import { trace } from './diagnostics.js';
const TRACKPAD_FACTOR_KEY = '2048-trackpad-factor-v5';

const keyToDirection = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
  A: 'left', D: 'right', W: 'up', S: 'down'
};

export class Input {
  constructor(storage, onDirection) {
    this.storage = storage;
    this.onDirection = onDirection;
    this.trackpadConfigBtn = document.getElementById('trackpadConfig');
    this.trackpadSetup = document.getElementById('trackpadSetup');
    this.trackpadSetupStatus = document.getElementById('trackpadSetupStatus');
    this.trackpadSkipBtn = document.getElementById('trackpadSkip');

    this.gestureSerial = 0;
    this.pointerSerial = 0;
    this.pointerStart = null;
    this.swipeClickGuard = null;

    this.likelyMacDesktop = /Mac/.test(navigator.platform || navigator.userAgent)
      && (navigator.maxTouchPoints || 0) < 2;
    const savedTrackpadFactor = Number(storage.get(TRACKPAD_FACTOR_KEY));
    this.trackpadFactor = savedTrackpadFactor === 1 || savedTrackpadFactor === -1
      ? savedTrackpadFactor
      : null;
    this.calibrationActive = false;
    this.calibrationX = 0;
    this.calibrationY = 0;

    this.wheelState = new WheelGesture();
  }

  attach() {
    window.addEventListener('keydown', event => {
      const direction = keyToDirection[event.key];
      if (!direction || event.ctrlKey || event.metaKey || event.altKey
        || event.target.closest?.('input, textarea, select, [contenteditable]')
        || this.calibrationActive) return;
      event.preventDefault();
      this.dispatchDirection(direction, 'keyboard', { eventAt: event.timeStamp });
    }, { passive: false, capture: true });

    // Touch input uses actual pointer coordinates, so it follows the finger
    // exactly: right-to-left means LEFT, bottom-to-top means UP, and so on.
    window.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      if (event.isPrimary === false) { this.pointerStart = null; return; }
      if (this.calibrationActive || event.target.closest?.('button, input, a, .overlay')) return;
      this.pointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        eventAt: event.timeStamp,
        gesture: `touch-${++this.pointerSerial}`,
        target: event.target
      };
      trace('gesture-start', { gesture: this.pointerStart.gesture, source: 'touch', eventAt: event.timeStamp });
    }, { passive: true, capture: true });

    window.addEventListener('pointermove', event => {
      if (!this.pointerStart || this.pointerStart.id !== event.pointerId) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      if (Math.hypot(dx, dy) > 7 && event.cancelable) event.preventDefault();
    }, { passive: false, capture: true });

    window.addEventListener('pointerup', event => {
      if (!this.pointerStart || this.pointerStart.id !== event.pointerId) return;
      const dx = event.clientX - this.pointerStart.x;
      const dy = event.clientY - this.pointerStart.y;
      const { target: startTarget, gesture } = this.pointerStart;
      trace('gesture-end', { gesture, eventAt: event.timeStamp });
      this.pointerStart = null;

      if (Math.hypot(dx, dy) < 26 || Math.max(Math.abs(dx), Math.abs(dy)) < Math.min(Math.abs(dx), Math.abs(dy)) * 1.2) {
        trace('rejected', { gesture, reason: 'swipe-threshold' });
        return;
      }
      if (event.cancelable) event.preventDefault();
      this.swipeClickGuard = { target: startTarget, until: performance.now() + 140 };
      this.dispatchDirection(this.directionFromVector(dx, dy), 'touch', { gesture, eventAt: event.timeStamp });
    }, { passive: false, capture: true });

    window.addEventListener('pointercancel', () => {
      trace('gesture-cancel', { gesture: this.pointerStart?.gesture });
      this.pointerStart = null;
    }, { passive: true, capture: true });

    window.addEventListener('click', event => {
      const guard = this.swipeClickGuard;
      this.swipeClickGuard = null;
      if (!guard || performance.now() >= guard.until) return;

      const origin = guard.target;
      const target = event.target;
      const sameOrigin = origin === target
        || (origin instanceof Element && origin.contains(target))
        || (target instanceof Element && target.contains(origin));
      if (!sameOrigin) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true });

    window.addEventListener('wheel', event => this.handleTrackpadWheel(event), {
      passive: false,
      capture: true
    });

    this.trackpadConfigBtn.addEventListener('click', () => this.showTrackpadSetup());
    this.trackpadSkipBtn.addEventListener('click', () => {
      if (this.trackpadFactor === null) this.saveTrackpadFactor(1);
      this.hideTrackpadSetup();
      this.resetWheelState();
    });
  }

  dispatchDirection(direction, source, metadata = {}) {
    document.documentElement.dataset.lastGesture = direction;
    document.documentElement.dataset.lastInput = source;
    document.documentElement.dataset.gestureSerial = String(++this.gestureSerial);
    const command = { at: performance.now(), gesture: `${source}-${this.gestureSerial}`, source, ...metadata };
    trace('direction', { ...command, direction });
    this.onDirection(direction, command);
  }

  directionFromVector(x, y, factor = 1) {
    const mappedX = x * factor;
    const mappedY = y * factor;
    return Math.abs(mappedX) > Math.abs(mappedY)
      ? (mappedX > 0 ? 'right' : 'left')
      : (mappedY > 0 ? 'down' : 'up');
  }

  resetWheelState() { this.wheelState.reset(); }

  cancelGestures() {
    this.pointerStart = null;
    this.swipeClickGuard = null;
    this.wheelState.lock(performance.now());
  }

  showTrackpadSetup() {
    this.calibrationActive = true;
    this.calibrationX = 0;
    this.calibrationY = 0;
    this.resetWheelState();
    this.trackpadSetupStatus.textContent = 'Жду свайп влево…';
    this.trackpadSetup.classList.add('show');
  }

  hideTrackpadSetup() {
    this.calibrationActive = false;
    this.calibrationX = 0;
    this.calibrationY = 0;
    this.trackpadSetup.classList.remove('show');
  }

  saveTrackpadFactor(factor) {
    this.trackpadFactor = factor;
    this.storage.set(TRACKPAD_FACTOR_KEY, String(factor));
  }

  normalizeWheelDelta(event) {
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
    return { x: event.deltaX * scale, y: event.deltaY * scale };
  }

  finishTrackpadCalibration() {
    const ax = Math.abs(this.calibrationX);
    const ay = Math.abs(this.calibrationY);
    if (ax < 20) return false;
    if (ax < ay * 1.3) {
      this.trackpadSetupStatus.textContent = 'Проведи чётко по горизонтали влево ←';
      return false;
    }

    // The instructed physical gesture is LEFT. Choose the multiplier that
    // makes the observed raw horizontal delta negative after mapping.
    const observedRawX = this.calibrationX;
    this.saveTrackpadFactor(observedRawX > 0 ? -1 : 1);
    this.trackpadSetupStatus.textContent = 'Готово';
    this.hideTrackpadSetup();
    this.wheelState.lock(performance.now());
    this.dispatchDirection('left', 'trackpad-calibration');
    return true;
  }

  handleTrackpadWheel(event) {
    if (event.ctrlKey) return; // Keep pinch-to-zoom available.
    const delta = this.normalizeWheelDelta(event);
    if (Math.abs(delta.x) < 0.05 && Math.abs(delta.y) < 0.05) return;
    if (event.cancelable) event.preventDefault();

    const packet = this.wheelState.push(delta.x, delta.y, event.timeStamp, event.momentum);
    const gesture = `wheel-${packet.id}`;
    trace('wheel', { eventAt: event.timeStamp, gesture, ...delta, momentum: event.momentum, reason: packet.reason });
    if (packet.ended) trace('gesture-end', { gesture: `wheel-${packet.ended}`, inferred: true });
    if (packet.start) trace('gesture-start', { gesture, source: 'trackpad' });
    if (packet.reason !== 'recognized') return;
    // A wheel gesture's end is inferred only when the next series starts.
    trace('gesture-recognized', { gesture, x: packet.x, y: packet.y });
    if (this.calibrationActive) {
      this.calibrationX = packet.x;
      this.calibrationY = packet.y;
      this.finishTrackpadCalibration();
      return;
    }
    this.dispatchDirection(this.directionFromVector(packet.x, packet.y, this.trackpadFactor ?? 1),
      'trackpad', { gesture, eventAt: event.timeStamp });
  }

  setTrackpadFactor(factor) {
    if (factor !== 1 && factor !== -1) throw new TypeError('factor must be 1 or -1');
    this.saveTrackpadFactor(factor);
    this.hideTrackpadSetup();
    this.resetWheelState();
  }

  getTrackpadFactor() {
    return this.trackpadFactor;
  }

  getGestureSerial() {
    return this.gestureSerial;
  }
}
