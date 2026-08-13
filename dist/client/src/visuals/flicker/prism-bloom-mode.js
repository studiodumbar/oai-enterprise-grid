import {
  FieldGeometry,
  maskCellAt,
  requireFinite,
  requireFinitePositive,
  requireFraction,
  smoothstep01,
  stepProgressAt,
  steppedIndexAt,
} from "./field-geometry.js";

// Prism Bloom, ported from matrix/public/r/dotm-square-14.tsx. A symmetric
// kaleidoscope cycles through four radial motifs and back down again. The loader
// crossfades frames with a 180 ms CSS transition, which `blendSeconds` keeps.
export const PRISM_BLOOM_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs a 1700 ms cycle at speed 1.25.
  cycleSeconds: 1.36,
  // The loader's `opacity 180ms` transition between frames. Zero snaps instead.
  blendSeconds: 0.18,
  baseIntensity: 0.08,
});

// The loader's four motifs, row-major on its 5x5 matrix: "x" peaks, "o" sits at
// mid level, "." rests.
const MASK_SIZE = 5;
const FRAME_MASKS = Object.freeze([
  // Diagonal star
  "x...x" + ".x.x." + "..o.." + ".x.x." + "x...x",
  // Diamond bloom
  "..x.." + ".oxo." + "xooox" + ".oxo." + "..x..",
  // Petal ring
  ".x.x." + "x.o.x" + "..o.." + "x.o.x" + ".x.x.",
  // Crossed lattice
  "x.x.x" + ".o.o." + "x.o.x" + ".o.o." + "x.x.x",
]);
// Out through the motifs and back, so the bloom breathes rather than restarting.
const FRAME_SEQUENCE = Object.freeze([0, 1, 2, 3, 2, 1]);

const MID_INTENSITY = 0.52;
const PEAK_INTENSITY = 1;

export class PrismBloomFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.geometry = new FieldGeometry(grid);
    this.stepSeconds = settings.cycleSeconds / FRAME_SEQUENCE.length;
  }

  resize(grid) {
    this.geometry.resize(grid);
  }

  intensityForFrame(sequenceIndex, row, column) {
    const mask = FRAME_MASKS[FRAME_SEQUENCE[sequenceIndex]];
    switch (maskCellAt(mask, row, column, MASK_SIZE)) {
      case "x": return PEAK_INTENSITY;
      case "o": return MID_INTENSITY;
      default: return this.settings.baseIntensity;
    }
  }

  sampleAt(x, y, time) {
    const { cycleSeconds, blendSeconds } = this.settings;
    const steps = FRAME_SEQUENCE.length;
    const step = steppedIndexAt(time, cycleSeconds, steps);
    const column = this.geometry.virtualColumn(x, MASK_SIZE);
    const row = this.geometry.virtualRow(y, MASK_SIZE);
    const current = this.intensityForFrame(step, row, column);
    if (blendSeconds <= 0 || this.stepSeconds <= 0) return current;

    // Ease out of the previous frame over the loader's transition window, so the
    // motifs melt into each other instead of cutting.
    const blendFraction = Math.min(1, blendSeconds / this.stepSeconds);
    const progress = stepProgressAt(time, cycleSeconds, steps);
    if (progress >= blendFraction) return current;
    const previous = this.intensityForFrame((step + steps - 1) % steps, row, column);
    return previous + (current - previous) * smoothstep01(progress / blendFraction);
  }
}

export const PRISM_BLOOM_FLICKER_MODE = Object.freeze({
  name: "prism-bloom",
  defaults: PRISM_BLOOM_FLICKER_DEFAULTS,
  distribution: "level",

  normalize(settings) {
    const normalized = { ...PRISM_BLOOM_FLICKER_DEFAULTS, ...settings };
    requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
    requireFinite(normalized.blendSeconds, "blendSeconds");
    if (normalized.blendSeconds < 0) {
      throw new RangeError("blendSeconds must be greater than or equal to zero.");
    }
    requireFraction(normalized.baseIntensity, "baseIntensity");
    return normalized;
  },

  createField({ settings, grid }) {
    return new PrismBloomFlickerField(settings, grid);
  },
});

export default PRISM_BLOOM_FLICKER_MODE;
