import test from "node:test";
import assert from "node:assert/strict";

import {
  createExportController,
  exportNamePartsFromInspection,
  motionDurationForCycles,
} from "../src/export/export-controller.js";
import { createExportState } from "../src/export/export-state.js";
import { exportBaseName } from "../src/export/filename.js";

test("motion cycles multiply the complete animation duration", () => {
  assert.equal(motionDurationForCycles(2.5, 4), 10);
  assert.equal(motionDurationForCycles(null, 4), null);
  assert.throws(() => motionDurationForCycles(2.5, 0), /between 1 and 100/);
  assert.throws(() => motionDurationForCycles(2.5, 1.5), /between 1 and 100/);
});

test("base preview filenames use scope in place of the internal composition id", () => {
  const canvasRadar = exportNamePartsFromInspection({
    compositionId: "base",
    generators: {
      baseGrid: {
        flicker: {
          enabled: true,
          mode: "radar-arc",
          scope: "canvas",
        },
      },
    },
  });
  assert.deepEqual(canvasRadar, {
    composition: "canvas",
    flicker: "radar-arc",
  });
  assert.equal(
    exportBaseName(new Date(2026, 7, 14, 12, 0, 0), canvasRadar),
    "OAI_canvas_radar-arc_0814-120000",
  );
  assert.deepEqual(exportNamePartsFromInspection({
    compositionId: "voronoi",
    generators: {
      voronoiGrid: {
        flicker: { enabled: true, mode: "noise", scope: "cell" },
      },
    },
  }), {
    composition: "voronoi",
    flicker: "noise",
  });
});

test("export failures still unlock input, restore preview looping, and clear progress", async () => {
  const calls = [];
  const state = createExportState({ mode: "motion", exportFormat: "mp4" });
  const director = {
    animationDuration: () => null,
    snapshotProjectState: () => ({ compositionId: "flock", generators: {} }),
  };
  const panel = {
    setLocked: value => calls.push(["panel", value]),
    setProgress: message => calls.push(["progress", message]),
    sync() {},
  };
  const previousWindow = globalThis.window;
  const previousConsoleError = console.error;
  globalThis.window = { alert: message => calls.push(["alert", message]) };
  console.error = () => {};
  try {
    const controller = createExportController({
      p: { isLooping: () => true },
      getDirector: () => director,
      createDirector: async () => { throw new Error("should not create a session"); },
      state,
      panel,
      getPreviewClock: () => ({
        time: 1,
        frameIndex: 60,
        viewport: { width: 800, height: 600 },
      }),
      pausePreview: () => calls.push(["pause"]),
      resumePreview: wasLooping => calls.push(["resume", wasLooping]),
      renderPreview: () => calls.push(["render"]),
      setInputLocked: value => calls.push(["input", value]),
    });

    await controller.run();

    assert.equal(controller.exporting, false);
    assert.deepEqual(calls.slice(0, 4), [
      ["panel", true],
      ["progress", "Preparing export…"],
      ["input", true],
      ["pause"],
    ]);
    assert.match(calls.find(call => call[0] === "alert")[1], /continuous simulation/);
    assert.deepEqual(calls.slice(-4), [
      ["progress", undefined],
      ["panel", false],
      ["input", false],
      ["resume", true],
    ]);
  } finally {
    console.error = previousConsoleError;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("Embedded metadata restores only the Circle Grid project schema", () => {
  const restored = [];
  const state = createExportState();
  const restoreDirector = {
    restoreProjectState: value => restored.push(value),
    snapshotProjectState: () => ({ compositionId: "inference-loop", generators: {} }),
  };
  const controller = createExportController({
    p: {},
    getDirector: () => restoreDirector,
    state,
    panel: { sync: () => restored.push("sync") },
    onProjectRestored: () => restored.push("ready"),
    renderPreview: () => restored.push("render"),
  });
  controller.restorePayload({
    app: "circle-grid",
    project: "circle-grid",
    version: 1,
    params: {
      version: 1,
      seed: 42,
      timeline: { time: 1.5, frameIndex: 90 },
      director: { compositionId: "voronoi", generators: {} },
      export: { resW: 1080 },
    },
  });
  assert.equal(state.resW, 1080);
  assert.deepEqual(restored, [
    { compositionId: "voronoi", generators: {} },
    "ready",
    "sync",
    "render",
  ]);
  assert.throws(() => controller.restorePayload({
    app: "circle-grid",
    project: "another-project",
    version: 1,
    params: {},
  }), /compatible Circle Grid state/);
});
