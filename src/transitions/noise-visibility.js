export const DEFAULT_NOISE_VISIBILITY_TRANSITION_SETTINGS = Object.freeze({
  enabled: false,
  threshold: 1,
  contrast: 0.01,
  softness: 0,
});

function requireFiniteRange(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `noiseVisibilityTransition.${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function requireSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("noiseVisibilityTransition must be an object.");
  }
  const defaults = DEFAULT_NOISE_VISIBILITY_TRANSITION_SETTINGS;
  const enabled = value.enabled ?? defaults.enabled;
  if (typeof enabled !== "boolean") {
    throw new TypeError("noiseVisibilityTransition.enabled must be a boolean.");
  }
  const contrast = value.contrast ?? defaults.contrast;
  if (!Number.isFinite(contrast) || contrast <= 0) {
    throw new RangeError(
      "noiseVisibilityTransition.contrast must be a finite positive number.",
    );
  }
  return Object.freeze({
    enabled,
    threshold: requireFiniteRange(
      value.threshold ?? defaults.threshold,
      0,
      1,
      "threshold",
    ),
    contrast,
    softness: requireFiniteRange(
      value.softness ?? defaults.softness,
      0,
      0.5,
      "softness",
    ),
  });
}

/**
 * A noise-grid-only phase transition. Start reveals the composition-authored
 * field from a clear board; end clears it again. The core remains untouched.
 */
export class NoiseVisibilityTransition {
  constructor(options = {}) {
    this.settings = requireSettings(options);
    this.lastPhase = null;
  }

  amountAt(phase, progress) {
    const amount = Math.max(0, Math.min(1, Number(progress) || 0));
    if (phase === "intro") return 1 - amount;
    if (phase === "outro") return amount;
    return 0;
  }

  effects(endpoint) {
    const phase = endpoint?.phase === "start"
      ? "intro"
      : (endpoint?.phase === "end" ? "outro" : null);
    this.lastPhase = phase;
    if (phase === null) return null;
    return {
      noiseVisibility: {
        amount: this.amountAt(phase, endpoint.progress),
        threshold: this.settings.threshold,
        contrast: this.settings.contrast,
        softness: this.settings.softness,
      },
    };
  }

  inspect() {
    return {
      name: "noise-visibility",
      phase: this.lastPhase,
      order: ["intro", "hold", "outro"],
    };
  }
}

export function createNoiseVisibilityTransition({ compositionId, settings }) {
  if (settings === undefined) return null;
  const resolved = requireSettings(settings);
  if (!resolved.enabled) return null;
  if (compositionId !== "noise-grid") {
    throw new Error(
      `Composition "${compositionId}" cannot enable noiseVisibilityTransition. `
      + "Supported compositions: noise-grid.",
    );
  }
  return new NoiseVisibilityTransition(resolved);
}
