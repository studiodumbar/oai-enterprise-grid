export const LEGACY_NOISE_PARAM_DEFAULTS = Object.freeze({
  tab: "user",
  sizeType: "simplex", sizeScale: 2.4, sizeSpeed: 0.12, sizeContrast: 1.15, sizeSeed: 1,
  colorType: "simplex", colorScale: 5.2, colorSpeed: -0.08, colorContrast: 1.1, colorSeed: 17,
  contrastType: "simplex", contrastScale: 2.1, contrastSpeed: 0.05, contrastContrast: 1, contrastSeed: 43,
  contrastInfluence: 1, colorHold: 0.2,
  maskType: "simplex", maskScale: 1.6, maskSpeed: 0.07, maskContrast: 1.2, maskSeed: 29,
  maskThreshold: 0.5, maskSoftness: 0.1, maskHold: 0.2,
  longCells: 9, frameMargin: 1, dotMargin: 0,
  animate: false, animDur: 0.23, cascade: true, smoothing: 0.5,
  emptyBelow: 0, hysteresis: 0.03, gamma: 1, invert: false,
  colorSet: "green", bgColor: "#ffffff", debugGrid: false,
  duration: 4,
});

const TYPES = new Set(["value", "simplex", "voronoi", "gradient", "life"]);

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function integer(value, fallback, minimum, maximum) {
  return Math.round(number(value, fallback, minimum, maximum));
}

export function normalizeLegacyNoiseParams(source = {}) {
  const params = { ...LEGACY_NOISE_PARAM_DEFAULTS };
  for (const prefix of ["size", "color", "contrast", "mask"]) {
    const typeKey = `${prefix}Type`;
    if (TYPES.has(source[typeKey])) params[typeKey] = source[typeKey];
    params[`${prefix}Scale`] = number(source[`${prefix}Scale`], params[`${prefix}Scale`], 0.2, 50);
    params[`${prefix}Speed`] = number(source[`${prefix}Speed`], params[`${prefix}Speed`], -1, 1);
    params[`${prefix}Contrast`] = number(source[`${prefix}Contrast`], params[`${prefix}Contrast`], 0.2, 3);
    params[`${prefix}Seed`] = integer(source[`${prefix}Seed`], params[`${prefix}Seed`], 0, 100);
  }
  if (params.sizeType === "life") params.sizeType = "simplex";
  if (params.contrastType === "life") params.contrastType = "simplex";
  if (params.maskType === "life") params.maskType = "simplex";
  params.contrastInfluence = number(source.contrastInfluence, params.contrastInfluence, 0, 1);
  params.colorHold = number(source.colorHold, params.colorHold, 0, 2);
  params.maskThreshold = number(source.maskThreshold, params.maskThreshold, 0, 1);
  params.maskSoftness = number(source.maskSoftness, params.maskSoftness, 0, 0.5);
  params.maskHold = number(source.maskHold, params.maskHold, 0, 2);
  params.longCells = integer(source.longCells, params.longCells, 3, 31) | 1;
  params.frameMargin = integer(source.frameMargin, params.frameMargin, 0, 10);
  params.dotMargin = number(source.dotMargin, params.dotMargin, 0, 0.9);
  params.animDur = number(source.animDur, params.animDur, 0.01, 10);
  params.smoothing = number(source.smoothing, params.smoothing, 0, 0.99);
  params.emptyBelow = number(source.emptyBelow, params.emptyBelow, 0, 0.3);
  params.hysteresis = number(source.hysteresis, params.hysteresis, 0, 0.15);
  params.gamma = number(source.gamma, params.gamma, 0.2, 3);
  for (const key of ["animate", "cascade", "invert", "debugGrid"]) {
    if (typeof source[key] === "boolean") params[key] = source[key];
  }
  if (typeof source.colorSet === "string") params.colorSet = source.colorSet;
  if (/^#[0-9a-f]{6}$/i.test(source.bgColor)) params.bgColor = source.bgColor;
  params.duration = number(source.duration, params.duration, 0.5, 60);
  params.tab = source.tab === "dev" ? "dev" : "user";
  return params;
}
