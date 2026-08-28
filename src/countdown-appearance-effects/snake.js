import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";

const SNAKE_PATH_SALT = 2089;
const SNAKE_SAFE_PATH_SALT = 4099;

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
    bubbleClearanceInCells: requireFiniteNonNegative(
      snake.bubbleClearanceInCells,
      "countdownFramed.appearance.effects.snake.bubbleClearanceInCells",
    ),
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

/** During the bubble merge, the largest level-0 dots split into level 1. */
export function countdownSnakeMergeFrame(frame) {
  if (!frame || !Array.isArray(frame.cells)) {
    throw new TypeError("Countdown snake merge requires a snake frame.");
  }
  return {
    ...frame,
    cells: frame.cells.map(cell => {
      const level = requireNonNegativeInteger(
        cell?.level,
        "Countdown snake merge cell level",
      );
      if (level > 3) {
        throw new RangeError("Countdown snake merge cell level cannot exceed three.");
      }
      return { ...cell, level: Math.max(1, level) };
    }),
  };
}

export function drawCountdownSnake(context, layout, frame, settings, palette) {
  if (!settings.enabled) return;
  context.save();
  for (const cell of frame.cells) {
    const column = cell.index % layout.columns;
    const row = Math.floor(cell.index / layout.columns);
    const subdivisions = 1 << cell.level;
    const slot = layout.cellSize / subdivisions;
    const radius = slot * 0.5 * (1 - settings.dotMargin);
    context.fillStyle = palette[Math.min(cell.level, palette.length - 1)];
    context.beginPath();
    for (let subRow = 0; subRow < subdivisions; subRow += 1) {
      for (let subColumn = 0; subColumn < subdivisions; subColumn += 1) {
        const x = layout.offsetX + column * layout.cellSize + (subColumn + 0.5) * slot;
        const y = layout.offsetY + row * layout.cellSize + (subRow + 0.5) * slot;
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
  }
  context.restore();
}
