import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_CONFIG } from "../config.js";
import {
  fitCanvasDisplaySize,
  resolveCanvasViewport,
} from "../src/core/canvas-viewport.js";
import { captureDebug } from "../src/debug/index.js";

test("fixed canvas geometry follows requested export specs, not the window", () => {
  assert.equal(GLOBAL_CONFIG.canvas.resizeWithWindow, false);
  assert.deepEqual(resolveCanvasViewport({
    resizeWithWindow: false,
    windowViewport: { width: 1440, height: 700 },
    requestedViewport: { width: 1920, height: 1080 },
  }), { width: 1920, height: 1080 });
  assert.deepEqual(resolveCanvasViewport({
    resizeWithWindow: false,
    windowViewport: { width: 900, height: 500 },
    requestedViewport: { width: 1920, height: 1080 },
  }), { width: 1920, height: 1080 });
});

test("responsive canvas geometry follows the browser window", () => {
  assert.deepEqual(resolveCanvasViewport({
    resizeWithWindow: true,
    windowViewport: { width: 900, height: 500 },
    requestedViewport: { width: 1920, height: 1080 },
  }), { width: 900, height: 500 });
});

test("fixed canvas display shrinks to fit without changing logical geometry", () => {
  const logical = { width: 1920, height: 1080 };
  const display = fitCanvasDisplaySize(logical, { width: 1440, height: 700 });
  assert.equal(display.height, 700);
  assert.equal(display.width, 700 * 16 / 9);
  assert.deepEqual(logical, { width: 1920, height: 1080 });
});

test("canvas viewport resolution is observable and rejects invalid config", () => {
  const lines = captureDebug(["config"], () => {
    resolveCanvasViewport({
      resizeWithWindow: false,
      requestedViewport: { width: 1080, height: 1920 },
    });
  });
  assert.deepEqual(lines, [
    "[cg:config] f=0000 canvas viewport resolved mode=requested width=1080 height=1920",
  ]);
  assert.throws(
    () => resolveCanvasViewport({ resizeWithWindow: "false" }),
    /resizeWithWindow must be a boolean/,
  );
});
