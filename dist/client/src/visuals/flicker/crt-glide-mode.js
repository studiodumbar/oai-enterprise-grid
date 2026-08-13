import {
  FieldGeometry,
  requireFinite,
  requireFinitePositive,
  requireFraction,
  requireStepCount,
  steppedIndexAt,
} from "./field-geometry.js";

// CRT Glide, ported from matrix/public/r/dotm-square-10.tsx. A scanline steps
// down the field and the rows it has passed keep a decaying phosphor trail, with
// a slight column-wise warp so the trail is not perfectly flat.
export const CRT_GLIDE_FLICKER_DEFAULTS = Object.freeze({
  // The loader runs a 1500 ms cycle at speed 2.5.
  cycleSeconds: 0.6,
  // Scanline positions per pass. The loader steps once per matrix row.
  rows: 5,
  // Trail falloff per row of age, and the column warp depth.
  decay: 0.72,
  columnWarp: 0.07,
  baseIntensity: 0.08,
  peakIntensity: 1,
});

// The loader's warp frequencies, in its own row/column units.
const WARP_COLUMN_RATE = 1.72;
const WARP_SCAN_RATE = 0.61;

export class CrtGlideFlickerField {
  constructor(settings, grid) {
    this.settings = settings;
    this.geometry = new FieldGeometry(grid);
  }

  resize(grid) {
    this.geometry.resize(grid);
  }

  sampleAt(x, y, time) {
    const {
      rows,
      cycleSeconds,
      decay,
      columnWarp,
      baseIntensity,
      peakIntensity,
    } = this.settings;
    const scanRow = steppedIndexAt(time, cycleSeconds, rows);
    const row = this.geometry.virtualRow(y, rows);
    // Rows the scanline has not reached yet stay dark.
    if (row > scanRow) return baseIntensity;

    const column = this.geometry.virtualColumn(x, rows);
    const columnGain = 1 + columnWarp * Math.sin(
      column * WARP_COLUMN_RATE + scanRow * WARP_SCAN_RATE,
    );
    const trail = Math.exp(-(scanRow - row) * decay);
    return Math.min(
      peakIntensity,
      baseIntensity + (peakIntensity - baseIntensity) * trail * columnGain,
    );
  }
}

export const CRT_GLIDE_FLICKER_MODE = Object.freeze({
  name: "crt-glide",
  defaults: CRT_GLIDE_FLICKER_DEFAULTS,
  distribution: "level",

  normalize(settings) {
    const normalized = { ...CRT_GLIDE_FLICKER_DEFAULTS, ...settings };
    requireFinitePositive(normalized.cycleSeconds, "cycleSeconds");
    requireStepCount(normalized.rows, "rows");
    requireFinitePositive(normalized.decay, "decay");
    requireFinite(normalized.columnWarp, "columnWarp");
    if (normalized.columnWarp < 0) {
      throw new RangeError("columnWarp must be greater than or equal to zero.");
    }
    requireFraction(normalized.baseIntensity, "baseIntensity");
    requireFraction(normalized.peakIntensity, "peakIntensity");
    if (normalized.peakIntensity <= normalized.baseIntensity) {
      throw new RangeError("peakIntensity must be greater than baseIntensity.");
    }
    return normalized;
  },

  createField({ settings, grid }) {
    return new CrtGlideFlickerField(settings, grid);
  },
});

export default CRT_GLIDE_FLICKER_MODE;
