import { resolveCellTransitionSettings } from "./transition-settings.js";

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

/** Runs an arrangement plan between two scene states without owning the cycle clock. */
export class CellStateTransition {
  constructor({ settings, modeRegistry }) {
    this.settings = resolveCellTransitionSettings({}, settings ?? {});
    this.mode = null;
    if (this.settings.enabled) {
      if (
        !modeRegistry
        || typeof modeRegistry.has !== "function"
        || typeof modeRegistry.create !== "function"
      ) throw new TypeError("An enabled cell transition requires a mode registry.");
      if (!modeRegistry.has(this.settings.mode)) {
        throw new Error(`Unknown cell-transition mode "${this.settings.mode}".`);
      }
      this.mode = modeRegistry.create(
        this.settings.mode,
        this.settings.modes[this.settings.mode],
      );
      if (
        !this.mode
        || typeof this.mode.createPlan !== "function"
        || typeof this.mode.presentationAt !== "function"
      ) {
        throw new TypeError(
          `Cell-transition mode "${this.settings.mode}" must provide `
          + "createPlan() and presentationAt().",
        );
      }
    }
    this.reset();
  }

  reset() {
    this.elapsed = 0;
    this.plan = null;
    this.key = null;
    this.active = false;
    this.begun = false;
  }

  begin(event) {
    if (!this.settings.enabled) return false;
    this.plan = this.mode.createPlan({
      ...event,
      durationSeconds: this.settings.durationSeconds,
    });
    this.elapsed = 0;
    this.key = event.key ?? null;
    this.active = true;
    this.begun = true;
    return true;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) {
      throw new RangeError("Cell-transition dt must be finite and non-negative.");
    }
    if (!this.active) return dt;
    const remainingDuration = this.settings.durationSeconds - this.elapsed;
    const consumed = Math.min(remainingDuration, dt);
    this.elapsed += consumed;
    if (this.elapsed >= this.settings.durationSeconds) this.active = false;
    return dt - consumed;
  }

  presentationFor(index) {
    if (!this.begun || !this.plan) return IDENTITY_PRESENTATION;
    return this.mode.presentationAt(
      this.plan,
      index,
      this.elapsed / this.settings.durationSeconds,
    );
  }

  inspect() {
    return {
      enabled: this.settings.enabled,
      mode: this.settings.mode,
      durationSeconds: this.settings.durationSeconds,
      active: this.active,
      progress: this.begun
        ? Math.min(1, this.elapsed / this.settings.durationSeconds)
        : 0,
      key: this.key,
      itemCount: this.plan?.targets?.length ?? 0,
      sourceItemCount: this.plan?.sourceItemCount ?? 0,
      startsOffscreen: this.plan?.fadeIn ?? false,
      staggerSeconds: this.plan?.staggerSeconds ?? 0,
    };
  }
}

export default CellStateTransition;
