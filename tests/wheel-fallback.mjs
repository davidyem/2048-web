import assert from 'node:assert/strict';
import { WheelGesture } from '../js/wheel.js';

const direction = ({ x, y }) => Math.abs(x) > Math.abs(y)
  ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
const axes = [[1, 0], [-1, 0], [0, -1], [0, 1]];
let tested = 0;

// Vary starting axis/sign, packet cadence and amplitude. Check each recognized
// direction, not just the final command count; one spike must never split a tail.
for (let run = 0; run < 300; run++) {
  const w = new WheelGesture(), commands = [];
  const vectors = axes.map((_, i) => axes[(i + run) % axes.length]);
  const [ax, ay] = vectors[0];
  let at = 1000;
  const push = (x, y, dt, momentum) => {
    at += dt;
    const result = w.push(x, y, at, momentum);
    if (result.reason === 'recognized') commands.push(direction(result));
    tested++;
    return result;
  };
  push(ax * 30, ay * 30, 0);
  for (let i = 0; i < 40; i++) {
    const magnitude = Math.max(1, 35 + run % 5 - i);
    push(ax * magnitude, ay * magnitude, 8 + run % 5);
    if (i % 9 === 0) push(-ax * 80, -ay * 80, 12);
  }
  assert.deepEqual(commands, [direction({ x: ax, y: ay })], 'tail and isolated spikes');
  for (const [x, y] of vectors.slice(1)) {
    push(x * 8, y * 8, 20);
    push(x * 20, y * 20, 12 + run % 3);
    push(x * 30, y * 30, 12 + run % 3);
    push(x * 5, y * 5, 80);
  }
  assert.deepEqual(commands, vectors.map(([x, y]) => direction({ x, y })), 'sustained turns');
  assert.equal(w.serial, 4, 'one gesture ID per accepted direction');
  w.lock(at);
  for (let i = 0; i < 10; i++) push(ax * 40, ay * 40, 12);
  assert.equal(commands.length, 4, 'cancellation suppresses the remaining tail');
}

// Chrome's explicit phase signal must remain authoritative even for a strong turn.
const explicit = new WheelGesture();
assert.equal(explicit.push(30, 0, 1000, false).reason, 'recognized');
for (const t of [1100, 1112, 1124, 1136])
  assert.equal(explicit.push(-40, 0, t, false).reason, 'locked');
assert.equal(explicit.push(-40, 0, 1150, true).reason, 'momentum');
assert.equal(explicit.push(-30, 0, 1160, false).reason, 'recognized');

// Same-direction acceleration, slow noise and one or two large packets are not
// sufficient evidence. A genuine quiet gap still allows the same direction again.
for (const packets of [
  [[80, 0, 1100], [120, 0, 1112], [160, 0, 1124]],
  [[-80, 0, 1100], [-120, 0, 1124]],
  [[-2, 0, 1100], [-2, 0, 1112], [-2, 0, 1124]],
  [[-40, 40, 1100], [-40, 40, 1112], [-40, 40, 1124]],
  [[-40, 0, 1100], [-40, 0, 1151], [-40, 0, 1201]],
  [[-40, 0, 1100], [-40, 0, 1090], [-40, 0, 1100]],
]) {
  const w = new WheelGesture();
  w.push(30, 0, 1000);
  for (const packet of packets) assert.equal(w.push(...packet).reason, 'locked');
  assert.equal(w.push(30, 0, w.lastAt + 220).reason, 'recognized');
}
console.log(`${tested} fallback packets plus phase/noise/clock boundaries passed`);
