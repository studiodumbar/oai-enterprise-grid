import test from "node:test";
import assert from "node:assert/strict";

import { createCatalog } from "../src/catalog.js";
import { routeCanvasPointerInput } from "../src/core/canvas-pointer-input.js";
import {
  EMPTY_CELL_STATE,
  INTERACTIVE_GRID_SESSION_STORAGE_KEY,
  INTERACTIVE_CELL_COLOR_TRANSITIONS,
  INTERACTIVE_ROW_DIRECTIONS,
  INTERACTIVE_SIZE_LEVELS,
  InteractiveGridGenerator,
  connectFourColorMixesAt,
  connectFourRoutesForLeaves,
  colorTransitionSequenceForLeaves,
  createInteractiveGridLayout,
  interactiveCellIndexAt,
  nextInteractiveCellState,
  normalizeInteractiveColorTransition,
  paletteStepAt,
  paletteSlideStateAt,
  paletteTourStateAt,
  paletteTransitionDurationSeconds,
  rollInteractiveCellColorTransition,
  sharpPaletteIndexAt,
  staggeredColorProgressAt,
  visitSubdivisionLeaves,
} from "../src/generators/interactive-grid-generator.js";
import {
  GLOBAL_CONFIG,
  SETTINGS,
  PALETTES,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
} from "../config.js";
import { INTERACTIVE_GRID_CONFIG } from "../config/compositions/interactive-grid.js";

function subdivisionLeavesAt(level, splitNodes = new Set()) {
  const leaves = [];
  visitSubdivisionLeaves(level, splitNodes, leaf => leaves.push({ ...leaf }));
  return leaves;
}

function memorySessionStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return entries.has(key) ? entries.get(key) : null;
    },
    setItem(key, value) {
      entries.set(key, String(value));
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

function interactiveGeneratorWithSession(storage, viewport = { width: 500, height: 300 }) {
  const catalog = createCatalog({ palettes: PALETTES });
  return catalog.generatorTypes.create("interactive-grid", {
    name: "interactiveGrid",
    definition: GENERATOR_DEFINITIONS.interactiveGrid,
    options: SETTINGS.interactiveGrid,
    settings: SETTINGS,
    runtime: {
      viewport: () => viewport,
      sessionStorage: () => storage,
    },
  });
}

test("cell clicks cycle empty -> five sizes -> empty and wrap in reverse", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.layout = {
    columns: 1,
    rows: 1,
    cellSize: 100,
    patternWidth: 100,
    patternHeight: 100,
    offsetX: 0,
    offsetY: 0,
  };
  generator.baseStates = Int8Array.from([EMPTY_CELL_STATE]);
  generator.subdivisionTrees = [new Set(["0"])];

  const results = Array.from(
    { length: 6 },
    () => generator.cycleCellAt(50, 50),
  );
  assert.deepEqual(results.map(result => result.index), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(
    results.map(result => result.state),
    [0, 1, 2, 3, 4, EMPTY_CELL_STATE],
  );
  assert.equal(generator.baseStates[0], EMPTY_CELL_STATE);
  assert.equal(generator.subdivisionTrees[0].size, 0);

  assert.equal(nextInteractiveCellState(EMPTY_CELL_STATE, -1), 4);
  assert.equal(nextInteractiveCellState(0, -1), EMPTY_CELL_STATE);
  assert.equal(nextInteractiveCellState(4), EMPTY_CELL_STATE);
  assert.throws(() => nextInteractiveCellState(5), /Unknown interactive cell state/);
  assert.deepEqual(INTERACTIVE_SIZE_LEVELS, [0, 1, 2, 3, 4]);
});

test("interactive grid hit-testing includes inner edges and excludes its bounds", () => {
  const layout = createInteractiveGridLayout(
    { longSideCells: 5 },
    { width: 500, height: 350 },
  );
  assert.deepEqual(
    {
      columns: layout.columns,
      rows: layout.rows,
      cellSize: layout.cellSize,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
    },
    { columns: 5, rows: 3, cellSize: 100, offsetX: 0, offsetY: 25 },
  );

  assert.equal(interactiveCellIndexAt(layout, 0, 25), 0);
  assert.equal(interactiveCellIndexAt(layout, 99.999, 124.999), 0);
  assert.equal(interactiveCellIndexAt(layout, 100, 25), 1);
  assert.equal(interactiveCellIndexAt(layout, 499.999, 324.999), 14);

  assert.equal(interactiveCellIndexAt(layout, -0.001, 100), -1);
  assert.equal(interactiveCellIndexAt(layout, 100, 24.999), -1);
  assert.equal(interactiveCellIndexAt(layout, 500, 100), -1);
  assert.equal(interactiveCellIndexAt(layout, 100, 325), -1);
  assert.equal(interactiveCellIndexAt(layout, Number.NaN, 100), -1);
  assert.equal(interactiveCellIndexAt(null, 100, 100), -1);
});

test("16x16 dots remain individually addressable", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.layout = {
    columns: 1,
    rows: 1,
    cellSize: 100,
    patternWidth: 100,
    patternHeight: 100,
    offsetX: 0,
    offsetY: 0,
  };
  generator.options = { dotMargin: 0 };
  generator.baseStates = Int8Array.from([4]);
  generator.subdivisionTrees = [new Set()];

  assert.equal(generator.subdivisionLeafAt(0, 3.125, 3.125).key, "0");
  assert.equal(generator.subdivisionLeafAt(0, 96.875, 96.875).key, "255");
});

test("parent visibility and scale round-trip through the same tab session", () => {
  const storage = memorySessionStorage();
  const first = interactiveGeneratorWithSession(storage);
  first.clear();
  for (let index = 0; index < INTERACTIVE_SIZE_LEVELS.length; index += 1) {
    for (let click = 0; click <= index; click += 1) first.cycleCell(index);
  }
  const expected = new Int8Array(first.baseStates.length).fill(EMPTY_CELL_STATE);
  INTERACTIVE_SIZE_LEVELS.forEach((level, index) => {
    expected[index] = level;
  });
  assert.deepEqual(first.baseStates, expected);
  assert.equal(first.splitSubdivisionLeaf(0, {
    key: "0",
    level: 0,
    cellIndex: 0,
  }).key, "0");

  const saved = JSON.parse(storage.getItem(INTERACTIVE_GRID_SESSION_STORAGE_KEY));
  assert.equal(saved.version, 1);
  assert.equal(saved.longSideCells, 5);
  assert.equal(saved.cells.length, 15);
  assert.deepEqual(Object.keys(saved).sort(), ["cells", "longSideCells", "version"]);
  first.dispose();

  const restored = interactiveGeneratorWithSession(storage);
  assert.deepEqual(restored.baseStates, expected);
  assert.ok(restored.subdivisionTrees.every(tree => tree.size === 0));

  const isolated = interactiveGeneratorWithSession(memorySessionStorage());
  assert.notDeepEqual(isolated.baseStates, expected);
  restored.dispose();
  isolated.dispose();
});

test("session cell coordinates survive portrait cropping and landscape restoration", () => {
  const landscapeRows = [
    [0, 1, 2, 3, 4],
    [4, 3, 2, 1, 0],
    [EMPTY_CELL_STATE, 0, 1, 2, 3],
  ];
  const cells = [];
  landscapeRows.forEach((states, row) => {
    states.forEach((state, column) => {
      cells.push({ column: column - 2, row: row - 1, state });
    });
  });
  const storage = memorySessionStorage({
    [INTERACTIVE_GRID_SESSION_STORAGE_KEY]: JSON.stringify({
      version: 1,
      longSideCells: 5,
      cells,
    }),
  });
  const viewport = { width: 300, height: 500 };
  const generator = interactiveGeneratorWithSession(storage, viewport);
  assert.equal(generator.layout.columns, 3);
  assert.equal(generator.layout.rows, 5);
  assert.deepEqual(Array.from(generator.baseStates), [
    -1, -1, -1,
    1, 2, 3,
    3, 2, 1,
    0, 1, 2,
    -1, -1, -1,
  ]);

  viewport.width = 500;
  viewport.height = 300;
  generator.resize(viewport);
  assert.deepEqual(
    Array.from(generator.baseStates),
    landscapeRows.flat(),
  );
  const rewritten = JSON.parse(storage.getItem(INTERACTIVE_GRID_SESSION_STORAGE_KEY));
  assert.equal(rewritten.longSideCells, 5);
  assert.ok(rewritten.cells.length > 15);
  generator.dispose();
});

test("project snapshots replace recipient offscreen state across orientation changes", () => {
  const source = interactiveGeneratorWithSession(memorySessionStorage());
  source.sessionCellStates.set("0:2", 4);
  const snapshot = source.snapshotProjectState();

  const target = interactiveGeneratorWithSession(memorySessionStorage());
  target.sessionCellStates.set("0:2", 0);
  target.sessionCellStates.set("1:2", 3);
  assert.equal(target.restoreProjectState(snapshot), true);
  target.resize({ width: 300, height: 500 });

  const bottomCenter = 4 * target.layout.columns + 1;
  const bottomRight = 4 * target.layout.columns + 2;
  assert.equal(target.baseStates[bottomCenter], 4);
  assert.equal(target.baseStates[bottomRight], EMPTY_CELL_STATE);
});

test("invalid or unavailable tab storage falls back without breaking interaction", () => {
  for (const serialized of [
    "{not-json",
    JSON.stringify({
      version: 1,
      longSideCells: 5,
      cells: [{ column: 0, row: 0, state: 5 }],
    }),
  ]) {
    const storage = memorySessionStorage({
      [INTERACTIVE_GRID_SESSION_STORAGE_KEY]: serialized,
    });
    const generator = interactiveGeneratorWithSession(storage);
    assert.equal([...generator.baseStates].includes(4), true);
    assert.doesNotThrow(() => JSON.parse(
      storage.getItem(INTERACTIVE_GRID_SESSION_STORAGE_KEY),
    ));
    generator.dispose();
  }

  const throwingStorage = {
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const generator = interactiveGeneratorWithSession(throwingStorage);
  assert.doesNotThrow(() => generator.cycleCell(0));
  assert.doesNotThrow(() => generator.setCellAbsent(0));
  assert.doesNotThrow(() => generator.clear());
  generator.dispose();

  const catalog = createCatalog({ palettes: PALETTES });
  assert.doesNotThrow(() => catalog.generatorTypes.create("interactive-grid", {
    name: "interactiveGrid",
    definition: GENERATOR_DEFINITIONS.interactiveGrid,
    options: SETTINGS.interactiveGrid,
    settings: SETTINGS,
    runtime: {
      viewport: () => ({ width: 300, height: 300 }),
      sessionStorage() {
        throw new Error("SecurityError");
      },
    },
  }));
});

test("each subdivision click replaces only its leaf with four recursive children", () => {
  const roots = subdivisionLeavesAt(1);
  assert.equal(roots.length, 4);
  assert.deepEqual(roots.map(leaf => leaf.key), ["0", "1", "2", "3"]);
  assert.ok(roots.every(leaf => leaf.level === 1 && leaf.depth === 0));

  const once = subdivisionLeavesAt(1, new Set(["0"]));
  assert.equal(once.length, 7);
  assert.deepEqual(
    once.map(leaf => leaf.key),
    ["0.0", "0.1", "0.2", "0.3", "1", "2", "3"],
  );
  assert.ok(once.slice(0, 4).every(leaf => leaf.level === 2));
  assert.ok(once.slice(4).every(leaf => leaf.level === 1));

  const twice = subdivisionLeavesAt(1, new Set(["0", "0.0"]));
  assert.equal(twice.length, 10);
  assert.deepEqual(
    twice.slice(0, 4).map(leaf => leaf.key),
    ["0.0.0", "0.0.1", "0.0.2", "0.0.3"],
  );
  assert.ok(twice.slice(0, 4).every(leaf => leaf.level === 3));

  const sixteen = subdivisionLeavesAt(4);
  assert.equal(sixteen.length, 256);
  assert.equal(sixteen[0].key, "0");
  assert.equal(sixteen.at(-1).key, "255");
  assert.ok(sixteen.every(leaf => leaf.level === 4 && leaf.depth === 0));
  assert.throws(() => subdivisionLeavesAt(5), /integer from 0 to 4/);

  // Descendants are not constrained by the five configurable base sizes.
  const beyondTiny = subdivisionLeavesAt(3, new Set(["0"]));
  assert.equal(beyondTiny.length, 67);
  assert.ok(beyondTiny.slice(0, 4).every(leaf => leaf.level === 4));
});

test("palette steps preserve exact swatches and expose a bounded slide phase", () => {
  assert.deepEqual(
    [0, 1.999, 2, 3.999, 4].map(time => sharpPaletteIndexAt(time, 4, 2)),
    [0, 0, 1, 1, 0],
  );
  assert.equal(sharpPaletteIndexAt(0, 4, 2, 1), 1);
  assert.throws(() => sharpPaletteIndexAt(0, 4, 0), /positive integer/);

  assert.deepEqual(paletteSlideStateAt(2, 4, 0.5, 2), {
    previousIndex: 0,
    currentIndex: 1,
    linearProgress: 0,
    progress: 0,
    transitioning: true,
  });
  assert.deepEqual(paletteSlideStateAt(2.25, 4, 0.5, 2), {
    previousIndex: 0,
    currentIndex: 1,
    linearProgress: 0.5,
    progress: 0.5,
    transitioning: true,
  });
  assert.deepEqual(paletteSlideStateAt(2.5, 4, 0.5, 2), {
    previousIndex: 0,
    currentIndex: 1,
    linearProgress: 1,
    progress: 1,
    transitioning: false,
  });
  assert.equal(paletteSlideStateAt(2, 4, 0.5, 2, 1).currentIndex, 0);
  const laterDecimalDeadline = paletteSlideStateAt(8.45, 6, 0.95, 4);
  assert.equal(laterDecimalDeadline.linearProgress, 1);
  assert.equal(laterDecimalDeadline.transitioning, false);
  assert.ok(paletteSlideStateAt(8.449999, 6, 0.95, 4).linearProgress < 1);
  assert.throws(
    () => paletteSlideStateAt(0, 4, 0.5, 0),
    /positive integer/,
  );
  assert.deepEqual(
    normalizeInteractiveColorTransition({ mode: "FLIP-DOT", durationSeconds: 0.2 }),
    {
      mode: "flip-dot",
      cycleThroughPalette: false,
      noise: false,
      durationSeconds: 0.2,
      timingCurve: [0.65, 0, 0.35, 1],
    },
  );
  const ramped = paletteSlideStateAt(
    2.125,
    4,
    0.5,
    2,
    0,
    [0.8, 0, 1, 1],
  );
  assert.equal(ramped.linearProgress, 0.25);
  assert.ok(ramped.progress > 0 && ramped.progress < ramped.linearProgress);
  assert.throws(
    () => normalizeInteractiveColorTransition({ mode: "fade", durationSeconds: 0.2 }),
    /Available modes: slide, flip-dot/,
  );
  assert.throws(
    () => normalizeInteractiveColorTransition({
      mode: "slide",
      durationSeconds: 0.2,
      timingCurve: [0.5, -1, 0.5, 1],
    }),
    /timingCurve Y values/,
  );
  assert.equal(normalizeInteractiveColorTransition({
    mode: "slide",
    durationSeconds: 0.2,
    cycleThroughPalette: true,
  }).cycleThroughPalette, true);
  for (const invalid of [null, 0, 1, "true", [], {}]) {
    assert.throws(
      () => normalizeInteractiveColorTransition({
        mode: "slide",
        durationSeconds: 0.2,
        cycleThroughPalette: invalid,
      }),
      /cycleThroughPalette must be true or false/,
    );
  }
});

test("palette tours make a full forward lap and land on the scheduled color", () => {
  const linearCurve = [0, 0, 1, 1];
  const base = linearProgress => ({
    previousIndex: 0,
    currentIndex: 1,
    linearProgress,
    progress: linearProgress,
    transitioning: linearProgress < 1,
  });
  const samples = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    .map(progress => paletteTourStateAt(base(progress), 4, true, linearCurve));
  assert.deepEqual(
    samples.map(state => [state.previousIndex, state.currentIndex]),
    [
      [0, 1], [0, 1],
      [1, 2], [1, 2],
      [2, 3], [2, 3],
      [3, 0], [3, 0],
      [0, 1], [0, 1],
    ],
  );
  assert.deepEqual(
    samples.map(state => Number(state.linearProgress.toFixed(8))),
    [0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5],
  );
  assert.deepEqual(paletteTourStateAt(base(1), 4, true, linearCurve), base(1));

  const twoColorPairs = [0, 1 / 3, 2 / 3, 0.999]
    .map(progress => paletteTourStateAt(base(progress), 2, true, linearCurve))
    .map(state => [state.previousIndex, state.currentIndex]);
  assert.deepEqual(twoColorPairs, [[0, 1], [1, 0], [0, 1], [0, 1]]);

  const oneColor = paletteTourStateAt({
    previousIndex: 0,
    currentIndex: 0,
    linearProgress: 0.25,
    progress: 0.25,
    transitioning: true,
  }, 1, true, linearCurve);
  assert.deepEqual(oneColor, {
    previousIndex: 0,
    currentIndex: 0,
    linearProgress: 1,
    progress: 1,
    transitioning: false,
  });
  const disabledState = base(0.5);
  assert.equal(paletteTourStateAt(disabledState, 4, false), disabledState);
  assert.throws(() => paletteTourStateAt(base(0), 0, true), /positive integer/);

  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.colorTransition = { timingCurve: linearCurve };
  generator.paletteColors = ["A", "B", "C", "D"];
  const middleHop = paletteTourStateAt(base(0.5), 4, true, linearCurve);
  const firstBand = generator.leafColorTransitionState(middleHop, 0, 2);
  const lastBand = generator.leafColorTransitionState(middleHop, 1, 2);
  assert.deepEqual(
    [firstBand, lastBand].map(state => [
      state.previousIndex,
      state.currentIndex,
      Number(state.progress.toFixed(8)),
    ]),
    [[2, 3, 0.75], [2, 3, 0.25]],
  );
});

test("palette tours replay slide, flip-dot, and waterfall before the original deadline", () => {
  const colors = ["#100000", "#200000", "#300000", "#400000"];
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.options = { colorCycleSeconds: 4, dotMargin: 0.1 };
  generator.colorTransition = {
    mode: "slide",
    cycleThroughPalette: true,
    durationSeconds: 0.5,
    timingCurve: [0, 0, 1, 1],
  };
  generator.paletteColors = colors;
  generator.backgroundColor = "#ffffff";
  generator.baseStates = Int8Array.from([0]);
  generator.subdivisionTrees = [new Set()];
  generator.leafCaches = [null];
  generator.colorTransitionPlans = [{ pattern: "snake", direction: null }];
  const glyphs = [];
  generator.shapeRenderer = {
    addPath(context, x, y, halfSize, roundness, transform) {
      glyphs.push({
        color: context.fillStyle,
        alpha: context.globalAlpha,
        x,
        y,
        halfSize,
        transform,
      });
    },
  };
  const alphaStack = [];
  let clipCount = 0;
  const context = {
    fillStyle: "",
    globalAlpha: 1,
    save() {
      alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = alphaStack.pop();
    },
    beginPath() {},
    fill() {},
    fillRect() {},
    rect() {},
    moveTo() {},
    arc() {},
    clip() {
      clipCount += 1;
    },
  };

  // Halfway through the outer transition is halfway through C -> D.
  generator.drawSubdivideCell(context, 0, 0, 100, 1.25);
  assert.deepEqual(glyphs.map(glyph => glyph.color), [colors[2], colors[3]]);
  assert.equal(glyphs[1].x, -50);

  glyphs.length = 0;
  generator.flipDotOptions = {
    axisDegrees: 0,
    direction: 1,
    foldCurve: [0.42, 0, 0.58, 1],
    bounceCurve: [0.22, 0.72, 0.32, 1.18],
    projectionPower: 1,
    liftInDots: 0,
  };
  generator.colorTransition.mode = "flip-dot";
  generator.drawSubdivideCell(context, 0, 0, 100, 1.25);
  assert.equal(glyphs[0].color, colors[3]);
  assert.equal(glyphs[0].transform.scaleY, 0);

  glyphs.length = 0;
  clipCount = 0;
  generator.colorTransition.mode = "slide";
  generator.colorTransitionPlans = [{ pattern: "waterfall", direction: null }];
  generator.drawSubdivideCell(context, 0, 0, 100, 1.25);
  assert.equal(clipCount, 0);
  assert.deepEqual(glyphs.map(glyph => glyph.color), [colors[2], colors[3]]);
  assert.equal(glyphs[0].x, 0);
  assert.equal(glyphs[1].x, 0);
  assert.equal(glyphs[1].alpha, 0.5);

  // The full lap still settles on the normally scheduled next color at 0.5s.
  glyphs.length = 0;
  generator.drawSubdivideCell(context, 0, 0, 100, 1.5);
  assert.deepEqual(glyphs.map(glyph => glyph.color), [colors[1]]);
});

test("each parent cell rolls one stable transition plan per palette step", () => {
  const rolls = [0.01, 0.21, 0.41, 0.61, 0.81, 0.76];
  const random = () => rolls.shift();
  assert.deepEqual(
    Array.from({ length: 5 }, () => rollInteractiveCellColorTransition(random)),
    [
      { pattern: "snake", direction: null },
      { pattern: "diamond-in", direction: null },
      { pattern: "diamond-out", direction: null },
      { pattern: "waterfall", direction: null },
      { pattern: "rows", direction: "right-to-left" },
    ],
  );

  const rowDirectionRolls = [0.01, 0.26, 0.51, 0.76];
  assert.deepEqual(
    rowDirectionRolls.map(value => rollInteractiveCellColorTransition(
      (() => {
        const values = [0.99, value];
        return () => values.shift();
      })(),
    ).direction),
    INTERACTIVE_ROW_DIRECTIONS,
  );
  assert.deepEqual(
    INTERACTIVE_CELL_COLOR_TRANSITIONS,
    ["snake", "diamond-in", "diamond-out", "waterfall", "rows"],
  );

  let randomCalls = 0;
  const values = [0.01, 0.21, 0.41, 0.61];
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.layout = { columns: 2, rows: 1 };
  generator.colorTransitionPlans = [];
  generator.colorTransitionStep = null;
  generator.random = () => {
    randomCalls += 1;
    return values.shift();
  };

  generator.ensureColorTransitionPlans(3);
  const firstPlans = generator.colorTransitionPlans;
  assert.equal(randomCalls, 2);
  generator.ensureColorTransitionPlans(3);
  assert.equal(generator.colorTransitionPlans, firstPlans);
  assert.equal(randomCalls, 2);
  generator.ensureColorTransitionPlans(4);
  assert.notEqual(generator.colorTransitionPlans, firstPlans);
  assert.equal(randomCalls, 4);
});

test("project-seeded transition plans reproduce across independent render sessions", () => {
  const makeGenerator = () => {
    const generator = Object.create(InteractiveGridGenerator.prototype);
    generator.layout = { columns: 3, rows: 2 };
    generator.colorTransitionPlans = [];
    generator.colorTransitionStep = null;
    generator.random = () => { throw new Error("seeded plans must not use ambient random"); };
    generator.projectSeed = () => 0x1234abcd;
    return generator;
  };
  const first = makeGenerator();
  const second = makeGenerator();
  first.ensureColorTransitionPlans(7);
  second.ensureColorTransitionPlans(7);
  assert.deepEqual(first.colorTransitionPlans, second.colorTransitionPlans);
  second.ensureColorTransitionPlans(8);
  assert.notDeepEqual(first.colorTransitionPlans, second.colorTransitionPlans);
});

test("snake, diamonds, waterfall, and directional rows sequence actual leaves", () => {
  const leaves = subdivisionLeavesAt(2);
  const snake = colorTransitionSequenceForLeaves(leaves, {
    pattern: "snake",
    direction: null,
  });
  assert.deepEqual(
    [0, 1, 2, 3, 7, 6, 5, 4].map(index => snake.positions[index]),
    Array.from({ length: 8 }, (_, index) => index / 15),
  );
  assert.equal(snake.bandCount, 16);
  const sixteenSnake = colorTransitionSequenceForLeaves(subdivisionLeavesAt(4), {
    pattern: "snake",
    direction: null,
  });
  assert.equal(sixteenSnake.bandCount, 256);

  const adaptiveLeaves = subdivisionLeavesAt(1, new Set(["0"]));
  const adaptiveSnake = colorTransitionSequenceForLeaves(adaptiveLeaves, {
    pattern: "snake",
    direction: null,
  });
  assert.deepEqual(
    adaptiveLeaves
      .map((leaf, index) => ({ key: leaf.key, position: adaptiveSnake.positions[index] }))
      .sort((a, b) => a.position - b.position)
      .map(entry => entry.key),
    ["0.0", "0.1", "1", "0.3", "0.2", "2", "3"],
  );

  const diamondOut = colorTransitionSequenceForLeaves(leaves, {
    pattern: "diamond-out",
    direction: null,
  });
  const diamondIn = colorTransitionSequenceForLeaves(leaves, {
    pattern: "diamond-in",
    direction: null,
  });
  assert.equal(diamondOut.positions[5], 0);
  assert.equal(diamondOut.positions[0], 1);
  assert.equal(diamondIn.positions[5], 1);
  assert.equal(diamondIn.positions[0], 0);

  const expectedByDirection = {
    "top-to-bottom": [0, 1],
    "bottom-to-top": [1, 0],
    "left-to-right": [0, 1],
    "right-to-left": [1, 0],
  };
  for (const [direction, expected] of Object.entries(expectedByDirection)) {
    const rows = colorTransitionSequenceForLeaves(leaves, {
      pattern: "rows",
      direction,
    });
    const horizontal = direction.endsWith("right") || direction.endsWith("left");
    const first = rows.positions[0];
    const last = rows.positions[horizontal ? 3 : 12];
    assert.deepEqual([first, last], expected);
    assert.equal(rows.bandCount, 4);
  }

  const waterfall = colorTransitionSequenceForLeaves(leaves, {
    pattern: "waterfall",
    direction: null,
  });
  assert.equal(waterfall.positions[12], 0);
  assert.equal(waterfall.positions[0], 1);
  assert.equal(waterfall.bandCount, 4);
  assert.deepEqual(waterfall.routes[12], [0, 4, 8, 12]);
  assert.deepEqual(waterfall.routes[15], [3, 7, 11, 15]);
  assert.deepEqual(
    waterfall.columnPositions.slice(12),
    [0, 1 / 3, 2 / 3, 1],
  );
  assert.equal(Math.min(...waterfall.traceStarts), 0);
  assert.equal(Math.max(...waterfall.traceStarts), 0.55);

  const adaptiveRoutes = connectFourRoutesForLeaves(adaptiveLeaves);
  adaptiveRoutes.forEach((route, targetIndex) => {
    assert.equal(route.at(-1), targetIndex);
    const first = adaptiveLeaves[route[0]];
    assert.equal(first.y - first.halfSize, -0.5);
    for (let index = 1; index < route.length; index += 1) {
      const above = adaptiveLeaves[route[index - 1]];
      const below = adaptiveLeaves[route[index]];
      assert.equal(above.y + above.halfSize, below.y - below.halfSize);
      assert.ok(
        Math.min(above.x + above.halfSize, below.x + below.halfSize)
        > Math.max(above.x - above.halfSize, below.x - below.halfSize),
      );
    }
  });
});

test("all stagger patterns start and finish inside the shared duration", () => {
  assert.equal(paletteStepAt(0, 4, 2), 0);
  assert.equal(paletteStepAt(1.999, 4, 2), 0);
  assert.equal(paletteStepAt(2, 4, 2), 1);
  assert.throws(() => paletteStepAt(0, 4, 0), /positive integer/);
  assert.equal(paletteTransitionDurationSeconds(4, 2, 2), 2);
  assert.throws(
    () => paletteTransitionDurationSeconds(4, 2.001, 2),
    /cannot exceed one palette step/,
  );

  for (const bands of [1, 2, 4, 16, 64, 256]) {
    assert.equal(staggeredColorProgressAt(0, 0, bands), 0);
    assert.equal(staggeredColorProgressAt(0, 1, bands), 0);
    assert.equal(staggeredColorProgressAt(1, 0, bands), 1);
    assert.equal(staggeredColorProgressAt(1, 1, bands), 1);
  }
  assert.ok(staggeredColorProgressAt(0.5, 0, 16) > 0);
  assert.equal(staggeredColorProgressAt(0.5, 1, 16), 0);
  assert.ok(staggeredColorProgressAt(0.999, 1, 16) < 1);

  for (const leaves of [
    subdivisionLeavesAt(0),
    subdivisionLeavesAt(4),
    subdivisionLeavesAt(1, new Set(["0"])),
  ]) {
    const sequence = {
      leaves,
      ...colorTransitionSequenceForLeaves(leaves, {
        pattern: "waterfall",
        direction: null,
      }),
    };
    assert.ok(connectFourColorMixesAt(sequence, 0).every(mix => mix === 0));
    assert.ok(connectFourColorMixesAt(sequence, 1).every(mix => mix === 1));
    assert.ok(connectFourColorMixesAt(sequence, 0.5).every(mix => mix >= 0 && mix <= 1));
    assert.ok(connectFourColorMixesAt(sequence, 0.001).some(mix => mix > 0));
    if (leaves.length > 1) {
      assert.ok(connectFourColorMixesAt(sequence, 0.99).some(mix => mix < 1));
    }
  }

  const adaptiveLeaves = subdivisionLeavesAt(1, new Set(["0"]));
  const adaptiveSequence = colorTransitionSequenceForLeaves(adaptiveLeaves, {
    pattern: "waterfall",
    direction: null,
  });
  assert.equal(Math.min(...adaptiveSequence.traceStarts), 0);
  assert.equal(Math.max(...adaptiveSequence.traceStarts), 0.55);
  adaptiveSequence.routes.forEach((route, targetIndex) => {
    route.slice(0, -1).forEach(upperIndex => {
      assert.ok(
        adaptiveSequence.traceStarts[upperIndex]
        > adaptiveSequence.traceStarts[targetIndex],
      );
    });
  });

  const sixteenLeaves = subdivisionLeavesAt(4);
  const sixteenSequence = {
    leaves: sixteenLeaves,
    ...colorTransitionSequenceForLeaves(sixteenLeaves, {
      pattern: "waterfall",
      direction: null,
    }),
  };
  const earlyMixes = connectFourColorMixesAt(sixteenSequence, 0.1);
  assert.ok(sixteenSequence.routes[240].some(index => earlyMixes[index] > 0));
  assert.ok(sixteenSequence.routes[255].every(index => earlyMixes[index] === 0));
});

test("connect-four fill traces color through fixed dots without moving geometry", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.options = { colorCycleSeconds: 4, dotMargin: 0.1 };
  generator.colorTransition = {
    mode: "slide",
    durationSeconds: 0.5,
    timingCurve: [0.65, 0, 0.35, 1],
  };
  generator.colorTransitionPlans = [{ pattern: "waterfall", direction: null }];
  generator.paletteColors = ["#102030", "#abcdef"];
  generator.subdivisionTrees = [new Set()];

  const glyphs = [];
  let clipCount = 0;
  generator.shapeRenderer = {
    addPath(context, x, y, halfSize) {
      glyphs.push({
        color: context.fillStyle,
        alpha: context.globalAlpha,
        x,
        y,
        halfSize,
      });
    },
  };
  const alphaStack = [];
  const context = {
    fillStyle: "",
    globalAlpha: 1,
    save() {
      alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = alphaStack.pop();
    },
    beginPath() {},
    fill() {},
    clip() {
      clipCount += 1;
    },
  };

  generator.drawSubdivideCell(context, 0, 1, 100, 2.1);
  assert.equal(clipCount, 0);
  const targets = subdivisionLeavesAt(1);
  const fixedGeometry = new Set(targets.map(leaf => (
    `${leaf.x * 100}:${leaf.y * 100}:${leaf.halfSize * 100 * 0.9}`
  )));
  glyphs.forEach(glyph => {
    assert.equal(fixedGeometry.has(`${glyph.x}:${glyph.y}:${glyph.halfSize}`), true);
  });
  const trace = glyphs.filter(glyph => glyph.color === "#102030");
  assert.equal(trace.length, 1);
  assert.equal(trace[0].x, -25);
  assert.equal(trace[0].y, -25);
  assert.ok(trace[0].alpha > 0 && trace[0].alpha < 1);

  glyphs.length = 0;
  generator.drawSubdivideCell(context, 0, 1, 100, 2.5);
  assert.equal(glyphs.length, 4);
  assert.ok(glyphs.every(glyph => glyph.color === "#102030"));
});

test("a circular clip masks both sliding circles without background geometry", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.options = {
    colorCycleSeconds: 4,
    dotMargin: 0.1,
  };
  generator.colorTransition = { mode: "slide", durationSeconds: 0.5 };
  generator.paletteColors = ["#102030", "#abcdef"];
  generator.backgroundColor = "#ffffff";
  generator.subdivisionTrees = [new Set()];

  const glyphs = [];
  const cutouts = [];
  const fillModes = [];
  let clipCount = 0;
  generator.shapeRenderer = {
    addPath(context, x, y, halfSize) {
      glyphs.push({ x, y, halfSize, color: context.fillStyle });
    },
  };
  const context = {
    fillStyle: "",
    save() {},
    restore() {},
    beginPath() {},
    fill(mode) {
      fillModes.push({ color: this.fillStyle, mode });
    },
    fillRect(...values) {
      cutouts.push({ color: this.fillStyle, values });
    },
    rect(...values) {
      cutouts.push({ rect: values });
    },
    moveTo(...values) {
      cutouts.push({ moveTo: values });
    },
    arc(...values) {
      cutouts.push({ arc: values });
    },
    clip() {
      clipCount += 1;
    },
  };

  generator.drawSubdivideCell(context, 0, 0, 100, 2.25);
  assert.deepEqual(cutouts, [
    { arc: [0, 0, 45, 0, Math.PI * 2] },
  ]);
  assert.equal(clipCount, 1);
  assert.deepEqual(glyphs, [
    { x: 0, y: 0, halfSize: 45, color: "#102030" },
    { x: -50, y: -50, halfSize: 45, color: "#abcdef" },
  ]);
  assert.deepEqual(fillModes, [
    { color: "#102030", mode: undefined },
    { color: "#abcdef", mode: undefined },
  ]);

  glyphs.length = 0;
  cutouts.length = 0;
  fillModes.length = 0;
  clipCount = 0;
  generator.drawSubdivideCell(context, 0, 0, 100, 2.75);
  assert.deepEqual(cutouts, []);
  assert.equal(clipCount, 0);
  assert.deepEqual(glyphs, [
    { x: 0, y: 0, halfSize: 45, color: "#abcdef" },
  ]);
  assert.deepEqual(fillModes, [{ color: "#abcdef", mode: undefined }]);
});

test("flip-dot mode reuses the shared edge-on face swap", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.options = { colorCycleSeconds: 4, dotMargin: 0.1 };
  generator.colorTransition = { mode: "flip-dot", durationSeconds: 0.5 };
  generator.flipDotOptions = {
    axisDegrees: 0,
    direction: 1,
    foldCurve: [0.42, 0, 0.58, 1],
    bounceCurve: [0.22, 0.72, 0.32, 1.18],
    projectionPower: 1,
    liftInDots: 0,
  };
  generator.paletteColors = ["#102030", "#abcdef"];
  generator.subdivisionTrees = [new Set()];

  const glyphs = [];
  generator.shapeRenderer = {
    addPath(context, x, y, halfSize, roundness, transform) {
      glyphs.push({
        color: context.fillStyle,
        x,
        y,
        halfSize,
        roundness,
        transform,
      });
    },
  };
  const context = {
    fillStyle: "",
    beginPath() {},
    fill() {},
  };

  generator.drawSubdivideCell(context, 0, 0, 100, 2.125);
  assert.equal(glyphs[0].color, "#102030");
  assert.ok(glyphs[0].transform.scaleY > 0 && glyphs[0].transform.scaleY < 1);
  assert.equal(glyphs[0].transform.scaleAxis, 0);

  glyphs.length = 0;
  generator.drawSubdivideCell(context, 0, 0, 100, 2.25);
  assert.equal(glyphs[0].color, "#abcdef");
  assert.equal(glyphs[0].transform.scaleY, 0);

  glyphs.length = 0;
  generator.drawSubdivideCell(context, 0, 0, 100, 2.375);
  assert.equal(glyphs[0].color, "#abcdef");
  assert.ok(glyphs[0].transform.scaleY > 0);
});

test("clicking any active cell leaf recurses without cycling its base size", () => {
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.active = true;
  generator.layout = {
    columns: 1,
    rows: 1,
    cellSize: 100,
    patternWidth: 100,
    patternHeight: 100,
    offsetX: 0,
    offsetY: 0,
  };
  generator.options = { dotMargin: 0.1 };
  generator.baseStates = Int8Array.from([1]);
  generator.subdivisionTrees = [new Set()];
  generator.hoveredSubdivisionLeaf = null;
  generator.focusedCell = -1;
  generator.runtime = {};

  const first = generator.input("click", { x: 25, y: 25, button: 0 });
  assert.equal(first.key, "0");
  assert.equal(generator.baseStates[0], 1);
  assert.deepEqual([...generator.subdivisionTrees[0]], ["0"]);
  assert.equal(generator.subdivisionLeafAt(0, 12.5, 12.5).key, "0.0");

  const second = generator.input("click", { x: 12.5, y: 12.5, button: 0 });
  assert.equal(second.key, "0.0");
  assert.equal(generator.baseStates[0], 1);
  assert.equal(subdivisionLeavesAt(1, generator.subdivisionTrees[0]).length, 10);

  // A gap still addresses the outer clickable grid cell.
  const cycled = generator.input("click", { x: 50, y: 50, button: 0 });
  assert.equal(cycled.state, 2);
  assert.equal(generator.subdivisionTrees[0].size, 0);

  generator.baseStates[0] = 1;
  generator.subdivisionTrees[0].add("0");
  const shifted = generator.input("click", {
    x: 25,
    y: 25,
    button: 0,
    shiftKey: true,
  });
  assert.equal(shifted.state, 2);
  assert.equal(generator.subdivisionTrees[0].size, 0);
});

test("right-click sets the addressed parent grid or circle directly to absent", () => {
  const announcement = { textContent: "" };
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.active = true;
  generator.layout = {
    columns: 2,
    rows: 1,
    cellSize: 100,
    patternWidth: 200,
    patternHeight: 100,
    offsetX: 0,
    offsetY: 0,
  };
  generator.options = { dotMargin: 0.1 };
  generator.baseStates = Int8Array.from([1, 2]);
  generator.subdivisionTrees = [new Set(["0"]), new Set(["1"])];
  const untouchedCache = { leaves: ["untouched"] };
  generator.leafCaches = [{ leaves: ["stale"] }, untouchedCache];
  generator.hoveredSubdivisionLeaf = { key: "0.0" };
  generator.focusedCell = -1;
  generator.runtime = { announcer: () => announcement };

  const removed = generator.input("contextmenu", {
    x: 12.5,
    y: 12.5,
    button: 2,
  });
  assert.deepEqual(removed, { index: 0, state: EMPTY_CELL_STATE });
  assert.deepEqual([...generator.baseStates], [EMPTY_CELL_STATE, 2]);
  assert.equal(generator.subdivisionTrees[0].size, 0);
  assert.deepEqual([...generator.subdivisionTrees[1]], ["1"]);
  assert.equal(generator.leafCaches[0], null);
  assert.equal(generator.leafCaches[1], untouchedCache);
  assert.equal(generator.hoveredSubdivisionLeaf, null);
  assert.equal(generator.focusedCell, 0);
  assert.match(announcement.textContent, /Row 1, column 1: empty/);

  assert.deepEqual(
    generator.input("contextmenu", { x: 12.5, y: 12.5, button: 2 }),
    { index: 0, state: EMPTY_CELL_STATE },
  );
  assert.equal(generator.input("contextmenu", { x: 200, y: 50, button: 2 }), false);
  assert.equal(generator.input("click", { x: 150, y: 50, button: 2 }), false);
  assert.equal(generator.baseStates[1], 2);
});

test("canvas context-menu routing scales coordinates and suppresses the native menu", () => {
  const routed = [];
  let prevented = false;
  let focusedWith = null;
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    focus(options) {
      focusedWith = options;
    },
  };
  const event = {
    clientX: 110,
    clientY: 70,
    button: 2,
    shiftKey: false,
    preventDefault() {
      prevented = true;
    },
  };

  assert.equal(routeCanvasPointerInput({
    canvas,
    event,
    canvasWidth: 400,
    canvasHeight: 200,
    inputType: "contextmenu",
    input(type, payload) {
      routed.push({ type, payload });
      return true;
    },
    preventDefault: true,
  }), true);
  assert.deepEqual(routed, [{
    type: "contextmenu",
    payload: { x: 200, y: 100, button: 2, shiftKey: false },
  }]);
  assert.equal(prevented, true);
  assert.deepEqual(focusedWith, { preventScroll: true });

  prevented = false;
  focusedWith = null;
  assert.equal(routeCanvasPointerInput({
    canvas,
    event,
    canvasWidth: 400,
    canvasHeight: 200,
    inputType: "contextmenu",
    input: () => false,
    preventDefault: true,
  }), false);
  assert.equal(prevented, false);
  assert.equal(focusedWith, null);
});

test("empty cells emit no glyphs while active cells still draw", () => {
  let glyphCount = 0;
  const strokeRects = [];
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.layout = {
    columns: 2,
    rows: 1,
    cellSize: 100,
    patternWidth: 200,
    patternHeight: 100,
    offsetX: 0,
    offsetY: 0,
  };
  generator.baseStates = Int8Array.from([EMPTY_CELL_STATE, 1]);
  generator.options = {
    colorCycleSeconds: 4,
    dotMargin: 0,
    showCellGrid: false,
  };
  generator.colorTransition = { mode: "slide", durationSeconds: 0 };
  generator.paletteColors = ["#000000", "#ffffff"];
  generator.hoveredCell = -1;
  generator.hoveredSubdivisionLeaf = null;
  generator.focusedCell = -1;
  generator.subdivisionTrees = [new Set(), new Set()];
  generator.shapeRenderer = {
    addPath() {
      glyphCount += 1;
    },
  };
  const context = {
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    fill() {},
    strokeRect(...values) {
      strokeRects.push(values);
    },
  };

  generator.draw({ time: 0 }, {}, context);
  assert.equal(glyphCount, 4);

  glyphCount = 0;
  generator.baseStates.fill(EMPTY_CELL_STATE);
  generator.draw({ time: 0 }, {}, context);
  assert.equal(glyphCount, 0);

  generator.focusedCell = 0;
  generator.draw({ time: 0 }, {}, context);
  assert.deepEqual(strokeRects, []);

  generator.hoveredCell = 0;
  generator.draw({ time: 0 }, {}, context);
  assert.equal(strokeRects.length, 1);
});

test("configured catalog exposes the interactive generator and composition", () => {
  const catalog = createCatalog({ palettes: PALETTES });
  assert.equal(catalog.generatorTypes.has("interactive-grid"), true);
  assert.equal(GENERATOR_DEFINITIONS.interactiveGrid.type, "interactive-grid");
  assert.equal(
    GENERATOR_DEFINITIONS.interactiveGrid.settingsKey,
    "interactiveGrid",
  );
  assert.equal(Object.hasOwn(GENERATOR_DEFINITIONS.interactiveGrid, "flockSettings"), false);
  assert.equal(Object.hasOwn(SETTINGS.interactiveGrid, "behaviorsByLevel"), false);
  assert.ok(
    ["flip-dot", "slide"].includes(SETTINGS.interactiveGrid.colorTransition.mode),
  );
  assert.deepEqual(
    SETTINGS.interactiveGrid.colorTransition.timingCurve,
    INTERACTIVE_GRID_CONFIG.settings.interactiveGrid.colorTransition.timingCurve,
  );
  assert.deepEqual(
    COMPOSITION_DEFINITIONS["interactive-grid"].steps,
    [{ use: "interactiveGrid" }],
  );
  assert.equal(SETTINGS.composition.active, GLOBAL_CONFIG.composition.active);

  const generator = catalog.generatorTypes.create("interactive-grid", {
    name: "interactiveGrid",
    definition: GENERATOR_DEFINITIONS.interactiveGrid,
    options: SETTINGS.interactiveGrid,
    settings: SETTINGS,
    runtime: { viewport: () => ({ width: 300, height: 300 }) },
  });
  assert.ok(generator instanceof InteractiveGridGenerator);
  const state = generator.inspect();
  assert.equal(state.type, "interactive-grid");
  assert.equal(
    state.colorTransitionMode,
    SETTINGS.interactiveGrid.colorTransition.mode,
  );
  assert.equal(
    state.colorTransitionCycleThroughPalette,
    SETTINGS.interactiveGrid.colorTransition.cycleThroughPalette,
  );
  assert.equal([...state.baseStates].includes(4), true);
  assert.equal(Object.hasOwn(state, "behaviorsByLevel"), false);
  assert.equal(Object.hasOwn(state, "flockEnergy"), false);
  generator.dispose();
});

test("resize preserves the centred overlap without duplicating authored cells", () => {
  const catalog = createCatalog({ palettes: PALETTES });
  const viewport = { width: 500, height: 300 };
  const generator = catalog.generatorTypes.create("interactive-grid", {
    name: "interactiveGrid",
    definition: GENERATOR_DEFINITIONS.interactiveGrid,
    options: SETTINGS.interactiveGrid,
    settings: SETTINGS,
    runtime: { viewport: () => viewport },
  });

  generator.clear();
  const oldCenter = 1 * 5 + 2;
  generator.baseStates[oldCenter] = 2;
  generator.subdivisionTrees[oldCenter].add("0");
  const centerPlan = Object.freeze({ pattern: "diamond-out", direction: null });
  generator.colorTransitionPlans[oldCenter] = centerPlan;
  generator.colorTransitionStep = 7;
  viewport.width = 300;
  viewport.height = 500;
  generator.resize(viewport);

  assert.equal(generator.layout.columns, 3);
  assert.equal(generator.layout.rows, 5);
  assert.equal(generator.baseStates.filter(state => state !== EMPTY_CELL_STATE).length, 1);
  assert.equal(generator.baseStates[2 * 3 + 1], 2);
  assert.deepEqual([...generator.subdivisionTrees[2 * 3 + 1]], ["0"]);
  assert.equal(generator.colorTransitionPlans[2 * 3 + 1], centerPlan);
  assert.equal(generator.colorTransitionStep, 7);
  assert.equal(
    generator.subdivisionTrees.filter(tree => tree.size > 0).length,
    1,
  );
  generator.dispose();
});

test("keyboard focus moves by cell and Enter cycles the announced state", () => {
  const announcement = { textContent: "" };
  const generator = Object.create(InteractiveGridGenerator.prototype);
  generator.active = true;
  generator.layout = {
    columns: 3,
    rows: 3,
    cellSize: 100,
    patternWidth: 300,
    patternHeight: 300,
    offsetX: 0,
    offsetY: 0,
  };
  generator.baseStates = new Int8Array(9).fill(EMPTY_CELL_STATE);
  generator.subdivisionTrees = Array.from({ length: 9 }, () => new Set());
  generator.focusedCell = -1;
  generator.runtime = { announcer: () => announcement };

  assert.equal(generator.input("keydown", { key: "ArrowRight" }), true);
  assert.equal(generator.focusedCell, 5);
  assert.match(announcement.textContent, /Row 2, column 3: empty/);
  assert.equal(generator.input("keydown", { key: "Enter", repeat: false }), true);
  assert.equal(generator.baseStates[5], 0);
  assert.match(announcement.textContent, /Row 2, column 3: 1×1/);
  generator.baseStates[5] = 4;
  generator.announceFocusedCell();
  assert.match(announcement.textContent, /16×16/);
  generator.baseStates[5] = 1;
  assert.equal(generator.input("keydown", { key: " ", repeat: false }), true);
  assert.deepEqual([...generator.subdivisionTrees[5]], ["0"]);
  assert.equal(generator.baseStates[5], 1);
  assert.match(announcement.textContent, /circle split into four/);
  assert.equal(generator.input("keydown", { key: " ", repeat: false }), true);
  assert.deepEqual([...generator.subdivisionTrees[5]], ["0", "1"]);
  assert.equal(generator.input("keydown", { key: "Enter", repeat: false }), true);
  assert.equal(generator.baseStates[5], 2);
  assert.equal(generator.subdivisionTrees[5].size, 0);
  assert.equal(generator.input("keydown", { key: "Enter", repeat: true }), false);
  assert.equal(generator.input("pointerdown", { x: 250, y: 150 }), false);
});
