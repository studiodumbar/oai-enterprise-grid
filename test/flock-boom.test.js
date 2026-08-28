import test from "node:test";
import assert from "node:assert/strict";

import { createBoomLaunchers } from "../src/generators/flock-boom.js";

test("Boom deterministically fills its radius with outward launchers", () => {
  const viewport = { width: 900, height: 600 };
  const boom = { centerX: 0.5, centerY: 0.5, radius: 0.4 };
  const first = createBoomLaunchers(boom, viewport, 8);
  const second = createBoomLaunchers(boom, viewport, 8);
  const center = { x: 450, y: 300 };

  assert.deepEqual(first, second);
  assert.equal(first.length, 8);
  for (const launcher of first) {
    const offsetX = launcher.originX - center.x;
    const offsetY = launcher.originY - center.y;
    assert.ok(Math.hypot(offsetX, offsetY) <= 240 + 1e-9);
    assert.ok(offsetX * launcher.directionX + offsetY * launcher.directionY > 0);
    assert.ok(launcher.originX >= 0 && launcher.originX <= viewport.width);
    assert.ok(launcher.originY >= 0 && launcher.originY <= viewport.height);
  }
});

test("Boom clips launcher origins to the viewport and rejects invalid intensity", () => {
  const viewport = { width: 300, height: 200 };
  const launchers = createBoomLaunchers(
    { centerX: 0, centerY: 0.5, radius: 1 },
    viewport,
    12,
  );
  assert.ok(launchers.every(launcher => (
    launcher.originX >= 0
    && launcher.originX <= viewport.width
    && launcher.originY >= 0
    && launcher.originY <= viewport.height
  )));
  assert.throws(
    () => createBoomLaunchers({ centerX: 0.5, centerY: 0.5, radius: 1 }, viewport, 1.5),
    /positive integer/,
  );
});
