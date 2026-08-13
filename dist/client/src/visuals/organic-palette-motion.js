export const DEFAULT_ORGANIC_PALETTE_MOTION_OPTIONS = Object.freeze({
  enabled: false,
  speed: 0.18,
  spatialScale: 0.28,
  amount: 0.55,
});

const UINT32_MAX = 0xffffffff;
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

function parsePalette(palette) {
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError("Organic palette motion requires a non-empty palette.");
  }

  return palette.map(color => {
    if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
      throw new TypeError(
        `Organic palette colors must use six-digit hex values; received "${color}".`,
      );
    }
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
  });
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function latticeValue(x, y, z) {
  let hash = Math.imul(x, 0x1f123bb5)
    ^ Math.imul(y, 0x5f356495)
    ^ Math.imul(z, 0x6c8e9cf5);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / UINT32_MAX;
}

// Smooth deterministic value noise keeps the module usable outside p5 while
// matching the continuous 0..1 output expected from p5's noise function.
function valueNoise3D(x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);

  const nearY0 = lerp(latticeValue(x0, y0, z0), latticeValue(x1, y0, z0), tx);
  const nearY1 = lerp(latticeValue(x0, y1, z0), latticeValue(x1, y1, z0), tx);
  const farY0 = lerp(latticeValue(x0, y0, z1), latticeValue(x1, y0, z1), tx);
  const farY1 = lerp(latticeValue(x0, y1, z1), latticeValue(x1, y1, z1), tx);
  return lerp(lerp(nearY0, nearY1, ty), lerp(farY0, farY1, ty), tz);
}

export class OrganicPaletteMotion {
  constructor(palette, options = {}, noiseFunction) {
    if (noiseFunction != null && typeof noiseFunction !== "function") {
      throw new TypeError("noiseFunction must be a function when provided.");
    }

    this.options = normalizeOrganicPaletteMotionOptions(options);
    this.enabled = this.options.enabled;
    this.paletteColors = parsePalette(palette).map(
      ([red, green, blue]) => `rgb(${red} ${green} ${blue})`,
    );
    this.noiseFunction = noiseFunction ?? valueNoise3D;
  }

  sampleAt(x, y, time) {
    requireFinite(x, "x");
    requireFinite(y, "y");
    requireFinite(time, "time");
    const { spatialScale, speed } = this.options;
    const sample = this.noiseFunction(
      x * spatialScale + NOISE_OFFSET_X,
      y * spatialScale + NOISE_OFFSET_Y,
      time * speed + NOISE_OFFSET_Z,
    );
    requireFinite(sample, "noise sample");
    return clamp01(sample);
  }

  baseColorAt(normalizedPosition) {
    requireFinite(normalizedPosition, "normalizedPosition");
    const lastIndex = this.paletteColors.length - 1;
    return this.paletteColors[Math.round(clamp01(normalizedPosition) * lastIndex)];
  }

  paletteIndexFromSample(basePosition, sample, amount = this.options.amount) {
    requireFinite(basePosition, "basePosition");
    requireFinite(sample, "sample");
    requireFinite(amount, "amount");
    const position = basePosition
      + (clamp01(sample) - basePosition) * clamp01(amount);
    return Math.round(clamp01(position) * (this.paletteColors.length - 1));
  }

  colorFromSample(basePosition, sample, amount = this.options.amount) {
    return this.paletteColors[
      this.paletteIndexFromSample(basePosition, sample, amount)
    ];
  }

  paletteIndexFromNoise(basePosition, sample, amount = this.options.amount) {
    requireFinite(sample, "sample");
    const paletteCount = this.paletteColors.length;
    const bandCount = paletteCount * 3 + 1;
    const bandIndex = Math.min(
      bandCount - 1,
      Math.floor(clamp01(sample) * bandCount),
    );
    const targetIndex = bandIndex % paletteCount;
    const targetPosition = targetIndex / Math.max(1, paletteCount - 1);
    return this.paletteIndexFromSample(basePosition, targetPosition, amount);
  }

  colorFromNoise(basePosition, sample, amount = this.options.amount) {
    return this.paletteColors[
      this.paletteIndexFromNoise(basePosition, sample, amount)
    ];
  }

  colorAt(basePosition, x, y, time) {
    return this.colorFromNoise(basePosition, this.sampleAt(x, y, time));
  }
}

export default OrganicPaletteMotion;
