import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";
import { flickerPaletteIndicesForCell } from "../visuals/flicker/cell-palette.js";

const SNAKE_PATH_SALT = 2089;
const SNAKE_SAFE_PATH_SALT = 4099;
const SNAKE_GLYPH_FILL_SALT = 4127;
const SNAKE_ENGORGEMENT_MOVE_SALT = 4201;
const SNAKE_ENGORGEMENT_PLAN_CACHE = new Map();
const SNAKE_ENGORGEMENT_PLAN_CACHE_LIMIT = 32;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requireFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function resolveCountdownSnakeSettings(appearance, beatSeconds) {
  const authored = requireObject(appearance, "countdownFramed.appearance");
  requireNonNegativeInteger(authored.seed, "countdownFramed.appearance.seed");
  if (typeof authored.evolveSeed !== "boolean") {
    throw new TypeError("countdownFramed.appearance.evolveSeed must be a boolean.");
  }
  const minimumCellDistance = requirePositiveInteger(
    authored.minimumCellDistance,
    "countdownFramed.appearance.minimumCellDistance",
  );
  if (minimumCellDistance < 3) {
    throw new RangeError(
      "countdownFramed.appearance.minimumCellDistance must be at least three.",
    );
  }
  const snake = requireObject(
    authored.effects?.snake,
    "countdownFramed.appearance.effects.snake",
  );
  if (typeof snake.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.enabled must be a boolean.",
    );
  }
  const duration = resolveAutomaticDuration(snake.durationSeconds, {
    label: "countdownFramed.appearance.effects.snake.durationSeconds",
    candidates: [{ source: "composition-beat", seconds: beatSeconds }],
  });
  if (Math.abs(duration.seconds - beatSeconds) > 1e-9) {
    throw new RangeError(
      "countdownFramed.appearance.effects.snake.durationSeconds must equal one composition beat.",
    );
  }
  const lengthCells = requirePositiveInteger(
    snake.lengthCells,
    "countdownFramed.appearance.effects.snake.lengthCells",
  );
  if (typeof snake.growAfterEachTick !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.growAfterEachTick must be a boolean.",
    );
  }
  if (typeof snake.mergeIntoBubbles !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.mergeIntoBubbles must be a boolean.",
    );
  }
  const engorgement = requireObject(
    snake.engorgement,
    "countdownFramed.appearance.effects.snake.engorgement",
  );
  if (typeof engorgement.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.engorgement.enabled must be a boolean.",
    );
  }
  if (engorgement.growthMode !== "linear") {
    throw new RangeError(
      'countdownFramed.appearance.effects.snake.engorgement.growthMode must be "linear".',
    );
  }
  const growthStartProgress = Number(engorgement.growthStartProgress);
  if (
    !Number.isFinite(growthStartProgress)
    || growthStartProgress < 0
    || growthStartProgress >= 1
  ) {
    throw new RangeError(
      "countdownFramed.appearance.effects.snake.engorgement.growthStartProgress "
      + "must be from zero up to one.",
    );
  }
  const mealRevealBeforeEndBeats = requireFinitePositive(
    engorgement.mealRevealBeforeEndBeats,
    "countdownFramed.appearance.effects.snake.engorgement.mealRevealBeforeEndBeats",
  );
  const mealPulseScale = requireFinitePositive(
    engorgement.mealPulseScale,
    "countdownFramed.appearance.effects.snake.engorgement.mealPulseScale",
  );
  if (mealPulseScale < 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.snake.engorgement.mealPulseScale must be at least one.",
    );
  }
  const deathFlicker = requireObject(
    engorgement.deathFlicker,
    "countdownFramed.appearance.effects.snake.engorgement.deathFlicker",
  );
  if (typeof deathFlicker.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.engorgement.deathFlicker.enabled "
      + "must be a boolean.",
    );
  }
  const deathFlickerBeforeEndBeats = requireFinitePositive(
    deathFlicker.beforeEndBeats,
    "countdownFramed.appearance.effects.snake.engorgement.deathFlicker.beforeEndBeats",
  );
  if (
    typeof deathFlicker.mode !== "string"
    || deathFlicker.mode.trim() === ""
  ) {
    throw new TypeError(
      "countdownFramed.appearance.effects.snake.engorgement.deathFlicker.mode "
      + "must be a non-empty string.",
    );
  }
  const maximumLevel = requireNonNegativeInteger(
    snake.maximumSubdivisionLevel,
    "countdownFramed.appearance.effects.snake.maximumSubdivisionLevel",
  );
  if (maximumLevel > 3) {
    throw new RangeError(
      "countdownFramed.appearance.effects.snake.maximumSubdivisionLevel must be from zero to three.",
    );
  }
  if (!Number.isFinite(snake.dotMargin) || snake.dotMargin < 0 || snake.dotMargin >= 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.snake.dotMargin must be from zero up to one.",
    );
  }

  return Object.freeze({
    enabled: snake.enabled,
    seed: authored.seed >>> 0,
    evolveSeed: authored.evolveSeed,
    minimumCellDistance,
    palette: requireString(
      snake.palette,
      "countdownFramed.appearance.effects.snake.palette",
    ),
    duration,
    lengthCells,
    growAfterEachTick: snake.growAfterEachTick,
    mergeIntoBubbles: snake.mergeIntoBubbles,
    engorgement: Object.freeze({
      enabled: engorgement.enabled,
      growthMode: engorgement.growthMode,
      growthStartProgress,
      mealRevealBeforeEndBeats,
      mealPulseScale,
      mealPulseTimingCurve: Object.freeze(normalizeBezierCurve(
        engorgement.mealPulseTimingCurve,
        "countdownFramed.appearance.effects.snake.engorgement.mealPulseTimingCurve",
      )),
      deathFlicker: Object.freeze({
        enabled: deathFlicker.enabled,
        beforeEndBeats: deathFlickerBeforeEndBeats,
        mode: deathFlicker.mode,
      }),
    }),
    maximumSubdivisionLevel: maximumLevel,
    dotMargin: snake.dotMargin,
    timingCurve: Object.freeze(normalizeBezierCurve(
      snake.timingCurve,
      "countdownFramed.appearance.effects.snake.timingCurve",
    )),
  });
}

export function countdownSnakeLengthAt(
  baseLengthCells,
  tick,
  growAfterEachTick,
  availableCellCount,
) {
  const base = requirePositiveInteger(baseLengthCells, "Countdown snake base length");
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown snake tick");
  const available = requirePositiveInteger(
    availableCellCount,
    "Countdown snake available cell count",
  );
  if (typeof growAfterEachTick !== "boolean") {
    throw new TypeError("Countdown snake growAfterEachTick must be a boolean.");
  }
  return Math.min(
    available,
    base + (growAfterEachTick ? appearanceTick : 0),
  );
}

export function countdownAppearanceSeed(projectSeed, authoredSeed, tick, evolveSeed) {
  const project = requireNonNegativeInteger(projectSeed, "Countdown project seed") >>> 0;
  const authored = requireNonNegativeInteger(authoredSeed, "Countdown appearance seed") >>> 0;
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown appearance tick");
  if (typeof evolveSeed !== "boolean") {
    throw new TypeError("Countdown appearance evolveSeed must be a boolean.");
  }
  return (project ^ authored ^ (evolveSeed ? Math.imul(appearanceTick, 0x9e3779b1) : 0)) >>> 0;
}

function snakeCellNeighbors(columns, rows, index) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const neighbors = [];
  if (column > 0) neighbors.push(index - 1);
  if (column + 1 < columns) neighbors.push(index + 1);
  if (row > 0) neighbors.push(index - columns);
  if (row + 1 < rows) neighbors.push(index + columns);
  return neighbors;
}

function countdownSnakePathAroundBlockedCells(
  columns,
  rows,
  source,
  target,
  pathSeed,
  blocked,
) {
  const cellCount = columns * rows;
  const parents = new Int32Array(cellCount);
  parents.fill(-2);
  parents[source] = -1;
  const queue = [source];
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const current = queue[queueIndex];
    if (current === target) break;
    const neighbors = snakeCellNeighbors(columns, rows, current)
      .filter(index => parents[index] === -2 && !blocked.has(index))
      .sort((first, second) => {
        const firstDistance = Math.abs(first % columns - target % columns)
          + Math.abs(Math.floor(first / columns) - Math.floor(target / columns));
        const secondDistance = Math.abs(second % columns - target % columns)
          + Math.abs(Math.floor(second / columns) - Math.floor(target / columns));
        return firstDistance - secondDistance
          || hashUnit(pathSeed ^ current, first, SNAKE_SAFE_PATH_SALT)
            - hashUnit(pathSeed ^ current, second, SNAKE_SAFE_PATH_SALT)
          || first - second;
      });
    for (const neighbor of neighbors) {
      parents[neighbor] = current;
      queue.push(neighbor);
    }
  }
  if (parents[target] === -2) {
    throw new RangeError("Countdown snake path cannot avoid the blocked cells.");
  }

  const reversedPath = [];
  for (let index = target; index >= 0; index = parents[index]) {
    reversedPath.push(index);
  }
  return reversedPath.reverse();
}

function countdownDirectSnakePath(columns, source, target, pathSeed) {
  let column = source % columns;
  let row = Math.floor(source / columns);
  const targetColumn = target % columns;
  const targetRow = Math.floor(target / columns);
  const path = [source];
  let step = 0;
  while (column !== targetColumn || row !== targetRow) {
    const canMoveHorizontally = column !== targetColumn;
    const canMoveVertically = row !== targetRow;
    const horizontalFirst = !canMoveVertically || (
      canMoveHorizontally
      && hashUnit(pathSeed, step, SNAKE_PATH_SALT) < 0.5
    );
    if (horizontalFirst) column += Math.sign(targetColumn - column);
    else row += Math.sign(targetRow - row);
    path.push(row * columns + column);
    step += 1;
  }
  return path;
}

function normalizedBlockedSnakeCells(
  blockedCellIndices,
  cellCount,
  source,
  target,
) {
  const blocked = new Set(blockedCellIndices.map((index, blockedIndex) => {
    const cellIndex = requireNonNegativeInteger(
      index,
      `Countdown snake blocked cell ${blockedIndex}`,
    );
    if (cellIndex >= cellCount) {
      throw new RangeError(
        "Countdown snake blocked cells must be inside the parent grid.",
      );
    }
    return cellIndex;
  }));
  blocked.delete(source);
  if (blocked.has(target)) {
    throw new RangeError("Countdown snake target cannot be a blocked cell.");
  }
  return blocked;
}

/** Parent cells whose footprint intersects the configured timer text safe zone. */
export function countdownSnakeTextSafeCells(
  { columns, rows },
  cellIndex,
  textSafeZone,
) {
  const columnCount = requirePositiveInteger(columns, "Countdown snake columns");
  const rowCount = requirePositiveInteger(rows, "Countdown snake rows");
  const textCellIndex = requireNonNegativeInteger(
    cellIndex,
    "Countdown snake text cell",
  );
  if (textCellIndex >= columnCount * rowCount) {
    throw new RangeError("Countdown snake text cell must be inside the parent grid.");
  }
  const safeZone = requireObject(textSafeZone, "Countdown snake text safe zone");
  const width = requireFinitePositive(
    safeZone.widthInCells,
    "Countdown snake text safe-zone width",
  );
  const height = requireFinitePositive(
    safeZone.heightInCells,
    "Countdown snake text safe-zone height",
  );
  const textColumn = textCellIndex % columnCount;
  const textRow = Math.floor(textCellIndex / columnCount);
  const left = textColumn + 0.5 - width / 2;
  const right = textColumn + 0.5 + width / 2;
  const top = textRow + 0.5 - height / 2;
  const bottom = textRow + 0.5 + height / 2;

  return Array.from({ length: columnCount * rowCount }, (_, index) => index)
    .filter(index => {
      const column = index % columnCount;
      const row = Math.floor(index / columnCount);
      return column < right
        && column + 1 > left
        && row < bottom
        && row + 1 > top;
    });
}

/** A seeded shortest cardinal path, rerouted only when it crosses blocked cells. */
export function countdownSnakePath(
  { columns, rows },
  sourceIndex,
  targetIndex,
  seed,
  blockedCellIndices = [],
) {
  const columnCount = requirePositiveInteger(columns, "Countdown snake columns");
  const rowCount = requirePositiveInteger(rows, "Countdown snake rows");
  const cellCount = columnCount * rowCount;
  const source = requireNonNegativeInteger(sourceIndex, "Countdown snake source cell");
  const target = requireNonNegativeInteger(targetIndex, "Countdown snake target cell");
  const pathSeed = requireNonNegativeInteger(seed, "Countdown snake seed") >>> 0;
  if (source >= cellCount || target >= cellCount) {
    throw new RangeError("Countdown snake cells must be inside the parent grid.");
  }
  if (!Array.isArray(blockedCellIndices)) {
    throw new TypeError("Countdown snake blocked cells must be an array.");
  }
  const directPath = countdownDirectSnakePath(
    columnCount,
    source,
    target,
    pathSeed,
  );
  if (blockedCellIndices.length === 0) return directPath;

  const blocked = normalizedBlockedSnakeCells(
    blockedCellIndices,
    cellCount,
    source,
    target,
  );
  if (directPath.slice(1).every(index => !blocked.has(index))) return directPath;
  return countdownSnakePathAroundBlockedCells(
    columnCount,
    rowCount,
    source,
    target,
    pathSeed,
    blocked,
  );
}

export function countdownSnakeSubdivisionLevel(bodyIndex, bodyCellCount, maximumLevel = 3) {
  const index = requireNonNegativeInteger(bodyIndex, "Countdown snake body index");
  const count = requirePositiveInteger(bodyCellCount, "Countdown snake body cell count");
  const maximum = requireNonNegativeInteger(maximumLevel, "Countdown snake maximum level");
  if (index >= count) throw new RangeError("Countdown snake body index is out of range.");
  if (count <= 2 || maximum === 0) return 0;
  const distanceFromEnd = Math.min(index, count - 1 - index);
  const centerDistance = Math.floor((count - 1) * 0.5);
  return Math.round(distanceFromEnd / centerDistance * maximum);
}

export function countdownSnakeFrame(plan, linearProgress, settings) {
  const path = plan?.path;
  if (!Array.isArray(path) || path.length === 0) {
    throw new TypeError("Countdown snake plan requires a non-empty path.");
  }
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const easedProgress = cubicBezierAt(progress, settings.timingCurve);
  const headStep = Math.min(
    path.length - 1,
    Math.floor(easedProgress * path.length),
  );
  const firstStep = Math.max(0, headStep - settings.lengthCells + 1);
  const bodyPath = path.slice(firstStep, headStep + 1);
  return {
    linearProgress: progress,
    progress: easedProgress,
    headStep,
    cells: bodyPath.map((index, bodyIndex) => ({
      index,
      level: countdownSnakeSubdivisionLevel(
        bodyIndex,
        bodyPath.length,
        settings.maximumSubdivisionLevel,
      ),
    })),
  };
}

function snakeCellDistance(columns, first, second) {
  return Math.abs(first % columns - second % columns)
    + Math.abs(Math.floor(first / columns) - Math.floor(second / columns));
}

function toroidalCellDistance(columns, rows, first, second) {
  const columnDistance = Math.abs(first % columns - second % columns);
  const rowDistance = Math.abs(
    Math.floor(first / columns) - Math.floor(second / columns),
  );
  return Math.min(columnDistance, columns - columnDistance)
    + Math.min(rowDistance, rows - rowDistance);
}

function normalizedSnakeBody(cells, columns, cellCount) {
  if (!Array.isArray(cells) || cells.length === 0) {
    throw new TypeError("Countdown snake engorgement requires an entry body.");
  }
  const body = cells.map((cell, index) => {
    const cellIndex = requireNonNegativeInteger(
      cell?.index,
      `Countdown snake engorgement entry cell ${index}`,
    );
    if (cellIndex >= cellCount) {
      throw new RangeError(
        "Countdown snake engorgement entry cells must be inside the board.",
      );
    }
    return cellIndex;
  });
  if (new Set(body).size !== body.length) {
    throw new RangeError("Countdown snake engorgement entry body must be self-avoiding.");
  }
  for (let index = 1; index < body.length; index += 1) {
    if (snakeCellDistance(columns, body[index - 1], body[index]) === 1) continue;
    throw new RangeError("Countdown snake engorgement entry body must move cardinally.");
  }
  return body;
}

function engorgementLengthAt(startLength, targetLength, progress) {
  return Math.min(
    targetLength,
    startLength + Math.floor((targetLength - startLength) * progress),
  );
}

function toroidalCoverageCycle(columns, rows, startIndex, seed) {
  if (columns < 3 && rows >= 3) {
    const startColumn = startIndex % columns;
    const startRow = Math.floor(startIndex / columns);
    return toroidalCoverageCycle(
      rows,
      columns,
      startColumn * rows + startRow,
      seed,
    ).map(index => {
      const transposedColumn = index % rows;
      const transposedRow = Math.floor(index / rows);
      return transposedColumn * columns + transposedRow;
    });
  }
  if (columns === 2 && rows === 2) {
    const cycle = [0, 1, 3, 2];
    const offset = cycle.indexOf(startIndex);
    return [...cycle.slice(offset), ...cycle.slice(0, offset)];
  }
  if (columns < 3 || rows < 1) {
    throw new RangeError(
      `Countdown snake coverage requires a routable layout, got ${columns}x${rows}.`,
    );
  }
  const adjacency = Array.from(
    { length: columns * rows },
    () => new Set(),
  );
  const addEdge = (first, second) => {
    adjacency[first].add(second);
    adjacency[second].add(first);
  };
  const removeEdge = (first, second) => {
    adjacency[first].delete(second);
    adjacency[second].delete(first);
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      addEdge(
        row * columns + column,
        row * columns + (column + 1) % columns,
      );
    }
  }
  // Splice the horizontal row cycles into one toroidal coverage cycle.
  for (let row = 0; row < rows - 1; row += 1) {
    const column = row % 2;
    const upperLeft = row * columns + column;
    const upperRight = upperLeft + 1;
    const lowerLeft = (row + 1) * columns + column;
    const lowerRight = lowerLeft + 1;
    removeEdge(upperLeft, upperRight);
    removeEdge(lowerLeft, lowerRight);
    addEdge(upperLeft, lowerLeft);
    addEdge(upperRight, lowerRight);
  }
  if (adjacency.some(neighbors => neighbors.size !== 2)) {
    throw new RangeError(
      `Countdown snake coverage produced an invalid cycle for ${columns}x${rows}.`,
    );
  }
  const firstNeighbors = [...adjacency[startIndex]].sort((first, second) => (
    hashUnit(seed, first, SNAKE_ENGORGEMENT_MOVE_SALT)
      - hashUnit(seed, second, SNAKE_ENGORGEMENT_MOVE_SALT)
    || first - second
  ));
  const cycle = [startIndex];
  let previous = startIndex;
  let current = firstNeighbors[0];
  while (current !== startIndex) {
    cycle.push(current);
    const next = [...adjacency[current]].find(index => index !== previous);
    previous = current;
    current = next;
    if (cycle.length > columns * rows) break;
  }
  if (cycle.length !== columns * rows) {
    throw new RangeError(
      `Countdown snake coverage could not fill layout=${columns}x${rows} `
      + `covered=${cycle.length} target=${columns * rows}.`,
    );
  }
  return cycle;
}

function planEngorgementRoute({
  columns,
  rows,
  entryBody,
  beatCount,
  seed,
  startLength,
  targetLength,
  stepsPerBeat,
  cruiseStepCount,
  growthStartStep,
  movementStepCount,
}) {
  const routeStepCount = stepsPerBeat * beatCount;
  const baseCycle = toroidalCoverageCycle(
    columns,
    rows,
    entryBody.at(-1),
    seed,
  );
  const simulate = cycle => {
    const snapshots = [];
    const collisionSteps = [];
    const wrapSteps = [];
    let body = entryBody;
    let cycleCursor = 0;
    let cruiseStep = 0;
    let exploredCount = 0;
    for (let routeStep = 1; routeStep <= routeStepCount; routeStep += 1) {
      if (routeStep > movementStepCount) {
        snapshots.push(body);
        continue;
      }
      const growthProgress = routeStep <= growthStartStep
        ? 0
        : (routeStep - growthStartStep)
          / (movementStepCount - growthStartStep);
      const length = engorgementLengthAt(
        startLength,
        targetLength,
        growthProgress,
      );
      const desiredCruiseStep = routeStep <= growthStartStep
        ? Math.floor(routeStep * cruiseStepCount / growthStartStep)
        : cruiseStepCount;
      const advanceCount = routeStep <= growthStartStep
        ? desiredCruiseStep - cruiseStep
        : Math.max(1, length - body.length);
      cruiseStep = desiredCruiseStep;
      for (let advance = 0; advance < advanceCount; advance += 1) {
        cycleCursor = (cycleCursor + 1) % cycle.length;
        const headIndex = cycle[cycleCursor];
        if (snakeCellDistance(columns, body.at(-1), headIndex) !== 1) {
          wrapSteps.push(routeStep);
        }
        if (body.includes(headIndex)) collisionSteps.push(routeStep);
        body = body.length < length
          ? [...body, headIndex]
          : [...body.slice(1), headIndex];
        exploredCount += 1;
      }
      snapshots.push(body);
    }
    return {
      cycle,
      mealIndex: cycle[(cycleCursor + 1) % cycle.length],
      snapshots,
      collisionSteps,
      wrapSteps,
      exploredCount,
    };
  };
  const reverseCycle = [baseCycle[0], ...baseCycle.slice(1).reverse()];
  const route = [simulate(baseCycle), simulate(reverseCycle)].sort(
    (first, second) => first.collisionSteps.length - second.collisionSteps.length,
  )[0];
  const { cycle, snapshots, collisionSteps, wrapSteps } = route;
  return {
    cycle,
    mealIndex: route.mealIndex,
    growthStartStep,
    movementStepCount,
    snapshots,
    targets: Array.from({ length: beatCount }, (_, beatIndex) => [
      snapshots[(beatIndex + 1) * stepsPerBeat - 1].at(-1),
    ]),
    exploredCount: route.exploredCount,
    rejectionCount: 0,
    collisionCount: collisionSteps.length,
    collisionSteps,
    wrapSteps,
  };
}

/** Precompute crossing-tolerant body snapshots for deterministic playback and seeking. */
export function createCountdownSnakeEngorgementPlan({
  layout,
  entryCells,
  safeCellsByBeat,
  seed,
  startSeconds,
  endSeconds,
  tickSeconds,
  growthStartProgress,
  mealRevealBeforeEndBeats,
}) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown snake engorgement columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown snake engorgement rows");
  const cellCount = columns * rows;
  const planSeed = requireNonNegativeInteger(seed, "Countdown snake engorgement seed") >>> 0;
  const start = requireFiniteNonNegative(startSeconds, "Countdown snake engorgement start");
  const end = requireFinitePositive(endSeconds, "Countdown snake engorgement end");
  const beatSeconds = requireFinitePositive(tickSeconds, "Countdown snake engorgement beat");
  const growthStart = Number(growthStartProgress);
  if (!Number.isFinite(growthStart) || growthStart < 0 || growthStart >= 1) {
    throw new RangeError(
      "Countdown snake engorgement growth start progress must be from zero up to one.",
    );
  }
  const mealRevealBeats = requireFinitePositive(
    mealRevealBeforeEndBeats,
    "Countdown snake engorgement meal reveal beats",
  );
  if (end <= start) {
    throw new RangeError("Countdown snake engorgement end must follow its start.");
  }
  const beatCount = Math.ceil((end - start) / beatSeconds);
  const mealRevealProgress = Math.min(
    1,
    mealRevealBeats * beatSeconds / (end - start),
  );
  const mealRevealStartProgress = 1 - mealRevealProgress;
  if (growthStart >= mealRevealStartProgress) {
    throw new RangeError(
      "Countdown snake engorgement growth must start before the meal reveal window.",
    );
  }
  if (!Array.isArray(safeCellsByBeat) || safeCellsByBeat.length !== beatCount + 1) {
    throw new RangeError(
      "Countdown snake engorgement requires one timer-safe sample per beat boundary.",
    );
  }
  const normalizedSafeCells = safeCellsByBeat.map((cells, beatIndex) => {
    if (!Array.isArray(cells)) {
      throw new TypeError(`Countdown snake engorgement safe beat ${beatIndex} must be an array.`);
    }
    return [...new Set(cells.map((index, blockedIndex) => {
      const cellIndex = requireNonNegativeInteger(
        index,
        `Countdown snake engorgement safe beat ${beatIndex} cell ${blockedIndex}`,
      );
      if (cellIndex >= cellCount) {
        throw new RangeError("Countdown snake engorgement safe cells must be inside the board.");
      }
      return cellIndex;
    }))];
  });
  const entryBody = normalizedSnakeBody(entryCells, columns, cellCount);
  const cacheKey = JSON.stringify({
    columns,
    rows,
    entryBody,
    safeCellsByBeat: normalizedSafeCells,
    seed: planSeed,
    start,
    end,
    beatSeconds,
    growthStart,
    mealRevealBeats,
  });
  const cached = SNAKE_ENGORGEMENT_PLAN_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const cruiseStepsPerBeat = Math.max(
    1,
    Math.ceil((cellCount - 1) / beatCount),
  );
  let route = null;
  let stepsPerBeat = cruiseStepsPerBeat;
  let planningStepOffset = 0;
  const targetBodyLength = cellCount - 1;
  const targetLength = cellCount;
  const growthCellCount = targetBodyLength - entryBody.length;
  const growthWindowProgress = mealRevealStartProgress - growthStart;
  const baseStepsPerBeat = Math.max(
    cruiseStepsPerBeat,
    Math.ceil(growthCellCount / (beatCount * growthWindowProgress)),
  );
  for (let stepOffset = 0; stepOffset <= cellCount; stepOffset += 1) {
    const candidateStepsPerBeat = baseStepsPerBeat + stepOffset;
    const routeStepCount = candidateStepsPerBeat * beatCount;
    const mealRevealSteps = Math.max(
      1,
      Math.round(mealRevealBeats * candidateStepsPerBeat),
    );
    const movementStepCount = routeStepCount - mealRevealSteps;
    const growthStartStep = Math.floor(growthStart * routeStepCount);
    const cruiseStepCount = Math.floor(
      growthStart * beatCount * cruiseStepsPerBeat,
    );
    if (
      growthStartStep >= movementStepCount
      || movementStepCount - growthStartStep < growthCellCount
    ) continue;
    const candidateRoute = planEngorgementRoute({
      columns,
      rows,
      entryBody,
      beatCount,
      seed: planSeed,
      startLength: entryBody.length,
      targetLength: targetBodyLength,
      stepsPerBeat: candidateStepsPerBeat,
      cruiseStepCount,
      growthStartStep,
      movementStepCount,
    });
    const finalBody = candidateRoute.snapshots.at(-1);
    if (
      finalBody.length !== targetBodyLength
      || new Set(finalBody).size !== targetBodyLength
      || finalBody.includes(candidateRoute.mealIndex)
    ) continue;
    route = candidateRoute;
    stepsPerBeat = candidateStepsPerBeat;
    planningStepOffset = stepOffset;
    break;
  }
  if (route === null) {
    throw new RangeError(
      `Countdown snake engorgement cannot cover layout=${columns}x${rows} `
      + `targetLength=${targetLength} beats=${beatCount}.`,
    );
  }
  const mealIndex = route.mealIndex;
  const reachableLength = cellCount;
  const capacityLength = cellCount;
  const globalStepCount = stepsPerBeat * beatCount;
  const snapshots = [entryBody, ...route.snapshots];
  const beats = route.targets.map((targetCandidates, beatIndex) => {
    const startBody = snapshots[beatIndex * stepsPerBeat];
    const endBody = snapshots[(beatIndex + 1) * stepsPerBeat];
    const targetIndex = targetCandidates[0];
    return {
      beatIndex,
      routeStep: (beatIndex + 1) * stepsPerBeat,
      targetIndex,
      startDistance: toroidalCellDistance(
        columns,
        rows,
        startBody.at(-1),
        targetIndex,
      ),
      endDistance: toroidalCellDistance(
        columns,
        rows,
        endBody.at(-1),
        targetIndex,
      ),
      targetLength: endBody.length,
      uniqueCellCount: new Set(endBody).size,
      coverage: new Set(endBody).size / cellCount,
      timerCellCount: normalizedSafeCells[beatIndex + 1].length,
      safeCellIndices: [...normalizedSafeCells[beatIndex + 1]],
    };
  });
  const plan = {
    seed: planSeed,
    columns,
    rows,
    startSeconds: start,
    endSeconds: end,
    durationSeconds: end - start,
    tickSeconds: beatSeconds,
    beatCount,
    stepsPerBeat,
    cruiseStepsPerBeat,
    cruiseStepCount: Math.floor(
      growthStart * beatCount * cruiseStepsPerBeat,
    ),
    routeStepCount: globalStepCount,
    startLength: entryBody.length,
    reachableLength,
    targetLength,
    plannedLength: targetBodyLength + 1,
    targetBodyLength,
    capacityLength,
    growthStartProgress: growthStart,
    growthStartStep: route.growthStartStep,
    movementStepCount: route.movementStepCount,
    coverageCycle: route.cycle,
    mealIndex,
    collisionCount: route.collisionCount,
    collisionSteps: route.collisionSteps,
    wrapSteps: route.wrapSteps,
    rejectionCount: route.rejectionCount,
    exploredCount: route.exploredCount,
    planningVariant: 0,
    planningStepOffset,
    safeCellsByBeat: normalizedSafeCells,
    beats,
    snapshots,
  };
  SNAKE_ENGORGEMENT_PLAN_CACHE.set(cacheKey, plan);
  if (SNAKE_ENGORGEMENT_PLAN_CACHE.size > SNAKE_ENGORGEMENT_PLAN_CACHE_LIMIT) {
    const oldestKey = SNAKE_ENGORGEMENT_PLAN_CACHE.keys().next().value;
    SNAKE_ENGORGEMENT_PLAN_CACHE.delete(oldestKey);
  }
  return plan;
}

export function countdownSnakeEngorgementFrame(plan, linearProgress, settings) {
  if (!plan || !Array.isArray(plan.snapshots) || plan.snapshots.length === 0) {
    throw new TypeError("Countdown snake engorgement frame requires a plan.");
  }
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const routeStep = Math.min(
    plan.routeStepCount,
    Math.floor(progress * plan.routeStepCount),
  );
  const body = plan.snapshots[routeStep];
  const mealIsVisible = progress >= 1 - Math.min(
    1,
    settings.engorgement.mealRevealBeforeEndBeats
      * plan.tickSeconds / plan.durationSeconds,
  ) && progress < 1;
  const uniqueCellCount = new Set([
    ...body,
    ...(mealIsVisible || progress >= 1 ? [plan.mealIndex] : []),
  ]).size;
  const deathFlickerSettings = settings.engorgement.deathFlicker;
  const deathFlickerDurationProgress = deathFlickerSettings?.enabled === true
    ? Math.min(
      1,
      deathFlickerSettings.beforeEndBeats
        * plan.tickSeconds / plan.durationSeconds,
    )
    : 0;
  const deathFlickerStartProgress = 1 - deathFlickerDurationProgress;
  const deathFlickerActive = deathFlickerDurationProgress > 0
    && progress >= deathFlickerStartProgress
    && progress < 1;
  const deathFlickerProgress = deathFlickerActive
    ? (progress - deathFlickerStartProgress) / deathFlickerDurationProgress
    : 0;
  const allBodyCells = body.map((index, bodyIndex) => ({
    index,
    level: countdownSnakeSubdivisionLevel(
      bodyIndex,
      body.length,
      settings.maximumSubdivisionLevel,
    ),
  }));
  const bodyCells = allBodyCells;
  const revealDurationProgress = Math.min(
    1,
    settings.engorgement.mealRevealBeforeEndBeats
      * plan.tickSeconds / plan.durationSeconds,
  );
  const revealStartProgress = 1 - revealDurationProgress;
  const foodVisible = mealIsVisible;
  const revealProgress = foodVisible
    ? (progress - revealStartProgress) / revealDurationProgress
    : 0;
  const pulseLinearProgress = revealProgress < 0.5
    ? revealProgress * 2
    : (1 - revealProgress) * 2;
  const pulseProgress = foodVisible
    ? cubicBezierAt(pulseLinearProgress, settings.engorgement.mealPulseTimingCurve)
    : 0;
  const pulseScale = 1 + (
    settings.engorgement.mealPulseScale - 1
  ) * pulseProgress;
  if (foodVisible && bodyCells.length > 0) {
    bodyCells[bodyCells.length - 1] = {
      ...bodyCells.at(-1),
      scale: pulseScale,
      pulse: true,
    };
  }
  const mealCell = foodVisible ? {
    index: plan.mealIndex,
    level: 0,
    scale: pulseScale,
    pulse: true,
    food: true,
  } : null;
  return {
    linearProgress: progress,
    progress,
    routeStep,
    currentLength: body.length + (foodVisible || progress >= 1 ? 1 : 0),
    targetLength: plan.targetLength,
    plannedLength: plan.plannedLength,
    capacityLength: plan.capacityLength,
    headIndex: body.at(-1),
    mealIndex: plan.mealIndex,
    foodVisible,
    pulse: {
      active: foodVisible,
      progress: pulseProgress,
      scale: pulseScale,
    },
    deathFlicker: {
      active: deathFlickerActive,
      progress: deathFlickerProgress,
    },
    collisionCount: plan.collisionSteps.filter(step => step <= routeStep).length,
    wrapCount: plan.wrapSteps.filter(step => step <= routeStep).length,
    uniqueCellCount,
    coverage: uniqueCellCount / (plan.columns * plan.rows),
    coverageComplete: uniqueCellCount === plan.columns * plan.rows,
    growthActive:
      routeStep > plan.growthStartStep
      && routeStep <= plan.movementStepCount,
    movementComplete: routeStep >= plan.movementStepCount,
    allBodyCells,
    bodyCells,
    cells: mealCell === null ? bodyCells : [...bodyCells, mealCell],
  };
}

export function countdownSnakeGlyphColors(
  cell,
  frame,
  layout,
  palette,
  flicker,
  time,
  maximumSubdivisionLevel,
) {
  if (!Number.isSafeInteger(layout?.columns) || layout.columns <= 0) {
    throw new TypeError("Countdown snake colors require layout columns.");
  }
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError("Countdown snake colors require a palette.");
  }
  if (!Number.isFinite(time)) {
    throw new TypeError("Countdown snake flicker time must be finite.");
  }
  const subdivisions = 1 << cell.level;
  const glyphCount = subdivisions * subdivisions;
  const paletteIndex = Math.min(cell.level, palette.length - 1);
  const baseColor = palette[paletteIndex];
  const canFlicker = frame.deathFlicker?.active === true
    && cell.food !== true
    && typeof flicker?.sampleAt === "function"
    && Array.isArray(flicker?.paletteColors);
  if (!canFlicker) return Array(glyphCount).fill(baseColor);
  const parentColumn = cell.index % layout.columns;
  const parentRow = Math.floor(cell.index / layout.columns);
  const indices = flickerPaletteIndicesForCell({
    flicker,
    level: cell.level,
    time,
    parentColumn,
    parentRow,
    basePosition: paletteIndex / Math.max(1, palette.length - 1),
    dotsPerCellAxis: 1 << maximumSubdivisionLevel,
  });
  return Array.from(indices, index => flicker.paletteColors[index]);
}

export function drawCountdownSnake(
  context,
  layout,
  frame,
  settings,
  palette,
  flicker = null,
  time = 0,
) {
  if (!settings.enabled) return;
  context.save();
  const baseAlpha = Number.isFinite(context.globalAlpha)
    ? context.globalAlpha
    : 1;
  for (let cellIndex = 0; cellIndex < frame.cells.length; cellIndex += 1) {
    const cell = frame.cells[cellIndex];
    const cellOpacity = Number.isFinite(cell.opacity)
      ? Math.max(0, Math.min(1, cell.opacity))
      : 1;
    context.globalAlpha = baseAlpha * cellOpacity;
    const column = cell.index % layout.columns;
    const row = Math.floor(cell.index / layout.columns);
    const subdivisions = 1 << cell.level;
    const slot = layout.cellSize / subdivisions;
    const scale = Number.isFinite(cell.scale) && cell.scale > 0 ? cell.scale : 1;
    const radius = slot * 0.5 * (1 - settings.dotMargin) * scale;
    const glyphColors = countdownSnakeGlyphColors(
      cell,
      frame,
      layout,
      palette,
      flicker,
      time,
      settings.maximumSubdivisionLevel,
    );
    const flickerActive = frame.deathFlicker?.active === true
      && cell.food !== true
      && flicker !== null;
    if (!flickerActive) {
      context.fillStyle = glyphColors[0];
      context.beginPath();
    }
    let hasVisibleGlyph = false;
    for (let subRow = 0; subRow < subdivisions; subRow += 1) {
      for (let subColumn = 0; subColumn < subdivisions; subColumn += 1) {
        if (cell.glyphShape === "circle") {
          const normalizedX = (
            subColumn + 0.5 - subdivisions / 2
          ) / (subdivisions / 2);
          const normalizedY = (
            subRow + 0.5 - subdivisions / 2
          ) / (subdivisions / 2);
          if (normalizedX ** 2 + normalizedY ** 2 > 1) continue;
          const glyphFill = Number.isFinite(cell.glyphFill)
            ? Math.max(0, Math.min(1, cell.glyphFill))
            : 1;
          const glyphIndex = subRow * subdivisions + subColumn;
          if (
            glyphFill < 1
            && hashUnit(
              cell.glyphSeed ?? 0,
              cell.index * 64 + glyphIndex,
              SNAKE_GLYPH_FILL_SALT,
            ) >= glyphFill
          ) continue;
        }
        const x = layout.offsetX + column * layout.cellSize + (subColumn + 0.5) * slot;
        const y = layout.offsetY + row * layout.cellSize + (subRow + 0.5) * slot;
        const glyphIndex = subRow * subdivisions + subColumn;
        if (flickerActive) {
          context.fillStyle = glyphColors[glyphIndex];
          context.beginPath();
        }
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
        if (flickerActive) context.fill();
        hasVisibleGlyph = true;
      }
    }
    if (hasVisibleGlyph && !flickerActive) context.fill();
  }
  context.globalAlpha = baseAlpha;
  context.restore();
}
