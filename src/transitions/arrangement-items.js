// Shared item normalization for arrangement modes.
//
// Every arrangement mode — intro, outro, or between-state — receives the same
// event: either explicit `items` carrying world-space centers, or grid
// `indices` plus a `layout`. Normalizing that here keeps a new mode from
// inventing a fourth reading of the event, which is how the three competing
// transition drivers described in REFACTOR_PLAN.md §1.1 diverged.

function centerForIndex(layout, index) {
  const column = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  return {
    x: layout.offsetX + (column + 0.5) * layout.cellSize,
    y: layout.offsetY + (row + 0.5) * layout.cellSize,
  };
}

export function requireArrangementLayout(layout, label) {
  if (
    !layout
    || !Number.isInteger(layout.columns)
    || !Number.isInteger(layout.rows)
    || !Number.isFinite(layout.cellSize)
    || !Number.isFinite(layout.offsetX)
    || !Number.isFinite(layout.offsetY)
  ) throw new TypeError(`${label} requires a complete grid layout.`);
  return layout;
}

/**
 * Normalize one side of an arrangement event into sorted `{ id, x, y, size }`
 * records. The row-major sort is part of the contract: modes pair sources with
 * targets by index, so the order must not depend on caller iteration order.
 */
export function normalizeArrangementItems({ items, indices, layout }, label) {
  if (items !== undefined) {
    if (!Array.isArray(items)) {
      throw new TypeError(`${label} items must be an array.`);
    }
    const normalized = items.map((item, index) => {
      if (
        !item
        || (typeof item.id !== "string" && typeof item.id !== "number")
        || !Number.isFinite(item.x)
        || !Number.isFinite(item.y)
      ) throw new TypeError(`${label} item ${index} is invalid.`);
      return {
        id: item.id,
        x: item.x,
        y: item.y,
        size: Number.isFinite(item.size) && item.size > 0 ? item.size : 1,
      };
    });
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) {
      throw new Error(`${label} item ids must be unique.`);
    }
    return normalized.sort((first, second) => (
      first.y - second.y
      || first.x - second.x
      || String(first.id).localeCompare(String(second.id))
    ));
  }

  requireArrangementLayout(layout, label);
  if (!Array.isArray(indices)) {
    throw new TypeError(`${label} indices must be an array.`);
  }
  const cellCount = layout.columns * layout.rows;
  const unique = [...new Set(indices)].sort((first, second) => first - second);
  if (unique.some(index => !Number.isInteger(index) || index < 0 || index >= cellCount)) {
    throw new RangeError(`${label} received an index outside the grid.`);
  }
  return unique.map(index => ({
    id: index,
    ...centerForIndex(layout, index),
    size: layout.cellSize,
  }));
}

/**
 * Callers may pad a target set with duplicates of a real destination so a
 * larger source set stays fully paired. Duplicates share a pose, so only the
 * first of each pose may draw it — otherwise their opacities stack and the
 * scene reaches full strength early.
 */
export function firstPoseFlags(items) {
  const seen = new Set();
  return items.map(item => {
    const pose = `${item.x}:${item.y}:${item.size}`;
    if (seen.has(pose)) return false;
    seen.add(pose);
    return true;
  });
}
