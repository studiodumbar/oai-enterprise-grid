// Turn inspection output into plain, JSON-serializable data.
//
// Several inspect() implementations hand back live typed arrays by reference
// (CircleGrid.inspect returns this.energy and this.cellState). Two snapshots
// taken on different frames are then the same objects and cannot be diffed.
// Everything that crosses the debug boundary goes through here first.

const MAX_ARRAY_SAMPLE = 4096;

function isTypedArray(value) {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

/**
 * Deep-copy `value` into plain objects, arrays, and primitives. Typed arrays
 * become plain number arrays (truncated past MAX_ARRAY_SAMPLE so a large grid
 * cannot produce an unusable snapshot). Cycles resolve to "<cycle>", functions
 * are dropped.
 */
export function toPlainState(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "function") return undefined;
    return typeof value === "number" && !Number.isFinite(value)
      ? String(value)
      : value;
  }

  if (isTypedArray(value)) {
    const length = Math.min(value.length, MAX_ARRAY_SAMPLE);
    const copy = Array.from(value.subarray(0, length));
    return value.length > length
      ? { truncated: true, length: value.length, values: copy }
      : copy;
  }

  if (seen.has(value)) return "<cycle>";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map(entry => toPlainState(entry, seen));
    }
    if (value instanceof Map) {
      return Object.fromEntries(
        [...value].map(([key, entry]) => [String(key), toPlainState(entry, seen)]),
      );
    }
    if (value instanceof Set) {
      return [...value].map(entry => toPlainState(entry, seen));
    }

    const plain = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = toPlainState(entry, seen);
      if (converted !== undefined) plain[key] = converted;
    }
    return plain;
  } finally {
    seen.delete(value);
  }
}

/** Keys whose value changed between two plain snapshots, as dotted paths. */
export function diffPlainState(before, after, path = "") {
  const changes = [];
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      changes.push(...diffPlainState(before[key], after[key], path ? `${path}.${key}` : key));
    }
    return changes;
  }

  const same = Array.isArray(before) && Array.isArray(after)
    ? JSON.stringify(before) === JSON.stringify(after)
    : before === after;
  if (!same) changes.push({ path, before, after });
  return changes;
}
