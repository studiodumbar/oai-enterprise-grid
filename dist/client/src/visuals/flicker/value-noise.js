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

function latticeValue(x, y, z) {
  let hash = Math.imul(x, 0x1f123bb5)
    ^ Math.imul(y, 0x5f356495)
    ^ Math.imul(z, 0x6c8e9cf5);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / UINT32_MAX;
}

export function valueNoise3D(x, y, z) {
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

export default valueNoise3D;
