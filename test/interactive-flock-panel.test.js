import test from "node:test";
import assert from "node:assert/strict";

import {
  takeCanPlay,
  takeInteractionMode,
  takeStepBoom,
  takeStepGestures,
  takeStepInteraction,
  takeStepPathPoints,
  takeStripAspectRatio,
  takeStripPathGeometry,
  takeStripScreenSize,
} from "../src/ui/interactive-flock-panel.js";

test("Play availability follows the selected beat interaction", () => {
  const steps = [
    { id: "launch", interaction: "launcher" },
    { id: "route", interaction: "picasso" },
  ];
  assert.equal(takeCanPlay({
    mode: "frozen",
    steps,
    selectedStepId: "launch",
    interactionMode: "launcher",
  }), true);
  assert.equal(takeCanPlay({
    mode: "frozen",
    steps,
    selectedStepId: "launch",
    interactionMode: "picasso",
  }), false);
  assert.equal(takeCanPlay({ mode: "drawn", steps: [] }), true);
  assert.equal(takeCanPlay({
    mode: "frozen",
    steps: [],
    interactionMode: "flow",
  }), true);
  assert.equal(takeCanPlay({ mode: "playing", steps }), false);
});

test("take strip reads every canonical gesture and falls back to legacy steps", () => {
  const first = { originX: 0.2, originY: 0.3, directionX: 1, directionY: 0 };
  const second = { originX: 0.8, originY: 0.7, directionX: 0, directionY: -1 };
  assert.deepEqual(takeStepGestures({ gestures: [first, second] }), [first, second]);
  assert.deepEqual(takeStepGestures({ gesture: first }), [first]);
  assert.deepEqual(takeStepGestures({ gestures: [null, first, "bad"] }), [first]);
  assert.deepEqual(takeStepGestures({}), []);
});

test("take strip miniatures preserve the current canvas aspect ratio", () => {
  const landscape = takeStripScreenSize({ width: 1440, height: 900 });
  assert.deepEqual(landscape, {
    width: 64,
    height: 40,
    aspectRatio: 1.6,
  });

  const portrait = takeStripScreenSize({ width: 390, height: 844 });
  assert.equal(portrait.height, 64);
  assert.equal(portrait.width / portrait.height, 390 / 844);
  assert.equal(portrait.aspectRatio, 390 / 844);

  assert.equal(takeStripAspectRatio(null), 16 / 9);
});

test("take strip treats legacy beats as Launcher and reads Picasso paths", () => {
  const step = {
    interaction: "picasso",
    path: {
      points: [
        { x: 0.1, y: 0.2 },
        null,
        { x: 0.6, y: 0.7 },
      ],
    },
  };
  assert.equal(takeStepInteraction({ gesture: {} }), "launcher");
  assert.equal(takeStepInteraction(step), "picasso");
  assert.equal(takeInteractionMode("unknown"), "launcher");
  assert.equal(takeInteractionMode("boom"), "boom");
  assert.equal(takeInteractionMode("flow"), "flow");
  assert.deepEqual(takeStepPathPoints(step), [
    { x: 0.1, y: 0.2 },
    { x: 0.6, y: 0.7 },
  ]);

  const geometry = takeStripPathGeometry(step, { width: 64, height: 40 });
  assert.equal(geometry.points, "6.400,8.000 38.400,28.000");
  assert.equal(geometry.endX, 38.4);
  assert.equal(geometry.endY, 28);
  assert.ok(Math.abs(geometry.endAngle - 32.005383) < 0.000001);
  assert.equal(takeStripPathGeometry({ path: { points: [{ x: 0, y: 0 }] } }), null);
});

test("take strip reads Boom center and radius", () => {
  const boom = { centerX: 0.4, centerY: 0.6, radius: 0.25 };
  assert.equal(takeStepInteraction({ interaction: "boom", boom }), "boom");
  assert.deepEqual(takeStepBoom({ interaction: "boom", boom }), boom);
  assert.equal(takeStepBoom({ boom: { ...boom, radius: 0 } }), null);
});
