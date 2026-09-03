const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOVE_MS = REDUCED_MOTION ? 1 : 110;
const MOVE_MIN_MS = 105;
const MOVE_STEP_MS = 20;
const MOVE_MAX_MS = 145;

export class Renderer {
  constructor() {
    this.boardWrap = document.getElementById('boardWrap');
    this.tileLayer = document.getElementById('tileLayer');
    this.scoreEl = document.getElementById('score');
    this.bestEl = document.getElementById('best');
    this.overlay = document.getElementById('overlay');
    this.overlayTitle = document.getElementById('overlayTitle');
    this.overlayText = document.getElementById('overlayText');
    this.continueBtn = document.getElementById('continueBtn');
    this.newGameBtn = document.getElementById('newGame');
    this.retryBtn = document.getElementById('retryBtn');
    this.activeTiles = new Map();
    this.tilePool = [];
    this.entryByElement = new WeakMap();
    this.createdTileElements = 0;
  }

  playTilePulse(el, kind) {
    if (REDUCED_MOTION || typeof el.animate !== 'function') return;
    const entry = this.entryByElement.get(el);
    if (!entry) return;
    this.cancelTilePulse(entry);
    const keyframes = kind === 'merge'
      ? [
          { transform: 'translateZ(0) scale(1)' },
          { transform: 'translateZ(0) scale(1.105)', offset: 0.48 },
          { transform: 'translateZ(0) scale(1)' }
        ]
      : [
          { transform: 'translateZ(0) scale(.72)', opacity: .64 },
          { transform: 'translateZ(0) scale(1)', opacity: 1 }
        ];

    const animation = entry.inner.animate(keyframes, {
      duration: kind === 'merge' ? 104 : 92,
      easing: 'cubic-bezier(.2,.72,.24,1)',
      fill: 'none'
    });
    entry.pulse = animation;
    const clearReference = () => {
      if (entry.pulse === animation) entry.pulse = null;
      animation.onfinish = null;
      animation.oncancel = null;
    };
    animation.onfinish = clearReference;
    animation.oncancel = clearReference;
  }

  cancelTilePulse(entry) {
    const animation = entry.pulse;
    if (!animation) return;
    entry.pulse = null;
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
  }

  cancelTilePulses() {
    for (const entry of this.activeTiles.values()) this.cancelTilePulse(entry);
  }

  finishTileMoves(tiles, motions) {
    for (const tile of tiles) {
      const target = motions.get(tile.id);
      if (!target || (target.row === tile.row && target.col === tile.col)) continue;
      const entry = this.activeTiles.get(tile.id);
      if (entry) this.finishTileMovement(entry);
    }
  }

  finishTileMovement(entry) {
    const animation = entry.movement;
    if (!animation) return;
    entry.movement = null;
    animation.finish();
    animation.cancel();
  }

  cancelTileMovement(entry) {
    const animation = entry.movement;
    if (!animation) return;
    entry.movement = null;
    animation.cancel();
  }

  tileElement(tile, { animateNew = true } = {}) {
    const entry = this.tilePool.pop() || this.createTileEntry();
    const { el, inner } = entry;
    el.className = 'tile';
    inner.className = 'tile-inner';
    el.dataset.id = tile.id;
    el.dataset.value = tile.value;
    el.style.setProperty('--row', tile.row);
    el.style.setProperty('--col', tile.col);
    inner.textContent = tile.value;
    this.tileLayer.appendChild(el);
    this.activeTiles.set(tile.id, entry);

    const shouldAnimate = tile.isNew && animateNew;
    tile.isNew = false;
    if (shouldAnimate) this.playTilePulse(el, 'new');
    return el;
  }

  createTileEntry() {
    const el = document.createElement('div');
    const inner = document.createElement('div');
    el.appendChild(inner);
    const entry = { el, inner, movement: null, pulse: null };
    this.entryByElement.set(el, entry);
    this.createdTileElements += 1;
    return entry;
  }

  recycleTileEntry(entry) {
    this.cancelTileMovement(entry);
    this.cancelTilePulse(entry);
    entry.el.remove();
    entry.el.className = 'tile';
    entry.inner.className = 'tile-inner';
    delete entry.el.dataset.id;
    delete entry.el.dataset.value;
    entry.el.removeAttribute('style');
    entry.inner.removeAttribute('style');
    entry.inner.textContent = '';
    this.tilePool.push(entry);
  }

  getTileEl(id) {
    return this.activeTiles.get(id)?.el || null;
  }

  removeTileEl(id) {
    const entry = this.activeTiles.get(id);
    if (!entry) return;
    this.activeTiles.delete(id);
    this.recycleTileEntry(entry);
  }

  clearTiles() {
    for (const entry of this.activeTiles.values()) this.recycleTileEntry(entry);
    this.activeTiles.clear();
  }

  renderAll(tiles) {
    this.clearTiles();
    for (const tile of tiles) this.tileElement(tile);
  }

  updateScore(score) {
    this.scoreEl.textContent = String(score);
  }

  updateBest(best) {
    this.bestEl.textContent = String(best);
  }

  setTilePosition(el, row, col) {
    el.style.setProperty('--row', row);
    el.style.setProperty('--col', col);
  }

  tileTransform(row, col) {
    return `translate3d(calc(${col} * (100% + var(--gap))), calc(${row} * (100% + var(--gap))), 0) scale(var(--scale))`;
  }

  movementDuration(from, to) {
    if (REDUCED_MOTION) return MOVE_MS;
    const distance = Math.abs(to.row - from.row) + Math.abs(to.col - from.col);
    return Math.min(MOVE_MAX_MS, MOVE_MIN_MS + (distance - 1) * MOVE_STEP_MS);
  }

  animateTileMovement(entry, from, to) {
    this.cancelTileMovement(entry);
    this.setTilePosition(entry.el, to.row, to.col);
    const animation = entry.el.animate([
      { transform: this.tileTransform(from.row, from.col) },
      { transform: this.tileTransform(to.row, to.col) }
    ], {
      duration: this.movementDuration(from, to),
      easing: 'ease-in-out'
    });
    entry.movement = animation;
    return animation.finished.then(
      () => true,
      () => false
    ).finally(() => {
      if (entry.movement === animation) entry.movement = null;
    });
  }

  moveTiles(tiles, motions) {
    const movements = [];
    for (const tile of tiles) {
      const target = motions.get(tile.id);
      const entry = this.activeTiles.get(tile.id);
      if (!target || !entry) continue;
      if (target.row === tile.row && target.col === tile.col) {
        this.setTilePosition(entry.el, target.row, target.col);
        continue;
      }
      movements.push(this.animateTileMovement(entry, tile, target));
    }
    return Promise.all(movements).then(results => results.every(Boolean));
  }

  syncTileValues(tiles) {
    for (const tile of tiles) {
      const entry = this.activeTiles.get(tile.id);
      if (!entry) continue;
      const oldValue = Number(entry.el.dataset.value);
      if (oldValue !== tile.value) {
        entry.el.dataset.value = tile.value;
        entry.inner.textContent = tile.value;
      }
    }
  }

  getStats() {
    const activeMovementAnimations = [...this.activeTiles.values()]
      .reduce((count, entry) => count + Number(Boolean(entry.movement)), 0);
    const activePulseAnimations = [...this.activeTiles.values()]
      .reduce((count, entry) => count + Number(Boolean(entry.pulse)), 0);
    return {
      createdTileElements: this.createdTileElements,
      activeTileElements: this.activeTiles.size,
      pooledTileElements: this.tilePool.length,
      retainedTileElements: this.activeTiles.size + this.tilePool.length,
      activeMovementAnimations,
      activePulseAnimations
    };
  }

  showState(state) {
    this.overlayTitle.textContent = state.title;
    this.overlayText.textContent = state.text;
    this.continueBtn.hidden = !state.showContinue;
    this.overlay.classList.add('show');
  }

  hideOverlay() {
    this.overlay.classList.remove('show');
  }

  isOverlayShown() {
    return this.overlay.classList.contains('show');
  }
}
