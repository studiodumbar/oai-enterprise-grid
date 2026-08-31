import {
  cubicBezierAt,
  normalizeBezierCurve,
} from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";
import { noiseVisibilityFill } from "../noise-fields/visibility.js";

const FRAME_TARGET_SALT = 2203;
const FRAME_DIRECTION_SALT = 2207;
const FRAME_CANDIDATE_SALT = 2213;
const FRAME_VISIBILITY_SALT = 2219;

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

function requireFinitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

export function resolveCountdownFrameSettings(appearance) {
  const authored = requireObject(appearance, "countdownFramed.appearance");
  const frame = requireObject(
    authored.effects?.frame,
    "countdownFramed.appearance.effects.frame",
  );
  if (typeof frame.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.frame.enabled must be a boolean.",
    );
  }
  const subdivisionLevel = requireNonNegativeInteger(
    frame.subdivisionLevel,
    "countdownFramed.appearance.effects.frame.subdivisionLevel",
  );
  if (subdivisionLevel !== 3) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.subdivisionLevel must be three (8x8).",
    );
  }
  const squareCount = requirePositiveInteger(
    frame.squareCount,
    "countdownFramed.appearance.effects.frame.squareCount",
  );
  if (squareCount !== 2) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.squareCount must be two.",
    );
  }
  if (typeof frame.evolveSquareCount !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.frame.evolveSquareCount must be a boolean.",
    );
  }
  const dotsPerSquare = requirePositiveInteger(
    frame.dotsPerSquare,
    "countdownFramed.appearance.effects.frame.dotsPerSquare",
  );
  if (dotsPerSquare !== 4) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.dotsPerSquare must be four.",
    );
  }
  const avoidance = requireObject(
    frame.avoidance,
    "countdownFramed.appearance.effects.frame.avoidance",
  );
  const avoidanceRadiusInCells = requireFinitePositive(
    avoidance.radiusInCells,
    "countdownFramed.appearance.effects.frame.avoidance.radiusInCells",
  );
  const avoidanceRadiusAtEndInCells = requireFinitePositive(
    avoidance.radiusAtEndInCells,
    "countdownFramed.appearance.effects.frame.avoidance.radiusAtEndInCells",
  );
  if (avoidanceRadiusAtEndInCells < avoidanceRadiusInCells) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.avoidance.radiusAtEndInCells "
      + "cannot be smaller than radiusInCells.",
    );
  }
  const avoidanceDurationBeats = requireFinitePositive(
    avoidance.durationBeats,
    "countdownFramed.appearance.effects.frame.avoidance.durationBeats",
  );
  if (avoidanceDurationBeats < 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.avoidance.durationBeats must be at least one.",
    );
  }
  const numberSpacingInSubdivisions = requireFinitePositive(
    frame.numberSpacingInSubdivisions,
    "countdownFramed.appearance.effects.frame.numberSpacingInSubdivisions",
  );
  if (typeof frame.growTowardZero !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.frame.growTowardZero must be a boolean.",
    );
  }
  if (!Number.isFinite(frame.dotMargin) || frame.dotMargin < 0 || frame.dotMargin >= 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.frame.dotMargin must be from zero up to one.",
    );
  }
  const noiseFields = requireObject(
    frame.noiseFields,
    "countdownFramed.appearance.effects.frame.noiseFields",
  );
  const beatWiggle = requireObject(
    noiseFields.beatWiggle,
    "countdownFramed.appearance.effects.frame.noiseFields.beatWiggle",
  );

  return Object.freeze({
    enabled: frame.enabled,
    palette: requireString(
      frame.palette,
      "countdownFramed.appearance.effects.frame.palette",
    ),
    subdivisionLevel,
    squareCount,
    evolveSquareCount: frame.evolveSquareCount,
    dotsPerSquare,
    numberSpacingInSubdivisions,
    avoidance: Object.freeze({
      radiusInCells: avoidanceRadiusInCells,
      radiusAtEndInCells: avoidanceRadiusAtEndInCells,
      durationBeats: avoidanceDurationBeats,
      timingCurve: Object.freeze(normalizeBezierCurve(
        avoidance.timingCurve,
        "countdownFramed.appearance.effects.frame.avoidance.timingCurve",
      )),
      radiusGrowthTimingCurve: Object.freeze(normalizeBezierCurve(
        avoidance.radiusGrowthTimingCurve,
        "countdownFramed.appearance.effects.frame.avoidance.radiusGrowthTimingCurve",
      )),
    }),
    visibilityNoiseMotion: Object.freeze({
      beatWiggleDistance: requireFiniteNonNegative(
        beatWiggle.distance,
        "countdownFramed.appearance.effects.frame.noiseFields.beatWiggle.distance",
      ),
      timingCurve: Object.freeze(normalizeBezierCurve(
        beatWiggle.timingCurve,
        "countdownFramed.appearance.effects.frame.noiseFields.beatWiggle.timingCurve",
      )),
    }),
    growTowardZero: frame.growTowardZero,
    growthTimingCurve: Object.freeze(normalizeBezierCurve(
      frame.growthTimingCurve,
      "countdownFramed.appearance.effects.frame.growthTimingCurve",
    )),
    dotMargin: frame.dotMargin,
  });
}

function bubbleSquareDots(topLeftColumn, topLeftRow, gridColumns, squareIndex) {
  return [
    { column: topLeftColumn, row: topLeftRow },
    { column: topLeftColumn + 1, row: topLeftRow },
    { column: topLeftColumn + 1, row: topLeftRow + 1 },
    { column: topLeftColumn, row: topLeftRow + 1 },
  ].map(dot => ({
    ...dot,
    index: dot.row * gridColumns + dot.column,
    squareIndex,
  }));
}

function dotDistanceToCircle(dot, circle) {
  return Math.hypot(
    dot.column + 0.5 - circle.x,
    dot.row + 0.5 - circle.y,
  ) - circle.radius - 0.5;
}

function squaresWithEdgeDistance(squares, tileColumns, tileRows) {
  const byTile = new Map(squares.map(square => [
    `${square.topLeftColumn / 2}:${square.topLeftRow / 2}`,
    square,
  ]));
  const distances = new Map();
  const queue = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const square of squares) {
    const column = square.topLeftColumn / 2;
    const row = square.topLeftRow / 2;
    const boundary = neighbors.some(([dx, dy]) => {
      const nextColumn = column + dx;
      const nextRow = row + dy;
      return nextColumn < 0
        || nextColumn >= tileColumns
        || nextRow < 0
        || nextRow >= tileRows
        || !byTile.has(`${nextColumn}:${nextRow}`);
    });
    if (!boundary) continue;
    distances.set(`${column}:${row}`, 0);
    queue.push({ column, row });
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    const distance = distances.get(`${current.column}:${current.row}`);
    for (const [dx, dy] of neighbors) {
      const column = current.column + dx;
      const row = current.row + dy;
      const key = `${column}:${row}`;
      if (!byTile.has(key) || distances.has(key)) continue;
      distances.set(key, distance + 1);
      queue.push({ column, row });
    }
  }
  return squares.map(square => {
    const key = `${square.topLeftColumn / 2}:${square.topLeftRow / 2}`;
    const edgeDistance = distances.get(key) ?? null;
    return {
      ...square,
      edgeDistance,
      dots: square.dots.map(dot => ({ ...dot, edgeDistance })),
    };
  });
}

export function countdownFrameSquaresWithEdgeDistance(
  squares,
  gridColumns,
  gridRows,
) {
  if (!Array.isArray(squares)) {
    throw new TypeError("Countdown frame edge distance requires squares.");
  }
  const columns = requirePositiveInteger(gridColumns, "Countdown frame edge columns");
  const rows = requirePositiveInteger(gridRows, "Countdown frame edge rows");
  if (columns % 2 !== 0 || rows % 2 !== 0) {
    throw new RangeError("Countdown frame edge grid must contain complete 2x2 tiles.");
  }
  return squaresWithEdgeDistance(squares, columns / 2, rows / 2);
}

export function countdownSnakeBubblePlan({
  layout,
  cells,
  progress,
  appearanceTick = 0,
  subdivisionLevel = 3,
}) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown snake-bubble columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown snake-bubble rows");
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown snake-bubble subdivision level",
  );
  if (level !== 3) {
    throw new RangeError("Countdown snake-bubble subdivision level must be three (8x8).");
  }
  if (!Array.isArray(cells)) {
    throw new TypeError("Countdown snake-bubble cells must be an array.");
  }
  const tick = requireNonNegativeInteger(
    appearanceTick,
    "Countdown snake-bubble appearance tick",
  );
  const revealProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  const subdivisions = 1 << level;
  const gridColumns = columns * subdivisions;
  const gridRows = rows * subdivisions;
  const tileColumns = gridColumns / 2;
  const tilesByIndex = new Map();
  for (const cell of cells) {
    const cellIndex = requireNonNegativeInteger(
      cell?.index,
      "Countdown snake-bubble cell index",
    );
    if (cellIndex >= columns * rows) {
      throw new RangeError("Countdown snake-bubble cell must be inside the board.");
    }
    const cellLevel = requireNonNegativeInteger(
      cell?.level,
      "Countdown snake-bubble cell level",
    );
    if (cellLevel > level) {
      throw new RangeError("Countdown snake-bubble cell level exceeds its grid.");
    }
    const cellColumn = cellIndex % columns;
    const cellRow = Math.floor(cellIndex / columns);
    const cellSubdivisions = 1 << cellLevel;
    for (let subRow = 0; subRow < cellSubdivisions; subRow += 1) {
      for (let subColumn = 0; subColumn < cellSubdivisions; subColumn += 1) {
        const localTileColumn = Math.min(
          3,
          Math.floor((subColumn + 0.5) * 4 / cellSubdivisions),
        );
        const localTileRow = Math.min(
          3,
          Math.floor((subRow + 0.5) * 4 / cellSubdivisions),
        );
        const tileColumn = cellColumn * 4 + localTileColumn;
        const tileRow = cellRow * 4 + localTileRow;
        const tileIndex = tileRow * tileColumns + tileColumn;
        if (!tilesByIndex.has(tileIndex)) {
          tilesByIndex.set(tileIndex, {
            tileIndex,
            topLeftColumn: tileColumn * 2,
            topLeftRow: tileRow * 2,
            sourceCellIndex: cellIndex,
            sourceLevel: cellLevel,
          });
        }
      }
    }
  }
  const availableTiles = [...tilesByIndex.values()];
  const visibleTileCount = revealProgress <= 0
    ? 0
    : Math.min(availableTiles.length, Math.ceil(revealProgress * availableTiles.length));
  const squares = availableTiles.slice(0, visibleTileCount).map((tile, squareIndex) => {
    const dots = bubbleSquareDots(
      tile.topLeftColumn,
      tile.topLeftRow,
      gridColumns,
      squareIndex,
    ).map(dot => ({ ...dot, appearanceTick: tick }));
    return {
      ...tile,
      squareIndex,
      appearanceTick: tick,
      mergeSource: "snake",
      dots,
    };
  });
  const edgedSquares = countdownFrameSquaresWithEdgeDistance(
    squares,
    gridColumns,
    gridRows,
  );
  return {
    tick,
    subdivisions,
    gridColumns,
    gridRows,
    progress: revealProgress,
    availableSquareCount: availableTiles.length,
    squares: edgedSquares,
    dots: edgedSquares.flatMap(square => square.dots),
  };
}

export function countdownSnakeBubbleExclusionCircles({
  layout,
  cells,
  subdivisionLevel = 3,
  clearanceInCells = 0,
  dotMargin = 0,
}) {
  const columns = requirePositiveInteger(
    layout?.columns,
    "Countdown snake-bubble exclusion columns",
  );
  const rows = requirePositiveInteger(
    layout?.rows,
    "Countdown snake-bubble exclusion rows",
  );
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown snake-bubble exclusion subdivision level",
  );
  if (level !== 3) {
    throw new RangeError(
      "Countdown snake-bubble exclusion subdivision level must be three (8x8).",
    );
  }
  if (!Array.isArray(cells)) {
    throw new TypeError("Countdown snake-bubble exclusion cells must be an array.");
  }
  const clearance = requireFiniteNonNegative(
    clearanceInCells,
    "Countdown snake-bubble exclusion clearance",
  );
  if (!Number.isFinite(dotMargin) || dotMargin < 0 || dotMargin >= 1) {
    throw new RangeError(
      "Countdown snake-bubble exclusion dot margin must be from zero up to one.",
    );
  }
  const subdivisions = 1 << level;
  const circles = [];
  for (const cell of cells) {
    const cellIndex = requireNonNegativeInteger(
      cell?.index,
      "Countdown snake-bubble exclusion cell index",
    );
    if (cellIndex >= columns * rows) {
      throw new RangeError(
        "Countdown snake-bubble exclusion cell must be inside the board.",
      );
    }
    const cellLevel = requireNonNegativeInteger(
      cell?.level,
      "Countdown snake-bubble exclusion cell level",
    );
    if (cellLevel > level) {
      throw new RangeError(
        "Countdown snake-bubble exclusion cell level must be from zero to three.",
      );
    }
    const cellColumn = cellIndex % columns;
    const cellRow = Math.floor(cellIndex / columns);
    const cellSubdivisions = 1 << cellLevel;
    const slot = subdivisions / cellSubdivisions;
    const radius = slot * 0.5 * (1 - dotMargin) + clearance * subdivisions;
    for (let subRow = 0; subRow < cellSubdivisions; subRow += 1) {
      for (let subColumn = 0; subColumn < cellSubdivisions; subColumn += 1) {
        circles.push({
          x: cellColumn * subdivisions + (subColumn + 0.5) * slot,
          y: cellRow * subdivisions + (subRow + 0.5) * slot,
          radius,
        });
      }
    }
  }
  return circles;
}

export function countdownFramePlanWithSnakeTrail(plan, trailPlan) {
  if (!plan || !Array.isArray(plan.squares) || !Array.isArray(plan.dots)) {
    throw new TypeError("Countdown bubbles render plan requires generated squares.");
  }
  if (!trailPlan || !Array.isArray(trailPlan.squares)) {
    throw new TypeError("Countdown bubbles render plan requires a snake trail.");
  }
  if (
    plan.gridColumns !== trailPlan.gridColumns
    || plan.gridRows !== trailPlan.gridRows
  ) {
    throw new RangeError("Countdown bubbles and snake trail grids must match.");
  }
  const usedTiles = new Set(trailPlan.squares.map(square => square.tileIndex));
  const generatedSquares = plan.squares.filter(square => !usedTiles.has(square.tileIndex));
  const combined = [...trailPlan.squares, ...generatedSquares];
  const reindexed = combined.map((square, squareIndex) => ({
    ...square,
    squareIndex,
    dots: square.dots.map(dot => ({ ...dot, squareIndex })),
  }));
  const squares = countdownFrameSquaresWithEdgeDistance(
    reindexed,
    plan.gridColumns,
    plan.gridRows,
  );
  return {
    ...plan,
    trailSquareCount: trailPlan.squares.length,
    trailOverlapCount: plan.squares.length - generatedSquares.length,
    renderedSquareCount: squares.length,
    squares,
    dots: squares.flatMap(square => square.dots),
  };
}

/** Seeded 2x2 board tiles ranked outward from four digit anchors. */
export function countdownFramePlan({
  seed,
  tick,
  layout,
  cellIndex,
  subdivisionLevel = 3,
  squareCount = 2,
  minimumSquareCount = 2,
  dotsPerSquare = 4,
  numberSpacingInSubdivisions,
  excludedTileIndices = [],
  squareIndexOffset = 0,
}) {
  const planSeed = requireNonNegativeInteger(seed, "Countdown frame seed") >>> 0;
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown frame tick");
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown frame subdivision level",
  );
  const squaresRequested = requireNonNegativeInteger(
    squareCount,
    "Countdown frame square count",
  );
  const dotsRequested = requirePositiveInteger(
    dotsPerSquare,
    "Countdown frame dots per square",
  );
  const minimumSquares = requireNonNegativeInteger(
    minimumSquareCount,
    "Countdown frame minimum square count",
  );
  const firstSquareIndex = requireNonNegativeInteger(
    squareIndexOffset,
    "Countdown frame square index offset",
  );
  if (!Array.isArray(excludedTileIndices)) {
    throw new TypeError("Countdown frame excluded tiles must be an array.");
  }
  if (level !== 3) {
    throw new RangeError("Countdown frame subdivision level must be three (8x8).");
  }
  if (squaresRequested < minimumSquares) {
    throw new RangeError(
      "Countdown frame requested square count cannot be below its minimum.",
    );
  }
  if (dotsRequested !== 4) {
    throw new RangeError("Countdown frame dots per square must be four.");
  }
  const columns = requirePositiveInteger(layout?.columns, "Countdown frame columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown frame rows");
  const textCellIndex = requireNonNegativeInteger(
    cellIndex,
    "Countdown frame text cell",
  );
  if (textCellIndex >= columns * rows) {
    throw new RangeError("Countdown frame text cell must be inside the parent grid.");
  }
  const numberSpacing = requireFinitePositive(
    numberSpacingInSubdivisions,
    "Countdown frame number spacing",
  );

  const subdivisions = 1 << level;
  const gridColumns = columns * subdivisions;
  const gridRows = rows * subdivisions;
  const textCellColumn = textCellIndex % columns;
  const textCellRow = Math.floor(textCellIndex / columns);
  const textCenterColumn = textCellColumn * subdivisions + subdivisions / 2;
  const textCenterRow = textCellRow * subdivisions + subdivisions / 2;
  const digitCircles = [-2, -1, 1, 2].map((offset, digitIndex) => ({
    digitIndex,
    x: textCenterColumn + offset * numberSpacing,
    y: textCenterRow,
    radius: 0,
  }));
  const firstTarget = Math.min(
    digitCircles.length - 1,
    Math.floor(
      hashUnit(planSeed, appearanceTick, FRAME_TARGET_SALT) * digitCircles.length,
    ),
  );
  const direction = hashUnit(
    planSeed,
    appearanceTick,
    FRAME_DIRECTION_SALT,
  ) < 0.5 ? -1 : 1;
  const tiles = [];
  for (let row = 0; row <= gridRows - 2; row += 2) {
    for (let column = 0; column <= gridColumns - 2; column += 2) {
      const dots = bubbleSquareDots(column, row, gridColumns, 0);
      tiles.push({
        tileIndex: tiles.length,
        topLeftColumn: column,
        topLeftRow: row,
        dots,
      });
    }
  }
  if (tiles.length < minimumSquares) {
    throw new RangeError(
      "Countdown frame board cannot fit its initial two 2x2 squares.",
    );
  }
  const usedTiles = new Set(excludedTileIndices.map((tileIndex, index) => {
    const value = requireNonNegativeInteger(
      tileIndex,
      `Countdown frame excluded tile ${index}`,
    );
    if (value >= tiles.length) {
      throw new RangeError("Countdown frame excluded tile must be inside the board.");
    }
    return value;
  }));
  const availableTileCount = tiles.length - usedTiles.size;
  if (squaresRequested === 0) {
    return {
      seed: planSeed,
      tick: appearanceTick,
      subdivisions,
      gridColumns,
      gridRows,
      textCellIndex,
      requestedSquareCount: 0,
      constrainedSquareCount: 0,
      maximumSquareCount: tiles.length,
      digitCircles,
      squares: [],
      dots: [],
    };
  }
  const rankedTilesByTarget = digitCircles.map((targetCircle, targetDigitIndex) => (
    tiles.map(tile => ({
      ...tile,
      gap: Math.min(...tile.dots.map(dot => (
        dotDistanceToCircle(dot, targetCircle)
      ))),
      rank: hashUnit(
        planSeed ^ Math.imul(appearanceTick + 1, 0x9e3779b1),
        tile.tileIndex,
        FRAME_CANDIDATE_SALT + targetDigitIndex,
      ),
    })).sort((first, second) => (
      first.gap - second.gap
      || first.rank - second.rank
      || first.tileIndex - second.tileIndex
    ))
  ));
  const targetCursors = new Uint32Array(digitCircles.length);
  const squares = [];
  const constrainedSquareCount = Math.min(squaresRequested, availableTileCount);
  for (let localSquareIndex = 0; localSquareIndex < constrainedSquareCount; localSquareIndex += 1) {
    const squareIndex = firstSquareIndex + localSquareIndex;
    const targetDigitIndex = (
      firstTarget + direction * localSquareIndex + digitCircles.length * squaresRequested
    ) % digitCircles.length;
    const rankedTiles = rankedTilesByTarget[targetDigitIndex];
    let selected = null;
    while (targetCursors[targetDigitIndex] < rankedTiles.length && selected === null) {
      const candidate = rankedTiles[targetCursors[targetDigitIndex]];
      targetCursors[targetDigitIndex] += 1;
      if (!usedTiles.has(candidate.tileIndex)) selected = candidate;
    }
    if (!selected) {
      const fallback = tiles.find(tile => !usedTiles.has(tile.tileIndex)) ?? null;
      selected = fallback === null ? null : {
        ...fallback,
        gap: Math.min(...fallback.dots.map(dot => (
          dotDistanceToCircle(dot, digitCircles[targetDigitIndex])
        ))),
      };
    }
    if (!selected) break;
    usedTiles.add(selected.tileIndex);
    const dots = selected.dots.map(dot => ({
      ...dot,
      squareIndex,
      appearanceTick,
    }));
    squares.push({
      squareIndex,
      tileIndex: selected.tileIndex,
      appearanceTick,
      targetDigitIndex,
      topLeftColumn: selected.topLeftColumn,
      topLeftRow: selected.topLeftRow,
      gap: selected.gap,
      dots,
    });
  }
  const edgedSquares = countdownFrameSquaresWithEdgeDistance(
    squares,
    gridColumns,
    gridRows,
  );
  const dots = edgedSquares.flatMap(square => square.dots);

  return {
    seed: planSeed,
    tick: appearanceTick,
    subdivisions,
    gridColumns,
    gridRows,
    textCellIndex,
    requestedSquareCount: squaresRequested,
    constrainedSquareCount: squares.length,
    maximumSquareCount: tiles.length,
    digitCircles,
    squares: edgedSquares,
    dots,
  };
}

export function countdownFrameAvoidanceEnvelopesAt(ageBeats, avoidance) {
  if (!Number.isFinite(ageBeats) || ageBeats < 0) {
    throw new RangeError("Countdown frame avoidance age must be non-negative.");
  }
  const durationBeats = requireFinitePositive(
    avoidance?.durationBeats,
    "Countdown frame avoidance duration beats",
  );
  if (durationBeats < 1) {
    throw new RangeError("Countdown frame avoidance duration must be at least one beat.");
  }
  const progress = Math.min(1, ageBeats / durationBeats);
  if (progress < 0.5) {
    return {
      phase: "emptying",
      emptyEnvelope: cubicBezierAt(progress * 2, avoidance.timingCurve),
      refillEnvelope: 0,
    };
  }
  return {
    phase: progress < 1 ? "refilling" : "complete",
    emptyEnvelope: 1,
    refillEnvelope: cubicBezierAt((progress - 0.5) * 2, avoidance.timingCurve),
  };
}

export function countdownFrameAvoidanceRadiusAt(linearProgress, avoidance) {
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const start = requireFinitePositive(
    avoidance?.radiusInCells,
    "Countdown frame avoidance start radius",
  );
  const end = requireFinitePositive(
    avoidance?.radiusAtEndInCells,
    "Countdown frame avoidance end radius",
  );
  if (end < start) {
    throw new RangeError("Countdown frame avoidance end radius cannot shrink.");
  }
  const eased = cubicBezierAt(progress, avoidance.radiusGrowthTimingCurve);
  return start + (end - start) * eased;
}

export function countdownFrameNoiseBeatOffsetAt(linearProgress, motion) {
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const distance = requireFiniteNonNegative(
    motion?.beatWiggleDistance,
    "Countdown frame visibility-noise beat wiggle distance",
  );
  const rampProgress = progress < 0.5
    ? progress * 2
    : (1 - progress) * 2;
  return distance * cubicBezierAt(rampProgress, motion.timingCurve);
}

export function countdownFrameDigitCircles({
  layout,
  cellIndex,
  subdivisionLevel,
  numberSpacingInSubdivisions,
  radiusInCells,
  emptyEnvelope,
  refillEnvelope,
}) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown bubble columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown bubble rows");
  const textCellIndex = requireNonNegativeInteger(cellIndex, "Countdown bubble cell");
  if (textCellIndex >= columns * rows) {
    throw new RangeError("Countdown bubble cell must be inside the parent grid.");
  }
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown bubble subdivision level",
  );
  const spacing = requireFinitePositive(
    numberSpacingInSubdivisions,
    "Countdown bubble number spacing",
  );
  const radiusCells = requireFinitePositive(radiusInCells, "Countdown bubble radius");
  if (!Number.isFinite(emptyEnvelope) || emptyEnvelope < 0 || emptyEnvelope > 1) {
    throw new RangeError("Countdown bubble empty envelope must be from zero to one.");
  }
  if (!Number.isFinite(refillEnvelope) || refillEnvelope < 0 || refillEnvelope > 1) {
    throw new RangeError("Countdown bubble refill envelope must be from zero to one.");
  }
  if (refillEnvelope > emptyEnvelope) {
    throw new RangeError("Countdown bubble refill cannot overtake its empty radius.");
  }
  const subdivisions = 1 << level;
  const textCellColumn = textCellIndex % columns;
  const textCellRow = Math.floor(textCellIndex / columns);
  const centerColumn = textCellColumn * subdivisions + subdivisions / 2;
  const centerRow = textCellRow * subdivisions + subdivisions / 2;
  return [-2, -1, 1, 2].map((offset, digitIndex) => ({
    digitIndex,
    x: centerColumn + offset * spacing,
    y: centerRow,
    radius: radiusCells * subdivisions * emptyEnvelope,
    refillRadius: radiusCells * subdivisions * refillEnvelope,
  }));
}

/** Timer text exclusion in the frame effect's subdivision coordinates. */
export function countdownFrameTextSafeRectangle({
  layout,
  cellIndex,
  subdivisionLevel,
  textSafeZone,
}) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown frame columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown frame rows");
  const textCellIndex = requireNonNegativeInteger(
    cellIndex,
    "Countdown frame text cell",
  );
  if (textCellIndex >= columns * rows) {
    throw new RangeError("Countdown frame text cell must be inside the parent grid.");
  }
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown frame subdivision level",
  );
  const safeZone = requireObject(textSafeZone, "Countdown frame text safe zone");
  const widthInCells = requireFinitePositive(
    safeZone.widthInCells,
    "Countdown frame text safe-zone width",
  );
  const heightInCells = requireFinitePositive(
    safeZone.heightInCells,
    "Countdown frame text safe-zone height",
  );
  const subdivisions = 1 << level;
  const centerColumn = (textCellIndex % columns + 0.5) * subdivisions;
  const centerRow = (Math.floor(textCellIndex / columns) + 0.5) * subdivisions;
  return {
    left: centerColumn - widthInCells * subdivisions / 2,
    top: centerRow - heightInCells * subdivisions / 2,
    right: centerColumn + widthInCells * subdivisions / 2,
    bottom: centerRow + heightInCells * subdivisions / 2,
  };
}

export function countdownFrameAt(
  plan,
  linearProgress,
  settings,
  avoidanceCircles = [],
  visibilityNoise = null,
  dotExclusionCircles = [],
  squareExclusionRectangles = [],
) {
  const totalDotCount = plan?.squares?.length * settings.dotsPerSquare;
  if (!plan || !Array.isArray(plan.dots) || plan.dots.length !== totalDotCount) {
    throw new TypeError("Countdown frame plan requires its configured dots.");
  }
  if (!Array.isArray(avoidanceCircles)) {
    throw new TypeError("Countdown frame avoidance circles must be an array.");
  }
  if (!Array.isArray(dotExclusionCircles)) {
    throw new TypeError("Countdown frame dot-exclusion circles must be an array.");
  }
  if (!Array.isArray(squareExclusionRectangles)) {
    throw new TypeError("Countdown frame square-exclusion rectangles must be an array.");
  }
  for (const circle of dotExclusionCircles) {
    if (
      !Number.isFinite(circle?.x)
      || !Number.isFinite(circle?.y)
      || !Number.isFinite(circle?.radius)
      || circle.radius < 0
    ) {
      throw new RangeError(
        "Countdown frame dot-exclusion circles require finite coordinates and radius.",
      );
    }
  }
  for (const rectangle of squareExclusionRectangles) {
    if (
      !Number.isFinite(rectangle?.left)
      || !Number.isFinite(rectangle?.top)
      || !Number.isFinite(rectangle?.right)
      || !Number.isFinite(rectangle?.bottom)
      || rectangle.right <= rectangle.left
      || rectangle.bottom <= rectangle.top
    ) {
      throw new RangeError(
        "Countdown frame square-exclusion rectangles require finite positive bounds.",
      );
    }
  }
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  const circleAvoidedSquares = new Set(plan.squares
    .filter(square => square.dots.some(dot => avoidanceCircles.some(circle => {
      const distance = Math.hypot(
        dot.column + 0.5 - circle.x,
        dot.row + 0.5 - circle.y,
      );
      return circle.radius > 0
        && distance < circle.radius
        && distance >= (circle.refillRadius ?? 0);
    })))
    .map(square => square.squareIndex));
  const rectangleAvoidedSquares = new Set(plan.squares
    .filter(square => square.dots.some(dot => (
      squareExclusionRectangles.some(rectangle => (
        dot.column < rectangle.right
        && dot.column + 1 > rectangle.left
        && dot.row < rectangle.bottom
        && dot.row + 1 > rectangle.top
      ))
    )))
    .map(square => square.squareIndex));
  const avoidedSquares = new Set([
    ...circleAvoidedSquares,
    ...rectangleAvoidedSquares,
  ]);
  const timerEligibleDots = plan.dots.filter(
    dot => !avoidedSquares.has(dot.squareIndex),
  );
  const eligibleDots = timerEligibleDots.filter(dot => !dotExclusionCircles.some(
    circle => Math.hypot(
      dot.column + 0.5 - circle.x,
      dot.row + 0.5 - circle.y,
    ) < circle.radius,
  ));
  let dots = eligibleDots;
  if (visibilityNoise?.enabled === true) {
    const { data, width, height, layer, edgeWidthInSquares, seed } = visibilityNoise;
    if (!ArrayBuffer.isView(data) || data.length !== width * height) {
      throw new TypeError("Countdown frame visibility noise requires a complete sample plane.");
    }
    if (width !== plan.gridColumns || height !== plan.gridRows) {
      throw new RangeError("Countdown frame visibility noise must match the frame dot grid.");
    }
    requirePositiveInteger(edgeWidthInSquares, "Countdown frame noise edge width");
    const visibilitySeed = requireNonNegativeInteger(
      seed,
      "Countdown frame visibility seed",
    ) >>> 0;
    dots = eligibleDots.filter(dot => {
      if (dot.edgeDistance === null || dot.edgeDistance >= edgeWidthInSquares) {
        return true;
      }
      const edgeInfluence = 1 - dot.edgeDistance / edgeWidthInSquares;
      const sample = data[dot.row * width + dot.column] / 255;
      const noiseFill = noiseVisibilityFill(sample, layer);
      const fill = 1 - (1 - noiseFill) * edgeInfluence;
      return hashUnit(visibilitySeed, dot.index, FRAME_VISIBILITY_SALT) < fill;
    });
  }
  dots = dots.map(dot => ({ ...dot }));
  return {
    linearProgress: progress,
    progress,
    visibleCount: dots.length,
    avoidedSquareCount: avoidedSquares.size,
    rectangleAvoidedSquareCount: rectangleAvoidedSquares.size,
    eligibleVisibleCount: eligibleDots.length,
    snakeHiddenCount: timerEligibleDots.length - eligibleDots.length,
    noiseHiddenCount: eligibleDots.length - dots.length,
    dots,
  };
}

export function countdownFrameSquareCapacity(layout, subdivisionLevel = 3) {
  const columns = requirePositiveInteger(
    layout?.columns,
    "Countdown frame capacity columns",
  );
  const rows = requirePositiveInteger(layout?.rows, "Countdown frame capacity rows");
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown frame capacity subdivision level",
  );
  const subdivisions = 1 << level;
  return Math.floor(columns * subdivisions / 2)
    * Math.floor(rows * subdivisions / 2);
}

export function countdownFrameSquareCountAt(
  baseSquareCount,
  tick,
  evolveSquareCount,
  maximumSquareCount,
  countdownTickCount,
) {
  const base = requirePositiveInteger(
    baseSquareCount,
    "Countdown frame base square count",
  );
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown frame tick");
  if (typeof evolveSquareCount !== "boolean") {
    throw new TypeError("Countdown frame evolveSquareCount must be a boolean.");
  }
  const maximum = requirePositiveInteger(
    maximumSquareCount,
    "Countdown frame maximum square count",
  );
  const tickCount = requirePositiveInteger(
    countdownTickCount,
    "Countdown frame countdown tick count",
  );
  if (base > maximum) {
    throw new RangeError("Countdown frame base square count exceeds board capacity.");
  }
  if (appearanceTick >= tickCount) {
    throw new RangeError("Countdown frame tick must be inside the countdown.");
  }
  if (!evolveSquareCount) return base;
  if (tickCount === 1) return maximum;
  const progress = appearanceTick / (tickCount - 1);
  return Math.round(base + (maximum - base) * progress);
}

export function countdownFrameGrowthAt(linearProgress, settings) {
  if (typeof settings.growTowardZero !== "boolean") {
    throw new TypeError("Countdown frame growTowardZero must be a boolean.");
  }
  if (!settings.growTowardZero) return 0;
  const progress = Math.max(0, Math.min(1, Number(linearProgress) || 0));
  return cubicBezierAt(progress, settings.growthTimingCurve);
}

export function countdownFrameRadiusAt(layout, settings, growthProgress) {
  const subdivisions = 1 << settings.subdivisionLevel;
  const slot = layout.cellSize / subdivisions;
  const baseRadius = slot * 0.5 * (1 - settings.dotMargin);
  const maximumRadius = Math.hypot(layout.patternWidth, layout.patternHeight);
  const growth = Math.max(0, Math.min(1, Number(growthProgress) || 0));
  return baseRadius + (maximumRadius - baseRadius) * growth;
}

export function countdownFrameDotColors(frame, palette, flicker, time) {
  if (!frame || !Array.isArray(frame.dots)) {
    throw new TypeError("Countdown frame colors require frame dots.");
  }
  if (!Array.isArray(palette) || palette.length === 0) {
    throw new TypeError("Countdown frame colors require a palette.");
  }
  if (!Number.isFinite(time)) {
    throw new TypeError("Countdown frame flicker time must be finite.");
  }
  const canFlicker = flicker?.enabled === true
    && typeof flicker.sampleAt === "function"
    && typeof flicker.colorFromNoise === "function";
  return frame.dots.map(dot => {
    const paletteIndex = dot.squareIndex % palette.length;
    if (!canFlicker) return palette[paletteIndex];
    const sample = flicker.sampleAt(dot.column + 0.5, dot.row + 0.5, time);
    return flicker.colorFromNoise(
      paletteIndex / Math.max(1, palette.length - 1),
      sample,
    );
  });
}

export function drawCountdownFrame(
  context,
  layout,
  frame,
  settings,
  colors,
  growthProgress,
) {
  if (!settings.enabled || frame.dots.length === 0) return;
  const subdivisions = 1 << settings.subdivisionLevel;
  const slot = layout.cellSize / subdivisions;
  const radius = countdownFrameRadiusAt(layout, settings, growthProgress);

  context.save();
  for (let index = 0; index < frame.dots.length; index += 1) {
    const dot = frame.dots[index];
    const x = layout.offsetX
      + (dot.column + 0.5) * slot;
    const y = layout.offsetY
      + (dot.row + 0.5) * slot;
    context.fillStyle = colors[index];
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
