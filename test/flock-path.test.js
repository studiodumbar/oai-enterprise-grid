import test from "node:test";
import assert from "node:assert/strict";

import {
  createArcLengthPath,
  createViewportFlockPath,
  dashArcLengthPath,
  sampleArcLengthPath,
} from "../src/generators/flock-path.js";

test("flock paths sample constant arc-length progress with drawn tangents", () => {
  const path = createArcLengthPath([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);

  assert.equal(path.length, 20);
  assert.deepEqual(sampleArcLengthPath(path, 0.25), {
    x: 5,
    y: 0,
    directionX: 1,
    directionY: 0,
    distance: 5,
    progress: 0.25,
  });
  assert.deepEqual(sampleArcLengthPath(path, 0.75), {
    x: 10,
    y: 5,
    directionX: 0,
    directionY: 1,
    distance: 15,
    progress: 0.75,
  });
});

test("manual dash segments preserve corners and advance in draw direction", () => {
  const path = createArcLengthPath([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
  const acrossCorner = dashArcLengthPath(path, {
    dashLength: 12,
    gapLength: 100,
  });
  assert.deepEqual(acrossCorner, [
    { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } },
    { from: { x: 10, y: 0 }, to: { x: 10, y: 2 } },
  ]);

  const shifted = dashArcLengthPath(
    createArcLengthPath([{ x: 0, y: 0 }, { x: 100, y: 0 }]),
    { dashLength: 10, gapLength: 10, offset: 5 },
  );
  assert.deepEqual(shifted[0], {
    from: { x: 5, y: 0 },
    to: { x: 15, y: 0 },
  });
});

test("viewport flock paths validate and scale normalized project points", () => {
  const path = createViewportFlockPath({
    points: [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 1 }],
  }, { width: 800, height: 400 });
  assert.deepEqual(path.points, [
    { x: 200, y: 200 },
    { x: 600, y: 400 },
  ]);
  assert.throws(
    () => createViewportFlockPath({
      points: [{ x: 0, y: 0 }, { x: 1.1, y: 1 }],
    }, { width: 800, height: 400 }),
    /normalized from zero to one/,
  );
});
