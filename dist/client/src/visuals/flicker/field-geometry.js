// Shared geometry and clock helpers for flicker modes ported from the
// dot-matrix loaders.
//
// Every loader is authored against a fixed 5x5 matrix, while a flicker field is
// handed whatever extent the renderer gives it — the whole board under canvas
// scope, one cell under cell scope. These helpers put a dot's position into the
// loader's own coordinate space, so a ported motif keeps its shape at any size.
export function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function smoothstep01(value) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

export function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

export function requireFinitePositive(value, label) {
  requireFinite(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
}

export function requireFraction(value, label) {
  requireFinite(value, label);
  if (value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
}

export function requireStepCount(value, label) {
  if (!Number.isInteger(value) || value < 2) {
    throw new RangeError(`${label} must be an integer of at least two.`);
  }
}

/** Continuous 0..1 position inside one cycle. */
export function cyclePhaseAt(time, cycleSeconds) {
  const phase = time / cycleSeconds;
  return phase - Math.floor(phase);
}

/**
 * Which of `steps` discrete ticks a cycle is on. The loaders drive their frame
 * sequences this way, and the pops are intentional.
 */
export function steppedIndexAt(time, cycleSeconds, steps) {
  return Math.min(steps - 1, Math.floor(cyclePhaseAt(time, cycleSeconds) * steps));
}

/** How far into the current tick the cycle is, for smoothing between frames. */
export function stepProgressAt(time, cycleSeconds, steps) {
  const position = cyclePhaseAt(time, cycleSeconds) * steps;
  return position - Math.floor(position);
}

export class FieldGeometry {
  constructor(grid) {
    this.resize(grid);
  }

  resize(grid) {
    const dotsPerCellAxis = grid?.dotsPerCellAxis ?? 1;
    // The field's extent in the finest-subdivision units sampleAt receives.
    // Dots sit at half-step centers, so the span between the first and last dot
    // is one step short of the full width.
    this.width = Math.max(1, (grid?.columns ?? 1) * dotsPerCellAxis);
    this.height = Math.max(1, (grid?.rows ?? 1) * dotsPerCellAxis);
    this.spanX = Math.max(1, this.width - 1);
    this.spanY = Math.max(1, this.height - 1);
  }

  /** 0..1 across the field, left to right. */
  normalizedX(x) {
    return clamp01((x - 0.5) / this.spanX);
  }

  /** 0..1 down the field, top to bottom. */
  normalizedY(y) {
    return clamp01((y - 0.5) / this.spanY);
  }

  /** Nearest column of a `steps`-wide virtual grid, which is how masks index. */
  virtualColumn(x, steps) {
    return Math.round(this.normalizedX(x) * (steps - 1));
  }

  /** Nearest row of a `steps`-tall virtual grid. */
  virtualRow(y, steps) {
    return Math.round(this.normalizedY(y) * (steps - 1));
  }

  /** Position in the loader's centered space, where a 5x5 matrix spans -2..2. */
  centeredX(x, steps) {
    return (this.normalizedX(x) * 2 - 1) * ((steps - 1) * 0.5);
  }

  centeredY(y, steps) {
    return (this.normalizedY(y) * 2 - 1) * ((steps - 1) * 0.5);
  }
}

/**
 * Read a `size`x`size` mask string written row-major, as the loaders author
 * their frames. Returns the raw character so each mode maps it to its own level.
 */
export function maskCellAt(mask, row, column, size) {
  return mask[row * size + column] ?? ".";
}

export function requireMask(mask, size, label) {
  if (typeof mask !== "string" || mask.length !== size * size) {
    throw new TypeError(`${label} must be ${size * size} characters long.`);
  }
  return mask;
}
