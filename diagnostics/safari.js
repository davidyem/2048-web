// Paste this entire script into Safari Web Inspector on the game (?trace=1).
// No game rules, listeners that dispatch commands, or animation settings change.
(async () => {
  window.__safari2048?.stop();
  const { Input } = await import(new URL('./js/input.js', location.href));
  const original = Input.prototype.handleTrackpadWheel;
  const records = [], frames = [], bindings = [], gestures = [];
  let label = 'unlabelled', running = true, last = 0, raf = 0, phaseProbe = false;
  let lastInput = null, previousArrival = null, pointer = null, attempt = 0;
  const name = el => el === window ? 'window' : el === document ? 'document' :
    el?.nodeType === 1 ? el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.classList.length ? '.' + [...el.classList].join('.') : '') : String(el);
  const push = data => { records.push({ observedAt: performance.now(), label, ...data }); if (records.length > 1024) records.shift(); };
  const detail = e => ({ eventAt: e.timeStamp, trusted: e.isTrusted, target: name(e.target),
    path: e.composedPath().map(name), phase: e.eventPhase, x: e.clientX, y: e.clientY,
    dx: e.deltaX, dy: e.deltaY, mode: e.deltaMode, ctrl: e.ctrlKey,
    momentum: e.momentum, hasMomentum: 'momentum' in e,
    invertedFromDevice: e.webkitDirectionInvertedFromDevice,
    hidden: document.hidden, focused: document.hasFocus(),
    cancelable: e.cancelable, prevented: e.defaultPrevented });
  const wrapped = function(e) {
    lastInput = this;
    const arrival = performance.now();
    const arrivalGap = previousArrival === null ? null : arrival - previousArrival;
    previousArrival = arrival;
    const before = this.getGestureSerial();
    push({ type: 'window-handler-enter', ...detail(e), arrivalGap,
      factor: this.trackpadFactor, calibration: this.calibrationActive, state: { ...this.wheelState } });
    try { return original.call(this, e); }
    finally {
      const commands = this.getGestureSerial() - before;
      const tail = window.__2048Debug?.traceLog().slice(-8) || [];
      push({ type: 'window-handler-exit', ...detail(e), commands,
        state: { ...this.wheelState }, trace: tail });
      let summary = gestures.at(-1);
      if (!summary || summary.id !== this.wheelState.serial || summary.label !== label) {
        summary = { id: this.wheelState.serial, label, start: e.timeStamp,
          x: e.clientX, y: e.clientY, target: name(e.target), trusted: e.isTrusted,
          arrivalStart: arrival, arrivalGap, factor: this.trackpadFactor,
          events: 0, dx: 0, dy: 0, commands: 0, firstPackets: [], decisions: [], reasons: {} };
        gestures.push(summary);
        if (gestures.length > 128) gestures.shift();
      }
      summary.end = e.timeStamp;
      summary.arrivalEnd = arrival;
      const decision = tail.findLast(item => item.type === 'wheel');
      if (decision) summary.reasons[decision.reason] = (summary.reasons[decision.reason] || 0) + 1;
      summary.events++;
      summary.dx += e.deltaX;
      summary.dy += e.deltaY;
      summary.commands += commands;
      if (summary.firstPackets.length < 16) summary.firstPackets.push({ t: e.timeStamp, dx: e.deltaX, dy: e.deltaY });
      if (commands) summary.decisions.push(...tail.filter(item => ['direction','move-start','commit','queued','rejected'].includes(item.type)));
    }
  };
  Input.prototype.handleTrackpadWheel = wrapped;
  const bind = (node, capture) => {
    const fn = e => push({ type: 'phase', current: name(node), ...detail(e) });
    node.addEventListener('wheel', fn, { capture, passive: true });
    bindings.push(() => node.removeEventListener('wheel', fn, capture));
  };
  // Optional experiment: root listeners may change WebKit's native event regions.
  // They never dispatch a direction or call preventDefault. Reload for clean A/B/A.
  const noop = () => {};
  function coverageProbe(enabled) {
    for (const node of [document.documentElement, document.body]) {
      node.removeEventListener('wheel', noop, true);
      if (enabled) node.addEventListener('wheel', noop, { capture: true, passive: false });
    }
    push({ type: 'coverage-probe', enabled });
  }
  const resetFrameClock = () => { last = 0; };
  document.addEventListener('visibilitychange', resetFrameClock);
  bindings.push(() => document.removeEventListener('visibilitychange', resetFrameClock));
  // No additional wheel listeners. Focus and pointer position explain cases
  // where a missed command is associated with leaving/re-entering the page.
  const trackPointer = e => { pointer = { x: e.clientX, y: e.clientY, at: performance.now() }; };
  window.addEventListener('pointermove', trackPointer, { passive: true, capture: true });
  bindings.push(() => window.removeEventListener('pointermove', trackPointer, true));
  for (const type of ['focus', 'blur', 'visibilitychange']) {
    const target = type === 'visibilitychange' ? document : window;
    const fn = () => push({ type, hidden: document.hidden, focused: document.hasFocus(), pointer });
    target.addEventListener(type, fn);
    bindings.push(() => target.removeEventListener(type, fn));
  }
  // M is not a game key. A marker made without opening Web Inspector avoids
  // its focus/blur side effects and records an attempt even if no wheel arrives.
  const markAttempt = e => {
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat)
      window.__safari2048.mark(`attempt-${++attempt}`);
  };
  window.addEventListener('keydown', markAttempt, { passive: true });
  bindings.push(() => window.removeEventListener('keydown', markAttempt));
  function sample(t) {
    if (!running) return;
    if (last && !document.hidden) {
      frames.push({ at: t, delta: t - last, active: window.__2048Debug?.getAnimationState().active });
      if (frames.length > 2400) frames.shift();
    }
    last = document.hidden ? 0 : t;
    raf = requestAnimationFrame(sample);
  }
  function inspect(x, y) {
    return document.elementsFromPoint(x, y).map(el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { node: name(el), rect: [r.x,r.y,r.width,r.height], pointerEvents: s.pointerEvents,
        overflow: s.overflow, touchAction: s.touchAction, contain: s.contain,
        transform: s.transform, zIndex: s.zIndex, position: s.position };
    });
  }
  window.__safari2048 = {
    mark(value) { label = value; push({ type: 'manual-attempt-marker', pointer,
      hidden: document.hidden, focused: document.hasFocus(), board: window.__2048Debug?.getBoard() }); },
    inspect, coverageProbe,
    phases() {
      if (phaseProbe) return;
      phaseProbe = true;
      for (const node of [window, document, document.documentElement, document.body]) {
        bind(node, true); bind(node, false);
      }
      push({ type: 'phase-probes-installed', note: 'May affect native event regions. Compare a fresh reload.' });
    },
    frames() { if (!raf && running) raf = requestAnimationFrame(sample); },
    report() {
      const active = frames.filter(f => f.active).map(f => f.delta).sort((a,b) => a-b);
      const q = p => active.length ? active[Math.min(active.length - 1, Math.floor(active.length*p))] : null;
      return { ua: navigator.userAgent, viewport: [innerWidth,innerHeight,devicePixelRatio],
        build: document.body.dataset.build, phaseProbe, pointer,
        input: lastInput && { factor: lastInput.trackpadFactor, calibration: lastInput.calibrationActive,
          wheel: { ...lastInput.wheelState } },
        records: records.slice(), frames: frames.slice(),
        gestures: JSON.parse(JSON.stringify(gestures)),
        activeFrameIntervals: { count: active.length, p50: q(.5), p95: q(.95), p99: q(.99) },
        trace: window.__2048Debug?.traceLog(), perf: window.__2048Perf ? JSON.parse(__2048Perf.exportLog()) : null };
    },
    freeze() { const report = this.report(); this.stop(); return report; },
    stop() {
      running = false; cancelAnimationFrame(raf); coverageProbe(false);
      bindings.splice(0).forEach(unbind => unbind());
      if (Input.prototype.handleTrackpadWheel === wrapped) Input.prototype.handleTrackpadWheel = original;
    }
  };
  return 'Ready: __safari2048.mark("background"), perform a physical gesture, then __safari2048.report()';
})();
