const SIZE = 64;

function seededCell(x, y, seed) {
  let value = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ (Math.round(seed * 1000) | 0);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296 < 0.28 ? 1 : 0;
}

export class LifeNoiseField {
  constructor(seed) { this.seed = seed; this.generation = -1; this.cells = null; }
  reset() {
    this.cells = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) this.cells[y * SIZE + x] = seededCell(x, y, this.seed);
    this.generation = 0;
  }
  advance() {
    const next = new Uint8Array(this.cells.length);
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        neighbors += this.cells[((y + dy + SIZE) % SIZE) * SIZE + (x + dx + SIZE) % SIZE];
      }
      const alive = this.cells[y * SIZE + x] === 1;
      next[y * SIZE + x] = neighbors === 3 || (alive && neighbors === 2) ? 1 : 0;
    }
    this.cells = next; this.generation += 1;
  }
  sampleAt(x, y, z) {
    const target = Math.max(0, Math.floor(Math.abs(z - this.seed * 0.173) * 30 + 1e-7));
    if (this.cells === null || target < this.generation) this.reset();
    while (this.generation < target) this.advance();
    const column = ((Math.floor((x - Math.floor(x)) * SIZE) % SIZE) + SIZE) % SIZE;
    const row = ((Math.floor((y - Math.floor(y)) * SIZE) % SIZE) + SIZE) % SIZE;
    return this.cells[row * SIZE + column];
  }
}

export const LIFE_NOISE_MODE = Object.freeze({
  name: "life", defaults: Object.freeze({}), loopable: false,
  minimumLoopCycles: 0, shaderMode: "unsupported", allowedLayers: Object.freeze(["color"]),
  normalize(settings) { return { ...settings }; },
  createField({ seed }) { return new LifeNoiseField(seed); },
});
