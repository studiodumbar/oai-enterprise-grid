// Flicker scope invariants.
//
// `flicker.scope` decides where a mode's field is addressed: "canvas" spans the
// whole board so a cell shows only its own slice of the pattern, "cell" restarts
// the field inside every cell so every cell plays the whole pattern.
//
// The failure this file exists to catch is a renderer that reads the field with
// canvas coordinates but still normalizes each cell against itself. Rank spread
// does exactly that: it hands a cell's dots the palette in sample order, so
// every cell ends up with the same even spread wherever it sits in the board's
// pattern. The dots still flicker and every swatch still appears, so nothing
// looks broken from a screenshot — the board-wide structure is simply gone, and
// canvas scope renders as cell scope with extra steps.
//
// Everything here is pinned: fixtures never read the authored composition
// settings, so tuning config/ cannot make these pass or fail.

import test from "node:test";
import assert from "node:assert/strict";

import {
  FlickerModeRegistry,
  NOISE_FLICKER_MODE,
  createFlicker,
} from "../src/visuals/flicker/index.js";
import {
  BASE_CELL_LEVELS,
  BaseCompositionGenerator,
} from "../src/generators/base-composition-generator.js";
import {
  DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS,
  ProceduralTopologyGenerator,
} from "../src/generators/procedural-topology-generator.js";
import { MAX_GRID_FACE_LEVEL } from "../src/generators/grid-scene-strategies.js";

const PALETTE = ["#005122", "#008a3a", "#00b63c", "#7fd3a5"];
const PALETTES = { green: PALETTE };
const LANDSCAPE = Object.freeze({ width: 900, height: 600 });

// One full ramp every three parent cells, in finest-subdivision units. Short
// enough that neighboring cells read visibly different parts of the field, so a
// cell-vs-board coordinate mix-up shows up as a value difference rather than
// hiding inside one flat stretch.
const RAMP_PERIOD = 3 * (1 << MAX_GRID_FACE_LEVEL);
// noise-mode adds a constant to every axis before it calls the noise function.
// Subtracting it back out keeps the fixture a plain left-to-right sawtooth in
// board coordinates instead of an arbitrary phase of one.
const NOISE_OFFSET_X = 17.173;

function rampNoise(x) {
  const position = (x - NOISE_OFFSET_X) / RAMP_PERIOD;
  return position - Math.floor(position);
}

// Distribution "rank" is not carried by any shipped mode; this fixture pins the
// predicate for an author who asks for the spread explicitly.
const RANK_MODE = Object.freeze({
  name: "rank-fixture",
  distribution: "rank",
  defaults: Object.freeze({}),
  createField() {
    return { sampleAt: x => rampNoise(x) };
  },
});

function fixtureModes() {
  return new FlickerModeRegistry()
    .register(NOISE_FLICKER_MODE)
    .register(RANK_MODE);
}

function fixtureFlicker(scope, mode = "noise") {
  return createFlicker({
    palette: PALETTE,
    modes: fixtureModes(),
    settings: {
      enabled: true,
      mode,
      scope,
      amount: 1,
      cellStaggerSeconds: 0,
      modes: { noise: { speed: 0, spatialScale: 1 } },
    },
    noiseFunction: rampNoise,
    grid: { columns: 8, rows: 8, dotsPerCellAxis: 1 << MAX_GRID_FACE_LEVEL },
  });
}

function baseGenerator(scope) {
  return new BaseCompositionGenerator({
    name: "scopeFixtureBase",
    settingsKey: "scopeFixtureBase",
    options: {
      dotMargin: 0.07,
      previewSeconds: 2,
      previewRepeats: 1,
      palette: "green",
      // The cycle-boundary phases are irrelevant here and would only consume
      // timeline the assertions do not read.
      intro: { enabled: false },
      outro: { enabled: false },
      flicker: {
        enabled: true,
        mode: "noise",
        scope,
        amount: 1,
        cellStaggerSeconds: 0,
        modes: { noise: { speed: 0, spatialScale: 1 } },
      },
    },
    runtime: {
      viewport: () => LANDSCAPE,
      p5: { noise: rampNoise },
    },
    palettes: PALETTES,
  });
}

function voronoiGenerator(scope) {
  return new ProceduralTopologyGenerator({
    name: "scopeFixtureVoronoi",
    definition: {
      type: "procedural-topology",
      settingsKey: "scopeFixtureVoronoi",
      strategy: "voronoi",
    },
    settingsKey: "scopeFixtureVoronoi",
    options: {
      ...DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS,
      strategy: "voronoi",
      longSideCells: 12,
      palette: "green",
      intro: { enabled: false },
      outro: { enabled: false },
      flicker: {
        enabled: true,
        mode: "noise",
        scope,
        amount: 1,
        cellStaggerSeconds: 0,
        modes: { noise: { speed: 0, spatialScale: 1 } },
      },
    },
    runtime: {
      viewport: () => LANDSCAPE,
      p5: { noise: rampNoise },
    },
    palettes: PALETTES,
  });
}

function recordingContext() {
  const glyphs = [];
  const alphaStack = [];
  let pending = null;
  return {
    glyphs,
    globalAlpha: 1,
    fillStyle: "",
    save() {
      alphaStack.push(this.globalAlpha);
    },
    restore() {
      this.globalAlpha = alphaStack.pop();
    },
    beginPath() {},
    moveTo() {},
    translate() {},
    rotate() {},
    scale() {},
    roundRect() {},
    arc(x, y) {
      pending = { x, y };
    },
    fill() {
      if (!pending) return;
      glyphs.push({ ...pending, color: this.fillStyle });
      pending = null;
    },
  };
}

/** How many dots each swatch got, in palette order. */
function histogram(colors, paletteColors) {
  return paletteColors.map(color => colors.filter(drawn => drawn === color).length);
}

function isEvenSpread(counts) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const share = total / counts.length;
  return Number.isInteger(share) && counts.every(count => count === share);
}

test("rank spread is a cell-scope operation, whatever the mode asks for", () => {
  const glyphs = 1 << (MAX_GRID_FACE_LEVEL * 2);

  const cellAuto = fixtureFlicker("cell");
  assert.equal(cellAuto.distribution, "auto");
  assert.equal(cellAuto.spreadsRankAcrossCell(glyphs), true);
  // "auto" spreads only while a cell has at least one dot per swatch; below that
  // the spread would leave swatches unreachable rather than sample them.
  assert.equal(cellAuto.spreadsRankAcrossCell(PALETTE.length), true);
  assert.equal(cellAuto.spreadsRankAcrossCell(PALETTE.length - 1), false);

  // Canvas scope refuses the spread at every glyph count, and refuses it even
  // when the mode declares "rank" outright: re-normalizing a cell against itself
  // is what erases the board-wide field.
  const canvasAuto = fixtureFlicker("canvas");
  assert.equal(canvasAuto.spreadsRankAcrossCell(glyphs), false);
  assert.equal(canvasAuto.spreadsRankAcrossCell(1), false);

  const canvasRank = fixtureFlicker("canvas", "rank-fixture");
  assert.equal(canvasRank.distribution, "rank");
  assert.equal(canvasRank.spreadsRankAcrossCell(glyphs), false);
  assert.equal(fixtureFlicker("cell", "rank-fixture").spreadsRankAcrossCell(1), true);
});

test("canvas scope colors a cell from where it sits on the board", () => {
  const generator = baseGenerator("canvas");
  const level = 3;
  const cells = BASE_CELL_LEVELS.map(
    (_, index) => [...generator.paletteIndicesForCell(index, level)],
  );

  // Two cells at different columns read different parts of the ramp, so they
  // cannot come out identical. Under a per-cell normalization they would.
  assert.notDeepEqual(cells[0], cells.at(-1));
  const distinct = new Set(cells.map(indices => indices.join(",")));
  assert.ok(
    distinct.size > 1,
    `every cell drew the same palette layout: ${[...distinct]}`,
  );

  // The sharper signature of the bug: a per-cell spread hands every cell exactly
  // glyphCount / paletteCount dots of each swatch. A board-wide field does not.
  const counts = cells.map(indices => (
    PALETTE.map((_, swatch) => indices.filter(index => index === swatch).length)
  ));
  assert.ok(
    counts.some(cell => !isEvenSpread(cell)),
    `every cell spread the palette evenly: ${JSON.stringify(counts)}`,
  );
});

test("cell scope repeats one pattern identically in every cell", () => {
  const generator = baseGenerator("cell");
  const level = 3;
  const cells = BASE_CELL_LEVELS.map(
    (_, index) => [...generator.paletteIndicesForCell(index, level)],
  );

  // The documented cell-scope contract, and the behavior canvas scope must not
  // reproduce: with the stagger at zero every cell plays the same local field.
  for (const indices of cells.slice(1)) {
    assert.deepEqual(indices, cells[0]);
  }
});

test("the circle-grid draw path honors canvas scope per cell position", () => {
  const generator = voronoiGenerator("canvas");
  generator.enter();
  generator.update({ compositionDt: DEFAULT_PROCEDURAL_TOPOLOGY_OPTIONS.cycleSeconds * 0.25 });
  generator.paletteMotionTime = 0;

  const inspection = generator.inspect();
  const motionIndices = inspection.paletteMotion?.indices ?? [];
  assert.ok(motionIndices.length > 1, "fixture drew no palette-motion cells");

  // Group by the two things that decide a cell's colors apart from its position:
  // how many dots it holds and which palette step it starts from. Cells that
  // agree on both must still differ, because they sit at different columns.
  const byShape = new Map();
  for (const index of motionIndices) {
    const face = generator.currentFaces[index];
    if (face.level < 1) continue;
    const context = recordingContext();
    generator.drawFace(context, index, face, 1);
    const key = `${face.level}:${face.paletteStep}`;
    if (!byShape.has(key)) byShape.set(key, []);
    byShape.get(key).push({
      index,
      counts: histogram(context.glyphs.map(glyph => glyph.color), generator.paletteColors),
    });
  }

  const comparable = [...byShape.values()].filter(group => group.length > 1);
  assert.ok(comparable.length > 0, "fixture produced no comparable cells");
  for (const group of comparable) {
    const layouts = new Set(group.map(cell => cell.counts.join(",")));
    assert.ok(
      layouts.size > 1,
      `cells ${group.map(cell => cell.index).join(", ")} drew one identical `
      + `palette split under canvas scope: ${[...layouts]}`,
    );
  }
  generator.dispose();
});

test("the composition-endpoint frame samples the field in the same units as the scene", () => {
  const generator = voronoiGenerator("canvas");
  const finest = 1 << MAX_GRID_FACE_LEVEL;
  const level = 2;
  const subdivisions = 1 << level;
  const coordinateStep = finest / subdivisions;
  // A cell several columns and rows in, so a coordinate expressed in parent-cell
  // units instead of finest-subdivision units lands nowhere near the right place.
  const cellIndex = 3 * generator.layout.columns + 5;

  const sampled = [];
  const field = generator.flicker;
  const realSampleAt = field.sampleAt.bind(field);
  field.sampleAt = (x, y, time) => {
    sampled.push({ x, y });
    return realSampleAt(x, y, time);
  };

  generator.drawCompositionEndpointFrame(recordingContext(), {
    layout: generator.layout,
    cells: [{ index: cellIndex, level }],
    paletteStep: 2,
    flicker: true,
    flickerAmount: 1,
  });

  assert.equal(sampled.length, subdivisions * subdivisions);
  // The scene draw's own convention, which the endpoint frame has to match or
  // the field changes spatial scale the moment the endpoint takes over.
  const originX = generator.flickerOriginX(cellIndex, coordinateStep);
  const originY = generator.flickerOriginY(cellIndex, coordinateStep);
  const expected = [];
  for (let glyph = 0; glyph < subdivisions * subdivisions; glyph += 1) {
    expected.push({
      x: originX + (glyph % subdivisions) * coordinateStep,
      y: originY + Math.floor(glyph / subdivisions) * coordinateStep,
    });
  }
  assert.deepEqual(sampled, expected);
  generator.dispose();
});

test("the composition-endpoint frame maps per-glyph loader steps through its palette", () => {
  const generator = voronoiGenerator("canvas");
  const context = recordingContext();
  const paletteSteps = [
    0, 1, 2, 3,
    1, 2, 3, 0,
    2, 3, 0, 1,
    3, 0, 1, 2,
  ];

  generator.drawCompositionEndpointFrame(context, {
    layout: generator.layout,
    cells: [{ index: 0, level: 2, paletteSteps }],
    paletteStep: 3,
    flicker: false,
    flickerAmount: 0,
  });

  assert.equal(context.glyphs.length, 16);
  assert.deepEqual(
    histogram(context.glyphs.map(glyph => glyph.color), generator.paletteColors),
    [4, 4, 4, 4],
  );
  assert.throws(
    () => generator.drawCompositionEndpointFrame(recordingContext(), {
      layout: generator.layout,
      cells: [{ index: 0, level: 2, paletteSteps: [0] }],
      paletteStep: 3,
      flicker: false,
      flickerAmount: 0,
    }),
    /needs 16 palette steps; received 1/,
  );
  generator.dispose();
});

test("custom endpoint preparation draws only in the body and hands off to the end", () => {
  const generator = voronoiGenerator("canvas");
  const preparationInputs = [];
  const endInputs = [];
  generator.endCompositionEndpoint = {
    reset() {},
    preparationFrameAt(input) {
      preparationInputs.push(input);
      return {
        layout: input.layout,
        cells: [{ index: 0, level: 2 }],
        paletteStep: 2,
        flicker: false,
        flickerAmount: 0,
      };
    },
    frameAt(input) {
      endInputs.push(input);
      return {
        layout: input.layout,
        cells: [{ index: 0, level: 0 }],
        paletteStep: 2,
        flicker: false,
        flickerAmount: 0,
      };
    },
  };
  generator.scene = { endpointPreparationProgress: 0.5 };

  const bodyContext = recordingContext();
  generator.draw({ time: 1 }, {}, bodyContext);
  assert.equal(preparationInputs.length, 1);
  assert.equal(preparationInputs[0].progress, 0.5);
  assert.equal(preparationInputs[0].scene, generator.scene);
  assert.equal(bodyContext.glyphs.length, 16);

  const startContext = recordingContext();
  generator.draw({
    compositionEndpoint: {
      phase: "start",
      cycleIndex: 0,
      progress: 0.5,
      durationSeconds: 2,
    },
  }, {}, startContext);
  assert.equal(preparationInputs.length, 1);
  assert.equal(endInputs.length, 0);
  assert.equal(startContext.glyphs.length, 0);

  const endContext = recordingContext();
  generator.draw({
    compositionEndpoint: {
      phase: "end",
      cycleIndex: 0,
      progress: 0,
      durationSeconds: 2,
    },
  }, {}, endContext);
  assert.equal(preparationInputs.length, 1);
  assert.equal(endInputs.length, 1);
  assert.equal(endInputs[0].progress, 0);
  assert.equal(endInputs[0].scene, generator.scene);
  assert.equal(endContext.glyphs.length, 1);
  generator.dispose();
});
