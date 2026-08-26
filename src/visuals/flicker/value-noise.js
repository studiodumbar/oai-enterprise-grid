// Smooth deterministic value noise. It lives on its own so both the palette
// mapper and the noise flicker mode sample the identical field, and so a build
// without p5 still produces the continuous 0..1 output p5's noise() returns.
const UINT32_MAX = 0xffffffff;

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

// Wrap a lattice coordinate into [0, period). A field whose integer lattice
// coordinate wraps is exactly periodic in that axis, which is how a noise layer
// returns to its own first frame at the end of a loop instead of jumping.
function wrapLattice(coordinate, period) {
  if (period <= 0) return coordinate;
  const wrapped = coordinate % period;
  return wrapped < 0 ? wrapped + period : wrapped;
}

function latticeValue(x, y, z) {
  let hash = Math.imul(x, 0x1f123bb5)
    ^ Math.imul(y, 0x5f356495)
    ^ Math.imul(z, 0x6c8e9cf5);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / UINT32_MAX;
}

/**
 * `zPeriod` is optional. Left at zero the field drifts forever, which is what
 * the flicker modes want. A positive integer makes the field periodic in z with
 * that period, so a layer driven by it is continuous across a loop seam instead
 * of teleporting there.
 *
 * Periodicity lives in the integer lattice, so bit-exact repetition needs the
 * caller to hand in a z already inside [0, zPeriod) — reduce the discrete step
 * that produced it, not the float. Sampling z far outside the range still looks
 * periodic but drifts by float rounding.
 */
export function valueNoise3D(x, y, z, zPeriod = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = wrapLattice(z0 + 1, zPeriod);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);
  const zNear = wrapLattice(z0, zPeriod);

  const nearY0 = lerp(latticeValue(x0, y0, zNear), latticeValue(x1, y0, zNear), tx);
  const nearY1 = lerp(latticeValue(x0, y1, zNear), latticeValue(x1, y1, zNear), tx);
  const farY0 = lerp(latticeValue(x0, y0, z1), latticeValue(x1, y0, z1), tx);
  const farY1 = lerp(latticeValue(x0, y1, z1), latticeValue(x1, y1, z1), tx);
  return lerp(lerp(nearY0, nearY1, ty), lerp(farY0, farY1, ty), tz);
}

export default valueNoise3D;
