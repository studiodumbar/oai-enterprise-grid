import test from "node:test";
import assert from "node:assert/strict";

import {
  applyKnownExportState,
  createExportState,
  formatVisibility,
  normalizeExportState,
} from "../src/export/export-state.js";
import {
  fixedStepsBetween,
  fixedStepsForFrame,
  frameCountFor,
  frameTimeAt,
} from "../src/export/deterministic-clock.js";
import { containFit } from "../src/export/contain-fit.js";

test("export state constrains formats by workflow and exposes contextual controls", () => {
  const state = createExportState({ mode: "motion", exportFormat: "svg" });
  assert.equal(state.exportFormat, "mp4");
  assert.deepEqual(formatVisibility(state), {
    transparency: false,
    fps: true,
    metadata: true,
  });
  state.exportFormat = "png-sequence";
  assert.deepEqual(formatVisibility(state), {
    transparency: true,
    fps: true,
    metadata: true,
  });
  state.exportFormat = "webm";
  assert.deepEqual(formatVisibility(state), {
    transparency: false,
    fps: true,
    metadata: false,
  });
  state.mode = "static";
  state.exportFormat = "png";
  normalizeExportState(state);
  assert.deepEqual(formatVisibility(state), {
    transparency: true,
    fps: false,
    metadata: true,
  });
});

test("known export-state restoration ignores unknown keys", () => {
  const state = createExportState();
  applyKnownExportState(state, {
    resW: 1080,
    resH: 1920,
    exportFormat: "svg",
    futureSetting: "ignored",
  });
  assert.equal(state.resW, 1080);
  assert.equal(state.resH, 1920);
  assert.equal(state.exportFormat, "svg");
  assert.equal(Object.hasOwn(state, "futureSetting"), false);
});

test("restored export settings are bounded to controls the current app supports", () => {
  const state = createExportState();
  applyKnownExportState(state, {
    aspect: "1000000:1",
    resolution: 999999,
    resW: 999999,
    resH: -1,
    fps: 1000,
  });
  assert.deepEqual(
    { aspect: state.aspect, resolution: state.resolution },
    { aspect: "16:9", resolution: 1920 },
  );
  assert.deepEqual(
    { resW: state.resW, resH: state.resH, fps: state.fps },
    { resW: 1920, resH: 1080, fps: 30 },
  );
});

test("deterministic frame math omits the duplicate endpoint", () => {
  assert.equal(frameCountFor(2.6, 30), 78);
  assert.equal(frameTimeAt(77, 30), 77 / 30);
  assert.ok(frameTimeAt(77, 30) < 2.6);
  const steps = fixedStepsBetween(0, 1 / 24);
  assert.ok(Math.abs(steps.reduce((sum, value) => sum + value, 0) - 1 / 24) < 1e-12);
  assert.ok(steps.every(value => value <= 1 / 60 + 1e-12));
  const tenthFrame = fixedStepsForFrame(10, 24);
  assert.ok(Math.abs(tenthFrame.reduce((sum, value) => sum + value, 0) - 1 / 24) < 1e-12);
});

test("contain-fit centers without cropping", () => {
  assert.deepEqual(containFit({ x: 0, y: 0, width: 100, height: 100 }, 200, 100), {
    scale: 1,
    dx: 50,
    dy: 0,
    width: 100,
    height: 100,
  });
  assert.deepEqual(containFit({ x: 10, y: 20, width: 200, height: 100 }, 100, 100), {
    scale: 0.5,
    dx: -5,
    dy: 15,
    width: 100,
    height: 50,
  });
});
