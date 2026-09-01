import test from "node:test";
import assert from "node:assert/strict";

import { createRuntimeConfig } from "../config.js";
import { createHeadlessDirector } from "../src/debug/headless.js";

const FRAME_ZERO = Object.freeze({
  dt: 0,
  compositionDt: 0,
  time: 0,
  frameIndex: 0,
  viewport: Object.freeze({ width: 900, height: 600 }),
  pointer: Object.freeze({ active: false, x: 0, y: 0 }),
});

test("a rebuilt director applies the core-duration override and preserves project state", () => {
  const original = createHeadlessDirector().director;
  original.use("voronoi");
  original.update(FRAME_ZERO);
  const snapshot = original.snapshotProjectState();

  const config = createRuntimeConfig({
    compositionTimingOverrides: { voronoi: 12 },
  });
  const rebuilt = createHeadlessDirector({ settings: config.settings }).director;
  rebuilt.restoreProjectState(snapshot);
  rebuilt.update(FRAME_ZERO);
  rebuilt.seek(0);

  assert.equal(rebuilt.inspect().timeline.coreDuration, 12);
  assert.deepEqual(rebuilt.snapshotProjectState(), snapshot);
  original.dispose();
  rebuilt.dispose();
});

test("noise-grid timing overrides remain authoritative over restored generator state", () => {
  const original = createHeadlessDirector({ composition: "noise-grid" }).director;
  original.update(FRAME_ZERO);
  const snapshot = original.snapshotProjectState();
  snapshot.generators.noiseGrid.settings.durationSeconds = 9;

  const config = createRuntimeConfig({
    compositionTimingOverrides: { "noise-grid": 9 },
  });
  const rebuilt = createHeadlessDirector({
    composition: "noise-grid",
    settings: config.settings,
    compositionDefinitions: config.compositionDefinitions,
  }).director;
  rebuilt.restoreProjectState(snapshot);
  rebuilt.update(FRAME_ZERO);

  assert.equal(rebuilt.inspect().timeline.coreDuration, 9);
  assert.equal(rebuilt.generator("noiseGrid").animationDuration(), 9);
  original.dispose();
  rebuilt.dispose();
});
