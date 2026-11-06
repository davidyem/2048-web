import assert from 'node:assert/strict';

// Exercise the actual Input handler with a controlled arrival clock, separately
// from the WheelEvent timestamp. No DOM listeners or rendering are needed.
globalThis.location = { search: '' };
globalThis.WheelEvent = { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 };
let now = 1000;
const realPerformance = globalThis.performance;
globalThis.performance = { now: () => now };
const { Input } = await import('../js/input.js');
const { WheelGesture } = await import('../js/wheel.js');
const commands = [];
const input = Object.assign(Object.create(Input.prototype), {
  wheelState: new WheelGesture(), trackpadFactor: 1, calibrationActive: false,
  dispatchDirection: direction => commands.push(direction)
});
const packet = (timeStamp, dx = -30, dy = 0, momentum) => {
  let prevented = false;
  input.handleTrackpadWheel({ timeStamp, deltaX: dx, deltaY: dy, deltaMode: 0,
    momentum, cancelable: true, preventDefault() { prevented = true; } });
  assert.ok(prevented);
};
try {
  for (const unavailable of [0, undefined, NaN, Infinity, -1]) {
    input.resetWheelState(); commands.length = 0; now = 1000;
    packet(unavailable);
    for (const [dt, x, y] of [[20,-10,0],[40,-2,0],[100,0,50],[180,60,0]]) {
      now = 1000 + dt; packet(unavailable, x, y);
    }
    assert.deepEqual(commands, ['left'], 'tail/axis reversal must not restart');
    now = 1399; packet(unavailable, 30);
    assert.equal(commands.length, 1, '219 ms silence remains locked');
    now = 1619; packet(unavailable, 30);
    assert.deepEqual(commands, ['left','right'], '220 ms silence rearms a missing clock');
    input.cancelGestures(); now += 10; packet(unavailable);
    assert.equal(commands.length, 2, 'cancel keeps the tail suppressed');
    now += 220; packet(unavailable);
    assert.equal(commands.length, 3, 'cancel is not a permanent lock');
  }

  input.resetWheelState(); commands.length = 0;
  for (const factor of [1, -1]) {
    input.trackpadFactor = factor;
    for (const [x,y] of [[-30,0],[30,0],[0,-30],[0,30]]) {
      now += 250; packet(0, x, y);
    }
  }
  assert.deepEqual(commands, ['left','right','up','down','right','left','down','up']);

  input.resetWheelState(); commands.length = 0; input.trackpadFactor = 1;
  now = 10000; packet(100, -30);
  now = 20000; packet(120, 30); // Arrived late, still the same original gesture.
  assert.deepEqual(commands, ['left'], 'valid event clocks must not become arrival clocks');
  assert.equal(input.wheelState.lastAt, 120);
  now = 20001; packet(340, 30);
  assert.deepEqual(commands, ['left','right']);
  packet(900, -80, 0, true);
  assert.equal(commands.length, 2, 'explicit Chrome momentum never commands');
  packet(910, -30, 0, false);
  assert.deepEqual(commands, ['left','right','left'], 'Chrome contact after momentum still rearms');
  input.resetWheelState(); commands.length = 0;
  for (const t of [1000, 100, 1100]) packet(t);
  assert.deepEqual(commands, ['left'], 'backward timestamp cannot create a false quiet gap');
  packet(1320, 30);
  assert.deepEqual(commands, ['left','right'], 'monotonic clock resumes normally');
  console.log('Input clock fallback, directions, tail suppression, cancellation and valid-clock preservation passed');
} finally { globalThis.performance = realPerformance; }
