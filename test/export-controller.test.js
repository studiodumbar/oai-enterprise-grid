import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createExportController,
  exportNamePartsFromInspection,
  motionDurationForCycles,
} from "../src/export/export-controller.js";
import { createExportState } from "../src/export/export-state.js";
import { exportBaseName } from "../src/export/filename.js";
import {
  diogoniseImport,
  DIOGONISATOR_SETTING_NAMES,
  isDiogonisatorImport,
} from "../src/export/diogonisator.js";
import { captureDebug } from "../src/debug/index.js";

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

test("legacy sandbox metadata migrates into the noise-grid generator and export state", () => {
  const restored = [];
  const state = createExportState();
  const director = {
    restoreProjectState: value => restored.push(value),
    snapshotProjectState: () => ({ compositionId: "base", generators: {} }),
  };
  const controller = createExportController({
    p: {}, getDirector: () => director, state,
    panel: { sync() {} }, getPreviewClock: () => ({ time: 0, frameIndex: 0 }),
    onProjectRestored() {}, renderPreview() {},
  });
  const imported = controller.restorePayload({
    app: "circle-grid",
    params: {
      sizeType: "simplex", sizeScale: 1.17, sizeSpeed: 0.02, sizeSeed: 63,
      colorType: "simplex", colorSeed: 69, maskThreshold: 0.36,
      longCells: 5, colorSet: "green", bgColor: "#000000",
      aspect: "16:9", resolution: 1920, resW: 1920, resH: 1080,
      exportFormat: "mp4", fps: 60, duration: 10,
    },
    timeline: { version: 1, tracks: {} }, time: 9.5971,
  });
  assert.equal(imported.director.compositionId, "noise-grid");
  const settings = imported.director.generators.noiseGrid.settings;
  assert.equal(settings.noiseFields.layers.size.seed, 63);
  assert.equal(settings.noiseFields.layers.size.speed, 0.02);
  assert.equal(settings.durationSeconds, 10);
  assert.equal(settings.backgroundColor, "#000000");
  assert.equal(settings.palette, "green");
  assert.deepEqual(settings.paletteColors, [
    "#003415", "#00692a", "#00a240", "#04b84c", "#40c977", "#8cdfad",
  ]);
  assert.equal(imported.timeline.time, 9.5971);
  assert.equal(state.fps, 60);
  assert.equal(restored[0].compositionId, "noise-grid");
});

test("diogonisator detects flat legacy names without claiming native project state", () => {
  const payload = { params: { bgColor: "#000000", colorSet: "green", longCells: 5 } };
  assert.equal(DIOGONISATOR_SETTING_NAMES.includes("bgColor"), true);
  assert.equal(isDiogonisatorImport(payload), true);
  assert.equal(isDiogonisatorImport({ params: { unrelated: true } }), false);
  assert.equal(isDiogonisatorImport({
    app: "circle-grid", project: "circle-grid", version: 1,
    params: { bgColor: "#000000" },
  }), false);

  let imported;
  const log = captureDebug(["export"], () => {
    imported = diogoniseImport(payload, { export: { fps: 24 }, seed: 42 });
  });
  assert.equal(imported.director.compositionId, "noise-grid");
  assert.equal(imported.director.generators.noiseGrid.version, 3);
  assert.equal(imported.director.generators.noiseGrid.settings.backgroundColor, "#000000");
  assert.equal(imported.seed, 42);
  assert.match(log[0], /import-converter=diogonisator settings=3 composition=noise-grid/);
});

test("the confirmed legacy MP4 imports through restoreFile", async t => {
  const restored = [];
  const state = createExportState();
  const director = {
    restoreProjectState: value => restored.push(value),
    snapshotProjectState: () => ({ compositionId: "base", generators: {} }),
  };
  const controller = createExportController({
    p: {}, getDirector: () => director, state,
    panel: { sync() {} },
    getPreviewClock: () => ({ time: 0, frameIndex: 0 }),
    onProjectRestored() {}, renderPreview() {},
  });
  let bytes;
  try {
    bytes = await readFile(new URL("../assets/NOISE-GRID_circle-grid-20260819105741.mp4", import.meta.url));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    t.skip("confirmed legacy MP4 fixture is not present in assets/");
    return;
  }
  const imported = await controller.restoreFile({
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  const settings = imported.director.generators.noiseGrid.settings;
  assert.equal(imported.director.compositionId, "noise-grid");
  assert.equal(settings.noiseFields.layers.size.mode, "simplex");
  assert.equal(settings.noiseFields.layers.size.seed, 63);
  assert.equal(settings.noiseFields.layers.color.seed, 69);
  assert.equal(settings.longSideCells, 5);
  assert.equal(settings.noiseFields.layers.visibility.threshold, 0.36000000000000004);
  assert.equal(settings.durationSeconds, 10);
  assert.equal(imported.timeline.time, 9.597099999856681);
  assert.equal(state.resW, 1920);
  assert.equal(state.resH, 1080);
  assert.equal(state.fps, 60);
  assert.equal(restored[0].compositionId, "noise-grid");
});
