import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { NativeCircleEndpointTransition } from "../compositions/circle-endpoints.js";
import {
  createCompositionEndpointMode,
  nativeCircleEndpointSettings,
  resolveCompositionEndpointSettings,
} from "../composition-endpoints/index.js";
import {
  compositionEndpointPaletteColor,
  drawCompositionEndpointFrame,
} from "../composition-endpoints/render.js";
import {
  requireMatchingTimelineValue,
  resolveTimelineSettings,
} from "../timeline/timeline-settings.js";
import { createSceneTransitionModeRegistry } from "../scene-transitions/index.js";
import { debug } from "../debug/index.js";
import { drawCellGridGuides } from "../grid/cell-grid-guides.js";
import {
  FLICKER_DOTS_PER_CELL_AXIS,
  createFlicker,
  flickerPaletteIndicesAtCoordinates,
} from "../visuals/flicker/index.js";

export const EMPTY_CELL_STATE = -1;
export const INTERACTIVE_GRID_SESSION_STORAGE_KEY =
  "circle-grid:p5js:interactive-grid:cell-states:v1";
export const INTERACTIVE_SIZE_LEVELS = Object.freeze([0, 1, 2, 3, 4]);
export const INTERACTIVE_COLOR_TRANSITION_MODES = Object.freeze([
  "slide",
]);
export const INTERACTIVE_CELL_COLOR_TRANSITIONS = Object.freeze([
  "snake",
  "diamond-in",
  "diamond-out",
  "waterfall",
  "rows",
]);
export const INTERACTIVE_ROW_DIRECTIONS = Object.freeze([
  "top-to-bottom",
  "bottom-to-top",
  "left-to-right",
  "right-to-left",
]);
export const DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE = Object.freeze([
  0.65,
  0,
  0.35,
  1,
]);

const SIZE_LABELS = Object.freeze([
  "1×1 · largest",
  "2×2 · large",
  "4×4 · small",
  "8×8 · fine",
  "16×16 · finest",
]);
const IDENTITY_GLYPH_TRANSFORM = Object.freeze({
  scaleX: 1,
  scaleY: 1,
  scaleAxis: 0,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
});
const IDENTITY_ENDPOINT_PRESENTATION = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  opacity: 1,
  scale: 1,
});
const NO_SUBDIVISION_NODES = new Set();
const CONNECT_FOUR_ROW_STAGGER_SHARE = 0.35;
const CONNECT_FOUR_COLUMN_STAGGER_SHARE = 0.2;
const CONNECT_FOUR_ROUTE_SHARE = 0.45;
const ORGANIC_STAGGER_JITTER = 0.32;
const ORGANIC_PROGRESS_JITTER = 0.14;
const INTERACTIVE_GRID_SESSION_VERSION = 1;
const MAX_SESSION_SNAPSHOT_LENGTH = 100_000;
const MAX_PROJECT_CELLS = 4096;
const MAX_PROJECT_SPLITS_PER_CELL = 4096;
const MAX_PROJECT_SPLIT_DEPTH = 8;

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashUnit(value) {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x100000000;
}

function transitionNoiseSeed(step, cellIndex) {
  return (
    Math.imul(Math.trunc(Number(step) || 0) ^ 0x9e3779b9, 0x85ebca6b)
    ^ Math.imul(cellIndex + 1, 0xc2b2ae35)
  ) >>> 0;
}

function organicPositionAt(position, seed, lane, maximum = 1) {
  const limit = Math.max(Number.EPSILON, Number(maximum) || 1);
  const normalized = clamp01((Number(position) || 0) / limit);
  const jitter = (
    hashUnit(seed ^ Math.imul(lane + 1, 0x9e3779b1)) - 0.5
  ) * ORGANIC_STAGGER_JITTER;
  return clamp01(normalized + jitter) * limit;
}

function organicProgressAt(progress, seed, lane) {
  const value = clamp01(Number(progress) || 0);
  if (value === 0 || value === 1) return value;
  const coordinate = value * 3;
  const segment = Math.floor(coordinate);
  const fraction = coordinate - segment;
  const smoothFraction = fraction * fraction * (3 - 2 * fraction);
  const laneSeed = seed ^ Math.imul(lane + 1, 0x27d4eb2d);
  const start = hashUnit(laneSeed + segment);
  const end = hashUnit(laneSeed + segment + 1);
  const noise = (start + (end - start) * smoothFraction) * 2 - 1;
  const envelope = 4 * value * (1 - value);
  return clamp01(value + noise * ORGANIC_PROGRESS_JITTER * envelope);
}

function centeredCellKey(column, row) {
  return `${column}:${row}`;
}

function isOptionalBoolean(value) {
  return value === undefined || typeof value === "boolean";
}

function normalizedTransitionPlan(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!INTERACTIVE_CELL_COLOR_TRANSITIONS.includes(value.pattern)) return null;
  if (value.pattern === "rows") {
    if (!INTERACTIVE_ROW_DIRECTIONS.includes(value.direction)) return null;
    return { pattern: value.pattern, direction: value.direction };
  }
  if (value.direction !== null && value.direction !== undefined) return null;
  return { pattern: value.pattern, direction: null };
}

function normalizedSplitKeys(value) {
  if (!Array.isArray(value) || value.length > MAX_PROJECT_SPLITS_PER_CELL) return null;
  const unique = new Set();
  for (const key of value) {
    if (
      typeof key !== "string"
      || !/^[0-3](?:\.[0-3])*$/.test(key)
      || key.split(".").length > MAX_PROJECT_SPLIT_DEPTH
    ) return null;
    unique.add(key);
  }
  return [...unique];
}

function sessionStorageFromRuntime(runtime) {
  if (typeof runtime?.sessionStorage !== "function") return null;
  try {
    const storage = runtime.sessionStorage();
    if (
      !storage
      || typeof storage.getItem !== "function"
      || typeof storage.setItem !== "function"
    ) return null;
    return storage;
  } catch {
    return null;
  }
}

function parseSessionCellStates(serialized, longSideCells) {
  if (
    typeof serialized !== "string"
    || serialized.length > MAX_SESSION_SNAPSHOT_LENGTH
  ) return null;
  let snapshot;
  try {
    snapshot = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (
    !snapshot
    || typeof snapshot !== "object"
    || Array.isArray(snapshot)
    || snapshot.version !== INTERACTIVE_GRID_SESSION_VERSION
    || snapshot.longSideCells !== longSideCells
    || !Array.isArray(snapshot.cells)
    || snapshot.cells.length > longSideCells * longSideCells
  ) return null;

  const halfLongSide = Math.floor(longSideCells * 0.5);
  const states = new Map();
  const flickeringCells = new Set();
  for (const cell of snapshot.cells) {
    if (
      !cell
      || typeof cell !== "object"
      || Array.isArray(cell)
      || !Number.isInteger(cell.column)
      || !Number.isInteger(cell.row)
      || Math.abs(cell.column) > halfLongSide
      || Math.abs(cell.row) > halfLongSide
      || !isOptionalBoolean(cell.flicker)
      || (
        cell.state !== EMPTY_CELL_STATE
        && !INTERACTIVE_SIZE_LEVELS.includes(cell.state)
      )
    ) return null;
    const key = centeredCellKey(cell.column, cell.row);
    if (states.has(key)) return null;
    states.set(key, cell.state);
    if (cell.flicker === true) flickeringCells.add(key);
  }
  return { states, flickeringCells };
}

function coordinateKey(value) {
  // Subdivision coordinates are dyadic fractions. Rounding keeps equivalent
  // rows/shells together after normal floating-point arithmetic while still
  // resolving geometry far below a visible pixel.
  return Math.round(value * 1e9);
}

function randomIndex(random, count) {
  const value = Number(random());
  const normalized = Number.isFinite(value) ? clamp01(value) : 0;
  return Math.min(count - 1, Math.floor(normalized * count));
}

export function rollInteractiveCellColorTransition(random = Math.random) {
  if (typeof random !== "function") {
    throw new TypeError("Interactive color transition random source must be a function.");
  }
  const pattern = INTERACTIVE_CELL_COLOR_TRANSITIONS[
    randomIndex(random, INTERACTIVE_CELL_COLOR_TRANSITIONS.length)
  ];
  const direction = pattern === "rows"
    ? INTERACTIVE_ROW_DIRECTIONS[randomIndex(random, INTERACTIVE_ROW_DIRECTIONS.length)]
    : null;
  return Object.freeze({ pattern, direction });
}

function bandPositions(values, descending = false) {
  const keys = values.map(coordinateKey);
  const bands = [...new Set(keys)].sort((a, b) => descending ? b - a : a - b);
  const indices = new Map(bands.map((key, index) => [key, index]));
  const lastBand = bands.length - 1;
  return {
    bandCount: bands.length,
    positions: keys.map(key => lastBand <= 0 ? 0 : indices.get(key) / lastBand),
  };
}

function horizontalOverlap(a, b) {
  const left = Math.max(a.x - a.halfSize, b.x - b.halfSize);
  const right = Math.min(a.x + a.halfSize, b.x + b.halfSize);
  return right - left;
}

/**
 * Builds a fixed-dot route from the top boundary to every possible landing
 * target. Adjacency comes from leaf geometry, so recursively split quadtree
 * cells still produce continuous Connect-Four-style paths.
 */
export function connectFourRoutesForLeaves(leaves) {
  if (!Array.isArray(leaves)) {
    throw new TypeError("Connect four leaves must be an array.");
  }
  const leavesByBottom = new Map();
  const topBoundaryKey = coordinateKey(-0.5);
  leaves.forEach((leaf, index) => {
    const bottomKey = coordinateKey(leaf.y + leaf.halfSize);
    if (!leavesByBottom.has(bottomKey)) leavesByBottom.set(bottomKey, []);
    leavesByBottom.get(bottomKey).push(index);
  });

  return leaves.map((_, targetIndex) => {
    const route = [targetIndex];
    const visited = new Set(route);
    let currentIndex = targetIndex;

    while (
      coordinateKey(leaves[currentIndex].y - leaves[currentIndex].halfSize)
      > topBoundaryKey
    ) {
      const current = leaves[currentIndex];
      const topKey = coordinateKey(current.y - current.halfSize);
      const candidates = (leavesByBottom.get(topKey) ?? [])
        .filter(index => !visited.has(index) && horizontalOverlap(leaves[index], current) > 0)
        .sort((a, b) => (
          Math.abs(leaves[a].x - current.x) - Math.abs(leaves[b].x - current.x)
          || horizontalOverlap(leaves[b], current) - horizontalOverlap(leaves[a], current)
          || String(leaves[a].key ?? a).localeCompare(String(leaves[b].key ?? b))
        ));
      if (candidates.length === 0) break;
      currentIndex = candidates[0];
      route.push(currentIndex);
      visited.add(currentIndex);
    }

    route.reverse();
    return route;
  });
}

function connectFourTraceStarts(positions, columnPositions) {
  const lastStart = 1 - CONNECT_FOUR_ROUTE_SHARE;
  if (positions.length <= 1) return positions.map(() => 0);
  const rawStarts = positions.map((position, index) => (
    position * CONNECT_FOUR_ROW_STAGGER_SHARE
    + columnPositions[index] * CONNECT_FOUR_COLUMN_STAGGER_SHARE
  ));
  const { minStart, maxStart } = rawStarts.reduce((bounds, start) => ({
    minStart: Math.min(bounds.minStart, start),
    maxStart: Math.max(bounds.maxStart, start),
  }), { minStart: Infinity, maxStart: -Infinity });
  const span = maxStart - minStart;
  if (span <= Number.EPSILON) {
    return rawStarts.map((_, index) => index / (rawStarts.length - 1) * lastStart);
  }
  return rawStarts.map(start => (start - minStart) / span * lastStart);
}

/**
 * Returns the incoming-color mix for each stationary leaf. Active routes carry
 * a short pulse down their adjacent dots; completed routes latch only their
 * landing target. Multiple traces combine by taking the strongest mix.
 */
export function connectFourColorMixesAt(
  sequence,
  globalProgress,
  timingCurve = DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
  noiseSeed,
) {
  const routes = sequence?.routes;
  const traceStarts = sequence?.traceStarts;
  if (
    !Array.isArray(routes)
    || !Array.isArray(traceStarts)
    || routes.length !== traceStarts.length
  ) {
    throw new TypeError(
      "Connect four sequence must contain matching routes and trace starts.",
    );
  }
  const mixes = new Array(routes.length).fill(0);
  routes.forEach((route, targetIndex) => {
    // Give long 16-dot routes enough screen time to remain legible at 60fps.
    // Column phase keeps parallel paths distinct, while row phase preserves
    // bottom-to-top landing order within every column. The final route still
    // ends at exactly global progress 1.
    const traceStart = Number.isInteger(noiseSeed)
      ? organicPositionAt(
        traceStarts[targetIndex],
        noiseSeed,
        targetIndex,
        1 - CONNECT_FOUR_ROUTE_SHARE,
      )
      : traceStarts[targetIndex];
    const linearProgress = routes.length === 1
      ? clamp01(Number(globalProgress) || 0)
      : clamp01((
        clamp01(Number(globalProgress) || 0)
        - traceStart
      ) / CONNECT_FOUR_ROUTE_SHARE);
    if (linearProgress <= 0) return;
    if (linearProgress >= 1) {
      mixes[targetIndex] = 1;
      return;
    }

    const organicProgress = Number.isInteger(noiseSeed)
      ? organicProgressAt(linearProgress, noiseSeed, targetIndex)
      : linearProgress;
    const progress = cubicBezierAt(organicProgress, timingCurve);
    const cursor = progress * route.length;
    const firstNode = Math.max(1, Math.floor(cursor));
    const lastNode = Math.min(route.length, Math.ceil(cursor));
    for (let node = firstNode; node <= lastNode; node += 1) {
      const leafIndex = route[node - 1];
      const mix = clamp01(1 - Math.abs(cursor - node));
      mixes[leafIndex] = Math.max(mixes[leafIndex], mix);
    }
  });
  return mixes;
}

/**
 * Returns a normalized start position for every visible leaf. Equal positions
 * deliberately move together (a row or a diamond shell); snake assigns every
 * leaf its own consecutive point on the path.
 */
export function colorTransitionSequenceForLeaves(leaves, transition) {
  if (!Array.isArray(leaves)) {
    throw new TypeError("Interactive color transition leaves must be an array.");
  }
  const pattern = transition?.pattern;
  if (!INTERACTIVE_CELL_COLOR_TRANSITIONS.includes(pattern)) {
    throw new Error(`Unknown interactive cell color transition "${pattern}".`);
  }
  if (leaves.length === 0) return { positions: [], bandCount: 0 };

  if (pattern === "snake") {
    // Sort by the first time a finest-resolution serpentine scan would enter
    // each leaf. A split leaf therefore replaces one path segment with its
    // children instead of creating center-row jumps across adaptive geometry.
    const inferredLevel = leaf => {
      if (Number.isInteger(leaf.level) && leaf.level >= 0) return leaf.level;
      const slot = Math.max(Number.EPSILON, Number(leaf.halfSize) * 2);
      return Math.max(0, Math.round(-Math.log2(slot)));
    };
    const virtualLevel = Math.min(
      24,
      leaves.reduce((deepest, leaf) => Math.max(deepest, inferredLevel(leaf)), 0),
    );
    const virtualSize = 2 ** virtualLevel;
    const path = leaves.map((leaf, index) => {
      const top = clamp01(leaf.y - leaf.halfSize + 0.5);
      const left = clamp01(leaf.x - leaf.halfSize + 0.5);
      const right = clamp01(leaf.x + leaf.halfSize + 0.5);
      const row = Math.min(virtualSize - 1, Math.round(top * virtualSize));
      const leftColumn = Math.min(virtualSize - 1, Math.round(left * virtualSize));
      const rightColumn = Math.max(
        leftColumn,
        Math.min(virtualSize - 1, Math.round(right * virtualSize) - 1),
      );
      const pathColumn = row % 2 === 0
        ? leftColumn
        : virtualSize - 1 - rightColumn;
      return { index, row, pathColumn, key: String(leaf.key ?? index) };
    }).sort((a, b) => (
      a.row - b.row
      || a.pathColumn - b.pathColumn
      || a.key.localeCompare(b.key)
    )).map(entry => entry.index);
    const positions = new Array(leaves.length).fill(0);
    const last = path.length - 1;
    path.forEach((leafIndex, order) => {
      positions[leafIndex] = last <= 0 ? 0 : order / last;
    });
    return { positions, bandCount: path.length };
  }

  if (pattern === "diamond-in" || pattern === "diamond-out") {
    return bandPositions(
      leaves.map(leaf => Math.abs(leaf.x) + Math.abs(leaf.y)),
      pattern === "diamond-in",
    );
  }

  if (pattern === "waterfall") {
    // Lowest available landing edges fill first. The bottom-edge coordinate
    // also handles mixed leaf sizes created by recursive subdivision.
    const landingSequence = bandPositions(
      leaves.map(leaf => leaf.y + leaf.halfSize),
      true,
    );
    const routes = connectFourRoutesForLeaves(leaves);
    const entryXValues = routes.map(route => leaves[route[0]].x);
    const { minX, maxX } = entryXValues.reduce((bounds, x) => ({
      minX: Math.min(bounds.minX, x),
      maxX: Math.max(bounds.maxX, x),
    }), { minX: Infinity, maxX: -Infinity });
    const xSpan = maxX - minX;
    const columnPositions = entryXValues.map(
      x => xSpan <= 0 ? 0 : (x - minX) / xSpan,
    );
    return {
      ...landingSequence,
      columnPositions,
      routes,
      traceStarts: connectFourTraceStarts(
        landingSequence.positions,
        columnPositions,
      ),
    };
  }

  const direction = transition.direction;
  if (!INTERACTIVE_ROW_DIRECTIONS.includes(direction)) {
    throw new Error(`Unknown interactive row transition direction "${direction}".`);
  }
  const horizontal = direction === "left-to-right" || direction === "right-to-left";
  const descending = direction === "bottom-to-top" || direction === "right-to-left";
  return bandPositions(
    leaves.map(leaf => horizontal ? leaf.x : leaf.y),
    descending,
  );
}

/**
 * Maps the shared cell clock onto one leaf/band. The first band starts at 0
 * and the final band finishes at 1, so no pattern can overrun the configured
 * parent duration regardless of its dot count.
 */
export function staggeredColorProgressAt(globalProgress, position, bandCount) {
  const progress = clamp01(Number(globalProgress) || 0);
  const bands = Math.max(1, Math.trunc(Number(bandCount) || 1));
  if (bands === 1 || progress === 0 || progress === 1) return progress;
  const motionWindow = 2 / (bands + 1);
  const start = clamp01(Number(position) || 0) * (1 - motionWindow);
  return clamp01((progress - start) / motionWindow);
}

function validateLevel(level) {
  if (!Number.isInteger(level) || !INTERACTIVE_SIZE_LEVELS.includes(level)) {
    const first = INTERACTIVE_SIZE_LEVELS[0];
    const last = INTERACTIVE_SIZE_LEVELS.at(-1);
    throw new RangeError(
      `Size level must be an integer from ${first} to ${last}; received ${level}.`,
    );
  }
  return level;
}

export function normalizeInteractiveColorTransition(config) {
  if (!config || typeof config !== "object") {
    throw new TypeError("interactiveGrid.colorTransition must be an object.");
  }
  const mode = String(config.mode ?? "").trim().toLowerCase();
  if (!INTERACTIVE_COLOR_TRANSITION_MODES.includes(mode)) {
    throw new Error(
      `Unknown interactive color transition "${config.mode}". Available modes: `
      + `${INTERACTIVE_COLOR_TRANSITION_MODES.join(", ")}.`,
    );
  }
  const durationSeconds = Number(config.durationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new RangeError("interactiveGrid.colorTransition.durationSeconds must be non-negative.");
  }
  const cycleThroughPalette = config.cycleThroughPalette === undefined
    ? false
    : config.cycleThroughPalette;
  if (typeof cycleThroughPalette !== "boolean") {
    throw new TypeError(
      "interactiveGrid.colorTransition.cycleThroughPalette must be true or false.",
    );
  }
  const noise = config.noise === undefined ? false : config.noise;
  if (typeof noise !== "boolean") {
    throw new TypeError(
      "interactiveGrid.colorTransition.noise must be true or false.",
    );
  }
  const timingCurve = normalizeBezierCurve(
    config.timingCurve ?? DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
    "interactiveGrid.colorTransition timingCurve",
  );
  if (timingCurve[1] < 0 || timingCurve[1] > 1 || timingCurve[3] < 0 || timingCurve[3] > 1) {
    throw new RangeError("interactiveGrid.colorTransition timingCurve Y values must be between 0 and 1.");
  }
  return Object.freeze({
    mode,
    cycleThroughPalette,
    noise,
    durationSeconds,
    timingCurve: Object.freeze(timingCurve),
  });
}

export function nextInteractiveCellState(state, direction = 1) {
  const sequence = [
    EMPTY_CELL_STATE,
    ...INTERACTIVE_SIZE_LEVELS,
  ];
  const index = sequence.indexOf(state);
  if (index < 0) {
    throw new RangeError(`Unknown interactive cell state ${state}.`);
  }
  const step = direction < 0 ? -1 : 1;
  return sequence[modulo(index + step, sequence.length)];
}

export function createInteractiveGridLayout(options, { width, height }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("Interactive grid viewport dimensions must be positive numbers.");
  }
  const requested = Math.max(3, Math.round(options.longSideCells));
  const longCells = requested % 2 === 0 ? requested - 1 : requested;
  const minimumShortCells = Math.min(3, longCells);
  const cellSize = Math.min(
    Math.max(width, height) / longCells,
    Math.min(width, height) / minimumShortCells,
  );
  const fitOdd = size => {
    const count = Math.max(1, Math.floor(size / cellSize));
    return count % 2 === 0 ? Math.max(1, count - 1) : count;
  };
  const columns = width >= height ? longCells : fitOdd(width);
  const rows = width >= height ? fitOdd(height) : longCells;
  const patternWidth = columns * cellSize;
  const patternHeight = rows * cellSize;

  return {
    width,
    height,
    columns,
    rows,
    cellSize,
    patternWidth,
    patternHeight,
    offsetX: (width - patternWidth) * 0.5,
    offsetY: (height - patternHeight) * 0.5,
  };
}

export function interactiveCellIndexAt(layout, x, y) {
  if (!layout || !Number.isFinite(x) || !Number.isFinite(y)) return -1;
  const localX = x - layout.offsetX;
  const localY = y - layout.offsetY;
  if (
    localX < 0
    || localY < 0
    || localX >= layout.patternWidth
    || localY >= layout.patternHeight
  ) return -1;

  const column = Math.floor(localX / layout.cellSize);
  const row = Math.floor(localY / layout.cellSize);
  if (column < 0 || column >= layout.columns || row < 0 || row >= layout.rows) {
    return -1;
  }
  return row * layout.columns + column;
}

/**
 * Emits every visible leaf in a persistent per-circle quadtree. A split key
 * removes exactly one leaf and replaces it with four addressable children.
 * Keys are stable strings such as "0", "0.2", and "0.2.3".
 */
export function visitSubdivisionLeaves(level, splitNodes, visitor) {
  validateLevel(level);
  if (!(splitNodes instanceof Set)) {
    throw new TypeError("Subdivision split nodes must be a Set.");
  }
  if (typeof visitor !== "function") {
    throw new TypeError("Subdivision leaf visitor must be a function.");
  }

  const subdivisions = 1 << level;
  const rootSlot = 1 / subdivisions;
  const stack = [];

  // Push in reverse and pop from the end to preserve deterministic row-major
  // order without recursive calls. Deeply authored branches therefore remain
  // safe even after far more clicks than can be resolved on screen.
  for (let row = subdivisions - 1; row >= 0; row -= 1) {
    for (let column = subdivisions - 1; column >= 0; column -= 1) {
      const rootIndex = row * subdivisions + column;
      stack.push({
        x: (column + 0.5) * rootSlot - 0.5,
        y: (row + 0.5) * rootSlot - 0.5,
        slot: rootSlot,
        key: String(rootIndex),
        depth: 0,
      });
    }
  }

  while (stack.length > 0) {
    const node = stack.pop();
    if (!splitNodes.has(node.key)) {
      visitor({
        x: node.x,
        y: node.y,
        halfSize: node.slot * 0.5,
        key: node.key,
        depth: node.depth,
        level: level + node.depth,
      });
      continue;
    }

    const childSlot = node.slot * 0.5;
    for (let childIndex = 3; childIndex >= 0; childIndex -= 1) {
      const childColumn = childIndex % 2;
      const childRow = Math.floor(childIndex / 2);
      stack.push({
        x: node.x + (childColumn - 0.5) * childSlot,
        y: node.y + (childRow - 0.5) * childSlot,
        slot: childSlot,
        key: `${node.key}.${childIndex}`,
        depth: node.depth + 1,
      });
    }
  }
}

export function sharpPaletteIndexAt(time, cycleSeconds, colorCount, phase = 0) {
  if (!Number.isInteger(colorCount) || colorCount <= 0) {
    throw new RangeError("Palette color count must be a positive integer.");
  }
  const duration = Math.max(0.1, Number(cycleSeconds) || 0.1);
  const seconds = Number.isFinite(time) ? time : 0;
  const step = Math.floor(seconds / (duration / colorCount));
  return modulo(step + Math.trunc(phase), colorCount);
}

export function paletteStepAt(time, cycleSeconds, colorCount) {
  if (!Number.isInteger(colorCount) || colorCount <= 0) {
    throw new RangeError("Palette color count must be a positive integer.");
  }
  const duration = Math.max(0.1, Number(cycleSeconds) || 0.1);
  const seconds = Number.isFinite(time) ? time : 0;
  return Math.floor(seconds / (duration / colorCount));
}

export function paletteTransitionDurationSeconds(
  cycleSeconds,
  transitionSeconds,
  colorCount,
) {
  if (!Number.isInteger(colorCount) || colorCount <= 0) {
    throw new RangeError("Palette color count must be a positive integer.");
  }
  const cycleDuration = Math.max(0.1, Number(cycleSeconds) || 0.1);
  const stepSeconds = cycleDuration / colorCount;
  const requested = Math.max(0, Number(transitionSeconds) || 0);
  const tolerance = Number.EPSILON * Math.max(1, stepSeconds, requested) * 8;
  if (requested - stepSeconds > tolerance) {
    throw new RangeError(
      "interactiveGrid.colorTransition.durationSeconds cannot exceed "
      + `one palette step (${stepSeconds} seconds).`,
    );
  }
  return Math.min(requested, stepSeconds);
}

export function paletteSlideStateAt(
  time,
  cycleSeconds,
  transitionSeconds,
  colorCount,
  phase = 0,
  timingCurve = DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
) {
  if (!Number.isInteger(colorCount) || colorCount <= 0) {
    throw new RangeError("Palette color count must be a positive integer.");
  }
  const duration = Math.max(0.1, Number(cycleSeconds) || 0.1);
  const stepSeconds = duration / colorCount;
  const transitionDuration = paletteTransitionDurationSeconds(
    cycleSeconds,
    transitionSeconds,
    colorCount,
  );
  const seconds = Number.isFinite(time) ? time : 0;
  const step = Math.floor(seconds / stepSeconds);
  const currentIndex = modulo(step + Math.trunc(phase), colorCount);
  const elapsedInStep = modulo(seconds, stepSeconds);
  const completionTolerance = Number.EPSILON
    * Math.max(1, Math.abs(seconds), stepSeconds, transitionDuration)
    * 8;
  const linearProgress = transitionDuration <= 0
    ? 1
    : elapsedInStep + completionTolerance >= transitionDuration
      ? 1
      : clamp01(elapsedInStep / transitionDuration);
  const progress = cubicBezierAt(linearProgress, timingCurve);

  return {
    previousIndex: modulo(currentIndex - 1, colorCount),
    currentIndex,
    linearProgress,
    progress,
    transitioning: linearProgress < 1,
  };
}

/**
 * Maps one scheduled palette change onto a complete forward palette lap. The
 * same outer duration is divided into color hops; each hop restarts the chosen
 * spatial pattern and the final hop lands on the originally scheduled color.
 */
export function paletteTourStateAt(
  baseState,
  colorCount,
  enabled = false,
  timingCurve = DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
) {
  if (!Number.isInteger(colorCount) || colorCount <= 0) {
    throw new RangeError("Palette color count must be a positive integer.");
  }
  if (typeof enabled !== "boolean") {
    throw new TypeError("Palette tour enabled state must be true or false.");
  }
  if (!baseState || typeof baseState !== "object") {
    throw new TypeError("Palette tour requires a base transition state.");
  }
  if (!enabled) return baseState;

  const previousIndex = modulo(Math.trunc(baseState.previousIndex), colorCount);
  const currentIndex = modulo(Math.trunc(baseState.currentIndex), colorCount);
  if (colorCount === 1) {
    return {
      previousIndex: currentIndex,
      currentIndex,
      linearProgress: 1,
      progress: 1,
      transitioning: false,
    };
  }
  if (!baseState.transitioning) return baseState;

  const hopCount = colorCount + 1;
  const scaledProgress = clamp01(Number(baseState.linearProgress) || 0) * hopCount;
  const hop = Math.min(hopCount - 1, Math.floor(scaledProgress));
  const linearProgress = scaledProgress - hop;
  const hopPreviousIndex = modulo(previousIndex + hop, colorCount);
  return {
    previousIndex: hopPreviousIndex,
    currentIndex: modulo(hopPreviousIndex + 1, colorCount),
    linearProgress,
    progress: cubicBezierAt(linearProgress, timingCurve),
    transitioning: true,
  };
}

function paletteByName(palettes, requestedName) {
  const normalized = String(requestedName).toLowerCase();
  const key = Object.keys(palettes).find(name => name.toLowerCase() === normalized);
  if (!key) {
    throw new Error(
      `Unknown palette "${requestedName}". Available palettes: ${Object.keys(palettes).join(", ")}.`,
    );
  }
  return palettes[key];
}

/**
 * A direct-manipulation grid. Every active size supports the same color and
 * recursive-subdivision capabilities, leaving transitions free to operate on
 * size state without a second behavior-assignment layer.
 */
export class InteractiveGridGenerator {
  constructor({
    options,
    settings,
    runtime,
    palettes,
    shapeRenderer,
    sceneTransitionTypes,
  }) {
    const timing = options?.timing === undefined
      ? null
      : resolveTimelineSettings(options.timing, "interactiveGrid.timing");
    if (timing) {
      requireMatchingTimelineValue(
        options?.colorCycleSeconds,
        timing.bodyDurationSeconds,
        {
          label: "interactiveGrid.colorCycleSeconds",
          source: "interactiveGrid.timing.bodyDurationSeconds",
        },
      );
    }
    this.options = {
      ...options,
      ...(timing === null ? {} : { timing }),
      colorCycleSeconds: options?.colorCycleSeconds ?? timing?.bodyDurationSeconds,
    };
    this.runtime = runtime;
    this.shapeRenderer = shapeRenderer;
    this.random = typeof runtime?.random === "function"
      ? () => runtime.random()
      : Math.random;
    this.projectSeed = typeof runtime?.projectSeed === "function"
      ? () => runtime.projectSeed()
      : null;
    this.active = false;

    if (!shapeRenderer || typeof shapeRenderer.addPath !== "function") {
      throw new TypeError("InteractiveGridGenerator requires a shape renderer.");
    }
    const palette = paletteByName(palettes, this.options.palette);
    this.paletteColors = palette.slice();
    if (timing && timing.beatCount !== this.paletteColors.length) {
      throw new RangeError(
        "interactiveGrid.timing.beatCount must match the configured palette color count.",
      );
    }
    this.colorTransition = normalizeInteractiveColorTransition(this.options.colorTransition);
    paletteTransitionDurationSeconds(
      this.options.colorCycleSeconds,
      this.colorTransition.durationSeconds,
      this.paletteColors.length,
    );
    this.noiseFunction = typeof runtime?.p5?.noise === "function"
      ? runtime.p5.noise.bind(runtime.p5)
      : undefined;
    this.flicker = createFlicker({
      palette,
      settings: this.options.flicker,
      noiseFunction: this.noiseFunction,
      autoCycleSeconds: this.options.timing?.beatSeconds ?? null,
    });
    this.backgroundColor = settings?.canvas?.background ?? "#fff";
    this.compositionEndpoints = resolveCompositionEndpointSettings(
      settings?.composition ?? {},
      this.options.circleEndpoints ?? {},
    );
    this.circleEndpoint = new NativeCircleEndpointTransition({
      settings: nativeCircleEndpointSettings(this.compositionEndpoints),
      intro: this.options.intro,
      outro: this.options.outro,
      modeRegistry: sceneTransitionTypes ?? createSceneTransitionModeRegistry(),
    });
    this.endCompositionEndpoint = createCompositionEndpointMode(
      this.compositionEndpoints.end,
      this.compositionEndpoints.modes,
    );
    this.circleEndpointActive = false;
    this.layout = null;
    this.baseStates = new Int8Array();
    this.subdivisionTrees = [];
    this.leafCaches = [];
    this.colorTransitionPlans = [];
    this.colorTransitionStep = null;
    this.hoveredCell = -1;
    this.hoveredSubdivisionLeaf = null;
    this.focusedCell = -1;
    this.sessionStorage = sessionStorageFromRuntime(runtime);
    this.sessionCellStates = new Map();
    this.flickeringCellKeys = new Set();
    this.resize(runtime.viewport());
  }

  enter() {
    this.active = true;
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.circleEndpointActive = false;
    const canvas = this.runtime.canvas?.();
    if (canvas?.style) canvas.style.cursor = "pointer";
  }

  exit() {
    this.active = false;
    const canvas = this.runtime.canvas?.();
    if (canvas?.style) canvas.style.cursor = "";
  }

  input(type, payload = {}) {
    if (!this.active) return false;
    if (type === "contextmenu") {
      return this.setCellAbsentAt(payload.x, payload.y);
    }
    if (type === "click") {
      if (payload.button !== undefined && payload.button !== 0) return false;
      if (payload.shiftKey) return this.cycleCellAt(payload.x, payload.y);
      return this.activateAt(payload.x, payload.y);
    }
    if (type !== "keydown") return false;

    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (keys.includes(payload.key)) {
      this.moveKeyboardFocus(payload.key);
      return true;
    }
    if (payload.key === "Enter" && !payload.repeat) {
      if (this.focusedCell < 0) this.focusedCell = this.centerCellIndex();
      this.cycleCell(this.focusedCell);
      return true;
    }
    if (payload.key === " " && !payload.repeat) {
      if (this.focusedCell < 0) this.focusedCell = this.centerCellIndex();
      return Boolean(
        this.subdivideFirstLeaf(this.focusedCell)
        || this.cycleCell(this.focusedCell),
      );
    }
    if (payload.key?.toLowerCase() === "f" && !payload.repeat) {
      return this.toggleHoveredCellFlicker();
    }
    return false;
  }

  centeredKeyForCell(index) {
    if (
      !this.layout
      || !Number.isInteger(index)
      || index < 0
      || index >= this.baseStates.length
    ) return null;
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    return centeredCellKey(
      column - Math.floor(this.layout.columns * 0.5),
      row - Math.floor(this.layout.rows * 0.5),
    );
  }

  isCellFlickering(index) {
    const key = this.centeredKeyForCell(index);
    return key !== null && this.flickeringCellKeys?.has(key) === true;
  }

  toggleHoveredCellFlicker() {
    const index = this.hoveredCell;
    const key = this.centeredKeyForCell(index);
    if (key === null) return false;
    if (!(this.flickeringCellKeys instanceof Set)) this.flickeringCellKeys = new Set();
    const enabled = !this.flickeringCellKeys.has(key);
    if (enabled) this.flickeringCellKeys.add(key);
    else this.flickeringCellKeys.delete(key);
    this.focusedCell = index;
    this.rememberSessionCellState(index);
    this.persistSessionCellStates();
    this.announceCellFlicker(index, enabled);
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    debug.transition(
      "interactive-cell-flicker index=%d enabled=%s row=%d column=%d",
      index,
      enabled,
      row,
      column,
    );
    return { index, enabled };
  }

  announceCellFlicker(index, enabled) {
    const documentRef = this.runtime?.document?.()
      ?? (typeof document !== "undefined" ? document : null);
    const announcer = this.runtime?.announcer?.()
      ?? documentRef?.getElementById?.("grid-announcer");
    if (!announcer) return;
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    announcer.textContent = `Row ${row + 1}, column ${column + 1}: flicker ${enabled ? "on" : "off"}.`;
  }

  activateAt(x, y) {
    const index = interactiveCellIndexAt(this.layout, x, y);
    if (index < 0) return false;
    this.focusedCell = index;
    return this.subdivideLeafAt(index, x, y) || this.cycleCell(index);
  }

  cycleCellAt(x, y) {
    const index = interactiveCellIndexAt(this.layout, x, y);
    if (index < 0) return false;
    this.focusedCell = index;
    return this.cycleCell(index);
  }

  setCellAbsentAt(x, y) {
    const index = interactiveCellIndexAt(this.layout, x, y);
    if (index < 0) return false;
    this.focusedCell = index;
    return this.setCellAbsent(index);
  }

  setCellAbsent(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.baseStates.length) {
      return false;
    }
    this.baseStates[index] = EMPTY_CELL_STATE;
    this.subdivisionTrees?.[index]?.clear();
    if (this.leafCaches) this.leafCaches[index] = null;
    this.hoveredSubdivisionLeaf = null;
    this.rememberSessionCellState(index);
    this.persistSessionCellStates();
    this.announceFocusedCell();
    return {
      index,
      state: EMPTY_CELL_STATE,
    };
  }

  cycleCell(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.baseStates.length) {
      return false;
    }
    this.baseStates[index] = nextInteractiveCellState(this.baseStates[index]);
    this.subdivisionTrees?.[index]?.clear();
    if (this.leafCaches) this.leafCaches[index] = null;
    this.hoveredSubdivisionLeaf = null;
    this.rememberSessionCellState(index);
    this.persistSessionCellStates();
    this.announceFocusedCell();
    return {
      index,
      state: this.baseStates[index],
    };
  }

  subdivisionLeafAt(index, x, y) {
    const level = this.baseStates[index];
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= this.baseStates.length
      || level === EMPTY_CELL_STATE
      || !Number.isFinite(x)
      || !Number.isFinite(y)
    ) return null;

    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    const cellLeft = this.layout.offsetX + column * this.layout.cellSize;
    const cellTop = this.layout.offsetY + row * this.layout.cellSize;
    const centerX = this.layout.offsetX + (column + 0.5) * this.layout.cellSize;
    const centerY = this.layout.offsetY + (row + 0.5) * this.layout.cellSize;
    const splitNodes = this.subdivisionTrees[index] ?? NO_SUBDIVISION_NODES;
    const normalizedX = (x - cellLeft) / this.layout.cellSize;
    const normalizedY = (y - cellTop) / this.layout.cellSize;
    if (
      normalizedX < 0
      || normalizedX >= 1
      || normalizedY < 0
      || normalizedY >= 1
    ) return null;

    const subdivisions = 1 << level;
    let slot = 1 / subdivisions;
    const rootColumn = Math.min(subdivisions - 1, Math.floor(normalizedX * subdivisions));
    const rootRow = Math.min(subdivisions - 1, Math.floor(normalizedY * subdivisions));
    let left = rootColumn * slot;
    let top = rootRow * slot;
    let key = String(rootRow * subdivisions + rootColumn);
    let depth = 0;

    while (splitNodes.has(key)) {
      slot *= 0.5;
      const childColumn = normalizedX >= left + slot ? 1 : 0;
      const childRow = normalizedY >= top + slot ? 1 : 0;
      if (childColumn === 1) left += slot;
      if (childRow === 1) top += slot;
      key = `${key}.${childRow * 2 + childColumn}`;
      depth += 1;
    }

    const leafX = cellLeft + (left + slot * 0.5) * this.layout.cellSize;
    const leafY = cellTop + (top + slot * 0.5) * this.layout.cellSize;
    const radius = slot * 0.5 * this.layout.cellSize * this.marginScale();
    const deltaX = x - leafX;
    const deltaY = y - leafY;
    if (deltaX * deltaX + deltaY * deltaY > radius * radius) return null;

    return {
      x: (leafX - centerX) / this.layout.cellSize,
      y: (leafY - centerY) / this.layout.cellSize,
      halfSize: slot * 0.5,
      key,
      depth,
      level: level + depth,
      cellIndex: index,
      centerX: leafX,
      centerY: leafY,
      radius,
    };
  }

  subdivideLeafAt(index, x, y) {
    const leaf = this.subdivisionLeafAt(index, x, y);
    if (!leaf) return false;
    return this.splitSubdivisionLeaf(index, leaf);
  }

  subdivideFirstLeaf(index) {
    const level = this.baseStates[index];
    if (level === EMPTY_CELL_STATE) return false;
    const splitNodes = this.subdivisionTrees[index] ?? NO_SUBDIVISION_NODES;
    let firstLeaf = null;
    visitSubdivisionLeaves(level, splitNodes, leaf => {
      // Keyboard activation advances breadth-first so repeated presses make
      // every visible circle reachable instead of drilling one tiny branch.
      if (!firstLeaf || leaf.depth < firstLeaf.depth) {
        firstLeaf = { ...leaf, cellIndex: index };
      }
    });
    return firstLeaf ? this.splitSubdivisionLeaf(index, firstLeaf) : false;
  }

  splitSubdivisionLeaf(index, leaf) {
    const level = this.baseStates[index];
    if (
      !Number.isInteger(index)
      || index < 0
      || index >= this.baseStates.length
      || !leaf
      || typeof leaf.key !== "string"
      || (leaf.cellIndex !== undefined && leaf.cellIndex !== index)
      || level === EMPTY_CELL_STATE
    ) return false;
    if (!this.subdivisionTrees[index]) this.subdivisionTrees[index] = new Set();
    if (this.subdivisionTrees[index].has(leaf.key)) return false;
    this.subdivisionTrees[index].add(leaf.key);
    if (this.leafCaches) this.leafCaches[index] = null;
    this.hoveredSubdivisionLeaf = null;
    this.announceSubdivision(index, leaf);
    return {
      index,
      key: leaf.key,
      childLevel: leaf.level + 1,
      splitCount: this.subdivisionTrees[index].size,
    };
  }

  announceSubdivision(index, leaf) {
    const documentRef = this.runtime?.document?.()
      ?? (typeof document !== "undefined" ? document : null);
    const announcer = this.runtime?.announcer?.()
      ?? documentRef?.getElementById?.("grid-announcer");
    if (!announcer) return;
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    announcer.textContent = `Row ${row + 1}, column ${column + 1}: circle split into four level ${leaf.level + 1} children.`;
  }

  centerCellIndex() {
    const row = Math.floor(this.layout.rows * 0.5);
    const column = Math.floor(this.layout.columns * 0.5);
    return row * this.layout.columns + column;
  }

  moveKeyboardFocus(key) {
    if (this.focusedCell < 0) this.focusedCell = this.centerCellIndex();
    let row = Math.floor(this.focusedCell / this.layout.columns);
    let column = this.focusedCell % this.layout.columns;
    if (key === "ArrowLeft") column -= 1;
    if (key === "ArrowRight") column += 1;
    if (key === "ArrowUp") row -= 1;
    if (key === "ArrowDown") row += 1;
    row = Math.max(0, Math.min(this.layout.rows - 1, row));
    column = Math.max(0, Math.min(this.layout.columns - 1, column));
    this.focusedCell = row * this.layout.columns + column;
    this.announceFocusedCell();
    return this.focusedCell;
  }

  announceFocusedCell() {
    if (this.focusedCell < 0) return;
    const documentRef = this.runtime?.document?.()
      ?? (typeof document !== "undefined" ? document : null);
    const announcer = this.runtime?.announcer?.()
      ?? documentRef?.getElementById?.("grid-announcer");
    if (!announcer) return;
    const row = Math.floor(this.focusedCell / this.layout.columns);
    const column = this.focusedCell % this.layout.columns;
    const state = this.baseStates[this.focusedCell];
    const stateLabel = state === EMPTY_CELL_STATE ? "empty" : SIZE_LABELS[state];
    announcer.textContent = `Row ${row + 1}, column ${column + 1}: ${stateLabel}.`;
  }

  seedPattern() {
    if (!this.layout) return;
    if (!(this.sessionCellStates instanceof Map)) this.sessionCellStates = new Map();
    this.sessionCellStates.clear();
    if (!(this.flickeringCellKeys instanceof Set)) this.flickeringCellKeys = new Set();
    this.flickeringCellKeys.clear();
    const sequence = [...INTERACTIVE_SIZE_LEVELS, EMPTY_CELL_STATE];
    for (let row = 0; row < this.layout.rows; row += 1) {
      for (let column = 0; column < this.layout.columns; column += 1) {
        const index = row * this.layout.columns + column;
        this.baseStates[index] = sequence[modulo(column + row * 2, sequence.length)];
      }
    }
    for (const tree of this.subdivisionTrees) tree.clear();
    this.leafCaches = Array.from({ length: this.baseStates.length }, () => null);
    this.hoveredSubdivisionLeaf = null;
    this.rememberVisibleSessionCellStates();
    this.persistSessionCellStates();
  }

  clear() {
    if (!(this.sessionCellStates instanceof Map)) this.sessionCellStates = new Map();
    this.sessionCellStates.clear();
    if (!(this.flickeringCellKeys instanceof Set)) this.flickeringCellKeys = new Set();
    this.flickeringCellKeys.clear();
    this.baseStates.fill(EMPTY_CELL_STATE);
    for (const tree of this.subdivisionTrees) tree.clear();
    this.leafCaches = Array.from({ length: this.baseStates.length }, () => null);
    this.hoveredSubdivisionLeaf = null;
    this.rememberVisibleSessionCellStates();
    this.persistSessionCellStates();
  }

  rememberSessionCellState(index) {
    if (
      !this.layout
      || !Number.isInteger(index)
      || index < 0
      || index >= this.baseStates.length
    ) return false;
    if (!(this.sessionCellStates instanceof Map)) this.sessionCellStates = new Map();
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    const centeredColumn = column - Math.floor(this.layout.columns * 0.5);
    const centeredRow = row - Math.floor(this.layout.rows * 0.5);
    this.sessionCellStates.set(
      centeredCellKey(centeredColumn, centeredRow),
      this.baseStates[index],
    );
    return true;
  }

  rememberVisibleSessionCellStates(layout = this.layout, states = this.baseStates) {
    if (!layout || !states) return;
    if (!(this.sessionCellStates instanceof Map)) this.sessionCellStates = new Map();
    for (let row = 0; row < layout.rows; row += 1) {
      for (let column = 0; column < layout.columns; column += 1) {
        const index = row * layout.columns + column;
        const centeredColumn = column - Math.floor(layout.columns * 0.5);
        const centeredRow = row - Math.floor(layout.rows * 0.5);
        this.sessionCellStates.set(
          centeredCellKey(centeredColumn, centeredRow),
          states[index],
        );
      }
    }
  }

  projectSessionCellStates() {
    if (!this.layout) return;
    if (!(this.sessionCellStates instanceof Map)) this.sessionCellStates = new Map();
    for (let row = 0; row < this.layout.rows; row += 1) {
      for (let column = 0; column < this.layout.columns; column += 1) {
        const centeredColumn = column - Math.floor(this.layout.columns * 0.5);
        const centeredRow = row - Math.floor(this.layout.rows * 0.5);
        const state = this.sessionCellStates.get(
          centeredCellKey(centeredColumn, centeredRow),
        );
        if (state !== undefined) {
          this.baseStates[row * this.layout.columns + column] = state;
        }
      }
    }
  }

  restoreSessionCellStates() {
    if (!this.sessionStorage || !this.layout) return false;
    let serialized;
    try {
      serialized = this.sessionStorage.getItem(INTERACTIVE_GRID_SESSION_STORAGE_KEY);
    } catch {
      return false;
    }
    if (serialized === null) return false;
    const restored = parseSessionCellStates(
      serialized,
      Math.max(this.layout.columns, this.layout.rows),
    );
    if (!restored) {
      try {
        this.sessionStorage.removeItem?.(INTERACTIVE_GRID_SESSION_STORAGE_KEY);
      } catch {
        // Storage is best-effort; rendering must survive privacy/quota failures.
      }
      return false;
    }
    this.sessionCellStates = restored.states;
    this.flickeringCellKeys = restored.flickeringCells;
    this.projectSessionCellStates();
    return true;
  }

  persistSessionCellStates() {
    if (!this.sessionStorage || !this.layout) return false;
    const longSideCells = Math.max(this.layout.columns, this.layout.rows);
    const halfLongSide = Math.floor(longSideCells * 0.5);
    const cells = [];
    for (let row = -halfLongSide; row <= halfLongSide; row += 1) {
      for (let column = -halfLongSide; column <= halfLongSide; column += 1) {
        const key = centeredCellKey(column, row);
        if (!this.sessionCellStates.has(key)) continue;
        cells.push({
          column,
          row,
          state: this.sessionCellStates.get(key),
          ...(this.flickeringCellKeys?.has(key) ? { flicker: true } : {}),
        });
      }
    }
    try {
      this.sessionStorage.setItem(
        INTERACTIVE_GRID_SESSION_STORAGE_KEY,
        JSON.stringify({
          version: INTERACTIVE_GRID_SESSION_VERSION,
          longSideCells,
          cells,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  update(frame) {
    this.hoveredCell = frame.pointer?.active
      ? interactiveCellIndexAt(this.layout, frame.pointer.x, frame.pointer.y)
      : -1;
    this.hoveredSubdivisionLeaf = this.hoveredCell >= 0 && frame.pointer?.active
      ? this.subdivisionLeafAt(
        this.hoveredCell,
        frame.pointer.x,
        frame.pointer.y,
      )
      : null;
    const time = Number.isFinite(frame.time) ? frame.time : 0;
    const duration = this.animationDuration();
    const cyclePosition = duration > 0 ? time / duration : 0;
    this.flicker?.beginFrame({
      time,
      progress: cyclePosition - Math.floor(cyclePosition),
      cycleIndex: Math.floor(cyclePosition),
    });
  }

  ensureColorTransitionPlans(step) {
    const count = this.layout.columns * this.layout.rows;
    if (step !== this.colorTransitionStep) {
      this.colorTransitionPlans = Array.from(
        { length: count },
        (_, index) => rollInteractiveCellColorTransition(
          this.transitionRandom(step, index),
        ),
      );
      this.colorTransitionStep = step;
      return;
    }
    if (this.colorTransitionPlans.length !== count) {
      this.colorTransitionPlans.length = count;
    }
    for (let index = 0; index < count; index += 1) {
      if (!this.colorTransitionPlans[index]) {
        this.colorTransitionPlans[index] = rollInteractiveCellColorTransition(
          this.transitionRandom(step, index),
        );
      }
    }
  }

  transitionRandom(step, cellIndex) {
    const projectSeed = Number(this.projectSeed?.());
    if (!Number.isInteger(projectSeed)) return this.random;
    const base = (
      (projectSeed >>> 0)
      ^ Math.imul(Math.trunc(step) + 1, 0x9e3779b1)
      ^ Math.imul(cellIndex + 1, 0x85ebca6b)
    ) >>> 0;
    let callIndex = 0;
    return () => {
      callIndex += 1;
      return hashUnit(base ^ Math.imul(callIndex, 0xc2b2ae35));
    };
  }

  flickerGrid() {
    if (this.flicker.scope === "cell") {
      return {
        columns: 1,
        rows: 1,
        cellSize: this.layout.cellSize,
        dotsPerCellAxis: FLICKER_DOTS_PER_CELL_AXIS,
      };
    }
    return {
      columns: this.layout.columns,
      rows: this.layout.rows,
      cellSize: this.layout.cellSize,
      dotsPerCellAxis: FLICKER_DOTS_PER_CELL_AXIS,
    };
  }

  flickerTimeFor(index, time) {
    if (this.flicker.scope !== "cell" || this.flicker.cellStaggerSeconds === 0) {
      return time;
    }
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    const centeredRow = row - Math.floor(this.layout.rows * 0.5);
    const centeredColumn = column - Math.floor(this.layout.columns * 0.5);
    const seed = Math.imul(centeredColumn + 257, 0x9e3779b1)
      ^ Math.imul(centeredRow + 257, 0x85ebca6b);
    return time + hashUnit(seed) * this.flicker.cellStaggerSeconds;
  }

  flickerPaletteIndicesForLeaves(index, level, leaves, time) {
    const parentColumn = index % this.layout.columns;
    const parentRow = Math.floor(index / this.layout.columns);
    const originX = this.flicker.scope === "cell"
      ? 0
      : parentColumn * FLICKER_DOTS_PER_CELL_AXIS;
    const originY = this.flicker.scope === "cell"
      ? 0
      : parentRow * FLICKER_DOTS_PER_CELL_AXIS;
    const baseIndex = sharpPaletteIndexAt(
      time,
      this.options.colorCycleSeconds,
      this.paletteColors.length,
      level,
    );
    return flickerPaletteIndicesAtCoordinates({
      flicker: this.flicker,
      coordinates: leaves.map(leaf => ({
        x: originX + (leaf.x + 0.5) * FLICKER_DOTS_PER_CELL_AXIS,
        y: originY + (leaf.y + 0.5) * FLICKER_DOTS_PER_CELL_AXIS,
      })),
      time: this.flickerTimeFor(index, time),
      basePosition: baseIndex / Math.max(1, this.paletteColors.length - 1),
    });
  }

  leavesForCell(index, level) {
    if (!this.leafCaches) {
      const count = Math.max(
        index + 1,
        this.baseStates?.length ?? 0,
        this.subdivisionTrees?.length ?? 0,
      );
      this.leafCaches = Array.from({ length: count }, () => null);
    }
    const splitNodes = this.subdivisionTrees[index] ?? NO_SUBDIVISION_NODES;
    const cached = this.leafCaches[index];
    if (
      cached
      && cached.level === level
      && cached.splitCount === splitNodes.size
    ) return cached;

    const leaves = [];
    visitSubdivisionLeaves(level, splitNodes, leaf => leaves.push(leaf));
    const next = {
      level,
      splitCount: splitNodes.size,
      leaves,
      sequences: new Map(),
    };
    this.leafCaches[index] = next;
    return next;
  }

  sequenceForCell(index, level, transition) {
    const cache = this.leavesForCell(index, level);
    const key = `${transition.pattern}:${transition.direction ?? ""}`;
    if (!cache.sequences.has(key)) {
      cache.sequences.set(
        key,
        colorTransitionSequenceForLeaves(cache.leaves, transition),
      );
    }
    return {
      leaves: cache.leaves,
      ...cache.sequences.get(key),
    };
  }

  leafColorTransitionState(
    transitionState,
    position,
    bandCount,
    noiseSeed,
    leafIndex = 0,
  ) {
    if (!transitionState.transitioning) return transitionState;
    const staggerPosition = Number.isInteger(noiseSeed)
      ? organicPositionAt(position, noiseSeed, leafIndex)
      : position;
    let linearProgress = staggeredColorProgressAt(
      transitionState.linearProgress,
      staggerPosition,
      bandCount,
    );
    if (Number.isInteger(noiseSeed)) {
      linearProgress = organicProgressAt(linearProgress, noiseSeed, leafIndex);
    }
    return {
      previousIndex: transitionState.previousIndex,
      currentIndex: transitionState.currentIndex,
      linearProgress,
      progress: cubicBezierAt(
        linearProgress,
        this.colorTransition.timingCurve ?? DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
      ),
      transitioning: linearProgress < 1,
    };
  }

  draw(frame, planEntry, context) {
    const { columns, rows, cellSize, offsetX, offsetY } = this.layout;
    const customEndpoint = frame?.compositionEndpoint?.phase === "end"
      ? this.endCompositionEndpoint
      : null;
    if (customEndpoint) {
      this.drawCustomCompositionEndpoint(context, customEndpoint, frame);
      if (frame?.showCellGrid === true) drawCellGridGuides(context, this.layout);
      return;
    }
    this.circleEndpointActive = this.circleEndpoint?.prepare?.(
      frame?.compositionEndpoint,
      this.endpointTransitionItems(),
      this.layout,
    ) ?? false;
    this.ensureColorTransitionPlans(paletteStepAt(
      frame.time,
      this.options.colorCycleSeconds,
      this.paletteColors.length,
    ));
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const level = this.baseStates[index];
        if (level === EMPTY_CELL_STATE) continue;

        const centerX = offsetX + (column + 0.5) * cellSize;
        const centerY = offsetY + (row + 0.5) * cellSize;
        context.save();
        context.translate(centerX, centerY);
        this.drawSubdivideCell(context, index, level, cellSize, frame.time);
        context.restore();
      }
    }

    if (
      !frame?.exporting
      && (this.options.showCellGrid || frame?.showCellGrid === true)
    ) {
      drawCellGridGuides(context, this.layout, {
        strokeStyle: frame?.showCellGrid === true
          ? "rgba(255, 70, 95, 0.42)"
          : "rgba(6, 20, 38, 0.08)",
      });
    }
    if (!frame?.exporting && this.hoveredCell >= 0 && !this.hoveredSubdivisionLeaf) {
      this.drawHover(context, this.hoveredCell);
    }
    if (!frame?.exporting && this.hoveredSubdivisionLeaf) {
      this.drawSubdivisionHover(context, this.hoveredSubdivisionLeaf);
    }
  }

  drawSubdivideCell(context, index, level, cellSize, time) {
    const marginScale = this.marginScale();
    const baseTransitionState = paletteSlideStateAt(
      time,
      this.options.colorCycleSeconds,
      this.colorTransition.durationSeconds,
      this.paletteColors.length,
      level,
      this.colorTransition.timingCurve,
    );
    const transitionState = paletteTourStateAt(
      baseTransitionState,
      this.paletteColors.length,
      this.colorTransition.cycleThroughPalette ?? false,
      this.colorTransition.timingCurve,
    );
    const transition = this.colorTransitionPlans?.[index]
      ?? { pattern: "snake", direction: null };
    const sequence = this.sequenceForCell(index, level, transition);
    const noiseSeed = this.colorTransition.noise
      ? transitionNoiseSeed(this.colorTransitionStep, index)
      : undefined;

    if (this.flicker?.enabled && this.isCellFlickering(index)) {
      const paletteIndices = this.flickerPaletteIndicesForLeaves(
        index,
        level,
        sequence.leaves,
        time,
      );
      sequence.leaves.forEach((leaf, leafIndex) => {
        const x = leaf.x * cellSize;
        const y = leaf.y * cellSize;
        this.drawWithEndpointPresentation(
          context,
          x,
          y,
          this.endpointPresentationFor(index, leaf),
          () => this.drawSolidColorGlyph(
            context,
            x,
            y,
            leaf.halfSize * cellSize * marginScale,
            paletteIndices[leafIndex],
          ),
        );
      });
      return;
    }

    if (transition.pattern === "waterfall" && transitionState.transitioning) {
      this.drawConnectFourColorTrace(
        context,
        index,
        sequence,
        cellSize,
        marginScale,
        transitionState,
        noiseSeed,
      );
      return;
    }

    sequence.leaves.forEach((leaf, leafIndex) => {
      const leafState = this.leafColorTransitionState(
        transitionState,
        sequence.positions[leafIndex],
        sequence.bandCount,
        noiseSeed,
        leafIndex,
      );
      const x = leaf.x * cellSize;
      const y = leaf.y * cellSize;
      this.drawWithEndpointPresentation(
        context,
        x,
        y,
        this.endpointPresentationFor(index, leaf),
        () => this.drawColorTransitionGlyph(
          context,
          x,
          y,
          leaf.halfSize * cellSize,
          leaf.halfSize * cellSize * marginScale,
          leafState,
        ),
      );
    });
  }

  endpointTransitionItems() {
    const items = [];
    const { columns, cellSize, offsetX, offsetY } = this.layout;
    for (let index = 0; index < this.baseStates.length; index += 1) {
      const level = this.baseStates[index];
      if (level === EMPTY_CELL_STATE) continue;
      const row = Math.floor(index / columns);
      const column = index % columns;
      const centerX = offsetX + (column + 0.5) * cellSize;
      const centerY = offsetY + (row + 0.5) * cellSize;
      for (const leaf of this.leavesForCell(index, level).leaves) {
        items.push({
          id: `${index}:${leaf.key}`,
          x: centerX + leaf.x * cellSize,
          y: centerY + leaf.y * cellSize,
          size: leaf.halfSize * cellSize * 2,
        });
      }
    }
    return items;
  }

  compositionEndpointScene() {
    const endpointCellIndices = [];
    const faces = Array.from(this.baseStates, level => ({ level }));
    for (let index = 0; index < this.baseStates.length; index += 1) {
      if (this.baseStates[index] !== EMPTY_CELL_STATE) endpointCellIndices.push(index);
    }
    return { endpointCellIndices, faces };
  }

  drawCustomCompositionEndpoint(context, endpoint, frame) {
    const endpointFrame = endpoint.frameAt({
      layout: this.layout,
      scene: this.compositionEndpointScene(),
      cycleIndex: frame.compositionEndpoint.cycleIndex,
      progress: frame.compositionEndpoint.progress,
    });
    drawCompositionEndpointFrame(context, endpointFrame, {
      dotMargin: this.options.dotMargin,
      colorForGlyph: ({ paletteStep }) => compositionEndpointPaletteColor(
        this.paletteColors,
        paletteStep,
      ),
    });
  }

  endpointPresentationFor(index, leaf) {
    return this.circleEndpointActive
      ? this.circleEndpoint.presentationsFor(`${index}:${leaf.key}`)
      : IDENTITY_ENDPOINT_PRESENTATION;
  }

  drawWithEndpointPresentation(context, x, y, presentation, draw) {
    if (Array.isArray(presentation)) {
      for (const item of presentation) {
        this.drawWithEndpointPresentation(context, x, y, item, draw);
      }
      return;
    }
    if (presentation.opacity <= 0 || presentation.scale <= 0) return;
    if (
      presentation.opacity === 1
      && presentation.scale === 1
      && presentation.offsetX === 0
      && presentation.offsetY === 0
    ) {
      draw();
      return;
    }
    context.save();
    const inheritedAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    context.globalAlpha = inheritedAlpha * presentation.opacity;
    context.translate(presentation.offsetX, presentation.offsetY);
    if (presentation.scale !== 1) {
      context.translate(x, y);
      context.scale(presentation.scale, presentation.scale);
      context.translate(-x, -y);
    }
    draw();
    context.restore();
  }

  drawColorTransitionGlyph(context, x, y, boxHalfSize, circleHalfSize, state) {
    this.drawSlidingGlyph(context, x, y, boxHalfSize, circleHalfSize, state);
  }

  drawSolidColorGlyph(context, x, y, circleHalfSize, colorIndex) {
    context.fillStyle = this.paletteColors[colorIndex];
    context.beginPath();
    this.shapeRenderer.addPath(
      context,
      x,
      y,
      circleHalfSize,
      1,
      IDENTITY_GLYPH_TRANSFORM,
    );
    context.fill();
  }

  drawConnectFourColorTrace(
    context,
    index,
    sequence,
    cellSize,
    marginScale,
    transitionState,
    noiseSeed,
  ) {
    const mixes = connectFourColorMixesAt(
      sequence,
      transitionState.linearProgress,
      this.colorTransition.timingCurve ?? DEFAULT_INTERACTIVE_COLOR_TIMING_CURVE,
      noiseSeed,
    );

    sequence.leaves.forEach((leaf, leafIndex) => {
      const mix = mixes[leafIndex];
      const x = leaf.x * cellSize;
      const y = leaf.y * cellSize;
      const circleHalfSize = leaf.halfSize * cellSize * marginScale;
      this.drawWithEndpointPresentation(
        context,
        x,
        y,
        this.endpointPresentationFor(index, leaf),
        () => {
          if (mix <= 0) {
            this.drawSolidColorGlyph(
              context,
              x,
              y,
              circleHalfSize,
              transitionState.previousIndex,
            );
            return;
          }
          if (mix >= 1) {
            this.drawSolidColorGlyph(
              context,
              x,
              y,
              circleHalfSize,
              transitionState.currentIndex,
            );
            return;
          }

          this.drawSolidColorGlyph(
            context,
            x,
            y,
            circleHalfSize,
            transitionState.previousIndex,
          );
          context.save();
          const inheritedAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
          context.globalAlpha = inheritedAlpha * mix;
          this.drawSolidColorGlyph(
            context,
            x,
            y,
            circleHalfSize,
            transitionState.currentIndex,
          );
          context.restore();
        },
      );
    });
  }

  drawSlidingGlyph(context, x, y, boxHalfSize, circleHalfSize, slide) {
    if (!slide.transitioning) {
      context.fillStyle = this.paletteColors[slide.currentIndex];
      context.beginPath();
      this.shapeRenderer.addPath(
        context,
        x,
        y,
        circleHalfSize,
        1,
        IDENTITY_GLYPH_TRANSFORM,
      );
      context.fill();
      return;
    }

    const boxSize = boxHalfSize * 2;
    const offset = -boxSize * (1 - slide.progress);
    context.save();
    context.beginPath();
    context.arc(x, y, circleHalfSize, 0, Math.PI * 2);
    context.clip();

    context.fillStyle = this.paletteColors[slide.previousIndex];
    context.beginPath();
    this.shapeRenderer.addPath(
      context,
      x,
      y,
      circleHalfSize,
      1,
      IDENTITY_GLYPH_TRANSFORM,
    );
    context.fill();

    context.fillStyle = this.paletteColors[slide.currentIndex];
    context.beginPath();
    this.shapeRenderer.addPath(
      context,
      x + offset,
      y + offset,
      circleHalfSize,
      1,
      IDENTITY_GLYPH_TRANSFORM,
    );
    context.fill();

    context.restore();
  }

  marginScale() {
    return 1 - Math.max(0, Math.min(0.95, Number(this.options.dotMargin) || 0));
  }

  drawHover(context, index) {
    const row = Math.floor(index / this.layout.columns);
    const column = index % this.layout.columns;
    const inset = 2;
    context.save();
    context.strokeStyle = "rgba(6, 20, 38, 0.52)";
    context.lineWidth = 2;
    context.strokeRect(
      this.layout.offsetX + column * this.layout.cellSize + inset,
      this.layout.offsetY + row * this.layout.cellSize + inset,
      this.layout.cellSize - inset * 2,
      this.layout.cellSize - inset * 2,
    );
    context.restore();
  }

  drawSubdivisionHover(context, leaf) {
    context.save();
    context.strokeStyle = "rgba(46, 126, 198, 0.92)";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(
      leaf.centerX,
      leaf.centerY,
      Math.max(2, leaf.radius + 2),
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.restore();
  }

  resize(viewport) {
    const previousLayout = this.layout;
    const previousStates = this.baseStates;
    const previousTrees = this.subdivisionTrees;
    const previousPlans = this.colorTransitionPlans;
    const nextLayout = createInteractiveGridLayout(this.options, viewport);
    const nextCount = nextLayout.columns * nextLayout.rows;
    const nextStates = new Int8Array(nextCount);
    nextStates.fill(EMPTY_CELL_STATE);
    const nextTrees = Array.from({ length: nextCount }, () => new Set());
    const nextPlans = Array.from({ length: nextCount }, () => null);

    if (previousLayout && previousStates.length > 0) {
      this.rememberVisibleSessionCellStates(previousLayout, previousStates);
    }

    if (previousLayout && previousStates.length > 0) {
      const columnOffset = (previousLayout.columns - nextLayout.columns) / 2;
      const rowOffset = (previousLayout.rows - nextLayout.rows) / 2;
      for (let row = 0; row < nextLayout.rows; row += 1) {
        for (let column = 0; column < nextLayout.columns; column += 1) {
          // Layout dimensions are odd, so their centre cell is a stable
          // anchor. Copy only the centred overlap: normalized resampling would
          // duplicate some authored cells and silently replace others.
          const oldColumn = column + columnOffset;
          const oldRow = row + rowOffset;
          if (
            !Number.isInteger(oldColumn)
            || !Number.isInteger(oldRow)
            || oldColumn < 0
            || oldColumn >= previousLayout.columns
            || oldRow < 0
            || oldRow >= previousLayout.rows
          ) continue;
          const nextIndex = row * nextLayout.columns + column;
          const oldIndex = oldRow * previousLayout.columns + oldColumn;
          nextStates[nextIndex] = previousStates[oldIndex];
          nextTrees[nextIndex] = new Set(previousTrees[oldIndex] ?? []);
          nextPlans[nextIndex] = previousPlans?.[oldIndex] ?? null;
        }
      }
    }

    this.layout = nextLayout;
    this.baseStates = nextStates;
    this.subdivisionTrees = nextTrees;
    this.leafCaches = Array.from({ length: nextCount }, () => null);
    this.colorTransitionPlans = nextPlans;
    this.focusedCell = -1;
    this.hoveredCell = -1;
    this.hoveredSubdivisionLeaf = null;
    this.flicker.resize(this.flickerGrid());
    if (!previousLayout) {
      if (!this.restoreSessionCellStates()) this.seedPattern();
    } else {
      this.projectSessionCellStates();
      this.rememberVisibleSessionCellStates();
      this.persistSessionCellStates();
    }
  }

  contentBounds() {
    return {
      x: this.layout.offsetX,
      y: this.layout.offsetY,
      width: this.layout.patternWidth,
      height: this.layout.patternHeight,
    };
  }

  animationDuration() {
    return this.options.colorCycleSeconds;
  }

  snapshotProjectState() {
    this.rememberVisibleSessionCellStates();
    const sessionCells = [];
    for (const [key, state] of this.sessionCellStates) {
      const match = /^(-?\d+):(-?\d+)$/.exec(key);
      if (!match) continue;
      sessionCells.push({
        column: Number(match[1]),
        row: Number(match[2]),
        state,
        ...(this.flickeringCellKeys?.has(key) ? { flicker: true } : {}),
      });
    }
    const cells = [];
    for (let row = 0; row < this.layout.rows; row += 1) {
      for (let column = 0; column < this.layout.columns; column += 1) {
        const index = row * this.layout.columns + column;
        cells.push({
          column: column - Math.floor(this.layout.columns * 0.5),
          row: row - Math.floor(this.layout.rows * 0.5),
          state: this.baseStates[index],
          splits: [...(this.subdivisionTrees[index] ?? [])],
          transitionPlan: this.colorTransitionPlans[index]
            ? { ...this.colorTransitionPlans[index] }
            : null,
          ...(this.isCellFlickering(index) ? { flicker: true } : {}),
        });
      }
    }
    return {
      version: 1,
      colorTransitionStep: this.colorTransitionStep,
      sessionCells,
      cells,
    };
  }

  restoreProjectState(snapshot) {
    if (
      !snapshot
      || snapshot.version !== 1
      || !Array.isArray(snapshot.cells)
      || snapshot.cells.length > MAX_PROJECT_CELLS
      || (
        snapshot.sessionCells !== undefined
        && (!Array.isArray(snapshot.sessionCells)
          || snapshot.sessionCells.length > MAX_PROJECT_CELLS)
      )
      || !Object.hasOwn(snapshot, "colorTransitionStep")
      || (
        snapshot.colorTransitionStep !== null
        && !Number.isSafeInteger(snapshot.colorTransitionStep)
      )
    ) return false;
    const nextSessionStates = new Map();
    const nextFlickeringCellKeys = new Set();
    for (const cell of snapshot.sessionCells ?? snapshot.cells) {
      if (
        !Number.isSafeInteger(cell?.column)
        || !Number.isSafeInteger(cell?.row)
        || !isOptionalBoolean(cell.flicker)
        || (cell.state !== EMPTY_CELL_STATE && !INTERACTIVE_SIZE_LEVELS.includes(cell.state))
      ) return false;
      const key = centeredCellKey(cell.column, cell.row);
      if (nextSessionStates.has(key)) return false;
      nextSessionStates.set(key, cell.state);
      if (cell.flicker === true) nextFlickeringCellKeys.add(key);
    }
    const byCoordinate = new Map();
    for (const cell of snapshot.cells) {
      if (
        !Number.isSafeInteger(cell?.column)
        || !Number.isSafeInteger(cell?.row)
        || !Number.isInteger(cell?.state)
        || !isOptionalBoolean(cell.flicker)
        || (cell.state !== EMPTY_CELL_STATE && !INTERACTIVE_SIZE_LEVELS.includes(cell.state))
      ) return false;
      const key = centeredCellKey(cell.column, cell.row);
      if (byCoordinate.has(key)) return false;
      const splits = normalizedSplitKeys(cell.splits);
      if (!splits) return false;
      const transitionPlan = cell.transitionPlan === null
        ? null
        : normalizedTransitionPlan(cell.transitionPlan);
      if (cell.transitionPlan !== null && !transitionPlan) return false;
      byCoordinate.set(key, {
        column: cell.column,
        row: cell.row,
        state: cell.state,
        splits,
        transitionPlan,
      });
    }
    this.sessionCellStates = nextSessionStates;
    this.flickeringCellKeys = nextFlickeringCellKeys;
    this.baseStates.fill(EMPTY_CELL_STATE);
    for (const tree of this.subdivisionTrees) tree.clear();
    this.colorTransitionPlans.fill(null);
    this.projectSessionCellStates();
    for (let row = 0; row < this.layout.rows; row += 1) {
      for (let column = 0; column < this.layout.columns; column += 1) {
        const index = row * this.layout.columns + column;
        const centeredColumn = column - Math.floor(this.layout.columns * 0.5);
        const centeredRow = row - Math.floor(this.layout.rows * 0.5);
        const cell = byCoordinate.get(centeredCellKey(centeredColumn, centeredRow));
        if (!cell) continue;
        this.baseStates[index] = cell.state;
        this.subdivisionTrees[index] = new Set(cell.splits);
        this.colorTransitionPlans[index] = cell.transitionPlan
          ? { ...cell.transitionPlan }
          : null;
      }
    }
    this.colorTransitionStep = Number.isInteger(snapshot.colorTransitionStep)
      ? snapshot.colorTransitionStep
      : null;
    this.leafCaches = Array.from({ length: this.baseStates.length }, () => null);
    this.hoveredCell = -1;
    this.hoveredSubdivisionLeaf = null;
    this.focusedCell = -1;
    this.rememberVisibleSessionCellStates();
    this.persistSessionCellStates();
    return true;
  }

  inspect() {
    return {
      type: "interactive-grid",
      colorTransitionMode: this.colorTransition.mode,
      colorTransitionCycleThroughPalette: this.colorTransition.cycleThroughPalette,
      colorTransitionNoise: this.colorTransition.noise,
      colorTransitionStep: this.colorTransitionStep,
      colorTransitionPlans: this.colorTransitionPlans.map(plan => plan
        ? { ...plan }
        : null),
      ...this.layout,
      baseStates: this.baseStates,
      hoveredCell: this.hoveredCell,
      hoveredSubdivisionLeaf: this.hoveredSubdivisionLeaf,
      focusedCell: this.focusedCell,
      flicker: this.flicker.inspect(),
      flickeringCells: Array.from(
        { length: this.baseStates.length },
        (_, index) => this.isCellFlickering(index),
      ),
      subdivisionSplitCounts: this.subdivisionTrees.map(tree => tree.size),
      compositionEndpoint: this.endCompositionEndpoint?.inspect?.() ?? null,
    };
  }

  dispose() {
    this.circleEndpoint.reset();
    this.endCompositionEndpoint?.reset();
    this.baseStates = new Int8Array();
    this.subdivisionTrees = [];
    this.leafCaches = [];
    this.colorTransitionPlans = [];
    this.flickeringCellKeys.clear();
  }
}

export default InteractiveGridGenerator;
