// Distance to the nearest of one seeded feature point per unit cell, inverted so
// cell centres read bright and the walls between them read dark. Cellular where
// value noise is cloudy: it gives the grid hard territories instead of gradients.
//
// Keep the reference shader's hash33 so imported seeds retain their exact cell
// shapes. Loop-authored motion additionally wraps only the z cell index.
//
// Decorrelation between layers is the sampler's job: it offsets the sample point
// by the layer seed before calling in, which lands this field on different cells.
export const VORONOI_NOISE_DEFAULTS = Object.freeze({
  // 0 pins feature points to cell centres; 1 scatters them through their cell.
  jitter: 1,
});

const NEIGHBORHOOD = 1;
function fract(value) {
  return value - Math.floor(value);
}

export function legacyHash33(x, y, z) {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1030);
  let pz = fract(z * 0.0973);
  const dot = px * (py + 33.33) + py * (px + 33.33) + pz * (pz + 33.33);
  px += dot;
  py += dot;
  pz += dot;
  return [
    fract((px + py) * pz),
    fract((px + px) * py),
    fract((py + px) * px),
  ];
}

function wrapCell(coordinate, period) {
  if (period === null) return coordinate;
  const wrapped = coordinate % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

export class VoronoiNoiseField {
  constructor(settings, loopPeriod) {
    this.settings = settings;
    this.loopPeriod = loopPeriod;
  }

  sampleAt(x, y, z) {
    const { jitter } = this.settings;
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const cellZ = Math.floor(z);
    const localX = x - cellX;
    const localY = y - cellY;
    const localZ = z - cellZ;
    let nearest = Infinity;

    for (let dz = -NEIGHBORHOOD; dz <= NEIGHBORHOOD; dz += 1) {
      // Only the z index wraps. Wrapping x or y as well would tile the pattern
      // spatially, which is a different effect from looping in time.
      const wrappedZ = wrapCell(cellZ + dz, this.loopPeriod);
      for (let dy = -NEIGHBORHOOD; dy <= NEIGHBORHOOD; dy += 1) {
        const keyY = cellY + dy;
        for (let dx = -NEIGHBORHOOD; dx <= NEIGHBORHOOD; dx += 1) {
          const keyX = cellX + dx;
          const point = legacyHash33(keyX, keyY, wrappedZ);
          const offsetX = dx + 0.5 - localX + (point[0] - 0.5) * jitter;
          const offsetY = dy + 0.5 - localY + (point[1] - 0.5) * jitter;
          const offsetZ = dz + 0.5 - localZ + (point[2] - 0.5) * jitter;
          const squared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
          if (squared < nearest) nearest = squared;
        }
      }
    }

    // Same normalization as the reference tool: the raw nearest-point distance
    // rarely exceeds one unit cell, so clamping at 1 keeps the walls dark
    // without compressing the whole field toward mid grey.
    return 1 - Math.min(1, Math.sqrt(nearest));
  }
}

export const VORONOI_NOISE_MODE = Object.freeze({
  name: "voronoi",
  defaults: VORONOI_NOISE_DEFAULTS,
  // Feature points are keyed on the integer cell index, so wrapping that index
  // in z makes the whole field exactly periodic at no extra cost.
  loopable: true,
  minimumLoopCycles: 1,
  shaderMode: "supported",

  normalize(settings) {
    const normalized = { ...VORONOI_NOISE_DEFAULTS, ...settings };
    if (
      !Number.isFinite(normalized.jitter)
      || normalized.jitter < 0
      || normalized.jitter > 1
    ) {
      throw new RangeError("jitter must be between 0 and 1.");
    }
    return normalized;
  },

  createField({ settings, loopPeriod }) {
    return new VoronoiNoiseField(settings, loopPeriod);
  },
});
