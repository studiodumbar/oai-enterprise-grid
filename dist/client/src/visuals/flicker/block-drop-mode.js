import {
  FieldGeometry,
  maskCellAt,
  requireFinitePositive,
  requireFraction,
  steppedIndexAt,
} from "./field-geometry.js";

// Block Drop, ported from matrix/public/r/dotm-square-7.tsx. Stacked frames drop
// and pile up, then two row-clear beats flash the field before it empties.
export const BLOCK_DROP_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs a 1900 ms cycle at speed 1.35.
  cycleSeconds: 1.41,
  baseIntensity: 0.08,
});

// The loader's frames, authored row-major on its 5x5 matrix: "." rests,
// "o" is settled fill, "x" is an active piece, "c" is a row-clear flash.
const MASK_SIZE = 5;
const FRAME_MASKS = Object.freeze([
  "....." + "....." + "....." + "....." + "ooooo",
  "....." + "....." + "....." + "ooooo" + "ooooo",
  "....." + "....." + "ooooo" + "ooooo" + "ooooo",
  "....." + "ooooo" + "ooooo" + "ooooo" + "ooooo",
  "ooooo" + "ooooo" + "ooooo" + "ooooo" + "ooooo",
  "ccccc" + "ccccc" + "ccccc" + "ccccc" + "ccccc",
  "....." + "....." + "....." + "....." + ".....",
  "ccccc" + "ccccc" + "ccccc" + "ccccc" + "ccccc",
  "....." + "....." + "....." + "....." + ".....",
  "....." + "....." + "....." + "....." + ".....",
]);
// The fourth frame is held for two ticks before the clear beats begin.
const FRAME_SEQUENCE = Object.freeze([0, 1, 2, 3, 4, 4, 5, 6, 7, 8, 9]);

const SETTLED_INTENSITY = 0.42;
const ACTIVE_INTENSITY = 1;
const CLEAR_INTENSITY = 0.88;

export class BlockDropFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.geometry = new FieldGeometry(grid);
  }

  resize(grid) {
    this.geometry.resize(grid);
  }

  sampleAt(x, y, time) {
    const { cycleSeconds, baseIntensity } = this.settings;
    const step = steppedIndexAt(time, cycleSeconds, FRAME_SEQUENCE.length);
    const mask = FRAME_MASKS[FRAME_SEQUENCE[step]];
    const column = this.geometry.virtualColumn(x, MASK_SIZE);
    const row = this.geometry.virtualRow(y, MASK_SIZE);

    switch (maskCellAt(mask, row, column, MASK_SIZE)) {
      case "x": return ACTIVE_INTENSITY;
      case "o": return SETTLED_INTENSITY;
      case "c": return CLEAR_INTENSITY;
      default: return baseIntensity;
    }
  }
}

export const BLOCK_DROP_FLICKER_MODE = Object.freeze({
  name: "block-drop",
  defaults: BLOCK_DROP_FLICKER_DEFAULTS,
  distribution: "level",

  normalize(settings) {
    const normalized = { ...BLOCK_DROP_FLICKER_DEFAULTS, ...settings };
    requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
    requireFraction(normalized.baseIntensity, "baseIntensity");
    return normalized;
  },

  createField({ settings, grid }) {
    return new BlockDropFlickerField(settings, grid);
  },
});

export default BLOCK_DROP_FLICKER_MODE;
