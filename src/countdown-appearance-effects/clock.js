import { resolveAutomaticDuration } from "../core/automatic-duration.js";
import { normalizeBezierCurve } from "../core/cubic-bezier.js";
import { hashUnit } from "../generators/grid-scene-strategies.js";
import {
  clockwiseDotColors,
  clockwiseSquareDots,
  clockwiseVisibleCountAt,
} from "./clockwise-square.js";

const CLOCK_COLUMN_SALT = 2203;
const CLOCK_ROW_SALT = 2207;
const CLOCK_CANDIDATE_SALT = 2213;

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

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
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
    rangeInSubdivisions: Object.freeze({ x: rangeX, y: rangeY }),
    dotMargin: clock.dotMargin,
    timingCurve: Object.freeze(normalizeBezierCurve(
      clock.timingCurve,
      "countdownFramed.appearance.effects.clock.timingCurve",
    )),
  });
}

/** Two seeded non-overlapping 2x2 tiles, placed near the active time cell. */
export function countdownClockPlan({
  seed,
  tick,
  layout,
  cellIndex,
  subdivisionLevel = 3,
  squareCount = 2,
  dotsPerSquare = 4,
  rangeInSubdivisions,
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

  const subdivisions = 1 << level;
  const gridColumns = columns * subdivisions;
  const gridRows = rows * subdivisions;
  const textCellColumn = textCellIndex % columns;
  const textCellRow = Math.floor(textCellIndex / columns);
  const textCenterColumn = textCellColumn * subdivisions + subdivisions / 2;
  const textCenterRow = textCellRow * subdivisions + subdivisions / 2;
  const candidatesByPosition = new Map();
  for (let offsetY = -rangeY; offsetY <= rangeY; offsetY += 1) {
    for (let offsetX = -rangeX; offsetX <= rangeX; offsetX += 1) {
      const topLeftColumn = Math.max(
        0,
        Math.min(gridColumns - 2, textCenterColumn - 1 + offsetX),
      );
      const topLeftRow = Math.max(
        0,
        Math.min(gridRows - 2, textCenterRow - 1 + offsetY),
      );
      const key = `${topLeftColumn}:${topLeftRow}`;
      if (!candidatesByPosition.has(key)) {
        candidatesByPosition.set(key, {
          topLeftColumn,
          topLeftRow,
          offsetX: topLeftColumn - (textCenterColumn - 1),
          offsetY: topLeftRow - (textCenterRow - 1),
        });
      }
    }
  }
  const candidates = [...candidatesByPosition.values()];
  const usedDotIndices = new Set();
  const squares = [];
  for (let squareIndex = 0; squareIndex < squaresRequested; squareIndex += 1) {
    const ranked = candidates.map((candidate, candidateIndex) => ({
      ...candidate,
      rank: hashUnit(
        planSeed ^ Math.imul(appearanceTick + 1, CLOCK_COLUMN_SALT),
        candidateIndex,
        CLOCK_CANDIDATE_SALT + squareIndex * CLOCK_ROW_SALT,
      ),
    })).sort((first, second) => first.rank - second.rank);
    const selected = ranked.find(candidate => {
      const dots = clockwiseSquareDots(
        candidate.topLeftColumn,
        candidate.topLeftRow,
        gridColumns,
        squareIndex,
      );
      return dots.every(dot => !usedDotIndices.has(dot.index));
    });
    if (!selected) {
      throw new RangeError(
        "Countdown clock range cannot fit two non-overlapping 2x2 squares.",
      );
    }
    const dots = clockwiseSquareDots(
      selected.topLeftColumn,
      selected.topLeftRow,
      gridColumns,
      squareIndex,
    ).map(dot => ({ ...dot, appearanceTick }));
    dots.forEach(dot => usedDotIndices.add(dot.index));
    squares.push({
      squareIndex,
      offsetX: selected.offsetX,
      offsetY: selected.offsetY,
      topLeftColumn: selected.topLeftColumn,
      topLeftRow: selected.topLeftRow,
      dots,
    });
  }
  const dots = squares.flatMap(square => square.dots);

  return {
    seed: planSeed,
    tick: appearanceTick,
    subdivisions,
    gridColumns,
    gridRows,
    textCellIndex,
    squares,
    dots,
  };
}

export function countdownClockFrame(plan, linearProgress, settings) {
  const totalDotCount = settings.squareCount * settings.dotsPerSquare;
  if (!plan || !Array.isArray(plan.dots) || plan.dots.length !== totalDotCount) {
    throw new TypeError("Countdown clock plan requires its configured dots.");
  }
  const progress = clockwiseVisibleCountAt(
    linearProgress,
    settings.dotsPerSquare,
    settings.timingCurve,
  );
  return {
    linearProgress: progress.linearProgress,
    progress: progress.progress,
    visiblePerSquare: progress.visibleCount,
    visibleCount: progress.visibleCount * settings.squareCount,
    dots: plan.dots
      .filter(dot => dot.clockwiseIndex < progress.visibleCount)
      .map(dot => ({ ...dot })),
  };
}

export function countdownClockDotColors(frame, palette, flicker, time) {
  return clockwiseDotColors(frame, palette, flicker, time);
}

export function drawCountdownClock(context, layout, frame, settings, colors) {
  if (!settings.enabled || frame.dots.length === 0) return;
  const subdivisions = 1 << settings.subdivisionLevel;
  const slot = layout.cellSize / subdivisions;
  const radius = slot * 0.5 * (1 - settings.dotMargin);

  context.save();
  for (let index = 0; index < frame.dots.length; index += 1) {
    const dot = frame.dots[index];
    const x = layout.offsetX + (dot.column + 0.5) * slot;
    const y = layout.offsetY + (dot.row + 0.5) * slot;
    context.fillStyle = colors[index];
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
