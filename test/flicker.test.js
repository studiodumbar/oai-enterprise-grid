import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_CONFIG } from "../config/global.js";
import { SETTINGS } from "../config.js";
import {
  CellularAutomataGenerator,
} from "../src/generators/cellular-automata-generator.js";
import {
  BLOCK_DROP_FLICKER_MODE,
  CRT_GLIDE_FLICKER_MODE,
  ECHO_RING_FLICKER_DEFAULTS,
  ECHO_RING_FLICKER_MODE,
  EchoRingFlickerField,
  FlickerController,
  FlickerModeRegistry,
  NOISE_FLICKER_MODE,
  PRISM_BLOOM_FLICKER_MODE,
  RADAR_ARC_FLICKER_MODE,
  STROBE_STACK_FLICKER_MODE,
  echoRingIntensityAt,
  createFlicker,
  flickerModes,
  flickerSettingsFromOptions,
  mergeFlickerSettings,
  resolveFlicker,
} from "../src/visuals/flicker/index.js";

const GREEN = ["#005122", "#008a3a", "#00b63c", "#7fd3a5"];

// A second mode exists only in these tests: it proves the interface carries a
// field that owns unrelated settings and reads absolute values instead of noise.
const SWEEP_MODE = Object.freeze({
  name: "sweep",
  distribution: "value",
  defaults: Object.freeze({ columnsPerSecond: 2, softness: 0.25 }),
  normalize(settings) {
    const normalized = { ...SWEEP_MODE.defaults, ...settings };
    if (!Number.isFinite(normalized.columnsPerSecond)) {
      throw new TypeError("columnsPerSecond must be finite.");
    }
    return normalized;
  },
  createField({ settings, grid }) {
    return {
      grid,
      frames: 0,
      resize(nextGrid) {
        this.grid = nextGrid;
      },
      beginFrame() {
        this.frames += 1;
      },
      sampleAt(x, y, time) {
        const columns = this.grid?.columns ?? 1;
        const front = (time * settings.columnsPerSecond) % columns;
        return Math.max(0, 1 - Math.abs(x - front) * settings.softness);
      },
    };
  },
});

function registryWithSweep() {
  return new FlickerModeRegistry()
    .register(NOISE_FLICKER_MODE)
    .register(SWEEP_MODE);
}

test("flicker mode registry rejects bad descriptors and explains unknown names", () => {
  const registry = registryWithSweep();
  assert.deepEqual(registry.list(), ["noise", "sweep"]);
  assert.equal(registry.has("noise"), true);
  assert.equal(registry.has("ripple"), false);

  assert.throws(() => registry.register(NOISE_FLICKER_MODE), /already registered/);
  assert.throws(() => registry.get("ripple"), /Unknown flicker mode "ripple".*noise, sweep/);
  assert.throws(
    () => new FlickerModeRegistry().register({ name: "broken" }),
    /must provide createField/,
  );
  assert.throws(
    () => new FlickerModeRegistry().register({
      name: "broken",
      createField: () => ({}),
      distribution: "sideways",
    }),
    /distribution must be one of auto, rank, value/,
  );
});

test("global flicker defaults fill in whatever a composition leaves unauthored", () => {
  const resolved = resolveFlicker(mergeFlickerSettings(
    GLOBAL_CONFIG.flicker,
    { amount: 0.42, modes: { noise: { speed: 9 } } },
  ), undefined, { autoCycleSeconds: 2 });

  assert.equal(resolved.enabled, GLOBAL_CONFIG.flicker.enabled);
  assert.equal(resolved.mode, GLOBAL_CONFIG.flicker.mode);
  assert.equal(resolved.scope, GLOBAL_CONFIG.flicker.scope);
  assert.equal(resolved.amount, 0.42);
  assert.equal(resolved.modes.noise.speed, 9);
  // The unauthored half of the mode still comes from the global block.
  assert.equal(
    resolved.modes.noise.spatialScale,
    GLOBAL_CONFIG.flicker.modes.noise.spatialScale,
  );
  // Resolving twice is a no-op, so options normalization can hand the same
  // object to the renderer.
  assert.strictEqual(resolveFlicker(resolved), resolved);
});

test("every registered mode is resolved up front so a runtime swap cannot fail", () => {
  const registry = registryWithSweep();
  const resolved = resolveFlicker({
    enabled: true,
    mode: "noise",
    modes: { sweep: { columnsPerSecond: 5 } },
  }, registry);

  assert.equal(resolved.modeSettings.speed, NOISE_FLICKER_MODE.defaults.speed);
  assert.equal(resolved.modes.sweep.columnsPerSecond, 5);
  assert.equal(resolved.modes.sweep.softness, SWEEP_MODE.defaults.softness);

  assert.throws(
    () => resolveFlicker({ mode: "ripple" }, registry),
    /Unknown flicker mode "ripple"/,
  );
  assert.throws(
    () => resolveFlicker({ modes: { ripple: {} } }, registry),
    /Unknown flicker mode "ripple"/,
  );
  assert.throws(
    () => resolveFlicker({ mode: "sweep", modes: { sweep: { columnsPerSecond: "fast" } } }, registry),
    /columnsPerSecond must be finite/,
  );
  assert.throws(() => resolveFlicker({ amount: 1.5 }), /amount must be between zero and one/);
  assert.throws(() => resolveFlicker({ enabled: "yes" }), /enabled must be a boolean/);
  assert.throws(
    () => resolveFlicker({ modes: { noise: { spatialScale: 0 } } }),
    /spatialScale must be greater than zero/,
  );
});

test("a legacy per-composition flicker block migrates into mode and envelope", () => {
  const migrated = flickerSettingsFromOptions({
    layerFlicker: {
      enabled: true,
      speed: 25,
      spatialScale: 3,
      amount: 0.88,
      layerEdgeFraction: 0.5,
      terminalRampFraction: 0.94,
    },
  });

  assert.equal(migrated.mode, "noise");
  assert.deepEqual(migrated.modes.noise, { speed: 25, spatialScale: 3 });
  assert.deepEqual(migrated.envelope, {
    layerEdgeFraction: 0.5,
    terminalRampFraction: 0.94,
  });

  const resolved = resolveFlicker(migrated);
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.amount, 0.88);
  assert.equal(resolved.modeSettings.speed, 25);

  // The canonical block wins whenever both shapes are present.
  assert.deepEqual(
    flickerSettingsFromOptions({ flicker: { amount: 0.1 }, layerFlicker: { amount: 1 } }),
    { amount: 0.1 },
  );
  assert.deepEqual(flickerSettingsFromOptions({}), {});
});

test("swapping modes changes the field while palette snapping stays shared", () => {
  const controller = new FlickerController({
    palette: GREEN,
    settings: {
      enabled: true,
      mode: "noise",
      amount: 1,
      modes: { sweep: { columnsPerSecond: 1, softness: 0.5 } },
    },
    modes: registryWithSweep(),
    grid: { columns: 8, rows: 6, cellSize: 100, dotsPerCellAxis: 8 },
  });

  assert.deepEqual(controller.availableModes(), ["noise", "sweep"]);
  assert.equal(controller.modeName, "noise");
  assert.equal(controller.distribution, "auto");
  const noiseSample = controller.sampleAt(3, 4, 1.5);
  // Deterministic: the same dot and time always returns the same sample.
  assert.equal(controller.sampleAt(3, 4, 1.5), noiseSample);

  controller.useMode("sweep");
  assert.equal(controller.modeName, "sweep");
  assert.equal(controller.distribution, "value");
  assert.equal(controller.sampleAt(1, 0, 1), 1);
  assert.equal(controller.sampleAt(3, 0, 1), 0);
  assert.notEqual(controller.sampleAt(3, 4, 1.5), noiseSample);

  controller.resize({ columns: 4, rows: 4, cellSize: 50, dotsPerCellAxis: 8 });
  assert.equal(controller.field.grid.columns, 4);
  controller.beginFrame({ time: 0, progress: 0, cycleIndex: 0 });
  assert.equal(controller.field.frames, 1);

  // Whatever the mode returns, a dot still lands on one authored swatch.
  const swatches = new Set([
    "rgb(0 81 34)",
    "rgb(0 138 58)",
    "rgb(0 182 60)",
    "rgb(127 211 165)",
  ]);
  for (let sample = 0; sample <= 1; sample += 0.05) {
    assert.ok(swatches.has(controller.colorFromNoise(0.5, sample)));
    assert.ok(swatches.has(controller.colorFromSample(0.5, sample)));
  }
});

test("echo ring pulses concentric diamond rings with an odd-ring echo lag", () => {
  const settings = ECHO_RING_FLICKER_MODE.normalize({ ringCount: 5 });
  const grid = { columns: 8, rows: 6, cellSize: 100, dotsPerCellAxis: 8 };
  const field = new EchoRingFlickerField(settings, grid);
  const centerX = 8 * 8 * 0.5;
  const centerY = 6 * 8 * 0.5;

  // Rings are Manhattan bands around the field center, and `ringCount` bands
  // always span the field regardless of how many dots wide it is.
  assert.equal(field.ringAt(centerX, centerY), 0);
  assert.equal(field.ringAt(centerX + field.ringWidth * 1.5, centerY), 1);
  assert.equal(field.ringAt(0, 0), settings.ringCount - 1);
  assert.equal(field.ringAt(centerX * 2, centerY * 2), settings.ringCount - 1);
  // A diamond, not a square: equal Manhattan distance means the same ring.
  assert.equal(field.ringAt(centerX + 16, centerY), field.ringAt(centerX, centerY + 16));

  // Regression: a one-cell field is what cell scope hands the mode. It must
  // still resolve into every ring, or the whole cell pulses as one flat block.
  const cellField = new EchoRingFlickerField(settings, {
    columns: 1,
    rows: 1,
    cellSize: 100,
    dotsPerCellAxis: 8,
  });
  const ringsInCell = new Set();
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      ringsInCell.add(cellField.ringAt(column + 0.5, row + 0.5));
    }
  }
  assert.deepEqual([...ringsInCell].sort(), [0, 1, 2, 3, 4]);
  assert.equal(cellField.ringAt(3.5, 3.5), 0);
  assert.equal(cellField.ringAt(0.5, 0.5), 4);

  // Waveform keyframes resolved from the loader's opacity tokens.
  assert.ok(Math.abs(echoRingIntensityAt(0) - 0.1) < 1e-9);
  assert.ok(Math.abs(echoRingIntensityAt(0.28) - 0.98) < 1e-9);
  assert.ok(Math.abs(echoRingIntensityAt(0.56) - 0.32) < 1e-9);
  assert.ok(Math.abs(echoRingIntensityAt(0.78) - 0.7824) < 1e-9);
  assert.ok(Math.abs(echoRingIntensityAt(1) - 0.1) < 1e-9);
  // Phase wraps, so a ring delayed past one cycle still reads its own pulse.
  assert.equal(echoRingIntensityAt(2.28), echoRingIntensityAt(0.28));
  assert.equal(echoRingIntensityAt(-0.72), echoRingIntensityAt(0.28));
  for (let phase = 0; phase <= 1; phase += 0.01) {
    const intensity = echoRingIntensityAt(phase);
    assert.ok(intensity >= 0 && intensity <= 1, `intensity ${intensity} left 0..1`);
  }

  // Each ring lags 0.14 of a cycle, and odd rings lag 0.03 more.
  const { cycleSeconds, ringDelayFraction, echoDelayFraction } = settings;
  const sampleForRing = (ring, phase) => field.sampleAt(
    centerX + (ring + 0.5) * field.ringWidth,
    centerY,
    (phase + ring * ringDelayFraction + (ring % 2) * echoDelayFraction) * cycleSeconds,
  );
  for (const ring of [0, 1, 2, 3]) {
    assert.equal(field.ringAt(centerX + (ring + 0.5) * field.ringWidth, centerY), ring);
    assert.ok(Math.abs(sampleForRing(ring, 0.28) - 0.98) < 1e-9);
  }
  const peakTime = 0.28 * cycleSeconds;
  assert.ok(field.sampleAt(centerX, centerY, peakTime) > 0.9);
  // The next ring has not peaked yet at that moment: the ripple travels.
  assert.ok(field.sampleAt(centerX + field.ringWidth * 1.5, centerY, peakTime) < 0.9);

  // Deterministic, and the field follows a resize.
  assert.equal(field.sampleAt(3, 4, 1.5), field.sampleAt(3, 4, 1.5));
  field.resize({ columns: 4, rows: 4, cellSize: 50, dotsPerCellAxis: 8 });
  assert.equal(field.centerX, 16);
  assert.equal(field.centerY, 16);

  assert.equal(ECHO_RING_FLICKER_MODE.distribution, "level");
  assert.equal(ECHO_RING_FLICKER_DEFAULTS.ringCount, 5);
  assert.throws(
    () => ECHO_RING_FLICKER_MODE.normalize({ cycleSeconds: 0 }),
    /cycleSeconds must be greater than zero/,
  );
  assert.throws(
    () => ECHO_RING_FLICKER_MODE.normalize({ ringDelayFraction: 1.4 }),
    /ringDelayFraction must be between zero and one/,
  );
  assert.throws(
    () => ECHO_RING_FLICKER_MODE.normalize({ ringCount: 0 }),
    /ringCount must be an integer of at least one/,
  );
  assert.throws(
    () => ECHO_RING_FLICKER_MODE.normalize({ ringCount: 2.5 }),
    /ringCount must be an integer of at least one/,
  );
});

test("a level field maps its sample straight onto the palette", () => {
  const controller = createFlicker({
    palette: GREEN,
    settings: { enabled: true, mode: "echo-ring", amount: 1 },
    grid: { columns: 8, rows: 6, cellSize: 100, dotsPerCellAxis: 8 },
  });

  assert.equal(controller.distribution, "level");
  // With full amount the swatch follows the sample monotonically, which a
  // banded mapping would scramble.
  const swatchAt = sample => controller.paletteIndexFromSample(0, sample, 1);
  assert.equal(swatchAt(0), 0);
  assert.equal(swatchAt(1), GREEN.length - 1);
  let previous = -1;
  for (let sample = 0; sample <= 1; sample += 0.02) {
    const swatch = swatchAt(sample);
    assert.ok(swatch >= previous, "level mapping must not step backward");
    previous = swatch;
  }
});

test("scope decides whether the pattern spans the board or repeats per cell", () => {
  assert.equal(resolveFlicker({}).scope, "canvas");
  assert.equal(resolveFlicker({ scope: "cell" }).scope, "cell");
  assert.throws(
    () => resolveFlicker({ scope: "grid" }),
    /flicker.scope must be one of canvas, cell/,
  );
  // A composition overrides the global scope like any other flicker key.
  assert.equal(
    resolveFlicker(mergeFlickerSettings(
      { ...GLOBAL_CONFIG.flicker, scope: "canvas" },
      { scope: "cell" },
    ), undefined, { autoCycleSeconds: 2 }).scope,
    "cell",
  );

  // Render one composition under each scope and compare cells against each
  // other. Cell scope reads the same local field in every cell, so only the
  // per-cell stagger keeps them out of step; canvas scope differs by position.
  const fillsByCellFor = (scope, cellStaggerSeconds = 0) => {
    const settings = structuredClone(SETTINGS);
    for (const group of Object.values(settings)) {
      if (group?.flicker !== undefined) {
        group.flicker.mode = "echo-ring";
        group.flicker.scope = scope;
        group.flicker.amount = 1;
        group.flicker.cellStaggerSeconds = cellStaggerSeconds;
      }
    }
    const generator = new CellularAutomataGenerator({
      name: "scopeTestGenerator",
      definition: {
        type: "cellular-automata",
        settingsKey: "gameOfLife",
        strategy: "life-like",
      },
      settingsKey: "gameOfLife",
      // Pinned to the fixture below, whatever the composition currently
      // authors: the swatches, and the grid the assertions count cells in.
      options: {
        ...settings.gameOfLife,
        palette: "green",
        longSideCells: 8,
        timing: { bodyDurationSeconds: 3, beatCount: 6 },
        cycleSeconds: 3,
        generationsPerCycle: 6,
      },
      runtime: { viewport: () => ({ width: 900, height: 600 }) },
      palettes: { green: GREEN },
    });
    generator.enter();
    // Land mid-generation, where newly born cells are at full flicker strength.
    generator.update({
      compositionDt: (generator.intro.settings.enabled
        ? generator.intro.settings.durationSeconds
        : 0)
        + generator.options.cycleSeconds * 0.25,
    });
    generator.paletteMotionTime = 0.37;

    const byCell = new Map();
    for (const index of generator.scene.paletteMotion.indices) {
      const face = generator.currentFaces[index];
      if (face.level < 1) continue;
      const fills = [];
      const context = {
        globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, moveTo() {}, arc() {},
        fill() { fills.push(this.fillStyle); },
      };
      generator.drawFace(context, index, face, 1);
      byCell.set(index, fills.join("|"));
    }
    return byCell;
  };

  const cellScoped = fillsByCellFor("cell");
  const canvasScoped = fillsByCellFor("canvas");
  const staggered = fillsByCellFor("cell", 0.9);
  assert.ok(cellScoped.size > 1, "needed several flickering cells to compare");
  // Zero stagger is the one case where every cell is expected to match.
  assert.equal(new Set(cellScoped.values()).size, 1);
  assert.ok(new Set(canvasScoped.values()).size > 1);
  // A stagger must break that unison, which is the whole point of the setting.
  assert.ok(
    new Set(staggered.values()).size > 1,
    "cellStaggerSeconds must desynchronize cells",
  );

  assert.equal(resolveFlicker({}).cellStaggerSeconds, 0.9);
  assert.equal(resolveFlicker({ cellStaggerSeconds: 0 }).cellStaggerSeconds, 0);
  assert.throws(
    () => resolveFlicker({ cellStaggerSeconds: -1 }),
    /cellStaggerSeconds must be greater than or equal to zero/,
  );
});

test("a cell-scoped cell resolves into every ring instead of one flat block", () => {
  // The bug this pins: with a fixed ring width a whole cell fell into ring 0, so
  // every dot shared one phase and the cell flickered as a single block.
  const generator = new CellularAutomataGenerator({
    name: "ringScopeTestGenerator",
    definition: {
      type: "cellular-automata",
      settingsKey: "gameOfLife",
      strategy: "life-like",
    },
    settingsKey: "gameOfLife",
    options: {
      ...SETTINGS.gameOfLife,
      // Pinned to the fixture below, whatever the composition currently
      // authors: the swatches, and the grid the assertions count rings in.
      palette: "green",
      longSideCells: 8,
      timing: { bodyDurationSeconds: 3, beatCount: 6 },
      cycleSeconds: 3,
      generationsPerCycle: 6,
      flicker: {
        ...SETTINGS.gameOfLife.flicker,
        mode: "echo-ring",
        scope: "cell",
        amount: 1,
        cellStaggerSeconds: 0,
      },
    },
    runtime: { viewport: () => ({ width: 900, height: 600 }) },
    palettes: { green: GREEN },
  });
  generator.enter();
  generator.update({
    compositionDt: (generator.intro.settings.enabled
      ? generator.intro.settings.durationSeconds
      : 0)
      + generator.options.cycleSeconds * 0.25,
  });

  const index = generator.scene.paletteMotion.indices.find(
    candidate => generator.currentFaces[candidate].level >= 2,
  );
  assert.ok(index !== undefined, "needed a subdivided flickering cell");

  const colorsAcrossTime = new Set();
  let maximumColorsInOneFrame = 0;
  for (let step = 0; step < 24; step += 1) {
    generator.paletteMotionTime = step * 0.05;
    const fills = [];
    generator.drawFace(
      {
        globalAlpha: 1,
        save() {}, restore() {}, beginPath() {}, moveTo() {}, arc() {},
        fill() { fills.push(this.fillStyle); },
      },
      index,
      generator.currentFaces[index],
      1,
    );
    const distinct = new Set(fills);
    maximumColorsInOneFrame = Math.max(maximumColorsInOneFrame, distinct.size);
    for (const color of distinct) colorsAcrossTime.add(color);
  }

  // Rings inside the cell resolve to different swatches at the same instant.
  assert.ok(
    maximumColorsInOneFrame > 1,
    `cell drew ${maximumColorsInOneFrame} color(s) at once; rings collapsed`,
  );
  assert.ok(colorsAcrossTime.size > 2);
});

// Every ported loader is authored on a 5x5 matrix, so these read a mode's field
// back as a 5x5 intensity grid to compare against the loader's own motif.
const MATRIX_GRID = Object.freeze({
  columns: 5,
  rows: 5,
  cellSize: 100,
  dotsPerCellAxis: 1,
});

function intensityGrid(field, time, size = 5) {
  return Array.from({ length: size }, (unusedRow, row) => Array.from(
    { length: size },
    (unusedColumn, column) => field.sampleAt(column + 0.5, row + 0.5, time),
  ));
}

function fieldFor(mode, settings = {}, grid = MATRIX_GRID) {
  return mode.createField({ settings: mode.normalize(settings), grid });
}

test("strobe stack fills columns on a stagger, blinks twice, then drains", () => {
  const mode = STROBE_STACK_FLICKER_MODE;
  const settings = mode.normalize({});
  const field = fieldFor(mode, {});
  // 10 fill ticks, 4 blink ticks, 10 drain ticks.
  assert.equal(field.stepCount, 24);
  const tick = settings.cycleSeconds / field.stepCount;
  const at = step => intensityGrid(field, (step + 0.5) * tick);
  const litColumns = grid => grid[4].filter(value => value > settings.baseIntensity).length;

  // Column 0 lights first; later columns trail it by one tick each.
  assert.ok(at(1)[4][0] > settings.baseIntensity);
  assert.equal(at(1)[4][1], settings.baseIntensity);
  assert.ok(at(2)[4][1] > settings.baseIntensity);
  assert.ok(litColumns(at(3)) > litColumns(at(2)));

  // A partly filled column keeps a brighter cap on its leading dot.
  const filling = at(4);
  const capRow = filling.findIndex(row => row[0] > settings.baseIntensity);
  assert.ok(capRow > 0, "column 0 should be partly filled at this tick");
  assert.ok(filling[capRow][0] > filling[capRow + 1][0]);

  // Once every column is full the whole field blinks as one, twice.
  const blinkValues = [10, 11, 12, 13].map(step => at(step)[0][0]);
  assert.deepEqual(blinkValues, [0.38, 1, 0.38, 1]);
  for (const step of [10, 11, 12, 13]) {
    assert.equal(new Set(at(step).flat()).size, 1);
  }

  // Draining empties from the bottom column-by-column, same stagger.
  assert.ok(litColumns(at(20)) < litColumns(at(15)));
  // The last tick leaves the field dark, ready for the next fill.
  assert.deepEqual(new Set(at(23).flat()), new Set([settings.baseIntensity]));
});

test("block drop stacks rows upward then flashes two row-clear beats", () => {
  const mode = BLOCK_DROP_FLICKER_MODE;
  const settings = mode.normalize({});
  const field = fieldFor(mode, {});
  const tick = settings.cycleSeconds / 11;
  const at = step => intensityGrid(field, (step + 0.5) * tick);

  // The pile grows one row per tick from the bottom.
  const filledRows = grid => grid.filter(
    row => row.every(value => value > settings.baseIntensity),
  ).length;
  assert.equal(filledRows(at(0)), 1);
  assert.equal(filledRows(at(1)), 2);
  assert.equal(filledRows(at(4)), 5);
  // The full frame is held for a second tick before the clears.
  assert.deepEqual(at(5), at(4));

  // Clear beats flash the whole field at the loader's clear level, alternating
  // with empty frames.
  assert.deepEqual(new Set(at(6).flat()), new Set([0.88]));
  assert.deepEqual(new Set(at(7).flat()), new Set([settings.baseIntensity]));
  assert.deepEqual(new Set(at(8).flat()), new Set([0.88]));
  assert.deepEqual(new Set(at(10).flat()), new Set([settings.baseIntensity]));
});

test("prism bloom cycles symmetric motifs and blends between them", () => {
  const mode = PRISM_BLOOM_FLICKER_MODE;
  const settings = mode.normalize({ blendSeconds: 0 });
  const field = fieldFor(mode, { blendSeconds: 0 });
  const tick = settings.cycleSeconds / 6;
  const at = step => intensityGrid(field, (step + 0.5) * tick);

  // Diagonal star: corners peak, center sits at mid, edges rest.
  const star = at(0);
  assert.equal(star[0][0], 1);
  assert.equal(star[0][4], 1);
  assert.equal(star[2][2], 0.52);
  assert.equal(star[0][2], settings.baseIntensity);

  // Diamond bloom: the axes peak through the center.
  const diamond = at(1);
  assert.equal(diamond[0][2], 1);
  assert.equal(diamond[2][0], 1);
  assert.equal(diamond[0][0], settings.baseIntensity);

  // Every motif is symmetric under both flips, which is what makes it read as a
  // kaleidoscope rather than a drifting pattern.
  for (const step of [0, 1, 2, 3]) {
    const grid = at(step);
    for (let row = 0; row < 5; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        assert.equal(grid[row][column], grid[row][4 - column]);
        assert.equal(grid[row][column], grid[4 - row][column]);
      }
    }
  }
  // The sequence breathes out and back: step 4 repeats step 2, step 5 repeats 1.
  assert.deepEqual(at(4), at(2));
  assert.deepEqual(at(5), at(1));

  // With the loader's transition window a frame boundary crossfades.
  const blended = fieldFor(mode, {});
  const boundary = blended.sampleAt(0.5, 0.5, tick * 1.02);
  assert.ok(boundary > Math.min(1, settings.baseIntensity));
  assert.ok(boundary < 1);
});

test("crt glide sweeps a scanline down with a decaying trail", () => {
  const mode = CRT_GLIDE_FLICKER_MODE;
  const settings = mode.normalize({ columnWarp: 0 });
  const field = fieldFor(mode, { columnWarp: 0 });
  const tick = settings.cycleSeconds / settings.rows;
  const at = step => intensityGrid(field, (step + 0.5) * tick);

  const third = at(2);
  // Rows the scanline has not reached stay dark.
  assert.equal(third[3][0], settings.baseIntensity);
  assert.equal(third[4][0], settings.baseIntensity);
  // The scanline itself is brightest, and the trail behind it decays.
  assert.equal(third[2][0], settings.peakIntensity);
  assert.ok(third[1][0] < third[2][0]);
  assert.ok(third[0][0] < third[1][0]);
  assert.ok(third[0][0] > settings.baseIntensity);
  // Without warp a row is flat across its columns.
  assert.equal(new Set(third[2]).size, 1);

  // The scanline advances one row per tick and wraps.
  assert.equal(at(0)[0][0], settings.peakIntensity);
  assert.equal(at(4)[4][0], settings.peakIntensity);
  assert.equal(at(0)[1][0], settings.baseIntensity);

  // Warp breaks a row's flatness without lifting it past the peak.
  const warped = fieldFor(mode, {});
  const warpedRow = intensityGrid(warped, 2.5 * tick)[2];
  assert.ok(new Set(warpedRow).size > 1);
  assert.ok(warpedRow.every(value => value <= settings.peakIntensity));
});

test("radar arc sweeps a beam around the field with a wake and ring echo", () => {
  const mode = RADAR_ARC_FLICKER_MODE;
  const settings = mode.normalize({});
  const field = fieldFor(mode, {});

  // The hub always reads at the loader's center level.
  assert.equal(field.sampleAt(2.5, 2.5, 0), 0.62);

  // At phase zero the arm points along +x, so the dots right of center are the
  // beam and the ones left of it are not.
  const start = intensityGrid(field, 0);
  assert.equal(start[2][4], 0.96);
  assert.equal(start[2][3], 0.96);
  assert.notEqual(start[2][0], 0.96);

  // A quarter turn later the beam has rotated onto the other axis.
  const quarter = intensityGrid(field, settings.cycleSeconds * 0.25);
  assert.equal(quarter[4][2], 0.96);
  assert.notEqual(quarter[2][4], 0.96);
  const half = intensityGrid(field, settings.cycleSeconds * 0.5);
  assert.equal(half[2][0], 0.96);

  // The wake sits beside the beam, brighter than rest but below the beam.
  const wake = intensityGrid(field, settings.cycleSeconds * 0.125);
  assert.ok(wake.flat().includes(0.36));
  // The perimeter band echoes where the beam is not.
  assert.ok(start.flat().includes(0.22));
  // Every level stays inside 0..1, whatever the geometry.
  assert.ok(start.flat().every(value => value >= 0 && value <= 1));
  // A full turn returns to the start.
  assert.deepEqual(intensityGrid(field, settings.cycleSeconds), start);
});

test("every ported mode holds 0..1, follows a resize, and stays deterministic", () => {
  for (const name of flickerModes.list()) {
    const mode = flickerModes.get(name);
    for (const grid of [
      MATRIX_GRID,
      { columns: 1, rows: 1, cellSize: 100, dotsPerCellAxis: 8 },
      { columns: 20, rows: 11, cellSize: 45, dotsPerCellAxis: 8 },
    ]) {
      const field = mode.createField({
        settings: mode.normalize({}),
        grid,
        noiseFunction: undefined,
      });
      const width = grid.columns * grid.dotsPerCellAxis;
      const height = grid.rows * grid.dotsPerCellAxis;
      const samples = new Set();
      for (let step = 0; step < 40; step += 1) {
        const time = step * 0.037;
        for (const [x, y] of [
          [0.5, 0.5],
          [width - 0.5, height - 0.5],
          [width * 0.5, height * 0.5],
          [width * 0.25, height * 0.75],
        ]) {
          const sample = field.sampleAt(x, y, time);
          assert.ok(
            Number.isFinite(sample) && sample >= 0 && sample <= 1,
            `${name} sampled ${sample} at ${x},${y}`,
          );
          assert.equal(field.sampleAt(x, y, time), sample, `${name} is not deterministic`);
          samples.add(sample);
        }
      }
      // A field that never changes value would render as no flicker at all.
      assert.ok(samples.size > 1, `${name} produced one flat level on ${width}x${height}`);
      field.resize?.(MATRIX_GRID);
    }
  }
});

const MODE_SETTING_VARIANTS = Object.freeze({
  noise: Object.freeze({ speed: 0.91, spatialScale: 0.91 }),
  "echo-ring": Object.freeze({
    cycleSeconds: 0.73,
    ringDelayFraction: 0.31,
    echoDelayFraction: 0.19,
    ringCount: 3,
  }),
  "strobe-stack": Object.freeze({
    cycleSeconds: 0.73,
    columns: 3,
    rows: 4,
    baseIntensity: 0.22,
  }),
  "block-drop": Object.freeze({ cycleSeconds: 0.73, baseIntensity: 0.22 }),
  "prism-bloom": Object.freeze({
    cycleSeconds: 0.73,
    blendSeconds: 0,
    baseIntensity: 0.22,
  }),
  "crt-glide": Object.freeze({
    cycleSeconds: 0.83,
    rows: 7,
    decay: 0.31,
    columnWarp: 0.25,
    baseIntensity: 0.22,
    peakIntensity: 0.81,
  }),
  "radar-arc": Object.freeze({
    cycleSeconds: 0.83,
    gridSteps: 7,
    beamWidth: 0.3,
    wakeWidth: 0.8,
    ringInnerRadius: 1.1,
    ringOuterRadius: 2.8,
    baseIntensity: 0.22,
  }),
});

function modeSampleSignature(mode, authored = {}) {
  const grid = { columns: 9, rows: 7, cellSize: 10, dotsPerCellAxis: 1 };
  const field = mode.createField({ settings: mode.normalize(authored), grid });
  const samples = [];
  for (let timeIndex = 0; timeIndex <= 60; timeIndex += 1) {
    const time = timeIndex * 0.037;
    for (let y = 0.5; y < grid.rows; y += 0.5) {
      for (let x = 0.5; x < grid.columns; x += 0.5) {
        samples.push(field.sampleAt(x, y, time));
      }
    }
  }
  return samples;
}

test("every authored mode setting changes the shared flicker field", () => {
  assert.deepEqual(Object.keys(MODE_SETTING_VARIANTS), flickerModes.list());
  for (const [modeName, variants] of Object.entries(MODE_SETTING_VARIANTS)) {
    const mode = flickerModes.get(modeName);
    const baseline = modeSampleSignature(mode);
    assert.deepEqual(
      Object.keys(variants).sort(),
      Object.keys(mode.normalize({})).sort(),
      `${modeName} needs one sensitivity fixture per setting`,
    );
    for (const [setting, value] of Object.entries(variants)) {
      assert.notDeepEqual(
        modeSampleSignature(mode, { [setting]: value }),
        baseline,
        `${modeName}.${setting} is accepted but does not affect output`,
      );
    }
  }
});

test("the shipped catalog registers every mode and each composition selects one", () => {
  assert.deepEqual(flickerModes.list(), [
    "noise",
    "echo-ring",
    "strobe-stack",
    "block-drop",
    "prism-bloom",
    "crt-glide",
    "radar-arc",
  ]);

  const flickering = Object.entries(SETTINGS).filter(
    ([, group]) => group?.flicker !== undefined,
  );
  assert.deepEqual(flickering.map(([name]) => name).sort(), [
    "base",
    "contextWindow",
    "flock",
    "gameOfLife",
    "inferenceLoop",
    "interactiveGrid",
    "lTree",
    "mold",
    "toolLoop",
    "voronoi",
  ]);

  for (const [name, group] of flickering) {
    const flicker = createFlicker({
      palette: GREEN,
      settings: group.flicker,
      autoCycleSeconds: group.timing?.beatSeconds
        ?? group.simulation?.pulseEverySeconds,
      grid: { columns: 8, rows: 6, cellSize: 100, dotsPerCellAxis: 8 },
    });
    assert.equal(flicker.enabled, true, `${name} should flicker.`);
    assert.ok(
      flickerModes.has(flicker.modeName),
      `${name} selects unregistered mode "${flicker.modeName}".`,
    );
    assert.ok(
      ["canvas", "cell"].includes(flicker.scope),
      `${name} selects unknown scope "${flicker.scope}".`,
    );
    assert.ok(flicker.amount > 0, `${name} should agitate its dots.`);
    assert.deepEqual(
      flicker.inspect().modeSettings,
      flicker.settings.modes[flicker.modeName],
      `${name} must pass its selected mode settings into the active field`,
    );
    const sample = flicker.sampleAt(1, 2, 0.5);
    assert.ok(sample >= 0 && sample <= 1, `${name} sampled ${sample}.`);
  }
});
