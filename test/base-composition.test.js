import test from "node:test";
import assert from "node:assert/strict";

import { BASE_CONFIG, GLOBAL_CONFIG, PALETTES, SETTINGS } from "../config.js";
import {
  BASE_CELL_LEVELS,
  BaseCompositionGenerator,
  createBaseCompositionLayout,
} from "../src/generators/base-composition-generator.js";
import { flickerModes } from "../src/visuals/flicker/index.js";

function drawingContext() {
  return {
    globalAlpha: 1,
    fillStyle: "",
    arcs: 0,
    fills: 0,
    save() {},
    restore() {},
    translate() {},
    beginPath() {},
    moveTo() {},
    arc() {
      this.arcs += 1;
    },
    fill() {
      this.fills += 1;
    },
  };
}

function createGenerator(viewport = { width: 1000, height: 400 }) {
  return new BaseCompositionGenerator({
    name: "baseGrid",
    settingsKey: "base",
    options: SETTINGS.base,
    runtime: {
      viewport: () => viewport,
      projectSeed: () => 123,
    },
    palettes: PALETTES,
  });
}

test("base layout is a centered five-cell strip along either long axis", () => {
  const landscape = createBaseCompositionLayout({ width: 1000, height: 400 });
  assert.deepEqual(
    {
      columns: landscape.columns,
      rows: landscape.rows,
      cellSize: landscape.cellSize,
      patternWidth: landscape.patternWidth,
      patternHeight: landscape.patternHeight,
    },
    { columns: 5, rows: 1, cellSize: 200, patternWidth: 1000, patternHeight: 200 },
  );

  const portrait = createBaseCompositionLayout({ width: 400, height: 1000 });
  assert.deepEqual(
    {
      columns: portrait.columns,
      rows: portrait.rows,
      cellSize: portrait.cellSize,
      patternWidth: portrait.patternWidth,
      patternHeight: portrait.patternHeight,
    },
    { columns: 1, rows: 5, cellSize: 200, patternWidth: 200, patternHeight: 1000 },
  );
});

test("base renders five densities with local flicker values over global defaults", () => {
  const generator = createGenerator();
  const inspection = generator.inspect();
  assert.deepEqual(inspection.levels, BASE_CELL_LEVELS);
  assert.deepEqual(inspection.dotCounts, [1, 4, 16, 64, 256]);
  assert.equal(Object.hasOwn(BASE_CONFIG, "flicker"), false);
  assert.equal(inspection.flicker.mode, GLOBAL_CONFIG.flicker.mode);
  assert.equal(inspection.flicker.scope, BASE_CONFIG.settings.base.flicker.scope);
  assert.equal(inspection.flicker.amount, BASE_CONFIG.settings.base.flicker.amount);
  assert.equal(
    SETTINGS.base.flicker.modes["echo-ring"].cycleSeconds,
    BASE_CONFIG.settings.base.flicker.modes["echo-ring"].cycleSeconds,
  );
  assert.equal(
    SETTINGS.base.flicker.modes.noise.speed,
    GLOBAL_CONFIG.flicker.modes.noise.speed,
  );
  assert.equal(generator.endpointAutoDuration("start"), generator.cycleDuration());

  generator.enter();
  generator.update({
    compositionDt: generator.intro.settings.durationSeconds + 0.25,
  });
  const context = drawingContext();
  generator.draw({}, {}, context);
  assert.equal(context.arcs, 341);
  assert.ok(context.fills > 0);
});

test("base previews every flicker in both scopes for three repeatable cycles", () => {
  const generator = createGenerator();
  const original = generator.flickerPreviewState();
  assert.equal(original.repeats, 3);

  for (const scope of ["canvas", "cell"]) {
    for (const mode of flickerModes.list()) {
      generator.useFlickerPreview({ mode, scope, repeats: 3 });
      generator.update({ compositionDt: 0.1 });
      const context = drawingContext();
      generator.draw({}, {}, context);
      assert.deepEqual(generator.flickerPreviewState(), { mode, scope, repeats: 3 });
      assert.equal(context.arcs, 341, `${scope}/${mode} should render every preview dot.`);
      assert.equal(
        generator.animationDuration(),
        generator.cycleDuration() * 3
          + generator.intro.settings.durationSeconds * 3,
      );

      generator.seek(0.1);
      const firstCycle = [...generator.paletteIndicesForCell(4, 4)];
      generator.seek(
        generator.cycleDuration()
          + generator.intro.settings.durationSeconds
          + 0.1,
      );
      assert.deepEqual(
        [...generator.paletteIndicesForCell(4, 4)],
        firstCycle,
        `${scope}/${mode} should replay the same cycle.`,
      );
    }
  }

  generator.restoreProjectState({
    version: 1,
    flickerMode: original.mode,
    flickerScope: original.scope,
    previewRepeats: original.repeats,
  });
  assert.deepEqual(generator.flickerPreviewState(), original);
});
