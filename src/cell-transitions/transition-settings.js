export const DEFAULT_CELL_TRANSITION_SETTINGS = Object.freeze({
  enabled: false,
  mode: "sort-selection",
  durationSeconds: 0.7,
  modes: Object.freeze({
    "sort-selection": Object.freeze({
      seed: 173,
      revealFraction: 0.16,
      arcHeightInCells: 0.32,
      staggerSeconds: 0,
      timingCurve: Object.freeze([0.65, 0, 0.35, 1]),
    }),
  }),
});

function requireSettingsObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function mergeModeSettings(...groups) {
  const modes = {};
  for (const group of groups) {
    if (group === undefined) continue;
    requireSettingsObject(group, "Cell-transition modes");
    for (const [name, settings] of Object.entries(group)) {
      modes[name] = {
        ...(modes[name] ?? {}),
        ...requireSettingsObject(settings, `Cell-transition mode "${name}"`),
      };
    }
  }
  return modes;
}

/** Resolve the app-wide transition used only between discrete scene states. */
export function resolveCellTransitionSettings(base = {}, overrides = {}) {
  requireSettingsObject(base, "Base cell-transition settings");
  requireSettingsObject(overrides, "Cell-transition overrides");
  const resolved = {
    ...DEFAULT_CELL_TRANSITION_SETTINGS,
    ...base,
    ...overrides,
    modes: mergeModeSettings(
      DEFAULT_CELL_TRANSITION_SETTINGS.modes,
      base.modes,
      overrides.modes,
    ),
  };

  if (typeof resolved.enabled !== "boolean") {
    throw new TypeError("Cell-transition enabled must be true or false.");
  }
  if (typeof resolved.mode !== "string" || resolved.mode.trim() === "") {
    throw new TypeError("Cell-transition mode must be a non-empty string.");
  }
  if (!Number.isFinite(resolved.durationSeconds) || resolved.durationSeconds <= 0) {
    throw new RangeError("Cell-transition durationSeconds must be a finite positive number.");
  }
  if (!Object.hasOwn(resolved.modes, resolved.mode)) {
    throw new Error(`Cell-transition mode "${resolved.mode}" has no settings block.`);
  }
  return resolved;
}
