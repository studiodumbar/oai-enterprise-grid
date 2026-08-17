import { resolveSceneTransitionSettings } from "./transition-settings.js";

export const SCENE_TRANSITION_DIRECTIONS = Object.freeze(["intro", "outro"]);

const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

/** Runs any registered arrangement mode in either the intro or outro direction. */
export class SceneTransition {
  constructor({ direction, settings, modeRegistry }) {
    if (!SCENE_TRANSITION_DIRECTIONS.includes(direction)) {
      throw new RangeError(
        `Scene-transition direction must be one of ${SCENE_TRANSITION_DIRECTIONS.join(", ")}.`,
      );
    }
    this.direction = direction;
    this.settings = resolveSceneTransitionSettings({}, settings ?? {});
    this.mode = null;
    if (this.settings.enabled) {
      if (
        !modeRegistry
        || typeof modeRegistry.has !== "function"
        || typeof modeRegistry.create !== "function"
      ) throw new TypeError("An enabled scene transition requires a mode registry.");
      if (!modeRegistry.has(this.settings.mode)) {
        throw new Error(`Unknown scene-transition mode "${this.settings.mode}".`);
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
          `Scene-transition mode "${this.settings.mode}" must provide createPlan() and presentationAt().`,
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
      throw new RangeError("Scene-transition dt must be finite and non-negative.");
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
    const clockProgress = this.elapsed / this.settings.durationSeconds;
    const progress = this.direction === "intro"
      ? clockProgress
      : 1 - clockProgress;
    return this.mode.presentationAt(this.plan, index, progress);
  }

  inspect() {
    return {
      direction: this.direction,
      enabled: this.settings.enabled,
      mode: this.settings.mode,
      durationSeconds: this.settings.durationSeconds,
      fallbackToIntro: this.settings.fallbackToIntro,
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
