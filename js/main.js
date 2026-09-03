import { Game, SIZE } from './game.js';
import { Input } from './input.js';
import { MOVE_MS, Renderer } from './renderer.js';

const BEST_SCORE_KEY = '2048-best';
const BEST_SAVE_DELAY_MS = 1500;
const GAME_STATE_KEY = '2048-game-state-v1';
const GAME_STATE_VERSION = 1;
const GAME_STATE_SAVE_DELAY_MS = 750;
let pendingBestValue = null;
let persistedBestValue;
let bestSaveTimer = 0;
let pendingGameState = null;
let persistedGameState = null;
let gameStateSaveTimer = 0;

function flushBestScore() {
  clearTimeout(bestSaveTimer);
  bestSaveTimer = 0;
  if (pendingBestValue === null) return;

  const value = pendingBestValue;
  pendingBestValue = null;
  if (value === persistedBestValue) return;

  try {
    localStorage.setItem(BEST_SCORE_KEY, value);
    persistedBestValue = value;
  } catch {}
}

const storage = {
  get(key) {
    try {
      const value = localStorage.getItem(key);
      if (key === BEST_SCORE_KEY) persistedBestValue = value;
      return value;
    } catch {
      return null;
    }
  },
  set(key, value) {
    const serialized = String(value);
    if (key !== BEST_SCORE_KEY) {
      try { localStorage.setItem(key, serialized); } catch {}
      return;
    }
    if (serialized === pendingBestValue
      || (pendingBestValue === null && serialized === persistedBestValue)) return;
    pendingBestValue = serialized;
    clearTimeout(bestSaveTimer);
    bestSaveTimer = window.setTimeout(flushBestScore, BEST_SAVE_DELAY_MS);
  }
};

function isValidGameState(state) {
  if (!state || state.version !== GAME_STATE_VERSION
    || !Array.isArray(state.tiles) || state.tiles.length < 1 || state.tiles.length > SIZE * SIZE
    || !Number.isSafeInteger(state.score) || state.score < 0
    || typeof state.wonShown !== 'boolean' || typeof state.keepPlaying !== 'boolean'
    || (state.keepPlaying && !state.wonShown)) return false;

  const occupied = new Set();
  for (const tile of state.tiles) {
    if (!tile || !Number.isSafeInteger(tile.value) || tile.value < 2
      || !Number.isInteger(Math.log2(tile.value))
      || !Number.isInteger(tile.row) || tile.row < 0 || tile.row >= SIZE
      || !Number.isInteger(tile.col) || tile.col < 0 || tile.col >= SIZE) return false;
    const cell = `${tile.row},${tile.col}`;
    if (occupied.has(cell)) return false;
    occupied.add(cell);
  }
  return true;
}

function readGameState() {
  let serialized;
  try {
    serialized = localStorage.getItem(GAME_STATE_KEY);
    if (serialized === null) return null;
    const state = JSON.parse(serialized);
    if (!isValidGameState(state)) throw new TypeError('Invalid saved game state');
    persistedGameState = serialized;
    return state;
  } catch {
    try { localStorage.removeItem(GAME_STATE_KEY); } catch {}
    persistedGameState = null;
    return null;
  }
}

function serializeGameState() {
  const tiles = game.tiles
    .map(({ value, row, col }) => ({ value, row, col }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return JSON.stringify({
    version: GAME_STATE_VERSION,
    tiles,
    score: game.score,
    wonShown: game.wonShown,
    keepPlaying: game.keepPlaying
  });
}

function flushGameState() {
  clearTimeout(gameStateSaveTimer);
  gameStateSaveTimer = 0;
  if (pendingGameState === null) return;

  const serialized = pendingGameState;
  pendingGameState = null;
  if (serialized === persistedGameState) return;

  try {
    localStorage.setItem(GAME_STATE_KEY, serialized);
    persistedGameState = serialized;
  } catch {}
}

function scheduleGameStateSave() {
  const serialized = serializeGameState();
  if (serialized === pendingGameState
    || (pendingGameState === null && serialized === persistedGameState)) return;
  pendingGameState = serialized;
  clearTimeout(gameStateSaveTimer);
  gameStateSaveTimer = window.setTimeout(flushGameState, GAME_STATE_SAVE_DELAY_MS);
}

function clearGameState() {
  clearTimeout(gameStateSaveTimer);
  gameStateSaveTimer = 0;
  pendingGameState = null;
  try { localStorage.removeItem(GAME_STATE_KEY); } catch {}
  persistedGameState = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushBestScore();
    flushGameState();
  }
});
window.addEventListener('pagehide', () => {
  flushBestScore();
  flushGameState();
});

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
    storage.set(BEST_SCORE_KEY, game.best);
  }
}

function restoreGameState() {
  const state = readGameState();
  if (!state) return false;

  game.gameSession += 1;
  game.nextId = 1;
  game.tiles = state.tiles.map(tile => ({
    id: game.nextId++,
    value: tile.value,
    row: tile.row,
    col: tile.col,
    isNew: false
  }));
  game.score = state.score;
  game.wonShown = state.wonShown;
  game.keepPlaying = state.keepPlaying;

  if (!game.canMove()) {
    clearGameState();
    game.tiles = [];
    return false;
  }

  renderer.hideOverlay();
  renderer.renderAll(game.tiles);
  updateScore();

  if (game.wonShown && !game.keepPlaying && game.tiles.some(tile => tile.value >= 2048)) {
    renderer.showState({
      title: '2048!',
      text: 'You reached 2048. Keep going?',
      showContinue: true
    });
  }
  return true;
}

function commitMove(move, { interrupted = false } = {}) {
  if (!move || move.done) return;
  move.done = true;
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
  if (state) {
    renderer.showState(state);
    if (!state.showContinue) {
      flushBestScore();
      clearGameState();
      return;
    }
  }
  scheduleGameStateSave();
}

function cancelActiveMove() {
  if (!activeMove) return;
  activeMove.done = true;
  activeMove = null;
}

function interruptActiveMove() {
  if (!activeMove) return;

  // Finish the current movement animations before committing so rapid
  // input always starts from the latest visual target without a move queue.
  renderer.finishTileMoves(game.tiles, activeMove.result.motions);
  renderer.cancelTilePulses();
  commitMove(activeMove, { interrupted: true });
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
    done: false
  };
  activeMove = move;

  renderer.moveTiles(game.tiles, result.motions).then(completed => {
    if (completed) commitMove(move);
  });
}

function resetGame() {
  flushBestScore();
  clearGameState();
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
  scheduleGameStateSave();
  flushGameState();
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
  getRendererState() {
    return renderer.getStats();
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
  scheduleGameStateSave();
});

if (!restoreGameState()) resetGame();

if (input.likelyMacDesktop && input.trackpadFactor === null) {
  requestAnimationFrame(() => input.showTrackpadSetup());
}
