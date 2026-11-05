const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const MOVE_MS = REDUCED_MOTION ? 1 : 120;

export class Renderer {
  constructor(performanceMonitor = null) {
    this.boardWrap = document.getElementById('boardWrap');
    this.grid = this.boardWrap.querySelector('.grid');
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
    this.performanceMonitor = performanceMonitor;
    this.batch = null;
    this.cellStep = 0;
    this.geometryUpdates = 0;
    this.refreshGeometry();
    this.resizeObserver = new ResizeObserver(() => this.refreshGeometry());
    this.resizeObserver.observe(this.boardWrap);
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
    this.performanceMonitor?.recordPulseStart(kind, el.dataset.id);
    const clearReference = () => {
      if (entry.pulse === animation) entry.pulse = null;
      animation.onfinish = null;
      animation.oncancel = null;
      this.performanceMonitor?.recordPulseEnd(kind, el.dataset.id);
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

  finishTileMoves() {
    if (!this.batch) return;
    this.batch.settle(true);
  }

  cancelTileMovement() {
    this.batch?.settle(false);
  }

  tileElement(tile, { animateNew = true } = {}) {
    const reused = this.tilePool.length > 0;
    const entry = this.tilePool.pop() || this.createTileEntry();
    const { el, inner } = entry;
    el.className = 'tile';
    inner.className = 'tile-inner';
    el.dataset.id = tile.id;
    el.dataset.value = tile.value;
    this.setTilePosition(entry, tile.row, tile.col);
    inner.textContent = tile.value;
    this.tileLayer.appendChild(el);
    this.activeTiles.set(tile.id, entry);

    const shouldAnimate = tile.isNew && animateNew;
    tile.isNew = false;
    this.performanceMonitor?.recordTileActivation({
      id: tile.id,
      reused,
      animated: shouldAnimate
    });
    if (shouldAnimate) this.playTilePulse(el, 'new');
    return el;
  }

  createTileEntry() {
    const el = document.createElement('div');
    const inner = document.createElement('div');
    el.appendChild(inner);
    const entry = {
      el,
      inner,
      movement: null,
      pulse: null,
      row: 0,
      col: 0
    };
    this.entryByElement.set(el, entry);
    this.createdTileElements += 1;
    this.performanceMonitor?.recordTileCreation(this.createdTileElements);
    return entry;
  }

  recycleTileEntry(entry) {
    this.cancelTileMovement();
    this.cancelTilePulse(entry);
    entry.el.remove();
    entry.el.className = 'tile';
    entry.inner.className = 'tile-inner';
    delete entry.el.dataset.id;
    delete entry.el.dataset.value;
    entry.el.removeAttribute('style');
    entry.inner.removeAttribute('style');
    entry.inner.textContent = '';
    entry.row = 0;
    entry.col = 0;
    this.tilePool.push(entry);
    this.performanceMonitor?.recordTileRecycle(this.tilePool.length);
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

  refreshGeometry() {
    const cellWidth = this.grid.firstElementChild.getBoundingClientRect().width;
    const gap = Number.parseFloat(getComputedStyle(this.grid).columnGap) || 0;
    const nextCellStep = cellWidth + gap;
    if (!Number.isFinite(nextCellStep) || nextCellStep <= 0
      || Math.abs(nextCellStep - this.cellStep) < .001) return;

    this.cellStep = nextCellStep;
    this.geometryUpdates += 1;
    for (const { animation, from, to } of this.batch?.movements || []) {
      animation.effect.setKeyframes([
        { transform: this.tileTransform(from.row, from.col) },
        { transform: this.tileTransform(to.row, to.col) }
      ]);
    }
    for (const entry of this.activeTiles.values()) {
      this.setTilePosition(entry, entry.row, entry.col);
    }
  }

  setTilePosition(entry, row, col) {
    entry.row = row;
    entry.col = col;
    const transform = this.tileTransform(row, col);
    if (entry.el.style.transform !== transform) entry.el.style.transform = transform;
  }

  tileTransform(row, col) {
    return `translate3d(${col * this.cellStep}px, ${row * this.cellStep}px, 0)`;
  }

  movementDuration() { return MOVE_MS; }

  moveTiles(tiles, motions) {
    this.batch?.settle(false);
    this.cancelTilePulses();
    const movements = [];
    // One timeline instant and progress for every tile, including merge partners.
    const startTime = document.timeline.currentTime;
    for (const tile of tiles) {
      const to = motions.get(tile.id);
      const entry = this.activeTiles.get(tile.id);
      if (!to || !entry) continue;
      this.setTilePosition(entry, to.row, to.col);
      if (to.row === tile.row && to.col === tile.col) continue;
      const animation = entry.el.animate([
        { transform: this.tileTransform(tile.row, tile.col) },
        { transform: this.tileTransform(to.row, to.col) }
      ], { duration: MOVE_MS, easing: 'ease-in-out' });
      animation.startTime = startTime;
      entry.movement = animation;
      movements.push({ entry, animation, from: tile, to });
    }
    if (!movements.length) return Promise.resolve(true);
    return new Promise(resolve => {
      const batch = { movements, settle: completed => {
        if (this.batch !== batch) return;
        this.batch = null;
        for (const { entry, animation } of movements) {
          animation.onfinish = null;
          animation.oncancel = null;
          entry.movement = null;
          animation.cancel();
        }
        resolve(completed);
      } };
      this.batch = batch;
      // All effects share duration/startTime; a single completion owns the batch.
      movements[0].animation.onfinish = () => batch.settle(true);
      for (const { animation } of movements) animation.oncancel = () => batch.settle(false);
    });
  }

  getMovementMetrics(tiles, motions) {
    let movingTiles = 0;
    let maxDistance = 0;
    let maxDuration = 0;
    for (const tile of tiles) {
      const target = motions.get(tile.id);
      if (!target) continue;
      const distance = Math.abs(target.row - tile.row) + Math.abs(target.col - tile.col);
      if (!distance) continue;
      movingTiles += 1;
      maxDistance = Math.max(maxDistance, distance);
      maxDuration = Math.max(maxDuration, this.movementDuration(tile, target));
    }
    return { movingTiles, maxDistance, maxDuration };
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
      activePulseAnimations,
      cellStep: this.cellStep,
      geometryUpdates: this.geometryUpdates
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
