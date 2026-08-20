function requireDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
    throw new TypeError("Sequence definition must be an object.");
  }
  if (!Array.isArray(definition.steps) || definition.steps.length === 0) {
    throw new TypeError("Sequence definition must contain at least one step.");
  }
  if (definition.loop !== undefined && typeof definition.loop !== "boolean") {
    throw new TypeError("Sequence definition \"loop\" must be a boolean.");
  }
  return definition;
}

function normalizeStep(step, index) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new TypeError(`Sequence step ${index} must be an object.`);
  }
  if (typeof step.use !== "string" || step.use.trim() === "") {
    throw new TypeError(`Sequence step ${index} must have a non-empty \"use\" id.`);
  }

  const hasDuration = step.durationSeconds !== undefined;
  if (hasDuration && (!Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0)) {
    throw new RangeError(
      `Sequence step ${index} durationSeconds must be a finite number greater than zero.`,
    );
  }

  const { durationSeconds, ...planEntry } = step;
  return Object.freeze({
    durationSeconds: hasDuration ? durationSeconds : null,
    planEntry: Object.freeze({ ...planEntry }),
  });
}

/**
 * Selects one render-plan entry at a time from a deterministic timed sequence.
 * A step without `durationSeconds` is an intentional hold and never advances.
 */
export class SequenceRule {
  constructor(definition) {
    const checked = requireDefinition(definition);
    this.steps = Object.freeze(checked.steps.map(normalizeStep));
    this.loop = checked.loop === true;
    this.index = 0;
    this.elapsedSeconds = 0;

    this.allStepsAreFinite = this.steps.every(step => step.durationSeconds !== null);
    this.cycleSeconds = this.allStepsAreFinite
      ? this.steps.reduce((total, step) => total + step.durationSeconds, 0)
      : Infinity;
  }

  update(frame = {}) {
    const dt = frame.compositionDt ?? frame.dt ?? 0;
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError("Sequence frame dt must be a finite, non-negative number.");
    }

    this.advance(dt);
    return [this.steps[this.index].planEntry];
  }

  inspect() {
    const step = this.steps[this.index];
    return {
      stepIndex: this.index,
      stepCount: this.steps.length,
      use: step.planEntry.use,
      elapsedSeconds: this.elapsedSeconds,
      stepDurationSeconds: step.durationSeconds,
      cycleSeconds: Number.isFinite(this.cycleSeconds) ? this.cycleSeconds : null,
      loop: this.loop,
      holding: step.durationSeconds === null,
    };
  }

  advance(dt) {
    const current = this.steps[this.index];
    if (dt === 0 || current.durationSeconds === null) return;

    let remaining = dt;
    if (this.loop && this.allStepsAreFinite && remaining >= this.cycleSeconds) {
      remaining %= this.cycleSeconds;
    }

    while (remaining > 0) {
      const step = this.steps[this.index];
      if (step.durationSeconds === null) return;

      // A non-looping sequence holds on its last step after that step expires.
      if (
        !this.loop
        && this.index === this.steps.length - 1
        && this.elapsedSeconds >= step.durationSeconds
      ) {
        return;
      }

      const timeLeft = step.durationSeconds - this.elapsedSeconds;
      if (remaining < timeLeft) {
        this.elapsedSeconds += remaining;
        return;
      }

      remaining -= timeLeft;
      this.elapsedSeconds = 0;

      if (this.index < this.steps.length - 1) {
        this.index += 1;
      } else if (this.loop) {
        this.index = 0;
      } else {
        this.elapsedSeconds = step.durationSeconds;
        return;
      }
    }
  }
}

export default SequenceRule;
