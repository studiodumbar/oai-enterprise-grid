import { emptyGridFace } from "./grid-scene-strategies.js";

export const PATHFINDING_STRATEGIES = Object.freeze([
  "bfs",
  "dijkstra",
  "a-star",
]);

const DEFAULT_OBSTACLE_DENSITY = 0.16;
const DEFAULT_MAXIMUM_TRAVERSAL_COST = 4;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function hashUnit(first, second, third = 0) {
  let value = Math.imul((first | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul((second | 0) ^ 0xc2b2ae35, 0x27d4eb2f);
  value ^= Math.imul((third | 0) ^ 0x165667b1, 0x9e3779b1);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function requirePathfindingStrategy(strategy) {
  if (!PATHFINDING_STRATEGIES.includes(strategy)) {
    throw new Error(
      `Unknown pathfinding strategy "${strategy}". Available strategies: `
      + `${PATHFINDING_STRATEGIES.join(", ")}.`,
    );
  }
  return strategy;
}

function gridDimensions(layout) {
  const columns = layout?.columns;
  const rows = layout?.rows;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new RangeError("Pathfinding layout columns must be a positive integer.");
  }
  if (!Number.isInteger(rows) || rows < 1) {
    throw new RangeError("Pathfinding layout rows must be a positive integer.");
  }
  return { columns, rows, cellCount: columns * rows };
}

function requireCellIndex(index, cellCount, label) {
  if (!Number.isInteger(index) || index < 0 || index >= cellCount) {
    throw new RangeError(`${label} must be an index from 0 to ${cellCount - 1}.`);
  }
  return index;
}

function sortedUniqueIndices(indices, cellCount, label) {
  if (indices === undefined || indices === null) return [];
  if (!Array.isArray(indices) && !ArrayBuffer.isView(indices)) {
    throw new TypeError(`${label} must be an array or typed array of cell indices.`);
  }
  const unique = new Set();
  for (const index of indices) {
    requireCellIndex(index, cellCount, `${label} entry`);
    unique.add(index);
  }
  return [...unique].sort((first, second) => first - second);
}

function normalizedTraversalCosts(costs, cellCount) {
  if (costs === undefined || costs === null) return new Array(cellCount).fill(1);
  if (
    (!Array.isArray(costs) && !ArrayBuffer.isView(costs))
    || costs.length !== cellCount
  ) {
    throw new RangeError(`traversalCosts must contain ${cellCount} entries.`);
  }
  return Array.from(costs, (cost, index) => {
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new RangeError(`traversalCosts[${index}] must be a finite positive number.`);
    }
    return cost;
  });
}

/**
 * Returns fixed-grid orthogonal neighbours in ascending cell-index order.
 * Sorting here defines the deterministic tie break used by every strategy.
 */
export function orthogonalGridNeighbors(layout, index) {
  const { columns, rows, cellCount } = gridDimensions(layout);
  requireCellIndex(index, cellCount, "Pathfinding cell index");
  const row = Math.floor(index / columns);
  const column = index % columns;
  const neighbors = [];
  if (row > 0) neighbors.push(index - columns);
  if (column > 0) neighbors.push(index - 1);
  if (column + 1 < columns) neighbors.push(index + 1);
  if (row + 1 < rows) neighbors.push(index + columns);
  return neighbors.sort((first, second) => first - second);
}

export function manhattanGridDistance(layout, firstIndex, secondIndex) {
  const { columns, cellCount } = gridDimensions(layout);
  requireCellIndex(firstIndex, cellCount, "First pathfinding cell index");
  requireCellIndex(secondIndex, cellCount, "Second pathfinding cell index");
  const firstRow = Math.floor(firstIndex / columns);
  const secondRow = Math.floor(secondIndex / columns);
  return Math.abs(firstRow - secondRow)
    + Math.abs((firstIndex % columns) - (secondIndex % columns));
}

function reconstructPath(predecessors, startIndex, goalIndex) {
  if (startIndex === goalIndex) return [startIndex];
  if (predecessors[goalIndex] < 0) return [];
  const reversed = [];
  let current = goalIndex;
  while (current >= 0) {
    reversed.push(current);
    if (current === startIndex) break;
    current = predecessors[current];
  }
  if (reversed[reversed.length - 1] !== startIndex) return [];
  return reversed.reverse();
}

function traceSnapshot(expandedIndex, visitedIndices, frontierIndices) {
  return {
    expandedIndex,
    visitedIndices: [...visitedIndices],
    frontierIndices: [...frontierIndices],
  };
}

function bfsSearch({
  layout,
  startIndex,
  goalIndex,
  blocked,
  traversalCosts,
}) {
  const cellCount = layout.columns * layout.rows;
  const predecessors = new Int32Array(cellCount);
  predecessors.fill(-1);
  const distances = new Float64Array(cellCount);
  distances.fill(Infinity);
  distances[startIndex] = 0;

  const discovered = new Uint8Array(cellCount);
  discovered[startIndex] = 1;
  const queue = [startIndex];
  let queueHead = 0;
  const visitedIndices = [];
  const trace = [traceSnapshot(null, visitedIndices, queue)];

  while (queueHead < queue.length) {
    const current = queue[queueHead];
    queueHead += 1;
    visitedIndices.push(current);

    if (current !== goalIndex) {
      for (const neighbor of orthogonalGridNeighbors(layout, current)) {
        if (blocked.has(neighbor) || discovered[neighbor]) continue;
        discovered[neighbor] = 1;
        predecessors[neighbor] = current;
        distances[neighbor] = distances[current] + 1;
        queue.push(neighbor);
      }
    }

    trace.push(traceSnapshot(
      current,
      visitedIndices,
      queue.slice(queueHead),
    ));
    if (current === goalIndex) break;
  }

  const pathIndices = reconstructPath(predecessors, startIndex, goalIndex);
  return {
    predecessors,
    distances,
    visitedIndices,
    frontierIndices: trace[trace.length - 1].frontierIndices,
    pathIndices,
    pathCost: pathIndices.length > 0 ? pathIndices.length - 1 : Infinity,
    trace,
    // Keeping the common result shape makes strategy comparisons direct even
    // though BFS intentionally treats every traversable cell as unit cost.
    traversalCosts,
  };
}

function weightedSearch({
  strategy,
  layout,
  startIndex,
  goalIndex,
  blocked,
  traversalCosts,
}) {
  const cellCount = layout.columns * layout.rows;
  const predecessors = new Int32Array(cellCount);
  predecessors.fill(-1);
  const distances = new Float64Array(cellCount);
  distances.fill(Infinity);
  distances[startIndex] = 0;

  const closed = new Uint8Array(cellCount);
  const open = new Set([startIndex]);
  const visitedIndices = [];
  const minimumTraversalCost = traversalCosts.reduce(
    (minimum, cost, index) => (
      blocked.has(index) ? minimum : Math.min(minimum, cost)
    ),
    Infinity,
  );
  const heuristic = index => (
    strategy === "a-star"
      ? manhattanGridDistance(layout, index, goalIndex) * minimumTraversalCost
      : 0
  );
  const compareOpen = (first, second) => (
    (distances[first] + heuristic(first)) - (distances[second] + heuristic(second))
    || distances[first] - distances[second]
    || first - second
  );
  const orderedOpen = () => [...open].sort(compareOpen);
  const trace = [traceSnapshot(null, visitedIndices, orderedOpen())];

  while (open.size > 0) {
    const current = orderedOpen()[0];
    open.delete(current);
    if (closed[current]) continue;
    closed[current] = 1;
    visitedIndices.push(current);

    if (current !== goalIndex) {
      for (const neighbor of orthogonalGridNeighbors(layout, current)) {
        if (blocked.has(neighbor) || closed[neighbor]) continue;
        const candidateDistance = distances[current] + traversalCosts[neighbor];
        if (
          candidateDistance < distances[neighbor]
          || (
            candidateDistance === distances[neighbor]
            && (predecessors[neighbor] < 0 || current < predecessors[neighbor])
          )
        ) {
          distances[neighbor] = candidateDistance;
          predecessors[neighbor] = current;
          open.add(neighbor);
        }
      }
    }

    trace.push(traceSnapshot(current, visitedIndices, orderedOpen()));
    if (current === goalIndex) break;
  }

  const pathIndices = reconstructPath(predecessors, startIndex, goalIndex);
  return {
    predecessors,
    distances,
    visitedIndices,
    frontierIndices: trace[trace.length - 1].frontierIndices,
    pathIndices,
    pathCost: pathIndices.length > 0 ? distances[goalIndex] : Infinity,
    trace,
    traversalCosts,
  };
}

/**
 * Runs a complete deterministic search and records the frontier after each
 * expansion. Costs are paid when entering a cell; the start cell is free.
 */
export function runPathfindingSearch({
  strategy = "bfs",
  layout,
  startIndex = 0,
  goalIndex,
  blockedIndices = [],
  traversalCosts,
} = {}) {
  requirePathfindingStrategy(strategy);
  const { cellCount } = gridDimensions(layout);
  const resolvedGoalIndex = goalIndex ?? cellCount - 1;
  requireCellIndex(startIndex, cellCount, "Pathfinding startIndex");
  requireCellIndex(resolvedGoalIndex, cellCount, "Pathfinding goalIndex");
  const resolvedBlockedIndices = sortedUniqueIndices(
    blockedIndices,
    cellCount,
    "blockedIndices",
  );
  const blocked = new Set(resolvedBlockedIndices);
  if (blocked.has(startIndex) || blocked.has(resolvedGoalIndex)) {
    throw new RangeError("Pathfinding start and goal cells must be traversable.");
  }
  const resolvedTraversalCosts = normalizedTraversalCosts(traversalCosts, cellCount);
  const input = {
    strategy,
    layout,
    startIndex,
    goalIndex: resolvedGoalIndex,
    blocked,
    traversalCosts: resolvedTraversalCosts,
  };
  const result = strategy === "bfs" ? bfsSearch(input) : weightedSearch(input);
  return {
    strategy,
    startIndex,
    goalIndex: resolvedGoalIndex,
    blockedIndices: resolvedBlockedIndices,
    found: result.pathIndices.length > 0,
    ...result,
  };
}

// Descriptive aliases keep the pure helper easy to discover at call sites.
export const searchGridPath = runPathfindingSearch;
export const findGridPath = runPathfindingSearch;

export function pathfindingEndpointsForLayout(layout) {
  const { columns, rows } = gridDimensions(layout);
  if (columns >= rows) {
    const row = Math.floor(rows * 0.5);
    return {
      startIndex: row * columns,
      goalIndex: row * columns + columns - 1,
    };
  }
  const column = Math.floor(columns * 0.5);
  return {
    startIndex: column,
    goalIndex: (rows - 1) * columns + column,
  };
}

function directCorridorIndices(layout, startIndex, goalIndex) {
  const { columns } = gridDimensions(layout);
  const indices = [startIndex];
  let row = Math.floor(startIndex / columns);
  let column = startIndex % columns;
  const goalRow = Math.floor(goalIndex / columns);
  const goalColumn = goalIndex % columns;
  while (row !== goalRow) {
    row += row < goalRow ? 1 : -1;
    indices.push(row * columns + column);
  }
  while (column !== goalColumn) {
    column += column < goalColumn ? 1 : -1;
    indices.push(row * columns + column);
  }
  return indices;
}

/** Creates a reproducible weighted grid while preserving one valid corridor. */
export function createPathfindingProblem({
  layout,
  cycleIndex = 0,
  options = {},
} = {}) {
  const { cellCount } = gridDimensions(layout);
  const endpoints = pathfindingEndpointsForLayout(layout);
  const startIndex = options.startIndex ?? endpoints.startIndex;
  const goalIndex = options.goalIndex ?? endpoints.goalIndex;
  requireCellIndex(startIndex, cellCount, "Pathfinding startIndex");
  requireCellIndex(goalIndex, cellCount, "Pathfinding goalIndex");
  const seed = Math.max(0, Math.floor(Number.isFinite(cycleIndex) ? cycleIndex : 0));

  let blockedIndices;
  if (options.blockedIndices !== undefined) {
    blockedIndices = sortedUniqueIndices(
      options.blockedIndices,
      cellCount,
      "blockedIndices",
    ).filter(index => index !== startIndex && index !== goalIndex);
  } else {
    const obstacleDensity = options.obstacleDensity ?? DEFAULT_OBSTACLE_DENSITY;
    if (
      !Number.isFinite(obstacleDensity)
      || obstacleDensity < 0
      || obstacleDensity >= 1
    ) {
      throw new RangeError("obstacleDensity must be between 0 (inclusive) and 1 (exclusive).");
    }
    const protectedIndices = new Set(
      directCorridorIndices(layout, startIndex, goalIndex),
    );
    const candidates = Array.from({ length: cellCount }, (_, index) => index)
      .filter(index => !protectedIndices.has(index))
      .sort((first, second) => (
        hashUnit(seed, first, 1201) - hashUnit(seed, second, 1201)
        || first - second
      ));
    const obstacleCount = Math.min(
      candidates.length,
      Math.round(obstacleDensity * cellCount),
    );
    blockedIndices = candidates.slice(0, obstacleCount).sort((a, b) => a - b);
  }

  let traversalCosts;
  if (options.traversalCosts !== undefined) {
    traversalCosts = normalizedTraversalCosts(options.traversalCosts, cellCount);
  } else {
    const maximumTraversalCost = options.maximumTraversalCost
      ?? DEFAULT_MAXIMUM_TRAVERSAL_COST;
    if (!Number.isInteger(maximumTraversalCost) || maximumTraversalCost < 1) {
      throw new RangeError("maximumTraversalCost must be a positive integer.");
    }
    traversalCosts = Array.from(
      { length: cellCount },
      (_, index) => 1 + Math.floor(
        hashUnit(seed, index, 1213) * maximumTraversalCost,
      ) % maximumTraversalCost,
    );
  }

  return {
    startIndex,
    goalIndex,
    blockedIndices,
    traversalCosts,
  };
}

export function minimumPathfindingHoldFraction(strategy, stepCount) {
  requirePathfindingStrategy(strategy);
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new RangeError("Pathfinding stepCount must be a positive integer.");
  }
  return 1 / stepCount;
}

function gridFace(level, paletteStep, role) {
  return { level, paletteStep, role };
}

function traceIndexForStep(traceLength, stepIndex, stepCount) {
  if (traceLength <= 1 || stepCount <= 1) return Math.max(0, traceLength - 1);
  if (stepIndex >= stepCount - 1) return traceLength - 1;
  const explorationSteps = Math.max(1, stepCount - 1);
  return Math.min(
    traceLength - 1,
    Math.floor(stepIndex / explorationSteps * (traceLength - 1)),
  );
}

/** Builds one stationary-circle face from a deterministic search trace. */
export function createPathfindingSceneAt({
  strategy = "bfs",
  layout,
  cycleIndex = 0,
  progress = 0,
  options = {},
} = {}) {
  requirePathfindingStrategy(strategy);
  const { cellCount } = gridDimensions(layout);
  const stepCount = options.stepCount ?? options.layerPasses ?? 12;
  if (!Number.isInteger(stepCount) || stepCount < 1) {
    throw new RangeError("Pathfinding stepCount must be a positive integer.");
  }
  const normalizedProgress = clamp01(Number.isFinite(progress) ? progress : 0);
  const stepIndex = Math.min(
    stepCount - 1,
    Math.floor(normalizedProgress * stepCount),
  );
  const problem = createPathfindingProblem({ layout, cycleIndex, options });
  const search = runPathfindingSearch({ strategy, layout, ...problem });
  const traceIndex = traceIndexForStep(search.trace.length, stepIndex, stepCount);
  const trace = search.trace[traceIndex];
  const showsPath = stepIndex === stepCount - 1 && search.found;
  const visiblePathIndices = showsPath ? search.pathIndices : [];
  const phase = stepIndex < stepCount - 1
    ? "search"
    : search.found ? "path" : "unreachable";
  const faces = Array.from(
    { length: cellCount },
    () => gridFace(0, 0, "pathfinding-unvisited"),
  );

  for (const index of problem.blockedIndices) {
    faces[index] = emptyGridFace("pathfinding-obstacle");
  }
  for (const index of trace.visitedIndices) {
    faces[index] = gridFace(0, 1, "pathfinding-visited");
  }
  for (const index of trace.frontierIndices) {
    faces[index] = gridFace(1, 2, "pathfinding-frontier");
  }
  if (trace.expandedIndex !== null) {
    faces[trace.expandedIndex] = gridFace(2, 2, "pathfinding-expanded");
  }
  for (const index of visiblePathIndices) {
    faces[index] = gridFace(2, 3, "pathfinding-path");
  }
  faces[problem.startIndex] = gridFace(
    showsPath ? 2 : 1,
    3,
    "pathfinding-start",
  );
  faces[problem.goalIndex] = gridFace(
    showsPath ? 3 : 1,
    showsPath ? 3 : 2,
    "pathfinding-goal",
  );

  return {
    key: `pathfinding:${strategy}:${Math.max(0, Math.floor(cycleIndex))}:${stepIndex}`,
    phase,
    stepIndex,
    faces,
    strategy,
    found: search.found,
    startIndex: problem.startIndex,
    goalIndex: problem.goalIndex,
    expandedIndex: trace.expandedIndex,
    frontierIndices: [...trace.frontierIndices],
    visitedIndices: [...trace.visitedIndices],
    pathIndices: [...search.pathIndices],
    visiblePathIndices: [...visiblePathIndices],
    pathCost: search.pathCost,
    blockedIndices: [...problem.blockedIndices],
    traversalCosts: [...problem.traversalCosts],
    exploredCount: trace.visitedIndices.length,
    totalExploredCount: search.visitedIndices.length,
    toolEnabled: false,
  };
}

