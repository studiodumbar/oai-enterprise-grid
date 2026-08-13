import {
  FieldGeometry,
  clamp01,
  requireFinitePositive,
  requireFraction,
  requireStepCount,
  steppedIndexAt,
} from "./field-geometry.js";

// Strobe Stack, ported from matrix/public/r/dotm-square-8.tsx. Each column
// stacks upward on a per-column stagger, the filled field blinks twice, then the
// columns drain downward with the same stagger.
export const STROBE_STACK_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs a 2000 ms cycle at speed 1.4.
  cycleSeconds: 1.43,
  // Virtual grid the stack sequence runs on, which sets both the stagger and the
  // number of stacking ticks. The loader uses its 5x5 matrix.
  columns: 5,
  rows: 5,
  // The loader's resting dot opacity, and what an unlit dot reads as here.
  baseIntensity: 0.08,
});

// The loader's own levels: a settled dot, the leading cap of a growing column,
// and the two-blink beat once every column is full.
const SETTLED_INTENSITY = 0.52;
const CAP_INTENSITY = 1;
const BLINK_INTENSITIES = Object.freeze([0.38, 1, 0.38, 1]);

function fillHeight(column, tick, rows) {
  return Math.max(0, Math.min(rows, tick - column));
}

function drainHeight(column, tick, rows) {
  return Math.max(0, Math.min(rows, rows - Math.max(0, tick - column)));
}

export class StrobeStackFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.geometry = new FieldGeometry(grid);
    const { rows, columns } = settings;
    // Column 0 fills at tick `rows`; the last column trails by `columns - 1`.
    this.lastFillTick = rows + columns - 1;
    this.blinkStart = this.lastFillTick + 1;
    this.drainStart = this.blinkStart + BLINK_INTENSITIES.length;
    this.stepCount = this.drainStart + this.lastFillTick + 1;
  }

  resize(grid) {
    this.geometry.resize(grid);
  }

  sampleAt(x, y, time) {
    const { rows, columns, cycleSeconds, baseIntensity } = this.settings;
    const column = this.geometry.virtualColumn(x, columns);
    const row = this.geometry.virtualRow(y, rows);
    const step = steppedIndexAt(time, cycleSeconds, this.stepCount);

    let height;
    let blinkIntensity = null;
    if (step <= this.lastFillTick) {
      height = fillHeight(column, step, rows);
    } else if (step < this.drainStart) {
      height = rows;
      blinkIntensity = BLINK_INTENSITIES[step - this.blinkStart];
    } else {
      height = drainHeight(column, step - this.drainStart, rows);
    }

    // Columns stack from the bottom, so the lit span reaches up from the last row.
    const topLitRow = rows - height;
    if (height <= 0 || row < topLitRow) return baseIntensity;
    if (blinkIntensity !== null) return blinkIntensity;
    // A partly filled column keeps a bright cap on its leading dot.
    const isCap = row === topLitRow && height < rows;
    return clamp01(isCap ? CAP_INTENSITY : SETTLED_INTENSITY);
  }
}

export const STROBE_STACK_FLICKER_MODE = Object.freeze({
  name: "strobe-stack",
  defaults: STROBE_STACK_FLICKER_DEFAULTS,
  distribution: "level",

  normalize(settings) {
    const normalized = { ...STROBE_STACK_FLICKER_DEFAULTS, ...settings };
    requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
    requireStepCount(normalized.columns, "columns");
    requireStepCount(normalized.rows, "rows");
    requireFraction(normalized.baseIntensity, "baseIntensity");
    return normalized;
  },

  createField({ settings, grid }) {
    return new StrobeStackFlickerField(settings, grid);
  },
});

export default STROBE_STACK_FLICKER_MODE;
