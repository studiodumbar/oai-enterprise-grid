import test from "node:test";
import assert from "node:assert/strict";

import { createCatalog } from "../src/catalog.js";
import {
  createCircleGridSceneLayout,
  subdivisionCentersForGridCell,
} from "../src/generators/circle-grid-scene-generator.js";
import {
  WAVE_FIELD_STRATEGIES,
  createWaveFieldSceneAt,
} from "../src/generators/wave-field-strategies.js";
import {
  PATHFINDING_STRATEGIES,
  createPathfindingSceneAt,
  runPathfindingSearch,
} from "../src/generators/pathfinding-strategies.js";

const PALETTES = {
  green: ["#005122", "#008a3a", "#00b63c", "#7fd3a5"],
  violet: ["#cbafd9", "#7c5cad", "#7047a3", "#42276f"],
};

function faceSignatures(scene) {
  return scene.faces.map(face => [
    face.level,
    face.paletteStep,
    face.role,
  ].join("|"));
}

function recordingContext() {
  return {
    globalAlpha: 1,
    fillStyle: "",
    arcs: [],
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    fill() {},
    arc(x, y, radius, start, end) {
      this.arcs.push({ x, y, radius, start, end });
    },
  };
}

test("wave-field strategies are deterministic, quantized, and held per sample", () => {
  const layout = createCircleGridSceneLayout({ width: 900, height: 600 }, 9);
  const common = {
    layout,
    cycleIndex: 4,
    options: {
      stepCount: 8,
      wavelengthInCells: 3.6,
      whitespaceThreshold: 0.18,
      sourceCount: 3,
      signalWidthInCells: 0.9,
    },
  };

  for (const strategy of WAVE_FIELD_STRATEGIES) {
    const first = createWaveFieldSceneAt({
      ...common,
      strategy,
      progress: 0.14,
    });
    const repeated = createWaveFieldSceneAt({
      ...common,
      strategy,
      progress: 0.14,
    });
    const held = createWaveFieldSceneAt({
      ...common,
      strategy,
      progress: 0.18,
    });
    assert.deepEqual(first, repeated, `${strategy} should repeat exactly`);
    assert.deepEqual(
      faceSignatures(first),
      faceSignatures(held),
      `${strategy} should hold a fixed snapshot inside one step`,
    );
    assert.ok(first.faces.every(face => (
      Number.isInteger(face.level)
      && face.level >= -1
      && face.level <= 3
      && Number.isInteger(face.paletteStep)
      && face.paletteStep >= 0
      && face.paletteStep <= 3
    )));
  }

  assert.throws(
    () => createWaveFieldSceneAt({ ...common, strategy: "splash" }),
    /Unknown wave-field strategy/,
  );
});

test("BFS, Dijkstra, and A* use stable fixed-grid search semantics", () => {
  const layout = { columns: 3, rows: 3 };
  const traversalCosts = [1, 1, 1, 1, 9, 1, 1, 1, 1];
  const input = {
    layout,
    startIndex: 0,
    goalIndex: 8,
    blockedIndices: [],
    traversalCosts,
  };
  const bfs = runPathfindingSearch({ ...input, strategy: "bfs" });
  const dijkstra = runPathfindingSearch({ ...input, strategy: "dijkstra" });
  const aStar = runPathfindingSearch({ ...input, strategy: "a-star" });

  assert.deepEqual(bfs.pathIndices, [0, 1, 2, 5, 8]);
  assert.deepEqual(dijkstra.pathIndices, [0, 1, 2, 5, 8]);
  assert.deepEqual(aStar.pathIndices, dijkstra.pathIndices);
  assert.equal(dijkstra.pathCost, 4);
  assert.equal(aStar.pathCost, dijkstra.pathCost);
  assert.deepEqual(
    runPathfindingSearch({ ...input, strategy: "a-star" }).visitedIndices,
    aStar.visitedIndices,
  );

  assert.throws(
    () => runPathfindingSearch({ ...input, strategy: "greedy" }),
    /Unknown pathfinding strategy/,
  );
});

test("pathfinding scenes expose deterministic frontiers and final paths", () => {
  const layout = createCircleGridSceneLayout({ width: 900, height: 600 }, 9);
  for (const strategy of PATHFINDING_STRATEGIES) {
    const input = {
      strategy,
      layout,
      cycleIndex: 7,
      options: {
        stepCount: 10,
        obstacleDensity: 0.12,
        maximumTraversalCost: 4,
      },
    };
    const search = createPathfindingSceneAt({ ...input, progress: 0.23 });
    const repeated = createPathfindingSceneAt({ ...input, progress: 0.23 });
    const held = createPathfindingSceneAt({ ...input, progress: 0.27 });
    const complete = createPathfindingSceneAt({ ...input, progress: 0.999 });

    assert.deepEqual(search, repeated);
    assert.deepEqual(faceSignatures(search), faceSignatures(held));
    assert.equal(complete.phase, "path");
    assert.equal(complete.visiblePathIndices.length, complete.pathIndices.length);
    assert.ok(complete.pathIndices.length > 0);
    assert.ok(complete.frontierIndices.every(Number.isInteger));
  }
});

test("wave-field and pathfinding factories satisfy the full circle lifecycle", () => {
  const catalog = createCatalog({ palettes: PALETTES });
  const cases = [
    {
      type: "wave-field",
      strategy: "interference",
      settingsKey: "waveDemo",
      options: {
        palette: "green",
        cycleSeconds: 2.4,
        stepCount: 8,
        longSideCells: 9,
        flipSeconds: 0.04,
        sourceCount: 3,
      },
    },
    {
      type: "pathfinding",
      strategy: "a-star",
      settingsKey: "pathDemo",
      options: {
        palette: "green",
        cycleSeconds: 3.2,
        stepCount: 12,
        longSideCells: 9,
        flipSeconds: 0.04,
        obstacleDensity: 0.1,
      },
    },
  ];

  for (const item of cases) {
    let viewport = { width: 900, height: 600 };
    const context = recordingContext();
    const generator = catalog.generatorTypes.create(item.type, {
      name: `${item.type}Demo`,
      definition: {
        type: item.type,
        settingsKey: item.settingsKey,
        strategy: item.strategy,
      },
      settingsKey: item.settingsKey,
      options: item.options,
      runtime: { viewport: () => viewport },
    });

    generator.enter();
    generator.update({ compositionDt: 0.1 });
    generator.update({ compositionDt: 0.05 });
    generator.draw({}, {}, context);
    const inspection = generator.inspect();
    assert.equal(inspection.generatorType, item.type);
    assert.equal(inspection.generatorInstanceId, `${item.type}Demo`);
    assert.equal(inspection.settingsKey, item.settingsKey);
    assert.equal(inspection.strategy, item.strategy);
    assert.equal(inspection.active, true);
    assert.ok(context.arcs.length > 0);
    assert.ok(context.arcs.every(arc => (
      arc.radius > 0
      && arc.start === 0
      && Math.abs(arc.end - Math.PI * 2) < 1e-12
    )));

    const legalCenters = new Set();
    inspection.levels.forEach((level, index) => {
      if (level < 0) return;
      for (const center of subdivisionCentersForGridCell(
        inspection.layout,
        index,
        level,
      )) {
        legalCenters.add(`${center.x.toFixed(6)}:${center.y.toFixed(6)}`);
      }
    });
    assert.ok(context.arcs.every(arc => (
      legalCenters.has(`${arc.x.toFixed(6)}:${arc.y.toFixed(6)}`)
    )));

    generator.exit();
    assert.equal(generator.inspect().active, false);
    generator.enter();
    assert.equal(generator.inspect().cycleIndex, 0);
    viewport = { width: 600, height: 900 };
    generator.resize(viewport);
    generator.update({ compositionDt: 0.1 });
    generator.update({ compositionDt: 0.05 });
    const portrait = generator.inspect();
    assert.ok(portrait.layout.rows > portrait.layout.columns);
    generator.dispose();
    generator.dispose();
    assert.equal(generator.levels.length, 0);
    assert.equal(generator.active, false);
  }
});

test("extensible generator types reject strategies owned by other engines", () => {
  const catalog = createCatalog({ palettes: PALETTES });
  const runtime = { viewport: () => ({ width: 900, height: 600 }) };
  assert.throws(
    () => catalog.generatorTypes.create("wave-field", {
      definition: { strategy: "a-star" },
      options: { palette: "green" },
      runtime,
    }),
    /does not support strategy "a-star"/,
  );
  assert.throws(
    () => catalog.generatorTypes.create("pathfinding", {
      definition: { strategy: "ripple" },
      options: { palette: "green" },
      runtime,
    }),
    /does not support strategy "ripple"/,
  );
});
