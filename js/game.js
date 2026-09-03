export const SIZE = 4;

export class Game {
  constructor(storage) {
    this.storage = storage;
    this.tiles = [];
    this.nextId = 1;
    this.score = 0;
    this.best = Number(storage.get('2048-best') || 0);
    this.gameSession = 0;
    this.wonShown = false;
    this.keepPlaying = false;
  }

  emptyCells(list = this.tiles) {
    const occupied = new Set(list.map(t => `${t.row},${t.col}`));
    const cells = [];
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        if (!occupied.has(`${row},${col}`)) cells.push({ row, col });
      }
    }
    return cells;
  }

  makeRandomTile(list = this.tiles) {
    const cells = this.emptyCells(list);
    if (!cells.length) return null;
    const cell = cells[Math.floor(Math.random() * cells.length)];
    return {
      id: this.nextId++,
      value: Math.random() < 0.9 ? 2 : 4,
      row: cell.row,
      col: cell.col,
      isNew: true
    };
  }

  lineCoordinates(direction, line) {
    const coords = [];
    for (let i = 0; i < SIZE; i++) {
      if (direction === 'left') coords.push({ row: line, col: i });
      if (direction === 'right') coords.push({ row: line, col: SIZE - 1 - i });
      if (direction === 'up') coords.push({ row: i, col: line });
      if (direction === 'down') coords.push({ row: SIZE - 1 - i, col: line });
    }
    return coords;
  }

  calculateMove(direction) {
    const byCell = new Map(this.tiles.map(t => [`${t.row},${t.col}`, t]));
    const motions = new Map();
    const survivors = [];
    const removedIds = [];
    const mergedIds = [];
    let gained = 0;
    let changed = false;

    for (let line = 0; line < SIZE; line++) {
      const coords = this.lineCoordinates(direction, line);
      const items = coords.map(c => byCell.get(`${c.row},${c.col}`)).filter(Boolean);
      const placed = [];

      for (const tile of items) {
        const last = placed[placed.length - 1];
        if (last && !last.merged && last.tile.value === tile.value) {
          const target = coords[placed.length - 1];
          motions.set(tile.id, target);
          removedIds.push(tile.id);
          last.merged = true;
          last.nextValue *= 2;
          gained += last.nextValue;
          mergedIds.push(last.tile.id);
          if (tile.row !== target.row || tile.col !== target.col) changed = true;
        } else {
          const target = coords[placed.length];
          const entry = { tile, target, nextValue: tile.value, merged: false };
          placed.push(entry);
          motions.set(tile.id, target);
          if (tile.row !== target.row || tile.col !== target.col) changed = true;
        }
      }

      for (const entry of placed) {
        survivors.push({
          id: entry.tile.id,
          value: entry.nextValue,
          row: entry.target.row,
          col: entry.target.col,
          isNew: false
        });
      }
    }

    if (removedIds.length) changed = true;
    return { changed, motions, survivors, removedIds, mergedIds, gained };
  }

  applyMoveResult(result) {
    this.tiles = result.survivors;
    this.score += result.gained;

    if (this.score > this.best) {
      this.best = this.score;
      this.storage.set('2048-best', String(this.best));
      return true;
    }

    return false;
  }

  canMove() {
    if (this.tiles.length < SIZE * SIZE) return true;
    const map = new Map(this.tiles.map(t => [`${t.row},${t.col}`, t.value]));
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        const value = map.get(`${row},${col}`);
        if (col + 1 < SIZE && map.get(`${row},${col + 1}`) === value) return true;
        if (row + 1 < SIZE && map.get(`${row + 1},${col}`) === value) return true;
      }
    }
    return false;
  }

  evaluateState() {
    if (!this.wonShown && this.tiles.some(t => t.value >= 2048)) {
      this.wonShown = true;
      return {
        title: '2048!',
        text: 'You reached 2048. Keep going?',
        showContinue: true
      };
    }

    if (!this.canMove()) {
      return {
        title: 'Game over',
        text: `Score: ${this.score}`,
        showContinue: false
      };
    }

    return null;
  }
}
