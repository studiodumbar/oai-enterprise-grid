// Flock-only linked-list spatial index for freely moving boids. It is an
// unregistered proximity helper, not a visual generator or fixed-grid
// cellular-automata dependency. Rebuilding it each frame avoids allocating
// neighbour arrays, so flock cost scales with nearby boids.
export class SpatialHash {
  constructor(cellSize, capacity) {
    this.cellSize = cellSize;
    this.next = new Int32Array(capacity);
    this.resize(1, 1);
  }

  resize(width, height) {
    this.columns = Math.max(1, Math.ceil(width / this.cellSize));
    this.rows = Math.max(1, Math.ceil(height / this.cellSize));
    this.heads = new Int32Array(this.columns * this.rows);
  }

  rebuild(width, height, boids, { wrapEdges = true } = {}) {
    const columns = Math.max(1, Math.ceil(width / this.cellSize));
    const rows = Math.max(1, Math.ceil(height / this.cellSize));
    if (columns !== this.columns || rows !== this.rows) this.resize(width, height);

    this.heads.fill(-1);
    for (let index = 0; index < boids.length; index += 1) {
      const boid = boids[index];
      if (!boid.active) continue;
      if (
        !wrapEdges
        && (boid.x < 0 || boid.x >= width || boid.y < 0 || boid.y >= height)
      ) continue;
      const column = Math.min(
        this.columns - 1,
        Math.max(0, Math.floor(boid.x / this.cellSize)),
      );
      const row = Math.min(
        this.rows - 1,
        Math.max(0, Math.floor(boid.y / this.cellSize)),
      );
      const bucket = row * this.columns + column;
      this.next[index] = this.heads[bucket];
      this.heads[bucket] = index;
    }
  }

  wrappedBucket(column, row) {
    const wrappedColumn = (column + this.columns) % this.columns;
    const wrappedRow = (row + this.rows) % this.rows;
    return wrappedRow * this.columns + wrappedColumn;
  }
}
