export const DEFAULT_NOISE_VISIBILITY_TRANSITION_SETTINGS = Object.freeze({
  enabled: false,
  holdSeconds: 1,
  maximumHoldShare: 0.6,
  edgeWeights: Object.freeze({
    idleBefore: 1,
    rampOut: 1,
    rampBack: 1,
    idleAfter: 1,
  }),
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
  const holdSeconds = value.holdSeconds ?? defaults.holdSeconds;
  if (!Number.isFinite(holdSeconds) || holdSeconds < 0) {
    throw new RangeError(
      "noiseVisibilityTransition.holdSeconds must be finite and non-negative.",
    );
  }
  const contrast = value.contrast ?? defaults.contrast;
  if (!Number.isFinite(contrast) || contrast <= 0) {
    throw new RangeError(
      "noiseVisibilityTransition.contrast must be a finite positive number.",
    );
  }
  const maximumHoldShare = value.maximumHoldShare ?? defaults.maximumHoldShare;
  if (!Number.isFinite(maximumHoldShare) || maximumHoldShare < 0 || maximumHoldShare >= 1) {
    throw new RangeError(
      "noiseVisibilityTransition.maximumHoldShare must be between 0 inclusive and 1 exclusive.",
    );
  }
  const authoredEdgeWeights = value.edgeWeights ?? {};
  if (
    !authoredEdgeWeights
    || typeof authoredEdgeWeights !== "object"
    || Array.isArray(authoredEdgeWeights)
  ) {
    throw new TypeError("noiseVisibilityTransition.edgeWeights must be an object.");
  }
  const edgeWeights = {
    ...defaults.edgeWeights,
    ...authoredEdgeWeights,
  };
  for (const name of ["idleBefore", "rampOut", "rampBack", "idleAfter"]) {
    if (!Number.isFinite(edgeWeights[name]) || edgeWeights[name] < 0) {
      throw new RangeError(
        `noiseVisibilityTransition.edgeWeights.${name} must be finite and non-negative.`,
      );
    }
  }
  if (edgeWeights.rampOut === 0 || edgeWeights.rampBack === 0) {
    throw new RangeError(
      "noiseVisibilityTransition rampOut and rampBack edge weights must be positive.",
    );
  }
  return Object.freeze({
    enabled,
    holdSeconds,
    maximumHoldShare,
    edgeWeights: Object.freeze(edgeWeights),
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
 * A noise-grid-only phase transition that clears the visibility field, holds
 * it clear, then restores the composition-authored field settings.
 *
 * The unused phase time is split across four configurable weights: idle, ramp
 * out, ramp back, idle. This preserves the previous text-reveal envelope
 * without making visibility depend on text geometry or overlay drawing.
 */
export class NoiseVisibilityTransition {
  constructor(options = {}) {
    this.settings = requireSettings(options);
    this.lastPhase = null;
  }

  windowsFor(durationSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new RangeError(
        "noiseVisibilityTransition requires a finite positive phase duration.",
      );
    }
    const holdSeconds = Math.min(
      this.settings.holdSeconds,
      durationSeconds * this.settings.maximumHoldShare,
    );
    const holdShare = holdSeconds / durationSeconds;
    const weights = this.settings.edgeWeights;
    const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
    const sharePerWeight = (1 - holdShare) / totalWeight;
    const idleBeforeShare = weights.idleBefore * sharePerWeight;
    const rampOutShare = weights.rampOut * sharePerWeight;
    const rampBackShare = weights.rampBack * sharePerWeight;
    return {
      rampOutStart: idleBeforeShare,
      holdStart: idleBeforeShare + rampOutShare,
      holdEnd: idleBeforeShare + rampOutShare + holdShare,
      rampBackEnd: idleBeforeShare + rampOutShare + holdShare + rampBackShare,
    };
  }

  amountAt(progress, durationSeconds) {
    const amount = Math.max(0, Math.min(1, Number(progress) || 0));
    const windows = this.windowsFor(durationSeconds);
    if (amount <= windows.rampOutStart) return 0;
    if (amount < windows.holdStart) {
      const ramp = (amount - windows.rampOutStart)
        / (windows.holdStart - windows.rampOutStart);
      return ramp >= 1 - 1e-12 ? 1 : ramp;
    }
    if (amount <= windows.holdEnd) return 1;
    if (amount < windows.rampBackEnd) {
      const ramp = 1 - (amount - windows.holdEnd)
        / (windows.rampBackEnd - windows.holdEnd);
      return ramp <= 1e-12 ? 0 : ramp;
    }
    return 0;
  }

  effects(endpoint) {
    const phase = endpoint?.phase === "start"
      ? "intro"
      : (endpoint?.phase === "end" ? "outro" : null);
    this.lastPhase = phase;
    if (phase === null) return null;
    const progress = phase === "intro"
      ? endpoint.progress
      : 1 - endpoint.progress;
    return {
      noiseVisibility: {
        amount: this.amountAt(progress, endpoint.durationSeconds),
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
      holdSeconds: this.settings.holdSeconds,
      maximumHoldShare: this.settings.maximumHoldShare,
      edgeWeights: { ...this.settings.edgeWeights },
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
