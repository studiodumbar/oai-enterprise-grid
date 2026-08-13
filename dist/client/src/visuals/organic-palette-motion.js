import { FlickerPalette } from "./flicker/flicker-palette.js";
import {
  NOISE_FLICKER_DEFAULTS,
  NoiseFlickerField,
} from "./flicker/noise-mode.js";

// Compatibility surface for the pre-mode flicker API: one noise field plus the
// shared palette mapping, addressed through a single flat options object. New
// code builds a FlickerController from src/visuals/flicker/ instead, which
// selects the field by mode name.
export const DEFAULT_ORGANIC_PALETTE_MOTION_OPTIONS = Object.freeze({
  enabled: false,
  speed: NOISE_FLICKER_DEFAULTS.speed,
  spatialScale: NOISE_FLICKER_DEFAULTS.spatialScale,
  amount: 0.55,
});

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite.`);
  }
}

export function normalizeOrganicPaletteMotionOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Organic palette motion options must be an object.");
  }

  const normalized = {
    ...DEFAULT_ORGANIC_PALETTE_MOTION_OPTIONS,
    ...options,
  };

  if (typeof normalized.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean.");
  }
  requireFinite(normalized.speed, "speed");
  if (normalized.speed < 0) {
    throw new RangeError("speed must be greater than or equal to zero.");
  }
  requireFinite(normalized.spatialScale, "spatialScale");
  if (normalized.spatialScale <= 0) {
    throw new RangeError("spatialScale must be greater than zero.");
  }
  requireFinite(normalized.amount, "amount");
  if (normalized.amount < 0 || normalized.amount > 1) {
    throw new RangeError("amount must be between zero and one.");
  }

  return normalized;
}

export class OrganicPaletteMotion {
  constructor(palette, options = {}, noiseFunction) {
    this.options = normalizeOrganicPaletteMotionOptions(options);
    this.enabled = this.options.enabled;
    this.palette = new FlickerPalette(palette);
    this.paletteColors = this.palette.paletteColors;
    this.field = new NoiseFlickerField(this.options, noiseFunction);
    this.noiseFunction = this.field.noiseFunction;
  }

  sampleAt(x, y, time) {
    return this.field.sampleAt(x, y, time);
  }

  baseColorAt(normalizedPosition) {
    return this.palette.baseColorAt(normalizedPosition);
  }

  paletteIndexFromSample(basePosition, sample, amount = this.options.amount) {
    return this.palette.paletteIndexFromSample(basePosition, sample, amount);
  }

  colorFromSample(basePosition, sample, amount = this.options.amount) {
    return this.palette.colorFromSample(basePosition, sample, amount);
  }

  paletteIndexFromNoise(basePosition, sample, amount = this.options.amount) {
    return this.palette.paletteIndexFromNoise(basePosition, sample, amount);
  }

  colorFromNoise(basePosition, sample, amount = this.options.amount) {
    return this.palette.colorFromNoise(basePosition, sample, amount);
  }

  colorAt(basePosition, x, y, time) {
    return this.colorFromNoise(basePosition, this.sampleAt(x, y, time));
  }
}

export default OrganicPaletteMotion;
