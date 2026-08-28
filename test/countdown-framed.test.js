import test from "node:test";
import assert from "node:assert/strict";

import { COMPOSITION_DEFINITIONS, PALETTES, SETTINGS } from "../config.js";
import {
  CountdownFramedGenerator,
  countdownCellIndex,
  countdownPalette,
  countdownRevealPaletteIndices,
  formatCountdown,
} from "../src/generators/countdown-framed-generator.js";
import {
  countdownClockEvolutionAt,
  countdownClockFrame,
  countdownClockPlan,
} from "../src/countdown-appearance-effects/clock.js";
import {
  countdownAppearanceStageAt,
  resolveCountdownAppearanceOrder,
} from "../src/countdown-appearance-effects/order.js";
import {
  countdownFrameAt,
  countdownFrameAvoidanceEnvelopesAt,
  countdownFrameAvoidanceRadiusAt,
  countdownFrameDigitCircles,
  countdownFrameDotColors,
  countdownFrameGrowthAt,
  countdownFrameNoiseBeatOffsetAt,
  countdownFramePlan,
  countdownFramePlanWithSnakeTrail,
  countdownFrameRadiusAt,
  countdownFrameSquareCapacity,
  countdownFrameSquareCountAt,
  countdownFrameSquaresWithEdgeDistance,
  countdownFrameTextSafeRectangle,
  countdownSnakeBubbleExclusionCircles,
  countdownSnakeBubblePlan,
} from "../src/countdown-appearance-effects/frame.js";
import {
  countdownAppearanceSeed,
  countdownSnakeFrame,
  countdownSnakeLengthAt,
  countdownSnakeMergeFrame,
  countdownSnakePath,
  countdownSnakeSubdivisionLevel,
  countdownSnakeTextSafeCells,
} from "../src/countdown-appearance-effects/snake.js";
import { manhattanGridDistance } from "../src/generators/pathfinding-strategies.js";
import { createCountingContext, runFrames } from "../src/debug/headless.js";

function createGenerator({
  seed = 123,
  viewport = { width: 900, height: 600 },
  options = SETTINGS.countdownFramed,
} = {}) {
  return new CountdownFramedGenerator({
    name: "countdownFramedGrid",
    settingsKey: "countdownFramed",
    options,
    settings: SETTINGS,
    palettes: PALETTES,
    runtime: {
      viewport: () => viewport,
      projectSeed: () => seed,
    },
  });
}

function createFramePlan({
  seed = 42,
  tick = 0,
  layout = { columns: 3, rows: 3 },
  cellIndex = 4,
  squareCount = 2,
  minimumSquareCount = 2,
  excludedTileIndices = [],
  squareIndexOffset = 0,
} = {}) {
  return countdownFramePlan({
    seed,
    tick,
    layout,
    cellIndex,
    subdivisionLevel: 3,
    squareCount,
    minimumSquareCount,
    dotsPerSquare: 4,
    numberSpacingInSubdivisions: 1.25,
    excludedTileIndices,
    squareIndexOffset,
  });
}

function frameDotIdentity(dots) {
  return dots.map(dot => ({
    index: dot.index,
    column: dot.column,
    row: dot.row,
    squareIndex: dot.squareIndex,
    appearanceTick: dot.appearanceTick,
  }));
}

function clockSquareBounds(square, squareSize) {
  return {
    left: square.topLeftColumn,
    top: square.topLeftRow,
    right: square.topLeftColumn + squareSize,
    bottom: square.topLeftRow + squareSize,
  };
}

function clockBoundsOverlap(first, second, gap = 0) {
  return first.left < second.right + gap
    && first.right + gap > second.left
    && first.top < second.bottom + gap
    && first.bottom + gap > second.top;
}

function assertClockSafeZones(plan) {
  if (plan.evolutionMode === "snake-origin") {
    assert.equal(
      clockBoundsOverlap(plan.snakeOriginBounds, plan.textSafeZone),
      false,
    );
    return;
  }
  const squareBounds = plan.squares.map(square => (
    clockSquareBounds(square, plan.squareSize)
  ));
  assert.ok(squareBounds.every(bounds => (
    !clockBoundsOverlap(bounds, plan.textSafeZone)
  )));
  assert.equal(
    clockBoundsOverlap(
      squareBounds[0],
      squareBounds[1],
      plan.minimumSquareGapInSubdivisions,
    ),
    false,
  );
  const reservations = plan.squares.map(square => square.reservation);
  assert.ok(reservations.every(Boolean));
  assert.ok(reservations.every(reservation => (
    !clockBoundsOverlap(reservation, plan.textSafeZone)
  )));
  assert.equal(
    clockBoundsOverlap(
      reservations[0],
      reservations[1],
      plan.minimumSquareGapInSubdivisions,
    ),
    false,
  );
}

test("countdown labels include the full 03:00 through 00:00 range", () => {
  assert.equal(formatCountdown(180), "03:00");
  assert.equal(formatCountdown(179), "02:59");
  assert.equal(formatCountdown(1), "00:01");
  assert.equal(formatCountdown(0), "00:00");
});

test("countdown chooses deterministic cells at least three parent cells apart", () => {
  const layout = { columns: 11, rows: 7 };
  const cycleLength = 181;
  const first = Array.from({ length: 181 }, (_, tick) => (
    countdownCellIndex(42, tick, layout, 3, cycleLength)
  ));
  const second = Array.from({ length: 181 }, (_, tick) => (
    countdownCellIndex(42, tick, layout, 3, cycleLength)
  ));

  assert.deepEqual(first, second);
  assert.ok(first.every(index => index >= 0 && index < 77));
  assert.ok(first.slice(1).every((index, tick) => (
    manhattanGridDistance(layout, index, first[tick]) >= 3
  )));
  assert.ok(manhattanGridDistance(layout, first.at(-1), first[0]) >= 3);
  assert.notDeepEqual(
    first,
    Array.from({ length: 181 }, (_, tick) => (
      countdownCellIndex(43, tick, layout, 3, cycleLength)
    )),
  );
  assert.throws(
    () => countdownCellIndex(42, 1, { columns: 2, rows: 1 }, 3, cycleLength),
    /cannot keep cells 3 parent cells apart/,
  );
});

test("countdown uses countFromSeconds as its duration and beat count", () => {
  const countFromSeconds = SETTINGS.countdownFramed.countFromSeconds;
  const generator = createGenerator();
  generator.enter({ time: 0 });

  generator.update({ time: 0.999 });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds));
  const firstCell = generator.inspect().cellIndex;

  generator.update({ time: 1 });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds - 1));
  assert.notEqual(generator.inspect().cellIndex, firstCell);

  generator.update({ time: countFromSeconds - 0.001 });
  assert.equal(generator.inspect().label, "00:01");
  generator.update({ time: countFromSeconds });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds));
  assert.equal(generator.animationDuration(), countFromSeconds);
  assert.deepEqual(COMPOSITION_DEFINITIONS["countdown-framed"].timing, {
    bodyDurationSeconds: countFromSeconds,
    beatCount: countFromSeconds,
  });
});

test("countdown orders equal clock, snake, and bubbles stages", () => {
  const order = resolveCountdownAppearanceOrder(
    SETTINGS.countdownFramed.appearance,
    30,
  );
  assert.equal(order.stageDurationSeconds, 10);
  assert.deepEqual(
    [0, 5, 10, 15, 20, 25, 30].map(time => {
      const stage = countdownAppearanceStageAt(time, order);
      return [stage.effect, stage.phase, stage.evolutionEnabled];
    }),
    [
      ["clock", "stable", false],
      ["clock", "evolving", true],
      ["snake", "stable", false],
      ["snake", "evolving", true],
      ["bubbles", "evolving", true],
      ["bubbles", "evolving", true],
      ["clock", "stable", false],
    ],
  );
  assert.equal(order.windows[2].evolutionStartsAt, 0);
  const sevenSecondOrder = resolveCountdownAppearanceOrder(
    SETTINGS.countdownFramed.appearance,
    7,
  );
  assert.equal(
    countdownAppearanceStageAt(7 / 3, sevenSecondOrder).effect,
    "snake",
  );
  assert.equal(
    countdownAppearanceStageAt(14 / 3, sevenSecondOrder).effect,
    "bubbles",
  );
});

test("countdown intro spreads palette steps outward from the center colon", () => {
  assert.deepEqual(
    countdownPalette(SETTINGS.countdownFramed, PALETTES),
    ["#2C6731", "#489F4C", "#93DDB1", "#FFFFFF"],
  );
  assert.deepEqual(countdownRevealPaletteIndices("03:00", 4, 0), [0, 0, 0, 0, 0]);
  assert.deepEqual(countdownRevealPaletteIndices("03:00", 4, 1), [0, 0, 1, 0, 0]);
  assert.deepEqual(countdownRevealPaletteIndices("03:00", 4, 2), [0, 1, 2, 1, 0]);
  assert.deepEqual(countdownRevealPaletteIndices("03:00", 4, 3), [1, 2, 3, 2, 1]);
  assert.deepEqual(countdownRevealPaletteIndices("03:00", 4, 5), [3, 3, 3, 3, 3]);
});

test("countdown intro derives its steps and final-color hold from one beat", () => {
  const generator = createGenerator();
  generator.enter({ time: 0 });
  const reveal = generator.inspect().reveal;
  const { stepCount, stepSeconds } = reveal;
  const authoredDuration = SETTINGS.countdownFramed.textReveal.durationSeconds;
  const durationMultiplier = Number(/\*\s*([\d.]+)/.exec(authoredDuration)?.[1]);
  assert.equal(stepCount, 5);
  assert.equal(reveal.authoredDuration, authoredDuration);
  assert.equal(reveal.durationSource, "composition-beat");
  assert.equal(reveal.durationMultiplier, durationMultiplier);
  assert.equal(reveal.durationSeconds, durationMultiplier);
  assert.equal(stepSeconds, durationMultiplier / 5);
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [0, 0, 0, 0, 0]);

  generator.update({ time: stepSeconds });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [0, 0, 1, 0, 0]);
  generator.update({ time: stepSeconds * stepCount });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [3, 3, 3, 3, 3]);
  generator.update({ time: 0.999 });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [3, 3, 3, 3, 3]);
  generator.update({ time: 1 });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [0, 0, 0, 0, 0]);
  generator.dispose();
});

test("countdown appearance seed stays fixed unless evolution is enabled", () => {
  assert.equal(SETTINGS.countdownFramed.appearance.evolveSeed, false);
  assert.equal(countdownAppearanceSeed(123, 9, 0, false), 114);
  assert.equal(countdownAppearanceSeed(123, 9, 40, false), 114);
  assert.notEqual(
    countdownAppearanceSeed(123, 9, 0, true),
    countdownAppearanceSeed(123, 9, 40, true),
  );
});

test("snake builds a deterministic shortest cardinal route", () => {
  const layout = { columns: 5, rows: 4 };
  const first = countdownSnakePath(layout, 0, 19, 42);
  const second = countdownSnakePath(layout, 0, 19, 42);

  assert.deepEqual(first, second);
  assert.equal(first[0], 0);
  assert.equal(first.at(-1), 19);
  assert.equal(first.length, 8);
  assert.ok(first.slice(1).every((cell, index) => {
    const previous = first[index];
    const columnDistance = Math.abs(cell % 5 - previous % 5);
    const rowDistance = Math.abs(Math.floor(cell / 5) - Math.floor(previous / 5));
    return columnDistance + rowDistance === 1;
  }));
  assert.notDeepEqual(first, countdownSnakePath(layout, 0, 19, 43));
});

test("snake routes around every parent cell touched by the timer safe zone", () => {
  const layout = { columns: 5, rows: 3 };
  const textSafeCellIndices = countdownSnakeTextSafeCells(
    layout,
    0,
    { widthInCells: 1.25, heightInCells: 0.75 },
  );
  assert.deepEqual(textSafeCellIndices, [0, 1]);

  const path = countdownSnakePath(layout, 0, 4, 42, textSafeCellIndices);
  assert.deepEqual(
    path,
    countdownSnakePath(layout, 0, 4, 42, textSafeCellIndices),
  );
  assert.equal(path[0], 0);
  assert.equal(path.at(-1), 4);
  assert.ok(path.slice(1).every(index => !textSafeCellIndices.includes(index)));
  assert.ok(path.slice(1).every((cell, index) => (
    manhattanGridDistance(layout, path[index], cell) === 1
  )));

  const alreadySafeDirectPath = countdownSnakePath(layout, 0, 14, 1);
  assert.deepEqual(
    countdownSnakePath(layout, 0, 14, 1, textSafeCellIndices),
    alreadySafeDirectPath,
  );
  assert.throws(
    () => countdownSnakePath(layout, 0, 4, 42, [4]),
    /target cannot be a blocked cell/,
  );
  assert.throws(
    () => countdownSnakePath({ columns: 3, rows: 1 }, 0, 2, 42, [1]),
    /cannot avoid the blocked cells/,
  );
});

test("snake remaps its body from biggest through smallest to biggest", () => {
  assert.deepEqual(
    Array.from({ length: 7 }, (_, index) => (
      countdownSnakeSubdivisionLevel(index, 7, 3)
    )),
    [0, 1, 2, 3, 2, 1, 0],
  );
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => (
      countdownSnakeSubdivisionLevel(index, 6, 3)
    )),
    [0, 2, 3, 3, 2, 0],
  );
  assert.equal(countdownSnakeSubdivisionLevel(0, 1, 3), 0);
  assert.equal(countdownSnakeSubdivisionLevel(1, 2, 3), 0);
  assert.equal(countdownSnakeSubdivisionLevel(3, 7, 1), 1);
  assert.equal(countdownSnakeSubdivisionLevel(0, 1, 0), 0);
  const settings = {
    lengthCells: 7,
    maximumSubdivisionLevel: 3,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const frame = countdownSnakeFrame(
    { path: Array.from({ length: 12 }, (_, index) => index) },
    1,
    settings,
  );
  assert.equal(frame.headStep, 11);
  assert.deepEqual(frame.cells.map(cell => cell.index), [5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(frame.cells.map(cell => cell.level), [0, 1, 2, 3, 2, 1, 0]);
  const mergeFrame = countdownSnakeMergeFrame(frame);
  assert.deepEqual(mergeFrame.cells.map(cell => cell.level), [1, 1, 2, 3, 2, 1, 1]);
  assert.deepEqual(frame.cells.map(cell => cell.level), [0, 1, 2, 3, 2, 1, 0]);
});

test("stable snake stops beside type while evolving snake enters its cell", () => {
  const generator = createGenerator();
  generator.enter({ time: 0 });
  const first = generator.inspect();
  const { plan } = first.appearance.snake;
  const minimumDistance = SETTINGS.countdownFramed.appearance.minimumCellDistance;
  assert.equal(first.appearance.snake.durationSeconds, 1);
  assert.equal(first.appearance.snake.durationSource, "composition-beat");
  assert.equal(first.appearance.minimumCellDistance, minimumDistance);
  assert.equal(plan.sourceCellIndex, first.cellIndex);
  assert.ok(manhattanGridDistance(
    first.layout,
    plan.sourceCellIndex,
    plan.targetCellIndex,
  ) >= minimumDistance);
  assert.equal(manhattanGridDistance(
    first.layout,
    plan.sourceCellIndex,
    plan.sourceIndex,
  ), 1);
  assert.equal(manhattanGridDistance(
    first.layout,
    plan.targetCellIndex,
    plan.targetIndex,
  ), 1);
  assert.notEqual(plan.sourceIndex, plan.sourceCellIndex);
  assert.notEqual(plan.targetIndex, plan.targetCellIndex);
  assert.equal(plan.path[0], plan.sourceIndex);
  assert.equal(plan.path.at(-1), plan.targetIndex);

  const targetCellIndex = plan.targetCellIndex;
  generator.update({ time: 0.999 });
  const arrived = generator.inspect().appearance.snake;
  assert.equal(arrived.frame.headStep, arrived.plan.path.length - 1);
  assert.equal(arrived.frame.cells.at(-1).index, arrived.plan.targetIndex);
  assert.equal(manhattanGridDistance(
    first.layout,
    arrived.plan.targetCellIndex,
    arrived.frame.cells.at(-1).index,
  ), 1);

  generator.update({ time: 1 });
  const second = generator.inspect();
  assert.equal(second.cellIndex, targetCellIndex);
  assert.equal(second.appearance.snake.frame.headStep, 0);
  assert.deepEqual(
    second.appearance.snake.frame.cells,
    [{ index: second.appearance.snake.plan.sourceIndex, level: 0 }],
  );
  generator.update({ time: SETTINGS.countdownFramed.countFromSeconds / 2 + 0.999 });
  const merging = generator.inspect().appearance.snake;
  assert.equal(merging.plan.targetIndex, merging.plan.targetCellIndex);
  assert.equal(merging.frame.cells.at(-1).index, merging.plan.targetCellIndex);
  assert.ok(merging.frame.cells.some(cell => cell.level === 0));
  assert.ok(merging.renderFrame.cells.every(cell => cell.level >= 1));
  generator.dispose();
});

test("snake body grows after each tick and stays inside board capacity", () => {
  assert.equal(countdownSnakeLengthAt(7, 0, true, 75), 7);
  assert.equal(countdownSnakeLengthAt(7, 1, true, 75), 8);
  assert.equal(countdownSnakeLengthAt(7, 100, true, 75), 75);
  assert.equal(countdownSnakeLengthAt(7, 100, false, 75), 7);
  assert.equal(countdownSnakeLengthAt(100, 0, true, 75), 75);

  const generator = createGenerator();
  generator.enter({ time: 0 });
  assert.equal(generator.inspect().appearance.snake.growAfterEachTick, true);
  assert.equal(generator.inspect().appearance.snake.baseLengthCells, 7);
  assert.equal(generator.inspect().appearance.snake.lengthCells, 7);
  const layout = generator.inspect().layout;
  const maximumLengthCells = layout.columns * layout.rows - 2;
  assert.equal(
    generator.inspect().appearance.snake.maximumLengthCells,
    maximumLengthCells,
  );

  const duration = SETTINGS.countdownFramed.countFromSeconds;
  generator.update({ time: duration / 3 });
  assert.equal(generator.inspect().appearance.snake.lengthCells, 7);
  generator.update({ time: duration / 2 });
  assert.equal(generator.inspect().appearance.snake.lengthCells, 7);
  generator.update({ time: duration / 2 + 1 });
  assert.equal(generator.inspect().appearance.snake.lengthCells, 8);
  const finalSnakeTick = duration * 2 / 3 - 1;
  generator.update({ time: finalSnakeTick });
  const finalSnakeLength = Math.min(
    7 + (finalSnakeTick - duration / 2),
    maximumLengthCells,
  );
  assert.equal(
    generator.inspect().appearance.snake.lengthCells,
    finalSnakeLength,
  );
  generator.update({ time: duration * 2 / 3 + 5 });
  assert.equal(generator.inspect().appearance.snake.lengthCells, finalSnakeLength);
  generator.update({ time: duration });
  assert.equal(generator.inspect().appearance.snake.lengthCells, 7);
  generator.dispose();

  const fixed = createGenerator({
    options: {
      ...SETTINGS.countdownFramed,
      appearance: {
        ...SETTINGS.countdownFramed.appearance,
        effects: {
          ...SETTINGS.countdownFramed.appearance.effects,
          snake: {
            ...SETTINGS.countdownFramed.appearance.effects.snake,
            growAfterEachTick: false,
          },
        },
      },
    },
  });
  fixed.enter({ time: 0 });
  fixed.update({ time: duration / 2 + 2 });
  assert.equal(fixed.inspect().appearance.snake.lengthCells, 7);
  fixed.dispose();
});

test("snake resolves and renders its independently declared palette", () => {
  const generator = createGenerator({
    options: {
      ...SETTINGS.countdownFramed,
      appearance: {
        ...SETTINGS.countdownFramed.appearance,
        effects: {
          ...SETTINGS.countdownFramed.appearance.effects,
          snake: {
            ...SETTINGS.countdownFramed.appearance.effects.snake,
            enabled: true,
          },
        },
      },
    },
  });
  generator.enter({ time: SETTINGS.countdownFramed.countFromSeconds / 3 });
  const snake = generator.inspect().appearance.snake;
  const paletteName = SETTINGS.countdownFramed.appearance.effects.snake.palette;
  assert.equal(snake.paletteName, paletteName);
  assert.deepEqual(
    snake.palette,
    countdownPalette({ palette: paletteName }, PALETTES),
  );

  const context = createCountingContext();
  const pathColors = [];
  const beginPath = context.beginPath.bind(context);
  context.beginPath = () => {
    pathColors.push(context.fillStyle);
    beginPath();
  };
  generator.draw({}, {}, context);
  assert.equal(context.counts.fill, 1);
  assert.equal(
    pathColors[0],
    countdownPalette({ palette: paletteName }, PALETTES)[0],
  );
  generator.dispose();
});

test("clock reveals two nearby 2x2 squares clockwise per beat", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const plan = countdownClockPlan({
    seed: 42,
    tick: 0,
    layout: { columns: 3, rows: 3 },
    cellIndex: 4,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
  });

  assert.equal(plan.squares.length, 2);
  assert.equal(plan.dots.length, 8);
  assertClockSafeZones(plan);
  assert.equal(plan.maximumSquareSize, 8);
  assert.equal(new Set(plan.dots.map(dot => dot.index)).size, 8);
  for (const square of plan.squares) {
    assert.deepEqual(square.dots.map(({ column, row }) => ({ column, row })), [
      { column: square.topLeftColumn, row: square.topLeftRow },
      { column: square.topLeftColumn + 1, row: square.topLeftRow },
      { column: square.topLeftColumn + 1, row: square.topLeftRow + 1 },
      { column: square.topLeftColumn, row: square.topLeftRow + 1 },
    ]);
  }
  assert.equal(countdownClockFrame(plan, 0, settings).visibleCount, 0);
  assert.deepEqual(
    countdownClockFrame(plan, 0.5, settings).dots.map(dot => dot.clockwiseIndex),
    [0, 1, 0, 1],
  );
  assert.equal(countdownClockFrame(plan, 0.999, settings).visibleCount, 8);
});

test("clock squares keep seeded positions and render beneath the timer text", () => {
  const generator = createGenerator();
  const context = createCountingContext();
  const arcs = [];
  const text = [];
  const events = [];
  context.arc = (x, y) => {
    arcs.push({ x, y });
    events.push("arc");
  };
  context.fillText = (glyph, x, y) => {
    context.counts.text += 1;
    text.push({ glyph, x, y });
    events.push("text");
  };
  generator.enter({ time: 0.999 });
  const state = generator.inspect();
  generator.draw({}, {}, context);

  const subdivisions = 1 << state.appearance.clock.subdivisionLevel;
  const slot = state.layout.cellSize / subdivisions;
  const expectedDots = state.appearance.clock.frame.dots.map(dot => ({
    x: state.layout.offsetX + (dot.column + 0.5) * slot,
    y: state.layout.offsetY + (dot.row + 0.5) * slot,
  }));
  assert.equal(arcs.length, 8);
  assert.equal(events.indexOf("text"), 8);
  assert.deepEqual(arcs, expectedDots);
  assert.equal(text.length, 5);
  generator.dispose();
});

test("clock expands through 3x3, 4x4, and 8x8 before becoming the snake origin", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const base = {
    seed: 42,
    tick: 0,
    layout: { columns: 3, rows: 3 },
    cellIndex: 4,
    handoffCellIndex: 1,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    evolutionSquareSizes: settings.evolutionSquareSizes,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
    evolutionEnabled: true,
  };

  assert.deepEqual(
    [0, 0.25, 0.5, 0.75, 1].map(progress => (
      countdownClockEvolutionAt(true, progress, settings.evolutionSquareSizes)
        .squareSize
    )),
    [3, 4, 8, 8, 1],
  );
  const plans = [0, 0.25, 0.5, 0.75, 1].map(evolutionProgress => (
    countdownClockPlan({ ...base, evolutionProgress })
  ));
  assert.deepEqual(plans.map(plan => plan.dots.length), [18, 32, 128, 128, 1]);
  plans.forEach(assertClockSafeZones);
  assert.deepEqual(
    plans.slice(0, -1).map(plan => (
      plan.squares.map(square => square.reservation)
    )),
    Array.from({ length: 4 }, () => (
      plans[0].squares.map(square => square.reservation)
    )),
  );
  assert.equal(plans.at(-1).evolutionMode, "snake-origin");
  assert.ok(plans.at(-1).dots.every(dot => dot.cellIndex === base.handoffCellIndex));
  assert.ok(plans.at(-1).dots.every(dot => dot.sizeInSubdivisions === 8));
  assert.throws(
    () => countdownClockPlan({
      ...base,
      handoffCellIndex: base.cellIndex,
      evolutionProgress: 1,
    }),
    /snake origin overlaps the timer text safe zone/,
  );
});

test("clock safe zones hold for every clock tick and fail on impossible boards", () => {
  const generator = createGenerator({ seed: 77 });
  generator.enter({ time: 0 });
  const clockStageTicks = SETTINGS.countdownFramed.countFromSeconds / 3;
  for (let tick = 0; tick < clockStageTicks; tick += 1) {
    generator.update({ time: tick + 0.001 });
    assertClockSafeZones(generator.inspect().appearance.clock.plan);
  }
  generator.dispose();

  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  assert.throws(
    () => countdownClockPlan({
      seed: 1,
      tick: 0,
      layout: { columns: 1, rows: 1 },
      cellIndex: 0,
      subdivisionLevel: settings.subdivisionLevel,
      squareCount: settings.squareCount,
      dotsPerSquare: settings.dotsPerSquare,
      evolutionSquareSizes: settings.evolutionSquareSizes,
      rangeInSubdivisions: settings.rangeInSubdivisions,
      textSafeZone: settings.textSafeZone,
      minimumSquareGapInSubdivisions:
        settings.minimumSquareGapInSubdivisions,
    }),
    /safe zones cannot fit two maximum-size square reservations/,
  );
});

test("clock rejects invalid or impossible safe-zone settings at setup", () => {
  const optionsWithClock = clock => ({
    ...SETTINGS.countdownFramed,
    appearance: {
      ...SETTINGS.countdownFramed.appearance,
      effects: {
        ...SETTINGS.countdownFramed.appearance.effects,
        clock: {
          ...SETTINGS.countdownFramed.appearance.effects.clock,
          ...clock,
        },
      },
    },
  });
  const safeZone = SETTINGS.countdownFramed.appearance.effects.clock.textSafeZone;
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({
        textSafeZone: { ...safeZone, widthInCells: 0 },
      }),
    }),
    /textSafeZone.widthInCells must be a finite positive number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({ minimumSquareGapInSubdivisions: -1 }),
    }),
    /minimumSquareGapInSubdivisions must be a non-negative integer/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({
        textSafeZone: { widthInCells: 100, heightInCells: 100 },
      }),
    }),
    /safe zones cannot fit two maximum-size square reservations/,
  );
});

test("clock hands off to a native snake that keeps roaming through bubbles", () => {
  const generator = createGenerator();
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  generator.enter({ time: stageSeconds - 1 });
  const clockOrigin = generator.inspect().appearance.clock.plan.handoffCellIndex;

  generator.update({ time: stageSeconds });
  const snakeStart = generator.inspect().appearance.snake;
  assert.equal(snakeStart.plan.sourceIndex, clockOrigin);
  assert.ok(!snakeStart.plan.textSafeCellIndices.includes(clockOrigin));
  generator.update({ time: stageSeconds * 1.5 - 0.001 });
  const stable = generator.inspect();
  assert.equal(stable.appearance.frame.merge.active, false);
  assert.ok(stable.appearance.snake.frame.cells.some(cell => cell.level === 0));
  generator.update({ time: stageSeconds * 1.75 });
  const entering = generator.inspect();
  assert.ok(entering.appearance.frame.merge.trailSquareCount > 0);
  assert.ok(entering.appearance.snake.frame.cells.some(cell => cell.level === 0));
  assert.ok(entering.appearance.snake.renderFrame.cells.every(cell => cell.level >= 1));
  assert.ok(entering.appearance.frame.merge.trailSquares.every(
    square => square.sourceLevel >= 1,
  ));
  generator.update({ time: stageSeconds * 2 - 0.001 });
  const finalSnakeLength = generator.inspect().appearance.snake.lengthCells;
  generator.update({ time: stageSeconds * 2 + 0.001 });
  const roamingStart = generator.inspect();
  assert.equal(roamingStart.appearance.frame.merge.phase, "roaming");
  assert.equal(roamingStart.appearance.frame.merge.sourceTick, stageSeconds * 2);
  assert.equal(roamingStart.appearance.snake.lengthCells, finalSnakeLength);
  assert.equal(
    roamingStart.appearance.snake.plan.targetIndex,
    roamingStart.appearance.snake.plan.targetCellIndex,
  );
  generator.update({ time: stageSeconds * 2 + 0.999 });
  const roamingEnd = generator.inspect();
  assert.equal(
    roamingEnd.appearance.snake.renderFrame.cells.at(-1).index,
    roamingEnd.appearance.snake.plan.targetCellIndex,
  );
  assert.notDeepEqual(
    roamingStart.appearance.snake.renderFrame.cells,
    roamingEnd.appearance.snake.renderFrame.cells,
  );
  generator.update({ time: stageSeconds * 2 + 1.001 });
  const nextRoam = generator.inspect();
  assert.equal(nextRoam.appearance.frame.merge.sourceTick, stageSeconds * 2 + 1);
  assert.equal(nextRoam.appearance.snake.lengthCells, finalSnakeLength);
  assert.equal(
    nextRoam.appearance.snake.plan.sourceCellIndex,
    roamingEnd.appearance.snake.plan.targetCellIndex,
  );
  generator.dispose();
});

test("clock handoff and roaming snake never enter the moving timer safe zone", () => {
  const generator = createGenerator();
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  generator.enter({ time: stageSeconds - 0.001 });
  const clockOrigin = generator.inspect().appearance.clock.plan.handoffCellIndex;

  for (
    let tick = stageSeconds;
    tick < SETTINGS.countdownFramed.countFromSeconds;
    tick += 1
  ) {
    for (const offset of [0, 0.999]) {
      generator.update({ time: tick + offset });
      const state = generator.inspect();
      const { plan, renderFrame } = state.appearance.snake;
      const safeCells = countdownSnakeTextSafeCells(
        state.layout,
        state.cellIndex,
        state.appearance.clock.textSafeZone,
      );
      assert.deepEqual(plan.textSafeCellIndices, safeCells);
      assert.ok(plan.path.every(index => !safeCells.includes(index)));
      assert.ok(renderFrame.cells.every(cell => !safeCells.includes(cell.index)));
    }
  }

  generator.update({ time: stageSeconds * 1.5 });
  const enteringMerge = generator.inspect().appearance.frame.merge;
  assert.ok(enteringMerge.textSafeRectangle);
  assert.ok(enteringMerge.textSafeHiddenSquareCount > 0);
  assert.ok(enteringMerge.frame.dots.every(dot => (
    dot.column + 1 <= enteringMerge.textSafeRectangle.left
    || dot.column >= enteringMerge.textSafeRectangle.right
    || dot.row + 1 <= enteringMerge.textSafeRectangle.top
    || dot.row >= enteringMerge.textSafeRectangle.bottom
  )));

  generator.update({ time: stageSeconds });
  assert.equal(generator.inspect().appearance.snake.plan.sourceIndex, clockOrigin);
  generator.dispose();
});

test("frame fits two level-three 2x2 squares close to digit anchors", () => {
  const first = createFramePlan();
  const second = createFramePlan();
  const changed = createFramePlan({ seed: 43 });
  const nextTick = createFramePlan({ tick: 1 });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first.dots, changed.dots);
  assert.notDeepEqual(first.dots, nextTick.dots);
  assert.equal(first.subdivisions, 8);
  assert.equal(first.gridColumns, 24);
  assert.equal(first.gridRows, 24);
  assert.equal(first.digitCircles.length, 4);
  assert.equal(first.squares.length, 2);
  assert.equal(first.dots.length, 8);
  assert.equal(new Set(first.dots.map(dot => dot.index)).size, 8);
  for (const square of first.squares) {
    assert.deepEqual(
      square.dots.map(({ column, row }) => ({ column, row })),
      [
        { column: square.topLeftColumn, row: square.topLeftRow },
        { column: square.topLeftColumn + 1, row: square.topLeftRow },
        { column: square.topLeftColumn + 1, row: square.topLeftRow + 1 },
        { column: square.topLeftColumn, row: square.topLeftRow + 1 },
      ],
    );
  }
  assert.notEqual(
    first.squares[0].targetDigitIndex,
    first.squares[1].targetDigitIndex,
  );
  assert.ok(first.squares.every(square => square.gap <= 1));
  assert.ok(first.dots.every(dot => (
    dot.column >= 0
    && dot.column < first.gridColumns
    && dot.row >= 0
    && dot.row < first.gridRows
  )));
});

test("frame avoidance expands once and refills from its center", () => {
  const oneBeat = {
    durationBeats: 1,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const twoBeats = { ...oneBeat, durationBeats: 2 };

  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(0, oneBeat), {
    phase: "emptying",
    emptyEnvelope: 0,
    refillEnvelope: 0,
  });
  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(0.5, oneBeat), {
    phase: "refilling",
    emptyEnvelope: 1,
    refillEnvelope: 0,
  });
  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(1, oneBeat), {
    phase: "complete",
    emptyEnvelope: 1,
    refillEnvelope: 1,
  });
  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(1, twoBeats), {
    phase: "refilling",
    emptyEnvelope: 1,
    refillEnvelope: 0,
  });
  const refilling = countdownFrameAvoidanceEnvelopesAt(0.75, oneBeat);
  assert.equal(refilling.emptyEnvelope, 1);
  assert.ok(refilling.refillEnvelope > 0 && refilling.refillEnvelope < 1);
  assert.throws(
    () => countdownFrameAvoidanceEnvelopesAt(
      0,
      { ...oneBeat, durationBeats: 0.5 },
    ),
    /at least one beat/,
  );
});

test("snake taper rasterizes into persistent bubble squares", () => {
  const trail = countdownSnakeBubblePlan({
    layout: { columns: 3, rows: 3 },
    cells: [
      { index: 0, level: 1 },
      { index: 1, level: 1 },
      { index: 2, level: 2 },
      { index: 3, level: 3 },
    ],
    progress: 1,
    appearanceTick: 19,
  });
  const generated = createFramePlan();
  const merged = countdownFramePlanWithSnakeTrail(generated, trail);

  assert.equal(trail.availableSquareCount, 40);
  assert.equal(trail.squares.length, 40);
  assert.equal(new Set(trail.squares.map(square => square.tileIndex)).size, 40);
  assert.equal(trail.dots.length, 160);
  assert.equal(
    merged.squares.length,
    trail.squares.length + generated.squares.length - merged.trailOverlapCount,
  );
  assert.equal(new Set(merged.squares.map(square => square.tileIndex)).size,
    merged.squares.length);
  assert.ok(merged.squares.slice(0, trail.squares.length).every(
    square => square.mergeSource === "snake",
  ));
});

test("frame push radius grows across the timer while noise wiggles per beat", () => {
  const avoidance = {
    radiusInCells: 1,
    radiusAtEndInCells: 3,
    radiusGrowthTimingCurve: [0.42, 0, 0.58, 1],
  };
  const motion = {
    beatWiggleDistance: 0.08,
    timingCurve: [0.42, 0, 0.58, 1],
  };

  assert.equal(countdownFrameAvoidanceRadiusAt(0, avoidance), 1);
  assert.equal(countdownFrameAvoidanceRadiusAt(1, avoidance), 3);
  assert.ok(countdownFrameAvoidanceRadiusAt(0.5, avoidance) > 1);
  assert.equal(countdownFrameNoiseBeatOffsetAt(0, motion), 0);
  assert.equal(countdownFrameNoiseBeatOffsetAt(0.5, motion), 0.08);
  assert.equal(countdownFrameNoiseBeatOffsetAt(1, motion), 0);
  assert.equal(
    countdownFrameNoiseBeatOffsetAt(0.25, motion),
    countdownFrameNoiseBeatOffsetAt(0.75, motion),
  );
});

test("frame avoidance radius uses parent-cell units", () => {
  const circles = countdownFrameDigitCircles({
    layout: { columns: 3, rows: 3 },
    cellIndex: 4,
    subdivisionLevel: 3,
    numberSpacingInSubdivisions: 1.25,
    radiusInCells: 0.3,
    emptyEnvelope: 1,
    refillEnvelope: 0,
  });
  assert.equal(circles.length, 4);
  assert.ok(circles.every(circle => Math.abs(circle.radius - 2.4) < 1e-12));
  assert.ok(circles.every(circle => circle.refillRadius === 0));
  assert.ok(countdownFrameDigitCircles({
    layout: { columns: 3, rows: 3 },
    cellIndex: 4,
    subdivisionLevel: 3,
    numberSpacingInSubdivisions: 1.25,
    radiusInCells: 0.3,
    emptyEnvelope: 1,
    refillEnvelope: 1,
  }).every(circle => circle.radius === circle.refillRadius));
  assert.throws(
    () => countdownFrameDigitCircles({
      layout: { columns: 3, rows: 3 },
      cellIndex: 4,
      subdivisionLevel: 3,
      numberSpacingInSubdivisions: 1.25,
      radiusInCells: 0.3,
      emptyEnvelope: 0.5,
      refillEnvelope: 1,
    }),
    /refill cannot overtake/,
  );
});

test("frame avoidance hides whole fixed squares and restores them in place", () => {
  const plan = createFramePlan();
  const settings = {
    squareCount: 2,
    dotsPerSquare: 4,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const firstDot = plan.squares[0].dots[0];
  const circle = {
    x: firstDot.column + 0.5,
    y: firstDot.row + 0.5,
    radius: 0.1,
    refillRadius: 0,
  };
  const hidden = countdownFrameAt(plan, 1, settings, [circle]);
  const restored = countdownFrameAt(
    plan,
    1,
    settings,
    [{ ...circle, refillRadius: circle.radius }],
  );

  assert.equal(hidden.avoidedSquareCount, 1);
  assert.equal(hidden.visibleCount, plan.dots.length - 4);
  assert.ok(hidden.dots.every(dot => dot.squareIndex !== firstDot.squareIndex));
  assert.equal(restored.avoidedSquareCount, 0);
  assert.deepEqual(restored.dots, plan.dots);
  assert.deepEqual(plan.squares[0].dots[0], firstDot);
});

test("snake merge bubbles hide whole squares inside the timer text safe zone", () => {
  const plan = createFramePlan();
  const settings = SETTINGS.countdownFramed.appearance.effects.frame;
  const rectangle = countdownFrameTextSafeRectangle({
    layout: { columns: 3, rows: 3 },
    cellIndex: 4,
    subdivisionLevel: settings.subdivisionLevel,
    textSafeZone: SETTINGS.countdownFramed.appearance.effects.clock.textSafeZone,
  });
  const excludedSquareIndices = plan.squares
    .filter(square => square.dots.some(dot => (
      dot.column < rectangle.right
      && dot.column + 1 > rectangle.left
      && dot.row < rectangle.bottom
      && dot.row + 1 > rectangle.top
    )))
    .map(square => square.squareIndex);
  assert.ok(excludedSquareIndices.length > 0);

  const frame = countdownFrameAt(
    plan,
    1,
    settings,
    [],
    null,
    [],
    [rectangle],
  );
  assert.equal(frame.rectangleAvoidedSquareCount, excludedSquareIndices.length);
  assert.ok(frame.dots.every(dot => !excludedSquareIndices.includes(dot.squareIndex)));
});

test("moving snake glyphs hide nearby bubble dots without removing their square", () => {
  const plan = createFramePlan();
  const firstDot = plan.dots[0];
  const circles = countdownSnakeBubbleExclusionCircles({
    layout: { columns: 3, rows: 3 },
    cells: [{ index: 4, level: 1 }],
    clearanceInCells: 0,
    dotMargin: 0,
  });
  const frame = countdownFrameAt(
    plan,
    1,
    { dotsPerSquare: 4 },
    [],
    null,
    [{ x: firstDot.column + 0.5, y: firstDot.row + 0.5, radius: 0.1 }],
  );

  assert.equal(circles.length, 4);
  assert.equal(frame.avoidedSquareCount, 0);
  assert.equal(frame.snakeHiddenCount, 1);
  assert.equal(frame.visibleCount, plan.dots.length - 1);
  assert.equal(
    frame.dots.filter(dot => dot.squareIndex === firstDot.squareIndex).length,
    3,
  );
});

test("frame visibility noise textures boundary and refilled squares", () => {
  const settings = {
    squareCount: 2,
    dotsPerSquare: 4,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const visibility = plan => ({
    enabled: true,
    data: new Uint8Array(plan.gridColumns * plan.gridRows),
    width: plan.gridColumns,
    height: plan.gridRows,
    layer: { threshold: 0.5, softness: 0 },
    edgeWidthInSquares: 3,
    seed: 42,
  });
  const boundaryPlan = createFramePlan();
  const textured = countdownFrameAt(
    boundaryPlan,
    1,
    settings,
    [],
    visibility(boundaryPlan),
  );
  assert.ok(boundaryPlan.squares.every(square => square.edgeDistance === 0));
  assert.equal(textured.eligibleVisibleCount, 8);
  assert.equal(textured.noiseHiddenCount, 8);
  assert.equal(textured.visibleCount, 0);

  const refilled = countdownFrameAt(
    boundaryPlan,
    1,
    settings,
    [{ x: 12, y: 12, radius: 40, refillRadius: 40 }],
    visibility(boundaryPlan),
  );
  assert.equal(refilled.avoidedSquareCount, 0);
  assert.equal(refilled.noiseHiddenCount, 8);
  assert.equal(refilled.visibleCount, 0);

  const fullPlan = createFramePlan({ squareCount: 1000 });
  const full = countdownFrameAt(fullPlan, 1, settings, [], visibility(fullPlan));
  assert.ok(fullPlan.squares.every(square => Number.isInteger(square.edgeDistance)));
  assert.ok(fullPlan.squares.some(square => square.edgeDistance === 0));
  assert.ok(fullPlan.squares.some(square => square.edgeDistance > 0));
  assert.ok(full.noiseHiddenCount > 0);
  assert.ok(full.visibleCount < fullPlan.dots.length);
});

test("frame avoidance keeps earlier type bubbles alive for multi-beat lifetimes", () => {
  const frame = SETTINGS.countdownFramed.appearance.effects.frame;
  const generator = createGenerator({
    options: {
      ...SETTINGS.countdownFramed,
      appearance: {
        ...SETTINGS.countdownFramed.appearance,
        effects: {
          ...SETTINGS.countdownFramed.appearance.effects,
          frame: {
            ...frame,
            avoidance: { ...frame.avoidance, durationBeats: 2 },
          },
        },
      },
    },
  });
  const bubblesStart = SETTINGS.countdownFramed.countFromSeconds * 2 / 3;
  generator.enter({ time: bubblesStart + 1 });
  const bubbles = generator.inspect().appearance.frame.avoidance.bubbles;

  assert.deepEqual(
    bubbles.map(bubble => bubble.sourceTick),
    [bubblesStart + 1, bubblesStart],
  );
  assert.deepEqual(bubbles.map(bubble => bubble.ageBeats), [0, 1]);
  assert.deepEqual(bubbles.map(bubble => bubble.phase), ["emptying", "refilling"]);
  assert.deepEqual(bubbles.map(bubble => bubble.emptyEnvelope), [0, 1]);
  assert.deepEqual(bubbles.map(bubble => bubble.refillEnvelope), [0, 0]);
  generator.dispose();
});

test("frame visibility noise is deterministic across the countdown loop seam", () => {
  const first = createGenerator({ seed: 91 });
  const second = createGenerator({ seed: 91 });
  first.enter({ time: 0 });
  second.enter({ time: 0 });
  const start = first.countdownNoisePreviewSnapshot().fields[0].data;

  assert.deepEqual(
    start,
    second.countdownNoisePreviewSnapshot().fields[0].data,
  );
  first.update({ time: 0.5 });
  assert.notDeepEqual(
    first.countdownNoisePreviewSnapshot().fields[0].data,
    start,
  );
  first.update({ time: 1 });
  assert.deepEqual(
    first.countdownNoisePreviewSnapshot().fields[0].data,
    start,
  );
  first.update({ time: SETTINGS.countdownFramed.countFromSeconds });
  assert.deepEqual(
    first.countdownNoisePreviewSnapshot().fields[0].data,
    start,
  );
  first.dispose();
  second.dispose();
});

test("bubbles expose every square immediately without clockwise staging", () => {
  const plan = createFramePlan();
  const settings = {
    squareCount: 2,
    dotsPerSquare: 4,
  };

  assert.equal(countdownFrameAt(plan, 0, settings).visibleCount, 8);
  assert.equal(countdownFrameAt(plan, 0.5, settings).visibleCount, 8);
  assert.equal(countdownFrameAt(plan, 0.999, settings).visibleCount, 8);
  assert.deepEqual(countdownFrameAt(plan, 0, settings).dots, plan.dots);
  assert.ok(plan.dots.every(dot => !("clockwiseIndex" in dot)));
});

test("bubbles retain earlier squares while additions appear immediately", () => {
  const initial = createFramePlan();
  const additions = createFramePlan({
    seed: 42,
    tick: 1,
    cellIndex: 0,
    squareCount: 3,
    minimumSquareCount: 0,
    excludedTileIndices: initial.squares.map(square => square.tileIndex),
    squareIndexOffset: initial.squares.length,
  });
  const squares = countdownFrameSquaresWithEdgeDistance(
    [...initial.squares, ...additions.squares],
    additions.gridColumns,
    additions.gridRows,
  );
  const plan = {
    ...additions,
    tick: 1,
    squares,
    dots: squares.flatMap(square => square.dots),
  };
  const settings = {
    dotsPerSquare: 4,
  };
  const start = countdownFrameAt(plan, 0, settings);

  assert.equal(new Set(squares.map(square => square.tileIndex)).size, 5);
  assert.deepEqual(
    frameDotIdentity(plan.dots.slice(0, initial.dots.length)),
    frameDotIdentity(initial.dots),
  );
  assert.equal(start.visibleCount, plan.dots.length);
  assert.deepEqual(frameDotIdentity(start.dots), frameDotIdentity(plan.dots));
  assert.equal(countdownFrameAt(plan, 1, settings).visibleCount, plan.dots.length);
});

test("bubbles color whole squares with slow board-level noise", () => {
  const plan = createFramePlan();
  const frame = countdownFrameAt(plan, 1, {
    squareCount: 2,
    dotsPerSquare: 4,
  });
  const samples = [];
  const mappings = [];
  const flicker = {
    enabled: true,
    sampleAt(x, y, time) {
      samples.push({ x, y, time });
      return 0.75;
    },
    colorFromNoise(basePosition, sample) {
      mappings.push({ basePosition, sample });
      return `flicker-${basePosition}`;
    },
  };
  const palette = ["a", "b", "c", "d", "e"];
  const colors = countdownFrameDotColors(frame, palette, flicker, 12.5);

  assert.deepEqual(samples, frame.dots.map(dot => ({
    x: dot.column + 0.5,
    y: dot.row + 0.5,
    time: 12.5,
  })));
  assert.deepEqual(mappings, [0, 0, 0, 0, 0.25, 0.25, 0.25, 0.25]
    .map(basePosition => ({
    basePosition,
    sample: 0.75,
  })));
  assert.deepEqual(colors, [
    "flicker-0", "flicker-0", "flicker-0", "flicker-0",
    "flicker-0.25", "flicker-0.25", "flicker-0.25", "flicker-0.25",
  ]);
});

test("frame retains its dormant board-covering growth mapping", () => {
  const settings = {
    subdivisionLevel: 3,
    dotMargin: 0,
    growTowardZero: true,
    growthTimingCurve: [0.8, 0, 1, 1],
  };
  const layout = {
    cellSize: 80,
    patternWidth: 240,
    patternHeight: 160,
  };
  const middle = countdownFrameGrowthAt(0.5, settings);
  assert.equal(countdownFrameGrowthAt(0, settings), 0);
  assert.ok(middle > 0 && middle < 1);
  assert.equal(countdownFrameGrowthAt(1, settings), 1);
  assert.equal(countdownFrameRadiusAt(layout, settings, 0), 5);
  assert.equal(
    countdownFrameRadiusAt(layout, settings, 1),
    Math.hypot(layout.patternWidth, layout.patternHeight),
  );
});

test("frame evolution remaps any countdown length onto full board capacity", () => {
  assert.equal(countdownFrameSquareCountAt(2, 0, true, 100, 30), 2);
  assert.equal(countdownFrameSquareCountAt(2, 1, true, 100, 30), 5);
  assert.equal(countdownFrameSquareCountAt(2, 29, true, 100, 30), 100);
  assert.equal(countdownFrameSquareCountAt(2, 29, false, 100, 30), 2);
  assert.equal(countdownFrameSquareCountAt(2, 4, true, 100, 5), 100);
  assert.equal(countdownFrameSquareCountAt(2, 0, true, 100, 1), 100);

  const constrained = createFramePlan({ squareCount: 1000 });
  const capacity = countdownFrameSquareCapacity({ columns: 3, rows: 3 }, 3);
  assert.equal(constrained.requestedSquareCount, 1000);
  assert.equal(constrained.maximumSquareCount, capacity);
  assert.equal(constrained.constrainedSquareCount, capacity);
  assert.equal(constrained.dots.length, constrained.gridColumns * constrained.gridRows);
  assert.equal(
    new Set(constrained.dots.map(dot => dot.index)).size,
    constrained.dots.length,
  );
});

test("frame varies around each time cell while keeping its seed fixed", () => {
  const generator = createGenerator({
    options: {
      ...SETTINGS.countdownFramed,
      appearance: {
        ...SETTINGS.countdownFramed.appearance,
        effects: {
          ...SETTINGS.countdownFramed.appearance.effects,
          frame: {
            ...SETTINGS.countdownFramed.appearance.effects.frame,
            enabled: true,
          },
        },
      },
    },
  });
  const bubblesStart = SETTINGS.countdownFramed.countFromSeconds * 2 / 3;
  generator.enter({ time: bubblesStart });
  const initial = generator.inspect();
  const initialDots = initial.appearance.frame.plan.dots;

  assert.equal(initial.appearance.frame.enabled, true);
  assert.equal(initial.appearance.order.activeEffect, "bubbles");
  assert.equal(initial.appearance.order.phase, "evolving");
  assert.equal(initial.appearance.order.evolutionEnabled, true);
  assert.equal(initial.appearance.frame.subdivisionLevel, 3);
  assert.equal(initial.appearance.frame.subdivisions, 8);
  assert.equal(initial.appearance.frame.baseSquareCount, 2);
  assert.equal(initial.appearance.frame.squareCount, 2);
  assert.equal(initial.appearance.frame.evolveSquareCount, true);
  assert.equal(initial.appearance.frame.growTowardZero, false);
  assert.equal(initial.appearance.frame.growthProgress, 0);
  assert.equal(initial.appearance.frame.flicker.enabled, true);
  assert.equal(initial.appearance.frame.flicker.mode, "noise");
  assert.equal(initial.appearance.frame.flicker.scope, "canvas");
  assert.equal(initial.appearance.frame.flicker.modeSettings.speed, 0.04);
  assert.equal(
    initial.appearance.frame.flicker.modeSettings.spatialScale,
    SETTINGS.countdownFramed.flicker.modes.noise.spatialScale,
  );
  const authoredFrame = SETTINGS.countdownFramed.appearance.effects.frame;
  assert.equal(
    initial.appearance.frame.avoidance.radiusInCells,
    authoredFrame.avoidance.radiusInCells,
  );
  assert.equal(
    initial.appearance.frame.avoidance.radiusAtEndInCells,
    authoredFrame.avoidance.radiusAtEndInCells,
  );
  assert.equal(
    initial.appearance.frame.avoidance.currentRadiusInCells,
    authoredFrame.avoidance.radiusInCells,
  );
  assert.equal(
    initial.appearance.frame.avoidance.durationBeats,
    authoredFrame.avoidance.durationBeats,
  );
  assert.equal(
    initial.appearance.frame.avoidance.bubbles.length,
    1,
  );
  assert.equal(initial.appearance.frame.avoidance.bubbles[0].phase, "emptying");
  assert.equal(initial.appearance.frame.avoidance.bubbles[0].emptyEnvelope, 0);
  assert.equal(initial.appearance.frame.avoidance.bubbles[0].refillEnvelope, 0);
  assert.equal(
    initial.appearance.frame.avoidance.bubbles[0].radiusInCells,
    authoredFrame.avoidance.radiusInCells,
  );
  assert.equal(initial.appearance.frame.visibilityNoise.enabled, true);
  assert.equal(
    initial.appearance.frame.visibilityNoise.mode,
    authoredFrame.noiseFields.layers.visibility.mode,
  );
  assert.equal(
    initial.appearance.frame.visibilityNoise.edgeWidthInSquares,
    authoredFrame.noiseFields.edgeWidthInSquares,
  );
  assert.equal(
    initial.appearance.frame.visibilityNoise.beatWiggleDistance,
    authoredFrame.noiseFields.beatWiggle.distance,
  );
  assert.equal(initial.appearance.frame.visibilityNoise.temporalOffset, 0);
  assert.equal(initial.appearance.frame.plan.cellIndex, initial.cellIndex);
  assert.equal(initial.appearance.frame.merge.phase, "roaming");
  assert.equal(initial.appearance.frame.merge.progress, 1);
  assert.ok(initial.appearance.frame.merge.trailSquareCount > 0);
  assert.equal(
    initial.appearance.frame.frame.eligibleVisibleCount,
    initial.appearance.frame.renderedDotCount
      - initial.appearance.frame.frame.snakeHiddenCount,
  );
  assert.ok(
    initial.appearance.frame.frame.visibleCount
      <= initial.appearance.frame.frame.eligibleVisibleCount,
  );
  assert.equal(initial.appearance.frame.frame.avoidedSquareCount, 0);
  const preview = generator.countdownNoisePreviewSnapshot({
    previewWidth: 20,
    previewHeight: 10,
  });
  assert.deepEqual(preview.fields.map(field => field.id), [
    "frame-visibility",
    "flicker-color",
  ]);
  assert.ok(preview.fields.every(field => field.data.length === 200));
  assert.ok(preview.fields.every(field => new Set(field.data).size > 1));
  const visibilityPreview = preview.fields[0].data.slice();
  preview.fields[0].data.fill(0);
  assert.deepEqual(
    generator.countdownNoisePreviewSnapshot({ previewWidth: 20, previewHeight: 10 })
      .fields[0].data,
    visibilityPreview,
  );

  generator.update({ time: bubblesStart + 0.5 });
  const avoided = generator.inspect().appearance.frame;
  assert.deepEqual(avoided.plan.dots, initialDots);
  assert.equal(
    avoided.visibilityNoise.temporalOffset,
    authoredFrame.noiseFields.beatWiggle.distance,
  );
  assert.equal(
    avoided.avoidance.currentRadiusInCells,
    initial.appearance.frame.avoidance.currentRadiusInCells,
  );
  generator.update({ time: bubblesStart + 0.999 });
  const revealedState = generator.inspect();
  const revealed = revealedState.appearance.frame.frame;

  const context = createCountingContext();
  generator.draw({}, {}, context);
  assert.equal(
    context.counts.fill,
    revealed.visibleCount + revealedState.appearance.snake.renderFrame.cells.length,
  );

  generator.update({ time: bubblesStart + 1 });
  const next = generator.inspect();
  assert.equal(next.appearance.frame.plan.cellIndex, next.cellIndex);
  assert.equal(
    next.appearance.frame.squareCount,
    next.appearance.frame.plan.squares.length,
  );
  assert.ok(next.appearance.frame.squareCount > 2);
  assert.equal(
    next.appearance.frame.requestedSquareCount,
    next.appearance.frame.squareCount,
  );
  assert.notEqual(next.cellIndex, initial.cellIndex);
  assert.ok(
    next.appearance.frame.avoidance.currentRadiusInCells
      > initial.appearance.frame.avoidance.currentRadiusInCells,
  );
  assert.equal(next.appearance.frame.plan.seed, initial.appearance.frame.plan.seed);
  assert.deepEqual(
    frameDotIdentity(next.appearance.frame.plan.dots.slice(0, initialDots.length)),
    frameDotIdentity(initialDots),
  );
  assert.equal(next.appearance.frame.plan.retainedSquareCount, 2);
  assert.equal(
    next.appearance.frame.plan.addedSquareCount,
    next.appearance.frame.squareCount - 2,
  );
  assert.equal(
    next.appearance.frame.frame.eligibleVisibleCount,
    next.appearance.frame.renderedDotCount
      - next.appearance.frame.frame.avoidedSquareCount * 4
      - next.appearance.frame.frame.snakeHiddenCount,
  );
  generator.update({ time: SETTINGS.countdownFramed.countFromSeconds - 0.001 });
  const nearZero = generator.inspect().appearance.frame;
  assert.equal(nearZero.growthProgress, 0);
  assert.equal(nearZero.radius, initial.appearance.frame.radius);
  assert.equal(nearZero.squareCount, nearZero.maximumSquareCount);
  assert.equal(
    nearZero.avoidance.currentRadiusInCells,
    nearZero.avoidance.radiusAtEndInCells,
  );
  assert.equal(nearZero.dotCount, nearZero.plan.gridColumns * nearZero.plan.gridRows);
  assert.ok(nearZero.frame.noiseHiddenCount > 0);
  assert.ok(nearZero.frame.visibleCount < nearZero.frame.eligibleVisibleCount);
  generator.dispose();
});

test("frame accumulation is deterministic for sequential playback and seeking", () => {
  const sequential = createGenerator({ seed: 319 });
  const sought = createGenerator({ seed: 319 });
  const bubblesStart = SETTINGS.countdownFramed.countFromSeconds * 2 / 3;
  const targetTick = SETTINGS.countdownFramed.countFromSeconds - 1;
  sequential.enter({ time: bubblesStart });
  for (let tick = bubblesStart + 1; tick <= targetTick; tick += 1) {
    sequential.update({ time: tick });
  }
  sought.enter({ time: targetTick });

  assert.deepEqual(
    sequential.inspect().appearance.frame.plan,
    sought.inspect().appearance.frame.plan,
  );
  assert.deepEqual(
    sequential.inspect().appearance.snake.plan,
    sought.inspect().appearance.snake.plan,
  );
  assert.deepEqual(
    sequential.inspect().appearance.snake.renderFrame,
    sought.inspect().appearance.snake.renderFrame,
  );
  assert.deepEqual(
    sequential.inspect().appearance.frame.merge.trailSquares,
    sought.inspect().appearance.frame.merge.trailSquares,
  );
  sequential.dispose();
  sought.dispose();
});

test("frame rejects unsupported square, growth, and travel settings", () => {
  const optionsWithFrame = frame => ({
    ...SETTINGS.countdownFramed,
    appearance: {
      ...SETTINGS.countdownFramed.appearance,
      effects: {
        ...SETTINGS.countdownFramed.appearance.effects,
        frame: {
          ...SETTINGS.countdownFramed.appearance.effects.frame,
          ...frame,
        },
      },
    },
  });
  assert.throws(
    () => createGenerator({ options: optionsWithFrame({ subdivisionLevel: 2 }) }),
    /subdivisionLevel must be three \(8x8\)/,
  );
  assert.throws(
    () => createGenerator({ options: optionsWithFrame({ squareCount: 1 }) }),
    /squareCount must be two/,
  );
  assert.throws(
    () => createGenerator({ options: optionsWithFrame({ evolveSquareCount: "yes" }) }),
    /evolveSquareCount must be a boolean/,
  );
  assert.throws(
    () => createGenerator({ options: optionsWithFrame({ dotsPerSquare: 5 }) }),
    /dotsPerSquare must be four/,
  );
  assert.throws(
    () => createGenerator({ options: optionsWithFrame({ growTowardZero: "yes" }) }),
    /growTowardZero must be a boolean/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          radiusInCells: 0,
        },
      }),
    }),
    /avoidance.radiusInCells must be a finite positive number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          radiusAtEndInCells: 0.5,
        },
      }),
    }),
    /radiusAtEndInCells cannot be smaller/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          durationBeats: 0.5,
        },
      }),
    }),
    /avoidance.durationBeats must be at least one/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        noiseFields: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.noiseFields,
          edgeWidthInSquares: 0,
        },
      }),
    }),
    /edgeWidthInSquares must be positive/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        noiseFields: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.noiseFields,
          beatWiggle: {
            ...SETTINGS.countdownFramed.appearance.effects.frame
              .noiseFields.beatWiggle,
            distance: -0.1,
          },
        },
      }),
    }),
    /beatWiggle.distance must be a finite non-negative number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        noiseFields: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.noiseFields,
          layers: {
            visibility: {
              ...SETTINGS.countdownFramed.appearance.effects.frame
                .noiseFields.layers.visibility,
              holdSeconds: 0.5,
            },
          },
        },
      }),
    }),
    /visibility noise requires holdSeconds to be zero/,
  );
});

test("snake rejects seed, spacing, growth, and travel timing config errors", () => {
  assert.throws(
    () => createGenerator({
      options: {
        ...SETTINGS.countdownFramed,
        appearance: { ...SETTINGS.countdownFramed.appearance, evolveSeed: "no" },
      },
    }),
    /evolveSeed must be a boolean/,
  );
  assert.throws(
    () => createGenerator({
      options: {
        ...SETTINGS.countdownFramed,
        appearance: { ...SETTINGS.countdownFramed.appearance, minimumCellDistance: 2 },
      },
    }),
    /minimumCellDistance must be at least three/,
  );
  assert.throws(
    () => createGenerator({
      options: {
        ...SETTINGS.countdownFramed,
        appearance: {
          ...SETTINGS.countdownFramed.appearance,
          effects: {
            snake: {
              ...SETTINGS.countdownFramed.appearance.effects.snake,
              growAfterEachTick: "yes",
            },
          },
        },
      },
    }),
    /growAfterEachTick must be a boolean/,
  );
  assert.throws(
    () => createGenerator({
      options: {
        ...SETTINGS.countdownFramed,
        appearance: {
          ...SETTINGS.countdownFramed.appearance,
          effects: {
            snake: {
              ...SETTINGS.countdownFramed.appearance.effects.snake,
              durationSeconds: "calc(auto * 0.5)",
            },
          },
        },
      },
    }),
    /must equal one composition beat/,
  );
});

test("countdown intro scales from auto and cannot overrun its beat", () => {
  const halfBeat = createGenerator({
    options: {
      ...SETTINGS.countdownFramed,
      textReveal: { durationSeconds: "calc(auto * 0.5)" },
    },
  });
  assert.equal(halfBeat.inspect().reveal.durationSeconds, 0.5);
  assert.equal(halfBeat.inspect().reveal.stepSeconds, 0.5 / 5);
  halfBeat.dispose();

  assert.throws(
    () => createGenerator({
      options: {
        ...SETTINGS.countdownFramed,
        textReveal: { durationSeconds: "calc(auto * 1.25)" },
      },
    }),
    /cannot exceed one composition beat/,
  );
});

test("countdown draws centered colored glyphs and exposes tick changes headlessly", async () => {
  const generator = createGenerator();
  const context = createCountingContext();
  const calls = [];
  context.fillText = (...args) => {
    context.counts.text += 1;
    calls.push(args);
  };
  generator.enter({ time: 1.999 });
  const appearance = generator.inspect().appearance;
  const visibleClockDots = appearance.clock.enabled
    ? appearance.clock.frame.visibleCount
    : 0;
  generator.draw({}, {}, context);

  assert.equal(context.counts.text, 5);
  assert.equal(context.counts.fill, visibleClockDots);
  assert.equal(appearance.order.activeEffect, "clock");
  const countFromSeconds = SETTINGS.countdownFramed.countFromSeconds;
  assert.equal(
    calls.map(call => call[0]).join(""),
    formatCountdown(countFromSeconds - 1),
  );
  assert.equal(context.textAlign, "center");
  assert.equal(context.textBaseline, "middle");

  const run = await runFrames({
    composition: "countdown-framed",
    frames: 125,
    channels: ["cells", "transition", "plan"],
  });
  assert.ok(run.lines.some(line => (
    line.includes(`label=${formatCountdown(countFromSeconds)}`)
  )));
  assert.ok(run.lines.some(line => (
    line.includes(`label=${formatCountdown(countFromSeconds - 1)}`)
  )));
  assert.ok(run.lines.some(line => (
    line.includes(`label=${formatCountdown(countFromSeconds - 2)}`)
  )));
  assert.ok(run.lines.some(line => line.includes("countdown-intro tick=0 step=5")));
  if (SETTINGS.countdownFramed.appearance.effects.clock.enabled) {
    assert.ok(run.lines.some(line => (
      line.includes("countdown-effect mode=clock tick=0")
      && line.includes("safeText=")
      && line.includes("squareGap=1")
    )));
    assert.ok(run.lines.some(line => (
      line.includes("countdown-clock tick=0 mode=clock size=2 visible=")
    )));
  }
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=snake")));
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=bubbles")));
  assert.ok(run.drawCounts.every(frame => frame.text === 5));
  generator.dispose();
});
