import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import { normalizeBezierCurve } from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";
import {
  clockwiseDotColors,
  clockwiseGridDots,
  clockwiseSquareDots,
  clockwiseVisibleCountAt,
} from "./clockwise-square.js";

const CLOCK_COLUMN_SALT = 2203;
const CLOCK_ROW_SALT = 2207;
const CLOCK_CANDIDATE_SALT = 2213;
const CLOCK_PAIR_SALT = 2219;

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

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function rectanglesOverlap(first, second, gap = 0) {
  return first.left < second.right + gap
    && first.right + gap > second.left
    && first.top < second.bottom + gap
    && first.bottom + gap > second.top;
}

function clockRectangle(left, top, size) {
  return {
    left,
    top,
    right: left + size,
    bottom: top + size,
  };
}

function clockReservationCandidates({
  textCenterColumn,
  textCenterRow,
  gridColumns,
  gridRows,
  maximumSquareSize,
  rangeX,
  rangeY,
  expansion,
}) {
  const candidates = new Map();
  for (let offsetY = -rangeY - expansion; offsetY <= rangeY + expansion; offsetY += 1) {
    for (let offsetX = -rangeX - expansion; offsetX <= rangeX + expansion; offsetX += 1) {
      const left = Math.max(0, Math.min(
        gridColumns - maximumSquareSize,
        Math.round(textCenterColumn + offsetX - maximumSquareSize / 2),
      ));
      const top = Math.max(0, Math.min(
        gridRows - maximumSquareSize,
        Math.round(textCenterRow + offsetY - maximumSquareSize / 2),
      ));
      const key = `${left}:${top}`;
      if (!candidates.has(key)) {
        candidates.set(key, {
          ...clockRectangle(left, top, maximumSquareSize),
          centerColumn: left + maximumSquareSize / 2,
          centerRow: top + maximumSquareSize / 2,
        });
      }
    }
  }
  return [...candidates.values()];
}

function selectClockReservations({
  seed,
  tick,
  textCenterColumn,
  textCenterRow,
  textSafeZone,
  gridColumns,
  gridRows,
  maximumSquareSize,
  rangeX,
  rangeY,
  minimumSquareGap,
}) {
  let previousCandidateSignature = null;
  for (let expansion = 0; ; expansion += 1) {
    const allCandidates = clockReservationCandidates({
      textCenterColumn,
      textCenterRow,
      gridColumns,
      gridRows,
      maximumSquareSize,
      rangeX,
      rangeY,
      expansion,
    });
    const candidateSignature = allCandidates
      .map(candidate => `${candidate.left}:${candidate.top}`)
      .sort()
      .join(",");
    if (candidateSignature === previousCandidateSignature) break;
    previousCandidateSignature = candidateSignature;
    const candidates = allCandidates.filter(
      candidate => !rectanglesOverlap(candidate, textSafeZone),
    );

    let selected = null;
    const selectionSeed = seed ^ Math.imul(tick + 1, CLOCK_COLUMN_SALT);
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const first = candidates[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const second = candidates[secondIndex];
        if (rectanglesOverlap(first, second, minimumSquareGap)) continue;
        const firstId = first.top * gridColumns + first.left;
        const secondId = second.top * gridColumns + second.left;
        const rank = hashUnit(
          selectionSeed ^ Math.imul(firstId + 1, CLOCK_CANDIDATE_SALT),
          secondId,
          CLOCK_PAIR_SALT,
        );
        const distance = (
          (first.centerColumn - textCenterColumn) ** 2
          + (first.centerRow - textCenterRow) ** 2
          + (second.centerColumn - textCenterColumn) ** 2
          + (second.centerRow - textCenterRow) ** 2
        );
        if (
          selected === null
          || rank < selected.rank
          || (rank === selected.rank && distance < selected.distance)
        ) {
          selected = { first, second, rank, distance };
        }
      }
    }
    if (selected !== null) {
      const swap = hashUnit(selectionSeed, expansion, CLOCK_ROW_SALT) < 0.5;
      return {
        expansion,
        reservations: swap
          ? [selected.second, selected.first]
          : [selected.first, selected.second],
      };
    }
  }
  throw new RangeError(
    "Countdown clock safe zones cannot fit two maximum-size square reservations on this board.",
  );
}

export function resolveCountdownClockSettings(appearance, beatSeconds) {
  const authored = requireObject(appearance, "countdownFramed.appearance");
  const seed = requireNonNegativeInteger(
    authored.seed,
    "countdownFramed.appearance.seed",
  );
  if (typeof authored.evolveSeed !== "boolean") {
    throw new TypeError("countdownFramed.appearance.evolveSeed must be a boolean.");
  }
  const clock = requireObject(
    authored.effects?.clock,
    "countdownFramed.appearance.effects.clock",
  );
  if (typeof clock.enabled !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.enabled must be a boolean.",
    );
  }
  const duration = resolveAutomaticDuration(clock.durationSeconds, {
    label: "countdownFramed.appearance.effects.clock.durationSeconds",
    candidates: [{ source: "composition-beat", seconds: beatSeconds }],
  });
  if (Math.abs(duration.seconds - beatSeconds) > 1e-9) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.durationSeconds must equal one composition beat.",
    );
  }
  const subdivisionLevel = requireNonNegativeInteger(
    clock.subdivisionLevel,
    "countdownFramed.appearance.effects.clock.subdivisionLevel",
  );
  if (subdivisionLevel !== 3) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.subdivisionLevel must be three (8x8).",
    );
  }
  const squareCount = requirePositiveInteger(
    clock.squareCount,
    "countdownFramed.appearance.effects.clock.squareCount",
  );
  if (squareCount !== 2) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.squareCount must be two.",
    );
  }
  const dotsPerSquare = requirePositiveInteger(
    clock.dotsPerSquare,
    "countdownFramed.appearance.effects.clock.dotsPerSquare",
  );
  if (dotsPerSquare !== 4) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.dotsPerSquare must be four.",
    );
  }
  if (typeof clock.behindText !== "boolean") {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.behindText must be a boolean.",
    );
  }
  if (!Array.isArray(clock.evolutionSquareSizes) || clock.evolutionSquareSizes.length === 0) {
    throw new TypeError(
      "countdownFramed.appearance.effects.clock.evolutionSquareSizes must be an array.",
    );
  }
  const evolutionSquareSizes = clock.evolutionSquareSizes.map((size, index) => {
    const resolved = requirePositiveInteger(
      size,
      `countdownFramed.appearance.effects.clock.evolutionSquareSizes[${index}]`,
    );
    if (resolved < 3 || resolved > (1 << subdivisionLevel)) {
      throw new RangeError(
        "countdownFramed.appearance.effects.clock.evolutionSquareSizes "
        + "must stay between 3 and the subdivision count.",
      );
    }
    if (index > 0 && resolved <= clock.evolutionSquareSizes[index - 1]) {
      throw new RangeError(
        "countdownFramed.appearance.effects.clock.evolutionSquareSizes "
        + "must increase strictly.",
      );
    }
    return resolved;
  });
  const range = requireObject(
    clock.rangeInSubdivisions,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions",
  );
  const rangeX = requireNonNegativeInteger(
    range.x,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions.x",
  );
  const rangeY = requireNonNegativeInteger(
    range.y,
    "countdownFramed.appearance.effects.clock.rangeInSubdivisions.y",
  );
  const textSafeZone = requireObject(
    clock.textSafeZone,
    "countdownFramed.appearance.effects.clock.textSafeZone",
  );
  const textSafeZoneWidthInCells = requireFinitePositive(
    textSafeZone.widthInCells,
    "countdownFramed.appearance.effects.clock.textSafeZone.widthInCells",
  );
  const textSafeZoneHeightInCells = requireFinitePositive(
    textSafeZone.heightInCells,
    "countdownFramed.appearance.effects.clock.textSafeZone.heightInCells",
  );
  const minimumSquareGapInSubdivisions = requireNonNegativeInteger(
    clock.minimumSquareGapInSubdivisions,
    "countdownFramed.appearance.effects.clock.minimumSquareGapInSubdivisions",
  );
  if (!Number.isFinite(clock.dotMargin) || clock.dotMargin < 0 || clock.dotMargin >= 1) {
    throw new RangeError(
      "countdownFramed.appearance.effects.clock.dotMargin must be from zero up to one.",
    );
  }

  return Object.freeze({
    enabled: clock.enabled,
    seed: seed >>> 0,
    evolveSeed: authored.evolveSeed,
    palette: requireString(
      clock.palette,
      "countdownFramed.appearance.effects.clock.palette",
    ),
    duration,
    subdivisionLevel,
    squareCount,
    dotsPerSquare,
    behindText: clock.behindText,
    evolutionSquareSizes: Object.freeze(evolutionSquareSizes),
    rangeInSubdivisions: Object.freeze({ x: rangeX, y: rangeY }),
    textSafeZone: Object.freeze({
      widthInCells: textSafeZoneWidthInCells,
      heightInCells: textSafeZoneHeightInCells,
    }),
    minimumSquareGapInSubdivisions,
    dotMargin: clock.dotMargin,
    timingCurve: Object.freeze(normalizeBezierCurve(
      clock.timingCurve,
      "countdownFramed.appearance.effects.clock.timingCurve",
    )),
  });
}

export function countdownClockEvolutionAt(
  enabled,
  progress,
  squareSizes,
) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("Countdown clock evolution enabled must be a boolean.");
  }
  if (!Array.isArray(squareSizes) || squareSizes.length === 0) {
    throw new TypeError("Countdown clock evolution requires square sizes.");
  }
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0));
  if (!enabled) {
    return { mode: "clock", progress: 0, squareSize: 2, squareCount: 2 };
  }
  if (normalized >= 1) {
    return {
      mode: "snake-origin",
      progress: 1,
      squareSize: 1,
      squareCount: 1,
    };
  }
  const sizeIndex = Math.min(
    squareSizes.length - 1,
    Math.max(0, Math.ceil(normalized * squareSizes.length - 1e-12)),
  );
  return {
    mode: "expanding",
    progress: normalized,
    squareSize: squareSizes[sizeIndex],
    squareCount: 2,
  };
}

/** Two seeded grids inside disjoint maximum-size reservations near the timer. */
export function countdownClockPlan({
  seed,
  tick,
  layout,
  cellIndex,
  subdivisionLevel = 3,
  squareCount = 2,
  dotsPerSquare = 4,
  evolutionSquareSizes = [3, 4, 8],
  evolutionEnabled = false,
  evolutionProgress = 0,
  handoffCellIndex = cellIndex,
  rangeInSubdivisions,
  textSafeZone = { widthInCells: 1.25, heightInCells: 0.75 },
  minimumSquareGapInSubdivisions = 1,
}) {
  const planSeed = requireNonNegativeInteger(seed, "Countdown clock seed") >>> 0;
  const appearanceTick = requireNonNegativeInteger(tick, "Countdown clock tick");
  const columns = requirePositiveInteger(layout?.columns, "Countdown clock columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown clock rows");
  const textCellIndex = requireNonNegativeInteger(
    cellIndex,
    "Countdown clock text cell",
  );
  if (textCellIndex >= columns * rows) {
    throw new RangeError("Countdown clock text cell must be inside the parent grid.");
  }
  const snakeOriginCellIndex = requireNonNegativeInteger(
    handoffCellIndex,
    "Countdown clock handoff cell",
  );
  if (snakeOriginCellIndex >= columns * rows) {
    throw new RangeError("Countdown clock handoff cell must be inside the parent grid.");
  }
  const level = requireNonNegativeInteger(
    subdivisionLevel,
    "Countdown clock subdivision level",
  );
  if (level !== 3) {
    throw new RangeError("Countdown clock subdivision level must be three (8x8).");
  }
  const squaresRequested = requirePositiveInteger(
    squareCount,
    "Countdown clock square count",
  );
  if (squaresRequested !== 2) {
    throw new RangeError("Countdown clock square count must be two.");
  }
  const dotsRequested = requirePositiveInteger(
    dotsPerSquare,
    "Countdown clock dots per square",
  );
  if (dotsRequested !== 4) {
    throw new RangeError("Countdown clock dots per square must be four.");
  }
  const range = requireObject(rangeInSubdivisions, "Countdown clock range");
  const rangeX = requireNonNegativeInteger(range.x, "Countdown clock horizontal range");
  const rangeY = requireNonNegativeInteger(range.y, "Countdown clock vertical range");
  const safeZone = requireObject(textSafeZone, "Countdown clock text safe zone");
  const safeZoneWidthInCells = requireFinitePositive(
    safeZone.widthInCells,
    "Countdown clock text safe-zone width",
  );
  const safeZoneHeightInCells = requireFinitePositive(
    safeZone.heightInCells,
    "Countdown clock text safe-zone height",
  );
  const minimumSquareGap = requireNonNegativeInteger(
    minimumSquareGapInSubdivisions,
    "Countdown clock minimum square gap",
  );

  const subdivisions = 1 << level;
  const gridColumns = columns * subdivisions;
  const gridRows = rows * subdivisions;
  const maximumSquareSize = Math.max(
    2,
    ...evolutionSquareSizes.map((size, index) => requirePositiveInteger(
      size,
      `Countdown clock evolution square size ${index}`,
    )),
  );
  if (maximumSquareSize > gridColumns || maximumSquareSize > gridRows) {
    throw new RangeError(
      "Countdown clock maximum square size must fit inside the subdivision grid.",
    );
  }
  const textCellColumn = textCellIndex % columns;
  const textCellRow = Math.floor(textCellIndex / columns);
  const textCenterColumn = textCellColumn * subdivisions + subdivisions / 2;
  const textCenterRow = textCellRow * subdivisions + subdivisions / 2;
  const safeZoneWidth = safeZoneWidthInCells * subdivisions;
  const safeZoneHeight = safeZoneHeightInCells * subdivisions;
  const resolvedTextSafeZone = {
    left: textCenterColumn - safeZoneWidth / 2,
    top: textCenterRow - safeZoneHeight / 2,
    right: textCenterColumn + safeZoneWidth / 2,
    bottom: textCenterRow + safeZoneHeight / 2,
    widthInCells: safeZoneWidthInCells,
    heightInCells: safeZoneHeightInCells,
  };
  const evolution = countdownClockEvolutionAt(
    evolutionEnabled,
    evolutionProgress,
    evolutionSquareSizes,
  );
  const handoffCenterColumn = (snakeOriginCellIndex % columns) * subdivisions
    + subdivisions / 2;
  const handoffCenterRow = Math.floor(snakeOriginCellIndex / columns) * subdivisions
    + subdivisions / 2;
  if (evolution.mode === "snake-origin") {
    const snakeOriginBounds = clockRectangle(
      (snakeOriginCellIndex % columns) * subdivisions,
      Math.floor(snakeOriginCellIndex / columns) * subdivisions,
      subdivisions,
    );
    if (rectanglesOverlap(snakeOriginBounds, resolvedTextSafeZone)) {
      throw new RangeError(
        "Countdown clock snake origin overlaps the timer text safe zone.",
      );
    }
    const dots = [{
      column: handoffCenterColumn - 0.5,
      row: handoffCenterRow - 0.5,
      index: snakeOriginCellIndex * subdivisions * subdivisions,
      squareIndex: 0,
      clockwiseIndex: 0,
      palettePosition: 0,
      sizeInSubdivisions: subdivisions,
      appearanceTick,
      cellIndex: snakeOriginCellIndex,
    }];
    const squares = [{
      squareIndex: 0,
      topLeftColumn: handoffCenterColumn - 0.5,
      topLeftRow: handoffCenterRow - 0.5,
      dots,
    }];
    return {
      seed: planSeed,
      tick: appearanceTick,
      subdivisions,
      gridColumns,
      gridRows,
      textCellIndex,
      textSafeZone: resolvedTextSafeZone,
      minimumSquareGapInSubdivisions: minimumSquareGap,
      maximumSquareSize,
      reservationExpansion: null,
      snakeOriginBounds,
      handoffCellIndex: snakeOriginCellIndex,
      evolutionMode: evolution.mode,
      evolutionProgress: evolution.progress,
      squareSize: evolution.squareSize,
      squares,
      dots,
    };
  }

  const selection = selectClockReservations({
    seed: planSeed,
    tick: appearanceTick,
    textCenterColumn,
    textCenterRow,
    textSafeZone: resolvedTextSafeZone,
    gridColumns,
    gridRows,
    maximumSquareSize,
    rangeX,
    rangeY,
    minimumSquareGap,
  });
  const squares = selection.reservations.map((reservation, squareIndex) => {
    const remainingSpace = maximumSquareSize - evolution.squareSize;
    const inset = squareIndex % 2 === 0
      ? Math.floor(remainingSpace / 2)
      : Math.ceil(remainingSpace / 2);
    const topLeftColumn = reservation.left + inset;
    const topLeftRow = reservation.top + inset;
    const clockDots = evolution.squareSize === 2
      ? clockwiseSquareDots(
        topLeftColumn,
        topLeftRow,
        gridColumns,
        squareIndex,
      )
      : clockwiseGridDots(
        topLeftColumn,
        topLeftRow,
        evolution.squareSize,
        gridColumns,
        squareIndex,
      );
    return {
      squareIndex,
      offsetX: reservation.centerColumn - textCenterColumn,
      offsetY: reservation.centerRow - textCenterRow,
      topLeftColumn,
      topLeftRow,
      reservation: {
        left: reservation.left,
        top: reservation.top,
        right: reservation.right,
        bottom: reservation.bottom,
      },
      dots: clockDots.map(dot => ({ ...dot, appearanceTick })),
    };
  });
  const dots = squares.flatMap(square => square.dots);

  return {
    seed: planSeed,
    tick: appearanceTick,
    subdivisions,
    gridColumns,
    gridRows,
    textCellIndex,
    textSafeZone: resolvedTextSafeZone,
    minimumSquareGapInSubdivisions: minimumSquareGap,
    maximumSquareSize,
    reservationExpansion: selection.expansion,
    snakeOriginBounds: null,
    handoffCellIndex: snakeOriginCellIndex,
    evolutionMode: evolution.mode,
    evolutionProgress: evolution.progress,
    squareSize: evolution.squareSize,
    squares,
    dots,
  };
}

export function validateCountdownClockLayout(layout, settings) {
  const columns = requirePositiveInteger(layout?.columns, "Countdown clock columns");
  const rows = requirePositiveInteger(layout?.rows, "Countdown clock rows");
  if (!settings?.enabled) {
    return { checkedCellCount: 0, maximumSquareSize: 0 };
  }
  for (let cellIndex = 0; cellIndex < columns * rows; cellIndex += 1) {
    countdownClockPlan({
      seed: settings.seed,
      tick: cellIndex,
      layout,
      cellIndex,
      subdivisionLevel: settings.subdivisionLevel,
      squareCount: settings.squareCount,
      dotsPerSquare: settings.dotsPerSquare,
      evolutionSquareSizes: settings.evolutionSquareSizes,
      evolutionEnabled: false,
      handoffCellIndex: cellIndex,
      rangeInSubdivisions: settings.rangeInSubdivisions,
      textSafeZone: settings.textSafeZone,
      minimumSquareGapInSubdivisions:
        settings.minimumSquareGapInSubdivisions,
    });
  }
  return {
    checkedCellCount: columns * rows,
    maximumSquareSize: Math.max(2, ...settings.evolutionSquareSizes),
  };
}

export function countdownClockFrame(plan, linearProgress, settings) {
  const dotsPerSquare = plan?.squareSize * plan?.squareSize;
  const totalDotCount = plan?.squares?.length * dotsPerSquare;
  if (!plan || !Array.isArray(plan.dots) || plan.dots.length !== totalDotCount) {
    throw new TypeError("Countdown clock plan requires its configured dots.");
  }
  const progress = clockwiseVisibleCountAt(
    linearProgress,
    dotsPerSquare,
    settings.timingCurve,
  );
  return {
    linearProgress: progress.linearProgress,
    progress: progress.progress,
    visiblePerSquare: progress.visibleCount,
    visibleCount: progress.visibleCount * plan.squares.length,
    totalDotCount,
    evolutionMode: plan.evolutionMode,
    evolutionProgress: plan.evolutionProgress,
    squareSize: plan.squareSize,
    handoffCellIndex: plan.handoffCellIndex,
    squares: plan.squares.map(square => ({
      squareIndex: square.squareIndex,
      topLeftColumn: square.topLeftColumn,
      topLeftRow: square.topLeftRow,
    })),
    dots: plan.dots
      .filter(dot => dot.clockwiseIndex < progress.visibleCount)
      .map(dot => ({ ...dot })),
  };
}

export function countdownClockDotColors(frame, palette, flicker, time) {
  return clockwiseDotColors(frame, palette, flicker, time);
}

export function drawCountdownClock(
  context,
  layout,
  frame,
  settings,
  colors,
) {
  if (!settings.enabled || frame.dots.length === 0) return;
  const subdivisions = 1 << settings.subdivisionLevel;
  const slot = layout.cellSize / subdivisions;
  const radius = slot * 0.5 * (1 - settings.dotMargin);

  context.save();
  for (let index = 0; index < frame.dots.length; index += 1) {
    const dot = frame.dots[index];
    const x = layout.offsetX + (dot.column + 0.5) * slot;
    const y = layout.offsetY + (dot.row + 0.5) * slot;
    const dotRadius = radius * (dot.sizeInSubdivisions ?? 1);
    context.fillStyle = colors[index];
    context.beginPath();
    context.moveTo(x + dotRadius, y);
    context.arc(x, y, dotRadius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
