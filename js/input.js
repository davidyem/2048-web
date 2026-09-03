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

    this.wheelState = {
      phase: 'idle',
      x: 0,
      y: 0,
      lastAt: 0,
      lastMagnitude: 0,
      dispatchedAt: 0,
      lockedAxis: null,
      lockedSign: 0,
      idleTimer: 0
    };
  }

  attach() {
    window.addEventListener('keydown', event => {
      const direction = keyToDirection[event.key];
      if (!direction) return;
      event.preventDefault();
      this.dispatchDirection(direction, 'keyboard');
    }, { passive: false, capture: true });

    // Touch input uses actual pointer coordinates, so it follows the finger
    // exactly: right-to-left means LEFT, bottom-to-top means UP, and so on.
    window.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' || event.isPrimary === false) return;
      this.pointerStart = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.target
      };
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
      const startTarget = this.pointerStart.target;
      this.pointerStart = null;

      if (Math.hypot(dx, dy) < 26) return;
      if (event.cancelable) event.preventDefault();
      this.swipeClickGuard = { target: startTarget, until: performance.now() + 140 };
      this.dispatchDirection(this.directionFromVector(dx, dy), 'touch');
    }, { passive: false, capture: true });

    window.addEventListener('pointercancel', () => {
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

  dispatchDirection(direction, source) {
    document.documentElement.dataset.lastGesture = direction;
    document.documentElement.dataset.lastInput = source;
    document.documentElement.dataset.gestureSerial = String(++this.gestureSerial);
    this.onDirection(direction);
  }

  directionFromVector(x, y, factor = 1) {
    const mappedX = x * factor;
    const mappedY = y * factor;
    return Math.abs(mappedX) > Math.abs(mappedY)
      ? (mappedX > 0 ? 'right' : 'left')
      : (mappedY > 0 ? 'down' : 'up');
  }

  resetWheelState() {
    this.wheelState.phase = 'idle';
    this.wheelState.x = 0;
    this.wheelState.y = 0;
    this.wheelState.lastMagnitude = 0;
    this.wheelState.lockedAxis = null;
    this.wheelState.lockedSign = 0;
  }

  scheduleWheelIdleReset() {
    clearTimeout(this.wheelState.idleTimer);
    this.wheelState.idleTimer = window.setTimeout(() => this.resetWheelState(), 125);
  }

  beginWheelBurst() {
    this.wheelState.phase = 'collecting';
    this.wheelState.x = 0;
    this.wheelState.y = 0;
    this.wheelState.lockedAxis = null;
    this.wheelState.lockedSign = 0;
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
    this.resetWheelState();
    this.wheelState.phase = 'locked';
    this.wheelState.dispatchedAt = performance.now();
    this.wheelState.lockedAxis = 'x';
    this.wheelState.lockedSign = Math.sign(observedRawX) || -1;
    this.dispatchDirection('left', 'trackpad-calibration');
    return true;
  }

  handleTrackpadWheel(event) {
    if (event.ctrlKey) return; // Keep pinch-to-zoom available.
    const delta = this.normalizeWheelDelta(event);
    if (Math.abs(delta.x) < 0.05 && Math.abs(delta.y) < 0.05) return;
    if (event.cancelable) event.preventDefault();

    if (this.calibrationActive) {
      this.calibrationX += delta.x;
      this.calibrationY += delta.y;
      this.finishTrackpadCalibration();
      return;
    }

    // A non-calibrated desktop still gets a usable fallback, but on a Mac
    // the setup is shown before normal play so physical direction is exact.
    const factor = this.trackpadFactor ?? 1;
    const now = performance.now();
    const gap = this.wheelState.lastAt ? now - this.wheelState.lastAt : Infinity;
    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    const magnitude = Math.max(absX, absY);
    const axis = absX > absY ? 'x' : 'y';
    const sign = Math.sign(axis === 'x' ? delta.x : delta.y);

    let startsNewBurst = this.wheelState.phase === 'idle' || gap > 90;

    if (this.wheelState.phase === 'locked' && !startsNewBurst) {
      const oldEnough = now - this.wheelState.dispatchedAt > 95;
      const directionChanged = axis !== this.wheelState.lockedAxis || sign !== this.wheelState.lockedSign;
      const clearRestart = magnitude >= Math.max(5, this.wheelState.lastMagnitude * 1.75);

      // Momentum normally decays. A fresh finger movement creates either a
      // sign/axis change or a sharp magnitude increase, even if the old
      // momentum packets have not fully stopped yet.
      if (oldEnough && ((directionChanged && magnitude >= 3.5) || clearRestart)) {
        startsNewBurst = true;
      }
    }

    if (startsNewBurst) this.beginWheelBurst();

    this.wheelState.lastAt = now;
    this.wheelState.lastMagnitude = magnitude;
    this.scheduleWheelIdleReset();

    if (this.wheelState.phase !== 'collecting') return;

    this.wheelState.x += delta.x;
    this.wheelState.y += delta.y;

    const totalX = Math.abs(this.wheelState.x);
    const totalY = Math.abs(this.wheelState.y);
    const dominant = Math.max(totalX, totalY);
    const minor = Math.min(totalX, totalY);
    if (dominant < 18) return;
    if (minor > 0 && dominant / minor < 1.18 && dominant < 44) return;

    const rawAxis = totalX > totalY ? 'x' : 'y';
    const rawValue = rawAxis === 'x' ? this.wheelState.x : this.wheelState.y;
    this.wheelState.phase = 'locked';
    this.wheelState.dispatchedAt = now;
    this.wheelState.lockedAxis = rawAxis;
    this.wheelState.lockedSign = Math.sign(rawValue);
    this.dispatchDirection(this.directionFromVector(this.wheelState.x, this.wheelState.y, factor), 'trackpad');
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
