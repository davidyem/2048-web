import assert from 'node:assert/strict';
import { Game } from '../js/game.js';
import { WheelGesture } from '../js/wheel.js';
let seed = 2048;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
// Independent numeric grid oracle, without tile identities or the engine's traversal.
function reference(board, direction) {
  let gained = 0;
  const out = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (let line = 0; line < 4; line++) {
    const vertical = direction === 'up' || direction === 'down';
    const reverse = direction === 'right' || direction === 'down';
    let values = vertical ? board.map(row => row[line]) : [...board[line]];
    if (reverse) values.reverse();
    values = values.filter(Boolean);
    const result = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] === values[i + 1]) { result.push(values[i] * 2); gained += values[i] * 2; i++; }
      else result.push(values[i]);
    }
    while (result.length < 4) result.push(0);
    if (reverse) result.reverse();
    for (let i = 0; i < 4; i++) out[vertical ? i : line][vertical ? line : i] = result[i];
  }
  return { board: out, gained, changed: JSON.stringify(out) !== JSON.stringify(board) };
}
const g = new Game({ get: () => 0, set() {} });
for (let i = 0; i < 50000; i++) {
  const board = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => random() < .3 ? 0 : 2 ** (1 + Math.floor(random() * 7))));
  let id = 0;
  g.tiles = board.flatMap((row, y) => row.flatMap((value, x) => value ? [{ id: ++id, value, row: y, col: x }] : []));
  const direction = ['left', 'right', 'up', 'down'][i % 4], expected = reference(board, direction);
  const before = JSON.stringify(g.tiles), result = g.calculateMove(direction);
  assert.equal(JSON.stringify(g.tiles), before, 'calculation is pure');
  const actual = Array.from({ length: 4 }, () => Array(4).fill(0));
  for (const t of result.survivors) actual[t.row][t.col] = t.value;
  assert.deepEqual({ board: actual, gained: result.gained, changed: result.changed }, expected);
  assert.equal(new Set(result.survivors.map(t => `${t.row},${t.col}`)).size, result.survivors.length);
  assert.equal(new Set(result.mergedIds).size, result.mergedIds.length);
  const score = g.score; g.applyMoveResult(result); assert.equal(g.score, score + expected.gained);
}
const w = new WheelGesture();
assert.equal(w.push(-20, 0, 0).reason, 'recognized');
for (const [at, x, y] of [[30,-10,0],[60,-5,0],[90,-2,0],[120,-20,0],[140,0,30],[240,40,0]]) assert.equal(w.push(x,y,at).reason,'locked');
assert.equal(w.push(-20,0,460).reason,'recognized');
assert.equal(w.push(-60,0,900,true).reason,'momentum');
assert.equal(w.push(20,0,910,false).reason,'recognized');
w.reset();assert.equal(w.push(15,15,1000).reason,'threshold');assert.equal(w.push(20,0,1020).reason,'recognized');
console.log('50,000 seeded board/oracle comparisons and wheel segmentation cases passed');
