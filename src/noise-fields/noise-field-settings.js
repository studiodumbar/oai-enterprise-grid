// One authored shape controls the layered noise grid:
//
//   noiseFields: {
//     enabled: true,
//     levelCount: 4,              // how many subdivision levels size may pick
//     modes: {                    // defaults every layer inherits, by mode name
//       value: { octaves: 2 },
//     },
//     layers: {
//       size:       { mode, scale, contrast, seed, cyclesPerLoop, … },
//       color:      { … },
//       contrast:   { … },
//       visibility: { … },
//     },
//   }
//
// App-wide defaults live in config/global.js; a composition overrides only the
// keys it cares about. Precedence per mode block is
// `mode-owned defaults < noiseFields.modes < layer.modes`, so a composition can
// retune one layer's noise without restating the other three.
//
// Every rate reads the composition's one absolute timeline; layers never own a
// clock. `cyclesPerLoop` is how many whole noise periods a layer travels in one
// composition loop. Color and visibility use `holdSeconds` for the
// original per-glyph minimum-change timer; the field underneath never stops.
// `"auto"` and `"calc(auto * n)"` resolve from the composition beat.
// `cyclesPerLoop: "auto"` similarly means one repeat per beat. `speed` is the
// signed fallback drift in field units per second; it is mutually exclusive
// with non-zero cycles and may create a visible loop seam.

import { automaticDurationMultiplier } from "../core/automatic-duration.js";
import { resolveTimelineDuration } from "../timeline/timeline-settings.js";

// The four layers, and what each one decides. Every layer samples the same
// generator family; only what its value is used for differs.
export const NOISE_LAYER_NAMES = Object.freeze([
  // Averaged over the whole parent cell, it picks that cell's subdivision level.
  "size",
  // One tap per parent cell: the shared base palette entry every circle in the
  // cell starts from.
  "color",
  // Averaged over each circle's own footprint: shifts that circle off the
  // shared base, which is what gives a cell internal light and dark.
  "contrast",
  // Averaged over each circle's own footprint: keeps or drops that circle.
  "visibility",
]);

const SHARED_LAYER_DEFAULTS = Object.freeze({
  mode: "value",
  // Field units across the canvas's short axis. Larger is busier.
  scale: 2.4,
  // Curve around the midpoint before the fixed S-curve. 1 leaves it alone.
  contrast: 1.15,
  // Decorrelates this layer from the other three, in space and in phase.
  seed: 0,
  // null uses loop progress. A finite number drifts in field units per second.
  speed: null,
  // Whole noise periods travelled per composition loop. 0 leaves motion to
  // speed; with speed null as well, the layer is stationary.
  // Anything else must be at least 2: a single period collapses the wrapped
  // lattice onto one plane, which freezes the layer by accident.
  cyclesPerLoop: 2,
});

// Defaults that belong to one layer because no other layer has the concept.
const LAYER_DEFAULTS = Object.freeze({
  size: Object.freeze({
    scale: 2.4,
    contrast: 1.15,
    seed: 1,
    // Tone curve on the averaged cell value before it picks a level.
    gamma: 1,
    // false: dark cells subdivide finest. true swaps that.
    invert: false,
    // Cells whose raw value falls below this stay blank. 0 keeps every cell.
    emptyBelow: 0,
  }),
  color: Object.freeze({
    scale: 5.2,
    contrast: 1.1,
    seed: 17,
    holdSeconds: 0.2,
  }),
  contrast: Object.freeze({
    scale: 2.1,
    contrast: 1,
    seed: 43,
    // 0 leaves every circle on its cell's base color; 1 is full modulation.
    influence: 1,
  }),
  visibility: Object.freeze({
    scale: 1.6,
    contrast: 1.2,
    seed: 29,
    holdSeconds: 0.2,
    // Field value a circle must reach to be drawn.
    threshold: 0.5,
    // 0 gates whole cells at once. Above 0 it becomes a per-circle grey zone
    // this wide either side of the threshold, so edges thin out one circle at a
    // time instead of a cell popping in whole.
    softness: 0.1,
  }),
});

export const DEFAULT_NOISE_FIELD_SETTINGS = Object.freeze({
  enabled: true,
  // Subdivision levels the size layer may choose between, counted from 1x1.
  // 4 spans 1x1 to 8x8; 5 adds the 16x16 cell.
  levelCount: 5,
  // Fraction of a slot's width left empty around each circle.
  dotMargin: 0,
  modes: Object.freeze({}),
  layers: Object.freeze({}),
});

function requireSettingsObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
}

function requireFraction(value, label) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between 0 and 1.`);
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be true or false.`);
  }
}

function resolveHoldSeconds(value, label, timing) {
  if (value === 0) return 0;
  return resolveTimelineDuration(value, {
    automaticSeconds: timing?.beatSeconds,
    label,
    source: "composition-beat",
  }).seconds;
}

function resolveCyclesPerLoop(value, label, timing) {
  if (Number.isSafeInteger(value)) return value;
  const multiplier = automaticDurationMultiplier(value);
  if (multiplier === null) {
    throw new RangeError(
      `${label} must be an integer, "auto", or "calc(auto * n)".`,
    );
  }
  const beatCount = timing?.beatCount;
  if (!Number.isSafeInteger(beatCount) || beatCount < 1) {
    throw new RangeError(
      `${label} is ${JSON.stringify(value)}, but no positive composition beatCount was available.`,
    );
  }
  const cycles = beatCount * multiplier;
  if (!Number.isSafeInteger(cycles) || cycles < 1) {
    throw new RangeError(
      `${label} resolves to ${cycles}; automatic loop cycles must be a positive integer.`,
    );
  }
  return cycles;
}

// Merge mode tables by mode name, then by setting key — never index-wise and
// never a blanket deep merge. CONFIG_ARCHITECTURE.md, "Inheritance and override
// rules".
function mergeModeSettings(label, ...groups) {
  const modes = {};
  for (const group of groups) {
    if (group === undefined) continue;
    requireSettingsObject(group, `${label} modes`);
    for (const [name, settings] of Object.entries(group)) {
      modes[name] = {
        ...(modes[name] ?? {}),
        ...requireSettingsObject(settings, `${label} mode "${name}"`),
      };
    }
  }
  return modes;
}

function resolveLayer(name, base, overrides, sharedModes, modeRegistry, timing) {
  const label = `noiseFields.layers.${name}`;
  const resolved = {
    ...SHARED_LAYER_DEFAULTS,
    ...LAYER_DEFAULTS[name],
    ...requireSettingsObject(base ?? {}, `${label} defaults`),
    ...requireSettingsObject(overrides ?? {}, label),
  };

  requireFinitePositive(resolved.scale, `${label}.scale`);
  requireFinitePositive(resolved.contrast, `${label}.contrast`);
  if (!Number.isInteger(resolved.seed) || resolved.seed < 0) {
    throw new RangeError(`${label}.seed must be a non-negative integer.`);
  }
  resolved.cyclesPerLoop = resolveCyclesPerLoop(
    resolved.cyclesPerLoop,
    `${label}.cyclesPerLoop`,
    timing,
  );
  if (resolved.speed !== null && !Number.isFinite(resolved.speed)) {
    throw new RangeError(`${label}.speed must be null or a finite number.`);
  }
  if (resolved.speed !== null && resolved.cyclesPerLoop !== 0) {
    throw new Error(
      `${label} cannot author both speed and non-zero cyclesPerLoop; `
      + "use speed for free drift or cyclesPerLoop for loop motion.",
    );
  }
  const minimumCycles = modeRegistry.get(resolved.mode).minimumLoopCycles;
  const allowedLayers = modeRegistry.get(resolved.mode).allowedLayers;
  if (allowedLayers && !allowedLayers.includes(name)) {
    throw new Error(`Noise field mode "${resolved.mode}" supports only these layers: ${allowedLayers.join(", ")}.`);
  }
  if (resolved.speed === null && resolved.cyclesPerLoop !== 0 && Math.abs(resolved.cyclesPerLoop) < minimumCycles) {
    throw new RangeError(
      `${label}.cyclesPerLoop must be 0 or have an absolute value of at least ${minimumCycles} for mode "${resolved.mode}".`,
    );
  }
  if (name === "size" || name === "contrast") {
    if (Object.hasOwn(base ?? {}, "holdSeconds") || Object.hasOwn(overrides ?? {}, "holdSeconds")) {
      throw new Error(`${label}.holdSeconds is not supported; only color and visibility may hold.`);
    }
    delete resolved.holdSeconds;
  } else {
    resolved.holdSeconds = resolveHoldSeconds(
      resolved.holdSeconds,
      `${label}.holdSeconds`,
      timing,
    );
  }

  // Validate every registered mode, not only the active one, so switching
  // `mode` later cannot surface a config error mid-composition.
  const mode = modeRegistry.get(resolved.mode);
  if (resolved.speed === null && resolved.cyclesPerLoop !== 0) {
    modeRegistry.requireLoopable(resolved.mode);
  }
  const authoredModes = mergeModeSettings(label, sharedModes, resolved.modes);
  const modes = {};
  for (const registered of modeRegistry.list()) {
    const descriptor = modeRegistry.get(registered);
    const authored = { ...descriptor.defaults, ...authoredModes[registered] };
    modes[registered] = descriptor.normalize
      ? descriptor.normalize(authored)
      : authored;
  }

  return { ...resolved, mode: mode.name, modes };
}

function validateLayerExtras(layers) {
  const { size, contrast, visibility } = layers;
  requireFinitePositive(size.gamma, "noiseFields.layers.size.gamma");
  requireBoolean(size.invert, "noiseFields.layers.size.invert");
  requireFraction(size.emptyBelow, "noiseFields.layers.size.emptyBelow");
  requireFraction(contrast.influence, "noiseFields.layers.contrast.influence");
  requireFraction(visibility.threshold, "noiseFields.layers.visibility.threshold");
  if (
    !Number.isFinite(visibility.softness)
    || visibility.softness < 0
    || visibility.softness > 0.5
  ) {
    throw new RangeError(
      "noiseFields.layers.visibility.softness must be between 0 and 0.5.",
    );
  }
}

/**
 * Resolve the app-wide layered-noise block against one composition's overrides.
 * Authored objects are never mutated; the result is a new, complete settings
 * object with every mode normalized.
 */
export function resolveNoiseFieldSettings(base = {}, overrides = {}, { modeRegistry, timing } = {}) {
  if (!modeRegistry || typeof modeRegistry.get !== "function") {
    throw new TypeError("resolveNoiseFieldSettings requires a mode registry.");
  }
  requireSettingsObject(base, "Base noise field settings");
  requireSettingsObject(overrides, "Noise field overrides");

  const shared = {
    ...DEFAULT_NOISE_FIELD_SETTINGS,
    ...base,
    ...overrides,
  };
  requireBoolean(shared.enabled, "noiseFields.enabled");
  // 4 levels reach 8x8 per cell; 5 reaches 16x16, which is 256 circles sharing
  // one base color and the signature of this pattern. Beyond that a circle is
  // sub-pixel at any sane canvas size.
  if (
    !Number.isInteger(shared.levelCount)
    || shared.levelCount < 1
    || shared.levelCount > 5
  ) {
    throw new RangeError("noiseFields.levelCount must be an integer between 1 and 5.");
  }
  if (
    !Number.isFinite(shared.dotMargin)
    || shared.dotMargin < 0
    || shared.dotMargin >= 1
  ) {
    throw new RangeError(
      "noiseFields.dotMargin must be between 0 (inclusive) and 1 (exclusive).",
    );
  }

  const sharedModes = mergeModeSettings("noiseFields", base.modes, overrides.modes);
  const baseLayers = requireSettingsObject(base.layers ?? {}, "noiseFields.layers");
  const localLayers = requireSettingsObject(
    overrides.layers ?? {},
    "noiseFields.layers",
  );
  for (const name of Object.keys({ ...baseLayers, ...localLayers })) {
    if (!NOISE_LAYER_NAMES.includes(name)) {
      throw new Error(
        `Unknown noise layer "${name}". Available layers: `
        + `${NOISE_LAYER_NAMES.join(", ")}.`,
      );
    }
  }

  const layers = {};
  for (const name of NOISE_LAYER_NAMES) {
    layers[name] = resolveLayer(
      name,
      baseLayers[name],
      localLayers[name],
      sharedModes,
      modeRegistry,
      timing,
    );
  }
  validateLayerExtras(layers);

  return {
    enabled: shared.enabled,
    levelCount: shared.levelCount,
    dotMargin: shared.dotMargin,
    modes: sharedModes,
    layers,
  };
}
