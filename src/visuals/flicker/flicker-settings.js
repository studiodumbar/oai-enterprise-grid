// One authored shape controls flickering everywhere:
//
//   flicker: {
//     enabled: true,
//     mode: "noise",              // which field agitates the dots
//     scope: "canvas",            // one board-wide pattern, or one per cell
//     amount: 0.9,                // how far a dot may leave its base color
//     modes: {                    // settings owned by each mode, kept side by
//       noise: { ... },           // side so a composition can swap mode names
//     },                          // without losing the other tunings
//     envelope: { ... },          // composition-owned fade/ramp fractions
//   }
//
// App-wide defaults live in config/global.js; a composition overrides only the
// keys it cares about. `amount` and `envelope` stay outside `modes` because
// they describe how strongly and when a composition flickers, not how the field
// is generated.
// A mode setting may use "auto" or `calc(auto * n)` instead of a number. Today
// only `cycleSeconds` supports it: the composition's generator calculates one
// beat of its own timeline — for the circle-grid family, the seconds one scene
// state holds — and the flicker loop takes that length, so a config never
// restates a duration the composition already declares.
import {
  AUTO_DURATION,
  isAutomaticDurationSetting,
  resolveAutomaticDuration,
} from "../../core/automatic-duration.js";

export const AUTO_FLICKER_CYCLE_SECONDS = AUTO_DURATION;

export const DEFAULT_FLICKER_SETTINGS = Object.freeze({
  enabled: false,
  mode: "noise",
  scope: "canvas",
  amount: 0.55,
  // Cell scope only. Every cell reads the same local field, so without an offset
  // they all pulse in unison. Each cell's clock is pushed forward by a
  // deterministic slice of this many seconds. Zero keeps them in step.
  cellStaggerSeconds: 0.9,
});

// Where a mode's field is addressed:
//   canvas — one pattern spans the whole board, so a ripple or sweep crosses
//            cell boundaries and each cell shows only its own slice of it
//   cell   — the field restarts inside every cell, so each cell plays the whole
//            pattern at its own scale and all cells play it identically
export const FLICKER_SCOPES = Object.freeze(["canvas", "cell"]);

// Settings keys the older per-composition flicker blocks used before modes
// existed. Anything else in a legacy block was composition-owned envelope
// timing, so it migrates into `envelope`.
const LEGACY_FIELD_KEYS = Object.freeze(["enabled", "speed", "spatialScale", "amount"]);

// The pre-mode key each composition family used. Kept so an authored settings
// file — or a test fixture — written against the old shape still runs.
export const LEGACY_FLICKER_KEYS = Object.freeze([
  "candidateFlicker",
  "layerFlicker",
  "birthFlicker",
  "highDensityFlicker",
  "finalSnapshotFlicker",
  "regionFlicker",
]);

/**
 * Swap an authored `cycleSeconds: "auto"` for the composition's own beat, so a
 * mode's normalize() and its field only ever see a number.
 */
function resolveAutoCycleSeconds(authored, mode, autoCycleSeconds) {
  if (!isAutomaticDurationSetting(authored.cycleSeconds)) return authored;
  if (mode.defaults?.cycleSeconds === undefined) {
    throw new Error(
      `Flicker mode "${mode.name}" has no cycleSeconds setting, so `
      + `flicker.modes.${mode.name}.cycleSeconds cannot be `
      + `${JSON.stringify(authored.cycleSeconds)}.`,
    );
  }
  const duration = resolveAutomaticDuration(authored.cycleSeconds, {
    label: `flicker.modes.${mode.name}.cycleSeconds`,
    candidates: [{ source: "composition-beat", seconds: autoCycleSeconds }],
  });
  return { ...authored, cycleSeconds: duration.seconds };
}

function requireSettingsObject(value, label) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

/**
 * Merge authored flicker layers left to right. Scalars overwrite; `modes` and
 * `envelope` merge per key so a global default survives a partial override.
 */
export function mergeFlickerSettings(...layers) {
  const merged = { modes: {}, envelope: {} };
  for (const layer of layers) {
    const settings = requireSettingsObject(layer, "Flicker settings");
    const { modes, envelope, ...rest } = settings;
    Object.assign(merged, rest);
    for (const [name, modeSettings] of Object.entries(
      requireSettingsObject(modes, "flicker.modes"),
    )) {
      merged.modes[name] = {
        ...merged.modes[name],
        ...requireSettingsObject(modeSettings, `flicker.modes.${name}`),
      };
    }
    Object.assign(
      merged.envelope,
      requireSettingsObject(envelope, "flicker.envelope"),
    );
  }
  return merged;
}

/**
 * Read the canonical `flicker` block from generator options, migrating a legacy
 * per-composition block when one is present instead.
 */
export function flickerSettingsFromOptions(options = {}) {
  if (options.flicker !== undefined) {
    return requireSettingsObject(options.flicker, "flicker");
  }
  const legacyKey = LEGACY_FLICKER_KEYS.find(key => options[key] !== undefined);
  if (!legacyKey) return {};
  const legacy = requireSettingsObject(options[legacyKey], legacyKey);
  const envelope = {};
  for (const [key, value] of Object.entries(legacy)) {
    if (!LEGACY_FIELD_KEYS.includes(key)) envelope[key] = value;
  }
  return {
    ...(legacy.enabled === undefined ? {} : { enabled: legacy.enabled }),
    ...(legacy.amount === undefined ? {} : { amount: legacy.amount }),
    mode: "noise",
    modes: {
      noise: {
        ...(legacy.speed === undefined ? {} : { speed: legacy.speed }),
        ...(legacy.spatialScale === undefined
          ? {}
          : { spatialScale: legacy.spatialScale }),
      },
    },
    envelope,
  };
}

/**
 * Validate authored settings and normalize the active mode's own settings.
 * The result is the single object generators and strategies read.
 */
export function isResolvedFlickerSettings(value) {
  return Boolean(value) && typeof value === "object" && value.resolved === true;
}

export function resolveFlickerSettings(
  settings,
  modeRegistry,
  { autoCycleSeconds = null } = {},
) {
  if (!modeRegistry || typeof modeRegistry.get !== "function") {
    throw new TypeError("resolveFlickerSettings requires a flicker mode registry.");
  }
  // Options normalization resolves flicker once, then hands the same object to
  // the renderer; resolving an already-resolved block is a no-op.
  if (isResolvedFlickerSettings(settings)) return settings;
  const merged = mergeFlickerSettings(DEFAULT_FLICKER_SETTINGS, settings);

  if (typeof merged.enabled !== "boolean") {
    throw new TypeError("flicker.enabled must be a boolean.");
  }
  if (typeof merged.mode !== "string" || merged.mode.trim() === "") {
    throw new TypeError("flicker.mode must be a non-empty string.");
  }
  if (!FLICKER_SCOPES.includes(merged.scope)) {
    throw new RangeError(`flicker.scope must be one of ${FLICKER_SCOPES.join(", ")}.`);
  }
  if (!Number.isFinite(merged.amount)) {
    throw new TypeError("flicker.amount must be finite.");
  }
  if (merged.amount < 0 || merged.amount > 1) {
    throw new RangeError("flicker.amount must be between zero and one.");
  }
  if (!Number.isFinite(merged.cellStaggerSeconds)) {
    throw new TypeError("flicker.cellStaggerSeconds must be finite.");
  }
  if (merged.cellStaggerSeconds < 0) {
    throw new RangeError(
      "flicker.cellStaggerSeconds must be greater than or equal to zero.",
    );
  }

  const mode = modeRegistry.get(merged.mode);
  // Every registered mode is normalized, not only the active one, so a mode
  // swap at runtime cannot surface an authoring error mid-composition.
  const modes = {};
  for (const name of modeRegistry.list()) {
    const candidate = modeRegistry.get(name);
    const authored = resolveAutoCycleSeconds(
      requireSettingsObject(merged.modes[name], `flicker.modes.${name}`),
      candidate,
      autoCycleSeconds,
    );
    modes[name] = Object.freeze(
      candidate.normalize
        ? candidate.normalize(authored)
        : { ...candidate.defaults, ...authored },
    );
  }
  for (const name of Object.keys(merged.modes)) {
    if (!modeRegistry.has(name)) {
      throw new Error(modeRegistry.unknownNameMessage(name));
    }
  }

  const resolved = {
    autoCycleSeconds: Number.isFinite(autoCycleSeconds) && autoCycleSeconds > 0
      ? autoCycleSeconds
      : null,
    enabled: merged.enabled,
    mode: mode.name,
    scope: merged.scope,
    amount: merged.amount,
    cellStaggerSeconds: merged.cellStaggerSeconds,
    distribution: mode.distribution,
    modeSettings: modes[mode.name],
    modes: Object.freeze(modes),
    envelope: Object.freeze({ ...merged.envelope }),
  };
  // The marker is non-enumerable so spreading a resolved block to override one
  // value yields plain authored settings that resolve again from scratch.
  Object.defineProperty(resolved, "resolved", { value: true });
  return Object.freeze(resolved);
}
