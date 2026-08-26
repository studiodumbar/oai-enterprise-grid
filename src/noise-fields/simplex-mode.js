// 3D simplex noise — the Ashima / webgl-noise `snoise` kernel, transcribed from
// the reference tool's fragment shader into plain JS.
//
// It is here because simplex has a distinct look that value noise cannot fake:
// no axis-aligned lattice artefacts, and a more even distribution of feature
// sizes. The cost is that its speed-driven drift CANNOT close a loop. Simplex works on a skewed
// lattice, so advancing z by a whole number of units is not a lattice
// translation and the field does not return to where it started. Use
// `cyclesPerLoop: 0` plus a finite `speed` to accept that seam explicitly.
export const SIMPLEX_NOISE_DEFAULTS = Object.freeze({});

const F3 = 1 / 3;
const G3 = 1 / 6;

function mod289(value) {
  return value - Math.floor(value * (1 / 289)) * 289;
}

function permute(value) {
  return mod289(((value * 34) + 1) * value);
}

function taylorInvSqrt(value) {
  return 1.79284291400159 - 0.85373472095314 * value;
}

/** Ashima snoise3D. Returns roughly -1..1. */
export function simplexNoise3D(x, y, z) {
  // Skew the input space to decide which simplex cell the point is in.
  const skew = (x + y + z) * F3;
  const i = Math.floor(x + skew);
  const j = Math.floor(y + skew);
  const k = Math.floor(z + skew);
  const unskew = (i + j + k) * G3;
  const x0 = x - (i - unskew);
  const y0 = y - (j - unskew);
  const z0 = z - (k - unskew);

  // Rank the three coordinates to walk the corners in descending order.
  let i1;
  let j1;
  let k1;
  let i2;
  let j2;
  let k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
  else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
  else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }

  const x1 = x0 - i1 + G3;
  const y1 = y0 - j1 + G3;
  const z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3;
  const y2 = y0 - j2 + 2 * G3;
  const z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3;
  const y3 = y0 - 1 + 3 * G3;
  const z3 = z0 - 1 + 3 * G3;

  const im = mod289(i);
  const jm = mod289(j);
  const km = mod289(k);

  const corners = [
    [0, 0, 0, x0, y0, z0],
    [i1, j1, k1, x1, y1, z1],
    [i2, j2, k2, x2, y2, z2],
    [1, 1, 1, x3, y3, z3],
  ];

  let total = 0;
  for (const [di, dj, dk, cx, cy, cz] of corners) {
    // The gradient index, hashed through the same triple permutation the
    // shader uses so the field matches the reference tool's structure.
    const hash = permute(
      permute(permute(km + dk) + jm + dj) + im + di,
    );
    // Unpack the hash into one of 49 gradient directions on a 7x7 lattice.
    // `permute` only ever yields whole numbers below 289, so this reduces with
    // integer arithmetic. The shader's float form — `j - 49 * floor(j / 49)` —
    // does not survive the move to float64: `98 * (1 / 49)` evaluates to
    // 1.9999999999999998, which lets the index reach 7, walks the gradient off
    // the octahedron, and sends taylorInvSqrt negative. About 1% of samples
    // came back at four times the correct amplitude before this.
    const gradientIndex = hash % 49;
    const xLattice = (gradientIndex - (gradientIndex % 7)) / 7;
    const yLattice = gradientIndex % 7;
    const gx = xLattice * (2 / 7) + (1 / 14 - 1);
    const gy = yLattice * (2 / 7) + (1 / 14 - 1);
    const h = 1 - Math.abs(gx) - Math.abs(gy);
    // Fold the gradient back onto the far face of the octahedron when it landed
    // outside it. `step(h, 0)` in the shader is true at h == 0 too.
    const outside = h <= 0 ? 1 : 0;
    const ax = gx - outside * (Math.floor(gx) * 2 + 1);
    const ay = gy - outside * (Math.floor(gy) * 2 + 1);
    const norm = taylorInvSqrt(ax * ax + ay * ay + h * h);
    const px = ax * norm;
    const py = ay * norm;
    const pz = h * norm;

    let falloff = 0.6 - (cx * cx + cy * cy + cz * cz);
    if (falloff <= 0) continue;
    falloff *= falloff;
    total += falloff * falloff * (px * cx + py * cy + pz * cz);
  }
  return 42 * total;
}

export class SimplexNoiseField {
  sampleAt(x, y, z) {
    return 0.5 + 0.5 * simplexNoise3D(x, y, z);
  }
}

export const SIMPLEX_NOISE_MODE = Object.freeze({
  name: "simplex",
  defaults: SIMPLEX_NOISE_DEFAULTS,
  // The skewed lattice has no whole-number z translation that maps the field
  // onto itself. Non-zero cycles stay forbidden, while speed explicitly opts
  // into free drift and its resulting seam.
  loopable: false,
  minimumLoopCycles: 0,
  shaderMode: "supported",

  normalize(settings) {
    return { ...SIMPLEX_NOISE_DEFAULTS, ...settings };
  },

  createField() {
    return new SimplexNoiseField();
  },
});
