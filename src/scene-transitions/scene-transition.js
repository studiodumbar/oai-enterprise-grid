import { resolveSceneTransitionSettings } from "./transition-settings.js";
import { presentationsFrom } from "../transitions/presentations.js";
import { debug } from "../debug/index.js";

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
    if (!Number.isFinite(this.settings.durationSeconds)) {
      throw new RangeError(
        "Scene-transition durationSeconds must resolve to a number before construction.",
      );
    }
    this.mode = null;
    if (this.settings.enabled) {
      if (
        !modeRegistry
        || typeof modeRegistry.createForPhase !== "function"
      ) throw new TypeError("An enabled scene transition requires a mode registry.");
      // Resolving through the phase gate is what makes an unsupported
      // mode/phase pairing a startup error instead of a broken frame.
      this.mode = modeRegistry.createForPhase(
        this.settings.mode,
        this.direction,
        this.settings.modes[this.settings.mode],
        `Scene transition (${this.direction})`,
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
    debug.transition(
      "scene=%s mode=%s targets=%d sources=%d duration=%.3f key=%s",
      this.direction,
      this.settings.mode,
      event?.items?.length ?? 0,
      event?.fromItems?.length ?? 0,
      this.settings.durationSeconds,
      event?.key ?? "-",
    );
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

  progressFor() {
    const clockProgress = this.elapsed / this.settings.durationSeconds;
    return this.direction === "intro" ? clockProgress : 1 - clockProgress;
  }

  presentationFor(index) {
    if (!this.begun || !this.plan) return IDENTITY_PRESENTATION;
    return this.mode.presentationAt(this.plan, index, this.progressFor());
  }

  /** Some modes place more than one pose per glyph; a crossfade needs two. */
  presentationsFor(index) {
    if (!this.begun || !this.plan) return [IDENTITY_PRESENTATION];
    return presentationsFrom(this.mode, this.plan, index, this.progressFor());
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
