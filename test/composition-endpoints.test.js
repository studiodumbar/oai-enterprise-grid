import test from "node:test";
import assert from "node:assert/strict";

import {
  DijkstraCompositionEndpoint,
  resolveCompositionEndpointSettings,
} from "../src/composition-endpoints/index.js";
import { createProceduralTopologySceneAt } from "../src/generators/grid-scene-strategies.js";

const GLOBAL_ENDPOINTS = Object.freeze({
  startWithCircle: true,
  startWithCircleDurationSeconds: 1,
  endWithCircle: true,
  endWithCircleDurationSeconds: 2,
  circleSubdivision: 1,
});

test("composition endpoint settings override the legacy global controls by phase", () => {
  const resolved = resolveCompositionEndpointSettings(GLOBAL_ENDPOINTS, {
    start: { enabled: false },
    end: { enabled: true, durationSeconds: 4, mode: "dijkstra" },
  });
  assert.equal(resolved.start.enabled, false);
  assert.equal(resolved.end.mode, "dijkstra");
  assert.equal(resolved.timeline.startWithCircle, false);
  assert.equal(resolved.timeline.endWithCircle, true);
  assert.equal(resolved.timeline.endWithCircleDurationSeconds, 4);
  assert.throws(
    () => resolveCompositionEndpointSettings(GLOBAL_ENDPOINTS, {
      end: { mode: "teleport" },
    }),
    /Unknown composition endpoint mode "teleport".*native, dijkstra/,
  );
});

test("composition endpoint settings layer structured global and local mode controls", () => {
  const resolved = resolveCompositionEndpointSettings({
    circleEndpoints: {
      start: { enabled: false, durationSeconds: 2, mode: "native" },
      end: { enabled: true, durationSeconds: 3, mode: "dijkstra" },
      circleSubdivision: 2,
      modes: {
        dijkstra: { blinkCount: 3, cleanupAcceleration: 1.5 },
      },
    },
  }, {
    end: { durationSeconds: 5 },
    modes: {
      dijkstra: { cleanupAcceleration: 2 },
    },
  });
  assert.deepEqual(resolved.start, {
    enabled: false,
    durationSeconds: 2,
    mode: "native",
  });
  assert.deepEqual(resolved.end, {
    enabled: true,
    durationSeconds: 5,
    mode: "dijkstra",
  });
  assert.equal(resolved.circleSubdivision, 2);
  assert.deepEqual(resolved.modes.dijkstra, {
    blinkCount: 3,
    cleanupAcceleration: 2,
  });
});

test("Dijkstra endpoint leaves one center dot after path, blink, and subdivision", () => {
  const endpoint = new DijkstraCompositionEndpoint({
    pathFraction: 0.4,
    blinkFraction: 0.2,
    blinkCount: 2,
  });
  const layout = {
    width: 800,
    height: 500,
    columns: 8,
    rows: 5,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const scene = {
    key: "voronoi:0:settle:7",
    endpointCellIndex: 32,
    territoryByIndex: new Array(40).fill(0),
  };
  const path = endpoint.frameAt({ layout, scene, progress: 0.399 });
  assert.equal(path.layout.columns, layout.columns);
  assert.equal(path.layout.rows, layout.rows);
  assert.equal(path.layout.cellSize, layout.cellSize);
  assert.equal(path.pathIndices[0], scene.endpointCellIndex);
  assert.equal(path.pathIndices.at(-1), path.centerIndex);
  assert.ok(path.pathIndices.every((index, order, indices) => (
    order === 0
    || Math.abs(index - indices[order - 1]) === 1
    || Math.abs(index - indices[order - 1]) === path.layout.columns
  )));
  assert.equal(path.cells.length, path.pathIndices.length);
  assert.ok(path.cells.every(cell => cell.level === 0));
  assert.equal(path.flicker, false);

  const subdividing = endpoint.frameAt({ layout, scene, progress: 0.7 });
  assert.equal(subdividing.stage, "subdivide");
  assert.equal(subdividing.layout.columns, layout.columns);
  assert.equal(subdividing.layout.rows, layout.rows);
  assert.equal(subdividing.layout.cellSize, layout.cellSize);
  assert.ok(subdividing.cells.some(cell => cell.level === 0));
  assert.ok(subdividing.cells.some(cell => cell.level > 0));
  assert.equal(subdividing.flicker, true);

  const removedAt = progress => {
    const frame = endpoint.frameAt({ layout, scene, progress });
    return frame.pathIndices.length - frame.cells.length;
  };
  const earlyIncrease = removedAt(0.75) - removedAt(0.675);
  const lateIncrease = removedAt(0.825) - removedAt(0.75);
  assert.ok(lateIncrease > earlyIncrease, "cleanup should accelerate toward the center");

  const finished = endpoint.frameAt({ layout, scene, progress: 1 });
  assert.equal(finished.stage, "center");
  assert.equal(finished.layout.cellSize, layout.cellSize);
  assert.deepEqual(finished.cells, [{ index: finished.centerIndex, level: 0 }]);
});

test("Dijkstra endpoint loads clockwise until the first path cell appears", () => {
  const endpoint = new DijkstraCompositionEndpoint({
    pathFraction: 0.4,
    paletteStep: 3,
  });
  const layout = {
    width: 800,
    height: 500,
    columns: 8,
    rows: 5,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const scene = {
    key: "voronoi:0:settle:loader",
    endpointCellIndex: 32,
    territoryByIndex: new Array(40).fill(0),
  };

  const prepared = endpoint.preparationFrameAt({
    layout,
    scene,
    progress: 0.5,
  });
  assert.equal(prepared.stage, "loading");
  assert.equal(prepared.cells[0].index, scene.endpointCellIndex);
  assert.equal(prepared.cells[0].level, 2);
  assert.equal(prepared.cells[0].paletteSteps.length, 16);

  const loading = endpoint.frameAt({ layout, scene, progress: 0 });
  assert.equal(loading.stage, "loading");
  assert.equal(loading.cells[0].level, 2);
  assert.equal(loading.cells[0].paletteSteps.length, 16);

  const firstPathBeat = endpoint.pathFraction / loading.pathIndices.length;
  const path = endpoint.frameAt({ layout, scene, progress: firstPathBeat });
  assert.equal(path.stage, "path");
  assert.equal(path.cells.length, 2);
  assert.ok(path.cells.every(cell => cell.level === 0));
});

test("Dijkstra trailLength controls how many cleanup cells change together", () => {
  const layout = {
    width: 800,
    height: 500,
    columns: 8,
    rows: 5,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const scene = {
    key: "voronoi:0:settle:trail-length",
    endpointCellIndex: 32,
    territoryByIndex: new Array(40).fill(0),
  };
  const changingCellsAtMidCleanup = trailLength => {
    const endpoint = new DijkstraCompositionEndpoint({ trailLength });
    const path = endpoint.frameAt({ layout, scene, progress: 0.399 });
    const removableCount = path.pathIndices.length - 1;
    const cascadeDistance = removableCount + path.changingCellCount - 1;
    const cascadePosition = removableCount - 0.5;
    const cleanupLocal = (cascadePosition / cascadeDistance) ** 0.5;
    const cleanupProgress = 0.6 + cleanupLocal * 0.3;
    const cleanup = endpoint.frameAt({ layout, scene, progress: cleanupProgress });
    return {
      path,
      changing: cleanup.cells.filter(cell => cell.level > 0).length,
    };
  };

  const none = changingCellsAtMidCleanup(0);
  const half = changingCellsAtMidCleanup(0.5);
  const full = changingCellsAtMidCleanup(1);
  assert.equal(none.path.pathIndices.length, 7);
  assert.equal(none.path.cells.length, 7, "trailLength must not shorten the path");
  assert.equal(none.path.changingCellCount, 1);
  assert.equal(half.path.changingCellCount, 4);
  assert.equal(full.path.changingCellCount, 6);
  assert.equal(none.changing, 1);
  assert.equal(half.changing, 4);
  assert.equal(full.changing, 6);

  assert.doesNotThrow(() => new DijkstraCompositionEndpoint({ trailLength: 1 }));
  assert.throws(
    () => new DijkstraCompositionEndpoint({ trailLength: -0.01 }),
    /trailLength must be between zero and one inclusive/,
  );
  assert.throws(
    () => new DijkstraCompositionEndpoint({ trailLength: 1.01 }),
    /trailLength must be between zero and one inclusive/,
  );
});

test("Voronoi commits one parent cell and starts grid-level pathfinding there", () => {
  const layout = {
    width: 500,
    height: 300,
    columns: 5,
    rows: 3,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const scene = createProceduralTopologySceneAt({
    strategy: "voronoi",
    layout,
    cycleIndex: 0,
    progress: 0.99,
    options: {
      partitionPasses: 8,
      siteCount: 5,
      boundaryWhitespace: 0.25,
      flicker: { enabled: false },
    },
  });
  const visible = scene.faces.filter(face => face.level >= 0);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].level, 0);
  assert.equal(Object.hasOwn(scene, "selectedGlyphIndex"), false);
  assert.equal(scene.transitionStyle, "cut");

  const endpointFrame = new DijkstraCompositionEndpoint().frameAt({
    layout,
    scene,
    progress: 0,
  });
  assert.equal(endpointFrame.layout.cellSize, layout.cellSize);
  assert.equal(endpointFrame.pathIndices[0], scene.endpointCellIndex);
  assert.equal(endpointFrame.stage, "loading");
  assert.equal(endpointFrame.cells[0].index, scene.endpointCellIndex);
  assert.equal(endpointFrame.cells[0].level, 2);
  assert.equal(endpointFrame.cells[0].paletteSteps.length, 16);
  assert.ok(scene.endpointPreparationProgress > 0.9);
});
