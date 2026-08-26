import test from "node:test";
import assert from "node:assert/strict";

import { FactoryRegistry } from "../src/core/registry.js";
import { CompositionDirector } from "../src/core/composition-director.js";
import { SequenceRule } from "../src/compositions/sequence-rule.js";
import { CellStateBuffer } from "../src/cell-transitions/cell-state-buffer.js";
import { NoneTransition } from "../src/cell-transitions/none.js";
import { GridField } from "../src/fields/grid-field.js";
import { TypeField } from "../src/fields/type-field.js";
import { CircleGrid } from "../src/grid/circle-grid.js";
import { FlockGridGenerator } from "../src/generators/flock-grid-generator.js";
import { createCatalog } from "../src/catalog.js";
import {
  SETTINGS,
  PALETTES,
  GENERATOR_DEFINITIONS,
  COMPOSITION_DEFINITIONS,
} from "../config.js";

test("factory registries reject duplicates and explain unknown ids", () => {
  const registry = new FactoryRegistry("generator type");
  registry.register("flock", options => ({ options }));

  assert.deepEqual(registry.create("flock", { count: 5 }), {
    options: { count: 5 },
  });
  assert.throws(
    () => registry.register("flock", () => null),
    /already registered/,
  );
  assert.throws(
    () => registry.create("voronoi"),
    /Unknown generator type "voronoi".*flock/,
  );
});

test("sequence composition rules advance, loop, and support indefinite holds", () => {
  const sequence = new SequenceRule({
    loop: true,
    steps: [
      { use: "flock", durationSeconds: 2 },
      { use: "voronoi", durationSeconds: 1 },
    ],
  });

  assert.equal(sequence.update({ dt: 0 })[0].use, "flock");
  assert.equal(sequence.update({ dt: 2 })[0].use, "voronoi");
  assert.equal(sequence.update({ dt: 1 })[0].use, "flock");
  assert.equal(sequence.update({ dt: 7 })[0].use, "flock");

  const held = new SequenceRule({
    steps: [{ use: "l-tree" }],
  });
  assert.equal(held.update({ dt: 1000 })[0].use, "l-tree");

  const wallClock = new SequenceRule({
    steps: [
      { use: "first", durationSeconds: 1 },
      { use: "second" },
    ],
  });
  assert.equal(
    wallClock.update({ dt: 1 / 30, compositionDt: 1 })[0].use,
    "second",
  );
});

test("composition director switches generators through lifecycle contracts", () => {
  const events = [];
  const seenOptions = {};
  const context = {
    globalAlpha: 0.8,
    save() {
      this.savedAlpha = this.globalAlpha;
    },
    restore() {
      this.globalAlpha = this.savedAlpha;
    },
  };
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");

  generatorTypes.register("fake", ({ name, options }) => {
    seenOptions[name] = options;
    return {
      enter: () => events.push(`enter:${name}`),
      update: () => events.push(`update:${name}`),
      draw: () => events.push(`draw:${name}:${context.globalAlpha}`),
      resize: ({ width, height }) => events.push(`resize:${name}:${width}x${height}`),
      exit: () => events.push(`exit:${name}`),
      dispose: () => events.push(`dispose:${name}`),
    };
  });
  compositionRules.register(
    "sequence",
    ({ definition }) => new SequenceRule(definition),
  );

  const director = new CompositionDirector({
    settings: { firstOptions: { density: 4 } },
    generatorDefinitions: {
      first: {
        type: "fake",
        settingsKey: "firstOptions",
        strategy: "demo-strategy",
      },
      second: { type: "fake", options: { density: 2 } },
    },
    compositionDefinitions: {
      demo: {
        rule: "sequence",
        loop: false,
        steps: [
          { use: "first", opacity: 0.5, durationSeconds: 1 },
          { use: "second" },
        ],
      },
    },
    generatorTypes,
    compositionRules,
    runtime: { context: () => context },
  });

  director.use("demo");
  director.resize({ width: 640, height: 480 });
  director.update({ dt: 0 });
  director.draw({ dt: 0 });
  // The inspection record is the debug surface: identity metadata per
  // generator, plus the timeline state that decides how intro/outro render.
  assert.deepEqual(director.inspect(), {
    compositionId: "demo",
    renderPlan: [{ use: "first", opacity: 0.5 }],
    // No arrangement registry was passed, so no intro/outro mode can draw
    // content of its own here.
    phaseOverlay: null,
    generators: {
      first: {
        generatorInstanceId: "first",
        generatorType: "fake",
        settingsKey: "firstOptions",
        strategy: "demo-strategy",
      },
    },
    timeline: {
      phase: "core",
      progress: null,
      durationSeconds: null,
      cycleIndex: 0,
      coreTime: 0,
      outerElapsed: 0,
      coreElapsed: 0,
      coreDuration: null,
      endpointDurations: { start: 1, end: 1 },
      rule: {
        stepIndex: 0,
        stepCount: 2,
        use: "first",
        elapsedSeconds: 0,
        stepDurationSeconds: 1,
        cycleSeconds: null,
        loop: false,
        holding: false,
      },
    },
  });
  director.update({ dt: 1 });
  director.dispose();

  assert.deepEqual(events, [
    "resize:first:640x480",
    "enter:first",
    "update:first",
    "draw:first:0.4",
    "resize:second:640x480",
    "exit:first",
    "enter:second",
    "update:second",
    "exit:second",
    "dispose:first",
    "dispose:second",
  ]);
  assert.equal(context.globalAlpha, 0.8);
  assert.deepEqual(seenOptions, {
    first: { density: 4 },
    second: { density: 2 },
  });
});

test("composition rules can return layered render plans", () => {
  const events = [];
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  generatorTypes.register("fake", ({ name }) => ({
    update: (frame, entries) => events.push(`update:${name}:${entries.length}`),
    draw: (frame, entry) => events.push(`draw:${name}:${entry.mode}`),
  }));
  compositionRules.register("overlay", ({ definition }) => ({
    update: () => definition.plan,
  }));
  const context = { globalAlpha: 1, save() {}, restore() {} };
  const director = new CompositionDirector({
    settings: {},
    generatorDefinitions: {
      back: { type: "fake" },
      front: { type: "fake" },
    },
    compositionDefinitions: {
      stack: {
        rule: "overlay",
        plan: [
          { use: "back", mode: "base" },
          { use: "front", mode: "accent" },
        ],
      },
    },
    generatorTypes,
    compositionRules,
    runtime: { context: () => context },
  });

  director.use("stack");
  director.update({ dt: 0 });
  director.draw({ dt: 0 });
  assert.deepEqual(events, [
    "update:back:1",
    "update:front:1",
    "draw:back:base",
    "draw:front:accent",
  ]);
});

test("text lockup masks only dots that overlap the typography", () => {
  const calls = [];
  const overlapQueries = [];
  const context = {};
  let flockHidden;
  let gridHidden;
  const generator = Object.create(FlockGridGenerator.prototype);
  generator.runtime = { context: () => context };
  generator.typographyOptions = { textLockup: false };
  generator.flock = {
    draw(received, isHidden) {
      calls.push(received === context ? "flock" : "wrong-context");
      flockHidden = isHidden;
    },
    pulseStrength: () => 0.75,
  };
  generator.grid = {
    draw(received, isHidden) {
      calls.push(received === context ? "grid" : "wrong-context");
      gridHidden = isHidden;
    },
    textColor: () => "rgb(1 2 3)",
  };
  generator.typeField = {
    overlapsText(x, y, radius, pulse) {
      overlapQueries.push({ x, y, radius, pulse });
      return x === 10;
    },
    draw: (received, color, pulse) => calls.push(
      received === context ? `type:${color}:${pulse}` : "wrong-context",
    ),
  };

  generator.draw();
  assert.deepEqual(calls, ["flock", "grid", "type:rgb(1 2 3):0.75"]);
  assert.equal(flockHidden, undefined);
  assert.equal(gridHidden, undefined);

  calls.length = 0;
  generator.typographyOptions.textLockup = true;
  generator.draw();
  assert.deepEqual(calls, ["flock", "grid", "type:rgb(1 2 3):0.75"]);
  assert.equal(typeof flockHidden, "function");
  assert.equal(flockHidden, gridHidden);
  assert.equal(flockHidden(10, 20, 3), true);
  assert.equal(gridHidden(11, 20, 1), false);
  assert.deepEqual(overlapQueries, [
    { x: 10, y: 20, radius: 3, pulse: 0.75 },
    { x: 11, y: 20, radius: 1, pulse: 0.75 },
  ]);
  assert.equal(SETTINGS.typography.textLockup, true);
});

test("none transition maps field energy onto circle subdivision levels", () => {
  const states = new CellStateBuffer(2);
  const none = new NoneTransition({ baseKind: "circle" });
  none.resize(2);
  none.updateCell(0, { energy: 0.99 }, states);
  assert.equal(states.level[0], 3);
  assert.equal(states.roundness[0], 1);
  assert.equal(states.scaleX[0], 1);
  assert.equal(states.opacity[0], 1);
});

test("grid fields mix accumulated points and direct sources without p5", () => {
  const layout = {
    columns: 1,
    rows: 1,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const field = new GridField(layout, {
    fieldRadiusInCells: 0.6,
    fieldGain: 0.72,
  });

  field.addPoint(50, 50, 1);
  assert.ok(field.resolveCell(0) > 0);
  assert.ok(field.resolveCell(0) < 1);

  field.maxCell(0, 0.9);
  assert.ok(Math.abs(field.resolveCell(0) - 0.9) < 1e-6);
  field.reset();
  assert.equal(field.resolveCell(0), 0);
});

test("typography overlap queries use each dot's current footprint", () => {
  const typeField = Object.create(TypeField.prototype);
  typeField.width = 10;
  typeField.height = 10;
  typeField.fieldWidth = 10;
  typeField.fieldHeight = 10;
  typeField.scale = 1;
  typeField.options = { pulseScale: 0 };
  typeField.mask = { pixels: new Uint8ClampedArray(10 * 10 * 4) };
  typeField.mask.pixels[(5 * 10 + 5) * 4] = 255;
  typeField.buildCoverageIntegral();

  assert.equal(typeField.overlapsText(2, 5.5, 1.9), false);
  assert.equal(typeField.overlapsText(2, 5.5, 2.1), true);
  assert.equal(typeField.overlapsText(5.5, 5.5, 0), true);

  typeField.mask.pixels[(5 * 10 + 7) * 4] = 255;
  typeField.options.pulseScale = 1;
  typeField.buildCoverageIntegral();
  assert.equal(typeField.overlapsText(9.5, 6, 0, 0), false);
  assert.equal(typeField.overlapsText(9.5, 6, 0, 1), true);
});

test("typography masks stay centred on odd viewport dimensions", () => {
  const drawn = [];
  const typeField = Object.create(TypeField.prototype);
  typeField.width = 801;
  typeField.height = 603;
  typeField.scale = 0.25;
  typeField.options = {
    text: "OpenAI",
    weight: 600,
    fontFamily: "sans-serif",
    sizeInCanvasHeights: 0.2,
    halo: 0,
  };
  const target = {
    width: Math.ceil(typeField.width * typeField.scale),
    height: Math.ceil(typeField.height * typeField.scale),
    background() {},
    drawingContext: {
      save() {},
      restore() {},
      fillText(text, x, y) {
        drawn.push({ text, x, y });
      },
    },
  };

  typeField.renderInto(target, false);
  assert.deepEqual(drawn, [{
    text: "OpenAI",
    x: 801 * 0.25 * 0.5,
    y: 603 * 0.25 * 0.5,
  }]);
});

test("circle grid owns state when a transition resize returns nothing", () => {
  const transition = {
    resizeCalls: 0,
    resize() {
      this.resizeCalls += 1;
    },
    updateCell(index, cell, state) {
      state.level[index] = 1;
      state.scaleX[index] = 1.5;
    },
  };
  const grid = new CircleGrid(
    {
      longSideCells: 3,
      dotMargin: 0,
      palette: "mono",
      fieldRadiusInCells: 1,
      fieldGain: 1,
      riseSeconds: 0,
      fallSeconds: 0,
      showCellGrid: false,
    },
    { mono: ["#000000", "#ffffff"] },
    transition,
    { addPath() {} },
    { width: 300, height: 300 },
  );

  grid.update([], 1 / 60, { time: 0 });
  assert.equal(transition.resizeCalls, 1);
  assert.equal(grid.cellState.length, 9);
  assert.ok(grid.cellState.level.every(value => value === 1));
  assert.ok(grid.cellState.scaleX.every(value => value === 1.5));
  assert.ok(grid.cellState.scaleY.every(value => value === 1));
});

test("circle grid keeps three short-side cells when five span the long side", () => {
  const grid = new CircleGrid(
    {
      longSideCells: 5,
      dotMargin: 0,
      palette: "mono",
      fieldRadiusInCells: 1,
      fieldGain: 1,
      riseSeconds: 0,
      fallSeconds: 0,
      showCellGrid: false,
    },
    { mono: ["#000000", "#ffffff"] },
    { updateCell() {} },
    { addPath() {} },
    { width: 1000, height: 400 },
  );

  assert.equal(grid.layout.columns, 5);
  assert.equal(grid.layout.rows, 3);
  assert.equal(grid.layout.patternHeight, 400);
});

test("circle grid forwards transforms around every subdivided glyph", () => {
  const paths = [];
  const transition = {
    updateCell(index, cell, state) {
      state.level[index] = 1;
      state.glyphScaleX[index] = 1.5;
      state.glyphScaleY[index] = 0.25;
      state.glyphScaleAxis[index] = 0.75;
      state.glyphRotation[index] = 0.5;
      state.glyphOffsetX[index] = 4;
      state.glyphOffsetY[index] = 2;
    },
  };
  const renderer = {
    addPath(context, x, y, halfSize, roundness, transform) {
      paths.push({ x, y, halfSize, roundness, ...transform });
    },
  };
  const context = {
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {},
    fill() {},
  };
  const grid = new CircleGrid(
    {
      longSideCells: 3,
      dotMargin: 0,
      palette: "mono",
      fieldRadiusInCells: 1,
      fieldGain: 1,
      riseSeconds: 0,
      fallSeconds: 0,
      showCellGrid: false,
    },
    { mono: ["#000000", "#ffffff"] },
    transition,
    renderer,
    { width: 300, height: 300 },
  );

  grid.update([], 1 / 60, { time: 0 });
  grid.draw(context);
  assert.equal(paths.length, 9 * 4);
  assert.deepEqual(paths.slice(0, 4).map(({ x, y }) => [x, y]), [
    [-25, -25],
    [25, -25],
    [-25, 25],
    [25, 25],
  ]);
  assert.ok(paths.every(path => path.scaleX === 1.5));
  assert.ok(paths.every(path => path.scaleY === 0.25));
  assert.ok(paths.every(path => path.scaleAxis === 0.75));
  assert.ok(paths.every(path => path.rotation === 0.5));
  assert.ok(paths.every(path => path.offsetX === 4));
  assert.ok(paths.every(path => path.offsetY === 2));

  paths.length = 0;
  const footprints = [];
  grid.draw(context, (x, y, radius) => {
    footprints.push({ x, y, radius });
    return x < 100;
  });
  assert.equal(footprints.length, 9 * 4);
  assert.ok(Math.abs(footprints[0].x - 29) < 1e-6);
  assert.ok(Math.abs(footprints[0].y - 27) < 1e-6);
  assert.ok(Math.abs(footprints[0].radius - 37.5) < 1e-6);
  assert.equal(paths.length, 6 * 4);

  grid.cellState.level.fill(3);
  paths.length = 0;
  footprints.length = 0;
  grid.draw(context, (x, y, radius) => {
    footprints.push({ x, y, radius });
    return false;
  });
  assert.equal(footprints.length, 9 * 64);
  assert.ok(Math.abs(footprints[0].radius - 9.375) < 1e-6);
  assert.equal(paths.length, 9 * 64);
});

test("the configured flock composition runs through the complete adapter", () => {
  const context = {
    globalAlpha: 1,
    stack: [],
    save() {
      this.stack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = this.stack.pop();
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    roundRect() {},
    translate() {},
    rotate() {},
    scale() {},
    fill() {},
    stroke() {},
    fillText() {
      this.lastTextAlpha = this.globalAlpha;
    },
  };
  const fakeP5 = {
    createGraphics(width, height) {
      return {
        width,
        height,
        pixels: new Uint8ClampedArray(width * height * 4),
        drawingContext: { save() {}, restore() {}, fillText() {} },
        background() {},
        pixelDensity() {},
        loadPixels() {},
        remove() {},
      };
    },
  };
  const settings = structuredClone(SETTINGS);
  settings.flock.count = 32;
  settings.flock.birthsPerPulse = 8;
  const viewport = { width: 800, height: 600 };
  const runtime = {
    p5: fakeP5,
    viewport: () => viewport,
    context: () => context,
  };
  const catalog = createCatalog({ palettes: PALETTES });
  assert.ok(catalog.cellTransitionTypes.has("none"));
  assert.ok(catalog.cellTransitionTypes.has("sort-selection"));
  assert.ok(catalog.cellTransitionTypes.has("aurora"));
  // One shared pool, with each mode declaring the phases it can run in.
  assert.ok(catalog.sceneTransitionTypes.has("fade"));
  assert.deepEqual(
    catalog.sceneTransitionTypes.namesForPhase("intro"),
    ["fade", "text"],
  );
  assert.deepEqual(
    catalog.sceneTransitionTypes.namesForPhase("outro"),
    ["fade", "text"],
  );
  assert.deepEqual(
    catalog.cellTransitionTypes.namesForPhase("state"),
    ["fade", "sort-selection", "aurora", "none"],
  );
  const compositions = {
    ...COMPOSITION_DEFINITIONS,
    faded: {
      rule: "sequence",
      steps: [{ use: "flockGrid", opacity: 0.2 }],
    },
  };
  const director = new CompositionDirector({
    settings,
    generatorDefinitions: GENERATOR_DEFINITIONS,
    compositionDefinitions: compositions,
    generatorTypes: catalog.generatorTypes,
    compositionRules: catalog.compositionRules,
    runtime,
  });

  director.use("flock");
  director.update({
    dt: 0,
    time: 0,
    frameIndex: 0,
    viewport,
    pointer: { active: false, x: 0, y: 0 },
  });
  const startDuration = director.endpointDurations.start;
  const frame = {
    dt: startDuration + 1 / 60,
    time: startDuration + 1 / 60,
    frameIndex: 1,
    viewport,
    pointer: { active: false, x: 0, y: 0 },
  };
  director.update(frame);
  director.draw(frame);

  const flockGenerator = director.generator("flockGrid");
  const flockIdentity = flockGenerator.flock;
  const boidsIdentity = flockGenerator.flock.boids;
  const state = flockGenerator.inspect();
  assert.ok(state.activeBoids > 0);
  assert.ok(state.grid.meanEnergy > 0);
  assert.equal(
    state.grid.energy.length,
    state.grid.columns * state.grid.rows,
  );
  assert.equal(context.stack.length, 0);

  director.use("faded");
  director.update({ ...frame, frameIndex: 2 });
  director.draw({ ...frame, frameIndex: 2 });
  assert.ok(context.lastTextAlpha <= 0.2);

  viewport.width = 600;
  viewport.height = 800;
  director.resize(viewport);
  const resized = director.generator("flockGrid").inspect().grid;
  assert.equal(resized.energy.length, resized.columns * resized.rows);
  const configuredLongSide = Math.max(
    3,
    Math.round(settings.grid.longSideCells),
  );
  const expectedLongSide = configuredLongSide % 2 === 0
    ? configuredLongSide - 1
    : configuredLongSide;
  assert.equal(resized.rows, expectedLongSide);

  director.use("flock-circles");
  const nextFrame = { ...frame, frameIndex: 3, viewport };
  director.update(nextFrame);
  director.draw(nextFrame);
  assert.equal(director.currentCompositionName, "flock-circles");
  assert.equal(director.generator("flockGrid"), flockGenerator);
  const circles = director.generator("flockGrid").inspect().grid.cellState;
  assert.ok(circles.roundness.every(value => value === 1));

  viewport.width = 900;
  viewport.height = 500;
  director.resize(viewport);
  const resizedCircles = flockGenerator.inspect().grid.cellState;
  assert.equal(
    resizedCircles.length,
    flockGenerator.inspect().grid.rows * flockGenerator.inspect().grid.columns,
  );
  assert.ok(resizedCircles.roundness.every(value => value === 1));

  director.use("flock");
  director.update({ ...frame, frameIndex: 4, viewport });
  assert.equal(director.currentCompositionName, "flock");
  assert.ok(flockGenerator.grid.cellTransition instanceof NoneTransition);
  assert.equal(director.generator("flockGrid"), flockGenerator);
  assert.equal(flockGenerator.flock, flockIdentity);
  assert.equal(flockGenerator.flock.boids, boidsIdentity);
  director.dispose();
});
