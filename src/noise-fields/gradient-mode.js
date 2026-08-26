// A directional ramp, not noise. The field is a mirrored triangle wave running
// along one direction, so the grid reads as clean bands sweeping across the
// canvas — the layer to reach for when a layer should be legible rather than
// organic.
//
// The direction comes from the layer seed through the golden angle, which
// spreads successive integer seeds around the circle instead of clustering them.
export const GRADIENT_NOISE_DEFAULTS = Object.freeze({
  // Bands per unit of field space, along the ramp direction.
  frequency: 1,
});

const GOLDEN_ANGLE = 2.39996323;

function fract(value) {
  return value - Math.floor(value);
}

export class GradientNoiseField {
  constructor(settings, seed, loopPeriod) {
    this.settings = settings;
    this.looping = loopPeriod !== null;
    const angle = seed * GOLDEN_ANGLE;
    this.directionX = Math.cos(angle);
    this.directionY = Math.sin(angle);
  }

  sampleAt(x, y, z) {
    const along = (x * this.directionX + y * this.directionY)
      * this.settings.frequency;
    // Preserve the reference tool's period-2 ramp for speed-driven motion.
    // Loop-authored motion expresses repeats, so it advances two field units
    // per requested cycle without changing the legacy speed scale.
    const phase = along + z * (this.looping ? 2 : 1);
    return 1 - Math.abs(fract(phase / 2) * 2 - 1);
  }
}

export const GRADIENT_NOISE_MODE = Object.freeze({
  name: "gradient",
  defaults: GRADIENT_NOISE_DEFAULTS,
  // Loop-authored z is converted from repeats to the legacy period-2 units.
  loopable: true,
  minimumLoopCycles: 1,
  shaderMode: "supported",

  normalize(settings) {
    const normalized = { ...GRADIENT_NOISE_DEFAULTS, ...settings };
    if (!Number.isFinite(normalized.frequency) || normalized.frequency <= 0) {
      throw new RangeError("frequency must be a finite positive number.");
    }
    return normalized;
  },

  createField({ settings, seed, loopPeriod }) {
    return new GradientNoiseField(settings, seed, loopPeriod);
  },
});
