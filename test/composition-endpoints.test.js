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
  assert.throws(
    () => resolveCompositionEndpointSettings(GLOBAL_ENDPOINTS, {
      start: { mode: "dijkstra" },
    }),
    /mode "dijkstra" does not support start.*Available start modes: native/,
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
    endpointCellIndices: [32],
    territoryByIndex: new Array(40).fill(0),
  };
  const path = endpoint.frameAt({ layout, scene, progress: 0.399 });
  assert.equal(path.layout.columns, layout.columns);
  assert.equal(path.layout.rows, layout.rows);
  assert.equal(path.layout.cellSize, layout.cellSize);
  assert.deepEqual(path.startIndices, scene.endpointCellIndices);
  assert.equal(path.pathIndices[0], scene.endpointCellIndices[0]);
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

test("Dijkstra endpoint routes every visible parent cell and deduplicates overlaps", () => {
  const endpoint = new DijkstraCompositionEndpoint();
  const layout = {
    width: 500,
    height: 300,
    columns: 5,
    rows: 3,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const faces = Array.from({ length: 15 }, () => ({ level: -1 }));
  faces[0] = { level: 0 };
  faces[1] = { level: 2 };
  faces[14] = { level: 3 };
  const scene = {
    faces,
  };
  const plan = endpoint.createPlan({ layout, scene });

  assert.deepEqual(plan.startIndices, [0, 1, 14]);
  assert.deepEqual(
    plan.paths.map(path => path.pathIndices),
    [
      [0, 1, 2, 7],
      [1, 2, 7],
      [14, 9, 8, 7],
    ],
  );
  assert.deepEqual(plan.pathIndices, [0, 1, 2, 7, 14, 9, 8]);
  assert.deepEqual(plan.cleanupIndices, [0, 14, 1, 9, 2, 8]);
  assert.ok(
    plan.pathIndices.length
      < plan.paths.reduce((count, path) => count + path.pathIndices.length, 0),
    "shared route cells should occur once in the merged path",
  );

  const loading = endpoint.frameAt({ layout, scene, progress: 0 });
  assert.equal(loading.stage, "loading");
  assert.deepEqual(loading.cells.map(cell => cell.index), plan.startIndices);
  const blink = endpoint.frameAt({ layout, scene, progress: 0.4 });
  assert.deepEqual(blink.cells.map(cell => cell.index), plan.pathIndices);
  const subdividing = endpoint.frameAt({ layout, scene, progress: 0.7 });
  assert.equal(
    new Set(subdividing.cells.map(cell => cell.index)).size,
    subdividing.cells.length,
    "overlapping paths should never draw or clean a parent cell twice",
  );

  const repeated = new DijkstraCompositionEndpoint().createPlan({ layout, scene });
  assert.deepEqual(repeated.paths, plan.paths);
  assert.deepEqual(repeated.cleanupIndices, plan.cleanupIndices);
});

test("Dijkstra endpoint normalizes explicit sources and falls back to center", () => {
  const endpoint = new DijkstraCompositionEndpoint();
  const layout = {
    width: 500,
    height: 300,
    columns: 5,
    rows: 3,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const faces = Array.from({ length: 15 }, () => ({ level: -1 }));
  faces[1] = { level: 0 };
  const explicit = endpoint.createPlan({
    layout,
    scene: {
      endpointCellIndices: Int32Array.from([14, 5, 0, 5, -1, 99]),
      faces,
    },
  });
  assert.deepEqual(explicit.startIndices, [0, 5, 14]);

  const fallback = endpoint.createPlan({
    layout,
    scene: {
      faces: Array.from({ length: 15 }, () => ({ level: -1 })),
    },
  });
  assert.deepEqual(fallback.startIndices, [fallback.centerIndex]);
  assert.deepEqual(fallback.pathIndices, [fallback.centerIndex]);
  assert.deepEqual(fallback.cleanupIndices, []);
});

test("Dijkstra endpoint freezes prepared sources for the whole end phase", () => {
  const endpoint = new DijkstraCompositionEndpoint();
  const layout = {
    width: 500,
    height: 300,
    columns: 5,
    rows: 3,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const prepared = endpoint.preparationFrameAt({
    layout,
    scene: { endpointCellIndices: [0, 14] },
    cycleIndex: 2,
    progress: 0.75,
  });
  const first = endpoint.frameAt({
    layout,
    scene: { endpointCellIndices: [7] },
    cycleIndex: 2,
    progress: 0,
  });
  const continued = endpoint.frameAt({
    layout,
    scene: { endpointCellIndices: [7] },
    cycleIndex: 2,
    progress: 0.5,
  });
  const nextCycle = endpoint.frameAt({
    layout,
    scene: { endpointCellIndices: [7] },
    cycleIndex: 3,
    progress: 0,
  });

  assert.deepEqual(prepared.startIndices, [0, 14]);
  assert.deepEqual(prepared.cells.map(cell => cell.index), [0, 14]);
  assert.deepEqual(first.startIndices, [0, 14]);
  assert.deepEqual(continued.startIndices, [0, 14]);
  assert.deepEqual(nextCycle.startIndices, [7]);
});

test("Dijkstra endpoint preserves each source's Voronoi territory weighting", () => {
  const endpoint = new DijkstraCompositionEndpoint({ foreignTerritoryCost: 3 });
  const layout = {
    width: 300,
    height: 300,
    columns: 3,
    rows: 3,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const faces = Array.from({ length: 9 }, () => ({ level: -1 }));
  faces[0] = { level: 0 };
  faces[2] = { level: 0 };
  const plan = endpoint.createPlan({
    layout,
    scene: {
      faces,
      territoryByIndex: [0, 0, 1, 1, 0, 1, 1, 1, 1],
    },
  });

  assert.deepEqual(
    plan.paths.map(path => path.pathIndices),
    [
      [0, 1, 4],
      [2, 5, 4],
    ],
  );
  assert.deepEqual(plan.paths.map(path => path.pathCost), [2, 4]);
});

test("Dijkstra endpoint prepares every loader and carries its pose into the outro", () => {
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
    endpointCellIndices: [32, 39],
    territoryByIndex: new Array(40).fill(0),
  };

  const halfway = endpoint.preparationFrameAt({
    layout,
    scene,
    progress: 0.5,
  });
  const prepared = endpoint.preparationFrameAt({
    layout,
    scene,
    progress: 1,
  });
  const loading = endpoint.frameAt({ layout, scene, progress: 0 });
  assert.equal(prepared.stage, "loading");
  assert.equal(loading.stage, "loading");
  assert.deepEqual(prepared.startIndices, [32, 39]);
  assert.deepEqual(prepared.cells.map(cell => cell.index), [32, 39]);
  assert.ok(prepared.cells.every(cell => cell.level === 2));
  assert.ok(prepared.cells.every(cell => cell.paletteSteps.length === 16));
  assert.notDeepEqual(
    halfway.cells[0].paletteSteps,
    prepared.cells[0].paletteSteps,
    "loader palette should rotate during endpoint preparation",
  );
  assert.deepEqual(
    loading.cells,
    prepared.cells,
    "the first outro frame must continue the prepared loader pose",
  );

  const path = endpoint.frameAt({
    layout,
    scene,
    progress: endpoint.pathFraction * 0.5,
  });
  assert.equal(path.stage, "path");
  assert.ok(path.cells.length > scene.endpointCellIndices.length);
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
    endpointCellIndices: [32],
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

test("Voronoi commits one parent cell per territory and carries them into pathfinding", () => {
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
  assert.equal(visible.length, scene.actualSiteCount);
  assert.ok(visible.every(face => face.level === 0));
  assert.equal(scene.endpointCellIndices.length, scene.actualSiteCount);
  assert.equal(new Set(scene.endpointCellIndices).size, scene.actualSiteCount);
  scene.endpointCellIndices.forEach((index, siteOrder) => {
    assert.equal(scene.territoryByIndex[index], siteOrder);
    assert.ok(!scene.boundaryIndices.includes(index));
  });
  assert.equal(Object.hasOwn(scene, "endpointCellIndex"), false);
  assert.equal(Object.hasOwn(scene, "selectedGlyphIndex"), false);
  assert.equal(scene.transitionStyle, "cut");

  const endpoint = new DijkstraCompositionEndpoint();
  const prepared = endpoint.preparationFrameAt({
    layout,
    scene,
    progress: 1,
  });
  const endpointFrame = endpoint.frameAt({
    layout,
    scene,
    progress: 0,
  });
  const expectedSources = [...scene.endpointCellIndices].sort((a, b) => a - b);
  assert.equal(endpointFrame.layout.cellSize, layout.cellSize);
  assert.equal(endpointFrame.stage, "loading");
  assert.deepEqual(prepared.startIndices, expectedSources);
  assert.deepEqual(endpointFrame.startIndices, expectedSources);
  assert.deepEqual(endpointFrame.cells, prepared.cells);
  assert.ok(endpointFrame.cells.every(cell => cell.level === 2));
  assert.ok(endpointFrame.cells.every(cell => cell.paletteSteps.length === 16));
});
