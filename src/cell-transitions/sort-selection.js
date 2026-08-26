import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { normalizeArrangementItems } from "../transitions/arrangement-items.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
}

const COLLISION_GAP = 1e-7;

// Selection sort finalizes exactly one slot per step, so the order in which
// slots are finalized is what reads on screen as a sweep direction. Every
// direction is therefore a permutation of the row-major target order: entry
// `step` names the target order that settles at that step. Adding a direction —
// a column-major sweep, a spiral — means adding one permutation here; nothing
// else in the mode changes.
const FILL_DIRECTIONS = Object.freeze({
  "top-down": count => Array.from({ length: count }, (_, step) => step),
  "bottom-up": count => Array.from({ length: count }, (_, step) => count - 1 - step),
});

export const SORT_SELECTION_DIRECTIONS = Object.freeze(Object.keys(FILL_DIRECTIONS));

export const DEFAULT_SORT_SELECTION_SETTINGS = Object.freeze({
  seed: 173,
  revealFraction: 0.16,
  arcHeightInCells: 0.32,
  overlapDots: false,
  directions: Object.freeze(["top-down"]),
  staggerSeconds: 0,
  timingCurve: Object.freeze([0.65, 0, 0.35, 1]),
});

/**
 * Normalize the `directions` option into a non-empty frozen list of known
 * direction names. One name is a constant direction; several alternate, one per
 * pass, in the order given.
 */
function normalizeDirections(value, label) {
  const names = typeof value === "string" ? [value] : value;
  if (!Array.isArray(names) || names.length === 0) {
    throw new TypeError(
      `${label} must be a direction name or a non-empty array of them.`,
    );
  }
  for (const name of names) {
    if (typeof name !== "string" || !Object.hasOwn(FILL_DIRECTIONS, name)) {
      throw new RangeError(
        `${label} "${name}" is unknown. `
        + `Directions: ${SORT_SELECTION_DIRECTIONS.join(", ")}.`,
      );
    }
  }
  return Object.freeze([...names]);
}

function circleBucketKeys(x, y, radius, cellSize) {
  const keys = [];
  const left = Math.floor((x - radius) / cellSize);
  const right = Math.floor((x + radius) / cellSize);
  const top = Math.floor((y - radius) / cellSize);
  const bottom = Math.floor((y + radius) / cellSize);
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      keys.push(`${column}:${row}`);
    }
  }
  return keys;
}

function hashString(value, seed) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function shuffled(values, key, seed) {
  const result = [...values];
  let state = hashString(key, seed) || 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function transitionBounds(layout, targets) {
  if (
    Number.isFinite(layout?.width)
    && Number.isFinite(layout?.height)
    && layout.width > 0
    && layout.height > 0
  ) {
    return { left: 0, top: 0, right: layout.width, bottom: layout.height };
  }
  if (
    Number.isFinite(layout?.offsetX)
    && Number.isFinite(layout?.offsetY)
    && Number.isFinite(layout?.columns)
    && Number.isFinite(layout?.rows)
    && Number.isFinite(layout?.cellSize)
  ) {
    return {
      left: layout.offsetX,
      top: layout.offsetY,
      right: layout.offsetX + layout.columns * layout.cellSize,
      bottom: layout.offsetY + layout.rows * layout.cellSize,
    };
  }
  return {
    left: Math.min(...targets.map(item => item.x - item.size * 0.5)),
    top: Math.min(...targets.map(item => item.y - item.size * 0.5)),
    right: Math.max(...targets.map(item => item.x + item.size * 0.5)),
    bottom: Math.max(...targets.map(item => item.y + item.size * 0.5)),
  };
}

function offscreenSlots(targets, layout, key, seed) {
  if (targets.length === 0) return [];
  const bounds = transitionBounds(layout, targets);
  const targetLeft = Math.min(...targets.map(item => item.x - item.size * 0.5));
  const targetTop = Math.min(...targets.map(item => item.y - item.size * 0.5));
  const targetRight = Math.max(...targets.map(item => item.x + item.size * 0.5));
  const targetBottom = Math.max(...targets.map(item => item.y + item.size * 0.5));
  const clearance = Math.max(...targets.map(item => item.size));
  const direction = hashString(`${key}:entrance-edge`, seed) % 4;
  const translations = [
    { x: bounds.left - targetRight - clearance, y: 0 },
    { x: bounds.right - targetLeft + clearance, y: 0 },
    { x: 0, y: bounds.top - targetBottom - clearance },
    { x: 0, y: bounds.bottom - targetTop + clearance },
  ];
  const translation = translations[direction];
  return targets.map(item => ({
    x: item.x + translation.x,
    y: item.y + translation.y,
    size: item.size,
  }));
}

/**
 * A direction-neutral arrangement mode. Its zero pose is either the previous
 * scene or a translated copy of the target that is wholly outside the viewport.
 * Selection-sort swaps place each cell into its target. Intro plays zero-to-one,
 * while outro plays the same plan backward.
 *
 * `directions` names the sweep order in which slots are finalized: one name
 * holds that direction for every pass, several alternate one per pass, cycling
 * in the order given. The pass counter arrives with the event (`passIndex`) —
 * the mode holds no cross-plan state, so an export replaying the same frames
 * produces the same sweeps.
 */
export class SortSelectionTransitionMode {
  constructor(options = {}) {
    const seed = options.seed ?? DEFAULT_SORT_SELECTION_SETTINGS.seed;
    const revealFraction = options.revealFraction
      ?? DEFAULT_SORT_SELECTION_SETTINGS.revealFraction;
    const arcHeightInCells = options.arcHeightInCells
      ?? DEFAULT_SORT_SELECTION_SETTINGS.arcHeightInCells;
    const staggerSeconds = options.staggerSeconds
      ?? DEFAULT_SORT_SELECTION_SETTINGS.staggerSeconds;
    const overlapDots = options.overlapDots
      ?? DEFAULT_SORT_SELECTION_SETTINGS.overlapDots;
    const directions = normalizeDirections(
      options.directions ?? DEFAULT_SORT_SELECTION_SETTINGS.directions,
      "sort-selection direction",
    );
    const timingCurve = normalizeBezierCurve(
      options.timingCurve ?? DEFAULT_SORT_SELECTION_SETTINGS.timingCurve,
      "sort-selection timingCurve",
    );
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("sort-selection seed must be a safe integer.");
    }
    if (
      !Number.isFinite(revealFraction)
      || revealFraction <= 0
      || revealFraction > 1
    ) {
      throw new RangeError("sort-selection revealFraction must be between zero and one.");
    }
    if (!Number.isFinite(arcHeightInCells) || arcHeightInCells < 0) {
      throw new RangeError("sort-selection arcHeightInCells must be finite and non-negative.");
    }
    if (!Number.isFinite(staggerSeconds) || staggerSeconds < 0) {
      throw new RangeError("sort-selection staggerSeconds must be finite and non-negative.");
    }
    if (typeof overlapDots !== "boolean") {
      throw new TypeError("sort-selection overlapDots must be true or false.");
    }
    this.seed = seed;
    this.revealFraction = revealFraction;
    this.arcHeightInCells = arcHeightInCells;
    this.staggerSeconds = staggerSeconds;
    this.overlapDots = overlapDots;
    this.directions = directions;
    this.timingCurve = Object.freeze(timingCurve);
  }

  fillOrderFor({ targets, sweep }) {
    return FILL_DIRECTIONS[sweep](targets.length);
  }

  createPlan({
    items,
    indices,
    fromItems,
    layout,
    key = "scene",
    durationSeconds = 1,
    passIndex = 0,
  }) {
    if (!Number.isInteger(passIndex) || passIndex < 0) {
      throw new RangeError("sort-selection passIndex must be a non-negative integer.");
    }
    const targets = normalizeArrangementItems(
      { items, indices, layout },
      "sort-selection",
    );
    // A `direction` names one sweep order; `sweep` is the one this pass takes.
    // Plain "direction" stays reserved for the intro/outro sense of the word.
    const sweep = this.directions[passIndex % this.directions.length];
    // `fillOrder[step]` is the target order that settles at that step;
    // `stepByOrder[order]` is its inverse. The sort minimizes the step, so the
    // sweep is expressed entirely by this permutation.
    const fillOrder = this.fillOrderFor({
      targets,
      sweep,
      layout,
      key,
      passIndex,
    });
    if (
      !Array.isArray(fillOrder)
      || fillOrder.length !== targets.length
      || new Set(fillOrder).size !== targets.length
      || fillOrder.some(order => (
        !Number.isInteger(order) || order < 0 || order >= targets.length
      ))
    ) {
      throw new Error(
        `sort-selection ${sweep} fill order must contain every target exactly once.`,
      );
    }
    const stepByOrder = new Array(targets.length);
    fillOrder.forEach((order, step) => { stepByOrder[order] = step; });
    const slots = targets.map(item => ({ x: item.x, y: item.y, size: item.size }));
    const authoredSources = fromItems === undefined
      ? null
      : normalizeArrangementItems(
        { items: fromItems, layout },
        "sort-selection source",
      );
    const offscreen = authoredSources?.length > 0
      ? []
      : offscreenSlots(targets, layout, key, this.seed);
    const sourceSlots = targets.map((target, slot) => {
      // Expand a smaller real source set across the normalized target order.
      // Every repeated source remains on the authored grid; an offscreen slot
      // is reserved for a transition that truly has no previous scene.
      const sourceIndex = authoredSources?.length > 0
        ? Math.min(
          authoredSources.length - 1,
          Math.floor(slot * authoredSources.length / targets.length),
        )
        : -1;
      const source = authoredSources?.[sourceIndex] ?? offscreen[slot] ?? target;
      return { x: source.x, y: source.y, size: source.size };
    });
    const targetOrderById = new Map(
      targets.map((target, order) => [target.id, order]),
    );
    const values = shuffled(
      targets.map((_, order) => order),
      key,
      this.seed,
    );
    // A shuffle that already matches the fill order sorts in zero swaps, so the
    // pass would render as a hold. Rotate it by one to guarantee movement.
    if (
      values.length > 1
      && values.every((order, position) => stepByOrder[order] === position)
    ) values.push(values.shift());
    const initialSlotByOrder = new Map(
      values.map((targetOrder, slot) => [targetOrder, slot]),
    );
    const working = [...values];
    const positionsByOrder = new Map(
      values.map((targetOrder, slot) => [targetOrder, sourceSlots[slot]]),
    );
    const initialPointByOrder = new Map(positionsByOrder);
    const segmentsByOrder = targets.map(() => []);
    const steps = [];
    for (let slot = 0; slot < working.length; slot += 1) {
      let selected = slot;
      for (let candidate = slot + 1; candidate < working.length; candidate += 1) {
        if (stepByOrder[working[candidate]] < stepByOrder[working[selected]]) {
          selected = candidate;
        }
      }
      const firstTarget = working[slot];
      const secondTarget = working[selected];
      const firstStart = positionsByOrder.get(firstTarget);
      const secondStart = positionsByOrder.get(secondTarget);
      const secondEnd = slots[fillOrder[slot]];
      if (selected === slot) {
        segmentsByOrder[secondTarget].push({
          step: slot,
          start: secondStart,
          end: secondEnd,
          side: secondTarget % 2 === 0 ? 1 : -1,
        });
        positionsByOrder.set(secondTarget, secondEnd);
      } else {
        const firstEnd = secondStart;
        // Reversing the travel vector already reverses its normal. Equal side
        // signs therefore put a swap pair on opposite world-space arcs.
        const firstSide = -1;
        const secondSide = this.overlapDots ? 1 : firstSide;
        segmentsByOrder[firstTarget].push({
          step: slot,
          start: firstStart,
          end: firstEnd,
          side: firstSide,
        });
        segmentsByOrder[secondTarget].push({
          step: slot,
          start: secondStart,
          end: secondEnd,
          side: secondSide,
        });
        positionsByOrder.set(firstTarget, firstEnd);
        positionsByOrder.set(secondTarget, secondEnd);
      }
      steps.push({
        firstSlot: slot,
        secondSlot: selected,
        firstTarget,
        secondTarget,
      });
      [working[slot], working[selected]] = [working[selected], working[slot]];
    }
    const totalDurationSeconds = Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 1;
    const movementCount = Math.max(1, steps.length);
    const requestedStaggerSpan = this.staggerSeconds
      * Math.max(0, movementCount - 1);
    // Keep the configured duration authoritative without flattening every
    // dense-scene value onto one hard ceiling. Movement and requested delays
    // are compressed proportionally, so every larger stagger remains visible.
    const staggerSpan = requestedStaggerSpan <= 0
      ? 0
      : totalDurationSeconds * requestedStaggerSpan
        / (totalDurationSeconds + requestedStaggerSpan);
    const effectiveStaggerSeconds = movementCount <= 1
      ? 0
      : staggerSpan / (movementCount - 1);
    const movementDurationSeconds = (
      totalDurationSeconds - effectiveStaggerSeconds * (movementCount - 1)
    ) / movementCount;
    return {
      slots,
      sourceSlots,
      targets,
      sweep,
      passIndex,
      fillOrder,
      targetOrderById,
      initialSlotByOrder,
      initialPointByOrder,
      segmentsByOrder,
      steps,
      totalDurationSeconds,
      movementDurationSeconds,
      staggerSeconds: effectiveStaggerSeconds,
      requestedStaggerSeconds: this.staggerSeconds,
      staggerSpanSeconds: staggerSpan,
      fadeIn: authoredSources === null || authoredSources.length === 0,
      sourceItemCount: authoredSources?.length ?? 0,
      expandedSourceCount: authoredSources?.length > 0
        ? Math.max(0, targets.length - authoredSources.length)
        : 0,
      collisionCache: null,
    };
  }

  rawStateAt(plan, targetOrder, progress) {
    const amount = clamp01(progress);
    const target = plan.targets[targetOrder];
    if (amount >= 1) {
      return {
        x: target.x,
        y: target.y,
        size: target.size,
        opacity: 1,
        moving: false,
        settled: true,
      };
    }

    const elapsedSeconds = amount * plan.totalDurationSeconds;
    const segments = plan.segmentsByOrder[targetOrder];
    let point = plan.initialPointByOrder.get(targetOrder);
    let visibilityProgress = 0;
    let completedSegments = 0;
    let moving = false;
    for (const segment of segments) {
      const startSeconds = segment.step * (
        plan.movementDurationSeconds + plan.staggerSeconds
      );
      const linearProgress = clamp01(
        (elapsedSeconds - startSeconds) / plan.movementDurationSeconds,
      );
      if (linearProgress <= 0) break;
      visibilityProgress = Math.max(visibilityProgress, linearProgress);
      if (linearProgress >= 1) {
        point = segment.end;
        completedSegments += 1;
        continue;
      }
      moving = true;
      const motionProgress = cubicBezierAt(linearProgress, this.timingCurve);
      const deltaX = segment.end.x - segment.start.x;
      const deltaY = segment.end.y - segment.start.y;
      const distance = Math.hypot(deltaX, deltaY) || 1;
      const arc = Math.sin(motionProgress * Math.PI)
        * Math.max(segment.start.size, segment.end.size)
        * this.arcHeightInCells
        * segment.side;
      point = {
        x: segment.start.x + deltaX * motionProgress - deltaY / distance * arc,
        y: segment.start.y + deltaY * motionProgress + deltaX / distance * arc,
        size: segment.start.size
          + (segment.end.size - segment.start.size) * motionProgress,
      };
      break;
    }

    return {
      x: point.x,
      y: point.y,
      size: Math.max(0, point.size),
      opacity: plan.fadeIn
        ? smoothstep01(visibilityProgress / this.revealFraction)
        : 1,
      moving,
      settled: !moving
        && completedSegments === segments.length
        && Math.abs(point.x - target.x) <= COLLISION_GAP
        && Math.abs(point.y - target.y) <= COLLISION_GAP,
    };
  }

  collisionScalesAt(plan, amount) {
    if (plan.collisionCache?.amount === amount) return plan.collisionCache.scales;
    const states = plan.targets.map((_, order) => this.rawStateAt(plan, order, amount));
    const scales = new Float64Array(states.length).fill(1);
    const priority = states.map((state, order) => ({ state, order })).sort((a, b) => (
      Number(b.state.settled) - Number(a.state.settled)
      || Number(!b.state.moving) - Number(!a.state.moving)
      || b.state.size - a.state.size
      || a.order - b.order
    ));
    const cellSize = Math.max(1, ...states.map(state => state.size));
    const buckets = new Map();

    for (const { state, order } of priority) {
      if (state.opacity <= 0 || state.size <= 0) {
        scales[order] = 0;
        continue;
      }
      const baseRadius = state.size * 0.5;
      let radius = baseRadius;
      const candidates = new Set();
      for (const key of circleBucketKeys(state.x, state.y, baseRadius, cellSize)) {
        for (const candidate of buckets.get(key) ?? []) candidates.add(candidate);
      }
      for (const candidate of candidates) {
        const other = states[candidate.order];
        const distance = Math.hypot(state.x - other.x, state.y - other.y);
        radius = Math.min(radius, Math.max(0, distance - candidate.radius));
      }
      scales[order] = radius / baseRadius;
      if (radius <= 0) continue;
      const entry = { order, radius };
      for (const key of circleBucketKeys(state.x, state.y, radius, cellSize)) {
        const bucket = buckets.get(key) ?? [];
        bucket.push(entry);
        buckets.set(key, bucket);
      }
    }
    plan.collisionCache = { amount, scales };
    return scales;
  }

  presentationAt(plan, targetId, progress) {
    const amount = clamp01(progress);
    const targetOrder = plan.targetOrderById.get(targetId);
    if (targetOrder === undefined) {
      return { offsetX: 0, offsetY: 0, opacity: 1, scale: 1 };
    }
    const target = plan.targets[targetOrder];
    const state = this.rawStateAt(plan, targetOrder, amount);
    const collisionScale = this.overlapDots
      ? 1
      : this.collisionScalesAt(plan, amount)[targetOrder];
    return {
      offsetX: state.x - target.x,
      offsetY: state.y - target.y,
      opacity: state.opacity,
      scale: Math.max(0, state.size / target.size * collisionScale),
    };
  }
}
