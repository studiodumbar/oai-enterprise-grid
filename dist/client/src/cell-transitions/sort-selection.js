import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep01(value) {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
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
  if (
    result.length > 1
    && result.every((value, index) => value === values[index])
  ) result.push(result.shift());
  return result;
}

function centerForIndex(layout, index) {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.offsetX + (column + 0.5) * layout.cellSize,
    y: layout.offsetY + (row + 0.5) * layout.cellSize,
  };
}

function requireLayout(layout) {
  if (
    !layout
    || !Number.isInteger(layout.columns)
    || !Number.isInteger(layout.rows)
    || !Number.isFinite(layout.cellSize)
    || !Number.isFinite(layout.offsetX)
    || !Number.isFinite(layout.offsetY)
  ) throw new TypeError("sort-selection requires a complete grid layout.");
  return layout;
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

function transitionItems({ items, indices, layout }) {
  if (items !== undefined) {
    if (!Array.isArray(items)) {
      throw new TypeError("sort-selection items must be an array.");
    }
    const normalized = items.map((item, index) => {
      if (
        !item
        || (typeof item.id !== "string" && typeof item.id !== "number")
        || !Number.isFinite(item.x)
        || !Number.isFinite(item.y)
      ) throw new TypeError(`sort-selection item ${index} is invalid.`);
      return {
        id: item.id,
        x: item.x,
        y: item.y,
        size: Number.isFinite(item.size) && item.size > 0 ? item.size : 1,
      };
    });
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) {
      throw new Error("sort-selection item ids must be unique.");
    }
    return normalized.sort((first, second) => (
      first.y - second.y
      || first.x - second.x
      || String(first.id).localeCompare(String(second.id))
    ));
  }

  requireLayout(layout);
  if (!Array.isArray(indices)) {
    throw new TypeError("sort-selection indices must be an array.");
  }
  const cellCount = layout.columns * layout.rows;
  const unique = [...new Set(indices)].sort((first, second) => first - second);
  if (unique.some(index => !Number.isInteger(index) || index < 0 || index >= cellCount)) {
    throw new RangeError("sort-selection received an index outside the grid.");
  }
  return unique.map(index => ({
    id: index,
    ...centerForIndex(layout, index),
    size: layout.cellSize,
  }));
}

/**
 * A direction-neutral arrangement mode. Its zero pose is either the previous
 * scene or a translated copy of the target that is wholly outside the viewport.
 * Selection-sort swaps place each cell into its row-major target. Intro plays
 * zero-to-one, while outro plays the same plan backward.
 */
export class SortSelectionTransitionMode {
  constructor(options = {}) {
    const seed = options.seed ?? 173;
    const revealFraction = options.revealFraction ?? 0.16;
    const arcHeightInCells = options.arcHeightInCells ?? 0.32;
    const staggerSeconds = options.staggerSeconds ?? 0;
    const timingCurve = normalizeBezierCurve(
      options.timingCurve ?? [0.65, 0, 0.35, 1],
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
    this.seed = seed;
    this.revealFraction = revealFraction;
    this.arcHeightInCells = arcHeightInCells;
    this.staggerSeconds = staggerSeconds;
    this.timingCurve = Object.freeze(timingCurve);
  }

  createPlan({
    items,
    indices,
    fromItems,
    layout,
    key = "scene",
    durationSeconds = 1,
  }) {
    const targets = transitionItems({ items, indices, layout });
    const slots = targets.map(item => ({ x: item.x, y: item.y, size: item.size }));
    const authoredSources = fromItems === undefined
      ? null
      : transitionItems({ items: fromItems, layout });
    const offscreen = offscreenSlots(targets, layout, key, this.seed);
    const sourceSlots = targets.map((target, slot) => {
      const source = authoredSources?.[slot] ?? offscreen[slot] ?? target;
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
        if (working[candidate] < working[selected]) selected = candidate;
      }
      const firstTarget = working[slot];
      const secondTarget = working[selected];
      const firstStart = positionsByOrder.get(firstTarget);
      const secondStart = positionsByOrder.get(secondTarget);
      const secondEnd = slots[slot];
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
        segmentsByOrder[firstTarget].push({
          step: slot,
          start: firstStart,
          end: firstEnd,
          side: -1,
        });
        segmentsByOrder[secondTarget].push({
          step: slot,
          start: secondStart,
          end: secondEnd,
          side: 1,
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
    };
  }

  presentationAt(plan, targetId, progress) {
    const amount = clamp01(progress);
    const targetOrder = plan.targetOrderById.get(targetId);
    if (targetOrder === undefined || amount >= 1) {
      return { offsetX: 0, offsetY: 0, opacity: 1, scale: 1 };
    }

    const elapsedSeconds = amount * plan.totalDurationSeconds;
    const segments = plan.segmentsByOrder[targetOrder];
    let point = plan.initialPointByOrder.get(targetOrder);
    let visibilityProgress = 0;
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
        continue;
      }
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

    const target = plan.targets[targetOrder];
    return {
      offsetX: point.x - target.x,
      offsetY: point.y - target.y,
      opacity: plan.fadeIn
        ? smoothstep01(visibilityProgress / this.revealFraction)
        : 1,
      scale: Math.max(0, point.size / target.size),
    };
  }
}
