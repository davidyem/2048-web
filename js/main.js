import { Game, SIZE } from './game.js';
import { Input } from './input.js';
import { MOVE_MS, MOVE_SETTLE_MS, Renderer } from './renderer.js';

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} }
};

const game = new Game(storage);
const renderer = new Renderer();
let activeMove = null;
let moveSerial = 0;
let interruptedMoves = 0;

renderer.updateBest(game.best);

function updateScore() {
  renderer.updateScore(game.score);
  if (game.score > game.best) {
    game.best = game.score;
    renderer.updateBest(game.best);
    storage.set('2048-best', String(game.best));
  }
}

function commitMove(move, { interrupted = false } = {}) {
  if (!move || move.done) return;
  move.done = true;
  clearTimeout(move.timer);
  if (activeMove === move) activeMove = null;
  if (move.session !== game.gameSession) return;

  if (interrupted) {
    interruptedMoves += 1;
    renderer.cancelTilePulses();
  }

  const { result } = move;
  for (const id of result.removedIds) renderer.removeTileEl(id);

  const bestChanged = game.applyMoveResult(result);
  renderer.updateScore(game.score);
  if (bestChanged) renderer.updateBest(game.best);

  renderer.syncTileValues(game.tiles);

  if (!interrupted) {
    for (const id of result.mergedIds) {
      const el = renderer.getTileEl(id);
      if (el) renderer.playTilePulse(el, 'merge');
    }
  }

  const spawned = game.makeRandomTile(game.tiles);
  if (spawned) {
    game.tiles.push(spawned);
    renderer.tileElement(spawned, { animateNew: !interrupted });
  }

  const state = game.evaluateState();
  if (state) renderer.showState(state);
}

function cancelActiveMove() {
  if (!activeMove) return;
  activeMove.done = true;
  clearTimeout(activeMove.timer);
  activeMove = null;
}

function interruptActiveMove() {
  if (!activeMove) return;

  // If a transition is retargeted while it is still running, its new
  // duration starts from the interpolated position and the picture can
  // trail behind rapid input. Snap the old move to its target for one
  // style flush, commit the state, then enable transitions again.
  renderer.tileLayer.classList.add('instant');
  renderer.cancelTilePulses();
  void renderer.tileLayer.offsetWidth;
  commitMove(activeMove, { interrupted: true });
  renderer.tileLayer.classList.remove('instant');
  void renderer.tileLayer.offsetWidth;
}

function performMove(direction) {
  // There is deliberately no move queue. The latest gesture always acts
  // on the latest committed board state instead of waiting for animation.
  if (activeMove) interruptActiveMove();
  if (renderer.isOverlayShown() && !game.keepPlaying) return;

  const result = game.calculateMove(direction);
  if (!result.changed) return;

  const move = {
    id: ++moveSerial,
    session: game.gameSession,
    result,
    timer: 0,
    done: false
  };
  activeMove = move;

  renderer.moveTiles(game.tiles, result.motions);

  move.timer = window.setTimeout(() => {
    commitMove(move);
  }, MOVE_SETTLE_MS);
}

function resetGame() {
  game.gameSession += 1;
  cancelActiveMove();
  game.score = 0;
  game.wonShown = false;
  game.keepPlaying = false;
  renderer.hideOverlay();
  game.tiles = [];
  renderer.clearTiles();
  const first = game.makeRandomTile(game.tiles); if (first) game.tiles.push(first);
  const second = game.makeRandomTile(game.tiles); if (second) game.tiles.push(second);
  renderer.renderAll(game.tiles);
  updateScore();
}

const input = new Input(storage, performMove);
input.attach();

// Small debug surface used by automated checks. It does not change the UI.
window.__2048Debug = {
  directionFromVector(x, y, factor = 1) {
    return input.directionFromVector(x, y, factor);
  },
  calculateMoveFor(board, direction) {
    const previousTiles = game.tiles;
    game.tiles = [];
    let id = 1;
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const value = Number(board[row]?.[col] || 0);
        if (value) game.tiles.push({ id: id++, value, row, col, isNew: false });
      }
    }
    const result = game.calculateMove(direction);
    const out = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (const tile of result.survivors) out[tile.row][tile.col] = tile.value;
    game.tiles = previousTiles;
    return { board: out, gained: result.gained, changed: result.changed };
  },
  setBoard(board) {
    game.gameSession += 1;
    cancelActiveMove();
    renderer.hideOverlay();
    game.score = 0;
    game.tiles = [];
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const value = Number(board[row]?.[col] || 0);
        if (value) game.tiles.push({ id: game.nextId++, value, row, col, isNew: false });
      }
    }
    renderer.renderAll(game.tiles);
    updateScore();
  },
  getBoard() {
    const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    for (const tile of game.tiles) board[tile.row][tile.col] = tile.value;
    return board;
  },
  move(direction) {
    if (!['left', 'right', 'up', 'down'].includes(direction)) {
      throw new TypeError('direction must be left, right, up or down');
    }
    performMove(direction);
  },
  finishAnimation() {
    interruptActiveMove();
  },
  getAnimationState() {
    return {
      active: Boolean(activeMove),
      moveSerial,
      interruptedMoves,
      moveMs: MOVE_MS
    };
  },
  setTrackpadFactor(factor) {
    input.setTrackpadFactor(factor);
  },
  resetWheelState() {
    input.resetWheelState();
  },
  getTrackpadFactor() {
    return input.getTrackpadFactor();
  },
  getGestureSerial() {
    return input.getGestureSerial();
  }
};

renderer.newGameBtn.addEventListener('click', resetGame);
renderer.retryBtn.addEventListener('click', resetGame);
renderer.continueBtn.addEventListener('click', () => {
  game.keepPlaying = true;
  renderer.hideOverlay();
});

resetGame();

if (input.likelyMacDesktop && input.trackpadFactor === null) {
  requestAnimationFrame(() => input.showTrackpadSetup());
}
