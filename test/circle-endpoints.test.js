import test from "node:test";
import assert from "node:assert/strict";

import {
  NativeCircleEndpointTransition,
  animationDurationWithCircleEndpoints,
  circleEndpointTimelineAt,
  normalizeCircleEndpointSettings,
} from "../src/compositions/circle-endpoints.js";
import { SequenceRule } from "../src/compositions/sequence-rule.js";
import { CompositionDirector } from "../src/core/composition-director.js";
import { FactoryRegistry } from "../src/core/registry.js";
import { createSceneTransitionModeRegistry } from "../src/scene-transitions/index.js";

const ENDPOINTS = Object.freeze({
  startWithCircle: true,
  startWithCircleDurationSeconds: 1,
  endWithCircle: true,
  endWithCircleDurationSeconds: 2,
  circleSubdivision: 1,
});

test("circle endpoint settings validate independent durations and subdivisions", () => {
  assert.deepEqual(normalizeCircleEndpointSettings({}), {
    startWithCircle: false,
    startWithCircleDurationSeconds: 1,
    endWithCircle: false,
    endWithCircleDurationSeconds: 1,
    circleSubdivision: 1,
  });
  assert.equal(
    normalizeCircleEndpointSettings({ circleSubdivision: 8 }).circleSubdivision,
    8,
  );
  assert.equal(
    normalizeCircleEndpointSettings({ startWithCircleDurationSeconds: "auto" })
      .startWithCircleDurationSeconds,
    "auto",
  );
  assert.throws(
    () => normalizeCircleEndpointSettings({ circleSubdivision: 3 }),
    /must be one of 1, 2, 4, 8, or 16/,
  );
  assert.throws(
    () => normalizeCircleEndpointSettings({ startWithCircleDurationSeconds: 0 }),
    /finite positive number/,
  );
});

test("start and end durations wrap and pause the original core timeline", () => {
  assert.equal(animationDurationWithCircleEndpoints(4, ENDPOINTS), 7);
  assert.deepEqual(circleEndpointTimelineAt(0, 4, ENDPOINTS), {
    phase: "start",
    progress: 0,
    durationSeconds: 1,
    cycleIndex: 0,
    coreTime: 0,
  });
  assert.equal(circleEndpointTimelineAt(0.5, 4, ENDPOINTS).coreTime, 0);
  assert.equal(circleEndpointTimelineAt(2, 4, ENDPOINTS).coreTime, 1);
  const ending = circleEndpointTimelineAt(6, 4, ENDPOINTS);
  assert.equal(ending.phase, "end");
  assert.equal(ending.progress, 0.5);
  assert.ok(ending.coreTime < 4);
  assert.deepEqual(circleEndpointTimelineAt(7, 4, ENDPOINTS), {
    phase: "start",
    progress: 0,
    durationSeconds: 1,
    cycleIndex: 1,
    coreTime: 4,
  });
});

test("auto endpoint durations resolve from the active flicker timing", () => {
  const automatic = {
    ...ENDPOINTS,
    startWithCircleDurationSeconds: "auto",
    endWithCircleDurationSeconds: "auto",
  };
  const flickerDurations = { start: 1.5, end: 0.75 };
  assert.equal(
    animationDurationWithCircleEndpoints(4, automatic, flickerDurations),
    6.25,
  );
  const starting = circleEndpointTimelineAt(0.75, 4, automatic, flickerDurations);
  assert.equal(starting.phase, "start");
  assert.equal(starting.progress, 0.5);
  assert.equal(starting.durationSeconds, 1.5);
  const ending = circleEndpointTimelineAt(5.875, 4, automatic, flickerDurations);
  assert.equal(ending.phase, "end");
  assert.equal(ending.progress, 0.5);
  assert.equal(ending.durationSeconds, 0.75);
});

test("native endpoint motion preserves a complete subdivided parent cell", () => {
  const settings = {
    ...ENDPOINTS,
    endWithCircle: false,
    circleSubdivision: 8,
  };
  const transitionSettings = {
    mode: "fade",
    modes: { fade: { revealFraction: 0.5, timingCurve: [0, 0, 1, 1] } },
  };
  const endpoint = new NativeCircleEndpointTransition({
    settings,
    intro: transitionSettings,
    outro: transitionSettings,
    modeRegistry: createSceneTransitionModeRegistry(),
  });
  const layout = {
    width: 500,
    height: 100,
    columns: 5,
    rows: 1,
    cellSize: 100,
    offsetX: 0,
    offsetY: 0,
  };
  const items = Array.from({ length: 5 }, (_, index) => ({
    id: `glyph:${index}`,
    x: (index + 0.5) * 100,
    y: 50,
    size: 100,
  }));
  const posesAt = progress => {
    endpoint.prepare({
      phase: "start",
      progress,
      durationSeconds: 1,
      cycleIndex: 0,
    }, items, layout);
    return items.flatMap(item => endpoint.presentationsFor(item.id).map(
      presentation => ({
        x: item.x + presentation.offsetX,
        y: item.y + presentation.offsetY,
        size: item.size * presentation.scale,
        opacity: presentation.opacity,
      }),
    ));
  };

  // Fully revealed, the endpoint is the complete 8x8 parent cell and nothing
  // else: every one of the 64 sources is carried by some destination glyph.
  const revealed = posesAt(0.5).filter(pose => pose.opacity > 0);
  assert.equal(revealed.length, 64);
  assert.equal(new Set(revealed.map(pose => pose.x)).size, 8);
  assert.equal(new Set(revealed.map(pose => pose.y)).size, 8);
  assert.ok(revealed.every(pose => pose.size === 12.5 && pose.opacity === 1));
  assert.ok(revealed.every(pose => (
    pose.x >= 0 && pose.x <= layout.width
    && pose.y >= 0 && pose.y <= layout.height
  )));

  // Midway through the crossfade the circle and the composition share the
  // screen, and the padded duplicates do not stack extra copies of a glyph.
  const crossfading = posesAt(0.75).filter(pose => pose.opacity > 0);
  assert.equal(crossfading.filter(pose => pose.size === 12.5).length, 64);
  assert.deepEqual(
    crossfading.filter(pose => pose.size === 100),
    items.map(item => ({ x: item.x, y: item.y, size: 100, opacity: 0.5 })),
  );

  assert.deepEqual(
    posesAt(1),
    items.map(item => ({ x: item.x, y: item.y, size: 100, opacity: 1 })),
  );
});

test("composition director adds endpoint durations and passes native phase frames", () => {
  const updateFrames = [];
  const drawFrames = [];
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  generatorTypes.register("fake", () => ({
    update: frame => updateFrames.push(frame),
    draw: frame => drawFrames.push(frame),
    animationDuration: () => 4,
  }));
  compositionRules.register(
    "sequence",
    ({ definition }) => new SequenceRule(definition),
  );
  const context = { globalAlpha: 1, save() {}, restore() {} };
  const director = new CompositionDirector({
    settings: { composition: ENDPOINTS },
    generatorDefinitions: { grid: { type: "fake" } },
    compositionDefinitions: {
      demo: { rule: "sequence", steps: [{ use: "grid" }] },
    },
    generatorTypes,
    compositionRules,
    runtime: { context: () => context },
  });
  director.use("demo");
  director.update({ dt: 0, compositionDt: 0, time: 0 });
  assert.equal(director.animationDuration(), 7);
  director.update({ dt: 0.5, compositionDt: 0.5, time: 0.5 });
  assert.equal(updateFrames.at(-1).compositionDt, 0);
  assert.equal(updateFrames.at(-1).compositionEndpoint.progress, 0.5);
  director.update({ dt: 1, compositionDt: 1, time: 1.5 });
  assert.equal(updateFrames.at(-1).compositionDt, 0.5);
  assert.equal(updateFrames.at(-1).time, 0.5);

  director.draw({
    exporting: true,
    exportFrameIndex: 209,
    exportFrameCount: 210,
  });
  assert.equal(drawFrames.at(-1).compositionEndpoint.phase, "end");
  assert.equal(drawFrames.at(-1).compositionEndpoint.progress, 1);
});

test("composition director resolves auto durations through the active generator", () => {
  const updateFrames = [];
  const generatorTypes = new FactoryRegistry("generator type");
  const compositionRules = new FactoryRegistry("composition rule");
  generatorTypes.register("fake", () => ({
    update: frame => updateFrames.push(frame),
    animationDuration: () => 4,
    endpointAutoDuration: direction => direction === "start" ? 0.75 : 1.25,
  }));
  compositionRules.register(
    "sequence",
    ({ definition }) => new SequenceRule(definition),
  );
  const director = new CompositionDirector({
    settings: {
      composition: {
        ...ENDPOINTS,
        startWithCircleDurationSeconds: "auto",
        endWithCircleDurationSeconds: "auto",
      },
    },
    generatorDefinitions: { grid: { type: "fake" } },
    compositionDefinitions: {
      demo: { rule: "sequence", steps: [{ use: "grid" }] },
    },
    generatorTypes,
    compositionRules,
    runtime: { context: () => ({ save() {}, restore() {} }) },
  });
  director.use("demo");
  director.update({ dt: 0, compositionDt: 0, time: 0 });
  assert.equal(director.animationDuration(), 6);
  director.update({ dt: 0.375, compositionDt: 0.375, time: 0.375 });
  assert.equal(updateFrames.at(-1).compositionEndpoint.durationSeconds, 0.75);
  assert.equal(updateFrames.at(-1).compositionEndpoint.progress, 0.5);
});
