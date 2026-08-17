const IDENTITY_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});

function transitionItem(item, index, label) {
  if (!item || typeof item !== "object") {
    throw new TypeError(`${label} item ${index} must be an object.`);
  }
  const id = item.id ?? index;
  const x = Number(item.x);
  const y = Number(item.y);
  const size = Number(item.size);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError(`${label} item ${index} must have finite x and y values.`);
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new RangeError(`${label} item ${index} must have a finite positive size.`);
  }
  return { id, x, y, size };
}

function transitionItems(items, label) {
  if (!Array.isArray(items)) {
    throw new TypeError(`${label} items must be an array.`);
  }
  return items.map((item, index) => transitionItem(item, index, label));
}

/** Shared source/target pairing for non-arrangement state-transition modes. */
export function createStatePlan({ items, fromItems = [], durationSeconds = 1 }) {
  const targets = transitionItems(items, "Target");
  const sources = transitionItems(fromItems, "Source");
  const targetOrderById = new Map(
    targets.map((target, order) => [target.id, order]),
  );
  const sourceSlots = targets.map((target, order) => {
    if (sources.length === 0) return target;
    return sources[order % sources.length];
  });
  return {
    targets,
    sourceSlots,
    targetOrderById,
    sourceItemCount: sources.length,
    fadeIn: sources.length === 0,
    totalDurationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 1,
  };
}

export function statePlanItem(plan, targetId) {
  const order = plan?.targetOrderById?.get(targetId);
  if (order === undefined) return null;
  return {
    target: plan.targets[order],
    source: plan.sourceSlots[order],
  };
}

export function identityStatePresentation() {
  return IDENTITY_PRESENTATION;
}

export function clampTransitionProgress(progress) {
  return Math.max(0, Math.min(1, Number(progress) || 0));
}
