import { valueNoise3D } from "../visuals/flicker/value-noise.js";

// Fractal value noise: soft drifting blobs, the default look for every layer.
//
// It reuses the repo's one value-noise implementation rather than adding a
// second smooth-noise generator, and it is the only mode that reaches a chosen
// feature size by stacking octaves instead of by raising `scale` alone.
export const VALUE_NOISE_DEFAULTS = Object.freeze({
  octaves: 2,
  // Each further octave halves the amplitude and doubles the frequency at these
  // rates. Lacunarity stays an integer so the periodic lattice of every octave
  // still closes on the same loop.
  gain: 0.5,
  lacunarity: 2,
});

function requireFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite.`);
}

export class ValueNoiseField {
  constructor(settings, loopPeriod) {
    this.settings = settings;
    this.loopPeriod = loopPeriod;
  }

  sampleAt(x, y, z) {
    const { octaves, gain, lacunarity } = this.settings;
    let frequency = 1;
    let amplitude = 1;
    let total = 0;
    let normalizer = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      // Each octave compresses z by the same factor it compresses x and y, so a
      // loop period that is whole at octave 0 stays whole at every octave.
      const period = this.loopPeriod === null
        ? 0
        : this.loopPeriod * frequency;
      total += valueNoise3D(
        x * frequency,
        y * frequency,
        z * frequency,
        period,
      ) * amplitude;
      normalizer += amplitude;
      frequency *= lacunarity;
      amplitude *= gain;
    }
    return total / normalizer;
  }
}

export const VALUE_NOISE_MODE = Object.freeze({
  name: "value",
  defaults: VALUE_NOISE_DEFAULTS,
  // The integer lattice wraps, so the field is continuous across the seam.
  loopable: true,
  minimumLoopCycles: 2,
  shaderMode: "supported",

  normalize(settings) {
    const normalized = { ...VALUE_NOISE_DEFAULTS, ...settings };
    if (
      !Number.isInteger(normalized.octaves)
      || normalized.octaves < 1
      || normalized.octaves > 6
    ) {
      throw new RangeError("octaves must be an integer between 1 and 6.");
    }
    requireFinite(normalized.gain, "gain");
    if (normalized.gain <= 0 || normalized.gain > 1) {
      throw new RangeError("gain must be greater than 0 and at most 1.");
    }
    // A fractional lacunarity would put later octaves on a lattice whose period
    // is no longer whole, and the loop seam would reopen on those octaves only.
    if (!Number.isInteger(normalized.lacunarity) || normalized.lacunarity < 2) {
      throw new RangeError("lacunarity must be an integer of at least 2.");
    }
    return normalized;
  },

  createField({ settings, loopPeriod }) {
    return new ValueNoiseField(settings, loopPeriod);
  },
});
