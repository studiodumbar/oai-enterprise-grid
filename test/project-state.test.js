import test from "node:test";
import assert from "node:assert/strict";

import {
  applyProjectState,
  createProjectState,
  createSnapshotHistory,
} from "../src/export/project-state.js";

test("project snapshots capture director, export state, and deterministic seed", () => {
  const director = {
    snapshotProjectState: () => ({ compositionId: "voronoi" }),
  };
  assert.deepEqual(createProjectState({
    director,
    exportState: { resW: 1920 },
    projectSeed: 1234,
    timeline: { time: 1.25, frameIndex: 75 },
  }), {
    version: 1,
    seed: 1234,
    timeline: { time: 1.25, frameIndex: 75 },
    director: { compositionId: "voronoi" },
    export: { resW: 1920 },
  });
});

test("project restoration delegates only through explicit application hooks", () => {
  let restoredDirector = null;
  let restoredSeed = null;
  let restoredTimeline = null;
  const exportState = { resW: 1 };
  applyProjectState({
    version: 1,
    seed: 5678,
    timeline: { time: 2.5, frameIndex: 150 },
    director: { compositionId: "l-tree" },
    export: { resW: 1080, unknown: true },
  }, {
    director: { restoreProjectState: state => { restoredDirector = state; } },
    exportState,
    applyExportState: (target, saved) => { target.resW = saved.resW; },
    applyProjectSeed: seed => { restoredSeed = seed; },
    applyTimeline: timeline => { restoredTimeline = timeline; },
  });
  assert.deepEqual(restoredDirector, { compositionId: "l-tree" });
  assert.equal(restoredSeed, 5678);
  assert.deepEqual(restoredTimeline, { time: 2.5, frameIndex: 150 });
  assert.deepEqual(exportState, { resW: 1080 });
});

test("snapshot history treats a restore as one undoable commit", () => {
  const history = createSnapshotHistory({ value: 1 });
  history.commit({ value: 2 });
  assert.deepEqual(history.undo({ value: 2 }), { value: 1 });
  assert.deepEqual(history.redo({ value: 1 }), { value: 2 });
});

test("project restoration rejects malformed timeline state before applying it", () => {
  let restored = false;
  assert.throws(() => applyProjectState({
    version: 1,
    timeline: { time: -1, frameIndex: "bad" },
    director: {},
    export: {},
  }, {
    director: { restoreProjectState: () => { restored = true; } },
  }), /invalid animation timeline/);
  assert.equal(restored, false);
});
