export const DEFAULT_SCENE_TRANSITION_SETTINGS = Object.freeze({
  enabled: false,
  mode: "sort-selection",
  durationSeconds: 0.7,
  fallbackToIntro: false,
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
    requireSettingsObject(group, "Scene-transition modes");
    for (const [name, settings] of Object.entries(group)) {
      modes[name] = {
        ...(modes[name] ?? {}),
        ...requireSettingsObject(settings, `Scene-transition mode "${name}"`),
      };
    }
  }
  return modes;
}

/**
 * Resolve settings for a directional scene transition. The same mode table is
 * intentionally usable by both `intro` and a future `outro`; direction belongs
 * to the controller, not to the registered mode name.
 */
export function resolveSceneTransitionSettings(base = {}, overrides = {}) {
  requireSettingsObject(base, "Base scene-transition settings");
  requireSettingsObject(overrides, "Scene-transition overrides");
  if (Object.hasOwn(base, "trigger") || Object.hasOwn(overrides, "trigger")) {
    throw new Error(
      "Scene-transition trigger was removed: intro/outro are cycle boundaries; "
      + "configure between-state motion with cellTransitions.",
    );
  }
  const resolved = {
    ...DEFAULT_SCENE_TRANSITION_SETTINGS,
    ...base,
    ...overrides,
    modes: mergeModeSettings(
      DEFAULT_SCENE_TRANSITION_SETTINGS.modes,
      base.modes,
      overrides.modes,
    ),
  };

  if (typeof resolved.enabled !== "boolean") {
    throw new TypeError("Scene-transition enabled must be true or false.");
  }
  if (typeof resolved.mode !== "string" || resolved.mode.trim() === "") {
    throw new TypeError("Scene-transition mode must be a non-empty string.");
  }
  if (!Number.isFinite(resolved.durationSeconds) || resolved.durationSeconds <= 0) {
    throw new RangeError("Scene-transition durationSeconds must be a finite positive number.");
  }
  if (typeof resolved.fallbackToIntro !== "boolean") {
    throw new TypeError("Scene-transition fallbackToIntro must be true or false.");
  }
  if (!Object.hasOwn(resolved.modes, resolved.mode)) {
    throw new Error(`Scene-transition mode "${resolved.mode}" has no settings block.`);
  }
  return resolved;
}
