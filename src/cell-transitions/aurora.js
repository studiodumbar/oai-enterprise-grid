import {
  DEFAULT_SORT_SELECTION_SETTINGS,
  SortSelectionTransitionMode,
} from "./sort-selection.js";

const TAU = Math.PI * 2;
// A small ordered-dither threshold map turns a continuous decay into a stable
// dot-grid gradient. It repeats as visible structure instead of per-glyph noise.
const BEAM_DECAY_ORDER = Object.freeze([
  Object.freeze([0, 8, 2, 10]),
  Object.freeze([12, 4, 14, 6]),
  Object.freeze([3, 11, 1, 9]),
  Object.freeze([15, 7, 13, 5]),
]);

export const DEFAULT_AURORA_SETTINGS = Object.freeze({
  ...DEFAULT_SORT_SELECTION_SETTINGS,
  directions: Object.freeze(["top-down", "bottom-up"]),
  waveAmplitudeInCells: 1.15,
  waveCycles: 1.5,
  beamLengthInCells: 2.5,
});

function requireFiniteRange(value, minimum, maximum, label) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `aurora ${label} must be finite and between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function maximumTargetSize(targets) {
  let maximum = 1;
  for (const target of targets) maximum = Math.max(maximum, target.size);
  return maximum;
}

function minimumTargetSize(targets) {
  let minimum = Infinity;
  for (const target of targets) minimum = Math.min(minimum, target.size);
  return Number.isFinite(minimum) ? Math.max(1, minimum) : 1;
}

/**
 * Selection sort with a wavy settlement frontier. The glyph presentations are
 * inherited unchanged: only the order in which exact grid destinations settle
 * differs from sort-selection.
 *
 * Each target receives a deterministic lag between zero and
 * `beamLengthInCells`. Because lag is only added to its frontier depth, the
 * resulting density gradient can trail the edge but can never leak ahead of
 * it. Reversing the sweep reverses which world-space side counts as behind.
 */
export class AuroraTransitionMode extends SortSelectionTransitionMode {
  constructor(options = {}) {
    const resolved = { ...DEFAULT_AURORA_SETTINGS, ...options };
    super(resolved);
    this.waveAmplitudeInCells = requireFiniteRange(
      resolved.waveAmplitudeInCells,
      0,
      8,
      "waveAmplitudeInCells",
    );
    this.waveCycles = requireFiniteRange(resolved.waveCycles, 0.05, 12, "waveCycles");
    this.beamLengthInCells = requireFiniteRange(
      resolved.beamLengthInCells,
      0,
      16,
      "beamLengthInCells",
    );
  }

  frontierEntriesFor({ targets, sweep, layout, passIndex }) {
    const cellSize = Number.isFinite(layout?.cellSize) && layout.cellSize > 0
      ? layout.cellSize
      : maximumTargetSize(targets);
    let left = 0;
    let top = 0;
    let right = cellSize;
    if (targets.length > 0) {
      left = Math.min(...targets.map(target => target.x));
      top = Math.min(...targets.map(target => target.y));
      right = Math.max(...targets.map(target => target.x));
    }
    const horizontalSpan = Math.max(cellSize, right - left);
    const gridUnit = minimumTargetSize(targets);
    const direction = sweep === "bottom-up" ? -1 : 1;
    const seedPhase = this.seed >>> 0;
    // A half-turn per pass keeps repeated sweeps from tracing the same ridge.
    const passPhase = passIndex * Math.PI;

    return targets.map((target, order) => {
      const wavePhase = (target.x - left) / horizontalSpan
        * this.waveCycles * TAU
        + passPhase;
      const waveOffset = Math.sin(wavePhase) * this.waveAmplitudeInCells;
      const row = (target.y - top) / cellSize;
      const frontierDepth = direction * (row - waveOffset);
      const gridColumn = Math.floor((target.x - left) / gridUnit);
      const gridRow = Math.floor((target.y - top) / gridUnit);
      const decayColumn = (
        gridColumn + seedPhase + passIndex
      ) % BEAM_DECAY_ORDER.length;
      const decayRow = (
        gridRow + Math.floor(seedPhase / BEAM_DECAY_ORDER.length) + passIndex
      ) % BEAM_DECAY_ORDER.length;
      const decay = (BEAM_DECAY_ORDER[decayRow][decayColumn] + 0.5) / 16;
      const beamLag = decay * this.beamLengthInCells;
      return {
        order,
        frontierDepth,
        beamLag,
        priority: frontierDepth + beamLag,
      };
    });
  }

  fillOrderFor(event) {
    return this.frontierEntriesFor(event)
      .sort((first, second) => (
        first.priority - second.priority
        || first.frontierDepth - second.frontierDepth
        || first.order - second.order
      ))
      .map(entry => entry.order);
  }

  createPlan(event) {
    const plan = super.createPlan(event);
    const frontier = this.frontierEntriesFor({
      ...event,
      targets: plan.targets,
      sweep: plan.sweep,
      passIndex: plan.passIndex,
    });
    return {
      ...plan,
      frontierDepthByOrder: frontier.map(entry => entry.frontierDepth),
      beamLagByOrder: frontier.map(entry => entry.beamLag),
      waveAmplitudeInCells: this.waveAmplitudeInCells,
      beamLengthInCells: this.beamLengthInCells,
    };
  }
}
