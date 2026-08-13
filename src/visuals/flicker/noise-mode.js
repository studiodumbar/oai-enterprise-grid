import { valueNoise3D } from "./value-noise.js";

// Noise flicker: every dot reads one continuous 3D noise field, so neighboring
// dots agitate together in soft drifting clouds instead of independently.
export const NOISE_FLICKER_DEFAULTS = Object.freeze({
  speed: 0.18,
  spatialScale: 0.28,
});

const NOISE_OFFSET_X = 17.173;
const NOISE_OFFSET_Y = 41.719;
const NOISE_OFFSET_Z = 73.481;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

export class NoiseFlickerField {
  constructor(settings, noiseFunction) {
    if (noiseFunction != null && typeof noiseFunction !== "function") {
      throw new TypeError("noiseFunction must be a function when provided.");
    }
    this.settings = settings;
    this.noiseFunction = noiseFunction ?? valueNoise3D;
  }

  sampleAt(x, y, time) {
    requireFinite(x, "x");
    requireFinite(y, "y");
    requireFinite(time, "time");
    const { spatialScale, speed } = this.settings;
    const sample = this.noiseFunction(
      x * spatialScale + NOISE_OFFSET_X,
      y * spatialScale + NOISE_OFFSET_Y,
      time * speed + NOISE_OFFSET_Z,
    );
    requireFinite(sample, "noise sample");
    return clamp01(sample);
  }
}

export const NOISE_FLICKER_MODE = Object.freeze({
  name: "noise",
  defaults: NOISE_FLICKER_DEFAULTS,
  // Noise carries no meaningful absolute value, so the shared renderer stays
  // free to spread a cell's dots evenly across the palette by noise rank.
  distribution: "auto",

  normalize(settings) {
    const normalized = { ...NOISE_FLICKER_DEFAULTS, ...settings };
    requireFinite(normalized.speed, "speed");
    if (normalized.speed < 0) {
      throw new RangeError("speed must be greater than or equal to zero.");
    }
    requireFinite(normalized.spatialScale, "spatialScale");
    if (normalized.spatialScale <= 0) {
      throw new RangeError("spatialScale must be greater than zero.");
    }
    return normalized;
  },

  createField({ settings, noiseFunction }) {
    return new NoiseFlickerField(settings, noiseFunction);
  },
});

export default NOISE_FLICKER_MODE;
