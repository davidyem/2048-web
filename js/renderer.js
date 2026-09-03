const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOVE_MS = REDUCED_MOTION ? 1 : 72;
export const MOVE_SETTLE_MS = MOVE_MS + 18;

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
    this.tileElements = new Map();
  }

  playTilePulse(el, kind) {
    if (REDUCED_MOTION || typeof el.animate !== 'function') return;
    const inner = el.querySelector('.tile-inner');
    if (!inner) return;

    for (const animation of inner.getAnimations()) animation.cancel();
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

    inner.animate(keyframes, {
      duration: kind === 'merge' ? 104 : 92,
      easing: 'cubic-bezier(.2,.72,.24,1)',
      fill: 'none'
    });
  }

  cancelTilePulses() {
    for (const el of this.tileElements.values()) {
      const inner = el.querySelector('.tile-inner');
      if (!inner) continue;
      for (const animation of inner.getAnimations()) animation.cancel();
    }
  }

  tileElement(tile, { animateNew = true } = {}) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.dataset.id = tile.id;
    el.dataset.value = tile.value;
    el.style.setProperty('--row', tile.row);
    el.style.setProperty('--col', tile.col);

    const inner = document.createElement('div');
    inner.className = 'tile-inner';
    inner.textContent = tile.value;
    el.appendChild(inner);
    this.tileLayer.appendChild(el);
    this.tileElements.set(tile.id, el);

    const shouldAnimate = tile.isNew && animateNew;
    tile.isNew = false;
    if (shouldAnimate) this.playTilePulse(el, 'new');
    return el;
  }

  getTileEl(id) {
    return this.tileElements.get(id) || null;
  }

  removeTileEl(id) {
    const el = this.tileElements.get(id);
    if (el) el.remove();
    this.tileElements.delete(id);
  }

  clearTiles() {
    this.tileLayer.textContent = '';
    this.tileElements.clear();
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

  moveTiles(tiles, motions) {
    for (const tile of tiles) {
      const target = motions.get(tile.id);
      const el = this.getTileEl(tile.id);
      if (target && el) this.setTilePosition(el, target.row, target.col);
    }
  }

  syncTileValues(tiles) {
    for (const tile of tiles) {
      const el = this.getTileEl(tile.id);
      if (!el) continue;
      const oldValue = Number(el.dataset.value);
      if (oldValue !== tile.value) {
        el.dataset.value = tile.value;
        const inner = el.querySelector('.tile-inner');
        if (inner) inner.textContent = tile.value;
      }
    }
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
