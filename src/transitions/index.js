// The shared arrangement pool.
//
// One registry serves all three phases — `intro`, `outro`, and the
// between-state motion named `state` — because the point of the subsystem is
// that any arrangement combines with any phase (AGENTS.md §1). Modes that
// cannot express a phase are the exception, and they declare it here rather
// than being discovered at frame 4000:
//
//   {
//     name: "fade",                        // stable id used by config
//     phases: ["intro", "outro", "state"], // capability declaration
//     defaults: { ... },                   // mode-owned settings, frozen
//     create(options) -> arrangement mode,
//   }
//
// An arrangement mode:
//
//   createPlan(event) -> plan
//   presentationAt(plan, glyphId, progress)  -> { offsetX, offsetY, opacity, scale }
//   presentationsAt?(plan, glyphId, progress) -> presentation[]
//
// `presentationsAt` exists for modes that need more than one pose on screen at
// once — a crossfade draws the source and the target together. Renderers that
// can only place one glyph per id use `presentationAt`. A mode whose phase owns
// content that is in no scene at all — a ladder of cells, a string of text —
// also implements the overlay port; see `overlay.js`.
import { FactoryRegistry } from "../core/registry.js";
import { DEFAULT_FADE_SETTINGS, FadeArrangementMode } from "./fade.js";
import {
  DEFAULT_TEXT_REVEAL_SETTINGS,
  TextRevealArrangementMode,
} from "./text-reveal.js";
import { SortSelectionTransitionMode } from "../cell-transitions/sort-selection.js";

const ARRANGEMENT_PHASES = Object.freeze(["intro", "outro", "state"]);

const ARRANGEMENT_MODES = Object.freeze([
  Object.freeze({
    name: "fade",
    phases: Object.freeze(["intro", "outro", "state"]),
    defaults: DEFAULT_FADE_SETTINGS,
    create: options => new FadeArrangementMode(options),
  }),
  Object.freeze({
    name: "text",
    // A cycle boundary only. Between two scene states there is no screen to
    // hand over, and rebuilding the ladder on every state change would read as
    // a stutter rather than a reveal.
    phases: Object.freeze(["intro", "outro"]),
    defaults: DEFAULT_TEXT_REVEAL_SETTINGS,
    create: options => new TextRevealArrangementMode(options),
  }),
  Object.freeze({
    name: "sort-selection",
    // Selection-sort swaps are a reshuffle of an existing arrangement. Driven
    // from a single centered circle there is nothing to reshuffle, so every
    // target degenerates into an offscreen slide-in — the defect measured in
    // REFACTOR_PLAN.md §1.3. The mode is therefore state-only.
    phases: Object.freeze(["state"]),
    defaults: Object.freeze({
      seed: 173,
      revealFraction: 0.16,
      arcHeightInCells: 0.32,
      staggerSeconds: 0,
      timingCurve: Object.freeze([0.65, 0, 0.35, 1]),
    }),
    create: options => new SortSelectionTransitionMode(options),
  }),
]);

function requirePhase(phase) {
  if (!ARRANGEMENT_PHASES.includes(phase)) {
    throw new RangeError(
      `Arrangement phase must be one of ${ARRANGEMENT_PHASES.join(", ")}.`,
    );
  }
  return phase;
}

/** A factory registry that also knows which phases each mode supports. */
class ArrangementModeRegistry extends FactoryRegistry {
  constructor(kind) {
    super(kind);
    this.phasesByName = new Map();
  }

  register(name, factory) {
    super.register(name, factory);
    // A mode registered through the plain factory API declares nothing, so it
    // is treated as between-state only — the narrowest safe assumption.
    if (!this.phasesByName.has(name)) {
      this.phasesByName.set(name, Object.freeze(["state"]));
    }
    return this;
  }

  registerMode(descriptor) {
    if (!descriptor || typeof descriptor !== "object") {
      throw new TypeError(`An ${this.kind} must be an object descriptor.`);
    }
    if (!Array.isArray(descriptor.phases) || descriptor.phases.length === 0) {
      throw new TypeError(
        `${this.kind} "${descriptor.name}" must declare at least one phase.`,
      );
    }
    descriptor.phases.forEach(requirePhase);
    this.register(descriptor.name, descriptor.create);
    this.phasesByName.set(descriptor.name, Object.freeze([...descriptor.phases]));
    return this;
  }

  phasesFor(name) {
    return this.phasesByName.get(name) ?? [];
  }

  supports(name, phase) {
    requirePhase(phase);
    return this.has(name) && this.phasesFor(name).includes(phase);
  }

  namesForPhase(phase) {
    requirePhase(phase);
    return this.list().filter(name => this.phasesFor(name).includes(phase));
  }

  /**
   * Resolve a mode for one phase, or throw naming both sides and the valid
   * alternatives. This is the startup guard house rule 6 asks for: an
   * unsupported composition/effect pairing must fail here, not render wrong.
   */
  createForPhase(name, phase, options, label) {
    requirePhase(phase);
    if (!this.has(name)) {
      throw new Error(`${label}: ${this.unknownNameMessage(name)}`);
    }
    if (!this.supports(name, phase)) {
      const available = this.namesForPhase(phase);
      throw new Error(
        `${label}: ${this.kind} "${name}" does not support the "${phase}" phase. `
        + (available.length > 0
          ? `Modes available for "${phase}": ${available.join(", ")}.`
          : `No ${this.kind} supports "${phase}".`),
      );
    }
    return this.create(name, options);
  }
}

/** Every arrangement mode, for every phase that declares support. */
export function createArrangementModeRegistry(kind = "arrangement mode") {
  const registry = new ArrangementModeRegistry(kind);
  for (const descriptor of ARRANGEMENT_MODES) registry.registerMode(descriptor);
  return registry;
}

/**
 * Mode-owned defaults, declared once. Both settings resolvers merge this table
 * so an authored block only has to carry the values it overrides, and a mode
 * cannot end up with two competing default sets.
 */
export const ARRANGEMENT_MODE_DEFAULTS = Object.freeze(
  Object.fromEntries(ARRANGEMENT_MODES.map(mode => [mode.name, mode.defaults])),
);
