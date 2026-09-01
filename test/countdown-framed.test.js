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
  countdownClockBirthRippleAt,
  countdownClockEvolutionAt,
  countdownClockFrame,
  countdownClockOffsetSchedule,
  countdownClockOffsetStateAt,
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
  countdownFrameFieldBeatOffsetAt,
  countdownFrameFinalWipeAt,
  countdownFrameGrowthAt,
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
  countdownSnakeColorVariation,
  countdownSnakeDisappearanceFrame,
  countdownSnakeDisappearanceVariation,
  countdownSnakeEngorgementFrame,
  countdownSnakeFrame,
  countdownSnakeGlyphColors,
  countdownSnakeLengthAt,
  countdownSnakePath,
  countdownSnakeSecondaryDirection,
  countdownSnakeSubdivisionLevel,
  countdownSnakeTextSafeCells,
  countdownSnakeWrappedPath,
  createCountdownSnakeEngorgementPlan,
  drawCountdownSnake,
} from "../src/countdown-appearance-effects/snake.js";
import {
  drawCountdownBubblesDebug,
  resolveCountdownBubblesDebugSettings,
} from "../src/countdown-appearance-effects/bubbles-debug.js";
import { manhattanGridDistance } from "../src/generators/pathfinding-strategies.js";
import { createCountingContext, runFrames } from "../src/debug/headless.js";
import { captureDebug } from "../src/debug/index.js";

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

function untimedTrackOptions(uses, countFromSeconds = 6) {
  const authoredSynth = SETTINGS.countdownFramed.appearance.synth;
  const legacySettingsKey = { clock: "clock", snake: "snake", bubbles: "frame" };
  return {
    ...SETTINGS.countdownFramed,
    countFromSeconds,
    timing: {
      ...SETTINGS.countdownFramed.timing,
      bodyDurationSeconds: countFromSeconds,
      beatCount: countFromSeconds,
    },
    appearance: {
      shared: SETTINGS.countdownFramed.appearance.shared,
      synth: {
        defaultTiming: authoredSynth.defaultTiming,
        tracks: uses.map((use, index) => {
          const sourceTrack = authoredSynth.tracks.find(track => track.use === use);
          return {
            id: `${use}-${index}`,
            use,
            zIndex: index,
            settings: sourceTrack?.settings
              ?? SETTINGS.countdownFramed.appearance.effects[legacySettingsKey[use]],
          };
        }),
        connections: [],
      },
    },
  };
}

function singleTrackOptions(use, countFromSeconds = 6) {
  return untimedTrackOptions([use], countFromSeconds);
}

function bubblesTrackOptions() {
  return singleTrackOptions(
    "bubbles",
    SETTINGS.countdownFramed.countFromSeconds,
  );
}

function snakeBubblesOptions() {
  const effects = SETTINGS.countdownFramed.appearance.effects;
  const snakeEndSeconds = 17;
  const bubblesStartSeconds = 20;
  const countFromSeconds = 30;
  const tracks = [
    {
      id: "snake-main",
      use: "snake",
      startSeconds: 0,
      durationSeconds: snakeEndSeconds,
      evolution: {
        startSeconds: snakeEndSeconds,
        durationSeconds: bubblesStartSeconds - snakeEndSeconds,
      },
      zIndex: 20,
      settings: effects.snake,
    },
    {
      id: "bubbles-main",
      use: "bubbles",
      startSeconds: bubblesStartSeconds,
      durationSeconds: countFromSeconds - bubblesStartSeconds,
      evolution: {
        startSeconds: bubblesStartSeconds,
        durationSeconds: countFromSeconds - bubblesStartSeconds,
      },
      zIndex: 30,
      settings: effects.frame,
    },
  ];
  return {
    ...SETTINGS.countdownFramed,
    countFromSeconds,
    timing: {
      ...SETTINGS.countdownFramed.timing,
      bodyDurationSeconds: countFromSeconds,
      beatCount: countFromSeconds,
    },
    appearance: {
      ...SETTINGS.countdownFramed.appearance,
      synth: {
        ...SETTINGS.countdownFramed.appearance.synth,
        tracks,
        connections: [{
          id: "snake-bubbles",
          from: tracks[0].id,
          to: tracks[1].id,
          use: "auto",
          startSeconds: snakeEndSeconds,
          durationSeconds: bubblesStartSeconds - snakeEndSeconds,
          evolution: {
            startSeconds: snakeEndSeconds,
            durationSeconds: bubblesStartSeconds - snakeEndSeconds,
          },
        }],
      },
    },
  };
}

function clockSnakeRippleOptions() {
  const countFromSeconds = SETTINGS.countdownFramed.countFromSeconds;
  const stageSeconds = countFromSeconds / 3;
  const effects = SETTINGS.countdownFramed.appearance.effects;
  const tracks = [
    {
      id: "clock-main",
      use: "clock",
      anchor: true,
      startSeconds: 0,
      durationSeconds: 0,
      evolution: { startSeconds: 0, durationSeconds: stageSeconds - 1 },
      zIndex: 10,
      settings: effects.clock,
    },
    {
      id: "snake-main",
      use: "snake",
      startSeconds: stageSeconds,
      durationSeconds: stageSeconds,
      evolution: {
        startSeconds: stageSeconds * 2,
        durationSeconds: stageSeconds - 1,
      },
      zIndex: 20,
      settings: effects.snake,
    },
    {
      id: "bubbles-main",
      use: "bubbles",
      anchor: true,
      startSeconds: countFromSeconds,
      durationSeconds: 0,
      evolution: { startSeconds: countFromSeconds - 1, durationSeconds: 1 },
      zIndex: 30,
      settings: effects.frame,
    },
  ];
  return {
    ...SETTINGS.countdownFramed,
    appearance: {
      ...SETTINGS.countdownFramed.appearance,
      synth: {
        ...SETTINGS.countdownFramed.appearance.synth,
        tracks,
        connections: [
          {
            id: "clock-snake",
            from: tracks[0].id,
            to: tracks[1].id,
            use: "auto",
            startSeconds: 0,
            durationSeconds: stageSeconds,
            evolution: { startSeconds: 0, durationSeconds: stageSeconds },
          },
          {
            id: "snake-bubbles",
            from: tracks[1].id,
            to: tracks[2].id,
            use: "auto",
            startSeconds: stageSeconds * 2,
            durationSeconds: stageSeconds,
            evolution: {
              startSeconds: stageSeconds * 2,
              durationSeconds: stageSeconds - 1,
            },
          },
        ],
      },
    },
  };
}

function withTrackSettings(use, settings, options = SETTINGS.countdownFramed) {
  return {
    ...options,
    appearance: {
      ...options.appearance,
      synth: {
        ...options.appearance.synth,
        tracks: options.appearance.synth.tracks.map(track => (
          track.use === use ? { ...track, settings } : track
        )),
      },
    },
  };
}

test("countdown spends combined 16:9 margins on a sixth grid row", () => {
  const generator = createGenerator({
    viewport: { width: 1920, height: 1080 },
  });
  const { layout } = generator.inspect();

  assert.deepEqual(
    { columns: layout.columns, rows: layout.rows },
    { columns: 11, rows: 6 },
  );
  assert.ok(layout.offsetY >= 0);
  assert.ok(1080 - layout.patternHeight < layout.cellSize);
});

function withSharedAppearance(shared, options = SETTINGS.countdownFramed) {
  return {
    ...options,
    appearance: {
      ...options.appearance,
      shared: { ...options.appearance.shared, ...shared },
    },
  };
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

function frameDotOverlapsRectangle(dot, rectangle) {
  const x = dot.xInSubdivisions ?? dot.column + 0.5;
  const y = dot.yInSubdivisions ?? dot.row + 0.5;
  const radius = (dot.sizeInSubdivisions ?? 1) / 2;
  return x - radius < rectangle.right
    && x + radius > rectangle.left
    && y - radius < rectangle.bottom
    && y + radius > rectangle.top;
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

function clockDistanceFromText(plan, reservation) {
  const centerColumn = (reservation.left + reservation.right) / 2;
  const centerRow = (reservation.top + reservation.bottom) / 2;
  const textCenterColumn = (plan.textSafeZone.left + plan.textSafeZone.right) / 2;
  const textCenterRow = (plan.textSafeZone.top + plan.textSafeZone.bottom) / 2;
  return Math.hypot(
    centerColumn - textCenterColumn,
    centerRow - textCenterRow,
  );
}

function clockGapFromText(plan, reservation) {
  return Math.hypot(
    Math.max(
      plan.textSafeZone.left - reservation.right,
      reservation.left - plan.textSafeZone.right,
      0,
    ),
    Math.max(
      plan.textSafeZone.top - reservation.bottom,
      reservation.top - plan.textSafeZone.bottom,
      0,
    ),
  );
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
    reservation.left >= 0
    && reservation.top >= 0
    && reservation.right <= plan.gridColumns
    && reservation.bottom <= plan.gridRows
  )));
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
  assert.equal(SETTINGS.countdownFramed.ui.noisePreview, false);
  const generator = createGenerator();
  generator.enter({ time: 0 });

  generator.update({ time: 0.999 });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds));
  const firstCell = generator.inspect().cellIndex;

  generator.update({ time: 1 });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds - 1));
  assert.notEqual(generator.inspect().cellIndex, firstCell);

  generator.update({ time: countFromSeconds - 0.001 });
  const finalTick = generator.inspect();
  assert.equal(finalTick.label, "00:01");
  assert.equal(finalTick.textCentered, true);
  assert.deepEqual(finalTick.textCenter, {
    x: finalTick.layout.offsetX + finalTick.layout.patternWidth / 2,
    y: finalTick.layout.offsetY + finalTick.layout.patternHeight / 2,
  });
  const centeredContext = createCountingContext();
  const centeredGlyphs = [];
  centeredContext.fillText = (...args) => centeredGlyphs.push(args);
  generator.draw({}, {}, centeredContext);
  assert.deepEqual(centeredGlyphs[2].slice(1), [
    finalTick.textCenter.x,
    finalTick.textCenter.y,
  ]);
  generator.update({ time: countFromSeconds });
  assert.equal(generator.inspect().label, formatCountdown(countFromSeconds));
  assert.equal(generator.inspect().textCentered, false);
  assert.equal(generator.animationDuration(), countFromSeconds);
  assert.deepEqual(COMPOSITION_DEFINITIONS["countdown-framed"].timing, {
    bodyDurationSeconds: countFromSeconds,
    beatCount: countFromSeconds,
  });
  const resolvedSynth = generator.inspect().appearance.synth;
  assert.deepEqual(
    resolvedSynth.tracks.map(track => [
      track.id,
      track.startSeconds,
      track.durationSeconds,
    ]),
    [
      ["clock-main", 0, countFromSeconds / 6],
      ["snake-main", countFromSeconds / 3, countFromSeconds / 3 - 3],
      ["bubbles-main", countFromSeconds * 2 / 3, countFromSeconds / 3],
    ],
  );
  assert.deepEqual(
    resolvedSynth.connections.map(connection => [
      connection.id,
      connection.startSeconds,
      Number(connection.durationSeconds.toFixed(9)),
    ]),
    [
      ["clock-snake", countFromSeconds / 6, countFromSeconds / 6],
      ["snake-bubbles", countFromSeconds * 2 / 3 - 3, 3],
    ],
  );
  const [clockTrack, snakeTrack, bubblesTrack] =
    SETTINGS.countdownFramed.appearance.synth.tracks;
  assert.equal(clockTrack.use, "clock");
  assert.equal(snakeTrack.use, "snake");
  assert.equal(bubblesTrack.use, "bubbles");
  assert.deepEqual(
    SETTINGS.countdownFramed.appearance.synth.connections.map(connection => [
      connection.from,
      connection.to,
    ]),
    [
      [clockTrack.id, snakeTrack.id],
      [snakeTrack.id, bubblesTrack.id],
    ],
  );
});

test("bubbles center their final tick geometry independently of the tuning score", () => {
  const countFromSeconds = SETTINGS.countdownFramed.countFromSeconds;
  const generator = createGenerator({
    options: singleTrackOptions("bubbles", countFromSeconds),
  });
  generator.enter({ time: countFromSeconds - 0.001 });
  const finalTick = generator.inspect();
  assert.equal(finalTick.appearance.frame.plan.textCentered, true);
  assert.deepEqual(finalTick.appearance.frame.plan.textCenter, {
    x: finalTick.appearance.frame.plan.gridColumns / 2,
    y: finalTick.appearance.frame.plan.gridRows / 2,
  });
  assert.ok(finalTick.appearance.frame.plan.digitCircles.every(circle => (
    circle.y === finalTick.appearance.frame.plan.gridRows / 2
  )));
  assert.deepEqual(
    finalTick.appearance.frame.avoidance.finalWipe.center,
    { xProgress: 0.5, yProgress: 0.5 },
  );
  const finalTimerCellIndex = Math.floor(finalTick.layout.rows / 2)
    * finalTick.layout.columns + Math.floor(finalTick.layout.columns / 2);
  assert.equal(
    finalTick.appearance.frame.merge.textSafeCellIndex,
    finalTimerCellIndex,
  );
  assert.equal(finalTick.appearance.frame.merge.textSafeCellCount, 1);
  assert.ok(finalTick.appearance.frame.frame.dots.every(dot => (
    !frameDotOverlapsRectangle(
      dot,
      finalTick.appearance.frame.frame.textSafeRectangle,
    )
  )));
  const finalWipe = finalTick.appearance.frame.avoidance.bubbles.find(
    bubble => bubble.kind === "final-wipe",
  );
  assert.equal(finalWipe.circles[0].x, finalTick.appearance.frame.plan.gridColumns / 2);
  assert.equal(finalWipe.circles[0].y, finalTick.appearance.frame.plan.gridRows / 2);
  generator.dispose();
});

test("one synth timeline track owns the full countdown without dormant effects", () => {
  const branchByUse = { clock: "clock", snake: "snake", bubbles: "frame" };
  for (const use of Object.keys(branchByUse)) {
    const options = singleTrackOptions(use);
    const sampleTime = use === "bubbles" ? 3.75 : 5.75;
    const sequential = createGenerator({ options });
    sequential.enter({ time: 0 });
    sequential.update({ time: 1 });
    sequential.update({ time: sampleTime });
    const sequentialState = sequential.inspect();
    const branch = branchByUse[use];

    assert.deepEqual(sequentialState.appearance.synth.activeTrackIds, [`${use}-0`]);
    assert.deepEqual(sequentialState.appearance.synth.activeConnectionIds, []);
    assert.deepEqual(
      sequentialState.appearance.synth.renderLayers.map(layer => layer.drawKey),
      [use],
    );
    assert.deepEqual(
      sequentialState.appearance.order.stages.map(stage => stage.effect),
      [use],
    );
    assert.notEqual(sequentialState.appearance[branch]?.plan, null);
    for (const absent of Object.values(branchByUse).filter(name => name !== branch)) {
      assert.equal(sequentialState.appearance[absent], null);
    }
    assert.doesNotThrow(() => JSON.stringify(sequentialState));

    const direct = createGenerator({ options });
    direct.enter({ time: sampleTime });
    assert.deepEqual(
      direct.inspect().appearance[branch],
      sequentialState.appearance[branch],
    );

    const context = createCountingContext();
    sequential.draw({}, {}, context);
    assert.equal(context.counts.text, 5);
    assert.ok(context.counts.fill > 0);
    sequential.resize({ width: 600, height: 900 });
    const resized = sequential.inspect();
    assert.notEqual(resized.appearance.synth.tracks[0].signal, null);
    assert.equal(resized.appearance.synth.activeTrackIds[0], `${use}-0`);

    sequential.dispose();
    direct.dispose();
  }
});

test("reordered untimed synth tracks split the countdown in timeline order", () => {
  const options = untimedTrackOptions(["bubbles", "clock"], 12);
  const sequential = createGenerator({ options });
  sequential.enter({ time: 0 });

  const bubblesStart = sequential.inspect();
  assert.deepEqual(bubblesStart.appearance.synth.activeTrackIds, ["bubbles-0"]);
  assert.deepEqual(
    bubblesStart.appearance.synth.renderLayers.map(layer => layer.drawKey),
    ["bubbles"],
  );
  assert.equal(bubblesStart.appearance.snake, null);

  sequential.update({ time: 5.999 });
  assert.deepEqual(
    sequential.inspect().appearance.synth.activeTrackIds,
    ["bubbles-0"],
  );
  sequential.update({ time: 6 });
  const clockStart = sequential.inspect();
  assert.deepEqual(clockStart.appearance.synth.activeTrackIds, ["clock-1"]);
  assert.deepEqual(
    clockStart.appearance.synth.renderLayers.map(layer => layer.drawKey),
    ["clock"],
  );
  assert.equal(clockStart.appearance.snake, null);

  sequential.update({ time: 11.999 });
  assert.deepEqual(
    sequential.inspect().appearance.synth.activeTrackIds,
    ["clock-1"],
  );

  const direct = createGenerator({ options });
  direct.enter({ time: 11.999 });
  assert.deepEqual(
    direct.inspect().appearance.clock,
    sequential.inspect().appearance.clock,
  );

  sequential.dispose();
  direct.dispose();
});

test("overlapping synth tracks fail during generator setup", () => {
  const baseOptions = untimedTrackOptions(["bubbles", "clock"], 6);
  const options = {
    ...baseOptions,
    appearance: {
      ...baseOptions.appearance,
      synth: {
        ...baseOptions.appearance.synth,
        tracks: baseOptions.appearance.synth.tracks.map(track => ({
          ...track,
          startSeconds: 0,
          durationSeconds: 6,
          evolution: { startSeconds: 0, durationSeconds: 6 },
        })),
      },
    },
  };
  assert.throws(
    () => createGenerator({ options }),
    /only one track or connection may play at a time/,
  );
});

test("hard-cut connectors own their bridge instead of leaving a blank interval", () => {
  const baseOptions = untimedTrackOptions(["bubbles", "clock"], 6);
  const [bubbles, clock] = baseOptions.appearance.synth.tracks;
  const options = {
    ...baseOptions,
    appearance: {
      ...baseOptions.appearance,
      synth: {
        ...baseOptions.appearance.synth,
        tracks: [
          {
            ...bubbles,
            startSeconds: 0,
            durationSeconds: 2,
            evolution: { startSeconds: 0, durationSeconds: 2 },
          },
          {
            ...clock,
            startSeconds: 4,
            durationSeconds: 2,
            evolution: { startSeconds: 4, durationSeconds: 2 },
          },
        ],
        connections: [{
          id: "bubbles-clock",
          from: bubbles.id,
          to: clock.id,
          use: "auto",
          startSeconds: 2,
          durationSeconds: 2,
          evolution: { startSeconds: 2, durationSeconds: 2 },
        }],
      },
    },
  };
  const generator = createGenerator({ options });
  generator.enter({ time: 2.5 });
  const bridge = generator.inspect().appearance.synth;
  assert.deepEqual(bridge.activeTrackIds, []);
  assert.deepEqual(bridge.activeConnectionIds, ["bubbles-clock"]);
  assert.deepEqual(bridge.renderLayers.map(layer => ({
    ownerType: layer.ownerType,
    ownerId: layer.ownerId,
    drawKey: layer.drawKey,
  })), [{
    ownerType: "connector",
    ownerId: "bubbles-clock",
    drawKey: "bubbles",
  }]);

  generator.update({ time: 4 });
  const destination = generator.inspect().appearance.synth;
  assert.deepEqual(destination.activeConnectionIds, []);
  assert.deepEqual(destination.activeTrackIds, ["clock-1"]);
  assert.deepEqual(destination.renderLayers.map(layer => layer.drawKey), ["clock"]);
  generator.dispose();
});

test("one synth track supports a one-second countdown", () => {
  const branchByUse = { clock: "clock", snake: "snake", bubbles: "frame" };
  for (const [use, branch] of Object.entries(branchByUse)) {
    const generator = createGenerator({ options: singleTrackOptions(use, 1) });
    generator.enter({ time: 0.75 });
    const state = generator.inspect();
    assert.deepEqual(state.appearance.synth.activeTrackIds, [`${use}-0`]);
    assert.notEqual(state.appearance[branch]?.plan, null);
    assert.equal(generator.animationDuration(), 1);
    generator.dispose();
  }
});

test("repeated effect types use their unique timeline track ids", () => {
  const generator = createGenerator({
    options: untimedTrackOptions(["clock", "clock"], 12),
  });
  generator.enter({ time: 0 });
  assert.deepEqual(
    generator.inspect().appearance.synth.activeTrackIds,
    ["clock-0"],
  );
  generator.update({ time: 6 });
  const state = generator.inspect();
  assert.deepEqual(state.appearance.synth.activeTrackIds, ["clock-1"]);
  assert.deepEqual(
    state.appearance.synth.renderLayers.map(layer => layer.ownerId),
    ["clock-1"],
  );
  generator.dispose();
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
    PALETTES.daybreak,
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
  assert.equal(stepCount, 7);
  assert.equal(reveal.palette.at(-1), "#ffffff");
  assert.equal(reveal.authoredDuration, authoredDuration);
  assert.equal(reveal.durationSource, "composition-beat");
  assert.equal(reveal.durationMultiplier, durationMultiplier);
  assert.equal(reveal.durationSeconds, durationMultiplier);
  assert.equal(stepSeconds, durationMultiplier / stepCount);
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [0, 0, 0, 0, 0]);

  generator.update({ time: stepSeconds });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [0, 0, 1, 0, 0]);
  generator.update({ time: stepSeconds * stepCount });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [5, 5, 5, 5, 5]);
  generator.update({ time: 0.999 });
  assert.deepEqual(generator.inspect().reveal.paletteIndices, [5, 5, 5, 5, 5]);
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

test("snake selects top or bottom secondary movement one third of the time", () => {
  const layout = { columns: 5, rows: 4 };
  const movement = SETTINGS.countdownFramed.appearance.effects.snake.secondaryMovement;
  assert.equal(movement.probability, 0.33);
  const directions = Array.from(
    { length: 3000 },
    (_, tick) => countdownSnakeSecondaryDirection(movement, 123, tick),
  );
  assert.deepEqual(
    directions,
    Array.from(
      { length: 3000 },
      (_, tick) => countdownSnakeSecondaryDirection(movement, 123, tick),
    ),
  );
  assert.deepEqual(new Set(directions), new Set(["none", "top", "bottom"]));
  const wrappedRatio = directions.filter(direction => direction !== "none").length
    / directions.length;
  assert.ok(Math.abs(wrappedRatio - movement.probability) < 0.02);
  assert.equal(
    countdownSnakeSecondaryDirection({ ...movement, enabled: false }, 123, 0),
    "none",
  );
  assert.equal(
    countdownSnakeSecondaryDirection({ ...movement, probability: 0 }, 123, 1),
    "none",
  );

  for (const direction of ["top", "bottom"]) {
    const route = countdownSnakeWrappedPath(layout, 6, 18, 42, [], direction);
    const repeated = countdownSnakeWrappedPath(layout, 6, 18, 42, [], direction);
    assert.deepEqual(route, repeated);
    assert.equal(route.direction, direction);
    assert.equal(route.path[0], 6);
    assert.equal(route.path.at(-1), 18);
    assert.equal(route.exitIndex % layout.columns, route.entryIndex % layout.columns);
    assert.equal(
      Math.floor(route.exitIndex / layout.columns),
      direction === "top" ? 0 : layout.rows - 1,
    );
    assert.equal(
      Math.floor(route.entryIndex / layout.columns),
      direction === "top" ? layout.rows - 1 : 0,
    );
    assert.equal(route.path[route.wrapStep - 1], route.exitIndex);
    assert.equal(route.path[route.wrapStep], route.entryIndex);
    assert.equal(
      route.path.slice(1).filter((cell, index) => (
        manhattanGridDistance(layout, route.path[index], cell) !== 1
      )).length,
      1,
    );
    assert.deepEqual(
      countdownSnakeWrappedPath(layout, 6, 18, 0x80000000, [], direction),
      countdownSnakeWrappedPath(layout, 6, 18, 0x80000000, [], direction),
    );
  }

  const highBitSeedGenerator = createGenerator({
    seed: 0xffffffff,
    options: snakeBubblesOptions(),
  });
  highBitSeedGenerator.enter({ time: 1 });
  assert.equal(
    highBitSeedGenerator.inspect().appearance.snake.plan.seed,
    0xffffffff,
  );
  highBitSeedGenerator.dispose();

  const generator = createGenerator({ options: snakeBubblesOptions() });
  generator.enter({ time: 0 });
  const initialSnake = generator.inspect().appearance.snake;
  assert.equal(initialSnake.secondaryMovement.enabled, true);
  assert.equal(initialSnake.secondaryMovement.probability, 0.33);
  assert.equal(initialSnake.plan.secondaryMovement.enabled, false);
  assert.equal(initialSnake.plan.secondaryMovement.direction, "none");
  assert.equal(initialSnake.frame.secondaryMovement.wrapped, false);
  generator.update({ time: 1 });
  const wrappedSnake = generator.inspect().appearance.snake;
  assert.equal(wrappedSnake.plan.secondaryMovement.enabled, true);
  assert.ok(["top", "bottom"].includes(
    wrappedSnake.plan.secondaryMovement.direction,
  ));
  generator.update({ time: 1.999 });
  assert.equal(
    generator.inspect().appearance.snake.frame.secondaryMovement.wrapped,
    true,
  );
  generator.dispose();

  const narrow = createGenerator({
    seed: 28,
    viewport: { width: 390, height: 844 },
    options: snakeBubblesOptions(),
  });
  narrow.enter({ time: 29.999 });
  const narrowSnake = narrow.inspect().appearance.snake;
  assert.equal(narrowSnake.plan.secondaryMovement.avoidance, "strict");
  assert.equal(
    new Set(narrowSnake.frame.cells.map(cell => cell.index)).size,
    narrowSnake.frame.cells.length,
  );
  narrow.dispose();

  assert.throws(
    () => countdownSnakeWrappedPath(layout, 6, 18, 42, [], "left"),
    /secondary direction must be one of: top, bottom/,
  );
  const snakeSettings = SETTINGS.countdownFramed.appearance.effects.snake;
  assert.throws(
    () => createGenerator({
      options: withTrackSettings("snake", {
        ...snakeSettings,
        secondaryMovement: {
          ...snakeSettings.secondaryMovement,
          probability: 1.01,
        },
      }, snakeBubblesOptions()),
    }),
    /probability must be from zero to one/,
  );
  assert.throws(
    () => createGenerator({
      options: withTrackSettings("snake", {
        ...snakeSettings,
        secondaryMovement: {
          ...snakeSettings.secondaryMovement,
          directions: ["left"],
        },
      }, snakeBubblesOptions()),
    }),
    /directions must only contain: top, bottom/,
  );
});

test("snake routes around the single parent cell containing the timer", () => {
  const layout = { columns: 5, rows: 3 };
  const textSafeCellIndices = countdownSnakeTextSafeCells(
    layout,
    0,
  );
  assert.deepEqual(textSafeCellIndices, [0]);

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

test("snake tapers its body and engorgement reveals one pulsing meal", () => {
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
  const collisionFrame = countdownSnakeFrame(
    { path: [0, 1, 2, 1, 3] },
    1,
    { ...settings, lengthCells: 5 },
  );
  assert.deepEqual(collisionFrame.selfCollision, {
    active: true,
    cellIndices: [1],
  });
  assert.equal(
    new Set(collisionFrame.cells.map(cell => cell.index)).size,
    collisionFrame.cells.length,
  );
  const collisionColors = countdownSnakeGlyphColors(
    { index: 1, level: 1 },
    collisionFrame,
    { columns: 4 },
    ["dark", "light"],
    {
      amount: 1,
      scope: "cell",
      distribution: "level",
      paletteColors: ["flicker-dark", "flicker-light"],
      sampleAt: () => 1,
      spreadsRankAcrossCell: () => false,
      paletteIndexFromSample: () => 1,
    },
    0,
    3,
  );
  assert.deepEqual(collisionColors, Array(4).fill("flicker-light"));
  const engorgementSettings = {
    maximumSubdivisionLevel: 3,
    engorgement: {
      mealRevealBeforeEndBeats: 0.5,
      mealPulseScale: 1.08,
      mealPulseTimingCurve: [0.42, 0, 0.58, 1],
    },
  };
  const engorgementPlan = {
    snapshots: [[5, 6, 7], [6, 7, 8], [7, 8, 9]],
    routeStepCount: 2,
    movementStepCount: 2,
    beatCount: 2,
    stepsPerBeat: 1,
    columns: 6,
    rows: 2,
    safeCellsByBeat: [[], [], []],
    targetLength: 4,
    plannedLength: 4,
    capacityLength: 5,
    mealIndex: 10,
    collisionCount: 0,
    collisionSteps: [],
    wrapSteps: [],
    tickSeconds: 1,
    durationSeconds: 2,
  };
  const hiddenMeal = countdownSnakeEngorgementFrame(
    engorgementPlan,
    0.5,
    engorgementSettings,
  );
  assert.equal(hiddenMeal.foodVisible, false);
  assert.ok(hiddenMeal.cells.every(cell => cell.scale === undefined));
  const pulsingMeal = countdownSnakeEngorgementFrame(
    engorgementPlan,
    0.875,
    engorgementSettings,
  );
  assert.equal(pulsingMeal.foodVisible, true);
  assert.equal(pulsingMeal.cells.filter(cell => cell.pulse).length, 2);
  assert.ok(pulsingMeal.pulse.scale > 1);
  assert.ok(pulsingMeal.pulse.scale <= 1.08);
  assert.deepEqual(frame.cells.map(cell => cell.level), [0, 1, 2, 3, 2, 1, 0]);
});

test("stable snake stops beside type before connector engorgement takes ownership", () => {
  const generator = createGenerator({ options: snakeBubblesOptions() });
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
  const connection = first.appearance.synth.connections.find(
    candidate => candidate.id === "snake-bubbles",
  );
  generator.update({ time: connection.startSeconds - 0.001 });
  const continuing = generator.inspect().appearance.snake;
  assert.equal(continuing.engorgement.connectorProgress, 0);
  assert.equal(continuing.renderFrame.routeStep, null);
  assert.equal(continuing.renderFrame.headStep, continuing.frame.headStep);
  assert.deepEqual(
    generator.inspect().appearance.synth.activeTrackIds,
    ["snake-main"],
  );
  generator.update({ time: connection.startSeconds });
  const handoff = generator.inspect().appearance.snake;
  assert.deepEqual(handoff.renderFrame.cells, handoff.handoff.cells);
  generator.update({ time: connection.startSeconds + 0.25 });
  const transitioning = generator.inspect().appearance.snake;
  assert.ok(transitioning.engorgement.connectorProgress > 0);
  assert.ok(
    transitioning.engorgement.currentLength
      > transitioning.engorgement.startLength,
  );
  assert.equal(transitioning.renderFrame.headIndex, transitioning.engorgement.headIndex);
  assert.equal(Object.hasOwn(transitioning.renderFrame, "consumedCells"), false);
  generator.dispose();
});

test("normal snake movement hands off to a three-second fill transition", () => {
  assert.equal(countdownSnakeLengthAt(7, 0, true, 75), 7);
  assert.equal(countdownSnakeLengthAt(7, 1, true, 75), 8);
  assert.equal(countdownSnakeLengthAt(7, 100, true, 75), 75);
  assert.equal(countdownSnakeLengthAt(7, 100, false, 75), 7);
  assert.equal(countdownSnakeLengthAt(100, 0, true, 75), 75);

  const generator = createGenerator({ options: snakeBubblesOptions() });
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
  const connection = generator.inspect().appearance.synth.connections.find(
    candidate => candidate.id === "snake-bubbles",
  );
  const connectionEndSeconds =
    connection.startSeconds + connection.durationSeconds;
  assert.equal(connection.durationSeconds, 3);
  generator.update({ time: connection.startSeconds - 0.001 });
  assert.deepEqual(
    generator.inspect().appearance.synth.activeTrackIds,
    ["snake-main"],
  );
  generator.update({ time: connection.startSeconds });
  const connectorStart = generator.inspect().appearance.snake.engorgement;
  assert.equal(connectorStart.currentLength, connectorStart.startLength);
  generator.update({ time: connection.startSeconds + connection.durationSeconds / 2 });
  const midpoint = generator.inspect().appearance.snake.engorgement;
  assert.equal(midpoint.connectorProgress, 0.5);
  assert.ok(midpoint.currentLength > midpoint.startLength);
  assert.ok(midpoint.currentLength < midpoint.targetLength);
  assert.equal(midpoint.growthActive, true);
  generator.update({ time: connectionEndSeconds - 0.001 });
  const finalConnector = generator.inspect().appearance.snake.engorgement;
  assert.ok(
    Math.abs(finalConnector.currentLength - finalConnector.targetLength) <= 1,
  );
  assert.equal(finalConnector.capacityLength, finalConnector.targetLength);
  generator.update({ time: duration });
  assert.equal(generator.inspect().appearance.snake.lengthCells, 7);
  generator.dispose();

  const fixed = createGenerator({
    options: withTrackSettings("snake", {
      ...SETTINGS.countdownFramed.appearance.effects.snake,
      growAfterEachTick: false,
    }, snakeBubblesOptions()),
  });
  fixed.enter({ time: 0 });
  fixed.update({
    time: connection.startSeconds + connection.durationSeconds / 2,
  });
  assert.ok(
    fixed.inspect().appearance.snake.engorgement.currentLength
      > fixed.inspect().appearance.snake.engorgement.startLength,
  );
  fixed.dispose();
});

test("wraparound engorgement fills every parent cell deterministically", () => {
  const assertPlan = (plan, settings) => {
    assert.ok(plan.collisionCount >= 0);
    assert.equal(plan.capacityLength, plan.columns * plan.rows);
    assert.equal(plan.reachableLength, plan.capacityLength);
    assert.equal(plan.targetLength, plan.plannedLength);
    assert.equal(plan.snapshots.length, plan.routeStepCount + 1);
    assert.deepEqual(plan.snapshots[0], plan.snapshots[0].slice());
    for (let routeStep = 0; routeStep < plan.snapshots.length; routeStep += 1) {
      const body = plan.snapshots[routeStep];
      const growthProgress = routeStep <= plan.growthStartStep
        ? 0
        : Math.min(
          1,
          (routeStep - plan.growthStartStep)
            / (plan.movementStepCount - plan.growthStartStep),
        );
      const expectedLength = plan.startLength + Math.floor(
        (plan.targetBodyLength - plan.startLength)
          * growthProgress,
      );
      assert.equal(body.length, expectedLength);
      const toroidalDistance = (first, second) => {
        const columnDistance = Math.abs(
          first % plan.columns - second % plan.columns,
        );
        const rowDistance = Math.abs(
          Math.floor(first / plan.columns)
            - Math.floor(second / plan.columns),
        );
        return Math.min(columnDistance, plan.columns - columnDistance)
          + Math.min(rowDistance, plan.rows - rowDistance);
      };
      assert.ok(body.slice(1).every((index, position) => (
        toroidalDistance(body[position], index) === 1
      )));
      if (routeStep > 0) {
        const previousBody = plan.snapshots[routeStep - 1];
        if (routeStep <= plan.growthStartStep) {
          assert.equal(body.length, plan.startLength);
          if (body.at(-1) === previousBody.at(-1)) {
            assert.deepEqual(body, previousBody);
          } else {
            assert.equal(toroidalDistance(
              previousBody.at(-1),
              body.at(-1),
            ), 1);
            assert.deepEqual(body.slice(0, -1), previousBody.slice(1));
          }
        } else if (routeStep > plan.movementStepCount) {
          assert.deepEqual(body, previousBody);
        }
        if (body.length > previousBody.length) {
          const addedCount = body.length - previousBody.length;
          assert.deepEqual(body.slice(0, -addedCount), previousBody);
        }
      }
    }
    if (plan.growthStartStep > 0) {
      assert.ok(plan.snapshots[plan.growthStartStep - 1].at(-1)
        !== plan.snapshots[0].at(-1));
    }
    assert.ok(plan.snapshots
      .slice(0, plan.growthStartStep + 1)
      .every(body => body.length === plan.startLength));
    assert.ok(plan.beats.slice(1).every((beat, index) => (
      beat.uniqueCellCount >= plan.beats[index].uniqueCellCount
    )));
    assert.equal(plan.snapshots.at(-1).length + 1, plan.plannedLength);
    assert.equal(new Set(plan.snapshots.at(-1)).size, plan.targetBodyLength);
    assert.ok(!plan.snapshots.at(-1).includes(plan.mealIndex));
    const finalVisible = countdownSnakeEngorgementFrame(plan, 0.999, settings);
    assert.equal(finalVisible.uniqueCellCount, plan.columns * plan.rows);
    assert.equal(finalVisible.coverage, 1);
    assert.equal(finalVisible.coverageComplete, true);
    assert.equal(finalVisible.movementComplete, true);
    assert.ok(finalVisible.wrapCount > 0);
    assert.doesNotThrow(() => JSON.stringify(plan));
  };

  const landscape = createGenerator({ options: snakeBubblesOptions() });
  assertPlan(landscape.snakeEngorgementPlan, landscape.snakeSettings);
  landscape.enter({ time: 15 });
  landscape.resize({ width: 600, height: 900 });
  assertPlan(landscape.snakeEngorgementPlan, landscape.snakeSettings);
  const resizedFrame = landscape.inspect().appearance.snake.renderFrame;

  const portrait = createGenerator({
    viewport: { width: 600, height: 900 },
    options: snakeBubblesOptions(),
  });
  portrait.enter({ time: 15 });
  assert.deepEqual(
    portrait.inspect().appearance.snake.renderFrame,
    resizedFrame,
  );

  const smaller = createGenerator({
    options: { ...snakeBubblesOptions(), longSideCells: 10 },
  });
  assertPlan(smaller.snakeEngorgementPlan, smaller.snakeSettings);
  assert.doesNotThrow(() => JSON.stringify(landscape.inspect()));
  assert.doesNotThrow(() => JSON.stringify(portrait.inspect()));
  assert.doesNotThrow(() => JSON.stringify(smaller.inspect()));
  landscape.dispose();
  portrait.dispose();
  smaller.dispose();
});

test("countdown effects inherit the composition palette", () => {
  const generator = createGenerator({
    options: withTrackSettings("snake", {
      ...SETTINGS.countdownFramed.appearance.effects.snake,
      enabled: true,
    }, snakeBubblesOptions()),
  });
  generator.enter({ time: SETTINGS.countdownFramed.countFromSeconds / 3 + 5 });
  const appearance = generator.inspect().appearance;
  const snake = appearance.snake;
  const paletteName = SETTINGS.countdownFramed.palette;
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
  assert.ok(context.counts.fill >= snake.renderFrame.cells.length);
  assert.equal(
    pathColors.at(-1),
    countdownPalette({ palette: paletteName }, PALETTES)[0],
  );
  generator.dispose();
});

test("snake alternates progressively lighter pairs except on its biggest dots", () => {
  const palette = ["darkest", "dark", "middle", "light", "lightest"];
  const layout = { columns: 4 };
  const frame = { deathFlicker: { active: false } };
  const colorsAtLevel = level => countdownSnakeGlyphColors(
    { index: level, level },
    frame,
    layout,
    palette,
    null,
    0,
    3,
  );

  assert.deepEqual(colorsAtLevel(0), ["darkest"]);
  assert.deepEqual(new Set(colorsAtLevel(1)), new Set(["darkest", "dark"]));
  assert.deepEqual(new Set(colorsAtLevel(2)), new Set(["middle", "light"]));
  assert.deepEqual(new Set(colorsAtLevel(3)), new Set(["light", "lightest"]));
  assert.deepEqual(
    new Set(Array.from({ length: 4 }, (_, level) => colorsAtLevel(level)).flat()),
    new Set(palette),
  );
});

test("snake color variations are equally weighted and deterministically striped", () => {
  const variations = SETTINGS.countdownFramed.appearance.effects.snake.colorVariations;
  assert.deepEqual(variations.map(({ use, weight }) => [use, weight]), [
    ["none", 1],
    ["vertical-stripes", 1],
    ["horizontal-stripes", 1],
  ]);
  const selected = Array.from(
    { length: 30 },
    (_, tick) => countdownSnakeColorVariation(variations, 123, tick),
  );
  assert.deepEqual(
    selected,
    Array.from(
      { length: 30 },
      (_, tick) => countdownSnakeColorVariation(variations, 123, tick),
    ),
  );
  assert.deepEqual(new Set(selected), new Set(variations.map(({ use }) => use)));

  const palette = ["darkest", "dark", "middle", "light", "lightest"];
  const colors = colorVariation => countdownSnakeGlyphColors(
    { index: 0, level: 1 },
    { colorVariation, deathFlicker: { active: false } },
    { columns: 4 },
    palette,
    null,
    0,
    3,
  );
  assert.deepEqual(colors("none"), ["dark", "dark", "dark", "dark"]);
  assert.deepEqual(colors("vertical-stripes"), ["darkest", "dark", "darkest", "dark"]);
  assert.deepEqual(colors("horizontal-stripes"), ["darkest", "darkest", "dark", "dark"]);
  assert.throws(
    () => countdownSnakeColorVariation([{ use: "diagonal", weight: 1 }], 123, 0),
    /must be one of: none, vertical-stripes, horizontal-stripes/,
  );
  assert.throws(
    () => countdownSnakeColorVariation([{ use: "none", weight: 0 }], 123, 0),
    /weight must be a finite positive number/,
  );
});

test("snake disappearance equally selects instant removal or an accelerating tail dive", () => {
  const variations = SETTINGS.countdownFramed.appearance.effects.snake
    .disappearanceVariations;
  assert.deepEqual(variations.map(({ use, weight }) => [use, weight]), [
    ["instant", 1],
    ["tail-dive", 1],
  ]);
  const selected = Array.from(
    { length: 100 },
    (_, tick) => countdownSnakeDisappearanceVariation(variations, 123, tick),
  );
  assert.deepEqual(
    selected,
    Array.from(
      { length: 100 },
      (_, tick) => countdownSnakeDisappearanceVariation(variations, 123, tick),
    ),
  );
  assert.deepEqual(new Set(selected), new Set(["instant", "tail-dive"]));

  const completedFrame = {
    colorVariation: "horizontal-stripes",
    cells: Array.from({ length: 7 }, (_, index) => ({ index, level: index % 4 })),
  };
  assert.equal(
    countdownSnakeDisappearanceFrame(completedFrame, "instant", 0).cells.length,
    0,
  );
  const diveStart = countdownSnakeDisappearanceFrame(
    completedFrame,
    "tail-dive",
    0,
  );
  const diveMiddle = countdownSnakeDisappearanceFrame(
    completedFrame,
    "tail-dive",
    0.5,
  );
  const diveEnd = countdownSnakeDisappearanceFrame(
    completedFrame,
    "tail-dive",
    1,
  );
  assert.deepEqual(diveStart.cells, completedFrame.cells);
  assert.equal(diveMiddle.progress, 0.25);
  assert.deepEqual(diveMiddle.cells, completedFrame.cells.slice(1));
  assert.deepEqual(diveEnd.cells, []);

  const instantGenerator = createGenerator({ options: snakeBubblesOptions() });
  instantGenerator.enter({ time: 1 });
  assert.equal(
    instantGenerator.inspect().appearance.snake.disappearance.mode,
    "instant",
  );
  assert.deepEqual(
    instantGenerator.inspect().appearance.snake.disappearance.cells,
    [],
  );
  instantGenerator.dispose();

  const diveGenerator = createGenerator({ options: snakeBubblesOptions() });
  diveGenerator.enter({ time: 2.999999 });
  const beforeDive = diveGenerator.inspect().appearance.snake;
  diveGenerator.update({ time: 3 });
  const initialDiveSnake = diveGenerator.inspect().appearance.snake;
  const initialDive = initialDiveSnake.disappearance;
  assert.equal(initialDive.sourceTick, 2);
  assert.equal(initialDive.selectedMode, "tail-dive");
  assert.equal(initialDive.phase, "dive");
  assert.equal(initialDive.mode, "tail-dive");
  assert.deepEqual(initialDive.cells, []);
  assert.deepEqual(initialDiveSnake.plan.routeTicks, [3, 4]);
  assert.equal(initialDiveSnake.frame.lifecycleProgress, 0);
  assert.deepEqual(
    initialDiveSnake.frame.cells.filter(cell => cell.opacity !== 0),
    beforeDive.renderFrame.cells.filter(cell => cell.opacity !== 0),
  );
  assert.equal(initialDiveSnake.frame.cells.at(-1).opacity, 0);
  diveGenerator.update({ time: 3.75 });
  const prolongedDive = diveGenerator.inspect().appearance.snake;
  assert.equal(prolongedDive.frame.lifecycleProgress, 0.375);
  assert.ok(prolongedDive.frame.cells.length > initialDiveSnake.frame.cells.length);
  diveGenerator.update({ time: 3.999999 });
  const beforeEmerge = diveGenerator.inspect().appearance.snake;
  diveGenerator.update({ time: 4 });
  const emergeSnake = diveGenerator.inspect().appearance.snake;
  assert.equal(emergeSnake.disappearance.phase, "emerge");
  assert.deepEqual(emergeSnake.disappearance.cells, []);
  assert.equal(emergeSnake.plan.routeTick, 3);
  assert.deepEqual(emergeSnake.plan.routeTicks, [3, 4]);
  assert.equal(emergeSnake.frame.lifecycleProgress, 0.5);
  assert.equal(emergeSnake.frame.headStep, beforeEmerge.frame.headStep);
  assert.deepEqual(emergeSnake.frame.cells, beforeEmerge.frame.cells);
  diveGenerator.update({ time: 4.5 });
  const emergedSnake = diveGenerator.inspect().appearance.snake;
  assert.equal(emergedSnake.frame.lifecycleProgress, 0.75);
  assert.ok(emergedSnake.disappearance.removedCellCount > 0);
  assert.deepEqual(emergedSnake.disappearance.cells, []);
  diveGenerator.dispose();

  for (const seed of [0, 1, 123, 0xffffffff]) {
    const lifecycleGenerator = createGenerator({
      seed,
      options: snakeBubblesOptions(),
    });
    lifecycleGenerator.enter({ time: 0 });
    let previousDiveTick = -Infinity;
    let diveCount = 0;
    for (let tick = 1; tick <= 30; tick += 1) {
      lifecycleGenerator.update({ time: tick - 0.000001 });
      const beforeState = lifecycleGenerator.inspect();
      const before = beforeState.appearance.snake;
      lifecycleGenerator.update({ time: tick });
      const afterState = lifecycleGenerator.inspect();
      const after = afterState.appearance.snake;
      if (
        !beforeState.appearance.synth.activeTrackIds.includes("snake-main")
        || !afterState.appearance.synth.activeTrackIds.includes("snake-main")
      ) {
        continue;
      }
      if (after.disappearance.phase !== "dive") continue;
      const unwrappedTick = tick === 30 ? 30 : tick;
      assert.ok(unwrappedTick - previousDiveTick >= 3);
      assert.equal(before.disappearance.phase, "move");
      assert.deepEqual(
        after.frame.cells.filter(cell => cell.opacity !== 0),
        before.renderFrame.cells.filter(cell => cell.opacity !== 0),
      );
      previousDiveTick = unwrappedTick;
      diveCount += 1;
    }
    assert.ok(diveCount > 0);
    lifecycleGenerator.dispose();
  }

  assert.throws(
    () => countdownSnakeDisappearanceVariation(
      [{ use: "fade", weight: 1 }],
      123,
      0,
    ),
    /must be one of: instant, tail-dive/,
  );
});

test("clock reveals two nearby 2x2 squares clockwise per beat", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const revealSettings = {
    ...settings,
    sizeWaterfall: { ...settings.sizeWaterfall, enabled: false },
  };
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
    farSeparationMinimumRadiusInCells:
      settings.farSeparation.minimumRadiusInCells,
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
  assert.equal(countdownClockFrame(plan, 0, revealSettings).visibleCount, 0);
  assert.deepEqual(
    countdownClockFrame(plan, 0.5, revealSettings).dots.map(
      dot => dot.clockwiseIndex,
    ),
    [0, 1, 0, 1],
  );
  assert.equal(countdownClockFrame(plan, 0.999, revealSettings).visibleCount, 8);
});

test("clock placement allows text-safe boundary neighbors without overlap", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const plan = countdownClockPlan({
    seed: 0,
    tick: 0,
    layout: { columns: 3, rows: 3 },
    cellIndex: 2,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
  });
  const neighboringSquare = plan.squares.find(square => (
    square.reservation.right === plan.textSafeZone.left
  ));

  assert.ok(neighboringSquare);
  assert.equal(
    neighboringSquare.reservation.right - neighboringSquare.reservation.left,
    plan.squareSize,
  );
  assert.equal(
    clockBoundsOverlap(neighboringSquare.reservation, plan.textSafeZone),
    false,
  );
  assertClockSafeZones(plan);
});

test("clock size waterfall merges only complete 2x2 dot blocks", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const plan = countdownClockPlan({
    seed: 0,
    tick: 2,
    layout: { columns: 3, rows: 3 },
    cellIndex: 7,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
  });
  const waterfallSettings = {
    ...settings,
    sizeWaterfall: { enabled: true, bothCells: true, clockProbability: 1 },
  };

  const incomplete = countdownClockFrame(plan, 0.5, waterfallSettings);
  assert.equal(incomplete.sourceVisibleCount, 4);
  assert.equal(incomplete.visibleCount, 4);
  assert.ok(incomplete.dots.every(dot => dot.sizeInSubdivisions === 1));

  const complete = countdownClockFrame(plan, 0.999, waterfallSettings);
  assert.equal(complete.sourceVisibleCount, 8);
  assert.equal(complete.visibleCount, 5);
  assert.deepEqual(
    complete.dots.map(dot => dot.sizeInSubdivisions).sort((a, b) => a - b),
    [1, 1, 1, 1, 2],
  );
  assert.deepEqual(
    complete.dots.map(dot => dot.sourceDotCount).sort((a, b) => a - b),
    [1, 1, 1, 1, 4],
  );
  assert.deepEqual(
    countdownClockFrame(plan, 0.999, waterfallSettings),
    complete,
  );
});

test("clock size waterfall keeps misaligned blocks on the fine grid", () => {
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
  const frame = countdownClockFrame(plan, 0.999, {
    ...settings,
    sizeWaterfall: { enabled: true, bothCells: true, clockProbability: 1 },
  });

  assert.ok(plan.squares.every(square => (
    square.topLeftColumn % 2 !== 0 || square.topLeftRow % 2 !== 0
  )));
  assert.equal(frame.sourceVisibleCount, 8);
  assert.equal(frame.visibleCount, 8);
  assert.ok(frame.dots.every(dot => dot.sizeInSubdivisions === 1));
});

test("clock size waterfall can target only the traveling cell", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const plan = countdownClockPlan({
    seed: 0,
    tick: 2,
    layout: { columns: 3, rows: 3 },
    cellIndex: 7,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
  });
  const frame = countdownClockFrame(plan, 0.999, {
    ...settings,
    sizeWaterfall: { enabled: true, bothCells: false, clockProbability: 1 },
  });
  const travelingSquareIndex = plan.squares.find(
    square => square.motionRole === "traveling",
  ).squareIndex;
  const anchoredSquareIndex = plan.squares.find(
    square => square.motionRole === "anchored",
  ).squareIndex;

  assert.deepEqual(
    frame.dots
      .filter(dot => dot.squareIndex === travelingSquareIndex)
      .map(dot => dot.sizeInSubdivisions),
    [2],
  );
  assert.deepEqual(
    frame.dots
      .filter(dot => dot.squareIndex === anchoredSquareIndex)
      .map(dot => dot.sizeInSubdivisions),
    [1, 1, 1, 1],
  );
});

test("clock far-separation moves only the traveling cell", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const base = {
    seed: 42,
    tick: 0,
    layout: { columns: 11, rows: 7 },
    cellIndex: 13,
    subdivisionLevel: settings.subdivisionLevel,
    squareCount: settings.squareCount,
    dotsPerSquare: settings.dotsPerSquare,
    rangeInSubdivisions: settings.rangeInSubdivisions,
    textSafeZone: settings.textSafeZone,
    minimumSquareGapInSubdivisions:
      settings.minimumSquareGapInSubdivisions,
    farSeparationMinimumRadiusInCells:
      settings.farSeparation.minimumRadiusInCells,
  };
  const regular = countdownClockPlan({
    ...base,
    farSeparationProbability: 0,
  });
  const separated = countdownClockPlan({
    ...base,
    farSeparationProbability: 1,
  });
  const reservationFor = (plan, role) => plan.squares.find(
    square => square.motionRole === role,
  ).reservation;

  assert.equal(regular.farSeparated, false);
  assert.equal(separated.farSeparated, true);
  assert.deepEqual(
    reservationFor(separated, "anchored"),
    reservationFor(regular, "anchored"),
  );
  assert.notDeepEqual(
    reservationFor(separated, "traveling"),
    reservationFor(regular, "traveling"),
  );
  assert.ok(
    clockDistanceFromText(
      separated,
      reservationFor(separated, "anchored"),
    ) < clockDistanceFromText(
      separated,
      reservationFor(separated, "traveling"),
    ),
  );
  assert.ok(
    separated.separationDistanceInSubdivisions
      >= settings.farSeparation.minimumRadiusInCells * separated.subdivisions,
  );
  const farReservation = reservationFor(separated, "traveling");
  const touchesHorizontalEdge = farReservation.left === 0
    || farReservation.right === separated.gridColumns;
  const touchesVerticalEdge = farReservation.top === 0
    || farReservation.bottom === separated.gridRows;
  assert.equal(touchesHorizontalEdge && touchesVerticalEdge, false);
  assertClockSafeZones(separated);
  assert.deepEqual(
    countdownClockPlan({ ...base, farSeparationProbability: 1 }),
    separated,
  );

  const flips = Array.from({ length: 10 }, (_, tick) => countdownClockPlan({
    ...base,
    tick,
    farSeparationProbability: 0.5,
  }).farSeparated);
  assert.deepEqual(new Set(flips), new Set([false, true]));
});

test("far clock square chooses likely fitting patterns that resync", () => {
  const settings = SETTINGS.countdownFramed.appearance.effects.clock;
  const offset = settings.travelingSquareBeatOffset;
  assert.equal(offset.probability, 0.85);
  assert.deepEqual(offset.patterns.map(pattern => [
    pattern.durationBeats,
    pattern.repeatCount,
  ]), [
    [0.75, 4],
    [1.25, 4],
    [1.5, 2],
    [2, 1],
    [2.5, 2],
  ]);
  const expectedPatterns = new Set([
    "quick-four",
    "five-four",
    "slow-two",
    "double-hold",
    "long-two",
  ]);
  const triggeredPatterns = new Set();
  let activeBlockCount = 0;
  let blockCount = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const schedule = countdownClockOffsetSchedule(seed, 9, offset);
    assert.equal(schedule.blocks[0].startBeat, 0);
    assert.equal(schedule.blocks.at(-1).endBeat, 9);
    for (const block of schedule.blocks) {
      blockCount += 1;
      assert.ok(Number.isInteger(block.startBeat));
      assert.ok(Number.isInteger(block.endBeat));
      assert.equal(block.endBeat - block.startBeat, block.totalBeats);
      assert.equal(block.durationBeats * block.repeatCount, block.totalBeats);
      if (!block.active) continue;
      activeBlockCount += 1;
      triggeredPatterns.add(block.patternId);
    }
  }
  assert.deepEqual(
    triggeredPatterns,
    expectedPatterns,
  );
  assert.ok(activeBlockCount / blockCount > 0.7);

  const noFit = countdownClockOffsetSchedule(42, 2, {
    enabled: true,
    probability: 1,
    patterns: [{ id: "three-beat", durationBeats: 0.75, repeatCount: 4 }],
  });
  assert.deepEqual(noFit.blocks.map(block => block.patternId), [
    "synced",
    "synced",
  ]);
  assert.equal(countdownClockOffsetStateAt(noFit, 2), null);
  assert.throws(
    () => countdownClockOffsetSchedule(42, 6, {
      enabled: true,
      probability: 1,
      patterns: [{ id: "cannot-resync", durationBeats: 2.25, repeatCount: 2 }],
    }),
    /must resync on a whole main beat; 2.25 × 2 = 4.5/,
  );
});

test("far clock square keeps its independent cadence until each resync", () => {
  const options = singleTrackOptions("clock");
  options.appearance.synth.tracks[0].settings = {
    ...options.appearance.synth.tracks[0].settings,
    travelingSquareBeatOffset: {
      enabled: true,
      probability: 1,
      patterns: [{ id: "quick-four", durationBeats: 0.75, repeatCount: 4 }],
    },
    farSeparation: { enabled: true, probability: 1 },
  };
  let generator;
  const lines = captureDebug(["config", "transition"], () => {
    generator = createGenerator({ seed: 42, options });
    generator.enter({ time: 0.74 });
    generator.update({ time: 0.76 });
  });
  assert.ok(lines.some(line => (
    line.includes("travelingBeatOffset=yes")
    && line.includes("beatOffsetPatterns=quick-four:0.75x4")
  )));
  assert.ok(lines.some(line => (
    line.includes("countdown-clock-offset state=active")
    && line.includes("pattern=quick-four")
    && line.includes("instance=2/4")
  )));

  let state = generator.inspect().appearance.clock;
  assert.equal(state.offsetState.blockStartBeat, 0);
  assert.equal(state.offsetState.instanceIndex, 1);
  assert.equal(state.offsetState.durationBeats, 0.75);
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "anchored",
  ).sourceTick, 0);
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "traveling",
  ).sourceTick, 100001);

  generator.update({ time: 1.1 });
  state = generator.inspect().appearance.clock;
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "anchored",
  ).sourceTick, 1);
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "traveling",
  ).sourceTick, 100001);

  generator.update({ time: 3 });
  state = generator.inspect().appearance.clock;
  assert.equal(state.offsetState.blockStartBeat, 3);
  assert.equal(state.offsetState.instanceIndex, 0);
  assert.equal(state.offsetState.instanceAgeBeats, 0);
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "anchored",
  ).sourceTick, 3);
  assert.equal(state.frame.squares.find(
    square => square.motionRole === "traveling",
  ).sourceTick, 100004);

  generator.seek(6);
  const looped = generator.inspect().appearance.clock;
  assert.equal(looped.offsetState.blockStartBeat, 0);
  assert.equal(looped.offsetState.instanceIndex, 0);
  assert.equal(looped.offsetState.instanceAgeBeats, 0);
  assert.equal(looped.frame.squares.find(
    square => square.motionRole === "anchored",
  ).sourceTick, 0);
  assert.equal(looped.frame.squares.find(
    square => square.motionRole === "traveling",
  ).sourceTick, 100000);
  generator.dispose();
});

test("clock squares keep seeded positions and render beneath the timer text", () => {
  const generator = createGenerator({
    options: singleTrackOptions("clock", SETTINGS.countdownFramed.countFromSeconds),
  });
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
  assert.equal(arcs.length, expectedDots.length);
  assert.equal(events.indexOf("text"), expectedDots.length);
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
  const expandingPlans = plans.slice(0, -1);
  const anchoredIndex = expandingPlans[0].squares.findIndex(
    square => square.motionRole === "anchored",
  );
  const travelingIndex = expandingPlans[0].squares.findIndex(
    square => square.motionRole === "traveling",
  );
  assert.notEqual(anchoredIndex, -1);
  assert.notEqual(travelingIndex, -1);
  for (const plan of expandingPlans) {
    const anchored = plan.squares.find(square => square.motionRole === "anchored");
    const traveling = plan.squares.find(square => square.motionRole === "traveling");
    assert.equal(anchored.rotationDirection, "clockwise");
    assert.equal(traveling.rotationDirection, "counter-clockwise");
    assert.deepEqual(anchored.dots.slice(0, 2).map(dot => [
      dot.column - anchored.topLeftColumn,
      dot.row - anchored.topLeftRow,
    ]), [[0, 0], [1, 0]]);
    assert.deepEqual(traveling.dots.slice(0, 2).map(dot => [
      dot.column - traveling.topLeftColumn,
      dot.row - traveling.topLeftRow,
    ]), [[0, 0], [0, 1]]);
    assert.equal(anchored.reservation.right - anchored.reservation.left, plan.squareSize);
    assert.equal(traveling.reservation.right - traveling.reservation.left, plan.squareSize);
    assert.deepEqual(anchored.reservation, anchored.originReservation);
    if (plan.evolutionProgress > 0) {
      assert.ok(
        clockDistanceFromText(plan, traveling.reservation)
          > clockDistanceFromText(plan, traveling.originReservation),
      );
    }
  }
  assert.ok(plans.at(-1).squares.every(
    square => square.rotationDirection === undefined,
  ));
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

test("clock-to-snake waterfall advances through larger dot sizes", () => {
  const generator = createGenerator({ options: clockSnakeRippleOptions() });
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  generator.enter({ time: 0.25 });
  const observedSizes = new Set();
  const sampleTimes = [
    ...Array.from(
      { length: Math.ceil(stageSeconds * 4) - 1 },
      (_, index) => (index + 1) / 4,
    ),
    ...Array.from(
      { length: Math.ceil(stageSeconds) },
      (_, index) => index + 0.99,
    ).filter(time => time < stageSeconds),
  ].filter(time => time < stageSeconds - 1)
    .sort((first, second) => first - second);
  for (const time of sampleTimes) {
    generator.update({ time });
    const dots = generator.inspect().appearance.clock.frame.dots;
    for (const dot of dots) {
      const size = dot.sizeInSubdivisions;
      observedSizes.add(size);
      if (size === 1) continue;
      const left = dot.column - (size - 1) / 2;
      const top = dot.row - (size - 1) / 2;
      assert.ok(Math.abs(left % size) < 1e-9);
      assert.ok(Math.abs(top % size) < 1e-9);
    }
  }
  assert.deepEqual([...observedSizes].sort((a, b) => a - b), [1, 2, 4, 8]);
  generator.dispose();
});

test("birth ripple starts one beat before handoff and trails the snake for four beats", () => {
  const generator = createGenerator({ options: clockSnakeRippleOptions() });
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  const rippleStartSeconds = stageSeconds - 1;
  const rippleEndSeconds = rippleStartSeconds + 4;
  generator.enter({ time: rippleStartSeconds - 0.001 });
  const before = generator.inspect();
  assert.equal(before.appearance.clock.frame.birthRipple, null);
  assert.equal(before.appearance.clock.birthRipple.startBeforeHandoffBeats, 1);
  assert.equal(before.appearance.clock.birthRipple.durationBeats, 4);
  assert.equal(before.appearance.clock.birthRipple.wakeDepthInCells, 1.35);
  assert.deepEqual(before.appearance.clock.birthRipple.window, {
    startSeconds: rippleStartSeconds,
    endSeconds: rippleEndSeconds,
    durationSeconds: 4,
    handoffSeconds: stageSeconds,
    startBeforeHandoffSeconds: 1,
  });

  const sampleTimes = [
    rippleStartSeconds,
    rippleStartSeconds + 0.5,
    stageSeconds,
    stageSeconds + 1,
    rippleEndSeconds - 0.001,
  ];
  const samples = sampleTimes.map(time => {
    generator.update({ time });
    return generator.inspect();
  });
  assert.deepEqual(
    samples.map(sample => sample.label),
    sampleTimes.map(time => formatCountdown(
      SETTINGS.countdownFramed.countFromSeconds - Math.floor(time),
    )),
  );
  const ripples = samples.map(sample => sample.appearance.clock.frame.birthRipple);
  assert.ok(ripples.every(Boolean));
  assert.equal(ripples[0].linearProgress, 0);
  assert.equal(ripples[0].primary.activeCellCount, 1);
  assert.equal(ripples[0].primary.cells[0].index, ripples[0].originCellIndex);
  assert.equal(ripples[0].primary.cells[0].level, 0);
  assert.equal(ripples[0].primary.cells[0].distanceInCells, 0);
  assert.equal(ripples[0].primary.cells[0].ripple, "primary");
  assert.equal(ripples[0].primary.cells[0].held, true);
  assert.equal(ripples[0].primary.cells[0].flickerEligible, false);
  assert.equal(ripples[0].primary.cells[0].opacity, 1);
  assert.equal(ripples[0].primary.cells[0].glyphShape, "circle");
  assert.equal(ripples[0].primary.cells[0].glyphFill, 1);
  assert.ok(ripples[0].primary.radiusInCells < ripples[1].primary.radiusInCells);
  assert.ok(ripples[1].primary.radiusInCells < ripples[2].primary.radiusInCells);
  assert.ok(ripples[2].primary.radiusInCells < ripples[3].primary.radiusInCells);
  assert.ok(ripples[3].primary.radiusInCells < ripples[4].primary.radiusInCells);
  assert.ok(
    ripples[4].primary.maximumRadiusInCells
      - ripples[4].primary.radiusInCells < 0.002,
  );
  assert.equal(ripples[0].holdingOrigin, true);
  assert.equal(ripples[1].holdingOrigin, true);
  assert.equal(ripples[2].holdingOrigin, false);
  assert.equal(ripples[3].secondary.active, true);
  assert.equal(
    ripples[2].secondary.originCellIndex,
    ripples[3].secondary.originCellIndex,
  );
  assert.equal(ripples[3].secondary.sourceLevel, 0);
  assert.ok(ripples[3].secondary.cells.length > 0);
  assert.ok(ripples[4].primary.activeCellCount > 0);
  assert.ok(ripples[4].primary.cells.some(cell => (
    !cell.held && cell.level === 3
  )));
  for (const sample of samples) {
    const { frame } = sample.appearance.clock;
    const cellCount = sample.layout.columns * sample.layout.rows;
    assert.deepEqual(frame.dots, []);
    assert.ok(frame.birthRipple.cells.every(cell => (
      Number.isSafeInteger(cell.index)
      && cell.index >= 0
      && cell.index < cellCount
      && Number.isSafeInteger(cell.level)
      && cell.level >= 0
      && cell.level <= 3
    )));
  }
  const heldCellIndex = ripples[0].originCellIndex;
  assert.equal(generator.seek(stageSeconds), true);
  const handoff = generator.inspect();
  assert.equal(
    handoff.label,
    formatCountdown(SETTINGS.countdownFramed.countFromSeconds - stageSeconds),
  );
  assert.notEqual(handoff.appearance.clock.frame.birthRipple, null);
  assert.equal(handoff.appearance.clock.frame.birthRipple.holdingOrigin, false);
  assert.deepEqual(handoff.appearance.synth.activeTrackIds, ["snake-main"]);
  assert.deepEqual(
    handoff.appearance.synth.renderLayers.map(layer => layer.drawKey),
    ["birth-ripple", "snake"],
  );
  assert.equal(handoff.appearance.snake.frame.cells.at(-1).index, heldCellIndex);

  const context = createCountingContext();
  generator.draw({}, {}, context);
  assert.ok(context.counts.fill > handoff.appearance.snake.frame.cells.length);
  assert.equal(context.counts.text, 5);

  generator.update({ time: rippleEndSeconds });
  const cleared = generator.inspect();
  assert.equal(cleared.appearance.clock.frame.birthRipple, null);
  assert.deepEqual(
    cleared.appearance.synth.renderLayers.map(layer => layer.drawKey),
    ["snake"],
  );
  generator.dispose();
});

test("timer and snake cells mask the lower-priority birth ripple", () => {
  const generator = createGenerator({ seed: 0 });
  const snakeStartSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  let state = null;
  const lines = captureDebug(["transition"], () => {
    generator.enter({ time: snakeStartSeconds });
    for (let offset = 0; offset < 3; offset += 0.05) {
      generator.update({ time: snakeStartSeconds + offset });
      const candidate = generator.inspect();
      const render = candidate.appearance.clock.frame.birthRipple?.render;
      if (render?.hiddenByTimerCount > 0 && render.hiddenBySnakeCount > 0) {
        state = candidate;
        break;
      }
    }
  });
  assert.notEqual(state, null);
  const ripple = state.appearance.clock.frame.birthRipple;
  const priority = ripple.render;
  const visibleSnakeCellIndices = new Set([
    ...generator.snakeRenderFrame.cells,
    ...generator.snakeDisappearanceRenderFrame.cells,
  ].map(cell => cell.index));

  assert.equal(state.appearance.order.activeEffect, "snake");
  assert.ok(ripple.cells.some(cell => cell.index === state.cellIndex));
  assert.ok(ripple.cells.some(cell => visibleSnakeCellIndices.has(cell.index)));
  assert.equal(priority.timerCellIndex, state.cellIndex);
  assert.equal(priority.snakePriorityActive, true);
  assert.ok(priority.hiddenByTimerCount > 0);
  assert.ok(priority.hiddenBySnakeCount > 0);
  assert.equal(
    priority.visibleCellCount,
    priority.sourceCellCount
      - priority.hiddenByTimerCount
      - priority.hiddenBySnakeCount,
  );
  assert.ok(priority.cells.every(cell => cell.index !== state.cellIndex));
  assert.ok(priority.cells.every(cell => !visibleSnakeCellIndices.has(cell.index)));
  assert.ok(lines.some(line => (
    line.includes("countdown-ripple-priority state=active")
    && line.includes("snakePriority=yes")
    && line.includes("hiddenByTimer=")
    && line.includes("hiddenBySnake=")
  )));
  generator.dispose();
});

test("fixed-cell birth ripple activates radially and clears through levels 0 to 3", () => {
  const generator = createGenerator({ options: clockSnakeRippleOptions() });
  generator.enter({ time: SETTINGS.countdownFramed.countFromSeconds / 3 - 1 });
  const { clockPlan: plan, clockSettings: settings } = generator;
  const frameCount = 401;
  const frames = Array.from({ length: frameCount }, (_, index) => (
    countdownClockBirthRippleAt(plan, index / (frameCount - 1), settings)
  ));
  const radii = frames.map(frame => frame.primary.radiusInCells);
  const increments = radii.slice(1).map((radius, index) => radius - radii[index]);
  assert.ok(increments.every(increment => increment > 0));
  assert.ok(increments.slice(1).every((increment, index) => (
    increment < increments[index]
  )));
  assert.ok(increments.at(-1) > increments[0] * 0.15);
  assert.ok(frames.every(frame => frame.primary.cells.every((cell, index, cells) => (
    index === 0 || cells[index - 1].distanceInCells <= cell.distanceInCells
  ))));

  const columns = plan.gridColumns / plan.subdivisions;
  const originColumn = plan.handoffCellIndex % columns;
  const neighborIndex = originColumn + 1 < columns
    ? plan.handoffCellIndex + 1
    : plan.handoffCellIndex - 1;
  const observed = [];
  let activated = false;
  for (const frame of frames) {
    const cell = frame.primary.cells.find(candidate => candidate.index === neighborIndex);
    if (cell) activated = true;
    const state = cell?.level ?? (activated ? "absent" : "waiting");
    if (observed.at(-1) !== state) observed.push(state);
  }
  assert.deepEqual(observed.slice(observed.indexOf(0)), [0, 1, 2, 3, "absent"]);
  const levelThreeCells = frames.map(frame => (
    frame.primary.cells.find(cell => (
      cell.index === neighborIndex && cell.level === 3
    ))
  )).filter(Boolean);
  assert.ok(levelThreeCells.length > 2);
  assert.ok(levelThreeCells.slice(1).every((cell, index) => (
    cell.glyphFill < levelThreeCells[index].glyphFill
  )));
  assert.ok(frames.every(frame => frame.cells.every(cell => (
    cell.glyphShape === "circle"
    && cell.glyphFill >= 0
    && cell.glyphFill <= 1
    && (cell.level === 3 || cell.glyphFill === 1)
  ))));

  const renderedGlyphs = cell => {
    const context = createCountingContext();
    const glyphs = [];
    context.arc = (x, y, radius) => glyphs.push({ x, y, radius });
    drawCountdownSnake(
      context,
      generator.layout,
      { cells: [cell] },
      generator.snakeSettings,
      generator.snakePalette,
    );
    return glyphs;
  };
  const earlyGlyphs = renderedGlyphs(levelThreeCells[0]);
  const lateGlyphs = renderedGlyphs(levelThreeCells.at(-1));
  const earlyPositions = new Set(earlyGlyphs.map(glyph => `${glyph.x}:${glyph.y}`));
  assert.ok(earlyGlyphs.length > 0 && earlyGlyphs.length <= 52);
  assert.ok(lateGlyphs.length < earlyGlyphs.length);
  assert.ok(lateGlyphs.every(glyph => (
    earlyPositions.has(`${glyph.x}:${glyph.y}`)
  )));
  assert.ok(earlyGlyphs.every(glyph => Math.abs(
    glyph.radius
      - generator.layout.cellSize / 16 * (1 - generator.snakeSettings.dotMargin)
  ) < 1e-12));
  const handoffLinearProgress = settings.birthRipple.startBeforeHandoffBeats
    / settings.birthRipple.durationBeats;
  assert.ok(frames.filter(
    frame => frame.linearProgress < handoffLinearProgress,
  ).every(
    frame => frame.primary.cells.some(cell => (
      cell.index === plan.handoffCellIndex && cell.level === 0 && cell.held
    )),
  ));
  assert.ok(frames.filter(
    frame => frame.linearProgress >= handoffLinearProgress,
  ).every(
    frame => frame.primary.cells.every(cell => !cell.held),
  ));
  assert.deepEqual(frames.at(-1).primary.cells, []);
  assert.equal(frames.at(-1).secondary.activeCellCount, 0);
  assert.deepEqual(frames.at(-1).cells, []);
  generator.dispose();
});

test("birth ripple flickers subdivided primary cells with distance decay", () => {
  const generator = createGenerator({ options: clockSnakeRippleOptions() });
  const rippleStartSeconds = SETTINGS.countdownFramed.countFromSeconds / 3 - 1;
  generator.enter({ time: rippleStartSeconds + 1 });
  const inspection = generator.inspect();
  const { clockPlan: plan, clockSettings: settings } = generator;
  const ripple = countdownClockBirthRippleAt(plan, 0.25, settings);
  const eligible = ripple.primary.cells.filter(cell => cell.flickerEligible);
  const triggered = eligible.filter(cell => cell.flickerTriggered);
  assert.ok(eligible.length > 0);
  assert.ok(triggered.length > 0);
  assert.ok(eligible.every(cell => cell.level >= 1 && cell.level <= 3));
  assert.ok(ripple.primary.cells.every(cell => (
    cell.level !== 0 || !cell.flickerEligible
  )));
  assert.ok(ripple.secondary.cells.every(cell => (
    cell.flickerEligible === undefined
  )));
  const byDistance = [...eligible].sort((first, second) => (
    first.distanceInCells - second.distanceInCells
  ));
  assert.ok(byDistance.slice(1).every((cell, index) => (
    cell.flickerProbability <= byDistance[index].flickerProbability
  )));
  for (const cell of eligible) {
    const expectedProbability = settings.birthRipple.wakeFlicker.probability
      * Math.exp(
        -cell.distanceInCells
          / settings.birthRipple.wakeFlicker.distanceDecayInCells,
      );
    assert.ok(Math.abs(cell.flickerProbability - expectedProbability) < 1e-12);
    assert.equal(cell.opacity < 1, cell.flickerTriggered);
  }
  assert.deepEqual(
    ripple,
    countdownClockBirthRippleAt(plan, 0.25, settings),
  );

  const context = createCountingContext();
  const renderedAlphas = [];
  const countFill = context.fill.bind(context);
  context.fill = () => {
    renderedAlphas.push(context.globalAlpha);
    countFill();
  };
  generator.draw({}, {}, context);
  assert.ok(renderedAlphas.some(alpha => alpha < 1));
  assert.equal(context.globalAlpha, 1);
  assert.deepEqual(
    inspection.appearance.clock.frame.birthRipple.primary.flicker
      .triggeredCellIndices,
    triggered.map(cell => cell.index),
  );
  generator.dispose();
});

test("birth ripple matches direct seek after playback and resize", () => {
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  const rippleStartSeconds = stageSeconds - 1;
  const sampleTime = stageSeconds + 1.25;
  const options = clockSnakeRippleOptions();
  const sequential = createGenerator({ options });
  sequential.enter({ time: rippleStartSeconds });
  for (let time = rippleStartSeconds + 0.25; time <= sampleTime; time += 0.25) {
    sequential.update({ time });
  }
  const direct = createGenerator({ options });
  direct.enter({ time: sampleTime });
  assert.deepEqual(
    sequential.inspect().appearance.clock.frame.birthRipple,
    direct.inspect().appearance.clock.frame.birthRipple,
  );

  const resizedViewport = { width: 1200, height: 600 };
  direct.resize(resizedViewport);
  assert.equal(direct.seek(sampleTime), true);
  const resized = direct.inspect().appearance.clock.frame.birthRipple;
  const fresh = createGenerator({ viewport: resizedViewport, options });
  fresh.enter({ time: sampleTime });
  assert.deepEqual(
    resized,
    fresh.inspect().appearance.clock.frame.birthRipple,
  );
  sequential.dispose();
  direct.dispose();
  fresh.dispose();
});

test("clock safe zones hold for every clock tick and fail on impossible boards", () => {
  const generator = createGenerator({ seed: 77, options: clockSnakeRippleOptions() });
  generator.enter({ time: 0 });
  const clockStageTicks = SETTINGS.countdownFramed.countFromSeconds / 3;
  for (let tick = 0; tick < clockStageTicks; tick += 1) {
    generator.update({ time: tick + 0.001 });
    const plan = generator.inspect().appearance.clock.plan;
    assertClockSafeZones(plan);
    if (plan.evolutionMode !== "expanding") continue;
    const anchored = plan.squares.find(square => square.motionRole === "anchored");
    const traveling = plan.squares.find(square => square.motionRole === "traveling");
    assert.deepEqual(anchored.reservation, anchored.originReservation);
    if (plan.evolutionProgress > 0 && !plan.farSeparated) {
      assert.ok(
        clockDistanceFromText(plan, traveling.reservation)
          > clockDistanceFromText(plan, traveling.originReservation),
        `expected traveling clock square to move outward at tick ${tick}`,
      );
    }
    assert.ok(
      clockGapFromText(plan, anchored.reservation) <= 1,
      `expected anchored clock square to stay beside the countdown at tick ${tick}`,
    );
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

test("clock rejects invalid ripple and impossible safe-zone settings at setup", () => {
  const optionsWithClock = clock => withTrackSettings("clock", {
    ...SETTINGS.countdownFramed.appearance.effects.clock,
    ...clock,
  }, clockSnakeRippleOptions());
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
        farSeparation: {
          ...SETTINGS.countdownFramed.appearance.effects.clock.farSeparation,
          minimumRadiusInCells: 0,
        },
      }),
    }),
    /farSeparation.minimumRadiusInCells must be a finite positive number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({
        birthRipple: {
          ...SETTINGS.countdownFramed.appearance.effects.clock.birthRipple,
          wakeDepthInCells: 0,
        },
      }),
    }),
    /birthRipple.wakeDepthInCells must be a finite positive number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({
        birthRipple: {
          ...SETTINGS.countdownFramed.appearance.effects.clock.birthRipple,
          durationBeats: 0.5,
        },
      }),
    }),
    /durationBeats must be at least startBeforeHandoffBeats/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithClock({
        birthRipple: {
          ...SETTINGS.countdownFramed.appearance.effects.clock.birthRipple,
          wakeFlicker: {
            ...SETTINGS.countdownFramed.appearance.effects.clock.birthRipple
              .wakeFlicker,
            probability: 1.1,
          },
        },
      }),
    }),
    /birthRipple.wakeFlicker.probability must be from zero to one/,
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

test("snake engorges alive, reveals its meal, then commits atomically to bubbles", () => {
  const options = snakeBubblesOptions();
  const generator = createGenerator({ options });
  generator.enter({ time: 0 });
  const snakeTrack = generator.inspect().appearance.synth.tracks.find(
    track => track.use === "snake",
  );
  generator.update({ time: snakeTrack.startSeconds });
  const snakeStartState = generator.inspect();
  const snakeStart = snakeStartState.appearance.snake;
  const connection = snakeStartState.appearance.synth.connections.find(
    candidate => candidate.id === "snake-bubbles",
  );
  const connectionEndSeconds =
    connection.startSeconds + connection.durationSeconds;
  assert.equal(connection.durationSeconds, 3);
  assert.deepEqual(snakeStartState.appearance.synth.activeTrackIds, ["snake-main"]);
  assert.deepEqual(snakeStartState.appearance.synth.activeConnectionIds, []);
  assert.ok(!snakeStart.plan.textSafeCellIndices.includes(snakeStart.plan.sourceIndex));
  assert.equal(snakeStart.lengthCells, snakeStart.baseLengthCells);
  assert.equal(
    generator.inspect().label,
    formatCountdown(
      options.countFromSeconds - snakeTrack.startSeconds,
    ),
  );

  generator.update({ time: connection.startSeconds - 0.001 });
  const stable = generator.inspect();
  assert.equal(stable.appearance.frame.merge.active, false);
  assert.deepEqual(stable.appearance.synth.activeTrackIds, ["snake-main"]);
  assert.deepEqual(stable.appearance.synth.activeConnectionIds, []);
  assert.ok(stable.appearance.synth.renderLayers.some(
    layer => layer.drawKey === "snake",
  ));

  generator.update({ time: connection.startSeconds });
  const growthStart = generator.inspect();
  assert.deepEqual(growthStart.appearance.synth.activeTrackIds, []);
  assert.deepEqual(
    growthStart.appearance.synth.activeConnectionIds,
    ["snake-bubbles"],
  );
  assert.equal(
    growthStart.label,
    formatCountdown(
      options.countFromSeconds - connection.startSeconds,
    ),
  );
  assert.equal(growthStart.appearance.frame.merge.phase, "engorging");
  assert.equal(growthStart.appearance.frame.merge.progress, 0);
  assert.equal(
    growthStart.appearance.snake.engorgement.currentLength,
    growthStart.appearance.snake.engorgement.startLength,
  );
  assert.deepEqual(
    growthStart.appearance.snake.renderFrame.cells,
    growthStart.appearance.snake.handoff.cells,
  );
  assert.ok(growthStart.appearance.synth.renderLayers.some(
    layer => layer.drawKey === "snake",
  ));
  assert.ok(!growthStart.appearance.synth.renderLayers.some(
    layer => layer.drawKey.includes("bubbles"),
  ));
  assert.equal(growthStart.appearance.frame.merge.convertedTileCount, 0);

  generator.update({
    time: connection.startSeconds + connection.durationSeconds / 2,
  });
  const growthMidpoint = generator.inspect();
  assert.deepEqual(growthMidpoint.appearance.synth.activeTrackIds, []);
  assert.deepEqual(
    growthMidpoint.appearance.synth.activeConnectionIds,
    ["snake-bubbles"],
  );
  assert.equal(growthMidpoint.appearance.frame.merge.progress, 0.5);
  assert.ok(
    growthMidpoint.appearance.snake.engorgement.currentLength
      > growthStart.appearance.snake.engorgement.currentLength,
  );
  assert.equal(growthMidpoint.appearance.snake.engorgement.growthActive, true);
  assert.equal(growthMidpoint.appearance.frame.merge.convertedTileCount, 0);
  assert.equal(
    growthMidpoint.appearance.snake.textSafeCellIndex,
    growthMidpoint.cellIndex,
  );
  assert.ok(growthMidpoint.appearance.snake.renderFrame.cells.every(
    cell => cell.index !== growthMidpoint.cellIndex,
  ));

  generator.update({ time: connectionEndSeconds - 0.75 });
  const growthBurst = generator.inspect();
  assert.ok(
    growthBurst.appearance.snake.engorgement.currentLength
      > growthStart.appearance.snake.engorgement.currentLength,
  );
  assert.equal(growthBurst.appearance.snake.engorgement.growthActive, true);
  assert.ok(growthBurst.appearance.snake.renderFrame.cells.every(
    cell => cell.index !== growthBurst.cellIndex,
  ));

  generator.update({ time: connectionEndSeconds - 0.39 });
  const meal = generator.inspect();
  assert.equal(meal.appearance.snake.engorgement.foodVisible, true);
  assert.equal(meal.appearance.snake.engorgement.coverage, 1);
  assert.equal(meal.appearance.snake.engorgement.coverageComplete, true);
  assert.equal(meal.appearance.snake.engorgement.movementComplete, true);
  assert.equal(
    meal.appearance.snake.engorgement.uniqueCellCount,
    meal.layout.columns * meal.layout.rows,
  );
  assert.equal(meal.appearance.snake.textSafeHiddenCellCount, 1);
  assert.ok(meal.appearance.snake.renderFrame.cells.every(
    cell => cell.index !== meal.cellIndex,
  ));
  const snakeDrawContext = createCountingContext();
  const snakeDotCenters = [];
  snakeDrawContext.arc = (x, y) => snakeDotCenters.push({ x, y });
  generator.draw({}, {}, snakeDrawContext);
  const snakeTimerColumn = meal.cellIndex % meal.layout.columns;
  const snakeTimerRow = Math.floor(meal.cellIndex / meal.layout.columns);
  const timerLeft = meal.layout.offsetX + snakeTimerColumn * meal.layout.cellSize;
  const timerTop = meal.layout.offsetY + snakeTimerRow * meal.layout.cellSize;
  assert.ok(snakeDotCenters.every(({ x, y }) => (
    x < timerLeft
    || x >= timerLeft + meal.layout.cellSize
    || y < timerTop
    || y >= timerTop + meal.layout.cellSize
  )));
  assert.equal(
    meal.appearance.snake.renderFrame.cells.filter(cell => cell.pulse).length,
    2,
  );
  assert.equal(meal.appearance.snake.engorgement.deathFlicker.active, true);
  assert.equal(
    meal.appearance.snake.engorgement.deathFlicker.mode,
    "strobe-stack",
  );
  const flickerColors = generator.snakeRenderFrame.bodyCells.flatMap(cell => (
    countdownSnakeGlyphColors(
      cell,
      generator.snakeRenderFrame,
      meal.layout,
      generator.snakePalette,
      generator.snakeFlicker,
      connectionEndSeconds - 0.39,
      generator.snakeSettings.maximumSubdivisionLevel,
    )
  ));
  assert.ok(flickerColors.every(color => color.startsWith("rgb(")));
  const nextFlickerColors = generator.snakeRenderFrame.bodyCells.flatMap(cell => (
    countdownSnakeGlyphColors(
      cell,
      generator.snakeRenderFrame,
      meal.layout,
      generator.snakePalette,
      generator.snakeFlicker,
      connectionEndSeconds - 0.44,
      generator.snakeSettings.maximumSubdivisionLevel,
    )
  ));
  assert.notDeepEqual(nextFlickerColors, flickerColors);
  assert.deepEqual(
    countdownSnakeGlyphColors(
      generator.snakeRenderFrame.cells.at(-1),
      generator.snakeRenderFrame,
      meal.layout,
      generator.snakePalette,
      generator.snakeFlicker,
      connectionEndSeconds - 0.39,
      generator.snakeSettings.maximumSubdivisionLevel,
    ),
    [generator.snakePalette[0]],
  );
  assert.ok(meal.appearance.synth.renderLayers.some(
    layer => layer.drawKey === "snake",
  ));
  assert.equal(meal.appearance.frame.merge.convertedTileCount, 0);

  generator.update({ time: connectionEndSeconds });
  const merged = generator.inspect();
  assert.deepEqual(merged.appearance.synth.activeTrackIds, ["bubbles-main"]);
  assert.deepEqual(merged.appearance.synth.activeConnectionIds, []);
  assert.equal(
    merged.label,
    formatCountdown(
      options.countFromSeconds - connectionEndSeconds,
    ),
  );
  assert.equal(merged.appearance.frame.merge.phase, "dead");
  assert.equal(merged.appearance.frame.merge.progress, 1);
  assert.deepEqual(merged.appearance.snake.renderFrame.cells, []);
  assert.ok(!merged.appearance.synth.renderLayers.some(
    layer => layer.drawKey === "snake",
  ));
  assert.equal(merged.appearance.frame.merge.fieldCommitState, "committed");
  assert.equal(
    merged.appearance.frame.merge.consumedMealIndex,
    merged.appearance.snake.engorgement.mealIndex,
  );
  assert.equal(
    merged.appearance.frame.merge.sourceBodyCells.length,
    merged.appearance.snake.engorgement.plannedLength,
  );
  assert.ok(merged.appearance.frame.merge.convertedTileCount > 0);
  assert.equal(merged.appearance.frame.merge.waterfallStep, 0);
  assert.equal(
    merged.appearance.frame.merge.inheritedCellCount,
    merged.appearance.frame.merge.sourceBodyCells.length,
  );
  assert.equal(merged.appearance.frame.merge.releasedCellCount, 0);
  assert.ok(merged.appearance.frame.merge.trailSquares.every(
    square => square.currentLevel === square.sourceLevel,
  ));
  assert.equal(merged.appearance.frame.merge.textSafeCellCount, 1);
  assert.equal(
    merged.appearance.frame.merge.textSafeCellIndex,
    merged.cellIndex,
  );
  assert.ok(
    merged.appearance.frame.frame.textSafeHiddenInheritedSquareCount > 0,
  );
  assert.equal(
    merged.appearance.frame.frame.textSafeHiddenGeneratedSquareCount,
    0,
  );
  assert.ok(
    merged.appearance.frame.frame.dots.every(dot => !frameDotOverlapsRectangle(
      dot,
      merged.appearance.frame.frame.textSafeRectangle,
    )),
  );

  generator.update({ time: connectionEndSeconds + 0.999 });
  assert.equal(generator.inspect().appearance.frame.merge.waterfallStep, 0);

  generator.update({ time: connectionEndSeconds + 1 });
  const firstWaterfallBeat = generator.inspect().appearance.frame.merge;
  assert.equal(firstWaterfallBeat.waterfallStep, 1);
  assert.equal(
    firstWaterfallBeat.releasedCellCount,
    firstWaterfallBeat.sourceBodyCells.filter(cell => cell.level === 3).length,
  );
  assert.ok(firstWaterfallBeat.trailSquares.every(
    square => square.currentLevel === square.sourceLevel + 1,
  ));

  generator.update({ time: connectionEndSeconds + 2 });
  const secondWaterfallState = generator.inspect();
  const secondWaterfallFrame = secondWaterfallState.appearance.frame.frame;
  const timerCellIndex = secondWaterfallFrame.textSafeCellIndex;
  const timerColumn = timerCellIndex % secondWaterfallState.layout.columns;
  const sameRowNeighbors = [timerColumn - 1, timerColumn + 1]
    .filter(column => column >= 0 && column < secondWaterfallState.layout.columns)
    .map(column => (
      Math.floor(timerCellIndex / secondWaterfallState.layout.columns)
        * secondWaterfallState.layout.columns + column
    ));
  const visibleParentCells = new Set(secondWaterfallFrame.dots.map(dot => {
    const x = dot.xInSubdivisions ?? dot.column + 0.5;
    const y = dot.yInSubdivisions ?? dot.row + 0.5;
    return Math.floor(y / secondWaterfallState.appearance.frame.subdivisions)
      * secondWaterfallState.layout.columns
      + Math.floor(x / secondWaterfallState.appearance.frame.subdivisions);
  }));
  assert.ok(sameRowNeighbors.every(index => visibleParentCells.has(index)));

  generator.update({ time: connectionEndSeconds + 4 });
  const generatedOnlyState = generator.inspect();
  const generatedOnly = generatedOnlyState.appearance.frame.merge;
  assert.equal(generatedOnly.waterfallStep, 4);
  assert.equal(generatedOnly.inheritedCellCount, 0);
  assert.equal(
    generatedOnly.releasedCellCount,
    generatedOnly.sourceBodyCells.length,
  );
  assert.deepEqual(generatedOnly.trailSquares, []);
  assert.equal(
    generatedOnlyState.appearance.frame.frame
      .textSafeHiddenInheritedSquareCount,
    0,
  );
  assert.ok(
    generatedOnlyState.appearance.frame.frame
      .textSafeHiddenGeneratedSquareCount > 0,
  );
  assert.ok(generatedOnlyState.appearance.frame.plan.dots.some(
    dot => frameDotOverlapsRectangle(
      dot,
      generatedOnlyState.appearance.frame.frame.textSafeRectangle,
    ),
  ));
  assert.ok(generatedOnlyState.appearance.frame.frame.dots.every(
    dot => !frameDotOverlapsRectangle(
      dot,
      generatedOnlyState.appearance.frame.frame.textSafeRectangle,
    ),
  ));

  generator.resize({ width: 600, height: 900 });
  const resizedMerge = generator.inspect();
  assert.equal(resizedMerge.appearance.frame.merge.progress, 1);
  assert.deepEqual(resizedMerge.appearance.snake.renderFrame.cells, []);
  assert.equal(resizedMerge.appearance.frame.merge.fieldCommitState, "committed");
  assert.equal(resizedMerge.appearance.frame.frame.textSafeCellCount, 1);
  assert.ok(resizedMerge.appearance.frame.frame.dots.every(dot => (
    !frameDotOverlapsRectangle(
      dot,
      resizedMerge.appearance.frame.frame.textSafeRectangle,
    )
  )));

  const direct = createGenerator({ options });
  direct.enter({
    time: connection.startSeconds + connection.durationSeconds / 2,
  });
  assert.deepEqual(
    direct.inspect().appearance.snake.renderFrame,
    growthMidpoint.appearance.snake.renderFrame,
  );
  const soughtWaterfall = createGenerator({ options });
  soughtWaterfall.enter({ time: connectionEndSeconds + 1 });
  assert.deepEqual(
    soughtWaterfall.inspect().appearance.frame.merge.trailSquares,
    firstWaterfallBeat.trailSquares,
  );
  soughtWaterfall.dispose();
  direct.dispose();
  generator.dispose();
});

test("handoff keeps one timer cell clear while internal engorgement crosses it", () => {
  const generator = createGenerator({ options: clockSnakeRippleOptions() });
  const stageSeconds = SETTINGS.countdownFramed.countFromSeconds / 3;
  generator.enter({ time: stageSeconds - 0.001 });
  const clockOrigin = generator.inspect().appearance.clock.plan.handoffCellIndex;
  let internalSnakeCrossedTimerCell = false;

  for (
    let tick = stageSeconds;
    tick < SETTINGS.countdownFramed.countFromSeconds;
    tick += 1
  ) {
    for (const offset of [0, 0.999]) {
      generator.update({ time: tick + offset });
      const state = generator.inspect();
      const { renderFrame } = state.appearance.snake;
      const timerCellIndex = state.textCentered
        ? Math.floor(state.layout.rows / 2) * state.layout.columns
          + Math.floor(state.layout.columns / 2)
        : state.cellIndex;
      const safeCells = countdownSnakeTextSafeCells(
        state.layout,
        timerCellIndex,
      );
      assert.deepEqual(safeCells, [timerCellIndex]);
      assert.equal(state.appearance.snake.textSafeCellIndex, timerCellIndex);
      assert.ok(renderFrame.cells.every(cell => cell.index !== timerCellIndex));
      const connectorActive = state.appearance.synth.activeConnectionIds
        .includes("snake-bubbles");
      if (connectorActive) {
        internalSnakeCrossedTimerCell ||= generator.snakeEngorgementFrame.cells.some(
          cell => (
            safeCells.includes(cell.index)
          ),
        );
      } else if (state.appearance.synth.activeTrackIds.includes("snake-main")) {
        assert.ok(renderFrame.cells.every(cell => (
          !safeCells.includes(cell.index)
        )));
      }
    }
  }
  assert.equal(internalSnakeCrossedTimerCell, true);

  generator.update({ time: stageSeconds * 2 });
  const enteringEngorgement = generator.inspect().appearance.frame.merge;
  assert.equal(enteringEngorgement.phase, "engorging");
  assert.equal(enteringEngorgement.convertedTileCount, 0);

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
  const avoidance = SETTINGS.countdownFramed.appearance.effects.frame.avoidance;

  assert.deepEqual(avoidance.timingCurve, [0.895, 0.03, 0.685, 0.22]);
  assert.deepEqual(avoidance.refill.timingCurve, [0.25, 0.46, 0.45, 0.94]);

  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(0, avoidance), {
    phase: "emptying",
    emptyEnvelope: 0,
    refillEnvelope: 0,
  });
  const beforeRefill = countdownFrameAvoidanceEnvelopesAt(0.924, avoidance);
  assert.equal(beforeRefill.phase, "emptying");
  assert.equal(beforeRefill.refillEnvelope, 0);
  const refillStart = countdownFrameAvoidanceEnvelopesAt(0.925, avoidance);
  assert.equal(refillStart.phase, "refilling");
  assert.equal(refillStart.refillEnvelope, 0);
  assert.ok(refillStart.emptyEnvelope >= beforeRefill.emptyEnvelope);
  const growing = countdownFrameAvoidanceEnvelopesAt(1.25, avoidance);
  assert.equal(growing.phase, "refilling");
  assert.ok(growing.refillEnvelope > 0);
  assert.ok(growing.refillEnvelope < growing.emptyEnvelope);
  assert.deepEqual(countdownFrameAvoidanceEnvelopesAt(2.5, avoidance), {
    phase: "complete",
    emptyEnvelope: 1,
    refillEnvelope: 1,
  });
  for (let age = 0; age <= avoidance.durationBeats; age += 0.025) {
    const envelope = countdownFrameAvoidanceEnvelopesAt(age, avoidance);
    assert.ok(envelope.refillEnvelope >= 0);
    assert.ok(envelope.refillEnvelope <= envelope.emptyEnvelope);
    assert.ok(envelope.emptyEnvelope <= 1);
  }
  assert.throws(
    () => countdownFrameAvoidanceEnvelopesAt(
      0,
      { ...avoidance, durationBeats: 0.5 },
    ),
    /at least one beat/,
  );
});

test("frame refill begins 0.075 beats before its source tick ends", () => {
  const generator = createGenerator({ options: bubblesTrackOptions() });
  generator.enter({ time: 0.924 });
  const before = generator.inspect().appearance.frame.avoidance.bubbles.find(
    bubble => bubble.sourceTick === 0,
  );
  assert.equal(before.phase, "emptying");
  assert.equal(before.refillEnvelope, 0);

  generator.update({ time: 0.925 });
  const started = generator.inspect().appearance.frame.avoidance.bubbles.find(
    bubble => bubble.sourceTick === 0,
  );
  assert.equal(started.ageBeats, 0.925);
  assert.equal(started.phase, "refilling");
  assert.equal(started.refillEnvelope, 0);
  generator.dispose();
});

test("bubble debug overlays every live circle separately so overlap accumulates", () => {
  const settings = resolveCountdownBubblesDebugSettings({
    visualizeBubbles: true,
    opacity: 0.12,
  });
  const context = createCountingContext();
  const fillAlphas = [];
  const originalFill = context.fill.bind(context);
  context.fill = () => {
    fillAlphas.push(context.globalAlpha);
    originalFill();
  };
  const bubbles = [
    {
      circles: [
        { x: 8, y: 8, radius: 4, refillRadius: 0 },
        { x: 10, y: 8, radius: 4, refillRadius: 1 },
      ],
    },
    {
      circles: [
        { x: 9, y: 8, radius: 3, refillRadius: 0.5 },
      ],
    },
  ];
  drawCountdownBubblesDebug(
    context,
    { cellSize: 80, offsetX: 0, offsetY: 0 },
    bubbles,
    settings,
    3,
    "#ffffff",
  );

  assert.equal(context.counts.fill, 3);
  assert.deepEqual(fillAlphas, [0.12, 0.12, 0.12]);
  assert.equal(context.globalAlpha, 1);
  assert.throws(
    () => resolveCountdownBubblesDebugSettings({
      visualizeBubbles: "yes",
      opacity: 0.12,
    }),
    /visualizeBubbles must be a boolean/,
  );
  assert.throws(
    () => resolveCountdownBubblesDebugSettings({
      visualizeBubbles: true,
      opacity: 0,
    }),
    /debug.opacity must be greater than zero/,
  );
});

test("enabled bubble debug exposes every envelope and draws displaced squares", () => {
  const sampleTime = SETTINGS.countdownFramed.countFromSeconds * 2 / 3 + 2.25;
  const frame = SETTINGS.countdownFramed.appearance.effects.frame;
  const enabled = createGenerator({
    options: withTrackSettings("bubbles", {
      ...frame,
      debug: { ...frame.debug, visualizeBubbles: true },
    }, bubblesTrackOptions()),
  });
  enabled.enter({ time: sampleTime });
  const debugState = enabled.inspect().appearance.frame.debug;
  assert.deepEqual(debugState, {
    visualizeBubbles: true,
    opacity: 0.12,
    renderMode: "displaced-squares",
    active: true,
    bubbleCount: 3,
    circleCount: 12,
  });
  const enabledContext = createCountingContext();
  enabled.draw({}, {}, enabledContext);

  const disabled = createGenerator({ options: bubblesTrackOptions() });
  disabled.enter({ time: sampleTime });
  const disabledContext = createCountingContext();
  disabled.draw({}, {}, disabledContext);

  assert.ok(enabledContext.counts.fill > disabledContext.counts.fill);
  assert.equal(disabled.inspect().appearance.frame.debug.active, false);
  enabled.dispose();
  disabled.dispose();
});

test("snake taper inherits its levels, subdivides per beat, then releases to bubbles", () => {
  const options = {
    layout: { columns: 3, rows: 3 },
    cells: [
      { index: 0, level: 1 },
      { index: 1, level: 1 },
      { index: 2, level: 2 },
      { index: 3, level: 3 },
    ],
    progress: 1,
    appearanceTick: 19,
  };
  const trail = countdownSnakeBubblePlan(options);
  const generated = createFramePlan();
  const merged = countdownFramePlanWithSnakeTrail(generated, trail);

  assert.equal(trail.availableSquareCount, 40);
  assert.equal(trail.squares.length, 40);
  assert.equal(new Set(trail.squares.map(square => square.tileIndex)).size, 40);
  assert.equal(trail.dots.length, 88);
  assert.equal(trail.waterfallStep, 0);
  assert.equal(trail.inheritedCellCount, 4);
  assert.equal(trail.releasedCellCount, 0);
  assert.ok(trail.squares.every(
    square => square.currentLevel === square.sourceLevel,
  ));
  assert.deepEqual(
    [...new Set(trail.dots.map(dot => dot.sizeInSubdivisions ?? 1))].sort(),
    [1, 2, 4],
  );
  assert.equal(
    merged.squares.length,
    trail.squares.length + generated.squares.length - merged.trailOverlapCount,
  );
  assert.equal(new Set(merged.squares.map(square => square.tileIndex)).size,
    merged.squares.length);
  assert.ok(merged.squares.slice(0, trail.squares.length).every(
    square => square.mergeSource === "snake",
  ));

  const firstBeat = countdownSnakeBubblePlan({ ...options, waterfallStep: 1 });
  assert.equal(firstBeat.inheritedCellCount, 3);
  assert.equal(firstBeat.releasedCellCount, 1);
  assert.ok(firstBeat.squares.every(
    square => square.currentLevel === square.sourceLevel + 1,
  ));
  assert.deepEqual(
    [...new Set(firstBeat.dots.map(dot => dot.sizeInSubdivisions ?? 1))].sort(),
    [1, 2],
  );

  const secondBeat = countdownSnakeBubblePlan({ ...options, waterfallStep: 2 });
  assert.equal(secondBeat.inheritedCellCount, 2);
  assert.equal(secondBeat.releasedCellCount, 2);
  assert.ok(secondBeat.squares.every(square => square.currentLevel === 3));

  const complete = countdownSnakeBubblePlan({ ...options, waterfallStep: 3 });
  assert.equal(complete.inheritedCellCount, 0);
  assert.equal(complete.releasedCellCount, 4);
  assert.deepEqual(complete.squares, []);
  assert.deepEqual(complete.dots, []);
});

test("frame push radius grows while the ink field eases across 1.5 beats", () => {
  const avoidance = {
    radiusInCells: 1,
    radiusAtEndInCells: 3,
    radiusGrowthTimingCurve: [0.42, 0, 0.58, 1],
  };
  const motion = {
    beatWiggleDurationBeats: 1.5,
    beatWiggleDistance: 0.24,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const offsetAt = elapsedBeats => {
    const cycleProgress = (
      elapsedBeats % motion.beatWiggleDurationBeats
    ) / motion.beatWiggleDurationBeats;
    return countdownFrameFieldBeatOffsetAt(cycleProgress, motion);
  };

  assert.equal(countdownFrameAvoidanceRadiusAt(0, avoidance), 1);
  assert.equal(countdownFrameAvoidanceRadiusAt(1, avoidance), 3);
  assert.ok(countdownFrameAvoidanceRadiusAt(0.5, avoidance) > 1);
  assert.equal(offsetAt(0), 0);
  assert.equal(offsetAt(0.75), 0.24);
  assert.equal(offsetAt(1.5), 0);
  assert.ok(Math.abs(offsetAt(1.49) - offsetAt(1.51)) < 1e-12);
});

test("final ink wipe expands once and reaches full coverage at its boundary", () => {
  const finalWipe = SETTINGS.countdownFramed.appearance.effects.frame
    .avoidance.finalWipe;
  const options = {
    layout: { columns: 12, rows: 7 },
    subdivisionLevel: 3,
    finalWipe,
    timingCurve: finalWipe.timingCurve,
    displacementMaximumInCells: 1.1,
  };
  assert.equal(countdownFrameFinalWipeAt({
    ...options,
    progress: finalWipe.startProgress - 0.001,
  }), null);
  const start = countdownFrameFinalWipeAt({
    ...options,
    progress: finalWipe.startProgress,
  });
  const middle = countdownFrameFinalWipeAt({
    ...options,
    progress: (finalWipe.startProgress + finalWipe.endProgress) / 2,
  });
  const held = countdownFrameFinalWipeAt({
    ...options,
    progress: finalWipe.endProgress,
  });

  assert.equal(start.circle.radius, 0);
  assert.ok(middle.easedProgress > 0 && middle.easedProgress < 1);
  assert.equal(held.progress, 1);
  assert.equal(held.phase, "holding");
  assert.ok(held.circle.radius > Math.hypot(12 * 4, 7 * 4));
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

  const inheritedSquareIndex = excludedSquareIndices[0];
  const mixedSquares = plan.squares.map(square => (
    square.squareIndex === inheritedSquareIndex
      ? {
        ...square,
        mergeSource: "snake",
        dots: square.dots.map(dot => ({ ...dot, mergeSource: "snake" })),
      }
      : square
  ));
  const mixedPlan = {
    ...plan,
    squares: mixedSquares,
    dots: mixedSquares.flatMap(square => square.dots),
  };

  const frame = countdownFrameAt(
    mixedPlan,
    1,
    settings,
    [],
    null,
    [],
    [rectangle],
  );
  assert.equal(frame.rectangleAvoidedSquareCount, excludedSquareIndices.length);
  assert.equal(frame.rectangleAvoidedSnakeSquareCount, 1);
  assert.equal(
    frame.rectangleAvoidedGeneratedSquareCount,
    excludedSquareIndices.length - 1,
  );
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

test("frame ink field gates the background and survives a completed refill", () => {
  const settings = {
    squareCount: 2,
    dotsPerSquare: 4,
    timingCurve: [0.42, 0, 0.58, 1],
  };
  const visibility = (plan, value) => ({
    enabled: true,
    data: new Uint8Array(plan.gridColumns * plan.gridRows).fill(value),
    width: plan.gridColumns,
    height: plan.gridRows,
    layer: { threshold: 0.5, softness: 0 },
    subdivisions: 8,
    displacement: {
      minimumInCells: 0,
      radiusRatio: 0,
      maximumInCells: 0,
      refillOffset: { columns: 0, rows: 0 },
    },
  });
  const boundaryPlan = createFramePlan();
  const textured = countdownFrameAt(
    boundaryPlan,
    1,
    settings,
    [],
    visibility(boundaryPlan, 0),
  );
  assert.ok(boundaryPlan.squares.every(square => square.edgeDistance === 0));
  assert.equal(textured.eligibleVisibleCount, 8);
  assert.equal(textured.fieldHiddenCount, 8);
  assert.equal(textured.visibleCount, 0);

  const refilled = countdownFrameAt(
    boundaryPlan,
    1,
    settings,
    [{ x: 12, y: 12, radius: 40, refillRadius: 40 }],
    visibility(boundaryPlan, 0),
  );
  assert.equal(refilled.avoidedSquareCount, 0);
  assert.equal(refilled.fieldHiddenCount, 8);
  assert.equal(refilled.visibleCount, 0);

  const visible = countdownFrameAt(
    boundaryPlan,
    1,
    settings,
    [],
    visibility(boundaryPlan, 255),
  );
  assert.equal(visible.fieldHiddenCount, 0);
  assert.equal(visible.visibleCount, boundaryPlan.dots.length);
});

test("frame ink field displaces both spot contours without bypassing refill", () => {
  const plan = createFramePlan();
  const firstDot = plan.dots[0];
  const visibility = maximumInCells => ({
    enabled: true,
    data: new Uint8Array(plan.gridColumns * plan.gridRows).fill(255),
    width: plan.gridColumns,
    height: plan.gridRows,
    layer: { threshold: 0, softness: 0 },
    subdivisions: 8,
    displacement: {
      minimumInCells: maximumInCells,
      radiusRatio: 0,
      maximumInCells,
      refillOffset: { columns: 0, rows: 0 },
    },
  });
  const circle = {
    x: firstDot.column - 0.5,
    y: firstDot.row + 0.5,
    radius: 0.1,
    refillRadius: 0,
  };
  const plain = countdownFrameAt(plan, 1, { dotsPerSquare: 4 }, [circle], visibility(0));
  const displaced = countdownFrameAt(
    plan,
    1,
    { dotsPerSquare: 4 },
    [circle],
    visibility(0.2),
  );
  const refilled = countdownFrameAt(
    plan,
    1,
    { dotsPerSquare: 4 },
    [{ ...circle, refillRadius: circle.radius }],
    visibility(0.2),
  );

  assert.equal(plain.avoidedSquareCount, 0);
  assert.equal(displaced.avoidedSquareCount, 1);
  assert.equal(refilled.avoidedSquareCount, 0);
});

test("frame avoidance keeps earlier type bubbles alive for multi-beat lifetimes", () => {
  const frame = SETTINGS.countdownFramed.appearance.effects.frame;
  const generator = createGenerator({
    options: withTrackSettings(
      "bubbles",
      {
        ...frame,
        avoidance: { ...frame.avoidance, durationBeats: 2 },
      },
      singleTrackOptions("bubbles", SETTINGS.countdownFramed.countFromSeconds),
    ),
  });
  generator.enter({ time: 1 });
  const bubbles = generator.inspect().appearance.frame.avoidance.bubbles;

  assert.deepEqual(
    bubbles.map(bubble => bubble.sourceTick),
    [1, 0],
  );
  assert.deepEqual(bubbles.map(bubble => bubble.ageBeats), [0, 1]);
  assert.deepEqual(bubbles.map(bubble => bubble.phase), ["emptying", "refilling"]);
  assert.deepEqual(bubbles.map(bubble => bubble.emptyEnvelope), [0, 1]);
  assert.equal(bubbles[0].refillEnvelope, 0);
  assert.ok(bubbles[1].refillEnvelope > 0);
  assert.ok(bubbles[1].refillEnvelope < bubbles[1].emptyEnvelope);
  generator.dispose();
});

test("frame ink field follows a seamless 1.5-beat gesture", () => {
  const options = bubblesTrackOptions();
  const first = createGenerator({ seed: 91, options });
  const second = createGenerator({ seed: 91, options });
  first.enter({ time: 0 });
  second.enter({ time: 0 });
  const start = first.countdownFieldPreviewSnapshot().fields[1].data;

  assert.deepEqual(
    start,
    second.countdownFieldPreviewSnapshot().fields[1].data,
  );
  first.update({ time: 0.75 });
  assert.notDeepEqual(
    first.countdownFieldPreviewSnapshot().fields[1].data,
    start,
  );
  first.update({ time: 1.5 });
  assert.deepEqual(
    first.countdownFieldPreviewSnapshot().fields[1].data,
    start,
  );
  first.update({ time: 1.49 });
  const beforeBoundary = first.countdownFieldPreviewSnapshot().fields[1].data;
  first.update({ time: 1.51 });
  assert.deepEqual(
    first.countdownFieldPreviewSnapshot().fields[1].data,
    beforeBoundary,
  );
  first.update({ time: SETTINGS.countdownFramed.countFromSeconds });
  assert.deepEqual(
    first.countdownFieldPreviewSnapshot().fields[1].data,
    start,
  );
  first.dispose();
  second.dispose();
});

test("ink spots and field reconstruct through seek and portrait resize", () => {
  const options = bubblesTrackOptions();
  const sequential = createGenerator({ seed: 91, options });
  const bubblesTrack = sequential.inspect().appearance.synth.tracks.find(
    track => track.use === "bubbles",
  );
  const sampleTime = bubblesTrack.startSeconds + 4.4;
  const sought = createGenerator({ seed: 91, options });
  sequential.enter({ time: bubblesTrack.startSeconds });
  for (let time = bubblesTrack.startSeconds + 1; time < sampleTime; time += 1) {
    sequential.update({ time });
  }
  sequential.update({ time: sampleTime });
  sought.enter({ time: sampleTime });

  assert.deepEqual(
    sequential.countdownFieldPreviewSnapshot().fields[1].data,
    sought.countdownFieldPreviewSnapshot().fields[1].data,
  );
  assert.deepEqual(
    sequential.inspect().appearance.frame.avoidance.bubbles,
    sought.inspect().appearance.frame.avoidance.bubbles,
  );

  const portrait = { width: 600, height: 900 };
  sequential.resize(portrait);
  const portraitFresh = createGenerator({ seed: 91, viewport: portrait, options });
  portraitFresh.enter({ time: sampleTime });
  assert.deepEqual(
    sequential.countdownFieldPreviewSnapshot().fields[1].data,
    portraitFresh.countdownFieldPreviewSnapshot().fields[1].data,
  );
  assert.deepEqual(
    sequential.inspect().appearance.frame.avoidance.bubbles,
    portraitFresh.inspect().appearance.frame.avoidance.bubbles,
  );
  sequential.dispose();
  sought.dispose();
  portraitFresh.dispose();
});

test("final ink wipe remains live through the last bubbles frame", () => {
  const { finalWipe } = SETTINGS.countdownFramed.appearance.effects.frame.avoidance;
  const generator = createGenerator({ options: bubblesTrackOptions() });
  const bubblesTrack = generator.inspect().appearance.synth.tracks.find(
    track => track.use === "bubbles",
  );
  const at = progress => bubblesTrack.startSeconds
    + bubblesTrack.durationSeconds * progress;

  generator.enter({ time: at(finalWipe.startProgress - 0.001) });
  assert.equal(
    generator.inspect().appearance.frame.avoidance.finalWipe.phase,
    "inactive",
  );
  generator.update({ time: at(finalWipe.startProgress) });
  assert.equal(
    generator.inspect().appearance.frame.avoidance.finalWipe.phase,
    "emptying",
  );
  generator.update({
    time: bubblesTrack.endSeconds - 1 / 60,
  });
  const finalSample = generator.inspect().appearance.frame;
  assert.equal(finalSample.avoidance.finalWipe.phase, "emptying");
  assert.ok(finalSample.frame.visibleCount > 0);
  assert.ok(
    finalSample.frame.avoidedSquareCount < finalSample.renderedSquareCount,
  );
  generator.update({ time: SETTINGS.countdownFramed.countFromSeconds });
  const boundary = generator.inspect();
  assert.equal(
    boundary.appearance.order.activeEffect,
    boundary.appearance.synth.tracks[0].use,
  );
  assert.equal(boundary.appearance.frame.avoidance.finalWipe.phase, "inactive");
  generator.dispose();
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
    options: withTrackSettings(
      "bubbles",
      {
        ...SETTINGS.countdownFramed.appearance.effects.frame,
        enabled: true,
      },
      singleTrackOptions("bubbles", SETTINGS.countdownFramed.countFromSeconds),
    ),
  });
  const bubblesStart = 0;
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
  assert.deepEqual(initial.appearance.frame.avoidance.refill, {
    startBeforeTickEndBeats:
      authoredFrame.avoidance.refill.startBeforeTickEndBeats,
    startAgeBeats: 0.925,
    timingCurve: [...authoredFrame.avoidance.refill.timingCurve],
  });
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
  assert.equal(initial.appearance.frame.visibilityMap.enabled, true);
  assert.equal(
    initial.appearance.frame.visibilityMap.mode,
    authoredFrame.visibilityMap.field.mode,
  );
  assert.equal(
    initial.appearance.frame.visibilityMap.beatWiggleDurationBeats,
    authoredFrame.visibilityMap.beatWiggle.durationBeats,
  );
  assert.equal(
    initial.appearance.frame.visibilityMap.beatWiggleDistance,
    authoredFrame.visibilityMap.beatWiggle.distance,
  );
  assert.equal(initial.appearance.frame.visibilityMap.beatWiggleIndex, 0);
  assert.equal(initial.appearance.frame.visibilityMap.beatWiggleProgress, 0);
  assert.equal(initial.appearance.frame.visibilityMap.temporalOffset, 0);
  assert.equal(initial.appearance.frame.plan.cellIndex, initial.cellIndex);
  assert.equal(initial.appearance.frame.merge.phase, "inactive");
  assert.equal(initial.appearance.frame.merge.progress, 0);
  assert.equal(initial.appearance.frame.merge.trailSquareCount, 0);
  assert.ok(initial.appearance.frame.plan.dots.some(dot => (
    frameDotOverlapsRectangle(
      dot,
      initial.appearance.frame.frame.textSafeRectangle,
    )
  )));
  assert.ok(initial.appearance.frame.frame.dots.every(dot => (
    !frameDotOverlapsRectangle(
      dot,
      initial.appearance.frame.frame.textSafeRectangle,
    )
  )));
  assert.ok(
    initial.appearance.frame.frame.visibleCount
      <= initial.appearance.frame.frame.eligibleVisibleCount,
  );
  assert.equal(initial.appearance.frame.frame.textSafeCellCount, 1);
  assert.ok(initial.appearance.frame.frame.textSafeHiddenSquareCount > 0);
  const preview = generator.countdownFieldPreviewSnapshot({
    previewWidth: 20,
    previewHeight: 10,
  });
  assert.deepEqual(preview.fields.map(field => field.id), [
    "ink-opacity",
    "ink-displacement",
    "flicker-color",
  ]);
  assert.ok(preview.fields.every(field => field.data.length === 200));
  assert.ok(preview.fields.every(field => new Set(field.data).size > 1));
  const displacementPreview = preview.fields[1].data.slice();
  preview.fields[1].data.fill(0);
  assert.deepEqual(
    generator.countdownFieldPreviewSnapshot({ previewWidth: 20, previewHeight: 10 })
      .fields[1].data,
    displacementPreview,
  );

  generator.update({ time: bubblesStart + 0.75 });
  const avoided = generator.inspect().appearance.frame;
  assert.deepEqual(avoided.plan.dots, initialDots);
  assert.equal(
    avoided.visibilityMap.temporalOffset,
    authoredFrame.visibilityMap.beatWiggle.distance,
  );
  assert.equal(avoided.visibilityMap.beatWigglePhase, "back");
  assert.equal(avoided.visibilityMap.beatWiggleIndex, 0);
  assert.equal(avoided.visibilityMap.beatWiggleProgress, 0.5);
  assert.equal(
    avoided.avoidance.currentRadiusInCells,
    initial.appearance.frame.avoidance.currentRadiusInCells,
  );
  generator.update({ time: bubblesStart + 0.999 });
  const revealedState = generator.inspect();
  const revealed = revealedState.appearance.frame.frame;

  const context = createCountingContext();
  generator.draw({}, {}, context);
  assert.ok(context.counts.fill >= revealed.visibleCount);

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
  assert.notDeepEqual(
    next.appearance.frame.frame.textSafeRectangle,
    initial.appearance.frame.frame.textSafeRectangle,
  );
  generator.update({ time: bubblesStart + 1.5 });
  const completedGesture = generator.inspect().appearance.frame.visibilityMap;
  assert.equal(completedGesture.beatWigglePhase, "out");
  assert.equal(completedGesture.beatWiggleIndex, 1);
  assert.equal(completedGesture.beatWiggleProgress, 0);
  assert.equal(completedGesture.temporalOffset, 0);
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
  generator.update({
    time: SETTINGS.countdownFramed.countFromSeconds - 1 / 60,
  });
  const nearZero = generator.inspect().appearance.frame;
  assert.equal(nearZero.growthProgress, 0);
  assert.equal(nearZero.radius, initial.appearance.frame.radius);
  assert.equal(
    nearZero.squareCount,
    nearZero.maximumSquareCount,
  );
  assert.equal(
    nearZero.avoidance.currentRadiusInCells,
    nearZero.avoidance.radiusAtEndInCells,
  );
  assert.equal(
    nearZero.dotCount,
    nearZero.plan.gridColumns * nearZero.plan.gridRows,
  );
  assert.equal(nearZero.avoidance.finalWipe.phase, "emptying");
  assert.ok(nearZero.frame.visibleCount > 0);
  assert.ok(nearZero.frame.avoidedSquareCount < nearZero.renderedSquareCount);
  generator.dispose();
});

test("frame accumulation is deterministic for sequential playback and seeking", () => {
  const options = bubblesTrackOptions();
  const sequential = createGenerator({ seed: 319, options });
  const sought = createGenerator({ seed: 319, options });
  const bubblesStart = 0;
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
    sequential.inspect().appearance.frame.avoidance,
    sought.inspect().appearance.frame.avoidance,
  );
  sequential.dispose();
  sought.dispose();
});

test("frame rejects unsupported square, growth, and travel settings", () => {
  const optionsWithFrame = frame => withTrackSettings("bubbles", {
    ...SETTINGS.countdownFramed.appearance.effects.frame,
    ...frame,
  }, bubblesTrackOptions());
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
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          refill: {
            ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance.refill,
            startBeforeTickEndBeats: 1.1,
          },
        },
      }),
    }),
    /refill.startBeforeTickEndBeats must be from zero to one/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          durationBeats: 1,
          refill: {
            ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance.refill,
            startBeforeTickEndBeats: 0,
          },
        },
      }),
    }),
    /refill must start before durationBeats ends/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        visibilityMap: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.visibilityMap,
          displacement: {
            ...SETTINGS.countdownFramed.appearance.effects.frame
              .visibilityMap.displacement,
            maximumInCells: 0.05,
          },
        },
      }),
    }),
    /maximumInCells cannot be smaller/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        visibilityMap: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.visibilityMap,
          beatWiggle: {
            ...SETTINGS.countdownFramed.appearance.effects.frame
              .visibilityMap.beatWiggle,
            durationBeats: 0,
          },
        },
      }),
    }),
    /beatWiggle.durationBeats must be a finite positive number/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        visibilityMap: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.visibilityMap,
          beatWiggle: {
            ...SETTINGS.countdownFramed.appearance.effects.frame
              .visibilityMap.beatWiggle,
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
        visibilityMap: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.visibilityMap,
          field: {
            ...SETTINGS.countdownFramed.appearance.effects.frame
              .visibilityMap.field,
            holdSeconds: 0.5,
          },
        },
      }),
    }),
    /visibility map requires holdSeconds to be zero/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithFrame({
        avoidance: {
          ...SETTINGS.countdownFramed.appearance.effects.frame.avoidance,
          finalWipe: {
            enabled: true,
            startProgress: 0.8,
            endProgress: 0.7,
            center: { xProgress: 0.18, yProgress: 0.55 },
          },
        },
      }),
    }),
    /endProgress must be greater than startProgress/,
  );
});

test("snake rejects seed, spacing, growth, and travel timing config errors", () => {
  const optionsWithSnake = snake => withTrackSettings(
    "snake",
    snake,
    snakeBubblesOptions(),
  );
  assert.throws(
    () => createGenerator({
      options: withSharedAppearance({ evolveSeed: "no" }),
    }),
    /evolveSeed must be a boolean/,
  );
  assert.throws(
    () => createGenerator({
      options: withSharedAppearance({ minimumCellDistance: 2 }),
    }),
    /minimumCellDistance must be at least three/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        growAfterEachTick: "yes",
      }),
    }),
    /growAfterEachTick must be a boolean/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        durationSeconds: "calc(auto * 0.5)",
      }),
    }),
    /must equal one composition beat/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        engorgement: {
          ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement,
          growthMode: "ease-in",
        },
      }),
    }),
    /engorgement.growthMode must be "linear"/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        engorgement: {
          ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement,
          growthStartProgress: 1,
        },
      }),
    }),
    /engorgement.growthStartProgress must be from zero up to one/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        engorgement: {
          ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement,
          growthStartProgress: 0.99,
        },
      }),
    }),
    /growth must start before the meal reveal window/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        engorgement: {
          ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement,
          mealPulseScale: 0.9,
        },
      }),
    }),
    /engorgement.mealPulseScale must be at least one/,
  );
  assert.throws(
    () => createGenerator({
      options: optionsWithSnake({
        ...SETTINGS.countdownFramed.appearance.effects.snake,
        engorgement: {
          ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement,
          deathFlicker: {
            ...SETTINGS.countdownFramed.appearance.effects.snake.engorgement
              .deathFlicker,
            mode: "",
          },
        },
      }),
    }),
    /deathFlicker.mode must be a non-empty string/,
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
  assert.equal(
    halfBeat.inspect().reveal.stepSeconds,
    0.5 / halfBeat.inspect().reveal.stepCount,
  );
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
  const visibleClockDots = appearance.clock.frame.visibleCount;
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
  assert.ok(run.lines.some(line => (
    line.includes("countdown-effect mode=clock tick=0")
  )));
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=snake")));
  assert.ok(!run.lines.some(line => line.includes("countdown-effect mode=bubbles")));
  assert.ok(run.drawCounts.every(frame => frame.text === 5));
  generator.dispose();
});

test("countdown timeline debug exposes one exclusive owner at every boundary", async () => {
  const fps = 1;
  const countFromSeconds = SETTINGS.countdownFramed.countFromSeconds;
  const run = await runFrames({
    composition: "countdown-framed",
    frames: Math.ceil(countFromSeconds * fps) - 1,
    fps,
    channels: ["config", "timeline", "transition", "cells"],
  });
  const timelineLines = run.lines.filter(line => (
    line.includes("composition-timeline composition=countdown-framed")
  ));
  const active = timelineLines.map(line => (
    line.match(/ active=([^ ]+)/)?.[1] ?? ""
  ));
  assert.deepEqual(active, [
    "track:clock-main",
    "connection:clock-snake",
    "track:snake-main",
    "connection:snake-bubbles",
    "track:bubbles-main",
  ]);
  assert.ok(active.every(id => !id.includes(",")));
  assert.ok(run.lines.some(line => (
    line.includes("countdown-track id=clock-main state=enter")
  )));
  assert.ok(run.lines.some(line => (
    line.includes("countdown-connector id=clock-snake")
    && line.includes("state=enter")
  )));
  assert.ok(run.lines.some(line => (
    line.includes("countdown-track id=snake-main state=enter")
  )));
  assert.ok(run.lines.some(line => (
    line.includes("countdown-connector id=snake-bubbles")
    && line.includes("state=enter")
  )));
  assert.ok(run.lines.some(line => (
    line.includes("countdown-track id=bubbles-main state=enter")
  )));
  assert.ok(run.lines.some(line => line.includes("countdown-engorgement")));
  const finalTickRun = await runFrames({
    composition: "countdown-framed",
    frames: SETTINGS.countdownFramed.countFromSeconds + 1,
    fps: 1,
    channels: ["transition"],
  });
  assert.ok(finalTickRun.lines.some(line => (
    line.includes("countdown-final-tick state=centered label=00:01")
  )));
});
