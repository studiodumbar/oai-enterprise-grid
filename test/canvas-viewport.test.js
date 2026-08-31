import test from "node:test";
import assert from "node:assert/strict";

import { GLOBAL_CONFIG } from "../config.js";
import {
  fitCanvasDisplaySize,
  resolveCanvasViewport,
} from "../src/core/canvas-viewport.js";
import { captureDebug } from "../src/debug/index.js";

test("canvas geometry follows requested export specs", () => {
  assert.equal(GLOBAL_CONFIG.canvas.aspectRatio, "16:9");
  assert.deepEqual(resolveCanvasViewport({
    requestedViewport: { width: 1920, height: 1080 },
  }), { width: 1920, height: 1080 });
  assert.deepEqual(resolveCanvasViewport({
    requestedViewport: { width: 1920, height: 1080 },
  }), { width: 1920, height: 1080 });
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
      requestedViewport: { width: 1080, height: 1920 },
    });
  });
  assert.deepEqual(lines, [
    "[cg:config] f=0000 canvas viewport resolved mode=requested width=1080 height=1920",
  ]);
  assert.throws(
    () => resolveCanvasViewport(),
    /requested viewport width must be a positive finite number/,
  );
});
