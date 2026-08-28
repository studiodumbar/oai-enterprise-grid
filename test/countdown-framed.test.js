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
  countdownFrameRadiusAt,
  countdownFrameSquareCapacity,
  countdownFrameSquareCountAt,
  countdownFrameSquaresWithEdgeDistance,
} from "../src/countdown-appearance-effects/frame.js";
import {
  countdownAppearanceSeed,
  countdownSnakeFrame,
  countdownSnakeLengthAt,
  countdownSnakePath,
  countdownSnakeSubdivisionLevel,
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
});

test("snake starts and ends beside the separated text cells", () => {
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
  assert.equal(
    generator.inspect().appearance.snake.lengthCells,
    Math.min(7 + (finalSnakeTick - duration / 2), maximumLengthCells),
  );
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
  });

  assert.equal(plan.squares.length, 2);
  assert.equal(plan.dots.length, 8);
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
  assert.equal(initial.appearance.frame.frame.eligibleVisibleCount, 8);
  assert.ok(initial.appearance.frame.frame.visibleCount <= 8);
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
  const revealed = generator.inspect().appearance.frame.frame;

  const context = createCountingContext();
  generator.draw({}, {}, context);
  assert.equal(context.counts.fill, revealed.visibleCount);

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
    next.appearance.frame.dotCount
      - next.appearance.frame.frame.avoidedSquareCount * 4,
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
    assert.ok(run.lines.some(line => line.includes("countdown-effect mode=clock tick=0")));
    assert.ok(run.lines.some(line => line.includes("countdown-clock tick=0 visible=")));
  }
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=snake")));
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=bubbles")));
  assert.ok(run.drawCounts.every(frame => frame.text === 5));
  generator.dispose();
});
