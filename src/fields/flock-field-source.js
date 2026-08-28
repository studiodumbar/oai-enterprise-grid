import { debug } from "../debug/index.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export class FlockFieldSurface {
  constructor(options, viewport) {
    if (!Number.isFinite(options?.longSidePixels) || options.longSidePixels < 16) {
      throw new RangeError("flock.field.longSidePixels must be at least 16.");
    }
    if (!Number.isFinite(options.boidSize) || options.boidSize <= 0) {
      throw new RangeError("flock.field.boidSize must be a finite positive number.");
    }
    this.options = options;
    this.resize(viewport);
  }

  resize({ width, height }) {
    const longSide = Math.max(16, Math.round(this.options.longSidePixels));
    const scale = longSide / Math.max(width, height, 1);
    this.width = Math.max(2, Math.round(width * scale));
    this.height = Math.max(2, Math.round(height * scale));
    this.viewport = { width, height };
    this.pixels = new Uint8Array(this.width * this.height);
    this.lifePixels = new Uint8Array(this.width * this.height);
    debug.config(
      "flock-field=resize width=%d height=%d source=%dx%d",
      this.width,
      this.height,
      Math.round(width),
      Math.round(height),
    );
  }

  draw(flock) {
    this.pixels.fill(0);
    this.lifePixels.fill(0);
    const scaleX = this.width / Math.max(1, this.viewport.width);
    const scaleY = this.height / Math.max(1, this.viewport.height);
    const radius = Math.max(0.5, this.options.boidSize * 0.5 * Math.min(scaleX, scaleY));
    const radiusSquared = radius * radius;
    for (const boid of flock.boids) {
      if (!boid.active) continue;
      const centerX = boid.x * scaleX;
      const centerY = boid.y * scaleY;
      const minimumX = Math.max(0, Math.floor(centerX - radius));
      const maximumX = Math.min(this.width - 1, Math.ceil(centerX + radius));
      const minimumY = Math.max(0, Math.floor(centerY - radius));
      const maximumY = Math.min(this.height - 1, Math.ceil(centerY + radius));
      const intensity = Math.round(255 * clamp01(boid.opacity));
      const life = Math.round(255 * clamp01(
        Number(boid.endOfLifeProgress ?? boid.lifeProgress) || 0,
      ));
      for (let y = minimumY; y <= maximumY; y += 1) {
        const dy = y + 0.5 - centerY;
        for (let x = minimumX; x <= maximumX; x += 1) {
          const dx = x + 0.5 - centerX;
          if (dx * dx + dy * dy > radiusSquared) continue;
          const index = y * this.width + x;
          this.pixels[index] = Math.max(this.pixels[index], intensity);
          this.lifePixels[index] = Math.max(this.lifePixels[index], life);
        }
      }
    }
  }

  maximumInPlane(plane, left, top, right, bottom) {
    const minimumX = Math.max(0, Math.floor(left * this.width));
    const maximumX = Math.min(this.width - 1, Math.ceil(right * this.width) - 1);
    const minimumY = Math.max(0, Math.floor(top * this.height));
    const maximumY = Math.min(this.height - 1, Math.ceil(bottom * this.height) - 1);
    let maximum = 0;
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        maximum = Math.max(maximum, plane[y * this.width + x]);
      }
    }
    return maximum / 255;
  }

  maximumInRect(left, top, right, bottom) {
    return this.maximumInPlane(this.pixels, left, top, right, bottom);
  }

  maximumLifeInRect(left, top, right, bottom) {
    return this.maximumInPlane(this.lifePixels, left, top, right, bottom);
  }

  lifeAt(x, y) {
    if (
      x < 0
      || x >= this.viewport.width
      || y < 0
      || y >= this.viewport.height
    ) return 0;
    const column = Math.min(
      this.width - 1,
      Math.floor(x / this.viewport.width * this.width),
    );
    const row = Math.min(
      this.height - 1,
      Math.floor(y / this.viewport.height * this.height),
    );
    return this.lifePixels[row * this.width + column] / 255;
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      pixels: this.pixels.slice(),
      life: this.lifePixels.slice(),
    };
  }
}

export class FlockFieldSource {
  constructor(flock, options, viewport, appearance = {}) {
    this.flock = flock;
    this.surface = new FlockFieldSurface(options, viewport);
    this.appearanceProbability = appearance.probability ?? 1;
    this.appearanceUnit = appearance.unit ?? (() => 0);
    if (
      !Number.isFinite(this.appearanceProbability)
      || this.appearanceProbability < 0
      || this.appearanceProbability > 1
    ) {
      throw new RangeError(
        "flock.grid.appearanceProbability must be between zero and one.",
      );
    }
    if (typeof this.appearanceUnit !== "function") {
      throw new TypeError("Flock cell appearance unit sampler must be a function.");
    }
    this.resetAppearanceState();
    debug.config(
      "flock-cell-appearance probability=%.3f",
      this.appearanceProbability,
    );
  }

  resize(viewport) {
    this.surface.resize(viewport);
    this.resetAppearanceState();
  }

  resetAppearanceState(count = 0) {
    this.appearingCells = new Uint8Array(count);
    this.previouslyInfluencedCells = new Uint8Array(count);
    this.influenceCounts = new Uint32Array(count);
    this.appearanceEventIndex = 0;
  }

  ensureAppearanceState(count) {
    if (this.appearingCells.length !== count) this.resetAppearanceState(count);
  }

  snapshotAppearanceState() {
    return {
      appearingCells: Array.from(this.appearingCells),
      previouslyInfluencedCells: Array.from(this.previouslyInfluencedCells),
      influenceCounts: Array.from(this.influenceCounts),
      appearanceEventIndex: this.appearanceEventIndex,
    };
  }

  restoreAppearanceState(snapshot) {
    const length = this.appearingCells.length;
    if (
      !snapshot
      || snapshot.appearingCells?.length !== length
      || snapshot.previouslyInfluencedCells?.length !== length
      || snapshot.influenceCounts?.length !== length
    ) return false;
    this.appearingCells.set(snapshot.appearingCells);
    this.previouslyInfluencedCells.set(snapshot.previouslyInfluencedCells);
    this.influenceCounts.set(snapshot.influenceCounts);
    this.appearanceEventIndex = snapshot.appearanceEventIndex ?? 0;
    return true;
  }

  write(field) {
    this.surface.draw(this.flock);
    const { columns, rows } = field.layout;
    this.ensureAppearanceState(columns * rows);
    const { cellSize, offsetX, offsetY } = field.layout;
    const viewportWidth = this.surface.viewport.width;
    const viewportHeight = this.surface.viewport.height;
    let started = 0;
    let selected = 0;
    let ended = 0;
    let active = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const energy = this.surface.maximumInRect(
          (offsetX + column * cellSize) / viewportWidth,
          (offsetY + row * cellSize) / viewportHeight,
          (offsetX + (column + 1) * cellSize) / viewportWidth,
          (offsetY + (row + 1) * cellSize) / viewportHeight,
        );
        const isInfluenced = energy > 0;
        const wasInfluenced = this.previouslyInfluencedCells[index] === 1;
        if (isInfluenced && !wasInfluenced) {
          const count = this.influenceCounts[index] + 1;
          this.influenceCounts[index] = count;
          this.appearingCells[index] = Number(
            this.appearanceProbability === 1
            || (
              this.appearanceProbability > 0
              && this.appearanceUnit(index, count) < this.appearanceProbability
            ),
          );
          started += 1;
          selected += this.appearingCells[index];
        } else if (!isInfluenced && wasInfluenced) {
          this.appearingCells[index] = 0;
          ended += 1;
        }
        this.previouslyInfluencedCells[index] = Number(isInfluenced);
        if (isInfluenced && this.appearingCells[index] === 1) {
          field.maxCell(index, energy);
          active += 1;
        }
      }
    }
    if (started > 0 || ended > 0) {
      this.appearanceEventIndex += started + ended;
      debug.cells(
        "flock-cell-appearance event=%d started=%d selected=%d ended=%d active=%d",
        this.appearanceEventIndex,
        started,
        selected,
        ended,
        active,
      );
    }
  }

  snapshot() {
    return this.surface.snapshot();
  }

  lifeAt(x, y) {
    return this.surface.lifeAt(x, y);
  }

  lifeInCell(index, layout) {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const viewportWidth = this.surface.viewport.width;
    const viewportHeight = this.surface.viewport.height;
    return this.surface.maximumLifeInRect(
      (layout.offsetX + column * layout.cellSize) / viewportWidth,
      (layout.offsetY + row * layout.cellSize) / viewportHeight,
      (layout.offsetX + (column + 1) * layout.cellSize) / viewportWidth,
      (layout.offsetY + (row + 1) * layout.cellSize) / viewportHeight,
    );
  }
}
