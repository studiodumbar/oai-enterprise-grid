import test from "node:test";
import assert from "node:assert/strict";

import { captureDebug } from "../src/debug/index.js";
import {
  createCountingContext,
  createHeadlessDirector,
} from "../src/debug/headless.js";
import { createSvgRecordingContext } from "../src/export/svg-recording-context.js";

const VIEWPORT = Object.freeze({ width: 900, height: 600 });
const FIXED_STEP = 1 / 60;

function frame(frameIndex = 0) {
  return {
    dt: FIXED_STEP,
    compositionDt: FIXED_STEP,
    time: frameIndex * FIXED_STEP,
    frameIndex,
    viewport: VIEWPORT,
    pointer: { active: false, x: 0, y: 0 },
  };
}

function gesture(originX, originY, directionX, directionY, strength) {
  return strength === undefined
    ? { originX, originY, directionX, directionY }
    : { originX, originY, directionX, directionY, strength };
}

function picassoStep(id = "path-1") {
  return {
    id,
    interaction: "picasso",
    path: {
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.6, y: 0.3 },
        { x: 0.6, y: 0.8 },
      ],
    },
    settings: {},
  };
}

function boomStep(id = "boom-1", intensity = 4) {
  return {
    id,
    interaction: "boom",
    boom: { centerX: 0.5, centerY: 0.5, radius: 0.3 },
    settings: { interaction: { boom: { intensity } } },
  };
}

function take(steps, playbackTime, revision = 1) {
  return {
    version: 2,
    mode: "playing",
    steps,
    selectedStepId: steps[0]?.id ?? null,
    previewStepId: steps.at(-1)?.id ?? null,
    playbackTime,
    beatSeconds: 3,
    revision,
    takeSettings: { beatSeconds: 3, showBoids: false },
    stagedSettings: {},
    draftGestures: [],
    draftGesture: null,
  };
}

function setupGenerator() {
  const setup = createHeadlessDirector({
    composition: "interactive-flock",
    viewport: VIEWPORT,
  });
  setup.director.update({ ...frame(0), dt: 0, compositionDt: 0, time: 0 });
  return {
    ...setup,
    generator: setup.director.generator("interactiveFlockGrid"),
  };
}

function authorMultiLaunchBeat(director) {
  const point = (normalizedX, normalizedY) => ({
    normalizedX,
    normalizedY,
    x: normalizedX * VIEWPORT.width,
    y: normalizedY * VIEWPORT.height,
    cssX: normalizedX * VIEWPORT.width,
    cssY: normalizedY * VIEWPORT.height,
  });
  for (const [from, to] of [
    [[0.2, 0.3], [0.65, 0.4]],
    [[0.8, 0.7], [0.4, 0.25]],
  ]) {
    assert.equal(director.input("pointerdown", {
      ...point(...from),
      button: 0,
    }), true);
    assert.equal(director.input("pointermove", point(...to)), true);
    assert.equal(director.input("pointerup", point(...to)), true);
  }
  assert.equal(director.input("take", { action: "play" }), true);
}

function authorPicassoBeat(director) {
  const point = (normalizedX, normalizedY) => ({
    normalizedX,
    normalizedY,
    x: normalizedX * VIEWPORT.width,
    y: normalizedY * VIEWPORT.height,
    cssX: normalizedX * VIEWPORT.width,
    cssY: normalizedY * VIEWPORT.height,
  });
  assert.equal(director.input("take", {
    action: "set-interaction",
    mode: "picasso",
  }), true);
  assert.equal(director.input("pointerdown", {
    ...point(0.2, 0.3),
    button: 0,
  }), true);
  for (const position of [[0.4, 0.3], [0.6, 0.5], [0.8, 0.7]]) {
    assert.equal(director.input("pointermove", point(...position)), true);
  }
  assert.equal(director.input("pointerup", point(0.8, 0.7)), true);
  assert.equal(director.input("take", { action: "play" }), true);
}

test("every flock in one beat emits at its boundary before fixed stepping", () => {
  const { director, generator } = setupGenerator();
  const gestures = [
    gesture(0.25, 0.35, 1, 0),
    gesture(0.75, 0.65, 0, -1),
    gesture(0.5, 0.2, -1, 0),
  ];
  const events = [];
  const emitPulse = generator.flock.emitPulse.bind(generator.flock);
  const updateFlock = generator.flock.update.bind(generator.flock);
  generator.flock.emitPulse = (width, height, emission) => {
    events.push(`pulse:${emission.originX},${emission.originY}`);
    return emitPulse(width, height, emission);
  };
  generator.flock.update = (...args) => {
    events.push("step");
    return updateFlock(...args);
  };

  try {
    const lines = captureDebug(["transition"], () => {
      generator.update(frame(1), [{
        take: take([{ id: "step-1", gestures, settings: {} }], FIXED_STEP),
      }]);
    });

    assert.deepEqual(events.slice(0, 4), [
      "pulse:225,210",
      "pulse:675,390",
      "pulse:450,120",
      "step",
    ]);
    assert.equal(generator.flock.pulseIndex, 3);
    assert.ok(Math.abs(generator.flock.time - FIXED_STEP) < 1e-12);
    const pulseLines = lines.filter(line => line.includes("interactive-flock pulse"));
    assert.equal(pulseLines.length, 3);
    assert.ok(pulseLines.every(line => (
      line.includes("index=0") && line.includes("tick=0")
    )));
    assert.deepEqual(
      pulseLines.map(line => line.match(/launch=(\d+) launches=(\d+)/)?.slice(1)),
      [["0", "3"], ["1", "3"], ["2", "3"]],
    );
  } finally {
    director.dispose();
  }
});

test("launcher strength reaches pulse emission while legacy launches stay full strength", () => {
  const { director, generator } = setupGenerator();
  const emitted = [];
  const emitPulse = generator.flock.emitPulse.bind(generator.flock);
  generator.flock.emitPulse = (width, height, emission) => {
    emitted.push(emission);
    return emitPulse(width, height, emission);
  };

  try {
    generator.update(frame(1), [{
      take: take([{
        id: "step-1",
        gestures: [
          gesture(0.25, 0.35, 1, 0, 0.2),
          gesture(0.75, 0.65, 0, -1),
        ],
        settings: {},
      }], FIXED_STEP),
    }]);

    assert.deepEqual(emitted.map(emission => emission.strength), [0.2, 1]);
  } finally {
    director.dispose();
  }
});

test("Picasso emits on its first tangent and guides every fixed tick by arc length", () => {
  const { director, generator } = setupGenerator();
  const emitted = [];
  const guides = [];
  const emitPulse = generator.flock.emitPulse.bind(generator.flock);
  const updateFlock = generator.flock.update.bind(generator.flock);
  generator.flock.emitPulse = (width, height, emission) => {
    emitted.push(emission);
    return emitPulse(width, height, emission);
  };
  generator.flock.update = (dt, width, height, pointer, guide) => {
    guides.push(guide);
    return updateFlock(dt, width, height, pointer, guide);
  };

  try {
    const lines = captureDebug(["transition"], () => {
      generator.update(frame(1), [{
        take: take([picassoStep()], FIXED_STEP),
      }]);
    });
    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], {
      originX: 180,
      originY: 180,
      directionX: 1,
      directionY: 0,
    });
    assert.equal(guides.length, 1);
    assert.ok(Math.abs(guides[0].x - (180 + 660 / 180)) < 1e-9);
    assert.equal(guides[0].y, 180);
    assert.equal(guides[0].directionX, 1);
    assert.equal(guides[0].directionY, 0);
    assert.ok(lines.some(line => (
      line.includes("interactive-flock picasso-start")
      && line.includes("points=3")
      && line.includes("length=660.000")
    )));
  } finally {
    director.dispose();
  }
});

test("Boom emits its configured launcher count radially inside the drag radius", () => {
  const { director, generator } = setupGenerator();
  const emitted = [];
  const emitPulse = generator.flock.emitPulse.bind(generator.flock);
  generator.flock.emitPulse = (width, height, emission) => {
    emitted.push(emission);
    return emitPulse(width, height, emission);
  };

  try {
    const lines = captureDebug(["transition"], () => {
      generator.update(frame(1), [{
        take: take([boomStep("boom-1", 6)], FIXED_STEP),
      }]);
    });
    assert.equal(emitted.length, 6);
    assert.equal(generator.flock.pulseIndex, 6);
    for (const emission of emitted) {
      const offsetX = emission.originX - VIEWPORT.width * 0.5;
      const offsetY = emission.originY - VIEWPORT.height * 0.5;
      assert.ok(Math.hypot(offsetX, offsetY) <= 180 + 1e-9);
      assert.ok(offsetX * emission.directionX + offsetY * emission.directionY > 0);
    }
    assert.ok(lines.some(line => (
      line.includes("interactive-flock boom")
      && line.includes("radius=0.300")
      && line.includes("intensity=6 launchers=6")
    )));

    generator.takeState = {
      mode: "drawn",
      interactionMode: "boom",
      selectedStepId: null,
      steps: [],
      draftBoom: { centerX: 0.5, centerY: 0.5, radius: 0.3 },
      stagedSettings: { interaction: { boom: { intensity: 3 } } },
    };
    const authoring = createCountingContext();
    generator.drawAuthoringGesture(authoring);
    assert.equal(authoring.counts.stroke, 4);
  } finally {
    director.dispose();
  }
});

test("Picasso prefix reconstruction matches uninterrupted fixed-step playback", () => {
  const uninterrupted = setupGenerator();
  const reconstructed = setupGenerator();
  const steps = [picassoStep()];

  try {
    uninterrupted.generator.update(frame(180), [{ take: take(steps, 3) }]);
    reconstructed.generator.update(frame(45), [{ take: take(steps, 0.75) }]);
    reconstructed.generator.update(frame(180), [{ take: take(steps, 3) }]);
    assert.deepEqual(
      reconstructed.generator.snapshotProjectState().simulation,
      uninterrupted.generator.snapshotProjectState().simulation,
    );

    reconstructed.generator.update(frame(181), [{ take: take(steps, 0) }]);
    reconstructed.generator.update(frame(360), [{ take: take(steps, 3) }]);
    assert.deepEqual(
      reconstructed.generator.snapshotProjectState().simulation,
      uninterrupted.generator.snapshotProjectState().simulation,
    );
  } finally {
    uninterrupted.director.dispose();
    reconstructed.director.dispose();
  }
});

test("Picasso paths render as portable segments in preview and exports", () => {
  const { director, generator } = setupGenerator();
  const step = picassoStep();
  const baseTake = {
    ...take([step], 1.5),
    mode: "playing",
    interactionMode: "picasso",
    takeSettings: { beatSeconds: 3, showBoids: false, showPath: true },
  };

  try {
    generator.takeState = baseTake;
    const preview = createCountingContext();
    assert.equal(generator.drawInteractivePath(preview, frame(90)), true);
    assert.equal(preview.counts.stroke, 1);

    for (const exporting of [false, true]) {
      const recorder = createSvgRecordingContext(VIEWPORT.width, VIEWPORT.height);
      assert.equal(generator.drawInteractivePath(recorder, {
        ...frame(90),
        exporting,
      }), true);
      const svg = recorder.toSVG();
      assert.match(svg, /#8cdfad/i);
      assert.doesNotMatch(svg, /stroke-dasharray/i);
    }

    const exportedFrame = createSvgRecordingContext(VIEWPORT.width, VIEWPORT.height);
    generator.draw({ ...frame(90), exporting: true }, { take: baseTake }, exportedFrame);
    assert.match(exportedFrame.toSVG(), /#8cdfad/i);

    generator.takeState = {
      ...baseTake,
      takeSettings: { ...baseTake.takeSettings, showPath: false },
    };
    assert.equal(generator.drawInteractivePath(
      createCountingContext(),
      { ...frame(90), exporting: true },
    ), false);

    generator.takeState = {
      ...baseTake,
      mode: "drawing",
      playbackTime: 0,
      steps: [],
      selectedStepId: null,
      draftPath: step.path,
      takeSettings: { ...baseTake.takeSettings, showPath: false },
    };
    const authoring = createCountingContext();
    assert.equal(generator.drawInteractivePath(authoring, frame(30)), true);
    assert.equal(authoring.counts.stroke, 1);
    assert.equal(generator.drawInteractivePath(
      createCountingContext(),
      { ...frame(30), exporting: true },
    ), false);
  } finally {
    director.dispose();
  }
});

test("multi-flock prefixes rebuild and replay deterministically", () => {
  const first = setupGenerator();
  const second = setupGenerator();
  const originalSteps = [
    {
      id: "step-1",
      gestures: [
        gesture(0.2, 0.3, 1, 0),
        gesture(0.8, 0.3, -1, 0),
      ],
      settings: {},
    },
    {
      id: "step-2",
      gestures: [gesture(0.5, 0.8, 0, -1)],
      settings: {},
    },
  ];
  const editedSteps = structuredClone(originalSteps);
  editedSteps[0].gestures[1] = gesture(0.75, 0.65, 0, -1);

  try {
    first.generator.update(frame(360), [{
      take: take(originalSteps, 6, 1),
    }]);
    assert.equal(first.generator.flock.pulseIndex, 3);
    assert.equal(first.generator.inspect().take.cachedPrefixes, 3);

    first.generator.update(frame(361), [{
      take: take(editedSteps, 3, 2),
    }]);
    assert.equal(first.generator.flock.pulseIndex, 2);
    assert.equal(first.generator.inspect().take.cachedPrefixes, 2);
    assert.ok(Math.abs(first.generator.flock.time - 3) < 1e-9);

    first.generator.update(frame(362), [{
      take: take(editedSteps, 6, 2),
    }]);
    second.generator.update(frame(360), [{
      take: take(editedSteps, 6, 2),
    }]);
    assert.deepEqual(
      first.generator.snapshotProjectState().simulation,
      second.generator.snapshotProjectState().simulation,
    );

    first.generator.update(frame(363), [{
      take: take(editedSteps, 0, 2),
    }]);
    first.generator.update(frame(364), [{
      take: take(editedSteps, 6, 2),
    }]);
    assert.deepEqual(
      first.generator.snapshotProjectState().simulation,
      second.generator.snapshotProjectState().simulation,
    );
  } finally {
    first.director.dispose();
    second.director.dispose();
  }
});

test("Let it flow advances simulation without adding a new interaction", () => {
  const { director, generator } = setupGenerator();

  try {
    authorMultiLaunchBeat(director);
    for (let tick = 1; tick <= 180; tick += 1) {
      director.update(frame(tick));
    }
    assert.equal(director.input("take", { action: "select", stepId: null }), true);
    assert.equal(director.input("take", {
      action: "set-interaction",
      mode: "flow",
    }), true);
    assert.equal(director.input("take", { action: "play" }), true);
    const before = generator.snapshotProjectState().simulation;
    const pulseIndex = generator.flock.pulseIndex;
    const lines = captureDebug(["transition"], () => {
      for (let tick = 181; tick <= 360; tick += 1) {
        director.update(frame(tick));
      }
    });
    const after = generator.snapshotProjectState().simulation;
    const { ticks: beforeTicks, ...beforeVisual } = before;
    const { ticks: afterTicks, ...afterVisual } = after;

    assert.equal(beforeTicks, 180);
    assert.equal(afterTicks, 360);
    assert.ok(afterVisual.flock.time > beforeVisual.flock.time);
    assert.ok(Math.abs(
      afterVisual.flock.time - beforeVisual.flock.time - 3,
    ) < 1e-9);
    assert.equal(generator.flock.pulseIndex, pulseIndex);
    assert.equal(director.inspect().timeline.rule.mode, "frozen");
    assert.equal(director.inspect().timeline.rule.playbackTime, 6);
    assert.equal(director.inspect().timeline.rule.steps[1].interaction, "flow");
    assert.equal(
      lines.filter(line => line.includes("interactive-flock flow")).length,
      1,
    );
    assert.ok(lines.some(line => (
      line.includes("step=step-2")
      && line.includes("index=1")
      && line.includes("tick=180")
      && line.includes("ticks=180")
    )));

    assert.equal(director.input("take", { action: "select", stepId: null }), true);
    assert.equal(director.input("take", {
      action: "set-interaction",
      mode: "launcher",
    }), true);
    authorMultiLaunchBeat(director);
    director.update(frame(361));
    assert.equal(generator.flock.pulseIndex, pulseIndex + 2);
  } finally {
    director.dispose();
  }
});

test("playback and authoring overlays retain legacy single-gesture takes", () => {
  const { director, generator } = setupGenerator();
  const legacyGesture = gesture(0.4, 0.4, 1, 0);

  try {
    generator.update(frame(1), [{
      take: take([{ id: "legacy", gesture: legacyGesture, settings: {} }], FIXED_STEP),
    }]);
    assert.equal(generator.flock.pulseIndex, 1);

    const context = createCountingContext();
    generator.takeState = {
      mode: "drawn",
      selectedStepId: "step-1",
      steps: [{
        id: "step-1",
        gestures: [
          gesture(0.2, 0.2, 1, 0),
          gesture(0.8, 0.8, -1, 0),
        ],
      }],
      draftGestures: [gesture(0.3, 0.7, 0, -1)],
      draftGesture: gesture(0.7, 0.3, 0, 1),
    };
    generator.drawAuthoringGesture(context);
    assert.equal(context.counts.stroke, 2);

    context.counts.stroke = 0;
    generator.takeState.draftGestures = [];
    generator.takeState.draftGesture = null;
    generator.drawAuthoringGesture(context);
    assert.equal(context.counts.stroke, 2);

    context.counts.stroke = 0;
    generator.takeState.steps = [{ id: "step-1", gesture: legacyGesture }];
    generator.drawAuthoringGesture(context);
    assert.equal(context.counts.stroke, 1);
  } finally {
    director.dispose();
  }
});
