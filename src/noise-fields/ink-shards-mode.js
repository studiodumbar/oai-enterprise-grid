// A near-binary collage of nested rectilinear and diagonal cuts. The countdown
// uses it as both its background visibility map and the displacement source for
// ink-spot contours, so its motion translates existing cuts instead of
// reseeding them between frames.

const UINT32_SCALE = 4294967296;

function fract(value) {
  return value - Math.floor(value);
}

function hashCell(x, y, seed, salt) {
  let value = Math.imul(x | 0, 0x1f123bb5)
    ^ Math.imul(y | 0, 0x5f356495)
    ^ Math.imul(seed | 0, 0x6c8e9cf5)
    ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / UINT32_SCALE;
}

function shardLayer(x, y, z, frequency, seed, salt) {
  const driftX = z * (0.19 + hashCell(salt, seed, seed, salt) * 0.17);
  const driftY = z * (-0.13 - hashCell(seed, salt, seed, salt + 1) * 0.11);
  const scaledX = x * frequency + driftX;
  const scaledY = y * frequency + driftY;
  const cellX = Math.floor(scaledX);
  const cellY = Math.floor(scaledY);
  const localX = fract(scaledX);
  const localY = fract(scaledY);
  const direction = Math.floor(hashCell(cellX, cellY, seed, salt) * 6);
  const split = 0.18 + hashCell(cellX, cellY, seed, salt + 17) * 0.64;
  const slope = 0.45 + hashCell(cellX, cellY, seed, salt + 31) * 1.4;
  let filled;
  if (direction === 0) filled = localX < split;
  else if (direction === 1) filled = localY < split;
  else if (direction === 2) {
    filled = localX + slope * localY < split * (1 + slope);
  } else if (direction === 3) {
    filled = (1 - localX) + slope * localY < split * (1 + slope);
  } else if (direction === 4) {
    filled = Math.abs(localX - 0.5) < split * 0.5;
  } else {
    filled = Math.abs(localY - 0.5) < split * 0.5;
  }

  // Nested cut-outs create the small ledges and white islands visible inside
  // otherwise broad blocks in the reference matte.
  const insetWidth = 0.14 + hashCell(cellX, cellY, seed, salt + 47) * 0.42;
  const insetHeight = 0.12 + hashCell(cellX, cellY, seed, salt + 59) * 0.4;
  const insetX = hashCell(cellX, cellY, seed, salt + 71) * (1 - insetWidth);
  const insetY = hashCell(cellX, cellY, seed, salt + 83) * (1 - insetHeight);
  if (
    localX >= insetX
    && localX <= insetX + insetWidth
    && localY >= insetY
    && localY <= insetY + insetHeight
  ) {
    filled = !filled;
  }
  return filled ? 1 : 0;
}

export class InkShardsField {
  constructor(settings, seed, seedBits = null) {
    this.settings = settings;
    this.seed = seedBits === null
      ? Math.round(seed * 65536) | 0
      : seedBits | 0;
  }

  sampleAt(x, y, z) {
    const coarse = shardLayer(x, y, z, 0.8, this.seed, 0x137);
    const middle = shardLayer(x, y, z, 2.35, this.seed, 0x241);
    const fine = shardLayer(x, y, z, 6.9, this.seed, 0x35d);
    const micro = shardLayer(x, y, z, 13.8, this.seed, 0x46f);
    const chevron = fract(
      (x * 1.35 + y * 2.1 + z * this.settings.crawl) * 0.5,
    );
    const diagonalCut = chevron < 0.5 ? chevron * 2 : (1 - chevron) * 2;
    return Math.max(0, Math.min(1,
      coarse * 0.28
      + middle * 0.27
      + fine * 0.21
      + micro * 0.14
      + diagonalCut * 0.1,
    ));
  }
}

export const INK_SHARDS_MODE = Object.freeze({
  name: "ink-shards",
  defaults: Object.freeze({ crawl: 0.7 }),
  loopable: false,
  minimumLoopCycles: 0,
  shaderMode: "unsupported",
  allowedLayers: Object.freeze(["visibility"]),

  normalize(settings) {
    const normalized = { crawl: 0.7, ...settings };
    if (!Number.isFinite(normalized.crawl) || normalized.crawl < 0) {
      throw new RangeError("crawl must be a finite non-negative number.");
    }
    return normalized;
  },

  createField({ settings, seed, seedBits }) {
    return new InkShardsField(settings, seed, seedBits);
  },
});
